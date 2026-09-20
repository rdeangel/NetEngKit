const { useState, useEffect, useCallback, useRef, useMemo } = React;

function BGPLookingGlass({ onShare, initialData }) {
  const { t } = useTranslation();
  const [target, setTarget] = usePersistentState('bgp-lg:target', initialData?.target ?? '');
  const [loading, setLoading] = useState(false);
  const [data, setData] = usePersistentState('bgp-lg:data', null);
  const [selectedIdx, setSelectedIdx] = usePersistentState('bgp-lg:selectedIdx', 0);

  useEffect(() => {
    if (initialData) {
      if (initialData.target !== undefined) setTarget(initialData.target);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (target) (e.detail?.respond ?? onShare)({ tool: 'bgp-lg', target });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [target, onShare]);

  const query = async () => {
    if (!target) return;
    setLoading(true);
    setSelectedIdx(0);
    try {
      const [ovRes, statRes, bgpRes] = await Promise.all([
        fetch(`https://stat.ripe.net/data/prefix-overview/data.json?resource=${target}`),
        fetch(`https://stat.ripe.net/data/routing-status/data.json?resource=${target}`),
        fetch(`https://stat.ripe.net/data/bgp-state/data.json?resource=${target}`)
      ]);

      const ov = await ovRes.json();
      const status = await statRes.json();
      const bgp = await bgpRes.json();

      setData({
        overview: ov.data,
        status: status.data,
        bgp: bgp.data
      });
    } catch (e) {
      setData({ error: t('bgp_lg.err_query') });
    }
    setLoading(false);
  };

  const renderResult = () => {
    if (data.error) return <Err msg={data.error} />;

    const ov = data.overview;
    const st = data.status;
    const bgp = data.bgp;

    // Visibility calculation
    const v4 = st.visibility?.v4;
    const visibilityText = v4 ? `${v4.ris_peers_seeing} / ${v4.total_ris_peers} RIS Peers (${Math.round(v4.ris_peers_seeing/v4.total_ris_peers*100)}%)` : 'N/A';

    // Sample BGP Paths
    const states = bgp.bgp_state || [];
    const currentPath = states[selectedIdx];
    const asPath = currentPath?.path?.join(' → ') || 'N/A';
    const communities = currentPath?.community?.join(', ') || t('common.no_results');

    // Unique Paths Summary
    const pathCounts = {};
    states.forEach(s => {
      const p = s.path.join(' ');
      pathCounts[p] = (pathCounts[p] || 0) + 1;
    });
    const uniquePaths = Object.keys(pathCounts).length;

    return (
      <div className="fadein" style={{marginTop:20}}>
        <div className="result-grid">
          <ResultItem label={t('bgp_lg.resource')} value={ov.resource} />
          <ResultItem label={t('bgp_lg.status')} value={ov.announced ? t('bgp_lg.announced') : t('bgp_lg.not_announced')} />
          <ResultItem label={t('bgp_lg.visibility')} value={visibilityText} />
          <ResultItem label={t('bgp_lg.diversity')} value={t('bgp_lg.diversity_desc', {unique: uniquePaths, total: states.length})} />

          {ov.asns && ov.asns.map((as, i) => (
            <ResultItem key={i} label={t('bgp_lg.origin_asn', {asn: as.asn})} value={as.holder} />
          ))}

          <ResultItem label={t('bgp_lg.first_seen')} value={st.first_seen?.time?.split('T')[0] || 'Unknown'} />
          <ResultItem label={t('bgp_lg.registry')} value={ov.block?.desc || 'N/A'} />
        </div>

        <div style={{marginTop:24, padding:16, background:'var(--panel)', borderRadius:8, border:'1px solid var(--border)'}}>
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:12}}>
             <div style={{fontSize:10, color:'var(--muted)', textTransform:'uppercase', fontWeight:600}}>{t('bgp_lg.observation_point')}</div>
             <select
                className="input"
                style={{width:'auto', minWidth:200, fontSize:11, padding:'2px 8px', height:24}}
                value={selectedIdx}
                onChange={e => setSelectedIdx(parseInt(e.target.value))}
              >
                {states.map((s, i) => (
                  <option key={i} value={i}>{t('bgp_lg.peer_ip', {ip: s.source_id.split('-')[1], rrc: s.source_id.split('-')[0]})}</option>
                ))}
              </select>
          </div>

          <div className="field">
            <label className="label">{t('bgp_lg.as_path_peer')}</label>
            <div style={{fontFamily:'monospace', fontSize:13, color:'var(--purple)', wordBreak:'break-all', lineHeight:1.4, background:'rgba(167, 139, 250, 0.05)', padding:8, borderRadius:4, border:'1px solid rgba(167, 139, 250, 0.2)'}}>
              {currentPath?.path?.map((asn, i) => (
                <span key={i}>
                  <span title={`ASN: ${asn}`} style={{fontWeight:600}}>{asn}</span>
                  {i < currentPath.path.length - 1 && <span style={{color:'var(--dim)', margin:'0 6px'}}>→</span>}
                </span>
              )) || t('bgp_lg.no_path')}
            </div>
          </div>

          <div className="field" style={{marginTop:12}}>
            <label className="label">{t('bgp_lg.communities')}</label>
            <div style={{fontFamily:'monospace', fontSize:11, color:'var(--dim)', wordBreak:'break-all'}}>{communities}</div>
          </div>
        </div>

        {(st.less_specifics?.length > 0 || st.more_specifics?.length > 0) && (
          <div style={{marginTop:16}}>
            <div style={{fontSize:10, color:'var(--muted)', textTransform:'uppercase', marginBottom:8, fontWeight:600}}>{t('bgp_lg.related_prefixes')}</div>
            <div style={{display:'flex', flexWrap:'wrap', gap:6}}>
              {st.less_specifics.map((p, i) => <span key={i} className="badge" style={{background:'var(--blue-glass)', border:'1px solid var(--blue)'}}>{t('bgp_lg.parent', {prefix: p.prefix})}</span>)}
              {st.more_specifics.slice(0, 10).map((p, i) => <span key={i} className="badge" style={{background:'var(--purple-glass)', border:'1px solid var(--purple)'}}>{p.prefix}</span>)}
              {st.more_specifics.length > 10 && <span className="badge">{t('bgp_lg.more', {count: st.more_specifics.length - 10})}</span>}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('bgp_lg.title')}</div>
        <div className="input-row">
          <input
            className="input"
            value={target}
            onChange={e => setTarget(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && query()}
            placeholder={t('bgp_lg.placeholder')}
          />
          <button className="btn btn-primary" onClick={query} disabled={loading}>{loading ? t('bgp_lg.querying') : t('bgp_lg.query')}</button>
        </div>
        {data && renderResult()}
        <div className="hint" style={{marginTop:12}}>
          <strong>{t('bgp_lg.about_peers')}</strong> {t('bgp_lg.about_peers_desc')}
        </div>
      </div>
    </div>
  );
}

// ─── LACP Simulator ─────────────────────────────────────────────
window.BGPLookingGlass = BGPLookingGlass;
