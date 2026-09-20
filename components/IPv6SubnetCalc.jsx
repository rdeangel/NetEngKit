const { useState, useEffect, useCallback, useRef, useMemo } = React;

function IPv6SubnetCalc({ initialData, onShare }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('ipv6subnet:input', initialData?.input || '2001:db8::/32');
  const [result, setResult] = usePersistentState('ipv6subnet:result', null);
  const [err, setErr] = useState('');

  const bigIntToHex = (n, pad=32) => n.toString(16).padStart(pad,'0');
  const hexToGroups = h => h.match(/.{4}/g).join(':');

  const calc = (overrideInput) => {
    const val = typeof overrideInput === 'string' ? overrideInput : input;
    setErr('');
    const parts = val.trim().split('/');
    if (parts.length !== 2) { setResult(null); return; }
    const expanded = IPv6.expand(parts[0]);
    const prefix = parseInt(parts[1]);
    if (!expanded) { setResult(null); setErr(t('ipv6.err_invalid_addr')); return; }
    if (isNaN(prefix) || prefix < 0 || prefix > 128) { setResult(null); setErr(t('ipv6.err_prefix')); return; }
    // Convert to BigInt
    const addrHex = expanded.replace(/:/g,'');
    const addrInt = BigInt('0x' + addrHex);
    const maxInt = (BigInt(1) << BigInt(128)) - BigInt(1);
    const maskBits = prefix === 0 ? BigInt(0) : ((BigInt(1) << BigInt(128)) - BigInt(1)) - ((BigInt(1) << BigInt(128 - prefix)) - BigInt(1));
    const networkInt = addrInt & maskBits;
    const broadcastInt = networkInt | ((BigInt(1) << BigInt(128 - prefix)) - BigInt(1));
    const networkHex = bigIntToHex(networkInt);
    const broadcastHex = bigIntToHex(broadcastInt);
    const networkStr = IPv6.compress(hexToGroups(networkHex));
    const lastStr = IPv6.compress(hexToGroups(broadcastHex));
    const totalStr = prefix <= 64 ? `2^${128-prefix} (≈ ${prefix <= 64 ? '10^' + Math.floor((128-prefix)*Math.log10(2)) : ''})` : (BigInt(1) << BigInt(128-prefix)).toLocaleString();
    const hostsStr = prefix >= 127 ? (prefix===128?'1':'2') : prefix <= 64 ? `2^${128-prefix}` : ((BigInt(1) << BigInt(128-prefix)) - BigInt(2)).toLocaleString();
    const info = IPv6.classify(parts[0]);
    setResult({ networkStr, lastStr, totalStr, hostsStr, prefix, expanded, compressed: IPv6.compress(parts[0]), info });
  };

  useEffect(() => {
    if (initialData?.input) {
      setInput(initialData.input);
      calc(initialData.input);
    }
  }, [initialData]);

  // Auto-calculate when input changes and is valid
  useEffect(() => {
    const timer = setTimeout(() => calc(), 300);
    return () => clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (result) (e.detail?.respond ?? onShare)({ tool:'ipv6subnet', input });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [result, input, onShare]);

  const dotted = useMemo(() => {
    if (!result) return '';
    const hex = result.expanded.replace(/:/g, '');
    const bin = BigInt('0x' + hex).toString(2).padStart(128, '0');
    return bin.match(/.{16}/g).map(g => g.match(/.{4}/g).join('.')).join(' : ');
  }, [result]);

  const flipBit = (bitPos) => {
    if (!result) return;
    const hex = result.expanded.replace(/:/g, '');
    const addrInt = BigInt('0x' + hex);
    const flipped = addrInt ^ (BigInt(1) << BigInt(127 - bitPos));
    const newHex = flipped.toString(16).padStart(32, '0');
    const newExpanded = newHex.match(/.{4}/g).join(':');
    const newCompressed = IPv6.compress(newExpanded);
    setInput(newCompressed + '/' + result.prefix);
  };

  const exportRows = useMemo(() => result ? [
    { Field: t('subnet.network_addr'), Value: result.networkStr },
    { Field: t('ipv6.last_addr'), Value: result.lastStr },
    { Field: t('subnet.total_addr'), Value: result.totalStr },
    { Field: t('subnet.usable_hosts'), Value: result.hostsStr },
    { Field: t('supernet.prefix_length'), Value: `/${result.prefix}` },
    { Field: t('ipv6.addr_type'), Value: result.info?.type || 'Unknown' },
    { Field: t('subnet.scope'), Value: result.info?.scope || '-' },
    { Field: t('subnet.rfc'), Value: result.info?.rfc || '-' },
    { Field: t('ipv6.full_expanded'), Value: result.expanded + `/${result.prefix}` },
    { Field: t('ipv6.compressed'), Value: result.compressed + `/${result.prefix}` },
    { Field: t('ipv6.binary'), Value: dotted },
  ] : [], [result, dotted]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('ipv6.cidr_label')}</div>
        <div className="field">
          <div className="input-row">
            <input className={`input ${err?'error':''}`} value={input} onChange={e => setInput(e.target.value)}
              placeholder="2001:db8::/32" />
          </div>
          <Err msg={err} />
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {['::1/128','::/0','fe80::/10','fc00::/7','fd00::/8','2001:db8::/32','2001:db8:1::/48','2001:db8:1:1::/64','2001::/32','64:ff9b::/96','100::/64'].map(p => (
            <button key={p} className="btn btn-ghost btn-sm" onClick={() => setInput(p)}>{p}</button>
          ))}
        </div>
      </div>
      {result && (() => {
        const copyAllText = [
          `${t('subnet.network_addr')}: ${result.networkStr}`,
          `${t('ipv6.last_addr')}: ${result.lastStr}`,
          `${t('subnet.total_addr')}: ${result.totalStr}`,
          `${t('subnet.usable_hosts')}: ${result.hostsStr}`,
          `${t('supernet.prefix_length')}: /${result.prefix}`,
          `${t('ipv6.addr_type')}: ${result.info?.type || 'Unknown'}`,
          `${t('subnet.scope')}: ${result.info?.scope || '-'}`,
          `${t('subnet.rfc')}: ${result.info?.rfc || '-'}`,
          `${t('ipv6.full_expanded')}: ${result.expanded}/${result.prefix}`,
          `${t('ipv6.compressed')}: ${result.compressed}/${result.prefix}`,
          `${t('ipv6.binary')}: ${dotted}`,
        ].join('\n');

        return <>
        <div className="card fadein">
          <div className="card-title">{t('common.results')} — /{result.prefix}</div>
          <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
            <CopyBtn text={copyAllText} label="copy_all" id="ipv6-copy-all" />
          </div>
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('subnet.network_addr')} value={result.networkStr} accent />
            <ResultItem label={t('ipv6.last_addr')} value={result.lastStr} red />
            <ResultItem label={t('subnet.total_addr')} value={result.totalStr} />
            <ResultItem label={t('subnet.usable_hosts')} value={result.hostsStr} green />
            <ResultItem label={t('supernet.prefix_length')} value={`/${result.prefix}`} />
            <ResultItem label={t('ipv6.addr_type')} value={result.info?.type || 'Unknown'} />
            <ResultItem label={t('subnet.scope')} value={result.info?.scope || '-'} />
            <ResultItem label={t('subnet.rfc')} value={result.info?.rfc || '-'} />
          </div>
          <div className="card-title" style={{marginTop:16}}>{t('ipv6.expanded_compressed')}</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            <ResultItem label={t('ipv6.compressed')} value={result.compressed + `/${result.prefix}`} accent />
            <ResultItem label={t('ipv6.full_expanded')} value={result.expanded + `/${result.prefix}`} />
          </div>
          <div className="card-title" style={{marginTop:16}}>{t('ipv6.binary')}</div>
          <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 14px'}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <span style={{fontSize:10,opacity:.45}}>{t('ipv6.binary')} — {t('ipv6.binary_hint')}</span>
              <CopyBtn text={dotted} label="copy" />
            </div>
            {(() => {
              const hex = result.expanded.replace(/:/g,'');
              const addrInt = BigInt('0x'+hex);
              const prefix = result.prefix;
              const maskBigInt = prefix === 0 ? BigInt(0) : ((BigInt(1) << BigInt(128)) - BigInt(1)) - ((BigInt(1) << BigInt(128 - prefix)) - BigInt(1));
              const networkBigInt = addrInt & maskBigInt;
              const addrBin    = addrInt.toString(2).padStart(128,'0');
              const maskBin    = maskBigInt.toString(2).padStart(128,'0');
              const networkBin = networkBigInt.toString(2).padStart(128,'0');

              const flipMaskBit = (i, bit) => {
                const newPrefix = Math.max(0, Math.min(128, bit === '1' ? i : i + 1));
                setInput(result.compressed + '/' + newPrefix);
              };

              const DRAG_PX_PER_BIT = 8;
              const makeSep = () => (
                <span
                  key="mask-sep"
                  style={{color:'var(--yellow)',fontWeight:900,margin:'0 2px',fontSize:13,cursor:'col-resize',touchAction:'none',userSelect:'none'}}
                  onPointerDown={e => {
                    e.preventDefault();
                    const startX = e.clientX;
                    const startPfx = prefix;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    const onMove = me => {
                      const newPfx = Math.max(0, Math.min(128, startPfx + Math.round((me.clientX - startX) / DRAG_PX_PER_BIT)));
                      setInput(result.compressed + '/' + newPfx);
                    };
                    const onUp = () => {
                      window.removeEventListener('pointermove', onMove);
                      window.removeEventListener('pointerup', onUp);
                    };
                    window.addEventListener('pointermove', onMove);
                    window.addEventListener('pointerup', onUp);
                  }}
                >|</span>
              );

              const renderRow = (label, labelColor, binStr, getColor, onClick) => {
                const spans = [];
                for (let i = 0; i < 128; i++) {
                  if (i === prefix) spans.push(makeSep());
                  else if (i > 0 && i % 16 === 0) spans.push(<span key={`g${i}`} style={{color:'var(--border)',margin:'0 3px'}}> : </span>);
                  else if (i > 0 && i % 4 === 0) spans.push(<span key={`d${i}`} style={{color:'var(--dim)',opacity:.5}}>.</span>);
                  const bit = binStr[i];
                  spans.push(<span key={i} style={{color:getColor(i,bit),cursor:onClick?'pointer':'default',userSelect:'none'}} onClick={onClick ? () => onClick(i, bit) : undefined}>{bit}</span>);
                }
                if (prefix === 128) spans.push(makeSep());
                return (
                  <div style={{marginBottom:4}}>
                    <div style={{fontSize:9,fontWeight:700,color:labelColor,marginBottom:2,textTransform:'uppercase',letterSpacing:.5}}>{label}</div>
                    <div style={{fontFamily:'var(--mono)',fontSize:11,letterSpacing:1,lineHeight:2.2,wordBreak:'break-all'}}>{spans}</div>
                  </div>
                );
              };

              return <>
                {renderRow(t('ipv6.binary_addr'), 'var(--fg)', addrBin, (i,b) => i < prefix ? 'var(--cyan)' : b==='1' ? 'var(--fg)' : 'var(--dim)', (i, b) => flipBit(i))}
                <div style={{fontSize:10,fontWeight:700,fontFamily:'var(--mono)',opacity:.3,margin:'2px 0'}}>AND</div>
                {renderRow(t('ipv6.binary_mask'), 'var(--yellow)', maskBin, (_,b) => b==='1' ? 'var(--cyan)' : 'var(--dim)', flipMaskBit)}
                <div style={{fontSize:10,fontWeight:700,fontFamily:'var(--mono)',opacity:.3,margin:'2px 0'}}>=</div>
                {renderRow(t('ipv6.binary_network'), 'var(--green)', networkBin, (i,_) => i < prefix ? 'var(--cyan)' : 'var(--dim)', null)}
              </>;
            })()}
          </div>
        </div>
        </>;
      })()}

      {/* Address Format */}
      <div className="card">
        <div className="card-title">{t('ipv6.addr_format')}</div>
        <p style={{fontSize:12, opacity:.6, marginBottom:12}}>{t('ipv6.addr_format_128')}</p>

        {/* Three notation examples — from calculated address or fallback */}
        {(() => {
          const full = result?.expanded || '2001:0db8:0000:0000:0000:0000:0000:0001';
          // Leading zeros removed: strip leading zeros per hextet
          const leading = full.split(':').map(h => parseInt(h, 16).toString(16)).join(':');
          // Compressed: replace longest run of zero hextets with ::
          const groups = full.split(':');
          let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0;
          groups.forEach((g, i) => {
            if (g === '0000') { if (curStart === -1) curStart = i; curLen++; }
            else { if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; } curStart = -1; curLen = 0; }
          });
          if (curLen > bestLen) { bestStart = curStart; bestLen = curLen; }
          const compressed = bestLen > 1
            ? [...groups.slice(0, bestStart).map(h => parseInt(h, 16).toString(16)), '', ...groups.slice(bestStart + bestLen).map(h => parseInt(h, 16).toString(16))].join(':').replace(':::', '::').replace(':::', '::')
            : leading;
          return [
            { label: t('ipv6.addr_format_full'),      addr: full },
            { label: t('ipv6.addr_format_leading'),    addr: leading },
            { label: t('ipv6.addr_format_compressed'), addr: compressed },
          ];
        })().map((ex, i) => (
          <div key={i} style={{marginBottom: i < 2 ? 10 : 0, padding:'8px 12px', background:'var(--bg)', borderRadius:'var(--radius)', border:'1px solid var(--border)'}}>
            <div style={{fontSize:11, fontWeight:600, opacity:.5, marginBottom:4}}>{ex.label}</div>
            <div style={{fontSize:13, fontFamily:'monospace', color:'var(--cyan)'}}>{ex.addr}</div>
          </div>
        ))}

        {/* Compression Rules */}
        <div className="card-title" style={{marginTop:16}}>{t('ipv6.addr_format_rules')}</div>
        <div style={{display:'grid', gridTemplateColumns:'1fr 1fr', gap:12}}>
          {/* Do */}
          <div style={{padding:12, borderRadius:'var(--radius)', border:'1px solid #4ade8033', background:'#4ade800a'}}>
            <div style={{fontSize:12, fontWeight:700, color:'#4ade80', marginBottom:8}}>{t('ipv6.addr_format_do')}</div>
            {[1,2,3].map(n => (
              <div key={n} style={{fontSize:12, opacity:.75, lineHeight:1.8, display:'flex', gap:6}}>
                <span style={{color:'#4ade80', fontWeight:700}}>&#10003;</span>
                <span>{t(`ipv6.addr_format_do_${n}`)}</span>
              </div>
            ))}
          </div>
          {/* Don't */}
          <div style={{padding:12, borderRadius:'var(--radius)', border:'1px solid #f8717133', background:'#f871710a'}}>
            <div style={{fontSize:12, fontWeight:700, color:'#f87171', marginBottom:8}}>{t('ipv6.addr_format_dont')}</div>
            {[1,2,3].map(n => (
              <div key={n} style={{fontSize:12, opacity:.75, lineHeight:1.8, display:'flex', gap:6}}>
                <span style={{color:'#f87171', fontWeight:700}}>&#10007;</span>
                <span>{t(`ipv6.addr_format_dont_${n}`)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Global Unicast Address Format */}
      <div className="card">
        <div className="card-title">{t('ipv6.gua_title')}</div>
        {(() => {
          // Extract field values from expanded address when available
          const hex = result?.expanded?.replace(/:/g, '') || null; // 32 hex chars = 128 bits
          // Extract field values
          const getField = (startBit, bitCount, base) => {
            if (!hex) return null;
            const addrInt = BigInt('0x' + hex);
            const mask = (BigInt(1) << BigInt(bitCount)) - BigInt(1);
            const val = (addrInt >> BigInt(128 - startBit - bitCount)) & mask;
            if (base === 2) return val.toString(2).padStart(bitCount, '0');
            return val.toString(16).padStart(Math.ceil(bitCount / 4), '0');
          };
          const prefix3Hex = getField(0, 3, 16);
          const routingHex = getField(3, 45, 16);
          const subnetHex = getField(48, 16, 16);
          const interfaceHex = getField(64, 64, 16);
          const prefix3Bin = getField(0, 3, 2);
          const routingBin = getField(3, 45, 2);
          const subnetBin = getField(48, 16, 2);
          const interfaceBin = getField(64, 64, 2);
          // Format hex as hextets for readability
          const fmtHex = (h, groupSize) => h ? h.match(new RegExp(`.{1,${groupSize}}`, 'g')).join(':').replace(/(^|:)(0{1,3})(?=[0-9a-f])/gi, '$1') : null;
          const routingHexFmt = routingHex ? routingHex.match(/.{1,4}/g).join(':').replace(/(^|:)(0{1,3})(?=[0-9a-f])/gi, '$1') : null;
          const subnetHexFmt = subnetHex ? subnetHex.match(/.{4}/g)?.join(':') : null;
          const interfaceHexFmt = interfaceHex ? interfaceHex.match(/.{4}/g).join(':') : null;

          const fields = [
            { bits: 3,  startBit: 0,  label: '001',                        color: '#f97316', range: '0–2',     hexFmt: prefix3Hex,          bin: prefix3Bin,    key: 'gua_prefix_desc',    badge: result?.info?.type ? `/0–3 \u2192 ${result.info.type}` : '/0–3'  },
            { bits: 45, startBit: 3,  label: t('ipv6.gua_routing_bits'),   color: '#22d3ee', range: '3–47',    hexFmt: routingHexFmt,       bin: routingBin,    key: 'gua_routing_desc',   badge: '/48'   },
            { bits: 16, startBit: 48, label: t('ipv6.gua_subnet_bits'),    color: '#a78bfa', range: '48–63',   hexFmt: subnetHexFmt,        bin: subnetBin,     key: 'gua_subnet_desc',    badge: '/64'   },
            { bits: 64, startBit: 64, label: t('ipv6.gua_interface_bits'), color: '#4ade80', range: '64–127',  hexFmt: interfaceHexFmt,     bin: interfaceBin,  key: 'gua_interface_desc', badge: '/128'  },
          ];

          return <>
            {/* Hex overview bar */}
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4}}>
              <span style={{fontSize:10, fontWeight:600, opacity:.4}}>Hexadecimal</span>
            </div>
            <div style={{display:'flex', borderRadius:6, overflow:'hidden', border:'1px solid var(--border)', marginBottom:0}}>
              {fields.map((seg, i) => (
                <div key={i} style={{
                  flex: seg.bits,
                  background: seg.color + '22',
                  borderRight: i < 3 ? `1px solid ${seg.color}55` : 'none',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  padding: '8px 4px', minWidth: seg.bits < 10 ? 38 : 0,
                  gap: 2,
                }}>
                  <span style={{fontSize: seg.bits < 10 ? 13 : 11, fontWeight:800, color: seg.color, letterSpacing: seg.bits < 10 ? 1 : 0, textAlign:'center', lineHeight:1.2}}>
                    {seg.label}
                  </span>
                  {seg.hexFmt ? (
                    <span style={{fontSize:9, fontWeight:600, color: seg.color, opacity:.85, wordBreak:'break-all', textAlign:'center', lineHeight:1.3, padding:'0 2px', fontFamily:'monospace'}}>
                      {seg.hexFmt}
                    </span>
                  ) : (
                    <span style={{fontSize:10, fontWeight:600, color: seg.color, opacity:.7}}>
                      {seg.bits}b
                    </span>
                  )}
                </div>
              ))}
            </div>

            {/* Bit position ruler */}
            <div style={{display:'flex', marginTop:2, marginBottom:14, fontSize:9, color:'var(--dim)', opacity:.5, position:'relative'}}>
              <span style={{flex:3, textAlign:'left', paddingLeft:2}}>0</span>
              <span style={{flex:45, textAlign:'center'}}>3</span>
              <span style={{flex:16, textAlign:'center'}}>48</span>
              <span style={{flex:64, textAlign:'right', paddingRight:2}}>127</span>
            </div>

            {/* Binary field cards */}
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4}}>
              <span style={{fontSize:10, fontWeight:600, opacity:.4}}>Binary</span>
            </div>
            {fields.map((f, i) => (
              <div key={i} style={{
                display:'flex', alignItems:'stretch',
                borderRadius:8, overflow:'hidden',
                border:`1px solid ${f.color}33`,
                marginBottom: i < 3 ? 8 : 0,
                background: f.color + '0a',
              }}>
                {/* Left color stripe + bit count */}
                <div style={{
                  width: 52, minWidth: 52,
                  background: f.color + '22',
                  borderRight: `2px solid ${f.color}55`,
                  display:'flex', flexDirection:'column',
                  alignItems:'center', justifyContent:'center',
                  padding:'8px 4px', gap:2,
                }}>
                  <span style={{fontSize:15, fontWeight:900, color: f.color, lineHeight:1}}>{f.bits}</span>
                  <span style={{fontSize:9, color: f.color, opacity:.7, fontWeight:600}}>bits</span>
                  <span style={{fontSize:9, color: f.color, opacity:.55, marginTop:2, textAlign:'center'}}>{f.range}</span>
                </div>
                {/* Content */}
                <div style={{padding:'10px 12px', flex:1}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:4, flexWrap:'wrap'}}>
                    <span style={{fontSize:13, fontWeight:700, color: f.color}}>{f.title}</span>
                    <span style={{fontSize:10, background: f.color+'22', color: f.color, borderRadius:4, padding:'1px 6px', fontWeight:700, opacity:.8}}>{f.badge}</span>
                  </div>
                  {f.bin && (
                    <div style={{fontSize:10, fontFamily:'monospace', color: f.color, opacity:.8, marginBottom:4, wordBreak:'break-all', lineHeight:1.5, background: f.color+'11', padding:'4px 8px', borderRadius:4, letterSpacing:.5}}>
                      {(() => {
                        const nibbleOffset = f.startBit % 4;
                        if (nibbleOffset === 0 || f.bits <= 4) return f.bin.match(/.{1,4}/g).join(' ');
                        // First group is partial nibble, rest are 4-bit groups
                        const first = f.bin.slice(0, 4 - nibbleOffset);
                        const rest = f.bin.slice(4 - nibbleOffset).match(/.{4}/g);
                        return [first, ...(rest || [])].join(' ');
                      })()}
                    </div>
                  )}
                  <div style={{fontSize:12, opacity:.65, lineHeight:1.6}}>{t(`ipv6.${f.key}`)}</div>
                </div>
              </div>
            ))}
          </>;
        })()}

        <p style={{fontSize:12, opacity:.5, marginTop:12, lineHeight:1.6}}>{t('ipv6.gua_allocation')}</p>
      </div>

      {result && (
        <div className="card fadein">
          <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8}}>
            <div className="card-title" style={{margin:0}}>{t('ipv6.common_subprefixes', { prefix: result.prefix })}</div>
            <div style={{display:'flex',gap:4}}>
              <button className="btn btn-ghost btn-sm" onClick={() => exportJSON(
                [4,8,16].map(delta => { const np = result.prefix + delta; if (np > 128) return null; return { prefix: `/${np}`, subnets: Math.pow(2,delta).toLocaleString(), addrs_each: np<=64?`2^${128-np}`:np<=126?(Math.pow(2,128-np)).toLocaleString():np===127?'2':'1' }; }).filter(Boolean),
                'ipv6-subprefixes.json'
              )}>{t('common.export_json')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(
                [4,8,16].map(delta => { const np = result.prefix + delta; if (np > 128) return null; return { prefix: `/${np}`, subnets: Math.pow(2,delta).toLocaleString(), addrs_each: np<=64?`2^${128-np}`:np<=126?(Math.pow(2,128-np)).toLocaleString():np===127?'2':'1' }; }).filter(Boolean),
                'ipv6-subprefixes.csv'
              )}>{t('common.export_csv')}</button>
            </div>
          </div>
          <div className="table-wrap hide-mobile">
            <table><thead><tr><th>{t('supernet.prefix_length')}</th><th>{t('ipv6.subnets')}</th><th>{t('ipv6.addr_each')}</th></tr></thead>
            <tbody>
              {[4,8,16].map(delta => {
                const np = result.prefix + delta;
                if (np > 128) return null;
                return <tr key={delta}><td style={{color:'var(--cyan)'}}>/{np}</td><td>{Math.pow(2,delta).toLocaleString()}</td><td>{np<=64?`2^${128-np}`:np<=126?(Math.pow(2,128-np)).toLocaleString():np===127?'2':'1'}</td></tr>;
              }).filter(Boolean)}
            </tbody></table>
          </div>
          <div className="show-mobile mobile-cards">
            {[4,8,16].map(delta => {
              const np = result.prefix + delta;
              if (np > 128) return null;
              return (
                <div key={delta} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('supernet.prefix_length')}</span>
                    <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>/{np}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('common.results')}</span>
                    <span className="mobile-card-value">{Math.pow(2,delta).toLocaleString()} / {np<=64?`2^${128-np}`:np<=126?(Math.pow(2,128-np)).toLocaleString():np===127?'2':'1'}</span>
                  </div>
                </div>
              );
            }).filter(Boolean)}
          </div>
        </div>
      )}

      {/* Common IPv6 Addresses Reference */}
      {(() => {
        const [addrTab, setAddrTab] = useState('special');
        const tabs = [
          { id: 'special', label: t('ipv6.tab_special') },
          { id: 'scoped', label: t('ipv6.tab_scoped') },
          { id: 'transition', label: t('ipv6.tab_transition') },
          { id: 'multicast', label: t('ipv6.tab_multicast') },
          { id: 'dns', label: t('ipv6.tab_dns') },
          { id: 'dns_v4', label: t('ipv6.tab_dns_v4') },
        ];
        const specialAddrs = [
          { addr: '::', name: t('ipv6.addr_unspecified'), desc: t('ipv6.addr_specified'), v4: '0.0.0.0' },
          { addr: '::1', name: t('ipv6.addr_loopback'), desc: t('ipv6.addr_loopback'), v4: '127.0.0.1' },
          { addr: '::ffff:0:0/96', name: t('ipv6.addr_ipv4_mapped'), desc: t('ipv6.addr_ipv4_mapped'), v4: '—' },
          { addr: '64:ff9b::/96', name: t('ipv6.addr_nat64'), desc: t('ipv6.addr_nat64'), v4: '—' },
          { addr: '2001:db8::/32', name: t('ipv6.addr_doc'), desc: t('ipv6.addr_doc'), v4: '192.0.2.0/24' },
          { addr: '2001:2::/48', name: t('ipv6.addr_benchmarking'), desc: t('ipv6.addr_benchmarking_desc'), v4: '198.18.0.0/15' },
        ];
        const scopedAddrs = [
          { addr: 'fe80::/10', name: t('ipv6.addr_link_local'), desc: t('ipv6.addr_link_local_desc'), v4: '169.254.0.0/16' },
          { addr: 'fc00::/7', name: t('ipv6.addr_unique_local'), desc: t('ipv6.addr_unique_local_desc'), v4: '10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16' },
          { addr: '2000::/3', name: t('ipv6.gua_title_short'), desc: t('ipv6.gua_routing_bits'), v4: t('ipv6.v4_public') },
        ];
        const transitionAddrs = [
          { addr: '2002::/16', name: t('ipv6.addr_6to4'), desc: t('ipv6.addr_6to4_desc'), v4: '—' },
          { addr: '2001::/32', name: t('ipv6.addr_teredo'), desc: t('ipv6.addr_teredo_desc'), v4: '—' },
          { addr: '2001:20::/28', name: t('ipv6.addr_orchid'), desc: t('ipv6.addr_orchid_desc'), v4: '—' },
          { addr: '::ffff:0:0/96', name: t('ipv6.addr_ipv4_mapped'), desc: t('ipv6.addr_ipv4_mapped'), v4: '—' },
          { addr: '64:ff9b::/96', name: t('ipv6.addr_nat64'), desc: t('ipv6.addr_nat64'), v4: '—' },
          { addr: '::ffff:0:0:0/96', name: t('ipv6.addr_v4_trans'), desc: t('ipv6.addr_v4_trans_desc'), v4: '—' },
          { addr: '64:ff9b:1::/48', name: t('ipv6.addr_well_known'), desc: t('ipv6.addr_well_known_desc'), v4: '—' },
        ];
        const multicastAddrs = [
          { addr: 'ff00::/8', name: t('ipv6.addr_multicast'), desc: t('ipv6.addr_multicast_desc'), v4: '224.0.0.0/4' },
          { addr: 'ff02::1', name: t('ipv6.addr_all_nodes'), desc: t('ipv6.addr_all_nodes_desc'), v4: '224.0.0.1' },
          { addr: 'ff02::2', name: t('ipv6.addr_all_routers'), desc: t('ipv6.addr_all_routers_desc'), v4: '224.0.0.2' },
          { addr: 'ff02::1:ff00:0/104', name: t('ipv6.addr_sol_multicast'), desc: t('ipv6.addr_sol_multicast_desc'), v4: '—' },
          { addr: 'ff02::1:2', name: t('ipv6.addr_dhcp_agents'), desc: t('ipv6.addr_dhcp_agents_desc'), v4: '—' },
          { addr: 'ff05::1:3', name: t('ipv6.addr_dhcp_servers'), desc: t('ipv6.addr_dhcp_servers_desc'), v4: '—' },
        ];
        const dnsAddrs = (window.DOH_PROVIDERS || [])
          .filter(p => p.ips_v6.length > 0)
          .flatMap(p => p.ips_v6.map((addr, i) => ({
            addr,
            name: p.name,
            desc: p.desc,
            v4: p.ips_v4[i] || '—',
          })));

        const dnsV4Addrs = (window.DOH_PROVIDERS || [])
          .filter(p => p.ips_v4.length > 0)
          .flatMap(p => p.ips_v4.map((addr, i) => ({
            addr,
            name: p.name,
            desc: p.desc,
            v6: p.ips_v6[i] || '—',
          })));
        const tabData = { special: specialAddrs, scoped: scopedAddrs, transition: transitionAddrs, multicast: multicastAddrs, dns: dnsAddrs, dns_v4: dnsV4Addrs };
        const data = tabData[addrTab] || [];
        const isDnsV4Tab = addrTab === 'dns_v4';
        return (
          <div className="card">
            <div className="card-title">{t('ipv6.common_addrs')}</div>
            <div style={{display:'flex', gap:0, marginBottom:12, borderBottom:'1px solid var(--border)'}}>
              {tabs.map(tab => (
                <button key={tab.id} onClick={() => setAddrTab(tab.id)} style={{
                  background: addrTab === tab.id ? 'var(--card)' : 'transparent',
                  border: '1px solid var(--border)',
                  borderBottom: addrTab === tab.id ? '1px solid var(--card)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius) var(--radius) 0 0',
                  color: addrTab === tab.id ? 'var(--fg)' : 'var(--dim)',
                  padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                  marginBottom: -1, position: 'relative',
                }}>{tab.label}</button>
              ))}
            </div>
            <div className="table-wrap hide-mobile">
              <table>
                <thead><tr>
                  <th>{isDnsV4Tab ? t('ipv6.addr_ipv4') : t('common.th_address')}</th>
                  <th>{t('ipv6.addr_name')}</th>
                  <th>{t('ipv6.addr_desc')}</th>
                  <th>{isDnsV4Tab ? t('common.th_address') : t('ipv6.addr_ipv4')}</th>
                </tr></thead>
                <tbody>
                  {data.map((row, i) => {
                    const secondary = isDnsV4Tab ? row.v6 : row.v4;
                    const secCidr = isDnsV4Tab && secondary && secondary !== '—'
                      ? (secondary.includes('/') ? secondary : secondary + '/128')
                      : null;
                    return (
                    <tr key={i}>
                      <td style={{fontFamily:'monospace', fontSize:12, color:'var(--cyan)', whiteSpace:'nowrap'}}>
                        {isDnsV4Tab
                          ? <span style={{userSelect:'all'}}>{row.addr}</span>
                          : <a href="#" onClick={e => { e.preventDefault(); setInput(row.addr.includes('/') ? row.addr : row.addr + '/128'); }} style={{color:'inherit',textDecoration:'none',cursor:'pointer',borderBottom:'1px dashed var(--cyan)'}} title={t('ipv6.load_addr')}>{row.addr}</a>
                        }
                      </td>
                      <td style={{fontWeight:600}}>{row.name}</td>
                      <td style={{opacity:.7}}>{row.desc}</td>
                      <td style={{fontFamily:'monospace', fontSize:12, opacity:.6}}>
                        {secCidr
                          ? <a href="#" onClick={e => { e.preventDefault(); setInput(secCidr); }} style={{color:'var(--cyan)',textDecoration:'none',cursor:'pointer',borderBottom:'1px dashed var(--cyan)',opacity:.8}} title={t('ipv6.load_addr')}>{secondary}</a>
                          : secondary
                        }
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="show-mobile mobile-cards">
              {data.map((row, i) => {
                const cidr = !isDnsV4Tab && (row.addr.includes('/') ? row.addr : row.addr + '/128');
                const secondary = isDnsV4Tab ? row.v6 : row.v4;
                return (
                <div key={i} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{isDnsV4Tab ? t('ipv6.addr_ipv4') : t('common.th_address')}</span>
                    <span className="mobile-card-value" style={{fontFamily:'monospace', fontSize:12, color:'var(--cyan)', wordBreak:'break-all'}}>
                      {isDnsV4Tab
                        ? row.addr
                        : <a href="#" onClick={e => { e.preventDefault(); setInput(cidr); }} style={{color:'inherit',textDecoration:'none',cursor:'pointer',borderBottom:'1px dashed var(--cyan)'}} title={t('ipv6.load_addr')}>{row.addr}</a>
                      }
                    </span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('ipv6.addr_name')}</span>
                    <span className="mobile-card-value" style={{fontWeight:600}}>{row.name}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('ipv6.addr_desc')}</span>
                    <span className="mobile-card-value" style={{opacity:.7}}>{row.desc}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{isDnsV4Tab ? t('common.th_address') : t('ipv6.addr_ipv4')}</span>
                    <span className="mobile-card-value" style={{fontFamily:'monospace', fontSize:12, opacity:.6}}>{secondary}</span>
                  </div>
                </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {result && (
        <div className="btn-row">
          <button className="btn btn-ghost" onClick={() => exportJSON(exportRows, 'ipv6-subnet.json')}>{t('common.export_json')}</button>
          <button className="btn btn-ghost" onClick={() => exportCSV(exportRows, 'ipv6-subnet.csv')}>{t('common.export_csv')}</button>
          <button className="btn btn-ghost" onClick={() => onShare({ tool:'ipv6subnet', input })}>{t('common.share')}</button>
        </div>
      )}
    </div>
  );
}

// ─── Tool: Subnet Overlap Detector ───────────────────────────
window.IPv6SubnetCalc = IPv6SubnetCalc;
