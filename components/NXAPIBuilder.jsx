const { useState, useEffect, useCallback, useMemo } = React;

// ── Presets ──────────────────────────────────────────────────────────
const NXAPI_PRESETS = [
  { key: 'show_version',    labelKey: 'nxapi_builder.preset_show_version',    mode: 'jsonrpc', commandType: 'cli_show',      command: 'show version' },
  { key: 'show_interface',  labelKey: 'nxapi_builder.preset_show_interface',  mode: 'jsonrpc', commandType: 'cli_show',      command: 'show interface' },
  { key: 'show_run',        labelKey: 'nxapi_builder.preset_show_run',        mode: 'jsonrpc', commandType: 'cli_show_ascii', command: 'show running-config' },
  { key: 'show_route',      labelKey: 'nxapi_builder.preset_show_route',      mode: 'jsonrpc', commandType: 'cli_show',      command: 'show ip route' },
  { key: 'system_info',     labelKey: 'nxapi_builder.preset_system_info',     mode: 'rest',    method: 'GET',                dmePath: 'sys' },
  { key: 'interfaces',      labelKey: 'nxapi_builder.preset_interfaces',      mode: 'rest',    method: 'GET',                dmePath: 'sys/intf' },
  { key: 'vlans',           labelKey: 'nxapi_builder.preset_vlans',           mode: 'rest',    method: 'GET',                dmePath: 'class:l2Inst' },
  { key: 'bgp',             labelKey: 'nxapi_builder.preset_bgp',             mode: 'rest',    method: 'GET',                dmePath: 'class:bgpDom' },
  { key: 'ospf',            labelKey: 'nxapi_builder.preset_ospf',            mode: 'rest',    method: 'GET',                dmePath: 'class:ospfDom' },
];

const COMMAND_TYPES = [
  { value: 'cli_show',      labelKey: 'nxapi_builder.cli_show' },
  { value: 'cli_show_ascii', labelKey: 'nxapi_builder.cli_show_ascii' },
  { value: 'cli_conf',      labelKey: 'nxapi_builder.cli_conf' },
  { value: 'bash',          labelKey: 'nxapi_builder.bash' },
];

const REST_METHODS = [
  { value: 'GET',    labelKey: 'nxapi_builder.rest_get' },
  { value: 'POST',   labelKey: 'nxapi_builder.rest_post' },
  { value: 'DELETE', labelKey: 'nxapi_builder.rest_delete' },
];

// ── Payload builders ─────────────────────────────────────────────────
function buildJsonRpcPayload(command, commandType) {
  return {
    ins_api: {
      version: '1.0',
      type: commandType,
      chunk: '0',
      sid: 'session_id',
      input: command,
      output_format: 'json',
    },
  };
}

