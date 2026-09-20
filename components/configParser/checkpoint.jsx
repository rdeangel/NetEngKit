// ConfigParser_CheckPoint: Gaia clish export
(function () {
  function detect(text) {
    let score = 0;
    if (/^add\s+interface\s+\S+\s+ipv4-address\s+/m.test(text)) score += 50;
    if (/^set\s+interface\s+\S+\s+(state|comments|mtu)\b/m.test(text)) score += 30;
    if (/^add\s+bonding\s+group\s+\d+\s+member\s+/m.test(text)) score += 30;
    if (/^add\s+static-route\s+\S+\s+nexthop/m.test(text)) score += 20;
    if (/^set\s+routed\s+/m.test(text)) score += 15;
    if (/^set\s+ntp\s+server\s+/m.test(text)) score += 10;
    if (/^set\s+hostname\s+\S+/m.test(text)) score += 10;
    if (/^add\s+(tacacs|radius)-servers\s+/m.test(text)) score += 15;
    return Math.min(score, 100);
  }

  function analyze(text) {
    const lines = text.split('\n').map(l => l.replace(/\r$/, '').trim()).filter(Boolean);
    let hostname = '';
    const ifaces = {}; // name -> { ipv4: [], ipv6: [], comment, state, mtu }
    const bonds = {}; // groupId -> { members: [], mode }
    const routes = [];
    const fwRules = [];
    const sys = {
      domain: '', dns: [], ntp: [], aaa: { newModel: false, tacacs: [], radius: [], methods: [] },
      snmp: { communities: [], hosts: [], users: [] },
      syslog: [], users: [], banner: '',
      features: [], nbm: { enabled: false, flowPolicies: [] }, vpc: null, fex: [], peerLinks: [],
    };
    let bgpAs = '';
    const bgpPeers = [];

    function ensureIf(name) { return ifaces[name] || (ifaces[name] = { ipv4: [], ipv6: [], comment: '', state: '', mtu: '', vlanId: '', parent: name }); }

    for (const ln of lines) {
      if (ln.startsWith('#')) continue;
      let m;
      if ((m = ln.match(/^set\s+hostname\s+(\S+)/i))) hostname = m[1];
      else if ((m = ln.match(/^set\s+domainname\s+(\S+)/i))) sys.domain = m[1];
      else if ((m = ln.match(/^set\s+dns\s+(?:primary|secondary|tertiary)\s+(\S+)/i))) sys.dns.push({ server: m[1], vrf: '' });
      else if ((m = ln.match(/^add\s+interface\s+(\S+)\s+ipv4-address\s+(\S+)\s+(?:mask-length\s+(\d+)|subnet-mask\s+(\S+))/i))) {
        const i = ensureIf(m[1]);
        i.ipv4.push(`${m[2]}${m[3] ? '/' + m[3] : (m[4] ? ' ' + m[4] : '')}`);
      }
      else if ((m = ln.match(/^add\s+interface\s+(\S+)\s+ipv6-address\s+(\S+)\s+mask-length\s+(\d+)/i))) {
        const i = ensureIf(m[1]); i.ipv6.push(`${m[2]}/${m[3]}`);
      }
      else if ((m = ln.match(/^add\s+interface\s+(\S+)\s+vlan\s+(\d+)/i))) {
        const i = ensureIf(m[1]); i.vlanId = m[2];
        const parent = m[1].split('.')[0];
        if (parent !== m[1]) i.parent = parent;
      }
      else if ((m = ln.match(/^set\s+interface\s+(\S+)\s+comments\s+"?([^"]+?)"?\s*$/i))) ensureIf(m[1]).comment = m[2];
      else if ((m = ln.match(/^set\s+interface\s+(\S+)\s+state\s+(\S+)/i))) ensureIf(m[1]).state = m[2];
      else if ((m = ln.match(/^set\s+interface\s+(\S+)\s+mtu\s+(\d+)/i))) ensureIf(m[1]).mtu = m[2];
      else if ((m = ln.match(/^add\s+bonding\s+group\s+(\d+)\s+member\s+(\S+)/i))) {
        const g = bonds[m[1]] || (bonds[m[1]] = { members: [], mode: '' });
        g.members.push(m[2]);
      }
      else if ((m = ln.match(/^set\s+bonding\s+group\s+(\d+)\s+mode\s+(\S+)/i))) {
        (bonds[m[1]] = bonds[m[1]] || { members: [], mode: '' }).mode = m[2];
      }
      else if ((m = ln.match(/^add\s+static-route\s+(\S+)\s+nexthop\s+gateway\s+address\s+(\S+)/i))) {
        routes.push({ prefix: m[1], nexthop: m[2] });
      }
      else if ((m = ln.match(/^set\s+routed\s+\S+\s+as\s+(\d+)/i))) bgpAs = m[1];
      else if ((m = ln.match(/^add\s+routed\s+peer\s+(\S+)\s+remote-as\s+(\d+)/i))) bgpPeers.push({ ip: m[1], as: m[2] });
      else if ((m = ln.match(/^set\s+ntp\s+server\s+(\S+)(?:\s+prefer\s+(\S+))?/i))) sys.ntp.push({ server: m[1], vrf: '', prefer: (m[2] || '').toLowerCase() === 'yes', key: '' });
      else if ((m = ln.match(/^add\s+tacacs-servers\s+(?:priority\s+\d+\s+)?server\s+(\S+)/i))) sys.aaa.tacacs.push({ host: m[1], name: '', key: '***', vrf: '', port: '' });
      else if ((m = ln.match(/^add\s+radius-servers\s+(?:priority\s+\d+\s+)?server\s+(\S+)/i))) sys.aaa.radius.push({ host: m[1], name: '', authPort: '', acctPort: '', vrf: '', key: '***' });
      else if ((m = ln.match(/^set\s+syslog\s+log-remote-address\s+(\S+)/i))) sys.syslog.push({ host: m[1], vrf: '', severity: '', transport: '' });
      else if ((m = ln.match(/^set\s+snmp\s+community\s+(\S+)/i))) sys.snmp.communities.push({ name: m[1], access: 'RO' });
      else if ((m = ln.match(/^add\s+user\s+(\S+)(?:\s+.*role\s+(\S+))?/i))) sys.users.push({ name: m[1], privilege: m[2] || '' });
    }

    // Build outputs
    const logicalUnits = [];
    for (const [name, info] of Object.entries(ifaces)) {
      const isAgg = /^bond\d+$/i.test(name);
      logicalUnits.push({
        parent: info.parent || name, unit: info.vlanId, ifkey: name,
        isAgg, isIrb: false, members: [],
        description: info.comment, vrf: '',
        mode: info.vlanId ? 'subif' : '', vlanId: info.vlanId, vlanMembers: [],
        ipv4: info.ipv4, ipv6: info.ipv6,
        families: [].concat(info.ipv4.length ? ['ipv4'] : []).concat(info.ipv6.length ? ['ipv6'] : []),
      });
    }
    const aggregates = Object.entries(bonds).map(([g, info]) => ({
      name: `bond${g}`, members: info.members,
      lacpMode: info.mode && /8023AD|active/i.test(info.mode) ? 'active' : (info.mode || '—'),
      periodic: '', minLinks: undefined, speed: '', description: '',
    }));
    const vlans = [];
    const vlanIndex = {};
    for (const u of logicalUnits) {
      if (u.vlanId) {
        const v = vlanIndex[u.vlanId] || (vlanIndex[u.vlanId] = { name: `vlan${u.vlanId}`, id: u.vlanId, l3Interface: u.ifkey, description: u.description, members: [] });
        v.members.push({ ifkey: u.ifkey, mode: 'subif' });
      }
    }
    for (const v of Object.values(vlanIndex)) vlans.push(v);

    const vrfs = [{
      name: 'default', type: 'default', rd: '', vrfTarget: '',
      interfaces: logicalUnits.filter(u => u.ipv4.length || u.ipv6.length).map(u => u.ifkey),
      protocols: [], description: '',
    }];
    if (bgpAs || bgpPeers.length) {
      vrfs[0].protocols.push({ proto: 'bgp', groups: [{ name: `AS ${bgpAs}`, type: '', peerAs: '', localAs: bgpAs, neighbors: bgpPeers.map(p => p.ip) }] });
    }
    for (const u of logicalUnits) if (u.ipv4.length || u.ipv6.length) u.vrf = 'default';

    return {
      vendor: 'checkpoint-gaia',
      aggregates, logicalUnits, vlans, vrfs, firewallRules: fwRules, system: sys,
      counts: {
        hostname, physicals: Object.keys(ifaces).filter(n => !/^bond\d/.test(n)).length,
        aggregates: aggregates.length, logicalUnits: logicalUnits.length,
        vlans: vlans.length, vrfs: 0, firewallRules: fwRules.length,
        ntp: sys.ntp.length, tacacs: sys.aaa.tacacs.length, radius: sys.aaa.radius.length, syslog: sys.syslog.length, features: 0, fex: 0,
      },
    };
  }

  window.ConfigParser_CheckPoint = {
    name: 'Check Point Gaia',
    detect, parse(text) { return analyze(text); },
    sample: `# Check Point Gaia configuration
set hostname checkpoint-gw-01
set domainname lab.local
set dns primary 8.8.8.8
set dns secondary 1.1.1.1
add interface eth0 ipv4-address 203.0.113.2 mask-length 30
set interface eth0 comments "WAN"
set interface eth0 state on
add bonding group 1 member eth1
add bonding group 1 member eth2
set bonding group 1 mode 8023AD
add interface bond1 ipv4-address 10.0.0.1 mask-length 24
add interface bond1.100 vlan 100
add interface bond1.100 ipv4-address 192.168.100.1 mask-length 24
set interface bond1.100 comments "USERS"
add interface bond1.200 vlan 200
add interface bond1.200 ipv4-address 192.168.200.1 mask-length 24
set interface bond1.200 comments "TENANT"
add static-route 0.0.0.0/0 nexthop gateway address 203.0.113.1
set routed instance default-vrf-aux as 65000
add routed peer 10.255.0.2 remote-as 65000
add routed peer 10.255.0.3 remote-as 65000
set ntp server 10.1.1.1 prefer yes
set ntp server 10.1.1.2 prefer no
add tacacs-servers priority 1 server 10.10.10.10
add radius-servers priority 1 server 10.10.20.10
set syslog log-remote-address 10.10.30.10
set snmp community RO-COMMUNITY
add user admin uid 0 homedir /home/admin role adminRole`,
  };
})();
