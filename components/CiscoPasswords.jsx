const { useState, useEffect, useCallback } = React;

// Cisco type-7 XOR key (RFC/Vigenere — publicly known)
const C7KEY = [
  0x64,0x73,0x66,0x64,0x3b,0x6b,0x66,0x6f,0x41,0x2c,0x2e,0x69,
  0x79,0x65,0x77,0x72,0x6b,0x6c,0x64,0x4a,0x4b,0x44,0x48,0x53,0x55,0x42,
];

function decodeCisco7(hash) {
  if (!hash || hash.length < 4 || hash.length % 2 !== 0) return null;
  const seed = parseInt(hash.substring(0, 2), 10);
  if (isNaN(seed) || seed > 15) return null;
  const pairs = hash.substring(2).match(/.{2}/g);
  if (!pairs) return null;
  try {
    return pairs.map((p, i) =>
      String.fromCharCode(parseInt(p, 16) ^ C7KEY[(seed + i) % C7KEY.length])
    ).join('');
  } catch { return null; }
}

function encodeCisco7(plain, seed) {
  const s = seed ?? Math.floor(Math.random() * 16);
  const hex = Array.from(plain).map((ch, i) => {
    const b = ch.charCodeAt(0) ^ C7KEY[(s + i) % C7KEY.length];
    return b.toString(16).padStart(2, '0').toUpperCase();
  }).join('');
  return String(s).padStart(2, '0') + hex;
}

const TYPE_DEFS = [
  { type: '0', name: 'Plaintext',        color: '#e05252', severity: 'Critical',
    desc: 'No encoding whatsoever. The password is stored and displayed in clear text in the running-config and startup-config. Anyone with read access to the config file or a TFTP/SNMP backup has the credential immediately.',
    detect: /^\s*(?:username\s+\S+\s+)?(?:enable\s+)?password\s+(?:0\s+)?(\S+)/i,
    secure: 'Replace with "enable secret" (type 9 scrypt) or "username X secret 9 <hash>" for user accounts.' },
  { type: '7', name: 'Vigenère Cipher',  color: '#e08a52', severity: 'High',
    desc: 'A trivially reversible XOR cipher using a 26-byte hard-coded key (publicly documented). Any network engineer with the hash and this tool can recover the plaintext in milliseconds. Enabled automatically by "service password-encryption" — which only stops shoulder-surfing, not config theft.',
    detect: /password\s+7\s+([0-9A-Fa-f]+)/i,
    secure: 'Migrate to type 8 (PBKDF2-SHA256) or type 9 (scrypt). Run: "username X secret 9 <hash>" and "enable secret 9 <hash>".' },
  { type: '4', name: 'SHA-256 (no salt)', color: '#e0c452', severity: 'Medium',
    desc: 'Introduced in IOS 15.3(3) as a replacement for type 5 MD5, but deprecated almost immediately. It uses a single round of SHA-256 with no salt and no key-stretching — making it vulnerable to GPU-accelerated dictionary and rainbow table attacks. Cisco officially recommends migrating away from type 4.',
    detect: /password\s+4\s+(\S+)/i,
    secure: 'Replace with type 8 (PBKDF2-SHA256, ~20,000 iterations) or type 9 (scrypt). Both are salted and computationally expensive to crack.' },
  { type: '5', name: 'MD5 (salted)',      color: '#a8c452', severity: 'Acceptable (legacy)',
    desc: 'Salted MD5 ($1$ format). Not weak in the same way as types 0/7/4 — it is salted and hashed — but MD5 is fast on modern GPUs, making it susceptible to brute-force for weak passwords. Still widely deployed. Acceptable for now but should be migrated to type 8 or 9.',
    detect: /secret\s+5\s+(\$1\$\S+)/i,
    secure: 'Upgrade to type 8 or 9. Type 5 is acceptable but no longer recommended by Cisco for new deployments.' },
  { type: '8', name: 'PBKDF2-SHA-256',   color: '#52c48a', severity: 'Strong',
    desc: 'PBKDF2 with SHA-256 and ~20,000 iterations. Salted. Computationally expensive to crack. Supported from IOS 15.3(3) onward. The $8$ format. This is the minimum recommended type for modern deployments.',
    detect: /secret\s+8\s+(\$8\$\S+)/i,
    secure: 'No action needed. Continue using type 8 or upgrade to type 9.' },
  { type: '9', name: 'scrypt',            color: '#52c4a8', severity: 'Best',
    desc: 'scrypt with N=16384, r=1, p=1. Memory-hard — extremely resistant to GPU/ASIC acceleration. The $9$ format. Supported from IOS 15.3(3) and IOS-XE 16.x onward. This is Cisco\'s current best-practice recommendation.',
    detect: /secret\s+9\s+(\$9\$\S+)/i,
    secure: 'Best practice. No action needed.' },
];

