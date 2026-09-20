const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── Routing Config Builder — Multi-platform Config Generator ──────────────

const ROUTING_PLATFORMS = [
  { id:'cisco_ios',  label:'Cisco IOS',     prompt:'#',   comment:'!' },
  { id:'cisco_nxos', label:'Cisco NX-OS',   prompt:'#',   comment:'!' },
  { id:'junos',      label:'Juniper JunOS', prompt:'>',   comment:'/* */' },
  { id:'arista',     label:'Arista EOS',    prompt:'#',   comment:'!' },
  { id:'huawei',     label:'Huawei VRP',    prompt:'<>',  comment:'#' },
];

const PROTOCOLS = ['static','ospf','eigrp','bgp','rip','isis'];

const CISCO_IOS_CONFIGS = {
  static: {
    fields: [
      {id:'network', label:'Destination Network', placeholder:'192.168.10.0', required:true},
      {id:'mask', label:'Subnet Mask', placeholder:'255.255.255.0', required:true},
      {id:'nexthop', label:'Next-Hop / Interface', placeholder:'10.0.0.1', required:true},
      {id:'ad', label:'Administrative Distance', placeholder:'1', required:false},
      {id:'tag', label:'Route Tag', placeholder:'', required:false},
    ],
    generate: (v) => {
      let cfg = `ip route ${v.network} ${v.mask} ${v.nexthop}`;
      if(v.ad) cfg += ` ${v.ad}`;
      if(v.tag) cfg += ` tag ${v.tag}`;
      cfg += `\n! Default route example:\nip route 0.0.0.0 0.0.0.0 ${v.nexthop}`;
      if(v.ad) cfg += ` ${v.ad}`;
      return cfg;
    }
  },
  ospf: {
    fields: [
      {id:'pid', label:'Process ID', placeholder:'1', required:true},
      {id:'router_id', label:'Router ID', placeholder:'1.1.1.1', required:true},
      {id:'networks', label:'Networks (network,area per line)', placeholder:'10.0.0.0 0.0.0.255 area 0\n192.168.1.0 0.0.0.255 area 0', required:true, multiline:true},
      {id:'passive', label:'Passive Interfaces (comma-separated)', placeholder:'GigabitEthernet0/0', required:false},
      {id:'auth', label:'Authentication', placeholder:'md5', required:false},
      {id:'area_auth', label:'Area Authentication', placeholder:'', required:false},
      {id:'redistribute', label:'Redistribute', placeholder:'', required:false},
      {id:'default_originate', label:'Default Originate', placeholder:'false', required:false},
    ],
    generate: (v) => {
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      const passives = v.passive ? v.passive.split(',').map(s=>s.trim()).filter(Boolean) : [];
      let cfg = `router ospf ${v.pid}\n router-id ${v.router_id}`;
      nets.forEach(n => { cfg += `\n network ${n}`; });
      passives.forEach(p => { cfg += `\n passive-interface ${p}`; });
      if(v.auth==='md5') cfg += '\n area 0 authentication message-digest';
      else if(v.auth==='clear') cfg += '\n area 0 authentication';
      if(v.redistribute) cfg += `\n redistribute ${v.redistribute} metric 100 subnets`;
      if(v.default_originate==='true') cfg += '\n default-information originate';
      cfg += '\n!\n! Interface example:';
      cfg += '\ninterface GigabitEthernet0/1';
      cfg += '\n ip address 10.0.0.1 255.255.255.0';
      cfg += '\n ip ospf 1 area 0';
      if(v.auth==='md5') cfg += '\n ip ospf authentication message-digest\n ip ospf message-digest-key 1 md5 SECRET_KEY';
      cfg += '\n ip ospf cost 10\n ip ospf hello-interval 10\n ip ospf dead-interval 40';
      return cfg;
    }
  },
  eigrp: {
    fields: [
      {id:'asn', label:'AS Number', placeholder:'65001', required:true},
      {id:'router_id', label:'Router ID', placeholder:'1.1.1.1', required:false},
      {id:'networks', label:'Networks (one per line)', placeholder:'10.0.0.0 0.0.0.255\n192.168.1.0 0.0.0.255', required:true, multiline:true},
      {id:'passive', label:'Passive Interfaces (comma-sep)', placeholder:'GigabitEthernet0/0', required:false},
      {id:'no_auto', label:'No Auto-Summary', placeholder:'true', required:false},
      {id:'redistribute', label:'Redistribute', placeholder:'', required:false},
      {id:'stub', label:'Stub (connected/summary/static)', placeholder:'', required:false},
    ],
    generate: (v) => {
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      const passives = v.passive ? v.passive.split(',').map(s=>s.trim()).filter(Boolean) : [];
      let cfg = `router eigrp ${v.asn}`;
      if(v.router_id) cfg += `\n eigrp router-id ${v.router_id}`;
      nets.forEach(n => { cfg += `\n network ${n}`; });
      passives.forEach(p => { cfg += `\n passive-interface ${p}`; });
      if(v.no_auto!=='false') cfg += '\n no auto-summary';
      if(v.redistribute) cfg += `\n redistribute ${v.redistribute} metric 10000 100 255 1 1500`;
      if(v.stub) cfg += `\n eigrp stub ${v.stub}`;
      cfg += '\n!\n! Named EIGRP mode example:';
      cfg += `\nrouter eigrp MY_EIGRP`;
      cfg += `\n address-family ipv4 unicast autonomous-system ${v.asn}`;
      cfg += `\n  af-interface default`;
      cfg += `\n   passive-interface`;
      cfg += `\n  exit-af-interface`;
      cfg += `\n  af-interface GigabitEthernet0/1`;
      cfg += `\n   no passive-interface`;
      cfg += `\n   authentication mode hmac-sha-256 0 SECRET_KEY`;
      cfg += `\n  exit-af-interface`;
      cfg += `\n  topology base`;
      if(v.redistribute) cfg += `\n   redistribute ${v.redistribute}`;
      cfg += `\n  exit-af-topology`;
      cfg += `\n  network 10.0.0.0 0.0.0.255`;
      cfg += `\n exit-address-family`;
      return cfg;
    }
  },
  bgp: {
    fields: [
      {id:'asn', label:'Local AS Number', placeholder:'65001', required:true},
      {id:'router_id', label:'Router ID', placeholder:'1.1.1.1', required:true},
      {id:'peers', label:'Neighbors (IP,ASN per line)', placeholder:'10.0.0.2 65002\n10.0.0.3 65003', required:true, multiline:true},
      {id:'networks', label:'Advertised Networks (network,mask)', placeholder:'192.168.0.0 255.255.0.0\n10.0.0.0 255.255.255.0', required:true, multiline:true},
      {id:'ibgp_full', label:'Full Mesh iBGP (true/false)', placeholder:'false', required:false},
      {id:'rr', label:'Route Reflector Client', placeholder:'false', required:false},
      {id:'passive', label:'Soft Reconfig Inbound', placeholder:'true', required:false},
    ],
    generate: (v) => {
      const peers = v.peers.split('\n').filter(l=>l.trim()).map(l=>l.trim().split(/\s+/));
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `router bgp ${v.asn}\n bgp router-id ${v.router_id}\n bgp log-neighbor-changes`;
      peers.forEach(([ip,asn]) => {
        const isIBGP = asn === v.asn;
        cfg += `\n neighbor ${ip} remote-as ${asn}`;
        if(isIBGP) cfg += `\n neighbor ${ip} update-source Loopback0`;
        cfg += `\n neighbor ${ip} send-community both`;
        if(v.passive!=='false') cfg += `\n neighbor ${ip} soft-reconfiguration inbound`;
      });
      // AF
      cfg += '\n !';
      cfg += '\n address-family ipv4 unicast';
      nets.forEach(n => { cfg += `\n  network ${n}`; });
      peers.forEach(([ip,asn]) => {
        cfg += `\n  neighbor ${ip} activate`;
        if(v.rr==='true' && asn===v.asn) cfg += `\n  neighbor ${ip} route-reflector-client`;
        cfg += `\n  neighbor ${ip} route-map SET_LOCAL_PREF in`;
      });
      cfg += '\n exit-address-family';
      // Route maps
      cfg += '\n!\n! Route-map / Prefix-list examples:';
      cfg += '\nip prefix-list FROM_ISP seq 10 permit 0.0.0.0/0 le 24';
      cfg += '\nip prefix-list LOCAL_NET seq 10 permit 192.168.0.0/16 le 32';
      cfg += '\n!';
      cfg += '\nroute-map SET_LOCAL_PREF permit 10';
      cfg += '\n set local-preference 200';
      cfg += '\n!';
      cfg += '\nroute-map FROM_ISP_MAP permit 10';
      cfg += '\n match ip address prefix-list FROM_ISP';
      cfg += '\n!';
      // Community example
      cfg += '\n! BGP community examples:';
      cfg += '\n! no-export       = do not advertise to eBGP peers';
      cfg += '\n! no-advertise    = do not advertise to any peer';
      cfg += '\n! local-as        = do not send outside local AS';
      cfg += '\n! internet        = advertise to Internet';
      return cfg;
    }
  },
  rip: {
    fields: [
      {id:'ver', label:'Version (1/2)', placeholder:'2', required:true},
      {id:'networks', label:'Networks (classful, one per line)', placeholder:'10.0.0.0\n192.168.1.0', required:true, multiline:true},
      {id:'passive', label:'Passive Interfaces', placeholder:'', required:false},
      {id:'no_auto', label:'No Auto-Summary', placeholder:'true', required:false},
      {id:'default_originate', label:'Default Originate', placeholder:'false', required:false},
    ],
    generate: (v) => {
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      const passives = v.passive ? v.passive.split(',').map(s=>s.trim()).filter(Boolean) : [];
      let cfg = `router rip\n version ${v.ver||2}`;
      nets.forEach(n => { cfg += `\n network ${n}`; });
      passives.forEach(p => { cfg += `\n passive-interface ${p}`; });
      if(v.no_auto!=='false') cfg += '\n no auto-summary';
      if(v.default_originate==='true') cfg += '\n default-information originate';
      cfg += '\n!\n! RIP timer defaults: Update 30s, Invalid 180s, Holddown 180s, Flush 240s';
      cfg += '\n! timers basic update invalid holddown flush';
      cfg += `\n timers basic 30 180 180 240`;
      return cfg;
    }
  },
  isis: {
    fields: [
      {id:'net', label:'NET Address', placeholder:'49.0001.0000.0000.0001.00', required:true},
      {id:'level', label:'Level (1/2/1-2)', placeholder:'level-2-only', required:true},
      {id:'networks', label:'Interfaces (ip,area per line)', placeholder:'GigabitEthernet0/1\nGigabitEthernet0/2', required:true, multiline:true},
      {id:'metric_style', label:'Metric Style (narrow/wide)', placeholder:'wide', required:false},
      {id:'is_type', label:'IS Type', placeholder:'level-1-2', required:false},
    ],
    generate: (v) => {
      const ifaces = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `router isis\n net ${v.net}`;
      if(v.metric_style==='wide') cfg += '\n metric-style wide';
      cfg += `\n is-type ${v.is_type||'level-1-2'}`;
      cfg += '\n!\n! Interface configuration:';
      ifaces.forEach(iface => {
        cfg += `\ninterface ${iface}`;
        cfg += '\n ip router isis';
        cfg += '\n isis circuit-type level-2-only';
        cfg += '\n isis metric 10 level-2';
        if(v.level) cfg += `\n isis ${v.level}`;
        cfg += `\n!`;
      });
      cfg += '\n! IS-IS hello intervals (default 10s, DIS 3.3s)';
      cfg += '\n! isis hello-interval 10 level-2';
      cfg += '\n! isis hello-multiplier 3 level-2';
      return cfg;
    }
  },
};

