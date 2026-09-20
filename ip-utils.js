// ============================================================
// IPv4 Utilities
// ============================================================
const IPv4 = (() => {
  function parse(str) {
    if (!str) return null;
    const parts = str.trim().split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map(p => parseInt(p, 10));
    if (nums.some(n => isNaN(n) || n < 0 || n > 255)) return null;
    return ((nums[0] << 24) | (nums[1] << 16) | (nums[2] << 8) | nums[3]) >>> 0;
  }

  function str(n) {
    return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
  }

  function parseCIDR(s) {
    const parts = s.trim().split('/');
    if (parts.length !== 2) return null;
    const ip = parse(parts[0]);
    const prefix = parseInt(parts[1], 10);
    if (ip === null || isNaN(prefix) || prefix < 0 || prefix > 32) return null;
    return { ip, prefix };
  }

  function mask(prefix) {
    if (prefix === 0) return 0;
    if (prefix === 32) return 0xffffffff >>> 0;
    return (~0 << (32 - prefix)) >>> 0;
  }

  function subnet(ip, prefix) {
    const m = mask(prefix);
    const network = (ip & m) >>> 0;
    const broadcast = (network | (~m >>> 0)) >>> 0;
    const totalHosts = Math.pow(2, 32 - prefix);
    const usableHosts = prefix <= 30 ? totalHosts - 2 : (prefix === 31 ? 2 : 1);
    const firstHost = prefix <= 30 ? (network + 1) >>> 0 : network;
    const lastHost = prefix <= 30 ? (broadcast - 1) >>> 0 : broadcast;
    return {
      network, broadcast, firstHost, lastHost, mask: m,
      wildcard: (~m) >>> 0, totalHosts, usableHosts, prefix,
      networkStr: str(network),
      broadcastStr: str(broadcast),
      firstHostStr: str(firstHost),
      lastHostStr: str(lastHost),
      maskStr: str(m),
      wildcardStr: str((~m) >>> 0),
      cidr: `${str(network)}/${prefix}`,
      hostCount: usableHosts.toLocaleString(),
      totalCount: totalHosts.toLocaleString(),
    };
  }

  function classify(ip) {
    const a = (ip >>> 24) & 0xff;
    const b = (ip >>> 16) & 0xff;
    const c = (ip >>> 8) & 0xff;
    if (ip === 0) return { ipClass: '-', type: 'Unspecified (0.0.0.0)', scope: 'Special', rfc: 'RFC 1122' };
    if (ip === 0xffffffff) return { ipClass: '-', type: 'Limited Broadcast', scope: 'Link', rfc: 'RFC 919' };
    if (a === 0) return { ipClass: 'A', type: 'This Network', scope: 'Special', rfc: 'RFC 1122' };
    if (a === 10) return { ipClass: 'A', type: 'Private', scope: 'Private', rfc: 'RFC 1918' };
    if (a === 100 && b >= 64 && b <= 127) return { ipClass: 'B', type: 'Shared Address Space', scope: 'Private', rfc: 'RFC 6598' };
    if (a === 127) return { ipClass: 'A', type: 'Loopback', scope: 'Host', rfc: 'RFC 1122' };
    if (a === 169 && b === 254) return { ipClass: 'B', type: 'Link-Local / APIPA', scope: 'Link', rfc: 'RFC 3927' };
    if (a === 172 && b >= 16 && b <= 31) return { ipClass: 'B', type: 'Private', scope: 'Private', rfc: 'RFC 1918' };
    if (a === 192 && b === 0 && c === 0) return { ipClass: 'C', type: 'IETF Protocol Assignments', scope: 'Special', rfc: 'RFC 6890' };
    if (a === 192 && b === 0 && c === 2) return { ipClass: 'C', type: 'Documentation (TEST-NET-1)', scope: 'Docs', rfc: 'RFC 5737' };
    if (a === 192 && b === 88 && c === 99) return { ipClass: 'C', type: '6to4 Relay Anycast (deprecated)', scope: 'Special', rfc: 'RFC 7526' };
    if (a === 192 && b === 168) return { ipClass: 'C', type: 'Private', scope: 'Private', rfc: 'RFC 1918' };
    if (a === 198 && b >= 18 && b <= 19) return { ipClass: 'B', type: 'Benchmarking', scope: 'Special', rfc: 'RFC 2544' };
    if (a === 198 && b === 51 && c === 100) return { ipClass: 'C', type: 'Documentation (TEST-NET-2)', scope: 'Docs', rfc: 'RFC 5737' };
    if (a === 203 && b === 0 && c === 113) return { ipClass: 'C', type: 'Documentation (TEST-NET-3)', scope: 'Docs', rfc: 'RFC 5737' };
    if (a >= 224 && a <= 239) return { ipClass: 'D', type: 'Multicast', scope: 'Various', rfc: 'RFC 3171' };
    if (a >= 240 && a <= 254) return { ipClass: 'E', type: 'Reserved', scope: 'Reserved', rfc: 'RFC 1112' };
    if (a < 128) return { ipClass: 'A', type: 'Public', scope: 'Global', rfc: '-' };
    if (a < 192) return { ipClass: 'B', type: 'Public', scope: 'Global', rfc: '-' };
    if (a < 224) return { ipClass: 'C', type: 'Public', scope: 'Global', rfc: '-' };
    return { ipClass: '?', type: 'Unknown', scope: 'Unknown', rfc: '-' };
  }

  function toBinary(ip) {
    return [24, 16, 8, 0].map(s => ((ip >>> s) & 0xff).toString(2).padStart(8, '0')).join('.');
  }

  function toHex(ip) {
    return '0x' + ip.toString(16).toUpperCase().padStart(8, '0');
  }

  // Parse from binary string (with optional dots)
  function fromBinary(s) {
    const clean = s.replace(/[\s.]/g, '');
    if (!/^[01]{32}$/.test(clean)) return null;
    return parseInt(clean, 2) >>> 0;
  }

  // Parse from hex
  function fromHex(s) {
    const clean = s.replace(/^0x/i, '').replace(/\s/g, '');
    if (!/^[0-9a-fA-F]{1,8}$/.test(clean)) return null;
    return parseInt(clean, 16) >>> 0;
  }

  // Convert range to list of CIDRs
  function rangeToCIDRs(start, end) {
    const cidrs = [];
    let cur = start >>> 0;
    const endN = end >>> 0;
    while (cur <= endN) {
      let bits = 32;
      while (bits > 0) {
        const testMask = mask(bits - 1);
        if ((cur & testMask) !== cur) break;
        const testBcast = (cur | (~mask(bits - 1) >>> 0)) >>> 0;
        if (testBcast > endN) break;
        bits--;
      }
      cidrs.push(`${str(cur)}/${bits}`);
      const bc = (cur | (~mask(bits) >>> 0)) >>> 0;
      cur = (bc + 1) >>> 0;
      if (cur === 0) break;
    }
    return cidrs;
  }

  // VLSM: given parent CIDR and [{name, hosts}], return allocations
  function vlsm(parentIP, parentPrefix, requirements) {
    const sorted = requirements
      .map((r, i) => ({ ...r, origIdx: i }))
      .sort((a, b) => b.hosts - a.hosts);

    let curIP = (parentIP & mask(parentPrefix)) >>> 0;
    const parentBroadcast = ((parentIP & mask(parentPrefix)) | (~mask(parentPrefix) >>> 0)) >>> 0;
    const result = [];

    for (const req of sorted) {
      if (!req.hosts || req.hosts < 1) {
        result.push({ ...req, error: 'Invalid host count' });
        continue;
      }
      // Find smallest prefix that fits req.hosts usable hosts
      // For prefix p: usable = 2^(32-p) - 2 (for p<=30), 2 for p=31
      const hostBitsNeeded = Math.ceil(Math.log2(req.hosts + 2));
      let p = 32 - hostBitsNeeded;
      if (p < 0) p = 0;
      if (p > 30) p = 30; // /30 minimum for normal subnets (2 hosts)
      // Verify capacity (handle floating point edge cases like hosts=62 → log2(64)=6 exactly)
      const capacity = Math.pow(2, 32 - p) - 2;
      if (capacity < req.hosts) p--;
      if (p < 0) { result.push({ ...req, error: 'Host count too large' }); continue; }
      if (p < parentPrefix) { result.push({ ...req, error: 'Exceeds parent network' }); continue; }

      // Align curIP up to the next p-bit boundary
      const blockSize = Math.pow(2, 32 - p);
      curIP = (Math.ceil(curIP / blockSize) * blockSize) >>> 0;

      const sn = subnet(curIP, p);
      if (sn.broadcast > parentBroadcast) {
        result.push({ ...req, error: 'No space remaining' });
        continue;
      }
      result.push({ ...req, subnet: sn, prefix: p, error: null });
      curIP = (sn.broadcast + 1) >>> 0;
    }
    return result.sort((a, b) => a.origIdx - b.origIdx);
  }

  // Supernet: find smallest CIDR covering all given CIDRs/IPs
  function supernet(ips) {
    if (!ips.length) return null;
    let minIP = ips[0] >>> 0;
    let maxIP = ips[0] >>> 0;
    for (const ip of ips) {
      const n = ip >>> 0;
      if (n < minIP) minIP = n;
      if (n > maxIP) maxIP = n;
    }
    // XOR to find differing bits
    const xor = (minIP ^ maxIP) >>> 0;
    let bits = 0;
    let temp = xor;
    while (temp > 0) { bits++; temp >>>= 1; }
    const prefix = 32 - bits;
    return subnet(minIP, prefix);
  }

  return { parse, str, parseCIDR, mask, subnet, classify, toBinary, toHex, fromBinary, fromHex, rangeToCIDRs, vlsm, supernet };
})();