const SCANNER_PATTERNS = [
  { re: /^(\s*username\s+(\S+)\s+password\s+0\s+)(\S+)/im,           type:'0', label:'Username plaintext password' },
  { re: /^(\s*username\s+(\S+)\s+password\s+7\s+)([0-9A-Fa-f]+)/im,  type:'7', label:'Username type-7 password' },
  { re: /^(\s*username\s+(\S+)\s+password\s+4\s+)(\S+)/im,           type:'4', label:'Username type-4 password' },
  { re: /^(\s*username\s+(\S+)\s+secret\s+5\s+)(\S+)/im,             type:'5', label:'Username secret type 5' },
  { re: /^(\s*username\s+(\S+)\s+secret\s+8\s+)(\S+)/im,             type:'8', label:'Username secret type 8' },
  { re: /^(\s*username\s+(\S+)\s+secret\s+9\s+)(\S+)/im,             type:'9', label:'Username secret type 9' },
  { re: /^(\s*enable\s+password\s+0?\s*)(\S+)/im,                    type:'0', label:'Enable plaintext password' },
  { re: /^(\s*enable\s+password\s+7\s+)([0-9A-Fa-f]+)/im,            type:'7', label:'Enable type-7 password' },
  { re: /^(\s*enable\s+secret\s+5\s+)(\S+)/im,                       type:'5', label:'Enable secret type 5' },
  { re: /^(\s*enable\s+secret\s+8\s+)(\S+)/im,                       type:'8', label:'Enable secret type 8' },
  { re: /^(\s*enable\s+secret\s+9\s+)(\S+)/im,                       type:'9', label:'Enable secret type 9' },
  { re: /^(\s*(?:line\s+\S+.*\n(?:.*\n)*?)\s*password\s+7\s+)([0-9A-Fa-f]+)/im, type:'7', label:'Line type-7 password' },
  { re: /^(\s*(?:line\s+\S+.*\n(?:.*\n)*?)\s*password\s+0?\s*)(\S+)/im,          type:'0', label:'Line plaintext password' },
];

function scanConfig(config) {
  const results = [];
  const lines = config.split('\n');
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    // type 7
    const m7 = trimmed.match(/password\s+7\s+([0-9A-Fa-f]{4,})/i);
    if (m7) {
      const decoded = decodeCisco7(m7[1]);
      results.push({ line: idx + 1, raw: line.trim(), type: '7', hash: m7[1], decoded });
      return;
    }
    // type 4
    const m4 = trimmed.match(/password\s+4\s+(\S+)/i);
    if (m4) { results.push({ line: idx + 1, raw: line.trim(), type: '4', hash: m4[1], decoded: null }); return; }
    // type 0 explicit
    const m0e = trimmed.match(/password\s+0\s+(\S+)/i);
    if (m0e) { results.push({ line: idx + 1, raw: line.trim(), type: '0', hash: m0e[1], decoded: m0e[1] }); return; }
    // enable password (no type = plaintext)
    const mEn = trimmed.match(/^enable\s+password\s+(\S+)$/i);
    if (mEn && !trimmed.includes('secret')) { results.push({ line: idx + 1, raw: line.trim(), type: '0', hash: mEn[1], decoded: mEn[1] }); return; }
    // type 5/8/9 (ok — still report for completeness)
    const mOk = trimmed.match(/(?:password|secret)\s+(5|8|9)\s+(\S+)/i);
    if (mOk) { results.push({ line: idx + 1, raw: line.trim(), type: mOk[1], hash: mOk[2], decoded: null }); }
  });
  return results;
}

const SEVERITY_COLOR = { '0':'#e05252', '7':'#e08a52', '4':'#e0c452', '5':'#a8c452', '8':'#52c48a', '9':'#52c4a8' };
const SEVERITY_LABEL = { '0':'CRITICAL', '7':'HIGH', '4':'MEDIUM', '5':'OK', '8':'STRONG', '9':'BEST' };

