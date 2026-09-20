// ConfigParser_PaloAlto: PAN-OS set-style configurations
(function () {
  function detect(text) {
    let score = 0;
    if (/^set\s+(network|rulebase|deviceconfig|vsys|panorama|shared)\s+/m.test(text)) score += 60;
    if (/^set\s+network\s+interface\s+ethernet\s+ethernet\d+/m.test(text)) score += 30;
    if (/^set\s+network\s+virtual-router\s+/m.test(text)) score += 25;
    if (/^set\s+rulebase\s+security\s+rules\s+/m.test(text)) score += 30;
    if (/^set\s+network\s+(zone|vlan)\s+/m.test(text)) score += 15;
    if (/^set\s+deviceconfig\s+system\s+/m.test(text)) score += 10;
    return Math.min(score, 100);
  }

  function tokenizeLine(rest) {
    const toks = [];
    const re = /\[([^\]]*)\]|"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(rest))) {
      if (m[1] !== undefined) toks.push({ list: m[1].trim().split(/\s+/).filter(Boolean) });
      else toks.push(m[2] !== undefined ? m[2] : m[3]);
    }
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
        const k = typeof toks[i] === 'object' ? '_list' : toks[i];
        if (!cur[k] || typeof cur[k] !== 'object') cur[k] = {};
        cur = cur[k];
      }
      const last = toks[toks.length - 1];
      if (typeof last === 'object' && last.list) {
        const parentKey = toks.length >= 2 ? toks[toks.length - 2] : null;
        if (parentKey && typeof parentKey === 'string') {
          let parent = root;
          for (let i = 0; i < toks.length - 2; i++) parent = parent[typeof toks[i] === 'object' ? '_list' : toks[i]];
          parent[parentKey] = last.list;
        }
      } else {
        const k = String(last);
        if (cur[k] === undefined) cur[k] = true;
      }
    }
    return root;
  }

  function asList(v) {
    if (!v) return [];
    if (Array.isArray(v)) return v;
    if (typeof v === 'string') return [v];
    if (typeof v === 'object') return Object.keys(v).filter(k => k !== '_list').concat(Array.isArray(v._list) ? v._list : []);
    return [];
  }

  function analyze(text) {
    const tree = buildTree(text);
    const net = tree.network || {};
    const ifBlock = (net.interface && net.interface.ethernet) || {};
    const aggBlock = (net.interface && net.interface['aggregate-ethernet']) || {};
    const loBlock = (net.interface && net.interface.loopback) || {};
    const vlanBlock = net.vlan || {};
    const vrBlock = net['virtual-router'] || {};
    const zoneBlock = net.zone || {};

    const logicalUnits = [];
    const aggregates = [];

    function pushUnit(parent, def, isAgg) {
      const layer3 = def && def.layer3;
      const ipObjs = layer3 && layer3.ip ? asList(layer3.ip) : [];
      const ipv6Objs = layer3 && layer3.ipv6 ? asList(layer3.ipv6.address) : [];
      const desc = (def && typeof def.comment === 'string') ? def.comment : '';
      const u = {
        parent, unit: '', ifkey: parent,
        isAgg: !!isAgg, isIrb: false, members: [],
        description: desc, vrf: '', mode: '',
        vlanId: '', vlanMembers: [],
        ipv4: ipObjs, ipv6: ipv6Objs,
        families: [],
      };
      if (u.ipv4.length) u.families.push('ipv4');
      if (u.ipv6.length) u.families.push('ipv6');
      logicalUnits.push(u);

      // Subinterfaces (layer3 units)
      if (layer3 && layer3.units) {
        for (const [unitName, unit] of Object.entries(layer3.units)) {
          if (typeof unit !== 'object') continue;
          const sub = {
            parent, unit: unitName, ifkey: unitName,
            isAgg: !!isAgg, isIrb: false, members: [],
            description: typeof unit.comment === 'string' ? unit.comment : '',
            vrf: '', mode: 'subif',
            vlanId: String(unit.tag || ''),
            vlanMembers: [],
            ipv4: asList(unit.ip),
            ipv6: asList(unit.ipv6 && unit.ipv6.address),
            families: [],
          };
          if (sub.ipv4.length) sub.families.push('ipv4');
          if (sub.ipv6.length) sub.families.push('ipv6');
          logicalUnits.push(sub);
        }
      }
    }

    for (const [name, def] of Object.entries(ifBlock)) pushUnit(name, def, false);
    for (const [aeNum, def] of Object.entries(aggBlock)) pushUnit(aeNum.startsWith('ae') ? aeNum : `ae${aeNum}`, def, true);

    // Build aggregate membership from ethernet members' aggregate-group references
    const aggMembers = {};
    for (const [name, def] of Object.entries(ifBlock)) {
      if (def && def['aggregate-group']) {
        const aeNum = typeof def['aggregate-group'] === 'string' ? def['aggregate-group'] : Object.keys(def['aggregate-group'])[0];
        const aeKey = aeNum.startsWith('ae') ? aeNum : `ae${aeNum}`;
        (aggMembers[aeKey] = aggMembers[aeKey] || []).push(name);
      }
    }
    for (const [aeNum, def] of Object.entries(aggBlock)) {
      const aeKey = aeNum.startsWith('ae') ? aeNum : `ae${aeNum}`;
      const members = aggMembers[aeKey] || [];
      const lacp = def && def.lacp;
      aggregates.push({
        name: aeKey, members,
        lacpMode: lacp ? (Object.keys(lacp).includes('mode') ? Object.keys(lacp.mode)[0] : 'configured') : (members.length ? 'static' : '—'),
        periodic: '', minLinks: '', speed: '',
        description: (def && typeof def.comment === 'string') ? def.comment : '',
      });
    }

    for (const [name, def] of Object.entries(loBlock)) pushUnit(name, def, false);

    // VLANs
    const vlanIndex = {};
    for (const [vname, vdef] of Object.entries(vlanBlock)) {
      const ifs = asList(vdef && vdef.interface);
      const tag = (vdef && vdef['virtual-interface'] && vdef['virtual-interface']['interface']) || '';
      vlanIndex[vname] = { name: vname, id: '', l3Interface: tag || '', description: '', members: ifs.map(i => ({ ifkey: i, mode: '' })) };
    }
    // also infer from subif tags
    for (const u of logicalUnits) {
      if (u.vlanId && !vlanIndex[u.vlanId]) {
        vlanIndex[u.vlanId] = { name: `tag${u.vlanId}`, id: u.vlanId, l3Interface: u.ifkey, description: '', members: [{ ifkey: u.ifkey, mode: 'subif' }] };
      }
    }
    const vlans = Object.values(vlanIndex);

    // Virtual routers = VRFs
    const vrfs = [];
    for (const [name, def] of Object.entries(vrBlock)) {
      const ifs = asList(def && def.interface);
      const protos = [];
      if (def && def.protocol && def.protocol.bgp) {
        const asN = (def.protocol.bgp['local-as'] && Object.keys(def.protocol.bgp['local-as'])[0]) || '';
        const peers = (def.protocol.bgp['peer-group'] || {});
        const neighbors = [];
        for (const pg of Object.values(peers)) {
          if (pg && pg.peer) for (const p of Object.values(pg.peer)) {
            if (p && p['peer-address'] && p['peer-address'].ip) neighbors.push(...Object.keys(p['peer-address'].ip));
          }
        }
        protos.push({ proto: 'bgp', groups: [{ name: `AS ${asN}`, type: '', peerAs: '', localAs: asN, neighbors }] });
      }
      if (def && def.protocol && def.protocol.ospf) {
        const areas = Object.keys((def.protocol.ospf.area) || {}).map(a => ({ area: a, interfaces: [] }));
        protos.push({ proto: 'ospf', areas });
      }
      vrfs.push({ name, type: name === 'default' ? 'default' : 'virtual-router', rd: '', vrfTarget: '', interfaces: ifs, protocols: protos, description: '' });
    }
    if (!vrfs.length) vrfs.push({ name: 'default', type: 'default', rd: '', vrfTarget: '', interfaces: [], protocols: [], description: '' });
    // Assign units to VRs
    for (const u of logicalUnits) {
      for (const v of vrfs) if (v.interfaces.includes(u.ifkey)) { u.vrf = v.name; break; }
      if (!u.vrf && (u.ipv4.length || u.ipv6.length)) { u.vrf = vrfs[0].name; if (!vrfs[0].interfaces.includes(u.ifkey)) vrfs[0].interfaces.push(u.ifkey); }
    }
    // Zone tagging
    const ifToZone = {};
    for (const [zn, zdef] of Object.entries(zoneBlock)) {
      const list = (zdef && zdef.network && zdef.network.layer3) ? asList(zdef.network.layer3) : asList(zdef && zdef.interface);
      for (const i of list) ifToZone[i] = zn;
    }

    // Security rules
    const firewallRules = [];
    const sec = tree.rulebase && tree.rulebase.security && tree.rulebase.security.rules;
    if (sec && typeof sec === 'object') {
      for (const [rname, r] of Object.entries(sec)) {
        firewallRules.push({
          id: rname, name: rname,
          fromZone: asList(r.from).join(', ') || 'any',
          toZone: asList(r.to).join(', ') || 'any',
          sourceIntf: '', destIntf: '',
          source: asList(r.source).join(', ') || 'any',
          destination: asList(r.destination).join(', ') || 'any',
          service: [asList(r.service).join(', '), asList(r.application).join(', ')].filter(Boolean).join(' / ') || 'any',
          action: (r.action && Object.keys(r.action)[0]) || 'allow',
          log: !!(r['log-start'] || r['log-end'] || r['log-setting']),
          description: typeof r.description === 'string' ? r.description : '',
        });
      }
    }

    // System
    const dc = (tree.deviceconfig && tree.deviceconfig.system) || {};
    const hostname = (dc.hostname && Object.keys(dc.hostname)[0]) || '';
    const dns = [];
    const dnsServers = dc['dns-setting'] && dc['dns-setting'].servers;
    if (dnsServers) {
      if (dnsServers.primary) dns.push({ server: Object.keys(dnsServers.primary)[0], vrf: '' });
      if (dnsServers.secondary) dns.push({ server: Object.keys(dnsServers.secondary)[0], vrf: '' });
    }
    const ntpServers = [];
    const ntpRoot = dc['ntp-servers'];
    if (ntpRoot) {
      for (const sg of ['primary-ntp-server', 'secondary-ntp-server']) {
        const block = ntpRoot[sg];
        if (block && block['ntp-server-address']) ntpServers.push({ server: Object.keys(block['ntp-server-address'])[0], vrf: '', prefer: sg === 'primary-ntp-server', key: '' });
      }
    }
    const tacacs = [];
    const radius = [];
    const serverProfiles = (tree.shared && tree.shared['server-profile']) || {};
    if (serverProfiles.tacplus) for (const [n] of Object.entries(serverProfiles.tacplus)) tacacs.push({ host: '', name: n, key: '***', vrf: '', port: '' });
    if (serverProfiles.radius) for (const [n] of Object.entries(serverProfiles.radius)) radius.push({ host: '', name: n, authPort: '', acctPort: '', vrf: '', key: '***' });

    const system = {
      domain: (dc['domain'] && Object.keys(dc['domain'])[0]) || '',
      dns, ntp: ntpServers,
      aaa: { newModel: tacacs.length > 0 || radius.length > 0, tacacs, radius, methods: [] },
      snmp: { communities: [], hosts: [], users: [] },
      syslog: [], users: [], banner: '',
      features: [], nbm: { enabled: false, flowPolicies: [] }, vpc: null, fex: [], peerLinks: [],
    };

    return {
      vendor: 'paloalto-panos',
      aggregates, logicalUnits, vlans, vrfs, firewallRules, system,
      counts: {
        hostname, physicals: Object.keys(ifBlock).length,
        aggregates: aggregates.length, logicalUnits: logicalUnits.length,
        vlans: vlans.length, vrfs: vrfs.length - 1, firewallRules: firewallRules.length,
        ntp: system.ntp.length, tacacs: system.aaa.tacacs.length, radius: system.aaa.radius.length, syslog: system.syslog.length, features: 0, fex: 0,
      },
    };
  }

  window.ConfigParser_PaloAlto = {
    name: 'Palo Alto PAN-OS',
    detect, parse(text) { return analyze(text); },
    sample: `set deviceconfig system hostname pan-fw-01
set deviceconfig system domain lab.local
set deviceconfig system dns-setting servers primary 8.8.8.8
set deviceconfig system dns-setting servers secondary 1.1.1.1
set deviceconfig system ntp-servers primary-ntp-server ntp-server-address 10.1.1.1
set deviceconfig system ntp-servers secondary-ntp-server ntp-server-address 10.1.1.2
set shared server-profile tacplus PRIMARY-TAC server 10.10.10.10 secret encrypted-xxx port 49
set shared server-profile radius NPS-01 server 10.10.20.10 secret encrypted-xxx
set network interface ethernet ethernet1/1 layer3 ip 203.0.113.2/30
set network interface ethernet ethernet1/1 comment "WAN"
set network interface ethernet ethernet1/2 aggregate-group 1
set network interface ethernet ethernet1/3 aggregate-group 1
set network interface aggregate-ethernet ae1 lacp mode active
set network interface aggregate-ethernet ae1 layer3 ip 10.0.0.1/30
set network interface aggregate-ethernet ae1 comment "LAN bundle"
set network interface aggregate-ethernet ae1 layer3 units ae1.100 tag 100
set network interface aggregate-ethernet ae1 layer3 units ae1.100 ip 192.168.100.1/24
set network interface aggregate-ethernet ae1 layer3 units ae1.100 comment "USERS"
set network interface aggregate-ethernet ae1 layer3 units ae1.200 tag 200
set network interface aggregate-ethernet ae1 layer3 units ae1.200 ip 192.168.200.1/24
set network interface aggregate-ethernet ae1 layer3 units ae1.200 comment "TENANT"
set network interface loopback units loopback.1 ip 10.255.0.1/32
set network virtual-router default interface [ ethernet1/1 ae1 ae1.100 ae1.200 loopback.1 ]
set network virtual-router default protocol bgp local-as 65000
set network virtual-router default protocol bgp peer-group iBGP peer ROUTER-2 peer-address ip 10.255.0.2/32
set network zone untrust network layer3 ethernet1/1
set network zone trust network layer3 [ ae1.100 ae1.200 ]
set rulebase security rules allow-web from trust
set rulebase security rules allow-web to untrust
set rulebase security rules allow-web source any
set rulebase security rules allow-web destination any
set rulebase security rules allow-web application [ web-browsing ssl ]
set rulebase security rules allow-web service application-default
set rulebase security rules allow-web action allow
set rulebase security rules allow-web log-end yes
set rulebase security rules deny-all from any
set rulebase security rules deny-all to any
set rulebase security rules deny-all source any
set rulebase security rules deny-all destination any
set rulebase security rules deny-all service any
set rulebase security rules deny-all application any
set rulebase security rules deny-all action deny
set rulebase security rules deny-all log-end yes`,
  };
})();
