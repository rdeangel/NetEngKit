const { useEffect, useCallback, useMemo, useRef } = React;

// <ipsla-math>
// Synthetic probe cost. A udp-jitter operation is a burst of N packets spaced
// `interval` ms apart, repeated every `frequency` seconds. The burst is what the
// link actually sees; the average is what capacity planning sees. Both matter and
// they differ by the duty cycle.
const IPSLA_IP_UDP_OVERHEAD = 28;    // 20 B IPv4 header + 8 B UDP header

// Layer-3 bytes on the wire for one probe packet. `codecSize` is the Cisco
// codec-size value, which is the RTP payload PLUS the 12-byte RTP header.
function ipslaPacketL3Bytes(codecSize) {
  return codecSize + IPSLA_IP_UDP_OVERHEAD;
}

// Bit rate while the burst is in flight. For G.711 at 172 B / 20 ms this is the
// textbook 80 kbps; for G.729A at 32 B / 20 ms it is 24 kbps.
function ipslaBurstBps(codecSize, intervalMs) {
  if (!isFinite(codecSize) || !isFinite(intervalMs) || intervalMs <= 0) return NaN;
  return (ipslaPacketL3Bytes(codecSize) * 8) / (intervalMs / 1000);
}

// Seconds the burst occupies. N packets at `interval` ms.
function ipslaBurstSeconds(numPackets, intervalMs) {
  if (!isFinite(numPackets) || !isFinite(intervalMs)) return NaN;
  return (numPackets * intervalMs) / 1000;
}

// Rate averaged over the repeat period. This is the number to hand a capacity
// plan; the burst number is the one that fills a shaper.
function ipslaAvgBps(codecSize, numPackets, frequencySec) {
  if (!isFinite(frequencySec) || frequencySec <= 0) return NaN;
  return (ipslaPacketL3Bytes(codecSize) * numPackets * 8) / frequencySec;
}

// Fraction of the repeat period spent probing. Over 100% means the next
// operation is due before this one has finished — IOS will not run it cleanly.
function ipslaDutyPct(numPackets, intervalMs, frequencySec) {
  const burst = ipslaBurstSeconds(numPackets, intervalMs);
  if (!isFinite(burst) || !isFinite(frequencySec) || frequencySec <= 0) return NaN;
  return (burst / frequencySec) * 100;
}
// </ipsla-math>

const IPSLA_TABS    = ['ipsla', 'twamp', 'reference'];
const TWAMP_VENDORS = ['cisco_iosxe', 'junos'];
const TWAMP_ROLES   = ['sender', 'reflector'];
const TWAMP_MODES   = ['full', 'light'];

// Per-probe capability table.
const IPSLA_PROBES = [
  { id: 'icmp_echo',  srcIface: true,  srcIp: true,  srcPort: false, port: false,
    codec: false, reactLoss: false, reactJitter: false, responder: false },
  { id: 'udp_jitter', srcIface: false, srcIp: true,  srcPort: true,  port: true,
    codec: true,  reactLoss: true,  reactJitter: true,  responder: true },
  { id: 'http',       srcIface: false, srcIp: true,  srcPort: true,  port: false,
    codec: false, reactLoss: false, reactJitter: false, responder: false },
  { id: 'dns',        srcIface: false, srcIp: true,  srcPort: true,  port: false,
    codec: false, reactLoss: false, reactJitter: false, responder: false },
];

const IPSLA_CODECS = [
  { id: 'g711alaw', cli: 'g711alaw', size: 172, interval: 20, packets: 1000 },
  { id: 'g711ulaw', cli: 'g711ulaw', size: 172, interval: 20, packets: 1000 },
  { id: 'g729a',    cli: 'g729a',    size: 32,  interval: 20, packets: 1000 },
];

const IPSLA_REACTIONS = [
  { id: 'timeout',       cli: 'timeout',       valued: false, needs: null },
  { id: 'rtt',           cli: 'rtt',           valued: true,  needs: null },
  { id: 'packetLossSD',  cli: 'packetLossSD',  valued: true,  needs: 'reactLoss' },
  { id: 'jitterAvg',     cli: 'jitterAvg',     valued: true,  needs: 'reactJitter' },
];
const IPSLA_THRESHOLD_TYPES = ['immediate', 'consecutive', 'average', 'never'];
const IPSLA_ACTION_TYPES    = ['trapOnly', 'none'];

const TWAMP_LIGHT_PORTS = ['862', '878', '51000'];
const TWAMP_DEFAULT_CONTROL_PORT = '862';

const IPSLA_PRESETS = {
  voip: { probe: 'udp_jitter', target: '10.10.20.1', destPort: '16384', codec: 'g711alaw',
          frequency: '60', timeout: '5000', threshold: '2000', trackEnable: false,
          reactEnable: true, reactJitterUpper: '30', reactJitterLower: '20' },
  wan:  { probe: 'icmp_echo',  target: '203.0.113.1', sourceMode: 'iface', sourceIface: 'GigabitEthernet0/0/1',
          frequency: '10', timeout: '1000', threshold: '400', trackEnable: true,
          trackNumber: '1', trackType: 'reachability', trackDelayDown: '15', trackDelayUp: '10',
          reactEnable: false },
  dns:  { probe: 'dns', target: 'www.example.com', nameServer: '10.0.0.53',
          frequency: '300', timeout: '5000', threshold: '2000',
          trackEnable: false, reactEnable: true },
};

function ipslaMaybeRewrite(cur, prevDefault, nextDefault) {
  const s = String(cur).trim();
  if (!s || s === String(prevDefault)) return String(nextDefault);
  return cur;
}