function buildCurlJsonRpc(host, port, protocol, username, password, payload) {
  const proto = protocol || 'https';
  const target = host || '<SWITCH>';
  const portSuffix = ((proto === 'https' && port && port !== 443) || (proto === 'http' && port && port !== 80)) ? ':' + port : '';
  const payloadStr = JSON.stringify(payload).replace(/'/g, "'\\''");
  const user = username || 'admin';
  const pass = password || '<password>';
  return 'curl -k -X POST ' + proto + '://' + target + portSuffix + '/ins -d ' + "'" + payloadStr + "'" + ' -H ' + "'Content-Type: application/json'" + ' -u ' + "'" + user + ':' + pass + "'";
}

function buildRestUrl(host, port, protocol, dmePath) {
  const proto = protocol || 'https';
  const target = host || '<SWITCH>';
  const portSuffix = ((proto === 'https' && port && port !== 443) || (proto === 'http' && port && port !== 80)) ? ':' + port : '';
  const raw = (dmePath || 'sys').replace(/^\//, '');
  const isClass = raw.startsWith('class:');
  const segment = isClass ? raw.slice(6) : raw;
  const apiPath = isClass ? '/api/class/' : '/api/mo/';
  return proto + '://' + target + portSuffix + apiPath + segment + '.json';
}

function buildCurlRest(host, port, protocol, username, password, dmePath, method, body) {
  const url = buildRestUrl(host, port, protocol, dmePath);
  const user = username || 'admin';
  const pass = password || '<password>';
  let cmd = 'curl -k -X ' + method + ' ' + url + " -H 'Content-Type: application/json' -u '" + user + ':' + pass + "'";
  if (method === 'POST' && body && body.trim()) {
    const escapedBody = body.replace(/'/g, "'\\''");
    cmd += " -d '" + escapedBody + "'";
  }
  return cmd;
}

function buildAuthCurl(host, port, protocol, username, password) {
  const proto = protocol || 'https';
  const target = host || '<SWITCH>';
  const portSuffix = ((proto === 'https' && port && port !== 443) || (proto === 'http' && port && port !== 80)) ? ':' + port : '';
  const user = username || 'admin';
  const pass = password || '<password>';
  // NX-OS NX-API uses HTTP Basic Auth — no separate login step needed.
  // Verify connectivity and credentials with a lightweight system MO query.
  return 'curl -k -X GET ' + proto + '://' + target + portSuffix + '/api/mo/sys.json' + " -H 'Content-Type: application/json' -u '" + user + ':' + pass + "'";
}

// ── Component ────────────────────────────────────────────────────────
function NXAPIBuilder({ initialData, onShare }) {
  const { t } = useTranslation();

  // Connection settings
  const [nxapiSwitchIp, setNxapiSwitchIp] = usePersistentState('nxapi:switchIp', initialData?.switchIp ?? '');
  const [nxapiUsername, setNxapiUsername] = usePersistentState('nxapi:username', initialData?.username ?? 'admin');
  const [nxapiPassword, setNxapiPassword] = usePersistentState('nxapi:password', initialData?.password ?? '');
  const [nxapiPort, setNxapiPort] = usePersistentState('nxapi:port', initialData?.port ?? 443);
  const [nxapiProtocol, setNxapiProtocol] = usePersistentState('nxapi:protocol', initialData?.protocol ?? 'https');

  // API mode
  const [nxapiMode, setNxapiMode] = usePersistentState('nxapi:mode', initialData?.mode ?? 'jsonrpc');

  // JSON-RPC fields
  const [nxapiCommand, setNxapiCommand] = usePersistentState('nxapi:command', initialData?.command ?? 'show version');
  const [nxapiCommandType, setNxapiCommandType] = usePersistentState('nxapi:commandType', initialData?.commandType ?? 'cli_show');

  // REST fields
  const [nxapiDmePath, setNxapiDmePath] = usePersistentState('nxapi:dmePath', initialData?.dmePath ?? 'topSystem');
  const [nxapiMethod, setNxapiMethod] = usePersistentState('nxapi:method', initialData?.method ?? 'GET');
  const [nxapiBody, setNxapiBody] = usePersistentState('nxapi:body', initialData?.body ?? '');

  // Validation
  const [nxapiError, setNxapiError] = useState('');

  // ── Share URL ──
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'nxapi-builder',
        switchIp: nxapiSwitchIp, username: nxapiUsername, password: nxapiPassword,
        port: nxapiPort, protocol: nxapiProtocol, mode: nxapiMode,
        command: nxapiCommand, commandType: nxapiCommandType,
        dmePath: nxapiDmePath, method: nxapiMethod, body: nxapiBody,
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [nxapiSwitchIp, nxapiUsername, nxapiPassword, nxapiPort, nxapiProtocol, nxapiMode, nxapiCommand, nxapiCommandType, nxapiDmePath, nxapiMethod, nxapiBody, onShare]);

  // ── Match active preset ──
  const currentPresetKey = useMemo(() => {
    const matched = NXAPI_PRESETS.find(p => {
      if (p.mode !== nxapiMode) return false;
      if (p.mode === 'jsonrpc') {
        return p.command === nxapiCommand && p.commandType === nxapiCommandType;
      } else {
        return p.dmePath === nxapiDmePath && p.method === nxapiMethod && (!nxapiBody || nxapiBody.trim() === '');
      }
    });
    return matched ? matched.key : '';
  }, [nxapiMode, nxapiCommand, nxapiCommandType, nxapiDmePath, nxapiMethod, nxapiBody]);

  // ── Preset handler ──
  const applyPreset = useCallback((presetKey) => {
    const preset = NXAPI_PRESETS.find(p => p.key === presetKey);
    if (!preset) return;
    setNxapiMode(preset.mode);
    if (preset.mode === 'jsonrpc') {
      setNxapiCommand(preset.command);
      setNxapiCommandType(preset.commandType);
    } else {
      setNxapiDmePath(preset.dmePath);
      setNxapiMethod(preset.method);
      setNxapiBody('');
    }
  }, []);

  // ── Clear ──
  const handleClear = useCallback(() => {
    setNxapiSwitchIp('');
    setNxapiUsername('admin');
    setNxapiPassword('');
    setNxapiPort(nxapiProtocol === 'https' ? 443 : 80);
    setNxapiMode('jsonrpc');
    setNxapiCommand('show version');
    setNxapiCommandType('cli_show');
    setNxapiDmePath('topSystem');
    setNxapiMethod('GET');
    setNxapiBody('');
    setNxapiError('');
  }, [nxapiProtocol]);

  // ── Validate (pure check for render, state setter for button click) ──
  const nxapiIsValid = !!(nxapiSwitchIp.trim()
    && (nxapiMode === 'jsonrpc' ? nxapiCommand.trim() : nxapiDmePath.trim()));

  const handleGenerate = useCallback(() => {
    if (!nxapiSwitchIp.trim()) {
      setNxapiError(t('nxapi_builder.err_no_ip', 'Switch IP/hostname is required'));
      return;
    }
    if (nxapiMode === 'jsonrpc' && !nxapiCommand.trim()) {
      setNxapiError(t('nxapi_builder.err_no_command', 'Command is required'));
      return;
    }
    if (nxapiMode === 'rest' && !nxapiDmePath.trim()) {
      setNxapiError(t('nxapi_builder.err_no_path', 'DME path is required'));
      return;
    }
    setNxapiError('');
  }, [nxapiSwitchIp, nxapiMode, nxapiCommand, nxapiDmePath, t]);

  // ── Generated outputs (useMemo) ──
  const nxapiPayload = useMemo(() => {
    if (nxapiMode === 'jsonrpc') {
      return buildJsonRpcPayload(nxapiCommand, nxapiCommandType);
    }
    return null;
  }, [nxapiMode, nxapiCommand, nxapiCommandType]);

  const nxapiCurlCommand = useMemo(() => {
    if (nxapiMode === 'jsonrpc') {
      return buildCurlJsonRpc(nxapiSwitchIp, nxapiPort, nxapiProtocol, nxapiUsername, nxapiPassword, nxapiPayload);
    }
    return buildCurlRest(nxapiSwitchIp, nxapiPort, nxapiProtocol, nxapiUsername, nxapiPassword, nxapiDmePath, nxapiMethod, nxapiBody);
  }, [nxapiMode, nxapiSwitchIp, nxapiPort, nxapiProtocol, nxapiUsername, nxapiPassword, nxapiPayload, nxapiDmePath, nxapiMethod, nxapiBody]);

  const nxapiAuthCurl = useMemo(() => {
    return buildAuthCurl(nxapiSwitchIp, nxapiPort, nxapiProtocol, nxapiUsername, nxapiPassword);
  }, [nxapiSwitchIp, nxapiPort, nxapiProtocol, nxapiUsername, nxapiPassword]);

  const nxapiRequestHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    'Authorization': 'Basic <base64(username:password)>',
  }), []);

  const nxapiHttpMethod = nxapiMode === 'rest' ? nxapiMethod : 'POST';
  const nxapiRequestUrl = useMemo(() => {
    if (nxapiMode === 'jsonrpc') {
      const proto = nxapiProtocol || 'https';
      const target = nxapiSwitchIp || '<SWITCH>';
      const portSuffix = ((proto === 'https' && nxapiPort && nxapiPort !== 443) || (proto === 'http' && nxapiPort && nxapiPort !== 80)) ? `:${nxapiPort}` : '';
      return `${proto}://${target}${portSuffix}/ins`;
    }
    return buildRestUrl(nxapiSwitchIp, nxapiPort, nxapiProtocol, nxapiDmePath);
  }, [nxapiMode, nxapiSwitchIp, nxapiPort, nxapiProtocol, nxapiDmePath]);

  // ── Styles ──
  const nxapiMono = { fontFamily: 'var(--mono)', fontSize: 13 };
  const nxapiPreStyle = {
    fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    padding: '12px 14px', color: 'var(--cyan)', lineHeight: 1.6,
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowX: 'auto', margin: 0,
  };

  return (
    <div className="fadein">
      {/* ── Connection Settings ── */}
      <div className="card">
        <div className="card-title">{t('nxapi_builder.title', 'NX-API Request Builder')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          {t('nxapi_builder.subtitle', 'Build NX-API JSON-RPC and REST (DME) requests for Cisco NX-OS switches.')}
        </div>

        <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>{t('nxapi_builder.connection_settings', 'Connection Settings')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }} className="grid-mobile-1">
          <div className="field">
            <label className="label">{t('nxapi_builder.switch_ip', 'Switch IP / Hostname')}</label>
            <input className="input" style={nxapiMono} placeholder="10.10.10.1"
              value={nxapiSwitchIp} onChange={e => setNxapiSwitchIp(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('nxapi_builder.username', 'Username')}</label>
            <input className="input" style={nxapiMono} placeholder="admin"
              value={nxapiUsername} onChange={e => setNxapiUsername(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('nxapi_builder.password', 'Password')}</label>
            <input className="input" type="password" placeholder="••••••••"
              value={nxapiPassword} onChange={e => setNxapiPassword(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('nxapi_builder.port', 'Port')}</label>
            <input className="input" style={nxapiMono} type="number" min={1} max={65535}
              value={nxapiPort} onChange={e => setNxapiPort(parseInt(e.target.value) || 443)} />
          </div>
        </div>

        {/* Protocol toggle */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label">{t('nxapi_builder.protocol', 'Protocol')}</label>
          <div style={{ display: 'flex', gap: 0 }}>
            <button className={`btn btn-sm ${nxapiProtocol === 'http' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setNxapiProtocol('http'); if (nxapiPort === 443) setNxapiPort(80); }}>
              HTTP
            </button>
            <button className={`btn btn-sm ${nxapiProtocol === 'https' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setNxapiProtocol('https'); if (nxapiPort === 80) setNxapiPort(443); }}>
              HTTPS
            </button>
          </div>
        </div>

        {/* ── API Mode Toggle ── */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label">{t('nxapi_builder.api_mode', 'API Mode')}</label>
          <div style={{ display: 'flex', gap: 0 }}>
            <button className={`btn btn-sm ${nxapiMode === 'jsonrpc' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setNxapiMode('jsonrpc')}>
              {t('nxapi_builder.mode_jsonrpc', 'JSON-RPC')}
            </button>
            <button className={`btn btn-sm ${nxapiMode === 'rest' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setNxapiMode('rest')}>
              {t('nxapi_builder.mode_rest', 'REST (DME)')}
            </button>
          </div>
        </div>

        {/* ── Presets ── */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label">{t('nxapi_builder.presets', 'Presets')}</label>
          <select className="select" value={currentPresetKey} onChange={e => { if (e.target.value) applyPreset(e.target.value); }}>
            <option value="">-- {t('nxapi_builder.presets', 'Presets')} --</option>
            {NXAPI_PRESETS.map(p => (
              <option key={p.key} value={p.key}>{t(p.labelKey)}</option>
            ))}
          </select>
        </div>

        {/* ── JSON-RPC fields ── */}
        {nxapiMode === 'jsonrpc' && (
          <>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="label">{t('nxapi_builder.command', 'Command')}</label>
              <textarea className="input" style={{ ...nxapiMono, minHeight: 56, resize: 'vertical' }}
                placeholder="show version"
                value={nxapiCommand} onChange={e => setNxapiCommand(e.target.value)}
                rows={3} />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="label">{t('nxapi_builder.command_type', 'Command Type')}</label>
              <select className="select" value={nxapiCommandType} onChange={e => setNxapiCommandType(e.target.value)}>
                {COMMAND_TYPES.map(ct => (
                  <option key={ct.value} value={ct.value}>{t(ct.labelKey)}</option>
                ))}
              </select>
            </div>
          </>
        )}

        {/* ── REST fields ── */}
        {nxapiMode === 'rest' && (
          <>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="label">{t('nxapi_builder.dme_path', 'DME Class / MO Path')}</label>
              <input className="input" style={nxapiMono} placeholder="sys/intf"
                value={nxapiDmePath} onChange={e => setNxapiDmePath(e.target.value)} />
              <span className="hint">MO path (e.g. sys/intf, sys/bgp) or class:ClassName (e.g. class:bgpDom) for class queries</span>
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="label">{t('nxapi_builder.method', 'Method')}</label>
              <select className="select" value={nxapiMethod} onChange={e => setNxapiMethod(e.target.value)}>
                {REST_METHODS.map(m => (
                  <option key={m.value} value={m.value}>{t(m.labelKey)}</option>
                ))}
              </select>
            </div>
            {nxapiMethod === 'POST' && (
              <div className="field" style={{ marginBottom: 12 }}>
                <label className="label">{t('nxapi_builder.body', 'Body')}</label>
                <textarea className="input" style={{ ...nxapiMono, minHeight: 56, resize: 'vertical' }}
                  placeholder='{"topSystem": {"attributes": {"name": "value"}}}'
                  value={nxapiBody} onChange={e => setNxapiBody(e.target.value)}
                  rows={4} />
              </div>
            )}
          </>
        )}

        {/* Buttons */}
        <div className="btn-row" style={{ marginTop: 4 }}>
          <button className="btn btn-primary" onClick={handleGenerate}>
            {t('nxapi_builder.generate', 'Generate Request')}
          </button>
          <button className="btn btn-ghost" onClick={handleClear}>
            {t('common.clear', 'Clear')}
          </button>
        </div>

        <Err msg={nxapiError} />
      </div>

      {/* ── Generated Output ── */}
      {nxapiIsValid && (
        <div className="card fadein" style={{ marginTop: 16 }}>
          <div className="card-title">{t('common.results', 'Results')}</div>

          {/* Auth note */}
          <div style={{ padding: 10, background: 'var(--panel)', borderLeft: '4px solid #e0c452', borderRadius: 4, fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
            <strong style={{ color: '#e0c452' }}>{t('nxapi_builder.auth_note_title', 'Authentication')}: </strong>
            {t('nxapi_builder.auth_note_body')}
          </div>

          {/* HTTP Request details */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('nxapi_builder.http_request', 'HTTP Request')}</span>
            </div>
            <div className="result-grid" style={{ marginBottom: 8 }}>
              <div className="result-item">
                <div>
                  <div className="result-label">{t('nxapi_builder.request_method')}</div>
                  <div className="result-value accent">{nxapiHttpMethod}</div>
                </div>
              </div>
              <div className="result-item">
                <div>
                  <div className="result-label">{t('nxapi_builder.request_url')}</div>
                  <div className="result-value" style={{ fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all' }}>{nxapiRequestUrl}</div>
                </div>
                <CopyBtn text={nxapiRequestUrl} id="nxapi-url" />
              </div>
            </div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t('nxapi_builder.headers', 'Headers')}</span>
              <pre style={{ ...nxapiPreStyle, fontSize: 11, padding: '8px 12px', color: 'var(--muted)' }}>
                {Object.entries(nxapiRequestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n')}
              </pre>
            </div>
          </div>

          {/* JSON Payload (JSON-RPC mode) */}
          {nxapiMode === 'jsonrpc' && nxapiPayload && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('nxapi_builder.json_payload', 'JSON Payload')}</span>
                <CopyBtn text={JSON.stringify(nxapiPayload, null, 2)} id="nxapi-payload" />
              </div>
              <pre style={nxapiPreStyle}>{JSON.stringify(nxapiPayload, null, 2)}</pre>
            </div>
          )}

          {/* cURL command */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('nxapi_builder.curl_command', 'cURL Command')}</span>
              <CopyBtn text={nxapiCurlCommand} id="nxapi-curl" />
            </div>
            <pre style={nxapiPreStyle}>{nxapiCurlCommand}</pre>
          </div>

          {/* Auth cURL */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('nxapi_builder.auth_curl', 'Authentication cURL')}</span>
              <CopyBtn text={nxapiAuthCurl} id="nxapi-auth-curl" />
            </div>
            <pre style={nxapiPreStyle}>{nxapiAuthCurl}</pre>
            <span className="hint" style={{ marginTop: 6, display: 'block' }}>
              {t('nxapi_builder.auth_curl_hint', 'Use this to verify credentials and connectivity. NX-OS NX-API uses HTTP Basic Auth — the -u flag in every cURL command above handles authentication.')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
window.NXAPIBuilder = NXAPIBuilder;
