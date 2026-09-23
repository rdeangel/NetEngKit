const { useState, useEffect, useMemo, useRef } = React;

// <bgpbp-engine>
const BGPBP_MAX32 = 4294967295;
const BGPBP_DIALECTS = ['cisco', 'junos', 'arista', 'rfc'];
const BGPBP_STEPS = {
  cisco:  ['weight', 'localpref', 'local', 'aspath', 'origin', 'med', 'peer', 'igp', 'oldest', 'rid', 'cluster', 'nbr'],
  arista: ['weight', 'localpref', 'local', 'aspath', 'origin', 'med', 'peer', 'igp', 'oldest', 'rid', 'cluster', 'nbr'],
  junos:  ['localpref', 'aspath', 'origin', 'med', 'peer', 'igp', 'oldest', 'rid', 'cluster', 'nbr'],
  rfc:    ['localpref', 'aspath', 'origin', 'med', 'peer', 'igp', 'rid', 'cluster', 'nbr'],
};
const BGPBP_ORIGIN = { i: 0, e: 1, '?': 2 };
const BGPBP_LOCAL = { no: 0, aggregate: 1, network: 2 };

function bgpbpIp(s) {
  const p = String(s || '').trim().split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const o of p) {
    if (!/^\d{1,3}$/.test(o) || +o > 255) return null;
    n = n * 256 + +o;
  }
  return n;
}

// Cisco display notation: 65001 = AS_SEQUENCE, {65001 65002} = AS_SET (counts 1),
// (65010) = AS_CONFED_SEQUENCE, [65010] = AS_CONFED_SET (both count 0).
// Returns { len, nas, confed, norm } or null. nas = first AS of the first
// non-confed segment when that segment is a sequence; null = local/internal.
function bgpbpParsePath(s) {
  const src = String(s || '').trim();
  const r = { len: 0, nas: null, confed: false, norm: '' };
  const re = /\s*(\{[^{}]*\}|\([^()]*\)|\[[^\[\]]*\]|\d+)\s*/y;
  const out = [];
  let i = 0, firstSeen = false;
  while (i < src.length) {
    re.lastIndex = i;
    const m = re.exec(src);
    if (!m) return null;
    i = re.lastIndex;
    const tok = m[1], br = tok[0];
    const seg = /\d/.test(br) ? [tok] : tok.slice(1, -1).split(/[\s,]+/).filter(Boolean);
    if (!seg.length || seg.some(a => !/^\d+$/.test(a) || +a < 1 || +a > BGPBP_MAX32)) return null;
    if (br === '(' || br === '[') r.confed = true;
    else if (br === '{') { r.len += 1; firstSeen = true; }
    else { r.len += 1; if (!firstSeen) { r.nas = +tok; firstSeen = true; } }
    out.push(/\d/.test(br) ? tok : br + seg.join(' ') + tok.slice(-1));
  }
  r.norm = out.join(' ');
  return r;
}

// First invalid field → { key, vars }; blank required field → { key: '' } (silent).
function bgpbpValidate(cands) {
  if (cands.length < 2) return { key: '' };
  const int = (v, lo, hi) => /^\d+$/.test(String(v).trim()) && +v >= lo && +v <= hi;
  const seen = new Set();
  for (const c of cands) {
    const name = c.label;
    if (!String(c.label).trim()) return { key: '' };
    for (const f of ['weight', 'localPref', 'igp', 'rxOrder', 'clusterLen', 'routerId', 'neighborIp'])
      if (String(c[f]).trim() === '') return { key: '' };
    if (!int(c.weight, 0, 65535)) return { key: 'err_weight', vars: { name } };
    if (!int(c.localPref, 0, BGPBP_MAX32)) return { key: 'err_localpref', vars: { name } };
    if (!bgpbpParsePath(c.asPath)) return { key: 'err_aspath', vars: { name } };
    if (String(c.med).trim() !== '' && !int(c.med, 0, BGPBP_MAX32)) return { key: 'err_med', vars: { name } };
    if (!int(c.igp, 0, BGPBP_MAX32)) return { key: 'err_igp', vars: { name } };
    if (!int(c.rxOrder, 1, 99)) return { key: 'err_rx', vars: { name } };
    if (!int(c.clusterLen, 0, 255)) return { key: 'err_cluster', vars: { name } };
    if (bgpbpIp(c.routerId) === null) return { key: 'err_rid', vars: { name } };
    if (bgpbpIp(c.neighborIp) === null) return { key: 'err_nbr', vars: { name } };
    if (seen.has(bgpbpIp(c.neighborIp))) return { key: 'err_dup_nbr', vars: { name } };
    seen.add(bgpbpIp(c.neighborIp));
  }
  return null;
}

function bgpbpNorm(c, dialect, o) {
  const p = bgpbpParsePath(c.asPath);
  const medBlank = String(c.med).trim() === '';
  const missing = (o.missingAsWorst && (dialect === 'cisco' || dialect === 'arista')) ? BGPBP_MAX32 : 0;
  return {
    id: c.id, label: c.label, nh: !!c.nhReachable, path: p,
    weight: +c.weight, lp: +c.localPref, local: BGPBP_LOCAL[c.local] || 0,
    origin: BGPBP_ORIGIN[c.origin] ?? 0, medMissing: medBlank, med: medBlank ? missing : +c.med,
    peer: c.peerType, igp: +c.igp, rx: +c.rxOrder, rid: bgpbpIp(c.routerId),
    cluster: +c.clusterLen, nbr: bgpbpIp(c.neighborIp),
  };
}

