const { useState, useEffect, useCallback, useMemo } = React;

// ─── Load Balancer Config Builder — HAProxy / Nginx / F5 BIG-IP ──────────

const LB_DEFAULT_SERVER = () => ({
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  name: '', address: '', weight: 1, backup: false, maxconn: ''
});

const LB_HAPROXY_ALGO = { roundrobin:'roundrobin', leastconn:'leastconn', source:'source', uri:'uri', random:'random' };
const LB_NGINX_ALGO = { roundrobin:null, leastconn:'least_conn', source:'ip_hash', uri:'hash_uri', random:'random' };
const LB_F5_ALGO = { roundrobin:'round-robin', leastconn:'least-connections-member', source:'least-connections-node', uri:'predictive', random:'dynamic-ratio' };

function LBConfigBuilder({ initialData, onShare }) {
  const { t } = useTranslation();

  // ── State ─────────────────────────────────────────────────
  const [frontendName, setFrontendName] = usePersistentState('lb:frontendName', initialData?.frontendName ?? 'web_frontend');
  const [listenAddr, setListenAddr] = usePersistentState('lb:listenAddr', initialData?.listenAddr ?? '*:80');
  const [protocol, setProtocol] = usePersistentState('lb:protocol', initialData?.protocol ?? 'http');
  const [sslEnabled, setSslEnabled] = usePersistentState('lb:sslEnabled', initialData?.sslEnabled ?? false);
  const [sslCertPath, setSslCertPath] = usePersistentState('lb:sslCertPath', initialData?.sslCertPath ?? '/etc/ssl/certs/server.pem');
  const [sslKeyPath, setSslKeyPath] = usePersistentState('lb:sslKeyPath', initialData?.sslKeyPath ?? '/etc/ssl/private/server.key');
  const [servers, setServers] = usePersistentState('lb:servers', initialData?.servers ?? [LB_DEFAULT_SERVER()]);

  const [algorithm, setAlgorithm] = usePersistentState('lb:algorithm', initialData?.algorithm ?? 'roundrobin');

  const [hcEnabled, setHcEnabled] = usePersistentState('lb:hcEnabled', initialData?.hcEnabled ?? true);
  const [hcMethod, setHcMethod] = usePersistentState('lb:hcMethod', initialData?.hcMethod ?? 'http');
  const [hcInterval, setHcInterval] = usePersistentState('lb:hcInterval', initialData?.hcInterval ?? 5);
  const [hcTimeout, setHcTimeout] = usePersistentState('lb:hcTimeout', initialData?.hcTimeout ?? 3);
  const [hcFall, setHcFall] = usePersistentState('lb:hcFall', initialData?.hcFall ?? 3);
  const [hcRise, setHcRise] = usePersistentState('lb:hcRise', initialData?.hcRise ?? 2);
  const [hcPath, setHcPath] = usePersistentState('lb:hcPath', initialData?.hcPath ?? '/health');
  const [hcStatus, setHcStatus] = usePersistentState('lb:hcStatus', initialData?.hcStatus ?? '200');

  const [persistEnabled, setPersistEnabled] = usePersistentState('lb:persistEnabled', initialData?.persistEnabled ?? false);
  const [persistMethod, setPersistMethod] = usePersistentState('lb:persistMethod', initialData?.persistMethod ?? 'cookie');

  const [rateLimitEnabled, setRateLimitEnabled] = usePersistentState('lb:rateLimitEnabled', initialData?.rateLimitEnabled ?? false);
  const [rateRps, setRateRps] = usePersistentState('lb:rateRps', initialData?.rateRps ?? 100);
  const [rateWindow, setRateWindow] = usePersistentState('lb:rateWindow', initialData?.rateWindow ?? 1);

  const [activeTab, setActiveTab] = usePersistentState('lb:activeTab', 'haproxy');
  const [error, setError] = useState(null);

  // ── initialData sync ──────────────────────────────────────
  useEffect(() => {
    if (initialData) {
      if (initialData.frontendName !== undefined) setFrontendName(initialData.frontendName);
      if (initialData.listenAddr !== undefined) setListenAddr(initialData.listenAddr);
      if (initialData.protocol !== undefined) setProtocol(initialData.protocol);
      if (initialData.sslEnabled !== undefined) setSslEnabled(initialData.sslEnabled);
      if (initialData.sslCertPath !== undefined) setSslCertPath(initialData.sslCertPath);
      if (initialData.sslKeyPath !== undefined) setSslKeyPath(initialData.sslKeyPath);
      if (initialData.servers !== undefined) setServers(initialData.servers);
      if (initialData.algorithm !== undefined) setAlgorithm(initialData.algorithm);
      if (initialData.hcEnabled !== undefined) setHcEnabled(initialData.hcEnabled);
      if (initialData.hcMethod !== undefined) setHcMethod(initialData.hcMethod);
      if (initialData.hcInterval !== undefined) setHcInterval(initialData.hcInterval);
      if (initialData.hcTimeout !== undefined) setHcTimeout(initialData.hcTimeout);
      if (initialData.hcFall !== undefined) setHcFall(initialData.hcFall);
      if (initialData.hcRise !== undefined) setHcRise(initialData.hcRise);
      if (initialData.hcPath !== undefined) setHcPath(initialData.hcPath);
      if (initialData.hcStatus !== undefined) setHcStatus(initialData.hcStatus);
      if (initialData.persistEnabled !== undefined) setPersistEnabled(initialData.persistEnabled);
      if (initialData.persistMethod !== undefined) setPersistMethod(initialData.persistMethod);
      if (initialData.rateLimitEnabled !== undefined) setRateLimitEnabled(initialData.rateLimitEnabled);
      if (initialData.rateRps !== undefined) setRateRps(initialData.rateRps);
      if (initialData.rateWindow !== undefined) setRateWindow(initialData.rateWindow);
    }
  }, [initialData]);

  // ── Share handler ─────────────────────────────────────────
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'lb-config', frontendName, listenAddr, protocol, sslEnabled, sslCertPath, sslKeyPath,
        servers, algorithm, hcEnabled, hcMethod, hcInterval, hcTimeout, hcFall, hcRise, hcPath, hcStatus,
        persistEnabled, persistMethod, rateLimitEnabled, rateRps, rateWindow
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [frontendName, listenAddr, protocol, sslEnabled, sslCertPath, sslKeyPath,
      servers, algorithm, hcEnabled, hcMethod, hcInterval, hcTimeout, hcFall, hcRise, hcPath, hcStatus,
      persistEnabled, persistMethod, rateLimitEnabled, rateRps, rateWindow, onShare]);

  // ── Server list helpers ───────────────────────────────────
  const lbAddServer = useCallback(() => {
    setServers(prev => [...prev, LB_DEFAULT_SERVER()]);
  }, []);

  const lbRemoveServer = useCallback((id) => {
    setServers(prev => prev.filter(s => s.id !== id));
  }, []);

  const lbUpdateServer = useCallback((id, field, value) => {
    setServers(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
  }, []);

  // ── Validation ────────────────────────────────────────────
  const lbValidation = useMemo(() => {
    const filled = servers.filter(s => s.name.trim() && s.address.trim());
    if (filled.length === 0 && servers.length > 0) return t('lb_config.err_no_servers');
    if (!listenAddr.trim()) return t('lb_config.err_no_address');
    if (sslEnabled && !sslCertPath.trim()) return t('lb_config.err_no_address');
    return null;
  }, [servers, listenAddr, sslEnabled, sslCertPath, t]);

  // ── Extract port from listen address ──────────────────────
  const lbListenPort = useMemo(() => {
    const match = listenAddr.match(/:(\d+)$/);
    return match ? match[1] : '80';
  }, [listenAddr]);

  // ── HAProxy config ────────────────────────────────────────
  const lbHaproxyConfig = useMemo(() => {
    const validServers = servers.filter(s => s.name.trim() && s.address.trim());
    if (validServers.length === 0) return '';
    const name = frontendName.trim() || 'frontend';
    let cfg = '';

    // Frontend
    cfg += `frontend ${name}\n`;
    const bindExtra = sslEnabled && sslCertPath.trim() ? ` ssl crt ${sslCertPath.trim()}` : '';
    cfg += `    bind ${listenAddr.trim()}${bindExtra}\n`;
    if (rateLimitEnabled) {
      cfg += `    stick-table type ip size 100k expire ${rateWindow || 1}s store http_req_rate(${rateWindow || 1}s)\n`;
      cfg += `    http-request track-sc0 src\n`;
      cfg += `    http-request deny deny_status 429 if { sc_http_req_rate(0) gt ${rateRps} }\n`;
    }
    cfg += `    default_backend ${name}_backend\n`;

    // Backend
    cfg += `\nbackend ${name}_backend\n`;
    cfg += `    balance ${LB_HAPROXY_ALGO[algorithm] || 'roundrobin'}\n`;

    // Persistence
    if (persistEnabled) {
      if (persistMethod === 'cookie') {
        cfg += `    cookie SERVERID insert indirect nocache\n`;
      } else if (persistMethod === 'source') {
        cfg += `    stick-table type ip size 100k expire 30m\n`;
        cfg += `    stick on src\n`;
      } else if (persistMethod === 'header') {
        cfg += `    stick-table type string len 64 size 100k expire 30m\n`;
        cfg += `    stick on req.hdr(X-Session-ID)\n`;
      }
    }

    // Health check options
    if (hcEnabled) {
      if (hcMethod === 'http' || hcMethod === 'https') {
        cfg += `    option httpchk GET ${hcPath.trim() || '/health'}\n`;
        if (hcStatus.trim()) {
          cfg += `    http-check expect status ${hcStatus.trim()}\n`;
        }
      }
    }

    // Servers
    validServers.forEach(s => {
      let line = `    server ${s.name.trim()} ${s.address.trim()}`;
      line += ` weight ${s.weight || 1}`;
      if (hcEnabled) {
        line += ` check inter ${hcInterval || 5}s fall ${hcFall || 3} rise ${hcRise || 2}`;
        if (hcTimeout) line += ` timeout check ${hcTimeout}s`;
      }
      if (persistEnabled && persistMethod === 'cookie') {
        line += ` cookie ${s.name.trim()}`;
      }
      if (s.backup) line += ' backup';
      if (s.maxconn) line += ` maxconn ${s.maxconn}`;
      cfg += line + '\n';
    });

    return cfg;
  }, [frontendName, listenAddr, sslEnabled, sslCertPath, servers, algorithm,
      hcEnabled, hcMethod, hcInterval, hcTimeout, hcFall, hcRise, hcPath, hcStatus,
      persistEnabled, persistMethod, rateLimitEnabled, rateRps, rateWindow]);

  // ── Nginx config ──────────────────────────────────────────
  const lbNginxConfig = useMemo(() => {
    const validServers = servers.filter(s => s.name.trim() && s.address.trim());
    if (validServers.length === 0) return '';
    const name = frontendName.trim() || 'frontend';
    let cfg = '';

    // Upstream
    cfg += `upstream ${name} {\n`;

    // Algorithm directive
    if (algorithm === 'source') {
      cfg += `    ip_hash;\n`;
    } else if (algorithm === 'uri') {
      cfg += `    hash $request_uri consistent;\n`;
    } else if (algorithm === 'random') {
      cfg += `    random two least_conn;\n`;
    } else if (algorithm === 'leastconn') {
      cfg += `    least_conn;\n`;
    }

    // Servers
    validServers.forEach(s => {
      let line = `    server ${s.address.trim()} weight=${s.weight || 1}`;
      if (hcEnabled) {
        line += ` max_fails=${hcFall || 3} fail_timeout=${hcInterval || 5}s`;
      }
      if (s.backup) line += ' backup';
      if (s.maxconn) line += ` max_conns=${s.maxconn}`;
      cfg += line + ';\n';
    });

    cfg += `}\n`;

    // Rate limiting zone
    if (rateLimitEnabled) {
      cfg += `\nlimit_req_zone $binary_remote_addr zone=${name}:10m rate=${rateRps || 100}r/s;\n`;
    }

    // Server block
    cfg += `\nserver {\n`;
    cfg += `    listen ${lbListenPort}${sslEnabled ? ' ssl' : ''};\n`;
    if (sslEnabled) {
      cfg += `    ssl_certificate ${sslCertPath.trim()};\n`;
      cfg += `    ssl_certificate_key ${sslKeyPath.trim()};\n`;
    }

    // Health check location
    if (hcEnabled && (hcMethod === 'http' || hcMethod === 'https')) {
      cfg += `\n    location ${hcPath.trim() || '/health'} {\n`;
      cfg += `        access_log off;\n`;
      cfg += `        return ${hcStatus.trim() || '200'} "OK";\n`;
      cfg += `    }\n`;
    }

    cfg += `\n    location / {\n`;
    cfg += `        proxy_pass http${sslEnabled ? 's' : ''}://${name};\n`;
    cfg += `        proxy_set_header Host $host;\n`;
    cfg += `        proxy_set_header X-Real-IP $remote_addr;\n`;
    cfg += `        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n`;
    cfg += `        proxy_set_header X-Forwarded-Proto $scheme;\n`;
    if (hcEnabled) {
      cfg += `        proxy_next_upstream error timeout http_502 http_503 http_504;\n`;
    }
    if (persistEnabled) {
      cfg += `        proxy_cookie_path / /;  # session affinity helper\n`;
    }
    if (rateLimitEnabled) {
      cfg += `        limit_req zone=${name} burst=${rateRps || 100} nodelay;\n`;
    }
    cfg += `    }\n`;

    // Persistence via sticky cookie (Nginx Plus feature, noted as comment)
    if (persistEnabled && persistMethod === 'cookie') {
      cfg += `\n    # Sticky session (requires nginx-plus or sticky module)\n`;
      cfg += `    # sticky cookie srv_id expires=1h domain=.example.com path=/;\n`;
    }

    cfg += `}\n`;
    return cfg;
  }, [frontendName, listenAddr, sslEnabled, sslCertPath, sslKeyPath, servers, algorithm,
      hcEnabled, hcMethod, hcInterval, hcFall, hcPath, hcStatus,
      persistEnabled, persistMethod, rateLimitEnabled, rateRps, lbListenPort]);

  // ── F5 BIG-IP config ─────────────────────────────────────
  const lbF5Config = useMemo(() => {
    const validServers = servers.filter(s => s.name.trim() && s.address.trim());
    if (validServers.length === 0) return '';
    const name = frontendName.trim() || 'frontend';
    let cfg = '';

    // Monitor
    cfg += `ltm monitor http ${name}_monitor {\n`;
    cfg += `    defaults-from http\n`;
    cfg += `    destination *:${lbListenPort}\n`;
    if (hcEnabled && (hcMethod === 'http' || hcMethod === 'https')) {
      cfg += `    send "GET ${hcPath.trim() || '/health'} HTTP/1.0\\r\\n\\r\\n"\n`;
      if (hcStatus.trim()) {
        cfg += `    recv "${hcStatus.trim()}"\n`;
      }
    }
    cfg += `    interval ${hcInterval || 5}\n`;
    cfg += `    timeout ${hcTimeout || 3}\n`;
    cfg += `}\n\n`;

    // Pool
    const hasBackup = validServers.some(s => s.backup);
    cfg += `ltm pool ${name}_pool {\n`;
    cfg += `    load-balancing-mode ${LB_F5_ALGO[algorithm] || 'round-robin'}\n`;
    if (hcEnabled) {
      cfg += `    monitor ${name}_monitor\n`;
    }
    if (hasBackup) {
      cfg += `    min-active-members 1\n`;
    }
    cfg += `    members {\n`;
    validServers.forEach(s => {
      cfg += `        ${s.address.trim()} {\n`;
      cfg += `            weight ${s.weight || 1}\n`;
      if (s.backup) cfg += `            priority-group 1\n`;
      if (s.maxconn) cfg += `            connection-limit ${s.maxconn}\n`;
      cfg += `        }\n`;
    });
    cfg += `    }\n`;
    cfg += `}\n\n`;

    // Virtual server
    cfg += `ltm virtual ${name}_vs {\n`;
    cfg += `    destination ${listenAddr.trim()}\n`;
    cfg += `    pool ${name}_pool\n`;
    if (sslEnabled) {
      cfg += `    profiles {\n`;
      cfg += `        http\n`;
      cfg += `        clientssl\n`;
      cfg += `    }\n`;
    } else {
      cfg += `    profiles {\n`;
      cfg += `        http\n`;
      cfg += `    }\n`;
    }
    // Persistence
    if (persistEnabled) {
      if (persistMethod === 'cookie') {
        cfg += `    persist {\n`;
        cfg += `        cookie\n`;
      } else if (persistMethod === 'source') {
        cfg += `    persist {\n`;
        cfg += `        source_addr\n`;
      } else if (persistMethod === 'header') {
        cfg += `    persist {\n`;
        cfg += `        hash\n`;
      }
      cfg += `    }\n`;
    }
    // Rate limiting note
    if (rateLimitEnabled) {
      cfg += `    # Rate limiting: ${rateRps || 100} req/s, window ${rateWindow || 1}s\n`;
      cfg += `    # Configure via AFM policy or iRule for enforcement\n`;
    }
    cfg += `}\n`;

    return cfg;
  }, [frontendName, listenAddr, sslEnabled, servers, algorithm,
      hcEnabled, hcMethod, hcInterval, hcTimeout, hcPath, hcStatus,
      persistEnabled, persistMethod, rateLimitEnabled, rateRps, rateWindow, lbListenPort]);

  // ── Config map ────────────────────────────────────────────
  const lbConfigMap = useMemo(() => ({
    haproxy: lbHaproxyConfig,
    nginx: lbNginxConfig,
    f5: lbF5Config
  }), [lbHaproxyConfig, lbNginxConfig, lbF5Config]);

  const lbFileExtMap = useMemo(() => ({
    haproxy: 'cfg',
    nginx: 'conf',
    f5: 'conf'
  }), []);

  // ── Export ────────────────────────────────────────────────
  const lbExportConfig = useCallback(() => {
    const config = lbConfigMap[activeTab];
    if (!config) return;
    const blob = new Blob([config], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${frontendName.trim() || 'lb_config'}.${lbFileExtMap[activeTab]}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [lbConfigMap, activeTab, frontendName, lbFileExtMap]);

  const lbClearAll = useCallback(() => {
    setFrontendName('web_frontend');
    setListenAddr('*:80');
    setProtocol('http');
    setSslEnabled(false);
    setSslCertPath('/etc/ssl/certs/server.pem');
    setSslKeyPath('/etc/ssl/private/server.key');
    setServers([LB_DEFAULT_SERVER()]);
    setAlgorithm('roundrobin');
    setHcEnabled(true);
    setHcMethod('http');
    setHcInterval(5);
    setHcTimeout(3);
    setHcFall(3);
    setHcRise(2);
    setHcPath('/health');
    setHcStatus('200');
    setPersistEnabled(false);
    setPersistMethod('cookie');
    setRateLimitEnabled(false);
    setRateRps(100);
    setRateWindow(1);
    setError(null);
  }, []);

  // ── Copy hook ─────────────────────────────────────────────
  const [lbCopied, lbCopy] = useCopy();

  // ── Tabs ──────────────────────────────────────────────────
  const LB_TABS = useMemo(() => [
    { id: 'haproxy', label: t('lb_config.output_haproxy') },
    { id: 'nginx', label: t('lb_config.output_nginx') },
    { id: 'f5', label: t('lb_config.output_f5') }
  ], [t]);

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="fadein">
      {/* Title */}
      <div className="card">
        <div className="card-title">{t('lb_config.title')}</div>

        {/* Frontend Settings */}
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <div className="card-title" style={{ fontSize: '1em' }}>{t('lb_config.frontend_settings')}</div>
          <div className="two-col">
            <div className="field">
              <label className="label">{t('lb_config.frontend_name')}</label>
              <input className="input" value={frontendName} onChange={e => setFrontendName(e.target.value)} placeholder="web_frontend" />
            </div>
            <div className="field">
              <label className="label">{t('lb_config.listen_address')}</label>
              <input className="input" value={listenAddr} onChange={e => setListenAddr(e.target.value)} placeholder="*:80" />
            </div>
          </div>

          <div className="two-col">
            <div className="field">
              <label className="label">{t('lb_config.protocol')}</label>
              <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', marginTop: '0.3rem' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                  <input type="radio" name="lb-protocol" value="http" checked={protocol === 'http'} onChange={() => setProtocol('http')} />
                  {t('lb_config.protocol_http')}
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                  <input type="radio" name="lb-protocol" value="tcp" checked={protocol === 'tcp'} onChange={() => setProtocol('tcp')} />
                  {t('lb_config.protocol_tcp')}
                </label>
              </div>
            </div>
            <div className="field">
              <label className="label">{t('lb_config.ssl_termination')}</label>
              <div style={{ display: 'flex', gap: '0.8rem', marginTop: '0.3rem' }}>
                <button className={`btn btn-sm ${sslEnabled ? 'badge-green' : 'badge-red'}`} onClick={() => setSslEnabled(!sslEnabled)}>
                  {sslEnabled ? t('lb_config.enable') : t('lb_config.disable')}
                </button>
              </div>
            </div>
          </div>

          {sslEnabled && (
            <div className="two-col">
              <div className="field">
                <label className="label">{t('lb_config.ssl_cert_path')}</label>
                <input className="input" value={sslCertPath} onChange={e => setSslCertPath(e.target.value)} placeholder="/etc/ssl/certs/server.pem" />
              </div>
              <div className="field">
                <label className="label">{t('lb_config.ssl_key_path')}</label>
                <input className="input" value={sslKeyPath} onChange={e => setSslKeyPath(e.target.value)} placeholder="/etc/ssl/private/server.key" />
              </div>
            </div>
          )}
        </div>

        {/* Backend Servers */}
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <div className="card-title" style={{ fontSize: '1em' }}>{t('lb_config.backend_servers')}</div>
          {servers.map((srv, idx) => (
            <div key={srv.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0.6rem', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                <span className="hint" style={{ fontWeight: 600 }}>#{idx + 1}</span>
                <button className="btn btn-ghost btn-sm" onClick={() => lbRemoveServer(srv.id)} title={t('lb_config.remove_server')}>
                  &times; {t('lb_config.remove_server')}
                </button>
              </div>
              <div className="two-col">
                <div className="field">
                  <label className="label">{t('lb_config.server_name')}</label>
                  <input className="input" value={srv.name} onChange={e => lbUpdateServer(srv.id, 'name', e.target.value)} placeholder="web01" />
                </div>
                <div className="field">
                  <label className="label">{t('lb_config.server_address')}</label>
                  <input className="input" value={srv.address} onChange={e => lbUpdateServer(srv.id, 'address', e.target.value)} placeholder="10.0.0.1:8080" />
                </div>
              </div>
              <div className="two-col">
                <div className="field">
                  <label className="label">{t('lb_config.weight')}</label>
                  <input className="input" type="number" min="1" max="256" value={srv.weight} onChange={e => lbUpdateServer(srv.id, 'weight', parseInt(e.target.value) || 1)} />
                </div>
                <div className="field">
                  <label className="label">{t('lb_config.max_connections')}</label>
                  <input className="input" type="number" min="0" value={srv.maxconn} onChange={e => lbUpdateServer(srv.id, 'maxconn', e.target.value)} placeholder="Optional" />
                </div>
              </div>
              <div className="field">
                <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer' }}>
                  <input type="checkbox" checked={srv.backup} onChange={e => lbUpdateServer(srv.id, 'backup', e.target.checked)} />
                  {t('lb_config.backup')}
                </label>
              </div>
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={lbAddServer}>+ {t('lb_config.add_server')}</button>
        </div>

        {/* Load Balancing Algorithm */}
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <div className="card-title" style={{ fontSize: '1em' }}>{t('lb_config.lb_algorithm')}</div>
          <div className="field">
            <select className="select" value={algorithm} onChange={e => setAlgorithm(e.target.value)}>
              <option value="roundrobin">{t('lb_config.algo_roundrobin')}</option>
              <option value="leastconn">{t('lb_config.algo_leastconn')}</option>
              <option value="source">{t('lb_config.algo_source')}</option>
              <option value="uri">{t('lb_config.algo_uri')}</option>
              <option value="random">{t('lb_config.algo_random')}</option>
            </select>
            {algorithm === 'uri' && (
              <div className="hint" style={{ marginTop: '0.3rem' }}>
                {t('lb_config.algo_uri')} — HAProxy only; mapped to closest equivalent on other platforms.
              </div>
            )}
          </div>
        </div>

        {/* Health Check */}
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-title" style={{ fontSize: '1em', margin: 0 }}>{t('lb_config.health_check')}</div>
            <button className={`btn btn-sm ${hcEnabled ? 'badge-green' : 'badge-red'}`} onClick={() => setHcEnabled(!hcEnabled)}>
              {hcEnabled ? t('lb_config.enable') : t('lb_config.disable')}
            </button>
          </div>
          {hcEnabled && (
            <div style={{ marginTop: '0.5rem' }}>
              <div className="two-col">
                <div className="field">
                  <label className="label">{t('lb_config.health_method')}</label>
                  <select className="select" value={hcMethod} onChange={e => setHcMethod(e.target.value)}>
                    <option value="http">{t('lb_config.health_http')}</option>
                    <option value="tcp">{t('lb_config.health_tcp')}</option>
                    <option value="https">{t('lb_config.health_https')}</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label">{t('lb_config.health_interval')}</label>
                  <input className="input" type="number" min="1" value={hcInterval} onChange={e => setHcInterval(parseInt(e.target.value) || 5)} />
                </div>
              </div>
              <div className="two-col">
                <div className="field">
                  <label className="label">{t('lb_config.health_timeout')}</label>
                  <input className="input" type="number" min="1" value={hcTimeout} onChange={e => setHcTimeout(parseInt(e.target.value) || 3)} />
                </div>
                <div className="field">
                  <label className="label">{t('lb_config.health_fall')}</label>
                  <input className="input" type="number" min="1" value={hcFall} onChange={e => setHcFall(parseInt(e.target.value) || 3)} />
                </div>
              </div>
              <div className="two-col">
                <div className="field">
                  <label className="label">{t('lb_config.health_rise')}</label>
                  <input className="input" type="number" min="1" value={hcRise} onChange={e => setHcRise(parseInt(e.target.value) || 2)} />
                </div>
                <div className="field">
                  {(hcMethod === 'http' || hcMethod === 'https') && (
                    <>
                      <label className="label">{t('lb_config.health_path')}</label>
                      <input className="input" value={hcPath} onChange={e => setHcPath(e.target.value)} placeholder="/health" />
                    </>
                  )}
                </div>
              </div>
              {(hcMethod === 'http' || hcMethod === 'https') && (
                <div className="field">
                  <label className="label">{t('lb_config.health_status')}</label>
                  <input className="input" value={hcStatus} onChange={e => setHcStatus(e.target.value)} placeholder="200" style={{ maxWidth: '200px' }} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Session Persistence */}
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-title" style={{ fontSize: '1em', margin: 0 }}>{t('lb_config.session_persistence')}</div>
            <button className={`btn btn-sm ${persistEnabled ? 'badge-green' : 'badge-red'}`} onClick={() => setPersistEnabled(!persistEnabled)}>
              {persistEnabled ? t('lb_config.enable') : t('lb_config.disable')}
            </button>
          </div>
          {persistEnabled && (
            <div className="field" style={{ marginTop: '0.5rem' }}>
              <select className="select" value={persistMethod} onChange={e => setPersistMethod(e.target.value)}>
                <option value="cookie">{t('lb_config.persistence_cookie')}</option>
                <option value="source">{t('lb_config.persistence_source')}</option>
                <option value="header">{t('lb_config.persistence_header')}</option>
              </select>
            </div>
          )}
        </div>

        {/* Rate Limiting */}
        <div className="card" style={{ marginTop: '0.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div className="card-title" style={{ fontSize: '1em', margin: 0 }}>{t('lb_config.rate_limiting')}</div>
            <button className={`btn btn-sm ${rateLimitEnabled ? 'badge-green' : 'badge-red'}`} onClick={() => setRateLimitEnabled(!rateLimitEnabled)}>
              {rateLimitEnabled ? t('lb_config.enable') : t('lb_config.disable')}
            </button>
          </div>
          {rateLimitEnabled && (
            <div className="two-col" style={{ marginTop: '0.5rem' }}>
              <div className="field">
                <label className="label">{t('lb_config.requests_per_second')}</label>
                <input className="input" type="number" min="1" value={rateRps} onChange={e => setRateRps(parseInt(e.target.value) || 100)} />
              </div>
              <div className="field">
                <label className="label">{t('lb_config.time_window')}</label>
                <input className="input" type="number" min="1" value={rateWindow} onChange={e => setRateWindow(parseInt(e.target.value) || 1)} />
              </div>
            </div>
          )}
        </div>

        {/* Validation */}
        <Err msg={lbValidation} />

        {/* Output Tabs */}
        <div style={{ marginTop: '1rem' }}>
          <div className="card-title">{t('lb_config.config_output')}</div>
          <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
            {LB_TABS.map(tab => (
              <button
                key={tab.id}
                className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {lbConfigMap[activeTab] ? (
            <div style={{ position: 'relative' }}>
              <CopyBtn text={lbConfigMap[activeTab]} id={`lb-${activeTab}`} />
              <pre style={{ whiteSpace: 'pre-wrap', fontSize: '0.85em', padding: '1rem', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'auto', maxHeight: '500px', margin: 0 }}>
                {lbConfigMap[activeTab]}
              </pre>
            </div>
          ) : (
            <div className="hint" style={{ padding: '1rem', textAlign: 'center', border: '1px dashed var(--border)', borderRadius: 'var(--radius)' }}>
              {t('lb_config.err_no_servers')}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="btn-row" style={{ marginTop: '1rem' }}>
          <button className="btn btn-ghost" onClick={lbClearAll}>{t('common.clear', 'Clear')}</button>
          {lbConfigMap[activeTab] && (
            <button className="btn btn-primary" onClick={lbExportConfig}>{t('lb_config.export_config')}</button>
          )}
        </div>
      </div>
    </div>
  );
}
window.LBConfigBuilder = LBConfigBuilder;
