const { useState, useEffect, useCallback, useMemo, useRef } = React;

// <macsec-math>
// 802.1AE framing. MACsec inserts a SecTAG after the source MAC and appends a
// 16-byte ICV before the FCS. XPN does NOT change the on-wire size — the upper
// 32 bits of the 64-bit PN are implicit and never transmitted.
const MACSEC_ICV_BYTES      = 16;   // GCM-AES ICV, always 16
const MACSEC_SECTAG_SCI     = 16;   // SecTAG carrying an explicit SCI
const MACSEC_SECTAG_NOSCI   = 8;    // SecTAG without SCI (point-to-point, SCI implied)
const ETH_OVERHEAD_BYTES    = 20;   // 7 preamble + 1 SFD + 12 inter-frame gap
const MACSEC_MIN_FRAME      = 64;   // smallest legal Ethernet frame -> worst-case PN burn
const MACSEC_MAX_FRAME      = 9216; // jumbo ceiling accepted by this tool
const MACSEC_PN_REKEY_FRACTION = 0.5; // rekey by half the PN space: one full SA of headroom

// On-wire bytes of one MACsec-protected frame, FCS included, IFG excluded.
function macsecWireBytes(userFrameBytes, includeSci) {
  return userFrameBytes + (includeSci ? MACSEC_SECTAG_SCI : MACSEC_SECTAG_NOSCI) + MACSEC_ICV_BYTES;
}

// Worst-case frames per second the wire can carry at this frame size.
// One frame == one PN increment, so this is also the PN burn rate.
function macsecFrameRate(lineRateBps, userFrameBytes, includeSci) {
  if (!isFinite(lineRateBps) || lineRateBps <= 0) return NaN;
  if (!isFinite(userFrameBytes) || userFrameBytes < MACSEC_MIN_FRAME) return NaN;
  return lineRateBps / ((macsecWireBytes(userFrameBytes, includeSci) + ETH_OVERHEAD_BYTES) * 8);
}

// 2^32 without XPN, 2^64 with. Both exact in a double (2^64 is a power of two).
function macsecPnSpace(xpn) { return Math.pow(2, xpn ? 64 : 32); }

// Seconds to walk the whole PN space at line rate. Reusing a PN under one SAK
// repeats a GCM nonce, which loses both confidentiality and integrity — this is
// the number the rekey interval must stay under.
// ponytail: known value — 10 GbE, 64-byte frames, SCI on: a 32-bit PN wraps in
// 398.573 s, a 64-bit XPN in ~54,245 years. Checked by the node harness in
// .keleon/plans/fw4-macsec-config-builder.md §9.2.
function macsecPnExhaustSeconds(lineRateBps, userFrameBytes, includeSci, xpn) {
  const fps = macsecFrameRate(lineRateBps, userFrameBytes, includeSci);
  if (!isFinite(fps) || fps <= 0) return NaN;
  return macsecPnSpace(xpn) / fps;
}

// Largest rekey interval that keeps PN use under MACSEC_PN_REKEY_FRACTION of the
// space, clamped to the selected vendor's configurable range.
// null means the PN exhausts faster than the vendor's minimum timer can fire —
// no timer value is safe and the cipher suite must change to an XPN variant.
function macsecRecommendedRekey(exhaustSeconds, minSeconds, maxSeconds) {
  if (!isFinite(exhaustSeconds) || exhaustSeconds <= 0) return null;
  const bound = exhaustSeconds * MACSEC_PN_REKEY_FRACTION;
  if (bound < minSeconds) return null;
  return Math.max(minSeconds, Math.min(maxSeconds, Math.floor(bound)));
}
// </macsec-math>

const MACSEC_TABS    = ['builder', 'rekey', 'reference'];
const MACSEC_VENDORS = ['cisco_iosxe', 'cisco_nxos', 'junos'];

// Cipher suites. `xpn` drives the maths; the three token columns are the CLI
// spelling each vendor wants. `bits` is the SAK/CAK key size.
const MACSEC_CIPHERS = [
  { id: 'gcm_aes_128',     bits: 128, xpn: false,
    iosxe: 'gcm-aes-128',     nxos: 'GCM-AES-128',     junos: 'gcm-aes-128' },
  { id: 'gcm_aes_256',     bits: 256, xpn: false,
    iosxe: 'gcm-aes-256',     nxos: 'GCM-AES-256',     junos: 'gcm-aes-256' },
  { id: 'gcm_aes_xpn_128', bits: 128, xpn: true,
    iosxe: 'gcm-aes-xpn-128', nxos: 'GCM-AES-XPN-128', junos: 'gcm-aes-xpn-128' },
  { id: 'gcm_aes_xpn_256', bits: 256, xpn: true,
    iosxe: 'gcm-aes-xpn-256', nxos: 'GCM-AES-XPN-256', junos: 'gcm-aes-xpn-256' },
];
const MACSEC_CIPHER_DEFAULT = 'gcm_aes_xpn_256';

// Vendor-documented limits. Verified against the vendor docs cited in §3.
const MACSEC_VENDOR_LIMITS = {
  cisco_iosxe: { rekeyMin: 30, rekeyMax: 65535,      ksPrioMax: 255, iface: 'TenGigabitEthernet1/0/1' },
  cisco_nxos:  { rekeyMin: 30, rekeyMax: 2147483646, ksPrioMax: 255, iface: 'Ethernet1/1' },
  junos:       { rekeyMin: 60, rekeyMax: 86400,      ksPrioMax: 255, iface: 'xe-0/0/1' },
};

// Line-rate presets, value in bits per second. Label is a protocol literal.
const MACSEC_RATES = [
  { id: '1',   bps: 1e9,   label: '1 GbE'   },
  { id: '10',  bps: 10e9,  label: '10 GbE'  },
  { id: '25',  bps: 25e9,  label: '25 GbE'  },
  { id: '40',  bps: 40e9,  label: '40 GbE'  },
  { id: '100', bps: 100e9, label: '100 GbE' },
  { id: '400', bps: 400e9, label: '400 GbE' },
];

