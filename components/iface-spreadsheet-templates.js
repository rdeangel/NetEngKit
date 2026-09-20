// Templates for "Interfaces from Spreadsheet" preset in RegexTool.
// Each template produces a find/replace regex that transforms tab-delimited
// spreadsheet rows into vendor-specific interface config blocks.
//
// columns[] describes the expected tab-separated fields the user must supply.
// sampleInput uses actual tab characters so it can be pasted directly.
//
// Loaded as a plain <script> before RegexTool.jsx; exposes globals
// IFACE_TEMPLATES, IFACE_VENDORS, IFACE_TYPES.

const IFACE_TEMPLATES = [

  // ── Generic / Free Form ───────────────────────────────────────────────────

  {
    id: 'generic-freeform',
    vendor: 'Generic',
    type: 'any',
    label: 'Free Form (Separated by Tabs)',
    label_key: 'regex.ss_tpl_free_form',
    alt_label: 'Free Form (Seaprated by Tabs)',
    columns: ['Interface', 'Command 1', 'Command 2', 'Command 3'],
    find: '^(\\S+)\\t([^\\t\\r]*)\\t([^\\t\\r]*)\\t([^\\t\\r]*)\\r?$',
    replace: 'interface $1\n  $2\n  $3\n  $4\n!',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'GigabitEthernet0/1\tdescription Uplink to Core\tswitchport mode trunk\tno shutdown\n' +
      'GigabitEthernet0/2\tdescription Server Farm\tswitchport access vlan 100\tno shutdown\n' +
      'GigabitEthernet0/3\tdescription Management\tip address 10.0.0.1 255.255.255.0\tno shutdown',
  },

  // ── Cisco IOS ─────────────────────────────────────────────────────────────

  {
    id: 'ios-access',
    vendor: 'Cisco IOS',
    type: 'access',
    label: 'Access Port',
    label_key: 'regex.spreadsheet.tpl_access',
    columns: ['Interface', 'Description', 'VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n  description $2\n  switchport mode access\n  switchport access vlan $3\n  $4\n!',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'GigabitEthernet0/1\tserver rack-A\t111\tshutdown\n' +
      'GigabitEthernet0/2\tuplink to core-sw-01\t211\tno shutdown\n' +
      'GigabitEthernet0/3\tprinter mgmt\t301\tshutdown',
  },

  {
    id: 'ios-trunk',
    vendor: 'Cisco IOS',
    type: 'trunk',
    label: 'Trunk Port',
    label_key: 'regex.spreadsheet.tpl_trunk',
    columns: ['Interface', 'Description', 'Allowed VLANs', 'Native VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d,\\-]+)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n  description $2\n  switchport mode trunk\n  switchport trunk allowed vlan $3\n  switchport trunk native vlan $4\n  $5\n!',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'GigabitEthernet0/1\tuplink to dist-sw-01\t10,20,30\t999\tno shutdown\n' +
      'GigabitEthernet0/2\tuplink to dist-sw-02\t10,20,30\t999\tno shutdown',
  },

  {
    id: 'ios-routed',
    vendor: 'Cisco IOS',
    type: 'routed',
    label: 'Routed Port (L3)',
    label_key: 'regex.spreadsheet.tpl_routed',
    columns: ['Interface', 'Description', 'IP Address', 'Subnet Mask', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d.]+)\\t([\\d.]+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n  description $2\n  no switchport\n  ip address $3 $4\n  $5\n!',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'GigabitEthernet0/1\tlink to core-rtr\t10.0.0.1\t255.255.255.252\tno shutdown\n' +
      'GigabitEthernet0/2\tlink to border-rtr\t10.0.1.1\t255.255.255.252\tno shutdown',
  },

  // ── Cisco NX-OS ───────────────────────────────────────────────────────────

  {
    id: 'nxos-access',
    vendor: 'Cisco NX-OS',
    type: 'access',
    label: 'Access Port',
    label_key: 'regex.spreadsheet.tpl_access',
    columns: ['Interface', 'Description', 'VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n  description $2\n  switchport mode access\n  switchport access vlan $3\n  $4',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'Ethernet1/1\tserver rack-A\t111\tshutdown\n' +
      'Ethernet1/2\tuplink to core\t211\tno shutdown\n' +
      'Ethernet1/3\tprinter mgmt\t301\tshutdown',
  },

  {
    id: 'nxos-trunk',
    vendor: 'Cisco NX-OS',
    type: 'trunk',
    label: 'Trunk Port',
    label_key: 'regex.spreadsheet.tpl_trunk',
    columns: ['Interface', 'Description', 'Allowed VLANs', 'Native VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d,\\-]+)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n  description $2\n  switchport mode trunk\n  switchport trunk allowed vlan $3\n  switchport trunk native vlan $4\n  $5',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'Ethernet1/1\tuplink to dist-sw-01\t10,20,30\t999\tno shutdown\n' +
      'Ethernet1/2\tuplink to dist-sw-02\t10,20,30\t999\tno shutdown',
  },

  {
    id: 'nxos-routed',
    vendor: 'Cisco NX-OS',
    type: 'routed',
    label: 'Routed Port (L3)',
    label_key: 'regex.spreadsheet.tpl_routed',
    columns: ['Interface', 'Description', 'IP Address', 'Subnet Mask', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d.]+)\\t([\\d.]+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n  description $2\n  no switchport\n  ip address $3 $4\n  $5',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'Ethernet1/1\tlink to core-rtr\t10.0.0.1\t255.255.255.252\tno shutdown\n' +
      'Ethernet1/2\tlink to border-rtr\t10.0.1.1\t255.255.255.252\tno shutdown',
  },

  // ── Arista EOS ────────────────────────────────────────────────────────────

  {
    id: 'eos-access',
    vendor: 'Arista EOS',
    type: 'access',
    label: 'Access Port',
    label_key: 'regex.spreadsheet.tpl_access',
    columns: ['Interface', 'Description', 'VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n   description $2\n   switchport mode access\n   switchport access vlan $3\n   $4\n!',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'Ethernet1\tserver rack-A\t111\tshutdown\n' +
      'Ethernet2\tuplink to core\t211\tno shutdown\n' +
      'Ethernet3\tprinter mgmt\t301\tshutdown',
  },

  {
    id: 'eos-trunk',
    vendor: 'Arista EOS',
    type: 'trunk',
    label: 'Trunk Port',
    label_key: 'regex.spreadsheet.tpl_trunk',
    columns: ['Interface', 'Description', 'Allowed VLANs', 'Native VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d,\\-]+)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n   description $2\n   switchport mode trunk\n   switchport trunk allowed vlan $3\n   switchport trunk native vlan $4\n   $5\n!',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'Ethernet1\tuplink to dist-sw-01\t10,20,30\t999\tno shutdown\n' +
      'Ethernet2\tuplink to dist-sw-02\t10,20,30\t999\tno shutdown',
  },

  {
    id: 'eos-routed',
    vendor: 'Arista EOS',
    type: 'routed',
    label: 'Routed Port (L3)',
    label_key: 'regex.spreadsheet.tpl_routed',
    // Arista uses CIDR notation (e.g. 10.0.0.1/30) rather than address + mask
    columns: ['Interface', 'Description', 'IP/CIDR', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d./]+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n   description $2\n   no switchport\n   ip address $3\n   $4\n!',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'Ethernet1\tlink to core-rtr\t10.0.0.1/30\tno shutdown\n' +
      'Ethernet2\tlink to border-rtr\t10.0.1.1/30\tno shutdown',
  },

  // ── Juniper JunOS (set-command style) ─────────────────────────────────────

  {
    id: 'junos-access',
    vendor: 'Juniper JunOS',
    type: 'access',
    label: 'Access Port (set)',
    label_key: 'regex.spreadsheet.tpl_access_set',
    columns: ['Interface', 'Description', 'VLAN Name', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\S+)\\t([^\\t\\r]+)\\r?$',
    replace: 'set interfaces $1 description "$2"\nset interfaces $1 unit 0 family ethernet-switching interface-mode access\nset interfaces $1 unit 0 family ethernet-switching vlan members $3\n$4',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'ge-0/0/0\tserver rack-A\tvlan-111\tset interfaces ge-0/0/0 disable\n' +
      'ge-0/0/1\tuplink to core\tvlan-211\tset interfaces ge-0/0/1 enable',
  },

  {
    id: 'junos-trunk',
    vendor: 'Juniper JunOS',
    type: 'trunk',
    label: 'Trunk Port (set)',
    label_key: 'regex.spreadsheet.tpl_trunk_set',
    columns: ['Interface', 'Description', 'VLAN Members', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\S+)\\t([^\\t\\r]+)\\r?$',
    replace: 'set interfaces $1 description "$2"\nset interfaces $1 unit 0 family ethernet-switching interface-mode trunk\nset interfaces $1 unit 0 family ethernet-switching vlan members $3\n$4',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'ge-0/0/0\tuplink to dist-sw-01\tall\tset interfaces ge-0/0/0 enable\n' +
      'ge-0/0/1\tuplink to dist-sw-02\tall\tset interfaces ge-0/0/1 enable',
  },

  // ── Huawei VRP ────────────────────────────────────────────────────────────

  {
    id: 'vrp-access',
    vendor: 'Huawei VRP',
    type: 'access',
    label: 'Access Port',
    label_key: 'regex.spreadsheet.tpl_access',
    columns: ['Interface', 'Description', 'VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n description $2\n port link-type access\n port default vlan $3\n $4\n#',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'GigabitEthernet0/0/1\tserver rack-A\t111\tshutdown\n' +
      'GigabitEthernet0/0/2\tuplink to core\t211\tundo shutdown',
  },

  {
    id: 'vrp-trunk',
    vendor: 'Huawei VRP',
    type: 'trunk',
    label: 'Trunk Port',
    // Huawei VRP uses space-separated VLAN list (e.g. "10 20 30") and PVID instead of native VLAN
    columns: ['Interface', 'Description', 'Allowed VLANs', 'PVID', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d,\\- ]+)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n description $2\n port link-type trunk\n port trunk allow-pass vlan $3\n port trunk pvid vlan $4\n $5\n#',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'GigabitEthernet0/0/1\tuplink to dist-sw-01\t10 20 30\t999\tundo shutdown\n' +
      'GigabitEthernet0/0/2\tuplink to dist-sw-02\t10 20 30\t999\tundo shutdown',
  },

  {
    id: 'vrp-routed',
    vendor: 'Huawei VRP',
    type: 'routed',
    label: 'Routed Port (L3)',
    label_key: 'regex.spreadsheet.tpl_routed',
    columns: ['Interface', 'Description', 'IP Address', 'Subnet Mask', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d.]+)\\t([\\d.]+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n description $2\n undo portswitch\n ip address $3 $4\n $5\n#',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'GigabitEthernet0/0/1\tlink to core-rtr\t10.0.0.1\t255.255.255.252\tundo shutdown\n' +
      'GigabitEthernet0/0/2\tlink to border-rtr\t10.0.1.1\t255.255.255.252\tundo shutdown',
  },
  // ── ArubaOS-CX ────────────────────────────────────────────────────────────

  {
    id: 'aoscx-access',
    vendor: 'ArubaOS-CX',
    type: 'access',
    label: 'Access Port',
    label_key: 'regex.spreadsheet.tpl_access',
    columns: ['Interface', 'Description', 'VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n    description $2\n    vlan access $3\n    $4',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      '1/1/1\tserver rack-A\t111\tshutdown\n' +
      '1/1/2\tuplink to core\t211\tno shutdown\n' +
      '1/1/3\tprinter mgmt\t301\tshutdown',
  },

  {
    id: 'aoscx-trunk',
    vendor: 'ArubaOS-CX',
    type: 'trunk',
    label: 'Trunk Port',
    label_key: 'regex.spreadsheet.tpl_trunk',
    columns: ['Interface', 'Description', 'Allowed VLANs', 'Native VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d,\\-]+)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n    description $2\n    vlan trunk allowed $3\n    vlan trunk native $4\n    $5',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      '1/1/1\tuplink to dist-sw-01\t10,20,30\t999\tno shutdown\n' +
      '1/1/2\tuplink to dist-sw-02\t10,20,30\t999\tno shutdown',
  },

  {
    id: 'aoscx-routed',
    vendor: 'ArubaOS-CX',
    type: 'routed',
    label: 'Routed Port (L3)',
    label_key: 'regex.spreadsheet.tpl_routed',
    // ArubaOS-CX uses CIDR notation (e.g. 10.0.0.1/30)
    columns: ['Interface', 'Description', 'IP/CIDR', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d./]+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n    description $2\n    no switchport\n    ip address $3\n    $4',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      '1/1/1\tlink to core-rtr\t10.0.0.1/30\tno shutdown\n' +
      '1/1/2\tlink to border-rtr\t10.0.1.1/30\tno shutdown',
  },

  // ── ArubaOS-Switch (ProCurve) ──────────────────────────────────────────────

  {
    id: 'aossw-access',
    vendor: 'ArubaOS-Switch',
    type: 'access',
    label: 'Access Port (untagged)',
    label_key: 'regex.spreadsheet.tpl_access_untagged',
    columns: ['Interface', 'Description', 'VLAN', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\d+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n   name "$2"\n   untagged vlan $3\n   $4',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      '1\tserver rack-A\t111\tdisable\n' +
      '2\tuplink to core\t211\tenable\n' +
      '3\tprinter mgmt\t301\tdisable',
  },

  {
    id: 'aossw-trunk',
    vendor: 'ArubaOS-Switch',
    type: 'trunk',
    label: 'Trunk Port (tagged)',
    label_key: 'regex.spreadsheet.tpl_trunk_tagged',
    columns: ['Interface', 'Description', 'Tagged VLANs', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t([\\d,\\-]+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n   name "$2"\n   tagged vlan $3\n   $4',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      '1\tuplink to dist-sw-01\t10,20,30\tenable\n' +
      '2\tuplink to dist-sw-02\t10,20,30\tenable',
  },

  // ── Fortinet FortiGate ────────────────────────────────────────────────────

  {
    id: 'fortigate-physical',
    vendor: 'Fortinet FortiGate',
    type: 'routed',
    label: 'Physical Interface (L3)',
    label_key: 'regex.spreadsheet.tpl_physical_l3',
    columns: ['Interface', 'Alias', 'VDOM', 'IP Address', 'Subnet Mask', 'Allow Access'],
    find: '^(\\S+)\\t(.*?)\\t(\\S+)\\t([\\d.]+)\\t([\\d.]+)\\t([^\\t\\r]+)\\r?$',
    replace: 'config system interface\n    edit "$1"\n        set alias "$2"\n        set vdom $3\n        set mode static\n        set ip $4 $5\n        set allowaccess $6\n    next\nend',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'port1\tinside-lan\troot\t10.0.1.1\t255.255.255.0\tping https\n' +
      'port2\tdmz-servers\troot\t10.0.2.1\t255.255.255.0\tping\n' +
      'port3\twan-uplink\troot\t203.0.113.1\t255.255.255.252\tping',
  },

  {
    id: 'fortigate-vlan',
    vendor: 'Fortinet FortiGate',
    type: 'trunk',
    label: 'VLAN Subinterface',
    label_key: 'regex.spreadsheet.tpl_vlan_sub',
    columns: ['Subinterface', 'Alias', 'Parent Interface', 'VLAN ID', 'IP Address', 'Subnet Mask'],
    find: '^(\\S+)\\t(.*?)\\t(\\S+)\\t(\\d+)\\t([\\d.]+)\\t([\\d.]+)\\r?$',
    replace: 'config system interface\n    edit "$1"\n        set alias "$2"\n        set interface "$3"\n        set vlanid $4\n        set mode static\n        set ip $5 $6\n    next\nend',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'port2.111\tservers-dmz\tport2\t111\t10.1.111.1\t255.255.255.0\n' +
      'port2.222\tvoip-vlan\tport2\t222\t10.1.222.1\t255.255.255.0\n' +
      'port2.999\tmgmt-vlan\tport2\t999\t10.1.999.1\t255.255.255.0',
  },

  // ── Cisco ASA ─────────────────────────────────────────────────────────────

  {
    id: 'asa-physical',
    vendor: 'Cisco ASA',
    type: 'routed',
    label: 'Physical Interface',
    label_key: 'regex.spreadsheet.tpl_physical',
    columns: ['Interface', 'Description', 'Nameif', 'Security Level', 'IP Address', 'Subnet Mask', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\S+)\\t(\\d+)\\t([\\d.]+)\\t([\\d.]+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n description $2\n nameif $3\n security-level $4\n ip address $5 $6\n $7',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'GigabitEthernet0/0\tinside LAN\tinside\t100\t10.0.1.1\t255.255.255.0\tno shutdown\n' +
      'GigabitEthernet0/1\tDMZ servers\tdmz\t50\t10.0.2.1\t255.255.255.0\tno shutdown\n' +
      'GigabitEthernet0/2\tWAN uplink\toutside\t0\t203.0.113.1\t255.255.255.252\tno shutdown',
  },

  {
    id: 'asa-subinterface',
    vendor: 'Cisco ASA',
    type: 'trunk',
    label: 'Subinterface (dot1q)',
    label_key: 'regex.spreadsheet.tpl_sub_dot1q',
    columns: ['Interface', 'Description', 'VLAN', 'Nameif', 'Security Level', 'IP Address', 'Subnet Mask', 'Command'],
    find: '^(\\S+)\\t(.*?)\\t(\\d+)\\t(\\S+)\\t(\\d+)\\t([\\d.]+)\\t([\\d.]+)\\t([^\\t\\r]+)\\r?$',
    replace: 'interface $1\n description $2\n vlan $3\n nameif $4\n security-level $5\n ip address $6 $7\n $8',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'GigabitEthernet0/0.111\tservers DMZ\t111\tdmz-servers\t50\t10.1.111.1\t255.255.255.0\tno shutdown\n' +
      'GigabitEthernet0/0.222\tvoip zone\t222\tdmz-voip\t40\t10.1.222.1\t255.255.255.0\tno shutdown',
  },

  // ── Palo Alto PAN-OS ──────────────────────────────────────────────────────

  {
    id: 'panos-l3',
    vendor: 'Palo Alto PAN-OS',
    type: 'routed',
    label: 'Layer 3 Interface (set)',
    label_key: 'regex.spreadsheet.tpl_l3_set',
    // PAN-OS CLI set-command style; vsys1 and default vr are common defaults
    columns: ['Interface', 'Comment', 'Zone', 'IP/CIDR', 'Virtual Router', 'Vsys'],
    find: '^(\\S+)\\t(.*?)\\t(\\S+)\\t([\\d./]+)\\t(\\S+)\\t(\\S+)\\r?$',
    replace: 'set network interface ethernet $1 layer3 ip $4\nset network interface ethernet $1 comment "$2"\nset zone $3 network layer3 $1\nset network virtual-router $5 interface $1\nset vsys $6 import network interface $1',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'ethernet1/1\tinside LAN\ttrust\t10.0.1.1/24\tdefault\tvsys1\n' +
      'ethernet1/2\tDMZ servers\tdmz\t10.0.2.1/24\tdefault\tvsys1\n' +
      'ethernet1/3\tWAN uplink\tuntrust\t203.0.113.1/30\tdefault\tvsys1',
  },

  {
    id: 'panos-subif',
    vendor: 'Palo Alto PAN-OS',
    type: 'trunk',
    label: 'Subinterface (set)',
    label_key: 'regex.spreadsheet.tpl_sub_set',
    columns: ['Interface', 'Tag', 'Comment', 'Zone', 'IP/CIDR', 'Virtual Router'],
    find: '^(\\S+)\\t(\\d+)\\t(.*?)\\t(\\S+)\\t([\\d./]+)\\t(\\S+)\\r?$',
    replace: 'set network interface ethernet $1 layer3 units $1.$2 tag $2\nset network interface ethernet $1 layer3 units $1.$2 ip $5\nset network interface ethernet $1 layer3 units $1.$2 comment "$3"\nset zone $4 network layer3 $1.$2\nset network virtual-router $6 interface $1.$2',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput:
      'ethernet1/1\t111\tservers DMZ\tdmz-servers\t10.1.111.1/24\tdefault\n' +
      'ethernet1/1\t222\tvoip zone\tdmz-voip\t10.1.222.1/24\tdefault\n' +
      'ethernet1/1\t999\tmgmt vlan\tmgmt\t10.1.999.1/24\tdefault',
  },
];

const IFACE_VENDORS    = ['All', ...new Set(IFACE_TEMPLATES.map(t => t.vendor))];
const IFACE_TYPES      = ['all', 'access', 'trunk', 'routed', 'any'];
