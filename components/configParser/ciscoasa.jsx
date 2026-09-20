// ConfigParser_CiscoASA: { detect, parse, sample }
(function () {
  function parseSections(text) {
    const sections = [];
    let cur = null;
    for (const raw of text.split('\n')) {
      const line = raw.replace(/\r$/, '');
      if (!line.trim() || /^\s*[!:]/.test(line)) continue;
      const indent = line.match(/^(\s*)/)[1].length;
      const body = line.trim();
      if (indent === 0) {
        cur = { header: body, lines: [] };
        sections.push(cur);
      } else if (cur) cur.lines.push(body);
    }
    return sections;
  }

  function detect(text) {
    let score = 0;
    if (/^ASA\s+Version\s+\d/m.test(text)) score += 60;
    if (/^nameif\s+\S+/m.test(text) || /\bnameif\s+\S+/.test(text)) score += 30;
    if (/^\s*security-level\s+\d+/m.test(text)) score += 30;
    if (/^access-list\s+\S+\s+extended\s+(permit|deny)/m.test(text)) score += 25;
    if (/^object-group\s+(network|service)\s+/m.test(text)) score += 15;
    if (/^nat\s+\(\S+,\S+\)\s+source\s+/m.test(text)) score += 20;
    if (/^access-group\s+\S+\s+(in|out)\s+interface\s+\S+/m.test(text)) score += 15;
    return Math.min(score, 100);
  }

  function parseInterface(sec) {
    const name = sec.header.replace(/^interface\s+/i, '').trim();
    const u = {
      parent: name, unit: '', ifkey: name,
      isAgg: /^(Port-channel|port-channel)\d+/i.test(name),
      isIrb: false, members: [],
      description: '', vrf: '', mode: '', vlanId: '', vlanMembers: [],
      ipv4: [], ipv6: [], families: [],
      nameif: '', securityLevel: '', channelGroup: null, channelMode: '',
    };
    for (const ln of sec.lines) {
      let m;
      if ((m = ln.match(/^description\s+(.+)$/i))) u.description = m[1].trim();
      else if ((m = ln.match(/^nameif\s+(\S+)/i))) u.nameif = m[1];
      else if ((m = ln.match(/^security-level\s+(\d+)/i))) u.securityLevel = m[1];
      else if ((m = ln.match(/^vlan\s+(\d+)/i))) u.vlanId = m[1];
      else if ((m = ln.match(/^ip\s+address\s+(\d{1,3}(?:\.\d{1,3}){3})\s+(\d{1,3}(?:\.\d{1,3}){3})(?:\s+standby\s+(\d{1,3}(?:\.\d{1,3}){3}))?/i))) {
        u.ipv4.push(`${m[1]} ${m[2]}${m[3] ? ` standby ${m[3]}` : ''}`);
        if (!u.families.includes('ipv4')) u.families.push('ipv4');
      }
      else if ((m = ln.match(/^ipv6\s+address\s+([0-9a-fA-F:]+\/\d+)/i))) {
        u.ipv6.push(m[1]);
        if (!u.families.includes('ipv6')) u.families.push('ipv6');
      }
      else if ((m = ln.match(/^channel-group\s+(\d+)\s+mode\s+(\S+)/i))) { u.channelGroup = m[1]; u.channelMode = m[2]; }
    }
    if (u.nameif) u.description = u.description ? `${u.description} (${u.nameif}${u.securityLevel ? `, sl ${u.securityLevel}` : ''})` : `${u.nameif}${u.securityLevel ? ` (sl ${u.securityLevel})` : ''}`;
    return u;
  }

  function parseAclLine(name, ln) {
    // access-list NAME extended permit tcp HOST/NET MASK HOST/NET MASK eq PORT [log]
    const m = ln.match(/^(?:access-list\s+)?(\S+)\s+extended\s+(permit|deny)\s+(\S+)\s+(.+?)(?:\s+log)?\s*$/i);
    if (!m) return null;
    const action = m[2].toLowerCase();
    const proto = m[3].toLowerCase();
    const rest = m[4];
    const log = /\blog\b/i.test(ln);
    const toks = rest.split(/\s+/);
    const consume = (i) => {
      if (!toks[i]) return null;
      if (toks[i] === 'any' || toks[i] === 'any4' || toks[i] === 'any6') return { val: 'any', n: 1 };
      if (toks[i] === 'host' && toks[i + 1]) return { val: `host ${toks[i + 1]}`, n: 2 };
      if (toks[i] === 'object-group' && toks[i + 1]) return { val: `og ${toks[i + 1]}`, n: 2 };
      if (toks[i] === 'object' && toks[i + 1]) return { val: `obj ${toks[i + 1]}`, n: 2 };
      if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(toks[i]) && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(toks[i + 1] || '')) return { val: `${toks[i]} ${toks[i + 1]}`, n: 2 };
      return { val: toks[i], n: 1 };
    };
    let src = 'any', dst = 'any', svc = proto;
    const s = consume(0); let idx = 0;
    if (s) { src = s.val; idx = s.n; const d = consume(idx); if (d) { dst = d.val; idx += d.n; } }
    const ports = toks.slice(idx).join(' ');
    if (ports) svc = `${proto} ${ports}`.trim();
    return { name, action, proto, src, dst, svc, log };
  }

  function analyze(text) {
    const sections = parseSections(text);
    let hostname = '';
    const interfaces = [];
    const acls = []; // raw rules across multiple access-list lines
    const aclGroups = {}; // name -> applied (iface, dir)
    const sys = {
      domain: '', dns: [], ntp: [], aaa: { newModel: false, tacacs: [], radius: [], methods: [] },
      snmp: { communities: [], hosts: [], users: [] },
      syslog: [], users: [], banner: '',
      features: [], nbm: { enabled: false, flowPolicies: [] }, vpc: null, fex: [], peerLinks: [],
    };

    for (const sec of sections) {
      const h = sec.header;
      let m;
      if ((m = h.match(/^hostname\s+(\S+)/i))) hostname = m[1];
      else if (/^interface\s+/i.test(h)) interfaces.push(parseInterface(sec));
      else if ((m = h.match(/^access-list\s+(\S+)\s+/i))) {
        const r = parseAclLine(m[1], h);
        if (r) acls.push(r);
      }
      else if ((m = h.match(/^access-group\s+(\S+)\s+(in|out)\s+interface\s+(\S+)/i))) {
        aclGroups[m[1]] = { iface: m[3], dir: m[2] };
      }
      else if ((m = h.match(/^domain-name\s+(\S+)/i))) sys.domain = m[1];
      else if ((m = h.match(/^dns\s+server-group\s+\S+/i))) {/* sub-block contains name-server */}
      else if ((m = h.match(/^name-server\s+(\S+)/i))) sys.dns.push({ server: m[1], vrf: '' });
      else if ((m = h.match(/^ntp\s+server\s+(\S+)/i))) sys.ntp.push({ server: m[1], vrf: '', prefer: /\bprefer\b/i.test(h), key: '' });
      else if ((m = h.match(/^aaa-server\s+(\S+)\s+(?:\(\S+\)\s+)?host\s+(\S+)/i))) {
        const sname = m[1];
        const host = m[2];
        const key = sec.lines.some(l => /^key\b/i.test(l)) ? '***' : '';
        if (/tac/i.test(sname)) sys.aaa.tacacs.push({ host, name: sname, key, vrf: '', port: '' });
        else if (/radius/i.test(sname)) sys.aaa.radius.push({ host, name: sname, authPort: '', acctPort: '', vrf: '', key });
      }
      else if ((m = h.match(/^logging\s+host\s+\S+\s+(\S+)/i))) sys.syslog.push({ host: m[1], vrf: '', severity: '', transport: '' });
      else if ((m = h.match(/^snmp-server\s+community\s+(\S+)/i))) sys.snmp.communities.push({ name: m[1], access: 'RO' });
      else if ((m = h.match(/^snmp-server\s+host\s+\S+\s+(\S+)/i))) sys.snmp.hosts.push({ host: m[1], version: '2c', community: '' });
      else if ((m = h.match(/^username\s+(\S+)(?:\s+privilege\s+(\d+))?/i))) sys.users.push({ name: m[1], privilege: m[2] || '' });
    }

    // Aggregates from port-channels
    const groups = {};
    for (const u of interfaces) if (u.channelGroup) (groups[u.channelGroup] = groups[u.channelGroup] || []).push(u.ifkey);
    const aggIfaces = interfaces.filter(u => u.isAgg);
    const aggregates = aggIfaces.map(po => {
      const num = (po.ifkey.match(/(\d+)$/) || [])[1] || '';
      const members = groups[num] || [];
      const memberObjs = interfaces.filter(u => u.channelGroup === num);
      return { name: po.ifkey, members, lacpMode: memberObjs[0] ? memberObjs[0].channelMode : '—', periodic: '', minLinks: undefined, speed: '', description: po.description };
    });

    // VLANs from subif vlan tags (no separate vlan database on ASA)
    const vlanIndex = {};
    for (const u of interfaces) {
      if (u.vlanId) {
        const v = vlanIndex[u.vlanId] || (vlanIndex[u.vlanId] = { name: `vlan${u.vlanId}`, id: u.vlanId, l3Interface: '', description: '', members: [] });
        v.members.push({ ifkey: u.ifkey, mode: 'subif' });
      }
    }
    const vlans = Object.values(vlanIndex);

    // ASA is typically single-context — emit one VRF (with all L3 interfaces)
    const vrfs = [{
      name: 'master (default)', type: 'default', rd: '', vrfTarget: '',
      interfaces: interfaces.filter(u => u.ipv4.length || u.ipv6.length).map(u => u.ifkey),
      protocols: [], description: '',
    }];
    for (const u of interfaces) u.vrf = 'master (default)';

    // Firewall rules — annotate with applied direction/interface
    const firewallRules = acls.map((r, i) => {
      const g = aclGroups[r.name] || null;
      return {
        id: `${r.name}:${i + 1}`, name: r.name,
        fromZone: g ? `${g.iface} (${g.dir})` : 'acl',
        toZone: '',
        sourceIntf: g ? g.iface : '',
        destIntf: '',
        source: r.src, destination: r.dst, service: r.svc,
        action: r.action === 'permit' ? 'permit' : 'deny',
        log: r.log,
        description: '',
      };
    });

    return {
      vendor: 'cisco-asa',
      aggregates, logicalUnits: interfaces, vlans, vrfs, firewallRules, system: sys,
      counts: {
        hostname,
        physicals: interfaces.filter(u => !u.isAgg).length,
        aggregates: aggregates.length,
        logicalUnits: interfaces.length,
        vlans: vlans.length,
        vrfs: 0,
        firewallRules: firewallRules.length,
        ntp: sys.ntp.length, tacacs: sys.aaa.tacacs.length, radius: sys.aaa.radius.length, syslog: sys.syslog.length, features: 0, fex: 0,
      },
    };
  }

  window.ConfigParser_CiscoASA = {
    name: 'Cisco ASA',
    detect,
    parse(text) { return analyze(text); },
    sample: `ASA Version 9.14
hostname asa-edge-01
domain-name lab.local
!
interface Port-channel1
 description LAN bundle
 nameif inside
 security-level 100
 ip address 192.168.1.1 255.255.255.0
!
interface GigabitEthernet0/0
 channel-group 1 mode active
!
interface GigabitEthernet0/1
 channel-group 1 mode active
!
interface GigabitEthernet0/2
 nameif outside
 security-level 0
 ip address 203.0.113.2 255.255.255.252
!
interface Port-channel1.100
 vlan 100
 nameif dmz
 security-level 50
 ip address 192.168.100.1 255.255.255.0
!
object-group network INTERNAL
 network-object 10.0.0.0 255.0.0.0
 network-object 192.168.0.0 255.255.0.0
!
object-group service WEB tcp
 port-object eq 80
 port-object eq 443
!
access-list OUTSIDE-IN extended permit tcp any object-group INTERNAL object-group WEB log
access-list OUTSIDE-IN extended deny ip any any log
access-list DMZ-IN extended permit tcp 192.168.100.0 255.255.255.0 any eq 443
!
access-group OUTSIDE-IN in interface outside
access-group DMZ-IN in interface dmz
!
aaa-server TAC-GROUP protocol tacacs+
aaa-server TAC-GROUP (inside) host 10.10.10.10
 key tac-secret
aaa-server NPS protocol radius
aaa-server NPS (inside) host 10.10.20.10
 key radius-secret
!
ntp server 10.1.1.1 prefer
ntp server 10.1.1.2
logging host inside 10.10.30.10
snmp-server community RO-COMMUNITY
snmp-server host inside 10.10.40.10 community RO-COMMUNITY
username admin privilege 15
!`,
  };
})();