// ============================================================
// IPv6 Utilities
// ============================================================
const IPv6 = (() => {
  function expand(str) {
    if (!str || !str.trim()) return null;
    let s = str.trim().toLowerCase();
    // Handle ::
    if (s.includes(':::')) return null;
    const halves = s.split('::');
    if (halves.length > 2) return null;
    let groups;
    if (halves.length === 2) {
      const left = halves[0] ? halves[0].split(':') : [];
      const right = halves[1] ? halves[1].split(':') : [];
      const missing = 8 - left.length - right.length;
      if (missing < 0) return null;
      groups = [...left, ...Array(missing).fill('0'), ...right];
    } else {
      groups = s.split(':');
    }
    if (groups.length !== 8) return null;
    const expanded = groups.map(g => {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      return g.padStart(4, '0');
    });
    if (expanded.some(g => g === null)) return null;
    return expanded.join(':');
  }

  function compress(str) {
    const exp = expand(str);
    if (!exp) return null;
    const groups = exp.split(':');
    // Remove leading zeros
    const stripped = groups.map(g => g.replace(/^0+/, '') || '0');
    // Find longest run of consecutive '0' groups
    let best = { start: -1, len: 0 };
    let cur = { start: -1, len: 0 };
    for (let i = 0; i < 8; i++) {
      if (stripped[i] === '0') {
        if (cur.start === -1) cur = { start: i, len: 1 };
        else cur.len++;
        if (cur.len > best.len) best = { ...cur };
      } else {
        cur = { start: -1, len: 0 };
      }
    }
    if (best.len > 1) {
      const before = stripped.slice(0, best.start).join(':');
      const after = stripped.slice(best.start + best.len).join(':');
      return (before ? before + '::' : '::') + after;
    }
    return stripped.join(':');
  }

  function classify(str) {
    const exp = expand(str);
    if (!exp) return null;
    const groups = exp.split(':').map(g => parseInt(g, 16));
    const first = groups[0];
    const second = groups[1];
    if (exp === '0000:0000:0000:0000:0000:0000:0000:0001') return { type: 'Loopback', scope: 'Host', rfc: 'RFC4291' };
    if (exp === '0000:0000:0000:0000:0000:0000:0000:0000') return { type: 'Unspecified', scope: 'Special', rfc: 'RFC4291' };
    if (exp.startsWith('fe80')) return { type: 'Link-Local Unicast', scope: 'Link', rfc: 'RFC4291' };
    if (exp.startsWith('fc') || exp.startsWith('fd')) return { type: 'Unique Local (ULA)', scope: 'Private', rfc: 'RFC4193' };
    if (exp.startsWith('ff')) return { type: 'Multicast', scope: 'Various', rfc: 'RFC4291' };
    if (exp.startsWith('2002')) return { type: '6to4', scope: 'Global', rfc: 'RFC3056' };
    if (exp.startsWith('2001:0db8')) return { type: 'Documentation', scope: 'Docs', rfc: 'RFC3849' };
    if (exp.startsWith('2001:0000')) return { type: 'Teredo', scope: 'Global', rfc: 'RFC4380' };
    if (exp.startsWith('0000:0000:0000:0000:0000:ffff')) return { type: 'IPv4-Mapped', scope: 'Special', rfc: 'RFC4291' };
    if (first >= 0x2000 && first <= 0x3fff) return { type: 'Global Unicast', scope: 'Global', rfc: 'RFC4291' };
    return { type: 'Other/Reserved', scope: 'Unknown', rfc: '-' };
  }

  function subnetInfo(cidrStr) {
    const parts = cidrStr.trim().split('/');
    if (parts.length !== 2) return null;
    const exp = expand(parts[0]);
    const prefix = parseInt(parts[1], 10);
    if (!exp || isNaN(prefix) || prefix < 0 || prefix > 128) return null;
    const totalAddresses = prefix <= 64 ? `2^${128 - prefix}` : Math.pow(2, 128 - prefix).toLocaleString();
    return {
      expanded: exp,
      compressed: compress(parts[0]),
      prefix,
      totalAddresses,
      type: classify(parts[0]),
    };
  }

  return { expand, compress, classify, subnetInfo };
})();

