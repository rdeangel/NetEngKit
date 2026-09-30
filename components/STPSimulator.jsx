const { useState, useEffect, useMemo, useRef } = React;

// <stp-engine>
// Pure engine. No JSX, no React, no window, no t() in here: STPSimulator.test.js slices this
// block out and evaluates it with `new Function`. Returns i18n keys, never text.
const STP_VARIANTS = ['stp', 'rstp', 'pvst', 'rpvst'];
const STP_SPEEDS = ['10M', '100M', '1G', '10G', '25G', '40G', '100G', '400G'];
// 802.1D-1998 stops at 10G; 1 above that is the vendor convention (see hint_short_cap).
const STP_COST_SHORT = { '10M': 100, '100M': 19, '1G': 4, '10G': 2, '25G': 1, '40G': 1, '100G': 1, '400G': 1 };
// 802.1t: 20,000,000,000,000 / bps.
const STP_COST_LONG = { '10M': 2000000, '100M': 200000, '1G': 20000, '10G': 2000, '25G': 800, '40G': 500, '100G': 200, '400G': 50 };
const STP_PRIORITIES = Array.from({ length: 16 }, (_, i) => i * 4096);
const STP_PORT_PRIOS = Array.from({ length: 16 }, (_, i) => i * 16);
const STP_MAX_SW = 16;
const STP_MAX_LINKS = 32;
const STP_MAX_VLANS = 8;
const STP_ABBR = { root: 'RP', designated: 'DP', alternate: 'AP', backup: 'BP', disabled: 'X' };
const STP_VEC_NAMES = ['cost', 'sender_bid', 'sender_port', 'local_port'];

function stpMap() { return Object.create(null); }
function stpIsPvst(variant) { return variant === 'pvst' || variant === 'rpvst'; }
function stpIsInt(v, lo, hi) {
  const s = String(v == null ? '' : v).trim();
  return /^\d+$/.test(s) && +s >= lo && +s <= hi;
}
function stpBlank(v) { return v == null || String(v).trim() === ''; }
// 12 lowercase hex digits or null. Accepts aabb.ccdd.eeff / aa:bb:cc:dd:ee:ff / aa-bb-... / raw.
function stpMac(s) {
  const h = String(s == null ? '' : s).replace(/[\s.:-]/g, '').toLowerCase();
  return /^[0-9a-f]{12}$/.test(h) ? h : null;
}
function stpVlanKeys(topo) { return stpIsPvst(topo.variant) ? topo.vlans.map(Number) : [0]; }

// Per-link cost, applied to the receiving port. Manual override wins.
function stpCost(speed, method, manual) {
  if (!stpBlank(manual)) return +manual;
  return (method === 'short' ? STP_COST_SHORT : STP_COST_LONG)[speed];
}

// Bridge ID: priority (+ sys-id-ext = VLAN for PVST variants) then MAC.
function stpBid(sw, vlan, variant) {
  const ext = stpIsPvst(variant) ? (+vlan || 0) : 0;
  const ov = ext && sw.vlanPri ? sw.vlanPri[ext] : undefined;
  const base = stpBlank(ov) ? +sw.pri : +ov;
  const pri = base + ext;
  const mac = stpMac(sw.mac) || '000000000000';
  const hex = pri.toString(16).padStart(4, '0') + '.' + mac.slice(0, 4) + '.' + mac.slice(4, 8) + '.' + mac.slice(8);
  return { pri, mac, hex };
}
function stpCmpBid(a, b) {
  if (a.pri !== b.pri) return a.pri < b.pri ? -1 : 1;
  if (a.mac !== b.mac) return a.mac < b.mac ? -1 : 1; // equal-length lowercase hex: string order == numeric order
  return 0;
}
// 16-bit port ID: 4-bit priority field above the 12-bit port number (priority 0-240 step 16).
function stpPortId(e) { return +e.portPri * 256 + +e.portNum; }

function stpSwName(topo, id) {
  const s = topo.switches.find(x => x.id === id);
  return s ? s.name : '?';
}
function stpLinkName(topo, l) {
  return l.ends.map(e => stpSwName(topo, e.sw) + ':' + e.portNum).join(' ↔ ');
}

// First invalid field -> { key, vars } (key is a full i18n key); blank required field -> { key: '' } (silent).
function stpValidate(topo) {
  if (!topo || !Array.isArray(topo.switches) || !Array.isArray(topo.links)) return { key: 'stp_simulator.err_bad_data' };
  const pvst = stpIsPvst(topo.variant);
  if (topo.switches.length < 1) return { key: '' };
  if (topo.switches.length > STP_MAX_SW) return { key: 'stp_simulator.err_cap_sw', vars: { n: STP_MAX_SW } };
  if (topo.links.length > STP_MAX_LINKS) return { key: 'stp_simulator.err_cap_links', vars: { n: STP_MAX_LINKS } };
  if (pvst) {
    if (!Array.isArray(topo.vlans) || topo.vlans.length < 1) return { key: '' };
    if (topo.vlans.length > STP_MAX_VLANS) return { key: 'stp_simulator.err_cap_vlans', vars: { n: STP_MAX_VLANS } };
    const seenV = new Set();
    for (const v of topo.vlans) {
      if (!Number.isInteger(v) || v < 1 || v > 4094) return { key: 'stp_simulator.err_vlan', vars: { v: String(v) } };
      if (seenV.has(v)) return { key: 'stp_simulator.err_vlan_dup', vars: { v } };
      seenV.add(v);
    }
  }
  const ids = new Set(), names = new Set(), macs = new Set();
  for (const s of topo.switches) {
    if (stpBlank(s.name) || stpBlank(s.mac)) return { key: '' };
    const name = String(s.name).trim();
    if (ids.has(s.id)) return { key: 'stp_simulator.err_bad_data' };
    ids.add(s.id);
    if (names.has(name.toLowerCase())) return { key: 'stp_simulator.err_dup_name', vars: { name } };
    names.add(name.toLowerCase());
    const mac = stpMac(s.mac);
    if (!mac) return { key: 'stp_simulator.err_mac', vars: { name } };
    if (macs.has(mac)) return { key: 'stp_simulator.err_dup_mac', vars: { name } };
    macs.add(mac);
    if (!stpIsInt(s.pri, 0, 61440) || +s.pri % 4096) return { key: 'stp_simulator.err_pri', vars: { name } };
    for (const k of Object.keys(s.vlanPri || {})) {
      const v = s.vlanPri[k];
      if (!stpBlank(v) && (!stpIsInt(v, 0, 61440) || +v % 4096)) return { key: 'stp_simulator.err_pri', vars: { name } };
    }
  }
  const usedPorts = new Set(), linkIds = new Set();
  const manualMax = topo.cost === 'short' ? 65535 : 200000000;
  for (const l of topo.links) {
    if (!l || !Array.isArray(l.ends) || linkIds.has(l.id)) return { key: 'stp_simulator.err_bad_data' };
    linkIds.add(l.id);
    if (l.ends.length < 2) return { key: 'stp_simulator.err_ends' };
    for (const e of l.ends) {
      if (!e || !ids.has(e.sw)) return { key: 'stp_simulator.err_unknown_sw' };
      if (stpBlank(e.portNum)) return { key: '' };
    }
    const label = stpLinkName(topo, l);
    if (!STP_SPEEDS.includes(l.speed)) return { key: 'stp_simulator.err_speed', vars: { link: label } };
    if (!stpBlank(l.manual) && !stpIsInt(l.manual, 1, manualMax)) {
      return { key: 'stp_simulator.err_manual', vars: { link: label, max: manualMax } };
    }
    for (const e of l.ends) {
      const name = stpSwName(topo, e.sw);
      if (!stpIsInt(e.portNum, 1, 4095)) return { key: 'stp_simulator.err_portnum', vars: { name } };
      if (!stpIsInt(e.portPri, 0, 240) || +e.portPri % 16) return { key: 'stp_simulator.err_portpri', vars: { name, port: e.portNum } };
      const k = e.sw + ':' + +e.portNum;
      if (usedPorts.has(k)) return { key: 'stp_simulator.err_dup_port', vars: { name, port: +e.portNum } };
      usedPorts.add(k);
    }
  }
  return null;
}

