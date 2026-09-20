const { useState, useEffect, useCallback, useRef, useMemo } = React;

function MTUCalc({ onShare, initialData }) {
  const { t } = useTranslation();
  const [baseMtu, setBaseMtu] = usePersistentState('mtu:baseMtu', initialData?.baseMtu ?? '1500');
  const [encaps, setEncaps] = usePersistentState('mtu:encaps', initialData?.encaps ?? {
    dot1q:false, qinq:false, pppoe:false,
    mpls1:false, mpls2:false, mpls3:false,
    gre:false, gre6:false,
    ipsec_ah:false, ipsec_esp:false,
    vxlan:false, geneve:false,
  });

  useEffect(() => {
    if (initialData) {
      if (initialData.baseMtu !== undefined) setBaseMtu(initialData.baseMtu);
      if (initialData.encaps !== undefined) setEncaps(initialData.encaps);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (baseMtu) (e.detail?.respond ?? onShare)({ tool: 'mtu', baseMtu, encaps });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [baseMtu, encaps, onShare]);

  const ENCAP_DEFS = [
    {key:'dot1q',    label:t('mtu.dot1q'),        bytes:4,  std:'IEEE 802.1Q',  note:t('mtu.dot1q_note')},
    {key:'qinq',     label:t('mtu.qinq'),         bytes:4,  std:'IEEE 802.1ad', note:t('mtu.qinq_note')},
    {key:'pppoe',    label:t('mtu.pppoe'),        bytes:8,  std:<RFCLink rfc="RFC 2516" />,     note:t('mtu.pppoe_note')},
    {key:'mpls1',    label:t('mtu.mpls1'),        bytes:4,  std:<RFCLink rfc="RFC 3032" />,     note:t('mtu.mpls1_note')},
    {key:'mpls2',    label:t('mtu.mpls2'),        bytes:4,  std:<RFCLink rfc="RFC 3032" />,     note:t('mtu.mpls2_note')},
    {key:'mpls3',    label:t('mtu.mpls3'),        bytes:4,  std:<RFCLink rfc="RFC 3032" />,     note:t('mtu.mpls3_note')},
    {key:'gre',      label:t('mtu.gre'),          bytes:24, std:<RFCLink rfc="RFC 2784" />,     note:t('mtu.gre_note')},
    {key:'gre6',     label:t('mtu.gre6'),         bytes:44, std:<RFCLink rfc="RFC 7676" />,     note:t('mtu.gre6_note')},
    {key:'ipsec_ah', label:t('mtu.ipsec_ah'),     bytes:28, std:<RFCLink rfc="RFC 4302" />,     note:t('mtu.ipsec_ah_note')},
    {key:'ipsec_esp',label:t('mtu.ipsec_esp'),    bytes:57, std:<RFCLink rfc="RFC 4303" />,     note:t('mtu.ipsec_esp_note')},
    {key:'vxlan',    label:t('mtu.vxlan'),        bytes:50, std:<RFCLink rfc="RFC 7348" />,     note:t('mtu.vxlan_note')},
    {key:'geneve',   label:t('mtu.geneve'),       bytes:50, std:<RFCLink rfc="RFC 8926" />,     note:t('mtu.geneve_note')},
  ];

  const toggle = k => setEncaps(p=>({...p,[k]:!p[k]}));
  const base    = parseInt(baseMtu)||1500;
  const active  = ENCAP_DEFS.filter(e=>encaps[e.key]);
  const overhead= active.reduce((s,e)=>s+e.bytes,0);
  const payload = base - overhead;
  const tcpMss  = Math.max(0, payload - 40);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('mtu.base_mtu')}</div>
        <div className="field">
          <label className="label">{t('mtu.starting_mtu')}</label>
          <div className="input-row">
            <input className="input" value={baseMtu} onChange={e=>setBaseMtu(e.target.value)} placeholder="1500" style={{maxWidth:120}}/>
            <select className="input" style={{width:240}} value={baseMtu} onChange={e=>setBaseMtu(e.target.value)}>
              <option value="1500">{t('mtu.std_1500')}</option>
              <option value="9000">{t('mtu.jumbo_9000')}</option>
              <option value="9216">{t('mtu.jumbo_nexus')}</option>
              <option value="9126">{t('mtu.jumbo_aci')}</option>
              <option value="4470">{t('mtu.fddi_4470')}</option>
              <option value="1492">{t('mtu.pppoe_1492')}</option>
              <option value="576">{t('mtu.ipv4_min_576')}</option>
              <option value="1280">{t('mtu.ipv6_min_1280')}</option>
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('mtu.encap_layers')}</div>
        <div className="hint" style={{marginBottom:12}}>{t('mtu.encap_hint')}</div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))',gap:8}}>
          {ENCAP_DEFS.map(e=>(
            <div key={e.key} onClick={()=>toggle(e.key)} style={{
              padding:'10px 14px',borderRadius:'var(--radius)',cursor:'pointer',
              border:`1px solid ${encaps[e.key]?'var(--cyan)':'var(--border)'}`,
              background:encaps[e.key]?'rgba(0,212,200,.08)':'var(--card)',
              transition:'border-color .15s,background .15s',userSelect:'none',
            }}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                <span style={{fontWeight:600,fontSize:13,color:encaps[e.key]?'var(--cyan)':'var(--text)'}}>{e.label}</span>
                <span className={`badge ${encaps[e.key]?'badge-red':'badge-blue'}`}>+{e.bytes}B</span>
              </div>
              <div style={{fontSize:11,color:'var(--muted)'}}>{e.std} — {e.note}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('mtu.mtu_budget')}</div>
        <div className="result-grid grid-mobile-1">
          <ResultItem label={t('mtu.base')}            value={`${base} B`}/>
          <ResultItem label={t('mtu.total_overhead')}      value={`${overhead} B`} red={overhead>0}/>
          <ResultItem label={t('mtu.avail_payload')}   value={`${payload} B`} accent/>
          <ResultItem label={t('mtu.rec_tcp_mss')} value={`${tcpMss} B`} green={tcpMss>0}/>
        </div>

        {active.length>0 && (
          <div style={{marginTop:16}}>
            <div className="label" style={{marginBottom:8}}>{t('mtu.overhead_breakdown')}</div>
            <div className="table-wrap hide-mobile"><table>
              <thead><tr><th>{t('mtu.layer')}</th><th>{t('mtu.standard')}</th><th>{t('mtu.overhead')}</th><th>{t('mtu.running_mtu')}</th></tr></thead>
              <tbody>
                <tr><td>{t('mtu.base')}</td><td>—</td><td>—</td><td style={{fontFamily:'var(--mono)',color:'var(--cyan)'}}>{base} B</td></tr>
                {active.map((e,i)=>{
                  const run=base-active.slice(0,i+1).reduce((s,x)=>s+x.bytes,0);
                  return (
                    <tr key={e.key}>
                      <td>{e.label}</td>
                      <td><span className="badge badge-blue">{e.std}</span></td>
                      <td style={{fontFamily:'var(--mono)',color:'var(--red)'}}>−{e.bytes} B</td>
                      <td style={{fontFamily:'var(--mono)',color:run<576?'var(--red)':run<1280?'var(--yellow)':'var(--cyan)'}}>{run} B</td>
                    </tr>
                  );
                })}
              </tbody>
            </table></div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              <div className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('mtu.base')}</span>
                  <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{base} B</span>
                </div>
              </div>
              {active.map((e,i) => {
                const run=base-active.slice(0,i+1).reduce((s,x)=>s+x.bytes,0);
                return (
                  <div key={e.key} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{e.label}</span>
                      <span className="mobile-card-value" style={{color:'var(--red)'}}>-{e.bytes} B</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('mtu.running_mtu')}</span>
                      <span className="mobile-card-value" style={{color:run<576?'var(--red)':run<1280?'var(--yellow)':'var(--cyan)', fontWeight:600}}>{run} B</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div style={{marginTop:16}}>
          <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>{t('mtu.mtu_utilization')}</div>
          <div style={{height:12,background:'var(--border)',borderRadius:'var(--radius)',overflow:'hidden',display:'flex'}}>
            <div style={{width:`${base>0?Math.min(100,(overhead/base)*100):0}%`,background:'var(--red)',transition:'width .3s'}}/>
            <div style={{width:`${base>0?Math.min(100,(Math.max(0,payload)/base)*100):0}%`,background:'var(--green)',transition:'width .3s'}}/>
          </div>
          <div style={{display:'flex',gap:20,marginTop:6,fontSize:12}}>
            <span style={{color:'var(--red)'}}>{t('mtu.overhead')}: {overhead}B ({base>0?((overhead/base)*100).toFixed(1):0}%)</span>
            <span style={{color:'var(--green)'}}>{t('common.input')}: {Math.max(0,payload)}B ({base>0?((Math.max(0,payload)/base)*100).toFixed(1):0}%)</span>
          </div>
          {payload<576 && <div style={{marginTop:8,padding:'8px 12px',background:'rgba(239,68,68,.1)',border:'1px solid var(--red)',borderRadius:'var(--radius)',color:'var(--red)',fontSize:12}}>{t('mtu.err_ipv4_min', {payload})}</div>}
          {payload>=576 && payload<1280 && <div style={{marginTop:8,padding:'8px 12px',background:'rgba(245,158,11,.1)',border:'1px solid var(--yellow)',borderRadius:'var(--radius)',color:'var(--yellow)',fontSize:12}}>{t('mtu.err_ipv6_min', {payload})}</div>}
          {payload>=1280 && overhead>0 && (
            <div style={{marginTop:8,padding:'10px 14px',background:'var(--card)',border:'1px solid var(--border)',borderRadius:'var(--radius)',fontFamily:'var(--mono)',fontSize:12}}>
              <div style={{color:'var(--muted)',marginBottom:4}}>{t('mtu.ios_hint')}</div>
              <div style={{color:'var(--cyan)'}}>ip mtu {payload}</div>
              <div style={{color:'var(--cyan)'}}>ip tcp adjust-mss {tcpMss}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tool: DHCP Scope Planner ─────────────────────────────────
window.MTUCalc = MTUCalc;
