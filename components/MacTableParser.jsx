const { useState, useEffect, useCallback, useMemo } = React;

// ── MAC normalisation ─────────────────────────────────────────────────
function mtpNormalizeMac(raw) {
  if (!raw) return '';
  const parts = raw.split(/[:\-\.]/);
  if (parts.length === 6) {
    return parts.map(p => p.padStart(2, '0').toUpperCase()).join(':');
  }
  if (raw.includes('.')) {
    const subparts = raw.split('.');
    if (subparts.length === 3) {
      const clean = subparts.map(p => p.padStart(4, '0')).join('').toUpperCase();
      if (clean.length === 12 && /^[0-9A-F]+$/.test(clean)) {
        return clean.match(/.{2}/g).join(':');
      }
    }
  }
  const clean = raw.replace(/[:\-\.]/g, '').toUpperCase();
  if (clean.length !== 12 || !/^[0-9A-F]+$/.test(clean)) return raw.toUpperCase();
  return clean.match(/.{2}/g).join(':');
}

function mtpOUI(mac) {
  const clean = mac.replace(/:/g, '');
  if (clean.length < 6) return '';
  const db = (typeof OUI_DB !== 'undefined') ? OUI_DB : (window.OUI_DB || {});
  return db[clean.slice(0, 9)] || db[clean.slice(0, 7)] || db[clean.slice(0, 6)] || '';
}

// ── Format detection ──────────────────────────────────────────────────
function detectMacTableFmt(text) {
  const lower = text.toLowerCase();
  
  if (lower.includes('dev') && lower.includes('master') && (lower.includes('permanent') || lower.includes('self') || lower.includes('dynamic'))) {
    return 'linux-fdb';
  }
  if (lower.includes('is local?') && lower.includes('ageing timer')) {
    return 'linux-brctl';
  }
  if (/mac:\s*[\da-fA-F:]{17}\s+vlan:\s*\d+/i.test(text)) {
    return 'fortinet-switch';
  }
  if (lower.includes('port no') && lower.includes('devname') && lower.includes('mac_addr') && lower.includes('ttl')) {
    return 'fortinet-bridge';
  }
  if (lower.includes('ethernet switching table') || (lower.includes('mac flags') && lower.includes('default-switch')) || (lower.includes('age') && lower.includes('interfaces') && lower.includes('vlan'))) {
    return 'juniper';
  }
  if (lower.includes('moves') && lower.includes('last move') && lower.includes('vlan') && lower.includes('ports')) {
    return 'arista';
  }
  if (/\*\s+\d+\s+[\da-f.]+\s+(dynamic|static)/i.test(text)) {
    return 'nxos';
  }
  if (/Unicast Entries\b|Multicast Entries\b|vlan\s+mac address\s+type\s+learn/i.test(text)) {
    return 'ios-xe';
  }
  if (lower.includes('linklayeraddress') && lower.includes('interfacealias') && lower.includes('ipaddress')) {
    return 'windows-netneighbor';
  }
  if (lower.includes('interfacedescription') && lower.includes('macaddress') && lower.includes('ifindex')) {
    return 'windows-netadapter';
  }
  if (lower.includes('macaddress') && lower.includes('switchname') && lower.includes('vmname')) {
    return 'windows-vmnetadapter';
  }
  if (lower.includes('transport name') && lower.includes('physical address')) {
    return 'windows-getmac';
  }
  if (lower.includes('interface:') && lower.includes('physical address') && lower.includes('internet address')) {
    return 'windows-arp';
  }
  if (lower.includes('[ether]') && lower.includes(' on ') && lower.includes(' at ')) {
    return 'linux-arp';
  }
  if (lower.includes(' dev ') && lower.includes(' lladdr ') && (lower.includes('reachable') || lower.includes('stale') || lower.includes('delay') || lower.includes('failed') || lower.includes('permanent'))) {
    return 'linux-neigh';
  }
  if (lower.includes('hwtype') && lower.includes('hwaddress') && (lower.includes('iface') || lower.includes('device'))) {
    return 'linux-arp-table';
  }
  if (lower.includes('port') && lower.includes('vlan') && lower.includes('mac') && lower.includes('age')) {
    const lines = text.split('\n').map(l => l.trim().toLowerCase());
    if (lines.some(l => l.startsWith('port') && l.includes('vlan') && l.includes('mac') && l.includes('age'))) {
      return 'linux-ovs';
    }
  }
  return 'ios';
}

