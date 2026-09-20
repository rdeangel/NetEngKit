const { useState, useEffect, useCallback, useRef, useMemo, createContext, useContext } = React;

// ─── i18n ──────────────────────────────────────────────────
const LanguageContext = createContext();

function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    const saved = localStorage.getItem('NetEngKit-lang');
    if (saved) return saved;
    
    const navLang = navigator.language || '';
    if (!navLang) return 'en';

    const browserLang = navLang.split('-')[0].toLowerCase();
    const fullBrowserLang = navLang;
    const trans = window.TRANSLATIONS || {};
    
    // Exact match (e.g. pt-BR)
    if (trans[fullBrowserLang]) return fullBrowserLang;
    
    // Check for case-insensitive match
    const keys = Object.keys(trans);
    const fullMatch = keys.find(k => k.toLowerCase() === fullBrowserLang.toLowerCase());
    if (fullMatch) return fullMatch;
    
    const shortMatch = keys.find(k => k.toLowerCase() === browserLang);
    if (shortMatch) return shortMatch;
    
    return 'en';
  });

  useEffect(() => {
    localStorage.setItem('NetEngKit-lang', lang);
  }, [lang]);

  const t = useCallback((path, varsOrFallback, maybeVars) => {
    if (!path) return typeof varsOrFallback === 'string' ? varsOrFallback : '';
    const keys = path.split('.');
    const trans = window.TRANSLATIONS || {};
    const resolve = (obj) => {
      let v = obj;
      for (const key of keys) {
        if (v && typeof v === 'object') {
          v = v[key];
        } else {
          return undefined;
        }
      }
      return v;
    };
    let value = resolve(trans[lang]);
    if (value === undefined) value = resolve(trans['en']);
    
    let fallback = '';
    let vars = {};
    
    if (typeof varsOrFallback === 'string') {
      fallback = varsOrFallback;
      if (typeof maybeVars === 'object' && maybeVars !== null) {
        vars = maybeVars;
      }
    } else if (typeof varsOrFallback === 'object' && varsOrFallback !== null) {
      vars = varsOrFallback;
    }

    if (value === undefined || value === null) {
      if (vars.returnObjects) return null;
      value = fallback || path;
    }
    if (typeof value !== 'string') return value;

    // Check if any variable is a React element
    const hasElement = Object.values(vars).some(v => React.isValidElement(v));

    if (!hasElement) {
      return value.replace(/\{+([^}]+)\}+/g, (match, key) => {
        const val = vars[key.trim()];
        return val !== undefined ? val : match;
      });
    }

    // Support for React elements in interpolation
    const parts = [];
    let lastIndex = 0;
    const regex = /\{+([^}]+)\}+/g;
    let match;

    while ((match = regex.exec(value)) !== null) {
      const key = match[1].trim();
      const val = vars[key];
      
      if (match.index > lastIndex) {
        parts.push(value.substring(lastIndex, match.index));
      }

      if (val !== undefined) {
        parts.push(val);
      } else {
        parts.push(match[0]);
      }
      
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < value.length) {
      parts.push(value.substring(lastIndex));
    }

    return <React.Fragment>{parts.map((p, i) => <React.Fragment key={i}>{p}</React.Fragment>)}</React.Fragment>;
  }, [lang]);

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}
window.LanguageProvider = LanguageProvider;

function useTranslation() {
  const context = useContext(LanguageContext);
  if (!context) throw new Error('useTranslation must be used within a LanguageProvider');
  return context;
}
window.useTranslation = useTranslation;

// ─── Helpers ────────────────────────────────────────────────
function copyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
  document.body.appendChild(ta);
  ta.focus(); ta.select();
  try { document.execCommand('copy'); } catch {}
  document.body.removeChild(ta);
}

function useCopy() {
  const [copied, setCopied] = useState(null);
  const copy = (text, key) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => copyFallback(text));
    } else {
      copyFallback(text);
    }
    setCopied(key ?? true);
    setTimeout(() => setCopied(null), 1500);
  };
  return [copied, copy];
}
window.useCopy = useCopy;

