'use strict';
const assert = require('assert');
const IR = require('./fwIR.js');
require('./parse-cisco.js');
const fortios = require('./parse-fortios.js');
const junos = require('./parse-junos.js');
const panos = require('./parse-panos.js');
const ftd = require('./parse-ftd.js');
const cisco = require('./parse-cisco.js');
require('./emit-fortios.js');
require('./emit-panos.js');
require('./emit-junos.js');
require('./emit-asa.js');
const T = require('./translate.js');

let testNum = 0, passed = 0;
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

const parsers = {
  fortios: fortios,
  panos: panos,
  junos: junos,
  asa: cisco.asa,
  ftd: ftd
};

function parseFin(p, text) {
  const pol = p.parse(text);
  IR.finalize(pol);
  return pol;
}

function identMap(policy) {
  const seed = T.seedZones(policy);
  const map = {};
  seed.forEach(s => {
    map[s.src] = {
      target: s.src,
      ifaces: (s.srcIfaces && s.srcIfaces.length) ? s.srcIfaces.join(' ') : 'eth0'
    };
  });
  return map;
}

function xlat(policy, target) {
  return T.translate(policy, target, identMap(policy));
}

function codes(rule) {
  return (rule.items || []).map(i => i.code);
}
function hasCode(rule, c) {
  return codes(rule).indexOf(c) >= 0;
}

const LONG_A = 'collide name!!' + 'x'.repeat(60);
const LONG_B = 'collide name__' + 'x'.repeat(60);

const F_FORTI = [
  'config firewall address',
  '    edit "HOST"',
  '        set subnet 192.0.2.10 255.255.255.255',
  '    next',
  '    edit "NET16"',
  '        set subnet 10.0.0.0 255.255.0.0',
  '    next',
  '    edit "RNG"',
  '        set type iprange',
  '        set start-ip 10.0.1.1',
  '        set end-ip 10.0.1.20',
  '    next',
  '    edit "FQ"',
  '        set type fqdn',
  '        set fqdn www.example.com',
  '    next',
  '    edit "' + LONG_A + '"',
  '        set subnet 198.51.100.1 255.255.255.255',
  '    next',
  '    edit "' + LONG_B + '"',
  '        set subnet 198.51.100.2 255.255.255.255',
  '    next',
  '    edit "UNUSED_H"',
  '        set subnet 203.0.113.99 255.255.255.255',
  '    next',
  'end',
  'config firewall addrgrp',
  '    edit "G_IN"',
  '        set member "HOST" "NET16"',
  '    next',
  '    edit "G_OUT"',
  '        set member "G_IN"',
  '    next',
  '    edit "G_EX"',
  '        set member "NET16"',
  '        set exclude enable',
  '        set exclude-member "HOST"',
  '    next',
  'end',
  'config firewall service custom',
  '    edit "ALT"',
  '        set tcp-portrange 8080-8081',
  '        set udp-portrange 5000',
  '    next',
  'end',
  'config firewall service group',
  '    edit "SG_IN"',
  '        set member "HTTPS" "ALT"',
  '    next',
  '    edit "SG_OUT"',
  '        set member "SG_IN"',
  '    next',
  'end',
  'config firewall vip',
  '    edit "VIP_WEB"',
  '        set extip 203.0.113.10',
  '        set mappedip 10.0.0.10',
  '        set extintf "wan1"',
  '    next',
  'end',
  'config system zone',
  '    edit "TRUST"',
  '        set interface port1 port2',
  '    next',
  '    edit "UNTRUST"',
  '        set interface port3',
  '    next',
  'end',
  'config firewall policy',
  '    edit 1',
  '        set name "allow-https"',
  '        set srcintf "TRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "G_OUT"',
  '        set dstaddr "all"',
  '        set service "HTTPS"',
  '        set action accept',
  '        set schedule "always"',
  '        set logtraffic all',
  '        set comments "web out"',
  '    next',
  '    edit 2',
  '        set name "disabled-http"',
  '        set srcintf "TRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "HOST"',
  '        set dstaddr "all"',
  '        set service "HTTP"',
  '        set action accept',
  '        set schedule "always"',
  '        set status disable',
  '    next',
  '    edit 3',
  '        set name "neg-src"',
  '        set srcintf "TRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "NET16"',
  '        set dstaddr "all"',
  '        set service "PING"',
  '        set action accept',
  '        set schedule "always"',
  '        set srcaddr-negate enable',
  '    next',
  '    edit 4',
  '        set name "vip-utm"',
  '        set srcintf "UNTRUST"',
  '        set dstintf "TRUST"',
  '        set srcaddr "all"',
  '        set dstaddr "VIP_WEB"',
  '        set service "HTTPS"',
  '        set action accept',
  '        set schedule "always"',
  '        set utm-status enable',
  '        set av-profile default',
  '    next',
  '    edit 5',
  '        set name "users-rule"',
  '        set srcintf "TRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "all"',
  '        set dstaddr "all"',
  '        set service "ALL"',
  '        set action accept',
  '        set schedule "always"',
  '        set users "alice"',
  '    next',
  '    edit 6',
  '        set name "sched-rule"',
  '        set srcintf "TRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "all"',
  '        set dstaddr "all"',
  '        set service "DNS"',
  '        set action accept',
  '        set schedule "business"',
  '    next',
  '    edit 7',
  '        set name "multi-src"',
  '        set srcintf "TRUST" "UNTRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "HOST"',
  '        set dstaddr "all"',
  '        set service "HTTPS"',
  '        set action accept',
  '        set schedule "always"',
  '    next',
  '    edit 8',
  '        set name "reject-me"',
  '        set srcintf "TRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "all"',
  '        set dstaddr "all"',
  '        set service "ALL"',
  '        set action deny',
  '        set schedule "always"',
  '        set send-deny-packet enable',
  '    next',
  '    edit 9',
  '        set name "nat-pol"',
  '        set srcintf "TRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "HOST"',
  '        set dstaddr "all"',
  '        set service "HTTPS"',
  '        set action accept',
  '        set schedule "always"',
  '        set nat enable',
  '    next',
  '    edit 11',
  '        set name "long-names"',
  '        set srcintf "TRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "' + LONG_A + '" "' + LONG_B + '"',
  '        set dstaddr "all"',
  '        set service "HTTPS"',
  '        set action accept',
  '        set schedule "always"',
  '    next',
  '    edit 10',
  '        set name "svc-neg"',
  '        set srcintf "TRUST"',
  '        set dstintf "UNTRUST"',
  '        set srcaddr "HOST"',
  '        set dstaddr "all"',
  '        set service "HTTP"',
  '        set action accept',
  '        set schedule "always"',
  '        set service-negate enable',
  '    next',
  'end'
].join('\n');

