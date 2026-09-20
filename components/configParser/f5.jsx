// ConfigParser_F5: BIG-IP TMSH (tmos) brace-style configuration
(function () {
  function detect(text) {
    let score = 0;
    if (/^(net|ltm|sys|security)\s+\S+\s+\S+\s*\{/m.test(text)) score += 50;
    if (/^net\s+(interface|trunk|vlan|self|route-domain)\s+\S+/m.test(text)) score += 30;
    if (/^ltm\s+(pool|virtual|node)\s+\S+/m.test(text)) score += 25;
    if (/^sys\s+(ntp|dns|snmp|syslog)\b/m.test(text)) score += 15;
    if (/^security\s+firewall\s+/m.test(text)) score += 15;
    return Math.min(score, 100);
  }

  function tokenize(text) {
    const out = [];
    const s = text.replace(/#.*$/gm, '');
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '{' || c === '}') { out.push(c); i++; continue; }
      if (c === '"') {
        let e = i + 1;
        while (e < s.length && s[e] !== '"') e++;
        out.push(s.slice(i + 1, e)); i = e + 1; continue;
      }
      let e = i;
      while (e < s.length && !/[\s{}]/.test(s[e])) e++;
      out.push(s.slice(i, e)); i = e;
    }
    return out;
  }

  function parseBlock(tokens, p) {
    // Returns [node, newPos]. Node is an object where each statement is { headerTokens, body? }.
    // We don't enforce semicolons (TMSH uses newlines/blocks).
    const node = {};
    while (p < tokens.length) {
      if (tokens[p] === '}') return [node, p + 1];
      const path = [];
      while (p < tokens.length && tokens[p] !== '{' && tokens[p] !== '}') { path.push(tokens[p]); p++; }
      if (p >= tokens.length) break;
      if (tokens[p] === '{') {
        const [child, np] = parseBlock(tokens, p + 1);
        // Use the joined path as the key
        const key = path.join(' ');
        if (key) node[key] = child;
        p = np;
      } else if (tokens[p] === '}') {
        // Statement-only (no block)
        if (path.length === 1) node[path[0]] = true;
        else if (path.length >= 2) {
          const k = path[0];
          node[k] = node[k] || {};
          // Set nested as a chain
          let cur = node[k];
          for (let i = 1; i < path.length - 1; i++) { cur[path[i]] = cur[path[i]] || {}; cur = cur[path[i]]; }
          cur[path[path.length - 1]] = true;
        }
        return [node, p + 1];
      }
    }
    return [node, p];
  }

  function parseTmsh(text) {
    const tokens = tokenize(text);
    const [root] = parseBlock(tokens, 0);
    return root;
  }

  function asList(node) {
    if (!node) return [];
    if (typeof node === 'string') return [node];
    if (typeof node === 'object') return Object.keys(node);
    return [];
  }

  function analyze(text) {
    const tree = parseTmsh(text);

    const hostname = tree['sys global-settings'] && tree['sys global-settings']['hostname']
      ? Object.keys(tree['sys global-settings']['hostname'])[0]
      : (tree['sys hostname'] ? Object.keys(tree['sys hostname'])[0] : '');

    // net interface NAME { ... }
    const interfaces = {};
    const trunks = {};
    const vlans = {};
    const selfIps = []; // { name, address, vlan }
    const rdomains = {};
    for (const [k, v] of Object.entries(tree)) {
      const parts = k.split(' ');
      if (parts[0] === 'net' && parts[1] === 'interface' && parts[2]) interfaces[parts[2]] = v;
      else if (parts[0] === 'net' && parts[1] === 'trunk' && parts[2]) trunks[parts[2]] = v;
      else if (parts[0] === 'net' && parts[1] === 'vlan' && parts[2]) vlans[parts[2]] = v;
      else if (parts[0] === 'net' && parts[1] === 'self' && parts[2]) {
        const addr = v && v.address ? Object.keys(v.address)[0] : '';
        const vlanRef = v && v.vlan ? Object.keys(v.vlan)[0] : '';
        selfIps.push({ name: parts[2], address: addr, vlan: vlanRef });
      }
      else if (parts[0] === 'net' && parts[1] === 'route-domain' && parts[2]) rdomains[parts[2]] = v;
    }

    const logicalUnits = [];
    for (const [name, def] of Object.entries(interfaces)) {
      const desc = def && def.description ? Object.keys(def.description)[0] : '';
      logicalUnits.push({
        parent: name, unit: '', ifkey: name,
        isAgg: false, isIrb: false, members: [],
        description: desc, vrf: '', mode: '',
        vlanId: '', vlanMembers: [],
        ipv4: [], ipv6: [], families: [],
      });
    }
    const aggregates = Object.entries(trunks).map(([name, def]) => ({
      name, members: def && def.interfaces ? asList(def.interfaces) : [],
      lacpMode: (def && def.lacp && Object.keys(def.lacp)[0] === 'enabled') ? 'active' : '—',
      periodic: '', minLinks: undefined, speed: '',
      description: def && def.description ? Object.keys(def.description)[0] : '',
    }));
    // Trunks are interfaces too
    for (const [name, def] of Object.entries(trunks)) {
      logicalUnits.push({
        parent: name, unit: '', ifkey: name,
        isAgg: true, isIrb: false, members: def && def.interfaces ? asList(def.interfaces) : [],
        description: def && def.description ? Object.keys(def.description)[0] : '',
        vrf: '', mode: '', vlanId: '', vlanMembers: [],
        ipv4: [], ipv6: [], families: [],
      });
    }

    // VLANs with tag + member interfaces
    const vlanOut = [];
    for (const [vname, def] of Object.entries(vlans)) {
      const tag = def && def.tag ? Object.keys(def.tag)[0] : '';
      const ifsBlock = def && def.interfaces ? def.interfaces : {};
      const members = [];
      for (const [ifname, ifdef] of Object.entries(ifsBlock)) {
        const tagged = ifdef && ifdef.tagged ? 'trunk' : 'access';
        members.push({ ifkey: ifname, mode: tagged });
      }
      vlanOut.push({
        name: vname, id: tag, l3Interface: `vlan-${vname}`,
        description: def && def.description ? Object.keys(def.description)[0] : '',
        members,
      });
      // Create SVI logical unit if self-IP exists for this vlan
      const selfFor = selfIps.find(s => s.vlan === vname);
      if (selfFor) {
        logicalUnits.push({
          parent: `vlan-${vname}`, unit: tag || '', ifkey: `vlan-${vname}`,
          isAgg: false, isIrb: true, members: [],
          description: vname, vrf: '', mode: 'svi',
          vlanId: tag, vlanMembers: [],
          ipv4: [selfFor.address], ipv6: [], families: ['ipv4'],
        });
      }
    }

    // Route-domains as VRFs
    const vrfs = [{ name: 'default (rd0)', type: 'default', rd: '', vrfTarget: '', interfaces: [], protocols: [], description: '' }];
    for (const [rdId, def] of Object.entries(rdomains)) {
      const vlansInRd = def && def.vlans ? asList(def.vlans) : [];
      const ifsInRd = vlansInRd.map(v => `vlan-${v}`);
      vrfs.push({ name: `rd${rdId}`, type: 'route-domain', rd: rdId, vrfTarget: '', interfaces: ifsInRd, protocols: [], description: '' });
    }
    for (const u of logicalUnits) {
      if (u.ipv4.length || u.ipv6.length) {
        for (const v of vrfs) if (v.interfaces.includes(u.ifkey)) { u.vrf = v.name; break; }
        if (!u.vrf) { u.vrf = vrfs[0].name; if (!vrfs[0].interfaces.includes(u.ifkey)) vrfs[0].interfaces.push(u.ifkey); }
      }
    }

    // Firewall — TMSH `security firewall rule-list NAME { rules { ... } }`
    const firewallRules = [];
    const fwRoot = Object.entries(tree).filter(([k]) => /^security firewall (?:rule-list|policy)\b/.test(k));
    for (const [k, v] of fwRoot) {
      const polName = k.split(' ').slice(-1)[0];
      const rules = (v && v.rules) ? v.rules : {};
      let i = 0;
      for (const [rname, r] of Object.entries(rules)) {
        i++;
        const src = r && r.source && r.source.addresses ? asList(r.source.addresses).join(', ') : 'any';
        const dst = r && r.destination && r.destination.addresses ? asList(r.destination.addresses).join(', ') : 'any';
        const svcParts = [];
        if (r && r.ip_protocol) svcParts.push(Object.keys(r.ip_protocol)[0]);
        if (r && r.destination && r.destination.ports) svcParts.push(`port ${asList(r.destination.ports).join(',')}`);
        const action = r && r.action ? Object.keys(r.action)[0] : 'allow';
        firewallRules.push({
          id: `${polName}:${i}`, name: rname,
          fromZone: polName, toZone: '',
          sourceIntf: '', destIntf: '',
          source: src, destination: dst,
          service: svcParts.join(' ') || 'any',
          action, log: !!(r && r.log), description: '',
        });
      }
    }

    // System
    const ntpBlock = tree['sys ntp'] || {};
    const dnsBlock = tree['sys dns'] || {};
    const snmpBlock = tree['sys snmp'] || {};
    const tacBlock = tree['auth tacacs system-auth'] || tree['auth tacacs'] || null;
    const syslogBlock = tree['sys syslog'] || {};

    const ntp = ntpBlock.servers ? asList(ntpBlock.servers).map(s => ({ server: s, vrf: '', prefer: false, key: '' })) : [];
    const dns = dnsBlock['name-servers'] ? asList(dnsBlock['name-servers']).map(s => ({ server: s, vrf: '' })) : [];
    const snmpComms = [];
    if (snmpBlock.communities) for (const [_, c] of Object.entries(snmpBlock.communities)) {
      const name = c && c['community-name'] ? Object.keys(c['community-name'])[0] : (c && Object.keys(c)[0]) || '';
      if (name) snmpComms.push({ name, access: 'RO' });
    }
    const tacacs = [];
    if (tacBlock && tacBlock.servers) for (const s of asList(tacBlock.servers)) tacacs.push({ host: s, name: '', key: '***', vrf: '', port: '' });

    const system = {
      domain: '', dns, ntp,
      aaa: { newModel: tacacs.length > 0, tacacs, radius: [], methods: [] },
      snmp: { communities: snmpComms, hosts: [], users: [] },
      syslog: [], users: [], banner: '',
      features: [], nbm: { enabled: false, flowPolicies: [] }, vpc: null, fex: [], peerLinks: [],
    };
    // remote syslog
    if (syslogBlock['remote-servers']) {
      for (const [_, rs] of Object.entries(syslogBlock['remote-servers'])) {
        const host = rs && rs.host ? Object.keys(rs.host)[0] : '';
        if (host) system.syslog.push({ host, vrf: '', severity: '', transport: '' });
      }
    }

    return {
      vendor: 'f5-tmos',
      aggregates, logicalUnits, vlans: vlanOut, vrfs, firewallRules, system,
      counts: {
        hostname,
        physicals: Object.keys(interfaces).length,
        aggregates: aggregates.length, logicalUnits: logicalUnits.length,
        vlans: vlanOut.length, vrfs: vrfs.length - 1, firewallRules: firewallRules.length,
        ntp: system.ntp.length, tacacs: system.aaa.tacacs.length, radius: system.aaa.radius.length, syslog: system.syslog.length, features: 0, fex: 0,
      },
    };
  }

  window.ConfigParser_F5 = {
    name: 'F5 BIG-IP (TMSH)',
    detect, parse(text) { return analyze(text); },
    sample: `sys global-settings {
    hostname f5-bigip-01
}
sys ntp {
    servers { 10.1.1.1 10.1.1.2 }
}
sys dns {
    name-servers { 8.8.8.8 1.1.1.1 }
}
auth tacacs system-auth {
    servers { 10.10.10.10 }
}
sys snmp {
    communities {
        comm-1 { community-name RO-COMMUNITY }
    }
}
sys syslog {
    remote-servers {
        rs-1 { host 10.10.30.10 }
    }
}
net interface 1.1 {
    description "spine-1"
}
net interface 1.2 {
    description "spine-2"
}
net trunk core-trunk {
    interfaces {
        1.1
        1.2
    }
    lacp enabled
    description "core LAG"
}
net vlan vlan100 {
    interfaces {
        core-trunk { tagged }
    }
    tag 100
    description "USERS"
}
net vlan vlan200 {
    interfaces {
        core-trunk { tagged }
    }
    tag 200
    description "TENANT"
}
net self self-100 {
    address 192.168.100.1/24
    vlan vlan100
}
net self self-200 {
    address 192.168.200.1/24
    vlan vlan200
}
net route-domain 100 {
    id 100
    vlans { vlan200 }
}
security firewall rule-list MGMT-IN {
    rules {
        allow-ssh {
            ip_protocol tcp
            source { addresses { 10.0.0.0/8 } }
            destination { addresses { any } ports { 22 } }
            action accept
            log enabled
        }
        deny-all {
            action drop
            log enabled
        }
    }
}`,
  };
})();