// ============================================================
// Multicast Utilities
// ============================================================
const Multicast = (() => {

  // --- IPv4 multicast IP → Ethernet MAC ---
  function ipv4ToMac(ipUint32) {
    const low23 = ipUint32 & 0x007FFFFF;
    const b3 = (low23 >> 16) & 0x7F;
    const b4 = (low23 >> 8) & 0xFF;
    const b5 = low23 & 0xFF;
    return `01:00:5E:${b3.toString(16).padStart(2,'0')}:${b4.toString(16).padStart(2,'0')}:${b5.toString(16).padStart(2,'0')}`;
  }

  // --- Ethernet MAC (01:00:5E:xx:xx:xx) → all 32 possible IPv4 multicast IPs ---
  function macToIpv4Set(macStr) {
    const clean = macStr.replace(/[:\-\.]/g, '').toUpperCase();
    if (!/^[0-9A-F]{12}$/.test(clean)) return null;
    const bytes = clean.match(/.{2}/g).map(b => parseInt(b, 16));
    if (bytes[0] !== 0x01 || bytes[1] !== 0x00 || bytes[2] !== 0x5E) return null;
    const low23 = ((bytes[3] & 0x7F) << 16) | (bytes[4] << 8) | bytes[5];
    const results = [];
    for (let lo4 = 0; lo4 < 16; lo4++) {
      for (let hiBit = 0; hiBit < 2; hiBit++) {
        const ip = ((0xE0 | lo4) << 24 | hiBit << 23 | low23) >>> 0;
        results.push(IPv4.str(ip));
      }
    }
    return results.sort();
  }

  // --- IPv6 multicast → Ethernet MAC (33:33:xx:xx:xx:xx) ---
  function ipv6ToMac(expanded) {
    const groups = expanded.split(':').map(g => parseInt(g, 16));
    const last32_hi = groups[6];
    const last32_lo = groups[7];
    const b2 = (last32_hi >> 8) & 0xFF;
    const b3 = last32_hi & 0xFF;
    const b4 = (last32_lo >> 8) & 0xFF;
    const b5 = last32_lo & 0xFF;
    return `33:33:${b2.toString(16).padStart(2,'0')}:${b3.toString(16).padStart(2,'0')}:${b4.toString(16).padStart(2,'0')}:${b5.toString(16).padStart(2,'0')}`;
  }

  // --- IPv4 multicast address classification ---
  function classifyIPv4(ipUint32) {
    const a = (ipUint32 >>> 24) & 0xFF;
    const b = (ipUint32 >>> 16) & 0xFF;
    const c = (ipUint32 >>> 8) & 0xFF;
    const d = ipUint32 & 0xFF;
    if (a < 224 || a > 239) return null;

    let scope, block, rfc, isSSM = false, ttlThreshold = 1, description = '';

    if (a === 224 && b === 0 && c === 0) {
      scope = 'Link-Local'; block = '224.0.0.0/24'; rfc = 'RFC3171'; description = 'Local Network Control Block';
    } else if (a === 224 && b === 0 && c < 1) {
      scope = 'Link-Local'; block = '224.0.0.0/24'; rfc = 'RFC3171'; description = 'Local Network Control Block';
    } else if (a === 224 && b === 0 && c === 1 && d === 0) {
      scope = 'Internetwork'; block = '224.0.1.0/24'; rfc = 'RFC3171'; description = 'Internetwork Control Block'; ttlThreshold = 32;
    } else if (a === 224 && b === 0 && c === 1) {
      scope = 'Internetwork'; block = '224.0.1.0/24'; rfc = 'RFC3171'; description = 'Internetwork Control Block'; ttlThreshold = 32;
    } else if (a === 224 && b === 0 && c >= 2) {
      scope = 'AD-HOC'; block = '224.0.2.0 - 224.0.255.255'; rfc = 'RFC3171'; description = 'AD-HOC Block'; ttlThreshold = 32;
    } else if (a === 224 && b === 1) {
      scope = 'AD-HOC'; block = '224.1.0.0/16'; rfc = 'RFC3171'; description = 'ST Multicast Groups (deprecated)'; ttlThreshold = 32;
    } else if (a === 224 && b === 2) {
      scope = 'AD-HOC'; block = '224.2.0.0/16'; rfc = 'RFC2974'; description = 'SDP/SAP Announcements'; ttlThreshold = 32;
    } else if (a >= 224 && a <= 231) {
      scope = 'Global'; block = '224.0.0.0 - 231.255.255.255'; rfc = 'RFC5771'; description = 'Various Well-Known'; ttlThreshold = 64;
    } else if (a === 232) {
      scope = 'Global'; block = '232.0.0.0/8'; rfc = 'RFC4607'; description = 'Source-Specific Multicast (SSM)'; isSSM = true; ttlThreshold = 64;
    } else if (a === 233) {
      scope = 'Global'; block = '233.0.0.0/8'; rfc = 'RFC3180'; description = 'GLOP Addressing'; ttlThreshold = 64;
    } else if (a === 234) {
      scope = 'Global'; block = '234.0.0.0/8'; rfc = 'RFC6084'; description = 'Unicast-Prefix-Based Multicast'; ttlThreshold = 64;
    } else if (a >= 235 && a <= 238) {
      scope = 'Global'; block = '235.0.0.0 - 238.255.255.255'; rfc = 'RFC5771'; description = 'Reserved'; ttlThreshold = 64;
    } else if (a === 239) {
      scope = 'Admin-Scoped'; block = '239.0.0.0/8'; rfc = 'RFC2365'; description = 'Administratively Scoped'; ttlThreshold = 0;
    }

    // Check for link-local sub-range
    if (a === 224 && b === 0) {
      scope = 'Link-Local'; ttlThreshold = 1;
    }

    let asNumber = null;
    if (a === 233) asNumber = glopToAs(b, c);

    return { scope, block, rfc, isSSM, ttlThreshold, description, asNumber, ipClass: 'D' };
  }

  // --- IPv6 multicast address classification ---
  function classifyIPv6(expanded) {
    if (!expanded.startsWith('ff')) return null;
    const groups = expanded.split(':').map(g => parseInt(g, 16));
    const scopeVal = groups[0] & 0x0F;
    const flagsByte = (groups[0] >> 4) & 0x0F;
    const flagT = (flagsByte & 0x01) !== 0;
    const flagP = (flagsByte & 0x02) !== 0;
    const scopeInfo = IPv6_SCOPES.find(s => s.value === scopeVal) || { name: 'Unknown', rfc: '-' };
    const isSSM = scopeVal !== 0 && (groups[2] !== 0 || groups[3] !== 0);

    return {
      scope: scopeVal,
      scopeName: scopeInfo.name,
      flags: flagsByte,
      flagT,
      flagP,
      isSSM,
      description: scopeInfo.name + ' Multicast',
      rfc: scopeInfo.rfc,
    };
  }

  // --- GLOP: AS number ↔ 233.x.y.0/24 ---
  function asToGlop(asNum) {
    if (asNum < 0 || asNum > 65535) return null;
    const x = (asNum >> 8) & 0xFF;
    const y = asNum & 0xFF;
    return { x, y, block: `233.${x}.${y}.0/24` };
  }

  function glopToAs(x, y) {
    return (x << 8) | y;
  }

  // --- Solicited-Node Multicast ---
  function solicitedNode(expanded) {
    if (!expanded) return null;
    const groups = expanded.split(':').map(g => parseInt(g, 16));
    const low24 = ((groups[6] & 0xFF) << 16) | groups[7];
    const x = (low24 >> 16) & 0xFF;
    const y = low24 & 0xFFFF;
    const solicited = `ff02:0000:0000:0000:0000:0001:ff${x.toString(16).padStart(2,'0')}:${y.toString(16).padStart(4,'0')}`;
    return {
      solicited: IPv6.compress(solicited),
      solicitedExpanded: solicited,
      mac: ipv6ToMac(solicited)
    };
  }

  // --- Data Tables ---

  const WELL_KNOWN_IPV4 = [
    { addr: '224.0.0.0', proto: 'BASE', desc: 'Base Address (reserved)', rfc: 'RFC1112' },
    { addr: '224.0.0.1', proto: 'ALL-HOSTS', desc: 'All Hosts on this Subnet', rfc: 'RFC1112' },
    { addr: '224.0.0.2', proto: 'ALL-ROUTERS', desc: 'All Routers on this Subnet', rfc: 'RFC1112' },
    { addr: '224.0.0.4', proto: 'DVMRP', desc: 'DVMRP Routers', rfc: 'RFC1075' },
    { addr: '224.0.0.5', proto: 'OSPF', desc: 'OSPF All Routers (DRothers)', rfc: 'RFC2328' },
    { addr: '224.0.0.6', proto: 'OSPF-DR', desc: 'OSPF Designated Routers', rfc: 'RFC2328' },
    { addr: '224.0.0.7', proto: 'ST', desc: 'ST Discovery', rfc: 'RFC1190' },
    { addr: '224.0.0.8', proto: 'ST2', desc: 'ST-II', rfc: 'RFC1819' },
    { addr: '224.0.0.9', proto: 'RIP2', desc: 'RIP2 Routers', rfc: 'RFC1723' },
    { addr: '224.0.0.10', proto: 'EIGRP', desc: 'EIGRP Routers', rfc: 'Cisco' },
    { addr: '224.0.0.11', proto: 'MOBILE-IP', desc: 'Mobile Agents', rfc: 'RFC5949' },
    { addr: '224.0.0.12', proto: 'DHCP', desc: 'DHCP Server / Relay Agent', rfc: 'RFC1884' },
    { addr: '224.0.0.13', proto: 'PIM', desc: 'All PIM Routers', rfc: 'RFC4601' },
    { addr: '224.0.0.14', proto: 'RSVP', desc: 'RSVP Encapsulation', rfc: 'RFC2205' },
    { addr: '224.0.0.15', proto: 'CBT', desc: 'All CBT Routers', rfc: 'RFC2189' },
    { addr: '224.0.0.16', proto: 'S-G-ROUTERS', desc: 'Designated S-G Routers', rfc: '-' },
    { addr: '224.0.0.17', proto: 'GGP', desc: 'All GGP Routers', rfc: '-' },
    { addr: '224.0.0.18', proto: 'VRRP', desc: 'VRRP', rfc: 'RFC5798' },
    { addr: '224.0.0.19', proto: 'IS-IS-L1', desc: 'IS-IS Level 1 Routers', rfc: 'RFC1195' },
    { addr: '224.0.0.20', proto: 'IS-IS-L2', desc: 'IS-IS Level 2 Routers', rfc: 'RFC1195' },
    { addr: '224.0.0.21', proto: 'DVMRP', desc: 'DVMRP Routers', rfc: 'RFC1075' },
    { addr: '224.0.0.22', proto: 'IGMP', desc: 'IGMP', rfc: 'RFC3376' },
    { addr: '224.0.0.25', proto: 'RGMP', desc: 'Router-port Group Management', rfc: 'RFC3488' },
    { addr: '224.0.0.102', proto: 'HSRP', desc: 'HSRP', rfc: 'RFC2281' },
    { addr: '224.0.0.251', proto: 'MDNS', desc: 'mDNS (Multicast DNS)', rfc: 'RFC6762' },
    { addr: '224.0.0.252', proto: 'LLMNR', desc: 'Link-Local Multicast Name Resolution', rfc: 'RFC4795' },
    { addr: '224.0.1.1', proto: 'NTP', desc: 'Network Time Protocol', rfc: 'RFC5905' },
    { addr: '224.0.1.22', proto: 'SVRLOC', desc: 'Service Location Protocol', rfc: 'RFC2165' },
    { addr: '224.0.1.35', proto: 'SRVSVC', desc: 'SVRLOC Directory Agent', rfc: 'RFC2608' },
    { addr: '224.0.1.39', proto: 'CISCO-RP-ANN', desc: 'Cisco RP Announce', rfc: 'Cisco' },
    { addr: '224.0.1.40', proto: 'CISCO-RP-DISC', desc: 'Cisco RP Discovery', rfc: 'Cisco' },
    { addr: '224.0.1.60', proto: 'HP-DISC', desc: 'HP Device Discovery', rfc: '-' },
    { addr: '224.0.1.75', proto: 'IAPP', desc: 'IEEE 802.11f IAPP', rfc: '-' },
    { addr: '224.0.1.129', proto: 'PTP-PRI', desc: 'PTP Primary (IEEE 1588)', rfc: 'RFC5905' },
    { addr: '224.0.1.130', proto: 'PTP-EVENT', desc: 'PTP Event (IEEE 1588)', rfc: 'RFC5905' },
    { addr: '224.0.1.131', proto: 'PTP-GEN', desc: 'PTP General (IEEE 1588)', rfc: 'RFC5905' },
    { addr: '224.0.1.140', proto: 'SLP-DA', desc: 'SLP Directory Agent Discovery', rfc: 'RFC2608' },
    { addr: '224.2.127.254', proto: 'SAP', desc: 'SAP/SDP Announcements', rfc: 'RFC2974' },
    { addr: '232.0.0.0/8', proto: 'SSM', desc: 'Source-Specific Multicast Range', rfc: 'RFC4607' },
    { addr: '233.0.0.0/8', proto: 'GLOP', desc: 'GLOP Addressing Range', rfc: 'RFC3180' },
    { addr: '239.255.255.250', proto: 'SSDP', desc: 'Simple Service Discovery (UPnP)', rfc: 'UPnP' },
    { addr: '239.255.255.253', proto: 'MDNS-SD', desc: 'mDNS Service Discovery', rfc: 'RFC6763' },
  ];

  const WELL_KNOWN_IPV6 = [
    { addr: 'ff01::1', proto: 'ALL-NODES-I', desc: 'All Nodes (interface-local)', rfc: 'RFC4291' },
    { addr: 'ff01::2', proto: 'ALL-ROUTERS-I', desc: 'All Routers (interface-local)', rfc: 'RFC4291' },
    { addr: 'ff02::1', proto: 'ALL-NODES-L', desc: 'All Nodes (link-local)', rfc: 'RFC4291' },
    { addr: 'ff02::2', proto: 'ALL-ROUTERS-L', desc: 'All Routers (link-local)', rfc: 'RFC4291' },
    { addr: 'ff02::4', proto: 'DVMRP', desc: 'DVMRP Routers', rfc: 'RFC1075' },
    { addr: 'ff02::5', proto: 'OSPF', desc: 'OSPF All Routers', rfc: 'RFC5340' },
    { addr: 'ff02::6', proto: 'OSPF-DR', desc: 'OSPF Designated Routers', rfc: 'RFC5340' },
    { addr: 'ff02::9', proto: 'RIPng', desc: 'RIPng Routers', rfc: 'RFC2080' },
    { addr: 'ff02::a', proto: 'EIGRP', desc: 'EIGRP Routers', rfc: 'Cisco' },
    { addr: 'ff02::d', proto: 'PIM', desc: 'All PIM Routers', rfc: 'RFC4601' },
    { addr: 'ff02::12', proto: 'VRRP', desc: 'VRRP for IPv6', rfc: 'RFC5798' },
    { addr: 'ff02::16', proto: 'MLD', desc: 'MLDv2 Reports', rfc: 'RFC3810' },
    { addr: 'ff02::1:2', proto: 'DHCP-RELAY', desc: 'DHCPv6 Relay Agents/Servers', rfc: 'RFC3315' },
    { addr: 'ff02::1:3', proto: 'LLMNR', desc: 'Link-Local Multicast Name Resolution', rfc: 'RFC4795' },
    { addr: 'ff02::fb', proto: 'MDNS', desc: 'mDNS (Multicast DNS)', rfc: 'RFC6762' },
    { addr: 'ff02::1:ff00:0', proto: 'SOLICITED', desc: 'Solicited-Node Address prefix', rfc: 'RFC4291' },
    { addr: 'ff05::2', proto: 'ALL-ROUTERS-S', desc: 'All Routers (site-local)', rfc: 'RFC4291' },
    { addr: 'ff05::1:3', proto: 'DHCP-SITE', desc: 'DHCPv6 Site-Local Servers', rfc: 'RFC3315' },
    { addr: 'ff0e::1', proto: 'ALL-NODES-G', desc: 'All Nodes (global scope)', rfc: 'RFC4291' },
    { addr: 'ff0e::2', proto: 'ALL-ROUTERS-G', desc: 'All Routers (global scope)', rfc: 'RFC4291' },
  ];

  const TTL_THRESHOLDS = [
    { ttl: 0, scope: 'Restricted to same host', color: '#ef4444' },
    { ttl: 1, scope: 'Restricted to same subnet (link-local)', color: '#f59e0b' },
    { ttl: 15, scope: 'Restricted to same site', color: '#22c55e' },
    { ttl: 31, scope: 'Restricted to same site (alternate)', color: '#22c55e' },
    { ttl: 63, scope: 'Restricted to same region', color: '#06b6d4' },
    { ttl: 127, scope: 'Restricted to same continent', color: '#3b82f6' },
    { ttl: 191, scope: 'Unrestricted (global)', color: '#8b5cf6' },
    { ttl: 255, scope: 'Unrestricted (maximum)', color: '#8b5cf6' },
  ];

  const IPv6_SCOPES = [
    { value: 0, name: 'Reserved', rfc: 'RFC4291' },
    { value: 1, name: 'Interface-Local', rfc: 'RFC4291' },
    { value: 2, name: 'Link-Local', rfc: 'RFC4291' },
    { value: 3, name: 'Realm-Local', rfc: 'RFC4291' },
    { value: 4, name: 'Admin-Local', rfc: 'RFC4291' },
    { value: 5, name: 'Site-Local', rfc: 'RFC4291' },
    { value: 8, name: 'Organization-Local', rfc: 'RFC4291' },
    { value: 14, name: 'Global', rfc: 'RFC4291' },
    { value: 15, name: 'Reserved', rfc: 'RFC4291' },
  ];

  const IPV4_BLOCKS = [
    { range: '224.0.0.0/24', name: 'Local Network Control', rfc: 'RFC3171', scope: 'Link-Local', ttl: 1 },
    { range: '224.0.1.0/24', name: 'Internetwork Control', rfc: 'RFC3171', scope: 'Internetwork', ttl: 32 },
    { range: '224.0.2.0 - 224.0.255.255', name: 'AD-HOC Block', rfc: 'RFC3171', scope: 'AD-HOC', ttl: 32 },
    { range: '224.1.0.0/16', name: 'ST Multicast (deprecated)', rfc: 'RFC3171', scope: 'AD-HOC', ttl: 32 },
    { range: '224.2.0.0/16', name: 'SDP/SAP Announcements', rfc: 'RFC2974', scope: 'AD-HOC', ttl: 32 },
    { range: '224.3.0.0 - 231.255.255.255', name: 'Well-Known (IANA)', rfc: 'RFC5771', scope: 'Global', ttl: 64 },
    { range: '232.0.0.0/8', name: 'Source-Specific Multicast (SSM)', rfc: 'RFC4607', scope: 'Global', ttl: 64 },
    { range: '233.0.0.0/8', name: 'GLOP Addressing', rfc: 'RFC3180', scope: 'Global', ttl: 64 },
    { range: '234.0.0.0/8', name: 'Unicast-Prefix-Based', rfc: 'RFC6084', scope: 'Global', ttl: 64 },
    { range: '235.0.0.0 - 238.255.255.255', name: 'Reserved', rfc: 'RFC5771', scope: 'Global', ttl: 64 },
    { range: '239.0.0.0/8', name: 'Administratively Scoped', rfc: 'RFC2365', scope: 'Admin-Scoped', ttl: 0 },
  ];

  return {
    ipv4ToMac, macToIpv4Set, ipv6ToMac,
    classifyIPv4, classifyIPv6,
    asToGlop, glopToAs, solicitedNode,
    WELL_KNOWN_IPV4, WELL_KNOWN_IPV6,
    TTL_THRESHOLDS, IPv6_SCOPES, IPV4_BLOCKS,
  };
})();