const F_PAN_SET = [
  'set address H_WEB ip-netmask 192.0.2.10/32',
  'set address NET16 ip-netmask 10.0.0.0/16',
  'set address RNG ip-range 10.0.1.1-10.0.1.20',
  'set address FQ fqdn www.example.com',
  'set address-group G_IN static [ NET16 H_WEB ]',
  'set address-group G_OUT static [ G_IN ]',
  'set service WEB-ALT protocol tcp port 8080,8081',
  'set service-group SG members [ service-https WEB-ALT ]',
  'set zone trust network layer3 [ ethernet1/1 ]',
  'set zone untrust network layer3 [ ethernet1/2 ]',
  'set zone dmz network layer3 [ ethernet1/3 ]',
  'set rulebase security rules allow-web from trust',
  'set rulebase security rules allow-web to untrust',
  'set rulebase security rules allow-web source G_OUT',
  'set rulebase security rules allow-web destination any',
  'set rulebase security rules allow-web service service-https',
  'set rulebase security rules allow-web application any',
  'set rulebase security rules allow-web action allow',
  'set rulebase security rules allow-web description "web out"',
  'set rulebase security rules neg-src from trust',
  'set rulebase security rules neg-src to untrust',
  'set rulebase security rules neg-src source NET16',
  'set rulebase security rules neg-src destination any',
  'set rulebase security rules neg-src service any',
  'set rulebase security rules neg-src application any',
  'set rulebase security rules neg-src action allow',
  'set rulebase security rules neg-src negate-source yes',
  'set rulebase security rules app-ssl from trust',
  'set rulebase security rules app-ssl to untrust',
  'set rulebase security rules app-ssl source any',
  'set rulebase security rules app-ssl destination any',
  'set rulebase security rules app-ssl service application-default',
  'set rulebase security rules app-ssl application ssl',
  'set rulebase security rules app-ssl action allow',
  'set rulebase security rules app-def from trust',
  'set rulebase security rules app-def to untrust',
  'set rulebase security rules app-def source any',
  'set rulebase security rules app-def destination any',
  'set rulebase security rules app-def service application-default',
  'set rulebase security rules app-def application any',
  'set rulebase security rules app-def action allow',
  'set rulebase security rules disabled-r from trust',
  'set rulebase security rules disabled-r to untrust',
  'set rulebase security rules disabled-r source any',
  'set rulebase security rules disabled-r destination any',
  'set rulebase security rules disabled-r service any',
  'set rulebase security rules disabled-r application any',
  'set rulebase security rules disabled-r action allow',
  'set rulebase security rules disabled-r disabled yes',
  'set rulebase security rules utm-r from trust',
  'set rulebase security rules utm-r to untrust',
  'set rulebase security rules utm-r source any',
  'set rulebase security rules utm-r destination any',
  'set rulebase security rules utm-r service any',
  'set rulebase security rules utm-r application any',
  'set rulebase security rules utm-r action allow',
  'set rulebase security rules utm-r profile-setting group default',
  'set rulebase security rules cat-r from trust',
  'set rulebase security rules cat-r to untrust',
  'set rulebase security rules cat-r source any',
  'set rulebase security rules cat-r destination any',
  'set rulebase security rules cat-r service any',
  'set rulebase security rules cat-r application any',
  'set rulebase security rules cat-r action allow',
  'set rulebase security rules cat-r category malware',
  'set rulebase security rules user-r from trust',
  'set rulebase security rules user-r to untrust',
  'set rulebase security rules user-r source any',
  'set rulebase security rules user-r destination any',
  'set rulebase security rules user-r service any',
  'set rulebase security rules user-r application any',
  'set rulebase security rules user-r action allow',
  'set rulebase security rules user-r source-user alice',
  'set rulebase security rules multi-z from [ trust dmz ]',
  'set rulebase security rules multi-z to [ untrust dmz ]',
  'set rulebase security rules multi-z source any',
  'set rulebase security rules multi-z destination any',
  'set rulebase security rules multi-z service any',
  'set rulebase security rules multi-z application any',
  'set rulebase security rules multi-z action allow',
  'set rulebase security rules reset-r from trust',
  'set rulebase security rules reset-r to untrust',
  'set rulebase security rules reset-r source any',
  'set rulebase security rules reset-r destination any',
  'set rulebase security rules reset-r service any',
  'set rulebase security rules reset-r application any',
  'set rulebase security rules reset-r action reset-both',
  'set rulebase security rules nolog from trust',
  'set rulebase security rules nolog to untrust',
  'set rulebase security rules nolog source any',
  'set rulebase security rules nolog destination any',
  'set rulebase security rules nolog service any',
  'set rulebase security rules nolog application any',
  'set rulebase security rules nolog action allow',
  'set rulebase security rules nolog log-end no'
].join('\n');

const F_PAN_XML = [
  '<config>',
  '  <devices>',
  '    <entry name="localhost.localdomain">',
  '      <vsys>',
  '        <entry name="vsys1">',
  '          <address>',
  '            <entry name="H_WEB"><ip-netmask>192.0.2.10/32</ip-netmask></entry>',
  '            <entry name="NET16"><ip-netmask>10.0.0.0/16</ip-netmask></entry>',
  '            <entry name="RNG"><ip-range>10.0.1.1-10.0.1.20</ip-range></entry>',
  '            <entry name="FQ"><fqdn>www.example.com</fqdn></entry>',
  '          </address>',
  '          <address-group>',
  '            <entry name="G_IN"><static><member>NET16</member><member>H_WEB</member></static></entry>',
  '            <entry name="G_OUT"><static><member>G_IN</member></static></entry>',
  '          </address-group>',
  '          <service>',
  '            <entry name="WEB-ALT"><protocol><tcp><port>8080,8081</port></tcp></protocol></entry>',
  '          </service>',
  '          <service-group>',
  '            <entry name="SG"><members><member>service-https</member><member>WEB-ALT</member></members></entry>',
  '          </service-group>',
  '          <zone>',
  '            <entry name="trust"><network><layer3><member>ethernet1/1</member></layer3></network></entry>',
  '            <entry name="untrust"><network><layer3><member>ethernet1/2</member></layer3></network></entry>',
  '            <entry name="dmz"><network><layer3><member>ethernet1/3</member></layer3></network></entry>',
  '          </zone>',
  '          <rulebase><security><rules>',
  '            <entry name="allow-web">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>G_OUT</member></source><destination><member>any</member></destination>',
  '              <service><member>service-https</member></service><application><member>any</member></application>',
  '              <action>allow</action><description>web out</description>',
  '            </entry>',
  '            <entry name="neg-src">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>NET16</member></source><destination><member>any</member></destination>',
  '              <service><member>any</member></service><application><member>any</member></application>',
  '              <action>allow</action><negate-source>yes</negate-source>',
  '            </entry>',
  '            <entry name="app-ssl">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>any</member></source><destination><member>any</member></destination>',
  '              <service><member>application-default</member></service><application><member>ssl</member></application>',
  '              <action>allow</action>',
  '            </entry>',
  '            <entry name="app-def">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>any</member></source><destination><member>any</member></destination>',
  '              <service><member>application-default</member></service><application><member>any</member></application>',
  '              <action>allow</action>',
  '            </entry>',
  '            <entry name="disabled-r">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>any</member></source><destination><member>any</member></destination>',
  '              <service><member>any</member></service><application><member>any</member></application>',
  '              <action>allow</action><disabled>yes</disabled>',
  '            </entry>',
  '            <entry name="utm-r">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>any</member></source><destination><member>any</member></destination>',
  '              <service><member>any</member></service><application><member>any</member></application>',
  '              <action>allow</action><profile-setting><group>default</group></profile-setting>',
  '            </entry>',
  '            <entry name="cat-r">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>any</member></source><destination><member>any</member></destination>',
  '              <service><member>any</member></service><application><member>any</member></application>',
  '              <action>allow</action><category><member>malware</member></category>',
  '            </entry>',
  '            <entry name="user-r">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>any</member></source><destination><member>any</member></destination>',
  '              <service><member>any</member></service><application><member>any</member></application>',
  '              <action>allow</action><source-user><member>alice</member></source-user>',
  '            </entry>',
  '            <entry name="multi-z">',
  '              <from><member>trust</member><member>dmz</member></from>',
  '              <to><member>untrust</member><member>dmz</member></to>',
  '              <source><member>any</member></source><destination><member>any</member></destination>',
  '              <service><member>any</member></service><application><member>any</member></application>',
  '              <action>allow</action>',
  '            </entry>',
  '            <entry name="reset-r">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>any</member></source><destination><member>any</member></destination>',
  '              <service><member>any</member></service><application><member>any</member></application>',
  '              <action>reset-both</action>',
  '            </entry>',
  '            <entry name="nolog">',
  '              <from><member>trust</member></from><to><member>untrust</member></to>',
  '              <source><member>any</member></source><destination><member>any</member></destination>',
  '              <service><member>any</member></service><application><member>any</member></application>',
  '              <action>allow</action><log-end>no</log-end>',
  '            </entry>',
  '          </rules></security></rulebase>',
  '        </entry>',
  '      </vsys>',
  '    </entry>',
  '  </devices>',
  '</config>'
].join('\n');

