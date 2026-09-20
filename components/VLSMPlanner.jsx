const { useState, useEffect, useCallback, useRef, useMemo } = React;

function VLSMPlanner({ onShare, initialData }) {
  const { t } = useTranslation();
  const [network, setNetwork] = usePersistentState('vlsm:network', initialData?.network ?? '192.168.1.0/24');
  const [reqs, setReqs] = usePersistentState('vlsm:reqs', initialData?.reqs ?? [
    { name: 'Sales', hosts: 50 },
    { name: 'Engineering', hosts: 30 },
    { name: 'HR', hosts: 14 },
    { name: 'Servers', hosts: 6 },
    { name: 'Management', hosts: 2 },
  ]);
  const [result, setResult] = usePersistentState('vlsm:result', null);
  const [err, setErr] = useState('');

  const addReq = () => setReqs(r => [...r, { name: '', hosts: 10 }]);
  const remReq = i => setReqs(r => r.filter((_, j) => j !== i));
  const updateReq = (i, k, v) => setReqs(r => r.map((req, j) => j === i ? { ...req, [k]: k === 'hosts' ? parseInt(v) || 0 : v } : req));

  const calc = () => {
    setErr(''); setResult(null);
    const c = IPv4.parseCIDR(network);
    if (!c) { setErr(t('vlsm.err_parent')); return; }
    const filtered = reqs.filter(r => r.name || r.hosts > 0);
    if (!filtered.length) { setErr(t('vlsm.err_at_least_one')); return; }
    const res = IPv4.vlsm(c.ip, c.prefix, filtered);
    setResult({ allocations: res, parent: IPv4.subnet(c.ip, c.prefix) });
  };

  useEffect(() => {
    if (initialData) {
      if (initialData.network !== undefined) setNetwork(initialData.network);
      if (initialData.reqs !== undefined) setReqs(initialData.reqs);
    }
    calc();
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (network) (e.detail?.respond ?? onShare)({ tool: 'subnet-planner', mode: 'vlsm', network, reqs });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [network, reqs, onShare]);

  const PALETTE = ['var(--cyan)','var(--blue)','var(--green)','var(--yellow)','var(--purple)','#f97316','#ec4899','#14b8a6'];

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('vlsm.parent_network')}</div>
        <div className="field">
          <label className="label">{t('vlsm.network_cidr')}</label>
          <input className="input" style={{maxWidth:220}} value={network} onChange={e => setNetwork(e.target.value)} placeholder="192.168.1.0/24" />
        </div>
        <div className="card-title" style={{marginTop:8}}>{t('vlsm.subnet_reqs')}</div>
        {reqs.map((r, i) => (
          <div key={i} className="vlsm-row">
            <input className="input" value={r.name} onChange={e => updateReq(i,'name',e.target.value)} placeholder={`${t('vlsm.subnet_name_placeholder')} ${i+1}`} />
            <input className="input" type="number" value={r.hosts} onChange={e => updateReq(i,'hosts',e.target.value)} placeholder={t('vlsm.hosts')} min="1" />
            <button className="btn btn-danger btn-sm" onClick={() => remReq(i)}>✕</button>
          </div>
        ))}
        <Err msg={err} />
        <div className="btn-row" style={{marginTop:16}}>
          <button className="btn btn-ghost" onClick={addReq}>{t('vlsm.add_subnet')}</button>
          <button className="btn btn-primary" onClick={calc}>{t('vlsm.calculate')}</button>
        </div>
      </div>

      {result && (
        <>
          <div className="card fadein">
            <div className="card-title">{t('vlsm.visual_map', { parent: result.parent.cidr })}</div>
            {/* Proportional bar */}
            <div style={{display:'flex',height:36,borderRadius:6,overflow:'hidden',border:'1px solid var(--border)',marginBottom:14,gap:1}}>
              {result.allocations.filter(a => a.subnet).map((a, i) => {
                const pct = (a.subnet.totalHosts / result.parent.totalHosts * 100);
                return (
                  <div key={i} title={`${a.name||t('subnet.title')+' '+(i+1)}: ${a.subnet.cidr} (${a.subnet.hostCount} hosts)`}
                    style={{flex:`0 0 ${pct}%`,background:`${PALETTE[i%PALETTE.length]}33`,borderRight:`1px solid ${PALETTE[i%PALETTE.length]}66`,display:'flex',alignItems:'center',justifyContent:'center',overflow:'hidden',minWidth:2}}
                  >
                    {pct > 8 && <span style={{fontSize:10,fontFamily:'var(--mono)',color:PALETTE[i%PALETTE.length],fontWeight:600,whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',padding:'0 4px'}}>{a.subnet.cidr}</span>}
                  </div>
                );
              })}
              {/* Unused space */}
              {(() => {
                const used = result.allocations.filter(a=>a.subnet).reduce((s,a)=>s+a.subnet.totalHosts,0);
                const pct = ((result.parent.totalHosts - used) / result.parent.totalHosts * 100);
                return pct > 0 ? <div style={{flex:`0 0 ${pct}%`,background:'rgba(255,255,255,.03)',display:'flex',alignItems:'center',justifyContent:'center'}}>{pct > 8 && <span style={{fontSize:10,color:'var(--dim)',fontFamily:'var(--mono)'}}>{t('vlsm.free')}</span>}</div> : null;
              })()}
            </div>
            {/* Legend */}
            <div style={{display:'flex',flexWrap:'wrap',gap:8,marginBottom:8}}>
              {result.allocations.filter(a => a.subnet).map((a, i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:5,fontSize:12}}>
                  <div style={{width:10,height:10,borderRadius:2,background:PALETTE[i%PALETTE.length],flexShrink:0}}/>
                  <span style={{color:'var(--muted)'}}>{a.name||`${t('subnet.title')} ${i+1}`}</span>
                  <span style={{fontFamily:'var(--mono)',color:PALETTE[i%PALETTE.length],fontSize:11}}>{a.subnet.cidr}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="card fadein">
            <div className="card-title">{t('vlsm.allocation_table')}</div>
            <div className="table-wrap hide-mobile">
              <table>
                <thead><tr><th>{t('common.th_num')}</th><th>{t('common.name')}</th><th>{t('vlsm.required_hosts')}</th><th>{t('common.th_cidr')}</th><th>{t('subnet.usable_hosts')}</th><th>{t('subnet.first_host')}</th><th>{t('subnet.last_host')}</th><th>{t('subnet.broadcast_addr')}</th></tr></thead>
                <tbody>
                  {result.allocations.map((a, i) => (
                    <tr key={i}>
                      <td style={{color:'var(--dim)'}}>{i+1}</td>
                      <td style={{fontFamily:'var(--sans)',fontWeight:500}}>{a.name || `${t('subnet.title')} ${i+1}`}</td>
                      <td style={{color:'var(--yellow)'}}>{a.hosts}</td>
                      {a.error ? <td colSpan={5} style={{color:'var(--red)'}}>{a.error}</td> : <>
                        <td style={{color:'var(--cyan)'}}>{a.subnet.cidr}</td>
                        <td style={{color:'var(--green)'}}>{a.subnet.hostCount}</td>
                        <td>{a.subnet.firstHostStr}</td>
                        <td>{a.subnet.lastHostStr}</td>
                        <td>{a.subnet.broadcastStr}</td>
                      </>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              {result.allocations.map((a, i) => (
                <div key={i} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('subnet.title')} {i+1}</span>
                    <span className="mobile-card-value" style={{fontWeight:600}}>{a.name || 'Unnamed'}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('common.req_usable')}</span>
                    <span className="mobile-card-value">{a.hosts} / <span style={{color:'var(--green)'}}>{a.subnet?.hostCount || 0}</span></span>
                  </div>
                  {a.error ? (
                    <div className="mobile-card-row">
                      <span className="mobile-card-label" style={{color:'var(--red)'}}>Error</span>
                      <span className="mobile-card-value" style={{color:'var(--red)'}}>{a.error}</span>
                    </div>
                  ) : (
                    <>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">CIDR</span>
                        <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{a.subnet.cidr}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('nav.tools')}</span>
                        <span className="mobile-card-value" style={{fontSize:11}}>{a.subnet.firstHostStr} - {a.subnet.lastHostStr}</span>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            <div className="btn-row">
              <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(
                result.allocations.filter(a=>a.subnet).map(a=>({name:a.name,required:a.hosts,cidr:a.subnet.cidr,mask:a.subnet.maskStr,network:a.subnet.networkStr,firstHost:a.subnet.firstHostStr,lastHost:a.subnet.lastHostStr,broadcast:a.subnet.broadcastStr,usable:a.subnet.hostCount})),
                'vlsm.csv')}>{t('common.export_csv')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => exportJSON(result.allocations,'vlsm.json')}>{t('common.export_json')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tool: Wildcard Mask ─────────────────────────────────────
window.VLSMPlanner = VLSMPlanner;
