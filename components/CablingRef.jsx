// CablingRef — MPO/MTP Polarity & T568 Copper Wiring Reference (TIA-568.3-D / TIA-598-C)

const FIBER_COLORS_TIA598 = [
  { pos: 1,  hex: '#1565C0', dark: false },
  { pos: 2,  hex: '#E65100', dark: false },
  { pos: 3,  hex: '#388E3C', dark: false },
  { pos: 4,  hex: '#6D4C41', dark: false },
  { pos: 5,  hex: '#78909C', dark: false },
  { pos: 6,  hex: '#E0E0E0', dark: true  },
  { pos: 7,  hex: '#C62828', dark: false },
  { pos: 8,  hex: '#424242', dark: false },
  { pos: 9,  hex: '#F9A825', dark: true  },
  { pos: 10, hex: '#6A1B9A', dark: false },
  { pos: 11, hex: '#E91E63', dark: false },
  { pos: 12, hex: '#00838F', dark: false },
  { pos: 13, hex: '#1565C0', dark: false },
  { pos: 14, hex: '#E65100', dark: false },
  { pos: 15, hex: '#388E3C', dark: false },
  { pos: 16, hex: '#6D4C41', dark: false },
  { pos: 17, hex: '#78909C', dark: false },
  { pos: 18, hex: '#E0E0E0', dark: true  },
  { pos: 19, hex: '#C62828', dark: false },
  { pos: 20, hex: '#424242', dark: false },
  { pos: 21, hex: '#F9A825', dark: true  },
  { pos: 22, hex: '#6A1B9A', dark: false },
  { pos: 23, hex: '#E91E63', dark: false },
  { pos: 24, hex: '#00838F', dark: false },
];

// TIA-568.3-D polarity mapping: EndA position → EndB position
function getMPOPolarity(n, type) {
  const map = {};
  if (type === 'A') {
    // Straight-through cable (key-up to key-down): row reversal via connector flip
    for (let i = 1; i <= n; i++) map[i] = n + 1 - i;
  } else if (type === 'B') {
    // Reversed cable (key-up to key-up): direct position match
    for (let i = 1; i <= n; i++) map[i] = i;
  } else {
    // Type C: adjacent-pair swap applied on top of Type-A flip
    for (let i = 1; i <= n; i++) {
      const flipped = n + 1 - i;
      map[i] = (flipped % 2 === 1) ? flipped + 1 : flipped - 1;
    }
  }
  return map;
}

const MPO_BREAKOUTS = [
  {
    id: 'mpo8-lc4',
    mpoFibers: 8,
    hasDualPins: true,
    ports: [
      { port: 1, txFiber: 1, rxFiber: 5 },
      { port: 2, txFiber: 2, rxFiber: 6 },
      { port: 3, txFiber: 3, rxFiber: 7 },
      { port: 4, txFiber: 4, rxFiber: 8 },
    ],
  },
  {
    id: 'mpo12-lc6',
    mpoFibers: 12,
    hasDualPins: true,
    ports: [
      { port: 1, txFiber: 1,  rxFiber: 7  },
      { port: 2, txFiber: 2,  rxFiber: 8  },
      { port: 3, txFiber: 3,  rxFiber: 9  },
      { port: 4, txFiber: 4,  rxFiber: 10 },
      { port: 5, txFiber: 5,  rxFiber: 11 },
      { port: 6, txFiber: 6,  rxFiber: 12 },
    ],
  },
  {
    id: 'mpo12-lc6-seq',
    mpoFibers: 12,
    hasDualPins: true,
    ports: [
      { port: 1, txFiber: 1,  rxFiber: 2  },
      { port: 2, txFiber: 3,  rxFiber: 4  },
      { port: 3, txFiber: 5,  rxFiber: 6  },
      { port: 4, txFiber: 7,  rxFiber: 8  },
      { port: 5, txFiber: 9,  rxFiber: 10 },
      { port: 6, txFiber: 11, rxFiber: 12 },
    ],
  },
  {
    id: 'mpo16-lc8',
    mpoFibers: 16,
    hasDualPins: true,
    ports: Array.from({ length: 8 }, (_, i) => ({ port: i + 1, txFiber: i + 1, rxFiber: i + 9 })),
  },
  {
    id: 'mpo24-lc12',
    mpoFibers: 24,
    hasDualPins: true,
    ports: Array.from({ length: 12 }, (_, i) => ({ port: i + 1, txFiber: i + 1, rxFiber: i + 13 })),
  },
  {
    id: 'mpo24-mpo12',
    mpoFibers: 24,
    hasDualPins: false,
    ports: [
      { port: 'A', txFiber: '1–12',  rxFiber: null, label_id: 'port_a' },
      { port: 'B', txFiber: '13–24', rxFiber: null, label_id: 'port_b' },
    ],
  },
];