// ── Parsers ───────────────────────────────────────────────────────────
function parseMacTableIOS(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+|All)\s+([\da-fA-F.]+)\s+(DYNAMIC|STATIC|SECURE|PERMANENT|SYSTEM|SELF)\s+(\S+)/i);
    if (!m) continue;
    entries.push({ vlan: m[1], mac: mtpNormalizeMac(m[2]), type: m[3].toUpperCase(), port: m[4] });
  }
  return entries;
}

function parseMacTableNXOS(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\*?\s*(\d+)\s+([\da-fA-F.]+)\s+(dynamic|static|secure)\s+(\S+)\s+(\S+)\s+(\S+)\s+(\S+)/i) ||
              line.match(/^\*?\s*(\d+)\s+([\da-fA-F.]+)\s+(dynamic|static|secure)\s+(\S+)\s+(\S+)\s+(\S+)/i) ||
              line.match(/^\*?\s*(\d+)\s+([\da-fA-F.]+)\s+(dynamic|static|secure)\s+(\S+)/i);
    if (!m) continue;
    
    const port = m[m.length - 1];
    entries.push({ vlan: m[1], mac: mtpNormalizeMac(m[2]), type: m[3].toUpperCase(), port });
  }
  return entries;
}

function parseMacTableArista(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+([\da-fA-F.]+)\s+(DYNAMIC|STATIC)\s+(\S+)/i);
    if (!m) continue;
    entries.push({ vlan: m[1], mac: mtpNormalizeMac(m[2]), type: m[3].toUpperCase(), port: m[4] });
  }
  return entries;
}

function parseMacTableJuniper(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\S+)\s+([\da-fA-F.:-]+)\s+(dynamic|static|local|D|S|DL)\s+\S+\s+(\S+)/i);
    if (!m) continue;
    
    let type = m[3].toUpperCase();
    if (type === 'D') type = 'DYNAMIC';
    else if (type === 'S') type = 'STATIC';
    else if (type === 'DL') type = 'LOCAL';

    entries.push({ vlan: m[1], mac: mtpNormalizeMac(m[2]), type, port: m[4] });
  }
  return entries;
}

function parseMacTableFortinetSwitch(text) {
  const entries = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/MAC:\s*([\da-fA-F:]+)\s+VLAN:\s*(\d+)\s+(Port|Trunk):\s*(.+)$/i);
    if (!m) continue;
    
    let type = 'DYNAMIC';
    if (i + 1 < lines.length) {
      const nextLine = lines[i + 1];
      if (/flags:/i.test(nextLine)) {
        if (/static/i.test(nextLine)) {
          type = 'STATIC';
        } else if (/dynamic/i.test(nextLine)) {
          type = 'DYNAMIC';
        }
      }
    }
    entries.push({ vlan: m[2], mac: mtpNormalizeMac(m[1]), type, port: m[4].trim() });
  }
  return entries;
}

function parseMacTableFortinetBridge(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+([\da-fA-F:]+)\s+(\d+)\s+(.+)$/i);
    if (!m) continue;
    
    let type = 'DYNAMIC';
    const attrs = m[6].toLowerCase();
    if (attrs.includes('static')) {
      type = 'STATIC';
    } else if (attrs.includes('local')) {
      type = 'LOCAL';
    }
    
    entries.push({ vlan: '-', mac: mtpNormalizeMac(m[4]), type, port: m[3] });
  }
  return entries;
}

function parseMacTableLinuxBrctl(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+([\da-fA-F:]+)\s+(yes|no)\s+(\d+\.\d+)/i);
    if (!m) continue;
    
    const type = m[3].toLowerCase() === 'yes' ? 'LOCAL' : 'DYNAMIC';
    entries.push({ vlan: '-', mac: mtpNormalizeMac(m[2]), type, port: `Port ${m[1]}` });
  }
  return entries;
}

