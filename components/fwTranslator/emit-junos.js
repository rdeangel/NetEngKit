/* ──────────────────────────────────────────────────────────────────────
 * emit-junos.js — Junos set-form migration-draft emitter (load set terminal).
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  function scrubText(s) {
    return String(s == null ? '' : s).replace(/[\x00-\x1F\x7F]/g, ' ');
  }
  function qn(s) {
    s = scrubText(s);
    if (/[\s"]/.test(s)) return '"' + s.replace(/"/g, '') + '"';
    return s;
  }
  function qd(s) { return '"' + scrubText(s).replace(/"/g, '') + '"'; }

  function emit(model) {
    var L = (model.header || []).slice();
    (model.zones || []).forEach(function (z) {
      (z.ifaces || []).forEach(function (ifc) {
        L.push('set security zones security-zone ' + qn(z.name) + ' interfaces ' + ifc);
      });
    });
    (model.addresses || []).forEach(function (a) {
      var p = a.parsed || {};
      if (p.kind === 'group') {
        (p.members || []).forEach(function (m) {
          var isSet = (model.addresses || []).some(function (o) {
            return o.name === m && o.parsed && o.parsed.kind === 'group';
          });
          L.push('set security address-book global address-set ' + qn(a.name) + (isSet ? ' address-set ' : ' address ') + qn(m));
        });
        return;
      }
      if (p.kind === 'fqdn') {
        L.push('set security address-book global address ' + qn(a.name) + ' dns-name ' + p.fqdn);
      } else if (p.kind === 'range') {
        L.push('set security address-book global address ' + qn(a.name) + ' range-address ' + p.start + ' to ' + p.end);
      } else if (p.kind === 'subnet') {
        L.push('set security address-book global address ' + qn(a.name) + ' ' + p.ip + '/' + p.prefix);
      } else {
        L.push('set security address-book global address ' + qn(a.name) + ' ' + (p.ip || '0.0.0.0') + '/32');
      }
    });

    (model.services || []).forEach(function (s) {
      if (s.skip) return;
      if (s.predefSet && s.predefSet.length) {
        s.predefSet.forEach(function (m) {
          L.push('set applications application-set ' + qn(s.name) + ' application ' + m);
        });
        return;
      }
      if (s.kind === 'group') {
        (s.members || []).forEach(function (m) {
          L.push('set applications application-set ' + qn(s.name) + ' application ' + qn(m));
        });
        return;
      }
      function expandIcmpAtoms(atoms) {
        var out = [];
        (atoms || []).forEach(function (at) {
          if (at.proto[0] !== 1) { out.push(at); return; }
          var ivs = at.dport && at.dport.length ? at.dport : [[0, 65535]];
          var any = ivs.length === 1 && ivs[0][0] === 0 && ivs[0][1] === 65535;
          if (any) { out.push(at); return; }
          ivs.forEach(function (d) {
            var t0 = Math.floor(d[0] / 256), t1 = Math.floor(d[1] / 256);
            for (var t = t0; t <= t1 && t < 256; t++) {
              var cLo = (t === t0) ? (d[0] % 256) : 0;
              var cHi = (t === t1) ? (d[1] % 256) : 255;
              var dport = (cLo === 0 && cHi === 255)
                ? [[t * 256, t * 256 + 255]]
                : [[t * 256 + cLo, t * 256 + cHi]];
              out.push({ proto: [1, 1], sport: at.sport, dport: dport });
            }
          });
        });
        return out;
      }
      var atoms = expandIcmpAtoms(s.atoms || []);
      function emitAtom(at, term) {
        var pfx = 'set applications application ' + qn(s.name) + (term != null ? ' term t' + term : '') + ' ';
        var p = at.proto[0];
        var pname = p === 6 ? 'tcp' : p === 17 ? 'udp' : p === 1 ? 'icmp' : p === 132 ? 'sctp' : String(p);
        L.push(pfx + 'protocol ' + pname);
        if (p === 1) {
          var d = at.dport && at.dport[0];
          if (d && !(d[0] === 0 && d[1] === 65535)) {
            L.push(pfx + 'icmp-type ' + Math.floor(d[0] / 256));
            if (d[0] === d[1]) L.push(pfx + 'icmp-code ' + (d[0] % 256));
            else if ((d[1] - d[0]) < 255 && (d[0] % 256) === (d[1] % 256)) {
              L.push(pfx + 'icmp-code ' + (d[0] % 256));
            }
          }
          return;
        }
        if (at.dport && !(at.dport.length === 1 && at.dport[0][0] === 0 && at.dport[0][1] === 65535)) {
          at.dport.forEach(function (iv) {
            L.push(pfx + 'destination-port ' + (iv[0] === iv[1] ? iv[0] : iv[0] + '-' + iv[1]));
          });
        }
        if (at.sport && !(at.sport.length === 1 && at.sport[0][0] === 0 && at.sport[0][1] === 65535)) {
          at.sport.forEach(function (iv) {
            L.push(pfx + 'source-port ' + (iv[0] === iv[1] ? iv[0] : iv[0] + '-' + iv[1]));
          });
        }
      }
      if (atoms.length > 1) atoms.forEach(function (at, i) { emitAtom(at, i); });
      else if (atoms.length === 1) emitAtom(atoms[0], null);
    });

    function anyName(v4only) { return v4only ? 'any-ipv4' : 'any'; }

    (model.rules || []).forEach(function (r) {
      if (!r.emit) {
        L.push('# not translated: ' + (r.origName || r.origId || r.name));
        return;
      }
      var ctx;
      if (r.srxGlobal || !r.from.length || !r.to.length) {
        ctx = 'set security policies global policy ' + qn(r.name) + ' ';
      } else {
        ctx = 'set security policies from-zone ' + qn(r.from[0]) + ' to-zone ' + qn(r.to[0]) + ' policy ' + qn(r.name) + ' ';
      }
      var src = r.srcAny ? [anyName(r.srcV4Only)] : (r.srcNames.length ? r.srcNames : [anyName(r.srcV4Only)]);
      var dst = r.dstAny ? [anyName(r.dstV4Only)] : (r.dstNames.length ? r.dstNames : [anyName(r.dstV4Only)]);
      var svc;
      if (r.svcAny) svc = ['any'];
      else if (r.svcNames.length) svc = r.svcNames;
      else svc = ['any'];
      src.forEach(function (n) { L.push(ctx + 'match source-address ' + qn(n)); });
      dst.forEach(function (n) { L.push(ctx + 'match destination-address ' + qn(n)); });
      svc.forEach(function (n) { L.push(ctx + 'match application ' + qn(n)); });
      if (r.srxGlobal) {
        (r.srxFrom || r.from || []).forEach(function (z) { L.push(ctx + 'match from-zone ' + qn(z)); });
        (r.srxTo || r.to || []).forEach(function (z) { L.push(ctx + 'match to-zone ' + qn(z)); });
      }
      if (r.negateSrc) L.push(ctx + 'match source-address-excluded');
      if (r.negateDst) L.push(ctx + 'match destination-address-excluded');
      var then = r.action === 'permit' ? 'permit' : (r.action === 'reject' ? 'reject' : 'deny');
      L.push(ctx + 'then ' + then);
      if (r.log) {
        L.push(ctx + 'then log session-close');
        if (then !== 'permit') L.push(ctx + 'then log session-init');
      }
      if (r.comment) L.push(ctx + 'description ' + qd(r.comment));
      if (r.disabled) {
        if (r.srxGlobal || !r.from.length || !r.to.length) {
          L.push('deactivate security policies global policy ' + qn(r.name));
        } else {
          L.push('deactivate security policies from-zone ' + qn(r.from[0]) + ' to-zone ' + qn(r.to[0]) + ' policy ' + qn(r.name));
        }
      }
    });
    return L.join('\n');
  }

  var api = {
    vendor: 'junos',
    // ponytail: per-release limits vary — adjust table
    limits: {
      object: 63, rule: 63, comment: 900,
      charset: /[A-Za-z0-9._:/-]/,
      first: /[A-Za-z0-9]/
    },
    caps: { negateAddr: true, negateSvc: false, reject: true, nonPortSvc: true },
    emit: emit
  };
  root.FwEmitters = root.FwEmitters || {};
  root.FwEmitters.junos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
