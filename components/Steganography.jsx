const { useState, useEffect, useCallback, useMemo, useRef } = React;

const _S_NK_MAGIC = [0x4E, 0x4B];
const _S_HEADER_LEN = 7; // "NK"(2) + flags(1) + length(4 BE)
const _S_NEK_MAGIC = new Uint8Array([0x4E, 0x45, 0x4B, 0x31]);
const _S_SALT_LEN = 16;
const _S_IV_LEN = 12;
// flag bits: bit0 = encrypted, bit1 = file payload
const _S_FLAG_ENC  = 0x01;
const _S_FLAG_FILE = 0x02;

// --- Crypto helpers ---
async function _s_deriveKey(password, salt) {
  const km = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
    km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']
  );
}

// Derives 16-byte seed for the pixel-order PRNG — different from AES key derivation
async function _s_derivePixelSeed(password, width, height) {
  const enc = new TextEncoder();
  // deterministic salt = "stego-pix" + W + H encoded as big-endian uint16
  const salt = new Uint8Array([
    ...enc.encode('stego-pix'),
    (width  >>> 8) & 0xFF, width  & 0xFF,
    (height >>> 8) & 0xFF, height & 0xFF,
  ]);
  const km = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 1000, hash: 'SHA-256' }, km, 128);
  return new Uint8Array(bits);
}

async function _s_aesEncrypt(key, plain) {
  const iv = crypto.getRandomValues(new Uint8Array(_S_IV_LEN));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plain));
  return { iv, cipher };
}
async function _s_aesDecrypt(key, iv, cipher) {
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher));
}
function _s_buildNEK(salt, iv, cipher) {
  const out = new Uint8Array(4 + 1 + _S_SALT_LEN + _S_IV_LEN + cipher.length);
  let o = 0;
  out.set(_S_NEK_MAGIC, o); o += 4;
  out[o++] = 0x01;
  out.set(salt, o); o += _S_SALT_LEN;
  out.set(iv, o); o += _S_IV_LEN;
  out.set(cipher, o);
  return out;
}
function _s_parseNEK(bytes) {
  if (bytes[0] !== 0x4E || bytes[1] !== 0x45 || bytes[2] !== 0x4B || bytes[3] !== 0x31)
    throw new Error('bad_magic');
  let o = 5;
  const salt   = bytes.slice(o, o + _S_SALT_LEN); o += _S_SALT_LEN;
  const iv     = bytes.slice(o, o + _S_IV_LEN);   o += _S_IV_LEN;
  const cipher = bytes.slice(o);
  return { salt, iv, cipher };
}

// --- PRNG: xorshift128 seeded from 16 bytes ---
function _s_makeRng(seed16) {
  let x = ((seed16[0]<<24)|(seed16[1]<<16)|(seed16[2]<<8)|seed16[3]) >>> 0;
  let y = ((seed16[4]<<24)|(seed16[5]<<16)|(seed16[6]<<8)|seed16[7]) >>> 0;
  let z = ((seed16[8]<<24)|(seed16[9]<<16)|(seed16[10]<<8)|seed16[11]) >>> 0;
  let w = ((seed16[12]<<24)|(seed16[13]<<16)|(seed16[14]<<8)|seed16[15]) >>> 0;
  if (!x && !y && !z && !w) x = 1;
  return function() {
    const t = (x ^ (x << 11)) >>> 0;
    x = y; y = z; z = w;
    w = ((w ^ (w >>> 19)) ^ (t ^ (t >>> 8))) >>> 0;
    return w;
  };
}

// Streaming partial Fisher-Yates: lazily yields shuffled indices from [0..total-1]
// Uses a sparse Map so only consumed entries incur memory.
function _s_makeStreamShuffle(total, rng) {
  const mapped = new Map();
  let cursor = 0;
  return function nextSlot() {
    if (cursor >= total) throw new Error('shuffle_exhausted');
    const rem = total - cursor;
    const j = cursor + (rng() % rem);
    const slot = mapped.has(j) ? mapped.get(j) : j;
    mapped.set(j, mapped.has(cursor) ? mapped.get(cursor) : cursor);
    cursor++;
    return slot;
  };
}

// --- Unified stego read/write ---
// getSlot(): when provided, returns next channel index (shuffled mode); when absent, uses sequential bitIdx
// Force alpha = 255 on every pixel. Browsers premultiply alpha when canvas
// stores pixels, which corrupts RGB LSBs on PNG round-trip if any pixel is
// not fully opaque. Stripping alpha keeps the carrier byte-stable.
function _s_forceOpaque(d) {
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
}