// ─── IP Reference Data (used by CheatSheet & ShareModal) ─────────────────────
const CLASS_TABLE = [
  { cls: 'A', range: '1 – 126', mask: '255.0.0.0', networks: '126', hostsPerNet: '16,777,214', use: 'Very large networks', key: 'cls_a' },
  { cls: 'B', range: '128 – 191', mask: '255.255.0.0', networks: '16,384', hostsPerNet: '65,534', use: 'Medium-large networks', key: 'cls_b' },
  { cls: 'C', range: '192 – 223', mask: '255.255.255.0', networks: '2,097,152', hostsPerNet: '254', use: 'Small networks', key: 'cls_c' },
  { cls: 'D', range: '224 – 239', mask: 'N/A (multicast)', networks: '—', hostsPerNet: '—', use: 'Multicast groups', key: 'cls_d' },
  { cls: 'E', range: '240 – 255', mask: 'N/A (reserved)', networks: '—', hostsPerNet: '—', use: 'Experimental / reserved', key: 'cls_e' },
];

const PRIVATE_RANGES = [
  { range: '10.0.0.0/8', start: '10.0.0.0', end: '10.255.255.255', hosts: '16,777,216', rfc: 'RFC 1918', use: 'Private LAN (Class A)', key: 'priv_lan_a' },
  { range: '172.16.0.0/12', start: '172.16.0.0', end: '172.31.255.255', hosts: '1,048,576', rfc: 'RFC 1918', use: 'Private LAN (Class B)', key: 'priv_lan_b' },
  { range: '192.168.0.0/16', start: '192.168.0.0', end: '192.168.255.255', hosts: '65,536', rfc: 'RFC 1918', use: 'Private LAN (Class C)', key: 'priv_lan_c' },
  { range: '100.64.0.0/10', start: '100.64.0.0', end: '100.127.255.255', hosts: '4,194,304', rfc: 'RFC 6598', use: 'Carrier-grade NAT (CGN)', key: 'priv_cgn' },
  { range: '169.254.0.0/16', start: '169.254.0.0', end: '169.254.255.255', hosts: '65,536', rfc: 'RFC 3927', use: 'Link-local (APIPA)', key: 'priv_link' },
  { range: '127.0.0.0/8', start: '127.0.0.0', end: '127.255.255.255', hosts: '16,777,216', rfc: 'RFC 1122', use: 'Loopback', key: 'priv_loop' },
];

