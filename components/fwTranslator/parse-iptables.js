/* ──────────────────────────────────────────────────────────────────────
 * parse-iptables.js — iptables / iptables-save
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var IR = (typeof module !== 'undefined' && module.exports) ? require('./fwIR.js') : root.FwIR;

  function parsePortsList(s, rule, line) {
    var ivs = [];
    String(s).split(',').forEach(function (part) {
      part = part.trim();
      if (!part) return;
      function one(tok, fallback) {
        if (tok == null || tok === '') return { port: fallback };
        if (/^\d+$/.test(tok)) {
          var n = Number(tok);
          if (n < 0 || n > 65535) return { err: true };
          return { port: n };
        }
        return IR.lookupPort(tok);
      }
      var colon = part.indexOf(':');
      if (colon >= 0) {
        var left = part.slice(0, colon);
        var right = part.slice(colon + 1);
        var la = one(left, 0);
        var lb = one(right, 65535);
        if (la.err || lb.err) { IR.pushUnsup(rule, 'option', part, line); return; }
        ivs.push([Math.min(la.port, lb.port), Math.max(la.port, lb.port)]);
        return;
      }
      var lp = IR.lookupPort(part);
      if (lp.err) { IR.pushUnsup(rule, 'option', part, line); return; }
      ivs.push([lp.port, lp.port]);
    });
    return ivs.length ? IR.mergeIntervals(ivs) : [[0, 65535]];
  }

  function parseAddrArg(val, rule, line) {
    var refs = [];
    String(val).split(',').forEach(function (p) {
      p = p.trim();
      if (!p) return;
      if (IR.looksLikeIpv6(p) || (p.indexOf(':') >= 0 && p.indexOf('.') < 0)) {
        IR.pushUnsup(rule, 'ipv6', p, line);
        return;
      }
      if (p === '0.0.0.0/0' || p === 'anywhere' || p === 'anywhere/0') {
        refs.push({ lit: { kind: 'any', value: 'any4' } });
        return;
      }
      var parsed = IR.parseV4(p);
      if (!parsed) { IR.pushUnsup(rule, 'option', p, line); return; }
      if (parsed.kind === 'host') refs.push({ lit: { kind: 'host', value: p } });
      else if (parsed.kind === 'range') refs.push({ lit: { kind: 'range', value: p } });
      else refs.push({ lit: { kind: 'subnet', value: p } });
    });
    return refs;
  }

  function parseRuleSpec(args, rule, line) {
    var sport = null, dport = null;
    var proto = [0, 255];
    var icmpType, icmpCode;
    var i = 0;
    while (i < args.length) {
      var a = args[i];
      var next = args[i + 1];
      if (a === '!' ) {
        IR.pushUnsup(rule, 'negate', args[i + 1] || '!', line);
        i += 1;
        continue;
      }
      if (a === '-s' || a === '--source' || a === '--src') {
        rule.srcRefs = (rule.srcRefs || []).concat(parseAddrArg(next, rule, line));
        i += 2; continue;
      }
      if (a === '-d' || a === '--destination' || a === '--dst') {
        rule.dstRefs = (rule.dstRefs || []).concat(parseAddrArg(next, rule, line));
        i += 2; continue;
      }
      if (a === '-p' || a === '--protocol') {
        var lp = IR.lookupProto(next);
        if (lp.err === 'ipv6') IR.pushUnsup(rule, 'ipv6', next, line);
        else if (lp.err) IR.pushUnsup(rule, 'option', next, line);
        else proto = [lp.lo, lp.hi];
        i += 2; continue;
      }
      if (a === '--sport' || a === '--source-port') {
        sport = parsePortsList(next, rule, line); i += 2; continue;
      }
      if (a === '--dport' || a === '--destination-port') {
        dport = parsePortsList(next, rule, line); i += 2; continue;
      }
      if (a === '-m' || a === '--match') {
        var mod = String(next || '').toLowerCase();
        i += 2;
        if (mod === 'tcp' || mod === 'udp' || mod === 'icmp' || mod === 'comment' || mod === 'iprange' || mod === 'multiport') {
          continue;
        }
        if (mod === 'state' || mod === 'conntrack') {
          IR.pushUnsup(rule, 'state', mod, line);
          continue;
        }
        if (mod === 'set') {
          IR.pushUnsup(rule, 'module', 'set', line);
          continue;
        }
        IR.pushUnsup(rule, 'module', mod, line);
        continue;
      }
      if (a === '--comment') { rule.comment = next || ''; i += 2; continue; }
      if (a === '--src-range') {
        rule.srcRefs = (rule.srcRefs || []).concat([{ lit: { kind: 'range', value: next } }]);
        i += 2; continue;
      }
      if (a === '--dst-range') {
        rule.dstRefs = (rule.dstRefs || []).concat([{ lit: { kind: 'range', value: next } }]);
        i += 2; continue;
      }
      if (a === '--sports') { sport = parsePortsList(next, rule, line); i += 2; continue; }
      if (a === '--dports') { dport = parsePortsList(next, rule, line); i += 2; continue; }
      if (a === '--ports') { IR.pushUnsup(rule, 'port_either', next, line); i += 2; continue; }
      if (a === '--icmp-type') {
        var ic = String(next || '');
        if (ic.indexOf('/') >= 0) {
          var tc = ic.split('/');
          var it = IR.lookupIcmp(tc[0]);
          icmpType = it.err ? null : it.type;
          icmpCode = Number(tc[1]);
          if (it.err) IR.pushUnsup(rule, 'option', ic, line);
        } else {
          var it2 = IR.lookupIcmp(ic);
          if (it2.err) IR.pushUnsup(rule, 'option', ic, line);
          else icmpType = it2.type;
        }
        i += 2; continue;
      }
      if (a === '-i' || a === '--in-interface') {
        if (String(next).slice(-1) === '+') IR.pushUnsup(rule, 'option', next, line);
        else rule.srcIntf = [next];
        i += 2; continue;
      }
      if (a === '-o' || a === '--out-interface') {
        if (String(next).slice(-1) === '+') IR.pushUnsup(rule, 'option', next, line);
        else rule.dstIntf = [next];
        i += 2; continue;
      }
      if (a === '-j' || a === '--jump' || a === '-g' || a === '--goto') {
        var tgt = String(next || '').toUpperCase();
        if (tgt === 'ACCEPT') { rule.action = 'permit'; rule.terminal = true; }
        else if (tgt === 'DROP') { rule.action = 'deny'; rule.terminal = true; }
        else if (tgt === 'REJECT') { rule.action = 'reject'; rule.terminal = true; }
        else if (tgt === 'LOG' || tgt === 'NFLOG') { rule.action = 'none'; rule.terminal = false; rule.log = true; }
        else if (tgt === 'RETURN') { rule.action = 'none'; rule.terminal = false; }
        else {
          rule.action = 'none'; rule.terminal = false;
          IR.pushUnsup(rule, 'jump', next, line);
        }
        i += 2; continue;
      }
      if (a === '--reject-with') { i += 2; continue; }
      if (a === '--tcp-flags' || a === '--syn') {
        IR.pushUnsup(rule, 'tcp_flags', a, line);
        i += (a === '--tcp-flags' ? 3 : 1);
        continue;
      }
      if (a === '-f' || a === '--fragment') { IR.pushUnsup(rule, 'option', 'fragment', line); i++; continue; }
      if (a === '-c' || a === '--set-counters') { i += 3; continue; }
      if (a.indexOf('--ctstate') === 0 || a.indexOf('--state') === 0) {
        IR.pushUnsup(rule, 'state', a, line);
        i += (next && next.indexOf('-') !== 0) ? 2 : 1;
        continue;
      }
      if (a === '--match-set') { IR.pushUnsup(rule, 'module', 'set', line); i += 3; continue; }
      if (a === '-4' || a === '-v' || a === '-n' || a === '-w' || a === '--wait' || a === '--numeric') { i++; continue; }
      if (a === '-6') { IR.pushUnsup(rule, 'ipv6', a, line); i++; continue; }
      IR.pushUnsup(rule, 'option', a, line);
      i += (next && String(next).charAt(0) !== '-') ? 2 : 1;
    }
    if (!rule.srcRefs || !rule.srcRefs.length) rule.srcRefs = [{ lit: { kind: 'any', value: 'any4' } }];
    if (!rule.dstRefs || !rule.dstRefs.length) rule.dstRefs = [{ lit: { kind: 'any', value: 'any4' } }];
    if (proto[0] === 1 && proto[1] === 1) {
      rule.svcRefs = [{ lit: { proto: 1, icmpType: icmpType, icmpCode: isFinite(icmpCode) ? icmpCode : undefined } }];
    } else {
      rule.svcRefs = [{ lit: { proto: proto, sport: sport || [[0, 65535]], dport: dport || [[0, 65535]] } }];
    }
  }

  function tokenizeArgs(s) {
    var tokens = [];
    var re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    var m;
    while ((m = re.exec(s))) tokens.push(m[1] !== undefined ? m[1] : (m[2] !== undefined ? m[2] : m[3]));
    return tokens;
  }

  function parseIptables(text) {
    var policy = IR.emptyPolicy('iptables');
    var lines = String(text || '').split(/\r?\n/);
    var table = 'filter';
    var chains = Object.create(null); // key -> { policy, rules: [] }
    var ignored = Object.create(null);

    function chainKey(table, name) { return 'chain:' + table + ':' + name; }
    function ensureChain(table, name) {
      var k = chainKey(table, name);
      if (!chains[k]) {
        chains[k] = { table: table, name: name, rules: [] };
        IR.ensureScope(policy, k, { kind: 'chain', label: table + '/' + name });
      }
      return chains[k];
    }

    function addRule(table, chain, pos, specTokens, raw, line, ipv6) {
      var ch = ensureChain(table, chain);
      var rule = IR.makeRule({
        id: '',
        scopeKey: chainKey(table, chain),
        order: 0,
        lines: [line],
        raw: raw,
        action: 'none',
        terminal: false
      });
      if (ipv6) IR.pushUnsup(rule, 'ipv6', 'ip6tables', line);
      parseRuleSpec(specTokens, rule, line);
      if (ch.mutated) IR.pushUnsup(rule, 'option', 'chain-mutated', line);
      if (pos == null || pos > ch.rules.length) ch.rules.push(rule);
      else ch.rules.splice(Math.max(0, pos - 1), 0, rule);
    }

    function mutateChain(table, name, line, raw) {
      var ch = chains[chainKey(table, name)];
      if (!ch || !ch.rules.length) return;
      ch.mutated = true;
      for (var mi = 0; mi < ch.rules.length; mi++) {
        IR.pushUnsup(ch.rules[mi], 'option', raw, line);
      }
    }

    function mutateTable(table, line, raw) {
      Object.keys(chains).forEach(function (k) {
        if (chains[k].table === table) mutateChain(table, chains[k].name, line, raw);
      });
    }

    for (var i = 0; i < lines.length; i++) {
      var raw = lines[i].replace(/\r$/, '');
      var trimmed = raw.trim();
      if (!trimmed || trimmed.charAt(0) === '#') continue;
      var lineNo = i + 1;
      var m;

      if (trimmed.charAt(0) === '*' ) {
        table = trimmed.slice(1).trim() || 'filter';
        continue;
      }
      if (trimmed === 'COMMIT') continue;
      if ((m = trimmed.match(/^:(\S+)\s+(\S+)/))) {
        ensureChain(table, m[1]);
        continue;
      }
      if ((m = trimmed.match(/^-P\s+(\S+)\s+(\S+)/)) || (m = trimmed.match(/^iptables(?:\s+-t\s+\S+)?\s+-P\s+(\S+)\s+(\S+)/))) {
        IR.addWarning(policy, 'default_policy_ignored', lineNo, { text: trimmed });
        continue;
      }
      var ipv6 = false;
      var work = trimmed;
      if (/^ip6tables\b/.test(work)) { ipv6 = true; work = work.replace(/^ip6tables\s+/, ''); }
      else if (/^iptables\b/.test(work)) work = work.replace(/^iptables\s+/, '');

      var curTable = table;
      var tm = work.match(/^-t\s+(\S+)\s+/);
      if (tm) { curTable = tm[1]; work = work.slice(tm[0].length); }

      if (/^-[NXFZDR]\b/.test(work)) {
        IR.addWarning(policy, 'unparsed_line', lineNo, { text: trimmed });
        if ((m = work.match(/^-F(?:\s+(\S+))?/))) {
          if (m[1]) mutateChain(curTable, m[1], lineNo, trimmed);
          else mutateTable(curTable, lineNo, trimmed);
        } else if ((m = work.match(/^-X\s+(\S+)/))) {
          mutateChain(curTable, m[1], lineNo, trimmed);
        } else if ((m = work.match(/^-D\s+(\S+)/))) {
          mutateChain(curTable, m[1], lineNo, trimmed);
        } else if ((m = work.match(/^-R\s+(\S+)/))) {
          mutateChain(curTable, m[1], lineNo, trimmed);
        }
        continue;
      }

      if ((m = work.match(/^-A\s+(\S+)\s*(.*)$/))) {
        addRule(curTable, m[1], null, tokenizeArgs(m[2] || ''), trimmed, lineNo, ipv6);
        continue;
      }
      if ((m = work.match(/^-I\s+(\S+)(?:\s+(\d+))?\s*(.*)$/))) {
        var pos = m[2] ? Number(m[2]) : 1;
        addRule(curTable, m[1], pos, tokenizeArgs(m[3] || ''), trimmed, lineNo, ipv6);
        continue;
      }
      if (/^-A\s+/.test(work) || /^-I\s+/.test(work)) {
        continue;
      }
      IR.addWarning(policy, 'unparsed_line', lineNo, { text: trimmed });
    }

    Object.keys(chains).forEach(function (k) {
      var ch = chains[k];
      for (var r = 0; r < ch.rules.length; r++) {
        var rule = ch.rules[r];
        rule.order = r;
        rule.id = ch.name + '#' + (r + 1);
        rule.name = rule.id;
        rule.uid = k + '#' + r;
        IR.pushRule(policy, rule);
      }
    });
    return policy;
  }

  function detect(text) {
    var score = 0;
    if (/^\*filter\b/m.test(text) || /^\*nat\b/m.test(text)) score += 50;
    if (/^:INPUT\s+/m.test(text) || /^:FORWARD\s+/m.test(text)) score += 25;
    if (/^-A\s+(INPUT|FORWARD|OUTPUT)\b/m.test(text)) score += 35;
    if (/^COMMIT\b/m.test(text)) score += 20;
    if (/^iptables\s+-[AI]/m.test(text)) score += 40;
    if (/^ip6tables\b/m.test(text)) score += 20;
    if (/^config\s+firewall\b/im.test(text)) score -= 50;
    if (/^ip access-list\b/im.test(text) || /^access-list\s+/im.test(text)) score -= 30;
    if (/^set\s+security\s+policies\b/im.test(text)) score -= 40;
    return Math.max(0, Math.min(100, score));
  }

  var SAMPLE = [
    '*filter',
    ':INPUT ACCEPT [0:0]',
    ':FORWARD ACCEPT [0:0]',
    ':OUTPUT ACCEPT [0:0]',
    '-A INPUT -s 10.0.0.0/16 -p tcp --dport 443 -j ACCEPT',
    '-A INPUT -s 10.0.1.0/24 -d 192.0.2.10 -p tcp --dport 443 -j ACCEPT',
    '-A INPUT -s 10.0.0.0/16 -p tcp --dport 443 -j ACCEPT',
    '-A INPUT -s 10.0.0.0/8 -j DROP',
    '-A INPUT -s 10.1.1.0/24 -p tcp --dport 22 -j ACCEPT',
    '-A INPUT -s 192.0.2.0/24 -p tcp --dport 80 -m conntrack --ctstate NEW -j ACCEPT',
    'COMMIT'
  ].join('\n');

  var api = { vendor: 'iptables', detect: detect, parse: parseIptables, sample: SAMPLE };
  root.FwParsers = root.FwParsers || {};
  root.FwParsers.iptables = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
