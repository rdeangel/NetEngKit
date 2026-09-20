const { useState, useEffect, useCallback, useRef } = React;

function NetworkScanner({ onShare, initialData }) {
  const { t } = useTranslation();

  // ── CLI planner state ──────────────────────────────────────────────────────
  const [cidr, setCidr]     = usePersistentState('scanner:cidr', initialData?.cidr ?? '192.168.1.0/24');
  const [result, setResult] = usePersistentState('scanner:result', null);
  const [err, setErr]       = useState('');

  // ── Tab ────────────────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = usePersistentState('scanner:activeTab', 'nmap');

  // ── Server capabilities ────────────────────────────────────────────────────
  // null = checking, true = available, false = unavailable, 'missing' = no tools
  const [serverMode, setServerMode]   = useState(null);
  const [nmapAvail, setNmapAvail]     = useState(null);
  const [fpingAvail, setFpingAvail]   = useState(null);

  // ── Live sweep state (ping + DNS via subnet_scan.sh) ──────────────────────
  const [scanning, setScanning]         = useState(false);
  const [lines, setLines]               = useState([]);
  const [exitCode, setExitCode]         = useState(null);
  const [pingCount, setPingCount]       = usePersistentState('scanner:pingCount', '1');
  const [pingInterval, setPingInterval] = usePersistentState('scanner:pingInterval', '1');
  const [dnsServer, setDnsServer]       = usePersistentState('scanner:dnsServer', '');
  const [searchDns, setSearchDns]       = usePersistentState('scanner:searchDns', '');
  const esRef   = useRef(null);
  const termRef = useRef(null);

  // ── nmap state ────────────────────────────────────────────────────────────
  const [nmapScanType, setNmapScanType]   = usePersistentState('scanner:nmapScanType', 'sn');
  const [nmapPorts, setNmapPorts]         = usePersistentState('scanner:nmapPorts', '');
  const [nmapTiming, setNmapTiming]       = usePersistentState('scanner:nmapTiming', '3');
  const [nmapShowOpen, setNmapShowOpen]   = usePersistentState('scanner:nmapShowOpen', false);
  const [nmapVerbose, setNmapVerbose]     = usePersistentState('scanner:nmapVerbose', false);
  const [nmapScanning, setNmapScanning]   = useState(false);
  const [nmapLines, setNmapLines]         = useState([]);
  const [nmapExitCode, setNmapExitCode]   = useState(null);
  const nmapEsRef   = useRef(null);
  const nmapTermRef = useRef(null);

  // ── fping state ───────────────────────────────────────────────────────────
  const [fpingCount, setFpingCount]       = usePersistentState('scanner:fpingCount', '');
  const [fpingTimeout, setFpingTimeout]   = usePersistentState('scanner:fpingTimeout', '');
  const [fpingInterval, setFpingInterval] = usePersistentState('scanner:fpingInterval', '');
  const [fpingQuiet, setFpingQuiet]       = usePersistentState('scanner:fpingQuiet', false);
  const [fpingStats, setFpingStats]       = usePersistentState('scanner:fpingStats', false);
  const [fpingScanning, setFpingScanning] = useState(false);
  const [fpingLines, setFpingLines]       = useState([]);
  const [fpingExitCode, setFpingExitCode] = useState(null);
  const fpingEsRef   = useRef(null);
  const fpingTermRef = useRef(null);

  // ── Capabilities check ────────────────────────────────────────────────────
  useEffect(() => {
    fetch('/api/capabilities', { signal: AbortSignal.timeout(2500) })
      .then(r => r.json())
      .then(data => {
        if (data.pingSweep) setServerMode(true);
        else setServerMode('missing');
        setNmapAvail(data.nmap ?? false);
        setFpingAvail(data.fping ?? false);
      })
      .catch(() => { setServerMode(false); setNmapAvail(false); setFpingAvail(false); });
  }, []);

  // ── Auto-scroll terminals ──────────────────────────────────────────────────
  useEffect(() => { if (termRef.current) termRef.current.scrollTop = termRef.current.scrollHeight; }, [lines]);
  useEffect(() => { if (nmapTermRef.current) nmapTermRef.current.scrollTop = nmapTermRef.current.scrollHeight; }, [nmapLines]);
  useEffect(() => { if (fpingTermRef.current) fpingTermRef.current.scrollTop = fpingTermRef.current.scrollHeight; }, [fpingLines]);

  // ── Live CIDR validation ───────────────────────────────────────────────────
  useEffect(() => {
    const isHost = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(cidr) || /^localhost$/.test(cidr) || /^(\d{1,3}\.){3}\d{1,3}$/.test(cidr);
    const c = IPv4.parseCIDR(cidr);
    if (!c) {
      if (isHost) {
        setErr('');
        setResult({ isHostname: true, target: cidr });
        setActiveTab('nmap');
        setNmapScanType(prev => prev === 'sn' ? 'sT' : prev);
        return;
      }
      setResult(null); setErr(''); return;
    }
    const sn = IPv4.subnet(c.ip, c.prefix);
    if (sn.totalHosts > 65536) { setResult(null); setErr(t('scanner.err_too_large')); return; }
    setErr('');
    setResult({ sn });
  }, [cidr]);

  useEffect(() => {
    if (initialData?.cidr !== undefined) setCidr(initialData.cidr);
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (cidr) (e.detail?.respond ?? onShare)({ tool: 'scanner', cidr });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [cidr, onShare]);

  // ── Derived commands ───────────────────────────────────────────────────────
  const bash = (result && !result.isHostname) ? (() => {
    const base  = result.sn.firstHostStr.split('.').slice(0, 3).join('.');
    const first = result.sn.firstHostStr.split('.')[3];
    const last  = result.sn.lastHostStr.split('.')[3];
    return `bash -c 'trap "echo; echo Scan stopped.; exit 0" INT; for ip in $(seq ${first} ${last}); do ping -c 1 -W 1 ${base}.$ip &>/dev/null && echo "${base}.$ip is UP"; done'`;
  })() : '';

  const nmapCmd = result ? (() => {
    const args = ['nmap', `-${nmapScanType}`];
    const t3 = parseInt(nmapTiming, 10);
    if (t3 >= 1 && t3 <= 5) args.push(`-T${t3}`);
    if (nmapShowOpen) args.push('--open');
    if (nmapVerbose) args.push('-v');
    if (nmapPorts && nmapScanType !== 'sn') args.push('-p', nmapPorts);
    args.push(result.isHostname ? result.target : result.sn.cidr);
    return args.join(' ');
  })() : '';

  const fpingCmd = (result && !result.isHostname) ? (() => {
    const args = ['fping', '-ag'];
    if (fpingCount) args.push('-c', fpingCount);
    if (fpingTimeout) args.push('-t', fpingTimeout);
    if (fpingInterval) args.push('-i', fpingInterval);
    if (fpingQuiet) args.push('-q');
    if (fpingStats) args.push('-s');
    args.push(`${result.sn.networkStr}/${result.sn.prefix}`, '2>/dev/null');
    return args.join(' ');
  })() : '';

  // ── Live sweep (subnet_scan.sh) ────────────────────────────────────────────
  const startScan = useCallback(() => {
    if (!result) return;
    setLines([]); setExitCode(null); setScanning(true);

    const params = new URLSearchParams({ subnet: result.sn.cidr });
    if (pingCount)    params.set('c', pingCount);
    if (pingInterval) params.set('i', pingInterval);
    if (dnsServer.trim()) params.set('n', dnsServer.trim());
    if (searchDns.trim()) params.set('s', searchDns.trim());

    const es = new EventSource(`/api/ping-sweep?${params}`);
    esRef.current = es;

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'done') {
        setExitCode(Number(msg.line)); setScanning(false); es.close();
      } else {
        setLines(prev => [...prev, { type: msg.type, text: msg.line }]);
      }
    };
    es.onerror = () => { setScanning(false); es.close(); };
  }, [result, pingCount, pingInterval, dnsServer, searchDns]);

  const stopScan = () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    setScanning(false);
  };

  // ── nmap run ───────────────────────────────────────────────────────────────
  const startNmap = useCallback(() => {
    if (!result) return;
    setNmapLines([]); setNmapExitCode(null); setNmapScanning(true);

    const target = result.isHostname ? result.target : result.sn.cidr;
    const params = new URLSearchParams({ target, type: nmapScanType, timing: nmapTiming });
    if (nmapShowOpen) params.set('open', '1');
    if (nmapVerbose) params.set('verbose', '1');
    if (nmapPorts && nmapScanType !== 'sn') params.set('ports', nmapPorts);

    const es = new EventSource(`/api/nmap-run?${params}`);
    nmapEsRef.current = es;

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'done') {
        setNmapExitCode(Number(msg.line)); setNmapScanning(false); es.close();
      } else {
        setNmapLines(prev => [...prev, { type: msg.type, text: msg.line }]);
      }
    };
    es.onerror = () => { setNmapScanning(false); es.close(); };
  }, [result, nmapScanType, nmapTiming, nmapShowOpen, nmapVerbose, nmapPorts]);

  const stopNmap = () => {
    if (nmapEsRef.current) { nmapEsRef.current.close(); nmapEsRef.current = null; }
    setNmapScanning(false);
  };

  // ── fping run ──────────────────────────────────────────────────────────────
  const startFping = useCallback(() => {
    if (!result || result.isHostname) return;
    setFpingLines([]); setFpingExitCode(null); setFpingScanning(true);

    const params = new URLSearchParams({ subnet: result.sn.cidr });
    if (fpingCount) params.set('count', fpingCount);
    if (fpingTimeout) params.set('timeout', fpingTimeout);
    if (fpingInterval) params.set('interval', fpingInterval);
    if (fpingQuiet) params.set('quiet', '1');
    if (fpingStats) params.set('stats', '1');

    const es = new EventSource(`/api/fping-run?${params}`);
    fpingEsRef.current = es;

    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'done') {
        setFpingExitCode(Number(msg.line)); setFpingScanning(false); es.close();
      } else {
        setFpingLines(prev => [...prev, { type: msg.type, text: msg.line }]);
      }
    };
    es.onerror = () => { setFpingScanning(false); es.close(); };
  }, [result, fpingCount, fpingTimeout, fpingInterval, fpingQuiet, fpingStats]);

  const stopFping = () => {
    if (fpingEsRef.current) { fpingEsRef.current.close(); fpingEsRef.current = null; }
    setFpingScanning(false);
  };

  // ── Helpers (plain functions, not components, to avoid re-mount issues) ────
  const termStyle = {
    background: '#1a1f2e',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '12px 14px',
    maxHeight: 360,
    overflowY: 'auto',
    overflowX: 'auto',
    fontFamily: 'var(--mono)',
    fontSize: 12,
    lineHeight: 1.6,
  };

  const availBadge = (avail) => {
    if (avail === null) return <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal' }}>{t('scanner.server_checking')}</span>;
    if (serverMode === false) return <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>{t('scanner.server_required')}</span>;
    if (avail === false) return <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>{t('scanner.tool_unavailable')}</span>;
    return null;
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fadein">

      {/* CIDR input */}
      <div className="card">
        <div className="card-title">{t('scanner.title')}</div>
        <div className="field">
          <label className="label">{t('scanner.network_label')}</label>
          <input
            className={`input ${err ? 'error' : ''}`}
            value={cidr}
            onChange={e => setCidr(e.target.value)}
            placeholder={t('scanner.network_placeholder')}
          />
          <Err msg={err} />
        </div>
      </div>

      {/* Tab bar — only shown when a valid subnet is entered */}
      {result && (() => {
        const tabs = result.isHostname ? [
          { id: 'nmap',   label: t('scanner.tab_nmap') }
        ] : [
          { id: 'nmap',   label: t('scanner.tab_nmap') },
          { id: 'fping',  label: t('scanner.tab_fping') },
          { id: 'custom', label: t('scanner.tab_custom') },
          { id: 'ping',   label: t('scanner.tab_ping_bash') },
        ];
        return (
          <div style={{ display: 'flex', gap: 4, marginBottom: 0, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                background: activeTab === tab.id ? 'var(--card)' : 'transparent',
                border: '1px solid var(--border)',
                borderBottom: activeTab === tab.id ? '1px solid var(--card)' : '1px solid var(--border)',
                borderRadius: 'var(--radius) var(--radius) 0 0',
                color: activeTab === tab.id ? 'var(--fg)' : 'var(--dim)',
                cursor: 'pointer',
                fontSize: 13,
                fontFamily: 'inherit',
                padding: '7px 16px',
                marginBottom: -1,
                position: 'relative',
              }}>
                {tab.label}
              </button>
            ))}
          </div>
        );
      })()}

      {/* nmap tab */}
      {activeTab === 'nmap' && result && (
        <div className="card fadein">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('scanner.nmap_title')}
            {availBadge(nmapAvail)}
          </div>
          <p style={{ fontSize: 12, color: 'var(--dim)', margin: '0 0 12px' }}>{t('scanner.nmap_subtitle')}</p>

          {/* nmap options */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8, marginBottom: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('scanner.nmap_scan_type')}</label>
              <select className="input" value={nmapScanType} onChange={e => setNmapScanType(e.target.value)} disabled={nmapScanning || result.isHostname}>
                {!result.isHostname && <option value="sn">{t('scanner.nmap_type_sn')}</option>}
                <option value="sT">{t('scanner.nmap_type_sT')}</option>
                <option value="sV">{t('scanner.nmap_type_sV')}</option>
              </select>
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('scanner.nmap_timing')}</label>
              <select className="input" value={nmapTiming} onChange={e => setNmapTiming(e.target.value)} disabled={nmapScanning}>
                <option value="1">{t('scanner.nmap_timing_t1')}</option>
                <option value="2">{t('scanner.nmap_timing_t2')}</option>
                <option value="3">{t('scanner.nmap_timing_t3')}</option>
                <option value="4">{t('scanner.nmap_timing_t4')}</option>
                <option value="5">{t('scanner.nmap_timing_t5')}</option>
              </select>
            </div>
            {nmapScanType !== 'sn' && (
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('scanner.nmap_ports')}</label>
                <input className="input" value={nmapPorts} placeholder={t('scanner.nmap_ports_placeholder')}
                  onChange={e => setNmapPorts(e.target.value)} disabled={nmapScanning} />
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={nmapShowOpen} onChange={e => setNmapShowOpen(e.target.checked)} disabled={nmapScanning} />
              {t('scanner.nmap_show_open')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={nmapVerbose} onChange={e => setNmapVerbose(e.target.checked)} disabled={nmapScanning} />
              {t('scanner.nmap_verbose')}
            </label>
          </div>

          {/* Generated command */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 12 }}>
            <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cyan)', flex: 1, wordBreak: 'break-all' }}>{nmapCmd}</code>
            <CopyBtn text={nmapCmd} />
          </div>

          {/* Run button (server mode only) */}
          {nmapAvail === true && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={startNmap} disabled={nmapScanning}>
                {nmapScanning ? t('scanner.nmap_running') : t('scanner.nmap_run')}
              </button>
              {nmapScanning && (
                <button className="btn btn-ghost" onClick={stopNmap}>{t('scanner.stop_scan')}</button>
              )}
            </div>
          )}

          {nmapLines.length > 0 && (
            <div style={{ position: 'relative', marginTop: 12 }}>
              <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
                <CopyBtn text={nmapLines.map(l => l.text).join('\n')} keyName="copy_all" />
              </div>
              <div ref={nmapTermRef} style={termStyle}>
                {nmapLines.map((l, i) => (
                  <div key={i} style={{ color: l.type === 'err' ? 'var(--dim)' : '#e6edf3', whiteSpace: 'pre' }}>{l.text}</div>
                ))}
                {nmapExitCode !== null && (
                  <div style={{ marginTop: 8, color: nmapExitCode === 0 ? '#3fb950' : '#f85149', fontStyle: 'italic' }}>
                    {t('scanner.scan_complete').replace('{code}', nmapExitCode)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* fping tab */}
      {activeTab === 'fping' && result && (
        <div className="card fadein">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('scanner.fping_title')}
            {availBadge(fpingAvail)}
          </div>
          <p style={{ fontSize: 12, color: 'var(--dim)', margin: '0 0 12px' }}>{t('scanner.fping_subtitle')}</p>

          {/* fping options */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: 8, marginBottom: 12 }}>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('scanner.fping_count')}</label>
              <input className="input" type="number" min="1" max="20" value={fpingCount}
                placeholder="1" onChange={e => setFpingCount(e.target.value)} disabled={fpingScanning} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('scanner.fping_timeout')}</label>
              <input className="input" type="number" min="50" max="5000" value={fpingTimeout}
                placeholder="500" onChange={e => setFpingTimeout(e.target.value)} disabled={fpingScanning} />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('scanner.fping_interval')}</label>
              <input className="input" type="number" min="1" max="1000" value={fpingInterval}
                placeholder="25" onChange={e => setFpingInterval(e.target.value)} disabled={fpingScanning} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={fpingQuiet} onChange={e => setFpingQuiet(e.target.checked)} disabled={fpingScanning} />
              {t('scanner.fping_quiet')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={fpingStats} onChange={e => setFpingStats(e.target.checked)} disabled={fpingScanning} />
              {t('scanner.fping_stats')}
            </label>
          </div>

          {/* Generated command */}
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 12 }}>
            <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cyan)', flex: 1, wordBreak: 'break-all' }}>{fpingCmd}</code>
            <CopyBtn text={fpingCmd} />
          </div>

          {/* Run button (server mode only) */}
          {fpingAvail === true && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn btn-primary" onClick={startFping} disabled={fpingScanning}>
                {fpingScanning ? t('scanner.fping_running') : t('scanner.fping_run')}
              </button>
              {fpingScanning && (
                <button className="btn btn-ghost" onClick={stopFping}>{t('scanner.stop_scan')}</button>
              )}
            </div>
          )}

          {fpingLines.length > 0 && (
            <div style={{ position: 'relative', marginTop: 12 }}>
              <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
                <CopyBtn text={fpingLines.map(l => l.text).join('\n')} keyName="copy_all" />
              </div>
              <div ref={fpingTermRef} style={termStyle}>
                {fpingLines.map((l, i) => (
                  <div key={i} style={{ color: l.type === 'err' ? 'var(--dim)' : '#e6edf3', whiteSpace: 'pre' }}>{l.text}</div>
                ))}
                {fpingExitCode !== null && (
                  <div style={{ marginTop: 8, color: fpingExitCode === 0 ? '#3fb950' : '#f85149', fontStyle: 'italic' }}>
                    {t('scanner.scan_complete').replace('{code}', fpingExitCode)}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ping (bash) tab */}
      {activeTab === 'ping' && result && (
        <div className="card fadein">
          <div className="card-title">{t('scanner.ping_bash_title')}</div>
          <p style={{ fontSize: 12, color: 'var(--dim)', margin: '0 0 12px' }}>{t('scanner.ping_bash_subtitle')}</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <code style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cyan)', flex: 1, wordBreak: 'break-all' }}>{bash}</code>
              <CopyBtn text={bash} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--dim)' }}>{t('scanner.ping_bash_hint')}</span>
          </div>
        </div>
      )}

      {/* Custom bash script tab */}
      {activeTab === 'custom' && <div className="card" style={{ opacity: serverMode === false || serverMode === 'missing' ? 0.6 : 1 }}>
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('scanner.live_title')}
          {serverMode === null && (
            <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal' }}>{t('scanner.server_checking')}</span>
          )}
          {serverMode === false && (
            <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
              {t('scanner.server_required')}
            </span>
          )}
          {serverMode === 'missing' && (
            <span style={{ fontSize: 11, color: 'var(--yellow,#f59e0b)', fontWeight: 'normal' }}>{t('scanner.server_missing_tools')}</span>
          )}
        </div>

        {(serverMode === false || serverMode === 'missing') && (
          <p style={{ fontSize: 13, color: 'var(--dim)', margin: '4px 0 0' }}>
            {serverMode === false ? t('scanner.server_required_desc') : t('scanner.server_missing_tools')}
          </p>
        )}

        {serverMode === true && (
          <>
            <p style={{ fontSize: 12, color: 'var(--dim)', margin: '0 0 12px' }}>{t('scanner.live_subtitle')}</p>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: 8, marginBottom: 12 }}>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('scanner.ping_count_label')}</label>
                <input className="input" type="number" min="1" max="10" value={pingCount}
                  onChange={e => setPingCount(e.target.value)} disabled={scanning} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('scanner.ping_interval_label')}</label>
                <input className="input" type="number" min="1" max="10" value={pingInterval}
                  onChange={e => setPingInterval(e.target.value)} disabled={scanning} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('scanner.dns_server_label')}</label>
                <input className="input" value={dnsServer} placeholder={t('scanner.dns_server_placeholder')}
                  onChange={e => setDnsServer(e.target.value)} disabled={scanning} />
              </div>
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('scanner.search_dns_label')}</label>
                <input className="input" value={searchDns} placeholder={t('scanner.search_dns_placeholder')}
                  onChange={e => setSearchDns(e.target.value)} disabled={scanning} />
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: lines.length > 0 ? 12 : 0 }}>
              <button className="btn btn-primary" onClick={startScan} disabled={scanning}>
                {scanning ? t('scanner.scanning') : t('scanner.start_scan')}
              </button>
              {scanning && (
                <button className="btn btn-ghost" onClick={stopScan}>{t('scanner.stop_scan')}</button>
              )}
            </div>

            {lines.length > 0 && (
              <div style={{ position: 'relative' }}>
                <div style={{ position: 'absolute', top: 8, right: 8, zIndex: 1 }}>
                  <CopyBtn text={lines.map(l => l.text).join('\n')} keyName="copy_all" />
                </div>
                <div ref={termRef} style={{
                  background: '#1a1f2e',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '12px 14px',
                  maxHeight: 420,
                  overflowY: 'auto',
                  overflowX: 'auto',
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  lineHeight: 1.6,
                }}>
                  {lines.map((l, i) => (
                    <div key={i} style={{ color: l.type === 'err' ? 'var(--dim)' : '#e6edf3', whiteSpace: 'pre' }}>{l.text}</div>
                  ))}
                  {exitCode !== null && (
                    <div style={{ marginTop: 8, color: exitCode === 0 ? '#3fb950' : '#f85149', fontStyle: 'italic' }}>
                      {t('scanner.scan_complete').replace('{code}', exitCode)}
                    </div>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>}
    </div>
  );
}

window.NetworkScanner = NetworkScanner;
