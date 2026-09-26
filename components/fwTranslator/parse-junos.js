/* ──────────────────────────────────────────────────────────────────────
 * parse-junos.js — SRX security policies + Junos firewall filter
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var IR = (typeof module !== 'undefined' && module.exports) ? require('./fwIR.js') : root.FwIR;

  var JUNOS_APPS = {
    'junos-http': { proto: 6, dport: [[80, 80]] },
    'junos-https': { proto: 6, dport: [[443, 443]] },
    'junos-ssh': { proto: 6, dport: [[22, 22]] },
    'junos-telnet': { proto: 6, dport: [[23, 23]] },
    'junos-ftp': { proto: 6, dport: [[21, 21]] },
    'junos-smtp': { proto: 6, dport: [[25, 25]] },
    'junos-dns-udp': { proto: 17, dport: [[53, 53]] },
    'junos-dns-tcp': { proto: 6, dport: [[53, 53]] },
    'junos-ntp': { proto: 17, dport: [[123, 123]] },
    'junos-ping': { proto: 1, icmpType: 8 },
    'junos-icmp-all': { proto: 1 },
    'junos-bgp': { proto: 6, dport: [[179, 179]] },
    'junos-ike': { proto: 17, dport: [[500, 500]] },
    'junos-ike-nat': { proto: 17, dport: [[4500, 4500]] },
    'junos-radius': { proto: 17, dport: [[1812, 1812]] },
    'junos-syslog': { proto: 17, dport: [[514, 514]] },
    'junos-tftp': { proto: 17, dport: [[69, 69]] },
    'junos-ldap': { proto: 6, dport: [[389, 389]] },
    'junos-snmp-get': { proto: 17, dport: [[161, 161]] },
    'junos-pop3': { proto: 6, dport: [[110, 110]] },
    'junos-imap': { proto: 6, dport: [[143, 143]] },
    'junos-ms-rpc-tcp': { proto: 6, dport: [[135, 135]] },
    any: { any: true }
  };

  function tokenizeSetLine(s) {
    var tokens = [];
    var re = /"([^"]*)"|\[([^\]]*)\]|(\S+)/g;
    var m;
    while ((m = re.exec(s))) {
      if (m[1] !== undefined) tokens.push(m[1]);
      else if (m[2] !== undefined) tokens.push({ list: m[2].trim().split(/\s+/).filter(Boolean) });
      else tokens.push(m[3]);
    }
    return tokens;
  }

  function expandLists(tokens) {
    var listIdx = -1;
    for (var i = 0; i < tokens.length; i++) if (tokens[i] && tokens[i].list) { listIdx = i; break; }
    if (listIdx < 0) return [tokens.map(String)];
    var out = [];
    var list = tokens[listIdx].list;
    for (var j = 0; j < list.length; j++) {
      var copy = tokens.slice();
      copy[listIdx] = list[j];
      expandLists(copy).forEach(function (p) { out.push(p); });
    }
    return out;
  }

  function statementsFromSet(text, warnings) {
    var stmts = [];
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].replace(/\r$/, '').trim();
      if (!trimmed || trimmed.charAt(0) === '#' || trimmed.indexOf('/*') === 0) continue;
      var lineNo = i + 1;
      if (/^deactivate\s+/i.test(trimmed)) {
        var dt = tokenizeSetLine(trimmed.replace(/^deactivate\s+/i, ''));
        expandLists(dt).forEach(function (path) {
          stmts.push({ path: path, line: lineNo, inactive: true, deactivate: true });
        });
        continue;
      }
      if (/^(delete|insert)\s+/i.test(trimmed)) {
        warnings.push({ code: 'insert_unsupported', line: lineNo, params: { text: trimmed } });
        continue;
      }
      if (!/^set\s+/i.test(trimmed)) {
        if (!/^deactivate\s+/i.test(trimmed) && !/^[a-zA-Z0-9_-]+\s*\{/.test(trimmed) && trimmed !== '}' && trimmed !== '{') {
          warnings.push({ code: 'unparsed_line', line: lineNo, params: { text: trimmed } });
        }
        continue;
      }
      var tok = tokenizeSetLine(trimmed.replace(/^set\s+/i, '').replace(/;\s*$/, ''));
      expandLists(tok).forEach(function (path) {
        stmts.push({ path: path, line: lineNo, inactive: false });
      });
    }
    return stmts;
  }

  function stripBlockComments(src) {
    var out = '';
    var i = 0;
    while (i < src.length) {
      if (src.charAt(i) === '/' && src.charAt(i + 1) === '*') {
        i += 2;
        while (i < src.length && !(src.charAt(i) === '*' && src.charAt(i + 1) === '/')) {
          out += src.charAt(i) === '\n' ? '\n' : ' ';
          i++;
        }
        if (i < src.length) i += 2;
        continue;
      }
      out += src.charAt(i++);
    }
    return out;
  }

  function statementsFromCurly(text, warnings) {
    var src = stripBlockComments(String(text || ''));
    var tokens = [];
    var i = 0, line = 1;
    function skipWs() {
      while (i < src.length) {
        var c = src.charAt(i);
        if (c === '\n') { line++; i++; continue; }
        if (/\s/.test(c)) { i++; continue; }
        if (c === '#' || (c === '/' && src.charAt(i + 1) === '/')) {
          while (i < src.length && src.charAt(i) !== '\n') i++;
          continue;
        }
        break;
      }
    }
    while (i < src.length) {
      skipWs();
      if (i >= src.length) break;
      var c = src.charAt(i);
      var ln = line;
      if (c === '{') { tokens.push({ t: '{', line: ln }); i++; continue; }
      if (c === '}') { tokens.push({ t: '}', line: ln }); i++; continue; }
      if (c === ';') { tokens.push({ t: ';', line: ln }); i++; continue; }
      if (c === '"') {
        i++;
        var s = '';
        while (i < src.length && src.charAt(i) !== '"') {
          if (src.charAt(i) === '\n') line++;
          s += src.charAt(i++);
        }
        if (src.charAt(i) === '"') i++;
        tokens.push({ t: 'w', v: s, line: ln });
        continue;
      }
      if (c === '[') {
        i++;
        var inner = '';
        while (i < src.length && src.charAt(i) !== ']') {
          if (src.charAt(i) === '\n') line++;
          inner += src.charAt(i++);
        }
        if (src.charAt(i) === ']') i++;
        tokens.push({ t: 'list', v: inner.replace(/"/g, '').trim().split(/\s+/).filter(Boolean), line: ln });
        continue;
      }
      var w = '';
      while (i < src.length && !/[\s{};\[]/.test(src.charAt(i))) w += src.charAt(i++);
      if (String(w).toLowerCase() === 'inactive:') tokens.push({ t: 'inactive', line: ln });
      else tokens.push({ t: 'w', v: w, line: ln });
    }

    var stmts = [];
    var stack = [];
    var pending = [];
    var pendingLine = 1;
    var pendingInactive = false;

    function flat(extra) {
      var p = [];
      for (var s = 0; s < stack.length; s++) p = p.concat(stack[s].words);
      if (extra && extra.length) p = p.concat(extra);
      return p;
    }
    function emit(words, ln) {
      if (!words.length) return;
      var ancestor = false;
      var nodeInactive = false;
      for (var s = 0; s < stack.length; s++) {
        if (!stack[s].inactive) continue;
        ancestor = true;
        var w = stack[s].words || [];
        if (w.indexOf('policy') >= 0 || w.indexOf('term') >= 0) nodeInactive = true;
      }
      var leaf = (pendingInactive && !nodeInactive) || (ancestor && !nodeInactive);
      stmts.push({
        path: words,
        line: ln || pendingLine,
        inactive: nodeInactive,
        inactiveLeaf: leaf
      });
    }

    for (var k = 0; k < tokens.length; k++) {
      var tok = tokens[k];
      if (tok.t === 'inactive') { pendingInactive = true; continue; }
      if (tok.t === '{') {
        var inact = pendingInactive;
        for (var s2 = 0; s2 < stack.length; s2++) if (stack[s2].inactive) inact = true;
        stack.push({ words: pending, inactive: inact });
        pending = [];
        pendingInactive = false;
        continue;
      }
      if (tok.t === '}') {
        if (pending.length) emit(flat(pending), pendingLine);
        pending = [];
        pendingInactive = false;
        if (stack.length) stack.pop();
        continue;
      }
      if (tok.t === ';') {
        emit(flat(pending), pendingLine);
        pending = [];
        pendingInactive = false;
        continue;
      }
      if (tok.t === 'list') {
        var els = tok.v || [];
        for (var e = 0; e < els.length; e++) emit(flat(pending.concat([els[e]])), tok.line);
        pending = [];
        pendingInactive = false;
        continue;
      }
      if (tok.t === 'w') {
        if (!pending.length) pendingLine = tok.line;
        pending.push(tok.v);
      }
    }
    if (stack.length) {
      warnings.push({ code: 'unparsed_line', line: line, params: { text: 'unbalanced braces' } });
    }
    return stmts;
  }

  function isSetForm(text) {
    var lines = String(text).split(/\n/);
    var setN = 0, curly = 0;
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (/^set\s+/.test(t) || /^deactivate\s+/.test(t)) setN++;
      if (/\{\s*$/.test(t) || t === '{' ) curly++;
    }
    return setN >= curly;
  }

  function installBuiltins(policy) {
    Object.keys(JUNOS_APPS).forEach(function (name) {
      if (policy.objects.svc[name]) return;
      var spec = JUNOS_APPS[name];
      var atoms;
      if (spec.any) atoms = IR.anySvc();
      else if (spec.proto === 1) atoms = [IR.icmpAtom(spec.icmpType, spec.icmpCode)];
      else atoms = [IR.makeAtom(spec.proto, spec.proto, spec.sport || [[0, 65535]], spec.dport || [[0, 65535]])];
      policy.objects.svc[name] = { name: name, kind: 'atom', atoms: atoms, members: [], line: 0 };
    });
    if (!policy.objects.addr.any) {
      policy.objects.addr.any = { name: 'any', kind: 'host', value: { lo: 0, hi: 0xFFFFFFFF }, v6: 'any', members: [], line: 0 };
    }
    if (!policy.objects.addr['any-ipv4']) {
      policy.objects.addr['any-ipv4'] = { name: 'any-ipv4', kind: 'host', value: { lo: 0, hi: 0xFFFFFFFF }, v6: 'none', members: [], line: 0 };
    }
    if (!policy.objects.addr['any-ipv6']) {
      policy.objects.addr['any-ipv6'] = { name: 'any-ipv6', kind: 'fqdn', value: 'any-ipv6', members: [], line: 0 };
    }
  }

  function parseJunos(text) {
    var policy = IR.emptyPolicy('junos');
    installBuiltins(policy);
    var warnings = [];
    var stmts;
    if (isSetForm(text)) stmts = statementsFromSet(text, warnings);
    else stmts = statementsFromCurly(text, warnings);
    warnings.forEach(function (w) { policy.warnings.push(w); });

    var policies = Object.create(null); // key: zp|global + name
    var policyOrder = [];
    var filters = Object.create(null);
    var filterOrder = [];
    var apps = Object.create(null);
    var appSets = Object.create(null);
    var addrBooks = Object.create(null);
    var prefixLists = Object.create(null);
    var ignored = Object.create(null);
    var sawZone = false, sawGlobal = false;
    var deactivatePrefixes = [];

    function polKey(from, to, name, global) {
      return (global ? 'G:' : (from + '>' + to + ':')) + name;
    }

    function ensurePol(from, to, name, global, line, inactive) {
      var k = polKey(from, to, name, global);
      if (!policies[k]) {
        policies[k] = {
          from: from, to: to, name: name, global: global, line: line, inactive: !!inactive,
          src: [], dst: [], app: [], action: '', log: false, extra: {}, lines: [line],
          srcExcl: false, dstExcl: false, identity: false, dynapp: '', urlcat: false,
          utm: false, sched: '', fromZones: [], toZones: []
        };
        policyOrder.push(k);
      }
      var p = policies[k];
      if (inactive) p.inactive = true;
      if (p.lines.indexOf(line) < 0) p.lines.push(line);
      return p;
    }

    function ensureTerm(family, fname, tname, line, inactive) {
      var k = (family || 'inet') + ':' + fname + ':' + tname;
      if (!filters[k]) {
        filters[k] = {
          family: family || 'inet', filter: fname, term: tname, line: line, inactive: !!inactive,
          src: [], dst: [], proto: [], sport: [], dport: [], icmp: [],
          action: '', nextTerm: false, log: false, except: false, portEither: false,
          tcpFlags: false, option: false, lines: [line], raw: []
        };
        filterOrder.push(k);
      }
      var t = filters[k];
      if (inactive) t.inactive = true;
      if (t.lines.indexOf(line) < 0) t.lines.push(line);
      return t;
    }

    function markIgnored(block, line) {
      if (!ignored[block]) ignored[block] = { count: 0, line: line };
      ignored[block].count++;
    }

    for (var s0 = 0; s0 < stmts.length; s0++) {
      if (stmts[s0].deactivate) deactivatePrefixes.push(stmts[s0].path);
    }

    function nodePathOf(path) {
      if (!path || !path.length) return null;
      if (path[0] === 'security' && path[1] === 'policies' && path[2] === 'from-zone' && path[6] === 'policy' && path[7]) {
        return path.slice(0, 8);
      }
      if (path[0] === 'security' && path[1] === 'policies' && path[2] === 'global' && path[3] === 'policy' && path[4]) {
        return path.slice(0, 5);
      }
      if (path[0] === 'firewall') {
        var nidx = 1;
        if (path[1] === 'family') nidx = 3;
        if (path[nidx] === 'filter' && path[nidx + 1] && path[nidx + 2] === 'term' && path[nidx + 3]) {
          return path.slice(0, nidx + 4);
        }
      }
      return null;
    }

    function pathStarts(pref, full) {
      if (!pref || !full || pref.length > full.length) return false;
      for (var pi = 0; pi < pref.length; pi++) if (String(pref[pi]) !== String(full[pi])) return false;
      return true;
    }

    function isLeafDeactivated(path) {
      var node = nodePathOf(path);
      if (!node) return false;
      for (var d = 0; d < deactivatePrefixes.length; d++) {
        var pref = deactivatePrefixes[d];
        if (pref.length > node.length && pathStarts(pref, path)) return true;
      }
      return false;
    }

    for (var s = 0; s < stmts.length; s++) {
      var st = stmts[s];
      var p = st.path;
      if (!p || !p.length) continue;
      if (st.deactivate) continue;
      if (isLeafDeactivated(p)) {
        if (p[0] === 'security' && p[1] === 'policies' && p[2] === 'from-zone' && p[6] === 'policy' && p[7]) {
          ensurePol(p[3], p[5], p[7], false, st.line, false).option = 'deactivate-leaf';
        } else if (p[0] === 'security' && p[1] === 'policies' && p[2] === 'global' && p[3] === 'policy' && p[4]) {
          ensurePol('', '', p[4], true, st.line, false).option = 'deactivate-leaf';
        } else if (p[0] === 'firewall') {
          var lf = 'inet', lidx = 1;
          if (p[1] === 'family') { lf = p[2]; lidx = 3; }
          if (p[lidx] === 'filter' && p[lidx + 2] === 'term') {
            var lt = ensureTerm(lf, p[lidx + 1], p[lidx + 3], st.line, false);
            lt.option = true;
            lt.optionKey = 'deactivate-leaf';
          }
        }
        continue;
      }

      // address-book
      if (p[0] === 'security' && p[1] === 'address-book') {
        var book = p[2];
        if (p[3] === 'address' && p[4]) {
          var an = p[4];
          var rest = p.slice(5);
          var obj = policy.objects.addr[an];
          if (!obj) {
            obj = { name: an, kind: 'host', members: [], line: st.line };
            IR.addAddrObj(policy, obj);
          }
          if (rest[0] === 'range-address' && rest[1] && rest[3]) {
            obj.kind = 'range';
            var pr = IR.parseV4(rest[1] + '-' + rest[3]);
            obj.value = pr ? { lo: pr.lo, hi: pr.hi } : (rest[1] + '-' + rest[3]);
          } else if (rest[0] === 'dns-name') {
            obj.kind = 'fqdn'; obj.value = rest[1] || an;
          } else if (rest[0] === 'wildcard-address') {
            var pw = IR.parseV4(rest[1], { mode: 'wildcard' });
            obj.kind = 'wildcard';
            obj.contiguous = !!(pw && pw.contiguous);
            obj.value = pw && pw.contiguous ? { lo: pw.lo, hi: pw.hi } : rest[1];
          } else if (rest[0]) {
            var pv = IR.parseV4(rest[0]);
            if (pv && pv.contiguous) { obj.kind = pv.kind; obj.value = { lo: pv.lo, hi: pv.hi }; obj.v6 = 'none'; }
            else if (IR.looksLikeIpv6(rest[0])) { obj.kind = 'host'; obj.value = rest[0]; obj.ipv6 = true; }
          }
        } else if (p[3] === 'address-set' && p[4]) {
          var sn = p[4];
          if (!policy.objects.addr[sn] || policy.objects.addr[sn].kind !== 'group') {
            IR.addAddrObj(policy, { name: sn, kind: 'group', members: [], exclude: [], line: st.line });
          }
          var g = policy.objects.addr[sn];
          if (p[5] === 'address' && p[6]) g.members.push(p[6]);
          if (p[5] === 'address-set' && p[6]) g.members.push(p[6]);
        }
        continue;
      }

      // zone address-book
      if (p[0] === 'security' && p[1] === 'zones' && p[2] === 'security-zone' && p[4] === 'address-book') {
        var an2 = p[6];
        if (p[5] === 'address' && an2) {
          if (policy.objects.addr[an2] && policy.objects.addr[an2].line) {
            IR.addWarning(policy, 'duplicate_object', st.line, { name: an2 });
          }
          var obj2 = { name: an2, kind: 'host', members: [], line: st.line };
          var rest2 = p.slice(7);
          if (rest2[0]) {
            var pv2 = IR.parseV4(rest2[0]);
            if (pv2) { obj2.value = { lo: pv2.lo, hi: pv2.hi }; obj2.kind = pv2.kind; }
          }
          IR.addAddrObj(policy, obj2);
        }
        if (p[5] === 'address-set' && p[6]) {
          if (!policy.objects.addr[p[6]] || policy.objects.addr[p[6]].kind !== 'group') {
            IR.addAddrObj(policy, { name: p[6], kind: 'group', members: [], exclude: [], line: st.line });
          }
          if (p[7] === 'address' && p[8]) policy.objects.addr[p[6]].members.push(p[8]);
        }
        continue;
      }

      // security policies
      if (p[0] === 'security' && p[1] === 'policies') {
        if (p[2] === 'default-policy') {
          IR.addWarning(policy, 'default_policy_ignored', st.line, {});
          continue;
        }
        if (p[2] === 'policy-rematch' || p[2] === 'pre-id-default-policy') {
          markIgnored(p[2], st.line); continue;
        }
        if (p[2] === 'from-zone' && p[4] === 'to-zone' && p[6] === 'policy') {
          sawZone = true;
          var from = p[3], to = p[5], pname = p[7];
          var pol = ensurePol(from, to, pname, false, st.line, st.inactive && !st.inactiveLeaf);
          if (st.inactiveLeaf) {
            pol.option = pol.option || 'inactive-leaf';
            continue;
          }
          var restp = p.slice(8);
          applyPolicyRest(pol, restp, st);
          continue;
        }
        if (p[2] === 'global' && p[3] === 'policy') {
          sawGlobal = true;
          var gp = ensurePol('', '', p[4], true, st.line, st.inactive && !st.inactiveLeaf);
          if (st.inactiveLeaf) {
            gp.option = gp.option || 'inactive-leaf';
            continue;
          }
          applyPolicyRest(gp, p.slice(5), st);
          continue;
        }
        markIgnored('security ' + (p[2] || ''), st.line);
        continue;
      }

      // applications
      if (p[0] === 'applications' && p[1] === 'application' && p[2]) {
        var apn = p[2];
        if (!apps[apn]) apps[apn] = { name: apn, proto: null, sport: [[0, 65535]], dport: [[0, 65535]], icmp: null, terms: {}, line: st.line };
        var ap = apps[apn];
        applyAppFields(ap, p.slice(3));
        continue;
      }
      if (p[0] === 'applications' && p[1] === 'application-set' && p[2]) {
        if (!policy.objects.svc[p[2]] || policy.objects.svc[p[2]].kind !== 'group') {
          IR.addSvcObj(policy, { name: p[2], kind: 'group', members: [], atoms: [], line: st.line });
        }
        if (p[3] === 'application' && p[4]) policy.objects.svc[p[2]].members.push(p[4]);
        if (p[3] === 'application-set' && p[4]) policy.objects.svc[p[2]].members.push(p[4]);
        continue;
      }

      // prefix-list
      if (p[0] === 'policy-options' && p[1] === 'prefix-list' && p[2]) {
        if (!prefixLists[p[2]]) prefixLists[p[2]] = [];
        if (p[3] === 'apply-path') prefixLists[p[2]].push({ unresolved: true });
        else if (p[3]) prefixLists[p[2]].push(p[3]);
        continue;
      }

      // firewall filter
      if (p[0] === 'firewall') {
        var family = 'inet';
        var idx = 1;
        if (p[1] === 'family') { family = p[2]; idx = 3; }
        if (p[idx] === 'filter' && p[idx + 1] && p[idx + 2] === 'term') {
          var fname = p[idx + 1], tname = p[idx + 3];
          var term = ensureTerm(family, fname, tname, st.line, st.inactive && !st.inactiveLeaf);
          term.raw.push(p.join(' '));
          if (st.inactiveLeaf) {
            term.option = true;
            term.optionKey = term.optionKey || 'inactive-leaf';
            continue;
          }
          var r = p.slice(idx + 4);
          applyTermRest(term, r, prefixLists, st);
          continue;
        }
        markIgnored('firewall', st.line);
        continue;
      }

      if (p[0] === 'security') { markIgnored('security ' + (p[1] || ''), st.line); continue; }
      markIgnored(p[0], st.line);
    }

    function pathIsPrefix(pref, full) {
      if (!pref || !full || pref.length > full.length) return false;
      for (var i = 0; i < pref.length; i++) if (String(pref[i]) !== String(full[i])) return false;
      return true;
    }
    deactivatePrefixes.forEach(function (pref) {
      Object.keys(policies).forEach(function (k) {
        var pol = policies[k];
        var path = pol.global
          ? ['security', 'policies', 'global', 'policy', pol.name]
          : ['security', 'policies', 'from-zone', pol.from, 'to-zone', pol.to, 'policy', pol.name];
        if (pathIsPrefix(pref, path)) pol.inactive = true;
        else if (pathIsPrefix(path, pref)) pol.option = pol.option || 'deactivate-leaf';
      });
      Object.keys(filters).forEach(function (k) {
        var t = filters[k];
        var withFam = ['firewall', 'family', t.family || 'inet', 'filter', t.filter, 'term', t.term];
        var noFam = ['firewall', 'filter', t.filter, 'term', t.term];
        if (pathIsPrefix(pref, withFam) || pathIsPrefix(pref, noFam)) t.inactive = true;
        else if (pathIsPrefix(withFam, pref) || pathIsPrefix(noFam, pref)) {
          t.option = true;
          t.optionKey = t.optionKey || 'deactivate-leaf';
        }
      });
    });

    Object.keys(apps).forEach(function (n) {
      var ap = apps[n];
      if (ap.unanalysable) {
        IR.addSvcObj(policy, {
          name: n, kind: 'atom', atoms: [], members: [], line: ap.line,
          unanalysable: true, unanalysableConstruct: 'option'
        });
        return;
      }
      var atoms = [];
      var tnames = Object.keys(ap.terms);
      if (tnames.length) {
        tnames.forEach(function (tn) {
          var t = ap.terms[tn];
          var pr = t.proto || ap.proto || [0, 255];
          if (pr[0] === 1) atoms.push(IR.icmpAtom(ap.icmp, null));
          else atoms.push(IR.makeAtom(pr[0], pr[1], t.sport, t.dport));
        });
      } else {
        var pr2 = ap.proto || [0, 255];
        if (pr2[0] === 1) atoms.push(IR.icmpAtom(ap.icmp, null));
        else atoms.push(IR.makeAtom(pr2[0], pr2[1], ap.sport, ap.dport));
      }
      IR.addSvcObj(policy, { name: n, kind: 'atom', atoms: atoms, members: [], line: ap.line });
    });

    if (sawZone && sawGlobal) IR.addWarning(policy, 'global_after_zone', 0, {});

    // emit SRX policies in first-seen order
    var zpOrder = Object.create(null);
    policyOrder.forEach(function (k) {
      var pol = policies[k];
      var scopeKey = pol.global ? 'global' : ('zp:' + pol.from + '>' + pol.to);
      if (!zpOrder[scopeKey]) {
        zpOrder[scopeKey] = 0;
        IR.ensureScope(policy, scopeKey, {
          kind: pol.global ? 'global' : 'zone-pair',
          label: pol.global ? 'global' : (pol.from + ' → ' + pol.to),
          from: pol.from, to: pol.to
        });
      }
      var action = pol.action === 'permit' ? 'permit' : (pol.action === 'reject' ? 'reject' : (pol.action === 'deny' ? 'deny' : 'deny'));
      var terminal = action === 'permit' || action === 'deny' || action === 'reject';
      if (!pol.action) { action = 'none'; terminal = false; }
      var rule = IR.makeRule({
        id: pol.name, name: pol.name, scopeKey: scopeKey, order: zpOrder[scopeKey]++,
        lines: pol.lines, raw: 'policy ' + pol.name, action: action, terminal: terminal,
        disabled: !!pol.inactive, log: !!pol.log,
        srcRefs: pol.src.length ? pol.src : ['any'],
        dstRefs: pol.dst.length ? pol.dst : ['any'],
        svcRefs: pol.app.length ? pol.app : ['any'],
        srcIntf: pol.global ? pol.fromZones : [],
        dstIntf: pol.global ? pol.toZones : []
      });
      if (pol.identity) IR.pushUnsup(rule, 'user', 'source-identity', pol.line);
      if (pol.dynapp && pol.dynapp !== 'any' && pol.dynapp !== 'none') IR.pushUnsup(rule, 'app_id', pol.dynapp, pol.line);
      if (pol.urlcat) IR.pushUnsup(rule, 'url_category', 'url-category', pol.line);
      if (pol.srcExcl || pol.dstExcl) IR.pushUnsup(rule, 'negate', 'excluded', pol.line);
      if (pol.utm) IR.pushUnsup(rule, 'utm', 'application-services', pol.line);
      if (pol.sched) IR.pushUnsup(rule, 'schedule', pol.sched, pol.line);
      if (pol.option) IR.pushUnsup(rule, 'option', pol.option, pol.line);
      // any-ipv6 object is fqdn kind → unresolved/fqdn via expand; force ipv6
      if ((pol.src || []).indexOf('any-ipv6') >= 0 || (pol.dst || []).indexOf('any-ipv6') >= 0) {
        IR.pushUnsup(rule, 'ipv6', 'any-ipv6', pol.line);
      }
      IR.pushRule(policy, rule);
    });

    filterOrder.forEach(function (k) {
      var t = filters[k];
      function applyPl(list, dest) {
        (list || []).forEach(function (pl) {
          if (pl.except) t.except = true;
          var entries = prefixLists[pl.name];
          if (!entries) { t.unresolvedPl = pl.name; return; }
          entries.forEach(function (x) {
            if (x && x.unresolved) t.unresolvedPl = pl.name;
            else dest.push({ lit: { kind: 'subnet', value: x } });
          });
        });
      }
      applyPl(t.srcPl, t.src);
      applyPl(t.dstPl, t.dst);
      var scopeKey = 'filter:' + t.family + ':' + t.filter;
      IR.ensureScope(policy, scopeKey, { kind: 'filter', label: t.filter, from: t.family });
      var order = IR.scopeOrderCount(policy, scopeKey);
      var action = 'permit';
      var terminal = true;
      if (t.nextTerm) { action = 'none'; terminal = false; }
      else if (t.action === 'discard') { action = 'deny'; }
      else if (t.action === 'reject') { action = 'reject'; }
      else if (t.action === 'accept') { action = 'permit'; }
      else if (t.action === 'option') { action = 'permit'; }
      else { action = 'permit'; terminal = true; } // default accept
      var srcRefs = t.src.length ? t.src : [{ lit: { kind: 'any', value: 'any4' } }];
      var dstRefs = t.dst.length ? t.dst : [{ lit: { kind: 'any', value: 'any4' } }];
      var svcRefs = buildFilterSvc(t);
      var rule = IR.makeRule({
        id: t.term, name: t.term, scopeKey: scopeKey, order: order,
        lines: t.lines, raw: t.raw.join('\n'), action: action, terminal: terminal,
        disabled: !!t.inactive, log: !!t.log,
        srcRefs: srcRefs, dstRefs: dstRefs, svcRefs: svcRefs
      });
      if (t.family === 'inet6') IR.pushUnsup(rule, 'ipv6', 'inet6', t.line);
      if (t.except) IR.pushUnsup(rule, 'negate', 'except', t.line);
      if (t.portEither) IR.pushUnsup(rule, 'port_either', 'port', t.line);
      if (t.tcpFlags) IR.pushUnsup(rule, 'tcp_flags', 'tcp-flags', t.line);
      if (t.option) IR.pushUnsup(rule, 'option', t.optionKey || 'filter-option', t.line);
      if (t.unresolvedPl) IR.pushUnsup(rule, 'unresolved', t.unresolvedPl, t.line);
      IR.pushRule(policy, rule);
    });

    Object.keys(ignored).forEach(function (b) {
      IR.addWarning(policy, 'ignored_block', ignored[b].line, { block: b, count: ignored[b].count });
    });

    // leftover unparsed: lines that weren't set/curly and weren't comments — handled by set parser skip
    return policy;
  }

  function applyAppFields(ap, rest) {
    var i = 0;
    var target = ap;
    if (rest[0] === 'term' && rest[1]) {
      if (!ap.terms[rest[1]]) ap.terms[rest[1]] = { proto: null, sport: [[0, 65535]], dport: [[0, 65535]], icmp: null };
      target = ap.terms[rest[1]];
      i = 2;
    }
    while (i < rest.length) {
      var k = rest[i];
      var v = rest[i + 1];
      if (k === 'protocol' && v) {
        var lp = IR.lookupProto(v);
        if (!lp.err) target.proto = [lp.lo, lp.hi];
        else ap.unanalysable = v;
        i += 2; continue;
      }
      if (k === 'destination-port' && v) {
        var dpr = parseJunosPort(v);
        if (dpr) target.dport = dpr;
        else ap.unanalysable = v;
        i += 2; continue;
      }
      if (k === 'source-port' && v) {
        var spr = parseJunosPort(v);
        if (spr) target.sport = spr;
        else ap.unanalysable = v;
        i += 2; continue;
      }
      if (k === 'icmp-type' && v) {
        var ic = IR.lookupIcmp(v);
        if (!ic.err) target.icmp = ic.type;
        else ap.unanalysable = v;
        i += 2; continue;
      }
      if (k === 'inactivity-timeout' || k === 'application-protocol') { i += v ? 2 : 1; continue; }
      if (k === 'term' && v) {
        if (!ap.terms[v]) ap.terms[v] = { proto: null, sport: [[0, 65535]], dport: [[0, 65535]], icmp: null };
        target = ap.terms[v];
        i += 2; continue;
      }
      if (k) ap.unanalysable = k;
      i += v ? 2 : 1;
    }
  }

  function applyPolicyRest(pol, rest, st) {
    if (!rest.length) return;
    if (rest[0] === 'match') {
      var i = 1;
      while (i < rest.length) {
        var k = rest[i];
        var v = rest[i + 1];
        if (k === 'source-address' && v) { pol.src.push(v); i += 2; continue; }
        if (k === 'destination-address' && v) { pol.dst.push(v); i += 2; continue; }
        if (k === 'application' && v) { pol.app.push(v); i += 2; continue; }
        if (k === 'source-identity') { pol.identity = true; i += v ? 2 : 1; continue; }
        if (k === 'dynamic-application' && v) { pol.dynapp = v; i += 2; continue; }
        if (k === 'url-category') { pol.urlcat = true; i += v ? 2 : 1; continue; }
        if (k === 'source-address-excluded') { pol.srcExcl = true; i += 1; continue; }
        if (k === 'destination-address-excluded') { pol.dstExcl = true; i += 1; continue; }
        if (k === 'from-zone' && v) { pol.fromZones.push(v); i += 2; continue; }
        if (k === 'to-zone' && v) { pol.toZones.push(v); i += 2; continue; }
        if (k) pol.option = k;
        i += v ? 2 : 1;
      }
    } else if (rest[0] === 'then') {
      if (rest[1] === 'permit') {
        pol.action = 'permit';
        if (rest[2] === 'application-services') pol.utm = true;
        else if (rest[2] && rest[2] !== 'log' && rest[2] !== 'count') pol.option = rest[2];
      } else if (rest[1] === 'deny') pol.action = 'deny';
      else if (rest[1] === 'reject') pol.action = 'reject';
      else if (rest[1] === 'log') pol.log = true;
      else if (rest[1] === 'count') { /* ignore */ }
      else if (rest[1]) pol.option = rest[1];
    } else if (rest[0] === 'scheduler-name' && rest[1]) {
      pol.sched = rest[1];
    }
  }

  function parseJunosPort(tok) {
    if (!tok) return null;
    if (String(tok).indexOf('-') >= 0) {
      var ab = String(tok).split('-');
      var a = Number(ab[0]), b = Number(ab[1]);
      if (isFinite(a) && isFinite(b)) return [[Math.min(a, b), Math.max(a, b)]];
      return null;
    }
    var lp = IR.lookupPort(tok);
    if (lp.err) return null;
    return [[lp.port, lp.port]];
  }

  function applyOneFrom(term, f, v, restTail) {
    if (f === 'source-address' && v) {
      if (restTail === 'except') term.except = true;
      var pv = IR.parseV4(v);
      if (pv) term.src.push({ lit: { kind: 'subnet', value: v } });
      else if (IR.looksLikeIpv6(v)) term.family = 'inet6';
      return v ? 2 : 1;
    }
    if (f === 'destination-address' && v) {
      if (restTail === 'except') term.except = true;
      var pv2 = IR.parseV4(v);
      if (pv2) term.dst.push({ lit: { kind: 'subnet', value: v } });
      return v ? 2 : 1;
    }
    if (f === 'address') {
      term.option = true;
      term.optionKey = 'address';
      return v ? 2 : 1;
    }
    if (f === 'source-prefix-list' && v) {
      term.srcPl = term.srcPl || [];
      term.srcPl.push({ name: v, except: restTail === 'except' });
      if (restTail === 'except') term.except = true;
      return restTail === 'except' ? 3 : 2;
    }
    if (f === 'destination-prefix-list' && v) {
      term.dstPl = term.dstPl || [];
      term.dstPl.push({ name: v, except: restTail === 'except' });
      if (restTail === 'except') term.except = true;
      return restTail === 'except' ? 3 : 2;
    }
    if (f === 'protocol' && v) {
      var lp = IR.lookupProto(v);
      if (!lp.err) term.proto.push([lp.lo, lp.hi]);
      else { term.option = true; term.optionKey = v; }
      return 2;
    }
    if (f === 'source-port' && v) {
      var sp = parseJunosPort(v);
      if (sp) term.sport = term.sport.concat(sp);
      else { term.option = true; term.optionKey = v; }
      return 2;
    }
    if (f === 'destination-port' && v) {
      var dp = parseJunosPort(v);
      if (dp) term.dport = term.dport.concat(dp);
      else { term.option = true; term.optionKey = v; }
      return 2;
    }
    if (f === 'icmp-type' && v) {
      var ic = IR.lookupIcmp(v);
      if (!ic.err) term.icmp.push(ic.type);
      else { term.option = true; term.optionKey = v; }
      return 2;
    }
    if (f === 'port') { term.portEither = true; return v ? 2 : 1; }
    if (f === 'tcp-established' || f === 'tcp-flags' || f === 'tcp-initial') { term.tcpFlags = true; return v ? 2 : 1; }
    if (f === 'interface' || f === 'dscp' || f === 'precedence' || f === 'packet-length' ||
        f === 'ttl' || f === 'forwarding-class' || f === 'is-fragment' ||
        (f && String(f).indexOf('fragment') === 0)) {
      term.option = true;
      term.optionKey = f;
      return v ? 2 : 1;
    }
    if (f === 'except') { term.except = true; return 1; }
    if (f) { term.option = true; term.optionKey = f; }
    return v ? 2 : 1;
  }

  function applyTermRest(term, r, prefixLists, st) {
    if (!r.length) return;
    if (r[0] === 'from') {
      var i = 1;
      while (i < r.length) {
        i += applyOneFrom(term, r[i], r[i + 1], r[i + 2]);
      }
    } else if (r[0] === 'then') {
      if (r[1] === 'accept') term.action = 'accept';
      else if (r[1] === 'discard') term.action = 'discard';
      else if (r[1] === 'reject') term.action = 'reject';
      else if (r[1] === 'next' && r[2] === 'term') { term.nextTerm = true; term.action = 'next'; }
      else if (r[1] === 'routing-instance') { term.option = true; term.optionKey = 'routing-instance'; term.action = 'option'; }
      else if (r[1] === 'log' || r[1] === 'syslog') { term.log = true; }
      else if (r[1] === 'count' || r[1] === 'policer' || r[1] === 'forwarding-class' || r[1] === 'loss-priority') {
        /* modifiers; default accept */
      } else if (r[1]) {
        term.option = true;
        term.optionKey = r[1];
      }
    }
  }

  function buildFilterSvc(t) {
    var atoms = [];
    var protos = t.proto.length ? t.proto : [[0, 255]];
    var sports = t.sport.length ? t.sport : [[0, 65535]];
    var dports = t.dport.length ? t.dport : [[0, 65535]];
    if (t.icmp.length) {
      t.icmp.forEach(function (ty) { atoms.push({ lit: { proto: 1, icmpType: ty } }); });
      return atoms;
    }
    protos.forEach(function (pr) {
      atoms.push({ lit: { proto: pr, sport: sports, dport: dports } });
    });
    return atoms;
  }

  function detect(text) {
    var score = 0;
    if (/^set\s+security\s+policies\b/im.test(text)) score += 50;
    if (/from-zone\s+\S+\s+to-zone\s+\S+\s+policy\b/i.test(text)) score += 30;
    if (/^set\s+firewall\s+(family\s+inet\s+)?filter\b/im.test(text)) score += 35;
    if (/security\s+policies\s*\{/m.test(text)) score += 40;
    if (/^set\s+security\s+address-book\b/im.test(text)) score += 15;
    if (/^config\s+firewall\b/im.test(text)) score -= 50;
    if (/^\*filter\b/m.test(text)) score -= 40;
    if (/^ip access-list\b/im.test(text) || /^access-list\s+\S+\s+extended\b/im.test(text)) score -= 30;
    return Math.max(0, Math.min(100, score));
  }

  var SAMPLE = [
    'set security address-book global address NET16 10.0.0.0/16',
    'set security address-book global address NET24 10.0.1.0/24',
    'set security address-book global address HOST 192.0.2.10/32',
    'set security address-book global address NET8 10.0.0.0/8',
    'set security policies from-zone trust to-zone untrust policy allow-https match source-address NET16',
    'set security policies from-zone trust to-zone untrust policy allow-https match destination-address any',
    'set security policies from-zone trust to-zone untrust policy allow-https match application junos-https',
    'set security policies from-zone trust to-zone untrust policy allow-https then permit',
    'set security policies from-zone trust to-zone untrust policy allow-https-narrow match source-address NET24',
    'set security policies from-zone trust to-zone untrust policy allow-https-narrow match destination-address HOST',
    'set security policies from-zone trust to-zone untrust policy allow-https-narrow match application junos-https',
    'set security policies from-zone trust to-zone untrust policy allow-https-narrow then permit',
    'set security policies from-zone trust to-zone untrust policy allow-https-dup match source-address NET16',
    'set security policies from-zone trust to-zone untrust policy allow-https-dup match destination-address any',
    'set security policies from-zone trust to-zone untrust policy allow-https-dup match application junos-https',
    'set security policies from-zone trust to-zone untrust policy allow-https-dup then permit',
    'set security policies from-zone trust to-zone untrust policy deny-net8 match source-address NET8',
    'set security policies from-zone trust to-zone untrust policy deny-net8 match destination-address any',
    'set security policies from-zone trust to-zone untrust policy deny-net8 match application any',
    'set security policies from-zone trust to-zone untrust policy deny-net8 then deny',
    'set security policies from-zone trust to-zone untrust policy allow-ssh match source-address NET24',
    'set security policies from-zone trust to-zone untrust policy allow-ssh match destination-address any',
    'set security policies from-zone trust to-zone untrust policy allow-ssh match application junos-ssh',
    'set security policies from-zone trust to-zone untrust policy allow-ssh then permit',
    'set security policies from-zone trust to-zone untrust policy ident match source-address any',
    'set security policies from-zone trust to-zone untrust policy ident match destination-address any',
    'set security policies from-zone trust to-zone untrust policy ident match application any',
    'set security policies from-zone trust to-zone untrust policy ident match source-identity userA',
    'set security policies from-zone trust to-zone untrust policy ident then permit',
    'set security policies from-zone dmz to-zone untrust policy dmz-web match source-address NET16',
    'set security policies from-zone dmz to-zone untrust policy dmz-web match destination-address any',
    'set security policies from-zone dmz to-zone untrust policy dmz-web match application junos-https',
    'set security policies from-zone dmz to-zone untrust policy dmz-web then permit',
    'set firewall family inet filter SAMPLE term t1 from source-address 10.0.0.0/16',
    'set firewall family inet filter SAMPLE term t1 from protocol tcp',
    'set firewall family inet filter SAMPLE term t1 from destination-port 443',
    'set firewall family inet filter SAMPLE term t1 then accept',
    'set firewall family inet filter SAMPLE term t2 from source-address 10.0.1.0/24',
    'set firewall family inet filter SAMPLE term t2 from protocol tcp',
    'set firewall family inet filter SAMPLE term t2 from destination-port 443',
    'set firewall family inet filter SAMPLE term t2 then accept',
    'set firewall family inet filter SAMPLE term t3 from source-address 10.0.0.0/16',
    'set firewall family inet filter SAMPLE term t3 from protocol tcp',
    'set firewall family inet filter SAMPLE term t3 from destination-port 443',
    'set firewall family inet filter SAMPLE term t3 then accept',
    'set firewall family inet filter SAMPLE term t4 from source-address 10.0.0.0/8',
    'set firewall family inet filter SAMPLE term t4 then discard',
    'set firewall family inet filter SAMPLE term t5 from source-address 10.1.1.0/24',
    'set firewall family inet filter SAMPLE term t5 from protocol tcp',
    'set firewall family inet filter SAMPLE term t5 from destination-port 22',
    'set firewall family inet filter SAMPLE term t5 then accept',
    'set firewall family inet filter SAMPLE term t6 from source-address 192.0.2.0/24 except',
    'set firewall family inet filter SAMPLE term t6 then accept'
  ].join('\n');

  var api = { vendor: 'junos', detect: detect, parse: parseJunos, sample: SAMPLE };
  root.FwParsers = root.FwParsers || {};
  root.FwParsers.junos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
