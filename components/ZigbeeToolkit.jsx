const { useState, useEffect, useCallback, useMemo, useRef } = React;

// ── Zigbee / IEEE 802.15.4 technical constants ──────────────────────────────

// Zigbee channels 11-26, 2.4 GHz band, center freq formula: 2405 + 5*(ch-11) MHz
const ZB_CHANNELS = Array.from({ length: 16 }, (_, i) => ({
  ch: i + 11,
  freq: 2405 + 5 * i,
}));

// Wi-Fi 2.4 GHz channels 1-13, center freq: 2407 + 5*ch MHz, bandwidth 22 MHz
const WIFI_24_CHANNELS = Array.from({ length: 13 }, (_, i) => ({
  ch: i + 1,
  freq: 2407 + 5 * (i + 1),
}));

// Returns overlap in MHz between a Zigbee ch (2 MHz ±1) and Wi-Fi ch (22 MHz ±11)
function zbWifiOverlapMHz(zbFreq, wfFreq) {
  const lo = Math.max(zbFreq - 1, wfFreq - 11);
  const hi = Math.min(zbFreq + 1, wfFreq + 11);
  return Math.max(0, hi - lo);
}

// For a set of active Wi-Fi channels, return which Zigbee channels are impacted and recommended
function analyzeChannels(activeWifi) {
  return ZB_CHANNELS.map((zb) => {
    const overlaps = activeWifi.map((wCh) => {
      const wf = WIFI_24_CHANNELS.find((w) => w.ch === wCh);
      return wf ? zbWifiOverlapMHz(zb.freq, wf.freq) : 0;
    });
    const totalOverlap = overlaps.reduce((s, v) => s + v, 0);
    const maxOverlap = Math.max(...overlaps, 0);
    return { ...zb, totalOverlap, maxOverlap, affected: totalOverlap > 0 };
  });
}

// Get recommended Zigbee channels (unaffected by any active Wi-Fi channel)
function getRecommended(analyzedChannels) {
  const clean = analyzedChannels.filter((c) => !c.affected);
  if (clean.length > 0) return clean.map((c) => c.ch);
  // If all affected, pick lowest-overlap ones
  const minOvl = Math.min(...analyzedChannels.map((c) => c.totalOverlap));
  return analyzedChannels.filter((c) => c.totalOverlap === minOvl).map((c) => c.ch);
}

// ── Tab 2: Zigbee Capacity ────────────────────────────────────────────────────

// Zigbee stack profile reference
const STACK_PROFILES = [
  { id: 'home',    label: 'Home (Zigbee PRO default)',    Cm: 6,  Rm: 2,  Lm: 5  },
  { id: 'z3',      label: 'Zigbee 3.0 Extended',          Cm: 26, Rm: 6,  Lm: 5  },
  { id: 'pro_max', label: 'Zigbee PRO Max',               Cm: 26, Rm: 26, Lm: 15 },
  { id: 'custom',  label: 'Custom',                       Cm: 10, Rm: 6,  Lm: 5  },
];

function calcTreeCapacity(Cm, Rm, Lm) {
  // Cskip-based address space per node at depth d
  function Cskip(d) {
    if (d >= Lm) return 0;
    if (Rm === 1) return 1 + Cm * (Lm - d - 1);
    const base = Math.pow(Rm, Lm - d - 1);
    return Math.round((1 + Cm - Rm - Cm * base) / (1 - Rm));
  }
  const totalAddresses = Cskip(0);
  // Estimate routers vs end-devices in tree
  // Each coordinator/router can have Rm router children and (Cm-Rm) ED children
  let totalRouters = 0, totalEDs = 0;
  function countNodes(depth, count) {
    if (depth > Lm) return;
    const routerChildren = depth < Lm ? Math.min(Rm, count) : 0;
    const edChildren = (Cm - Rm) * count;
    totalRouters += routerChildren;
    totalEDs += edChildren;
    if (routerChildren > 0) countNodes(depth + 1, routerChildren);
  }
  countNodes(1, 1); // start from coordinator
  return { totalAddresses, totalRouters, totalEDs, totalNodes: totalAddresses };
}

function calcMeshCapacity(numRouters, Cm) {
  // Mesh: each router can serve Cm-Rm end devices on average
  // With full mesh routing, address space is 65535 minus reserved
  const maxRouters = numRouters;
  const maxEDs = numRouters * (Cm - Math.ceil(Cm / 2));
  const totalNodes = maxRouters + maxEDs + 1; // +1 coordinator
  return { maxRouters, maxEDs, totalNodes };
}

// ── Tab 3: Battery Life ───────────────────────────────────────────────────────

const TX_POWER_OPTIONS = [
  { dbm: -20, mA: 8.5,  label: '-20 dBm' },
  { dbm: -10, mA: 11.5, label: '-10 dBm' },
  { dbm: -5,  mA: 13.5, label: '-5 dBm'  },
  { dbm:  0,  mA: 16.5, label: '0 dBm'   },
  { dbm:  3,  mA: 20.5, label: '+3 dBm'  },
  { dbm:  5,  mA: 25.0, label: '+5 dBm'  },
  { dbm:  8,  mA: 30.0, label: '+8 dBm'  },
];

const BATTERY_TYPES = [
  { id: 'cr2032', label: 'CR2032 (coin)',   mAh: 220,  V: 3.0 },
  { id: 'cr123a', label: 'CR123A',          mAh: 1500, V: 3.0 },
  { id: 'aa',     label: 'AA Alkaline',     mAh: 2700, V: 1.5 },
  { id: '2aa',    label: '2×AA Alkaline',   mAh: 2700, V: 3.0 },
  { id: 'aaa',    label: 'AAA Alkaline',    mAh: 1200, V: 1.5 },
  { id: '18650',  label: '18650 Li-Ion',    mAh: 2500, V: 3.7 },
];

// Zigbee frame TX time at 250 kbps
// PHR(1) + SHR/Preamble(4+1) + MAC header(11) + payload + FCS(2) bytes
function calcTxTimeMs(payloadBytes) {
  const totalBytes = 1 + 5 + 11 + payloadBytes + 2;
  return (totalBytes * 8) / 250000 * 1000; // ms
}

function calcBatteryLife({ sleepIntervalSec, txPowerDbm, payloadBytes, rxWindowMs, batteryId }) {
  const battType = BATTERY_TYPES.find((b) => b.id === batteryId) || BATTERY_TYPES[0];
  const txOpt = TX_POWER_OPTIONS.find((t) => t.dbm === txPowerDbm) || TX_POWER_OPTIONS[3];
  const capacity = battType.mAh;

  const txTimeMs = calcTxTimeMs(payloadBytes);
  const rxTimeMs = parseFloat(rxWindowMs) || 5;
  const sleepTimeMs = Math.max(0, sleepIntervalSec * 1000 - txTimeMs - rxTimeMs);

  const I_sleep_uA = 1.0; // µA
  const I_tx_mA = txOpt.mA;
  const I_rx_mA = 18.5;

  const periodMs = sleepIntervalSec * 1000;
  // Weighted average current in mA
  const I_avg_mA = (
    (I_sleep_uA / 1000) * sleepTimeMs +
    I_tx_mA * txTimeMs +
    I_rx_mA * rxTimeMs
  ) / periodMs;

  const lifeHours = capacity / I_avg_mA;
  const lifeDays = lifeHours / 24;

  return {
    I_avg_uA: I_avg_mA * 1000,
    I_avg_mA,
    txTimeMs,
    rxTimeMs,
    sleepTimeMs,
    lifeHours,
    lifeDays,
    battCapacity: capacity,
    txMa: I_tx_mA,
    rxMa: I_rx_mA,
    sleepUa: I_sleep_uA,
    periodMs,
  };
}

// ── Tab 4: Frame Decoder ─────────────────────────────────────────────────────