function stpCmpOffer(a, b) {
  if (a.cost !== b.cost) return a.cost < b.cost ? -1 : 1;
  const c = stpCmpBid(a.bid, b.bid);
  if (c) return c;
  return a.pid === b.pid ? 0 : (a.pid < b.pid ? -1 : 1);
}
function stpOfferDiff(a, b) { // which field separated two offers
  if (a.cost !== b.cost) return 'cost';
  if (stpCmpBid(a.bid, b.bid)) return 'bid';
  return 'port';
}
// Root-port candidate vector: [cost, senderBid, senderPortId, localPortId] -> [index of first diff (-1 = equal), sign].
function stpVecCmp(a, b) {
  if (a[0] !== b[0]) return [0, a[0] < b[0] ? -1 : 1];
  const c = stpCmpBid(a[1], b[1]);
  if (c) return [1, c];
  if (a[2] !== b[2]) return [2, a[2] < b[2] ? -1 : 1];
  if (a[3] !== b[3]) return [3, a[3] < b[3] ? -1 : 1];
  return [-1, 0];
}

function stpElectOne(topo, vlan, dsw, dln) {
  const variant = topo.variant;
  const swById = stpMap();
  topo.switches.forEach(s => { swById[s.id] = s; });
  const swUp = id => !!swById[id] && swById[id].up !== false && !dsw.has(id);

  const bridges = stpMap();
  topo.switches.forEach(s => {
    const bid = stpBid(s, vlan, variant);
    bridges[s.id] = { bid, bidHex: bid.hex, up: swUp(s.id), rootId: null, rootCost: null, rootPort: null, isRoot: false };
  });

  // A segment is up when its flag is up and >= 2 ends sit on up switches (identical to
  // "any endpoint down => segment down" for 2-end links; a hub survives losing one member).
  const segs = topo.links.map(l => {
    const active = l.ends.filter(e => swUp(e.sw));
    return { l, cost: stpCost(l.speed, topo.cost, l.manual), active, up: l.up !== false && !dln.has(l.id) && active.length >= 2 };
  });

  // Components (union-find over up switches via up segments).
  const parent = stpMap();
  topo.switches.forEach(s => { if (bridges[s.id].up) parent[s.id] = s.id; });
  const find = x => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  segs.forEach(g => {
    if (!g.up) return;
    const r0 = find(g.active[0].sw);
    g.active.forEach(e => { parent[find(e.sw)] = r0; });
  });
  const groups = stpMap();
  topo.switches.forEach(s => {
    if (!bridges[s.id].up) return;
    const r = find(s.id);
    (groups[r] = groups[r] || []).push(s.id);
  });

  // Root bridge + root path cost per component.
  const components = [];
  Object.keys(groups).forEach(gk => {
    const members = groups[gk];
    const sorted = members.slice().sort((x, y) => stpCmpBid(bridges[x].bid, bridges[y].bid));
    const root = sorted[0];
    let rootDecided = 'only';
    if (sorted.length > 1) rootDecided = bridges[root].bid.pri !== bridges[sorted[1]].bid.pri ? 'priority' : 'mac';
    components.push({ root, rootDecided, members });
    const dist = stpMap();
    members.forEach(m => { dist[m] = Infinity; });
    dist[root] = 0;
    const done = new Set();
    for (;;) {
      let u = null;
      members.forEach(m => { if (!done.has(m) && dist[m] < Infinity && (u === null || dist[m] < dist[u])) u = m; });
      if (u === null) break;
      done.add(u);
      segs.forEach(g => {
        if (!g.up || !g.active.some(e => e.sw === u)) return;
        g.active.forEach(e => { if (e.sw !== u && dist[u] + g.cost < dist[e.sw]) dist[e.sw] = dist[u] + g.cost; });
      });
    }
    members.forEach(m => {
      bridges[m].rootId = root;
      bridges[m].rootCost = dist[m];
      bridges[m].isRoot = m === root;
    });
  });

  // Designated port per up segment: lowest (rootCost, BID, portId) offer.
  segs.forEach(g => {
    if (!g.up) return;
    g.offers = g.active.map(e => ({ e, cost: bridges[e.sw].rootCost, bid: bridges[e.sw].bid, pid: stpPortId(e) })).sort(stpCmpOffer);
    g.win = g.offers[0];
  });

  // Root port per non-root bridge: best vector heard from a designated port on another bridge.
  const rootDecidedBy = stpMap();
  topo.switches.forEach(s => {
    const b = bridges[s.id];
    if (!b.up || b.isRoot) return;
    const cands = [];
    segs.forEach(g => {
      if (!g.up || g.win.e.sw === s.id) return;
      g.active.forEach(p => {
        if (p.sw !== s.id) return;
        cands.push({ key: s.id + ':' + p.portNum, vec: [g.win.cost + g.cost, g.win.bid, g.win.pid, stpPortId(p)] });
      });
    });
    if (!cands.length) return;
    cands.sort((x, y) => stpVecCmp(x.vec, y.vec)[1]);
    b.rootPort = cands[0].key;
    rootDecidedBy[cands[0].key] = cands.length === 1 ? 'only' : STP_VEC_NAMES[stpVecCmp(cands[0].vec, cands[1].vec)[0]];
  });

  // Roles for every port (ports on down segments / down switches are disabled).
  const ports = stpMap();
  segs.forEach(g => {
    g.l.ends.forEach(e => {
      const key = e.sw + ':' + e.portNum;
      const b = bridges[e.sw];
      const rec = { sw: e.sw, portNum: +e.portNum, portId: stpPortId(e), linkId: g.l.id, role: 'disabled', decided: '', cost: g.cost, rpc: null };
      ports[key] = rec;
      if (!g.up || !b.up) return;
      rec.rpc = b.rootCost;
      const mine = g.offers.find(o => o.e === e);
      if (g.win === mine) {
        rec.role = 'designated';
        rec.decided = stpOfferDiff(g.win, g.offers[1]);
      } else if (b.rootPort === key) {
        rec.role = 'root';
        rec.decided = rootDecidedBy[key];
      } else {
        rec.role = g.win.e.sw === e.sw ? 'backup' : 'alternate';
        rec.decided = stpOfferDiff(mine, g.win);
      }
    });
  });

  return { components, bridges, ports };
}

