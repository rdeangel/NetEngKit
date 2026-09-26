'use strict';
const assert = require('assert');
const IR = require('./fwIR.js');
const { ios, asa } = require('./parse-cisco.js');
const iptables = require('./parse-iptables.js');
const fortios = require('./parse-fortios.js');
const junos = require('./parse-junos.js');
const A = require('./analyzer.js');

let testNum = 0;
let passed = 0;
function test(name, fn) {
  testNum++;
  try {
    fn();
    passed++;
    console.log('  PASS [' + testNum + '] ' + name);
  } catch (e) {
    console.error('  FAIL [' + testNum + '] ' + name);
    console.error('       ' + (e.stack || e.message));
    process.exit(1);
  }
}

function run(parser, text) {
  const p = parser.parse(text);
  IR.finalize(p);
  return { p, r: A.analyze(p) };
}
function find(r, type, id) {
  return r.findings.filter(f => f.type === type && f.rule.id === id);
}
function byIds(f) {
  return f.by.map(b => b.id).sort();
}
function flagged(r, id) {
  return r.findings.some(f => f.rule.id === id || f.by.some(b => b.id === id));
}
function dump(r) {
  return r.findings.map(f => f.type + ':' + f.rule.id + ' by=' + byIds(f).join(',') + ' ' + JSON.stringify(f.params)).join('\n');
}

const VENDORS = {
  ios: { parser: ios, name: 'ios' },
  asa: { parser: asa, name: 'asa' },
  iptables: { parser: iptables, name: 'iptables' },
  fortios: { parser: fortios, name: 'fortios' },
  junosSrx: { parser: junos, name: 'junos-srx' },
  junosFilter: { parser: junos, name: 'junos-filter' }
};

function fixtureShadow(v) {
  if (v === 'ios') return {
    text: [
      'ip access-list extended WEB',
      ' 10 permit tcp 10.0.0.0 0.0.255.255 any eq 443',
      ' 20 permit tcp 10.0.1.0 0.0.0.255 host 192.0.2.10 eq 443'
    ].join('\n'),
    later: '20', earlier: '10'
  };
  if (v === 'asa') return {
    text: [
      'access-list WEB extended permit tcp 10.0.0.0 255.255.0.0 any eq 443',
      'access-list WEB extended permit tcp 10.0.1.0 255.255.255.0 host 192.0.2.10 eq 443'
    ].join('\n'),
    later: null, earlier: null
  };
  if (v === 'iptables') return {
    text: [
      '*filter',
      ':INPUT ACCEPT [0:0]',
      '-A INPUT -s 10.0.0.0/16 -p tcp --dport 443 -j ACCEPT',
      '-A INPUT -s 10.0.1.0/24 -d 192.0.2.10 -p tcp --dport 443 -j ACCEPT',
      'COMMIT'
    ].join('\n'),
    later: 'INPUT#2', earlier: 'INPUT#1'
  };
  if (v === 'fortios') return {
    text: [
      'config firewall address',
      '    edit "NET16"',
      '        set subnet 10.0.0.0 255.255.0.0',
      '    next',
      '    edit "NET24"',
      '        set subnet 10.0.1.0 255.255.255.0',
      '    next',
      '    edit "HOST"',
      '        set subnet 192.0.2.10 255.255.255.255',
      '    next',
      'end',
      'config firewall policy',
      '    edit 10',
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set srcaddr "NET16"',
      '        set dstaddr "all"',
      '        set service "HTTPS"',
      '        set action accept',
      '        set schedule "always"',
      '    next',
      '    edit 20',
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set srcaddr "NET24"',
      '        set dstaddr "HOST"',
      '        set service "HTTPS"',
      '        set action accept',
      '        set schedule "always"',
      '    next',
      'end'
    ].join('\n'),
    later: '20', earlier: '10'
  };
  if (v === 'junos-srx') return {
    text: [
      'set security address-book global address NET16 10.0.0.0/16',
      'set security address-book global address NET24 10.0.1.0/24',
      'set security address-book global address HOST 192.0.2.10/32',
      'set security policies from-zone trust to-zone untrust policy p10 match source-address NET16',
      'set security policies from-zone trust to-zone untrust policy p10 match destination-address any',
      'set security policies from-zone trust to-zone untrust policy p10 match application junos-https',
      'set security policies from-zone trust to-zone untrust policy p10 then permit',
      'set security policies from-zone trust to-zone untrust policy p20 match source-address NET24',
      'set security policies from-zone trust to-zone untrust policy p20 match destination-address HOST',
      'set security policies from-zone trust to-zone untrust policy p20 match application junos-https',
      'set security policies from-zone trust to-zone untrust policy p20 then permit'
    ].join('\n'),
    later: 'p20', earlier: 'p10'
  };
  return {
    text: [
      'set firewall family inet filter F term t10 from source-address 10.0.0.0/16',
      'set firewall family inet filter F term t10 from protocol tcp',
      'set firewall family inet filter F term t10 from destination-port 443',
      'set firewall family inet filter F term t10 then accept',
      'set firewall family inet filter F term t20 from source-address 10.0.1.0/24',
      'set firewall family inet filter F term t20 from destination-address 192.0.2.10/32',
      'set firewall family inet filter F term t20 from protocol tcp',
      'set firewall family inet filter F term t20 from destination-port 443',
      'set firewall family inet filter F term t20 then accept'
    ].join('\n'),
    later: 't20', earlier: 't10'
  };
}

function fixtureUnion(v) {
  if (v === 'ios') return {
    text: [
      'ip access-list extended U',
      ' 10 permit tcp 10.0.0.0 0.0.0.127 any eq 443',
      ' 20 permit tcp 10.0.0.128 0.0.0.127 any eq 443',
      ' 30 permit tcp 10.0.0.0 0.0.0.255 any eq 443'
    ].join('\n'),
    later: '30', a: '10', b: '20'
  };
  if (v === 'asa') return {
    text: [
      'access-list U extended permit tcp 10.0.0.0 255.255.255.128 any eq 443',
      'access-list U extended permit tcp 10.0.0.128 255.255.255.128 any eq 443',
      'access-list U extended permit tcp 10.0.0.0 255.255.255.0 any eq 443'
    ].join('\n'),
    later: null, a: null, b: null
  };
  if (v === 'iptables') return {
    text: [
      '*filter', ':INPUT ACCEPT [0:0]',
      '-A INPUT -s 10.0.0.0/25 -p tcp --dport 443 -j ACCEPT',
      '-A INPUT -s 10.0.0.128/25 -p tcp --dport 443 -j ACCEPT',
      '-A INPUT -s 10.0.0.0/24 -p tcp --dport 443 -j ACCEPT',
      'COMMIT'
    ].join('\n'),
    later: 'INPUT#3', a: 'INPUT#1', b: 'INPUT#2'
  };
  if (v === 'fortios') return {
    text: [
      'config firewall address',
      '    edit "A"',
      '        set subnet 10.0.0.0 255.255.255.128',
      '    next',
      '    edit "B"',
      '        set subnet 10.0.0.128 255.255.255.128',
      '    next',
      '    edit "C"',
      '        set subnet 10.0.0.0 255.255.255.0',
      '    next',
      'end',
      'config firewall policy',
      '    edit 1',
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set srcaddr "A"',
      '        set dstaddr "all"',
      '        set service "HTTPS"',
      '        set action accept',
      '        set schedule "always"',
      '    next',
      '    edit 2',
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set srcaddr "B"',
      '        set dstaddr "all"',
      '        set service "HTTPS"',
      '        set action accept',
      '        set schedule "always"',
      '    next',
      '    edit 3',
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set srcaddr "C"',
      '        set dstaddr "all"',
      '        set service "HTTPS"',
      '        set action accept',
      '        set schedule "always"',
      '    next',
      'end'
    ].join('\n'),
    later: '3', a: '1', b: '2'
  };
  if (v === 'junos-srx') return {
    text: [
      'set security address-book global address A 10.0.0.0/25',
      'set security address-book global address B 10.0.0.128/25',
      'set security address-book global address C 10.0.0.0/24',
      'set security policies from-zone trust to-zone untrust policy pa match source-address A',
      'set security policies from-zone trust to-zone untrust policy pa match destination-address any',
      'set security policies from-zone trust to-zone untrust policy pa match application junos-https',
      'set security policies from-zone trust to-zone untrust policy pa then permit',
      'set security policies from-zone trust to-zone untrust policy pb match source-address B',
      'set security policies from-zone trust to-zone untrust policy pb match destination-address any',
      'set security policies from-zone trust to-zone untrust policy pb match application junos-https',
      'set security policies from-zone trust to-zone untrust policy pb then permit',
      'set security policies from-zone trust to-zone untrust policy pc match source-address C',
      'set security policies from-zone trust to-zone untrust policy pc match destination-address any',
      'set security policies from-zone trust to-zone untrust policy pc match application junos-https',
      'set security policies from-zone trust to-zone untrust policy pc then permit'
    ].join('\n'),
    later: 'pc', a: 'pa', b: 'pb'
  };
  return {
    text: [
      'set firewall family inet filter U term ta from source-address 10.0.0.0/25',
      'set firewall family inet filter U term ta from protocol tcp',
      'set firewall family inet filter U term ta from destination-port 443',
      'set firewall family inet filter U term ta then accept',
      'set firewall family inet filter U term tb from source-address 10.0.0.128/25',
      'set firewall family inet filter U term tb from protocol tcp',
      'set firewall family inet filter U term tb from destination-port 443',
      'set firewall family inet filter U term tb then accept',
      'set firewall family inet filter U term tc from source-address 10.0.0.0/24',
      'set firewall family inet filter U term tc from protocol tcp',
      'set firewall family inet filter U term tc from destination-port 443',
      'set firewall family inet filter U term tc then accept'
    ].join('\n'),
    later: 'tc', a: 'ta', b: 'tb'
  };
}

