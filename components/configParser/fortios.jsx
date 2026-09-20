// ConfigParser_FortiOS: { detect, parse, sample }
(function () {
  function parseTree(text) {
    const lines = text.split('\n').map(l => l.replace(/\r$/, '').trim()).filter(Boolean);
    const root = {};
    const stack = [{ type: 'root', node: root }];

    function getNode(name) {
      const top = stack[stack.length - 1].node;
      top[name] = top[name] || {};
      return top[name];
    }

    for (const ln of lines) {
      if (/^#/.test(ln)) continue;
      let m;
      if ((m = ln.match(/^config\s+(.+)$/i))) {
        const key = `config ${m[1]}`;
        const node = getNode(key);
        stack.push({ type: 'config', node, name: m[1] });
      } else if (/^end\b/i.test(ln)) {
        while (stack.length > 1 && stack[stack.length - 1].type !== 'config') stack.pop();
        if (stack.length > 1) stack.pop();
      } else if ((m = ln.match(/^edit\s+(.+)$/i))) {
        const rawName = m[1].trim().replace(/^"(.*)"$/, '$1');
        const parent = stack[stack.length - 1].node;
        parent.edits = parent.edits || {};
        parent.edits[rawName] = parent.edits[rawName] || {};
        stack.push({ type: 'edit', node: parent.edits[rawName], name: rawName });
      } else if (/^next\b/i.test(ln)) {
        while (stack.length > 1 && stack[stack.length - 1].type !== 'edit') stack.pop();
        if (stack.length > 1) stack.pop();
      } else if ((m = ln.match(/^set\s+(\S+)\s*(.*)$/i))) {
        const node = stack[stack.length - 1].node;
        node.sets = node.sets || {};
        const tokens = [];
        const re = /"([^"]*)"|(\S+)/g;
        let mm;
        while ((mm = re.exec(m[2]))) tokens.push(mm[1] !== undefined ? mm[1] : mm[2]);
        node.sets[m[1]] = tokens.length === 0 ? '' : (tokens.length === 1 ? tokens[0] : tokens);
      }
    }
    return root;
  }

  function asArr(v) {
    if (v === undefined || v === '') return [];
    return Array.isArray(v) ? v : [v];
  }

  function fmtIp(ipMask) {
    if (!ipMask) return '';
    if (Array.isArray(ipMask)) return ipMask.join(' ');
    return String(ipMask);
  }

  function analyze(text) {
    const tree = parseTree(text);

    const sysGlobal = tree['config system global'] || {};
    const hostname = (sysGlobal.sets && sysGlobal.sets.hostname) || '';

    const ifaceBlock = tree['config system interface'] || {};
    const ifaceEdits = ifaceBlock.edits || {};
    const zoneBlock = tree['config system zone'] || {};
    const zoneEdits = zoneBlock.edits || {};
    const vdomBlock = tree['config system vdom'] || {};
    const vdomEdits = vdomBlock.edits || {};
    const policyBlock = tree['config firewall policy'] || {};
    const policyEdits = policyBlock.edits || {};
    const bgpBlock = tree['config router bgp'] || {};
    const ospfBlock = tree['config router ospf'] || {};
    const staticBlock = tree['config router static'] || {};

    const logicalUnits = [];
    const aggregates = [];
    const vlans = [];
    const vlanIndex = {};

    for (const [name, e] of Object.entries(ifaceEdits)) {
      const s = e.sets || {};
      const type = s.type || (s.member ? 'aggregate' : (s.vlanid ? 'vlan' : 'physical'));
      const members = asArr(s.member);
      const vdom = s.vdom || '';
      const ip = fmtIp(s.ip);
      const ip6 = s.ip6 || '';
      const descr = s.description || s.alias || '';
      const parentIf = s.interface || name;
      const vlanid = s.vlanid ? String(s.vlanid) : '';

      const u = {
        parent: parentIf, unit: vlanid || '', ifkey: name,
        isAgg: type === 'aggregate' || type === 'redundant',
        isIrb: type === 'vlan',
        members,
        description: descr,
        vrf: vdom || 'root',
        mode: type === 'vlan' ? 'subif' : '',
        vlanId: vlanid,
        vlanMembers: [],
        ipv4: ip ? [ip] : [],
        ipv6: ip6 ? [ip6] : [],
        families: [],
      };
      if (u.ipv4.length) u.families.push('ipv4');
      if (u.ipv6.length) u.families.push('ipv6');
      logicalUnits.push(u);

      if (u.isAgg) {
        aggregates.push({
          name, members, lacpMode: s['lacp-mode'] || s['lacp-speed'] || (members.length ? 'on' : '—'),
          periodic: s['lacp-speed'] || '', minLinks: s['min-links'], speed: s.speed || '', description: descr,
        });
      }
      if (type === 'vlan' && vlanid) {
        const v = vlanIndex[vlanid] || (vlanIndex[vlanid] = { name: name, id: vlanid, l3Interface: name, description: descr, members: [] });
        // any access ports on the parent iface — best-effort
      }
    }

    // VLAN list
    for (const v of Object.values(vlanIndex)) vlans.push(v);

    // VDOMs as VRFs
    const vrfs = [];
    const seenVdom = new Set();
    if (Object.keys(vdomEdits).length === 0) seenVdom.add('root');
    for (const u of logicalUnits) if (u.vrf) seenVdom.add(u.vrf);
    for (const v of Object.keys(vdomEdits)) seenVdom.add(v);
    for (const v of seenVdom) {
      vrfs.push({
        name: v, type: v === 'root' ? 'default' : 'vdom',
        rd: '', vrfTarget: '',
        interfaces: logicalUnits.filter(u => u.vrf === v).map(u => u.ifkey),
        protocols: [], description: '',
      });
    }
    if (!vrfs.length) vrfs.push({ name: 'root', type: 'default', rd: '', vrfTarget: '', interfaces: logicalUnits.map(u => u.ifkey), protocols: [], description: '' });

    // BGP — flat: one or more `config neighbor` edits
    if (bgpBlock.sets && bgpBlock.sets.as) {
      const asN = bgpBlock.sets.as;
      const neighborsBlock = bgpBlock['config neighbor'] || {};
      const neighbors = Object.keys(neighborsBlock.edits || {});
      const defVrf = vrfs.find(v => v.type === 'default') || vrfs[0];
      if (defVrf) defVrf.protocols.push({ proto: 'bgp', groups: [{ name: `AS ${asN}`, type: '', peerAs: '', localAs: asN, neighbors }] });
    }
    if (ospfBlock.sets || ospfBlock['config area']) {
      const areas = Object.keys((ospfBlock['config area'] || {}).edits || {});
      const defVrf = vrfs.find(v => v.type === 'default') || vrfs[0];
      if (defVrf) defVrf.protocols.push({ proto: 'ospf', areas: areas.map(a => ({ area: a, interfaces: [] })) });
    }

    // Zones (sourceintf/dstintf references)
    const zoneMembers = {};
    for (const [zn, z] of Object.entries(zoneEdits)) {
      const ifs = asArr((z.sets && z.sets.interface) || []);
      zoneMembers[zn] = ifs;
    }

    // Firewall policies
    const firewallRules = [];
    const policyIds = Object.keys(policyEdits).sort((a, b) => Number(a) - Number(b));
    for (const id of policyIds) {
      const p = policyEdits[id];
      const s = p.sets || {};
      firewallRules.push({
        id,
        name: s.name || `policy-${id}`,
        fromZone: asArr(s.srcintf).join(', ') || 'any',
        toZone: asArr(s.dstintf).join(', ') || 'any',
        sourceIntf: asArr(s.srcintf).join(', '),
        destIntf: asArr(s.dstintf).join(', '),
        source: asArr(s.srcaddr).join(', ') || 'all',
        destination: asArr(s.dstaddr).join(', ') || 'all',
        service: asArr(s.service).join(', ') || 'ALL',
        action: s.action || 'accept',
        log: !!(s.logtraffic && s.logtraffic !== 'disable'),
        description: s.comments || '',
      });
    }

    // System block
    const ntpBlock = tree['config system ntp'] || {};
    const ntpServers = (ntpBlock['config ntpserver'] || {}).edits || {};
    const dnsBlock = tree['config system dns'] || {};
    const dnsSets = dnsBlock.sets || {};
    const tacBlock = (tree['config user tacacs+'] || {}).edits || {};
    const radBlock = (tree['config user radius'] || {}).edits || {};
    const syslogBlock = tree['config log syslogd setting'] || {};
    const syslogSets = syslogBlock.sets || {};
    const syslog2 = tree['config log syslogd2 setting'] || {};
    const adminBlock = (tree['config system admin'] || {}).edits || {};
    const snmpComm = (tree['config system snmp community'] || {}).edits || {};
    const snmpUser = (tree['config system snmp user'] || {}).edits || {};

    const system = {
      domain: (sysGlobal.sets && sysGlobal.sets['hostname']) ? '' : '',
      dns: [
        ...(dnsSets.primary ? [{ server: dnsSets.primary, vrf: '' }] : []),
        ...(dnsSets.secondary ? [{ server: dnsSets.secondary, vrf: '' }] : []),
      ],
      ntp: Object.entries(ntpServers).map(([id, e]) => ({ server: (e.sets && e.sets.server) || id, vrf: (e.sets && e.sets.interface) || '', prefer: false, key: '' })),
      aaa: {
        newModel: Object.keys(tacBlock).length > 0 || Object.keys(radBlock).length > 0,
        tacacs: Object.entries(tacBlock).map(([n, e]) => ({ host: (e.sets && e.sets.server) || '', name: n, key: e.sets && e.sets.key ? '***' : '', vrf: (e.sets && e.sets['source-ip']) || '', port: (e.sets && e.sets.port) || '' })),
        radius: Object.entries(radBlock).map(([n, e]) => ({ host: (e.sets && e.sets.server) || '', name: n, authPort: '', acctPort: '', vrf: (e.sets && e.sets['source-ip']) || '', key: e.sets && e.sets.secret ? '***' : '' })),
        methods: [],
      },
      snmp: {
        communities: Object.entries(snmpComm).map(([id, e]) => ({ name: (e.sets && e.sets.name) || id, access: 'RO' })),
        hosts: [],
        users: Object.entries(snmpUser).map(([n, e]) => ({ name: n, group: (e.sets && e.sets['security-level']) || '' })),
      },
      syslog: [
        ...(syslogSets.server ? [{ host: syslogSets.server, vrf: '', severity: syslogSets.severity || '', transport: syslogSets.mode || '' }] : []),
        ...((syslog2.sets && syslog2.sets.server) ? [{ host: syslog2.sets.server, vrf: '', severity: syslog2.sets.severity || '', transport: syslog2.sets.mode || '' }] : []),
      ],
      users: Object.entries(adminBlock).map(([n, e]) => ({ name: n, privilege: (e.sets && e.sets.accprofile) || '' })),
      banner: '',
      features: [], nbm: { enabled: false, flowPolicies: [] }, vpc: null, fex: [], peerLinks: [],
    };

    return {
      vendor: 'fortios',
      aggregates, logicalUnits, vlans, vrfs, firewallRules, system,
      counts: {
        hostname,
        physicals: logicalUnits.filter(u => !u.isAgg && !u.isIrb).length,
        aggregates: aggregates.length,
        logicalUnits: logicalUnits.length,
        vlans: vlans.length,
        vrfs: vrfs.length - (vrfs.find(v => v.type === 'default') ? 1 : 0),
        firewallRules: firewallRules.length,
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
    if (/^config\s+(system|firewall|router|vpn)\b/m.test(text)) score += 50;
    if (/^\s*edit\s+/m.test(text) && /^\s*next\b/m.test(text)) score += 30;
    if (/^\s*set\s+vdom\s+/m.test(text)) score += 15;
    if (/^config\s+firewall\s+policy/m.test(text)) score += 20;
    if (/\bset\s+(srcintf|dstintf|srcaddr|dstaddr)\b/.test(text)) score += 15;
    return Math.min(score, 100);
  }

  window.ConfigParser_FortiOS = {
    name: 'FortiOS',
    detect,
    parse(text) { return analyze(text); },
    sample: `config system global
    set hostname "FGT-EDGE-01"
end
config system dns
    set primary 8.8.8.8
    set secondary 1.1.1.1
end
config system ntp
    set ntpsync enable
    config ntpserver
        edit 1
            set server "10.1.1.1"
        next
        edit 2
            set server "10.1.1.2"
        next
    end
end
config user tacacs+
    edit "PRIMARY-TAC"
        set server "10.10.10.10"
        set key ENC xxxxxxxxxxxx
        set authen-type auto
    next
end
config user radius
    edit "NPS-01"
        set server "10.10.20.10"
        set secret ENC xxxxxxxxxxxx
    next
end
config log syslogd setting
    set status enable
    set server "10.10.30.10"
end
config system admin
    edit "admin"
        set accprofile "super_admin"
    next
    edit "netops"
        set accprofile "read_only"
    next
end
config system snmp community
    edit 1
        set name "RO-COMMUNITY"
    next
end
config system interface
    edit "port1"
        set vdom "root"
        set ip 203.0.113.2 255.255.255.252
        set description "WAN"
        set type physical
    next
    edit "port3"
        set vdom "root"
        set type physical
    next
    edit "port4"
        set vdom "root"
        set type physical
    next
    edit "lan-agg"
        set vdom "root"
        set type aggregate
        set member "port3" "port4"
        set lacp-mode active
        set min-links 1
    next
    edit "vlan100"
        set vdom "root"
        set type vlan
        set interface "lan-agg"
        set vlanid 100
        set ip 192.168.100.1 255.255.255.0
        set description "USERS"
    next
    edit "vlan200"
        set vdom "CUST-A"
        set type vlan
        set interface "lan-agg"
        set vlanid 200
        set ip 192.168.200.1 255.255.255.0
        set description "TENANT"
    next
end
config system vdom
    edit "root"
    next
    edit "CUST-A"
    next
end
config system zone
    edit "trust"
        set interface "vlan100"
    next
    edit "untrust"
        set interface "port1"
    next
end
config firewall policy
    edit 1
        set name "allow-web"
        set srcintf "vlan100"
        set dstintf "port1"
        set srcaddr "all"
        set dstaddr "all"
        set service "HTTP" "HTTPS" "DNS"
        set action accept
        set schedule "always"
        set logtraffic all
        set nat enable
    next
    edit 2
        set name "deny-all"
        set srcintf "any"
        set dstintf "any"
        set srcaddr "all"
        set dstaddr "all"
        set service "ALL"
        set action deny
        set logtraffic all
    next
end
config router bgp
    set as 65000
    config neighbor
        edit "10.255.0.2"
            set remote-as 65000
        next
        edit "10.255.0.3"
            set remote-as 65000
        next
    end
end
config router ospf
    set router-id 10.255.0.1
    config area
        edit 0.0.0.0
        next
    end
end`,
  };
})();