// whatIf = { links: [linkId], switches: [swId] } forced down on top of the topology.
function stpElect(topo, whatIf) {
  const wi = whatIf || {};
  const dsw = new Set(wi.switches || []), dln = new Set(wi.links || []);
  const byVlan = {};
  stpVlanKeys(topo).forEach(v => { byVlan[v] = stpElectOne(topo, v, dsw, dln); });
  return { byVlan };
}

// Port-role changes between two per-VLAN results (result.byVlan[v]).
function stpDiff(before, after) {
  const out = [];
  Object.keys(after.ports).forEach(k => {
    const a = before.ports[k], b = after.ports[k];
    if (a && a.role !== b.role) out.push({ key: k, sw: b.sw, port: b.portNum, from: a.role, to: b.role });
  });
  return out;
}

// Computed role -> displayed role/state for the selected protocol variant.
function stpLabel(role, variant) {
  const rapid = variant === 'rstp' || variant === 'rpvst';
  if (role === 'root' || role === 'designated') return { role, state: 'forwarding' };
  if (role === 'disabled') return { role, state: rapid ? 'discarding' : 'disabled' };
  return rapid ? { role, state: 'discarding' } : { role: 'non_designated', state: 'blocking' };
}

// Mermaid label text is user input (names arrive via share URLs) and the shared loader runs
// securityLevel 'loose' + htmlLabels: whitelist letters/digits/space/_.:/+@- only.
function stpSafe(s, fallback) {
  const o = String(s == null ? '' : s).replace(/[^\p{L}\p{N} _.:\/+@-]/gu, '').trim().slice(0, 24);
  return o || fallback;
}

// res = result.byVlan[v]. Node ids are generated (s0, s1, h0 ...), never derived from names.
function stpMermaid(topo, res) {
  const idx = stpMap();
  topo.switches.forEach((s, i) => { idx[s.id] = 's' + i; });
  const L = ['flowchart LR'];
  topo.switches.forEach((s, i) => {
    const b = res.bridges[s.id];
    L.push('  s' + i + '["' + stpSafe(s.name, 'SW' + (i + 1)) + '<br/>' + b.bidHex + '"]');
  });
  const fwd = p => !!p && (p.role === 'root' || p.role === 'designated');
  const lab = e => {
    const p = res.ports[e.sw + ':' + e.portNum];
    return 'p' + (parseInt(e.portNum, 10) || 0) + ' ' + STP_ABBR[p ? p.role : 'disabled'];
  };
  let h = 0;
  topo.links.forEach(l => {
    const ends = l.ends.filter(e => idx[e.sw]);
    if (ends.length < 2) return;
    const shared = ends.length !== 2 || ends[0].sw === ends[1].sw;
    if (shared) {
      L.push('  h' + h + '(("~"))');
      ends.forEach(e => {
        const ok = fwd(res.ports[e.sw + ':' + e.portNum]);
        L.push('  ' + idx[e.sw] + (ok ? ' ---' : ' -.-') + '|"' + lab(e) + '"| h' + h);
      });
      h++;
    } else {
      const ok = fwd(res.ports[ends[0].sw + ':' + ends[0].portNum]) && fwd(res.ports[ends[1].sw + ':' + ends[1].portNum]);
      L.push('  ' + idx[ends[0].sw] + (ok ? ' ---' : ' -.-') + '|"' + lab(ends[0]) + ' · ' + lab(ends[1]) + '"| ' + idx[ends[1].sw]);
    }
  });
  L.push('  classDef root fill:#00d4c822,stroke:#00d4c8,stroke-width:3px;');
  L.push('  classDef down stroke-dasharray:4 3,opacity:0.5;');
  topo.switches.forEach((s, i) => {
    const b = res.bridges[s.id];
    if (!b.up) L.push('  class s' + i + ' down;');
    else if (b.isRoot) L.push('  class s' + i + ' root;');
  });
  return L.join('\n');
}