function parseMacTableLinuxFdb(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    const parts = trimmed.split(/\s+/);
    if (parts.length < 3) continue;
    
    const mac = mtpNormalizeMac(parts[0]);
    if (!mac || mac.length !== 17) continue;
    
    let dev = '-';
    let vlan = '-';
    let type = 'DYNAMIC';
    
    for (let i = 1; i < parts.length; i++) {
      if (parts[i] === 'dev' && i + 1 < parts.length) {
        dev = parts[i + 1];
        i++;
      } else if (parts[i] === 'vlan' && i + 1 < parts.length) {
        vlan = parts[i + 1];
        i++;
      } else if (parts[i] === 'permanent') {
        type = 'PERMANENT';
      } else if (parts[i] === 'static') {
        type = 'STATIC';
      } else if (parts[i] === 'self') {
        type = 'LOCAL';
      }
    }
    
    entries.push({ vlan, mac, type, port: dev });
  }
  return entries;
}

function parseMacTableWindowsGetmac(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^([^\t=]{2,})\s+(\\Device\\Tcpip_\S+)\s+([\da-fA-F-]{17})/i) ||
              line.match(/^([\da-fA-F-]{17})\s+(\\Device\\Tcpip_\S+)/i);
    if (!m) continue;
    
    if (m.length === 4) {
      entries.push({ vlan: '-', mac: mtpNormalizeMac(m[3]), type: 'LOCAL', port: m[1].trim() });
    } else {
      entries.push({ vlan: '-', mac: mtpNormalizeMac(m[1]), type: 'LOCAL', port: m[2].trim() });
    }
  }
  return entries;
}

function parseMacTableWindowsNetNeighbor(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\S+)\s+(.+?)\s+(\d+)\s+(\S+)\s+([\da-fA-F-]{17})\s*$/i);
    if (!m) continue;
    
    let type = 'DYNAMIC';
    const state = m[4].toLowerCase();
    if (state.includes('permanent') || state.includes('static')) {
      type = 'STATIC';
    }
    
    const port = `${m[2].trim()} (${m[1]})`;
    entries.push({ vlan: '-', mac: mtpNormalizeMac(m[5]), type, port });
  }
  return entries;
}

function parseMacTableWindowsNetAdapter(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(.+?)\s{2,}.+?\s+(\d+)\s+(\S+)\s+([\da-fA-F-]{17})\s*$/i);
    if (!m) continue;
    
    entries.push({ vlan: '-', mac: mtpNormalizeMac(m[4]), type: 'LOCAL', port: m[1].trim() });
  }
  return entries;
}

function parseMacTableWindowsVMNetAdapter(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\S+)\s+(.+?)\s+([\da-fA-F]{12})\s+(\S+)\s*$/i);
    if (!m) continue;
    
    const port = `${m[4]} (${m[1].trim()})`;
    entries.push({ vlan: '-', mac: mtpNormalizeMac(m[3]), type: 'VM', port });
  }
  return entries;
}

function parseMacTableWindowsArp(text) {
  const entries = [];
  let iface = '';
  for (const line of text.split('\n')) {
    const ifaceM = line.match(/Interface:\s+([\d.]+)/i);
    if (ifaceM) { iface = ifaceM[1]; continue; }
    const m = line.match(/([\d.]+)\s+([\da-fA-F-]+)\s+(\S+)/);
    if (!m) continue;
    if (/type/i.test(line)) continue;
    
    let type = 'DYNAMIC';
    if (m[3].toLowerCase() === 'static') type = 'STATIC';
    
    const port = iface ? `${iface} (${m[1]})` : m[1];
    entries.push({ vlan: '-', mac: mtpNormalizeMac(m[2]), type, port });
  }
  return entries;
}

function parseMacTableLinuxArp(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\S+)\s+\(([\d.a-fA-F:]+)\)\s+at\s+([\da-fA-F:.-]{12,17})\s+\[ether\]\s+on\s+(\S+)/i);
    if (!m) continue;
    const hostStr = m[1] !== '?' ? `${m[1]} - ${m[2]}` : m[2];
    entries.push({ vlan: '-', mac: mtpNormalizeMac(m[3]), type: 'DYNAMIC', port: `${m[4]} (${hostStr})` });
  }
  return entries;
}

