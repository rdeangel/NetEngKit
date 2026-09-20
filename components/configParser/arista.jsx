// ConfigParser_Arista: { detect, parse, sample } — EOS reuses the Cisco indented-section parser
// with a minimal preprocessing step (EOS uses `vrf instance NAME` instead of `vrf definition NAME`).
(function () {
  function detect(text) {
    let score = 0;
    if (/^!\s*device:/m.test(text)) score += 40;
    if (/^daemon\s+TerminAttr\b/m.test(text)) score += 40;
    if (/^management\s+api\s+http-commands\b/m.test(text)) score += 30;
    if (/^vrf\s+instance\s+\S+/m.test(text)) score += 30;
    if (/^mlag\s+configuration\b/m.test(text)) score += 25;
    if (/^interface\s+Ethernet\d/m.test(text)) score += 20;
    if (/^router\s+bgp\s+\d+/m.test(text)) score += 5;
    if (/^!/m.test(text)) score += 5;
    // EOS-specific evpn block
    if (/^router\s+bgp\s+\d+[\s\S]*?address-family\s+evpn\b/m.test(text)) score += 15;
    return Math.min(score, 100);
  }

  function preprocess(text) {
    // Translate EOS-only constructs into Cisco-equivalents the shared parser understands.
    return text
      .replace(/^(\s*)vrf\s+instance\s+(\S+)/gm, '$1vrf definition $2')
      .replace(/^(\s*)vrf\s+(\S+)\s*$/gm, (m, ind, name) => {
        // Inside `interface`, EOS uses `vrf NAME` to assign — translate to `vrf forwarding NAME`
        // We only rewrite indented lines (interface sub-context) to avoid clobbering top-level VRF blocks.
        return ind.length ? `${ind}vrf forwarding ${name}` : m;
      });
  }

  function parse(text, opts) {
    const cisco = window.ConfigParser_Cisco;
    if (!cisco) throw new Error('Cisco parser not loaded');
    const result = cisco.parse(preprocess(text), opts);
    result.vendor = 'arista-eos';
    return result;
  }

  window.ConfigParser_Arista = {
    name: 'Arista EOS',
    detect,
    parse,
    sample: `! device: leaf-01
!
hostname leaf-01
!
vrf instance CUST-A
   rd 65000:100
   route-target both 65000:100
!
vlan 100
   name USERS
!
vlan 200
   name SERVERS
!
interface Port-Channel1
   description MLAG peer link
   switchport mode trunk
   switchport trunk allowed vlan 100,200,4094
!
interface Ethernet1
   description spine-1
   channel-group 1 mode active
!
interface Ethernet2
   description spine-2
   channel-group 1 mode active
!
interface Ethernet5
   description server-01
   switchport mode access
   switchport access vlan 100
!
interface Vlan100
   ip address 192.168.100.1/24
!
interface Vlan200
   vrf CUST-A
   ip address 192.168.200.1/24
!
interface Loopback0
   ip address 10.255.0.1/32
!
router bgp 65000
   router-id 10.255.0.1
   neighbor 10.255.0.2 remote-as 65000
   address-family ipv4
      neighbor 10.255.0.2 activate
   vrf CUST-A
      neighbor 192.168.200.2 remote-as 65100
!
router ospf 1
   router-id 10.255.0.1
   network 10.0.0.0/30 area 0
!
ip access-list MGMT-IN
   10 permit tcp 10.0.0.0/8 any eq 22 log
   20 deny ip any any log
!
end`,
  };
})();
