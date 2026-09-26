/* ──────────────────────────────────────────────────────────────────────
 * fwIR.js — Firewall policy IR, IPv4 / port / proto interval math,
 * object-group expansion, finalize().
 *
 * Dual target: <script src> (window.FwIR) and node require().
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var FULL_V4_LO = 0;
  var FULL_V4_HI = 0xFFFFFFFF;
  var FULL_PORT = [0, 65535];
  var FULL_PROTO = [0, 255];

  // ── tables ──────────────────────────────────────────────────────────
  var PORT_NAMES = {
    www: 80, http: 80, https: 443, ssh: 22, telnet: 23, smtp: 25, domain: 53,
    ftp: 21, 'ftp-data': 20, tftp: 69, ntp: 123, snmp: 161, snmptrap: 162,
    bgp: 179, ldap: 389, ldaps: 636, syslog: 514, isakmp: 500,
    'non500-isakmp': 4500, pop3: 110, imap4: 143, sqlnet: 1521, rdp: 3389,
    bootps: 67, bootpc: 68, radius: 1812, 'radius-acct': 1813, tacacs: 49,
    kerberos: 88, 'netbios-ns': 137, 'netbios-dgm': 138, 'netbios-ssn': 139,
    'citrix-ica': 1494, lpd: 515, echo: 7, discard: 9, daytime: 13, cmd: 514,
    exec: 512, login: 513, whois: 43, gopher: 70, finger: 79, hostname: 101,
    'pim-auto-rp': 496, talk: 517, nntp: 119
  };

  // proto name → number, or 'ip' for 0-255, or 'ipv6' for flagged
  var PROTO_NAMES = {
    ip: 'ip', any: 'ip', all: 'ip',
    icmp: 1, igmp: 2, tcp: 6, udp: 17, gre: 47, esp: 50,
    ah: 51, ahp: 51, eigrp: 88, ospf: 89, pim: 103, vrrp: 112, sctp: 132,
    icmp6: 'ipv6', 'ipv6-icmp': 'ipv6', ipv6: 'ipv6'
  };

  var ICMP_NAMES = {
    echo: 8, 'echo-request': 8, 'echo-reply': 0,
    unreachable: 3, 'destination-unreachable': 3,
    'time-exceeded': 11, redirect: 5, 'parameter-problem': 12,
    'timestamp-request': 13, 'timestamp-reply': 14,
    'source-quench': 4, 'router-advertisement': 9, 'router-solicitation': 10
  };

  // ── IPv4 ────────────────────────────────────────────────────────────
  function ipv4ToInt(addr) {
    var parts = String(addr).trim().split('.');
    if (parts.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      if (!/^\d{1,3}$/.test(parts[i])) return null;
      var o = Number(parts[i]);
      if (!Number.isInteger(o) || o < 0 || o > 255) return null;
      n = (n * 256) + o;
    }
    return n >>> 0;
  }

  function intToIpv4(n) {
    n = n >>> 0;
    return ((n >>> 24) & 255) + '.' + ((n >>> 16) & 255) + '.' + ((n >>> 8) & 255) + '.' + (n & 255);
  }

  function maskToPrefix(maskInt) {
    if (maskInt === 0) return 0;
    if (maskInt === 0xFFFFFFFF) return 32;
    var wc = (~maskInt) >>> 0;
    if ((wc & (wc + 1)) >>> 0 !== 0) return null; // non-contiguous
    var p = 0;
    var x = maskInt >>> 0;
    while (x) { p++; x = (x & (x - 1)) >>> 0; }
    return p;
  }

  function prefixToMask(p) {
    if (p <= 0) return 0;
    if (p >= 32) return 0xFFFFFFFF;
    return (0xFFFFFFFF << (32 - p)) >>> 0;
  }

  function isContiguousWildcard(wc) {
    wc = wc >>> 0;
    return ((wc & ((wc + 1) >>> 0)) >>> 0) === 0;
  }

  function isContiguousMask(mask) {
    return maskToPrefix(mask) !== null;
  }

  // parseV4(str, opts?)
  // forms: host | a/len | a mask | a wildcard | a-b range
  // opts.mode: 'auto' | 'mask' | 'wildcard'
  function parseV4(str, opts) {
    opts = opts || {};
    var mode = opts.mode || 'auto';
    if (str == null) return null;
    var s = String(str).trim();
    if (!s) return null;
    if (/:/.test(s) && !/^\d/.test(s.split(':')[0])) return null;

    var m;
    if ((m = /^([0-9.]+)\s*-\s*([0-9.]+)$/.exec(s))) {
      var loR = ipv4ToInt(m[1]), hiR = ipv4ToInt(m[2]);
      if (loR === null || hiR === null || loR > hiR) return null;
      return { lo: loR, hi: hiR, kind: 'range', wildcard: false, contiguous: true, prefix: null };
    }
    if ((m = /^([0-9.]+)\/(\d{1,2})$/.exec(s))) {
      var addr = ipv4ToInt(m[1]);
      var p = Number(m[2]);
      if (addr === null || !Number.isInteger(p) || p < 0 || p > 32) return null;
      var mask = prefixToMask(p);
      var net = (addr & mask) >>> 0;
      var bcast = (net | ((~mask) >>> 0)) >>> 0;
      return { lo: net, hi: bcast, kind: p === 32 ? 'host' : 'subnet', wildcard: false, contiguous: true, prefix: p };
    }

    var parts = s.split(/\s+/);
    if (parts.length === 2 && ipv4ToInt(parts[0]) !== null && ipv4ToInt(parts[1]) !== null) {
      var a = ipv4ToInt(parts[0]);
      var b = ipv4ToInt(parts[1]);
      var asMask = isContiguousMask(b);
      var asWc = isContiguousWildcard(b);
      var treat;
      if (mode === 'mask') treat = 'mask';
      else if (mode === 'wildcard') treat = 'wildcard';
      else if (asMask && !asWc) treat = 'mask';
      else if (asWc && !asMask) treat = 'wildcard';
      else if (asMask && asWc) {
        // 0.0.0.0 or 255.255.255.255: high-octet 255 → mask, else wildcard
        treat = ((b >>> 24) === 255) ? 'mask' : 'wildcard';
      } else {
        treat = 'wildcard';
      }
      if (treat === 'mask') {
        if (!asMask) {
          return { lo: null, hi: null, kind: 'wildcard', wildcard: true, contiguous: false, prefix: null };
        }
        var p2 = maskToPrefix(b);
        var net2 = (a & b) >>> 0;
        var bc2 = (net2 | ((~b) >>> 0)) >>> 0;
        return { lo: net2, hi: bc2, kind: p2 === 32 ? 'host' : 'subnet', wildcard: false, contiguous: true, prefix: p2 };
      }
      // wildcard
      if (!asWc) {
        return { lo: null, hi: null, kind: 'wildcard', wildcard: true, contiguous: false, prefix: null };
      }
      var net3 = (a & (~b >>> 0)) >>> 0;
      var bc3 = (net3 | b) >>> 0;
      var p3 = maskToPrefix((~b) >>> 0);
      return { lo: net3, hi: bc3, kind: 'wildcard', wildcard: true, contiguous: true, prefix: p3 };
    }

    if (parts.length === 1) {
      var h = ipv4ToInt(parts[0]);
      if (h === null) return null;
      return { lo: h, hi: h, kind: 'host', wildcard: false, contiguous: true, prefix: 32 };
    }
    return null;
  }

  function looksLikeIpv6(s) {
    return /:/.test(String(s)) && /[0-9a-fA-F]:[0-9a-fA-F:]/.test(String(s));
  }

  // ── interval math ───────────────────────────────────────────────────
  function mergeIntervals(ivs) {
    if (!ivs || !ivs.length) return [];
    var a = [];
    for (var i = 0; i < ivs.length; i++) {
      var lo = ivs[i][0], hi = ivs[i][1];
      if (lo == null || hi == null) continue;
      lo = lo >>> 0; hi = hi >>> 0;
      if (lo > hi) continue;
      a.push([lo, hi]);
    }
    if (!a.length) return [];
    a.sort(function (p, q) { return p[0] - q[0] || p[1] - q[1]; });
    var out = [[a[0][0], a[0][1]]];
    for (var j = 1; j < a.length; j++) {
      var last = out[out.length - 1];
      var nlo = a[j][0], nhi = a[j][1];
      var next = last[1] === 0xFFFFFFFF ? Infinity : last[1] + 1;
      if (nlo > next) out.push([nlo, nhi]);
      else if (nhi > last[1]) last[1] = nhi;
    }
    return out;
  }

  function containsIntervals(a, b) {
    a = mergeIntervals(a);
    b = mergeIntervals(b);
    if (!b.length) return true;
    if (!a.length) return false;
    var i = 0;
    for (var k = 0; k < b.length; k++) {
      var blo = b[k][0], bhi = b[k][1];
      while (i < a.length && a[i][1] < blo) i++;
      if (i >= a.length) return false;
      if (a[i][0] > blo || a[i][1] < bhi) return false;
    }
    return true;
  }

  function intersects(a, b) {
    a = mergeIntervals(a);
    b = mergeIntervals(b);
    var i = 0, j = 0;
    while (i < a.length && j < b.length) {
      var lo = a[i][0] > b[j][0] ? a[i][0] : b[j][0];
      var hi = a[i][1] < b[j][1] ? a[i][1] : b[j][1];
      if (lo <= hi) return true;
      if (a[i][1] < b[j][1]) i++; else j++;
    }
    return false;
  }

  function subtractIntervals(a, b) {
    a = mergeIntervals(a);
    b = mergeIntervals(b);
    if (!b.length) return a.slice();
    var out = [];
    for (var i = 0; i < a.length; i++) {
      var curLo = a[i][0];
      var ahi = a[i][1];
      for (var j = 0; j < b.length; j++) {
        var blo = b[j][0], bhi = b[j][1];
        if (bhi < curLo || blo > ahi) continue;
        if (blo > curLo) out.push([curLo, Math.min(ahi, blo - 1)]);
        var nextLo = bhi === 0xFFFFFFFF ? 0x100000000 : bhi + 1;
        if (nextLo > curLo) curLo = nextLo;
        if (curLo > ahi) break;
      }
      if (curLo <= ahi) out.push([curLo, ahi]);
    }
    return mergeIntervals(out);
  }

  function intervalEqual(a, b) {
    a = mergeIntervals(a); b = mergeIntervals(b);
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i][0] !== b[i][0] || a[i][1] !== b[i][1]) return false;
    return true;
  }

  function isFullV4(ivs) {
    ivs = mergeIntervals(ivs);
    return ivs.length === 1 && ivs[0][0] === 0 && ivs[0][1] === FULL_V4_HI;
  }

  function complementV4(ivs) {
    return subtractIntervals([[FULL_V4_LO, FULL_V4_HI]], ivs);
  }

  // Greedy largest-aligned-block: interval list → minimal CIDR list [{ip, len}].
  function intervalsToCidrs(ivs) {
    ivs = mergeIntervals(ivs);
    var out = [];
    for (var i = 0; i < ivs.length; i++) {
      var start = ivs[i][0] >>> 0;
      var end = ivs[i][1] >>> 0;
      if (start === 0 && end === FULL_V4_HI) {
        out.push({ ip: '0.0.0.0', len: 0 });
        continue;
      }
      while (start <= end) {
        var remaining = (end - start + 1);
        var align = 0;
        var s = start;
        while (align < 32 && (s & 1) === 0) { align++; s >>>= 1; }
        var maxBlock = 0;
        var r = remaining;
        while (r > 1) { maxBlock++; r = Math.floor(r / 2); }
        var blockBits = align < maxBlock ? align : maxBlock;
        var len = 32 - blockBits;
        out.push({ ip: intToIpv4(start), len: len });
        var blockSize = blockBits === 0 ? 1 : (blockBits >= 32 ? 0x100000000 : (1 << blockBits));
        var next = start + blockSize;
        if (next > FULL_V4_HI || next <= start) break;
        start = next >>> 0;
      }
    }
    return out;
  }

  function isFullPort(ivs) {
    ivs = mergeIntervals(ivs);
    return ivs.length === 1 && ivs[0][0] === 0 && ivs[0][1] === 65535;
  }

  function isFullProto(pair) {
    return pair && pair[0] === 0 && pair[1] === 255;
  }

  // ── lookups ─────────────────────────────────────────────────────────
  function lookupPort(tok) {
    if (tok == null || tok === '') return { err: 'empty' };
    var s = String(tok).toLowerCase();
    if (/^\d+$/.test(s)) {
      var n = Number(s);
      if (n < 0 || n > 65535) return { err: 'range' };
      return { port: n };
    }
    if (Object.prototype.hasOwnProperty.call(PORT_NAMES, s)) return { port: PORT_NAMES[s] };
    return { err: 'name', name: String(tok) };
  }

  function lookupProto(tok) {
    if (tok == null || tok === '') return { err: 'empty' };
    var s = String(tok).toLowerCase();
    if (/^\d+$/.test(s)) {
      var n = Number(s);
      if (n < 0 || n > 255) return { err: 'range' };
      return { lo: n, hi: n };
    }
    if (Object.prototype.hasOwnProperty.call(PROTO_NAMES, s)) {
      var v = PROTO_NAMES[s];
      if (v === 'ip') return { lo: 0, hi: 255 };
      if (v === 'ipv6') return { err: 'ipv6' };
      return { lo: v, hi: v };
    }
    return { err: 'name', name: String(tok) };
  }

  function lookupIcmp(tok) {
    if (tok == null || tok === '') return { err: 'empty' };
    var s = String(tok).toLowerCase();
    if (/^\d+$/.test(s)) {
      var n = Number(s);
      if (n < 0 || n > 255) return { err: 'range' };
      return { type: n };
    }
    if (Object.prototype.hasOwnProperty.call(ICMP_NAMES, s)) return { type: ICMP_NAMES[s] };
    return { err: 'name', name: String(tok) };
  }

  // ── AddrSet / SvcSet ────────────────────────────────────────────────
  function emptyAddr() { return { v4: [], v6: 'none' }; }
  function anyAddr() { return { v4: [[FULL_V4_LO, FULL_V4_HI]], v6: 'any' }; }
  function any4Addr() { return { v4: [[FULL_V4_LO, FULL_V4_HI]], v6: 'none' }; }

  function unionAddr(a, b) {
    if (!a) a = emptyAddr();
    if (!b) b = emptyAddr();
    return {
      v4: mergeIntervals((a.v4 || []).concat(b.v4 || [])),
      v6: (a.v6 === 'any' || b.v6 === 'any') ? 'any' : 'none'
    };
  }

  function addrEqual(a, b) {
    if (!a || !b) return !a && !b;
    return intervalEqual(a.v4, b.v4) && a.v6 === b.v6;
  }

  function v6Covers(coverer, covered) {
    if (covered === 'any') return coverer === 'any';
    return true;
  }

  function anySvc() {
    return [{ proto: [0, 255], sport: [[0, 65535]], dport: [[0, 65535]] }];
  }

  function emptySvc() { return []; }

  function makeAtom(protoLo, protoHi, sport, dport) {
    var pLo = protoLo, pHi = protoHi;
    if (pLo !== 6 && pLo !== 17 && pLo !== 132 && pLo === pHi) {
      sport = [[0, 65535]];
      dport = [[0, 65535]];
    }
    return {
      proto: [pLo, pHi],
      sport: mergeIntervals(sport && sport.length ? sport : [[0, 65535]]),
      dport: mergeIntervals(dport && dport.length ? dport : [[0, 65535]])
    };
  }

  function icmpAtom(type, code) {
    var dport;
    if (type == null) dport = [[0, 65535]];
    else if (code == null) dport = [[type * 256, type * 256 + 255]];
    else dport = [[type * 256 + code, type * 256 + code]];
    return { proto: [1, 1], sport: [[0, 65535]], dport: dport };
  }

  function unionSvc(a, b) {
    var out = (a || []).concat(b || []);
    return coalesceSvc(out);
  }

  function coalesceSvc(atoms) {
    if (!atoms || !atoms.length) return [];
    return atoms.map(function (at) {
      return {
        proto: [at.proto[0], at.proto[1]],
        sport: mergeIntervals(at.sport),
        dport: mergeIntervals(at.dport)
      };
    });
  }

  function isAnySvc(svc) {
    if (!svc || !svc.length) return false;
    for (var i = 0; i < svc.length; i++) {
      var at = svc[i];
      if (isFullProto(at.proto) && isFullPort(at.sport) && isFullPort(at.dport)) return true;
    }
    // union of atoms covering proto 0-255 with full ports
    var protos = svc.map(function (at) { return at.proto; });
    if (containsIntervals(protos, [[0, 255]])) {
      var allFull = svc.every(function (at) { return isFullPort(at.sport) && isFullPort(at.dport); });
      if (allFull) return true;
    }
    return false;
  }

  function svcEqual(a, b) {
    a = coalesceSvc(a); b = coalesceSvc(b);
    if (a.length !== b.length) {
      // still equal if both are "any"
      if (isAnySvc(a) && isAnySvc(b)) return true;
      return false;
    }
    function key(at) {
      return at.proto[0] + '-' + at.proto[1] + '|' + JSON.stringify(at.sport) + '|' + JSON.stringify(at.dport);
    }
    var ka = a.map(key).sort();
    var kb = b.map(key).sort();
    for (var i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return false;
    return true;
  }

  function portOpIntervals(op, a, b) {
    op = String(op).toLowerCase();
    if (op === 'eq') return [[a, a]];
    if (op === 'neq') {
      var out = [];
      if (a > 0) out.push([0, a - 1]);
      if (a < 65535) out.push([a + 1, 65535]);
      return out;
    }
    if (op === 'lt') return a <= 0 ? [] : [[0, a - 1]];
    if (op === 'gt') return a >= 65535 ? [] : [[a + 1, 65535]];
    if (op === 'range') {
      var lo = Math.min(a, b), hi = Math.max(a, b);
      return [[lo, hi]];
    }
    return null;
  }

  // ── policy helpers ──────────────────────────────────────────────────
  function emptyPolicy(vendor) {
    return {
      vendor: vendor || '',
      rules: [],
      scopes: [],
      objects: { addr: {}, svc: {} },
      warnings: [],
      bindings: [],
      zones: {},
      meta: {}
    };
  }

  function addWarning(policy, code, line, params) {
    policy.warnings.push({ code: code, line: line || 0, params: params || {} });
  }

  function ensureScope(policy, key, spec) {
    for (var i = 0; i < policy.scopes.length; i++) {
      if (policy.scopes[i].key === key) return policy.scopes[i];
    }
    var sc = {
      key: key,
      kind: spec.kind,
      label: spec.label || key,
      from: spec.from || '',
      to: spec.to || ''
    };
    policy.scopes.push(sc);
    return sc;
  }

  function scopeOrderCount(policy, scopeKey) {
    var n = 0;
    for (var i = 0; i < policy.rules.length; i++) if (policy.rules[i].scopeKey === scopeKey) n++;
    return n;
  }

  function makeRule(partial) {
    var r = {
      uid: partial.uid || '',
      id: partial.id || '',
      name: partial.name != null ? partial.name : (partial.id || ''),
      scopeKey: partial.scopeKey || '',
      order: partial.order || 0,
      lines: partial.lines || [],
      raw: partial.raw || '',
      comment: partial.comment || '',
      action: partial.action || 'none',
      terminal: partial.terminal !== undefined ? partial.terminal : (partial.action === 'permit' || partial.action === 'deny' || partial.action === 'reject'),
      disabled: !!partial.disabled,
      log: !!partial.log,
      srcRefs: partial.srcRefs || [],
      dstRefs: partial.dstRefs || [],
      svcRefs: partial.svcRefs || [],
      srcIntf: partial.srcIntf || [],
      dstIntf: partial.dstIntf || [],
      negate: partial.negate || { src: false, dst: false, svc: false },
      unsupported: partial.unsupported ? partial.unsupported.slice() : [],
      dropped: partial.dropped ? partial.dropped.slice() : [],
      src: partial.src || null,
      dst: partial.dst || null,
      svc: partial.svc || null
    };
    if (r.negate.src || r.negate.dst || r.negate.svc) {
      pushUnsup(r, 'negate', 'negate', r.lines[0] || 0);
    }
    return r;
  }

  function pushUnsup(rule, construct, detail, line) {
    for (var i = 0; i < rule.unsupported.length; i++) {
      if (rule.unsupported[i].construct === construct && rule.unsupported[i].detail === detail) return;
    }
    rule.unsupported.push({ construct: construct, detail: detail || '', line: line || (rule.lines && rule.lines[0]) || 0 });
  }

  function pushRule(policy, rule) {
    if (!rule.uid) rule.uid = rule.scopeKey + '#' + rule.order;
    policy.rules.push(rule);
    return rule;
  }

  function addAddrObj(policy, obj) {
    var name = obj.name;
    var prev = policy.objects.addr[name];
    if (prev && (prev.line || 0) > 0) {
      addWarning(policy, 'duplicate_object', obj.line || 0, { name: name });
    }
    policy.objects.addr[name] = obj;
  }

  function addSvcObj(policy, obj) {
    var name = obj.name;
    var prev = policy.objects.svc[name];
    if (prev && (prev.line || 0) > 0) {
      addWarning(policy, 'duplicate_object', obj.line || 0, { name: name });
    }
    policy.objects.svc[name] = obj;
  }

  // ── ref resolution ──────────────────────────────────────────────────
  function addrFromParsed(p, v6) {
    if (!p || !p.contiguous || p.lo == null) return emptyAddr();
    return { v4: [[p.lo, p.hi]], v6: v6 || 'none' };
  }

  function emptyNonemptyAddr(rule, val, line) {
    var s;
    if (val == null || val === '') s = '';
    else if (typeof val === 'string') s = val;
    else if (typeof val === 'object' && val && typeof val.value === 'string') s = val.value;
    else s = String(val);
    if (looksLikeIpv6(s)) pushUnsup(rule, 'ipv6', s, line);
    else pushUnsup(rule, 'unresolved', s || 'empty-addr', line);
    return emptyAddr();
  }

  function litToAddr(lit, rule, line) {
    if (!lit) return emptyAddr();
    var kind = lit.kind;
    var val = lit.value;
    if (kind === 'any') {
      var s = String(val || 'any').toLowerCase();
      if (s === 'any4' || s === 'any-ipv4' || s === '0.0.0.0/0') return any4Addr();
      if (s === 'any6' || s === 'any-ipv6') {
        pushUnsup(rule, 'ipv6', s, line);
        return { v4: [], v6: 'any' };
      }
      // any / all / any-ipv4 handled; SRX/ASA `any` → v4+v6
      if (s === 'any' || s === 'all') return anyAddr();
      return anyAddr();
    }
    if (kind === 'host' || kind === 'subnet' || kind === 'range' || kind === 'wildcard') {
      var parsed = typeof val === 'object' && val && val.lo != null ? val : parseV4(val, { mode: kind === 'wildcard' ? 'wildcard' : (kind === 'subnet' ? 'mask' : 'auto') });
      if (!parsed) return emptyNonemptyAddr(rule, val, line);
      if (parsed.wildcard && !parsed.contiguous) {
        pushUnsup(rule, 'wildcard', String(val), line);
        return emptyAddr();
      }
      var fromLit = addrFromParsed(parsed, 'none');
      if (!fromLit.v4.length) return emptyNonemptyAddr(rule, val, line);
      return fromLit;
    }
    if (kind === 'fqdn') { pushUnsup(rule, 'fqdn', val, line); return emptyAddr(); }
    if (kind === 'geo') { pushUnsup(rule, 'geo', val, line); return emptyAddr(); }
    if (kind === 'dynamic') { pushUnsup(rule, 'option', val, line); return emptyAddr(); }
    return emptyNonemptyAddr(rule, kind || val, line);
  }

  function expandAddrRef(ref, objects, stack, rule, warnings) {
    var line = rule.lines && rule.lines[0] || 0;
    if (ref && typeof ref === 'object' && ref.lit) {
      return litToAddr(ref.lit, rule, line);
    }
    var name = typeof ref === 'string' ? ref : (ref && ref.name);
    if (!name) return emptyAddr();
    if (stack.indexOf(name) >= 0) {
      warnings.push({ code: 'group_cycle', line: line, params: { name: name } });
      pushUnsup(rule, 'unresolved', name, line);
      return emptyAddr();
    }
    var obj = objects.addr[name];
    if (!obj) {
      pushUnsup(rule, 'unresolved', name, line);
      return emptyAddr();
    }
    if (obj.unanalysable) {
      pushUnsup(rule, obj.unanalysableConstruct || 'unresolved', name, obj.line || line);
      return emptyAddr();
    }
    if (obj.ipv6) {
      pushUnsup(rule, 'ipv6', name, obj.line || line);
      return emptyAddr();
    }
    if (obj.kind === 'fqdn' || obj.kind === 'geo') {
      pushUnsup(rule, obj.kind, name, obj.line || line);
      return emptyAddr();
    }
    if (obj.kind === 'dynamic' || obj._mac) {
      pushUnsup(rule, 'option', obj._mac ? 'mac' : (name || 'dynamic'), obj.line || line);
      return emptyAddr();
    }
    if (obj.kind === 'wildcard' && obj.contiguous === false) {
      pushUnsup(rule, 'wildcard', name, obj.line || line);
      return emptyAddr();
    }
    if (obj.kind === 'group') {
      if (obj.exclude && obj.exclude.length) {
        pushUnsup(rule, 'negate', name, obj.line || line);
      }
      stack.push(name);
      var set = emptyAddr();
      var mems = obj.members || [];
      for (var i = 0; i < mems.length; i++) {
        set = unionAddr(set, expandAddrRef(mems[i], objects, stack, rule, warnings));
      }
      stack.pop();
      return set;
    }
    if (obj.value && typeof obj.value === 'object' && obj.value.lo != null) {
      if (obj.kind === 'wildcard' && obj.contiguous === false) {
        pushUnsup(rule, 'wildcard', name, obj.line || line);
        return emptyAddr();
      }
      var v6 = obj.v6 || 'none';
      return { v4: [[obj.value.lo, obj.value.hi]], v6: v6 };
    }
    if (obj.value != null) {
      var mode = obj.kind === 'wildcard' ? 'wildcard' : (obj.kind === 'subnet' ? 'mask' : 'auto');
      var p = parseV4(obj.value, { mode: mode });
      if (!p) return emptyNonemptyAddr(rule, obj.value, obj.line || line);
      if (p.wildcard && !p.contiguous) {
        pushUnsup(rule, 'wildcard', name, obj.line || line);
        return emptyAddr();
      }
      var fromObj = addrFromParsed(p, obj.v6 || 'none');
      if (!fromObj.v4.length) return emptyNonemptyAddr(rule, obj.value, obj.line || line);
      return fromObj;
    }
    return emptyNonemptyAddr(rule, name, obj.line || line);
  }

  function litToSvc(lit, rule, line) {
    if (!lit) return emptySvc();
    if (lit.kind === 'any' || lit.any) return anySvc();
    if (lit.atoms) return coalesceSvc(lit.atoms);
    var proto = lit.proto;
    var sport = lit.sport || [[0, 65535]];
    var dport = lit.dport || [[0, 65535]];
    if (proto === 'ip' || proto === 'any' || proto === 'all') {
      return [makeAtom(0, 255, sport, dport)];
    }
    if (typeof proto === 'number') {
      if (proto === 1) {
        return [icmpAtom(lit.icmpType, lit.icmpCode)];
      }
      return [makeAtom(proto, proto, sport, dport)];
    }
    if (Array.isArray(proto) && proto.length === 2) {
      return [makeAtom(proto[0], proto[1], sport, dport)];
    }
    if (typeof proto === 'string') {
      var lp = lookupProto(proto);
      if (lp.err === 'ipv6') { pushUnsup(rule, 'ipv6', proto, line); return emptySvc(); }
      if (lp.err) { pushUnsup(rule, 'option', proto, line); return emptySvc(); }
      if (lp.lo === 1 && lp.hi === 1) return [icmpAtom(lit.icmpType, lit.icmpCode)];
      return [makeAtom(lp.lo, lp.hi, sport, dport)];
    }
    return emptySvc();
  }

  function expandSvcRef(ref, objects, stack, rule, warnings) {
    var line = rule.lines && rule.lines[0] || 0;
    if (ref && typeof ref === 'object' && ref.lit) {
      return litToSvc(ref.lit, rule, line);
    }
    var name = typeof ref === 'string' ? ref : (ref && ref.name);
    if (!name) return emptySvc();
    if (stack.indexOf(name) >= 0) {
      warnings.push({ code: 'group_cycle', line: line, params: { name: name } });
      pushUnsup(rule, 'unresolved', name, line);
      return emptySvc();
    }
    var obj = objects.svc[name];
    if (!obj) {
      pushUnsup(rule, 'unresolved', name, line);
      return emptySvc();
    }
    if (obj.unanalysable) {
      pushUnsup(rule, obj.unanalysableConstruct || 'unresolved', name, obj.line || line);
      return emptySvc();
    }
    if (obj._option) {
      pushUnsup(rule, 'option', name, obj.line || line);
    }
    if (obj.kind === 'app') {
      pushUnsup(rule, 'app_id', name, obj.line || line);
      return emptySvc();
    }
    if (obj.kind === 'group') {
      stack.push(name);
      var set = emptySvc();
      if (obj.atoms && obj.atoms.length) set = unionSvc(set, coalesceSvc(obj.atoms));
      var mems = obj.members || [];
      for (var i = 0; i < mems.length; i++) {
        set = unionSvc(set, expandSvcRef(mems[i], objects, stack, rule, warnings));
      }
      stack.pop();
      return set;
    }
    // atom / built-in
    if (obj.atoms && obj.atoms.length) return coalesceSvc(obj.atoms);
    return emptySvc();
  }

  function expandRefs(refs, kind, objects, rule, warnings) {
    var acc = kind === 'svc' ? emptySvc() : emptyAddr();
    refs = refs || [];
    for (var i = 0; i < refs.length; i++) {
      if (kind === 'svc') acc = unionSvc(acc, expandSvcRef(refs[i], objects, [], rule, warnings));
      else acc = unionAddr(acc, expandAddrRef(refs[i], objects, [], rule, warnings));
    }
    return acc;
  }

  function finalize(policy) {
    if (!policy) return policy;
    policy.objects = policy.objects || { addr: {}, svc: {} };
    policy.objects.addr = policy.objects.addr || {};
    policy.objects.svc = policy.objects.svc || {};
    for (var i = 0; i < policy.rules.length; i++) {
      var rule = policy.rules[i];
      rule.src = expandRefs(rule.srcRefs, 'addr', policy.objects, rule, policy.warnings);
      rule.dst = expandRefs(rule.dstRefs, 'addr', policy.objects, rule, policy.warnings);
      rule.svc = expandRefs(rule.svcRefs, 'svc', policy.objects, rule, policy.warnings);
      if (!rule.svc || !rule.svc.length) {
        // empty service with no unresolved flag still means "no match" — leave empty
      }
    }
    return policy;
  }

  // ── token helpers (shared by parsers) ───────────────────────────────
  function tokenize(line) {
    var tokens = [];
    var re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    var m;
    var s = String(line);
    while ((m = re.exec(s))) {
      if (m[1] !== undefined) tokens.push(m[1]);
      else if (m[2] !== undefined) tokens.push(m[2]);
      else tokens.push(m[3]);
    }
    return tokens;
  }

  function isIpv4Token(s) {
    return ipv4ToInt(s) !== null;
  }

  function actionClass(action) {
    if (action === 'permit') return 'permit';
    if (action === 'deny' || action === 'reject') return 'block';
    return null;
  }

  var api = {
    PORT_NAMES: PORT_NAMES,
    PROTO_NAMES: PROTO_NAMES,
    ICMP_NAMES: ICMP_NAMES,
    FULL_V4: [FULL_V4_LO, FULL_V4_HI],
    ipv4ToInt: ipv4ToInt,
    intToIpv4: intToIpv4,
    maskToPrefix: maskToPrefix,
    prefixToMask: prefixToMask,
    parseV4: parseV4,
    looksLikeIpv6: looksLikeIpv6,
    mergeIntervals: mergeIntervals,
    containsIntervals: containsIntervals,
    subtractIntervals: subtractIntervals,
    intersects: intersects,
    intervalEqual: intervalEqual,
    isFullV4: isFullV4,
    isFullPort: isFullPort,
    lookupPort: lookupPort,
    lookupProto: lookupProto,
    lookupIcmp: lookupIcmp,
    emptyAddr: emptyAddr,
    anyAddr: anyAddr,
    any4Addr: any4Addr,
    unionAddr: unionAddr,
    addrEqual: addrEqual,
    v6Covers: v6Covers,
    anySvc: anySvc,
    emptySvc: emptySvc,
    makeAtom: makeAtom,
    icmpAtom: icmpAtom,
    unionSvc: unionSvc,
    coalesceSvc: coalesceSvc,
    isAnySvc: isAnySvc,
    svcEqual: svcEqual,
    portOpIntervals: portOpIntervals,
    emptyPolicy: emptyPolicy,
    addWarning: addWarning,
    ensureScope: ensureScope,
    scopeOrderCount: scopeOrderCount,
    makeRule: makeRule,
    pushUnsup: pushUnsup,
    pushRule: pushRule,
    addAddrObj: addAddrObj,
    addSvcObj: addSvcObj,
    finalize: finalize,
    tokenize: tokenize,
    isIpv4Token: isIpv4Token,
    actionClass: actionClass,
    litToAddr: litToAddr,
    litToSvc: litToSvc,
    addrFromParsed: addrFromParsed,
    expandRefs: expandRefs,
    expandAddrRef: expandAddrRef,
    expandSvcRef: expandSvcRef,
    intervalsToCidrs: intervalsToCidrs,
    complementV4: complementV4
  };

  root.FwIR = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