function _s_writeStego(imageData, payload) {
  const d = new Uint8ClampedArray(imageData.data);
  const cap = imageData.width * imageData.height * 3;
  if (payload.length * 8 > cap) throw new Error('capacity_exceeded');
  _s_forceOpaque(d);
  for (let b = 0; b < payload.length; b++) {
    for (let k = 7; k >= 0; k--) {
      const bit = (payload[b] >> k) & 1;
      const chanIdx = b * 8 + (7 - k);
      const pix = Math.floor(chanIdx / 3), ch = chanIdx % 3;
      d[pix * 4 + ch] = (d[pix * 4 + ch] & 0xFE) | bit;
    }
  }
  return new ImageData(d, imageData.width, imageData.height);
}

function _s_writeStegoShuffled(imageData, payload, nextSlot) {
  const d = new Uint8ClampedArray(imageData.data);
  _s_forceOpaque(d);
  for (let b = 0; b < payload.length; b++) {
    for (let k = 7; k >= 0; k--) {
      const bit = (payload[b] >> k) & 1;
      const chanIdx = nextSlot();
      const pix = Math.floor(chanIdx / 3), ch = chanIdx % 3;
      d[pix * 4 + ch] = (d[pix * 4 + ch] & 0xFE) | bit;
    }
  }
  return new ImageData(d, imageData.width, imageData.height);
}

// Returns { flags, payload } — nextSlot drives sequential or shuffled read
function _s_readStego(imageData, nextSlot) {
  const d = imageData.data;
  const W = imageData.width, H = imageData.height;
  let seqIdx = 0;

  function readBit() {
    const chanIdx = nextSlot ? nextSlot() : seqIdx++;
    const pix = Math.floor(chanIdx / 3), ch = chanIdx % 3;
    return d[pix * 4 + ch] & 1;
  }
  function readBytes(count) {
    const out = new Uint8Array(count);
    for (let b = 0; b < count; b++) {
      let byte = 0;
      for (let k = 0; k < 8; k++) byte = (byte << 1) | readBit();
      out[b] = byte;
    }
    return out;
  }

  if (W * H * 3 < _S_HEADER_LEN * 8) throw new Error('image_too_small');
  const hdr = readBytes(_S_HEADER_LEN);
  if (hdr[0] !== _S_NK_MAGIC[0] || hdr[1] !== _S_NK_MAGIC[1]) throw new Error('no_stego');
  const flags  = hdr[2];
  const length = (((hdr[3] << 24) | (hdr[4] << 16) | (hdr[5] << 8) | hdr[6]) >>> 0);
  const maxPayload = Math.floor(W * H * 3 / 8) - _S_HEADER_LEN;
  if (length === 0 || length > maxPayload) throw new Error('length_corrupt');
  return { flags, payload: readBytes(length) };
}

// --- File payload format ---
// [1B count N]([1B name_len][name bytes][4B BE size][file bytes])*
function _s_buildFilePayload(files) {
  const enc = new TextEncoder();
  let total = 1;
  for (const f of files) total += 1 + enc.encode(f.name).length + 4 + f.bytes.length;
  const out = new Uint8Array(total);
  let o = 0;
  out[o++] = files.length & 0xFF;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    out[o++] = nameBytes.length & 0xFF;
    out.set(nameBytes, o); o += nameBytes.length;
    out[o++] = (f.bytes.length >>> 24) & 0xFF;
    out[o++] = (f.bytes.length >>> 16) & 0xFF;
    out[o++] = (f.bytes.length >>>  8) & 0xFF;
    out[o++] =  f.bytes.length         & 0xFF;
    out.set(f.bytes, o); o += f.bytes.length;
  }
  return out;
}

function _s_parseFilePayload(bytes) {
  let o = 0;
  const count = bytes[o++];
  const files = [];
  for (let i = 0; i < count; i++) {
    const nameLen = bytes[o++];
    const name = new TextDecoder().decode(bytes.slice(o, o + nameLen)); o += nameLen;
    const size = (((bytes[o] << 24) | (bytes[o+1] << 16) | (bytes[o+2] << 8) | bytes[o+3]) >>> 0); o += 4;
    files.push({ name, bytes: bytes.slice(o, o + size) }); o += size;
  }
  return files;
}

