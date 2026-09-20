const { useState, useEffect, useCallback, useMemo, useRef } = React;

// ── Capability code expansion ─────────────────────────────────────────
const LLDP_CAP_MAP = {
  o: 'Other',
  p: 'Repeater',
  b: 'Bridge',
  w: 'WLAN AP',
  r: 'Router',
  t: 'Telephone',
  c: 'DOCSIS',
  s: 'Station Only',
  i: 'IGMP',
  d: 'LLDP-MED',
};

const LLDP_CDP_CAP_MAP = {
  router: 'Router',
  switch: 'Switch',
  bridge: 'Bridge',
  host: 'Host',
  igmp: 'IGMP',
  repeater: 'Repeater',
  phone: 'Phone',
  remote: 'Remote',
};

// ── Auto-detect protocol from input ──────────────────────────────────
function lldpDetectProtocol(text) {
  const lower = text.toLowerCase();
  const cdpScore = (lower.match(/\bdevice id\b/g) || []).length
    + (lower.match(/\bplatform\b/g) || []).length
    + (lower.match(/\bcdp\b/g) || []).length
    + (lower.match(/\bentry address/g) || []).length;
  const lldpScore = (lower.match(/\bchassis id\b/g) || []).length
    + (lower.match(/\bport id\b/g) || []).length
    + (lower.match(/\blldp\b/g) || []).length
    + (lower.match(/\bsystem name\b/g) || []).length;
  return cdpScore > lldpScore ? 'cdp' : 'lldp';
}

// ── Detect compact vs detail format ──────────────────────────────────
function lldpDetectFormat(text) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/^Device\s+ID\s+/i.test(line) && /Local\s+Intr?fce/i.test(line)) return 'compact';
    if (/^Device\s+ID\s+/i.test(line) && /Local\s+Intf/i.test(line)) return 'compact';
    if (/capability/i.test(line) && /platform/i.test(line) && /port\s*id/i.test(line)) return 'compact';
  }
  return 'detail';
}

// ── Parse LLDP detail blocks ─────────────────────────────────────────
function lldpParseDetail(text) {
  const neighbors = [];
  const blocks = text.split(/^-{3,}/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const get = (re) => { const m = block.match(re); return m ? m[1].trim() : ''; };
    const neighbor = {
      device: get(/system\s*name\s*:\s*(.+)/i) || get(/chassis\s*id\s*:\s*(.+)/i),
      platform: get(/system\s*description\s*:\s*(.+)/i),
      localIntf: get(/local\s*interface\s*:\s*(.+)/i),
      remoteIntf: get(/^port\s*id\s*:\s*(.+)/im),
      mgmtIP: get(/management\s*address(?:es)?\s*:\s*(.+)/i),
      chassisId: get(/chassis\s*id\s*:\s*(.+)/i),
      portId: get(/^port\s*id\s*:\s*(.+)/im),
      ttl: get(/time\s*remaining\s*:\s*(.+)/i),
      capabilities: get(/enabled\s*capabilities\s*:\s*(.+)/i) || get(/system\s*capabilities\s*:\s*(.+)/i),
      vlan: get(/^vlan\s*:\s*(.+)/im),
      protocol: 'LLDP',
    };
    if (neighbor.device || neighbor.chassisId) neighbors.push(neighbor);
  }
  return neighbors;
}