const CISCO_NXOS_CONFIGS = {
  static: { fields: CISCO_IOS_CONFIGS.static.fields, generate: CISCO_IOS_CONFIGS.static.generate },
  ospf: {
    fields: CISCO_IOS_CONFIGS.ospf.fields,
    generate: (v) => {
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      const passives = v.passive ? v.passive.split(',').map(s=>s.trim()).filter(Boolean) : [];
      let cfg = `router ospf ${v.pid}\n router-id ${v.router_id}`;
      nets.forEach(n => { cfg += `\n network ${n}`; });
      passives.forEach(p => { cfg += `\n passive-interface ${p}`; });
      if(v.auth==='md5') cfg += '\n area 0 authentication message-digest';
      cfg += '\n!\n! NX-OS interface example:';
      cfg += '\ninterface Ethernet1/1';
      cfg += '\n ip address 10.0.0.1/24';
      cfg += '\n ip router ospf 1 area 0.0.0.0';
      cfg += '\n ip ospf cost 10';
      if(v.auth==='md5') cfg += '\n ip ospf authentication message-digest\n ip ospf message-digest-key 1 md5 3 SECRET_KEY';
      return cfg;
    }
  },
  eigrp: {
    fields: CISCO_IOS_CONFIGS.eigrp.fields,
    generate: (v) => {
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `router eigrp ${v.asn}`;
      cfg += `\n router-id ${v.router_id||'1.1.1.1'}`;
      nets.forEach(n => { cfg += `\n network ${n}`; });
      cfg += '\n no auto-summary';
      return cfg;
    }
  },
  bgp: {
    fields: CISCO_IOS_CONFIGS.bgp.fields,
    generate: (v) => {
      const peers = v.peers.split('\n').filter(l=>l.trim()).map(l=>l.trim().split(/\s+/));
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `router bgp ${v.asn}\n router-id ${v.router_id}`;
      peers.forEach(([ip,asn]) => {
        cfg += `\n neighbor ${ip} remote-as ${asn}`;
        if(asn===v.asn) cfg += `\n neighbor ${ip} update-source loopback0`;
      });
      cfg += '\n address-family ipv4 unicast';
      nets.forEach(n => { cfg += `\n  network ${n}`; });
      peers.forEach(([ip]) => { cfg += `\n  neighbor ${ip} activate`; });
      cfg += '\n exit-address-family';
      return cfg;
    }
  },
  rip: { fields: CISCO_IOS_CONFIGS.rip.fields, generate: CISCO_IOS_CONFIGS.rip.generate },
  isis: { fields: CISCO_IOS_CONFIGS.isis.fields, generate: CISCO_IOS_CONFIGS.isis.generate },
};

