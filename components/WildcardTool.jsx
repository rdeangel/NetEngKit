const { useState, useEffect, useCallback, useRef, useMemo } = React;

function WildcardTool({ onShare, initialData }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('wildcard:input', initialData?.input ?? '255.255.255.0');
  const [result, setResult] = usePersistentState('wildcard:result', null);
  const [err, setErr] = useState('');

  const calc = () => {
    setErr(''); setResult(null);
    const trimmed = input.trim();
    // Could be a mask, CIDR prefix, or IP/CIDR
    let mask = null, prefix = null;
    if (/^\d+$/.test(trimmed)) {
      prefix = parseInt(trimmed);
      if (prefix < 0 || prefix > 32) { setErr(t('wildcard.err_prefix_range')); return; }
      mask = IPv4.mask(prefix);
    } else if (trimmed.startsWith('/')) {
      prefix = parseInt(trimmed.slice(1));
      if (isNaN(prefix) || prefix < 0 || prefix > 32) { setErr(t('wildcard.err_invalid_prefix')); return; }
      mask = IPv4.mask(prefix);
    } else {
      mask = IPv4.parse(trimmed);
      if (mask === null) { setErr(t('wildcard.err_invalid_mask')); return; }
      // Determine prefix from mask
      let m = mask, p = 0;
      while (p < 32 && (m & 0x80000000) !== 0) { m = (m << 1) >>> 0; p++; }
      prefix = p;
    }
    const wildcard = (~mask) >>> 0;
    setResult({
      mask: IPv4.str(mask), wildcard: IPv4.str(wildcard),
      maskHex: IPv4.toHex(mask), wildcardHex: IPv4.toHex(wildcard),
      maskBinary: IPv4.toBinary(mask), wildcardBinary: IPv4.toBinary(wildcard),
      prefix,
    });
  };

  useEffect(() => {
    if (initialData?.input) {
      setInput(initialData.input);
      calc(initialData.input);
    } else {
      calc();
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (input) (e.detail?.respond ?? onShare)({ tool: 'subnet', mode: 'wildcard', input });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [input, onShare]);

  const prefixes = Array.from({ length: 33 }, (_, i) => i);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('common.input')}</div>
        <div className="field">
          <label className="label">{t('wildcard.input_label')}</label>
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && calc()} placeholder={t('wildcard.placeholder')} />
            <button className="btn btn-primary" onClick={calc}>{t('common.calculate')}</button>
          </div>
          <Err msg={err} />
        </div>
        <div className="card-title" style={{marginTop:8}}>{t('wildcard.quick_select')}</div>
        <div style={{display:'flex',flexWrap:'wrap',gap:4}}>
          {[8,16,24,25,26,27,28,29,30,32].map(p => (
            <button key={p} className={`btn btn-ghost btn-sm ${result?.prefix===p?'btn-primary':''}`} onClick={() => { setInput(String(p)); setTimeout(calc,0); }}>/{p}</button>
          ))}
        </div>
      </div>

      {result && (
        <div className="card fadein">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
            <div className="card-title">{t('common.results')} — /{result.prefix}</div>
            <CopyBtn text={[
              `${t('subnet.subnet_mask')}: ${result.mask}`,
              `${t('subnet.wildcard_mask')}: ${result.wildcard}`,
              `${t('supernet.prefix_length')}: /${result.prefix}`,
              `${t('subnet.subnet_mask')} (Hex): ${result.maskHex}`,
              `${t('subnet.wildcard_mask')} (Hex): ${result.wildcardHex}`,
              `${t('subnet.subnet_mask')} (Binary): ${result.maskBinary}`,
              `${t('subnet.wildcard_mask')} (Binary): ${result.wildcardBinary}`,
              `${t('wildcard.host_bits')}: ${32 - result.prefix}`,
            ].join('\n')} label="copy_all" id="wildcard-copy-all" />
          </div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('subnet.subnet_mask')} value={result.mask} accent />
            <ResultItem label={t('subnet.wildcard_mask')} value={result.wildcard} yellow />
            <ResultItem label={t('supernet.prefix_length')} value={`/${result.prefix}`} />
            <ResultItem label={`${t('subnet.subnet_mask')} (Hex)`} value={result.maskHex} />
            <ResultItem label={`${t('subnet.wildcard_mask')} (Hex)`} value={result.wildcardHex} />
            <ResultItem label={t('wildcard.host_bits')} value={32 - result.prefix} />
          </div>
          <div className="card-title" style={{marginTop:16}}>{t('wildcard.binary_representation')}</div>
          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'12px 16px'}}>
            <div className="label" style={{marginBottom:6}}>{t('subnet.subnet_mask')}</div>
            <div style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--text)',letterSpacing:1}}>
              {result.maskBinary.split('.').map((oct, oi) => (
                <span key={oi}>
                  {oct.split('').map((b,bi) => (
                    <span key={bi} style={{color: b==='1'?'var(--cyan)':'var(--dim)'}}>{b}</span>
                  ))}
                  {oi < 3 && <span style={{color:'var(--border)'}}>.</span>}
                </span>
              ))}
            </div>
            <div className="label" style={{marginBottom:6,marginTop:10}}>{t('subnet.wildcard_mask')}</div>
            <div style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--text)',letterSpacing:1}}>
              {result.wildcardBinary.split('.').map((oct, oi) => (
                <span key={oi}>
                  {oct.split('').map((b,bi) => (
                    <span key={bi} style={{color: b==='1'?'var(--yellow)':'var(--dim)'}}>{b}</span>
                  ))}
                  {oi < 3 && <span style={{color:'var(--border)'}}>.</span>}
                </span>
              ))}
            </div>
          </div>
          <div className="card-title" style={{marginTop:16}}>{t('wildcard.all_prefix_ref')}</div>
          <div className="table-wrap hide-mobile" style={{maxHeight:240,overflowY:'auto'}}>
            <table>
              <thead><tr><th>{t('supernet.prefix_length')}</th><th>{t('subnet.subnet_mask')}</th><th>{t('subnet.wildcard_mask')}</th><th>{t('subnet.usable_hosts')}</th></tr></thead>
              <tbody>
                {prefixes.map(p => {
                  const m = IPv4.mask(p);
                  const w = (~m)>>>0;
                  const hosts = p <= 30 ? Math.pow(2,32-p)-2 : p===31 ? 2 : 1;
                  return (
                    <tr key={p} style={result.prefix===p?{background:'rgba(0,212,200,.07)'}:{}}>
                      <td style={{color: result.prefix===p?'var(--cyan)':'inherit'}}>/{p}</td>
                      <td>{IPv4.str(m)}</td>
                      <td style={{color:'var(--yellow)'}}>{IPv4.str(w)}</td>
                      <td style={{color:'var(--green)'}}>{hosts.toLocaleString()}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Mobile View */}
          <div className="show-mobile mobile-cards" style={{maxHeight:300, overflowY:'auto'}}>
            {prefixes.map(p => {
              const m = IPv4.mask(p);
              const w = (~m)>>>0;
              const hosts = p <= 30 ? Math.pow(2,32-p)-2 : p===31 ? 2 : 1;
              return (
                <div key={p} className="mobile-card" style={result.prefix===p?{borderColor:'var(--cyan)', background:'rgba(0,212,200,.05)'}:{}}>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('supernet.prefix_length')}</span>
                    <span className="mobile-card-value" style={{color: result.prefix===p?'var(--cyan)':'inherit', fontWeight:600}}>/{p}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('subnet.subnet_mask')} / {t('subnet.wildcard_mask')}</span>
                    <span className="mobile-card-value">{IPv4.str(m)} / <span style={{color:'var(--yellow)'}}>{IPv4.str(w)}</span></span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('subnet.usable_hosts')}</span>
                    <span className="mobile-card-value" style={{color:'var(--green)'}}>{hosts.toLocaleString()}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool: IP Converter ──────────────────────────────────────
window.WildcardTool = WildcardTool;
