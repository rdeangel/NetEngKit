/* ──────────────────────────────────────────────────────────────────────
 * analyzer.js — shadow / duplicate / contradiction / merge / any-wide.
 *
 * ponytail: O(n²) over rules in a scope with 7-D box subtraction; maxBoxes
 * bounds pathological cartesian products. Rules are compared only within
 * their own scope — no reasoning across SRX zone-pair vs global, or
 * iptables jumps between chains. Adjacent-only merges; non-adjacent would
 * need an intermediate-rule independence proof.
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  var IR = (typeof module !== 'undefined' && module.exports) ? require('./fwIR.js') : root.FwIR;

  var DIMS = ['src', 'dst', 'inIf', 'outIf', 'proto', 'sport', 'dport'];
  var DEFAULT_MAX_BOXES = 20000;

  function copyBox(b) {
    var o = {};
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      o[d] = [b[d][0], b[d][1]];
    }
    return o;
  }

  function boxEmpty(b) {
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      if (b[d][0] > b[d][1]) return true;
    }
    return false;
  }

  function boxesIntersect(a, b) {
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      var lo = a[d][0] > b[d][0] ? a[d][0] : b[d][0];
      var hi = a[d][1] < b[d][1] ? a[d][1] : b[d][1];
      if (lo > hi) return false;
    }
    return true;
  }

  function boxContains(a, b) {
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      if (a[d][0] > b[d][0] || a[d][1] < b[d][1]) return false;
    }
    return true;
  }

  function boxEqual(a, b) {
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      if (a[d][0] !== b[d][0] || a[d][1] !== b[d][1]) return false;
    }
    return true;
  }

  // A − B → leftover boxes (≤ 2 per dimension).
  function subtractBox(a, b) {
    if (!boxesIntersect(a, b)) return [copyBox(a)];
    if (boxContains(b, a)) return [];
    var out = [];
    var rem = copyBox(a);
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      var alo = rem[d][0], ahi = rem[d][1];
      var blo = b[d][0], bhi = b[d][1];
      if (alo < blo) {
        var left = copyBox(rem);
        left[d] = [alo, blo - 1];
        if (!boxEmpty(left)) out.push(left);
        rem[d][0] = blo;
      }
      if (ahi > bhi) {
        var right = copyBox(rem);
        right[d] = [bhi + 1, ahi];
        if (!boxEmpty(right)) out.push(right);
        rem[d][1] = bhi;
      }
      if (rem[d][0] > rem[d][1]) return out;
    }
    return out;
  }

  function subtractBoxes(residual, cutters) {
    var cur = residual;
    for (var c = 0; c < cutters.length; c++) {
      var next = [];
      for (var i = 0; i < cur.length; i++) {
        var parts = subtractBox(cur[i], cutters[c]);
        for (var j = 0; j < parts.length; j++) next.push(parts[j]);
      }
      cur = next;
      if (!cur.length) return cur;
    }
    return cur;
  }

  function logVolume(boxes) {
    var sum = 0;
    for (var i = 0; i < boxes.length; i++) {
      var lv = 0;
      var empty = false;
      for (var d = 0; d < DIMS.length; d++) {
        var dim = DIMS[d];
        var span = boxes[i][dim][1] - boxes[i][dim][0] + 1;
        if (span <= 0) { empty = true; break; }
        lv += Math.log(span);
      }
      if (!empty) sum += Math.exp(lv - 20); // offset to keep numbers reasonable
    }
    return sum;
  }

  function hullsDisjoint(ha, hb) {
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      if (!ha[d] || !hb[d]) return true;
      if (ha[d][0] > hb[d][1] || hb[d][0] > ha[d][1]) return true;
    }
    return false;
  }

  function hullContains(ha, hb) {
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      if (!ha[d] || !hb[d]) return false;
      if (ha[d][0] > hb[d][0] || ha[d][1] < hb[d][1]) return false;
    }
    return true;
  }

  function computeHull(boxes) {
    if (!boxes.length) return null;
    var h = {};
    for (var i = 0; i < DIMS.length; i++) {
      var d = DIMS[i];
      h[d] = [boxes[0][d][0], boxes[0][d][1]];
    }
    for (var b = 1; b < boxes.length; b++) {
      for (var j = 0; j < DIMS.length; j++) {
        var dim = DIMS[j];
        if (boxes[b][dim][0] < h[dim][0]) h[dim][0] = boxes[b][dim][0];
        if (boxes[b][dim][1] > h[dim][1]) h[dim][1] = boxes[b][dim][1];
      }
    }
    return h;
  }

  function ifaceIdMap(rules) {
    var names = [];
    var seen = Object.create(null);
    function add(list) {
      list = list || [];
      for (var i = 0; i < list.length; i++) {
        var n = String(list[i]);
        var low = n.toLowerCase();
        if (low === 'any' || low === '' || low === '*') continue;
        if (seen[n]) continue;
        seen[n] = true;
        names.push(n);
      }
    }
    for (var r = 0; r < rules.length; r++) {
      add(rules[r].srcIntf);
      add(rules[r].dstIntf);
    }
    var map = Object.create(null);
    for (var i = 0; i < names.length; i++) map[names[i]] = i + 1;
    return { map: map, n: names.length, names: names };
  }

  function ifaceIntervals(list, imap) {
    list = list || [];
    if (!list.length) return [[0, imap.n + 1]];
    var ivs = [];
    var hasAny = false;
    for (var i = 0; i < list.length; i++) {
      var n = String(list[i]);
      var low = n.toLowerCase();
      if (low === 'any' || low === '' || low === '*') { hasAny = true; continue; }
      var id = imap.map[n];
      if (id) ivs.push([id, id]);
    }
    if (hasAny || !ivs.length && !list.length) return [[0, imap.n + 1]];
    if (hasAny) return [[0, imap.n + 1]];
    return IR.mergeIntervals(ivs);
  }

  function expandRuleBoxes(rule, imap, maxBoxes) {
    var srcI = IR.mergeIntervals((rule.src && rule.src.v4) || []);
    var dstI = IR.mergeIntervals((rule.dst && rule.dst.v4) || []);
    if (!srcI.length || !dstI.length) return { boxes: [], over: false };
    var inI = ifaceIntervals(rule.srcIntf, imap);
    var outI = ifaceIntervals(rule.dstIntf, imap);
    var atoms = rule.svc && rule.svc.length ? rule.svc : [];
    if (!atoms.length) return { boxes: [], over: false };
    var count = srcI.length * dstI.length * inI.length * outI.length;
    var svcCount = 0;
    for (var a = 0; a < atoms.length; a++) {
      svcCount += (atoms[a].sport.length || 1) * (atoms[a].dport.length || 1);
    }
    count *= svcCount;
    if (count > maxBoxes) return { boxes: [], over: true };

    var boxes = [];
    for (var s = 0; s < srcI.length; s++) {
      for (var d = 0; d < dstI.length; d++) {
        for (var ii = 0; ii < inI.length; ii++) {
          for (var oi = 0; oi < outI.length; oi++) {
            for (var at = 0; at < atoms.length; at++) {
              var atom = atoms[at];
              var proto = atom.proto;
              var sports = atom.sport.length ? atom.sport : [[0, 65535]];
              var dports = atom.dport.length ? atom.dport : [[0, 65535]];
              for (var sp = 0; sp < sports.length; sp++) {
                for (var dp = 0; dp < dports.length; dp++) {
                  boxes.push({
                    src: [srcI[s][0], srcI[s][1]],
                    dst: [dstI[d][0], dstI[d][1]],
                    inIf: [inI[ii][0], inI[ii][1]],
                    outIf: [outI[oi][0], outI[oi][1]],
                    proto: [proto[0], proto[1]],
                    sport: [sports[sp][0], sports[sp][1]],
                    dport: [dports[dp][0], dports[dp][1]]
                  });
                  if (boxes.length > maxBoxes) return { boxes: [], over: true };
                }
              }
            }
          }
        }
      }
    }
    return { boxes: boxes, over: false };
  }

  function boxesEqualSet(a, b) {
    if (a.length !== b.length) {
      // mutual containment is the real test; length is a fast reject only
    }
    return coversBoxes(a, b) && coversBoxes(b, a);
  }

  function coversBoxes(aBoxes, bBoxes) {
    if (!bBoxes.length) return true;
    if (!aBoxes.length) return false;
    var ha = computeHull(aBoxes);
    var hb = computeHull(bBoxes);
    if (!hullContains(ha, hb)) return false;
    var residual = subtractBoxes(bBoxes, aBoxes);
    return residual.length === 0;
  }

  function pairLabel(rule) {
    var s = (rule.srcIntf || []).join(',');
    var d = (rule.dstIntf || []).join(',');
    if (!s && !d) return '';
    return (s || 'any') + '→' + (d || 'any');
  }

  function cite(rule) {
    return { uid: rule.uid, id: rule.id, lines: rule.lines.slice(), action: rule.action };
  }

  function citeRule(rule) {
    return { uid: rule.uid, id: rule.id, lines: rule.lines.slice() };
  }

  function isEligible(rule) {
    return !rule.disabled && (!rule.unsupported || !rule.unsupported.length) && rule.terminal && IR.actionClass(rule.action);
  }

  function minimizeCover(residual0, contributorIdx, boxesOf, maxBoxes) {
    // Walk contributors in reverse; drop one if coverage still holds without it.
    var by = contributorIdx.slice();
    if (by.length > 8) return by;
    for (var i = by.length - 1; i >= 0; i--) {
      var trial = by.slice(0, i).concat(by.slice(i + 1));
      var cutters = [];
      for (var t = 0; t < trial.length; t++) {
        var bx = boxesOf[trial[t]];
        for (var k = 0; k < bx.length; k++) cutters.push(bx[k]);
      }
      var rem = subtractBoxes(residual0, cutters);
      if (rem.length === 0) by.splice(i, 1);
    }
    return by;
  }

  function intfSetsEqual(a, b) {
    function norm(list) {
      list = (list || []).slice().map(String);
      if (!list.length) return ['*ANY*'];
      var hasAny = list.some(function (x) { return String(x).toLowerCase() === 'any'; });
      if (hasAny) return ['*ANY*'];
      return list.slice().sort();
    }
    var na = norm(a), nb = norm(b);
    if (na.length !== nb.length) return false;
    for (var i = 0; i < na.length; i++) if (na[i] !== nb[i]) return false;
    return true;
  }

  function analyze(policy, opts) {
    opts = opts || {};
    var maxBoxes = opts.maxBoxes != null ? opts.maxBoxes : DEFAULT_MAX_BOXES;
    var findings = [];
    var perRule = {};
    var cleanup = { perScope: [] };

    var byScope = Object.create(null);
    var scopeOrder = [];
    for (var i = 0; i < policy.scopes.length; i++) {
      byScope[policy.scopes[i].key] = [];
      scopeOrder.push(policy.scopes[i].key);
    }
    for (var r = 0; r < policy.rules.length; r++) {
      var rule = policy.rules[r];
      if (!byScope[rule.scopeKey]) {
        byScope[rule.scopeKey] = [];
        scopeOrder.push(rule.scopeKey);
      }
      byScope[rule.scopeKey].push(rule);
      perRule[rule.uid] = {
        id: rule.id,
        ineligible: !isEligible(rule),
        disabled: !!rule.disabled,
        unsupported: (rule.unsupported || []).slice(),
        findings: []
      };
    }

    function addFinding(f) {
      findings.push(f);
      if (perRule[f.rule.uid]) perRule[f.rule.uid].findings.push(f);
    }

    for (var s = 0; s < scopeOrder.length; s++) {
      var key = scopeOrder[s];
      var rules = byScope[key] || [];
      rules.sort(function (a, b) { return a.order - b.order; });
      var imap = ifaceIdMap(rules);
      var boxesOf = [];
      var hullOf = [];
      var over = [];
      var eligible = [];

      for (var ri = 0; ri < rules.length; ri++) {
        var ru = rules[ri];
        eligible[ri] = isEligible(ru);
        if (!eligible[ri]) {
          boxesOf[ri] = [];
          hullOf[ri] = null;
          over[ri] = false;
          continue;
        }
        var ex = expandRuleBoxes(ru, imap, maxBoxes);
        boxesOf[ri] = ex.boxes;
        over[ri] = ex.over;
        hullOf[ri] = ex.boxes.length ? computeHull(ex.boxes) : null;
        if (ex.over) {
          addFinding({
            type: 'undetermined',
            severity: 'info',
            scopeKey: key,
            pairLabel: pairLabel(ru) || undefined,
            rule: citeRule(ru),
            by: [],
            params: { limit: maxBoxes }
          });
        }
      }

      var shadowedOrDup = Object.create(null);

      for (var j = 0; j < rules.length; j++) {
        if (!eligible[j] || over[j]) continue;
        var Rj = rules[j];
        var residual = boxesOf[j].slice();
        if (!residual.length) continue;
        var origBoxes = residual.slice();
        var contributors = [];

        for (var i2 = 0; i2 < j; i2++) {
          if (!eligible[i2] || over[i2]) continue;
          var Ri = rules[i2];
          if (!Ri.terminal) continue;
          if (!IR.v6Covers((Ri.src && Ri.src.v6) || 'none', (Rj.src && Rj.src.v6) || 'none')) continue;
          if (!IR.v6Covers((Ri.dst && Ri.dst.v6) || 'none', (Rj.dst && Rj.dst.v6) || 'none')) continue;
          if (!hullOf[i2] || !hullOf[j] || hullsDisjoint(hullOf[i2], hullOf[j])) continue;

          // ponytail: cap residual explosion; 7-D subtract ≤ 14 pieces per box
          if (residual.length * 14 > maxBoxes) {
            addFinding({
              type: 'undetermined',
              severity: 'info',
              scopeKey: key,
              pairLabel: pairLabel(Rj) || undefined,
              rule: citeRule(Rj),
              by: [],
              params: { limit: maxBoxes }
            });
            residual = null;
            break;
          }

          var next = subtractBoxes(residual, boxesOf[i2]);
          if (next.length > maxBoxes) {
            addFinding({
              type: 'undetermined',
              severity: 'info',
              scopeKey: key,
              pairLabel: pairLabel(Rj) || undefined,
              rule: citeRule(Rj),
              by: [],
              params: { limit: maxBoxes }
            });
            residual = null;
            break;
          }
          var prevVol = logVolume(residual);
          var nextVol = logVolume(next);
          if (next.length !== residual.length || (prevVol > 0 && nextVol < prevVol * 0.999999999)) {
            contributors.push(i2);
          }
          residual = next;
          if (!residual.length) break;
        }
        if (residual === null) continue;
        if (residual.length) continue;

        var byIdx = minimizeCover(origBoxes, contributors, boxesOf, maxBoxes);
        var by = byIdx.map(function (idx) { return cite(rules[idx]); });
        var sameAction = by.every(function (c) { return IR.actionClass(c.action) === IR.actionClass(Rj.action); });
        var single = by.length === 1;
        var mutual = single && boxesEqualSet(boxesOf[byIdx[0]], origBoxes);
        var sameClass = single && IR.actionClass(rules[byIdx[0]].action) === IR.actionClass(Rj.action);

        var finding;
        if (mutual && sameClass) {
          finding = {
            type: 'duplicate',
            severity: 'low',
            scopeKey: key,
            pairLabel: pairLabel(Rj) || undefined,
            rule: citeRule(Rj),
            by: by,
            params: { single: true }
          };
          shadowedOrDup[Rj.uid] = true;
        } else if (sameAction) {
          finding = {
            type: 'shadowed',
            severity: 'medium',
            scopeKey: key,
            pairLabel: pairLabel(Rj) || undefined,
            rule: citeRule(Rj),
            by: by,
            params: { single: single }
          };
          shadowedOrDup[Rj.uid] = true;
        } else {
          var dir = 'permit_covers_deny';
          if (by.some(function (c) { return IR.actionClass(c.action) === 'block'; }) && IR.actionClass(Rj.action) === 'permit') {
            dir = 'deny_covers_permit';
          } else if (by.some(function (c) { return IR.actionClass(c.action) === 'permit'; }) && IR.actionClass(Rj.action) === 'block') {
            dir = 'permit_covers_deny';
          }
          finding = {
            type: 'contradiction',
            severity: 'high',
            scopeKey: key,
            pairLabel: pairLabel(Rj) || undefined,
            rule: citeRule(Rj),
            by: by,
            params: { direction: dir, single: single }
          };
        }
        addFinding(finding);
      }

      // merge: adjacent eligible, same action+log, both terminal, neither shadowed/dup, differ in exactly one group
      for (var m = 0; m < rules.length - 1; m++) {
        var Ra = rules[m], Rb = rules[m + 1];
        if (Ra.order + 1 !== Rb.order && !(eligible[m] && eligible[m + 1] && rules.indexOf(Rb) === m + 1)) {
          // adjacency is consecutive in the scope list; ineligible in between breaks it
        }
        // consecutive in array = adjacent in evaluation order of this scope
        var betweenOk = true;
        // they are adjacent in `rules` which is the full scope list. Ineligible between breaks.
        // we only consider m, m+1 as array neighbors — if m+1 exists they are adjacent in eval order
        // including ineligible. If either neighbour is ineligible, skip (broken adjacency for next pair too).
        if (!eligible[m] || !eligible[m + 1]) continue;
        if (over[m] || over[m + 1]) continue;
        if (shadowedOrDup[Ra.uid] || shadowedOrDup[Rb.uid]) continue;
        if (Ra.action !== Rb.action) continue;
        if (!!Ra.log !== !!Rb.log) continue;
        if (!Ra.terminal || !Rb.terminal) continue;

        var dSrc = !IR.addrEqual(Ra.src, Rb.src);
        var dDst = !IR.addrEqual(Ra.dst, Rb.dst);
        var dSvc = !IR.svcEqual(Ra.svc, Rb.svc);
        var dIn = !intfSetsEqual(Ra.srcIntf, Rb.srcIntf);
        var dOut = !intfSetsEqual(Ra.dstIntf, Rb.dstIntf);
        var diffs = (dSrc ? 1 : 0) + (dDst ? 1 : 0) + (dSvc ? 1 : 0) + (dIn ? 1 : 0) + (dOut ? 1 : 0);
        if (diffs !== 1) continue;
        var dim = dSrc ? 'src' : dDst ? 'dst' : dSvc ? 'svc' : 'intf';
        addFinding({
          type: 'merge',
          severity: 'info',
          scopeKey: key,
          pairLabel: pairLabel(Rb) || undefined,
          rule: citeRule(Rb),
          by: [cite(Ra)],
          params: { dim: dim }
        });
      }

      // any-wide permits
      for (var w = 0; w < rules.length; w++) {
        if (!eligible[w] || over[w]) continue;
        var Rw = rules[w];
        if (IR.actionClass(Rw.action) !== 'permit') continue;
        var srcFull = IR.isFullV4((Rw.src && Rw.src.v4) || []);
        var dstFull = IR.isFullV4((Rw.dst && Rw.dst.v4) || []);
        var svcAny = IR.isAnySvc(Rw.svc);
        var level = null;
        var dims = [];
        if (srcFull && dstFull) {
          level = svcAny ? 'high' : 'medium';
          dims = svcAny ? ['src', 'dst', 'svc'] : ['src', 'dst'];
        } else if (svcAny && (srcFull || dstFull)) {
          level = 'medium';
          dims = srcFull ? ['src', 'svc'] : ['dst', 'svc'];
        }
        if (!level) continue;
        addFinding({
          type: 'any_wide',
          severity: level === 'high' ? 'high' : 'medium',
          scopeKey: key,
          pairLabel: pairLabel(Rw) || undefined,
          rule: citeRule(Rw),
          by: [],
          params: { level: level, dims: dims.join(',') }
        });
      }

      var remove = [];
      var review = [];
      var removedUids = Object.create(null);
      for (var f = 0; f < findings.length; f++) {
        var fn = findings[f];
        if (fn.scopeKey !== key) continue;
        if (fn.type === 'duplicate' || fn.type === 'shadowed') {
          var rr = rules.filter(function (x) { return x.uid === fn.rule.uid; })[0];
          if (!rr) continue;
          remove.push({ rule: rr, reason: fn.type, by: fn.by });
          removedUids[rr.uid] = true;
        } else if (fn.type === 'contradiction') {
          var rc = rules.filter(function (x) { return x.uid === fn.rule.uid; })[0];
          if (!rc) continue;
          review.push({ rule: rc, reason: 'contradiction', by: fn.by });
        }
      }
      var keptOrder = [];
      for (var k = 0; k < rules.length; k++) {
        if (!removedUids[rules[k].uid]) keptOrder.push(rules[k].id);
      }
      cleanup.perScope.push({ scopeKey: key, remove: remove, review: review, keptOrder: keptOrder });
    }

    var stats = {
      rules: policy.rules.length,
      scopes: policy.scopes.length,
      findings: findings.length,
      notAnalysed: policy.rules.filter(function (x) { return x.unsupported && x.unsupported.length; }).length,
      disabled: policy.rules.filter(function (x) { return x.disabled; }).length,
      warnings: policy.warnings.length
    };

    return { findings: findings, perRule: perRule, cleanup: cleanup, stats: stats };
  }

  function scopeParts(scopeKey) {
    // acl:NAME | chain:table:CHAIN | zp:from>to | global | filter:family:NAME | vdom:name
    if (scopeKey.indexOf('acl:') === 0) return { kind: 'acl', name: scopeKey.slice(4) };
    if (scopeKey.indexOf('chain:') === 0) {
      var rest = scopeKey.slice(6);
      var c = rest.indexOf(':');
      return { kind: 'chain', table: rest.slice(0, c), name: rest.slice(c + 1) };
    }
    if (scopeKey.indexOf('zp:') === 0) {
      var z = scopeKey.slice(3).split('>');
      return { kind: 'zp', from: z[0], to: z.slice(1).join('>') };
    }
    if (scopeKey === 'global') return { kind: 'global' };
    if (scopeKey.indexOf('filter:') === 0) {
      var fr = scopeKey.slice(7);
      var fc = fr.indexOf(':');
      return { kind: 'filter', family: fr.slice(0, fc), name: fr.slice(fc + 1) };
    }
    if (scopeKey.indexOf('vdom:') === 0) return { kind: 'vdom', name: scopeKey.slice(5) };
    return { kind: 'other', name: scopeKey };
  }

  function removalCommands(policy, cleanup) {
    var vendor = policy.vendor;
    var lines = [];
    var scopes = cleanup.perScope || [];
    for (var s = 0; s < scopes.length; s++) {
      var sc = scopes[s];
      var rem = sc.remove || [];
      if (!rem.length) continue;
      var sp = scopeParts(sc.scopeKey);
      if (vendor === 'ios') {
        if (sp.kind === 'acl' && /^\d+$/.test(sp.name)) {
          for (var i = 0; i < rem.length; i++) lines.push('! remove: ' + (rem[i].rule.raw || '').split('\n')[0]);
        } else if (sp.kind === 'acl') {
          var named = false;
          var seqs = [];
          var nos = [];
          for (var i2 = 0; i2 < rem.length; i2++) {
            var raw = (rem[i2].rule.raw || '').split('\n')[0];
            var id = rem[i2].rule.id;
            if (/^\d+$/.test(String(id))) seqs.push(id);
            else nos.push('! remove: ' + raw);
          }
          if (seqs.length) {
            lines.push('ip access-list extended ' + sp.name);
            for (var q = 0; q < seqs.length; q++) lines.push(' no ' + seqs[q]);
          }
          for (var n = 0; n < nos.length; n++) lines.push(nos[n]);
        }
      } else if (vendor === 'asa') {
        for (var a = 0; a < rem.length; a++) {
          var ar = (rem[a].rule.raw || '').split('\n')[0].trim();
          if (ar) lines.push('no ' + ar);
        }
      } else if (vendor === 'iptables') {
        for (var t = 0; t < rem.length; t++) {
          var rr = rem[t].rule;
          var rawI = (rr.raw || '').trim();
          var table = sp.table && sp.table !== 'filter' ? sp.table : '';
          var spec = rawI.replace(/^(?:ip6?tables(?:-save)?\s+)+/i, '');
          spec = spec.replace(/^-t\s+\S+\s+/i, '');
          spec = spec.replace(/^-[AI]\s+\S+(?:\s+\d+)?\s+/, '');
          var cmd = 'iptables';
          if (table) cmd += ' -t ' + table;
          cmd += ' -D ' + (sp.name || 'INPUT') + ' ' + spec;
          lines.push(cmd);
        }
      } else if (vendor === 'fortios') {
        var vdom = sp.name && sp.name !== 'root' ? sp.name : '';
        if (vdom) {
          lines.push('config vdom');
          lines.push('edit ' + vdom);
        }
        lines.push('config firewall policy');
        for (var f = 0; f < rem.length; f++) {
          lines.push('    delete ' + rem[f].rule.id);
        }
        lines.push('end');
        if (vdom) lines.push('end');
      } else if (vendor === 'junos') {
        for (var jn = 0; jn < rem.length; jn++) {
          var rj = rem[jn].rule;
          if (sp.kind === 'zp') {
            lines.push('delete security policies from-zone ' + sp.from + ' to-zone ' + sp.to + ' policy ' + rj.id);
          } else if (sp.kind === 'global') {
            lines.push('delete security policies global policy ' + rj.id);
          } else if (sp.kind === 'filter') {
            if (sp.family && sp.family !== 'inet') {
              lines.push('delete firewall family ' + sp.family + ' filter ' + sp.name + ' term ' + rj.id);
            } else {
              var usedFamily = /family inet/.test(rj.raw || '') || (sp.family === 'inet');
              if (usedFamily && /family inet/.test(rj.raw || '')) {
                lines.push('delete firewall family inet filter ' + sp.name + ' term ' + rj.id);
              } else if (sp.family === 'inet' && policy.rules.some(function (x) { return x.scopeKey === sc.scopeKey && /family inet/.test(x.raw || ''); })) {
                lines.push('delete firewall family inet filter ' + sp.name + ' term ' + rj.id);
              } else {
                lines.push('delete firewall family inet filter ' + sp.name + ' term ' + rj.id);
              }
            }
          }
        }
      }
    }
    return lines.join('\n');
  }

  var api = { analyze: analyze, removalCommands: removalCommands };
  root.FwAnalyzer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
