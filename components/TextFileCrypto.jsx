const { useState, useEffect, useCallback, useRef } = React;

const _NEK_MAGIC = new Uint8Array([0x4E, 0x45, 0x4B, 0x31]);
const _NEK_VERSION = 0x01;
const _SALT_LEN = 16;
const _IV_LEN = 12;

function _bytesToHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}
function _bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}
function _base64ToBytes(b64) {
  const s = atob(b64.trim());
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
async function _deriveKey(password, salt) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}
async function _aesEncrypt(key, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(_IV_LEN));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { iv, cipher };
}
async function _aesDecrypt(key, iv, cipher) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
}
function _buildContainer(salt, iv, cipher) {
  const out = new Uint8Array(4 + 1 + _SALT_LEN + _IV_LEN + cipher.length);
  let o = 0;
  out.set(_NEK_MAGIC, o); o += 4;
  out[o++] = _NEK_VERSION;
  out.set(salt, o); o += _SALT_LEN;
  out.set(iv, o); o += _IV_LEN;
  out.set(cipher, o);
  return out;
}
function _parseContainer(bytes) {
  if (bytes[0] !== 0x4E || bytes[1] !== 0x45 || bytes[2] !== 0x4B || bytes[3] !== 0x31)
    throw new Error('bad_magic');
  if (bytes.length < 4 + 1 + _SALT_LEN + _IV_LEN + 1) throw new Error('too_short');
  let o = 5;
  const salt = bytes.slice(o, o + _SALT_LEN); o += _SALT_LEN;
  const iv   = bytes.slice(o, o + _IV_LEN);   o += _IV_LEN;
  const cipher = bytes.slice(o);
  return { salt, iv, cipher };
}
function _downloadBlob(content, filename, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

const _STAGES = {
  key:    { pct: 35 },
  cipher: { pct: 75 },
  done:   { pct: 95 },
};

function TextFileCrypto({ initialData, onShare }) {
  const { t } = useTranslation();
  const [tab,  setTab]  = usePersistentState('aescrypt:tab',  initialData?.tab  ?? 'text');
  const [mode, setMode] = usePersistentState('aescrypt:mode', initialData?.mode ?? 'encrypt');

  const [password, setPassword]           = useState('');
  const [showPw, setShowPw]               = useState(false);
  const [plainText, setPlainText]         = usePersistentState('aescrypt:plain', '');
  const [cipherBlob, setCipherBlob]       = usePersistentState('aescrypt:blob', '');
  const [saltHex, setSaltHex]             = useState('');
  const [ivHex, setIvHex]                 = useState('');
  const [decryptedText, setDecryptedText] = useState('');

  // Multi-file state: separate per mode so the encrypt dropzone doesn't share
  // files with the decrypt dropzone (different file types, different intent).
  const [encFiles, setEncFiles] = useState([]); // plain files queued for encryption
  const [decFiles, setDecFiles] = useState([]); // .enc files queued for decryption
  const [encResults, setEncResults] = useState(null); // [{name, bytes}] | null — encrypted .enc output shown as a list
  const [decResults, setDecResults] = useState(null); // [{name, bytes}] | null — decrypted output shown as a list
  const [stage, setStage]   = useState(null); // null | 'key' | 'cipher' | 'done'
  const [stageInfo, setStageInfo] = useState(''); // e.g. "2 / 3"
  const [errMsg, setErrMsg] = useState('');

  const encFileRef = useRef(null);
  const decFileRef = useRef(null);

  const secure = !!(window.crypto && window.crypto.subtle);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({ tool: 'aescrypt', tab, mode });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [tab, mode, onShare]);

  const loadFiles = useCallback((fileList, setter) => {
    if (!fileList.length) return;
    setErrMsg('');
    const readers = fileList.map(f => new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = (ev) => resolve({ name: f.name, bytes: new Uint8Array(ev.target.result) });
      fr.readAsArrayBuffer(f);
    }));
    Promise.all(readers).then(incoming => setter(prev => [...prev, ...incoming]));
  }, []);

  const clearErr = () => setErrMsg('');

  // ── Text encrypt ────────────────────────────────────────────
  const handleEncryptText = async () => {
    if (!password || !plainText) { setErrMsg(t('aescrypt.err_empty')); return; }
    setStage('key'); setErrMsg('');
    try {
      const salt = crypto.getRandomValues(new Uint8Array(_SALT_LEN));
      const key  = await _deriveKey(password, salt);
      setStage('cipher');
      const { iv, cipher } = await _aesEncrypt(key, new TextEncoder().encode(plainText));
      const container = _buildContainer(salt, iv, cipher);
      setCipherBlob(_bytesToBase64(container));
      setSaltHex(_bytesToHex(salt));
      setIvHex(_bytesToHex(iv));
      setDecryptedText('');
    } catch (ex) {
      setErrMsg(t('aescrypt.err_encrypt') + ': ' + ex.message);
    } finally { setStage(null); setStageInfo(''); }
  };

  // ── Text decrypt ────────────────────────────────────────────
  const handleDecryptText = async () => {
    if (!password || !cipherBlob) { setErrMsg(t('aescrypt.err_empty')); return; }
    setStage('key'); setErrMsg('');
    try {
      const { salt, iv, cipher } = _parseContainer(_base64ToBytes(cipherBlob));
      const key   = await _deriveKey(password, salt);
      setStage('cipher');
      const plain = await _aesDecrypt(key, iv, cipher);
      setDecryptedText(new TextDecoder().decode(plain));
    } catch (ex) {
      const msg = (ex.message === 'bad_magic' || ex.message === 'too_short')
        ? t('aescrypt.err_bad_format')
        : ex.name === 'OperationError'
          ? t('aescrypt.err_wrong_password')
          : t('aescrypt.err_decrypt') + ': ' + ex.message;
      setErrMsg(msg);
      setDecryptedText('');
    } finally { setStage(null); setStageInfo(''); }
  };

  // ── File encrypt (multi) ─────────────────────────────────────
  const handleEncryptFiles = async () => {
    if (!password || !encFiles.length) { setErrMsg(t('aescrypt.err_empty')); return; }
    setStage('key'); setErrMsg(''); setEncResults(null);
    try {
      const results = [];
      for (let i = 0; i < encFiles.length; i++) {
        setStageInfo(`${i + 1} / ${encFiles.length}`);
        const salt = crypto.getRandomValues(new Uint8Array(_SALT_LEN));
        const key  = await _deriveKey(password, salt);
        setStage('cipher');
        const { iv, cipher } = await _aesEncrypt(key, encFiles[i].bytes);
        results.push({ name: encFiles[i].name + '.enc', bytes: _buildContainer(salt, iv, cipher) });
        setStage('key');
      }
      setStage('done');
      // Show results as a list so users can grab individual .enc files (which
      // round-trip through Decrypt) or the bundled ZIP — never auto-bundle to
      // a zip that the user then tries to decrypt and gets a NEK1 error from.
      if (results.length === 1) {
        _downloadBlob(results[0].bytes, results[0].name);
      }
      setEncResults(results);
    } catch (ex) {
      setErrMsg(t('aescrypt.err_encrypt') + ': ' + ex.message);
    } finally { setStage(null); setStageInfo(''); }
  };

  // ── File decrypt (multi) ─────────────────────────────────────
  const handleDecryptFiles = async () => {
    if (!password || !decFiles.length) { setErrMsg(t('aescrypt.err_empty')); return; }
    setStage('key'); setErrMsg(''); setDecResults(null);
    try {
      const results = [];
      for (let i = 0; i < decFiles.length; i++) {
        setStageInfo(`${i + 1} / ${decFiles.length}`);
        const { salt, iv, cipher } = _parseContainer(decFiles[i].bytes);
        const key   = await _deriveKey(password, salt);
        setStage('cipher');
        const plain = await _aesDecrypt(key, iv, cipher);
        const outName = decFiles[i].name.endsWith('.enc')
          ? decFiles[i].name.slice(0, -4)
          : 'decrypted_' + decFiles[i].name;
        results.push({ name: outName, bytes: plain });
        setStage('key');
      }
      setStage('done');
      // Mirror Steganography: show a list with individual + "Download All as ZIP"
      // buttons instead of auto-downloading. Single file still auto-downloads,
      // matching the stego UX.
      if (results.length === 1) {
        _downloadBlob(results[0].bytes, results[0].name);
      }
      setDecResults(results);
    } catch (ex) {
      const msg = (ex.message === 'bad_magic' || ex.message === 'too_short')
        ? t('aescrypt.err_bad_format')
        : ex.name === 'OperationError'
          ? t('aescrypt.err_wrong_password')
          : t('aescrypt.err_decrypt') + ': ' + ex.message;
      setErrMsg(msg);
    } finally { setStage(null); setStageInfo(''); }
  };

  if (!secure) {
    return (
      <div className="fadein">
        <div className="card">
          <div className="card-title">{t('tools.aescrypt.title')}</div>
          <div className="err" style={{ marginBottom: '0.75rem' }}>{t('aescrypt.err_insecure')}</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{t('aescrypt.err_insecure_hint')}</p>
        </div>
      </div>
    );
  }

  // ── Shared sub-components ────────────────────────────────────
  const pwField = (
    <div className="field">
      <label className="label">{t('aescrypt.password_label')}</label>
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input className="input" type={showPw ? 'text' : 'password'}
          placeholder={t('aescrypt.password_placeholder')}
          value={password} onChange={e => setPassword(e.target.value)}
          style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setShowPw(v => !v)}>
          {showPw ? t('aescrypt.hide_pw') : t('aescrypt.show_pw')}
        </button>
      </div>
    </div>
  );

  const progressBar = stage ? (
    <div style={{ marginTop: '0.75rem' }}>
      <div style={{ height: '3px', background: 'var(--border)', borderRadius: '2px', overflow: 'hidden' }}>
        <div style={{
          height: '100%',
          width: (_STAGES[stage]?.pct ?? 50) + '%',
          background: 'var(--accent, #38bdf8)',
          borderRadius: '2px',
          transition: 'width 0.35s ease',
        }} />
      </div>
      <div style={{ fontSize: '0.78rem', color: 'var(--text-secondary)', marginTop: '0.3rem' }}>
        {t('aescrypt.stage_' + (stage === 'done' ? 'download' : stage))}
        {stageInfo ? ` (${stageInfo})` : ''}
      </div>
    </div>
  ) : null;

  // Shared dropzone that shows file chips when loaded, hint when empty
  const dropArea = ({ onDropFiles, inputRef, hint, filled, children, multi, accept }) => (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const dropped = e.dataTransfer?.files;
        if (!dropped?.length) return;
        onDropFiles(multi ? Array.from(dropped) : dropped[0]);
      }}
      onClick={e => {
        if (e.target.closest('button')) return;
        inputRef.current?.click();
      }}
      style={{
        border: '2px dashed var(--border)', borderRadius: '8px',
        padding: filled ? '0.75rem' : '1.5rem',
        textAlign: filled ? 'left' : 'center', cursor: 'pointer',
        color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)',
        marginBottom: '0.5rem',
        transition: 'padding 120ms ease',
      }}
    >
      {filled ? children : hint}
    </div>
  );

  // ── Text tab ─────────────────────────────────────────────────
  const renderTextTab = () => {
    if (mode === 'encrypt') return (
      <div>
        {pwField}
        <div className="field">
          <label className="label">{t('aescrypt.plaintext_label')}</label>
          <textarea className="input" rows={6} placeholder={t('aescrypt.plaintext_placeholder')}
            value={plainText} onChange={e => { setPlainText(e.target.value); clearErr(); }} />
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={handleEncryptText} disabled={!!stage}>
            {t('aescrypt.btn_encrypt')}
          </button>
          {(plainText || cipherBlob) && !stage && (
            <button className="btn btn-ghost" onClick={() => { setPlainText(''); setCipherBlob(''); setSaltHex(''); setIvHex(''); setErrMsg(''); }}>
              {t('common.clear')}
            </button>
          )}
        </div>
        {progressBar}
        {errMsg && <div className="err" style={{ marginTop: '0.5rem' }}>{errMsg}</div>}
        {cipherBlob && (
          <div>
            <div className="field" style={{ marginTop: '1rem' }}>
              <label className="label">{t('aescrypt.output_blob_label')}</label>
              <textarea className="input" rows={4} value={cipherBlob} readOnly style={{ fontFamily: 'monospace', fontSize: '0.8rem' }} />
            </div>
            {saltHex && (
              <div style={{ display: 'flex', gap: '2rem', marginTop: '0.25rem', fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace', flexWrap: 'wrap' }}>
                <span><b>Salt:</b> {saltHex}</span>
                <span><b>IV:</b> {ivHex}</span>
              </div>
            )}
            <div style={{ marginTop: '0.5rem' }}>
              <CopyBtn text={cipherBlob} label="common.copy" id="aescrypt-blob" />
            </div>
          </div>
        )}
      </div>
    );

    return (
      <div>
        {pwField}
        <div className="field">
          <label className="label">{t('aescrypt.blob_input_label')}</label>
          <textarea className="input" rows={5} placeholder={t('aescrypt.blob_placeholder')}
            value={cipherBlob} onChange={e => { setCipherBlob(e.target.value); clearErr(); setDecryptedText(''); }}
            style={{ fontFamily: 'monospace', fontSize: '0.8rem' }} />
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={handleDecryptText} disabled={!!stage}>
            {t('aescrypt.btn_decrypt')}
          </button>
          {(cipherBlob || decryptedText) && !stage && (
            <button className="btn btn-ghost" onClick={() => { setCipherBlob(''); setDecryptedText(''); setErrMsg(''); }}>
              {t('common.clear')}
            </button>
          )}
        </div>
        {progressBar}
        {errMsg && <div className="err" style={{ marginTop: '0.5rem' }}>{errMsg}</div>}
        {decryptedText && (
          <div>
            <div className="field" style={{ marginTop: '1rem' }}>
              <label className="label">{t('aescrypt.decrypted_label')}</label>
              <textarea className="input" rows={6} value={decryptedText} readOnly />
            </div>
            <CopyBtn text={decryptedText} label="common.copy" id="aescrypt-dec" />
          </div>
        )}
      </div>
    );
  };

  // ── File tab ─────────────────────────────────────────────────
  const renderFileTab = () => {
    const isEnc = mode === 'encrypt';
    const action = isEnc ? handleEncryptFiles : handleDecryptFiles;
    const btnLabel = isEnc ? t('aescrypt.btn_encrypt_file') : t('aescrypt.btn_decrypt_file');
    const currentFiles = isEnc ? encFiles : decFiles;
    const setCurrentFiles = isEnc ? setEncFiles : setDecFiles;
    const currentRef = isEnc ? encFileRef : decFileRef;
    const removeAt = (idx) => setCurrentFiles(prev => prev.filter((_, i) => i !== idx));
    const disabledReason = !password
      ? t('aescrypt.disabled_no_password')
      : !currentFiles.length ? t('aescrypt.disabled_no_files')
      : '';

    return (
      <div>
        {pwField}
        <div className="field">
          <label className="label">{t('aescrypt.file_label')}</label>
          {dropArea({
            onDropFiles: (fl) => loadFiles(fl, setCurrentFiles),
            inputRef: currentRef,
            hint: isEnc ? t('aescrypt.dropzone_enc') : t('aescrypt.dropzone_dec'),
            filled: currentFiles.length > 0, multi: true,
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {currentFiles.map((f, i) => (
                  <div key={i} style={{
                    display: 'flex', alignItems: 'center', gap: '0.5rem',
                    fontSize: '0.85rem',
                    padding: '0.35rem 0.5rem',
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border)', borderRadius: '4px',
                  }}>
                    <span style={{ color: 'var(--text-primary)', flex: 1, wordBreak: 'break-all' }}>{f.name}</span>
                    <span style={{ color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                      {f.bytes.length.toLocaleString()} {t('stego.bytes')}
                    </span>
                    <button type="button" className="btn btn-ghost btn-sm"
                      onClick={() => removeAt(i)}
                      style={{ padding: '0.15rem 0.5rem' }}>×</button>
                  </div>
                ))}
                <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '0.25rem' }}>
                  {t('aescrypt.file_add_more')}
                </div>
              </div>
            ),
          })}
          <input ref={currentRef} type="file" multiple style={{ display: 'none' }}
            accept={!isEnc ? '.enc' : undefined}
            onChange={e => { loadFiles(Array.from(e.target.files), setCurrentFiles); e.target.value = ''; }} />
          <span className="hint">{isEnc ? t('aescrypt.file_hint_enc') : t('aescrypt.file_hint_dec')}</span>
        </div>
        <div className="btn-row">
          <button className="btn btn-primary" onClick={action}
            disabled={!!stage || !!disabledReason}>
            {btnLabel}
          </button>
          {disabledReason && !stage && (
            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', alignSelf: 'center', marginLeft: '0.5rem' }}>
              {disabledReason}
            </span>
          )}
          {currentFiles.length > 0 && !stage && (
            <button className="btn btn-ghost" onClick={() => {
              setCurrentFiles([]); setErrMsg('');
              if (isEnc) setEncResults(null); else setDecResults(null);
            }}>
              {t('common.clear')}
            </button>
          )}
        </div>
        {progressBar}
        {errMsg && <div className="err" style={{ marginTop: '0.5rem' }}>{errMsg}</div>}

        {(() => {
          const results = isEnc ? encResults : decResults;
          if (!results || !results.length) return null;
          const zipName = isEnc ? 'encrypted_files.zip' : 'decrypted_files.zip';
          return (
            <div className="field" style={{ marginTop: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <label className="label" style={{ margin: 0 }}>{t('stego.extracted_file')}</label>
                {results.length > 1 && (
                  <button className="btn btn-sm btn-primary"
                    onClick={() => _downloadBlob(buildZip(results), zipName, 'application/zip')}>
                    {t('stego.btn_download_all_zip')}
                  </button>
                )}
              </div>
              {results.map((f, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.5rem 0',
                  borderBottom: i < results.length - 1 ? '1px solid var(--border)' : 'none',
                }}>
                  <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{f.name}</span>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                    {f.bytes.length.toLocaleString()} {t('stego.bytes')}
                  </span>
                  <button className="btn btn-sm btn-ghost" onClick={() => _downloadBlob(f.bytes, f.name)}>
                    {t('stego.btn_download_file')}
                  </button>
                </div>
              ))}
            </div>
          );
        })()}

      </div>
    );
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('tools.aescrypt.title')}</div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {t('aescrypt.subtitle')}
        </p>

        {/* Tab row: Encrypt | Decrypt */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
          {['encrypt', 'decrypt'].map(m => (
            <button key={m} className={`btn btn-sm ${mode === m ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setMode(m); setErrMsg(''); }}>
              {t('aescrypt.mode_' + m)}
            </button>
          ))}
        </div>

        {/* Input mode toggle: Text | File */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
          {['text', 'file'].map(tb => (
            <button key={tb} className={`btn btn-sm ${tab === tb ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => { setTab(tb); setErrMsg(''); }}>
              {t('aescrypt.tab_' + tb)}
            </button>
          ))}
        </div>

        {tab === 'text' ? renderTextTab() : renderFileTab()}
      </div>
    </div>
  );
}

window.TextFileCrypto = TextFileCrypto;
