const { useState, useEffect, useCallback, useMemo, useRef } = React;

// ─── Helpers ────────────────────────────────────────────────
const b64urlEncode = (str) => btoa(unescape(encodeURIComponent(str)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (s) => {
  const pad = s + '='.repeat((4 - s.length % 4) % 4);
  return atob(pad.replace(/-/g, '+').replace(/_/g, '/'));
};

function JWTTools({ onShare, initialData, onNav }) {
  const { t } = useTranslation();

  // ─── Tab State ────────────────────────────────────────────
  const [activeTab, setActiveTab] = usePersistentState('jwt:activeTab',
    (initialData?.tool === 'jwtenc' || initialData?.activeTab === 'encode') ? 'encode' : 'decode'
  );
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

  // ─── Decoder States ───────────────────────────────────────
  const [decToken, setDecToken] = usePersistentState('jwt-dec:token', initialData?.token ?? '');
  const [decSecret, setDecSecret] = usePersistentState('jwt-dec:secret', '');
  const [decError, setDecError] = useState('');
  const [decoded, setDecoded] = usePersistentState('jwt-dec:decoded', null);
  const [sigStatus, setSigStatus] = useState('unsigned'); // 'verified' | 'invalid' | 'unsigned' | 'not_verified' | 'unsupported'

  // ─── Encoder States ───────────────────────────────────────
  const [encHeaderJSON, setEncHeaderJSON] = usePersistentState('jwt-enc:headerJSON', 
    initialData?.header ?? '{\n  "alg": "HS256",\n  "typ": "JWT"\n}'
  );
  const [encPayloadJSON, setEncPayloadJSON] = usePersistentState('jwt-enc:payloadJSON', 
    initialData?.payload ?? '{\n  "sub": "1234567890",\n  "name": "John Doe",\n  "iat": ' + Math.floor(Date.now() / 1000) + '\n}'
  );
  const [encSecret, setEncSecret] = usePersistentState('jwt-enc:secret', initialData?.secret ?? '');
  const [encToken, setEncToken] = usePersistentState('jwt-enc:token', '');
  const [encError, setEncError] = useState('');

  // ─── Constants & Mappings ──────────────────────────────────
  const DECODER_PRESETS = [
    { label: t('jwt.presets.hs256'), value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' },
    { label: t('jwt.presets.rs256'), value: 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiYWRtaW4iOnRydWUsImlhdCI6MTUxNjIzOTAyMn0.POstGetfAytaZS82wHcjoTyoqhMyxXiWdR7Nn7A29DNSl0EiXLdwJ6xC6AfgZWF1bOsS_TuYI3OG85AmiExREkrS6tDfTQ2B3WXlrr-wp5AokiRbz3_oB4OxG-W9KcEEbDRcZc0nH3L7LzYptiy1PtAylQGxHTWZXtGz4ht0bAecBgmpdgXMguEIcoqPJ1n3pIWk_dUZegpqx0Lka21H6XxUTxiy8OcaarA8zdnPUnV6AmNP3ecFawIFYdvJB_cm-GvpCSbr8G8y_Mllj8f4x9nBH8pQux89_6gUY618iYv7tuPWBFfEbLxtF2pZS6YC1aSfLQxeNe8djT9YjpvRZA' },
    { label: t('jwt.presets.expired'), value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyLCJleHAiOjE1MTYyMzkwMjJ9.4UjqcskQyV_y0JvGIbuYMSLeJqPY0ku6BqT0ffX7jXw' },
    { label: t('jwt.presets.full_claims'), value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkphbmUgU21pdGgiLCJlbWFpbCI6ImphbmVAZXhhbXBsZS5jb20iLCJyb2xlIjoiYWRtaW4iLCJpYXQiOjE3MDAwMDAwMDAsImV4cCI6MTczNTY5NjAwMCwibmJmIjoxNzAwMDAwMDAwLCJpc3MiOiJodHRwczovL2F1dGguZXhhbXBsZS5jb20iLCJhdWQiOiJodHRwczovL2FwaS5leGFtcGxlLmNvbSIsImp0aSI6ImFiYzEyMyJ9.tLhbCKKwIw3oJZHOQgJVzsNseBCNPAaFd05gwvXxTgQ' },
  ];

  const ENCODER_PRESETS = useMemo(() => [
    {
      label: t('jwtenc.presets.auth'),
      header: '{\n  "alg": "HS256",\n  "typ": "JWT"\n}',
      payload: JSON.stringify({
        sub: 'user-42',
        name: 'Jane Smith',
        email: 'jane@example.com',
        role: 'admin',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: 'https://auth.example.com',
        aud: 'https://api.example.com',
      }, null, 2),
    },
    {
      label: t('jwtenc.presets.api'),
      header: '{\n  "alg": "HS256",\n  "typ": "JWT"\n}',
      payload: JSON.stringify({
        sub: 'service-payments',
        scope: 'read:invoices write:payments',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
        iss: 'https://api.example.com',
        aud: 'https://payments.example.com',
      }, null, 2),
    },
    {
      label: t('jwtenc.presets.nosig'),
      header: '{\n  "alg": "none",\n  "typ": "JWT"\n}',
      payload: JSON.stringify({
        sub: '1234567890',
        name: 'Unsecured Token',
        iat: Math.floor(Date.now() / 1000),
      }, null, 2),
    },
  ], [t]);

  const KNOWN_CLAIMS = useMemo(() => ({
    iss: { label: t('jwt.claims.iss'), type: 'string' },
    sub: { label: t('jwt.claims.sub'), type: 'string' },
    aud: { label: t('jwt.claims.aud'), type: 'string' },
    exp: { label: t('jwt.claims.exp'), type: 'time' },
    nbf: { label: t('jwt.claims.nbf'), type: 'time' },
    iat: { label: t('jwt.claims.iat'), type: 'time' },
    jti: { label: t('jwt.claims.jti'), type: 'string' },
    name: { label: t('jwt.claims.name'), type: 'string' },
    email: { label: t('jwt.claims.email'), type: 'string' },
    role: { label: t('jwt.claims.role'), type: 'string' },
    scope: { label: t('jwt.claims.scope'), type: 'string' },
    azp: { label: t('jwt.claims.azp'), type: 'string' },
    nonce: { label: t('jwt.claims.nonce'), type: 'string' },
    auth_time: { label: t('jwt.claims.auth_time'), type: 'time' },
    at_hash: { label: t('jwt.claims.at_hash'), type: 'string' },
    c_hash: { label: t('jwt.claims.c_hash'), type: 'string' },
  }), [t]);

  const ALGO_SECURITY = useMemo(() => ({
    HS256: { level: 'secure', color: 'var(--green)' },
    HS384: { level: 'secure', color: 'var(--green)' },
    HS512: { level: 'secure', color: 'var(--green)' },
    RS256: { level: 'secure', color: 'var(--green)' },
    RS384: { level: 'secure', color: 'var(--green)' },
    RS512: { level: 'secure', color: 'var(--green)' },
    ES256: { level: 'secure', color: 'var(--green)' },
    ES384: { level: 'secure', color: 'var(--green)' },
    ES512: { level: 'secure', color: 'var(--green)' },
    PS256: { level: 'secure', color: 'var(--green)' },
    PS384: { level: 'secure', color: 'var(--green)' },
    PS512: { level: 'secure', color: 'var(--green)' },
    none: { level: 'insecure', color: 'var(--red)' },
  }), []);

  // ─── Decryption Logic & Effects ───────────────────────────
  useEffect(() => {
    if (!decToken.trim()) {
      setDecoded(null);
      setDecError('');
      return;
    }
    const parts = decToken.trim().split('.');
    if (parts.length < 2 || parts.length > 3) {
      setDecError(t('jwt.err_parts'));
      setDecoded(null);
      return;
    }
    try {
      const header = JSON.parse(b64urlDecode(parts[0]));
      const payload = JSON.parse(b64urlDecode(parts[1]));
      setDecoded({ header, payload, signature: parts[2] || '', parts });
      setDecError('');
    } catch (e) {
      setDecError(t('jwt.err_decode', { msg: e.message }));
      setDecoded(null);
    }
  }, [decToken, t]);

  // HMAC Signature verification in Decoder
  useEffect(() => {
    if (!decoded) {
      setSigStatus('unsigned');
      return;
    }

    const { header, signature, parts } = decoded;
    const alg = (header.alg || 'none').toUpperCase();

    if (alg === 'NONE') {
      if (signature) {
        setSigStatus('invalid');
      } else {
        setSigStatus('unsigned');
      }
      return;
    }

    if (alg === 'HS256' || alg === 'HS384' || alg === 'HS512') {
      if (!decSecret) {
        setSigStatus('not_verified');
        return;
      }

      const signingInput = `${parts[0]}.${parts[1]}`;
      const hashAlg = alg === 'HS256' ? 'SHA-256' : alg === 'HS384' ? 'SHA-384' : 'SHA-512';

      const verify = async () => {
        try {
          const enc = new TextEncoder();
          const cryptoKey = await crypto.subtle.importKey(
            'raw', enc.encode(decSecret), { name: 'HMAC', hash: hashAlg }, false, ['sign']
          );
          const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(signingInput));
          const expectedSig = b64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
          if (expectedSig === signature) {
            setSigStatus('verified');
          } else {
            setSigStatus('invalid');
          }
        } catch (e) {
          setSigStatus('invalid');
        }
      };

      verify();
    } else {
      setSigStatus('unsupported');
    }
  }, [decoded, decSecret]);

  // ─── Encryption Logic & Effects ───────────────────────────
  const signHS = async (data, key, hashName) => {
    const enc = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      'raw', enc.encode(key), { name: 'HMAC', hash: hashName }, false, ['sign']
    );
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(data));
    return b64urlEncode(String.fromCharCode(...new Uint8Array(sig)));
  };

  const encode = useCallback(async () => {
    setEncError('');
    try {
      const header = JSON.parse(encHeaderJSON);
      const payload = JSON.parse(encPayloadJSON);
      const alg = (header.alg || 'none').toLowerCase();

      const headerB64 = b64urlEncode(JSON.stringify(header));
      const payloadB64 = b64urlEncode(JSON.stringify(payload));
      const signingInput = `${headerB64}.${payloadB64}`;

      let signature = '';
      if (alg !== 'none') {
        if (!encSecret) { 
          setEncError(t('jwtenc.err_secret')); 
          setEncToken('');
          return; 
        }
        
        if (alg === 'hs256') {
          signature = await signHS(signingInput, encSecret, 'SHA-256');
        } else if (alg === 'hs384') {
          signature = await signHS(signingInput, encSecret, 'SHA-384');
        } else if (alg === 'hs512') {
          signature = await signHS(signingInput, encSecret, 'SHA-512');
        } else {
          setEncError(t('jwtenc.err_algo', { alg: header.alg }));
          setEncToken('');
          return;
        }
      }

      setEncToken(signature ? `${signingInput}.${signature}` : `${signingInput}.`);
    } catch (e) {
      setEncError(t('jwtenc.err_json', { msg: e.message }));
      setEncToken('');
    }
  }, [encHeaderJSON, encPayloadJSON, encSecret, t]);

  useEffect(() => { 
    if (activeTab === 'encode') {
      encode(); 
    }
  }, [encHeaderJSON, encPayloadJSON, encSecret, activeTab, encode]);

  // ─── Time Helper Utilities ───────────────────────────────
  const updatePayloadClaims = (updates) => {
    try {
      let data = {};
      try {
        data = JSON.parse(encPayloadJSON);
      } catch (e) {
        data = {};
      }
      
      Object.entries(updates).forEach(([key, val]) => {
        if (val === undefined) {
          delete data[key];
        } else {
          data[key] = val;
        }
      });
      
      setEncPayloadJSON(JSON.stringify(data, null, 2));
    } catch (e) {}
  };

  // ─── Validation Helpers ────────────────────────────────────
  const isValidJSON = (str) => { 
    try { JSON.parse(str); return true; } catch { return false; } 
  };
  
  const encHeaderValid = isValidJSON(encHeaderJSON);
  const encPayloadValid = isValidJSON(encPayloadJSON);
  const parsedEncHeader = encHeaderValid ? JSON.parse(encHeaderJSON) : {};
  const parsedEncPayload = encPayloadValid ? JSON.parse(encPayloadJSON) : {};
  const encAlgLabel = parsedEncHeader.alg || 'none';

  const encoderExpired = parsedEncPayload.exp && Number(parsedEncPayload.exp) < (Date.now() / 1000);
  const encoderNotYetValid = parsedEncPayload.nbf && Number(parsedEncPayload.nbf) > (Date.now() / 1000);

  // ─── Share State Synchronization ──────────────────────────
  useEffect(() => {
    if (initialData?.token !== undefined && initialData?.tool === 'jwtdecoder') {
      setDecToken(initialData.token);
    }
    if (initialData?.header !== undefined && initialData?.tool === 'jwtenc') {
      setEncHeaderJSON(initialData.header);
    }
    if (initialData?.payload !== undefined && initialData?.tool === 'jwtenc') {
      setEncPayloadJSON(initialData.payload);
    }
    if (initialData?.secret !== undefined && initialData?.tool === 'jwtenc') {
      setEncSecret(initialData.secret);
    }
  }, [initialData]);

  useEffect(() => {
    const handle = (e) => {
      if (activeTab === 'decode') {
        if (decToken) (e.detail?.respond ?? onShare)({ tool: 'jwt', activeTab: 'decode', token: decToken });
      } else {
        const data = { tool: 'jwt', activeTab: 'encode', header: encHeaderJSON, payload: encPayloadJSON };
        if (encSecret) data.secret = encSecret;
        (e.detail?.respond ?? onShare)(data);
      }
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [activeTab, decToken, encHeaderJSON, encPayloadJSON, encSecret, onShare]);

  // ─── Formatting helpers ────────────────────────────────────
  const formatTime = (ts) => {
    if (ts === undefined || ts === null) return null;
    const num = Number(ts);
    if (isNaN(num)) return String(ts);
    const date = new Date(num < 1e12 ? num * 1000 : num);
    return date.toLocaleString();
  };

  const getRelativeTime = (ts) => {
    const num = Number(ts);
    if (isNaN(num)) return null;
    const date = new Date(num < 1e12 ? num * 1000 : num);
    const diff = date.getTime() - Date.now();
    const abs = Math.abs(diff);
    const str = abs < 60000 ? `${Math.floor(abs / 1000)}${t('common.unit_s')}`
      : abs < 3600000 ? `${Math.floor(abs / 60000)}${t('common.unit_m')}`
      : abs < 86400000 ? `${Math.floor(abs / 3600000)}${t('common.unit_h')}`
      : `${Math.floor(abs / 86400000)}${t('common.unit_d')}`;
    return { text: str, isPast: diff < 0 };
  };

  const isDecExpired = decoded?.payload?.exp && Number(decoded.payload.exp) < (Date.now() / 1000);
  const isDecNotYetValid = decoded?.payload?.nbf && Number(decoded.payload.nbf) > (Date.now() / 1000);
  const decAlgoInfo = decoded ? ALGO_SECURITY[decoded.header.alg] || { level: 'unknown', color: 'var(--dim)' } : null;

  // ─── Cross Loading Actions ────────────────────────────────
  const loadIntoEncoder = () => {
    if (!decoded) return;
    setEncHeaderJSON(JSON.stringify(decoded.header, null, 2));
    setEncPayloadJSON(JSON.stringify(decoded.payload, null, 2));
    if (decSecret) setEncSecret(decSecret);
    setActiveTab('encode');
  };

  const loadIntoDecoder = () => {
    if (!encToken) return;
    setDecToken(encToken);
    if (encSecret) setDecSecret(encSecret);
    setActiveTab('decode');
  };

  // ─── Tab Definition ───────────────────────────────────────
  const tabs = [
    { id: 'decode', label: t('jwt_tools.tabs.decode'), icon: '🔓' },
    { id: 'encode', label: t('jwt_tools.tabs.encode'), icon: '🔒' }
  ];

  return (
    <div className="tool-content">
      {/* Tab Navigation */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button 
            key={tab.id} 
            className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(tab.id)} 
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{tab.icon}</span> 
            {tab.label}
          </button>
        ))}
      </div>

      {/* ════════════════════════ DECODER TAB ════════════════════════ */}
      {activeTab === 'decode' && (
        <div className="fadein">
          {/* Input Card */}
          <div className="card fadein">
            <div className="card-title">{t('jwt.input_title')}</div>
            <textarea
              className="input"
              rows={5}
              placeholder={t('jwt.input_placeholder')}
              value={decToken}
              onChange={e => setDecToken(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%' }}
            />
            <Err msg={decError} />
          </div>

          {/* Presets */}
          <div className="card fadein">
            <div className="card-title">{t('jwt.presets_title')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DECODER_PRESETS.map(p => (
                <button 
                  key={p.label} 
                  className="btn btn-ghost" 
                  style={{ fontSize: 12, padding: '3px 10px' }}
                  onClick={() => setDecToken(p.value)}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Verification Secret Input */}
          {decoded && ['HS256', 'HS384', 'HS512'].includes((decoded.header.alg || '').toUpperCase()) && (
            <div className="card fadein">
              <div className="card-title">{t('jwtenc.secret_label')}</div>
              <input
                type="text"
                className="input"
                value={decSecret}
                onChange={e => setDecSecret(e.target.value)}
                placeholder={t('jwtenc.secret_placeholder')}
                style={{ fontFamily: 'var(--mono)', fontSize: 12, width: '100%' }}
              />
            </div>
          )}

          {/* Warnings */}
          {(isDecExpired || isDecNotYetValid) && (
            <div className="fadein">
              {isDecExpired && (
                <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--red)', fontWeight: 600, fontSize: 13 }}>⚠ {t('jwt.token_expired')}</span>
                </div>
              )}
              {isDecNotYetValid && (
                <div style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: 'var(--yellow)', fontWeight: 600, fontSize: 13 }}>⚠ {t('jwt.token_not_yet_valid')}</span>
                </div>
              )}
            </div>
          )}

          {/* Decoded Results */}
          {decoded && (
            <div className="fadein">
              {/* Algorithm & Signature Status info */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                  <div className="card-title" style={{ margin: 0 }}>{t('jwt.algorithm_info')}</div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Security Badge */}
                    {decAlgoInfo && (
                      <span className={`badge ${decAlgoInfo.level === 'secure' ? 'badge-green' : decAlgoInfo.level === 'insecure' ? 'badge-red' : 'badge-gray'}`} style={{ fontSize: 11 }}>
                        {decAlgoInfo.level === 'secure' ? t('jwt.secure') : decAlgoInfo.level === 'insecure' ? t('jwt.insecure') : t('jwt.unknown')}
                      </span>
                    )}
                    {/* Verification Status Badge */}
                    <span 
                      className={`badge ${
                        sigStatus === 'verified' ? 'badge-green' : 
                        sigStatus === 'invalid' ? 'badge-red' : 
                        sigStatus === 'not_verified' ? 'badge-yellow' : 
                        'badge-gray'
                      }`} 
                      style={{ fontSize: 11 }}
                    >
                      {t(`jwt_tools.sig_${sigStatus}`)}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  {[
                    { label: t('jwt.algo'), value: decoded.header.alg || 'none', color: decAlgoInfo?.color || 'var(--text)' },
                    { label: t('jwt.type'), value: decoded.header.typ || '-', color: 'var(--muted)' },
                    { label: t('jwt.key_id'), value: decoded.header.kid || '-', color: 'var(--muted)' },
                  ].map(item => (
                    <div key={item.label} style={{ padding: '8px 12px', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>{item.label}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: item.color }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Header */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--purple)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {t('jwt.header')} <span style={{ color: 'var(--dim)', fontWeight: 400, fontSize: 10 }}>({decoded.parts[0].length} chars)</span>
                  </div>
                  <CopyBtn text={JSON.stringify(decoded.header, null, 2)} id="jwt-header" />
                </div>
                <pre style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  padding: 12, fontFamily: 'var(--mono)', fontSize: 12, overflow: 'auto', margin: 0,
                }}>{JSON.stringify(decoded.header, null, 2)}</pre>
              </div>

              {/* Payload with claim descriptions */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--cyan)', textTransform: 'uppercase', letterSpacing: 1 }}>
                    {t('jwt.payload')} <span style={{ color: 'var(--dim)', fontWeight: 400, fontSize: 10 }}>({decoded.parts[1].length} chars)</span>
                  </div>
                  <CopyBtn text={JSON.stringify(decoded.payload, null, 2)} id="jwt-payload" />
                </div>

                {/* Claim-by-claim breakdown */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {Object.entries(decoded.payload).map(([key, val]) => {
                    const known = KNOWN_CLAIMS[key];
                    const isTime = known?.type === 'time';
                    const timeStr = isTime ? formatTime(val) : null;
                    const relTime = isTime ? getRelativeTime(val) : null;
                    return (
                      <div key={key} style={{
                        padding: '8px 12px', background: 'var(--bg)', borderRadius: 'var(--radius)',
                        border: '1px solid var(--border)', display: 'grid', gridTemplateColumns: '120px 1fr auto',
                        gap: 10, alignItems: 'start',
                      }}>
                        <div>
                          <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cyan)', fontWeight: 600 }}>{key}</span>
                          {known && <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{known.label}</div>}
                        </div>
                        <div>
                          <code style={{ fontFamily: 'var(--mono)', fontSize: 12, wordBreak: 'break-all' }}>
                            {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                          </code>
                          {isTime && timeStr && (
                            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
                              {timeStr}
                              {relTime && (
                                <span style={{ color: relTime.isPast ? 'var(--red)' : 'var(--green)', fontWeight: 600, marginLeft: 6 }}>
                                  ({relTime.isPast ? t('jwt.ago', { t: relTime.text }) : t('jwt.in', { t: relTime.text })})
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                        <CopyBtn text={String(typeof val === 'object' ? JSON.stringify(val) : val)} id={`jwt-claim-${key}`} />
                      </div>
                    );
                  })}
                </div>

                {/* Raw JSON */}
                <details style={{ marginBottom: 14 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>{t('jwt.raw_json')}</summary>
                  <pre style={{
                    background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    padding: 12, fontFamily: 'var(--mono)', fontSize: 12, overflow: 'auto', margin: 0,
                  }}>{JSON.stringify(decoded.payload, null, 2)}</pre>
                </details>

                {/* Action button to load into encoder */}
                <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                  <button className="btn btn-ghost btn-sm" onClick={loadIntoEncoder}>
                    ⚙ {t('jwt_tools.load_encoder')}
                  </button>
                </div>
              </div>

              {/* Signature */}
              <div className="card">
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--yellow)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
                  {t('jwt.signature')}
                </div>
                <div style={{
                  background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  padding: '10px 12px', fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', wordBreak: 'break-all',
                }}>{decoded.signature || '(empty)'}</div>
                {decoded.header.alg === 'none' && (
                  <div style={{ marginTop: 8, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--red)' }}>
                    ⚠ {t('jwt.unsecured_warning')}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ════════════════════════ ENCODER TAB ════════════════════════ */}
      {activeTab === 'encode' && (
        <div className="fadein">
          {/* Presets */}
          <div className="card fadein">
            <div className="card-title">{t('jwtenc.presets_title')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ENCODER_PRESETS.map(p => (
                <button 
                  key={p.label} 
                  className="btn btn-ghost" 
                  style={{ fontSize: 12, padding: '3px 10px' }}
                  onClick={() => { setEncHeaderJSON(p.header); setEncPayloadJSON(p.payload); }}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Header */}
          <div className="card fadein">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>{t('jwtenc.header_label')}</div>
              <span className={`badge ${encHeaderValid ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 10 }}>
                {encHeaderValid ? t('jwtenc.valid') : t('jwtenc.invalid')}
              </span>
            </div>
            <textarea
              className="input"
              rows={5}
              value={encHeaderJSON}
              onChange={e => setEncHeaderJSON(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%', borderColor: encHeaderValid ? 'var(--border)' : 'var(--red)' }}
            />
          </div>

          {/* Payload with helper actions */}
          <div className="card fadein">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>{t('jwtenc.payload_label')}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button 
                  className="btn btn-ghost" 
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => updatePayloadClaims({ iat: Math.floor(Date.now() / 1000) })}
                  title={t('jwt_tools.set_iat')}
                >
                  🕒 +iat
                </button>
                <button 
                  className="btn btn-ghost" 
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => updatePayloadClaims({ exp: Math.floor(Date.now() / 1000) + 3600 })}
                  title={t('jwt_tools.set_exp')}
                >
                  ⏳ +exp
                </button>
                <button 
                  className="btn btn-ghost" 
                  style={{ fontSize: 10, padding: '2px 8px' }}
                  onClick={() => updatePayloadClaims({ nbf: Math.floor(Date.now() / 1000) })}
                  title={t('jwt_tools.set_nbf')}
                >
                  🚦 +nbf
                </button>
                <button 
                  className="btn btn-ghost" 
                  style={{ fontSize: 10, padding: '2px 8px', color: 'var(--red)' }}
                  onClick={() => updatePayloadClaims({ iat: undefined, exp: undefined, nbf: undefined, auth_time: undefined })}
                  title={t('jwt_tools.clear_time')}
                >
                  ✖ clear
                </button>
              </div>
              <span className={`badge ${encPayloadValid ? 'badge-green' : 'badge-red'}`} style={{ fontSize: 10 }}>
                {encPayloadValid ? t('jwtenc.valid') : t('jwtenc.invalid')}
              </span>
            </div>
            <textarea
              className="input"
              rows={8}
              value={encPayloadJSON}
              onChange={e => setEncPayloadJSON(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%', borderColor: encPayloadValid ? 'var(--border)' : 'var(--red)' }}
            />
            {/* Payload Time Warning Badges */}
            {encPayloadValid && (
              <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
                {encoderExpired && (
                  <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: 11, color: 'var(--red)' }}>
                    ⚠ {t('jwt.token_expired')} (exp: {formatTime(parsedEncPayload.exp)})
                  </div>
                )}
                {encoderNotYetValid && (
                  <div style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', borderRadius: 'var(--radius)', padding: '6px 10px', fontSize: 11, color: 'var(--yellow)' }}>
                    ⚠ {t('jwt.token_not_yet_valid')} (nbf: {formatTime(parsedEncPayload.nbf)})
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Secret Key */}
          {encAlgLabel !== 'none' && (
            <div className="card fadein">
              <div className="card-title">{t('jwtenc.secret_label')}</div>
              <input
                type="text"
                className="input"
                value={encSecret}
                onChange={e => setEncSecret(e.target.value)}
                placeholder={t('jwtenc.secret_placeholder')}
                style={{ fontFamily: 'var(--mono)', fontSize: 12, width: '100%' }}
              />
            </div>
          )}

          <Err msg={encError} />

          {/* Encoded Token Output */}
          {encToken && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="card-title" style={{ margin: 0 }}>{t('jwtenc.token_label')}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)' }}>{encToken.length} chars</span>
                  <CopyBtn text={encToken} id="jwt-encoded" />
                </div>
              </div>
              <div style={{
                background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: 12, fontFamily: 'var(--mono)', fontSize: 11, wordBreak: 'break-all', lineHeight: 1.5,
              }}>
                {encToken.split('.').map((part, i) => (
                  <span key={i}>
                    <span style={{ color: i === 0 ? 'var(--purple)' : i === 1 ? 'var(--cyan)' : 'var(--yellow)' }}>{part}</span>
                    {i < encToken.split('.').length - 1 && <span style={{ color: 'var(--dim)' }}>.</span>}
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 8, fontSize: 10, color: 'var(--dim)', flexWrap: 'wrap' }}>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--purple)', marginRight: 4 }} />{t('jwtenc.legend_header')}</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--cyan)', marginRight: 4 }} />{t('jwtenc.legend_payload')}</span>
                <span><span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: 'var(--yellow)', marginRight: 4 }} />{t('jwtenc.legend_signature')}</span>
              </div>

              {encAlgLabel === 'none' && (
                <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 'var(--radius)', fontSize: 11, color: 'var(--red)' }}>
                  ⚠ {t('jwt.unsecured_warning')}
                </div>
              )}

              {/* Action button to load into decoder */}
              <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: 12 }}>
                <button className="btn btn-ghost btn-sm" onClick={loadIntoDecoder}>
                  🔍 {t('jwt_tools.load_decoder')}
                </button>
              </div>
            </div>
          )}

          {/* Algorithm Info Card */}
          <div className="card fadein">
            <div className="card-title">{t('jwtenc.algo_info_title')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8 }}>
              {[
                { alg: 'HS256', hash: 'SHA-256', note: t('jwtenc.note_hmac') },
                { alg: 'HS384', hash: 'SHA-384', note: t('jwtenc.note_hmac') },
                { alg: 'HS512', hash: 'SHA-512', note: t('jwtenc.note_hmac') },
                { alg: 'none', hash: '-', note: t('jwtenc.note_none') },
              ].map(item => (
                <div key={item.alg} style={{
                  padding: '8px 12px', background: 'var(--bg)', borderRadius: 'var(--radius)',
                  border: `1px solid ${encAlgLabel.toUpperCase() === item.alg.toUpperCase() ? 'var(--cyan)' : 'var(--border)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: item.alg === 'none' ? 'var(--red)' : 'var(--text)' }}>{item.alg}</span>
                    <span style={{ fontSize: 10, color: 'var(--muted)' }}>{item.hash}</span>
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 2 }}>{item.note}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.JWTTools = JWTTools;
