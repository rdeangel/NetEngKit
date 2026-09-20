const { useState, useEffect, useCallback, useRef, useMemo } = React;

/* ── Data structures ── */
const DEFAULT_DEVICE = () => ({
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  name: '',
  type: 'router',
  label: '',
});

const DEFAULT_LINK = () => ({
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  from: '',
  fromIntf: '',
  to: '',
  toIntf: '',
  label: '',
});

const DEVICE_SYMBOLS = {
  router:   '[R]',
  switch:   '[S]',
  firewall: '[FW]',
  server:   '[SRV]',
  cloud:    '(C)',
  ap:       '[AP]',
  host:     '[H]',
  l3sw:     '[L3]',
  other:    '[*]',
};

const DEVICE_WIDTH = 12; // chars wide for label slot

function layoutDevices(devices, links) {
  // Simple topological layout: assign columns by BFS from first device
  const col = {};
  const row = {};
  const visited = new Set();
  const queue = [];

  if (devices.length === 0) return { col, row };

  // Start with first device
  queue.push({ id: devices[0].id, c: 0, r: 0 });
  visited.add(devices[0].id);

  // Build adjacency
  const adj = {};
  devices.forEach(d => { adj[d.id] = []; });
  links.forEach(l => {
    if (l.from && l.to) {
      if (adj[l.from]) adj[l.from].push(l.to);
      if (adj[l.to]) adj[l.to].push(l.from);
    }
  });

  // BFS
  let rCounter = 0;
  while (queue.length > 0) {
    const { id, c, r } = queue.shift();
    col[id] = c;
    row[id] = r;
    let nextRow = r;
    (adj[id] || []).forEach(nid => {
      if (!visited.has(nid)) {
        visited.add(nid);
        queue.push({ id: nid, c: c + 1, r: nextRow });
        nextRow++;
      }
    });
  }

  // Unvisited devices (no links)
  let orphanCol = 0;
  devices.forEach(d => {
    if (!visited.has(d.id)) {
      col[d.id] = orphanCol;
      row[d.id] = Object.keys(col).length;
      orphanCol++;
    }
  });

  return { col, row };
}

function generateDiagram(devices, links, showIntf, showLabels) {
  if (devices.length === 0) return '(no devices)';

  const { col: devCol, row: devRow } = layoutDevices(devices, links);

  // Normalize positions
  const colIds = [...new Set(Object.values(devCol))].sort((a, b) => a - b);
  const colMap = {};
  colIds.forEach((c, i) => { colMap[c] = i; });

  const rowIds = [...new Set(Object.values(devRow))].sort((a, b) => a - b);
  const rowMap = {};
  rowIds.forEach((r, i) => { rowMap[r] = i; });

  const maxCol = colIds.length - 1;
  const maxRow = rowIds.length - 1;

  // Build device map
  const devMap = {};
  devices.forEach(d => { devMap[d.id] = d; });

  // Calculate grid dimensions
  const COL_SPACING = 22;
  const ROW_SPACING = 5;
  const gridW = (maxCol + 1) * COL_SPACING + 20;
  const gridH = (maxRow + 1) * ROW_SPACING + 4;

  // Initialize grid
  const grid = Array.from({ length: gridH }, () => Array(gridW).fill(' '));

  function putStr(y, x, str) {
    for (let i = 0; i < str.length; i++) {
      if (y >= 0 && y < gridH && x + i >= 0 && x + i < gridW) {
        grid[y][x + i] = str[i];
      }
    }
  }

  // Place devices
  const devPos = {};
  devices.forEach(d => {
    const cx = (colMap[devCol[d.id]] || 0) * COL_SPACING + 10;
    const cy = (rowMap[devRow[d.id]] || 0) * ROW_SPACING + 2;
    devPos[d.id] = { x: cx, y: cy };

    const sym = DEVICE_SYMBOLS[d.type] || '[*]';
    const name = d.name || 'unnamed';
    const labelStr = d.label && showLabels ? ` (${d.label})` : '';

    putStr(cy, cx - Math.floor(sym.length / 2), sym);
    putStr(cy + 1, cx - Math.floor(name.length / 2), name);
    if (labelStr) {
      putStr(cy - 1, cx - Math.floor(labelStr.length / 2), labelStr);
    }
  });

  // Place links
  links.forEach(l => {
    const from = devPos[l.from];
    const to = devPos[l.to];
    if (!from || !to) return;

    const fx = from.x + 4;
    const fy = from.y;
    const tx = to.x - 4;
    const ty = to.y;

    if (fx < tx) {
      // Horizontal connection (same row or different)
      const midY = Math.floor((fy + ty) / 2);
      // Horizontal from source
      for (let x = fx; x <= fx + 2; x++) {
        if (fy >= 0 && fy < gridH && x >= 0 && x < gridW) grid[fy][x] = '─';
      }
      // Vertical to target row
      if (fy !== ty) {
        const vStart = Math.min(fy, ty);
        const vEnd = Math.max(fy, ty);
        const vX = fx + 3;
        for (let y = vStart; y <= vEnd; y++) {
          if (y >= 0 && y < gridH && vX >= 0 && vX < gridW) {
            grid[y][vX] = y === vStart ? '┐' : y === vEnd ? '┘' : '│';
          }
        }
        // Horizontal to target
        for (let x = vX + 1; x <= tx; x++) {
          if (ty >= 0 && ty < gridH && x >= 0 && x < gridW) grid[ty][x] = '─';
        }
      } else {
        for (let x = fx; x <= tx; x++) {
          if (fy >= 0 && fy < gridH && x >= 0 && x < gridW) grid[fy][x] = '─';
        }
      }

      // Link label
      if (l.label && showLabels) {
        const labelX = Math.floor((fx + tx) / 2) - Math.floor(l.label.length / 2);
        const labelY = fy === ty ? fy - 1 : Math.min(fy, ty);
        putStr(labelY, labelX, l.label);
      }

      // Interface labels
      if (showIntf) {
        if (l.fromIntf) putStr(fy, fx - l.fromIntf.length - 1, l.fromIntf);
        if (l.toIntf) putStr(ty, tx + 1, l.toIntf);
      }
    } else {
      // Same column or reverse — draw vertical connection
      const topY = Math.min(fy, ty);
      const botY = Math.max(fy, ty);
      const vX = Math.floor((from.x + to.x) / 2);
      for (let y = topY + 1; y < botY; y++) {
        if (y >= 0 && y < gridH && vX >= 0 && vX < gridW) grid[y][vX] = '│';
      }
    }
  });

  return grid.map(row => row.join('').replace(/ +$/, '')).filter(l => l.length > 0).join('\n');
}

