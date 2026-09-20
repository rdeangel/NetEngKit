const { useState, useEffect, useCallback, useRef, useMemo } = React;

function OverlapDetector({ onShare, initialData }) {
  const { t } = useTranslation();
  const [lines, setLines] = usePersistentState('overlap:lines', initialData?.lines ?? '10.0.0.0/8\n10.1.0.0/16\n192.168.1.0/24\n192.168.1.128/25\n172.16.0.0/12\n10.5.5.0/24');
  const [result, setResult] = usePersistentState('overlap:result', null);
  const [err, setErr] = useState('');

  const overlaps = (a, b) => {
    return !(a.broadcast < b.network || b.broadcast < a.network);
  };

  const analyze = () => {
    setErr(''); setResult(null);
    const entries = lines.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (entries.length < 2) { setErr(t('overlap.err_at_least_two')); return; }
    const parsed = entries.map(e => {
      const c = IPv4.parseCIDR(e);
      if (!c) return null;
      return { cidr: e, ...IPv4.subnet(c.ip, c.prefix) };
    });
    if (parsed.some(p => !p)) { setErr(t('overlap.err_invalid_cidr')); return; }
    const conflicts = [];
    const flagged = new Set();
    for (let i = 0; i < parsed.length; i++) {
      for (let j = i+1; j < parsed.length; j++) {
        if (overlaps(parsed[i], parsed[j])) {
          conflicts.push({ a: parsed[i], b: parsed[j] });
          flagged.add(i); flagged.add(j);
        }
      }
    }
    setResult({ networks: parsed, conflicts, flagged });
  };

  useEffect(() => {
    if (initialData?.lines) {
      setLines(initialData.lines);
      analyze(initialData.lines);
    } else {
      analyze();
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (lines) (e.detail?.respond ?? onShare)({ tool: 'subnet-planner', mode: 'overlap', lines });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [lines, onShare]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('overlap.networks_to_check')}</div>
        <div className="field">
          <label className="label">{t('overlap.input_hint')}</label>
          <textarea className="input" rows={8} value={lines} onChange={e => setLines(e.target.value)} style={{resize:'vertical'}} />
        </div>
        <Err msg={err} />
        <button className="btn btn-primary" onClick={analyze}>{t('overlap.detect')}</button>
      </div>
      {result && (
        <>
          <div className="card fadein">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div style={{display:'flex',gap:10,alignItems:'center'}}>
                <div className="card-title" style={{marginBottom:0}}>{t('common.results')}</div>
                {result.conflicts.length === 0
                  ? <span className="badge badge-green">{t('overlap.no_overlaps')}</span>
                  : <span className="badge badge-red">{t('overlap.overlaps_found', { count: result.conflicts.length })}</span>}
              </div>
              <CopyBtn text={['CIDR\t' + t('subnet.network_addr') + '\t' + t('subnet.broadcast_addr') + '\t' + t('subnet.usable_hosts') + '\tStatus', ...result.networks.map((n,i) => [n.cidr, n.networkStr, n.broadcastStr, n.hostCount, result.flagged.has(i) ? t('overlap.conflict') : t('overlap.ok')].join('\t'))].join('\n')} label="copy_all" id="overlap-copy-all" />
            </div>
            <div className="table-wrap hide-mobile">
              <table><thead><tr><th>{t('common.th_cidr')}</th><th>{t('subnet.network_addr')}</th><th>{t('subnet.broadcast_addr')}</th><th>{t('subnet.usable_hosts')}</th><th>{t('common.th_status')}</th></tr></thead>
              <tbody>{result.networks.map((n,i) => (
                <tr key={i} style={result.flagged.has(i)?{background:'rgba(239,68,68,.06)'}:{}}>
                  <td style={{color: result.flagged.has(i)?'var(--red)':'var(--cyan)'}}>{n.cidr}</td>
                  <td>{n.networkStr}</td><td>{n.broadcastStr}</td><td style={{color:'var(--green)'}}>{n.hostCount}</td>
                  <td>{result.flagged.has(i) ? <span className="badge badge-red">{t('overlap.conflict')}</span> : <span className="badge badge-green">{t('overlap.ok')}</span>}</td>
                </tr>
              ))}</tbody></table>
            </div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              {result.networks.map((n,i) => (
                <div key={i} className="mobile-card" style={{borderLeft: result.flagged.has(i) ? '3px solid var(--red)' : '3px solid var(--green)'}}>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">CIDR</span>
                    <span className="mobile-card-value" style={{color: result.flagged.has(i)?'var(--red)':'var(--cyan)', fontWeight:600}}>{n.cidr}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('nav.tools')}</span>
                    <span className="mobile-card-value" style={{fontSize:11}}>{n.networkStr} - {n.broadcastStr}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('subnet.usable_hosts')} / Status</span>
                    <span className="mobile-card-value">{n.hostCount} / {result.flagged.has(i) ? <span style={{color:'var(--red)'}}>{t('overlap.conflict')}</span> : <span style={{color:'var(--green)'}}>{t('overlap.ok')}</span>}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          {result.conflicts.length > 0 && (
            <div className="card fadein">
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <div className="card-title" style={{marginBottom:0}}>{t('overlap.conflict_details')}</div>
                <CopyBtn text={['Network A\tNetwork B\tHost Range', ...result.conflicts.map(c => `${c.a.cidr}\t${c.b.cidr}\t${c.a.firstHostStr}–${c.a.lastHostStr}`)].join('\n')} label="copy_all" id="overlap-conflicts-copy-all" />
              </div>
              {result.conflicts.map((c,i) => (
                <div key={i} style={{background:'rgba(239,68,68,.05)',border:'1px solid rgba(239,68,68,.2)',borderRadius:'var(--radius)',padding:'12px 14px',marginBottom:8}}>
                  <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:8}}>
                    <span style={{fontFamily:'var(--mono)',color:'var(--red)'}}>{c.a.cidr}</span>
                    <span style={{color:'var(--dim)'}}>{t('overlap.overlaps_with')}</span>
                    <span style={{fontFamily:'var(--mono)',color:'var(--red)'}}>{c.b.cidr}</span>
                  </div>
                  <div style={{fontSize:12,color:'var(--muted)'}}>
                    {c.a.cidr} {t('overlap.contains_within')} {c.b.networkStr} ({c.a.firstHostStr}–{c.a.lastHostStr})
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── Tool: Subnet Split & Merge ───────────────────────────────
window.OverlapDetector = OverlapDetector;