const T568_WIRING = {
  A: [
    { pin: 1, pair: 3, color_id: 'white_green',  hex: '#A5D6A7', dark: true  },
    { pin: 2, pair: 3, color_id: 'green',        hex: '#2E7D32', dark: false },
    { pin: 3, pair: 2, color_id: 'white_orange',  hex: '#FFCC80', dark: true  },
    { pin: 4, pair: 1, color_id: 'blue',          hex: '#1565C0', dark: false },
    { pin: 5, pair: 1, color_id: 'white_blue',    hex: '#90CAF9', dark: true  },
    { pin: 6, pair: 2, color_id: 'orange',        hex: '#E65100', dark: false },
    { pin: 7, pair: 4, color_id: 'white_brown',   hex: '#D7CCC8', dark: true  },
    { pin: 8, pair: 4, color_id: 'brown',         hex: '#4E342E', dark: false },
  ],
  B: [
    { pin: 1, pair: 2, color_id: 'white_orange',  hex: '#FFCC80', dark: true  },
    { pin: 2, pair: 2, color_id: 'orange',        hex: '#E65100', dark: false },
    { pin: 3, pair: 3, color_id: 'white_green',   hex: '#A5D6A7', dark: true  },
    { pin: 4, pair: 1, color_id: 'blue',          hex: '#1565C0', dark: false },
    { pin: 5, pair: 1, color_id: 'white_blue',    hex: '#90CAF9', dark: true  },
    { pin: 6, pair: 3, color_id: 'green',         hex: '#2E7D32', dark: false },
    { pin: 7, pair: 4, color_id: 'white_brown',   hex: '#D7CCC8', dark: true  },
    { pin: 8, pair: 4, color_id: 'brown',         hex: '#4E342E', dark: false },
  ],
};


const thStyle = {
  padding: '8px 12px',
  fontWeight: 600,
  fontSize: '11px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  color: 'var(--text-muted)',
  borderBottom: '2px solid var(--border-color)',
  whiteSpace: 'nowrap',
  background: 'var(--bg-secondary)',
};
const tdStyle = {
  padding: '7px 12px',
  fontSize: '12px',
  verticalAlign: 'middle',
  color: 'var(--text-color)',
};

function FiberDot({ idx, size = 14 }) {
  const fc = FIBER_COLORS_TIA598[idx];
  return (
    <span style={{
      display: 'inline-block',
      width: size, height: size,
      borderRadius: '50%',
      background: fc?.hex || '#888',
      border: '1px solid var(--border-color)',
      flexShrink: 0,
      verticalAlign: 'middle',
    }} />
  );
}

