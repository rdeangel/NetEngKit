// ConfigParser_Junos: { detect, parse, sample }
(function () {
  function tokenize(text) {
    const out = [];
    const s = text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*#.*$/gm, ' ');
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '{' || c === '}' || c === ';') { out.push(c); i++; continue; }
      if (c === '"') {
        let e = i + 1;
        while (e < s.length && s[e] !== '"') e++;
        out.push(s.slice(i + 1, e));
        i = e + 1; continue;
      }
      if (c === '[') {
        const e = s.indexOf(']', i);
        const end = e < 0 ? s.length : e;
        out.push({ list: s.slice(i + 1, end).replace(/"/g, '').trim().split(/\s+/).filter(Boolean) });
        i = end + 1; continue;
      }
      let e = i;
      while (e < s.length && !/[\s{};]/.test(s[e])) e++;
      out.push(s.slice(i, e));
      i = e;
    }
    return out;
  }

  function keyOf(t) { return typeof t === 'object' ? JSON.stringify(t) : String(t); }

  function parseBraceStyle(text) {
    const tokens = tokenize(text);
    let p = 0;
    function block() {
      const node = {};
      while (p < tokens.length) {
        if (tokens[p] === '}') { p++; return node; }
        const path = [];
        while (p < tokens.length && tokens[p] !== '{' && tokens[p] !== ';' && tokens[p] !== '}') {
          path.push(tokens[p]); p++;
        }
        if (p >= tokens.length) break;
        const term = tokens[p];
        if (term === '{') { p++; assignSub(node, path, block()); }
        else if (term === ';') { p++; assignLeaf(node, path); }
        else if (term === '}') { p++; return node; }
      }
      return node;
    }
    return block();
  }

  function assignSub(node, path, child) {
    if (!path.length) return;
    let cur = node;
    for (let i = 0; i < path.length - 1; i++) {
      const k = keyOf(path[i]);
      if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
      cur = cur[k];
    }
    const lk = keyOf(path[path.length - 1]);
    if (cur[lk] && typeof cur[lk] === 'object' && !Array.isArray(cur[lk])) Object.assign(cur[lk], child);
    else cur[lk] = child;
  }

  function assignLeaf(node, path) {
    if (!path.length) return;
    if (path.length === 1) {
      const k = keyOf(path[0]);
      if (!(k in node)) node[k] = true;
      return;
    }
    let cur = node;
    for (let i = 0; i < path.length - 2; i++) {
      const k = keyOf(path[i]);
      if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
      cur = cur[k];
    }
    const prev = keyOf(path[path.length - 2]);
    const last = path[path.length - 1];
    const lv = typeof last === 'object' && last.list ? last.list : keyOf(last);
    if (cur[prev] === undefined || cur[prev] === true) {
      cur[prev] = lv;
    } else if (typeof cur[prev] === 'object' && !Array.isArray(cur[prev])) {
      if (Array.isArray(lv)) cur[prev]._list = lv;
      else if (!(lv in cur[prev])) cur[prev][lv] = true;
    } else if (typeof cur[prev] === 'string') {
      cur[prev] = { [cur[prev]]: true, [Array.isArray(lv) ? '_list' : lv]: Array.isArray(lv) ? lv : true };
    }
  }

  function parseSetStyle(text) {
    const root = {};
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const m = line.match(/^set\s+(.+?)\s*;?\s*$/);
      if (!m) continue;
      const tokens = [];
      const re = /"([^"]*)"|\[([^\]]*)\]|(\S+)/g;
      let mm;
      while ((mm = re.exec(m[1]))) {
        if (mm[1] !== undefined) tokens.push(mm[1]);
        else if (mm[2] !== undefined) tokens.push({ list: mm[2].trim().split(/\s+/).filter(Boolean) });
        else tokens.push(mm[3]);
      }
      if (!tokens.length) continue;
      let cur = root;
      for (let i = 0; i < tokens.length - 1; i++) {
        const k = keyOf(tokens[i]);
        if (!cur[k] || typeof cur[k] !== 'object' || Array.isArray(cur[k])) cur[k] = {};
        cur = cur[k];
      }
      const last = tokens[tokens.length - 1];
      if (typeof last === 'object' && last.list) {
        let parent = root;
        for (let i = 0; i < tokens.length - 2; i++) parent = parent[keyOf(tokens[i])];
        parent[keyOf(tokens[tokens.length - 2] || '_root')] = last.list;
      } else {
        const lk = keyOf(last);
        if (!(lk in cur)) cur[lk] = {};
      }
    }
    return root;
  }

  function parseTree(text) {
    const t = text.trim();
    if (!t) return {};
    // Check set-style first — brace regex would false-positive on { in quoted descriptions
    if (/^\s*set\s+/m.test(t)) return parseSetStyle(t);
    if (/\{[\s\S]*\}/.test(t)) return parseBraceStyle(t);
    return parseBraceStyle(t);
  }

  function extractAddrs(node) {
    if (!node) return [];
    if (typeof node === 'string') return [node];
    if (Array.isArray(node)) return node.filter(v => typeof v === 'string');
    if (typeof node === 'object') {
      const out = [];
      for (const [k, v] of Object.entries(node)) {
        if (k === '_list' && Array.isArray(v)) { out.push(...v); continue; }
        if (['arp', 'vrrp-group', 'vrrp-inet6-group', 'primary', 'preferred', 'master-only'].includes(k)) continue;
        out.push(k);
      }
      return out;
    }
    return [];
  }

  function asList(node) {
    if (!node) return [];
    if (Array.isArray(node)) return node;
    if (typeof node === 'string') return [node];
    if (typeof node === 'object') {
      const out = [];
      for (const [k, v] of Object.entries(node)) {
        if (k === '_list' && Array.isArray(v)) { out.push(...v); continue; }
        out.push(k);
      }
      return out;
    }
    return [];
  }

  // Extract a scalar value from either a string (brace-style) or a single-key object (set-style)
  function valOf(node) {
    if (node === null || node === undefined || node === false) return '';
    if (typeof node === 'string') return node;
    if (typeof node === 'object' && !Array.isArray(node)) return Object.keys(node)[0] || '';
    return String(node);
  }

  // Build interface → zone map from `security zones security-zone X { interfaces { ge-0/0/0.0; } }`
  function buildZoneMap(tree) {
    const map = {};
    const zones = tree.security && tree.security.zones && tree.security.zones['security-zone'];
    if (!zones || typeof zones !== 'object') return map;
    for (const [zone, zd] of Object.entries(zones)) {
      const ifs = (zd && zd.interfaces) ? Object.keys(zd.interfaces) : [];
      for (const ifkey of ifs) map[ifkey] = zone;
    }
    return map;
  }

  function analyze(tree) {
    const interfaces = tree.interfaces || {};
    const vlansBlock = tree.vlans || {};
    const routingInstances = tree['routing-instances'] || {};
    const globalProtos = tree.protocols || {};

    const aggMap = {};
    for (const [ifname, ifc] of Object.entries(interfaces)) {
      if (!ifc || typeof ifc !== 'object') continue;
      const opts = ifc['gigether-options'] || ifc['ether-options'] || ifc['fastether-options'] || ifc['xe-options'];
      if (opts && opts['802.3ad']) {
        const lag = opts['802.3ad'];
        const ae = typeof lag === 'string' ? lag : (typeof lag === 'object' ? Object.keys(lag)[0] : null);
        if (ae) (aggMap[ae] = aggMap[ae] || []).push(ifname);
      }
    }

    const aggregates = Object.entries(aggMap).map(([ae, members]) => {
      const ifc = interfaces[ae] || {};
      const aeOpts = ifc['aggregated-ether-options'] || {};
      const lacp = aeOpts.lacp || {};
      const minLinks = valOf(aeOpts['minimum-links']);
      const speed = valOf(aeOpts['link-speed']);
      const lacpMode = lacp.active ? 'active' : (lacp.passive ? 'passive' : (Object.keys(lacp).length ? 'configured' : '—'));
      const periodic = typeof lacp.periodic === 'string' ? lacp.periodic : (lacp.periodic ? Object.keys(lacp.periodic)[0] : null);
      return { name: ae, members, lacpMode, periodic, minLinks, speed, description: valOf(ifc.description) };
    });

    const logicalUnits = [];
    for (const [ifname, ifc] of Object.entries(interfaces)) {
      if (!ifc || typeof ifc !== 'object') continue;
      const isAgg = /^(ae|reth)\d+$/.test(ifname);
      const isIrb = /^(irb|vlan)$/.test(ifname);
      const members = aggMap[ifname] || [];
      const units = ifc.unit || {};
      const ifDesc = valOf(ifc.description);
      for (const [unitId, unit] of Object.entries(units)) {
        if (!unit || typeof unit !== 'object') continue;
        const u = {
          parent: ifname,
          unit: unitId,
          ifkey: `${ifname}.${unitId}`,
          isAgg, isIrb, members,
          description: valOf(unit.description) || ifDesc,
        };
        if (unit['vlan-id']) u.vlanId = valOf(unit['vlan-id']);
        if (unit.encapsulation) u.encapsulation = valOf(unit.encapsulation);
        const ethsw = (unit.family && (unit.family['ethernet-switching'] || unit.family['bridge'])) || null;
        if (ethsw) {
          u.mode = valOf(ethsw['interface-mode'] || ethsw['port-mode']) || 'access';
          if (ethsw.vlan) {
            const vmem = ethsw.vlan.members ?? ethsw.vlan;
            if (Array.isArray(vmem)) u.vlanMembers = vmem;
            else if (typeof vmem === 'string') u.vlanMembers = [vmem];
            else if (typeof vmem === 'object') u.vlanMembers = asList(vmem);
          }
        }
        const fam = unit.family || {};
        u.families = Object.keys(fam);
        u.ipv4 = extractAddrs(fam.inet && fam.inet.address);
        u.ipv6 = extractAddrs(fam.inet6 && fam.inet6.address);
        logicalUnits.push(u);
      }
    }

    const vlans = [];
    for (const [name, v] of Object.entries(vlansBlock)) {
      if (!v || typeof v !== 'object') continue;
      const id = valOf(v['vlan-id']);
      const l3 = valOf(v['l3-interface']);
      const desc = valOf(v.description);
      const members = logicalUnits
        .filter(u => u.vlanMembers && (u.vlanMembers.includes(name) || (id && u.vlanMembers.includes(id))))
        .map(u => ({ ifkey: u.ifkey, mode: u.mode || '' }));
      const accessUnits = logicalUnits.filter(u => u.vlanId === id && id).map(u => ({ ifkey: u.ifkey, mode: 'access (vlan-id)' }));
      vlans.push({ name, id, l3Interface: l3, description: desc, members: [...members, ...accessUnits] });
    }

    function summarizeProtocols(protos) {
      const out = [];
      if (!protos || typeof protos !== 'object') return out;
      if (protos.ospf) {
        const areas = Object.entries(protos.ospf.area || {}).map(([a, ad]) => ({ area: a, interfaces: Object.keys(ad.interface || {}) }));
        out.push({ proto: 'ospf', areas });
      }
      if (protos['ospf3']) {
        const areas = Object.entries(protos['ospf3'].area || {}).map(([a, ad]) => ({ area: a, interfaces: Object.keys(ad.interface || {}) }));
        out.push({ proto: 'ospf3', areas });
      }
      if (protos.bgp) {
        const groups = Object.entries(protos.bgp.group || {}).map(([gn, g]) => ({
          name: gn,
          type: valOf(g.type),
          peerAs: valOf(g['peer-as']),
          localAs: valOf(g['local-as']),
          neighbors: Object.keys(g.neighbor || {}),
        }));
        out.push({ proto: 'bgp', groups });
      }
      for (const p of ['isis', 'ldp', 'rsvp', 'mpls', 'pim', 'router-advertisement']) {
        if (protos[p]) out.push({ proto: p, interfaces: Object.keys(protos[p].interface || {}) });
      }
      return out;
    }

    const vrfs = [{
      name: 'master (default)', type: 'default', rd: '', vrfTarget: '',
      interfaces: [], protocols: summarizeProtocols(globalProtos),
    }];
    for (const [name, ri] of Object.entries(routingInstances)) {
      if (!ri || typeof ri !== 'object') continue;
      const type = valOf(ri['instance-type']) || 'unknown';
      const rd = typeof ri['route-distinguisher'] === 'string'
        ? ri['route-distinguisher']
        : (ri['route-distinguisher'] ? Object.keys(ri['route-distinguisher'])[0] : '');
      const vt = typeof ri['vrf-target'] === 'string'
        ? ri['vrf-target']
        : (ri['vrf-target'] ? Object.keys(ri['vrf-target'])[0] : '');
      vrfs.push({
        name, type, rd, vrfTarget: vt,
        interfaces: Object.keys(ri.interface || {}),
        protocols: summarizeProtocols(ri.protocols || {}),
        description: valOf(ri.description),
      });
    }

    const unitToVrf = {};
    for (const vrf of vrfs) for (const iface of vrf.interfaces) unitToVrf[iface] = vrf.name;
    for (const u of logicalUnits) {
      u.vrf = unitToVrf[u.ifkey] || ((u.ipv4.length || u.ipv6.length) ? 'master (default)' : '');
      if (u.vrf === 'master (default)' && (u.ipv4.length || u.ipv6.length)) {
        const def = vrfs[0];
        if (!def.interfaces.includes(u.ifkey)) def.interfaces.push(u.ifkey);
      }
    }

    // Firewall: security policies + firewall filters
    const firewallRules = [];
    const zoneMap = buildZoneMap(tree);
    const polRoot = tree.security && tree.security.policies;
    if (polRoot && typeof polRoot === 'object') {
      for (const [k, v] of Object.entries(polRoot)) {
        // pattern: from-zone X to-zone Y { policy NAME { match {...} then {...} } }
        if (k !== 'from-zone' || typeof v !== 'object') continue;
        for (const [fz, toBlock] of Object.entries(v)) {
          if (!toBlock || typeof toBlock !== 'object' || !toBlock['to-zone']) continue;
          for (const [tz, policies] of Object.entries(toBlock['to-zone'])) {
            if (!policies.policy || typeof policies.policy !== 'object') continue;
            for (const [polName, pol] of Object.entries(policies.policy)) {
              const match = pol.match || {};
              const then = pol.then || {};
              const action = then.permit ? 'permit' : (then.deny ? 'deny' : (then.reject ? 'reject' : '—'));
              firewallRules.push({
                id: polName, name: polName,
                fromZone: fz, toZone: tz,
                sourceIntf: '', destIntf: '',
                source: asList(match['source-address']).join(', ') || 'any',
                destination: asList(match['destination-address']).join(', ') || 'any',
                service: asList(match.application).join(', ') || (match['source-port'] || match['destination-port'] ? 'port-match' : 'any'),
                action,
                log: !!then.log,
                description: typeof pol.description === 'string' ? pol.description : '',
              });
            }
          }
        }
      }
    }
    // firewall filters (stateless)
    const filters = tree.firewall && tree.firewall.filter;
    if (filters && typeof filters === 'object') {
      for (const [fname, f] of Object.entries(filters)) {
        if (!f.term || typeof f.term !== 'object') continue;
        for (const [tname, term] of Object.entries(f.term)) {
          const from = term.from || {};
          const then = term.then || {};
          const action = then.accept ? 'permit' : (then.discard ? 'deny' : (then.reject ? 'reject' : '—'));
          firewallRules.push({
            id: `${fname}.${tname}`, name: `${fname}/${tname}`,
            fromZone: 'filter', toZone: '',
            sourceIntf: '', destIntf: '',
            source: asList(from['source-address']).join(', ') || asList(from['source-prefix-list']).join(', ') || 'any',
            destination: asList(from['destination-address']).join(', ') || asList(from['destination-prefix-list']).join(', ') || 'any',
            service: (from.protocol ? `proto ${asList(from.protocol).join('/')}` : '') + (from['destination-port'] ? ` dport ${asList(from['destination-port']).join('/')}` : '') || 'any',
            action,
            log: !!then.log || !!then.syslog,
            description: '',
          });
        }
      }
    }

    // System block
    const sysTree = tree.system || {};
    const ntpSrv = (sysTree.ntp && sysTree.ntp.server) || {};
    const tacacs = (sysTree['tacplus-server'] || {});
    const radius = (sysTree['radius-server'] || {});
    const syslogHosts = (sysTree.syslog && sysTree.syslog.host) || {};
    const snmpCommunities = (tree.snmp && tree.snmp.community) || {};
    const snmpClients = (tree.snmp && tree.snmp.client) || {};
    const loginUsers = (sysTree.login && sysTree.login.user) || {};
    const system = {
      domain: valOf(sysTree['domain-name']),
      dns: asList(sysTree['name-server']).map(s => ({ server: s, vrf: '' })),
      ntp: Object.keys(ntpSrv).map(s => ({ server: s, vrf: '', prefer: !!(ntpSrv[s] && ntpSrv[s].prefer), key: valOf(ntpSrv[s] && ntpSrv[s].key) })),
      aaa: {
        newModel: !!(sysTree['authentication-order'] || tacacs || radius),
        tacacs: Object.keys(tacacs).map(h => ({ host: h, name: '', key: tacacs[h] && tacacs[h].secret ? '***' : '', vrf: '', port: valOf(tacacs[h] && tacacs[h].port) })),
        radius: Object.keys(radius).map(h => ({ host: h, name: '', authPort: '', acctPort: '', vrf: '', key: radius[h] && radius[h].secret ? '***' : '' })),
        methods: asList(sysTree['authentication-order']),
      },
      snmp: {
        communities: Object.keys(snmpCommunities).map(n => ({ name: n, access: valOf(snmpCommunities[n] && snmpCommunities[n].authorization) || 'read-only' })),
        hosts: Object.keys(snmpClients).map(h => ({ host: h, version: '', community: '' })),
        users: [],
      },
      syslog: Object.keys(syslogHosts).map(h => ({ host: h, vrf: '', severity: '', transport: '' })),
      users: Object.entries(loginUsers).map(([n, u]) => ({ name: n, privilege: valOf(u && u.class) })),
      banner: (sysTree.login && sysTree.login.message) ? 'login' : '',
      features: [], nbm: { enabled: false, flowPolicies: [] }, vpc: null, fex: [], peerLinks: [],
    };

    return {
      vendor: 'junos',
      aggregates, logicalUnits, vlans, vrfs, firewallRules, system,
      counts: {
        physicals: Object.keys(interfaces).filter(n => !/^(ae|reth|irb|vlan|lo|fxp|me|em|fab|cbp|pip|pp|pfh|pfe)\d*$/.test(n)).length,
        aggregates: aggregates.length,
        logicalUnits: logicalUnits.length,
        vlans: vlans.length,
        vrfs: vrfs.length - 1,
        firewallRules: firewallRules.length,
        hostname: tree.system ? valOf(tree.system['host-name']) : '',
        ntp: system.ntp.length,
        tacacs: system.aaa.tacacs.length,
        radius: system.aaa.radius.length,
        syslog: system.syslog.length,
        features: 0, fex: 0,
      },
    };
  }

  function detect(text) {
    let score = 0;
    if (/^\s*(interfaces|protocols|routing-instances|security|system|firewall)\s*\{/m.test(text)) score += 60;
    if (/^\s*set\s+(interfaces|protocols|routing-instances|security|system)\s/m.test(text)) score += 60;
    if (/\bae\d+\b/.test(text)) score += 10;
    if (/\bge-\d+\/\d+\/\d+\b/.test(text)) score += 15;
    if (/\bfamily\s+(inet|ethernet-switching|mpls)/.test(text)) score += 15;
    if (/\bvrf-target\s+target:/.test(text)) score += 10;
    return Math.min(score, 100);
  }

  window.ConfigParser_Junos = {
    name: 'JUNOS',
    detect,
    parse(text) { return analyze(parseTree(text)); },
    sample: `system {
    host-name srx-edge-01;
    domain-name lab.local;
    name-server {
        8.8.8.8;
        1.1.1.1;
    }
    authentication-order [ tacplus password ];
    tacplus-server {
        10.10.10.10 { secret "$9$xxxxxx"; port 49; }
        10.10.10.11 { secret "$9$xxxxxx"; }
    }
    radius-server {
        10.10.20.10 { secret "$9$xxxxxx"; }
    }
    login {
        user admin { class super-user; }
        user netops { class operator; }
        message "Authorized access only";
    }
    ntp {
        server 10.1.1.1 prefer;
        server 10.1.1.2;
    }
    syslog {
        host 10.10.30.10 { any info; }
        host 10.10.30.11 { any warning; }
    }
}
snmp {
    community RO-COMMUNITY { authorization read-only; }
    client-list MGMT-NETS;
}
interfaces {
    ge-0/0/0 {
        description "WAN uplink";
        unit 0 {
            family inet { address 203.0.113.2/30; }
        }
    }
    ge-0/0/1 {
        description "LAN trunk";
        gigether-options { 802.3ad ae0; }
    }
    ge-0/0/2 {
        gigether-options { 802.3ad ae0; }
    }
    ae0 {
        description "LAN bundle";
        aggregated-ether-options {
            minimum-links 1;
            lacp { active; periodic fast; }
        }
        unit 0 {
            family ethernet-switching {
                interface-mode trunk;
                vlan { members [ v100 v200 ]; }
            }
        }
    }
    irb {
        unit 100 {
            family inet { address 192.168.100.1/24; }
        }
        unit 200 {
            family inet { address 192.168.200.1/24; }
        }
    }
}
vlans {
    v100 { vlan-id 100; l3-interface irb.100; }
    v200 { vlan-id 200; l3-interface irb.200; }
}
routing-instances {
    CUSTOMER-A {
        instance-type vrf;
        interface ae0.100;
        route-distinguisher 65000:100;
        vrf-target target:65000:100;
        protocols {
            bgp { group CE { type external; peer-as 65100; neighbor 10.100.0.2; } }
        }
    }
}
protocols {
    ospf { area 0.0.0.0 { interface ge-0/0/0.0; } }
    bgp  { group iBGP { type internal; local-address 10.255.0.1; neighbor 10.255.0.2; } }
}
security {
    zones {
        security-zone trust {
            interfaces { irb.100; irb.200; }
        }
        security-zone untrust {
            interfaces { ge-0/0/0.0; }
        }
    }
    policies {
        from-zone trust to-zone untrust {
            policy permit-web {
                match {
                    source-address any;
                    destination-address any;
                    application [ junos-http junos-https junos-dns-udp ];
                }
                then { permit; log { session-init; } }
            }
            policy deny-all {
                match { source-address any; destination-address any; application any; }
                then { deny; log { session-init; } }
            }
        }
    }
}
firewall {
    filter PROTECT-RE {
        term allow-ssh {
            from { source-prefix-list MGMT-NETS; protocol tcp; destination-port ssh; }
            then accept;
        }
        term drop-rest { then discard; }
    }
}`,
    sampleSet: `## Last changed: 2024-01-15 10:30:00 UTC
set system host-name srx-edge-01
set system domain-name lab.local
set system name-server 8.8.8.8
set system name-server 1.1.1.1
set system authentication-order tacplus
set system authentication-order password
set system tacplus-server 10.10.10.10 secret "$9$xxxxxx"
set system tacplus-server 10.10.10.10 port 49
set system tacplus-server 10.10.10.11 secret "$9$xxxxxx"
set system radius-server 10.10.20.10 secret "$9$xxxxxx"
set system login user admin class super-user
set system login user netops class operator
set system login message "Authorized access only"
set system ntp server 10.1.1.1 prefer
set system ntp server 10.1.1.2
set system syslog host 10.10.30.10 any info
set system syslog host 10.10.30.11 any warning
set snmp community RO-COMMUNITY authorization read-only
set interfaces ge-0/0/0 description "WAN uplink"
set interfaces ge-0/0/0 unit 0 family inet address 203.0.113.2/30
set interfaces ge-0/0/1 description "LAN trunk"
set interfaces ge-0/0/1 gigether-options 802.3ad ae0
set interfaces ge-0/0/2 gigether-options 802.3ad ae0
set interfaces ae0 description "LAN bundle"
set interfaces ae0 aggregated-ether-options minimum-links 1
set interfaces ae0 aggregated-ether-options lacp active
set interfaces ae0 aggregated-ether-options lacp periodic fast
set interfaces ae0 unit 0 family ethernet-switching interface-mode trunk
set interfaces ae0 unit 0 family ethernet-switching vlan members v100
set interfaces ae0 unit 0 family ethernet-switching vlan members v200
set interfaces irb unit 100 family inet address 192.168.100.1/24
set interfaces irb unit 200 family inet address 192.168.200.1/24
set vlans v100 vlan-id 100
set vlans v100 l3-interface irb.100
set vlans v200 vlan-id 200
set vlans v200 l3-interface irb.200
set routing-instances CUSTOMER-A instance-type vrf
set routing-instances CUSTOMER-A interface ae0.100
set routing-instances CUSTOMER-A route-distinguisher 65000:100
set routing-instances CUSTOMER-A vrf-target target:65000:100
set routing-instances CUSTOMER-A protocols bgp group CE type external
set routing-instances CUSTOMER-A protocols bgp group CE peer-as 65100
set routing-instances CUSTOMER-A protocols bgp group CE neighbor 10.100.0.2
set protocols ospf area 0.0.0.0 interface ge-0/0/0.0
set protocols bgp group iBGP type internal
set protocols bgp group iBGP local-address 10.255.0.1
set protocols bgp group iBGP neighbor 10.255.0.2
set security zones security-zone trust interfaces irb.100
set security zones security-zone trust interfaces irb.200
set security zones security-zone untrust interfaces ge-0/0/0.0
set security policies from-zone trust to-zone untrust policy permit-web match source-address any
set security policies from-zone trust to-zone untrust policy permit-web match destination-address any
set security policies from-zone trust to-zone untrust policy permit-web match application junos-http
set security policies from-zone trust to-zone untrust policy permit-web then permit
set security policies from-zone trust to-zone untrust policy deny-all match source-address any
set security policies from-zone trust to-zone untrust policy deny-all match destination-address any
set security policies from-zone trust to-zone untrust policy deny-all match application any
set security policies from-zone trust to-zone untrust policy deny-all then deny
set firewall filter PROTECT-RE term allow-ssh from protocol tcp
set firewall filter PROTECT-RE term allow-ssh from destination-port ssh
set firewall filter PROTECT-RE term allow-ssh then accept
set firewall filter PROTECT-RE term drop-rest then discard`,
  };
})();