const FRAME_TYPES = ['Beacon', 'Data', 'Acknowledgment', 'MAC Command'];
const ADDR_MODES = ['None', 'Reserved', '16-bit Short', '64-bit Extended'];
const FRAME_VERSIONS = ['IEEE 802.15.4-2003', 'IEEE 802.15.4-2006', 'IEEE 802.15.4-2015', 'Reserved'];

function parseHexBytes(hex) {
  const clean = hex.replace(/[\s:,\-]/g, '');
  if (!/^[0-9a-fA-F]*$/.test(clean)) return null;
  if (clean.length % 2 !== 0) return null;
  const bytes = [];
  for (let i = 0; i < clean.length; i += 2) {
    bytes.push(parseInt(clean.slice(i, i + 2), 16));
  }
  return bytes;
}

function decodeFrame(bytes) {
  if (!bytes || bytes.length < 3) return { err: 'Frame too short (min 3 bytes: FCF + seq)' };
  const fcf = bytes[0] | (bytes[1] << 8);
  const frameType = fcf & 0x07;
  const securityEnabled = (fcf >> 3) & 1;
  const framePending = (fcf >> 4) & 1;
  const ackRequest = (fcf >> 5) & 1;
  const panIdCompression = (fcf >> 6) & 1;
  const dstAddrMode = (fcf >> 10) & 0x03;
  const frameVersion = (fcf >> 12) & 0x03;
  const srcAddrMode = (fcf >> 14) & 0x03;
  const seqNum = bytes[2];

  let pos = 3;
  let dstPAN = null, dstAddr = null, srcPAN = null, srcAddr = null;

  if (dstAddrMode === 2 || dstAddrMode === 3) {
    if (pos + 2 > bytes.length) return { err: 'Frame truncated at Dest PAN' };
    dstPAN = '0x' + (bytes[pos] | (bytes[pos + 1] << 8)).toString(16).toUpperCase().padStart(4, '0');
    pos += 2;
    const dstLen = dstAddrMode === 2 ? 2 : 8;
    if (pos + dstLen > bytes.length) return { err: 'Frame truncated at Dest Addr' };
    if (dstAddrMode === 2) {
      dstAddr = '0x' + (bytes[pos] | (bytes[pos + 1] << 8)).toString(16).toUpperCase().padStart(4, '0');
    } else {
      dstAddr = '0x' + bytes.slice(pos, pos + 8).map((b) => b.toString(16).padStart(2, '0')).reverse().join('').toUpperCase();
    }
    pos += dstLen;
  }

  if (srcAddrMode !== 0) {
    if (!panIdCompression) {
      if (pos + 2 > bytes.length) return { err: 'Frame truncated at Src PAN' };
      srcPAN = '0x' + (bytes[pos] | (bytes[pos + 1] << 8)).toString(16).toUpperCase().padStart(4, '0');
      pos += 2;
    } else {
      srcPAN = dstPAN ? `${dstPAN} (compressed)` : 'Same as Dest PAN';
    }
    if (srcAddrMode === 2 || srcAddrMode === 3) {
      const srcLen = srcAddrMode === 2 ? 2 : 8;
      if (pos + srcLen > bytes.length) return { err: 'Frame truncated at Src Addr' };
      if (srcAddrMode === 2) {
        srcAddr = '0x' + (bytes[pos] | (bytes[pos + 1] << 8)).toString(16).toUpperCase().padStart(4, '0');
      } else {
        srcAddr = '0x' + bytes.slice(pos, pos + 8).map((b) => b.toString(16).padStart(2, '0')).reverse().join('').toUpperCase();
      }
      pos += srcLen;
    }
  }

  const payloadBytes = bytes.slice(pos);
  const hasFCS = payloadBytes.length >= 2;
  const payload = hasFCS ? payloadBytes.slice(0, -2) : payloadBytes;
  const fcs = hasFCS ? payloadBytes.slice(-2) : null;

  return {
    fcf: fcf.toString(16).toUpperCase().padStart(4, '0'),
    fcfBin: fcf.toString(2).padStart(16, '0'),
    frameType, frameTypeName: FRAME_TYPES[frameType] || 'Reserved',
    securityEnabled, framePending, ackRequest, panIdCompression,
    dstAddrMode, dstAddrModeName: ADDR_MODES[dstAddrMode],
    srcAddrMode, srcAddrModeName: ADDR_MODES[srcAddrMode],
    frameVersion, frameVersionName: FRAME_VERSIONS[frameVersion],
    seqNum,
    dstPAN, dstAddr, srcPAN, srcAddr,
    payloadHex: payload.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
    payloadLen: payload.length,
    fcsHex: fcs ? fcs.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') : null,
    totalBytes: bytes.length,
  };
}

// Build a frame from fields
function encodeFrame({ frameType, security, framePending, ackReq, panCompress, dstMode, srcMode, frameVer, seqNum, dstPAN, dstAddr, srcPAN, srcAddr, payload }) {
  let fcf = 0;
  fcf |= (frameType & 0x07);
  fcf |= (security ? 1 : 0) << 3;
  fcf |= (framePending ? 1 : 0) << 4;
  fcf |= (ackReq ? 1 : 0) << 5;
  fcf |= (panCompress ? 1 : 0) << 6;
  fcf |= (dstMode & 0x03) << 10;
  fcf |= (frameVer & 0x03) << 12;
  fcf |= (srcMode & 0x03) << 14;

  const bytes = [fcf & 0xFF, (fcf >> 8) & 0xFF, seqNum & 0xFF];

  function pushU16(hex) {
    const v = parseInt(hex.replace('0x', ''), 16) || 0;
    bytes.push(v & 0xFF, (v >> 8) & 0xFF);
  }
  function pushAddr(hex, mode) {
    const clean = hex.replace(/[\s:0x]/gi, '');
    if (mode === 2) {
      const v = parseInt(clean, 16) || 0;
      bytes.push(v & 0xFF, (v >> 8) & 0xFF);
    } else if (mode === 3) {
      const padded = clean.padStart(16, '0');
      for (let i = 14; i >= 0; i -= 2) bytes.push(parseInt(padded.slice(i, i + 2), 16));
    }
  }

  if (dstMode === 2 || dstMode === 3) { pushU16(dstPAN); pushAddr(dstAddr, dstMode); }
  if (srcMode !== 0) {
    if (!panCompress) pushU16(srcPAN);
    pushAddr(srcAddr, srcMode);
  }

  const payBytes = parseHexBytes(payload) || [];
  bytes.push(...payBytes);
  // CRC-16/CCITT-FALSE (FCS) - simplified XOR placeholder
  bytes.push(0xAB, 0xCD);

  return bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
}

// ── Tab 5: Link Budget ────────────────────────────────────────────────────────

const FREQ_OPTIONS = [
  { label: '868 MHz (EU)',     MHz: 868  },
  { label: '915 MHz (US)',     MHz: 915  },
  { label: '2.4 GHz (global)', MHz: 2400 },
];

function calcFSPL(distM, freqMHz) {
  if (distM <= 0 || freqMHz <= 0) return 0;
  return 20 * Math.log10(distM) + 20 * Math.log10(freqMHz) - 27.55;
}

function calcLinkBudget({ txPower, rxSensitivity, freqMHz, txGain, rxGain, fadeMargin, distM }) {
  const fspl = calcFSPL(distM, freqMHz);
  const linkBudget = txPower + txGain + rxGain - rxSensitivity;
  const linkMargin = linkBudget - fspl - fadeMargin;
  // Max range (free space, link margin = 0)
  const fsplConst = 20 * Math.log10(freqMHz) - 27.55;
  const maxRangeFreeSpaceM = Math.pow(10, (linkBudget - fadeMargin - fsplConst) / 20);
  // Indoor: path loss exponent ~3.0 vs 2.0, adds extra 10*log10(d) dB
  // Solve: 20*log10(d) + 10*log10(d) = budget_const → 30*log10(d) = C
  const maxRangeIndoorM = Math.pow(10, (linkBudget - fadeMargin - fsplConst) / 30);
  return { fspl, linkBudget, linkMargin, maxRangeFreeSpaceM, maxRangeIndoorM, distFSPL: fspl };
}