const MACSEC_CONF_OFFSETS = ['0', '30', '50'];
const MACSEC_CKN_HEX_LEN = 64;      // 32 bytes — the only length all three vendors accept

function macsecFormatDuration(s) {
  if (!isFinite(s) || s <= 0) return '—';
  if (s < 900) return s.toFixed(1) + ' s';
  if (s < 5400) return (s / 60).toFixed(1) + ' min';
  if (s < 172800) return (s / 3600).toFixed(1) + ' h';
  if (s < 3.15576e9) return (s / 86400).toFixed(1) + ' d';
  return (s / 31557600).toPrecision(6) + ' years';   // Julian year, 365.25 d
}

function macsecFormatBytes(b) {
  if (!isFinite(b) || b < 0) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0, v = b;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return v.toFixed(2) + ' ' + u[i];
}

function macsecMaybeRewriteIface(cur, prevDefault, nextDefault) {
  const s = String(cur).trim();
  if (!s || s === prevDefault) return nextDefault;
  return cur;
}

// ponytail: secure RNG or nothing. Weak PRNG is not a key generator and
// a config builder that emits one is worse than a config builder that emits none.
function macsecRandomHex(byteLen) {
  const src = (window.crypto || window.msCrypto);
  if (!src || typeof src.getRandomValues !== 'function') return '';
  const buf = new Uint8Array(byteLen);
  src.getRandomValues(buf);
  let out = '';
  for (let i = 0; i < buf.length; i++) out += buf[i].toString(16).padStart(2, '0');
  return out;
}