function getRFCUrl(rfc) {
  const m = String(rfc).match(/\d+/);
  return m ? `https://www.rfc-editor.org/rfc/rfc${m[0]}.html` : null;
}
window.getRFCUrl = getRFCUrl;

function RFCLink({ rfc, className }) {
  if (!rfc || rfc === '-') return <span>-</span>;
  const url = getRFCUrl(rfc);
  if (!url) return <span className={className}>{rfc}</span>;
  return (
    <a href={url} target="_blank" rel="noopener" className={className}>
      {rfc}
    </a>
  );
}
window.RFCLink = RFCLink;

function CopyBtn({ text, label = 'copy', id }) {
  const [copied, copy] = useCopy();
  const { t } = useTranslation();
  return (
    <button className={`copy-btn ${copied ? 'copied' : ''}`} onClick={() => copy(text, id)} title={t('common.copy', 'Copy')}>
      {copied ? '✓' : (
        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="1" width="9" height="9" rx="1.5" />
          <path d="M10 10v2a1.5 1.5 0 01-1.5 1.5H2A1.5 1.5 0 01.5 12V5A1.5 1.5 0 012 3.5h2" />
        </svg>
      )}
    </button>
  );
}
window.CopyBtn = CopyBtn;

function ResultItem({ label, value, accent, green, yellow, red }) {
  const cls = accent ? 'accent' : green ? 'green' : yellow ? 'yellow' : red ? 'red' : '';
  const isRFC = label === 'RFC';
  return (
    <div className="result-item">
      <div>
        <div className="result-label">{label}</div>
        <div className={`result-value ${cls}`}>
          {isRFC ? <RFCLink rfc={value} /> : value}
        </div>
      </div>
      <CopyBtn text={String(value)} />
    </div>
  );
}
window.ResultItem = ResultItem;

function Err({ msg }) {
  if (!msg) return null;
  return <div className="err">⚠ {msg}</div>;
}
window.Err = Err;

function exportJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
window.exportJSON = exportJSON;

