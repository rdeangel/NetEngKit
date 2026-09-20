const { useState, useEffect, useCallback, useMemo } = React;

// ── Protocol code → name mapping (Cisco) ──────────────────────────
const RTP_CISCO_PROTO_MAP = {
  'C': 'Connected', 'L': 'Local', 'S': 'Static', 'R': 'RIP', 'M': 'Mobile',
  'B': 'BGP', 'D': 'EIGRP', 'EX': 'EIGRP-External', 'O': 'OSPF',
  'IA': 'OSPF-Inter-Area', 'O IA': 'OSPF-Inter-Area',
  'N1': 'OSPF-NSSA-Ext1', 'N2': 'OSPF-NSSA-Ext2',
  'E1': 'OSPF-Ext1', 'E2': 'OSPF-Ext2',
  'i': 'IS-IS', 'su': 'IS-IS-Summary', 'L1': 'IS-IS-L1', 'L2': 'IS-IS-L2',
};

// ── Default admin distances ───────────────────────────────────────
const RTP_DEFAULT_AD = {
  Connected: 0, Local: 0, Static: 1, EIGRP: 90, 'EIGRP-External': 170,
  OSPF: 110, 'OSPF-Inter-Area': 110, 'OSPF-NSSA-Ext1': 110, 'OSPF-NSSA-Ext2': 110,
  'OSPF-Ext1': 110, 'OSPF-Ext2': 110,
  'IS-IS': 115, 'IS-IS-Summary': 115, 'IS-IS-L1': 115, 'IS-IS-L2': 115,
  RIP: 120, BGP: 200,
};

// ── Protocol → badge class ────────────────────────────────────────
const RTP_PROTO_BADGE = {
  Connected: 'badge-green', Local: 'badge-blue', Static: 'badge-yellow',
  OSPF: 'badge-cyan', 'OSPF-Inter-Area': 'badge-cyan',
  'OSPF-NSSA-Ext1': 'badge-cyan', 'OSPF-NSSA-Ext2': 'badge-cyan',
  'OSPF-Ext1': 'badge-cyan', 'OSPF-Ext2': 'badge-cyan',
  BGP: 'badge-red', EIGRP: 'badge-blue', 'EIGRP-External': 'badge-blue',
  RIP: 'badge-yellow', 'IS-IS': 'badge-cyan', 'IS-IS-Summary': 'badge-cyan',
  'IS-IS-L1': 'badge-cyan', 'IS-IS-L2': 'badge-cyan',
};

// ── IPv4 helpers ──────────────────────────────────────────────────
function rtpIpv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function rtpIpInNetv4(ip, net, pfx) {
  if (pfx === 0) return true;
  const mask = (~0 << (32 - pfx)) >>> 0;
  return (rtpIpv4ToInt(ip) & mask) === (rtpIpv4ToInt(net) & mask);
}

// ── IPv6 helpers ──────────────────────────────────────────────────
function rtpExpandIpv6(addr) {
  let a = addr;
  if (a.includes('::')) {
    const halves = a.split('::');
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves[1] ? halves[1].split(':') : [];
    const gap = 8 - left.length - right.length;
    a = [...left, ...Array(Math.max(0, gap)).fill('0'), ...right].join(':');
  }
  return a.split(':').map(g => g.padStart(4, '0').toLowerCase()).join(':');
}

function rtpIpv6ToBig(addr) {
  const groups = rtpExpandIpv6(addr).split(':');
  let n = 0n;
  for (const g of groups) n = (n << 16n) | BigInt(parseInt(g, 16));
  return n;
}

function rtpIpInNetv6(ip, net, pfx) {
  if (pfx === 0) return true;
  const mask = (~0n << BigInt(128 - pfx));
  return (rtpIpv6ToBig(ip) & mask) === (rtpIpv6ToBig(net) & mask);
}

function rtpIpInNet(ip, net, pfx, v6) {
  return v6 ? rtpIpInNetv6(ip, net, pfx) : rtpIpInNetv4(ip, net, pfx);
}

function rtpIsV6Addr(s) { return s.includes(':'); }

// ── Format detection ──────────────────────────────────────────────
// Convert subnet mask to CIDR prefix length
function rtpMaskToPfx(mask) {
  const m = rtpIpv4ToInt(mask);
  if (m === 0) return 0;
  return 32 - Math.log2((~m >>> 0) + 1);
}

function rtpDetectFormat(input) {
  const lines = input.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.some(l => /^IP Route Table for VRF/i.test(l))) return 'nexus';
  if (lines.some(l => /^Destination\/Mask\s+Proto\s+Pre/i.test(l))) return 'huawei';
  if (lines.some(l => /DST-ADDRESS\s+PREF-SRC\s+GATEWAY/i.test(l)) || lines.some(l => /DST-ADDRESS\s+GATEWAY\s+DISTANCE/i.test(l))) return 'mikrotik';
  if (lines.some(l => /^Codes:\s+K\s+-\s+kernel/i.test(l))) return 'fortinet';
  if (lines.some(l => /^IP Route Entries/i.test(l)) && lines.some(l => /Destination\s+Gateway/i.test(l))) return 'aruba-s';
  if (lines.some(l => /^Displaying ipv[46] routes/i.test(l))) return 'aos-cx';
  if (lines.some(l => /inet\.[03]:\s+\d+\s+destinations/i.test(l))) return 'juniper';
  if (lines.some(l => /^VRF name: /i.test(l))) return 'arista';
  if (lines.some(l => /^Destination\s+Gateway\s+Genmask/i.test(l))) return 'netstat';
  if (lines.some(l => /^(default\s+via|\d+\.\d+\.\d+\.\d+\/\d+\s+dev)/.test(l))) return 'linux';
  const hasV6Route = lines.some(l => /^[A-Za-z]{1,3}\*?\s+[0-9a-fA-F:]+\/\d+/i.test(l));
  const hasV4Route = lines.some(l => /^[A-Za-z]{1,3}\*?\s+\d+\.\d+\.\d+\.\d+\/\d+/.test(l));
  // Classic format: "S  134.134.0.0 is directly connected" or "C  172.19.64.0 255.255.255.0 is directly connected"
  const hasClassicV4 = lines.some(l => /^[A-Za-z]{1,3}\s+\d+\.\d+\.\d+\.\d+\s+(is\s+directly|255\.|via\s)/);
  if (hasV6Route && !hasV4Route && !hasClassicV4) return 'cisco-ipv6';
  if (hasV4Route || hasClassicV4) return 'cisco';
  if (lines.some(l => /^Codes:/.test(l))) {
    if (lines.some(l => /[0-9a-fA-F]{4}::/i.test(l))) return 'cisco-ipv6';
    return 'cisco';
  }
  return null;
}

