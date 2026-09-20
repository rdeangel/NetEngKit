const { useState, useEffect, useCallback, useMemo } = React;

// ── Presets ──────────────────────────────────────────────────────────
const ARISTA_PRESETS = [
  { key: 'show_version',        command: 'show version' },
  { key: 'show_interfaces',     command: 'show interfaces' },
  { key: 'show_running_config', command: 'show running-config' },
  { key: 'show_ip_route',       command: 'show ip route' },
  { key: 'show_vlan',           command: 'show vlan' },
  { key: 'show_bgp_summary',    command: 'show bgp summary' },
  { key: 'show_lldp_neighbors', command: 'show lldp neighbors' },
  { key: 'show_inventory',      command: 'show inventory' },
  { key: 'show_spanning_tree',  command: 'show spanning-tree' },
  { key: 'show_ip_ospf_neighbor', command: 'show ip ospf neighbor' },
];

// ── Payload builders ─────────────────────────────────────────────────
function aristaBuildJsonRpc(commands, format) {
  return {
    jsonrpc: '2.0',
    method: 'runCmds',
    params: {
      version: 1,
      cmds: commands.filter(c => c.trim()),
      format: format || 'json',
    },
    id: 'NetEngKit',
  };
}

function aristaBuildUrl(host, port, protocol) {
  const proto = protocol || 'https';
  const target = host || '<SWITCH>';
  const portSuffix = ((proto === 'https' && port && port !== 443) || (proto === 'http' && port && port !== 80)) ? ':' + port : '';
  return proto + '://' + target + portSuffix + '/command-api';
}