function ipslaDownloadTxt(content, filename) {
  const blob = new Blob([content + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function IpSlaTwampBuilder({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  // Navigation
  const [activeTab, setActiveTab] = usePersistentState('ipsla:activeTab', initialData?.activeTab ?? 'ipsla');

  // Tab 1: IP SLA inputs
  const [opNumber, setOpNumber] = usePersistentState('ipsla:op', initialData?.opNumber ?? '10');
  const [probe, setProbe] = usePersistentState('ipsla:probe', initialData?.probe ?? 'udp_jitter');
  const [target, setTarget] = usePersistentState('ipsla:target', initialData?.target ?? '10.10.20.1');
  const [destPort, setDestPort] = usePersistentState('ipsla:dest_port', initialData?.destPort ?? '16384');
  const [nameServer, setNameServer] = usePersistentState('ipsla:name_server', initialData?.nameServer ?? '10.0.0.53');
  const [httpUrl, setHttpUrl] = usePersistentState('ipsla:http_url', initialData?.httpUrl ?? 'http://10.10.20.1/');
  const [codec, setCodec] = usePersistentState('ipsla:codec', initialData?.codec ?? 'g711alaw');
  const [numPackets, setNumPackets] = usePersistentState('ipsla:num_packets', initialData?.numPackets ?? '1000');
  const [packetInterval, setPacketInterval] = usePersistentState('ipsla:pkt_interval', initialData?.packetInterval ?? '20');
  const [packetSize, setPacketSize] = usePersistentState('ipsla:pkt_size', initialData?.packetSize ?? '172');
  const [advFactor, setAdvFactor] = usePersistentState('ipsla:adv_factor', initialData?.advFactor ?? '');
  const [sourceMode, setSourceMode] = usePersistentState('ipsla:src_mode', initialData?.sourceMode ?? 'none');
  const [sourceIp, setSourceIp] = usePersistentState('ipsla:src_ip', initialData?.sourceIp ?? '');
  const [sourceIface, setSourceIface] = usePersistentState('ipsla:src_iface', initialData?.sourceIface ?? 'GigabitEthernet0/0/1');
  const [srcPort, setSrcPort] = usePersistentState('ipsla:srcPort', initialData?.srcPort ?? initialData?.sourcePort ?? '');
  const [vrf, setVrf] = usePersistentState('ipsla:vrf', initialData?.vrf ?? '');
  const [frequency, setFrequency] = usePersistentState('ipsla:frequency', initialData?.frequency ?? '60');
  const [timeout, setTimeout] = usePersistentState('ipsla:timeout', initialData?.timeout ?? '5000');
  const [threshold, setThreshold] = usePersistentState('ipsla:threshold', initialData?.threshold ?? '2000');
  const [tag, setTag] = usePersistentState('ipsla:tag', initialData?.tag ?? '');
  const [owner, setOwner] = usePersistentState('ipsla:owner', initialData?.owner ?? '');
  const [historyEnable, setHistoryEnable] = usePersistentState('ipsla:history_en', initialData?.historyEnable ?? false);
  const [historyInterval, setHistoryInterval] = usePersistentState('ipsla:history_int', initialData?.historyInterval ?? '300');
  const [historyBuckets, setHistoryBuckets] = usePersistentState('ipsla:history_bkt', initialData?.historyBuckets ?? '10');
  const [lifeMode, setLifeMode] = usePersistentState('ipsla:life_mode', initialData?.lifeMode ?? 'forever');
  const [lifeSeconds, setLifeSeconds] = usePersistentState('ipsla:life_secs', initialData?.lifeSeconds ?? '86400');
  const [startMode, setStartMode] = usePersistentState('ipsla:start_mode', initialData?.startMode ?? 'now');
  const [startAfter, setStartAfter] = usePersistentState('ipsla:start_after', initialData?.startAfter ?? '00:01:00');
  const [trackEnable, setTrackEnable] = usePersistentState('ipsla:track_en', initialData?.trackEnable ?? false);
  const [trackNumber, setTrackNumber] = usePersistentState('ipsla:track_num', initialData?.trackNumber ?? '1');
  const [trackType, setTrackType] = usePersistentState('ipsla:track_type', initialData?.trackType ?? 'reachability');
  const [trackDelayDown, setTrackDelayDown] = usePersistentState('ipsla:track_down', initialData?.trackDelayDown ?? '15');
  const [trackDelayUp, setTrackDelayUp] = usePersistentState('ipsla:track_up', initialData?.trackDelayUp ?? '10');
  const [reactEnable, setReactEnable] = usePersistentState('ipsla:react_en', initialData?.reactEnable ?? false);
  const [reactElement, setReactElement] = usePersistentState('ipsla:react_el', initialData?.reactElement ?? 'timeout');
  const [reactUpper, setReactUpper] = usePersistentState('ipsla:react_up', initialData?.reactUpper ?? '30');
  const [reactLower, setReactLower] = usePersistentState('ipsla:react_low', initialData?.reactLower ?? '20');
  const [reactThType, setReactThType] = usePersistentState('ipsla:react_tht', initialData?.reactThType ?? 'immediate');
  const [reactOccurrences, setReactOccurrences] = usePersistentState('ipsla:react_occ', initialData?.reactOccurrences ?? '3');
  const [reactAction, setReactAction] = usePersistentState('ipsla:react_act', initialData?.reactAction ?? 'trapOnly');

  // Tab 2: TWAMP inputs
  const [twVendor, setTwVendor] = usePersistentState('ipsla:tw_vendor', initialData?.twVendor ?? 'junos');
  const [twRole, setTwRole] = usePersistentState('ipsla:tw_role', initialData?.twRole ?? 'sender');
  const [twMode, setTwMode] = usePersistentState('ipsla:tw_mode', initialData?.twMode ?? 'full');
  const [twServerAddr, setTwServerAddr] = usePersistentState('ipsla:tw_server', initialData?.twServerAddr ?? '10.70.70.1');
  const [twTarget, setTwTarget] = usePersistentState('ipsla:tw_target', initialData?.twTarget ?? '10.70.70.1');
  const [twControlPort, setTwControlPort] = usePersistentState('ipsla:tw_cport', initialData?.twControlPort ?? TWAMP_DEFAULT_CONTROL_PORT);
  const [twTestPort, setTwTestPort] = usePersistentState('ipsla:tw_tport', initialData?.twTestPort ?? (initialData?.twMode === 'light' ? TWAMP_DEFAULT_CONTROL_PORT : '862'));
  const [twCcName, setTwCcName] = usePersistentState('ipsla:tw_cc', initialData?.twCcName ?? 'TWAMP-CC1');
  const [twTsName, setTwTsName] = usePersistentState('ipsla:tw_ts', initialData?.twTsName ?? 'TWAMP-TS1');
  const [twProbeCount, setTwProbeCount] = usePersistentState('ipsla:tw_count', initialData?.twProbeCount ?? '100');
  const [twProbeInterval, setTwProbeInterval] = usePersistentState('ipsla:tw_pint', initialData?.twProbeInterval ?? '1');
  const [twTestInterval, setTwTestInterval] = usePersistentState('ipsla:tw_tint', initialData?.twTestInterval ?? '60');
  const [twPadding, setTwPadding] = usePersistentState('ipsla:tw_pad', initialData?.twPadding ?? '200');
  const [twHistorySize, setTwHistorySize] = usePersistentState('ipsla:tw_hist', initialData?.twHistorySize ?? '500');
  const [twClientList, setTwClientList] = usePersistentState('ipsla:tw_clist', initialData?.twClientList ?? 'TWAMP-CLIENTS');
  const [twClientPrefix, setTwClientPrefix] = usePersistentState('ipsla:tw_cpfx', initialData?.twClientPrefix ?? '10.60.60.1/32');
  const [twInactivity, setTwInactivity] = usePersistentState('ipsla:tw_inact', initialData?.twInactivity ?? '900');
  const [twReflectorTimeout, setTwReflectorTimeout] = usePersistentState('ipsla:tw_rtimeout', initialData?.twReflectorTimeout ?? '2000');

  // Nav sync
  const skipNavReport = useRef(false);

  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
  }, [initialData]);

  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  // Share payload
  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'ipsla-twamp',
      activeTab,
      opNumber, probe, target, destPort, nameServer, httpUrl,
      codec, numPackets, packetInterval, packetSize, advFactor,
      sourceMode, sourceIp, sourceIface, srcPort, vrf,
      frequency, timeout, threshold, tag, owner,
      historyEnable, historyInterval, historyBuckets,
      lifeMode, lifeSeconds, startMode, startAfter,
      trackEnable, trackNumber, trackType, trackDelayDown, trackDelayUp,
      reactEnable, reactElement, reactUpper, reactLower, reactThType, reactOccurrences, reactAction,
      twVendor, twRole, twMode, twServerAddr, twTarget, twControlPort, twTestPort,
      twCcName, twTsName, twProbeCount, twProbeInterval, twTestInterval, twPadding,
      twHistorySize, twClientList, twClientPrefix, twInactivity, twReflectorTimeout,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [
    onShare,
    activeTab,
    opNumber, probe, target, destPort, nameServer, httpUrl,
    codec, numPackets, packetInterval, packetSize, advFactor,
    sourceMode, sourceIp, sourceIface, srcPort, vrf,
    frequency, timeout, threshold, tag, owner,
    historyEnable, historyInterval, historyBuckets,
    lifeMode, lifeSeconds, startMode, startAfter,
    trackEnable, trackNumber, trackType, trackDelayDown, trackDelayUp,
    reactEnable, reactElement, reactUpper, reactLower, reactThType, reactOccurrences, reactAction,
    twVendor, twRole, twMode, twServerAddr, twTarget, twControlPort, twTestPort,
    twCcName, twTsName, twProbeCount, twProbeInterval, twTestInterval, twPadding,
    twHistorySize, twClientList, twClientPrefix, twInactivity, twReflectorTimeout,
  ]);

  // Preset loading
  const applyPreset = useCallback((key) => {
    const p = IPSLA_PRESETS[key];
    if (!p) return;
    if (p.probe !== undefined) setProbe(p.probe);
    if (p.target !== undefined) setTarget(p.target);
    if (p.destPort !== undefined) setDestPort(p.destPort);
    if (p.codec !== undefined) {
      setCodec(p.codec);
      const cDef = IPSLA_CODECS.find(c => c.id === p.codec);
      if (cDef) {
        setNumPackets(String(cDef.packets));
        setPacketInterval(String(cDef.interval));
        setPacketSize(String(cDef.size));
      }
    }
    if (p.sourceMode !== undefined) setSourceMode(p.sourceMode);
    if (p.sourceIface !== undefined) setSourceIface(p.sourceIface);
    if (p.nameServer !== undefined) setNameServer(p.nameServer);
    if (p.frequency !== undefined) setFrequency(p.frequency);
    if (p.timeout !== undefined) setTimeout(p.timeout);
    if (p.threshold !== undefined) setThreshold(p.threshold);
    if (p.trackEnable !== undefined) setTrackEnable(p.trackEnable);
    if (p.trackNumber !== undefined) setTrackNumber(p.trackNumber);
    if (p.trackType !== undefined) setTrackType(p.trackType);
    if (p.trackDelayDown !== undefined) setTrackDelayDown(p.trackDelayDown);
    if (p.trackDelayUp !== undefined) setTrackDelayUp(p.trackDelayUp);
    if (p.reactEnable !== undefined) setReactEnable(p.reactEnable);
    if (p.reactJitterUpper !== undefined) {
      setReactElement('jitterAvg');
      setReactUpper(p.reactJitterUpper);
      setReactLower(p.reactJitterLower ?? '20');
    }
  }, [setProbe, setTarget, setDestPort, setCodec, setNumPackets, setPacketInterval, setPacketSize, setSourceMode, setSourceIface, setNameServer, setFrequency, setTimeout, setThreshold, setTrackEnable, setTrackNumber, setTrackType, setTrackDelayDown, setTrackDelayUp, setReactEnable, setReactElement, setReactUpper, setReactLower]);

  // Codec change handling with non-destructive defaults rewrite
  const handleCodecChange = useCallback((newCodec) => {
    const prevCodecDef = IPSLA_CODECS.find(c => c.id === codec);
    const nextCodecDef = IPSLA_CODECS.find(c => c.id === newCodec);
    if (nextCodecDef) {
      const prevPackets = prevCodecDef ? prevCodecDef.packets : 1000;
      const prevInterval = prevCodecDef ? prevCodecDef.interval : 20;
      const prevSize = prevCodecDef ? prevCodecDef.size : 172;
      setNumPackets(ipslaMaybeRewrite(numPackets, prevPackets, nextCodecDef.packets));
      setPacketInterval(ipslaMaybeRewrite(packetInterval, prevInterval, nextCodecDef.interval));
      setPacketSize(ipslaMaybeRewrite(packetSize, prevSize, nextCodecDef.size));
    }
    setCodec(newCodec);
  }, [codec, numPackets, packetInterval, packetSize, setNumPackets, setPacketInterval, setPacketSize, setCodec]);

  // Derived validation - IP SLA
  const ipslaError = useMemo(() => {
    if (!String(target).trim()) return '';
    if (!/^\d+$/.test(String(opNumber).trim()) || Number(opNumber) < 1 || Number(opNumber) > 2147483647) {
      return t('ipsla_twamp.err_bad_op');
    }
    if (probe === 'dns' && !String(nameServer).trim()) return '';
    if (probe === 'udp_jitter') {
      const p = Number(destPort);
      if (!/^\d+$/.test(String(destPort).trim()) || p < 1 || p > 65535) {
        return t('ipsla_twamp.err_bad_port');
      }
    }
    if (String(srcPort).trim()) {
      const sp = Number(srcPort);
      if (!/^\d+$/.test(String(srcPort).trim()) || sp < 1 || sp > 65535) {
        return t('ipsla_twamp.err_bad_port');
      }
    }
    if (!String(frequency).trim() || !String(timeout).trim() || !String(threshold).trim()) return '';
    const freq = Number(frequency);
    if (!/^\d+$/.test(String(frequency).trim()) || freq <= 0) {
      return t('ipsla_twamp.err_bad_frequency');
    }
    const to = Number(timeout);
    if (!/^\d+$/.test(String(timeout).trim()) || to <= 0) {
      return t('ipsla_twamp.err_bad_timeout');
    }
    const th = Number(threshold);
    if (!/^\d+$/.test(String(threshold).trim()) || th <= 0) {
      return t('ipsla_twamp.err_bad_threshold');
    }
    const isTimingFocused = typeof document !== 'undefined' &&
      document.activeElement &&
      ['ipsla-freq', 'ipsla-timeout', 'ipsla-threshold'].includes(document.activeElement.id);
    if (!isTimingFocused && (th > to || to > freq * 1000)) {
      return t('ipsla_twamp.err_timing_order', { th: threshold, to: timeout, fr: frequency });
    }
    if (probe === 'udp_jitter') {
      const np = Number(numPackets);
      if (!/^\d+$/.test(String(numPackets).trim()) || np < 1 || np > 60000) {
        return t('ipsla_twamp.err_bad_packets');
      }
      const pi = Number(packetInterval);
      if (!/^\d+$/.test(String(packetInterval).trim()) || pi < 1 || pi > 60000) {
        return t('ipsla_twamp.err_bad_interval');
      }
      const ps = Number(packetSize);
      if (!/^\d+$/.test(String(packetSize).trim()) || ps < 16 || ps > 1500) {
        return t('ipsla_twamp.err_bad_size');
      }
    }
    if (historyEnable) {
      const hi = Number(historyInterval);
      const hb = Number(historyBuckets);
      if (!/^\d+$/.test(String(historyInterval).trim()) || hi <= 0 || !/^\d+$/.test(String(historyBuckets).trim()) || hb <= 0) {
        return t('ipsla_twamp.err_bad_history');
      }
    }
    if (lifeMode === 'seconds') {
      const ls = Number(lifeSeconds);
      if (!/^\d+$/.test(String(lifeSeconds).trim()) || ls < 1 || ls > 2147483647) {
        return t('ipsla_twamp.err_bad_life');
      }
    }
    if (startMode === 'after') {
      if (!/^\d{1,2}:\d{2}:\d{2}$/.test(String(startAfter).trim())) {
        return t('ipsla_twamp.err_bad_after');
      }
    }
    if (trackEnable) {
      const tn = Number(trackNumber);
      const dd = Number(trackDelayDown);
      const du = Number(trackDelayUp);
      if (!/^\d+$/.test(String(trackNumber).trim()) || tn < 1 || tn > 1000 ||
          !/^\d+$/.test(String(trackDelayDown).trim()) || dd < 0 || dd > 180 ||
          !/^\d+$/.test(String(trackDelayUp).trim()) || du < 0 || du > 180) {
        return t('ipsla_twamp.err_bad_track');
      }
    }
    if (reactEnable) {
      const rDef = IPSLA_REACTIONS.find(r => r.id === reactElement);
      if (rDef && rDef.valued) {
        const up = Number(reactUpper);
        const low = Number(reactLower);
        if (!/^\d+$/.test(String(reactUpper).trim()) || !/^\d+$/.test(String(reactLower).trim()) || up < low) {
          return t('ipsla_twamp.err_bad_react_values');
        }
      }
    }
    return '';
  }, [target, opNumber, probe, nameServer, destPort, srcPort, frequency, timeout, threshold, numPackets, packetInterval, packetSize, historyEnable, historyInterval, historyBuckets, lifeMode, lifeSeconds, startMode, startAfter, trackEnable, trackNumber, trackDelayDown, trackDelayUp, reactEnable, reactElement, reactUpper, reactLower, t]);

  // Derived validation - TWAMP
  const twampError = useMemo(() => {
    if (!String(twServerAddr).trim() || !String(twTarget).trim()) return '';
    const cp = Number(twControlPort);
    const tp = Number(twTestPort);
    if (!/^\d+$/.test(String(twControlPort).trim()) || cp < 1 || cp > 65535 ||
        !/^\d+$/.test(String(twTestPort).trim()) || tp < 1 || tp > 65535) {
      return t('ipsla_twamp.err_bad_port');
    }
    if (twMode === 'light' && twVendor === 'junos') {
      if (!TWAMP_LIGHT_PORTS.includes(String(twControlPort).trim()) || !TWAMP_LIGHT_PORTS.includes(String(twTestPort).trim())) {
        return t('ipsla_twamp.err_light_port');
      }
    }
    const pc = Number(twProbeCount);
    const pi = Number(twProbeInterval);
    const ti = Number(twTestInterval);
    const pad = Number(twPadding);
    const hist = Number(twHistorySize);
    if (!/^\d+$/.test(String(twProbeCount).trim()) || pc < 1 || pc > 255 ||
        !/^\d+$/.test(String(twProbeInterval).trim()) || pi < 1 || pi > 255 ||
        !/^\d+$/.test(String(twTestInterval).trim()) || ti < 1 || ti > 255 ||
        !/^\d+$/.test(String(twPadding).trim()) || pad < 0 || pad > 1500) {
      return t('ipsla_twamp.err_bad_twamp_probe');
    }
    if (!/^\d+$/.test(String(twHistorySize).trim()) || hist < pc) {
      return t('ipsla_twamp.err_bad_twamp_history');
    }
    return '';
  }, [twServerAddr, twTarget, twControlPort, twTestPort, twMode, twVendor, twProbeCount, twProbeInterval, twTestInterval, twPadding, twHistorySize, t]);

  // Derived probe budget
  const probeBudget = useMemo(() => {
    if (probe !== 'udp_jitter' || ipslaError) return null;
    const cDef = codec !== 'none' ? IPSLA_CODECS.find(c => c.id === codec) : null;
    const effSize = Number(String(packetSize).trim() || (cDef ? cDef.size : 172));
    const effInterval = Number(String(packetInterval).trim() || (cDef ? cDef.interval : 20));
    const effPackets = Number(String(numPackets).trim() || (cDef ? cDef.packets : 1000));
    const freqSec = Number(frequency);

    const packetL3 = ipslaPacketL3Bytes(effSize);
    const burstBps = ipslaBurstBps(effSize, effInterval);
    const burstSeconds = ipslaBurstSeconds(effPackets, effInterval);
    const avgBps = ipslaAvgBps(effSize, effPackets, freqSec);
    const dutyPct = ipslaDutyPct(effPackets, effInterval, freqSec);
    const pps = effInterval > 0 ? (1000 / effInterval) : NaN;

    return { packetL3, burstBps, burstSeconds, avgBps, dutyPct, pps, effSize };
  }, [probe, ipslaError, codec, packetSize, packetInterval, numPackets, frequency]);

  // Cisco IP SLA config generator
  const ipslaConfig = useMemo(() => {
    if (ipslaError) return '';
    if (!String(target).trim() || !String(opNumber).trim() || !String(frequency).trim() || !String(timeout).trim() || !String(threshold).trim()) {
      return '';
    }
    if (probe === 'udp_jitter' && !String(destPort).trim()) return '';
    if (probe === 'dns' && !String(nameServer).trim()) return '';
    if (probe === 'http' && !String(httpUrl).trim()) return '';

    const lines = [];
    const push = l => lines.push(l);

    push(`! ${t('ipsla_twamp.cmt_ipsla_header')}`);
    push(`ip sla ${opNumber}`);

    let opLine = '';
    if (probe === 'icmp_echo') {
      opLine = `icmp-echo ${target}`;
      if (sourceMode === 'iface' && String(sourceIface).trim()) {
        opLine += ` source-interface ${sourceIface}`;
      } else if (sourceMode === 'ip' && String(sourceIp).trim()) {
        opLine += ` source-ip ${sourceIp}`;
      }
    } else if (probe === 'udp_jitter') {
      if (codec !== 'none') {
        const cDef = IPSLA_CODECS.find(c => c.id === codec);
        const cName = cDef ? cDef.cli : codec;
        const nPackets = String(numPackets).trim() || (cDef ? cDef.packets : '1000');
        const pSize = String(packetSize).trim() || (cDef ? cDef.size : '172');
        const pInterval = String(packetInterval).trim() || (cDef ? cDef.interval : '20');
        opLine = `udp-jitter ${target} ${destPort} codec ${cName} codec-numpackets ${nPackets} codec-size ${pSize} codec-interval ${pInterval}`;
        if (String(advFactor).trim()) {
          opLine += ` advantage-factor ${advFactor}`;
        }
      } else {
        opLine = `udp-jitter ${target} ${destPort} num-packets ${numPackets} interval ${packetInterval}`;
      }
      if (sourceMode === 'ip' && String(sourceIp).trim()) {
        opLine += ` source-ip ${sourceIp}`;
      }
      if (String(srcPort).trim()) {
        opLine += ` source-port ${srcPort}`;
      }
    } else if (probe === 'http') {
      opLine = `http get ${httpUrl}`;
      if (sourceMode === 'ip' && String(sourceIp).trim()) {
        opLine += ` source-ip ${sourceIp}`;
      }
      if (String(srcPort).trim()) {
        opLine += ` source-port ${srcPort}`;
      }
    } else if (probe === 'dns') {
      opLine = `dns ${target} name-server ${nameServer}`;
      if (sourceMode === 'ip' && String(sourceIp).trim()) {
        opLine += ` source-ip ${sourceIp}`;
      }
      if (String(srcPort).trim()) {
        opLine += ` source-port ${srcPort}`;
      }
    }
    push(` ${opLine}`);

    if (String(vrf).trim()) push(` vrf ${vrf}`);
    push(` frequency ${frequency}`);
    push(` timeout ${timeout}`);
    push(` threshold ${threshold}`);
    if (String(tag).trim()) push(` tag ${tag}`);
    if (String(owner).trim()) push(` owner ${owner}`);
    if (historyEnable) {
      push(` history enhanced interval ${historyInterval} buckets ${historyBuckets}`);
    }
    push('!');

    const lifeVal = lifeMode === 'forever' ? 'forever' : lifeSeconds;
    const startVal = startMode === 'now' ? 'now' : `after ${startAfter}`;
    push(`ip sla schedule ${opNumber} life ${lifeVal} start-time ${startVal}`);

    if (trackEnable) {
      push('!');
      push(`! ${t('ipsla_twamp.cmt_track_note')}`);
      push(`track ${trackNumber} ip sla ${opNumber} ${trackType}`);
      push(` delay down ${trackDelayDown} up ${trackDelayUp}`);
    }

    if (reactEnable) {
      const rDef = IPSLA_REACTIONS.find(r => r.id === reactElement);
      const pDef = IPSLA_PROBES.find(p => p.id === probe);
      const unsupported = rDef && rDef.needs && (!pDef || !pDef[rDef.needs]);
      if (!unsupported) {
        push('!');
        push(`! ${t('ipsla_twamp.cmt_reaction_note')}`);
        let reactLine = `ip sla reaction-configuration ${opNumber} react ${rDef ? rDef.cli : reactElement}`;
        if (rDef && rDef.valued) {
          reactLine += ` threshold-value ${reactUpper} ${reactLower}`;
        }
        reactLine += ` threshold-type ${reactThType}`;
        if (reactThType === 'consecutive' || reactThType === 'average') {
          reactLine += ` ${reactOccurrences}`;
        }
        reactLine += ` action-type ${reactAction}`;
        push(reactLine);
        if (reactAction === 'trapOnly') {
          push('ip sla logging traps');
        }
      }
    }

    push('!');
    push(`! ${t('ipsla_twamp.cmt_verify')}`);
    push(`! show ip sla configuration ${opNumber}`);
    push(`! show ip sla statistics ${opNumber}`);
    if (trackEnable) {
      push(`! show track ${trackNumber}`);
    }

    return lines.join('\n');
  }, [ipslaError, target, opNumber, frequency, timeout, threshold, probe, destPort, nameServer, httpUrl, sourceMode, sourceIface, sourceIp, srcPort, codec, numPackets, packetSize, packetInterval, advFactor, vrf, tag, owner, historyEnable, historyInterval, historyBuckets, lifeMode, lifeSeconds, startMode, startAfter, trackEnable, trackNumber, trackType, trackDelayDown, trackDelayUp, reactEnable, reactElement, reactUpper, reactLower, reactThType, reactOccurrences, reactAction, t]);

  // Responder configuration card (UDP jitter only)
  const responderConfig = useMemo(() => {
    const pDef = IPSLA_PROBES.find(p => p.id === probe);
    if (!pDef || !pDef.responder || ipslaError) return '';
    const lines = [
      `! ${t('ipsla_twamp.cmt_responder_far_end')}`,
      'ip sla responder',
    ];
    return lines.join('\n');
  }, [probe, ipslaError, t]);

  // TWAMP config generator
  const twampConfig = useMemo(() => {
    const isCiscoUnsupported = twVendor === 'cisco_iosxe' && (twRole === 'sender' || twMode === 'light');
    if (!isCiscoUnsupported) {
      if (twampError) return '';
      if (!String(twServerAddr).trim() || !String(twTarget).trim()) return '';
    }

    const lines = [];
    const push = l => lines.push(l);

    if (twVendor === 'cisco_iosxe') {
      if (twRole === 'reflector') {
        if (twMode === 'full') {
          push(`! ${t('ipsla_twamp.cmt_twamp_cisco_header')}`);
          push('ip sla server twamp');
          push(` port ${twControlPort}`);
          push(` timer inactivity ${twInactivity}`);
          push('!');
          push('ip sla responder twamp');
          push(` timeout ${twReflectorTimeout}`);
          push('!');
          push(`! ${t('ipsla_twamp.cmt_twamp_cisco_same_device')}`);
          push(`! ${t('ipsla_twamp.cmt_verify')}`);
          push('! show ip sla twamp connection requests');
          push('! show ip sla twamp session');
        } else {
          // cisco_iosxe + reflector + light
          push(`! ${t('ipsla_twamp.cmt_twamp_cisco_header')}`);
          push(`! ${t('ipsla_twamp.cmt_twamp_cisco_light_unsupported')}`);
        }
      } else {
        // cisco_iosxe + sender + any mode
        push(`! ${t('ipsla_twamp.cmt_twamp_cisco_header')}`);
        push(`! ${t('ipsla_twamp.cmt_twamp_cisco_sender_unsupported')}`);
        push(`! ${t('ipsla_twamp.cmt_twamp_see_junos')}`);
      }
    } else if (twVendor === 'junos') {
      if (twRole === 'sender') {
        push(`# ${t('ipsla_twamp.cmt_twamp_junos_header')}`);
        if (twMode !== 'light') {
          push(`set services rpm twamp client control-connection ${twCcName} target-address ${twServerAddr}`);
        }
        push(`set services rpm twamp client control-connection ${twCcName} destination-port ${twControlPort}`);
        if (twMode === 'full') {
          push(`set services rpm twamp client control-connection ${twCcName} authentication-mode none`);
        } else {
          push(`set services rpm twamp client control-connection ${twCcName} control-type light`);
        }
        push(`set services rpm twamp client control-connection ${twCcName} test-interval ${twTestInterval}`);
        push(`set services rpm twamp client control-connection ${twCcName} history-size ${twHistorySize}`);
        push(`set services rpm twamp client control-connection ${twCcName} test-session ${twTsName} target-address ${twTarget}`);
        if (twMode === 'light') {
          push(`set services rpm twamp client control-connection ${twCcName} test-session ${twTsName} destination-port ${twTestPort}`);
        }
        push(`set services rpm twamp client control-connection ${twCcName} test-session ${twTsName} probe-count ${twProbeCount}`);
        push(`set services rpm twamp client control-connection ${twCcName} test-session ${twTsName} probe-interval ${twProbeInterval}`);
        push(`set services rpm twamp client control-connection ${twCcName} test-session ${twTsName} data-size ${twPadding}`);
        push(`set services rpm twamp client control-connection ${twCcName} test-session ${twTsName} data-fill-with-zeros`);
        push('#');
        push(`# ${t('ipsla_twamp.cmt_verify')}`);
        push('# show services rpm twamp client session');
      } else {
        // junos + reflector
        push(`# ${t('ipsla_twamp.cmt_twamp_junos_header')}`);
        push('set services rpm twamp server authentication-mode none');
        if (twMode === 'light') {
          push('set services rpm twamp server light');
        }
        push(`set services rpm twamp server port ${twControlPort}`);
        if (twMode === 'full') {
          push(`set services rpm twamp server client-list ${twClientList} address ${twClientPrefix}`);
        }
        push('#');
        push(`# ${t('ipsla_twamp.cmt_verify')}`);
        push('# show services rpm twamp server session');
      }
    }

    return lines.join('\n');
  }, [twampError, twServerAddr, twTarget, twVendor, twRole, twMode, twControlPort, twInactivity, twReflectorTimeout, twCcName, twHistorySize, twTsName, twTestPort, twProbeCount, twProbeInterval, twTestInterval, twPadding, twClientList, twClientPrefix, t]);

  // Review hints
  const hints = useMemo(() => {
    const list = [];
    if (activeTab === 'ipsla') {
      if (probe === 'udp_jitter') {
        list.push({ level: 'yellow', key: 'hint_responder_needed' });
      }
      if (probeBudget) {
        if (probeBudget.dutyPct > 100) {
          list.push({ level: 'red', key: 'hint_duty_over', vars: { pct: probeBudget.dutyPct.toFixed(1) } });
        } else if (probeBudget.dutyPct > 50) {
          list.push({ level: 'yellow', key: 'hint_duty_high', vars: { pct: probeBudget.dutyPct.toFixed(1) } });
        }
      }
      if (probe === 'icmp_echo') {
        list.push({ level: 'yellow', key: 'hint_icmp_not_qos' });
      }
      if (threshold && !trackEnable && !reactEnable) {
        list.push({ level: 'yellow', key: 'hint_threshold_only_stat' });
      }
      if (trackEnable && (String(trackDelayDown).trim() === '0' || String(trackDelayUp).trim() === '0')) {
        list.push({ level: 'yellow', key: 'hint_track_delay_zero' });
      }
      if (String(vrf).trim()) {
        list.push({ level: 'yellow', key: 'hint_vrf_responder', vars: { vrf } });
      }
      if (reactEnable && reactAction === 'trapOnly') {
        list.push({ level: 'yellow', key: 'hint_traps_need_snmp' });
      }
      if (sourceMode === 'iface') {
        const pDef = IPSLA_PROBES.find(p => p.id === probe);
        if (pDef && !pDef.srcIface) {
          list.push({ level: 'yellow', key: 'hint_source_iface_unsupported' });
        }
      }
      if (reactEnable) {
        const rDef = IPSLA_REACTIONS.find(r => r.id === reactElement);
        const pDef = IPSLA_PROBES.find(p => p.id === probe);
        if (rDef && rDef.needs && (!pDef || !pDef[rDef.needs])) {
          list.push({ level: 'yellow', key: 'hint_reaction_unsupported' });
        }
      }
      if (list.length === 0 && ipslaConfig) {
        list.push({ level: 'green', key: 'hint_ok' });
      }
    } else if (activeTab === 'twamp') {
      if (twVendor === 'cisco_iosxe' && twRole === 'sender') {
        list.push({ level: 'red', key: 'hint_cisco_no_sender' });
      }
      if (twVendor === 'cisco_iosxe' && twMode === 'light') {
        list.push({ level: 'yellow', key: 'hint_cisco_no_light' });
      }
      if (twMode === 'light') {
        list.push({ level: 'yellow', key: 'hint_light_no_control' });
      }
      if (twRole === 'reflector' && twVendor === 'cisco_iosxe') {
        list.push({ level: 'yellow', key: 'hint_padding_sender_only' });
      }
      list.push({ level: 'yellow', key: 'hint_clock_note' });
      if (!(twVendor === 'cisco_iosxe' && (twRole === 'sender' || twMode === 'light'))) {
        list.push({ level: 'green', key: 'hint_twamp_ok' });
      }
    }
    return list;
  }, [activeTab, probe, probeBudget, threshold, trackEnable, reactEnable, trackDelayDown, trackDelayUp, vrf, reactAction, sourceMode, reactElement, ipslaConfig, twVendor, twRole, twMode]);

  // Tab-separated probe budget Copy All
  const copyBudgetAll = useCallback(() => {
    if (!probeBudget) return '';
    const lines = [
      `${t('ipsla_twamp.col_metric')}\t${t('ipsla_twamp.col_value')}`,
      `${t('ipsla_twamp.res_packet_l3')}\t${probeBudget.packetL3} B`,
      `${t('ipsla_twamp.res_pps')}\t${Math.round(probeBudget.pps)} pps`,
      `${t('ipsla_twamp.res_burst_rate')}\t${probeBudget.burstBps.toLocaleString('en-US', { maximumFractionDigits: 0 })} bps`,
      `${t('ipsla_twamp.res_burst_seconds')}\t${probeBudget.burstSeconds} s`,
      `${t('ipsla_twamp.res_avg_rate')}\t${probeBudget.avgBps.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bps`,
      `${t('ipsla_twamp.res_duty')}\t${probeBudget.dutyPct.toFixed(2)}%`,
    ];
    return lines.join('\n');
  }, [probeBudget, t]);

  const pDef = useMemo(() => IPSLA_PROBES.find(p => p.id === probe) || IPSLA_PROBES[0], [probe]);
  const rDef = useMemo(() => IPSLA_REACTIONS.find(r => r.id === reactElement) || IPSLA_REACTIONS[0], [reactElement]);

  return (
    <div className="fadein">
      {/* Title card */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 4 }}>{t('ipsla_twamp.title')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)', maxWidth: 800 }}>
              {t('ipsla_twamp.subtitle')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {IPSLA_TABS.map(tabId => (
              <button
                key={tabId}
                className={`btn btn-sm ${activeTab === tabId ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveTab(tabId)}
              >
                {t('ipsla_twamp.tab_' + tabId)}
              </button>
            ))}
          </div>
        </div>

        {activeTab === 'ipsla' && (
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>
                {t('ipsla_twamp.presets_label')}:
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => applyPreset('voip')}>
                {t('ipsla_twamp.preset_voip')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => applyPreset('wan')}>
                {t('ipsla_twamp.preset_wan')}
              </button>
              <button className="btn btn-sm btn-ghost" onClick={() => applyPreset('dns')}>
                {t('ipsla_twamp.preset_dns')}
              </button>
            </div>
            <div className="hint" style={{ marginTop: 4 }}>{t('ipsla_twamp.presets_hint')}</div>
          </div>
        )}
      </div>

      {/* 1. IP SLA Tab */}
      {activeTab === 'ipsla' && (
        <div>
          {/* Operation card */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.section_operation')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('ipsla_twamp.op_number')}</label>
                <input
                  className="input"
                  value={opNumber}
                  onChange={e => setOpNumber(e.target.value)}
                />
                <div className="hint">{t('ipsla_twamp.op_number_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('ipsla_twamp.probe_type')}</label>
                <select className="select" value={probe} onChange={e => setProbe(e.target.value)}>
                  {IPSLA_PROBES.map(p => (
                    <option key={p.id} value={p.id}>{t('ipsla_twamp.probe_' + p.id)}</option>
                  ))}
                </select>
                <div className="hint">{t('ipsla_twamp.probe_type_hint')}</div>
              </div>
            </div>
          </div>

          {/* Target card */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.section_target')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('ipsla_twamp.target')}</label>
                <input
                  className="input"
                  value={target}
                  onChange={e => setTarget(e.target.value)}
                />
                <div className="hint">{t('ipsla_twamp.target_hint')}</div>
              </div>

              {pDef.port && (
                <div className="field">
                  <label className="label">{t('ipsla_twamp.dest_port')}</label>
                  <input
                    className="input"
                    value={destPort}
                    onChange={e => setDestPort(e.target.value)}
                  />
                  <div className="hint">{t('ipsla_twamp.dest_port_hint')}</div>
                </div>
              )}

              {probe === 'dns' && (
                <div className="field">
                  <label className="label">{t('ipsla_twamp.name_server')}</label>
                  <input
                    className="input"
                    value={nameServer}
                    onChange={e => setNameServer(e.target.value)}
                  />
                  <div className="hint">{t('ipsla_twamp.name_server_hint')}</div>
                </div>
              )}

              {probe === 'http' && (
                <div className="field">
                  <label className="label">{t('ipsla_twamp.http_url')}</label>
                  <input
                    className="input"
                    value={httpUrl}
                    onChange={e => setHttpUrl(e.target.value)}
                  />
                  <div className="hint">{t('ipsla_twamp.http_url_hint')}</div>
                </div>
              )}
            </div>

            {pDef.codec && (
              <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div className="two-col grid-mobile-1">
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.codec')}</label>
                    <select className="select" value={codec} onChange={e => handleCodecChange(e.target.value)}>
                      {IPSLA_CODECS.map(c => (
                        <option key={c.id} value={c.id}>{c.cli}</option>
                      ))}
                      <option value="none">{t('ipsla_twamp.codec_none')}</option>
                    </select>
                    <div className="hint">{t('ipsla_twamp.codec_hint')}</div>
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.adv_factor')}</label>
                    <input
                      className="input"
                      value={advFactor}
                      onChange={e => setAdvFactor(e.target.value)}
                    />
                    <div className="hint">{t('ipsla_twamp.adv_factor_hint')}</div>
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.num_packets')}</label>
                    <input
                      className="input"
                      value={numPackets}
                      onChange={e => setNumPackets(e.target.value)}
                    />
                    <div className="hint">{t('ipsla_twamp.num_packets_hint')}</div>
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.packet_interval')}</label>
                    <input
                      className="input"
                      value={packetInterval}
                      onChange={e => setPacketInterval(e.target.value)}
                    />
                    <div className="hint">{t('ipsla_twamp.packet_interval_hint')}</div>
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.packet_size')}</label>
                    <input
                      className="input"
                      value={packetSize}
                      onChange={e => setPacketSize(e.target.value)}
                    />
                    <div className="hint">{t('ipsla_twamp.packet_size_hint')}</div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div className="two-col grid-mobile-1">
                <div className="field">
                  <label className="label">{t('ipsla_twamp.source_mode')}</label>
                  <select className="select" value={sourceMode} onChange={e => setSourceMode(e.target.value)}>
                    <option value="none">{t('ipsla_twamp.source_mode_none')}</option>
                    <option value="ip">{t('ipsla_twamp.source_mode_ip')}</option>
                    {pDef.srcIface && (
                      <option value="iface">{t('ipsla_twamp.source_mode_iface')}</option>
                    )}
                  </select>
                  <div className="hint">{t('ipsla_twamp.source_hint')}</div>
                </div>

                {sourceMode === 'ip' && (
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.source_ip')}</label>
                    <input
                      className="input"
                      value={sourceIp}
                      onChange={e => setSourceIp(e.target.value)}
                    />
                  </div>
                )}

                {sourceMode === 'iface' && (
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.source_iface')}</label>
                    <input
                      className="input"
                      value={sourceIface}
                      onChange={e => setSourceIface(e.target.value)}
                    />
                  </div>
                )}

                {pDef.srcPort && (
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.source_port')}</label>
                    <input
                      className="input"
                      value={srcPort}
                      onChange={e => setSrcPort(e.target.value)}
                      placeholder="e.g. 16384"
                    />
                  </div>
                )}

                <div className="field">
                  <label className="label">{t('ipsla_twamp.vrf')}</label>
                  <input
                    className="input"
                    value={vrf}
                    onChange={e => setVrf(e.target.value)}
                  />
                  <div className="hint">{t('ipsla_twamp.vrf_hint')}</div>
                </div>
              </div>
            </div>
          </div>

          {/* Timing & Threshold card */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.section_timing')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('ipsla_twamp.frequency')}</label>
                <input
                  id="ipsla-freq"
                  className="input"
                  value={frequency}
                  onChange={e => setFrequency(e.target.value)}
                  onBlur={e => setFrequency(String(e.target.value))}
                />
                <div className="hint">{t('ipsla_twamp.frequency_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('ipsla_twamp.timeout')}</label>
                <input
                  id="ipsla-timeout"
                  className="input"
                  value={timeout}
                  onChange={e => setTimeout(e.target.value)}
                  onBlur={e => setTimeout(String(e.target.value))}
                />
                <div className="hint">{t('ipsla_twamp.timeout_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('ipsla_twamp.threshold')}</label>
                <input
                  id="ipsla-threshold"
                  className="input"
                  value={threshold}
                  onChange={e => setThreshold(e.target.value)}
                  onBlur={e => setThreshold(String(e.target.value))}
                />
                <div className="hint">{t('ipsla_twamp.threshold_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('ipsla_twamp.tag')}</label>
                <input
                  className="input"
                  value={tag}
                  onChange={e => setTag(e.target.value)}
                />
                <div className="hint">{t('ipsla_twamp.tag_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('ipsla_twamp.owner')}</label>
                <input
                  className="input"
                  value={owner}
                  onChange={e => setOwner(e.target.value)}
                />
                <div className="hint">{t('ipsla_twamp.owner_hint')}</div>
              </div>
            </div>

            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
              <div className="field">
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={historyEnable}
                    onChange={e => setHistoryEnable(e.target.checked)}
                  />
                  {t('ipsla_twamp.history_enable')}
                </label>
                <div className="hint">{t('ipsla_twamp.history_hint')}</div>
              </div>

              {historyEnable && (
                <div className="two-col grid-mobile-1" style={{ marginTop: 8 }}>
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.history_interval')}</label>
                    <input
                      className="input"
                      value={historyInterval}
                      onChange={e => setHistoryInterval(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.history_buckets')}</label>
                    <input
                      className="input"
                      value={historyBuckets}
                      onChange={e => setHistoryBuckets(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Schedule card */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.section_schedule')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('ipsla_twamp.life_mode')}</label>
                <select className="select" value={lifeMode} onChange={e => setLifeMode(e.target.value)}>
                  <option value="forever">{t('ipsla_twamp.life_forever')}</option>
                  <option value="seconds">{t('ipsla_twamp.life_seconds')}</option>
                </select>
              </div>

              {lifeMode === 'seconds' && (
                <div className="field">
                  <label className="label">{t('ipsla_twamp.life_value')}</label>
                  <input
                    className="input"
                    value={lifeSeconds}
                    onChange={e => setLifeSeconds(e.target.value)}
                  />
                </div>
              )}

              <div className="field">
                <label className="label">{t('ipsla_twamp.start_mode')}</label>
                <select className="select" value={startMode} onChange={e => setStartMode(e.target.value)}>
                  <option value="now">{t('ipsla_twamp.start_now')}</option>
                  <option value="after">{t('ipsla_twamp.start_after')}</option>
                </select>
              </div>

              {startMode === 'after' && (
                <div className="field">
                  <label className="label">{t('ipsla_twamp.start_after_value')}</label>
                  <input
                    className="input"
                    value={startAfter}
                    onChange={e => setStartAfter(e.target.value)}
                  />
                </div>
              )}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>{t('ipsla_twamp.schedule_hint')}</div>
          </div>

          {/* Track Object card */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.section_track')}</div>
            <div className="field">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={trackEnable}
                  onChange={e => setTrackEnable(e.target.checked)}
                />
                {t('ipsla_twamp.track_enable')}
              </label>
              <div className="hint">{t('ipsla_twamp.track_hint')}</div>
            </div>

            {trackEnable && (
              <div className="two-col grid-mobile-1" style={{ marginTop: 12 }}>
                <div className="field">
                  <label className="label">{t('ipsla_twamp.track_number')}</label>
                  <input
                    className="input"
                    value={trackNumber}
                    onChange={e => setTrackNumber(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="label">{t('ipsla_twamp.track_type')}</label>
                  <select className="select" value={trackType} onChange={e => setTrackType(e.target.value)}>
                    <option value="reachability">{t('ipsla_twamp.track_reachability')}</option>
                    <option value="state">{t('ipsla_twamp.track_state')}</option>
                  </select>
                </div>

                <div className="field">
                  <label className="label">{t('ipsla_twamp.track_delay_down')}</label>
                  <input
                    className="input"
                    value={trackDelayDown}
                    onChange={e => setTrackDelayDown(e.target.value)}
                  />
                </div>

                <div className="field">
                  <label className="label">{t('ipsla_twamp.track_delay_up')}</label>
                  <input
                    className="input"
                    value={trackDelayUp}
                    onChange={e => setTrackDelayUp(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>

          {/* Reaction card */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.section_reaction')}</div>
            <div className="field">
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={reactEnable}
                  onChange={e => setReactEnable(e.target.checked)}
                />
                {t('ipsla_twamp.react_enable')}
              </label>
              <div className="hint">{t('ipsla_twamp.react_hint')}</div>
            </div>

            {reactEnable && (
              <div className="two-col grid-mobile-1" style={{ marginTop: 12 }}>
                <div className="field">
                  <label className="label">{t('ipsla_twamp.react_element')}</label>
                  <select className="select" value={reactElement} onChange={e => setReactElement(e.target.value)}>
                    {IPSLA_REACTIONS.map(r => (
                      <option key={r.id} value={r.id}>
                        {t('ipsla_twamp.react_' + (r.id === 'packetLossSD' ? 'loss' : (r.id === 'jitterAvg' ? 'jitter' : r.id)))}
                      </option>
                    ))}
                  </select>
                </div>

                {rDef.valued && (
                  <>
                    <div className="field">
                      <label className="label">{t('ipsla_twamp.react_upper')}</label>
                      <input
                        className="input"
                        value={reactUpper}
                        onChange={e => setReactUpper(e.target.value)}
                      />
                    </div>
                    <div className="field">
                      <label className="label">{t('ipsla_twamp.react_lower')}</label>
                      <input
                        className="input"
                        value={reactLower}
                        onChange={e => setReactLower(e.target.value)}
                      />
                    </div>
                  </>
                )}

                <div className="field">
                  <label className="label">{t('ipsla_twamp.react_threshold_type')}</label>
                  <select className="select" value={reactThType} onChange={e => setReactThType(e.target.value)}>
                    {IPSLA_THRESHOLD_TYPES.map(tt => (
                      <option key={tt} value={tt}>{t('ipsla_twamp.rtype_' + tt)}</option>
                    ))}
                  </select>
                </div>

                {(reactThType === 'consecutive' || reactThType === 'average') && (
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.react_occurrences')}</label>
                    <input
                      className="input"
                      value={reactOccurrences}
                      onChange={e => setReactOccurrences(e.target.value)}
                    />
                  </div>
                )}

                <div className="field">
                  <label className="label">{t('ipsla_twamp.react_action')}</label>
                  <select className="select" value={reactAction} onChange={e => setReactAction(e.target.value)}>
                    {IPSLA_ACTION_TYPES.map(at => (
                      <option key={at} value={at}>{t('ipsla_twamp.raction_' + at)}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}
          </div>

          <Err msg={ipslaError} />

          {/* Probe Budget card (udp-jitter only) */}
          {probe === 'udp_jitter' && probeBudget && !ipslaError && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 6 }}>
                <div className="card-title" style={{ margin: 0 }}>{t('ipsla_twamp.section_budget')}</div>
                <CopyBtn text={copyBudgetAll()} label="copy_all" id="ipsla-budget-copy" />
              </div>
              <div className="result-grid">
                <ResultItem
                  label={t('ipsla_twamp.res_packet_l3')}
                  value={`${probeBudget.packetL3} B`}
                  sub={t('ipsla_twamp.res_packet_l3_sub', { size: probeBudget.effSize })}
                />
                <ResultItem
                  label={t('ipsla_twamp.res_pps')}
                  value={`${Math.round(probeBudget.pps)} pps`}
                />
                <ResultItem
                  label={t('ipsla_twamp.res_burst_rate')}
                  value={`${probeBudget.burstBps.toLocaleString('en-US', { maximumFractionDigits: 0 })} bps`}
                />
                <ResultItem
                  label={t('ipsla_twamp.res_burst_seconds')}
                  value={`${probeBudget.burstSeconds} s`}
                />
                <ResultItem
                  label={t('ipsla_twamp.res_avg_rate')}
                  value={`${probeBudget.avgBps.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} bps`}
                />
                <ResultItem
                  label={t('ipsla_twamp.res_duty')}
                  value={`${probeBudget.dutyPct.toFixed(2)}%`}
                  accent={probeBudget.dutyPct <= 50}
                  yellow={probeBudget.dutyPct > 50 && probeBudget.dutyPct <= 100}
                  red={probeBudget.dutyPct > 100}
                />
              </div>
              <div className="hint" style={{ marginTop: 10 }}>{t('ipsla_twamp.res_note_l2')}</div>
            </div>
          )}

          {/* Generated Configuration card */}
          {!ipslaError && ipslaConfig && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <div>
                  <div className="card-title" style={{ margin: 0 }}>{t('ipsla_twamp.section_output')}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{t('ipsla_twamp.note_dialect')}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <CopyBtn text={ipslaConfig} label="copy" id="ipsla-cfg-copy" />
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => ipslaDownloadTxt(ipslaConfig, `ipsla-${opNumber}.txt`)}
                  >
                    {t('ipsla_twamp.export_txt')}
                  </button>
                </div>
              </div>

              <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius)', whiteSpace: 'pre-wrap', border: '1px solid var(--border)' }}>
                {ipslaConfig.split('\n').map((line, i) => (
                  <span key={i} style={/^\s*!/.test(line) ? { color: 'var(--dim)' } : undefined}>
                    {line}{'\n'}
                  </span>
                ))}
              </pre>

              <div className="hint" style={{ marginTop: 8 }}>{t('ipsla_twamp.note_no_run')}</div>
            </div>
          )}

          {/* Far-end Responder card (UDP jitter only) */}
          {!ipslaError && responderConfig && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <div className="card-title" style={{ margin: 0 }}>{t('ipsla_twamp.section_responder')}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <CopyBtn text={responderConfig} label="copy" id="ipsla-resp-copy" />
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => ipslaDownloadTxt(responderConfig, `ipsla-responder-${opNumber}.txt`)}
                  >
                    {t('ipsla_twamp.export_txt')}
                  </button>
                </div>
              </div>

              <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius)', whiteSpace: 'pre-wrap', border: '1px solid var(--border)' }}>
                {responderConfig.split('\n').map((line, i) => (
                  <span key={i} style={/^\s*!/.test(line) ? { color: 'var(--dim)' } : undefined}>
                    {line}{'\n'}
                  </span>
                ))}
              </pre>
            </div>
          )}

          {/* Review hints */}
          {hints.length > 0 && (
            <div className="card">
              <div className="card-title">{t('ipsla_twamp.section_review')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hints.map((h, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge badge-${h.level}`}>{t('ipsla_twamp.level_' + h.level)}</span>
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>
                      {t('ipsla_twamp.' + h.key, h.vars)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 2. TWAMP Tab */}
      {activeTab === 'twamp' && (
        <div>
          {/* Vendor selector */}
          <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
            {TWAMP_VENDORS.map(v => (
              <button
                key={v}
                className={`btn btn-sm ${twVendor === v ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setTwVendor(v)}
              >
                {t('ipsla_twamp.vendor_' + v)}
              </button>
            ))}
          </div>

          {/* Role & Mode card */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.section_role')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('ipsla_twamp.tw_role')}</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {TWAMP_ROLES.map(r => (
                    <button
                      key={r}
                      className={`btn btn-sm ${twRole === r ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setTwRole(r)}
                    >
                      {t('ipsla_twamp.tw_role_' + r)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="field">
                <label className="label">{t('ipsla_twamp.tw_mode')}</label>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {TWAMP_MODES.map(m => (
                    <button
                      key={m}
                      className={`btn btn-sm ${twMode === m ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setTwMode(m)}
                    >
                      {t('ipsla_twamp.tw_mode_' + m)}
                    </button>
                  ))}
                </div>
                <div className="hint">{t('ipsla_twamp.tw_mode_hint')}</div>
              </div>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>{t('ipsla_twamp.tw_auth_note')}</div>
          </div>

          {/* Session Parameters card */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.section_session')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('ipsla_twamp.tw_server_addr')}</label>
                <input
                  className="input"
                  value={twServerAddr}
                  onChange={e => setTwServerAddr(e.target.value)}
                />
                <div className="hint">{t('ipsla_twamp.tw_server_addr_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('ipsla_twamp.tw_target')}</label>
                <input
                  className="input"
                  value={twTarget}
                  onChange={e => setTwTarget(e.target.value)}
                />
                <div className="hint">{t('ipsla_twamp.tw_target_hint')}</div>
              </div>

              <div className="field">
                <label className="label">{t('ipsla_twamp.tw_control_port')}</label>
                {twMode === 'light' && twVendor === 'junos' ? (
                  <select
                    className="select"
                    value={twControlPort}
                    onChange={e => {
                      const val = e.target.value;
                      setTwControlPort(val);
                      setTwTestPort(val);
                    }}
                  >
                    {TWAMP_LIGHT_PORTS.map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="input"
                    value={twControlPort}
                    onChange={e => setTwControlPort(e.target.value)}
                  />
                )}
                <div className="hint">{t('ipsla_twamp.tw_control_port_hint')}</div>
              </div>

              {twMode === 'light' && (
                <div className="field">
                  <label className="label">{t('ipsla_twamp.tw_test_port')}</label>
                  <select
                    className="select"
                    value={twTestPort}
                    onChange={e => {
                      const val = e.target.value;
                      setTwTestPort(val);
                      setTwControlPort(val);
                    }}
                  >
                    {TWAMP_LIGHT_PORTS.map(p => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                  <div className="hint">{t('ipsla_twamp.tw_test_port_hint')}</div>
                </div>
              )}

              {twVendor === 'junos' && twRole === 'sender' && (
                <>
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_cc_name')}</label>
                    <input
                      className="input"
                      value={twCcName}
                      onChange={e => setTwCcName(e.target.value)}
                    />
                    <div className="hint">{t('ipsla_twamp.tw_name_hint')}</div>
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_ts_name')}</label>
                    <input
                      className="input"
                      value={twTsName}
                      onChange={e => setTwTsName(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_probe_count')}</label>
                    <input
                      className="input"
                      value={twProbeCount}
                      onChange={e => setTwProbeCount(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_probe_interval')}</label>
                    <input
                      className="input"
                      value={twProbeInterval}
                      onChange={e => setTwProbeInterval(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_test_interval')}</label>
                    <input
                      className="input"
                      value={twTestInterval}
                      onChange={e => setTwTestInterval(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_padding')}</label>
                    <input
                      className="input"
                      value={twPadding}
                      onChange={e => setTwPadding(e.target.value)}
                    />
                    <div className="hint">{t('ipsla_twamp.tw_padding_hint')}</div>
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_history_size')}</label>
                    <input
                      className="input"
                      value={twHistorySize}
                      onChange={e => setTwHistorySize(e.target.value)}
                    />
                  </div>
                </>
              )}

              {twVendor === 'junos' && twRole === 'reflector' && twMode === 'full' && (
                <>
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_client_list')}</label>
                    <input
                      className="input"
                      value={twClientList}
                      onChange={e => setTwClientList(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_client_prefix')}</label>
                    <input
                      className="input"
                      value={twClientPrefix}
                      onChange={e => setTwClientPrefix(e.target.value)}
                    />
                  </div>
                </>
              )}

              {twVendor === 'cisco_iosxe' && twRole === 'reflector' && twMode === 'full' && (
                <>
                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_inactivity')}</label>
                    <input
                      className="input"
                      value={twInactivity}
                      onChange={e => setTwInactivity(e.target.value)}
                    />
                  </div>

                  <div className="field">
                    <label className="label">{t('ipsla_twamp.tw_reflector_timeout')}</label>
                    <input
                      className="input"
                      value={twReflectorTimeout}
                      onChange={e => setTwReflectorTimeout(e.target.value)}
                    />
                  </div>
                </>
              )}
            </div>
          </div>

          <Err msg={twampError} />

          {/* Generated Configuration card */}
          {!twampError && twampConfig && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <div>
                  <div className="card-title" style={{ margin: 0 }}>{t('ipsla_twamp.section_output')}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <CopyBtn text={twampConfig} label="copy" id="twamp-cfg-copy" />
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => ipslaDownloadTxt(twampConfig, `twamp-${twVendor}-${twRole}.txt`)}
                  >
                    {t('ipsla_twamp.export_txt')}
                  </button>
                </div>
              </div>

              <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius)', whiteSpace: 'pre-wrap', border: '1px solid var(--border)' }}>
                {twampConfig.split('\n').map((line, i) => (
                  <span key={i} style={/^\s*[!#]/.test(line) ? { color: 'var(--dim)' } : undefined}>
                    {line}{'\n'}
                  </span>
                ))}
              </pre>

              <div className="hint" style={{ marginTop: 8 }}>{t('ipsla_twamp.note_no_run')}</div>
            </div>
          )}

          {/* Review hints */}
          {hints.length > 0 && (
            <div className="card">
              <div className="card-title">{t('ipsla_twamp.section_review')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hints.map((h, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge badge-${h.level}`}>{t('ipsla_twamp.level_' + h.level)}</span>
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>
                      {t('ipsla_twamp.' + h.key, h.vars)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. Reference Tab */}
      {activeTab === 'reference' && (
        <div>
          {/* Comparison table */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.ref_compare_title')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('ipsla_twamp.ref_col_aspect')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('ipsla_twamp.ref_col_ipsla')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('ipsla_twamp.ref_col_twamp')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('ipsla_twamp.ref_col_owamp')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['standard', 'ref_ipsla_standard', 'ref_twamp_standard', 'ref_owamp_standard'],
                    ['measures', 'ref_ipsla_measures', 'ref_twamp_measures', 'ref_owamp_measures'],
                    ['direction', 'ref_ipsla_direction', 'ref_twamp_direction', 'ref_owamp_direction'],
                    ['clock', 'ref_ipsla_clock', 'ref_twamp_clock', 'ref_owamp_clock'],
                    ['interop', 'ref_ipsla_interop', 'ref_twamp_interop', 'ref_owamp_interop'],
                    ['control', 'ref_ipsla_control', 'ref_twamp_control', 'ref_owamp_control'],
                    ['use', 'ref_ipsla_use', 'ref_twamp_use', 'ref_owamp_use'],
                  ].map(([row, ipslaKey, twampKey, owampKey]) => (
                    <tr key={row} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('ipsla_twamp.ref_row_' + row)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('ipsla_twamp.' + ipslaKey)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('ipsla_twamp.' + twampKey)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('ipsla_twamp.' + owampKey)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Round-trip vs one-way */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.ref_oneway_title')}</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
              {t('ipsla_twamp.ref_oneway_body')}
            </div>
          </div>

          {/* Reading thresholds */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.ref_threshold_title')}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
              <li style={{ marginBottom: 6 }}>{t('ipsla_twamp.ref_threshold_freq')}</li>
              <li style={{ marginBottom: 6 }}>{t('ipsla_twamp.ref_threshold_timeout')}</li>
              <li style={{ marginBottom: 6 }}>{t('ipsla_twamp.ref_threshold_threshold')}</li>
              <li style={{ marginBottom: 6 }}>{t('ipsla_twamp.ref_threshold_rising')}</li>
              <li>{t('ipsla_twamp.ref_threshold_type')}</li>
            </ul>
          </div>

          {/* What consumes a probe */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.ref_track_title')}</div>
            <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: 1.6 }}>
              {t('ipsla_twamp.ref_track_body')}
            </div>
          </div>

          {/* Worked example */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.ref_example_title')}</div>
            <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius)', whiteSpace: 'pre-wrap', border: '1px solid var(--border)', lineHeight: 1.5 }}>
              {t('ipsla_twamp.ref_example')}
            </pre>
          </div>

          {/* Related tools */}
          <div className="card">
            <div className="card-title">{t('ipsla_twamp.related_title')}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
              {[
                { id: 'diag', key: 'related_diag' },
                { id: 'iperf', key: 'related_iperf' },
                { id: 'uptime', key: 'related_uptime' },
                { id: 'qos-tool', key: 'related_qos' },
                { id: 'ntp-stratum', key: 'related_ntp' },
                { id: 'flow-export', key: 'related_flow' },
              ].map(({ id, key }, idx) => (
                <li key={id} style={{ marginBottom: idx < 5 ? 6 : 0 }}>
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ padding: '0 6px', height: 'auto', fontSize: 12, marginRight: 6, display: 'inline-flex', verticalAlign: 'baseline' }}
                    onClick={() => {
                      if (onNav) onNav({ tool: id });
                      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: id } }));
                    }}
                    title={id}
                  >
                    →
                  </button>
                  {t('ipsla_twamp.' + key)}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

window.IpSlaTwampBuilder = IpSlaTwampBuilder;
