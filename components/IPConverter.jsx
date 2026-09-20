const { useState, useEffect, useCallback, useRef, useMemo } = React;

function IPConverter({ onShare, initialData, onNav }) {
  const { t } = useTranslation();
  const [mode, setMode] = usePersistentState('converter:mode', initialData?.mode ?? 'decimal');
  const [val, setVal] = usePersistentState('converter:val', initialData?.val ?? '192.168.1.100');
  const [result, setResult] = usePersistentState('converter:result', null);
  const skipNavReport = useRef(false);

  const parseIP = (mode, val) => {
    const trimmed = val.trim();
    if (!trimmed) return null;
    if (mode === 'decimal') return IPv4.parse(trimmed);
    if (mode === 'binary') return IPv4.fromBinary(trimmed);
    if (mode === 'hex') return IPv4.fromHex(trimmed);
    if (mode === 'integer') { const n = parseInt(trimmed); return (!isNaN(n) && n >= 0 && n <= 0xffffffff) ? n >>> 0 : null; }
    return null;
  };

  useEffect(() => {
    const ip = parseIP(mode, val);
    if (ip === null) { setResult(null); return; }
    setResult({
      decimal: IPv4.str(ip),
      binary: IPv4.toBinary(ip),
      hex: IPv4.toHex(ip),
      integer: ip.toString(),
      octets: [24,16,8,0].map(s => (ip >>> s) & 0xff),
    });
  }, [val, mode]);

  // apply-down: sidebar/Ctrl+K/Help nav → inner state
  useEffect(() => {
    if (!initialData) return;
    if (initialData.mode !== undefined && initialData.mode !== mode) {
      skipNavReport.current = true;
      setMode(initialData.mode);
    }
    if (initialData.val !== undefined && initialData.val !== val) {
      setVal(initialData.val);
    }
  }, [initialData]);

  // report-up: inner tab change → sidebar highlight
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ mode });
  }, [mode]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (val) (e.detail?.respond ?? onShare)({ tool: 'converter', mode, val });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [mode, val, onShare]);

  const placeholder = { decimal:'192.168.1.100', binary:'11000000.10101000.00000001.01100100', hex:'0xC0A80164', integer:'3232235876' };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('converter.input_format')}</div>
        <div style={{display:'flex',gap:8,marginBottom:14,flexWrap:'wrap'}}>
          {[['decimal', t('subnet.decimal')],['binary', t('subnet.binary')],['hex', t('subnet.hex')],['integer', t('subnet.integer')]].map(([v,l]) => (
            <button key={v} className={`btn ${mode===v?'btn-primary':'btn-ghost'}`} onClick={() => { setMode(v); if (result) setVal(result[v]); }}>{l}</button>
          ))}
        </div>
        <div className="field">
          <label className="label">{t('converter.value')}</label>
          <input className="input" value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder[mode]} />
        </div>
      </div>

      {result && (
        <div className="card fadein">
          <div className="card-title">{t('converter.all_representations')}</div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
            <CopyBtn text={`${t('subnet.decimal')}: ${result.decimal}\n${t('subnet.hex')}: ${result.hex}\n${t('subnet.integer')}: ${result.integer}\n${t('converter.binary')}: ${result.binary}\n\n${t('converter.octet_breakdown')}\n${result.octets.map((o,i) => `${t('converter.octet')} ${i+1}: ${o} / 0x${o.toString(16).toUpperCase().padStart(2,'0')}`).join('\n')}`} label="copy_all" id="ipconv-copy-all" />
          </div>
          <div className="result-grid">
            <ResultItem label={t('subnet.decimal')} value={result.decimal} accent />
            <ResultItem label={t('subnet.hex')} value={result.hex} />
            <ResultItem label={t('subnet.integer')} value={result.integer} />
          </div>
          <div className="card-title" style={{marginTop:16}}>{t('converter.binary')}</div>
          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'14px 16px'}}>
            <div style={{display:'flex',gap:12,flexWrap:'wrap',marginBottom:10}}>
              {result.octets.map((o, i) => (
                <div key={i} style={{textAlign:'center'}}>
                  <div className="bit-grid" style={{gridTemplateColumns:'repeat(8,1fr)',gap:3}}>
                    {o.toString(2).padStart(8,'0').split('').map((b, bi) => (
                      <div key={bi} className={`bit-cell ${b==='1'?'one':'zero'}`}>{b}</div>
                    ))}
                  </div>
                  <div style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--muted)',textAlign:'center',marginTop:4}}>{o}</div>
                </div>
              ))}
            </div>
            <div style={{fontFamily:'var(--mono)',fontSize:12,letterSpacing:1,color:'var(--text)',wordBreak:'break-all'}}>
              {result.binary.split('.').map((oct, oi) => (
                <span key={oi}>
                  {oct.split('').map((b,bi) => (
                    <span key={bi} style={{color: b==='1'?'var(--cyan)':'var(--dim)'}}>{b}</span>
                  ))}
                  {oi < 3 && <span style={{color:'var(--border)'}}>.</span>}
                </span>
              ))}
            </div>
          </div>
          <div className="card-title" style={{marginTop:16}}>{t('converter.octet_breakdown')}</div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:8}}>
            {result.octets.map((o, i) => (
              <div key={i} style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 12px',textAlign:'center'}}>
                <div style={{fontSize:11,color:'var(--dim)',marginBottom:4}}>{t('converter.octet')} {i+1}</div>
                <div style={{fontFamily:'var(--mono)',fontSize:20,fontWeight:600,color:'var(--cyan)'}}>{o}</div>
                <div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>0x{o.toString(16).toUpperCase().padStart(2,'0')}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool: Subnet Visual Map ──────────────────────────────────
window.IPConverter = IPConverter;
