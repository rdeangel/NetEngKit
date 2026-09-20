const { useState, useEffect, useCallback, useMemo, useRef } = React;

// ── iperf version metadata ──────────────────────────────────────────────────
// iperf3 binary is "iperf3"; iperf2 binary is "iperf".
const IPERF_BIN = { iperf3: 'iperf3', iperf2: 'iperf' };
const IPERF_DEFAULT_PORT = { iperf3: '5201', iperf2: '5001' };

// Well-known container image for the standalone server recipe.
const IPERF_IMAGE = { iperf3: 'networkstatic/iperf3', iperf2: 'your-registry/iperf2' };

// ── Command builders ────────────────────────────────────────────────────────
function iperfClientCmd(v, c) {
  const bin = IPERF_BIN[v];
  const a = [bin, '-c', c.host ? c.host.trim() : 'SERVER_IP'];
  if (c.port) a.push('-p', c.port);
  if (c.proto === 'udp') a.push('-u');
  else if (c.proto === 'sctp' && v === 'iperf3') a.push('--sctp');
  if (c.bandwidth) a.push('-b', c.bandwidth);

  if (c.amountMode === 'time' && c.time) a.push('-t', c.time);
  else if (c.amountMode === 'bytes' && c.bytes) a.push('-n', c.bytes);
  else if (c.amountMode === 'blocks' && c.blocks && v === 'iperf3') a.push('-k', c.blocks);

  if (c.parallel && c.parallel !== '1') a.push('-P', c.parallel);

  if (v === 'iperf3') {
    if (c.direction === 'reverse') a.push('-R');
    else if (c.direction === 'bidir') a.push('--bidir');
  } else {
    if (c.direction === 'dualtest') a.push('-d');
    else if (c.direction === 'tradeoff') a.push('-r');
    else if (c.direction === 'fullduplex') a.push('--full-duplex');
  }

  if (c.interval) a.push('-i', c.interval);
  if (c.length) a.push('-l', c.length);
  if (c.window) a.push('-w', c.window);
  if (c.mss) a.push('-M', c.mss);
  if (c.nodelay) a.push('-N');
  if (c.tos) a.push('-S', c.tos);

  if (v === 'iperf3') {
    if (c.omit) a.push('-O', c.omit);
    if (c.zerocopy) a.push('-Z');
    if (c.congestion) a.push('-C', c.congestion);
    if (c.title) a.push('-T', c.title);
    if (c.json) a.push('-J');
  } else {
    if (c.enhanced) a.push('-e');
    if (c.csv) a.push('-y', 'C');
  }

  if (c.ipv === '4') a.push('-4');
  else if (c.ipv === '6') a.push('-6');
  return a.join(' ');
}

function iperfServerCmd(v, s) {
  const bin = IPERF_BIN[v];
  const a = [bin, '-s'];
  if (s.port) a.push('-p', s.port);
  if (s.bind) a.push('-B', s.bind.trim());
  if (v === 'iperf3' && s.oneoff) a.push('-1');
  if (s.daemon) a.push('-D');
  if (s.interval) a.push('-i', s.interval);
  if (v === 'iperf3' && s.json) a.push('-J');
  if (v === 'iperf2') {
    if (s.udp) a.push('-u');
    if (s.enhanced) a.push('-e');
  }
  if (s.ipv === '4') a.push('-4');
  else if (s.ipv === '6') a.push('-6');
  return a.join(' ');
}

// ── Client presets (fill the client form) ───────────────────────────────────
const IPERF_PRESETS = [
  { id: 'tcp',       labelKey: 'preset_tcp',       patch: { proto: 'tcp', amountMode: 'time', time: '10', direction: 'normal', bandwidth: '', parallel: '1', udp: false } },
  { id: 'udp',       labelKey: 'preset_udp',       patch: { proto: 'udp', amountMode: 'time', time: '30', bandwidth: '100M', direction: 'normal', parallel: '1' } },
  { id: 'reverse',   labelKey: 'preset_reverse',   patch: { proto: 'tcp', amountMode: 'time', time: '10', direction: 'reverse', parallel: '1' },   version: 'iperf3' },
  { id: 'bidir',     labelKey: 'preset_bidir',     patch: { proto: 'tcp', amountMode: 'time', time: '10', direction: 'bidir', parallel: '1' },     version: 'iperf3' },
  { id: 'dualtest',  labelKey: 'preset_dualtest',  patch: { proto: 'tcp', amountMode: 'time', time: '10', direction: 'dualtest', parallel: '1' },  version: 'iperf2' },
  { id: 'parallel',  labelKey: 'preset_parallel',  patch: { proto: 'tcp', amountMode: 'time', time: '20', parallel: '10', direction: 'normal' } },
  { id: 'mtu',       labelKey: 'preset_mtu',       patch: { proto: 'udp', amountMode: 'time', time: '10', bandwidth: '10M', length: '1472', direction: 'normal' } },
];

