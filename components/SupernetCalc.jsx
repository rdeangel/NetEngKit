const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SupernetCalc({ onShare, initialData }) {
  const { t } = useTranslation();
  const [lines, setLines] = usePersistentState('supernet:lines', initialData?.lines ?? '192.168.0.0/24\n192.168.1.0/24\n192.168.2.0/24\n192.168.3.0/24');
  const [result, setResult] = usePersistentState('supernet:result', null);
  const [err, setErr] = useState('');

  const calc = () => {
    setErr(''); setResult(null);
    const entries = lines.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (!entries.length) { setErr(t('supernet.err_at_least_one')); return; }
    const parsed = entries.map(e => {
      const c = IPv4.parseCIDR(e);
      if (!c) { const ip = IPv4.parse(e); return ip !== null ? { ip, prefix: 32 } : null; }
      return c;
    });
    if (parsed.some(p => !p)) { setErr(t('supernet.err_invalid_entries')); return; }
    const networks = parsed.map(p => IPv4.subnet(p.ip, p.prefix));
    const allIPs = networks.flatMap(n => [n.network, n.broadcast]);
    const sup = IPv4.supernet(allIPs);
    setResult({ networks, supernet: sup, inputs: entries });
  };

  useEffect(() => {
    if (initialData?.lines) {
      setLines(initialData.lines);
      calc(initialData.lines);
    } else {
      calc();
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (lines) (e.detail?.respond ?? onShare)({ tool: 'subnet-planner', mode: 'supernet', lines });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [lines, onShare]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('supernet.networks_to_summarize')}</div>
        <div className="field">
          <label className="label">{t('supernet.input_hint')}</label>
          <textarea className="input" rows={6} value={lines} onChange={e => setLines(e.target.value)} style={{resize:'vertical'}} />
        </div>
        <Err msg={err} />
        <button className="btn btn-primary" onClick={calc}>{t('supernet.summarize')}</button>
      </div>

      {result && (
        <div className="card fadein">
          <div className="card-title">{t('supernet.summary_route')}</div>
          <div className="result-grid grid-mobile-1" style={{marginBottom:16}}>
            <ResultItem label={t('supernet.supernet_cidr')} value={result.supernet.cidr} accent />
            <ResultItem label={t('subnet.network_addr')} value={result.supernet.networkStr} />
            <ResultItem label={t('subnet.broadcast_addr')} value={result.supernet.broadcastStr} />
            <ResultItem label={t('subnet.subnet_mask')} value={result.supernet.maskStr} />
            <ResultItem label={t('subnet.total_addr')} value={result.supernet.totalCount} />
            <ResultItem label={t('supernet.prefix_length')} value={`/${result.supernet.prefix}`} />
          </div>
          <div className="card-title">{t('supernet.input_networks')}</div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>{t('subnet.network_addr')}</th><th>{t('subnet.first_host')}</th><th>{t('subnet.last_host')}</th><th>{t('subnet.usable_hosts')}</th></tr></thead>
              <tbody>
                {result.networks.map((n, i) => (
                  <tr key={i}><td style={{color:'var(--cyan)'}}>{n.cidr}</td><td>{n.firstHostStr}</td><td>{n.lastHostStr}</td><td style={{color:'var(--green)'}}>{n.hostCount}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile View */}
          <div className="show-mobile mobile-cards">
            {result.networks.map((n, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('subnet.network_addr')}</span>
                  <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{n.cidr}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('nav.tools')}</span>
                  <span className="mobile-card-value" style={{fontSize:11}}>{n.firstHostStr} - {n.lastHostStr}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('subnet.usable_hosts')}</span>
                  <span className="mobile-card-value" style={{color:'var(--green)'}}>{n.hostCount}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool: IPv6 Tools ─────────────────────────────────────────
window.SupernetCalc = SupernetCalc;