// Lower sort key wins. show() = the value printed in reasons.
const BGPBP_KEY = {
  weight:    [c => -c.weight,  c => String(c.weight)],
  localpref: [c => -c.lp,      c => String(c.lp)],
  local:     [c => -c.local,   c => ['no', 'aggregate', 'network'][c.local]],
  aspath:    [c => c.path.len, c => String(c.path.len)],
  origin:    [c => c.origin,   c => ['i', 'e', '?'][c.origin]],
  med:       [c => c.med,      c => String(c.med) + (c.medMissing ? '*' : '')],
  peer:      [c => (c.peer === 'ebgp' ? 0 : 1), c => c.peer],
  igp:       [c => c.igp,      c => String(c.igp)],
  oldest:    [c => c.rx,       c => '#' + c.rx],
  rid:       [c => c.rid,      c => [24, 16, 8, 0].map(s => Math.floor(c.rid / 2 ** s) % 256).join('.')],
  cluster:   [c => c.cluster,  c => String(c.cluster)],
  nbr:       [c => c.nbr,      c => [24, 16, 8, 0].map(s => Math.floor(c.nbr / 2 ** s) % 256).join('.')],
};

// One elimination round. medMode: 'group' (per neighbor AS) | 'all'.
function bgpbpRound(step, surv, o, medMode) {
  const r = { step, entering: surv.map(c => c.id), eliminated: [], skip: '' };
  if (step === 'oldest') {
    if (o.compareRouterId) { r.skip = 'skip_oldest_cfg'; return r; }
    if (surv.some(c => c.peer !== 'ebgp')) { r.skip = 'skip_oldest_ibgp'; return r; }
  }
  const [key, show] = BGPBP_KEY[step];
  const groups = new Map();
  for (const c of surv) {
    const g = (step === 'med' && medMode === 'group') ? String(c.path.nas ?? 'local') : '*';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(c);
  }
  if (step === 'med' && medMode === 'group' && [...groups.values()].every(g => g.length < 2)) {
    r.skip = 'skip_med_no_pairs'; return r;
  }
  for (const [g, list] of groups) {
    const min = Math.min(...list.map(key));
    const win = list.find(c => key(c) === min);
    for (const c of list) if (key(c) !== min)
      r.eliminated.push({ id: c.id, by: win.label, v: show(c), best: show(win), grp: g === '*' ? '' : g });
  }
  return r;
}

// Run the dialect's steps (optionally stopping after `until`) until one survivor remains.
function bgpbpRun(list, dialect, o, medMode, until) {
  let surv = list;
  const rounds = [];
  for (const step of BGPBP_STEPS[dialect]) {
    if (surv.length < 2) break;
    const r = bgpbpRound(step, surv, o, medMode);
    rounds.push(r);
    const out = new Set(r.eliminated.map(e => e.id));
    surv = surv.filter(c => !out.has(c.id));
    if (step === until) break;
  }
  return { rounds, surv };
}

// o = { deterministicMed, alwaysCompareMed, missingAsWorst, compareRouterId, maxPaths, multipathRelax }
function bgpbpEvaluate(cands, dialect, o) {
  const all = cands.map(c => bgpbpNorm(c, dialect, o));
  const res = { mode: 'rounds', rounds: [], pairs: [], best: null, decidedAt: '', multipath: [],
    mpExcluded: [], mpTied: 0, detBest: null };
  res.rounds.push({ step: 'nh', entering: all.map(c => c.id), skip: '',
    eliminated: all.filter(c => !c.nh).map(c => ({ id: c.id, by: '', v: '', best: '', grp: '' })) });
  const reach = all.filter(c => c.nh);
  if (!reach.length) return res;
  const always = o.alwaysCompareMed && dialect !== 'rfc';
  const medMode = always ? 'all' : 'group';
  let best;
  if (dialect === 'cisco' && !o.deterministicMed && !always) {
    // ponytail: arrival-order walk newest→oldest, as IOS does without deterministic-med (RFC 3345).
    res.mode = 'pairwise';
    const order = reach.map((c, i) => [c, i]).sort((a, b) => (b[0].rx - a[0].rx) || (b[1] - a[1])).map(x => x[0]);
    best = order[0];
    for (const next of order.slice(1)) {
      const { rounds, surv } = bgpbpRun([best, next], dialect, o, 'group');
      const dec = rounds.find(r => r.eliminated.length) || rounds[rounds.length - 1];
      res.pairs.push({ a: best.id, b: next.id, winner: surv[0].id, step: dec.step, elim: dec.eliminated[0] });
      best = surv[0];
    }
    res.detBest = bgpbpRun(reach, dialect, o, 'group').surv[0].id;
    res.decidedAt = res.pairs.length ? res.pairs[res.pairs.length - 1].step : (all.length > reach.length ? 'nh' : '');
  } else {
    const { rounds, surv } = bgpbpRun(reach, dialect, o, medMode);
    res.rounds.push(...rounds);
    best = surv[0];
    const dec = [...rounds].reverse().find(r => r.eliminated.length);
    res.decidedAt = dec ? dec.step : (all.length > reach.length ? 'nh' : '');
  }
  res.best = best.id;
  // Multipath: paths tied with best through the IGP-metric step, same peer class,
  // identical AS_PATH unless multipath-relax. Ranked by the remaining tiebreakers.
  const cls = c => (c.peer === 'ebgp' ? 'ebgp' : 'ibgp');
  const eligible = [];
  for (const c of reach) {
    if (c === best) continue;
    if (bgpbpRun([best, c], dialect, o, medMode, 'igp').surv.length !== 2) continue;
    if (cls(c) !== cls(best)) res.mpExcluded.push({ id: c.id, key: 'mp_x_peer' });
    else if (!o.multipathRelax && c.path.norm !== best.path.norm) res.mpExcluded.push({ id: c.id, key: 'mp_aspath' });
    else eligible.push(c);
  }
  res.mpTied = eligible.length;
  eligible.sort((a, b) => (bgpbpRun([a, b], dialect, o, medMode).surv[0] === a ? -1 : 1));
  const room = Math.max(0, (+o.maxPaths || 1) - 1);
  if (+o.maxPaths > 1) {
    res.multipath = [best.id, ...eligible.slice(0, room).map(c => c.id)];
    for (const c of eligible.slice(room)) res.mpExcluded.push({ id: c.id, key: 'mp_max' });
  }
  return res;
}
// </bgpbp-engine>

// <bgpbp-presets>
const BGPBP_DEF_OPTS = { deterministicMed: true, alwaysCompareMed: false, missingAsWorst: false,
  compareRouterId: false, maxPaths: 1, multipathRelax: false };