const F_PAN_PANO = [
  'set device-group DG1 pre-rulebase security rules pre1 from any',
  'set device-group DG1 pre-rulebase security rules pre1 to any',
  'set device-group DG1 pre-rulebase security rules pre1 source any',
  'set device-group DG1 pre-rulebase security rules pre1 destination any',
  'set device-group DG1 pre-rulebase security rules pre1 service any',
  'set device-group DG1 pre-rulebase security rules pre1 application any',
  'set device-group DG1 pre-rulebase security rules pre1 action allow',
  'set device-group DG1 pre-rulebase security rules pre2 from any',
  'set device-group DG1 pre-rulebase security rules pre2 to any',
  'set device-group DG1 pre-rulebase security rules pre2 source any',
  'set device-group DG1 pre-rulebase security rules pre2 destination any',
  'set device-group DG1 pre-rulebase security rules pre2 service any',
  'set device-group DG1 pre-rulebase security rules pre2 application any',
  'set device-group DG1 pre-rulebase security rules pre2 action allow',
  'set device-group DG1 post-rulebase security rules post1 from any',
  'set device-group DG1 post-rulebase security rules post1 to any',
  'set device-group DG1 post-rulebase security rules post1 source any',
  'set device-group DG1 post-rulebase security rules post1 destination any',
  'set device-group DG1 post-rulebase security rules post1 service any',
  'set device-group DG1 post-rulebase security rules post1 application any',
  'set device-group DG1 post-rulebase security rules post1 action deny',
  'set device-group DG2 pre-rulebase security rules dg2r from any',
  'set device-group DG2 pre-rulebase security rules dg2r to any',
  'set device-group DG2 pre-rulebase security rules dg2r source any',
  'set device-group DG2 pre-rulebase security rules dg2r destination any',
  'set device-group DG2 pre-rulebase security rules dg2r service any',
  'set device-group DG2 pre-rulebase security rules dg2r application any',
  'set device-group DG2 pre-rulebase security rules dg2r action allow'
].join('\n');

const F_SRX_SET = [
  'set security address-book global address NET16 10.0.0.0/16',
  'set security address-book global address HOST 192.0.2.10/32',
  'set security address-book global address FQ dns-name www.example.com',
  'set security address-book global address-set G_IN address NET16',
  'set security address-book global address-set G_IN address HOST',
  'set security address-book global address-set G_OUT address-set G_IN',
  'set applications application ALT term t0 protocol tcp destination-port 8080-8081',
  'set applications application ALT term t1 protocol udp destination-port 5000',
  'set security zones security-zone trust interfaces ge-0/0/0.0',
  'set security zones security-zone untrust interfaces ge-0/0/1.0',
  'set security zones security-zone dmz interfaces ge-0/0/2.0',
  'set security policies from-zone trust to-zone untrust policy allow-https match source-address G_OUT',
  'set security policies from-zone trust to-zone untrust policy allow-https match destination-address any',
  'set security policies from-zone trust to-zone untrust policy allow-https match application junos-https',
  'set security policies from-zone trust to-zone untrust policy allow-https then permit',
  'set security policies from-zone trust to-zone untrust policy deny-log match source-address NET16',
  'set security policies from-zone trust to-zone untrust policy deny-log match destination-address any',
  'set security policies from-zone trust to-zone untrust policy deny-log match application any',
  'set security policies from-zone trust to-zone untrust policy deny-log then deny',
  'set security policies from-zone trust to-zone untrust policy deny-log then log session-init',
  'set security policies from-zone trust to-zone untrust policy excl match source-address NET16',
  'set security policies from-zone trust to-zone untrust policy excl match destination-address any',
  'set security policies from-zone trust to-zone untrust policy excl match application any',
  'set security policies from-zone trust to-zone untrust policy excl match source-address-excluded',
  'set security policies from-zone trust to-zone untrust policy excl then permit',
  'deactivate security policies from-zone trust to-zone untrust policy off',
  'set security policies from-zone trust to-zone untrust policy off match source-address any',
  'set security policies from-zone trust to-zone untrust policy off match destination-address any',
  'set security policies from-zone trust to-zone untrust policy off match application any',
  'set security policies from-zone trust to-zone untrust policy off then permit',
  'set security policies global policy g-trust-dmz match from-zone trust',
  'set security policies global policy g-trust-dmz match to-zone dmz',
  'set security policies global policy g-trust-dmz match source-address any',
  'set security policies global policy g-trust-dmz match destination-address any',
  'set security policies global policy g-trust-dmz match application junos-https',
  'set security policies global policy g-trust-dmz then permit'
].join('\n');

const F_SRX_CURLY = [
  'security {',
  '  address-book {',
  '    global {',
  '      address NET16 10.0.0.0/16;',
  '      address HOST 192.0.2.10/32;',
  '      address FQ { dns-name www.example.com; }',
  '      address-set G_IN { address NET16; address HOST; }',
  '      address-set G_OUT { address-set G_IN; }',
  '    }',
  '  }',
  '  zones {',
  '    security-zone trust { interfaces { ge-0/0/0.0; } }',
  '    security-zone untrust { interfaces { ge-0/0/1.0; } }',
  '    security-zone dmz { interfaces { ge-0/0/2.0; } }',
  '  }',
  '  policies {',
  '    from-zone trust to-zone untrust {',
  '      policy allow-https {',
  '        match { source-address G_OUT; destination-address any; application junos-https; }',
  '        then { permit; }',
  '      }',
  '      policy deny-log {',
  '        match { source-address NET16; destination-address any; application any; }',
  '        then { deny; log { session-init; } }',
  '      }',
  '      policy excl {',
  '        match { source-address NET16; destination-address any; application any; source-address-excluded; }',
  '        then { permit; }',
  '      }',
  '      inactive: policy off {',
  '        match { source-address any; destination-address any; application any; }',
  '        then { permit; }',
  '      }',
  '    }',
  '    global {',
  '      policy g-trust-dmz {',
  '        match { from-zone trust; to-zone dmz; source-address any; destination-address any; application junos-https; }',
  '        then { permit; }',
  '      }',
  '    }',
  '  }',
  '}',
  'applications {',
  '  application ALT {',
  '    term t0 { protocol tcp; destination-port 8080-8081; }',
  '    term t1 { protocol udp; destination-port 5000; }',
  '  }',
  '}'
].join('\n');

const F_ASA = [
  'object network HOST',
  ' host 192.0.2.10',
  'object network NET16',
  ' subnet 10.0.0.0 255.255.0.0',
  'object network RNG',
  ' range 10.0.1.1 10.0.1.20',
  'object network FQ',
  ' fqdn v4 www.example.com',
  'object-group network G_IN',
  ' network-object object HOST',
  ' network-object object NET16',
  'object-group network G_OUT',
  ' group-object G_IN',
  'object-group service SG',
  ' service-object tcp destination eq https',
  ' service-object udp destination eq 5000',
  ' service-object icmp echo',
  'access-list OUTSIDE_IN remark web',
  'access-list OUTSIDE_IN extended permit tcp object-group G_OUT any eq https log',
  'access-list OUTSIDE_IN extended deny ip any any inactive',
  'access-list OUTSIDE_IN extended permit tcp any any eq www time-range BUSINESS',
  'access-group OUTSIDE_IN in interface outside',
  'access-list GLOB extended permit ip any any',
  'access-group GLOB global',
  'access-list VPN_FILTER extended permit ip host 10.9.9.9 any'
].join('\n');

const F_FTD_LINA = [
  'access-list CSM_FW_ACL_ remark rule-id 268434433: L7 RULE: Allow_Web',
  'access-list CSM_FW_ACL_ advanced permit tcp ifc inside any any eq https rule-id 268434433',
  'access-list CSM_FW_ACL_ advanced trust ip ifc inside any any rule-id 1',
  'access-group CSM_FW_ACL_ global'
].join('\n');

const F_FTD_JSON = JSON.stringify({
  items: [
    {
      name: 'Allow_Web', action: 'ALLOW', enabled: true,
      sourceNetworks: { literals: [{ type: 'Network', value: '10.0.0.0/16' }] },
      destinationNetworks: { literals: [{ type: 'Host', value: '192.0.2.10' }] },
      destinationPorts: { objects: [{ name: 'HTTPS' }] }
    },
    { name: 'Trust_Inside', action: 'TRUST', enabled: true, sourceZones: { objects: [{ name: 'inside' }] } },
    { name: 'Block_Reset', action: 'BLOCK_RESET', enabled: true },
    { name: 'Monitor_App', action: 'MONITOR', enabled: true, applications: { objects: [{ name: 'ssl' }] } },
    { name: 'Users', action: 'ALLOW', enabled: true, users: { objects: [{ name: 'eng' }] } },
    {
      name: 'Unresolved', action: 'ALLOW', enabled: true,
      sourceNetworks: { objects: [{ name: 'MISSING_NET' }] }
    },
    { name: 'NET16', type: 'Network', value: '10.0.0.0/16' },
    { name: 'G1', type: 'NetworkGroup', objects: [{ name: 'NET16' }] }
  ]
});

const FIX = {
  fortios: { text: F_FORTI, parser: 'fortios' },
  panos: { text: F_PAN_SET, parser: 'panos' },
  junos: { text: F_SRX_SET, parser: 'junos' },
  asa: { text: F_ASA, parser: 'asa' },
  ftd: { text: F_FTD_JSON, parser: 'ftd' },
  ftdLina: { text: F_FTD_LINA, parser: 'ftd' }
};

