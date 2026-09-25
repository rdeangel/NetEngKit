'use strict';
const assert = require('assert');
const S = require('./netTableSortLib.js');

let testNum = 0;
let failed = 0;
function test(name, fn) {
  testNum++;
  try {
    fn();
    console.log('  PASS [' + testNum + '] ' + name);
  } catch (e) {
    failed++;
    console.error('  FAIL [' + testNum + '] ' + name);
    console.error('       ' + e.message);
  }
}

const c = (x, y, o) => S.compareCells(x, y, o || {});
const srt = (v, o) => S.sortRows(v.map(x => [x]), [{ col: 0, dir: 'asc' }], o || {}).map(r => r.cells[0]);

test('Eth1/1 < Eth1/2 < Eth1/10', function () {
  assert.deepStrictEqual(srt(['Eth1/10', 'Eth1/2', 'Eth1/1']), ['Eth1/1', 'Eth1/2', 'Eth1/10']);
});

test('IPv4 10.0.0.2 < 10.0.0.10', function () {
  assert.ok(c('10.0.0.2', '10.0.0.10') < 0);
});

test('IPv6 numeric 2001:db8::a < 2001:db8::10 (::a=10, ::10=16)', function () {
  assert.ok(c('2001:db8::a', '2001:db8::10') < 0);
});

test('CIDR network-then-prefix 10.2.0.0/16 < 10.2.0.0/24 < 10.10.0.0/16', function () {
  assert.deepStrictEqual(
    srt(['10.10.0.0/16', '10.2.0.0/24', '10.2.0.0/16']),
    ['10.2.0.0/16', '10.2.0.0/24', '10.10.0.0/16']
  );
});

test('dotted mask equals CIDR 10.0.0.0 255.255.255.0 === 10.0.0.0/24', function () {
  assert.ok(c('10.0.0.0 255.255.255.0', '10.0.0.0/24') === 0);
});

test('Gi == GigabitEthernet alias tie', function () {
  assert.ok(c('Gi1/0/1', 'GigabitEthernet1/0/1') === 0);
});

test('Gi1/0/2 < GigabitEthernet1/0/10', function () {
  assert.ok(c('Gi1/0/2', 'GigabitEthernet1/0/10') < 0);
});

test('empty cells last in both directions', function () {
  const rows = [['', 1], ['b', 2], ['a', 3]];
  const asc = S.sortRows(rows, [{ col: 0, dir: 'asc' }], {}).map(r => r.cells[0]);
  const desc = S.sortRows(rows, [{ col: 0, dir: 'desc' }], {}).map(r => r.cells[0]);
  assert.strictEqual(asc[2], '');
  assert.strictEqual(desc[2], '');
  assert.deepStrictEqual(asc.slice(0, 2), ['a', 'b']);
  assert.deepStrictEqual(desc.slice(0, 2), ['b', 'a']);
});

test('stable ties keep input order', function () {
  assert.deepStrictEqual(
    S.sortRows([['x', '1'], ['x', '2']], [{ col: 0, dir: 'asc' }], {}).map(r => r.cells[1]),
    ['1', '2']
  );
});

test('hostname natural sw-core-2 < sw-core-10', function () {
  assert.deepStrictEqual(srt(['sw-core-10', 'sw-core-2']), ['sw-core-2', 'sw-core-10']);
});

test('mixed-type IPv4 < IPv6 < text', function () {
  assert.deepStrictEqual(srt(['host', '2001:db8::1', '10.0.0.1']), ['10.0.0.1', '2001:db8::1', 'host']);
});

test('mixed-type IPv4 < IPv6 < MAC < interface < text', function () {
  assert.deepStrictEqual(
    srt(['host', 'Gi1/1', 'aa:bb:cc:00:00:01', '2001:db8::1', '10.0.0.1']),
    ['10.0.0.1', '2001:db8::1', 'aa:bb:cc:00:00:01', 'Gi1/1', 'host']
  );
});

