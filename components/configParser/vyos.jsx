// ConfigParser_VyOS: { detect, parse, sample }
(function () {
  function detect(text) {
    let score = 0;
    if (/^set\s+(interfaces|protocols|service|system|firewall|vrf)\s+/m.test(text)) score += 60;
    if (/^set\s+interfaces\s+(ethernet|bonding|vif|bridge|loopback|dummy)\s+/m.test(text)) score += 20;
    if (/^set\s+system\s+host-name\s+/m.test(text)) score += 15;
    if (/^set\s+protocols\s+bgp\s+/m.test(text)) score += 10;
    if (/^set\s+firewall\s+name\s+\S+\s+rule\s+\d+/m.test(text)) score += 15;
    if (/'[^']*'/.test(text)) score += 5;
    return Math.min(score, 100);
  }

  function tokenizeLine(rest) {
    const toks = [];
    const re = /'([^']*)'|"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(rest))) toks.push(m[1] ?? m[2] ?? m[3]);
    return toks;
  }

  function buildTree(text) {
    const root = {};
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^set\s+(.+)$/);
      if (!m) continue;
      const toks = tokenizeLine(m[1]);
      if (!toks.length) continue;
      let cur = root;
      for (let i = 0; i < toks.length - 1; i++) {
        const k = toks[i];
        if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k];
      }
      const last = toks[toks.length - 1];
      if (cur[last] === undefined) cur[last] = true;
    }
    return root;
  }

  function leafKeys(node) { return node && typeof node === 'object' ? Object.keys(node) : []; }
  function leafFirst(node) { return leafKeys(node)[0] || ''; }

  function analyze(text) {
    const tree = buildTree(text);
    const interfaces = (tree.interfaces || {});
    const ethBlock = interfaces.ethernet || {};
    const bondBlock = interfaces.bonding || {};
    const loBlock = interfaces.loopback || {};
    const brBlock = interfaces.bridge || {};
    const dummyBlock = interfaces.dummy || {};
    const vrfNames = (tree.vrf && tree.vrf.name) || {};

    const logicalUnits = [];
    const aggregates = [];
    const vlans = [];
    const vlanIndex = {};

    function pushUnit(parent, unit, def, isAgg, isIrb) {
      if (!def || typeof def !== 'object') return;
      const desc = leafFirst(def.description);
      const u = {
        parent, unit: String(unit || ''), ifkey: unit ? `${parent}.${unit}` : parent,
        isAgg: !!isAgg, isIrb: !!isIrb, members: [],
        description: desc,
        vrf: leafFirst(def.vrf) || '',
        mode: '', vlanId: unit ? String(unit) : '',
        vlanMembers: [],
        ipv4: leafKeys(def.address).filter(a => /^\d{1,3}(?:\.\d{1,3}){3}\/\d+$/.test(a)),
        ipv6: leafKeys(def.address).filter(a => /^[0-9a-fA-F:]+\/\d+$/.test(a) && a.includes(':')),
        families: [],
      };
      if (u.ipv4.length) u.families.push('ipv4');
      if (u.ipv6.length) u.families.push('ipv6');
      logicalUnits.push(u);

      // VIFs
      if (def.vif && typeof def.vif === 'object') {
        for (const [vid, vd] of Object.entries(def.vif)) pushUnit(parent, vid, vd, false, false);
      }
    }

    for (const [name, def] of Object.entries(ethBlock)) pushUnit(name, '', def, false, false);
    for (const [name, def] of Object.entries(loBlock)) pushUnit(name, '', def, false, false);
    for (const [name, def] of Object.entries(dummyBlock)) pushUnit(name, '', def, false, false);
    for (const [name, def] of Object.entries(bondBlock)) {
      pushUnit(name, '', def, true, false);
      const members = leafKeys((def.member && def.member.interface) || {});
      const mode = leafFirst(def.mode);
      const lacpMode = mode === '802.3ad' ? 'active' : (mode || '—');
      aggregates.push({ name, members, lacpMode, periodic: '', minLinks: undefined, speed: '', description: leafFirst(def.description) });
    }
    for (const [name, def] of Object.entries(brBlock)) {
      pushUnit(name, '', def, false, true);
      const id = (name.match(/(\d+)/) || [])[1] || '';
      if (id) vlanIndex[id] = vlanIndex[id] || { name, id, l3Interface: name, description: leafFirst(def.description), members: [] };
    }

    for (const v of Object.values(vlanIndex)) vlans.push(v);

    // VRFs
    const vrfs = [{ name: 'default', type: 'default', rd: '', vrfTarget: '', interfaces: [], protocols: [], description: '' }];
    for (const [n, vd] of Object.entries(vrfNames)) {
      vrfs.push({
        name: n, type: 'vrf', rd: '', vrfTarget: '',
        interfaces: [], protocols: [],
        description: leafFirst(vd.description),
      });
    }
    for (const u of logicalUnits) {
      const target = u.vrf || 'default';
      const v = vrfs.find(x => x.name === target) || vrfs[0];
      if (v && !v.interfaces.includes(u.ifkey) && (u.ipv4.length || u.ipv6.length)) v.interfaces.push(u.ifkey);
    }

    // Protocols
    const proto = tree.protocols || {};
    if (proto.bgp) {
      const asN = leafFirst(proto.bgp['system-as']) || '';
      const neighbors = leafKeys(proto.bgp.neighbor);
      vrfs[0].protocols.push({ proto: 'bgp', groups: [{ name: `AS ${asN}`, type: '', peerAs: '', localAs: asN, neighbors }] });
    }
    if (proto.ospf) {
      const areas = leafKeys(proto.ospf.area).map(a => ({ area: a, interfaces: leafKeys(((proto.ospf.area || {})[a] || {}).interface) }));
      vrfs[0].protocols.push({ proto: 'ospf', areas });
    }

    // Firewall rules
    const firewallRules = [];
    const fwNames = (tree.firewall && tree.firewall.name) || {};
    for (const [polName, pol] of Object.entries(fwNames)) {
      const rules = pol.rule || {};
      for (const [rid, r] of Object.entries(rules)) {
        firewallRules.push({
          id: `${polName}:${rid}`, name: polName,
          fromZone: '', toZone: '',
          sourceIntf: '', destIntf: '',
          source: leafFirst((r.source || {}).address) || 'any',
          destination: leafFirst((r.destination || {}).address) || 'any',
          service: [leafFirst(r.protocol), leafFirst((r.destination || {}).port) ? `dport ${leafFirst(r.destination.port)}` : ''].filter(Boolean).join(' ') || 'any',
          action: leafFirst(r.action) || '—',
          log: !!r.log,
          description: leafFirst(r.description),
        });
      }
    }

    // System
    const sysBlock = tree.system || {};
    const svcBlock = tree.service || {};
    const hostname = leafFirst(sysBlock['host-name']);
    const system = {
      domain: leafFirst(sysBlock['domain-name']),
      dns: leafKeys(sysBlock['name-server']).map(s => ({ server: s, vrf: '' })),
      ntp: leafKeys((svcBlock.ntp || {}).server).map(s => ({ server: s, vrf: '', prefer: false, key: '' })),
      aaa: {
        newModel: !!(sysBlock['tacplus-server'] || sysBlock['radius-server'] || (sysBlock.login && sysBlock.login.radius)),
        tacacs: leafKeys((sysBlock['tacplus-server'] || {}).host || {}).map(h => ({ host: h, name: '', key: '***', vrf: '', port: '' })),
        radius: leafKeys((sysBlock.login && sysBlock.login.radius && sysBlock.login.radius.server) || {}).map(h => ({ host: h, name: '', authPort: '', acctPort: '', vrf: '', key: '***' })),
        methods: [],
      },
      snmp: {
        communities: leafKeys((svcBlock.snmp || {}).community).map(n => ({ name: n, access: 'RO' })),
        hosts: [], users: [],
      },
      syslog: leafKeys((sysBlock.syslog || {}).host).map(h => ({ host: h, vrf: '', severity: '', transport: '' })),
      users: leafKeys((sysBlock.login && sysBlock.login.user) || {}).map(n => ({ name: n, privilege: '' })),
      banner: '',
      features: [], nbm: { enabled: false, flowPolicies: [] }, vpc: null, fex: [], peerLinks: [],
    };

    return {
      vendor: 'vyos',
      aggregates, logicalUnits, vlans, vrfs, firewallRules, system,
      counts: {
        hostname,
        physicals: logicalUnits.filter(u => !u.isAgg && !u.isIrb && !u.unit).length,
        aggregates: aggregates.length,
        logicalUnits: logicalUnits.length,
        vlans: vlans.length,
        vrfs: vrfs.length - 1,
        firewallRules: firewallRules.length,
        ntp: system.ntp.length, tacacs: system.aaa.tacacs.length, radius: system.aaa.radius.length, syslog: system.syslog.length, features: 0, fex: 0,
      },
    };
  }

  window.ConfigParser_VyOS = {
    name: 'VyOS',
    detect,
    parse(text) { return analyze(text); },
    sample: `set system host-name 'vyos-router-01'
set system domain-name 'lab.local'
set system name-server '8.8.8.8'
set system name-server '1.1.1.1'
set system tacplus-server host '10.10.10.10' key 'secret'
set system syslog host '10.10.30.10' facility all level 'info'
set system login user admin level 'admin'
set system login user netops level 'operator'
set service ntp server '10.1.1.1'
set service ntp server '10.1.1.2'
set service snmp community 'RO-COMMUNITY' authorization 'ro'
set interfaces ethernet eth0 description 'WAN'
set interfaces ethernet eth0 address '203.0.113.2/30'
set interfaces ethernet eth1 description 'LAN-member'
set interfaces ethernet eth2 description 'LAN-member'
set interfaces bonding bond0 description 'LAN bundle'
set interfaces bonding bond0 mode '802.3ad'
set interfaces bonding bond0 member interface 'eth1'
set interfaces bonding bond0 member interface 'eth2'
set interfaces bonding bond0 vif 100 description 'USERS'
set interfaces bonding bond0 vif 100 address '192.168.100.1/24'
set interfaces bonding bond0 vif 200 description 'TENANT'
set interfaces bonding bond0 vif 200 address '192.168.200.1/24'
set interfaces bonding bond0 vif 200 vrf 'CUST-A'
set interfaces loopback lo address '10.255.0.1/32'
set vrf name CUST-A table 100
set vrf name CUST-A description 'Customer A'
set protocols bgp system-as 65000
set protocols bgp neighbor 10.255.0.2 remote-as 65000
set protocols bgp neighbor 10.255.0.3 remote-as 65000
set protocols ospf area 0 network '10.0.0.0/30'
set firewall name WAN-IN default-action 'drop'
set firewall name WAN-IN rule 10 action 'accept'
set firewall name WAN-IN rule 10 protocol 'tcp'
set firewall name WAN-IN rule 10 destination port '22'
set firewall name WAN-IN rule 10 source address '10.0.0.0/8'
set firewall name WAN-IN rule 10 log
set firewall name WAN-IN rule 20 action 'drop'
set firewall name WAN-IN rule 20 log`,
  };
})();
