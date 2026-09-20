const { useState, useEffect, useCallback, useMemo } = React;

// ── Endpoint categories ──────────────────────────────────────────────
const DNAC_CATEGORIES = [
  {
    category: 'Authentication',
    endpoints: [
      { method: 'POST', path: '/dna/system/api/v1/auth/token', desc: 'Get Auth Token' },
    ],
  },
  {
    category: 'Devices',
    endpoints: [
      { method: 'GET', path: '/dna/intent/api/v1/network-device', desc: 'List All Devices' },
      { method: 'GET', path: '/dna/intent/api/v1/network-device/{id}', desc: 'Device by ID' },
      { method: 'GET', path: '/dna/intent/api/v1/interface', desc: 'List Interfaces' },
      { method: 'GET', path: '/dna/intent/api/v1/network-device/config', desc: 'Device Configs' },
    ],
  },
  {
    category: 'Sites',
    endpoints: [
      { method: 'GET', path: '/dna/intent/api/v1/site', desc: 'List Sites' },
      { method: 'GET', path: '/dna/intent/api/v1/site/{siteId}', desc: 'Site Details' },
    ],
  },
  {
    category: 'Topology',
    endpoints: [
      { method: 'GET', path: '/dna/intent/api/v1/topology/site-topology', desc: 'Site Topology' },
      { method: 'GET', path: '/dna/intent/api/v1/topology/physical-topology', desc: 'Physical Topology' },
      { method: 'GET', path: '/dna/intent/api/v1/topology/l3-topology', desc: 'L3 Topology' },
    ],
  },
  {
    category: 'Clients',
    endpoints: [
      { method: 'GET', path: '/dna/intent/api/v1/client-health', desc: 'Client Health' },
      { method: 'GET', path: '/dna/intent/api/v1/user-enrichment-details', desc: 'User Details' },
    ],
  },
  {
    category: 'Commands',
    endpoints: [
      { method: 'POST', path: '/dna/intent/api/v1/network-device-poller/cli/read-request', desc: 'Run CLI Command' },
    ],
  },
  {
    category: 'Software',
    endpoints: [
      { method: 'GET', path: '/dna/intent/api/v1/software/image/distribution', desc: 'Image Distribution' },
      { method: 'GET', path: '/dna/intent/api/v1/network-device/{id}/software', desc: 'Device Software' },
    ],
  },
];

// Flatten endpoints for easy lookup
const DNAC_FLAT_ENDPOINTS = DNAC_CATEGORIES.flatMap(cat =>
  cat.endpoints.map(ep => ({ ...ep, category: cat.category }))
);

// ── Helpers ──────────────────────────────────────────────────────────
function dnacBuildBaseUrl(host, port) {
  const target = host || '<DNAC_IP>';
  const p = port || 443;
  const portSuffix = (p && p !== 443) ? ':' + p : '';
  return 'https://' + target + portSuffix;
}

function dnacBuildAuthCurl(host, port, username, password) {
  const base = dnacBuildBaseUrl(host, port);
  const user = username || 'admin';
  const pass = password || '<password>';
  return "curl -k -X POST " + base + "/dna/system/api/v1/auth/token -H 'Content-Type: application/json' -u '" + user + ':' + pass + "'";
}

