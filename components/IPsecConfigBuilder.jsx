const { useState, useEffect, useCallback, useMemo, useRef } = React;

const IPSEC_VENDORS = ['cisco_iosxe', 'junos', 'strongswan', 'fortigate'];

// Per-vendor interface seeds. FortiGate / strongSwan do not consume tunnelIface
// (FortiGate names the tunnel from tunnelName; strongSwan is policy-based).
// strongSwan also ignores wanIface. Keep unused seeds so a later tab switch can
// still detect "untouched" and rewrite.
const IPSEC_VENDOR_DEFAULTS = {
  cisco_iosxe: { tunnelIface: 'Tunnel0', wanIface: 'GigabitEthernet0/0/0' },
  junos:       { tunnelIface: 'st0.0',   wanIface: 'ge-0/0/0' },
  strongswan:  { tunnelIface: 'Tunnel0', wanIface: 'GigabitEthernet0/0/0' },
  fortigate:   { tunnelIface: 'Tunnel0', wanIface: 'wan1' },
};

// canonical algorithm ids -> per-vendor tokens
// aead: true means integrity is folded into the cipher (AES-GCM); the integrity
// selector is then used as the IKEv2 PRF, not as a separate ESP auth algorithm.
const IPSEC_ENC = [
  { id: '3des',       bits: 168, aead: false, strength: 'legacy',
    cisco_p1: '3des',            cisco_ts: 'esp-3des',
    junos: '3des-cbc',           swan: '3des',        forti: '3des' },
  { id: 'aes128',     bits: 128, aead: false, strength: 'ok',
    cisco_p1: 'aes-cbc-128',     cisco_ts: 'esp-aes',
    junos: 'aes-128-cbc',        swan: 'aes128',      forti: 'aes128' },
  { id: 'aes256',     bits: 256, aead: false, strength: 'good',
    cisco_p1: 'aes-cbc-256',     cisco_ts: 'esp-aes 256',
    junos: 'aes-256-cbc',        swan: 'aes256',      forti: 'aes256' },
  { id: 'aes128gcm',  bits: 128, aead: true,  strength: 'good',
    cisco_p1: 'aes-gcm-128',     cisco_ts: 'esp-gcm',
    junos: 'aes-128-gcm',        swan: 'aes128gcm16', forti: 'aes128gcm' },
  { id: 'aes256gcm',  bits: 256, aead: true,  strength: 'good',
    cisco_p1: 'aes-gcm-256',     cisco_ts: 'esp-gcm 256',
    junos: 'aes-256-gcm',        swan: 'aes256gcm16', forti: 'aes256gcm' },
];

const IPSEC_INTEG = [
  { id: 'sha1',   strength: 'legacy',
    cisco_p1: 'sha1',   cisco_ts: 'esp-sha-hmac',     junos_ike: 'sha1',
    junos_esp: 'hmac-sha1-96',       swan: 'sha1',   forti: 'sha1' },
  { id: 'sha256', strength: 'good',
    cisco_p1: 'sha256', cisco_ts: 'esp-sha256-hmac',  junos_ike: 'sha-256',
    junos_esp: 'hmac-sha-256-128',   swan: 'sha256', forti: 'sha256' },
  { id: 'sha384', strength: 'good',
    cisco_p1: 'sha384', cisco_ts: 'esp-sha384-hmac',  junos_ike: 'sha-384',
    junos_esp: 'hmac-sha-384-192',   swan: 'sha384', forti: 'sha384' },
  { id: 'sha512', strength: 'good',
    cisco_p1: 'sha512', cisco_ts: 'esp-sha512-hmac',  junos_ike: 'sha-512',
    junos_esp: 'hmac-sha-512-256',   swan: 'sha512', forti: 'sha512' },
];

// DH / MODP-ECP groups. `swan` is the strongSwan proposal keyword.
const IPSEC_DH = [
  { id: '2',  bits: 1024, strength: 'legacy', swan: 'modp1024' },
  { id: '5',  bits: 1536, strength: 'legacy', swan: 'modp1536' },
  { id: '14', bits: 2048, strength: 'ok',     swan: 'modp2048' },
  { id: '15', bits: 3072, strength: 'good',   swan: 'modp3072' },
  { id: '16', bits: 4096, strength: 'good',   swan: 'modp4096' },
  { id: '19', bits: 256,  strength: 'good',   swan: 'ecp256' },
  { id: '20', bits: 384,  strength: 'good',   swan: 'ecp384' },
  { id: '21', bits: 521,  strength: 'good',   swan: 'ecp521' },
];

// Junos dh-group keyword is `group` + id, e.g. group19 — derive, do not table it.
// Cisco ikev2 proposal keyword is `group` + id. FortiGate `set dhgrp` is the bare id.

const IPSEC_PSK_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const IPSEC_PSK_LENGTHS = ['16', '24', '32', '48'];
const IPSEC_PSK_MIN = 8;          // hard validation floor
const IPSEC_PSK_RECOMMENDED = 20; // below this -> yellow hint, not an error
// ponytail: alnum-only sidesteps four quoting dialects; widen the charset when someone actually needs it

