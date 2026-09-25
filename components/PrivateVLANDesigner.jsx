const { useState, useEffect, useMemo, useRef, useCallback } = React;

// <pvlan-core>
const PVD_VENDORS = ['ios', 'nxos', 'eos', 'junos-els', 'junos-legacy'];
const PVD_ROLES   = ['promisc', 'host', 'trunk', 'ptrunk', 'strunk'];
const PVD_MAX_SECS = 16, PVD_MAX_PORTS = 48;

function pvdVlan(s) {
  const v = String(s ?? '').trim();
  if (!/^\d{1,4}$/.test(v)) return null;
  const n = +v;
  if (n < 2 || n > 4094 || (n >= 1002 && n <= 1005)) return null;
  return n;
}
function pvdCidr(s) {
  const m = String(s || '').trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!m) return null;
  const o = m.slice(1, 5).map(Number), len = +m[5];
  if (o.some(x => x > 255) || len < 1 || len > 30) return null;
  const maskInt = len === 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0;
  const mask = [24, 16, 8, 0].map(sh => (maskInt >>> sh) & 255).join('.');
  return { ip: o.join('.'), len, mask };
}
function pvdIfName(vendor, n) {
  if (vendor === 'ios') return 'GigabitEthernet1/0/' + n;
  if (vendor === 'nxos') return 'Ethernet1/' + n;
  if (vendor === 'eos') return 'Ethernet' + n;
  return 'ge-0/0/' + (n - 1);
}
function pvdJName(name, vlan) {
  const s = String(name || '').trim().replace(/[^A-Za-z0-9_-]/g, '-');
  return s || ('PVLAN-' + vlan);
}
/** Unique Junos VLAN names for primary + secondaries. On collision, append -<vlan-id>. */
function pvdJNames(primary, secs) {
  const entries = [];
  const P = pvdVlan(primary && primary.vlan);
  entries.push({ key: 'p', vlan: P, base: pvdJName(primary && primary.name, P) });
  for (const s of (Array.isArray(secs) ? secs : [])) {
    const v = pvdVlan(s.vlan);
    entries.push({ key: 's:' + s.uid, vlan: v, base: pvdJName(s.name, v) });
  }
  const used = new Set();
  const map = new Map();
  for (const e of entries) {
    let name = e.base;
    if (used.has(name)) {
      name = e.base + '-' + e.vlan;
      let i = 2;
      while (used.has(name)) {
        name = e.base + '-' + e.vlan + '-' + i;
        i++;
      }
    }
    used.add(name);
    map.set(e.key, name);
  }
  return map;
}
/** Shared shape check for JSON import and share-URL hydration. */
function pvdValidShape(data) {
  if (!data || typeof data !== 'object') return false;
  if (!data.primary || typeof data.primary !== 'object') return false;
  if (!Array.isArray(data.secs) || !Array.isArray(data.ports)) return false;
  if (!data.secs.every(s => s && typeof s === 'object' && s.uid != null && s.vlan != null && (s.type === 'isolated' || s.type === 'community'))) return false;
  if (!data.ports.every(p => p && typeof p === 'object' && p.uid != null && p.ifc != null && PVD_ROLES.includes(p.role))) return false;
  return true;
}
function pvdKind(port, secs) {
  if (port.role === 'promisc' || port.role === 'ptrunk') return 'P';
  if (port.role === 'trunk') return null;
  const s = secs.find(x => x.uid === port.sec);
  if (!s) return null;
  if (port.role === 'strunk') return s.type === 'isolated' ? 'I' : null;
  return s.type === 'isolated' ? 'I' : 'C:' + s.uid;
}
function pvdReach(ka, kb) {
  if (ka === 'P' || kb === 'P') return { allow: true, reason: 'promisc' };
  if (ka === 'I' && kb === 'I') return { allow: false, reason: 'iso_iso' };
  if (ka === 'I' || kb === 'I') return { allow: false, reason: 'iso_comm' };
  return ka === kb ? { allow: true, reason: 'same_comm' } : { allow: false, reason: 'diff_comm' };
}

