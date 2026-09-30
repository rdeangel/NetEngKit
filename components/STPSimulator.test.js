'use strict';
// Run: node components/STPSimulator.test.js  (exits 1 on first failure)
// The engine lives inline in STPSimulator.jsx between the <stp-engine> markers; slice + evaluate it.
const assert = require('assert');
const fs = require('fs');

const src = fs.readFileSync(__dirname + '/STPSimulator.jsx', 'utf8');
const body = src.split('// <stp-engine>')[1].split('// </stp-engine>')[0];
const S = new Function(body + '\nreturn { stpElect, stpDiff, stpCost, stpBid, stpMermaid, stpLabel, stpValidate, stpBuild, STP_PRESETS };')();

let testNum = 0;
function test(name, fn) {
  testNum++;
  try {
    fn();
    console.log('  PASS [' + testNum + '] ' + name);
  } catch (e) {
    console.error('  FAIL [' + testNum + '] ' + name);
    console.error('       ' + e.message);
    process.exit(1);
  }
}

// helpers: look things up by switch name
const idOf = (topo, name) => topo.switches.find(s => s.name === name).id;
const port = (res, topo, name, n, vlan) => res.byVlan[vlan || 0].ports[idOf(topo, name) + ':' + n];
const bridge = (res, topo, name, vlan) => res.byVlan[vlan || 0].bridges[idOf(topo, name)];
const roles = (res) => Object.values(res.byVlan[0].ports).map(p => p.role);

test('T1 triangle: root by priority, C2 alternate, exactly one non-forwarding port', () => {
  const tp = S.STP_PRESETS.triangle();
  tp.variant = 'rstp';
  assert.strictEqual(S.stpValidate(tp), null);
  const r = S.stpElect(tp, {});
  const c = r.byVlan[0].components;
  assert.strictEqual(c.length, 1);
  assert.strictEqual(c[0].root, idOf(tp, 'SW-A'));
  assert.strictEqual(c[0].rootDecided, 'priority');
  // links: A1-B1, A2-C1, B2-C2
  assert.strictEqual(port(r, tp, 'SW-B', 1).role, 'root');
  assert.strictEqual(port(r, tp, 'SW-C', 1).role, 'root');
  assert.strictEqual(port(r, tp, 'SW-A', 1).role, 'designated');
  assert.strictEqual(port(r, tp, 'SW-A', 2).role, 'designated');
  assert.strictEqual(port(r, tp, 'SW-B', 2).role, 'designated');
  assert.strictEqual(port(r, tp, 'SW-C', 2).role, 'alternate');
  assert.strictEqual(port(r, tp, 'SW-C', 2).decided, 'bid');
  assert.strictEqual(S.stpLabel('alternate', 'stp').state, 'blocking');
  assert.strictEqual(S.stpLabel('alternate', 'rstp').state, 'discarding');
  assert.strictEqual(roles(r).filter(x => x !== 'root' && x !== 'designated').length, 1);
});

test('T2 equal priority: lowest MAC wins root', () => {
  const tp = S.stpBuild('rstp', 'long', [1],
    [['X', 32768, { mac: 'aabb.cc00.000a' }], ['Y', 32768, { mac: 'aabb.cc00.0005' }], ['Z', 32768, { mac: 'aabb.cc00.0007' }]],
    [['X', 'Y', '1G'], ['Y', 'Z', '1G'], ['X', 'Z', '1G']]);
  const r = S.stpElect(tp, {});
  assert.strictEqual(r.byVlan[0].components[0].root, idOf(tp, 'Y'));
  assert.strictEqual(r.byVlan[0].components[0].rootDecided, 'mac');
});

