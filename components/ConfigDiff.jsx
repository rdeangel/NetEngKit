const { useState, useEffect, useCallback, useMemo, useRef } = React;

// ── Noise patterns (lines that carry no functional meaning) ──────────
const NOISE_PATTERNS = [
  /^!\s*Last (configuration|config) change\b/i,
  /^!\s*NVRAM config last (updated|saved)\b/i,
  /^ntp clock-period\b/i,
  /^version\s+\d/i,
  /^boot-start-marker/i,
  /^boot-end-marker/i,
  /^building configuration\.\.\./i,
  /^Current configuration\s*:/i,
  /^!\s*$/,
  /^end\s*$/,
  /^#config-version=/i,   // FortiOS export header
  /^#TMSH-VERSION:/,      // F5 BIG-IP version header
];

// ── Section header rules by platform ────────────────────────────────
const SECTION_RULES = {
  'cisco-iosxe': [
    { re: /^interface\s+(\S+)/i, type: 'interface' },
    { re: /^router\s+(\S+)/i, type: 'routing' },
    { re: /^ip\s+route\s+/i, type: 'routing', name: 'static-routes' },
    { re: /^ip\s+(?:prefix-list|as-path)\s+(\S+)/i, type: 'routing' },
    { re: /^route-map\s+(\S+)/i, type: 'routing' },
    { re: /^(?:ip\s+)?access-list\s+(?:extended\s+|standard\s+)?(\S+)/i, type: 'acl' },
    { re: /^ip\s+community-list\s+/i, type: 'routing', name: 'community-lists' },
    { re: /^policy-map\s+(\S+)/i, type: 'qos' },
    { re: /^class-map\s+(\S+)/i, type: 'qos' },
    { re: /^line\s+(console|vty|aux)\s*/i, type: 'line' },
    { re: /^controller\s+(\S+)/i, type: 'controller' },
    { re: /^banner\s+(\S+)/i, type: 'banner' },
    { re: /^hostname\s+/i, type: 'system', name: 'hostname' },
  ],
  'cisco-nxos': [
    { re: /^interface\s+(\S+)/i, type: 'interface' },
    { re: /^router\s+(\S+)/i, type: 'routing' },
    { re: /^vrf(?:\s+context)?\s+(\S+)/i, type: 'vrf' },
    { re: /^vlan\s+(\d+)/i, type: 'vlan' },
    { re: /^vpc\s+(\S+)/i, type: 'vpc' },
    { re: /^(?:ip\s+)?access-list\s+(\S+)/i, type: 'acl' },
    { re: /^route-map\s+(\S+)/i, type: 'routing' },
    { re: /^policy-map\s+(\S+)/i, type: 'qos' },
    { re: /^class-map\s+(\S+)/i, type: 'qos' },
    { re: /^line\s+(console|vty)\s*/i, type: 'line' },
    { re: /^feature\s+/i, type: 'feature' },
    { re: /^banner\s+/i, type: 'banner' },
    { re: /^hostname\s+/i, type: 'system', name: 'hostname' },
  ],
  'cisco-iosxr': [
    { re: /^interface\s+(\S+)/i, type: 'interface' },
    { re: /^router\s+(\S+)/i, type: 'routing' },
    { re: /^route-policy\s+(\S+)/i, type: 'routing' },
    { re: /^prefix-set\s+(\S+)/i, type: 'routing' },
    { re: /^community-set\s+(\S+)/i, type: 'routing' },
    { re: /^as-path-set\s+(\S+)/i, type: 'routing' },
    { re: /^extcommunity-set\s+(\S+)/i, type: 'routing' },
    { re: /^policy-map\s+(\S+)/i, type: 'qos' },
    { re: /^class-map\s+(\S+)/i, type: 'qos' },
    { re: /^ipv4\s+access-list\s+(\S+)/i, type: 'acl' },
    { re: /^ipv6\s+access-list\s+(\S+)/i, type: 'acl' },
    { re: /^vrf\s+(\S+)/i, type: 'vrf' },
    { re: /^line\s+\S+/i, type: 'line' },
    { re: /^hostname\b/i, type: 'system', name: 'hostname' },
    { re: /^banner\s+(\S+)/i, type: 'banner' },
    { re: /^mpls\s+/i, type: 'routing', name: 'mpls' },
    { re: /^segment-routing\b/i, type: 'routing', name: 'segment-routing' },
    { re: /^l2vpn\b/i, type: 'routing', name: 'l2vpn' },
  ],
  'cisco-asa': [
    { re: /^interface\s+(\S+)/i, type: 'interface' },
    { re: /^access-list\s+(\S+)/i, type: 'acl' },
    { re: /^access-group\s+(\S+)/i, type: 'acl' },
    { re: /^object-group\s+\S+\s+(\S+)/i, type: 'acl' },
    { re: /^object\s+(?:network|service)\s+(\S+)/i, type: 'acl' },
    { re: /^nat\s*\(/i, type: 'routing', name: 'nat' },
    { re: /^route\s+(\S+)/i, type: 'routing' },
    { re: /^crypto\s+map\s+(\S+)/i, type: 'system' },
    { re: /^tunnel-group\s+(\S+)/i, type: 'system' },
    { re: /^group-policy\s+(\S+)/i, type: 'system' },
    { re: /^class-map\s+(\S+)/i, type: 'qos' },
    { re: /^policy-map\s+(\S+)/i, type: 'qos' },
    { re: /^hostname\b/i, type: 'system', name: 'hostname' },
    { re: /^banner\s+(\S+)/i, type: 'banner' },
    { re: /^aaa-server\s+(\S+)/i, type: 'system' },
    { re: /^username\s+(\S+)/i, type: 'system' },
  ],
  'junos': [
    { re: /^interfaces\s*\{/i, type: 'interface' },
    { re: /^protocols\s*\{/i, type: 'routing' },
    { re: /^policy-options\s*\{/i, type: 'routing' },
    { re: /^routing-instances\s*\{/i, type: 'routing' },
    { re: /^routing-options\s*\{/i, type: 'routing' },
    { re: /^firewall\s*\{/i, type: 'acl' },
    { re: /^class-of-service\s*\{/i, type: 'qos' },
    { re: /^system\s*\{/i, type: 'system' },
    { re: /^snmp\s*\{/i, type: 'system' },
    { re: /^security\s*\{/i, type: 'acl' },
    { re: /^groups\s*\{/i, type: 'groups' },
    { re: /^apply-groups\b/i, type: 'groups' },
    { re: /^vlans\s*\{/i, type: 'vlan' },
    { re: /^switch-options\s*\{/i, type: 'system' },
    { re: /^virtual-chassis\s*\{/i, type: 'system' },
    { re: /^chassis\s*\{/i, type: 'system' },
    { re: /^forwarding-options\s*\{/i, type: 'routing' },
  ],
  'arista': [
    { re: /^interface\s+(\S+)/i, type: 'interface' },
    { re: /^router\s+(\S+)/i, type: 'routing' },
    { re: /^ip\s+access-list\s+(\S+)/i, type: 'acl' },
    { re: /^ip\s+prefix-list\s+(\S+)/i, type: 'routing' },
    { re: /^route-map\s+(\S+)/i, type: 'routing' },
    { re: /^policy-map\s+(\S+)/i, type: 'qos' },
    { re: /^class-map\s+(\S+)/i, type: 'qos' },
    { re: /^vlan\s+(\d+)/i, type: 'vlan' },
    { re: /^vrf\s+instance\s+(\S+)/i, type: 'vrf' },
    { re: /^line\s+(console|vty)\s*/i, type: 'line' },
    { re: /^banner\s+/i, type: 'banner' },
    { re: /^hostname\s+/i, type: 'system', name: 'hostname' },
    { re: /^management\s+/i, type: 'system' },
    { re: /^daemon\s+/i, type: 'system' },
    { re: /^spanning-tree\b/i, type: 'system' },
  ],
  'aruba': [
    { re: /^interface\s+(\S+)/i, type: 'interface' },
    { re: /^router\s+(\S+)/i, type: 'routing' },
    { re: /^vrf\s+(\S+)/i, type: 'vrf' },
    { re: /^vlan\s+(\d+)/i, type: 'vlan' },
    { re: /^ip\s+access-list\s+(\S+)/i, type: 'acl' },
    { re: /^ipv6\s+access-list\s+(\S+)/i, type: 'acl' },
    { re: /^route-map\s+(\S+)/i, type: 'routing' },
    { re: /^ip\s+prefix-list\s+(\S+)/i, type: 'routing' },
    { re: /^class\s+(\S+)/i, type: 'qos' },
    { re: /^policy\s+(\S+)/i, type: 'qos' },
    { re: /^spanning-tree\b/i, type: 'system', name: 'spanning-tree' },
    { re: /^hostname\b/i, type: 'system', name: 'hostname' },
    { re: /^banner\s+(\S+)/i, type: 'banner' },
  ],
  'huawei': [
    { re: /^interface\s+(\S+)/i, type: 'interface' },
    { re: /^bgp\s+(\d+)/i, type: 'routing' },
    { re: /^ospf\s*(\d*)/i, type: 'routing', name: 'ospf' },
    { re: /^isis\s*(\d*)/i, type: 'routing', name: 'isis' },
    { re: /^vlan\s+(\S+)/i, type: 'vlan' },
    { re: /^ip\s+vpn-instance\s+(\S+)/i, type: 'vrf' },
    { re: /^acl\s+(?:number\s+|name\s+)?(\S+)/i, type: 'acl' },
    { re: /^traffic\s+classifier\s+(\S+)/i, type: 'qos' },
    { re: /^traffic\s+behavior\s+(\S+)/i, type: 'qos' },
    { re: /^qos\s+policy\s+(\S+)/i, type: 'qos' },
    { re: /^route-policy\s+(\S+)/i, type: 'routing' },
    { re: /^ip\s+ip-prefix\s+(\S+)/i, type: 'routing' },
    { re: /^ip\s+(?:community-filter|as-path-filter)\s+(\S+)/i, type: 'routing' },
    { re: /^sysname\b/i, type: 'system', name: 'sysname' },
    { re: /^aaa\b/i, type: 'system', name: 'aaa' },
    { re: /^ntp-service\b/i, type: 'system', name: 'ntp' },
    { re: /^snmp-agent\b/i, type: 'system', name: 'snmp' },
    { re: /^info-center\b/i, type: 'system', name: 'syslog' },
  ],
  'comware': [
    { re: /^interface\s+(\S+)/i, type: 'interface' },
    { re: /^bgp\s+(\d+)/i, type: 'routing' },
    { re: /^ospf\s*(\d*)/i, type: 'routing', name: 'ospf' },
    { re: /^isis\s*(\d*)/i, type: 'routing', name: 'isis' },
    { re: /^vlan\s+(\S+)/i, type: 'vlan' },
    { re: /^ip\s+vpn-instance\s+(\S+)/i, type: 'vrf' },
    { re: /^acl\s+(?:number\s+|name\s+|advanced\s+|basic\s+)?(\S+)/i, type: 'acl' },
    { re: /^traffic\s+classifier\s+(\S+)/i, type: 'qos' },
    { re: /^traffic\s+behavior\s+(\S+)/i, type: 'qos' },
    { re: /^qos\s+policy\s+(\S+)/i, type: 'qos' },
    { re: /^route-policy\s+(\S+)/i, type: 'routing' },
    { re: /^ip\s+prefix-list\s+(\S+)/i, type: 'routing' },
    { re: /^ip\s+community-list\s+/i, type: 'routing', name: 'community-lists' },
    { re: /^sysname\b/i, type: 'system', name: 'sysname' },
    { re: /^aaa\b/i, type: 'system', name: 'aaa' },
    { re: /^ntp-service\b/i, type: 'system', name: 'ntp' },
    { re: /^snmp-agent\b/i, type: 'system', name: 'snmp' },
    { re: /^info-center\b/i, type: 'system', name: 'syslog' },
  ],
  'dell': [
    { re: /^interface\s+(\S+)/i, type: 'interface' },
    { re: /^router\s+(\S+)/i, type: 'routing' },
    { re: /^vrf\s+(\S+)/i, type: 'vrf' },
    { re: /^vlan\s+(\d+)/i, type: 'vlan' },
    { re: /^ip\s+access-list\s+(\S+)/i, type: 'acl' },
    { re: /^ipv6\s+access-list\s+(\S+)/i, type: 'acl' },
    { re: /^ip\s+prefix-list\s+(\S+)/i, type: 'routing' },
    { re: /^route-map\s+(\S+)/i, type: 'routing' },
    { re: /^class-map\s+(\S+)/i, type: 'qos' },
    { re: /^policy-map\s+(\S+)/i, type: 'qos' },
    { re: /^spanning-tree\b/i, type: 'system', name: 'spanning-tree' },
    { re: /^hostname\b/i, type: 'system', name: 'hostname' },
    { re: /^line\s+\S+/i, type: 'line' },
    { re: /^banner\s+(\S+)/i, type: 'banner' },
  ],
  'paloalto': [
    // PAN-OS "set" flat format — group by second-level path token
    { re: /^set\s+network\s+interface\s+/i, type: 'interface', name: 'interfaces' },
    { re: /^set\s+network\s+virtual-router\s+/i, type: 'routing', name: 'virtual-routers' },
    { re: /^set\s+network\s+vlan\s+/i, type: 'vlan', name: 'vlans' },
    { re: /^set\s+network\s+tunnel\s+/i, type: 'system', name: 'tunnels' },
    { re: /^set\s+network\s+/i, type: 'system', name: 'network' },
    { re: /^set\s+policy\s+security\s+/i, type: 'acl', name: 'security-policy' },
    { re: /^set\s+policy\s+nat\s+/i, type: 'routing', name: 'nat-policy' },
    { re: /^set\s+policy\s+/i, type: 'acl', name: 'policy' },
    { re: /^set\s+zone\s+/i, type: 'system', name: 'zones' },
    { re: /^set\s+address\s+/i, type: 'acl', name: 'address-objects' },
    { re: /^set\s+service\s+/i, type: 'acl', name: 'service-objects' },
    { re: /^set\s+application\s+/i, type: 'acl', name: 'app-objects' },
    { re: /^set\s+deviceconfig\s+/i, type: 'system', name: 'deviceconfig' },
    { re: /^set\s+shared\s+/i, type: 'system', name: 'shared' },
  ],
  'fortios': [
    // FortiOS "config X" block format — match the opening "config" line
    { re: /^config\s+system\s+interface\b/i, type: 'interface', name: 'interfaces' },
    { re: /^config\s+firewall\s+policy\b/i, type: 'acl', name: 'fw-policy' },
    { re: /^config\s+firewall\s+address\b/i, type: 'acl', name: 'fw-addresses' },
    { re: /^config\s+firewall\s+service\b/i, type: 'acl', name: 'fw-services' },
    { re: /^config\s+firewall\s+/i, type: 'acl', name: 'firewall' },
    { re: /^config\s+router\s+bgp\b/i, type: 'routing', name: 'bgp' },
    { re: /^config\s+router\s+ospf\b/i, type: 'routing', name: 'ospf' },
    { re: /^config\s+router\s+isis\b/i, type: 'routing', name: 'isis' },
    { re: /^config\s+router\s+static\b/i, type: 'routing', name: 'static-routes' },
    { re: /^config\s+router\s+/i, type: 'routing', name: 'routing' },
    { re: /^config\s+vpn\s+/i, type: 'system', name: 'vpn' },
    { re: /^config\s+switch-controller\s+vlan\b/i, type: 'vlan', name: 'vlans' },
    { re: /^config\s+user\s+/i, type: 'system', name: 'users' },
    { re: /^config\s+log\s+/i, type: 'system', name: 'logging' },
    { re: /^config\s+vdom\b/i, type: 'vrf', name: 'vdom' },
    { re: /^config\s+system\s+/i, type: 'system', name: 'system' },
  ],
  'checkpoint': [
    // Check Point Gaia clish flat format
    { re: /^(?:add|set)\s+interface\s+(\S+)/i, type: 'interface' },
    { re: /^add\s+bonding\s+group\s+(\S+)/i, type: 'interface' },
    { re: /^(?:add|set)\s+static-route\b/i, type: 'routing', name: 'static-routes' },
    { re: /^add\s+route\b/i, type: 'routing', name: 'static-routes' },
    { re: /^(?:add|set)\s+routed\s+/i, type: 'routing', name: 'routing' },
    { re: /^set\s+hostname\b/i, type: 'system', name: 'hostname' },
    { re: /^set\s+domainname\b/i, type: 'system', name: 'domain' },
    { re: /^set\s+dns\b/i, type: 'system', name: 'dns' },
    { re: /^(?:add|set)\s+ntp\b/i, type: 'system', name: 'ntp' },
    { re: /^(?:add|set)\s+tacacs-server/i, type: 'system', name: 'tacacs' },
    { re: /^(?:add|set)\s+radius-server/i, type: 'system', name: 'radius' },
    { re: /^(?:add|set)\s+user\s+/i, type: 'system', name: 'users' },
    { re: /^set\s+snmp\b/i, type: 'system', name: 'snmp' },
    { re: /^set\s+syslog\b/i, type: 'system', name: 'syslog' },
  ],
  'vyos': [
    // VyOS "set path …" flat format — group by top-level path
    { re: /^set\s+interfaces\s+/i, type: 'interface', name: 'interfaces' },
    { re: /^set\s+protocols\s+/i, type: 'routing', name: 'protocols' },
    { re: /^set\s+firewall\s+/i, type: 'acl', name: 'firewall' },
    { re: /^set\s+nat\s+/i, type: 'routing', name: 'nat' },
    { re: /^set\s+policy\s+/i, type: 'routing', name: 'policy' },
    { re: /^set\s+system\s+/i, type: 'system', name: 'system' },
    { re: /^set\s+service\s+/i, type: 'system', name: 'service' },
    { re: /^set\s+vpn\s+/i, type: 'system', name: 'vpn' },
    { re: /^set\s+vrf\s+(\S+)/i, type: 'vrf' },
    // Hierarchical brace format (older/alternative VyOS style)
    { re: /^interfaces\s*\{/i, type: 'interface', name: 'interfaces' },
    { re: /^protocols\s*\{/i, type: 'routing', name: 'protocols' },
    { re: /^firewall\s*\{/i, type: 'acl', name: 'firewall' },
    { re: /^system\s*\{/i, type: 'system', name: 'system' },
  ],
  'extreme': [
    // Extreme EXOS flat command format — group by topic
    { re: /^(?:create|configure|enable|disable)\s+vlan\s+(\S+)/i, type: 'vlan' },
    { re: /^(?:create|configure|enable|disable)\s+bgp\b/i, type: 'routing', name: 'bgp' },
    { re: /^(?:create|configure|enable|disable)\s+ospf\b/i, type: 'routing', name: 'ospf' },
    { re: /^(?:create|configure|enable|disable)\s+isis\b/i, type: 'routing', name: 'isis' },
    { re: /^(?:create|configure|enable|disable)\s+mpls\b/i, type: 'routing', name: 'mpls' },
    { re: /^configure\s+ipforwarding\b/i, type: 'routing', name: 'ip-forwarding' },
    { re: /^(?:create|configure)\s+access-list\s+(\S+)/i, type: 'acl' },
    { re: /^configure\s+qos\b/i, type: 'qos', name: 'qos' },
    { re: /^(?:configure|enable|disable)\s+ports?\s+(\S+)/i, type: 'interface' },
    { re: /^enable\s+sharing\s+(\S+)/i, type: 'interface' },
    { re: /^configure\s+sys-name\b/i, type: 'system', name: 'hostname' },
    { re: /^configure\s+(?:dns-client|ntp|syslog|snmp|tacacs|radius)\b/i, type: 'system', name: 'system' },
  ],
  'mikrotik': [
    // MikroTik RouterOS /path section headers
    { re: /^\/interface\s+(?:bridge\s+)?vlan\b/i, type: 'vlan', name: 'vlans' },
    { re: /^\/interface\b/i, type: 'interface', name: 'interface' },
    { re: /^\/ip\s+address\b/i, type: 'interface', name: 'ip-addresses' },
    { re: /^\/routing\b/i, type: 'routing', name: 'routing' },
    { re: /^\/ip\s+route\b/i, type: 'routing', name: 'ip-routes' },
    { re: /^\/mpls\b/i, type: 'routing', name: 'mpls' },
    { re: /^\/ip\s+firewall\b/i, type: 'acl', name: 'ip-firewall' },
    { re: /^\/ipv6\s+firewall\b/i, type: 'acl', name: 'ipv6-firewall' },
    { re: /^\/ip\s+pool\b/i, type: 'system', name: 'ip-pools' },
    { re: /^\/ip\s+service\b/i, type: 'system', name: 'ip-services' },
    { re: /^\/ip\s+dns\b/i, type: 'system', name: 'dns' },
    { re: /^\/ip\s+ipsec\b/i, type: 'system', name: 'ipsec' },
    { re: /^\/snmp\b/i, type: 'system', name: 'snmp' },
    { re: /^\/user\b/i, type: 'system', name: 'users' },
    { re: /^\/system\b/i, type: 'system', name: 'system' },
    { re: /^\/vpn\b/i, type: 'system', name: 'vpn' },
  ],
  'f5': [
    // F5 BIG-IP TMOS module blocks
    { re: /^ltm\s+virtual\s+(\S+)/i, type: 'interface', name: 'virtual-servers' },
    { re: /^ltm\s+pool\s+(\S+)/i, type: 'routing', name: 'pools' },
    { re: /^ltm\s+node\s+(\S+)/i, type: 'routing', name: 'nodes' },
    { re: /^ltm\s+rule\s+(\S+)/i, type: 'acl', name: 'irules' },
    { re: /^ltm\s+snat\s+/i, type: 'routing', name: 'snat' },
    { re: /^ltm\s+profile\s+/i, type: 'system', name: 'profiles' },
    { re: /^ltm\s+monitor\s+/i, type: 'system', name: 'monitors' },
    { re: /^ltm\s+persistence\s+/i, type: 'system', name: 'persistence' },
    { re: /^net\s+interface\s+(\S+)/i, type: 'interface' },
    { re: /^net\s+trunk\s+(\S+)/i, type: 'interface', name: 'trunks' },
    { re: /^net\s+vlan\s+(\S+)/i, type: 'vlan' },
    { re: /^net\s+self\s+(\S+)/i, type: 'interface', name: 'self-ips' },
    { re: /^net\s+route\s+/i, type: 'routing', name: 'routes' },
    { re: /^sys\s+/i, type: 'system', name: 'system' },
    { re: /^auth\s+/i, type: 'system', name: 'auth' },
    { re: /^security\s+/i, type: 'acl', name: 'security' },
    { re: /^gtm\s+/i, type: 'routing', name: 'gtm' },
  ],
};

// ── Platform list (mirrors ConfigParser VENDORS) ─────────────────────
const PLATFORMS = [
  { id: 'auto' },
  { id: 'cisco-iosxe' },
  { id: 'cisco-nxos' },
  { id: 'cisco-iosxr' },
  { id: 'cisco-asa' },
  { id: 'junos' },
  { id: 'arista' },
  { id: 'aruba' },
  { id: 'huawei' },
  { id: 'comware' },
  { id: 'dell' },
  { id: 'paloalto' },
  { id: 'fortios' },
  { id: 'checkpoint' },
  { id: 'vyos' },
  { id: 'extreme' },
  { id: 'mikrotik' },
  { id: 'f5' },
];

const PLATFORM_MIGRATION = { ios: 'cisco-iosxe', nxos: 'cisco-nxos', eos: 'arista' };

// ── Auto-detect platform from config text ────────────────────────────
function detectPlatform(text) {
  if (/^config\s+(system|firewall|router)\b/m.test(text)) return 'fortios';
  if (/^set\s+(?:network|deviceconfig|zone)\s+/m.test(text) ||
      /^set\s+policy\s+(?:security|nat)\s+/m.test(text)) return 'paloalto';
  if (/^\/ip[\s/]|^\/interface\s|^\/routing\s|^\/system\s/m.test(text)) return 'mikrotik';
  if (/^(?:ltm|net|sys)\s+\S+\s+\/\S/m.test(text)) return 'f5';
  if (/^set\s+(?:interfaces|protocols|firewall|nat)\s+/m.test(text)) return 'vyos';
  if (/^[a-z][a-z-]+\s*\{/m.test(text) || /^set\s+\S*\/\S/m.test(text)) return 'junos';
  if (/^(?:set|add)\s+(?:interface|static-route|routed|bonding)\b/m.test(text)) return 'checkpoint';
  if (/^(?:route-policy|prefix-set|community-set|as-path-set)\b/m.test(text)) return 'cisco-iosxr';
  if (/^(?:nameif|security-level|same-security-traffic)\b/m.test(text)) return 'cisco-asa';
  if (/^feature\s|^vpc\s/m.test(text)) return 'cisco-nxos';
  if (/^!Version ArubaOS-CX\b/m.test(text)) return 'aruba';
  if (/^!\s*Version\s+\S+\s+Dell\b/m.test(text)) return 'dell';
  if (/^(?:create|configure)\s+vlan\b/m.test(text) || /^configure\s+(?:bgp|ospf)\b/m.test(text)) return 'extreme';
  if (/^daemon\s|^management\s+\S+\s*\{/m.test(text)) return 'arista';
  if (/^sysname\s/m.test(text)) return 'huawei';
  return 'cisco-iosxe';
}

// ── Auto-detect input format ──────────────────────────────────────────
function detectFormat(text) {
  const t = text.trim();
  if (!t) return 'text';

  // 1. JSON
  if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
    try {
      JSON.parse(t);
      return 'json';
    } catch (e) {}
  }

  // 2. XML
  if (t.startsWith('<') && t.endsWith('>')) {
    try {
      const doc = new DOMParser().parseFromString(t, 'text/xml');
      if (!doc.querySelector('parsererror')) {
        return 'xml';
      }
    } catch (e) {}
  }

  // 3. Markdown Table
  if (t.includes('|') && /\|[^\n]+\|\r?\n\s*\|[\s-|-]+\|\r?\n/m.test(t)) {
    return 'markdown';
  }

  // 4. JSONL
  if (t.includes('\n')) {
    const lines = t.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (lines.length > 0 && lines.every(l => l.startsWith('{') && l.endsWith('}'))) {
      try {
        lines.forEach(l => JSON.parse(l));
        return 'jsonl';
      } catch (e) {}
    }
  }

  // 5. TOML / INI
  if (t.includes('[') && t.includes(']')) {
    if (/^\s*\[[^\]]+\]/m.test(t)) {
      try {
        const utils = window.FormatToolkitUtils;
        if (utils && utils.tomlToJson) {
          JSON.parse(utils.tomlToJson(t));
          return 'toml';
        }
      } catch (e) {}
      try {
        const utils = window.FormatToolkitUtils;
        if (utils && utils.iniToJson) {
          JSON.parse(utils.iniToJson(t));
          return 'ini';
        }
      } catch (e) {}
    }
  }

  // 6. YAML
  if (t.includes(':') || t.startsWith('- ')) {
    try {
      if (window.jsyaml) {
        const doc = window.jsyaml.load(t);
        if (doc && typeof doc === 'object' && Object.keys(doc).length > 0) {
          return 'yaml';
        }
      }
    } catch (e) {}
  }

  // 7. CSV / TSV
  if (t.includes('\n')) {
    const lines = t.split(/\n/);
    if (lines.length > 1) {
      if (lines[0].includes('\t')) return 'tsv';
      if (lines[0].includes(',')) return 'csv';
    }
  }

  return 'text';
}

// ── Parse input text into JS object ───────────────────────────────────
function parseFormat(text, format) {
  const t = text.trim();
  if (!t) return null;

  const utils = window.FormatToolkitUtils || {};

  switch (format) {
    case 'json':
      return JSON.parse(t);
    case 'xml': {
      const xmlToJson = utils.xmlToJson;
      if (!xmlToJson) throw new Error('XML parsing utility not available');
      return xmlToJson(t);
    }
    case 'yaml': {
      const yamlToObj = utils.yamlToObj;
      if (!yamlToObj) {
        if (window.jsyaml) return window.jsyaml.load(t);
        throw new Error('YAML library not loaded');
      }
      return yamlToObj(t);
    }
    case 'csv': {
      const csvToJson = utils.csvToJson;
      if (!csvToJson) throw new Error('CSV parsing utility not available');
      return JSON.parse(csvToJson(t));
    }
    case 'tsv': {
      const tsvToJson = utils.tsvToJson;
      if (!tsvToJson) throw new Error('TSV parsing utility not available');
      return JSON.parse(tsvToJson(t));
    }
    case 'toml': {
      const tomlToJson = utils.tomlToJson;
      if (!tomlToJson) throw new Error('TOML parsing utility not available');
      return JSON.parse(tomlToJson(t));
    }
    case 'ini': {
      const iniToJson = utils.iniToJson;
      if (!iniToJson) throw new Error('INI parsing utility not available');
      return JSON.parse(iniToJson(t));
    }
    case 'jsonl': {
      const jsonlToJson = utils.jsonlToJson;
      if (!jsonlToJson) throw new Error('JSONL parsing utility not available');
      return JSON.parse(jsonlToJson(t));
    }
    case 'markdown': {
      const markdownTableToJson = utils.markdownTableToJson;
      if (!markdownTableToJson) throw new Error('Markdown parsing utility not available');
      return JSON.parse(markdownTableToJson(t));
    }
    default:
      throw new Error('Unsupported format');
  }
}

// ── Format object back to target format ──────────────────────────────
function formatObject(obj, format) {
  if (obj === null || obj === undefined) return '';

  const utils = window.FormatToolkitUtils || {};

  switch (format) {
    case 'json':
      return JSON.stringify(obj, null, 2);
    case 'xml': {
      const jsonToXml = utils.jsonToXml;
      if (!jsonToXml) throw new Error('XML serialization utility not available');
      return '<?xml version="1.0" encoding="UTF-8"?>\n' + jsonToXml(obj, 0, 'root');
    }
    case 'yaml': {
      const jsonToYaml = utils.jsonToYaml;
      if (!jsonToYaml) {
        if (window.jsyaml) return window.jsyaml.dump(obj, { indent: 2, lineWidth: 120, noRefs: true });
        throw new Error('YAML library not loaded');
      }
      return jsonToYaml(obj);
    }
    case 'csv': {
      const jsonToCsv = utils.jsonToCsv;
      if (!jsonToCsv) throw new Error('CSV serialization utility not available');
      return jsonToCsv(obj);
    }
    case 'tsv': {
      const jsonToTsv = utils.jsonToTsv;
      if (!jsonToTsv) throw new Error('TSV serialization utility not available');
      return jsonToTsv(obj);
    }
    case 'toml': {
      const jsonToToml = utils.jsonToToml;
      if (!jsonToToml) throw new Error('TOML serialization utility not available');
      return jsonToToml(obj);
    }
    case 'ini': {
      const jsonToIni = utils.jsonToIni;
      if (!jsonToIni) throw new Error('INI serialization utility not available');
      return jsonToIni(obj);
    }
    case 'jsonl': {
      const jsonToJsonl = utils.jsonToJsonl;
      if (!jsonToJsonl) throw new Error('JSONL serialization utility not available');
      return jsonToJsonl(obj);
    }
    case 'markdown': {
      const jsonToMarkdownTable = utils.jsonToMarkdownTable;
      if (!jsonToMarkdownTable) throw new Error('Markdown serialization utility not available');
      return jsonToMarkdownTable(obj);
    }
    default:
      return String(obj);
  }
}

// ── Sort object keys recursively ──────────────────────────────────────
function sortObjectKeys(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  return Object.keys(obj).sort().reduce((acc, key) => {
    acc[key] = sortObjectKeys(obj[key]);
    return acc;
  }, {});
}

// ── Preprocess inputs based on format and compare mode ───────────────
function preprocessInputs(original, modified, inputFormat, compareMode) {
  let leftText = original;
  let rightText = modified;
  let errorLeft = '';
  let errorRight = '';

  const detectedLeftFormat = inputFormat === 'auto' ? detectFormat(original) : inputFormat;
  const detectedRightFormat = inputFormat === 'auto' ? detectFormat(modified) : inputFormat;

  if (detectedLeftFormat !== 'text' || detectedRightFormat !== 'text') {
    let leftObj = null;
    let rightObj = null;

    if (detectedLeftFormat !== 'text' && original.trim()) {
      try {
        leftObj = parseFormat(original, detectedLeftFormat);
      } catch (e) {
        errorLeft = e.message;
      }
    }

    if (detectedRightFormat !== 'text' && modified.trim()) {
      try {
        rightObj = parseFormat(modified, detectedRightFormat);
      } catch (e) {
        errorRight = e.message;
      }
    }

    if (!errorLeft && !errorRight) {
      if (compareMode === 'json') {
        const sortedLeft = leftObj !== null ? sortObjectKeys(leftObj) : null;
        const sortedRight = rightObj !== null ? sortObjectKeys(rightObj) : null;

        leftText = sortedLeft !== null ? JSON.stringify(sortedLeft, null, 2) : '';
        rightText = sortedRight !== null ? JSON.stringify(sortedRight, null, 2) : '';
      } else {
        leftText = leftObj !== null ? formatObject(leftObj, detectedLeftFormat) : '';
        rightText = rightObj !== null ? formatObject(rightObj, detectedRightFormat) : '';
      }
    }
  }

  return { leftText, rightText, errorLeft, errorRight };
}


// ── Check if a line is noise ─────────────────────────────────────────
function isNoiseLine(line) {
  const t = line.trim();
  if (!t) return false;
  return NOISE_PATTERNS.some(p => p.test(t));
}

// ── Filter noise from line array, preserving original line numbers ───
function filterNoise(lines) {
  const filtered = [];
  const lineNums = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isNoiseLine(lines[i])) {
      filtered.push(lines[i]);
      lineNums.push(i + 1);
    }
  }
  return { lines: filtered, lineNums };
}

// ── LCS diff algorithm ───────────────────────────────────────────────
function computeLCS(a, b) {
  const m = a.length;
  const n = b.length;
  let prev = new Uint32Array(n + 1);
  let curr = new Uint32Array(n + 1);
  const dirs = new Uint8Array((m + 1) * (n + 1));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1;
        dirs[i * (n + 1) + j] = 0;
      } else if (prev[j] >= curr[j - 1]) {
        curr[j] = prev[j];
        dirs[i * (n + 1) + j] = 1;
      } else {
        curr[j] = curr[j - 1];
        dirs[i * (n + 1) + j] = 2;
      }
    }
    const tmp = prev; prev = curr; curr = tmp; curr.fill(0);
  }

  const ops = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && dirs[i * (n + 1) + j] === 0) {
      ops.push({ type: 'equal', li: i - 1, ri: j - 1 }); i--; j--;
    } else if (i > 0 && (j === 0 || dirs[i * (n + 1) + j] === 1)) {
      ops.push({ type: 'remove', li: i - 1 }); i--;
    } else {
      ops.push({ type: 'add', ri: j - 1 }); j--;
    }
  }
  ops.reverse();
  return ops;
}

// ── Merge adjacent remove+add into "change" pairs ────────────────────
function mergeChangedPairs(ops) {
  const merged = [];
  let idx = 0;
  while (idx < ops.length) {
    if (ops[idx].type === 'remove') {
      const removes = [];
      while (idx < ops.length && ops[idx].type === 'remove') { removes.push(ops[idx]); idx++; }
      const adds = [];
      while (idx < ops.length && ops[idx].type === 'add') { adds.push(ops[idx]); idx++; }
      const pairs = Math.min(removes.length, adds.length);
      for (let p = 0; p < pairs; p++) merged.push({ type: 'change', li: removes[p].li, ri: adds[p].ri });
      for (let p = pairs; p < removes.length; p++) merged.push(removes[p]);
      for (let p = pairs; p < adds.length; p++) merged.push(adds[p]);
    } else {
      merged.push(ops[idx]); idx++;
    }
  }
  return merged;
}

// ── Find section for each line ───────────────────────────────────────
function getSectionsForLines(lines, platform) {
  const sectionMap = new Array(lines.length).fill(null);
  let currentSection = null;
  const rules = SECTION_RULES[platform] || SECTION_RULES['cisco-iosxe'];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();
    const isIndented = line !== trimmed;

    if (!isIndented && trimmed.length > 0 && !trimmed.startsWith('!') && !trimmed.startsWith('#')) {
      let matched = false;
      for (const rule of rules) {
        const m = trimmed.match(rule.re);
        if (m) {
          const name = rule.name || (m[1] ? m[1] : trimmed.split(/\s+/).slice(0, 2).join(' '));
          currentSection = { type: rule.type, name, headerLine: i };
          matched = true;
          break;
        }
      }
      if (!matched) {
        // Unknown top-level command — still trackable as 'other' section
        const keyword = trimmed.split(/\s+/)[0];
        if (keyword.length > 0) currentSection = { type: 'other', name: keyword, headerLine: i };
      }
    }
    sectionMap[i] = currentSection;
  }
  return sectionMap;
}

// ── Main compute function ────────────────────────────────────────────
function computeDiff(originalText, modifiedText, platform, filterNoiseEnabled) {
  let origLines = originalText.split('\n');
  let modLines = modifiedText.split('\n');

  const effectivePlatform = platform === 'auto'
    ? detectPlatform(originalText + '\n' + modifiedText)
    : platform;

  let origLineNums, modLineNums;
  if (filterNoiseEnabled) {
    const of = filterNoise(origLines); const mf = filterNoise(modLines);
    origLines = of.lines; origLineNums = of.lineNums;
    modLines = mf.lines; modLineNums = mf.lineNums;
  } else {
    origLineNums = origLines.map((_, i) => i + 1);
    modLineNums = modLines.map((_, i) => i + 1);
  }

  if (origLines.length === 0 && modLines.length === 0) {
    return { ops: [], stats: { added: 0, removed: 0, modified: 0, unchanged: 0 }, sections: [], effectivePlatform, noiseFiltered: 0 };
  }

  const rawOps = computeLCS(origLines, modLines);
  const ops = mergeChangedPairs(rawOps);

  const fullOrigLines = originalText.split('\n');
  const fullModLines = modifiedText.split('\n');
  const sectionMap = getSectionsForLines(fullOrigLines, effectivePlatform);
  const modSectionMap = getSectionsForLines(fullModLines, effectivePlatform);

  const getOrigSec = (li) => { const idx = filterNoiseEnabled ? origLineNums[li] - 1 : li; return idx < sectionMap.length ? sectionMap[idx] : null; };
  const getModSec = (ri) => { const idx = filterNoiseEnabled ? modLineNums[ri] - 1 : ri; return idx < modSectionMap.length ? modSectionMap[idx] : null; };
  const secKey = (sec) => sec ? `${sec.type}:${sec.name}` : null;

  const diffRows = ops.map(op => {
    const sectionKey = op.type === 'add' ? secKey(getModSec(op.ri)) : secKey(getOrigSec(op.li));
    switch (op.type) {
      case 'equal':  return { type: 'equal',  left: origLines[op.li], right: modLines[op.ri], leftNum: origLineNums[op.li], rightNum: modLineNums[op.ri], sectionKey };
      case 'add':    return { type: 'add',    left: null, right: modLines[op.ri], leftNum: null, rightNum: modLineNums[op.ri], sectionKey };
      case 'remove': return { type: 'remove', left: origLines[op.li], right: null, leftNum: origLineNums[op.li], rightNum: null, sectionKey };
      case 'change': return { type: 'change', left: origLines[op.li], right: modLines[op.ri], leftNum: origLineNums[op.li], rightNum: modLineNums[op.ri], sectionKey };
    }
  });

  const stats = {
    added:     ops.filter(o => o.type === 'add').length,
    removed:   ops.filter(o => o.type === 'remove').length,
    modified:  ops.filter(o => o.type === 'change').length,
    unchanged: ops.filter(o => o.type === 'equal').length,
  };

  const changedSections = new Map();
  for (const op of ops) {
    if (op.type === 'equal') continue;
    const sec = op.type === 'add' ? getModSec(op.ri) : getOrigSec(op.li);
    if (sec) {
      const key = secKey(sec);
      if (!changedSections.has(key)) changedSections.set(key, { ...sec, changes: 0 });
      changedSections.get(key).changes++;
    }
  }

  const sections = Array.from(changedSections.values());
  const noiseFiltered = originalText.split('\n').filter(isNoiseLine).length
    + modifiedText.split('\n').filter(isNoiseLine).length;

  return { ops: diffRows, stats, sections, effectivePlatform, noiseFiltered };
}

// ── Mark visible rows (context around changes) ───────────────────────
function computeVisibility(rows, contextLines) {
  const visible = new Array(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].type !== 'equal') {
      for (let j = Math.max(0, i - contextLines); j <= Math.min(rows.length - 1, i + contextLines); j++) {
        visible[j] = true;
      }
    }
  }
  return visible;
}

// ── Export helpers ────────────────────────────────────────────────────
function exportPlainText(rows) {
  let out = '--- Original\n+++ Modified\n';
  for (const row of rows) {
    if (row.type === 'equal') out += '  ' + (row.left || '') + '\n';
    else if (row.type === 'remove') out += '- ' + (row.left || '') + '\n';
    else if (row.type === 'add') out += '+ ' + (row.right || '') + '\n';
    else if (row.type === 'change') { out += '- ' + (row.left || '') + '\n'; out += '+ ' + (row.right || '') + '\n'; }
  }
  return out;
}

function exportHtml(rows, stats) {
  const rowHtml = rows.map(row => {
    let bgL = '', bgR = '', prefixL = '&nbsp;', prefixR = '&nbsp;';
    if (row.type === 'add') { bgR = 'background:#1a3a1a;'; prefixR = '+'; }
    else if (row.type === 'remove') { bgL = 'background:#3a1a1a;'; prefixL = '-'; }
    else if (row.type === 'change') { bgL = 'background:#3a3a1a;'; bgR = 'background:#3a3a1a;'; prefixL = '-'; prefixR = '+'; }
    const esc = s => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lnL = row.leftNum != null ? String(row.leftNum).padStart(4) : '    ';
    const lnR = row.rightNum != null ? String(row.rightNum).padStart(4) : '    ';
    return `<tr><td style="color:#888;${bgL}padding:0 8px;font-family:monospace;font-size:13px;white-space:pre;width:50px;text-align:right;border-right:1px solid #333;">${lnL}</td>` +
      `<td style="color:#f66;${bgL}padding:0 4px;font-family:monospace;font-size:13px;width:12px;">${prefixL}</td>` +
      `<td style="${bgL}padding:0 8px;font-family:monospace;font-size:13px;white-space:pre;color:#ccc;">${esc(row.left || '')}</td>` +
      `<td style="color:#888;${bgR}padding:0 8px;font-family:monospace;font-size:13px;white-space:pre;width:50px;text-align:right;border-right:1px solid #333;">${lnR}</td>` +
      `<td style="color:#6f6;${bgR}padding:0 4px;font-family:monospace;font-size:13px;width:12px;">${prefixR}</td>` +
      `<td style="${bgR}padding:0 8px;font-family:monospace;font-size:13px;white-space:pre;color:#ccc;">${esc(row.right || '')}</td></tr>`;
  }).join('\n');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Config Diff</title></head><body style="background:#0d0d12;color:#e2e8f0;margin:0;padding:20px;">
<h2 style="font-family:monospace;color:#00d4c8;">Config Diff</h2>
<p style="font-family:monospace;color:#888;font-size:13px;">+${stats.added} -${stats.removed} ~${stats.modified} (${stats.unchanged} unchanged)</p>
<table style="border-collapse:collapse;width:100%;">${rowHtml}</table>
</body></html>`;
}

// ── Inline styles ────────────────────────────────────────────────────
const styles = {
  textarea: {
    width: '100%', minHeight: 220, resize: 'vertical',
    fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.5,
    background: 'var(--panel)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius)', padding: 10, color: 'var(--text)', boxSizing: 'border-box',
  },
  diffTable: {
    width: '100%', borderCollapse: 'collapse',
    fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.6,
  },
  lineNum: {
    color: 'var(--dim)', padding: '0 8px', textAlign: 'right',
    whiteSpace: 'pre', width: 50, minWidth: 50, userSelect: 'none',
    borderRight: '1px solid var(--border)', fontSize: 12,
  },
  prefix: { padding: '0 4px', width: 16, minWidth: 16, userSelect: 'none', fontWeight: 700, fontSize: 13 },
  content: { padding: '0 8px', whiteSpace: 'pre', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 0 },
  rowAdded:   { background: 'rgba(34, 197, 94, 0.12)' },
  rowRemoved: { background: 'rgba(239, 68, 68, 0.12)' },
  rowChanged: { background: 'rgba(245, 158, 11, 0.12)' },
  rowContext:  { background: 'transparent' },
  gapRow:  { background: 'var(--card)', cursor: 'pointer', userSelect: 'none' },
  gapCell: { padding: '4px 12px', color: 'var(--dim)', fontSize: 11, fontFamily: 'var(--sans)', textAlign: 'center', letterSpacing: 0.5 },
  sectionSummary: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  sectionChip: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '4px 10px', borderRadius: 'var(--radius)', fontSize: 12,
    fontFamily: 'var(--mono)', cursor: 'pointer',
    border: '1px solid var(--border)', background: 'var(--panel)',
    color: 'var(--text)', transition: 'border-color 0.15s',
  },
  checkboxLabel: { display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' },
  diffWrapper: { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--panel)' },
  emptyState: { textAlign: 'center', padding: '40px 20px', color: 'var(--dim)', fontSize: 14 },
  divider: { width: 1, minWidth: 1, background: 'var(--border)', padding: 0 },
};

// ── Color mapping for section types ──────────────────────────────────
const SECTION_COLORS = {
  interface: { bg: 'rgba(74, 158, 255, 0.12)',   border: 'rgba(74, 158, 255, 0.3)',   text: 'var(--blue)' },
  routing:   { bg: 'rgba(167, 139, 250, 0.12)',  border: 'rgba(167, 139, 250, 0.3)',  text: 'var(--purple)' },
  acl:       { bg: 'rgba(239, 68, 68, 0.12)',    border: 'rgba(239, 68, 68, 0.3)',    text: 'var(--red)' },
  qos:       { bg: 'rgba(245, 158, 11, 0.12)',   border: 'rgba(245, 158, 11, 0.3)',   text: 'var(--yellow)' },
  system:    { bg: 'rgba(0, 212, 200, 0.12)',    border: 'rgba(0, 212, 200, 0.3)',    text: 'var(--cyan)' },
  vlan:      { bg: 'rgba(34, 197, 94, 0.12)',    border: 'rgba(34, 197, 94, 0.3)',    text: 'var(--green)' },
  vrf:       { bg: 'rgba(244, 114, 182, 0.12)',  border: 'rgba(244, 114, 182, 0.3)',  text: 'var(--tertiary)' },
  vpc:       { bg: 'rgba(244, 114, 182, 0.12)',  border: 'rgba(244, 114, 182, 0.3)',  text: 'var(--tertiary)' },
  other:     { bg: 'rgba(136, 146, 160, 0.12)',  border: 'rgba(136, 146, 160, 0.3)',  text: 'var(--muted)' },
};
const DEFAULT_SEC_COLOR = SECTION_COLORS.other;

// ── Diff Row Component ───────────────────────────────────────────────
function DiffRow({ row }) {
  const bgStyle = row.type === 'add' ? styles.rowAdded
    : row.type === 'remove' ? styles.rowRemoved
    : row.type === 'change' ? styles.rowChanged
    : styles.rowContext;

  const prefixColor = row.type === 'add' ? 'var(--green)'
    : row.type === 'remove' ? 'var(--red)'
    : row.type === 'change' ? 'var(--yellow)'
    : 'transparent';

  const prefixL = (row.type === 'remove' || row.type === 'change') ? '-' : ' ';
  const prefixR = (row.type === 'add'    || row.type === 'change') ? '+' : ' ';

  return (
    <tr style={bgStyle} data-section={row.sectionKey || undefined}>
      <td style={{ ...styles.lineNum, background: bgStyle.background }}>{row.leftNum != null ? String(row.leftNum) : ''}</td>
      <td style={{ ...styles.prefix, color: prefixColor, background: bgStyle.background }}>{prefixL}</td>
      <td style={{ ...styles.content, background: bgStyle.background, color: row.type === 'remove' ? 'var(--red)' : 'var(--text)' }}>{row.left || ''}</td>
      <td style={styles.divider}></td>
      <td style={{ ...styles.lineNum, background: bgStyle.background }}>{row.rightNum != null ? String(row.rightNum) : ''}</td>
      <td style={{ ...styles.prefix, color: prefixColor, background: bgStyle.background }}>{prefixR}</td>
      <td style={{ ...styles.content, background: bgStyle.background, color: row.type === 'add' ? 'var(--green)' : 'var(--text)' }}>{row.right || ''}</td>
    </tr>
  );
}

// ── Main Component ───────────────────────────────────────────────────
function ConfigDiff({ initialData, onShare }) {
  const { t } = useTranslation();
  const diffRef = useRef(null);

  const [original, setOriginal] = usePersistentState('diff:original', initialData?.original || '');
  const [modified, setModified] = usePersistentState('diff:modified', initialData?.modified || '');
  const [platform, setPlatform] = usePersistentState('diff:platform', initialData?.platform || 'auto');
  const [filterNoise, setFilterNoise] = usePersistentState('diff:filterNoise', initialData?.filterNoise !== undefined ? initialData.filterNoise : true);
  const [inputFormat, setInputFormat] = usePersistentState('diff:inputFormat', initialData?.inputFormat || 'auto');
  const [compareMode, setCompareMode] = usePersistentState('diff:compareMode', initialData?.compareMode || 'original');
  const [parseErrorLeft, setParseErrorLeft] = useState('');
  const [parseErrorRight, setParseErrorRight] = useState('');
  const [result, setResult] = usePersistentState('diff:result', null);
  const [showAllContext, setShowAllContext] = useState(false);

  // Migrate legacy stored platform values (ios → cisco-iosxe, etc.)
  useEffect(() => {
    if (PLATFORM_MIGRATION[platform]) setPlatform(PLATFORM_MIGRATION[platform]);
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const respond = e.detail?.respond ?? onShare;
      respond({ tool: 'config-diff', original, modified, platform, filterNoise, inputFormat, compareMode });
    };
    window.addEventListener('app:request-share', handler);
    return () => window.removeEventListener('app:request-share', handler);
  }, [original, modified, platform, filterNoise, inputFormat, compareMode]);

  const compare = useCallback(() => {
    setParseErrorLeft('');
    setParseErrorRight('');

    if (!original.trim() && !modified.trim()) { setResult(null); return; }

    const { leftText, rightText, errorLeft, errorRight } = preprocessInputs(original, modified, inputFormat, compareMode);

    if (errorLeft) {
      setParseErrorLeft(errorLeft);
      setResult(null);
      return;
    }
    if (errorRight) {
      setParseErrorRight(errorRight);
      setResult(null);
      return;
    }

    setResult(computeDiff(leftText, rightText, platform, filterNoise));
    setShowAllContext(false);
  }, [original, modified, platform, filterNoise, inputFormat, compareMode]);

  useEffect(() => {
    if (initialData?.original && initialData?.modified) {
      const format = initialData.inputFormat || 'auto';
      const mode = initialData.compareMode || 'original';
      const { leftText, rightText, errorLeft, errorRight } = preprocessInputs(
        initialData.original,
        initialData.modified,
        format,
        mode
      );
      if (errorLeft) setParseErrorLeft(errorLeft);
      if (errorRight) setParseErrorRight(errorRight);
      if (!errorLeft && !errorRight) {
        setResult(computeDiff(
          leftText,
          rightText,
          initialData.platform || 'auto',
          initialData.filterNoise !== undefined ? initialData.filterNoise : true
        ));
      }
    }
  }, []);

  const clear = useCallback(() => {
    setOriginal('');
    setModified('');
    setResult(null);
    setParseErrorLeft('');
    setParseErrorRight('');
  }, []);

  const handleExportHtml = useCallback(() => {
    if (!result) return;
    const blob = new Blob([exportHtml(result.ops, result.stats)], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'config-diff.html'; a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const handleExportText = useCallback(() => {
    if (!result) return;
    const blob = new Blob([exportPlainText(result.ops)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'config-diff.txt'; a.click();
    URL.revokeObjectURL(url);
  }, [result]);

  const { renderedRows, collapsedCount } = useMemo(() => {
    if (!result) return { renderedRows: [], collapsedCount: 0 };
    if (showAllContext) return { renderedRows: result.ops.map((row, i) => ({ kind: 'row', row, idx: i })), collapsedCount: 0 };

    const visible = computeVisibility(result.ops, 3);
    const rows = [];
    let collapsed = 0, i = 0;
    while (i < result.ops.length) {
      if (visible[i]) { rows.push({ kind: 'row', row: result.ops[i], idx: i }); i++; }
      else {
        let start = i;
        while (i < result.ops.length && !visible[i]) { i++; collapsed++; }
        rows.push({ kind: 'gap', count: i - start, startIdx: start });
      }
    }
    return { renderedRows: rows, collapsedCount: collapsed };
  }, [result, showAllContext]);

  const scrollToSection = useCallback((sectionName) => {
    if (!diffRef.current) return;
    const el = diffRef.current.querySelector(`[data-section="${sectionName}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const hasChanges = result && (result.stats.added + result.stats.removed + result.stats.modified > 0);
  const hasInput = original.trim().length > 0 || modified.trim().length > 0;

  const platformOptions = PLATFORMS.map(p => ({
    value: p.id,
    label: t(`config_diff.platform_${p.id.replace(/-/g, '_')}`),
  }));

  const formatOptions = [
    { value: 'auto', label: t('config_diff.format_auto') },
    { value: 'text', label: t('config_diff.format_text') },
    { value: 'json', label: t('config_diff.format_json') },
    { value: 'xml', label: t('config_diff.format_xml') },
    { value: 'yaml', label: t('config_diff.format_yaml') },
    { value: 'csv', label: t('config_diff.format_csv') },
    { value: 'tsv', label: t('config_diff.format_tsv') },
    { value: 'toml', label: t('config_diff.format_toml') },
    { value: 'ini', label: t('config_diff.format_ini') },
    { value: 'jsonl', label: t('config_diff.format_jsonl') },
    { value: 'markdown', label: t('config_diff.format_markdown') },
  ];

  const compareModeOptions = [
    { value: 'original', label: t('config_diff.compare_mode_original') },
    { value: 'json', label: t('config_diff.compare_mode_json') },
  ];

  const getPlatformLabel = (id) => t(`config_diff.platform_${id.replace(/-/g, '_')}`);

  return (
    <div className="fadein">
      {/* Input card */}
      <div className="card">
        <div className="card-title">{t('config_diff.title')}</div>
        <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>{t('config_diff.subtitle')}</p>

        <div className="two-col" style={{ marginBottom: 16 }}>
          <div className="field">
            <label className="label">{t('config_diff.original_label')}</label>
            <textarea className="input" style={styles.textarea} value={original}
              onChange={e => setOriginal(e.target.value)}
              placeholder={t('config_diff.original_ph')} spellCheck={false} />
          </div>
          <div className="field">
            <label className="label">{t('config_diff.modified_label')}</label>
            <textarea className="input" style={styles.textarea} value={modified}
              onChange={e => setModified(e.target.value)}
              placeholder={t('config_diff.modified_ph')} spellCheck={false} />
          </div>
        </div>

        {(parseErrorLeft || parseErrorRight) && (
          <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
            {parseErrorLeft && (
              <div className="hint" style={{ flex: 1, minWidth: 250, color: 'var(--red)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: 10, borderRadius: 'var(--radius)', background: 'rgba(239, 68, 68, 0.05)' }}>
                {t('config_diff.parse_error_left', { error: parseErrorLeft })}
              </div>
            )}
            {parseErrorRight && (
              <div className="hint" style={{ flex: 1, minWidth: 250, color: 'var(--red)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: 10, borderRadius: 'var(--radius)', background: 'rgba(239, 68, 68, 0.05)' }}>
                {t('config_diff.parse_error_right', { error: parseErrorRight })}
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: 1 }}>
            <label className="label">{t('config_diff.platform_label')}</label>
            <SearchableSelect
              value={platform}
              onChange={(val) => setPlatform(val || 'auto')}
              options={platformOptions}
              placeholder={t('config_diff.platform_auto')}
            />
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 180, flex: 1 }}>
            <label className="label">{t('config_diff.format_label')}</label>
            <SearchableSelect
              value={inputFormat}
              onChange={(val) => setInputFormat(val || 'auto')}
              options={formatOptions}
            />
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 220, flex: 1 }}>
            <label className="label">{t('config_diff.compare_mode_label')}</label>
            <SearchableSelect
              value={compareMode}
              onChange={(val) => setCompareMode(val || 'original')}
              options={compareModeOptions}
              disabled={inputFormat === 'text'}
            />
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <label style={styles.checkboxLabel}>
            <input type="checkbox" checked={filterNoise} onChange={e => setFilterNoise(e.target.checked)} />
            {t('config_diff.noise_toggle')}
          </label>
          <div className="btn-row" style={{ marginTop: 0, marginBottom: 0 }}>
            <button className="btn btn-ghost btn-sm" onClick={clear}>{t('config_diff.clear_btn')}</button>
            <button className="btn btn-primary" onClick={compare} disabled={!hasInput}>{t('config_diff.compare_btn')}</button>
          </div>
        </div>
      </div>

      {filterNoise && result && result.noiseFiltered > 0 && (
        <div className="hint" style={{ marginBottom: 12 }}>
          {t('config_diff.noise_filtered', { count: result.noiseFiltered })}
        </div>
      )}

      {result && platform === 'auto' && (
        <div className="hint" style={{ marginBottom: 12 }}>
          {t('config_diff.auto_detect_result', { platform: getPlatformLabel(result.effectivePlatform) })}
        </div>
      )}

      {/* Statistics */}
      {result && (
        <div className="result-grid" style={{ marginBottom: 16 }}>
          <div className="result-item"><div>
            <div className="result-label">{t('config_diff.stats_added')}</div>
            <div className="result-value" style={{ color: 'var(--green)' }}>{result.stats.added}</div>
          </div></div>
          <div className="result-item"><div>
            <div className="result-label">{t('config_diff.stats_removed')}</div>
            <div className="result-value" style={{ color: 'var(--red)' }}>{result.stats.removed}</div>
          </div></div>
          <div className="result-item"><div>
            <div className="result-label">{t('config_diff.stats_modified')}</div>
            <div className="result-value" style={{ color: 'var(--yellow)' }}>{result.stats.modified}</div>
          </div></div>
          <div className="result-item"><div>
            <div className="result-label">{t('config_diff.stats_unchanged')}</div>
            <div className="result-value">{result.stats.unchanged}</div>
          </div></div>
          <div className="result-item"><div>
            <div className="result-label">{t('config_diff.stats_sections')}</div>
            <div className="result-value" style={{ color: 'var(--cyan)' }}>{result.sections.length}</div>
          </div></div>
        </div>
      )}

      {/* Section summary */}
      {result && result.sections.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="card-title">{t('config_diff.sections_title')}</div>
          <div className="hint" style={{ marginBottom: 10 }}>{t('config_diff.sections_hint')}</div>
          <div style={styles.sectionSummary}>
            {result.sections.map((sec, idx) => {
              const color = SECTION_COLORS[sec.type] || DEFAULT_SEC_COLOR;
              const badgeColor = sec.type === 'interface' ? 'blue' : sec.type === 'routing' ? 'purple'
                : sec.type === 'acl' ? 'red' : sec.type === 'qos' ? 'yellow'
                : sec.type === 'vlan' ? 'green' : 'gray';
              return (
                <span key={`${sec.type}:${sec.name}:${idx}`}
                  style={{ ...styles.sectionChip, background: color.bg, borderColor: color.border, color: color.text }}
                  onClick={() => scrollToSection(`${sec.type}:${sec.name}`)}
                  title={t('config_diff.section_' + sec.type, sec.type)}
                >
                  <span className={`badge badge-${badgeColor}`} style={{ padding: '1px 6px', fontSize: 10, textTransform: 'uppercase' }}>
                    {t('config_diff.section_' + sec.type, sec.type)}
                  </span>
                  {sec.name}
                  <span style={{ opacity: 0.6, fontSize: 11 }}>{sec.changes}</span>
                </span>
              );
            })}
          </div>
        </div>
      )}

      {/* Export + context toggle */}
      {result && hasChanges && (
        <div className="btn-row" style={{ marginBottom: 12 }}>
          <button className="btn btn-ghost btn-sm" onClick={handleExportHtml}>{t('config_diff.export_html')}</button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportText}>{t('config_diff.export_text')}</button>
          <span style={{ flex: 1 }} />
          {collapsedCount > 0 && (
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAllContext(v => !v)}>
              {showAllContext ? t('config_diff.hide_unchanged') : t('config_diff.show_all')}
            </button>
          )}
        </div>
      )}

      {/* Diff view */}
      {result && (
        <div ref={diffRef}>
          {!hasChanges ? (
            <div style={styles.emptyState}>
              <div style={{ fontSize: 16, marginBottom: 8, color: 'var(--green)' }}>&#10003;</div>
              {t('config_diff.no_diff')}
            </div>
          ) : (
            <div style={styles.diffWrapper}>
              <table style={styles.diffTable}>
                <colgroup>
                  <col style={{ width: 50 }} /><col style={{ width: 16 }} /><col />
                  <col style={{ width: 1 }} />
                  <col style={{ width: 50 }} /><col style={{ width: 16 }} /><col />
                </colgroup>
                <tbody>
                  {renderedRows.map((item, idx) => {
                    if (item.kind === 'gap') {
                      return (
                        <tr key={`gap-${idx}`} style={styles.gapRow} onClick={() => setShowAllContext(true)}>
                          <td colSpan={7} style={styles.gapCell}>{t('config_diff.context_lines')} ({item.count})</td>
                        </tr>
                      );
                    }
                    return <DiffRow key={`row-${idx}`} row={item.row} />;
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {!result && (
        <div style={styles.emptyState}>
          <div style={{ fontSize: 13 }}>{t('config_diff.no_input')}</div>
        </div>
      )}
    </div>
  );
}

window.ConfigDiff = ConfigDiff;