// ── Cheat-sheet reference data (technical literals — not i18n prose) ─────────
const IPERF_COMPARE = [
  ['Binary name',          'iperf3',                          'iperf'],
  ['Default port',         '5201',                            '5001'],
  ['Concurrent clients',   'One at a time (per server)',      'Multiple simultaneous'],
  ['Threading',            'Multi-thread since 3.16',         'Multi-threaded'],
  ['JSON output (-J)',     'Yes',                             'No'],
  ['Reverse mode (-R)',    'Yes',                             'No (use -d / -r)'],
  ['Bidirectional',        '--bidir (>= 3.7)',                '-d dualtest, -r tradeoff, --full-duplex'],
  ['SCTP',                 '--sctp',                          'No'],
  ['Multicast',            'Limited',                         'Strong (-B group, -T ttl)'],
  ['CSV report (-y C)',    'No',                              'Yes'],
  ['Omit warmup (-O)',     'Yes',                             'No'],
  ['Zero-copy (-Z)',       'sendfile()',                      'TCP congestion algo'],
  ['Control + data port',  'Separate control channel',       'Single channel'],
  ['Best for',             'Datacenter / WAN throughput, automation', 'Wi-Fi, multicast, multi-client'],
];

const IPERF_OPTIONS = [
  ['-s',           'Run in server mode'],
  ['-c <host>',    'Run in client mode, connect to <host>'],
  ['-p <port>',    'Port (default 5201 v3 / 5001 v2)'],
  ['-u',           'Use UDP instead of TCP'],
  ['-b <rate>',    'Target bitrate, e.g. 100M, 1G (UDP: required; TCP: cap)'],
  ['-t <sec>',     'Duration in seconds (default 10)'],
  ['-n <bytes>',   'Send a fixed number of bytes instead of -t'],
  ['-k <n>',       'Send n blocks/packets (iperf3)'],
  ['-P <n>',       'Number of parallel streams'],
  ['-R',           'Reverse: server sends, client receives (iperf3)'],
  ['--bidir',      'Bidirectional simultaneous test (iperf3 >= 3.7)'],
  ['-d / -r',      'iperf2 dual (simultaneous) / tradeoff (sequential)'],
  ['-i <sec>',     'Interval between periodic bandwidth reports'],
  ['-l <len>',     'Buffer/read-write length (UDP packet size)'],
  ['-w <size>',    'TCP window / socket buffer size'],
  ['-M <mss>',     'Set TCP maximum segment size (MSS)'],
  ['-N',           'No delay — disable Nagle (TCP_NODELAY)'],
  ['-S <tos>',     'IP type-of-service / DSCP byte'],
  ['-O <sec>',     'Omit first n seconds (skip TCP slow-start) (iperf3)'],
  ['-Z',           'Zero-copy via sendfile() (iperf3)'],
  ['-C <algo>',    'TCP congestion control, e.g. cubic, bbr (iperf3)'],
  ['-J',           'JSON output (iperf3)'],
  ['-4 / -6',      'Force IPv4 / IPv6'],
  ['-1',           'iperf3 server: handle one client then exit'],
  ['-D',           'Run server as a background daemon'],
];

const IPERF_SCENARIOS = [
  ['Basic TCP throughput',     'server', 'iperf3 -s'],
  ['Basic TCP throughput',     'client', 'iperf3 -c SERVER_IP -t 10'],
  ['UDP jitter & loss',        'client', 'iperf3 -c SERVER_IP -u -b 100M -t 30'],
  ['Download (reverse)',       'client', 'iperf3 -c SERVER_IP -R'],
  ['Bidirectional',            'client', 'iperf3 -c SERVER_IP --bidir'],
  ['10 parallel streams',      'client', 'iperf3 -c SERVER_IP -P 10'],
  ['Tune window for high BDP', 'client', 'iperf3 -c SERVER_IP -w 4M -P 4'],
  ['BBR congestion control',   'client', 'iperf3 -c SERVER_IP -C bbr'],
  ['JSON for automation',      'client', 'iperf3 -c SERVER_IP -J --logfile out.json'],
  ['iperf2 dual test',         'client', 'iperf -c SERVER_IP -d -e'],
];