function parseMacTableLinuxNeigh(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([\da-fA-F.:]+)\s+dev\s+(\S+)\s+lladdr\s+([\da-fA-F:.-]{12,17})/i);
    if (!m) continue;
    let type = 'DYNAMIC';
    if (line.toLowerCase().includes('permanent') || line.toLowerCase().includes('perm')) {
      type = 'STATIC';
    }
    entries.push({ vlan: '-', mac: mtpNormalizeMac(m[3]), type, port: `${m[2]} (${m[1]})` });
  }
  return entries;
}

function parseMacTableLinuxArpTable(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /address/i.test(trimmed)) continue;
    
    const parts = trimmed.split(/\s+/);
    if (parts.length < 5) continue;
    
    const ip = parts[0];
    const mac = mtpNormalizeMac(parts[2]);
    if (!mac || mac.length !== 17) continue;
    
    const iface = parts[parts.length - 1];
    entries.push({ vlan: '-', mac, type: 'DYNAMIC', port: `${iface} (${ip})` });
  }
  return entries;
}

function parseMacTableLinuxOvs(text) {
  const entries = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || /port\s+vlan\s+mac\s+age/i.test(trimmed)) continue;
    
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    
    const port = `Port ${parts[0]}`;
    const vlan = parts[1];
    const mac = mtpNormalizeMac(parts[2]);
    if (!mac || mac.length !== 17) continue;
    
    entries.push({ vlan, mac, type: 'DYNAMIC', port });
  }
  return entries;
}

function parseMacTable(text) {
  const fmt = detectMacTableFmt(text);
  let entries = [];
  if (fmt === 'nxos') entries = parseMacTableNXOS(text);
  else if (fmt === 'ios-xe') entries = parseMacTableIOS(text);
  else if (fmt === 'arista') entries = parseMacTableArista(text);
  else if (fmt === 'juniper') entries = parseMacTableJuniper(text);
  else if (fmt === 'fortinet-switch') entries = parseMacTableFortinetSwitch(text);
  else if (fmt === 'fortinet-bridge') entries = parseMacTableFortinetBridge(text);
  else if (fmt === 'linux-brctl') entries = parseMacTableLinuxBrctl(text);
  else if (fmt === 'linux-fdb') entries = parseMacTableLinuxFdb(text);
  else if (fmt === 'linux-arp') entries = parseMacTableLinuxArp(text);
  else if (fmt === 'linux-neigh') entries = parseMacTableLinuxNeigh(text);
  else if (fmt === 'windows-getmac') entries = parseMacTableWindowsGetmac(text);
  else if (fmt === 'windows-netneighbor') entries = parseMacTableWindowsNetNeighbor(text);
  else if (fmt === 'windows-netadapter') entries = parseMacTableWindowsNetAdapter(text);
  else if (fmt === 'windows-vmnetadapter') entries = parseMacTableWindowsVMNetAdapter(text);
  else if (fmt === 'windows-arp') entries = parseMacTableWindowsArp(text);
  else if (fmt === 'linux-arp-table') entries = parseMacTableLinuxArpTable(text);
  else if (fmt === 'linux-ovs') entries = parseMacTableLinuxOvs(text);
  else entries = parseMacTableIOS(text);
  return { entries, fmt };
}

// ── Analysis ──────────────────────────────────────────────────────────
function analyzeMacTable(entries) {
  const macToPorts = {};
  const vlanCounts = {};
  const portSecViolations = [];

  for (const e of entries) {
    const key = `${e.vlan}:${e.mac}`;
    if (!macToPorts[key]) macToPorts[key] = new Set();
    macToPorts[key].add(e.port);
    if (!vlanCounts[e.vlan]) vlanCounts[e.vlan] = 0;
    vlanCounts[e.vlan]++;
    if (e.type === 'SECURE') portSecViolations.push(e);
  }

  const flapping = [];
  for (const [key, ports] of Object.entries(macToPorts)) {
    if (ports.size > 1) {
      const [vlan, mac] = key.split(':');
      flapping.push({ vlan, mac, ports: [...ports] });
    }
  }

  return { flapping, vlanCounts, portSecViolations };
}