function rtpDetectVrf(input) {
  for (const line of input.split('\n')) {
    const t = line.trim();
    let m = t.match(/IP Route Table for VRF "([^"]+)"/i);
    if (m) return m[1];
    m = t.match(/Routing Table: (\S+)/i);
    if (m) return m[1];
    m = t.match(/VRF name: (\S+)/i);
    if (m) return m[1];
    m = t.match(/Routing Tables: (\S+)/i);
    if (m) return m[1];
    m = t.match(/^(\S+)\.inet\.[03]:/i);
    if (m) return m[1];
    if (t.startsWith('inet.0:')) return 'default';
  }
  return null;
}

// ── Parse Cisco show ip route ─────────────────────────────────────
function rtpParseCisco(input) {
  const routes = [];
  let gatewayInfo = null;
  let currentVrf = 'default';

  for (const line of input.split('\n')) {
    const t = line.trim();
    if (/^Codes:/i.test(t)) continue;
    
    // Detect VRF change
    const vrfMatch = t.match(/Routing Table: (\S+)/i);
    if (vrfMatch) {
      currentVrf = vrfMatch[1];
      continue;
    }

    if (/^Gateway of last resort/i.test(t)) {
      const m = t.match(/is\s+(\S+)\s+to\s+network/i);
      if (m) gatewayInfo = m[1];
      else if (/is not set/i.test(t)) gatewayInfo = null;
      continue;
    }
    if (/is\s+(variably\s+)?subnetted/i.test(t)) continue;
    if (/^\d+\.\d+\.\d+\.\d+\/\d+/.test(t)) continue; // continuation header
    if (!t) continue;

    let network = null, prefix = null, cidr = null;
    let rawCode = '', after = '', isCand = false;

    // Try CIDR format first: "O  10.0.1.0/24 [110/2] via ..."
    const cidrMatch = t.match(/^([A-Za-z]{1,3}\*?)\s+(\d+\.\d+\.\d+\.\d+\/\d+)\s+(.*)/);
    if (cidrMatch) {
      rawCode = cidrMatch[1];
      cidr = cidrMatch[2];
      after = cidrMatch[3];
      const [n, p] = cidr.split('/');
      network = n;
      prefix = parseInt(p);
    } else {
      // Classic format: "S  134.134.0.0 is directly connected, Ethernet0"
      const classicMatch = t.match(/^([A-Za-z]{1,3}\*?)\s+(\d+\.\d+\.\d+\.\d+)(?:\s+(255\.\d+\.\d+\.\d+))?\s+(.*)/);
      if (classicMatch) {
        rawCode = classicMatch[1];
        network = classicMatch[2];
        const mask = classicMatch[3];
        after = classicMatch[4];
        if (mask) {
          prefix = rtpMaskToPfx(mask);
        } else {
          const first = parseInt(network.split('.')[0]);
          if (first <= 127) prefix = 8;
          else if (first <= 191) prefix = 16;
          else prefix = 24;
        }
        cidr = network + '/' + prefix;
      } else {
        continue;
      }
    }

    isCand = rawCode.includes('*');
    rawCode = rawCode.replace(/\*/g, '').trim();
    const proto = RTP_CISCO_PROTO_MAP[rawCode] || rawCode;

    let ad = null, metric = null;
    const am = after.match(/\[(\d+)\/(\d+)\]/);
    if (am) { ad = parseInt(am[1]); metric = parseInt(am[2]); }

    let nextHop = null, iface = null;
    if (/directly connected/i.test(after)) {
      const im = after.match(/directly connected,?\s*(\S+)/i);
      if (im) iface = im[1].replace(/,$/, '');
    } else {
      const vm = after.match(/via\s+(\d+\.\d+\.\d+\.\d+)/);
      if (vm) nextHop = vm[1];
      const rest = after.replace(/via\s+\d+\.\d+\.\d+\.\d+\s*,?\s*/, '');
      const tm = rest.match(/^\d{2}:\d{2}:\d{2},?\s*/);
      const tail = tm ? rest.substring(tm[0].length) : rest;
      const im2 = tail.match(/^(\S+)/);
      if (im2) {
        const c = im2[1].replace(/,$/, '');
        if (c && !/^\d{2}:\d{2}:\d{2}$/.test(c)) iface = c;
      }
    }

    if (ad === null) ad = RTP_DEFAULT_AD[proto] ?? '-';

    routes.push({
      network, prefix, cidr, protocol: proto,
      adminDist: ad, metric: metric ?? '-',
      nextHop, iface: iface || '-', isV6: false,
      vrf: currentVrf,
      isCandidateDefault: isCand,
      directlyConnected: nextHop === null && !/via/i.test(after),
    });
  }
  return { routes, gatewayInfo };
}

// ── Parse Nexus show ip route ─────────────────────────────────────
function rtpParseNexus(input) {
  const routes = [];
  const lines = input.split('\n');
  let currentNetwork = null, currentPrefix = null, currentCidr = null;
  let currentVrf = 'default';

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.includes('denotes')) continue;

    // Detect VRF change: IP Route Table for VRF "default"
    const vrfMatch = t.match(/IP Route Table for VRF "([^"]+)"/i);
    if (vrfMatch) {
      currentVrf = vrfMatch[1];
      continue;
    }

    if (t.includes('IP Route Table')) continue;

    // Look for network line: "10.10.10.0/24, ubest/mbest: 1/0"
    const netMatch = t.match(/^(\d+\.\d+\.\d+\.\d+\/\d+),/);
    if (netMatch) {
      currentCidr = netMatch[1];
      const [n, p] = currentCidr.split('/');
      currentNetwork = n; currentPrefix = parseInt(p);
      continue;
    }

    // Look for next-hop line: "*via 10.197.121.1%management, [1/0], 00:00:03, static"
    if (t.match(/^\*?via\s+/)) {
      let after = t.replace(/^\*?via\s+/, '');
      let nextHop = '-', iface = '-';

      const nhMatch = after.match(/^([^\s,]+)/);
      if (nhMatch) {
        nextHop = nhMatch[1];
        after = after.substring(nhMatch[0].length).replace(/^,?\s*/, '').trim();
      }

      if (after && !after.startsWith('[')) {
        const ifaceMatch = after.match(/^([^\s,]+)/);
        if (ifaceMatch) {
          iface = ifaceMatch[1];
          after = after.substring(ifaceMatch[0].length).replace(/^,?\s*/, '').trim();
        }
      }

      let ad = '-', metric = '-';
      const amMatch = after.match(/\[(\d+)\/(\d+)\]/);
      if (amMatch) {
        ad = parseInt(amMatch[1]); metric = parseInt(amMatch[2]);
        after = after.substring(after.indexOf(']') + 1).replace(/^,?\s*/, '').trim();
      }

      const parts = after.split(',').map(s => s.trim()).filter(Boolean);
      let proto = parts[parts.length - 1] || 'Static';
      if (proto === 'direct') proto = 'Connected';
      else if (proto === 'local') proto = 'Local';
      else proto = proto.charAt(0).toUpperCase() + proto.slice(1);

      if (currentCidr) {
        routes.push({
          network: currentNetwork, prefix: currentPrefix, cidr: currentCidr,
          protocol: proto, adminDist: ad, metric: metric,
          nextHop: nextHop === '-' ? null : nextHop,
          iface: iface, isV6: false, vrf: currentVrf,
          isCandidateDefault: currentPrefix === 0,
          directlyConnected: proto === 'Connected' || proto === 'Local'
        });
      }
    }
  }
  return { routes, gatewayInfo: null };
}

