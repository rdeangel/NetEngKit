// ConfigParser_Extreme: EXOS — flat command-style configuration
(function () {
  function detect(text) {
    let score = 0;
    if (/^#\s*Module\s+\S+/m.test(text)) score += 30;
    if (/^create\s+vlan\s+\S+/m.test(text)) score += 40;
    if (/^configure\s+vlan\s+\S+\s+(add|tag)\b/m.test(text)) score += 30;
    if (/^configure\s+ip\s+address\s+vlan\s+/m.test(text)) score += 25;
    if (/^enable\s+sharing\s+\d/m.test(text)) score += 25;
    if (/^create\s+virtual-router\s+/m.test(text)) score += 25;
    if (/^configure\s+snmp/m.test(text)) score += 5;
    if (/^configure\s+sys-name\s+/m.test(text)) score += 15;
    return Math.min(score, 100);
  }

  function analyze(text) {
    const lines = text.split('\n').map(l => l.replace(/\r$/, '').trim()).filter(Boolean);
    let hostname = '';
    const vlanByTag = {}; // tag -> { name, id, members: [...] }
    const vlanByName = {}; // name -> vlan record
    const portToVlans = {}; // portId -> [{ name, mode }]
    const lagGroup = {}; // group -> { members: [...], algorithm, lacp }
    const portToLag = {}; // port -> group
    const acls = []; // [{ name, rule, action, src, dst, svc, log }]
    const sys = {
      domain: '', dns: [], ntp: [], aaa: { newModel: false, tacacs: [], radius: [], methods: [] },
      snmp: { communities: [], hosts: [], users: [] },
      syslog: [], users: [], banner: '',
      features: [], nbm: { enabled: false, flowPolicies: [] }, vpc: null, fex: [], peerLinks: [],
    };
    const vrfs = [{ name: 'VR-Default', type: 'default', rd: '', vrfTarget: '', interfaces: [], protocols: [], description: '' }];

    function expandPorts(expr) {
      const ports = [];
      for (const segment of expr.split(',')) {
        const r = segment.trim().match(/^(\d+:)(\d+)(?:-(\d+:)?(\d+))?$/);
        if (!r) { ports.push(segment.trim()); continue; }
        const slot = r[1];
        const start = +r[2];
        const end = r[4] ? +r[4] : start;
        for (let p = start; p <= end; p++) ports.push(`${slot}${p}`);
      }
      return ports;
    }
    function ensureVlan(name) {
      const v = vlanByName[name] || (vlanByName[name] = { name, id: '', l3Interface: '', description: '', members: [] });
      return v;
    }

    for (const ln of lines) {
      let m;
      if ((m = ln.match(/^configure\s+sys-name\s+(?:"([^"]+)"|(\S+))/i))) hostname = m[1] || m[2];
      else if ((m = ln.match(/^create\s+vlan\s+"?([^"\s]+)"?(?:\s+tag\s+(\d+))?/i))) {
        const v = ensureVlan(m[1]);
        if (m[2]) v.id = m[2];
        if (m[2]) vlanByTag[m[2]] = v;
      }
      else if ((m = ln.match(/^configure\s+vlan\s+"?([^"\s]+)"?\s+tag\s+(\d+)/i))) {
        const v = ensureVlan(m[1]); v.id = m[2]; vlanByTag[m[2]] = v;
      }
      else if ((m = ln.match(/^configure\s+vlan\s+"?([^"\s]+)"?\s+add\s+ports\s+(\S+)(?:\s+(tagged|untagged))?/i))) {
        const v = ensureVlan(m[1]);
        const mode = m[3] === 'tagged' ? 'trunk' : 'access';
        for (const p of expandPorts(m[2])) {
          v.members.push({ ifkey: p, mode });
          (portToVlans[p] = portToVlans[p] || []).push({ name: m[1], mode });
        }
      }
      else if ((m = ln.match(/^configure\s+vlan\s+"?([^"\s]+)"?\s+ipaddress\s+(\S+)(?:\s+(\S+))?/i)) ||
               (m = ln.match(/^configure\s+ip\s+address\s+vlan\s+"?([^"\s]+)"?\s+(\S+)(?:\s+(\S+))?/i))) {
        const v = ensureVlan(m[1]);
        v.l3Interface = `vlan-${m[1]}`;
        v.__ipv4 = `${m[2]}${m[3] ? ` ${m[3]}` : ''}`;
      }
      else if ((m = ln.match(/^configure\s+vlan\s+"?([^"\s]+)"?\s+description\s+(?:"([^"]+)"|(.+))/i))) {
        ensureVlan(m[1]).description = m[2] || m[3] || '';
      }
      else if ((m = ln.match(/^enable\s+sharing\s+(\S+)\s+grouping\s+(\S+)\s+algorithm\s+(\S+)(?:\s+lacp)?/i))) {
        const group = m[1];
        const members = expandPorts(m[2]);
        const usesLacp = /lacp/i.test(ln);
        lagGroup[group] = { members, algorithm: m[3], lacp: usesLacp };
        for (const p of members) portToLag[p] = group;
      }
      else if ((m = ln.match(/^create\s+virtual-router\s+"?([^"\s]+)"?/i))) {
        vrfs.push({ name: m[1], type: 'virtual-router', rd: '', vrfTarget: '', interfaces: [], protocols: [], description: '' });
      }
      else if ((m = ln.match(/^configure\s+virtual-router\s+"?([^"\s]+)"?\s+add\s+vlan\s+"?([^"\s]+)"?/i))) {
        const v = vrfs.find(x => x.name === m[1]) || vrfs[0];
        if (v && !v.interfaces.includes(`vlan-${m[2]}`)) v.interfaces.push(`vlan-${m[2]}`);
      }
      else if ((m = ln.match(/^configure\s+ports\s+(\S+)\s+description-string\s+(?:"([^"]+)"|(.+))/i))) {
        // Port descriptions; informational
      }
      else if ((m = ln.match(/^create\s+access-list\s+"?([^"\s]+)"?(?:\s+"([^"]+)")?(?:\s+(.+))?/i))) {
        acls.push({ name: m[1], rule: m[1], action: 'permit', src: 'any', dst: 'any', svc: m[3] || 'any', log: false });
      }
      else if ((m = ln.match(/^configure\s+ntp\s+server\s+add\s+(\S+)/i))) sys.ntp.push({ server: m[1], vrf: '', prefer: false, key: '' });
      else if ((m = ln.match(/^configure\s+dns-client\s+(?:add\s+)?(\S+)/i))) sys.dns.push({ server: m[1], vrf: '' });
      else if ((m = ln.match(/^configure\s+tacacs\s+(?:primary|secondary)\s+server\s+(\S+)/i))) sys.aaa.tacacs.push({ host: m[1], name: '', key: '***', vrf: '', port: '' });
      else if ((m = ln.match(/^configure\s+radius\s+(?:netlogin\s+)?(?:primary|secondary)\s+server\s+(\S+)/i))) sys.aaa.radius.push({ host: m[1], name: '', authPort: '', acctPort: '', vrf: '', key: '***' });
      else if ((m = ln.match(/^configure\s+syslog\s+add\s+(\S+)/i))) sys.syslog.push({ host: m[1], vrf: '', severity: '', transport: '' });
      else if ((m = ln.match(/^configure\s+snmpv3\s+add\s+community\s+"?([^"\s]+)"?/i))) sys.snmp.communities.push({ name: m[1], access: 'RO' });
      else if ((m = ln.match(/^create\s+account\s+(\S+)\s+(\S+)/i))) sys.users.push({ name: m[2], privilege: m[1] });
    }

    // Build logicalUnits: each VLAN becomes a logical unit with IP if any; LAGs as separate aggregates
    const logicalUnits = [];
    const physicalPorts = new Set();
    for (const v of Object.values(vlanByName)) {
      for (const mem of v.members) physicalPorts.add(mem.ifkey);
    }
    // SVI per VLAN with IP
    for (const v of Object.values(vlanByName)) {
      if (v.__ipv4) {
        logicalUnits.push({
          parent: `vlan-${v.name}`, unit: v.id || '', ifkey: `vlan-${v.name}`,
          isAgg: false, isIrb: true, members: [],
          description: v.description, vrf: '', mode: 'svi',
          vlanId: v.id, vlanMembers: [],
          ipv4: [v.__ipv4], ipv6: [], families: ['ipv4'],
        });
      }
    }
    // Physical ports as units (with vlan membership inferred)
    for (const p of physicalPorts) {
      const memberships = portToVlans[p] || [];
      const accessVlan = memberships.find(x => x.mode === 'access');
      const trunkVlans = memberships.filter(x => x.mode === 'trunk').map(x => x.name);
      logicalUnits.push({
        parent: p, unit: '', ifkey: p,
        isAgg: false, isIrb: false, members: [],
        description: portToLag[p] ? `member of LAG ${portToLag[p]}` : '',
        vrf: '', mode: accessVlan ? 'access' : (trunkVlans.length ? 'trunk' : ''),
        vlanId: accessVlan ? (vlanByName[accessVlan.name].id || '') : '',
        vlanMembers: trunkVlans,
        ipv4: [], ipv6: [], families: [],
      });
    }
    // Aggregates
    const aggregates = Object.entries(lagGroup).map(([g, info]) => ({
      name: `lag-${g}`, members: info.members,
      lacpMode: info.lacp ? 'active' : 'static',
      periodic: '', minLinks: undefined, speed: '', description: '',
    }));

    // Assign vlan SVI to default VRF if no explicit virtual-router add
    for (const u of logicalUnits) {
      if (!u.vrf && u.ipv4.length) { u.vrf = vrfs[0].name; if (!vrfs[0].interfaces.includes(u.ifkey)) vrfs[0].interfaces.push(u.ifkey); }
    }

    const vlans = Object.values(vlanByName).map(v => ({ name: v.name, id: v.id, l3Interface: v.l3Interface, description: v.description, members: v.members }));
    const firewallRules = acls.map((r, i) => ({
      id: `${r.name}:${i + 1}`, name: r.name,
      fromZone: 'acl', toZone: '', sourceIntf: '', destIntf: '',
      source: r.src, destination: r.dst, service: r.svc,
      action: r.action, log: r.log, description: '',
    }));

    return {
      vendor: 'extreme-exos',
      aggregates, logicalUnits, vlans, vrfs, firewallRules, system: sys,
      counts: {
        hostname, physicals: physicalPorts.size,
        aggregates: aggregates.length, logicalUnits: logicalUnits.length,
        vlans: vlans.length, vrfs: vrfs.length - 1, firewallRules: firewallRules.length,
        ntp: sys.ntp.length, tacacs: sys.aaa.tacacs.length, radius: sys.aaa.radius.length, syslog: sys.syslog.length, features: 0, fex: 0,
      },
    };
  }

  window.ConfigParser_Extreme = {
    name: 'Extreme EXOS',
    detect, parse(text) { return analyze(text); },
    sample: `# EXOS configuration
configure sys-name "exos-sw-01"
configure dns-client add 8.8.8.8
configure ntp server add 10.1.1.1
configure ntp server add 10.1.1.2
configure tacacs primary server 10.10.10.10 client-ip 10.0.0.1 vr VR-Default
configure radius netlogin primary server 10.10.20.10 client-ip 10.0.0.1 vr VR-Default
configure syslog add 10.10.30.10
configure snmpv3 add community "RO-COMMUNITY" name "ro" user "admin"
create account admin admin
create vlan "USERS" tag 100
create vlan "SERVERS" tag 200
configure vlan USERS description "User VLAN"
configure vlan USERS add ports 1:5-1:10 untagged
configure vlan SERVERS add ports 1:5-1:10 tagged
configure vlan USERS ipaddress 192.168.100.1/24
configure vlan SERVERS ipaddress 192.168.200.1/24
enable sharing 1:1 grouping 1:1-1:2 algorithm address-based L2 lacp
configure vlan USERS add ports 1:1 tagged
configure vlan SERVERS add ports 1:1 tagged
create virtual-router VR-CUST-A
configure virtual-router VR-CUST-A add vlan SERVERS
configure bgp AS-number 65000
configure bgp add neighbor 10.255.0.2 remote-AS-number 65000
create access-list MGMT-IN "tcp source any destination any port 22" permit log`,
  };
})();
