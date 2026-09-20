const { useState, useEffect, useCallback, useMemo, useRef } = React;

// ── Device type library ───────────────────────────────────────────────
const RED_DEVICE_TYPES = [
  { id: 'switch', label: 'Switch', color: '#1a7fc4', defaultU: 1 },
  { id: 'router', label: 'Router', color: '#0f9e6e', defaultU: 1 },
  { id: 'firewall', label: 'Firewall', color: '#c0392b', defaultU: 1 },
  { id: 'server', label: 'Server', color: '#6c3483', defaultU: 2 },
  { id: 'storage', label: 'Storage', color: '#7d6608', defaultU: 2 },
  { id: 'patch_panel', label: 'Patch Panel', color: '#17202a', defaultU: 1 },
  { id: 'pdu', label: 'PDU / Power Strip', color: '#117a65', defaultU: 1 },
  { id: 'ups', label: 'UPS', color: '#784212', defaultU: 2 },
  { id: 'cable_mgmt', label: 'Cable Mgmt', color: '#2c3e50', defaultU: 1 },
  { id: 'kvm', label: 'KVM Switch', color: '#5b2c6f', defaultU: 1 },
  { id: 'load_balancer', label: 'Load Balancer', color: '#1a5276', defaultU: 1 },
  { id: 'blank', label: 'Blank Panel', color: '#424949', defaultU: 1 },
  { id: 'empty', label: '(Empty)', color: 'transparent', defaultU: 1 },
];

const RED_TYPE_MAP = Object.fromEntries(RED_DEVICE_TYPES.map(t => [t.id, t]));

// ── Generate unique ID ────────────────────────────────────────────────
function redId() { return Math.random().toString(36).slice(2, 9); }

// ── Default device ────────────────────────────────────────────────────
function redNewDevice(overrides = {}) {
  return {
    id: redId(),
    name: '',
    type: 'server',
    heightU: 1,
    position: null,
    powerW: 0,
    weightKg: 0,
    notes: '',
    ...overrides,
  };
}

// ── Build rack layout (U positions 1..rackU bottom to top) ───────────
// Returns array indexed [1..rackU] with device or null at each U slot
function redBuildLayout(devices, rackU) {
  const slots = new Array(rackU + 1).fill(null); // 1-indexed
  for (const dev of devices) {
    if (!dev.position) continue;
    for (let u = dev.position; u < dev.position + dev.heightU && u <= rackU; u++) {
      slots[u] = dev;
    }
  }
  return slots;
}

// ── Find first available slot ─────────────────────────────────────────
function redFindSlot(devices, rackU, heightU) {
  const slots = redBuildLayout(devices, rackU);
  for (let u = rackU; u >= 1; u--) {
    let fits = true;
    for (let i = u; i < u + heightU; i++) {
      if (i > rackU || slots[i] !== null) { fits = false; break; }
    }
    if (fits) return u;
  }
  return null; // no room
}

