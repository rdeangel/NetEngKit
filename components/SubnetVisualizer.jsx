const { useState, useEffect, useRef, useCallback } = React;

function toBits(uint32) {
  const bits = [];
  for (let i = 31; i >= 0; i--) {
    bits.push((uint32 >>> i) & 1);
  }
  return bits;
}

function parseIP(s) {
  const parts = s.trim().split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some(n => isNaN(n) || n < 0 || n > 255)) return null;
  return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
}

function ipStr(uint32) {
  return [
    (uint32 >>> 24) & 0xff,
    (uint32 >>> 16) & 0xff,
    (uint32 >>> 8) & 0xff,
    uint32 & 0xff,
  ].join('.');
}

function maskFromPrefix(prefix) {
  if (prefix === 0) return 0;
  if (prefix === 0) return 0;
  if (prefix === 32) return 0xffffffff >>> 0;
  return (~0 << (32 - prefix)) >>> 0;
}

function calcSubnet(ipInt, prefix) {
  const m = maskFromPrefix(prefix);
  const network = (ipInt & m) >>> 0;
  const broadcast = (network | (~m >>> 0)) >>> 0;
  const total = Math.pow(2, 32 - prefix);
  const usable = prefix <= 30 ? total - 2 : (prefix === 31 ? 2 : 1);
  const firstHost = prefix <= 30 ? (network + 1) >>> 0 : network;
  const lastHost = prefix <= 30 ? (broadcast - 1) >>> 0 : broadcast;
  return { network, broadcast, mask: m, firstHost, lastHost, total, usable, prefix };
}

// Tracks which bit positions (0-31) changed between renders of `value`.
// Only active when `active` is true.
function useChangedBits(value, active) {
  const prevRef = useRef(value);
  const [highlighted, setHighlighted] = useState(new Set());
  const timerRef = useRef(null);

  useEffect(() => {
    if (!active) { prevRef.current = value; return; }
    const prev = prevRef.current;
    if (prev === value) { return; }
    const changed = new Set();
    for (let i = 0; i < 32; i++) {
      if (((value >>> (31 - i)) & 1) !== ((prev >>> (31 - i)) & 1)) changed.add(i);
    }
    prevRef.current = value;
    if (changed.size === 0) return;
    setHighlighted(changed);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setHighlighted(new Set()), 700);
  }, [value, active]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);
  return highlighted;
}

