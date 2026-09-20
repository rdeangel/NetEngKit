const { useState, useEffect, useCallback, useMemo } = React;

// ── Config generators ─────────────────────────────────────────────────
function genCiscoRadiusServer(cfg) {
  const lines = [];
  if (cfg.vendor_aaa === 'new-model') {
    lines.push('aaa new-model');
    lines.push('');
    for (let i = 0; i < cfg.radius_servers.length; i++) {
      const s = cfg.radius_servers[i];
      if (!s.ip) continue;
      lines.push(`radius server RADIUS-${i + 1}`);
      lines.push(` address ipv4 ${s.ip} auth-port ${s.auth_port || 1812} acct-port ${s.acct_port || 1813}`);
      lines.push(` key ${s.key || '<SECRET>'}`);
      if (s.timeout) lines.push(` timeout ${s.timeout}`);
      if (s.retransmit) lines.push(` retransmit ${s.retransmit}`);
      lines.push('!');
    }
    lines.push('');
    lines.push('aaa group server radius RADIUS-GROUP');
    cfg.radius_servers.forEach((s, i) => { if (s.ip) lines.push(` server name RADIUS-${i + 1}`); });
    lines.push('!');
    lines.push('');
    lines.push(`aaa authentication dot1x default group RADIUS-GROUP`);
    lines.push(`aaa authorization network default group RADIUS-GROUP`);
    if (cfg.coa_enable) {
      lines.push(`aaa server radius dynamic-author`);
      lines.push(` client ${cfg.radius_servers[0]?.ip || '0.0.0.0'} server-key ${cfg.radius_servers[0]?.key || '<SECRET>'}`);
      lines.push(` port ${cfg.coa_port || 3799}`);
      lines.push(`!`);
    }
    lines.push('');
    lines.push('dot1x system-auth-control');
  }
  return lines.join('\n');
}

function genCiscoPortConfig(cfg) {
  const lines = [];
  const ifaceName = cfg.interface || 'GigabitEthernet1/0/1';
  lines.push(`interface ${ifaceName}`);

  if (cfg.host_mode === 'single-host') {
    lines.push(` switchport mode access`);
    if (cfg.data_vlan) lines.push(` switchport access vlan ${cfg.data_vlan}`);
    if (cfg.voice_vlan) lines.push(` switchport voice vlan ${cfg.voice_vlan}`);
    lines.push(` authentication host-mode single-host`);
  } else if (cfg.host_mode === 'multi-host') {
    lines.push(` switchport mode access`);
    if (cfg.data_vlan) lines.push(` switchport access vlan ${cfg.data_vlan}`);
    lines.push(` authentication host-mode multi-host`);
  } else if (cfg.host_mode === 'multi-domain') {
    lines.push(` switchport mode access`);
    if (cfg.data_vlan) lines.push(` switchport access vlan ${cfg.data_vlan}`);
    if (cfg.voice_vlan) lines.push(` switchport voice vlan ${cfg.voice_vlan}`);
    lines.push(` authentication host-mode multi-domain`);
  }

  lines.push(` authentication order dot1x mab`);
  lines.push(` authentication priority dot1x mab`);
  lines.push(` authentication port-control auto`);
  lines.push(` authentication periodic`);
  lines.push(` authentication timer reauthenticate server`);

  if (cfg.enable_dot1x) lines.push(` dot1x pae authenticator`);
  if (cfg.enable_mab) lines.push(` mab`);
  if (cfg.enable_webauth) {
    lines.push(` ip access-group ACL-WEBAUTH in`);
    lines.push(` ip admission name WEB-RULE`);
  }

  if (cfg.auth_fail_vlan) {
    lines.push(` authentication event fail action authorize vlan ${cfg.auth_fail_vlan}`);
    lines.push(` authentication event no-response action authorize vlan ${cfg.auth_fail_vlan}`);
  }

  if (cfg.critical_vlan) {
    lines.push(` authentication event server dead action authorize vlan ${cfg.critical_vlan}`);
    lines.push(` authentication event server alive action reinitialize`);
  }

  lines.push(` spanning-tree portfast`);
  lines.push(`!`);
  return lines.join('\n');
}

