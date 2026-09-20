const { useState, useEffect, useRef } = React;

// ── Gauge: fixed 270° arc, stroke-dasharray/dashoffset for smooth animation
// Center (90,95) radius 70: start -135°→ end +135°
// M 40.50 45.50 A 70 70 0 1 1 40.50 144.50
const GAUGE_TRACK  = 'M 40.50 45.50 A 70 70 0 1 1 40.50 144.50';
const GAUGE_LEN    = 70 * Math.PI * 1.5; // 329.87

function SpeedGauge({ running, phase, progress, displaySpeed, color, label, downloadMbps, uploadMbps }) {
  const showSpeed   = phase === 'download' || phase === 'upload';
  const showResults = !running && phase === 'done';
  const offset      = GAUGE_LEN * (1 - Math.min(Math.max(progress, 0), 1));

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', margin: '4px 0 8px' }}>
      <svg width="180" height="140" viewBox="0 0 180 140">
        {/* Track */}
        <path d={GAUGE_TRACK} fill="none" stroke="var(--border)" strokeWidth="10" strokeLinecap="round" />
        {/* Progress — butt caps avoid the arc-endpoint dash artifact */}
        <path d={GAUGE_TRACK} fill="none" stroke={color} strokeWidth="10" strokeLinecap="butt"
          strokeDasharray={GAUGE_LEN} strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.35s ease, stroke 0.3s ease' }} />
        {/* Pulsing dot at bottom of arc — only while actively running */}
        {running && (
          <circle cx="90" cy="128" fill={color}>
            <animate attributeName="r" values="4;9;4" dur="1.4s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0.25;1" dur="1.4s" repeatCount="indefinite" />
          </circle>
        )}
        {/* Live speed readout during download/upload phases */}
        {showSpeed && (
          <>
            <text x="90" y="88" textAnchor="middle" fontSize="24" fontWeight="700"
              fill="var(--text)" fontFamily="monospace">{displaySpeed.toFixed(1)}</text>
            <text x="90" y="105" textAnchor="middle" fontSize="11" fill="var(--muted)">Mbps</text>
          </>
        )}
        {/* Final results: ↓ download big, ↑ upload smaller — same structure, arrow left, Mbps right */}
        {showResults && downloadMbps && (
          <>
            <text x="90" y="91" textAnchor="middle" fontSize="20" fontWeight="700"
              fill="var(--blue,#3b82f6)" fontFamily="monospace">
              <tspan>↓ </tspan><tspan>{downloadMbps}</tspan>
              <tspan fontSize="11" fontWeight="400" fill="var(--muted)"> Mbps</tspan>
            </text>
            <text x="90" y="114" textAnchor="middle" fontSize="14" fontWeight="600"
              fill="var(--green,#22c55e)" fontFamily="monospace">
              <tspan>↑ </tspan><tspan>{uploadMbps}</tspan>
              <tspan fontSize="10" fontWeight="400" fill="var(--muted)"> Mbps</tspan>
            </text>
          </>
        )}
      </svg>
      <div style={{ fontSize: 11, color, fontWeight: 600, letterSpacing: 1, textTransform: 'uppercase', marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}

function ResultTile({ label, value, unit, color, progress, showBar }) {
  return (
    <div style={{ background: 'var(--panel)', borderRadius: 6, padding: '10px 14px', border: '1px solid var(--border)' }}>
      <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 700, color }}>
        {value}<span style={{ fontSize: 12, fontWeight: 400, color: 'var(--muted)', marginLeft: 3 }}>{unit}</span>
      </div>
      {showBar && (
        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginTop: 6 }}>
          <div style={{ height: '100%', width: `${(progress || 0) * 100}%`, background: color, borderRadius: 2, transition: 'width 0.3s' }} />
        </div>
      )}
    </div>
  );
}