// Preset builder. sws: [name, priority, overrides?]; links: ['A', 'B:2', 'A:3', '10G'] (last = speed;
// endpoints are 'name' or 'name:port', ports auto-number per switch).
function stpBuild(variant, cost, vlans, sws, links) {
  const switches = sws.map((d, i) => Object.assign({
    id: 'sw' + (i + 1), name: d[0], pri: d[1],
    mac: 'aabb.cc00.' + (i + 1).toString(16).padStart(2, '0') + '00', up: true, vlanPri: {},
  }, d[2] || {}));
  const used = {};
  const idOf = n => switches.find(s => s.name === n).id;
  return {
    variant, cost, vlans, switches,
    links: links.map((d, i) => ({
      id: 'l' + (i + 1), speed: d[d.length - 1], manual: '', up: true,
      ends: d.slice(0, -1).map(x => {
        const [n, p] = x.split(':');
        const sw = idOf(n);
        const portNum = p ? +p : (used[sw] || 0) + 1;
        used[sw] = Math.max(used[sw] || 0, portNum);
        return { sw, portNum, portPri: 128 };
      }),
    })),
  };
}
const STP_PRESET_ORDER = ['triangle', 'square_mixed', 'dual_uplink', 'hub_backup', 'campus'];
const STP_PRESETS = {
  triangle: () => stpBuild('rpvst', 'long', [1], [['SW-A', 4096], ['SW-B', 32768], ['SW-C', 32768]],
    [['SW-A', 'SW-B', '1G'], ['SW-A', 'SW-C', '1G'], ['SW-B', 'SW-C', '1G']]),
  square_mixed: () => stpBuild('rstp', 'long', [1], [['SW-R', 4096], ['SW-A', 32768], ['SW-B', 32768], ['SW-D', 32768]],
    [['SW-R', 'SW-A', '10G'], ['SW-A', 'SW-B', '10G'], ['SW-B', 'SW-D', '10G'], ['SW-D', 'SW-R', '1G']]),
  dual_uplink: () => stpBuild('rstp', 'long', [1], [['SW-R', 4096], ['SW-D', 32768]],
    [['SW-R:1', 'SW-D:2', '1G'], ['SW-R:2', 'SW-D:1', '1G']]),
  hub_backup: () => stpBuild('rstp', 'long', [1], [['SW-R', 4096], ['SW-D', 32768]],
    [['SW-R:1', 'SW-R:2', 'SW-D:1', '100M']]),
  campus: () => stpBuild('rpvst', 'long', [10, 20],
    [['CORE-1', 32768], ['CORE-2', 32768],
      ['DIST-1', 32768, { vlanPri: { 10: 4096, 20: 8192 } }], ['DIST-2', 32768, { vlanPri: { 10: 8192, 20: 4096 } }],
      ['ACC-1', 32768], ['ACC-2', 32768], ['ACC-3', 32768]],
    [['CORE-1', 'CORE-2', '10G'], ['CORE-1', 'DIST-1', '10G'], ['CORE-1', 'DIST-2', '10G'],
      ['CORE-2', 'DIST-1', '10G'], ['CORE-2', 'DIST-2', '10G'], ['DIST-1', 'DIST-2', '10G'],
      ['ACC-1', 'DIST-1', '1G'], ['ACC-1', 'DIST-2', '1G'], ['ACC-2', 'DIST-1', '1G'],
      ['ACC-2', 'DIST-2', '1G'], ['ACC-3', 'DIST-1', '1G'], ['ACC-3', 'DIST-2', '1G']]),
};
// </stp-engine>

// Untrusted input (share URL / persisted state): rebuild a well-typed topology or return null.
// Value checks stay in stpValidate; this only guarantees shape.
function stpCoerce(raw) {
  try {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.switches) || !Array.isArray(raw.links)) return null;
    if (raw.switches.length > STP_MAX_SW || raw.links.length > STP_MAX_LINKS) return null;
    const str = (v, d) => (typeof v === 'string' || typeof v === 'number' ? String(v) : d);
    const switches = raw.switches.map((s, i) => {
      const vp = {};
      if (s && s.vlanPri && typeof s.vlanPri === 'object') {
        Object.keys(s.vlanPri).forEach(k => {
          const v = s.vlanPri[k];
          if (/^\d{1,4}$/.test(k) && (typeof v === 'string' || typeof v === 'number')) vp[k] = String(v);
        });
      }
      return {
        id: str(s && s.id, 'sw' + (i + 1)), name: str(s && s.name, ''), pri: str(s && s.pri, '32768'),
        mac: str(s && s.mac, ''), up: !(s && s.up === false), vlanPri: vp,
      };
    });
    const links = raw.links.map((l, i) => ({
      id: str(l && l.id, 'l' + (i + 1)), speed: str(l && l.speed, '1G'), manual: str(l && l.manual, ''),
      up: !(l && l.up === false),
      ends: Array.isArray(l && l.ends)
        ? l.ends.slice(0, STP_MAX_SW).map(e => ({ sw: str(e && e.sw, ''), portNum: str(e && e.portNum, ''), portPri: str(e && e.portPri, '128') }))
        : [],
    }));
    return {
      variant: STP_VARIANTS.includes(raw.variant) ? raw.variant : 'rpvst',
      cost: raw.cost === 'short' ? 'short' : 'long',
      vlans: Array.isArray(raw.vlans) ? raw.vlans.slice(0, STP_MAX_VLANS + 1).map(Number) : [1],
      switches, links,
    };
  } catch (e) { return null; }
}
function stpCoerceWhatIf(raw) {
  const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 64) : []);
  return { links: arr(raw && raw.links), switches: arr(raw && raw.switches) };
}

function useStpDebounced(value, ms) {
  const [d, setD] = useState(value);
  useEffect(() => {
    const h = setTimeout(() => setD(value), ms);
    return () => clearTimeout(h);
  }, [value, ms]);
  return d;
}

const STP_TABS = ['simulator', 'reference'];
const STP_ROLE_COL = {
  root: 'var(--cyan)', designated: 'var(--green)', alternate: 'var(--yellow)',
  backup: 'var(--purple)', non_designated: 'var(--red)', disabled: 'var(--muted)',
};
const STP_REF_ORDER = [
  ['ref_rb_title', ['ref_rb_1', 'ref_rb_2']],
  ['ref_rp_title', ['ref_rp_1', 'ref_rp_2', 'ref_rp_3', 'ref_rp_4']],
  ['ref_dp_title', ['ref_dp_1', 'ref_dp_2', 'ref_dp_3']],
];
let stpRenderSeq = 0;