// ── Parse Aruba AOS-S (ProCurve) ──────────────────────────────────
function rtpParseArubaS(input) {
  const routes = [];
  let headerPassed = false;
  const lines = input.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.includes('IP Route Entries') || t.startsWith('---')) continue;
    if (t.startsWith('Destination')) { headerPassed = true; continue; }
    if (!headerPassed) continue;

    const p = t.split(/\s+/);
    if (p.length < 5) continue;

    const dest = p[0], gw = p[1], vlan = p[2], type = p[3];
    const metric = p[p.length - 2], dist = p[p.length - 1];

    if (!dest.includes('/')) continue;
    const [net, pfx] = dest.split('/');
    const proto = type.charAt(0).toUpperCase() + type.slice(1);
    
    routes.push({
      network: net, prefix: parseInt(pfx), cidr: dest, protocol: proto,
      adminDist: parseInt(dist) || 0, metric: parseInt(metric) || 0,
      nextHop: (gw === 'reject' || gw === 'lo0' || gw.includes('.')) ? gw : null,
      iface: (vlan && vlan !== 'reject' && vlan !== 'lo0') ? 'VLAN ' + vlan : '-',
      isV6: dest.includes(':'), isCandidateDefault: pfx === '0',
      directlyConnected: type.toLowerCase() === 'connected'
    });
  }
  return { routes, gatewayInfo: null };
}

// ── Parse Aruba AOS-CX ────────────────────────────────────────────
function rtpParseAosCx(input) {
  const routes = [];
  const lines = input.split('\n');
  let currentCidr = null, currentNetwork = null, currentPrefix = null;
  let currentVrf = 'default';

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.includes('Displaying') || t.includes('denotes')) continue;

    // Detect VRF: 10.0.0.0/24, vrf default
    const vrfMatch = t.match(/, vrf (\S+)/i);
    if (vrfMatch) currentVrf = vrfMatch[1];

    const netMatch = t.match(/^([0-9a-fA-F:.]+)\/(\d+)/);
    if (netMatch) {
      currentCidr = netMatch[1] + '/' + netMatch[2];
      currentNetwork = netMatch[1]; currentPrefix = parseInt(netMatch[2]);
      continue;
    }

    if (t.match(/^via\s+/) || t.match(/^nullroute,/) || t.match(/^reject route,/)) {
      let after = t.replace(/^via\s+/, '');
      let nextHop = '-', iface = '-';

      if (after.match(/^\d+\.\d+\.\d+\.\d+/) || after.match(/^[0-9a-fA-F:]+/)) {
        const nhMatch = after.match(/^([^\s,]+)/);
        if (nhMatch) {
          nextHop = nhMatch[1];
          after = after.substring(nhMatch[0].length).replace(/^,?\s*/, '').trim();
        }
      } else if (!after.startsWith('[')) {
        const ifMatch = after.match(/^([^\s,]+)/);
        if (ifMatch) {
          iface = ifMatch[1];
          after = after.substring(ifMatch[0].length).replace(/^,?\s*/, '').trim();
        }
      }

      let ad = '-', metric = '-';
      const amMatch = after.match(/\[(\d+)\/(\d+)\]/);
      if (amMatch) {
        ad = parseInt(amMatch[1]); metric = parseInt(amMatch[2]);
        after = after.substring(after.indexOf(']') + 1).replace(/^,?\s*/, '').trim();
      }

      const parts = after.split(',').map(s => s.trim()).filter(Boolean);
      let proto = parts[parts.length - 1] || 'Static';
      if (proto === 'direct') proto = 'Connected';
      else proto = proto.charAt(0).toUpperCase() + proto.slice(1);

      if (currentCidr) {
        routes.push({
          network: currentNetwork, prefix: currentPrefix, cidr: currentCidr,
          protocol: proto, adminDist: ad, metric: metric,
          nextHop: nextHop === '-' ? null : nextHop,
          iface: iface, isV6: currentCidr.includes(':'),
          vrf: currentVrf,
          isCandidateDefault: currentPrefix === 0,
          directlyConnected: proto.toLowerCase() === 'connected' || proto.toLowerCase() === 'local'
        });
      }
    }
  }
  return { routes, gatewayInfo: null };
}

// ── Parse Juniper Junos ───────────────────────────────────────────
function rtpParseJuniper(input) {
  const routes = [];
  const lines = input.split('\n');
  let currentRoute = null;
  let currentVrf = 'default';

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.includes('destinations') || t.includes('Active Route')) {
      const vrfMatch = line.match(/^(\S+)\.inet\.[03]:/i);
      if (vrfMatch) currentVrf = vrfMatch[1];
      continue;
    }

    const netMatch = line.match(/^([0-9a-fA-F:.]+)\/(\d+)\s+\*?\[([^\]]+)\]/);
    if (netMatch) {
      if (currentRoute) routes.push(currentRoute);
      const cidr = netMatch[1] + '/' + netMatch[2];
      const protoInfo = netMatch[3].split('/');
      const protoRaw = protoInfo[0];
      const pref = protoInfo[1];
      
      currentRoute = {
        network: netMatch[1], prefix: parseInt(netMatch[2]), cidr: cidr,
        protocol: protoRaw, adminDist: parseInt(pref) || '-', metric: '-',
        nextHop: null, iface: '-', isV6: netMatch[1].includes(':'),
        vrf: currentVrf,
        isCandidateDefault: netMatch[2] === '0',
        directlyConnected: protoRaw.toLowerCase() === 'direct'
      };
      const metricMatch = line.match(/metric\s+(\d+)/);
      if (metricMatch) currentRoute.metric = parseInt(metricMatch[1]);
      continue;
    }

    if (currentRoute && (t.includes('> to') || t.includes('via'))) {
      const nhMatch = t.match(/to\s+([^\s,]+)/);
      if (nhMatch) currentRoute.nextHop = nhMatch[1];
      const ifMatch = t.match(/via\s+([^\s,]+)/);
      if (ifMatch) currentRoute.iface = ifMatch[1];
    }
  }
  if (currentRoute) routes.push(currentRoute);
  return { routes, gatewayInfo: null };
}