const JUNOS_CONFIGS = {
  static: {
    fields: [{id:'network', label:'Destination', placeholder:'192.168.10.0/24', required:true},{id:'nexthop', label:'Next-Hop', placeholder:'10.0.0.1', required:true},{id:'preference', label:'Preference (AD)', placeholder:'5', required:false}],
    generate: (v) => {
      let cfg = `routing-options {\n    static {\n        route ${v.network} {\n            next-hop ${v.nexthop};`;
      if(v.preference) cfg += `\n            preference ${v.preference};`;
      cfg += `\n        }\n        route 0.0.0.0/0 next-hop ${v.nexthop};\n    }\n}`;
      return cfg;
    }
  },
  ospf: {
    fields: [{id:'area', label:'Area ID', placeholder:'0.0.0.0', required:true},{id:'router_id', label:'Router ID', placeholder:'1.1.1.1', required:true},{id:'interfaces', label:'Interfaces (one per line)', placeholder:'ge-0/0/0.0\nge-0/0/1.0', required:true, multiline:true},{id:'auth', label:'Authentication (md5/simple)', placeholder:'', required:false}],
    generate: (v) => {
      const ifaces = v.interfaces.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `protocols {\n    ospf {\n        area ${v.area} {`;
      ifaces.forEach(iface => {
        cfg += `\n            interface ${iface} {\n                hello-interval 10;\n                dead-interval 40;`;
        if(v.auth==='md5') cfg += `\n                authentication {\n                    md5 1 key \"SECRET_KEY\";\n                }`;
        cfg += `\n            }`;
      });
      cfg += `\n        }\n    }\n}\nrouting-options {\n    router-id ${v.router_id};\n}`;
      return cfg;
    }
  },
  eigrp: {
    fields: [{id:'asn', label:'AS Number', placeholder:'65001', required:true},{id:'interfaces', label:'Interfaces (one per line)', placeholder:'ge-0/0/0.0', required:true, multiline:true}],
    generate: (v) => {
      const ifaces = v.interfaces.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `protocols {\n    eigrp {\n        traceoptions {\n            file eigrp.log;\n        }\n        autonomous-system ${v.asn};`;
      ifaces.forEach(iface => {
        cfg += `\n        interface ${iface} {\n            hello-interval 5;\n            hold-time 15;\n        }`;
      });
      cfg += `\n    }\n}`;
      return cfg;
    }
  },
  bgp: {
    fields: [{id:'asn', label:'Local AS', placeholder:'65001', required:true},{id:'router_id', label:'Router ID', placeholder:'1.1.1.1', required:true},{id:'peers', label:'Peers (IP,ASN per line)', placeholder:'10.0.0.2 65002', required:true, multiline:true},{id:'policy', label:'Export Policy', placeholder:'EXPORT_POLICY', required:false}],
    generate: (v) => {
      const peers = v.peers.split('\n').filter(l=>l.trim()).map(l=>l.trim().split(/\s+/));
      let cfg = `protocols {\n    bgp {\n        group EBGP {`;
      if(v.policy) cfg += `\n            export ${v.policy};`;
      peers.forEach(([ip,asn]) => {
        cfg += `\n            neighbor ${ip} {\n                peer-as ${asn};\n            }`;
      });
      cfg += `\n        }\n    }\n}\nrouting-options {\n    router-id ${v.router_id};\n    autonomous-system ${v.asn};\n}`;
      cfg += `\n\n! Policy example:\npolicy-options {\n    policy-statement EXPORT_POLICY {\n        term 1 {\n            from protocol direct;\n            then accept;\n        }\n        term reject {\n            then reject;\n        }\n    }\n    community NO_EXPORT members no-export;\n}`;
      return cfg;
    }
  },
  rip: {
    fields: [{id:'interfaces', label:'Interfaces (one per line)', placeholder:'ge-0/0/0.0', required:true, multiline:true}],
    generate: (v) => {
      const ifaces = v.interfaces.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `protocols {\n    rip {\n        group RG {`;
      ifaces.forEach(iface => {
        cfg += `\n            neighbor ${iface};`;
      });
      cfg += `\n        }\n    }\n}`;
      return cfg;
    }
  },
  isis: {
    fields: [{id:'net', label:'NET Address', placeholder:'49.0001.0000.0000.0001.00', required:true},{id:'interfaces', label:'Interfaces (one per line)', placeholder:'ge-0/0/0.0', required:true, multiline:true},{id:'level', label:'Level (1/2)', placeholder:'2', required:false}],
    generate: (v) => {
      const ifaces = v.interfaces.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `protocols {\n    isis {\n        interface all {\n            level ${v.level||2} {\n                metric 10;\n            }\n        }`;
      ifaces.forEach(iface => {
        cfg += `\n        interface ${iface} {\n            point-to-point;\n            level ${v.level||2} metric 10;\n        }`;
      });
      cfg += `\n    }\n}\ninterfaces {\n    lo0 {\n        unit 0 {\n            family inet {\n                address ${v.router_id||'1.1.1.1'}/32;\n            }\n        }\n    }\n}`;
      return cfg;
    }
  },
};

