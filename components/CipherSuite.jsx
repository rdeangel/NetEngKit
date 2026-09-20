const { useState } = React;

// TLS 1.2 cipher suite database
const SUITES = [
  // ── Insecure / Deprecated ──────────────────────────────────────────────
  { name: 'TLS_NULL_WITH_NULL_NULL',                         iana: '0x0000', score: 0,  tls: ['1.0','1.1','1.2'], kex:'NULL',       auth:'NULL', enc:'NULL',      bits:0,   mac:'NULL',      notes:'No encryption, no auth. Never use.' },
  { name: 'TLS_RSA_WITH_NULL_MD5',                           iana: '0x0001', score: 0,  tls: ['1.0','1.1','1.2'], kex:'RSA',        auth:'RSA',  enc:'NULL',      bits:0,   mac:'MD5',       notes:'No encryption.' },
  { name: 'TLS_RSA_WITH_NULL_SHA',                           iana: '0x0002', score: 0,  tls: ['1.0','1.1','1.2'], kex:'RSA',        auth:'RSA',  enc:'NULL',      bits:0,   mac:'SHA-1',     notes:'No encryption.' },
  { name: 'TLS_RSA_EXPORT_WITH_RC4_40_MD5',                  iana: '0x0003', score: 0,  tls: ['1.0','1.1'],       kex:'RSA_EXPORT', auth:'RSA',  enc:'RC4',       bits:40,  mac:'MD5',       notes:'Export-grade. Broken (FREAK). Never use.' },
  { name: 'TLS_RSA_WITH_RC4_128_MD5',                        iana: '0x0004', score: 10, tls: ['1.0','1.1','1.2'], kex:'RSA',        auth:'RSA',  enc:'RC4',       bits:128, mac:'MD5',       notes:<span>RC4 is broken (<RFCLink rfc="RFC 7465" />). MD5 is weak. No PFS.</span> },
  { name: 'TLS_RSA_WITH_RC4_128_SHA',                        iana: '0x0005', score: 10, tls: ['1.0','1.1','1.2'], kex:'RSA',        auth:'RSA',  enc:'RC4',       bits:128, mac:'SHA-1',     notes:<span>RC4 broken (<RFCLink rfc="RFC 7465" />). No PFS.</span> },
  { name: 'TLS_RSA_WITH_DES_CBC_SHA',                        iana: '0x0009', score: 5,  tls: ['1.0','1.1','1.2'], kex:'RSA',        auth:'RSA',  enc:'DES',       bits:56,  mac:'SHA-1',     notes:'DES 56-bit is brute-forceable. No PFS.' },
  { name: 'TLS_RSA_WITH_3DES_EDE_CBC_SHA',                   iana: '0x000A', score: 20, tls: ['1.0','1.1','1.2'], kex:'RSA',        auth:'RSA',  enc:'3DES',      bits:112, mac:'SHA-1',     notes:'SWEET32 (64-bit block). Deprecated. No PFS.' },
  { name: 'TLS_DHE_RSA_EXPORT_WITH_DES40_CBC_SHA',           iana: '0x0014', score: 0,  tls: ['1.0'],             kex:'DHE',        auth:'RSA',  enc:'DES',       bits:40,  mac:'SHA-1',     notes:'Export-grade, Logjam vulnerable.' },
  // ── Legacy / Weak ─────────────────────────────────────────────────────
  { name: 'TLS_RSA_WITH_AES_128_CBC_SHA',                    iana: '0x002F', score: 40, tls: ['1.0','1.1','1.2'], kex:'RSA',        auth:'RSA',  enc:'AES-CBC',   bits:128, mac:'SHA-1',     notes:'No PFS (RSA kex). AES-CBC vulnerable to BEAST/POODLE on TLS 1.0.' },
  { name: 'TLS_RSA_WITH_AES_256_CBC_SHA',                    iana: '0x0035', score: 40, tls: ['1.0','1.1','1.2'], kex:'RSA',        auth:'RSA',  enc:'AES-CBC',   bits:256, mac:'SHA-1',     notes:'No PFS. SHA-1 MAC.' },
  { name: 'TLS_RSA_WITH_AES_128_CBC_SHA256',                 iana: '0x003C', score: 45, tls: ['1.2'],             kex:'RSA',        auth:'RSA',  enc:'AES-CBC',   bits:128, mac:'SHA-256',   notes:'No PFS.' },
  { name: 'TLS_RSA_WITH_AES_256_CBC_SHA256',                 iana: '0x003D', score: 45, tls: ['1.2'],             kex:'RSA',        auth:'RSA',  enc:'AES-CBC',   bits:256, mac:'SHA-256',   notes:'No PFS.' },
  { name: 'TLS_DHE_RSA_WITH_DES_CBC_SHA',                    iana: '0x0015', score: 25, tls: ['1.0','1.1','1.2'], kex:'DHE',        auth:'RSA',  enc:'DES',       bits:56,  mac:'SHA-1',     notes:'DES is broken. PFS present.' },
  { name: 'TLS_DHE_RSA_WITH_3DES_EDE_CBC_SHA',               iana: '0x0016', score: 30, tls: ['1.0','1.1','1.2'], kex:'DHE',        auth:'RSA',  enc:'3DES',      bits:112, mac:'SHA-1',     notes:'SWEET32. PFS present but cipher is deprecated.' },
  // ── Acceptable ────────────────────────────────────────────────────────
  { name: 'TLS_DHE_RSA_WITH_AES_128_CBC_SHA',                iana: '0x0033', score: 60, tls: ['1.0','1.1','1.2'], kex:'DHE',        auth:'RSA',  enc:'AES-CBC',   bits:128, mac:'SHA-1',     notes:'PFS via DHE. SHA-1 MAC. AES-CBC prone to Lucky13 without patches.' },
  { name: 'TLS_DHE_RSA_WITH_AES_256_CBC_SHA',                iana: '0x0039', score: 60, tls: ['1.0','1.1','1.2'], kex:'DHE',        auth:'RSA',  enc:'AES-CBC',   bits:256, mac:'SHA-1',     notes:'PFS via DHE. SHA-1 MAC.' },
  { name: 'TLS_DHE_RSA_WITH_AES_128_CBC_SHA256',             iana: '0x0067', score: 65, tls: ['1.2'],             kex:'DHE',        auth:'RSA',  enc:'AES-CBC',   bits:128, mac:'SHA-256',   notes:'PFS. AES-CBC (not AEAD).' },
  { name: 'TLS_DHE_RSA_WITH_AES_256_CBC_SHA256',             iana: '0x006B', score: 65, tls: ['1.2'],             kex:'DHE',        auth:'RSA',  enc:'AES-CBC',   bits:256, mac:'SHA-256',   notes:'PFS. AES-CBC (not AEAD).' },
  { name: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',              iana: '0xC013', score: 65, tls: ['1.0','1.1','1.2'], kex:'ECDHE',      auth:'RSA',  enc:'AES-CBC',   bits:128, mac:'SHA-1',     notes:'ECDHE PFS. SHA-1 MAC. AES-CBC not AEAD.' },
  { name: 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',              iana: '0xC014', score: 65, tls: ['1.0','1.1','1.2'], kex:'ECDHE',      auth:'RSA',  enc:'AES-CBC',   bits:256, mac:'SHA-1',     notes:'ECDHE PFS. SHA-1 MAC.' },
  { name: 'TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA',            iana: '0xC009', score: 65, tls: ['1.0','1.1','1.2'], kex:'ECDHE',      auth:'ECDSA',enc:'AES-CBC',   bits:128, mac:'SHA-1',     notes:'ECDHE PFS. ECDSA auth (EC cert required).' },
  // ── Good ──────────────────────────────────────────────────────────────
  { name: 'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256',           iana: '0xC027', score: 72, tls: ['1.2'],             kex:'ECDHE',      auth:'RSA',  enc:'AES-CBC',   bits:128, mac:'SHA-256',   notes:'ECDHE PFS. AES-CBC still not AEAD.' },
  { name: 'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384',           iana: '0xC028', score: 72, tls: ['1.2'],             kex:'ECDHE',      auth:'RSA',  enc:'AES-CBC',   bits:256, mac:'SHA-384',   notes:'ECDHE PFS. AES-CBC not AEAD.' },
  // ── Recommended ───────────────────────────────────────────────────────
  { name: 'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',           iana: '0xC02F', score: 90, tls: ['1.2'],             kex:'ECDHE',      auth:'RSA',  enc:'AES-GCM',   bits:128, mac:'AEAD',      notes:<span>Recommended. ECDHE PFS. AES-GCM (AEAD). <RFCLink rfc="RFC 7540" /> HTTP/2 mandatory.</span> },
  { name: 'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',           iana: '0xC030', score: 90, tls: ['1.2'],             kex:'ECDHE',      auth:'RSA',  enc:'AES-GCM',   bits:256, mac:'AEAD',      notes:'Recommended. ECDHE PFS. AES-GCM (AEAD).' },
  { name: 'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',         iana: '0xC02B', score: 92, tls: ['1.2'],             kex:'ECDHE',      auth:'ECDSA',enc:'AES-GCM',   bits:128, mac:'AEAD',      notes:'Recommended. ECDHE+ECDSA. Requires EC certificate.' },
  { name: 'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',         iana: '0xC02C', score: 92, tls: ['1.2'],             kex:'ECDHE',      auth:'ECDSA',enc:'AES-GCM',   bits:256, mac:'AEAD',      notes:'Recommended. ECDHE+ECDSA. Requires EC certificate.' },
  { name: 'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',     iana: '0xCCA8', score: 95, tls: ['1.2','1.3'],       kex:'ECDHE',      auth:'RSA',  enc:'ChaCha20',  bits:256, mac:'AEAD',      notes:'Excellent. Preferred on mobile/constrained devices (no AES-NI needed).' },
  { name: 'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',   iana: '0xCCA9', score: 96, tls: ['1.2','1.3'],       kex:'ECDHE',      auth:'ECDSA',enc:'ChaCha20',  bits:256, mac:'AEAD',      notes:'Excellent. ECDSA + ChaCha20-Poly1305.' },
  // ── TLS 1.3 (always excellent) ────────────────────────────────────────
  { name: 'TLS_AES_128_GCM_SHA256',                          iana: '0x1301', score: 95, tls: ['1.3'],             kex:'ECDHE/DHE',  auth:'Cert', enc:'AES-GCM',   bits:128, mac:'AEAD',      notes:'TLS 1.3 only. KEX and auth are negotiated separately. AES-128-GCM.' },
  { name: 'TLS_AES_256_GCM_SHA384',                          iana: '0x1302', score: 98, tls: ['1.3'],             kex:'ECDHE/DHE',  auth:'Cert', enc:'AES-GCM',   bits:256, mac:'AEAD',      notes:'TLS 1.3 only. Best-practice. AES-256-GCM.' },
  { name: 'TLS_CHACHA20_POLY1305_SHA256',                    iana: '0x1303', score: 98, tls: ['1.3'],             kex:'ECDHE/DHE',  auth:'Cert', enc:'ChaCha20',  bits:256, mac:'AEAD',      notes:'TLS 1.3 only. Best-practice. ChaCha20-Poly1305.' },
  { name: 'TLS_AES_128_CCM_SHA256',                          iana: '0x1304', score: 88, tls: ['1.3'],             kex:'ECDHE/DHE',  auth:'Cert', enc:'AES-CCM',   bits:128, mac:'AEAD',      notes:'TLS 1.3. CCM mode — used in constrained IoT devices (RFC 8446).' },
];

const SCORE_COLOR = (s) =>
  s >= 90 ? '#52c4a8' : s >= 70 ? '#a8c452' : s >= 50 ? '#e0c452' : s >= 20 ? '#e08a52' : '#e05252';

const SCORE_LABEL = (s) =>
  s >= 90 ? 'Excellent' : s >= 70 ? 'Good' : s >= 50 ? 'Acceptable' : s >= 20 ? 'Weak' : 'Broken';

const OPENSSL_PRESETS = [
  { label: 'Modern (Mozilla)', value: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305' },
  { label: 'Intermediate (Mozilla)', value: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256:ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384:DHE-RSA-CHACHA20-POLY1305' },
  { label: 'IETF RFC 8446 (TLS 1.3 only)', value: 'TLS_AES_128_GCM_SHA256:TLS_AES_256_GCM_SHA384:TLS_CHACHA20_POLY1305_SHA256' },
];

function parseName(name) {
  const suite = SUITES.find(s => s.name.toLowerCase() === name.trim().toLowerCase());
  if (suite) return suite;

  // Try OpenSSL short name mapping
  const openSslMap = {
    'ECDHE-RSA-AES128-GCM-SHA256':         'TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256',
    'ECDHE-RSA-AES256-GCM-SHA384':         'TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384',
    'ECDHE-ECDSA-AES128-GCM-SHA256':       'TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256',
    'ECDHE-ECDSA-AES256-GCM-SHA384':       'TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384',
    'ECDHE-RSA-CHACHA20-POLY1305':         'TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256',
    'ECDHE-ECDSA-CHACHA20-POLY1305':       'TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256',
    'DHE-RSA-AES128-GCM-SHA256':           'TLS_DHE_RSA_WITH_AES_128_GCM_SHA256',
    'ECDHE-RSA-AES128-SHA':                'TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA',
    'ECDHE-RSA-AES256-SHA':                'TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA',
    'AES128-SHA':                          'TLS_RSA_WITH_AES_128_CBC_SHA',
    'AES256-SHA':                          'TLS_RSA_WITH_AES_256_CBC_SHA',
    'DES-CBC3-SHA':                        'TLS_RSA_WITH_3DES_EDE_CBC_SHA',
    'RC4-SHA':                             'TLS_RSA_WITH_RC4_128_SHA',
    'RC4-MD5':                             'TLS_RSA_WITH_RC4_128_MD5',
  };
  const iana = openSslMap[name.trim().toUpperCase()] || openSslMap[name.trim()];
  if (iana) return SUITES.find(s => s.name === iana) || null;
  return null;
}

function CipherSuite({ onShare, initialData }) {
  const { t } = useTranslation();
  const [input,    setInput]    = usePersistentState('cipher:input', initialData?.input ?? '');
  const [results,  setResults]  = usePersistentState('cipher:results', []);
  const [err,      setErr]      = useState('');
  const [filterScore, setFilterScore] = usePersistentState('cipher:filterScore', 0);

  const analyse = () => {
    setErr('');
    const names = input.split(/[:\s,\n]+/).map(s => s.trim()).filter(Boolean);
    if (!names.length) { setErr('Enter one or more cipher suite names (IANA or OpenSSL format), separated by colon, space, or newline.'); return; }
    const res = names.map(n => ({ name: n, suite: parseName(n) }));
    setResults(res);
  };

  const filtered = results.filter(r => !r.suite || r.suite.score >= filterScore);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('cipher.title', 'TLS Cipher Suite Decoder')}</div>
        <div style={{fontSize:12,color:'var(--muted)',marginBottom:14,lineHeight:1.5}}>
          {t('cipher.subtitle', 'Decode cipher suite names (IANA or OpenSSL format), score each component for security, and identify weak or broken suites in your TLS configuration.')}
        </div>

        <div className="field">
          <label className="label">{t('cipher.input_label', 'Cipher Suite(s) — IANA, OpenSSL, or colon-separated list')}</label>
          <textarea className="input"
            style={{fontFamily:'var(--mono)',fontSize:12,minHeight:80,resize:'vertical'}}
            value={input} onChange={e => { setInput(e.target.value); setResults([]); setErr(''); }}
            placeholder="TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256&#10;ECDHE-RSA-AES256-GCM-SHA384&#10;RC4-SHA"
            spellCheck={false}
          />
        </div>

        <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>Preset cipher strings:</div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
          {OPENSSL_PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost" style={{fontSize:11,padding:'3px 10px'}}
              onClick={() => { setInput(p.value.replace(/:/g, '\n')); setResults([]); }}>
              {p.label}
            </button>
          ))}
        </div>
        <button className="btn btn-primary" onClick={analyse}>{t('cipher.analyse_btn', 'Analyse')}</button>
        {err && <div style={{marginTop:8,fontSize:12,color:'#e05252'}}>{err}</div>}
      </div>

      {results.length > 0 && (
        <div className="card fadein">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12,flexWrap:'wrap',gap:8}}>
            <div className="card-title" style={{marginBottom:0}}>{t('cipher.results_title', 'Analysis Results')} ({results.length} suites)</div>
            <div style={{display:'flex',alignItems:'center',gap:8,fontSize:11}}>
              <span style={{color:'var(--muted)'}}>Show score ≥</span>
              <select className="select" style={{padding:'3px 8px',fontSize:11,width:'auto'}} value={filterScore} onChange={e => setFilterScore(Number(e.target.value))}>
                <option value={0}>All</option>
                <option value={50}>≥ 50 (Acceptable+)</option>
                <option value={70}>≥ 70 (Good+)</option>
                <option value={90}>≥ 90 (Excellent only)</option>
              </select>
            </div>
          </div>

          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {filtered.map((r, i) => r.suite ? (
              <div key={i} style={{padding:14,background:'var(--panel)',border:`1px solid var(--border)`,borderLeft:`4px solid ${SCORE_COLOR(r.suite.score)}`,borderRadius:'var(--radius)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap',marginBottom:8}}>
                  <span style={{fontFamily:'var(--mono)',fontSize:12,fontWeight:700,color:'var(--text)'}}>{r.suite.name}</span>
                  <span style={{fontSize:11,fontWeight:600,color:'var(--bg)',background:SCORE_COLOR(r.suite.score),padding:'1px 8px',borderRadius:10}}>
                    {r.suite.score}/100 — {t(`cipher.summary_${(s => s >= 90 ? 'excellent' : s >= 70 ? 'good' : s >= 50 ? 'acceptable' : s >= 20 ? 'weak' : 'broken')(r.suite.score)}`)}
                  </span>
                  <span style={{fontSize:11,color:'var(--muted)',fontFamily:'var(--mono)'}}>{r.suite.iana}</span>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(140px,1fr))',gap:6,marginBottom:8}}>
                  {[
                    [t('cipher.lbl_kex', 'Key Exchange'), r.suite.kex,  r.suite.kex.startsWith('ECDHE') || r.suite.kex === 'DHE' ? '#52c4a8' : '#e08a52'],
                    [t('cipher.lbl_auth', 'Authentication'), r.suite.auth, r.suite.auth === 'ECDSA' || r.suite.auth === 'RSA' ? '#a8c452' : '#e05252'],
                    [t('cipher.lbl_enc', 'Encryption'), `${r.suite.enc}${r.suite.bits ? ' '+r.suite.bits+'-bit' : ''}`, r.suite.enc.includes('GCM') || r.suite.enc.includes('ChaCha') ? '#52c4a8' : r.suite.enc.includes('AES') ? '#e0c452' : '#e05252'],
                    [t('cipher.lbl_mac', 'MAC / PRF'), r.suite.mac, r.suite.mac === 'AEAD' ? '#52c4a8' : r.suite.mac.includes('SHA-2') ? '#a8c452' : '#e08a52'],
                    [t('cipher.lbl_pfs', 'PFS'), r.suite.kex === 'ECDHE' || r.suite.kex === 'DHE' ? t('common.yes', 'Yes') : t('common.no', 'No'), r.suite.kex === 'ECDHE' || r.suite.kex === 'DHE' ? '#52c4a8' : '#e05252'],
                    [t('cipher.lbl_tls', 'TLS Versions'), r.suite.tls.join(', '), 'var(--text)'],
                  ].map(([label, val, color]) => (
                    <div key={label} style={{padding:'6px 8px',background:'var(--bg)',borderRadius:4}}>
                      <div style={{fontSize:10,color:'var(--muted)',marginBottom:2}}>{label}</div>
                      <div style={{fontSize:11,fontWeight:600,color,fontFamily:'var(--mono)'}}>{val}</div>
                    </div>
                  ))}
                </div>
                {r.suite.notes && <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.4}}>{r.suite.notes}</div>}
              </div>
            ) : (
              <div key={i} style={{padding:12,background:'var(--panel)',border:'1px solid var(--border)',borderLeft:'4px solid var(--muted)',borderRadius:'var(--radius)'}}>
                <span style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--text)'}}>{r.name}</span>
                <span style={{fontSize:11,color:'#e08a52',marginLeft:10}}>{t('cipher.unknown_suite_desc', 'Unknown cipher suite — not in local database')}</span>
              </div>
              ))}
              </div>

              {/* Summary */}
              <div style={{marginTop:16,padding:12,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)'}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text)',marginBottom:8}}>{t('cipher.summary', 'Summary')}</div>
              <div style={{display:'flex',gap:10,flexWrap:'wrap'}}>
              {['Broken','Weak','Acceptable','Good','Excellent'].map((label, i) => {
                const ranges = [[0,20],[20,50],[50,70],[70,90],[90,101]];
                const [lo, hi] = ranges[i];
                const cnt = results.filter(r => r.suite && r.suite.score >= lo && r.suite.score < hi).length;
                if (!cnt) return null;
                const colors = ['#e05252','#e08a52','#e0c452','#a8c452','#52c4a8'];
                return (
                  <span key={label} style={{fontSize:11,fontWeight:600,color:'var(--bg)',background:colors[i],padding:'2px 10px',borderRadius:10}}>
                    {cnt} {t(`cipher.summary_${label.toLowerCase()}`, label)}
                  </span>
                );
              })}
              {results.filter(r => !r.suite).length > 0 && (
                <span style={{fontSize:11,color:'var(--muted)'}}>{results.filter(r => !r.suite).length} {t('cipher.unknown', 'unknown')}</span>
              )}
              </div>
              </div>
              </div>
              )}

              {/* Quick reference */}
              <div className="card">
              <div className="card-title" style={{marginBottom:10}}>{t('cipher.quick_ref', 'Quick Security Reference')}</div>
              <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.7}}>
              <strong style={{color:'#e05252'}}>{t('cipher.ref_broken', 'Broken (avoid)')}:</strong> {t('cipher.ref_broken_desc', 'NULL, RC4, DES, EXPORT, ANON, MD5 MAC')}<br/>
              <strong style={{color:'#e08a52'}}>{t('cipher.ref_weak', 'Weak (phase out)')}:</strong> {t('cipher.ref_weak_desc', '3DES (SWEET32), RSA key exchange (no PFS), SHA-1 MAC, TLS 1.0/1.1')}<br/>
              <strong style={{color:'#e0c452'}}>{t('cipher.ref_acceptable', 'Acceptable')}:</strong> {t('cipher.ref_acceptable_desc', 'AES-CBC with ECDHE/DHE PFS + SHA-256 MAC (TLS 1.2 only)')}<br/>
              <strong style={{color:'#a8c452'}}>{t('cipher.ref_good', 'Good')}:</strong> {t('cipher.ref_good_desc', <span>AES-GCM with ECDHE PFS (TLS 1.2, <RFCLink rfc="RFC 7540" /> mandatory for HTTP/2)</span>)}<br/>
              <strong style={{color:'#52c4a8'}}>{t('cipher.ref_excellent', 'Excellent')}:</strong> {t('cipher.ref_excellent_desc', <span>AES-256-GCM or ChaCha20-Poly1305 with ECDHE (TLS 1.2/1.3), any TLS 1.3 suite (<RFCLink rfc="RFC 8446" />)</span>)}<br/>
              <br/>
              <strong style={{color:'var(--text)'}}>{t('cipher.ref_pfs', 'PFS (Perfect Forward Secrecy)')}:</strong> {t('cipher.ref_pfs_desc', 'ECDHE and DHE key exchanges create ephemeral session keys — a compromised private key cannot decrypt past sessions.')}<br/>
              <strong style={{color:'var(--text)'}}>{t('cipher.ref_aead', 'AEAD')}:</strong> {t('cipher.ref_aead_desc', 'Authenticated Encryption with Associated Data — no separate MAC needed; provides integrity + confidentiality in one pass.')}
              </div>
              </div>    </div>
  );
}

window.CipherSuite = CipherSuite;
