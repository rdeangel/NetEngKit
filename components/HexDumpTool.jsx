const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ASCII control character names — technical literals, not i18n strings
const ASCII_CTRL_NAMES = [
  'NUL','SOH','STX','ETX','EOT','ENQ','ACK','BEL',
  'BS', 'HT', 'LF', 'VT', 'FF', 'CR', 'SO', 'SI',
  'DLE','DC1','DC2','DC3','DC4','NAK','SYN','ETB',
  'CAN','EM', 'SUB','ESC','FS', 'GS', 'RS', 'US'
];

const C_ESCAPES = {
  0: '\\0', 7: '\\a', 8: '\\b', 9: '\\t', 10: '\\n',
  11: '\\v', 12: '\\f', 13: '\\r', 27: '\\e', 34: '\\"',
  39: "\\'", 92: '\\\\'
};

const HTML_ENTITIES = {
  34: '&quot;', 38: '&amp;', 39: '&apos;', 60: '&lt;', 62: '&gt;'
};

// ─── Hex parsing helpers ─────────────────────────────────────────────────────

function detectHexFormat(raw) {
  const s = raw.trim();
  if (/^[0-9a-fA-F]{8}:\s/.test(s)) return 'xxd';
  if (/^[0-9a-fA-F]{6}\s+[0-9a-fA-F]{4}/.test(s)) return 'od';
  if (/\\x[0-9a-fA-F]{2}/.test(s)) return 'cstr';
  if (/0x[0-9a-fA-F]{2},?\s/.test(s)) return 'carray';
  if (/^([0-9a-fA-F]{2}:)+[0-9a-fA-F]{2}$/.test(s)) return 'colon';
  if (/^([0-9a-fA-F]{2}\s+)*[0-9a-fA-F]{2}\s*$/.test(s)) return 'raw_spaced';
  if (/^[0-9a-fA-F]+$/.test(s)) return 'raw';
  return 'unknown';
}

function parseHexToBytes(raw) {
  const s = raw.trim();
  if (!s) return { bytes: null, fmt: 'unknown' };
  const fmt = detectHexFormat(s);
  let hexStr = '';

  if (fmt === 'xxd') {
    // 00000000: 4865 6c6c 6f20 576f  Hello Wo
    // strip offset and optional ASCII sidebar
    const lines = s.split('\n');
    for (const line of lines) {
      const m = line.match(/^[0-9a-fA-F]+:\s+((?:[0-9a-fA-F]{2,4}\s*)+)/);
      if (m) hexStr += m[1].replace(/\s/g, '');
    }
  } else if (fmt === 'od') {
    const lines = s.split('\n');
    for (const line of lines) {
      const m = line.match(/^[0-9a-fA-F]+\s+(.*)/);
      if (m) hexStr += m[1].replace(/\s/g, '');
    }
  } else if (fmt === 'cstr') {
    const matches = s.match(/\\x([0-9a-fA-F]{2})/g) || [];
    hexStr = matches.map(m => m.slice(2)).join('');
  } else if (fmt === 'carray') {
    const matches = s.match(/0x([0-9a-fA-F]{2})/gi) || [];
    hexStr = matches.map(m => m.slice(2)).join('');
  } else if (fmt === 'colon') {
    hexStr = s.replace(/:/g, '');
  } else if (fmt === 'raw_spaced') {
    hexStr = s.replace(/\s/g, '');
  } else if (fmt === 'raw') {
    hexStr = s;
  } else {
    return { bytes: null, fmt };
  }

  if (hexStr.length % 2 !== 0) hexStr = '0' + hexStr;
  if (!/^[0-9a-fA-F]*$/.test(hexStr)) return { bytes: null, fmt };

  const bytes = [];
  for (let i = 0; i < hexStr.length; i += 2) {
    bytes.push(parseInt(hexStr.slice(i, i + 2), 16));
  }
  return { bytes, fmt };
}

function bytesToText(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes));
  } catch {
    return bytes.map(b => b >= 32 && b <= 126 ? String.fromCharCode(b) : '.').join('');
  }
}

