const { useState, useEffect, useCallback, useRef, useMemo } = React;

function PortReference({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('ports:activeTab', initialData?.activeTab ?? 'ports');
  const [search, setSearch] = useState('');
  const [filterProto, setFilterProto] = useState('All');

  // Apply-down: sidebar sub-row → switch tab
  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      setActiveTab(initialData.activeTab);
      setSearch('');
      setFilterProto('All');
    }
  }, [initialData]);

  // Report-up: tab change → sidebar highlight follows
  useEffect(() => { onNav?.({ activeTab }); }, [activeTab]);

  // Share wiring
  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'ports', activeTab });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [activeTab, onShare]);

  // Reset search when switching tabs manually
  const switchTab = (tab) => {
    setActiveTab(tab);
    setSearch('');
    setFilterProto('All');
  };

  // Deduplicate PORT_DATA by serviceKey — PORT_DATA has ~20 exact duplicate entries
  // that cause React to produce duplicate row keys, which breaks table reconciliation
  // and makes the search filter appear frozen.
  const uniquePorts = useMemo(() => {
    const seen = new Set();
    return PORT_DATA.filter(p => {
      if (seen.has(p.serviceKey)) return false;
      seen.add(p.serviceKey);
      return true;
    });
  }, []);

  const filteredPorts = useMemo(() => {
    if (activeTab !== 'ports') return [];
    const q = search.toLowerCase();
    return uniquePorts.filter(p => {
      const svc  = t('ports_data.' + p.serviceKey).toLowerCase();
      const desc = t('ports_data.' + p.descKey).toLowerCase();
      const matchesSearch = !q || p.port.toString().includes(q) || svc.includes(q) || desc.includes(q) || p.proto.toLowerCase().includes(q);
      const matchesProto  = filterProto === 'All' || p.proto.includes(filterProto);
      return matchesSearch && matchesProto;
    });
  }, [activeTab, search, filterProto, uniquePorts, t]);

  const filteredProtocols = useMemo(() => {
    if (activeTab !== 'protocols') return [];
    const q = search.toLowerCase();
    return PROTOCOL_DATA.filter(p => {
      const name = t('protocols_data.' + p.nameKey).toLowerCase();
      const desc = t('protocols_data.' + p.descKey).toLowerCase();
      return !q || p.num.toString().includes(q) || name.includes(q) || desc.includes(q);
    });
  }, [activeTab, search, t]);

  const categoryColor = s => {
    if (['HTTP','HTTPS','HTTP Alt','HTTPS Alt'].includes(s)) return 'var(--cyan)';
    if (['SSH','SFTP','SMTPS','IMAPS','POP3S','HTTPS','LDAPS','DNS-over-TLS'].includes(s)) return 'var(--green)';
    if (['Telnet','FTP Control','FTP Data'].includes(s)) return 'var(--red)';
    if (['MySQL','PostgreSQL','MongoDB','MSSQL','Oracle DB','Redis','Elasticsearch'].includes(s)) return 'var(--yellow)';
    if (['BGP','OSPF','RIP','LDP'].includes(s)) return 'var(--purple)';
    return 'var(--text)';
  };

  return (
    <div className="fadein">
      <style>{`
        .port-tabs { display: flex; gap: 4px; background: var(--border); padding: 4px; borderRadius: 8px; }
        .port-tab {
          flex: 1; padding: 8px; border: none; background: transparent; color: var(--muted);
          cursor: pointer; border-radius: 6px; font-size: 12px; font-weight: 600; transition: all .2s;
        }
        .port-tab.active { background: var(--card); color: var(--primary); box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
      `}</style>

      <div className="card">
        <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16}}>
          <div className="card-title" style={{marginBottom:0}}>
            {activeTab === 'ports' ? t('ports.title_ports') : t('ports.title_protocols')}
          </div>
          <div className="port-tabs" style={{width:240}}>
            <button className={`port-tab ${activeTab === 'ports' ? 'active' : ''}`} onClick={() => switchTab('ports')}>{t('ports.tab_l4')}</button>
            <button className={`port-tab ${activeTab === 'protocols' ? 'active' : ''}`} onClick={() => switchTab('protocols')}>{t('ports.tab_l3')}</button>
          </div>
        </div>

        <div className="input-row">
          <input className="input" value={search} onChange={e => setSearch(e.target.value)}
            placeholder={activeTab === 'ports' ? t('ports.search_ports') : t('ports.search_protocols')} />

          {activeTab === 'ports' && (
            <select className="select" value={filterProto} onChange={e => setFilterProto(e.target.value)} style={{width:'auto',flexShrink:0}}>
              <option value="All">{t('ports.all')}</option>
              {['TCP','UDP'].map(p => <option key={p}>{p}</option>)}
            </select>
          )}
        </div>
        <div className="hint" style={{marginTop:6}}>
          {activeTab === 'ports'
            ? t('ports.shown_ports', { count: filteredPorts.length, total: uniquePorts.length })
            : t('ports.shown_protocols', { count: filteredProtocols.length, total: PROTOCOL_DATA.length })}
        </div>
      </div>

      <div className="card fadein" style={{padding:0,overflow:'hidden'}}>
        <div className="table-wrap hide-mobile" style={{maxHeight:'calc(100vh - 280px)',overflowY:'auto'}}>
          {activeTab === 'ports' && (
            <table>
              <thead><tr><th>{t('ports.header_port')}</th><th>{t('ports.header_transport')}</th><th>{t('ports.header_service')}</th><th>{t('ports.header_desc')}</th><th></th></tr></thead>
              <tbody>
                {filteredPorts.map(p => (
                  <tr key={p.serviceKey}>
                    <td style={{color:'var(--cyan)',fontWeight:600,fontFamily:'var(--mono)'}}>{p.port}</td>
                    <td><span className={`badge ${p.proto.includes('TCP')&&p.proto.includes('UDP')?'badge-purple':p.proto==='TCP'?'badge-blue':'badge-yellow'}`}>{p.proto}</span></td>
                    <td style={{color:categoryColor(p.service),fontFamily:'var(--sans)',fontWeight:500}}>{p.serviceKey ? t('ports_data.' + p.serviceKey) : p.service}</td>
                    <td style={{fontFamily:'var(--sans)',color:'var(--muted)'}}>{p.descKey ? t((activeTab === 'ports' ? 'ports_data.' : 'protocols_data.') + p.descKey) : p.desc}</td>
                    <td><CopyBtn text={String(p.port)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {activeTab === 'protocols' && (
            <table>
              <thead><tr><th>{t('ports.header_id')}</th><th>{t('ports.header_name')}</th><th>{t('ports.header_fullname')}</th><th>{t('ports.header_rfc')}</th><th></th></tr></thead>
              <tbody>
                {filteredProtocols.map(p => (
                  <tr key={p.num}>
                    <td style={{color:'var(--cyan)',fontWeight:600,fontFamily:'var(--mono)'}}>{p.num}</td>
                    <td style={{fontWeight:600,color:'var(--green)'}}>{p.nameKey ? t('protocols_data.' + p.nameKey) : p.name}</td>
                    <td style={{fontFamily:'var(--sans)',color:'var(--muted)'}}>{p.descKey ? t((activeTab === 'ports' ? 'ports_data.' : 'protocols_data.') + p.descKey) : p.desc}</td>
                    <td style={{color:'var(--dim)',fontSize:12}}><RFCLink rfc={p.rfc} /></td>
                    <td><CopyBtn text={String(p.num)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Mobile View */}
        <div className="show-mobile mobile-cards" style={{padding:16, maxHeight:'calc(100vh - 280px)', overflowY:'auto'}}>
          {activeTab === 'ports' && filteredPorts.map(p => (
            <div key={p.serviceKey} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('ports.header_port')}</span>
                <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{p.port} ({p.proto})</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('ports.header_service')}</span>
                <span className="mobile-card-value" style={{color:categoryColor(p.service)}}>{p.serviceKey ? t('ports_data.' + p.serviceKey) : p.service}</span>
              </div>
              <div className="mobile-card-row" style={{flexDirection:'column', alignItems:'flex-start', borderBottom:'none'}}>
                <span className="mobile-card-label" style={{marginBottom:4}}>{t('ports.header_desc')}</span>
                <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{p.descKey ? t((activeTab === 'ports' ? 'ports_data.' : 'protocols_data.') + p.descKey) : p.desc}</span>
              </div>
              <div style={{marginTop:8, display:'flex', justifyContent:'flex-end'}}>
                <CopyBtn text={String(p.port)} label={t('ports.copy_port')} />
              </div>
            </div>
          ))}
          {activeTab === 'protocols' && filteredProtocols.map(p => (
            <div key={p.num} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('ports.header_id')}</span>
                <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{p.num}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('ports.header_name')}</span>
                <span className="mobile-card-value" style={{color:'var(--green)', fontWeight:600}}>{p.nameKey ? t('protocols_data.' + p.nameKey) : p.name}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('ports.header_rfc')}</span>
                <span className="mobile-card-value"><RFCLink rfc={p.rfc} /></span>
              </div>
              <div className="mobile-card-row" style={{flexDirection:'column', alignItems:'flex-start', borderBottom:'none'}}>
                <span className="mobile-card-label" style={{marginBottom:4}}>{t('ports.header_desc')}</span>
                <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{p.descKey ? t((activeTab === 'ports' ? 'ports_data.' : 'protocols_data.') + p.descKey) : p.desc}</span>
              </div>
              <div style={{marginTop:8, display:'flex', justifyContent:'flex-end'}}>
                <CopyBtn text={String(p.num)} label={t('ports.copy_id')} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {activeTab === 'protocols' && (
        <div className="card fadein hint" style={{marginTop:12}}>
          <strong>{t('ports.protocol_note')}</strong> {t('ports.protocol_note_desc')}
        </div>
      )}
    </div>
  );
}

// ─── Tool: BGP / ASN Lookup ───────────────────────────────────
window.PortReference = PortReference;
