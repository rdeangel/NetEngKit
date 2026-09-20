// ConfigParser_Dell: Dell OS10 / OS6 — Cisco IOS-XE compatible with tiny preprocessing
(function () {
  function detect(text) {
    let score = 0;
    if (/^!\s*Version\s+\S+\s+Dell/im.test(text)) score += 60;
    if (/^interface\s+ethernet\s+\d+\/\d+\/\d+/im.test(text)) score += 30;
    if (/^interface\s+port-channel\s+\d+/im.test(text)) score += 15;
    if (/^channel-group\s+\d+\s+mode\s+\S+/m.test(text)) score += 10;
    if (/^hostname\s+\S+/m.test(text)) score += 8;
    return Math.min(score, 100);
  }

  function preprocess(text) {
    // OS10 syntax already aligns with IOS-XE indented sections. Normalize a couple of OS10-isms.
    return text
      .replace(/^interface\s+ethernet\s+(\d+\/\d+\/\d+)/gim, 'interface Ethernet$1')
      .replace(/^interface\s+port-channel\s+(\d+)/gim, 'interface Port-channel$1')
      .replace(/^interface\s+vlan\s+(\d+)/gim, 'interface Vlan$1');
  }

  function parse(text, opts) {
    const cisco = window.ConfigParser_Cisco;
    if (!cisco) throw new Error('Cisco parser not loaded');
    const result = cisco.parse(preprocess(text), opts);
    result.vendor = 'dell-os10';
    return result;
  }

  window.ConfigParser_Dell = {
    name: 'Dell OS10 / OS6',
    detect, parse,
    sample: `! Version 10.5.2 Dell EMC Networking
hostname dell-leaf-01
!
vlan 100
 name USERS
!
vlan 200
 name SERVERS
!
interface port-channel 1
 description spine-uplink
 switchport mode trunk
 switchport trunk allowed vlan 100,200
!
interface ethernet 1/1/1
 description spine-1
 channel-group 1 mode active
 no shutdown
!
interface ethernet 1/1/2
 description spine-2
 channel-group 1 mode active
 no shutdown
!
interface ethernet 1/1/10
 description user
 switchport mode access
 switchport access vlan 100
!
interface vlan 100
 ip address 192.168.100.1/24
!
interface vlan 200
 ip address 192.168.200.1/24
!
router bgp 65000
 neighbor 10.255.0.2
  remote-as 65000
!
ip access-list MGMT-IN
 seq 10 permit tcp 10.0.0.0/8 any eq 22 log
 seq 20 deny ip any any log
!
ntp server 10.1.1.1
ip name-server 8.8.8.8
tacacs-server host 10.10.10.10 key dell-secret
end`,
  };
})();
