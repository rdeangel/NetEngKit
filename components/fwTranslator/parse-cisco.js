/* ──────────────────────────────────────────────────────────────────────
 * parse-cisco.js — Cisco IOS/IOS-XE ACL + Cisco ASA ACL parsers.
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var IR = (typeof module !== 'undefined' && module.exports) ? require('./fwIR.js') : root.FwIR;

  function isComment(line) {
    var t = line.trim();
    return !t || t.charAt(0) === '!' || t.charAt(0) === '#';
  }

  function stdAclNum(n) {
    return (n >= 1 && n <= 99) || (n >= 1300 && n <= 1999);
  }
  function extAclNum(n) {
    return (n >= 100 && n <= 199) || (n >= 2000 && n <= 2699);
  }

  function consumePorts(tokens, i, rule) {
    if (i >= tokens.length) return { intervals: [[0, 65535]], next: i };
    var op = String(tokens[i]).toLowerCase();
    if (op !== 'eq' && op !== 'neq' && op !== 'lt' && op !== 'gt' && op !== 'range') {
      return { intervals: [[0, 65535]], next: i };
    }
    i++;
    function onePort(tok) {
      var lp = IR.lookupPort(tok);
      if (lp.err) {
        IR.pushUnsup(rule, 'option', tok, rule.lines[0] || 0);
        return null;
      }
      return lp.port;
    }
    if (op === 'range') {
      if (i + 1 >= tokens.length) return { intervals: [[0, 65535]], next: i };
      var a = onePort(tokens[i]), b = onePort(tokens[i + 1]);
      i += 2;
      if (a == null || b == null) return { intervals: [[0, 65535]], next: i };
      return { intervals: IR.portOpIntervals('range', a, b), next: i };
    }
    if (op === 'eq') {
      var ports = [];
      while (i < tokens.length) {
        var t = tokens[i];
        var low = String(t).toLowerCase();
        if (low === 'eq' || low === 'neq' || low === 'lt' || low === 'gt' || low === 'range') break;
        if (low === 'log' || low === 'log-input' || low === 'established' || low === 'time-range' ||
            low === 'dscp' || low === 'precedence' || low === 'tos' || low === 'ttl' ||
            low === 'fragments' || low === 'option' || low === 'match-all' || low === 'match-any' ||
            low === 'reflect' || low === 'evaluate' || low === 'inactive' || low === 'user' ||
            low === 'user-group' || low === 'security-group' || low === 'object-group-user') break;
        var p = onePort(t);
        i++;
        if (p == null) continue;
        ports.push([p, p]);
        // IOS typically takes one port after eq; extra numeric/names continue
        if (op === 'eq' && i < tokens.length && !/^\d+$/.test(tokens[i]) && !IR.PORT_NAMES[String(tokens[i]).toLowerCase()]) break;
      }
      if (!ports.length) return { intervals: [[0, 65535]], next: i };
      return { intervals: IR.mergeIntervals(ports), next: i };
    }
    if (i >= tokens.length) return { intervals: [[0, 65535]], next: i };
    var p2 = onePort(tokens[i]);
    i++;
    if (p2 == null) return { intervals: [[0, 65535]], next: i };
    var iv = IR.portOpIntervals(op, p2, 0);
    return { intervals: iv || [[0, 65535]], next: i };
  }

  function parseAddr(tokens, i, mode, rule) {
    // mode: 'wildcard' (IOS ACE) | 'mask' (ASA ACE) | 'og-mask' (IOS object-group)
    if (i >= tokens.length) return { refs: [], next: i };
    var t = String(tokens[i]);
    var low = t.toLowerCase();
    var line = rule.lines[0] || 0;

    if (low === 'any' || low === 'any4' || low === 'any6') {
      if (low === 'any6') IR.pushUnsup(rule, 'ipv6', 'any6', line);
      var val = low === 'any4' ? 'any4' : (low === 'any6' ? 'any6' : (mode === 'wildcard' ? 'any4' : 'any'));
      return { refs: [{ lit: { kind: 'any', value: val } }], next: i + 1 };
    }
    if (low === 'host') {
      if (i + 1 >= tokens.length) return { refs: [], next: i + 1 };
      var h = tokens[i + 1];
      if (IR.looksLikeIpv6(h)) { IR.pushUnsup(rule, 'ipv6', h, line); return { refs: [], next: i + 2 }; }
      return { refs: [{ lit: { kind: 'host', value: h } }], next: i + 2 };
    }
    if (low === 'object-group' || low === 'object') {
      if (i + 1 >= tokens.length) return { refs: [], next: i + 1 };
      return { refs: [tokens[i + 1]], next: i + 2 };
    }
    if (low === 'interface') {
      IR.pushUnsup(rule, 'option', 'interface', line);
      return { refs: [], next: i + (i + 1 < tokens.length ? 2 : 1) };
    }
    if (IR.looksLikeIpv6(t)) {
      IR.pushUnsup(rule, 'ipv6', t, line);
      var skip = i + 1;
      if (skip < tokens.length && (IR.isIpv4Token(tokens[skip]) || IR.looksLikeIpv6(tokens[skip]) || String(tokens[skip]).indexOf(':') >= 0)) skip++;
      return { refs: [], next: skip };
    }
    if (t.indexOf('/') >= 0) {
      var p = IR.parseV4(t);
      if (p && p.contiguous) return { refs: [{ lit: { kind: 'subnet', value: t } }], next: i + 1 };
      if (IR.looksLikeIpv6(t) || t.indexOf(':') >= 0) { IR.pushUnsup(rule, 'ipv6', t, line); return { refs: [], next: i + 1 }; }
    }
    if (IR.isIpv4Token(t)) {
      if (i + 1 < tokens.length && IR.isIpv4Token(tokens[i + 1])) {
        var pair = t + ' ' + tokens[i + 1];
        var parsed = IR.parseV4(pair, { mode: mode === 'wildcard' ? 'wildcard' : 'mask' });
        if (parsed && parsed.wildcard && !parsed.contiguous) {
          IR.pushUnsup(rule, 'wildcard', pair, line);
          return { refs: [{ lit: { kind: 'wildcard', value: pair } }], next: i + 2 };
        }
        var k = (mode === 'wildcard') ? 'wildcard' : 'subnet';
        return { refs: [{ lit: { kind: k, value: pair } }], next: i + 2 };
      }
      return { refs: [{ lit: { kind: 'host', value: t } }], next: i + 1 };
    }
    return null;
  }

  var TCP_FLAG_WORDS = {
    ack: 1, syn: 1, fin: 1, psh: 1, rst: 1, urg: 1, ece: 1, cwr: 1, ns: 1
  };

  function takePortGroup(tokens, i, rule) {
    if (i >= tokens.length) return i;
    var low = String(tokens[i]).toLowerCase();
    if ((low === 'object-group' || low === 'object') && i + 1 < tokens.length) {
      rule.svcRefs = [tokens[i + 1]];
      return i + 2;
    }
    return i;
  }

  function flagTrailing(tokens, i, rule, dialect) {
    while (i < tokens.length) {
      var low = String(tokens[i]).toLowerCase();
      var line = rule.lines[0] || 0;
      if (low === 'log' || low === 'log-input') { rule.log = true; i++; continue; }
      if (low === 'established') { IR.pushUnsup(rule, 'tcp_flags', 'established', line); i++; continue; }
      if (TCP_FLAG_WORDS[low]) { IR.pushUnsup(rule, 'tcp_flags', low, line); i++; continue; }
      if (low === 'time-range') { IR.pushUnsup(rule, 'schedule', tokens[i + 1] || 'time-range', line); i += 2; continue; }
      if (low === 'inactive') { rule.disabled = true; i++; continue; }
      if (low === 'dscp' || low === 'precedence' || low === 'tos' || low === 'ttl' ||
          low === 'fragments' || low === 'option' || low === 'match-all' || low === 'match-any' ||
          low === 'reflect' || low === 'evaluate') {
        IR.pushUnsup(rule, 'option', low, line);
        i += (low === 'dscp' || low === 'precedence' || low === 'tos' || low === 'ttl' || low === 'option' || low === 'reflect' || low === 'evaluate') ? 2 : 1;
        continue;
      }
      if (low === 'user' || low === 'user-group' || low === 'object-group-user' || low === 'security-group') {
        IR.pushUnsup(rule, 'user', low, line);
        i += 2; continue;
      }
      if (low === 'object-group' || low === 'object') {
        if (i + 1 < tokens.length) {
          rule.svcRefs = [tokens[i + 1]];
          i += 2; continue;
        }
        IR.pushUnsup(rule, 'option', low, line);
        i++; continue;
      }
      if (low === 'interval' || (/^\d+$/.test(low) && rule.log)) { i++; continue; }
      if (low === 'rule-id') {
        if (i + 1 < tokens.length) rule.id = String(tokens[i + 1]);
        i += 2; continue;
      }
      IR.pushUnsup(rule, 'option', tokens[i], line);
      i++;
    }
  }

  function protoToLit(tok, rule) {
    var line = rule.lines[0] || 0;
    var low = String(tok).toLowerCase();
    if (low === 'object-group' || low === 'object') return { og: true };
    var lp = IR.lookupProto(tok);
    if (lp.err === 'ipv6') { IR.pushUnsup(rule, 'ipv6', tok, line); return { proto: [0, 255] }; }
    if (lp.err) { IR.pushUnsup(rule, 'option', tok, line); return { proto: [0, 255] }; }
    return { proto: [lp.lo, lp.hi] };
  }

  function parseExtendedAce(tokens, start, rule, addrMode) {
    var i = start;
    if (i >= tokens.length) return;
    var protoTok = tokens[i];
    var lowp = String(protoTok).toLowerCase();
    var svcRefs = [];
    if (lowp === 'object-group' || lowp === 'object') {
      if (i + 1 < tokens.length) svcRefs.push(tokens[i + 1]);
      i += 2;
    } else {
      var pr = protoToLit(protoTok, rule);
      i++;
      var proto = pr.proto || [0, 255];
      var sport = [[0, 65535]], dport = [[0, 65535]];
      var icmpType, icmpCode;
      var sawDportOp = false;
      if (i < tokens.length && /^ifc$/i.test(tokens[i]) && i + 1 < tokens.length) {
        rule.srcIntf = [tokens[i + 1]];
        i += 2;
      }
      // src
      var src = parseAddr(tokens, i, addrMode, rule);
      if (!src) { IR.pushUnsup(rule, 'option', tokens[i] || 'src', rule.lines[0]); return; }
      rule.srcRefs = src.refs;
      i = src.next;
      // optional src ports (only tcp/udp/sctp)
      var isPorted = proto[0] === proto[1] && (proto[0] === 6 || proto[0] === 17 || proto[0] === 132);
      var isIcmp = proto[0] === 1 && proto[1] === 1;
      if (isPorted) {
        var sp = consumePorts(tokens, i, rule);
        sport = sp.intervals; i = sp.next;
      } else if (isIcmp && i < tokens.length && !parseAddr(tokens, i, addrMode, rule)) {
        // icmp type maybe before dst? IOS: icmp src dst [type [code]]
      }
      var dst = parseAddr(tokens, i, addrMode, rule);
      if (!dst) {
        // maybe icmp type was confused; try anyway
        IR.pushUnsup(rule, 'option', tokens[i] || 'dst', rule.lines[0]);
        return;
      }
      rule.dstRefs = dst.refs;
      i = dst.next;
      if (isPorted) {
        sawDportOp = i < tokens.length && /^(eq|neq|lt|gt|range)$/i.test(tokens[i]);
        var dp = consumePorts(tokens, i, rule);
        dport = dp.intervals; i = dp.next;
      } else if (isIcmp && i < tokens.length) {
        var maybe = String(tokens[i]).toLowerCase();
        if (maybe !== 'log' && maybe !== 'log-input' && maybe !== 'time-range' && maybe !== 'inactive') {
          var ic = IR.lookupIcmp(tokens[i]);
          if (!ic.err) {
            icmpType = ic.type; i++;
            if (i < tokens.length && /^\d+$/.test(tokens[i])) { icmpCode = Number(tokens[i]); i++; }
          } else if (!/^(log|established|time-range|dscp|fragments|inactive)$/i.test(tokens[i])) {
            var ic2 = IR.lookupIcmp(tokens[i]);
            if (ic2.err === 'name') { IR.pushUnsup(rule, 'option', tokens[i], rule.lines[0]); i++; }
          }
        }
      }
      if (isIcmp) {
        svcRefs.push({ lit: { proto: 1, icmpType: icmpType, icmpCode: icmpCode } });
      } else {
        svcRefs.push({ lit: { proto: proto, sport: sport, dport: dport } });
      }
    }
    if (svcRefs.length) rule.svcRefs = svcRefs;
    // If proto was object-group, still need src/dst
    if (lowp === 'object-group' || lowp === 'object') {
      var src2 = parseAddr(tokens, i, addrMode, rule);
      if (src2) { rule.srcRefs = src2.refs; i = src2.next; }
      var sp2 = consumePorts(tokens, i, rule);
      // only consume if it looked like a port op
      var maybeOp = i < tokens.length && /^(eq|neq|lt|gt|range)$/i.test(tokens[i]);
      if (maybeOp) i = sp2.next;
      var dst2 = parseAddr(tokens, i, addrMode, rule);
      if (dst2) { rule.dstRefs = dst2.refs; i = dst2.next; }
      if (i < tokens.length && /^(eq|neq|lt|gt|range)$/i.test(tokens[i])) {
        consumePorts(tokens, i, rule); // dport on OG proto ignored for exact svc (group defines it)
        i = consumePorts(tokens, i, rule).next;
      }
    }
    if (!sawDportOp) i = takePortGroup(tokens, i, rule);
    flagTrailing(tokens, i, rule, addrMode);
  }

  function parseStandardAce(tokens, start, rule, addrMode) {
    var src = parseAddr(tokens, start, addrMode, rule);
    if (!src) return;
    rule.srcRefs = src.refs;
    rule.dstRefs = [{ lit: { kind: 'any', value: 'any' } }];
    rule.svcRefs = [{ lit: { proto: [0, 255], sport: [[0, 65535]], dport: [[0, 65535]] } }];
    flagTrailing(tokens, src.next, rule, addrMode);
  }

  function flushIgnored(policy, map) {
    Object.keys(map).forEach(function (block) {
      IR.addWarning(policy, 'ignored_block', map[block].line, { block: block, count: map[block].count });
    });
  }

  var KNOWN_BLOCK = /^(interface|router|vlan|line|banner|crypto|policy-map|class-map|route-map|ip|ipv6|hostname|boot|aaa|snmp-server|ntp|logging|spanning-tree|vtp|monitor|switchport|asa|nameif|nat|object|access-group|mtu|name|dns|same-security-traffic|timeout|threat-detection|ssl|http|ssh|username|enable|passwd|domain-name|names|pager|terminal|mtu|icmp|arp|route)\b/i;

  function blockKey(line) {
    var t = line.trim();
    var m = KNOWN_BLOCK.exec(t);
    if (m) return m[1].toLowerCase();
    return null;
  }

  // ── IOS ─────────────────────────────────────────────────────────────
  function parseIos(text) {
    var policy = IR.emptyPolicy('ios');
    var lines = String(text || '').split(/\r?\n/);
    var i, line, raw;
    var ignored = Object.create(null);
    var mode = null; // { type:'acl'|'og-net'|'og-svc'|'ipv6-acl', name, kind, startLine }
    var pendingRemark = '';
    var consumed = [];

    function ignoreLine(idx, ln) {
      var k = blockKey(ln);
      if (!k) {
        IR.addWarning(policy, 'unparsed_line', idx + 1, { text: ln.trim() });
        return;
      }
      if (!ignored[k]) ignored[k] = { count: 0, line: idx + 1 };
      ignored[k].count++;
    }

    function startAcl(name, kind) {
      mode = { type: 'acl', name: name, kind: kind };
      IR.ensureScope(policy, 'acl:' + name, { kind: 'acl', label: name });
    }

    function addAce(lineNo, tokens, ext, addrMode, rawLine, seq) {
      var actionTok = tokens[0] && String(tokens[0]).toLowerCase();
      if (actionTok !== 'permit' && actionTok !== 'deny') {
        IR.addWarning(policy, 'unparsed_line', lineNo, { text: rawLine.trim() });
        return;
      }
      var order = IR.scopeOrderCount(policy, 'acl:' + mode.name);
      var id = seq != null ? String(seq) : ('L' + lineNo);
      var rule = IR.makeRule({
        id: id,
        name: id,
        scopeKey: 'acl:' + mode.name,
        order: order,
        lines: [lineNo],
        raw: rawLine.replace(/^\s+/, ''),
        comment: pendingRemark,
        action: actionTok,
        terminal: true
      });
      pendingRemark = '';
      if (ext) parseExtendedAce(tokens, 1, rule, addrMode);
      else parseStandardAce(tokens, 1, rule, addrMode);
      IR.pushRule(policy, rule);
    }

    for (i = 0; i < lines.length; i++) {
      raw = lines[i];
      line = raw.replace(/\r$/, '');
      var trimmed = line.trim();
      if (isComment(trimmed) || !trimmed) continue;

      // ipv6 ACL block
      if (/^ipv6 access-list\b/i.test(trimmed)) {
        var n6 = trimmed.replace(/^ipv6 access-list\s+/i, '').trim();
        mode = { type: 'ipv6-acl', name: n6 };
        IR.ensureScope(policy, 'acl:' + n6, { kind: 'acl', label: n6 });
        continue;
      }
      if (mode && mode.type === 'ipv6-acl') {
        if (/^\S/.test(line) && !/^(permit|deny|remark|sequence|\d+\s+(permit|deny))/i.test(trimmed)) {
          mode = null;
          // fall through
        } else {
          var order6 = IR.scopeOrderCount(policy, 'acl:' + mode.name);
          var rule6 = IR.makeRule({
            id: 'L' + (i + 1), scopeKey: 'acl:' + mode.name, order: order6,
            lines: [i + 1], raw: trimmed, action: /deny/i.test(trimmed) ? 'deny' : 'permit', terminal: true
          });
          IR.pushUnsup(rule6, 'ipv6', 'ipv6 access-list', i + 1);
          IR.pushRule(policy, rule6);
          continue;
        }
      }

      var m;
      if ((m = trimmed.match(/^ip access-list\s+(standard|extended)\s+(\S+)/i))) {
        startAcl(m[2], m[1].toLowerCase());
        continue;
      }
      if ((m = trimmed.match(/^ip access-list\s+(\S+)/i))) {
        // NX-OS named extended
        startAcl(m[1], 'extended');
        continue;
      }
      if ((m = trimmed.match(/^object-group\s+network\s+(\S+)/i))) {
        mode = { type: 'og-net', name: m[1], line: i + 1 };
        IR.addAddrObj(policy, { name: m[1], kind: 'group', members: [], exclude: [], line: i + 1 });
        continue;
      }
      if ((m = trimmed.match(/^object-group\s+service\s+(\S+)/i))) {
        mode = { type: 'og-svc', name: m[1], line: i + 1 };
        IR.addSvcObj(policy, { name: m[1], kind: 'group', members: [], atoms: [], line: i + 1 });
        continue;
      }
      if ((m = trimmed.match(/^access-list\s+(\d+)\s+(remark)\s+(.*)$/i))) {
        startAcl(m[1], stdAclNum(Number(m[1])) ? 'standard' : 'extended');
        pendingRemark = m[3];
        continue;
      }
      if ((m = trimmed.match(/^access-list\s+(\d+)\s+(permit|deny)\s+(.*)$/i))) {
        var num = Number(m[1]);
        startAcl(String(num), stdAclNum(num) ? 'standard' : 'extended');
        var rest = IR.tokenize(m[2] + ' ' + m[3]);
        addAce(i + 1, rest, extAclNum(num) || (!stdAclNum(num) && !extAclNum(num)), 'wildcard', trimmed, null);
        continue;
      }
      if ((m = trimmed.match(/^ip access-group\s+(\S+)\s+(in|out)\b/i))) {
        policy.bindings.push({ scopeKey: 'acl:' + m[1], text: trimmed, line: i + 1 });
        continue;
      }

      if (mode && mode.type === 'acl') {
        var indented = /^\s/.test(line);
        if (!indented && !/^(permit|deny|remark|\d+\s+)/i.test(trimmed)) {
          mode = null;
          // fall through to ignore
        } else {
          if (/^remark\s+/i.test(trimmed)) { pendingRemark = trimmed.replace(/^remark\s+/i, ''); continue; }
          var tok = IR.tokenize(trimmed);
          var seq = null;
          if (tok.length && /^\d+$/.test(tok[0])) { seq = Number(tok[0]); tok = tok.slice(1); }
          if (tok[0] && /^remark$/i.test(tok[0])) { pendingRemark = tok.slice(1).join(' '); continue; }
          addAce(i + 1, tok, mode.kind !== 'standard', 'wildcard', trimmed, seq);
          continue;
        }
      }

      if (mode && mode.type === 'og-net') {
        if (/^\S/.test(line) && !/^(host|range|group-object|description)\b/i.test(trimmed) && !IR.isIpv4Token(trimmed.split(/\s+/)[0])) {
          mode = null;
        } else {
          var og = policy.objects.addr[mode.name];
          var tks = IR.tokenize(trimmed);
          if (/^description\b/i.test(tks[0])) continue;
          if (/^host$/i.test(tks[0]) && tks[1]) og.members.push({ lit: { kind: 'host', value: tks[1] } });
          else if (/^range$/i.test(tks[0]) && tks[1] && tks[2]) og.members.push({ lit: { kind: 'range', value: tks[1] + '-' + tks[2] } });
          else if (/^group-object$/i.test(tks[0]) && tks[1]) og.members.push(tks[1]);
          else if (tks[0] && String(tks[0]).indexOf('/') >= 0) {
            var pc = IR.parseV4(tks[0]);
            if (pc && pc.contiguous) og.members.push({ lit: { kind: 'subnet', value: tks[0] } });
            else {
              IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
              og.unanalysable = true;
              og.unanalysableConstruct = 'unresolved';
            }
          } else if (IR.isIpv4Token(tks[0])) {
            var pv = IR.parseV4(tks.join(' '), { mode: 'mask' });
            if (pv && pv.contiguous) og.members.push({ lit: { kind: 'subnet', value: tks.join(' ') } });
            else if (pv && !pv.contiguous) og.members.push({ lit: { kind: 'wildcard', value: tks.join(' ') } });
            else {
              IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
              og.unanalysable = true;
              og.unanalysableConstruct = 'unresolved';
            }
          } else {
            IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
            og.unanalysable = true;
            og.unanalysableConstruct = 'unresolved';
          }
          continue;
        }
      }

      if (mode && mode.type === 'og-svc') {
        if (/^\S/.test(line) && !/^(tcp|udp|tcp-udp|icmp|group-object|description|ip)\b/i.test(trimmed) && IR.lookupProto(trimmed.split(/\s+/)[0]).err) {
          mode = null;
        } else {
          var svg = policy.objects.svc[mode.name];
          var st = IR.tokenize(trimmed);
          if (/^description\b/i.test(st[0])) continue;
          if (/^group-object$/i.test(st[0]) && st[1]) { svg.members.push(st[1]); continue; }
          parseOgServiceLine(st, svg, policy, i + 1);
          continue;
        }
      }

      if (mode) { mode = null; }
      ignoreLine(i, trimmed);
    }
    flushIgnored(policy, ignored);
    return policy;
  }

  function parseOgServiceLine(st, svg, policy, line) {
    var protoTok = st[0];
    var lp = IR.lookupProto(protoTok);
    if (/^tcp-udp$/i.test(protoTok)) {
      var rest = parseOgPortPart(st, 1, policy, line);
      if (rest.failed) { svg.unanalysable = true; svg.unanalysableConstruct = 'option'; return; }
      svg.atoms.push(IR.makeAtom(6, 6, rest.sport, rest.dport));
      svg.atoms.push(IR.makeAtom(17, 17, rest.sport, rest.dport));
      return;
    }
    if (lp.err === 'ipv6') { svg.unanalysable = true; svg.unanalysableConstruct = 'ipv6'; return; }
    if (lp.err) {
      IR.addWarning(policy, 'unparsed_line', line, { text: st.join(' ') });
      svg.unanalysable = true;
      svg.unanalysableConstruct = 'option';
      return;
    }
    if (lp.lo === 1) {
      var typ;
      if (st[1]) {
        var ic = IR.lookupIcmp(st[1]);
        if (!ic.err) typ = ic.type;
        else {
          IR.addWarning(policy, 'unparsed_line', line, { text: st.join(' ') });
          svg.unanalysable = true;
          svg.unanalysableConstruct = 'option';
        }
      }
      if (!svg.unanalysable) svg.atoms.push(IR.icmpAtom(typ, null));
      return;
    }
    var ports = parseOgPortPart(st, 1, policy, line);
    if (ports.failed) { svg.unanalysable = true; svg.unanalysableConstruct = 'option'; return; }
    svg.atoms.push(IR.makeAtom(lp.lo, lp.hi, ports.sport, ports.dport));
  }

  function parseOgPortPart(st, i, policy, line) {
    var sport = [[0, 65535]], dport = [[0, 65535]];
    var dummy = IR.makeRule({ lines: [line], unsupported: [] });
    if (i < st.length && /^source$/i.test(st[i])) {
      var sp = consumePorts(st, i + 1, dummy);
      sport = sp.intervals; i = sp.next;
    }
    if (i < st.length) {
      var dp = consumePorts(st, i, dummy);
      if (i < st.length && /^(eq|neq|lt|gt|range)$/i.test(st[i])) {
        dport = dp.intervals;
      }
    }
    return { sport: sport, dport: dport, failed: !!(dummy.unsupported && dummy.unsupported.length) };
  }

  function detectIos(text) {
    var score = 0;
    if (/^ip access-list\s+(standard|extended)\s+/im.test(text)) score += 50;
    if (/^ip access-list\s+\S+/im.test(text)) score += 30;
    if (/^access-list\s+\d+\s+(permit|deny)\b/im.test(text)) score += 40;
    if (/^object-group\s+(network|service)\s+/im.test(text) && !/network-object|service-object|port-object/i.test(text)) score += 20;
    if (/wildcard/i.test(text)) score += 5;
    if (/^access-list\s+\S+\s+extended\s+/im.test(text)) score -= 40;
    if (/^object network\s+/im.test(text)) score -= 30;
    if (/^config\s+firewall\b/im.test(text)) score -= 50;
    if (/^\*filter\b/m.test(text) || /^-A\s+\S+/m.test(text)) score -= 40;
    if (/^set\s+security\s+policies\b/im.test(text) || /from-zone\s+\S+\s+to-zone/i.test(text)) score -= 40;
    if (/^ASA\s+Version/im.test(text) || /\bnameif\s+/.test(text)) score -= 40;
    return Math.max(0, Math.min(100, score));
  }

  var IOS_SAMPLE = [
    'object-group network WEB-SRC',
    ' 10.0.0.0 255.255.0.0',
    'ip access-list extended SAMPLE',
    ' 10 permit tcp 10.0.0.0 0.0.255.255 any eq 443',
    ' 20 permit tcp 10.0.1.0 0.0.0.255 host 192.0.2.10 eq 443',
    ' 30 permit tcp 10.0.0.0 0.0.255.255 any eq 443',
    ' 40 deny ip 10.0.0.0 0.255.255.255 any',
    ' 50 permit tcp 10.1.1.0 0.0.0.255 any eq 22',
    ' 60 permit tcp any any established'
  ].join('\n');

  // ── ASA ─────────────────────────────────────────────────────────────
  function parseAsa(text, opts) {
    opts = opts || {};
    var flavor = opts.flavor === 'ftd' ? 'ftd' : 'asa';
    var policy = IR.emptyPolicy(flavor);
    var lines = String(text || '').split(/\r?\n/);
    var ignored = Object.create(null);
    var objMode = null; // { type:'net'|'svc'|'og-net'|'og-svc'|'og-proto'|'og-icmp', name }
    var pendingRemark = {};
    var pendingByRuleId = Object.create(null);

    function ignoreLine(idx, ln) {
      var k = blockKey(ln);
      if (!k) {
        IR.addWarning(policy, 'unparsed_line', idx + 1, { text: ln.trim() });
        return;
      }
      if (!ignored[k]) ignored[k] = { count: 0, line: idx + 1 };
      ignored[k].count++;
    }

    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].replace(/\r$/, '').trim();
      if (isComment(trimmed) || !trimmed) continue;
      var m;

      if ((m = trimmed.match(/^object network\s+(\S+)/i))) {
        objMode = { type: 'net', name: m[1], line: i + 1 };
        IR.addAddrObj(policy, { name: m[1], kind: 'host', value: null, members: [], line: i + 1 });
        continue;
      }
      if ((m = trimmed.match(/^object service\s+(\S+)/i))) {
        objMode = { type: 'svc', name: m[1], line: i + 1 };
        IR.addSvcObj(policy, { name: m[1], kind: 'atom', atoms: [], members: [], line: i + 1 });
        continue;
      }
      if ((m = trimmed.match(/^object-group network\s+(\S+)/i))) {
        objMode = { type: 'og-net', name: m[1], line: i + 1 };
        IR.addAddrObj(policy, { name: m[1], kind: 'group', members: [], exclude: [], line: i + 1 });
        continue;
      }
      if ((m = trimmed.match(/^object-group service\s+(\S+)(?:\s+(\S+))?/i))) {
        objMode = { type: 'og-svc', name: m[1], proto: m[2], line: i + 1 };
        IR.addSvcObj(policy, { name: m[1], kind: 'group', atoms: [], members: [], line: i + 1 });
        continue;
      }
      if ((m = trimmed.match(/^object-group protocol\s+(\S+)/i))) {
        objMode = { type: 'og-proto', name: m[1], line: i + 1 };
        IR.addSvcObj(policy, { name: m[1], kind: 'group', atoms: [], members: [], line: i + 1 });
        continue;
      }
      if ((m = trimmed.match(/^object-group icmp-type\s+(\S+)/i))) {
        objMode = { type: 'og-icmp', name: m[1], line: i + 1 };
        IR.addSvcObj(policy, { name: m[1], kind: 'group', atoms: [], members: [], line: i + 1 });
        continue;
      }
      if (/^object-group user\b/i.test(trimmed) || /^object-group security\b/i.test(trimmed)) {
        objMode = { type: 'skip-user', name: trimmed };
        continue;
      }

      if (objMode) {
        var cont = /^\s/.test(lines[i]) || /^(host|subnet|range|fqdn|nat|service|network-object|group-object|port-object|service-object|protocol-object|icmp-object|description)\b/i.test(trimmed);
        if (!cont && !/^access-list\b/i.test(trimmed) && !/^object/i.test(trimmed) && !/^access-group\b/i.test(trimmed)) {
          // still inside if ASA object body is indented; unindented host/subnet still valid
          if (/^(host|subnet|range|fqdn|service|network-object|group-object|port-object|service-object|protocol-object|icmp-object)\b/i.test(trimmed)) cont = true;
        }
        if (cont && objMode.type === 'net') {
          var obj = policy.objects.addr[objMode.name];
          if (/^host\s+/i.test(trimmed)) {
            obj.kind = 'host'; obj.value = trimmed.split(/\s+/)[1];
          } else if (/^subnet\s+/i.test(trimmed)) {
            obj.kind = 'subnet'; obj.value = trimmed.replace(/^subnet\s+/i, '');
          } else if (/^range\s+/i.test(trimmed)) {
            var rp = trimmed.replace(/^range\s+/i, '').trim().split(/\s+/);
            obj.kind = 'range'; obj.value = rp[0] + '-' + rp[1];
          } else if (/^fqdn\b/i.test(trimmed)) {
            obj.kind = 'fqdn';
            obj.value = trimmed.replace(/^fqdn\s+(?:v4|v6)\s+/i, '').replace(/^fqdn\s+/i, '').trim();
          } else if (/^nat\b/i.test(trimmed)) {
            /* ignore */
          } else {
            IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
          }
          continue;
        }
        if (cont && objMode.type === 'svc') {
          var so = policy.objects.svc[objMode.name];
          if (/^service\s+/i.test(trimmed)) parseAsaService(trimmed.replace(/^service\s+/i, ''), so, i + 1);
          else if (!/^description\b/i.test(trimmed)) IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
          continue;
        }
        if (cont && objMode.type === 'og-net') {
          var og = policy.objects.addr[objMode.name];
          if (/^network-object\s+host\s+(\S+)/i.test(trimmed)) {
            og.members.push({ lit: { kind: 'host', value: RegExp.$1 } });
          } else if (/^network-object\s+object\s+(\S+)/i.test(trimmed)) {
            og.members.push(RegExp.$1);
          } else if (/^network-object\s+(\S+)\s+(\S+)/i.test(trimmed)) {
            og.members.push({ lit: { kind: 'subnet', value: RegExp.$1 + ' ' + RegExp.$2 } });
          } else if (/^group-object\s+(\S+)/i.test(trimmed)) {
            og.members.push(RegExp.$1);
          } else if (!/^description\b/i.test(trimmed)) {
            IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
            og.unanalysable = true;
            og.unanalysableConstruct = 'unresolved';
          }
          continue;
        }
        if (cont && objMode.type === 'og-svc') {
          var svg = policy.objects.svc[objMode.name];
          if (/^group-object\s+(\S+)/i.test(trimmed)) svg.members.push(RegExp.$1);
          else if (/^service-object\s+object\s+(\S+)/i.test(trimmed)) svg.members.push(RegExp.$1);
          else if (/^service-object\s+/i.test(trimmed)) parseAsaService(trimmed.replace(/^service-object\s+/i, ''), svg, i + 1);
          else if (/^port-object\s+/i.test(trimmed)) {
            var dummy = IR.makeRule({ lines: [i + 1], unsupported: [] });
            var pt = IR.tokenize(trimmed.replace(/^port-object\s+/i, ''));
            var pr = objMode.proto ? String(objMode.proto).toLowerCase() : 'tcp';
            var iv = [[0, 65535]];
            if (pt[0]) {
              var cp = consumePorts(['x'].concat(pt), 1, dummy);
              iv = cp.intervals;
            }
            if (dummy.unsupported && dummy.unsupported.length) {
              svg.unanalysable = true;
              svg.unanalysableConstruct = 'option';
            } else {
              function addProto(p) { svg.atoms.push(IR.makeAtom(p, p, [[0, 65535]], iv)); }
              if (pr === 'tcp-udp') { addProto(6); addProto(17); }
              else if (pr === 'udp') addProto(17);
              else addProto(6);
            }
          } else if (!/^description\b/i.test(trimmed)) {
            IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
            svg.unanalysable = true;
            svg.unanalysableConstruct = 'option';
          }
          continue;
        }
        if (cont && objMode.type === 'og-proto') {
          var pg = policy.objects.svc[objMode.name];
          if (/^protocol-object\s+(\S+)/i.test(trimmed)) {
            var lp = IR.lookupProto(RegExp.$1);
            if (!lp.err && lp.err !== 'ipv6') pg.atoms.push(IR.makeAtom(lp.lo, lp.hi, [[0, 65535]], [[0, 65535]]));
            else {
              IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
              pg.unanalysable = true;
              pg.unanalysableConstruct = 'option';
            }
          } else if (/^group-object\s+(\S+)/i.test(trimmed)) pg.members.push(RegExp.$1);
          else if (!/^description\b/i.test(trimmed)) {
            IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
            pg.unanalysable = true;
            pg.unanalysableConstruct = 'option';
          }
          continue;
        }
        if (cont && objMode.type === 'og-icmp') {
          var ig = policy.objects.svc[objMode.name];
          if (/^icmp-object\s+(\S+)/i.test(trimmed)) {
            var ic = IR.lookupIcmp(RegExp.$1);
            if (!ic.err) ig.atoms.push(IR.icmpAtom(ic.type, null));
            else {
              IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
              ig.unanalysable = true;
              ig.unanalysableConstruct = 'option';
            }
          } else if (/^group-object\s+(\S+)/i.test(trimmed)) ig.members.push(RegExp.$1);
          else if (!/^description\b/i.test(trimmed)) {
            IR.addWarning(policy, 'unparsed_line', i + 1, { text: trimmed });
            ig.unanalysable = true;
            ig.unanalysableConstruct = 'option';
          }
          continue;
        }
        if (cont && objMode.type === 'skip-user') continue;
        objMode = null;
      }

      if ((m = trimmed.match(/^access-list\s+(\S+)\s+remark\s+(.*)$/i))) {
        pendingRemark[m[1]] = m[2];
        var ridm = m[2].match(/^rule-id\s+(\d+)\s*:\s*(?:L7\s+RULE:\s*(.+)|RULE:\s*(.+)|ACCESS POLICY:\s*(.+))$/i);
        if (ridm) {
          var rname = (ridm[2] || ridm[3] || '').trim();
          if (ridm[4] && /[-–]\s*(Mandatory|Default)\s*$/i.test(ridm[4])) {
            rname = rname || ridm[4].trim();
          }
          if (rname) pendingByRuleId[ridm[1]] = rname;
        }
        IR.ensureScope(policy, 'acl:' + m[1], { kind: 'acl', label: m[1] });
        continue;
      }
      if ((m = trimmed.match(/^access-list\s+(\S+)\s+(?:line\s+(\d+)\s+)?(extended|advanced)\s+(permit|deny|trust)\s+(.*)$/i))) {
        var name = m[1], aceLine = m[2] ? Number(m[2]) : null, actRaw = m[4].toLowerCase(), rest = m[5];
        var act = actRaw === 'trust' ? 'permit' : actRaw;
        IR.ensureScope(policy, 'acl:' + name, { kind: 'acl', label: name });
        var order = aceLine != null ? aceLine : IR.scopeOrderCount(policy, 'acl:' + name);
        var rule = IR.makeRule({
          id: 'L' + (i + 1), name: 'L' + (i + 1), scopeKey: 'acl:' + name, order: order,
          lines: [i + 1], raw: trimmed, comment: pendingRemark[name] || '', action: act, terminal: true
        });
        pendingRemark[name] = '';
        if (actRaw === 'trust') {
          rule.dropped.push({ construct: 'ftd_trust', detail: 'trust', line: i + 1 });
        }
        parseExtendedAce(IR.tokenize(rest), 0, rule, 'mask');
        if (rule.id && pendingByRuleId[rule.id]) rule.name = pendingByRuleId[rule.id];
        IR.pushRule(policy, rule);
        continue;
      }
      if ((m = trimmed.match(/^access-list\s+(\S+)\s+standard\s+(permit|deny)\s+(.*)$/i))) {
        var n2 = m[1];
        IR.ensureScope(policy, 'acl:' + n2, { kind: 'acl', label: n2 });
        var order2 = IR.scopeOrderCount(policy, 'acl:' + n2);
        var rule2 = IR.makeRule({
          id: 'L' + (i + 1), scopeKey: 'acl:' + n2, order: order2,
          lines: [i + 1], raw: trimmed, action: m[2].toLowerCase(), terminal: true
        });
        parseStandardAce(IR.tokenize(m[3]), 0, rule2, 'mask');
        IR.pushRule(policy, rule2);
        continue;
      }
      if ((m = trimmed.match(/^access-group\s+(\S+)\s+(in|out)\s+interface\s+(\S+)/i))) {
        policy.bindings.push({
          scopeKey: 'acl:' + m[1], acl: m[1], dir: m[2].toLowerCase(), iface: m[3],
          text: trimmed, line: i + 1
        });
        continue;
      }
      if ((m = trimmed.match(/^access-group\s+(\S+)\s+global\b/i))) {
        policy.bindings.push({
          scopeKey: 'acl:' + m[1], acl: m[1], dir: 'global', iface: '',
          text: trimmed, line: i + 1
        });
        continue;
      }
      ignoreLine(i, trimmed);
    }
    flushIgnored(policy, ignored);
    return policy;
  }

  function parseAsaService(rest, svg, line) {
    var st = IR.tokenize(rest);
    var dummy = IR.makeRule({ lines: [line], unsupported: [] });
    if (!st.length) return;
    var p = IR.lookupProto(st[0]);
    var i = 1;
    var sport = [[0, 65535]], dport = [[0, 65535]];
    if (st[0] && /^icmp$/i.test(st[0])) {
      var typ;
      if (st[1]) {
        var ic = IR.lookupIcmp(st[1]);
        if (!ic.err) typ = ic.type;
        else {
          svg.unanalysable = true;
          svg.unanalysableConstruct = 'option';
          return;
        }
      }
      svg.atoms.push(IR.icmpAtom(typ, null));
      return;
    }
    while (i < st.length) {
      if (/^source$/i.test(st[i])) {
        var sp = consumePorts(st, i + 1, dummy);
        sport = sp.intervals; i = sp.next;
      } else if (/^destination$/i.test(st[i])) {
        var dp = consumePorts(st, i + 1, dummy);
        dport = dp.intervals; i = dp.next;
      } else if (/^(eq|neq|lt|gt|range)$/i.test(st[i])) {
        var dp2 = consumePorts(st, i, dummy);
        dport = dp2.intervals; i = dp2.next;
      } else {
        dummy.unsupported.push({ construct: 'option', detail: st[i], line: line });
        i++;
      }
    }
    if (p.err || (dummy.unsupported && dummy.unsupported.length)) {
      svg.unanalysable = true;
      svg.unanalysableConstruct = 'option';
      return;
    }
    svg.atoms.push(IR.makeAtom(p.lo, p.hi, sport, dport));
  }

  function detectAsa(text) {
    var score = 0;
    if (/^access-list\s+\S+\s+extended\s+(permit|deny)/im.test(text)) score += 55;
    if (/^object network\s+/im.test(text)) score += 30;
    if (/^object-group network\s+/im.test(text) && /network-object/i.test(text)) score += 25;
    if (/^ASA\s+Version/im.test(text)) score += 20;
    if (/^access-group\s+\S+\s+(in|out)\s+interface/im.test(text)) score += 15;
    if (/^ip access-list\s+/im.test(text)) score -= 30;
    if (/^config\s+firewall\b/im.test(text)) score -= 50;
    if (/^\*filter\b/m.test(text)) score -= 40;
    if (/^set\s+security\s+policies\b/im.test(text)) score -= 40;
    return Math.max(0, Math.min(100, score));
  }

  var ASA_SAMPLE = [
    'access-list OUT extended permit tcp 10.0.0.0 255.255.0.0 any eq 443',
    'access-list OUT extended permit tcp 10.0.1.0 255.255.255.0 host 192.0.2.10 eq 443',
    'access-list OUT extended permit tcp 10.0.0.0 255.255.0.0 any eq 443',
    'access-list OUT extended deny ip 10.0.0.0 255.0.0.0 any',
    'access-list OUT extended permit tcp 10.1.1.0 255.255.255.0 any eq 22',
    'access-list OUT extended permit tcp any any eq www time-range BUSINESS'
  ].join('\n');

  var ios = { vendor: 'ios', detect: detectIos, parse: parseIos, sample: IOS_SAMPLE };
  var asa = {
    vendor: 'asa',
    detect: detectAsa,
    parse: function (text) { return parseAsa(text); },
    parseWith: parseAsa,
    sample: ASA_SAMPLE
  };

  root.FwParsers = root.FwParsers || {};
  root.FwParsers.ios = ios;
  root.FwParsers.asa = asa;
  if (typeof module !== 'undefined' && module.exports) module.exports = { ios: ios, asa: asa };
})(typeof window !== 'undefined' ? window : globalThis);
