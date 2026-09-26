/* ──────────────────────────────────────────────────────────────────────
 * parse-panos.js — PAN-OS set-form and XML security policy parser.
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var IR = (typeof module !== 'undefined' && module.exports) ? require('./fwIR.js') : root.FwIR;

  var RULE_KEYS = {
    from: 1, to: 1, source: 1, destination: 1, service: 1, application: 1,
    action: 1, description: 1, disabled: 1, 'log-start': 1, 'log-end': 1,
    'negate-source': 1, 'negate-destination': 1, 'source-user': 1, category: 1,
    'source-hip': 1, 'destination-hip': 1, schedule: 1, tag: 1, 'rule-type': 1,
    'profile-setting': 1, uuid: 1, 'group-tag': 1, 'source-imei': 1
  };

  function tokenizeSet(s) {
    var tokens = [];
    var re = /\[([^\]]*)\]|"([^"]*)"|(\S+)/g;
    var m;
    while ((m = re.exec(s))) {
      if (m[1] !== undefined) {
        var inner = [];
        var re2 = /"([^"]*)"|(\S+)/g;
        var m2;
        while ((m2 = re2.exec(m[1]))) inner.push(m2[1] !== undefined ? m2[1] : m2[2]);
        tokens.push({ list: inner.filter(Boolean) });
      }
      else if (m[2] !== undefined) tokens.push(m[2]);
      else tokens.push(m[3]);
    }
    return tokens;
  }

  function decodeEntities(s) {
    return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, function (_, e) {
      if (e === 'amp') return '&';
      if (e === 'lt') return '<';
      if (e === 'gt') return '>';
      if (e === 'quot') return '"';
      if (e === 'apos') return "'";
      if (e.charAt(0) === '#') {
        var n = e.charAt(1) === 'x' || e.charAt(1) === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        if (!isFinite(n) || n < 0 || n > 0x10FFFF) return '';
        return String.fromCharCode(n);
      }
      return '';
    });
  }

  function parseXmlToTree(text, warnings) {
    if (/<!DOCTYPE/i.test(text)) {
      warnings.push({ code: 'xml_doctype', line: 1, params: {} });
      return null;
    }
    var src = String(text || '');
    var i = 0, line = 1;
    var root = { name: '#root', attrs: {}, children: [], text: '', line: 1 };
    var stack = [root];

    function err(ln) {
      warnings.push({ code: 'xml_error', line: ln || line, params: {} });
      return null;
    }
    function peek(n) { return src.substr(i, n || 1); }
    function skipWs() {
      while (i < src.length && /\s/.test(src.charAt(i))) {
        if (src.charAt(i) === '\n') line++;
        i++;
      }
    }

    while (i < src.length) {
      if (src.charAt(i) !== '<') {
        var tStart = i, tLine = line;
        var raw = '';
        while (i < src.length && src.charAt(i) !== '<') {
          if (src.charAt(i) === '\n') line++;
          raw += src.charAt(i++);
        }
        if (raw.replace(/\s+/g, '')) {
          stack[stack.length - 1].text += decodeEntities(raw);
        }
        continue;
      }
      if (peek(9).toLowerCase() === '<!doctype') return err(line);
      if (peek(4) === '<!--') {
        i += 4;
        while (i < src.length && peek(3) !== '-->') {
          if (src.charAt(i) === '\n') line++;
          i++;
        }
        if (peek(3) !== '-->') return err(line);
        i += 3;
        continue;
      }
      if (peek(9) === '<![CDATA[') {
        i += 9;
        var cd = '';
        while (i < src.length && peek(3) !== ']]>') {
          if (src.charAt(i) === '\n') line++;
          cd += src.charAt(i++);
        }
        if (peek(3) !== ']]>') return err(line);
        i += 3;
        stack[stack.length - 1].text += cd;
        continue;
      }
      if (peek(2) === '<?') {
        i += 2;
        while (i < src.length && peek(2) !== '?>') {
          if (src.charAt(i) === '\n') line++;
          i++;
        }
        if (peek(2) !== '?>') return err(line);
        i += 2;
        continue;
      }
      if (peek(2) === '</') {
        i += 2;
        var cname = '';
        while (i < src.length && /[A-Za-z0-9:_.-]/.test(src.charAt(i))) cname += src.charAt(i++);
        skipWs();
        if (src.charAt(i) !== '>') return err(line);
        i++;
        if (stack.length <= 1) return err(line);
        var closing = stack.pop();
        if (closing.name !== cname) return err(closing.line);
        continue;
      }
      if (src.charAt(i) === '<') {
        var openLine = line;
        i++;
        if (src.charAt(i) === '!') return err(line);
        var oname = '';
        while (i < src.length && /[A-Za-z0-9:_.-]/.test(src.charAt(i))) oname += src.charAt(i++);
        if (!oname) return err(line);
        var attrs = {};
        skipWs();
        while (i < src.length && src.charAt(i) !== '>' && src.charAt(i) !== '/') {
          var an = '';
          while (i < src.length && /[A-Za-z0-9:_.-]/.test(src.charAt(i))) an += src.charAt(i++);
          skipWs();
          if (src.charAt(i) !== '=') return err(line);
          i++;
          skipWs();
          var q = src.charAt(i);
          if (q !== '"' && q !== "'") return err(line);
          i++;
          var av = '';
          while (i < src.length && src.charAt(i) !== q) {
            if (src.charAt(i) === '\n') line++;
            av += src.charAt(i++);
          }
          if (src.charAt(i) !== q) return err(line);
          i++;
          attrs[an] = decodeEntities(av);
          skipWs();
        }
        var selfClose = false;
        if (src.charAt(i) === '/') { selfClose = true; i++; }
        if (src.charAt(i) !== '>') return err(line);
        i++;
        if (stack.length > 64) {
          warnings.push({ code: 'xml_error', line: openLine, params: { msg: 'depth' } });
          return null;
        }
        var node = { name: oname, attrs: attrs, children: [], text: '', line: openLine };
        stack[stack.length - 1].children.push(node);
        if (!selfClose) stack.push(node);
      }
    }
    if (stack.length !== 1) return err(line);
    return root;
  }

  function walkXml(node, path, stmts) {
    if (!node) return;
    var kids = node.children || [];
    var members = [];
    var hasElem = false;
    for (var i = 0; i < kids.length; i++) {
      var ch = kids[i];
      if (ch.name === 'member') {
        members.push(String(ch.text || '').trim());
        hasElem = true;
      } else {
        hasElem = true;
        var step = ch.name;
        if (ch.name === 'entry' && ch.attrs && ch.attrs.name) step = ch.attrs.name;
        walkXml(ch, path.concat([step]), stmts);
      }
    }
    if (members.length) {
      stmts.push({ path: path.slice(), values: members, line: node.line });
    } else if (!hasElem) {
      var text = String(node.text || '').trim();
      if (text !== '' || path.length) {
        stmts.push({ path: path.slice(), values: text === '' ? [] : [text], line: node.line });
      }
    }
  }

  function normalizeXmlPath(path) {
    var p = path.slice();
    if (p[0] === 'config') p = p.slice(1);
    if (p[0] === 'readonly') return { ignore: true, path: p };
    if (p[0] === 'devices') {
      p = p.slice(1);
      if (p.length) p = p.slice(1); // device name
      if (p[0] === 'vsys') {
        p = p.slice(1);
        var vsys = p[0] || 'vsys1';
        return { prefix: ['vsys', vsys], rest: p.slice(1) };
      }
      if (p[0] === 'device-group') {
        p = p.slice(1);
        var dg = p[0] || '';
        return { prefix: ['device-group', dg], rest: p.slice(1) };
      }
      return { prefix: ['vsys', 'vsys1'], rest: p };
    }
    if (p[0] === 'shared') return { prefix: ['shared'], rest: p.slice(1) };
    if (p[0] === 'vsys') {
      return { prefix: ['vsys', p[1] || 'vsys1'], rest: p.slice(2) };
    }
    return { prefix: ['vsys', 'vsys1'], rest: p };
  }

  function statementsFromXml(text, warnings) {
    var tree = parseXmlToTree(text, warnings);
    if (!tree) return [];
    var raw = [];
    walkXml(tree, [], raw);
    var stmts = [];
    for (var i = 0; i < raw.length; i++) {
      var n = normalizeXmlPath(raw[i].path);
      if (n.ignore) {
        warnings.push({ code: 'ignored_block', line: raw[i].line, params: { block: 'readonly', count: 1 } });
        continue;
      }
      stmts.push({ path: (n.prefix || []).concat(n.rest || []), values: raw[i].values, line: raw[i].line });
    }
    return stmts;
  }

  function statementsFromSet(text, warnings) {
    var stmts = [];
    var lines = String(text || '').split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var trimmed = lines[i].replace(/\r$/, '').trim();
      var lineNo = i + 1;
      if (!trimmed || trimmed.charAt(0) === '#') continue;
      if (/^(delete|edit|up|top)\b/i.test(trimmed)) {
        warnings.push({ code: 'unparsed_line', line: lineNo, params: { text: trimmed } });
        continue;
      }
      if (!/^set\s+/i.test(trimmed)) {
        warnings.push({ code: 'unparsed_line', line: lineNo, params: { text: trimmed } });
        continue;
      }
      var tok = tokenizeSet(trimmed.replace(/^set\s+/i, ''));
      if (!tok.length) continue;
      var values;
      var path;
      if (tok[tok.length - 1] && tok[tok.length - 1].list) {
        values = tok[tok.length - 1].list;
        path = tok.slice(0, -1).map(String);
      } else {
        values = [String(tok[tok.length - 1])];
        path = tok.slice(0, -1).map(String);
      }
      stmts.push({ path: path, values: values, line: lineNo });
    }
    return stmts;
  }

  function isXml(text) {
    return /^\s*</.test(String(text || ''));
  }

  function installBuiltins(policy) {
    function addr(name, spec) {
      if (!policy.objects.addr[name]) policy.objects.addr[name] = spec;
    }
    function svc(name, spec) {
      if (!policy.objects.svc[name]) policy.objects.svc[name] = spec;
    }
    addr('any', { name: 'any', kind: 'host', value: { lo: 0, hi: 0xFFFFFFFF }, v6: 'any', members: [], line: 0 });
    svc('any', { name: 'any', kind: 'atom', atoms: IR.anySvc(), members: [], line: 0 });
    svc('service-http', {
      name: 'service-http', kind: 'atom',
      atoms: [IR.makeAtom(6, 6, [[0, 65535]], [[80, 80]]), IR.makeAtom(6, 6, [[0, 65535]], [[8080, 8080]])],
      members: [], line: 0
    });
    svc('service-https', {
      name: 'service-https', kind: 'atom',
      atoms: [IR.makeAtom(6, 6, [[0, 65535]], [[443, 443]])],
      members: [], line: 0
    });
    svc('application-default', {
      name: 'application-default', kind: 'atom', atoms: IR.anySvc(), members: [], line: 0,
      unanalysable: true, unanalysableConstruct: 'app_default'
    });
  }

  function splitPrefix(path) {
    if (path[0] === 'vsys' && path[1]) return { kind: 'vsys', name: path[1], rest: path.slice(2) };
    if (path[0] === 'shared') return { kind: 'shared', name: 'shared', rest: path.slice(1) };
    if (path[0] === 'device-group' && path[1]) return { kind: 'dg', name: path[1], rest: path.slice(2) };
    return { kind: 'vsys', name: 'vsys1', rest: path };
  }

  function parsePortList(str) {
    var atoms = [];
    var parts = String(str || '').replace(/"/g, '').split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    for (var i = 0; i < parts.length; i++) {
      var ab = parts[i].split('-');
      var a = Number(ab[0]);
      var b = ab[1] != null ? Number(ab[1]) : a;
      if (!isFinite(a) || !isFinite(b)) continue;
      atoms.push([Math.min(a, b), Math.max(a, b)]);
    }
    return atoms.length ? atoms : [[0, 65535]];
  }

  function parsePanos(text) {
    var policy = IR.emptyPolicy('panos');
    installBuiltins(policy);
    var warnings = [];
    var stmts;
    if (isXml(text)) {
      stmts = statementsFromXml(text, warnings);
    } else {
      stmts = statementsFromSet(text, warnings);
    }
    warnings.forEach(function (w) {
      if (!policy.warnings.some(function (x) { return x.code === w.code && x.line === w.line; })) {
        policy.warnings.push(w);
      }
    });
    if (isXml(text) && warnings.some(function (w) { return w.code === 'xml_doctype' || w.code === 'xml_error'; })) {
      return policy;
    }

    var rules = Object.create(null);
    var ruleOrder = [];
    var ignored = Object.create(null);
    var dgs = [];

    function markIgnored(block, line) {
      if (!ignored[block]) ignored[block] = { count: 0, line: line };
      ignored[block].count++;
    }

    function scopeOf(pref, restHead) {
      if (pref.kind === 'shared' && (restHead === 'pre-rulebase' || restHead === 'post-rulebase')) {
        return restHead === 'pre-rulebase' ? 'shared:pre' : 'shared:post';
      }
      if (pref.kind === 'dg' && (restHead === 'pre-rulebase' || restHead === 'post-rulebase')) {
        return 'dg:' + pref.name + ':' + (restHead === 'pre-rulebase' ? 'pre' : 'post');
      }
      return 'rulebase:' + (pref.kind === 'vsys' ? pref.name : 'vsys1');
    }

    function ensureRule(scopeKey, name, line) {
      var k = scopeKey + '\0' + name;
      if (!rules[k]) {
        rules[k] = {
          name: name, scopeKey: scopeKey, line: line, lines: [line],
          from: [], to: [], src: [], dst: [], svc: [], app: [],
          action: 'allow', disabled: false, log: true, logSet: false,
          negSrc: false, negDst: false, comment: '', user: false,
          category: false, hip: false, utm: false, sched: '', tag: false,
          ruleType: '', extra: []
        };
        ruleOrder.push(k);
      }
      var r = rules[k];
      if (r.lines.indexOf(line) < 0) r.lines.push(line);
      return r;
    }

    function addAddr(name, spec) {
      spec.name = name;
      spec.line = spec.line || 0;
      spec.members = spec.members || [];
      IR.addAddrObj(policy, spec);
    }

    for (var s = 0; s < stmts.length; s++) {
      var st = stmts[s];
      var pref = splitPrefix(st.path);
      var p = pref.rest;
      var vals = st.values || [];
      var v0 = vals[0];
      if (!p.length) continue;

      if (p[0] === 'address' && p[1]) {
        var an = p[1];
        var obj = policy.objects.addr[an] || { name: an, kind: 'host', members: [], line: st.line };
        var key = p[2];
        if (key === 'ip-netmask' && v0) {
          if (IR.looksLikeIpv6(v0)) { obj.ipv6 = true; obj.value = v0; }
          else {
            var pv = IR.parseV4(v0.indexOf('/') >= 0 ? v0 : v0 + '/32');
            if (pv) { obj.kind = pv.kind; obj.value = { lo: pv.lo, hi: pv.hi }; }
            else obj.value = v0;
          }
        } else if (key === 'ip-range' && v0) {
          obj.kind = 'range';
          var pr = IR.parseV4(v0);
          obj.value = pr ? { lo: pr.lo, hi: pr.hi } : v0;
        } else if (key === 'fqdn' && v0) {
          obj.kind = 'fqdn'; obj.value = v0;
        } else if (key === 'ip-wildcard' && v0) {
          var pw = IR.parseV4(String(v0).replace(/\//g, ' '), { mode: 'wildcard' });
          obj.kind = 'wildcard';
          obj.contiguous = !!(pw && pw.contiguous);
          obj.value = pw && pw.contiguous ? { lo: pw.lo, hi: pw.hi } : v0;
        } else if (key === 'description' && v0) {
          obj.comment = v0;
        } else if (key === 'tag') {
          /* ignored on objects */
        }
        if (!policy.objects.addr[an]) addAddr(an, obj);
        else policy.objects.addr[an] = obj;
        continue;
      }

      if (p[0] === 'address-group' && p[1]) {
        var gn = p[1];
        if (!policy.objects.addr[gn] || policy.objects.addr[gn].kind !== 'group') {
          addAddr(gn, { kind: 'group', members: [], exclude: [], line: st.line });
        }
        var g = policy.objects.addr[gn];
        if (p[2] === 'static') {
          g.members = g.members.concat(vals);
        } else if (p[2] === 'dynamic') {
          g.kind = 'dynamic';
          g.unanalysable = true;
          g.unanalysableConstruct = 'option';
        }
        continue;
      }

      if (p[0] === 'region' && p[1]) {
        addAddr(p[1], { kind: 'geo', value: p[1], line: st.line });
        continue;
      }

      if (p[0] === 'service' && p[1]) {
        var sn = p[1];
        var so = policy.objects.svc[sn];
        if (!so) {
          so = { name: sn, kind: 'atom', atoms: [], members: [], line: st.line };
          IR.addSvcObj(policy, so);
        }
        if (p[2] === 'protocol') {
          var protoName = p[3] ? String(p[3]).toLowerCase() : String(v0 || '').toLowerCase();
          var lp = IR.lookupProto(protoName);
          if (lp.err) { so._option = true; continue; }
          var dports = [[0, 65535]], sports = [[0, 65535]];
          var gotPort = false;
          if (p[4] === 'port') { dports = parsePortList(vals.join(',')); gotPort = true; }
          else if (p[4] === 'source-port') { sports = parsePortList(vals.join(',')); gotPort = true; }
          if (gotPort) so.atoms.push(IR.makeAtom(lp.lo, lp.hi, sports, dports));
          else so._pendingProto = lp.lo;
        }
        if (p[2] === 'port') {
          var protoUse = so._pendingProto != null ? so._pendingProto : 6;
          so.atoms.push(IR.makeAtom(protoUse, protoUse, [[0, 65535]], parsePortList(vals.join(','))));
        }
        if (p[2] === 'source-port' && p[3] !== 'protocol') {
          var protoUse2 = so._pendingProto != null ? so._pendingProto : 6;
          so.atoms.push(IR.makeAtom(protoUse2, protoUse2, parsePortList(vals.join(',')), [[0, 65535]]));
        }
        continue;
      }

      if (p[0] === 'service-group' && p[1]) {
        if (!policy.objects.svc[p[1]] || policy.objects.svc[p[1]].kind !== 'group') {
          IR.addSvcObj(policy, { name: p[1], kind: 'group', members: [], atoms: [], line: st.line });
        }
        if (p[2] === 'members') policy.objects.svc[p[1]].members = policy.objects.svc[p[1]].members.concat(vals);
        continue;
      }

      if (p[0] === 'zone' && p[1]) {
        var zn = p[1];
        if (!policy.zones[zn]) policy.zones[zn] = { ifaces: [], line: st.line };
        if (p[2] === 'network' && (p[3] === 'layer3' || p[3] === 'layer2' || p[3] === 'virtual-wire' || p[3] === 'tap')) {
          policy.zones[zn].ifaces = policy.zones[zn].ifaces.concat(p.slice(4)).concat(vals).filter(function (x) {
            return x && x !== 'layer3' && x !== 'layer2' && x !== 'virtual-wire' && x !== 'tap';
          });
        }
        continue;
      }

      if (p[0] === 'rulebase' || p[0] === 'pre-rulebase' || p[0] === 'post-rulebase') {
        if (p[1] === 'nat') {
          policy.meta.natPresent = true;
          markIgnored('rulebase nat', st.line);
          continue;
        }
        if (p[1] && p[1] !== 'security') {
          markIgnored('rulebase ' + p[1], st.line);
          continue;
        }
        if (p[1] === 'security' && p[2] === 'rules' && p[3]) {
          var scopeKey = scopeOf(pref, p[0]);
          if (pref.kind === 'dg') {
            if (dgs.indexOf(pref.name) < 0) dgs.push(pref.name);
          }
          var rule = ensureRule(scopeKey, p[3], st.line);
          var rk = p[4];
          applyRuleKey(rule, rk, p.slice(5), vals, st);
          continue;
        }
        continue;
      }

      if (p[0] === 'network' || p[0] === 'deviceconfig' || p[0] === 'mgt-config') {
        markIgnored(p[0], st.line);
        continue;
      }
      warnings.push({ code: 'unparsed_line', line: st.line, params: { text: p.join(' ') } });
    }

    policy.meta.deviceGroups = dgs;

    Object.keys(ignored).forEach(function (b) {
      IR.addWarning(policy, 'ignored_block', ignored[b].line, { block: b, count: ignored[b].count });
    });

    var orderBuckets = Object.create(null);
    ruleOrder.forEach(function (k) {
      var rec = rules[k];
      IR.ensureScope(policy, rec.scopeKey, {
        kind: 'policy-list',
        label: rec.scopeKey.indexOf('dg:') === 0 ? rec.scopeKey : (rec.scopeKey.split(':')[1] || rec.scopeKey)
      });
      if (orderBuckets[rec.scopeKey] == null) orderBuckets[rec.scopeKey] = 0;
      var action = 'permit';
      if (rec.action === 'deny' || rec.action === 'drop') action = 'deny';
      else if (rec.action === 'reset-client' || rec.action === 'reset-server' || rec.action === 'reset-both') action = 'reject';
      else if (rec.action === 'allow') action = 'permit';

      var srcRefs = refsFrom(rec.src, 'src', rec);
      var dstRefs = refsFrom(rec.dst, 'dst', rec);
      var svcRefs;
      var appDefault = rec.svc.length === 1 && String(rec.svc[0]).toLowerCase() === 'application-default';
      if (appDefault) svcRefs = ['any'];
      else if (!rec.svc.length || (rec.svc.length === 1 && String(rec.svc[0]).toLowerCase() === 'any')) svcRefs = ['any'];
      else svcRefs = rec.svc.slice();

      var fromZ = rec.from.filter(function (z) { return String(z).toLowerCase() !== 'any'; });
      var toZ = rec.to.filter(function (z) { return String(z).toLowerCase() !== 'any'; });

      var rule = IR.makeRule({
        id: rec.name, name: rec.name, scopeKey: rec.scopeKey,
        order: orderBuckets[rec.scopeKey]++,
        lines: rec.lines, raw: rec.name, comment: rec.comment,
        action: action, terminal: true, disabled: rec.disabled, log: rec.log,
        srcIntf: fromZ.length ? fromZ : rec.from,
        dstIntf: toZ.length ? toZ : rec.to,
        srcRefs: srcRefs, dstRefs: dstRefs, svcRefs: svcRefs,
        negate: { src: rec.negSrc, dst: rec.negDst, svc: false }
      });
      if (appDefault) IR.pushUnsup(rule, 'app_default', 'application-default', rec.line);
      var apps = rec.app.filter(function (a) { return String(a).toLowerCase() !== 'any'; });
      if (apps.length) IR.pushUnsup(rule, 'app_id', apps.join(','), rec.line);
      if (rec.user) IR.pushUnsup(rule, 'user', 'source-user', rec.line);
      if (rec.category) IR.pushUnsup(rule, 'url_category', 'category', rec.line);
      if (rec.hip) IR.pushUnsup(rule, 'user', 'hip', rec.line);
      if (rec.utm) IR.pushUnsup(rule, 'utm', 'profile-setting', rec.line);
      if (rec.sched) IR.pushUnsup(rule, 'schedule', rec.sched, rec.line);
      if (rec.tag) rule.dropped.push({ construct: 'option', detail: 'tag', line: rec.line });
      if (rec.ruleType && rec.ruleType !== 'universal') {
        var intraOk = rec.ruleType === 'intrazone' && rec.from.length === 1 && rec.to.length === 1 && rec.from[0] === rec.to[0];
        if (!intraOk) IR.pushUnsup(rule, 'option', 'rule-type', rec.line);
      }
      rec.extra.forEach(function (ex) {
        IR.addWarning(policy, 'unparsed_line', rec.line, { text: ex });
        IR.pushUnsup(rule, 'option', ex, rec.line);
      });
      if (rec.scopeKey.indexOf('dg:') === 0 || rec.scopeKey.indexOf('shared:') === 0) {
        var det = rec.scopeKey.indexOf(':pre') >= 0 ? 'pre' : (rec.scopeKey.indexOf(':post') >= 0 ? 'post' : 'pre');
        rule.dropped.push({ construct: 'panorama', detail: det, line: rec.line });
      }
      IR.pushRule(policy, rule);
    });

    return policy;
  }

  function refsFrom(list, which, rec) {
    if (!list.length) return ['any'];
    return list.map(function (tok) {
      var s = String(tok);
      if (s.toLowerCase() === 'any') return 'any';
      if (/^[A-Z]{2}$/.test(s)) return { lit: { kind: 'geo', value: s } };
      if (IR.parseV4(s) || /^\d+\.\d+\.\d+\.\d+(\/\d+)?$/.test(s)) {
        return { lit: { kind: s.indexOf('/') >= 0 ? 'subnet' : 'host', value: s } };
      }
      return s;
    });
  }

  function applyRuleKey(rule, rk, rest, vals, st) {
    if (!rk) return;
    var all = rest.concat(vals).filter(function (x) { return x !== undefined && x !== ''; });
    if (rk === 'from') rule.from = rule.from.concat(vals.length ? vals : all);
    else if (rk === 'to') rule.to = rule.to.concat(vals.length ? vals : all);
    else if (rk === 'source') rule.src = rule.src.concat(vals.length ? vals : all);
    else if (rk === 'destination') rule.dst = rule.dst.concat(vals.length ? vals : all);
    else if (rk === 'service') rule.svc = rule.svc.concat(vals.length ? vals : all);
    else if (rk === 'application') rule.app = rule.app.concat(vals.length ? vals : all);
    else if (rk === 'action') rule.action = String(vals[0] || rest[0] || 'allow').toLowerCase();
    else if (rk === 'description') rule.comment = vals[0] || rest[0] || '';
    else if (rk === 'disabled') rule.disabled = String(vals[0] || rest[0] || '').toLowerCase() === 'yes';
    else if (rk === 'log-start') {
      if (String(vals[0] || rest[0] || '').toLowerCase() === 'yes') rule.log = true;
    } else if (rk === 'log-end') {
      rule.logSet = true;
      rule.log = String(vals[0] || rest[0] || 'yes').toLowerCase() !== 'no';
    } else if (rk === 'negate-source') rule.negSrc = String(vals[0] || rest[0] || '').toLowerCase() === 'yes';
    else if (rk === 'negate-destination') rule.negDst = String(vals[0] || rest[0] || '').toLowerCase() === 'yes';
    else if (rk === 'source-user') {
      var u = (vals.length ? vals : all).filter(function (x) { return String(x).toLowerCase() !== 'any'; });
      if (u.length) rule.user = true;
    } else if (rk === 'category') {
      var c = (vals.length ? vals : all).filter(function (x) { return String(x).toLowerCase() !== 'any'; });
      if (c.length) rule.category = true;
    } else if (rk === 'source-hip' || rk === 'destination-hip') {
      var h = (vals.length ? vals : all).filter(function (x) { return String(x).toLowerCase() !== 'any'; });
      if (h.length) rule.hip = true;
    } else if (rk === 'profile-setting') rule.utm = true;
    else if (rk === 'schedule') rule.sched = vals[0] || rest[0] || '';
    else if (rk === 'tag') rule.tag = true;
    else if (rk === 'rule-type') rule.ruleType = String(vals[0] || rest[0] || '').toLowerCase();
    else if (rk === 'uuid' || rk === 'group-tag' || rk === 'source-imei') { /* ignore */ }
    else if (!RULE_KEYS[rk]) rule.extra.push(rk);
  }

  function detect(text) {
    var score = 0;
    if (/^set\s+(rulebase|address|service|zone|device-group|shared|vsys)\b/im.test(text)) score += 60;
    if (/<rulebase\b/i.test(text) || /<security\b/i.test(text) || /<entry\s+name=/i.test(text)) score += 60;
    if (/^set\s+security\s+policies\b/im.test(text)) score -= 40;
    if (/^config\s+firewall\b/im.test(text)) score -= 50;
    if (/^access-list\s+\S+\s+extended\b/im.test(text)) score -= 30;
    return Math.max(0, Math.min(100, score));
  }

  var SAMPLE = [
    'set address H_WEB ip-netmask 192.0.2.10/32',
    'set address NET16 ip-netmask 10.0.0.0/16',
    'set address RNG ip-range 10.0.1.1-10.0.1.20',
    'set address FQ fqdn www.example.com',
    'set address-group G_IN static [ NET16 H_WEB ]',
    'set address-group G_OUT static [ G_IN ]',
    'set service WEB-ALT protocol tcp port 8080,8081',
    'set service-group SG members [ service-https WEB-ALT ]',
    'set zone trust network layer3 [ ethernet1/1 ]',
    'set zone untrust network layer3 [ ethernet1/2 ]',
    'set rulebase security rules allow-web from trust',
    'set rulebase security rules allow-web to untrust',
    'set rulebase security rules allow-web source NET16',
    'set rulebase security rules allow-web destination any',
    'set rulebase security rules allow-web service service-https',
    'set rulebase security rules allow-web application any',
    'set rulebase security rules allow-web action allow',
    'set rulebase security rules allow-web description "web out"',
    'set rulebase security rules neg-src from trust',
    'set rulebase security rules neg-src to untrust',
    'set rulebase security rules neg-src source NET16',
    'set rulebase security rules neg-src destination any',
    'set rulebase security rules neg-src service any',
    'set rulebase security rules neg-src application any',
    'set rulebase security rules neg-src action allow',
    'set rulebase security rules neg-src negate-source yes'
  ].join('\n');

  var api = { vendor: 'panos', detect: detect, parse: parsePanos, sample: SAMPLE };
  root.FwParsers = root.FwParsers || {};
  root.FwParsers.panos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
