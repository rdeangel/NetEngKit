/* ──────────────────────────────────────────────────────────────────────
 * emit-asa.js — Cisco ASA migration-draft emitter.
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var PORT_BY_NUM = {
    80: 'www', 443: 'https', 22: 'ssh', 23: 'telnet', 21: 'ftp', 25: 'smtp',
    53: 'domain', 123: 'ntp', 179: 'bgp', 3389: '3389'
  };

  function portTok(n) {
    return PORT_BY_NUM[n] || String(n);
  }
  function scrubText(s) {
    return String(s == null ? '' : s).replace(/[\x00-\x1F\x7F]/g, ' ');
  }
  function icmpTypeName(typ) {
    if (typ === 8) return 'echo';
    if (typ === 0) return 'echo-reply';
    return String(typ);
  }

  function emit(model) {
    var L = (model.header || []).slice();
    var isGroup = {};
    (model.addresses || []).forEach(function (a) {
      if (a.parsed && a.parsed.kind === 'group') isGroup[a.name] = true;
    });
    var svcIsGroup = {};
    var svcByName = {};
    (model.services || []).forEach(function (s) {
      if (s.kind === 'group') svcIsGroup[s.name] = true;
      if (s.name) svcByName[s.name] = s;
      if (s.orig) svcByName[s.orig] = s;
    });

    (model.addresses || []).forEach(function (a) {
      var p = a.parsed || {};
      if (p.kind === 'group') {
        if (!(p.members || []).length) return;
        L.push('object-group network ' + a.name);
        (p.members || []).forEach(function (m) {
          if (isGroup[m]) L.push(' group-object ' + m);
          else L.push(' network-object object ' + m);
        });
        return;
      }
      if (!p.kind && p.ip == null && !p.fqdn) return;
      L.push('object network ' + a.name);
      if (p.kind === 'fqdn') L.push(' fqdn v4 ' + p.fqdn);
      else if (p.kind === 'range') L.push(' range ' + p.start + ' ' + p.end);
      else if (p.kind === 'subnet') L.push(' subnet ' + p.ip + ' ' + p.mask);
      else L.push(' host ' + p.ip);
    });

    function opPort(iv) {
      if (iv[0] === iv[1]) return 'eq ' + portTok(iv[0]);
      return 'range ' + iv[0] + ' ' + iv[1];
    }
    function svcLines(at) {
      var p = at.proto[0];
      if (p === 1) {
        var ivs = at.dport && at.dport.length ? at.dport : [[0, 65535]];
        var out = [];
        ivs.forEach(function (d) {
          var t0 = Math.floor((d && d[0] != null) ? d[0] / 256 : 0);
          var t1 = Math.floor((d && d[1] != null) ? d[1] / 256 : 255);
          if (!d || (d[0] === 0 && d[1] === 65535)) {
            out.push(' service-object icmp');
            return;
          }
          for (var t = t0; t <= t1 && t < 256; t++) {
            var cLo = (t === t0) ? (d[0] % 256) : 0;
            var cHi = (t === t1) ? (d[1] % 256) : 255;
            if (cLo === 0 && cHi === 255) out.push(' service-object icmp ' + icmpTypeName(t));
            else if (cLo === cHi) out.push(' service-object icmp ' + t + ' ' + cLo);
            else out.push(' service-object icmp ' + icmpTypeName(t));
          }
        });
        return out;
      }
      var pname = p === 6 ? 'tcp' : p === 17 ? 'udp' : String(p);
      var dports = at.dport && at.dport.length ? at.dport : [[0, 65535]];
      var sports = at.sport && at.sport.length ? at.sport : [[0, 65535]];
      var lines = [];
      dports.forEach(function (d) {
        sports.forEach(function (s) {
          var parts = [' service-object', pname];
          if (!(s[0] === 0 && s[1] === 65535)) {
            parts.push('source');
            parts.push(opPort(s));
          }
          if (!(d[0] === 0 && d[1] === 65535)) {
            parts.push('destination');
            parts.push(opPort(d));
          }
          lines.push(parts.join(' '));
        });
      });
      return lines;
    }

    (model.services || []).forEach(function (s) {
      if (s.skip) return;
      if (s.kind === 'group') {
        if (!(s.members || []).length) return;
        L.push('object-group service ' + s.name);
        (s.members || []).forEach(function (m) {
          if (svcIsGroup[m]) L.push(' group-object ' + m);
          else L.push(' group-object ' + m);
        });
        return;
      }
      if (s.predefSet) return;
      L.push('object-group service ' + s.name);
      (s.atoms || []).forEach(function (at) {
        svcLines(at).forEach(function (ln) { L.push(ln); });
      });
    });

    var comboSeq = 0;
    var extraAddrGroups = [];
    var extraSvcGroups = [];

    function wrapAddr(names, any, v4only) {
      if (any || !names.length) return v4only ? 'any4' : 'any';
      if (names.length === 1) {
        return (isGroup[names[0]] ? 'object-group ' : 'object ') + names[0];
      }
      comboSeq++;
      var gname = 'NK_CA_' + comboSeq;
      extraAddrGroups.push({ name: gname, members: names.slice() });
      return 'object-group ' + gname;
    }

    function findSvc(sn) {
      return svcByName[sn] || null;
    }
    function icmpPre(at) {
      var d = at.dport && at.dport[0];
      if (!d || (d[0] === 0 && d[1] === 65535)) return null;
      var t0 = Math.floor(d[0] / 256);
      var t1 = Math.floor(d[1] / 256);
      if (t0 !== t1) return icmpTypeName(t0);
      return icmpTypeName(t0);
    }
    function pushMemberAtoms(s) {
      (s.atoms || []).forEach(function (at) {
        svcLines(at).forEach(function (ln) { L.push(ln); });
      });
    }
    function wrapSvc(r) {
      if (r.svcAny || !(r.svcNames || []).length) return { svcPart: 'ip', pre: null };
      var names = r.svcNames;
      if (names.length === 1) {
        var sn = names[0];
        var svcObj = findSvc(sn);
        if (svcObj && svcObj.skip && typeof svcObj.predef === 'string' && svcObj.predef !== 'ip') {
          var atoms = svcObj.atoms || [];
          if (svcObj.predef === 'icmp' || (atoms[0] && atoms[0].proto[0] === 1 && atoms.length === 1 && (!atoms[0].dport || (atoms[0].dport[0] && atoms[0].dport[0][0] === 0 && atoms[0].dport[0][1] === 65535)))) {
            return { svcPart: 'icmp', pre: null };
          }
          if (atoms[0] && atoms[0].proto[0] === 1) {
            return { svcPart: 'icmp', pre: icmpPre(atoms[0]) };
          }
          var protos = {};
          atoms.forEach(function (at) { protos[at.proto[0]] = true; });
          if (Object.keys(protos).length > 1) {
            comboSeq++;
            var gname = 'NK_CS_' + comboSeq;
            extraSvcGroups.push({ name: gname, members: [sn] });
            return { svcPart: 'object-group ' + gname, pre: null };
          }
          var proto = 'tcp';
          if (atoms[0] && atoms[0].proto[0] === 17) proto = 'udp';
          return { svcPart: proto, pre: 'eq ' + svcObj.predef };
        }
        return { svcPart: 'object-group ' + sn, pre: null };
      }
      comboSeq++;
      var gname = 'NK_CS_' + comboSeq;
      extraSvcGroups.push({ name: gname, members: names.slice() });
      return { svcPart: 'object-group ' + gname, pre: null };
    }

    var acls = Object.create(null);
    var aclOrder = [];
    var prepared = [];
    (model.rules || []).forEach(function (r) {
      if (!r.emit) return;
      var acl = r.acl || 'global_access';
      if (!acls[acl]) {
        acls[acl] = { name: acl, dir: r.aclDir, iface: r.aclIface, rules: [] };
        aclOrder.push(acl);
      }
      acls[acl].rules.push(r);
      prepared.push({
        r: r,
        acl: acl,
        src: wrapAddr(r.srcNames, r.srcAny, r.srcV4Only),
        dst: wrapAddr(r.dstNames, r.dstAny, r.dstV4Only),
        svc: wrapSvc(r)
      });
    });

    extraAddrGroups.forEach(function (g) {
      L.push('object-group network ' + g.name);
      g.members.forEach(function (m) {
        if (isGroup[m]) L.push(' group-object ' + m);
        else L.push(' network-object object ' + m);
      });
    });
    extraSvcGroups.forEach(function (g) {
      L.push('object-group service ' + g.name);
      g.members.forEach(function (m) {
        var s = findSvc(m);
        if (s && s.skip) pushMemberAtoms(s);
        else L.push(' group-object ' + m);
      });
    });

    function prepOf(r) {
      for (var i = 0; i < prepared.length; i++) if (prepared[i].r === r) return prepared[i];
      return { src: 'any', dst: 'any', svc: { svcPart: 'ip', pre: null } };
    }
    aclOrder.forEach(function (acl) {
      var rec = acls[acl];
      rec.rules.forEach(function (r) {
        var pr = prepOf(r);
        var remarks = [];
        var label = r.name || '';
        if (r.comment) label = label ? (label + ' | ' + r.comment) : r.comment;
        var rest = scrubText(label);
        while (rest.length) {
          remarks.push(rest.slice(0, 100));
          rest = rest.slice(100);
        }
        if (!remarks.length && r.name) remarks.push(scrubText(String(r.name)).slice(0, 100));
        remarks.forEach(function (rm) {
          L.push('access-list ' + acl + ' remark ' + rm);
        });
        var act = r.action === 'permit' ? 'permit' : 'deny';
        var line = 'access-list ' + acl + ' extended ' + act + ' ' + pr.svc.svcPart + ' ' + pr.src + ' ' + pr.dst;
        if (pr.svc.pre) line += ' ' + pr.svc.pre;
        if (r.log) line += ' log';
        if (r.disabled) line += ' inactive';
        L.push(line);
      });
    });

    (model.rules || []).forEach(function (r) {
      if (r.emit) return;
      L.push('! not translated: ' + (r.origName || r.origId || r.name));
    });

    var seenAg = Object.create(null);
    aclOrder.forEach(function (acl) {
      var rec = acls[acl];
      if (seenAg[acl]) return;
      seenAg[acl] = true;
      if (rec.dir === 'global' || !rec.iface) L.push('access-group ' + acl + ' global');
      else L.push('access-group ' + acl + ' ' + (rec.dir || 'in') + ' interface ' + rec.iface);
    });
    return L.join('\n');
  }

  var api = {
    vendor: 'asa',
    // ponytail: per-release limits vary — adjust table
    limits: {
      object: 64, rule: 64, comment: 100,
      charset: /[A-Za-z0-9._-]/,
      first: /[A-Za-z0-9._-]/
    },
    caps: { negateAddr: false, negateSvc: false, reject: false, nonPortSvc: true },
    emit: emit
  };
  root.FwEmitters = root.FwEmitters || {};
  root.FwEmitters.asa = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
