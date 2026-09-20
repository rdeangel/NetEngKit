// ConfigParser_Mikrotik: RouterOS export format
(function () {
  function detect(text) {
    let score = 0;
    if (/^\/(interface|ip|routing|system|user|snmp)\b/m.test(text)) score += 50;
    if (/^add\s+name=/m.test(text) || /^set\s+\S+\s*=/m.test(text)) score += 20;
    if (/^\/interface\s+ethernet\b/m.test(text)) score += 20;
    if (/^\/ip\s+address\b/m.test(text)) score += 15;
    if (/^\/routing\s+bgp\b/m.test(text)) score += 10;
    if (/^\/ip\s+firewall\s+filter\b/m.test(text)) score += 15;
    if (/^# (?:RouterOS|model)/im.test(text)) score += 20;
    return Math.min(score, 100);
  }

  function parseKv(rest) {
    const out = {};
    const re = /(\S+?)=(?:"([^"]*)"|(\S+))/g;
    let m;
    while ((m = re.exec(rest))) out[m[1]] = m[2] !== undefined ? m[2] : m[3];
    return out;
  }

  function analyze(text) {
    const lines = text.split('\n').map(l => l.replace(/\r$/, ''));
    let path = '';
    let hostname = '';
    const ifByName = {}; // name -> { type, parent, ...kv }
    const bondings = {}; // name -> kv
    const vifs = []; // [{ parent, vlan-id, name }]
    const ipAddrs = []; // [{ address, interface }]
    const routes = [];
    const bgpInstance = {};
    const bgpPeers = [];
    const fwFilters = [];
    const sys = {
      domain: '', dns: [], ntp: [], aaa: { newModel: false, tacacs: [], radius: [], methods: [] },
      snmp: { communities: [], hosts: [], users: [] },
      syslog: [], users: [], banner: '',
      features: [], nbm: { enabled: false, flowPolicies: [] }, vpc: null, fex: [], peerLinks: [],
    };

    for (const raw of lines) {
      const ln = raw.trim();
      if (!ln || ln.startsWith('#')) continue;
      if (ln.startsWith('/')) { path = ln.slice(1).trim(); continue; }
      const cmd = ln.match(/^(add|set)\s+(.*)$/i);
      if (!cmd) continue;
      const op = cmd[1].toLowerCase();
      const rest = cmd[2];
      const kv = parseKv(rest);

      if (path === 'system identity') hostname = kv.name || hostname;
      else if (path === 'interface ethernet') {
        const target = kv.name || (rest.match(/\bname=("?)([^\s"]+)\1/) || [])[2];
        if (target) ifByName[target] = Object.assign(ifByName[target] || { type: 'ethernet' }, kv);
      }
      else if (path === 'interface bonding') {
        if (op === 'add' && kv.name) bondings[kv.name] = kv;
        if (op === 'set' && kv.name) bondings[kv.name] = Object.assign(bondings[kv.name] || {}, kv);
      }
      else if (path === 'interface vlan') {
        if (op === 'add' && kv.name && kv['vlan-id']) vifs.push({ name: kv.name, parent: kv.interface || '', vlanId: kv['vlan-id'], comment: kv.comment || '' });
      }
      else if (path === 'ip address') {
        if (op === 'add' && kv.address) ipAddrs.push({ address: kv.address, interface: kv.interface || '' });
      }
      else if (path === 'ip route') {
        if (op === 'add') routes.push(kv);
      }
      else if (path === 'routing bgp instance') Object.assign(bgpInstance, kv);
      else if (path === 'routing bgp peer') { if (op === 'add') bgpPeers.push(kv); }
      else if (path === 'ip firewall filter') {
        if (op === 'add') fwFilters.push(kv);
      }
      else if (path === 'system ntp client') {
        if (kv['primary-ntp']) sys.ntp.push({ server: kv['primary-ntp'], vrf: '', prefer: true, key: '' });
        if (kv['secondary-ntp']) sys.ntp.push({ server: kv['secondary-ntp'], vrf: '', prefer: false, key: '' });
        if (kv.servers) for (const s of kv.servers.split(',')) sys.ntp.push({ server: s, vrf: '', prefer: false, key: '' });
      }
      else if (path === 'ip dns') {
        if (kv.servers) for (const s of kv.servers.split(',')) sys.dns.push({ server: s, vrf: '' });
      }
      else if (path === 'snmp community') {
        if (op === 'set' || op === 'add') if (kv.name) sys.snmp.communities.push({ name: kv.name, access: 'RO' });
      }
      else if (path === 'system logging action') {
        if (kv.target === 'remote' && kv['remote']) sys.syslog.push({ host: kv['remote'], vrf: '', severity: '', transport: '' });
      }
      else if (path === 'user') {
        if (op === 'add' && kv.name) sys.users.push({ name: kv.name, privilege: kv.group || '' });
      }
      else if (path === 'user aaa') {
        if (kv['default-group']) sys.aaa.newModel = true;
      }
      else if (path === 'radius') {
        if (op === 'add' && kv.address) sys.aaa.radius.push({ host: kv.address, name: '', authPort: kv['auth-port'] || '', acctPort: kv['acct-port'] || '', vrf: '', key: kv.secret ? '***' : '' });
      }
    }

    // Build logicalUnits
    const logicalUnits = [];
    for (const [name, info] of Object.entries(ifByName)) {
      const ips = ipAddrs.filter(a => a.interface === name);
      logicalUnits.push({
        parent: name, unit: '', ifkey: name,
        isAgg: false, isIrb: false, members: [],
        description: info.comment || '',
        vrf: '', mode: '', vlanId: '', vlanMembers: [],
        ipv4: ips.filter(a => !a.address.includes(':')).map(a => a.address),
        ipv6: ips.filter(a => a.address.includes(':')).map(a => a.address),
        families: [],
      });
    }
    for (const [name, info] of Object.entries(bondings)) {
      const ips = ipAddrs.filter(a => a.interface === name);
      logicalUnits.push({
        parent: name, unit: '', ifkey: name,
        isAgg: true, isIrb: false, members: (info.slaves || '').split(',').filter(Boolean),
        description: info.comment || '',
        vrf: '', mode: '', vlanId: '', vlanMembers: [],
        ipv4: ips.filter(a => !a.address.includes(':')).map(a => a.address),
        ipv6: ips.filter(a => a.address.includes(':')).map(a => a.address),
        families: [],
      });
    }
    for (const v of vifs) {
      const ips = ipAddrs.filter(a => a.interface === v.name);
      logicalUnits.push({
        parent: v.parent, unit: v.vlanId, ifkey: v.name,
        isAgg: false, isIrb: false, members: [],
        description: v.comment, vrf: '', mode: 'subif',
        vlanId: v.vlanId, vlanMembers: [],
        ipv4: ips.filter(a => !a.address.includes(':')).map(a => a.address),
        ipv6: ips.filter(a => a.address.includes(':')).map(a => a.address),
        families: [],
      });
    }
    for (const u of logicalUnits) { if (u.ipv4.length) u.families.push('ipv4'); if (u.ipv6.length) u.families.push('ipv6'); }

    const aggregates = Object.entries(bondings).map(([name, info]) => ({
      name, members: (info.slaves || '').split(',').filter(Boolean),
      lacpMode: info.mode === '802.3ad' ? 'active' : (info.mode || '—'),
      periodic: '', minLinks: undefined, speed: '', description: info.comment || '',
    }));

    const vlanIndex = {};
    for (const v of vifs) vlanIndex[v.vlanId] = vlanIndex[v.vlanId] || { name: v.name, id: v.vlanId, l3Interface: v.name, description: v.comment || '', members: [{ ifkey: v.parent, mode: 'trunk' }] };
    const vlans = Object.values(vlanIndex);

    // VRFs — RouterOS has VRFs but rare in pasted configs; default only
    const vrfs = [{ name: 'main', type: 'default', rd: '', vrfTarget: '', interfaces: logicalUnits.filter(u => u.ipv4.length || u.ipv6.length).map(u => u.ifkey), protocols: [], description: '' }];
    for (const u of logicalUnits) if (u.ipv4.length || u.ipv6.length) u.vrf = 'main';

    if (bgpInstance.as || bgpPeers.length) {
      vrfs[0].protocols.push({
        proto: 'bgp',
        groups: [{ name: `AS ${bgpInstance.as || '?'}`, type: '', peerAs: '', localAs: bgpInstance.as || '', neighbors: bgpPeers.map(p => p['remote-address'] || p.name).filter(Boolean) }],
      });
    }

    const firewallRules = fwFilters.map((f, i) => ({
      id: `${f.chain || 'filter'}:${i + 1}`,
      name: `${f.chain || 'filter'}-${i + 1}`,
      fromZone: f.chain || '', toZone: '',
      sourceIntf: f['in-interface'] || '', destIntf: f['out-interface'] || '',
      source: f['src-address'] || 'any',
      destination: f['dst-address'] || 'any',
      service: [f.protocol, f['dst-port'] ? `dport ${f['dst-port']}` : ''].filter(Boolean).join(' ') || 'any',
      action: f.action || 'accept',
      log: f.log === 'yes',
      description: f.comment || '',
    }));

    return {
      vendor: 'mikrotik-routeros',
      aggregates, logicalUnits, vlans, vrfs, firewallRules, system: sys,
      counts: {
        hostname,
        physicals: Object.keys(ifByName).length,
        aggregates: aggregates.length, logicalUnits: logicalUnits.length,
        vlans: vlans.length, vrfs: 0, firewallRules: firewallRules.length,
        ntp: sys.ntp.length, tacacs: 0, radius: sys.aaa.radius.length, syslog: sys.syslog.length, features: 0, fex: 0,
      },
    };
  }

  window.ConfigParser_Mikrotik = {
    name: 'Mikrotik RouterOS',
    detect, parse(text) { return analyze(text); },
    sample: `# RouterOS 7.x configuration export
/system identity
set name=mikrotik-rtr-01
/interface ethernet
set [ find default-name=ether1 ] comment="WAN" disabled=no
set [ find default-name=ether2 ] comment="LAN-member" disabled=no
set [ find default-name=ether3 ] comment="LAN-member" disabled=no
/interface bonding
add mode=802.3ad name=bond0 slaves=ether2,ether3 comment="LAN bundle"
/interface vlan
add interface=bond0 name=vlan100 vlan-id=100 comment="USERS"
add interface=bond0 name=vlan200 vlan-id=200 comment="TENANT"
/ip address
add address=203.0.113.2/30 interface=ether1
add address=192.168.100.1/24 interface=vlan100
add address=192.168.200.1/24 interface=vlan200
add address=10.255.0.1 interface=lo
/ip route
add dst-address=0.0.0.0/0 gateway=203.0.113.1
/routing bgp instance
set default as=65000 router-id=10.255.0.1
/routing bgp peer
add name=peer-1 remote-address=10.255.0.2 remote-as=65000
add name=peer-2 remote-address=10.255.0.3 remote-as=65000
/system ntp client
set enabled=yes primary-ntp=10.1.1.1 secondary-ntp=10.1.1.2
/ip dns
set servers=8.8.8.8,1.1.1.1
/snmp community
set [ find default=yes ] name=RO-COMMUNITY
/system logging action
add name=syslog target=remote remote=10.10.30.10
/user
add name=admin group=full password=xxxxx
add name=netops group=read password=xxxxx
/ip firewall filter
add chain=input protocol=tcp dst-port=22 src-address=10.0.0.0/8 action=accept log=yes
add chain=input action=drop log=yes`,
  };
})();
