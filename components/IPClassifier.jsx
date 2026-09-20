const { useState, useEffect, useCallback, useRef, useMemo } = React;

function IPClassifier({ onShare, initialData }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('classify:input', initialData?.input ?? '');
  const [results, setResults] = usePersistentState('classify:results', []);
  const [err, setErr] = useState('');
  const fileInputRef = useRef(null);

  const presets = ['10.0.0.1','172.16.5.1','192.168.1.1','127.0.0.1','169.254.1.1','8.8.8.8','224.0.0.1','255.255.255.255','100.64.0.1','198.51.100.1'];

  useEffect(() => {
    if (initialData) {
      if (initialData.input !== undefined) setInput(initialData.input);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (input) (e.detail?.respond ?? onShare)({ tool: 'classify', input });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [input, onShare]);

  const handleImportCSV = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target.result;
      if (!text) return;

      const lines = text.split(/\r?\n/);
      if (lines.length === 0) return;

      // Try to determine column separator (comma or semicolon)
      const firstLine = lines[0];
      const hasSemi = firstLine.includes(';');
      const separator = hasSemi ? ';' : ',';

      // Parse headers to locate "ip", "addr", or "address" column
      const headers = firstLine.split(separator).map(h => h.trim().replace(/^["']|["']$/g, '').toLowerCase());
      let ipColIndex = headers.findIndex(h => h.includes('ip') || h.includes('addr') || h.includes('address'));

      // If headers are not found, default to first column (index 0)
      const targetColIndex = ipColIndex !== -1 ? ipColIndex : 0;
      let startRow = ipColIndex !== -1 ? 1 : 0;

      // If we defaulted to column 0, verify if first row is a header name or actual IP
      if (ipColIndex === -1 && lines.length > 0) {
        const firstVal = lines[0].split(separator)[0]?.trim().replace(/^["']|["']$/g, '');
        const isFirstValIP = IPv4.parse(firstVal) !== null || IPv6.classify(firstVal) !== null;
        if (!isFirstValIP) {
          startRow = 1;
        }
      }

      const newResults = [];
      for (let i = startRow; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const cells = line.split(separator).map(c => c.trim().replace(/^["']|["']$/g, ''));
        const val = cells[targetColIndex];
        if (!val) continue;

        const parsed = IPv4.parse(val);
        if (parsed === null) {
          const v6 = IPv6.classify(val);
          if (v6) {
            newResults.push({ ip: val, version: 6, ...v6 });
          }
        } else {
          const cls = IPv4.classify(parsed);
          newResults.push({ ip: val, version: 4, ...cls });
        }
      }

      if (newResults.length > 0) {
        setResults(r => [...r, ...newResults]);
        setErr('');
      } else {
        setErr(t('classify.err_no_ips_found'));
      }
      e.target.value = '';
    };

    reader.readAsText(file);
  };

  const add = (ip) => {
    const val = ip || input.trim();
    if (!val) return;
    const parsed = IPv4.parse(val);
    if (parsed === null) {
      const v6 = IPv6.classify(val);
      if (!v6) { setErr(t('classify.err_invalid')); return; }
      setResults(r => [...r, { ip: val, version: 6, ...v6 }]);
      setInput(''); setErr('');
      return;
    }
    const cls = IPv4.classify(parsed);
    setResults(r => [...r, { ip: val, version: 4, ...cls }]);
    setInput(''); setErr('');
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('classify.title')}</div>
        <div className="field">
          <label className="label">{t('classify.label')}</label>
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && add()} placeholder={t('classify.placeholder')} />
            <button className="btn btn-primary" onClick={() => add()}>{t('classify.title').split(' ')[0]}</button>
          </div>
          <Err msg={err} />
        </div>
        <div style={{marginTop:10, display:'flex', justifyContent:'space-between', alignItems:'flex-end', flexWrap:'wrap', gap:10}}>
          <div>
            <div className="label" style={{marginBottom:6}}>{t('classify.quick_presets')}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
              {presets.map(p => <button key={p} className="btn btn-ghost btn-sm" onClick={() => add(p)}>{p}</button>)}
            </div>
          </div>
          <div style={{display:'flex', gap:6}}>
            <button className="btn btn-ghost btn-sm" onClick={() => fileInputRef.current?.click()} style={{display:'flex', alignItems:'center', gap:4}}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{display:'block'}}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              {t('classify.import_csv')}
            </button>
            <input type="file" ref={fileInputRef} accept=".csv,.txt" style={{display:'none'}} onChange={handleImportCSV} />
          </div>
        </div>
      </div>

      {results.length > 0 && (
        <div className="card fadein">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div className="card-title" style={{marginBottom:0}}>{t('common.results')} ({results.length})</div>
            <button className="btn btn-ghost btn-sm" onClick={() => setResults([])}>{t('classify.clear_all')}</button>
          </div>
          <div className="table-wrap hide-mobile">
            <table>
              <thead><tr><th>{t('classify.addr')}</th><th>{t('classify.ver')}</th><th>{t('classify.class')}</th><th>{t('classify.type')}</th><th>{t('classify.scope')}</th><th>{t('classify.rfc')}</th><th></th></tr></thead>
              <tbody>
                {results.map((r, i) => (
                  <tr key={i}>
                    <td style={{color:'var(--cyan)'}}>{r.ip}</td>
                    <td><span className={`badge ${r.version===4?'badge-blue':'badge-purple'}`}>IPv{r.version}</span></td>
                    <td>{r.ipClass || r.version}</td>
                    <td>{r.type}</td>
                    <td>{scopeBadge(r.scope)}</td>
                    <td style={{color:'var(--muted)'}}><RFCLink rfc={r.rfc} /></td>
                    <td><button className="btn btn-ghost btn-sm" style={{padding:'2px 6px',fontSize:11,color:'var(--red)'}} onClick={() => setResults(rs => rs.filter((_,j) => j !== i))}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* Mobile View */}
          <div className="show-mobile mobile-cards">
            {results.map((r, i) => (
              <div key={i} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label" style={{color:'var(--cyan)', fontWeight:600}}>{r.ip}</span>
                  <span className={`badge ${r.version===4?'badge-blue':'badge-purple'}`}>IPv{r.version}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('classify.type')} / {t('classify.class')}</span>
                  <span className="mobile-card-value">{r.type} {r.ipClass ? `(${t('classify.class')} ${r.ipClass})` : ''}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('classify.scope')} / {t('classify.rfc')}</span>
                  <span className="mobile-card-value">{scopeBadge(r.scope)} (<RFCLink rfc={r.rfc} />)</span>
                </div>
                <div style={{marginTop:8, display:'flex', justifyContent:'flex-end'}}>
                  <button className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={() => setResults(rs => rs.filter((_,j) => j !== i))}>{t('classify.remove')}</button>
                </div>
              </div>
            ))}
          </div>
          <div className="btn-row">
            <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(results.map(r => ({ip:r.ip,version:r.version,class:r.ipClass||'-',type:r.type,scope:r.scope,rfc:r.rfc||'-'})),'ip-classification.csv')}>{t('common.export_csv')}</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool: VLSM Planner ──────────────────────────────────────
window.IPClassifier = IPClassifier;