test('MAC colon < Cisco dotted', function () {
  assert.ok(c('aa:bb:cc:00:00:01', 'aabb.cc00.0002') < 0);
});

test('ifaceOrder speed Te > Gi, alpha Te > Gi', function () {
  assert.ok(c('Te1/1', 'Gi1/1', { ifaceOrder: 'speed' }) > 0 && c('Te1/1', 'Gi1/1', { ifaceOrder: 'alpha' }) > 0);
});

test('ifaceOrder speed Fa < Gi', function () {
  assert.ok(c('Fa0/1', 'Gi0/1', { ifaceOrder: 'speed' }) < 0);
});

test('ifaceOrder toggle Te vs Hu (speed Te < Hu, alpha Te > Hu)', function () {
  assert.ok(c('Te1/1', 'Hu1/1', { ifaceOrder: 'speed' }) < 0 && c('Te1/1', 'Hu1/1', { ifaceOrder: 'alpha' }) > 0);
});

test('subinterface Gi0/1.50 < Gi0/1.100 and Junos ge-0/0/1:0 < ge-0/0/1:1', function () {
  assert.ok(c('Gi0/1.50', 'Gi0/1.100') < 0 && c('ge-0/0/1:0', 'ge-0/0/1:1') < 0);
});

test('parseTable TSV auto-detect header and row-preserving sort', function () {
  const p = S.parseTable('Port\tIP\nEth1/10\t10.0.0.10\nEth1/2\t10.0.0.2', {});
  assert.strictEqual(p.delimiter, '\t');
  assert.ok(p.hasHeader);
  assert.deepStrictEqual(p.headers, ['Port', 'IP']);
  const sorted = S.sortRows(p.rows, [{ col: 0, dir: 'asc' }], {}).map(r => r.cells);
  assert.deepStrictEqual(sorted, [['Eth1/2', '10.0.0.2'], ['Eth1/10', '10.0.0.10']]);
});

test('RFC-4180 quoted comma in CSV cell', function () {
  assert.strictEqual(S.parseTable('a,"b,c"\n1,2', { header: 'no' }).rows[0][1], 'b,c');
});

test('quoted newline inside CSV cell is preserved (RFC-4180)', function () {
  const p = S.parseTable('h1,h2\n"a\nb",10.0.0.1\nc,10.0.0.2', { header: 'no' });
  assert.strictEqual(p.delimiter, ',');
  assert.strictEqual(p.rows.length, 3);
  assert.deepStrictEqual(p.rows[0], ['h1', 'h2']);
  assert.strictEqual(p.rows[1][0], 'a\nb');
  assert.strictEqual(p.rows[1][1], '10.0.0.1');
  assert.deepStrictEqual(p.rows[2], ['c', '10.0.0.2']);
});

test('mid-field inch mark is literal and does not swallow later rows', function () {
  const p = S.parseTable('Desc\tIP\n19" rack\t10.0.0.1\nx\t10.0.0.2\ny\t10.0.0.3', {});
  assert.strictEqual(p.delimiter, '\t');
  assert.ok(p.hasHeader);
  assert.deepStrictEqual(p.headers, ['Desc', 'IP']);
  assert.strictEqual(p.rows.length, 3);
  assert.strictEqual(p.rows[0][0], '19" rack');
  assert.deepStrictEqual(p.rows[0], ['19" rack', '10.0.0.1']);
  assert.deepStrictEqual(p.rows[1], ['x', '10.0.0.2']);
  assert.deepStrictEqual(p.rows[2], ['y', '10.0.0.3']);
});

test('markdown data row whose first cell starts with --- is kept', function () {
  const p = S.parseTable('| --- data | x |\n| foo | bar |', { header: 'no' });
  assert.strictEqual(p.delimiter, '|');
  assert.strictEqual(p.rows.length, 2);
  assert.strictEqual(p.rows[0][0], '--- data');
  assert.strictEqual(p.rows[0][1], 'x');
  assert.deepStrictEqual(p.rows[1], ['foo', 'bar']);
});