function CiscoPasswords({ onShare, onNav, initialData }) {
  const { t } = useTranslation();
  const [tab, setTab]         = usePersistentState('cisco-pass:tab', initialData?.activeTab ?? 'ref');        // ref | scanner | decoder
  const [config, setConfig]   = usePersistentState('cisco-pass:config', '');
  const [findings, setFindings] = usePersistentState('cisco-pass:findings', null);
  const [hash7,    setHash7]  = usePersistentState('cisco-pass:hash7', initialData?.hash7 ?? '');
  const [plain7,   setPlain7] = usePersistentState('cisco-pass:plain7', initialData?.plain7 ?? '');
  const [decoded7, setDecoded7] = usePersistentState('cisco-pass:decoded7', '');
  const [encoded7, setEncoded7] = usePersistentState('cisco-pass:encoded7', '');
  const [decErr,   setDecErr] = useState('');

  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== tab) setTab(initialData.activeTab);
  }, [initialData]);

  useEffect(() => { onNav?.({ activeTab: tab }); }, [tab]);

  const runScan = useCallback(() => {
    setFindings(scanConfig(config));
  }, [config]);

  const runDecode = useCallback(() => {
    setDecErr('');
    const h = hash7.trim();
    if (!h) { setDecErr('Enter a type-7 hash to decode.'); return; }
    const r = decodeCisco7(h);
    if (r === null) setDecErr('Invalid type-7 hash. Expected: 2 seed digits + even number of hex pairs (e.g. 0822455D0A16).');
    else setDecoded7(r);
  }, [hash7]);

  const runEncode = useCallback(() => {
    if (!plain7.trim()) return;
    setEncoded7(encodeCisco7(plain7));
  }, [plain7]);

  const weakCount = findings ? findings.filter(f => f.type === '0' || f.type === '7' || f.type === '4').length : 0;

  const tabBtn = (id, label) => (
    <button
      className={`btn ${tab===id?'btn-primary':'btn-ghost'}`}
      style={{fontSize:12}}
      onClick={() => setTab(id)}
    >{label}</button>
  );

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('cisco_pwd.title', 'Cisco Password Types')}</div>
        <div style={{fontSize:12,color:'var(--muted)',marginBottom:14,lineHeight:1.5}}>
          {t('cisco_pwd.subtitle', 'Reference for Cisco IOS/IOS-XE/NX-OS password storage types, with a config scanner and type-7 decoder/encoder.')}
        </div>
        <div style={{display:'flex',gap:8,marginBottom:0}}>
          {tabBtn('ref',     t('cisco_pwd.tab_ref',     'Type Reference'))}
          {tabBtn('scanner', t('cisco_pwd.tab_scanner', 'Config Scanner'))}
          {tabBtn('decoder', t('cisco_pwd.tab_decoder', 'Type-7 Decoder'))}
        </div>
      </div>

      {/* ── Reference Tab ── */}
      {tab === 'ref' && (
        <div className="card fadein">
          <div className="card-title" style={{marginBottom:16}}>{t('cisco_pwd.all_types', 'All Password Types')}</div>
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {TYPE_DEFS.map(td => (
              <div key={td.type} style={{padding:14,background:'var(--panel)',border:`1px solid var(--border)`,borderLeft:`4px solid ${td.color}`,borderRadius:'var(--radius)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:6}}>
                  <span style={{fontFamily:'var(--mono)',fontSize:13,fontWeight:700,color:'var(--text)'}}>{t('common.type_prefix', 'Type')} {td.type}</span>
                  <span style={{fontSize:11,fontWeight:600,color:'var(--bg)',background:td.color,padding:'1px 7px',borderRadius:10}}>{t(`cisco_pwd.types.${td.type}.severity`, td.severity)}</span>
                  <span style={{fontSize:12,color:'var(--muted)'}}>{t(`cisco_pwd.types.${td.type}.name`, td.name)}</span>
                </div>
                <div style={{fontSize:12,color:'var(--text)',lineHeight:1.55,marginBottom:6}}>{t(`cisco_pwd.types.${td.type}.desc`, td.desc)}</div>
                <div style={{fontSize:11,color:'var(--cyan)',lineHeight:1.4}}><strong>{t('cisco_pwd.secure_label', 'Remediation:')}</strong> {t(`cisco_pwd.types.${td.type}.secure`, td.secure)}</div>
              </div>
            ))}
          </div>

          <div style={{marginTop:20,padding:14,background:'var(--panel)',borderLeft:'4px solid var(--cyan)',borderRadius:4}}>
            <div style={{fontSize:12,fontWeight:600,color:'var(--text)',marginBottom:8}}>{t('cisco_pwd.hardening_title', 'Quick Hardening Commands')}</div>
            <pre style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--text)',lineHeight:1.6,margin:0,whiteSpace:'pre-wrap'}}{...{}}>{
`! Enable type-9 enable secret:
enable secret 9 <scrypt-hash>

! Set user accounts with type-9 secret:
username admin privilege 15 secret 9 <scrypt-hash>

! Disable type-7 encoding (plaintext preferred over false security):
no service password-encryption

! Generate type-9 hash on device:
!   IOS: "enable algorithm-type scrypt secret <password>"
!   NX-OS: type-5 only; use external tool for type-8/9

! Force SSH v2 (never send passwords over Telnet):
ip ssh version 2
no service telnet
line vty 0 15
 transport input ssh`
            }</pre>
            <CopyBtn text={`! Enable type-9 enable secret:\nenable secret 9 <scrypt-hash>\n\n! Set user accounts with type-9 secret:\nusername admin privilege 15 secret 9 <scrypt-hash>\n\n! Disable type-7 encoding:\nno service password-encryption\n\n! Force SSH v2:\nip ssh version 2\nno service telnet\nline vty 0 15\n transport input ssh`} label="common.copy" id="cisco-pwd-ref-copy" />
          </div>
        </div>
      )}

      {/* ── Scanner Tab ── */}
      {tab === 'scanner' && (
        <div className="card fadein">
          <div className="card-title" style={{marginBottom:8}}>{t('cisco_pwd.tab_scanner', 'Config Scanner')}</div>
          <div style={{fontSize:12,color:'var(--muted)',marginBottom:10}}>
            {t('cisco_pwd.scanner_hint', 'Paste a Cisco running-config or startup-config. The scanner identifies all password lines, decodes type-7 hashes, and flags weak types.')}
          </div>
          <textarea
            className="input"
            style={{fontFamily:'var(--mono)',fontSize:11,minHeight:160,resize:'vertical',whiteSpace:'pre'}}
            value={config}
            onChange={e => setConfig(e.target.value)}
            placeholder={`username admin password 7 0822455D0A16\nenable secret 9 $9$...\nservice password-encryption`}
            spellCheck={false}
          />
          <button className="btn btn-primary" style={{marginTop:10}} onClick={runScan}>
            {t('cisco_pwd.scan_btn', 'Scan Config')}
          </button>

          {findings !== null && (
            <div style={{marginTop:16}}>
              <div style={{display:'flex',gap:10,marginBottom:12,flexWrap:'wrap'}}>
                <span style={{fontSize:12,fontWeight:600,color:'var(--text)'}}>
                  {t('cisco_pwd.found', '{n} password entries found', { n: findings.length })}
                </span>
                {weakCount > 0 && (
                  <span style={{fontSize:11,fontWeight:600,color:'var(--bg)',background:'#e05252',padding:'2px 8px',borderRadius:10}}>
                    {weakCount} {t('cisco_pwd.weak', 'weak')}
                  </span>
                )}
                {findings.length === 0 && (
                  <span style={{fontSize:12,color:'var(--muted)'}}>{t('cisco_pwd.no_findings', 'No password lines detected.')}</span>
                )}
              </div>

              {findings.length > 0 && (
                <div style={{overflowX:'auto'}}>
                  <table style={{width:'100%',borderCollapse:'collapse',fontSize:11,fontFamily:'var(--mono)'}}>
                    <thead>
                      <tr style={{background:'var(--panel)',color:'var(--muted)',textAlign:'left'}}>
                        {[
                          t('cisco_pwd.th_line', 'Line'),
                          t('cisco_pwd.th_type', 'Type'),
                          t('cisco_pwd.th_severity', 'Severity'),
                          t('cisco_pwd.th_hash', 'Hash / Value'),
                          t('cisco_pwd.th_plain', 'Decoded Plaintext'),
                          t('cisco_pwd.th_snippet', 'Config Snippet')
                        ].map(h => (
                          <th key={h} style={{padding:'6px 10px',borderBottom:'1px solid var(--border)',fontWeight:600,whiteSpace:'nowrap'}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {findings.map((f, i) => (
                        <tr key={i} style={{borderBottom:'1px solid var(--border)',background: i%2===0?'transparent':'var(--panel)'}}>
                          <td style={{padding:'6px 10px',color:'var(--muted)'}}>{f.line}</td>
                          <td style={{padding:'6px 10px'}}>
                            <span style={{fontWeight:700,color: SEVERITY_COLOR[f.type] || 'var(--text)'}}>Type {f.type}</span>
                          </td>
                          <td style={{padding:'6px 10px'}}>
                            <span style={{fontSize:10,fontWeight:600,color:'var(--bg)',background: SEVERITY_COLOR[f.type] || 'var(--muted)',padding:'1px 6px',borderRadius:8}}>
                              {SEVERITY_LABEL[f.type] || '?'}
                            </span>
                          </td>
                          <td style={{padding:'6px 10px',color:'var(--text)',maxWidth:160,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.hash}</td>
                          <td style={{padding:'6px 10px',color: f.decoded ? '#e05252' : 'var(--muted)',fontWeight: f.decoded ? 700 : 400}}>
                            {f.decoded || (f.type === '7' ? t('cisco_pwd.decode_failed', 'decode failed') : '—')}
                          </td>
                          <td style={{padding:'6px 10px',color:'var(--muted)',maxWidth:220,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{f.raw}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Decoder Tab ── */}
      {tab === 'decoder' && (
        <div className="card fadein">
          <div className="card-title" style={{marginBottom:8}}>{t('cisco_pwd.tab_decoder', 'Type-7 Decoder / Encoder')}</div>
          <div style={{fontSize:12,color:'var(--muted)',marginBottom:12,lineHeight:1.5}}>
            {t('cisco_pwd.decoder_note', 'Type-7 uses a publicly-known 26-byte XOR key. Decoding is deterministic and instant — this illustrates why type-7 provides no real security.')}
          </div>

          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16,marginBottom:4}} className="grid-mobile-1">
            <div>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text)',marginBottom:10}}>{t('cisco_pwd.decode_title', 'Decode (type-7 hash → plaintext)')}</div>
              <div className="field">
                <label className="label">{t('cisco_pwd.hash_input', 'Type-7 Hash')}</label>
                <input className="input" style={{fontFamily:'var(--mono)'}} value={hash7} onChange={e => { setHash7(e.target.value); setDecoded7(''); setDecErr(''); }} placeholder="0822455D0A16" />
              </div>
              <button className="btn btn-primary" onClick={runDecode}>{t('cisco_pwd.decode_btn', 'Decode')}</button>
              {decErr && <div style={{marginTop:8,fontSize:12,color:'#e05252'}}>{decErr}</div>}
              {decoded7 && (
                <div style={{marginTop:10,padding:12,background:'var(--panel)',borderLeft:'4px solid #e05252',borderRadius:4}}>
                  <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>{t('cisco_pwd.recovered_plain', 'Recovered plaintext:')}</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:15,color:'#e05252',fontWeight:700,letterSpacing:1}}>{decoded7}</div>
                </div>
              )}
            </div>

            <div>
              <div style={{fontSize:12,fontWeight:600,color:'var(--text)',marginBottom:10}}>{t('cisco_pwd.encode_title', 'Encode (plaintext → type-7 hash)')}</div>
              <div className="field">
                <label className="label">{t('cisco_pwd.plain_input', 'Plaintext Password')}</label>
                <input className="input" style={{fontFamily:'var(--mono)'}} value={plain7} onChange={e => { setPlain7(e.target.value); setEncoded7(''); }} placeholder="MyPassword123" />
              </div>
              <button className="btn btn-ghost" onClick={runEncode}>{t('cisco_pwd.encode_btn', 'Encode')}</button>
              {encoded7 && (
                <div style={{marginTop:10,padding:12,background:'var(--panel)',borderLeft:'4px solid var(--muted)',borderRadius:4}}>
                  <div style={{fontSize:11,color:'var(--muted)',marginBottom:4}}>Type-7 hash (randomly seeded):</div>
                  <div style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--text)',letterSpacing:1}}>{encoded7}</div>
                  <div style={{fontSize:10,color:'var(--muted)',marginTop:4}}>Use on device: <code style={{color:'var(--cyan)'}}>username X password 7 {encoded7}</code></div>
                </div>
              )}
            </div>
          </div>

          <div style={{marginTop:16,padding:12,background:'var(--panel)',borderLeft:'4px solid var(--cyan)',borderRadius:4,fontSize:11,color:'var(--muted)',lineHeight:1.5}}>
            <strong style={{color:'var(--text)'}}>Algorithm:</strong> seed = first 2 decimal digits (0–15); for each remaining hex pair at index i: <code>byte XOR key[(seed+i) mod 26]</code>.
            Key: <code style={{color:'var(--cyan)',wordBreak:'break-all'}}>64 73 66 64 3B 6B 66 6F 41 2C 2E 69 79 65 77 72 6B 6C 64 4A 4B 44 48 53 55 42</code>
          </div>
        </div>
      )}
    </div>
  );
}

window.CiscoPasswords = CiscoPasswords;