// ── ASCII diagram generator ───────────────────────────────────────────
// Each U slot renders 3 lines (Row A top, Row B middle, Row C bottom).
// This makes individual U slots visually countable and gives every device
// a proper box regardless of height.
//
// Line structure (W chars wide):
//   Outer frame:  ╔{W-2 ═}╗  /  ╚{W-2 ═}╝
//   Header:       ║ {W-4 text} ║
//   Col divider:  ╠══╦{INNER ═}╦══╣   (each ║XX║ col = 4 chars, INNER = W-8)
//
// Slot row types (middle section = INNER chars):
//   rowEmpty(u)    ║XX║{INNER blanks}║XX║         empty U, U label on Row B
//   rowBorder(top) ║  ║╔{DASHES}╗║  ║  /  ╚{DASHES}╝  device top/bottom
//   rowCont(u)     ║XX║║{INNER-2 blanks}║║XX║    within-device blank row, U label
//   rowContNoU()   ║  ║║{INNER-2 blanks}║║  ║    within-device blank row, no label
//   rowText(u,txt) ║XX║║ {TEXT} ║║XX║            device content row, U label
function redBuildASCII(devices, rackU, rackName, showPower, showWeight, airflow) {
  const slots   = redBuildLayout(devices, rackU);
  const W       = 58;
  const INNER   = W - 8;       // 50 — middle section between ║XX║ cols
  const DASHES  = INNER - 2;   // 48 — dashes in ╔──╗ / ╚──╝
  const TEXT    = INNER - 4;   // 46 — text content in ║ text ║
  const bar     = '═'.repeat(W - 2);
  const innerBar= '═'.repeat(INNER);
  const lines   = [];

  // Helpers
  const ul      = (u) => `║${String(u).padStart(2, ' ')}║`;
  const noUl    = `║  ║`;
  const hdr     = (s) => `║ ${s.padEnd(W - 4)} ║`;

  // Middle-section builders — each exactly INNER chars
  const mBlank  = ()     => ' '.repeat(INNER);
  const mBorder = (top)  => `${top ? '╔' : '╚'}${'─'.repeat(DASHES)}${top ? '╗' : '╝'}`;
  const mCont   = ()     => `║${' '.repeat(INNER - 2)}║`;
  const mText   = (txt)  => `║ ${txt.padEnd(TEXT)} ║`;

  // Full-width row builders — each exactly W chars
  const rowEmpty   = (u)    => `${ul(u)}${mBlank()}${ul(u)}`;
  const rowEmptyNoU= ()     => `${noUl}${mBlank()}${noUl}`;
  const rowBorder  = (top)  => `${noUl}${mBorder(top)}${noUl}`;
  const rowCont    = (u)    => `${ul(u)}${mCont()}${ul(u)}`;
  const rowContNoU = ()     => `${noUl}${mCont()}${noUl}`;
  const rowText    = (u, t) => `${ul(u)}${mText(t)}${ul(u)}`;

  // Build device text content
  function devText(dev) {
    const ti    = RED_TYPE_MAP[dev.type] || { label: dev.type };
    const label = dev.name || ti.label;
    const info  = [dev.powerW ? `${dev.powerW}W` : '', dev.weightKg ? `${dev.weightKg}kg` : ''].filter(Boolean).join(' ');
    const right = info ? ` [${info}]` : '';
    const max   = TEXT - right.length - 1;
    const left  = label.length > max ? label.slice(0, max - 1) + '…' : label;
    return left + ' '.repeat(Math.max(1, TEXT - left.length - right.length)) + right;
  }

  // Header block
  lines.push(`╔${bar}╗`);
  lines.push(hdr(`  ${rackName}  [${rackU}U]`));
  const totalPower  = devices.reduce((s, d) => s + (d.powerW  || 0), 0);
  const totalWeight = devices.reduce((s, d) => s + (d.weightKg || 0), 0);
  let statsStr = '';
  if (showPower  && totalPower)  statsStr += `Power: ${totalPower}W  `;
  if (showWeight && totalWeight) statsStr += `Weight: ${totalWeight.toFixed(1)}kg`;
  if (statsStr) lines.push(hdr(` ${statsStr.trim()}`));
  if (airflow === 'front-to-back') lines.push(hdr(' ↑ Front-to-Back airflow'));
  else if (airflow === 'back-to-front') lines.push(hdr(' ↓ Back-to-Front airflow'));
  lines.push(`╠══╦${innerBar}╦══╣`);

  const rendered = new Set();

  for (let u = rackU; u >= 1; u--) {
    const dev = slots[u];

    if (!dev) {
      // Empty U — 3 lines: blank / U-label+blank / blank
      lines.push(rowEmptyNoU());
      lines.push(rowEmpty(u));
      lines.push(rowEmptyNoU());
      continue;
    }
    if (rendered.has(dev.id)) continue;
    rendered.add(dev.id);

    const N    = dev.heightU;
    // Content row is the middle visual U of the device.
    // contentV = visual slot index (0=top) where the label text goes.
    const contentV = Math.floor(N / 2);
    const txt  = devText(dev);

    for (let v = 0; v < N; v++) {
      const slotU   = u - v;          // u is top (highest U#), decrements downward
      const isTop   = v === 0;
      const isBot   = v === N - 1;
      const isTxt   = v === contentV;

      // Row A (top line of this U slot)
      lines.push(isTop ? rowBorder(true) : rowContNoU());

      // Row B (middle line — always carries the U label)
      lines.push(isTxt ? rowText(slotU, txt) : rowCont(slotU));

      // Row C (bottom line of this U slot)
      lines.push(isBot ? rowBorder(false) : rowContNoU());
    }
  }

  lines.push(`╠══╩${innerBar}╩══╣`);
  lines.push(`╚${bar}╝`);
  return lines.join('\n');
}