function fixtureDup(v) {
  if (v === 'ios') return {
    text: [
      'ip access-list extended D',
      ' 10 permit tcp 10.0.0.0 0.0.255.255 any eq 443',
      ' 20 permit tcp 10.0.0.0 0.0.255.255 any eq 443'
    ].join('\n'),
    second: '20', first: '10'
  };
  if (v === 'asa') return {
    text: [
      'access-list D extended permit tcp 10.0.0.0 255.255.0.0 any eq 443',
      'access-list D extended permit tcp 10.0.0.0 255.255.0.0 any eq 443'
    ].join('\n'),
    second: null, first: null
  };
  if (v === 'iptables') return {
    text: [
      '*filter', ':INPUT ACCEPT [0:0]',
      '-A INPUT -s 10.0.0.0/16 -p tcp --dport 443 -j ACCEPT',
      '-A INPUT -s 10.0.0.0/16 -p tcp --dport 443 -j ACCEPT',
      'COMMIT'
    ].join('\n'),
    second: 'INPUT#2', first: 'INPUT#1'
  };
  if (v === 'fortios') return {
    text: [
      'config firewall address',
      '    edit "NET16"',
      '        set subnet 10.0.0.0 255.255.0.0',
      '    next',
      'end',
      'config firewall policy',
      '    edit 1',
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set srcaddr "NET16"',
      '        set dstaddr "all"',
      '        set service "HTTPS"',
      '        set action accept',
      '        set schedule "always"',
      '    next',
      '    edit 2',
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set srcaddr "NET16"',
      '        set dstaddr "all"',
      '        set service "HTTPS"',
      '        set action accept',
      '        set schedule "always"',
      '    next',
      'end'
    ].join('\n'),
    second: '2', first: '1'
  };
  if (v === 'junos-srx') return {
    text: [
      'set security address-book global address NET16 10.0.0.0/16',
      'set security policies from-zone trust to-zone untrust policy a match source-address NET16',
      'set security policies from-zone trust to-zone untrust policy a match destination-address any',
      'set security policies from-zone trust to-zone untrust policy a match application junos-https',
      'set security policies from-zone trust to-zone untrust policy a then permit',
      'set security policies from-zone trust to-zone untrust policy b match source-address NET16',
      'set security policies from-zone trust to-zone untrust policy b match destination-address any',
      'set security policies from-zone trust to-zone untrust policy b match application junos-https',
      'set security policies from-zone trust to-zone untrust policy b then permit'
    ].join('\n'),
    second: 'b', first: 'a'
  };
  return {
    text: [
      'set firewall family inet filter D term a from source-address 10.0.0.0/16',
      'set firewall family inet filter D term a from protocol tcp',
      'set firewall family inet filter D term a from destination-port 443',
      'set firewall family inet filter D term a then accept',
      'set firewall family inet filter D term b from source-address 10.0.0.0/16',
      'set firewall family inet filter D term b from protocol tcp',
      'set firewall family inet filter D term b from destination-port 443',
      'set firewall family inet filter D term b then accept'
    ].join('\n'),
    second: 'b', first: 'a'
  };
}

function fixtureContra(v) {
  if (v === 'ios') return {
    text: [
      'ip access-list extended C',
      ' 10 deny ip 10.0.0.0 0.255.255.255 any',
      ' 20 permit tcp 10.1.1.0 0.0.0.255 any eq 22'
    ].join('\n'),
    later: '20', earlier: '10'
  };
  if (v === 'asa') return {
    text: [
      'access-list C extended deny ip 10.0.0.0 255.0.0.0 any',
      'access-list C extended permit tcp 10.1.1.0 255.255.255.0 any eq 22'
    ].join('\n'),
    later: null, earlier: null
  };
  if (v === 'iptables') return {
    text: [
      '*filter', ':INPUT ACCEPT [0:0]',
      '-A INPUT -s 10.0.0.0/8 -j DROP',
      '-A INPUT -s 10.1.1.0/24 -p tcp --dport 22 -j ACCEPT',
      'COMMIT'
    ].join('\n'),
    later: 'INPUT#2', earlier: 'INPUT#1'
  };
  if (v === 'fortios') return {
    text: [
      'config firewall address',
      '    edit "NET8"',
      '        set subnet 10.0.0.0 255.0.0.0',
      '    next',
      '    edit "NET24"',
      '        set subnet 10.1.1.0 255.255.255.0',
      '    next',
      'end',
      'config firewall policy',
      '    edit 1',
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set srcaddr "NET8"',
      '        set dstaddr "all"',
      '        set service "ALL"',
      '        set action deny',
      '        set schedule "always"',
      '    next',
      '    edit 2',
      '        set srcintf "port1"',
      '        set dstintf "port2"',
      '        set srcaddr "NET24"',
      '        set dstaddr "all"',
      '        set service "SSH"',
      '        set action accept',
      '        set schedule "always"',
      '    next',
      'end'
    ].join('\n'),
    later: '2', earlier: '1'
  };
  if (v === 'junos-srx') return {
    text: [
      'set security address-book global address NET8 10.0.0.0/8',
      'set security address-book global address NET24 10.1.1.0/24',
      'set security policies from-zone trust to-zone untrust policy d match source-address NET8',
      'set security policies from-zone trust to-zone untrust policy d match destination-address any',
      'set security policies from-zone trust to-zone untrust policy d match application any',
      'set security policies from-zone trust to-zone untrust policy d then deny',
      'set security policies from-zone trust to-zone untrust policy p match source-address NET24',
      'set security policies from-zone trust to-zone untrust policy p match destination-address any',
      'set security policies from-zone trust to-zone untrust policy p match application junos-ssh',
      'set security policies from-zone trust to-zone untrust policy p then permit'
    ].join('\n'),
    later: 'p', earlier: 'd'
  };
  return {
    text: [
      'set firewall family inet filter C term d from source-address 10.0.0.0/8',
      'set firewall family inet filter C term d then discard',
      'set firewall family inet filter C term p from source-address 10.1.1.0/24',
      'set firewall family inet filter C term p from protocol tcp',
      'set firewall family inet filter C term p from destination-port 22',
      'set firewall family inet filter C term p then accept'
    ].join('\n'),
    later: 'p', earlier: 'd'
  };
}

function laterId(parser, p, fx) {
  if (fx.later) return fx.later;
  const rules = p.rules.filter(r => r.action === 'permit' || r.action === 'deny');
  return rules[rules.length - 1].id;
}
function earlierId(parser, p, fx) {
  if (fx.earlier) return fx.earlier;
  return p.rules[0].id;
}

['ios', 'asa', 'iptables', 'fortios', 'junos-srx', 'junos-filter'].forEach(function (v) {
  const parser = v.indexOf('junos') === 0 ? junos : ({ ios, asa, iptables, fortios })[v];
  test('shadowed [' + v + ']', function () {
    const fx = fixtureShadow(v);
    const { p, r } = run(parser, fx.text);
    const later = laterId(parser, p, fx);
    const earlier = earlierId(parser, p, fx);
    const hits = find(r, 'shadowed', later);
    assert.strictEqual(hits.length, 1, 'expected 1 shadowed for ' + later + ' got\n' + dump(r));
    assert.strictEqual(hits[0].params.single, true);
    assert.deepStrictEqual(byIds(hits[0]), [earlier].sort());
    assert.ok(hits[0].rule.lines && hits[0].rule.lines.length, 'rule.lines present');
  });
});

['ios', 'asa', 'iptables', 'fortios', 'junos-srx', 'junos-filter'].forEach(function (v) {
  const parser = v.indexOf('junos') === 0 ? junos : ({ ios, asa, iptables, fortios })[v];
  test('union-shadow [' + v + ']', function () {
    const fx = fixtureUnion(v);
    const { p, r } = run(parser, fx.text);
    const later = fx.later || p.rules[p.rules.length - 1].id;
    const hits = find(r, 'shadowed', later);
    assert.strictEqual(hits.length, 1, 'expected union shadowed\n' + dump(r));
    assert.strictEqual(hits[0].params.single, false);
    const ids = byIds(hits[0]);
    const a = fx.a || p.rules[0].id;
    const b = fx.b || p.rules[1].id;
    assert.deepStrictEqual(ids, [a, b].sort());
    const ra = p.rules.find(x => x.id === a);
    const rb = p.rules.find(x => x.id === b);
    const rc = p.rules.find(x => x.id === later);
    assert.ok(ra && rb && rc);
  });
});

['ios', 'asa', 'iptables', 'fortios', 'junos-srx', 'junos-filter'].forEach(function (v) {
  const parser = v.indexOf('junos') === 0 ? junos : ({ ios, asa, iptables, fortios })[v];
  test('duplicate [' + v + ']', function () {
    const fx = fixtureDup(v);
    const { p, r } = run(parser, fx.text);
    const second = fx.second || p.rules[1].id;
    const first = fx.first || p.rules[0].id;
    const hits = find(r, 'duplicate', second);
    assert.strictEqual(hits.length, 1, 'dup\n' + dump(r));
    assert.deepStrictEqual(byIds(hits[0]), [first]);
    assert.strictEqual(find(r, 'duplicate', first).length, 0);
    assert.ok(!flagged(r, first) || r.findings.every(f => f.rule.id !== first));
  });
});