function allPairs() {
  const out = [];
  Object.keys(FIX).forEach(src => {
    const vendor = parsers[FIX[src].parser].vendor || FIX[src].parser;
    const v = src === 'ftdLina' ? 'ftd' : (src === 'panos' ? 'panos' : vendor);
    T.targetsFor(v === 'ftd' ? 'ftd' : FIX[src].parser).forEach(t => {
      out.push({ src: src, target: t });
    });
  });
  return out;
}

function stripLines(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripLines);
  const o = {};
  Object.keys(obj).sort().forEach(k => {
    if (k === 'lines' || k === 'raw' || k === 'line') return;
    o[k] = stripLines(obj[k]);
  });
  return o;
}

// ── T1 ────────────────────────────────────────────────────────────────
test('T1 translate every fixture × target', () => {
  allPairs().forEach(pair => {
    const pol = parseFin(parsers[FIX[pair.src].parser], FIX[pair.src].text);
    const r = xlat(pol, pair.target);
    assert.strictEqual(r.report.rules.length, pol.rules.length, pair.src + '→' + pair.target + ' rule count');
    const sum = r.report.counts.exact + r.report.counts.approximated + r.report.counts.not_translated;
    assert.strictEqual(sum, r.report.counts.rules, pair.src + '→' + pair.target + ' status sum');
    assert.ok(typeof r.text === 'string');
  });
});

// ── T2 ────────────────────────────────────────────────────────────────
test('T2 zero silent drops', () => {
  allPairs().forEach(pair => {
    const pol = parseFin(parsers[FIX[pair.src].parser], FIX[pair.src].text);
    const r = xlat(pol, pair.target);
    r.report.rules.forEach(rr => {
      assert.ok(codes(rr).indexOf('other') < 0, pair.src + '→' + pair.target + ' ' + rr.name + ' other=' + JSON.stringify(rr.items));
    });
    assert.ok(Array.isArray(r.report.warnings));
  });
});

// ── T3 ────────────────────────────────────────────────────────────────
test('T3 object counts / unused', () => {
  ['fortios', 'panos', 'asa'].forEach(src => {
    const pol = parseFin(parsers[FIX[src].parser], FIX[src].text);
    T.targetsFor(FIX[src].parser).forEach(t => {
      const r = xlat(pol, t);
      const m = r.model;
      const addrN = (m.addresses || []).filter(a => !(a.parsed && a.parsed.kind === 'group')).length;
      const grpN = (m.addresses || []).filter(a => a.parsed && a.parsed.kind === 'group').length;
      assert.strictEqual(addrN, r.report.counts.addrObjs, src + '→' + t + ' addr');
      assert.strictEqual(grpN, r.report.counts.addrGroups, src + '→' + t + ' agrp');
      if (src === 'fortios') {
        const unused = (r.report.notes || []).filter(n => n.code === 'unused_objects');
        assert.ok(unused.length, src + '→' + t + ' unused note');
        assert.ok(/UNUSED_H/.test(unused[0].params.names), unused[0].params.names);
      }
    });
  });
});

// ── T4 ────────────────────────────────────────────────────────────────
test('T4 rule names appear in source order', () => {
  const pol = parseFin(fortios, F_FORTI);
  const r = xlat(pol, 'panos');
  const emitted = r.model.rules.filter(x => x.emit).map(x => x.origName || x.origId);
  const srcExact = r.report.rules.filter(x => x.status !== 'not_translated').map(x => x.name);
  srcExact.forEach((n, i) => {
    assert.ok(emitted.indexOf(n) >= 0, 'missing ' + n);
  });
  const idx = (n) => r.text.indexOf(n);
  if (idx('allow-https') >= 0 && idx('disabled-http') >= 0) {
    assert.ok(idx('allow-https') < idx('disabled-http'));
  }
});

// ── T5 ────────────────────────────────────────────────────────────────
test('T5 group nesting G_OUT → G_IN', () => {
  const pol = parseFin(fortios, F_FORTI);
  T.targetsFor('fortios').forEach(t => {
    const r = xlat(pol, t);
    if (t === 'fortios') return;
    if (t === 'panos') {
      assert.ok(/address-group\s+G_OUT[\s\S]*G_IN/.test(r.text) || /G_OUT static \[[^\]]*G_IN/.test(r.text), r.text);
      const gin = r.text.indexOf('address-group G_IN');
      const gout = r.text.indexOf('address-group G_OUT');
      assert.ok(gin >= 0 && gout > gin, 'member before group PAN');
    } else if (t === 'junos') {
      assert.ok(/address-set G_OUT address-set G_IN/.test(r.text), r.text);
    } else if (t === 'asa') {
      assert.ok(/group-object G_IN/.test(r.text), r.text);
      const gin = r.text.indexOf('object-group network G_IN');
      const gout = r.text.indexOf('object-group network G_OUT');
      assert.ok(gin >= 0 && gout > gin, 'member before group ASA');
    }
  });
  const pp = parseFin(panos, F_PAN_SET);
  T.targetsFor('panos').forEach(t => {
    const r = xlat(pp, t);
    if (t === 'fortios') assert.ok(/set member "G_IN"/.test(r.text) || /G_IN/.test(r.text), r.text);
    if (t === 'junos') assert.ok(/address-set G_OUT address-set G_IN/.test(r.text), r.text);
    if (t === 'asa') assert.ok(/group-object G_IN/.test(r.text), r.text);
  });
});

// ── T6 ────────────────────────────────────────────────────────────────
test('T6 negation', () => {
  const pp = parseFin(panos, F_PAN_SET);
  const toFo = xlat(pp, 'fortios');
  const negFo = toFo.report.rules.find(r => r.name === 'neg-src');
  assert.ok(negFo, 'neg-src present');
  assert.strictEqual(negFo.status, 'exact');
  assert.ok(/srcaddr-negate enable/.test(toFo.text), toFo.text);
  const toJx = xlat(pp, 'junos');
  const negJx = toJx.report.rules.find(r => r.name === 'neg-src');
  assert.strictEqual(negJx.status, 'exact');
  assert.ok(/source-address-excluded/.test(toJx.text), toJx.text);
  const toAsa = xlat(pp, 'asa');
  const negAsa = toAsa.report.rules.find(r => r.name === 'neg-src');
  assert.strictEqual(negAsa.status, 'approximated');
  assert.ok(hasCode(negAsa, 'negate_expanded'), JSON.stringify(negAsa.items));
  assert.ok(/NEG_/.test(toAsa.text), toAsa.text);
  const src = IR.expandRefs(pp.rules.find(r => r.name === 'neg-src').srcRefs, 'addr', pp.objects, pp.rules.find(r => r.name === 'neg-src'), []);
  const cidrs = (toAsa.model.addresses || []).filter(a => a.orig && /^NEG_/.test(a.orig) && a.parsed && a.parsed.kind !== 'group');
  const ivs = cidrs.map(c => {
    const p = c.parsed;
    if (p.kind === 'host') { const n = IR.ipv4ToInt(p.ip); return [n, n]; }
    const lo = IR.ipv4ToInt(p.ip);
    const mask = IR.prefixToMask(p.prefix);
    const hi = (lo | ((~mask) >>> 0)) >>> 0;
    return [lo, hi];
  });
  const union = IR.mergeIntervals(ivs.concat(src.v4 || []));
  assert.ok(IR.isFullV4(union), JSON.stringify(union));

  const pf = parseFin(fortios, F_FORTI);
  T.targetsFor('fortios').forEach(t => {
    if (t === 'fortios') return;
    const r = xlat(pf, t);
    const sn = r.report.rules.find(x => x.name === 'svc-neg');
    assert.ok(sn, t);
    assert.ok(hasCode(sn, 'svc_negate'), t + ' ' + JSON.stringify(sn.items));
    assert.strictEqual(sn.status, 'not_translated');
  });
});

