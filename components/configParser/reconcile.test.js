'use strict';
const assert = require('assert');
const r = require('./reconcile.js');

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

// ── selectEdges ──────────────────────────────────────────────────────────────

test('portless suppression: port edge wins, portless edge for same pair is omitted', function () {
  // Two links for the same node pair: one port-based, one portless (description).
  const links = [
    {
      a: 'n0', b: 'n1',
      aIntf: 'ge-0/0/0', bIntf: 'Gi0/0',
      evidence: [], confidence: 'structural',
    },
    {
      a: 'n0', b: 'n1',
      aIntf: '', bIntf: '',
      evidence: [{ type: 'desc_one', level: 'weak', text: 'link to RouterB', detail: '...' }],
      confidence: 'weak',
    },
  ];
  const edges = r.selectEdges(links, {});
  assert.strictEqual(edges.length, 1, 'Expected exactly 1 edge (portless suppressed)');
  assert.ok(edges[0].label.includes('ge-0/0/0'), 'Surviving edge should be the port-based one');
});

test('port label: when one side has an empty interface, use ?', function () {
  const links = [
    {
      a: 'n0', b: 'n1',
      aIntf: 'ge-0/0/0', bIntf: '',
      evidence: [], confidence: 'structural',
    },
  ];
  const edges = r.selectEdges(links, {});
  assert.strictEqual(edges.length, 1);
  assert.strictEqual(edges[0].label, 'ge-0/0/0 ↔ ?');
});

test('description text label: first evidence with .text field becomes the label', function () {
  const links = [
    {
      a: 'n0', b: 'n1',
      aIntf: '', bIntf: '',
      evidence: [
        { type: 'desc_both', level: 'plausible', text: 'link to RouterB', detail: '...' },
      ],
      confidence: 'plausible',
    },
  ];
  const edges = r.selectEdges(links, {});
  assert.strictEqual(edges.length, 1);
  assert.strictEqual(edges[0].label, 'link to RouterB');
});

test('default label fallback: no ports and no evidence with .text → opts.descLabel or "description"', function () {
  const links = [
    {
      a: 'n0', b: 'n1',
      aIntf: '', bIntf: '',
      evidence: [{ type: 'subnet', level: 'structural', detail: 'same /30' }],
      confidence: 'structural',
    },
  ];
  // Without opts.descLabel
  const edges1 = r.selectEdges(links, {});
  assert.strictEqual(edges1[0].label, 'description', 'Should fall back to "description"');

  // With opts.descLabel
  const edges2 = r.selectEdges(links, { descLabel: 'subnet link' });
  assert.strictEqual(edges2[0].label, 'subnet link', 'Should use opts.descLabel');
});

// ── toMermaidLinkStyle ───────────────────────────────────────────────────────

test('toMermaidLinkStyle confirmed', function () {
  const v = r.CONF_VISUAL.confirmed;
  assert.strictEqual(r.toMermaidLinkStyle(v), 'stroke:#22c55e,stroke-width:3px');
});

test('toMermaidLinkStyle structural', function () {
  const v = r.CONF_VISUAL.structural;
  assert.strictEqual(r.toMermaidLinkStyle(v), 'stroke:#38bdf8,stroke-width:2px');
});

test('toMermaidLinkStyle plausible (has dash)', function () {
  const v = r.CONF_VISUAL.plausible;
  assert.strictEqual(r.toMermaidLinkStyle(v), 'stroke:#f59e0b,stroke-width:2px,stroke-dasharray:6 4');
});

test('toMermaidLinkStyle weak (has dash)', function () {
  const v = r.CONF_VISUAL.weak;
  assert.strictEqual(r.toMermaidLinkStyle(v), 'stroke:#94a3b8,stroke-width:1px,stroke-dasharray:2 5');
});

// ── toDrawioStyle ────────────────────────────────────────────────────────────

test('toDrawioStyle confirmed', function () {
  const v = r.CONF_VISUAL.confirmed;
  assert.strictEqual(r.toDrawioStyle(v), 'strokeColor=#22c55e;strokeWidth=3');
});