// ── Parse Arista EOS ──────────────────────────────────────────────
function rtpParseArista(input) {
  const routes = [];
  const lines = input.split('\n');
  let currentCidr = null, currentNetwork = null, currentPrefix = null;
  let currentVrf = 'default';

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.includes('Codes:') || t.includes('Gateway of last resort')) continue;

    // Detect VRF: VRF name: default
    const vrfMatch = t.match(/VRF name: (\S+)/i);
    if (vrfMatch) {
      currentVrf = vrfMatch[1];
      continue;
    }

    const routeMatch = line.match(/^\s*([A-Z]{1,2})\s+([0-9a-fA-F:.]+)\/(\d+)\s+(.*)/);
    if (routeMatch) {
      const rawCode = routeMatch[1].trim();
      currentCidr = routeMatch[2] + '/' + routeMatch[3];
      currentNetwork = routeMatch[2];
      currentPrefix = parseInt(routeMatch[3]);
      let after = routeMatch[4];

      const proto = rawCode === 'C' ? 'Connected' : (rawCode === 'S' ? 'Static' : (rawCode === 'O' ? 'OSPF' : (rawCode === 'B' ? 'BGP' : rawCode)));
      
      let ad = '-', metric = '-', nextHop = null, iface = '-';

      const amMatch = after.match(/\[(\d+)\/(\d+)\]/);
      if (amMatch) {
        ad = parseInt(amMatch[1]); metric = parseInt(amMatch[2]);
        after = after.substring(after.indexOf(']') + 1).trim();
      }

      if (after.includes('is directly connected')) {
        const ifMatch = after.match(/directly connected,?\s*([^\s,]+)/);
        if (ifMatch) iface = ifMatch[1];
      } else {
        const viaMatch = after.match(/via\s+([^\s,]+)(?:,\s*([^\s,]+))?/);
        if (viaMatch) {
          nextHop = viaMatch[1];
          if (viaMatch[2]) iface = viaMatch[2];
        }
      }

      routes.push({
        network: currentNetwork, prefix: currentPrefix, cidr: currentCidr,
        protocol: proto, adminDist: ad, metric: metric,
        nextHop, iface, isV6: currentNetwork.includes(':'),
        vrf: currentVrf,
        isCandidateDefault: currentPrefix === 0,
        directlyConnected: rawCode === 'C'
      });
      continue;
    }
    
    // Handle multi-path (via) lines in Arista
    if (t.startsWith('via') && currentCidr) {
      const viaMatch = t.match(/via\s+([^\s,]+)(?:,\s*([^\s,]+))?/);
      if (viaMatch) {
        const last = routes[routes.length - 1];
        if (last && last.cidr === currentCidr) {
          routes.push({ ...last, nextHop: viaMatch[1], iface: viaMatch[2] || last.iface });
        }
      }
    }
  }
  return { routes, gatewayInfo: null };
}

// ── Parse Huawei VRP / HP Comware ─────────────────────────────────
function rtpParseHuawei(input) {
  const routes = [];
  let headerPassed = false;
  let currentVrf = 'default';
  const lines = input.split('\n');

  for (const line of lines) {
    const t = line.trim();
    if (!t || t.includes('Route Flags:')) continue;
    
    // Detect VRF: Routing Tables: Public
    const vrfMatch = t.match(/Routing Tables: (\S+)/i);
    if (vrfMatch) { currentVrf = vrfMatch[1]; continue; }

    if (t.includes('Destinations :')) continue;
    if (t.startsWith('Destination/Mask')) { headerPassed = true; continue; }
    if (!headerPassed) continue;

    const p = t.split(/\s+/);
    if (p.length < 5) continue;

    const dest = p[0], proto = p[1], pre = p[2], cost = p[3];
    let nextHop, iface;
    if (p.length === 6) { nextHop = p[4]; iface = p[5]; }
    else if (p.length === 7) { nextHop = p[5]; iface = p[6]; }
    else continue;

    const [net, mask] = dest.split('/');
    const prefix = parseInt(mask);

    routes.push({
      network: net, prefix, cidr: dest, protocol: proto,
      adminDist: parseInt(pre) || 0, metric: parseInt(cost) || 0,
      nextHop: (nextHop === '127.0.0.1' || nextHop === 'lo0') ? null : nextHop,
      iface: iface, isV6: dest.includes(':'),
      vrf: currentVrf,
      isCandidateDefault: prefix === 0,
      directlyConnected: proto.toLowerCase() === 'direct'
    });
  }
  return { routes, gatewayInfo: null };
}

// ── Parse Fortinet FortiOS ────────────────────────────────────────
function rtpParseFortinet(input) {
  const routes = [];
  const lines = input.split('\n');
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.includes('Codes:')) continue;

    const routeMatch = line.match(/^([A-Z\*]{1,3})\s+([0-9a-fA-F:.]+)\/(\d+)\s+(.*)/);
    if (routeMatch) {
      const rawCode = routeMatch[1];
      const cidr = routeMatch[2] + '/' + routeMatch[3];
      const network = routeMatch[2];
      const prefix = parseInt(routeMatch[3]);
      let after = routeMatch[4];

      const isCand = rawCode.includes('*');
      const code = rawCode.replace(/\*/g, '').trim();
      const proto = code === 'C' ? 'Connected' : (code === 'S' ? 'Static' : (code === 'O' ? 'OSPF' : (code === 'B' ? 'BGP' : code)));
      
      let ad = '-', metric = '-', nextHop = null, iface = '-';

      const amMatch = after.match(/\[(\d+)\/(\d+)\]/);
      if (amMatch) {
        ad = parseInt(amMatch[1]); metric = parseInt(amMatch[2]);
        after = after.substring(after.indexOf(']') + 1).trim();
      }

      if (after.includes('is directly connected')) {
        const ifMatch = after.match(/directly connected,?\s*([^\s,]+)/);
        if (ifMatch) iface = ifMatch[1];
      } else {
        const viaMatch = after.match(/via\s+([^\s,]+)(?:,\s*([^\s,]+))?/);
        if (viaMatch) {
          nextHop = viaMatch[1];
          if (viaMatch[2]) iface = viaMatch[2];
        }
      }

      routes.push({
        network, prefix, cidr, protocol: proto, adminDist: ad, metric,
        nextHop, iface, isV6: network.includes(':'),
        vrf: 'default',
        isCandidateDefault: isCand,
        directlyConnected: code === 'C'
      });
    }
  }
  return { routes, gatewayInfo: null };
}