function bgpbpCand(id, label, over) {
  return { id, label, nhReachable: true, weight: '0', localPref: '100', local: 'no', asPath: '',
    origin: 'i', med: '', peerType: 'ebgp', igp: '0', rxOrder: String(id), routerId: '192.0.2.' + id,
    clusterLen: '0', neighborIp: '192.0.2.' + id, ...over };
}
const BGPBP_PRESETS = {
  prepend: { dialect: 'cisco', opts: {}, cands: [
    bgpbpCand(1, 'PRIMARY', { asPath: '64500', neighborIp: '198.51.100.1', routerId: '198.51.100.1' }),
    bgpbpCand(2, 'BACKUP',  { asPath: '64500 64500 64500', neighborIp: '203.0.113.1', routerId: '203.0.113.1' }),
    bgpbpCand(3, 'IBGP-RR', { asPath: '64500', peerType: 'ibgp', igp: '10', neighborIp: '10.255.0.2', routerId: '10.255.0.2' }),
  ] },
  transit_peering: { dialect: 'cisco', opts: {}, cands: [
    bgpbpCand(1, 'TRANSIT-A', { asPath: '174 3356 64500', neighborIp: '198.51.100.1', routerId: '198.51.100.1' }),
    bgpbpCand(2, 'IX-PEER',   { asPath: '64500', localPref: '200', neighborIp: '203.0.113.10', routerId: '203.0.113.10' }),
    bgpbpCand(3, 'TRANSIT-B', { asPath: '3257 64500', neighborIp: '192.0.2.1', routerId: '192.0.2.1' }),
  ] },
  med_trap: { dialect: 'cisco', opts: { deterministicMed: false }, cands: [
    bgpbpCand(1, 'P1', { asPath: '65001 64999', med: '50',  peerType: 'ibgp', igp: '30', neighborIp: '10.0.0.1', routerId: '10.0.0.1' }),
    bgpbpCand(2, 'P2', { asPath: '65002 64999', med: '100', peerType: 'ibgp', igp: '20', neighborIp: '10.0.0.2', routerId: '10.0.0.2' }),
    bgpbpCand(3, 'P3', { asPath: '65001 64999', med: '80',  peerType: 'ibgp', igp: '10', neighborIp: '10.0.0.3', routerId: '10.0.0.3' }),
  ] },
  multipath: { dialect: 'cisco', opts: { maxPaths: 4 }, cands: [
    bgpbpCand(1, 'ISP1-A', { asPath: '65010 64500', rxOrder: '2', neighborIp: '192.0.2.1',    routerId: '192.0.2.1' }),
    bgpbpCand(2, 'ISP1-B', { asPath: '65010 64500', rxOrder: '1', neighborIp: '192.0.2.5',    routerId: '192.0.2.5' }),
    bgpbpCand(3, 'ISP2',   { asPath: '65020 64500', rxOrder: '3', neighborIp: '198.51.100.1', routerId: '198.51.100.1' }),
  ] },
  rr_tiebreak: { dialect: 'cisco', opts: {}, cands: [
    bgpbpCand(1, 'RR1', { asPath: '64500', peerType: 'ibgp', igp: '20', routerId: '10.255.0.3', clusterLen: '1', neighborIp: '10.255.255.1' }),
    bgpbpCand(2, 'RR2', { asPath: '64500', peerType: 'ibgp', igp: '20', routerId: '10.255.0.3', clusterLen: '2', neighborIp: '10.255.255.3' }),
    bgpbpCand(3, 'RR3', { asPath: '64500', peerType: 'ibgp', igp: '20', routerId: '10.255.0.9', clusterLen: '1', neighborIp: '10.255.255.4' }),
    bgpbpCand(4, 'RR4', { asPath: '64500', peerType: 'ibgp', igp: '20', routerId: '10.255.0.3', clusterLen: '1', neighborIp: '10.255.255.2' }),
  ] },
};
// </bgpbp-presets>