function aristaBuildCurl(host, port, protocol, username, password, payload) {
  const url = aristaBuildUrl(host, port, protocol);
  const payloadStr = JSON.stringify(payload).replace(/'/g, "'\\''");
  const user = username || 'admin';
  const pass = password || '<password>';
  return "curl -k -X POST " + url + " -d '" + payloadStr + "' -H 'Content-Type: application/json' -u '" + user + ':' + pass + "'";
}

function aristaBuildPython(host, port, protocol, username, password, commands, format) {
  const proto = protocol || 'https';
  const target = host || '<SWITCH>';
  const portSuffix = ((proto === 'https' && port && port !== 443) || (proto === 'http' && port && port !== 80)) ? ':' + port : '';
  const user = username || 'admin';
  const pass = password || '<password>';
  const cmdsList = commands.filter(c => c.trim()).map(c => "    '" + c + "'").join(',\n');
  return [
    'from jsonrpclib import Server',
    '',
    'switch = Server("' + proto + '://' + user + ':' + pass + '@' + target + portSuffix + '/command-api")',
    'response = switch.runCmds(',
    '    version=1,',
    '    cmds=[',
    cmdsList,
    '    ],',
    '    format="' + (format || 'json') + '"',
    ')',
    '',
    'import json',
    'print(json.dumps(response, indent=2))',
  ].join('\n');
}

// ── Component ────────────────────────────────────────────────────────
function AristaAPIBuilder({ initialData, onShare }) {
  const { t } = useTranslation();

  // Connection settings
  const [aristaSwitchIp, setAristaSwitchIp] = usePersistentState('arista:switchIp', initialData?.switchIp ?? '');
  const [aristaUsername, setAristaUsername] = usePersistentState('arista:username', initialData?.username ?? 'admin');
  const [aristaPassword, setAristaPassword] = usePersistentState('arista:password', initialData?.password ?? '');
  const [aristaPort, setAristaPort] = usePersistentState('arista:port', initialData?.port ?? 443);
  const [aristaProtocol, setAristaProtocol] = usePersistentState('arista:protocol', initialData?.protocol ?? 'https');

  // Command settings
  const [aristaCommands, setAristaCommands] = usePersistentState('arista:commands', initialData?.commands ?? 'show version');
  const [aristaFormat, setAristaFormat] = usePersistentState('arista:format', initialData?.format ?? 'json');

  // Validation
  const [aristaError, setAristaError] = useState('');

  // ── Share URL ──
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'arista-api-builder',
        switchIp: aristaSwitchIp, username: aristaUsername, password: aristaPassword,
        port: aristaPort, protocol: aristaProtocol, commands: aristaCommands, format: aristaFormat,
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [aristaSwitchIp, aristaUsername, aristaPassword, aristaPort, aristaProtocol, aristaCommands, aristaFormat, onShare]);

  // ── Parsed command list ──
  const aristaCommandList = useMemo(() => {
    return aristaCommands.split('\n').filter(c => c.trim());
  }, [aristaCommands]);

  // ── Match active preset ──
  const aristaCurrentPresetKey = useMemo(() => {
    const matched = ARISTA_PRESETS.find(p => {
      return aristaCommandList.length === 1 && aristaCommandList[0] === p.command;
    });
    return matched ? matched.key : '';
  }, [aristaCommandList]);

  // ── Preset handler ──
  const aristaApplyPreset = useCallback((presetKey) => {
    const preset = ARISTA_PRESETS.find(p => p.key === presetKey);
    if (!preset) return;
    setAristaCommands(preset.command);
  }, []);

  // ── Clear ──
  const aristaHandleClear = useCallback(() => {
    setAristaSwitchIp('');
    setAristaUsername('admin');
    setAristaPassword('');
    setAristaPort(aristaProtocol === 'https' ? 443 : 80);
    setAristaCommands('show version');
    setAristaFormat('json');
    setAristaError('');
  }, [aristaProtocol]);

  // ── Validate ──
  const aristaIsValid = !!(aristaSwitchIp.trim() && aristaCommandList.length > 0);

  const aristaHandleGenerate = useCallback(() => {
    if (!aristaSwitchIp.trim()) {
      setAristaError(t('arista_api_builder.err_no_ip'));
      return;
    }
    if (aristaCommandList.length === 0) {
      setAristaError(t('arista_api_builder.err_no_command'));
      return;
    }
    setAristaError('');
  }, [aristaSwitchIp, aristaCommandList, t]);

  // ── Generated outputs ──
  const aristaPayload = useMemo(() => {
    if (!aristaCommandList.length) return null;
    return aristaBuildJsonRpc(aristaCommandList, aristaFormat);
  }, [aristaCommandList, aristaFormat]);

  const aristaCurlCommand = useMemo(() => {
    if (!aristaPayload) return '';
    return aristaBuildCurl(aristaSwitchIp, aristaPort, aristaProtocol, aristaUsername, aristaPassword, aristaPayload);
  }, [aristaSwitchIp, aristaPort, aristaProtocol, aristaUsername, aristaPassword, aristaPayload]);

  const aristaPythonScript = useMemo(() => {
    if (!aristaCommandList.length) return '';
    return aristaBuildPython(aristaSwitchIp, aristaPort, aristaProtocol, aristaUsername, aristaPassword, aristaCommandList, aristaFormat);
  }, [aristaSwitchIp, aristaPort, aristaProtocol, aristaUsername, aristaPassword, aristaCommandList, aristaFormat]);

  const aristaRequestUrl = useMemo(() => {
    return aristaBuildUrl(aristaSwitchIp, aristaPort, aristaProtocol);
  }, [aristaSwitchIp, aristaPort, aristaProtocol]);

  const aristaRequestHeaders = useMemo(() => ({
    'Content-Type': 'application/json',
    'Authorization': 'Basic <base64(username:password)>',
  }), []);

  // ── Styles ──
  const aristaPreStyle = {
    fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius)',
    padding: '12px 14px', color: 'var(--cyan)', lineHeight: 1.6,
    whiteSpace: 'pre-wrap', wordBreak: 'break-all', overflowX: 'auto', margin: 0,
  };

  return (
    <div className="fadein">
      {/* ── Connection Settings ── */}
      <div className="card">
        <div className="card-title">{t('arista_api_builder.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          {t('arista_api_builder.subtitle')}
        </div>

        <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>{t('arista_api_builder.connection_settings')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 12, marginBottom: 12 }} className="grid-mobile-1">
          <div className="field">
            <label className="label">{t('arista_api_builder.switch_ip')}</label>
            <input className="input" style={{ fontFamily: 'var(--mono)', fontSize: 13 }} placeholder="10.1.1.1"
              value={aristaSwitchIp} onChange={e => setAristaSwitchIp(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('arista_api_builder.username')}</label>
            <input className="input" style={{ fontFamily: 'var(--mono)', fontSize: 13 }} placeholder="admin"
              value={aristaUsername} onChange={e => setAristaUsername(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('arista_api_builder.password')}</label>
            <input className="input" type="password" placeholder="••••••••"
              value={aristaPassword} onChange={e => setAristaPassword(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('arista_api_builder.port')}</label>
            <input className="input" style={{ fontFamily: 'var(--mono)', fontSize: 13 }} type="number" min={1} max={65535}
              value={aristaPort} onChange={e => setAristaPort(parseInt(e.target.value) || 443)} />
          </div>
        </div>

        {/* Protocol toggle */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label">{t('arista_api_builder.protocol')}</label>
          <div style={{ display: 'flex', gap: 0 }}>
            <button className={`btn btn-sm ${aristaProtocol === 'http' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setAristaProtocol('http'); if (aristaPort === 443) setAristaPort(80); }}>
              HTTP
            </button>
            <button className={`btn btn-sm ${aristaProtocol === 'https' ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setAristaProtocol('https'); if (aristaPort === 80) setAristaPort(443); }}>
              HTTPS
            </button>
          </div>
        </div>

        {/* ── Presets ── */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label">{t('arista_api_builder.presets')}</label>
          <select className="select" value={aristaCurrentPresetKey} onChange={e => { if (e.target.value) aristaApplyPreset(e.target.value); }}>
            <option value="">-- {t('arista_api_builder.presets')} --</option>
            {ARISTA_PRESETS.map(p => (
              <option key={p.key} value={p.key}>{t('arista_api_builder.preset_' + p.key)}</option>
            ))}
          </select>
        </div>

        {/* ── Commands ── */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label">{t('arista_api_builder.commands')}</label>
          <textarea className="input" style={{ fontFamily: 'var(--mono)', fontSize: 13, minHeight: 80, resize: 'vertical' }}
            placeholder={"show version\nshow interfaces"}
            value={aristaCommands} onChange={e => setAristaCommands(e.target.value)}
            rows={4} />
          <span className="hint">{t('arista_api_builder.commands_hint')}</span>
        </div>

        {/* Output format */}
        <div className="field" style={{ marginBottom: 12 }}>
          <label className="label">{t('arista_api_builder.output_format')}</label>
          <select className="select" value={aristaFormat} onChange={e => setAristaFormat(e.target.value)}>
            <option value="json">json</option>
            <option value="text">text</option>
          </select>
        </div>

        {/* Buttons */}
        <div className="btn-row" style={{ marginTop: 4 }}>
          <button className="btn btn-primary" onClick={aristaHandleGenerate}>
            {t('arista_api_builder.generate')}
          </button>
          <button className="btn btn-ghost" onClick={aristaHandleClear}>
            {t('common.clear', 'Clear')}
          </button>
        </div>

        <Err msg={aristaError} />
      </div>

      {/* ── Generated Output ── */}
      {aristaIsValid && (
        <div className="card fadein" style={{ marginTop: 16 }}>
          <div className="card-title">{t('common.results', 'Results')}</div>

          {/* Auth note */}
          <div style={{ padding: 10, background: 'var(--panel)', borderLeft: '4px solid #e0c452', borderRadius: 4, fontSize: 11, color: 'var(--muted)', marginBottom: 14 }}>
            <strong style={{ color: '#e0c452' }}>{t('arista_api_builder.auth_note_title')}: </strong>
            {t('arista_api_builder.auth_note_body')}
          </div>

          {/* HTTP Request details */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('arista_api_builder.http_request')}</span>
            </div>
            <div className="result-grid" style={{ marginBottom: 8 }}>
              <div className="result-item">
                <div>
                  <div className="result-label">{t('arista_api_builder.request_method')}</div>
                  <div className="result-value accent">POST</div>
                </div>
              </div>
              <div className="result-item">
                <div>
                  <div className="result-label">{t('arista_api_builder.request_url')}</div>
                  <div className="result-value" style={{ fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all' }}>{aristaRequestUrl}</div>
                </div>
                <CopyBtn text={aristaRequestUrl} id="arista-url" />
              </div>
            </div>
            <div>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }}>{t('arista_api_builder.headers')}</span>
              <pre style={{ ...aristaPreStyle, fontSize: 11, padding: '8px 12px', color: 'var(--muted)' }}>
                {Object.entries(aristaRequestHeaders).map(([k, v]) => k + ': ' + v).join('\n')}
              </pre>
            </div>
          </div>

          {/* JSON Payload */}
          {aristaPayload && (
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('arista_api_builder.json_payload')}</span>
                <CopyBtn text={JSON.stringify(aristaPayload, null, 2)} id="arista-payload" />
              </div>
              <pre style={aristaPreStyle}>{JSON.stringify(aristaPayload, null, 2)}</pre>
            </div>
          )}

          {/* cURL command */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('arista_api_builder.curl_command')}</span>
              <CopyBtn text={aristaCurlCommand} id="arista-curl" />
            </div>
            <pre style={aristaPreStyle}>{aristaCurlCommand}</pre>
          </div>

          {/* Python script */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{t('arista_api_builder.python_script')}</span>
              <CopyBtn text={aristaPythonScript} id="arista-python" />
            </div>
            <pre style={aristaPreStyle}>{aristaPythonScript}</pre>
            <span className="hint" style={{ marginTop: 6, display: 'block' }}>
              {t('arista_api_builder.python_hint')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
window.AristaAPIBuilder = AristaAPIBuilder;
