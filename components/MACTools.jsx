const { useState, useEffect, useCallback, useRef, useMemo } = React;

function MACTools({ onShare, initialData }) {
  const { t } = useTranslation();
  const [mac, setMac] = usePersistentState('mac:mac', initialData?.mac ?? '00:1A:2B:3C:4D:5E');
  const [result, setResult] = usePersistentState('mac:result', null);
  const [vendor, setVendor] = usePersistentState('mac:vendor', null);
  const [blockType, setBlockType] = usePersistentState('mac:blockType', null);
  const [vendorPrefixLen, setVendorPrefixLen] = usePersistentState('mac:vendorPrefixLen', 6);
  const [vendorLoading, setVendorLoading] = useState(false);
  const [err, setErr] = useState('');

  const parseMac = (s) => {
    const clean = s.replace(/[:\-\.]/g, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(clean)) return null;
    return clean;
  };

  const calc = async (macOverride) => {
    const source = typeof macOverride === 'string' ? macOverride : mac;
    setErr(''); setResult(null); setVendor(null); setBlockType(null); setVendorPrefixLen(6);
    const clean = parseMac(source);
    if (!clean) { setErr(t('mac.err_invalid')); return; }
    const bytes = clean.match(/.{2}/g);
    // EUI-64: insert FF:FE in middle and flip bit 7 of first byte
    const b0 = parseInt(bytes[0], 16) ^ 0x02;
    const eui64 = `${b0.toString(16).padStart(2,'0')}${bytes[1]}:${bytes[2]}ff:fe${bytes[3]}:${bytes[4]}${bytes[5]}`;
    const linkLocal = `fe80::${eui64.match(/.{4}/g).join(':')}`;
    const compressed = IPv6.compress(linkLocal.replace('fe80::','fe80:0000:0000:0000:').replace(/(.{4})(.{4}):(.{4})(.{4})/,'$1:$2:$3:$4'));
    setResult({
      clean,
      formatted: bytes.join(':').toUpperCase(),
      cisco: clean.match(/.{4}/g).join('.').toLowerCase(),
      windows: bytes.join('-').toUpperCase(),
      oui: bytes.slice(0,3).join(':').toUpperCase(),
      nic: bytes.slice(3).join(':').toUpperCase(),
      binary: bytes.map(b => parseInt(b,16).toString(2).padStart(8,'0')).join(':'),
      eui64: eui64,
      linkLocal: `fe80::${eui64}`,
      isMulticast: (parseInt(bytes[0],16) & 0x01) === 1,
      isLocallyAdministered: (parseInt(bytes[0],16) & 0x02) === 2,
    });
    setVendorLoading(true);
    const db = (typeof OUI_DB !== 'undefined') ? OUI_DB : (typeof window !== 'undefined' && window.OUI_DB) ? window.OUI_DB : {};
    // Check MA-S (36-bit/9-char), MA-M (28-bit/7-char), MA-L (24-bit/6-char) in order
    const matchLen = db[clean.slice(0,9)] ? 9 : db[clean.slice(0,7)] ? 7 : db[clean.slice(0,6)] ? 6 : 0;
    setVendor(matchLen ? db[clean.slice(0, matchLen)] : t('mac.unknown_vendor'));
    const resolvedLen = matchLen || 6;
    setVendorPrefixLen(resolvedLen);
    if (matchLen) {
      const types = { 9: 'MA-S (36-bit)', 7: 'MA-M (28-bit)', 6: 'MA-L (24-bit)' };
      const raw = clean.slice(0, matchLen);
      const prefix = raw.match(/.{1,2}/g).join(':');
      setBlockType(`${types[matchLen]} — ${prefix}`);
    }
    setVendorLoading(false);
  };

  const flipBit = (bitPos) => {
    if (!result) return;
    const byteIdx = Math.floor(bitPos / 8);
    const bitInByte = 7 - (bitPos % 8);
    const bytes = result.clean.match(/.{2}/g).map(h => parseInt(h, 16));
    bytes[byteIdx] ^= (1 << bitInByte);
    const newMac = bytes.map(b => b.toString(16).padStart(2,'0').toUpperCase()).join(':');
    setMac(newMac);
    calc(newMac);
  };

  useEffect(() => {
    if (initialData?.mac) {
      setMac(initialData.mac);
      calc(initialData.mac);
    } else {
      calc();
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (mac) (e.detail?.respond ?? onShare)({ tool: 'mac', mac });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [mac, onShare]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('mac.title')}</div>
        <div className="field">
          <label className="label">{t('mac.label')}</label>
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={mac} onChange={e => setMac(e.target.value)}
              onKeyDown={e => e.key==='Enter' && calc()} placeholder={t('mac.placeholder')} />
            <button type="button" className="btn btn-primary" onClick={() => calc()}>{t('mac.analyze')}</button>
          </div>
          <Err msg={err} />
          <div className="hint">{t('mac.hint')}</div>
        </div>
      </div>
      {result && (
        <div className="card fadein">
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
            <CopyBtn text={`${t('mac.canonical')}: ${result.formatted}\n${t('mac.cisco')}: ${result.cisco}\n${t('mac.windows')}: ${result.windows}\n${t('mac.oui')}: ${result.oui}\n${t('mac.nic')}: ${result.nic}\n${t('mac.binary')}: ${result.binary}\n${t('mac.eui64_id')}: ${result.eui64}\n${t('mac.link_local_addr')}: ${result.linkLocal}\n${t('mac.multicast')}: ${result.isMulticast ? t('mac.yes') : t('mac.no')}\n${t('mac.locally_administered')}: ${result.isLocallyAdministered ? t('mac.yes_laa') : t('mac.no_uaa')}`} label="copy_all" id="mac-copy-all" />
          </div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('mac.canonical')} value={result.formatted} accent />
            <ResultItem label={t('mac.cisco')} value={result.cisco} />
            <ResultItem label={t('mac.windows')} value={result.windows} />
            <ResultItem label={t('mac.oui')} value={result.oui} />
            <ResultItem label={t('mac.nic')} value={result.nic} />
            <ResultItem label={t('mac.vendor')} value={vendorLoading ? t('mac.looking_up') : (vendor || '—')} green />
            {blockType && <ResultItem label={t('mac.block_type')} value={blockType} />}
            <ResultItem label={t('mac.multicast')} value={result.isMulticast ? t('mac.yes') : t('mac.no')} red={result.isMulticast} />
            <ResultItem label={t('mac.locally_administered')} value={result.isLocallyAdministered ? t('mac.yes_laa') : t('mac.no_uaa')} yellow={result.isLocallyAdministered} />
          </div>
          <div className="card-title" style={{marginTop:16}}>{t('mac.eui64_link_local')}</div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('mac.eui64_id')} value={result.eui64} />
            <ResultItem label={t('mac.link_local_addr')} value={result.linkLocal} accent />
          </div>
          {(() => {
            const vendorBits = vendorPrefixLen * 4;
            const eui64Bytes = result.eui64.replace(/:/g,'').match(/.{2}/g)
              .map(h => parseInt(h,16).toString(2).padStart(8,'0'));
            const vendorBitsInNic = Math.max(0, vendorBits - 24);
            const swatch = (color) => (
              <span style={{display:'inline-block',width:8,height:8,background:color,borderRadius:1,verticalAlign:'middle',marginRight:3}}/>
            );
            const renderByte = (oct, byteIdx, opts = {}) => {
              const { vendorBitStart = 0, vendorBitCount = 0, fffeStyle = false, ulByte = -1, onBitClick } = opts;
              return oct.split('').map((b, bi) => {
                const isUL = byteIdx === ulByte && bi === 6;
                const bitPos = byteIdx * 8 + bi;
                const inVendor = bitPos >= vendorBitStart && bitPos < vendorBitStart + vendorBitCount;
                const color = isUL ? 'var(--yellow)'
                  : fffeStyle ? (b === '1' ? 'var(--yellow)' : 'var(--dim)')
                  : inVendor ? 'var(--cyan)'
                  : b === '1' ? 'var(--text)' : 'var(--dim)';
                return <span key={bi} style={{color, cursor: onBitClick ? 'pointer' : 'default', padding: '0 1px'}}
                  onClick={onBitClick ? () => onBitClick(bitPos) : undefined}>{b}</span>;
              });
            };
            return (
              <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 14px',marginTop:12}}>
                {/* MAC binary — vendor/NIC boundary */}
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                  <div style={{display:'flex',gap:10,fontSize:9,color:'var(--dim)',flexWrap:'wrap'}}>
                    <span>{swatch('var(--cyan)')}{t('mac.oui')}</span>
                    <span>{swatch('var(--text)')}{t('mac.nic')}</span>
                    <span>{swatch('var(--yellow)')}{t('mac.ul_bit')}</span>
                  </div>
                  <CopyBtn text={result.binary} label="copy" />
                </div>
                <div style={{fontFamily:'var(--mono)',fontSize:11,letterSpacing:1,display:'flex',flexWrap:'wrap',gap:'4px 0',marginBottom:14}}>
                  {result.binary.split(':').map((oct, i) => (
                    <span key={i} style={{display:'inline-block'}}>
                      {renderByte(oct, i, { vendorBitStart: 0, vendorBitCount: vendorBits, ulByte: 0, onBitClick: flipBit })}
                      {i < 5 && <span style={{color:'var(--border)',margin:'0 2px'}}>:</span>}
                    </span>
                  ))}
                </div>
                {/* EUI-64 construction */}
                <div style={{borderTop:'1px solid var(--border)',paddingTop:10}}>
                  <div style={{fontSize:9,color:'var(--dim)',textTransform:'uppercase',letterSpacing:0.5,marginBottom:8}}>EUI-64</div>
                  <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                    <div style={{border:'1px solid var(--cyan)',borderRadius:'var(--radius)',padding:'4px 8px'}}>
                      <div style={{fontSize:9,color:'var(--cyan)',marginBottom:4}}>OUI &nbsp;<span style={{color:'var(--yellow)'}}>U/L↑</span></div>
                      <div style={{fontFamily:'var(--mono)',fontSize:11,display:'flex'}}>
                        {eui64Bytes.slice(0,3).map((oct,i) => (
                          <span key={i} style={{display:'inline-block'}}>
                            {renderByte(oct, i, { vendorBitStart: 0, vendorBitCount: 24, ulByte: 0 })}
                            {i < 2 && <span style={{color:'var(--border)',margin:'0 2px'}}>:</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{border:'1px solid var(--yellow)',borderRadius:'var(--radius)',padding:'4px 8px'}}>
                      <div style={{fontSize:9,color:'var(--yellow)',marginBottom:4}}>FF:FE</div>
                      <div style={{fontFamily:'var(--mono)',fontSize:11,display:'flex'}}>
                        {eui64Bytes.slice(3,5).map((oct,i) => (
                          <span key={i} style={{display:'inline-block'}}>
                            {renderByte(oct, i, { fffeStyle: true })}
                            {i < 1 && <span style={{color:'var(--border)',margin:'0 2px'}}>:</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div style={{border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'4px 8px'}}>
                      <div style={{fontSize:9,color:'var(--dim)',marginBottom:4}}>
                        {t('mac.nic')}{vendorBitsInNic > 0 && <span style={{color:'var(--cyan)',marginLeft:4}}>+{vendorBitsInNic}b ext</span>}
                      </div>
                      <div style={{fontFamily:'var(--mono)',fontSize:11,display:'flex'}}>
                        {eui64Bytes.slice(5,8).map((oct,i) => (
                          <span key={i} style={{display:'inline-block'}}>
                            {renderByte(oct, i, { vendorBitStart: 0, vendorBitCount: vendorBitsInNic })}
                            {i < 2 && <span style={{color:'var(--border)',margin:'0 2px'}}>:</span>}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
                {/* Explanations */}
                <div style={{marginTop:10,display:'flex',flexDirection:'column',gap:4}}>
                  <div className="hint" style={{marginBottom:0}}>
                    <span style={{color:'var(--cyan)',fontWeight:600}}>OUI</span> — {t('mac.eui64_oui_desc')}
                  </div>
                  <div className="hint" style={{marginBottom:0}}>
                    <span style={{color:'var(--yellow)',fontWeight:600}}>FF:FE</span> — {t('mac.eui64_fffe_desc')}
                  </div>
                  <div className="hint" style={{marginBottom:0}}>
                    <span style={{fontWeight:600}}>{t('mac.nic')}</span> — {vendorBitsInNic > 0
                      ? t('mac.eui64_nic_ext_desc').replace('{n}', vendorBitsInNic).replace('{type}', blockType ? blockType.split('—')[0].trim() : '')
                      : t('mac.eui64_nic_desc')}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

// ─── Tool: IPv6 Subnet Calculator ────────────────────────────
window.MACTools = MACTools;