// ── Parse Mikrotik RouterOS ───────────────────────────────────────
function rtpParseMikrotik(input) {
  const routes = [];
  const lines = input.split('\n');
  let headerPassed = false;
  for (const line of lines) {
    const t = line.trim();
    if (!t || t.includes('Flags:')) continue;
    if (t.includes('DST-ADDRESS')) { headerPassed = true; continue; }
    if (!headerPassed) continue;

    const p = t.split(/\s+/).filter(Boolean);
    if (p.length < 3) continue;

    const dstIdx = p.findIndex(x => x.includes('/'));
    if (dstIdx === -1) continue;
    
    const flags = p.slice(0, dstIdx).join('');
    const dst = p[dstIdx];
    const gateway = p[dstIdx + 1];
    const distance = p[p.length - 1];

    const [net, mask] = dst.split('/');
    const prefix = parseInt(mask);

    routes.push({
      network: net, prefix, cidr: dst, protocol: 'Static',
      adminDist: parseInt(distance) || 1, metric: '-',
      nextHop: gateway, iface: '-', isV6: dst.includes(':'),
      vrf: 'default',
      isCandidateDefault: prefix === 0,
      directlyConnected: flags.includes('C') || flags.includes('c')
    });
  }
  return { routes, gatewayInfo: null };
}

// ── Parse Cisco show ipv6 route ───────────────────────────────────
function rtpParseCiscoIpv6(input) {
  const routes = [];
  let currentVrf = 'default';

  for (const line of input.split('\n')) {
    const t = line.trim();
    if (!t || /^Codes:/i.test(t)) continue;

    const vrfMatch = t.match(/Routing Table: (\S+)/i);
    if (vrfMatch) { currentVrf = vrfMatch[1]; continue; }

    const nm = t.match(/([0-9a-fA-F:]+\/\d+)/i);
    if (!nm) continue;

    const cidr = nm[1];
    const pos = t.indexOf(cidr);
    const before = t.substring(0, pos).trim();
    const after = t.substring(pos + cidr.length).trim();

    const isCand = before.includes('*');
    const rawCode = before.replace(/\*/g, '').trim();
    const proto = RTP_CISCO_PROTO_MAP[rawCode] || rawCode;

    let ad = null, metric = null;
    const am = after.match(/\[(\d+)\/(\d+)\]/);
    if (am) { ad = parseInt(am[1]); metric = parseInt(am[2]); }

    let nextHop = null, iface = null;

    if (/directly connected/i.test(after) || /locally connected/i.test(after)) {
      const vm = after.match(/via\s+(\S+),/i);
      if (vm) iface = vm[1];
    } else {
      const vm = after.match(/via\s+([0-9a-fA-F:]+)/i);
      if (vm) nextHop = vm[1];
      const rest = after.replace(/via\s+[0-9a-fA-F:]+\s*,?\s*/i, '');
      const im = rest.match(/^(\S+)/);
      if (im) iface = im[1].replace(/,$/, '');
    }

    if (ad === null) ad = RTP_DEFAULT_AD[proto] ?? '-';

    const [net, pfxStr] = cidr.split('/');
    routes.push({
      network: net, prefix: parseInt(pfxStr), cidr, protocol: proto,
      adminDist: ad, metric: metric ?? '-',
      nextHop, iface: iface || '-', isV6: true,
      vrf: currentVrf,
      isCandidateDefault: isCand,
      directlyConnected: nextHop === null && !/via/i.test(after),
    });
  }
  return { routes, gatewayInfo: null };
}

// ── Parse Linux ip route show ─────────────────────────────────────
function rtpParseLinux(input) {
  const routes = [];

  for (const line of input.split('\n')) {
    const t = line.trim();
    if (!t) continue;

    let network, prefix, nextHop = null, iface = null, proto = 'Connected';
    let isV6 = false;

    if (t.startsWith('default')) {
      const v6via = t.match(/via\s+[0-9a-fA-F:]+/i);
      isV6 = !!v6via;
      network = isV6 ? '::' : '0.0.0.0';
      prefix = 0;
      const vm = t.match(/via\s+(\S+)/);
      if (vm) nextHop = vm[1];
      proto = 'Static';
    } else {
      const cm = t.match(/^([0-9a-fA-F:.]+\/\d+)/);
      if (!cm) continue;
      const cidr = cm[1];
      network = cidr.split('/')[0];
      prefix = parseInt(cidr.split('/')[1]);
      isV6 = network.includes(':');
      const vm = t.match(/via\s+(\S+)/);
      if (vm) { nextHop = vm[1]; proto = 'Static'; }
    }

    const dm = t.match(/dev\s+(\S+)/);
    if (dm) iface = dm[1];

    const pm = t.match(/proto\s+(\S+)/);
    if (pm) {
      const pn = pm[1];
      if (pn === 'kernel') proto = 'Connected';
      else if (/^(boot|static|dhcp)$/.test(pn)) proto = 'Static';
      else proto = pn.charAt(0).toUpperCase() + pn.slice(1);
    }

    const mMatch = t.match(/metric\s+(\d+)/);
    const metric = mMatch ? parseInt(mMatch[1]) : '-';

    routes.push({
      network, prefix, cidr: `${network}/${prefix}`, protocol: proto,
      adminDist: proto === 'Connected' ? 0 : 1, metric,
      nextHop, iface: iface || '-', isV6, vrf: 'default',
      isCandidateDefault: prefix === 0,
      directlyConnected: nextHop === null,
    });
  }
  return { routes, gatewayInfo: null };
}

// ── Parse netstat -rn ─────────────────────────────────────────────
function rtpParseNetstat(input) {
  const routes = [];
  let headerPassed = false;

  for (const line of input.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    if (/^Destination\s+Gateway\s+Genmask/i.test(t)) { headerPassed = true; continue; }
    if (!headerPassed) continue;

    const p = t.split(/\s+/);
    if (p.length < 5) continue;

    const dest = p[0], gateway = p[1], genmask = p[2], flags = p[3];
    const metricStr = p[4];
    const iface = p[p.length - 1];

    const mp = genmask.split('.').map(Number);
    const maskInt = ((mp[0] << 24) | (mp[1] << 16) | (mp[2] << 8) | mp[3]) >>> 0;
    let prefix = 0;
    for (let i = 31; i >= 0; i--) { if (maskInt & (1 << i)) prefix++; else break; }

    const isDefault = dest === '0.0.0.0' || dest === 'default';
    const network = isDefault ? '0.0.0.0' : dest;
    if (isDefault) prefix = 0;

    const isGw = flags.includes('G');
    const nextHop = (!isGw || gateway === '0.0.0.0' || gateway === '*')
      ? null : gateway;
    const proto = isDefault ? 'Static' : (nextHop === null ? 'Connected' : 'Static');

    routes.push({
      network, prefix, cidr: `${network}/${prefix}`, protocol: proto,
      adminDist: proto === 'Connected' ? 0 : 1,
      metric: parseInt(metricStr) || '-',
      nextHop, iface, vrf: 'default',
      isV6: false,
      isCandidateDefault: isDefault,
      directlyConnected: nextHop === null,
    });
  }
  return { routes, gatewayInfo: null };
}