['ios', 'asa', 'iptables', 'fortios', 'junos-srx', 'junos-filter'].forEach(function (v) {
  const parser = v.indexOf('junos') === 0 ? junos : ({ ios, asa, iptables, fortios })[v];
  test('contradiction deny_covers_permit [' + v + ']', function () {
    const fx = fixtureContra(v);
    const { p, r } = run(parser, fx.text);
    const later = fx.later || p.rules[1].id;
    const hits = find(r, 'contradiction', later);
    assert.strictEqual(hits.length, 1, 'contra\n' + dump(r));
    assert.strictEqual(hits[0].params.direction, 'deny_covers_permit');
  });
});

test('contradiction permit_covers_deny [ios]', function () {
  const text = [
    'ip access-list extended C',
    ' 10 permit ip 10.0.0.0 0.255.255.255 any',
    ' 20 deny tcp 10.1.1.0 0.0.0.255 any eq 22'
  ].join('\n');
  const { r } = run(ios, text);
  const hits = find(r, 'contradiction', '20');
  assert.strictEqual(hits.length, 1, dump(r));
  assert.strictEqual(hits[0].params.direction, 'permit_covers_deny');
});

test('nested group expansion [ios]', function () {
  const text = [
    'object-group network INNER',
    ' host 10.0.1.8',
    ' host 10.0.1.9',
    'object-group network OUTER',
    ' group-object INNER',
    'ip access-list extended G',
    ' 10 permit ip object-group OUTER any',
    ' 20 permit ip host 10.0.1.8 any'
  ].join('\n');
  const { p, r } = run(ios, text);
  const hits = find(r, 'shadowed', '20');
  assert.strictEqual(hits.length, 1, dump(r) + '\n' + JSON.stringify(p.objects.addr, null, 0).slice(0, 400));
  const outer = p.objects.addr.OUTER;
  assert.ok(outer && outer.kind === 'group');
  const resolved = p.rules[0].src.v4;
  assert.ok(IR.containsIntervals(resolved, [[IR.ipv4ToInt('10.0.1.8'), IR.ipv4ToInt('10.0.1.8')]]));
});

test('nested group expansion [asa]', function () {
  const text = [
    'object network H',
    ' host 10.0.1.8',
    'object network H2',
    ' host 10.0.1.9',
    'object-group network INNER',
    ' network-object object H',
    ' network-object object H2',
    'object-group network OUTER',
    ' group-object INNER',
    'object-group service SVCTCP tcp',
    ' port-object eq 443',
    'object-group service SVCOUTER',
    ' group-object SVCTCP',
    'access-list G extended permit tcp object-group OUTER any object-group SVCOUTER',
    'access-list G extended permit tcp host 10.0.1.8 any eq 443'
  ].join('\n');
  const { p, r } = run(asa, text);
  const later = p.rules[1].id;
  const hits = find(r, 'shadowed', later);
  assert.strictEqual(hits.length, 1, dump(r));
});

