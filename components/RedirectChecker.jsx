const { useState, useEffect, useCallback, useRef } = React;

function RedirectChecker({ onShare, initialData }) {
  const { t } = useTranslation();
  const [url, setUrl] = usePersistentState('redir:url', initialData?.url ?? '');
  const [proxy, setProxy] = useState('http://localhost:8080/proxy/fetch?url=');
  const [showProxy, setShowProxy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [chain, setChain] = usePersistentState('redir:chain', null);
  const [followMax, setFollowMax] = usePersistentState('redir:followMax', initialData?.followMax ?? 20);
  const [method, setMethod] = usePersistentState('redir:method', initialData?.method ?? 'GET');

  const PRESETS = [
    { label: t('redir.presets.http_bin'), value: 'https://httpbin.org/redirect/3' },
    { label: t('redir.presets.relative'), value: 'https://httpbin.org/relative-redirect/2' },
    { label: t('redir.presets.absolute'), value: 'https://httpbin.org/absolute-redirect/1' },
    { label: t('redir.presets.google'), value: 'http://google.com' },
    { label: t('redir.presets.github'), value: 'http://github.com' },
  ];

  useEffect(() => {
    if (initialData?.url !== undefined) setUrl(initialData.url);
    if (initialData?.followMax !== undefined) setFollowMax(initialData.followMax);
    if (initialData?.method !== undefined) setMethod(initialData.method);
  }, [initialData]);

  useEffect(() => {
    const handle = (e) => {
      if (url) (e.detail?.respond ?? onShare)({ tool: 'redircheck', url, followMax, method });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [url, followMax, method, onShare]);

  const proxyUrl = target => `${proxy.trim()}${encodeURIComponent(target)}`;
  const hasProxy = proxy.trim().length > 0;

  const STATUS_COLORS = {
    '2': 'var(--green)', '3': 'var(--yellow)', '4': 'var(--red)', '5': 'var(--red)',
  };

  const handleCheck = async () => {
    const target = url.trim();
    if (!target) return;

    setLoading(true);
    setError('');
    setChain(null);

    try {
      if (!hasProxy) {
        setError(t('redir.err_no_proxy'));
        setLoading(false);
        return;
      }

      const hops = [];
      let currentUrl = target.startsWith('http') ? target : `https://${target}`;
      let redirects = 0;

      while (redirects < followMax) {
        const fetchUrl = proxyUrl(currentUrl);
        const resp = await fetch(fetchUrl, { method: 'GET', redirect: 'manual' });

        // Try to read the response headers
        const headers = {};
        resp.headers.forEach((v, k) => headers[k.toLowerCase()] = v);

        // If using our proxy, we might get JSON back with status/headers
        let status = resp.status;
        let location = headers['location'];
        let contentType = headers['content-type'] || '';
        let server = headers['server'] || '';

        // Try parsing as JSON (our proxy format)
        let extraHeaders = {};
        try {
          const json = await resp.json();
          if (json.status) status = json.status;
          if (json.headers) {
            extraHeaders = json.headers;
            location = location || json.headers['location'] || json.headers['Location'];
            server = server || json.headers['server'] || json.headers['Server'];
          }
        } catch {}

        const isRedirect = status >= 300 && status < 400;
        const statusClass = String(status)[0];

        hops.push({
          url: currentUrl,
          status,
          location: location || null,
          server: server || null,
          contentType: contentType || null,
          isRedirect,
          headers: { ...headers, ...extraHeaders },
        });

        if (!isRedirect || !location) break;

        // Resolve relative URLs
        try {
          currentUrl = new URL(location, currentUrl).href;
        } catch {
          currentUrl = location;
        }
        redirects++;
      }

      setChain({ hops, total: hops.length, finalUrl: hops[hops.length - 1]?.url, isLoop: redirects >= followMax });
    } catch (e) {
      setError(t('redir.err_fetch', { msg: e.message }));
    } finally {
      setLoading(false);
    }
  };

  const curlCmd = () => {
    const target = url.trim();
    if (!target) return 'curl -ILsS https://example.com';
    return `curl -ILsS -o /dev/null -w "%{http_code} -> %{redirect_url}\\n" "${target.startsWith('http') ? target : 'https://' + target}"`;
  };

  return (
    <div className="tool-content">

      <div className="card fadein">
        <div className="card-title">{t('redir.input_title')}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 250 }}>
            <label className="label">{t('redir.url_label')}</label>
            <input
              className="input"
              placeholder={t('redir.url_placeholder')}
              value={url}
              onChange={e => setUrl(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 12 }}
            />
          </div>
          <button className="btn btn-primary" onClick={handleCheck} disabled={loading || !url.trim()}>
            {loading ? t('redir.checking') : t('redir.check_btn')}
          </button>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label className="label">{t('redir.max_redirects')}</label>
            <input type="number" className="input" min={1} max={50} value={followMax}
              onChange={e => setFollowMax(Number(e.target.value))} style={{ width: 80 }} />
          </div>
          <button className={`btn ${showProxy ? 'btn-primary' : 'btn-ghost'} btn-sm`}
            onClick={() => setShowProxy(!showProxy)} style={{ marginTop: 16 }}>
            {t('redir.proxy_settings')}
          </button>
        </div>

        {showProxy && (
          <div style={{ marginBottom: 10 }}>
            <label className="label">{t('redir.proxy_url')}</label>
            <input className="input" value={proxy} onChange={e => setProxy(e.target.value)}
              placeholder="http://localhost:8080/proxy/fetch?url=" style={{ fontFamily: 'var(--mono)', fontSize: 11 }} />
            <div className="hint" style={{ marginTop: 4 }}>{t('redir.proxy_hint')}</div>
          </div>
        )}

        <div style={{ padding: '8px 12px', background: 'var(--panel)', borderRadius: 'var(--radius)', fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--dim)', wordBreak: 'break-all' }}>
          <span style={{ color: 'var(--muted)' }}>curl: </span>{curlCmd()}
          <CopyBtn text={curlCmd()} id="curl-cmd" />
        </div>
      </div>

      {/* Presets */}
      <div className="card fadein">
        <div className="card-title">{t('redir.presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }}
              onClick={() => setUrl(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      <Err msg={error} />

      {/* Results */}
      {chain && (
        <div className="fadein">
          {/* Summary */}
          <div className="card">
            <div className="card-title">{t('redir.summary_title')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {[
                { label: t('redir.total_hops'), value: chain.total - 1, color: 'var(--cyan)' },
                { label: t('redir.final_status'), value: chain.hops[chain.total - 1]?.status, color: STATUS_COLORS[String(chain.hops[chain.total - 1]?.status)[0]] || 'var(--text)' },
              ].map(s => (
                <div key={s.label} style={{ padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                  <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>{s.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: s.color }}>{s.value}</div>
                </div>
              ))}
              <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>{t('redir.final_url')}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--green)', wordBreak: 'break-all' }}>{chain.finalUrl}</div>
              </div>
            </div>
            {chain.isLoop && (
              <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--red)' }}>
                ⚠ {t('redir.loop_warning')}
              </div>
            )}
          </div>

          {/* Hop chain */}
          <div className="card">
            <div className="card-title">{t('redir.chain_title')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {chain.hops.map((hop, i) => {
                const statusClass = String(hop.status)[0];
                const isLast = i === chain.total - 1;
                return (
                  <React.Fragment key={i}>
                    <div style={{
                      display: 'grid', gridTemplateColumns: '40px 1fr auto',
                      gap: 12, padding: '10px 12px', alignItems: 'center',
                      background: isLast ? 'var(--panel)' : 'var(--bg)',
                      borderRadius: isLast ? 'var(--radius)' : i === 0 ? 'var(--radius) var(--radius) 0 0' : '0',
                      border: '1px solid var(--border)',
                      borderBottom: isLast ? '1px solid var(--border)' : 'none',
                    }}>
                      <div style={{
                        width: 28, height: 28, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        background: STATUS_COLORS[statusClass] || 'var(--dim)', color: 'white',
                        fontFamily: 'var(--mono)', fontSize: 11, fontWeight: 700,
                      }}>{i + 1}</div>
                      <div>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', wordBreak: 'break-all' }}>{hop.url}</div>
                        <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>
                          {hop.server && <span>{t('common.server')}: {hop.server}</span>}
                          {hop.contentType && <span> · {t('common.content_type')}: {hop.contentType}</span>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
                          color: STATUS_COLORS[statusClass],
                          padding: '2px 8px', borderRadius: 'var(--radius)',
                          background: STATUS_COLORS[statusClass] + '15',
                        }}>{hop.status}</span>
                        {hop.isRedirect && hop.location && (
                          <span style={{ fontSize: 10, color: 'var(--dim)' }}>→</span>
                        )}
                      </div>
                    </div>
                    {!isLast && hop.location && (
                      <div style={{
                        display: 'flex', justifyContent: 'center', padding: '4px 0',
                        background: 'var(--bg)', borderLeft: '1px solid var(--border)', borderRight: '1px solid var(--border)',
                      }}>
                        <span style={{ fontSize: 10, color: 'var(--yellow)' }}>↓ {hop.status} → {hop.location}</span>
                      </div>
                    )}
                  </React.Fragment>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

window.RedirectChecker = RedirectChecker;