// ── Ookla CLI tab ──────────────────────────────────────────────────────────
function OoklaTab({ t, serverMode }) {
  const [running, setRunning]           = useState(false);
  const [phase, setPhase]               = useState('idle');
  const [pingMs, setPingMs]             = useState(null);
  const [jitterMs, setJitterMs]         = useState(null);
  const [downloadMbps, setDownloadMbps] = useState(null);
  const [uploadMbps, setUploadMbps]     = useState(null);
  const [dlProgress, setDlProgress]     = useState(0);
  const [ulProgress, setUlProgress]     = useState(0);
  const [displaySpeed, setDisplaySpeed] = useState(0);
  const [server, setServer]             = useState(null);
  const [isp, setIsp]                   = useState(null);
  const [resultUrl, setResultUrl]       = useState(null);
  const [err, setErr]                   = useState('');

  const [nearbyServers, setNearbyServers] = useState([]);
  const [selectedServerId, setSelectedServerId] = useState('');
  const [serversLoading, setServersLoading] = useState(false);
  const [serversErr, setServersErr]       = useState('');

  const esRef = useRef(null);

  const bpsToMbps = (bps) => ((bps * 8) / 1_000_000).toFixed(1);
  const closeEs = () => { if (esRef.current) { esRef.current.close(); esRef.current = null; } };

  const loadNearbyServers = async () => {
    setServersLoading(true); setServersErr('');
    try {
      const r = await fetch('/api/speedtest-servers');
      const list = await r.json();
      setNearbyServers(Array.isArray(list) ? list : []);
      if (list.length) setSelectedServerId('');
    } catch {
      setServersErr(t('speedtest.ookla_server_err'));
    }
    setServersLoading(false);
  };

  const runTest = () => {
    if (running) return;
    setRunning(true); setPhase('init'); setErr('');
    setPingMs(null); setJitterMs(null); setDownloadMbps(null); setUploadMbps(null);
    setDlProgress(0); setUlProgress(0); setDisplaySpeed(0);
    setServer(null); setIsp(null); setResultUrl(null);

    closeEs();
    const url = selectedServerId
      ? `/api/speedtest-run?serverId=${encodeURIComponent(selectedServerId)}`
      : '/api/speedtest-run';
    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'testStart') {
        setPhase('ping');
      } else if (msg.type === 'ping') {
        setPhase('ping');
        const d = msg.ping || {};
        if (d.latency != null) setPingMs(d.latency.toFixed(1));
        if (d.jitter  != null) setJitterMs(d.jitter.toFixed(1));
      } else if (msg.type === 'download') {
        setPhase('download');
        const d = msg.download || {};
        const mbps = parseFloat(bpsToMbps(d.bandwidth || 0));
        setDownloadMbps(mbps.toFixed(1));
        setDlProgress(d.progress || 0);
        setDisplaySpeed(mbps);
      } else if (msg.type === 'upload') {
        setPhase('upload');
        const d = msg.upload || {};
        const mbps = parseFloat(bpsToMbps(d.bandwidth || 0));
        setUploadMbps(mbps.toFixed(1));
        setUlProgress(d.progress || 0);
        setDisplaySpeed(mbps);
      } else if (msg.type === 'result') {
        setPhase('done');
        const dl = msg.download || {};
        const ul = msg.upload   || {};
        const pg = msg.ping     || {};
        const sv = msg.server   || {};
        const rs = msg.result   || {};
        setDownloadMbps(bpsToMbps(dl.bandwidth || 0));
        setUploadMbps(bpsToMbps(ul.bandwidth || 0));
        if (pg.latency != null) setPingMs(pg.latency.toFixed(1));
        if (pg.jitter  != null) setJitterMs(pg.jitter.toFixed(1));
        if (sv.name) setServer(`${sv.name}, ${sv.location}`);
        if (msg.isp) setIsp(msg.isp);
        if (rs.url) setResultUrl(rs.url);
        setDlProgress(1); setUlProgress(1);
        setDisplaySpeed(parseFloat(bpsToMbps(dl.bandwidth || 0)));
        setRunning(false); closeEs();
      } else if (msg.type === 'done') {
        if (phase !== 'done') setPhase('done');
        setRunning(false); closeEs();
      } else if (msg.type === 'error') {
        setErr(msg.message || t('speedtest.err_failed'));
        setPhase('error'); setRunning(false); closeEs();
      }
    };

    es.onerror = () => {
      setErr(t('speedtest.err_failed'));
      setPhase('error'); setRunning(false); closeEs();
    };
  };

  const stopTest = () => { closeEs(); setRunning(false); setPhase('idle'); };

  const phaseLabel = () => ({
    init: t('speedtest.phase_init'), ping: t('speedtest.phase_ping'),
    download: t('speedtest.phase_download'), upload: t('speedtest.phase_upload'),
    done: t('speedtest.phase_done'), error: t('speedtest.phase_error'),
  }[phase] || '');

  const phaseColor = () => {
    if (phase === 'download') return 'var(--blue, #3b82f6)';
    if (phase === 'upload')   return 'var(--green, #22c55e)';
    if (phase === 'ping' || phase === 'init') return 'var(--yellow, #f59e0b)';
    if (phase === 'done')     return 'var(--green, #22c55e)';
    if (phase === 'error')    return 'var(--red, #ef4444)';
    return 'var(--muted)';
  };

  const gaugeProgress =
    phase === 'download' ? dlProgress
    : phase === 'upload' ? ulProgress
    : phase === 'done'   ? 1
    : (phase === 'ping' || phase === 'init') ? 0.06
    : 0;

  const pingColor = pingMs
    ? (parseFloat(pingMs) < 20 ? 'var(--green)' : parseFloat(pingMs) < 60 ? 'var(--yellow,#f59e0b)' : 'var(--red)')
    : 'var(--muted)';

  if (serverMode === false) {
    return <p style={{ fontSize: 13, color: 'var(--dim)', margin: '4px 0 0' }}>{t('scanner.server_required_desc')}</p>;
  }

  if (serverMode === 'missing') {
    return (
      <div style={{ fontSize: 13, color: 'var(--dim)', margin: '8px 0 0', lineHeight: 1.7 }}>
        <p style={{ margin: '0 0 6px' }}>{t('speedtest.cli_missing_desc')}</p>
        <code style={{ background: 'var(--panel)', padding: '6px 10px', borderRadius: 4, fontSize: 12, display: 'block', marginBottom: 8, overflowX: 'auto', whiteSpace: 'pre' }}>
          {'curl -s https://packagecloud.io/install/repositories/ookla/speedtest-cli/script.deb.sh | bash && apt-get install -y speedtest'}
        </code>
        <a href="https://www.speedtest.net/apps/cli" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: 12 }}>
          {t('speedtest.cli_install_link')} ↗
        </a>
      </div>
    );
  }

  if (serverMode === null) {
    return <div style={{ fontSize: 12, color: 'var(--dim)', padding: '12px 0' }}>{t('common.loading')}</div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <p style={{ fontSize: 12, color: 'var(--dim)', margin: '4px 0 12px', alignSelf: 'flex-start' }}>{t('speedtest.subtitle_ookla')}</p>

      <SpeedGauge running={running} phase={phase} progress={gaugeProgress}
        displaySpeed={displaySpeed} color={phaseColor()} label={phaseLabel()}
        downloadMbps={downloadMbps} uploadMbps={uploadMbps} />

      {/* Server picker */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>{t('speedtest.ookla_server_label')}:</span>
          {nearbyServers.length > 0 ? (
            <select className="input" style={{ fontSize: 12, padding: '3px 6px', width: 'auto', maxWidth: '240px', textOverflow: 'ellipsis' }}
              value={selectedServerId} onChange={e => setSelectedServerId(e.target.value)} disabled={running}>
              <option value="">{t('speedtest.ookla_server_auto')}</option>
              {nearbyServers.map(s => (
                <option key={s.id} value={s.id}>{s.name} — {s.location}, {s.country}</option>
              ))}
            </select>
          ) : (
            <span style={{ fontSize: 12, color: 'var(--dim)', fontStyle: 'italic' }}>{t('speedtest.ookla_server_auto')}</span>
          )}
        </div>
        <button className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}
          onClick={loadNearbyServers} disabled={running || serversLoading}>
          {serversLoading ? t('speedtest.ookla_server_loading') : t('speedtest.ookla_server_load')}
        </button>
        {serversErr && <p style={{ fontSize: 12, color: 'var(--red)', margin: 0 }}>{serversErr}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className="btn btn-primary" onClick={runTest} disabled={running}>{t('speedtest.run')}</button>
        {running && <button className="btn btn-ghost" onClick={stopTest}>{t('speedtest.stop')}</button>}
      </div>

      <Err msg={err} />

      {/* Ping + Jitter — compact, mobile-friendly */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', width: '100%', maxWidth: 300 }}>
        <div style={{ flex: 1, background: 'var(--panel)', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{t('speedtest.ping')}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: pingColor, lineHeight: 1.1 }}>
            {pingMs || '—'}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)', marginLeft: 2 }}>{pingMs ? 'ms' : ''}</span>
          </div>
        </div>
        <div style={{ flex: 1, background: 'var(--panel)', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{t('speedtest.jitter')}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--muted)', lineHeight: 1.1 }}>
            {jitterMs || '—'}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)', marginLeft: 2 }}>{jitterMs ? 'ms' : ''}</span>
          </div>
        </div>
      </div>

      {phase === 'done' && (server || isp || resultUrl) && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--dim)', lineHeight: 1.7, textAlign: 'center' }}>
          {server    && <div>{t('speedtest.server')}: {server}</div>}
          {isp       && <div>{t('speedtest.isp')}: {isp}</div>}
          {resultUrl && (
            <a href={resultUrl} target="_blank" rel="noopener noreferrer"
              style={{ color: 'var(--accent)', display: 'inline-block', marginTop: 4 }}>
              {t('speedtest.view_result')} ↗
            </a>
          )}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 16, textAlign: 'center' }}>
        {t('speedtest.powered_by')}{' '}<a href="https://www.speedtest.net/apps/cli" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>Speedtest CLI by Ookla</a>
      </div>
    </div>
  );
}