// ── Snapshot diff ─────────────────────────────────────────────────────
function diffSnapshots(entriesA, entriesB) {
  const keyOf = e => `${e.vlan}:${e.mac}:${e.port}`;
  const setA = new Set(entriesA.map(keyOf));
  const setB = new Set(entriesB.map(keyOf));
  const added = entriesB.filter(e => !setA.has(keyOf(e)));
  const removed = entriesA.filter(e => !setB.has(keyOf(e)));
  return { added, removed };
}

// ── Component ─────────────────────────────────────────────────────────
function MacTableParser({ initialData, onShare }) {
  const { t } = useTranslation();
  const [raw, setRaw] = usePersistentState('mac-table:raw', initialData?.raw ?? '');
  const [rawB, setRawB] = usePersistentState('mac-table:rawB', initialData?.rawB ?? '');
  const [tab, setTab] = usePersistentState('mac-table:tab', 'parse');
  const [filterText, setFilterText] = useState('');
  const [filterVlan, setFilterVlan] = useState('');

  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'mac-table-parser', raw, rawB });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [raw, rawB, onShare]);

  const { entries, fmt } = useMemo(() => {
    if (!raw.trim()) return { entries: [], fmt: '' };
    return parseMacTable(raw);
  }, [raw]);

  const { flapping, vlanCounts, portSecViolations } = useMemo(() => analyzeMacTable(entries), [entries]);

  const vlans = useMemo(() => [...new Set(entries.map(e => e.vlan))].sort((a, b) => +a - +b), [entries]);

  const filtered = useMemo(() => {
    let r = entries;
    if (filterVlan) r = r.filter(e => e.vlan === filterVlan);
    const q = filterText.toLowerCase();
    if (q) r = r.filter(e =>
      e.mac.toLowerCase().includes(q) || e.port.toLowerCase().includes(q) ||
      e.vlan.includes(q) || mtpOUI(e.mac).toLowerCase().includes(q)
    );
    return r;
  }, [entries, filterText, filterVlan]);

  const flappingMacs = useMemo(() => new Set(flapping.map(f => f.mac)), [flapping]);

  const { entriesB } = useMemo(() => {
    if (!rawB.trim()) return { entriesB: [] };
    const { entries: eb } = parseMacTable(rawB);
    return { entriesB: eb };
  }, [rawB]);

  const diff = useMemo(() => {
    if (!entriesB.length) return null;
    return diffSnapshots(entries, entriesB);
  }, [entries, entriesB]);

  const handleExportCSV = useCallback(() => {
    const rows = [['VLAN', 'MAC', 'Type', 'Port', 'Vendor', 'Flags']];
    for (const e of entries) {
      const flags = [];
      if (flappingMacs.has(e.mac)) flags.push('FLAPPING');
      if (e.type === 'SECURE') flags.push('PORT-SEC');
      rows.push([e.vlan, e.mac, e.type, e.port, mtpOUI(e.mac), flags.join('+')]);
    }
    exportCSV(rows, 'mac-address-table.csv');
  }, [entries, flappingMacs]);

  const SAMPLE = `          Mac Address Table
-------------------------------------------
Vlan    Mac Address       Type        Ports
----    -----------       --------    -----
   1    0011.2233.4455    DYNAMIC     Gi0/1
   1    aabb.ccdd.eeff    DYNAMIC     Gi0/2
  10    0011.2233.4455    DYNAMIC     Gi0/3
  10    dead.beef.0001    DYNAMIC     Gi0/4
  20    fa16.3e12.3456    DYNAMIC     Gi0/1`;

  const FMT_KEYS = {
    'ios': 'fmt_cisco_ios',
    'ios-xe': 'fmt_cisco_ios_xe',
    'nxos': 'fmt_cisco_nxos',
    'arista': 'fmt_arista',
    'juniper': 'fmt_juniper',
    'fortinet-switch': 'fmt_fortinet_switch',
    'fortinet-bridge': 'fmt_fortinet_bridge',
    'linux-brctl': 'fmt_linux_brctl',
    'linux-fdb': 'fmt_linux_fdb',
    'linux-arp': 'fmt_linux_arp',
    'linux-neigh': 'fmt_linux_neigh',
    'linux-arp-table': 'fmt_linux_arp_table',
    'linux-ovs': 'fmt_linux_ovs',
    'windows-getmac': 'fmt_windows_getmac',
    'windows-netneighbor': 'fmt_windows_netneighbor',
    'windows-netadapter': 'fmt_windows_netadapter',
    'windows-vmnetadapter': 'fmt_windows_vmnetadapter',
    'windows-arp': 'fmt_windows_arp'
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('mac_table.title')}</div>
        <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>{t('mac_table.subtitle')}</p>

        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {['parse', 'diff', 'vlan'].map(id => (
            <button key={id} className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(id)}>
              {t('mac_table.tab_' + id)}
            </button>
          ))}
        </div>

        {tab !== 'diff' && (
          <div className="field">
            <label className="label">{t('mac_table.input_label')} {fmt ? <span className="badge badge-cyan" style={{ marginLeft: 8 }}>{t('mac_table.' + FMT_KEYS[fmt]) || fmt}</span> : null}</label>
            <textarea className="input" style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12 }}
              placeholder={t('mac_table.placeholder')} value={raw} onChange={e => setRaw(e.target.value)} />
          </div>
        )}

        {tab === 'diff' && (
          <div className="two-col">
            <div className="field">
              <label className="label">{t('mac_table.snapshot_a')}</label>
              <textarea className="input" style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12 }}
                placeholder={t('mac_table.placeholder')} value={raw} onChange={e => setRaw(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('mac_table.snapshot_b')}</label>
              <textarea className="input" style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12 }}
                placeholder={t('mac_table.placeholder')} value={rawB} onChange={e => setRawB(e.target.value)} />
            </div>
          </div>
        )}

        <div className="btn-row">
          <button className="btn btn-ghost btn-sm" onClick={() => setRaw(SAMPLE)}>{t('arp_parser.load_sample')}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setRaw(''); setRawB(''); setFilterText(''); setFilterVlan(''); }}>{t('common.clear')}</button>
          {entries.length > 0 && <button className="btn btn-ghost btn-sm" onClick={handleExportCSV}>{t('common.export')} CSV</button>}
        </div>
      </div>

      {entries.length > 0 && tab !== 'diff' && (
        <div className="card">
          <div className="card-title">{t('mac_table.summary_title')}</div>
          <div className="result-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
            <ResultItem label={t('mac_table.stat_total')} value={entries.length} />
            <ResultItem label={t('mac_table.stat_vlans')} value={vlans.length} />
            <ResultItem label={t('mac_table.stat_unique_macs')} value={new Set(entries.map(e => e.mac)).size} />
            {flapping.length > 0 && <ResultItem label={t('mac_table.stat_flapping')} value={<span style={{ color: 'var(--red)' }}>{flapping.length}</span>} />}
            {portSecViolations.length > 0 && <ResultItem label={t('mac_table.stat_portsec')} value={<span style={{ color: 'var(--yellow)' }}>{portSecViolations.length}</span>} />}
          </div>

          {flapping.length > 0 && (
            <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', borderRadius: 8, fontSize: 13 }}>
              <strong style={{ color: 'var(--red)' }}>⚠ {t('mac_table.warn_flapping')}</strong>
              <ul style={{ margin: '6px 0 0 0', paddingLeft: 18 }}>
                {flapping.map((f, i) => (
                  <li key={i}><code>{f.mac}</code> {t('mac_table.flap_vlan')} {f.vlan} → {f.ports.join(', ')}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {tab === 'parse' && entries.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
            <div className="card-title" style={{ margin: 0 }}>{t('mac_table.table_title')}</div>
            <select className="input" style={{ maxWidth: 120 }} value={filterVlan} onChange={e => setFilterVlan(e.target.value)}>
              <option value="">{t('mac_table.all_vlans')}</option>
              {vlans.map(v => <option key={v} value={v}>VLAN {v}</option>)}
            </select>
            <input className="input" style={{ flex: 1, maxWidth: 220 }} placeholder={t('common.filter') + '…'} value={filterText} onChange={e => setFilterText(e.target.value)} />
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  {['VLAN', 'MAC', t('mac_table.col_type'), t('mac_table.col_port'), t('mac_table.col_vendor'), t('mac_table.col_flags')].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 600 }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((e, i) => {
                  const isFlap = flappingMacs.has(e.mac);
                  const isSec = e.type === 'SECURE';
                  return (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isFlap ? 'rgba(239,68,68,0.06)' : 'transparent' }}>
                      <td style={{ padding: '6px 10px' }}>{e.vlan}</td>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{e.mac}</td>
                      <td style={{ padding: '6px 10px' }}><span className={`badge ${e.type === 'DYNAMIC' ? 'badge-blue' : 'badge-green'}`}>{e.type}</span></td>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{e.port}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12 }}>{mtpOUI(e.mac) || '—'}</td>
                      <td style={{ padding: '6px 10px' }}>
                        {isFlap && <span className="badge badge-red" style={{ marginRight: 4 }}>{t('mac_table.flag_flapping')}</span>}
                        {isSec && <span className="badge badge-yellow">{t('mac_table.flag_portsec')}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {filtered.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>{t('mac_table.no_results')}</div>}
          </div>
        </div>
      )}

      {tab === 'vlan' && entries.length > 0 && (
        <div className="card">
          <div className="card-title">{t('mac_table.vlan_dist_title')}</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)' }}>VLAN</th>
                <th style={{ textAlign: 'right', padding: '6px 10px', color: 'var(--muted)' }}>{t('mac_table.stat_total')}</th>
                <th style={{ padding: '6px 10px' }}></th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(vlanCounts).sort((a, b) => b[1] - a[1]).map(([vlan, count]) => (
                <tr key={vlan} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>VLAN {vlan}</td>
                  <td style={{ padding: '6px 10px', textAlign: 'right' }}>{count}</td>
                  <td style={{ padding: '6px 10px' }}>
                    <div style={{ background: 'var(--cyan)', height: 8, borderRadius: 4, width: `${Math.round((count / entries.length) * 200)}px`, maxWidth: 200 }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'diff' && diff && (
        <div className="card">
          <div className="card-title">{t('mac_table.diff_title')}</div>
          <div className="two-col">
            <div>
              <div style={{ marginBottom: 8, color: 'var(--green)', fontWeight: 600 }}>{t('mac_table.diff_added')} ({diff.added.length})</div>
              {diff.added.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('mac_table.diff_none')}</div> : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead><tr>{['VLAN', 'MAC', t('mac_table.col_port')].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)' }}>{h}</th>)}</tr></thead>
                  <tbody>{diff.added.map((e, i) => <tr key={i} style={{ background: 'rgba(34,197,94,0.08)' }}><td style={{ padding: '4px 8px' }}>{e.vlan}</td><td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{e.mac}</td><td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{e.port}</td></tr>)}</tbody>
                </table>
              )}
            </div>
            <div>
              <div style={{ marginBottom: 8, color: 'var(--red)', fontWeight: 600 }}>{t('mac_table.diff_removed')} ({diff.removed.length})</div>
              {diff.removed.length === 0 ? <div style={{ color: 'var(--muted)', fontSize: 13 }}>{t('mac_table.diff_none')}</div> : (
                <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
                  <thead><tr>{['VLAN', 'MAC', t('mac_table.col_port')].map(h => <th key={h} style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--muted)' }}>{h}</th>)}</tr></thead>
                  <tbody>{diff.removed.map((e, i) => <tr key={i} style={{ background: 'rgba(239,68,68,0.08)' }}><td style={{ padding: '4px 8px' }}>{e.vlan}</td><td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{e.mac}</td><td style={{ padding: '4px 8px', fontFamily: 'monospace' }}>{e.port}</td></tr>)}</tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.MacTableParser = MacTableParser;