function MPOPolarityDiagram({ n, type }) {
  const mapping = getMPOPolarity(n, type);

  // Build reverse map: EndB position → EndA fiber index
  const bPosToAIdx = {};
  Object.entries(mapping).forEach(([aPos, bPos]) => {
    bPosToAIdx[bPos] = parseInt(aPos) - 1;
  });

  const W = 640, H = 230;
  const marginX = 38;
  const usable = W - 2 * marginX;
  const step = usable / (n + 1);
  const yA = 68, yB = 162;
  const r = Math.min(13, step * 0.36);

  const xAt = pos => marginX + pos * step;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: '700px', display: 'block' }}>
      {/* Header labels */}
      <text x={8} y={yA + 4} fontSize="11" fontWeight="700" fill="var(--text-color)">A</text>
      <text x={W - 8} y={yA + 4} fontSize="10" fill="var(--text-muted)" textAnchor="end">key up ▶</text>
      <text x={8} y={yB + 4} fontSize="11" fontWeight="700" fill="var(--text-color)">B</text>
      <text x={W - 8} y={yB + 4} fontSize="10" fill="var(--text-muted)" textAnchor="end">
        {type === 'B' ? 'key up ▶' : 'key down ◀'}
      </text>

      {/* Connector body */}
      <rect x={marginX + step * 0.45} y={yA - r - 6} width={usable - step * 0.9} height={r * 2 + 12}
        rx="5" fill="var(--bg-secondary)" stroke="var(--border-color)" strokeWidth="1.2" />
      <rect x={marginX + step * 0.45} y={yB - r - 6} width={usable - step * 0.9} height={r * 2 + 12}
        rx="5" fill="var(--bg-secondary)" stroke="var(--border-color)" strokeWidth="1.2" />

      {/* Connecting lines */}
      {Array.from({ length: n }, (_, idx) => {
        const aPos = idx + 1;
        const bPos = mapping[aPos];
        const x1 = xAt(aPos);
        const x2 = xAt(bPos);
        const fc = FIBER_COLORS_TIA598[idx];
        const midY = (yA + yB) / 2;
        const d = (x1 === x2)
          ? `M ${x1} ${yA + r} L ${x2} ${yB - r}`
          : `M ${x1} ${yA + r} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${yB - r}`;
        return (
          <path key={aPos} d={d} stroke={fc?.hex || '#888'}
            strokeWidth="1.8" fill="none" strokeOpacity="0.8" />
        );
      })}

      {/* End A position numbers above connector */}
      {Array.from({ length: n }, (_, idx) => (
        <text key={`anum${idx}`} x={xAt(idx + 1)} y={yA - r - 10}
          textAnchor="middle" fontSize="8" fill="var(--text-muted)">{idx + 1}</text>
      ))}

      {/* End A circles */}
      {Array.from({ length: n }, (_, idx) => {
        const fc = FIBER_COLORS_TIA598[idx];
        return (
          <g key={`a${idx}`}>
            <circle cx={xAt(idx + 1)} cy={yA} r={r}
              fill={fc?.hex || '#888'} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
            <text x={xAt(idx + 1)} y={yA + 4} textAnchor="middle" fontSize="8" fontWeight="700"
              fill={fc?.dark ? '#333' : '#fff'}>
              {idx + 1}
            </text>
          </g>
        );
      })}

      {/* End B circles — colored by arriving fiber */}
      {Array.from({ length: n }, (_, bIdx) => {
        const bPos = bIdx + 1;
        const aIdx = bPosToAIdx[bPos] ?? bIdx;
        const fc = FIBER_COLORS_TIA598[aIdx];
        return (
          <g key={`b${bPos}`}>
            <circle cx={xAt(bPos)} cy={yB} r={r}
              fill={fc?.hex || '#888'} stroke="rgba(255,255,255,0.25)" strokeWidth="1.5" />
            <text x={xAt(bPos)} y={yB + 4} textAnchor="middle" fontSize="8" fontWeight="700"
              fill={fc?.dark ? '#333' : '#fff'}>
              {aIdx + 1}
            </text>
          </g>
        );
      })}

      {/* End B position numbers below connector */}
      {Array.from({ length: n }, (_, bIdx) => (
        <text key={`bnum${bIdx}`} x={xAt(bIdx + 1)} y={yB + r + 16}
          textAnchor="middle" fontSize="8" fill="var(--text-muted)">{bIdx + 1}</text>
      ))}
    </svg>
  );
}