// ── SVG generator ─────────────────────────────────────────────────────
function redBuildSVG(devices, rackU, rackName, showPower, showWeight) {
  const uHeight  = 22;
  const leftPad  = 38;   // left U label strip width
  const rightPad = 38;   // right U label strip width
  const rackDraw = 320;  // rack interior width
  const svgWidth = leftPad + rackDraw + rightPad; // 396 — labels fit inside viewport
  const topPad   = 64;
  const svgHeight = topPad + rackU * uHeight + 20;

  const slots    = redBuildLayout(devices, rackU);
  const rendered = new Set();
  const out      = [];

  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" font-family="monospace" font-size="11">`);
  out.push(`<rect width="${svgWidth}" height="${svgHeight}" fill="#1a1d23" rx="6"/>`);

  // Title & stats centred over the full SVG
  out.push(`<text x="${svgWidth / 2}" y="22" text-anchor="middle" fill="#00d4c8" font-size="14" font-weight="bold">${rackName}</text>`);
  const totalPower  = devices.reduce((s, d) => s + (d.powerW  || 0), 0);
  const totalWeight = devices.reduce((s, d) => s + (d.weightKg || 0), 0);
  let statsText = `[${rackU}U]`;
  if (showPower  && totalPower)  statsText += `  ${totalPower}W`;
  if (showWeight && totalWeight) statsText += `  ${totalWeight.toFixed(1)}kg`;
  out.push(`<text x="${svgWidth / 2}" y="42" text-anchor="middle" fill="#6b7280" font-size="11">${statsText}</text>`);

  // Left and right label column backgrounds
  out.push(`<rect x="0"                       y="${topPad}" width="${leftPad}"  height="${rackU * uHeight}" fill="#111827"/>`);
  out.push(`<rect x="${leftPad + rackDraw}"    y="${topPad}" width="${rightPad}" height="${rackU * uHeight}" fill="#111827"/>`);

  // Rack frame
  const rx = leftPad;
  out.push(`<rect x="${rx}" y="${topPad}" width="${rackDraw}" height="${rackU * uHeight}" fill="#0d0f13" stroke="#374151" stroke-width="2"/>`);

  for (let u = rackU; u >= 1; u--) {
    const y   = topPad + (rackU - u) * uHeight;
    const dev = slots[u];
    const midY = y + uHeight / 2 + 4;

    // Left U label
    out.push(`<text x="${leftPad - 4}" y="${midY}" text-anchor="end" fill="#6b7280" font-size="10">${u}</text>`);
    // Right U label
    out.push(`<text x="${leftPad + rackDraw + 4}" y="${midY}" text-anchor="start" fill="#6b7280" font-size="10">${u}</text>`);
    // Slot separator
    out.push(`<line x1="${rx}" y1="${y}" x2="${rx + rackDraw}" y2="${y}" stroke="#1f2937" stroke-width="0.5"/>`);

    if (!dev || rendered.has(dev.id)) continue;
    rendered.add(dev.id);

    const devTopY   = topPad + (rackU - u) * uHeight + 1;
    const devH      = dev.heightU * uHeight - 2;
    const typeInfo  = RED_TYPE_MAP[dev.type] || { label: dev.type, color: '#374151' };
    const fillColor = typeInfo.color || '#374151';

    out.push(`<rect x="${rx + 2}" y="${devTopY}" width="${rackDraw - 4}" height="${devH}" fill="${fillColor}" fill-opacity="0.85" rx="3" stroke="${fillColor}" stroke-width="1"/>`);

    const label     = dev.name || typeInfo.label;
    const maxChars  = Math.floor((rackDraw - 16) / 7);
    const truncated = label.length > maxChars ? label.slice(0, maxChars - 1) + '…' : label;
    const textMidY  = devTopY + devH / 2 + (dev.heightU >= 2 ? -4 : 4);
    out.push(`<text x="${rx + rackDraw / 2}" y="${textMidY}" text-anchor="middle" fill="#ffffff" font-size="11" font-weight="600">${truncated}</text>`);

    if (dev.heightU >= 2) {
      const sub = [dev.powerW ? `${dev.powerW}W` : '', dev.weightKg ? `${dev.weightKg}kg` : ''].filter(Boolean).join('  ');
      if (sub) out.push(`<text x="${rx + rackDraw / 2}" y="${textMidY + 16}" text-anchor="middle" fill="#d1d5db" font-size="10">${sub}</text>`);
    }
  }

  out.push(`</svg>`);
  return out.join('\n');
}

// ── Styles ────────────────────────────────────────────────────────────
const RED_S = {
  codeBox: { fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.5, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, overflowX: 'auto', whiteSpace: 'pre', maxHeight: 600, overflowY: 'auto' },
  label: { fontSize: 12, color: 'var(--dim)', marginBottom: 4, display: 'block' },
  input: { width: '100%', boxSizing: 'border-box' },
  devRow: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 12px', marginBottom: 8, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' },
  statBox: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 16px', display: 'flex', gap: 24, flexWrap: 'wrap' },
  statItem: { display: 'flex', flexDirection: 'column', gap: 2 },
  statLabel: { fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 0.5 },
  statVal: { fontSize: 20, fontWeight: 700, color: 'var(--accent)', fontFamily: 'var(--mono)' },
};

