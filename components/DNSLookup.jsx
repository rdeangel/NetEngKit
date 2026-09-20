const { useState, useEffect, useCallback, useRef, useMemo } = React;

const DNS_TYPES = ['A','AAAA','CNAME','MX','NS','PTR','SOA','SRV','TXT','CAA'];

const TYPE_COLORS = {
  A:'var(--cyan)', AAAA:'var(--cyan)', CNAME:'var(--yellow)',
  MX:'var(--green)', NS:'var(--muted)', PTR:'var(--orange)',
  SOA:'var(--dim)', SRV:'var(--blue)', TXT:'var(--purple)', CAA:'var(--red)',
};

function RecordTypeRef({ t }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card" style={{marginTop:0}}>
      <button onClick={() => setOpen(o => !o)} style={{
        background:'none', border:'none', padding:0, cursor:'pointer',
        display:'flex', alignItems:'center', gap:8, width:'100%',
      }}>
        <span className="card-title" style={{marginBottom:0, flex:1, textAlign:'left'}}>{t('dns.record_ref_title')}</span>
        <span style={{color:'var(--dim)', fontSize:12, fontFamily:'var(--mono)'}}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div style={{marginTop:14, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:10}}>
          {DNS_TYPES.map(rt => {
            const info = t(`dns.record_types.${rt}`) || {};
            return (
              <div key={rt} style={{
                background:'var(--panel)', borderRadius:8, padding:'10px 14px',
                borderLeft:`3px solid ${TYPE_COLORS[rt]||'var(--border)'}`,
              }}>
                <div style={{fontWeight:700, fontSize:12, color:'var(--fg)', marginBottom:4}}>{info.name || rt}</div>
                <div style={{fontSize:11, color:'var(--dim)', lineHeight:1.5}}>{info.desc || ''}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DNSLookup({ onShare, initialData }) {
  const { t } = useTranslation();
  const [query, setQuery] = usePersistentState('dns:query', initialData?.query ?? '');
  const [type, setType] = usePersistentState('dns:type', initialData?.type ?? 'A');
  const [mode, setMode] = usePersistentState('dns:mode', initialData?.mode ?? 'doh');
  const [providerKey, setProviderKey] = usePersistentState('dns:provider', initialData?.provider ?? 'google');
  const [addrVer, setAddrVer] = usePersistentState('dns:addr_ver', initialData?.addr_ver ?? 'v4');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = usePersistentState('dns:result', null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (initialData) {
      if (initialData.query    !== undefined) setQuery(initialData.query);
      if (initialData.type     !== undefined) setType(initialData.type);
      if (initialData.mode     !== undefined) setMode(initialData.mode);
      if (initialData.provider !== undefined) setProviderKey(initialData.provider);
      if (initialData.addr_ver !== undefined) setAddrVer(initialData.addr_ver);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (query) (e.detail?.respond ?? onShare)({ tool: 'dns', query, type, mode, provider: providerKey, addr_ver: addrVer });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [query, type, mode, providerKey, addrVer, onShare]);

  const allProviders = window.DOH_PROVIDERS || [];
  const dohProviders = useMemo(() => allProviders.filter(p => p.doh_url), [allProviders.length]);
  const regularProviders = useMemo(() => allProviders.filter(p => p.ips_v4.length > 0 || p.ips_v6.length > 0), [allProviders.length]);
  const activeProvider = useMemo(() => allProviders.find(p => p.key === providerKey) || null, [providerKey, allProviders.length]);
  const hasV6 = activeProvider && activeProvider.ips_v6.length > 0;

  const serverIP = useMemo(() => {
    if (mode !== 'regular' || providerKey === 'system' || !activeProvider) return null;
    return (addrVer === 'v6' && hasV6) ? activeProvider.ips_v6[0] : (activeProvider.ips_v4[0] || null);
  }, [mode, providerKey, activeProvider, addrVer, hasV6]);

  const badgeLabel = mode === 'doh'
    ? t('dns.title_via_doh')
    : (providerKey === 'system' ? t('dns.mode_regular') : `${t('dns.title_via_regular')} — ${serverIP || ''}`);

  const lookup = async () => {
    if (!query.trim()) { setErr(t('dns.err_domain')); return; }
    setErr(''); setResult(null); setLoading(true);
    try {
      if (mode === 'regular') {
        const params = new URLSearchParams({ name: query.trim(), type });
        if (serverIP) params.set('server', serverIP);
        const res = await fetch(`/api/dns-lookup?${params}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setResult(data);
      } else {
        const provider = dohProviders.find(p => p.key === providerKey) || dohProviders[0];
        const params = new URLSearchParams({
          name: query.trim(),
          type,
          url: provider.doh_url,
          json: provider.doh_json ? '1' : '0',
        });
        const res = await fetch(`/api/doh-lookup?${params}`);
        const data = await res.json();
        if (data.error) throw new Error(data.error);
        setResult(data);
      }
    } catch (e) {
      setErr(t('dns.err_failed'));
    }
    setLoading(false);
  };

  const statusMap = { 0:'NOERROR',1:'FORMERR',2:'SERVFAIL',3:'NXDOMAIN',4:'NOTIMP',5:'REFUSED' };
  const typeMap = { 1:'A',2:'NS',5:'CNAME',6:'SOA',12:'PTR',15:'MX',16:'TXT',28:'AAAA',33:'SRV',257:'CAA' };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">
          {t('tools.dns.title')}
          <span className="badge badge-blue" style={{marginLeft:8,fontSize:10}}>{badgeLabel}</span>
        </div>

        {/* Mode toggle */}
        <div className="field">
          <label className="label">{t('dns.mode_label')}</label>
          <div style={{display:'flex',gap:6}}>
            {['regular','doh'].map(m => (
              <button key={m} onClick={() => {
                setMode(m);
                if (m === 'doh' && (providerKey === 'system' || !dohProviders.find(p => p.key === providerKey))) {
                  setProviderKey(dohProviders[0]?.key || 'google');
                }
                if (m === 'regular' && !regularProviders.find(p => p.key === providerKey) && providerKey !== 'system') {
                  setProviderKey('system');
                }
              }} style={{
                padding:'5px 14px', borderRadius:20, fontSize:12, fontWeight:600, cursor:'pointer',
                border:'1px solid var(--border)',
                background: mode===m ? 'var(--cyan)' : 'var(--panel)',
                color: mode===m ? 'var(--bg)' : 'var(--dim)',
              }}>
                {m === 'regular' ? t('dns.mode_regular') : t('dns.mode_doh')}
              </button>
            ))}
          </div>
        </div>

        {/* Provider selector */}
        <div className="field">
          <label className="label">{t('dns.provider_label')}</label>
          <select className="select" value={providerKey} onChange={e => { setProviderKey(e.target.value); setAddrVer('v4'); }}>
            {mode === 'regular' && (
              <option value="system">{t('dns.provider_system')}</option>
            )}
            {(mode === 'regular' ? regularProviders : dohProviders).map(p => (
              <option key={p.key} value={p.key}>{p.name}</option>
            ))}
          </select>
        </div>

        {/* v4/v6 address toggle — Regular DNS, non-system provider only */}
        {mode === 'regular' && providerKey !== 'system' && (
          <div className="field">
            <label className="label">{t('dns.addr_version')}</label>
            <div style={{display:'flex',gap:6,alignItems:'center'}}>
              {['v4','v6'].map(ver => {
                const disabled = ver === 'v6' && !hasV6;
                return (
                  <button key={ver} onClick={() => !disabled && setAddrVer(ver)} style={{
                    padding:'4px 12px', borderRadius:20, fontSize:11, fontWeight:600,
                    cursor: disabled ? 'not-allowed' : 'pointer',
                    border:'1px solid var(--border)',
                    background: (!disabled && addrVer===ver) ? 'var(--cyan)' : 'var(--panel)',
                    color: disabled ? 'var(--dim)' : addrVer===ver ? 'var(--bg)' : 'var(--fg)',
                    opacity: disabled ? 0.4 : 1,
                  }}>
                    {ver === 'v4' ? t('dns.addr_v4') : t('dns.addr_v6')}
                  </button>
                );
              })}
              {serverIP && (
                <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--cyan)',marginLeft:6}}>{serverIP}</span>
              )}
            </div>
          </div>
        )}

        {/* Query row */}
        <div className="field">
          <label className="label">{t('dns.label')}</label>
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && lookup()} placeholder={t('dns.placeholder')} />
            <select className="select" value={type} onChange={e => setType(e.target.value)} style={{width:'auto',flexShrink:0}}>
              {['A','AAAA','CNAME','MX','NS','PTR','SOA','SRV','TXT','CAA'].map(rt => <option key={rt}>{rt}</option>)}
            </select>
            <button className="btn btn-primary" onClick={lookup} disabled={loading}>{loading ? '...' : t('dns.lookup')}</button>
          </div>
          <Err msg={err} />
        </div>
      </div>

      <RecordTypeRef t={t} />

      {result && (
        <div className="card fadein">
          <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:14}}>
            <div className="card-title" style={{marginBottom:0}}>{t('dns.results_for')} <span style={{color:'var(--cyan)',fontFamily:'var(--mono)'}}>{query}</span></div>
            <span className={`badge ${result.Status===0?'badge-green':'badge-red'}`}>{statusMap[result.Status] || result.Status}</span>
          </div>
          {result.Answer?.length ? (
            <>
              <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
                <CopyBtn text={result.Answer.map(r => `${t('dns.name')}: ${r.name}\n${t('dns.type')}: ${typeMap[r.type]||r.type}\n${t('dns.ttl')}: ${r.TTL}s\n${t('dns.value')}: ${r.data}`).join('\n\n')} label="copy_all" id="dns-copy-all" />
              </div>
              <div className="table-wrap hide-mobile">
                <table>
                  <thead><tr><th>{t('dns.name')}</th><th>{t('dns.type')}</th><th>{t('dns.ttl')}</th><th>{t('dns.value')}</th><th></th></tr></thead>
                  <tbody>
                    {result.Answer.map((r, i) => (
                      <tr key={i}>
                        <td style={{color:'var(--muted)'}}>{r.name}</td>
                        <td><span className="badge badge-blue">{typeMap[r.type] || r.type}</span></td>
                        <td style={{color:'var(--dim)'}}>{r.TTL}s</td>
                        <td style={{color:'var(--cyan)'}}>{r.data}</td>
                        <td><CopyBtn text={r.data} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="show-mobile mobile-cards">
                {result.Answer.map((r, i) => (
                  <div key={i} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{r.name}</span>
                      <span className="badge badge-blue">{typeMap[r.type] || r.type}</span>
                    </div>
                    <div style={{paddingTop:6, fontFamily:'var(--mono)', fontSize:11, color:'var(--cyan)', wordBreak:'break-all'}}>{r.data}</div>
                    <div style={{marginTop:8, display:'flex', justifyContent:'space-between', alignItems:'center'}}>
                      <span style={{fontSize:10, color:'var(--dim)'}}>{t('dns.ttl')}: {r.TTL}s</span>
                      <CopyBtn text={r.data} label={t('common.copy')} />
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <div style={{color:'var(--muted)',fontSize:13}}>{t('dns.no_records', { type })}</div>
          )}
          {result.Authority?.length > 0 && (
            <>
              <div className="card-title" style={{marginTop:14}}>{t('dns.authority_records')}</div>
              <div className="table-wrap hide-mobile">
                <table><thead><tr><th>{t('dns.name')}</th><th>{t('dns.type')}</th><th>{t('dns.ttl')}</th><th>{t('dns.value')}</th></tr></thead>
                <tbody>{result.Authority.map((r,i) => <tr key={i}><td>{r.name}</td><td>{typeMap[r.type]||r.type}</td><td>{r.TTL}s</td><td style={{color:'var(--muted)'}}>{r.data}</td></tr>)}</tbody></table>
              </div>
              <div className="show-mobile mobile-cards">
                {result.Authority.map((r, i) => (
                  <div key={i} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{r.name}</span>
                      <span className="badge badge-gray">{typeMap[r.type] || r.type}</span>
                    </div>
                    <div style={{paddingTop:6, fontSize:11, color:'var(--muted)', wordBreak:'break-all'}}>{r.data}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tool: SSL/TLS Certificate Inspector ──────────────────────
const SSL_DEFAULT_PROXY = 'http://localhost:8080/proxy/fetch?url=';

window.DNSLookup = DNSLookup;