test('markdown export round-trips escaped pipe and backslash', function () {
  const headers = ['Port', 'Note'];
  const rows = [['Gi1/1', 'a | b'], ['Te1/1', 'path\\to']];
  const md = S.toMarkdown(headers, rows);
  const p = S.parseTable(md, { delimiter: '|', header: 'yes' });
  assert.deepStrictEqual(p.headers, headers);
  assert.deepStrictEqual(p.rows, rows);
});

test('MAC colon/hyphen/Cisco-dotted formats compare equal', function () {
  assert.ok(c('aa-bb-cc-00-00-01', 'aabb.cc00.0001') === 0);
  assert.ok(c('aa:bb:cc:00:00:01', 'aa-bb-cc-00-00-01') === 0);
  assert.ok(c('aa:bb:cc:00:00:01', 'aabb.cc00.0001') === 0);
});

test('ifaceOrder speed Fa < Gi < Te < Twe < Fo < Hu', function () {
  const o = { ifaceOrder: 'speed' };
  assert.ok(c('Fa0/1', 'Gi0/1', o) < 0);
  assert.ok(c('Gi0/1', 'Te0/1', o) < 0);
  assert.ok(c('Te0/1', 'Twe0/1', o) < 0);
  assert.ok(c('Twe0/1', 'Fo0/1', o) < 0);
  assert.ok(c('Fo0/1', 'Hu0/1', o) < 0);
});

test('original index i preserved on wrappers', function () {
  const sorted = S.sortRows([['Eth1/10'], ['Eth1/2']], [{ col: 0, dir: 'asc' }], {});
  assert.strictEqual(sorted[0].cells[0], 'Eth1/2');
  assert.strictEqual(sorted[0].i, 1);
  assert.strictEqual(sorted[1].i, 0);
});

test('plain IPv4 host sorts after same-network /24', function () {
  assert.ok(c('10.2.0.0/24', '10.2.0.0') < 0);
});

test('non-contiguous wildcard mask falls through to natural', function () {
  const k = S.cellKey('10.0.0.0 255.0.255.0');
  assert.strictEqual(k.r, 4);
});

test('leading-zero IPv4 octet rejected (octal ambiguity)', function () {
  const k = S.cellKey('10.0.0.010');
  assert.strictEqual(k.r, 4);
});

test('toTSV / toCSV / toMarkdown round-trip header', function () {
  const headers = ['Port', 'IP'];
  const rows = [['Eth1/2', '10.0.0.2']];
  assert.ok(S.toTSV(headers, rows).startsWith('Port\tIP\n'));
  assert.ok(S.toCSV(headers, rows).startsWith('Port,IP\n'));
  const md = S.toMarkdown(headers, rows);
  assert.ok(md.indexOf('| Port | IP |') === 0);
  assert.ok(md.indexOf('Eth1/2') !== -1);
});

test('markdown table parse drops separator row', function () {
  const p = S.parseTable('| Port | IP |\n| --- | --- |\n| Eth1/2 | 10.0.0.2 |', {});
  assert.strictEqual(p.delimiter, '|');
  assert.ok(p.hasHeader);
  assert.deepStrictEqual(p.headers, ['Port', 'IP']);
  assert.deepStrictEqual(p.rows, [['Eth1/2', '10.0.0.2']]);
});

test('SAMPLE is non-empty TSV with a header', function () {
  const p = S.parseTable(S.SAMPLE, {});
  assert.strictEqual(p.delimiter, '\t');
  assert.ok(p.hasHeader);
  assert.ok(p.rows.length >= 3);
});

if (failed) {
  console.error('\n' + failed + ' failed / ' + testNum + ' tests');
  process.exit(1);
}
console.log('\nFW-13 comparator OK (' + testNum + ' tests)');
