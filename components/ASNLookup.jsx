const { useState, useEffect, useCallback, useRef, useMemo } = React;

function ASNLookup({ onShare, initialData }) {
  const { t } = useTranslation();
  const [queries, setQueries] = usePersistentState('asn:queries', initialData?.queries ?? { ip: '', asn: '' });
  const [mode, setMode] = usePersistentState('asn:mode', initialData?.mode ?? 'ip');
  const query = queries[mode];
  const setQuery = (v) => setQueries(q => ({ ...q, [mode]: v }));
  const [result, setResult] = usePersistentState('asn:result', null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (initialData) {
      if (initialData.queries !== undefined) setQueries(initialData.queries);
      if (initialData.mode !== undefined) setMode(initialData.mode);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (queries?.ip || queries?.asn) (e.detail?.respond ?? onShare)({ tool: 'asn', mode, queries });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [mode, queries, onShare]);

  const lookup = async (overrideQuery, overrideMode) => {
    const m = typeof overrideMode === 'string' ? overrideMode : mode;
    const q = (typeof overrideQuery === 'string' ? overrideQuery : query).trim();
    if (!q && m === 'asn') { setErr(t('asn.err_asn')); return; }
    setErr(''); setResult(null); setLoading(true);
    try {
      if (m === 'ip') {
        const ip = q ? encodeURIComponent(q) : '';
        const target = `https://ipwhois.app/json/${ip}`;
        const base = window.LOCAL_PROXY
          ? `${window.LOCAL_PROXY}${encodeURIComponent(target)}`
          : target;
        const res = await fetch(base, {signal: AbortSignal.timeout(8000)});
        const d = await res.json();
        if (!d.success && d.message) { setErr(d.message); setLoading(false); return; }
        setResult({ mode: m, data: {
          ip: d.ip || q || '—',
          asn: d.asn || '—',
          org: d.org || '—',
          isp: d.isp || '—',
          country: d.country || '—',
          country_code: d.country_code || '',
          region: d.region || '—',
          city: d.city || '—',
          postal: d.postal || '—',
          lat: d.latitude,
          lon: d.longitude,
          timezone: d.timezone || '—',
          timezone_gmt: d.timezone_gmt || '',
          continent: d.continent || '—',
          type: d.type || '—',
          hostname: d.hostname || '',
          currency: d.currency ? `${d.currency} (${d.currency_code})` : '',
          country_flag: d.country_flag || '',
        }});
      } else {
        // RIPE Stat ASN lookup
        const res = await fetch(`https://stat.ripe.net/data/as-overview/data.json?resource=AS${q.replace(/^as/i,'')}`, {signal: AbortSignal.timeout(8000)});
        const d = await res.json();
        if (d.status === 'ok' && d.data) {
          // Fetch prefixes in parallel
          const asnNum = d.data.resource;
          const [v4Res, v6Res] = await Promise.all([
            fetch(`https://stat.ripe.net/data/ris-prefixes/data.json?resource=AS${asnNum}&list_prefixes=true`, {signal: AbortSignal.timeout(8000)}).then(r=>r.json()).catch(()=>null),
            null // v6 included in same response
          ]);
          const v4Prefixes = v4Res?.data?.prefixes?.v4?.originating || [];
          const v6Prefixes = v4Res?.data?.prefixes?.v6?.originating || [];
          setResult({ mode, data: {
            asn: asnNum,
            name: d.data.holder,
            description_short: d.data.block?.desc || '',
            country_code: '',
            announced: d.data.announced,
            block: d.data.block,
            prefixes_v4: v4Prefixes.slice(0, 500).map(p => ({ prefix: p })),
            prefixes_v6: v6Prefixes.slice(0, 500).map(p => ({ prefix: p })),
            rir_allocation: { rir_name: d.data.block?.name || '' },
            website: '',
          }});
        } else setErr(t('asn.err_no_data'));
      }
    } catch (e) { setErr(t('asn.err_failed', {msg: e.message || e})); }
    setLoading(false);
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('asn.title')} <span className="badge badge-blue" style={{marginLeft:8,fontSize:10}}>{t('asn.via_ripe')}</span></div>
        <div style={{display:'flex',gap:8,marginBottom:12}}>
          {[['ip',t('asn.ip_address')],['asn',t('asn.as_number')]].map(([v,l]) => (
            <button key={v} className={`btn ${mode===v?'btn-primary':'btn-ghost'}`} onClick={() => {
              if (v === 'asn' && result?.mode === 'ip' && result?.data?.asn) {
                setQueries(q => ({ ...q, asn: result.data.asn.replace(/^AS/i, '') }));
              }
              setMode(v); setResult(null); setErr('');
            }}>{l}</button>
          ))}
        </div>
        {mode === 'ip' && !window.LOCAL_PROXY && (
          <div className="alert alert-warn" style={{marginBottom:12}}>
            {t('asn.alert_proxy', {url: <a href="https://ipwhois.app" target="_blank" rel="noopener noreferrer">ipwhois.app</a>})}
          </div>
        )}
        <div className="field">
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={query} onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key==='Enter' && lookup()} placeholder={mode==='ip'?t('asn.placeholder_ip'):t('asn.placeholder_asn')} />
            <button className="btn btn-primary" onClick={() => lookup()} disabled={loading}>{loading?'...':t('asn.lookup')}</button>
          </div>
          <Err msg={err} />
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {mode === 'ip'
            ? <>
                {['8.8.8.8','1.1.1.1','208.67.222.222','9.9.9.9'].map(p => <button key={p} className="btn btn-ghost btn-sm" onClick={() => { setQuery(p); lookup(p, 'ip'); }}>{p}</button>)}
                <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); lookup('', 'ip'); }}>{t('asn.my_ip')}</button>
              </>
            : ['15169','13335','3356','7922','20940'].map(a => <button key={a} className="btn btn-ghost btn-sm" onClick={() => { setQuery(a); lookup(a, 'asn'); }}>AS{a}</button>)
          }
        </div>
      </div>

      {result && result.mode === 'ip' && result.data && (
        <div className="card fadein">
          <div className="card-title" style={{display:'flex',alignItems:'center'}}>
            {t('asn.ip_info')} <span className="badge badge-blue" style={{marginLeft:8,fontSize:10}}>{t('asn.via_ipwhois')}</span>
            <CopyBtn text={[
              `IP: ${result.data.ip}`, `Type: ${result.data.type}`, `ASN: ${result.data.asn}`, `ISP: ${result.data.isp}`,
              `Organization: ${result.data.org}`,
              ...(result.data.hostname ? [`Hostname: ${result.data.hostname}`] : []),
              `Country: ${result.data.country_code ? `${result.data.country} (${result.data.country_code})` : result.data.country}`,
              `Region: ${result.data.region}`, `City: ${result.data.city}`, `Postal: ${result.data.postal}`,
              ...(result.data.lat != null ? [`Coordinates: ${result.data.lat}, ${result.data.lon}`] : []),
              `Timezone: ${result.data.timezone} (UTC${result.data.timezone_gmt})`,
              `Continent: ${result.data.continent}`,
              ...(result.data.currency ? [`Currency: ${result.data.currency}`] : []),
            ].join('\n')} label="copy_all" id="asn-ip-copy-all" />
          </div>
          <div className="result-grid grid-mobile-1" style={{marginBottom:12}}>
            <ResultItem label={t('common.ip', 'IP')} value={result.data.ip} accent />
            <ResultItem label={t('converter.type')} value={result.data.type} />
            <ResultItem label={t('common.asn', 'ASN')} value={result.data.asn} />
            <ResultItem label={t('asn.isp')} value={result.data.isp} />
            <ResultItem label={t('asn.org')} value={result.data.org} />
            {result.data.hostname && <ResultItem label={t('asn.hostname')} value={result.data.hostname} />}
          </div>
          <div className="card-title" style={{marginTop:4}}>{t('asn.geolocation')}</div>
          <div className="result-grid grid-mobile-1" style={{marginBottom:12}}>
            <ResultItem label={t('cheatsheet.country')} value={result.data.country_code ? `${result.data.country} (${result.data.country_code})` : result.data.country} />
            <ResultItem label={t('asn.region')} value={result.data.region} />
            <ResultItem label={t('asn.city')} value={result.data.city} />
            <ResultItem label={t('asn.postal')} value={result.data.postal} />
            {result.data.lat != null && <ResultItem label={t('asn.coordinates')} value={`${result.data.lat}, ${result.data.lon}`} />}
            <ResultItem label={t('asn.timezone')} value={`${result.data.timezone} (UTC${result.data.timezone_gmt})`} />
            <ResultItem label={t('asn.continent')} value={result.data.continent} />
            {result.data.currency && <ResultItem label={t('asn.currency')} value={result.data.currency} />}
          </div>        </div>
      )}

      {result && result.mode === 'asn' && (
        <div className="card fadein">
          <div className="card-title" style={{display:'flex',alignItems:'center'}}>
            AS{result.data.asn} — {result.data.name}
            <CopyBtn text={[
              `ASN: AS${result.data.asn}`, `Name: ${result.data.name}`,
              `Description: ${result.data.description_short || result.data.description_full?.[0] || '-'}`,
              `Country: ${result.data.country_code || '-'}`, `Website: ${result.data.website || '-'}`,
              `RIR: ${result.data.rir_allocation?.rir_name || '-'}`,
              ...(result.data.prefixes_v4?.length ? [`\nIPv4 Prefixes:`, ...result.data.prefixes_v4.map(p => p.prefix)] : []),
              ...(result.data.prefixes_v6?.length ? [`\nIPv6 Prefixes:`, ...result.data.prefixes_v6.map(p => p.prefix)] : []),
            ].join('\n')} label="copy_all" id="asn-asn-copy-all" />
          </div>
          <div className="result-grid grid-mobile-1" style={{marginBottom:16}}>
            <ResultItem label={t('common.asn', 'ASN')} value={`AS${result.data.asn}`} accent />
            <ResultItem label={t('cheatsheet.name')} value={result.data.name} />
            <ResultItem label={t('mcast_ref.description')} value={result.data.description_short || result.data.description_full?.[0] || '-'} />
            <ResultItem label={t('cheatsheet.country')} value={result.data.country_code || '-'} />
            <ResultItem label={t('asn.website')} value={result.data.website || '-'} />
            <ResultItem label={t('asn.rir')} value={result.data.rir_allocation?.rir_name || '-'} />
          </div>
          {result.data.prefixes_v4?.length > 0 && (
            <>
              <div className="card-title">{t('asn.prefixes_v4', {count: result.data.prefixes_v4.length})}</div>
              <div className="table-wrap hide-mobile" style={{maxHeight:200,overflowY:'auto'}}>
                <table><thead><tr><th>{t('common.th_prefix')}</th></tr></thead>
                <tbody>{result.data.prefixes_v4.slice(0,50).map((p,i) => (
                  <tr key={i}><td style={{color:'var(--cyan)'}}>{p.prefix}</td></tr>
                ))}</tbody></table>
              </div>
              {/* Mobile View */}
              <div className="show-mobile mobile-cards" style={{maxHeight:200, overflowY:'auto'}}>
                {result.data.prefixes_v4.slice(0,50).map((p,i) => (
                  <div key={i} className="mobile-card" style={{padding:'6px 12px'}}>
                    <span style={{color:'var(--cyan)', fontFamily:'var(--mono)', fontSize:12}}>{p.prefix}</span>
                  </div>
                ))}
              </div>
            </>
          )}
          {result.data.prefixes_v6?.length > 0 && (
            <>
              <div className="card-title" style={{marginTop:12}}>{t('asn.prefixes_v6', {count: result.data.prefixes_v6.length})}</div>
              <div className="table-wrap hide-mobile" style={{maxHeight:200,overflowY:'auto'}}>
                <table><thead><tr><th>{t('common.th_prefix')}</th></tr></thead>
                <tbody>{result.data.prefixes_v6.slice(0,50).map((p,i) => (
                  <tr key={i}><td style={{color:'var(--purple)'}}>{p.prefix}</td></tr>
                ))}</tbody></table>
              </div>
              {/* Mobile View */}
              <div className="show-mobile mobile-cards" style={{maxHeight:200, overflowY:'auto'}}>
                {result.data.prefixes_v6.slice(0,50).map((p,i) => (
                  <div key={i} className="mobile-card" style={{padding:'6px 12px'}}>
                    <span style={{color:'var(--purple)', fontFamily:'var(--mono)', fontSize:12}}>{p.prefix}</span>
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

// ─── Tool: Network Scanner ─────────────────────────────────────
window.ASNLookup = ASNLookup;