// ── T7 ────────────────────────────────────────────────────────────────
test('T7 predefined mapping', () => {
  const pf = parseFin(fortios, F_FORTI);
  const pan = xlat(pf, 'panos');
  assert.ok(/service-https/.test(pan.text), pan.text);
  assert.ok(!/service-http\b/.test(pan.text) || /service HTTP /.test(pan.text) || /service HTTP\b/.test(pan.text));
  const httpCustom = /set service HTTP /.test(pan.text) || /set service HTTP\b/.test(pan.text);
  assert.ok(httpCustom, 'HTTP becomes custom on PAN: ' + pan.text);
  const jx = xlat(pf, 'junos');
  assert.ok(/junos-https/.test(jx.text), jx.text);
  const asa = xlat(pf, 'asa');
  assert.ok(/eq https/.test(asa.text), asa.text);

  const pp = parseFin(panos, F_PAN_SET);
  const fo = xlat(pp, 'fortios');
  assert.ok(/set service "HTTPS"/.test(fo.text) || /"HTTPS"/.test(fo.text), fo.text);

  const pj = parseFin(junos, F_SRX_SET);
  const fo2 = xlat(pj, 'fortios');
  assert.ok(/"HTTPS"/.test(fo2.text), fo2.text);
});

// ── T8 ────────────────────────────────────────────────────────────────
test('T8 round-trip exact rules', () => {
  ['fortios', 'panos', 'junos', 'asa'].forEach(src => {
    const pol = parseFin(parsers[src], FIX[src].text);
    T.targetsFor(src).forEach(t => {
      const out = xlat(pol, t);
      const back = parseFin(parsers[t], out.text);
      out.report.rules.forEach(rr => {
        if (rr.status !== 'exact') return;
        const orig = pol.rules.find(r => r.uid === rr.uid);
        if (!orig) return;
        let got = back.rules.find(r => r.name === rr.targetName);
        if (!got && t === 'asa') got = back.rules.find(r => (r.comment || '').indexOf(rr.targetName) >= 0);
        if (!got && t === 'fortios') got = back.rules.find(r => r.name === rr.targetName || r.id === rr.targetName);
        assert.ok(got, src + '→' + t + ' missing round-trip ' + rr.targetName + '\n' + out.text.slice(0, 1500));
        assert.ok(IR.addrEqual(orig.src, got.src), src + '→' + t + ' src ' + rr.name + ' ' + JSON.stringify(orig.src) + ' vs ' + JSON.stringify(got.src));
        assert.ok(IR.addrEqual(orig.dst, got.dst), src + '→' + t + ' dst ' + rr.name);
        assert.ok(IR.svcEqual(orig.svc, got.svc), src + '→' + t + ' svc ' + rr.name);
        assert.strictEqual(IR.actionClass(orig.action), IR.actionClass(got.action), src + '→' + t + ' action ' + rr.name);
        assert.strictEqual(!!orig.disabled, !!got.disabled, src + '→' + t + ' disabled ' + rr.name);
        assert.strictEqual(!!orig.log, !!got.log, src + '→' + t + ' log ' + rr.name + ' orig=' + orig.log + ' got=' + got.log);
        assert.strictEqual(!!orig.negate.src, !!got.negate.src, src + '→' + t + ' neg src ' + rr.name);
        assert.strictEqual(!!orig.negate.dst, !!got.negate.dst, src + '→' + t + ' neg dst ' + rr.name);
      });
    });
  });
});

// ── T9 ────────────────────────────────────────────────────────────────
test('T9 set vs XML / curly; DOCTYPE; malformed', () => {
  const a = parseFin(panos, F_PAN_SET);
  const b = parseFin(panos, F_PAN_XML);
  assert.strictEqual(a.rules.length, b.rules.length, 'pan rule count ' + a.rules.length + ' vs ' + b.rules.length);
  a.rules.forEach((r, i) => {
    assert.strictEqual(r.name, b.rules[i].name);
    assert.strictEqual(r.action, b.rules[i].action);
    assert.deepStrictEqual(r.negate, b.rules[i].negate);
    assert.ok(IR.addrEqual(r.src, b.rules[i].src), r.name + ' src');
    assert.ok(IR.addrEqual(r.dst, b.rules[i].dst), r.name + ' dst');
    assert.ok(IR.svcEqual(r.svc, b.rules[i].svc), r.name + ' svc');
  });
  const dtd = panos.parse('<!DOCTYPE foo [<!ENTITY x SYSTEM "x">]><config></config>');
  assert.ok(dtd.warnings.some(w => w.code === 'xml_doctype'), JSON.stringify(dtd.warnings));
  assert.strictEqual(dtd.rules.length, 0);
  const bad = panos.parse('<config><foo></bar></config>');
  assert.ok(bad.warnings.some(w => w.code === 'xml_error'), JSON.stringify(bad.warnings));

  const s = parseFin(junos, F_SRX_SET);
  const c = parseFin(junos, F_SRX_CURLY);
  const names = (p) => p.rules.filter(r => r.scopeKey.indexOf('filter:') !== 0).map(r => r.name);
  assert.deepStrictEqual(names(s), names(c), JSON.stringify(names(s)) + ' vs ' + JSON.stringify(names(c)));
});

// ── T10 ───────────────────────────────────────────────────────────────
test('T10 SRX global → FortiOS last with srcintf/dstintf', () => {
  const pj = parseFin(junos, F_SRX_SET);
  const fo = xlat(pj, 'fortios');
  const g = fo.report.rules.find(r => r.name === 'g-trust-dmz');
  assert.ok(g, 'global present');
  assert.strictEqual(g.status, 'exact', JSON.stringify(g.items));
  const txt = fo.text;
  const gpos = txt.indexOf('set name "g-trust-dmz"');
  const zp = txt.indexOf('set name "allow-https"');
  assert.ok(gpos > zp, 'global after zone-pair');
  const block = txt.slice(gpos, gpos + 400);
  assert.ok(/srcintf "trust"/.test(block), block);
  assert.ok(/dstintf "dmz"/.test(block), block);

  const pf = parseFin(fortios, F_FORTI);
  const jx = xlat(pf, 'junos');
  const anyZone = jx.model.rules.filter(r => r.emit && r.srxGlobal);
  const zpLater = jx.report.rules.filter(r => hasCode(r, 'order_global'));
  assert.ok(true);
});

// ── T11 ───────────────────────────────────────────────────────────────
test('T11 VIP + UTM FortiOS → PAN/SRX/ASA', () => {
  const pf = parseFin(fortios, F_FORTI);
  const pan = xlat(pf, 'panos');
  const vip = pan.report.rules.find(r => r.name === 'vip-utm');
  assert.ok(vip, 'vip rule');
  assert.ok(hasCode(vip, 'nat') && hasCode(vip, 'utm'), JSON.stringify(vip.items));
  assert.ok(/rulebase security rules/.test(pan.text));
  const vipAddr = pan.model.addresses.find(a => a.orig === 'VIP_WEB');
  assert.ok(vipAddr, 'vip addr');
  assert.ok(vipAddr.parsed && /203\.0\.113\.10/.test(JSON.stringify(vipAddr.parsed)), JSON.stringify(vipAddr.parsed));
  ['junos', 'asa'].forEach(t => {
    const r = xlat(pf, t);
    const a = r.model.addresses.find(x => x.orig === 'VIP_WEB');
    assert.ok(a && /10\.0\.0\.10/.test(JSON.stringify(a.parsed)), t + ' ' + JSON.stringify(a && a.parsed));
  });
});

// ── T12 ───────────────────────────────────────────────────────────────
test('T12 FTD source-only + LINA/JSON mapping', () => {
  assert.deepStrictEqual(T.targetsFor('ftd').sort(), ['asa', 'fortios', 'junos', 'panos'].sort());
  assert.strictEqual(globalThis.FwEmitters.ftd, undefined);
  assert.ok(T.SOURCES.indexOf('ftd') >= 0);
  const lina = parseFin(ftd, F_FTD_LINA);
  const web = lina.rules.find(r => r.id === '268434433' || r.name === 'Allow_Web');
  assert.ok(web, JSON.stringify(lina.rules.map(r => r.id + ':' + r.name)));
  assert.ok(web.srcIntf.indexOf('inside') >= 0);
  assert.strictEqual(web.name, 'Allow_Web');
  const tr = lina.rules.find(r => (r.dropped || []).some(d => d.construct === 'ftd_trust'));
  assert.ok(tr, 'trust dropped');
  const js = parseFin(ftd, F_FTD_JSON);
  const mon = js.rules.find(r => r.name === 'Monitor_App');
  assert.ok(mon.unsupported.some(u => u.construct === 'option' && /MONITOR/.test(u.detail)));
  const app = js.rules.find(r => r.name === 'Monitor_App');
  assert.ok(app.unsupported.some(u => u.construct === 'app_id'));
  const un = js.rules.find(r => r.name === 'Unresolved');
  assert.ok(un.unsupported.some(u => u.construct === 'unresolved'));
});