function ipsecParseList(s) {
  return String(s).split(/[,\n]/).map(x => x.trim()).filter(Boolean);
}

// returns { net, mask, wild, prefix, cidr, netInt, maskInt } or null
function ipsecCidr(s) {
  const c = IPv4.parseCIDR(String(s));
  if (c === null) return null;
  const maskInt = IPv4.mask(c.prefix);
  const netInt  = (c.ip & maskInt) >>> 0;
  return {
    net: IPv4.str(netInt),
    mask: IPv4.str(maskInt),
    wild: IPv4.str((~maskInt) >>> 0),
    prefix: c.prefix,
    cidr: `${IPv4.str(netInt)}/${c.prefix}`,
    netInt, maskInt,
  };
}

function ipsecStrengthKey(strength) {
  if (strength === 'legacy') return 'ipsec_config.strength_legacy';
  if (strength === 'ok') return 'ipsec_config.strength_ok';
  return 'ipsec_config.strength_good';
}

function ipsecHintBadgeKey(level) {
  if (level === 'red') return 'ipsec_config.strength_legacy';
  if (level === 'yellow') return 'ipsec_config.strength_ok';
  return 'ipsec_config.strength_good';
}

function ipsecJunosIf(tun) {
  const s = String(tun).trim();
  const dot = s.lastIndexOf('.');
  if (dot > 0) return { ifd: s.slice(0, dot), unit: s.slice(dot + 1) };
  return { ifd: s, unit: '0' };
}

// Rewrite an iface field on vendor change only when it is empty or still the
// previous vendor's default — never clobber a user-typed value.
function ipsecMaybeRewriteIface(cur, prevDefault, nextDefault) {
  const s = String(cur).trim();
  if (!s || s === prevDefault) return nextDefault;
  return cur;
}