// Recommended TX power for a target range (free space)
function recTxPower(targetM, freqMHz, rxSensitivity, fadeMargin, rxGain, txGain) {
  const fspl = calcFSPL(targetM, freqMHz);
  return fspl + fadeMargin + rxSensitivity - rxGain - txGain;
}

// ── Tab 6: Protocol Comparison data ─────────────────────────────────────────

const ZIGBEE_PROTOCOLS = [
  {
    id: 'zigbee',
    name: 'Zigbee',
    freq: '2.4 GHz / 868/915 MHz',
    dataRate: '250 kbps',
    range: '10–100 m',
    maxNodes: '65,535',
    power: 'Very Low',
    mesh: true,
    security: 'AES-128',
    useCases: 'Smart home, lighting, HVAC, sensors',
    standard: 'IEEE 802.15.4',
    powerBadge: 'badge-green',
    meshBadge: 'badge-cyan',
  },
  {
    id: 'thread',
    name: 'Thread',
    freq: '2.4 GHz',
    dataRate: '250 kbps',
    range: '10–100 m',
    maxNodes: '511 / border router',
    power: 'Very Low',
    mesh: true,
    security: 'AES-128 + DTLS',
    useCases: 'Smart home, Matter protocol backbone',
    standard: 'IEEE 802.15.4',
    powerBadge: 'badge-green',
    meshBadge: 'badge-cyan',
  },
  {
    id: 'zwave',
    name: 'Z-Wave',
    freq: '868/908/916 MHz',
    dataRate: '9.6–100 kbps',
    range: '30–100 m',
    maxNodes: '232',
    power: 'Low',
    mesh: true,
    security: 'AES-128 (S2)',
    useCases: 'Smart home, security, door locks',
    standard: 'Proprietary (ITU G.9959)',
    powerBadge: 'badge-green',
    meshBadge: 'badge-cyan',
  },
  {
    id: 'ble',
    name: 'BLE 5.x',
    freq: '2.4 GHz',
    dataRate: '125 kbps–2 Mbps',
    range: '10–400 m',
    maxNodes: '~32,767',
    power: 'Very Low',
    mesh: true,
    security: 'AES-128 + CCM',
    useCases: 'Wearables, asset tracking, BLE beacons',
    standard: 'Bluetooth SIG',
    powerBadge: 'badge-green',
    meshBadge: 'badge-cyan',
  },
  {
    id: 'wifi_halow',
    name: 'Wi-Fi HaLow (802.11ah)',
    freq: '900 MHz (sub-GHz)',
    dataRate: '150 kbps–78 Mbps',
    range: '100 m–1 km',
    maxNodes: '8,191 / AP',
    power: 'Medium',
    mesh: false,
    security: 'WPA3',
    useCases: 'Industrial IoT, smart metering, outdoor sensors',
    standard: 'IEEE 802.11ah',
    powerBadge: 'badge-yellow',
    meshBadge: 'badge-red',
  },
  {
    id: 'lora',
    name: 'LoRa / LoRaWAN',
    freq: '433/868/915 MHz (regional)',
    dataRate: '0.3–50 kbps',
    range: '2–15 km',
    maxNodes: '~1,000 / gateway',
    power: 'Ultra Low',
    mesh: false,
    security: 'AES-128 (MIC + payload)',
    useCases: 'Smart agriculture, city metering, remote monitoring',
    standard: 'LoRa Alliance',
    powerBadge: 'badge-green',
    meshBadge: 'badge-red',
  },
];

// ── Main Component ─────────────────────────────────────────────────────────────

const ZB_TABS = ['channel', 'capacity', 'battery', 'frame', 'linkbudget', 'compare'];