const BGPBP_TABS = ['simulator', 'reference'];
const BGPBP_MAX_CANDS = 8;
const BGPBP_MIN_CANDS = 2;
const BGPBP_MAXPATHS = [1, 2, 4, 8];
const BGPBP_PRESET_ORDER = ['prepend', 'transit_peering', 'med_trap', 'multipath', 'rr_tiebreak'];
const BGPBP_MATRIX_STEPS = ['nh', 'weight', 'localpref', 'local', 'aspath', 'origin', 'med', 'peer', 'igp', 'oldest', 'rid', 'cluster', 'nbr'];
const BGPBP_OPT_CHECKS = [
  ['deterministicMed', 'deterministic_med'],
  ['alwaysCompareMed', 'always_compare_med'],
  ['missingAsWorst', 'missing_as_worst'],
  ['compareRouterId', 'compare_router_id'],
  ['multipathRelax', 'multipath_relax'],
];
const BGPBP_OPT_DIALECTS = {
  deterministicMed: ['cisco'],
  alwaysCompareMed: ['cisco', 'junos', 'arista'],
  missingAsWorst:   ['cisco', 'arista'],
  compareRouterId:  ['cisco', 'junos', 'arista'],
  maxPaths:         ['cisco', 'junos', 'arista', 'rfc'],
  multipathRelax:   ['cisco', 'junos', 'arista', 'rfc'],
};
const BGPBP_KNOBS = {
  alwaysCompareMed: { cisco: 'bgp always-compare-med', junos: 'path-selection always-compare-med', arista: 'bgp always-compare-med', rfc: '' },
  deterministicMed: { cisco: 'bgp deterministic-med', junos: '(default; path-selection cisco-non-deterministic reverts)', arista: '(default)', rfc: '(inherent, §9.1.2.2c)' },
  missingAsWorst:   { cisco: 'bgp bestpath med missing-as-worst', junos: '', arista: 'bgp bestpath med missing-as-worst', rfc: '' },
  compareRouterId:  { cisco: 'bgp bestpath compare-routerid', junos: 'path-selection external-router-id', arista: 'bgp bestpath tie-break router-id', rfc: '' },
  maxPaths:         { cisco: 'maximum-paths N / maximum-paths ibgp N', junos: 'multipath', arista: 'maximum-paths N', rfc: '' },
  multipathRelax:   { cisco: 'bgp bestpath as-path multipath-relax', junos: 'multipath multiple-as', arista: 'bgp bestpath as-path multipath-relax', rfc: '' },
  asPathIgnore:     { cisco: 'bgp bestpath as-path ignore', junos: 'path-selection as-path-ignore', arista: 'bgp bestpath as-path ignore', rfc: '' },
};
const BGPBP_RELATED = [
  { id: 'bgp-lg', key: 'related_bgp_lg' },
  { id: 'bgp-community', key: 'related_bgp_community' },
  { id: 'prefix-list-builder', key: 'related_prefix_list' },
  { id: 'routing-table-parser', key: 'related_rtp' },
  { id: 'routing-cfg', key: 'related_routing_cfg' },
];
const BGPBP_TRAPS = ['med_order', 'missing_med', 'nh_unreach', 'mp_prereq', 'weight_local', 'oldest_churn', 'confed'];
const BGPBP_TRAP_PRESET = { med_order: 'med_trap', mp_prereq: 'multipath' };
const BGPBP_FIELDS = [
  { f: 'label',       key: 'f_label',     hint: 'f_label_hint',     kind: 'label' },
  { f: 'nhReachable', key: 'f_nh',        hint: 'f_nh_hint',        kind: 'check' },
  { f: 'weight',      key: 'f_weight',    hint: 'f_weight_hint',    kind: 'text', dim: true },
  { f: 'localPref',   key: 'f_localpref', hint: 'f_localpref_hint', kind: 'text' },
  { f: 'local',       key: 'f_local',     hint: 'f_local_hint',     kind: 'local', dim: true },
  { f: 'asPath',      key: 'f_aspath',    hint: 'f_aspath_hint',    kind: 'aspath' },
  { f: 'origin',      key: 'f_origin',    hint: 'f_origin_hint',    kind: 'origin' },
  { f: 'med',         key: 'f_med',       hint: 'f_med_hint',       kind: 'med' },
  { f: 'peerType',    key: 'f_peer',      hint: 'f_peer_hint',      kind: 'peer' },
  { f: 'igp',         key: 'f_igp',       hint: 'f_igp_hint',       kind: 'text' },
  { f: 'rxOrder',     key: 'f_rx',        hint: 'f_rx_hint',        kind: 'text' },
  { f: 'routerId',    key: 'f_rid',       hint: 'f_rid_hint',       kind: 'ip' },
  { f: 'clusterLen',  key: 'f_cluster',   hint: 'f_cluster_hint',   kind: 'text' },
  { f: 'neighborIp',  key: 'f_nbr',       hint: 'f_nbr_hint',       kind: 'ip' },
  { f: '_result',     key: 'f_result',    hint: '',                kind: 'result' },
];
const BGPBP_LOCAL_OPTS = [['no', 'local_no'], ['network', 'local_network'], ['aggregate', 'local_aggregate']];
const BGPBP_ORIGIN_OPTS = [['i', 'origin_i'], ['e', 'origin_e'], ['?', 'origin_q']];
const BGPBP_PEER_OPTS = [['ebgp', 'peer_ebgp'], ['ibgp', 'peer_ibgp'], ['confed', 'peer_confed']];
const BGPBP_ABSENT = '\u2014';

function bgpbpSnake(k) {
  return k.replace(/[A-Z]/g, ch => '_' + ch.toLowerCase());
}

function bgpbpElimReason(t, step, e) {
  if (!e) return '';
  const key = (step === 'med' && !e.grp) ? 'r_med_all' : ('r_' + step);
  const tr = x => (step === 'local' ? t('bgp_best_path.local_' + x) : x);
  return t('bgp_best_path.' + key, { v: tr(e.v), best: tr(e.best), by: e.by, grp: e.grp });
}

function bgpbpStepPos(dialect, step) {
  const order = ['nh', ...BGPBP_STEPS[dialect]];
  const i = order.indexOf(step);
  return i < 0 ? BGPBP_ABSENT : String(i + 1);
}

function bgpbpElimStep(result, id) {
  if (!result) return null;
  for (const r of result.rounds) {
    if (r.eliminated.some(e => e.id === id)) return r.step;
  }
  if (result.mode === 'pairwise') {
    const p = result.pairs.find(x => (x.a === id || x.b === id) && x.winner !== id);
    if (p) return p.step;
  }
  return null;
}