function BitRow({ label, bits, getStyle, visible = 32, flashIndices = new Set(), highlightIndices = new Set(), onBitClick }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ fontSize: 10, opacity: 0.5, fontWeight: 600, marginBottom: 3 }}>{label}</div>
      <div style={{ display: 'flex', gap: 2, flexWrap: 'nowrap' }}>
        {bits.map((bit, i) => {
          const shown = i < visible;
          const flash = flashIndices.has(i);
          const highlight = !flash && highlightIndices.has(i);
          const clickable = onBitClick && shown;
          return (
            <div
              key={i}
              onClick={clickable ? () => onBitClick(i, bit) : undefined}
              style={{
                width: 18,
                height: 22,
                borderRadius: 3,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 10,
                fontWeight: 700,
                fontFamily: 'monospace',
                flexShrink: 0,
                opacity: shown ? 1 : 0,
                transform: shown ? 'scale(1)' : 'scale(0.6)',
                transition: 'opacity 0.12s, transform 0.12s',
                background: flash ? '#fbbf24' : undefined,
              }}
              className={shown ? [(highlight ? 'bit-changed' : getStyle(i, bit)), clickable ? 'bit-clickable' : ''].join(' ').trim() : ''}
            >
              {shown ? bit : ''}
            </div>
          );
        })}
      </div>
      <div style={{ display: 'flex', marginTop: 2 }}>
        {[0, 8, 16, 24].map(start => {
          if (visible < start + 8) return <div key={start} style={{ width: (18 + 2) * 8, fontSize: 9, opacity: 0.4 }} />;
          const val = bits.slice(start, start + 8).reduce((acc, b) => (acc << 1) | b, 0);
          return (
            <div key={start} style={{ width: (18 + 2) * 8, fontSize: 9, opacity: 0.5, textAlign: 'center' }}>
              {val}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BoundaryLine({ prefix, onPrefixChange, visible }) {
  if (!visible) return null;
  const bitWidth = 20; // 18px width + 2px gap
  const left = prefix * bitWidth;

  const handlePointerDown = (e) => {
    const el = e.currentTarget;
    const startX = e.clientX;
    const startPrefix = prefix;
    
    const onPointerMove = (moveEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const newPrefix = Math.max(0, Math.min(32, Math.round(startPrefix + deltaX / bitWidth)));
      if (newPrefix !== prefix) {
        onPrefixChange(newPrefix);
      }
    };

    const onPointerUp = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      el.releasePointerCapture(e.pointerId);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    el.setPointerCapture(e.pointerId);
  };

  return (
    <div 
      onPointerDown={handlePointerDown}
      style={{
        position: 'absolute',
        top: 2,
        bottom: 0,
        left: left,
        width: 16,
        marginLeft: -7,
        cursor: 'col-resize',
        zIndex: 10,
        display: 'flex',
        justifyContent: 'center',
        touchAction: 'none',
        transition: 'left 0.1s linear',
      }}
    >
      <div style={{
        width: 2,
        height: '100%',
        borderLeft: '2px dashed #2563eb',
      }} />
      <div style={{
        position: 'absolute',
        top: 2,
        width: 14,
        height: 14,
        background: '#2563eb',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
        border: '2px solid var(--surface1, #fff)'
      }}>
        <div style={{ width: 4, height: 4, background: 'rgba(255,255,255,0.8)', borderRadius: '50%' }} />
      </div>
    </div>
  );
}

function Callout({ text }) {
  if (!text) return null;
  return (
    <div style={{
      marginTop: 12,
      padding: '8px 12px',
      borderRadius: 6,
      background: 'var(--surface2, rgba(99,102,241,0.1))',
      borderLeft: '3px solid var(--accent, #6366f1)',
      fontSize: 12,
      lineHeight: 1.5,
      minHeight: 36,
      transition: 'opacity 0.3s',
    }}>
      {text}
    </div>
  );
}

function BitAllocationRow({ prefix, t }) {
  return (
    <div style={{ marginBottom: 16, position: 'relative' }}>
      <div style={{ display: 'flex', height: 24, borderRadius: 4, overflow: 'hidden', background: 'var(--surface2, #eee)', marginBottom: 6 }}>
        <div style={{
          width: `${(prefix / 32) * 100}%`,
          background: '#2563eb',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          fontSize: 10,
          fontWeight: 700,
          transition: 'width 0.3s ease'
        }}>
          {prefix > 4 && `${prefix} ${t('common.network')}`}
        </div>
        <div style={{
          flex: 1,
          background: '#f59e0b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#1c1917',
          fontSize: 10,
          fontWeight: 700,
          transition: 'width 0.3s ease'
        }}>
          {(32 - prefix) > 4 && `${32 - prefix} ${t('common.host')}`}
        </div>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, opacity: 0.6, fontWeight: 600 }}>
        <span>0</span>
        <span style={{ position: 'absolute', left: `calc(${(prefix / 32) * 100}% + 4px)`, transform: 'translateX(-50%)', transition: 'left 0.3s ease' }}>{prefix}</span>
        <span>32</span>
      </div>
    </div>
  );
}

function AnimationCard({ t, ipInt, prefix, currentHostInt, onIpBitClick, onPrefixBitClick, onHostBitClick, onPrefixChange }) {
  const subnet = calcSubnet(ipInt, prefix);
  const maskBits = toBits(subnet.mask);
  const ipBits = toBits(currentHostInt);
  const resultBits = toBits(currentHostInt);
  const changedBits = useChangedBits(currentHostInt, true);

  const ipRowStyle = (i) => i < prefix ? 'bit-net' : 'bit-host-ip';
  const maskRowStyle = (i, bit) => bit === 1 ? 'bit-mask-1' : 'bit-mask-0';
  const resultRowStyle = (i) => i < prefix ? 'bit-locked' : 'bit-host-ip';

  return (
    <div className="card fadein">
      <div className="card-title">
        {t('subviz.animation_card_title')}
      </div>
      
      <div style={{ position: 'relative', overflowX: 'auto', paddingTop: 24 }}>
        <BitRow 
          label="IP" 
          bits={ipBits} 
          getStyle={ipRowStyle} 
          visible={32} 
          highlightIndices={changedBits} 
          onBitClick={(i, bit) => i < prefix ? onIpBitClick(i, bit) : onHostBitClick(i)} 
        />
        
        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', opacity: 0.45, marginBottom: 4, letterSpacing: 1 }}>AND</div>
        <BitRow 
          label="Mask" 
          bits={maskBits} 
          getStyle={maskRowStyle} 
          visible={32} 
          onBitClick={onPrefixBitClick} 
        />

        <div style={{ fontSize: 10, fontWeight: 700, fontFamily: 'monospace', opacity: 0.45, marginBottom: 4, letterSpacing: 1 }}>=</div>
        <BitRow
          label="Host"
          bits={resultBits}
          getStyle={resultRowStyle}
          visible={32}
          highlightIndices={changedBits}
          onBitClick={(i, bit) => (i < prefix ? onIpBitClick(i, bit) : onHostBitClick(i))}
        />
        
        <BoundaryLine prefix={prefix} onPrefixChange={onPrefixChange} visible />
      </div>

      <div style={{ marginTop: 12 }}>
        <BitAllocationRow prefix={prefix} t={t} />
      </div>
    </div>
  );
}

function HostStepperCard({ t, ipInt, prefix, hostOffset, onHostOffsetChange, onIpBitClick }) {
  const subnet = calcSubnet(ipInt, prefix);
  const isSpecial = prefix === 0 || prefix === 32;
  const timerRef = useRef(null);
  const repeatTimerRef = useRef(null);

  const stopRepeat = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (repeatTimerRef.current) clearTimeout(repeatTimerRef.current);
    timerRef.current = null;
    repeatTimerRef.current = null;
  }, []);

  useEffect(() => stopRepeat, [stopRepeat]);

  const maxOffset = subnet.total - 1;
  const currentIpInt = (subnet.network + hostOffset) >>> 0;
  const hostBits = toBits(currentIpInt);
  const changedBits = useChangedBits(currentIpInt, !isSpecial);

  const startRepeat = (direction) => {
    stopRepeat();

    let currentDelay = 150;
    const minDelay = 20;
    const acceleration = 0.92;
    let localOffset = hostOffset;

    const step = () => {
      localOffset = direction === 'inc' ? localOffset + 1 : localOffset - 1;
      if (localOffset < 0 || localOffset >= subnet.total) {
        stopRepeat();
        return;
      }
      onHostOffsetChange(localOffset);

      currentDelay = Math.max(minDelay, currentDelay * acceleration);
      repeatTimerRef.current = setTimeout(step, currentDelay);
    };

    // First step immediate
    const firstNext = direction === 'inc' ? hostOffset + 1 : hostOffset - 1;
    if (firstNext >= 0 && firstNext < subnet.total) {
      onHostOffsetChange(firstNext);
      localOffset = firstNext;
      // Wait 400ms before starting auto-repeat
      timerRef.current = setTimeout(step, 400);
    }
  };

  const handleHostRowBitClick = (i) => {
    if (i < prefix) { onIpBitClick && onIpBitClick(i, hostBits[i]); return; }
    const newIpInt = (currentIpInt ^ (1 << (31 - i))) >>> 0;
    const rawOffset = newIpInt - subnet.network;
    onHostOffsetChange(Math.max(0, Math.min(maxOffset, rawOffset)));
  };

  if (isSpecial) {
    return (
      <div className="card fadein">
        <div className="card-title">{t('subviz.ip_stepper_title')}</div>
        <div style={{ fontSize: 12, opacity: 0.6 }}>{t('subviz.special_prefix_note')}</div>
      </div>
    );
  }

  return (
    <div className="card fadein">
      <div className="card-title">{t('subviz.ip_stepper_title')}</div>
      <div style={{ overflowX: 'auto', marginBottom: 12 }}>
        <BitRow
          label={t('subviz.current_ip')}
          bits={hostBits}
          getStyle={(i) => i < prefix ? 'bit-locked' : 'bit-host-ip'}
          visible={32}
          highlightIndices={changedBits}
          onBitClick={handleHostRowBitClick}
        />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button 
          className="btn btn-ghost btn-sm" 
          onPointerDown={() => startRepeat('dec')}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          disabled={hostOffset <= 0}
        >−</button>
        <input
          type="range"
          min={0}
          max={maxOffset}
          value={hostOffset}
          onChange={e => onHostOffsetChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <button 
          className="btn btn-ghost btn-sm" 
          onPointerDown={() => startRepeat('inc')}
          onPointerUp={stopRepeat}
          onPointerLeave={stopRepeat}
          disabled={hostOffset >= maxOffset}
        >+</button>
      </div>
      <div className="result-grid grid-mobile-1">
        <ResultItem label={t('subviz.current_ip')} value={ipStr(currentIpInt)} accent />
        <ResultItem label={t('subviz.network_size')} value={subnet.total.toLocaleString()} green />
        <ResultItem label={t('subviz.network_addr')} value={ipStr(subnet.network)} />
        <ResultItem label={t('subviz.broadcast_addr')} value={ipStr(subnet.broadcast)} red />
      </div>
    </div>
  );
}

function PrefixSliderCard({ t, ipInt, prefix, onPrefixChange }) {
  const subnet = calcSubnet(ipInt, prefix);

  return (
    <div className="card fadein">
      <div className="card-title">{t('subviz.prefix_slider_title')}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 12, opacity: 0.6, minWidth: 24 }}>0</span>
        <input
          type="range"
          min={0}
          max={32}
          value={prefix}
          onChange={e => onPrefixChange(Number(e.target.value))}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, opacity: 0.6, minWidth: 24 }}>32</span>
      </div>
      <div className="result-grid grid-mobile-1">
        <ResultItem label={t('subviz.prefix_length')} value={`/${prefix}`} accent />
        <ResultItem label={t('subviz.usable_hosts')} value={subnet.usable.toLocaleString()} green />
        <ResultItem label={t('subviz.network_size')} value={subnet.total.toLocaleString()} />
        <ResultItem label={t('subviz.network_addr')} value={ipStr(subnet.network)} />
      </div>
    </div>
  );
}

