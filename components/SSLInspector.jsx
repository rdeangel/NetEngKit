const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SSLInspector({ onShare, initialData }) {
  const { t } = useTranslation();
  const [domain, setDomain] = usePersistentState('ssl:domain', initialData?.domain ?? '');
  const [proxy, setProxy] = usePersistentState('ssl:proxy', SSL_DEFAULT_PROXY);
  const [showProxy, setShowProxy] = usePersistentState('ssl:showProxy', false);
  const [loading, setLoading] = useState(false);
  const [scanStatus, setScanStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = usePersistentState('ssl:result', null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (initialData) {
      if (initialData.domain !== undefined) setDomain(initialData.domain);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (domain) (e.detail?.respond ?? onShare)({ tool: 'ssl', domain });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [domain, onShare]);

  const cleanDomain = s => s.replace(/^https?:\/\//, '').split('/')[0].split('?')[0].trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const sslProxy = url => proxy.trim() ? `${proxy.trim()}${encodeURIComponent(url)}` : url;

  const runScan = async () => {
    const host = cleanDomain(domain);
    if (!host) { setErr(t('ssl.err_domain')); return; }
    setErr(''); setResult(null); setLoading(true); setProgress(0);
    setScanStatus(t('ssl.scan_init'));
    try {
      // Kick off the scan (ignore response — may error if cached scan exists)
      try { await fetch(sslProxy(`https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(host)}&startNew=on&all=done`)); } catch(_){}
      let data, attempts = 0;
      do {
        const allDone = data?.endpoints?.length > 0 && data.endpoints.every(ep => ep.progress === 100);
        await sleep(allDone ? 3000 : 10000); // poll fast once endpoints finish
        setScanStatus(s => s === t('ssl.scan_init') ? t('ssl.scan_wait') : s);
        const r = await fetch(sslProxy(`https://api.ssllabs.com/api/v3/analyze?host=${encodeURIComponent(host)}&all=done`));
        if (r.status === 429) { await sleep(15000); continue; } // back off on rate limit
        if (!r.ok) throw new Error(`Proxy returned HTTP ${r.status}`);
        data = await r.json();
        attempts++;
        const eps = data.endpoints || [];
        const allEndpointsDone = eps.length > 0 && eps.every(e => e.progress === 100);
        const avgProgress = eps.length ? Math.round(eps.reduce((s, e) => s + (e.progress || 0), 0) / eps.length) : 0;
        const doneCount = eps.filter(e => e.progress === 100).length;
        setProgress(avgProgress);
        const status = data.status || '';
        if (status === 'DNS') setScanStatus(t('ssl.scan_dns'));
        else if (allEndpointsDone && status !== 'READY') setScanStatus(t('ssl.scan_final'));
        else if (eps.length > 1) setScanStatus(t('ssl.scan_endpoints', { done: doneCount, total: eps.length }));
        else if (eps[0]?.statusMessage) setScanStatus(eps[0].statusMessage);
        else setScanStatus(t('ssl.scan_scanning'));
      } while (data?.status !== 'READY' && data?.status !== 'ERROR' && attempts < 36);
      if (data?.status === 'ERROR') throw new Error(data.statusMessage || 'SSL Labs scan error');
      if (data?.status !== 'READY') throw new Error(t('ssl.err_timeout'));
      setResult(data);
    } catch (e) {
      setErr(e.message || t('ssl.err_failed'));
    }
    setLoading(false);
  };

  const gradeColor = g => !g ? 'var(--muted)' : g.startsWith('A') ? 'var(--green)' : g === 'B' ? '#8bc34a' : g === 'C' ? 'var(--yellow)' : 'var(--red)';

  const formatExpiry = ts => {
    if (!ts) return t('ssl.na', 'N/A');
    const d = new Date(ts), now = new Date();
    const days = Math.ceil((d - now) / 86400000);
    return `${d.toISOString().split('T')[0]} (${days > 0 ? `${days}d ${t('ssl.remaining')}` : t('ssl.expired_ago', { d: Math.abs(days) })})`;
  };

  const revMap = { 0:t('ssl.rev.not_checked'), 1:t('ssl.rev.revoked'), 2:t('ssl.rev.good'), 3:t('ssl.rev.no_status'), 4:t('ssl.rev.unknown'), 5:t('ssl.rev.not_revoked') };

  const getWarnings = (ep, protos, details) => {
    const w = [];
    if (details?.hstsPolicy?.status !== 'present') w.push(t('ssl.warn.no_hsts'));
    if (!protos.some(p => p.id === 772))            w.push(t('ssl.warn.no_tls13'));
    if (details?.forwardSecrecy === 1)              w.push(t('ssl.warn.fs_partial'));
    if (details?.protocolIntolerance > 0)           w.push(t('ssl.warn.proto_intol'));
    if (details?.heartbleed)                        w.push(t('ssl.warn.heartbleed'));
    if (details?.poodle)                            w.push(t('ssl.warn.poodle'));
    if (details?.poodleTls === 2)                   w.push(t('ssl.warn.poodle_tls'));
    if (details?.freak)                             w.push(t('ssl.warn.freak'));
    if (details?.logjam)                            w.push(t('ssl.warn.logjam'));
    if (details?.bleichenbacher > 1)                w.push(t('ssl.warn.robot'));
    if (details?.openSslCcs === 3)                  w.push(t('ssl.warn.openssl_ccs'));
    return w;
  };

  const chainIssueStr = n => {
    if (!n) return t('ssl.chain.none');
    const f = [];
    if (n & 1) f.push(t('ssl.chain.incomplete'));
    if (n & 2) f.push(t('ssl.chain.extra'));
    if (n & 4) f.push(t('ssl.chain.cross'));
    if (n & 16) f.push(t('ssl.chain.unvalidatable'));
    if (n & 32) f.push(t('ssl.chain.no_chain'));
    return f.join(', ') || t('ssl.chain.issues');
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('tools.ssl.title')} <span className="badge badge-blue" style={{marginLeft:8,fontSize:10}}>{t('ssl.title_via')}</span></div>
        <div className="field">
          <label className="label">{t('ssl.domain_label')}</label>
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={domain}
              onChange={e => setDomain(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !loading && runScan()}
              placeholder={t('ssl.placeholder')} />
            <button className="btn btn-primary" onClick={runScan} disabled={loading}>{loading ? '…' : t('ssl.inspect')}</button>
          </div>
          <Err msg={err} />
          <div style={{display:'flex',gap:6,alignItems:'center',marginTop:6}}>
            <div className="hint" style={{margin:0}}>{t('ssl.hint')}</div>
            <span style={{fontSize:10,color:'var(--cyan)',cursor:'pointer',whiteSpace:'nowrap'}} onClick={() => setShowProxy(!showProxy)}>{t('ssl.proxy')} ▾</span>
            {domain.trim() && <a href={`https://www.ssllabs.com/ssltest/analyze.html?d=${encodeURIComponent(cleanDomain(domain))}`} target="_blank" rel="noopener" style={{fontSize:10,color:'var(--muted)',whiteSpace:'nowrap',marginLeft:4}}>{t('ssl.open_ssl_labs')}</a>}
          </div>
          {showProxy && (
            <div className="field" style={{marginTop:8}}>
              <label className="label">{t('ssl.proxy_label')}</label>
              <input className="input" value={proxy} onChange={e => setProxy(e.target.value)}
                placeholder="https://api.allorigins.win/raw?url=" style={{fontFamily:'var(--mono)',fontSize:11}} />
              <div className="hint">{t('ssl.proxy_hint')}</div>
            </div>
          )}
        </div>
        {loading && (
          <div style={{marginTop:12}}>
            <div style={{display:'flex',gap:10,alignItems:'center',marginBottom:6}}>
              <span style={{color:'var(--muted)',fontSize:12}}>{scanStatus}</span>
              {progress > 0 && <span style={{color:'var(--cyan)',fontSize:12,fontFamily:'var(--mono)'}}>{progress}%</span>}
            </div>
            <div style={{height:4,background:'var(--border)',borderRadius:2,overflow:'hidden'}}>
              <div style={{height:'100%',width:`${Math.max(5,progress)}%`,background:'var(--cyan)',borderRadius:2,transition:'width .5s ease'}} />
            </div>
          </div>
        )}
      </div>

      {result && result.endpoints?.map((ep, ei) => {
        const leafId = ep.details?.certChains?.[0]?.certIds?.[0];
        const cert = result.certs?.find(c => c.id === leafId);
        const chainIssues = ep.details?.certChains?.[0]?.issues;
        const protos = ep.details?.protocols || [];
        const expired = cert?.notAfter && new Date(cert.notAfter) < new Date();
        const warnings = ep.hasWarnings ? getWarnings(ep, protos, ep.details) : [];
        return (
          <div key={ei} className="card fadein">
            <div style={{display:'flex',gap:16,alignItems:'center',marginBottom:warnings.length ? 12 : 20,flexWrap:'wrap'}}>
              <div style={{fontSize:56,fontWeight:800,fontFamily:'var(--mono)',color:gradeColor(ep.grade),lineHeight:1,minWidth:60}}>{ep.grade || '?'}</div>
              <div>
                <div style={{fontWeight:600,fontSize:15}}>{result.host}</div>
                <div style={{color:'var(--muted)',fontSize:12,fontFamily:'var(--mono)'}}>{ep.ipAddress}</div>
                <div style={{display:'flex',gap:6,marginTop:6,flexWrap:'wrap'}}>
                  {ep.hasWarnings && <span className="badge badge-yellow">{t('ssl.warnings')}</span>}
                  {ep.gradeTrustIgnored && ep.gradeTrustIgnored !== ep.grade && (
                    <span className="badge" style={{color:'var(--muted)'}}>{t('ssl.trust_ignored', { grade: ep.gradeTrustIgnored })}</span>
                  )}
                  {expired && <span className="badge badge-red">{t('ssl.expired')}</span>}
                </div>
              </div>
            </div>
            {warnings.length > 0 && (
              <div style={{marginBottom:20,padding:'10px 12px',background:'rgba(255,193,7,.07)',border:'1px solid rgba(255,193,7,.2)',borderRadius:6}}>
                {warnings.map((w, i) => (
                  <div key={i} style={{fontSize:12,color:'var(--yellow)',display:'flex',alignItems:'center',gap:6,marginTop:i?4:0}}>
                    <span>⚠</span><span>{w}</span>
                  </div>
                ))}
              </div>
            )}

            {cert && (<>
              <div style={{fontSize:10,color:'var(--muted)',textTransform:'uppercase',fontWeight:700,letterSpacing:1,marginBottom:10}}>{t('ssl.certificate')}</div>
              <div className="result-grid">
                <ResultItem label={t('ssl.fields.common_name')} value={(cert.commonNames||[]).join(', ') || t('ssl.na', 'N/A')} />
                <ResultItem label={t('ssl.fields.sans')} value={cert.altNames?.length ? `${cert.altNames.slice(0,6).join(', ')}${cert.altNames.length>6?' '+t('ssl.sans_more', { n: cert.altNames.length-6 }):''}` : t('ssl.sans_none', 'None')} />
                <ResultItem label={t('ssl.fields.issuer')} value={cert.issuerSubject || t('ssl.na', 'N/A')} />
                <ResultItem label={t('ssl.fields.valid_from')} value={cert.notBefore ? new Date(cert.notBefore).toISOString().split('T')[0] : t('ssl.na', 'N/A')} />
                <ResultItem label={t('ssl.fields.expires')} value={formatExpiry(cert.notAfter)} red={expired} green={!expired} />
                <ResultItem label={t('ssl.fields.key')} value={`${cert.keyAlg||'?'} ${cert.keyStrength||'?'}-bit`} />
                <ResultItem label={t('ssl.fields.signature')} value={cert.sigAlg || t('ssl.na', 'N/A')} />
                <ResultItem label={t('ssl.fields.revocation')} value={revMap[cert.revocationStatus] || t('ssl.rev.unknown')} green={cert.revocationStatus===2} red={cert.revocationStatus===1} />
                {chainIssues != null && <ResultItem label={t('ssl.fields.chain_issues')} value={chainIssueStr(chainIssues)} green={!chainIssues} red={!!chainIssues} />}
              </div>
            </>)}

            {protos.length > 0 && (<>
              <div style={{fontSize:10,color:'var(--muted)',textTransform:'uppercase',fontWeight:700,letterSpacing:1,margin:'18px 0 10px'}}>{t('ssl.protocol_support')}</div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                {[{id:769,label:'TLS 1.0',bad:true},{id:770,label:'TLS 1.1',bad:true},{id:771,label:'TLS 1.2',bad:false},{id:772,label:'TLS 1.3',bad:false}].map(({id,label,bad}) => {
                  const on = protos.some(p => p.id === id);
                  return (
                    <span key={id} className={`badge ${on ? (bad ? 'badge-red' : 'badge-green') : ''}`} style={{opacity:on?1:0.35}}>
                      {on ? '✓' : '✗'} {label}
                    </span>
                  );
                })}
              </div>
            </>)}
          </div>
        );
      })}
    </div>
  );
}

// ─── Tool: HTTP Header Analyzer ───────────────────────────────
const HTTP_SECURITY_CHECKS = [
  { key:'strict-transport-security',   impact:'critical' },
  { key:'content-security-policy',     impact:'critical' },
  { key:'x-frame-options',             impact:'high' },
  { key:'x-content-type-options',      impact:'medium' },
  { key:'referrer-policy',             impact:'medium' },
  { key:'permissions-policy',          impact:'medium' },
  { key:'cross-origin-opener-policy',  impact:'low' },
  { key:'cross-origin-embedder-policy',impact:'low' },
  { key:'x-xss-protection',            impact:'legacy' },
];

const IMPACT_COLOR = { critical:'var(--red)', high:'var(--yellow)', medium:'var(--cyan)', low:'var(--muted)', legacy:'var(--dim)' };

window.SSLInspector = SSLInspector;