function hasUTF8BOM(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
}

// ─── Text → Hex conversion ───────────────────────────────────────────────────

function textToBytes(text) {
  return Array.from(new TextEncoder().encode(text));
}

function groupBytes(bytes, groupSize, littleEndian) {
  if (groupSize <= 1) return bytes.map(b => b.toString(16).padStart(2, '0'));
  const result = [];
  for (let i = 0; i < bytes.length; i += groupSize) {
    const chunk = bytes.slice(i, i + groupSize);
    const group = littleEndian ? [...chunk].reverse() : chunk;
    result.push(group.map(b => b.toString(16).padStart(2, '0')).join(''));
  }
  return result;
}

function formatHexOutput(bytes, fmt, groupSize, littleEndian) {
  if (!bytes || bytes.length === 0) return '';
  const gs = parseInt(groupSize) || 2;

  if (fmt === 'xxd') {
    const lines = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const offset = i.toString(16).padStart(8, '0');
      const groups = [];
      for (let j = 0; j < chunk.length; j += gs) {
        const g = chunk.slice(j, j + gs);
        const grp = littleEndian ? [...g].reverse() : g;
        groups.push(grp.map(b => b.toString(16).padStart(2, '0')).join(''));
      }
      const hexPart = groups.join(' ').padEnd(Math.ceil(16 / gs) * (gs * 2 + 1) - 1);
      const ascii = chunk.map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
      lines.push(`${offset}: ${hexPart}  ${ascii}`);
    }
    return lines.join('\n');
  }

  if (fmt === 'hexdump') {
    const lines = [];
    for (let i = 0; i < bytes.length; i += 16) {
      const chunk = bytes.slice(i, i + 16);
      const offset = i.toString(16).padStart(8, '0');
      const groups = [];
      for (let j = 0; j < chunk.length; j += gs) {
        const g = chunk.slice(j, j + gs);
        const grp = littleEndian ? [...g].reverse() : g;
        groups.push(grp.map(b => b.toString(16).padStart(2, '0')).join(''));
      }
      const hex1 = groups.slice(0, Math.ceil(8 / gs)).join(' ');
      const hex2 = groups.slice(Math.ceil(8 / gs)).join(' ');
      const hexPart = (hex1 + '  ' + hex2).padEnd(50);
      const ascii = chunk.map(b => (b >= 32 && b <= 126) ? String.fromCharCode(b) : '.').join('');
      lines.push(`${offset}  ${hexPart}  |${ascii}|`);
    }
    return lines.join('\n');
  }

  if (fmt === 'raw') {
    return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  if (fmt === 'raw_spaced') {
    const groups = groupBytes(bytes, gs, littleEndian);
    return groups.join(' ');
  }

  if (fmt === 'carray') {
    const hex = bytes.map(b => '0x' + b.toString(16).padStart(2, '0'));
    return 'uint8_t data[] = {\n  ' + hex.join(', ') + '\n};';
  }

  if (fmt === 'cstring') {
    const esc = bytes.map(b => '\\x' + b.toString(16).padStart(2, '0')).join('');
    return `"${esc}"`;
  }

  if (fmt === 'python') {
    const esc = bytes.map(b => '\\x' + b.toString(16).padStart(2, '0')).join('');
    return `b'${esc}'`;
  }

  if (fmt === 'colon') {
    return bytes.map(b => b.toString(16).padStart(2, '0')).join(':');
  }

  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── Byte Inspector helpers ──────────────────────────────────────────────────

function parseByteInput(raw) {
  const s = raw.trim();
  if (!s) return null;
  // Binary
  if (/^[01]{8}$/.test(s)) return parseInt(s, 2);
  // 0x hex
  if (/^0x[0-9a-fA-F]{1,2}$/i.test(s)) {
    const v = parseInt(s, 16);
    return (v >= 0 && v <= 255) ? v : null;
  }
  // bare 2-digit hex
  if (/^[0-9a-fA-F]{2}$/i.test(s) && !/^\d{2}$/.test(s)) {
    const v = parseInt(s, 16);
    return (v >= 0 && v <= 255) ? v : null;
  }
  // decimal
  if (/^\d{1,3}$/.test(s)) {
    const v = parseInt(s, 10);
    return (v >= 0 && v <= 255) ? v : null;
  }
  // single ASCII char
  if (s.length === 1) return s.charCodeAt(0);
  return null;
}

function byteCategory(v) {
  if (v >= 0 && v <= 31) return 'control';
  if (v === 127) return 'control';
  if (v >= 32 && v <= 126) return 'printable';
  return 'extended';
}

function asciiCharName(v) {
  if (v < 32) return ASCII_CTRL_NAMES[v];
  if (v === 127) return 'DEL';
  if (v >= 32 && v <= 126) {
    // Full names for printable ASCII
    const names = {
      32: 'SPACE', 33: 'EXCLAMATION MARK', 34: 'QUOTATION MARK', 35: 'NUMBER SIGN',
      36: 'DOLLAR SIGN', 37: 'PERCENT SIGN', 38: 'AMPERSAND', 39: 'APOSTROPHE',
      40: 'LEFT PARENTHESIS', 41: 'RIGHT PARENTHESIS', 42: 'ASTERISK', 43: 'PLUS SIGN',
      44: 'COMMA', 45: 'HYPHEN-MINUS', 46: 'FULL STOP', 47: 'SOLIDUS',
      58: 'COLON', 59: 'SEMICOLON', 60: 'LESS-THAN SIGN', 61: 'EQUALS SIGN',
      62: 'GREATER-THAN SIGN', 63: 'QUESTION MARK', 64: 'COMMERCIAL AT',
      91: 'LEFT SQUARE BRACKET', 92: 'REVERSE SOLIDUS', 93: 'RIGHT SQUARE BRACKET',
      94: 'CIRCUMFLEX ACCENT', 95: 'LOW LINE', 96: 'GRAVE ACCENT',
      123: 'LEFT CURLY BRACKET', 124: 'VERTICAL LINE', 125: 'RIGHT CURLY BRACKET',
      126: 'TILDE'
    };
    if (names[v]) return names[v];
    if (v >= 48 && v <= 57) return 'DIGIT ' + String.fromCharCode(v);
    if (v >= 65 && v <= 90) return 'LATIN CAPITAL LETTER ' + String.fromCharCode(v);
    if (v >= 97 && v <= 122) return 'LATIN SMALL LETTER ' + String.fromCharCode(v).toUpperCase();
    return String.fromCharCode(v);
  }
  return 'Extended ASCII ' + v;
}

// ─── Main Component ──────────────────────────────────────────────────────────

function HexDumpTool({ onShare, onNav, initialData }) {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistentState('hexdump:tab', initialData?.activeTab ?? initialData?.tab ?? 'hex2text');
  // Tab 1: Hex → Text
  const [hexInput, setHexInput] = usePersistentState('hexdump:hexInput', initialData?.input ?? '');
  // Tab 2: Text → Hex
  const [textInput, setTextInput] = usePersistentState('hexdump:textInput', '');
  const [outputFormat, setOutputFormat] = usePersistentState('hexdump:outputFormat', initialData?.outputFormat ?? 'xxd');
  const [grouping, setGrouping] = usePersistentState('hexdump:grouping', initialData?.grouping ?? '2');
  const [endian, setEndian] = usePersistentState('hexdump:endian', initialData?.endian ?? 'big');
  // Tab 3: Byte Inspector
  const [byteInput, setByteInput] = usePersistentState('hexdump:byteInput', '');
  // Tab 4: ASCII Table
  const [asciiSearch, setAsciiSearch] = useState('');

  const debounceRef = useRef(null);
  const [hex2textResult, setHex2textResult] = useState(null);
  const [text2hexResult, setText2hexResult] = useState('');
  const [byteResult, setByteResult] = useState(null);

  // ── Tab 1 auto-calc ────────────────────────────────────────────────────────
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      if (!hexInput.trim()) { setHex2textResult(null); return; }
      const { bytes, fmt } = parseHexToBytes(hexInput);
      if (!bytes) { setHex2textResult({ error: true, fmt }); return; }
      const text = bytesToText(bytes);
      const printable = bytes.filter(b => b >= 32 && b <= 126).length;
      const nonPrintable = bytes.length - printable;
      const hasBOM = hasUTF8BOM(bytes);
      setHex2textResult({ bytes, text, fmt, printable, nonPrintable, hasBOM });
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [hexInput]);

  // ── Tab 2 auto-calc ────────────────────────────────────────────────────────
  const text2hexDebounce = useRef(null);
  useEffect(() => {
    clearTimeout(text2hexDebounce.current);
    text2hexDebounce.current = setTimeout(() => {
      if (!textInput) { setText2hexResult(''); return; }
      const bytes = textToBytes(textInput);
      setText2hexResult(formatHexOutput(bytes, outputFormat, grouping, endian === 'little'));
    }, 300);
    return () => clearTimeout(text2hexDebounce.current);
  }, [textInput, outputFormat, grouping, endian]);

  // ── Tab 3 auto-calc ────────────────────────────────────────────────────────
  const byteDebounce = useRef(null);
  useEffect(() => {
    clearTimeout(byteDebounce.current);
    byteDebounce.current = setTimeout(() => {
      if (!byteInput.trim()) { setByteResult(null); return; }
      const v = parseByteInput(byteInput);
      if (v === null) { setByteResult({ error: true }); return; }
      setByteResult({ v });
    }, 300);
    return () => clearTimeout(byteDebounce.current);
  }, [byteInput]);

  // ── Share URL ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e) => {
      const respond = e.detail?.respond ?? onShare;
      const input = tab === 'hex2text' ? hexInput : (tab === 'text2hex' ? textInput : '');
      respond({ tool: 'hex-dump', tab, input, outputFormat, grouping, endian });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, hexInput, textInput, outputFormat, grouping, endian, onShare]);

  // ── Load initial data ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!initialData) return;
    const incomingTab = initialData.activeTab ?? initialData.tab;
    if (incomingTab) setTab(incomingTab);
    if (initialData.input !== undefined) {
      if ((incomingTab || tab) === 'hex2text') setHexInput(initialData.input);
      else setTextInput(initialData.input);
    }
    if (initialData.outputFormat) setOutputFormat(initialData.outputFormat);
    if (initialData.grouping) setGrouping(initialData.grouping);
    if (initialData.endian) setEndian(initialData.endian);
  }, [initialData]);

  useEffect(() => { onNav?.({ activeTab: tab }); }, [tab]);

  const [copied, copy] = useCopy();

  // ── Format badge label ─────────────────────────────────────────────────────
  const fmtLabel = {
    xxd: t('hex_dump.fmt_xxd'),
    od: t('hex_dump.fmt_od'),
    cstr: t('hex_dump.fmt_cstr'),
    carray: t('hex_dump.fmt_carray'),
    colon: t('hex_dump.fmt_colon'),
    raw_spaced: t('hex_dump.fmt_raw_spaced'),
    raw: t('hex_dump.fmt_raw'),
    unknown: t('hex_dump.fmt_unknown'),
  };

  // ── Byte inspector nav ─────────────────────────────────────────────────────
  const currentByte = byteResult && !byteResult.error ? byteResult.v : null;
  const goToByte = (v) => {
    const clamped = Math.max(0, Math.min(255, v));
    setByteInput(String(clamped));
  };

  // ── ASCII table click ──────────────────────────────────────────────────────
  const handleAsciiCellClick = (v) => {
    setByteInput(String(v));
    setTab('byte-inspector');
  };

  // ── ASCII search highlight ─────────────────────────────────────────────────
  const asciiHighlightSet = useMemo(() => {
    if (!asciiSearch.trim()) return null;
    const s = asciiSearch.trim();
    const set = new Set();
    // single char
    if (s.length === 1) {
      set.add(s.charCodeAt(0));
      return set;
    }
    // hex
    const hexM = s.match(/^(0x)?([0-9a-fA-F]{1,2})$/i);
    if (hexM) {
      const v = parseInt(hexM[2], 16);
      if (v >= 0 && v <= 255) { set.add(v); return set; }
    }
    // dec
    const decM = s.match(/^\d{1,3}$/);
    if (decM) {
      const v = parseInt(s, 10);
      if (v >= 0 && v <= 255) { set.add(v); return set; }
    }
    // name substring
    for (let i = 0; i < 256; i++) {
      const name = i < 32 ? ASCII_CTRL_NAMES[i] : (i === 127 ? 'DEL' : String.fromCharCode(i));
      if (name && name.toLowerCase().includes(s.toLowerCase())) set.add(i);
    }
    return set.size ? set : null;
  }, [asciiSearch]);

  // ─── Styles ────────────────────────────────────────────────────────────────
  const monoStyle = { fontFamily: 'var(--mono)', fontSize: 13 };

  // ─── Tab 1: Hex → Text ─────────────────────────────────────────────────────
  const renderHex2Text = () => {
    const r = hex2textResult;
    return (
      <div>
        <div className="field">
          <label className="label">
            {t('hex_dump.hex_input_label')}
          </label>
          <textarea
            className="input"
            style={{ ...monoStyle, minHeight: 140, resize: 'vertical' }}
            value={hexInput}
            onChange={e => setHexInput(e.target.value)}
            placeholder={t('hex_dump.hex_input_placeholder')}
            spellCheck={false}
          />
        </div>

        {r && r.error && (
          <Err msg={t('hex_dump.err_invalid_hex')} />
        )}

        {r && !r.error && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
              <span className="label" style={{ margin: 0 }}>{t('hex_dump.detected_format')}</span>
              <span className="badge badge-cyan" style={{ fontSize: 11 }}>{fmtLabel[r.fmt] || r.fmt}</span>
              {r.hasBOM && <span className="badge badge-yellow" style={{ fontSize: 11 }}>{t('hex_dump.utf8_bom')}</span>}
            </div>

            <div style={{ display: 'flex', gap: 16, marginBottom: 12, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', minWidth: 80 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--cyan)' }}>{r.bytes.length}</span>
                <span className="label" style={{ fontSize: 11, margin: 0 }}>{t('hex_dump.stat_total_bytes')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', minWidth: 80 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>{r.printable}</span>
                <span className="label" style={{ fontSize: 11, margin: 0 }}>{t('hex_dump.stat_printable')}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 14px', minWidth: 80 }}>
                <span style={{ fontSize: 18, fontWeight: 700, color: 'var(--yellow)' }}>{r.nonPrintable}</span>
                <span className="label" style={{ fontSize: 11, margin: 0 }}>{t('hex_dump.stat_non_printable')}</span>
              </div>
            </div>

            <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="label" style={{ margin: 0 }}>{t('hex_dump.decoded_output')}</label>
              <CopyBtn text={r.text} />
            </div>
            <div style={{ ...monoStyle, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '8px 10px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 240, overflowY: 'auto',
              fontSize: 13, lineHeight: 1.6 }}>
              {r.bytes.map((b, i) => {
                const isPrint = b >= 32 && b <= 126;
                if (isPrint) return <span key={i}>{String.fromCharCode(b)}</span>;
                return (
                  <span key={i} title={`0x${b.toString(16).padStart(2,'0')} (${b})`}
                    style={{ color: 'var(--muted)', opacity: 0.6 }}>.</span>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Tab 2: Text → Hex ─────────────────────────────────────────────────────
  const renderText2Hex = () => {
    const outputFormatOptions = [
      { v: 'xxd',        l: t('hex_dump.ofmt_xxd') },
      { v: 'hexdump',    l: t('hex_dump.ofmt_hexdump') },
      { v: 'raw',        l: t('hex_dump.ofmt_raw') },
      { v: 'raw_spaced', l: t('hex_dump.ofmt_raw_spaced') },
      { v: 'carray',     l: t('hex_dump.ofmt_carray') },
      { v: 'cstring',    l: t('hex_dump.ofmt_cstring') },
      { v: 'python',     l: t('hex_dump.ofmt_python') },
      { v: 'colon',      l: t('hex_dump.ofmt_colon') },
    ];
    const groupingOptions = [
      { v: '1', l: t('hex_dump.group_1') },
      { v: '2', l: t('hex_dump.group_2') },
      { v: '4', l: t('hex_dump.group_4') },
      { v: '8', l: t('hex_dump.group_8') },
    ];

    return (
      <div>
        <div className="field">
          <label className="label">
            {t('hex_dump.text_input_label')}
          </label>
          <textarea
            className="input"
            style={{ ...monoStyle, minHeight: 100, resize: 'vertical' }}
            value={textInput}
            onChange={e => setTextInput(e.target.value)}
            placeholder={t('hex_dump.text_input_placeholder')}
            spellCheck={false}
          />
        </div>

        <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="label" style={{ margin: 0 }}>{t('hex_dump.output_format')}</label>
            <select className="select" style={{ width: 'auto', padding: '4px 8px', fontSize: 12, height: 'auto' }} value={outputFormat} onChange={e => setOutputFormat(e.target.value)}>
              {outputFormatOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="label" style={{ margin: 0 }}>{t('hex_dump.grouping')}</label>
            <select className="select" style={{ width: 'auto', padding: '4px 8px', fontSize: 12, height: 'auto' }} value={grouping} onChange={e => setGrouping(e.target.value)}>
              {groupingOptions.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <label className="label" style={{ margin: 0 }}>{t('hex_dump.endianness')}</label>
            <select className="select" style={{ width: 'auto', padding: '4px 8px', fontSize: 12, height: 'auto' }} value={endian} onChange={e => setEndian(e.target.value)}>
              <option value="big">{t('hex_dump.endian_big')}</option>
              <option value="little">{t('hex_dump.endian_little')}</option>
            </select>
          </div>
        </div>

        {text2hexResult && (
          <div>
            <div style={{ marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="label" style={{ margin: 0 }}>{t('hex_dump.hex_output_label')}</label>
              <CopyBtn text={text2hexResult} />
            </div>
            <pre style={{ ...monoStyle, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 6,
              padding: '8px 10px', overflowX: 'auto', overflowY: 'auto', maxHeight: 360,
              margin: 0, whiteSpace: 'pre', wordBreak: 'normal', fontSize: 13, lineHeight: 1.6 }}>
              {text2hexResult}
            </pre>
          </div>
        )}
      </div>
    );
  };

  // ─── Tab 3: Byte Inspector ─────────────────────────────────────────────────
  const renderByteInspector = () => {
    const v = currentByte;
    const hasResult = v !== null && v !== undefined;

    const bitGridStyle = {
      display: 'flex', gap: 4, marginTop: 12, alignItems: 'flex-end'
    };
    const bitCellStyle = (bit) => ({
      width: 32, height: 40, borderRadius: 4, border: '1px solid var(--border)',
      background: bit ? 'var(--cyan)' : 'var(--panel)',
      color: bit ? 'var(--btn-text)' : 'var(--muted)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      fontSize: 11, fontWeight: 600, cursor: 'default',
      transition: 'background 0.1s',
    });

    const fieldStyle = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2px 0', fontSize: 13 };
    const rowStyle = { display: 'contents' };
    const labelCellStyle = { padding: '4px 8px 4px 0', color: 'var(--muted)', fontSize: 12, borderBottom: '1px solid var(--border)' };
    const valueCellStyle = { padding: '4px 0', fontFamily: 'var(--mono)', fontWeight: 500, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 6 };

    const catBadge = hasResult ? byteCategory(v) : '';
    const catColors = { control: 'badge-red', printable: 'badge-green', extended: 'badge-blue' };

    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1.4fr)', gap: 20 }}>
        {/* Left column: input + nav */}
        <div>
          <div className="field">
            <label className="label">
              {t('hex_dump.byte_input_label')}
            </label>
            <input
              className="input"
              style={{ ...monoStyle, fontSize: 14 }}
              value={byteInput}
              onChange={e => setByteInput(e.target.value)}
              placeholder={t('hex_dump.byte_input_placeholder')}
              spellCheck={false}
            />
            <div className="hint">
              {t('hex_dump.byte_input_hint')}
            </div>
          </div>

          {byteResult && byteResult.error && (
            <Err msg={t('hex_dump.err_invalid_byte')} />
          )}

          {hasResult && (
            <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
              <button
                className="btn btn-ghost btn-sm"
                disabled={v <= 0}
                onClick={() => goToByte(v - 1)}>
                {t('hex_dump.prev_byte')}
              </button>
              <span className="label" style={{ margin: 0 }}>{v} / 255</span>
              <button
                className="btn btn-ghost btn-sm"
                disabled={v >= 255}
                onClick={() => goToByte(v + 1)}>
                {t('hex_dump.next_byte')}
              </button>
            </div>
          )}

          {/* Bit grid */}
          {hasResult && (
            <div style={{ marginTop: 18 }}>
              <div className="label">{t('hex_dump.bit_grid_label')}</div>
              <div style={bitGridStyle}>
                {[7,6,5,4,3,2,1,0].map(bit => {
                  const bitVal = (v >> bit) & 1;
                  return (
                    <div key={bit} style={bitCellStyle(bitVal)}>
                      <span style={{ fontSize: 9, opacity: 0.6 }}>b{bit}</span>
                      <span>{bitVal}</span>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                {[7,6,5,4,3,2,1,0].map(bit => (
                  <div key={bit} style={{ width: 32, textAlign: 'center', fontSize: 10, color: 'var(--muted)' }}>
                    {(v >> bit) & 1 ? '1' : '0'}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right column: table */}
        {hasResult && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <span className={`badge ${catColors[catBadge]}`} style={{ fontSize: 11 }}>
                {t(`hex_dump.cat_${catBadge}`)}
              </span>
            </div>
            <div style={fieldStyle}>
              {[
                [t('hex_dump.field_decimal'), String(v)],
                [t('hex_dump.field_hex'), '0x' + v.toString(16).toUpperCase().padStart(2,'0')],
                [t('hex_dump.field_octal'), '0o' + v.toString(8).padStart(3,'0')],
                [t('hex_dump.field_binary'), v.toString(2).padStart(8,'0').replace(/(.{4})/g,'$1 ').trim()],
                [t('hex_dump.field_ascii_char'), (v >= 32 && v <= 126) ? String.fromCharCode(v) : (v < 32 ? ASCII_CTRL_NAMES[v] : (v === 127 ? 'DEL' : '·'))],
                [t('hex_dump.field_ascii_name'), asciiCharName(v)],
                [t('hex_dump.field_ascii_cat'), t(`hex_dump.cat_${catBadge}`)],
                [t('hex_dump.field_c_escape'), C_ESCAPES[v] || (v < 32 || v === 127 ? ('\\x' + v.toString(16).padStart(2,'0')) : '-')],
                [t('hex_dump.field_html_entity'), (HTML_ENTITIES[v] ? HTML_ENTITIES[v] + ' / ' : '') + '&#' + v + ';'],
                [t('hex_dump.field_url_percent'), '%' + v.toString(16).toUpperCase().padStart(2,'0')],
              ].map(([lbl, val]) => (
                <div key={lbl} style={rowStyle}>
                  <div style={labelCellStyle}>{lbl}</div>
                  <div style={valueCellStyle}>
                    <span>{val}</span>
                    <CopyBtn text={val} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Tab 4: ASCII Table ────────────────────────────────────────────────────
  const renderAsciiTable = () => {
    const catColors = { control: 'rgba(239, 68, 68, 0.08)', printable: 'rgba(34, 197, 94, 0.08)', extended: 'rgba(74, 158, 255, 0.08)' };
    const catBorderColors = { control: 'var(--red)', printable: 'var(--green)', extended: 'var(--blue)' };

    const cellStyle = (v) => {
      const cat = byteCategory(v);
      const highlighted = asciiHighlightSet && asciiHighlightSet.has(v);
      return {
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '4px 3px', borderRadius: 4, cursor: 'pointer', minWidth: 40,
        background: highlighted ? 'var(--cyan)' : catColors[cat],
        border: highlighted ? '2px solid var(--cyan)' : `1px solid ${catBorderColors[cat]}33`,
        color: highlighted ? 'var(--btn-text)' : 'var(--text)',
        transition: 'opacity 0.1s, transform 0.1s',
        opacity: (asciiHighlightSet && !highlighted) ? 0.35 : 1,
        userSelect: 'none',
      };
    };

    const charDisplay = (v) => {
      if (v < 32) return ASCII_CTRL_NAMES[v] || '·';
      if (v === 127) return 'DEL';
      return String.fromCharCode(v);
    };

    return (
      <div>
        <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <input
            className="input"
            style={{ width: 180, padding: '5px 10px', fontSize: 12 }}
            value={asciiSearch}
            onChange={e => setAsciiSearch(e.target.value)}
            placeholder={t('hex_dump.ascii_search_placeholder')}
          />
          <div style={{ display: 'flex', gap: 8, fontSize: 11, color: 'var(--muted)' }}>
            <span><span style={{ display:'inline-block', width:10, height:10, background:'rgba(239, 68, 68, 0.08)', border:'1px solid rgba(239, 68, 68, 0.3)', borderRadius:2, marginRight:4 }}></span>{t('hex_dump.cat_control')}</span>
            <span><span style={{ display:'inline-block', width:10, height:10, background:'rgba(34, 197, 94, 0.08)', border:'1px solid rgba(34, 197, 94, 0.3)', borderRadius:2, marginRight:4 }}></span>{t('hex_dump.cat_printable')}</span>
            <span><span style={{ display:'inline-block', width:10, height:10, background:'rgba(74, 158, 255, 0.08)', border:'1px solid rgba(74, 158, 255, 0.3)', borderRadius:2, marginRight:4 }}></span>{t('hex_dump.cat_extended')}</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, minmax(42px, 1fr))', gap: 2 }}>
            {Array.from({ length: 256 }, (_, i) => (
              <div key={i} style={cellStyle(i)} onClick={() => handleAsciiCellClick(i)}
                title={`Dec: ${i} | Hex: 0x${i.toString(16).padStart(2,'0')} | ${asciiCharName(i)}`}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, lineHeight: 1 }}>
                  {charDisplay(i)}
                </span>
                <span style={{ fontSize: 9, color: 'inherit', opacity: 0.7 }}>
                  {i.toString(16).padStart(2,'0')}
                </span>
                <span style={{ fontSize: 9, opacity: 0.5 }}>{i}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
          {t('hex_dump.ascii_table_hint')}
        </div>
      </div>
    );
  };

  // ─── Main render ───────────────────────────────────────────────────────────
  const TABS = [
    { id: 'hex2text',       label: t('hex_dump.tab_hex2text') },
    { id: 'text2hex',       label: t('hex_dump.tab_text2hex') },
    { id: 'byte-inspector', label: t('hex_dump.tab_byte_inspector') },
    { id: 'ascii-table',    label: t('hex_dump.tab_ascii_table') },
  ];

  return (
    <div className="fadein">
      {/* Tab bar card */}
      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map(tb => (
            <button
              key={tb.id}
              className={`btn btn-sm ${tab === tb.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(tb.id)}
            >
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {/* Main content card */}
      <div className="card fadein">
        {tab === 'hex2text' && renderHex2Text()}
        {tab === 'text2hex' && renderText2Hex()}
        {tab === 'byte-inspector' && renderByteInspector()}
        {tab === 'ascii-table' && renderAsciiTable()}
      </div>
    </div>
  );
}

window.HexDumpTool = HexDumpTool;
