const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── WHOIS Lookup — Domain/IP Registration Data ────────────────────────────

const WHOIS_PROXY = 'https://rdap.org/';

function isIP(v) { return /^(\d{1,3}\.){3}\d{1,3}$/.test(v) || /^[0-9a-fA-F:]+$/.test(v); }
function isIPv6(v) { return /:/.test(v) && /[a-fA-F]/i.test(v); }
function isDomain(v) { return /\.[a-zA-Z]{2,}$/.test(v) && !isIP(v); }

function formatDate(d, lang = 'en-US') {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString(lang, {year:'numeric',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'}); }
  catch { return String(d); }
}

function daysUntil(d) {
  if (!d) return null;
  try { return Math.ceil((new Date(d) - new Date()) / (1000*60*60*24)); }
  catch { return null; }
}

function WHOISLookup({ onShare, initialData }) {
  const { t, lang } = useTranslation();
  const [query, setQuery] = usePersistentState('whois:query', initialData?.query ?? '');
  const [result, setResult] = usePersistentState('whois:result', null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [history, setHistory] = usePersistentState('whois:history', () => {
    try { return JSON.parse(localStorage.getItem('whois-history') || '[]'); } catch { return []; }
  });

  useEffect(() => {
    if (initialData?.query !== undefined) setQuery(initialData.query);
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (query) (e.detail?.respond ?? onShare)({ tool:'whois', query });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [query, onShare]);

  const lookup = async (target) => {
    const q = (target || query).trim();
    if (!q) { setErr(t('whois.err_empty')); return; }
    setErr(''); setResult(null); setLoading(true);

    try {
      if (isIP(q)) {
        // RDAP lookup for IP
        const url = `${WHOIS_PROXY}ip/${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/rdap+json' } });
        if (!res.ok) throw new Error(`RDAP returned ${res.status}`);
        const data = await res.json();
        setResult({ type: 'ip', raw: data, query: q });
      } else if (isDomain(q)) {
        // RDAP lookup for domain
        const url = `${WHOIS_PROXY}domain/${encodeURIComponent(q)}`;
        const res = await fetch(url, { headers: { 'Accept': 'application/rdap+json' } });
        if (!res.ok) throw new Error(`RDAP returned ${res.status}`);
        const data = await res.json();
        setResult({ type: 'domain', raw: data, query: q });
      } else {
        throw new Error(t('whois.err_invalid'));
      }
      // Save to history
      setHistory(prev => {
        const updated = [q, ...prev.filter(h => h !== q)].slice(0, 10);
        localStorage.setItem('whois-history', JSON.stringify(updated));
        return updated;
      });
    } catch (e) {
      setErr(e.message || t('whois.err_failed'));
    }
    setLoading(false);
  };

  const renderIPResult = (data) => {
    const r = data.raw;
    const startAddr = r.startAddress || '—';
    const endAddr = r.endAddress || '—';
    const cidr = r.cidRs?.[0]?.cidr || `${startAddr} - ${endAddr}`;
    const name = r.name || '—';
    const handle = r.handle || '—';
    const org = r.entities?.find(e => e.roles?.includes('registrant')) || r.entities?.[0];
    const orgName = org?.vcardArray?.[1]?.find(v => v[0]==='fn')?.[3] || org?.publicIds?.[0]?.identifier || r.port43 || '—';
    const country = r.country || r.entities?.[0]?.vcardArray?.[1]?.find(v=>v[0]==='adr')?.[1]?.parameters?.cc || '—';
    const type = r.type || '—';
    const status = r.status || [];
    const remarks = r.remarks?.map(rm => rm.description?.join(' ')).filter(Boolean).join('\n') || '';

    return (
      <>
        <div className="result-grid grid-mobile-1">
          <ResultItem label={t('whois.ip_address')} value={data.query} accent />
          <ResultItem label={t('whois.cidr_range')} value={typeof cidr === 'string' ? cidr : `${startAddr}/${endAddr}`} />
          <ResultItem label={t('whois.network_name')} value={name} />
          <ResultItem label={t('whois.handle')} value={handle} />
          <ResultItem label={t('whois.organization')} value={orgName} />
          <ResultItem label={t('whois.country')} value={country} />
          <ResultItem label={t('whois.type')} value={type} />
          <ResultItem label={t('whois.whois_server')} value={r.port43 || '—'} />
        </div>
        {status.length > 0 && (
          <div style={{marginTop:12}}>
            <div className="label">{t('whois.status')}</div>
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {status.map(s => <span key={s} className={`badge ${s==='active'?'badge-green':'badge-blue'}`}>{s}</span>)}
            </div>
          </div>
        )}
        {remarks && (
          <div style={{marginTop:12,padding:'10px 14px',background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',fontSize:12,color:'var(--muted)',whiteSpace:'pre-wrap'}}>{remarks}</div>
        )}
        {r.entities && r.entities.length > 0 && (
          <div style={{marginTop:16}}>
            <div className="label">{t('whois.entities_contacts')}</div>
            <div className="table-wrap hide-mobile">
              <table>
                <thead><tr><th>{t('whois.th_entity')}</th><th>{t('whois.th_role')}</th><th>{t('whois.th_handle')}</th></tr></thead>
                <tbody>
                  {r.entities.map((ent,i) => {
                    const fn = ent.vcardArray?.[1]?.find(v=>v[0]==='fn')?.[3] || ent.publicIds?.[0]?.identifier || '—';
                    return (
                      <tr key={i}>
                        <td style={{fontWeight:600,color:'var(--text)'}}>{fn}</td>
                        <td>{ent.roles?.map(role=><span key={role} className="badge badge-blue" style={{marginRight:4}}>{role}</span>)}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:11}}>{ent.handle || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="show-mobile mobile-cards">
              {r.entities.map((ent,i) => {
                const fn = ent.vcardArray?.[1]?.find(v=>v[0]==='fn')?.[3] || ent.publicIds?.[0]?.identifier || '—';
                return (
                  <div key={i} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label" style={{fontWeight:600}}>{fn}</span>
                      <span>{ent.roles?.map(role=><span key={role} className="badge badge-blue" style={{fontSize:9,marginRight:2}}>{role}</span>)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>
    );
  };

  const renderDomainResult = (data) => {
    const r = data.raw;
    const ldhName = r.ldhName || r.unicodeName || data.query;
    const handle = r.handle || '—';
    const status = r.status || [];
    const events = r.events || [];
    const nameservers = r.nameservers || [];
    const secureDNS = r.secureDNS || {};

    const created = events.find(e => e.eventAction === 'registration')?.eventDate;
    const expires = events.find(e => e.eventAction === 'expiration')?.eventDate;
    const updated = events.find(e => e.eventAction === 'last changed')?.eventDate;
    const lastRDAP = events.find(e => e.eventAction === 'last update of RDAP database')?.eventDate;

    const daysToExpiry = daysUntil(expires);
    const registrar = r.entities?.find(e => e.roles?.includes('registrar'));
    const registrarName = registrar?.vcardArray?.[1]?.find(v=>v[0]==='fn')?.[3] || registrar?.publicIds?.[0]?.identifier || '—';
    const registrant = r.entities?.find(e => e.roles?.includes('registrant'));
    const registrantName = registrant?.vcardArray?.[1]?.find(v=>v[0]==='fn')?.[3] || '—';

    return (
      <>
        <div className="result-grid grid-mobile-1">
          <ResultItem label={t('whois.domain')} value={ldhName} accent />
          <ResultItem label={t('whois.handle')} value={handle} />
          <ResultItem label={t('whois.registrar')} value={registrarName} />
          {registrantName !== '—' && <ResultItem label={t('whois.registrant')} value={registrantName} />}
          <ResultItem label={t('whois.created')} value={formatDate(created, lang)} />
          <ResultItem label={t('whois.expires')} value={formatDate(expires, lang)} yellow={daysToExpiry!==null&&daysToExpiry<=90&&daysToExpiry>0} red={daysToExpiry!==null&&daysToExpiry<=0} />
          <ResultItem label={t('whois.updated')} value={formatDate(updated, lang)} />
          <ResultItem label={t('whois.dnssec')} value={secureDNS.signed ? t('whois.dnssec_signed') : t('whois.dnssec_unsigned')} green={secureDNS.signed} />
          <ResultItem label={t('whois.whois_server')} value={r.port43 || '—'} />
        </div>

        {daysToExpiry !== null && (
          <div style={{marginTop:8,padding:'8px 12px',borderRadius:'var(--radius)',fontSize:12,
            background: daysToExpiry<=0 ? 'rgba(239,68,68,.1)' : daysToExpiry<=30 ? 'rgba(239,68,68,.1)' : daysToExpiry<=90 ? 'rgba(245,158,11,.1)' : 'rgba(34,197,94,.1)',
            border: `1px solid ${daysToExpiry<=0?'var(--red)':daysToExpiry<=30?'var(--red)':daysToExpiry<=90?'var(--yellow)':'var(--green)'}`,
            color: daysToExpiry<=0?'var(--red)':daysToExpiry<=30?'var(--red)':daysToExpiry<=90?'var(--yellow)':'var(--green)',
          }}>
            {daysToExpiry <= 0 ? t('whois.expiry_expired', { days: Math.abs(daysToExpiry) }) :
             daysToExpiry <= 30 ? t('whois.expiry_urgent', { days: daysToExpiry }) :
             daysToExpiry <= 90 ? t('whois.expiry_warn', { days: daysToExpiry }) :
             t('whois.expiry_ok', { days: daysToExpiry })}
          </div>
        )}

        {status.length > 0 && (
          <div style={{marginTop:12}}>
            <div className="label">{t('whois.domain_status')}</div>
            <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
              {status.map(s => {
                const isGood = s==='active' || s==='client transfer prohibited';
                return <span key={s} className={`badge ${isGood?'badge-green':'badge-yellow'}`}>{s}</span>;
              })}
            </div>
            <div className="hint" style={{marginTop:4}}>
              {status.includes('client transfer prohibited') && t('whois.locked_transfer')}
              {status.includes('client delete prohibited') && t('whois.locked_delete')}
            </div>
          </div>
        )}

        {nameservers.length > 0 && (
          <div style={{marginTop:16}}>
            <div className="label">{t('whois.nameservers')} ({nameservers.length})</div>
            <div className="result-grid" style={{gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))'}}>
              {nameservers.map((ns,i) => (
                <ResultItem key={i} label={`NS${i+1}`} value={ns.ldhName || ns.unicodeName || ns} />
              ))}
            </div>
          </div>
        )}

        {r.entities && r.entities.length > 0 && (
          <div style={{marginTop:16}}>
            <div className="label">{t('whois.entities_contacts')}</div>
            <div className="table-wrap hide-mobile">
              <table>
                <thead><tr><th>{t('whois.th_entity')}</th><th>{t('whois.th_role')}</th><th>{t('whois.th_handle')}</th></tr></thead>
                <tbody>
                  {r.entities.map((ent,i) => {
                    const fn = ent.vcardArray?.[1]?.find(v=>v[0]==='fn')?.[3] || ent.publicIds?.[0]?.identifier || '—';
                    const email = ent.vcardArray?.[1]?.find(v=>v[0]==='email')?.[3] || '';
                    return (
                      <tr key={i}>
                        <td style={{fontWeight:500,color:'var(--text)'}}>
                          {fn}
                          {email && <div style={{fontSize:11,color:'var(--muted)'}}>{email}</div>}
                        </td>
                        <td>{ent.roles?.map(role=><span key={role} className="badge badge-blue" style={{marginRight:4,fontSize:10}}>{role}</span>)}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:11}}>{ent.handle || '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="show-mobile mobile-cards">
              {r.entities.map((ent,i) => {
                const fn = ent.vcardArray?.[1]?.find(v=>v[0]==='fn')?.[3] || ent.publicIds?.[0]?.identifier || '—';
                return (
                  <div key={i} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label" style={{fontWeight:600}}>{fn}</span>
                      <span>{ent.roles?.map(role=><span key={role} className="badge badge-blue" style={{fontSize:9,marginRight:2}}>{role}</span>)}</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Raw RDAP JSON */}
        <details style={{marginTop:16}}>
          <summary style={{cursor:'pointer',fontSize:12,color:'var(--muted)',userSelect:'none'}}>
            {t('whois.raw_rdap')}
          </summary>
          <pre style={{
            background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',
            padding:12,fontFamily:'var(--mono)',fontSize:11,overflow:'auto',maxHeight:300,marginTop:8,
            whiteSpace:'pre-wrap',color:'var(--muted)'
          }}>{JSON.stringify(r, null, 2)}</pre>
        </details>
      </>
    );
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">
          {t('whois.title')}
          <span className="badge badge-blue" style={{marginLeft:8,fontSize:10}}>RDAP</span>
        </div>
        <div className="field">
          <label className="label">{t('whois.label')}</label>
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={query} onChange={e=>setQuery(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&lookup()} placeholder={t('whois.placeholder')}/>
            <button className="btn btn-primary" onClick={()=>lookup()} disabled={loading}>
              {loading ? t('common.loading') : t('whois.lookup')}
            </button>
          </div>
          <Err msg={err}/>
          <div className="hint">{t('whois.hint')}</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {['google.com','github.com','cloudflare.com','1.1.1.1','8.8.8.8','142.250.80.46'].map(p => (
            <button key={p} className="btn btn-ghost btn-sm" onClick={()=>{setQuery(p);lookup(p);}}>{p}</button>
          ))}
        </div>
      </div>

      {result && (
        <div className="card fadein">
          <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:14}}>
            <div className="card-title" style={{marginBottom:0}}>
              {t('whois.results_for')} <span style={{color:'var(--cyan)',fontFamily:'var(--mono)'}}>{result.query}</span>
            </div>
            <span className={`badge ${result.type==='domain'?'badge-purple':'badge-blue'}`}>
              {result.type==='domain'?t('whois.badge_domain'):t('whois.badge_ip')}
            </span>
          </div>
          {result.type==='ip' ? renderIPResult(result) : renderDomainResult(result)}
        </div>
      )}

      {history.length > 0 && (
        <div className="card">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
            <div className="card-title" style={{marginBottom:0}}>{t('whois.history')}</div>
            <button className="btn btn-ghost btn-sm" onClick={()=>{setHistory([]);localStorage.removeItem('whois-history');}}>{t('whois.clear')}</button>
          </div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
            {history.map(h => (
              <button key={h} className="btn btn-ghost btn-sm" onClick={()=>{setQuery(h);lookup(h);}}>{h}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
window.WHOISLookup = WHOISLookup;
