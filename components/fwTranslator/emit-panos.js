/* ──────────────────────────────────────────────────────────────────────
 * emit-panos.js — PAN-OS set-form migration-draft emitter.
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
  function list(arr) {
    arr = arr || [];
    if (arr.length === 1) return qn(arr[0]);
    return '[ ' + arr.map(qn).join(' ') + ' ]';
  }

  function portStr(ivs) {
    return (ivs || []).map(function (iv) {
      return iv[0] === iv[1] ? String(iv[0]) : iv[0] + '-' + iv[1];
    }).join(',');
  }

  function emit(model) {
    var L = [];
    (model.zones || []).forEach(function (z) {
      if (z.ifaces && z.ifaces.length) {
        L.push('set zone ' + qn(z.name) + ' network layer3 ' + list(z.ifaces));
      } else {
        L.push('set zone ' + qn(z.name) + ' network layer3');
      }
    });
    (model.addresses || []).forEach(function (a) {
      var p = a.parsed || {};
      if (p.kind === 'group') {
        var mems = p.members || [];
        if (mems.length) L.push('set address-group ' + qn(a.name) + ' static ' + list(mems));
        return;
      }
      if (p.kind === 'fqdn') L.push('set address ' + qn(a.name) + ' fqdn ' + p.fqdn);
      else if (p.kind === 'range') L.push('set address ' + qn(a.name) + ' ip-range ' + p.start + '-' + p.end);
      else if (p.kind === 'subnet') L.push('set address ' + qn(a.name) + ' ip-netmask ' + p.ip + '/' + p.prefix);
      else L.push('set address ' + qn(a.name) + ' ip-netmask ' + (p.ip || '0.0.0.0') + '/32');
    });
    var usedSvcEmit = Object.create(null);
    (model.services || []).forEach(function (x) {
      if (x.name) usedSvcEmit[x.name] = true;
      if (x.orig) usedSvcEmit[x.orig] = true;
    });
    (model.services || []).forEach(function (s) {
      if (s.skip) return;
      if (s.kind === 'group') {
        if (s.members && s.members.length) L.push('set service-group ' + qn(s.name) + ' members ' + list(s.members));
        return;
      }
      var buckets = Object.create(null);
      var order = [];
      (s.atoms || []).forEach(function (at) {
        var p = at.proto[0];
        var key = p === 6 ? 'tcp' : p === 17 ? 'udp' : p === 132 ? 'sctp' : null;
        if (!key) return;
        var sp = '';
        if (at.sport && !(at.sport.length === 1 && at.sport[0][0] === 0 && at.sport[0][1] === 65535)) {
          sp = portStr(at.sport);
        }
        var bk = key + '\0' + sp;
        if (!buckets[bk]) {
          buckets[bk] = { proto: key, sport: sp, dest: [] };
          order.push(bk);
        }
        var ds = portStr(at.dport);
        if (ds) buckets[bk].dest.push(ds);
      });
      var live = order.filter(function (bk) { return buckets[bk].dest.length; });
      function svcLine(name, b) {
        var line = 'set service ' + qn(name) + ' protocol ' + b.proto + ' port ' + b.dest.join(',');
        if (b.sport) line += ' source-port ' + b.sport;
        return line;
      }
      if (live.length > 1) {
        var members = [];
        live.forEach(function (bk) {
          var b = buckets[bk];
          var suffix = b.proto + (b.sport ? '-sp' + String(b.sport).replace(/[^A-Za-z0-9._-]/g, '_') : '');
          var sub = s.name + '-' + suffix;
          var n = 2;
          var candidate = sub;
          while (usedSvcEmit[candidate]) {
            candidate = sub + '_' + n;
            n++;
          }
          usedSvcEmit[candidate] = true;
          L.push(svcLine(candidate, b));
          members.push(candidate);
        });
        if (members.length) L.push('set service-group ' + qn(s.name) + ' members ' + list(members));
        return;
      }
      if (live.length === 1) L.push(svcLine(s.name, buckets[live[0]]));
    });

    (model.rules || []).forEach(function (r) {
      if (!r.emit) return;
      var n = qn(r.name);
      var pfx = 'set rulebase security rules ' + n + ' ';
      L.push(pfx + 'from ' + list(r.from.length ? r.from : ['any']));
      L.push(pfx + 'to ' + list(r.to.length ? r.to : ['any']));
      L.push(pfx + 'source ' + list(r.srcAny ? ['any'] : (r.srcNames.length ? r.srcNames : ['any'])));
      L.push(pfx + 'destination ' + list(r.dstAny ? ['any'] : (r.dstNames.length ? r.dstNames : ['any'])));
      if (r.panAppDefault && r.panApps && r.panApps.length) {
        L.push(pfx + 'application ' + list(r.panApps));
        L.push(pfx + 'service application-default');
      } else {
        L.push(pfx + 'application any');
        L.push(pfx + 'service ' + list(r.svcAny ? ['any'] : (r.svcNames.length ? r.svcNames : ['any'])));
      }
      var act = r.action === 'permit' ? 'allow' : (r.action === 'reject' ? 'reset-both' : 'deny');
      L.push(pfx + 'action ' + act);
      L.push(pfx + 'log-end ' + (r.log ? 'yes' : 'no'));
      if (r.disabled) L.push(pfx + 'disabled yes');
      if (r.negateSrc) L.push(pfx + 'negate-source yes');
      if (r.negateDst) L.push(pfx + 'negate-destination yes');
      if (r.comment) L.push(pfx + 'description ' + qd(r.comment));
    });
    return L.join('\n');
  }

  var api = {
    vendor: 'panos',
    // ponytail: per-release limits vary — adjust table
    limits: {
      object: 63, rule: 63, comment: 1024,
      charset: /[A-Za-z0-9 ._-]/,
      first: /[A-Za-z0-9_]/
    },
    caps: { negateAddr: true, negateSvc: false, reject: true, nonPortSvc: false },
    emit: emit
  };
  root.FwEmitters = root.FwEmitters || {};
  root.FwEmitters.panos = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
