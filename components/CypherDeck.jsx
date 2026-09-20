const { useState, useEffect, useCallback, useRef, useMemo } = React;

function CypherDeck({ onShare, initialData, onNav }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('cypher:activeTab', initialData?.activeTab ?? 'encode');
  const skipNavReport = useRef(false);
  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
  }, [initialData]);
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  // ── Encode/Decode state ──────────────────────────────
  const [encInput, setEncInput] = usePersistentState('cypher:encInput', initialData?.encInput ?? '');
  const [encFormat, setEncFormat] = usePersistentState('cypher:encFormat', initialData?.encFormat ?? 'text'); // which format the user is typing in
  const [b64UrlSafe, setB64UrlSafe] = usePersistentState('cypher:b64UrlSafe', false);
  const [urlEncodeAll, setUrlEncodeAll] = usePersistentState('cypher:urlEncodeAll', false);

  const ENCODE_PRESETS = [
    { label: t('cypher.encode.presets.hello'), value: 'Hello, World!' },
    { label: t('cypher.encode.presets.url'), value: 'https://example.com/path?query=value&foo=bar' },
    { label: t('cypher.encode.presets.json'), value: '{"user":"admin","role":"superuser","timestamp":1700000000}' },
    { label: t('cypher.encode.presets.credentials'), value: 'admin:P@ssw0rd!2024' },
    { label: t('cypher.encode.presets.url_params'), value: 'name=John Doe&city=New York&email=john@example.com' },
    { label: t('cypher.encode.presets.special_chars'), value: '<script>alert("XSS")</script>' },
  ];

  // ── Hash state ───────────────────────────────────────
  const [hashInput, setHashInput] = usePersistentState('cypher:hashInput', initialData?.hashInput ?? '');
  const [hashMode, setHashMode] = usePersistentState('cypher:hashMode', initialData?.hashMode ?? 'text'); // 'text' | 'hex'
  const [hmacKey, setHmacKey] = usePersistentState('cypher:hmacKey', initialData?.hmacKey ?? '');
  const [showHmac, setShowHmac] = usePersistentState('cypher:showHmac', initialData?.showHmac ?? false);
  const [hashResults, setHashResults] = usePersistentState('cypher:hashResults', null);

  // ── JWT state ────────────────────────────────────────
  const [jwtInput, setJwtInput] = usePersistentState('cypher:jwtInput', '');
  const [jwtParsed, setJwtParsed] = usePersistentState('cypher:jwtParsed', null);
  const [jwtError, setJwtError] = useState('');

  // ── XOR state ────────────────────────────────────────
  const [xorInput, setXorInput] = usePersistentState('cypher:xorInput', initialData?.xorInput ?? '');
  const [xorKey, setXorKey] = usePersistentState('cypher:xorKey', initialData?.xorKey ?? '');
  const [xorInputFmt, setXorInputFmt] = usePersistentState('cypher:xorInputFmt', initialData?.xorInputFmt ?? 'text'); // 'text' | 'hex'
  const [xorKeyFmt, setXorKeyFmt] = usePersistentState('cypher:xorKeyFmt', initialData?.xorKeyFmt ?? 'text');
  const [xorOp, setXorOp] = usePersistentState('cypher:xorOp', initialData?.xorOp ?? 'xor'); // 'xor' | 'and' | 'or' | 'not'
  const [xorRepeat, setXorRepeat] = usePersistentState('cypher:xorRepeat', initialData?.xorRepeat ?? true);
  const [showBrute, setShowBrute] = usePersistentState('cypher:showBrute', initialData?.showBrute ?? false);

  useEffect(() => {
    if (initialData) {
      if (initialData.activeTab !== undefined) setActiveTab(initialData.activeTab);
      if (initialData.encInput !== undefined) setEncInput(initialData.encInput);
      if (initialData.encFormat !== undefined) setEncFormat(initialData.encFormat);
      if (initialData.hashInput !== undefined) setHashInput(initialData.hashInput);
      if (initialData.hashMode !== undefined) setHashMode(initialData.hashMode);
      if (initialData.hmacKey !== undefined) setHmacKey(initialData.hmacKey);
      if (initialData.showHmac !== undefined) setShowHmac(initialData.showHmac);
      if (initialData.xorInput !== undefined) setXorInput(initialData.xorInput);
      if (initialData.xorKey !== undefined) setXorKey(initialData.xorKey);
      if (initialData.xorInputFmt !== undefined) setXorInputFmt(initialData.xorInputFmt);
      if (initialData.xorKeyFmt !== undefined) setXorKeyFmt(initialData.xorKeyFmt);
      if (initialData.xorOp !== undefined) setXorOp(initialData.xorOp);
      if (initialData.xorRepeat !== undefined) setXorRepeat(initialData.xorRepeat);
      if (initialData.showBrute !== undefined) setShowBrute(initialData.showBrute);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (encInput || hashInput || xorInput) {
        (e.detail?.respond ?? onShare)({ tool: 'cypher', activeTab, encInput, encFormat, hashInput, hashMode, hmacKey, showHmac, xorInput, xorKey, xorInputFmt, xorKeyFmt, xorOp, xorRepeat, showBrute });
      }
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [activeTab, encInput, encFormat, hashInput, hashMode, hmacKey, showHmac, xorInput, xorKey, xorInputFmt, xorKeyFmt, xorOp, xorRepeat, showBrute, onShare]);

  // ── Encode/Decode logic ──────────────────────────────
  const getEncodings = useMemo(() => {
    if (!encInput) return null;
    let text = '';
    try {
      if (encFormat === 'text') text = encInput;
      else if (encFormat === 'base64') text = atob(encInput);
      else if (encFormat === 'hex') {
        const clean = encInput.replace(/[^0-9a-fA-F]/g, '');
        if (clean.length % 2) return null;
        text = clean.match(/.{2}/g).map(b => String.fromCharCode(parseInt(b, 16))).join('');
      } else if (encFormat === 'binary') {
        const bits = encInput.replace(/[^01]/g, '');
        if (bits.length % 8) return null;
        text = bits.match(/.{8}/g).map(b => String.fromCharCode(parseInt(b, 2))).join('');
      } else if (encFormat === 'url') {
        text = decodeURIComponent(encInput);
      } else if (encFormat === 'rot13') {
        text = encInput.replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c.charCodeAt(0) & 223) ? c.charCodeAt(0) - 13 : c.charCodeAt(0) + 13));
      } else if (encFormat === 'ascii') {
        const codes = encInput.split(/[\s,]+/).filter(Boolean).map(Number);
        if (codes.some(isNaN)) return null;
        text = String.fromCharCode(...codes);
      }
    } catch { return null; }

    try {
      const b64 = btoa(unescape(encodeURIComponent(text)));
      const urlEncoded = urlEncodeAll 
        ? Array.from(new TextEncoder().encode(text)).map(b => '%' + b.toString(16).padStart(2, '0')).join('') 
        : encodeURIComponent(text);

      return {
        text,
        base64: b64UrlSafe ? b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : b64,
        hex: Array.from(new TextEncoder().encode(text)).map(b => b.toString(16).padStart(2, '0')).join(' '),
        binary: Array.from(new TextEncoder().encode(text)).map(b => b.toString(2).padStart(8, '0')).join(' '),
        url: urlEncoded,
        rot13: text.replace(/[a-zA-Z]/g, c => String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c.charCodeAt(0) & 223) ? c.charCodeAt(0) - 13 : c.charCodeAt(0) + 13)),
        ascii: Array.from(new TextEncoder().encode(text)).join(' '),
        charCount: [...new Intl.Segmenter().segment(text)].length,
        byteCount: new TextEncoder().encode(text).length,
      };
    } catch { return null; }
  }, [encInput, encFormat, b64UrlSafe, urlEncodeAll]);

  // ── Hash logic ───────────────────────────────────────
  useEffect(() => {
    if (!hashInput) { setHashResults(null); return; }
    const input = hashMode === 'hex'
      ? hashInput.replace(/[^0-9a-fA-F]/g, '').match(/.{2}/g)?.map(b => String.fromCharCode(parseInt(b, 16))).join('') || ''
      : hashInput;
    const text = showHmac && hmacKey ? hmacKey + input : input;
    (async () => {
      const [md5h, sha1, sha256, sha512] = await Promise.all([
        md5(text),
        shaHash('SHA-1', text),
        shaHash('SHA-256', text),
        shaHash('SHA-512', text),
      ]);
      setHashResults({ md5: md5h, sha1, sha256, sha512 });
    })();
  }, [hashInput, hashMode, hmacKey, showHmac]);

  // ── JWT logic ────────────────────────────────────────
  useEffect(() => {
    if (!jwtInput.trim()) { setJwtParsed(null); setJwtError(''); return; }
    const parts = jwtInput.trim().split('.');
    if (parts.length !== 3) { setJwtError(t('cypher.jwt.err_invalid')); setJwtParsed(null); return; }
    try {
      const b64url = s => s.replace(/-/g, '+').replace(/_/g, '/');
      const pad = s => s + '='.repeat((4 - s.length % 4) % 4);
      const header = JSON.parse(atob(pad(b64url(parts[0]))));
      const payload = JSON.parse(atob(pad(b64url(parts[1]))));
      setJwtParsed({ header, payload, signature: parts[2], raw: parts });
      setJwtError('');
    } catch (e) { setJwtError(t('cypher.jwt.err_decode', { msg: e.message })); setJwtParsed(null); }
  }, [jwtInput, t]);

  // ── XOR logic ────────────────────────────────────────
  const xorResult = useMemo(() => {
    let msgBytes, keyBytes;
    try {
      if (xorInputFmt === 'hex') {
        const clean = xorInput.replace(/[^0-9a-fA-F]/g, '');
        msgBytes = clean.match(/.{2}/g)?.map(b => parseInt(b, 16)) || [];
      } else {
        msgBytes = Array.from(new TextEncoder().encode(xorInput));
      }
      if (xorKeyFmt === 'hex') {
        const clean = xorKey.replace(/[^0-9a-fA-F]/g, '');
        keyBytes = clean.match(/.{2}/g)?.map(b => parseInt(b, 16)) || [];
      } else {
        keyBytes = Array.from(new TextEncoder().encode(xorKey));
      }
    } catch { return null; }

    if (!msgBytes.length || !keyBytes.length) return null;
    const result = msgBytes.map((b, i) => {
      const k = xorRepeat ? keyBytes[i % keyBytes.length] : (i < keyBytes.length ? keyBytes[i] : 0);
      if (xorOp === 'xor') return b ^ k;
      if (xorOp === 'and') return b & k;
      if (xorOp === 'or')  return b | k;
      if (xorOp === 'not') return (~b) & 0xFF;
      return b ^ k;
    });
    return {
      hex: result.map(b => b.toString(16).padStart(2, '0')).join(' '),
      binary: result.map(b => b.toString(2).padStart(8, '0')).join(' '),
      ascii: result.map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join(''),
      printable: result.filter(b => b >= 32 && b <= 126).length,
      total: result.length,
    };
  }, [xorInput, xorKey, xorInputFmt, xorKeyFmt, xorOp, xorRepeat]);

  const bruteResults = useMemo(() => {
    if (!xorInput) return [];
    let msgBytes;
    try {
      if (xorInputFmt === 'hex') {
        const clean = xorInput.replace(/[^0-9a-fA-F]/g, '');
        msgBytes = clean.match(/.{2}/g)?.map(b => parseInt(b, 16)) || [];
      } else {
        msgBytes = Array.from(new TextEncoder().encode(xorInput));
      }
    } catch { return []; }
    if (!msgBytes.length) return [];
    const results = [];
    for (let key = 0; key < 256; key++) {
      const decoded = msgBytes.map(b => b ^ key);
      const printable = decoded.filter(b => b >= 32 && b <= 126).length;
      if (printable > decoded.length * 0.7) {
        results.push({
          key: key,
          keyHex: key.toString(16).padStart(2, '0'),
          text: decoded.map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join(''),
          score: (printable / decoded.length * 100).toFixed(0),
        });
      }
    }
    return results.slice(0, 32);
  }, [xorInput, xorInputFmt]);

  // Parse query string if we have a decoded text that looks like a URL or params
  const queryParsed = useMemo(() => {
    if (!getEncodings?.text || !getEncodings.text.trim()) return null;
    try {
      const decoded = getEncodings.text;
      const urlMatch = decoded.match(/^([^\?]+)\?(.+)$/);
      const qs = urlMatch ? urlMatch[2] : decoded;
      if (!qs.includes('=') && !qs.includes('&')) return null;
      const params = [];
      qs.split('&').forEach(pair => {
        const [key, ...rest] = pair.split('=');
        if (key) params.push({ key, value: rest.join('='), decodedKey: key, decodedValue: rest.join('=') });
      });
      if (params.length === 0) return null;
      return { baseUrl: urlMatch ? urlMatch[1] : '', params };
    } catch { return null; }
  }, [getEncodings]);

  // ── Helpers ──────────────────────────────────────────

  const JwtTimeClaim = ({ label, value }) => {
    if (value === undefined || value === null) return null;
    const ts = Number(value);
    if (isNaN(ts)) return <span style={{color:'var(--muted)'}}>{label}: {String(value)}</span>;
    const date = new Date(ts < 1e12 ? ts * 1000 : ts);
    const now = Date.now();
    const diff = date.getTime() - now;
    const isPast = diff < 0;
    const absDiff = Math.abs(diff);
    const relStr = absDiff < 60000 ? `${Math.floor(absDiff/1000)}s`
      : absDiff < 3600000 ? `${Math.floor(absDiff/60000)}m`
      : absDiff < 86400000 ? `${Math.floor(absDiff/3600000)}h`
      : `${Math.floor(absDiff/86400000)}d`;
    
    const relText = isPast ? t('cypher.jwt.ago', { t: relStr }) : t('cypher.jwt.in', { t: relStr });

    return (
      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4}}>
        <span style={{color:'var(--cyan)',fontFamily:'var(--mono)',fontSize:12}}>{label}</span>
        <span style={{fontFamily:'var(--mono)',fontSize:12}}>{date.toISOString()}</span>
        <span style={{fontSize:11,color:isPast?'var(--red)':'var(--green)',fontWeight:600}}>
          {relText}
        </span>
      </div>
    );
  };

  const tabs = [
    { id:'encode', label:t('cypher.tabs.encode'), icon:'⟐' },
    { id:'hash',   label:t('cypher.tabs.hash'), icon:'⊞' },
    { id:'jwt',    label:t('cypher.tabs.jwt'), icon:'⑂' },
    { id:'xor',    label:t('cypher.tabs.xor'), icon:'⊕' },
  ];

  return (
    <div className="fadein">
      <div style={{display:'flex', gap:8, marginBottom:20, flexWrap:'wrap'}}>
        {tabs.map(t_tab => (
          <button key={t_tab.id} className={`btn btn-sm ${activeTab===t_tab.id?'btn-primary':'btn-ghost'}`}
            onClick={() => setActiveTab(t_tab.id)} style={{display:'flex',alignItems:'center',gap:6}}>
            <span style={{fontFamily:'var(--mono)',fontSize:12}}>{t_tab.icon}</span> {t_tab.label}
          </button>
        ))}
      </div>

      {/* ═══ Encode / Decode ═══ */}
      {activeTab === 'encode' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('cypher.encode.title')}</div>
            <div style={{marginBottom:12}}>
              <div className="label">{t('cypher.encode.input_label')}</div>
              <div style={{display:'flex',gap:8}}>
                <textarea className="input" rows={3} value={encInput}
                  onChange={e => setEncInput(e.target.value)} placeholder={t('cypher.encode.placeholder')}
                  style={{flex:1,resize:'vertical',fontFamily:'var(--mono)',fontSize:13}} />
              </div>
              <div style={{display:'flex',gap:6,marginTop:8,flexWrap:'wrap',alignItems:'center'}}>
                {['text','base64','hex','binary','url','rot13','ascii'].map(f => (
                  <button key={f} className={`btn ${encFormat===f?'btn-primary':'btn-ghost'} btn-sm`}
                    onClick={() => setEncFormat(f)} style={{textTransform:'capitalize'}}>{t(`cypher.encode.formats.${f}`)}</button>
                ))}
                <span style={{flex:1}} />
                <label style={{display:'flex',alignItems:'center',gap:5,fontSize:11,cursor:'pointer',color:'var(--muted)'}}>
                  <input type="checkbox" checked={b64UrlSafe} onChange={e => setB64UrlSafe(e.target.checked)} />
                  {t('cypher.encode.urlsafe')}
                </label>
                <label style={{display:'flex',alignItems:'center',gap:5,fontSize:11,cursor:'pointer',color:'var(--muted)'}}>
                  <input type="checkbox" checked={urlEncodeAll} onChange={e => setUrlEncodeAll(e.target.checked)} />
                  {t('cypher.encode.encode_all_chars')}
                </label>
              </div>
            </div>

            {/* Presets */}
            <div style={{marginBottom:16}}>
              <div className="label">{t('cypher.encode.presets_title')}</div>
              <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                {ENCODE_PRESETS.map(p => (
                  <button key={p.label} className="btn btn-ghost" style={{fontSize:11,padding:'2px 8px'}}
                    onClick={() => {setEncInput(p.value); setEncFormat('text');}}>{p.label}</button>
                ))}
              </div>
            </div>

            {getEncodings && (
              <>
                <div style={{display:'flex',gap:12,marginBottom:12,fontSize:12,color:'var(--muted)'}}>
                  <span>{getEncodings.charCount} {t('cypher.encode.chars')}</span>
                  <span>{getEncodings.byteCount} {t('cypher.encode.bytes')}</span>
                </div>
                {[
                  [t('cypher.encode.formats.text'), getEncodings.text, 'text'],
                  [t('cypher.encode.formats.base64'), getEncodings.base64, 'base64'],
                  [t('cypher.encode.formats.hex'), getEncodings.hex, 'hex'],
                  [t('cypher.encode.formats.binary'), getEncodings.binary, 'binary'],
                  [t('cypher.encode.formats.url'), getEncodings.url, 'url'],
                  [t('cypher.encode.formats.rot13'), getEncodings.rot13, 'rot13'],
                  [t('cypher.encode.formats.ascii'), getEncodings.ascii, 'ascii'],
                ].map(([label, val, f_key], i) => val ? (
                  <div key={label} style={{marginBottom:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
                      <span style={{fontSize:11,fontWeight:600,color:'var(--cyan)',textTransform:'uppercase',letterSpacing:0.8}}>{label}</span>
                      <CopyBtn text={val} id={`enc-${i}`} />
                    </div>
                    <div style={{
                      background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',
                      padding:'8px 12px',fontFamily:'var(--mono)',fontSize:12,color:'var(--text)',
                      wordBreak:'break-all',maxHeight:100,overflowY:'auto',whiteSpace:'pre-wrap'
                    }}>{val}</div>
                  </div>
                ) : null)}
              </>
            )}
          </div>

          {/* Query parameter breakdown */}
          {queryParsed && queryParsed.params.length > 0 && (
            <div className="card fadein">
              <div className="card-title">{t('cypher.encode.query_breakdown')}</div>
              {queryParsed.baseUrl && (
                <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--muted)' }}>
                  {t('cypher.encode.base_url')}: <code style={{ color: 'var(--cyan)' }}>{queryParsed.baseUrl}</code>
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {queryParsed.params.map((p, i) => (
                  <div key={i} style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr auto',
                    gap: 8, padding: '6px 10px', background: 'var(--bg)', borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)', alignItems: 'center',
                  }}>
                    <div>
                      <span style={{ fontSize: 10, color: 'var(--dim)' }}>{t('cypher.encode.param_key')}</span>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cyan)' }}>{p.key}</div>
                    </div>
                    <div>
                      <span style={{ fontSize: 10, color: 'var(--dim)' }}>{t('cypher.encode.param_value')}</span>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)' }}>{p.value}</div>
                    </div>
                    <CopyBtn text={`${p.key}=${p.value}`} id={`param-${i}`} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ Hash Generator ═══ */}
      {activeTab === 'hash' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('cypher.hash.title')}</div>
            <div style={{marginBottom:12}}>
              <div className="label">{t('cypher.hash.input_label')}</div>
              <div style={{display:'flex',gap:8,alignItems:'flex-start'}}>
                <textarea className="input" rows={3} value={hashInput}
                  onChange={e => setHashInput(e.target.value)} placeholder={t('cypher.hash.placeholder')}
                  style={{flex:1,resize:'vertical',fontFamily:'var(--mono)',fontSize:13}} />
              </div>
              <div style={{display:'flex',gap:6,marginTop:8,alignItems:'center'}}>
                <button className={`btn ${hashMode==='text'?'btn-primary':'btn-ghost'} btn-sm`} onClick={() => setHashMode('text')}>{t('cypher.encode.formats.text')}</button>
                <button className={`btn ${hashMode==='hex'?'btn-primary':'btn-ghost'} btn-sm`} onClick={() => setHashMode('hex')}>{t('cypher.encode.formats.hex')}</button>
                <span style={{flex:1}} />
                <button className={`btn ${showHmac?'btn-primary':'btn-ghost'} btn-sm`} onClick={() => setShowHmac(!showHmac)}>
                  {t('cypher.hash.hmac')}
                </button>
              </div>
              {showHmac && (
                <div style={{marginTop:8}}>
                  <div className="label">{t('cypher.hash.hmac_key')}</div>
                  <input className="input" value={hmacKey} onChange={e => setHmacKey(e.target.value)}
                    placeholder={t('cypher.hash.hmac_placeholder')} style={{fontFamily:'var(--mono)'}} />
                </div>
              )}
            </div>
            {hashResults && [
              ['MD5', hashResults.md5, 32, 'var(--red)'],
              ['SHA-1', hashResults.sha1, 40, 'var(--yellow)'],
              ['SHA-256', hashResults.sha256, 64, 'var(--cyan)'],
              ['SHA-512', hashResults.sha512, 128, 'var(--green)'],
            ].map(([algo, hash, len, color], i) => (
              <div key={algo} style={{marginBottom:10}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
                  <span style={{fontSize:11,fontWeight:700,color,fontFamily:'var(--mono)',letterSpacing:0.5}}>{algo}</span>
                  <CopyBtn text={hash} id={`hash-${i}`} />
                </div>
                <div style={{
                  background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',
                  padding:'8px 12px',fontFamily:'var(--mono)',fontSize:12,color,
                  wordBreak:'break-all'
                }}>{hash}</div>
              </div>
            ))}
            {!hashInput && (
              <div style={{textAlign:'center',padding:24,color:'var(--dim)',fontSize:13}}>
                {t('cypher.hash.empty_hint')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ JWT Decoder ═══ */}
      {activeTab === 'jwt' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('cypher.jwt.title')}</div>
            <div style={{marginBottom:14}}>
              <div className="label">{t('cypher.jwt.token_label')}</div>
              <textarea className="input" rows={4} value={jwtInput}
                onChange={e => setJwtInput(e.target.value)} placeholder={t('cypher.jwt.placeholder')}
                style={{width:'100%',resize:'vertical',fontFamily:'var(--mono)',fontSize:12}} />
            </div>
            {jwtError && <div style={{color:'var(--red)',fontSize:12,marginBottom:12}}>{jwtError}</div>}
            {jwtParsed && (
              <>
                {/* Header */}
                <div style={{marginBottom:14}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <span style={{fontSize:11,fontWeight:700,color:'var(--purple)',textTransform:'uppercase',letterSpacing:1}}>{t('cypher.jwt.header')}</span>
                    <span style={{fontSize:10,color:'var(--dim)'}}>{jwtParsed.raw[0].length} {t('cypher.encode.chars')}</span>
                  </div>
                  <pre style={{
                    background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',
                    padding:12,fontFamily:'var(--mono)',fontSize:12,color:'var(--text)',overflow:'auto',margin:0
                  }}>{JSON.stringify(jwtParsed.header, null, 2)}</pre>
                </div>
                {/* Payload */}
                <div style={{marginBottom:14}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:4}}>
                    <span style={{fontSize:11,fontWeight:700,color:'var(--cyan)',textTransform:'uppercase',letterSpacing:1}}>{t('cypher.jwt.payload')}</span>
                    <CopyBtn text={JSON.stringify(jwtParsed.payload)} id="jwt-payload" label={t('cypher.jwt.copy_json')} />
                  </div>
                  {/* Time claims */}
                  {['iat','exp','nbf','auth_time'].map(claim =>
                    jwtParsed.payload[claim] !== undefined ? (
                      <JwtTimeClaim key={claim} label={claim} value={jwtParsed.payload[claim]} />
                    ) : null
                  )}
                  {jwtParsed.payload.exp && jwtParsed.payload.exp * 1000 < Date.now() && (
                    <div style={{background:'rgba(239,68,68,0.1)',border:'1px solid rgba(239,68,68,0.3)',borderRadius:'var(--radius)',
                      padding:'8px 12px',marginBottom:8,fontSize:12,color:'var(--red)',fontWeight:600}}>
                      {t('cypher.jwt.expired')}
                    </div>
                  )}
                  <pre style={{
                    background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',
                    padding:12,fontFamily:'var(--mono)',fontSize:12,color:'var(--text)',overflow:'auto',margin:0
                  }}>{JSON.stringify(jwtParsed.payload, null, 2)}</pre>
                </div>
                {/* Signature */}
                <div>
                  <span style={{fontSize:11,fontWeight:700,color:'var(--yellow)',textTransform:'uppercase',letterSpacing:1}}>{t('cypher.jwt.signature')}</span>
                  <div style={{
                    background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',
                    padding:'8px 12px',fontFamily:'var(--mono)',fontSize:11,color:'var(--muted)',wordBreak:'break-all',marginTop:4
                  }}>{jwtParsed.signature}</div>
                  <div style={{fontSize:10,color:'var(--dim)',marginTop:4}}>
                    {t('cypher.jwt.algo')} <span style={{color:'var(--text)'}}>{jwtParsed.header.alg || 'none'}</span>
                    {jwtParsed.header.typ && <> · {t('cypher.jwt.type')} <span style={{color:'var(--text)'}}>{jwtParsed.header.typ}</span></>}
                  </div>
                </div>
              </>
            )}
            {!jwtInput.trim() && !jwtError && (
              <div style={{textAlign:'center',padding:24,color:'var(--dim)',fontSize:13}}>
                {t('cypher.jwt.empty_hint')}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══ XOR Cipher ═══ */}
      {activeTab === 'xor' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('cypher.xor.title')}</div>
            <div className="two-col" style={{marginBottom:14}}>
              <div>
                <div className="label">{t('cypher.xor.message')}</div>
                <textarea className="input" rows={3} value={xorInput}
                  onChange={e => setXorInput(e.target.value)} placeholder={t('cypher.xor.msg_placeholder')}
                  style={{width:'100%',resize:'vertical',fontFamily:'var(--mono)',fontSize:13}} />
                <div style={{display:'flex',gap:4,marginTop:4}}>
                  <button className={`btn ${xorInputFmt==='text'?'btn-primary':'btn-ghost'} btn-sm`} onClick={() => setXorInputFmt('text')}>{t('cypher.encode.formats.text')}</button>
                  <button className={`btn ${xorInputFmt==='hex'?'btn-primary':'btn-ghost'} btn-sm`} onClick={() => setXorInputFmt('hex')}>{t('cypher.encode.formats.hex')}</button>
                </div>
              </div>
              <div>
                <div className="label">{t('cypher.xor.key')}</div>
                <textarea className="input" rows={3} value={xorKey}
                  onChange={e => setXorKey(e.target.value)} placeholder={t('cypher.xor.key_placeholder')}
                  style={{width:'100%',resize:'vertical',fontFamily:'var(--mono)',fontSize:13}} />
                <div style={{display:'flex',gap:4,marginTop:4}}>
                  <button className={`btn ${xorKeyFmt==='text'?'btn-primary':'btn-ghost'} btn-sm`} onClick={() => setXorKeyFmt('text')}>{t('cypher.encode.formats.text')}</button>
                  <button className={`btn ${xorKeyFmt==='hex'?'btn-primary':'btn-ghost'} btn-sm`} onClick={() => setXorKeyFmt('hex')}>{t('cypher.encode.formats.hex')}</button>
                </div>
              </div>
            </div>
            <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap',alignItems:'center'}}>
              {['xor','and','or','not'].map(op => (
                <button key={op} className={`btn ${xorOp===op?'btn-primary':'btn-ghost'} btn-sm`}
                  onClick={() => setXorOp(op)} style={{textTransform:'uppercase',fontWeight:700}}>{op}</button>
              ))}
              <span style={{flex:1}} />
              <label style={{display:'flex',alignItems:'center',gap:4,fontSize:12,color:'var(--muted)',cursor:'pointer'}}>
                <input type="checkbox" checked={xorRepeat} onChange={e => setXorRepeat(e.target.checked)} /> {t('cypher.xor.repeat_key')}
              </label>
              <button className={`btn ${showBrute?'btn-primary':'btn-ghost'} btn-sm`}
                onClick={() => setShowBrute(!showBrute)}>{t('cypher.xor.brute_force')}</button>
            </div>
            {xorResult && (
              <>
                {[
                  [t('cypher.encode.formats.hex'), xorResult.hex, 'var(--cyan)'],
                  [t('cypher.encode.formats.binary'), xorResult.binary, 'var(--green)'],
                  ['ASCII', xorResult.ascii, 'var(--text)'],
                ].map(([label, val, color], i) => (
                  <div key={label} style={{marginBottom:10}}>
                    <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:3}}>
                      <span style={{fontSize:11,fontWeight:600,color,textTransform:'uppercase',letterSpacing:0.8}}>{label}</span>
                      <CopyBtn text={val} id={`xor-${i}`} />
                    </div>
                    <div style={{
                      background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',
                      padding:'8px 12px',fontFamily:'var(--mono)',fontSize:12,color,
                      wordBreak:'break-all',maxHeight:100,overflowY:'auto',whiteSpace:'pre-wrap'
                    }}>{val}</div>
                  </div>
                ))}
                <div style={{fontSize:11,color:'var(--muted)'}}>
                  {t('cypher.xor.printable')} {xorResult.printable}/{xorResult.total} bytes ({(xorResult.printable/xorResult.total*100).toFixed(0)}%)
                </div>
              </>
            )}
            {!xorResult && xorInput && xorKey && (
              <div style={{color:'var(--red)',fontSize:12}}>{t('cypher.xor.err_invalid')}</div>
            )}
          </div>
          {/* Brute Force Panel */}
          {showBrute && (
            <div className="card" style={{marginTop:16}}>
              <div className="card-title">{t('cypher.xor.brute_title')}</div>
              <div className="hint" style={{marginBottom:12}}>
                {t('cypher.xor.brute_hint')}
              </div>
              {bruteResults.length > 0 ? (
                <div style={{display:'flex',flexDirection:'column',gap:4}}>
                  {bruteResults.map(r => (
                    <div key={r.key} style={{
                      display:'flex',alignItems:'center',gap:10,padding:'6px 10px',
                      background:'var(--bg)',borderRadius:'var(--radius)',border:'1px solid var(--border)'
                    }}>
                      <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--cyan)',minWidth:36}}>
                        0x{r.keyHex}
                      </span>
                      <span style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--text)',flex:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                        {r.text}
                      </span>
                      <span style={{fontSize:10,color:r.score>=90?'var(--green)':'var(--yellow)',fontWeight:600,minWidth:32,textAlign:'right'}}>
                        {r.score}%
                      </span>
                      <CopyBtn text={r.text} id={`brute-${r.key}`} />
                    </div>
                  ))}
                </div>
              ) : xorInput ? (
                <div style={{color:'var(--muted)',fontSize:12}}>{t('cypher.xor.brute_empty')}</div>
              ) : (
                <div style={{color:'var(--dim)',fontSize:12,textAlign:'center',padding:12}}>{t('cypher.xor.brute_input_hint')}</div>
              )}
            </div>
          )}
        </div>
      )}

    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────
window.CypherDeck = CypherDeck;