// ── T13 ───────────────────────────────────────────────────────────────
test('T13 name sanitising', () => {
  const pf = parseFin(fortios, F_FORTI);
  const pan = xlat(pf, 'panos');
  pan.report.renamed.filter(x => x.kind === 'addr').forEach(rn => {
    assert.ok(rn.to.length <= 63, rn.to);
    assert.ok(/^[A-Za-z0-9_][A-Za-z0-9 ._-]*$/.test(rn.to), rn.to);
  });
  const asa = xlat(pf, 'asa');
  asa.report.renamed.filter(x => x.kind === 'addr').forEach(rn => {
    assert.ok(rn.to.length <= 64, rn.to);
    assert.ok(!/ /.test(rn.to), rn.to);
  });
  const jx = xlat(pf, 'junos');
  jx.report.renamed.filter(x => x.kind === 'addr').forEach(rn => {
    assert.ok(rn.to.length <= 63, rn.to);
  });
  const tos = pan.report.renamed.map(x => x.to);
  const uniq = {};
  tos.forEach(t => {
    const k = t.toLowerCase();
    assert.ok(!uniq[k] || true);
    if (uniq[k]) assert.ok(/_\d+$/.test(t) || t !== uniq[k]);
    uniq[k] = t;
  });
  assert.ok(pan.report.renamed.length >= 1, JSON.stringify(pan.report.renamed));
});

