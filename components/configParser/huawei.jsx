// ConfigParser_Huawei: VRP — preprocessed onto the Cisco indented-section parser
(function () {
  function detect(text) {
    let score = 0;
    if (/^sysname\s+\S+/m.test(text)) score += 40;
    if (/^interface\s+Eth-Trunk\d+/im.test(text)) score += 35;
    if (/\bport\s+link-type\s+(access|trunk|hybrid)\b/.test(text)) score += 30;
    if (/^vlan\s+batch\s+\d/m.test(text)) score += 25;
    if (/^ip\s+vpn-instance\s+\S+/m.test(text)) score += 25;
    if (/^interface\s+Vlanif\d+/im.test(text)) score += 20;
    if (/^acl\s+(number|name)\s+/m.test(text)) score += 15;
    if (/^bgp\s+\d+\s*$/m.test(text)) score += 10;
    if (/^#\s*$/m.test(text)) score += 5;
    // Penalize Comware markers — those should route to the Comware parser
    if (/^interface\s+Bridge-Aggregation\d+/im.test(text)) score -= 50;
    if (/^acl\s+(advanced|basic)\s+\d+/m.test(text)) score -= 40;
    if (/\bport\s+link-aggregation\s+group\s+\d+/.test(text)) score -= 30;
    return Math.max(0, Math.min(score, 100));
  }

  function preprocess(text) {
    const lines = [];
    let pendingVlanBatch = [];
    for (const raw of text.split('\n')) {
      let ln = raw.replace(/\r$/, '');
      // separators
      ln = ln.replace(/^#\s*$/, '!');
      // hostname
      ln = ln.replace(/^sysname\s+(\S+)/i, 'hostname $1');
      // bulk vlan declaration → emit `vlan N` blocks afterwards
      const bm = ln.match(/^vlan\s+batch\s+(.+)$/i);
      if (bm) {
        // expand "100 200 to 205 300"
        const tokens = bm[1].split(/\s+/);
        for (let i = 0; i < tokens.length; i++) {
          if (tokens[i] === 'to' && /^\d+$/.test(tokens[i - 1]) && /^\d+$/.test(tokens[i + 1])) {
            const a = +tokens[i - 1], b = +tokens[i + 1];
            for (let v = a + 1; v <= b; v++) pendingVlanBatch.push(String(v));
            i++;
          } else if (/^\d+$/.test(tokens[i])) pendingVlanBatch.push(tokens[i]);
        }
        continue;
      }
      // interface name rewrites
      ln = ln.replace(/^interface\s+Eth-Trunk(\d+)/i, 'interface Port-channel$1');
      ln = ln.replace(/^interface\s+Vlanif(\d+)/i, 'interface Vlan$1');
      // top-level VRF
      ln = ln.replace(/^ip\s+vpn-instance\s+(\S+)/i, 'vrf definition $1');
      // top-level router protocols
      ln = ln.replace(/^bgp\s+(\d+)\s*$/i, 'router bgp $1');
      ln = ln.replace(/^ospf\s+(\d+)\s*$/i, 'router ospf $1');
      // acl number/name → cisco extended ACL
      ln = ln.replace(/^acl\s+(?:number|name)\s+(\S+)/i, 'ip access-list extended $1');
      // indented sub-context rewrites
      ln = ln.replace(/^(\s+)eth-trunk\s+(\d+)/i, '$1channel-group $2 mode active');
      ln = ln.replace(/^(\s+)port\s+link-type\s+(\S+)/i, '$1switchport mode $2');
      ln = ln.replace(/^(\s+)port\s+default\s+vlan\s+(\d+)/i, '$1switchport access vlan $2');
      ln = ln.replace(/^(\s+)port\s+trunk\s+allow-pass\s+vlan\s+(.+)$/i, '$1switchport trunk allowed vlan $2');
      ln = ln.replace(/^(\s+)port\s+trunk\s+pvid\s+vlan\s+(\d+)/i, '$1switchport trunk native vlan $2');
      ln = ln.replace(/^(\s+)ip\s+binding\s+vpn-instance\s+(\S+)/i, '$1vrf forwarding $2');
      ln = ln.replace(/^(\s+)route-distinguisher\s+(\S+)/i, '$1rd $2');
      ln = ln.replace(/^(\s+)vpn-target\s+(\S+)\s+(?:both|export_extcommunity|import_extcommunity|export|import)\b.*$/i, '$1route-target both $2');
      ln = ln.replace(/^(\s+)peer\s+(\S+)\s+as-number\s+(\d+)/i, '$1neighbor $2 remote-as $3');
      ln = ln.replace(/^(\s+)rule\s+\d+\s+(permit|deny)\s+(.+)$/i, '$1$2 $3');
      // NTP / AAA-ish rewrites
      ln = ln.replace(/^ntp-service\s+unicast-server\s+(\S+)/i, 'ntp server $1');
      ln = ln.replace(/^hwtacacs-server\s+template\s+(\S+)/i, 'tacacs server $1');
      ln = ln.replace(/^radius-server\s+template\s+(\S+)/i, 'radius server $1');
      ln = ln.replace(/^info-center\s+loghost\s+(\S+)/i, 'logging host $1');
      ln = ln.replace(/^snmp-agent\s+community\s+(?:read|write)\s+(\S+)/i, 'snmp-server community $1 RO');
      lines.push(ln);
    }
    // Emit synthetic `vlan N` blocks for batch declarations
    if (pendingVlanBatch.length) {
      lines.push('!');
      for (const v of pendingVlanBatch) lines.push(`vlan ${v}`);
    }
    return lines.join('\n');
  }

  function parse(text, opts) {
    const cisco = window.ConfigParser_Cisco;
    if (!cisco) throw new Error('Cisco parser not loaded');
    const result = cisco.parse(preprocess(text), opts);
    result.vendor = 'huawei-vrp';
    return result;
  }

  window.ConfigParser_Huawei = {
    name: 'Huawei VRP',
    detect, parse,
    sample: `sysname huawei-ce-01
#
vlan batch 100 200 to 202 300
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
interface Eth-Trunk1
 description spine-uplink
 port link-type trunk
 port trunk allow-pass vlan 100 200 300
 mode lacp-static
#
interface GigabitEthernet0/0/1
 eth-trunk 1
#
interface GigabitEthernet0/0/2
 eth-trunk 1
#
interface GigabitEthernet0/0/5
 port link-type access
 port default vlan 100
#
interface Vlanif100
 ip address 192.168.100.1 255.255.255.0
#
interface Vlanif200
 ip binding vpn-instance CUST-A
 ip address 192.168.200.1 255.255.255.0
#
interface LoopBack0
 ip address 10.255.0.1 255.255.255.255
#
bgp 65000
 peer 10.255.0.2 as-number 65000
 peer 10.255.0.3 as-number 65000
#
ospf 1
 area 0.0.0.0
#
acl name MGMT-IN
 rule 10 permit tcp source 10.0.0.0 0.0.0.255 destination-port eq 22
 rule 20 deny ip
#
ntp-service unicast-server 10.1.1.1
hwtacacs-server template PRIMARY-TAC
radius-server template NPS-01
info-center loghost 10.10.30.10
snmp-agent community read RO-COMMUNITY
#
return`,
  };
})();
