const { useState, useEffect, useCallback, useRef, useMemo } = React;

function RangeCIDR({ onShare, initialData }) {
  const { t } = useTranslation();
  const [mode, setMode] = usePersistentState('range:mode', initialData?.mode ?? 'range2cidr');
  const [start, setStart] = usePersistentState('range:start', initialData?.start ?? '10.0.0.0');
  const [end, setEnd] = usePersistentState('range:end', initialData?.end ?? '10.0.0.255');
  const [cidrIn, setCidrIn] = usePersistentState('range:cidrIn', initialData?.cidrIn ?? '10.0.1.0/24');
  const [result, setResult] = usePersistentState('range:result', null);
  const [err, setErr] = useState('');

  const calc = () => {
    setErr(''); setResult(null);
    if (mode === 'range2cidr') {
      const s = IPv4.parse(start), e = IPv4.parse(end);
      if (s === null) { setErr(t('range.err_invalid_start')); return; }
      if (e === null) { setErr(t('range.err_invalid_end')); return; }
      if (s > e) { setErr(t('range.err_start_le_end')); return; }
      const cidrs = IPv4.rangeToCIDRs(s, e);
      setResult({ mode, cidrs, count: cidrs.length });
    } else {
      const c = IPv4.parseCIDR(cidrIn);
      if (!c) { setErr(t('range.err_invalid_cidr')); return; }
      const sn = IPv4.subnet(c.ip, c.prefix);
      setResult({ mode, start: sn.networkStr, end: sn.broadcastStr, firstHost: sn.firstHostStr, lastHost: sn.lastHostStr, hosts: sn.hostCount });
    }
  };

  useEffect(() => {
    if (initialData) {
      if (initialData.mode !== undefined) setMode(initialData.mode);
      if (initialData.start !== undefined) setStart(initialData.start);
      if (initialData.end !== undefined) setEnd(initialData.end);
      if (initialData.cidrIn !== undefined) setCidrIn(initialData.cidrIn);
    }
    calc();
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (start || end || cidrIn) (e.detail?.respond ?? onShare)({ tool: 'subnet-planner', mode: 'range', rangeMode: mode, start, end, cidrIn });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [mode, start, end, cidrIn, onShare]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('range.mode')}</div>
        <div style={{display:'flex',gap:8,marginBottom:16}}>
          {[['range2cidr', t('range.range2cidr')],['cidr2range', t('range.cidr2range')]].map(([v,l]) => (
            <button key={v} className={`btn ${mode===v?'btn-primary':'btn-ghost'}`} onClick={() => { setMode(v); setResult(null); setErr(''); }}>{l}</button>
          ))}
        </div>
        {mode === 'range2cidr' ? (
          <div className="two-col grid-mobile-1">
            <div className="field"><label className="label">{t('range.start_ip')}</label>
              <input className="input" value={start} onChange={e => setStart(e.target.value)} placeholder="10.0.0.0" /></div>
            <div className="field"><label className="label">{t('range.end_ip')}</label>
              <input className="input" value={end} onChange={e => setEnd(e.target.value)} placeholder="10.0.0.255" /></div>
          </div>
        ) : (
          <div className="field"><label className="label">{t('subnet.ip_cidr_label')}</label>
            <input className="input" value={cidrIn} onChange={e => setCidrIn(e.target.value)} placeholder="10.0.1.0/24" /></div>
        )}
        <Err msg={err} />
        <button className="btn btn-primary" onClick={calc}>{t('common.calculate')}</button>
      </div>

      {result && (
        <div className="card fadein">
          {result.mode === 'range2cidr' ? (
            <>
              <div className="card-title">{t('range.cidr_blocks')} ({result.count})</div>
              <div className="table-wrap hide-mobile">
                <table>
                  <thead><tr><th>{t('common.th_num')}</th><th>{t('common.th_cidr')}</th><th>{t('subnet.network_addr')}</th><th>{t('subnet.broadcast_addr')}</th><th>{t('subnet.usable_hosts')}</th><th></th></tr></thead>
                  <tbody>
                    {result.cidrs.map((cidr, i) => {
                      const c = IPv4.parseCIDR(cidr);
                      const sn = IPv4.subnet(c.ip, c.prefix);
                      return (
                        <tr key={i}>
                          <td style={{color:'var(--dim)'}}>{i+1}</td>
                          <td style={{color:'var(--cyan)'}}>{cidr}</td>
                          <td>{sn.networkStr}</td>
                          <td>{sn.broadcastStr}</td>
                          <td style={{color:'var(--green)'}}>{sn.hostCount}</td>
                          <td><CopyBtn text={cidr} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {/* Mobile View */}
              <div className="show-mobile mobile-cards">
                {result.cidrs.map((cidr, i) => {
                  const c = IPv4.parseCIDR(cidr);
                  const sn = IPv4.subnet(c.ip, c.prefix);
                  return (
                    <div key={i} className="mobile-card">
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('range.block')} {i+1}</span>
                        <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{cidr}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('nav.tools')}</span>
                        <span className="mobile-card-value">{sn.networkStr} - {sn.broadcastStr}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('subnet.usable_hosts')}</span>
                        <span className="mobile-card-value" style={{color:'var(--green)'}}>{sn.hostCount}</span>
                      </div>
                      <div style={{marginTop:8, display:'flex', justifyContent:'flex-end'}}>
                        <CopyBtn text={cidr} label={`${t('common.copy')} CIDR`} />
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="btn-row">
                <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(result.cidrs.map((c,i)=>({index:i+1,cidr:c})),'range-cidrs.csv')}>{t('common.export_csv')}</button>
                <CopyBtn text={result.cidrs.join('\n')} label="copy_all" id="range-cidrs-copy-all" />
              </div>
            </>
          ) : (
            <>
              <div className="card-title">{t('range.range_details')}</div>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
                <CopyBtn text={`${t('range.start_network')}: ${result.start}\n${t('range.end_broadcast')}: ${result.end}\n${t('subnet.first_host')}: ${result.firstHost}\n${t('subnet.last_host')}: ${result.lastHost}\n${t('subnet.usable_hosts')}: ${result.hosts}`} label="copy_all" id="range-copy-all" />
              </div>
              <div className="result-grid grid-mobile-1">
                <ResultItem label={t('range.start_network')} value={result.start} accent />
                <ResultItem label={t('range.end_broadcast')} value={result.end} red />
                <ResultItem label={t('subnet.first_host')} value={result.firstHost} green />
                <ResultItem label={t('subnet.last_host')} value={result.lastHost} green />
                <ResultItem label={t('subnet.usable_hosts')} value={result.hosts} />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tool: Supernet Calculator ───────────────────────────────
window.RangeCIDR = RangeCIDR;
