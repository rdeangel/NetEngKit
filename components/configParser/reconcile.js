/* ──────────────────────────────────────────────────────────────────────
 * reconcile.js — Device Config Parser multi-tab relationship reconciliation.
 *
 * Pure, dependency-free. Loaded as a plain <script src> (global, like
 * ip-utils.js) and also requireable in Node for ad-hoc checks.
 *
 *   reconcileDevices(devices) -> { nodes, links }
 *   buildMermaid(nodes, links, dir) -> mermaid source string
 *
 * `devices` is an array of: { uid, name, analysis, neighbors }
 *   analysis.logicalUnits[]: { ifkey, ipv4:[], ipv6:[], description, ... }
 *   analysis.counts.hostname: string
 *   neighbors[]: { device, mgmtIP, localIntf, remoteIntf, ... } (optional)
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  // ── Confidence ranking ──────────────────────────────────────────────
  var CONF_RANK = { weak: 1, plausible: 2, structural: 3, confirmed: 4 };

  // ── IPv4 helpers ────────────────────────────────────────────────────
  function ipv4ToInt(addr) {
    var parts = String(addr).trim().split('.');
    if (parts.length !== 4) return null;
    var n = 0;
    for (var i = 0; i < 4; i++) {
      var o = Number(parts[i]);
      if (!Number.isInteger(o) || o < 0 || o > 255) return null;
      n = (n * 256) + o;
    }
    return n >>> 0;
  }

  function maskToPrefix(mask) {
    var int = ipv4ToInt(mask);
    if (int === null) return null;
    // count leading ones
    var p = 0, seenZero = false;
    for (var b = 31; b >= 0; b--) {
      if ((int >>> b) & 1) { if (seenZero) return null; p++; }
      else seenZero = true;
    }
    return p;
  }

  // Parse "A.B.C.D MASK" | "A.B.C.D/len" | "A.B.C.D" -> {int, prefix} | null
  function parseIpv4(str) {
    if (!str) return null;
    var s = String(str).trim();
    var addr, prefix = null;
    if (s.indexOf('/') >= 0) {
      var c = s.split('/');
      addr = c[0].trim();
      prefix = Number(c[1]);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) prefix = null;
    } else if (/\s/.test(s)) {
      var m = s.split(/\s+/);
      addr = m[0];
      prefix = maskToPrefix(m[1]);
    } else {
      addr = s;
    }
    var int = ipv4ToInt(addr);
    if (int === null) return null;
    return { int: int, prefix: prefix, addr: addr };
  }

  function v4Network(int, prefix) {
    if (prefix === 0) return 0;
    var mask = (0xFFFFFFFF << (32 - prefix)) >>> 0;
    return (int & mask) >>> 0;
  }

  // ── IPv6 helpers (BigInt) ───────────────────────────────────────────
  function ipv6ToBig(addr) {
    var s = String(addr).trim();
    if (s.indexOf(':') < 0) return null;
    var halves = s.split('::');
    if (halves.length > 2) return null;
    var head = halves[0] ? halves[0].split(':') : [];
    var tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : null;
    var groups;
    if (tail === null) {
      groups = head;
    } else {
      var fill = 8 - head.length - tail.length;
      if (fill < 0) return null;
      groups = head.concat(Array(fill).fill('0'), tail);
    }
    if (groups.length !== 8) return null;
    var big = 0n;
    for (var i = 0; i < 8; i++) {
      var g = groups[i] === '' ? '0' : groups[i];
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      big = (big << 16n) + BigInt(parseInt(g, 16));
    }
    return big;
  }

  function parseIpv6(str) {
    if (!str) return null;
    var s = String(str).trim();
    var addr = s, prefix = null;
    if (s.indexOf('/') >= 0) {
      var c = s.split('/');
      addr = c[0].trim();
      prefix = Number(c[1]);
      if (!Number.isInteger(prefix) || prefix < 0 || prefix > 128) prefix = null;
    }
    var big = ipv6ToBig(addr);
    if (big === null) return null;
    return { big: big, prefix: prefix, addr: addr };
  }

  function v6Network(big, prefix) {
    if (prefix === 0) return 0n;
    var mask = ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
    return big & mask;
  }

  // ── hostname normalization ──────────────────────────────────────────
  function normHost(h) {
    if (!h) return '';
    return String(h).trim().toLowerCase().split('.')[0].replace(/[>#].*$/, '');
  }

  // Loopbacks are not links — exclude them from subnet adjacency.
  function isLoopback(ifkey) {
    return /^(lo|loopback)\d/i.test(ifkey) || /^(lo|loopback)$/i.test(ifkey);
  }

  function firstIpv4(str) {
    var m = String(str || '').match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
    return m ? m[0] : null;
  }

  // ── Build a per-device working model ────────────────────────────────
  function buildModel(devices) {
    var model = [];
    devices.forEach(function (d, i) {
      if (!d || !d.analysis) return;
      var hostname = (d.analysis.counts && d.analysis.counts.hostname) || '';
      var label = hostname || d.name || ('Device ' + (i + 1));
      var units = (d.analysis.logicalUnits || []).map(function (u) {
        var v4 = (u.ipv4 || []).map(parseIpv4).filter(Boolean);
        var v6 = (u.ipv6 || []).map(parseIpv6).filter(Boolean);
        // dot1q encapsulation tag (parser puts explicit `encapsulation dot1q`
        // / junos `vlan-id` here, taking precedence over the subinterface id).
        var vlan = (u.vlanId !== undefined && u.vlanId !== null) ? String(u.vlanId) : '';
        return { ifkey: u.ifkey, v4: v4, v6: v6, description: u.description || '', vlan: vlan };
      });
      var ipv4Set = {};
      units.forEach(function (u) { u.v4.forEach(function (a) { ipv4Set[a.addr] = true; }); });
      model.push({
        idx: i,
        uid: d.uid,
        label: label,
        host: normHost(hostname),
        units: units,
        ipv4Set: ipv4Set,
        neighbors: d.neighbors || [],
      });
    });
    return model;
  }

  // Plain, underscore-free id so Mermaid's edge ids (L_<src>_<dst>_<n>) and
  // node group ids (flowchart-<id>-<n>) can be parsed unambiguously for drag.
  function slug(label, idx) {
    return 'n' + idx;
  }

  // ── Link accumulation ───────────────────────────────────────────────
  function reconcileDevices(devices) {
    var model = buildModel(devices || []);
    var nodes = model.map(function (m) {
      return { id: slug(m.label, m.idx), label: m.label, idx: m.idx };
    });
    var nodeById = {};
    model.forEach(function (m, k) { nodeById[m.idx] = nodes[k]; });

    var linksMap = {}; // key -> link

    function getLink(aIdx, bIdx, aIntf, bIntf) {
      // order endpoints by idx so the pair is stable
      var lo, hi, loIntf, hiIntf;
      if (aIdx <= bIdx) { lo = aIdx; hi = bIdx; loIntf = aIntf; hiIntf = bIntf; }
      else { lo = bIdx; hi = aIdx; loIntf = bIntf; hiIntf = aIntf; }
      var key = lo + '|' + hi + '|' + (loIntf || '') + '|' + (hiIntf || '');
      if (!linksMap[key]) {
        linksMap[key] = {
          a: nodeById[lo].id, b: nodeById[hi].id,
          aLabel: nodeById[lo].label, bLabel: nodeById[hi].label,
          aIntf: loIntf || '', bIntf: hiIntf || '',
          evidence: [], confidence: 'weak',
        };
      }
      return linksMap[key];
    }

    function addEvidence(aIdx, bIdx, aIntf, bIntf, ev) {
      var link = getLink(aIdx, bIdx, aIntf, bIntf);
      // avoid duplicate identical evidence
      var dup = link.evidence.some(function (e) { return e.type === ev.type && e.detail === ev.detail; });
      if (!dup) link.evidence.push(ev);
    }

    // ── Matcher 1: subnet adjacency ──
    for (var i = 0; i < model.length; i++) {
      for (var j = i + 1; j < model.length; j++) {
        var A = model[i], B = model[j];
        A.units.forEach(function (ua) {
          B.units.forEach(function (ub) {
            // Loopbacks are never one side of a link.
            if (isLoopback(ua.ifkey) || isLoopback(ub.ifkey)) return;
            // A shared /30·/31·/126·/127 is only a real adjacency if the dot1q
            // encapsulation tags match (untagged-on-both counts as a match).
            // The subinterface id itself is irrelevant — only the tag matters.
            if (ua.vlan !== ub.vlan) return;
            // IPv4
            ua.v4.forEach(function (a4) {
              ub.v4.forEach(function (b4) {
                // Only point-to-point adjacencies (/30, /31) count as a link.
                if (a4.prefix !== null && b4.prefix !== null && a4.prefix >= 30 && b4.prefix >= 30) {
                  var p = Math.min(a4.prefix, b4.prefix);
                  if (v4Network(a4.int, p) === v4Network(b4.int, p)) {
                    addEvidence(A.idx, B.idx, ua.ifkey, ub.ifkey, {
                      type: 'subnet', level: 'structural',
                      detail: 'same /' + Math.max(a4.prefix, b4.prefix) + ' (' + a4.addr + ' ↔ ' + b4.addr + ')',
                    });
                  }
                }
              });
            });
            // IPv6
            ua.v6.forEach(function (a6) {
              ub.v6.forEach(function (b6) {
                if (a6.prefix !== null && b6.prefix !== null && a6.prefix >= 126 && b6.prefix >= 126) {
                  var p6 = Math.min(a6.prefix, b6.prefix);
                  if (v6Network(a6.big, p6) === v6Network(b6.big, p6)) {
                    addEvidence(A.idx, B.idx, ua.ifkey, ub.ifkey, {
                      type: 'subnet', level: 'structural',
                      detail: 'same /' + Math.max(a6.prefix, b6.prefix) + ' (' + a6.addr + ' ↔ ' + b6.addr + ')',
                    });
                  }
                }
              });
            });
          });
        });
      }
    }

    // ── Matcher 2: CDP/LLDP confirmation ──
    model.forEach(function (A) {
      (A.neighbors || []).forEach(function (nb) {
        var nDev = normHost(nb.device);
        var nIp = firstIpv4(nb.mgmtIP);
        model.forEach(function (B) {
          if (B.idx === A.idx) return;
          var hostMatch = nDev && B.host && nDev === B.host;
          var ipMatch = nIp && B.ipv4Set[nIp];
          if (hostMatch || ipMatch) {
            addEvidence(A.idx, B.idx, nb.localIntf || '', nb.remoteIntf || '', {
              type: 'neighbor', level: 'confirmed',
              detail: (nb.protocol || 'LLDP/CDP') + ' neighbor' +
                (nb.localIntf ? ' ' + nb.localIntf : '') +
                (nb.remoteIntf ? ' → ' + nb.remoteIntf : '') +
                (ipMatch && !hostMatch ? ' (mgmt ' + nIp + ')' : ''),
            });
          }
        });
      });
    });

    // ── Matcher 3: description ↔ hostname ──
    // Returns the actual interface description that references `host`, or ''.
    function matchingDesc(units, host) {
      if (!host) return '';
      var re = new RegExp('(^|[^a-z0-9])' + host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '([^a-z0-9]|$)', 'i');
      for (var k = 0; k < units.length; k++) {
        if (units[k].description && re.test(units[k].description)) return units[k].description;
      }
      return '';
    }
    for (var x = 0; x < model.length; x++) {
      for (var y = x + 1; y < model.length; y++) {
        var P = model[x], Q = model[y];
        var pDesc = matchingDesc(P.units, Q.host);
        var qDesc = matchingDesc(Q.units, P.host);
        if (pDesc && qDesc) {
          // `text` is used as the diagram edge label; `detail` is the evidence row.
          addEvidence(P.idx, Q.idx, '', '', {
            type: 'desc_both', level: 'plausible',
            text: (pDesc === qDesc ? pDesc : pDesc + ' ↔ ' + qDesc),
            detail: 'descriptions reference each other: "' + pDesc + '" ↔ "' + qDesc + '"',
          });
        } else if (pDesc || qDesc) {
          var d = pDesc || qDesc;
          addEvidence(P.idx, Q.idx, '', '', {
            type: 'desc_one', level: 'weak',
            text: d,
            detail: 'interface description: "' + d + '"',
          });
        }
      }
    }

    // ── Finalize confidence per link ──
    var links = Object.keys(linksMap).map(function (k) {
      var link = linksMap[k];
      var best = 'weak';
      link.evidence.forEach(function (e) {
        if (CONF_RANK[e.level] > CONF_RANK[best]) best = e.level;
      });
      var hasSubnet = link.evidence.some(function (e) { return e.type === 'subnet'; });
      var hasCorroboration = link.evidence.some(function (e) { return e.type === 'neighbor' || e.type === 'desc_both'; });
      if (hasSubnet && hasCorroboration) best = 'confirmed';
      link.confidence = best;
      // Stable, tab-order-independent identity for persisting user removals.
      link.key = [link.aLabel + '|' + link.aIntf, link.bLabel + '|' + link.bIntf].sort().join('::');
      return link;
    });

    // sort strongest first
    links.sort(function (a, b) { return CONF_RANK[b.confidence] - CONF_RANK[a.confidence]; });

    // drop nodes with no links? keep all parsed devices as nodes
    return { nodes: nodes.map(function (n) { return { id: n.id, label: n.label }; }), links: links };
  }

  // ── Mermaid source builder ──────────────────────────────────────────
  var CONF_VISUAL = {
    confirmed:  { color: '#22c55e', width: 3, dash: null  },
    structural: { color: '#38bdf8', width: 2, dash: null  },
    plausible:  { color: '#f59e0b', width: 2, dash: '6 4' },
    weak:       { color: '#94a3b8', width: 1, dash: '2 5' },
  };

  function toMermaidLinkStyle(v) {
    var s = 'stroke:' + v.color + ',stroke-width:' + v.width + 'px';
    if (v.dash) s += ',stroke-dasharray:' + v.dash;
    return s;
  }

  function toDrawioStyle(v) {
    var s = 'strokeColor=' + v.color + ';strokeWidth=' + v.width;
    if (v.dash) s += ';dashed=1;dashPattern=' + v.dash;
    return s;
  }

  // Escape quotes but strip <> (not escape). Mermaid allows <br/> in labels,
  // so stripping is intentional to preserve those line breaks.
  function escLabel(s) {
    return String(s).replace(/"/g, '&quot;').replace(/[<>]/g, '');
  }

  // Full XML escaping for DrawIO export (requires all entities escaped).
  function xmlEsc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Word-wrap a label to ~width chars per line (joined with <br/>), so long
  // interface descriptions stay readable without sprawling across the diagram.
  function wrapLabel(text, width, maxLines) {
    var words = String(text).split(/\s+/);
    var lines = [], cur = '';
    for (var i = 0; i < words.length; i++) {
      var w = words[i];
      if (cur && (cur.length + 1 + w.length) > width) { lines.push(cur); cur = w; }
      else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    if (maxLines && lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      lines[maxLines - 1] = lines[maxLines - 1] + '…';
    }
    return lines.map(escLabel).join('<br/>');
  }

  function selectEdges(links, opts) {
    opts = opts || {};
    var descLabel = opts.descLabel || 'description';
    var pairKey = function (lk) { return [lk.a, lk.b].sort().join('|'); };
    var hasPorts = function (lk) { return !!(lk.aIntf || lk.bIntf); };
    var portPairs = {};
    links.forEach(function (lk) { if (hasPorts(lk)) portPairs[pairKey(lk)] = true; });

    var edges = [];
    links.forEach(function (lk) {
      if (!hasPorts(lk) && portPairs[pairKey(lk)]) return;
      var descEv = null;
      for (var e = 0; e < lk.evidence.length; e++) { if (lk.evidence[e].text) { descEv = lk.evidence[e]; break; } }
      var label = hasPorts(lk)
        ? ((lk.aIntf || '?') + ' ↔ ' + (lk.bIntf || '?'))
        : (descEv ? descEv.text : descLabel);
      edges.push({ a: lk.a, b: lk.b, label: label, confidence: lk.confidence });
    });
    return edges;
  }

  function buildMermaid(nodes, links, dir, opts) {
    opts = opts || {};
    var d = (dir === 'TB' || dir === 'TD') ? 'TD' : 'LR';
    var lines = ['graph ' + d];
    nodes.forEach(function (n) {
      lines.push('  ' + n.id + '["' + escLabel(n.label) + '"]');
    });

    var edges = selectEdges(links, opts);
    var styleLines = [];
    edges.forEach(function (edge, edgeIdx) {
      var displayLabel = wrapLabel(edge.label, 22, 5);
      lines.push('  ' + edge.a + ' ---|"' + displayLabel + '"| ' + edge.b);
      styleLines.push('  linkStyle ' + edgeIdx + ' ' + toMermaidLinkStyle(CONF_VISUAL[edge.confidence] || CONF_VISUAL.weak));
    });
    return lines.concat(styleLines).join('\n');
  }

  function buildDrawio(nodes, links, positions, opts) {
    opts = opts || {};
    var edges = selectEdges(links, opts);

    var GRID_W = 120, GRID_H = 60, GRID_COLS = 4, GRID_GAP_X = 200, GRID_GAP_Y = 120;
    var PARALLEL_SPACING = 40;

    // Pre-compute effective center positions for all nodes (positions map or grid fallback)
    var nodePos = {};
    nodes.forEach(function(n, i) {
      var pos = positions && positions[n.id];
      if (pos) {
        nodePos[n.id] = { x: pos.x, y: pos.y, w: pos.w, h: pos.h };
      } else {
        var col = i % GRID_COLS;
        var row = Math.floor(i / GRID_COLS);
        nodePos[n.id] = { x: col * GRID_GAP_X, y: row * GRID_GAP_Y, w: GRID_W, h: GRID_H };
      }
    });

    // Detect parallel edges — count how many edges share the same normalized pair key
    var pairCounts = {};
    var pairIndices = edges.map(function(edge) {
      var key = edge.a < edge.b ? edge.a + '|' + edge.b : edge.b + '|' + edge.a;
      var idx = pairCounts[key] || 0;
      pairCounts[key] = idx + 1;
      return { key: key, idx: idx };
    });
    // Second pass to get final totals (pairCounts was mutated during map)
    var pairTotals = {};
    Object.keys(pairCounts).forEach(function(k) { pairTotals[k] = pairCounts[k]; });

    var lines = [];
    lines.push('<mxGraphModel><root>');
    lines.push('<mxCell id="0"/>');
    lines.push('<mxCell id="1" parent="0"/>');

    nodes.forEach(function(n) {
      var p = nodePos[n.id];
      lines.push('<mxCell id="' + xmlEsc(n.id) + '" value="' + xmlEsc(n.label) +
        '" style="rounded=1;whiteSpace=wrap;html=1;" vertex="1" parent="1">' +
        '<mxGeometry x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" as="geometry"/>' +
        '</mxCell>');
    });

    edges.forEach(function(edge, i) {
      var conf = CONF_VISUAL[edge.confidence] || CONF_VISUAL.weak;
      var edgeStyle = 'html=1;endArrow=none;curved=1;' + toDrawioStyle(conf);

      var pairInfo = pairIndices[i];
      var total = pairTotals[pairInfo.key];
      var geomInner = '';

      if (total > 1) {
        // Add a perpendicular waypoint at the midpoint to fan out parallel edges
        var pa = nodePos[edge.a], pb = nodePos[edge.b];
        if (pa && pb) {
          var ax = pa.x + pa.w / 2, ay = pa.y + pa.h / 2;
          var bx = pb.x + pb.w / 2, by = pb.y + pb.h / 2;
          var dx = bx - ax, dy = by - ay;
          var len = Math.sqrt(dx * dx + dy * dy) || 1;
          var perpX = -dy / len, perpY = dx / len;
          var offset = (pairInfo.idx - (total - 1) / 2) * PARALLEL_SPACING;
          var wpX = Math.round((ax + bx) / 2 + perpX * offset);
          var wpY = Math.round((ay + by) / 2 + perpY * offset);
          geomInner = '<Array as="points"><mxPoint x="' + wpX + '" y="' + wpY + '"/></Array>';
        }
      }

      lines.push('<mxCell id="e' + i + '" value="' + xmlEsc(edge.label) +
        '" style="' + edgeStyle + '" edge="1" parent="1"' +
        ' source="' + xmlEsc(edge.a) + '" target="' + xmlEsc(edge.b) + '">' +
        '<mxGeometry relative="1" as="geometry">' + geomInner + '</mxGeometry>' +
        '</mxCell>');
    });

    lines.push('</root></mxGraphModel>');
    return lines.join('\n');
  }

  var api = {
    reconcileDevices: reconcileDevices,
    buildMermaid: buildMermaid,
    buildDrawio: buildDrawio,
    selectEdges: selectEdges,
    CONF_VISUAL: CONF_VISUAL,
    toMermaidLinkStyle: toMermaidLinkStyle,
    toDrawioStyle: toDrawioStyle,
  };
  root.reconcileDevices = reconcileDevices;
  root.buildMermaid = buildMermaid;
  root.buildDrawio = buildDrawio;
  root.selectEdges = selectEdges;
  root.CONF_VISUAL = CONF_VISUAL;
  root.toMermaidLinkStyle = toMermaidLinkStyle;
  root.toDrawioStyle = toDrawioStyle;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
