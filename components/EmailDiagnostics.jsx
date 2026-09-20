const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── Email Diagnostics — SPF / DKIM / DMARC / MX Validation ───────────────

const DNS_API = 'https://dns.google/resolve';

async function dnsLookup(name, type) {
  const res = await fetch(`${DNS_API}?name=${encodeURIComponent(name)}&type=${type}`);
  const data = await res.json();
  return data;
}

function parseSPF(record, t) {
  const issues = [];
  const mechanisms = [];
  if (!record) return { mechanisms, issues, verdict:'missing' };

  const parts = record.split(/\s+/);
  let hasAll = false;
  let allDirective = '';

  for (const part of parts) {
    if (part === 'v=spf1') continue;

    let prefix = '';
    let mech = part;
    if (part.startsWith('+') || part.startsWith('-') || part.startsWith('~') || part.startsWith('?')) {
      prefix = part[0];
      mech = part.slice(1);
    } else {
      prefix = '+';
    }

    const parsed = { raw: part, prefix, mechanism: mech, qualifier: prefix };
    if (mech.startsWith('ip4:')) parsed.type = 'ip4', parsed.value = mech.slice(4);
    else if (mech.startsWith('ip6:')) parsed.type = 'ip6', parsed.value = mech.slice(4);
    else if (mech.startsWith('a')) parsed.type = 'a', parsed.value = mech.startsWith('a:') ? mech.slice(2) : '';
    else if (mech.startsWith('mx')) parsed.type = 'mx', parsed.value = mech.startsWith('mx:') ? mech.slice(3) : '';
    else if (mech.startsWith('include:')) parsed.type = 'include', parsed.value = mech.slice(8);
    else if (mech.startsWith('exists:')) parsed.type = 'exists', parsed.value = mech.slice(7);
    else if (mech.startsWith('redirect=')) parsed.type = 'redirect', parsed.value = mech.slice(9);
    else if (mech === 'all') { parsed.type = 'all'; hasAll = true; allDirective = prefix; }
    else parsed.type = 'unknown', parsed.value = mech;

    mechanisms.push(parsed);
  }

  if (!hasAll) issues.push({ severity:'warn', msg: t('email.issues.spf_no_all', 'No "all" mechanism found — SPF record is incomplete') });
  if (allDirective === '+') issues.push({ severity:'error', msg: t('email.issues.spf_plus_all', '"+all" allows ALL senders — effectively disables SPF protection') });
  if (allDirective === '?') issues.push({ severity:'warn', msg: t('email.issues.spf_question_all', '"?all" is neutral — provides no enforcement, consider "~all" or "-all"') });
  if (allDirective === '~') issues.push({ severity:'info', msg: t('email.issues.spf_tilde_all', '"~all" (softfail) — good for transition, consider "-all" for strict enforcement') });
  if (allDirective === '-') issues.push({ severity:'ok', msg: t('email.issues.spf_minus_all', '"-all" (hardfail) — strict SPF enforcement, recommended') });

  const includeCount = mechanisms.filter(m=>m.type==='include').length;
  if (includeCount > 10) issues.push({ severity:'error', msg: t('email.issues.spf_dns_limit_exceeded', '{count} DNS lookups — exceeds RFC 7208 limit of 10', { count: includeCount }) });
  else if (includeCount > 7) issues.push({ severity:'warn', msg: t('email.issues.spf_dns_limit_approaching', '{count}/10 DNS lookups used — approaching limit', { count: includeCount }) });

  const verdict = issues.some(i=>i.severity==='error') ? 'fail' :
                  issues.some(i=>i.severity==='warn') ? 'warn' :
                  issues.some(i=>i.severity==='ok') ? 'pass' :
                  hasAll ? 'pass' : 'missing';

  return { mechanisms, issues, verdict };
}