// ── Parse LLDP compact table ─────────────────────────────────────────
function lldpParseCompact(text) {
  const neighbors = [];
  const lines = text.split('\n');
  let headerLine = null;
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^Device\s+ID\s+/i.test(lines[i]) && /local\s+intf/i.test(lines[i])) {
      headerLine = lines[i];
      headerIdx = i;
      break;
    }
  }
  if (!headerLine) {
    const trimmed = lines.map(l => l.trim()).filter(Boolean);
    if (trimmed.length > 0 && /device\s*id/i.test(trimmed[0])) {
      headerLine = lines.find(l => l.trim() === trimmed[0]);
      headerIdx = lines.indexOf(headerLine);
    }
  }
  if (!headerLine) return neighbors;

  const colPositions = {};
  const devMatch = headerLine.match(/^Device\s+ID/i);
  const localMatch = headerLine.match(/Local\s+Intf/i);
  const holdMatch = headerLine.match(/Hold\s*time/i);
  const capMatch = headerLine.match(/Capability/i);
  const platMatch = headerLine.match(/Platform/i);
  const portMatch = headerLine.match(/Port\s+ID/i);

  if (devMatch) colPositions.device = devMatch.index;
  if (localMatch) colPositions.local = localMatch.index;
  if (holdMatch) colPositions.hold = holdMatch.index;
  if (capMatch) colPositions.cap = capMatch.index;
  if (platMatch) colPositions.plat = platMatch.index;
  if (portMatch) colPositions.port = portMatch.index;

  const sortedCols = ['device', 'local', 'hold', 'cap', 'plat', 'port']
    .filter(c => colPositions[c] !== undefined)
    .sort((a, b) => colPositions[a] - colPositions[b]);

  const colEnds = {};
  for (let i = 0; i < sortedCols.length; i++) {
    colEnds[sortedCols[i]] = i + 1 < sortedCols.length ? colPositions[sortedCols[i + 1]] : 9999;
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^[-=]+$/.test(line.trim())) continue;

    const extract = (col) => {
      if (colPositions[col] === undefined) return '';
      const start = colPositions[col];
      const end = colEnds[col];
      return (line.substring(start, Math.min(end, line.length)) || '').trim();
    };

    const device = extract('device');
    if (!device) continue;

    neighbors.push({
      device,
      localIntf: extract('local'),
      ttl: extract('hold'),
      capabilities: extract('cap'),
      platform: extract('plat'),
      remoteIntf: extract('port'),
      mgmtIP: '',
      chassisId: '',
      portId: extract('port'),
      vlan: '',
      protocol: 'LLDP',
    });
  }
  return neighbors;
}

// ── Parse CDP detail blocks ──────────────────────────────────────────
function lldpParseCDPDetail(text) {
  const neighbors = [];
  const blocks = text.split(/^-{3,}/);
  for (const block of blocks) {
    if (!block.trim()) continue;
    const get = (re) => { const m = block.match(re); return m ? m[1].trim() : ''; };
    const rawDevice = get(/device\s*id\s*:\s*(.+)/i);
    const deviceName = rawDevice.replace(/\(.*?\)$/, '').trim();
    const platform = get(/platform\s*:\s*(.+)/i).replace(/,\s*capabilities\s*:.*$/i, '').trim();
    const rawCaps = get(/capabilities\s*:\s*(.+)/i);
    const intfLine = block.match(/interface\s*:\s*(.+?),\s*port\s*id.*?:\s*(.+)/i);
    const localIntf = intfLine ? intfLine[1].trim() : get(/^interface\s*:\s*(.+)/im);
    const remoteIntf = intfLine ? intfLine[2].trim() : get(/port\s*id.*?:\s*(.+)/i);
    const ipMatches = block.match(/ip\s*address\s*:\s*([\d.]+)/gi) || [];
    const mgmtIP = ipMatches.map(m => m.replace(/ip\s*address\s*:\s*/i, '').trim()).join(', ');
    const neighbor = {
      device: deviceName,
      platform: platform,
      localIntf: localIntf,
      remoteIntf: remoteIntf,
      mgmtIP: mgmtIP,
      chassisId: '',
      portId: remoteIntf,
      ttl: get(/holdtime\s*:\s*(.+)/i),
      capabilities: rawCaps,
      vlan: '',
      protocol: 'CDP',
    };
    if (neighbor.device) neighbors.push(neighbor);
  }
  return neighbors;
}

