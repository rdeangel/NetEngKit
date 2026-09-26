/* ──────────────────────────────────────────────────────────────────────
 * emit-fortios.js — FortiOS migration-draft emitter.
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  function scrubText(s) {
    return String(s == null ? '' : s).replace(/[\x00-\x1F\x7F]/g, ' ');
  }
  function q(s) { return '"' + scrubText(s).replace(/"/g, '') + '"'; }

  function ivStr(iv) {
    if (iv[0] === 0 && iv[1] === 65535) return '1-65535';
    return iv[0] === iv[1] ? String(iv[0]) : iv[0] + '-' + iv[1];
  }
  function portItems(dport, sport) {
    var dests = (dport && dport.length) ? dport : [[0, 65535]];
    var anySport = !sport || !sport.length || (sport.length === 1 && sport[0][0] === 0 && sport[0][1] === 65535);
    var srcs = anySport ? [null] : sport;
    var out = [];
    dests.forEach(function (d) {
      srcs.forEach(function (s) {
        out.push(ivStr(d) + (s ? ':' + ivStr(s) : ''));
      });
    });
    return out;
  }

  function emit(model) {
    var L = (model.header || []).slice();
    if ((model.zones || []).length) {
      L.push('config system zone');
      model.zones.forEach(function (z) {
        L.push('    edit ' + q(z.name));
        if (z.ifaces && z.ifaces.length) L.push('        set interface ' + z.ifaces.map(q).join(' '));
        L.push('    next');
      });
      L.push('end');
    }
    var addrs = (model.addresses || []).filter(function (a) { return !(a.parsed && a.parsed.kind === 'group'); });
    var grps = (model.addresses || []).filter(function (a) { return a.parsed && a.parsed.kind === 'group'; });
    if (addrs.length) {
      L.push('config firewall address');
      addrs.forEach(function (a) {
        var p = a.parsed || {};
        L.push('    edit ' + q(a.name));
        if (p.kind === 'fqdn') {
          L.push('        set type fqdn');
          L.push('        set fqdn ' + q(p.fqdn));
        } else if (p.kind === 'range') {
          L.push('        set type iprange');
          L.push('        set start-ip ' + p.start);
          L.push('        set end-ip ' + p.end);
        } else if (p.kind === 'subnet') {
          L.push('        set subnet ' + p.ip + ' ' + p.mask);
        } else {
          L.push('        set subnet ' + (p.ip || '0.0.0.0') + ' 255.255.255.255');
        }
        L.push('    next');
      });
      L.push('end');
    }
    if (grps.length) {
      L.push('config firewall addrgrp');
      grps.forEach(function (g) {
        var p = g.parsed || {};
        L.push('    edit ' + q(g.name));
        var mems = p.members || [];
        if (mems.length) L.push('        set member ' + mems.map(q).join(' '));
        if (p.exclude && p.exclude.length) {
          L.push('        set exclude enable');
          L.push('        set exclude-member ' + p.exclude.map(q).join(' '));
        }
        L.push('    next');
      });
      L.push('end');
    }

    var svcs = (model.services || []).filter(function (s) { return s.kind !== 'group' && !s.skip; });
    var sgrps = (model.services || []).filter(function (s) { return s.kind === 'group'; });
    if (svcs.length) {
      L.push('config firewall service custom');
      svcs.forEach(function (s) {
        L.push('    edit ' + q(s.name));
        var tcp = [], udp = [], sctp = [];
        var icmps = [], ipns = [];
        (s.atoms || []).forEach(function (at) {
          var p = at.proto[0];
          if (p === 6) Array.prototype.push.apply(tcp, portItems(at.dport, at.sport));
          else if (p === 17) Array.prototype.push.apply(udp, portItems(at.dport, at.sport));
          else if (p === 132) Array.prototype.push.apply(sctp, portItems(at.dport, at.sport));
          else if (p === 1) {
            var d = at.dport && at.dport[0];
            if (d && !(d[0] === 0 && d[1] === 65535)) {
              var t0 = Math.floor(d[0] / 256), t1 = Math.floor(d[1] / 256);
              for (var t = t0; t <= t1 && t < 256; t++) {
                var cLo = (t === t0) ? (d[0] % 256) : 0;
                var cHi = (t === t1) ? (d[1] % 256) : 255;
                icmps.push({ type: t, code: (cLo === cHi) ? cLo : null });
              }
            } else icmps.push({ type: null, code: null });
          } else if (ipns.indexOf(p) < 0) ipns.push(p);
        });
        var l4 = tcp.length || udp.length || sctp.length;
        if (tcp.length) L.push('        set tcp-portrange ' + tcp.join(' '));
        if (udp.length) L.push('        set udp-portrange ' + udp.join(' '));
        if (sctp.length) L.push('        set sctp-portrange ' + sctp.join(' '));
        if (!l4 && icmps.length === 1 && !ipns.length) {
          L.push('        set protocol ICMP');
          if (icmps[0].type != null) L.push('        set icmptype ' + icmps[0].type);
          if (icmps[0].code != null) L.push('        set icmpcode ' + icmps[0].code);
        } else if (!l4 && !icmps.length && ipns.length === 1) {
          L.push('        set protocol IP');
          L.push('        set protocol-number ' + ipns[0]);
        }
        L.push('    next');
      });
      L.push('end');
    }
    if (sgrps.length) {
      L.push('config firewall service group');
      sgrps.forEach(function (g) {
        L.push('    edit ' + q(g.name));
        if (g.members && g.members.length) L.push('        set member ' + g.members.map(q).join(' '));
        L.push('    next');
      });
      L.push('end');
    }

    var rules = (model.rules || []).filter(function (r) { return r.emit; });
    var placeholders = (model.rules || []).filter(function (r) { return !r.emit; });
    placeholders.forEach(function (r) {
      L.push('# not translated: ' + (r.origName || r.origId || r.name));
    });
    if (rules.length) {
      L.push('config firewall policy');
      rules.forEach(function (r, i) {
        L.push('    edit ' + (i + 1));
        var nm = String(r.name || '').slice(0, 35);
        if (nm) L.push('        set name ' + q(nm));
        var si = (r.from && r.from.length) ? r.from : ['any'];
        var di = (r.to && r.to.length) ? r.to : ['any'];
        L.push('        set srcintf ' + si.map(q).join(' '));
        L.push('        set dstintf ' + di.map(q).join(' '));
        var sa = r.srcAny ? ['all'] : (r.srcNames.length ? r.srcNames : ['all']);
        var da = r.dstAny ? ['all'] : (r.dstNames.length ? r.dstNames : ['all']);
        L.push('        set srcaddr ' + sa.map(q).join(' '));
        L.push('        set dstaddr ' + da.map(q).join(' '));
        L.push('        set action ' + (r.action === 'permit' ? 'accept' : 'deny'));
        L.push('        set schedule "always"');
        var sv = r.svcAny ? ['ALL'] : (r.svcNames.length ? r.svcNames : ['ALL']);
        L.push('        set service ' + sv.map(q).join(' '));
        L.push('        set logtraffic ' + (r.log ? 'all' : 'disable'));
        if (r.comment) L.push('        set comments ' + q(r.comment));
        if (r.disabled) L.push('        set status disable');
        if (r.negateSrc) L.push('        set srcaddr-negate enable');
        if (r.negateDst) L.push('        set dstaddr-negate enable');
        if (r.negateSvc) L.push('        set service-negate enable');
        if (r.sendDenyPacket) L.push('        set send-deny-packet enable');
        L.push('    next');
      });
      L.push('end');
    }
    return L.join('\n');
  }

  var api = {
    vendor: 'fortios',
    // ponytail: per-release limits vary — adjust table
    limits: {
      object: 79, rule: 35, comment: 1023,
      charset: /[^"\\\x00-\x1F]/,
      first: /[^"\\\x00-\x1F]/
    },
    caps: { negateAddr: true, negateSvc: true, reject: true, nonPortSvc: true },
    emit: emit
  };
  root.FwEmitters = root.FwEmitters || {};
  root.FwEmitters.fortios = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