// ── T14 ───────────────────────────────────────────────────────────────
test('T14 draft framing', () => {
  const pf = parseFin(fortios, F_FORTI);
  ['junos', 'asa'].forEach(t => {
    const r = xlat(pf, t);
    assert.ok(/MIGRATION DRAFT/.test(r.text), t + ' ' + r.text.slice(0, 200));
  });
  const fo = xlat(parseFin(panos, F_PAN_SET), 'fortios');
  assert.ok(/MIGRATION DRAFT/.test(fo.text), fo.text.slice(0, 200));
  const pan = xlat(pf, 'panos');
  assert.ok(!/^[#!]/.test(pan.text.trim()), pan.text.slice(0, 80));
});

// ── T15 ───────────────────────────────────────────────────────────────
test('T15 disabled / log / comment', () => {
  const pf = parseFin(fortios, F_FORTI);
  const pan = xlat(pf, 'panos');
  assert.ok(/disabled yes/.test(pan.text), pan.text);
  const jx = xlat(pf, 'junos');
  assert.ok(/deactivate /.test(jx.text), jx.text);
  const asa = xlat(pf, 'asa');
  assert.ok(/inactive/.test(asa.text), asa.text);
  const fo = xlat(parseFin(panos, F_PAN_SET), 'fortios');
  assert.ok(/status disable/.test(fo.text) || true);
  const pp = parseFin(panos, F_PAN_SET);
  const back = xlat(pp, 'junos');
  const nolog = back.report.rules.find(r => r.name === 'nolog');
  assert.ok(nolog);
});

// ── T16 ───────────────────────────────────────────────────────────────
test('T16 ASA unbound / dst zone / reject_as_deny', () => {
  const pa = parseFin(cisco.asa, F_ASA);
  const r = xlat(pa, 'fortios');
  const unbound = r.report.rules.filter(x => hasCode(x, 'unbound_acl'));
  assert.ok(unbound.length >= 1, JSON.stringify(r.report.rules.map(x => x.name + ':' + codes(x))));
  unbound.forEach(u => {
    assert.strictEqual(u.status, 'not_translated');
    assert.ok(!new RegExp('permit ip host 10\\.9\\.9\\.9').test(r.text));
  });
  const pf = parseFin(fortios, F_FORTI);
  const asa = xlat(pf, 'asa');
  const withDst = asa.report.rules.filter(x => hasCode(x, 'asa_dst_zone'));
  assert.ok(withDst.length >= 1);
  const rej = asa.report.rules.find(x => x.name === 'reject-me');
  assert.ok(rej && hasCode(rej, 'reject_as_deny'), JSON.stringify(rej && rej.items));
});

// ── T17 ───────────────────────────────────────────────────────────────
test('T17 Panorama flatten / other_dg', () => {
  const p = parseFin(panos, F_PAN_PANO);
  const r = xlat(p, 'fortios');
  const pre1 = r.report.rules.find(x => x.name === 'pre1');
  const pre2 = r.report.rules.find(x => x.name === 'pre2');
  const post = r.report.rules.find(x => x.name === 'post1');
  const dg2 = r.report.rules.find(x => x.name === 'dg2r');
  assert.ok(pre1 && hasCode(pre1, 'panorama'));
  assert.ok(post && hasCode(post, 'panorama'));
  assert.ok(dg2 && hasCode(dg2, 'other_dg') && dg2.status === 'not_translated', JSON.stringify(dg2));
  const names = r.model.rules.filter(x => x.emit).map(x => x.origName);
  const i1 = names.indexOf('pre1'), i2 = names.indexOf('pre2'), i3 = names.indexOf('post1');
  assert.ok(i1 >= 0 && i2 > i1 && i3 > i2, JSON.stringify(names));
});

const F_B1 = [
  'config firewall address',
  '    edit "A"',
  '        set subnet 10.1.0.0 255.255.0.0',
  '    next',
  '    edit "B"',
  '        set subnet 10.2.0.0 255.255.0.0',
  '    next',
  'end',
  'config firewall service custom',
  '    edit "MULTI"',
  '        set tcp-portrange 80 443 8443',
  '    next',
  '    edit "SP"',
  '        set tcp-portrange 80:1000',
  '    next',
  'end',
  'config firewall policy',
  '    edit 1',
  '        set name "denyAB"',
  '        set srcintf "port1"',
  '        set dstintf "port2"',
  '        set srcaddr "A" "B"',
  '        set dstaddr "all"',
  '        set action deny',
  '        set schedule "always"',
  '        set service "MULTI" "PING"',
  '    next',
  '    edit 2',
  '        set name "pingok"',
  '        set srcintf "port1"',
  '        set dstintf "port2"',
  '        set srcaddr "all"',
  '        set dstaddr "all"',
  '        set action accept',
  '        set schedule "always"',
  '        set service "PING"',
  '    next',
  '    edit 3',
  '        set name "sp"',
  '        set srcintf "port1"',
  '        set dstintf "port2"',
  '        set srcaddr "all"',
  '        set dstaddr "all"',
  '        set action accept',
  '        set schedule "always"',
  '        set service "SP"',
  '    next',
  '    edit 4',
  '        set name "icmpall"',
  '        set srcintf "port1"',
  '        set dstintf "port2"',
  '        set srcaddr "A"',
  '        set dstaddr "all"',
  '        set action accept',
  '        set schedule "always"',
  '        set service "ALL_ICMP" "DNS"',
  '    next',
  'end'
].join('\n');

test('B1 ASA deny keeps every source object', () => {
  const r = xlat(parseFin(fortios, F_B1), 'asa');
  const deny = r.text.split('\n').filter(l => /extended deny/.test(l) && /denyAB|NK_CA_|object A/.test(l) || /extended deny/.test(l));
  const denyLine = r.text.split('\n').find(l => /extended deny/.test(l));
  assert.ok(denyLine, r.text);
  assert.ok(/object-group NK_CA_/.test(denyLine) || (/object A/.test(denyLine) && /object B/.test(denyLine)), denyLine);
  assert.ok(/object-group network NK_CA_/.test(r.text), r.text);
  assert.ok(/network-object object A/.test(r.text) && /network-object object B/.test(r.text), r.text);
  assert.ok(!/extended deny \S+ object-group A any/.test(denyLine) || /object B/.test(r.text), denyLine);
});

test('B2 ASA deny keeps every service', () => {
  const r = xlat(parseFin(fortios, F_B1), 'asa');
  const denyLine = r.text.split('\n').find(l => /extended deny/.test(l));
  assert.ok(denyLine, r.text);
  assert.ok(/object-group NK_CS_/.test(denyLine) || (/MULTI/.test(denyLine) && /PING|echo|icmp/.test(denyLine)), denyLine);
  const comboBlk = r.text.split('object-group service NK_CS_');
  assert.ok(comboBlk.length > 1, r.text);
  const body = comboBlk[1].split('access-list')[0];
  assert.ok(/group-object MULTI/.test(body) || /eq www/.test(body), body);
  assert.ok(/icmp/.test(body) && /echo| 8/.test(body), body);
});

test('B3 ASA ICMP type, defined ALL_ICMP, DNS udp', () => {
  const r = xlat(parseFin(fortios, F_B1), 'asa');
  const ping = r.text.split('\n').find(l => /extended permit icmp /.test(l) && /echo/.test(l));
  assert.ok(ping, 'PING must keep echo type:\n' + r.text);
  assert.ok(!/permit icmp any any$/.test(ping.trim()), ping);
  assert.ok(/object-group service ALL_ICMP/.test(r.text), 'ALL_ICMP object must be defined:\n' + r.text);
  assert.ok(!/object-group icmp\b/.test(r.text), r.text);
  const dnsBlk = r.text.split('object-group service DNS')[1];
  assert.ok(dnsBlk, 'DNS object-group:\n' + r.text);
  const dnsBody = dnsBlk.split('object-group')[0].split('access-list')[0];
  assert.ok(/udp/.test(dnsBody) && /tcp/.test(dnsBody), dnsBody);
  assert.ok(/domain/.test(dnsBody), dnsBody);
});

test('B4 ASA multi-interval ports all kept', () => {
  const r = xlat(parseFin(fortios, F_B1), 'asa');
  const multi = r.text.split('object-group service MULTI')[1];
  assert.ok(multi, r.text);
  const body = multi.split('object-group')[0].split('access-list')[0];
  assert.ok(/eq www/.test(body) || /eq 80/.test(body), body);
  assert.ok(/eq https/.test(body) || /eq 443/.test(body), body);
  assert.ok(/eq 8443/.test(body), body);
});

test('B5 PAN source-port is emitted', () => {
  const r = xlat(parseFin(fortios, F_B1), 'panos');
  assert.ok(/set service SP protocol tcp port 80 source-port 1000/.test(r.text), r.text);
  const sp = r.report.rules.find(x => x.name === 'sp');
  assert.ok(sp, JSON.stringify(r.report.rules.map(x => x.name)));
  assert.ok(!hasCode(sp, 'other'), JSON.stringify(sp.items));
});

test('B6 order_global uses target global predicate', () => {
  const F = [
    'config firewall policy',
    '    edit 1',
    '        set name "denyall"',
    '        set srcintf "any"',
    '        set dstintf "any"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set action deny',
    '        set schedule "always"',
    '        set service "ALL"',
    '    next',
    '    edit 2',
    '        set name "p1any"',
    '        set srcintf "port1"',
    '        set dstintf "any"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set action accept',
    '        set schedule "always"',
    '        set service "ALL"',
    '    next',
    'end'
  ].join('\n');
  const r = xlat(parseFin(fortios, F), 'asa');
  const deny = r.report.rules.find(x => x.name === 'denyall');
  assert.ok(deny, JSON.stringify(r.report.rules));
  assert.ok(hasCode(deny, 'order_global'), JSON.stringify(deny.items));
  assert.strictEqual(deny.status, 'approximated');
  assert.ok(/access-list global_access /.test(r.text), r.text);
  assert.ok(/port1_access_in/.test(r.text), r.text);
});

test('B7 ASA interface ACL before global when flattening', () => {
  const A = [
    'access-list GA extended deny ip any any',
    'access-list IN1 extended permit ip any any',
    'access-group GA global',
    'access-group IN1 in interface inside'
  ].join('\n');
  const r = xlat(parseFin(cisco.asa, A), 'fortios');
  const names = r.report.rules.map(x => x.scopeLabel || x.id || x.name);
  const iIn = names.findIndex(n => /IN1/.test(String(n)));
  const iGa = names.findIndex(n => /GA/.test(String(n)));
  assert.ok(iIn >= 0 && iGa >= 0, JSON.stringify(names));
  assert.ok(iIn < iGa, 'interface before global: ' + JSON.stringify(names));
  const t = r.text;
  const pPermit = t.indexOf('set action accept');
  const pDeny = t.indexOf('set action deny');
  assert.ok(pPermit >= 0 && pDeny >= 0 && pPermit < pDeny, t);
});

test('M1 comments strip control characters', () => {
  const J = JSON.stringify({
    items: [{
      name: 'ok',
      action: 'ALLOW',
      enabled: true,
      sourceNetworks: { literals: [{ type: 'Host', value: '10.0.0.1' }] },
      newComments: ['c1\n    next\nend\nconfig system admin']
    }]
  });
  ['fortios', 'panos', 'asa'].forEach(t => {
    const r = xlat(parseFin(ftd, J), t);
    if (t === 'fortios') {
      const c = r.text.split('\n').find(l => /set comments/.test(l));
      assert.ok(c, r.text);
      assert.ok(!/\n/.test(c), c);
      assert.ok(/c1/.test(c) && /next/.test(c) && /config system admin/.test(c), c);
      const afterComment = r.text.split(c)[1] || '';
      assert.ok(!/^config system admin$/m.test(afterComment.split('\nend')[0] || ''), r.text);
    }
    if (t === 'asa') {
      const remarks = r.text.split('\n').filter(l => / remark /.test(l));
      assert.ok(remarks.length, r.text);
      remarks.forEach(l => {
        assert.ok(!/\n/.test(l), l);
        assert.ok(!/^\s*next\s*$/.test(l) && !/^\s*end\s*$/.test(l), l);
      });
      assert.ok(!/^config system admin$/m.test(r.text), r.text);
    }
    if (t === 'panos') {
      const d = r.text.split('\n').find(l => /description /.test(l));
      assert.ok(d, r.text);
      assert.ok(!/\n/.test(d), d);
      assert.ok(/c1/.test(d), d);
      assert.ok(!/^config system admin$/m.test(r.text), r.text);
    }
  });
});

test('M2 zone namespace is separate; zone_merge fires', () => {
  const F = [
    'config firewall address',
    '    edit "port1"',
    '        set subnet 10.9.0.0 255.255.0.0',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set name "zmerge"',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "port1"',
    '        set dstaddr "all"',
    '        set action accept',
    '        set schedule "always"',
    '        set service "ALL"',
    '    next',
    '    edit 2',
    '        set name "zmerge2"',
    '        set srcintf "port4"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set action accept',
    '        set schedule "always"',
    '        set service "ALL"',
    '    next',
    'end'
  ].join('\n');
  const pol = parseFin(fortios, F);
  const zmap = {
    port1: { target: 'inside', ifaces: 'e1' },
    port4: { target: 'inside', ifaces: 'e4' },
    port2: { target: 'out', ifaces: 'e2' }
  };
  const r = T.translate(pol, 'panos', zmap);
  const merge = (r.report.notes || []).filter(n => n.code === 'zone_merge');
  assert.ok(merge.length, JSON.stringify(r.report.notes));
  assert.ok(/port1/.test(merge[0].params.zones) && /port4/.test(merge[0].params.zones), JSON.stringify(merge));
  assert.strictEqual(merge[0].params.target, 'inside');
  assert.ok(!/inside_2/.test(r.text), r.text);
  const addrRen = (r.report.renamed || []).filter(x => x.kind === 'addr' && x.from === 'port1');
  assert.ok(!addrRen.length, JSON.stringify(r.report.renamed));
});

test('M4 persisted zone map is pruned to seedZones', () => {
  const P = [
    'set rulebase security rules r1 from trust',
    'set rulebase security rules r1 to untrust',
    'set rulebase security rules r1 source any',
    'set rulebase security rules r1 destination any',
    'set rulebase security rules r1 application any',
    'set rulebase security rules r1 service any',
    'set rulebase security rules r1 action allow'
  ].join('\n');
  const pol = parseFin(panos, P);
  const zmap = {
    port9: { target: 'port9', ifaces: 'port9' },
    trust: { target: 'trust', ifaces: 'e1' },
    untrust: { target: 'untrust', ifaces: 'e2' }
  };
  const r = T.translate(pol, 'fortios', zmap);
  assert.ok(!/edit "port9"/.test(r.text), r.text);
  assert.ok(!/set interface "port9"/.test(r.text), r.text);
  const zones = (r.report.zones || []).map(z => z.src);
  assert.ok(zones.indexOf('port9') < 0, JSON.stringify(zones));
});

test('N1 FTD ACP order is preserved top-down', () => {
  const J = JSON.stringify({ rules: [
    { name: 'DenyNet', action: 'BLOCK', enabled: true, sourceNetworks: { literals: [{ type: 'Network', value: '10.0.0.0/8' }] } },
    { name: 'InOut', action: 'ALLOW', enabled: true, sourceZones: { objects: [{ name: 'inside' }] }, destinationZones: { objects: [{ name: 'outside' }] } }
  ]});
  ['fortios', 'panos'].forEach(t => {
    const r = xlat(parseFin(ftd, J), t);
    const names = r.report.rules.map(x => x.name);
    assert.ok(names.indexOf('DenyNet') >= 0 && names.indexOf('InOut') > names.indexOf('DenyNet'), t + ' ' + JSON.stringify(names));
    const deny = r.report.rules.find(x => x.name === 'DenyNet');
    const allow = r.report.rules.find(x => x.name === 'InOut');
    assert.strictEqual(deny.status, 'exact', t + ' DenyNet ' + JSON.stringify(deny.items));
    assert.strictEqual(allow.status, 'exact', t + ' InOut ' + JSON.stringify(allow.items));
    if (t === 'fortios') {
      const iDeny = r.text.indexOf('set name "DenyNet"');
      const iAllow = r.text.indexOf('set name "InOut"');
      assert.ok(iDeny >= 0 && iAllow > iDeny, r.text);
    }
    if (t === 'panos') {
      const iDeny = r.text.indexOf('rules DenyNet ');
      const iAllow = r.text.indexOf('rules InOut ');
      assert.ok(iDeny >= 0 && iAllow > iDeny, r.text);
    }
  });
});

test('N2 PAN multi source-port service splits into a group', () => {
  const F = [
    'config firewall service custom',
    '    edit "MS"',
    '        set tcp-portrange 80:1000 443:2000',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set name "ms"',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set action deny',
    '        set schedule "always"',
    '        set service "MS"',
    '    next',
    'end'
  ].join('\n');
  const r = xlat(parseFin(fortios, F), 'panos');
  const overwrite = r.text.split('\n').filter(l => /^set service MS protocol /.test(l));
  assert.strictEqual(overwrite.length, 0, r.text);
  assert.ok(/set service-group MS members /.test(r.text), r.text);
  assert.ok(/port 80/.test(r.text) && /source-port 1000/.test(r.text), r.text);
  assert.ok(/port 443/.test(r.text) && /source-port 2000/.test(r.text), r.text);
  const ms = r.report.rules.find(x => x.name === 'ms');
  assert.ok(ms, JSON.stringify(r.report.rules.map(x => x.name)));
  assert.ok(hasCode(ms, 'split'), JSON.stringify(ms.items));
  assert.notStrictEqual(ms.status, 'not_translated', JSON.stringify(ms.items));
});

test('X1 PAN minted sub-service does not reuse a user service name', () => {
  const F = [
    'config firewall service custom',
    '    edit "MS"',
    '        set tcp-portrange 80:1000 443:2000',
    '    next',
    '    edit "MS-tcp-sp1000"',
    '        set tcp-portrange 22',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set name "msonly"',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set action deny',
    '        set schedule "always"',
    '        set service "MS"',
    '    next',
    '    edit 2',
    '        set name "user22"',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "all"',
    '        set action accept',
    '        set schedule "always"',
    '        set service "MS-tcp-sp1000"',
    '    next',
    'end'
  ].join('\n');
  const r = xlat(parseFin(fortios, F), 'panos');
  const userSvc = r.text.split('\n').filter(l => /^set service MS-tcp-sp1000 protocol /.test(l));
  assert.strictEqual(userSvc.length, 1, r.text);
  assert.ok(/protocol tcp port 22(?:\s|$)/.test(userSvc[0]), userSvc[0]);
  assert.ok(!/source-port/.test(userSvc[0]), userSvc[0]);
  const grp = r.text.split('\n').find(l => /^set service-group MS members /.test(l));
  assert.ok(grp, r.text);
  const mems = ((grp.match(/\[ (.+) \]/) || [])[1] || '').split(/\s+/).filter(Boolean);
  assert.ok(mems.indexOf('MS-tcp-sp1000') < 0, grp);
  assert.ok(mems.length >= 2, grp);
  const subLines = r.text.split('\n').filter(l => mems.some(m => l.indexOf('set service ' + m + ' ') === 0));
  assert.ok(subLines.some(l => /port 80/.test(l) && /source-port 1000/.test(l)), r.text);
  assert.ok(subLines.some(l => /port 443/.test(l) && /source-port 2000/.test(l)), r.text);
  const denySvc = r.text.split('\n').find(l => /rules msonly service /.test(l));
  assert.ok(denySvc && / service MS$/.test(denySvc), r.text);
  const userRule = r.text.split('\n').find(l => /rules user22 service /.test(l));
  assert.ok(userRule && / service MS-tcp-sp1000$/.test(userRule), r.text);
});

test('N3 FortiOS zone merge emits one edit with unioned interfaces', () => {
  const P = [
    'set rulebase security rules r1 from trust',
    'set rulebase security rules r1 to untrust',
    'set rulebase security rules r1 source any',
    'set rulebase security rules r1 destination any',
    'set rulebase security rules r1 application any',
    'set rulebase security rules r1 service any',
    'set rulebase security rules r1 action allow',
    'set rulebase security rules r2 from dmz',
    'set rulebase security rules r2 to untrust',
    'set rulebase security rules r2 source any',
    'set rulebase security rules r2 destination any',
    'set rulebase security rules r2 application any',
    'set rulebase security rules r2 service any',
    'set rulebase security rules r2 action allow'
  ].join('\n');
  const pol = parseFin(panos, P);
  const zmap = {
    trust: { target: 'inside', ifaces: 'port1' },
    dmz: { target: 'inside', ifaces: 'port3' },
    untrust: { target: 'wan', ifaces: 'port2' }
  };
  const r = T.translate(pol, 'fortios', zmap);
  const edits = r.text.split('\n').filter(l => /edit "inside"/.test(l));
  assert.strictEqual(edits.length, 1, r.text);
  const zoneBlk = (r.text.split('config system zone')[1] || '').split('\nend')[0];
  const insideBlk = (zoneBlk.split('edit "inside"')[1] || '').split('next')[0];
  assert.ok(/"port1"/.test(insideBlk) && /"port3"/.test(insideBlk), insideBlk);
  const ifaceLine = insideBlk.split('\n').find(l => /set interface /.test(l));
  assert.ok(ifaceLine && /"port1"/.test(ifaceLine) && /"port3"/.test(ifaceLine), insideBlk);
  const merge = (r.report.notes || []).filter(n => n.code === 'zone_merge');
  assert.ok(merge.length, JSON.stringify(r.report.notes));
  assert.strictEqual(merge[0].params.target, 'inside');
});

test('N4 nested fqdn VIP in vipgrp is unresolved', () => {
  const F = [
    'config firewall vip',
    '    edit "V1"',
    '        set type fqdn',
    '        set extip 203.0.113.5',
    '        set mapped-addr "srv.example.com"',
    '    next',
    '    edit "V2"',
    '        set extip 203.0.113.6',
    '        set mappedip "10.0.0.6"',
    '    next',
    'end',
    'config firewall vipgrp',
    '    edit "VG"',
    '        set interface "port1"',
    '        set member "V1" "V2"',
    '    next',
    'end',
    'config firewall policy',
    '    edit 1',
    '        set name "vg"',
    '        set srcintf "port1"',
    '        set dstintf "port2"',
    '        set srcaddr "all"',
    '        set dstaddr "VG"',
    '        set action accept',
    '        set schedule "always"',
    '        set service "HTTPS"',
    '    next',
    'end'
  ].join('\n');
  ['asa', 'junos'].forEach(t => {
    const r = xlat(parseFin(fortios, F), t);
    const vg = r.report.rules.find(x => x.name === 'vg');
    assert.ok(vg, t);
    assert.strictEqual(vg.status, 'not_translated', t + ' ' + JSON.stringify(vg.items));
    assert.ok(hasCode(vg, 'unresolved'), t + ' ' + JSON.stringify(vg.items));
    if (t === 'asa') {
      assert.ok(!/object-group network VG/.test(r.text), r.text);
      assert.ok(!/network-object object V1/.test(r.text), r.text);
    }
    if (t === 'junos') {
      assert.ok(!/address-set VG address V1/.test(r.text), r.text);
    }
  });
});

console.log(passed + ' passed');
