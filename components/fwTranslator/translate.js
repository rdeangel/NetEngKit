/* ──────────────────────────────────────────────────────────────────────
 * translate.js — Firewall policy translator core (window.FwTranslate).
 * Semantic decisions live here; emitters only print.
 *
 * ponytail: NAT v2 hook — policy.nat[] plus emitNat per emitter. Not built.
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var IR = (typeof module !== 'undefined' && module.exports) ? require('./fwIR.js') : root.FwIR;

  var SOURCES = ['fortios', 'panos', 'junos', 'asa', 'ftd'];
  var TARGETS = ['fortios', 'panos', 'junos', 'asa'];

  var FAIL_CONSTRUCTS = {
    user: 1, app_id: 1, app_default: 1, url_category: 1, schedule: 1, geo: 1,
    internet_service: 1, ipv6: 1, wildcard: 1, unresolved: 1, option: 1,
    tcp_flags: 1, state: 1, module: 1, jump: 1, port_either: 1
  };
  var SKIP_CONSTRUCTS = { negate: 1, fqdn: 1 };
  var APPROX_CONSTRUCTS = { utm: 1, nat: 1, vpn: 1, ftd_trust: 1 };
  var INFO_CONSTRUCTS = { panorama: 1 };

  var PAN_APPS = {
    '1:*': 'icmp',
    '1:8': 'ping',
    '47': 'gre',
    '50': 'ipsec-esp',
    '89': 'ospf',
    '112': 'vrrp'
  };

  function emitters() {
    return root.FwEmitters || {};
  }

  function targetsFor(sourceVendor) {
    return TARGETS.filter(function (t) { return t !== sourceVendor; });
  }

  function ivKey(ivs) {
    return (ivs || []).map(function (iv) { return iv[0] + '-' + iv[1]; }).join(',');
  }
  function atomKey(at) {
    return at.proto[0] + '-' + at.proto[1] + ':' + ivKey(at.sport) + ':' + ivKey(at.dport);
  }
  function svcSig(atoms) {
    return IR.coalesceSvc(atoms || []).map(atomKey).sort().join('|');
  }

  function tcp(p) { return [IR.makeAtom(6, 6, [[0, 65535]], [[p, p]])]; }
  function udp(p) { return [IR.makeAtom(17, 17, [[0, 65535]], [[p, p]])]; }
  function both(p) { return tcp(p).concat(udp(p)); }

  var PREDEF_ROWS = [
    { atoms: tcp(80), fortios: 'HTTP', panos: null, junos: 'junos-http', asa: 'www' },
    { atoms: [IR.makeAtom(6, 6, [[0, 65535]], [[80, 80]]), IR.makeAtom(6, 6, [[0, 65535]], [[8080, 8080]])], fortios: null, panos: 'service-http', junos: null, asa: null },
    { atoms: tcp(443), fortios: 'HTTPS', panos: 'service-https', junos: 'junos-https', asa: 'https' },
    { atoms: tcp(22), fortios: 'SSH', panos: null, junos: 'junos-ssh', asa: 'ssh' },
    { atoms: tcp(23), fortios: 'TELNET', panos: null, junos: 'junos-telnet', asa: 'telnet' },
    { atoms: tcp(21), fortios: 'FTP', panos: null, junos: 'junos-ftp', asa: 'ftp' },
    { atoms: tcp(25), fortios: 'SMTP', panos: null, junos: 'junos-smtp', asa: 'smtp' },
    { atoms: udp(53), fortios: null, panos: null, junos: 'junos-dns-udp', asa: 'domain' },
    { atoms: tcp(53), fortios: null, panos: null, junos: 'junos-dns-tcp', asa: 'domain' },
    { atoms: both(53), fortios: 'DNS', panos: null, junos: ['junos-dns-udp', 'junos-dns-tcp'], asa: 'domain' },
    { atoms: udp(123), fortios: null, panos: null, junos: 'junos-ntp', asa: 'ntp' },
    { atoms: [IR.icmpAtom(8, null)], fortios: 'PING', panos: null, junos: 'junos-ping', asa: 'echo' },
    { atoms: [IR.icmpAtom(null, null)], fortios: 'ALL_ICMP', panos: null, junos: 'junos-icmp-all', asa: 'icmp' },
    { atoms: IR.anySvc(), fortios: 'ALL', panos: 'any', junos: 'any', asa: 'ip' },
    { atoms: tcp(3389), fortios: 'RDP', panos: null, junos: null, asa: '3389' },
    { atoms: tcp(179), fortios: 'BGP', panos: null, junos: 'junos-bgp', asa: 'bgp' }
  ];
  var PREDEF_BY_SIG = Object.create(null);
  PREDEF_ROWS.forEach(function (row) {
    PREDEF_BY_SIG[svcSig(row.atoms)] = row;
  });

  function lookupPredef(atoms, target) {
    var row = PREDEF_BY_SIG[svcSig(atoms)];
    if (!row) return null;
    var v = row[target];
    return v == null ? null : v;
  }

  function isAnyZone(z) {
    if (z == null || z === '') return true;
    var s = String(z).toLowerCase();
    return s === 'any' || s === 'all';
  }

  function cleanZones(list) {
    list = list || [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      if (isAnyZone(list[i])) return [];
      out.push(String(list[i]));
    }
    return out;
  }

  function zonesOf(policy, rule) {
    var v = policy.vendor;
    if (v === 'junos') {
      var sc = null;
      (policy.scopes || []).forEach(function (s) { if (s.key === rule.scopeKey) sc = s; });
      if (sc && sc.kind === 'zone-pair') {
        return { from: sc.from ? [sc.from] : [], to: sc.to ? [sc.to] : [] };
      }
    }
    if (v === 'asa' || (v === 'ftd' && String(rule.scopeKey).indexOf('acl:') === 0)) {
      var acl = String(rule.scopeKey || '').replace(/^acl:/, '');
      var binds = (policy.bindings || []).filter(function (b) {
        return b.acl === acl || b.scopeKey === 'acl:' + acl;
      });
      if (!binds.length) return { from: [], to: [], unbound: true };
      var from = [], to = [];
      var global = false;
      binds.forEach(function (b) {
        if (b.dir === 'global') global = true;
        else if (b.dir === 'in' && b.iface) from.push(b.iface);
        else if (b.dir === 'out' && b.iface) to.push(b.iface);
      });
      if (rule.srcIntf && rule.srcIntf.length) from = rule.srcIntf.slice();
      if (global && !from.length && !to.length) return { from: [], to: [] };
      return { from: from, to: to };
    }
    return { from: cleanZones(rule.srcIntf), to: cleanZones(rule.dstIntf) };
  }

  function seedZones(policy) {
    var map = Object.create(null);
    function add(name, ifaces) {
      if (!name || isAnyZone(name)) return;
      if (!map[name]) map[name] = { src: name, srcIfaces: [], target: String(name), ifaces: [] };
      (ifaces || []).forEach(function (ifc) {
        if (ifc && map[name].srcIfaces.indexOf(ifc) < 0) map[name].srcIfaces.push(ifc);
      });
    }
    Object.keys(policy.zones || {}).forEach(function (z) {
      add(z, (policy.zones[z] && policy.zones[z].ifaces) || []);
    });
    (policy.rules || []).forEach(function (r) {
      var z = zonesOf(policy, r);
      if (z.unbound) return;
      (z.from || []).forEach(function (n) { add(n); });
      (z.to || []).forEach(function (n) { add(n); });
    });
    return Object.keys(map).map(function (k) { return map[k]; });
  }

  function scrubText(s) {
    return String(s == null ? '' : s).replace(/[\x00-\x1F\x7F]/g, ' ');
  }

  function sanitizeShape(name, limits) {
    name = String(name == null ? '' : name);
    var out = '';
    for (var i = 0; i < name.length; i++) {
      var c = name.charAt(i);
      if (limits.charset.test(c)) out += c;
      else out += '_';
    }
    if (!out || !limits.first.test(out.charAt(0))) out = 'x' + out;
    var max = limits.object;
    if (out.length > max) out = out.slice(0, max);
    return out;
  }

  function sanitize(name, limits, used) {
    var out = sanitizeShape(name, limits);
    var max = limits.object;
    var base = out;
    var n = 2;
    var key = out.toLowerCase();
    while (used[key]) {
      var suffix = '_' + n;
      out = base.slice(0, Math.max(1, max - suffix.length)) + suffix;
      key = out.toLowerCase();
      n++;
    }
    used[key] = true;
    return out;
  }

  function sanitizeRule(name, limits, used) {
    var lim = { charset: limits.charset, first: limits.first, object: limits.rule || limits.object };
    return sanitize(name, lim, used);
  }

  function rankStatus(s) {
    if (s === 'not_translated') return 2;
    if (s === 'approximated') return 1;
    return 0;
  }
  function bump(cur, next) {
    return rankStatus(next) > rankStatus(cur) ? next : cur;
  }

  function addItem(items, code, sev, params) {
    for (var i = 0; i < items.length; i++) {
      if (items[i].code === code && JSON.stringify(items[i].params || {}) === JSON.stringify(params || {})) return;
    }
    items.push({ code: code, sev: sev, params: params || {} });
  }

  function classifyIR(rule, items) {
    var status = 'exact';
    (rule.unsupported || []).forEach(function (u) {
      var c = u.construct;
      if (SKIP_CONSTRUCTS[c]) return;
      if (INFO_CONSTRUCTS[c]) { addItem(items, c, 'info', { detail: u.detail }); return; }
      if (APPROX_CONSTRUCTS[c]) {
        addItem(items, c, 'approx', { detail: u.detail, name: u.detail });
        status = bump(status, 'approximated');
        return;
      }
      if (FAIL_CONSTRUCTS[c] || c) {
        var code = FAIL_CONSTRUCTS[c] ? c : 'other';
        var params = { name: u.detail, construct: c };
        if (c === 'option') params.name = u.detail;
        addItem(items, code, 'fail', params);
        status = bump(status, 'not_translated');
      }
    });
    (rule.dropped || []).forEach(function (d) {
      var c = d.construct;
      if (c === 'option') {
        addItem(items, 'dropped_option', 'approx', { name: d.detail });
        status = bump(status, 'approximated');
        return;
      }
      if (INFO_CONSTRUCTS[c]) { addItem(items, c, 'info', { detail: d.detail }); return; }
      if (APPROX_CONSTRUCTS[c]) {
        addItem(items, c, 'approx', { detail: d.detail });
        status = bump(status, 'approximated');
        return;
      }
      addItem(items, c || 'other', 'approx', { detail: d.detail, construct: c });
      status = bump(status, 'approximated');
    });
    return status;
  }

  function selfCheck(rule, items) {
    function covered(construct, fromDropped) {
      if (SKIP_CONSTRUCTS[construct]) return true;
      if (fromDropped && construct === 'option') {
        return items.some(function (it) { return it.code === 'dropped_option' || it.code === 'option'; });
      }
      return items.some(function (it) { return it.code === construct || (it.code === 'other' && it.params && it.params.construct === construct); });
    }
    (rule.unsupported || []).forEach(function (u) {
      if (!covered(u.construct, false)) addItem(items, 'other', 'fail', { construct: u.construct });
    });
    (rule.dropped || []).forEach(function (d) {
      if (!covered(d.construct, true)) addItem(items, 'other', 'fail', { construct: d.construct });
    });
  }

  function refName(ref) {
    if (ref == null) return '';
    if (typeof ref === 'string') return ref;
    if (ref.name) return ref.name;
    return '';
  }
  function isLit(ref) {
    return ref && typeof ref === 'object' && ref.lit;
  }
  function isAnyRef(ref) {
    var n = String(refName(ref) || '').toLowerCase();
    if (n === 'any' || n === 'all' || n === 'any-ipv4' || n === 'any4') return true;
    if (isLit(ref) && (ref.lit.kind === 'any' || ref.lit.any)) return true;
    return false;
  }

  function parsedAddr(obj, target) {
    if (!obj) return null;
    if (obj.kind === 'vip' && obj.value) {
      var side = target === 'panos' ? obj.value.ext : obj.value.mapped;
      if (side == null || String(side).trim() === '') return null;
      var bits = String(side).trim().split(/\s+/);
      if (bits.length !== 1) return null;
      var vp = IR.parseV4(bits[0]);
      if (!vp) return null;
      return fromLoHi(vp.lo, vp.hi, vp.kind);
    }
    if (obj.kind === 'fqdn') return { kind: 'fqdn', fqdn: obj.value };
    if (obj.kind === 'group') return { kind: 'group', members: obj.members || [], exclude: obj.exclude || [] };
    if (obj.value && typeof obj.value === 'object' && obj.value.lo != null) {
      return fromLoHi(obj.value.lo, obj.value.hi, obj.kind);
    }
    if (obj.value != null) return parsedFromString(String(obj.value));
    return null;
  }

  function fromLoHi(lo, hi, kind) {
    lo = lo >>> 0; hi = hi >>> 0;
    if (lo === hi) return { kind: 'host', ip: IR.intToIpv4(lo) };
    var p = null;
    if (((lo ^ hi) >>> 0) === ((~prefixToMaskGuess(lo, hi)) >>> 0) || kind === 'subnet') {
      var len = 32;
      var span = (hi - lo + 1) >>> 0;
      if (lo === 0 && hi === 0xFFFFFFFF) len = 0;
      else {
        while (len > 0 && (1 << (32 - len)) < span && len > 0) len--;
        var mask = len === 0 ? 0 : (0xFFFFFFFF << (32 - len)) >>> 0;
        if (((lo & mask) >>> 0) === lo && ((lo | ((~mask) >>> 0)) >>> 0) === hi) {
          return { kind: 'subnet', ip: IR.intToIpv4(lo), prefix: len, mask: IR.intToIpv4(mask) };
        }
      }
      if (lo === 0 && hi === 0xFFFFFFFF) return { kind: 'subnet', ip: '0.0.0.0', prefix: 0, mask: '0.0.0.0' };
    }
    return { kind: 'range', start: IR.intToIpv4(lo), end: IR.intToIpv4(hi) };
  }
  function prefixToMaskGuess() { return 0; }

  function parsedFromString(s) {
    if (s == null) return null;
    s = String(s).trim();
    if (!s) return null;
    var p = IR.parseV4(s);
    if (!p) {
      if (/[a-zA-Z]/.test(s) && s.indexOf('/') < 0 && !/\s/.test(s)) return { kind: 'fqdn', fqdn: s };
      return null;
    }
    return fromLoHi(p.lo, p.hi, p.kind);
  }

  function cidrObj(cidr) {
    if (cidr.len === 32) return { kind: 'host', ip: cidr.ip };
    return { kind: 'subnet', ip: cidr.ip, prefix: cidr.len, mask: IR.intToIpv4(IR.prefixToMask(cidr.len)) };
  }

  function atomsOfSvc(policy, name) {
    var obj = policy.objects.svc[name];
    if (!obj) return [];
    if (obj.atoms && obj.atoms.length && obj.kind !== 'group') return obj.atoms;
    var dummy = IR.makeRule({ lines: [0], unsupported: [] });
    return IR.expandSvcRef(name, policy.objects, [], dummy, []);
  }

  function mergeZoneMap(seed, userMap, limits, renamed) {
    var rows = [];
    var bySrc = Object.create(null);
    seed.forEach(function (s) { bySrc[s.src] = s; });
    var keys = Object.keys(bySrc);
    var targetCount = Object.create(null);
    keys.forEach(function (src) {
      var seedRow = bySrc[src];
      var u = (userMap && userMap[src]) || {};
      var tgt = u.target != null && u.target !== '' ? String(u.target) : seedRow.target;
      var origTgt = tgt;
      tgt = sanitizeShape(tgt, limits);
      if (tgt !== origTgt) renamed.push({ kind: 'zone', from: origTgt, to: tgt });
      var ifaces = [];
      if (typeof u.ifaces === 'string') {
        ifaces = u.ifaces.split(/[\s,]+/).filter(Boolean);
      } else if (Array.isArray(u.ifaces)) ifaces = u.ifaces.slice();
      else if (Array.isArray(seedRow.ifaces) && seedRow.ifaces.length) ifaces = seedRow.ifaces.slice();
      rows.push({
        src: src, target: tgt, ifaces: ifaces,
        srcIfaces: seedRow.srcIfaces || [],
        unmapped: !ifaces.length
      });
      targetCount[tgt] = (targetCount[tgt] || 0) + 1;
    });
    return { rows: rows, targetCount: targetCount };
  }

  function aggregateZoneRows(rows) {
    var byName = Object.create(null);
    var order = [];
    (rows || []).forEach(function (r) {
      if (!r.ifaces || !r.ifaces.length) return;
      var n = r.target;
      if (!byName[n]) {
        byName[n] = { name: n, ifaces: [] };
        order.push(n);
      }
      r.ifaces.forEach(function (ifc) {
        if (ifc && byName[n].ifaces.indexOf(ifc) < 0) byName[n].ifaces.push(ifc);
      });
    });
    return order.map(function (n) { return byName[n]; });
  }

  function panPortStr(ivs) {
    return (ivs || []).map(function (iv) {
      return iv[0] === iv[1] ? String(iv[0]) : iv[0] + '-' + iv[1];
    }).join(',');
  }
  function panL4Buckets(atoms) {
    var buckets = Object.create(null);
    var order = [];
    (atoms || []).forEach(function (at) {
      var p = at.proto[0];
      var key = p === 6 ? 'tcp' : p === 17 ? 'udp' : p === 132 ? 'sctp' : null;
      if (!key) return;
      var sp = '';
      if (at.sport && !(at.sport.length === 1 && at.sport[0][0] === 0 && at.sport[0][1] === 65535)) {
        sp = panPortStr(at.sport);
      }
      var bk = key + '\0' + sp;
      if (!buckets[bk]) {
        buckets[bk] = { proto: key, sport: sp, atoms: [] };
        order.push(bk);
      }
      buckets[bk].atoms.push(at);
    });
    return order.map(function (bk) { return buckets[bk]; });
  }
  function panSubOrig(base, b, taken) {
    var suffix = b.proto;
    if (b.sport) suffix += '-sp' + String(b.sport).replace(/[^A-Za-z0-9._-]/g, '_');
    var name = base + '-' + suffix;
    if (!taken || !taken[name]) return name;
    var n = 2;
    var cand = name + '_' + n;
    while (taken[cand]) {
      n++;
      cand = name + '_' + n;
    }
    return cand;
  }

  function mapZones(list, zmap) {
    if (!list || !list.length) return [];
    var out = [];
    list.forEach(function (src) {
      var hit = null;
      zmap.rows.forEach(function (r) { if (r.src === src) hit = r; });
      out.push(hit ? hit.target : src);
    });
    return out;
  }

  function flattenOrder(policy) {
    var rules = policy.rules.slice();
    if (policy.vendor === 'junos') {
      var zp = [], gl = [];
      rules.forEach(function (r) {
        var sc = (policy.scopes || []).filter(function (s) { return s.key === r.scopeKey; })[0];
        if (sc && sc.kind === 'global') gl.push(r);
        else zp.push(r);
      });
      return zp.concat(gl);
    }
    if (policy.vendor === 'panos') {
      var firstDg = (policy.meta && policy.meta.deviceGroups && policy.meta.deviceGroups[0]) || '';
      var buckets = { 'shared:pre': [], dgpre: [], local: [], dgpost: [], 'shared:post': [], other: [] };
      rules.forEach(function (r) {
        var k = r.scopeKey || '';
        if (k === 'shared:pre') buckets['shared:pre'].push(r);
        else if (k === 'shared:post') buckets['shared:post'].push(r);
        else if (k.indexOf('dg:') === 0) {
          var parts = k.split(':');
          var dg = parts[1];
          var side = parts[2];
          if (firstDg && dg !== firstDg) buckets.other.push(r);
          else if (side === 'pre') buckets.dgpre.push(r);
          else buckets.dgpost.push(r);
        } else buckets.local.push(r);
      });
      return buckets['shared:pre'].concat(buckets.dgpre, buckets.local, buckets.dgpost, buckets['shared:post'], buckets.other);
    }
    if (policy.vendor === 'asa' || policy.vendor === 'ftd') {
      var iface = [], gl = [], other = [], acp = [];
      rules.forEach(function (r) {
        var aclScoped = policy.vendor === 'asa' || String(r.scopeKey || '').indexOf('acl:') === 0;
        if (!aclScoped) {
          acp.push(r);
          return;
        }
        var z = zonesOf(policy, r);
        if (z.unbound) other.push(r);
        else if ((z.from && z.from.length) || (z.to && z.to.length)) iface.push(r);
        else gl.push(r);
      });
      return acp.concat(iface, gl, other);
    }
    return rules;
  }

  function isGlobalOnTarget(fromZ, toZ, target) {
    if (target === 'junos') return !fromZ.length || !toZ.length;
    if (target === 'asa') return !fromZ.length;
    return false;
  }

  function firstDgOf(policy) {
    return (policy.meta && policy.meta.deviceGroups && policy.meta.deviceGroups[0]) || '';
  }

  function panAppsFor(atoms) {
    var apps = [];
    for (var i = 0; i < atoms.length; i++) {
      var at = atoms[i];
      var p = at.proto[0];
      if (p !== at.proto[1]) return null;
      if (p === 6 || p === 17 || p === 132) return null;
      var key = String(p);
      if (p === 1) {
        var d = at.dport && at.dport[0];
        if (!d || (d[0] === 0 && d[1] === 65535)) key = '1:*';
        else if (Math.floor(d[0] / 256) === 8 && Math.floor(d[1] / 256) === 8) key = '1:8';
        else key = '1:*';
      }
      var app = PAN_APPS[key];
      if (!app) return null;
      if (apps.indexOf(app) < 0) apps.push(app);
    }
    return apps.length ? apps : null;
  }

  function atomsArePorted(atoms) {
    return (atoms || []).some(function (at) {
      var p = at.proto[0];
      return p === at.proto[1] && (p === 6 || p === 17 || p === 132);
    });
  }

  function headerLines(source, target) {
    if (target === 'panos') return [];
    var mark = target === 'asa' ? '!' : '#';
    var lines = [
      mark + ' MIGRATION DRAFT — generated by NetEngKit from ' + source + '. Not push-ready. Review the Translation Report.'
    ];
    if (target === 'junos') {
      lines.push(mark + ' configure private');
      lines.push(mark + ' load set terminal');
      lines.push(mark + ' show | compare');
      lines.push(mark + ' commit check');
    } else if (target === 'asa') {
      lines.push(mark + ' Apply in a maintenance window, then show access-list hit counts.');
    } else if (target === 'fortios') {
      lines.push(mark + ' Config applies on end; lab or revision backup first.');
    }
    return lines;
  }

  function translate(policy, target, zoneMap, opts) {
    opts = opts || {};
    var emAll = emitters();
    var emitter = emAll[target];
    if (!emitter) throw new Error('unknown target ' + target);
    var caps = emitter.caps || {};
    var limits = emitter.limits;
    var source = policy.vendor || '';
    var usedAddr = Object.create(null);
    var usedSvc = Object.create(null);
    var renamed = [];
    var notes = [];
    var zpack = mergeZoneMap(seedZones(policy), zoneMap, limits, renamed);

    var ordered = flattenOrder(policy);
    var firstDg = firstDgOf(policy);
    var reportRules = [];
    var modelRules = [];
    var addrNeed = Object.create(null);
    var svcNeed = Object.create(null);
    var genAddr = [];
    var genSvc = [];
    var genSeq = 0;

    function needAddr(name) { if (name) addrNeed[name] = true; }
    function needSvc(name) { if (name) svcNeed[name] = true; }

    function litAddrName(lit) {
      if (lit.kind === 'any' || lit.any) return null;
      var p = parsedFromString(lit.value);
      if (!p) return null;
      genSeq++;
      var n = 'LIT_' + genSeq;
      genAddr.push({ orig: n, parsed: p, synthetic: true });
      addrNeed[n] = true;
      return n;
    }
    function litSvcName(lit) {
      var atoms = IR.litToSvc(lit, IR.makeRule({ lines: [0], unsupported: [] }), 0);
      if (IR.isAnySvc(atoms)) return null;
      var pre = lookupPredef(atoms, target);
      if (pre && typeof pre === 'string') {
        genSvc.push({ orig: pre, name: pre, atoms: atoms, kind: 'atom', predef: pre, skip: true, synthetic: true });
        nameMapEarlySvc[pre] = pre;
        return pre;
      }
      genSeq++;
      var n = 'SVCLIT_' + genSeq;
      genSvc.push({ orig: n, atoms: atoms, kind: 'atom', synthetic: true });
      svcNeed[n] = true;
      return n;
    }
    var nameMapEarlySvc = Object.create(null);

    (zpack.rows || []).forEach(function (r) {
      if (r.unmapped) notes.push({ code: 'zone_unmapped', params: { zone: r.src } });
    });
    var merges = Object.create(null);
    zpack.rows.forEach(function (r) {
      if (!merges[r.target]) merges[r.target] = [];
      merges[r.target].push(r.src);
    });
    Object.keys(merges).forEach(function (t) {
      if (merges[t].length > 1) notes.push({ code: 'zone_merge', params: { zones: merges[t].join(', '), target: t } });
    });

    if (policy.meta && policy.meta.uuidPresent) notes.push({ code: 'uuid_not_carried', params: {} });
    if (policy.meta && policy.meta.natPresent) notes.push({ code: 'nat_rules_present', params: {} });

    var laterZonePair = [];
    if (target === 'junos' || target === 'asa') {
      for (var li = ordered.length - 1; li >= 0; li--) {
        laterZonePair[li] = false;
        for (var lj = li + 1; lj < ordered.length; lj++) {
          var z2 = zonesOf(policy, ordered[lj]);
          if (!isGlobalOnTarget(z2.from || [], z2.to || [], target) && !z2.unbound) {
            laterZonePair[li] = true;
            break;
          }
        }
      }
    }

    function ruleUsesOrig(rule, orig, kind) {
      if (!rule || !orig) return false;
      var refs = kind === 'svc' ? (rule.svcRefs || []) : [].concat(rule.srcRefs || [], rule.dstRefs || []);
      for (var ui = 0; ui < refs.length; ui++) {
        if (refName(refs[ui]) === orig) return true;
      }
      return false;
    }

    ordered.forEach(function (rule, idx) {
      var items = [];
      var status = classifyIR(rule, items);
      var z = zonesOf(policy, rule);
      var fromZ = z.from || [];
      var toZ = z.to || [];

      if (z.unbound) {
        addItem(items, 'unbound_acl', 'fail', {});
        status = bump(status, 'not_translated');
      }
      if (policy.vendor === 'asa' || (policy.vendor === 'ftd' && String(rule.scopeKey).indexOf('acl:') === 0)) {
        var aclName = String(rule.scopeKey || '').replace(/^acl:/, '');
        var hasOut = (policy.bindings || []).some(function (b) {
          return (b.acl === aclName || b.scopeKey === 'acl:' + aclName) && b.dir === 'out';
        });
        if (hasOut) {
          addItem(items, 'option', 'fail', { name: 'access-group out' });
          status = bump(status, 'not_translated');
        }
      }
      if (policy.vendor === 'panos' && String(rule.scopeKey).indexOf('dg:') === 0) {
        var dg = String(rule.scopeKey).split(':')[1];
        if (firstDg && dg !== firstDg) {
          addItem(items, 'other_dg', 'fail', { dg: dg });
          status = bump(status, 'not_translated');
        }
      }
      if (rule.action === 'none' && rule.terminal === false) {
        addItem(items, 'monitor_action', 'fail', {});
        status = bump(status, 'not_translated');
      }

      var dummy = IR.makeRule({ lines: rule.lines || [0], unsupported: [] });
      var srcSet = IR.expandRefs(rule.srcRefs, 'addr', policy.objects, dummy, []);
      var dstSet = IR.expandRefs(rule.dstRefs, 'addr', policy.objects, dummy, []);
      var svcSet = IR.expandRefs(rule.svcRefs, 'svc', policy.objects, dummy, []);

      function addrRefBad(ref, seen) {
        seen = seen || Object.create(null);
        if (isAnyRef(ref)) return null;
        if (isLit(ref)) {
          return parsedFromString(ref.lit && ref.lit.value) ? null : String((ref.lit && ref.lit.value) || '');
        }
        var nm = typeof ref === 'string' ? ref : refName(ref);
        if (!nm) return null;
        if (seen[nm]) return null;
        seen[nm] = true;
        var obj = policy.objects.addr[nm];
        if (!obj) return nm;
        if (obj.kind === 'group') {
          var mems = obj.members || [];
          for (var mi = 0; mi < mems.length; mi++) {
            var mem = mems[mi];
            var nested = addrRefBad(typeof mem === 'string' ? mem : mem, seen);
            if (nested != null) return nested;
          }
          return null;
        }
        if (parsedAddr(obj, target) == null) return nm;
        return null;
      }
      (rule.srcRefs || []).concat(rule.dstRefs || []).forEach(function (ref) {
        var bad = addrRefBad(ref);
        if (bad != null) {
          addItem(items, 'unresolved', 'fail', { name: bad });
          status = bump(status, 'not_translated');
        }
      });

      if (rule.negate && rule.negate.svc && !caps.negateSvc) {
        addItem(items, 'svc_negate', 'fail', {});
        status = bump(status, 'not_translated');
      }

      var excludeTooBig = false;
      (rule.srcRefs || []).concat(rule.dstRefs || []).forEach(function (ref) {
        var n = refName(ref);
        var obj = n && policy.objects.addr[n];
        if (obj && obj.kind === 'group' && obj.exclude && obj.exclude.length && target !== 'fortios') {
          var mem = IR.expandRefs(obj.members, 'addr', policy.objects, dummy, []);
          var ex = IR.expandRefs(obj.exclude, 'addr', policy.objects, dummy, []);
          var cidrs = IR.intervalsToCidrs(IR.subtractIntervals(mem.v4, ex.v4));
          if (cidrs.length > 64) excludeTooBig = true;
        }
      });
      if (excludeTooBig) {
        addItem(items, 'negate_too_large', 'fail', {});
        status = bump(status, 'not_translated');
      }

      var negSrc = !!(rule.negate && rule.negate.src);
      var negDst = !!(rule.negate && rule.negate.dst);
      var negSvc = !!(rule.negate && rule.negate.svc) && !!caps.negateSvc;
      var srcNegGroup = null, dstNegGroup = null;
      if ((negSrc || negDst) && !caps.negateAddr) {
        function expandSide(refs, tag) {
          var set = IR.expandRefs(refs, 'addr', policy.objects, dummy, []);
          var cidrs = IR.intervalsToCidrs(IR.complementV4(set.v4 || []));
          return cidrs;
        }
        if (negSrc) {
          var c1 = expandSide(rule.srcRefs, 'SRC');
          if (c1.length > 64) {
            addItem(items, 'negate_too_large', 'fail', {});
            status = bump(status, 'not_translated');
          } else {
            addItem(items, 'negate_expanded', 'approx', { count: c1.length });
            status = bump(status, 'approximated');
            srcNegGroup = { cidrs: c1, tag: 'SRC' };
          }
        }
        if (negDst) {
          var c2 = expandSide(rule.dstRefs, 'DST');
          if (c2.length > 64) {
            addItem(items, 'negate_too_large', 'fail', {});
            status = bump(status, 'not_translated');
          } else {
            addItem(items, 'negate_expanded', 'approx', { count: c2.length });
            status = bump(status, 'approximated');
            dstNegGroup = { cidrs: c2, tag: 'DST' };
          }
        }
        negSrc = false;
        negDst = false;
      }

      if (target === 'asa' && toZ.length) {
        addItem(items, 'asa_dst_zone', 'approx', {});
        status = bump(status, 'approximated');
      }

      var globalBound = isGlobalOnTarget(fromZ, toZ, target);
      if (globalBound && laterZonePair[idx]) {
        addItem(items, 'order_global', 'approx', {});
        status = bump(status, 'approximated');
      }

      var mappedAct = rule.action === 'reject'
        ? (caps.reject ? 'reject' : 'deny')
        : (rule.action === 'permit' || rule.action === 'deny' ? rule.action : rule.action);
      var sendDeny = false;
      if (rule.action === 'reject' && target === 'fortios') { mappedAct = 'deny'; sendDeny = true; }
      if (rule.action === 'reject' && target === 'asa') {
        mappedAct = 'deny';
        addItem(items, 'reject_as_deny', 'approx', {});
        status = bump(status, 'approximated');
      }

      var comment = scrubText(rule.comment || '');
      if (target !== 'asa' && comment.length > limits.comment) {
        comment = comment.slice(0, limits.comment);
        addItem(items, 'comment_truncated', 'approx', { max: limits.comment });
        status = bump(status, 'approximated');
      }

      var panApps = null, panAppDefault = false;
      if (target === 'panos' && status !== 'not_translated') {
        var mixed = false;
        var onlyNonPort = svcSet && svcSet.length && !atomsArePorted(svcSet) && !IR.isAnySvc(svcSet);
        if (onlyNonPort) {
          panApps = panAppsFor(svcSet);
          if (panApps) {
            panAppDefault = true;
            addItem(items, 'pan_app_substitute', 'approx', { apps: panApps.join(',') });
            status = bump(status, 'approximated');
          } else {
            addItem(items, 'pan_app_mixed', 'fail', {});
            status = bump(status, 'not_translated');
          }
        } else if (atomsArePorted(svcSet) && svcSet.some(function (at) {
          var p = at.proto[0];
          return p === at.proto[1] && p !== 6 && p !== 17 && p !== 132;
        })) {
          addItem(items, 'pan_app_mixed', 'fail', {});
          status = bump(status, 'not_translated');
        }
      }

      if (srcSet && srcSet.v6 === 'any' && target === 'fortios' && IR.isFullV4(srcSet.v4)) {
        addItem(items, 'v6_dropped', 'info', {});
      } else if (dstSet && dstSet.v6 === 'any' && target === 'fortios' && IR.isFullV4(dstSet.v4)) {
        addItem(items, 'v6_dropped', 'info', {});
      }

      selfCheck(rule, items);
      if (items.some(function (it) { return it.sev === 'fail'; })) status = bump(status, 'not_translated');
      else if (items.some(function (it) { return it.sev === 'approx'; })) status = bump(status, 'approximated');

      var tName = rule.name || rule.id || ('r' + idx);
      var splits = [];
      if (status !== 'not_translated') {
        if (target === 'junos' && fromZ.length > 1 || (target === 'junos' && toZ.length > 1 && fromZ.length >= 1)) {
          if (fromZ.length && toZ.length && (fromZ.length > 1 || toZ.length > 1)) {
            var n = 0;
            fromZ.forEach(function (f) {
              toZ.forEach(function (t) {
                n++;
                splits.push({ from: [f], to: [t], name: tName + '_' + n, srxGlobal: false });
              });
            });
            addItem(items, 'split', 'info', { count: n });
          }
        }
        if (target === 'asa' && fromZ.length > 1) {
          fromZ.forEach(function (f, i) {
            splits.push({ from: [f], to: [], name: tName, acl: f + '_access_in', aclIface: f, aclDir: 'in' });
          });
          addItem(items, 'split', 'info', { count: fromZ.length });
        }
      }

      var emitList = [];
      if (status !== 'not_translated') {
        if (splits.length) emitList = splits;
        else {
          var one = { from: fromZ, to: toZ, name: tName };
          if (target === 'junos') {
            if (!fromZ.length || !toZ.length) {
              one.srxGlobal = true;
              one.srxFrom = fromZ;
              one.srxTo = toZ;
            } else if (fromZ.length === 1 && toZ.length === 1) {
              one.srxGlobal = false;
            } else {
              one.srxGlobal = true;
              one.srxFrom = fromZ;
              one.srxTo = toZ;
            }
          }
          if (target === 'asa') {
            if (!fromZ.length) {
              one.acl = 'global_access';
              one.aclDir = 'global';
              one.aclIface = '';
            } else {
              one.acl = fromZ[0] + '_access_in';
              one.aclDir = 'in';
              one.aclIface = fromZ[0];
            }
          }
          emitList = [one];
        }
      }

      function collectRefs(refs, kind, negGroup) {
        var names = [];
        if (negGroup) {
          var gname = 'NEG_' + (rule.name || rule.id || 'R') + '_' + negGroup.tag;
          gname = gname.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 40);
          var members = [];
          negGroup.cidrs.forEach(function (c, i) {
            var cn = gname + '_' + (i + 1);
            genAddr.push({ orig: cn, parsed: cidrObj(c), synthetic: true });
            addrNeed[cn] = true;
            members.push(cn);
          });
          genAddr.push({ orig: gname, parsed: { kind: 'group', members: members, exclude: [] }, synthetic: true });
          addrNeed[gname] = true;
          return [gname];
        }
        (refs || []).forEach(function (ref) {
          if (isAnyRef(ref)) return;
          if (isLit(ref)) {
            if (kind === 'svc') {
              if (IR.isAnySvc(IR.litToSvc(ref.lit, dummy, 0))) return;
              var sn = litSvcName(ref.lit);
              if (sn) names.push(sn);
            } else {
              var an = litAddrName(ref.lit);
              if (an) names.push(an);
            }
            return;
          }
          var n = refName(ref);
          if (!n) return;
          if (kind === 'addr') needAddr(n);
          else needSvc(n);
          names.push(n);
        });
        return names;
      }

      var srcNames = [], dstNames = [], svcNames = [];
      if (status !== 'not_translated') {
        srcNames = collectRefs(rule.srcRefs, 'addr', srcNegGroup);
        dstNames = collectRefs(rule.dstRefs, 'addr', dstNegGroup);
        if (!panAppDefault) svcNames = collectRefs(rule.svcRefs, 'svc', null);
      }

      var srcAny = !srcNames.length;
      var dstAny = !dstNames.length;
      var svcAny = !svcNames.length && !panAppDefault;
      if (srcAny) {
        if (srcSet && IR.isFullV4(srcSet.v4) && srcSet.v6 === 'none') {
          /* v4-only */
        }
      }

      if (target === 'asa') addItem(items, 'remark_name', 'info', {});

      var mappedFrom = mapZones(fromZ, zpack);
      var mappedTo = mapZones(toZ, zpack);

      emitList.forEach(function (sp) {
        modelRules.push({
          emit: status !== 'not_translated',
          origUid: rule.uid,
          origId: rule.id,
          origName: rule.name,
          name: sp.name,
          from: mapZones(sp.from || fromZ, zpack),
          to: mapZones(sp.to || toZ, zpack),
          srcNames: srcNames,
          dstNames: dstNames,
          svcNames: svcNames,
          srcAny: srcAny,
          dstAny: dstAny,
          svcAny: svcAny,
          srcV4Only: !!(srcSet && IR.isFullV4(srcSet.v4) && srcSet.v6 === 'none'),
          dstV4Only: !!(dstSet && IR.isFullV4(dstSet.v4) && dstSet.v6 === 'none'),
          action: mappedAct,
          log: !!rule.log,
          disabled: !!rule.disabled,
          comment: comment,
          negateSrc: negSrc,
          negateDst: negDst,
          negateSvc: negSvc,
          sendDenyPacket: sendDeny,
          panApps: panApps,
          panAppDefault: panAppDefault,
          acl: sp.acl,
          aclDir: sp.aclDir,
          aclIface: sp.aclIface ? (mapZones([sp.aclIface], zpack)[0] || sp.aclIface) : '',
          srxGlobal: !!sp.srxGlobal,
          srxFrom: mapZones(sp.srxFrom || sp.from || [], zpack),
          srxTo: mapZones(sp.srxTo || sp.to || [], zpack),
          status: status
        });
      });

      reportRules.push({
        uid: rule.uid,
        id: rule.id,
        name: rule.name,
        targetName: emitList.length ? emitList[0].name : tName,
        scopeLabel: rule.scopeKey,
        lines: rule.lines || [],
        status: status,
        items: items
      });
    });

    function walkAddr(name, stack) {
      if (!name || addrNeed[name] === 'done') return;
      addrNeed[name] = 'done';
      var obj = policy.objects.addr[name];
      if (!obj) return;
      if (obj.kind === 'group') {
        (obj.members || []).forEach(function (m) {
          var mn = refName(m);
          if (isLit(m)) return;
          if (mn) { addrNeed[mn] = addrNeed[mn] || true; walkAddr(mn, stack); }
        });
        if (target === 'fortios' && obj.exclude) {
          (obj.exclude || []).forEach(function (m) {
            var mn = refName(m);
            if (mn) { addrNeed[mn] = addrNeed[mn] || true; walkAddr(mn, stack); }
          });
        }
      }
    }
    function walkSvc(name) {
      if (!name || svcNeed[name] === 'done') return;
      svcNeed[name] = 'done';
      var obj = policy.objects.svc[name];
      if (!obj) return;
      if (obj.kind === 'group') {
        (obj.members || []).forEach(function (m) {
          var mn = refName(m);
          if (mn) { svcNeed[mn] = svcNeed[mn] || true; walkSvc(mn); }
        });
      }
    }
    Object.keys(addrNeed).forEach(function (n) { walkAddr(n); });
    Object.keys(svcNeed).forEach(function (n) { walkSvc(n); });

    var addrList = [];
    Object.keys(addrNeed).forEach(function (n) {
      var syn = null;
      genAddr.forEach(function (g) { if (g.orig === n) syn = g; });
      if (syn) {
        addrList.push({ orig: n, parsed: syn.parsed, synthetic: true });
        return;
      }
      var obj = policy.objects.addr[n];
      if (!obj) return;
      if (obj.kind === 'group' && obj.exclude && obj.exclude.length && target !== 'fortios') {
        var dummy2 = IR.makeRule({ lines: [0], unsupported: [] });
        var mem = IR.expandRefs(obj.members, 'addr', policy.objects, dummy2, []);
        var ex = IR.expandRefs(obj.exclude, 'addr', policy.objects, dummy2, []);
        var cidrs = IR.intervalsToCidrs(IR.subtractIntervals(mem.v4, ex.v4));
        var members = [];
        cidrs.forEach(function (c, i) {
          var cn = n + '_x' + (i + 1);
          addrList.push({ orig: cn, parsed: cidrObj(c), synthetic: true });
          members.push(cn);
        });
        addrList.push({ orig: n, parsed: { kind: 'group', members: members, exclude: [] }, synthetic: true, excludeExpanded: true });
        reportRules.forEach(function (rr, ri) {
          if (rr.status === 'not_translated') return;
          if (!ruleUsesOrig(ordered[ri], n, 'addr')) return;
          addItem(rr.items, 'exclude_expanded', 'approx', { count: cidrs.length });
          if (rr.status === 'exact') rr.status = 'approximated';
        });
        return;
      }
      addrList.push({ orig: n, obj: obj, parsed: parsedAddr(obj, target) });
    });

    var svcList = [];
    genSvc.forEach(function (g) {
      if (g.skip && g.predef) {
        svcList.push(g);
        return;
      }
      svcList.push({ orig: g.orig, atoms: g.atoms, kind: g.kind || 'atom', synthetic: true });
    });
    Object.keys(svcNeed).forEach(function (n) {
      if (svcList.some(function (s) { return s.orig === n; })) return;
      var obj = policy.objects.svc[n];
      if (!obj) return;
      var atoms = obj.kind === 'group' ? [] : (obj.atoms || atomsOfSvc(policy, n));
      var pre = obj.kind === 'group' ? null : lookupPredef(atoms.length ? atoms : atomsOfSvc(policy, n), target);
      if (target === 'panos' && obj.kind !== 'group' && atoms.length) {
        var panBk = panL4Buckets(atoms);
        if (panBk.length > 1 && !pre) {
          var members = [];
          var taken = Object.create(null);
          Object.keys(policy.objects.svc || {}).forEach(function (k) { taken[k] = true; });
          svcList.forEach(function (s) { if (s.orig) taken[s.orig] = true; });
          panBk.forEach(function (b) {
            var sub = panSubOrig(n, b, taken);
            taken[sub] = true;
            svcList.push({ orig: sub, atoms: b.atoms, kind: 'atom' });
            members.push(sub);
          });
          svcList.push({ orig: n, kind: 'group', members: members, split: true });
          reportRules.forEach(function (rr, ri) {
            if (!ruleUsesOrig(ordered[ri], n, 'svc')) return;
            addItem(rr.items, 'split', 'info', { count: panBk.length });
          });
          return;
        }
      }
      if (target === 'fortios' && obj.kind !== 'group' && atoms.length && !pre) {
        var ported = [], other = [];
        atoms.forEach(function (at) {
          var p = at.proto[0];
          if (p === at.proto[1] && (p === 6 || p === 17 || p === 132)) ported.push(at);
          else if (p === 1) {
            var ivs = at.dport && at.dport.length ? at.dport : [[0, 65535]];
            var anyI = ivs.length === 1 && ivs[0][0] === 0 && ivs[0][1] === 65535;
            if (anyI) { other.push(at); return; }
            ivs.forEach(function (d) {
              var t0 = Math.floor(d[0] / 256), t1 = Math.floor(d[1] / 256);
              for (var t = t0; t <= t1 && t < 256; t++) {
                var cLo = (t === t0) ? (d[0] % 256) : 0;
                var cHi = (t === t1) ? (d[1] % 256) : 255;
                var dp = (cLo === 0 && cHi === 255)
                  ? [[t * 256, t * 256 + 255]]
                  : [[t * 256 + cLo, t * 256 + cHi]];
                other.push({ proto: [1, 1], sport: at.sport, dport: dp });
              }
            });
          } else other.push(at);
        });
        var buckets = [];
        if (ported.length) buckets.push({ atoms: ported, suffix: other.length ? '-l4' : '' });
        other.forEach(function (at, bi) {
          var p = at.proto[0];
          var suffix = p === 1 ? ('-icmp' + (other.length > 1 ? String(bi + 1) : '')) : ('-ip' + p);
          buckets.push({ atoms: [at], suffix: suffix });
        });
        if (buckets.length > 1) {
          var fMembers = [];
          buckets.forEach(function (b) {
            var sub = n + b.suffix;
            svcList.push({ orig: sub, atoms: b.atoms, kind: 'atom' });
            fMembers.push(sub);
          });
          svcList.push({ orig: n, kind: 'group', members: fMembers, split: true });
          reportRules.forEach(function (rr, ri) {
            if (!ruleUsesOrig(ordered[ri], n, 'svc')) return;
            addItem(rr.items, 'split', 'info', { count: buckets.length });
          });
          return;
        }
      }
      svcList.push({
        orig: n, obj: obj, atoms: atoms, kind: obj.kind,
        members: obj.members || [], predef: pre
      });
    });

    var nameMapAddr = Object.create(null);
    var nameMapSvc = Object.create(null);
    var nameMapRule = Object.create(null);

    function emitOrder(list, isGroup) {
      var groups = list.filter(isGroup);
      var leaves = list.filter(function (x) { return !isGroup(x); });
      var out = [];
      var seen = Object.create(null);
      function visit(item) {
        if (seen[item.orig]) return;
        seen[item.orig] = true;
        var mems = (item.parsed && item.parsed.members) || item.members || [];
        mems.forEach(function (m) {
          var mn = typeof m === 'string' ? m : refName(m);
          list.forEach(function (o) { if (o.orig === mn) visit(o); });
        });
        out.push(item);
      }
      leaves.forEach(visit);
      groups.forEach(visit);
      list.forEach(function (x) { if (!seen[x.orig]) out.push(x); });
      return out;
    }
    addrList = emitOrder(addrList, function (x) { return (x.parsed && x.parsed.kind === 'group') || (x.obj && x.obj.kind === 'group'); });
    svcList = emitOrder(svcList, function (x) { return x.kind === 'group'; });

    addrList.forEach(function (a) {
      var nm = sanitize(a.orig, limits, usedAddr);
      if (nm !== a.orig) {
        renamed.push({ kind: 'addr', from: a.orig, to: nm });
        reportRules.forEach(function (rr, ri) {
          if (ruleUsesOrig(ordered[ri], a.orig, 'addr')) addItem(rr.items, 'renamed', 'info', {});
        });
      }
      a.name = nm;
      nameMapAddr[a.orig] = nm;
      if (a.parsed && a.parsed.members) {
        a.parsed.members = a.parsed.members.map(function (m) {
          var mn = typeof m === 'string' ? m : refName(m);
          return mn;
        });
      }
    });
    svcList.forEach(function (s) {
      if (s.predef && typeof s.predef === 'string') {
        var asaKeep = false;
        if (target === 'asa') {
          if (s.predef === 'icmp') asaKeep = true;
          var atp = s.atoms || [];
          var protos = {};
          atp.forEach(function (at) { protos[at.proto[0]] = true; });
          if (Object.keys(protos).length > 1) asaKeep = true;
        }
        if (!asaKeep) {
          s.name = s.predef;
          nameMapSvc[s.orig] = s.predef;
          s.skip = true;
          return;
        }
      }
      if (s.predef && Array.isArray(s.predef)) {
        s.name = s.orig;
        s.predefSet = s.predef;
        nameMapSvc[s.orig] = s.orig;
        return;
      }
      var nm = sanitize(s.orig, limits, usedSvc);
      if (nm !== s.orig) {
        renamed.push({ kind: 'svc', from: s.orig, to: nm });
        reportRules.forEach(function (rr, ri) {
          if (ruleUsesOrig(ordered[ri], s.orig, 'svc')) addItem(rr.items, 'renamed', 'info', {});
        });
      }
      s.name = nm;
      nameMapSvc[s.orig] = nm;
    });

    var ruleUsed = Object.create(null);
    modelRules.forEach(function (r) {
      if (!r.emit) return;
      var orig = r.name;
      var nm = limits.rule ? sanitizeRule(orig, limits, ruleUsed) : orig;
      if (nm !== orig) {
        renamed.push({ kind: 'rule', from: orig, to: nm });
        reportRules.forEach(function (rr) {
          if (rr.uid === r.origUid) addItem(rr.items, 'renamed', 'info', {});
        });
      }
      r.name = nm;
      r.srcNames = (r.srcNames || []).map(function (n) { return nameMapAddr[n] || n; });
      r.dstNames = (r.dstNames || []).map(function (n) { return nameMapAddr[n] || n; });
      r.svcNames = (r.svcNames || []).map(function (n) { return nameMapSvc[n] || n; });
    });
    reportRules.forEach(function (rr) {
      var hit = null;
      modelRules.forEach(function (m) { if (m.origUid === rr.uid && m.emit) hit = m; });
      if (hit) rr.targetName = hit.name;
    });

    addrList.forEach(function (a) {
      if (a.parsed && a.parsed.members) {
        a.parsed.members = a.parsed.members.map(function (n) { return nameMapAddr[n] || n; });
      }
      if (a.obj && a.obj.members && a.parsed && a.parsed.kind === 'group' && !a.synthetic) {
        a.parsed.members = a.obj.members.map(function (m) {
          if (isLit(m)) return null;
          return nameMapAddr[refName(m)] || refName(m);
        }).filter(Boolean);
        if (target === 'fortios' && a.obj.exclude && a.obj.exclude.length) {
          a.parsed.exclude = a.obj.exclude.map(function (m) { return nameMapAddr[refName(m)] || refName(m); });
        }
      }
    });
    svcList.forEach(function (s) {
      if (s.members && s.members.length) {
        s.members = s.members.map(function (m) { return nameMapSvc[refName(m)] || refName(m); });
      }
    });

    function flagEmptyGroup(orig, emittedName, kind) {
      reportRules.forEach(function (rr, ri) {
        if (!ruleUsesOrig(ordered[ri], orig, kind)) return;
        addItem(rr.items, 'empty_group', 'fail', { name: orig });
        rr.status = bump(rr.status, 'not_translated');
      });
      modelRules.forEach(function (r) {
        if (!r.emit) return;
        var names = kind === 'svc' ? (r.svcNames || []) : (r.srcNames || []).concat(r.dstNames || []);
        if (names.indexOf(emittedName) < 0 && names.indexOf(orig) < 0) return;
        r.emit = false;
      });
    }
    addrList.forEach(function (a) {
      if (!(a.parsed && a.parsed.kind === 'group')) return;
      if ((a.parsed.members || []).length) return;
      flagEmptyGroup(a.orig, a.name, 'addr');
      a.empty = true;
    });
    svcList.forEach(function (s) {
      if (s.kind !== 'group') return;
      if ((s.members || []).length) return;
      flagEmptyGroup(s.orig, s.name, 'svc');
      s.empty = true;
    });
    addrList = addrList.filter(function (a) { return !a.empty && a.parsed; });
    svcList = svcList.filter(function (s) { return !s.empty; });

    var unused = [];
    Object.keys(policy.objects.addr).forEach(function (n) {
      if ((policy.objects.addr[n].line || 0) > 0 && !addrNeed[n]) unused.push(n);
    });
    Object.keys(policy.objects.svc).forEach(function (n) {
      if ((policy.objects.svc[n].line || 0) > 0 && !svcNeed[n]) unused.push(n);
    });
    if (unused.length) notes.push({ code: 'unused_objects', params: { count: unused.length, names: unused.join(', ') } });

    var addrObjs = addrList.filter(function (a) { return !(a.parsed && a.parsed.kind === 'group'); });
    var addrGroups = addrList.filter(function (a) { return a.parsed && a.parsed.kind === 'group'; });
    var svcObjs = svcList.filter(function (s) { return s.kind !== 'group' && !s.skip; });
    var svcGroups = svcList.filter(function (s) { return s.kind === 'group'; });

    var counts = {
      rules: policy.rules.length,
      exact: 0, approximated: 0, not_translated: 0,
      addrObjs: addrObjs.length, addrGroups: addrGroups.length,
      svcObjs: svcObjs.length, svcGroups: svcGroups.length,
      unused: unused.length
    };
    reportRules.forEach(function (r) {
      if (r.status === 'exact') counts.exact++;
      else if (r.status === 'approximated') counts.approximated++;
      else counts.not_translated++;
    });

    var droppedAgg = Object.create(null);
    reportRules.forEach(function (r) {
      (r.items || []).forEach(function (it) {
        if (it.sev === 'info') return;
        if (!droppedAgg[it.code]) droppedAgg[it.code] = { code: it.code, count: 0, ruleIds: [] };
        droppedAgg[it.code].count++;
        droppedAgg[it.code].ruleIds.push(r.id);
      });
    });
    var dropped = Object.keys(droppedAgg).map(function (k) { return droppedAgg[k]; });

    var report = {
      source: source,
      target: target,
      counts: counts,
      rules: reportRules,
      dropped: dropped,
      renamed: renamed,
      zones: zpack.rows.map(function (r) {
        return { src: r.src, target: r.target, ifaces: r.ifaces, unmapped: r.unmapped };
      }),
      notes: notes,
      warnings: policy.warnings || []
    };

    var model = {
      sourceVendor: source,
      target: target,
      header: headerLines(source, target),
      zones: aggregateZoneRows(zpack.rows),
      addresses: addrList,
      services: svcList,
      rules: modelRules,
      limits: limits,
      caps: caps
    };

    var text = emitter.emit(model);
    return { text: text, report: report, model: model };
  }

  var api = {
    translate: translate,
    targetsFor: targetsFor,
    seedZones: seedZones,
    SOURCES: SOURCES,
    PREDEF: PREDEF_ROWS,
    sanitize: sanitize,
    svcSig: svcSig,
    zonesOf: zonesOf
  };
  root.FwTranslate = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
