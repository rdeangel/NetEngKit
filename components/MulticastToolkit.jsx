const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── Sub-component: McastReference ──────────────────────────────────────────
function McastReferenceSection() {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [filterVer, setFilterVer] = useState('All');

  const allEntries = useMemo(() => [
    ...Multicast.WELL_KNOWN_IPV4.map(e => ({ ...e, ver: 4 })),
    ...Multicast.WELL_KNOWN_IPV6.map(e => ({ ...e, ver: 6 })),
  ], []);

  const adminScopedBlocks = useMemo(() => [
    { range: '239.0.0.0/10', scope: t('mcast_ref.reserved'), usage: '—' },
    { range: '239.64.0.0/10', scope: t('mcast_ref.reserved'), usage: '—' },
    { range: '239.128.0.0/10', scope: t('mcast_ref.reserved'), usage: '—' },
    { range: '239.192.0.0/10', scope: t('mcast_ref.org_local'), usage: t('mcast_ref.org_wide'), highlight: true },
    { range: '239.255.0.0/16', scope: t('mcast_ref.site_local'), usage: t('mcast_ref.site_restricted'), highlight: true },
  ], [t]);

  const appPorts = useMemo(() => [
    { proto: 'RTP / RTCP', ports: t('mcast_ref.data.port_even'), desc: t('mcast_ref.data.port_media') },
    { proto: 'SAP', ports: '9875', desc: t('mcast_ref.data.port_sap') },
    { proto: 'PTP', ports: '319, 320', desc: t('mcast_ref.data.port_ptp') }
  ], [t]);

  const protocolFeatures = useMemo(() => [
    { feature: t('mcast_ref.source_filtering'), igmpv1: t('common.no'), igmpv2: t('common.no'), igmpv3: `${t('common.yes')} (SSM)`, mldv1: t('common.no'), mldv2: t('common.yes') },
    { feature: t('mcast_ref.leave_msg'), igmpv1: t('common.no'), igmpv2: t('common.yes'), igmpv3: t('common.yes'), mldv1: t('common.yes'), mldv2: t('common.yes') },
    { feature: t('mcast_ref.leave_latency'), igmpv1: `~${t('mcast_ref.full_timeout')}`, igmpv2: t('mcast_ref.data.approx_3s'), igmpv3: t('mcast_ref.data.approx_3s'), mldv1: t('mcast_ref.data.approx_3s'), mldv2: t('mcast_ref.data.approx_3s') },
    { feature: t('mcast_ref.rfc'), igmpv1: '1112', igmpv2: '2236', igmpv3: '3376', mldv1: '2710', mldv2: '3810' }
  ], [t]);

  const pimModes = useMemo(() => [
    { mode: 'PIM-SM', rp: t('common.yes'), discovery: t('mcast_ref.data.rp_based'), bestFor: t('mcast_ref.data.pim_gen'), scaling: t('mcast_ref.data.pim_med') },
    { mode: 'PIM-SSM', rp: t('common.no'), discovery: t('mcast_ref.data.pim_recv'), bestFor: t('mcast_ref.data.one_to_many'), scaling: t('mcast_ref.data.pim_high'), highGreen: true },
    { mode: 'BIDIR-PIM', rp: t('common.yes'), discovery: t('mcast_ref.data.pim_built'), bestFor: t('mcast_ref.data.many_to_many'), scaling: t('mcast_ref.data.pim_vhigh'), highCyan: true }
  ], [t]);

  const q = search.toLowerCase().trim();

  // 1. Well-Known Addresses
  const filteredWellKnown = useMemo(() => {
    return allEntries.filter(e => {
      const mSearch = !q || e.addr.toLowerCase().includes(q) || e.proto.toLowerCase().includes(q) || e.desc.toLowerCase().includes(q) || (e.rfc && e.rfc.toLowerCase().includes(q));
      const mVer = filterVer === 'All' || (filterVer === 'IPv4' && e.ver === 4) || (filterVer === 'IPv6' && e.ver === 6);
      return mSearch && mVer;
    });
  }, [allEntries, q, filterVer]);

  // 2. IPv4 Blocks
  const filteredBlocks = useMemo(() => {
    if (filterVer === 'IPv6') return [];
    return Multicast.IPV4_BLOCKS.filter(b => {
      return !q || b.range.toLowerCase().includes(q) || b.name.toLowerCase().includes(q) || b.scope.toLowerCase().includes(q) || (b.rfc && b.rfc.toLowerCase().includes(q));
    });
  }, [q, filterVer]);

  // 3. TTL Scope Thresholds
  const filteredTtl = useMemo(() => {
    return Multicast.TTL_THRESHOLDS.filter(t => {
      return !q || t.ttl.toString().includes(q) || t.scope.toLowerCase().includes(q);
    });
  }, [q]);

  // 4. IPv6 Scopes
  const filteredIpv6Scopes = useMemo(() => {
    if (filterVer === 'IPv4') return [];
    return Multicast.IPv6_SCOPES.filter(s => {
      return !q || s.value.toString().includes(q) || `0x${s.value.toString(16)}`.includes(q) || s.name.toLowerCase().includes(q) || (s.rfc && s.rfc.toLowerCase().includes(q));
    });
  }, [q, filterVer]);

  // 5. Protocol Comparison
  const filteredProtocolFeatures = useMemo(() => {
    const isIgmpMatch = 'igmp'.includes(q);
    const isMldMatch = 'mld'.includes(q);
    const matchesGeneral = !q || isIgmpMatch || isMldMatch;

    if (matchesGeneral) return protocolFeatures;
    
    return protocolFeatures.filter(f => {
      return f.feature.toLowerCase().includes(q) ||
             f.igmpv1.toLowerCase().includes(q) ||
             f.igmpv2.toLowerCase().includes(q) ||
             f.igmpv3.toLowerCase().includes(q) ||
             f.mldv1.toLowerCase().includes(q) ||
             f.mldv2.toLowerCase().includes(q);
    });
  }, [protocolFeatures, q]);

  // 6. PIM Decision
  const filteredPimModes = useMemo(() => {
    const matchesGeneral = !q || 'pim'.includes(q);
    if (matchesGeneral) return pimModes;
    
    return pimModes.filter(p => {
      return p.mode.toLowerCase().includes(q) ||
             p.rp.toLowerCase().includes(q) ||
             p.discovery.toLowerCase().includes(q) ||
             p.bestFor.toLowerCase().includes(q) ||
             p.scaling.toLowerCase().includes(q);
    });
  }, [pimModes, q]);

  // 7. RPF Check
  const showRpf = useMemo(() => {
    if (!q) return true;
    const rpfText = `${t('mcast_ref.rpf_title')} ${t('mcast_ref.rpf_desc', {rpf: 'RPF'})} ${t('mcast_ref.the_check')} ${t('mcast_ref.the_check_desc', {source: 'IP'})} ${t('mcast_ref.failure_cause')} ${t('mcast_ref.failure_desc')}`.toLowerCase();
    return rpfText.includes(q);
  }, [q, t]);

  // 8. Admin Scoped Blocks
  const filteredAdminScoped = useMemo(() => {
    if (filterVer === 'IPv6') return [];
    return adminScopedBlocks.filter(b => {
      return !q || b.range.toLowerCase().includes(q) || b.scope.toLowerCase().includes(q) || b.usage.toLowerCase().includes(q);
    });
  }, [adminScopedBlocks, q, filterVer]);

  // 9. App Ports
  const filteredAppPorts = useMemo(() => {
    return appPorts.filter(p => {
      return !q || p.proto.toLowerCase().includes(q) || p.ports.toLowerCase().includes(q) || p.desc.toLowerCase().includes(q);
    });
  }, [appPorts, q]);

  const hasMatches = filteredWellKnown.length > 0 ||
                     filteredBlocks.length > 0 ||
                     filteredTtl.length > 0 ||
                     filteredIpv6Scopes.length > 0 ||
                     filteredProtocolFeatures.length > 0 ||
                     filteredPimModes.length > 0 ||
                     showRpf ||
                     filteredAdminScoped.length > 0 ||
                     filteredAppPorts.length > 0;

  return (
    <div className="fadein">
      {/* Search & Filter Controls Card */}
      <div className="card fadein">
        <div className="input-row">
          <input className="input" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('mcast_ref.search_placeholder')} />
          <select className="select" value={filterVer} onChange={e => setFilterVer(e.target.value)} style={{width:'auto',flexShrink:0}}>
            {['All','IPv4','IPv6'].map(v => <option key={v} value={v}>{v === 'All' ? t('mcast_ref.filter_all') : v}</option>)}
          </select>
        </div>
      </div>

      {/* Well-Known Addresses Card */}
      {filteredWellKnown.length > 0 && (
        <div className="card fadein">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', flexWrap:'wrap', gap: 12, marginBottom:16}}>
            <div className="card-title" style={{margin:0}}>{t('mcast_ref.well_known')}</div>
            <div className="hint">{t('mcast_ref.entries_shown', {count: filteredWellKnown.length})}</div>
          </div>
          <div className="table-wrap hide-mobile" style={{maxHeight:360,overflowY:'auto'}}>
            <table>
              <thead><tr><th>{t('mcast_ref.address')}</th><th>{t('mcast_ref.protocol')}</th><th>{t('mcast_ref.description')}</th><th>{t('mcast_ref.rfc')}</th><th></th></tr></thead>
              <tbody>
                {filteredWellKnown.map((e, i) => (
                  <tr key={i}>
                    <td style={{color:'var(--cyan)',fontFamily:'var(--mono)',fontWeight:600,whiteSpace:'nowrap'}}>{e.addr}</td>
                    <td><span className={'badge ' + (e.ver===4?'badge-blue':'badge-purple')}>{e.proto}</span></td>
                    <td style={{fontFamily:'var(--sans)',color:'var(--muted)'}}>{t('mcast_ref.data.desc_' + e.proto.toLowerCase().replace(/[^a-z0-9]/g, '_'), e.desc)}</td>
                    <td style={{color:'var(--dim)',fontSize:12}}><RFCLink rfc={e.rfc} /></td>
                    <td><CopyBtn text={e.addr} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile View */}
          <div className="show-mobile mobile-cards" style={{maxHeight:400, overflowY:'auto'}}>
            {filteredWellKnown.map((e, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.address')}</span>
                  <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{e.addr}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.protocol')}</span>
                  <span className={`badge ${e.ver===4?'badge-blue':'badge-purple'}`} style={{fontSize:10}}>{e.proto}</span>
                </div>
                <div className="mobile-card-row" style={{flexDirection:'column', alignItems:'flex-start', borderBottom:'none'}}>
                  <span className="mobile-card-label" style={{marginBottom:4}}>{t('mcast_ref.description')}</span>
                  <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{t('mcast_ref.data.desc_' + e.proto.toLowerCase().replace(/[^a-z0-9]/g, '_'), e.desc)}</span>
                </div>
                <div style={{marginTop:8, display:'flex', justifyContent:'flex-end'}}>
                  <CopyBtn text={e.addr} label={t('mcast_ref.copy_addr')} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* IPv4 Blocks */}
      {filteredBlocks.length > 0 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_ref.ipv4_blocks')}</div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>{t('mcast_ref.range')}</th><th>{t('mcast_ref.name')}</th><th>{t('mcast_ref.scope')}</th><th>{t('mcast_ref.ttl')}</th><th>{t('mcast_ref.rfc')}</th></tr></thead>
              <tbody>
                {filteredBlocks.map((b, i) => (
                  <tr key={i}>
                    <td style={{color:'var(--cyan)',fontFamily:'var(--mono)',fontSize:12,whiteSpace:'nowrap'}}>{b.range}</td>
                    <td style={{fontFamily:'var(--sans)',fontWeight:500}}>{t('mcast_ref.data.block_' + b.name.toLowerCase().replace(/[^a-z0-9]/g, '_'), b.name)}</td>
                    <td><span className="badge badge-blue">{t('common.scopes.' + b.scope.toLowerCase().replace(/[^a-z0-9]/g, '_'), b.scope)}</span></td>
                    <td style={{color:'var(--yellow)',fontFamily:'var(--mono)'}}>{b.ttl || t('mcast_ref.varies')}</td>
                    <td style={{color:'var(--dim)',fontSize:12}}>{b.rfc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="show-mobile mobile-cards">
            {filteredBlocks.map((b, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.range')}</span>
                  <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{b.range}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.name')}</span>
                  <span className="mobile-card-value" style={{fontWeight:500}}>{b.name}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.scope')} / {t('mcast_ref.ttl')}</span>
                  <span className="mobile-card-value">{b.scope} / {b.ttl || t('mcast_ref.varies')}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TTL Scope Thresholds */}
      {filteredTtl.length > 0 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_ref.ttl_thresholds')}</div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>{t('mcast_ref.ttl')}</th><th>{t('mcast_ref.scope')}</th></tr></thead>
              <tbody>
                {filteredTtl.map((thr, i) => (
                  <tr key={i}>
                    <td style={{fontFamily:'var(--mono)',fontWeight:600,color:thr.color}}>{thr.ttl}</td>
                    <td style={{fontFamily:'var(--sans)'}}>{t('mcast_ref.data.ttl_' + thr.ttl, thr.scope)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="show-mobile mobile-cards">
            {filteredTtl.map((thr, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.ttl')}</span>
                  <span className="mobile-card-value" style={{fontWeight:600, color:thr.color}}>{thr.ttl}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.scope')}</span>
                  <span className="mobile-card-value">{t('mcast_ref.data.ttl_' + thr.ttl, thr.scope)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* IPv6 Scope Values */}
      {filteredIpv6Scopes.length > 0 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_ref.ipv6_scope_values')}</div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>{t('mcast_ref.value_hex')}</th><th>{t('common.th_hex')}</th><th>{t('mcast_ref.scope_name')}</th><th>{t('mcast_ref.rfc')}</th></tr></thead>
              <tbody>
                {filteredIpv6Scopes.map((s, i) => (
                  <tr key={i}>
                    <td style={{fontFamily:'var(--mono)',fontWeight:600,color:'var(--cyan)'}}>{s.value}</td>
                    <td style={{fontFamily:'var(--mono)',color:'var(--dim)'}}>0x{s.value.toString(16).padStart(2,'0')}</td>
                    <td style={{fontFamily:'var(--sans)',fontWeight:500}}>{t('common.scopes.' + s.name.toLowerCase().replace(/[^a-z0-9]/g, '_'), s.name)}</td>
                    <td style={{color:'var(--dim)',fontSize:12}}>{s.rfc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="show-mobile mobile-cards">
            {filteredIpv6Scopes.map((s, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.value_hex')}</span>
                  <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{s.value} (0x{s.value.toString(16).padStart(2,'0')})</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.scope_name')}</span>
                  <span className="mobile-card-value" style={{fontWeight:500}}>{s.name}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Protocol Comparison */}
      {filteredProtocolFeatures.length > 0 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_ref.protocol_comparison')}</div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>{t('mcast_ref.feature')}</th><th>IGMPv1</th><th>IGMPv2</th><th>IGMPv3</th><th>MLDv1</th><th>MLDv2</th></tr></thead>
              <tbody>
                {filteredProtocolFeatures.map((f, i) => (
                  <tr key={i}>
                    <td>{f.feature}</td>
                    <td>{f.igmpv1}</td>
                    <td>{f.igmpv2}</td>
                    <td style={{color: f.igmpv3.includes(t('common.yes')) ? 'var(--green)' : 'inherit'}}>{f.igmpv3}</td>
                    <td>{f.mldv1}</td>
                    <td style={{color: f.mldv2.includes(t('common.yes')) ? 'var(--green)' : 'inherit'}}>{f.mldv2}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="show-mobile mobile-cards">
            {[
              {v:'IGMPv1', sf: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.source_filtering'))?.igmpv1, lm: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_msg'))?.igmpv1, lat: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_latency'))?.igmpv1, rfc: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.rfc'))?.igmpv1},
              {v:'IGMPv2', sf: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.source_filtering'))?.igmpv2, lm: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_msg'))?.igmpv2, lat: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_latency'))?.igmpv2, rfc: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.rfc'))?.igmpv2},
              {v:'IGMPv3', sf: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.source_filtering'))?.igmpv3, lm: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_msg'))?.igmpv3, lat: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_latency'))?.igmpv3, rfc: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.rfc'))?.igmpv3},
              {v:'MLDv1', sf: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.source_filtering'))?.mldv1, lm: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_msg'))?.mldv1, lat: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_latency'))?.mldv1, rfc: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.rfc'))?.mldv1},
              {v:'MLDv2', sf: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.source_filtering'))?.mldv2, lm: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_msg'))?.mldv2, lat: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.leave_latency'))?.mldv2, rfc: filteredProtocolFeatures.find(f=>f.feature===t('mcast_ref.rfc'))?.mldv2}
            ].filter(p => p.sf !== undefined || p.lm !== undefined || p.lat !== undefined || p.rfc !== undefined).map(p => (
              <div key={p.v} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.version')}</span>
                  <span className="mobile-card-value" style={{fontWeight:600}}>{p.v}</span>
                </div>
                {p.sf !== undefined && (
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('mcast_ref.source_filtering')}</span>
                    <span className="mobile-card-value" style={{color:p.sf.includes(t('common.yes'))?'var(--green)':'var(--muted)'}}>{p.sf}</span>
                  </div>
                )}
                {(p.lm !== undefined || p.lat !== undefined) && (
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('mcast_ref.leave_msg_lat')}</span>
                    <span className="mobile-card-value">{p.lm} / {p.lat}</span>
                  </div>
                )}
                {p.rfc !== undefined && (
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('mcast_ref.rfc')}</span>
                    <span className="mobile-card-value">{p.rfc}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* PIM Protocol Decision Guide */}
      {filteredPimModes.length > 0 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_ref.pim_decision')}</div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>{t('mcast_ref.mode')}</th><th>{t('mcast_ref.rp_needed')}</th><th>{t('mcast_ref.source_discovery')}</th><th>{t('mcast_ref.best_for')}</th><th>{t('mcast_ref.scaling')}</th></tr></thead>
              <tbody>
                {filteredPimModes.map((p, i) => (
                  <tr key={i}>
                    <td>{p.mode}</td>
                    <td>{p.rp}</td>
                    <td>{p.discovery}</td>
                    <td>{p.bestFor}</td>
                    <td style={{color: p.highGreen ? 'var(--green)' : p.highCyan ? 'var(--cyan)' : 'inherit'}}>{p.scaling}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="show-mobile mobile-cards">
            {filteredPimModes.map((p, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.mode_rp')}</span>
                  <span className="mobile-card-value" style={{fontWeight:600}}>{p.mode} ({p.rp === t('common.yes') ? t('mcast_ref.rp_needed') : t('mcast_ref.no_rp')})</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.best_for')}</span>
                  <span className="mobile-card-value">{p.bestFor}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.scaling')}</span>
                  <span className="mobile-card-value" style={{color: p.highGreen ? 'var(--green)' : p.highCyan ? 'var(--cyan)' : 'inherit'}}>{p.scaling}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reverse Path Forwarding (RPF) */}
      {showRpf && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_ref.rpf_title')}</div>
          <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
            {t('mcast_ref.rpf_desc', {rpf: <strong style={{color:'var(--text)'}}>RPF</strong>})}
            <br/><br/>
            <strong style={{color:'var(--text)'}}>{t('mcast_ref.the_check')}</strong> {t('mcast_ref.the_check_desc', {source: <strong style={{color:'var(--text)'}}>{t('mcast_ref.source_filtering').split(' ')[0]} IP</strong>})}
            <br/><br/>
            <strong style={{color:'var(--red)'}}>{t('mcast_ref.failure_cause')}</strong> {t('mcast_ref.failure_desc')}
          </div>
        </div>
      )}

      {/* Admin-Scoped Boundary */}
      {filteredAdminScoped.length > 0 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_ref.admin_scoped')}</div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>{t('mcast_ref.range')}</th><th>{t('mcast_ref.scope')}</th><th>{t('mcast_ref.usage')}</th></tr></thead>
              <tbody>
                {filteredAdminScoped.map((b, i) => (
                  <tr key={i}>
                    <td style={{color: b.highlight ? 'var(--cyan)' : 'inherit'}}>{b.range}</td>
                    <td>{b.scope}</td>
                    <td>{b.usage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="show-mobile mobile-cards">
            {filteredAdminScoped.map((b, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.range')}</span>
                  <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{b.range}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_ref.scope')}</span>
                  <span className="mobile-card-value">{b.scope} {b.usage !== '—' ? `(${b.usage})` : ''}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Common Application Ports */}
      {filteredAppPorts.length > 0 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_ref.app_ports')}</div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>{t('mcast_ref.protocol')}</th><th>{t('mcast_ref.default_ports')}</th><th>{t('mcast_ref.description')}</th></tr></thead>
              <tbody>
                {filteredAppPorts.map((m, i) => (
                  <tr key={i}>
                    <td style={{fontWeight:500}}>{m.proto}</td>
                    <td>{m.ports}</td>
                    <td>{m.desc}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="show-mobile mobile-cards">
            {filteredAppPorts.map((m, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{m.proto}</span>
                  <span className="mobile-card-value" style={{fontWeight:600}}>{m.ports}</span>
                </div>
                <div className="mobile-card-row" style={{borderBottom:'none'}}>
                  <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{m.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {!hasMatches && search.trim() && (
        <div className="card fadein" style={{color:'var(--dim)', fontSize:13, fontStyle:'italic', textAlign:'center', padding:'24px'}}>
          {t('common.no_results')}
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: McastIpMacMap ────────────────────────────────────────────
function McastIpMacMapSection({ initialData, onShare }) {
  const { t } = useTranslation();
  const MODE_DEFAULTS = {
    'ip4-to-mac': '239.1.2.3',
    'mac-to-ip4': '01:00:5E:01:02:03',
    'ip6-to-mac': 'ff02::1',
    'range-map': '239.1.0.0/24',
  };
  const MODE_LABELS = {
    'ip4-to-mac': t('mcast_map.mode_ip4_mac', 'IPv4 → MAC'),
    'mac-to-ip4': t('mcast_map.mode_mac_ip4', 'MAC → IPv4'),
    'ip6-to-mac': t('mcast_map.mode_ip6_mac', 'IPv6 → MAC'),
    'range-map': t('mcast_map.mode_range_map', 'Range Map')
  };
  const MODE_PRESETS = {
    'ip4-to-mac': [['224.0.0.1','All Hosts'],['224.0.0.5','OSPF'],['224.0.0.251','mDNS'],['232.1.2.3','SSM'],['239.255.255.250','SSDP']],
    'mac-to-ip4': [['01:00:5E:00:00:01','All Hosts'],['01:00:5E:00:00:05','OSPF'],['01:00:5E:00:00:FC','SSDP'],['01:00:5E:7F:FF:FA','239.255.255.250']],
    'ip6-to-mac': [['ff02::1','All Nodes'],['ff02::2','All Routers'],['ff02::fb','mDNS'],['ff05::1:3','DHCP']],
    'range-map': [['239.1.0.0/24','/24 block'],['232.0.0.0/16','SSM /16'],['239.255.255.0/28','/28 block']],
  };

  const [mode, setMode] = usePersistentState('mcast-map:mode', initialData?.mode ?? 'ip4-to-mac');
  const [input, setInput] = usePersistentState('mcast-map:input', initialData?.input ?? '239.1.2.3');
  const [result, setResult] = usePersistentState('mcast-map:result', null);
  const [err, setErr] = useState('');

  const parseMac = (s) => {
    const clean = s.replace(/[:\-\.]/g, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(clean)) return null;
    return clean;
  };

  const switchMode = (m) => {
    setMode(m);
    setInput(MODE_DEFAULTS[m]);
    setResult(null);
    setErr('');
  };

  const calc = useCallback(() => {
    setErr(''); setResult(null);
    if (mode === 'ip4-to-mac') {
      const ip = IPv4.parse(input);
      if (ip === null) { setErr(t('mcast_map.err_ip4')); return; }
      const a = (ip >>> 24) & 0xFF;
      const isMcast = a >= 224 && a <= 239;
      const mac = Multicast.ipv4ToMac(ip);
      const low23 = ip & 0x007FFFFF;
      const cls = Multicast.classifyIPv4(ip);
      setResult({ version: 4, ip: IPv4.str(ip), mac, isMcast, low23, low23Bin: low23.toString(2).padStart(23,'0'), scope: cls ? cls.scope : '-', block: cls ? cls.block : '-', rfc: cls ? cls.rfc : '-', description: cls ? cls.description : '-' });
    } else if (mode === 'mac-to-ip4') {
      const clean = parseMac(input);
      if (!clean) { setErr(t('mcast_collision.err_invalid_mac')); return; }
      const ips = Multicast.macToIpv4Set(input);
      if (!ips) { setErr(t('mcast_collision.err_invalid_mac')); return; }
      setResult({ version: 'mac', mac: clean.match(/.{2}/g).join(':'), ips });
    } else if (mode === 'range-map') {
      const c = IPv4.parseCIDR(input);
      if (!c) { setErr(t('mcast_map.err_invalid_cidr')); return; }
      const a = (c.ip >>> 24) & 0xFF;
      if (a < 224 || a > 239) { setErr(t('mcast_analyze.err_ip4')); return; }
      const sn = IPv4.subnet(c.ip, c.prefix);
      const totalHosts = sn.totalHosts;
      const maxShow = 256;
      const showAll = totalHosts <= maxShow;
      const macFirst = Multicast.ipv4ToMac(sn.network);
      const macLast = Multicast.ipv4ToMac(sn.broadcast);
      const entries = [];
      const limit = showAll ? totalHosts : Math.min(totalHosts, 20);
      for (let i = 0; i < limit; i++) {
        const addr = (sn.network + i) >>> 0;
        entries.push({ ip: IPv4.str(addr), mac: Multicast.ipv4ToMac(addr) });
      }
      setResult({ version: 'range', cidr: sn.cidr, totalHosts, showAll, macFirst, macLast, entries });
    } else {
      const expanded = IPv6.expand(input);
      if (!expanded) { setErr(t('mcast_analyze.err_v6')); return; }
      if (!expanded.startsWith('ff')) { setErr(t('mcast_analyze.err_v6')); return; }
      const mac = Multicast.ipv6ToMac(expanded);
      const groups = expanded.split(':').map(g => parseInt(g, 16));
      const last32 = ((groups[6] << 16) | groups[7]) >>> 0;
      const cls = Multicast.classifyIPv6(expanded);
      setResult({ version: 6, expanded, compressed: IPv6.compress(input), mac, last32Hex: last32.toString(16).padStart(8,'0'), scopeName: cls ? cls.scopeName : '-', flagT: cls ? cls.flagT : false, flagP: cls ? cls.flagP : false });
    }
  }, [mode, input, t]);

  useEffect(() => {
    if (initialData?.subTab === 'ip_mac') {
      if (initialData.mode !== undefined) setMode(initialData.mode);
      if (initialData.input !== undefined) setInput(initialData.input);
    }
    calc();
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (input) (e.detail?.respond ?? onShare)({ tool: 'mcast-toolkit', activeTab: 'calculators', subTab: 'ip_mac', mode, input });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [mode, input, onShare]);

  const labelFor = (m) => m === 'ip4-to-mac' ? t('mcast_map.ipv4_addr') : m === 'mac-to-ip4' ? t('mcast_map.eth_mac') : m === 'range-map' ? t('cheatsheet.cidr') : t('mcast_map.ipv6_addr');

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('glop.mode')}</div>
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          {[['ip4-to-mac','IPv4 → MAC'],['mac-to-ip4','MAC → IPv4'],['ip6-to-mac','IPv6 → MAC'],['range-map','Range Map']].map(([v,l]) => (
            <button key={v} className={`btn btn-sm ${mode===v?'btn-primary':'btn-ghost'}`} onClick={() => switchMode(v)}>{l}</button>
          ))}
        </div>
        <div className="field">
          <label className="label">{labelFor(mode)}</label>
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key==='Enter' && calc()} placeholder={MODE_DEFAULTS[mode]} />
            <button className="btn btn-primary" onClick={calc}>{t('mcast_map.mapping_result').split(' ')[0]}</button>
          </div>
          <Err msg={err} />
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
          {(MODE_PRESETS[mode] || []).map(([val, lbl]) => (
            <button key={val} className="btn btn-ghost btn-sm" onClick={() => { setInput(val); setTimeout(calc,0); }}>{lbl}</button>
          ))}
        </div>
      </div>

      {result && result.version === 4 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_map.mapping_result')}</div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
            <CopyBtn text={`${t('mcast_map.ipv4_addr')}: ${result.ip}\n${t('mcast_map.eth_mac')}: ${result.mac}\n${t('mcast_map.is_mcast')}: ${result.isMcast ? t('mcast_map.yes_class_d') : t('mcast_map.no')}\n${t('mcast_map.scope')}: ${result.scope}\n${t('mcast_map.block')}: ${result.block}\n${t('mcast_map.rfc')}: ${result.rfc}`} label="copy_all" id="mcast4-copy-all" />
          </div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('mcast_map.ipv4_addr')} value={result.ip} accent />
            <ResultItem label={t('mcast_map.eth_mac')} value={result.mac} green />
            <ResultItem label={t('mcast_map.is_mcast')} value={result.isMcast ? t('mcast_map.yes_class_d') : t('mcast_map.no')} red={!result.isMcast} />
            <ResultItem label={t('mcast_map.scope')} value={result.scope} />
            <ResultItem label={t('mcast_map.block')} value={result.block} />
            <ResultItem label={t('mcast_map.rfc')} value={result.rfc} />
          </div>
          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'12px 14px',marginTop:12,overflowX:'auto'}}>
            <div className="hint" style={{marginBottom:8,fontWeight:600}}>{t('mcast_map.bit_level_map')}</div>
            <div style={{fontFamily:'var(--mono)',fontSize:11,letterSpacing:1,lineHeight:2,whiteSpace:'nowrap'}}>
              <div>
                <span style={{color:'var(--muted)',display:'inline-block',width:36}}>{t('mcast_map.ip')} </span>
                {(() => {
                  const bin = IPv4.toBinary(IPv4.parse(result.ip));
                  return bin.split('').map((ch, i) => {
                    const isDot = ch === '.';
                    const pos = isDot ? -1 : (() => { let p = 0; for (let j = 0; j < i; j++) if (bin[j] !== '.') p++; return p; })();
                    const isLow = pos >= 9;
                    return <span key={i} style={{color: isDot ? 'var(--border)' : isLow ? 'var(--cyan)' : 'var(--dim)'}}>{ch}</span>;
                  });
                })()}
              </div>
              <div>
                <span style={{color:'var(--muted)',display:'inline-block',width:36}}>{t('mcast_map.mac')}</span>
                {(() => {
                  const macBytes = result.mac.split(':');
                  return macBytes.map((b, bi) => {
                    const bits = parseInt(b, 16).toString(2).padStart(8, '0');
                    const isPrefix = bi < 3;
                    return <span key={bi}>{bits.split('').map((bit, j) => (
                      <span key={j} style={{color: isPrefix ? 'var(--dim)' : 'var(--cyan)'}}>{bit}</span>
                    ))}{bi < 5 && <span style={{color:'var(--border)'}}>:</span>}</span>;
                  });
                })()}
              </div>
            </div>
            <div className="hint" style={{marginTop:8}}>{t('mcast_map.mac_hint', {prefix: <span style={{color:'var(--cyan)'}}>01:00:5E:0x</span>})}</div>
          </div>
        </div>
      )}

      {result && result.version === 'mac' && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_map.reverse_lookup')}</div>
          <div className="hint" style={{marginBottom:8}}>{t('mcast_map.reverse_hint')}</div>
          <div className="table-wrap hide-mobile">
            <table><thead><tr><th>#</th><th>{t('mcast_map.ip')} Address</th><th>{t('mcast_map.scope')}</th><th></th></tr></thead>
            <tbody>
              {result.ips.map((ip, i) => {
                const cls = Multicast.classifyIPv4(IPv4.parse(ip));
                return (
                  <tr key={i}>
                    <td style={{color:'var(--dim)'}}>{i+1}</td>
                    <td style={{color:'var(--cyan)',fontFamily:'var(--mono)'}}>{ip}</td>
                    <td style={{fontSize:12}}><span className={`badge ${cls && cls.isSSM ? 'badge-green' : cls && cls.scope === 'Link-Local' ? 'badge-yellow' : 'badge-blue'}`}>{cls ? cls.scope : '-'}</span></td>
                    <td><CopyBtn text={ip} /></td>
                  </tr>
                );
              })}
            </tbody></table>
          </div>
          {/* Mobile View */}
          <div className="show-mobile mobile-cards">
            {result.ips.map((ip, i) => {
              const cls = Multicast.classifyIPv4(IPv4.parse(ip));
              return (
                <div key={i} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('mcast_map.ip')} #{i+1}</span>
                    <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{ip}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('mcast_map.scope')}</span>
                    <span className="mobile-card-value">{cls ? cls.scope : '-'}</span>
                  </div>
                  <div style={{marginTop:8, display:'flex', justifyContent:'flex-end'}}>
                    <CopyBtn text={ip} label={t('mcast_map.copy_ip')} />
                  </div>
                </div>
              );
            })}
          </div>
          <div className="btn-row">
            <CopyBtn text={result.ips.join('\n')} label="copy_all" id="mcast4-ips-copy-all" />
            <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(result.ips.map((ip,i) => { const c = Multicast.classifyIPv4(IPv4.parse(ip)); return {index:i+1,ip,scope:c?c.scope:'-',block:c?c.block:'-'}; }),'mcast-mac-ips.csv')}>{t('common.export_csv')}</button>
          </div>
        </div>
      )}

      {result && result.version === 6 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_map.mapping_result')}</div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
            <CopyBtn text={`${t('mcast_map.ipv6_addr')}: ${result.compressed}\n${t('mcast_map.expanded')}: ${result.expanded}\n${t('mcast_map.eth_mac')}: ${result.mac}\n${t('mcast_map.scope')}: ${result.scopeName}\n${t('mcast_map.temp')}: ${result.flagT ? t('mac.yes') : t('mcast_map.permanent')}\n${t('mcast_map.prefix_based')}: ${result.flagP ? t('mac.yes') : t('mac.no')}`} label="copy_all" id="mcast6-copy-all" />
          </div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('mcast_map.ipv6_addr')} value={result.compressed} accent />
            <ResultItem label={t('mcast_map.expanded')} value={result.expanded} />
            <ResultItem label={t('mcast_map.eth_mac')} value={result.mac} green />
            <ResultItem label={t('mcast_map.scope')} value={result.scopeName} />
            <ResultItem label={t('mcast_map.temp')} value={result.flagT ? t('mac.yes') : t('mcast_map.permanent')} />
            <ResultItem label={t('mcast_map.prefix_based')} value={result.flagP ? t('mac.yes') : t('mac.no')} />
          </div>
          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'12px 14px',marginTop:12}}>
            <div className="hint" style={{marginBottom:8,fontWeight:600}}>{t('mcast_map.bit_level_map_v6')}</div>
            <div style={{fontFamily:'var(--mono)',fontSize:11,letterSpacing:1,lineHeight:2}}>
              <div>
                <span style={{color:'var(--muted)',display:'inline-block',width:36}}>v6 </span>
                {(() => {
                  const hex = result.expanded.replace(/:/g, '');
                  return <span>{hex.slice(0,24).split('').map((c,i) => <span key={i} style={{color:'var(--dim)'}}>{c}</span>)}<span style={{color:'var(--border)'}}>|</span>{hex.slice(24).split('').map((c,i) => <span key={i+100} style={{color:'var(--cyan)'}}>{c}</span>)}</span>;
                })()}
              </div>
              <div>
                <span style={{color:'var(--muted)',display:'inline-block',width:36}}>{t('mcast_map.mac')}</span>
                <span style={{color:'var(--dim)'}}>33:33:</span><span style={{color:'var(--cyan)'}}>{result.last32Hex.slice(0,2)}:{result.last32Hex.slice(2,4)}:{result.last32Hex.slice(4,6)}:{result.last32Hex.slice(6,8)}</span>
              </div>
            </div>
            <div className="hint" style={{marginTop:8}}>{t('mcast_map.v6_hint', {prefix: <span style={{color:'var(--cyan)'}}>33:33</span>, rfc: <RFCLink rfc="RFC 2464" />})}</div>
          </div>
        </div>
      )}

      {result && result.version === 'range' && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_map.range_map_title', {cidr: result.cidr})}</div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
            <CopyBtn text={`${t('cheatsheet.cidr')}: ${result.cidr}\n${t('mcast_map.total_addr')}: ${result.totalHosts.toLocaleString()}\n${t('mcast_map.first_mac')}: ${result.macFirst}\n${t('mcast_map.last_mac')}: ${result.macLast}`} label="copy_all" id="mcastrange-copy-all" />
          </div>
          <div className="result-grid grid-mobile-1" style={{marginBottom:12}}>
            <ResultItem label={t('cheatsheet.cidr')} value={result.cidr} accent />
            <ResultItem label={t('mcast_map.total_addr')} value={result.totalHosts.toLocaleString()} />
            <ResultItem label={t('mcast_map.first_mac')} value={result.macFirst} green />
            <ResultItem label={t('mcast_map.last_mac')} value={result.macLast} green />
            {result.macFirst === result.macLast
              ? <ResultItem label={t('mcast_map.overlap')} value={t('mcast_map.overlap_desc')} red />
              : <ResultItem label={t('mcast_map.unique_macs_val')} value={(result.totalHosts > 32 ? result.totalHosts : 'Up to ' + result.totalHosts).toString()} />
            }
          </div>
          {!result.showAll && <div className="hint" style={{marginBottom:8}}>{t('mcast_map.range_hint', {count: result.totalHosts.toLocaleString(), max: 256})}</div>}
          <div className="table-wrap hide-mobile">
            <table><thead><tr><th>#</th><th>{t('mcast_map.ip')} Address</th><th>{t('mcast_map.eth_mac')}</th><th></th></tr></thead>
            <tbody>
              {result.entries.map((e, i) => (
                <tr key={i}>
                  <td style={{color:'var(--dim)'}}>{i+1}</td>
                  <td style={{color:'var(--cyan)',fontFamily:'var(--mono)'}}>{e.ip}</td>
                  <td style={{color:'var(--green)',fontFamily:'var(--mono)'}}>{e.mac}</td>
                  <td><CopyBtn text={e.mac} /></td>
                </tr>
              ))}
            </tbody></table>
          </div>
          {/* Mobile View */}
          <div className="show-mobile mobile-cards">
            {result.entries.map((e, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_map.ip')}: {e.ip}</span>
                  <span className="mobile-card-value" style={{color:'var(--green)', fontWeight:600}}>{e.mac}</span>
                </div>
                <div style={{marginTop:8, display:'flex', justifyContent:'flex-end'}}>
                  <CopyBtn text={e.mac} label={t('mcast_map.copy_mac')} />
                </div>
              </div>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost btn-sm" onClick={() => {
              const rows = [];
              for (let i = 0; i < result.totalHosts && i < 65536; i++) {
                const addr = (IPv4.parse(result.cidr.split('/')[0]) + i) >>> 0;
                rows.push({ip:IPv4.str(addr),mac:Multicast.ipv4ToMac(addr)});
              }
              exportCSV(rows,'mcast-range-map.csv');
            }}>{t('mcast_map.export_csv_limit', {limit: result.totalHosts > 65536 ? '(first 65K)' : ''})}</button>
            <CopyBtn text={result.entries.map(e => e.ip + '\t' + e.mac).join('\n')} label="copy_all" id="mcastrange-table-copy-all" />
          </div>
        </div>
      )}

      <div className="card fadein" style={{marginTop: result ? 0 : undefined}}>
        <div className="card-title">{t('mcast_map.how_mapping_works')}</div>
        <div className="table-wrap hide-mobile" style={{marginBottom:12}}>
          <table>
            <thead><tr><th>{t('mcast_map.protocol')}</th><th>{t('mcast_map.mac_prefix')}</th><th>{t('mcast_map.ip_bits')}</th><th>{t('mcast_map.ambiguity')}</th><th>{t('mcast_map.rfc')}</th></tr></thead>
            <tbody>
              <tr>
                <td style={{fontWeight:500}}>{t('mcast_map.ipv4_mcast')}</td>
                <td style={{color:'var(--cyan)',fontFamily:'var(--mono)'}}>01:00:5E:0x:xx:xx</td>
                <td>{t('mcast_map.lower_23')}</td>
                <td style={{color:'var(--yellow)'}}>{t('mcast_map.ambiguity_32')}</td>
                <td style={{color:'var(--dim)'}}><RFCLink rfc="RFC 1112" /></td>
              </tr>
              <tr>
                <td style={{fontWeight:500}}>{t('mcast_map.ipv6_mcast')}</td>
                <td style={{color:'var(--cyan)',fontFamily:'var(--mono)'}}>33:33:xx:xx:xx:xx</td>
                <td>{t('mcast_map.lower_32')}</td>
                <td style={{color:'var(--yellow)'}}>{t('mcast_map.ambiguity_v6')}</td>
                <td style={{color:'var(--dim)'}}><RFCLink rfc="RFC 2464" /></td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards" style={{marginBottom:12}}>
          {[
            {p:t('mcast_map.ipv4_mcast'), pre:'01:00:5E', a:t('mcast_map.ambiguity_32'), rfc:'RFC 1112'},
            {p:t('mcast_map.ipv6_mcast'), pre:'33:33', a:t('mcast_map.ambiguity_v6'), rfc:'RFC 2464'}
          ].map(m => (
            <div key={m.p} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{m.p}</span>
                <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{m.pre}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('mcast_map.ambiguity')} / {t('mcast_map.rfc')}</span>
                <span className="mobile-card-value" style={{color:'var(--yellow)'}}>{m.a} (<RFCLink rfc={m.rfc} />)</span>
              </div>
            </div>
          ))}
        </div>
        <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 14px'}}>
          <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.6}}>
            <strong style={{color:'var(--text)'}}>{t('mcast_map.ipv4_how')}</strong> {t('mcast_map.ipv4_how_desc', {prefix: <code style={{color:'var(--cyan)'}}>01:00:5E</code>})}
            <br/><br/>
            <strong style={{color:'var(--text)'}}>{t('mcast_map.ipv6_how')}</strong> {t('mcast_map.ipv6_how_desc', {prefix: <code style={{color:'var(--cyan)'}}>33:33</code>, count: <strong style={{color:'var(--text)'}}>2^88 potential IP addresses</strong>})}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Sub-component: McastSolicited ───────────────────────────────────────────
function McastSolicitedSection({ initialData, onShare }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('mcast-sol:input', initialData?.input ?? '2001:db8::1234:5678');
  const [result, setResult] = usePersistentState('mcast-sol:result', null);
  const [err, setErr] = useState('');

  const calc = useCallback(() => {
    setErr('');
    const expanded = IPv6.expand(input.trim());
    if (!expanded) { setErr(t('mcast_solicited.err_invalid')); return; }
    const res = Multicast.solicitedNode(expanded);
    setResult({
      original: IPv6.compress(expanded),
      originalExpanded: expanded,
      ...res
    });
  }, [input, t]);

  useEffect(() => {
    if (initialData?.subTab === 'solicited') {
      if (initialData.input !== undefined) setInput(initialData.input);
    }
    calc();
  }, [initialData]);

  useEffect(() => { const t_out = setTimeout(calc, 300); return () => clearTimeout(t_out); }, [input, calc]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (input) (e.detail?.respond ?? onShare)({ tool: 'mcast-toolkit', activeTab: 'calculators', subTab: 'solicited', input });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [input, onShare]);

  const presets = ['fe80::1', '2001:db8::1', '2001:db8:acad::cafe:babe', '::1'];

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('mcast_solicited.title')}</div>
        <div className="field">
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={input} onChange={e => setInput(e.target.value)}
              placeholder={t('mcast_solicited.placeholder')} onKeyDown={e => e.key==='Enter' && calc()} />
            <button className="btn btn-primary" onClick={calc}>{t('mcast_solicited.compute')}</button>
          </div>
          {err && <div className="err-msg">{err}</div>}
        </div>
        <div className="presets">
          {presets.map(p => (
            <span key={p} className="preset-tag" onClick={() => setInput(p)}>{p}</span>
          ))}
        </div>
      </div>

      {result && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_solicited.result_title')}</div>
          <div className="result-grid">
            <ResultItem label={t('mcast_solicited.unicast_addr')} value={result.original} accent />
            <ResultItem label={t('mcast_solicited.solicited_ip')} value={result.solicited} green />
            <ResultItem label={t('mcast_solicited.eth_mac')} value={result.mac} yellow />
          </div>
          <div style={{marginTop:16}}>
            <div className="card-title" style={{fontSize:13}}>{t('mcast_solicited.expanded_forms')}</div>
            <div className="result-grid">
              <ResultItem label={t('mcast_solicited.ip_expanded')} value={result.solicitedExpanded} />
              <ResultItem label={t('mcast_solicited.mac_prefix')} value="33:33:ff" />
            </div>
          </div>
          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'12px 14px',marginTop:14}}>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
              <strong style={{color:'var(--text)'}}>{t('mcast_solicited.how_works')}</strong> {t('mcast_solicited.how_works_desc', { low24: <strong style={{color:'var(--text)'}}>{t('mcast_solicited.low_24_bits')}</strong>, prefix: <code style={{color:'var(--cyan)'}}>ff02::1:ff00:0/104</code> })}
              <br/><br/>
              <strong style={{color:'var(--text)'}}>{t('mcast_solicited.efficiency')}</strong> {t('mcast_solicited.efficiency_desc')}
              <br/><br/>
              <strong style={{color:'var(--text)'}}>{t('mcast_solicited.mac_mapping')}</strong> {t('mcast_solicited.mac_mapping_desc', { prefix: <code style={{color:'var(--cyan)'}}>33:33:ff:xx:xx:xx</code> })}
              <br/><br/>
              <strong style={{color:'var(--text)'}}>{t('mcast_solicited.nd_role')}</strong> {t('mcast_solicited.nd_role_desc', { ns: <strong style={{color:'var(--text)'}}>{t('mcast_solicited.ns_name')}</strong>, na: <strong style={{color:'var(--text)'}}>{t('mcast_solicited.na_name')}</strong> })}
              <br/><br/>
              <strong style={{color:'var(--text)'}}>{t('mcast_solicited.dad')}</strong> {t('mcast_solicited.dad_desc')}
              <br/><br/>
              <strong style={{color:'var(--text)'}}>{t('mcast_solicited.verification')}</strong> {t('mcast_solicited.verification_desc')}
              <ul style={{margin:'8px 0 0 18px', padding:0}}>
                <li>{t('mcast_solicited.linux')} <code style={{color:'var(--cyan)'}}>ip -6 maddr show</code></li>
                <li>{t('mcast_solicited.windows')} <code style={{color:'var(--cyan)'}}>netsh interface ipv6 show joins</code></li>
                <li>{t('mcast_solicited.macos')} <code style={{color:'var(--cyan)'}}>ndp -an</code></li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: GlopCalc ─────────────────────────────────────────────────
function GlopCalcSection({ initialData, onShare }) {
  const { t } = useTranslation();
  const [mode, setMode] = usePersistentState('mcast-glop:mode', initialData?.mode ?? 'as-to-glop');
  const [asInput, setAsInput] = usePersistentState('mcast-glop:asInput', initialData?.asInput ?? '64512');
  const [glopInput, setGlopInput] = usePersistentState('mcast-glop:glopInput', initialData?.glopInput ?? '233.251.0.1');
  const [result, setResult] = usePersistentState('mcast-glop:result', null);
  const [err, setErr] = useState('');

  const calc = useCallback(() => {
    setErr(''); setResult(null);
    if (mode === 'as-to-glop') {
      const asNum = parseInt(asInput.trim());
      if (isNaN(asNum) || asNum < 0 || asNum > 65535) { setErr(t('glop.err_as')); return; }
      const g = Multicast.asToGlop(asNum);
      const block = IPv4.subnet(IPv4.parse(`233.${g.x}.${g.y}.0`), 24);
      setResult({ asNum, x: g.x, y: g.y, block: g.block, start: block.networkStr, end: block.broadcastStr, total: 256, mac: Multicast.ipv4ToMac(IPv4.parse(`233.${g.x}.${g.y}.0`)) });
    } else {
      const ip = IPv4.parse(glopInput);
      if (ip === null) { setErr(t('glop.err_ip')); return; }
      const a = (ip >>> 24) & 0xFF;
      if (a !== 233) { setErr(t('glop.err_glop')); return; }
      const b = (ip >>> 16) & 0xFF;
      const c = (ip >>> 8) & 0xFF;
      const asNum = Multicast.glopToAs(b, c);
      const g = Multicast.asToGlop(asNum);
      const block = IPv4.subnet(IPv4.parse(`233.${b}.${c}.0`), 24);
      setResult({ asNum, x: b, y: c, block: g.block, start: block.networkStr, end: block.broadcastStr, total: 256, mac: Multicast.ipv4ToMac(IPv4.parse(`233.${b}.${c}.0`)) });
    }
  }, [mode, asInput, glopInput, t]);

  useEffect(() => {
    if (initialData?.subTab === 'glop') {
      if (initialData.mode !== undefined) setMode(initialData.mode);
      if (initialData.asInput !== undefined) setAsInput(initialData.asInput);
      if (initialData.glopInput !== undefined) setGlopInput(initialData.glopInput);
    }
    calc();
  }, [initialData]);

  useEffect(() => { const t_out = setTimeout(calc, 300); return () => clearTimeout(t_out); }, [asInput, glopInput, mode, calc]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (asInput || glopInput) (e.detail?.respond ?? onShare)({ tool: 'mcast-toolkit', activeTab: 'calculators', subTab: 'glop', mode, asInput, glopInput });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [mode, asInput, glopInput, onShare]);

  const switchMode = (m) => { setMode(m); setResult(null); setErr(''); };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('glop.mode')}</div>
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          {[['as-to-glop',t('glop.as_to_glop')],['glop-to-as',t('glop.glop_to_as')]].map(([v,l]) => (
            <button key={v} className={`btn btn-sm ${mode===v?'btn-primary':'btn-ghost'}`} onClick={() => switchMode(v)}>{l}</button>
          ))}
        </div>
        {mode === 'as-to-glop' ? (
          <div className="field">
            <label className="label">{t('glop.as_label')}</label>
            <div className="input-row">
              <input className={`input ${err?'error':''}`} type="number" value={asInput} onChange={e => setAsInput(e.target.value)}
                onKeyDown={e => e.key==='Enter' && calc()} placeholder="64512" min="0" max="65535" />
              <button className="btn btn-primary" onClick={calc}>{t('glop.calculate')}</button>
            </div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
              {[['64512','Private'],['15169','Google'],['13335','Cloudflare'],['14618','Amazon'],['0','AS 0']].map(([v,l]) => (
                <button key={v} className="btn btn-ghost btn-sm" onClick={() => setAsInput(v)}>{l}</button>
              ))}
            </div>
          </div>
        ) : (
          <div className="field">
            <label className="label">{t('glop.glop_label')}</label>
            <div className="input-row">
              <input className={`input ${err?'error':''}`} value={glopInput} onChange={e => setGlopInput(e.target.value)}
                onKeyDown={e => e.key==='Enter' && calc()} placeholder="233.1.2.0" />
              <button className="btn btn-primary" onClick={calc}>{t('glop.extract_as')}</button>
            </div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap',marginTop:8}}>
              {[['233.252.0.1','AS 64512'],['233.59.41.1','AS 15169'],['233.52.71.1','AS 13335'],['233.57.26.1','AS 14618']].map(([v,l]) => (
                <button key={v} className="btn btn-ghost btn-sm" onClick={() => setGlopInput(v)}>{l}</button>
              ))}
            </div>
          </div>
        )}
        <Err msg={err} />
      </div>

      {result && (
        <div className="card fadein">
          <div className="card-title">{t('glop.result_title')}</div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('glop.as_num')} value={`AS ${result.asNum}`} accent />
            <ResultItem label={t('glop.glop_block')} value={result.block} green />
            <ResultItem label={t('glop.block_start')} value={result.start} />
            <ResultItem label={t('glop.block_end')} value={result.end} />
            <ResultItem label={t('glop.total_addr')} value={result.total.toString()} />
            <ResultItem label={t('glop.base_mac')} value={result.mac} />
          </div>
          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'12px 14px',marginTop:12}}>
            <div className="hint" style={{marginBottom:8,fontWeight:600}}>{t('glop.encoding_breakdown')}</div>
            <div style={{fontFamily:'var(--mono)',fontSize:11,letterSpacing:1,lineHeight:2}}>
              <div>
                <span style={{color:'var(--muted)',display:'inline-block',width:36}}>AS </span>
                <span style={{color:'var(--dim)'}}>{result.asNum.toString(2).padStart(16,'0').slice(0,8)}</span>
                <span style={{color:'var(--border)'}}>.</span>
                <span style={{color:'var(--dim)'}}>{result.asNum.toString(2).padStart(16,'0').slice(8)}</span>
                <span style={{color:'var(--muted)',marginLeft:8}}>= {result.asNum}</span>
              </div>
              <div>
                <span style={{color:'var(--muted)',display:'inline-block',width:36}}>IP </span>
                <span style={{color:'var(--cyan)'}}>233</span>
                <span style={{color:'var(--border)'}}>.</span>
                <span style={{padding:'2px 3px',background:'rgba(245,158,11,0.15)',borderRadius:3,color:'var(--yellow)'}}>{result.x}</span>
                <span style={{color:'var(--border)'}}>.</span>
                <span style={{padding:'2px 3px',background:'rgba(0,212,200,0.15)',borderRadius:3,color:'var(--cyan)'}}>{result.y}</span>
                <span style={{color:'var(--border)'}}>.</span>
                <span style={{color:'var(--dim)'}}>0</span>
              </div>
              <div>
                <span style={{color:'var(--muted)',display:'inline-block',width:36}}> </span>
                <span style={{color:'var(--dim)'}}>{t('glop.fixed')}</span>
                <span style={{marginLeft:3,color:'var(--yellow)'}}>{'\u2191'} X=AS/256</span>
                <span style={{marginLeft:6,color:'var(--cyan)'}}>{'\u2191'} Y=AS%256</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card fadein" style={{marginTop: result ? 0 : undefined}}>
        <div className="card-title">{t('glop.how_works')}</div>
        <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
          <strong style={{color:'var(--text)'}}>{t('glop.how_works')}</strong> {t('glop.how_works_desc', { glop: 'GLOP', rfc: 'RFC 3180', as: 'Autonomous System (AS)' })}
          <br/><br/>
          <strong style={{color:'var(--text)'}}>{t('glop.formula')}</strong> {t('glop.formula_desc', { code: <code style={{color:'var(--cyan)'}}>233.X.Y.z</code>, x: <code style={{color:'var(--yellow)'}}>X</code>, y: <code style={{color:'var(--cyan)'}}>Y</code> })}
          <br/><br/>
          <strong style={{color:'var(--text)'}}>{t('glop.use_case')}</strong> {t('glop.use_case_desc')}
          <br/><br/>
          <strong style={{color:'var(--text)'}}>{t('glop.limitation')}</strong> {t('glop.limitation_desc', { rfc: <RFCLink rfc="RFC 5771" /> })}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-component: McastBuilder ─────────────────────────────────────────────
function McastBuilderSection({ initialData, onShare }) {
  const { t } = useTranslation();
  const [scope, setScope] = usePersistentState('mcast-build:scope', initialData?.scope ?? 2);
  const [flagT, setFlagT] = usePersistentState('mcast-build:flagT', initialData?.flagT ?? false);
  const [flagP, setFlagP] = usePersistentState('mcast-build:flagP', initialData?.flagP ?? false);
  const [flagR, setFlagR] = usePersistentState('mcast-build:flagR', initialData?.flagR ?? false);
  const [groupId, setGroupId] = usePersistentState('mcast-build:groupId', initialData?.groupId ?? '1');
  const [result, setResult] = usePersistentState('mcast-build:result', null);

  const calc = useCallback(() => {
    let flags = 0;
    if (flagT) flags |= 0x1;
    if (flagP) flags |= 0x2;
    if (flagR) flags |= 0x4;

    const firstWord = `ff${flags.toString(16)}${scope.toString(16)}`;
    let g = groupId.trim().replace(/^0x/, '');
    if (!/^[0-9a-fA-F]+$/.test(g)) g = '1';

    // Construct full address
    const full = `${firstWord}::${g}`;
    const expanded = IPv6.expand(full);
    if (!expanded) return;

    const compressed = IPv6.compress(expanded);
    const mac = Multicast.ipv6ToMac(expanded);
    const cls = Multicast.classifyIPv6(expanded);

    setResult({
      address: compressed,
      expanded,
      mac,
      scopeName: cls ? cls.scopeName : 'Unknown',
      isPermanent: !flagT,
      isPrefixBased: flagP,
      hasEmbeddedRP: flagR
    });
  }, [scope, flagT, flagP, flagR, groupId]);

  useEffect(() => {
    if (initialData?.subTab === 'ipv6_builder') {
      if (initialData.scope !== undefined) setScope(initialData.scope);
      if (initialData.flagT !== undefined) setFlagT(initialData.flagT);
      if (initialData.flagP !== undefined) setFlagP(initialData.flagP);
      if (initialData.flagR !== undefined) setFlagR(initialData.flagR);
      if (initialData.groupId !== undefined) setGroupId(initialData.groupId);
    }
  }, [initialData]);

  useEffect(() => calc(), [scope, flagT, flagP, flagR, groupId, calc]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (groupId) (e.detail?.respond ?? onShare)({ tool: 'mcast-toolkit', activeTab: 'calculators', subTab: 'ipv6_builder', scope, flagT, flagP, flagR, groupId });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [scope, flagT, flagP, flagR, groupId, onShare]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('mcast_builder.parameters')}</div>
        <div className="field">
          <label className="label">{t('mcast_builder.scope')}</label>
          <select className="select" value={scope} onChange={e => setScope(parseInt(e.target.value))}>
            {Multicast.IPv6_SCOPES.map(s => (
              <option key={s.value} value={s.value}>{s.value.toString(16).toUpperCase()} — {s.name}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label className="label">{t('mcast_builder.flags')}</label>
          <div style={{display:'flex',gap:16,marginTop:8,flexWrap:'wrap'}}>
            <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
              <input type="checkbox" checked={flagT} onChange={e => setFlagT(e.target.checked)} />
              {t('mcast_builder.flag_t')}
            </label>
            <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
              <input type="checkbox" checked={flagP} onChange={e => setFlagP(e.target.checked)} />
              {t('mcast_builder.flag_p')}
            </label>
            <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:13}}>
              <input type="checkbox" checked={flagR} onChange={e => setFlagR(e.target.checked)} />
              {t('mcast_builder.flag_r')}
            </label>
          </div>
        </div>

        <div className="field">
          <label className="label">{t('mcast_builder.group_id')}</label>
          <input className="input" value={groupId} onChange={e => setGroupId(e.target.value)} placeholder="e.g. 1, fb, or dead:beef" />
        </div>
      </div>

      {result && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_builder.constructed')}</div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('mcast_map.ipv6_addr')} value={result.address} accent />
            <ResultItem label={t('mcast_builder.eth_mac')} value={result.mac} green />
            <ResultItem label={t('mcast_builder.scope')} value={result.scopeName} />
          </div>

          <div style={{marginTop:16}}>
            <div className="card-title" style={{fontSize:13}}>{t('mcast_builder.properties')}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:8}}>
              <span className={`badge ${result.isPermanent ? 'badge-blue' : 'badge-yellow'}`}>{result.isPermanent ? t('mcast_builder.permanent') : t('mcast_builder.transient')}</span>
              {result.isPrefixBased && <span className="badge badge-green">{t('mcast_builder.unicast_prefix')}</span>}
              {result.hasEmbeddedRP && <span className="badge badge-cyan">{t('mcast_builder.embedded_rp')}</span>}
            </div>
          </div>

          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'12px 14px',marginTop:14}}>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
              <strong style={{color:'var(--text)'}}>{t('mcast_builder.structure')}</strong> {t('mcast_builder.structure_desc', {ff: <code style={{color:'var(--cyan)'}}>ff</code>, flags: <strong style={{color:'var(--text)'}}>{t('mcast_builder.flags').split(' ')[0].toLowerCase()}</strong>, scope: <strong style={{color:'var(--text)'}}>{t('mcast_builder.scope').toLowerCase()}</strong>})}
              <br/><br/>
              <strong style={{color:'var(--text)'}}>{t('mcast_builder.flags_title')}</strong> {t('mcast_builder.flags_desc', {t0: <code style={{color:'var(--text)'}}>T=0</code>, t1: <code style={{color:'var(--text)'}}>T=1</code>, p1: <code style={{color:'var(--text)'}}>P=1</code>, rfc: <RFCLink rfc="RFC 3306" />})}
              <br/><br/>
              <strong style={{color:'var(--text)'}}>{t('mcast_builder.common_patterns')}</strong>
              <ul style={{marginTop:6,paddingLeft:20}}>
                <li><code style={{color:'var(--cyan)'}}>ff02::1</code> — {t('mcast_builder.all_nodes')}</li>
                <li><code style={{color:'var(--cyan)'}}>ff02::fb</code> — {t('mcast_builder.mdns')}</li>
                <li><code style={{color:'var(--cyan)'}}>ff0e::/16</code> — {t('mcast_builder.global_well_known')}</li>
              </ul>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-component: McastPlanner ─────────────────────────────────────────────
function McastPlannerSection({ initialData, onShare }) {
  const { t } = useTranslation();
  const [baseBlock, setBaseBlock] = usePersistentState('mcast-plan:baseBlock', initialData?.baseBlock ?? '239.0.0.0/16');
  const [groups, setGroups] = usePersistentState('mcast-plan:groups', initialData?.groups ?? [
    { name: t('mcast_plan.default_video'), prefix: 24 },
    { name: t('mcast_plan.default_audio'), prefix: 24 },
    { name: t('mcast_plan.default_data'), prefix: 28 },
  ]);
  const [result, setResult] = usePersistentState('mcast-plan:result', null);
  const [err, setErr] = useState('');

  const addGroup = () => setGroups(g => [...g, { name: '', prefix: 28 }]);
  const remGroup = i => setGroups(g => g.filter((_, j) => j !== i));
  const updateGroup = (i, k, v) => setGroups(g => g.map((grp, j) => j === i ? { ...grp, [k]: k === 'prefix' ? parseInt(v) || 24 : v } : grp));

  const calc = useCallback(() => {
    setErr(''); setResult(null);
    const c = IPv4.parseCIDR(baseBlock);
    if (!c) { setErr(t('mcast_plan.err_base')); return; }
    const a = (c.ip >>> 24) & 0xFF;
    if (a !== 239) { setErr(t('mcast_plan.err_scoped')); return; }
    const filtered = groups.filter(g => g.name || g.prefix);
    if (!filtered.length) { setErr(t('mcast_plan.err_at_least_one')); return; }

    const parent = IPv4.subnet(c.ip, c.prefix);
    let curIP = parent.network;
    const parentEnd = parent.broadcast;
    const allocations = [];

    for (const grp of filtered) {
      const p = grp.prefix;
      if (p < c.prefix || p > 32) {
        allocations.push({ ...grp, error: t('mcast_plan.err_outside', {p, parent: c.prefix}) });
        continue;
      }
      const blockSize = Math.pow(2, 32 - p);
      curIP = (Math.ceil(curIP / blockSize) * blockSize) >>> 0;
      const sn = IPv4.subnet(curIP, p);
      if (sn.broadcast > parentEnd) {
        allocations.push({ ...grp, error: t('mcast_plan.err_no_space') });
        continue;
      }
      allocations.push({ ...grp, subnet: sn, error: null });
      curIP = (sn.broadcast + 1) >>> 0;
    }
    setResult({ allocations, parent });
  }, [baseBlock, groups, t]);

  useEffect(() => {
    if (initialData?.subTab === 'planner') {
      if (initialData.baseBlock !== undefined) setBaseBlock(initialData.baseBlock);
      if (initialData.groups !== undefined) setGroups(initialData.groups);
    }
    calc();
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (baseBlock) (e.detail?.respond ?? onShare)({ tool: 'mcast-toolkit', activeTab: 'planning', subTab: 'planner', baseBlock, groups });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [baseBlock, groups, onShare]);

  const PALETTE = ['var(--cyan)','var(--blue)','var(--green)','var(--yellow)','var(--purple)','#f97316','#ec4899','#14b8a6'];

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('mcast_plan.base_block')}</div>
        <div className="field">
          <label className="label">{t('mcast_plan.network_cidr')}</label>
          <input className="input" style={{maxWidth:220}} value={baseBlock} onChange={e => setBaseBlock(e.target.value)} placeholder="239.0.0.0/16" />
        </div>
        <div className="card-title" style={{marginTop:8}}>{t('mcast_plan.mcast_groups')}</div>
        {groups.map((g, i) => (
          <div key={i} className="vlsm-row">
            <input className="input" value={g.name} onChange={e => updateGroup(i,'name',e.target.value)} placeholder={t('mcast_plan.group_name_placeholder')} />
            <select className="select" value={g.prefix} onChange={e => updateGroup(i,'prefix',e.target.value)} style={{width:80}}>
              {Array.from({length:9},(_,k)=>24+k).filter(p=>p<=32).map(p => <option key={p} value={p}>/{p}</option>)}
            </select>
            <button className="btn btn-danger btn-sm" onClick={() => remGroup(i)}>✕</button>
          </div>
        ))}
        <Err msg={err} />
        <div className="btn-row" style={{marginTop:16}}>
          <button className="btn btn-ghost" onClick={addGroup}>{t('mcast_plan.add_group')}</button>
          <button className="btn btn-primary" onClick={calc}>{t('mcast_plan.allocate')}</button>
        </div>
      </div>

      {result && (<>
        <div className="card fadein">
          <div className="card-title">{t('mcast_plan.visual_map', {cidr: result.parent.cidr})}</div>
          <div style={{display:'flex',height:36,borderRadius:6,overflow:'hidden',border:'1px solid var(--border)',marginBottom:14,gap:1}}>
            {result.allocations.filter(a => a.subnet).map((a, i) => {
              const pct = (a.subnet.totalHosts / result.parent.totalHosts * 100);
              return (
                <div key={i} title={`${a.name}: ${a.subnet.cidr}`}
                  style={{flex:`0 0 ${pct}%`,background:`${PALETTE[i%PALETTE.length]}33`,borderRight:`1px solid ${PALETTE[i%PALETTE.length]}66`,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',minWidth:2}}>
                  {pct > 6 && <span style={{fontSize:10,fontFamily:'var(--mono)',color:PALETTE[i%PALETTE.length],fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',padding:'0 4px'}}>{a.subnet.cidr}</span>}
                </div>
              );
            })}
            {(() => {
              const used = result.allocations.filter(a=>a.subnet).reduce((s,a)=>s+a.subnet.totalHosts,0);
              const pct = ((result.parent.totalHosts - used) / result.parent.totalHosts * 100);
              return pct > 0 ? <div style={{flex:`0 0 ${pct}%`,background:'rgba(255,255,255,.03)',display:'flex',alignItems:'center',justifyContent:'center'}}>{pct > 6 && <span style={{fontSize:10,color:'var(--dim)',fontFamily:'var(--mono)'}}>{t('vlsm.free')}</span>}</div> : null;
            })()}
          </div>
        </div>
        <div className="card fadein">
          <div className="card-title">{t('mcast_plan.allocation_table')}</div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>#</th><th>{t('cheatsheet.name') || 'Name'}</th><th>{t('cheatsheet.cidr')}</th><th>{t('range.range_details').split(' ')[0]}</th><th>{t('mcast_plan.addresses')}</th><th>{t('mcast_plan.mac')}</th></tr></thead>
              <tbody>
                {result.allocations.map((a, i) => (
                  <tr key={i}>
                    <td style={{color:'var(--dim)'}}>{i+1}</td>
                    <td style={{fontWeight:500}}>{a.name || `${t('mcast_map.block').split(' ')[0]} ${i+1}`}</td>
                    {a.error ? <td colSpan={4} style={{color:'var(--red)'}}>{a.error}</td> : <>
                      <td style={{color:'var(--cyan)'}}>{a.subnet.cidr}</td>
                      <td>{a.subnet.firstHostStr} – {a.subnet.lastHostStr}</td>
                      <td style={{color:'var(--green)'}}>{a.subnet.totalHosts}</td>
                      <td style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--dim)'}}>{Multicast.ipv4ToMac(a.subnet.network)}</td>
                    </>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile View */}
          <div className="show-mobile mobile-cards">
            {result.allocations.map((a, i) => (
              <div key={i} className="mobile-card" style={{borderLeft: a.error ? '3px solid var(--red)' : 'none'}}>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mcast_map.block').split(' ')[0]} {i+1}</span>
                  <span className="mobile-card-value" style={{fontWeight:600}}>{a.name || t('mcast_plan.unnamed')}</span>
                </div>
                {a.error ? (
                  <div className="mobile-card-row">
                    <span className="mobile-card-label" style={{color:'var(--red)'}}>{t('mcast_plan.error')}</span>
                    <span className="mobile-card-value" style={{color:'var(--red)'}}>{a.error}</span>
                  </div>
                ) : (
                  <>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('cheatsheet.cidr')}</span>
                      <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{a.subnet.cidr}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('range.range_details').split(' ')[0]}</span>
                      <span className="mobile-card-value" style={{fontSize:11}}>{a.subnet.firstHostStr} - {a.subnet.lastHostStr}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('cheatsheet.hosts')} / {t('mcast_plan.mac')}</span>
                      <span className="mobile-card-value">{a.subnet.totalHosts} / {Multicast.ipv4ToMac(a.subnet.network).slice(-8)}</span>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(
              result.allocations.filter(a=>a.subnet).map(a=>({name:a.name,cidr:a.subnet.cidr,network:a.subnet.networkStr,broadcast:a.subnet.broadcastStr,addresses:a.subnet.totalHosts,mac:Multicast.ipv4ToMac(a.subnet.network)})),
              'multicast-plan.csv')}>{t('common.export_csv')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => exportJSON(result.allocations,'multicast-plan.json')}>{t('common.export_json')}</button>
          </div>
        </div>
      </>)}
    </div>
  );
}

// ─── Sub-component: McastCollision ───────────────────────────────────────────
function McastCollisionSection({ initialData, onShare }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('mcast-coll:input', initialData?.input ?? '239.1.1.1\n224.1.1.1\n239.129.1.1\n224.0.0.1\n239.0.0.1');
  const [macInput, setMacInput] = usePersistentState('mcast-coll:macInput', initialData?.macInput ?? '01:00:5E:01:01:01');
  const [result, setResult] = usePersistentState('mcast-coll:result', null);
  const [macResult, setMacResult] = usePersistentState('mcast-coll:macResult', null);

  const calc = useCallback(() => {
    const lines = input.split(/[\n,;]/).map(l => l.trim()).filter(Boolean);
    const groups = {};
    let totalFound = 0;

    lines.forEach(line => {
      const ip = IPv4.parse(line);
      if (ip !== null) {
        const a = (ip >>> 24) & 0xFF;
        if (a >= 224 && a <= 239) {
          const mac = Multicast.ipv4ToMac(ip);
          if (!groups[mac]) groups[mac] = [];
          if (!groups[mac].includes(line)) groups[mac].push(line);
          totalFound++;
        }
      }
    });

    const collisions = Object.entries(groups)
      .map(([mac, ips]) => ({ mac, ips }))
      .sort((a, b) => b.ips.length - a.ips.length);

    setResult({
      collisions,
      totalMACs: Object.keys(groups).length,
      totalIPs: totalFound,
      hasCollisions: collisions.some(c => c.ips.length > 1)
    });
  }, [input]);

  const calcMac = useCallback(() => {
    const ips = Multicast.macToIpv4Set(macInput);
    if (!ips) { setMacResult({ error: t('mcast_collision.err_invalid_mac') }); return; }
    setMacResult({ ips });
  }, [macInput, t]);

  useEffect(() => {
    if (initialData?.subTab === 'collision') {
      if (initialData.input !== undefined) setInput(initialData.input);
      if (initialData.macInput !== undefined) setMacInput(initialData.macInput);
    }
    calc();
  }, [initialData]);
  
  useEffect(() => calcMac(), [calcMac]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (input) (e.detail?.respond ?? onShare)({ tool: 'mcast-toolkit', activeTab: 'planning', subTab: 'collision', input, macInput });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [input, macInput, onShare]);

  return (
    <div className="fadein">
      <div className="two-col grid-mobile-1">
        <div className="card">
          <div className="card-title">{t('mcast_collision.analyzer_title')}</div>
          <div className="field">
            <label className="label">{t('mcast_collision.label')}</label>
            <textarea className="input" style={{height:100,resize:'none',fontFamily:'var(--mono)',fontSize:12}}
              value={input} onChange={e => setInput(e.target.value)} placeholder={t('mcast_collision.placeholder')} />
            <div className="btn-row" style={{marginTop:12}}>
              <button className="btn btn-primary" onClick={calc}>{t('mcast_collision.analyze')}</button>
              <button className="btn btn-ghost" onClick={() => { setInput('239.1.1.1\n224.1.1.1\n239.129.1.1\n224.129.1.1\n239.0.0.1'); setTimeout(calc, 0); }}>{t('mcast_collision.load_example')}</button>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('mcast_collision.reverse_lookup_title')}</div>
          <div className="field">
            <label className="label">{t('mcast_collision.enter_mac')}</label>
            <div className="input-row">
              <input className="input" value={macInput} onChange={e => setMacInput(e.target.value)} placeholder="01:00:5E:xx:xx:xx" />
              <button className="btn btn-primary" onClick={calcMac}>{t('mcast_collision.expand')}</button>
            </div>
          </div>
          {macResult?.error && <Err msg={macResult.error} />}
          {macResult?.ips && (
            <div style={{marginTop:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                <div className="hint">{t('mcast_collision.related_ips')}</div>
                <CopyBtn text={macResult.ips.join('\n')} label="copy_all" id="mcast-collision-reverse-copy-all" />
              </div>
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(100px,1fr))',gap:4}}>
                {macResult.ips.map(ip => (
                  <div key={ip} className="nav-item" style={{margin:0,padding:'4px 8px',fontSize:11,background:'var(--panel)',border:'1px solid var(--border)'}}>{ip}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {result && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_collision.results_title')}</div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
            <CopyBtn text={result.collisions.map(c => c.mac + '\t' + c.ips.join(', ')).join('\n')} label="copy_all" id="mcast-collision-copy-all" />
          </div>
          <div style={{display:'flex',gap:24,marginBottom:20,paddingBottom:20,borderBottom:'1px solid var(--border)',flexWrap:'wrap'}}>
            <div>
              <div className="result-label">{t('mcast_collision.total_ips')}</div>
              <div className="result-value" style={{fontSize:24}}>{result.totalIPs}</div>
            </div>
            <div>
              <div className="result-label">{t('mcast_collision.unique_macs')}</div>
              <div className="result-value" style={{fontSize:24}}>{result.totalMACs}</div>
            </div>
            <div>
              <div className="result-label">{t('mcast_collision.status')}</div>
              <div className={`result-value ${result.hasCollisions?'red':'green'}`} style={{fontSize:24}}>
                {result.hasCollisions ? t('mcast_collision.collisions') : t('mcast_collision.clear')}
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>{t('mcast_collision.eth_mac')}</th>
                  <th>{t('mcast_collision.associated_ips')}</th>
                  <th style={{textAlign:'right'}}>{t('mcast_collision.action')}</th>
                </tr>
              </thead>
              <tbody>
                {result.collisions.map(c => (
                  <tr key={c.mac}>
                    <td style={{color: c.ips.length>1?'var(--red)':'var(--text)'}}>
                      <span style={{display:'inline-flex',alignItems:'center',gap:6}}>
                        {c.mac}
                        <CopyBtn text={c.mac} label="copy" id={`mcast-collision-mac-${c.mac.replace(/:/g,'')}`} />
                      </span>
                    </td>
                    <td>
                      <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                        {c.ips.map(ip => (
                          <span key={ip} className={`badge ${c.ips.length>1?'badge-red':'badge-gray'}`} style={{fontFamily:'var(--mono)'}}>{ip}</span>
                        ))}
                      </div>
                    </td>
                    <td style={{textAlign:'right'}}>
                      <button className="btn btn-ghost btn-sm" onClick={() => { setMacInput(c.mac); calcMac(); }}>{t('mcast_collision.view_32_1')}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">{t('mcast_collision.overlap_title')}</div>
        <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
          {t('mcast_collision.overlap_desc')}
          <br/><br/>
          <strong style={{color:'var(--text)'}}>{t('mcast_collision.impact_title')}</strong> {t('mcast_collision.impact_desc')}
          <br/><br/>
          <strong style={{color:'var(--text)'}}>{t('mcast_collision.historical_title')}</strong> {t('mcast_collision.historical_desc')}
        </div>
      </div>
    </div>
  );
}

// ─── Sub-component: McastAnalyzer ────────────────────────────────────────────
function McastAnalyzerSection({ initialData, onShare }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('mcast-analyze:input', initialData?.input ?? '239.1.2.3');
  const [result, setResult] = usePersistentState('mcast-analyze:result', null);
  const [err, setErr] = useState('');

  const calc = useCallback(() => {
    setErr(''); setResult(null);
    const trimmed = input.trim();

    // Try IPv4
    const ip4 = IPv4.parse(trimmed);
    if (ip4 !== null) {
      const a = (ip4 >>> 24) & 0xFF;
      if (a < 224 || a > 239) { setErr(t('mcast_analyze.err_ip4')); return; }
      const cls = Multicast.classifyIPv4(ip4);
      const mac = Multicast.ipv4ToMac(ip4);
      setResult({ version: 4, ip: IPv4.str(ip4), mac, ...cls });
      return;
    }

    // Try IPv6
    const expanded = IPv6.expand(trimmed);
    if (expanded && expanded.startsWith('ff')) {
      const mac = Multicast.ipv6ToMac(expanded);
      const cls = Multicast.classifyIPv6(expanded);
      setResult({ version: 6, expanded, compressed: IPv6.compress(trimmed), mac, ...cls });
      return;
    }

    setErr(t('mcast_analyze.err_invalid'));
  }, [input, t]);

  useEffect(() => {
    if (initialData?.subTab === 'analyzer') {
      if (initialData.input) setInput(initialData.input);
    }
    calc();
  }, [initialData]);

  useEffect(() => { const t_out = setTimeout(calc, 300); return () => clearTimeout(t_out); }, [input, calc]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (input) (e.detail?.respond ?? onShare)({ tool: 'mcast-toolkit', activeTab: 'planning', subTab: 'analyzer', input });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [input, onShare]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('tools.mcast-analyze.title')}</div>
        <div className="field">
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key==='Enter' && calc()} placeholder="224.0.0.1 or ff02::1" />
            <button className="btn btn-primary" onClick={calc}>{t('mac.analyze')}</button>
          </div>
          <Err msg={err} />
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {['224.0.0.1','224.0.0.5','232.1.2.3','233.1.2.0','239.255.255.250','ff02::1','ff02::fb','ff05::1:3','ff0e::1'].map(p => (
            <button key={p} className="btn btn-ghost btn-sm" onClick={() => { setInput(p); }}>{p}</button>
          ))}
        </div>
      </div>

      {result && result.version === 4 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_analyze.ipv4_analysis')}</div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('mcast_analyze.addr')} value={result.ip} accent />
            <ResultItem label={t('mcast_analyze.eth_mac')} value={result.mac} green />
            <ResultItem label={t('mcast_analyze.scope')} value={result.scope} />
            <ResultItem label={t('mcast_analyze.block')} value={result.block} />
            <ResultItem label={t('mcast_analyze.description')} value={result.description} />
            <ResultItem label={t('mcast_analyze.rfc')} value={result.rfc} />
            <ResultItem label={t('mcast_analyze.ssm_eligible')} value={result.isSSM ? t('mcast_analyze.yes') : t('mcast_analyze.no')} green={result.isSSM} />
            {result.ttlThreshold > 0 && <ResultItem label={t('mcast_analyze.ttl_threshold')} value={`≥ ${result.ttlThreshold}`} />}
            {result.asNumber !== null && <ResultItem label={t('mcast_analyze.glop_as')} value={`AS ${result.asNumber}`} yellow />}
          </div>
          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 14px',marginTop:12}}>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
              <div style={{marginBottom:4}}><strong style={{color:'var(--text)'}}>{t('mcast_analyze.scope')}</strong> — {t('mcast_analyze.scope_desc', {link: <span style={{color:'var(--cyan)'}}>Link-Local</span>, admin: <span style={{color:'var(--yellow)'}}>Admin-Scoped</span>, global: <span style={{color:'var(--green)'}}>Global</span>})}</div>
              <div style={{marginBottom:4}}><strong style={{color:'var(--text)'}}>{t('mcast_analyze.block')}</strong> — {t('mcast_analyze.block_desc')}</div>
              <div style={{marginBottom:4}}><strong style={{color:'var(--text)'}}>{t('mcast_analyze.ssm_eligible')}</strong> — {t('mcast_analyze.ssm_desc')}</div>
              {result.ttlThreshold > 0 && <div style={{marginBottom:4}}><strong style={{color:'var(--text)'}}>{t('mcast_analyze.ttl_threshold')}</strong> — {t('mcast_analyze.ttl_desc')}</div>}
              {result.asNumber !== null && <div style={{marginBottom:4}}><strong style={{color:'var(--text)'}}>{t('mcast_analyze.glop_as')}</strong> — {t('mcast_analyze.glop_desc', {rfc: <RFCLink rfc="RFC 3180" />, code: <code style={{color:'var(--cyan)'}}>233.{Math.floor(result.asNumber/256)}.{result.asNumber%256}.x</code>})}</div>}
              <div><strong style={{color:'var(--text)'}}>{t('mcast_analyze.eth_mac')}</strong> — {t('mcast_analyze.mac_desc', {prefix: <code style={{color:'var(--cyan)'}}>01:00:5E</code>})}</div>
            </div>
          </div>
        </div>
      )}

      {result && result.version === 6 && (
        <div className="card fadein">
          <div className="card-title">{t('mcast_analyze.ipv6_analysis')}</div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('mcast_analyze.addr')} value={result.compressed} accent />
            <ResultItem label={t('mcast_map.expanded')} value={result.expanded} />
            <ResultItem label={t('mcast_analyze.eth_mac')} value={result.mac} green />
            <ResultItem label={t('mcast_analyze.scope')} value={result.scopeName} />
            <ResultItem label={t('mcast_analyze.v6_scope_val')} value={`0x${result.scope.toString(16).padStart(2,'0')} (${result.scope})`} />
            <ResultItem label={t('mcast_analyze.description')} value={result.description} />
            <ResultItem label={t('mcast_analyze.rfc')} value={result.rfc} />
            <ResultItem label={t('mcast_analyze.v6_temp')} value={result.flagT ? t('mcast_analyze.yes') : t('mcast_analyze.v6_permanent')} />
            <ResultItem label={t('mcast_analyze.v6_prefix_based')} value={result.flagP ? t('mcast_analyze.yes') : t('mcast_analyze.no')} />
          </div>
          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 14px',marginTop:12}}>
            <div style={{fontFamily:'var(--mono)',fontSize:11,letterSpacing:1,lineHeight:2,marginBottom:8}}>
              <div>
                <span style={{color:'var(--muted)',display:'inline-block',width:50}}>{t('mcast_analyze.v6_format')}</span>
                <span style={{color:'var(--dim)'}}>ff</span>
                <span style={{padding:'2px 4px',background:'rgba(167,139,250,0.15)',borderRadius:3,color:'var(--purple)'}}>{(result.scope >> 4).toString(16).padStart(1,'0')}</span>
                <span style={{padding:'2px 4px',background:'rgba(0,212,200,0.15)',borderRadius:3,color:'var(--cyan)'}}>{(result.scope & 0xf).toString(16)}</span>
                <span style={{color:'var(--dim)'}}>:{result.expanded.split(':').slice(1).join(':')}</span>
              </div>
              <div>
                <span style={{color:'var(--muted)',display:'inline-block',width:50}}> </span>
                <span style={{color:'var(--dim)'}}>^^</span>
                <span style={{color:'var(--purple)',marginLeft:4}}>{t('mcast_analyze.v6_flags')}</span>
                <span style={{color:'var(--cyan)',marginLeft:2}}>{t('mcast_analyze.v6_scope')}</span>
              </div>
            </div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
              <div style={{marginBottom:4}}><strong style={{color:'var(--text)'}}>{t('mcast_analyze.scope')}</strong> — {t('mcast_analyze.v6_scope_desc', {ff: <code style={{color:'var(--cyan)'}}>ffXX</code>, v1: <span style={{color:'var(--cyan)'}}>1</span>, v2: <span style={{color:'var(--cyan)'}}>2</span>, v5: <span style={{color:'var(--cyan)'}}>5</span>, v8: <span style={{color:'var(--cyan)'}}>8</span>, vE: <span style={{color:'var(--cyan)'}}>E</span>})}</div>
              <div style={{marginBottom:4}}><strong style={{color:'var(--text)'}}>{t('mcast_analyze.v6_temp').split(' ')[0]}</strong> — {t('mcast_analyze.v6_t_desc')}</div>
              <div style={{marginBottom:4}}><strong style={{color:'var(--text)'}}>{t('mcast_analyze.v6_prefix_based').split(' ')[0]}</strong> — {t('mcast_analyze.v6_p_desc', {rfc: <RFCLink rfc="RFC 3306" />})}</div>
              <div><strong style={{color:'var(--text)'}}>{t('mcast_analyze.eth_mac')}</strong> — {t('mcast_analyze.v6_mac_desc', {prefix: <code style={{color:'var(--cyan)'}}>33:33</code>})}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component: MulticastToolkit ────────────────────────────────────────
function MulticastToolkit({ onShare, onNav, initialData }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('mcast-toolkit:activeTab', initialData?.activeTab ?? 'reference');
  const [calcSubTab, setCalcSubTab] = usePersistentState('mcast-toolkit:calcSubTab', initialData?.subTab ?? 'ip_mac');
  const [planSubTab, setPlanSubTab] = usePersistentState('mcast-toolkit:planSubTab', initialData?.subTab ?? 'planner');

  const tabs = [
    { id: 'reference', l: t('mcast_toolkit.tabs.reference') },
    { id: 'calculators', l: t('mcast_toolkit.tabs.calculators') },
    { id: 'planning', l: t('mcast_toolkit.tabs.planning') },
  ];

  const calcSubTabs = [
    { id: 'ip_mac', l: t('mcast_toolkit.sub_tabs.ip_mac') },
    { id: 'solicited', l: t('mcast_toolkit.sub_tabs.solicited') },
    { id: 'glop', l: t('mcast_toolkit.sub_tabs.glop') },
    { id: 'ipv6_builder', l: t('mcast_toolkit.sub_tabs.ipv6_builder') },
  ];

  const planSubTabs = [
    { id: 'planner', l: t('mcast_toolkit.sub_tabs.planner') },
    { id: 'collision', l: t('mcast_toolkit.sub_tabs.collision') },
    { id: 'analyzer', l: t('mcast_toolkit.sub_tabs.analyzer') },
  ];

  // Apply deep-link / sidebar nav coords to the inner tabs when they change
  const skipNavReport = useRef(false);
  useEffect(() => {
    let changed = false;
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      skipNavReport.current = true; changed = true;
      setActiveTab(initialData.activeTab);
    }
    if (initialData?.subTab) {
      const curSub = initialData.activeTab === 'planning' ? planSubTab : calcSubTab;
      if (initialData.subTab !== curSub) {
        skipNavReport.current = true; changed = true;
        if (initialData.activeTab === 'planning') setPlanSubTab(initialData.subTab);
        else setCalcSubTab(initialData.subTab);
      }
    }
  }, [initialData]);
  // Report the active tab up so the sidebar/search highlight follows in-app tab switches
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab, subTab: activeTab === 'planning' ? planSubTab : activeTab === 'calculators' ? calcSubTab : undefined });
  }, [activeTab, calcSubTab, planSubTab]);

  return (
    <div className="fadein">
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
        {tabs.map(tab => (
          <button key={tab.id} className={`btn btn-sm ${activeTab===tab.id?'btn-primary':'btn-ghost'}`}
            onClick={()=>setActiveTab(tab.id)}>{tab.l}</button>
        ))}
      </div>

      {activeTab === 'reference' && <McastReferenceSection />}

      {activeTab === 'calculators' && (
        <div className="fadein">
          <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
            {calcSubTabs.map(st => (
              <button key={st.id} className={`btn btn-xs ${calcSubTab===st.id?'btn-primary':'btn-ghost'}`}
                onClick={()=>setCalcSubTab(st.id)}>{st.l}</button>
            ))}
          </div>
          {calcSubTab === 'ip_mac' && <McastIpMacMapSection initialData={initialData} onShare={onShare} />}
          {calcSubTab === 'solicited' && <McastSolicitedSection initialData={initialData} onShare={onShare} />}
          {calcSubTab === 'glop' && <GlopCalcSection initialData={initialData} onShare={onShare} />}
          {calcSubTab === 'ipv6_builder' && <McastBuilderSection initialData={initialData} onShare={onShare} />}
        </div>
      )}

      {activeTab === 'planning' && (
        <div className="fadein">
          <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
            {planSubTabs.map(st => (
              <button key={st.id} className={`btn btn-xs ${planSubTab===st.id?'btn-primary':'btn-ghost'}`}
                onClick={()=>setPlanSubTab(st.id)}>{st.l}</button>
            ))}
          </div>
          {planSubTab === 'planner' && <McastPlannerSection initialData={initialData} onShare={onShare} />}
          {planSubTab === 'collision' && <McastCollisionSection initialData={initialData} onShare={onShare} />}
          {planSubTab === 'analyzer' && <McastAnalyzerSection initialData={initialData} onShare={onShare} />}
        </div>
      )}
    </div>
  );
}

window.MulticastToolkit = MulticastToolkit;
