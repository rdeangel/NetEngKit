const { useState, useEffect, useCallback, useRef, useMemo } = React;

function RemoteDiagnostics({ onShare, initialData }) {
  const { t } = useTranslation();
  const [target, setTarget] = usePersistentState('diag:target', initialData?.target ?? '');
  const [results, setResults] = usePersistentState('diag:results', { local: null });
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (initialData) {
      if (initialData.target !== undefined) setTarget(initialData.target);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (target) (e.detail?.respond ?? onShare)({ tool: 'diag', target });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [target, onShare]);

  const runLocalPing = async (override) => {
    let q = (typeof override === 'string' ? override : target).trim();
    if (!q) { setErr(t('diag.err_target')); return; }
    if (!q.startsWith('http')) q = 'https://' + q;
    setLoading(true); setErr('');
    const start = performance.now();
    try {
      await fetch(q, { mode: 'no-cors', cache: 'no-cache' });
      setResults({ local: Math.round(performance.now() - start) });
    } catch {
      setErr(t('diag.err_failed'));
    }
    setLoading(false);
  };

  const openExternal = (site) => {
    const q = target.trim() || '8.8.8.8';
    const urls = {
      bgp: `https://bgp.tools/prefix/${q}`,
      ping: `https://ping.pe/${q}`,
      he: `https://bgpview.io/ip/${q}`,
      ripe: `https://atlas.ripe.net/measurements/?search=${q}`
    };
    window.open(urls[site], '_blank');
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('diag.title')}</div>
        <div className="field">
          <label className="label">{t('diag.label')}</label>
          <div className="input-row">
            <input className="input" placeholder={t('diag.placeholder')} value={target} onChange={e=>setTarget(e.target.value)} onKeyDown={e => e.key === 'Enter' && runLocalPing()} />
            <button className="btn btn-primary" onClick={() => runLocalPing()} disabled={loading}>{t('diag.web_ping')}</button>
            <button className="btn btn-ghost" onClick={() => openExternal('ping')} title={t('diag.deep_trace_hint')}>{t('diag.deep_trace')}</button>
          </div>
          <Err msg={err} />
        </div>
        <div style={{display:'flex', gap:8, flexWrap:'wrap', marginTop:4}}>
           <button className="btn btn-ghost btn-sm" onClick={() => { setTarget('1.1.1.1'); runLocalPing('1.1.1.1'); }} style={{fontSize:10}}>{t('diag.test_conn')}</button>
           <button className="btn btn-ghost btn-sm" onClick={() => openExternal('bgp')} style={{fontSize:10}}>{t('diag.verify_bgp')}</button>
        </div>
      </div>

      <div className="two-col grid-mobile-1">
        <div className="card">
          <div className="card-title">{t('diag.local_latency')}</div>
          {results.local ? (
            <div style={{textAlign:'center', padding:'10px 0'}}>
              <div style={{fontSize:42, fontWeight:700, color:results.local < 50 ? 'var(--green)' : results.local < 150 ? 'var(--yellow)' : 'var(--red)'}}>
                {results.local}<span style={{fontSize:16, fontWeight:400, color:'var(--muted)', marginLeft:4}}>{t('diag.ms')}</span>
              </div>
              <div style={{fontSize:11, color:'var(--muted)', marginTop:4}}>{t('diag.via_https')}</div>
            </div>
          ) : <div style={{padding:20, textAlign:'center', color:'var(--dim)', fontSize:12}}>{t('diag.requires_web')}</div>}
        </div>
        <div className="card">
          <div className="card-title">{t('diag.path_logic')}</div>
          <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.5}}>
             {t('diag.path_logic_desc')}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tool: DNS Lookup ─────────────────────────────────────────
window.RemoteDiagnostics = RemoteDiagnostics;