// ── LibreSpeed tab ─────────────────────────────────────────────────────────
// ── LibreSpeed CLI runner ───────────────────────────────────────────────────
function LibreSpeedCLI({ t }) {
  const [servers, setServers]         = useState([]);
  const [selIdx, setSelIdx]           = useState(0);
  const [fetching, setFetching]       = useState(false);
  const [customMode, setCustomMode]   = useState(false);
  const [customJsonUrl, setCustomJsonUrl] = useState('');

  const [running, setRunning]           = useState(false);
  const [phase, setPhase]               = useState('idle');
  const [pingMs, setPingMs]             = useState(null);
  const [jitterMs, setJitterMs]         = useState(null);
  const [downloadMbps, setDownloadMbps] = useState(null);
  const [uploadMbps, setUploadMbps]     = useState(null);
  const [dlProgress, setDlProgress]     = useState(0);
  const [ulProgress, setUlProgress]     = useState(0);
  const [displaySpeed, setDisplaySpeed] = useState(0);
  const [server, setServer]             = useState(null);
  const [isp, setIsp]                   = useState(null);
  const [err, setErr]                   = useState('');
  const esRef       = useRef(null);
  const fakeTimerRef = useRef(null);

  useEffect(() => {
    setFetching(true);
    fetch('/api/librespeed-servers')
      .then(r => r.json())
      .then(json => { if (Array.isArray(json) && json.length) { setServers(json); setSelIdx(0); } })
      .catch(() => {})
      .finally(() => setFetching(false));
  }, []);

  const fetchList = async () => {
    setFetching(true); setErr('');
    try {
      const resp = await fetch('/api/librespeed-servers');
      const json = await resp.json();
      if (Array.isArray(json) && json.length) { setServers(json); setSelIdx(0); }
      else setErr(t('speedtest.ls_list_empty'));
    } catch { setErr(t('speedtest.ls_list_err')); }
    setFetching(false);
  };

  const clearFakeTimer = () => {
    if (fakeTimerRef.current) { clearInterval(fakeTimerRef.current); fakeTimerRef.current = null; }
  };

  const startFakeProgress = (setter, durationMs) => {
    clearFakeTimer();
    let p = 0;
    fakeTimerRef.current = setInterval(() => {
      p = Math.min(p + 250 / durationMs, 0.94);
      setter(p);
    }, 250);
  };

  const closeEs = () => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }
    clearFakeTimer();
  };

  const runTest = () => {
    if (running) return;

    let qs = '';
    if (customMode) {
      const url = customJsonUrl.trim();
      if (!url) { setErr(t('speedtest.ls_err_no_server')); return; }
      qs = `?serverJson=${encodeURIComponent(url)}`;
    } else {
      const sv = servers[selIdx];
      if (!sv || !sv.id) { setErr(t('speedtest.ls_err_no_server')); return; }
      qs = `?serverId=${encodeURIComponent(sv.id)}`;
    }

    setRunning(true); setPhase('init'); setErr('');
    setPingMs(null); setJitterMs(null); setDownloadMbps(null); setUploadMbps(null);
    setDlProgress(0); setUlProgress(0); setDisplaySpeed(0);
    setServer(null); setIsp(null);

    closeEs();
    const es = new EventSource(`/api/librespeed-run${qs}`);
    esRef.current = es;

    es.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }

      if (msg.type === 'testStart') {
        setPhase('ping');
      } else if (msg.type === 'ping') {
        setPhase('ping');
      } else if (msg.type === 'download') {
        setPhase('download');
        startFakeProgress(setDlProgress, 10000);
      } else if (msg.type === 'upload') {
        setPhase('upload');
        startFakeProgress(setUlProgress, 9000);
      } else if (msg.type === 'speed') {
        // Live speed tick from proxy (librespeed-cli has no streaming output)
        if (msg.speed != null) setDisplaySpeed(msg.speed);
      } else if (msg.type === 'result') {
        clearFakeTimer();
        setPhase('done');
        if (msg.ping     != null) setPingMs(msg.ping.toFixed(1));
        if (msg.jitter   != null) setJitterMs(msg.jitter.toFixed(1));
        if (msg.download != null) { setDownloadMbps(msg.download.toFixed(1)); setDisplaySpeed(msg.download); }
        if (msg.upload   != null) setUploadMbps(msg.upload.toFixed(1));
        if (msg.server?.name) setServer(msg.server.name);
        if (msg.client?.isp)  setIsp(msg.client.isp);
        setDlProgress(1); setUlProgress(1);
        setRunning(false); closeEs();
      } else if (msg.type === 'done') {
        clearFakeTimer();
        if (phase !== 'done') setPhase('done');
        setRunning(false); closeEs();
      } else if (msg.type === 'error') {
        clearFakeTimer();
        setErr(msg.message || t('speedtest.err_failed'));
        setPhase('error'); setRunning(false); closeEs();
      }
    };

    es.onerror = () => {
      clearFakeTimer();
      setErr(t('speedtest.err_failed'));
      setPhase('error'); setRunning(false); closeEs();
    };
  };

  const stopTest = () => { closeEs(); setRunning(false); setPhase('idle'); };

  const phaseLabel = () => ({
    init: t('speedtest.phase_init'), ping: t('speedtest.phase_ping'),
    download: t('speedtest.phase_download'), upload: t('speedtest.phase_upload'),
    done: t('speedtest.phase_done'), error: t('speedtest.phase_error'),
  }[phase] || '');

  const phaseColor = () => {
    if (phase === 'download') return 'var(--blue, #3b82f6)';
    if (phase === 'upload')   return 'var(--green, #22c55e)';
    if (phase === 'ping' || phase === 'init') return 'var(--yellow, #f59e0b)';
    if (phase === 'done')     return 'var(--green, #22c55e)';
    if (phase === 'error')    return 'var(--red, #ef4444)';
    return 'var(--muted)';
  };

  const gaugeProgress =
    phase === 'download' ? dlProgress
    : phase === 'upload' ? ulProgress
    : phase === 'done'   ? 1
    : (phase === 'ping' || phase === 'init') ? 0.06
    : 0;

  const pingColor = pingMs
    ? (parseFloat(pingMs) < 20 ? 'var(--green)' : parseFloat(pingMs) < 60 ? 'var(--yellow,#f59e0b)' : 'var(--red)')
    : 'var(--muted)';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <p style={{ fontSize: 12, color: 'var(--dim)', margin: '4px 0 12px', alignSelf: 'flex-start' }}>
        {t('speedtest.subtitle_libre_cli')}
      </p>

      <SpeedGauge running={running} phase={phase} progress={gaugeProgress}
        displaySpeed={displaySpeed} color={phaseColor()} label={phaseLabel()}
        downloadMbps={downloadMbps} uploadMbps={uploadMbps} />

      {/* Server picker */}
      <div style={{ width: '100%', maxWidth: 400, marginBottom: 12 }}>
        {!customMode ? (
          <>
            {servers.length === 0 && !fetching && (
              <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8, lineHeight: 1.6 }}>
                {t('speedtest.ls_no_servers')}
              </div>
            )}
            {servers.length > 0 && (
              <div className="field" style={{ margin: '0 0 6px' }}>
                <label className="label">{t('speedtest.ls_select_server')}</label>
                <select className="input" value={selIdx}
                  onChange={e => setSelIdx(Number(e.target.value))} disabled={running}>
                  {servers.map((s, i) => <option key={s.id} value={i}>{s.name}</option>)}
                </select>
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }}
                onClick={fetchList} disabled={running || fetching}>
                {fetching ? t('common.loading') : t('speedtest.ls_fetch')}
              </button>
              <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 11 }}
                onClick={() => setCustomMode(true)} disabled={running}>
                {t('speedtest.ls_custom_toggle')}
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="field" style={{ margin: '0 0 6px' }}>
              <label className="label">{t('speedtest.ls_custom_url_label')}</label>
              <input className="input" value={customJsonUrl}
                placeholder={t('speedtest.ls_custom_url_placeholder')}
                onChange={e => setCustomJsonUrl(e.target.value)}
                disabled={running} />
              <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>
                {t('speedtest.ls_custom_url_hint')}
              </div>
            </div>
            <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap', fontSize: 11 }}
              onClick={() => setCustomMode(false)} disabled={running}>
              {t('speedtest.ls_public_toggle')}
            </button>
          </>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className="btn btn-primary" onClick={runTest} disabled={running}>{t('speedtest.run')}</button>
        {running && <button className="btn btn-ghost" onClick={stopTest}>{t('speedtest.stop')}</button>}
      </div>

      <Err msg={err} />

      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', width: '100%', maxWidth: 300 }}>
        <div style={{ flex: 1, background: 'var(--panel)', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{t('speedtest.ping')}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: pingColor, lineHeight: 1.1 }}>
            {pingMs || '—'}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)', marginLeft: 2 }}>{pingMs ? 'ms' : ''}</span>
          </div>
        </div>
        <div style={{ flex: 1, background: 'var(--panel)', borderRadius: 6, padding: '8px 10px', border: '1px solid var(--border)', textAlign: 'center' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 2 }}>{t('speedtest.jitter')}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--muted)', lineHeight: 1.1 }}>
            {jitterMs || '—'}<span style={{ fontSize: 10, fontWeight: 400, color: 'var(--muted)', marginLeft: 2 }}>{jitterMs ? 'ms' : ''}</span>
          </div>
        </div>
      </div>

      {phase === 'done' && (server || isp) && (
        <div style={{ marginTop: 12, fontSize: 12, color: 'var(--dim)', lineHeight: 1.7, textAlign: 'center' }}>
          {server && <div>{t('speedtest.server')}: {server}</div>}
          {isp    && <div>{t('speedtest.isp')}: {isp}</div>}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 16, textAlign: 'center' }}>
        {t('speedtest.powered_by')}{' '}<a href="https://github.com/librespeed/speedtest-cli" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)' }}>librespeed-cli</a>
      </div>
    </div>
  );
}