function genArubaPortConfig(cfg) {
  const lines = [];
  if (cfg.aruba_type === 'aos-cx') {
    lines.push('! AOS-CX (Aruba CX Switch)');
    lines.push('');
    for (const s of cfg.radius_servers) {
      if (!s.ip) continue;
      lines.push(`radius-server host ${s.ip}`);
      lines.push(` key plaintext ${s.key || '<SECRET>'}`);
      lines.push(` authentication port ${s.auth_port || 1812}`);
      lines.push(` accounting port ${s.acct_port || 1813}`);
    }
    lines.push('');
    lines.push('aaa authentication port-access dot1x authenticator');
    lines.push(' enable');
    if (cfg.coa_enable) lines.push(' radius server-group RADIUS-GROUP');
    lines.push('!');
    lines.push('');
    const ifaceName = cfg.interface || '1/1/1';
    lines.push(`interface ${ifaceName}`);
    if (cfg.data_vlan) lines.push(` vlan access ${cfg.data_vlan}`);
    lines.push(` aaa authentication port-access dot1x authenticator enable`);
    if (cfg.enable_mab) lines.push(` aaa authentication port-access dot1x authenticator auth-order dot1x mac-auth`);
    if (cfg.host_mode === 'multi-domain') lines.push(` aaa authentication port-access dot1x authenticator client-limit 2`);
    if (cfg.auth_fail_vlan) lines.push(` aaa authentication port-access dot1x authenticator auth-failure vlan ${cfg.auth_fail_vlan}`);
    if (cfg.critical_vlan) lines.push(` aaa authentication port-access dot1x authenticator server-fail vlan ${cfg.critical_vlan}`);
    lines.push('!');
  } else {
    // AOS-Switch (older ProCurve style)
    lines.push('! AOS-Switch (ProCurve / 2xxx/3xxx)');
    lines.push('');
    lines.push(`aaa port-access authenticator ${cfg.interface || 'A1'}`);
    lines.push(` client-limit ${cfg.host_mode === 'single-host' ? '1' : '32'}`);
    if (cfg.enable_mab) lines.push(` mac-based enable`);
    if (cfg.auth_fail_vlan) lines.push(` auth-vid ${cfg.auth_fail_vlan}`);
    if (cfg.data_vlan) lines.push(` unauth-vid ${cfg.data_vlan}`);
    lines.push('!');
    lines.push(`aaa port-access authenticator active`);
  }
  return lines.join('\n');
}

const DEFAULT_RADIUS = () => ({ ip: '', auth_port: 1812, acct_port: 1813, key: '', timeout: 5, retransmit: 3 });