function ASCIIDiagramGenerator({ onShare, initialData }) {
  const { t } = useTranslation();

  const [devices, setDevices] = usePersistentState('asdiag:devices', () => {
    if (initialData?.devices?.length) return initialData.devices;
    return [DEFAULT_DEVICE()];
  });
  const [links, setLinks] = usePersistentState('asdiag:links', () => {
    if (initialData?.links?.length) return initialData.links;
    return [DEFAULT_LINK()];
  });
  const [showIntf, setShowIntf] = usePersistentState('asdiag:showIntf', true);
  const [showLabels, setShowLabels] = usePersistentState('asdiag:showLabels', true);
  const [copied, copy] = useCopy();

  // Share URL wiring
  useEffect(() => {
    const handle = (e) => {
      (e.detail?.respond ?? onShare)({ tool: 'ascii-diagram', devices, links });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [devices, links, onShare]);

  // Device helpers
  const updateDev = useCallback((id, field, value) => {
    setDevices(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  }, []);
  const addDev = useCallback(() => setDevices(prev => [...prev, DEFAULT_DEVICE()]), []);
  const removeDev = useCallback((id) => setDevices(prev => prev.length <= 1 ? prev : prev.filter(d => d.id !== id)), []);

  // Link helpers
  const updateLink = useCallback((id, field, value) => {
    setLinks(prev => prev.map(l => l.id === id ? { ...l, [field]: value } : l));
  }, []);
  const addLink = useCallback(() => setLinks(prev => [...prev, DEFAULT_LINK()]), []);
  const removeLink = useCallback((id) => setLinks(prev => prev.length <= 1 ? prev : prev.filter(l => l.id !== id)), []);

  const diagram = useMemo(() => generateDiagram(devices, links, showIntf, showLabels), [devices, links, showIntf, showLabels]);

  const doExport = () => {
    const blob = new Blob(['```\n' + diagram + '\n```\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'network-diagram.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fadein">
      <div className="card">
        <h2 className="card-title">{t('ascii_diagram.title')}</h2>
        <p style={{ color: 'var(--text2)', fontSize: '0.88rem', marginBottom: '1rem' }}>
          {t('ascii_diagram.subtitle')}
        </p>

        <div className="two-col">
          <div>
            {/* Devices */}
            <h3 style={{ marginTop: 0 }}>{t('ascii_diagram.devices')}</h3>
            {devices.map((dev) => (
              <div key={dev.id} style={{
                display: 'flex', gap: '0.4rem', marginBottom: '0.4rem', flexWrap: 'wrap',
                alignItems: 'center'
              }}>
                <select className="select" style={{ width: 80 }}
                  value={dev.type} onChange={e => updateDev(dev.id, 'type', e.target.value)}>
                  {Object.entries(DEVICE_SYMBOLS).map(([k, v]) => (
                    <option key={k} value={k}>{v} {k}</option>
                  ))}
                </select>
                <input className="input" style={{ flex: 1, minWidth: 100 }}
                  value={dev.name} onChange={e => updateDev(dev.id, 'name', e.target.value)}
                  placeholder={t('ascii_diagram.device_name')} />
                <input className="input" style={{ width: 100 }}
                  value={dev.label} onChange={e => updateDev(dev.id, 'label', e.target.value)}
                  placeholder={t('ascii_diagram.device_label')} />
                <button className="btn btn-danger btn-sm" onClick={() => removeDev(dev.id)}>×</button>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={addDev}>
              + {t('ascii_diagram.add_device')}
            </button>

            {/* Links */}
            <h3>{t('ascii_diagram.links')}</h3>
            {links.map((lnk) => (
              <div key={lnk.id} style={{
                padding: '0.5rem', marginBottom: '0.4rem',
                background: 'var(--panel)', borderRadius: 'var(--radius, 8px)',
                border: '1px solid var(--border)'
              }}>
                <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '0.3rem', flexWrap: 'wrap', alignItems: 'center' }}>
                  <select className="select" style={{ flex: 1, minWidth: 80 }}
                    value={lnk.from} onChange={e => updateLink(lnk.id, 'from', e.target.value)}>
                    <option value="">— from —</option>
                    {devices.map(d => <option key={d.id} value={d.id}>{d.name || d.id.slice(0,6)}</option>)}
                  </select>
                  <input className="input" style={{ width: 80 }}
                    value={lnk.fromIntf} onChange={e => updateLink(lnk.id, 'fromIntf', e.target.value)}
                    placeholder={t('ascii_diagram.intf')} />
                  <span style={{ color: 'var(--text2)' }}>→</span>
                  <select className="select" style={{ flex: 1, minWidth: 80 }}
                    value={lnk.to} onChange={e => updateLink(lnk.id, 'to', e.target.value)}>
                    <option value="">— to —</option>
                    {devices.map(d => <option key={d.id} value={d.id}>{d.name || d.id.slice(0,6)}</option>)}
                  </select>
                  <input className="input" style={{ width: 80 }}
                    value={lnk.toIntf} onChange={e => updateLink(lnk.id, 'toIntf', e.target.value)}
                    placeholder={t('ascii_diagram.intf')} />
                </div>
                <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                  <input className="input" style={{ flex: 1 }}
                    value={lnk.label} onChange={e => updateLink(lnk.id, 'label', e.target.value)}
                    placeholder={t('ascii_diagram.link_label')} />
                  <button className="btn btn-danger btn-sm" onClick={() => removeLink(lnk.id)}>×</button>
                </div>
              </div>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={addLink}>
              + {t('ascii_diagram.add_link')}
            </button>

            {/* Options */}
            <div style={{ marginTop: '1rem', display: 'flex', gap: '1rem', fontSize: '0.85rem' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={showIntf} onChange={e => setShowIntf(e.target.checked)} />
                {t('ascii_diagram.show_intf')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', cursor: 'pointer' }}>
                <input type="checkbox" checked={showLabels} onChange={e => setShowLabels(e.target.checked)} />
                {t('ascii_diagram.show_labels')}
              </label>
            </div>
          </div>

          {/* Output */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{t('ascii_diagram.output')}</h3>
              <div className="btn-row">
                <button className="btn btn-sm btn-ghost" onClick={doExport}>{t('common.export')}</button>
                <button className="btn btn-sm btn-primary" onClick={() => copy(diagram, 'diag-out')}>
                  {copied === 'diag-out' ? '✓' : t('common.copy')}
                </button>
              </div>
            </div>
            <pre style={{
              background: 'var(--pre-bg, #0d1117)', color: 'var(--pre-fg, #c9d1d9)',
              padding: '1rem', borderRadius: 'var(--radius, 8px)', fontSize: '0.78rem',
              overflow: 'auto', maxHeight: '500px', lineHeight: '1.4',
              border: '1px solid var(--border, #333)', fontFamily: 'monospace',
            }}>{diagram}</pre>
          </div>
        </div>
      </div>
    </div>
  );
}

window.ASCIIDiagramGenerator = ASCIIDiagramGenerator;