function MacsecConfigBuilder({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  // --- navigation
  const [activeTab, setActiveTab] = usePersistentState('macsec:activeTab', initialData?.activeTab ?? 'builder');
  const [vendor,    setVendor]    = usePersistentState('macsec:vendor',    initialData?.vendor    ?? 'cisco_iosxe');

  // --- key mode
  const [keyMode, setKeyMode] = usePersistentState('macsec:keyMode', initialData?.keyMode ?? 'static_cak'); // 'static_cak' | 'dynamic_cak'

  // --- link / naming
  const ifaceSeed = (MACSEC_VENDOR_LIMITS[vendor] || MACSEC_VENDOR_LIMITS.cisco_iosxe).iface;
  const [iface,         setIface]         = usePersistentState('macsec:iface',      initialData?.iface ?? ifaceSeed);
  const [policyName,    setPolicyName]    = usePersistentState('macsec:policy',     initialData?.policyName    ?? 'MACSEC-POLICY');
  const [keychainName,  setKeychainName]  = usePersistentState('macsec:keychain',   initialData?.keychainName  ?? 'MACSEC-KC');

  // --- crypto parameters
  const [cipher,     setCipher]     = usePersistentState('macsec:cipher',      initialData?.cipher     ?? MACSEC_CIPHER_DEFAULT);
  const [ksPriority, setKsPriority] = usePersistentState('macsec:ks_priority', initialData?.ksPriority ?? '0');
  const [rekey,      setRekey]      = usePersistentState('macsec:rekey',       initialData?.rekey      ?? '3600');
  const [confOffset, setConfOffset] = usePersistentState('macsec:conf_offset', initialData?.confOffset ?? '0');
  const [includeSci, setIncludeSci] = usePersistentState('macsec:include_sci', initialData?.includeSci ?? true);
  const [replayWin,  setReplayWin]  = usePersistentState('macsec:replay_win',  initialData?.replayWin  ?? '0');
  const [failMode,   setFailMode]   = usePersistentState('macsec:fail_mode',   initialData?.failMode   ?? 'must_secure'); // 'must_secure' | 'should_secure'
  const [type6,      setType6]      = usePersistentState('macsec:type6',       true);   // emit key-encryption enabling commands as comments

  // --- Key Rotation Planner inputs
  const [lineRate,   setLineRate]   = usePersistentState('macsec:line_rate',   initialData?.lineRate   ?? '10');
  const [frameBytes, setFrameBytes] = usePersistentState('macsec:frame_bytes', initialData?.frameBytes ?? '64');

  // --- SECRETS. Plain useState on purpose: never written to window.toolStateCache,
  // never emitted in the share payload, gone the moment the tool unmounts.
  // ponytail: the cheapest way to not leak a key is to not store it
  const [cak, setCak] = useState('');
  const [ckn, setCkn] = useState('');

  // One-shot clamp hint
  const [clampedHint, setClampedHint] = useState(null);

  const cakHexLen = useMemo(() => {
    const c = MACSEC_CIPHERS.find(x => x.id === cipher) || MACSEC_CIPHERS[3];
    return c.bits / 4;               // 128-bit -> 32 hex digits, 256-bit -> 64
  }, [cipher]);

  const regenerateKeys = useCallback(() => {
    setCak(macsecRandomHex(cakHexLen / 2));
    setCkn(macsecRandomHex(MACSEC_CKN_HEX_LEN / 2));
  }, [cakHexLen]);

  useEffect(() => { if (!cak && !ckn) regenerateKeys(); }, []);   // dep [] — mount only

  // Cipher change alters the required CAK length. Regrow ONLY when the current CAK
  // is a key this tool generated at the previous length — never clobber a pasted key
  // of the correct new length.
  useEffect(() => {
    if (cak && cak.length !== cakHexLen) setCak(macsecRandomHex(cakHexLen / 2));
  }, [cakHexLen]);

  // Derived values and validation
  const cipherDef = useMemo(() => MACSEC_CIPHERS.find(c => c.id === cipher) || MACSEC_CIPHERS[3], [cipher]);
  const limits    = useMemo(() => MACSEC_VENDOR_LIMITS[vendor] || MACSEC_VENDOR_LIMITS.cisco_iosxe, [vendor]);
  const cmacAlgo  = cipherDef.bits === 256 ? 'AES_256_CMAC' : 'AES_128_CMAC';   // NX-OS spelling
  const cmacIosxe = cipherDef.bits === 256 ? 'aes-256-cmac' : 'aes-128-cmac';   // IOS-XE spelling
  const isHex     = (s) => /^[0-9a-fA-F]+$/.test(String(s));

  const selectVendor = (nextVendor) => {
    if (nextVendor === vendor) return;
    const prevDefault = (MACSEC_VENDOR_LIMITS[vendor] || MACSEC_VENDOR_LIMITS.cisco_iosxe).iface;
    const nextLimits = MACSEC_VENDOR_LIMITS[nextVendor] || MACSEC_VENDOR_LIMITS.cisco_iosxe;
    setIface(cur => macsecMaybeRewriteIface(cur, prevDefault, nextLimits.iface));

    const curRekey = Number(rekey);
    if (isFinite(curRekey) && String(rekey).trim() !== '') {
      const clamped = Math.max(nextLimits.rekeyMin, Math.min(nextLimits.rekeyMax, curRekey));
      if (clamped !== curRekey) {
        setRekey(String(clamped));
        setClampedHint({ from: curRekey, to: clamped });
      } else {
        setClampedHint(null);
      }
    }
    setVendor(nextVendor);
  };

  const handleRekeyChange = (val) => {
    setRekey(val);
    if (clampedHint) setClampedHint(null);
  };

  // configError validation
  const configError = useMemo(() => {
    if (!String(iface).trim()) return '';
    if (!String(policyName).trim() || !String(keychainName).trim()) {
      return t('macsec_config.err_no_name');
    }
    if (keyMode === 'static_cak') {
      if (!cak && !ckn) {
        return t('macsec_config.err_no_crypto');
      }
      if (cak && (!isHex(cak) || cak.length !== cakHexLen)) {
        return t('macsec_config.err_bad_cak', { len: cakHexLen });
      }
      if (ckn && (!isHex(ckn) || (ckn.length % 2 !== 0) || ckn.length < 2 || ckn.length > 64)) {
        return t('macsec_config.err_bad_ckn');
      }
    }
    const sKs = String(ksPriority).trim();
    if (sKs !== '' && (!/^\d+$/.test(sKs) || Number(sKs) < 0 || Number(sKs) > limits.ksPrioMax)) {
      return t('macsec_config.err_bad_ks_priority', { max: limits.ksPrioMax });
    }
    const sRekey = String(rekey).trim();
    if (sRekey !== '' && (!/^\d+$/.test(sRekey) || Number(sRekey) < limits.rekeyMin || Number(sRekey) > limits.rekeyMax)) {
      return t('macsec_config.err_bad_rekey', { min: limits.rekeyMin, max: limits.rekeyMax });
    }
    const sWin = String(replayWin).trim();
    if (sWin !== '' && (!/^\d+$/.test(sWin) || Number(sWin) < 0)) {
      return t('macsec_config.err_bad_replay');
    }
    return '';
  }, [iface, policyName, keychainName, keyMode, cak, ckn, cakHexLen, ksPriority, limits, rekey, replayWin, t]);

  // rekeyError validation
  const rekeyError = useMemo(() => {
    const sRekey = String(rekey).trim();
    if (sRekey !== '' && (!/^\d+$/.test(sRekey) || Number(sRekey) < limits.rekeyMin || Number(sRekey) > limits.rekeyMax)) {
      return t('macsec_config.err_bad_rekey', { min: limits.rekeyMin, max: limits.rekeyMax });
    }
    const sFrame = String(frameBytes).trim();
    if (sFrame !== '' && (!/^\d+$/.test(sFrame) || Number(sFrame) < 64 || Number(sFrame) > 9216)) {
      return t('macsec_config.err_bad_frame', { min: 64, max: 9216 });
    }
    return '';
  }, [rekey, limits, frameBytes, t]);

  // rekeyResult
  const rekeyResult = useMemo(() => {
    if (rekeyError) return null;
    const sFrame = String(frameBytes).trim();
    const sRekey = String(rekey).trim();
    if (!sFrame || !sRekey) return null;
    const frame = Number(sFrame);
    if (!isFinite(frame) || frame < 64 || frame > 9216) return null;
    const configured = Number(sRekey);
    if (!isFinite(configured) || configured < limits.rekeyMin || configured > limits.rekeyMax) return null;

    const rateObj = MACSEC_RATES.find(r => r.id === lineRate) || MACSEC_RATES[1];
    const bps = rateObj.bps;
    const xpn = cipherDef.xpn;
    const pnBits = xpn ? 64 : 32;
    const wireBytes = macsecWireBytes(frame, includeSci);
    const fps = macsecFrameRate(bps, frame, includeSci);
    const pnSpace = macsecPnSpace(xpn);
    const exhaustSeconds = macsecPnExhaustSeconds(bps, frame, includeSci, xpn);
    const exhaustSeconds32 = macsecPnExhaustSeconds(bps, frame, includeSci, false);
    const exhaustSeconds64 = macsecPnExhaustSeconds(bps, frame, includeSci, true);
    const recommended = macsecRecommendedRekey(exhaustSeconds, limits.rekeyMin, limits.rekeyMax);
    const framesPerSak = configured * fps;
    const pnUsedPct = (framesPerSak / pnSpace) * 100;
    const bytesPerSak = (configured * bps) / 8;
    const saksPerDay = 86400 / configured;

    return {
      rateLabel: rateObj.label,
      bps,
      frame,
      wireBytes,
      fps,
      xpn,
      pnBits,
      pnSpace,
      exhaustSeconds,
      exhaustSeconds32,
      exhaustSeconds64,
      recommended,
      configured,
      framesPerSak,
      pnUsedPct,
      bytesPerSak,
      saksPerDay,
    };
  }, [rekeyError, frameBytes, rekey, lineRate, includeSci, cipherDef, limits]);

  // Generated configuration
  const generatedConfig = useMemo(() => {
    if (configError) return '';
    if (!String(iface).trim() || !String(policyName).trim() || !String(keychainName).trim()) return '';
    if (String(rekey).trim() === '' || String(ksPriority).trim() === '' || String(replayWin).trim() === '') return '';
    if (keyMode === 'static_cak' && (!cak || !ckn)) return '';

    const lines = [];
    const push = (line) => lines.push(line);
    const vendorCipher = cipherDef[vendor === 'cisco_iosxe' ? 'iosxe' : vendor === 'cisco_nxos' ? 'nxos' : 'junos'];
    const pFail = failMode === 'must_secure' ? 'must-secure' : 'should-secure';

    if (vendor === 'cisco_iosxe') {
      if (keyMode === 'static_cak') {
        push(`! ${t('macsec_config.cmt_iosxe_header')}`);
        push(`! ${t('macsec_config.cmt_cak_plaintext')}`);
        if (cipherDef.id !== 'gcm_aes_128') push(`! ${t('macsec_config.cmt_iosxe_license')}`);
        if (type6) {
          push(`! ${t('macsec_config.cmt_iosxe_type6')}`);
          push('key config-key password-encrypt');
          push('password encryption aes');
        }
        push('!');
        push(`key chain ${keychainName} macsec`);
        push(` key ${ckn}`);
        push(`  cryptographic-algorithm ${cmacIosxe}`);
        push(`  key-string ${cak}`);
        push('  lifetime local 00:00:00 Jan 1 2026 infinite');
        push('!');
        push(`mka policy ${policyName}`);
        push(` key-server priority ${ksPriority}`);
        push(` macsec-cipher-suite ${vendorCipher}`);
        push(` confidentiality-offset ${confOffset}`);
        push(` sak-rekey interval ${rekey}`);
        // IOS-XE includes SCI in SecTAG by default on network-link interfaces (no dedicated CLI command)
        push('!');
        push(`interface ${iface}`);
        push(' macsec network-link');
        push(` mka policy ${policyName}`);
        push(` mka pre-shared-key key-chain ${keychainName}`);
        push(` macsec access-control ${pFail}`);
        push(` macsec replay-protection window-size ${replayWin}`);
        push('!');
        push(`! ${t('macsec_config.cmt_iosxe_verify')}`);
        push('! show mka sessions detail');
        push(`! show macsec interface ${iface}`);
      } else {
        push(`! ${t('macsec_config.cmt_iosxe_header')}`);
        push(`! ${t('macsec_config.cmt_dynamic_iosxe')}`);
        push(`! ${t('macsec_config.cmt_dynamic_see_dot1x')}`);
        push('!');
        push(`mka policy ${policyName}`);
        push(` key-server priority ${ksPriority}`);
        push(` macsec-cipher-suite ${vendorCipher}`);
        push(` confidentiality-offset ${confOffset}`);
        push(` sak-rekey interval ${rekey}`);
        // IOS-XE includes SCI in SecTAG by default on point-to-point links (no dedicated CLI command)
        push('!');
        push(`interface ${iface}`);
        push(' macsec');
        push(` mka policy ${policyName}`);
        push(' authentication port-control auto');
        push(' dot1x pae both');
        push(` macsec access-control ${pFail}`);
        push('!');
        push(`! ${t('macsec_config.cmt_iosxe_verify')}`);
        push('! show mka sessions detail');
        push(`! show macsec interface ${iface}`);
      }
    } else if (vendor === 'cisco_nxos') {
      if (keyMode === 'static_cak') {
        push(`! ${t('macsec_config.cmt_nxos_header')}`);
        push(`! ${t('macsec_config.cmt_cak_plaintext')}`);
        push('feature macsec');
        if (type6) {
          push(`! ${t('macsec_config.cmt_nxos_type6')}`);
          push('feature password encryption aes');
          push('key config-key ascii');
        }
        push('!');
        push(`key chain ${keychainName} macsec`);
        push(`  key ${ckn}`);
        push(`    key-octet-string ${cak} cryptographic-algorithm ${cmacAlgo}`);
        push('!');
        push(`macsec policy ${policyName}`);
        push(`  cipher-suite ${vendorCipher}`);
        push(`  key-server-priority ${ksPriority}`);
        push(`  window-size ${replayWin}`);
        push(`  conf-offset CONF-OFFSET-${confOffset}`);
        push(`  security-policy ${pFail}`);
        push(`  sak-expiry-time ${rekey}`);
        push(`  ${includeSci ? 'include-sci' : 'no include-sci'}`);
        push('!');
        push(`interface ${iface}`);
        push(`  macsec keychain ${keychainName} policy ${policyName}`);
        push('!');
        push(`! ${t('macsec_config.cmt_nxos_verify')}`);
        push(`! show macsec mka session interface ${iface}`);
        push('! show macsec mka summary');
      } else {
        push(`! ${t('macsec_config.cmt_nxos_header')}`);
        push(`! ${t('macsec_config.cmt_dynamic_nxos_unsupported')}`);
        push(`! ${t('macsec_config.cmt_dynamic_see_dot1x')}`);
      }
    } else if (vendor === 'junos') {
      if (keyMode === 'static_cak') {
        push(`# ${t('macsec_config.cmt_junos_header')}`);
        push(`# ${t('macsec_config.cmt_cak_plaintext')}`);
        push(`set security macsec connectivity-association ${policyName} security-mode static-cak`);
        push(`set security macsec connectivity-association ${policyName} pre-shared-key ckn ${ckn}`);
        push(`set security macsec connectivity-association ${policyName} pre-shared-key cak ${cak}`);
        push(`set security macsec connectivity-association ${policyName} cipher-suite ${vendorCipher}`);
        push(`set security macsec connectivity-association ${policyName} encryption`);
        push(`set security macsec connectivity-association ${policyName} offset ${confOffset}`);
        if (includeSci) {
          push(`set security macsec connectivity-association ${policyName} include-sci`);
        }
        push(`set security macsec connectivity-association ${policyName} replay-protect replay-window-size ${replayWin}`);
        push(`set security macsec connectivity-association ${policyName} mka key-server-priority ${ksPriority}`);
        push(`set security macsec connectivity-association ${policyName} mka transmit-interval 2000`);
        push(`set security macsec connectivity-association ${policyName} sak-rekey-interval ${rekey}`);
        push(`set security macsec connectivity-association ${policyName} ${pFail}`);
        push(`set security macsec interfaces ${iface} connectivity-association ${policyName}`);
        push('#');
        push(`# ${t('macsec_config.cmt_junos_fips')}`);
        push(`# ${t('macsec_config.cmt_junos_verify')}`);
        push('# show security macsec connections');
        push(`# show security macsec statistics interface ${iface}`);
      } else {
        push(`# ${t('macsec_config.cmt_junos_header')}`);
        push(`# ${t('macsec_config.cmt_dynamic_junos_unverified')}`);
        push(`# ${t('macsec_config.cmt_dynamic_see_dot1x')}`);
      }
    }

    return lines.join('\n');
  }, [configError, iface, policyName, keychainName, rekey, ksPriority, replayWin, keyMode, cak, ckn, cipherDef, vendor, failMode, type6, cmacIosxe, confOffset, includeSci, cmacAlgo, t]);

  // Hints
  const hints = useMemo(() => {
    const list = [];
    if (keyMode === 'static_cak') {
      list.push({ level: 'red', key: 'hint_cak_plaintext' });
    }
    if (keyMode === 'dynamic_cak' && vendor !== 'cisco_iosxe') {
      list.push({ level: 'red', key: 'hint_dynamic_unsupported' });
    }
    if (!cipherDef.xpn && rekeyResult && rekeyResult.recommended === null) {
      list.push({ level: 'red', key: 'hint_xpn_required', vars: { rate: rekeyResult.rateLabel, secs: rekeyResult.exhaustSeconds.toFixed(1) } });
    }
    if (!cipherDef.xpn && rekeyResult && rekeyResult.pnUsedPct > 100) {
      list.push({ level: 'red', key: 'hint_pn_wraps_before_rekey', vars: { pct: rekeyResult.pnUsedPct.toFixed(1), secs: rekeyResult.exhaustSeconds.toFixed(1) } });
    }
    if (!cipherDef.xpn && rekeyResult && rekeyResult.pnUsedPct > 50 && rekeyResult.pnUsedPct <= 100) {
      list.push({ level: 'yellow', key: 'hint_pn_tight', vars: { pct: rekeyResult.pnUsedPct.toFixed(1) } });
    }
    if (!cipherDef.xpn && !list.some(h => ['hint_xpn_required', 'hint_pn_wraps_before_rekey', 'hint_pn_tight'].includes(h.key))) {
      list.push({ level: 'yellow', key: 'hint_no_xpn' });
    }
    if (cipherDef.bits === 128) {
      list.push({ level: 'yellow', key: 'hint_aes128' });
    }
    if (failMode === 'should_secure') {
      list.push({ level: 'yellow', key: 'hint_should_secure' });
    }
    if (Number(replayWin) === 0) {
      list.push({ level: 'yellow', key: 'hint_replay_strict' });
    }
    if (Number(confOffset) > 0) {
      list.push({ level: 'yellow', key: 'hint_conf_offset', vars: { off: confOffset } });
    }
    if (Number(ksPriority) === 0) {
      list.push({ level: 'yellow', key: 'hint_ks_priority_zero' });
    }
    if (ckn.length !== 64 && vendor === 'junos') {
      list.push({ level: 'yellow', key: 'hint_ckn_junos_64' });
    }
    if (clampedHint) {
      list.push({ level: 'yellow', key: 'hint_rekey_clamped', vars: { from: clampedHint.from, to: clampedHint.to } });
    }
    if (list.length === 0 && generatedConfig) {
      list.push({ level: 'green', key: 'hint_ok' });
    }
    return list;
  }, [keyMode, vendor, cipherDef, rekeyResult, failMode, replayWin, confOffset, ksPriority, ckn, clampedHint, generatedConfig]);

  // Download .txt
  const downloadTxt = useCallback(() => {
    const blob = new Blob([generatedConfig + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `macsec-${vendor}-${policyName}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generatedConfig, vendor, policyName]);

  // Rekey Copy All TSV text
  const rekeyCopyAllText = useMemo(() => {
    if (!rekeyResult) return '';
    const r = rekeyResult;
    const formatPct = (pct) => (pct < 0.001 ? pct.toExponential(3) + '%' : pct.toFixed(4) + '%');
    const recText = r.recommended !== null ? `${r.recommended} s` : t('macsec_config.res_recommended_none');
    const rows = [
      `${t('macsec_config.col_metric')}\t${t('macsec_config.col_value')}`,
      `${t('macsec_config.res_rate')}\t${r.rateLabel}`,
      `${t('macsec_config.res_frame')}\t${r.frame} B`,
      `${t('macsec_config.res_wire_bytes')}\t${r.wireBytes} B`,
      `${t('macsec_config.res_fps')}\t${r.fps.toLocaleString(undefined, { maximumFractionDigits: 0 })} fps`,
      `${t('macsec_config.res_pn_bits')}\t${r.pnBits}-bit`,
      `${t('macsec_config.res_exhaust')}\t${macsecFormatDuration(r.exhaustSeconds)}`,
    ];
    if (r.xpn) {
      rows.push(`${t('macsec_config.res_exhaust_32')}\t${macsecFormatDuration(r.exhaustSeconds32)}`);
    } else {
      rows.push(`${t('macsec_config.res_exhaust_64')}\t${macsecFormatDuration(r.exhaustSeconds64)}`);
    }
    rows.push(`${t('macsec_config.res_recommended')}\t${recText}`);
    rows.push(`${t('macsec_config.res_configured')}\t${r.configured} s`);
    rows.push(`${t('macsec_config.res_pn_used')}\t${formatPct(r.pnUsedPct)}`);
    rows.push(`${t('macsec_config.res_bytes_per_sak')}\t${macsecFormatBytes(r.bytesPerSak)}`);
    rows.push(`${t('macsec_config.res_saks_per_day')}\t${r.saksPerDay.toFixed(1)}`);
    return rows.join('\n');
  }, [rekeyResult, t]);

  // Nav sync: apply-down and report-up
  const skipNavReport = useRef(false);

  useEffect(() => {                                    // apply-down
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
  }, [initialData]);                                   // dep = [initialData] ONLY

  useEffect(() => {                                    // report-up
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);                                     // NEVER add initialData here

  // Share payload
  useEffect(() => {
    // ponytail: CAK and CKN are deliberately excluded — a share URL is a public artefact
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'macsec-config',
      activeTab, vendor, keyMode,
      iface, policyName, keychainName,
      cipher, ksPriority, rekey, confOffset, includeSci, replayWin, failMode,
      lineRate, frameBytes,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [activeTab, vendor, keyMode, iface, policyName, keychainName, cipher, ksPriority, rekey, confOffset, includeSci, replayWin, failMode, lineRate, frameBytes, onShare]);

  const kayWarningKeys = [
    'kay_election',
    'kay_eapol',
    'kay_hitless',
    'kay_delay_protection',
    'kay_lag',
    'kay_timeout',
    'kay_counters',
  ];

  return (
    <div className="fadein">
      {/* 1. Title Card */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">{t('macsec_config.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {t('macsec_config.subtitle')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {MACSEC_TABS.map(tabId => (
            <button
              key={tabId}
              className={`btn btn-sm ${activeTab === tabId ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12 }}
              onClick={() => setActiveTab(tabId)}
            >
              {t('macsec_config.tab_' + tabId)}
            </button>
          ))}
        </div>
      </div>

      {/* 2. Builder Tab */}
      {activeTab === 'builder' && (
        <div>
          {/* Vendor segmented row */}
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12, flexWrap: 'wrap' }}>
            {MACSEC_VENDORS.map(vId => (
              <button
                key={vId}
                className={`btn btn-sm ${vendor === vId ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => selectVendor(vId)}
                style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none', margin: '2px 2px 0 0' }}
              >
                {t('macsec_config.vendor_' + vId)}
              </button>
            ))}
          </div>

          {/* Link card */}
          <div className="card">
            <div className="card-title">{t('macsec_config.section_link')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('macsec_config.iface')}</label>
                <input className="input" value={iface} onChange={e => setIface(e.target.value)} />
                <div className="hint">{t('macsec_config.iface_hint')}</div>
              </div>
              <div className="field">
                <label className="label">{t('macsec_config.policy_name')}</label>
                <input className="input" value={policyName} onChange={e => setPolicyName(e.target.value)} />
                <div className="hint">{t('macsec_config.policy_name_hint')}</div>
              </div>
              <div className="field">
                <label className="label">{t('macsec_config.keychain_name')}</label>
                <input className="input" value={keychainName} onChange={e => setKeychainName(e.target.value)} />
                <div className="hint">{t('macsec_config.keychain_name_hint')}</div>
              </div>
            </div>
          </div>

          {/* Key Mode card */}
          <div className="card">
            <div className="card-title">{t('macsec_config.section_keymode')}</div>
            <div className="field">
              <label className="label">{t('macsec_config.key_mode')}</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
                <button
                  className={`btn btn-sm ${keyMode === 'static_cak' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setKeyMode('static_cak')}
                >
                  {t('macsec_config.key_mode_static')}
                </button>
                <button
                  className={`btn btn-sm ${keyMode === 'dynamic_cak' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setKeyMode('dynamic_cak')}
                >
                  {t('macsec_config.key_mode_dynamic')}
                </button>
              </div>
              <div className="hint">{t('macsec_config.mka_always_note')}</div>
            </div>
          </div>

          {/* Key Material card (static_cak only) */}
          {keyMode === 'static_cak' && (
            <div className="card">
              <div className="card-title">{t('macsec_config.section_keys')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--panel)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 12 }}>
                <span className="badge badge-red">{t('macsec_config.level_red')}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('macsec_config.warn_cak_plaintext')}</span>
              </div>

              <div className="field">
                <label className="label">{t('macsec_config.ckn')}</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input"
                    type="text"
                    value={ckn}
                    onChange={e => setCkn(e.target.value)}
                    style={{ fontFamily: 'var(--mono)' }}
                  />
                  <CopyBtn text={ckn} label="copy" id="macsec-ckn-copy" />
                </div>
                <div className="hint">{t('macsec_config.ckn_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('macsec_config.cak')}</label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    className="input"
                    type="text"
                    value={cak}
                    onChange={e => setCak(e.target.value)}
                    style={{ fontFamily: 'var(--mono)' }}
                  />
                  <CopyBtn text={cak} label="copy" id="macsec-cak-copy" />
                </div>
                <div className="hint">{t('macsec_config.cak_hint', { len: cakHexLen })}</div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                <button className="btn btn-sm btn-primary" onClick={regenerateKeys}>
                  {t('macsec_config.key_regenerate')}
                </button>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={type6}
                    onChange={e => setType6(e.target.checked)}
                  />
                  {t('macsec_config.type6_label')}
                </label>
              </div>
              <div className="hint" style={{ marginTop: 6 }}>{t('macsec_config.type6_hint')}</div>
              <div className="hint">{t('macsec_config.key_entropy', { bits: cipherDef.bits })}</div>
              <div className="hint">{t('macsec_config.key_never_shared')}</div>
            </div>
          )}

          {/* Crypto Parameters card */}
          <div className="card">
            <div className="card-title">{t('macsec_config.section_crypto')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('macsec_config.cipher')}</label>
                <select className="select" value={cipher} onChange={e => setCipher(e.target.value)}>
                  {MACSEC_CIPHERS.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.id.toUpperCase().replace(/_/g, '-')} ({c.bits}-bit{c.xpn ? ', XPN' : ''})
                    </option>
                  ))}
                </select>
                <div className="hint">{t('macsec_config.cipher_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('macsec_config.ks_priority')}</label>
                <input className="input" value={ksPriority} onChange={e => setKsPriority(e.target.value)} />
                <div className="hint">{t('macsec_config.ks_priority_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('macsec_config.rekey')}</label>
                <input className="input" value={rekey} onChange={e => handleRekeyChange(e.target.value)} />
                <div className="hint">
                  {t('macsec_config.rekey_hint')} {t('macsec_config.rekey_range_hint', { vendor: t('macsec_config.vendor_' + vendor), min: limits.rekeyMin, max: limits.rekeyMax })}
                </div>
              </div>

              <div className="field">
                <label className="label">{t('macsec_config.conf_offset')}</label>
                <select className="select" value={confOffset} onChange={e => setConfOffset(e.target.value)}>
                  {MACSEC_CONF_OFFSETS.map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
                <div className="hint">{t('macsec_config.conf_offset_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('macsec_config.replay_win')}</label>
                <input className="input" value={replayWin} onChange={e => setReplayWin(e.target.value)} />
                <div className="hint">{t('macsec_config.replay_win_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('macsec_config.fail_mode')}</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <button
                    className={`btn btn-sm ${failMode === 'must_secure' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setFailMode('must_secure')}
                  >
                    {t('macsec_config.fail_must')}
                  </button>
                  <button
                    className={`btn btn-sm ${failMode === 'should_secure' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setFailMode('should_secure')}
                  >
                    {t('macsec_config.fail_should')}
                  </button>
                </div>
                <div className="hint">{t('macsec_config.fail_mode_hint')}</div>
              </div>
            </div>

            <div className="field" style={{ marginTop: 8 }}>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={includeSci}
                  onChange={e => setIncludeSci(e.target.checked)}
                />
                {t('macsec_config.include_sci')}
              </label>
              <div className="hint">{t('macsec_config.include_sci_hint')}</div>
            </div>
          </div>

          <Err msg={configError} />

          {/* Config Output card */}
          {!configError && generatedConfig && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <div className="card-title" style={{ margin: 0 }}>{t('macsec_config.section_output')}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <CopyBtn text={generatedConfig} label="copy" id="macsec-cfg-copy" />
                  <button className="btn btn-sm btn-ghost" onClick={downloadTxt}>
                    {t('macsec_config.export_txt')}
                  </button>
                </div>
              </div>

              {keyMode === 'static_cak' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', background: 'var(--panel)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', marginBottom: 8 }}>
                  <span className="badge badge-red">{t('macsec_config.level_red')}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('macsec_config.warn_cak_in_output')}</span>
                </div>
              )}

              <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius)', whiteSpace: 'pre-wrap', border: '1px solid var(--border)' }}>
                {generatedConfig.split('\n').map((line, i) => (
                  <span key={i} style={/^\s*[!#]/.test(line) ? { color: 'var(--dim)' } : undefined}>
                    {line}{'\n'}
                  </span>
                ))}
              </pre>

              <div className="hint" style={{ marginTop: 8 }}>{t('macsec_config.share_note')}</div>
            </div>
          )}

          {/* Review hints block */}
          {hints.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">{t('macsec_config.section_hints')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hints.map((h, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge badge-${h.level}`}>{t('macsec_config.level_' + h.level)}</span>
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>
                      {t('macsec_config.' + h.key, h.vars)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Key Rotation Planner Tab */}
      {activeTab === 'rekey' && (
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: 12 }}>
              {t('macsec_config.rekey_intro')}
            </div>

            <div className="card-title">{t('macsec_config.section_rekey_inputs')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('macsec_config.line_rate')}</label>
                <select className="select" value={lineRate} onChange={e => setLineRate(e.target.value)}>
                  {MACSEC_RATES.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
              </div>

              <div className="field">
                <label className="label">{t('macsec_config.frame_size')}</label>
                <input className="input" value={frameBytes} onChange={e => setFrameBytes(e.target.value)} />
                <div className="hint">{t('macsec_config.frame_size_hint')}</div>
              </div>
            </div>

            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8, padding: '8px 10px', background: 'var(--panel)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              {t('macsec_config.rekey_from_builder_note')} ({cipherDef.id.toUpperCase().replace(/_/g, '-')}, {includeSci ? t('macsec_config.sci_on') : t('macsec_config.sci_off')}, {rekey} s)
            </div>
          </div>

          <Err msg={rekeyError} />

          {/* Rekey Result card */}
          {!rekeyError && rekeyResult && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div className="card-title" style={{ margin: 0 }}>{t('macsec_config.section_rekey_result')}</div>
                <CopyBtn text={rekeyCopyAllText} label="copy_all" id="macsec-rekey-copy-all" />
              </div>

              <div className="result-grid grid-mobile-1" style={{ marginBottom: 16 }}>
                <ResultItem
                  label={t('macsec_config.res_rate')}
                  value={rekeyResult.rateLabel}
                />
                <ResultItem
                  label={t('macsec_config.res_frame')}
                  value={`${rekeyResult.frame} B`}
                />
                <ResultItem
                  label={t('macsec_config.res_wire_bytes')}
                  value={`${rekeyResult.wireBytes} B`}
                  sub={t('macsec_config.res_wire_breakdown', {
                    user: rekeyResult.frame,
                    sectag: includeSci ? MACSEC_SECTAG_SCI : MACSEC_SECTAG_NOSCI,
                    icv: MACSEC_ICV_BYTES,
                  })}
                />
                <ResultItem
                  label={t('macsec_config.res_fps')}
                  value={`${rekeyResult.fps.toLocaleString(undefined, { maximumFractionDigits: 0 })} fps`}
                />
                <ResultItem
                  label={t('macsec_config.res_pn_bits')}
                  value={`${rekeyResult.pnBits}-bit`}
                />
                <ResultItem
                  label={t('macsec_config.res_exhaust')}
                  value={macsecFormatDuration(rekeyResult.exhaustSeconds)}
                  accent
                />
                {rekeyResult.xpn ? (
                  <ResultItem
                    label={t('macsec_config.res_exhaust_32')}
                    value={macsecFormatDuration(rekeyResult.exhaustSeconds32)}
                  />
                ) : (
                  <ResultItem
                    label={t('macsec_config.res_exhaust_64')}
                    value={macsecFormatDuration(rekeyResult.exhaustSeconds64)}
                  />
                )}
                <ResultItem
                  label={t('macsec_config.res_recommended')}
                  value={rekeyResult.recommended !== null ? `${rekeyResult.recommended} s` : t('macsec_config.res_recommended_none')}
                  green={rekeyResult.recommended !== null}
                  red={rekeyResult.recommended === null}
                />
                <ResultItem
                  label={t('macsec_config.res_configured')}
                  value={`${rekeyResult.configured} s`}
                />
                <ResultItem
                  label={t('macsec_config.res_pn_used')}
                  value={rekeyResult.pnUsedPct < 0.001 ? rekeyResult.pnUsedPct.toExponential(3) + '%' : rekeyResult.pnUsedPct.toFixed(4) + '%'}
                  red={rekeyResult.pnUsedPct > 100}
                  yellow={rekeyResult.pnUsedPct > 50 && rekeyResult.pnUsedPct <= 100}
                />
                <ResultItem
                  label={t('macsec_config.res_bytes_per_sak')}
                  value={macsecFormatBytes(rekeyResult.bytesPerSak)}
                />
                <ResultItem
                  label={t('macsec_config.res_saks_per_day')}
                  value={rekeyResult.saksPerDay.toFixed(1)}
                />
              </div>

              {/* Filtered PN hints */}
              {hints.filter(h => ['hint_xpn_required', 'hint_pn_wraps_before_rekey', 'hint_pn_tight', 'hint_no_xpn'].includes(h.key)).map((h, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
                  <span className={`badge badge-${h.level}`}>{t('macsec_config.level_' + h.level)}</span>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>
                    {t('macsec_config.' + h.key, h.vars)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* KaY operational notes */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">{t('macsec_config.section_kay')}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
              {kayWarningKeys.map(k => (
                <li key={k} style={{ marginBottom: 6 }}>
                  {t('macsec_config.' + k)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {/* 4. Reference Tab */}
      {activeTab === 'reference' && (
        <div>
          {/* Block 1: MKA & CAK Origin */}
          <div className="card">
            <div className="card-title">{t('macsec_config.ref_static_cak')} {t('macsec_config.vs_connector')} {t('macsec_config.ref_dynamic_cak')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
              {t('macsec_config.ref_mka_note')}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('macsec_config.ref_col_aspect')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('macsec_config.ref_static_cak')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('macsec_config.ref_dynamic_cak')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['ref_row_key_source', 'ref_static_key_source', 'ref_dynamic_key_source'],
                    ['ref_row_configured_by', 'ref_static_configured_by', 'ref_dynamic_configured_by'],
                    ['ref_row_use', 'ref_static_use', 'ref_dynamic_use'],
                    ['ref_row_scaling', 'ref_static_scaling', 'ref_dynamic_scaling'],
                    ['ref_row_rotation', 'ref_static_rotation', 'ref_dynamic_rotation'],
                  ].map(([rowKey, staticKey, dynamicKey]) => (
                    <tr key={rowKey} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('macsec_config.' + rowKey)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('macsec_config.' + staticKey)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('macsec_config.' + dynamicKey)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Block 2: MACsec vs 802.1X vs IPsec */}
          <div className="card">
            <div className="card-title">{t('macsec_config.ref_compare_title')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('macsec_config.ref_col_aspect')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>MACsec</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>802.1X</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>IPsec</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['ref_row_layer', 'ref_macsec_layer', 'ref_dot1x_layer', 'ref_ipsec_layer'],
                    ['ref_row_protects', 'ref_macsec_protects', 'ref_dot1x_protects', 'ref_ipsec_protects'],
                    ['ref_row_scope', 'ref_macsec_scope', 'ref_dot1x_scope', 'ref_ipsec_scope'],
                    ['ref_row_hops', 'ref_macsec_hops', 'ref_dot1x_hops', 'ref_ipsec_hops'],
                    ['ref_row_keying', 'ref_macsec_keying', 'ref_dot1x_keying', 'ref_ipsec_keying'],
                    ['ref_row_hw', 'ref_macsec_hw', 'ref_dot1x_hw', 'ref_ipsec_hw'],
                    ['ref_row_not', 'ref_macsec_not', 'ref_dot1x_not', 'ref_ipsec_not'],
                  ].map(([rowKey, macsecKey, dot1xKey, ipsecKey]) => (
                    <tr key={rowKey} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('macsec_config.' + rowKey)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('macsec_config.' + macsecKey)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('macsec_config.' + dot1xKey)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('macsec_config.' + ipsecKey)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Block 3: Cipher Suites and XPN */}
          <div className="card">
            <div className="card-title">{t('macsec_config.ref_cipher_title')}</div>
            <div style={{ overflowX: 'auto', marginBottom: 12 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('macsec_config.ref_col_cipher')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('macsec_config.ref_col_key')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('macsec_config.ref_col_pn')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('macsec_config.ref_col_note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {MACSEC_CIPHERS.map(c => (
                    <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600, fontFamily: 'var(--mono)' }}>
                        {c.id.toUpperCase().replace(/_/g, '-')}
                      </td>
                      <td style={{ padding: '8px 10px' }}>{c.bits}-bit</td>
                      <td style={{ padding: '8px 10px' }}>{c.xpn ? '64-bit' : '32-bit'}</td>
                      <td style={{ padding: '8px 10px' }}>
                        {t('macsec_config.ref_cipher_note_' + (c.xpn ? 'xpn_' : '') + c.bits)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
              {t('macsec_config.ref_xpn_note')}
            </div>
          </div>

          {/* Block 4: Worked Example */}
          <div className="card">
            <div className="card-title">{t('macsec_config.ref_example_title')}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius)', lineHeight: 1.6, border: '1px solid var(--border)', color: 'var(--text)' }}>
              {t('macsec_config.ref_example')}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>
              {t('macsec_config.related')}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.MacsecConfigBuilder = MacsecConfigBuilder;
