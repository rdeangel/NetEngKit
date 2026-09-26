/* ──────────────────────────────────────────────────────────────────────
 * parse-fortios.js — FortiOS firewall address / addrgrp / service / policy
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var IR = (typeof module !== 'undefined' && module.exports) ? require('./fwIR.js') : root.FwIR;

  var POLICY_KEYS = {
    srcintf: 1, dstintf: 1, srcaddr: 1, dstaddr: 1, service: 1, action: 1,
    status: 1, logtraffic: 1, name: 1, comments: 1, schedule: 1,
    users: 1, groups: 1, 'fsso-groups': 1, 'utm-status': 1, 'profile-group': 1,
    'srcaddr-negate': 1, 'dstaddr-negate': 1, 'service-negate': 1,
    'internet-service': 1, application: 1, 'app-category': 1, 'app-group': 1,
    'url-category': 1, srcaddr6: 1, dstaddr6: 1
  };
  var POLICY_IGNORE = {
    uuid: 1, nat: 1, ippool: 1, poolname: 1, fixedport: 1, wccp: 1,
    'auto-asic-offload': 1, 'send-deny-packet': 1, 'inspection-mode': 1,
    comments: 1, name: 1, 'natenable': 1, 'diffserv-forward': 1,
    'tcp-mss-sender': 1, 'tcp-mss-receiver': 1, 'captive-portal-exempt': 1,
    'match-vip': 1, 'global-label': 1, label: 1
  };
  var SVC_CUSTOM_KEYS = {
    protocol: 1, 'protocol-number': 1,
    'tcp-portrange': 1, 'udp-portrange': 1, 'sctp-portrange': 1,
    icmptype: 1, icmpcode: 1,
    iprange: 1, fqdn: 1,
    comment: 1, comments: 1, color: 1, uuid: 1, visibility: 1,
    proxy: 1, category: 1, 'explicit-proxy': 1,
    'session-ttl': 1, helper: 1,
    'tcp-halfclose-timeout': 1, 'tcp-halfopen-timeout': 1,
    'tcp-timewait-timeout': 1, 'udp-idle-timeout': 1,
    'check-reset-range': 1, 'tcp-rst-timer': 1
  };

  function tokensOf(s) {
    var tokens = [];
    var re = /"([^"]*)"|(\S+)/g;
    var m;
    while ((m = re.exec(s))) tokens.push(m[1] !== undefined ? m[1] : m[2]);
    return tokens;
  }

  function installBuiltins(policy) {
    function addr(name, spec) {
      if (policy.objects.addr[name]) return;
      policy.objects.addr[name] = spec;
    }
    function svc(name, atoms) {
      if (policy.objects.svc[name]) return;
      policy.objects.svc[name] = { name: name, kind: 'atom', atoms: atoms, members: [], line: 0 };
    }
    addr('all', { name: 'all', kind: 'host', value: { lo: 0, hi: 0xFFFFFFFF }, v6: 'any', members: [], line: 0 });
    addr('none', { name: 'none', kind: 'host', value: { lo: 1, hi: 0 }, members: [], line: 0 }); // empty
    // none: empty v4. Use empty members group
    policy.objects.addr.none = { name: 'none', kind: 'group', members: [], exclude: [], line: 0 };

    function tcp(p) { return [IR.makeAtom(6, 6, [[0, 65535]], Array.isArray(p[0]) ? p : [p])]; }
    function udp(p) { return [IR.makeAtom(17, 17, [[0, 65535]], Array.isArray(p[0]) ? p : [p])]; }
    function both(p) { return tcp(p).concat(udp(p)); }
    svc('ALL', IR.anySvc());
    svc('ALL_TCP', [IR.makeAtom(6, 6, [[0, 65535]], [[1, 65535]])]);
    svc('ALL_UDP', [IR.makeAtom(17, 17, [[0, 65535]], [[1, 65535]])]);
    svc('ALL_ICMP', [IR.icmpAtom(null, null)]);
    svc('HTTP', tcp([80, 80]));
    svc('HTTPS', tcp([443, 443]));
    svc('SSH', tcp([22, 22]));
    svc('TELNET', tcp([23, 23]));
    svc('DNS', both([53, 53]));
    svc('NTP', both([123, 123]));
    svc('SMTP', tcp([25, 25]));
    svc('SMTPS', tcp([465, 465]));
    svc('SNMP', [IR.makeAtom(17, 17, [[0, 65535]], [[161, 162]])]);
    svc('SYSLOG', udp([514, 514]));
    svc('PING', [IR.icmpAtom(8, null)]);
    svc('FTP', tcp([21, 21]));
    svc('RDP', tcp([3389, 3389]));
    svc('BGP', tcp([179, 179]));
    svc('IKE', [IR.makeAtom(17, 17, [[0, 65535]], [[500, 500]]), IR.makeAtom(17, 17, [[0, 65535]], [[4500, 4500]])]);
    svc('LDAP', tcp([389, 389]));
    svc('RADIUS', [IR.makeAtom(17, 17, [[0, 65535]], [[1812, 1813]])]);
  }

  function parsePortRanges(str, protoLo) {
    var atoms = [];
    var bad = [];
    var parts = String(str || '').trim().split(/\s+/).filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      var p = parts[i];
      var dlo, dhi, slo = 0, shi = 65535;
      var segs = p.split(':');
      var d = segs[0];
      var dm = d.split('-');
      dlo = Number(dm[0]); dhi = dm[1] != null ? Number(dm[1]) : dlo;
      if (segs[1]) {
        var sm = segs[1].split('-');
        slo = Number(sm[0]); shi = sm[1] != null ? Number(sm[1]) : slo;
      }
      if (!isFinite(dlo) || !isFinite(dhi) || !isFinite(slo) || !isFinite(shi)) {
        bad.push(p);
        continue;
      }
      atoms.push(IR.makeAtom(protoLo, protoLo, [[slo, shi]], [[dlo, dhi]]));
    }
    return { atoms: atoms, bad: bad };
  }

  function parseFortios(text) {
    var policy = IR.emptyPolicy('fortios');
    installBuiltins(policy);
    return interpret(policy, collect(text));
  }

  function collect(text) {
    var lines = String(text || '').split(/\r?\n/);
    var stack = [{ type: 'root', name: '', edits: [], configs: [], sets: {} }];
    var ignoredBlocks = [];
    var inIgnored = 0;
    var ignoredName = '', ignoredLine = 0, ignoredCount = 0;
    var unparsed = [];

    function top() { return stack[stack.length - 1]; }
    var KEEP = {
      'firewall address': 1, 'firewall addrgrp': 1, 'firewall service custom': 1,
      'firewall service group': 1, 'firewall policy': 1, vdom: 1
    };

    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].replace(/\r$/, '').trim();
      var lineNo = i + 1;
      if (!trimmed || trimmed.charAt(0) === '#') continue;
      var m;
      if ((m = trimmed.match(/^config\s+(.+)$/i))) {
        var cname = m[1].trim();
        if (inIgnored) { inIgnored++; ignoredCount++; continue; }
        if (KEEP[cname]) {
          var cfg = { type: 'config', name: cname, edits: [], sets: {}, line: lineNo };
          top().configs = top().configs || [];
          top().configs.push(cfg);
          stack.push(cfg);
        } else {
          inIgnored = 1; ignoredName = cname; ignoredLine = lineNo; ignoredCount = 1;
        }
        continue;
      }
      if (/^end\b/i.test(trimmed)) {
        if (inIgnored) {
          inIgnored--;
          if (inIgnored === 0) {
            ignoredBlocks.push({ block: ignoredName, count: ignoredCount, line: ignoredLine });
            ignoredName = ''; ignoredCount = 0;
          } else ignoredCount++;
          continue;
        }
        if (stack.length > 1) stack.pop();
        continue;
      }
      if (inIgnored) { ignoredCount++; continue; }
      if ((m = trimmed.match(/^edit\s+(.+)$/i))) {
        var ename = m[1].trim().replace(/^"(.*)"$/, '$1');
        var ed = { type: 'edit', name: ename, sets: {}, lists: {}, line: lineNo, unknown: [] };
        top().edits = top().edits || [];
        top().edits.push(ed);
        stack.push(ed);
        continue;
      }
      if (/^next\b/i.test(trimmed)) {
        while (stack.length > 1 && top().type !== 'edit') stack.pop();
        if (stack.length > 1 && top().type === 'edit') stack.pop();
        continue;
      }
      if ((m = trimmed.match(/^(set|append|unset)\s+(\S+)\s*(.*)$/i))) {
        var cmd = m[1].toLowerCase();
        var key = m[2];
        var vals = tokensOf(m[3] || '');
        var node = top();
        if (node.type !== 'edit' && node.type !== 'config') {
          unparsed.push({ line: lineNo, text: trimmed });
          continue;
        }
        node.sets = node.sets || {};
        node.lists = node.lists || {};
        node.setLines = node.setLines || {};
        if (cmd === 'unset') { delete node.sets[key]; delete node.lists[key]; delete node.setLines[key]; continue; }
        if (cmd === 'append') {
          node.lists[key] = (node.lists[key] || []).concat(vals);
          node.sets[key] = node.lists[key];
          node.setLines[key] = lineNo;
          continue;
        }
        node.sets[key] = vals;
        node.lists[key] = vals;
        node.setLines[key] = lineNo;
        continue;
      }
      unparsed.push({ line: lineNo, text: trimmed });
    }
    if (inIgnored) ignoredBlocks.push({ block: ignoredName, count: ignoredCount, line: ignoredLine });
    return { root: stack[0], ignoredBlocks: ignoredBlocks, unparsed: unparsed };
  }

  function asList(node, key) {
    if (!node) return [];
    if (node.lists && node.lists[key]) return node.lists[key];
    if (node.sets && node.sets[key]) {
      var v = node.sets[key];
      return Array.isArray(v) ? v : [v];
    }
    return [];
  }
  function asOne(node, key) {
    var l = asList(node, key);
    return l.length ? l[0] : '';
  }

  function interpret(policy, tree) {
    tree.ignoredBlocks.forEach(function (b) {
      IR.addWarning(policy, 'ignored_block', b.line, { block: b.block, count: b.count });
    });
    tree.unparsed.forEach(function (u) {
      IR.addWarning(policy, 'unparsed_line', u.line, { text: u.text });
    });

    var configs = (tree.root.configs || []).slice();
    // vdom wrapping: config vdom / edit X / config firewall ...
    function walkConfigs(cfgs, vdomName) {
      for (var c = 0; c < cfgs.length; c++) {
        var cfg = cfgs[c];
        if (cfg.name === 'vdom') {
          (cfg.edits || []).forEach(function (ed) {
            walkConfigs(ed.configs || [], ed.name);
          });
          continue;
        }
        if (cfg.name === 'firewall address') parseAddresses(policy, cfg);
        else if (cfg.name === 'firewall addrgrp') parseAddrgrp(policy, cfg);
        else if (cfg.name === 'firewall service custom') parseSvcCustom(policy, cfg);
        else if (cfg.name === 'firewall service group') parseSvcGroup(policy, cfg);
        else if (cfg.name === 'firewall policy') parsePolicies(policy, cfg, vdomName || 'root');
      }
    }
    walkConfigs(configs, 'root');
    return policy;
  }

  function parseAddresses(policy, cfg) {
    (cfg.edits || []).forEach(function (ed) {
      var type = (asOne(ed, 'type') || 'ipmask').toLowerCase();
      var obj = { name: ed.name, kind: 'host', members: [], exclude: [], line: ed.line };
      if (type === 'ipmask' || type === 'interface-subnet' || type === '') {
        var sub = asList(ed, 'subnet');
        var val = sub.join(' ');
        if (!val) val = '0.0.0.0 0.0.0.0';
        var p = IR.parseV4(val.indexOf('/') >= 0 ? val : val, { mode: 'mask' });
        if (p && p.contiguous) {
          obj.kind = p.kind === 'host' ? 'host' : 'subnet';
          obj.value = { lo: p.lo, hi: p.hi };
        } else obj.value = val;
      } else if (type === 'iprange') {
        obj.kind = 'range';
        obj.value = asOne(ed, 'start-ip') + '-' + asOne(ed, 'end-ip');
        var pr = IR.parseV4(obj.value);
        if (pr) obj.value = { lo: pr.lo, hi: pr.hi };
      } else if (type === 'fqdn' || type === 'wildcard-fqdn') {
        obj.kind = 'fqdn'; obj.value = asOne(ed, 'fqdn') || ed.name;
      } else if (type === 'geography') {
        obj.kind = 'geo'; obj.value = asOne(ed, 'country') || ed.name;
      } else if (type === 'wildcard') {
        var wc = asList(ed, 'wildcard').join(' ') || asList(ed, 'subnet').join(' ');
        var pw = IR.parseV4(wc, { mode: 'wildcard' });
        obj.kind = 'wildcard';
        obj.contiguous = !!(pw && pw.contiguous);
        obj.value = pw && pw.contiguous ? { lo: pw.lo, hi: pw.hi } : wc;
      } else if (type === 'dynamic') {
        obj.kind = 'dynamic'; obj.value = ed.name;
      } else if (type === 'mac') {
        obj.kind = 'host'; obj.value = { lo: 0, hi: 0 };
        // flagged when used
      } else {
        obj.kind = 'dynamic'; obj.value = type;
      }
      if (type === 'mac') obj._mac = true;
      IR.addAddrObj(policy, obj);
    });
  }

  function parseAddrgrp(policy, cfg) {
    (cfg.edits || []).forEach(function (ed) {
      var obj = { name: ed.name, kind: 'group', members: asList(ed, 'member'), exclude: [], line: ed.line };
      if (String(asOne(ed, 'exclude')).toLowerCase() === 'enable') {
        obj.exclude = asList(ed, 'exclude-member');
      }
      IR.addAddrObj(policy, obj);
    });
  }

  function parseSvcCustom(policy, cfg) {
    (cfg.edits || []).forEach(function (ed) {
      var atoms = [];
      var proto = (asOne(ed, 'protocol') || '').toUpperCase();
      var portBad = false;
      [['tcp-portrange', 6], ['udp-portrange', 17], ['sctp-portrange', 132]].forEach(function (pair) {
        var raw = asList(ed, pair[0]).join(' ');
        if (!raw) return;
        var parsed = parsePortRanges(raw, pair[1]);
        atoms = atoms.concat(parsed.atoms);
        if (parsed.bad.length) {
          portBad = true;
          var ln = (ed.setLines && ed.setLines[pair[0]]) || ed.line;
          parsed.bad.forEach(function (part) {
            IR.addWarning(policy, 'unparsed_line', ln, { text: 'set ' + pair[0] + ' ' + part });
          });
        }
      });
      if (proto === 'ICMP' || asOne(ed, 'icmptype') || proto === 'ICMP6') {
        if (proto === 'ICMP6') { /* ipv6 flagged on use */ }
        var typ = asOne(ed, 'icmptype');
        var code = asOne(ed, 'icmpcode');
        var t = typ ? Number(typ) : null;
        var c = code !== '' && code != null ? Number(code) : null;
        atoms.push(IR.icmpAtom(isFinite(t) ? t : null, isFinite(c) ? c : null));
      }
      if (proto === 'IP' || asOne(ed, 'protocol-number')) {
        var pnStr = asOne(ed, 'protocol-number');
        if (pnStr === '' && proto === 'IP') {
          atoms.push(IR.makeAtom(0, 255, [[0, 65535]], [[0, 65535]]));
        } else {
          var pn = Number(pnStr || 0);
          atoms.push(IR.makeAtom(pn, pn, [[0, 65535]], [[0, 65535]]));
        }
      }
      if (!atoms.length) {
        if (proto === 'TCP/UDP/SCTP' || proto === '') {
          /* empty — may only have portranges already handled */
        }
      }
      var obj = { name: ed.name, kind: 'atom', atoms: atoms, members: [], line: ed.line };
      if (asOne(ed, 'iprange') || asOne(ed, 'fqdn')) obj._option = true;
      if (!atoms.length) obj._option = true;
      if (portBad) obj._option = true;
      Object.keys(ed.sets || {}).forEach(function (k) {
        if (SVC_CUSTOM_KEYS[k]) return;
        obj._option = true;
        var ln = (ed.setLines && ed.setLines[k]) || ed.line;
        IR.addWarning(policy, 'unparsed_line', ln, { text: 'set ' + k });
      });
      IR.addSvcObj(policy, obj);
    });
  }

  function parseSvcGroup(policy, cfg) {
    (cfg.edits || []).forEach(function (ed) {
      IR.addSvcObj(policy, { name: ed.name, kind: 'group', atoms: [], members: asList(ed, 'member'), line: ed.line });
    });
  }

  function parsePolicies(policy, cfg, vdomName) {
    var scopeKey = 'vdom:' + (vdomName || 'root');
    IR.ensureScope(policy, scopeKey, { kind: 'policy-list', label: vdomName || 'root' });
    (cfg.edits || []).forEach(function (ed) {
      var actRaw = (asOne(ed, 'action') || 'deny').toLowerCase();
      var action = actRaw === 'accept' || actRaw === 'ipsec' ? 'permit' : (actRaw === 'deny' ? 'deny' : 'deny');
      var status = (asOne(ed, 'status') || 'enable').toLowerCase();
      var logt = (asOne(ed, 'logtraffic') || '').toLowerCase();
      var rawLines = [];
      var rule = IR.makeRule({
        id: String(ed.name),
        name: asOne(ed, 'name') || String(ed.name),
        scopeKey: scopeKey,
        order: IR.scopeOrderCount(policy, scopeKey),
        lines: [ed.line],
        raw: 'edit ' + ed.name,
        comment: asOne(ed, 'comments') || '',
        action: action,
        terminal: true,
        disabled: status === 'disable',
        log: logt === 'all' || logt === 'utm',
        srcIntf: asList(ed, 'srcintf'),
        dstIntf: asList(ed, 'dstintf'),
        srcRefs: asList(ed, 'srcaddr'),
        dstRefs: asList(ed, 'dstaddr'),
        svcRefs: asList(ed, 'service')
      });
      var sched = asOne(ed, 'schedule');
      if (sched && sched.toLowerCase() !== 'always' && sched !== '') {
        IR.pushUnsup(rule, 'schedule', sched, ed.line);
      }
      if (asList(ed, 'users').length || asList(ed, 'groups').length || asList(ed, 'fsso-groups').length) {
        IR.pushUnsup(rule, 'user', 'users', ed.line);
      }
      if (String(asOne(ed, 'utm-status')).toLowerCase() === 'enable') {
        IR.pushUnsup(rule, 'utm', 'utm-status', ed.line);
      }
      Object.keys(ed.sets || {}).forEach(function (k) {
        if (/-profile$/.test(k) || k === 'profile-group') {
          if (asList(ed, k).length) IR.pushUnsup(rule, 'utm', k, ed.line);
        }
      });
      ['srcaddr-negate', 'dstaddr-negate', 'service-negate'].forEach(function (k) {
        if (String(asOne(ed, k)).toLowerCase() === 'enable') IR.pushUnsup(rule, 'negate', k, ed.line);
      });
      if (String(asOne(ed, 'internet-service')).toLowerCase() === 'enable' ||
          Object.keys(ed.sets || {}).some(function (k) { return k.indexOf('internet-service') === 0 && k !== 'internet-service'; })) {
        IR.pushUnsup(rule, 'internet_service', 'internet-service', ed.line);
      }
      if (asList(ed, 'application').length || asList(ed, 'app-category').length || asList(ed, 'app-group').length) {
        IR.pushUnsup(rule, 'app_id', 'application', ed.line);
      }
      if (asList(ed, 'url-category').length) IR.pushUnsup(rule, 'url_category', 'url-category', ed.line);
      if (asList(ed, 'srcaddr6').length || asList(ed, 'dstaddr6').length) IR.pushUnsup(rule, 'ipv6', 'addr6', ed.line);

      Object.keys(ed.sets || {}).forEach(function (k) {
        if (POLICY_KEYS[k] || POLICY_IGNORE[k] || /-profile$/.test(k) || k.indexOf('internet-service') === 0) return;
        var ln = (ed.setLines && ed.setLines[k]) || ed.line;
        IR.addWarning(policy, 'unparsed_line', ln, { text: 'set ' + k });
        IR.pushUnsup(rule, 'option', k, ln);
      });

      // mac-type addresses used as members → option (handled as unresolved/option via kind)
      IR.pushRule(policy, rule);
    });
  }

  function detect(text) {
    var score = 0;
    if (/^config\s+firewall\s+policy/im.test(text)) score += 50;
    if (/^config\s+firewall\s+address/im.test(text)) score += 25;
    if (/\bset\s+(srcintf|dstintf|srcaddr|dstaddr)\b/.test(text)) score += 20;
    if (/^\s*edit\s+/m.test(text) && /^\s*next\b/m.test(text)) score += 15;
    if (/^ip access-list\b/im.test(text)) score -= 30;
    if (/^\*filter\b/m.test(text)) score -= 40;
    if (/^set\s+security\s+policies\b/im.test(text)) score -= 40;
    return Math.max(0, Math.min(100, score));
  }

  var SAMPLE = [
    'config firewall address',
    '    edit "NET16"',
    '        set subnet 10.0.0.0 255.255.0.0',
    '    next',
    '    edit "NET24"',
    '        set subnet 10.0.1.0 255.255.255.0',
    '    next',
    '    edit "HOST"',
    '        set subnet 192.0.2.10 255.255.255.255',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "NET16"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "NET24"',
    '        set dstaddr "HOST"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 3',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "NET16"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 4',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "ALL"',
    '        set action deny',
    '        set schedule "always"',
    '    next',
    '    edit 5',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "NET24"',
    '        set dstaddr "all"',
    '        set service "SSH"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 6',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "HTTP"',
    '        set action accept',
    '        set schedule "business"',
    '    next',
    'end'
  ].join('\n');

  var api = { vendor: 'fortios', detect: detect, parse: parseFortios, sample: SAMPLE };
  root.FwParsers = root.FwParsers || {};
  root.FwParsers.fortios = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