function parseDMARC(record, t) {
  const issues = [];
  if (!record) return { tags:{}, issues, verdict:'missing' };

  const tags = {};
  const parts = record.split(';').map(s=>s.trim()).filter(Boolean);
  for (const part of parts) {
    const [k,...rest] = part.split('=');
    tags[k.trim()] = rest.join('=').trim();
  }

  if (!tags.v) issues.push({ severity:'error', msg: t('email.issues.dmarc_missing_v', 'Missing DMARC version tag (v=DMARC1)') });
  if (!tags.p) issues.push({ severity:'warn', msg: t('email.issues.dmarc_missing_p', 'Missing policy tag (p=) — DMARC has no effect') });
  if (tags.p === 'none') issues.push({ severity:'warn', msg: t('email.issues.dmarc_p_none', 'p=none — monitoring only, no enforcement action taken') });
  if (tags.p === 'quarantine') issues.push({ severity:'info', msg: t('email.issues.dmarc_p_quarantine', 'p=quarantine — failing messages sent to spam/quarantine') });
  if (tags.p === 'reject') issues.push({ severity:'ok', msg: t('email.issues.dmarc_p_reject', 'p=reject — strongest enforcement, rejects failing messages') });
  if (!tags.rua && !tags.ruf) issues.push({ severity:'info', msg: t('email.issues.dmarc_no_reporting', 'No reporting addresses configured — add rua= for aggregate reports') });
  if (tags.pct) {
    const pct = parseInt(tags.pct);
    if (pct < 100) issues.push({ severity:'warn', msg: t('email.issues.dmarc_pct', 'pct={pct} — only {pct}% of failing mail is affected', { pct }) });
  }
  if (tags.adkim) issues.push({ severity:'info', msg: t('email.issues.dmarc_adkim', 'DKIM alignment: {adkim} ({strict_relaxed})', { adkim: tags.adkim, strict_relaxed: tags.adkim==='s' ? 'strict' : 'relaxed' }) });
  if (tags.aspf) issues.push({ severity:'info', msg: t('email.issues.dmarc_aspf', 'SPF alignment: {aspf} ({strict_relaxed})', { aspf: tags.aspf, strict_relaxed: tags.aspf==='s' ? 'strict' : 'relaxed' }) });

  const verdict = issues.some(i=>i.severity==='error') ? 'fail' :
                  issues.some(i=>i.severity==='warn') ? 'warn' :
                  issues.some(i=>i.severity==='ok') ? 'pass' : 'pass';

  return { tags, issues, verdict };
}

function parseDKIM(record, t) {
  const issues = [];
  if (!record) return { tags:{}, issues, verdict:'missing' };
  if (record.includes('NXDOMAIN') || record === '') return { tags:{}, issues:[{severity:'warn', msg: t('email.issues.dkim_not_found', 'DKIM record not found')}], verdict:'missing' };

  const tags = {};
  const parts = record.split(';').map(s=>s.trim()).filter(Boolean);
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    if (eqIdx > 0) tags[part.slice(0,eqIdx).trim()] = part.slice(eqIdx+1).trim();
  }

  if (!tags.p) issues.push({ severity:'error', msg: t('email.issues.dkim_missing_p', 'Missing p= tag (public key) — record is invalid') });
  else if (tags.p === '') issues.push({ severity:'warn', msg: t('email.issues.dkim_empty_p', 'p= is empty — DKIM key has been revoked') });

  if (tags.k === 'ed25519') issues.push({ severity:'info', msg: t('email.issues.dkim_ed25519', 'Using Ed25519 — modern elliptic curve algorithm') });
  else if (tags.k === 'rsa' || !tags.k) issues.push({ severity:'info', msg: t('email.issues.dkim_rsa', 'Using RSA{default_suffix} — ensure key size ≥ 2048 bits', { default_suffix: tags.k ? '' : ' (default)' }) });

  if (tags.h) issues.push({ severity:'info', msg: t('email.issues.dkim_hash', 'Hash algorithms: {hash}', { hash: tags.h }) });
  if (tags.s) {
    if (tags.s === '*') issues.push({ severity:'info', msg: t('email.issues.dkim_selector_any', 'Selector scope: * (matches any)') });
    else issues.push({ severity:'info', msg: t('email.issues.dkim_selector', 'Selector scope: {selector}', { selector: tags.s }) });
  }

  const verdict = issues.some(i=>i.severity==='error') ? 'fail' :
                  issues.some(i=>i.severity==='warn') ? 'warn' :
                  issues.some(i=>i.severity==='ok' || i.severity==='info') ? 'pass' : 'pass';

  return { tags, issues, verdict };
}