// ── Device Row Component ───────────────────────────────────────────────
function RedDeviceRow({ dev, onUpdate, onRemove, onMoveUp, onMoveDown, onAutoPlace, rackU, occupiedSlots, t }) {
  const typeInfo = RED_TYPE_MAP[dev.type] || { label: dev.type, color: '#374151' };

  const conflict = dev.position && (() => {
    for (let u = dev.position; u < dev.position + dev.heightU; u++) {
      if (occupiedSlots[u] && occupiedSlots[u] !== dev.id) return true;
    }
    return false;
  })();

  const outOfRange = dev.position && (dev.position < 1 || dev.position + dev.heightU - 1 > rackU);

  return (
    <div style={{ ...RED_S.devRow, borderLeft: `4px solid ${typeInfo.color || '#374151'}`, ...(conflict || outOfRange ? { borderColor: '#c0392b', background: 'rgba(192,57,43,0.05)' } : {}) }}>
      <div style={{ flex: '1 1 160px', minWidth: 120 }}>
        <label style={RED_S.label}>{t('rack_elevation.dev_name')}</label>
        <input className="input" style={RED_S.input} value={dev.name}
          onChange={e => onUpdate('name', e.target.value)} placeholder={typeInfo.label} />
      </div>
      <div style={{ flex: '0 1 140px' }}>
        <label style={RED_S.label}>{t('rack_elevation.dev_type')}</label>
        <select className="select" style={RED_S.input} value={dev.type} onChange={e => onUpdate('type', e.target.value)}>
          {RED_DEVICE_TYPES.map(dt => <option key={dt.id} value={dt.id}>{dt.label}</option>)}
        </select>
      </div>
      <div style={{ flex: '0 1 70px' }}>
        <label style={RED_S.label}>{t('rack_elevation.height_u')}</label>
        <input className="input" style={RED_S.input} type="number" min="1" max={rackU} value={dev.heightU}
          onChange={e => onUpdate('heightU', Math.max(1, parseInt(e.target.value) || 1))} />
      </div>
      <div style={{ flex: '0 1 80px' }}>
        <label style={RED_S.label}>{t('rack_elevation.position_u')}</label>
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input className="input" style={{ ...RED_S.input, borderColor: conflict || outOfRange ? '#c0392b' : '' }}
            type="number" min="1" max={rackU} value={dev.position || ''}
            placeholder="auto"
            onChange={e => onUpdate('position', e.target.value ? parseInt(e.target.value) : null)} />
        </div>
      </div>
      <div style={{ flex: '0 1 80px' }}>
        <label style={RED_S.label}>{t('rack_elevation.power_w')}</label>
        <input className="input" style={RED_S.input} type="number" min="0" value={dev.powerW || ''}
          placeholder="0" onChange={e => onUpdate('powerW', parseFloat(e.target.value) || 0)} />
      </div>
      <div style={{ flex: '0 1 80px' }}>
        <label style={RED_S.label}>{t('rack_elevation.weight_kg')}</label>
        <input className="input" style={RED_S.input} type="number" min="0" step="0.1" value={dev.weightKg || ''}
          placeholder="0" onChange={e => onUpdate('weightKg', parseFloat(e.target.value) || 0)} />
      </div>
      <div style={{ display: 'flex', gap: 4, alignItems: 'flex-end', paddingBottom: 0 }}>
        <button className="btn btn-ghost btn-sm" onClick={onMoveUp} title={t('rack_elevation.move_up')}>↑</button>
        <button className="btn btn-ghost btn-sm" onClick={onMoveDown} title={t('rack_elevation.move_down')}>↓</button>
        <button className="btn btn-ghost btn-sm" onClick={onAutoPlace} title={t('rack_elevation.auto_place')}>⊞</button>
        <button className="btn btn-danger btn-sm" onClick={onRemove}>✕</button>
      </div>
      {(conflict || outOfRange) && (
        <div style={{ width: '100%', fontSize: 11, color: '#c0392b' }}>
          {conflict ? t('rack_elevation.conflict_warn') : t('rack_elevation.out_of_range')}
        </div>
      )}
    </div>
  );
}