function IPsecConfigBuilder({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const skipNavReport = useRef(false);

  // vendor tab (nav key is `vendor`)
  const [vendor, setVendor] = usePersistentState('ipsec:vendor', initialData?.vendor ?? 'cisco_iosxe');
  // 'cisco_iosxe' | 'junos' | 'strongswan' | 'fortigate'

  // --- endpoints
  const [tunnelName,    setTunnelName]    = usePersistentState('ipsec:tunnel_name',    initialData?.tunnelName ?? 'VPN-SITE-B');
  const [localIp,       setLocalIp]       = usePersistentState('ipsec:local_ip',       initialData?.localIp ?? '203.0.113.1');
  const [peerIp,        setPeerIp]        = usePersistentState('ipsec:peer_ip',        initialData?.peerIp ?? '198.51.100.1');
  const ifaceDefaults = IPSEC_VENDOR_DEFAULTS[vendor] || IPSEC_VENDOR_DEFAULTS.cisco_iosxe;
  const [wanIface,      setWanIface]      = usePersistentState('ipsec:wan_iface',      ifaceDefaults.wanIface);
  const [tunnelIface,   setTunnelIface]   = usePersistentState('ipsec:tunnel_iface',   ifaceDefaults.tunnelIface);
  const [tunnelIp,      setTunnelIp]      = usePersistentState('ipsec:tunnel_ip',      '10.255.255.1/30');
  const [localSubnets,  setLocalSubnets]  = usePersistentState('ipsec:local_subnets',  initialData?.localSubnets ?? '10.10.0.0/16');
  const [remoteSubnets, setRemoteSubnets] = usePersistentState('ipsec:remote_subnets', initialData?.remoteSubnets ?? '10.20.0.0/16');

  // --- IKEv2 (phase 1)
  const [ikeEnc,      setIkeEnc]      = usePersistentState('ipsec:ike_enc',      initialData?.ikeEnc ?? 'aes256');
  const [ikeInteg,    setIkeInteg]    = usePersistentState('ipsec:ike_integ',    initialData?.ikeInteg ?? 'sha256');
  const [ikeDh,       setIkeDh]       = usePersistentState('ipsec:ike_dh',       initialData?.ikeDh ?? '19');
  const [ikeLifetime, setIkeLifetime] = usePersistentState('ipsec:ike_lifetime', '86400');

  // --- ESP (phase 2)
  const [espEnc,      setEspEnc]      = usePersistentState('ipsec:esp_enc',      'aes256');
  const [espInteg,    setEspInteg]    = usePersistentState('ipsec:esp_integ',    'sha256');
  const [pfsEnabled,  setPfsEnabled]  = usePersistentState('ipsec:pfs',          true);
  const [pfsDh,       setPfsDh]       = usePersistentState('ipsec:pfs_dh',       'same');   // 'same' | '2'|'5'|'14'|'15'|'16'|'19'|'20'|'21'
  const [espLifetime, setEspLifetime] = usePersistentState('ipsec:esp_lifetime', '3600');

  // --- authentication
  const [authMethod, setAuthMethod] = usePersistentState('ipsec:auth',        initialData?.authMethod ?? 'psk'); // 'psk' | 'cert'
  const [psk,        setPsk]        = usePersistentState('ipsec:psk',         '');
  const [pskLen,     setPskLen]     = usePersistentState('ipsec:psk_len',     '32');   // '16'|'24'|'32'|'48'
  const [certLocal,  setCertLocal]  = usePersistentState('ipsec:cert_local',  'VPN-LOCAL-CERT');
  const [certCa,     setCertCa]     = usePersistentState('ipsec:cert_ca',     'VPN-CA');
  const [certPeerId, setCertPeerId] = usePersistentState('ipsec:cert_peer_id','vpn-site-b.example.net');

  const encDef    = IPSEC_ENC.find(e => e.id === ikeEnc)   || IPSEC_ENC[2];
  const espEncDef = IPSEC_ENC.find(e => e.id === espEnc)   || IPSEC_ENC[2];
  const integDef  = IPSEC_INTEG.find(i => i.id === ikeInteg) || IPSEC_INTEG[1];
  const espIntDef = IPSEC_INTEG.find(i => i.id === espInteg) || IPSEC_INTEG[1];
  const dhDef     = IPSEC_DH.find(d => d.id === ikeDh)     || IPSEC_DH[5];
  const effPfsDh  = pfsDh === 'same' ? ikeDh : pfsDh;
  const pfsDef    = IPSEC_DH.find(d => d.id === effPfsDh)  || dhDef;

  const locals  = ipsecParseList(localSubnets);
  const remotes = ipsecParseList(remoteSubnets);
  const tsPairs = [];
  locals.forEach(l => remotes.forEach(r => tsPairs.push({ l: ipsecCidr(l), r: ipsecCidr(r) })));

  const genError = useMemo(() => {
    if (!String(tunnelName).trim())           return t('ipsec_config.err_no_name');
    if (IPv4.parse(localIp) === null)         return t('ipsec_config.err_bad_local_ip');
    if (IPv4.parse(peerIp)  === null)         return t('ipsec_config.err_bad_peer_ip');
    if (String(localIp).trim() === String(peerIp).trim()) return t('ipsec_config.err_same_endpoints');
    if (vendor !== 'strongswan' && !String(wanIface).trim()) return t('ipsec_config.err_no_wan_iface');
    if ((vendor === 'cisco_iosxe' || vendor === 'junos') && !String(tunnelIface).trim()) return t('ipsec_config.err_no_tunnel_iface');
    if (!locals.length)                       return t('ipsec_config.err_no_local_subnet');
    if (!remotes.length)                      return t('ipsec_config.err_no_remote_subnet');
    const bad = [...locals, ...remotes].find(s => ipsecCidr(s) === null);
    if (bad)                                  return t('ipsec_config.err_bad_cidr', { cidr: bad });
    if (authMethod === 'psk') {
      if (String(psk).length < IPSEC_PSK_MIN) return t('ipsec_config.err_psk_short', { min: IPSEC_PSK_MIN });
    } else {
      if (!String(certLocal).trim())          return t('ipsec_config.err_no_cert_local');
      if (!String(certPeerId).trim())         return t('ipsec_config.err_no_cert_peer_id');
    }
    return '';
    // ponytail: an unnumbered VTI is a real deployment, not an error
  }, [tunnelName, localIp, peerIp, wanIface, vendor, tunnelIface, locals, remotes, authMethod, psk, certLocal, certPeerId, t]);

  const hints = useMemo(() => {
    // ponytail: a flat rule table instead of a scoring engine; add weights when someone asks for a score
    const out = [];
    if (ikeEnc === '3des' || espEnc === '3des') out.push({ level: 'red', key: 'ipsec_config.hint_3des' });
    if (dhDef.strength === 'legacy' || pfsDef.strength === 'legacy') out.push({ level: 'red', key: 'ipsec_config.hint_weak_dh' });
    if (ikeInteg === 'sha1' || espInteg === 'sha1') out.push({ level: 'red', key: 'ipsec_config.hint_sha1' });
    if (!pfsEnabled) out.push({ level: 'yellow', key: 'ipsec_config.hint_no_pfs' });
    if (encDef.bits === 128 || espEncDef.bits === 128) out.push({ level: 'yellow', key: 'ipsec_config.hint_aes128' });
    if (authMethod === 'psk' && String(psk).length > 0 && String(psk).length < IPSEC_PSK_RECOMMENDED) {
      out.push({ level: 'yellow', key: 'ipsec_config.hint_psk_weak' });
    }
    if (parseInt(ikeLifetime, 10) > 86400) out.push({ level: 'yellow', key: 'ipsec_config.hint_ike_lifetime_long' });
    if (parseInt(espLifetime, 10) > 28800) out.push({ level: 'yellow', key: 'ipsec_config.hint_esp_lifetime_long' });
    if (encDef.aead) out.push({ level: 'yellow', key: 'ipsec_config.hint_aead_prf' });
    if (espEncDef.aead && vendor === 'cisco_iosxe') out.push({ level: 'yellow', key: 'ipsec_config.hint_gcm_ios' });
    if (ikeDh === '21' || effPfsDh === '21') out.push({ level: 'yellow', key: 'ipsec_config.hint_dh21_forti' });
    if (ikeEnc === '3des' && vendor === 'fortigate') out.push({ level: 'red', key: 'ipsec_config.hint_3des_fortios7' });
    if (out.length === 0) out.push({ level: 'green', key: 'ipsec_config.hint_ok' });
    return out;
  }, [ikeEnc, espEnc, dhDef, pfsDef, ikeInteg, espInteg, pfsEnabled, encDef, espEncDef, authMethod, psk, ikeLifetime, espLifetime, vendor, ikeDh, effPfsDh]);

  const generatePsk = useCallback(() => {
    // ponytail: rejection sampling is two extra characters of code and removes the modulo bias outright
    const n = parseInt(pskLen, 10) || 32;
    const out = [];
    const buf = new Uint8Array(n * 2);
    while (out.length < n) {
      (window.crypto || window.msCrypto).getRandomValues(buf);
      for (let i = 0; i < buf.length && out.length < n; i++) {
        if (buf[i] < 248) out.push(IPSEC_PSK_CHARS[buf[i] % 62]); // 248 = 256 - (256 % 62): reject the biased tail
      }
    }
    setPsk(out.join(''));
  }, [pskLen, setPsk]);

  const generatedConfig = useMemo(() => {
    if (genError) return '';
    if (IPSEC_VENDORS.indexOf(vendor) < 0) return '';

    const lines = [];
    const push = (s) => lines.push(s);
    const name = String(tunnelName).trim();
    const wan = String(wanIface).trim();
    const tun = String(tunnelIface).trim();
    const ikeLife = String(ikeLifetime).trim() || '86400';
    const espLife = String(espLifetime).trim() || '3600';
    const dh = dhDef.id;
    const pfsGrp = pfsDef.id;
    const isPsk = authMethod !== 'cert';
    const tunCidr = ipsecCidr(tunnelIp);
    const tunHost = String(tunnelIp).split('/')[0].trim();
    const localTs = locals.map(s => (ipsecCidr(s) && ipsecCidr(s).cidr) || s).join(',');
    const remoteTs = remotes.map(s => (ipsecCidr(s) && ipsecCidr(s).cidr) || s).join(',');
    const fortiP1 = encDef.aead    ? encDef.forti    : `${encDef.forti}-${integDef.forti}`;
    const fortiP2 = espEncDef.aead ? espEncDef.forti : `${espEncDef.forti}-${espIntDef.forti}`;
    const ikeProposal = encDef.aead
      ? `${encDef.swan}-prf${integDef.swan}-${dhDef.swan}`
      : `${encDef.swan}-${integDef.swan}-${dhDef.swan}`;
    let espProposal;
    if (espEncDef.aead) {
      espProposal = pfsEnabled ? `${espEncDef.swan}-${pfsDef.swan}` : espEncDef.swan;
    } else {
      espProposal = pfsEnabled
        ? `${espEncDef.swan}-${espIntDef.swan}-${pfsDef.swan}`
        : `${espEncDef.swan}-${espIntDef.swan}`;
    }

    if (vendor === 'cisco_iosxe') {
      push(`! ${t('ipsec_config.cmt_cisco')}`);
      push(`! ${t('ipsec_config.cmt_cisco_vti')}`);
      push('!');
      push(`crypto ikev2 proposal ${name}-PROP`);
      push(` encryption ${encDef.cisco_p1}`);
      if (encDef.aead) {
        push(` prf ${integDef.cisco_p1}`);
      } else {
        push(` integrity ${integDef.cisco_p1}`);
      }
      push(` group ${dh}`);
      push('!');
      push(`crypto ikev2 policy ${name}-POL`);
      push(` proposal ${name}-PROP`);
      push('!');
      if (isPsk) {
        push(`crypto ikev2 keyring ${name}-KR`);
        push(` peer ${name}`);
        push(`  address ${peerIp} 255.255.255.255`);
        push(`  pre-shared-key ${psk}`);
        push(' !');
        push('!');
      }
      push(`crypto ikev2 profile ${name}-PROF`);
      push(` match identity remote address ${peerIp} 255.255.255.255`);
      push(` identity local address ${localIp}`);
      if (isPsk) {
        push(' authentication remote pre-share');
        push(' authentication local pre-share');
        push(` keyring local ${name}-KR`);
      } else {
        push(' authentication remote rsa-sig');
        push(' authentication local rsa-sig');
        push(` pki trustpoint ${certLocal}`);
      }
      push(` lifetime ${ikeLife}`);
      push(' dpd 30 5 periodic'); // ponytail: a fixed DPD line beats a checkbox nobody unticks
      push('!');
      if (espEncDef.aead) {
        push(`crypto ipsec transform-set ${name}-TS ${espEncDef.cisco_ts}`);
      } else {
        push(`crypto ipsec transform-set ${name}-TS ${espEncDef.cisco_ts} ${espIntDef.cisco_ts}`);
      }
      push(' mode tunnel');
      push('!');
      push(`crypto ipsec profile ${name}-IPSEC`);
      push(` set transform-set ${name}-TS`);
      if (pfsEnabled) push(` set pfs group${pfsGrp}`);
      push(` set security-association lifetime seconds ${espLife}`);
      push(` set ikev2-profile ${name}-PROF`);
      push('!');
      push(`interface ${tun}`);
      push(` description ${name}`);
      if (tunCidr && IPv4.parse(tunHost) !== null) {
        push(` ip address ${tunHost} ${tunCidr.mask}`);
      } else {
        push(`! ${t('ipsec_config.cmt_tunnel_ip_missing')}`);
      }
      push(` tunnel source ${wan}`);
      push(` tunnel destination ${peerIp}`);
      push(' tunnel mode ipsec ipv4');
      push(` tunnel protection ipsec profile ${name}-IPSEC`);
      push('!');
      push(`! ${t('ipsec_config.cmt_cisco_routes')}`);
      remotes.forEach(r => {
        const c = ipsecCidr(r);
        if (c) push(`ip route ${c.net} ${c.mask} ${tun}`);
      });
      if (!isPsk) {
        push('!');
        push(`! ${t('ipsec_config.cmt_cert_install')}`);
        push(`! ${t('ipsec_config.cmt_cisco_cert_hint')}`);
      }
      return lines.join('\n');
    }

    if (vendor === 'junos') {
      const jif = ipsecJunosIf(tun);
      push(`# ${t('ipsec_config.cmt_junos')}`);
      if (isPsk) {
        push(`set security ike proposal ${name}-IKE-PROP authentication-method pre-shared-keys`);
      } else {
        push(`set security ike proposal ${name}-IKE-PROP authentication-method rsa-signatures`);
      }
      push(`set security ike proposal ${name}-IKE-PROP dh-group group${dh}`);
      if (!encDef.aead) {
        push(`set security ike proposal ${name}-IKE-PROP authentication-algorithm ${integDef.junos_ike}`);
      }
      push(`set security ike proposal ${name}-IKE-PROP encryption-algorithm ${encDef.junos}`);
      push(`set security ike proposal ${name}-IKE-PROP lifetime-seconds ${ikeLife}`);
      push(`set security ike policy ${name}-IKE-POL proposals ${name}-IKE-PROP`);
      if (isPsk) {
        push(`set security ike policy ${name}-IKE-POL pre-shared-key ascii-text "${psk}"`);
      } else {
        push(`set security ike policy ${name}-IKE-POL certificate local-certificate ${certLocal}`);
      }
      push(`set security ike gateway ${name}-GW ike-policy ${name}-IKE-POL`);
      push(`set security ike gateway ${name}-GW address ${peerIp}`);
      push(`set security ike gateway ${name}-GW local-address ${localIp}`);
      push(`set security ike gateway ${name}-GW external-interface ${wan}`);
      push(`set security ike gateway ${name}-GW version v2-only`);
      push(`set security ike gateway ${name}-GW dead-peer-detection probe-idle-tunnel interval 30 threshold 5`);
      if (!isPsk) {
        push(`set security ike gateway ${name}-GW remote-identity hostname ${certPeerId}`);
      }
      push('#');
      push(`set security ipsec proposal ${name}-IPSEC-PROP protocol esp`);
      if (!espEncDef.aead) {
        push(`set security ipsec proposal ${name}-IPSEC-PROP authentication-algorithm ${espIntDef.junos_esp}`);
      }
      push(`set security ipsec proposal ${name}-IPSEC-PROP encryption-algorithm ${espEncDef.junos}`);
      push(`set security ipsec proposal ${name}-IPSEC-PROP lifetime-seconds ${espLife}`);
      if (pfsEnabled) {
        push(`set security ipsec policy ${name}-IPSEC-POL perfect-forward-secrecy keys group${pfsGrp}`);
      }
      push(`set security ipsec policy ${name}-IPSEC-POL proposals ${name}-IPSEC-PROP`);
      push(`set security ipsec vpn ${name} bind-interface ${tun}`);
      push(`set security ipsec vpn ${name} ike gateway ${name}-GW`);
      push(`set security ipsec vpn ${name} ike ipsec-policy ${name}-IPSEC-POL`);
      push(`set security ipsec vpn ${name} establish-tunnels immediately`);
      tsPairs.forEach((pair, idx) => {
        if (!pair.l || !pair.r) return;
        const n = idx + 1;
        push(`set security ipsec vpn ${name} traffic-selector TS${n} local-ip ${pair.l.cidr}`);
        push(`set security ipsec vpn ${name} traffic-selector TS${n} remote-ip ${pair.r.cidr}`);
      });
      push('#');
      if (tunCidr) {
        push(`set interfaces ${jif.ifd} unit ${jif.unit} family inet address ${tunHost}/${tunCidr.prefix}`);
      } else {
        push(`# ${t('ipsec_config.cmt_tunnel_ip_missing')}`);
      }
      remotes.forEach(r => {
        const c = ipsecCidr(r);
        if (c) push(`set routing-options static route ${c.cidr} next-hop ${tun}`);
      });
      push('#');
      push(`# ${t('ipsec_config.cmt_junos_zone')}`);
      if (!isPsk) {
        push(`# ${t('ipsec_config.cmt_cert_install')}`);
      }
      return lines.join('\n');
    }

    if (vendor === 'strongswan') {
      push(`# ${t('ipsec_config.cmt_strongswan')}`);
      push(`# ${t('ipsec_config.cmt_pfsense')}`);
      push('# /etc/swanctl/swanctl.conf');
      push('');
      push('connections {');
      push(`    ${name} {`);
      push('        version = 2');
      push(`        local_addrs  = ${localIp}`);
      push(`        remote_addrs = ${peerIp}`);
      push(`        proposals = ${ikeProposal}`);
      push(`        rekey_time = ${ikeLife}s`);
      push('        dpd_delay = 30s');
      push('        local {');
      if (isPsk) {
        push('            auth = psk');
        push(`            id = ${localIp}`);
      } else {
        push('            auth = pubkey');
        push(`            certs = ${certLocal}.pem`);
      }
      push('        }');
      push('        remote {');
      if (isPsk) {
        push('            auth = psk');
        push(`            id = ${peerIp}`);
      } else {
        push('            auth = pubkey');
        push(`            id = ${certPeerId}`);
      }
      push('        }');
      push('        children {');
      push(`            ${name} {`);
      push(`                local_ts  = ${localTs}`);
      push(`                remote_ts = ${remoteTs}`);
      push(`                esp_proposals = ${espProposal}`);
      push(`                life_time = ${espLife}s`);
      push('                start_action = trap');
      push('                dpd_action = restart');
      push('                mode = tunnel');
      push('            }');
      push('        }');
      push('    }');
      push('}');
      if (isPsk) {
        push('');
        push('secrets {');
        push(`    ike-${name} {`);
        push(`        id = ${peerIp}`);
        push(`        secret = "${psk}"`);
        push('    }');
        push('}');
      } else {
        push('');
        push(`# ${t('ipsec_config.cmt_swan_cert_paths')}`);
        push(`# /etc/swanctl/x509/${certLocal}.pem`);
        push(`# /etc/swanctl/private/${certLocal}.key`);
        push(`# /etc/swanctl/x509ca/${certCa}.pem`);
      }
      push('#');
      push(`# ${t('ipsec_config.cmt_swan_load')}`);
      push('# swanctl --load-all');
      return lines.join('\n');
    }

    if (vendor === 'fortigate') {
      push(`# ${t('ipsec_config.cmt_fortigate')}`);
      push('config vpn ipsec phase1-interface');
      push(`    edit "${name}"`);
      push(`        set interface "${wan}"`);
      push('        set ike-version 2');
      push('        set type static');
      push(`        set remote-gw ${peerIp}`);
      push(`        set local-gw ${localIp}`);
      push(`        set proposal ${fortiP1}`);
      push(`        set dhgrp ${dh}`);
      push(`        set keylife ${ikeLife}`);
      push('        set dpd on-idle');
      push('        set dpd-retryinterval 30');
      push('        set net-device disable');
      if (isPsk) {
        push('        set authmethod psk');
        push(`        set psksecret ${psk}`);
      } else {
        push('        set authmethod signature');
        push(`        set certificate "${certLocal}"`);
        push(`        set peerid "${certPeerId}"`);
      }
      push('    next');
      push('end');
      push('config vpn ipsec phase2-interface');
      tsPairs.forEach((pair, idx) => {
        if (!pair.l || !pair.r) return;
        const n = idx + 1;
        push(`    edit "${name}-P2-${n}"`);
        push(`        set phase1name "${name}"`);
        push(`        set proposal ${fortiP2}`);
        push(`        set dhgrp ${pfsGrp}`);
        push(`        set pfs ${pfsEnabled ? 'enable' : 'disable'}`);
        push(`        set keylifeseconds ${espLife}`);
        push(`        set src-subnet ${pair.l.net} ${pair.l.mask}`);
        push(`        set dst-subnet ${pair.r.net} ${pair.r.mask}`);
        push('        set auto-negotiate enable');
        push('    next');
      });
      push('end');
      if (tunCidr && IPv4.parse(tunHost) !== null) {
        // ponytail: a /30 transit is the 99 % case; do not build a subnet allocator for it
        const me = IPv4.parse(tunHost);
        let peerInt;
        if (tunCidr.prefix === 30) {
          peerInt = me === ((tunCidr.netInt + 1) >>> 0) ? ((tunCidr.netInt + 2) >>> 0) : ((tunCidr.netInt + 1) >>> 0);
        } else {
          peerInt = (tunCidr.netInt + 1) >>> 0;
        }
        push('config system interface');
        push(`    edit "${name}"`);
        push(`        set ip ${IPv4.str(me)} 255.255.255.255`);
        if (peerInt !== me) {
          push(`        set remote-ip ${IPv4.str(peerInt)} ${tunCidr.mask}`);
        }
        push('    next');
        push('end');
      } else {
        push(`# ${t('ipsec_config.cmt_tunnel_ip_missing')}`);
      }
      push('#');
      push(`# ${t('ipsec_config.cmt_forti_route_policy')}`);
      if (!isPsk) {
        push(`# ${t('ipsec_config.cmt_cert_install')}`);
      }
      return lines.join('\n');
    }

    return '';
  }, [genError, vendor, tunnelName, localIp, peerIp, wanIface, tunnelIface, tunnelIp, locals, remotes, tsPairs, encDef, espEncDef, integDef, espIntDef, dhDef, pfsDef, pfsEnabled, ikeLifetime, espLifetime, authMethod, psk, certLocal, certCa, certPeerId, t]);

  const downloadTxt = useCallback(() => {
    const blob = new Blob([generatedConfig + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ipsec-${vendor}-${tunnelName}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generatedConfig, vendor, tunnelName]);

  const applyVendorIfaceDefaults = (prevVendor, nextVendor) => {
    const prev = IPSEC_VENDOR_DEFAULTS[prevVendor] || IPSEC_VENDOR_DEFAULTS.cisco_iosxe;
    const next = IPSEC_VENDOR_DEFAULTS[nextVendor] || IPSEC_VENDOR_DEFAULTS.cisco_iosxe;
    setTunnelIface(cur => ipsecMaybeRewriteIface(cur, prev.tunnelIface, next.tunnelIface));
    setWanIface(cur => ipsecMaybeRewriteIface(cur, prev.wanIface, next.wanIface));
  };

  const selectVendor = (id) => {
    if (id === vendor) return;
    applyVendorIfaceDefaults(vendor, id);
    setVendor(id);
  };

  useEffect(() => {                                    // apply-down
    if (initialData?.vendor && initialData.vendor !== vendor) {
      skipNavReport.current = true;
      applyVendorIfaceDefaults(vendor, initialData.vendor);
      setVendor(initialData.vendor);
    }
  }, [initialData]);

  useEffect(() => {                                    // report-up
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ vendor });
  }, [vendor]);

  useEffect(() => {                                    // share — NOTE: no psk, no certLocal
    // ponytail: PSK deliberately excluded from the share payload — a share URL is not a secret channel
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'ipsec-config', vendor, authMethod, tunnelName,
      localIp, peerIp, localSubnets, remoteSubnets,
      ikeEnc, ikeInteg, ikeDh,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [vendor, authMethod, tunnelName, localIp, peerIp, localSubnets, remoteSubnets, ikeEnc, ikeInteg, ikeDh, onShare]);

  const pskBits = Math.floor(String(psk).length * Math.log2(62));
  const hideTunnelIface = vendor === 'strongswan' || vendor === 'fortigate';
  const hideTunnelIp = vendor === 'strongswan';

  const renderEncOptions = () => IPSEC_ENC.map(e => (
    <option key={e.id} value={e.id}>{e.id} — {t(ipsecStrengthKey(e.strength))}</option>
  ));
  const renderIntegOptions = () => IPSEC_INTEG.map(i => (
    <option key={i.id} value={i.id}>{i.id} — {t(ipsecStrengthKey(i.strength))}</option>
  ));
  const renderDhOptions = () => IPSEC_DH.map(d => (
    <option key={d.id} value={d.id}>{d.id} ({d.bits}-bit) — {t(ipsecStrengthKey(d.strength))}</option>
  ));

  return (
    <div className="fadein">
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12, flexWrap: 'wrap' }}>
        {IPSEC_VENDORS.map(id => (
          <button
            key={id}
            className={`btn btn-sm ${vendor === id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => selectVendor(id)}
            style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none', margin: '2px 2px 0 0' }}
          >
            {t('ipsec_config.vendor_' + id)}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-title">{t('ipsec_config.section_endpoints')}</div>
        <div className="field">
          <label className="label">{t('ipsec_config.tunnel_name')}</label>
          <input className="input" value={tunnelName} onChange={e => setTunnelName(e.target.value)} />
          <div className="hint">{t('ipsec_config.tunnel_name_hint')}</div>
        </div>
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('ipsec_config.local_ip')}</label>
            <input className="input" value={localIp} onChange={e => setLocalIp(e.target.value)} />
            <div className="hint">{t('ipsec_config.local_ip_hint')}</div>
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.peer_ip')}</label>
            <input className="input" value={peerIp} onChange={e => setPeerIp(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.wan_iface')}</label>
            <input className="input" value={wanIface} onChange={e => setWanIface(e.target.value)} />
            <div className="hint">{t('ipsec_config.wan_iface_hint')}</div>
          </div>
          {!hideTunnelIface && (
            <div className="field">
              <label className="label">{t('ipsec_config.tunnel_iface')}</label>
              <input className="input" value={tunnelIface} onChange={e => setTunnelIface(e.target.value)} />
              <div className="hint">{t('ipsec_config.tunnel_iface_hint')}</div>
            </div>
          )}
        </div>
        {!hideTunnelIp && (
          <div className="field">
            <label className="label">{t('ipsec_config.tunnel_ip')}</label>
            <input className="input" value={tunnelIp} onChange={e => setTunnelIp(e.target.value)} />
            <div className="hint">{t('ipsec_config.tunnel_ip_hint')}</div>
          </div>
        )}
        <div className="hint">{t('ipsec_config.ipv4_only_note')}</div>
      </div>

      <div className="card">
        <div className="card-title">{t('ipsec_config.section_networks')}</div>
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('ipsec_config.local_subnets')}</label>
            <textarea className="input" rows={3} value={localSubnets} onChange={e => setLocalSubnets(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.remote_subnets')}</label>
            <textarea className="input" rows={3} value={remoteSubnets} onChange={e => setRemoteSubnets(e.target.value)} />
          </div>
        </div>
        <div className="hint">{t('ipsec_config.subnets_hint')}</div>
        <div className="hint">{t('ipsec_config.ts_pairs', { n: tsPairs.length })}</div>
      </div>

      <div className="card">
        <div className="card-title">{t('ipsec_config.section_auth')}</div>
        <div className="field">
          <label className="label">{t('ipsec_config.auth_method')}</label>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button className={`btn btn-sm ${authMethod === 'psk' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAuthMethod('psk')}>
              {t('ipsec_config.auth_psk')}
            </button>
            <button className={`btn btn-sm ${authMethod === 'cert' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setAuthMethod('cert')}>
              {t('ipsec_config.auth_cert')}
            </button>
          </div>
        </div>
        {authMethod === 'psk' ? (
          <div>
            <div className="field">
              <label className="label">{t('ipsec_config.psk')}</label>
              <input className="input" type="text" value={psk} onChange={e => setPsk(e.target.value)} />
              <div className="hint">{t('ipsec_config.psk_hint')}</div>
            </div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 8 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('ipsec_config.psk_len')}</label>
                <select className="input" value={pskLen} onChange={e => setPskLen(e.target.value)}>
                  {IPSEC_PSK_LENGTHS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
              <button className="btn btn-sm btn-primary" onClick={generatePsk}>{t('ipsec_config.psk_generate')}</button>
              <CopyBtn text={psk} label="copy" id="ipsec-psk-copy" />
            </div>
            {String(psk).length > 0 && (
              <div className="hint">{t('ipsec_config.psk_entropy', { bits: pskBits })}</div>
            )}
            <div className="hint">{t('ipsec_config.psk_share_note')}</div>
          </div>
        ) : (
          <div>
            <div className="field">
              <label className="label">{t('ipsec_config.cert_local')}</label>
              <input className="input" value={certLocal} onChange={e => setCertLocal(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('ipsec_config.cert_ca')}</label>
              <input className="input" value={certCa} onChange={e => setCertCa(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('ipsec_config.cert_peer_id')}</label>
              <input className="input" value={certPeerId} onChange={e => setCertPeerId(e.target.value)} />
            </div>
            <div className="hint">{t('ipsec_config.cert_no_keygen_note')}</div>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('ipsec_config.section_ike')}</div>
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('ipsec_config.ike_enc')}</label>
            <select className="input" value={ikeEnc} onChange={e => setIkeEnc(e.target.value)}>{renderEncOptions()}</select>
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.ike_integ')}</label>
            <select className="input" value={ikeInteg} onChange={e => setIkeInteg(e.target.value)}>{renderIntegOptions()}</select>
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.ike_dh')}</label>
            <select className="input" value={ikeDh} onChange={e => setIkeDh(e.target.value)}>{renderDhOptions()}</select>
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.ike_lifetime')}</label>
            <input className="input" value={ikeLifetime} onChange={e => setIkeLifetime(e.target.value)} />
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('ipsec_config.section_esp')}</div>
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('ipsec_config.esp_enc')}</label>
            <select className="input" value={espEnc} onChange={e => setEspEnc(e.target.value)}>{renderEncOptions()}</select>
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.esp_integ')}</label>
            <select className="input" value={espInteg} onChange={e => setEspInteg(e.target.value)}>{renderIntegOptions()}</select>
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.pfs_enabled')}</label>
            <label className="label" style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 'normal' }}>
              <input type="checkbox" checked={!!pfsEnabled} onChange={e => setPfsEnabled(e.target.checked)} />
              {pfsEnabled ? t('common.yes') : t('common.no')}
            </label>
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.pfs_dh')}</label>
            <select className="input" value={pfsDh} onChange={e => setPfsDh(e.target.value)} disabled={!pfsEnabled}>
              <option value="same">{t('ipsec_config.pfs_same')}</option>
              {renderDhOptions()}
            </select>
          </div>
          <div className="field">
            <label className="label">{t('ipsec_config.esp_lifetime')}</label>
            <input className="input" value={espLifetime} onChange={e => setEspLifetime(e.target.value)} />
          </div>
        </div>
        <div className="card-title" style={{ marginTop: 12 }}>{t('ipsec_config.section_hints')}</div>
        {hints.map(h => (
          <div key={h.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 6 }}>
            <span className={`badge badge-${h.level}`}>{t(ipsecHintBadgeKey(h.level))}</span>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t(h.key)}</span>
          </div>
        ))}
      </div>

      <Err msg={genError} />

      {!genError && generatedConfig && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('ipsec_config.config_output')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <CopyBtn text={generatedConfig} label="copy" id="ipsec-cfg-copy" />
              <button className="btn btn-sm btn-ghost" onClick={downloadTxt}>{t('ipsec_config.export_txt')}</button>
            </div>
          </div>
          <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--background)', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap' }}>
            {generatedConfig.split('\n').map((line, i) => (
              <span key={i} style={/^\s*[!#]/.test(line) ? { color: 'var(--dim)' } : undefined}>{line}{'\n'}</span>
            ))}
          </pre>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 10 }}>{t('ipsec_config.related')}</div>
        </div>
      )}
    </div>
  );
}

window.IPsecConfigBuilder = IPsecConfigBuilder;