function IperfBuilder({ onShare, initialData, onNav }) {
  const { t } = useTranslation();

  const [version, setVersion]     = usePersistentState('iperf:version', initialData?.version ?? 'iperf3');
  const [activeTab, setActiveTab] = usePersistentState('iperf:tab', initialData?.tab ?? 'client');
  const skipNavReport = useRef(false);

  // ── Client form ───────────────────────────────────────────────────────────
  const [client, setClient] = usePersistentState('iperf:client', () => ({
    host: '', port: '', proto: 'tcp', bandwidth: '', amountMode: 'time',
    time: '10', bytes: '', blocks: '', parallel: '1', direction: 'normal',
    interval: '1', length: '', window: '', mss: '', nodelay: false, tos: '',
    omit: '', zerocopy: false, congestion: '', title: '', json: false,
    enhanced: false, csv: false, ipv: 'auto',
    ...(initialData?.client || {}),
  }));
  const setC = (k, val) => setClient(prev => ({ ...prev, [k]: val }));

  // ── Server form ───────────────────────────────────────────────────────────
  const [server, setServer] = usePersistentState('iperf:server', () => ({
    port: '', bind: '', oneoff: false, daemon: false, interval: '',
    json: false, udp: false, enhanced: false, ipv: 'auto',
    ...(initialData?.server || {}),
  }));
  const setS = (k, val) => setServer(prev => ({ ...prev, [k]: val }));

  // ── Capabilities ──────────────────────────────────────────────────────────
  const [serverMode, setServerMode] = useState(null);   // null checking, true, false
  const [iperf3Avail, setIperf3Avail] = useState(null);
  const [iperf2Avail, setIperf2Avail] = useState(null);

  useEffect(() => {
    fetch('/api/capabilities', { signal: AbortSignal.timeout(2500) })
      .then(r => r.json())
      .then(data => {
        setServerMode(true);
        setIperf3Avail(data.iperf3 ?? false);
        setIperf2Avail(data.iperf2 ?? false);
      })
      .catch(() => { setServerMode(false); setIperf3Avail(false); setIperf2Avail(false); });
  }, []);

  const binAvail = version === 'iperf2' ? iperf2Avail : iperf3Avail;

  // ── Live run state (client) ───────────────────────────────────────────────
  const [running, setRunning]   = useState(false);
  const [cLines, setCLines]     = useState([]);
  const [cExit, setCExit]       = useState(null);
  const cEsRef = useRef(null);
  const cTermRef = useRef(null);

  // ── Live server state ─────────────────────────────────────────────────────
  const [srvUp, setSrvUp]       = useState(false);
  const [sLines, setSLines]     = useState([]);
  const [sExit, setSExit]       = useState(null);
  const sEsRef = useRef(null);
  const sTermRef = useRef(null);

  useEffect(() => { if (cTermRef.current) cTermRef.current.scrollTop = cTermRef.current.scrollHeight; }, [cLines]);
  useEffect(() => { if (sTermRef.current) sTermRef.current.scrollTop = sTermRef.current.scrollHeight; }, [sLines]);

  // ── Generated commands ────────────────────────────────────────────────────
  const clientCmd = useMemo(() => iperfClientCmd(version, client), [version, client]);
  const serverCmd = useMemo(() => iperfServerCmd(version, server), [version, server]);

  const effPort = (which) => (which.port || IPERF_DEFAULT_PORT[version]);

  // Docker deploy recipes for the server.
  const dockerRun = useMemo(() => {
    const p = effPort(server);
    const img = IPERF_IMAGE[version];
    const bin = IPERF_BIN[version];
    return `docker run -d --restart unless-stopped --name ${bin}-server \\
  -p ${p}:${p}/tcp -p ${p}:${p}/udp \\
  ${img} -s -p ${p}`;
  }, [version, server]);

  const dockerCompose = useMemo(() => {
    const p = effPort(server);
    const img = IPERF_IMAGE[version];
    const bin = IPERF_BIN[version];
    return `services:
  ${bin}-server:
    image: ${img}
    container_name: ${bin}-server
    command: ["-s", "-p", "${p}"]
    restart: unless-stopped
    ports:
      - "${p}:${p}/tcp"
      - "${p}:${p}/udp"`;
  }, [version, server]);

  // ── Share ─────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'iperf', version, tab: activeTab, client, server });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [version, activeTab, client, server, onShare]);

  // ── Nav sync (apply-down: sidebar / Ctrl+K / Help modal → component) ──────
  useEffect(() => {
    if (!initialData) return;
    if (initialData.tab && initialData.tab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.tab);
    }
  }, [initialData]);

  // ── Nav sync (report-up: tab change → sidebar highlight) ─────────────────
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ tab: activeTab });
  }, [activeTab]);

  // ── Presets ───────────────────────────────────────────────────────────────
  const applyPreset = (preset) => {
    setClient(prev => ({ ...prev, ...preset.patch }));
    setActiveTab('client');
  };

  // ── Live client run ───────────────────────────────────────────────────────
  const startClient = useCallback(() => {
    if (!client.host.trim()) return;
    setCLines([{ type: 'out', text: '$ ' + clientCmd }]); setCExit(null); setRunning(true);
    let finished = false;
    const params = new URLSearchParams({ bin: version, host: client.host.trim() });
    if (client.port) params.set('port', client.port);
    if (client.proto && client.proto !== 'tcp') params.set('proto', client.proto);
    if (client.bandwidth) params.set('bw', client.bandwidth);
    if (client.amountMode === 'time' && client.time) params.set('time', client.time);
    if (client.parallel && client.parallel !== '1') params.set('parallel', client.parallel);
    if (version === 'iperf3' && client.direction === 'reverse') params.set('reverse', '1');
    if (version === 'iperf3' && client.direction === 'bidir') params.set('bidir', '1');
    if (client.interval) params.set('interval', client.interval);
    if (client.length) params.set('length', client.length);
    if (client.window) params.set('window', client.window);
    if (client.ipv === '4' || client.ipv === '6') params.set('ipv', client.ipv);

    const es = new EventSource(`/api/iperf-run?${params}`);
    cEsRef.current = es;
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'done') { finished = true; setCExit(Number(msg.line)); setRunning(false); es.close(); }
      else setCLines(prev => [...prev, { type: msg.type, text: msg.line }]);
    };
    es.onerror = () => {
      if (!finished) setCLines(prev => [...prev, { type: 'err', text: t('iperf.conn_error') }]);
      setRunning(false); es.close();
    };
  }, [version, client, clientCmd, t]);

  const stopClient = () => { if (cEsRef.current) { cEsRef.current.close(); cEsRef.current = null; } setRunning(false); };

  // ── Live server ───────────────────────────────────────────────────────────
  const startServer = useCallback(() => {
    setSLines([{ type: 'out', text: '$ ' + serverCmd }]); setSExit(null); setSrvUp(true);
    let finished = false;
    const params = new URLSearchParams({ bin: version });
    if (server.port) params.set('port', server.port);
    if (server.bind) params.set('bind', server.bind.trim());
    if (version === 'iperf3' && server.oneoff) params.set('oneoff', '1');
    if (version === 'iperf3' && server.json) params.set('json', '1');
    if (version === 'iperf2' && server.udp) params.set('udp', '1');
    if (server.interval) params.set('interval', server.interval);
    if (server.ipv === '4' || server.ipv === '6') params.set('ipv', server.ipv);

    const es = new EventSource(`/api/iperf-server?${params}`);
    sEsRef.current = es;
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'done') { finished = true; setSExit(Number(msg.line)); setSrvUp(false); es.close(); }
      else setSLines(prev => [...prev, { type: msg.type, text: msg.line }]);
    };
    es.onerror = () => {
      if (!finished) setSLines(prev => [...prev, { type: 'err', text: t('iperf.conn_error') }]);
      setSrvUp(false); es.close();
    };
  }, [version, server, serverCmd, t]);

  const stopServer = () => { if (sEsRef.current) { sEsRef.current.close(); sEsRef.current = null; } setSrvUp(false); };

  // Stop streams on unmount.
  useEffect(() => () => { if (cEsRef.current) cEsRef.current.close(); if (sEsRef.current) sEsRef.current.close(); }, []);

  // ── Shared styles ─────────────────────────────────────────────────────────
  const termStyle = {
    background: '#1a1f2e', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    padding: '12px 14px', maxHeight: 360, overflowY: 'auto', overflowX: 'auto',
    fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6,
  };
  const cmdBoxStyle = {
    display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--panel)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px',
  };
  const cmdCodeStyle = { fontFamily: 'var(--mono)', fontSize: 12.5, color: 'var(--cyan)', flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-all' };
  const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 12.5 };
  const thStyle = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid var(--border)', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' };
  const tdStyle = { padding: '7px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' };

  const availBadge = () => {
    if (serverMode === null || binAvail === null) return <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal' }}>{t('iperf.checking')}</span>;
    if (serverMode === false) return <span style={badgeStyle}>{t('iperf.server_required')}</span>;
    if (binAvail === false) return <span style={badgeStyle}>{t('iperf.bin_unavailable', { bin: IPERF_BIN[version] })}</span>;
    return <span style={{ ...badgeStyle, color: '#3fb950', borderColor: '#26492f' }}>{t('iperf.bin_ready', { bin: IPERF_BIN[version] })}</span>;
  };
  const badgeStyle = { fontSize: 11, color: 'var(--dim)', fontWeight: 'normal', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' };

  const field = (label, node, hint) => (
    <div className="field" style={{ margin: 0 }}>
      <label className="label">{label}</label>
      {node}
      {hint && <span className="hint">{hint}</span>}
    </div>
  );
  const checkbox = (checked, onChange, label, disabled) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} disabled={disabled} />
      {label}
    </label>
  );

  const tabs = [
    { id: 'client', label: t('iperf.tab_client') },
    { id: 'server', label: t('iperf.tab_server') },
    { id: 'cheatsheet', label: t('iperf.tab_cheatsheet') },
  ];

  return (
    <div className="fadein">

      {/* Header / version toggle */}
      <div className="card">
        <div className="card-title">{t('iperf.title')}</div>
        <p style={{ fontSize: 13, color: 'var(--dim)', margin: '0 0 14px' }}>{t('iperf.subtitle')}</p>
        <div className="field" style={{ margin: 0 }}>
          <label className="label">{t('iperf.version_label')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['iperf3', 'iperf2'].map(v => (
              <button key={v} onClick={() => setVersion(v)} className={`btn ${version === v ? 'btn-primary' : 'btn-ghost'}`}>
                {v === 'iperf3' ? 'iperf3' : 'iperf2 (iperf)'}
              </button>
            ))}
          </div>
          <span className="hint">{version === 'iperf3' ? t('iperf.version_hint_v3') : t('iperf.version_hint_v2')}</span>
        </div>
      </div>

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
            background: activeTab === tab.id ? 'var(--card)' : 'transparent',
            border: '1px solid var(--border)',
            borderBottom: activeTab === tab.id ? '1px solid var(--card)' : '1px solid var(--border)',
            borderRadius: 'var(--radius) var(--radius) 0 0',
            color: activeTab === tab.id ? 'var(--fg)' : 'var(--dim)',
            cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '7px 16px', marginBottom: -1,
          }}>{tab.label}</button>
        ))}
      </div>

      {/* ── CLIENT TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'client' && (
        <div className="card fadein">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('iperf.client_title')}
            {availBadge()}
          </div>

          {/* Presets */}
          <div style={{ marginBottom: 14 }}>
            <span className="hint" style={{ display: 'block', marginBottom: 6 }}>{t('iperf.presets_label')}</span>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {IPERF_PRESETS.filter(p => !p.version || p.version === version).map(p => (
                <button key={p.id} className="btn btn-ghost btn-sm" onClick={() => applyPreset(p)}>
                  {t(`iperf.${p.labelKey}`)}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10, marginBottom: 12 }}>
            {field(t('iperf.host_label'),
              <input className="input" value={client.host} placeholder={t('iperf.host_placeholder')}
                onChange={e => setC('host', e.target.value)} disabled={running} />,
              t('iperf.host_hint'))}
            {field(t('iperf.port_label'),
              <input className="input" value={client.port} placeholder={IPERF_DEFAULT_PORT[version]} type="number"
                onChange={e => setC('port', e.target.value)} disabled={running} />)}
            {field(t('iperf.proto_label'),
              <select className="input" value={client.proto} onChange={e => setC('proto', e.target.value)} disabled={running}>
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                {version === 'iperf3' && <option value="sctp">SCTP</option>}
              </select>)}
            {field(t('iperf.bandwidth_label'),
              <input className="input" value={client.bandwidth} placeholder="100M / 1G"
                onChange={e => setC('bandwidth', e.target.value)} disabled={running} />,
              client.proto === 'udp' ? t('iperf.bandwidth_hint_udp') : t('iperf.bandwidth_hint_tcp'))}
            {field(t('iperf.direction_label'),
              <select className="input" value={client.direction} onChange={e => setC('direction', e.target.value)} disabled={running}>
                <option value="normal">{t('iperf.dir_normal')}</option>
                {version === 'iperf3' ? [
                  <option key="r" value="reverse">{t('iperf.dir_reverse')}</option>,
                  <option key="b" value="bidir">{t('iperf.dir_bidir')}</option>,
                ] : [
                  <option key="d" value="dualtest">{t('iperf.dir_dualtest')}</option>,
                  <option key="t" value="tradeoff">{t('iperf.dir_tradeoff')}</option>,
                  <option key="f" value="fullduplex">{t('iperf.dir_fullduplex')}</option>,
                ]}
              </select>)}
            {field(t('iperf.parallel_label'),
              <input className="input" value={client.parallel} type="number" min="1" max="128"
                onChange={e => setC('parallel', e.target.value)} disabled={running} />)}
          </div>

          {/* Amount */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10, marginBottom: 12 }}>
            {field(t('iperf.amount_label'),
              <select className="input" value={client.amountMode} onChange={e => setC('amountMode', e.target.value)} disabled={running}>
                <option value="time">{t('iperf.amount_time')}</option>
                <option value="bytes">{t('iperf.amount_bytes')}</option>
                {version === 'iperf3' && <option value="blocks">{t('iperf.amount_blocks')}</option>}
              </select>)}
            {client.amountMode === 'time' && field(t('iperf.time_label'),
              <input className="input" value={client.time} type="number" min="1"
                onChange={e => setC('time', e.target.value)} disabled={running} />)}
            {client.amountMode === 'bytes' && field(t('iperf.bytes_label'),
              <input className="input" value={client.bytes} placeholder="100M / 1G"
                onChange={e => setC('bytes', e.target.value)} disabled={running} />)}
            {client.amountMode === 'blocks' && field(t('iperf.blocks_label'),
              <input className="input" value={client.blocks} placeholder="1000"
                onChange={e => setC('blocks', e.target.value)} disabled={running} />)}
            {field(t('iperf.interval_label'),
              <input className="input" value={client.interval} type="number" min="0"
                onChange={e => setC('interval', e.target.value)} disabled={running} />)}
          </div>

          {/* Advanced */}
          <details style={{ marginBottom: 12 }}>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--dim)', marginBottom: 10 }}>{t('iperf.advanced')}</summary>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10, marginTop: 10 }}>
              {field(t('iperf.length_label'),
                <input className="input" value={client.length} placeholder="1472"
                  onChange={e => setC('length', e.target.value)} disabled={running} />,
                t('iperf.length_hint'))}
              {field(t('iperf.window_label'),
                <input className="input" value={client.window} placeholder="256K / 4M"
                  onChange={e => setC('window', e.target.value)} disabled={running} />)}
              {field(t('iperf.mss_label'),
                <input className="input" value={client.mss} placeholder="1460" type="number"
                  onChange={e => setC('mss', e.target.value)} disabled={running} />)}
              {field(t('iperf.tos_label'),
                <input className="input" value={client.tos} placeholder="0x10 / 46"
                  onChange={e => setC('tos', e.target.value)} disabled={running} />,
                t('iperf.tos_hint'))}
              {version === 'iperf3' && field(t('iperf.omit_label'),
                <input className="input" value={client.omit} placeholder="2" type="number"
                  onChange={e => setC('omit', e.target.value)} disabled={running} />,
                t('iperf.omit_hint'))}
              {version === 'iperf3' && field(t('iperf.congestion_label'),
                <input className="input" value={client.congestion} placeholder="cubic / bbr"
                  onChange={e => setC('congestion', e.target.value)} disabled={running} />)}
              {version === 'iperf3' && field(t('iperf.title_label'),
                <input className="input" value={client.title} placeholder="test1"
                  onChange={e => setC('title', e.target.value)} disabled={running} />)}
              {field(t('iperf.ipv_label'),
                <select className="input" value={client.ipv} onChange={e => setC('ipv', e.target.value)} disabled={running}>
                  <option value="auto">{t('iperf.ipv_auto')}</option>
                  <option value="4">IPv4 (-4)</option>
                  <option value="6">IPv6 (-6)</option>
                </select>)}
            </div>
            <div style={{ display: 'flex', gap: 16, marginTop: 12, flexWrap: 'wrap' }}>
              {checkbox(client.nodelay, v => setC('nodelay', v), t('iperf.nodelay'), running)}
              {version === 'iperf3' && checkbox(client.zerocopy, v => setC('zerocopy', v), t('iperf.zerocopy'), running)}
              {version === 'iperf3' && checkbox(client.json, v => setC('json', v), t('iperf.json'), running)}
              {version === 'iperf2' && checkbox(client.enhanced, v => setC('enhanced', v), t('iperf.enhanced'), running)}
              {version === 'iperf2' && checkbox(client.csv, v => setC('csv', v), t('iperf.csv'), running)}
            </div>
          </details>

          {/* Generated command */}
          <div style={{ ...cmdBoxStyle, marginBottom: 12 }}>
            <code style={cmdCodeStyle}>{clientCmd}</code>
            <CopyBtn text={clientCmd} />
          </div>

          {/* Live run */}
          {binAvail === true && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={startClient} disabled={running || !client.host.trim()}>
                {running ? t('iperf.running') : t('iperf.run_test')}
              </button>
              {running && <button className="btn btn-ghost" onClick={stopClient}>{t('iperf.stop')}</button>}
            </div>
          )}

          {cLines.length > 0 && (
            <div style={{ position: 'relative', marginTop: 12 }}>
              <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
                <CopyBtn text={cLines.map(l => l.text).join('\n')} />
              </div>
              <div ref={cTermRef} style={termStyle}>
                {cLines.map((l, i) => (
                  <div key={i} style={{ color: l.type === 'err' ? '#f0883e' : '#e6edf3', whiteSpace: 'pre' }}>{l.text}</div>
                ))}
                {cExit !== null && (
                  <div style={{ marginTop: 8, color: cExit === 0 ? '#3fb950' : '#f85149', fontStyle: 'italic' }}>
                    {t('iperf.exit_code', { code: cExit })}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── SERVER TAB ──────────────────────────────────────────────────────── */}
      {activeTab === 'server' && (
        <div className="card fadein">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('iperf.server_title')}
            {availBadge()}
          </div>
          <p style={{ fontSize: 12, color: 'var(--dim)', margin: '0 0 12px' }}>{t('iperf.server_subtitle')}</p>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 10, marginBottom: 12 }}>
            {field(t('iperf.port_label'),
              <input className="input" value={server.port} placeholder={IPERF_DEFAULT_PORT[version]} type="number"
                onChange={e => setS('port', e.target.value)} disabled={srvUp} />)}
            {field(t('iperf.bind_label'),
              <input className="input" value={server.bind} placeholder="0.0.0.0 / eth0 IP"
                onChange={e => setS('bind', e.target.value)} disabled={srvUp} />,
              t('iperf.bind_hint'))}
            {field(t('iperf.interval_label'),
              <input className="input" value={server.interval} type="number" min="0" placeholder="1"
                onChange={e => setS('interval', e.target.value)} disabled={srvUp} />)}
            {field(t('iperf.ipv_label'),
              <select className="input" value={server.ipv} onChange={e => setS('ipv', e.target.value)} disabled={srvUp}>
                <option value="auto">{t('iperf.ipv_auto')}</option>
                <option value="4">IPv4 (-4)</option>
                <option value="6">IPv6 (-6)</option>
              </select>)}
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 14, flexWrap: 'wrap' }}>
            {version === 'iperf3' && checkbox(server.oneoff, v => setS('oneoff', v), t('iperf.oneoff'), srvUp)}
            {checkbox(server.daemon, v => setS('daemon', v), t('iperf.daemon'), srvUp)}
            {version === 'iperf3' && checkbox(server.json, v => setS('json', v), t('iperf.json'), srvUp)}
            {version === 'iperf2' && checkbox(server.udp, v => setS('udp', v), t('iperf.server_udp'), srvUp)}
            {version === 'iperf2' && checkbox(server.enhanced, v => setS('enhanced', v), t('iperf.enhanced'), srvUp)}
          </div>

          {/* Generated command */}
          <div style={{ ...cmdBoxStyle, marginBottom: 12 }}>
            <code style={cmdCodeStyle}>{serverCmd}</code>
            <CopyBtn text={serverCmd} />
          </div>

          {/* Live server */}
          {binAvail === true && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
              <button className="btn btn-primary" onClick={startServer} disabled={srvUp}>
                {srvUp ? t('iperf.server_listening') : t('iperf.start_server')}
              </button>
              {srvUp && <button className="btn btn-danger" onClick={stopServer}>{t('iperf.stop_server')}</button>}
            </div>
          )}

          {sLines.length > 0 && (
            <div style={{ position: 'relative', marginTop: 12 }}>
              <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
                <CopyBtn text={sLines.map(l => l.text).join('\n')} />
              </div>
              <div ref={sTermRef} style={termStyle}>
                {sLines.map((l, i) => (
                  <div key={i} style={{ color: l.type === 'err' ? '#f0883e' : '#e6edf3', whiteSpace: 'pre' }}>{l.text}</div>
                ))}
                {sExit !== null && (
                  <div style={{ marginTop: 8, color: sExit === 0 ? '#3fb950' : '#f85149', fontStyle: 'italic' }}>
                    {t('iperf.server_stopped', { code: sExit })}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Docker deploy */}
          <div className="card-title" style={{ marginTop: 22, fontSize: 14 }}>{t('iperf.docker_title')}</div>
          <p style={{ fontSize: 12, color: 'var(--dim)', margin: '0 0 12px' }}>{t('iperf.docker_subtitle')}</p>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{t('iperf.docker_run_label')}</label>
            <div style={{ ...cmdBoxStyle, marginBottom: 12 }}>
              <code style={cmdCodeStyle}>{dockerRun}</code>
              <CopyBtn text={dockerRun} />
            </div>
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label className="label">{t('iperf.docker_compose_label')}</label>
            <div style={cmdBoxStyle}>
              <code style={cmdCodeStyle}>{dockerCompose}</code>
              <CopyBtn text={dockerCompose} />
            </div>
            <span className="hint">{t('iperf.docker_compose_hint')}</span>
          </div>
        </div>
      )}

      {/* ── CHEAT SHEET TAB ─────────────────────────────────────────────────── */}
      {activeTab === 'cheatsheet' && (
        <div className="card fadein">
          <div className="card-title">{t('iperf.cheatsheet_title')}</div>
          <p style={{ fontSize: 13, color: 'var(--dim)', margin: '0 0 8px' }}>{t('iperf.cheatsheet_intro')}</p>

          {/* What is iperf */}
          <div style={{ fontSize: 13, lineHeight: 1.65, color: 'var(--fg)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px 14px', marginBottom: 18 }}>
            {t('iperf.about_body')}
          </div>

          {/* Comparison table */}
          <div style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 8px' }}>{t('iperf.cmp_heading')}</div>
          <div style={{ overflowX: 'auto', marginBottom: 18 }}>
            <table style={tableStyle}>
              <thead><tr>
                <th style={thStyle}>{t('iperf.cmp_feature')}</th>
                <th style={thStyle}>iperf3</th>
                <th style={thStyle}>iperf2</th>
              </tr></thead>
              <tbody>
                {IPERF_COMPARE.map((row, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, color: 'var(--dim)' }}>{row[0]}</td>
                    <td style={tdStyle}>{row[1]}</td>
                    <td style={tdStyle}>{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Options table */}
          <div style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 8px' }}>{t('iperf.opt_heading')}</div>
          <div style={{ overflowX: 'auto', marginBottom: 18 }}>
            <table style={tableStyle}>
              <thead><tr>
                <th style={thStyle}>{t('iperf.opt_flag')}</th>
                <th style={thStyle}>{t('iperf.opt_desc')}</th>
              </tr></thead>
              <tbody>
                {IPERF_OPTIONS.map((row, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, fontFamily: 'var(--mono)', color: 'var(--cyan)', whiteSpace: 'nowrap' }}>{row[0]}</td>
                    <td style={tdStyle}>{row[1]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Scenarios */}
          <div style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 8px' }}>{t('iperf.scn_heading')}</div>
          <div style={{ overflowX: 'auto', marginBottom: 18 }}>
            <table style={tableStyle}>
              <thead><tr>
                <th style={thStyle}>{t('iperf.scn_use')}</th>
                <th style={thStyle}>{t('iperf.scn_side')}</th>
                <th style={thStyle}>{t('iperf.scn_cmd')}</th>
              </tr></thead>
              <tbody>
                {IPERF_SCENARIOS.map((row, i) => (
                  <tr key={i}>
                    <td style={{ ...tdStyle, color: 'var(--dim)' }}>{row[0]}</td>
                    <td style={tdStyle}>
                      <span className={`badge ${row[1] === 'server' ? 'badge-purple' : 'badge-cyan'}`}>{row[1]}</span>
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--mono)', color: 'var(--cyan)' }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        {row[2]}<CopyBtn text={row[2]} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Install */}
          <div style={{ fontWeight: 600, fontSize: 14, margin: '8px 0 8px' }}>{t('iperf.install_heading')}</div>
          <div style={{ ...cmdBoxStyle, marginBottom: 10 }}>
            <code style={cmdCodeStyle}>{`# Debian / Ubuntu\nsudo apt install iperf3 iperf\n\n# RHEL / Rocky / Alma\nsudo dnf install iperf3 iperf\n\n# macOS (Homebrew)\nbrew install iperf3 iperf\n\n# Alpine\napk add iperf3 iperf`}</code>
            <CopyBtn text={`sudo apt install iperf3 iperf`} />
          </div>

          {/* Gotchas */}
          <div style={{ fontWeight: 600, fontSize: 14, margin: '14px 0 8px' }}>{t('iperf.notes_heading')}</div>
          <ul style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--dim)', margin: 0, paddingLeft: 20 }}>
            <li>{t('iperf.note_1')}</li>
            <li>{t('iperf.note_2')}</li>
            <li>{t('iperf.note_3')}</li>
            <li>{t('iperf.note_4')}</li>
            <li>{t('iperf.note_5')}</li>
          </ul>
        </div>
      )}
    </div>
  );
}

window.IperfBuilder = IperfBuilder;
