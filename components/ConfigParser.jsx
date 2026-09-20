const { useState, useEffect, useMemo, useRef, useCallback } = React;

const VENDORS = [
  { id: 'auto',         label: 'Auto',            mod: () => null },
  { id: 'junos',        label: 'JUNOS',           mod: () => window.ConfigParser_Junos },
  { id: 'cisco-iosxe',  label: 'Cisco IOS-XE',    mod: () => window.ConfigParser_Cisco,  force: 'cisco-ios-xe' },
  { id: 'cisco-nxos',   label: 'Cisco NX-OS',     mod: () => window.ConfigParser_Cisco,  force: 'cisco-nx-os' },
  { id: 'cisco-iosxr',  label: 'Cisco IOS-XR',    mod: () => window.ConfigParser_Cisco,  force: 'cisco-ios-xr' },
  { id: 'cisco-asa',    label: 'Cisco ASA',       mod: () => window.ConfigParser_CiscoASA },
  { id: 'arista',       label: 'Arista EOS',      mod: () => window.ConfigParser_Arista },
  { id: 'aruba',        label: 'Aruba AOS-CX',    mod: () => window.ConfigParser_Aruba },
  { id: 'huawei',       label: 'Huawei VRP',      mod: () => window.ConfigParser_Huawei },
  { id: 'comware',      label: 'HPE Comware',     mod: () => window.ConfigParser_Comware },
  { id: 'dell',         label: 'Dell OS10',       mod: () => window.ConfigParser_Dell },
  { id: 'paloalto',     label: 'Palo Alto PAN-OS', mod: () => window.ConfigParser_PaloAlto },
  { id: 'fortios',      label: 'FortiOS',         mod: () => window.ConfigParser_FortiOS },
  { id: 'checkpoint',   label: 'Check Point Gaia', mod: () => window.ConfigParser_CheckPoint },
  { id: 'vyos',         label: 'VyOS',            mod: () => window.ConfigParser_VyOS },
  { id: 'extreme',      label: 'Extreme EXOS',    mod: () => window.ConfigParser_Extreme },
  { id: 'mikrotik',     label: 'Mikrotik RouterOS', mod: () => window.ConfigParser_Mikrotik },
  { id: 'f5',           label: 'F5 BIG-IP',       mod: () => window.ConfigParser_F5 },
];

function autoDetect(text) {
  const candidates = VENDORS.filter(v => v.id !== 'auto' && !v.force).map(v => {
    const m = v.mod();
    if (!m) return null;
    return { id: v.id, label: v.label, score: m.detect(text) || 0, mod: m, force: null };
  }).filter(Boolean);
  candidates.sort((a, b) => b.score - a.score);
  const winner = candidates[0];
  if (winner && winner.mod === window.ConfigParser_Cisco) {
    try {
      const out = winner.mod.parse(text);
      const vendorId = out.vendor === 'cisco-nx-os' ? 'cisco-nxos' : (out.vendor === 'cisco-ios-xr' ? 'cisco-iosxr' : 'cisco-iosxe');
      const labelled = VENDORS.find(v => v.id === vendorId);
      if (labelled) return { id: vendorId, label: labelled.label, score: winner.score, mod: winner.mod, force: labelled.force };
    } catch (_) {}
  }
  return winner || null;
}

function Pill({ children, color = 'cyan' }) {
  return <span className={`badge badge-${color}`} style={{ marginRight: 4 }}>{children}</span>;
}

let _devSeq = 0;
const newDevice = (defaultName) => ({
  uid: `dev-${++_devSeq}-${Date.now()}`,
  customName: '',
  defaultName,
  hostname: '',
  raw: '',
  neighborRaw: '',
  vendor: 'auto',
  filterText: '',
  resultsTab: 'interfaces',
});

// Survives tool-switching (component unmount/remount) but not page refresh.
const _sessionStore = { devices: null, activeIdx: 0 };

// Parse a device config without surfacing errors — used for cross-tab
// reconciliation where a tab may be empty or unparseable.
function parseConfigSafe(raw, vendor) {
  if (!raw || !raw.trim()) return null;
  try {
    let mod, force = null;
    if (vendor === 'auto') {
      const detected = autoDetect(raw);
      if (!detected || detected.score < 10) return null;
      mod = detected.mod;
      force = detected.force;
    } else {
      const v = VENDORS.find(x => x.id === vendor);
      mod = v && v.mod();
      force = v && v.force;
      if (!mod) return null;
    }
    return mod.parse(raw, force ? { forceVendor: force } : undefined);
  } catch (_) {
    return null;
  }
}

// Parse optional CDP/LLDP paste using the shared LLDPCDPParser functions.
function parseNeighborsSafe(text) {
  if (!text || !text.trim() || typeof lldpParseInput !== 'function') return [];
  try {
    const res = lldpParseInput(text);
    return (res && res.neighbors) || [];
  } catch (_) {
    return [];
  }
}

function _htmlEsc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function _htmlTheme(isDark) {
  return isDark ? {
    bg:'#0d0d12', panel:'#16161e', border:'#2a2a3a', text:'#e2e8f0', muted:'#8892a0', thHead:'#12121a',
    cyan:'#00d4c8', blue:'#4a9eff', green:'#22c55e', red:'#ef4444', yellow:'#f59e0b', purple:'#c084fc',
    preBg:'#050508', preText:'#e2e8f0', codeBg:'#2a2a3a', codeText:'#e2e8f0', rowHover:'rgba(255,255,255,.03)',
  } : {
    bg:'#f8fafc', panel:'#ffffff', border:'#e2e8f0', text:'#334155', muted:'#64748b', thHead:'#f1f5f9',
    cyan:'#0284c7', blue:'#2563eb', green:'#16a34a', red:'#dc2626', yellow:'#d97706', purple:'#7c3aed',
    preBg:'#0f172a', preText:'#e2e8f0', codeBg:'#f1f5f9', codeText:'#334155', rowHover:'#f8fafc',
  };
}

function _htmlCSS(T) {
  return `
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:${T.bg};color:${T.text};margin:0;padding:24px 32px;font-size:14px}
    h1{font-size:20px;font-weight:700;margin:0 0 4px;color:${T.text}}
    h2{font-size:15px;font-weight:700;margin:24px 0 10px;padding-bottom:6px;border-bottom:2px solid ${T.border};color:${T.text}}
    h3{font-size:14px;font-weight:700;margin:18px 0 8px;color:${T.text}}
    .meta{color:${T.muted};font-size:13px;margin-bottom:24px}
    .stats{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}
    .stat{background:${T.panel};border:1px solid ${T.border};border-radius:8px;padding:10px 16px;min-width:110px}
    .stat-label{font-size:11px;color:${T.muted};text-transform:uppercase;letter-spacing:.05em;margin-bottom:2px}
    .stat-value{font-size:20px;font-weight:700;color:${T.text}}
    table{width:100%;border-collapse:collapse;font-size:13px;background:${T.panel};border-radius:8px;overflow:hidden;border:1px solid ${T.border};margin-bottom:8px}
    th{text-align:left;padding:8px 12px;background:${T.thHead};font-weight:600;color:${T.muted};font-size:12px;white-space:nowrap;border-bottom:1px solid ${T.border}}
    td{padding:7px 12px;border-bottom:1px solid ${T.border};vertical-align:top;color:${T.text}}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:${T.rowHover}}
    code{font-family:'JetBrains Mono','SF Mono','Fira Code',monospace;font-size:12px;background:${T.codeBg};padding:1px 5px;border-radius:4px;color:${T.codeText}}
    pre{background:${T.preBg};color:${T.preText};padding:20px;border-radius:8px;font-size:12px;line-height:1.6;overflow-x:auto;white-space:pre-wrap;word-break:break-all;max-height:600px;overflow-y:auto}
    .card{background:${T.panel};border:1px solid ${T.border};border-radius:8px;padding:12px 16px;margin-bottom:8px}
    .card-title{font-size:13px;font-weight:700;margin-bottom:8px;color:${T.text}}
    .row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:4px}
    .label{color:${T.muted};font-size:12px}
    .muted{color:${T.muted}}
    .device-section{border-top:3px solid ${T.border};padding-top:20px;margin-top:36px}
    .device-header{font-size:18px;font-weight:700;margin-bottom:4px;color:${T.cyan}}
    @media print{body{padding:12px}pre{max-height:none;overflow:visible}}
  `;
}