test('nested group expansion [fortios]', function () {
  const text = [
    'config firewall address',
    '    edit "H"',
    '        set subnet 10.0.1.8 255.255.255.255',
    '    next',
    '    edit "H2"',
    '        set subnet 10.0.1.9 255.255.255.255',
    '    next',
    'end',
    'config firewall addrgrp',
    '    edit "INNER"',
    '        set member "H" "H2"',
    '    next',
    '    edit "OUTER"',
    '        set member "INNER"',
    '    next',
    'end',
    'config firewall service custom',
    '    edit "HTTPS2"',
    '        set tcp-portrange 443',
    '    next',
    'end',
    'config firewall service group',
    '    edit "SGINNER"',
    '        set member "HTTPS2"',
    '    next',
    '    edit "SGOUTER"',
    '        set member "SGINNER"',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "OUTER"',
    '        set dstaddr "all"',
    '        set service "SGOUTER"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "H"',
    '        set dstaddr "all"',
    '        set service "HTTPS2"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p, r } = run(fortios, text);
  const hits = find(r, 'shadowed', '2');
  assert.strictEqual(hits.length, 1, dump(r));
  const outer = p.rules[0].src.v4;
  const host = IR.ipv4ToInt('10.0.1.8');
  assert.ok(IR.containsIntervals(outer, [[host, host]]));
});

test('nested group expansion [junos SRX]', function () {
  const text = [
    'set security address-book global address H 10.0.1.8/32',
    'set security address-book global address H2 10.0.1.9/32',
    'set security address-book global address-set INNER address H',
    'set security address-book global address-set INNER address H2',
    'set security address-book global address-set OUTER address-set INNER',
    'set applications application HTTPS2 protocol tcp destination-port 443',
    'set applications application-set SGINNER application HTTPS2',
    'set applications application-set SGOUTER application-set SGINNER',
    'set security policies from-zone trust to-zone untrust policy g match source-address OUTER',
    'set security policies from-zone trust to-zone untrust policy g match destination-address any',
    'set security policies from-zone trust to-zone untrust policy g match application SGOUTER',
    'set security policies from-zone trust to-zone untrust policy g then permit',
    'set security policies from-zone trust to-zone untrust policy h match source-address H',
    'set security policies from-zone trust to-zone untrust policy h match destination-address any',
    'set security policies from-zone trust to-zone untrust policy h match application HTTPS2',
    'set security policies from-zone trust to-zone untrust policy h then permit'
  ].join('\n');
  const { p, r } = run(junos, text);
  const hits = find(r, 'shadowed', 'h');
  assert.strictEqual(hits.length, 1, dump(r));
});

test('per-zone-pair scoping [junos]', function () {
  const text = [
    'set security address-book global address NET16 10.0.0.0/16',
    'set security address-book global address NET24 10.0.1.0/24',
    'set security policies from-zone trust to-zone untrust policy broad match source-address NET16',
    'set security policies from-zone trust to-zone untrust policy broad match destination-address any',
    'set security policies from-zone trust to-zone untrust policy broad match application junos-https',
    'set security policies from-zone trust to-zone untrust policy broad then permit',
    'set security policies from-zone dmz to-zone untrust policy dmz-policy match source-address NET24',
    'set security policies from-zone dmz to-zone untrust policy dmz-policy match destination-address any',
    'set security policies from-zone dmz to-zone untrust policy dmz-policy match application junos-https',
    'set security policies from-zone dmz to-zone untrust policy dmz-policy then permit'
  ].join('\n');
  const { p, r } = run(junos, text);
  const dmz = p.rules.find(x => x.id === 'dmz-policy');
  const broad = p.rules.find(x => x.id === 'broad');
  assert.ok(dmz && broad);
  assert.notStrictEqual(dmz.scopeKey, broad.scopeKey);
  assert.strictEqual(r.findings.filter(f => f.rule.id === 'dmz-policy' && (f.type === 'shadowed' || f.type === 'duplicate' || f.type === 'contradiction')).length, 0, dump(r));
  assert.ok(!r.findings.some(f => f.by.some(b => b.id === 'dmz-policy')));
});

test('per-intf-pair scoping [fortios]', function () {
  const text = [
    'config firewall address',
    '    edit "NET24"',
    '        set subnet 10.0.1.0 255.255.255.0',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "ALL"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port3"',
    '        set dstintf "port2"',
    '        set srcaddr "NET24"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 3',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "NET24"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 4',
    '        set srcintf "any"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "ALL"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 5',
    '        set srcintf "port5"',
    '        set dstintf "port2"',
    '        set srcaddr "NET24"',
    '        set dstaddr "all"',
    '        set service "SSH"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { r } = run(fortios, text);
  assert.strictEqual(find(r, 'shadowed', '2').length, 0, 'port3 pair not covered\n' + dump(r));
  assert.strictEqual(find(r, 'shadowed', '3').length, 1, 'policy 3 shadowed by 1\n' + dump(r));
  const f5 = r.findings.filter(f => f.rule.id === '5' && (f.type === 'shadowed' || f.type === 'duplicate'));
  assert.ok(f5.length >= 1, 'policy 5 covered by any-srcintf policy 4\n' + dump(r));
});

function constructsOf(r, id) {
  const pr = Object.values(r.perRule).find(x => x.id === id);
  return pr ? (pr.unsupported || []).map(u => u.construct).sort() : [];
}

test('unsupported excludes [fortios schedule/users/fqdn]', function () {
  const text = [
    'config firewall address',
    '    edit "WEB"',
    '        set type fqdn',
    '        set fqdn "example.com"',
    '    next',
    '    edit "NET16"',
    '        set subnet 10.0.0.0 255.255.0.0',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "NET16"',
    '        set dstaddr "all"',
    '        set service "ALL"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "NET16"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "business"',
    '    next',
    '    edit 3',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "NET16"',
    '        set dstaddr "all"',
    '        set service "SSH"',
    '        set action accept',
    '        set schedule "always"',
    '        set users "bob"',
    '    next',
    '    edit 4',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "WEB"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { r } = run(fortios, text);
  assert.ok(!r.findings.some(f => f.rule.id === '2'), dump(r));
  assert.ok(!r.findings.some(f => f.by.some(b => b.id === '2')));
  assert.ok(constructsOf(r, '2').indexOf('schedule') >= 0, constructsOf(r, '2'));
  assert.ok(constructsOf(r, '3').indexOf('user') >= 0);
  assert.ok(constructsOf(r, '4').indexOf('fqdn') >= 0);
});

test('unsupported excludes [junos source-identity / dynamic-application]', function () {
  const text = [
    'set security policies from-zone trust to-zone untrust policy a match source-address any',
    'set security policies from-zone trust to-zone untrust policy a match destination-address any',
    'set security policies from-zone trust to-zone untrust policy a match application any',
    'set security policies from-zone trust to-zone untrust policy a then permit',
    'set security policies from-zone trust to-zone untrust policy b match source-address any',
    'set security policies from-zone trust to-zone untrust policy b match destination-address any',
    'set security policies from-zone trust to-zone untrust policy b match application any',
    'set security policies from-zone trust to-zone untrust policy b match source-identity bob',
    'set security policies from-zone trust to-zone untrust policy b then permit',
    'set security policies from-zone trust to-zone untrust policy c match source-address any',
    'set security policies from-zone trust to-zone untrust policy c match destination-address any',
    'set security policies from-zone trust to-zone untrust policy c match application any',
    'set security policies from-zone trust to-zone untrust policy c match dynamic-application junos:HTTP',
    'set security policies from-zone trust to-zone untrust policy c then permit'
  ].join('\n');
  const { r } = run(junos, text);
  assert.ok(!r.findings.some(f => f.rule.id === 'b' || f.by.some(x => x.id === 'b')), dump(r));
  assert.ok(constructsOf(r, 'b').indexOf('user') >= 0);
  assert.ok(constructsOf(r, 'c').indexOf('app_id') >= 0);
});

test('unsupported excludes [asa fqdn / user]', function () {
  const text = [
    'object network FQ',
    ' fqdn v4 example.com',
    'access-list X extended permit ip any any',
    'access-list X extended permit ip object FQ any',
    'access-list X extended permit tcp any any eq 80 user LOCAL\\bob'
  ].join('\n');
  const { p, r } = run(asa, text);
  const fq = p.rules.find(x => (x.srcRefs || []).indexOf('FQ') >= 0 || JSON.stringify(x.srcRefs).indexOf('FQ') >= 0);
  assert.ok(fq, 'fqdn rule');
  assert.ok((fq.unsupported || []).some(u => u.construct === 'fqdn'));
  assert.ok(!r.findings.some(f => f.rule.id === fq.id));
  const userR = p.rules.find(x => (x.unsupported || []).some(u => u.construct === 'user'));
  assert.ok(userR);
});

test('unsupported excludes [iptables conntrack / negate]', function () {
  const text = [
    '*filter', ':INPUT ACCEPT [0:0]',
    '-A INPUT -s 10.0.0.0/8 -j ACCEPT',
    '-A INPUT -s 10.1.1.0/24 -m conntrack --ctstate NEW -j ACCEPT',
    '-A INPUT ! -s 10.2.0.0/16 -j DROP',
    'COMMIT'
  ].join('\n');
  const { p, r } = run(iptables, text);
  const ct = p.rules.find(x => (x.unsupported || []).some(u => u.construct === 'state'));
  const neg = p.rules.find(x => (x.unsupported || []).some(u => u.construct === 'negate'));
  assert.ok(ct && neg);
  assert.ok(!r.findings.some(f => f.rule.id === ct.id || f.by.some(b => b.id === ct.id)));
});

test('unsupported excludes [ios established / time-range / wildcard]', function () {
  const text = [
    'ip access-list extended X',
    ' 10 permit tcp any any',
    ' 20 permit tcp any any established',
    ' 30 permit tcp any any eq 80 time-range BUSINESS',
    ' 40 permit ip 10.0.0.0 0.0.1.1 any'
  ].join('\n');
  const { p, r } = run(ios, text);
  assert.ok(p.rules.find(x => x.id === '20').unsupported.some(u => u.construct === 'tcp_flags'));
  assert.ok(p.rules.find(x => x.id === '30').unsupported.some(u => u.construct === 'schedule'));
  assert.ok(p.rules.find(x => x.id === '40').unsupported.some(u => u.construct === 'wildcard'));
  assert.ok(!r.findings.some(f => f.rule.id === '20' || f.by.some(b => b.id === '20')));
});

test('unsupported excludes [junos filter except]', function () {
  const text = [
    'set firewall family inet filter F term a from source-address 10.0.0.0/8',
    'set firewall family inet filter F term a then accept',
    'set firewall family inet filter F term b from source-address 10.1.0.0/16 except',
    'set firewall family inet filter F term b then accept'
  ].join('\n');
  const { p, r } = run(junos, text);
  const b = p.rules.find(x => x.id === 'b');
  assert.ok(b.unsupported.some(u => u.construct === 'negate'));
  assert.ok(!r.findings.some(f => f.rule.id === 'b'));
});

test('IR.parseV4 forms', function () {
  const a = IR.parseV4('10.0.0.0/24');
  assert.ok(a && a.contiguous && a.lo === IR.ipv4ToInt('10.0.0.0') && a.hi === IR.ipv4ToInt('10.0.0.255'));
  const b = IR.parseV4('10.0.0.0 255.255.255.0');
  assert.ok(b && b.contiguous && b.kind === 'subnet');
  const c = IR.parseV4('10.0.0.0 0.0.0.255');
  assert.ok(c && c.wildcard && c.contiguous);
  const d = IR.parseV4('10.0.0.1-10.0.0.10');
  assert.ok(d && d.kind === 'range' && d.lo === IR.ipv4ToInt('10.0.0.1') && d.hi === IR.ipv4ToInt('10.0.0.10'));
  const e = IR.parseV4('10.0.0.0 0.0.1.1', { mode: 'wildcard' });
  assert.ok(e && e.wildcard && e.contiguous === false);
});

test('IOS neq/gt/lt/range ports', function () {
  const text = [
    'ip access-list extended P',
    ' 10 permit tcp any any neq 80',
    ' 20 permit tcp any any gt 1023',
    ' 30 permit tcp any any lt 1024',
    ' 40 permit tcp any any range 20 21'
  ].join('\n');
  const { p } = run(ios, text);
  function dport(id) { return p.rules.find(r => r.id === id).svc[0].dport; }
  assert.deepStrictEqual(dport('10'), [[0, 79], [81, 65535]]);
  assert.deepStrictEqual(dport('20'), [[1024, 65535]]);
  assert.deepStrictEqual(dport('30'), [[0, 1023]]);
  assert.deepStrictEqual(dport('40'), [[20, 21]]);
});

test('FortiOS policy order is text order, missing action=deny, schedule always not flagged', function () {
  const text = [
    'config firewall policy',
    '    edit 20',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "ALL"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 10',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p } = run(fortios, text);
  assert.strictEqual(p.rules[0].id, '20');
  assert.strictEqual(p.rules[1].id, '10');
  assert.strictEqual(p.rules[1].order, 1);
  assert.strictEqual(p.rules[1].action, 'deny');
  assert.strictEqual((p.rules[0].unsupported || []).length, 0);
});

test('Junos filter then count → accept terminal', function () {
  const text = [
    'set firewall family inet filter F term t from source-address 10.0.0.0/8',
    'set firewall family inet filter F term t then count foo'
  ].join('\n');
  const { p } = run(junos, text);
  const t = p.rules.find(r => r.id === 't');
  assert.ok(t);
  assert.strictEqual(t.action, 'permit');
  assert.strictEqual(t.terminal, true);
});

test('disabled rules not flagged / not coverers', function () {
  const fgt = [
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "ALL"',
    '        set action accept',
    '        set status disable',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p, r } = run(fortios, fgt);
  assert.strictEqual(p.rules[0].disabled, true);
  assert.ok(!r.findings.some(f => f.rule.id === '1' || f.by.some(b => b.id === '1')), dump(r));

  const asaT = [
    'access-list X extended permit ip any any inactive',
    'access-list X extended permit tcp any any eq 80'
  ].join('\n');
  const a = run(asa, asaT);
  assert.ok(a.p.rules[0].disabled);
  assert.ok(!a.r.findings.some(f => f.by.some(b => b.id === a.p.rules[0].id)));

  const j = [
    'deactivate security policies from-zone trust to-zone untrust policy a',
    'set security policies from-zone trust to-zone untrust policy a match source-address any',
    'set security policies from-zone trust to-zone untrust policy a match destination-address any',
    'set security policies from-zone trust to-zone untrust policy a match application any',
    'set security policies from-zone trust to-zone untrust policy a then permit',
    'set security policies from-zone trust to-zone untrust policy b match source-address any',
    'set security policies from-zone trust to-zone untrust policy b match destination-address any',
    'set security policies from-zone trust to-zone untrust policy b match application junos-http',
    'set security policies from-zone trust to-zone untrust policy b then permit'
  ].join('\n');
  const jr = run(junos, j);
  const pa = jr.p.rules.find(x => x.id === 'a');
  assert.ok(pa.disabled, 'deactivate marks disabled');
  assert.ok(!jr.r.findings.some(f => f.by.some(b => b.id === 'a')));
});

test('iptables LOG not a coverer; -P warning; -I order', function () {
  const text = [
    '*filter',
    ':INPUT ACCEPT [0:0]',
    '-P INPUT DROP',
    '-A INPUT -s 10.0.0.0/8 -j LOG',
    '-A INPUT -s 10.0.0.0/8 -j ACCEPT',
    'COMMIT'
  ].join('\n');
  const { p, r } = run(iptables, text);
  const logR = p.rules.find(x => x.action === 'none');
  const acc = p.rules.find(x => x.action === 'permit');
  assert.ok(logR && acc);
  assert.ok(!r.findings.some(f => f.rule.id === acc.id && f.by.some(b => b.id === logR.id)), dump(r));
  assert.ok(p.warnings.some(w => w.code === 'default_policy_ignored' && w.line > 0));

  const ins = [
    '*filter', ':INPUT ACCEPT [0:0]',
    '-A INPUT -s 10.0.0.0/8 -j ACCEPT',
    '-I INPUT -s 192.0.2.0/24 -j DROP',
    'COMMIT'
  ].join('\n');
  const ir = run(iptables, ins);
  assert.strictEqual(ir.p.rules[0].id, 'INPUT#1');
  assert.ok(IR.containsIntervals(ir.p.rules[0].src.v4, [[IR.ipv4ToInt('192.0.2.0'), IR.ipv4ToInt('192.0.2.255')]]));
});

['ios', 'asa', 'iptables', 'fortios', 'junos'].forEach(function (name) {
  const parser = name === 'junos' ? junos : ({ ios, asa, iptables, fortios })[name];
  test('garbage unparsed_line [' + name + ']', function () {
    let text, expectLine;
    if (name === 'ios') {
      text = 'ip access-list extended X\n 10 permit ip any any\n GARBAGE-TOKEN-XYZ\n 20 deny ip any any';
      expectLine = 3;
    } else if (name === 'asa') {
      text = 'access-list X extended permit ip any any\nGARBAGE-TOKEN-XYZ\naccess-list X extended deny ip host 1.1.1.1 any';
      expectLine = 2;
    } else if (name === 'iptables') {
      text = '*filter\n:INPUT ACCEPT [0:0]\nGARBAGE-TOKEN-XYZ\n-A INPUT -j ACCEPT\nCOMMIT';
      expectLine = 3;
    } else if (name === 'fortios') {
      text = 'config firewall policy\n    edit 1\n        set srcintf "port1"\n        set dstintf "port2"\n        set srcaddr "all"\n        set dstaddr "all"\n        set service "ALL"\n        set action accept\n        set schedule "always"\n        GARBAGE-TOKEN-XYZ\n    next\nend';
      expectLine = 10;
    } else {
      text = 'set security policies from-zone trust to-zone untrust policy a then permit\nGARBAGE-TOKEN-XYZ\nset security policies from-zone trust to-zone untrust policy a match application any';
      // set parser skips non-set lines without warning currently — force unparsed
      // curly/set: non-set lines are ignored. Add insert which warns insert_unsupported.
      // Plan: garbage line inside each vendor → unparsed_line. For junos, a non-set non-curly line
      // inside should warn. We'll treat unknown set as ignored_block; use `insert`? Plan says insert → insert_unsupported.
      // Use a `set` with unknown path that's still a statement... that's ignored_block.
      // Better: parse a curly+garbage. Simpler: add warning in parser for non-set lines that aren't comments.
      text = 'set firewall family inet filter F term t then accept\nGARBAGE-TOKEN-XYZ';
      expectLine = 2;
    }
    const { p } = run(parser, text);
    const u = p.warnings.filter(w => w.code === 'unparsed_line');
    if (name === 'junos' && !u.length) {
      // junos set-form currently skips non-set lines. That's a silent drop — fix expected after parser tweak.
    }
    assert.ok(u.length >= 1, name + ' missing unparsed_line: ' + JSON.stringify(p.warnings));
    if (name !== 'junos') assert.ok(u.some(w => w.line === expectLine), JSON.stringify(u));
  });
});

test('any_wide permit high; trailing deny not flagged', function () {
  const text = [
    'ip access-list extended X',
    ' 10 permit ip any any',
    ' 20 deny ip any any'
  ].join('\n');
  const { r } = run(ios, text);
  const aw = find(r, 'any_wide', '10');
  assert.strictEqual(aw.length, 1, dump(r));
  assert.strictEqual(aw[0].params.level, 'high');
  assert.strictEqual(find(r, 'any_wide', '20').length, 0);
});

test('merge adjacent dst-only; gap breaks merge', function () {
  const ok = [
    'ip access-list extended M',
    ' 10 permit ip host 10.0.0.1 host 192.0.2.1',
    ' 20 permit ip host 10.0.0.1 host 192.0.2.2'
  ].join('\n');
  const { r } = run(ios, ok);
  const m = find(r, 'merge', '20');
  assert.strictEqual(m.length, 1, dump(r));
  assert.strictEqual(m[0].params.dim, 'dst');

  const gap = [
    'ip access-list extended M',
    ' 10 permit ip host 10.0.0.1 host 192.0.2.1',
    ' 15 permit tcp any any eq 22',
    ' 20 permit ip host 10.0.0.1 host 192.0.2.2'
  ].join('\n');
  const g = run(ios, gap);
  assert.strictEqual(find(g.r, 'merge', '20').length, 0, dump(g.r));
});

test('SRX any-ipv4 does not cover later any', function () {
  const text = [
    'set security policies from-zone trust to-zone untrust policy a match source-address any-ipv4',
    'set security policies from-zone trust to-zone untrust policy a match destination-address any-ipv4',
    'set security policies from-zone trust to-zone untrust policy a match application any',
    'set security policies from-zone trust to-zone untrust policy a then permit',
    'set security policies from-zone trust to-zone untrust policy b match source-address any',
    'set security policies from-zone trust to-zone untrust policy b match destination-address any',
    'set security policies from-zone trust to-zone untrust policy b match application any',
    'set security policies from-zone trust to-zone untrust policy b then permit'
  ].join('\n');
  const { p, r } = run(junos, text);
  assert.strictEqual(p.rules[0].src.v6, 'none');
  assert.strictEqual(p.rules[1].src.v6, 'any');
  assert.strictEqual(find(r, 'shadowed', 'b').length, 0, dump(r));
  assert.strictEqual(find(r, 'duplicate', 'b').length, 0);
});

test('maxBoxes cap on union fixture', function () {
  const fx = fixtureUnion('ios');
  const p = ios.parse(fx.text);
  IR.finalize(p);
  const r = A.analyze(p, { maxBoxes: 4 });
  assert.ok(r.findings.some(f => f.type === 'undetermined'), dump(r));
  assert.strictEqual(find(r, 'shadowed', fx.later).length, 0);
});

['ios', 'asa', 'iptables', 'fortios', 'junos'].forEach(function (name) {
  const parser = name === 'junos' ? junos : ({ ios, asa, iptables, fortios })[name];
  test('sample yields findings [' + name + ']', function () {
    const { p, r } = run(parser, parser.sample);
    const unp = p.warnings.filter(w => w.code === 'unparsed_line');
    assert.strictEqual(unp.length, 0, JSON.stringify(unp));
    assert.ok(r.findings.some(f => f.type === 'shadowed'), dump(r));
    assert.ok(r.findings.some(f => f.type === 'duplicate'), dump(r));
    assert.ok(r.findings.some(f => f.type === 'contradiction'), dump(r));
    assert.ok(p.rules.some(x => x.unsupported && x.unsupported.length), 'need unsupported rule');
  });
});

test('removalCommands FortiOS/SRX/iptables', function () {
  const f = run(fortios, fortios.sample);
  const cmdF = A.removalCommands(f.p, f.r.cleanup);
  assert.ok(/delete\s+\d+/.test(cmdF), cmdF);

  const j = run(junos, junos.sample);
  const cmdJ = A.removalCommands(j.p, j.r.cleanup);
  assert.ok(/delete security policies from-zone /.test(cmdJ), cmdJ);

  const i = run(iptables, iptables.sample);
  const cmdI = A.removalCommands(i.p, i.r.cleanup);
  assert.ok(/-D\s+INPUT/.test(cmdI), cmdI);
});

function claimFindings(r, id) {
  return r.findings.filter(function (f) {
    if (['shadowed', 'duplicate', 'contradiction'].indexOf(f.type) < 0) return false;
    return f.rule.id === id || f.by.some(function (b) { return b.id === id; });
  });
}
function ruleById(p, id) {
  return p.rules.find(function (x) { return x.id === id; });
}

test('BLOCK1 ASA object-group after destination is not a cover-all', function () {
  const text = [
    'object-group service WEB tcp',
    ' port-object eq www',
    'access-list OUT extended permit tcp any any object-group WEB',
    'access-list OUT extended permit tcp any any eq 22'
  ].join('\n');
  const { p, r } = run(asa, text);
  const later = p.rules[1];
  assert.ok(later, 'second rule');
  assert.strictEqual(find(r, 'shadowed', later.id).length, 0, dump(r));
  const first = p.rules[0];
  const firstIneligible = first.unsupported && first.unsupported.length;
  const firstIsHttp = first.svc && first.svc.length && first.svc[0].dport &&
    IR.containsIntervals(first.svc[0].dport, [[80, 80]]) &&
    !IR.containsIntervals(first.svc[0].dport, [[22, 22]]);
  assert.ok(firstIneligible || firstIsHttp, 'port group parsed or rule ineligible: ' + JSON.stringify(first.svc) + ' ' + JSON.stringify(first.unsupported));
});

test('BLOCK1 IOS trailing TCP flag does not widen the ACE', function () {
  const text = [
    'ip access-list extended X',
    ' 10 permit tcp any any ack',
    ' 20 permit tcp any any eq 22'
  ].join('\n');
  const { p, r } = run(ios, text);
  const r10 = ruleById(p, '10');
  assert.ok(r10.unsupported && r10.unsupported.length, 'ack must mark ineligible ' + JSON.stringify(r10.unsupported));
  assert.ok(r10.unsupported.some(function (u) { return u.construct === 'tcp_flags' || u.construct === 'option'; }));
  assert.strictEqual(claimFindings(r, '10').length, 0, dump(r));
  assert.strictEqual(find(r, 'shadowed', '20').length, 0, dump(r));
});

test('BLOCK2 IOS object-group CIDR member does not shrink the group', function () {
  const text = [
    'object-group network G',
    ' 10.0.0.0/8',
    ' 192.168.1.0 255.255.255.0',
    'ip access-list extended X',
    ' 10 permit ip 192.168.1.0 0.0.0.255 any',
    ' 20 permit ip object-group G any'
  ].join('\n');
  const { p, r } = run(ios, text);
  assert.strictEqual(find(r, 'duplicate', '20').length, 0, dump(r));
  const r20 = ruleById(p, '20');
  assert.ok(r20.unsupported && r20.unsupported.length || IR.containsIntervals(r20.src.v4, [[IR.ipv4ToInt('10.0.0.0'), IR.ipv4ToInt('10.255.255.255')]]),
    'group unanalysable or includes /8');
});

test('BLOCK2 IOS unknown port name in service group marks referencers ineligible', function () {
  const text = [
    'object-group service S',
    ' tcp eq foobar',
    'ip access-list extended X',
    ' 10 permit object-group S any any',
    ' 20 permit tcp any any eq 22'
  ].join('\n');
  const { p, r } = run(ios, text);
  const r10 = ruleById(p, '10');
  assert.ok(r10.unsupported && r10.unsupported.length, JSON.stringify(r10.unsupported));
  assert.strictEqual(find(r, 'shadowed', '20').length, 0, dump(r));
});

test('BLOCK2 ASA unknown service-object protocol marks referencers ineligible', function () {
  const text = [
    'object-group service S',
    ' service-object foo',
    'access-list OUT extended permit object-group S any any',
    'access-list OUT extended permit tcp any any eq 22'
  ].join('\n');
  const { p, r } = run(asa, text);
  const first = p.rules[0];
  assert.ok(first.unsupported && first.unsupported.length, JSON.stringify(first.unsupported));
  assert.strictEqual(find(r, 'shadowed', p.rules[1].id).length, 0, dump(r));
});

test('BLOCK2 ASA unknown protocol-object / icmp-object members mark the group', function () {
  const protoText = [
    'object-group protocol P',
    ' protocol-object notaprotocol',
    'access-list OUT extended permit object-group P any any',
    'access-list OUT extended permit tcp any any eq 22'
  ].join('\n');
  const a = run(asa, protoText);
  assert.ok(a.p.rules[0].unsupported && a.p.rules[0].unsupported.length);
  assert.ok(a.p.warnings.some(function (w) { return w.code === 'unparsed_line'; }));
  assert.strictEqual(find(a.r, 'shadowed', a.p.rules[1].id).length, 0, dump(a.r));

  const icmpText = [
    'object-group icmp-type I',
    ' icmp-object notanicmp',
    'access-list OUT extended permit icmp any any object-group I',
    'access-list OUT extended permit icmp any any echo'
  ].join('\n');
  const b = run(asa, icmpText);
  assert.ok(b.p.rules[0].unsupported && b.p.rules[0].unsupported.length);
  assert.ok(b.p.warnings.some(function (w) { return w.code === 'unparsed_line'; }));
});

test('BLOCK3 Junos curly form keeps inactive: and later terms', function () {
  const text = [
    'firewall {',
    '    family inet {',
    '        filter F {',
    '            inactive: term a {',
    '                from {',
    '                    source-address {',
    '                        10.0.0.0/8;',
    '                    }',
    '                }',
    '                then accept;',
    '            }',
    '            term b {',
    '                from {',
    '                    source-address {',
    '                        10.1.0.0/16;',
    '                    }',
    '                }',
    '                then accept;',
    '            }',
    '        }',
    '    }',
    '}'
  ].join('\n');
  const { p, r } = run(junos, text);
  const ta = ruleById(p, 'a');
  const tb = ruleById(p, 'b');
  assert.ok(ta && tb, 'both terms present: ' + p.rules.map(function (x) { return x.id; }).join(','));
  assert.ok(ta.disabled, 'inactive: term a');
  assert.ok(!tb.disabled, 'term b active');
  assert.strictEqual(find(r, 'shadowed', 'b').length, 0, dump(r));
  const unp = p.warnings.filter(function (w) { return w.code === 'unparsed_line'; });
  assert.strictEqual(unp.length, 0, JSON.stringify(unp));
});

test('BLOCK3 SRX curly form keeps p2/p3 and inactive: on p2', function () {
  const text = [
    'security {',
    '    policies {',
    '        from-zone trust to-zone untrust {',
    '            policy p1 {',
    '                match {',
    '                    source-address any;',
    '                    destination-address any;',
    '                    application junos-https;',
    '                }',
    '                then {',
    '                    permit;',
    '                }',
    '            }',
    '            inactive: policy p2 {',
    '                match {',
    '                    source-address any;',
    '                    destination-address any;',
    '                    application any;',
    '                }',
    '                then {',
    '                    permit;',
    '                }',
    '            }',
    '            policy p3 {',
    '                match {',
    '                    source-address any;',
    '                    destination-address any;',
    '                    application junos-ssh;',
    '                }',
    '                then {',
    '                    permit;',
    '                }',
    '            }',
    '        }',
    '    }',
    '}'
  ].join('\n');
  const { p, r } = run(junos, text);
  const p1 = ruleById(p, 'p1');
  const p2 = ruleById(p, 'p2');
  const p3 = ruleById(p, 'p3');
  assert.ok(p1 && p2 && p3, p.rules.map(function (x) { return x.id; }).join(','));
  assert.ok(p2.disabled, 'inactive: policy p2');
  assert.ok(!p1.disabled && !p3.disabled);
  assert.strictEqual(p1.action, 'permit');
  assert.strictEqual(p3.action, 'permit');
  assert.ok(!r.findings.some(function (f) { return f.by.some(function (b) { return b.id === 'p2'; }); }), dump(r));
  const unp = p.warnings.filter(function (w) { return w.code === 'unparsed_line'; });
  assert.strictEqual(unp.length, 0, JSON.stringify(unp));
});

test('BLOCK4 deactivate applies to filter terms and matches whole names', function () {
  const term = [
    'set firewall family inet filter F term a from source-address 10.0.0.0/8',
    'set firewall family inet filter F term a then accept',
    'set firewall family inet filter F term b from source-address 10.1.0.0/16',
    'set firewall family inet filter F term b then accept',
    'deactivate firewall family inet filter F term a'
  ].join('\n');
  const t = run(junos, term);
  assert.ok(ruleById(t.p, 'a').disabled, 'term a deactivated');
  assert.ok(!ruleById(t.p, 'b').disabled);
  assert.strictEqual(find(t.r, 'shadowed', 'b').length, 0, dump(t.r));

  const pol = [
    'set security policies from-zone trust to-zone untrust policy allow match source-address any',
    'set security policies from-zone trust to-zone untrust policy allow match destination-address any',
    'set security policies from-zone trust to-zone untrust policy allow match application any',
    'set security policies from-zone trust to-zone untrust policy allow then permit',
    'set security policies from-zone trust to-zone untrust policy allow-https match source-address any',
    'set security policies from-zone trust to-zone untrust policy allow-https match destination-address any',
    'set security policies from-zone trust to-zone untrust policy allow-https match application junos-https',
    'set security policies from-zone trust to-zone untrust policy allow-https then permit',
    'deactivate security policies from-zone trust to-zone untrust policy allow'
  ].join('\n');
  const pr = run(junos, pol);
  assert.ok(ruleById(pr.p, 'allow').disabled);
  assert.ok(!ruleById(pr.p, 'allow-https').disabled, 'prefix match must not disable allow-https');
});

test('BLOCK5 prefix-list resolved after full parse; except is ineligible', function () {
  const later = [
    'set firewall family inet filter F term a from source-prefix-list MGMT',
    'set firewall family inet filter F term a then accept',
    'set firewall family inet filter F term b from source-address 172.16.0.0/12',
    'set firewall family inet filter F term b then accept',
    'set policy-options prefix-list MGMT 10.0.0.0/8'
  ].join('\n');
  const { p, r } = run(junos, later);
  const ta = ruleById(p, 'a');
  assert.ok(ta.unsupported && ta.unsupported.length || IR.containsIntervals(ta.src.v4, [[IR.ipv4ToInt('10.0.0.0'), IR.ipv4ToInt('10.255.255.255')]]),
    'prefix-list resolved or ineligible');
  assert.ok(!IR.isFullV4(ta.src.v4) || (ta.unsupported && ta.unsupported.length), 'must not silently become any');
  assert.strictEqual(find(r, 'shadowed', 'b').length, 0, dump(r));

  const ex = [
    'set policy-options prefix-list P 10.0.0.0/8',
    'set firewall family inet filter F term a from source-prefix-list P except',
    'set firewall family inet filter F term a then discard',
    'set firewall family inet filter F term b from source-address 172.16.0.0/12',
    'set firewall family inet filter F term b then accept'
  ].join('\n');
  const e = run(junos, ex);
  assert.ok(ruleById(e.p, 'a').unsupported.some(function (u) { return u.construct === 'negate' || u.construct === 'option'; }));
  assert.strictEqual(claimFindings(e.r, 'a').length, 0, dump(e.r));
});

test('BLOCK6 unknown Junos protocol/port/match keys mark ineligible', function () {
  const proto = [
    'set firewall family inet filter F term a from protocol rsvp',
    'set firewall family inet filter F term a then accept',
    'set firewall family inet filter F term b from protocol tcp',
    'set firewall family inet filter F term b from destination-port 22',
    'set firewall family inet filter F term b then accept'
  ].join('\n');
  const pr = run(junos, proto);
  assert.ok(ruleById(pr.p, 'a').unsupported.length, 'rsvp ineligible');
  assert.strictEqual(find(pr.r, 'shadowed', 'b').length, 0, dump(pr.r));

  const exceptPort = [
    'set firewall family inet filter F term a from protocol tcp',
    'set firewall family inet filter F term a from destination-port-except 22',
    'set firewall family inet filter F term a then accept',
    'set firewall family inet filter F term b from protocol tcp',
    'set firewall family inet filter F term b from destination-port 22',
    'set firewall family inet filter F term b then discard'
  ].join('\n');
  const ep = run(junos, exceptPort);
  assert.ok(ruleById(ep.p, 'a').unsupported.length, 'destination-port-except');
  assert.strictEqual(find(ep.r, 'contradiction', 'b').length, 0, dump(ep.r));

  const mysql = [
    'set applications application MYSQL protocol tcp destination-port mysql',
    'set security policies from-zone t to-zone u policy p1 match source-address any',
    'set security policies from-zone t to-zone u policy p1 match destination-address any',
    'set security policies from-zone t to-zone u policy p1 match application MYSQL',
    'set security policies from-zone t to-zone u policy p1 then permit',
    'set security policies from-zone t to-zone u policy p2 match source-address any',
    'set security policies from-zone t to-zone u policy p2 match destination-address any',
    'set security policies from-zone t to-zone u policy p2 match application junos-ssh',
    'set security policies from-zone t to-zone u policy p2 then deny'
  ].join('\n');
  const m = run(junos, mysql);
  assert.ok(ruleById(m.p, 'p1').unsupported.length, 'mysql port name');
  assert.strictEqual(find(m.r, 'contradiction', 'p2').length, 0, dump(m.r));
});

test('BLOCK7 FortiOS service iprange/fqdn is ineligible', function () {
  const text = [
    'config firewall service custom',
    '    edit "S1"',
    '        set tcp-portrange 1-65535',
    '        set iprange 192.0.2.1',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "S1"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "SSH"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p, r } = run(fortios, text);
  assert.ok(ruleById(p, '1').unsupported.some(function (u) { return u.construct === 'option'; }), JSON.stringify(ruleById(p, '1').unsupported));
  assert.strictEqual(find(r, 'shadowed', '2').length, 0, dump(r));
});

test('BLOCK8 iptables named port range and unknown tcp match flags', function () {
  const range = [
    '*filter', ':INPUT ACCEPT [0:0]',
    '-A INPUT -p tcp --dport ssh:http -j ACCEPT',
    '-A INPUT -p tcp --dport 22 -j DROP',
    'COMMIT'
  ].join('\n');
  const a = run(iptables, range);
  const r1 = a.p.rules[0];
  const namedOk = r1.svc && r1.svc[0] && IR.containsIntervals(r1.svc[0].dport, [[22, 80]]) &&
    !IR.isFullPort(r1.svc[0].dport);
  assert.ok((r1.unsupported && r1.unsupported.length) || namedOk, 'ssh:http modelled or ineligible ' + JSON.stringify(r1.svc));
  assert.strictEqual(find(a.r, 'duplicate', a.p.rules[1].id).length, 0, dump(a.r));

  const flag = [
    '*filter', ':INPUT ACCEPT [0:0]',
    '-A INPUT -p tcp -m tcp --tcp-option 5 -j ACCEPT',
    '-A INPUT -p tcp -j ACCEPT',
    'COMMIT'
  ].join('\n');
  const b = run(iptables, flag);
  assert.ok(b.p.rules[0].unsupported.length, 'tcp-option ineligible');
  assert.strictEqual(find(b.r, 'duplicate', b.p.rules[1].id).length, 0, dump(b.r));
});

test('FIX FortiOS unknown policy set key uses set line and marks ineligible', function () {
  const text = [
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "ALL"',
    '        set action accept',
    '        set schedule "always"',
    '        set tos 0x10',
    '        set tos-mask 0xff',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "SSH"',
    '        set action deny',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p, r } = run(fortios, text);
  assert.ok(ruleById(p, '1').unsupported.some(function (u) { return u.construct === 'option'; }));
  const w = p.warnings.filter(function (x) { return x.code === 'unparsed_line'; });
  assert.ok(w.some(function (x) { return x.line === 10 || x.line === 11; }), JSON.stringify(w));
  assert.strictEqual(find(r, 'contradiction', '2').length, 0, dump(r));
});

test('FIX FortiOS ALL protocol IP stays any-service; builtin redefine is quiet', function () {
  const text = [
    'config firewall service custom',
    '    edit "ALL"',
    '        set protocol IP',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "ALL"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "SSH"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p, r } = run(fortios, text);
  assert.ok(!p.warnings.some(function (w) { return w.code === 'duplicate_object' && w.params && w.params.name === 'ALL'; }), JSON.stringify(p.warnings));
  assert.ok(IR.isAnySvc(ruleById(p, '1').svc), JSON.stringify(ruleById(p, '1').svc));
  assert.strictEqual(find(r, 'shadowed', '2').length, 1, dump(r));
});

test('FIX FortiOS policy uid unique across config blocks', function () {
  const text = [
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "ALL"',
    '        set action deny',
    '        set schedule "always"',
    '    next',
    'end',
    'config firewall policy',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "SSH"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p } = run(fortios, text);
  assert.strictEqual(p.rules.length, 2);
  assert.notStrictEqual(p.rules[0].uid, p.rules[1].uid, p.rules.map(function (x) { return x.uid; }).join(','));
  assert.strictEqual(p.rules[1].order, 1);
});

test('FIX merge does not fire when both src and dst interfaces differ', function () {
  const text = [
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port3"',
    '        set dstintf "port4"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "HTTPS"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { r } = run(fortios, text);
  assert.strictEqual(find(r, 'merge', '2').length, 0, dump(r));
});

test('FIX iptables -I removal command uses -D spec; chain ops warn', function () {
  const text = [
    'iptables -A INPUT -s 10.0.0.0/8 -j ACCEPT',
    'iptables -I INPUT 2 -s 10.1.0.0/16 -j ACCEPT'
  ].join('\n');
  const { p, r } = run(iptables, text);
  const cmd = A.removalCommands(p, r.cleanup);
  assert.ok(cmd, 'removal command must exist');
  assert.ok(/iptables -D INPUT /.test(cmd), cmd);
  assert.ok(!/iptables -D INPUT iptables/.test(cmd), cmd);
  assert.ok(!/-D INPUT -I /.test(cmd), cmd);

  const ops = [
    '*filter', ':INPUT ACCEPT [0:0]',
    '-N FOO',
    '-A INPUT -m comment --comment " uses -X in text" -s 10.0.0.0/8 -j ACCEPT',
    '-F',
    'COMMIT'
  ].join('\n');
  const o = run(iptables, ops);
  assert.ok(o.p.warnings.some(function (w) { return w.code === 'unparsed_line' && /-[NF]/.test((w.params && w.params.text) || ''); }), JSON.stringify(o.p.warnings));
  assert.ok(o.p.rules.some(function (x) { return /uses -X/.test(x.comment || x.raw || ''); }), 'comment with -X kept');
});

function claimTypes(r) {
  return r.findings.filter(function (f) {
    return f.type === 'shadowed' || f.type === 'duplicate' || f.type === 'contradiction';
  });
}
function removalText(p, r) {
  return String(A.removalCommands(p, r.cleanup) || '').trim();
}

test('B1 ASA dual-stack group IPv6 host is ineligible, no duplicate/removal', function () {
  const text = [
    'object-group network G',
    ' network-object host 10.1.1.1',
    ' network-object host 2001:db8::1',
    'access-list OUT extended permit ip object-group G any',
    'access-list OUT extended permit ip host 10.1.1.1 any'
  ].join('\n');
  const { p, r } = run(asa, text);
  const first = p.rules[0];
  assert.ok(first.unsupported && first.unsupported.some(function (u) { return u.construct === 'ipv6'; }), JSON.stringify(first.unsupported));
  assert.strictEqual(claimTypes(r).length, 0, dump(r));
  assert.strictEqual(removalText(p, r), '');
});

test('B1 ASA IPv6 object in group is ineligible, no duplicate/removal', function () {
  const text = [
    'object network V6',
    ' host 2001:db8::1',
    'object-group network G',
    ' network-object object V6',
    ' network-object host 10.1.1.1',
    'access-list OUT extended permit ip object-group G any',
    'access-list OUT extended permit ip host 10.1.1.1 any'
  ].join('\n');
  const { p, r } = run(asa, text);
  assert.ok(p.rules[0].unsupported && p.rules[0].unsupported.some(function (u) { return u.construct === 'ipv6' || u.construct === 'unresolved'; }), JSON.stringify(p.rules[0].unsupported));
  assert.strictEqual(claimTypes(r).length, 0, dump(r));
  assert.strictEqual(removalText(p, r), '');
});

test('B1 ASA name-alias host member is ineligible, no duplicate/removal', function () {
  const text = [
    'name 10.1.1.1 SRV',
    'object-group network G',
    ' network-object host SRV',
    ' network-object host 10.1.1.1',
    'access-list OUT extended permit ip object-group G any',
    'access-list OUT extended permit ip host 10.1.1.1 any'
  ].join('\n');
  const { p, r } = run(asa, text);
  assert.ok(p.rules[0].unsupported && p.rules[0].unsupported.some(function (u) { return u.construct === 'unresolved'; }), JSON.stringify(p.rules[0].unsupported));
  assert.strictEqual(claimTypes(r).length, 0, dump(r));
  assert.strictEqual(removalText(p, r), '');
});

test('B1 ASA description-only object in group is ineligible, no duplicate/removal', function () {
  const text = [
    'object network E',
    ' description empty',
    'object-group network G',
    ' network-object object E',
    ' network-object host 10.1.1.1',
    'access-list OUT extended permit ip object-group G any',
    'access-list OUT extended permit ip host 10.1.1.1 any'
  ].join('\n');
  const { p, r } = run(asa, text);
  assert.ok(p.rules[0].unsupported && p.rules[0].unsupported.some(function (u) { return u.construct === 'unresolved'; }), JSON.stringify(p.rules[0].unsupported));
  assert.strictEqual(claimTypes(r).length, 0, dump(r));
  assert.strictEqual(removalText(p, r), '');
});

test('B1 IOS IPv6 host in object-group is ineligible, no duplicate/removal', function () {
  const text = [
    'object-group network G',
    ' host 2001:db8::1',
    ' 10.1.1.1 255.255.255.255',
    'ip access-list extended X',
    ' 10 permit ip object-group G any',
    ' 20 permit ip host 10.1.1.1 any'
  ].join('\n');
  const { p, r } = run(ios, text);
  const r10 = ruleById(p, '10');
  assert.ok(r10.unsupported && r10.unsupported.some(function (u) { return u.construct === 'ipv6'; }), JSON.stringify(r10.unsupported));
  assert.strictEqual(claimTypes(r).length, 0, dump(r));
  assert.strictEqual(removalText(p, r), '');
});

test('B1 ASA junk network-object pair does not shrink the group', function () {
  const text = [
    'object-group network INNER',
    ' network-object bogus-token here',
    ' network-object host 10.1.1.1',
    'object-group network OUTER',
    ' group-object INNER',
    ' network-object host 10.2.2.2',
    'access-list OUT extended permit ip object-group OUTER any',
    'access-list OUT extended permit ip host 10.1.1.1 any'
  ].join('\n');
  const { p, r } = run(asa, text);
  assert.ok(p.rules[0].unsupported && p.rules[0].unsupported.length, JSON.stringify(p.rules[0].unsupported));
  assert.strictEqual(find(r, 'shadowed', p.rules[1].id).length, 0, dump(r));
  assert.strictEqual(find(r, 'duplicate', p.rules[1].id).length, 0, dump(r));
  assert.strictEqual(removalText(p, r), '');
});

test('F1 iptables mid-script -F INPUT excludes pre- and post-flush rules', function () {
  const text = [
    '*filter', ':INPUT ACCEPT [0:0]',
    '-A INPUT -s 10.0.0.0/8 -j ACCEPT',
    '-A INPUT -s 10.1.0.0/16 -j ACCEPT',
    '-F INPUT',
    '-A INPUT -s 10.0.0.0/8 -j ACCEPT',
    '-A INPUT -s 10.1.0.0/16 -j DROP',
    'COMMIT'
  ].join('\n');
  const { p, r } = run(iptables, text);
  p.rules.forEach(function (rule) {
    assert.ok(rule.unsupported && rule.unsupported.length, rule.id + ' ' + JSON.stringify(rule.unsupported));
  });
  assert.strictEqual(claimTypes(r).length, 0, dump(r));
  assert.strictEqual(removalText(p, r), '');
});

test('F1 iptables -D on a populated chain makes that chain ineligible', function () {
  const text = [
    'iptables -A INPUT -s 10.0.0.0/8 -j ACCEPT',
    'iptables -A INPUT -s 10.1.0.0/16 -j ACCEPT',
    'iptables -D INPUT -s 10.0.0.0/8 -j ACCEPT',
    'iptables -A INPUT -s 10.1.0.0/16 -j DROP'
  ].join('\n');
  const { p, r } = run(iptables, text);
  assert.strictEqual(find(r, 'shadowed', 'INPUT#2').length, 0, dump(r));
  assert.ok(!/iptables -D INPUT -s 10.1.0.0\/16 -j ACCEPT/.test(removalText(p, r)), removalText(p, r));
});

test('F3 FortiOS custom service app-service-type is ineligible, no delete', function () {
  const text = [
    'config firewall service custom',
    '    edit "WIDE"',
    '        set tcp-portrange 1-65535',
    '        set app-service-type app-id',
    '        set app-category 15',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "WIDE"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "SSH"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p, r } = run(fortios, text);
  const r1 = ruleById(p, '1');
  assert.ok(r1.unsupported && r1.unsupported.some(function (u) { return u.construct === 'option'; }), JSON.stringify(r1.unsupported));
  const w = p.warnings.filter(function (x) { return x.code === 'unparsed_line'; });
  assert.ok(w.some(function (x) { return /app-service-type/.test((x.params && x.params.text) || ''); }), JSON.stringify(w));
  assert.strictEqual(find(r, 'shadowed', '2').length, 0, dump(r));
  assert.ok(!/delete\s+2/.test(removalText(p, r)), removalText(p, r));
});

test('F2 Junos leaf-level deactivate does not disable the whole policy', function () {
  const text = [
    'set security policies from-zone a to-zone b policy p1 match source-address any',
    'set security policies from-zone a to-zone b policy p1 match destination-address any',
    'set security policies from-zone a to-zone b policy p1 match application junos-http',
    'set security policies from-zone a to-zone b policy p1 match application junos-https',
    'set security policies from-zone a to-zone b policy p1 then permit',
    'set security policies from-zone a to-zone b policy p2 match source-address any',
    'set security policies from-zone a to-zone b policy p2 match destination-address any',
    'set security policies from-zone a to-zone b policy p2 match application junos-ssh',
    'set security policies from-zone a to-zone b policy p2 then permit',
    'deactivate security policies from-zone a to-zone b policy p1 match application junos-https'
  ].join('\n');
  const { p, r } = run(junos, text);
  const p1 = ruleById(p, 'p1');
  const p2 = ruleById(p, 'p2');
  assert.ok(p1 && p2, p.rules.map(function (x) { return x.id; }).join(','));
  assert.ok(!p1.disabled, 'leaf deactivate must not disable p1');
  assert.ok(!p2.disabled);
  assert.ok(p1.unsupported && p1.unsupported.length, JSON.stringify(p1.unsupported));
  assert.strictEqual(claimTypes(r).length, 0, dump(r));
});

test('F2 Junos curly inactive: on a single leaf does not disable the policy', function () {
  const text = [
    'security {',
    '    policies {',
    '        from-zone a to-zone b {',
    '            policy p1 {',
    '                match {',
    '                    source-address any;',
    '                    destination-address any;',
    '                    application junos-http;',
    '                    inactive: application junos-https;',
    '                }',
    '                then {',
    '                    permit;',
    '                }',
    '            }',
    '            policy p2 {',
    '                match {',
    '                    source-address any;',
    '                    destination-address any;',
    '                    application junos-ssh;',
    '                }',
    '                then {',
    '                    permit;',
    '                }',
    '            }',
    '        }',
    '    }',
    '}'
  ].join('\n');
  const { p } = run(junos, text);
  const p1 = ruleById(p, 'p1');
  const p2 = ruleById(p, 'p2');
  assert.ok(p1 && p2, p.rules.map(function (x) { return x.id; }).join(','));
  assert.ok(!p1.disabled, 'inactive leaf must not disable p1');
  assert.ok(!p2.disabled);
  assert.ok(p1.unsupported && p1.unsupported.length, JSON.stringify(p1.unsupported));
});

test('NIT FortiOS empty custom service does not merge', function () {
  const text = [
    'config firewall service custom',
    '    edit "EMPTY"',
    '        set protocol TCP/UDP/SCTP',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "EMPTY"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "SSH"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { r } = run(fortios, text);
  assert.strictEqual(find(r, 'merge', '2').length, 0, dump(r));
  assert.strictEqual(find(r, 'shadowed', '2').length, 0, dump(r));
});

test('FortiOS multi-value tcp-portrange 80 443 is not truncated to HTTP', function () {
  const text = [
    'config firewall service custom',
    '    edit "WEB"',
    '        set tcp-portrange 80 443',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "HTTP"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "WEB"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p, r } = run(fortios, text);
  const r2 = ruleById(p, '2');
  assert.ok(r2, 'policy 2');
  const web = p.objects.svc.WEB;
  assert.ok(web && !web._option, JSON.stringify(web));
  const dports = (r2.svc || []).reduce(function (acc, at) {
    return acc.concat(at.dport || []);
  }, []);
  assert.ok(IR.containsIntervals(dports, [[80, 80]]), JSON.stringify(r2.svc));
  assert.ok(IR.containsIntervals(dports, [[443, 443]]), JSON.stringify(r2.svc));
  assert.strictEqual(find(r, 'duplicate', '2').length, 0, dump(r));
  assert.strictEqual(find(r, 'shadowed', '2').length, 0, dump(r));
  assert.strictEqual(removalText(p, r), '');
});

test('FortiOS non-numeric tcp-portrange part marks service _option', function () {
  const text = [
    'config firewall service custom',
    '    edit "MIXED"',
    '        set tcp-portrange 80 http',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "MIXED"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    '    edit 2',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set service "HTTP"',
    '        set action accept',
    '        set schedule "always"',
    '    next',
    'end'
  ].join('\n');
  const { p, r } = run(fortios, text);
  const svc = p.objects.svc.MIXED;
  assert.ok(svc && svc._option, JSON.stringify(svc));
  const r1 = ruleById(p, '1');
  assert.ok(r1.unsupported && r1.unsupported.some(function (u) { return u.construct === 'option'; }), JSON.stringify(r1.unsupported));
  const w = p.warnings.filter(function (x) { return x.code === 'unparsed_line'; });
  assert.ok(w.some(function (x) { return /tcp-portrange/.test((x.params && x.params.text) || '') && /http/.test((x.params && x.params.text) || ''); }), JSON.stringify(w));
  assert.strictEqual(claimTypes(r).length, 0, dump(r));
  assert.strictEqual(removalText(p, r), '');
});

console.log(passed + ' passed');