function pvdAudit(d) {
  const out = [];
  const primary = d.primary || {};
  const secs = (Array.isArray(d.secs) ? d.secs : []).filter(Boolean);
  const ports = (Array.isArray(d.ports) ? d.ports : []).filter(Boolean);
  const vendor = d.vendor;
  const vtp = d.vtp;

  const P = pvdVlan(primary.vlan);
  if (P === null) out.push({ level: 'err', key: 'err_primary_vlan', vars: {} });

  const vlanIds = [];
  if (P !== null) vlanIds.push(P);
  for (const s of secs) {
    const v = pvdVlan(s.vlan);
    if (v === null) {
      out.push({ level: 'err', key: 'err_sec_vlan', vars: { name: (s.name && String(s.name).trim()) || ('#' + s.uid) } });
    } else {
      vlanIds.push(v);
    }
  }
  const seen = new Set();
  for (const v of vlanIds) {
    if (seen.has(v)) {
      out.push({ level: 'err', key: 'err_vlan_dup', vars: { vlan: String(v) } });
      break;
    }
    seen.add(v);
  }

  if (secs.length === 0) out.push({ level: 'err', key: 'err_no_secondary', vars: {} });

  const isoCount = secs.filter(s => s.type === 'isolated').length;
  if (isoCount > 1) out.push({ level: 'err', key: 'err_multi_isolated', vars: { n: isoCount } });

  if (String(primary.svi || '').trim() !== '' && !pvdCidr(primary.svi)) {
    out.push({ level: 'err', key: 'err_svi', vars: {} });
  }

  if (ports.some(p => !String(p.ifc || '').trim())) {
    out.push({ level: 'err', key: 'err_ifc_empty', vars: {} });
  }

  const ifcSeen = new Map();
  for (const p of ports) {
    const key = String(p.ifc || '').trim().toLowerCase();
    if (!key) continue;
    if (ifcSeen.has(key)) {
      out.push({ level: 'err', key: 'err_ifc_dup', vars: { ifc: String(p.ifc).trim() } });
      break;
    }
    ifcSeen.set(key, true);
  }

  for (const p of ports) {
    if (p.role === 'host') {
      const s = secs.find(x => x.uid === p.sec);
      if (!s) out.push({ level: 'err', key: 'err_host_sec', vars: { ifc: String(p.ifc || '').trim() || '#' + p.uid } });
    }
    if (p.role === 'strunk') {
      const s = secs.find(x => x.uid === p.sec);
      if (!s || s.type !== 'isolated') {
        out.push({ level: 'err', key: 'err_strunk_sec', vars: { ifc: String(p.ifc || '').trim() || '#' + p.uid } });
      }
    }
  }

  if (ports.length === 0) out.push({ level: 'err', key: 'err_no_ports', vars: {} });

  // Warnings
  if (vendor === 'ios' && vtp === 'v1v2') out.push({ level: 'warn', key: 'warn_vtp', vars: {} });

  const hasGw = ports.some(p => p.role === 'promisc' || p.role === 'ptrunk');
  const sviBlank = String(primary.svi || '').trim() === '';
  if (!hasGw && sviBlank) out.push({ level: 'warn', key: 'warn_no_gateway', vars: {} });

  for (const s of secs) {
    if (s.type !== 'community') continue;
    if (!ports.some(p => p.role === 'host' && p.sec === s.uid)) {
      out.push({ level: 'warn', key: 'warn_empty_comm', vars: { name: (s.name && String(s.name).trim()) || ('#' + s.uid) } });
    }
  }

  if (ports.some(p => p.role === 'trunk')) out.push({ level: 'warn', key: 'warn_trunk', vars: {} });

  if (ports.some(p => p.role === 'ptrunk') && (vendor === 'eos' || vendor === 'junos-els' || vendor === 'junos-legacy')) {
    out.push({ level: 'warn', key: 'warn_ptrunk_vendor', vars: {} });
  }
  if (ports.some(p => p.role === 'strunk') && (vendor === 'junos-els' || vendor === 'junos-legacy')) {
    out.push({ level: 'warn', key: 'warn_strunk_vendor', vars: {} });
  }
  if (ports.some(p => p.role === 'ptrunk' || p.role === 'strunk') && vendor === 'ios') {
    out.push({ level: 'warn', key: 'warn_pvlan_trunk_ios', vars: {} });
  }
  if (!sviBlank && pvdCidr(primary.svi)) out.push({ level: 'warn', key: 'warn_proxy_arp', vars: {} });

  if (vendor === 'nxos') {
    const reserved = vlanIds.some(v => v >= 3968 && v <= 4094);
    if (reserved) out.push({ level: 'warn', key: 'warn_nxos_reserved', vars: {} });
  }

  const junosRe = /^([a-z]{2,3}-\d+\/\d+\/\d+(:\d+)?|ae\d+)$/;
  const isJunos = vendor === 'junos-els' || vendor === 'junos-legacy';
  for (const p of ports) {
    const ifc = String(p.ifc || '').trim();
    if (!ifc) continue;
    const looksJunos = junosRe.test(ifc);
    if ((isJunos && !looksJunos) || (!isJunos && looksJunos)) {
      out.push({ level: 'warn', key: 'warn_ifc_vendor', vars: { ifc } });
      break;
    }
  }

  if (isJunos) {
    const bases = [pvdJName(primary.name, P)];
    for (const s of secs) bases.push(pvdJName(s.name, pvdVlan(s.vlan)));
    const seenJ = new Set();
    for (const n of bases) {
      if (seenJ.has(n)) {
        out.push({ level: 'warn', key: 'warn_jname_dup', vars: { name: n } });
        break;
      }
      seenJ.add(n);
    }
  }

  const hasErr = out.some(x => x.level === 'err');
  if (!hasErr) {
    if (isoCount === 1) out.push({ level: 'ok', key: 'ok_single_isolated', vars: {} });
    if (!sviBlank && pvdCidr(primary.svi)) out.push({ level: 'ok', key: 'ok_svi_primary', vars: {} });
    if (vendor === 'ios' && vtp === 'v3') out.push({ level: 'ok', key: 'ok_vtp3', vars: {} });
  }

  return out;
}