const ARISTA_CONFIGS = {
  static: { fields: CISCO_IOS_CONFIGS.static.fields, generate: CISCO_IOS_CONFIGS.static.generate },
  ospf: {
    fields: CISCO_IOS_CONFIGS.ospf.fields,
    generate: (v) => {
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `router ospf ${v.pid}\n   router-id ${v.router_id}`;
      nets.forEach(n => { cfg += `\n   network ${n}`; });
      cfg += '\n!\n! Arista interface example:';
      cfg += '\ninterface Ethernet1';
      cfg += '\n   ip address 10.0.0.1/24';
      cfg += '\n   ip ospf area 0.0.0.0';
      return cfg;
    }
  },
  eigrp: { fields: CISCO_IOS_CONFIGS.eigrp.fields, generate: CISCO_IOS_CONFIGS.eigrp.generate },
  bgp: { fields: CISCO_IOS_CONFIGS.bgp.fields, generate: (v) => {
      const peers = v.peers.split('\n').filter(l=>l.trim()).map(l=>l.trim().split(/\s+/));
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `router bgp ${v.asn}\n   router-id ${v.router_id}`;
      peers.forEach(([ip,asn]) => { cfg += `\n   neighbor ${ip} remote-as ${asn}`; });
      nets.forEach(n => { cfg += `\n   network ${n}`; });
      cfg += '\n!';
      return cfg;
    }
  },
  rip: { fields: CISCO_IOS_CONFIGS.rip.fields, generate: CISCO_IOS_CONFIGS.rip.generate },
  isis: { fields: CISCO_IOS_CONFIGS.isis.fields, generate: CISCO_IOS_CONFIGS.isis.generate },
};