test('toDrawioStyle structural', function () {
  const v = r.CONF_VISUAL.structural;
  assert.strictEqual(r.toDrawioStyle(v), 'strokeColor=#38bdf8;strokeWidth=2');
});

test('toDrawioStyle plausible (has dash)', function () {
  const v = r.CONF_VISUAL.plausible;
  assert.strictEqual(r.toDrawioStyle(v), 'strokeColor=#f59e0b;strokeWidth=2;dashed=1;dashPattern=6 4');
});

test('toDrawioStyle weak (has dash)', function () {
  const v = r.CONF_VISUAL.weak;
  assert.strictEqual(r.toDrawioStyle(v), 'strokeColor=#94a3b8;strokeWidth=1;dashed=1;dashPattern=2 5');
});

// ── buildMermaid (regression) ────────────────────────────────────────────────

test('buildMermaid: known input produces correct structure', function () {
  const nodes = [{ id: 'n0', label: 'RouterA' }, { id: 'n1', label: 'RouterB' }];
  const links = [{
    a: 'n0', b: 'n1',
    aIntf: 'ge-0/0/0', bIntf: 'Gi0/0',
    evidence: [], confidence: 'confirmed',
  }];
  const out = r.buildMermaid(nodes, links, 'LR', {});

  assert.ok(out.includes('graph LR'), 'Missing "graph LR" header');
  assert.ok(out.includes('n0["RouterA"]'), 'Missing node def for RouterA');
  assert.ok(out.includes('n1["RouterB"]'), 'Missing node def for RouterB');

  // Edge line must reference both node ids and both interface names
  const edgeLineMatch = out.split('\n').some(function (line) {
    return line.includes('n0') && line.includes('n1') &&
           line.includes('ge-0/0/0') && line.includes('Gi0/0');
  });
  assert.ok(edgeLineMatch, 'No edge line found containing n0, n1, ge-0/0/0, and Gi0/0');

  // linkStyle 0 line must reference confirmed colors
  const styleLine = out.split('\n').find(function (l) { return l.includes('linkStyle 0'); });
  assert.ok(styleLine, 'Missing linkStyle 0 line');
  assert.ok(styleLine.includes('stroke:#22c55e'), 'linkStyle 0 missing confirmed color');
  assert.ok(styleLine.includes('stroke-width:3px'), 'linkStyle 0 missing confirmed stroke-width');
});

// ── buildDrawio ──────────────────────────────────────────────────────────────

// Shared fixture for buildDrawio tests
const bddNodes = [{ id: 'n0', label: 'RouterA' }, { id: 'n1', label: 'RouterB' }];
const bddLinks = [{
  a: 'n0', b: 'n1',
  aIntf: 'ge-0/0/0', bIntf: 'Gi0/0',
  evidence: [], confidence: 'confirmed',
}];

test('buildDrawio: well-formed XML with base cells', function () {
  const xml = r.buildDrawio(bddNodes, bddLinks, null, {});
  assert.ok(xml.trimStart().startsWith('<mxGraphModel>'), 'Should start with <mxGraphModel>');
  assert.ok(xml.trimEnd().endsWith('</mxGraphModel>'), 'Should end with </mxGraphModel>');
  assert.ok(xml.includes('<mxCell id="0"/>'), 'Missing base cell id="0"');
  assert.ok(xml.includes('<mxCell id="1" parent="0"/>'), 'Missing base cell id="1" parent="0"');
});

test('buildDrawio: correct vertex and edge counts', function () {
  const xml = r.buildDrawio(bddNodes, bddLinks, null, {});
  // Count vertex="1" occurrences
  const vertexCount = (xml.match(/vertex="1"/g) || []).length;
  assert.strictEqual(vertexCount, 2, 'Expected exactly 2 vertex cells for 2 nodes');
  // Count edge="1" occurrences
  const edgeCount = (xml.match(/edge="1"/g) || []).length;
  assert.strictEqual(edgeCount, 1, 'Expected exactly 1 edge cell');
});