function pvdEmit(d, tr) {
  const empty = { text: '', sections: { vlans: '', ports: '', svi: '' } };
  const findings = pvdAudit(d);
  if (findings.some(x => x.level === 'err')) return empty;

  const vendor = d.vendor;
  const primary = d.primary || {};
  const secs = Array.isArray(d.secs) ? d.secs : [];
  const ports = Array.isArray(d.ports) ? d.ports : [];
  const P = pvdVlan(primary.vlan);
  const S = secs
    .map(s => ({ ...s, _v: pvdVlan(s.vlan) }))
    .filter(s => s._v !== null)
    .sort((a, b) => a._v - b._v);
  const iso = S.find(s => s.type === 'isolated');
  const all = S.map(s => s._v).join(',');
  const allWithP = [P, ...S.map(s => s._v)].join(',');
  const svi = pvdCidr(primary.svi);
  const vendorLabel = d.vendorLabel || vendor;
  const isJunos = vendor === 'junos-els' || vendor === 'junos-legacy';
  const cpfx = isJunos ? '#' : '!';
  const cmt = (s) => cpfx + ' ' + s;
  const family = vendor === 'junos-els' || vendor === 'junos-legacy' ? 'junos' : vendor;

  const L = [];
  const secL = { vlans: [], ports: [], svi: [] };
  let cur = 'vlans';
  const push = (s) => { L.push(s); secL[cur].push(s); };
  const blank = () => push(cpfx === '#' ? '#' : '!');

  push(cmt(tr('cmt_header', { vendor: vendorLabel, vlan: P })));

  const emitIos = () => {
    if (d.vtp === 'v1v2') push('vtp mode transparent');
    blank();
    for (const s of S) {
      push('vlan ' + s._v);
      if (String(s.name || '').trim()) push(' name ' + String(s.name).trim());
      push(' private-vlan ' + s.type);
      blank();
    }
    push('vlan ' + P);
    if (String(primary.name || '').trim()) push(' name ' + String(primary.name).trim());
    push(' private-vlan primary');
    push(' private-vlan association ' + all);
    blank();
    cur = 'ports';
    for (const p of ports) {
      const ifc = String(p.ifc || '').trim();
      const desc = String(p.name || '').trim();
      push('interface ' + ifc);
      if (desc) push(' description ' + desc);
      if (p.role === 'promisc') {
        push(' switchport mode private-vlan promiscuous');
        push(' switchport private-vlan mapping ' + P + ' ' + all);
      } else if (p.role === 'host') {
        const sec = S.find(x => x.uid === p.sec);
        push(' switchport mode private-vlan host');
        push(' switchport private-vlan host-association ' + P + ' ' + sec._v);
      } else if (p.role === 'trunk') {
        push(' switchport mode trunk');
        push(' switchport trunk allowed vlan ' + allWithP);
      } else if (p.role === 'ptrunk') {
        push(cmt(tr('cmt_pvlan_trunk_platform')));
        push(' switchport mode private-vlan trunk promiscuous');
        push(' switchport private-vlan mapping trunk ' + P + ' ' + all);
      } else if (p.role === 'strunk') {
        push(cmt(tr('cmt_pvlan_trunk_platform')));
        push(' switchport mode private-vlan trunk secondary');
        push(' switchport private-vlan association trunk ' + P + ' ' + iso._v);
      }
      blank();
    }
    if (svi) {
      cur = 'svi';
      push('interface Vlan' + P);
      push(' ip address ' + svi.ip + ' ' + svi.mask);
      push(' private-vlan mapping ' + all);
      push(' no shutdown');
    }
  };

  const emitNxos = () => {
    push(cmt(tr('cmt_nxos_vtp')));
    push('feature private-vlan');
    if (svi) push('feature interface-vlan');
    blank();
    for (const s of S) {
      push('vlan ' + s._v);
      if (String(s.name || '').trim()) push('  name ' + String(s.name).trim());
      push('  private-vlan ' + s.type);
      blank();
    }
    push('vlan ' + P);
    if (String(primary.name || '').trim()) push('  name ' + String(primary.name).trim());
    push('  private-vlan primary');
    push('  private-vlan association ' + all);
    blank();
    cur = 'ports';
    for (const p of ports) {
      const ifc = String(p.ifc || '').trim();
      const desc = String(p.name || '').trim();
      push('interface ' + ifc);
      push('  switchport');
      if (desc) push('  description ' + desc);
      if (p.role === 'promisc') {
        push('  switchport mode private-vlan promiscuous');
        push('  switchport private-vlan mapping ' + P + ' ' + all);
      } else if (p.role === 'host') {
        const sec = S.find(x => x.uid === p.sec);
        push('  switchport mode private-vlan host');
        push('  switchport private-vlan host-association ' + P + ' ' + sec._v);
      } else if (p.role === 'trunk') {
        push('  switchport mode trunk');
        push('  switchport trunk allowed vlan ' + allWithP);
      } else if (p.role === 'ptrunk') {
        push('  switchport mode private-vlan trunk promiscuous');
        push('  switchport private-vlan mapping trunk ' + P + ' ' + all);
      } else if (p.role === 'strunk') {
        push('  switchport mode private-vlan trunk secondary');
        push('  switchport private-vlan association trunk ' + P + ' ' + iso._v);
      }
      blank();
    }
    if (svi) {
      cur = 'svi';
      push('interface Vlan' + P);
      push('  private-vlan mapping ' + all);
      push('  ip address ' + svi.ip + '/' + svi.len);
      push('  no shutdown');
    }
  };

  const emitEos = () => {
    push('vlan ' + P);
    if (String(primary.name || '').trim()) push('   name ' + String(primary.name).trim());
    blank();
    for (const s of S) {
      push('vlan ' + s._v);
      if (String(s.name || '').trim()) push('   name ' + String(s.name).trim());
      push('   private-vlan ' + s.type + ' primary vlan ' + P);
      blank();
    }
    cur = 'ports';
    for (const p of ports) {
      const ifc = String(p.ifc || '').trim();
      const desc = String(p.name || '').trim();
      push('interface ' + ifc);
      if (desc) push('   description ' + desc);
      if (p.role === 'promisc') {
        push('   switchport access vlan ' + P);
      } else if (p.role === 'host') {
        const sec = S.find(x => x.uid === p.sec);
        push('   switchport access vlan ' + sec._v);
      } else if (p.role === 'trunk') {
        push('   switchport mode trunk');
        push('   switchport trunk allowed vlan ' + allWithP);
      } else if (p.role === 'ptrunk') {
        push(cmt(tr('cmt_eos_ptrunk')));
        push('   switchport mode trunk');
        push('   switchport trunk allowed vlan ' + allWithP);
      } else if (p.role === 'strunk') {
        push('   switchport mode trunk');
        push('   switchport trunk allowed vlan ' + P + ',' + iso._v);
        push('   switchport trunk private-vlan secondary');
      }
      blank();
    }
    if (svi) {
      cur = 'svi';
      push('interface Vlan' + P);
      push('   ip address ' + svi.ip + '/' + svi.len);
      push('   pvlan mapping ' + all);
    }
  };

  const emitJunosEls = () => {
    const JN = pvdJNames(primary, S);
    const NP = JN.get('p');
    const jn = (s) => JN.get('s:' + s.uid);
    for (const s of S) {
      const N = jn(s);
      push('set vlans ' + N + ' vlan-id ' + s._v);
      push('set vlans ' + N + ' private-vlan ' + s.type);
    }
    push('set vlans ' + NP + ' vlan-id ' + P);
    if (iso) push('set vlans ' + NP + ' isolated-vlan ' + jn(iso));
    for (const s of S.filter(x => x.type === 'community')) {
      push('set vlans ' + NP + ' community-vlans ' + jn(s));
    }
    cur = 'ports';
    for (const p of ports) {
      const ifc = String(p.ifc || '').trim();
      const desc = String(p.name || '').trim().replace(/"/g, '');
      const SI = 'set interfaces ' + ifc + ' unit 0 family ethernet-switching ';
      if (desc) push('set interfaces ' + ifc + ' description "' + desc + '"');
      if (p.role === 'promisc' || p.role === 'ptrunk') {
        if (p.role === 'ptrunk') push(cmt(tr('cmt_junos_ptrunk')));
        push(SI + 'interface-mode trunk');
        push(SI + 'vlan members ' + NP);
      } else if (p.role === 'host') {
        const sec = S.find(x => x.uid === p.sec);
        push(SI + 'interface-mode access');
        push(SI + 'vlan members ' + jn(sec));
      } else if (p.role === 'trunk') {
        push(SI + 'interface-mode trunk inter-switch-link');
        push(SI + 'vlan members ' + NP);
      } else if (p.role === 'strunk') {
        push(cmt(tr('cmt_junos_strunk')));
      }
    }
    if (svi) {
      cur = 'svi';
      push(cmt(tr('cmt_junos_irb')));
      push('set vlans ' + NP + ' l3-interface irb.' + P);
      push('set interfaces irb unit ' + P + ' family inet address ' + svi.ip + '/' + svi.len);
    }
  };

  const emitJunosLegacy = () => {
    const JN = pvdJNames(primary, S);
    const NP = JN.get('p');
    const jn = (s) => JN.get('s:' + s.uid);
    push('set vlans ' + NP + ' vlan-id ' + P);
    push('set vlans ' + NP + ' no-local-switching');
    if (iso) push('set vlans ' + NP + ' isolation-id ' + iso._v);
    for (const s of S.filter(x => x.type === 'community')) {
      const N = jn(s);
      push('set vlans ' + N + ' vlan-id ' + s._v);
      push('set vlans ' + N + ' primary-vlan ' + NP);
    }
    cur = 'ports';
    for (const p of ports) {
      const ifc = String(p.ifc || '').trim();
      const desc = String(p.name || '').trim().replace(/"/g, '');
      if (desc) push('set interfaces ' + ifc + ' description "' + desc + '"');
      if (p.role === 'promisc' || p.role === 'ptrunk') {
        if (p.role === 'ptrunk') push(cmt(tr('cmt_junos_ptrunk')));
        push('set interfaces ' + ifc + ' unit 0 family ethernet-switching port-mode trunk');
        push('set vlans ' + NP + ' interface ' + ifc + '.0');
      } else if (p.role === 'host') {
        const sec = S.find(x => x.uid === p.sec);
        push('set interfaces ' + ifc + ' unit 0 family ethernet-switching port-mode access');
        if (sec.type === 'isolated') {
          push('set vlans ' + NP + ' interface ' + ifc + '.0');
        } else {
          push('set vlans ' + jn(sec) + ' interface ' + ifc + '.0');
        }
      } else if (p.role === 'trunk') {
        push('set interfaces ' + ifc + ' unit 0 family ethernet-switching port-mode trunk');
        push('set vlans ' + NP + ' interface ' + ifc + '.0 pvlan-trunk');
      } else if (p.role === 'strunk') {
        push(cmt(tr('cmt_junos_strunk')));
      }
    }
    if (svi) {
      cur = 'svi';
      push(cmt(tr('cmt_junos_legacy_svi')));
    }
  };

  if (vendor === 'ios') emitIos();
  else if (vendor === 'nxos') emitNxos();
  else if (vendor === 'eos') emitEos();
  else if (vendor === 'junos-els') emitJunosEls();
  else if (vendor === 'junos-legacy') emitJunosLegacy();

  // Verify hint belongs on the full text only — not a section copy.
  L.push(cmt(tr('cmt_verify_' + family)));

  return {
    text: L.join('\n'),
    sections: {
      vlans: secL.vlans.join('\n'),
      ports: secL.ports.join('\n'),
      svi: secL.svi.join('\n'),
    },
  };
}
// </pvlan-core>

const PVD_TABS = ['design', 'matrix', 'config'];
const PVD_VENDOR_LABELS = {
  ios: 'Cisco IOS / IOS-XE',
  nxos: 'Cisco NX-OS',
  eos: 'Arista EOS',
  'junos-els': 'Juniper Junos (ELS)',
  'junos-legacy': 'Juniper Junos (non-ELS)',
};
const PVD_PRESETS = {
  dmz: {
    primary: { vlan: '100', name: 'DMZ', svi: '192.0.2.1/24' },
    secs: [
      { uid: 1, vlan: '101', name: 'DMZ-ISO', type: 'isolated' },
      { uid: 2, vlan: '102', name: 'TENANT-A', type: 'community' },
      { uid: 3, vlan: '103', name: 'TENANT-B', type: 'community' },
    ],
    ports: [
      { n: 48, name: 'fw-uplink', role: 'promisc', sec: null },
      { n: 1, name: 'srv-iso-1', role: 'host', sec: 1 },
      { n: 2, name: 'tenant-a-1', role: 'host', sec: 2 },
      { n: 3, name: 'tenant-a-2', role: 'host', sec: 2 },
      { n: 4, name: 'tenant-b-1', role: 'host', sec: 3 },
    ],
  },
  hotel: {
    primary: { vlan: '300', name: 'GUEST', svi: '198.51.100.1/24' },
    secs: [{ uid: 1, vlan: '301', name: 'GUEST-ISO', type: 'isolated' }],
    ports: [
      { n: 48, name: 'guest-gw', role: 'promisc', sec: null },
      { n: 1, name: 'ap-1', role: 'host', sec: 1 },
      { n: 2, name: 'ap-2', role: 'host', sec: 1 },
      { n: 3, name: 'ap-3', role: 'host', sec: 1 },
      { n: 4, name: 'ap-4', role: 'host', sec: 1 },
    ],
  },
  apptier: {
    primary: { vlan: '400', name: 'APP-TIER', svi: '203.0.113.1/24' },
    secs: [
      { uid: 1, vlan: '401', name: 'MGMT-ISO', type: 'isolated' },
      { uid: 2, vlan: '402', name: 'WEB', type: 'community' },
      { uid: 3, vlan: '403', name: 'APP', type: 'community' },
    ],
    ports: [
      { n: 48, name: 'fw', role: 'promisc', sec: null },
      { n: 1, name: 'web-1', role: 'host', sec: 2 },
      { n: 2, name: 'web-2', role: 'host', sec: 2 },
      { n: 3, name: 'app-1', role: 'host', sec: 3 },
      { n: 4, name: 'app-2', role: 'host', sec: 3 },
      { n: 5, name: 'mgmt-1', role: 'host', sec: 1 },
    ],
  },
};

function pvdDefaultPorts(vendor) {
  return PVD_PRESETS.dmz.ports.map((p, i) => ({
    uid: i + 1,
    ifc: pvdIfName(vendor, p.n),
    name: p.name,
    role: p.role,
    sec: p.sec,
  }));
}

// ponytail: nth copy; hoist to shared.jsx in a cleanup pass.
function pvdDownload(content, filename, mime) {
  const blob = new Blob([content + '\n'], { type: mime || 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function PrivateVLANDesigner({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const fileInputRef = useRef(null);
  const skipNavReport = useRef(false);

  // Reject crafted/corrupt share payloads before the first render. `??` is not
  // enough: secs:[null] / ports:[null] / secs:{} are truthy and crash pvdAudit.
  const seed = pvdValidShape(initialData) ? initialData : null;
  const seedVendor = (seed?.vendor && PVD_VENDORS.includes(seed.vendor))
    ? seed.vendor
    : ((initialData?.vendor && PVD_VENDORS.includes(initialData.vendor)) ? initialData.vendor : 'ios');
  const seedVtp = (seed?.vtp === 'v1v2' || seed?.vtp === 'v3')
    ? seed.vtp
    : ((initialData?.vtp === 'v1v2' || initialData?.vtp === 'v3') ? initialData.vtp : 'v1v2');

  const [activeTab, setActiveTab] = usePersistentState('pvlan:activeTab', initialData?.activeTab ?? 'design');
  const [vendor, setVendor] = usePersistentState('pvlan:vendor', seedVendor);
  const [vtp, setVtp] = usePersistentState('pvlan:vtp', seedVtp);
  const [primary, setPrimary] = usePersistentState('pvlan:primary', seed?.primary ? { ...seed.primary } : { ...PVD_PRESETS.dmz.primary });
  const [secs, setSecs] = usePersistentState('pvlan:secs', seed?.secs ? seed.secs.slice(0, PVD_MAX_SECS).map(s => ({ ...s })) : PVD_PRESETS.dmz.secs.map(s => ({ ...s })));
  const [ports, setPorts] = usePersistentState('pvlan:ports', seed?.ports ? seed.ports.slice(0, PVD_MAX_PORTS).map(p => ({ ...p })) : pvdDefaultPorts('ios'));
  const [focus, setFocus] = useState(null);
  const [importErr, setImportErr] = useState('');

  useEffect(() => {
    if (!initialData) return;
    // Shape-check primary/secs/ports the same way as JSON import. Malformed
    // share payloads (primary:null, secs:[null]) must not crash the tool.
    if (initialData.vendor !== undefined && PVD_VENDORS.includes(initialData.vendor)) setVendor(initialData.vendor);
    if (initialData.vtp === 'v1v2' || initialData.vtp === 'v3') setVtp(initialData.vtp);
    if (pvdValidShape(initialData)) {
      setPrimary(initialData.primary);
      setSecs(initialData.secs.slice(0, PVD_MAX_SECS));
      setPorts(initialData.ports.slice(0, PVD_MAX_PORTS));
    }
  }, [initialData]);

  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
  }, [initialData]);

  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'pvlan-designer', activeTab, vendor, vtp, primary, secs, ports });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [activeTab, vendor, vtp, primary, secs, ports, onShare]);

  const design = useMemo(() => ({
    vendor,
    vendorLabel: PVD_VENDOR_LABELS[vendor] || vendor,
    vtp,
    primary,
    secs,
    ports,
  }), [vendor, vtp, primary, secs, ports]);

  const audit = useMemo(() => pvdAudit(design), [design]);
  const emitted = useMemo(() => pvdEmit(design, (k, v) => t('pvlan_designer.' + k, v)), [design, t]);
  const hasErrors = audit.some(x => x.level === 'err');

  const applyPreset = useCallback((id) => {
    const preset = PVD_PRESETS[id];
    if (!preset) return;
    setPrimary({ ...preset.primary });
    setSecs(preset.secs.map(s => ({ ...s })));
    setPorts(preset.ports.map((p, i) => ({
      uid: i + 1,
      ifc: pvdIfName(vendor, p.n),
      name: p.name,
      role: p.role,
      sec: p.sec,
    })));
    setFocus(null);
  }, [vendor]);

  const nextUid = (list) => Math.max(0, ...list.map(x => x.uid)) + 1;

  const updSec = useCallback((uid, patch) => {
    setSecs(prev => prev.map(s => s.uid === uid ? { ...s, ...patch } : s));
  }, []);

  const addSec = useCallback((type) => {
    setSecs(prev => {
      if (prev.length >= PVD_MAX_SECS) return prev;
      if (type === 'isolated' && prev.some(s => s.type === 'isolated')) return prev;
      const uid = nextUid(prev);
      const base = pvdVlan(primary.vlan) || 100;
      let vlan = String(base + uid);
      while (prev.some(s => s.vlan === vlan) || vlan === String(primary.vlan)) {
        vlan = String(+vlan + 1);
      }
      return [...prev, { uid, vlan, name: type === 'isolated' ? 'ISO' : ('COMM-' + uid), type }];
    });
  }, [primary.vlan]);

  const delSec = useCallback((uid) => {
    setSecs(prev => prev.filter(s => s.uid !== uid));
    setPorts(prev => prev.map(p => p.sec === uid ? { ...p, sec: null } : p));
  }, []);

  const updPort = useCallback((uid, patch) => {
    setPorts(prev => prev.map(p => {
      if (p.uid !== uid) return p;
      const next = { ...p, ...patch };
      if (patch.role === 'promisc' || patch.role === 'trunk' || patch.role === 'ptrunk') {
        next.sec = null;
      } else if (patch.role === 'strunk') {
        const iso = secs.find(s => s.type === 'isolated');
        next.sec = iso ? iso.uid : null;
      }
      return next;
    }));
  }, [secs]);

  const addPort = useCallback(() => {
    setPorts(prev => {
      if (prev.length >= PVD_MAX_PORTS) return prev;
      const firstComm = secs.find(s => s.type === 'community');
      const iso = secs.find(s => s.type === 'isolated');
      const sec = firstComm ? firstComm.uid : (iso ? iso.uid : null);
      const used = new Set(prev.map(p => String(p.ifc || '').trim().toLowerCase()).filter(Boolean));
      let n = 1;
      while (used.has(pvdIfName(vendor, n).toLowerCase())) n++;
      return [...prev, {
        uid: nextUid(prev),
        ifc: pvdIfName(vendor, n),
        name: '',
        role: 'host',
        sec,
      }];
    });
  }, [vendor, secs]);

  const delPort = useCallback((uid) => {
    setPorts(prev => prev.filter(p => p.uid !== uid));
    setFocus(f => f === uid ? null : f);
  }, []);

  const exportJson = useCallback(() => {
    const payload = { tool: 'pvlan-designer', v: 1, vendor, vtp, primary, secs, ports };
    pvdDownload(JSON.stringify(payload, null, 2), 'pvlan-designer.json', 'application/json');
  }, [vendor, vtp, primary, secs, ports]);

  const importJson = useCallback((e) => {
    const file = e.target.files && e.target.files[0];
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.tool !== 'pvlan-designer' || !pvdValidShape(data)) {
          setImportErr(t('pvlan_designer.err_import'));
          return;
        }
        setImportErr('');
        if (PVD_VENDORS.includes(data.vendor)) setVendor(data.vendor);
        if (data.vtp === 'v1v2' || data.vtp === 'v3') setVtp(data.vtp);
        setPrimary(data.primary);
        setSecs(data.secs.slice(0, PVD_MAX_SECS));
        setPorts(data.ports.slice(0, PVD_MAX_PORTS));
        setFocus(null);
      } catch (_) {
        setImportErr(t('pvlan_designer.err_import'));
      }
    };
    reader.readAsText(file);
  }, [t]);

  const endpoints = useMemo(
    () => ports.map(p => ({ p, k: pvdKind(p, secs) })).filter(e => e.k),
    [ports, secs]
  );

  const sortedAudit = useMemo(() => {
    const rank = { err: 0, warn: 1, ok: 2 };
    return [...audit].sort((a, b) => rank[a.level] - rank[b.level]);
  }, [audit]);

  const hasIsolated = secs.some(s => s.type === 'isolated');

  const renderAudit = () => (
    <div className="card">
      <div className="card-title">{t('pvlan_designer.audit_title')}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {sortedAudit.map((f, i) => {
          const badge = f.level === 'err' ? 'badge-red' : f.level === 'warn' ? 'badge-yellow' : 'badge-green';
          const label = f.level === 'err' ? 'audit_err' : f.level === 'warn' ? 'audit_warn' : 'audit_ok';
          return (
            <div key={f.key + '-' + i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13 }}>
              <span className={'badge ' + badge}>{t('pvlan_designer.' + label)}</span>
              <span>{t('pvlan_designer.' + f.key, f.vars || {})}</span>
            </div>
          );
        })}
      </div>
      <div className="hint" style={{ marginTop: 10 }}>{t('pvlan_designer.hint_svi_rule')}</div>
    </div>
  );

  const kindBadge = (k) => {
    if (k === 'P') return <span className="badge badge-cyan">{t('pvlan_designer.kind_p')}</span>;
    if (k === 'I') return <span className="badge badge-yellow">{t('pvlan_designer.kind_i')}</span>;
    const uid = +String(k).slice(2);
    const sec = secs.find(s => s.uid === uid);
    return (
      <span className="badge badge-green">
        {t('pvlan_designer.kind_c')}{sec ? ' ' + (sec.name || sec.vlan) : ''}
      </span>
    );
  };

  const endpointLabel = (e) => (e.p.name && String(e.p.name).trim()) || e.p.ifc;

  const renderMatrix = () => {
    if (endpoints.length < 2) {
      return <div className="card"><div className="hint">{t('pvlan_designer.hint_matrix_empty')}</div></div>;
    }
    const focused = focus != null ? endpoints.find(e => e.p.uid === focus) : null;
    const rows = focused ? [focused] : endpoints;
    let allowed = 0;
    const peersAllow = [];
    const peersBlock = [];
    if (focused) {
      for (const b of endpoints) {
        if (b.p.uid === focused.p.uid) continue;
        const r = pvdReach(focused.k, b.k);
        if (r.allow) { allowed++; peersAllow.push({ e: b, reason: r.reason }); }
        else peersBlock.push({ e: b, reason: r.reason });
      }
    }
    const total = endpoints.length - 1;

    return (
      <div className="card">
        {focused && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
            <span style={{ fontSize: 13 }}>{t('pvlan_designer.focus_summary', { n: allowed, m: total })}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setFocus(null)}>{t('pvlan_designer.btn_clear_focus')}</button>
          </div>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 6, borderBottom: '1px solid var(--border)' }} />
                {endpoints.map(e => (
                  <th key={e.p.uid} style={{ padding: 6, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                    <div>{endpointLabel(e)}</div>
                    <div>{kindBadge(e.k)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(a => (
                <tr key={a.p.uid}>
                  <td style={{ padding: 6, borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setFocus(focus === a.p.uid ? null : a.p.uid)}
                    >
                      {endpointLabel(a)} {kindBadge(a.k)}
                    </button>
                  </td>
                  {endpoints.map(b => {
                    if (a.p.uid === b.p.uid) {
                      return <td key={b.p.uid} style={{ textAlign: 'center', padding: 6, borderBottom: '1px solid var(--border)' }}>—</td>;
                    }
                    const r = pvdReach(a.k, b.k);
                    return (
                      <td key={b.p.uid} style={{ textAlign: 'center', padding: 6, borderBottom: '1px solid var(--border)' }}>
                        <span
                          className={'badge ' + (r.allow ? 'badge-green' : 'badge-red')}
                          title={t('pvlan_designer.reason_' + r.reason)}
                        >
                          {r.allow ? '✓' : '✗'}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {focused && (
          <div className="two-col grid-mobile-1" style={{ marginTop: 12 }}>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>{t('pvlan_designer.can_reach')}</div>
              {peersAllow.map(({ e, reason }) => (
                <div key={e.p.uid} style={{ fontSize: 12, marginBottom: 4 }}>
                  {endpointLabel(e)} — {t('pvlan_designer.reason_' + reason)}
                </div>
              ))}
            </div>
            <div>
              <div className="label" style={{ marginBottom: 6 }}>{t('pvlan_designer.blocked')}</div>
              {peersBlock.map(({ e, reason }) => (
                <div key={e.p.uid} style={{ fontSize: 12, marginBottom: 4 }}>
                  {endpointLabel(e)} — {t('pvlan_designer.reason_' + reason)}
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="hint" style={{ marginTop: 10 }}>
          <span className="badge badge-green">✓</span> {t('pvlan_designer.legend_allow')}{' '}
          <span className="badge badge-red">✗</span> {t('pvlan_designer.legend_block')}
        </div>
        <div className="hint">{t('pvlan_designer.note_trunks_excluded')}</div>
        <div className="hint">{t('pvlan_designer.note_l2_only')}</div>
      </div>
    );
  };

  return (
    <div className="fadein">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">{t('pvlan_designer.title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PVD_TABS.map(tabId => (
            <button
              key={tabId}
              className={'btn btn-sm ' + (activeTab === tabId ? 'btn-primary' : 'btn-ghost')}
              style={{ fontSize: 12 }}
              onClick={() => setActiveTab(tabId)}
            >
              {t('pvlan_designer.tab_' + tabId)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'design' && (
        <>
          <div className="card">
            <div className="card-title">{t('pvlan_designer.presets_title')}</div>
            <div className="btn-row" style={{ flexWrap: 'wrap', gap: 6 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => applyPreset('dmz')}>{t('pvlan_designer.preset_dmz')}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => applyPreset('hotel')}>{t('pvlan_designer.preset_hotel')}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => applyPreset('apptier')}>{t('pvlan_designer.preset_apptier')}</button>
              <button className="btn btn-sm btn-ghost" onClick={exportJson}>{t('common.export_json')}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => fileInputRef.current && fileInputRef.current.click()}>
                {t('pvlan_designer.btn_import')}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".json,application/json"
                style={{ display: 'none' }}
                onChange={importJson}
              />
            </div>
            <div className="hint" style={{ marginTop: 8 }}>{t('pvlan_designer.presets_hint')}</div>
            {importErr ? <Err msg={importErr} /> : null}
          </div>

          <div className="card">
            <div className="card-title">{t('pvlan_designer.primary_title')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('pvlan_designer.field_vlan')}</label>
                <input className="input" value={primary.vlan} onChange={e => setPrimary({ ...primary, vlan: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">{t('pvlan_designer.field_name')}</label>
                <input className="input" value={primary.name} onChange={e => setPrimary({ ...primary, name: e.target.value })} />
              </div>
              <div className="field">
                <label className="label">{t('pvlan_designer.field_svi')}</label>
                <input className="input" value={primary.svi} onChange={e => setPrimary({ ...primary, svi: e.target.value })} placeholder="192.0.2.1/24" />
                <div className="hint">{t('pvlan_designer.hint_svi')}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{t('pvlan_designer.secs_title')}</span>
              <span className="hint" style={{ margin: 0 }}>{t('pvlan_designer.sec_count', { n: secs.length })}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 6 }}>{t('pvlan_designer.field_vlan')}</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>{t('pvlan_designer.field_name')}</th>
                    <th style={{ textAlign: 'left', padding: 6 }} />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {secs.map(s => (
                    <tr key={s.uid}>
                      <td style={{ padding: 6 }}>
                        <input className="input" style={{ width: 80 }} value={s.vlan} onChange={e => updSec(s.uid, { vlan: e.target.value })} />
                      </td>
                      <td style={{ padding: 6 }}>
                        <input className="input" value={s.name} onChange={e => updSec(s.uid, { name: e.target.value })} />
                      </td>
                      <td style={{ padding: 6 }}>
                        <span className={'badge ' + (s.type === 'isolated' ? 'badge-yellow' : 'badge-green')}>
                          {t('pvlan_designer.type_' + s.type)}
                        </span>
                      </td>
                      <td style={{ padding: 6 }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => delSec(s.uid)}>{t('pvlan_designer.btn_remove')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row" style={{ marginTop: 8, gap: 6 }}>
              <button
                className="btn btn-sm btn-ghost"
                disabled={hasIsolated || secs.length >= PVD_MAX_SECS}
                onClick={() => addSec('isolated')}
              >
                {t('pvlan_designer.btn_add_isolated')}
              </button>
              <button
                className="btn btn-sm btn-ghost"
                disabled={secs.length >= PVD_MAX_SECS}
                onClick={() => addSec('community')}
              >
                {t('pvlan_designer.btn_add_community')}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>{t('pvlan_designer.ports_title')}</span>
              <span className="hint" style={{ margin: 0 }}>{t('pvlan_designer.ports_count', { n: ports.length })}</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: 6 }}>{t('pvlan_designer.col_interface')}</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>{t('pvlan_designer.col_description')}</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>{t('pvlan_designer.col_role')}</th>
                    <th style={{ textAlign: 'left', padding: 6 }}>{t('pvlan_designer.col_secondary')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {ports.map(p => (
                    <tr key={p.uid}>
                      <td style={{ padding: 6 }}>
                        <input className="input" style={{ minWidth: 140 }} value={p.ifc} onChange={e => updPort(p.uid, { ifc: e.target.value })} />
                      </td>
                      <td style={{ padding: 6 }}>
                        <input className="input" value={p.name} onChange={e => updPort(p.uid, { name: e.target.value })} />
                      </td>
                      <td style={{ padding: 6 }}>
                        <select className="select" value={p.role} onChange={e => updPort(p.uid, { role: e.target.value })}>
                          {PVD_ROLES.map(r => (
                            <option key={r} value={r}>{t('pvlan_designer.role_' + r)}</option>
                          ))}
                        </select>
                      </td>
                      <td style={{ padding: 6 }}>
                        {(p.role === 'host' || p.role === 'strunk') ? (
                          <select
                            className="select"
                            value={p.sec == null ? '' : String(p.sec)}
                            onChange={e => updPort(p.uid, { sec: e.target.value === '' ? null : +e.target.value })}
                          >
                            <option value="" />
                            {(p.role === 'strunk' ? secs.filter(s => s.type === 'isolated') : secs).map(s => (
                              <option key={s.uid} value={s.uid}>
                                {s.vlan} {s.name} ({t('pvlan_designer.type_' + s.type)})
                              </option>
                            ))}
                          </select>
                        ) : null}
                      </td>
                      <td style={{ padding: 6 }}>
                        <button className="btn btn-sm btn-ghost" onClick={() => delPort(p.uid)}>{t('pvlan_designer.btn_remove')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn btn-sm btn-ghost" disabled={ports.length >= PVD_MAX_PORTS} onClick={addPort}>
                {t('pvlan_designer.btn_add_port')}
              </button>
            </div>
          </div>

          {renderAudit()}
        </>
      )}

      {activeTab === 'matrix' && renderMatrix()}

      {activeTab === 'config' && (
        <>
          <div className="card">
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('pvlan_designer.vendor_label')}</label>
                <select className="select" value={vendor} onChange={e => setVendor(e.target.value)}>
                  {PVD_VENDORS.map(v => (
                    <option key={v} value={v}>{PVD_VENDOR_LABELS[v]}</option>
                  ))}
                </select>
              </div>
              {vendor === 'ios' && (
                <div className="field">
                  <label className="label">{t('pvlan_designer.vtp_label')}</label>
                  <select className="select" value={vtp} onChange={e => setVtp(e.target.value)}>
                    <option value="v1v2">{t('pvlan_designer.vtp_v1v2')}</option>
                    <option value="v3">{t('pvlan_designer.vtp_v3')}</option>
                  </select>
                </div>
              )}
            </div>

            {hasErrors ? (
              <Err msg={t('pvlan_designer.err_blocked')} />
            ) : (
              <>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8, alignItems: 'center' }}>
                  <CopyBtn text={emitted.text} label="copy_all" id="pvlan-cfg-all" />
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => pvdDownload(emitted.text, 'pvlan-' + (pvdVlan(primary.vlan) || 'x') + '-' + vendor + '.txt', 'text/plain')}
                  >
                    {t('common.download')}
                  </button>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pvlan_designer.sec_vlans')}</span>
                  <CopyBtn text={emitted.sections.vlans} label="copy" id="pvlan-cfg-vlans" />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pvlan_designer.sec_ports')}</span>
                  <CopyBtn text={emitted.sections.ports} label="copy" id="pvlan-cfg-ports" />
                  {emitted.sections.svi ? (
                    <>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('pvlan_designer.sec_svi')}</span>
                      <CopyBtn text={emitted.sections.svi} label="copy" id="pvlan-cfg-svi" />
                    </>
                  ) : null}
                </div>
                <pre
                  className="mono"
                  style={{
                    fontFamily: 'var(--mono)',
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    background: 'var(--panel)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    padding: 12,
                    overflowX: 'auto',
                  }}
                >
                  {emitted.text}
                </pre>
              </>
            )}
          </div>

          {renderAudit()}

          <div className="btn-row" style={{ gap: 6, marginTop: 8 }}>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: 'qinq-config' } }))}
            >
              {t('pvlan_designer.link_qinq')}
            </button>
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: 'config-parser' } }))}
            >
              {t('pvlan_designer.link_config_parser')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

window.PrivateVLANDesigner = PrivateVLANDesigner;
