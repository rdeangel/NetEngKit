const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SubnetCalc({ onShare, initialData, onNav }) {
  const { t } = useTranslation();
  const [mode, setMode] = usePersistentState('subnet:mode', initialData?.mode ?? 'calculator');
  const skipNavReport = useRef(false);

  // Apply-down: sidebar / Ctrl+K nav drives the active mode
  useEffect(() => {
    if (initialData?.mode && initialData.mode !== mode) {
      skipNavReport.current = true;
      setMode(initialData.mode);
    }
  }, [initialData]);

  // Report-up: tell the sidebar which sub-tab is active
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ mode });
  }, [mode]);

  const [input, setInput] = usePersistentState('subnet:input', initialData?.input || '192.168.1.0/24');
  const [result, setResult] = usePersistentState('subnet:result', null);
  const [err, setErr] = useState('');
  // Hoisted from IIFE to satisfy Rules of Hooks — must be unconditional
  const [addrTab, setAddrTab] = useState('private');

  const calc = (overrideInput) => {
    const val = typeof overrideInput === 'string' ? overrideInput : input;
    const cidr = IPv4.parseCIDR(val);
    if (!cidr) { setErr(t('subnet.err_invalid')); setResult(null); return; }
    setErr('');
    const sn = IPv4.subnet(cidr.ip, cidr.prefix);
    const cls = IPv4.classify(cidr.ip);
    setResult({ sn, cls, inputIP: IPv4.str(cidr.ip) });
  };

  useEffect(() => {
    if (initialData?.input) {
      setInput(initialData.input);
      calc(initialData.input);
    } else {
      calc();
    }
  }, [initialData]);

  useEffect(() => {
    const timer = setTimeout(() => calc(), 300);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (result) (e.detail?.respond ?? onShare)({ tool:'subnet', mode, input });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [result, input, mode, onShare]);

  const rows = result ? [
    { Field: t('subnet.network_addr'), Value: result.sn.networkStr },
    { Field: t('subnet.subnet_mask'), Value: result.sn.maskStr },
    { Field: t('subnet.wildcard_mask'), Value: result.sn.wildcardStr },
    { Field: t('subnet.broadcast_addr'), Value: result.sn.broadcastStr },
    { Field: t('subnet.first_host'), Value: result.sn.firstHostStr },
    { Field: t('subnet.last_host'), Value: result.sn.lastHostStr },
    { Field: t('subnet.total_addr'), Value: result.sn.totalCount },
    { Field: t('subnet.usable_hosts'), Value: result.sn.hostCount },
    { Field: 'CIDR', Value: result.sn.cidr },
    { Field: t('subnet.ip_class'), Value: result.cls.ipClass },
    { Field: t('subnet.type'), Value: result.cls.type },
    { Field: t('subnet.scope'), Value: result.cls.scope },
    { Field: t('subnet.rfc'), Value: result.cls.rfc },
  ] : [];

  const tabBtnStyle = (active) => ({
    background: active ? 'var(--card)' : 'transparent',
    border: '1px solid var(--border)',
    borderBottom: active ? '1px solid var(--card)' : '1px solid var(--border)',
    borderRadius: 'var(--radius) var(--radius) 0 0',
    color: active ? 'var(--fg)' : 'var(--dim)',
    padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    marginBottom: -1, position: 'relative',
  });

  const addrTabs = [
    { id: 'private',       label: t('subnet.tab_private') },
    { id: 'special',       label: t('subnet.tab_special') },
    { id: 'multicast',     label: t('subnet.tab_multicast') },
    { id: 'documentation', label: t('subnet.tab_documentation') },
  ];
  const privateAddrs = [
    { addr: '10.0.0.0/8',         name: t('subnet_addrs.priv_a_name'),      desc: t('subnet_addrs.priv_a_desc'), v6: 'fc00::/7' },
    { addr: '172.16.0.0/12',      name: t('subnet_addrs.priv_b_name'),      desc: t('subnet_addrs.priv_b_desc'), v6: 'fc00::/7' },
    { addr: '192.168.0.0/16',     name: t('subnet_addrs.priv_c_name'),      desc: t('subnet_addrs.priv_c_desc'), v6: 'fc00::/7' },
    { addr: '100.64.0.0/10',      name: t('subnet_addrs.shared_name'),      desc: t('subnet_addrs.shared_desc'), v6: '—' },
  ];
  const specialAddrs = [
    { addr: '0.0.0.0/8',          name: t('subnet_addrs.this_net_name'),    desc: t('subnet_addrs.this_net_desc'), v6: '::/128' },
    { addr: '127.0.0.0/8',        name: t('subnet_addrs.loopback_name'),    desc: t('subnet_addrs.loopback_desc'), v6: '::1/128' },
    { addr: '169.254.0.0/16',     name: t('subnet_addrs.link_local_name'),  desc: t('subnet_addrs.link_local_desc'), v6: 'fe80::/10' },
    { addr: '192.0.0.0/24',       name: t('subnet_addrs.ietf_proto_name'),  desc: t('subnet_addrs.ietf_proto_desc'), v6: '—' },
    { addr: '240.0.0.0/4',        name: t('subnet_addrs.reserved_e_name'),  desc: t('subnet_addrs.reserved_e_desc'), v6: '—' },
    { addr: '255.255.255.255/32', name: t('subnet_addrs.limited_brdcst_name'), desc: t('subnet_addrs.limited_brdcst_desc'), v6: '—' },
  ];
  const multicastAddrs = [
    { addr: '224.0.0.0/4',        name: t('subnet_addrs.mcast_d_name'),     desc: t('subnet_addrs.mcast_d_desc'), v6: 'ff00::/8' },
    { addr: '224.0.0.1',          name: t('subnet_addrs.all_hosts_name'),   desc: t('subnet_addrs.all_hosts_desc'), v6: 'ff02::1' },
    { addr: '224.0.0.2',          name: t('subnet_addrs.all_routers_name'), desc: t('subnet_addrs.all_routers_desc'), v6: 'ff02::2' },
    { addr: '224.0.0.5',          name: t('subnet_addrs.ospf_routers_name'), desc: t('subnet_addrs.ospf_routers_desc'), v6: 'ff02::5' },
    { addr: '224.0.0.6',          name: t('subnet_addrs.ospf_dr_bdr_name'), desc: t('subnet_addrs.ospf_dr_bdr_desc'), v6: 'ff02::6' },
    { addr: '224.0.0.9',          name: t('subnet_addrs.rip_routers_name'), desc: t('subnet_addrs.rip_routers_desc'), v6: 'ff02::9' },
    { addr: '224.0.0.251',        name: t('subnet_addrs.mdns_name'),        desc: t('subnet_addrs.mdns_desc'), v6: 'ff02::fb' },
    { addr: '239.0.0.0/8',        name: t('subnet_addrs.admin_scoped_name'), desc: t('subnet_addrs.admin_scoped_desc'), v6: '—' },
  ];
  const documentationAddrs = [
    { addr: '192.0.2.0/24',       name: t('subnet_addrs.test_net_1_name'),  desc: t('subnet_addrs.test_net_1_desc'), v6: '2001:db8::/32' },
    { addr: '198.51.100.0/24',    name: t('subnet_addrs.test_net_2_name'),  desc: t('subnet_addrs.test_net_2_desc'), v6: '2001:db8:1::/48' },
    { addr: '203.0.113.0/24',     name: t('subnet_addrs.test_net_3_name'),  desc: t('subnet_addrs.test_net_3_desc'), v6: '2001:db8:2::/48' },
    { addr: '198.18.0.0/15',      name: t('subnet_addrs.benchmarking_name'), desc: t('subnet_addrs.benchmarking_desc'), v6: '2001:2::/48' },
    { addr: '192.88.99.0/24',     name: t('subnet_addrs.relay_6to4_name'),  desc: t('subnet_addrs.relay_6to4_desc'), v6: '2002::/16' },
  ];
  const addrTabData = { private: privateAddrs, special: specialAddrs, multicast: multicastAddrs, documentation: documentationAddrs };
  const currentAddrData = addrTabData[addrTab];

  const tabs = [
    { id: 'calculator', label: t('subnet.tab_calculator') },
    { id: 'rebase', label: t('subnet.tab_rebase') },
    { id: 'binary', label: t('tools.subnet-viz.title') },
    { id: 'wildcard', label: t('tools.wildcard.title') },
    { id: 'map', label: t('tools.map.title') },
    { id: 'iplist', label: t('tools.iplist.title') },
  ];

  return (
    <div className="fadein">
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setMode(tab.id)} style={tabBtnStyle(mode === tab.id)}>{tab.label}</button>
        ))}
      </div>

      {mode === 'rebase' && <SubnetRebase initialData={initialData} onShare={onShare} />}
      {mode === 'binary' && <SubnetVisualizer initialData={initialData} onShare={onShare} />}
      {mode === 'wildcard' && <WildcardTool initialData={initialData} onShare={onShare} />}
      {mode === 'map' && <SubnetMap initialData={initialData} onShare={onShare} />}
      {mode === 'iplist' && <IPListGenerator initialData={initialData} onShare={onShare} />}
      {mode === 'calculator' && (
        <>
          <div className="card">
            <div className="card-title">{t('common.input')}</div>
            <div className="field">
              <label className="label">{t('subnet.ip_cidr_label')}</label>
              <div className="input-row">
                <input className={`input ${err ? 'error' : ''}`} value={input} onChange={e => setInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && calc()} placeholder={t('subnet.placeholder')} />
                <button type="button" className="btn btn-primary" onClick={() => calc()}>{t('common.calculate')}</button>
              </div>
              <Err msg={err} />
              <div className="hint">{t('subnet.hint')}</div>
            </div>
            <div style={{marginTop:8}}>
              <div style={{fontSize:11, opacity:.5, fontWeight:600, marginBottom:4}}>{t('subnet.quick_presets')}</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {['192.168.1.0/24','10.0.0.0/8','172.16.0.0/12','192.168.0.0/16','10.0.0.0/24','10.10.0.0/16'].map(p => (
                  <button key={p} className="btn btn-ghost btn-sm" onClick={() => setInput(p)}>{p}</button>
                ))}
              </div>
            </div>
          </div>

          {result && (
            <>
              <div className="card fadein">
                <div className="card-title">{t('common.results')} — {result.sn.cidr}</div>
                <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
                  <CopyBtn text={`${t('subnet.network_addr')}: ${result.sn.networkStr}\n${t('subnet.broadcast_addr')}: ${result.sn.broadcastStr}\n${t('subnet.subnet_mask')}: ${result.sn.maskStr}\n${t('subnet.wildcard_mask')}: ${result.sn.wildcardStr}\n${t('subnet.first_host')}: ${result.sn.firstHostStr}\n${t('subnet.last_host')}: ${result.sn.lastHostStr}\n${t('subnet.total_addr')}: ${result.sn.totalCount}\n${t('subnet.usable_hosts')}: ${result.sn.hostCount}\n${t('subnet.ip_class')}: ${result.cls.ipClass}\n${t('subnet.type')}: ${result.cls.type}\n${t('subnet.rfc')}: ${result.cls.rfc}\n${t('subnet.scope')}: ${result.cls.scope}`} label="copy_all" id="subnet-copy-all" />
                </div>
                <div className="result-grid grid-mobile-1">
                  <ResultItem label={t('subnet.network_addr')} value={result.sn.networkStr} accent />
                  <ResultItem label={t('subnet.broadcast_addr')} value={result.sn.broadcastStr} red />
                  <ResultItem label={t('subnet.subnet_mask')} value={result.sn.maskStr} />
                  <ResultItem label={t('subnet.wildcard_mask')} value={result.sn.wildcardStr} yellow />
                  <ResultItem label={t('subnet.first_host')} value={result.sn.firstHostStr} green />
                  <ResultItem label={t('subnet.last_host')} value={result.sn.lastHostStr} green />
                  <ResultItem label={t('subnet.total_addr')} value={result.sn.totalCount} />
                  <ResultItem label={t('subnet.usable_hosts')} value={result.sn.hostCount} green />
                  <ResultItem label={t('subnet.ip_class')} value={result.cls.ipClass} />
                  <ResultItem label={t('subnet.type')} value={result.cls.type} />
                  <ResultItem label={t('subnet.rfc')} value={result.cls.rfc} />
                  <ResultItem label={t('subnet.scope')} value={result.cls.scope} />
                </div>
              </div>

              <div className="card">
                <div className="card-title">{t('subnet.representations')} — {result.inputIP}</div>
                <div className="result-grid grid-mobile-1">
                  <ResultItem label={t('subnet.decimal')} value={result.inputIP} />
                  <ResultItem label={t('subnet.binary')} value={IPv4.toBinary(IPv4.parseCIDR(input)?.ip || 0)} />
                  <ResultItem label={t('subnet.hex')} value={IPv4.toHex(IPv4.parseCIDR(input)?.ip || 0)} />
                  <ResultItem label={t('subnet.integer')} value={(IPv4.parseCIDR(input)?.ip || 0).toString()} />
                </div>
              </div>

              <div className="card">
                <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
                  <div className="card-title" style={{margin:0}}>{t('subnet.common_subprefixes', { prefix: result.sn.prefix })}</div>
                  <div style={{display:'flex',gap:4}}>
                    <button className="btn btn-ghost btn-sm" onClick={() => exportJSON(
                      [1,2,4,8].map(delta => { const np = result.sn.prefix + delta; if (np > 30) return null; const sn = IPv4.subnet(result.sn.network, np); return { prefix: `/${np}`, subnets: Math.pow(2,delta).toLocaleString(), usable_each: sn.hostCount, mask: sn.maskStr }; }).filter(Boolean),
                      'ipv4-subprefixes.json'
                    )}>{t('common.export_json')}</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(
                      [1,2,4,8].map(delta => { const np = result.sn.prefix + delta; if (np > 30) return null; const sn = IPv4.subnet(result.sn.network, np); return { prefix: `/${np}`, subnets: Math.pow(2,delta).toLocaleString(), usable_each: sn.hostCount, mask: sn.maskStr }; }).filter(Boolean),
                      'ipv4-subprefixes.csv'
                    )}>{t('common.export_csv')}</button>
                  </div>
                </div>
                <div className="table-wrap hide-mobile">
                  <table><thead><tr>
                    <th>{t('supernet.prefix_length')}</th>
                    <th>{t('subnet.subnets_count')}</th>
                    <th>{t('subnet.usable_hosts')}</th>
                    <th>{t('subnet.subnet_mask')}</th>
                  </tr></thead>
                  <tbody>
                    {[1,2,4,8].map(delta => {
                      const np = result.sn.prefix + delta;
                      if (np > 30) return null;
                      const sn = IPv4.subnet(result.sn.network, np);
                      return (
                        <tr key={delta}>
                          <td style={{color:'var(--cyan)'}}>/{np}</td>
                          <td>{Math.pow(2,delta).toLocaleString()}</td>
                          <td>{sn.hostCount}</td>
                          <td style={{fontFamily:'monospace'}}>{sn.maskStr}</td>
                        </tr>
                      );
                    }).filter(Boolean)}
                  </tbody></table>
                </div>
                <div className="show-mobile mobile-cards">
                  {[1,2,4,8].map(delta => {
                    const np = result.sn.prefix + delta;
                    if (np > 30) return null;
                    const sn = IPv4.subnet(result.sn.network, np);
                    return (
                      <div key={delta} className="mobile-card">
                        <div className="mobile-card-row">
                          <span className="mobile-card-label">{t('supernet.prefix_length')}</span>
                          <span className="mobile-card-value" style={{color:'var(--cyan)',fontWeight:600}}>/{np}</span>
                        </div>
                        <div className="mobile-card-row">
                          <span className="mobile-card-label">{t('subnet.subnets_count')} / {t('subnet.usable_hosts')}</span>
                          <span className="mobile-card-value">{Math.pow(2,delta).toLocaleString()} / {sn.hostCount}</span>
                        </div>
                      </div>
                    );
                  }).filter(Boolean)}
                </div>
              </div>

              <div className="btn-row">
                <button className="btn btn-ghost" onClick={() => exportJSON(rows, 'subnet.json')}>{t('common.export_json')}</button>
                <button className="btn btn-ghost" onClick={() => exportCSV(rows, 'subnet.csv')}>{t('common.export_csv')}</button>
                <button className="btn btn-ghost" onClick={() => onShare({ tool:'subnet', mode: 'calculator', input })}>{t('common.share')}</button>
              </div>
            </>
          )}

          <div className="card">
            <div className="card-title">{t('subnet.common_addrs')}</div>
            <div style={{display:'flex', gap:0, marginBottom:12, borderBottom:'1px solid var(--border)'}}>
              {addrTabs.map(tab => (
                <button key={tab.id} onClick={() => setAddrTab(tab.id)} style={{
                  background: addrTab === tab.id ? 'var(--card)' : 'transparent',
                  border: '1px solid var(--border)',
                  borderBottom: addrTab === tab.id ? '1px solid var(--card)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius) var(--radius) 0 0',
                  color: addrTab === tab.id ? 'var(--fg)' : 'var(--dim)',
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  marginBottom: -1, position: 'relative',
                }}>{tab.label}</button>
              ))}
            </div>
            <div className="table-wrap hide-mobile">
              <table><thead><tr>
                <th>{t('common.th_address')}</th>
                <th>{t('subnet.addr_name')}</th>
                <th>{t('subnet.addr_desc')}</th>
                <th>{t('subnet.addr_ipv6')}</th>
              </tr></thead>
              <tbody>
                {currentAddrData.map((row, i) => {
                  const cidrInput = row.addr.includes('/') ? row.addr : row.addr + '/32';
                  return (
                    <tr key={i}>
                      <td style={{fontFamily:'monospace', fontSize:12, color:'var(--cyan)', whiteSpace:'nowrap'}}>
                        <a href="#" onClick={e => { e.preventDefault(); setInput(cidrInput); window.scrollTo({top:0,behavior:'smooth'}); }} style={{color:'inherit',textDecoration:'none',cursor:'pointer',borderBottom:'1px dashed var(--cyan)'}} title={t('subnet.load_addr')}>{row.addr}</a>
                      </td>
                      <td style={{fontWeight:600}}>{row.name}</td>
                      <td style={{opacity:.7}}>{row.desc}</td>
                      <td style={{fontFamily:'monospace', fontSize:12, opacity:.6}}>{row.v6}</td>
                    </tr>
                  );
                })}
              </tbody></table>
            </div>
            <div className="show-mobile mobile-cards">
              {currentAddrData.map((row, i) => {
                const cidrInput = row.addr.includes('/') ? row.addr : row.addr + '/32';
                return (
                  <div key={i} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('common.th_address')}</span>
                      <span className="mobile-card-value" style={{fontFamily:'monospace', fontSize:12, color:'var(--cyan)', wordBreak:'break-all'}}>
                        <a href="#" onClick={e => { e.preventDefault(); setInput(cidrInput); window.scrollTo({top:0,behavior:'smooth'}); }} style={{color:'inherit',textDecoration:'none',cursor:'pointer',borderBottom:'1px dashed var(--cyan)'}} title={t('subnet.load_addr')}>{row.addr}</a>
                      </span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('subnet.addr_name')}</span>
                      <span className="mobile-card-value" style={{fontWeight:600}}>{row.name}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('subnet.addr_desc')}</span>
                      <span className="mobile-card-value" style={{opacity:.7}}>{row.desc}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('subnet.addr_ipv6')}</span>
                      <span className="mobile-card-value" style={{fontFamily:'monospace', fontSize:12, opacity:.6}}>{row.v6}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tool: IP Range ↔ CIDR ───────────────────────────────────
window.SubnetCalc = SubnetCalc;