function Dot1xBuilder({ initialData, onShare }) {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistentState('dot1x:tab', 'cisco');
  const [host_mode, setHostMode] = usePersistentState('dot1x:host_mode', initialData?.host_mode ?? 'multi-domain');
  const [interface_, setInterface] = usePersistentState('dot1x:iface', initialData?.interface ?? '');
  const [data_vlan, setDataVlan] = usePersistentState('dot1x:data_vlan', initialData?.data_vlan ?? '');
  const [voice_vlan, setVoiceVlan] = usePersistentState('dot1x:voice_vlan', initialData?.voice_vlan ?? '');
  const [auth_fail_vlan, setAuthFailVlan] = usePersistentState('dot1x:auth_fail_vlan', initialData?.auth_fail_vlan ?? '');
  const [critical_vlan, setCriticalVlan] = usePersistentState('dot1x:critical_vlan', initialData?.critical_vlan ?? '');
  const [enable_dot1x, setEnableDot1x] = usePersistentState('dot1x:dot1x', initialData?.dot1x ?? true);
  const [enable_mab, setEnableMAB] = usePersistentState('dot1x:mab', initialData?.mab ?? true);
  const [enable_webauth, setEnableWebAuth] = usePersistentState('dot1x:webauth', initialData?.webauth ?? false);
  const [coa_enable, setCoAEnable] = usePersistentState('dot1x:coa', initialData?.coa ?? false);
  const [coa_port, setCoAPort] = usePersistentState('dot1x:coa_port', initialData?.coa_port ?? 3799);
  const [radius_servers, setRadiusServers] = usePersistentState('dot1x:radius', initialData?.radius ?? [DEFAULT_RADIUS(), DEFAULT_RADIUS()]);
  const [aruba_type, setArubaType] = usePersistentState('dot1x:aruba_type', 'aos-cx');
  const [copied, copy] = useCopy();

  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'dot1x-builder', host_mode, interface: interface_, data_vlan, voice_vlan, auth_fail_vlan, critical_vlan, dot1x: enable_dot1x, mab: enable_mab, webauth: enable_webauth, coa: coa_enable, coa_port, radius: radius_servers });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [host_mode, interface_, data_vlan, voice_vlan, auth_fail_vlan, critical_vlan, enable_dot1x, enable_mab, enable_webauth, coa_enable, coa_port, radius_servers, onShare]);

  const cfg = { host_mode, interface: interface_, data_vlan, voice_vlan, auth_fail_vlan, critical_vlan, enable_dot1x, enable_mab, enable_webauth, coa_enable, coa_port, radius_servers, aruba_type, vendor_aaa: 'new-model' };

  const ciscoRadiusConfig = useMemo(() => genCiscoRadiusServer(cfg), [JSON.stringify(cfg)]);
  const ciscoPortConfig = useMemo(() => genCiscoPortConfig(cfg), [JSON.stringify(cfg)]);
  const arubaConfig = useMemo(() => genArubaPortConfig(cfg), [JSON.stringify(cfg)]);

  const updateRadius = (idx, field, val) => {
    setRadiusServers(prev => prev.map((s, i) => i === idx ? { ...s, [field]: val } : s));
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('dot1x.title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>{t('dot1x.subtitle')}</p>

        <div className="two-col">
          <div>
            <div style={{ fontWeight: 600, marginBottom: 10, color: 'var(--cyan)' }}>{t('dot1x.section_radius')}</div>
            {radius_servers.map((s, i) => (
              <div key={i} style={{ marginBottom: 14, padding: 12, background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 600 }}>{t('dot1x.radius_server')} #{i + 1}</div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <div className="field" style={{ flex: 2, minWidth: 140 }}>
                    <label className="label">{t('common.ip', 'IP')}</label>
                    <input className="input" placeholder="10.0.0.1" value={s.ip} onChange={e => updateRadius(i, 'ip', e.target.value)} />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 80 }}>
                    <label className="label">{t('dot1x.auth_port')}</label>
                    <input className="input" type="number" value={s.auth_port} onChange={e => updateRadius(i, 'auth_port', +e.target.value)} />
                  </div>
                  <div className="field" style={{ flex: 1, minWidth: 80 }}>
                    <label className="label">{t('dot1x.acct_port')}</label>
                    <input className="input" type="number" value={s.acct_port} onChange={e => updateRadius(i, 'acct_port', +e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label className="label">{t('dot1x.shared_secret')}</label>
                  <input className="input" type="password" placeholder="<secret>" value={s.key} onChange={e => updateRadius(i, 'key', e.target.value)} />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="label">{t('dot1x.timeout')} (s)</label>
                    <input className="input" type="number" value={s.timeout} onChange={e => updateRadius(i, 'timeout', +e.target.value)} />
                  </div>
                  <div className="field" style={{ flex: 1 }}>
                    <label className="label">{t('dot1x.retransmit')}</label>
                    <input className="input" type="number" value={s.retransmit} onChange={e => updateRadius(i, 'retransmit', +e.target.value)} />
                  </div>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 6 }}>
              <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13, cursor: 'pointer', marginBottom: 8 }}>
                <input type="checkbox" checked={coa_enable} onChange={e => setCoAEnable(e.target.checked)} />
                {t('dot1x.enable_coa')}
              </label>
              {coa_enable && (
                <div className="field" style={{ maxWidth: 160 }}>
                  <label className="label">{t('dot1x.coa_port')}</label>
                  <input className="input" type="number" value={coa_port} onChange={e => setCoAPort(+e.target.value)} />
                </div>
              )}
            </div>
          </div>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 10, color: 'var(--cyan)' }}>{t('dot1x.section_port')}</div>
            <div className="field">
              <label className="label">{t('dot1x.interface')}</label>
              <input className="input" placeholder="GigabitEthernet1/0/1" value={interface_} onChange={e => setInterface(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('dot1x.host_mode')}</label>
              <select className="input" value={host_mode} onChange={e => setHostMode(e.target.value)}>
                <option value="single-host">{t('dot1x.single_host')}</option>
                <option value="multi-host">{t('dot1x.multi_host')}</option>
                <option value="multi-domain">{t('dot1x.multi_domain')}</option>
              </select>
            </div>
            <div className="two-col">
              <div className="field">
                <label className="label">{t('dot1x.data_vlan')}</label>
                <input className="input" placeholder="10" value={data_vlan} onChange={e => setDataVlan(e.target.value)} />
              </div>
              {(host_mode === 'multi-domain' || host_mode === 'single-host') && (
                <div className="field">
                  <label className="label">{t('dot1x.voice_vlan')}</label>
                  <input className="input" placeholder="100" value={voice_vlan} onChange={e => setVoiceVlan(e.target.value)} />
                </div>
              )}
            </div>
            <div className="two-col">
              <div className="field">
                <label className="label">{t('dot1x.auth_fail_vlan')}</label>
                <input className="input" placeholder="999" value={auth_fail_vlan} onChange={e => setAuthFailVlan(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('dot1x.critical_vlan')}</label>
                <input className="input" placeholder="99" value={critical_vlan} onChange={e => setCriticalVlan(e.target.value)} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 4 }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={enable_dot1x} onChange={e => setEnableDot1x(e.target.checked)} /> 802.1X
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={enable_mab} onChange={e => setEnableMAB(e.target.checked)} /> MAB
              </label>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, cursor: 'pointer' }}>
                <input type="checkbox" checked={enable_webauth} onChange={e => setEnableWebAuth(e.target.checked)} /> WebAuth
              </label>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {['cisco', 'aruba'].map(id => (
            <button key={id} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(id)}>
              {id === 'cisco' ? t('dot1x.tab_cisco') : t('dot1x.tab_aruba')}
            </button>
          ))}
        </div>

        {tab === 'aruba' && (
          <div className="field" style={{ maxWidth: 300, marginBottom: 12 }}>
            <label className="label">{t('dot1x.aruba_platform')}</label>
            <select className="input" value={aruba_type} onChange={e => setArubaType(e.target.value)}>
              <option value="aos-cx">Aruba CX (AOS-CX)</option>
              <option value="aos-switch">Aruba Switch (AOS-Switch / ProCurve)</option>
            </select>
          </div>
        )}

        {tab === 'cisco' && (
          <>
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t('dot1x.global_config')}</div>
                <CopyBtn text={ciscoRadiusConfig} label="common.copy" id="dot1x-global" />
              </div>
              <pre style={{ background: 'var(--panel)', padding: 14, borderRadius: 8, fontSize: 12, overflowX: 'auto', border: '1px solid var(--border)', margin: 0 }}>{ciscoRadiusConfig}</pre>
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{t('dot1x.port_config')}</div>
                <CopyBtn text={ciscoPortConfig} label="common.copy" id="dot1x-port" />
              </div>
              <pre style={{ background: 'var(--panel)', padding: 14, borderRadius: 8, fontSize: 12, overflowX: 'auto', border: '1px solid var(--border)', margin: 0 }}>{ciscoPortConfig}</pre>
            </div>
          </>
        )}

        {tab === 'aruba' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{t('dot1x.aruba_config')}</div>
              <CopyBtn text={arubaConfig} label="common.copy" id="dot1x-aruba" />
            </div>
            <pre style={{ background: 'var(--panel)', padding: 14, borderRadius: 8, fontSize: 12, overflowX: 'auto', border: '1px solid var(--border)', margin: 0 }}>{arubaConfig}</pre>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('dot1x.reference_title')}</div>
        <div className="two-col">
          <div>
            <div style={{ fontWeight: 600, color: 'var(--cyan)', marginBottom: 8 }}>{t('dot1x.ref_host_modes')}</div>
            <ul style={{ fontSize: 13, color: 'var(--muted)', paddingLeft: 18, lineHeight: 1.8, margin: 0 }}>
              <li><strong style={{ color: 'var(--fg)' }}>single-host</strong> — {t('dot1x.ref_single_host_desc')}</li>
              <li><strong style={{ color: 'var(--fg)' }}>multi-host</strong> — {t('dot1x.ref_multi_host_desc')}</li>
              <li><strong style={{ color: 'var(--fg)' }}>multi-domain</strong> — {t('dot1x.ref_multi_domain_desc')}</li>
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 600, color: 'var(--cyan)', marginBottom: 8 }}>{t('dot1x.ref_auth_methods')}</div>
            <ul style={{ fontSize: 13, color: 'var(--muted)', paddingLeft: 18, lineHeight: 1.8, margin: 0 }}>
              <li><strong style={{ color: 'var(--fg)' }}>802.1X</strong> — {t('dot1x.ref_dot1x_desc')}</li>
              <li><strong style={{ color: 'var(--fg)' }}>MAB</strong> — {t('dot1x.ref_mab_desc')}</li>
              <li><strong style={{ color: 'var(--fg)' }}>WebAuth</strong> — {t('dot1x.ref_webauth_desc')}</li>
              <li><strong style={{ color: 'var(--fg)' }}>CoA</strong> — {t('dot1x.ref_coa_desc')}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

window.Dot1xBuilder = Dot1xBuilder;