// ponytail: third copy of this helper; hoist to shared.jsx in a cleanup pass.
function bgpbpDownload(content, filename) {
  const blob = new Blob([content + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function BGPBestPathSimulator({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  void useState;

  const [activeTab, setActiveTab] = usePersistentState('bgpbp:activeTab', initialData?.activeTab ?? 'simulator');
  const [dialect, setDialect] = usePersistentState('bgpbp:dialect', initialData?.dialect ?? BGPBP_PRESETS.prepend.dialect);
  const [opts, setOpts] = usePersistentState('bgpbp:opts', {
    ...BGPBP_DEF_OPTS,
    ...BGPBP_PRESETS.prepend.opts,
    ...(initialData?.opts || {}),
  });
  const [cands, setCands] = usePersistentState('bgpbp:cands', () => {
    const src = (initialData?.cands && initialData.cands.length)
      ? initialData.cands
      : BGPBP_PRESETS.prepend.cands;
    return src.map(c => ({ ...bgpbpCand(c.id, c.label, {}), ...c }));
  });

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
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'bgp-best-path', activeTab, dialect, opts, cands,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [onShare, activeTab, dialect, opts, cands]);

  const upd = (id, f, v) => setCands(cs => cs.map(c => c.id === id ? { ...c, [f]: v } : c));

  const applyPreset = (id) => {
    const p = BGPBP_PRESETS[id];
    if (!p) return;
    setDialect(p.dialect);
    setOpts({ ...BGPBP_DEF_OPTS, ...p.opts });
    setCands(p.cands.map(c => ({ ...c })));
  };

  const addCand = () => {
    setCands(cs => {
      if (cs.length >= BGPBP_MAX_CANDS) return cs;
      const ids = cs.map(c => c.id);
      const id = Math.max(0, ...ids) + 1;
      const used = new Set(cs.map(c => c.label));
      const letter = 'ABCDEFGH'.split('').find(l => !used.has(l));
      const label = letter || ('P' + id);
      const taken = new Set(cs.map(c => c.neighborIp));
      let neighborIp = '192.0.2.' + id;
      if (taken.has(neighborIp)) neighborIp = '192.0.2.' + (100 + id);
      return [...cs, bgpbpCand(id, label, { rxOrder: String(id), routerId: '192.0.2.' + id, neighborIp })];
    });
  };

  const removeCand = (id) => {
    setCands(cs => cs.length <= BGPBP_MIN_CANDS ? cs : cs.filter(c => c.id !== id));
  };

  const vErr = useMemo(() => bgpbpValidate(cands), [cands]);
  const error = vErr && vErr.key ? t('bgp_best_path.' + vErr.key, vErr.vars) : '';
  const result = useMemo(() => (vErr ? null : bgpbpEvaluate(cands, dialect, opts)), [vErr, cands, dialect, opts]);
  const byId = id => cands.find(c => c.id === id);

  const hints = useMemo(() => {
    if (!result) return [];
    const list = [];
    const lab = id => (byId(id) || {}).label || String(id);
    if (result.best === null) list.push({ level: 'red', key: 'hint_no_best' });
    const medOrder = result.mode === 'pairwise' && result.detBest !== result.best;
    if (medOrder) list.push({ level: 'red', key: 'hint_med_order', vars: { det: lab(result.detBest), best: lab(result.best) } });
    if (dialect === 'cisco' && !opts.deterministicMed && !opts.alwaysCompareMed && !medOrder) {
      list.push({ level: 'yellow', key: 'hint_nondet' });
    }
    const missingAs0 = !(opts.missingAsWorst && (dialect === 'cisco' || dialect === 'arista'));
    if (missingAs0) {
      const reach = cands.filter(c => c.nhReachable);
      const blank = reach.filter(c => String(c.med).trim() === '');
      const set = reach.filter(c => String(c.med).trim() !== '');
      if (blank.length && set.length) {
        const always = opts.alwaysCompareMed && dialect !== 'rfc';
        const share = always || blank.some(b => {
          const nasB = bgpbpParsePath(b.asPath).nas;
          return set.some(s => bgpbpParsePath(s.asPath).nas === nasB);
        });
        if (share) list.push({ level: 'yellow', key: 'hint_missing_med' });
      }
    }
    if (opts.alwaysCompareMed && dialect !== 'rfc') {
      const nases = new Set(cands.filter(c => c.nhReachable).map(c => String(bgpbpParsePath(c.asPath).nas)));
      if (nases.size > 1) list.push({ level: 'yellow', key: 'hint_always_med_mixed' });
    }
    if (dialect === 'cisco' || dialect === 'arista') {
      for (const c of cands) {
        if (c.local !== 'no' && c.weight !== '32768') {
          list.push({ level: 'yellow', key: 'hint_local_weight', vars: { name: c.label, w: c.weight } });
        }
      }
    }
    if ((dialect === 'junos' || dialect === 'rfc') && cands.some(c => c.weight !== '0')) {
      list.push({ level: 'yellow', key: 'hint_weight_ignored' });
    }
    if ((dialect === 'junos' || dialect === 'rfc') && cands.some(c => c.local !== 'no')) {
      list.push({ level: 'yellow', key: 'hint_local_ignored' });
    }
    if (+opts.maxPaths === 1 && result.mpTied > 0) {
      list.push({ level: 'yellow', key: 'hint_mp_off', vars: { n: result.mpTied + 1 } });
    }
    if (cands.some(c => (bgpbpParsePath(c.asPath) || {}).confed)) {
      list.push({ level: 'yellow', key: 'hint_confed' });
    }
    if (list.length === 0) list.push({ level: 'green', key: 'hint_ok' });
    return list;
  }, [result, cands, dialect, opts]);

  const summary = useMemo(() => {
    if (!result) return '';
    const lines = [];
    const lab = id => (byId(id) || {}).label || String(id);
    lines.push(t('bgp_best_path.summary_header', { dialect: t('bgp_best_path.dialect_' + dialect) }));
    const knobs = [];
    for (const k of Object.keys(BGPBP_KNOBS)) {
      if (k === 'asPathIgnore') continue;
      if (!(BGPBP_OPT_DIALECTS[k] || []).includes(dialect)) continue;
      const v = opts[k];
      if (k === 'maxPaths') {
        if (+v <= 1) continue;
        const cli = (BGPBP_KNOBS[k] || {})[dialect];
        if (cli) knobs.push(cli.replace(/N/g, String(v)));
        continue;
      }
      if (!v) continue;
      const cli = (BGPBP_KNOBS[k] || {})[dialect];
      if (cli) knobs.push(cli);
    }
    lines.push(knobs.length
      ? t('bgp_best_path.summary_settings', { list: knobs.join(', ') })
      : t('bgp_best_path.summary_defaults'));
    if (result.best == null) {
      lines.push(t('bgp_best_path.no_best'));
    } else {
      lines.push(t('bgp_best_path.summary_best', {
        name: lab(result.best),
        step: t('bgp_best_path.step_' + result.decidedAt),
      }));
    }
    if (result.multipath.length > 1) {
      lines.push(t('bgp_best_path.summary_ecmp', { list: result.multipath.map(lab).join(', ') }));
    }
    if (result.mode === 'pairwise' && result.detBest !== result.best) {
      lines.push(t('bgp_best_path.summary_det', { name: lab(result.detBest) }));
    }
    lines.push(t('bgp_best_path.summary_eliminated'));
    const nhRound = result.rounds.find(r => r.step === 'nh');
    if (nhRound) {
      for (const e of nhRound.eliminated) {
        lines.push('- ' + t('bgp_best_path.summary_line', {
          name: lab(e.id),
          step: t('bgp_best_path.step_nh'),
          reason: t('bgp_best_path.r_nh'),
        }));
      }
    }
    if (result.mode === 'pairwise') {
      for (const p of result.pairs) {
        lines.push('- ' + t('bgp_best_path.summary_pair', {
          a: lab(p.a), b: lab(p.b), winner: lab(p.winner),
          step: t('bgp_best_path.step_' + p.step),
          reason: bgpbpElimReason(t, p.step, p.elim),
        }));
      }
    } else {
      for (const r of result.rounds) {
        if (r.step === 'nh') continue;
        for (const e of r.eliminated) {
          lines.push('- ' + t('bgp_best_path.summary_line', {
            name: lab(e.id),
            step: t('bgp_best_path.step_' + r.step),
            reason: bgpbpElimReason(t, r.step, e),
          }));
        }
      }
    }
    lines.push(t('bgp_best_path.summary_candidates'));
    for (const c of cands) {
      lines.push('- ' + t('bgp_best_path.summary_cand', {
        name: c.label,
        nh: c.nhReachable ? t('common.yes') : t('common.no'),
        weight: c.weight,
        lp: c.localPref,
        aspath: c.asPath,
        origin: c.origin,
        med: String(c.med).trim() === '' ? '-' : c.med,
        peer: c.peerType,
        igp: c.igp,
        rx: c.rxOrder,
        rid: c.routerId,
        cluster: c.clusterLen,
        nbr: c.neighborIp,
      }));
    }
    return lines.join('\n');
  }, [result, dialect, opts, cands, t]);

  const dimLocal = dialect === 'junos' || dialect === 'rfc';
  const inpStyle = { width: 108, fontSize: 12 };
  const monoInp = { ...inpStyle, fontFamily: 'var(--mono)' };
  const td = { padding: '5px 6px', verticalAlign: 'middle', borderBottom: '1px solid var(--border)' };
  const th = { ...td, color: 'var(--muted)', whiteSpace: 'nowrap', fontSize: 12, textAlign: 'left' };

  const resultBadge = (id) => {
    if (!result) return null;
    const nh = result.rounds.find(r => r.step === 'nh');
    if (nh && nh.eliminated.some(e => e.id === id)) {
      return <span className="badge badge-red">{t('bgp_best_path.badge_unreach')}</span>;
    }
    if (result.best === id) {
      return <span className="badge badge-green">{t('bgp_best_path.badge_best')}</span>;
    }
    if ((result.multipath || []).includes(id)) {
      return <span className="badge badge-green">{t('bgp_best_path.badge_ecmp')}</span>;
    }
    const step = bgpbpElimStep(result, id);
    if (step) {
      return (
        <span className="badge badge-red">
          {t('bgp_best_path.badge_out')} {t('bgp_best_path.step_' + step)}
        </span>
      );
    }
    return null;
  };

  const cell = (c, row) => {
    if (row.kind === 'label') {
      return (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
          <input
            className="input"
            value={c.label}
            maxLength={16}
            onChange={e => upd(c.id, 'label', e.target.value)}
            style={inpStyle}
          />
          <button
            className="btn btn-ghost btn-sm"
            aria-label={t('bgp_best_path.btn_remove')}
            disabled={cands.length <= BGPBP_MIN_CANDS}
            onClick={() => removeCand(c.id)}
          >
            {'\u00d7'}
          </button>
        </div>
      );
    }
    if (row.kind === 'check') {
      return (
        <input
          type="checkbox"
          checked={!!c.nhReachable}
          onChange={e => upd(c.id, 'nhReachable', e.target.checked)}
        />
      );
    }
    if (row.kind === 'local') {
      return (
        <select className="select" value={c.local} onChange={e => upd(c.id, 'local', e.target.value)} style={inpStyle}>
          {BGPBP_LOCAL_OPTS.map(([v, k]) => (
            <option key={v} value={v}>{t('bgp_best_path.' + k)}</option>
          ))}
        </select>
      );
    }
    if (row.kind === 'origin') {
      return (
        <select className="select" value={c.origin} onChange={e => upd(c.id, 'origin', e.target.value)} style={inpStyle}>
          {BGPBP_ORIGIN_OPTS.map(([v, k]) => (
            <option key={v} value={v}>{t('bgp_best_path.' + k)}</option>
          ))}
        </select>
      );
    }
    if (row.kind === 'peer') {
      return (
        <select className="select" value={c.peerType} onChange={e => upd(c.id, 'peerType', e.target.value)} style={inpStyle}>
          {BGPBP_PEER_OPTS.map(([v, k]) => (
            <option key={v} value={v}>{t('bgp_best_path.' + k)}</option>
          ))}
        </select>
      );
    }
    if (row.kind === 'med') {
      return (
        <input
          className="input"
          value={c.med}
          placeholder={t('bgp_best_path.med_placeholder')}
          onChange={e => upd(c.id, 'med', e.target.value)}
          style={inpStyle}
        />
      );
    }
    if (row.kind === 'aspath') {
      return (
        <input
          className="input"
          value={c.asPath}
          placeholder={t('bgp_best_path.aspath_placeholder')}
          onChange={e => upd(c.id, 'asPath', e.target.value)}
          style={monoInp}
        />
      );
    }
    if (row.kind === 'ip') {
      return (
        <input
          className="input"
          value={c[row.f]}
          onChange={e => upd(c.id, row.f, e.target.value)}
          style={monoInp}
        />
      );
    }
    if (row.kind === 'result') return resultBadge(c.id);
    return (
      <input
        className="input"
        value={c[row.f]}
        onChange={e => upd(c.id, row.f, e.target.value)}
        style={inpStyle}
      />
    );
  };

  const renderRound = (r, n) => {
    const surviving = r.entering.filter(id => !r.eliminated.some(e => e.id === id));
    return (
      <div key={n} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{t('bgp_best_path.trace_round', { n })}</span>
          <span>{t('bgp_best_path.step_' + r.step)}</span>
          <span className="hint">{t('bgp_best_path.trace_entering', { n: r.entering.length })}</span>
        </div>
        {r.skip ? (
          <div className="hint">{t('bgp_best_path.' + r.skip)}</div>
        ) : r.eliminated.length === 0 ? (
          <div className="hint">{t('bgp_best_path.trace_tie')}</div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {r.eliminated.map(e => (
              <span key={e.id} className="badge badge-red" style={{ whiteSpace: 'normal' }}>
                {(byId(e.id) || {}).label}{' '}
                {bgpbpElimReason(t, r.step, e)}
              </span>
            ))}
          </div>
        )}
        <div style={{ marginTop: 4, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
          {t('bgp_best_path.trace_survivors')}: {surviving.map(id => (byId(id) || {}).label).join(', ')}
        </div>
      </div>
    );
  };

  const relatedBlock = (
    <div className="card">
      <div className="card-title">{t('bgp_best_path.related_title')}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
        {BGPBP_RELATED.map(({ id, key }, idx) => (
          <li key={id} style={{ marginBottom: idx < BGPBP_RELATED.length - 1 ? 6 : 0 }}>
            <button
              className="btn btn-sm btn-ghost"
              style={{ padding: '0 6px', height: 'auto', fontSize: 12, marginRight: 6, display: 'inline-flex', verticalAlign: 'baseline' }}
              onClick={() => {
                window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: id } }));
              }}
            >
              {t('bgp_best_path.' + key)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const hasMissingMedStar = !!(result && (
    result.rounds.some(r => r.eliminated.some(e => String(e.v).includes('*') || String(e.best).includes('*'))) ||
    result.pairs.some(p => p.elim && (String(p.elim.v).includes('*') || String(p.elim.best).includes('*')))
  ));

  return (
    <div className="fadein">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">{t('bgp_best_path.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {t('bgp_best_path.subtitle')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {BGPBP_TABS.map(tabId => (
            <button
              key={tabId}
              className={`btn btn-sm ${activeTab === tabId ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12 }}
              onClick={() => setActiveTab(tabId)}
            >
              {t('bgp_best_path.tab_' + tabId)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'simulator' && (
        <div>
          <div className="card">
            <div className="card-title">{t('bgp_best_path.dialect_label')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {BGPBP_DIALECTS.map(id => (
                <button
                  key={id}
                  className={`btn btn-sm ${dialect === id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setDialect(id)}
                >
                  {t('bgp_best_path.dialect_' + id)}
                </button>
              ))}
            </div>
            <div className="card-title">{t('bgp_best_path.opts_title')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {BGPBP_OPT_CHECKS.map(([k, suffix]) => {
                const na = !(BGPBP_OPT_DIALECTS[k] || []).includes(dialect);
                const cli = (BGPBP_KNOBS[k] || {})[dialect] || '';
                return (
                  <label
                    key={k}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', opacity: na ? 0.5 : 1 }}
                    title={na ? t('bgp_best_path.opt_na_dialect') : undefined}
                  >
                    <input
                      type="checkbox"
                      checked={!!opts[k]}
                      disabled={na}
                      onChange={() => setOpts(o => ({ ...o, [k]: !o[k] }))}
                    />
                    <span>{t('bgp_best_path.opt_' + suffix)}</span>
                    {cli ? (
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 11 }}>{cli}</span>
                    ) : null}
                  </label>
                );
              })}
              {(() => {
                const na = !(BGPBP_OPT_DIALECTS.maxPaths || []).includes(dialect);
                const cli = (BGPBP_KNOBS.maxPaths || {})[dialect] || '';
                return (
                  <div
                    style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', opacity: na ? 0.5 : 1 }}
                    title={na ? t('bgp_best_path.opt_na_dialect') : undefined}
                  >
                    <span className="label" style={{ margin: 0 }}>{t('bgp_best_path.opt_max_paths')}</span>
                    <select
                      className="select"
                      disabled={na}
                      value={String(opts.maxPaths)}
                      onChange={e => setOpts(o => ({ ...o, maxPaths: +e.target.value }))}
                      style={{ width: 'auto' }}
                    >
                      {BGPBP_MAXPATHS.map(n => (
                        <option key={n} value={n}>
                          {n === 1 ? t('bgp_best_path.opt_max_paths_off') : String(n)}
                        </option>
                      ))}
                    </select>
                    {cli ? (
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 11 }}>{cli}</span>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('bgp_best_path.presets_title')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {BGPBP_PRESET_ORDER.map(id => (
                <button
                  key={id}
                  className="btn btn-sm"
                  title={t('bgp_best_path.preset_' + id + '_desc')}
                  onClick={() => applyPreset(id)}
                >
                  {t('bgp_best_path.preset_' + id)}
                </button>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>{t('bgp_best_path.presets_hint')}</div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                {t('bgp_best_path.cands_title')}{' '}
                <span className="hint">{t('bgp_best_path.cands_count', { n: cands.length })}</span>
              </div>
              <div className="btn-row">
                <button className="btn btn-sm" disabled={cands.length >= BGPBP_MAX_CANDS} onClick={addCand}>
                  {t('bgp_best_path.btn_add')}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => bgpbpDownload(
                    JSON.stringify({ tool: 'bgp-best-path', dialect, opts, cands }, null, 2),
                    'bgp-best-path-' + dialect + '.json'
                  )}
                >
                  {t('common.export_json')}
                </button>
              </div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <tbody>
                  {BGPBP_FIELDS.map(row => (
                    <tr
                      key={row.key}
                      style={{ opacity: row.dim && dimLocal ? 0.5 : 1 }}
                    >
                      <td
                        style={th}
                        title={row.hint ? t('bgp_best_path.' + row.hint) : undefined}
                      >
                        {t('bgp_best_path.' + row.key)}
                      </td>
                      {cands.map(c => (
                        <td key={c.id} style={td}>{cell(c, row)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>{t('bgp_best_path.aspath_hint')}</div>
          </div>

          <Err msg={error} />

          {result && (
            <div
              className="card"
              style={{
                borderLeft: '3px solid ' + (result.best == null ? 'var(--red)' : 'var(--green)'),
              }}
            >
              <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: 'var(--text)' }}>
                {result.best == null
                  ? t('bgp_best_path.no_best')
                  : t('bgp_best_path.winner_line', {
                    name: (byId(result.best) || {}).label,
                    step: t('bgp_best_path.step_' + result.decidedAt),
                  })}
              </div>
              {result.multipath.length > 1 && (
                <div style={{ marginTop: 6, fontFamily: 'var(--mono)', color: 'var(--muted)', fontSize: 13 }}>
                  {t('bgp_best_path.mp_set', {
                    n: result.multipath.length,
                    list: result.multipath.map(id => (byId(id) || {}).label).join(', '),
                  })}
                </div>
              )}
            </div>
          )}

          {result && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>{t('bgp_best_path.trace_title')}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('bgp_best_path.btn_copy_summary')}</span>
                  <CopyBtn text={summary} id="bgpbp-summary" />
                </div>
              </div>
              {result.mode === 'pairwise' ? (
                <div>
                  {result.rounds[0] && result.rounds[0].eliminated.length > 0 && renderRound(result.rounds[0], 0)}
                  <div className="hint" style={{ margin: '8px 0' }}>{t('bgp_best_path.pairwise_intro')}</div>
                  {result.pairs.map((p, i) => (
                    <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'baseline' }}>
                        <span style={{ fontFamily: 'var(--mono)' }}>
                          {t('bgp_best_path.trace_pair', { a: (byId(p.a) || {}).label, b: (byId(p.b) || {}).label })}
                        </span>
                        <span>
                          {t('bgp_best_path.trace_pair_winner', {
                            winner: (byId(p.winner) || {}).label,
                            step: t('bgp_best_path.step_' + p.step),
                          })}
                        </span>
                      </div>
                      {p.elim && (
                        <div style={{ marginTop: 6 }}>
                          <span className="badge badge-red" style={{ whiteSpace: 'normal' }}>
                            {(byId(p.elim.id) || {}).label} {bgpbpElimReason(t, p.step, p.elim)}
                          </span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                result.rounds.map((r, n) => renderRound(r, n))
              )}
              {hasMissingMedStar && (
                <div className="hint" style={{ marginTop: 8 }}>{t('bgp_best_path.med_missing_tag')}</div>
              )}
              {+opts.maxPaths > 1 && (
                <div style={{ marginTop: 12 }}>
                  <div className="card-title">{t('bgp_best_path.mp_title')}</div>
                  {result.mpExcluded.map(x => (
                    <div key={x.id} style={{ marginBottom: 4, fontSize: 13 }}>
                      <span style={{ fontFamily: 'var(--mono)' }}>{(byId(x.id) || {}).label}</span>
                      {' \u2014 '}
                      {t('bgp_best_path.' + x.key)}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div className="card-title">{t('bgp_best_path.hints_title')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hints.map((h, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span className={`badge badge-${h.level}`}>{'\u00a0'}</span>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>
                    {t('bgp_best_path.' + h.key, h.vars)}
                  </span>
                </div>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 10 }}>{t('bgp_best_path.note_client')}</div>
          </div>
          {relatedBlock}
        </div>
      )}

      {activeTab === 'reference' && (
        <div>
          <div className="card">
            <div className="card-title">{t('bgp_best_path.ref_matrix_title')}</div>
            <div className="hint" style={{ marginBottom: 10 }}>{t('bgp_best_path.ref_matrix_note')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('bgp_best_path.ref_col_step')}</th>
                    {BGPBP_DIALECTS.map(d => (
                      <th key={d} style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('bgp_best_path.dialect_' + d)}</th>
                    ))}
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('bgp_best_path.ref_col_note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {BGPBP_MATRIX_STEPS.map(step => (
                    <tr key={step} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px' }}>{t('bgp_best_path.step_' + step)}</td>
                      {BGPBP_DIALECTS.map(d => (
                        <td key={d} style={{ padding: '8px 10px', fontFamily: 'var(--mono)' }}>{bgpbpStepPos(d, step)}</td>
                      ))}
                      <td style={{ padding: '8px 10px', color: 'var(--muted)', fontSize: 12 }}>{t('bgp_best_path.ref_note_' + step)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>{t('bgp_best_path.ref_unmodelled')}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('bgp_best_path.ref_knobs_title')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('bgp_best_path.ref_col_knob')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('bgp_best_path.dialect_cisco')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('bgp_best_path.dialect_junos')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('bgp_best_path.dialect_arista')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('bgp_best_path.ref_col_effect')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(BGPBP_KNOBS).map(k => {
                    const snake = bgpbpSnake(k);
                    const labelKey = k === 'asPathIgnore' ? 'ref_knob_as_path_ignore' : ('opt_' + snake);
                    const kn = BGPBP_KNOBS[k];
                    return (
                      <tr key={k} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px' }}>{t('bgp_best_path.' + labelKey)}</td>
                        {['cisco', 'junos', 'arista'].map(d => (
                          <td key={d} style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>
                            {kn[d] || BGPBP_ABSENT}
                          </td>
                        ))}
                        <td style={{ padding: '8px 10px', fontSize: 12 }}>{t('bgp_best_path.ref_knob_' + snake + '_desc')}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('bgp_best_path.ref_traps_title')}</div>
            {BGPBP_TRAPS.map(id => (
              <div key={id} className="card" style={{ marginBottom: 10, background: 'var(--bg)' }}>
                <div className="card-title">{t('bgp_best_path.trap_' + id + '_title')}</div>
                <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: BGPBP_TRAP_PRESET[id] ? 8 : 0 }}>
                  {t('bgp_best_path.trap_' + id + '_body')}
                </div>
                {BGPBP_TRAP_PRESET[id] && (
                  <button
                    className="btn btn-sm"
                    onClick={() => { applyPreset(BGPBP_TRAP_PRESET[id]); setActiveTab('simulator'); }}
                  >
                    {t('bgp_best_path.ref_try_preset')}
                  </button>
                )}
              </div>
            ))}
          </div>

          {relatedBlock}
        </div>
      )}
    </div>
  );
}

window.BGPBestPathSimulator = BGPBestPathSimulator;