function dnacBuildApiCurl(host, port, token, method, path, body) {
  const base = dnacBuildBaseUrl(host, port);
  const tok = token || '<TOKEN>';
  let cmd = "curl -k -X " + method + " " + base + path + " -H 'Content-Type: application/json' -H 'X-Auth-Token: " + tok + "'";
  if (body && body.trim()) {
    const bodyStr = body.replace(/'/g, "'\\''");
    cmd += " -d '" + bodyStr + "'";
  }
  return cmd;
}

function dnacBuildAuthPython(host, port, username, password) {
  const base = dnacBuildBaseUrl(host, port);
  const user = username || 'admin';
  const pass = password || '<password>';
  return [
    'import requests',
    'from requests.auth import HTTPBasicAuth',
    '',
    'base_url = "' + base + '"',
    '',
    '# Step 1: Get Auth Token',
    'auth_url = base_url + "/dna/system/api/v1/auth/token"',
    'auth_resp = requests.post(auth_url, auth=HTTPBasicAuth("' + user + '", "' + pass + '"), headers={"Content-Type": "application/json"}, verify=False)',
    'token = auth_resp.json()["Token"]',
    'headers = {"X-Auth-Token": token, "Content-Type": "application/json"}',
    '',
  ].join('\n');
}

function dnacBuildApiPython(host, port, method, path, body) {
  const base = dnacBuildBaseUrl(host, port);
  const lines = [
    '# Step 2: Make API Call',
    'url = base_url + "' + path + '"',
  ];
  if (body && body.trim()) {
    lines.push('payload = ' + body);
    lines.push('resp = requests.' + method.toLowerCase() + '(url, headers=headers, json=payload)');
  } else {
    lines.push('resp = requests.' + method.toLowerCase() + '(url, headers=headers)');
  }
  lines.push('print(resp.json())');
  return lines.join('\n');
}

// ── Component ────────────────────────────────────────────────────────
function CiscoDNACBuilder({ initialData, onShare }) {
  const { t } = useTranslation();

  // Connection settings
  const [dnacHost, setDnacHost] = usePersistentState('dnac:host', initialData?.host ?? '');
  const [dnacUsername, setDnacUsername] = usePersistentState('dnac:username', initialData?.username ?? 'admin');
  const [dnacPassword, setDnacPassword] = usePersistentState('dnac:password', initialData?.password ?? '');
  const [dnacPort, setDnacPort] = usePersistentState('dnac:port', initialData?.port ?? 443);

  // Token
  const [dnacToken, setDnacToken] = usePersistentState('dnac:token', initialData?.token ?? '');

  // Selected endpoint
  const [dnacSelectedIdx, setDnacSelectedIdx] = usePersistentState('dnac:selectedIdx', initialData?.selectedIdx ?? 1);
  const [dnacBody, setDnacBody] = usePersistentState('dnac:body', initialData?.body ?? '');

  // Validation
  const [dnacError, setDnacError] = useState('');

  // ── Share URL ──
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'cisco-dnac-builder',
        host: dnacHost, username: dnacUsername, password: dnacPassword,
        port: dnacPort, token: dnacToken, selectedIdx: dnacSelectedIdx, body: dnacBody,
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [dnacHost, dnacUsername, dnacPassword, dnacPort, dnacToken, dnacSelectedIdx, dnacBody, onShare]);

  // ── Selected endpoint object ──
  const dnacSelectedEndpoint = useMemo(() => {
    return DNAC_FLAT_ENDPOINTS[dnacSelectedIdx] || DNAC_FLAT_ENDPOINTS[1];
  }, [dnacSelectedIdx]);

  const dnacIsAuthEndpoint = dnacSelectedEndpoint.path === '/dna/system/api/v1/auth/token';

  // ── Generated outputs ──
  const dnacAuthCurl = useMemo(() => {
    return dnacBuildAuthCurl(dnacHost, dnacPort, dnacUsername, dnacPassword);
  }, [dnacHost, dnacPort, dnacUsername, dnacPassword]);

  const dnacApiCurl = useMemo(() => {
    if (dnacIsAuthEndpoint) return '';
    return dnacBuildApiCurl(dnacHost, dnacPort, dnacToken, dnacSelectedEndpoint.method, dnacSelectedEndpoint.path, dnacBody);
  }, [dnacHost, dnacPort, dnacToken, dnacSelectedEndpoint, dnacBody, dnacIsAuthEndpoint]);

  const dnacPythonAuth = useMemo(() => {
    return dnacBuildAuthPython(dnacHost, dnacPort, dnacUsername, dnacPassword);
  }, [dnacHost, dnacPort, dnacUsername, dnacPassword]);

  const dnacPythonApi = useMemo(() => {
    if (dnacIsAuthEndpoint) return '';
    return dnacBuildApiPython(dnacHost, dnacPort, dnacSelectedEndpoint.method, dnacSelectedEndpoint.path, dnacBody);
  }, [dnacHost, dnacPort, dnacSelectedEndpoint, dnacBody, dnacIsAuthEndpoint]);

  const dnacFullPython = useMemo(() => {
    if (dnacIsAuthEndpoint) return dnacPythonAuth;
    return dnacPythonAuth + '\n' + dnacPythonApi;
  }, [dnacIsAuthEndpoint, dnacPythonAuth, dnacPythonApi]);

  // ── Method badge color ──
  const dnacMethodBadge = useCallback((method) => {
    switch (method) {
      case 'GET': return 'badge-green';
      case 'POST': return 'badge-blue';
      case 'PUT': return 'badge-yellow';
      case 'DELETE': return 'badge-red';
      default: return 'badge-cyan';
    }
  }, []);

  // ── Clear ──
  const dnacHandleClear = useCallback(() => {
    setDnacHost('');
    setDnacUsername('admin');
    setDnacPassword('');
    setDnacPort(443);
    setDnacToken('');
    setDnacSelectedIdx(1);
    setDnacBody('');
    setDnacError('');
  }, []);

  // ── Validate ──
  const dnacIsValid = !!(dnacHost.trim());

  // ── Styles ──
  const dnacPreStyle = {
    fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    padding: '12px 14px', color: 'var(--cyan)', lineHeight: 1.6,
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowX: 'auto', margin: 0,
  };

  return (
    <div className="fadein">
      {/* ── Connection Settings ── */}
      <div className="card">
        <div className="card-title">{t('cisco_dnac_builder.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          {t('cisco_dnac_builder.subtitle')}
        </div>

        <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>{t('cisco_dnac_builder.connection_settings')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }} className="grid-mobile-1">
          <div className="field">
            <label className="label">{t('cisco_dnac_builder.dnac_ip')}</label>
            <input className="input" style={{ fontFamily: 'var(--mono)', fontSize: 13 }} placeholder="10.10.10.1"
              value={dnacHost} onChange={e => setDnacHost(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('cisco_dnac_builder.username')}</label>
            <input className="input" style={{ fontFamily: 'var(--mono)', fontSize: 13 }} placeholder="admin"
              value={dnacUsername} onChange={e => setDnacUsername(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('cisco_dnac_builder.password')}</label>
            <input className="input" type="password" placeholder="••••••••"
              value={dnacPassword} onChange={e => setDnacPassword(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('cisco_dnac_builder.port')}</label>
            <input className="input" style={{ fontFamily: 'var(--mono)', fontSize: 13 }} type="number" min={1} max={65535}
              value={dnacPort} onChange={e => setDnacPort(parseInt(e.target.value) || 443)} />
          </div>
        </div>

        {/* Token field */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label">{t('cisco_dnac_builder.auth_token')}</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input className="input" style={{ fontFamily: 'var(--mono)', fontSize: 13, flex: 1 }} placeholder="Paste token here..."
              value={dnacToken} onChange={e => setDnacToken(e.target.value)} />
            <CopyBtn text={dnacAuthCurl} id="dnac-auth-curl-btn" label={t('cisco_dnac_builder.get_token')} />
          </div>
          <span className="hint">{t('cisco_dnac_builder.token_hint')}</span>
        </div>

        <Err msg={dnacError} />
      </div>

      {/* ── Endpoint Browser ── */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title" style={{ fontSize: 13, marginBottom: 10 }}>{t('cisco_dnac_builder.endpoint_browser')}</div>

        {DNAC_CATEGORIES.map((cat, catIdx) => (
          <div key={catIdx} style={{ marginBottom: catIdx < DNAC_CATEGORIES.length - 1 ? 14 : 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
              {t('cisco_dnac_builder.cat_' + cat.category.toLowerCase().replace(/\s+/g, '_'))}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {cat.endpoints.map((ep, epIdx) => {
                const flatIdx = DNAC_FLAT_ENDPOINTS.findIndex(f => f.path === ep.path && f.method === ep.method && f.category === cat.category);
                const isSelected = flatIdx === dnacSelectedIdx;
                return (
                  <button key={epIdx}
                    className={'btn btn-sm ' + (isSelected ? 'btn-primary' : 'btn-ghost')}
                    style={{ fontSize: 11, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}
                    onClick={() => setDnacSelectedIdx(flatIdx)}
                  >
                    <span className={'badge ' + dnacMethodBadge(ep.method)} style={{ fontSize: 9, padding: '1px 5px' }}>{ep.method}</span>
                    {ep.desc}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* ── Generated Output ── */}
      {dnacIsValid && (
        <div className="card fadein" style={{ marginTop: 16 }}>
          <div className="card-title">{t('common.results', 'Results')}</div>

          {/* Selected endpoint details */}
          <div className="result-grid" style={{ marginBottom: 14 }}>
            <div className="result-item">
              <div>
                <div className="result-label">{t('cisco_dnac_builder.request_method')}</div>
                <div className="result-value"><span className={'badge ' + dnacMethodBadge(dnacSelectedEndpoint.method)}>{dnacSelectedEndpoint.method}</span></div>
              </div>
            </div>
            <div className="result-item">
              <div>
                <div className="result-label">{t('cisco_dnac_builder.request_path')}</div>
                <div className="result-value" style={{ fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all' }}>{dnacSelectedEndpoint.path}</div>
              </div>
              <CopyBtn text={dnacSelectedEndpoint.path} id="dnac-path" />
            </div>
            <div className="result-item">
              <div>
                <div className="result-label">{t('cisco_dnac_builder.description')}</div>
                <div className="result-value">{dnacSelectedEndpoint.desc}</div>
              </div>
            </div>
          </div>

          {/* Auth flow note */}
          <div style={{ padding: 10, background: 'var(--panel)', borderLeft: '4px solid #e0c452', borderRadius: 4, fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
            <strong style={{ color: '#e0c452' }}>{t('cisco_dnac_builder.auth_note_title')}: </strong>
            {t('cisco_dnac_builder.auth_note_body')}
          </div>

          {/* Token retrieval curl */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('cisco_dnac_builder.auth_curl')}</span>
              <CopyBtn text={dnacAuthCurl} id="dnac-auth-curl" />
            </div>
            <pre style={dnacPreStyle}>{dnacAuthCurl}</pre>
          </div>

          {/* API call curl (only for non-auth endpoints) */}
          {!dnacIsAuthEndpoint && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('cisco_dnac_builder.api_curl')}</span>
                <CopyBtn text={dnacApiCurl} id="dnac-api-curl" />
              </div>
              <pre style={dnacPreStyle}>{dnacApiCurl}</pre>
            </div>
          )}

          {/* Request body (for POST endpoints) */}
          {(dnacSelectedEndpoint.method === 'POST' || dnacSelectedEndpoint.method === 'PUT') && !dnacIsAuthEndpoint && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('cisco_dnac_builder.request_body')}</span>
              </div>
              <textarea className="input" style={{ fontFamily: 'var(--mono)', fontSize: 12, minHeight: 80, resize: 'vertical' }}
                placeholder='{"commands": ["show version"], "deviceUuids": ["<device-id>"]}'
                value={dnacBody} onChange={e => setDnacBody(e.target.value)} rows={4} />
              <span className="hint">{t('cisco_dnac_builder.body_hint')}</span>
            </div>
          )}

          {/* Python script */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('cisco_dnac_builder.python_script')}</span>
              <CopyBtn text={dnacFullPython} id="dnac-python" />
            </div>
            <pre style={dnacPreStyle}>{dnacFullPython}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
window.CiscoDNACBuilder = CiscoDNACBuilder;
