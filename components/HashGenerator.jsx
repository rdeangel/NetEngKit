const { useState, useEffect, useCallback, useRef } = React;

const ALGORITHMS = [
  { id: 'SHA-256', bits: 256, hexLen: 64, status: 'secure', descKey: 'sha256_desc' },
  { id: 'SHA-384', bits: 384, hexLen: 96, status: 'secure', descKey: 'sha384_desc' },
  { id: 'SHA-512', bits: 512, hexLen: 128, status: 'secure', descKey: 'sha512_desc' },
  { id: 'SHA-1',   bits: 160, hexLen: 40,  status: 'deprecated', descKey: 'sha1_desc' },
];

function bufferToHex(buf) {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// Lazy-load fallback libraries for insecure (non-HTTPS) contexts
let _fallbackPromise = null;
async function ensureFallback() {
  if (window._hashFallback) return window._hashFallback;
  if (_fallbackPromise) return _fallbackPromise;
  _fallbackPromise = (async () => {
    const loadScript = (src) => new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
    await Promise.all([
      loadScript('https://cdn.jsdelivr.net/npm/js-sha256@0.11.0/build/sha256.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/js-sha512@0.9.0/build/sha512.min.js'),
      loadScript('https://cdn.jsdelivr.net/npm/js-sha1@0.7.0/build/sha1.min.js'),
    ]);
    window._hashFallback = true;
    return true;
  })();
  return _fallbackPromise;
}

async function computeHash(algo, data) {
  // crypto.subtle is only available in secure contexts (HTTPS or localhost)
  if (window.crypto && window.crypto.subtle) {
    const buf = await crypto.subtle.digest(algo, data);
    return bufferToHex(buf);
  }
  // Fallback: load proven JS libraries from CDN
  await ensureFallback();
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  switch (algo) {
    case 'SHA-1':   return window.sha1(bytes);
    case 'SHA-256': return window.sha256(bytes);
    case 'SHA-384': return window.sha384(bytes);
    case 'SHA-512': return window.sha512(bytes);
    default: throw new Error('Unsupported: ' + algo);
  }
}

function HashGenerator({ onShare, initialData }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('hash:activeTab', 'text');
  const [text, setText] = usePersistentState('hash:text', initialData?.text ?? '');
  const [selectedAlgo, setSelectedAlgo] = usePersistentState('hash:selectedAlgo', 'SHA-256');
  const [fileName, setFileName] = useState('');
  const [fileData, setFileData] = useState(null);
  const [hashes, setHashes] = usePersistentState('hash:hashes', null);
  const [loading, setLoading] = useState(false);
  const [verifyHash, setVerifyHash] = usePersistentState('hash:verifyHash', '');
  const [verifyResult, setVerifyResult] = usePersistentState('hash:verifyResult', null);
  const fileRef = useRef(null);

  useEffect(() => {
    if (initialData?.text) setText(initialData.text);
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (text) (e.detail?.respond ?? onShare)({ tool: 'hashgen', mode: 'text', text });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [text, onShare]);

  const handleGenerate = useCallback(async () => {
    let data;
    if (activeTab === 'text') {
      if (!text.trim()) return;
      data = new TextEncoder().encode(text);
    } else {
      if (!fileData) return;
      data = fileData;
    }
    setLoading(true);
    setHashes(null);
    setVerifyResult(null);
    try {
      const results = {};
      for (const a of ALGORITHMS) {
        results[a.id] = await computeHash(a.id, data);
      }
      setHashes(results);
    } finally {
      setLoading(false);
    }
  }, [activeTab, text, fileData]);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setHashes(null);
    setVerifyResult(null);
    const buf = await file.arrayBuffer();
    setFileData(new Uint8Array(buf));
  };

  const handleVerify = async () => {
    if (!verifyHash.trim()) return;
    let data;
    if (activeTab === 'text') {
      if (!text.trim()) return;
      data = new TextEncoder().encode(text);
    } else {
      if (!fileData) return;
      data = fileData;
    }
    const expected = verifyHash.trim().toLowerCase();
    const actual = await computeHash(selectedAlgo, data);
    setVerifyResult(actual === expected ? 'match' : 'mismatch');
  };

  const tabs = [
    { id: 'text', label: t('hashgen.mode_text') },
    { id: 'file', label: t('hashgen.mode_file') },
  ];

  const canGenerate = activeTab === 'text' ? !!text.trim() : !!fileData;

  return (
    <div className="tool-content">

      {/* Tab bar */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 0, borderBottom: '1px solid var(--border)' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); setHashes(null); setVerifyResult(null); }} style={{
            background: activeTab === tab.id ? 'var(--card)' : 'transparent',
            border: '1px solid var(--border)',
            borderBottom: activeTab === tab.id ? '1px solid var(--card)' : '1px solid var(--border)',
            borderRadius: 'var(--radius) var(--radius) 0 0',
            color: activeTab === tab.id ? 'var(--fg)' : 'var(--dim)',
            cursor: 'pointer',
            fontSize: 13,
            fontFamily: 'inherit',
            padding: '7px 16px',
            marginBottom: -1,
          }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Text tab */}
      {activeTab === 'text' && (
        <div className="card fadein">
          <div className="card-title">{t('hashgen.input_text_title')}</div>
          <textarea
            className="input"
            rows={6}
            placeholder={t('hashgen.text_placeholder')}
            value={text}
            onChange={e => { setText(e.target.value); setHashes(null); setVerifyResult(null); }}
            style={{ fontFamily: 'monospace', resize: 'vertical', width: '100%' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={!canGenerate || loading}
            >
              {loading ? t('hashgen.computing') : t('hashgen.generate_btn')}
            </button>
          </div>

          {/* Verify — always present */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div className="card-title" style={{ marginBottom: 10 }}>{t('hashgen.verify_section')}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="label">{t('hashgen.verify_algo')}</label>
                <select className="input" value={selectedAlgo} onChange={e => { setSelectedAlgo(e.target.value); setVerifyResult(null); }} style={{ width: 120 }}>
                  {ALGORITHMS.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
                <label className="label">{t('hashgen.verify_label')}</label>
                <input
                  className="input"
                  placeholder={t('hashgen.verify_placeholder')}
                  value={verifyHash}
                  onChange={e => { setVerifyHash(e.target.value); setVerifyResult(null); }}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>
              <button className="btn btn-primary" onClick={handleVerify}>{t('hashgen.verify_btn')}</button>
            </div>
            {verifyResult && (
              <div style={{
                marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                borderRadius: 'var(--radius)', border: '1px solid',
                borderColor: verifyResult === 'match' ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
                color: verifyResult === 'match' ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
              }}>
                {verifyResult === 'match'
                  ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                }
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {t(verifyResult === 'match' ? 'hashgen.verify_match' : 'hashgen.verify_mismatch')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* File tab */}
      {activeTab === 'file' && (
        <div className="card fadein">
          <div className="card-title">{t('hashgen.input_file_title')}</div>
          <div
            className="result-box"
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, minHeight: 110, cursor: 'pointer', border: '2px dashed var(--border)' }}
            onClick={() => fileRef.current?.click()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            <span style={{ fontSize: 13, opacity: fileName ? 1 : 0.5 }}>
              {fileName || t('hashgen.file_placeholder')}
            </span>
            <input ref={fileRef} type="file" style={{ display: 'none' }} onChange={handleFile} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <button
              className="btn btn-primary"
              onClick={handleGenerate}
              disabled={!canGenerate || loading}
            >
              {loading ? t('hashgen.computing') : t('hashgen.generate_btn')}
            </button>
          </div>

          {/* Verify — always present */}
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div className="card-title" style={{ marginBottom: 10 }}>{t('hashgen.verify_section')}</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="label">{t('hashgen.verify_algo')}</label>
                <select className="input" value={selectedAlgo} onChange={e => { setSelectedAlgo(e.target.value); setVerifyResult(null); }} style={{ width: 120 }}>
                  {ALGORITHMS.map(a => <option key={a.id} value={a.id}>{a.id}</option>)}
                </select>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
                <label className="label">{t('hashgen.verify_label')}</label>
                <input
                  className="input"
                  placeholder={t('hashgen.verify_placeholder')}
                  value={verifyHash}
                  onChange={e => { setVerifyHash(e.target.value); setVerifyResult(null); }}
                  style={{ fontFamily: 'monospace', fontSize: 12 }}
                />
              </div>
              <button className="btn btn-primary" onClick={handleVerify}>{t('hashgen.verify_btn')}</button>
            </div>
            {verifyResult && (
              <div style={{
                marginTop: 10, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
                borderRadius: 'var(--radius)', border: '1px solid',
                borderColor: verifyResult === 'match' ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
                color: verifyResult === 'match' ? 'var(--success, #22c55e)' : 'var(--error, #ef4444)',
              }}>
                {verifyResult === 'match'
                  ? <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                  : <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                }
                <span style={{ fontWeight: 600, fontSize: 13 }}>
                  {t(verifyResult === 'match' ? 'hashgen.verify_match' : 'hashgen.verify_mismatch')}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Results */}
      {hashes && (
        <div className="card fadein">
          <div className="card-title">{t('hashgen.results_section')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {ALGORITHMS.map(algo => (
              <div key={algo.id} style={{
                display: 'grid',
                gridTemplateColumns: '110px 1fr auto',
                alignItems: 'center',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
              }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>{algo.id}</span>
                  <span className={`badge ${algo.status === 'deprecated' ? 'badge-red' : 'badge-green'}`} style={{ fontSize: 10, width: 'fit-content' }}>
                    {t(`hashgen.${algo.status}`)}
                  </span>
                </div>
                <code style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all', lineHeight: 1.6, color: 'var(--dim)' }}>
                  {hashes[algo.id]}
                </code>
                <CopyBtn text={hashes[algo.id]} label="copy" />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Algorithm reference */}
      <div className="card">
        <div className="card-title">{t('hashgen.ref_section')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
          {ALGORITHMS.map(algo => (
            <div key={algo.id} style={{ padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <span style={{ fontWeight: 700, fontSize: 13 }}>{algo.id}</span>
                <span className={`badge ${algo.status === 'deprecated' ? 'badge-red' : 'badge-green'}`} style={{ fontSize: 10 }}>
                  {t(`hashgen.${algo.status}`)}
                </span>
              </div>
              <p style={{ fontSize: 12, opacity: 0.65, margin: '0 0 6px', lineHeight: 1.5 }}>
                {t(`hashgen.${algo.descKey}`)}
              </p>
              <code style={{ fontSize: 11, opacity: 0.45 }}>
                {algo.bits} {t('hashgen.bits')} / {algo.hexLen} {t('hashgen.hex_chars')}
              </code>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}