const SPECIAL_RANGES = [
  { range: '0.0.0.0/8', rfc: 'RFC 1122', use: 'Current network (only valid as source)', key: 'spec_current' },
  { range: '100.64.0.0/10', rfc: 'RFC 6598', use: 'Shared address space (CGN)', key: 'spec_cgn' },
  { range: '192.0.0.0/24', rfc: 'RFC 6890', use: 'IETF Protocol Assignments', key: 'spec_ietf' },
  { range: '192.0.2.0/24', rfc: 'RFC 5737', use: 'Documentation (TEST-NET-1)', key: 'spec_testnet1' },
  { range: '198.51.100.0/24', rfc: 'RFC 5737', use: 'Documentation (TEST-NET-2)', key: 'spec_testnet2' },
  { range: '203.0.113.0/24', rfc: 'RFC 5737', use: 'Documentation (TEST-NET-3)', key: 'spec_testnet3' },
  { range: '224.0.0.0/4', rfc: 'RFC 3171', use: 'Multicast', key: 'spec_mcast' },
  { range: '240.0.0.0/4', rfc: 'RFC 1112', use: 'Reserved for future use', key: 'spec_reserved' },
  { range: '255.255.255.255/32', rfc: 'RFC 0919', use: 'Limited broadcast', key: 'spec_broadcast' },
];

