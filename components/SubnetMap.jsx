const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SubnetMap({ onShare, initialData }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('map:input', initialData?.input ?? '10.0.0.0/22');
  const [splitTo, setSplitTo] = usePersistentState('map:splitTo', initialData?.splitTo ?? 24);
  const [result, setResult] = usePersistentState('map:result', null);
  const [err, setErr] = useState('');

  const calc = () => {
    setErr(''); setResult(null);
    const c = IPv4.parseCIDR(input);
    if (!c) { setErr(t('range.err_invalid_cidr')); return; }
    if (splitTo <= c.prefix) { setErr(t('map.err_prefix_gt', { prefix: c.prefix })); return; }
    if (splitTo - c.prefix > 12) { setErr(t('map.err_max_depth')); return; }
    const parent = IPv4.subnet(c.ip, c.prefix);
    const count = Math.pow(2, splitTo - c.prefix);
    const subnets = [];
    for (let i = 0; i < count; i++) {
      const subNet = (parent.network + i * Math.pow(2, 32 - splitTo)) >>> 0;
      subnets.push(IPv4.subnet(subNet, splitTo));
    }
    setResult({ parent, subnets, splitTo });
  };

  useEffect(() => {
    if (initialData) {
      if (initialData.input !== undefined) setInput(initialData.input);
      if (initialData.splitTo !== undefined) setSplitTo(initialData.splitTo);
    }
    calc();
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (input) (e.detail?.respond ?? onShare)({ tool: 'subnet', mode: 'map', input, splitTo });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [input, splitTo, onShare]);

  const COLORS = ['#00d4c8','#4a9eff','#22c55e','#f59e0b','#a78bfa','#f97316','#ec4899','#14b8a6','#e11d48','#6366f1'];

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('map.configuration')}</div>
        <div className="two-col grid-mobile-1">
          <div className="field"><label className="label">{t('map.parent_network')}</label>
            <input className="input" value={input} onChange={e => setInput(e.target.value)} placeholder="10.0.0.0/22" /></div>
          <div className="field"><label className="label">{t('map.split_into', { prefix: splitTo })}</label>
            <input className="input" type="number" min="1" max="32" value={splitTo} onChange={e => setSplitTo(parseInt(e.target.value)||24)} /></div>
        </div>
        <Err msg={err} />
        <button className="btn btn-primary" onClick={calc}>{t('map.generate')}</button>
      </div>

      {result && (
        <>
          <div className="card fadein">
            <div className="card-title">{t('map.visual_map', { parent: result.parent.cidr, count: result.subnets.length, prefix: result.splitTo })}</div>
            <div style={{display:'flex',gap:2,flexWrap:'wrap',marginBottom:8}}>
              {result.subnets.map((sn, i) => (
                <div key={i} title={`${sn.cidr}\n${sn.firstHostStr} – ${sn.lastHostStr}`}
                  style={{
                    flex:`0 0 ${(100/result.subnets.length).toFixed(2)}%`,
                    minWidth:20,height:36,background:`${COLORS[i%COLORS.length]}22`,
                    border:`1px solid ${COLORS[i%COLORS.length]}44`,borderRadius:3,
                    display:'flex',alignItems:'center',justifyContent:'center',
                    fontSize:9,fontFamily:'var(--mono)',color:COLORS[i%COLORS.length],
                    cursor:'default',transition:'all .15s',overflow:'hidden',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background=`${COLORS[i%COLORS.length]}44`}
                  onMouseLeave={e => e.currentTarget.style.background=`${COLORS[i%COLORS.length]}22`}
                >
                  {result.subnets.length <= 16 ? sn.networkStr.split('.').slice(-2).join('.') : ''}
                </div>
              ))}
            </div>
            <div style={{fontSize:11,color:'var(--dim)'}}>{t('map.hover_hint', { count: result.subnets.length, hosts: result.subnets[0].hostCount })}</div>
          </div>
          <div className="card fadein">
            <div className="card-title">{t('map.subnet_table', { count: result.subnets.length })}</div>
            <div className="table-wrap hide-mobile" style={{maxHeight:400,overflowY:'auto'}}>
              <table>
                <thead><tr><th>{t('common.th_num')}</th><th>{t('subnet.network_addr')}</th><th>{t('common.th_cidr')}</th><th>{t('subnet.first_host')}</th><th>{t('subnet.last_host')}</th><th>{t('subnet.broadcast_addr')}</th><th>{t('subnet.usable_hosts')}</th></tr></thead>
                <tbody>
                  {result.subnets.map((sn, i) => (
                    <tr key={i}>
                      <td style={{color:'var(--dim)'}}>{i+1}</td>
                      <td style={{color:`${COLORS[i%COLORS.length]}`}}>{sn.networkStr}</td>
                      <td>{sn.cidr}</td>
                      <td>{sn.firstHostStr}</td>
                      <td>{sn.lastHostStr}</td>
                      <td style={{color:'var(--red)'}}>{sn.broadcastStr}</td>
                      <td style={{color:'var(--green)'}}>{sn.hostCount}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards" style={{maxHeight:400, overflowY:'auto'}}>
              {result.subnets.map((sn, i) => (
                <div key={i} className="mobile-card" style={{borderLeft:`3px solid ${COLORS[i%COLORS.length]}`}}>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('subnet.title')} {i+1}</span>
                    <span className="mobile-card-value" style={{color:`${COLORS[i%COLORS.length]}`, fontWeight:600}}>{sn.networkStr}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">CIDR</span>
                    <span className="mobile-card-value">{sn.cidr}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('nav.tools')}</span>
                    <span className="mobile-card-value" style={{fontSize:10}}>{sn.firstHostStr} - {sn.lastHostStr}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('subnet.usable_hosts')}</span>
                    <span className="mobile-card-value" style={{color:'var(--green)'}}>{sn.hostCount}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="btn-row">
              <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(result.subnets.map((sn,i)=>({index:i+1,cidr:sn.cidr,network:sn.networkStr,firstHost:sn.firstHostStr,lastHost:sn.lastHostStr,broadcast:sn.broadcastStr,hosts:sn.hostCount})),'subnet-map.csv')}>{t('common.export_csv')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => exportJSON(result.subnets,'subnet-map.json')}>{t('common.export_json')}</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Tool: Remote Diagnostics ────────────────────────────────
window.SubnetMap = SubnetMap;