test('buildDrawio: confidence → style mapping (confirmed → strokeColor=#22c55e)', function () {
  const xml = r.buildDrawio(bddNodes, bddLinks, null, {});
  assert.ok(xml.includes('strokeColor=#22c55e'), 'Edge should contain strokeColor=#22c55e for confirmed confidence');
});

test('buildDrawio: XML escaping of node labels with " and <', function () {
  const nodes = [
    { id: 'n0', label: 'Router "A" <core>' },
    { id: 'n1', label: 'RouterB' },
  ];
  const links = [{
    a: 'n0', b: 'n1',
    aIntf: 'ge-0/0/0', bIntf: 'Gi0/0',
    evidence: [], confidence: 'confirmed',
  }];
  const xml = r.buildDrawio(nodes, links, null, {});
  assert.ok(xml.includes('&quot;'), 'Double quotes in label must be escaped as &quot;');
  assert.ok(xml.includes('&lt;'), 'Less-than in label must be escaped as &lt;');
  // Raw unescaped characters must NOT appear inside value attributes
  // (check there's no value="...unescaped-quote..." pattern)
  assert.ok(!xml.includes('value="Router "A"'), 'Raw unescaped double-quote must not appear in value attribute');
});

test('buildDrawio: grid fallback with positions = null — all vertices appear', function () {
  const xml = r.buildDrawio(bddNodes, bddLinks, null, {});
  const vertexCount = (xml.match(/vertex="1"/g) || []).length;
  assert.strictEqual(vertexCount, 2, 'Both nodes should appear even with no positions');
  // Both node ids should be present in the output
  assert.ok(xml.includes('id="n0"'), 'Node n0 missing');
  assert.ok(xml.includes('id="n1"'), 'Node n1 missing');
});

// ── buildDrawio parallel edge separation ────────────────────────────────────

test('buildDrawio: single edge between a pair has no mxPoint waypoint', function () {
  const xml = r.buildDrawio(bddNodes, bddLinks, null, {});
  assert.ok(!xml.includes('<mxPoint'), 'Single edge should have no waypoint');
});

test('buildDrawio: two parallel edges between same pair each get a distinct mxPoint waypoint', function () {
  const nodes = [{ id: 'n0', label: 'RouterA' }, { id: 'n1', label: 'RouterB' }];
  const links = [
    { a: 'n0', b: 'n1', aIntf: 'ge-0/0/0', bIntf: 'Gi0/0', evidence: [], confidence: 'confirmed' },
    { a: 'n0', b: 'n1', aIntf: 'ge-0/0/1', bIntf: 'Gi0/1', evidence: [], confidence: 'structural' },
  ];
  const positions = {
    n0: { x: 0, y: 100, w: 120, h: 60 },
    n1: { x: 200, y: 100, w: 120, h: 60 },
  };
  const xml = r.buildDrawio(nodes, links, positions, {});
  const waypoints = xml.match(/<mxPoint x="[^"]*" y="[^"]*"\/>/g) || [];
  assert.strictEqual(waypoints.length, 2, 'Each of the 2 parallel edges should get exactly one waypoint');
  // The two waypoints must differ (one above, one below the midpoint)
  assert.notStrictEqual(waypoints[0], waypoints[1], 'Parallel edge waypoints must be at different positions');
});

test('buildDrawio: parallel edges include curved=1 in their style', function () {
  const nodes = [{ id: 'n0', label: 'RouterA' }, { id: 'n1', label: 'RouterB' }];
  const links = [
    { a: 'n0', b: 'n1', aIntf: 'ge-0/0/0', bIntf: 'Gi0/0', evidence: [], confidence: 'confirmed' },
    { a: 'n0', b: 'n1', aIntf: 'ge-0/0/1', bIntf: 'Gi0/1', evidence: [], confidence: 'structural' },
  ];
  const xml = r.buildDrawio(nodes, links, null, {});
  const curvedCount = (xml.match(/curved=1/g) || []).length;
  assert.strictEqual(curvedCount, 2, 'Both parallel edges should have curved=1 in their style');
});

console.log('\nAll ' + testNum + ' tests passed');