const IPV6_SPECIAL = [
  { addr: '::1/128', type: 'Loopback', rfc: 'RFC 4291', use: 'Host loopback address', key: 'v6_loopback' },
  { addr: '::/128', type: 'Unspecified', rfc: 'RFC 4291', use: 'Default route / unspecified address', key: 'v6_unspecified' },
  { addr: '64:ff9b::/96', type: 'NAT64', rfc: 'RFC 6052', use: 'Well-known NAT64 prefix', key: 'v6_nat64_wk' },
  { addr: '::ffff:0:0/96', type: 'IPv4-mapped', rfc: 'RFC 4291', use: 'IPv4-mapped IPv6 addresses', key: 'v6_v4mapped' },
  { addr: '64:ff9b:1::/48', type: 'NAT64', rfc: 'RFC 6052', use: 'Local-use NAT64 prefix', key: 'v6_nat64_local' },
  { addr: '100::/64', type: 'Discard', rfc: 'RFC 6666', use: 'Discard-only prefix', key: 'v6_discard' },
  { addr: '2001::/23', type: 'IETF Protocol', rfc: 'RFC 2928', use: 'IETF protocol assignments', key: 'v6_ietf' },
  { addr: '2001::/32', type: 'Teredo', rfc: 'RFC 4380', use: 'Teredo tunneling', key: 'v6_teredo' },
  { addr: '2001:2::/48', type: 'Benchmarking', rfc: 'RFC 5180', use: 'Benchmarking', key: 'v6_bench' },
  { addr: '2001:db8::/32', type: 'Documentation', rfc: 'RFC 3849', use: 'Documentation examples', key: 'v6_doc' },
  { addr: '2002::/16', type: '6to4', rfc: 'RFC 3056', use: '6to4 tunneling (deprecated)', key: 'v6_6to4' },
  { addr: 'fc00::/7', type: 'Unique Local', rfc: 'RFC 4193', use: 'Private network addresses (ULA)', key: 'v6_ula' },
  { addr: 'fe80::/10', type: 'Link-Local', rfc: 'RFC 4291', use: 'Link-local addresses', key: 'v6_link' },
  { addr: 'ff00::/8', type: 'Multicast', rfc: 'RFC 4291', use: 'IPv6 multicast addresses', key: 'v6_mcast' },
];