// ── Parse CDP compact table ──────────────────────────────────────────
function lldpParseCDPCompact(text) {
  const neighbors = [];
  const lines = text.split('\n');
  let headerLine = null;
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^Device\s+ID\s+/i.test(lines[i])) {
      headerLine = lines[i];
      headerIdx = i;
      break;
    }
  }
  if (!headerLine) return neighbors;

  const colPositions = {};
  const deviceMatch = headerLine.match(/^Device\s+ID/i);
  const localMatch = headerLine.match(/Local\s+Intr?fce/i);
  const holdMatch = headerLine.match(/Holdt?me/i);
  const capMatch = headerLine.match(/Capability/i);
  const platMatch = headerLine.match(/Platform/i);
  const portMatch = headerLine.match(/Port\s+ID/i);

  if (deviceMatch) colPositions.device = deviceMatch.index;
  if (localMatch) colPositions.local = localMatch.index;
  if (holdMatch) colPositions.hold = holdMatch.index;
  if (capMatch) colPositions.cap = capMatch.index;
  if (platMatch) colPositions.plat = platMatch.index;
  if (portMatch) colPositions.port = portMatch.index;

  const sortedCols = ['device', 'local', 'hold', 'cap', 'plat', 'port']
    .filter(c => colPositions[c] !== undefined)
    .sort((a, b) => colPositions[a] - colPositions[b]);

  const colEnds = {};
  for (let i = 0; i < sortedCols.length; i++) {
    colEnds[sortedCols[i]] = i + 1 < sortedCols.length ? colPositions[sortedCols[i + 1]] : 9999;
  }

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    if (/^[-=]+$/.test(line.trim())) continue;
    if (/^capability\s+codes/i.test(line.trim())) continue;
    if (/^Device\s+ID/i.test(line.trim())) continue;

    const extract = (col) => {
      if (colPositions[col] === undefined) return '';
      const start = colPositions[col];
      const end = colEnds[col];
      return (line.substring(start, Math.min(end, line.length)) || '').trim();
    };

    const device = extract('device');
    if (!device) continue;

    neighbors.push({
      device,
      localIntf: extract('local'),
      ttl: extract('hold'),
      capabilities: extract('cap'),
      platform: extract('plat'),
      remoteIntf: extract('port'),
      mgmtIP: '',
      chassisId: '',
      portId: extract('port'),
      vlan: '',
      protocol: 'CDP',
    });
  }
  return neighbors;
}

// ── Main parse dispatcher ────────────────────────────────────────────
function lldpParseInput(text) {
  if (!text || !text.trim()) return { neighbors: [], protocol: null, format: null, error: null };
  const protocol = lldpDetectProtocol(text);
  const format = lldpDetectFormat(text);
  let neighbors = [];
  try {
    if (protocol === 'cdp') {
      neighbors = format === 'compact' ? lldpParseCDPCompact(text) : lldpParseCDPDetail(text);
    } else {
      neighbors = format === 'compact' ? lldpParseCompact(text) : lldpParseDetail(text);
    }
    if (neighbors.length === 0) {
      return { neighbors: [], protocol, format, error: 'no_neighbors' };
    }
    return { neighbors, protocol, format, error: null };
  } catch (e) {
    return { neighbors: [], protocol, format, error: 'parse_error' };
  }
}

// ── Expand capability codes to readable form ─────────────────────────
function lldpExpandCaps(caps, protocol) {
  if (!caps) return '';
  if (protocol === 'LLDP') {
    return caps.split(/[\s,]+/).map(c => {
      const lower = c.toLowerCase().replace(/\./g, '');
      return LLDP_CAP_MAP[lower] || c;
    }).filter(Boolean).join(', ');
  }
  return caps.split(/[\s,]+/).map(c => {
    const lower = c.toLowerCase();
    return LLDP_CDP_CAP_MAP[lower] || c;
  }).filter(Boolean).join(', ');
}

// ── Build topology map lines ─────────────────────────────────────────
function lldpBuildTopology(neighbors) {
  if (!neighbors.length) return [];
  const lines = [];
  const maxLocal = Math.max(...neighbors.map(n => (n.localIntf || '').length), 10);
  const maxDevice = Math.max(...neighbors.map(n => (n.device || '').length), 10);
  for (const n of neighbors) {
    const local = (n.localIntf || '').padEnd(maxLocal);
    const dev = (n.device || '').padEnd(maxDevice);
    const remote = n.remoteIntf || '';
    lines.push(`${local} ─── ${dev} : ${remote}`);
  }
  return lines;
}

// ── Compute summary stats ────────────────────────────────────────────
function lldpComputeStats(neighbors) {
  const total = neighbors.length;
  const uniqueDevices = [...new Set(neighbors.map(n => n.device).filter(Boolean))];
  const allCaps = neighbors.flatMap(n => {
    const caps = n.capabilities || '';
    if (n.protocol === 'CDP') return caps.split(/[\s,]+/).map(c => c.toLowerCase());
    return caps.split(/[\s,]+/).map(c => c.toLowerCase().replace(/\./g, ''));
  }).filter(Boolean);
  const uniqueCaps = [...new Set(allCaps)];
  return { total, uniqueDevices: uniqueDevices.length, deviceNames: uniqueDevices, capabilities: uniqueCaps };
}