function _htmlBuildDeviceSections(analysis, raw, T) {
  const e = _htmlEsc;
  const badge = (color, text) => {
    const map = {cyan:T.cyan,green:T.green,blue:T.blue,purple:T.purple,yellow:T.yellow,red:T.red};
    return `<span style="display:inline-block;padding:1px 7px;border-radius:12px;font-size:11px;font-weight:600;background:${map[color]||T.cyan};color:#fff;margin:1px 2px">${e(text)}</span>`;
  };
  const hasFW = !!(analysis.firewallRules && analysis.firewallRules.length);
  const sys = analysis.system;
  const isNxos = analysis.vendor === 'cisco-nx-os';
  const hasSystem = !!(sys && (sys.ntp.length || sys.dns.length || sys.aaa.tacacs.length || sys.aaa.radius.length || sys.syslog.length || sys.snmp.communities.length || sys.snmp.hosts.length || sys.snmp.users.length || sys.users.length || sys.banner || sys.domain || (isNxos && (sys.features.length || sys.fex.length || sys.vpc || (sys.nbm && sys.nbm.enabled)))));

  let statsHtml = '<div class="stats">';
  const addStat = (label, val) => { statsHtml += `<div class="stat"><div class="stat-label">${e(label)}</div><div class="stat-value">${e(val)}</div></div>`; };
  if (analysis.counts.hostname) addStat('Hostname', analysis.counts.hostname);
  addStat('Vendor', analysis.vendor);
  addStat('Physical Ifaces', analysis.counts.physicals);
  addStat('Aggregates', analysis.counts.aggregates);
  addStat('Logical Units', analysis.counts.logicalUnits);
  addStat('VLANs', analysis.counts.vlans);
  addStat('VRFs', analysis.counts.vrfs);
  if (hasFW) addStat('Firewall Rules', analysis.counts.firewallRules);
  if (analysis.counts.ntp) addStat('NTP Servers', analysis.counts.ntp);
  if (analysis.counts.tacacs) addStat('TACACS+', analysis.counts.tacacs);
  if (analysis.counts.radius) addStat('RADIUS', analysis.counts.radius);
  if (analysis.counts.syslog) addStat('Syslog', analysis.counts.syslog);
  statsHtml += '</div>';

  let ifaceHtml = `<table><thead><tr>${['Interface','VRF','Mode','VLAN','IPv4','IPv6','Description'].map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>`;
  for (const u of analysis.logicalUnits) {
    const typeLabels = (u.isAgg ? badge('purple','LAG') : '') + (u.isIrb ? badge('blue','SVI') : '');
    const vlanCell = (u.vlanId ? badge('cyan',u.vlanId) : '') + (u.vlanMembers||[]).map(v=>badge('green',v)).join('') || '—';
    ifaceHtml += `<tr><td><code>${e(u.ifkey)}</code>${typeLabels}</td><td class="muted">${e(u.vrf||'—')}</td><td class="muted">${e(u.mode||(u.vlanId?'subif':'—'))}</td><td>${vlanCell}</td><td><code>${e(u.ipv4.length?u.ipv4.join(', '):'—')}</code></td><td><code>${e(u.ipv6.length?u.ipv6.join(', '):'—')}</code></td><td class="muted">${e(u.description||'—')}</td></tr>`;
  }
  ifaceHtml += '</tbody></table>';

  let lagsHtml = '';
  if (analysis.aggregates.length) {
    for (const a of analysis.aggregates) {
      lagsHtml += `<div class="card"><div class="row"><code style="font-weight:700">${e(a.name)}</code>${badge('purple','LACP '+(a.lacpMode||''))}${a.periodic?badge('cyan',a.periodic):''}${a.minLinks!==undefined&&a.minLinks!==''?badge('yellow',`min-links ${a.minLinks}`):''}${a.description?`<span class="muted" style="margin-left:auto;font-size:12px">${e(a.description)}</span>`:''}</div><div style="padding-left:14px;font-size:13px"><span class="label">Members: </span>${a.members.length?a.members.map(m=>`<code style="margin-right:8px">${e(m)}</code>`).join(''):'<em class="muted">none</em>'}</div></div>`;
    }
  } else {
    lagsHtml = '<p class="muted">No aggregate interfaces detected.</p>';
  }

  let vlansHtml = '';
  if (analysis.vlans.length) {
    vlansHtml = `<table><thead><tr>${['Name','VLAN ID','L3 Interface','Member Ports','Description'].map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>`;
    for (const v of analysis.vlans) {
      vlansHtml += `<tr><td><code>${e(v.name)}</code></td><td><code>${e(v.id||'—')}</code></td><td><code>${e(v.l3Interface||'—')}</code></td><td>${v.members.length?v.members.map(m=>badge(m.mode==='trunk'?'blue':'green',m.ifkey)).join(''):'—'}</td><td class="muted">${e(v.description||'—')}</td></tr>`;
    }
    vlansHtml += '</tbody></table>';
  } else {
    vlansHtml = '<p class="muted">No VLANs defined.</p>';
  }

  let vrfsHtml = '';
  for (const vrf of analysis.vrfs) {
    const typeColor = vrf.type==='vrf'?'green':(vrf.type==='default'?'cyan':'yellow');
    let protoHtml = '';
    for (const p of vrf.protocols||[]) {
      protoHtml += badge('purple',p.proto);
      if (p.proto==='ospf'||p.proto==='ospf3') protoHtml += (p.areas||[]).length?p.areas.map(a=>`<span style="margin-right:10px">area ${e(a.area)} (${(a.interfaces||[]).length} ifaces)</span>`).join(''):'<em class="muted">—</em>';
      else if (p.proto==='bgp') protoHtml += (p.groups||[]).map(g=>`<span style="margin-right:10px"><code>${e(g.name)}</code> (${g.type||'—'}${g.peerAs?`, AS ${e(g.peerAs)}`:''},  ${g.neighbors.length} neighbors)</span>`).join('');
      else if (['isis','ldp','rsvp','mpls','pim','router-advertisement'].includes(p.proto)) protoHtml += `<span class="muted">${(p.interfaces||[]).length} ifaces</span>`;
    }
    vrfsHtml += `<div class="card"><div class="row"><code style="font-weight:700;font-size:14px">${e(vrf.name)}</code>${badge(typeColor,vrf.type)}${vrf.rd?badge('blue','RD '+vrf.rd):''}${vrf.vrfTarget?badge('blue','RT '+vrf.vrfTarget):''}${vrf.description?`<span class="muted" style="margin-left:auto;font-size:12px">${e(vrf.description)}</span>`:''}</div><div style="padding-left:12px;font-size:13px;margin-bottom:6px"><span class="label">Interfaces: </span>${vrf.interfaces.length?vrf.interfaces.map(i=>`<code style="margin-right:8px">${e(i)}</code>`).join(''):'<em class="muted">—</em>'}</div>${vrf.protocols.length?`<div style="padding-left:12px;font-size:13px"><span class="label">Protocols: </span><div style="margin-top:4px">${protoHtml}</div></div>`:''}</div>`;
  }

  let fwHtml = '';
  if (hasFW) {
    fwHtml = `<table><thead><tr>${['#','Name','From','To','Source','Destination','Service','Action','Log'].map(h=>`<th>${e(h)}</th>`).join('')}</tr></thead><tbody>`;
    for (const [i,r] of analysis.firewallRules.entries()) {
      const isDeny = /deny|reject|drop/i.test(r.action);
      fwHtml += `<tr><td class="muted"><code>${e(r.id||String(i+1))}</code></td><td><code>${e(r.name||'')}</code></td><td>${e(r.fromZone||'—')}</td><td>${e(r.toZone||'—')}</td><td><code>${e(r.source||'')}</code></td><td><code>${e(r.destination||'')}</code></td><td><code>${e(r.service||'')}</code></td><td>${badge(isDeny?'red':'green',r.action||'')}</td><td>${r.log?'✓':'—'}</td></tr>`;
    }
    fwHtml += '</tbody></table>';
  }

  let sysHtml = '';
  if (hasSystem && sys) {
    const sysCard = (title, content) => `<div class="card"><div class="card-title">${e(title)}</div>${content}</div>`;
    let identity = '';
    if (analysis.counts.hostname) identity += `<div style="font-size:13px"><span class="label">hostname: </span><code>${e(analysis.counts.hostname)}</code></div>`;
    if (sys.domain) identity += `<div style="font-size:13px"><span class="label">domain: </span><code>${e(sys.domain)}</code></div>`;
    if (sys.banner) identity += `<div style="font-size:13px"><span class="label">banner: </span>${badge('cyan',sys.banner)}</div>`;
    if (identity) sysHtml += sysCard('Identity', identity);
    if (sys.ntp.length||sys.dns.length) {
      let c = '';
      if (sys.ntp.length) c += `<div style="font-size:13px;margin-bottom:4px"><span class="label">NTP: </span>${sys.ntp.map(n=>badge(n.prefer?'green':'cyan',n.server+(n.prefer?' ★':'')+(n.vrf?` (vrf ${n.vrf})`:'')+'')).join('')}</div>`;
      if (sys.dns.length) c += `<div style="font-size:13px"><span class="label">DNS: </span>${sys.dns.map(d=>badge('cyan',d.server+(d.vrf?` (vrf ${d.vrf})`:'')+'')).join('')}</div>`;
      sysHtml += sysCard('Time & DNS', c);
    }
    if (sys.aaa.tacacs.length||sys.aaa.radius.length||sys.aaa.newModel) {
      let c = '';
      if (sys.aaa.newModel) c += `<div style="margin-bottom:4px">${badge('green','aaa new-model')}</div>`;
      if (sys.aaa.tacacs.length) c += `<div style="font-size:13px;margin-bottom:4px"><span class="label">TACACS+: </span>${sys.aaa.tacacs.map(t2=>badge('purple',(t2.host||t2.name)+(t2.vrf?` (vrf ${t2.vrf})`:'')+(t2.key?' [key]':''))).join('')}</div>`;
      if (sys.aaa.radius.length) c += `<div style="font-size:13px;margin-bottom:4px"><span class="label">RADIUS: </span>${sys.aaa.radius.map(r2=>badge('blue',(r2.host||r2.name)+(r2.authPort?` :${r2.authPort}`:'')+(r2.key?' [key]':''))).join('')}</div>`;
      sysHtml += sysCard('AAA', c);
    }
    if (sys.syslog.length) sysHtml += sysCard('Syslog', sys.syslog.map(s=>`<div style="font-size:13px">${badge('yellow',s.host)}${s.vrf?`<span class="muted"> vrf ${e(s.vrf)}</span>`:''}${s.severity?`<span class="muted"> sev ${e(s.severity)}</span>`:''}${s.transport?`<span class="muted"> ${e(s.transport)}</span>`:''}</div>`).join(''));
    if (sys.snmp.communities.length||sys.snmp.hosts.length||sys.snmp.users.length) {
      let c = '';
      if (sys.snmp.communities.length) c += `<div style="font-size:13px;margin-bottom:4px"><span class="label">communities: </span>${sys.snmp.communities.map(c2=>badge('cyan',`${c2.name} (${c2.access})`)).join('')}</div>`;
      if (sys.snmp.hosts.length) c += `<div style="font-size:13px;margin-bottom:4px"><span class="label">trap-hosts: </span>${sys.snmp.hosts.map(h2=>badge('blue',`${h2.host} v${h2.version}`)).join('')}</div>`;
      if (sys.snmp.users.length) c += `<div style="font-size:13px"><span class="label">users: </span>${sys.snmp.users.map(u=>badge('purple',u.name+(u.group?` (${u.group})`:'')+'')).join('')}</div>`;
      sysHtml += sysCard('SNMP', c);
    }
    if (sys.users.length) sysHtml += sysCard('Local Users', `<div style="font-size:13px">${sys.users.map(u=>badge('green',u.name+(u.privilege?` (${u.privilege})`:'')+'')).join('')}</div>`);
    if (isNxos&&(sys.features.length||sys.vpc||(sys.nbm&&sys.nbm.enabled)||sys.fex.length)) {
      let c = '';
      if (sys.features.length) c += `<div style="margin-bottom:6px;font-size:13px"><span class="label">features: </span>${sys.features.map(f=>badge('purple',f)).join('')}</div>`;
      if (sys.vpc) c += `<div style="margin-bottom:6px;font-size:13px"><span class="label">vPC: </span>${badge('blue','domain '+sys.vpc.domain)}${sys.vpc.priority?badge('cyan','prio '+sys.vpc.priority):''}${sys.vpc.peerLink?badge('green','peer-link '+sys.vpc.peerLink):''}</div>`;
      if (sys.fex.length) c += `<div style="font-size:13px"><span class="label">FEX: </span>${sys.fex.map(f=>`<span style="margin-right:10px"><code>fex-${e(f.id)}</code>${f.type?`<span class="muted"> ${e(f.type)}</span>`:''}</span>`).join('')}</div>`;
      sysHtml += sysCard('Platform / Features', c);
    }
  }

  return [
    { id: 'summary', title: 'Summary', content: statsHtml },
    { id: 'config', title: 'Raw Configuration', content: `<pre>${e(raw)}</pre>` },
    { id: 'interfaces', title: `Interfaces (${analysis.logicalUnits.length})`, content: ifaceHtml },
    { id: 'aggregates', title: `Aggregates / LACP (${analysis.aggregates.length})`, content: lagsHtml },
    { id: 'vlans', title: `VLANs (${analysis.vlans.length})`, content: vlansHtml },
    { id: 'vrfs', title: `Routing Instances (${analysis.vrfs.length})`, content: vrfsHtml },
    ...(hasFW ? [{ id: 'firewall', title: `Firewall Rules (${analysis.firewallRules.length})`, content: fwHtml }] : []),
    ...(hasSystem ? [{ id: 'system', title: 'System', content: sysHtml }] : []),
  ];
}