// ── LibreSpeed tab — CLI when available, browser JS as standalone fallback ──
function LibreSpeedTab({ t, libreMode }) {
  if (libreMode === null) {
    return <div style={{ fontSize: 12, color: 'var(--dim)', padding: '12px 0' }}>{t('common.loading')}</div>;
  }
  if (libreMode === 'missing') {
    return (
      <div style={{ fontSize: 13, color: 'var(--dim)', margin: '8px 0 0', lineHeight: 1.7 }}>
        <p style={{ margin: '0 0 6px' }}>{t('speedtest.ls_cli_missing_desc')}</p>
        <code style={{ background: 'var(--panel)', padding: '6px 10px', borderRadius: 4, fontSize: 12, display: 'block', marginBottom: 8, overflowX: 'auto', whiteSpace: 'pre' }}>
          {'curl -fsSL https://github.com/librespeed/speedtest-cli/releases/latest/download/librespeed-cli_linux_amd64.tar.gz \\\n  | tar xz -C /usr/local/bin librespeed-cli'}
        </code>
        <a href="https://github.com/librespeed/speedtest-cli/releases" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', fontSize: 12 }}>
          {t('speedtest.ls_cli_install_link')} ↗
        </a>
      </div>
    );
  }
  if (libreMode === false) {
    return <p style={{ fontSize: 13, color: 'var(--dim)', margin: '4px 0 0' }}>{t('scanner.server_required_desc')}</p>;
  }
  return <LibreSpeedCLI t={t} />;
}