function STPSimulator({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const T = (k, v) => t('stp_simulator.' + k, v);

  const [activeTab, setActiveTab] = usePersistentState('stp-simulator:activeTab', initialData?.activeTab ?? 'simulator');
  const [topo, setTopo] = usePersistentState('stp-simulator:topo', () => stpCoerce(initialData?.topo) || STP_PRESETS.triangle());
  const [whatIf, setWhatIf] = usePersistentState('stp-simulator:whatIf', () => stpCoerceWhatIf(initialData?.whatIf));
  const [vlan, setVlan] = usePersistentState('stp-simulator:vlan', Number(initialData?.vlan) || 0);
  const [view, setView] = useState('scenario');
  const [vlanText, setVlanText] = useState(() => topo.vlans.join(', '));
  const [svg, setSvg] = useState('');
  const [mermaidFailed, setMermaidFailed] = useState(false);

  const skipNavReport = useRef(false);
  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
  }, [initialData]);
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({ tool: 'stp-simulator', activeTab, topo, whatIf, vlan });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [onShare, activeTab, topo, whatIf, vlan]);

  useEffect(() => {
    const parsed = vlanText.split(/[,\s]+/).filter(Boolean).map(Number);
    if (parsed.join(',') !== topo.vlans.join(',')) setVlanText(topo.vlans.join(', '));
  }, [topo.vlans]);

  // ── mutators ──
  const upd = (patch) => setTopo(tp => ({ ...tp, ...patch }));
  const updSw = (id, patch) => setTopo(tp => ({ ...tp, switches: tp.switches.map(s => (s.id === id ? { ...s, ...patch } : s)) }));
  const updLink = (id, patch) => setTopo(tp => ({ ...tp, links: tp.links.map(l => (l.id === id ? { ...l, ...patch } : l)) }));
  const updEnd = (lid, i, patch) => setTopo(tp => ({
    ...tp,
    links: tp.links.map(l => (l.id === lid ? { ...l, ends: l.ends.map((e, j) => (j === i ? { ...e, ...patch } : e)) } : l)),
  }));
  const nextPort = (tp, sw) => {
    const used = new Set();
    tp.links.forEach(l => l.ends.forEach(e => { if (e.sw === sw) used.add(+e.portNum); }));
    let n = 1;
    while (used.has(n)) n++;
    return n;
  };
  const nextId = (prefix, list) => {
    let n = list.length + 1;
    while (list.some(x => x.id === prefix + n)) n++;
    return prefix + n;
  };
  const applyPreset = (id) => {
    if (!STP_PRESETS[id]) return;
    setTopo(STP_PRESETS[id]());
    setWhatIf({ links: [], switches: [] });
    setVlan(0);
    setView('scenario');
  };
  const addSwitch = () => setTopo(tp => {
    if (tp.switches.length >= STP_MAX_SW) return tp;
    const id = nextId('sw', tp.switches);
    const usedN = new Set(tp.switches.map(s => s.name));
    const letter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(l => !usedN.has('SW-' + l));
    const macs = new Set(tp.switches.map(s => stpMac(s.mac)));
    let i = tp.switches.length + 1, mac;
    do { mac = 'aabb.cc00.' + i.toString(16).padStart(2, '0') + '00'; i++; } while (macs.has(stpMac(mac)));
    return { ...tp, switches: [...tp.switches, { id, name: 'SW-' + (letter || id), pri: '32768', mac, up: true, vlanPri: {} }] };
  });
  const removeSwitch = (id) => {
    setTopo(tp => ({
      ...tp,
      switches: tp.switches.filter(s => s.id !== id),
      links: tp.links.map(l => ({ ...l, ends: l.ends.filter(e => e.sw !== id) })).filter(l => l.ends.length >= 2),
    }));
    setWhatIf(w => ({ ...w, switches: w.switches.filter(x => x !== id) }));
  };
  const addLink = () => setTopo(tp => {
    if (tp.links.length >= STP_MAX_LINKS || tp.switches.length < 2) return tp;
    const a = tp.switches[0].id, b = tp.switches[1].id;
    const end = (sw, extra) => ({ sw, portNum: nextPort(tp, sw) + extra, portPri: '128' });
    return { ...tp, links: [...tp.links, { id: nextId('l', tp.links), speed: '1G', manual: '', up: true, ends: [end(a, 0), end(b, 0)] }] };
  });
  const removeLink = (id) => {
    setTopo(tp => ({ ...tp, links: tp.links.filter(l => l.id !== id) }));
    setWhatIf(w => ({ ...w, links: w.links.filter(x => x !== id) }));
  };
  const addEnd = (lid) => setTopo(tp => ({
    ...tp,
    links: tp.links.map(l => {
      if (l.id !== lid || l.ends.length >= STP_MAX_SW) return l;
      const sw = tp.switches[0] ? tp.switches[0].id : '';
      const taken = new Set(l.ends.filter(e => e.sw === sw).map(e => +e.portNum));
      let n = nextPort(tp, sw);
      while (taken.has(n)) n++;
      return { ...l, ends: [...l.ends, { sw, portNum: n, portPri: '128' }] };
    }),
  }));
  const removeEnd = (lid, i) => setTopo(tp => ({
    ...tp,
    links: tp.links.map(l => (l.id === lid && l.ends.length > 2 ? { ...l, ends: l.ends.filter((_, j) => j !== i) } : l)),
  }));
  const toggleWi = (kind, id) => setWhatIf(w => ({
    ...w, [kind]: w[kind].includes(id) ? w[kind].filter(x => x !== id) : [...w[kind], id],
  }));

  // ── election (debounced; silent on incomplete input) ──
  const dTopo = useStpDebounced(topo, 300);
  const dWhatIf = useStpDebounced(whatIf, 300);
  const vErr = useMemo(() => stpValidate(dTopo), [dTopo]);
  const error = vErr && vErr.key ? t(vErr.key, vErr.vars) : '';
  const wiActive = dWhatIf.links.length + dWhatIf.switches.length > 0;
  const scen = useMemo(() => (vErr ? null : stpElect(dTopo, dWhatIf)), [vErr, dTopo, dWhatIf]);
  const base = useMemo(() => (vErr || !wiActive ? null : stpElect(dTopo, {})), [vErr, wiActive, dTopo]);
  const shown = wiActive && view === 'baseline' ? base : scen;
  const keys = stpVlanKeys(dTopo);
  const curV = keys.includes(+vlan) ? +vlan : keys[0];
  const R = shown && shown.byVlan[curV];
  const B0 = base && base.byVlan[curV];
  const S0 = scen && scen.byVlan[curV];
  const pvst = stpIsPvst(dTopo.variant);
  const swName = id => stpSwName(dTopo, id);
  const linkOf = id => dTopo.links.find(l => l.id === id);

  const rows = useMemo(() => {
    if (!R) return [];
    const order = {};
    dTopo.switches.forEach((s, i) => { order[s.id] = i; });
    return Object.keys(R.ports).map(k => R.ports[k])
      .sort((a, b) => order[a.sw] - order[b.sw] || a.portNum - b.portNum);
  }, [R, dTopo]);

  const diff = useMemo(() => (B0 && S0 ? stpDiff(B0, S0) : []), [B0, S0]);
  const rootNames = (r) => r.components.map(c => swName(c.root)).sort().join(', ');
  const rootChanged = !!(B0 && S0 && rootNames(B0) !== rootNames(S0));

  const mermaidSrc = useMemo(() => (R ? stpMermaid(dTopo, R) : ''), [R, dTopo]);
  useEffect(() => {
    if (!mermaidSrc) { setSvg(''); setMermaidFailed(false); return undefined; }
    let dead = false;
    const id = 'stp-mmd-' + Date.now() + '-' + (stpRenderSeq++);
    window.ensureMermaid()
      .then(m => m.render(id, mermaidSrc))
      .then(out => { if (!dead) { setSvg(out.svg); setMermaidFailed(false); } })
      .catch(() => {
        const leftover = document.getElementById('d' + id);
        if (leftover) leftover.remove();
        if (!dead) { setSvg(''); setMermaidFailed(true); }
      });
    return () => { dead = true; };
  }, [mermaidSrc]);

  const roleText = (role) => {
    const l = stpLabel(role, dTopo.variant);
    return T('role_' + l.role) + ' / ' + T('state_' + l.state);
  };
  const decidedText = (p) => (p.decided ? T('decided_' + p.decided) : '—');
  const rootWhy = (c) => {
    const b = R.bridges[c.root];
    if (c.rootDecided === 'only') return T('root_why_only');
    return T(c.rootDecided === 'priority' ? 'root_why_priority' : 'root_why_mac', { pri: b.bid.pri });
  };
  const goSwitchingRef = () => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: 'switching-ref' } }));

  const tsv = useMemo(() => {
    if (!R) return '';
    const head = ['col_switch', 'col_port', 'col_portid', 'col_link', 'col_cost', 'col_rpc', 'col_role', 'col_state', 'col_decided'].map(T);
    const body = rows.map(p => {
      const l = stpLabel(p.role, dTopo.variant);
      const lk = linkOf(p.linkId);
      return [swName(p.sw), p.portNum, Math.floor(p.portId / 256) + '.' + p.portNum, lk ? stpLinkName(dTopo, lk) : '',
        p.cost, p.rpc == null ? '' : p.rpc, T('role_' + l.role), T('state_' + l.state), decidedText(p)].join('\t');
    });
    return [head.join('\t'), ...body].join('\n');
  }, [R, rows, dTopo, t]);

  const td = { padding: '5px 6px', verticalAlign: 'middle', borderBottom: '1px solid var(--border)' };
  const th = { ...td, color: 'var(--muted)', whiteSpace: 'nowrap', fontSize: 12, textAlign: 'left' };
  const mono = { fontFamily: 'var(--mono)' };
  const sel = (extra) => ({ width: 'auto', fontSize: 12, ...extra });
  const shortCap = dTopo.cost === 'short' && dTopo.links.some(l => ['25G', '40G', '100G', '400G'].includes(l.speed));
  const hasShared = dTopo.links.some(l => l.ends.length > 2);

  const swSelect = (value, onChange) => (
    <select className="select" value={value} onChange={e => onChange(e.target.value)} style={sel()}>
      {!topo.switches.some(s => s.id === value) && <option value={value}>?</option>}
      {topo.switches.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
    </select>
  );

  const header = (
    <div className="card" style={{ marginBottom: 12 }}>
      <div className="card-title">{T('title')}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{T('subtitle')}</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {STP_TABS.map(id => (
          <button key={id} className={`btn btn-sm ${activeTab === id ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 12 }}
            onClick={() => setActiveTab(id)}>{T('tab_' + id)}</button>
        ))}
      </div>
    </div>
  );

  const footer = (
    <div className="card">
      <div className="hint" style={{ marginBottom: 6 }}>{T('link_switching_hint')}</div>
      <button className="btn btn-sm btn-ghost" onClick={goSwitchingRef}>{T('link_switching_ref')}</button>
    </div>
  );

  if (activeTab === 'reference') {
    return (
      <div className="fadein">
        {header}
        <div className="card">
          <div className="card-title">{T('ref_title')}</div>
          <div className="hint" style={{ marginBottom: 12 }}>{T('ref_intro')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 12 }}>
            {STP_REF_ORDER.map(([title, steps]) => (
              <div key={title} style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--card)' }}>
                <div style={{ fontWeight: 600, marginBottom: 6 }}>{T(title)}</div>
                <ol style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6 }}>
                  {steps.map(k => <li key={k}>{T(k)}</li>)}
                </ol>
              </div>
            ))}
          </div>
          <div className="hint" style={{ marginTop: 12 }}>{T('ref_note_cost')}</div>
          <div className="hint" style={{ marginTop: 6 }}>{T('ref_note_pvst')}</div>
          <div className="hint" style={{ marginTop: 6 }}>{T('ref_note_backup')}</div>
        </div>
        {footer}
      </div>
    );
  }

  return (
    <div className="fadein">
      {header}

      <div className="card">
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div>
            <div className="label">{T('preset_label')}</div>
            <select className="select" value="" onChange={e => applyPreset(e.target.value)} style={sel()}>
              <option value="">{T('preset_pick')}</option>
              {STP_PRESET_ORDER.map(id => <option key={id} value={id}>{T('preset_' + id)}</option>)}
            </select>
          </div>
          <div>
            <div className="label">{T('variant_label')}</div>
            <select className="select" value={topo.variant} onChange={e => upd({ variant: e.target.value })} style={sel()}>
              {STP_VARIANTS.map(v => <option key={v} value={v}>{T('variant_' + v)}</option>)}
            </select>
          </div>
          <div>
            <div className="label">{T('cost_label')}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {['short', 'long'].map(m => (
                <button key={m} className={`btn btn-sm ${topo.cost === m ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => upd({ cost: m })}>{T('cost_' + m)}</button>
              ))}
            </div>
          </div>
          {stpIsPvst(topo.variant) && (
            <div>
              <div className="label">{T('vlan_list_label')}</div>
              <input className="input" value={vlanText} style={{ ...mono, width: 150 }}
                onChange={e => {
                  setVlanText(e.target.value);
                  upd({ vlans: e.target.value.split(/[,\s]+/).filter(Boolean).map(Number) });
                }} />
            </div>
          )}
          {pvst && keys.length > 1 && (
            <div>
              <div className="label">{T('vlan_select_label')}</div>
              <select className="select" value={curV} onChange={e => setVlan(+e.target.value)} style={sel()}>
                {keys.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          )}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>{T('cost_hint')}</div>
        {shortCap && <div className="hint" style={{ marginTop: 4 }}>{T('hint_short_cap')}</div>}
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{T('sw_title')}</div>
          <button className="btn btn-sm" disabled={topo.switches.length >= STP_MAX_SW} onClick={addSwitch}>{T('sw_add')}</button>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>{T('sw_name')}</th><th style={th}>{T('sw_priority')}</th><th style={th}>{T('sw_mac')}</th>
                <th style={th}>{T('sw_up')}</th>{stpIsPvst(topo.variant) && <th style={th}>{T('sw_vlan_pri')}</th>}<th style={th} />
              </tr>
            </thead>
            <tbody>
              {topo.switches.map(s => (
                <tr key={s.id}>
                  <td style={td}><input className="input" value={s.name} maxLength={16} style={{ width: 110, fontSize: 12 }}
                    onChange={e => updSw(s.id, { name: e.target.value })} /></td>
                  <td style={td}>
                    <select className="select" value={String(s.pri)} onChange={e => updSw(s.id, { pri: e.target.value })} style={sel(mono)}>
                      {!STP_PRIORITIES.map(String).includes(String(s.pri)) && <option value={String(s.pri)}>{s.pri}</option>}
                      {STP_PRIORITIES.map(p => <option key={p} value={String(p)}>{p}</option>)}
                    </select>
                  </td>
                  <td style={td}><input className="input" value={s.mac} style={{ ...mono, width: 150, fontSize: 12 }}
                    onChange={e => updSw(s.id, { mac: e.target.value })} /></td>
                  <td style={td}><input type="checkbox" checked={s.up !== false} onChange={e => updSw(s.id, { up: e.target.checked })} /></td>
                  {stpIsPvst(topo.variant) && (
                    <td style={td}>
                      <details>
                        <summary style={{ cursor: 'pointer', fontSize: 12 }}>
                          {T('sw_vlan_pri_n', { n: topo.vlans.filter(v => !stpBlank((s.vlanPri || {})[v])).length })}
                        </summary>
                        <div style={{ display: 'grid', gap: 4, marginTop: 6 }}>
                          {topo.vlans.map(v => (
                            <label key={v} style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 12 }}>
                              <span style={mono}>VLAN {v}</span>
                              <select className="select" value={String((s.vlanPri || {})[v] ?? '')} style={sel(mono)}
                                onChange={e => updSw(s.id, { vlanPri: { ...(s.vlanPri || {}), [v]: e.target.value } })}>
                                <option value="">{T('sw_vlan_pri_base')}</option>
                                {STP_PRIORITIES.map(p => <option key={p} value={String(p)}>{p}</option>)}
                              </select>
                            </label>
                          ))}
                        </div>
                      </details>
                    </td>
                  )}
                  <td style={td}>
                    <button className="btn btn-ghost btn-sm" aria-label={T('sw_remove')} disabled={topo.switches.length <= 2}
                      onClick={() => removeSwitch(s.id)}>{'×'}</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{T('link_title')}</div>
          <button className="btn btn-sm" disabled={topo.links.length >= STP_MAX_LINKS || topo.switches.length < 2} onClick={addLink}>{T('link_add')}</button>
        </div>
        <div style={{ display: 'grid', gap: 8 }}>
          {topo.links.map(l => (
            <div key={l.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 8, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              {l.ends.map((e, i) => (
                <div key={i} style={{ display: 'flex', gap: 4, alignItems: 'flex-end' }}>
                  <div><div className="label">{T('link_end')} {i + 1}</div>{swSelect(e.sw, v => updEnd(l.id, i, { sw: v }))}</div>
                  <div><div className="label">{T('link_port')}</div>
                    <input className="input" value={e.portNum} style={{ ...mono, width: 56, fontSize: 12 }} inputMode="numeric"
                      onChange={ev => updEnd(l.id, i, { portNum: ev.target.value })} /></div>
                  <div><div className="label">{T('link_port_pri')}</div>
                    <select className="select" value={String(e.portPri)} style={sel(mono)} onChange={ev => updEnd(l.id, i, { portPri: ev.target.value })}>
                      {STP_PORT_PRIOS.map(p => <option key={p} value={String(p)}>{p}</option>)}
                    </select></div>
                  {l.ends.length > 2 && (
                    <button className="btn btn-ghost btn-sm" aria-label={T('link_remove_end')} onClick={() => removeEnd(l.id, i)}>{'×'}</button>
                  )}
                </div>
              ))}
              <div><div className="label">{T('link_speed')}</div>
                <select className="select" value={l.speed} style={sel()} onChange={e => updLink(l.id, { speed: e.target.value })}>
                  {STP_SPEEDS.map(sp => <option key={sp} value={sp}>{sp}</option>)}
                </select></div>
              <div><div className="label">{T('link_manual')}</div>
                <input className="input" value={l.manual} placeholder={String(stpCost(l.speed, topo.cost, ''))} inputMode="numeric"
                  style={{ ...mono, width: 96, fontSize: 12 }} onChange={e => updLink(l.id, { manual: e.target.value })} /></div>
              <label style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, paddingBottom: 6 }}>
                <input type="checkbox" checked={l.up !== false} onChange={e => updLink(l.id, { up: e.target.checked })} />
                {T('link_up')}
              </label>
              <button className="btn btn-ghost btn-sm" disabled={l.ends.length >= STP_MAX_SW} onClick={() => addEnd(l.id)}>{T('link_add_end')}</button>
              <button className="btn btn-ghost btn-sm" aria-label={T('link_remove')} onClick={() => removeLink(l.id)}>{'×'}</button>
            </div>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>{T(hasShared ? 'hint_shared' : 'hint_links')}</div>
      </div>

      <Err msg={error} />

      {R && (
        <div className="card" style={{ borderLeft: '3px solid var(--cyan)' }}>
          {wiActive && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 8, flexWrap: 'wrap' }}>
              <span className="hint">{T('whatif_showing')}</span>
              {['scenario', 'baseline'].map(v => (
                <button key={v} className={`btn btn-sm ${view === v ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setView(v)}>{T('whatif_view_' + v)}</button>
              ))}
            </div>
          )}
          {R.components.map(c => (
            <div key={c.root} style={{ ...mono, fontSize: 14, marginBottom: 4 }}>
              {T('root_line', { name: swName(c.root), bid: R.bridges[c.root].bidHex, why: rootWhy(c), n: c.members.length })}
            </div>
          ))}
          {R.components.length > 1 && <div className="hint">{T('partition_note', { n: R.components.length })}</div>}
          {pvst && shown && (
            <div style={{ ...mono, fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>
              {keys.map(v => T('pvst_strip_item', { vlan: v, name: shown.byVlan[v].components.map(c => swName(c.root)).join('/') })).join(' · ')}
            </div>
          )}
        </div>
      )}

      {R && (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>{T('ports_title')}{pvst ? ' — VLAN ' + curV : ''}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('common.copy_all')}</span>
              <CopyBtn text={tsv} label="copy_all" id="stp-ports" />
            </div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr>{['col_switch', 'col_port', 'col_portid', 'col_link', 'col_cost', 'col_rpc', 'col_role', 'col_state', 'col_decided']
                  .map(k => <th key={k} style={th}>{T(k)}</th>)}</tr>
              </thead>
              <tbody>
                {rows.map(p => {
                  const l = stpLabel(p.role, dTopo.variant);
                  const lk = linkOf(p.linkId);
                  return (
                    <tr key={p.sw + ':' + p.portNum}>
                      <td style={td}>{swName(p.sw)}</td>
                      <td style={{ ...td, ...mono }}>{p.portNum}</td>
                      <td style={{ ...td, ...mono }}>{Math.floor(p.portId / 256) + '.' + p.portNum}</td>
                      <td style={{ ...td, ...mono }}>{lk ? stpLinkName(dTopo, lk) : ''}</td>
                      <td style={{ ...td, ...mono }}>{p.cost}</td>
                      <td style={{ ...td, ...mono }}>{p.rpc == null ? '—' : p.rpc}</td>
                      <td style={{ ...td, color: STP_ROLE_COL[l.role], fontWeight: 600 }}>{T('role_' + l.role)}</td>
                      <td style={td}>{T('state_' + l.state)}</td>
                      <td style={td}>{decidedText(p)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {R && (
        <div className="card">
          <div className="card-title">{T('summary_title')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead>
                <tr>{['col_switch', 'col_bid', 'col_root', 'col_root_port', 'col_rpc', 'col_fwd', 'col_blocked']
                  .map(k => <th key={k} style={th}>{T(k)}</th>)}</tr>
              </thead>
              <tbody>
                {dTopo.switches.map(s => {
                  const b = R.bridges[s.id];
                  const mine = rows.filter(p => p.sw === s.id);
                  const fwdN = mine.filter(p => p.role === 'root' || p.role === 'designated').length;
                  const blkN = mine.filter(p => p.role === 'alternate' || p.role === 'backup').length;
                  return (
                    <tr key={s.id} style={{ opacity: b.up ? 1 : 0.5 }}>
                      <td style={td}>{s.name}</td>
                      <td style={{ ...td, ...mono }}>{b.bidHex}</td>
                      <td style={td}>{b.up ? (b.isRoot ? T('yes_root') : '') : T('sw_down')}</td>
                      <td style={{ ...td, ...mono }}>{b.rootPort ? b.rootPort.split(':')[1] : '—'}</td>
                      <td style={{ ...td, ...mono }}>{b.rootCost == null ? '—' : b.rootCost}</td>
                      <td style={{ ...td, ...mono }}>{fwdN}</td>
                      <td style={{ ...td, ...mono }}>{blkN}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {R && (
        <div className="card">
          <div className="card-title">{T('topo_title')}</div>
          {svg && <div style={{ overflowX: 'auto' }} dangerouslySetInnerHTML={{ __html: svg }} />}
          {!svg && !mermaidFailed && <div className="hint">{T('topo_loading')}</div>}
          {mermaidFailed && (
            <div>
              <Err msg={T('err_mermaid')} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span className="hint">{T('topo_source')}</span>
                <CopyBtn text={mermaidSrc} label="copy" id="stp-mermaid" />
              </div>
              <pre style={{ ...mono, fontSize: 11, overflowX: 'auto', margin: '6px 0 0' }}>{mermaidSrc}</pre>
            </div>
          )}
          <div className="hint" style={{ marginTop: 8 }}>{T('topo_hint')}</div>
        </div>
      )}

      {!error && (
        <div className="card">
          <div className="card-title">{T('whatif_title')}</div>
          <div className="hint" style={{ marginBottom: 8 }}>{T('whatif_hint')}</div>
          <div className="label">{T('whatif_links')}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            {topo.links.map(l => (
              <label key={l.id} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, ...mono }}>
                <input type="checkbox" checked={whatIf.links.includes(l.id)} onChange={() => toggleWi('links', l.id)} />
                {stpLinkName(topo, l)}
              </label>
            ))}
          </div>
          <div className="label">{T('whatif_switches')}</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            {topo.switches.map(s => (
              <label key={s.id} style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12, ...mono }}>
                <input type="checkbox" checked={whatIf.switches.includes(s.id)} onChange={() => toggleWi('switches', s.id)} />
                {s.name}
              </label>
            ))}
          </div>
          {(whatIf.links.length + whatIf.switches.length > 0) && (
            <button className="btn btn-sm btn-ghost" onClick={() => setWhatIf({ links: [], switches: [] })}>{T('whatif_clear')}</button>
          )}
          {R && wiActive && (
            <div style={{ marginTop: 12 }}>
              <div className="card-title">{T('diff_title')}{pvst ? ' — VLAN ' + curV : ''}</div>
              {rootChanged && (
                <div style={{ ...mono, color: 'var(--yellow)', marginBottom: 6 }}>
                  {T('diff_root_changed', { from: rootNames(B0), to: rootNames(S0) })}
                </div>
              )}
              {diff.length === 0 ? <div className="hint">{T('diff_none')}</div> : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr>{['col_switch', 'col_port', 'diff_before', 'diff_after'].map(k => <th key={k} style={th}>{T(k)}</th>)}</tr></thead>
                    <tbody>
                      {diff.map(d => (
                        <tr key={d.key}>
                          <td style={td}>{swName(d.sw)}</td>
                          <td style={{ ...td, ...mono }}>{d.port}</td>
                          <td style={{ ...td, color: STP_ROLE_COL[stpLabel(d.from, dTopo.variant).role] }}>{T('role_' + stpLabel(d.from, dTopo.variant).role)}</td>
                          <td style={{ ...td, color: STP_ROLE_COL[stpLabel(d.to, dTopo.variant).role], fontWeight: 600 }}>{T('role_' + stpLabel(d.to, dTopo.variant).role)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {footer}
    </div>
  );
}

window.STPSimulator = STPSimulator;