function exportCSV(rows, filename) {
  if (!rows.length) return;
  const keys = Object.keys(rows[0]);
  const lines = [keys.join(','), ...rows.map(r => keys.map(k => `"${r[k]}"`).join(','))];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
window.exportCSV = exportCSV;

function scopeBadge(scope) {
  const { t } = useTranslation();
  const map = { Global:'badge-cyan', Private:'badge-green', Host:'badge-yellow', Link:'badge-blue', Docs:'badge-purple', Special:'badge-gray', Reserved:'badge-red', Various:'badge-purple' };
  return <span className={`badge ${map[scope]||'badge-gray'}`}>{t(`common.scopes.${scope.toLowerCase()}`, scope)}</span>;
}
window.scopeBadge = scopeBadge;

window.toolStateCache = window.toolStateCache || {};

function usePersistentState(key, initialValue) {
  const [state, setState] = React.useState(() => {
    if (window.toolStateCache[key] !== undefined) {
      return window.toolStateCache[key];
    }
    return typeof initialValue === 'function' ? initialValue() : initialValue;
  });

  React.useEffect(() => {
    window.toolStateCache[key] = state;
  }, [key, state]);

  return [state, setState];
}
window.usePersistentState = usePersistentState;

// ─── Shared ARP parsing ─────────────────────────────────────
function normalizeMac(raw) {
  if (!raw) return '';
  const clean = raw.replace(/[:\-\.]/g, '').toUpperCase();
  if (clean.length !== 12 || !/^[0-9A-F]+$/.test(clean)) return raw.toUpperCase();
  return clean.match(/.{2}/g).join(':');
}
window.normalizeMac = normalizeMac;

function macOUI(mac) {
  const clean = mac.replace(/:/g, '');
  if (clean.length < 6) return '';
  const db = (typeof OUI_DB !== 'undefined') ? OUI_DB : (window.OUI_DB || {});
  const s9 = clean.slice(0, 9), s7 = clean.slice(0, 7), s6 = clean.slice(0, 6);
  return db[s9] || db[s7] || db[s6] || '';
}
window.macOUI = macOUI;

function detectArpFormat(text) {
  if (/protocol\s+address\s+age/i.test(text)) return 'cisco';
  if (/address\s+hwtype\s+hwaddress/i.test(text)) return 'linux-detail';
  if (/\? \([\d.]+\) at /i.test(text)) return 'bsd';
  if (/interface: .+\n/i.test(text) && /internet address/i.test(text.toLowerCase())) return 'windows';
  if (/type\s+age\s+hardware\s+addr/i.test(text)) return 'junos';
  return 'cisco';
}
window.detectArpFormat = detectArpFormat;

function parseArpOutput(text) {
  if (!text.trim()) return [];
  const fmt = detectArpFormat(text);

  function parseCisco(t) {
    return t.split('\n').reduce((acc, line) => {
      const m = line.match(/^Internet\s+([\d.]+)\s+(\S+)\s+([\da-fA-F.]+)\s+(\S+)\s*(\S*)/i);
      if (m) acc.push({ ip: m[1], age: m[2] === '-' ? null : parseInt(m[2]), mac: normalizeMac(m[3]), type: m[4], iface: m[5] || '' });
      return acc;
    }, []);
  }

  function parseBSD(t) {
    return t.split('\n').reduce((acc, line) => {
      const m = line.match(/(\S+)\s+\(([\d.a-fA-F:]+)\)\s+at\s+(\S+)\s+\[(\S+)\]\s+on\s+(\S+)/);
      if (m) { acc.push({ ip: m[2], mac: normalizeMac(m[3]), type: m[4], iface: m[5] || '', age: null }); return acc; }
      const m2 = line.match(/\(?([\d.]+)\)?\s+at\s+([\da-fA-F:]+)\s+.*on\s+(\S+)/i);
      if (m2) acc.push({ ip: m2[1], mac: normalizeMac(m2[2]), type: 'ether', iface: m2[3] || '', age: null });
      return acc;
    }, []);
  }

  function parseLinuxDetail(t) {
    return t.split('\n').reduce((acc, line) => {
      if (/^address/i.test(line)) return acc;
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) return acc;
      const [ip, , mac, , , iface] = parts;
      if (/^\d+\.\d+\.\d+\.\d+$/.test(ip)) acc.push({ ip, mac: normalizeMac(mac), type: 'ether', iface: iface || '', age: null });
      return acc;
    }, []);
  }

  function parseWindows(t) {
    let iface = '';
    return t.split('\n').reduce((acc, line) => {
      const ifM = line.match(/Interface:\s+([\d.]+)/i);
      if (ifM) { iface = ifM[1]; return acc; }
      const m = line.match(/([\d.]+)\s+([\da-fA-F-]+)\s+(\S+)/);
      if (m && !/type/i.test(line)) acc.push({ ip: m[1], mac: normalizeMac(m[2]), type: m[3], iface, age: null });
      return acc;
    }, []);
  }

  let entries = [];
  if (fmt === 'cisco') entries = parseCisco(text);
  else if (fmt === 'bsd') entries = parseBSD(text);
  else if (fmt === 'linux-detail') entries = parseLinuxDetail(text);
  else if (fmt === 'windows') entries = parseWindows(text);
  else entries = parseCisco(text);
  return entries.filter(e => e.ip && e.mac);
}
window.parseArpOutput = parseArpOutput;