const verdictBadge = (v, t) => {
  const map = { pass:'badge-green', warn:'badge-yellow', fail:'badge-red', missing:'badge-gray', info:'badge-blue' };
  const labels = { pass:t('email.badge_pass','PASS'), warn:t('email.badge_warn','WARN'), fail:t('email.badge_fail','FAIL'), missing:t('email.badge_missing','MISSING'), info:t('email.badge_info','INFO') };
  return <span className={`badge ${map[v]||'badge-gray'}`}>{labels[v]||v}</span>;
};

const severityIcon = (s) => {
  if(s==='error') return <span style={{color:'var(--red)'}}>✗</span>;
  if(s==='warn') return <span style={{color:'var(--yellow)'}}>⚠</span>;
  if(s==='ok') return <span style={{color:'var(--green)'}}>✓</span>;
  return <span style={{color:'var(--blue)'}}>ℹ</span>;
};

function EmailDiagnostics({ onShare, initialData }) {
  const { t } = useTranslation();
  const [domain, setDomain] = usePersistentState('email:domain', initialData?.domain ?? '');
  const [dkimSelector, setDkimSelector] = usePersistentState('email:dkimSelector', initialData?.dkimSelector ?? 'default');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = usePersistentState('email:results', null);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (initialData) {
      if (initialData.domain !== undefined) setDomain(initialData.domain);
      if (initialData.dkimSelector !== undefined) setDkimSelector(initialData.dkimSelector);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (domain) (e.detail?.respond ?? onShare)({ tool:'email-diag', domain, dkimSelector });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [domain, dkimSelector, onShare]);

  const analyze = async (overrideDomain) => {
    const d = (typeof overrideDomain === 'string' ? overrideDomain : domain).trim();
    if (!d) { setErr(t('email.err_domain', 'Enter a domain name')); return; }
    setErr(''); setResults(null); setLoading(true);

    try {
      // Fetch all DNS records in parallel
      const [spfRes, mxRes, dmarcRes, dkimRes] = await Promise.all([
        dnsLookup(d, 'TXT'),
        dnsLookup(d, 'MX'),
        dnsLookup(`_dmarc.${d}`, 'TXT'),
        dnsLookup(`${dkimSelector}._domainkey.${d}`, 'TXT'),
      ]);

      // Parse SPF
      const spfRecord = spfRes.Answer?.find(a => a.data?.startsWith('"v=spf1'))?.data?.replace(/^"|"$/g,'')
        || spfRes.Answer?.find(a => a.data?.includes('v=spf1'))?.data?.replace(/^"|"$/g,'')
        || null;
      const spf = parseSPF(spfRecord, t);

      // Parse MX
      const mxRecords = mxRes.Answer?.filter(a=>a.type===15).sort((a,b)=>a.data?.localeCompare(b.data)) || [];

      // Parse DMARC
      const dmarcRecord = dmarcRes.Answer?.find(a=>a.data?.includes('v=DMARC1'))?.data?.replace(/^"|"$/g,'')
        || dmarcRes.Answer?.[0]?.data?.replace(/^"|"$/g,'')
        || null;
      const dmarc = parseDMARC(dmarcRecord, t);

      // Parse DKIM
      const dkimRecord = dkimRes.Answer?.find(a=>a.data?.includes('p='))?.data?.replace(/^"|"$/g,'')
        || dkimRes.Answer?.[0]?.data?.replace(/^"|"$/g,'')
        || null;
      const dkim = parseDKIM(dkimRecord, t);

      // Overall score
      const checks = [spf.verdict, dmarc.verdict, dkim.verdict];
      const hasMX = mxRecords.length > 0;
      const score = checks.reduce((acc, v) => acc + (v==='pass'?25:v==='warn'?15:v==='info'?20:0), 0) + (hasMX?25:0);

      setResults({ spf, spfRecord, mx: mxRecords, dmarc, dmarcRecord, dkim, dkimRecord, score, hasMX });
    } catch (e) {
      setErr(t('email.err_failed', 'Analysis failed') + ': ' + e.message);
    }
    setLoading(false);
  };

  const scoreColor = (s) => s >= 80 ? 'var(--green)' : s >= 50 ? 'var(--yellow)' : 'var(--red)';
  const scoreLabel = (s) => s >= 80 ? t('email.score_good','Good') : s >= 50 ? t('email.score_fair','Fair') : t('email.score_poor','Poor');

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">
          {t('email.title', 'Email Diagnostics')}
          <span className="badge badge-blue" style={{marginLeft:8,fontSize:10}}>{t('email.subtitle', 'SPF \u00b7 DKIM \u00b7 DMARC \u00b7 MX')}</span>
        </div>
        <div className="field">
          <label className="label">{t('email.label', 'Domain Name')}</label>
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={domain} onChange={e=>setDomain(e.target.value)}
              onKeyDown={e=>e.key==='Enter'&&analyze()} placeholder={t('email.placeholder', 'e.g. example.com')}/>
            <button type="button" className="btn btn-primary" onClick={() => analyze()} disabled={loading}>{loading ? '...' : t('email.analyze', 'Analyze')}</button>
          </div>
          <Err msg={err}/>
        </div>
        <div className="field">
          <label className="label">{t('email.dkim_selector', 'DKIM Selector')}</label>
          <input className="input" value={dkimSelector} onChange={e=>setDkimSelector(e.target.value)}
            placeholder="default" style={{maxWidth:200}}/>
          <div className="hint">{t('email.dkim_hint', 'Common selectors: default, google, selector1, selector2, s1, mail')}</div>
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {['gmail.com','outlook.com','github.com','cloudflare.com','amazon.com'].map(p => (
            <button key={p} className="btn btn-ghost btn-sm" onClick={()=>{setDomain(p); analyze(p);}}>{p}</button>
          ))}
        </div>
      </div>

      {results && (
        <>
          {/* Score Card */}
          <div className="card fadein">
            <div className="card-title">{t('email.overall_score', 'Overall Email Security Score')}</div>
            <div style={{display:'flex',alignItems:'center',gap:20,flexWrap:'wrap'}}>
              <div style={{
                width:80,height:80,borderRadius:'50%',border:`4px solid ${scoreColor(results.score)}`,
                display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',
                fontFamily:'var(--mono)',fontWeight:700,fontSize:22,color:scoreColor(results.score),
              }}>
                {results.score}
                <div style={{fontSize:10,fontWeight:500,marginTop:-2}}>{scoreLabel(results.score)}</div>
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',background:'var(--panel)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                  <span style={{fontWeight:600,fontSize:12}}>{t('email.proto_mx','MX')}</span>
                  {results.hasMX ? <span style={{color:'var(--green)',fontSize:14}}>✓</span> : <span style={{color:'var(--red)',fontSize:14}}>✗</span>}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',background:'var(--panel)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                  <span style={{fontWeight:600,fontSize:12}}>{t('email.proto_spf','SPF')}</span>
                  {verdictBadge(results.spf.verdict, t)}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',background:'var(--panel)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                  <span style={{fontWeight:600,fontSize:12}}>{t('email.proto_dkim','DKIM')}</span>
                  {verdictBadge(results.dkim.verdict, t)}
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,padding:'6px 12px',background:'var(--panel)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
                  <span style={{fontWeight:600,fontSize:12}}>{t('email.proto_dmarc','DMARC')}</span>
                  {verdictBadge(results.dmarc.verdict, t)}
                </div>
              </div>
            </div>
          </div>

          {/* MX Records */}
          <div className="card fadein">
            <div className="card-title" style={{color:'var(--blue)'}}>
              {t('email.mx_title','MX Records')}
              <span className="badge badge-blue" style={{marginLeft:8,fontSize:10}}>{t('email.mx_count', { count: results.mx.length })}</span>
            </div>
            {results.mx.length > 0 ? (
              <>
                <div className="table-wrap hide-mobile">
                  <table>
                    <thead><tr><th>{t('email.th_priority','Priority')}</th><th>{t('email.th_mail_server','Mail Server')}</th><th>{t('email.th_ttl','TTL')}</th></tr></thead>
                    <tbody>
                      {results.mx.map((r,i)=>(
                        <tr key={i}>
                          <td style={{fontWeight:700,color:'var(--cyan)',fontFamily:'var(--mono)'}}>{r.data?.split(' ')[0] || r.data}</td>
                          <td style={{fontWeight:500}}>{r.data?.split(' ').slice(1).join(' ') || r.name}</td>
                          <td style={{color:'var(--dim)'}}>{r.TTL}s</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="show-mobile mobile-cards">
                  {results.mx.map((r,i)=>(
                    <div key={i} className="mobile-card">
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('email.mx_priority','Priority')}</span>
                        <span className="mobile-card-value" style={{color:'var(--cyan)'}}>{r.data?.split(' ')[0]}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('email.mx_server','Server')}</span>
                        <span className="mobile-card-value">{r.data?.split(' ').slice(1).join(' ')}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div style={{padding:'10px 14px',background:'rgba(239,68,68,.1)',border:'1px solid var(--red)',borderRadius:'var(--radius)',color:'var(--red)',fontSize:12}}>
                ⚠ {t('email.mx_none','No MX records found \u2014 this domain cannot receive email directly.')}
              </div>
            )}
          </div>

          {/* SPF */}
          <div className="card fadein">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div className="card-title" style={{marginBottom:0,color:'var(--green)'}}>{t('email.spf_title','SPF (Sender Policy Framework)')} {verdictBadge(results.spf.verdict, t)}</div>
              {results.spfRecord && <CopyBtn text={results.spfRecord}/>}
            </div>
            {results.spfRecord ? (
              <>
                <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:10,fontFamily:'var(--mono)',fontSize:11,color:'var(--cyan)',wordBreak:'break-all',marginBottom:12}}>
                  {results.spfRecord}
                </div>
                {results.spf.mechanisms.length > 0 && (
                  <div style={{marginBottom:12}}>
                    <div className="label" style={{marginBottom:6}}>{t('email.mechanisms','Mechanisms')}</div>
                    <div style={{display:'flex',gap:4,flexWrap:'wrap'}}>
                      {results.spf.mechanisms.map((m,i)=>(
                        <span key={i} className={`badge ${m.qualifier==='-'?'badge-green':m.qualifier==='~'?'badge-yellow':m.qualifier==='+'?'badge-red':'badge-gray'}`} style={{fontFamily:'var(--mono)',fontSize:10}}>
                          {m.raw}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div style={{padding:'10px 14px',background:'rgba(245,158,11,.1)',border:'1px solid var(--yellow)',borderRadius:'var(--radius)',color:'var(--yellow)',fontSize:12}}>
                ⚠ {t('email.spf_none','No SPF record found \u2014 any server can send email as this domain. Add a TXT record starting with \"v=spf1\".')}
              </div>
            )}
            {results.spf.issues.length > 0 && (
              <div style={{marginTop:8}}>
                {results.spf.issues.map((issue,i)=>(
                  <div key={i} style={{display:'flex',gap:6,alignItems:'flex-start',padding:'4px 0',fontSize:12}}>
                    {severityIcon(issue.severity)}
                    <span style={{color:'var(--muted)'}}>{issue.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* DKIM */}
          <div className="card fadein">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div className="card-title" style={{marginBottom:0,color:'var(--purple)'}}>{t('email.dkim_title','DKIM (DomainKeys Identified Mail)')} {verdictBadge(results.dkim.verdict, t)}</div>
              {results.dkimRecord && <CopyBtn text={results.dkimRecord}/>}
            </div>
            {results.dkimRecord ? (
              <>
                <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:10,fontFamily:'var(--mono)',fontSize:11,color:'var(--purple)',wordBreak:'break-all',marginBottom:12}}>
                  {results.dkimRecord}
                </div>
                {Object.keys(results.dkim.tags).length > 0 && (
                  <div className="table-wrap hide-mobile" style={{marginBottom:12}}>
                    <table>
                      <thead><tr><th>{t('email.th_tag','Tag')}</th><th>{t('email.th_value','Value')}</th><th>{t('email.th_description','Description')}</th></tr></thead>
                      <tbody>
                        {Object.entries(results.dkim.tags).map(([k,v])=>(
                          <tr key={k}>
                            <td style={{fontWeight:700,color:'var(--cyan)',fontFamily:'var(--mono)'}}>{k}=</td>
                            <td style={{fontFamily:'var(--mono)',fontSize:11,wordBreak:'break-all',maxWidth:300}}>{v.length>80?v.slice(0,80)+'…':v}</td>
                            <td style={{color:'var(--muted)',fontSize:11}}>
                              {k==='v'?t('email.dkim_desc_version','Version'):k==='k'?t('email.dkim_desc_key_type','Key type'):k==='p'?t('email.dkim_desc_public_key','Public key'):k==='s'?t('email.dkim_desc_selector','Selector scope'):k==='h'?t('email.dkim_desc_hash','Hash alg'):k==='g'?t('email.dkim_desc_granularity','Granularity'):k==='n'?t('email.dkim_desc_notes','Notes'):k==='t'?t('email.dkim_desc_flags','Flags'):'—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div style={{padding:'10px 14px',background:'rgba(245,158,11,.1)',border:'1px solid var(--yellow)',borderRadius:'var(--radius)',color:'var(--yellow)',fontSize:12}}>
                ⚠ {t('email.dkim_none', { selector: dkimSelector })}
              </div>
            )}
            {results.dkim.issues.length > 0 && (
              <div style={{marginTop:8}}>
                {results.dkim.issues.map((issue,i)=>(
                  <div key={i} style={{display:'flex',gap:6,alignItems:'flex-start',padding:'4px 0',fontSize:12}}>
                    {severityIcon(issue.severity)}
                    <span style={{color:'var(--muted)'}}>{issue.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* DMARC */}
          <div className="card fadein">
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
              <div className="card-title" style={{marginBottom:0,color:'var(--yellow)'}}>{t('email.dmarc_title','DMARC (Domain-based Message Authentication)')} {verdictBadge(results.dmarc.verdict, t)}</div>
              {results.dmarcRecord && <CopyBtn text={results.dmarcRecord}/>}
            </div>
            {results.dmarcRecord ? (
              <>
                <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:10,fontFamily:'var(--mono)',fontSize:11,color:'var(--yellow)',wordBreak:'break-all',marginBottom:12}}>
                  {results.dmarcRecord}
                </div>
                {Object.keys(results.dmarc.tags).length > 0 && (
                  <div className="table-wrap hide-mobile" style={{marginBottom:12}}>
                    <table>
                      <thead><tr><th>{t('email.th_tag','Tag')}</th><th>{t('email.th_value','Value')}</th><th>{t('email.th_description','Description')}</th></tr></thead>
                      <tbody>
                        {Object.entries(results.dmarc.tags).map(([k,v])=>(
                          <tr key={k}>
                            <td style={{fontWeight:700,color:'var(--cyan)',fontFamily:'var(--mono)'}}>{k}=</td>
                            <td style={{fontWeight:600}}>{v}</td>
                            <td style={{color:'var(--muted)',fontSize:11}}>
                              {k==='v'?t('email.dmarc_desc_version','Version'):k==='p'?t('email.dmarc_desc_policy','Policy'):k==='sp'?t('email.dmarc_desc_subdomain_policy','Subdomain policy'):k==='rua'?t('email.dmarc_desc_aggregate_reports','Aggregate reports'):k==='ruf'?t('email.dmarc_desc_forensic_reports','Forensic reports'):k==='pct'?t('email.dmarc_desc_apply_pct','Apply %'):k==='adkim'?t('email.dmarc_desc_dkim_alignment','DKIM alignment'):k==='aspf'?t('email.dmarc_desc_spf_alignment','SPF alignment'):k==='ri'?t('email.dmarc_desc_report_interval','Report interval'):k==='fo'?t('email.dmarc_desc_failure_opts','Failure opts'):'—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            ) : (
              <div style={{padding:'10px 14px',background:'rgba(245,158,11,.1)',border:'1px solid var(--yellow)',borderRadius:'var(--radius)',color:'var(--yellow)',fontSize:12}}>
                ⚠ {t('email.dmarc_none', { domain: d })}
              </div>
            )}
            {results.dmarc.issues.length > 0 && (
              <div style={{marginTop:8}}>
                {results.dmarc.issues.map((issue,i)=>(
                  <div key={i} style={{display:'flex',gap:6,alignItems:'flex-start',padding:'4px 0',fontSize:12}}>
                    {severityIcon(issue.severity)}
                    <span style={{color:'var(--muted)'}}>{issue.msg}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recommendations */}
          <div className="card fadein">
            <div className="card-title">{t('email.recommendations', 'Recommendations')}</div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.8}}>
              {!results.hasMX && <div>• <strong style={{color:'var(--text)'}}>{t('email.rec_add_mx','Add MX records')}</strong> — {t('email.rec_add_mx_desc','Required for receiving email at this domain.')}</div>}
              {!results.spfRecord && <div>• <strong style={{color:'var(--text)'}}>{t('email.rec_add_spf','Add SPF record')}</strong> — {t('email.rec_add_spf_desc','Create a TXT record:')} <code style={{fontFamily:'var(--mono)',color:'var(--green)',background:'var(--panel)',padding:'2px 6px',borderRadius:4}}>v=spf1 include:_spf.google.com ~all</code></div>}
              {!results.dkimRecord && <div>• <strong style={{color:'var(--text)'}}>{t('email.rec_enable_dkim','Enable DKIM signing')}</strong> — {t('email.rec_enable_dkim_desc','Publish a public key in DNS at')} <code style={{fontFamily:'var(--mono)',color:'var(--purple)',background:'var(--panel)',padding:'2px 6px',borderRadius:4}}>selector._domainkey.{domain}</code></div>}
              {!results.dmarcRecord && <div>• <strong style={{color:'var(--text)'}}>{t('email.rec_add_dmarc','Add DMARC policy')}</strong> — {t('email.rec_add_dmarc_desc','Start with monitoring:')} <code style={{fontFamily:'var(--mono)',color:'var(--yellow)',background:'var(--panel)',padding:'2px 6px',borderRadius:4}}>v=DMARC1; p=none; rua=mailto:dmarc@{domain}</code></div>}
              {results.dmarcRecord && results.dmarc.tags.p === 'none' && <div>• <strong style={{color:'var(--text)'}}>{t('email.rec_upgrade_dmarc','Upgrade DMARC policy')}</strong> — {t('email.rec_upgrade_dmarc_from','Move from')} <code style={{fontFamily:'var(--mono)'}}>p=none</code> → <code style={{fontFamily:'var(--mono)'}}>p=quarantine</code> → <code style={{fontFamily:'var(--mono)'}}>p=reject</code> {t('email.rec_upgrade_dmarc_to','as you gain confidence.')}</div>}
              {results.spf.issues.some(i=>i.msg?.includes('+all')) && <div>• <strong style={{color:'var(--red)'}}>{t('email.rec_urgent_all','URGENT: Remove \"+all\"')}</strong> — {t('email.rec_urgent_all_desc','This allows anyone to send email as your domain. Use \"~all\" or \"-all\".')}</div>}
              <div>• <strong style={{color:'var(--text)'}}>{t('email.rec_test_delivery','Test email delivery')}</strong> — {t('email.rec_test_delivery_prefix','Send a test email to')} <a href="mailto:mail-tester@example.com" style={{color:'var(--cyan)'}}>mail-tester@webemai.ltestersonline.com</a> {t('email.rec_test_delivery_or','or use')} <a href="https://www.mail-tester.com" target="_blank" rel="noopener" style={{color:'var(--cyan)'}}>mail-tester.com</a> {t('email.rec_test_delivery_suffix','for a full spam score.')}</div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
window.EmailDiagnostics = EmailDiagnostics;
