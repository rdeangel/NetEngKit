const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SecurityHeaders({ onShare, onNav, initialData }) {
  const { t } = useTranslation();
  const [url, setUrl] = usePersistentState('sechdrs:url', initialData?.url ?? '');
  const [proxy, setProxy] = useState('http://localhost:8080/proxy/fetch?url=');
  const [showProxy, setShowProxy] = useState(false);
  const [rawInput, setRawInput] = usePersistentState('sechdrs:rawInput', initialData?.rawInput ?? '');
  const [activeTab, setActiveTab] = usePersistentState('sechdrs:activeTab', initialData?.activeTab ?? 'url');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [results, setResults] = usePersistentState('sechdrs:results', null);
  const [resultTab, setResultTab] = usePersistentState('sechdrs:resultTab', 'security');

  const PRESETS = [
    { label: t('sechdrs.presets.google'), value: 'https://www.google.com' },
    { label: t('sechdrs.presets.github'), value: 'https://github.com' },
    { label: t('sechdrs.presets.cloudflare'), value: 'https://www.cloudflare.com' },
    { label: t('sechdrs.presets.example'), value: 'https://example.com' },
  ];

  const RAW_PRESETS = [
    { label: t('sechdrs.presets.good_headers'), value: 'HTTP/2 200\nstrict-transport-security: max-age=31536000; includeSubDomains; preload\ncontent-security-policy: default-src \'self\'; script-src \'self\'\nx-frame-options: DENY\nx-content-type-options: nosniff\nreferrer-policy: strict-origin-when-cross-origin\npermissions-policy: camera=(), microphone=(), geolocation=()\ncross-origin-opener-policy: same-origin\ncross-origin-embedder-policy: require-corp\nx-xss-protection: 0' },
    { label: t('sechdrs.presets.minimal_headers'), value: 'HTTP/1.1 200 OK\nContent-Type: text/html\nServer: Apache/2.4' },
  ];

  const CHECKS = useMemo(() => [
    { key: 'strict-transport-security', label: t('sechdrs.checks.hsts'), impact: 'critical', rec: 'max-age=31536000; includeSubDomains; preload', desc: t('sechdrs.checks.hsts_desc') },
    { key: 'content-security-policy', label: t('sechdrs.checks.csp'), impact: 'critical', rec: "default-src 'self'", desc: t('sechdrs.checks.csp_desc') },
    { key: 'x-frame-options', label: t('sechdrs.checks.xfo'), impact: 'high', rec: 'DENY', desc: t('sechdrs.checks.xfo_desc') },
    { key: 'x-content-type-options', label: t('sechdrs.checks.cto'), impact: 'medium', rec: 'nosniff', desc: t('sechdrs.checks.cto_desc') },
    { key: 'referrer-policy', label: t('sechdrs.checks.rp'), impact: 'medium', rec: 'strict-origin-when-cross-origin', desc: t('sechdrs.checks.rp_desc') },
    { key: 'permissions-policy', label: t('sechdrs.checks.pp'), impact: 'medium', rec: 'camera=(), microphone=()', desc: t('sechdrs.checks.pp_desc') },
    { key: 'cross-origin-opener-policy', label: t('sechdrs.checks.coop'), impact: 'low', rec: 'same-origin', desc: t('sechdrs.checks.coop_desc') },
    { key: 'cross-origin-embedder-policy', label: t('sechdrs.checks.coep'), impact: 'low', rec: 'require-corp', desc: t('sechdrs.checks.coep_desc') },
    { key: 'cross-origin-resource-policy', label: t('sechdrs.checks.corp'), impact: 'low', rec: 'same-origin', desc: t('sechdrs.checks.corp_desc') },
    { key: 'x-xss-protection', label: t('sechdrs.checks.xss'), impact: 'legacy', rec: '0 (disable, use CSP instead)', desc: t('sechdrs.checks.xss_desc') },
    { key: 'x-powered-by', label: t('sechdrs.checks.xpb'), impact: 'info', rec: t('sechdrs.checks.xpb_rec'), desc: t('sechdrs.checks.xpb_desc') },
    { key: 'server', label: t('sechdrs.checks.server'), impact: 'info', rec: t('sechdrs.checks.server_rec'), desc: t('sechdrs.checks.server_desc') },
  ], [t]);

  const IMPACT_STYLE = {
    critical: { color: 'var(--red)', bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)' },
    high: { color: 'var(--red)', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.2)' },
    medium: { color: 'var(--yellow)', bg: 'rgba(234,179,8,0.08)', border: 'rgba(234,179,8,0.2)' },
    low: { color: 'var(--cyan)', bg: 'rgba(6,182,212,0.08)', border: 'rgba(6,182,212,0.2)' },
    legacy: { color: 'var(--dim)', bg: 'var(--panel)', border: 'var(--border)' },
    info: { color: 'var(--muted)', bg: 'var(--panel)', border: 'var(--border)' },
  };

  useEffect(() => {
    if (initialData) {
      if (initialData.url !== undefined) setUrl(initialData.url);
      if (initialData.rawInput !== undefined) setRawInput(initialData.rawInput);
      if (initialData.activeTab !== undefined) setActiveTab(initialData.activeTab);
    }
  }, [initialData]);

  useEffect(() => { onNav?.({ activeTab }); }, [activeTab]);

  useEffect(() => {
    const handle = (e) => {
      if (url || rawInput) (e.detail?.respond ?? onShare)({ tool: 'sechdrs', activeTab, url, rawInput });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [activeTab, url, rawInput, onShare]);

  const parseRaw = (text) => {
    const lines = text.trim().split(/\r?\n/);
    const headers = {};
    let statusLine = '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/^HTTP\//i.test(trimmed)) { statusLine = trimmed; continue; }
      const idx = trimmed.indexOf(':');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim().toLowerCase();
      const val = trimmed.slice(idx + 1).trim();
      headers[key] = val;
    }
    return { headers, statusLine };
  };

  const analyzeHeaders = (headers) => {
    const analysis = CHECKS.map(check => {
      const value = headers[check.key];
      const present = value !== undefined;
      let status = 'missing';
      let notes = '';

      if (present) {
        status = 'present';
        // Specific validations
        if (check.key === 'strict-transport-security') {
          const maxAge = value.match(/max-age=(\d+)/);
          if (maxAge && parseInt(maxAge[1]) >= 31536000) status = 'good';
          else notes = t('sechdrs.notes.hsts_low');
        } else if (check.key === 'x-frame-options') {
          if (/^(DENY|SAMEORIGIN)$/i.test(value.trim())) status = 'good';
          else notes = t('sechdrs.notes.xfo_allow');
        } else if (check.key === 'content-security-policy') {
          if (value.includes('default-src')) status = 'good';
          else notes = t('sechdrs.notes.csp_no_default');
        } else if (check.key === 'x-content-type-options') {
          status = value.trim().toLowerCase() === 'nosniff' ? 'good' : 'present';
        } else if (check.key === 'referrer-policy') {
          const good = ['no-referrer', 'strict-origin', 'strict-origin-when-cross-origin', 'same-origin'];
          status = good.includes(value.trim().toLowerCase()) ? 'good' : 'present';
        } else if (check.key === 'x-xss-protection') {
          status = value.trim() === '0' ? 'good' : 'present';
          notes = value.trim() === '0' ? t('sechdrs.notes.xss_disabled') : t('sechdrs.notes.xss_legacy');
        } else if (check.key === 'x-powered-by') {
          status = 'leak';
          notes = t('sechdrs.notes.xpb_leak');
        } else if (check.key === 'server') {
          status = 'info';
          notes = value ? t('sechdrs.notes.server_exposed') : '';
        } else {
          status = 'good';
        }
      }

      return { ...check, value: value || null, present, status, notes };
    });

    const score = (() => {
      const critPresent = analysis.filter(c => c.impact === 'critical' && c.present).length;
      const critTotal = analysis.filter(c => c.impact === 'critical').length;
      const highPresent = analysis.filter(c => c.impact === 'high' && c.present).length;
      const highTotal = analysis.filter(c => c.impact === 'high').length;
      const medPresent = analysis.filter(c => c.impact === 'medium' && c.present).length;
      const medTotal = analysis.filter(c => c.impact === 'medium').length;
      const goodCount = analysis.filter(c => c.status === 'good').length;
      const total = CHECKS.filter(c => c.impact !== 'info' && c.impact !== 'legacy').length;
      return { critPresent, critTotal, highPresent, highTotal, medPresent, medTotal, goodCount, total, pct: Math.round((goodCount / total) * 100) };
    })();

    return { analysis, score, allHeaders: headers };
  };

  const handleFetch = async () => {
    setLoading(true);
    setError('');
    setResults(null);

    try {
      let headers;
      if (activeTab === 'url') {
        if (!proxy.trim()) { setError(t('sechdrs.err_no_proxy')); setLoading(false); return; }
        const target = url.trim().startsWith('http') ? url.trim() : `https://${url.trim()}`;
        const resp = await fetch(`${proxy.trim()}${encodeURIComponent(target)}`);
        let respHeaders = {};
        try {
          const json = await resp.json();
          if (json.headers) respHeaders = json.headers;
        } catch {}
        resp.headers.forEach((v, k) => { if (!respHeaders[k]) respHeaders[k] = v; });
        headers = respHeaders;
      } else {
        const parsed = parseRaw(rawInput);
        headers = parsed.headers;
      }
      setResults(analyzeHeaders(headers));
    } catch (e) {
      setError(t('sechdrs.err_fetch', { msg: e.message }));
    } finally {
      setLoading(false);
    }
  };

  const STATUS_ICON = {
    good: '✓', present: '⚠', missing: '✗', leak: '!', info: 'ℹ',
  };
  const STATUS_COLOR = {
    good: 'var(--green)', present: 'var(--yellow)', missing: 'var(--red)', leak: 'var(--red)', info: 'var(--muted)',
  };

  return (
    <div className="tool-content">

      <div className="card fadein">
        <div className="card-title">{t('sechdrs.input_title')}</div>
        <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
          {[
            { id: 'url', label: t('sechdrs.tab_url') },
            { id: 'raw', label: t('sechdrs.tab_raw') },
          ].map(tab => (
            <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
              background: activeTab === tab.id ? 'var(--card)' : 'transparent',
              border: '1px solid var(--border)',
              borderBottom: activeTab === tab.id ? '1px solid var(--card)' : '1px solid var(--border)',
              borderRadius: 'var(--radius) var(--radius) 0 0',
              color: activeTab === tab.id ? 'var(--fg)' : 'var(--dim)',
              cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '7px 16px', marginBottom: -1,
            }}>{tab.label}</button>
          ))}
        </div>

        {activeTab === 'url' && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 250 }}>
              <label className="label">{t('sechdrs.url_label')}</label>
              <input className="input" placeholder="https://example.com" value={url}
                onChange={e => setUrl(e.target.value)} onKeyDown={e => e.key === 'Enter' && !loading && url.trim() && handleFetch()}
                style={{ fontFamily: 'var(--mono)', fontSize: 12 }} />
            </div>
            <button className="btn btn-primary" onClick={handleFetch} disabled={loading || !url.trim()}>
              {loading ? t('sechdrs.analyzing') : t('sechdrs.analyze_btn')}
            </button>
          </div>
        )}

        {activeTab === 'raw' && (
          <div>
            <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 14px',display:'flex',gap:10,alignItems:'center',marginBottom:10}}>
              <div style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--cyan)',flex:1,wordBreak:'break-all'}}>
                {`curl -sI "${url.trim() ? (url.trim().startsWith('http') ? url.trim() : 'https://' + url.trim()) : 'https://example.com'}"`}
              </div>
              <CopyBtn text={`curl -sI "${url.trim() ? (url.trim().startsWith('http') ? url.trim() : 'https://' + url.trim()) : 'https://example.com'}"`} label="copy" id="curl" />
            </div>
            <label className="label">{t('sechdrs.raw_label')}</label>
            <textarea className="input" rows={8} value={rawInput}
              onChange={e => setRawInput(e.target.value)}
              placeholder={t('sechdrs.raw_placeholder')}
              style={{ fontFamily: 'var(--mono)', fontSize: 11, resize: 'vertical', width: '100%' }} />
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {RAW_PRESETS.map(p => (
                <button key={p.label} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}
                  onClick={() => setRawInput(p.value)}>{p.label}</button>
              ))}
            </div>
            <div style={{ marginTop: 10 }}>
              <button className="btn btn-primary" onClick={handleFetch} disabled={loading || !rawInput.trim()}>
                {loading ? t('sechdrs.analyzing') : t('sechdrs.analyze_btn')}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'url' && (
          <div style={{ marginTop: 10 }}>
            <button className={`btn ${showProxy ? 'btn-primary' : 'btn-ghost'} btn-sm`}
              onClick={() => setShowProxy(!showProxy)}>{t('sechdrs.proxy_settings')}</button>
            {showProxy && (
              <div style={{ marginTop: 6 }}>
                <input className="input" value={proxy} onChange={e => setProxy(e.target.value)}
                  placeholder="http://localhost:8080/proxy/fetch?url=" style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
              </div>
            )}
          </div>
        )}
      </div>

      {/* URL presets */}
      {activeTab === 'url' && (
        <div className="card fadein">
          <div className="card-title">{t('sechdrs.presets_title')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PRESETS.map(p => (
              <button key={p.label} className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }}
                onClick={() => setUrl(p.value)}>{p.label}</button>
            ))}
          </div>
        </div>
      )}

      <Err msg={error} />

      {/* Results */}
      {results && (
        <div className="fadein">
          {/* Score */}
          <div className="card">
            <div className="card-title">{t('sechdrs.score_title')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
              {[
                { label: t('sechdrs.score_grade'), value: results.score.pct >= 80 ? 'A' : results.score.pct >= 60 ? 'B' : results.score.pct >= 40 ? 'C' : results.score.pct >= 20 ? 'D' : 'F', color: results.score.pct >= 80 ? 'var(--green)' : results.score.pct >= 60 ? 'var(--cyan)' : results.score.pct >= 40 ? 'var(--yellow)' : 'var(--red)', size: 28 },
                { label: t('sechdrs.score_pct'), value: `${results.score.pct}%`, color: results.score.pct >= 80 ? 'var(--green)' : 'var(--yellow)', size: 18 },
                { label: t('sechdrs.score_critical'), value: `${results.score.critPresent}/${results.score.critTotal}`, color: results.score.critPresent === results.score.critTotal ? 'var(--green)' : 'var(--red)', size: 16 },
                { label: t('sechdrs.score_high'), value: `${results.score.highPresent}/${results.score.highTotal}`, color: results.score.highPresent === results.score.highTotal ? 'var(--green)' : 'var(--yellow)', size: 16 },
                { label: t('sechdrs.score_medium'), value: `${results.score.medPresent}/${results.score.medTotal}`, color: 'var(--cyan)', size: 16 },
              ].map(s => (
                <div key={s.label} style={{ padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: s.size, fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Result tabs */}
          <div className="card">
            <div style={{ display: 'flex', gap: 4, marginBottom: 12, borderBottom: '1px solid var(--border)' }}>
              {[
                { id: 'security', label: t('sechdrs.tab_security') },
                { id: 'headers', label: t('sechdrs.all_headers') },
              ].map(tab => (
                <button key={tab.id} onClick={() => setResultTab(tab.id)} style={{
                  background: resultTab === tab.id ? 'var(--card)' : 'transparent',
                  border: '1px solid var(--border)',
                  borderBottom: resultTab === tab.id ? '1px solid var(--card)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius) var(--radius) 0 0',
                  color: resultTab === tab.id ? 'var(--fg)' : 'var(--dim)',
                  cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', padding: '7px 16px', marginBottom: -1,
                }}>{tab.label}</button>
              ))}
            </div>

          {resultTab === 'security' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.analysis.map(check => {
                const style = IMPACT_STYLE[check.impact] || IMPACT_STYLE.info;
                return (
                  <div key={check.key} style={{
                    padding: '10px 14px', background: style.bg, borderRadius: 'var(--radius)',
                    border: `1px solid ${style.border}`,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: check.present ? 4 : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ color: STATUS_COLOR[check.status], fontWeight: 700, fontSize: 14, width: 20 }}>
                          {STATUS_ICON[check.status]}
                        </span>
                        <span style={{ fontWeight: 600, fontSize: 13 }}>{check.label}</span>
                        <span className={`badge ${check.impact === 'critical' ? 'badge-red' : check.impact === 'high' ? 'badge-yellow' : check.impact === 'medium' ? 'badge-cyan' : 'badge-gray'}`}
                          style={{ fontSize: 9 }}>{t('sechdrs.impact_' + check.impact)}</span>
                      </div>
                      <span style={{ fontSize: 11, color: check.present ? 'var(--green)' : 'var(--red)', fontWeight: 600 }}>
                        {check.present ? t('sechdrs.present') : t('sechdrs.missing')}
                      </span>
                    </div>
                    {check.present && check.value && (
                      <div style={{ marginLeft: 28, fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)', wordBreak: 'break-all', marginBottom: 4 }}>
                        {check.value}
                      </div>
                    )}
                    <div style={{ marginLeft: 28, fontSize: 11, color: 'var(--muted)' }}>
                      {check.desc}
                    </div>
                    {check.notes && (
                      <div style={{ marginLeft: 28, fontSize: 11, color: 'var(--yellow)', marginTop: 2 }}>
                        ⚠ {check.notes}
                      </div>
                    )}
                    {!check.present && (
                      <div style={{ marginLeft: 28, fontSize: 10, color: 'var(--dim)', marginTop: 2, fontFamily: 'var(--mono)' }}>
                        {t('sechdrs.recommendation')}: {check.rec}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {resultTab === 'headers' && results.allHeaders && (
            <>
              <div className="table-wrap hide-mobile">
                <table>
                  <thead><tr><th>{t('sechdrs.header')}</th><th>{t('sechdrs.value')}</th><th></th></tr></thead>
                  <tbody>
                    {Object.entries(results.allHeaders).sort(([a],[b]) => a.localeCompare(b)).map(([k, v]) => {
                      const isSec = CHECKS.some(c => c.key === k);
                      return (
                        <tr key={k}>
                          <td style={{fontFamily:'var(--mono)',fontSize:11,color:isSec?'var(--cyan)':'var(--muted)',whiteSpace:'nowrap'}}>{k}</td>
                          <td style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--fg)',wordBreak:'break-all'}}>{v}</td>
                          <td><CopyBtn text={v} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="hide-desktop">
                {Object.entries(results.allHeaders).sort(([a],[b]) => a.localeCompare(b)).map(([k, v]) => {
                  const isSec = CHECKS.some(c => c.key === k);
                  return (
                    <div key={k} className="mobile-card" style={{marginBottom:6}}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
                        <span className="mobile-card-label" style={{color:isSec?'var(--cyan)':'var(--muted)', fontFamily:'var(--mono)'}}>{k}</span>
                        <CopyBtn text={v} />
                      </div>
                      <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--fg)',wordBreak:'break-all',marginTop:2}}>{v}</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
          </div>
        </div>
      )}

    </div>
  );
}

window.SecurityHeaders = SecurityHeaders;