function DeviceTabBar({ devices, activeIdx, onSelect, onAdd, onClose, onReorder, displayName, collapsed, onToggleCollapse }) {
  const { t } = useTranslation();
  const scrollRef = useRef(null);
  const measureRef = useRef(null);
  const [overflowFrom, setOverflowFrom] = useState(devices.length);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const dragSrc = useRef(null);
  const [dragOverUid, setDragOverUid] = useState(null);

  useEffect(() => {
    const recalc = () => {
      const container = scrollRef.current;
      const measure = measureRef.current;
      if (!container || !measure) return;
      const available = container.clientWidth - 90; // reserve room for + and More
      const items = Array.from(measure.children);
      let used = 0;
      let cutoff = items.length;
      for (let i = 0; i < items.length; i++) {
        used += items[i].offsetWidth + 4;
        if (used > available) { cutoff = i; break; }
      }
      setOverflowFrom(cutoff);
    };
    recalc();
    const ro = new ResizeObserver(recalc);
    if (scrollRef.current) ro.observe(scrollRef.current);
    return () => ro.disconnect();
  }, [devices, activeIdx]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e) => { if (!menuRef.current?.contains(e.target)) setMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen]);

  const visibleCount = Math.max(1, Math.min(overflowFrom, devices.length));
  const overflow = devices.slice(visibleCount);
  // Ensure the active tab is always visible
  let visible = devices.slice(0, visibleCount);
  if (activeIdx >= visibleCount) {
    visible = visible.slice(0, -1);
    visible.push(devices[activeIdx]);
  }
  const visibleSet = new Set(visible.map(d => d.uid));
  const overflowList = devices.filter(d => !visibleSet.has(d.uid));

  const tabStyle = (active) => ({
    padding: '5px 10px',
    fontSize: 12,
    lineHeight: 1.3,
    background: 'transparent',
    border: 'none',
    color: active ? 'var(--fg)' : 'var(--muted)',
    borderBottom: active ? '2px solid var(--cyan)' : '2px solid transparent',
    borderRadius: 'var(--radius) var(--radius) 0 0',
    cursor: 'pointer',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    maxWidth: 200,
    whiteSpace: 'nowrap',
    fontWeight: active ? 600 : 400,
  });
  const closeBtnStyle = {
    border: 'none', background: 'transparent', color: 'var(--muted)',
    cursor: 'pointer', fontSize: 14, padding: 0, lineHeight: 1, width: 14, height: 14,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 3,
  };

  const renderTab = (d) => {
    const idx = devices.indexOf(d);
    const active = idx === activeIdx;
    const name = displayName(d);
    const isDragOver = dragOverUid === d.uid && dragSrc.current !== d.uid;
    return (
      <div
        key={d.uid}
        draggable
        style={{
          ...tabStyle(active),
          borderLeft: isDragOver ? '2px solid var(--cyan)' : '2px solid transparent',
          opacity: dragSrc.current === d.uid ? 0.4 : 1,
          cursor: 'grab',
        }}
        onClick={() => onSelect(idx)}
        title={name}
        onDragStart={(e) => { dragSrc.current = d.uid; e.dataTransfer.effectAllowed = 'move'; }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; setDragOverUid(d.uid); }}
        onDragLeave={() => setDragOverUid(null)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOverUid(null);
          if (dragSrc.current && dragSrc.current !== d.uid) {
            onReorder(dragSrc.current, d.uid);
          }
          dragSrc.current = null;
        }}
        onDragEnd={() => { dragSrc.current = null; setDragOverUid(null); }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</span>
        {devices.length > 1 && (
          <button
            style={closeBtnStyle}
            onClick={(e) => { e.stopPropagation(); onClose(idx); }}
            title={t('config_parser.close_device')}
            aria-label={t('config_parser.close_device')}
          >×</button>
        )}
      </div>
    );
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end', gap: 2,
      borderBottom: '1px solid var(--border)', marginBottom: 12,
      position: 'relative',
    }}>
      <div ref={scrollRef} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'flex-end', overflow: 'hidden' }}>
        {visible.map(renderTab)}
      </div>

      {/* Hidden measurement row used to compute overflow */}
      <div ref={measureRef} aria-hidden style={{
        position: 'absolute', visibility: 'hidden', pointerEvents: 'none',
        top: 0, left: 0, display: 'flex',
      }}>
        {devices.map(d => (
          <div key={d.uid} style={tabStyle(false)}>
            <span>{displayName(d)}</span>
            {devices.length > 1 && <span style={{ width: 14 }}>×</span>}
          </div>
        ))}
      </div>

      {overflowList.length > 0 && (
        <div ref={menuRef} style={{ position: 'relative' }}>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 12, padding: '4px 8px' }}
            onClick={() => setMenuOpen(o => !o)}
          >{t('config_parser.more_devices')} ({overflowList.length}) ▾</button>
          {menuOpen && (
            <div style={{
              position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 200,
              background: 'var(--panel)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius)', boxShadow: '0 6px 16px rgba(0,0,0,.35)',
              minWidth: 200, maxHeight: 320, overflowY: 'auto',
            }}>
              {overflowList.map(d => {
                const idx = devices.indexOf(d);
                return (
                  <div key={d.uid}
                    style={{
                      padding: '6px 10px', fontSize: 12, cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
                      background: idx === activeIdx ? 'rgba(0,212,200,.12)' : undefined,
                    }}
                    onClick={() => { onSelect(idx); setMenuOpen(false); }}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{displayName(d)}</span>
                    {devices.length > 1 && (
                      <button
                        style={closeBtnStyle}
                        onClick={(e) => { e.stopPropagation(); onClose(idx); }}
                        title={t('config_parser.close_device')}
                      >×</button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <button
        className="btn btn-ghost btn-sm"
        style={{ fontSize: 14, padding: '4px 10px', lineHeight: 1 }}
        onClick={onAdd}
        title={t('config_parser.new_device')}
        aria-label={t('config_parser.new_device')}
      >+</button>

      {onToggleCollapse && (
        <button
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 14, padding: '4px 10px', lineHeight: 1, color: 'var(--muted)', marginLeft: 2 }}
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand input' : 'Collapse input'}
        >{collapsed ? '▸' : '▾'}</button>
      )}
    </div>
  );
}

const _CONF_PILL = { confirmed: 'green', structural: 'cyan', plausible: 'yellow', weak: 'gray' };
function ConfidenceBadge({ level, t }) {
  return <Pill color={_CONF_PILL[level] || 'gray'}>{t('config_parser.conf_' + level)}</Pill>;
}

// Legend mapping each confidence line style to its meaning.
function DiagramLegend({ t }) {
  const levels = ['confirmed', 'structural', 'plausible', 'weak'];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--muted)' }}>
      {levels.map(level => {
        const v = CONF_VISUAL[level];
        return (
          <span key={level} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <svg width="34" height="10" aria-hidden="true">
              <line x1="1" y1="5" x2="33" y2="5" stroke={v.color} strokeWidth={v.width} strokeDasharray={v.dash || undefined} />
            </svg>
            {t('config_parser.conf_' + level)}
          </span>
        );
      })}
    </div>
  );
}

function SaveAsModal({ filename, onConfirm, onCancel }) {
  const [name, setName] = React.useState(filename);
  const inputRef = React.useRef(null);
  React.useEffect(() => {
    if (inputRef.current) {
      inputRef.current.focus();
      // select the name without the .json extension for easy editing
      const dotIdx = name.lastIndexOf('.');
      inputRef.current.setSelectionRange(0, dotIdx > 0 ? dotIdx : name.length);
    }
  }, []);
  const submit = () => onConfirm(name);
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,.55)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onMouseDown={onCancel}>
      <div style={{
        background: 'var(--panel)', border: '1px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '20px 24px', minWidth: 320,
        boxShadow: '0 8px 32px rgba(0,0,0,.45)',
      }} onMouseDown={e => e.stopPropagation()}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Save session as</div>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel(); }}
          style={{
            width: '100%', boxSizing: 'border-box',
            background: 'var(--input-bg, var(--bg))', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', padding: '6px 10px', color: 'var(--text)',
            fontSize: 13, marginBottom: 14,
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary btn-sm" onClick={submit}>Save</button>
        </div>
      </div>
    </div>
  );
}

// DOM helper: extract node positions from a rendered Mermaid SVG.
function extractNodePositions(svgEl) {
  var positions = {};
  if (!svgEl) return positions;
  svgEl.querySelectorAll('g.node').forEach(function(g) {
    var m = (g.id || '').match(/flowchart-(n\d+)-/);
    if (!m) return;
    var nodeId = m[1];
    var t = g.getAttribute('transform') || '';
    var tm = t.match(/translate\(\s*([\d.+-]+)[, ]+([\d.+-]+)\s*\)/);
    var x = tm ? parseFloat(tm[1]) : 0;
    var y = tm ? parseFloat(tm[2]) : 0;
    var rect = g.querySelector('rect');
    var w = rect ? parseFloat(rect.getAttribute('width') || 120) : 120;
    var h = rect ? parseFloat(rect.getAttribute('height') || 60) : 60;
    positions[nodeId] = { x: x, y: y, w: w, h: h };
  });
  return positions;
}

