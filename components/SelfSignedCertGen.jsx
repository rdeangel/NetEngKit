const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SelfSignedCertGen({ onShare, initialData }) {
  const { t } = useTranslation();
  const [form, setForm] = usePersistentState('cert:form', initialData?.form ?? { cn:'', org:'', country:'', days:'365', keyBits:'2048', sans:'' });
  const [loading, setLoading] = useState(false);
  const [result, setResult] = usePersistentState('cert:result', null);
  const [err, setErr] = useState('');
  const [forgeReady, setForgeReady] = useState(!!window.forge);

  useEffect(() => {
    if (initialData) {
      if (initialData.form !== undefined) setForm(initialData.form);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (form?.cn) (e.detail?.respond ?? onShare)({ tool: 'cert-gen', form });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [form, onShare]);

  useEffect(() => {
    if (window.forge) return;
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/node-forge@1.3.1/dist/forge.min.js';
    s.onload = () => setForgeReady(true);
    s.onerror = () => setErr(t('cert.err_load'));
    document.head.appendChild(s);
  }, [t]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const generate = () => {
    if (!form.cn.trim()) { setErr(t('cert.err_cn')); return; }
    setErr(''); setResult(null); setLoading(true);

    // Defer to let React render the loading state before blocking computation
    setTimeout(() => {
      try {
        const forge = window.forge;
        const bits = parseInt(form.keyBits);

        forge.pki.rsa.generateKeyPair({ bits, workers: -1 }, (genErr, keyPair) => {
          if (genErr) { setErr(t('cert.err_key_gen', { msg: genErr.message })); setLoading(false); return; }
          try {
            const cert = forge.pki.createCertificate();
            cert.publicKey = keyPair.publicKey;
            cert.serialNumber = Math.floor(Math.random() * 0xFFFFFFFF).toString(16).padStart(8, '0');

            const now = new Date();
            const exp = new Date(now.getTime() + parseInt(form.days) * 86400000);
            cert.validity.notBefore = now;
            cert.validity.notAfter = exp;

            const attrs = [{ name:'commonName', value: form.cn.trim() }];
            if (form.org.trim()) attrs.push({ name:'organizationName', value: form.org.trim() });
            if (form.country.trim()) attrs.push({ name:'countryName', value: form.country.trim().toUpperCase().slice(0, 2) });
            cert.setSubject(attrs);
            cert.setIssuer(attrs);

            const extensions = [
              { name:'basicConstraints', cA: true, critical: true },
              { name:'keyUsage', keyCertSign: true, digitalSignature: true, keyEncipherment: true, critical: true },
              { name:'extKeyUsage', serverAuth: true, clientAuth: true },
              { name:'subjectKeyIdentifier' },
            ];

            const sanList = form.sans.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
            const cnLooksDomain = /[a-z].*\./i.test(form.cn.trim());
            const allSans = cnLooksDomain && !sanList.includes(form.cn.trim()) ? [form.cn.trim(), ...sanList] : sanList;
            if (allSans.length) {
              extensions.push({ name:'subjectAltName', altNames: allSans.map(s =>
                /^\d{1,3}(\.\d{1,3}){3}$/.test(s) ? { type:7, ip:s } : { type:2, value:s }
              )});
            }
            cert.setExtensions(extensions);
            cert.sign(keyPair.privateKey, forge.md.sha256.create());

            const certPem = forge.pki.certificateToPem(cert);
            const keyPem  = forge.pki.privateKeyToPem(keyPair.privateKey);

            const derBytes = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
            const md = forge.md.sha256.create();
            md.update(derBytes);
            const fp = md.digest().toHex().toUpperCase().match(/../g).join(':');

            setResult({ certPem, keyPem, fingerprint: fp, notAfter: exp.toISOString().split('T')[0], cn: form.cn.trim(), bits });
          } catch (e2) {
            setErr(t('cert.err_cert_build', { msg: (e2.message || e2) }));
          }
          setLoading(false);
        });
      } catch (e) {
        setErr(t('cert.err_gen', { msg: (e.message || e) }));
        setLoading(false);
      }
    }, 50);
  };

  const downloadPem = (content, filename) => {
    const blob = new Blob([content], { type:'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">
          {t('cert.title')}
          {!forgeReady && <span className="badge badge-yellow" style={{marginLeft:8,fontSize:10}}>{t('cert.loading_crypto')}</span>}
        </div>
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))',gap:12}}>
          <div className="field" style={{gridColumn:'1/-1'}}>
            <label className="label">{t('cert.cn')}</label>
            <input className={`input ${err&&!form.cn?'error':''}`} value={form.cn}
              onChange={e => set('cn', e.target.value)} placeholder={t('cert.cn_placeholder')} />
          </div>
          <div className="field">
            <label className="label">{t('cert.org')}</label>
            <input className="input" value={form.org} onChange={e => set('org', e.target.value)} placeholder={t('cert.org_placeholder')} />
          </div>
          <div className="field">
            <label className="label">{t('cert.country')}</label>
            <input className="input" value={form.country} onChange={e => set('country', e.target.value)} placeholder={t('cert.country_placeholder')} maxLength={2} style={{textTransform:'uppercase'}} />
          </div>
          <div className="field">
            <label className="label">{t('cert.validity')}</label>
            <select className="select" value={form.days} onChange={e => set('days', e.target.value)}>
              <option value="30">{t('cert.days', { n: 30 })}</option>
              <option value="90">{t('cert.days', { n: 90 })}</option>
              <option value="365">{t('cert.year')}</option>
              <option value="730">{t('cert.years', { n: 2 })}</option>
              <option value="3650">{t('cert.years', { n: 10 })}</option>
            </select>
          </div>
          <div className="field">
            <label className="label">{t('cert.key_size')}</label>
            <select className="select" value={form.keyBits} onChange={e => set('keyBits', e.target.value)}>
              <option value="2048">{t('cert.rsa_bits', { n: 2048 })}</option>
              <option value="4096">{t('cert.rsa_slower')}</option>
            </select>
          </div>
          <div className="field" style={{gridColumn:'1/-1'}}>
            <label className="label">{t('cert.sans')}</label>
            <input className="input" value={form.sans} onChange={e => set('sans', e.target.value)} placeholder={t('cert.sans_placeholder')} />
            <div className="hint">{t('cert.sans_hint')}</div>
          </div>
        </div>
        <Err msg={err} />
        <button className="btn btn-primary" onClick={generate} disabled={loading || !forgeReady} style={{marginTop:14}}>
          {loading ? t('cert.generating') : t('cert.generate')}
        </button>
        <div className="hint" style={{marginTop:8}}>{t('cert.local_hint')}</div>
      </div>

      {result && (
        <div className="card fadein">
          <div style={{display:'flex',gap:10,alignItems:'center',flexWrap:'wrap',marginBottom:14}}>
            <span className="badge badge-green">{t('cert.generated')}</span>
            <span style={{color:'var(--text)',fontSize:13,fontFamily:'var(--mono)'}}>{result.cn}</span>
            <span style={{color:'var(--muted)',fontSize:12}}>{t('cert.rsa_bits', { n: result.bits })} · {t('cert.expires')} {result.notAfter}</span>
          </div>
          <div style={{fontSize:10,color:'var(--muted)',textTransform:'uppercase',letterSpacing:1,marginBottom:4}}>{t('cert.fingerprint')}</div>
          <div style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--cyan)',marginBottom:18,wordBreak:'break-all'}}>{result.fingerprint}</div>

          {[{label:t('cert.cert_pem'), content:result.certPem, file:'certificate.pem'}, {label:t('cert.key_pem'), content:result.keyPem, file:'private-key.pem'}].map(({label,content,file}) => (
            <div key={file} style={{marginBottom:18}}>
              <div style={{display:'flex',gap:8,alignItems:'center',marginBottom:6,flexWrap:'wrap'}}>
                <span style={{fontSize:13,fontWeight:600}}>{label}</span>
                <CopyBtn text={content} />
                <button className="btn btn-ghost btn-sm" onClick={() => downloadPem(content, file)}>↓ {t('cert.download')}</button>
              </div>
              <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 14px',fontFamily:'var(--mono)',fontSize:11,color:'var(--dim)',maxHeight:150,overflowY:'auto',whiteSpace:'pre-wrap',wordBreak:'break-all',userSelect:'all'}}>
                {content}
              </div>
            </div>
          ))}
          <div className="hint">{t('cert.security_warn')}</div>
        </div>
      )}
    </div>
  );
}

// ─── Reference Data ──────────────────────────────────────────
// ... (rest of the file unchanged)
window.SelfSignedCertGen = SelfSignedCertGen;