function ZigbeeToolkit({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = usePersistentState('zb:tab', (initialData && initialData.tab) || 'channel');
  const skipNavReport = useRef(false);
  useEffect(() => {
    if (initialData?.tab && initialData.tab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.tab);
    }
  }, [initialData]);
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ tab: activeTab });
  }, [activeTab]);

  // ── Tab 1 state ──
  const [activeWifi, setActiveWifi] = usePersistentState('zb:activeWifi', (initialData && initialData.activeWifi) || []);

  // ── Tab 2 state ──
  const [topology, setTopology] = usePersistentState('zb:topology', (initialData && initialData.topology) || 'tree');
  const [stackProfile, setStackProfile] = usePersistentState('zb:stackProfile', (initialData && initialData.stackProfile) || 'z3');
  const [customCm, setCustomCm] = usePersistentState('zb:customCm', (initialData && initialData.customCm) || '10');
  const [customRm, setCustomRm] = usePersistentState('zb:customRm', (initialData && initialData.customRm) || '6');
  const [customLm, setCustomLm] = usePersistentState('zb:customLm', (initialData && initialData.customLm) || '5');
  const [numRouters, setNumRouters] = usePersistentState('zb:numRouters', (initialData && initialData.numRouters) || '10');

  // ── Tab 3 state ──
  const [sleepInterval, setSleepInterval] = usePersistentState('zb:sleepInterval', (initialData && initialData.sleepInterval) || '60');
  const [txPowerDbm, setTxPowerDbm] = usePersistentState('zb:txPower', (initialData && initialData.txPowerDbm) || '0');
  const [payloadBytes, setPayloadBytes] = usePersistentState('zb:payload', (initialData && initialData.payloadBytes) || '20');
  const [rxWindow, setRxWindow] = usePersistentState('zb:rxWindow', (initialData && initialData.rxWindow) || '5');
  const [batteryId, setBatteryId] = usePersistentState('zb:battery', (initialData && initialData.batteryId) || 'cr2032');

  // ── Tab 4 state ──
  const [frameMode, setFrameMode] = usePersistentState('zb:frameMode', (initialData && initialData.frameMode) || 'decode');
  const [frameHex, setFrameHex] = usePersistentState('zb:frameHex', (initialData && initialData.frameHex) || '61 88 AB CD EF 00 00 00 01 00 DE AD');
  const [encFrameType, setEncFrameType] = usePersistentState('zb:encFrameType', '1');
  const [encSecurity, setEncSecurity] = usePersistentState('zb:encSecurity', false);
  const [encFramePending, setEncFramePending] = usePersistentState('zb:encFramePending', false);
  const [encAckReq, setEncAckReq] = usePersistentState('zb:encAckReq', true);
  const [encPanCompress, setEncPanCompress] = usePersistentState('zb:encPanCompress', true);
  const [encDstMode, setEncDstMode] = usePersistentState('zb:encDstMode', '2');
  const [encSrcMode, setEncSrcMode] = usePersistentState('zb:encSrcMode', '2');
  const [encFrameVer, setEncFrameVer] = usePersistentState('zb:encFrameVer', '1');
  const [encSeqNum, setEncSeqNum] = usePersistentState('zb:encSeqNum', '0');
  const [encDstPAN, setEncDstPAN] = usePersistentState('zb:encDstPAN', '0x1234');
  const [encDstAddr, setEncDstAddr] = usePersistentState('zb:encDstAddr', '0x0001');
  const [encSrcPAN, setEncSrcPAN] = usePersistentState('zb:encSrcPAN', '0x1234');
  const [encSrcAddr, setEncSrcAddr] = usePersistentState('zb:encSrcAddr', '0x0002');
  const [encPayload, setEncPayload] = usePersistentState('zb:encPayload', 'DE AD BE EF');

  // ── Tab 5 state ──
  const [lbTxPower, setLbTxPower] = usePersistentState('zb:lbTxPower', '0');
  const [lbRxSens, setLbRxSens] = usePersistentState('zb:lbRxSens', '-95');
  const [lbFreq, setLbFreq] = usePersistentState('zb:lbFreq', '2400');
  const [lbTxGain, setLbTxGain] = usePersistentState('zb:lbTxGain', '2');
  const [lbRxGain, setLbRxGain] = usePersistentState('zb:lbRxGain', '2');
  const [lbFadeMargin, setLbFadeMargin] = usePersistentState('zb:lbFadeMargin', '10');
  const [lbDist, setLbDist] = usePersistentState('zb:lbDist', '50');

  // ── Share URL ──
  useEffect(() => {
    const handle = (e) => {
      const payload = {
        tool: 'zigbee-toolkit', tab: activeTab, activeWifi,
        topology, stackProfile, customCm, customRm, customLm, numRouters,
        sleepInterval, txPowerDbm, payloadBytes, rxWindow, batteryId,
        frameMode, frameHex,
        lbTxPower, lbRxSens, lbFreq, lbTxGain, lbRxGain, lbFadeMargin, lbDist,
      };
      (e.detail && e.detail.respond ? e.detail.respond : onShare)(payload);
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [activeTab, activeWifi, topology, stackProfile, customCm, customRm, customLm, numRouters,
      sleepInterval, txPowerDbm, payloadBytes, rxWindow, batteryId,
      frameMode, frameHex, lbTxPower, lbRxSens, lbFreq, lbTxGain, lbRxGain, lbFadeMargin, lbDist, onShare]);

  // ── Derived state ──

  const analyzedChannels = useMemo(() => analyzeChannels(activeWifi), [activeWifi]);
  const recommended = useMemo(() => getRecommended(analyzedChannels), [analyzedChannels]);

  const capacityResult = useMemo(() => {
    const profile = STACK_PROFILES.find((p) => p.id === stackProfile);
    const Cm = stackProfile === 'custom' ? (parseInt(customCm) || 10) : profile.Cm;
    const Rm = stackProfile === 'custom' ? (parseInt(customRm) || 6) : profile.Rm;
    const Lm = stackProfile === 'custom' ? (parseInt(customLm) || 5) : profile.Lm;
    const nRouters = parseInt(numRouters) || 10;
    if (topology === 'star') {
      return { maxNodes: Cm + 1, maxRouters: Math.min(Rm, Cm), maxEDs: Math.max(0, Cm - Rm), topology: 'star', Cm, Rm, Lm };
    } else if (topology === 'tree') {
      const res = calcTreeCapacity(Cm, Rm, Lm);
      return { ...res, Cm, Rm, Lm };
    } else {
      const res = calcMeshCapacity(nRouters, Cm);
      return { ...res, Cm, Rm, Lm };
    }
  }, [topology, stackProfile, customCm, customRm, customLm, numRouters]);

  const batteryResult = useMemo(() => {
    const si = parseFloat(sleepInterval);
    const pb = parseInt(payloadBytes);
    if (!si || !pb || si <= 0) return null;
    return calcBatteryLife({
      sleepIntervalSec: si,
      txPowerDbm: parseInt(txPowerDbm),
      payloadBytes: pb,
      rxWindowMs: parseFloat(rxWindow),
      batteryId,
    });
  }, [sleepInterval, txPowerDbm, payloadBytes, rxWindow, batteryId]);

  const frameDecoded = useMemo(() => {
    const bytes = parseHexBytes(frameHex);
    if (!bytes) return { err: 'Invalid hex input' };
    return decodeFrame(bytes);
  }, [frameHex]);

  const encodedFrame = useMemo(() => {
    if (frameMode !== 'encode') return '';
    return encodeFrame({
      frameType: parseInt(encFrameType),
      security: encSecurity,
      framePending: encFramePending,
      ackReq: encAckReq,
      panCompress: encPanCompress,
      dstMode: parseInt(encDstMode),
      srcMode: parseInt(encSrcMode),
      frameVer: parseInt(encFrameVer),
      seqNum: parseInt(encSeqNum) || 0,
      dstPAN: encDstPAN, dstAddr: encDstAddr,
      srcPAN: encSrcPAN, srcAddr: encSrcAddr,
      payload: encPayload,
    });
  }, [frameMode, encFrameType, encSecurity, encFramePending, encAckReq, encPanCompress,
      encDstMode, encSrcMode, encFrameVer, encSeqNum, encDstPAN, encDstAddr, encSrcPAN, encSrcAddr, encPayload]);

  const linkResult = useMemo(() => {
    const p = {
      txPower: parseFloat(lbTxPower) || 0,
      rxSensitivity: parseFloat(lbRxSens) || -95,
      freqMHz: parseFloat(lbFreq) || 2400,
      txGain: parseFloat(lbTxGain) || 0,
      rxGain: parseFloat(lbRxGain) || 0,
      fadeMargin: parseFloat(lbFadeMargin) || 10,
      distM: parseFloat(lbDist) || 50,
    };
    if (p.distM <= 0) return null;
    return calcLinkBudget(p);
  }, [lbTxPower, lbRxSens, lbFreq, lbTxGain, lbRxGain, lbFadeMargin, lbDist]);

  // ── Helpers ──
  const toggleWifi = useCallback((ch) => {
    setActiveWifi((prev) =>
      prev.includes(ch) ? prev.filter((c) => c !== ch) : [...prev, ch]
    );
  }, [setActiveWifi]);

  const fmtDays = (days) => {
    if (days > 365) return `${(days / 365).toFixed(1)} ${t('zigbee_toolkit.years')}`;
    if (days > 30) return `${(days / 30).toFixed(1)} ${t('zigbee_toolkit.months')}`;
    return `${days.toFixed(1)} ${t('zigbee_toolkit.days')}`;
  };

  const fmtDist = (m) => {
    if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
    return `${m.toFixed(0)} m`;
  };

  // ── Spectrum visualization (Tab 1) ──
  // Range: 2395–2490 MHz (95 MHz total)
  const SPEC_LO = 2395, SPEC_HI = 2490, SPEC_RANGE = SPEC_HI - SPEC_LO;
  const pct = (mhz) => ((mhz - SPEC_LO) / SPEC_RANGE) * 100;

  const tabLabels = [
    t('zigbee_toolkit.tab_channel'),
    t('zigbee_toolkit.tab_capacity'),
    t('zigbee_toolkit.tab_battery'),
    t('zigbee_toolkit.tab_frame'),
    t('zigbee_toolkit.tab_linkbudget'),
    t('zigbee_toolkit.tab_compare'),
  ];

  return (
    <div className="fadein">
      <div className="card" style={{ marginBottom: 8 }}>
        <div className="card-title">{t('zigbee_toolkit.title')}</div>
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>{t('zigbee_toolkit.subtitle')}</div>
      </div>

      {/* Tab bar */}
      <div className="btn-row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {ZB_TABS.map((id, i) => (
          <button key={id}
            className={`btn btn-sm ${activeTab === id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(id)}>
            {tabLabels[i]}
          </button>
        ))}
      </div>

      {/* ── TAB 1: Channel & Interference Planner ── */}
      {activeTab === 'channel' && (
        <div>
          <div className="card">
            <div className="card-title">{t('zigbee_toolkit.ch_title')}</div>
            <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
              {t('zigbee_toolkit.ch_desc')}
            </p>

            {/* Wi-Fi channel selector */}
            <div className="field">
              <label className="label">{t('zigbee_toolkit.ch_wifi_select')}</label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
                {WIFI_24_CHANNELS.map((w) => (
                  <button key={w.ch}
                    className={`btn btn-sm ${activeWifi.includes(w.ch) ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => toggleWifi(w.ch)}
                    title={`${w.freq} MHz`}>
                    {t('zigbee_toolkit.ch_wifi_ch')} {w.ch}
                  </button>
                ))}
                <button className="btn btn-sm btn-ghost" onClick={() => setActiveWifi([])}>
                  {t('zigbee_toolkit.ch_clear_wifi')}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => setActiveWifi([1, 6, 11])}>
                  {t('zigbee_toolkit.ch_preset_1_6_11')}
                </button>
              </div>
            </div>

            {/* Spectrum map */}
            <div style={{ marginTop: 16, marginBottom: 8 }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                {t('zigbee_toolkit.ch_spectrum_label')} (2.4 GHz · 2400–2485 MHz)
              </div>
              <div style={{ position: 'relative', height: 110, background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)', overflow: 'hidden' }}>
                {/* Frequency axis labels */}
                {[2400, 2420, 2440, 2460, 2480].map((f) => (
                  <div key={f} style={{ position: 'absolute', left: `${pct(f)}%`, top: 0, height: '100%', borderLeft: '1px solid var(--border)', fontSize: 10, color: 'var(--text-muted)', paddingLeft: 2, paddingTop: 2 }}>
                    {f}
                  </div>
                ))}

                {/* Wi-Fi channels (bottom layer) */}
                {WIFI_24_CHANNELS.map((w) => {
                  const active = activeWifi.includes(w.ch);
                  const lo = pct(w.freq - 11), hi = pct(w.freq + 11);
                  return (
                    <div key={w.ch} style={{
                      position: 'absolute',
                      left: `${lo}%`, width: `${hi - lo}%`,
                      top: 56, height: 36,
                      background: active ? 'rgba(239,68,68,0.25)' : 'rgba(100,116,139,0.10)',
                      borderLeft: active ? '2px solid var(--red,#ef4444)' : '1px solid var(--border)',
                      borderRight: active ? '2px solid var(--red,#ef4444)' : '1px solid var(--border)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 10, color: active ? '#ef4444' : 'var(--text-muted)',
                      boxSizing: 'border-box',
                    }}>
                      W{w.ch}
                    </div>
                  );
                })}

                {/* Zigbee channels (top layer) */}
                {analyzedChannels.map((zb) => {
                  const lo = pct(zb.freq - 1), hi = pct(zb.freq + 1);
                  const isRec = recommended.includes(zb.ch);
                  const color = zb.affected
                    ? (zb.totalOverlap > 8 ? '#ef4444' : '#f59e0b')
                    : '#22c55e';
                  return (
                    <div key={zb.ch} style={{
                      position: 'absolute',
                      left: `${lo}%`, width: `${Math.max(hi - lo, 1.5)}%`,
                      top: 16, height: 36,
                      background: color,
                      opacity: 0.9,
                      borderRadius: 2,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 9, color: '#fff', fontWeight: isRec ? 700 : 400,
                      border: isRec ? '2px solid #fff' : 'none',
                      boxSizing: 'border-box',
                      overflow: 'visible',
                    }} title={`ZB${zb.ch}: ${zb.freq} MHz`}>
                      {zb.ch}
                    </div>
                  );
                })}

                {/* Legend labels */}
                <div style={{ position: 'absolute', bottom: 0, right: 4, fontSize: 10, color: 'var(--text-muted)' }}>
                  <span style={{ color: '#22c55e' }}>■</span> {t('zigbee_toolkit.ch_legend_clean')} &nbsp;
                  <span style={{ color: '#f59e0b' }}>■</span> {t('zigbee_toolkit.ch_legend_partial')} &nbsp;
                  <span style={{ color: '#ef4444' }}>■</span> {t('zigbee_toolkit.ch_legend_conflict')} &nbsp;
                  <span style={{ color: 'var(--text-muted)' }}>■</span> {t('zigbee_toolkit.ch_legend_wifi')}
                </div>
              </div>
            </div>

            {/* Recommended channels */}
            {activeWifi.length > 0 && (
              <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-secondary)', borderRadius: 6, border: '1px solid var(--border)' }}>
                <strong>{t('zigbee_toolkit.ch_recommended')}:</strong>{' '}
                {recommended.map((ch) => (
                  <span key={ch} className="badge badge-green" style={{ marginRight: 4 }}>ZB{ch} ({2405 + 5 * (ch - 11)} MHz)</span>
                ))}
              </div>
            )}

            {/* Channel table */}
            <div style={{ marginTop: 16, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('zigbee_toolkit.ch_col_ch')}</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('zigbee_toolkit.ch_col_freq')}</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('zigbee_toolkit.ch_col_status')}</th>
                    <th style={{ textAlign: 'left', padding: '6px 8px' }}>{t('zigbee_toolkit.ch_col_overlap_with')}</th>
                  </tr>
                </thead>
                <tbody>
                  {analyzedChannels.map((zb) => {
                    const isRec = recommended.includes(zb.ch);
                    const overlapWifi = WIFI_24_CHANNELS.filter((w) => activeWifi.includes(w.ch) && zbWifiOverlapMHz(zb.freq, w.freq) > 0).map((w) => w.ch);
                    return (
                      <tr key={zb.ch} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '5px 8px', fontWeight: isRec ? 700 : 400 }}>
                          {zb.ch} {isRec && activeWifi.length > 0 && <span className="badge badge-green">✓</span>}
                        </td>
                        <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>{zb.freq} MHz</td>
                        <td style={{ padding: '5px 8px' }}>
                          {activeWifi.length === 0
                            ? <span className="badge badge-cyan">{t('zigbee_toolkit.ch_status_no_wifi')}</span>
                            : zb.affected
                              ? <span className="badge badge-red">{t('zigbee_toolkit.ch_status_conflict')}</span>
                              : <span className="badge badge-green">{t('zigbee_toolkit.ch_status_clean')}</span>
                          }
                        </td>
                        <td style={{ padding: '5px 8px', color: 'var(--text-muted)', fontFamily: 'monospace' }}>
                          {overlapWifi.length > 0 ? overlapWifi.map((c) => `WiFi ${c}`).join(', ') : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 12, padding: 8, background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 12, color: 'var(--text-muted)', borderLeft: '3px solid var(--accent)' }}>
              {t('zigbee_toolkit.ch_note_width')}
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 2: Network Capacity ── */}
      {activeTab === 'capacity' && (
        <div className="two-col">
          <div>
            <div className="card">
              <div className="card-title">{t('zigbee_toolkit.cap_title')}</div>

              <div className="field">
                <label className="label">{t('zigbee_toolkit.cap_topology')}</label>
                <select className="select" value={topology} onChange={(e) => setTopology(e.target.value)}>
                  <option value="star">{t('zigbee_toolkit.cap_topo_star')}</option>
                  <option value="tree">{t('zigbee_toolkit.cap_topo_tree')}</option>
                  <option value="mesh">{t('zigbee_toolkit.cap_topo_mesh')}</option>
                </select>
              </div>

              <div className="field">
                <label className="label">{t('zigbee_toolkit.cap_stack_profile')}</label>
                <select className="select" value={stackProfile} onChange={(e) => setStackProfile(e.target.value)}>
                  {STACK_PROFILES.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>

              {stackProfile === 'custom' && (
                <div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.cap_cm')} (Cm)</label>
                    <input className="input" type="number" min="1" max="26" value={customCm}
                      onChange={(e) => setCustomCm(e.target.value)} />
                    <span className="hint">{t('zigbee_toolkit.cap_cm_hint')}</span>
                  </div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.cap_rm')} (Rm)</label>
                    <input className="input" type="number" min="1" max="26" value={customRm}
                      onChange={(e) => setCustomRm(e.target.value)} />
                    <span className="hint">{t('zigbee_toolkit.cap_rm_hint')}</span>
                  </div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.cap_lm')} (Lm)</label>
                    <input className="input" type="number" min="1" max="15" value={customLm}
                      onChange={(e) => setCustomLm(e.target.value)} />
                    <span className="hint">{t('zigbee_toolkit.cap_lm_hint')}</span>
                  </div>
                </div>
              )}

              {topology === 'mesh' && (
                <div className="field">
                  <label className="label">{t('zigbee_toolkit.cap_num_routers')}</label>
                  <input className="input" type="number" min="1" max="500" value={numRouters}
                    onChange={(e) => setNumRouters(e.target.value)} />
                </div>
              )}
            </div>

            {/* Stack Profile Reference */}
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title" style={{ fontSize: 13 }}>{t('zigbee_toolkit.cap_ref_title')}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                      <th style={{ textAlign: 'left', padding: '5px 6px' }}>{t('zigbee_toolkit.cap_ref_profile')}</th>
                      <th style={{ textAlign: 'center', padding: '5px 6px' }}>Cm</th>
                      <th style={{ textAlign: 'center', padding: '5px 6px' }}>Rm</th>
                      <th style={{ textAlign: 'center', padding: '5px 6px' }}>Lm</th>
                    </tr>
                  </thead>
                  <tbody>
                    {STACK_PROFILES.filter((p) => p.id !== 'custom').map((p) => (
                      <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '4px 6px' }}>{p.label}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'center', fontFamily: 'monospace' }}>{p.Cm}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'center', fontFamily: 'monospace' }}>{p.Rm}</td>
                        <td style={{ padding: '4px 6px', textAlign: 'center', fontFamily: 'monospace' }}>{p.Lm}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          <div>
            <div className="card">
              <div className="card-title">{t('common.results')}</div>
              <div className="result-grid">
                {topology === 'star' && (
                  <>
                    <ResultItem label={t('zigbee_toolkit.cap_max_nodes')} value={capacityResult.maxNodes} />
                    <ResultItem label={t('zigbee_toolkit.cap_max_routers')} value={capacityResult.maxRouters} />
                    <ResultItem label={t('zigbee_toolkit.cap_max_eds')} value={capacityResult.maxEDs} />
                    <ResultItem label={t('zigbee_toolkit.cap_depth_limit')} value="1" />
                  </>
                )}
                {topology === 'tree' && (
                  <>
                    <ResultItem label={t('zigbee_toolkit.cap_total_addr')} value={capacityResult.totalNodes?.toLocaleString() || '—'} />
                    <ResultItem label={t('zigbee_toolkit.cap_est_routers')} value={capacityResult.totalRouters?.toLocaleString() || '—'} />
                    <ResultItem label={t('zigbee_toolkit.cap_est_eds')} value={capacityResult.totalEDs?.toLocaleString() || '—'} />
                    <ResultItem label={t('zigbee_toolkit.cap_depth_limit')} value={capacityResult.Lm} />
                  </>
                )}
                {topology === 'mesh' && (
                  <>
                    <ResultItem label={t('zigbee_toolkit.cap_total_nodes')} value={capacityResult.totalNodes?.toLocaleString() || '—'} />
                    <ResultItem label={t('zigbee_toolkit.cap_max_routers')} value={capacityResult.maxRouters?.toLocaleString() || '—'} />
                    <ResultItem label={t('zigbee_toolkit.cap_max_eds')} value={capacityResult.maxEDs?.toLocaleString() || '—'} />
                    <ResultItem label={t('zigbee_toolkit.cap_addr_space')} value="65,535" />
                  </>
                )}
              </div>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', borderLeft: '3px solid var(--accent)', paddingLeft: 8 }}>
                {t('zigbee_toolkit.cap_note')}
              </div>
            </div>

            {/* Topology description */}
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13 }}>
                {topology === 'star' && <p>{t('zigbee_toolkit.cap_desc_star')}</p>}
                {topology === 'tree' && <p>{t('zigbee_toolkit.cap_desc_tree')}</p>}
                {topology === 'mesh' && <p>{t('zigbee_toolkit.cap_desc_mesh')}</p>}
                <div style={{ marginTop: 8, fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                  {topology !== 'mesh' && (
                    <div>Cm={capacityResult.Cm} · Rm={capacityResult.Rm} · Lm={capacityResult.Lm}</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 3: Battery Life ── */}
      {activeTab === 'battery' && (
        <div className="two-col">
          <div className="card">
            <div className="card-title">{t('zigbee_toolkit.bat_title')}</div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.bat_sleep_interval')}</label>
              <input className="input" type="number" min="1" max="86400" value={sleepInterval}
                onChange={(e) => setSleepInterval(e.target.value)} />
              <span className="hint">{t('zigbee_toolkit.bat_sleep_hint')}</span>
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.bat_tx_power')}</label>
              <select className="select" value={txPowerDbm} onChange={(e) => setTxPowerDbm(e.target.value)}>
                {TX_POWER_OPTIONS.map((opt) => (
                  <option key={opt.dbm} value={opt.dbm}>{opt.label} (~{opt.mA} mA)</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.bat_payload')}</label>
              <input className="input" type="number" min="1" max="116" value={payloadBytes}
                onChange={(e) => setPayloadBytes(e.target.value)} />
              <span className="hint">{t('zigbee_toolkit.bat_payload_hint')}</span>
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.bat_rx_window')}</label>
              <input className="input" type="number" min="1" max="100" step="0.1" value={rxWindow}
                onChange={(e) => setRxWindow(e.target.value)} />
              <span className="hint">{t('zigbee_toolkit.bat_rx_hint')}</span>
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.bat_battery_type')}</label>
              <select className="select" value={batteryId} onChange={(e) => setBatteryId(e.target.value)}>
                {BATTERY_TYPES.map((b) => (
                  <option key={b.id} value={b.id}>{b.label} — {b.mAh} mAh @ {b.V}V</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            {batteryResult && (
              <div className="card">
                <div className="card-title">{t('zigbee_toolkit.bat_result_title')}</div>
                <div className="result-grid">
                  <ResultItem label={t('zigbee_toolkit.bat_life')} value={fmtDays(batteryResult.lifeDays)} />
                  <ResultItem label={t('zigbee_toolkit.bat_avg_current')} value={`${batteryResult.I_avg_uA.toFixed(2)} µA`} />
                  <ResultItem label={t('zigbee_toolkit.bat_tx_time')} value={`${batteryResult.txTimeMs.toFixed(3)} ms`} />
                  <ResultItem label={t('zigbee_toolkit.bat_rx_time')} value={`${batteryResult.rxTimeMs} ms`} />
                  <ResultItem label={t('zigbee_toolkit.bat_sleep_time')} value={`${(batteryResult.sleepTimeMs / 1000).toFixed(2)} s`} />
                  <ResultItem label={t('zigbee_toolkit.bat_capacity')} value={`${batteryResult.battCapacity} mAh`} />
                </div>

                {/* Current breakdown bar */}
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>{t('zigbee_toolkit.bat_breakdown')}</div>
                  {[
                    { label: t('zigbee_toolkit.bat_mode_sleep'), ma: batteryResult.sleepUa / 1000, ms: batteryResult.sleepTimeMs, color: '#22c55e' },
                    { label: t('zigbee_toolkit.bat_mode_tx'),    ma: batteryResult.txMa,           ms: batteryResult.txTimeMs,    color: '#f59e0b' },
                    { label: t('zigbee_toolkit.bat_mode_rx'),    ma: batteryResult.rxMa,           ms: batteryResult.rxTimeMs,    color: '#60a5fa' },
                  ].map((row) => {
                    const contribution = (row.ma * row.ms) / batteryResult.periodMs;
                    const pctContrib = batteryResult.I_avg_mA > 0 ? (contribution / batteryResult.I_avg_mA) * 100 : 0;
                    return (
                      <div key={row.label} style={{ marginBottom: 8 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 2 }}>
                          <span>{row.label}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{row.ma >= 1 ? `${row.ma.toFixed(1)} mA` : `${(row.ma * 1000).toFixed(1)} µA`} · {row.ms.toFixed(2)} ms · {pctContrib.toFixed(1)}%</span>
                        </div>
                        <div style={{ height: 8, background: 'var(--bg-secondary)', borderRadius: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${Math.min(100, pctContrib)}%`, background: row.color, borderRadius: 4 }} />
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', borderLeft: '3px solid var(--accent)', paddingLeft: 8 }}>
                  {t('zigbee_toolkit.bat_note')}
                </div>
              </div>
            )}
            {!batteryResult && (
              <div className="card"><p style={{ color: 'var(--text-muted)' }}>{t('zigbee_toolkit.bat_fill_all')}</p></div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 4: Frame Decoder ── */}
      {activeTab === 'frame' && (
        <div>
          <div className="card">
            <div className="card-title">{t('zigbee_toolkit.frame_title')}</div>

            {/* Mode toggle */}
            <div className="btn-row" style={{ marginBottom: 14 }}>
              <button className={`btn btn-sm ${frameMode === 'decode' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFrameMode('decode')}>{t('zigbee_toolkit.frame_mode_decode')}</button>
              <button className={`btn btn-sm ${frameMode === 'encode' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFrameMode('encode')}>{t('zigbee_toolkit.frame_mode_encode')}</button>
            </div>

            {frameMode === 'decode' && (
              <div>
                <div className="field">
                  <label className="label">{t('zigbee_toolkit.frame_hex_input')}</label>
                  <input className="input" style={{ fontFamily: 'monospace' }} value={frameHex}
                    onChange={(e) => setFrameHex(e.target.value)}
                    placeholder="61 88 AB CD EF 00 00 00 01 00 DE AD" />
                  <span className="hint">{t('zigbee_toolkit.frame_hex_hint')}</span>
                </div>

                {frameDecoded.err ? (
                  <Err msg={frameDecoded.err} />
                ) : (
                  <div>
                    {/* Frame Control Field */}
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: 'var(--text-primary)' }}>
                        {t('zigbee_toolkit.frame_fcf')}
                        <span style={{ fontFamily: 'monospace', fontWeight: 400, marginLeft: 8 }}>0x{frameDecoded.fcf}</span>
                      </div>
                      <div style={{ fontFamily: 'monospace', fontSize: 12, background: 'var(--bg-secondary)', padding: '6px 8px', borderRadius: 4, letterSpacing: 2, color: 'var(--text-muted)', marginBottom: 8 }}>
                        {frameDecoded.fcfBin}
                        <div style={{ fontSize: 10, letterSpacing: 0.5 }}>15&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;0</div>
                      </div>
                      <div className="result-grid">
                        <ResultItem label={t('zigbee_toolkit.frame_type')} value={`${frameDecoded.frameType} – ${frameDecoded.frameTypeName}`} />
                        <ResultItem label={t('zigbee_toolkit.frame_security')} value={frameDecoded.securityEnabled ? t('zigbee_toolkit.frame_yes') : t('zigbee_toolkit.frame_no')} />
                        <ResultItem label={t('zigbee_toolkit.frame_pending')} value={frameDecoded.framePending ? t('zigbee_toolkit.frame_yes') : t('zigbee_toolkit.frame_no')} />
                        <ResultItem label={t('zigbee_toolkit.frame_ack_req')} value={frameDecoded.ackRequest ? t('zigbee_toolkit.frame_yes') : t('zigbee_toolkit.frame_no')} />
                        <ResultItem label={t('zigbee_toolkit.frame_pan_compress')} value={frameDecoded.panIdCompression ? t('zigbee_toolkit.frame_yes') : t('zigbee_toolkit.frame_no')} />
                        <ResultItem label={t('zigbee_toolkit.frame_dst_mode')} value={`${frameDecoded.dstAddrMode} – ${frameDecoded.dstAddrModeName}`} />
                        <ResultItem label={t('zigbee_toolkit.frame_src_mode')} value={`${frameDecoded.srcAddrMode} – ${frameDecoded.srcAddrModeName}`} />
                        <ResultItem label={t('zigbee_toolkit.frame_version')} value={frameDecoded.frameVersionName} />
                      </div>
                    </div>

                    {/* Addressing */}
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('zigbee_toolkit.frame_addressing')}</div>
                    <div className="result-grid">
                      <ResultItem label={t('zigbee_toolkit.frame_seq_num')} value={frameDecoded.seqNum} />
                      {frameDecoded.dstPAN && <ResultItem label={t('zigbee_toolkit.frame_dst_pan')} value={frameDecoded.dstPAN} />}
                      {frameDecoded.dstAddr && <ResultItem label={t('zigbee_toolkit.frame_dst_addr')} value={frameDecoded.dstAddr} />}
                      {frameDecoded.srcPAN && <ResultItem label={t('zigbee_toolkit.frame_src_pan')} value={frameDecoded.srcPAN} />}
                      {frameDecoded.srcAddr && <ResultItem label={t('zigbee_toolkit.frame_src_addr')} value={frameDecoded.srcAddr} />}
                    </div>

                    {/* Payload */}
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{t('zigbee_toolkit.frame_payload')} ({frameDecoded.payloadLen} {t('zigbee_toolkit.frame_bytes')})</div>
                      <div style={{ fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-secondary)', padding: '8px 10px', borderRadius: 4, wordBreak: 'break-all' }}>
                        {frameDecoded.payloadHex || '—'}
                      </div>
                      {frameDecoded.fcsHex && (
                        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--text-muted)' }}>
                          {t('zigbee_toolkit.frame_fcs')}: <span style={{ fontFamily: 'monospace' }}>{frameDecoded.fcsHex}</span>
                        </div>
                      )}
                      <div style={{ marginTop: 4, fontSize: 12, color: 'var(--text-muted)' }}>
                        {t('zigbee_toolkit.frame_total_bytes')}: {frameDecoded.totalBytes}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {frameMode === 'encode' && (
              <div className="two-col">
                <div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.frame_type')}</label>
                    <select className="select" value={encFrameType} onChange={(e) => setEncFrameType(e.target.value)}>
                      {FRAME_TYPES.map((ft, i) => <option key={i} value={i}>{i} – {ft}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.frame_version')}</label>
                    <select className="select" value={encFrameVer} onChange={(e) => setEncFrameVer(e.target.value)}>
                      {FRAME_VERSIONS.slice(0, 3).map((fv, i) => <option key={i} value={i}>{fv}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.frame_dst_mode')}</label>
                    <select className="select" value={encDstMode} onChange={(e) => setEncDstMode(e.target.value)}>
                      {[0, 2, 3].map((m) => <option key={m} value={m}>{m} – {ADDR_MODES[m]}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.frame_src_mode')}</label>
                    <select className="select" value={encSrcMode} onChange={(e) => setEncSrcMode(e.target.value)}>
                      {[0, 2, 3].map((m) => <option key={m} value={m}>{m} – {ADDR_MODES[m]}</option>)}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.frame_seq_num')}</label>
                    <input className="input" type="number" min="0" max="255" value={encSeqNum} onChange={(e) => setEncSeqNum(e.target.value)} />
                  </div>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
                    {[
                      [encAckReq, setEncAckReq, 'frame_ack_req'],
                      [encSecurity, setEncSecurity, 'frame_security'],
                      [encFramePending, setEncFramePending, 'frame_pending'],
                      [encPanCompress, setEncPanCompress, 'frame_pan_compress'],
                    ].map(([val, setter, key]) => (
                      <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                        <input type="checkbox" checked={val} onChange={(e) => setter(e.target.checked)} />
                        {t(`zigbee_toolkit.${key}`)}
                      </label>
                    ))}
                  </div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.frame_dst_pan')}</label>
                    <input className="input" style={{ fontFamily: 'monospace' }} value={encDstPAN} onChange={(e) => setEncDstPAN(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.frame_dst_addr')}</label>
                    <input className="input" style={{ fontFamily: 'monospace' }} value={encDstAddr} onChange={(e) => setEncDstAddr(e.target.value)} />
                  </div>
                  {!encPanCompress && (
                    <div className="field">
                      <label className="label">{t('zigbee_toolkit.frame_src_pan')}</label>
                      <input className="input" style={{ fontFamily: 'monospace' }} value={encSrcPAN} onChange={(e) => setEncSrcPAN(e.target.value)} />
                    </div>
                  )}
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.frame_src_addr')}</label>
                    <input className="input" style={{ fontFamily: 'monospace' }} value={encSrcAddr} onChange={(e) => setEncSrcAddr(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('zigbee_toolkit.frame_payload')}</label>
                    <input className="input" style={{ fontFamily: 'monospace' }} value={encPayload} onChange={(e) => setEncPayload(e.target.value)} />
                    <span className="hint">{t('zigbee_toolkit.frame_hex_hint')}</span>
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{t('zigbee_toolkit.frame_encoded_output')}</div>
                  <div style={{ fontFamily: 'monospace', fontSize: 13, background: 'var(--bg-secondary)', padding: '10px 12px', borderRadius: 6, wordBreak: 'break-all', minHeight: 60, border: '1px solid var(--border)' }}>
                    {encodedFrame || '—'}
                  </div>
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                    {t('zigbee_toolkit.frame_encode_note')}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── TAB 5: Power & Link Budget ── */}
      {activeTab === 'linkbudget' && (
        <div className="two-col">
          <div className="card">
            <div className="card-title">{t('zigbee_toolkit.lb_title')}</div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.lb_freq')}</label>
              <select className="select" value={lbFreq} onChange={(e) => setLbFreq(e.target.value)}>
                {FREQ_OPTIONS.map((f) => (
                  <option key={f.MHz} value={f.MHz}>{f.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.lb_tx_power')}</label>
              <input className="input" type="number" min="-20" max="30" step="1" value={lbTxPower}
                onChange={(e) => setLbTxPower(e.target.value)} />
              <span className="hint">{t('zigbee_toolkit.lb_tx_hint')}</span>
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.lb_tx_gain')}</label>
              <input className="input" type="number" min="-10" max="20" step="0.5" value={lbTxGain}
                onChange={(e) => setLbTxGain(e.target.value)} />
              <span className="hint">{t('zigbee_toolkit.lb_gain_hint')}</span>
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.lb_rx_sens')}</label>
              <input className="input" type="number" min="-130" max="-50" step="0.5" value={lbRxSens}
                onChange={(e) => setLbRxSens(e.target.value)} />
              <span className="hint">{t('zigbee_toolkit.lb_rx_sens_hint')}</span>
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.lb_rx_gain')}</label>
              <input className="input" type="number" min="-10" max="20" step="0.5" value={lbRxGain}
                onChange={(e) => setLbRxGain(e.target.value)} />
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.lb_fade_margin')}</label>
              <input className="input" type="number" min="0" max="40" step="1" value={lbFadeMargin}
                onChange={(e) => setLbFadeMargin(e.target.value)} />
              <span className="hint">{t('zigbee_toolkit.lb_fade_hint')}</span>
            </div>

            <div className="field">
              <label className="label">{t('zigbee_toolkit.lb_distance')}</label>
              <input className="input" type="number" min="1" max="100000" step="1" value={lbDist}
                onChange={(e) => setLbDist(e.target.value)} />
              <span className="hint">{t('zigbee_toolkit.lb_dist_hint')}</span>
            </div>
          </div>

          <div>
            {linkResult && (
              <div className="card">
                <div className="card-title">{t('common.results')}</div>
                <div className="result-grid">
                  <ResultItem label={t('zigbee_toolkit.lb_fspl')} value={`${linkResult.fspl.toFixed(1)} dB`} />
                  <ResultItem label={t('zigbee_toolkit.lb_link_budget')} value={`${linkResult.linkBudget.toFixed(1)} dB`} />
                  <ResultItem label={t('zigbee_toolkit.lb_link_margin')}
                    value={`${linkResult.linkMargin.toFixed(1)} dB ${linkResult.linkMargin >= 0 ? '✓' : '✗'}`} />
                  <ResultItem label={t('zigbee_toolkit.lb_max_range_outdoor')} value={fmtDist(linkResult.maxRangeFreeSpaceM)} />
                  <ResultItem label={t('zigbee_toolkit.lb_max_range_indoor')} value={fmtDist(linkResult.maxRangeIndoorM)} />
                </div>

                {/* Rec TX power */}
                {(() => {
                  const rec = recTxPower(
                    parseFloat(lbDist), parseFloat(lbFreq), parseFloat(lbRxSens),
                    parseFloat(lbFadeMargin), parseFloat(lbRxGain), parseFloat(lbTxGain)
                  );
                  return (
                    <div style={{ marginTop: 12, padding: 10, background: 'var(--bg-secondary)', borderRadius: 6, fontSize: 13 }}>
                      <div style={{ color: 'var(--text-muted)', marginBottom: 4 }}>{t('zigbee_toolkit.lb_rec_tx_power')}</div>
                      <strong>{rec.toFixed(1)} dBm</strong>
                      {' '}<span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{t('zigbee_toolkit.lb_rec_note')}</span>
                    </div>
                  );
                })()}

                {linkResult.linkMargin < 0 && (
                  <div className="err" style={{ marginTop: 10 }}>
                    {t('zigbee_toolkit.lb_insufficient_margin')}
                  </div>
                )}

                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)', borderLeft: '3px solid var(--accent)', paddingLeft: 8 }}>
                  {t('zigbee_toolkit.lb_note')}
                </div>
              </div>
            )}

            {/* Sub-GHz note */}
            <div className="card" style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                <strong style={{ display: 'block', marginBottom: 6 }}>{t('zigbee_toolkit.lb_subghz_title')}</strong>
                {t('zigbee_toolkit.lb_subghz_note')}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TAB 6: IoT Protocol Comparison ── */}
      {activeTab === 'compare' && (
        <div className="card">
          <div className="card-title">{t('zigbee_toolkit.cmp_title')}</div>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            {t('zigbee_toolkit.cmp_desc')}
          </p>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--text-muted)', background: 'var(--bg-secondary)' }}>
                  {[
                    'cmp_col_protocol', 'cmp_col_freq', 'cmp_col_data_rate', 'cmp_col_range',
                    'cmp_col_max_nodes', 'cmp_col_power', 'cmp_col_mesh',
                    'cmp_col_security', 'cmp_col_use_cases',
                  ].map((k) => (
                    <th key={k} style={{ textAlign: 'left', padding: '8px 10px', fontWeight: 600 }}>
                      {t(`zigbee_toolkit.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ZIGBEE_PROTOCOLS.map((p, i) => (
                  <tr key={p.name} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--bg-secondary)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 700 }}>
                      {p.name}
                      <div style={{ fontWeight: 400, fontSize: 11, color: 'var(--text-muted)' }}>{p.standard}</div>
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>{p.freq}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>{p.dataRate}</td>
                    <td style={{ padding: '8px 10px' }}>{p.range}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{p.maxNodes}</td>
                    <td style={{ padding: '8px 10px' }}>
                      <span className={`badge ${p.powerBadge}`}>{t(`zigbee_toolkit.protocols.${p.id}.power`)}</span>
                    </td>
                    <td style={{ padding: '8px 10px' }}>
                      <span className={`badge ${p.meshBadge}`}>{p.mesh ? t('zigbee_toolkit.cmp_yes') : t('zigbee_toolkit.cmp_no')}</span>
                    </td>
                    <td style={{ padding: '8px 10px', fontFamily: 'monospace', fontSize: 12 }}>{p.security}</td>
                    <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--text-muted)' }}>{t(`zigbee_toolkit.protocols.${p.id}.useCases`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div style={{ marginTop: 14, fontSize: 12, color: 'var(--text-muted)', borderLeft: '3px solid var(--accent)', paddingLeft: 8 }}>
            {t('zigbee_toolkit.cmp_note')}
          </div>
        </div>
      )}
    </div>
  );
}

window.ZigbeeToolkit = ZigbeeToolkit;