function SubnetVizHelpModal({ onClose, t }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }} onClick={onClose}>
      <div style={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, padding: 24, width: 560, maxWidth: '92vw', maxHeight: '85vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16, textAlign: 'center' }}>{t('subviz.help_title')}</div>

        <div style={{ fontSize: 13, lineHeight: 1.7, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('subviz.help_section_what')}</div>
            <div style={{ opacity: 0.85 }}>{t('subviz.help_what_body')}</div>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('subviz.help_section_prefix')}</div>
            <div style={{ opacity: 0.85 }}>{t('subviz.help_prefix_body')}</div>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('subviz.help_section_interact')}</div>
            <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.85, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>{t('subviz.help_interact_bits')}</li>
              <li>{t('subviz.help_interact_stepper')}</li>
              <li>{t('subviz.help_interact_slider')}</li>
              <li>{t('subviz.help_interact_presets')}</li>
            </ul>
          </div>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>{t('subviz.help_section_rows')}</div>
            <ul style={{ margin: 0, paddingLeft: 18, opacity: 0.85, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <li>{t('subviz.help_row_ip')}</li>
              <li>{t('subviz.help_row_mask')}</li>
              <li>{t('subviz.help_row_result')}</li>
            </ul>
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'center', marginTop: 20 }}>
          <button className="btn btn-primary" onClick={onClose}>{t('common.close')}</button>
        </div>
      </div>
    </div>
  );
}

