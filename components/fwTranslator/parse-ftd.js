/* ──────────────────────────────────────────────────────────────────────
 * parse-ftd.js — Cisco FTD / Firepower source parser (FMC JSON + LINA).
 * Source only — never a translation target.
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var IR = (typeof module !== 'undefined' && module.exports) ? require('./fwIR.js') : root.FwIR;
  var ciscoMod = (typeof module !== 'undefined' && module.exports) ? require('./parse-cisco.js') : null;

  function asaApi() {
    if (ciscoMod && ciscoMod.asa) return ciscoMod.asa;
    return (root.FwParsers && root.FwParsers.asa) || null;
  }

  var SYS_PORTS = {
    HTTP: { proto: 6, dport: 80 },
    HTTPS: { proto: 6, dport: 443 },
    SSH: { proto: 6, dport: 22 },
    DNS_over_UDP: { proto: 17, dport: 53 },
    DNS_over_TCP: { proto: 6, dport: 53 },
    SMTP: { proto: 6, dport: 25 },
    'NTP-UDP': { proto: 17, dport: 123 },
    FTP: { proto: 6, dport: 21 },
    TELNET: { proto: 6, dport: 23 },
    SNMP: { proto: 17, dport: 161 },
    SYSLOG: { proto: 17, dport: 514 },
    RDP: { proto: 6, dport: 3389 },
    LDAP: { proto: 6, dport: 389 },
    LDAPS: { proto: 6, dport: 636 },
    ICMP: { proto: 1 }
  };

  function installSysPorts(policy) {
    if (!policy.objects.addr.any) {
      policy.objects.addr.any = { name: 'any', kind: 'host', value: { lo: 0, hi: 0xFFFFFFFF }, v6: 'any', members: [], line: 0 };
    }
    if (!policy.objects.svc.any) {
      policy.objects.svc.any = { name: 'any', kind: 'atom', atoms: IR.anySvc(), members: [], line: 0 };
    }
    Object.keys(SYS_PORTS).forEach(function (n) {
      if (policy.objects.svc[n]) return;
      var s = SYS_PORTS[n];
      var atoms = s.proto === 1
        ? [IR.icmpAtom(null, null)]
        : [IR.makeAtom(s.proto, s.proto, [[0, 65535]], [[s.dport, s.dport]])];
      policy.objects.svc[n] = { name: n, kind: 'atom', atoms: atoms, members: [], line: 0 };
    });
  }

  function looksLikeJson(text) {
    return /^\s*[\[{]/.test(String(text || ''));
  }

  function tryParseJson(text) {
    try { return JSON.parse(String(text)); }
    catch (e) { return { __err: e }; }
  }

  function isRuleObj(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return false;
    if (typeof o.action !== 'string') return false;
    return o.sourceNetworks != null || o.destinationNetworks != null ||
      o.sourceZones != null || o.destinationPorts != null || o.enabled != null;
  }

  function isObjDef(o) {
    if (!o || typeof o !== 'object' || !o.type || !o.name) return false;
    return /^(Host|Network|Range|FQDN|NetworkGroup|ProtocolPortObject|PortObjectGroup|ICMPV4Object)$/.test(o.type);
  }

  function walkCollect(val, rules, objs, seen) {
    if (!val || typeof val !== 'object') return;
    if (seen) {
      if (seen.indexOf(val) >= 0) return;
      seen.push(val);
    } else seen = [val];
    if (Array.isArray(val)) {
      val.forEach(function (x) { walkCollect(x, rules, objs, seen); });
      return;
    }
    if (isRuleObj(val)) rules.push(val);
    if (isObjDef(val)) objs.push(val);
    Object.keys(val).forEach(function (k) {
      if (k === 'metadata') return;
      walkCollect(val[k], rules, objs, seen);
    });
  }

  function namesOf(container) {
    if (!container) return [];
    var out = [];
    (container.objects || []).forEach(function (o) {
      if (o && o.name) out.push(o.name);
      else if (typeof o === 'string') out.push(o);
    });
    return out;
  }

  function litsOfNet(container) {
    if (!container || !container.literals) return [];
    return container.literals.map(function (lit) {
      if (!lit) return null;
      var t = lit.type || '';
      if (t === 'Host') return { lit: { kind: 'host', value: lit.value } };
      if (t === 'Network') {
        var v = lit.value || '';
        if (lit.mask) v = v + ' ' + lit.mask;
        return { lit: { kind: 'subnet', value: v } };
      }
      if (t === 'Range') return { lit: { kind: 'range', value: lit.value } };
      if (t === 'FQDN') return { lit: { kind: 'fqdn', value: lit.value } };
      if (lit.value) return { lit: { kind: 'host', value: lit.value } };
      return null;
    }).filter(Boolean);
  }

  function maskLen(mask) {
    var p = IR.parseV4('0.0.0.0 ' + mask, { mode: 'mask' });
    return p && p.prefix != null ? p.prefix : 32;
  }

  function portLits(container) {
    if (!container) return [];
    var out = [];
    (container.objects || []).forEach(function (o) {
      if (o && o.name) out.push(o.name);
    });
    (container.literals || []).forEach(function (lit) {
      if (!lit) return;
      if (lit.icmpType != null || String(lit.protocol).toLowerCase() === 'icmp') {
        out.push({ lit: { proto: 1, icmpType: lit.icmpType, icmpCode: lit.code != null ? lit.code : lit.icmpCode } });
        return;
      }
      var proto = lit.protocol;
      var lp = typeof proto === 'number' ? { lo: proto, hi: proto } : IR.lookupProto(proto);
      if (lp.err) return;
      var port = lit.port;
      var dport = [[0, 65535]];
      if (port != null && port !== '') {
        var s = String(port);
        if (s.indexOf('-') >= 0) {
          var ab = s.split('-');
          dport = [[Number(ab[0]), Number(ab[1])]];
        } else {
          var n = Number(s);
          if (isFinite(n)) dport = [[n, n]];
        }
      }
      out.push({ lit: { proto: [lp.lo, lp.hi], dport: dport } });
    });
    return out;
  }

  function ingestObject(policy, o) {
    var name = o.name;
    var t = o.type;
    if (t === 'Host') {
      IR.addAddrObj(policy, { name: name, kind: 'host', value: o.value, members: [], line: 1 });
    } else if (t === 'Network') {
      IR.addAddrObj(policy, { name: name, kind: 'subnet', value: o.value, members: [], line: 1 });
    } else if (t === 'Range') {
      IR.addAddrObj(policy, { name: name, kind: 'range', value: o.value, members: [], line: 1 });
    } else if (t === 'FQDN') {
      IR.addAddrObj(policy, { name: name, kind: 'fqdn', value: o.value, members: [], line: 1 });
    } else if (t === 'NetworkGroup') {
      var mems = [];
      (o.objects || []).forEach(function (m) { if (m && m.name) mems.push(m.name); });
      (o.literals || []).forEach(function (lit) {
        if (!lit) return;
        if (lit.type === 'Host') mems.push({ lit: { kind: 'host', value: lit.value } });
        else if (lit.type === 'Network') mems.push({ lit: { kind: 'subnet', value: lit.value } });
        else if (lit.type === 'Range') mems.push({ lit: { kind: 'range', value: lit.value } });
      });
      IR.addAddrObj(policy, { name: name, kind: 'group', members: mems, exclude: [], line: 1 });
    } else if (t === 'ProtocolPortObject') {
      var lp = typeof o.protocol === 'number' ? { lo: o.protocol, hi: o.protocol } : IR.lookupProto(o.protocol);
      var atoms = [];
      if (!lp.err) {
        var dport = [[0, 65535]];
        if (o.port != null && o.port !== '') {
          var s = String(o.port);
          if (s.indexOf('-') >= 0) {
            var ab = s.split('-');
            dport = [[Number(ab[0]), Number(ab[1])]];
          } else {
            var n = Number(s);
            if (isFinite(n)) dport = [[n, n]];
          }
        }
        atoms.push(IR.makeAtom(lp.lo, lp.hi, [[0, 65535]], dport));
      }
      IR.addSvcObj(policy, { name: name, kind: 'atom', atoms: atoms, members: [], line: 1 });
    } else if (t === 'PortObjectGroup') {
      var sm = [];
      (o.objects || []).forEach(function (m) { if (m && m.name) sm.push(m.name); });
      IR.addSvcObj(policy, { name: name, kind: 'group', atoms: [], members: sm, line: 1 });
    } else if (t === 'ICMPV4Object') {
      IR.addSvcObj(policy, {
        name: name, kind: 'atom',
        atoms: [IR.icmpAtom(o.icmpType, o.code != null ? o.code : o.icmpCode)],
        members: [], line: 1
      });
    }
    if (o.id && name) {
      policy.meta.aliases = policy.meta.aliases || {};
      policy.meta.aliases[o.id] = name;
    }
  }

  function parseJson(text) {
    var policy = IR.emptyPolicy('ftd');
    installSysPorts(policy);
    var parsed = tryParseJson(text);
    if (parsed && parsed.__err) {
      IR.addWarning(policy, 'json_error', 0, { msg: String(parsed.__err.message || parsed.__err) });
      return policy;
    }
    var rules = [];
    var objs = [];
    walkCollect(parsed, rules, objs, []);
    objs.forEach(function (o) { ingestObject(policy, o); });

    rules.sort(function (a, b) {
      var ia = a.metadata && a.metadata.ruleIndex;
      var ib = b.metadata && b.metadata.ruleIndex;
      if (ia != null && ib != null) return ia - ib;
      return 0;
    });

    IR.ensureScope(policy, 'acp', { kind: 'policy-list', label: 'acp' });
    rules.forEach(function (raw, idx) {
      var actRaw = String(raw.action || '').toUpperCase();
      var action = 'permit';
      var terminal = true;
      var dropped = [];
      if (actRaw === 'ALLOW') action = 'permit';
      else if (actRaw === 'TRUST') {
        action = 'permit';
        dropped.push({ construct: 'ftd_trust', detail: 'TRUST', line: 1 });
      } else if (actRaw === 'BLOCK') action = 'deny';
      else if (actRaw === 'BLOCK_RESET') action = 'reject';
      else if (actRaw === 'MONITOR') {
        action = 'none';
        terminal = false;
      } else if (actRaw === 'BLOCK_INTERACTIVE' || actRaw === 'BLOCK_RESET_INTERACTIVE') {
        action = 'deny';
      } else action = 'permit';

      var srcRefs = namesOf(raw.sourceNetworks).concat(litsOfNet(raw.sourceNetworks));
      var dstRefs = namesOf(raw.destinationNetworks).concat(litsOfNet(raw.destinationNetworks));
      if (!srcRefs.length) srcRefs = ['any'];
      if (!dstRefs.length) dstRefs = ['any'];
      var svcRefs = portLits(raw.destinationPorts).concat(portLits(raw.sourcePorts));
      if (!svcRefs.length) svcRefs = ['any'];

      var comment = '';
      if (raw.newComments && raw.newComments.length) comment = String(raw.newComments[0]);
      else if (raw.commentHistoryList && raw.commentHistoryList[0] && raw.commentHistoryList[0].comment) {
        comment = String(raw.commentHistoryList[0].comment);
      }

      var rule = IR.makeRule({
        id: raw.id || raw.name || String(idx + 1),
        name: raw.name || String(idx + 1),
        scopeKey: 'acp',
        order: idx,
        lines: [1],
        raw: raw.name || '',
        comment: comment,
        action: action,
        terminal: terminal,
        disabled: raw.enabled === false,
        log: !!(raw.logBegin || raw.logEnd),
        srcIntf: namesOf(raw.sourceZones),
        dstIntf: namesOf(raw.destinationZones),
        srcRefs: srcRefs,
        dstRefs: dstRefs,
        svcRefs: svcRefs,
        dropped: dropped
      });
      if (actRaw === 'MONITOR') IR.pushUnsup(rule, 'option', 'MONITOR', 1);
      if (actRaw === 'BLOCK_INTERACTIVE' || actRaw === 'BLOCK_RESET_INTERACTIVE') {
        IR.pushUnsup(rule, 'option', actRaw, 1);
      }
      if (raw.applications && ((raw.applications.objects && raw.applications.objects.length) || (Array.isArray(raw.applications) && raw.applications.length))) {
        IR.pushUnsup(rule, 'app_id', 'applications', 1);
      }
      if (raw.urls && ((raw.urls.objects && raw.urls.objects.length) || (Array.isArray(raw.urls) && raw.urls.length))) {
        IR.pushUnsup(rule, 'url_category', 'urls', 1);
      }
      if (raw.users && ((raw.users.objects && raw.users.objects.length) || (Array.isArray(raw.users) && raw.users.length))) {
        IR.pushUnsup(rule, 'user', 'users', 1);
      }
      if (raw.sourceSecurityGroupTags && raw.sourceSecurityGroupTags.objects && raw.sourceSecurityGroupTags.objects.length) {
        IR.pushUnsup(rule, 'user', 'sgt', 1);
      }
      if (raw.vlanTags && ((raw.vlanTags.objects && raw.vlanTags.objects.length) || (raw.vlanTags.literals && raw.vlanTags.literals.length))) {
        IR.pushUnsup(rule, 'option', 'vlanTags', 1);
      }
      if (raw.ipsPolicy && raw.ipsPolicy !== 'None') IR.pushUnsup(rule, 'utm', 'ipsPolicy', 1);
      if (raw.filePolicy && raw.filePolicy !== 'None') IR.pushUnsup(rule, 'utm', 'filePolicy', 1);
      if (raw.variableSet && raw.variableSet !== 'Default-Set' && raw.variableSet !== 'Default Set') {
        IR.pushUnsup(rule, 'utm', 'variableSet', 1);
      }
      IR.pushRule(policy, rule);
    });
    return policy;
  }

  function parseFtd(text) {
    if (looksLikeJson(text)) return parseJson(text);
    var asa = asaApi();
    if (!asa || !asa.parseWith) {
      var policy = IR.emptyPolicy('ftd');
      IR.addWarning(policy, 'unparsed_line', 1, { text: 'no ASA parser' });
      return policy;
    }
    var p = asa.parseWith(text, { flavor: 'ftd' });
    p.vendor = 'ftd';
    return p;
  }

  function detect(text) {
    var score = 0;
    if (looksLikeJson(text)) {
      var parsed = tryParseJson(text);
      if (parsed && !parsed.__err) {
        var rules = [];
        var objs = [];
        walkCollect(parsed, rules, objs, []);
        if (rules.length) score += 80;
      }
    }
    if (/CSM_FW_ACL_/.test(text) || /access-list\s+\S+\s+advanced\b/i.test(text)) score += 80;
    if (/^config\s+firewall\b/im.test(text)) score -= 40;
    if (/^set\s+security\s+policies\b/im.test(text)) score -= 40;
    return Math.max(0, Math.min(100, score));
  }

  var SAMPLE = JSON.stringify({
    items: [
      {
        name: 'Allow_Web', action: 'ALLOW', enabled: true,
        sourceNetworks: { literals: [{ type: 'Network', value: '10.0.0.0/16' }] },
        destinationNetworks: { literals: [{ type: 'Host', value: '192.0.2.10' }] },
        destinationPorts: { objects: [{ name: 'HTTPS' }] }
      },
      { name: 'Trust_Inside', action: 'TRUST', enabled: true, sourceZones: { objects: [{ name: 'inside' }] } },
      { name: 'Block_Reset', action: 'BLOCK_RESET', enabled: true },
      { name: 'Monitor_App', action: 'MONITOR', enabled: true, applications: { objects: [{ name: 'ssl' }] } },
      { name: 'Users', action: 'ALLOW', enabled: true, users: { objects: [{ name: 'eng' }] } },
      { name: 'Unresolved', action: 'ALLOW', enabled: true, sourceNetworks: { objects: [{ name: 'MISSING_NET' }] } }
    ]
  }, null, 2);

  var api = { vendor: 'ftd', detect: detect, parse: parseFtd, sample: SAMPLE };
  root.FwParsers = root.FwParsers || {};
  root.FwParsers.ftd = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