test('T3 equal-cost dual uplink: sender port ID beats local port ID', () => {
  const tp = S.STP_PRESETS.dual_uplink(); // R1-D2, R2-D1
  const r = S.stpElect(tp, {});
  assert.strictEqual(port(r, tp, 'SW-D', 2).role, 'root');
  assert.strictEqual(port(r, tp, 'SW-D', 2).decided, 'sender_port');
  assert.strictEqual(port(r, tp, 'SW-D', 1).role, 'alternate');
  assert.strictEqual(bridge(r, tp, 'SW-D').rootPort, idOf(tp, 'SW-D') + ':2');
});

test('T4a parallel p2p links: root + alternate on D, both R ports designated (never backup)', () => {
  const tp = S.STP_PRESETS.dual_uplink();
  const r = S.stpElect(tp, {});
  assert.strictEqual(port(r, tp, 'SW-R', 1).role, 'designated');
  assert.strictEqual(port(r, tp, 'SW-R', 2).role, 'designated');
  assert.ok(!roles(r).includes('backup'));
});

test('T4b shared segment {R1,R2,D1}: R1 designated, R2 backup (decided=port), D1 root', () => {
  const tp = S.STP_PRESETS.hub_backup();
  assert.strictEqual(S.stpValidate(tp), null);
  const r = S.stpElect(tp, {});
  assert.strictEqual(port(r, tp, 'SW-R', 1).role, 'designated');
  assert.strictEqual(port(r, tp, 'SW-R', 2).role, 'backup');
  assert.strictEqual(port(r, tp, 'SW-R', 2).decided, 'port');
  assert.strictEqual(port(r, tp, 'SW-D', 1).role, 'root');
});

test('T5 short vs long: mixed-speed square flips the root port, decided by cost', () => {
  const tp = S.STP_PRESETS.square_mixed(); // R-A 10G, A-B 10G, B-D 10G, D-R 1G ; D1 = to B, D2 = to R
  tp.cost = 'short';
  let r = S.stpElect(tp, {});
  assert.strictEqual(bridge(r, tp, 'SW-D').rootCost, 4);
  assert.strictEqual(port(r, tp, 'SW-D', 2).role, 'root');
  assert.strictEqual(port(r, tp, 'SW-D', 2).decided, 'cost');
  tp.cost = 'long';
  r = S.stpElect(tp, {});
  assert.strictEqual(bridge(r, tp, 'SW-D').rootCost, 6000);
  assert.strictEqual(port(r, tp, 'SW-D', 1).role, 'root');
  assert.strictEqual(port(r, tp, 'SW-D', 1).decided, 'cost');
});

test('T6 link-down what-if moves B root port, diff lists the changes', () => {
  const tp = S.STP_PRESETS.triangle();
  tp.variant = 'rstp';
  for (const [cost, expect] of [['short', 8], ['long', 40000]]) {
    tp.cost = cost;
    const base = S.stpElect(tp, {});
    const scen = S.stpElect(tp, { links: ['l1'] }); // l1 = A1-B1
    const bB = idOf(tp, 'SW-B');
    assert.strictEqual(base.byVlan[0].bridges[bB].rootPort, bB + ':1');
    assert.strictEqual(scen.byVlan[0].bridges[bB].rootPort, bB + ':2');
    assert.strictEqual(scen.byVlan[0].bridges[bB].rootCost, expect);
    const d = S.stpDiff(base.byVlan[0], scen.byVlan[0]);
    const has = (sw, p, from, to) => d.some(x => x.sw === idOf(tp, sw) && x.port === p && x.from === from && x.to === to);
    assert.ok(has('SW-B', 1, 'root', 'disabled'));
    assert.ok(has('SW-B', 2, 'designated', 'root'));
    assert.ok(has('SW-C', 2, 'alternate', 'designated'));
  }
});

test('switch-down partitions into two components, no throw', () => {
  const tp = S.stpBuild('rstp', 'long', [1], [['A', 4096], ['B', 32768], ['C', 32768]], [['A', 'B', '1G'], ['B', 'C', '1G']]);
  const r = S.stpElect(tp, { switches: [idOf(tp, 'B')] });
  const c = r.byVlan[0].components;
  assert.strictEqual(c.length, 2);
  assert.deepStrictEqual(c.map(x => x.rootDecided), ['only', 'only']);
  assert.strictEqual(port(r, tp, 'B', 1).role, 'disabled');
  assert.strictEqual(port(r, tp, 'A', 1).role, 'disabled');
});