// ─── Shared ZIP builder (STORE, no compression) ─────────────
const _ZIP_CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function zipCrc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = _ZIP_CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function buildZip(files) {
  const enc = new TextEncoder();
  const localChunks = [], central = [];
  let offset = 0;
  for (const f of files) {
    const nb = enc.encode(f.name), crc = zipCrc32(f.bytes), sz = f.bytes.length;
    const local = new Uint8Array(30 + nb.length);
    const dv = new DataView(local.buffer);
    dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true);
    dv.setUint32(14, crc, true); dv.setUint32(18, sz, true); dv.setUint32(22, sz, true);
    dv.setUint16(12, 0x21, true); dv.setUint16(26, nb.length, true);
    local.set(nb, 30);
    localChunks.push(local, f.bytes);
    const cd = new Uint8Array(46 + nb.length);
    const cv = new DataView(cd.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(12, 0x21, true); cv.setUint32(16, crc, true);
    cv.setUint32(20, sz, true); cv.setUint32(24, sz, true); cv.setUint16(28, nb.length, true);
    cv.setUint32(42, offset, true); cd.set(nb, 46); central.push(cd);
    offset += local.length + f.bytes.length;
  }
  const csz = central.reduce((s, c) => s + c.length, 0);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true); ev.setUint32(12, csz, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + csz + 22);
  let o = 0;
  for (const c of localChunks) { out.set(c, o); o += c.length; }
  for (const c of central)     { out.set(c, o); o += c.length; }
  out.set(eocd, o);
  return out;
}
window.buildZip = buildZip;