// Modal: full-screen Mermaid topology with layout-direction toggle + legend.
function RelationshipDiagramModal({ nodes, links, onClose, t }) {
  const [dir, setDir] = useState('LR');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [copied, copy] = useCopy();
  const containerRef = useRef(null);
  const renderSeq = useRef(0);

  const handleDownloadSvg = () => {
    if (loading || error || !containerRef.current) return;
    const svgEl = containerRef.current.querySelector('svg');
    if (!svgEl) return;
    const clone = svgEl.cloneNode(true);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const serialized = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(clone);
    const blob = new Blob([serialized], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'topology.svg'; a.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadDrawio = () => {
    if (loading || error || !containerRef.current) return;
    const svgEl = containerRef.current.querySelector('svg');
    if (!svgEl) return;
    const positions = extractNodePositions(svgEl);
    const xml = buildDrawio(nodes, links, positions, { descLabel: t('config_parser.link_desc') });
    const blob = new Blob([xml], { type: 'application/xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'topology.drawio'; a.click();
    URL.revokeObjectURL(url);
  };

  const source = useMemo(
    () => buildMermaid(nodes, links, dir, { descLabel: t('config_parser.link_desc') }),
    [nodes, links, dir, t]
  );

  useEffect(() => {
    const seq = ++renderSeq.current;
    setLoading(true);
    setError(null);
    ensureMermaid()
      .then(async (mermaid) => {
        if (seq !== renderSeq.current) return;
        const id = 'recon-mmd-' + Date.now();
        const { svg } = await mermaid.render(id, source);
        if (seq !== renderSeq.current || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        const svgEl = containerRef.current.querySelector('svg');
        if (svgEl) svgEl.style.maxWidth = '100%';
        setLoading(false);
      })
      .catch(() => { if (seq === renderSeq.current) { setLoading(false); setError(t('config_parser.diagram_load_error')); } });
  }, [source, t]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'var(--bg, #0b0e14)', display: 'flex', alignItems: 'stretch', justifyContent: 'stretch' }}
    >
      <div
        style={{ background: 'var(--panel)', width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>{t('config_parser.diagram_title')}</div>
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <button className={`btn btn-sm ${dir === 'LR' ? '' : 'btn-ghost'}`} onClick={() => setDir('LR')}>{t('config_parser.layout_lr')}</button>
            <button className={`btn btn-sm ${dir === 'TD' ? '' : 'btn-ghost'}`} onClick={() => setDir('TD')}>{t('config_parser.layout_tb')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(source, 'mmd')}>{copied === 'mmd' ? t('common.copied') : t('config_parser.copy_mermaid')}</button>
            <button className="btn btn-ghost btn-sm" disabled={loading || !!error} onClick={handleDownloadSvg}>{t('config_parser.download_svg')}</button>
            <button className="btn btn-ghost btn-sm" disabled={loading || !!error} onClick={handleDownloadDrawio}>{t('config_parser.download_drawio')}</button>
            <button className="btn btn-ghost btn-sm" onClick={onClose}>{t('common.close')}</button>
          </div>
        </div>
        <div style={{ padding: 16, overflow: 'auto', flex: 1 }}>
          {loading && <div className="hint">{t('common.loading', 'Loading…')}</div>}
          {error && <Err msg={error} />}
          <div ref={containerRef} style={{ textAlign: 'center' }} />
        </div>
        {!error && (
          <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
            <DiagramLegend t={t} />
          </div>
        )}
      </div>
    </div>
  );
}

function ConfigParser({ onShare }) {
  const { t } = useTranslation();
  const [devices, setDevices] = useState(() => _sessionStore.devices ?? [newDevice('Device 1')]);
  const [activeIdx, setActiveIdx] = useState(() => _sessionStore.activeIdx ?? 0);

  useEffect(() => { _sessionStore.devices = devices; }, [devices]);
  useEffect(() => { _sessionStore.activeIdx = activeIdx; }, [activeIdx]);

  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'config-parser' });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [onShare]);

  // User-dismissed relationships (by stable link key); persists across
  // tool-switching and round-trips through session export/import.
  const [removedLinks, setRemovedLinks] = useState(() => _sessionStore.removedLinks ?? []);
  useEffect(() => { _sessionStore.removedLinks = removedLinks; }, [removedLinks]);

  const [saveAsState, setSaveAsState] = useState(null); // { filename, payload } or null
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const [sessionMenuOpen, setSessionMenuOpen] = useState(false);
  const sessionMenuRef = useRef(null);
  const [htmlExportMenuOpen, setHtmlExportMenuOpen] = useState(false);
  const htmlExportMenuRef = useRef(null);
  const [sampleMenuOpen, setSampleMenuOpen] = useState(false);
  const sampleMenuRef = useRef(null);

  useEffect(() => {
    if (!sessionMenuOpen) return;
    const close = (e) => { if (!sessionMenuRef.current?.contains(e.target)) setSessionMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [sessionMenuOpen]);

  useEffect(() => {
    if (!htmlExportMenuOpen) return;
    const close = (e) => { if (!htmlExportMenuRef.current?.contains(e.target)) setHtmlExportMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [htmlExportMenuOpen]);

  useEffect(() => {
    if (!sampleMenuOpen) return;
    const close = (e) => { if (!sampleMenuRef.current?.contains(e.target)) setSampleMenuOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [sampleMenuOpen]);

  const active = devices[activeIdx];

  const updateActive = useCallback((patch) => {
    setDevices(prev => prev.map((d, i) => i === activeIdx ? { ...d, ...patch } : d));
  }, [activeIdx]);

  const addDevice = () => {
    setDevices(prev => {
      const next = [...prev, newDevice(`Device ${prev.length + 1}`)];
      setActiveIdx(next.length - 1);
      return next;
    });
  };

  const closeDevice = (idx) => {
    setDevices(prev => {
      if (prev.length <= 1) return prev;
      const next = prev.filter((_, i) => i !== idx);
      setActiveIdx(curr => {
        if (idx < curr) return curr - 1;
        if (idx === curr) return Math.min(curr, next.length - 1);
        return curr;
      });
      return next;
    });
  };

  const reorderDevices = (srcUid, dstUid) => {
    setDevices(prev => {
      const srcIdx = prev.findIndex(d => d.uid === srcUid);
      const dstIdx = prev.findIndex(d => d.uid === dstUid);
      if (srcIdx < 0 || dstIdx < 0) return prev;
      const next = [...prev];
      const [moved] = next.splice(srcIdx, 1);
      next.splice(dstIdx, 0, moved);
      setActiveIdx(next.findIndex(d => d.uid === prev[activeIdx].uid));
      return next;
    });
  };

  const exportSession = async () => {
    const payload = JSON.stringify({ version: 1, activeIdx, devices, removedLinks }, null, 2);
    const filename = `netengkit-session-${new Date().toISOString().slice(0, 10)}.json`;
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const fh = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'JSON Session', accept: { 'application/json': ['.json'] } }],
        });
        const writable = await fh.createWritable();
        await writable.write(payload);
        await writable.close();
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
        // unexpected error — fall through to modal
      }
    }
    setSaveAsState({ filename, payload });
  };

  const confirmSaveAs = (name) => {
    const { payload } = saveAsState;
    setSaveAsState(null);
    const finalName = (name || '').trim() || 'netengkit-session.json';
    const blob = new Blob([payload], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = finalName.endsWith('.json') ? finalName : finalName + '.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const importSessionRef = useRef(null);
  const importSession = (e) => {
    const file = e.target.files && e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (!data.devices || !Array.isArray(data.devices)) throw new Error();
        // Re-stamp UIDs to avoid collisions if importing multiple times
        const remapped = data.devices.map(d => ({ ...d, uid: `dev-${++_devSeq}-${Date.now()}` }));
        setDevices(remapped);
        setActiveIdx(Math.min(data.activeIdx ?? 0, remapped.length - 1));
        setRemovedLinks(Array.isArray(data.removedLinks) ? data.removedLinks : []);
      } catch (_) {
        alert(t('config_parser.import_error'));
      }
    };
    reader.readAsText(file);
  };

  const { raw, vendor, filterText, resultsTab } = active;

  const { analysis, parseError, detectedVendor } = useMemo(() => {
    if (!raw.trim()) return { analysis: null, parseError: null, detectedVendor: null };
    try {
      let mod;
      let detected = null;
      let force = null;
      if (vendor === 'auto') {
        detected = autoDetect(raw);
        if (!detected || detected.score < 10) {
          return { analysis: null, parseError: t('config_parser.err_no_vendor'), detectedVendor: null };
        }
        mod = detected.mod;
        force = detected.force;
      } else {
        const v = VENDORS.find(x => x.id === vendor);
        mod = v && v.mod();
        force = v && v.force;
        if (!mod) return { analysis: null, parseError: t('config_parser.err_no_parser'), detectedVendor: null };
      }
      return { analysis: mod.parse(raw, force ? { forceVendor: force } : undefined), parseError: null, detectedVendor: detected };
    } catch (err) {
      return { analysis: null, parseError: err.message || String(err), detectedVendor: null };
    }
  }, [raw, vendor, t]);

  useEffect(() => {
    const hostname = analysis && analysis.counts && analysis.counts.hostname || '';
    if (hostname !== active.hostname) updateActive({ hostname });
  }, [analysis]);

  const displayName = (d) => {
    if (d.customName) return d.customName;
    if (d.hostname) return d.hostname;
    return d.defaultName;
  };

  const q = filterText.trim().toLowerCase();
  const matches = (s) => !q || String(s || '').toLowerCase().includes(q);

  const filteredUnits = useMemo(() => {
    if (!analysis) return [];
    if (!q) return analysis.logicalUnits;
    return analysis.logicalUnits.filter(u =>
      matches(u.ifkey) || matches(u.description) || matches(u.vrf) || matches(u.vlanId) ||
      (u.vlanMembers || []).some(matches) || (u.ipv4 || []).some(matches) || (u.ipv6 || []).some(matches)
    );
  }, [analysis, q]);

  // ── Cross-tab relationship reconciliation ──
  const [showRelationships, setShowRelationships] = useState(false);
  const [showDiagram, setShowDiagram] = useState(false);
  const [neighborOpen, setNeighborOpen] = useState(false);
  const [reconCopied, copyRecon] = useCopy();

  const allParsed = useMemo(() => devices.map((d, i) => ({
    uid: d.uid,
    name: d.customName || d.hostname || d.defaultName,
    analysis: i === activeIdx ? analysis : parseConfigSafe(d.raw, d.vendor),
    neighbors: parseNeighborsSafe(d.neighborRaw || ''),
  })), [devices, activeIdx, analysis]);

  const recon = useMemo(() => reconcileDevices(allParsed), [allParsed]);
  const removedSet = useMemo(() => new Set(removedLinks), [removedLinks]);
  const visibleLinks = useMemo(() => recon.links.filter(l => !removedSet.has(l.key)), [recon, removedSet]);
  const removedVisible = useMemo(() => recon.links.filter(l => removedSet.has(l.key)), [recon, removedSet]);
  const canMap = recon.links.length >= 1;

  const removeLink = (key) => setRemovedLinks(prev => (prev.includes(key) ? prev : [...prev, key]));
  const restoreLink = (key) => setRemovedLinks(prev => prev.filter(k => k !== key));

  const copyReconText = () => {
    const header = [t('config_parser.evidence_col_link'), t('config_parser.evidence_col_confidence'), t('config_parser.evidence_col_why')].join('\t');
    const rows = visibleLinks.map(l => {
      const link = l.aIntf || l.bIntf
        ? `${l.aLabel} ${l.aIntf || '?'} ↔ ${l.bLabel} ${l.bIntf || '?'}`
        : `${l.aLabel} ↔ ${l.bLabel}`;
      return [link, t('config_parser.conf_' + l.confidence), l.evidence.map(e => e.detail).join('; ')].join('\t');
    });
    copyRecon([header, ...rows].join('\n'), 'recon');
  };

  const loadSample = (useSet = false) => {
    const v = VENDORS.find(x => x.id === (vendor === 'auto' ? 'junos' : vendor));
    const mod = v && v.mod();
    if (!mod) return;
    const text = useSet ? (mod.sampleSet || mod.sample) : mod.sample;
    if (text) updateActive({ raw: text });
  };

  const sampleMod = (() => {
    const v = VENDORS.find(x => x.id === (vendor === 'auto' ? 'junos' : vendor));
    return v && v.mod();
  })();

  const handleExportJSON = () => {
    if (!analysis) return;
    exportJSON(analysis, 'device-config.json');
  };

  const _htmlDownload = (html, filename) => {
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  };

  const _htmlWrapDoc = (title, meta, navHtml, bodyHtml, T) => {
    const css = _htmlCSS(T);
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${_htmlEsc(title)}</title>
<style>${css}</style>
</head>
<body>
<h1>${_htmlEsc(title)}</h1>
<div class="meta">${meta}</div>
<nav style="margin-bottom:20px;padding:10px 14px;background:${T.panel};border:1px solid ${T.border};border-radius:8px;display:flex;flex-wrap:wrap;gap:6px">${navHtml}</nav>
${bodyHtml}
</body>
</html>`;
  };

  const handleExportHTML = () => {
    if (!analysis) return;
    const isDark = !document.documentElement.classList.contains('light');
    const T = _htmlTheme(isDark);
    const host = (analysis.counts.hostname || analysis.vendor || 'device').replace(/[^a-zA-Z0-9._-]+/g, '_');
    const sections = _htmlBuildDeviceSections(analysis, raw, T);
    const nav = sections.map(s => `<a href="#${s.id}" style="color:${T.cyan};text-decoration:none;font-size:13px">${_htmlEsc(s.title)}</a>`).join(' &nbsp;·&nbsp; ');
    const body = sections.map(s => `<section id="${s.id}"><h2>${_htmlEsc(s.title)}</h2>${s.content}</section>`).join('\n');
    const title = `Config Report — ${analysis.counts.hostname || host}`;
    const meta = `Generated ${new Date().toISOString().replace('T',' ').slice(0,19)} UTC &nbsp;·&nbsp; Vendor: ${_htmlEsc(analysis.vendor)} &nbsp;·&nbsp; Hostname: ${_htmlEsc(analysis.counts.hostname || '—')}`;
    _htmlDownload(_htmlWrapDoc(title, meta, nav, body, T), `${host}-config-report-${new Date().toISOString().slice(0,10)}.html`);
  };

  const handleExportAllHTML = () => {
    const isDark = !document.documentElement.classList.contains('light');
    const T = _htmlTheme(isDark);
    const e = _htmlEsc;

    const parseOne = (dev) => {
      if (!dev.raw.trim()) return null;
      try {
        let mod, force = null;
        if (dev.vendor === 'auto') {
          const det = autoDetect(dev.raw);
          if (!det || det.score < 10) return null;
          mod = det.mod; force = det.force;
        } else {
          const v = VENDORS.find(x => x.id === dev.vendor);
          mod = v && v.mod(); force = v && v.force;
          if (!mod) return null;
        }
        return mod.parse(dev.raw, force ? { forceVendor: force } : undefined);
      } catch (_) { return null; }
    };

    const parsed = devices.map(dev => ({
      name: dev.customName || dev.hostname || dev.defaultName,
      analysis: parseOne(dev),
      raw: dev.raw,
    }));
    if (!parsed.some(p => p.analysis)) return;

    const btnText = isDark ? '#000' : '#fff';
    const tabCSS = `
      .dtab-bar{display:flex;gap:2px;border-bottom:1px solid ${T.border};margin-bottom:20px;overflow-x:auto}
      .dtab{padding:6px 14px;font-size:13px;background:transparent;border:none;border-bottom:2px solid transparent;
            color:${T.muted};cursor:pointer;white-space:nowrap;font-weight:400;margin-bottom:-1px;line-height:1.4}
      .dtab:hover{color:${T.text}}
      .dtab.active{color:${T.text};border-bottom-color:${T.cyan};font-weight:600}
      .stab-bar{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
      .stab{padding:5px 10px;font-size:12px;border-radius:4px;border:1px solid ${T.border};
            background:transparent;color:${T.muted};cursor:pointer;white-space:nowrap}
      .stab:hover{color:${T.text};border-color:${T.muted}}
      .stab.active{background:${T.cyan};color:${btnText};border-color:${T.cyan};font-weight:600}
      .dpanel{display:none}.dpanel.active{display:block}
      .spanel{display:none}.spanel.active{display:block}
    `;

    // Device tab bar
    let dtabBar = '<div class="dtab-bar" role="tablist">';
    parsed.forEach((p, idx) => {
      dtabBar += `<button id="dtab-${idx}" class="dtab${idx===0?' active':''}" role="tab" onclick="showDevice(${idx})">${e(p.name)}</button>`;
    });
    dtabBar += '</div>';

    // Device panels
    let panels = '';
    for (const [idx, p] of parsed.entries()) {
      panels += `<div id="dpanel-${idx}" class="dpanel${idx===0?' active':''}">`;
      if (!p.analysis) {
        panels += `<p class="muted" style="font-size:13px">No configuration data available.</p>`;
      } else {
        const sections = _htmlBuildDeviceSections(p.analysis, p.raw, T);
        // Section tab bar
        panels += '<div class="stab-bar">';
        sections.forEach(s => {
          const first = s === sections[0];
          panels += `<button id="stab-${idx}-${s.id}" class="stab${first?' active':''}" onclick="showSection(${idx},'${s.id}')">${e(s.title)}</button>`;
        });
        panels += '</div>';
        // Section panels
        sections.forEach(s => {
          const first = s === sections[0];
          panels += `<div id="spanel-${idx}-${s.id}" class="spanel${first?' active':''}">${s.content}</div>`;
        });
      }
      panels += '</div>';
    }

    const js = `
      function showDevice(idx) {
        document.querySelectorAll('.dtab').forEach(function(t){t.classList.remove('active');});
        document.querySelectorAll('.dpanel').forEach(function(p){p.classList.remove('active');});
        document.getElementById('dtab-'+idx).classList.add('active');
        document.getElementById('dpanel-'+idx).classList.add('active');
      }
      function showSection(di, sid) {
        var panel = document.getElementById('dpanel-'+di);
        panel.querySelectorAll('.stab').forEach(function(t){t.classList.remove('active');});
        panel.querySelectorAll('.spanel').forEach(function(p){p.classList.remove('active');});
        document.getElementById('stab-'+di+'-'+sid).classList.add('active');
        document.getElementById('spanel-'+di+'-'+sid).classList.add('active');
      }
    `;

    const n = parsed.length;
    const css = _htmlCSS(T) + tabCSS;
    const date = new Date().toISOString().replace('T',' ').slice(0,19);
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Config Report — All Devices (${n})</title>
<style>${css}</style>
</head>
<body>
<h1>Config Report — All Devices (${n})</h1>
<div class="meta">Generated ${date} UTC &nbsp;·&nbsp; ${n} device${n!==1?'s':''}</div>
${dtabBar}
${panels}
<script>${js}<\/script>
</body>
</html>`;

    _htmlDownload(html, `all-devices-config-report-${new Date().toISOString().slice(0,10)}.html`);
  };

  const handleExportCSVs = () => {
    if (!analysis) return;
    const host = (analysis.counts.hostname || analysis.vendor || 'device').replace(/[^a-zA-Z0-9._-]+/g, '_');

    const ifaceRows = [['Interface', 'Parent', 'Unit', 'Type', 'VRF', 'Mode', 'VLAN ID', 'VLAN Members', 'IPv4', 'IPv6', 'Families', 'Description']];
    for (const u of analysis.logicalUnits) {
      ifaceRows.push([
        u.ifkey, u.parent, u.unit,
        u.isAgg ? 'aggregate' : (u.isIrb ? 'svi/irb' : 'physical'),
        u.vrf || '', u.mode || '',
        u.vlanId || '', (u.vlanMembers || []).join(' '),
        (u.ipv4 || []).join(' '), (u.ipv6 || []).join(' '),
        (u.families || []).join(' '), u.description || '',
      ]);
    }
    exportCSV(ifaceRows, `${host}_interfaces.csv`);

    const lagRows = [['Aggregate', 'LACP Mode', 'Periodic', 'Min Links', 'Speed', 'Member Count', 'Members', 'Description']];
    for (const a of analysis.aggregates) {
      lagRows.push([a.name, a.lacpMode || '', a.periodic || '', a.minLinks !== undefined ? a.minLinks : '', a.speed || '', a.members.length, a.members.join(' '), a.description || '']);
    }
    exportCSV(lagRows, `${host}_aggregates.csv`);

    const vlanRows = [['VLAN Name', 'VLAN ID', 'L3 Interface', 'Member Count', 'Members (mode)', 'Description']];
    for (const v of analysis.vlans) {
      vlanRows.push([v.name, v.id || '', v.l3Interface || '', v.members.length, v.members.map(m => `${m.ifkey}${m.mode ? ` (${m.mode})` : ''}`).join(' '), v.description || '']);
    }
    exportCSV(vlanRows, `${host}_vlans.csv`);

    const vrfRows = [['Routing Instance', 'Type', 'RD', 'VRF Target', 'Interface Count', 'Interfaces', 'Protocols', 'Description']];
    for (const vrf of analysis.vrfs) {
      const proto = vrf.protocols.map(p => {
        if (p.proto === 'ospf' || p.proto === 'ospf3') return `${p.proto}[${(p.areas || []).map(a => `area ${a.area}`).join(';')}]`;
        if (p.proto === 'bgp') return `bgp[${(p.groups || []).map(g => `${g.name}:${g.neighbors.length}n`).join(';')}]`;
        return `${p.proto}[${(p.interfaces || []).length}if]`;
      }).join(' ');
      vrfRows.push([vrf.name, vrf.type, vrf.rd || '', vrf.vrfTarget || '', vrf.interfaces.length, vrf.interfaces.join(' '), proto, vrf.description || '']);
    }
    exportCSV(vrfRows, `${host}_routing_instances.csv`);

    if (analysis.firewallRules && analysis.firewallRules.length) {
      const fwRows = [['ID', 'Name', 'From', 'To', 'Src Intf', 'Dst Intf', 'Source', 'Destination', 'Service', 'Action', 'Log', 'Description']];
      for (const r of analysis.firewallRules) {
        fwRows.push([r.id || '', r.name || '', r.fromZone || '', r.toZone || '', r.sourceIntf || '', r.destIntf || '', r.source || '', r.destination || '', r.service || '', r.action || '', r.log ? 'yes' : 'no', r.description || '']);
      }
      exportCSV(fwRows, `${host}_firewall_rules.csv`);
    }

    const bgpRows = [['Routing Instance', 'Group', 'Type', 'Peer AS', 'Local AS', 'Neighbor']];
    for (const vrf of analysis.vrfs) {
      for (const p of vrf.protocols || []) {
        if (p.proto !== 'bgp') continue;
        for (const g of p.groups || []) {
          if (!g.neighbors.length) bgpRows.push([vrf.name, g.name, g.type || '', g.peerAs || '', g.localAs || '', '']);
          else for (const n of g.neighbors) bgpRows.push([vrf.name, g.name, g.type || '', g.peerAs || '', g.localAs || '', n]);
        }
      }
    }
    if (bgpRows.length > 1) exportCSV(bgpRows, `${host}_bgp_neighbors.csv`);

    if (analysis.system) {
      const sys = analysis.system;
      const sysRows = [['Category', 'Field', 'Value', 'Detail']];
      if (sys.domain) sysRows.push(['system', 'domain', sys.domain, '']);
      for (const d of sys.dns) sysRows.push(['dns', 'server', d.server, d.vrf ? `vrf ${d.vrf}` : '']);
      for (const n of sys.ntp) sysRows.push(['ntp', 'server', n.server, [n.prefer && 'prefer', n.vrf && `vrf ${n.vrf}`, n.key && `key ${n.key}`].filter(Boolean).join(' ')]);
      if (sys.aaa.newModel) sysRows.push(['aaa', 'new-model', 'enabled', '']);
      for (const t of sys.aaa.tacacs) sysRows.push(['tacacs+', t.name || 'host', t.host || t.name, [t.vrf && `vrf ${t.vrf}`, t.port && `port ${t.port}`, t.key && 'key set'].filter(Boolean).join(' ')]);
      for (const r of sys.aaa.radius) sysRows.push(['radius', r.name || 'host', r.host || r.name, [r.vrf && `vrf ${r.vrf}`, r.authPort && `auth ${r.authPort}`, r.acctPort && `acct ${r.acctPort}`, r.key && 'key set'].filter(Boolean).join(' ')]);
      for (const m of sys.aaa.methods) sysRows.push(['aaa', 'method', m, '']);
      for (const s of sys.syslog) sysRows.push(['syslog', 'server', s.host, [s.vrf && `vrf ${s.vrf}`, s.severity && `sev ${s.severity}`, s.transport].filter(Boolean).join(' ')]);
      for (const c of sys.snmp.communities) sysRows.push(['snmp', 'community', c.name, c.access]);
      for (const h2 of sys.snmp.hosts) sysRows.push(['snmp', 'trap-host', h2.host, [h2.version, h2.community].filter(Boolean).join(' ')]);
      for (const u of sys.snmp.users) sysRows.push(['snmp', 'user', u.name, u.group]);
      for (const u of sys.users) sysRows.push(['user', 'local', u.name, u.privilege ? `priv ${u.privilege}` : '']);
      if (sys.banner) sysRows.push(['banner', sys.banner, 'configured', '']);
      for (const f of sys.features) sysRows.push(['feature', f, 'enabled', '']);
      if (sys.vpc) sysRows.push(['vpc', `domain ${sys.vpc.domain}`, sys.vpc.peerKeepalive || '', [sys.vpc.role, sys.vpc.priority && `prio ${sys.vpc.priority}`, sys.vpc.peerLink && `peer-link ${sys.vpc.peerLink}`].filter(Boolean).join(' ')]);
      for (const f of sys.fex) sysRows.push(['fex', f.id, f.type || '', f.description || '']);
      for (const fp of sys.nbm.flowPolicies) sysRows.push(['nbm', 'flow-policy', fp.name, fp.flows ? `${fp.flows} flows` : '']);
      if (sysRows.length > 1) exportCSV(sysRows, `${host}_system.csv`);
    }
  };

  const hasFW = analysis && analysis.firewallRules && analysis.firewallRules.length > 0;
  const sys = analysis && analysis.system;
  const isNxos = analysis && analysis.vendor === 'cisco-nx-os';
  const hasSystem = !!(sys && (sys.ntp.length || sys.dns.length || sys.aaa.tacacs.length || sys.aaa.radius.length || sys.syslog.length || sys.snmp.communities.length || sys.snmp.hosts.length || sys.snmp.users.length || sys.users.length || sys.banner || sys.domain || (isNxos && (sys.features.length || sys.fex.length || sys.vpc || (sys.nbm && sys.nbm.enabled)))));

  const tab = resultsTab;
  const setTab = (k) => updateActive({ resultsTab: k });
  const setFilterText = (v) => updateActive({ filterText: v });

  const vendorOptions = VENDORS.map(v => ({ value: v.id, label: v.label }));

  return (
    <div className="fadein">
      {saveAsState && <SaveAsModal
        filename={saveAsState.filename}
        onConfirm={confirmSaveAs}
        onCancel={() => setSaveAsState(null)}
      />}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="card-title">{t('config_parser.title')}</div>
          <div ref={sessionMenuRef} style={{ position: 'relative' }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ fontSize: 12, padding: '4px 8px' }}
              onClick={() => setSessionMenuOpen(o => !o)}
            >{t('config_parser.session')} ▾</button>
            {sessionMenuOpen && (
              <div style={{
                position: 'absolute', top: 'calc(100% + 4px)', right: 0, zIndex: 200,
                background: 'var(--panel)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', boxShadow: '0 6px 16px rgba(0,0,0,.35)',
                minWidth: 180,
              }}>
                <div
                  style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onClick={() => { exportSession(); setSessionMenuOpen(false); }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,200,.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >{t('config_parser.export_session')}</div>
                <div
                  style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                  onClick={() => { importSessionRef.current && importSessionRef.current.click(); setSessionMenuOpen(false); }}
                  onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,200,.08)'}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >{t('config_parser.import_session')}</div>
              </div>
            )}
          </div>
        </div>
        <input ref={importSessionRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={importSession} />
        <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>{t('config_parser.subtitle')}</p>

        <DeviceTabBar
          devices={devices}
          activeIdx={activeIdx}
          onSelect={setActiveIdx}
          onAdd={addDevice}
          onClose={closeDevice}
          onReorder={reorderDevices}
          displayName={displayName}
          collapsed={inputCollapsed}
          onToggleCollapse={() => setInputCollapsed(c => !c)}
        />

        {!inputCollapsed && <div>
        <div className="field">
          <label className="label">{t('config_parser.vendor_label')}</label>
          <div style={{ maxWidth: 320 }}>
            <SearchableSelect
              value={vendor}
              onChange={(val) => updateActive({ vendor: val || 'auto' })}
              options={vendorOptions}
              placeholder={t('config_parser.vendor_placeholder')}
            />
          </div>
          {vendor === 'auto' && detectedVendor && (
            <div style={{ marginTop: 6 }}>
              <Pill color="green">{t('config_parser.detected')}: {detectedVendor.label} ({detectedVendor.score})</Pill>
            </div>
          )}
        </div>

        <div className="field">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <label className="label">{t('config_parser.input_label')}</label>
            <CopyBtn text={raw} id="cfg-parse" />
          </div>
          <textarea
            className="input"
            style={{ minHeight: 200, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', maxWidth: '100%', boxSizing: 'border-box' }}
            placeholder={t('config_parser.placeholder')}
            value={raw}
            onChange={e => updateActive({ raw: e.target.value })}
          />
          <div className="hint">{t('config_parser.hint')}</div>
        </div>

        <div className="field">
          <button
            className="btn btn-ghost btn-sm"
            style={{ paddingLeft: 0 }}
            onClick={() => setNeighborOpen(o => !o)}
          >
            {neighborOpen ? '▾' : '▸'} {t('config_parser.neighbors_label')}
            {(active.neighborRaw || '').trim() && !neighborOpen && (
              <span style={{ marginLeft: 8 }}><Pill color="cyan">{parseNeighborsSafe(active.neighborRaw).length}</Pill></span>
            )}
          </button>
          {neighborOpen && (
            <div style={{ marginTop: 8 }}>
              <textarea
                className="input"
                style={{ minHeight: 120, fontFamily: 'monospace', fontSize: 12, resize: 'vertical', maxWidth: '100%', boxSizing: 'border-box' }}
                placeholder={t('config_parser.neighbors_placeholder')}
                value={active.neighborRaw || ''}
                onChange={e => updateActive({ neighborRaw: e.target.value })}
              />
              <div className="hint">{t('config_parser.neighbors_hint')}</div>
            </div>
          )}
        </div>

        <div className="btn-row">
          {sampleMod && sampleMod.sampleSet ? (
            <div ref={sampleMenuRef} style={{ position: 'relative' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setSampleMenuOpen(o => !o)}>
                {t('config_parser.load_sample')} ▾
              </button>
              {sampleMenuOpen && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, zIndex: 200,
                  background: 'var(--panel)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', boxShadow: '0 6px 16px rgba(0,0,0,.35)',
                  minWidth: 280,
                }}>
                  {[
                    { label: t('config_parser.load_sample_brace'), useSet: false },
                    { label: t('config_parser.load_sample_set'), useSet: true },
                  ].map(({ label, useSet }) => (
                    <div key={label}
                      style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                      onClick={() => { loadSample(useSet); setSampleMenuOpen(false); }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,200,.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >{label}</div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <button className="btn btn-ghost btn-sm" onClick={() => loadSample()}>{t('config_parser.load_sample')}</button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => updateActive({ raw: '', filterText: '' })}>{t('common.clear')}</button>
          <button
            className="btn btn-sm"
            disabled={!canMap}
            title={canMap ? '' : t('config_parser.map_relationships_disabled')}
            onClick={() => setShowRelationships(true)}
          >
            {t('config_parser.map_relationships')}{canMap ? ` (${recon.links.length})` : ''}
          </button>
          {analysis && <button className="btn btn-ghost btn-sm" onClick={handleExportCSVs}>{t('common.export')} CSV</button>}
          {analysis && <button className="btn btn-ghost btn-sm" onClick={handleExportJSON}>{t('common.export')} JSON</button>}
          {analysis && (
            <div ref={htmlExportMenuRef} style={{ position: 'relative' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setHtmlExportMenuOpen(o => !o)}>
                {t('common.export')} HTML ▾
              </button>
              {htmlExportMenuOpen && (
                <div style={{
                  position: 'absolute', bottom: 'calc(100% + 4px)', left: 0, zIndex: 200,
                  background: 'var(--panel)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', boxShadow: '0 6px 16px rgba(0,0,0,.35)',
                  minWidth: 170,
                }}>
                  <div
                    style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => { handleExportHTML(); setHtmlExportMenuOpen(false); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,200,.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >{t('config_parser.export_html_this_device')}</div>
                  <div
                    style={{ padding: '7px 12px', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => { handleExportAllHTML(); setHtmlExportMenuOpen(false); }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,200,.08)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >{t('config_parser.export_html_all_devices')} ({devices.length})</div>
                </div>
              )}
            </div>
          )}
        </div>
        </div>}
      </div>

      {showRelationships && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('config_parser.relationships_title')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {visibleLinks.length > 0 && (
                <button className="btn btn-sm" onClick={() => setShowDiagram(true)}>{t('config_parser.show_diagram')}</button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={copyReconText}>
                {reconCopied === 'recon' ? t('common.copied') : t('common.copy_all')}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setShowRelationships(false)}>{t('common.close')}</button>
            </div>
          </div>
          {visibleLinks.length === 0 ? (
            <div className="hint" style={{ marginTop: 10 }}>
              {recon.links.length === 0 ? t('config_parser.no_relationships') : t('config_parser.all_removed')}
            </div>
          ) : (
            <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {visibleLinks.map((l) => (
                <div key={l.key} className="row" style={{ alignItems: 'flex-start', gap: 10, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <ConfidenceBadge level={l.confidence} t={t} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>
                      <code>{l.aLabel}{l.aIntf ? ` ${l.aIntf}` : ''}</code>
                      <span style={{ color: 'var(--muted)', margin: '0 6px' }}>↔</span>
                      <code>{l.bLabel}{l.bIntf ? ` ${l.bIntf}` : ''}</code>
                    </div>
                    <ul style={{ margin: '4px 0 0', paddingLeft: 16, fontSize: 12, color: 'var(--muted)' }}>
                      {l.evidence.map((e, ei) => <li key={ei}>{e.detail}</li>)}
                    </ul>
                  </div>
                  <button
                    className="btn btn-ghost btn-sm"
                    title={t('config_parser.remove_relationship')}
                    onClick={() => removeLink(l.key)}
                  >×</button>
                </div>
              ))}
            </div>
          )}
          {removedVisible.length > 0 && (
            <div style={{ marginTop: 14, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <div className="label" style={{ fontSize: 12, marginBottom: 6 }}>
                {t('config_parser.removed_relationships')} ({removedVisible.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {removedVisible.map((l) => (
                  <div key={l.key} className="row" style={{ alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <code>{l.aLabel}{l.aIntf ? ` ${l.aIntf}` : ''}</code> ↔ <code>{l.bLabel}{l.bIntf ? ` ${l.bIntf}` : ''}</code>
                    </span>
                    <button className="btn btn-ghost btn-sm" onClick={() => restoreLink(l.key)}>{t('config_parser.restore')}</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {showDiagram && (
        <RelationshipDiagramModal
          nodes={recon.nodes}
          links={visibleLinks}
          onClose={() => setShowDiagram(false)}
          t={t}
        />
      )}

      {parseError && <div className="card"><Err msg={parseError} /></div>}

      {analysis && (
        <>
          <div className="card">
            <div className="card-title">{t('config_parser.summary_title')}</div>
            <div className="result-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(max-content,1fr))' }}>
              {analysis.counts.hostname && <ResultItem label={t('config_parser.stat_host')} value={analysis.counts.hostname} />}
              <ResultItem label={t('config_parser.stat_vendor')} value={analysis.vendor} />
              <ResultItem label={t('config_parser.stat_physicals')} value={analysis.counts.physicals} />
              <ResultItem label={t('config_parser.stat_aggregates')} value={analysis.counts.aggregates} />
              <ResultItem label={t('config_parser.stat_units')} value={analysis.counts.logicalUnits} />
              <ResultItem label={t('config_parser.stat_vlans')} value={analysis.counts.vlans} />
              <ResultItem label={t('config_parser.stat_vrfs')} value={analysis.counts.vrfs} />
              {hasFW && <ResultItem label={t('config_parser.stat_firewall')} value={analysis.counts.firewallRules} />}
              {!!analysis.counts.ntp && <ResultItem label={t('config_parser.stat_ntp')} value={analysis.counts.ntp} />}
              {!!analysis.counts.tacacs && <ResultItem label={t('config_parser.stat_tacacs')} value={analysis.counts.tacacs} />}
              {!!analysis.counts.radius && <ResultItem label={t('config_parser.stat_radius')} value={analysis.counts.radius} />}
              {!!analysis.counts.syslog && <ResultItem label={t('config_parser.stat_syslog')} value={analysis.counts.syslog} />}
              {isNxos && !!analysis.counts.features && <ResultItem label={t('config_parser.stat_features')} value={analysis.counts.features} />}
              {isNxos && !!analysis.counts.fex && <ResultItem label={t('config_parser.stat_fex')} value={analysis.counts.fex} />}
              {isNxos && sys && sys.vpc && <ResultItem label="vPC" value={sys.vpc.domain} />}
              {isNxos && sys && sys.nbm && sys.nbm.enabled && <ResultItem label="NBM" value={sys.nbm.flowPolicies.length || '✓'} />}
            </div>
          </div>

          <div className="card">
            {devices.length > 1 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={activeIdx === 0}
                  onClick={() => setActiveIdx(activeIdx - 1)}
                  style={{ padding: '2px 10px', fontSize: 16, lineHeight: 1 }}
                >‹</button>
                <span style={{ fontSize: 13, color: 'var(--muted)', flex: 1, textAlign: 'center', fontWeight: 500 }}>
                  {displayName(devices[activeIdx])}
                  <span style={{ marginLeft: 6, fontSize: 11, opacity: .6 }}>({activeIdx + 1}/{devices.length})</span>
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={activeIdx === devices.length - 1}
                  onClick={() => setActiveIdx(activeIdx + 1)}
                  style={{ padding: '2px 10px', fontSize: 16, lineHeight: 1 }}
                >›</button>
              </div>
            )}
            <div className="btn-row" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
              {[
                ['interfaces', t('config_parser.tab_interfaces')],
                ['lags', t('config_parser.tab_lags')],
                ['vlans', t('config_parser.tab_vlans')],
                ['vrfs', t('config_parser.tab_vrfs')],
                ...(hasFW ? [['firewall', t('config_parser.tab_firewall')]] : []),
                ...(hasSystem ? [['system', t('config_parser.tab_system')]] : []),
              ].map(([k, label]) => (
                <button key={k} className={`btn btn-sm ${tab === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>{label}</button>
              ))}
              <div style={{ position: 'relative', flex: 1, maxWidth: 260, marginLeft: 'auto' }}>
                <input
                  className="input"
                  style={{ width: '100%', paddingRight: filterText ? 28 : undefined, boxSizing: 'border-box' }}
                  placeholder={t('common.filter') + '…'}
                  value={filterText}
                  onChange={e => setFilterText(e.target.value)}
                />
                {filterText && (
                  <button
                    onClick={() => setFilterText('')}
                    style={{ position: 'absolute', right: 6, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', fontSize: 14, lineHeight: 1, padding: '0 2px' }}
                    aria-label="Clear filter"
                  >×</button>
                )}
              </div>
            </div>

            {tab === 'interfaces' && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {[t('config_parser.col_iface'), t('config_parser.col_vrf'), t('config_parser.col_mode'), t('config_parser.col_vlan'), t('config_parser.col_ipv4'), t('config_parser.col_ipv6'), t('config_parser.col_description')].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUnits.map((u, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>
                          {u.ifkey}
                          {u.isAgg && <Pill color="purple">LAG</Pill>}
                          {u.isIrb && <Pill color="blue">SVI</Pill>}
                        </td>
                        <td style={{ padding: '6px 10px', fontSize: 12 }}>{u.vrf || '—'}</td>
                        <td style={{ padding: '6px 10px', fontSize: 12 }}>{u.mode || (u.vlanId ? 'subif' : '—')}</td>
                        <td style={{ padding: '6px 10px', fontSize: 12, fontFamily: 'monospace' }}>
                          {u.vlanId && <Pill color="cyan">{u.vlanId}</Pill>}
                          {(u.vlanMembers || []).map(v => <Pill key={v} color="green">{v}</Pill>)}
                          {!u.vlanId && !(u.vlanMembers || []).length && '—'}
                        </td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{u.ipv4.length ? u.ipv4.join(', ') : '—'}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{u.ipv6.length ? u.ipv6.join(', ') : '—'}</td>
                        <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12 }}>{u.description || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!filteredUnits.length && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>{t('config_parser.no_results')}</div>}
              </div>
            )}

            {tab === 'lags' && (
              <div>
                {!analysis.aggregates.length && <div style={{ padding: 16, color: 'var(--muted)' }}>{t('config_parser.no_lags')}</div>}
                {analysis.aggregates.filter(a => matches(a.name) || a.members.some(matches) || matches(a.description)).map(a => (
                  <div key={a.name} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <code style={{ fontWeight: 600 }}>{a.name}</code>
                      <Pill color="purple">LACP {a.lacpMode}</Pill>
                      {a.periodic && <Pill color="cyan">{a.periodic}</Pill>}
                      {a.minLinks !== undefined && a.minLinks !== '' && <Pill color="yellow">min-links {a.minLinks}</Pill>}
                      {a.description && <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 'auto' }}>{a.description}</span>}
                    </div>
                    <div style={{ paddingLeft: 14, fontSize: 13 }}>
                      <span style={{ color: 'var(--muted)' }}>{t('config_parser.members')}: </span>
                      {a.members.length ? a.members.map(m => <code key={m} style={{ marginRight: 8 }}>{m}</code>) : <em style={{ color: 'var(--muted)' }}>{t('config_parser.no_members')}</em>}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {tab === 'vlans' && (
              <div style={{ overflowX: 'auto' }}>
                {!analysis.vlans.length && <div style={{ padding: 16, color: 'var(--muted)' }}>{t('config_parser.no_vlans')}</div>}
                {analysis.vlans.length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {[t('config_parser.col_vlan_name'), t('config_parser.col_vlan_id'), t('config_parser.col_l3'), t('config_parser.col_members'), t('config_parser.col_description')].map(h => (
                          <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 600 }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {analysis.vlans.filter(v => matches(v.name) || matches(v.id) || matches(v.l3Interface) || v.members.some(m => matches(m.ifkey))).map(v => (
                        <tr key={v.name + ':' + v.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{v.name}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{v.id || '—'}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{v.l3Interface || '—'}</td>
                          <td style={{ padding: '6px 10px', fontSize: 12 }}>
                            {v.members.length ? v.members.map((m, i) => <Pill key={i} color={m.mode === 'trunk' ? 'blue' : 'green'}>{m.ifkey}</Pill>) : '—'}
                          </td>
                          <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12 }}>{v.description || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            )}

            {tab === 'vrfs' && (
              <div>
                {analysis.vrfs.filter(v => matches(v.name) || matches(v.type) || matches(v.rd) || matches(v.vrfTarget) || v.interfaces.some(matches)).map(vrf => (
                  <div key={vrf.name} style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8, marginBottom: 10 }}>
                    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                      <code style={{ fontWeight: 600, fontSize: 14 }}>{vrf.name}</code>
                      <Pill color={vrf.type === 'vrf' ? 'green' : (vrf.type === 'default' ? 'cyan' : 'yellow')}>{vrf.type}</Pill>
                      {vrf.rd && <Pill color="blue">RD {vrf.rd}</Pill>}
                      {vrf.vrfTarget && <Pill color="blue">RT {vrf.vrfTarget}</Pill>}
                      {vrf.description && <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 'auto' }}>{vrf.description}</span>}
                    </div>
                    <div style={{ paddingLeft: 12, fontSize: 13, marginBottom: 6 }}>
                      <span style={{ color: 'var(--muted)' }}>{t('config_parser.col_iface')}: </span>
                      {vrf.interfaces.length ? vrf.interfaces.map(i => <code key={i} style={{ marginRight: 8 }}>{i}</code>) : <em style={{ color: 'var(--muted)' }}>—</em>}
                    </div>
                    {vrf.protocols.length > 0 && (
                      <div style={{ paddingLeft: 12, fontSize: 13 }}>
                        <span style={{ color: 'var(--muted)' }}>{t('config_parser.protocols')}: </span>
                        <div style={{ marginTop: 4, display: 'flex', flexDirection: 'column', gap: 4 }}>
                          {vrf.protocols.map((p, i) => (
                            <div key={i} style={{ fontSize: 12 }}>
                              <Pill color="purple">{p.proto}</Pill>
                              {(p.proto === 'ospf' || p.proto === 'ospf3') && (
                                (p.areas || []).length ? p.areas.map(a => <span key={a.area} style={{ marginRight: 10 }}>area {a.area} ({(a.interfaces || []).length} {t('config_parser.ifaces_abbr')})</span>) : <em style={{ color: 'var(--muted)' }}>—</em>
                              )}
                              {p.proto === 'bgp' && (p.groups || []).map(g => (
                                <span key={g.name} style={{ marginRight: 10 }}>
                                  <code>{g.name}</code> ({g.type || '—'}{g.peerAs ? `, AS ${g.peerAs}` : ''}, {g.neighbors.length} {t('config_parser.neighbors_abbr')})
                                </span>
                              ))}
                              {['isis', 'ldp', 'rsvp', 'mpls', 'pim', 'router-advertisement'].includes(p.proto) && (
                                <span style={{ color: 'var(--muted)' }}>{(p.interfaces || []).length} {t('config_parser.ifaces_abbr')}</span>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {tab === 'system' && hasSystem && sys && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {(analysis.counts.hostname || sys.domain || sys.banner) && (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>{t('config_parser.sys_identity')}</div>
                    {analysis.counts.hostname && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>hostname:</span> <code>{analysis.counts.hostname}</code></div>}
                    {sys.domain && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>domain:</span> <code>{sys.domain}</code></div>}
                    {sys.banner && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>banner:</span> <Pill color="cyan">{sys.banner}</Pill></div>}
                  </div>
                )}

                {isNxos && (sys.features.length > 0 || sys.vpc || (sys.nbm && sys.nbm.enabled) || sys.fex.length > 0) && (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>{t('config_parser.sys_platform')}</div>
                    {sys.features.length > 0 && (
                      <div style={{ marginBottom: 6, fontSize: 13 }}>
                        <span style={{ color: 'var(--muted)' }}>features: </span>
                        {sys.features.map(f => <Pill key={f} color="purple">{f}</Pill>)}
                      </div>
                    )}
                    {sys.vpc && (
                      <div style={{ marginBottom: 6, fontSize: 13 }}>
                        <span style={{ color: 'var(--muted)' }}>vPC: </span>
                        <Pill color="blue">domain {sys.vpc.domain}</Pill>
                        {sys.vpc.priority && <Pill color="cyan">prio {sys.vpc.priority}</Pill>}
                        {sys.vpc.peerKeepalive && <Pill color="yellow">keepalive {sys.vpc.peerKeepalive}</Pill>}
                        {sys.vpc.peerLink && <Pill color="green">peer-link {sys.vpc.peerLink}</Pill>}
                        {sys.vpc.autoRecovery && <Pill color="cyan">auto-recovery</Pill>}
                      </div>
                    )}
                    {sys.nbm && sys.nbm.enabled && (
                      <div style={{ marginBottom: 6, fontSize: 13 }}>
                        <span style={{ color: 'var(--muted)' }}>NBM: </span>
                        <Pill color="green">enabled</Pill>
                        {sys.nbm.flowPolicies.map(p => <Pill key={p.name} color="blue">{p.name}{p.flows ? ` (${p.flows} flows)` : ''}</Pill>)}
                      </div>
                    )}
                    {sys.fex.length > 0 && (
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: 'var(--muted)' }}>FEX: </span>
                        {sys.fex.map(f => <span key={f.id} style={{ marginRight: 10 }}><code>fex-{f.id}</code> {f.type && <span style={{ color: 'var(--muted)', fontSize: 12 }}>{f.type}</span>} {f.description && <span style={{ color: 'var(--muted)', fontSize: 12 }}>— {f.description}</span>}</span>)}
                      </div>
                    )}
                  </div>
                )}

                {(sys.ntp.length > 0 || sys.dns.length > 0) && (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>{t('config_parser.sys_timedns')}</div>
                    {sys.ntp.length > 0 && (
                      <div style={{ fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: 'var(--muted)' }}>NTP: </span>
                        {sys.ntp.map((n, i) => <Pill key={i} color={n.prefer ? 'green' : 'cyan'}>{n.server}{n.prefer && ' ★'}{n.vrf && ` (vrf ${n.vrf})`}</Pill>)}
                      </div>
                    )}
                    {sys.dns.length > 0 && (
                      <div style={{ fontSize: 13 }}>
                        <span style={{ color: 'var(--muted)' }}>DNS: </span>
                        {sys.dns.map((d, i) => <Pill key={i} color="cyan">{d.server}{d.vrf && ` (vrf ${d.vrf})`}</Pill>)}
                      </div>
                    )}
                  </div>
                )}

                {(sys.aaa.tacacs.length > 0 || sys.aaa.radius.length > 0 || sys.aaa.newModel || sys.aaa.methods.length > 0) && (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>{t('config_parser.sys_aaa')}</div>
                    {sys.aaa.newModel && <div style={{ fontSize: 13, marginBottom: 4 }}><Pill color="green">aaa new-model</Pill></div>}
                    {sys.aaa.tacacs.length > 0 && (
                      <div style={{ fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: 'var(--muted)' }}>TACACS+: </span>
                        {sys.aaa.tacacs.filter(t => matches(t.host) || matches(t.name)).map((t2, i) => (
                          <Pill key={i} color="purple">{t2.host || t2.name}{t2.name && t2.host && ` "${t2.name}"`}{t2.vrf && ` (vrf ${t2.vrf})`}{t2.key && ' 🔑'}</Pill>
                        ))}
                      </div>
                    )}
                    {sys.aaa.radius.length > 0 && (
                      <div style={{ fontSize: 13, marginBottom: 4 }}>
                        <span style={{ color: 'var(--muted)' }}>RADIUS: </span>
                        {sys.aaa.radius.filter(r => matches(r.host) || matches(r.name)).map((r2, i) => (
                          <Pill key={i} color="blue">{r2.host || r2.name}{r2.name && r2.host && ` "${r2.name}"`}{r2.authPort && ` :${r2.authPort}`}{r2.key && ' 🔑'}</Pill>
                        ))}
                      </div>
                    )}
                    {sys.aaa.methods.length > 0 && (
                      <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                        methods: {sys.aaa.methods.map((m, i) => <code key={i} style={{ marginRight: 6 }}>{m}</code>)}
                      </div>
                    )}
                  </div>
                )}

                {sys.syslog.length > 0 && (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>{t('config_parser.sys_logging')}</div>
                    {sys.syslog.filter(s => matches(s.host)).map((s, i) => (
                      <div key={i} style={{ fontSize: 13 }}><Pill color="yellow">{s.host}</Pill>{s.vrf && <span style={{ color: 'var(--muted)' }}> vrf {s.vrf}</span>}{s.severity && <span style={{ color: 'var(--muted)' }}> sev {s.severity}</span>}{s.transport && <span style={{ color: 'var(--muted)' }}> {s.transport}</span>}</div>
                    ))}
                  </div>
                )}

                {(sys.snmp.communities.length > 0 || sys.snmp.hosts.length > 0 || sys.snmp.users.length > 0) && (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>SNMP</div>
                    {sys.snmp.communities.length > 0 && <div style={{ fontSize: 13, marginBottom: 4 }}><span style={{ color: 'var(--muted)' }}>communities: </span>{sys.snmp.communities.map((c, i) => <Pill key={i} color="cyan">{c.name} ({c.access})</Pill>)}</div>}
                    {sys.snmp.hosts.length > 0 && <div style={{ fontSize: 13, marginBottom: 4 }}><span style={{ color: 'var(--muted)' }}>trap-hosts: </span>{sys.snmp.hosts.map((h2, i) => <Pill key={i} color="blue">{h2.host} v{h2.version}</Pill>)}</div>}
                    {sys.snmp.users.length > 0 && <div style={{ fontSize: 13 }}><span style={{ color: 'var(--muted)' }}>users: </span>{sys.snmp.users.map((u, i) => <Pill key={i} color="purple">{u.name}{u.group && ` (${u.group})`}</Pill>)}</div>}
                  </div>
                )}

                {sys.users.length > 0 && (
                  <div style={{ padding: 10, border: '1px solid var(--border)', borderRadius: 8 }}>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 6 }}>{t('config_parser.sys_users')}</div>
                    <div style={{ fontSize: 13 }}>
                      {sys.users.filter(u => matches(u.name)).map((u, i) => <Pill key={i} color="green">{u.name}{u.privilege && ` (${u.privilege})`}</Pill>)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab === 'firewall' && hasFW && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['#', t('config_parser.col_rule_name'), t('config_parser.col_from'), t('config_parser.col_to'), t('config_parser.col_source'), t('config_parser.col_destination'), t('config_parser.col_service'), t('config_parser.col_action'), 'Log'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {analysis.firewallRules.filter(r => matches(r.name) || matches(r.source) || matches(r.destination) || matches(r.service) || matches(r.action) || matches(r.fromZone) || matches(r.toZone)).map((r, i) => {
                      const isDeny = /deny|reject|drop/i.test(r.action);
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', color: 'var(--muted)' }}>{r.id || i + 1}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{r.name}</td>
                          <td style={{ padding: '6px 10px', fontSize: 12 }}>{r.fromZone || '—'}</td>
                          <td style={{ padding: '6px 10px', fontSize: 12 }}>{r.toZone || '—'}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{r.source}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{r.destination}</td>
                          <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{r.service}</td>
                          <td style={{ padding: '6px 10px', fontSize: 12 }}>
                            <Pill color={isDeny ? 'red' : 'green'}>{r.action}</Pill>
                          </td>
                          <td style={{ padding: '6px 10px', fontSize: 12 }}>{r.log ? '✓' : '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

window.ConfigParser = ConfigParser;