// ── Preset racks ──────────────────────────────────────────────────────
const RED_PRESETS = {
  small_office: {
    rackU: 12,
    rackName: 'Office Rack',
    devices: [
      { name: 'UPS 1500VA', type: 'ups', heightU: 2, position: 1, powerW: 0, weightKg: 22 },
      { name: 'PDU 16A', type: 'pdu', heightU: 1, position: 3, powerW: 0, weightKg: 2 },
      { name: 'Cable Mgmt', type: 'cable_mgmt', heightU: 1, position: 4, powerW: 0, weightKg: 0.5 },
      { name: 'Patch Panel 24p', type: 'patch_panel', heightU: 1, position: 5, powerW: 0, weightKg: 2 },
      { name: 'L3 Switch', type: 'switch', heightU: 1, position: 6, powerW: 120, weightKg: 4 },
      { name: 'Firewall', type: 'firewall', heightU: 1, position: 7, powerW: 85, weightKg: 3.5 },
      { name: 'Router/CPE', type: 'router', heightU: 1, position: 8, powerW: 45, weightKg: 2 },
    ].map(d => ({ ...d, id: redId(), notes: '' })),
  },
  data_center: {
    rackU: 42,
    rackName: 'DC Rack A01',
    devices: [
      { name: 'UPS 10kVA', type: 'ups', heightU: 3, position: 1, powerW: 0, weightKg: 120 },
      { name: 'PDU A', type: 'pdu', heightU: 1, position: 4, powerW: 0, weightKg: 3 },
      { name: 'PDU B', type: 'pdu', heightU: 1, position: 5, powerW: 0, weightKg: 3 },
      { name: 'KVM / Console', type: 'kvm', heightU: 1, position: 6, powerW: 30, weightKg: 2 },
      { name: 'Cable Mgmt', type: 'cable_mgmt', heightU: 1, position: 7, powerW: 0, weightKg: 0.5 },
      { name: 'Patch Panel A', type: 'patch_panel', heightU: 1, position: 8, powerW: 0, weightKg: 2 },
      { name: 'Patch Panel B', type: 'patch_panel', heightU: 1, position: 9, powerW: 0, weightKg: 2 },
      { name: 'ToR Switch A', type: 'switch', heightU: 1, position: 10, powerW: 350, weightKg: 8 },
      { name: 'ToR Switch B', type: 'switch', heightU: 1, position: 11, powerW: 350, weightKg: 8 },
      { name: 'Cable Mgmt', type: 'cable_mgmt', heightU: 1, position: 12, powerW: 0, weightKg: 0.5 },
      { name: 'Server 01', type: 'server', heightU: 2, position: 13, powerW: 450, weightKg: 18 },
      { name: 'Server 02', type: 'server', heightU: 2, position: 15, powerW: 450, weightKg: 18 },
      { name: 'Server 03', type: 'server', heightU: 2, position: 17, powerW: 450, weightKg: 18 },
      { name: 'Server 04', type: 'server', heightU: 2, position: 19, powerW: 450, weightKg: 18 },
      { name: 'Storage Array', type: 'storage', heightU: 4, position: 21, powerW: 800, weightKg: 60 },
    ].map(d => ({ ...d, id: redId(), notes: '' })),
  },
};

