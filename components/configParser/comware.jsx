// ConfigParser_Comware: HPE Comware / H3C — preprocessed onto the Cisco parser
(function () {
  function detect(text) {
    let score = 0;
    if (/^sysname\s+\S+/m.test(text)) score += 20;
    if (/^interface\s+Bridge-Aggregation\d+/im.test(text)) score += 40;
    if (/\bport\s+link-aggregation\s+group\s+\d+/.test(text)) score += 30;
    if (/^vlan\s+\d+/m.test(text) && /\bdescription\b/.test(text)) score += 10;
    if (/^acl\s+(advanced|basic)\s+\d+/m.test(text)) score += 30;
    if (/\bport\s+access\s+vlan\s+\d+/.test(text)) score += 15;
    if (/\bport\s+trunk\s+permit\s+vlan\b/.test(text)) score += 20;
    if (/^ip\s+vpn-instance\s+\S+/m.test(text)) score += 15;
    if (/^bgp\s+\d+\s*$/m.test(text)) score += 5;
    if (/^#\s*$/m.test(text)) score += 3;
    return Math.min(score, 100);
  }

  function preprocess(text) {
    const lines = [];
    for (const raw of text.split('\n')) {
      let ln = raw.replace(/\r$/, '');
      ln = ln.replace(/^#\s*$/, '!');
      ln = ln.replace(/^sysname\s+(\S+)/i, 'hostname $1');
      ln = ln.replace(/^interface\s+Bridge-Aggregation(\d+)/i, 'interface Port-channel$1');
      ln = ln.replace(/^interface\s+Vlan-interface(\d+)/i, 'interface Vlan$1');
      ln = ln.replace(/^ip\s+vpn-instance\s+(\S+)/i, 'vrf definition $1');
      ln = ln.replace(/^bgp\s+(\d+)\s*$/i, 'router bgp $1');
      ln = ln.replace(/^ospf\s+(\d+)\s*$/i, 'router ospf $1');
      ln = ln.replace(/^acl\s+(?:advanced|basic|name)\s+(\S+)/i, 'ip access-list extended $1');
      // indented sub-context
      ln = ln.replace(/^(\s+)port\s+link-aggregation\s+group\s+(\d+)/i, '$1channel-group $2 mode active');
      ln = ln.replace(/^(\s+)port\s+link-type\s+(\S+)/i, '$1switchport mode $2');
      ln = ln.replace(/^(\s+)port\s+access\s+vlan\s+(\d+)/i, '$1switchport access vlan $2');
      ln = ln.replace(/^(\s+)port\s+trunk\s+permit\s+vlan\s+(.+)$/i, '$1switchport trunk allowed vlan $2');
      ln = ln.replace(/^(\s+)port\s+trunk\s+pvid\s+vlan\s+(\d+)/i, '$1switchport trunk native vlan $2');
      ln = ln.replace(/^(\s+)ip\s+binding\s+vpn-instance\s+(\S+)/i, '$1vrf forwarding $2');
      ln = ln.replace(/^(\s+)route-distinguisher\s+(\S+)/i, '$1rd $2');
      ln = ln.replace(/^(\s+)vpn-target\s+(\S+)\s+(?:both|import|export).*$/i, '$1route-target both $2');
      ln = ln.replace(/^(\s+)peer\s+(\S+)\s+as-number\s+(\d+)/i, '$1neighbor $2 remote-as $3');
      ln = ln.replace(/^(\s+)rule\s+\d+\s+(permit|deny)\s+(.+)$/i, '$1$2 $3');
      ln = ln.replace(/^ntp-service\s+unicast-server\s+(\S+)/i, 'ntp server $1');
      ln = ln.replace(/^hwtacacs\s+scheme\s+(\S+)/i, 'tacacs server $1');
      ln = ln.replace(/^radius\s+scheme\s+(\S+)/i, 'radius server $1');
      ln = ln.replace(/^info-center\s+loghost\s+(\S+)/i, 'logging host $1');
      ln = ln.replace(/^snmp-agent\s+community\s+(?:read|write)\s+(\S+)/i, 'snmp-server community $1 RO');
      lines.push(ln);
    }
    return lines.join('\n');
  }

  function parse(text, opts) {
    const cisco = window.ConfigParser_Cisco;
    if (!cisco) throw new Error('Cisco parser not loaded');
    const result = cisco.parse(preprocess(text), opts);
    result.vendor = 'hpe-comware';
    return result;
  }

  window.ConfigParser_Comware = {
    name: 'HPE Comware / H3C',
    detect, parse,
    sample: `sysname comware-sw-01
#
vlan 100
 name USERS
#
vlan 200
 name SERVERS
#
ip vpn-instance CUST-A
 route-distinguisher 65000:100
 vpn-target 65000:100 both
#
interface Bridge-Aggregation1
 description core-uplink
 port link-type trunk
 port trunk permit vlan 100 200
 link-aggregation mode dynamic
#
interface GigabitEthernet1/0/1
 port link-aggregation group 1
#
interface GigabitEthernet1/0/2
 port link-aggregation group 1
#
interface GigabitEthernet1/0/10
 port link-type access
 port access vlan 100
#
interface Vlan-interface100
 ip address 192.168.100.1 24
#
interface Vlan-interface200
 ip binding vpn-instance CUST-A
 ip address 192.168.200.1 24
#
bgp 65000
 peer 10.255.0.2 as-number 65000
#
ospf 1
#
acl advanced 3000
 rule 10 permit tcp source 10.0.0.0 0.0.0.255 destination-port eq 22
 rule 20 deny ip
#
ntp-service unicast-server 10.1.1.1
hwtacacs scheme PRIMARY-TAC
radius scheme NPS-01
info-center loghost 10.10.30.10
snmp-agent community read RO-COMMUNITY
#
return`,
  };
})();