const SearchableSelect = ({ value, onChange, options, placeholder }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;
  const selectedLabel = options.find(o => o.value === value)?.label;

  return (
    <div ref={containerRef} style={{position:'relative'}}>
      <div className="select" style={{cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',userSelect:'none'}}
           onClick={() => { setOpen(v => !v); setSearch(''); }}>
        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,minWidth:0}}>
          {selectedLabel || <span style={{opacity:0.45}}>{placeholder}</span>}
        </span>
        <span style={{opacity:0.4,marginLeft:6,flexShrink:0,fontSize:10}}>▾</span>
      </div>
      {open && (
        <div style={{position:'absolute',zIndex:300,top:'calc(100% + 2px)',left:0,right:0,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',boxShadow:'0 6px 16px rgba(0,0,0,.35)',display:'flex',flexDirection:'column'}}>
          <div style={{padding:6}}>
            <input autoFocus className="input" style={{width:'100%',boxSizing:'border-box',fontSize:12}}
                   value={search} onChange={e=>setSearch(e.target.value)} placeholder={t('common.search_placeholder', 'Search…')}
                   onKeyDown={e=>{ if(e.key==='Escape') setOpen(false); }}/>
          </div>
          <div style={{overflowY:'auto',maxHeight:220}}>
            <div style={{padding:'5px 10px',cursor:'pointer',fontSize:12,opacity:0.5}}
                 onMouseDown={()=>{ onChange(''); setOpen(false); setSearch(''); }}>
              {placeholder}
            </div>
            {filtered.length === 0
              ? <div style={{padding:'5px 10px',fontSize:12,opacity:0.4}}>{t('common.no_matches', 'No matches')}</div>
              : filtered.map(o => (
                  <div key={o.value}
                       style={{padding:'5px 10px',cursor:'pointer',fontSize:12,background:o.value===value?'rgba(0,212,200,.12)':undefined}}
                       onMouseDown={()=>{ onChange(o.value); setOpen(false); setSearch(''); }}>
                    {o.label}
                  </div>
                ))
            }
          </div>
        </div>
      )}
    </div>
  );
};
window.SearchableSelect = SearchableSelect;

const MultiSearchableSelect = ({ activeOptions, onChange, options, placeholder, selectLabel }) => {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (!containerRef.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const filtered = search
    ? options.filter(o => o.label.toLowerCase().includes(search.toLowerCase()))
    : options;

  const handleToggle = (val) => {
    const next = activeOptions.includes(val)
      ? activeOptions.filter(v => v !== val)
      : [...activeOptions, val];
    onChange(next);
  };

  return (
    <div ref={containerRef} style={{position:'relative'}}>
      {/* Dropdown Input Toggle */}
      <div className="select" style={{cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'space-between',userSelect:'none',padding:'0.55rem 0.75rem'}}
           onClick={() => { setOpen(v => !v); setSearch(''); }}>
        <span style={{overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',flex:1,minWidth:0,fontSize:'0.9rem'}}>
          {activeOptions.length === 0 
            ? <span style={{opacity:0.45}}>{placeholder}</span> 
            : selectLabel || `${activeOptions.length} active`}
        </span>
        <span style={{opacity:0.4,marginLeft:6,flexShrink:0,fontSize:10}}>▼</span>
      </div>

      {open && (
        <div style={{position:'absolute',zIndex:300,top:'calc(100% + 4px)',left:0,right:0,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',boxShadow:'0 8px 24px rgba(0,0,0,.5)',display:'flex',flexDirection:'column',maxHeight:'350px',overflow:'hidden'}}>
          <div style={{padding:6, borderBottom: '1px solid var(--border)'}}>
            <input autoFocus className="input" style={{width:'100%',boxSizing:'border-box',fontSize:12}}
                   value={search} onChange={e=>setSearch(e.target.value)} placeholder={placeholder}
                   onKeyDown={e=>{ if(e.key==='Escape') setOpen(false); }}/>
          </div>
          <div style={{overflowY:'auto',flex:1}}>
            {filtered.length === 0
              ? <div style={{padding:'10px',fontSize:12,opacity:0.4}}>{t('common.no_matches', 'No matches')}</div>
              : filtered.map(o => {
                  const isActive = activeOptions.includes(o.value);
                  return (
                    <div key={o.value}
                         title={o.hint}
                         style={{padding:'0.6rem 0.75rem',cursor:'pointer',fontSize:12,display:'flex',alignItems:'center',justifyContent:'space-between',background:isActive?'rgba(0,212,200,.08)':undefined,borderBottom:'1px solid #1f1f2e'}}
                         onMouseDown={(e)=>{ e.preventDefault(); handleToggle(o.value); }}>
                      <div style={{display:'flex',flexDirection:'column',gap:'0.15rem',paddingRight:'0.5rem'}}>
                        <span style={{fontWeight:isActive?'bold':'normal',color:isActive?'var(--colors-primary)':undefined}}>
                          {o.label}
                        </span>
                        {o.hint && <span style={{fontSize:10,color:'#888'}}>{o.hint}</span>}
                      </div>
                      {isActive && <span style={{color:'var(--colors-primary)',fontWeight:'bold',fontSize:12}}>✓</span>}
                    </div>
                  );
                })
            }
          </div>
        </div>
      )}
    </div>
  );
};
window.MultiSearchableSelect = MultiSearchableSelect;


// ── Shared Mermaid loader (offline-capable, lazy) ──────────────────────
// Bundled blob first (offline HTML / Pages / Docker), then jsDelivr.
// Mermaid is not vendored in git. Memoized.
const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
let _mermaidPromise = null;
function ensureMermaid() {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  if (_mermaidPromise) return _mermaidPromise;
  const inject = (src) => new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('failed to load ' + src));
    document.head.appendChild(s);
  });
  const blobSrc = window.__resources && window.__resources['mermaid-lazy'];
  _mermaidPromise = (blobSrc ? inject(blobSrc) : Promise.reject(new Error('no mermaid blob')))
    .catch(() => inject(MERMAID_CDN))
    .then(() => {
      window.mermaid.initialize({
        startOnLoad: false, theme: 'dark', securityLevel: 'loose',
        maxTextSize: 5000000, maxEdges: 5000,
        flowchart: { nodeSpacing: 60, rankSpacing: 90, padding: 16, curve: 'linear', useMaxWidth: true, htmlLabels: true },
      });
      return window.mermaid;
    });
  return _mermaidPromise;
}
window.ensureMermaid = ensureMermaid;