// ── Main Component ────────────────────────────────────────────────────
function RackElevationDesigner({ initialData, onShare }) {
  const { t } = useTranslation();
  const [rackU, setRackU] = usePersistentState('rack_elev:rackU', initialData?.rackU ?? 42);
  const [rackName, setRackName] = usePersistentState('rack_elev:rackName', initialData?.rackName ?? 'Rack A');
  const [devices, setDevices] = usePersistentState('rack_elev:devices', initialData?.devices ?? []);
  const [activeTab, setActiveTab] = usePersistentState('rack_elev:tab', initialData?.tab ?? 'design');
  const [showPower, setShowPower] = usePersistentState('rack_elev:showPower', true);
  const [showWeight, setShowWeight] = usePersistentState('rack_elev:showWeight', true);
  const [airflow, setAirflow] = usePersistentState('rack_elev:airflow', 'front-to-back');
  const [labelSide, setLabelSide] = usePersistentState('rack_elev:labelSide', 'left');
  const [copied, copy] = useCopy();

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'rack-elevation', rackU, rackName, devices, tab: activeTab });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [rackU, rackName, devices, activeTab, onShare]);

  const addDevice = useCallback((overrides = {}) => {
    const newDev = redNewDevice({
      name: '',
      type: 'server',
      heightU: 1,
      position: null,
      powerW: 0,
      weightKg: 0,
      ...overrides,
    });
    setDevices(prev => [...prev, newDev]);
  }, []);

  const updateDevice = useCallback((id, field, value) => {
    setDevices(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  }, []);

  const removeDevice = useCallback((id) => {
    setDevices(prev => prev.filter(d => d.id !== id));
  }, []);

  const moveDevice = useCallback((id, dir) => {
    setDevices(prev => {
      const idx = prev.findIndex(d => d.id === id);
      if (idx === -1) return prev;
      const next = [...prev];
      const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= next.length) return prev;
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
  }, []);

  const autoPlace = useCallback((id) => {
    setDevices(prev => {
      const dev = prev.find(d => d.id === id);
      if (!dev) return prev;
      const others = prev.filter(d => d.id !== id);
      const slot = redFindSlot(others, rackU, dev.heightU);
      if (!slot) return prev;
      return prev.map(d => d.id === id ? { ...d, position: slot } : d);
    });
  }, [rackU]);

  const autoPlaceAll = useCallback(() => {
    setDevices(prev => {
      const placed = [];
      for (const dev of [...prev]) {
        const slot = redFindSlot(placed, rackU, dev.heightU);
        placed.push({ ...dev, position: slot || null });
      }
      return placed;
    });
  }, [rackU]);

  const loadPreset = useCallback((presetKey) => {
    const preset = RED_PRESETS[presetKey];
    if (!preset) return;
    setRackU(preset.rackU);
    setRackName(preset.rackName);
    setDevices(preset.devices.map(d => ({ ...d, id: redId() })));
  }, []);

  // Slots map for conflict detection
  const occupiedSlots = useMemo(() => {
    const map = {};
    for (const dev of devices) {
      if (!dev.position) continue;
      for (let u = dev.position; u < dev.position + dev.heightU; u++) {
        map[u] = map[u] || dev.id;
        if (map[u] !== dev.id) map[u] = '__conflict__';
      }
    }
    return map;
  }, [devices]);

  const stats = useMemo(() => {
    const placed = devices.filter(d => d.position !== null).length;
    const usedU = devices.filter(d => d.position).reduce((s, d) => s + d.heightU, 0);
    const totalPower = devices.reduce((s, d) => s + (d.powerW || 0), 0);
    const totalWeight = devices.reduce((s, d) => s + (d.weightKg || 0), 0);
    const conflicts = Object.values(occupiedSlots).filter(v => v === '__conflict__').length;
    return { placed, usedU, totalPower, totalWeight, freeU: rackU - usedU, conflicts };
  }, [devices, occupiedSlots, rackU]);

  const asciiDiagram = useMemo(() => redBuildASCII(devices, rackU, rackName, showPower, showWeight, airflow), [devices, rackU, rackName, showPower, showWeight, airflow]);
  const svgDiagram = useMemo(() => redBuildSVG(devices, rackU, rackName, showPower, showWeight), [devices, rackU, rackName, showPower, showWeight]);

  const downloadSVG = useCallback(() => {
    const blob = new Blob([svgDiagram], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${rackName.replace(/\s+/g, '-')}.svg`; a.click();
    URL.revokeObjectURL(url);
  }, [svgDiagram, rackName]);

  const downloadText = useCallback(() => {
    const blob = new Blob([asciiDiagram], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${rackName.replace(/\s+/g, '-')}.txt`; a.click();
    URL.revokeObjectURL(url);
  }, [asciiDiagram, rackName]);

  const exportBOM = useCallback(() => {
    const rows = devices.map(d => ({
      name: d.name || RED_TYPE_MAP[d.type]?.label || d.type,
      type: d.type,
      height_U: d.heightU,
      position_U: d.position || '',
      power_W: d.powerW || 0,
      weight_kg: d.weightKg || 0,
      notes: d.notes || '',
    }));
    exportCSV(rows, `${rackName.replace(/\s+/g, '-')}-bom.csv`);
  }, [devices, rackName]);

  const TABS = [
    { id: 'design', label: t('rack_elevation.tab_design') },
    { id: 'ascii', label: t('rack_elevation.tab_ascii') },
    { id: 'svg', label: t('rack_elevation.tab_svg') },
    { id: 'bom', label: t('rack_elevation.tab_bom') },
  ];

  return (
    <div className="fadein">
      {/* Config */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10, marginBottom: 16, alignItems: 'flex-start' }}>
          <div className="card-title" style={{ margin: 0 }}>{t('rack_elevation.title')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <select className="select" style={{ height: 30, fontSize: 12, padding: '0 8px' }}
              defaultValue="" onChange={e => { if (e.target.value) loadPreset(e.target.value); }}>
              <option value="">{t('rack_elevation.load_preset')}</option>
              <option value="small_office">{t('rack_elevation.preset_office')}</option>
              <option value="data_center">{t('rack_elevation.preset_dc')}</option>
            </select>
          </div>
        </div>

        <div className="three-col" style={{ gap: 16, marginBottom: 20 }}>
          <div>
            <label style={RED_S.label}>{t('rack_elevation.rack_name')}</label>
            <input className="input" style={RED_S.input} value={rackName} onChange={e => setRackName(e.target.value)} />
          </div>
          <div>
            <label style={RED_S.label}>{t('rack_elevation.rack_size_u')}</label>
            <select className="select" style={RED_S.input} value={rackU} onChange={e => setRackU(parseInt(e.target.value))}>
              {[6, 9, 12, 16, 18, 20, 24, 28, 36, 40, 42, 45, 47, 48].map(u => (
                <option key={u} value={u}>{u}U</option>
              ))}
            </select>
          </div>
          <div>
            <label style={RED_S.label}>{t('rack_elevation.airflow')}</label>
            <select className="select" style={RED_S.input} value={airflow} onChange={e => setAirflow(e.target.value)}>
              <option value="front-to-back">{t('rack_elevation.af_ftb')}</option>
              <option value="back-to-front">{t('rack_elevation.af_btf')}</option>
              <option value="none">{t('rack_elevation.af_none')}</option>
            </select>
          </div>
        </div>

        {/* Stats */}
        <div style={{ ...RED_S.statBox, marginBottom: 20 }}>
          <div style={RED_S.statItem}>
            <span style={RED_S.statLabel}>{t('rack_elevation.stat_devices')}</span>
            <span style={RED_S.statVal}>{devices.length}</span>
          </div>
          <div style={RED_S.statItem}>
            <span style={RED_S.statLabel}>{t('rack_elevation.stat_used')}</span>
            <span style={RED_S.statVal}>{stats.usedU}U</span>
          </div>
          <div style={RED_S.statItem}>
            <span style={RED_S.statLabel}>{t('rack_elevation.stat_free')}</span>
            <span style={{ ...RED_S.statVal, color: stats.freeU < 4 ? '#c0392b' : 'var(--accent)' }}>{stats.freeU}U</span>
          </div>
          <div style={RED_S.statItem}>
            <span style={RED_S.statLabel}>{t('rack_elevation.stat_power')}</span>
            <span style={RED_S.statVal}>{stats.totalPower}W</span>
          </div>
          <div style={RED_S.statItem}>
            <span style={RED_S.statLabel}>{t('rack_elevation.stat_weight')}</span>
            <span style={RED_S.statVal}>{stats.totalWeight.toFixed(1)}kg</span>
          </div>
          {stats.totalPower > 0 && (
            <div style={RED_S.statItem}>
              <span style={RED_S.statLabel}>{t('rack_elevation.stat_amperes')} (208V)</span>
              <span style={RED_S.statVal}>{(stats.totalPower / 208).toFixed(1)}A</span>
            </div>
          )}
          {stats.conflicts > 0 && (
            <div style={RED_S.statItem}>
              <span style={RED_S.statLabel}>{t('rack_elevation.stat_conflicts')}</span>
              <span style={{ ...RED_S.statVal, color: '#c0392b' }}>{stats.conflicts}</span>
            </div>
          )}
        </div>

        <div className="btn-row" style={{ marginBottom: 16 }}>
          {TABS.map(tab => (
            <button key={tab.id}
              className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>

        {/* DESIGN TAB */}
        {activeTab === 'design' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-sm" onClick={() => addDevice()}>
                + {t('rack_elevation.add_device')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={autoPlaceAll}>
                {t('rack_elevation.auto_place_all')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => {
                addDevice({ type: 'switch', heightU: 1 });
                addDevice({ type: 'server', heightU: 2 });
                addDevice({ type: 'patch_panel', heightU: 1 });
              }}>
                {t('rack_elevation.add_common')}
              </button>
              <div style={{ flex: 1 }} />
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={showPower} onChange={e => setShowPower(e.target.checked)} />
                {t('rack_elevation.show_power')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={showWeight} onChange={e => setShowWeight(e.target.checked)} />
                {t('rack_elevation.show_weight')}
              </label>
            </div>

            {devices.length === 0 && (
              <div style={{ textAlign: 'center', padding: '30px 20px', color: 'var(--dim)', fontSize: 13 }}>
                {t('rack_elevation.empty_hint')}
              </div>
            )}

            {devices.map((dev, idx) => (
              <RedDeviceRow
                key={dev.id}
                dev={dev}
                rackU={rackU}
                occupiedSlots={occupiedSlots}
                t={t}
                onUpdate={(field, val) => updateDevice(dev.id, field, val)}
                onRemove={() => removeDevice(dev.id)}
                onMoveUp={() => moveDevice(dev.id, 'up')}
                onMoveDown={() => moveDevice(dev.id, 'down')}
                onAutoPlace={() => autoPlace(dev.id)}
              />
            ))}
          </div>
        )}

        {/* ASCII TAB */}
        {activeTab === 'ascii' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => copy(asciiDiagram, 'ascii')}>
                {copied === 'ascii' ? '✓' : t('common.copy')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={downloadText}>
                {t('rack_elevation.download_txt')}
              </button>
            </div>
            <div style={RED_S.codeBox}>{asciiDiagram}</div>
          </div>
        )}

        {/* SVG TAB */}
        {activeTab === 'svg' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => copy(svgDiagram, 'svg')}>
                {copied === 'svg' ? '✓' : t('rack_elevation.copy_svg')}
              </button>
              <button className="btn btn-primary btn-sm" onClick={downloadSVG}>
                {t('rack_elevation.download_svg')}
              </button>
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 16, background: 'var(--panel)' }}>
              <div dangerouslySetInnerHTML={{ __html: svgDiagram }} />
            </div>
          </div>
        )}

        {/* BOM TAB */}
        {activeTab === 'bom' && (
          <div>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={exportBOM}>
                {t('common.export_csv')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => exportJSON(devices.map(d => ({
                name: d.name || RED_TYPE_MAP[d.type]?.label, type: d.type, height_U: d.heightU,
                position_U: d.position, power_W: d.powerW, weight_kg: d.weightKg, notes: d.notes
              })), `${rackName.replace(/\s+/g, '-')}-bom.json`)}>
                {t('common.export_json')}
              </button>
            </div>
            <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--panel)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 13 }}>
                <thead>
                  <tr>
                    {[t('rack_elevation.col_name'), t('rack_elevation.col_type'), 'U', t('rack_elevation.col_pos'), t('rack_elevation.col_power'), t('rack_elevation.col_weight')].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 11, textTransform: 'uppercase', background: 'var(--bg)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {devices.map(dev => {
                    const typeInfo = RED_TYPE_MAP[dev.type] || {};
                    return (
                      <tr key={dev.id}>
                        <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', fontWeight: 600 }}>
                          <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 2, background: typeInfo.color, marginRight: 8 }} />
                          {dev.name || typeInfo.label || dev.type}
                        </td>
                        <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', color: 'var(--dim)' }}>{typeInfo.label}</td>
                        <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>{dev.heightU}U</td>
                        <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
                          {dev.position ? `U${dev.position}–U${dev.position + dev.heightU - 1}` : <span style={{ color: 'var(--dim)' }}>—</span>}
                        </td>
                        <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
                          {dev.powerW ? `${dev.powerW} W` : <span style={{ color: 'var(--dim)' }}>—</span>}
                        </td>
                        <td style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)' }}>
                          {dev.weightKg ? `${dev.weightKg} kg` : <span style={{ color: 'var(--dim)' }}>—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {devices.length > 0 && (
                    <tr style={{ background: 'var(--bg)' }}>
                      <td colSpan={4} style={{ padding: '7px 10px', fontWeight: 700, color: 'var(--dim)', fontSize: 11 }}>TOTAL</td>
                      <td style={{ padding: '7px 10px', fontWeight: 700 }}>{stats.totalPower} W</td>
                      <td style={{ padding: '7px 10px', fontWeight: 700 }}>{stats.totalWeight.toFixed(1)} kg</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Utilization bar */}
            {rackU > 0 && (
              <div style={{ marginTop: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--dim)', marginBottom: 6 }}>
                  <span>{t('rack_elevation.utilization')}</span>
                  <span>{stats.usedU}U / {rackU}U ({Math.round(stats.usedU / rackU * 100)}%)</span>
                </div>
                <div style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, overflow: 'hidden', height: 16 }}>
                  <div style={{ height: '100%', width: `${Math.min(100, stats.usedU / rackU * 100)}%`, background: stats.usedU / rackU > 0.9 ? '#c0392b' : stats.usedU / rackU > 0.75 ? '#f5a623' : 'var(--accent)', transition: 'width 0.3s' }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

window.RackElevationDesigner = RackElevationDesigner;