// ── Main parse orchestrator ───────────────────────────────────────
function rtpParse(input) {
  const format = rtpDetectFormat(input);
  if (!format) return null;
  const vrf = rtpDetectVrf(input);
  const parsers = {
    cisco: rtpParseCisco,
    'cisco-ipv6': rtpParseCiscoIpv6,
    linux: rtpParseLinux,
    netstat: rtpParseNetstat,
    nexus: rtpParseNexus,
    'aruba-s': rtpParseArubaS,
    'aos-cx': rtpParseAosCx,
    juniper: rtpParseJuniper,
    arista: rtpParseArista,
    huawei: rtpParseHuawei,
    fortinet: rtpParseFortinet,
    mikrotik: rtpParseMikrotik
  };
  const result = (parsers[format] || rtpParseCisco)(input);
  return { ...result, format, vrf };
}

// ── Longest-prefix match ──────────────────────────────────────────
function rtpLongestMatch(routes, ip) {
  const v6 = rtpIsV6Addr(ip);
  const vrfMatches = {};

  for (const r of routes) {
    if (r.isV6 !== v6) continue;
    try {
      if (rtpIpInNet(ip, r.network, r.prefix, v6)) {
        const v = r.vrf || 'default';
        if (!vrfMatches[v]) vrfMatches[v] = [];
        vrfMatches[v].push(r);
      }
    } catch (_) { /* skip unparseable */ }
  }

  const results = [];
  for (const vrf in vrfMatches) {
    const matches = vrfMatches[vrf];
    matches.sort((a, b) => {
      if (b.prefix !== a.prefix) return b.prefix - a.prefix;
      const adA = typeof a.adminDist === 'number' ? a.adminDist : 999;
      const adB = typeof b.adminDist === 'number' ? b.adminDist : 999;
      return adA - adB;
    });
    results.push(matches[0]);
  }

  return results.length ? results : null;
}

// ── Inline styles ─────────────────────────────────────────────────
const RTP_STYLES = {
  textarea: {
    width: '100%', minHeight: 200, resize: 'vertical',
    fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.5,
    background: 'var(--panel)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: 10, color: 'var(--text)',
    boxSizing: 'border-box',
  },
  table: {
    width: '100%', borderCollapse: 'collapse',
    fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.5,
  },
  th: {
    textAlign: 'left', padding: '8px 10px', fontSize: 11,
    textTransform: 'uppercase', letterSpacing: 0.5,
    color: 'var(--dim)', borderBottom: '1px solid var(--border)',
    background: 'var(--panel)', whiteSpace: 'nowrap',
  },
  td: {
    padding: '6px 10px', borderBottom: '1px solid var(--border)',
    whiteSpace: 'nowrap', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis',
  },
  lookupResult: {
    padding: '10px 14px', background: 'rgba(0,212,200,0.08)',
    border: '1px solid rgba(0,212,200,0.25)', borderRadius: 'var(--radius)',
  },
  noMatch: {
    padding: '10px 14px', background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.25)', borderRadius: 'var(--radius)',
  },
  summaryGrid: {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8,
  },
  protoRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 },
};