function _s_downloadBlob(bytes, name, type = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ZIP builder is shared — see shared.jsx / window.buildZip

// --- Component ---
function Steganography({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistentState('stego:tab', initialData?.tab ?? 'encode');
  const skipNavReport = useRef(false);

  // Encode state
  const [payloadMode, setPayloadMode] = usePersistentState('stego:payloadMode', 'message');
  const [message,     setMessage]     = usePersistentState('stego:message', '');
  const [payloadFiles, setPayloadFiles] = useState([]); // [{ name, bytes }]
  const [passphrase,  setPassphrase]  = useState('');
  const [showPass,    setShowPass]    = useState(false);
  const [carrier,     setCarrier]     = useState(null); // { file, img }
  const [capacity,    setCapacity]    = useState(0);
  const [encErr,      setEncErr]      = useState('');
  const [encoding,    setEncoding]    = useState(false);

  // Decode state
  const [decodeFile,   setDecodeFile]   = useState(null);
  const [decodeImg,    setDecodeImg]    = useState(null);
  const [decodePass,   setDecodePass]   = useState('');
  const [showDecPass,  setShowDecPass]  = useState(false);
  const [needsPass,    setNeedsPass]    = useState(false);
  const [shuffledMode, setShuffledMode] = useState(false); // passphrase needed for pixel order
  const [pendingPay,   setPendingPay]   = useState(null);  // NEK1 blob for sequential-encrypted legacy
  const [pendingFlags, setPendingFlags] = useState(0);
  const [decodedMsg,   setDecodedMsg]   = useState('');
  const [decodedFiles, setDecodedFiles] = useState(null);  // [{ name, bytes }] | null
  const [decodeErr,    setDecodeErr]    = useState('');
  const [decoding,     setDecoding]     = useState(false);

  const carrierRef = useRef(null);
  const payloadRef = useRef(null);
  const decodeRef  = useRef(null);
  const canvasRef  = useRef(null);

  const cryptoOk = !!(window.crypto && window.crypto.subtle);

  // apply-down: sidebar/Ctrl+K/Help nav → inner tab
  useEffect(() => {
    if (!initialData?.tab || initialData.tab === tab) return;
    skipNavReport.current = true;
    setTab(initialData.tab);
  }, [initialData]);

  // report-up: tab change → sidebar highlight
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ tab });
  }, [tab]);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({ tool: 'stego', tab });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [tab, onShare]);

  const getImageData = useCallback((img) => {
    const canvas = canvasRef.current;
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    return { canvas, ctx, imageData: ctx.getImageData(0, 0, img.width, img.height) };
  }, []);

  const loadImg = useCallback((file, onLoaded) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { onLoaded(img); URL.revokeObjectURL(url); };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  }, []);

  const handleCarrierLoad = useCallback((file) => {
    if (!file) return;
    setEncErr('');
    loadImg(file, (img) => {
      setCarrier({ file, img });
      setCapacity(Math.floor(img.width * img.height * 3 / 8) - _S_HEADER_LEN);
    });
  }, [loadImg]);

  const handlePayloadFilesLoad = useCallback((fileList) => {
    if (!fileList.length) return;
    setEncErr('');
    const readers = fileList.map(f => new Promise(resolve => {
      const fr = new FileReader();
      fr.onload = (ev) => resolve({ name: f.name, bytes: new Uint8Array(ev.target.result) });
      fr.readAsArrayBuffer(f);
    }));
    Promise.all(readers).then(incoming => setPayloadFiles(prev => [...prev, ...incoming]));
  }, []);

  // Capacity math
  const msgByteLen = useMemo(() => new TextEncoder().encode(message).length, [message]);
  const filePayloadSize = useMemo(() => {
    if (!payloadFiles.length) return 0;
    const enc = new TextEncoder();
    return 1 + payloadFiles.reduce((sum, f) => sum + 1 + enc.encode(f.name).length + 4 + f.bytes.length, 0);
  }, [payloadFiles]);

  const encByteLen = (payloadMode === 'message' ? msgByteLen : filePayloadSize) + (passphrase ? 49 : 0);
  const overCapacity = capacity > 0 && encByteLen > 0 && encByteLen > capacity;

  // Reset decode result when loading a new image
  const resetDecodeState = useCallback(() => {
    setDecodeErr(''); setDecodedMsg(''); setDecodedFiles(null);
    setNeedsPass(false); setShuffledMode(false);
    setPendingPay(null); setPendingFlags(0); setDecodePass('');
  }, []);

  const handleFinishedDecode = useCallback((flags, innerBytes) => {
    if (flags & _S_FLAG_FILE) {
      const files = _s_parseFilePayload(innerBytes);
      // Single file: auto-download immediately (no button-click required)
      if (files.length === 1) _s_downloadBlob(files[0].bytes, files[0].name);
      setDecodedFiles(files);
    } else {
      setDecodedMsg(new TextDecoder().decode(innerBytes));
    }
  }, []);

  const runDecode = useCallback(async (img, pass) => {
    setDecoding(true);
    setDecodeErr(''); setDecodedMsg(''); setDecodedFiles(null);
    setNeedsPass(false); setShuffledMode(false); setPendingPay(null); setPendingFlags(0);
    try {
      const { imageData } = getImageData(img);
      const { flags, payload } = _s_readStego(imageData, null);

      if (flags & _S_FLAG_ENC) {
        // Sequential encrypted — legacy path (no pixel shuffling): need passphrase for AES
        if (!pass) {
          setNeedsPass(true); setPendingPay(payload); setPendingFlags(flags);
          setDecoding(false); return;
        }
        const { salt, iv, cipher } = _s_parseNEK(payload);
        const key   = await _s_deriveKey(pass, salt);
        const plain = await _s_aesDecrypt(key, iv, cipher);
        handleFinishedDecode(flags, plain);
      } else {
        handleFinishedDecode(flags, payload);
      }
    } catch (ex) {
      if (ex.message === 'no_stego' || ex.message === 'length_corrupt') {
        // Show the real error, but also reveal the passphrase prompt so users
        // who encoded with a passphrase (which produces a scrambled pixel order
        // that fails sequential scan) can still decode.
        setDecodeErr(t('stego.err_no_stego'));
        setShuffledMode(true); setNeedsPass(true);
      } else {
        const msg = ex.message === 'image_too_small' ? t('stego.err_image_too_small')
          : t('stego.err_decode') + ': ' + ex.message;
        setDecodeErr(msg);
      }
    } finally { setDecoding(false); }
  }, [getImageData, handleFinishedDecode, t]);

  const handleDecodeLoad = useCallback((file) => {
    if (!file) return;
    setDecodeFile(file); resetDecodeState();
    loadImg(file, (img) => { setDecodeImg(img); runDecode(img, ''); });
  }, [loadImg, resetDecodeState, runDecode]);

  const handleDecryptPayload = async () => {
    if (!decodePass) return;
    setDecoding(true); setDecodeErr('');
    try {
      let flags, innerBytes;

      if (shuffledMode) {
        // Derive pixel order from passphrase + image dimensions, then decode shuffled
        const { imageData } = getImageData(decodeImg);
        const seed    = await _s_derivePixelSeed(decodePass, decodeImg.width, decodeImg.height);
        const rng     = _s_makeRng(seed);
        const total   = decodeImg.width * decodeImg.height * 3;
        const nextSlot = _s_makeStreamShuffle(total, rng);
        const result  = _s_readStego(imageData, nextSlot);
        flags = result.flags;
        if (!(flags & _S_FLAG_ENC)) throw new Error('unexpected_unencrypted');
        const { salt, iv, cipher } = _s_parseNEK(result.payload);
        const key = await _s_deriveKey(decodePass, salt);
        innerBytes = await _s_aesDecrypt(key, iv, cipher);
      } else {
        // Legacy path: pendingPay is the raw NEK1 container from sequential read
        flags = pendingFlags;
        const { salt, iv, cipher } = _s_parseNEK(pendingPay);
        const key = await _s_deriveKey(decodePass, salt);
        innerBytes = await _s_aesDecrypt(key, iv, cipher);
      }

      setNeedsPass(false); setShuffledMode(false);
      handleFinishedDecode(flags, innerBytes);
    } catch (ex) {
      const msg = ex.message === 'no_stego'    ? t('stego.err_no_stego')
        : ex.name === 'OperationError'          ? t('stego.err_wrong_passphrase')
        : t('stego.err_decode') + ': ' + ex.message;
      setDecodeErr(msg);
    } finally { setDecoding(false); }
  };

  const handleEncode = async () => {
    const isFile = payloadMode === 'file';
    const hasPayload = isFile ? payloadFiles.length > 0 : !!message;
    if (!carrier || !hasPayload) {
      setEncErr(isFile ? t('stego.err_empty_encode_file') : t('stego.err_empty_encode'));
      return;
    }
    if (passphrase && !cryptoOk) { setEncErr(t('aescrypt.err_insecure')); return; }
    setEncoding(true); setEncErr('');
    try {
      // Build inner bytes (text or multi-file)
      let innerBytes;
      if (isFile) {
        innerBytes = _s_buildFilePayload(payloadFiles);
      } else {
        innerBytes = new TextEncoder().encode(message);
      }

      // Optionally wrap in AES
      let flags = 0;
      let nekPayload;
      if (passphrase) {
        flags |= _S_FLAG_ENC;
        const salt = crypto.getRandomValues(new Uint8Array(_S_SALT_LEN));
        const key  = await _s_deriveKey(passphrase, salt);
        const { iv, cipher } = await _s_aesEncrypt(key, innerBytes);
        nekPayload = _s_buildNEK(salt, iv, cipher);
      } else {
        nekPayload = innerBytes;
      }
      if (isFile) flags |= _S_FLAG_FILE;

      // Build full stego payload: NK header + (NEK1 container or raw bytes)
      const fullPayload = new Uint8Array(_S_HEADER_LEN + nekPayload.length);
      fullPayload[0] = 0x4E; fullPayload[1] = 0x4B;
      fullPayload[2] = flags;
      fullPayload[3] = (nekPayload.length >>> 24) & 0xFF;
      fullPayload[4] = (nekPayload.length >>> 16) & 0xFF;
      fullPayload[5] = (nekPayload.length >>>  8) & 0xFF;
      fullPayload[6] =  nekPayload.length         & 0xFF;
      fullPayload.set(nekPayload, _S_HEADER_LEN);

      const { canvas, ctx, imageData } = getImageData(carrier.img);
      const total = carrier.img.width * carrier.img.height * 3;
      if (fullPayload.length * 8 > total) throw new Error('capacity_exceeded');

      let encoded;
      if (passphrase) {
        // Shuffled pixel order keyed by passphrase
        const seed    = await _s_derivePixelSeed(passphrase, carrier.img.width, carrier.img.height);
        const rng     = _s_makeRng(seed);
        const nextSlot = _s_makeStreamShuffle(total, rng);
        encoded = _s_writeStegoShuffled(imageData, fullPayload, nextSlot);
      } else {
        encoded = _s_writeStego(imageData, fullPayload);
      }

      ctx.putImageData(encoded, 0, 0);

      canvas.toBlob((blob) => {
        const baseName = carrier.file.name.replace(/\.[^.]+$/, '');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = 'stego_' + baseName + '.png';
        document.body.appendChild(a); a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setEncoding(false);
      }, 'image/png');
    } catch (ex) {
      console.error('[stego] encode failed:', ex);
      const msg = ex.message === 'capacity_exceeded' ? t('stego.err_capacity')
        : t('stego.err_encode') + ': ' + ex.message;
      setEncErr(msg);
      setEncoding(false);
    }
  };

  // Renders a dropzone whose body either shows the hint (when empty) or the children (when filled).
  const dropArea = ({ onDropFiles, inputRef, hint, filled, children, multi }) => (
    <div
      onDragOver={e => e.preventDefault()}
      onDrop={e => {
        e.preventDefault();
        const files = e.dataTransfer?.files;
        if (!files?.length) return;
        onDropFiles(multi ? Array.from(files) : files[0]);
      }}
      onClick={e => {
        // Don't re-open the file dialog when clicking a child button (e.g. remove)
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

  const passPhraseField = (value, onChange, show, setShow, label, placeholder, disabled) => (
    <div className="field">
      <label className="label">
        {label}{' '}
        <span style={{ fontWeight: 400, opacity: 0.65 }}>{t('stego.optional')}</span>
      </label>
      {!cryptoOk && <div className="err" style={{ marginBottom: '0.5rem' }}>{t('aescrypt.err_insecure')}</div>}
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <input className="input" type={show ? 'text' : 'password'}
          placeholder={placeholder} value={value} onChange={onChange}
          disabled={disabled} style={{ flex: 1 }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setShow(v => !v)}>
          {show ? t('aescrypt.hide_pw') : t('aescrypt.show_pw')}
        </button>
      </div>
    </div>
  );

  const removePayloadFile = (idx) => setPayloadFiles(prev => prev.filter((_, i) => i !== idx));

  const disabledReason = !carrier
    ? t('stego.disabled_no_carrier')
    : (payloadMode === 'message' ? !message : !payloadFiles.length)
      ? (payloadMode === 'message' ? t('stego.disabled_no_message') : t('stego.disabled_no_files'))
      : overCapacity ? t('stego.err_capacity')
      : '';

  const renderEncode = () => (
    <div>
      {/* Carrier image */}
      <div className="field">
        <label className="label">{t('stego.carrier_label')}</label>
        {dropArea({
          onDropFiles: handleCarrierLoad, inputRef: carrierRef,
          hint: t('stego.carrier_hint'), filled: !!carrier, multi: false,
          children: carrier && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>{carrier.file.name}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                {carrier.img.width}×{carrier.img.height} — {t('stego.capacity_label')}: {capacity.toLocaleString()} {t('stego.bytes')}
              </span>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => { setCarrier(null); setCapacity(0); if (carrierRef.current) carrierRef.current.value = ''; }}>
                {t('stego.btn_change')}
              </button>
            </div>
          ),
        })}
        <input ref={carrierRef} type="file" accept="image/png,image/bmp" style={{ display: 'none' }}
          onChange={e => { handleCarrierLoad(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {/* Payload mode toggle */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
        {['message', 'file'].map(m => (
          <button key={m} className={`btn btn-sm ${payloadMode === m ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => { setPayloadMode(m); setEncErr(''); }}>
            {t('stego.tab_' + m)}
          </button>
        ))}
      </div>

      {payloadMode === 'message' ? (
        <div className="field">
          <label className="label">{t('stego.message_label')}</label>
          <textarea className="input" rows={5} placeholder={t('stego.message_placeholder')}
            value={message} onChange={e => { setMessage(e.target.value); setEncErr(''); }} />
          {carrier && message && (
            <span className="hint" style={{ color: overCapacity ? 'var(--danger)' : 'var(--text-secondary)' }}>
              {encByteLen.toLocaleString()} / {capacity.toLocaleString()} {t('stego.bytes')}
              {passphrase ? ' ' + t('stego.encrypted_note') : ''}
            </span>
          )}
        </div>
      ) : (
        <div className="field">
          <label className="label">{t('stego.payload_file_label')}</label>
          {dropArea({
            onDropFiles: handlePayloadFilesLoad, inputRef: payloadRef,
            hint: t('stego.payload_file_hint'), filled: payloadFiles.length > 0, multi: true,
            children: (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                {payloadFiles.map((f, i) => (
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
                      onClick={() => removePayloadFile(i)}
                      style={{ padding: '0.15rem 0.5rem' }}>×</button>
                  </div>
                ))}
                <div style={{
                  fontSize: '0.8rem', color: 'var(--text-secondary)',
                  textAlign: 'center', marginTop: '0.25rem',
                }}>{t('stego.payload_file_add_more')}</div>
              </div>
            ),
          })}
          <input ref={payloadRef} type="file" multiple style={{ display: 'none' }}
            onChange={e => { handlePayloadFilesLoad(Array.from(e.target.files)); e.target.value = ''; }} />
          {payloadFiles.length > 0 && carrier && (
            <span className="hint" style={{ display: 'block', color: overCapacity ? 'var(--danger)' : 'var(--text-secondary)' }}>
              {encByteLen.toLocaleString()} / {capacity.toLocaleString()} {t('stego.bytes')}
              {passphrase ? ' ' + t('stego.encrypted_note') : ''}
            </span>
          )}
        </div>
      )}

      {passPhraseField(
        passphrase, e => setPassphrase(e.target.value),
        showPass, setShowPass,
        t('stego.passphrase_label'), t('stego.passphrase_placeholder'), !cryptoOk
      )}

      <div className="btn-row">
        <button className="btn btn-primary" onClick={handleEncode}
          disabled={encoding || !!disabledReason}>
          {encoding ? t('stego.encoding') : t('stego.btn_encode')}
        </button>
        {disabledReason && !encoding && (
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', alignSelf: 'center', marginLeft: '0.5rem' }}>
            {disabledReason}
          </span>
        )}
      </div>
      {encErr && <div className="err" style={{ marginTop: '0.5rem' }}>{encErr}</div>}
    </div>
  );

  const downloadAllAsZip = () => {
    if (!decodedFiles?.length) return;
    const zipBytes = buildZip(decodedFiles);
    _s_downloadBlob(zipBytes, 'extracted.zip', 'application/zip');
  };

  const renderDecode = () => (
    <div>
      <div className="field">
        <label className="label">{t('stego.decode_image_label')}</label>
        {dropArea({
          onDropFiles: handleDecodeLoad, inputRef: decodeRef,
          hint: t('stego.decode_hint'), filled: !!decodeFile, multi: false,
          children: decodeFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-primary)', fontWeight: 500 }}>{decodeFile.name}</span>
              <span style={{ flex: 1 }} />
              <button type="button" className="btn btn-ghost btn-sm"
                onClick={() => { setDecodeFile(null); setDecodeImg(null); resetDecodeState(); if (decodeRef.current) decodeRef.current.value = ''; }}>
                {t('stego.btn_change')}
              </button>
            </div>
          ),
        })}
        <input ref={decodeRef} type="file" accept="image/png" style={{ display: 'none' }}
          onChange={e => { handleDecodeLoad(e.target.files?.[0]); e.target.value = ''; }} />
      </div>

      {decoding && (
        <div style={{ color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>{t('stego.decoding')}</div>
      )}

      {needsPass && (
        <div>
          {shuffledMode && (
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              {t('stego.shuffled_hint')}
            </p>
          )}
          <div className="field">
            <label className="label">{t('stego.decode_passphrase_label')}</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input className="input" type={showDecPass ? 'text' : 'password'}
                placeholder={t('stego.passphrase_placeholder')}
                value={decodePass} onChange={e => { setDecodePass(e.target.value); setDecodeErr(''); }}
                style={{ flex: 1 }} />
              <button className="btn btn-ghost btn-sm" onClick={() => setShowDecPass(v => !v)}>
                {showDecPass ? t('aescrypt.hide_pw') : t('aescrypt.show_pw')}
              </button>
            </div>
          </div>
          <div className="btn-row">
            <button className="btn btn-primary" onClick={handleDecryptPayload} disabled={decoding || !decodePass}>
              {decoding ? t('stego.decrypting') : t('stego.btn_decrypt_msg')}
            </button>
          </div>
        </div>
      )}

      {decodeErr && <div className="err" style={{ marginTop: '0.5rem' }}>{decodeErr}</div>}

      {decodedMsg && (
        <div className="field" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
            <label className="label" style={{ margin: 0 }}>{t('stego.decoded_label')}</label>
            <CopyBtn text={decodedMsg} label="common.copy" id="stego-decoded" />
          </div>
          <textarea className="input" rows={5} value={decodedMsg} readOnly />
        </div>
      )}

      {decodedFiles && decodedFiles.length > 0 && (
        <div className="field" style={{ marginTop: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <label className="label" style={{ margin: 0 }}>{t('stego.extracted_file')}</label>
            {decodedFiles.length > 1 && (
              <button className="btn btn-sm btn-primary" onClick={downloadAllAsZip}>
                {t('stego.btn_download_all_zip')}
              </button>
            )}
          </div>
          {decodedFiles.map((f, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: '0.75rem',
              padding: '0.5rem 0', borderBottom: i < decodedFiles.length - 1 ? '1px solid var(--border)' : 'none',
            }}>
              <span style={{ flex: 1, fontSize: '0.875rem', color: 'var(--text-primary)', wordBreak: 'break-all' }}>{f.name}</span>
              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>
                {f.bytes.length} {t('stego.bytes')}
              </span>
              <button className="btn btn-sm btn-ghost" onClick={() => _s_downloadBlob(f.bytes, f.name)}>
                {t('stego.btn_download_file')}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <div className="fadein">
      <canvas ref={canvasRef} style={{ display: 'none' }} />
      <div className="card">
        <div className="card-title">{t('tools.stego.title')}</div>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem', fontSize: '0.875rem' }}>
          {t('stego.subtitle')}
        </p>

        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1.25rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.5rem' }}>
          {['encode', 'decode'].map(tb => (
            <button key={tb} className={`btn btn-sm ${tab === tb ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(tb)}>
              {t('stego.tab_' + tb)}
            </button>
          ))}
        </div>

        {tab === 'encode' ? renderEncode() : renderDecode()}
      </div>
    </div>
  );
}

window.Steganography = Steganography;
