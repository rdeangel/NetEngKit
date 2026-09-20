// ConfigParser_Aruba: { detect, parse, sample } — AOS-CX preprocessed to Cisco-equivalents
(function () {
  function detect(text) {
    let score = 0;
    if (/^!Version\s+ArubaOS-CX/im.test(text)) score += 60;
    if (/^interface\s+lag\s+\d+/im.test(text)) score += 30;
    if (/^\s*lag\s+\d+\s*$/m.test(text)) score += 20;
    if (/^\s*vlan\s+(access|trunk)\b/m.test(text)) score += 25;
    if (/^\s*vrf\s+attach\s+\S+/m.test(text)) score += 25;
    if (/^access-list\s+ip\s+\S+/m.test(text)) score += 15;
    if (/^interface\s+\d+\/\d+\/\d+/m.test(text)) score += 15;
    if (/^!/m.test(text)) score += 3;
    return Math.min(score, 100);
  }

  function preprocess(text) {
    const out = [];
    for (const raw of text.split('\n')) {
      let ln = raw.replace(/\r$/, '');
      // Top-level rewrites first (no indent dependency)
      ln = ln.replace(/^interface\s+lag\s+(\d+)/i, 'interface Port-channel$1');
      ln = ln.replace(/^vrf\s+(\S+)\s*$/i, 'vrf definition $1');
      ln = ln.replace(/^access-list\s+ip\s+(\S+)/i, 'ip access-list extended $1');
      // Indented (interface sub-context) rewrites
      ln = ln.replace(/^(\s+)lag\s+(\d+)\s*$/i, '$1channel-group $2 mode active');
      ln = ln.replace(/^(\s+)vlan\s+access\s+(\d+)/i, '$1switchport mode access\n$1switchport access vlan $2');
      ln = ln.replace(/^(\s+)vlan\s+trunk\s+native\s+(\d+)/i, '$1switchport trunk native vlan $2');
      ln = ln.replace(/^(\s+)vlan\s+trunk\s+allowed\s+(.+)$/i, '$1switchport mode trunk\n$1switchport trunk allowed vlan $2');
      ln = ln.replace(/^(\s+)vrf\s+attach\s+(\S+)/i, '$1vrf forwarding $2');
      out.push(ln);
    }
    return out.join('\n');
  }

  function parse(text, opts) {
    const cisco = window.ConfigParser_Cisco;
    if (!cisco) throw new Error('Cisco parser not loaded');
    const result = cisco.parse(preprocess(text), opts);
    result.vendor = 'aruba-aos-cx';
    return result;
  }

  window.ConfigParser_Aruba = {
    name: 'Aruba AOS-CX',
    detect,
    parse,
    sample: `!Version ArubaOS-CX 10.10
hostname aruba-leaf-01
!
vrf CUST-A
!
vlan 100
    name USERS
!
vlan 200
    name SERVERS
!
interface lag 1
    description spine-uplink
    no shutdown
    no routing
    vlan trunk native 1
    vlan trunk allowed 100,200,300
!
interface 1/1/1
    description spine-1
    no shutdown
    lag 1
!
interface 1/1/2
    description spine-2
    no shutdown
    lag 1
!
interface 1/1/5
    description user-port
    no shutdown
    no routing
    vlan access 100
!
interface vlan100
    description users SVI
    ip address 192.168.100.1/24
!
interface vlan200
    vrf attach CUST-A
    ip address 192.168.200.1/24
!
interface loopback 0
    ip address 10.255.0.1/32
!
router bgp 65000
    router-id 10.255.0.1
    neighbor 10.255.0.2 remote-as 65000
    neighbor 10.255.0.3 remote-as 65000
!
router ospf 1
    router-id 10.255.0.1
    area 0.0.0.0
!
access-list ip MGMT-IN
    10 permit tcp 10.0.0.0/8 any eq 22 log
    20 deny any any any log
!
end`,
  };
})();
