// ConfigParser_Cisco: { detect, parse, sample } — covers IOS, IOS-XE, NX-OS, IOS-XR
(function () {
  // Parse into top-level sections by indent. Each section = { header, lines, subs }
  // where lines are first-level child lines and subs are deeper-indented groups.
  function parseSections(text) {
    const rawLines = text.split('\n').map(l => l.replace(/\r$/, ''));
    const sections = [];
    let cur = null;
    for (const line of rawLines) {
      if (!line.trim() || /^\s*!/.test(line) || /^\s*#/.test(line)) continue;
      const indent = line.match(/^(\s*)/)[1].length;
      const body = line.trim();
      if (/^(end|exit|exit-address-family)\b/.test(body)) { if (indent === 0) cur = null; continue; }
      if (indent === 0) {
        cur = { header: body, lines: [], subs: {} };
        sections.push(cur);
      } else if (cur) {
        // Allow nested sub-blocks (e.g. `address-family ipv4 unicast` inside `router bgp`)
        cur.lines.push(body);
      }
    }
    return sections;
  }

  // Expand a Cisco VLAN list into individual IDs.
  // Handles: "300-310", "100,200", "10,20-25,30", "all", "none", "add 300-310"
  // Returns an array of string IDs (e.g. ['300','301',...,'310']).
  function expandVlanList(spec) {
    const out = [];
    const parts = String(spec || '').split(',').map(s => s.trim()).filter(Boolean);
    for (const p of parts) {
      const r = p.match(/^(\d+)-(\d+)$/);
      if (r) {
        const lo = parseInt(r[1], 10), hi = parseInt(r[2], 10);
        if (lo <= hi && hi <= 4094 && hi - lo <= 4094) {
          for (let v = lo; v <= hi; v++) out.push(String(v));
          continue;
        }
      }
      // Keep non-range tokens (including named VLANs, "all", "none") as-is
      out.push(p);
    }
    return out;
  }

  function detectVendor(text) {
    if (/\bvrf\s+context\s+\S+/.test(text) || /^feature\s+\w+/m.test(text) || /\bvpc\s+domain\s+\d+/.test(text)) return 'cisco-nx-os';
    if (/^route-policy\s+/m.test(text) || /\bbundle-ether\b/i.test(text) || /\bcommit\s*$/m.test(text)) return 'cisco-ios-xr';
    if (/\bvrf\s+definition\s+\S+/.test(text) || /\bip\s+vrf\s+\S+/.test(text)) return 'cisco-ios-xe';
    if (/\binterface\s+(GigabitEthernet|TenGigabitEthernet|FastEthernet|Loopback|Vlan|Port-channel)/i.test(text)) return 'cisco-ios-xe';
    return 'cisco-ios';
  }

  // Match `Port-channel1` / `port-channel1` / `Bundle-Ether1` etc.
  function isAggIf(name) {
    return /^(port-?channel|bundle-ether)\d+$/i.test(name);
  }
  function isSviIf(name) {
    return /^vlan\d+$/i.test(name);
  }
  function aggNumOf(name) {
    const m = name.match(/(\d+)$/);
    return m ? m[1] : '';
  }

  function parseInterface(section, vendor) {
    const name = section.header.replace(/^interface\s+/i, '').trim();
    const u = {
      parent: name, unit: '', ifkey: name,
      isAgg: isAggIf(name), isIrb: isSviIf(name), members: [],
      description: '', vrf: '', mode: '', vlanId: '', vlanMembers: [],
      ipv4: [], ipv6: [], families: [], shutdown: false,
      channelGroup: null, channelMode: '',
    };
    for (const ln of section.lines) {
      let m;
      if ((m = ln.match(/^description\s+(.+)$/i))) u.description = m[1].trim();
      else if ((m = ln.match(/^ip(?:v4)?\s+address\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s+(\d{1,3}(?:\.\d{1,3}){3}))?(?:\s+secondary)?$/i))) {
        if (m[2]) u.ipv4.push(`${m[1]} ${m[2]}`);
        else u.ipv4.push(m[1]);
        if (!u.families.includes('ipv4')) u.families.push('ipv4');
      }
      else if ((m = ln.match(/^ip(?:v4)?\s+address\s+(\d{1,3}(?:\.\d{1,3}){3}\/\d+)/i))) {
        u.ipv4.push(m[1]);
        if (!u.families.includes('ipv4')) u.families.push('ipv4');
      }
      else if ((m = ln.match(/^ipv6\s+address\s+([0-9a-f:]+\/\d+)/i))) {
        u.ipv6.push(m[1]);
        if (!u.families.includes('ipv6')) u.families.push('ipv6');
      }
      else if ((m = ln.match(/^(?:ip\s+)?vrf\s+(?:forwarding|member)\s+(\S+)$/i))) u.vrf = m[1];
      else if ((m = ln.match(/^vrf\s+(\S+)$/i)) && /xr|xe/.test(vendor)) u.vrf = m[1];
      else if ((m = ln.match(/^switchport\s+mode\s+(\S+)/i))) u.mode = m[1].toLowerCase();
      else if ((m = ln.match(/^switchport\s+access\s+vlan\s+(\d+)/i))) { u.vlanId = m[1]; if (!u.mode) u.mode = 'access'; }
      else if ((m = ln.match(/^switchport\s+trunk\s+allowed\s+vlan(?:\s+add)?\s+(.+)$/i))) {
        if (!u.mode) u.mode = 'trunk';
        const expanded = expandVlanList(m[1]);
        u.vlanMembers = [...new Set([...u.vlanMembers, ...expanded])];
      }
      else if ((m = ln.match(/^switchport\s+trunk\s+native\s+vlan\s+(\d+)/i))) u.vlanId = m[1];
      else if ((m = ln.match(/^channel-group\s+(\d+)\s+mode\s+(\S+)/i))) { u.channelGroup = m[1]; u.channelMode = m[2]; }
      else if ((m = ln.match(/^bundle\s+id\s+(\d+)\s+mode\s+(\S+)/i))) { u.channelGroup = m[1]; u.channelMode = m[2]; }
      else if (/^shutdown\b/i.test(ln)) u.shutdown = true;
      else if ((m = ln.match(/^vpc\s+(peer-link|\d+)/i))) u.vpcRole = m[1];
      else if ((m = ln.match(/^encapsulation\s+dot1q\s+(\d+)/i))) {
        u.vlanId = m[1];
        u.unit = m[1];
      }
    }
    // Fallback: extract VLAN from subinterface name (e.g. Ethernet1/25.101 → 101)
    // when no explicit encapsulation dot1q was found
    if (!u.vlanId) {
      const subVlan = name.match(/\.(\d+)$/);
      if (subVlan) {
        u.vlanId = subVlan[1];
        u.unit = subVlan[1];
      }
    }
    return u;
  }

  function parseAcl(section) {
    // header: "ip access-list extended NAME" / "ip access-list NAME" / "ipv4 access-list NAME"
    const m = section.header.match(/access-list(?:\s+(?:extended|standard))?\s+(\S+)$/i);
    const name = m ? m[1] : section.header;
    const rules = [];
    for (const ln of section.lines) {
      const r = ln.match(/^(?:\d+\s+)?(permit|deny)\s+(\S+)\s+(.+)$/i);
      if (!r) continue;
      const action = r[1].toLowerCase();
      const proto = r[2].toLowerCase();
      // parse rest as "<src> <src-mask|any|host x> <dst> <dst-mask|any|host x> [eq|range|gt|lt PORT...] [log]"
      const rest = r[3];
      const log = /\blog\b/i.test(rest);
      const portsMatch = rest.match(/\b(eq|range|gt|lt|neq)\s+([\w-]+(?:\s+\d+)?)/i);
      // best-effort source/dest extraction
      const toks = rest.split(/\s+/);
      let src = 'any', dst = 'any';
      const consume = (i) => {
        if (toks[i] === 'any') return { val: 'any', n: 1 };
        if (toks[i] === 'host' && toks[i + 1]) return { val: `host ${toks[i + 1]}`, n: 2 };
        if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(toks[i]) && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(toks[i + 1] || '')) return { val: `${toks[i]} ${toks[i + 1]}`, n: 2 };
        if (/\d+\.\d+\.\d+\.\d+\/\d+/.test(toks[i])) return { val: toks[i], n: 1 };
        return null;
      };
      const s = consume(0); if (s) { src = s.val; const d = consume(s.n); if (d) dst = d.val; }
      rules.push({
        id: `${name}:${rules.length + 1}`, name,
        fromZone: 'acl', toZone: '',
        sourceIntf: '', destIntf: '',
        source: src, destination: dst,
        service: portsMatch ? `${proto} ${portsMatch[1]} ${portsMatch[2]}` : proto,
        action: action === 'permit' ? 'permit' : 'deny',
        log,
        description: name,
      });
    }
    return rules;
  }

  function parseBgpSection(section, vendor) {
    // header: "router bgp <ASN>"
    const m = section.header.match(/router\s+bgp\s+(\d+)/i);
    const asn = m ? m[1] : '';
    const byVrf = {}; // vrf -> { groups: [{ name, type, peerAs, neighbors }] }
    const ensure = (vrf) => byVrf[vrf] || (byVrf[vrf] = { neighbors: [] });
    let activeVrf = 'master (default)';

    // Walk lines respecting `address-family ipv4 vrf X` / `vrf X` (NX-OS, IOS-XE)
    for (const ln of section.lines) {
      let mm;
      if ((mm = ln.match(/^address-family\s+ipv[46]\s+vrf\s+(\S+)/i))) { activeVrf = mm[1]; ensure(activeVrf); continue; }
      if ((mm = ln.match(/^vrf\s+(\S+)$/i))) { activeVrf = mm[1]; ensure(activeVrf); continue; }
      if (/^exit-address-family\b/i.test(ln)) { activeVrf = 'master (default)'; continue; }
      if ((mm = ln.match(/^neighbor\s+(\S+)\s+remote-as\s+(\d+)/i))) {
        ensure(activeVrf).neighbors.push({ ip: mm[1], remoteAs: mm[2], group: '' });
      }
      else if ((mm = ln.match(/^neighbor\s+(\S+)\s+peer-group$/i))) {
        ensure(activeVrf).neighbors.push({ ip: mm[1], remoteAs: '', group: mm[1] });
      }
    }
    return { asn, byVrf };
  }

  function parseOspfSection(section) {
    const m = section.header.match(/router\s+ospfv?3?\s+(\d+)(?:\s+vrf\s+(\S+))?/i);
    const id = m ? m[1] : '';
    const vrf = m && m[2] ? m[2] : 'master (default)';
    const areas = new Set();
    for (const ln of section.lines) {
      const ma = ln.match(/\barea\s+(\S+)/i);
      if (ma) areas.add(ma[1]);
    }
    return { id, vrf, areas: [...areas] };
  }

  function parseSystem(sections) {
    const sys = {
      ntp: [], dns: [], domain: '',
      aaa: { newModel: false, tacacs: [], radius: [], methods: [] },
      snmp: { communities: [], hosts: [], users: [] },
      syslog: [], users: [], banner: '',
      features: [], nbm: { enabled: false, flowPolicies: [] },
      vpc: null, fex: [], peerLinks: [],
    };
    for (const sec of sections) {
      const h = sec.header;
      let m;
      if ((m = h.match(/^ntp\s+server\s+(?:vrf\s+(\S+)\s+)?(\S+)(?:\s+(.*))?$/i))) {
        const opts = m[3] || '';
        sys.ntp.push({
          server: m[2], vrf: m[1] || (opts.match(/use-vrf\s+(\S+)/i) || [])[1] || '',
          prefer: /\bprefer\b/i.test(opts),
          key: (opts.match(/\bkey\s+(\d+)/i) || [])[1] || '',
        });
      }
      else if ((m = h.match(/^(?:ip\s+)?name-server\s+(?:vrf\s+(\S+)\s+)?(.+)$/i))) {
        const vrf = m[1] || '';
        for (const ip of m[2].split(/\s+/).filter(Boolean)) sys.dns.push({ server: ip, vrf });
      }
      else if ((m = h.match(/^(?:ip\s+)?domain[-\s]name\s+(\S+)/i))) sys.domain = m[1];
      else if ((m = h.match(/^tacacs-server\s+host\s+(\S+)(?:\s+(.*))?/i))) {
        sys.aaa.tacacs.push({ host: m[1], name: '', key: /\bkey\b/.test(m[2] || '') ? '***' : '', vrf: '', port: '' });
      }
      else if ((m = h.match(/^tacacs(?:\+)?\s+server\s+(\S+)/i))) {
        const t = { host: '', name: m[1], key: '', vrf: '', port: '' };
        for (const ln of sec.lines) {
          const ma = ln.match(/^address\s+ipv[46]?\s+(\S+)/i); if (ma) t.host = ma[1];
          if (/^key\b/i.test(ln)) t.key = '***';
          const mp = ln.match(/^port\s+(\d+)/i); if (mp) t.port = mp[1];
          const mv = ln.match(/^(?:use-)?vrf\s+(\S+)/i); if (mv) t.vrf = mv[1];
        }
        sys.aaa.tacacs.push(t);
      }
      else if ((m = h.match(/^radius-server\s+host\s+(\S+)(?:\s+(.*))?/i))) {
        const opts = m[2] || '';
        sys.aaa.radius.push({
          host: m[1], name: '',
          authPort: (opts.match(/auth-port\s+(\d+)/i) || [])[1] || '',
          acctPort: (opts.match(/acct-port\s+(\d+)/i) || [])[1] || '',
          vrf: '', key: /\bkey\b/.test(opts) ? '***' : '',
        });
      }
      else if ((m = h.match(/^radius\s+server\s+(\S+)/i))) {
        const r = { host: '', name: m[1], authPort: '', acctPort: '', vrf: '', key: '' };
        for (const ln of sec.lines) {
          const ma = ln.match(/^address\s+ipv[46]?\s+(\S+)(?:\s+auth-port\s+(\d+))?(?:\s+acct-port\s+(\d+))?/i);
          if (ma) { r.host = ma[1]; r.authPort = ma[2] || ''; r.acctPort = ma[3] || ''; }
          if (/^key\b/i.test(ln)) r.key = '***';
          const mv = ln.match(/^(?:use-)?vrf\s+(\S+)/i); if (mv) r.vrf = mv[1];
        }
        sys.aaa.radius.push(r);
      }
      else if (/^aaa\s+new-model/i.test(h)) sys.aaa.newModel = true;
      else if ((m = h.match(/^aaa\s+(authentication|authorization|accounting)\s+(.+)$/i))) sys.aaa.methods.push(`${m[1]} ${m[2]}`);
      else if ((m = h.match(/^logging(?:\s+(?:host|server))?\s+(?:vrf\s+(\S+)\s+)?(\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+:[0-9a-fA-F:]+)(?:\s+(.*))?$/i))) {
        const opts = m[3] || '';
        sys.syslog.push({
          host: m[2], vrf: m[1] || '',
          severity: (opts.match(/severity\s+(\S+)/i) || [])[1] || '',
          transport: (opts.match(/transport\s+(\S+)/i) || [])[1] || '',
        });
      }
      else if ((m = h.match(/^snmp-server\s+community\s+(\S+)(?:\s+(RO|RW))?/i))) {
        sys.snmp.communities.push({ name: m[1], access: m[2] || 'RO' });
      }
      else if ((m = h.match(/^snmp-server\s+host\s+(\S+)(?:\s+(?:version\s+(\S+)))?(?:\s+(.*))?$/i))) {
        sys.snmp.hosts.push({ host: m[1], version: m[2] || '2c', community: (m[3] || '').split(/\s+/)[0] || '' });
      }
      else if ((m = h.match(/^snmp-server\s+user\s+(\S+)(?:\s+(\S+))?/i))) {
        sys.snmp.users.push({ name: m[1], group: m[2] || '' });
      }
      else if ((m = h.match(/^username\s+(\S+)(?:\s+privilege\s+(\d+))?/i))) {
        sys.users.push({ name: m[1], privilege: m[2] || '' });
      }
      else if (/^banner\s+(motd|login|exec)/i.test(h)) sys.banner = h.match(/^banner\s+(\S+)/i)[1];
      else if ((m = h.match(/^feature\s+(\S+)/i))) sys.features.push(m[1]);
      else if ((m = h.match(/^vpc\s+domain\s+(\d+)/i))) {
        const v = { domain: m[1], role: '', priority: '', peerKeepalive: '', autoRecovery: false };
        for (const ln of sec.lines) {
          const mr = ln.match(/^role\s+priority\s+(\d+)/i); if (mr) { v.priority = mr[1]; v.role = 'primary-vote'; }
          const mp = ln.match(/^peer-keepalive\s+destination\s+(\S+)(?:\s+source\s+(\S+))?(?:\s+vrf\s+(\S+))?/i);
          if (mp) v.peerKeepalive = `${mp[1]}${mp[3] ? ` (vrf ${mp[3]})` : ''}`;
          if (/^auto-recovery\b/i.test(ln)) v.autoRecovery = true;
        }
        sys.vpc = v;
      }
      else if ((m = h.match(/^fex\s+(\d+)/i))) {
        const f = { id: m[1], type: '', description: '' };
        for (const ln of sec.lines) {
          const mt = ln.match(/^type\s+(.+)$/i); if (mt) f.type = mt[1].trim();
          const md = ln.match(/^description\s+(.+)$/i); if (md) f.description = md[1].trim();
        }
        sys.fex.push(f);
      }
      else if ((m = h.match(/^nbm\s+flow-policy\s+(\S+)/i))) {
        sys.nbm.enabled = true;
        sys.nbm.flowPolicies.push({ name: m[1], flows: sec.lines.filter(l => /^\s*ip\b/i.test(l)).length });
      }
      else if (/^nbm\s+/i.test(h)) sys.nbm.enabled = true;
    }
    if (sys.features.includes('nbm')) sys.nbm.enabled = true;
    if (sys.features.includes('vpc') && !sys.vpc) sys.vpc = { domain: '?', role: '', priority: '', peerKeepalive: '', autoRecovery: false };
    return sys;
  }

  function analyze(text, opts) {
    opts = opts || {};
    const vendor = opts.forceVendor || detectVendor(text);
    const sections = parseSections(text);

    let hostname = '';
    const interfaces = []; // raw parsed units (one per interface; subif handled inline)
    const vlanBlocks = []; // [{ id, name }]
    const vrfBlocks = []; // [{ name, type, rd, vrfTarget, description }]
    const acls = []; // flat rules across all ACLs
    const bgpInstances = [];
    const ospfInstances = [];

    for (const sec of sections) {
      const h = sec.header;
      let m;
      if ((m = h.match(/^hostname\s+(\S+)/i))) hostname = m[1];
      else if (/^interface\s+/i.test(h)) interfaces.push(parseInterface(sec, vendor));
      else if ((m = h.match(/^vlan\s+(\d+)/i))) {
        const id = m[1];
        let name = '';
        for (const ln of sec.lines) { const mm = ln.match(/^name\s+(\S+)/i); if (mm) name = mm[1]; }
        vlanBlocks.push({ id, name: name || `VLAN${id}` });
      }
      else if ((m = h.match(/^(?:vrf\s+definition|ip\s+vrf|vrf\s+context|vrf)\s+(\S+)/i))) {
        const name = m[1];
        let rd = '', vt = '', desc = '';
        for (const ln of sec.lines) {
          const r = ln.match(/^rd\s+(\S+)/i); if (r) rd = r[1];
          const t = ln.match(/^route-target\s+(?:both|import|export)\s+(\S+)/i); if (t) vt = vt ? `${vt}, ${t[1]}` : t[1];
          const d = ln.match(/^description\s+(.+)/i); if (d) desc = d[1].trim();
        }
        vrfBlocks.push({ name, type: 'vrf', rd, vrfTarget: vt, description: desc });
      }
      else if (/access-list/i.test(h)) {
        acls.push(...parseAcl(sec));
      }
      else if (/^router\s+bgp\s+/i.test(h)) bgpInstances.push(parseBgpSection(sec, vendor));
      else if (/^router\s+ospfv?3?\s+/i.test(h)) ospfInstances.push(parseOspfSection(sec));
    }

    // Build aggregates: group physical members by channel-group; pair with Port-channel interfaces
    const groups = {};
    for (const u of interfaces) {
      if (u.channelGroup && !u.isAgg) {
        (groups[u.channelGroup] = groups[u.channelGroup] || []).push(u.ifkey);
      }
    }
    const aggIfaces = interfaces.filter(u => u.isAgg);
    const aggregates = aggIfaces.map(po => {
      const num = aggNumOf(po.ifkey);
      const members = groups[num] || [];
      const memberObjs = interfaces.filter(u => u.channelGroup === num && !u.isAgg);
      const lacpMode = memberObjs[0] ? memberObjs[0].channelMode : '—';
      return { name: po.ifkey, members, lacpMode, periodic: '', minLinks: undefined, speed: '', description: po.description };
    });

    // Set isAgg.members on interfaces
    for (const po of interfaces) {
      if (po.isAgg) po.members = groups[aggNumOf(po.ifkey)] || [];
    }

    // VLANs and their members (by interface access vlan or trunk allowed)
    const vlans = vlanBlocks.map(({ id, name }) => {
      const members = [];
      for (const u of interfaces) {
        if (u.mode === 'access' && u.vlanId === id) members.push({ ifkey: u.ifkey, mode: 'access' });
        else if (u.vlanMembers && u.vlanMembers.includes(id)) members.push({ ifkey: u.ifkey, mode: 'trunk' });
      }
      const l3 = interfaces.find(u => u.isIrb && /^vlan(\d+)$/i.exec(u.ifkey) && RegExp.$1 === id);
      return { name, id, l3Interface: l3 ? l3.ifkey : '', description: '', members };
    });

    // VRFs: default + each vrfBlock
    const vrfs = [{ name: 'master (default)', type: 'default', rd: '', vrfTarget: '', interfaces: [], protocols: [], description: '' }];
    for (const v of vrfBlocks) vrfs.push({ ...v, interfaces: [], protocols: [] });

    // Assign interfaces to VRFs
    for (const u of interfaces) {
      const targetName = u.vrf || ((u.ipv4.length || u.ipv6.length) ? 'master (default)' : '');
      if (!targetName) continue;
      const v = vrfs.find(x => x.name === targetName);
      if (v && !v.interfaces.includes(u.ifkey)) v.interfaces.push(u.ifkey);
    }

    // Attach BGP/OSPF summaries to VRFs
    for (const inst of bgpInstances) {
      for (const [vrfName, body] of Object.entries(inst.byVrf)) {
        const v = vrfs.find(x => x.name === vrfName) || vrfs[0];
        const neighbors = body.neighbors.map(n => n.ip);
        v.protocols.push({
          proto: 'bgp',
          groups: [{ name: `AS ${inst.asn}`, type: '', peerAs: '', localAs: inst.asn, neighbors }],
        });
      }
    }
    for (const o of ospfInstances) {
      const v = vrfs.find(x => x.name === o.vrf) || vrfs[0];
      v.protocols.push({ proto: 'ospf', areas: o.areas.map(a => ({ area: a, interfaces: [] })) });
    }

    const system = parseSystem(sections);
    // Cross-link vPC peer-link / member port-channels back to system.vpc
    if (system.vpc) {
      system.peerLinks = interfaces.filter(u => u.vpcRole === 'peer-link').map(u => u.ifkey);
      system.vpc.peerLink = system.peerLinks[0] || '';
      system.vpc.members = interfaces.filter(u => u.vpcRole && u.vpcRole !== 'peer-link').map(u => ({ ifkey: u.ifkey, vpc: u.vpcRole }));
    }

    return {
      vendor,
      aggregates,
      logicalUnits: interfaces,
      vlans,
      vrfs,
      firewallRules: acls,
      system,
      counts: {
        hostname,
        physicals: interfaces.filter(u => !u.isAgg && !u.isIrb).length,
        aggregates: aggregates.length,
        logicalUnits: interfaces.length,
        vlans: vlans.length,
        vrfs: vrfs.length - 1,
        firewallRules: acls.length,
        ntp: system.ntp.length,
        tacacs: system.aaa.tacacs.length,
        radius: system.aaa.radius.length,
        syslog: system.syslog.length,
        features: system.features.length,
        fex: system.fex.length,
      },
    };
  }

  function detect(text) {
    let score = 0;
    if (/^!/m.test(text)) score += 20;
    if (/^hostname\s+\S+/m.test(text)) score += 20;
    if (/^interface\s+(GigabitEthernet|TenGigabitEthernet|FastEthernet|Ethernet\d|Loopback|Vlan|Port-channel|Tunnel|Bundle-Ether)/im.test(text)) score += 35;
    if (/^\s+ip\s+address\s+\d+\.\d+\.\d+\.\d+\s+\d+\.\d+\.\d+\.\d+/m.test(text)) score += 15;
    if (/^\s+switchport\s+(mode|access|trunk)/m.test(text)) score += 10;
    if (/^router\s+(bgp|ospf|eigrp)\s+\d+/m.test(text)) score += 10;
    if (/^ip\s+access-list/m.test(text)) score += 5;
    // Penalty for FortiOS / Aruba / Junos signatures
    if (/\bconfig\s+(firewall|system)\b/.test(text)) score -= 50;
    if (/\{[\s\S]*?\bfamily\s+(inet|ethernet-switching)/.test(text)) score -= 50;
    // Penalty for downstream / sibling vendor markers so they win their own samples
    if (/^!\s*device:/m.test(text)) score -= 30;
    if (/^daemon\s+TerminAttr\b/m.test(text)) score -= 30;
    if (/^vrf\s+instance\s+\S+/m.test(text)) score -= 25;
    if (/^!\s*Version\s+\S+\s+Dell/im.test(text)) score -= 50;
    if (/^interface\s+ethernet\s+\d+\/\d+\/\d+/im.test(text)) score -= 20;
    if (/^ASA\s+Version/m.test(text)) score -= 50;
    if (/\bnameif\s+\S+/.test(text)) score -= 30;
    if (/^sysname\s+\S+/m.test(text)) score -= 40;
    if (/^interface\s+(Eth-Trunk|Bridge-Aggregation)\d/im.test(text)) score -= 30;
    return Math.max(0, Math.min(score, 100));
  }

  window.ConfigParser_Cisco = {
    name: 'Cisco (IOS / IOS-XE / NX-OS / IOS-XR)',
    detect,
    parse(text, opts) { return analyze(text, opts); },
    sample: `hostname nxos-leaf-01
!
feature bgp
feature ospf
feature interface-vlan
feature lacp
feature vpc
feature nbm
feature lldp
!
ntp server 10.1.1.1 use-vrf management prefer
ntp server 10.1.1.2 use-vrf management
ip name-server 8.8.8.8 1.1.1.1
ip domain-name lab.local
!
aaa new-model
aaa authentication login default group tacacs+ local
tacacs server PRIMARY-TAC
  address ipv4 10.10.10.10
  key 7 0822455D0A16
tacacs server SECONDARY-TAC
  address ipv4 10.10.10.11
  key 7 0822455D0A16
radius server NPS-01
  address ipv4 10.10.20.10 auth-port 1812 acct-port 1813
  key 7 0822455D0A16
!
username admin privilege 15
username netops privilege 5
!
logging server 10.10.30.10
logging server 10.10.30.11 vrf management
logging source-interface Loopback0
!
snmp-server community RO-COMMUNITY RO
snmp-server host 10.10.40.10 version 2c RO-COMMUNITY
snmp-server user netops-snmp NETOPS-GRP
!
banner motd ^
Authorized access only
^
!
vpc domain 100
  role priority 1000
  peer-keepalive destination 10.0.0.2 source 10.0.0.1 vrf management
  auto-recovery
!
fex 101
  description rack-1-fex
  type N2K-C2348UPQ
!
nbm flow-policy MEDIA-FLOWS
  ip flow 239.1.0.0/16 source any bandwidth 3000
!
vlan 100
 name USERS
!
vlan 200
 name SERVERS
!
vrf context CUST-A
  rd 65000:100
  route-target import 65000:100
  route-target export 65000:100
!
interface port-channel1
 description vPC peer-link
 switchport mode trunk
 switchport trunk allowed vlan 100,200
 vpc peer-link
!
interface port-channel10
 description server bundle
 switchport mode trunk
 switchport trunk allowed vlan 100,200
 vpc 10
!
interface Ethernet1/1
 description spine-1
 channel-group 1 mode active
!
interface Ethernet1/2
 description spine-2
 channel-group 1 mode active
!
interface Ethernet1/5
 description server-01
 channel-group 10 mode active
!
interface Vlan100
 ip address 192.168.100.1/24
!
interface Vlan200
 vrf member CUST-A
 ip address 192.168.200.1/24
!
interface loopback0
 ip address 10.255.0.1/32
!
router bgp 65000
 neighbor 10.255.0.2 remote-as 65000
 neighbor 10.255.0.3 remote-as 65000
 vrf CUST-A
   neighbor 192.168.200.2 remote-as 65100
!
router ospf 1
 router-id 10.255.0.1
!
ip access-list INTERNET-IN
 10 permit tcp any any eq 443 log
 20 permit tcp any any eq 80
 30 deny ip any any log
!
end`,
  };
})();