// ── Main Component ───────────────────────────────────────────────────
function LLDPCDPParser({ initialData, onShare }) {
  const { t } = useTranslation();
  const [lldpInput, setLldpInput] = usePersistentState('lldp_cdp_parser:input', initialData?.input ?? '');
  const [lldpResult, setLldpResult] = usePersistentState('lldp_cdp_parser:result', null);
  const [lldpError, setLldpError] = useState(null);

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'lldp-cdp-parser', input: lldpInput });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [lldpInput, onShare]);

  // Auto-parse with 300ms debounce
  useEffect(() => {
    if (!lldpInput.trim()) {
      setLldpResult(null);
      setLldpError(null);
      return;
    }
    const timer = setTimeout(() => {
      const res = lldpParseInput(lldpInput);
      setLldpResult(res);
      setLldpError(res.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [lldpInput]);

  const clear = useCallback(() => {
    setLldpInput('');
    setLldpResult(null);
    setLldpError(null);
  }, []);

  const stats = useMemo(() => {
    if (!lldpResult?.neighbors?.length) return null;
    return lldpComputeStats(lldpResult.neighbors);
  }, [lldpResult]);

  const topoLines = useMemo(() => {
    if (!lldpResult?.neighbors?.length) return [];
    return lldpBuildTopology(lldpResult.neighbors);
  }, [lldpResult]);

  const handleExportJSON = useCallback(() => {
    if (!lldpResult?.neighbors?.length) return;
    exportJSON(lldpResult.neighbors, 'lldp-cdp-neighbors.json');
  }, [lldpResult]);

  const handleExportCSV = useCallback(() => {
    if (!lldpResult?.neighbors?.length) return;
    const rows = lldpResult.neighbors.map(n => ({
      [t('lldp_cdp_parser.col_neighbor')]: n.device,
      [t('lldp_cdp_parser.col_platform')]: n.platform,
      [t('lldp_cdp_parser.col_local_intf')]: n.localIntf,
      [t('lldp_cdp_parser.col_remote_intf')]: n.remoteIntf,
      [t('lldp_cdp_parser.col_mgmt_ip')]: n.mgmtIP,
      [t('lldp_cdp_parser.col_capabilities')]: n.capabilities,
      [t('lldp_cdp_parser.col_ttl')]: n.ttl,
      [t('lldp_cdp_parser.col_vlan')]: n.vlan,
      [t('lldp_cdp_parser.col_chassis_id')]: n.chassisId,
      [t('lldp_cdp_parser.col_protocol')]: n.protocol,
    }));
    exportCSV(rows, 'lldp-cdp-neighbors.csv');
  }, [lldpResult]);

  const handleExportTopo = useCallback(() => {
    if (!topoLines.length) return;
    const text = topoLines.join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'topology-map.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [topoLines]);

  const protocolBadge = lldpResult?.protocol
    ? lldpResult.protocol === 'lldp' ? 'badge-cyan' : 'badge-green'
    : '';

  const hasResult = lldpResult?.neighbors?.length > 0;

  const tableThStyle = {
    textAlign: 'left',
    padding: '8px 10px',
    borderBottom: '1px solid var(--border)',
    color: 'var(--dim)',
    fontSize: 11,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    whiteSpace: 'nowrap',
  };
  const tableTdStyle = {
    padding: '6px 10px',
    borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap',
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };

  return (
    <div className="fadein">

      {/* Header */}
      <div className="card">
        <div className="card-title">{t('lldp_cdp_parser.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
          {t('lldp_cdp_parser.subtitle')}
        </div>
      </div>

      {/* Input */}
      <div className="card fadein">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, flexWrap: 'wrap', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="card-title" style={{ margin: 0 }}>{t('lldp_cdp_parser.input_label')}</span>
            {lldpResult?.protocol && (
              <span className={`badge ${protocolBadge}`}>{lldpResult.protocol.toUpperCase()}</span>
            )}
            {lldpResult?.format && hasResult && (
              <span className="badge badge-blue">
                {t('lldp_cdp_parser.format_' + lldpResult.format, lldpResult.format)}
              </span>
            )}
          </div>
          <button className="btn btn-ghost btn-sm" onClick={clear}>{t('lldp_cdp_parser.clear_btn')}</button>
        </div>
        <textarea
          className="input"
          style={{
            width: '100%',
            minHeight: 220,
            resize: 'vertical',
            fontFamily: 'var(--mono)',
            fontSize: 13,
            lineHeight: 1.5,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 10,
            color: 'var(--text)',
            boxSizing: 'border-box',
          }}
          value={lldpInput}
          onChange={e => setLldpInput(e.target.value)}
          placeholder={t('lldp_cdp_parser.input_ph')}
          spellCheck={false}
        />
        {!lldpInput.trim() && (
          <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 8 }}>
            {t('lldp_cdp_parser.no_input')}
          </div>
        )}
      </div>

      {/* Error */}
      {lldpError && (
        <Err msg={t('lldp_cdp_parser.err_' + lldpError, t('lldp_cdp_parser.err_default'))} />
      )}

      {/* Summary stats */}
      {hasResult && stats && (
        <div className="card fadein">
          <div className="card-title">{t('common.results')}</div>
          <div className="result-grid">
            <ResultItem label={t('lldp_cdp_parser.stat_total')} value={stats.total} />
            <ResultItem label={t('lldp_cdp_parser.stat_unique')} value={stats.uniqueDevices} />
            <ResultItem label={t('lldp_cdp_parser.stat_caps')} value={stats.capabilities.length} />
          </div>
        </div>
      )}

      {/* Unique devices */}
      {hasResult && stats && stats.deviceNames.length > 0 && (
        <div className="card fadein">
          <div className="card-title">{t('lldp_cdp_parser.devices_title')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 4 }}>
            {stats.deviceNames.map((name, i) => (
              <span key={i} className="badge badge-cyan">{name}</span>
            ))}
          </div>
        </div>
      )}

      {/* Neighbors table */}
      {hasResult && (
        <div className="card fadein">
          <div className="card-title">{t('lldp_cdp_parser.table_title')}</div>
          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--panel)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.6 }}>
              <thead>
                <tr>
                  <th style={tableThStyle}>{t('lldp_cdp_parser.col_neighbor')}</th>
                  <th style={tableThStyle}>{t('lldp_cdp_parser.col_platform')}</th>
                  <th style={tableThStyle}>{t('lldp_cdp_parser.col_local_intf')}</th>
                  <th style={tableThStyle}>{t('lldp_cdp_parser.col_remote_intf')}</th>
                  <th style={tableThStyle}>{t('lldp_cdp_parser.col_mgmt_ip')}</th>
                  <th style={tableThStyle}>{t('lldp_cdp_parser.col_capabilities')}</th>
                  <th style={tableThStyle}>{t('lldp_cdp_parser.col_ttl')}</th>
                </tr>
              </thead>
              <tbody>
                {lldpResult.neighbors.map((n, i) => (
                  <tr key={i}>
                    <td style={tableTdStyle} title={n.device}>
                      <span style={{ fontWeight: 600, color: 'var(--cyan)' }}>{n.device || '-'}</span>
                    </td>
                    <td style={tableTdStyle} title={n.platform}>{n.platform || '-'}</td>
                    <td style={tableTdStyle} title={n.localIntf}>{n.localIntf || '-'}</td>
                    <td style={tableTdStyle} title={n.remoteIntf}>{n.remoteIntf || '-'}</td>
                    <td style={tableTdStyle} title={n.mgmtIP}>
                      {n.mgmtIP ? <span style={{ color: 'var(--green)' }}>{n.mgmtIP}</span> : '-'}
                    </td>
                    <td style={tableTdStyle} title={lldpExpandCaps(n.capabilities, n.protocol)}>
                      <span className="badge badge-yellow" style={{ fontSize: 11 }}>
                        {lldpExpandCaps(n.capabilities, n.protocol) || '-'}
                      </span>
                    </td>
                    <td style={tableTdStyle}>{n.ttl || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Topology map */}
      {topoLines.length > 0 && (
        <div className="card fadein">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('lldp_cdp_parser.topo_title')}</div>
            <CopyBtn text={topoLines.join('\n')} id="topo" />
          </div>
          <div style={{
            fontFamily: 'var(--mono)',
            fontSize: 13,
            lineHeight: 1.7,
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            padding: 12,
            overflowX: 'auto',
            whiteSpace: 'pre',
          }}>
            {topoLines.join('\n')}
          </div>
        </div>
      )}

      {/* Export */}
      {hasResult && (
        <div className="btn-row" style={{ marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleExportJSON}>
            {t('common.export_json')}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportCSV}>
            {t('common.export_csv')}
          </button>
          {topoLines.length > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={handleExportTopo}>
              {t('lldp_cdp_parser.export_topo')}
            </button>
          )}
        </div>
      )}

    </div>
  );
}
window.LLDPCDPParser = LLDPCDPParser;