// ── Component ─────────────────────────────────────────────────────
function RoutingTableParser({ initialData, onShare }) {
  const { t } = useTranslation();

  const [rtpInput, setRtpInput] = usePersistentState('routingTableParser:input', initialData?.input ?? '');
  const [rtpLookupIp, setRtpLookupIp] = usePersistentState('routingTableParser:lookupIp', initialData?.lookupIp ?? '');
  const [rtpParsed, setRtpParsed] = usePersistentState('routingTableParser:parsed', null);
  const [rtpFilterProto, setRtpFilterProto] = useState('all');
  const [rtpFilterVrf, setRtpFilterVrf] = useState('all');
  const [rtpLookupFilterVrf, setRtpLookupFilterVrf] = useState('all');
  const [rtpError, setRtpError] = useState(null);

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'routing-table-parser', input: rtpInput, lookupIp: rtpLookupIp });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [rtpInput, rtpLookupIp, onShare]);

  useEffect(() => {
    if (initialData?.input) {
      const res = rtpParse(initialData.input);
      if (res) setRtpParsed(res);
    }
  }, []);

  const rtpHandleParse = useCallback(() => {
    setRtpError(null);
    if (!rtpInput.trim()) { setRtpParsed(null); return; }
    const res = rtpParse(rtpInput);
    if (!res) { setRtpError(t('routingTableParser.error_format')); setRtpParsed(null); return; }
    if (res.routes.length === 0) { setRtpError(t('routingTableParser.no_routes')); setRtpParsed(null); return; }
    setRtpParsed(res);
  }, [rtpInput, t]);

  const rtpHandleClear = useCallback(() => {
    setRtpInput(''); setRtpParsed(null); setRtpError(null); setRtpLookupIp('');
    setRtpFilterProto('all'); setRtpFilterVrf('all'); setRtpLookupFilterVrf('all');
  }, []);

  const rtpRoutes = rtpParsed?.routes ?? [];

  const rtpFilteredRoutes = useMemo(() => {
    return rtpRoutes.filter(r => {
      const matchProto = rtpFilterProto === 'all' || r.protocol === rtpFilterProto;
      const matchVrf = rtpFilterVrf === 'all' || r.vrf === rtpFilterVrf;
      return matchProto && matchVrf;
    });
  }, [rtpRoutes, rtpFilterProto, rtpFilterVrf]);

  const rtpProtocols = useMemo(() => {
    const map = {};
    for (const r of rtpRoutes) map[r.protocol] = (map[r.protocol] || 0) + 1;
    return map;
  }, [rtpRoutes]);

  const rtpVrfs = useMemo(() => {
    const map = {};
    for (const r of rtpRoutes) {
      const v = r.vrf || 'default';
      map[v] = (map[v] || 0) + 1;
    }
    return map;
  }, [rtpRoutes]);

  const rtpDefaultRoute = useMemo(() => {
    return rtpRoutes.find(r => r.prefix === 0) || null;
  }, [rtpRoutes]);

  const rtpLookupResult = useMemo(() => {
    if (!rtpLookupIp.trim() || rtpRoutes.length === 0) return null;
    const ip = rtpLookupIp.trim();
    const isV6 = rtpIsV6Addr(ip);
    if (!isV6 && !/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return null;
    try {
      if (!isV6) rtpIpv4ToInt(ip);
      else rtpIpv6ToBig(ip);
    } catch { return null; }

    let routesToSearch = rtpRoutes;
    if (rtpLookupFilterVrf !== 'all') {
      routesToSearch = rtpRoutes.filter(r => (r.vrf || 'default') === rtpLookupFilterVrf);
    }
    return rtpLongestMatch(routesToSearch, ip);
  }, [rtpLookupIp, rtpRoutes, rtpLookupFilterVrf]);

  const rtpFormatLabel = useMemo(() => {
    if (!rtpParsed?.format) return '';
    const map = {
      cisco: t('routingTableParser.format_cisco'),
      'cisco-ipv6': t('routingTableParser.format_cisco_ipv6'),
      linux: t('routingTableParser.format_linux'),
      netstat: t('routingTableParser.format_netstat'),
      nexus: t('routingTableParser.format_nexus'),
      'aruba-s': t('routingTableParser.format_aruba_s'),
      'aos-cx': t('routingTableParser.format_aos_cx'),
      juniper: t('routingTableParser.format_juniper'),
      arista: t('routingTableParser.format_arista'),
      huawei: t('routingTableParser.format_huawei'),
      fortinet: t('routingTableParser.format_fortinet'),
      mikrotik: t('routingTableParser.format_mikrotik'),
    };
    return map[rtpParsed.format] || rtpParsed.format;
  }, [rtpParsed?.format, t]);

  const rtpExportRows = useMemo(() => rtpRoutes.map(r => ({
    network: r.cidr, vrf: r.vrf, protocol: r.protocol,
    admin_distance: String(r.adminDist), metric: String(r.metric),
    next_hop: r.directlyConnected ? t('routingTableParser.directly_connected') : (r.nextHop || '-'),
    interface: r.iface,
  })), [rtpRoutes, t]);

  const rtpRenderNextHop = (r) => {
    if (r.directlyConnected) {
      return <span style={{ color: 'var(--green)', fontSize: 12 }}>{t('routingTableParser.directly_connected')}</span>;
    }
    if (r.nextHop) return r.nextHop;
    return '-';
  };

  return (
    <div className="fadein">
      <div style={{ marginBottom: 8 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: 'var(--text)', margin: 0 }}>
          {t('routingTableParser.title')}
        </h3>
        <p style={{ fontSize: 13, color: 'var(--dim)', margin: '4px 0 0' }}>
          {t('routingTableParser.subtitle')}
        </p>
      </div>

      <div className="card">
        <div className="field">
          <label className="label">{t('routingTableParser.input_label')}</label>
          <textarea
            className="input"
            style={RTP_STYLES.textarea}
            value={rtpInput}
            onChange={e => setRtpInput(e.target.value)}
            placeholder={t('routingTableParser.input_placeholder')}
            spellCheck={false}
          />
        </div>
        <div className="btn-row" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost btn-sm" onClick={rtpHandleClear}>{t('routingTableParser.clear_btn')}</button>
          <button className="btn btn-primary btn-sm" onClick={rtpHandleParse} disabled={!rtpInput.trim()}>
            {t('routingTableParser.parse_btn')}
          </button>
        </div>
      </div>

      {rtpError && <Err msg={rtpError} />}

      {rtpParsed && (
        <div className="hint" style={{ marginBottom: 12 }}>
          {t('routingTableParser.detected_format', { format: rtpFormatLabel })}
          {rtpParsed.routes.length > 0 && ` \u2022 ${t('routingTableParser.routes_count', { count: rtpParsed.routes.length })}`}
        </div>
      )}

      {rtpParsed && rtpRoutes.length > 0 && (
        <div className="card">
          <div className="card-title">{t('routingTableParser.summary_title')}</div>

          <div style={RTP_STYLES.summaryGrid}>
            <div className="result-item">
              <div>
                <div className="result-label">{t('routingTableParser.summary_total')}</div>
                <div className="result-value" style={{ color: 'var(--cyan)', fontSize: 18 }}>{rtpRoutes.length}</div>
              </div>
            </div>
            {Object.keys(rtpVrfs).length <= 1 && (
              <div className="result-item">
                <div>
                  <div className="result-label">{t('routingTableParser.summary_default')}</div>
                  <div className="result-value" style={{ color: rtpDefaultRoute ? 'var(--yellow)' : 'var(--dim)', fontSize: 13 }}>
                    {rtpDefaultRoute
                      ? `${rtpDefaultRoute.nextHop || t('routingTableParser.directly_connected')}`
                      : t('routingTableParser.summary_default_none')}
                  </div>
                </div>
              </div>
            )}
            {Object.keys(rtpVrfs).length <= 1 && rtpParsed.vrf && (
              <div className="result-item">
                <div>
                  <div className="result-label">{t('routingTableParser.summary_vrf')}</div>
                  <div className="result-value" style={{ color: 'var(--yellow)', fontSize: 13 }}>{rtpParsed.vrf}</div>
                </div>
              </div>
            )}
            {rtpParsed.gatewayInfo && (
              <div className="result-item">
                <div>
                  <div className="result-label">{t('routingTableParser.gateway_last_resort')}</div>
                  <div className="result-value" style={{ color: 'var(--green)', fontSize: 13 }}>{rtpParsed.gatewayInfo}</div>
                </div>
              </div>
            )}
          </div>

          {Object.keys(rtpVrfs).length > 1 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                {t('routingTableParser.summary_per_vrf')}
              </div>
              <div style={RTP_STYLES.protoRow}>
                {Object.entries(rtpVrfs).sort((a, b) => b[1] - a[1]).map(([vrf, count]) => (
                  <span key={vrf} className="badge"
                    style={{ cursor: 'pointer', background: 'var(--bg)', color: 'var(--text)', border: '1px solid var(--border)', opacity: rtpFilterVrf === 'all' || rtpFilterVrf === vrf ? 1 : 0.5 }}
                    onClick={() => setRtpFilterVrf(rtpFilterVrf === vrf ? 'all' : vrf)}>
                    {vrf} ({count})
                  </span>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              {t('routingTableParser.summary_per_proto')}
            </div>
            <div style={RTP_STYLES.protoRow}>
              {Object.entries(rtpProtocols).sort((a, b) => b[1] - a[1]).map(([proto, count]) => (
                <span key={proto} className={`badge ${RTP_PROTO_BADGE[proto] || 'badge-cyan'}`}
                  style={{ cursor: 'pointer', opacity: rtpFilterProto === 'all' || rtpFilterProto === proto ? 1 : 0.5 }}
                  onClick={() => setRtpFilterProto(rtpFilterProto === proto ? 'all' : proto)}>
                  {proto} ({count})
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {rtpParsed && rtpRoutes.length > 0 && (
        <div className="card">
          <div className="card-title">{t('routingTableParser.lookup_title')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ flex: 1, minWidth: 200, marginBottom: 0 }}>
              <input
                className="input"
                style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
                value={rtpLookupIp}
                onChange={e => setRtpLookupIp(e.target.value)}
                placeholder={t('routingTableParser.lookup_placeholder')}
              />
            </div>
            {Object.keys(rtpVrfs).length > 1 && (
              <div className="field" style={{ marginBottom: 0 }}>
                <select className="input" style={{ width: 140, fontSize: 12 }}
                  value={rtpLookupFilterVrf} onChange={e => setRtpLookupFilterVrf(e.target.value)}>
                  <option value="all">{t('routingTableParser.filter_all_vrf')}</option>
                  {Object.keys(rtpVrfs).sort().map(v => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {rtpLookupIp.trim() && (
            <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {rtpLookupResult ? rtpLookupResult.map((res, idx) => (
                <div key={idx} style={RTP_STYLES.lookupResult}>
                  <div style={{ fontSize: 12, color: 'var(--cyan)', fontWeight: 600, marginBottom: 6 }}>
                    {t('routingTableParser.lookup_match')} {rtpLookupResult.length > 1 && `(${res.vrf})`}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 4 }}>
                    <div><span style={{ color: 'var(--dim)', fontSize: 11 }}>{t('routingTableParser.lookup_network')}</span>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--text)' }}>{res.cidr}</div></div>
                    {Object.keys(rtpVrfs).length > 1 && (
                      <div><span style={{ color: 'var(--dim)', fontSize: 11 }}>{t('routingTableParser.th_vrf')}</span>
                        <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{res.vrf}</div></div>
                    )}
                    <div><span style={{ color: 'var(--dim)', fontSize: 11 }}>{t('routingTableParser.lookup_protocol')}</span>
                      <div><span className={`badge ${RTP_PROTO_BADGE[res.protocol] || 'badge-cyan'}`}>{res.protocol}</span></div></div>
                    <div><span style={{ color: 'var(--dim)', fontSize: 11 }}>{t('routingTableParser.lookup_ad')}</span>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{res.adminDist}</div></div>
                    <div><span style={{ color: 'var(--dim)', fontSize: 11 }}>{t('routingTableParser.lookup_metric')}</span>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{res.metric}</div></div>
                    <div><span style={{ color: 'var(--dim)', fontSize: 11 }}>{t('routingTableParser.lookup_nexthop')}</span>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{rtpRenderNextHop(res)}</div></div>
                    <div><span style={{ color: 'var(--dim)', fontSize: 11 }}>{t('routingTableParser.lookup_interface')}</span>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{res.iface}</div></div>
                  </div>
                </div>
              )) : (
                <div style={RTP_STYLES.noMatch}>
                  <span style={{ color: 'var(--red)', fontSize: 13 }}>{t('routingTableParser.lookup_no_match')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {rtpParsed && rtpRoutes.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>{t('routingTableParser.table_title')}</div>
            <div style={{ flex: 1 }} />
            {Object.keys(rtpVrfs).length > 1 && (
              <select className="input" style={{ width: 140, fontSize: 12 }}
                value={rtpFilterVrf} onChange={e => setRtpFilterVrf(e.target.value)}>
                <option value="all">{t('routingTableParser.filter_all_vrf')}</option>
                {Object.keys(rtpVrfs).sort().map(v => (
                  <option key={v} value={v}>{v} ({rtpVrfs[v]})</option>
                ))}
              </select>
            )}
            <select className="input" style={{ width: 140, fontSize: 12 }}
              value={rtpFilterProto} onChange={e => setRtpFilterProto(e.target.value)}>
              <option value="all">{t('routingTableParser.filter_all')}</option>
              {Object.keys(rtpProtocols).sort().map(p => (
                <option key={p} value={p}>{p} ({rtpProtocols[p]})</option>
              ))}
            </select>
            <button className="btn btn-ghost btn-sm" onClick={() => exportJSON(rtpExportRows, 'routing-table.json')}>
              {t('common.export_json')}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(rtpExportRows, 'routing-table.csv')}>
              {t('common.export_csv')}
            </button>
          </div>

          <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <table style={RTP_STYLES.table}>
              <thead>
                <tr>
                  <th style={RTP_STYLES.th}>{t('routingTableParser.th_network')}</th>
                  {Object.keys(rtpVrfs).length > 1 && <th style={RTP_STYLES.th}>{t('routingTableParser.th_vrf')}</th>}
                  <th style={RTP_STYLES.th}>{t('routingTableParser.th_protocol')}</th>
                  <th style={RTP_STYLES.th}>{t('routingTableParser.th_ad')}</th>
                  <th style={RTP_STYLES.th}>{t('routingTableParser.th_metric')}</th>
                  <th style={RTP_STYLES.th}>{t('routingTableParser.th_nexthop')}</th>
                  <th style={RTP_STYLES.th}>{t('routingTableParser.th_interface')}</th>
                </tr>
              </thead>
              <tbody>
                {rtpFilteredRoutes.map((r, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'var(--panel)' }}>
                    <td style={{ ...RTP_STYLES.td, fontWeight: 600, color: r.prefix === 0 ? 'var(--yellow)' : 'var(--text)' }}>
                      {r.cidr}
                    </td>
                    {Object.keys(rtpVrfs).length > 1 && (
                      <td style={{ ...RTP_STYLES.td, color: 'var(--dim)', fontSize: 11 }}>{r.vrf}</td>
                    )}
                    <td style={RTP_STYLES.td}>
                      <span className={`badge ${RTP_PROTO_BADGE[r.protocol] || 'badge-cyan'}`}>{r.protocol}</span>
                    </td>
                    <td style={RTP_STYLES.td}>{r.adminDist}</td>
                    <td style={RTP_STYLES.td}>{r.metric}</td>
                    <td style={RTP_STYLES.td}>{rtpRenderNextHop(r)}</td>
                    <td style={RTP_STYLES.td}>{r.iface}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {rtpFilteredRoutes.length === 0 && (
            <div style={{ textAlign: 'center', padding: '20px', color: 'var(--dim)', fontSize: 13 }}>
              {t('common.no_results')}
            </div>
          )}
        </div>
      )}

      {!rtpParsed && !rtpError && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--dim)', fontSize: 13 }}>
          {t('routingTableParser.no_routes')}
        </div>
      )}
    </div>
  );
}
window.RoutingTableParser = RoutingTableParser;