function T568PinBar({ pins, label, t }) {
  return (
    <div>
      <div style={{ fontSize: '11px', fontWeight: 600, color: 'var(--text-muted)', marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ display: 'flex', gap: '3px' }}>
        {pins.map(p => {
          const colorName = t(`cabling-ref.wire_colors.${p.color_id}`);
          return (
            <div key={p.pin} style={{
              width: '46px', height: '68px',
              background: p.hex,
              borderRadius: '4px 4px 10px 10px',
              border: '1px solid var(--border-color)',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'space-between',
              padding: '5px 2px 6px',
              boxSizing: 'border-box',
              flexShrink: 0,
            }}>
              <span style={{ fontSize: '10px', fontWeight: 700, color: p.dark ? '#333' : '#fff', lineHeight: 1 }}>
                {p.pin}
              </span>
              <span style={{ fontSize: '7px', color: p.dark ? '#333' : '#fff', textAlign: 'center', lineHeight: 1.3 }}>
                {colorName.replace('White/', 'W/')}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CablingRef({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [tab, setTab]               = useState(initialData?.tab ?? 'mpo');
  const [mpoSection, setMpoSection] = useState(initialData?.mpoSection ?? 'polarity');
  const [mpoN, setMpoN]             = useState(initialData?.mpoN ?? 12);
  const [polarityType, setPolarityType] = useState(initialData?.polarityType ?? 'A');
  const [breakoutId, setBreakoutId] = useState(initialData?.breakoutId ?? 'mpo12-lc6');
  const [t568Std, setT568Std]       = useState(initialData?.t568Std ?? 'B');
  const [wireMode, setWireMode]     = useState(initialData?.wireMode ?? 'straight');

  // Apply-down: sidebar sub-row → switch tab
  useEffect(() => {
    if (initialData?.tab && initialData.tab !== tab) setTab(initialData.tab);
  }, [initialData]);

  // Report-up: tab change → sidebar highlight follows
  useEffect(() => { onNav?.({ tab }); }, [tab]);

  useEffect(() => {
    const handle = e =>
      (e.detail?.respond ?? onShare)({ tool: 'cabling-ref', tab, mpoSection, mpoN, polarityType, breakoutId, t568Std, wireMode });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, mpoSection, mpoN, polarityType, breakoutId, t568Std, wireMode, onShare]);

  const mapping = getMPOPolarity(mpoN, polarityType);
  const breakout = MPO_BREAKOUTS.find(b => b.id === breakoutId) || MPO_BREAKOUTS[1];

  const btnA  = 'btn btn-primary';
  const btnI  = 'btn btn-ghost';
  const btnSmA = 'btn btn-sm btn-primary';
  const btnSmI = 'btn btn-sm btn-ghost';

  const polarityDesc = {
    A: t('cabling-ref.polarity_desc_A'),
    B: t('cabling-ref.polarity_desc_B'),
    C: t('cabling-ref.polarity_desc_C'),
  };

  const infoBox = {
    background: 'var(--bg-secondary)', border: '1px solid var(--border-color)',
    borderRadius: '6px', padding: '12px 16px', fontSize: '13px',
    lineHeight: '1.65', color: 'var(--text-color)',
  };

  const crossoverEndAPins = T568_WIRING.A;
  const crossoverEndBPins = T568_WIRING.B;
  const straightPins      = T568_WIRING[t568Std];

  return (
    <div className="fadein">
      <h2 style={{ marginBottom: '4px' }}>{t('cabling-ref.title')}</h2>
      <p style={{ color: 'var(--text-muted)', marginTop: 0, marginBottom: '20px', fontSize: '14px' }}>
        {t('cabling-ref.subtitle')}
      </p>

      {/* Main tabs */}
      <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
        {[['mpo', t('cabling-ref.tab_mpo')], ['copper', t('cabling-ref.tab_copper')]].map(([id, label]) => (
          <button key={id} className={tab === id ? btnA : btnI} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>

      {/* ─── MPO / MTP FIBER ─── */}
      {tab === 'mpo' && (
        <div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', borderBottom: '1px solid var(--border-color)', paddingBottom: '12px', flexWrap: 'wrap' }}>
            {[['polarity', t('cabling-ref.mpo_polarity')], ['breakout', t('cabling-ref.mpo_breakout')], ['colors', t('cabling-ref.mpo_colors')]].map(([id, label]) => (
              <button key={id} className={mpoSection === id ? btnSmA : btnSmI} onClick={() => setMpoSection(id)}>{label}</button>
            ))}
          </div>

          {/* Polarity diagram */}
          {mpoSection === 'polarity' && (
            <div>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'flex-end' }}>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>{t('cabling-ref.mpo_connector_type')}</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    {[8, 12, 16, 24].map(n => (
                      <button key={n} className={mpoN === n ? btnSmA : btnSmI} onClick={() => setMpoN(n)}>MPO-{n}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>{t('cabling-ref.polarity_type')}</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    {['A', 'B', 'C'].map(pt => (
                      <button key={pt} className={polarityType === pt ? btnSmA : btnSmI} onClick={() => setPolarityType(pt)}>
                        {t('cabling-ref.type_prefix')}{pt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ ...infoBox, marginBottom: '12px', overflowX: 'auto' }}>
                <MPOPolarityDiagram n={mpoN} type={polarityType} />
              </div>

              <div style={{ ...infoBox, marginBottom: '20px' }}>
                <strong>{t('cabling-ref.type_prefix')}{polarityType}:</strong>{' '}{polarityDesc[polarityType]}
              </div>

              {/* Mapping table */}
              <h4 style={{ margin: '0 0 8px', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('cabling-ref.fiber_mapping_table')}</h4>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '420px' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.end_a_pos')}</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.fiber_color')}</th>
                      <th style={{ ...thStyle, textAlign: 'center', padding: '8px 6px' }}></th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.end_b_pos')}</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.fiber_color')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from({ length: mpoN }, (_, idx) => {
                      const aPos = idx + 1;
                      const bPos = mapping[aPos];
                      const aFC  = FIBER_COLORS_TIA598[aPos - 1];
                      const bFC  = FIBER_COLORS_TIA598[bPos - 1];
                      return (
                        <tr key={aPos} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={tdStyle}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                              <FiberDot idx={aPos - 1} />{aPos}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{t(`cabling-ref.fiber_colors.${aPos}`)}</td>
                          <td style={{ ...tdStyle, textAlign: 'center', color: 'var(--text-muted)', padding: '7px 4px' }}>→</td>
                          <td style={tdStyle}>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px' }}>
                              <FiberDot idx={bPos - 1} />{bPos}
                            </span>
                          </td>
                          <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{t(`cabling-ref.fiber_colors.${bPos}`)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div style={{ ...infoBox, marginTop: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
                <div><strong>MTP vs MPO</strong> — {t('cabling-ref.note_mtp')}</div>
                <div style={{ marginTop: '6px' }}><strong>{t('cabling-ref.note_pins_label')}</strong> — {t('cabling-ref.note_pins')}</div>
              </div>
            </div>
          )}

          {/* Breakout mapping */}
          {mpoSection === 'breakout' && (
            <div>
              <div style={{ marginBottom: '16px' }}>
                <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>{t('cabling-ref.breakout_type')}</label>
                <select value={breakoutId} onChange={e => setBreakoutId(e.target.value)}
                  style={{ padding: '7px 10px', border: '1px solid var(--border-color)', borderRadius: '4px', background: 'var(--bg-secondary)', color: 'var(--text-color)', fontSize: '13px', minWidth: '300px' }}>
                  {MPO_BREAKOUTS.map(b => <option key={b.id} value={b.id}>{t(`cabling-ref.mpo_breakouts.${b.id}.label`)}</option>)}
                </select>
              </div>

              <div style={{ ...infoBox, marginBottom: '16px' }}>
                <div><strong>{t('cabling-ref.use_case')}:</strong> <span style={{ color: 'var(--text-muted)' }}>{t(`cabling-ref.mpo_breakouts.${breakout.id}.use_cases`)}</span></div>
                <div style={{ marginTop: '4px' }}><strong>{t('common.note')}:</strong> <span style={{ color: 'var(--text-muted)' }}>{t(`cabling-ref.mpo_breakouts.${breakout.id}.note`)}</span></div>
              </div>

              <div style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '420px' }}>
                  <thead>
                    <tr>
                      <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.lc_port')}</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.tx_fiber')}</th>
                      <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.tx_color')}</th>
                      {breakout.hasDualPins && (
                        <>
                          <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.rx_fiber')}</th>
                          <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.rx_color')}</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {breakout.ports.map(p => {
                      const txIdx = typeof p.txFiber === 'number' ? p.txFiber - 1 : null;
                      const rxIdx = typeof p.rxFiber === 'number' ? p.rxFiber - 1 : null;
                      const txFC  = txIdx !== null ? FIBER_COLORS_TIA598[txIdx] : null;
                      const rxFC  = rxIdx !== null ? FIBER_COLORS_TIA598[rxIdx] : null;
                      const portLabel = p.label_id ? t(`cabling-ref.mpo_breakouts.${breakout.id}.${p.label_id}`) : `${t('cabling-ref.port_prefix')}${p.port}`;
                      return (
                        <tr key={p.port} style={{ borderBottom: '1px solid var(--border-color)' }}>
                          <td style={tdStyle}><strong>{portLabel}</strong></td>
                          <td style={tdStyle}>
                            {txFC ? (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                <FiberDot idx={txIdx} size={12} />{t('cabling-ref.fiber_prefix')}{p.txFiber}
                              </span>
                            ) : <span style={{ color: 'var(--text-muted)' }}>{p.txFiber}</span>}
                          </td>
                          <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{txIdx !== null ? t(`cabling-ref.fiber_colors.${p.txFiber}`) : '—'}</td>
                          {breakout.hasDualPins && (
                            <>
                              <td style={tdStyle}>
                                {rxFC ? (
                                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                                    <FiberDot idx={rxIdx} size={12} />{t('cabling-ref.fiber_prefix')}{p.rxFiber}
                                  </span>
                                ) : <span style={{ color: 'var(--text-muted)' }}>{p.rxFiber}</span>}
                              </td>
                              <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{rxIdx !== null ? t(`cabling-ref.fiber_colors.${p.rxFiber}`) : '—'}</td>
                            </>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Fiber color reference */}
          {mpoSection === 'colors' && (
            <div>
              <h4 style={{ margin: '0 0 12px', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('cabling-ref.fiber_color_std')}</h4>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(155px, 1fr))', gap: '7px' }}>
                {FIBER_COLORS_TIA598.map(fc => (
                  <div key={fc.pos} style={{
                    display: 'flex', alignItems: 'center', gap: '10px',
                    padding: '8px 10px',
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border-color)',
                    borderRadius: '6px',
                    fontSize: '12px',
                  }}>
                    <span style={{ width: '18px', height: '18px', borderRadius: '50%', flexShrink: 0, background: fc.hex, border: '2px solid var(--border-color)' }} />
                    <span>
                      <strong style={{ color: 'var(--text-muted)', marginRight: '4px' }}>{fc.pos}</strong>
                      {t(`cabling-ref.fiber_colors.${fc.pos}`)}
                    </span>
                  </div>
                ))}
              </div>
              <p style={{ marginTop: '16px', fontSize: '12px', color: 'var(--text-muted)', lineHeight: '1.65' }}>
                {t('cabling-ref.fiber_color_note')}
              </p>
            </div>
          )}
        </div>
      )}

      {/* ─── COPPER / T568 ─── */}
      {tab === 'copper' && (
        <div>
          <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap', marginBottom: '20px', alignItems: 'flex-end' }}>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>{t('cabling-ref.wiring_std')}</label>
              <div style={{ display: 'flex', gap: '5px' }}>
                {['A', 'B'].map(s => (
                  <button key={s} className={(wireMode === 'straight' && t568Std === s) ? btnSmA : btnSmI}
                    onClick={() => { setT568Std(s); setWireMode('straight'); }}>
                    T568{s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '6px' }}>{t('cabling-ref.cable_type')}</label>
              <div style={{ display: 'flex', gap: '5px' }}>
                <button className={wireMode === 'crossover' ? btnSmA : btnSmI}
                  onClick={() => setWireMode(wireMode === 'crossover' ? 'straight' : 'crossover')}>
                  {t('cabling-ref.crossover')}
                </button>
              </div>
            </div>
          </div>

          <div style={{ ...infoBox, marginBottom: '20px' }}>
            {wireMode === 'crossover'
              ? t('cabling-ref.crossover_desc')
              : (t568Std === 'B' ? t('cabling-ref.t568b_desc') : t('cabling-ref.t568a_desc'))}
          </div>

          {/* Pin bar diagrams */}
          <div style={{ marginBottom: '24px' }}>
            {wireMode === 'straight' ? (
              <T568PinBar pins={straightPins} label={`T568${t568Std} — ${t('cabling-ref.both_ends')}`} t={t} />
            ) : (
              <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                <T568PinBar pins={crossoverEndAPins} label={`T568A — ${t('cabling-ref.end_a')}`} t={t} />
                <div style={{ fontSize: '20px', color: 'var(--text-muted)', paddingBottom: '8px', alignSelf: 'center' }}>⟷</div>
                <T568PinBar pins={crossoverEndBPins} label={`T568B — ${t('cabling-ref.end_b')}`} t={t} />
              </div>
            )}
          </div>

          {/* Pin detail table */}
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '500px' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.pin')}</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.pair')}</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>
                    {wireMode === 'crossover' ? `T568A (${t('cabling-ref.end_a')})` : `T568${t568Std}`}
                  </th>
                  {wireMode === 'crossover' && (
                    <th style={{ ...thStyle, textAlign: 'left' }}>{`T568B (${t('cabling-ref.end_b')})`}</th>
                  )}
                  <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.function')}</th>
                </tr>
              </thead>
              <tbody>
                {(wireMode === 'crossover' ? crossoverEndAPins : straightPins).map((p, i) => {
                  const endBPin = crossoverEndBPins[i];
                  return (
                    <tr key={p.pin} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td style={tdStyle}><strong>{p.pin}</strong></td>
                      <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{t('cabling-ref.pair_prefix')}{p.pair}</td>
                      <td style={tdStyle}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <span style={{ width: '11px', height: '11px', borderRadius: '3px', background: p.hex, border: '1px solid var(--border-color)', flexShrink: 0 }} />
                          {t(`cabling-ref.wire_colors.${p.color_id}`)}
                        </span>
                      </td>
                      {wireMode === 'crossover' && (
                        <td style={tdStyle}>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ width: '11px', height: '11px', borderRadius: '3px', background: endBPin.hex, border: '1px solid var(--border-color)', flexShrink: 0 }} />
                            {t(`cabling-ref.wire_colors.${endBPin.color_id}`)}
                          </span>
                        </td>
                      )}
                      <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: '11px' }}>{t(`cabling-ref.pin_functions.${p.pin}`)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div style={{ ...infoBox, marginTop: '16px', fontSize: '12px', color: 'var(--text-muted)' }}>
            {t('cabling-ref.auto_mdix_note')}
          </div>

          {/* Pair usage table */}
          <h4 style={{ margin: '24px 0 8px', fontSize: '12px', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{t('cabling-ref.pair_usage_title')}</h4>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: '12px', minWidth: '460px' }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.pair')}</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.pins_t568b')}</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.pins_t568a')}</th>
                  <th style={{ ...thStyle, textAlign: 'left' }}>{t('cabling-ref.usage')}</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { pair: 1, t568b: '4, 5', t568a: '4, 5', key: 'pair1_usage' },
                  { pair: 2, t568b: '1, 2', t568a: '3, 6', key: 'pair2_usage' },
                  { pair: 3, t568b: '3, 6', t568a: '1, 2', key: 'pair3_usage' },
                  { pair: 4, t568b: '7, 8', t568a: '7, 8', key: 'pair4_usage' },
                ].map(row => (
                  <tr key={row.pair} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={tdStyle}><strong>{t('cabling-ref.pair_prefix')}{row.pair}</strong></td>
                    <td style={tdStyle}>{row.t568b}</td>
                    <td style={tdStyle}>{row.t568a}</td>
                    <td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{t(`cabling-ref.${row.key}`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

window.CablingRef = CablingRef;
