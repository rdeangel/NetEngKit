const { useState, useEffect, useCallback, useRef, useMemo } = React;

function WifiQRCode({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  // Tab navigation
  const [activeTab, setActiveTab] = usePersistentState('wifi-qr:activeTab', initialData?.tab || 'wifi');
  const skipNavReport = useRef(false);

  useEffect(() => {
    if (initialData?.tab && initialData.tab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.tab);
    }
  }, [initialData]);

  useEffect(() => {
    if (skipNavReport.current) {
      skipNavReport.current = false;
      return;
    }
    onNav?.({ tab: activeTab });
  }, [activeTab, onNav]);

  // WiFi Tab state
  const [ssid, setSsid] = usePersistentState('wifi-qr:ssid', initialData?.ssid || '');
  const [password, setPassword] = usePersistentState('wifi-qr:password', initialData?.password || '');
  const [encryption, setEncryption] = usePersistentState('wifi-qr:encryption', initialData?.encryption || 'WPA');
  const [hidden, setHidden] = usePersistentState('wifi-qr:hidden', initialData?.hidden || false);

  // URL Tab state
  const [urlInput, setUrlInput] = usePersistentState('wifi-qr:urlInput', initialData?.urlInput || '');

  // Text Tab state
  const [textInput, setTextInput] = usePersistentState('wifi-qr:textInput', initialData?.textInput || '');

  // Decode Tab state (image data is ephemeral — not shared/persisted)
  const [decodeResult, setDecodeResult] = useState(null);
  const [decodeError, setDecodeError] = useState('');
  const [decodePreviewUrl, setDecodePreviewUrl] = useState(null);
  const [decodeDecoding, setDecodeDecoding] = useState(false);
  const [decodeDragOver, setDecodeDragOver] = useState(false);
  const decodeFileRef = useRef(null);
  const decodeImgUrlRef = useRef(null);

  // QR Options
  const [eccLevel, setEccLevel] = usePersistentState('wifi-qr:ecc', initialData?.ecc || 'M'); // L, M, Q, H
  const [qrSize, setQrSize] = usePersistentState('wifi-qr:size', initialData?.size || 256);

  const qrRef = useRef(null);

  useEffect(() => {
    if (initialData) {
      if (initialData.tab !== undefined) setActiveTab(initialData.tab);
      if (initialData.ssid !== undefined) setSsid(initialData.ssid);
      if (initialData.password !== undefined) setPassword(initialData.password);
      if (initialData.encryption !== undefined) setEncryption(initialData.encryption);
      if (initialData.hidden !== undefined) setHidden(initialData.hidden);
      if (initialData.urlInput !== undefined) setUrlInput(initialData.urlInput);
      if (initialData.textInput !== undefined) setTextInput(initialData.textInput);
      if (initialData.ecc !== undefined) setEccLevel(initialData.ecc);
      if (initialData.size !== undefined) setQrSize(initialData.size);
    }
  }, [initialData]);

  const handleShare = useCallback(() => {
    onShare?.({
      tool: 'wifi-qr',
      tab: activeTab,
      ssid,
      password,
      encryption,
      hidden,
      urlInput,
      textInput,
      ecc: eccLevel,
      size: qrSize,
    });
  }, [activeTab, ssid, password, encryption, hidden, urlInput, textInput, eccLevel, qrSize, onShare]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      (e.detail?.respond ?? handleShare)({
        tool: 'wifi-qr',
        tab: activeTab,
        ssid,
        password,
        encryption,
        hidden,
        urlInput,
        textInput,
        ecc: eccLevel,
        size: qrSize,
      });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [activeTab, ssid, password, encryption, hidden, urlInput, textInput, eccLevel, qrSize, handleShare]);

  // ─── QR Decode logic ────────────────────────────────────────
  const scanQrImage = useCallback((img) => {
    const maxDim = 1600;
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    const scale = Math.min(1, maxDim / Math.max(w0, h0, 1));
    const w = Math.max(1, Math.round(w0 * scale));
    const h = Math.max(1, Math.round(h0 * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);
    return window.jsQR(imageData.data, w, h, { inversionAttempts: 'attemptBoth' });
  }, []);

  const handleDecodeFile = useCallback((file) => {
    if (!file) return;
    if (!file.type || !file.type.startsWith('image/')) {
      setDecodeError(t('wifi_qr.decode_err_not_image'));
      return;
    }
    setDecodeError('');
    setDecodeResult(null);
    setDecodeDecoding(true);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (decodeImgUrlRef.current) URL.revokeObjectURL(decodeImgUrlRef.current);
      decodeImgUrlRef.current = url;
      setDecodePreviewUrl(url);
      let code = null;
      try {
        code = scanQrImage(img);
      } catch (err) {
        code = null;
      }
      setDecodeDecoding(false);
      if (code && code.data) {
        setDecodeResult({ text: code.data });
      } else {
        setDecodeError(t('wifi_qr.decode_none'));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setDecodeDecoding(false);
      setDecodeError(t('wifi_qr.decode_err_load'));
    };
    img.src = url;
  }, [scanQrImage, t]);

  // Global paste listener — active only on the Decode tab
  useEffect(() => {
    if (activeTab !== 'decode') return;
    const onPaste = (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.type && item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            handleDecodeFile(file);
          }
          return;
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [activeTab, handleDecodeFile]);

  const pasteFromClipboard = useCallback(async () => {
    try {
      if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('unsupported');
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = (item.types || []).find((ty) => ty.startsWith('image/'));
        if (imgType) {
          const blob = await item.getType(imgType);
          handleDecodeFile(new File([blob], 'clipboard.png', { type: imgType }));
          return;
        }
      }
      setDecodeError(t('wifi_qr.decode_clipboard_unavailable'));
    } catch (err) {
      setDecodeError(t('wifi_qr.decode_clipboard_unavailable'));
    }
  }, [handleDecodeFile, t]);

  const clearDecode = useCallback(() => {
    setDecodeResult(null);
    setDecodeError('');
    setDecodeDecoding(false);
    setDecodePreviewUrl(null);
    if (decodeImgUrlRef.current) {
      URL.revokeObjectURL(decodeImgUrlRef.current);
      decodeImgUrlRef.current = null;
    }
    if (decodeFileRef.current) decodeFileRef.current.value = '';
  }, []);

  // Release the preview object URL on unmount
  useEffect(() => () => {
    if (decodeImgUrlRef.current) URL.revokeObjectURL(decodeImgUrlRef.current);
  }, []);

  const parseWifiPayload = useCallback((text) => {
    if (!/^WIFI:/i.test(text)) return null;
    const body = text.slice(5);
    const parts = [];
    let cur = '';
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (ch === '\\' && i + 1 < body.length) { cur += ch + body[i + 1]; i++; continue; }
      if (ch === ';') { parts.push(cur); cur = ''; continue; }
      cur += ch;
    }
    if (cur) parts.push(cur);
    const out = {};
    parts.forEach((p) => {
      const idx = p.indexOf(':');
      if (idx === -1) return;
      const k = p.slice(0, idx).toUpperCase();
      const v = p.slice(idx + 1).replace(/\\([\\;,:"'])/g, '$1');
      if (k === 'S') out.ssid = v;
      else if (k === 'P') out.password = v;
      else if (k === 'T') out.encryption = v;
      else if (k === 'H') out.hidden = v === 'true';
    });
    return out;
  }, []);

  const payloadTypeInfo = useMemo(() => {
    const text = decodeResult?.text || '';
    if (/^WIFI:/i.test(text)) return { key: 'wifi_qr.type_wifi', cls: 'badge-cyan', wifi: parseWifiPayload(text) };
    if (/^https?:\/\//i.test(text)) return { key: 'wifi_qr.type_url', cls: 'badge-green' };
    if (/^BEGIN:VCARD/i.test(text)) return { key: 'wifi_qr.type_vcard', cls: 'badge-purple' };
    if (/^MECARD:/i.test(text)) return { key: 'wifi_qr.type_mecard', cls: 'badge-purple' };
    if (/^otpauth:\/\//i.test(text)) return { key: 'wifi_qr.type_otp', cls: 'badge-red' };
    if (/^(mailto:|SMTP:|MATMSG:)/i.test(text)) return { key: 'wifi_qr.type_email', cls: 'badge-blue' };
    if (/^(SMSTO?:|MMSTO?:)/i.test(text)) return { key: 'wifi_qr.type_sms', cls: 'badge-blue' };
    if (/^geo:/i.test(text)) return { key: 'wifi_qr.type_geo', cls: 'badge-yellow' };
    return { key: 'wifi_qr.type_text', cls: '' };
  }, [decodeResult, parseWifiPayload]);

  // Compute payload string
  const payloadString = useMemo(() => {
    if (activeTab === 'wifi') {
      if (!ssid.trim()) return '';
      // Escape special characters in SSID & Password: \, ;, ,, :, "
      const esc = (s) => (s || '').replace(/([\\;,:"'])/g, '\\$1');
      return `WIFI:S:${esc(ssid)};T:${encryption};P:${esc(password)};H:${hidden ? 'true' : 'false'};;`;
    }
    if (activeTab === 'url') {
      return (urlInput || '').trim();
    }
    if (activeTab === 'text') {
      return textInput || '';
    }
    return '';
  }, [activeTab, ssid, encryption, password, hidden, urlInput, textInput]);

  const generate = useCallback(() => {
    if (!qrRef.current) return;
    qrRef.current.innerHTML = '';
    if (!payloadString.trim()) return;

    const levelMap = {
      L: window.QRCode?.CorrectLevel?.L ?? 1,
      M: window.QRCode?.CorrectLevel?.M ?? 0,
      Q: window.QRCode?.CorrectLevel?.Q ?? 3,
      H: window.QRCode?.CorrectLevel?.H ?? 2,
    };

    new window.QRCode(qrRef.current, {
      text: payloadString,
      width: Number(qrSize) || 256,
      height: Number(qrSize) || 256,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: levelMap[eccLevel] ?? (window.QRCode?.CorrectLevel?.M ?? 0),
    });
  }, [payloadString, qrSize, eccLevel]);

  useEffect(() => {
    if (payloadString) {
      generate();
    } else if (qrRef.current) {
      qrRef.current.innerHTML = '';
    }
  }, [payloadString, generate]);

  const tabs = [
    { id: 'wifi', label: t('wifi_qr.tab_wifi'), icon: '📶' },
    { id: 'url', label: t('wifi_qr.tab_url'), icon: '🔗' },
    { id: 'text', label: t('wifi_qr.tab_text'), icon: '📝' },
    { id: 'decode', label: t('wifi_qr.tab_decode'), icon: '🔍' },
  ];

  const getDownloadFilename = () => {
    if (activeTab === 'wifi') {
      return `wifi-qr-${(ssid || 'network').replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
    }
    if (activeTab === 'url') {
      return `url-qr-${(urlInput || 'link').replace(/https?:\/\//, '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 24)}.png`;
    }
    return `text-qr-${(textInput || 'text').slice(0, 16).replace(/[^a-zA-Z0-9_-]/g, '_')}.png`;
  };

  const getActiveTabTitle = () => {
    if (activeTab === 'wifi') return ssid || t('wifi_qr.network_details');
    if (activeTab === 'url') return urlInput || t('wifi_qr.url_details');
    return textInput ? `${textInput.slice(0, 32)}${textInput.length > 32 ? '...' : ''}` : t('wifi_qr.text_details');
  };

  const getActiveTabSubtitle = () => {
    if (activeTab === 'wifi') return encryption === 'nopass' ? t('wifi_qr.open_network') : encryption;
    if (activeTab === 'url') return t('wifi_qr.url_type');
    return `${t('wifi_qr.char_count')}: ${textInput.length}`;
  };

  const URL_PRESETS = [
    { label: 'HTTPS Example', value: 'https://192.168.1.1' },
    { label: 'Network Portal', value: 'https://router.local/admin' },
    { label: 'NetEngKit Repo', value: 'https://github.com/rdeangel/NetEngKit' },
  ];

  return (
    <div className="fadein">
      {/* Top Tab Bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map((tabItem) => (
          <button
            key={tabItem.id}
            className={`btn btn-sm ${activeTab === tabItem.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(tabItem.id)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <span>{tabItem.icon}</span>
            <span>{tabItem.label}</span>
          </button>
        ))}
      </div>

      {/* Input Form Card */}
      {activeTab === 'wifi' && (
        <div className="card">
          <div className="card-title">{t('wifi_qr.network_details')}</div>
          <div className="result-grid">
            <div className="field">
              <label className="label">{t('wifi_qr.ssid_label')}</label>
              <input
                className="input"
                value={ssid}
                onChange={(e) => setSsid(e.target.value)}
                placeholder={t('wifi_qr.ssid_placeholder')}
              />
            </div>
            <div className="field">
              <label className="label">{t('wifi_qr.encryption')}</label>
              <select className="select" value={encryption} onChange={(e) => setEncryption(e.target.value)}>
                <option value="WPA">{t('wifi_qr.wpa')}</option>
                <option value="WEP">{t('wifi_qr.wep')}</option>
                <option value="nopass">{t('wifi_qr.none')}</option>
              </select>
            </div>
          </div>
          <div className="two-col grid-mobile-1">
            <div className="field">
              <label className="label">{t('wifi_qr.password')}</label>
              <input
                className="input"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                disabled={encryption === 'nopass'}
              />
            </div>
            <div className="field" style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: 10 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>
                <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
                {t('wifi_qr.hidden_network')}
              </label>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'url' && (
        <div className="card">
          <div className="card-title">{t('wifi_qr.url_details')}</div>
          <div className="field">
            <label className="label">{t('wifi_qr.url_label')}</label>
            <input
              className="input"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder={t('wifi_qr.url_placeholder')}
            />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('wifi_qr.presets_label')}:</span>
            {URL_PRESETS.map((p, idx) => (
              <button
                key={idx}
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, padding: '2px 8px' }}
                onClick={() => setUrlInput(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === 'text' && (
        <div className="card">
          <div className="card-title">{t('wifi_qr.text_details')}</div>
          <div className="field">
            <label className="label">{t('wifi_qr.text_label')}</label>
            <textarea
              className="input"
              rows={4}
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={t('wifi_qr.text_placeholder')}
              style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 13 }}
            />
          </div>
        </div>
      )}

      {/* Decode: Image Input */}
      {activeTab === 'decode' && (
        <div className="card">
          <div className="card-title">{t('wifi_qr.decode_details')}</div>
          <div
            onClick={() => decodeFileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDecodeDragOver(true); }}
            onDragLeave={() => setDecodeDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDecodeDragOver(false);
              const file = e.dataTransfer?.files?.[0];
              if (file) handleDecodeFile(file);
            }}
            style={{
              border: `2px dashed ${decodeDragOver ? 'var(--cyan)' : 'var(--border)'}`,
              borderRadius: 10,
              padding: '34px 20px',
              textAlign: 'center',
              cursor: 'pointer',
              background: decodeDragOver ? 'rgba(34, 211, 238, 0.06)' : 'transparent',
              transition: 'border-color 0.15s, background 0.15s',
            }}
          >
            <div style={{ fontSize: 34, marginBottom: 10 }}>🖼️</div>
            <div style={{ fontSize: 14, color: 'var(--text)' }}>{t('wifi_qr.decode_dropzone')}</div>
            <div className="hint" style={{ marginTop: 6 }}>{t('wifi_qr.decode_drop_hint')}</div>
          </div>
          <input
            ref={decodeFileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleDecodeFile(file);
              e.target.value = '';
            }}
          />
          <div className="btn-row" style={{ marginTop: 14 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => decodeFileRef.current?.click()}>
              📂 {t('wifi_qr.decode_open_file')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={pasteFromClipboard}>
              📋 {t('wifi_qr.decode_paste_clipboard')}
            </button>
            {(decodeResult || decodeError || decodePreviewUrl) && (
              <button className="btn btn-ghost btn-sm" onClick={clearDecode}>
                {t('common.clear')}
              </button>
            )}
          </div>
          {decodePreviewUrl && (
            <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
              <img
                src={decodePreviewUrl}
                alt=""
                style={{ maxWidth: 260, maxHeight: 260, borderRadius: 8, border: '1px solid var(--border)' }}
              />
            </div>
          )}
          {decodeDecoding && <div className="hint" style={{ marginTop: 10 }}>{t('wifi_qr.decode_decoding')}</div>}
          {decodeError && <div className="err" style={{ marginTop: 12 }}>{decodeError}</div>}
        </div>
      )}

      {/* Decode: Result */}
      {activeTab === 'decode' && decodeResult && (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            {t('wifi_qr.decode_result_title')}
            <span className={`badge ${payloadTypeInfo.cls}`}>{t(payloadTypeInfo.key)}</span>
          </div>
          <div
            style={{
              padding: '10px 12px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              fontFamily: 'var(--mono)',
              fontSize: 12,
              color: 'var(--cyan)',
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
              maxHeight: 220,
              overflowY: 'auto',
            }}
          >
            {decodeResult.text}
          </div>
          <div style={{ marginTop: 10 }}>
            <CopyBtn text={decodeResult.text} id="wifiqr-decode-payload" />
          </div>
          {payloadTypeInfo.wifi && (
            <div style={{ marginTop: 16 }}>
              <div className="card-title" style={{ fontSize: 14 }}>{t('wifi_qr.decode_wifi_fields')}</div>
              <div className="result-grid">
                <ResultItem label={t('wifi_qr.decode_ssid')} value={payloadTypeInfo.wifi.ssid || '—'} />
                <ResultItem label={t('wifi_qr.decode_encryption')} value={payloadTypeInfo.wifi.encryption || '—'} />
                <ResultItem label={t('wifi_qr.decode_password')} value={payloadTypeInfo.wifi.password || '—'} />
                <ResultItem
                  label={t('wifi_qr.decode_hidden')}
                  value={payloadTypeInfo.wifi.hidden ? t('wifi_qr.decode_hidden_yes') : t('wifi_qr.decode_hidden_no')}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {/* QR Code Options + Display (generator tabs only) */}
      {activeTab !== 'decode' && (
      <>
      <div className="card">
        <div className="card-title">{t('wifi_qr.qr_options')}</div>
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('wifi_qr.ecc_level')}</label>
            <select className="select" value={eccLevel} onChange={(e) => setEccLevel(e.target.value)}>
              <option value="L">L - 7% {t('wifi_qr.ecc_recovery')}</option>
              <option value="M">M - 15% {t('wifi_qr.ecc_recovery')}</option>
              <option value="Q">Q - 25% {t('wifi_qr.ecc_recovery')}</option>
              <option value="H">H - 30% {t('wifi_qr.ecc_recovery')}</option>
            </select>
          </div>
          <div className="field">
            <label className="label">{t('wifi_qr.qr_size')}</label>
            <select className="select" value={qrSize} onChange={(e) => setQrSize(Number(e.target.value))}>
              <option value={192}>192 x 192 px</option>
              <option value={256}>256 x 256 px</option>
              <option value={384}>384 x 384 px</option>
              <option value={512}>512 x 512 px</option>
            </select>
          </div>
        </div>
      </div>

      {/* QR Code Display & Export */}
      <div className="card fadein" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: 30 }}>
        <div className="card-title" style={{ alignSelf: 'flex-start', marginBottom: 0 }}>
          {t('wifi_qr.qr_title')}
        </div>
        <div
          style={{
            padding: 16,
            background: '#fff',
            borderRadius: 12,
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: Math.min(Number(qrSize) + 32, 320),
            minHeight: Math.min(Number(qrSize) + 32, 320),
          }}
        >
          {!payloadString ? (
            <div style={{ color: '#888', textAlign: 'center', fontSize: 14, maxWidth: 220 }}>
              {activeTab === 'wifi' && t('wifi_qr.ssid_hint')}
              {activeTab === 'url' && t('wifi_qr.url_hint')}
              {activeTab === 'text' && t('wifi_qr.text_hint')}
            </div>
          ) : null}
          <div ref={qrRef} />
        </div>

        {payloadString && (
          <div style={{ textAlign: 'center', maxWidth: '100%' }}>
            <div style={{ fontWeight: 600, fontSize: 15, color: 'var(--text)', wordBreak: 'break-all' }}>
              {getActiveTabTitle()}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
              {getActiveTabSubtitle()}
            </div>

            {/* Raw string representation */}
            <div
              style={{
                marginTop: 12,
                padding: '8px 12px',
                background: 'var(--bg)',
                border: '1px solid var(--border)',
                borderRadius: 6,
                fontFamily: 'var(--mono)',
                fontSize: 12,
                color: 'var(--cyan)',
                wordBreak: 'break-all',
                maxWidth: 500,
                textAlign: 'left',
              }}
            >
              <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', marginBottom: 4 }}>
                {t('wifi_qr.raw_payload')}:
              </div>
              {payloadString}
            </div>

            <div className="btn-row" style={{ justifyContent: 'center', marginTop: 16 }}>
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const canvas = qrRef.current?.querySelector('canvas');
                  if (canvas) {
                    const link = document.createElement('a');
                    link.download = getDownloadFilename();
                    link.href = canvas.toDataURL('image/png');
                    link.click();
                  } else {
                    const img = qrRef.current?.querySelector('img');
                    if (img && img.src) {
                      const link = document.createElement('a');
                      link.download = getDownloadFilename();
                      link.href = img.src;
                      link.click();
                    }
                  }
                }}
              >
                {t('wifi_qr.download_png')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={handleShare}>
                {t('common.share')}
              </button>
            </div>
          </div>
        )}
      </div>
      </>
      )}

      {/* Guide Card */}
      <div className="card">
        <div className="card-title">{t('wifi_qr.how_to_use')}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.6 }}>
          {activeTab === 'wifi' && (
            <>
              {t('wifi_qr.step1')}<br />
              {t('wifi_qr.step2')}<br />
              {t('wifi_qr.step3')}<br />
              {t('wifi_qr.step4')}<br /><br />
            </>
          )}
          {activeTab === 'url' && (
            <>
              {t('wifi_qr.url_step1')}<br />
              {t('wifi_qr.url_step2')}<br />
              {t('wifi_qr.url_step3')}<br /><br />
            </>
          )}
          {activeTab === 'text' && (
            <>
              {t('wifi_qr.text_step1')}<br />
              {t('wifi_qr.text_step2')}<br />
              {t('wifi_qr.text_step3')}<br /><br />
            </>
          )}
          {activeTab === 'decode' && (
            <>
              {t('wifi_qr.decode_step1')}<br />
              {t('wifi_qr.decode_step2')}<br />
              {t('wifi_qr.decode_step3')}<br />
              {t('wifi_qr.decode_step4')}<br /><br />
            </>
          )}
          <strong style={{ color: 'var(--cyan)' }}>{t('wifi_qr.security_note')}</strong>{' '}
          {activeTab === 'decode' ? t('wifi_qr.decode_security_desc') : t('wifi_qr.security_desc')}
        </div>
      </div>
    </div>
  );
}

// ─── QR Code Generator ──────────────────────────────────────
window.WifiQRCode = WifiQRCode;