const HUAWEI_CONFIGS = {
  static: {
    fields: [{id:'network', label:'Destination', placeholder:'192.168.10.0', required:true},{id:'mask', label:'Mask', placeholder:'255.255.255.0', required:true},{id:'nexthop', label:'Next-Hop', placeholder:'10.0.0.1', required:true},{id:'preference', label:'Preference', placeholder:'60', required:false}],
    generate: (v) => {
      let cfg = `ip route-static ${v.network} ${v.mask||'255.255.255.0'} ${v.nexthop}`;
      if(v.preference) cfg += ` preference ${v.preference}`;
      cfg += `\n#\nip route-static 0.0.0.0 0.0.0.0 ${v.nexthop}`;
      return cfg;
    }
  },
  ospf: {
    fields: [{id:'pid', label:'Process ID', placeholder:'1', required:true},{id:'router_id', label:'Router ID', placeholder:'1.1.1.1', required:true},{id:'networks', label:'Networks (network,area)', placeholder:'10.0.0.0 0.0.0.255 area 0', required:true, multiline:true}],
    generate: (v) => {
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `ospf ${v.pid} router-id ${v.router_id}`;
      nets.forEach(n => { cfg += `\n area ${n}`; });
      cfg += '\n#\n! Interface example:';
      cfg += '\ninterface GigabitEthernet0/0/1';
      cfg += '\n ip address 10.0.0.1 255.255.255.0';
      cfg += '\n ospf enable ${v.pid} area 0.0.0.0';
      cfg += '\n ospf cost 10';
      return cfg;
    }
  },
  eigrp: { fields: [{id:'asn', label:'AS Number', placeholder:'65001', required:true},{id:'networks', label:'Networks', placeholder:'10.0.0.0', required:true, multiline:true}],
    generate: (v) => {
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `eigrp ${v.asn}`;
      nets.forEach(n => { cfg += `\n network ${n}`; });
      return cfg;
    }
  },
  bgp: {
    fields: [{id:'asn', label:'Local AS', placeholder:'65001', required:true},{id:'router_id', label:'Router ID', placeholder:'1.1.1.1', required:true},{id:'peers', label:'Peers (IP,ASN per line)', placeholder:'10.0.0.2 65002', required:true, multiline:true},{id:'networks', label:'Networks', placeholder:'192.168.0.0 255.255.0.0', required:true, multiline:true}],
    generate: (v) => {
      const peers = v.peers.split('\n').filter(l=>l.trim()).map(l=>l.trim().split(/\s+/));
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `bgp ${v.asn}\n router-id ${v.router_id}`;
      peers.forEach(([ip,asn]) => {
        cfg += `\n peer ${ip} as-number ${asn}`;
      });
      cfg += '\n #';
      cfg += '\n ipv4-family unicast';
      nets.forEach(n => { cfg += `\n  network ${n}`; });
      peers.forEach(([ip]) => { cfg += `\n  peer ${ip} enable`; });
      cfg += '\n  peer ${peers[0]&&peers[0][0]} route-policy SET_LOCAL_PREF import';
      cfg += '\n #';
      cfg += '\n! Route-policy example:';
      cfg += '\nroute-policy SET_LOCAL_PREF permit node 10';
      cfg += '\n apply local-preference 200';
      return cfg;
    }
  },
  rip: { fields: CISCO_IOS_CONFIGS.rip.fields, generate: (v) => {
      const nets = v.networks.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `rip 1\n version ${v.ver||2}`;
      nets.forEach(n => { cfg += `\n network ${n}`; });
      return cfg;
    }
  },
  isis: { fields: [{id:'net', label:'NET', placeholder:'49.0001.0000.0000.0001.00', required:true},{id:'level', label:'Level', placeholder:'level-2', required:false},{id:'interfaces', label:'Interfaces', placeholder:'GigabitEthernet0/0/1', required:true, multiline:true}],
    generate: (v) => {
      const ifaces = v.interfaces.split('\n').filter(l=>l.trim()).map(l=>l.trim());
      let cfg = `isis 1\n is-level ${v.level||'level-2'}\n network-entity ${v.net}`;
      cfg += '\n#\n! Interface config:';
      ifaces.forEach(iface => {
        cfg += `\ninterface ${iface}`;
        cfg += '\n isis enable 1';
        cfg += '\n isis cost 10';
        cfg += '\n isis circuit-level level-2';
      });
      return cfg;
    }
  },
};