// ── Root component ─────────────────────────────────────────────────────────
function SpeedTest({ onShare, initialData }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState(initialData?.tab ?? 'ookla');
  const [serverMode, setServerMode] = useState(null);
  const [libreMode, setLibreMode]   = useState(null);

  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'speedtest', tab: activeTab });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [activeTab, onShare]);

  useEffect(() => {
    if (window.location.protocol === 'file:') {
      setServerMode(false);
      setLibreMode(false);
      return;
    }

    fetch('/api/capabilities', { signal: AbortSignal.timeout(1500) })
      .then(r => r.json())
      .then(data => {
        setServerMode(data.speedtest ? true : 'missing');
        setLibreMode(data.librespeed ? true : 'missing');
      })
      .catch(() => { setServerMode(false); setLibreMode(false); });
  }, []);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {t('speedtest.title')}
          {serverMode === null && (
            <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal' }}>{t('common.loading')}</span>
          )}
          {(serverMode === false || libreMode === false) && (
            <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
              {t('scanner.server_required')}
            </span>
          )}
          {serverMode === 'missing' && activeTab === 'ookla' && (
            <span style={{ fontSize: 11, color: 'var(--yellow,#f59e0b)', fontWeight: 'normal' }}>
              {t('speedtest.cli_missing')}
            </span>
          )}
          {libreMode === 'missing' && activeTab === 'libre' && (
            <span style={{ fontSize: 11, color: 'var(--yellow,#f59e0b)', fontWeight: 'normal' }}>
              {t('speedtest.ls_cli_missing')}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16, marginTop: 4 }}>
          <button className={`btn ${activeTab === 'ookla' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('ookla')}>{t('speedtest.tab_ookla')}</button>
          <button className={`btn ${activeTab === 'libre' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('libre')}>{t('speedtest.tab_libre')}</button>
        </div>

        {activeTab === 'ookla' && <OoklaTab t={t} serverMode={serverMode} />}
        {activeTab === 'libre' && <LibreSpeedTab t={t} libreMode={libreMode} />}
      </div>

      {/* Powered by footers moved inside components to handle conditional visibility */}
    </div>
  );
}

window.SpeedTest = SpeedTest;