test('PVST: per-VLAN roots and sys-id-ext in the BID', () => {
  const tp = S.stpBuild('rpvst', 'long', [1, 10],
    [['A', 4096], ['B', 32768], ['C', 32768, { vlanPri: { 10: 0 } }]], [['A', 'B', '1G'], ['B', 'C', '1G'], ['A', 'C', '1G']]);
  assert.strictEqual(S.stpValidate(tp), null);
  const r = S.stpElect(tp, {});
  assert.strictEqual(r.byVlan[1].components[0].root, idOf(tp, 'A'));
  assert.strictEqual(r.byVlan[10].components[0].root, idOf(tp, 'C'));
  assert.strictEqual(bridge(r, tp, 'A', 10).bid.pri, 4096 + 10);
  assert.strictEqual(bridge(r, tp, 'A', 1).bidHex.slice(0, 4), '1001');
  assert.strictEqual(S.stpBid({ pri: 32768, mac: 'aabb.cc00.0100' }, 1, 'rpvst').hex, '8001.aabb.cc00.0100');
  assert.strictEqual(S.stpBid({ pri: 32768, mac: 'aabb.cc00.0100' }, 1, 'rstp').hex, '8000.aabb.cc00.0100');
});

test('cost tables: short/long and manual override', () => {
  assert.strictEqual(S.stpCost('1G', 'short', ''), 4);
  assert.strictEqual(S.stpCost('10G', 'long', ''), 2000);
  assert.strictEqual(S.stpCost('400G', 'long', ''), 50);
  assert.strictEqual(S.stpCost('1G', 'long', '123'), 123);
});

test('stpMermaid escapes hostile switch names and generates node ids', () => {
  const tp = S.STP_PRESETS.triangle();
  tp.switches[0].name = '"];<img src=x onerror=alert(1)>[`{(a|b)};';
  const r = S.stpElect(tp, {});
  const m = S.stpMermaid(tp, r.byVlan[1]);
  assert.ok(m.startsWith('flowchart LR'));
  const labels = m.split('\n').filter(l => /^\s+s\d+\["/.test(l));
  assert.strictEqual(labels.length, 3);
  labels.forEach(l => {
    const inner = l.slice(l.indexOf('["') + 2, l.lastIndexOf('"]'));
    assert.ok(!/["<>&\[\]{}()|;`]/.test(inner.replace('<br/>', '')), 'unsafe char in label: ' + inner);
  });
  assert.ok(!m.includes('<img'));
  assert.ok(!m.includes('alert(1)') || !/[<>]/.test(m.replace(/<br\/>/g, '')));
});

test('stpValidate flags duplicate (switch, port), bad MAC, silent on blank', () => {
  const tp = S.STP_PRESETS.triangle();
  tp.links[1].ends[0].portNum = 1; // A:1 already used by l1
  assert.strictEqual(S.stpValidate(tp).key, 'stp_simulator.err_dup_port');
  const t2 = S.STP_PRESETS.triangle();
  t2.switches[1].mac = 'zz';
  assert.strictEqual(S.stpValidate(t2).key, 'stp_simulator.err_mac');
  const t3 = S.STP_PRESETS.triangle();
  t3.switches[1].name = '';
  assert.strictEqual(S.stpValidate(t3).key, '');
});

test('every preset validates and elects without throwing', () => {
  for (const k of Object.keys(S.STP_PRESETS)) {
    const tp = S.STP_PRESETS[k]();
    assert.strictEqual(S.stpValidate(tp), null, k);
    S.stpElect(tp, {});
  }
});

console.log('\nAll ' + testNum + ' tests passed.');