const CONFIG_MAP = {
  cisco_ios: CISCO_IOS_CONFIGS,
  cisco_nxos: CISCO_NXOS_CONFIGS,
  junos: JUNOS_CONFIGS,
  arista: ARISTA_CONFIGS,
  huawei: HUAWEI_CONFIGS,
};

function RoutingConfigBuilder({ onShare, initialData }) {
  const { t } = useTranslation();
  const [platform, setPlatform] = usePersistentState('routing-cfg:platform', initialData?.platform ?? 'cisco_ios');
  const [protocol, setProtocol] = usePersistentState('routing-cfg:protocol', initialData?.protocol ?? 'ospf');
  const [values, setValues] = usePersistentState('routing-cfg:values', initialData?.values ?? {});
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (initialData) {
      if (initialData.platform) setPlatform(initialData.platform);
      if (initialData.protocol) setProtocol(initialData.protocol);
      if (initialData.values) setValues(initialData.values);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      (e.detail?.respond ?? onShare)({ tool:'routing-config', platform, protocol, values });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [platform, protocol, values, onShare]);

  const configDef = CONFIG_MAP[platform]?.[protocol];
  const fields = configDef?.fields || [];

  const setField = (id, val) => setValues(prev => ({...prev, [id]: val}));

  const generated = useMemo(() => {
    if (!configDef) return '';
    // Check required fields
    for (const f of fields) {
      if (f.required && !values[f.id]?.trim()) return '';
    }
    try { return configDef.generate(values); } catch { return ''; }
  }, [platform, protocol, values, configDef, fields]);

  const handleCopy = () => {
    if (!generated) return;
    navigator.clipboard.writeText(generated).catch(() => {
      const ta = document.createElement('textarea'); ta.value = generated;
      ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
    });
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  const platformObj = ROUTING_PLATFORMS.find(p => p.id === platform);

  const PLAT_LABELS = {
    cisco_ios: t('routing_cfg.plat_cisco_ios', 'Cisco IOS'),
    cisco_nxos: t('routing_cfg.plat_cisco_nxos', 'Cisco NX-OS'),
    junos: t('routing_cfg.plat_junos', 'Juniper JunOS'),
    arista: t('routing_cfg.plat_arista', 'Arista EOS'),
    huawei: t('routing_cfg.plat_huawei', 'Huawei VRP'),
  };

  const FIELD_LBL = {
    'Destination Network': 'f_dest_network',
    'Subnet Mask': 'f_subnet_mask',
    'Next-Hop / Interface': 'f_nexthop_interface',
    'Administrative Distance': 'f_admin_distance',
    'Route Tag': 'f_route_tag',
    'Process ID': 'f_process_id',
    'Router ID': 'f_router_id',
    'Networks (network,area per line)': 'f_networks_area_line',
    'Passive Interfaces (comma-separated)': 'f_passive_csv',
    'Authentication': 'f_authentication',
    'Area Authentication': 'f_area_authentication',
    'Redistribute': 'f_redistribute',
    'Default Originate': 'f_default_originate',
    'AS Number': 'f_as_number',
    'Networks (one per line)': 'f_networks_per_line',
    'Passive Interfaces (comma-sep)': 'f_passive_sep',
    'No Auto-Summary': 'f_no_auto_summary',
    'Stub (connected/summary/static)': 'f_stub',
    'Local AS Number': 'f_local_as_number',
    'Neighbors (IP,ASN per line)': 'f_neighbors_asn',
    'Advertised Networks (network,mask)': 'f_advertised_networks',
    'Full Mesh iBGP (true/false)': 'f_ibgp_full_mesh',
    'Route Reflector Client': 'f_route_reflector',
    'Soft Reconfig Inbound': 'f_soft_reconfig',
    'Version (1/2)': 'f_version',
    'Networks (classful, one per line)': 'f_networks_classful',
    'Passive Interfaces': 'f_passive_interfaces',
    'NET Address': 'f_net_address',
    'Level (1/2/1-2)': 'f_level_full',
    'Interfaces (ip,area per line)': 'f_interfaces_area_line',
    'Metric Style (narrow/wide)': 'f_metric_style',
    'IS Type': 'f_is_type',
    'Destination': 'f_destination',
    'Next-Hop': 'f_next_hop',
    'Preference (AD)': 'f_preference_ad',
    'Area ID': 'f_area_id',
    'Interfaces (one per line)': 'f_interfaces_per_line',
    'Authentication (md5/simple)': 'f_auth_md5_simple',
    'Local AS': 'f_local_as',
    'Peers (IP,ASN per line)': 'f_peers_asn',
    'Export Policy': 'f_export_policy',
    'Mask': 'f_mask',
    'Preference': 'f_preference',
    'Networks (network,area)': 'f_networks_area',
    'Networks': 'f_networks',
    'Level (1/2)': 'f_level_1_2',
    'NET': 'f_net',
    'Level': 'f_level',
    'Interfaces': 'f_interfaces',
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('routing_cfg.title', 'Routing Config Builder')}</div>
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('routing_cfg.platform', 'Platform / Vendor')}</label>
            <select className="select" value={platform} onChange={e => { setPlatform(e.target.value); setValues({}); }}>
              {ROUTING_PLATFORMS.map(p => <option key={p.id} value={p.id}>{PLAT_LABELS[p.id]}</option>)}
            </select>
            <div className="hint">{t('routing_cfg.platform_hint', 'Select device platform for syntax-specific output')}</div>
          </div>
          <div className="field">
            <label className="label">{t('routing_cfg.protocol', 'Routing Protocol')}</label>
            <select className="select" value={protocol} onChange={e => { setProtocol(e.target.value); setValues({}); }}>
              {PROTOCOLS.map(p => <option key={p} value={p}>{p.toUpperCase()}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('routing_cfg.params', 'Configuration Parameters')}</div>
        <div style={{display:'grid',gridTemplateColumns: fields.some(f=>f.multiline) ? '1fr' : 'repeat(auto-fill,minmax(280px,1fr))', gap:8}}>
          {fields.map(f => (
            <div key={f.id} className="field">
              <label className="label">{t('routing_cfg.' + (FIELD_LBL[f.label] || ''), f.label)} {f.required && <span style={{color:'var(--red)'}}>*</span>}</label>
              {f.multiline ? (
                <textarea className="input" value={values[f.id]||''} onChange={e=>setField(f.id,e.target.value)}
                  placeholder={f.placeholder} rows={3} style={{fontFamily:'var(--mono)',fontSize:12,resize:'vertical'}}/>
              ) : (
                <input className="input" value={values[f.id]||''} onChange={e=>setField(f.id,e.target.value)}
                  placeholder={f.placeholder} style={f.id==='mask'||f.id==='router_id'?{fontFamily:'var(--mono)'}:{}}/>
              )}
              <div className="hint">{f.placeholder}</div>
            </div>
          ))}
        </div>
      </div>

      {generated && (
        <div className="card fadein">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div className="card-title" style={{marginBottom:0}}>
              {t('routing_cfg.output', 'Generated Config')} — <span style={{color:'var(--cyan)'}}>{PLAT_LABELS[platform]}</span> / <span style={{color:'var(--green)'}}>{protocol.toUpperCase()}</span>
            </div>
            <button className={`btn ${copied?'btn-primary':'btn-ghost'} btn-sm`} onClick={handleCopy}>
              {copied ? t('common.copied', 'Copied') : t('common.copy', 'Copy')}
            </button>
          </div>
          <pre style={{
            background:'var(--panel)', border:'1px solid var(--border)', borderRadius:'var(--radius)',
            padding:16, fontFamily:'var(--mono)', fontSize:12, lineHeight:1.7,
            overflow:'auto', whiteSpace:'pre-wrap', color:'var(--text)', maxHeight:500
          }}>
            {generated}
          </pre>
          <div className="hint" style={{marginTop:8}}>
            {t('routing_cfg.disclaimer', '⚠ Review before applying. This is a template — adapt IPs, interfaces, and policies to your environment.')}
          </div>
        </div>
      )}

      {/* Quick Reference */}
      <div className="card">
        <div className="card-title">{t('routing_cfg.quick_ref', 'Protocol Quick Reference')}</div>
        <div className="two-col grid-mobile-1">
          <div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
              <strong style={{color:'var(--green)'}}>OSPF</strong> {t('routing_cfg.qr_ospf_desc', '— AD: 110 · Link-state · Areas · LSA Types 1-7')}
              <div style={{background:'var(--panel)',padding:6,borderRadius:4,fontFamily:'var(--mono)',fontSize:11,marginTop:4,color:'var(--cyan)'}}>
                {t('routing_cfg.qr_ospf_cost', 'Cost = Reference BW / Interface BW')}<br/>
                {t('routing_cfg.qr_ospf_ref_bw', 'Default Ref BW = 100 Mbps (10⁸)')}
              </div>
            </div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7,marginTop:12}}>
              <strong style={{color:'var(--cyan)'}}>EIGRP</strong> {t('routing_cfg.qr_eigrp_desc', '— AD: 90 (internal) / 170 (external) · Advanced DV · DUAL')}
              <div style={{background:'var(--panel)',padding:6,borderRadius:4,fontFamily:'var(--mono)',fontSize:11,marginTop:4,color:'var(--cyan)'}}>
                {t('routing_cfg.qr_eigrp_metric', 'Metric = 256×((10⁷/BW)+Delay)')}
              </div>
            </div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7,marginTop:12}}>
              <strong style={{color:'var(--yellow)'}}>RIP</strong> {t('routing_cfg.qr_rip_desc', '— AD: 120 · Distance-vector · Max 15 hops · v2 supports VLSM')}
            </div>
          </div>
          <div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
              <strong style={{color:'var(--purple)'}}>BGP</strong> {t('routing_cfg.qr_bgp_desc', '— AD: 20 (eBGP) / 200 (iBGP) · Path-vector · Policy-rich')}
              <div style={{background:'var(--panel)',padding:6,borderRadius:4,fontFamily:'var(--mono)',fontSize:11,marginTop:4,color:'var(--cyan)'}}>
                {t('routing_cfg.qr_bgp_best_1', 'Best Path: Weight → LocalPref → Originate')}<br/>
                {t('routing_cfg.qr_bgp_best_2', '→ AS-Path → Origin → MED → eBGP>iBGP')}
              </div>
            </div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7,marginTop:12}}>
              <strong style={{color:'var(--magenta)'}}>IS-IS</strong> {t('routing_cfg.qr_isis_desc', '— AD: 115 · Link-state · CLNS/OSI · L1/L2')}
              <div style={{background:'var(--panel)',padding:6,borderRadius:4,fontFamily:'var(--mono)',fontSize:11,marginTop:4,color:'var(--cyan)'}}>
                {t('routing_cfg.qr_isis_net', 'NET: 49.0001.0000.0000.0001.00')}
              </div>
            </div>
            <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7,marginTop:12}}>
              <strong style={{color:'var(--text)'}}>Static</strong> {t('routing_cfg.qr_static_desc', '— AD: 1 (default) / 5 (floating) · Manual · No convergence')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
window.RoutingConfigBuilder = RoutingConfigBuilder;