// Reuse Multicast.IPv6_SCOPES but with CheatSheet's expected field names (scope + use)
const IPV6_SCOPES = [
  { scope: 'FF01::/16', name: 'Interface-Local', use: 'Same interface only', key: 'scope_if' },
  { scope: 'FF02::/16', name: 'Link-Local', use: 'Same link / subnet', key: 'scope_link' },
  { scope: 'FF03::/16', name: 'Realm-Local', use: 'Same realm (administrative)', key: 'scope_realm' },
  { scope: 'FF04::/16', name: 'Admin-Local', use: 'Same administrative domain', key: 'scope_admin' },
  { scope: 'FF05::/16', name: 'Site-Local', use: 'Same site / organization', key: 'scope_site' },
  { scope: 'FF08::/16', name: 'Organization-Local', use: 'Across sites in one org', key: 'scope_org' },
  { scope: 'FF0E::/16', name: 'Global', use: 'Internet-wide multicast', key: 'scope_global' },
  { scope: 'FF0F::/16', name: 'Reserved', use: 'Future use', key: 'scope_reserved' },
];

// Export to window
window.IPv4 = IPv4;
window.IPv6 = IPv6;
window.Multicast = Multicast;
window.CLASS_TABLE = CLASS_TABLE;
window.PRIVATE_RANGES = PRIVATE_RANGES;
window.SPECIAL_RANGES = SPECIAL_RANGES;
window.IPV6_SPECIAL = IPV6_SPECIAL;
window.IPV6_SCOPES = IPV6_SCOPES;