function SubnetVisualizer({ onShare, initialData }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('subnet-viz:input', initialData?.input || '192.168.1.0/24');
  const [err, setErr] = useState('');
  const [parsed, setParsed] = usePersistentState('subnet-viz:parsed', null);
  const [prefixOverride, setPrefixOverride] = usePersistentState('subnet-viz:prefixOverride', null);
  const [hostOffset, setHostOffset] = usePersistentState('subnet-viz:hostOffset', 1);
  const [showHelp, setShowHelp] = useState(false);
  const lastParsedIpRef = useRef(null);

  const PRESETS = [
    '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '10.0.0.0/24', '10.10.0.0/16', '192.168.1.0/24',
    '127.0.0.0/8', '127.0.0.1/32', '169.254.0.0/16',
    '224.0.0.0/4', '224.0.0.0/24', '224.0.1.0/24', '232.0.0.0/8', '233.0.0.0/8', '239.0.0.0/8',
    '100.64.0.0/10', '192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24', '240.0.0.0/4',
  ];

  const parse = useCallback((val) => {
    const parts = val.trim().split('/');
    if (parts.length !== 2) { setErr(t('subviz.err_invalid')); setParsed(null); lastParsedIpRef.current = null; return; }
    const ipInt = parseIP(parts[0]);
    const prefix = parseInt(parts[1], 10);
    if (ipInt === null || isNaN(prefix) || prefix < 0 || prefix > 32) {
      setErr(t('subviz.err_invalid')); setParsed(null); lastParsedIpRef.current = null; return;
    }
    setErr('');
    lastParsedIpRef.current = ipInt;
    setInput(val);
    setParsed({ ipInt, prefix });
  }, [t]);

  useEffect(() => {
    if (initialData?.input) { setInput(initialData.input); parse(initialData.input); }
    else { parse(input); }
  }, [initialData]);

  const handleSubmit = () => parse(input);

  useEffect(() => {
    const handleShare = (e) => {
      if (parsed) (e.detail?.respond ?? onShare)({ tool: 'subnet', mode: 'binary', input });
    };
    window.addEventListener('app:request-share', handleShare);
    return () => window.removeEventListener('app:request-share', handleShare);
  }, [parsed, input, onShare]);

  const activePrefix = prefixOverride !== null ? prefixOverride : (parsed?.prefix ?? 24);

  const handlePrefixChange = (n) => {
    setPrefixOverride(n);
    if (parsed) {
      const newVal = ipStr(parsed.ipInt) + '/' + n;
      setInput(newVal);
      parse(newVal);
    }
  };

  const handleIpBitClick = useCallback((i) => {
    if (!parsed) return;
    const newIpInt = (parsed.ipInt ^ (1 << (31 - i))) >>> 0;
    const newVal = ipStr(newIpInt) + '/' + activePrefix;
    setInput(newVal);
    parse(newVal);
  }, [parsed, activePrefix, parse]);

  const handlePrefixBitClick = useCallback((i, bit) => {
    const newPrefix = Math.max(0, Math.min(32, bit === 1 ? i : i + 1));
    handlePrefixChange(newPrefix);
  }, [handlePrefixChange]);

  const subnet = parsed ? calcSubnet(parsed.ipInt, activePrefix) : null;

  useEffect(() => {
    if (subnet && parsed && activePrefix < 32) {
      const offset = (parsed.ipInt - subnet.network);
      setHostOffset(Math.max(0, Math.min(subnet.total - 1, offset)));
    } else {
      setHostOffset(0);
    }
  }, [parsed?.ipInt, activePrefix, subnet]);

  const handleHostOffsetChange = (newOffset) => {
    if (!subnet) return;
    const newIpInt = (subnet.network + newOffset) >>> 0;
    const newVal = ipStr(newIpInt) + '/' + activePrefix;
    setInput(newVal);
    parse(newVal);
  };

  const handleHostBitClick = useCallback((i) => {
    if (!parsed) return;
    const newIpInt = (parsed.ipInt ^ (1 << (31 - i))) >>> 0;
    const newVal = ipStr(newIpInt) + '/' + activePrefix;
    setInput(newVal);
    parse(newVal);
  }, [parsed, activePrefix, parse]);

  return (
    <div className="fadein">
      {showHelp && <SubnetVizHelpModal onClose={() => setShowHelp(false)} t={t} />}
      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          {t('common.input')}
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11, opacity: 0.6, padding: '2px 8px' }} onClick={() => setShowHelp(true)}>{t('subviz.help_btn')}</button>
        </div>
        <div className="field">
          <label className="label">{t('subviz.input_label')}</label>
          <div className="input-row">
            <input
              className={`input ${err ? 'error' : ''}`}
              value={input}
              onChange={e => { setPrefixOverride(null); setInput(e.target.value); }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSubmit(); } }}
              placeholder={t('subviz.placeholder')}
            />
            <button type="button" className="btn btn-primary btn-sm" onClick={handleSubmit}>{t('common.calculate')}</button>
          </div>
          <Err msg={err} />
          <div className="hint">{t('subviz.hint')}</div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, opacity: 0.5, fontWeight: 600, marginBottom: 4 }}>{t('subviz.quick_presets')}</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {PRESETS.map(p => (
              <button key={p} className="btn btn-ghost btn-sm" onClick={() => { setPrefixOverride(null); setInput(p); parse(p); }}>{p}</button>
            ))}
          </div>
        </div>
      </div>

      {parsed && (
        <>
          <AnimationCard t={t} ipInt={parsed.ipInt} prefix={activePrefix} currentHostInt={parsed.ipInt} onIpBitClick={handleIpBitClick} onPrefixBitClick={handlePrefixBitClick} onHostBitClick={handleHostBitClick} onPrefixChange={handlePrefixChange} />
          <HostStepperCard t={t} ipInt={parsed.ipInt} prefix={activePrefix} hostOffset={hostOffset} onHostOffsetChange={handleHostOffsetChange} onIpBitClick={handleIpBitClick} />
          <PrefixSliderCard t={t} ipInt={parsed.ipInt} prefix={activePrefix} onPrefixChange={handlePrefixChange} />
        </>
      )}
    </div>
  );
}
