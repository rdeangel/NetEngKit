const { useState, useEffect, useCallback, useRef, useMemo } = React;

/** Gradient brand mark — inline so file/offline builds need no external logo.svg */
function BrandLogo({ gradId = 'nekLogoGrad' }) {
  return (
    <svg width="28" height="28" viewBox="0 0 80 80" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id={`${gradId}_bg`} x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="#161622" />
          <stop offset="1" stopColor="#0a0a0f" />
        </linearGradient>
        <linearGradient id={`${gradId}_rim`} x1="0" y1="0" x2="80" y2="80" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00f0e2" />
          <stop offset="60%" stopColor="#00d4c8" />
          <stop offset="100%" stopColor="#38bdf8" />
        </linearGradient>
        <linearGradient id={`${gradId}_glyph`} x1="0" y1="0" x2="370" y2="196" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00f0e2" />
          <stop offset="1" stopColor="#00c4b8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="76" height="76" rx="17" fill={`url(#${gradId}_bg)`} stroke={`url(#${gradId}_rim)`} strokeWidth="1.8" />
      <rect x="5" y="5" width="70" height="70" rx="14" fill="none" stroke="#00d4c8" strokeWidth="0.5" opacity="0.2" />
      <g transform="translate(13, 25.7) scale(0.145946)" fill={`url(#${gradId}_glyph)`}>
        <rect x="0" y="0" width="34" height="196" />
        <polygon points="34,0 68,0 160,162 160,196 126,196 34,34" />
        <rect x="126" y="0" width="34" height="196" />
        <rect x="160" y="0" width="98" height="34" />
        <rect x="160" y="81" width="78" height="34" />
        <rect x="160" y="162" width="98" height="34" />
        <polygon points="370,0 333,0 261,98 333,196 370,196 298,98" />
      </g>
    </svg>
  );
}

const TOOLS = [
  // IPv4
  { id: 'subnet', label: 'IPv4 Subnet Calculator', group: 'IPv4', type: 'tool',
    keywords: 'subnet calculator cidr ipv4 mask prefix network broadcast wildcard binary representation visualizer map iplist',
    subTools: [
      { labelKey: 'subnet.tab_calculator', nav: { mode: 'calculator' }, keywords: 'calculator cidr mask broadcast network host class decimal binary hex integer' },
      { labelKey: 'subnet.tab_rebase', nav: { mode: 'rebase' }, keywords: 'rebase remap renumber relocate block offset transpose allocation plan' },
      { labelKey: 'tools.subnet-viz.title', nav: { mode: 'binary' }, keywords: 'binary bits octet 11000000 representation visualizer' },
      { labelKey: 'tools.wildcard.title', nav: { mode: 'wildcard' }, keywords: 'wildcard mask inverse bitwise reverse ospf acl' },
      { labelKey: 'tools.map.title', nav: { mode: 'map' }, keywords: 'visual map grid subnet layout division parent child' },
      { labelKey: 'tools.iplist.title', nav: { mode: 'iplist' }, keywords: 'ip list generator cidr hosts ips' },
    ],
  },
  { id: 'subnet-planner', label: 'Subnetting Planner', group: 'IPv4', type: 'tool',
    keywords: 'subnet planner vlsm supernet summary split merge overlap range cidr collision check',
    subTools: [
      { labelKey: 'tools.vlsm.title', nav: { mode: 'vlsm' }, keywords: 'vlsm variable length host allocation subnet designer planner' },
      { labelKey: 'tools.supernet.title', nav: { mode: 'supernet' }, keywords: 'supernet summarization route aggregation summary' },
      { labelKey: 'split.split_subnet', nav: { mode: 'split' }, keywords: 'split partition subnet divide' },
      { labelKey: 'split.merge_summarize', nav: { mode: 'merge' }, keywords: 'merge combine collapse summarize' },
      { labelKey: 'tools.range.title', nav: { mode: 'range' }, keywords: 'range cidr convert boundaries boundary' },
      { labelKey: 'tools.overlap.title', nav: { mode: 'overlap' }, keywords: 'overlap collision conflict duplicate check validation' },
    ],
  },
  { id: 'dhcp', label: 'DHCP Scope Planner', group: 'IPv4', type: 'tool' },
  { id: 'converter', label: 'IP Converter', group: 'IPv4', type: 'tool',
    keywords: 'ip converter representation decimal binary hex integer conversion format',
    subTools: [
      { labelKey: 'subnet.decimal',  nav: { mode: 'decimal' },  keywords: 'ip converter dotted decimal notation 192.168' },
      { labelKey: 'subnet.binary',   nav: { mode: 'binary' },   keywords: 'binary bits octet 11000000' },
      { labelKey: 'subnet.hex',      nav: { mode: 'hex' },      keywords: 'hexadecimal hex 0x c0a8' },
      { labelKey: 'subnet.integer',  nav: { mode: 'integer' },  keywords: 'integer uint32 long numeric' },
    ],
  },
  { id: 'acl', label: 'ACL Generator', group: 'IPv4', type: 'tool' },
  { id: 'nat-pat-calc', label: 'NAT/PAT Calculator', group: 'IPv4', type: 'tool', keywords: 'nat pat overload translation static mapping dual-nat cgnat iptables cisco asa dynamic translation port block allocation pba sizing' },
  { id: 'split-tunnel', label: 'Split Tunnel Calculator', group: 'IPv4', type: 'tool', keywords: 'split tunnel vpn route include exclude rfc1918 anyconnect wireguard allowedips openvpn minimal subnet list aggregate summarize carve' },
  { id: 'bogon-filter', label: 'Bogon / Martian Filter', group: 'IPv4', type: 'tool', keywords: 'bogon martian rfc1918 private acl prefix-list firewall filter deny block iana reserved loopback link-local cgnat class-e cisco juniper iptables nftables vyos fortigate' },


  // IPv6
  { id: 'ipv6subnet', label: 'IPv6 Subnet Calc', group: 'IPv6', type: 'tool' },
  { id: 'ipv6-trans', label: 'IPv6 Transition Mech', group: 'IPv6', type: 'ref' },

  // Both IPv4 & IPv6
  { id: 'classify', label: 'IP Classifier', group: 'BOTH (IPv4 and IPv6)', type: 'tool' },
  { id: 'mac', label: 'MAC Address Tools', group: 'BOTH (IPv4 and IPv6)', type: 'tool', online: false },
  { id: 'arp-parser', label: 'ARP Table Parser', group: 'BOTH (IPv4 and IPv6)', type: 'tool', keywords: 'arp table parser show ip arp arp -a spoofing duplicate mac incomplete entry vendor oui cisco linux windows' },
  { id: 'cheatsheet', label: 'IP Cheat Sheet', group: 'BOTH (IPv4 and IPv6)', type: 'ref' },
  { id: 'icmp-ref', label: 'ICMP Type/Code Reference', group: 'BOTH (IPv4 and IPv6)', type: 'ref', keywords: 'icmp icmpv6 ping traceroute message code type redirect unreachable ndp mld dynamic port rfc792 rfc4443 error control', subTools: [
    { labelKey: 'icmp_ref.ipv4', nav: { version: 'v4' }, keywords: 'icmp icmpv4 rfc792 ipv4 echo reply unreachable ttl exceeded redirect' },
    { labelKey: 'icmp_ref.ipv6', nav: { version: 'v6' }, keywords: 'icmpv6 rfc4443 ipv6 ndp mld neighbor discovery multicast listener' },
  ] },

  // Multicast
  { id: 'mcast-toolkit', label: 'Multicast Toolkit', group: 'Multicast', type: 'tool', keywords: 'multicast igmp mld pim rpf ipv6', subTools: [
    { labelKey: 'mcast_toolkit.tabs.reference', nav: { activeTab: 'reference' }, keywords: 'multicast reference' },
    { labelKey: 'mcast_toolkit.sub_tabs.ip_mac', nav: { activeTab: 'calculators', subTab: 'ip_mac' }, keywords: '33:33 01:00:5e mac ip mapping' },
    { labelKey: 'mcast_toolkit.sub_tabs.solicited', nav: { activeTab: 'calculators', subTab: 'solicited' }, keywords: 'solicited-node ff02 eui-64 dad' },
    { labelKey: 'mcast_toolkit.sub_tabs.glop', nav: { activeTab: 'calculators', subTab: 'glop' }, keywords: 'glop 233 as asn rfc3180' },
    { labelKey: 'mcast_toolkit.sub_tabs.ipv6_builder', nav: { activeTab: 'calculators', subTab: 'ipv6_builder' }, keywords: 'ipv6 builder group address' },
    { labelKey: 'mcast_toolkit.sub_tabs.planner', nav: { activeTab: 'planning', subTab: 'planner' }, keywords: 'planner scope allocation' },
    { labelKey: 'mcast_toolkit.sub_tabs.collision', nav: { activeTab: 'planning', subTab: 'collision' }, keywords: 'collision overlap l2 32:1' },
    { labelKey: 'mcast_toolkit.sub_tabs.analyzer', nav: { activeTab: 'planning', subTab: 'analyzer' }, keywords: 'analyzer range scope decode' },
  ] },

  // Switching (Layer 2)
  { id: 'switching-ref', label: 'Switching (STP/VPC)', group: 'Switching', type: 'ref', keywords: 'stp spanning-tree vpc etherchannel lacp layer2 switching', subTools: [
    { labelKey: 'switching.stp_title',           nav: { tab: 'stp' },   keywords: 'stp spanning-tree rstp mstp pvst rapid root bridge port cost priority variants states timers convergence' },
    { labelKey: 'switching.etherchannel_title',  nav: { tab: 'ether' }, keywords: 'etherchannel port-channel lacp pagp bonding aggregation link bundling' },
    { labelKey: 'switching.vpc_title',           nav: { tab: 'vpc' },   keywords: 'vpc nexus peer-link keepalive dual-homed consistency orphan' },
  ] },
  { id: 'lacp-tool', label: 'LACP / Port-Channel', group: 'Switching', type: 'tool' },
  { id: 'qinq-config', label: 'QinQ / VLAN Translation', group: 'Switching', type: 'tool', keywords: 'qinq 802.1ad vlan translation tunnel stacking double-tag provider bridging' },
  { id: 'config-gen', label: 'Interface Config Gen', group: 'Switching', type: 'tool' },
  { id: 'mac-table-parser', label: 'MAC Address Table Parser', group: 'Switching', type: 'tool', keywords: 'mac address table parser show mac flapping port-security vlan distribution oui vendor cisco nxos snapshot diff' },
  { id: 'dot1x-builder', label: '802.1X / NAC Config Builder', group: 'Switching', type: 'tool', keywords: '802.1x dot1x nac mab webauth radius coa cisco aruba port-access single-host multi-host multi-domain authentication' },
  { id: 'span-builder', label: 'Port Mirror / SPAN Builder', group: 'Switching', type: 'tool', keywords: 'span rspan erspan mirror port mirroring monitoring analyzer packet capture traffic monitoring tap cisco arista juniper configuration' },
  { id: 'vxlan-ref', label: 'VXLAN Reference', group: 'Switching', type: 'ref' },
  { id: 'evpn-vxlan-designer', label: 'EVPN/VXLAN Fabric Designer', group: 'Switching', type: 'tool', keywords: 'evpn vxlan spine leaf bgp underlay overlay nve tenant fabric design switch routing config' },

  // Routing (Layer 3)
  { id: 'proto-ref', label: 'IP Proto Reference', group: 'Routing', type: 'ref' },
  { id: 'routing-cfg', label: 'Routing Config Builder', group: 'Routing', type: 'tool' },
  { id: 'iosxr-cfg', label: 'Cisco IOS-XR Config Builder', group: 'Routing', type: 'tool',
    keywords: 'cisco ios-xr iosxr config builder route policy rpl commit groups migration interface bgp ospf',
    subTools: [
      { labelKey: 'iosxr_config.tab_builder',    nav: { activeTab: 'builder' },    keywords: 'iosxr config builder interfaces ospf bgp config groups commit hostname domain' },
      { labelKey: 'iosxr_config.tab_migration',  nav: { activeTab: 'migration' },  keywords: 'migrate translate ios ios-xe convert paste' },
      { labelKey: 'iosxr_config.tab_comparison', nav: { activeTab: 'comparison' }, keywords: 'compare difference candidate commit replace rpl route-map' },
    ],
  },
  { id: 'mpls-ref', label: 'MPLS Reference', group: 'Routing', type: 'ref' },
  { id: 'vpn-ref', label: 'VPN / IPsec Architect', group: 'Routing', type: 'ref' },
  { id: 'wireguard-cfg', label: 'WireGuard Tunnel Config Builder', group: 'Routing', type: 'tool',
    keywords: 'wireguard wg tunnel config builder keys peer site-to-site hub spoke mtu overhead ipsec quick systemd',
    subTools: [
      { labelKey: 'wireguard_config.tab_s2s',        nav: { mode: 's2s' },        keywords: 'wireguard config builder p2p point-to-point wg-quick systemd-networkd peer a b' },
      { labelKey: 'wireguard_config.tab_hub_spoke',  nav: { mode: 'hub_spoke' },  keywords: 'road warrior vpn client server star topology spoke' },
      { labelKey: 'wireguard_config.tab_comparison', nav: { mode: 'comparison' }, keywords: 'ipsec compare performance handshake crypto roaming' },
    ],
  },
  { id: 'bgp-lg', label: 'BGP Looking Glass', group: 'Routing', type: 'tool', online: true, server: true },
  { id: 'asn', label: 'BGP / ASN Lookup', group: 'Routing', type: 'tool', online: true, server: true },
  { id: 'bgp-community', label: 'BGP Community Builder', group: 'Routing', type: 'tool' },
  { id: 'fhrp-calc', label: 'FHRP Calculator', group: 'Routing', type: 'tool', keywords: 'fhrp hsrp vrrp glbp redundancy gateway virtual mac priority preempt active standby election first hop' },
  { id: 'prefix-list-builder', label: 'Prefix List & Route Map Builder', group: 'Routing', type: 'tool', keywords: 'prefix-list route-map redistribution bgp ospf filter ge le cisco ios nxos juniper arista policy routing' },

  // Infrastructure
  { id: 'osi-model', label: 'OSI & TCP/IP Model', group: 'Infrastructure', type: 'ref' },
  { id: 'cable', label: 'Cable & Transceiver Calculator', group: 'Infrastructure', type: 'tool', keywords: 'cable transceiver fiber copper fibre attenuation distance',
    subTools: [
      { labelKey: 'cable.tab_fiber',   nav: { tab: 'fiber' },                  keywords: 'cable calculator fiber sfp qsfp loss budget smf mmf os1 os2 om1 om2 om3 om4 wavelength 1310nm 1550nm 850nm' },
      { labelKey: 'cable.tab_copper',  nav: { tab: 'copper' },                 keywords: 'cat5e cat6 cat6a cat7 cat8 tia-568 ethernet length speed' },
      { labelKey: 'cable.ref_fiber',   nav: { tab: 'ref', refTab: 'fiber' },   keywords: 'om1 om2 om3 om4 om5 os1 os2 singlemode multimode 50um 62.5um' },
      { labelKey: 'cable.ref_copper',  nav: { tab: 'ref', refTab: 'copper' },  keywords: 'cat8 shielded utp ftp bandwidth impedance 25gbase 40gbase' },
      { labelKey: 'cable.ref_conn',    nav: { tab: 'ref', refTab: 'conn' },    keywords: 'lc sc st fc mpo mtp splice fusion mechanical connector insertion' },
      { labelKey: 'cable.ref_txrx',    nav: { tab: 'ref', refTab: 'txrx' },    keywords: 'sfp+ qsfp28 bidi cwdm dwdm tx rx power sensitivity 100g 400g' },
      { labelKey: 'cable.ref_ethdist', nav: { tab: 'ref', refTab: 'ethdist' }, keywords: '100base 1000base 10gbase 40gbase 100gbase ieee 802.3 ethernet standard reach' },
    ] },
  { id: 'packet-headers', label: 'Packet Header Map', group: 'Infrastructure', type: 'ref', keywords: 'packet header map bit field diagram ipv4 ipv6 tcp udp protocol', subTools: [
    { labelKey: 'packet_headers.ipv4_title', nav: { activeHeader: 'ipv4' }, keywords: 'packet header map ipv4 rfc791 ttl dscp ecn tos flags fragmentation checksum' },
    { labelKey: 'packet_headers.ipv6_title', nav: { activeHeader: 'ipv6' }, keywords: 'ipv6 rfc8200 flow label hop limit next header traffic class' },
    { labelKey: 'packet_headers.tcp_title',  nav: { activeHeader: 'tcp' },  keywords: 'tcp rfc9293 syn ack fin rst sequence acknowledgment window flags' },
    { labelKey: 'packet_headers.udp_title',  nav: { activeHeader: 'udp' },  keywords: 'udp rfc768 datagram length checksum connectionless' },
  ] },
  { id: 'qos-tool', label: 'QoS / DSCP Bit Map', group: 'Infrastructure', type: 'tool', keywords: 'qos dscp quality of service marking traffic',
    subTools: [
      { labelKey: 'qos_tool.dscp_decoder',   nav: { activeTab: 'dscp' },   keywords: 'qos dscp codepoint 6-bit phb ef af cs precedence per-hop behavior rfc4594 tos' },
      { labelKey: 'qos_tool.delay_latency',  nav: { activeTab: 'delay' },  keywords: 'delay latency propagation serialization queuing pkt packet size link speed' },
      { labelKey: 'qos_tool.voip_mos',       nav: { activeTab: 'voip' },   keywords: 'voip mos g711 g729 g722 e-model itu-t codec jitter packet loss mean opinion score' },
      { labelKey: 'qos_tool.token_bucket',   nav: { activeTab: 'bucket' }, keywords: 'token bucket cir bc burst committed information rate policing shaping policer' },
      { labelKey: 'qos_tool.cbwfq_shaping',  nav: { activeTab: 'cbwfq' },  keywords: 'cbwfq class based weighted fair queue bandwidth allocation tc interval shaping cisco' },
    ] },
  { id: 'mtu', label: 'MTU & Encapsulation', group: 'Infrastructure', type: 'tool' },
  { id: 'wifi-rf-planner', label: 'Wireless & RF Planner', group: 'Infrastructure', type: 'tool', keywords: 'wifi wireless rf planner airtime capacity mcs roaming 802.11 spectrum fast transition', subTools: [
    { labelKey: 'wifi_rf.tab_design', nav: { tab: 'design' }, keywords: 'wifi wireless rf planner link budget fspl fresnel path loss' },
    { labelKey: 'wifi_rf.tab_channels', nav: { tab: 'channels' }, keywords: 'channel plan unii 2.4ghz 5ghz 6ghz' },
    { labelKey: 'wifi_rf.tab_wapconfig', nav: { tab: 'wapconfig' }, keywords: 'ap access point config' },
    { labelKey: 'wifi_rf.tab_security', nav: { tab: 'security' }, keywords: 'wpa3 security' },
    { labelKey: 'wifi_rf.tab_reference', nav: { tab: 'reference' } },
    { labelKey: 'wifi_rf.tab_ptp', nav: { tab: 'ptp' }, keywords: 'point to point bridge' },
    { labelKey: 'wifi_rf.tab_cheatsheet', nav: { tab: 'cheatsheet' } },
  ] },
  { id: 'lorawan-planner', label: 'LoRaWAN / IoT Capacity Planner', group: 'Infrastructure', type: 'tool', keywords: 'lorawan iot lora spreading factor airtime gateway capacity duty cycle sf7 sf8 sf9 sf10 sf11 sf12 sub-ghz' },
  { id: 'wifi-qr', label: 'QR Code Generator / Decoder', group: 'Infrastructure', type: 'tool',
    keywords: 'wifi qr code generator decoder decode scan ssid url link text general onboarding provisioning barcode 2d matrix',
    subTools: [
      { labelKey: 'wifi_qr.tab_wifi', nav: { tab: 'wifi' }, keywords: 'wifi ssid password wpa wpa2 wpa3 hidden network' },
      { labelKey: 'wifi_qr.tab_url',  nav: { tab: 'url' },  keywords: 'url web website link http https' },
      { labelKey: 'wifi_qr.tab_text', nav: { tab: 'text' }, keywords: 'text raw plain message string notes' },
      { labelKey: 'wifi_qr.tab_decode', nav: { tab: 'decode' }, keywords: 'decode read scan parse screenshot image paste file reader' },
    ],
  },
  { id: 'poe-budget', label: 'PoE Power Budget', group: 'Infrastructure', type: 'tool' },
  { id: 'image-transfer-planner', label: 'SCP / TFTP Transfer Planner', group: 'Infrastructure', type: 'tool', keywords: 'scp tftp ftp sftp http https image transfer planner speed upgrade fleet copy command cisco juniper arista fortinet panos linux bandwidth time' },
  { id: 'tcp-congestion', label: 'TCP Congestion Visualizer', group: 'Infrastructure', type: 'tool', keywords: 'tcp congestion window reno cubic bbr bdp slow start cwnd ssthresh sysctl tuning throughput' },
  { id: 'tcp-throughput', label: 'TCP Throughput & BDP', group: 'Infrastructure', type: 'tool', keywords: 'tcp throughput window scaling rfc 7323 rtt mss bdp bandwidth delay product lfn l2 l3 l4 overhead efficiency' },
  { id: 'lb-config', label: 'Load Balancer Config', group: 'Infrastructure', type: 'tool', keywords: 'load balancer haproxy nginx f5 big-ip reverse proxy lbaas backend frontend ssl termination health check session persistence rate limiting' },
  { id: 'netbox-import', label: 'NetBox / Nautobot Import Builder', group: 'Infrastructure', type: 'tool', keywords: 'netbox nautobot inventory csv json import dcim ipam device interface vlan vrf circuit site rack' },
  { id: 'kea-dhcp', label: 'Kea DHCP Lease Manager', group: 'Infrastructure', type: 'tool',
    keywords: 'kea dhcp lease csv mac address arp convert diff import isc dhcp4 leases4 subnet binding opnsense freebsd',
    subTools: [
      { labelKey: 'kea_dhcp.tab_viewer',    nav: { tab: 'viewer' },    keywords: 'kea dhcp parse view table filter edit delete duplicates stats active expired' },
      { labelKey: 'kea_dhcp.tab_converter', nav: { tab: 'converter' }, keywords: 'cisco linux windows bsd junos arp to lease generate' },
      { labelKey: 'kea_dhcp.tab_diff',      nav: { tab: 'diff' },      keywords: 'compare missing stale gap analysis reconcile' },
    ],
  },
  { id: 'doh-dot-cfg', label: 'DNS over HTTPS/TLS Builder', group: 'Infrastructure', type: 'tool', keywords: 'dns doh dot doq https tls security cisco bind unbound resolved browser profile cert pin policy' },
  { id: 'zigbee-toolkit', label: 'Zigbee / IEEE 802.15.4 Toolkit', group: 'Infrastructure', type: 'tool', keywords: 'zigbee ieee 802.15.4 iot protocol smart home sensor mesh coordinator router', subTools: [
    { labelKey: 'zigbee_toolkit.tab_channel', nav: { tab: 'channel' }, keywords: 'zigbee toolkit channel interference wifi overlap' },
    { labelKey: 'zigbee_toolkit.tab_capacity', nav: { tab: 'capacity' }, keywords: 'capacity mesh network size' },
    { labelKey: 'zigbee_toolkit.tab_battery', nav: { tab: 'battery' }, keywords: 'battery life cr2032 power' },
    { labelKey: 'zigbee_toolkit.tab_frame', nav: { tab: 'frame' }, keywords: 'frame decoder mac' },
    { labelKey: 'zigbee_toolkit.tab_linkbudget', nav: { tab: 'linkbudget' }, keywords: 'link budget rssi range' },
    { labelKey: 'zigbee_toolkit.tab_compare', nav: { tab: 'compare' }, keywords: 'compare thread z-wave ble lorawan matter protocol' },
  ] },
  { id: 'k8s-netpol-builder', label: 'Kubernetes Network Policy Builder', group: 'Infrastructure', type: 'tool', keywords: 'kubernetes networkpolicy network policy yaml manifest pod selector ingress egress namespace container security rules' },
  { id: 'cabling-ref', label: 'Cabling Reference', group: 'Infrastructure', type: 'ref', keywords: 'cabling reference fiber mpo mtp copper t568 wiring', subTools: [
    { labelKey: 'cabling-ref.tab_mpo',    nav: { tab: 'mpo' },    keywords: 'cabling reference mpo mtp fiber polarity type-a type-b type-c breakout 12-fiber 24-fiber tia-568 tia-598' },
    { labelKey: 'cabling-ref.tab_copper', nav: { tab: 'copper' }, keywords: 'copper t568 t568a t568b rj45 wiring pinout straight crossover' },
  ] },
  { id: 'radius-tacacs', label: 'RADIUS / TACACS+ Ref', group: 'Infrastructure', type: 'ref', keywords: 'radius tacacs aaa authentication authorization accounting rfc2865 rfc2866 cisco freeradius', subTools: [
    { labelKey: 'radius_tacacs.tab_radius',  nav: { tab: 'radius' },  keywords: 'radius attribute rfc2865 rfc2866 rfc3162 framed-ip tunnel vendor-specific vsa ppp' },
    { labelKey: 'radius_tacacs.tab_tacacs',  nav: { tab: 'tacacs' },  keywords: 'tacacs+ av-pair shell priv-lvl service-type cmd authorization' },
    { labelKey: 'radius_tacacs.tab_builder', nav: { tab: 'builder' }, keywords: 'av-pair builder config cisco shell freeradius priv-level acl idle-timeout' },
  ] },

  // Media
  { id: 'ipfm-ref', label: 'IPFM / NBM / PTP', group: 'Media', type: 'ref' },
  { id: 'stego', label: 'Image Steganography', group: 'Media', type: 'tool', online: false,
    keywords: 'steganography lsb hide message image png secret embed extract stego invisible covert encode decode',
    subTools: [
      { labelKey: 'stego.tab_encode', nav: { tab: 'encode' }, keywords: 'steganography embed hide lsb encrypt aes passphrase capacity png' },
      { labelKey: 'stego.tab_decode', nav: { tab: 'decode' }, keywords: 'extract reveal decrypt password recover reveal bmp' },
    ],
  },

  // Tools (Diagnostics & Utilities)
  { id: 'dns', label: 'DNS Lookup', group: 'Tools', type: 'tool', online: true, server: true },
  { id: 'dns-zone-builder', label: 'DNS Zone File Builder', group: 'Tools', type: 'tool', keywords: 'dns zone file builder bind soa serial rfc1035 rfc1982 a aaaa mx txt srv cname ns ptr records validate' },
  { id: 'syslog-builder', label: 'Syslog Builder & Parser', group: 'Tools', type: 'tool', keywords: 'syslog rfc5424 rfc3164 facility severity priority pri structured data builder parser message logging', subTools: [
    { labelKey: 'syslog_builder.tab_build', nav: { activeTab: 'build' }, keywords: 'build construct compose message syslog' },
    { labelKey: 'syslog_builder.tab_parse', nav: { activeTab: 'parse' }, keywords: 'parse decode extract analyze rfc5424 rfc3164' },
    { labelKey: 'syslog_builder.tab_reference', nav: { activeTab: 'reference' }, keywords: 'facility severity reference table codes rfc' },
  ] },
  { id: 'whois', label: 'WHOIS Lookup', group: 'Tools', type: 'tool', online: true, server: true },
  { id: 'email-diag', label: 'Email Diagnostics', group: 'Tools', type: 'tool', online: true, server: true },
  { id: 'diag', label: 'Remote Ping / MTR', group: 'Tools', type: 'tool', online: true, server: true },
  { id: 'speedtest', label: 'Speed Test', group: 'Tools', type: 'tool', online: true, server: true },
  { id: 'geo', label: 'IP Geolocation', group: 'Tools', type: 'tool', online: true, server: true },
  { id: 'ssl', label: 'SSL/TLS Inspector', group: 'Tools', type: 'tool', online: true, server: true },
  { id: 'scanner', label: 'Network Scanner', group: 'Tools', type: 'tool', server: true, keywords: 'nmap fping server diagnostic scan' },
  { id: 'iperf', label: 'iPerf Command Builder', group: 'Tools', type: 'tool', server: true, keywords: 'iperf iperf3 iperf2 bandwidth throughput network performance speed test',
    subTools: [
      { labelKey: 'iperf.tab_client',     nav: { tab: 'client' },     keywords: 'iperf command builder tcp udp sctp jitter packet loss client parallel streams reverse bidir' },
      { labelKey: 'iperf.tab_server',     nav: { tab: 'server' },     keywords: 'server daemon listen' },
      { labelKey: 'iperf.tab_cheatsheet', nav: { tab: 'cheatsheet' }, keywords: 'cheatsheet reference flags options comparison benchmark' },
    ] },
  { id: 'bandwidth', label: 'Bandwidth & Throughput', group: 'Tools', type: 'tool' },
  { id: 'dataunit', label: 'Data Unit Converter', group: 'Tools', type: 'tool' },
  { id: 'hashgen', label: 'Hash Generator', group: 'Tools', type: 'tool' },
  { id: 'aescrypt', label: 'Text & File Encryption', group: 'Tools', type: 'tool', online: false, keywords: 'aes gcm encrypt decrypt password pbkdf2 cipher file text crypto symmetric aes256 key derivation secure' },
  { id: 'regex', label: 'Regex Find & Replace', group: 'Tools', type: 'tool' },
  { id: 'cert-gen', label: 'Self-Signed Cert Gen', group: 'Tools', type: 'tool' },
  { id: 'cert-chain', label: 'Certificate Chain Validator', group: 'Tools', type: 'tool', keywords: 'cert-chain certificate chain builder validator trust path root intermediate leaf pem signature verify expiration validity mismatch ssl tls node-forge' },
  { id: 'cypher', label: 'Cypher Deck', group: 'Tools', type: 'tool', keywords: 'cipher encoding decoding encoder decoder', subTools: [
    { labelKey: 'cypher.tabs.encode', nav: { activeTab: 'encode' }, keywords: 'cipher cypher encoding decoding base64 url rot13 hex binary encode decode' },
    { labelKey: 'cypher.tabs.hash', nav: { activeTab: 'hash' }, keywords: 'md5 sha sha256 hash' },
    { labelKey: 'cypher.tabs.jwt', nav: { activeTab: 'jwt' }, keywords: 'jwt json web token decode' },
    { labelKey: 'cypher.tabs.xor', nav: { activeTab: 'xor' }, keywords: 'xor cipher key' },
  ] },
  { id: 'wireshark', label: 'Capture Toolkit', group: 'Tools', type: 'tool', server: true, keywords: 'wireshark packet capture filter server', subTools: [
    { labelKey: 'wireshark.tcpdump.tab', nav: { activeTab: 'tcpdump' }, keywords: 'wireshark capture tcpdump command builder' },
    { labelKey: 'wireshark.tabs.tshark', nav: { activeTab: 'tshark' }, keywords: 'tshark command builder' },
    { labelKey: 'wireshark.tabs.display', nav: { activeTab: 'display' }, keywords: 'display filter wireshark' },
    { labelKey: 'wireshark.tabs.capture', nav: { activeTab: 'capture' }, keywords: 'bpf capture filter' },
    { labelKey: 'wireshark.tabs.library', nav: { activeTab: 'library' }, keywords: 'filter library reference' },
  ] },
  { id: 'traffic-gen', label: 'Traffic Generator (Scapy/TRex)', group: 'Tools', type: 'tool', keywords: 'scapy trex traffic generator rfc2544 imix multicast convergence stress pps line-rate script profile' },
  { id: 'systools', label: 'SysTool CLI Builder', group: 'Tools', type: 'tool', keywords: 'netsh nmtui netstat ss route ip ping traceroute hping3 iperf3 wget curl nload nethogs iftop speedometer ipconfig tracert nslookup network diagnostic command cli', subTools: [
    { labelKey: 'systools.linux_tab',   nav: { activeTab: 'linux' },   keywords: 'linux netstat ss ip route ping traceroute iperf3 nload nethogs iftop' },
    { labelKey: 'systools.windows_tab', nav: { activeTab: 'windows' }, keywords: 'windows ipconfig netsh tracert nslookup' },
  ] },
  { id: 'cli-ref', label: 'CLI Quick Reference', group: 'Tools', type: 'tool', subTools: [
    { labelKey: 'cliref.platforms.ios',   nav: { activeTab: 'ios' },   keywords: 'cli reference cisco ios ios-xe show interface routing bgp ospf' },
    { labelKey: 'cliref.platforms.nxos',  nav: { activeTab: 'nxos' },  keywords: 'cisco nxos nx-os nexus show interface vpc' },
    { labelKey: 'cliref.platforms.junos', nav: { activeTab: 'junos' }, keywords: 'juniper junos show route interfaces ospf bgp' },
  ] },
  { id: 'ports', label: 'Port Reference', group: 'Infrastructure', type: 'ref', keywords: 'port reference well-known tcp udp protocol number l4 l3', subTools: [
    { labelKey: 'ports.tab_l4', nav: { activeTab: 'ports' },     keywords: 'tcp udp port well-known service l4 transport layer' },
    { labelKey: 'ports.tab_l3', nav: { activeTab: 'protocols' }, keywords: 'ip protocol number icmp ospf gre esp ah igmp l3 network layer' },
  ] },
  { id: 'jsonfmt', label: 'Format Toolkit', group: 'Tools', type: 'tool', keywords: 'json xml yaml format formatter beautify minify convert diff jsonpath netconf restconf openconfig ansible frr bgp netplan kubernetes k8s query compare', subTools: [
    { labelKey: 'jsonfmt.tab_json', nav: { tab: 'json' }, keywords: 'json format formatter' },
    { labelKey: 'jsonfmt.tab_xml', nav: { tab: 'xml' } },
    { labelKey: 'jsonfmt.tab_yaml', nav: { tab: 'yaml' } },
    { labelKey: 'jsonfmt.tab_csv', nav: { tab: 'csv' } },
    { labelKey: 'jsonfmt.tab_tsv', nav: { tab: 'tsv' } },
    { labelKey: 'jsonfmt.tab_toml', nav: { tab: 'toml' } },
    { labelKey: 'jsonfmt.tab_ini', nav: { tab: 'ini' } },
    { labelKey: 'jsonfmt.tab_jsonl', nav: { tab: 'jsonl' } },
    { labelKey: 'jsonfmt.tab_markdown', nav: { tab: 'markdown' } },
    { labelKey: 'jsonfmt.tab_jsonpath', nav: { tab: 'jsonpath' }, keywords: 'jsonpath query' },
    { labelKey: 'jsonfmt.tab_diff', nav: { tab: 'diff' }, keywords: 'diff compare' },
  ] },
  { id: 'jwt', label: 'JWT Toolkit', group: 'Tools', type: 'tool', keywords: 'jwt json web token signature payload hs256 rs256 secure claims', subTools: [
    { labelKey: 'jwt_tools.tabs.decode', nav: { activeTab: 'decode' }, keywords: 'jwt json web token decode verify' },
    { labelKey: 'jwt_tools.tabs.encode', nav: { activeTab: 'encode' }, keywords: 'encode sign jwt' },
  ] },
  { id: 'passgen', label: 'Password Generator', group: 'Tools', type: 'tool' },
  { id: 'tsconv', label: 'Timestamp Converter', group: 'Tools', type: 'tool' },
  { id: 'uptime', label: 'Uptime & SLA Calculator', group: 'Tools', type: 'tool', subTools: [
    { labelKey: 'uptime.tab_downtime',  nav: { activeTab: 'downtime' },  keywords: 'uptime sla calculator downtime nines availability budget' },
    { labelKey: 'uptime.tab_composite', nav: { activeTab: 'composite' }, keywords: 'composite series parallel multi-tier aggregate' },
    { labelKey: 'uptime.tab_impact',    nav: { activeTab: 'impact' },    keywords: 'outage impact cost revenue mttr incidents' },
  ] },
  { id: 'cronparse', label: 'Cron Parser', group: 'Tools', type: 'tool' },
  { id: 'redircheck', label: 'Redirect Checker', group: 'Tools', type: 'tool', online: true, server: true },
  { id: 'uaparse', label: 'User Agent Parser', group: 'Tools', type: 'tool' },
  { id: 'sechdrs', label: 'Security Headers', group: 'Tools', type: 'tool', online: true, server: true, subTools: [
    { labelKey: 'sechdrs.tab_url', nav: { activeTab: 'url' }, keywords: 'security headers fetch url live analyze check' },
    { labelKey: 'sechdrs.tab_raw', nav: { activeTab: 'raw' }, keywords: 'paste raw http response headers manual' },
  ] },
  { id: 'cisco-passwords', label: 'Cisco Password Types', group: 'Tools', type: 'tool', subTools: [
    { labelKey: 'cisco_pwd.tab_ref',     nav: { activeTab: 'ref' },     keywords: 'cisco password types reference type 0 4 5 7 8 9 md5 sha256 scrypt' },
    { labelKey: 'cisco_pwd.tab_scanner', nav: { activeTab: 'scanner' }, keywords: 'scanner config audit weak password running-config' },
    { labelKey: 'cisco_pwd.tab_decoder', nav: { activeTab: 'decoder' }, keywords: 'type-7 decoder encoder xor decode encode hash' },
  ] },
  { id: 'snmp-builder', label: 'SNMP Command Builder', group: 'Tools', type: 'tool' },
  { id: 'cipher-suite', label: 'TLS Cipher Suite Decoder', group: 'Tools', type: 'tool' },
  { id: 'ssh-config', label: 'SSH Config Generator', group: 'Tools', type: 'tool', keywords: 'ssh config proxyjump tunnel keepalive cisco juniper arista network device' },
  { id: 'config-diff', label: 'Config Diff Viewer', group: 'Tools', type: 'tool', keywords: 'config diff compare cisco ios nx-os juniper junos arista eos side-by-side syntax highlight network device configuration' },
  { id: 'config-redactor', label: 'Config Redactor', group: 'Tools', type: 'tool', keywords: 'redact config sanitize obfuscate mask password ip-obfuscation snmp key credential security api-key token bearer' },
  { id: 'config-parser', label: 'Device Config Parser', group: 'Tools', type: 'tool', keywords: 'config parser translator junos juniper cisco ios ios-xe ios-xr nxos nx-os asa arista eos fortinet fortios fortigate aruba aoscx aos-cx huawei vrp ce comware h3c hpe dell os10 paloalto pan-os palo-alto vyos extreme exos mikrotik routeros checkpoint gaia f5 bigip tmsh tmos firewall policy acl rule aggregate ae lag lacp port-channel bundle-ether eth-trunk bond bonding trunk vlan vrf routing-instance vdom zone interface bgp ospf isis mpls ldp svi irb decode hierarchy auto-detect ntp tacacs radius syslog snmp vpc nbm fex' },
  { id: 'device-converter', label: 'Device Config Converter', group: 'Tools', type: 'tool', keywords: 'device switch config converter migration translate cisco ios junos arista eos aruba aos-cx comware vlan trunk access port-channel lacp stp firewall rule policy security asa palo alto fortios pan-os fortinet acl access-list', subTools: [
    { labelKey: 'device_converter.tab_converter',  nav: { activeTab: 'converter' },  keywords: 'device converter convert translate migrate paste config source target vendor' },
    { labelKey: 'device_converter.tab_cheatsheet', nav: { activeTab: 'cheatsheet' }, keywords: 'cheatsheet syntax reference vlan interface commands' },
  ] },
  { id: 'nxapi-builder', label: 'NX-API Request Builder', group: 'Tools', type: 'tool', keywords: 'cisco nexus nx-os nxapi rest json-rpc dme programmability api curl request' },
  { id: 'lldp-cdp-parser', label: 'LLDP/CDP Parser', group: 'Tools', type: 'tool', keywords: 'lldp cdp neighbor topology show lldp neighbors detail cdp parse map adjacency' },
  { id: 'routing-table-parser', label: 'Routing Table Parser', group: 'Tools', type: 'tool', keywords: 'routing table parse show ip route ipv6 netstat ip route show ospf bgp eigrp rip isis static connected prefix longest match' },
  { id: 'tunnel-overhead', label: 'Tunnel Overhead', group: 'Infrastructure', type: 'tool', keywords: 'tunnel overhead gre vxlan ipsec wireguard mpls nvgre geneve l2tpv3 capwap mtu encapsulation comparison' },
  { id: 'ntp-stratum', label: 'NTP Stratum Calculator', group: 'Infrastructure', type: 'tool',
    keywords: 'ntp stratum hierarchy reference clock offset delay jitter ntpq chronyc sources sync time rfc5905 gps pps',
    subTools: [
      { labelKey: 'ntp_stratum.tab_hierarchy', nav: { tab: 'hierarchy' }, keywords: 'ntp stratum refid kiss-o-death kod stratum 0 1 2 gps pps atomic wwvb sntp rfc4330' },
      { labelKey: 'ntp_stratum.tab_odj',       nav: { tab: 'odj' },       keywords: 't1 t2 t3 t4 timestamp rtt round-trip clock offset calculation' },
      { labelKey: 'ntp_stratum.tab_parse',     nav: { tab: 'parse' },     keywords: 'ntpq -p chronyc sources tally code falseticker candidate peer parse' },
    ],
  },
  { id: 'tcp-flags', label: 'TCP Flag Decoder', group: 'Infrastructure', type: 'tool', keywords: 'tcp flags syn ack fin rst psh urg ece cwr ns decode xmas null scan wireshark filter hex binary' },
  { id: 'arista-api-builder', label: 'Arista eAPI Builder', group: 'Tools', type: 'tool', keywords: 'arista eos eapi json-rpc command api curl python switch programmability' },
  { id: 'cisco-dnac-builder', label: 'Cisco DNAC Builder', group: 'Tools', type: 'tool', keywords: 'cisco dna center dnac rest api token authentication curl python network device' },
  { id: 'config-template', label: 'Config Templater', group: 'Tools', type: 'tool', keywords: 'template jinja variable substitution csv json config bulk generate device network' },
  { id: 'country-tz', label: 'Country & Timezone Reference', group: 'Tools', type: 'tool', keywords: 'country timezone iso 3166 dial code flag utc offset dst working hours overlap international calling codes compare side-by-side', subTools: [
    { labelKey: 'country_tz.tab_lookup',  nav: { activeTab: 'lookup' },  keywords: 'lookup country iso dial code flag utc offset dst' },
    { labelKey: 'country_tz.tab_compare', nav: { activeTab: 'compare' }, keywords: 'compare side-by-side working hours overlap timezone diff' },
  ] },
  { id: 'ascii-diagram', label: 'ASCII Network Diagram', group: 'Tools', type: 'tool', keywords: 'ascii network diagram topology router switch firewall server cloud connection interface label documentation runbook text' },
  { id: 'mermaid-diagram', label: 'Mermaid Network Diagram', group: 'Tools', type: 'tool', keywords: 'mermaid diagram network topology spine leaf core distribution access campus firewall dmz wan hub spoke mpls sdwan bgp ospf vpn ipsec dmvpn datacenter template preset flowchart graph visualization' },
  { id: 'ansible-inventory', label: 'Ansible Inventory Converter', group: 'Tools', type: 'tool', keywords: 'ansible inventory ini yaml json csv convert parse hosts groups vars variables inheritance playbook dynamic inventory hostvars group_vars' },
  { id: 'docker-net-builder', label: 'Docker/Podman Network Builder', group: 'Infrastructure', type: 'tool', keywords: 'docker podman network bridge overlay macvlan ipvlan cni kubernetes k8s compose network create container networking driver subnet gateway' },
  { id: 'rack-elevation', label: 'Rack Elevation Designer', group: 'Infrastructure', type: 'tool', keywords: 'rack elevation diagram design u server switch router firewall ups pdu patch panel weight power airflow svg ascii bom datacenter' },
  { id: 'hex-dump', label: 'Hex Dump / ASCII Decoder', group: 'Tools', type: 'tool', keywords: 'hex dump ascii decode encode binary xxd hexdump c array bytes offset utf8 text converter packet data wireshark', subTools: [
    { labelKey: 'hex_dump.tab_hex2text',       nav: { activeTab: 'hex2text' },       keywords: 'hex dump ascii decoder hex to text decode utf8 bytes packet wireshark' },
    { labelKey: 'hex_dump.tab_text2hex',       nav: { activeTab: 'text2hex' },       keywords: 'text to hex encode xxd c array binary dump' },
    { labelKey: 'hex_dump.tab_byte_inspector', nav: { activeTab: 'byte-inspector' }, keywords: 'byte inspector printable control characters lookup' },
    { labelKey: 'hex_dump.tab_ascii_table',    nav: { activeTab: 'ascii-table' },    keywords: 'ascii table reference characters codes printable control' },
  ] },
  { id: 'terraform-builder', label: 'Terraform Snippet Builder', group: 'Tools', type: 'tool', keywords: 'terraform provider snippet builder hcl resource infrastructure-as-code iac', subTools: [
    { labelKey: 'terraform_builder.opt_aws',          nav: { provider: 'aws' },   keywords: 'aws vpc subnet security group tgw nat alb peering' },
    { labelKey: 'terraform_builder.opt_azure',        nav: { provider: 'azure' }, keywords: 'azure vnet nsg aks app gateway private endpoint firewall azurerm' },
    { labelKey: 'terraform_builder.opt_gcp',          nav: { provider: 'gcp' },   keywords: 'gcp google vpc subnetwork firewall compute network' },
    { labelKey: 'terraform_builder.opt_cisco_aci',    nav: { provider: 'aci' },   keywords: 'cisco aci tenant vrf bd epg contract l3out' },
    { labelKey: 'terraform_builder.opt_cisco_asa',    nav: { provider: 'asa' },   keywords: 'cisco asa access rules nat static route ciscoasa' },
    { labelKey: 'terraform_builder.opt_cisco_nexus',  nav: { provider: 'nexus' }, keywords: 'cisco nexus dcnm vxlan fabric bgp vrf network' },
  ] },
  { id: 'flow-export', label: 'Flow Export Builder', group: 'Tools', type: 'tool', keywords: 'netflow ipfix sflow flow export collector jflow sampling telemetry cisco juniper arista softflowd', subTools: [
    { labelKey: 'flow_export.tab_builder',   nav: { tab: 'builder' },   keywords: 'flow exporter monitor record config generate ios-xr flexible netflow junos sampling eos softflowd' },
    { labelKey: 'flow_export.tab_sampler',   nav: { tab: 'sampler' },   keywords: 'sampler calculator sample rate 1:n pps cache sizing active inactive timeout export bandwidth' },
    { labelKey: 'flow_export.tab_reference', nav: { tab: 'reference' }, keywords: 'v5 v9 ipfix sflow comparison template fields information element ports 2055 9995 4739 6343 rfc7011' },
  ] },

  // Education
  { id: 'net-arcade', label: 'Network Arcade', group: 'Education', type: 'tool', keywords: 'arcade game learning education interactive quiz', subTools: [
    { labelKey: 'arcade.packet_rain.title', nav: { activeGame: 'packet-rain' }, keywords: 'packet rain protocol layer classification drag drop reflexes' },
    { labelKey: 'arcade.subnet_sprint.title', nav: { activeGame: 'subnet-ipv4' }, keywords: 'subnet sprint ipv4 cidr subnetting math quiz' },
    { labelKey: 'arcade.ipv6_gauntlet.title', nav: { activeGame: 'subnet-ipv6' }, keywords: 'ipv6 gauntlet compress expand eui-64 prefix' },
  ] },
];

function App() {
  const { lang, setLang, t } = useTranslation();

  const getInitialHashData = () => {
    try {
      const hash = location.hash.slice(1);
      if (!hash) return null;
      // Try Base64 first (new format), fallback to raw JSON (old format)
      try {
        const decoded = decodeURIComponent(escape(atob(hash)));
        return JSON.parse(decoded);
      } catch (e) {
        // Fallback for old links that were plain JSON
        const raw = decodeURIComponent(hash);
        return JSON.parse(raw);
      }
    } catch (e) { }
    return null;
  };

  const [hashData, setHashData] = useState(getInitialHashData);
  const activeTool = hashData?.tool || localStorage.getItem('ip-tool-active') || 'subnet';

  const handleSelectTool = (toolId, extra) => {
    setHashData({ tool: toolId, ...(extra || {}) });
  };
  // A consolidated toolkit reports its active inner tab so the sidebar/search highlight stays in sync
  const handleNav = useCallback((nav) => {
    if (!nav) return;
    setHashData(h => {
      const base = h || {};
      if (Object.keys(nav).every(k => base[k] === nav[k])) return base;
      return { ...base, ...nav };
    });
  }, []);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedTools, setExpandedTools] = useState(() => {
    const t = TOOLS.find(t => t.id === activeTool);
    return t?.subTools?.length > 0 ? new Set([activeTool]) : new Set();
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [showLangModal, setShowLangModal] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [shareData, setShareData] = useState(null);
  const [theme, setTheme] = useState(() => {
    const s = localStorage.getItem('ip-tool-dark');
    if (s === null || s === 'system') return 'system';
    if (s === 'light' || s === 'dark') return s;
    return s === 'false' ? 'light' : 'dark';
  });

  const isDark = theme === 'system'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : theme === 'dark';

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const [toast, setToast] = useState(null);

  const showToast = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2000);
  }, []);

  const handleShare = useCallback(async (data) => {
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
    const baseUrl = location.href.split('#')[0];
    const url = `${baseUrl}#${b64}`;

    if (navigator.share) {
      try {
        await navigator.share({ title: 'NetEngKit', url });
        return;
      } catch (e) { }
    }

    // Fallback: Copy to clipboard (navigator.clipboard requires HTTPS; use execCommand on file://)
    try {
      await navigator.clipboard.writeText(url);
      showToast(t('common.share_modal.copied'));
    } catch (e) {
      try {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        showToast(t('common.share_modal.copied'));
      } catch (e2) {
        showToast(url);
      }
    }
  }, [t]);


  const triggerGlobalShare = () => {
    setIsMenuOpen(false);
    let handled = false;
    window.dispatchEvent(new CustomEvent('app:request-share', {
      detail: { respond: (data) => { handled = true; handleShare(data); } }
    }));
    if (!handled) handleShare({ tool: activeTool });
  };

  useEffect(() => {
    // Clean URL hash after processing
    if (location.hash) {
      setTimeout(() => {
        try {
          // history.replaceState can fail on file:// protocol in some browsers
          history.replaceState(null, '', location.pathname + location.search);
        } catch (e) {
          // Safe fallback for file:// or when history API is restricted
          location.hash = '';
        }
      }, 500);
    }
  }, []);

  // Cross-tool navigation: tools dispatch app:navigate to jump to another tool
  // and hand it state (e.g. TCP Flag Decoder → Capture Toolkit with a display filter).
  useEffect(() => {
    const handleNavigate = (e) => {
      if (e.detail && e.detail.tool) {
        setIsSidebarOpen(false);
        setHashData({ ...e.detail });
        window.scrollTo({ top: 0, behavior: 'smooth' });
      }
    };
    window.addEventListener('app:navigate', handleNavigate);
    return () => window.removeEventListener('app:navigate', handleNavigate);
  }, []);

  useEffect(() => {
    const handleHashChange = () => {
      setHashData(getInitialHashData());
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Auto-expand sub-tool list whenever the active tool is a toolkit (never collapses others)
  useEffect(() => {
    const tool = TOOLS.find(t => t.id === activeTool);
    if (tool?.subTools?.length > 0) setExpandedTools(prev => new Set([...prev, activeTool]));
  }, [activeTool]);

  useEffect(() => {
    const el = document.getElementById('boot-screen');
    if (!el) return;
    const MIN_MS = 600;
    const elapsed = Date.now() - (window.__bootStart || Date.now());
    const delay = Math.max(0, MIN_MS - elapsed);
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, delay);
  }, []);

  useEffect(() => {
    if (theme !== 'system') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => document.documentElement.className = mq.matches ? '' : 'light';
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [theme]);

  useEffect(() => {
    const handleKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(prev => !prev);
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
        e.preventDefault();
        if (window.LANGUAGES) {
          const currentIndex = window.LANGUAGES.findIndex(l => l.id === lang);
          const nextIndex = (currentIndex + 1) % window.LANGUAGES.length;
          const nextLang = window.LANGUAGES[nextIndex];
          setLang(nextLang.id);
          showToast(
            <span style={{display:'flex',flexDirection:'column',alignItems:'center',gap:1}}>
              <span>{nextLang.flag} {nextLang.label}</span>
              {nextLang.id !== 'en' && <span style={{fontWeight:400,fontSize:11,opacity:0.75}}>{nextLang.enLabel}</span>}
            </span>
          );
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
        e.preventDefault();
        const idx = TOOLS.findIndex(t => t.id === activeTool);
        const next = e.key === 'ArrowRight'
          ? (idx + 1) % TOOLS.length
          : (idx - 1 + TOOLS.length) % TOOLS.length;
        setHashData({ tool: TOOLS[next].id });
      }
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        setShowSearch(true);
      }
      if ((e.ctrlKey || e.metaKey) && e.altKey && e.key === 'h') {
        e.preventDefault();
        setShowHelp(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lang, setLang, showToast, activeTool]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    document.documentElement.className = isDark ? '' : 'light';
    localStorage.setItem('ip-tool-dark', theme);
  }, [isDark, theme]);

  useEffect(() => {
    localStorage.setItem('ip-tool-active', activeTool);
  }, [activeTool]);

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth > 768 && isSidebarOpen) {
        setIsSidebarOpen(false);
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isSidebarOpen]);

  const handleSearchSelect = (item) => {
    handleSelectTool(item.id, item.nav);
    setShowSearch(false);
    setSearchQuery('');
    setIsSidebarOpen(false);
  };

  // True when current hashData matches all coords of a sub-tool's nav
  const isSubActive = (sub) => {
    if (!sub || !sub.nav || !hashData) return false;
    return Object.keys(sub.nav).every(k => hashData[k] === sub.nav[k]);
  };
  // Does a sub-tool match the current search query?
  const subMatchesQuery = (sub) => {
    const s = searchQuery.trim().toLowerCase();
    if (s === '') return false;
    const lbl = t(sub.labelKey, '').toLowerCase();
    return lbl.includes(s) || (sub.keywords && sub.keywords.toLowerCase().includes(s));
  };

  const navGroups = ['IPv4', 'IPv6', 'BOTH (IPv4 and IPv6)', 'Multicast', 'Switching', 'Routing', 'Infrastructure', 'Media', 'Tools', 'Education'];
  const navGroupMap = {
    'IPv4': 'nav.ipv4',
    'IPv6': 'nav.ipv6',
    'BOTH (IPv4 and IPv6)': 'nav.both',
    'Multicast': 'nav.multicast',
    'Switching': 'nav.switching',
    'Routing': 'nav.routing',
    'Infrastructure': 'nav.infrastructure',
    'Media': 'nav.media',
    'Tools': 'nav.tools',
    'Education': 'nav.education'
  };

  const navTypes = [
    { id: 'tool', label: t('common.utility_tools') },
    { id: 'ref', label: t('common.reference_library') }
  ];

  const isOnlineQuery = /^onl?i/i.test(searchQuery.trim());
  const isServerQuery = /^serv?/i.test(searchQuery.trim());

  const filteredTools = searchQuery.trim() === ''
    ? TOOLS
    : isOnlineQuery
      ? TOOLS.filter(tool => tool.online)
      : isServerQuery
        ? TOOLS.filter(tool => tool.server)
        : TOOLS.filter(tool => {
          const s = searchQuery.toLowerCase();
          const localizedLabel = t(`tools.${tool.id}.title`, tool.label).toLowerCase();
          return localizedLabel.includes(s) ||
            tool.group.toLowerCase().includes(s) ||
            (tool.keywords && tool.keywords.toLowerCase().includes(s)) ||
            (tool.subTools && tool.subTools.some(subMatchesQuery));
        });

  const renderTool = () => {
    switch (activeTool) {
      case 'subnet': return <SubnetCalc onShare={handleShare} initialData={hashData} onNav={handleNav} />;
      case 'subnet-planner': return <SubnetPlanner onShare={handleShare} initialData={hashData} onNav={handleNav} />;
      case 'converter': return <IPConverter initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'ipv6': return <IPv6Tools initialData={hashData} onShare={handleShare} />;
      case 'acl': return <ACLGenerator initialData={hashData} onShare={handleShare} />;
      case 'split-tunnel': return <SplitTunnel initialData={hashData} onShare={handleShare} />;
      case 'bogon-filter': return <BogonFilterGen initialData={hashData} onShare={handleShare} />;
      case 'nat-pat-calc': return <NATPATCalculator initialData={hashData} onShare={handleShare} />;
      case 'ipv6subnet': return <IPv6SubnetCalc initialData={hashData} onShare={handleShare} />;
      case 'classify': return <IPClassifier initialData={hashData} onShare={handleShare} />;
      case 'mac': return <MACTools initialData={hashData} onShare={handleShare} />;
      case 'arp-parser': return <ARPTableParser initialData={hashData} onShare={handleShare} />;
      case 'config-parser': return <ConfigParser initialData={hashData} onShare={handleShare} />;
      case 'mcast-toolkit': return <MulticastToolkit initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'ipfm-ref': return <IPFMRef />;
      case 'switching-ref': return <SwitchingRef initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'mpls-ref': return <MPLSRef />;
      case 'vxlan-ref': return <VXLANRef />;
      case 'dns': return <DNSLookup initialData={hashData} onShare={handleShare} />;
      case 'dns-zone-builder': return <DNSZoneBuilder initialData={hashData} onShare={handleShare} />;
      case 'syslog-builder': return <SyslogBuilder initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'ntp-stratum': return <NTPStratum initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'tcp-flags': return <TCPFlagDecoder initialData={hashData} onShare={handleShare} />;
      case 'whois': return <WHOISLookup initialData={hashData} onShare={handleShare} />;
      case 'email-diag': return <EmailDiagnostics initialData={hashData} onShare={handleShare} />;
      case 'ssl': return <SSLInspector initialData={hashData} onShare={handleShare} />;
      case 'cert-gen': return <SelfSignedCertGen initialData={hashData} onShare={handleShare} />;
      case 'cert-chain': return <CertChainBuilder initialData={hashData} onShare={handleShare} />;
      case 'diag': return <RemoteDiagnostics initialData={hashData} onShare={handleShare} />;
      case 'speedtest': return <SpeedTest initialData={hashData} onShare={handleShare} />;
      case 'geo': return <GeoLookup initialData={hashData} onShare={handleShare} />;
      case 'asn': return <ASNLookup initialData={hashData} onShare={handleShare} />;
      case 'scanner': return <NetworkScanner initialData={hashData} onShare={handleShare} />;
      case 'iperf': return <IperfBuilder initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'ports': return <PortReference initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'cheatsheet': return <CheatSheet />;
      case 'icmp-ref': return <ICMPRef initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'cable': return <CableCalculator initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'cabling-ref': return <CablingRef initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'osi-model': return <OSIModel />;
      case 'packet-headers': return <PacketHeaders initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'config-gen': return <InterfaceConfigGen initialData={hashData} onShare={handleShare} />;
      case 'device-converter': return <DeviceConfigConverter initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'wireshark': return <CaptureTools initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'netbox-import': return <NetboxImport initialData={hashData} onShare={handleShare} />;
      case 'kea-dhcp': return <KeaDHCP initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'doh-dot-cfg': return <DohDotConfig initialData={hashData} onShare={handleShare} />;
      case 'zigbee-toolkit': return <ZigbeeToolkit initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'traffic-gen': return <TrafficGen initialData={hashData} onShare={handleShare} />;
      case 'systools': return <SysToolBuilder initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'cypher': return <CypherDeck initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'routing-cfg': return <RoutingConfigBuilder initialData={hashData} onShare={handleShare} />;
      case 'iosxr-cfg': return <IOSXRConfigBuilder initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'image-transfer-planner': return <ImageTransferPlanner initialData={hashData} onShare={handleShare} />;
      case 'wireguard-cfg': return <WireGuardConfigBuilder initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'proto-ref': return <RoutingReference />;
      case 'vpn-ref': return <VPNArchitect />;
      case 'qos-tool': return <QoSDSCPTool initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'wifi-rf-planner': return <WirelessRFPlanner initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'lorawan-planner': return <LoRaWANPlanner initialData={hashData} onShare={handleShare} />;
      case 'wifi-qr': return <WifiQRCode initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'poe-budget': return <PoEBudget initialData={hashData} onShare={handleShare} />;
      case 'ipv6-trans': return <IPv6Transition />;
      case 'bgp-lg': return <BGPLookingGlass initialData={hashData} onShare={handleShare} />;
      case 'lacp-tool': return <LACPSimulator initialData={hashData} onShare={handleShare} />;
      case 'qinq-config': return <QinQConfig initialData={hashData} onShare={handleShare} />;
      case 'span-builder': return <SPANConfigBuilder initialData={hashData} onShare={handleShare} />;
      case 'evpn-vxlan-designer': return <EVPNVXLANFabricDesigner initialData={hashData} onShare={handleShare} />;
      case 'k8s-netpol-builder': return <KubernetesNetworkPolicyBuilder initialData={hashData} onShare={handleShare} />;
      case 'flow-export': return <FlowExportBuilder initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'mac-table-parser': return <MacTableParser initialData={hashData} onShare={handleShare} />;
      case 'dot1x-builder': return <Dot1xBuilder initialData={hashData} onShare={handleShare} />;
      case 'net-arcade': return <ArcadeHub initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'bandwidth': return <BandwidthCalc initialData={hashData} onShare={handleShare} />;
      case 'dataunit': return <DataUnitConverter initialData={hashData} onShare={handleShare} />;
      case 'hashgen': return <HashGenerator initialData={hashData} onShare={handleShare} />;
      case 'aescrypt': return <TextFileCrypto initialData={hashData} onShare={handleShare} />;
      case 'stego': return <Steganography initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'regex': return <RegexTool initialData={hashData} onShare={handleShare} />;
      case 'mtu': return <MTUCalc initialData={hashData} onShare={handleShare} />;
      case 'dhcp': return <DHCPPlanner initialData={hashData} onShare={handleShare} />;
      case 'iplist': return <IPListGenerator initialData={hashData} onShare={handleShare} />;
      case 'cli-ref': return <CLIReference initialData={hashData} onNav={handleNav} />;
      case 'jsonfmt': return <JSONFormatter initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'jwtdecoder':
      case 'jwtenc':
      case 'jwt': return <JWTTools initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'passgen': return <PasswordGenerator initialData={hashData} onShare={handleShare} />;
      case 'tsconv': return <TimestampConverter initialData={hashData} onShare={handleShare} />;
      case 'uptime': return <UptimeCalculator initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'cronparse': return <CronParser initialData={hashData} onShare={handleShare} />;
      case 'redircheck': return <RedirectChecker initialData={hashData} onShare={handleShare} />;
      case 'uaparse': return <UserAgentParser initialData={hashData} onShare={handleShare} />;
      case 'sechdrs': return <SecurityHeaders initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'cisco-passwords': return <CiscoPasswords initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'snmp-builder': return <SNMPBuilder initialData={hashData} onShare={handleShare} />;
      case 'cipher-suite': return <CipherSuite initialData={hashData} onShare={handleShare} />;
      case 'ssh-config': return <SSHConfigGen initialData={hashData} onShare={handleShare} />;
      case 'config-diff': return <ConfigDiff initialData={hashData} onShare={handleShare} />;
      case 'config-redactor': return <ConfigRedactor initialData={hashData} onShare={handleShare} />;
      case 'bgp-community': return <BGPCommunity initialData={hashData} onShare={handleShare} />;
      case 'tcp-congestion': return <TCPCongestion initialData={hashData} onShare={handleShare} />;
      case 'fhrp-calc': return <FHRPCalc initialData={hashData} onShare={handleShare} />;
      case 'nxapi-builder': return <NXAPIBuilder initialData={hashData} onShare={handleShare} />;
      case 'lldp-cdp-parser': return <LLDPCDPParser initialData={hashData} onShare={handleShare} />;
      case 'routing-table-parser': return <RoutingTableParser initialData={hashData} onShare={handleShare} />;
      case 'tunnel-overhead': return <TunnelOverhead initialData={hashData} onShare={handleShare} />;
      case 'arista-api-builder': return <AristaAPIBuilder initialData={hashData} onShare={handleShare} />;
      case 'cisco-dnac-builder': return <CiscoDNACBuilder initialData={hashData} onShare={handleShare} />;
      case 'config-template': return <ConfigTemplateSubstitutor initialData={hashData} onShare={handleShare} />;
      case 'country-tz': return <CountryTimezone initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'ascii-diagram': return <ASCIIDiagramGenerator initialData={hashData} onShare={handleShare} />;
      case 'mermaid-diagram': return <MermaidDiagramGenerator initialData={hashData} onShare={handleShare} />;
      case 'ansible-inventory': return <AnsibleInventoryConverter initialData={hashData} onShare={handleShare} />;
      case 'docker-net-builder': return <DockerNetworkBuilder initialData={hashData} onShare={handleShare} />;
      case 'rack-elevation': return <RackElevationDesigner initialData={hashData} onShare={handleShare} />;
      case 'hex-dump': return <HexDumpTool initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'terraform-builder': return <TerraformBuilder initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      case 'lb-config': return <LBConfigBuilder initialData={hashData} onShare={handleShare} />;
      case 'tcp-throughput': return <TCPThroughputEstimator initialData={hashData} onShare={handleShare} />;
      case 'prefix-list-builder': return <PrefixListRouteMapBuilder initialData={hashData} onShare={handleShare} />;
      case 'radius-tacacs': return <RadiusTacacsRef initialData={hashData} onShare={handleShare} onNav={handleNav} />;
      default: return null;
    }
  };

  const toolInfo = TOOLS.find(tool => tool.id === activeTool);

  return (
    <div className="app">
      <header className="header">
        <button className="mobile-menu-toggle" onClick={() => setIsSidebarOpen(true)}>
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
        </button>
        <div className="logo-area">
          <div className="logo">
            <div className="logo-icon">
              <BrandLogo gradId="nekLogoHeader" />
            </div>
            <div style={{ marginLeft: 10, fontWeight: 700, letterSpacing: '-0.01em', fontSize: 15, color: 'var(--text)' }}>NetEngKit</div>
          </div>
        </div>

        {/* Center: Tool title and category centered in the header */}
        <div className="header-center">
          <span className="topbar-title">{t(`tools.${toolInfo && toolInfo.id}.title`, toolInfo && toolInfo.label)}</span>
          <span className="topbar-badge">{toolInfo ? t(navGroupMap[toolInfo.group] || toolInfo.group) : ''}</span>
          {toolInfo && toolInfo.online && (
            <span className="badge badge-blue" style={{ fontSize: 10, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 5, opacity: 0.8 }} title={t('common.online_tool_desc')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
              {t('common.online_tool')}
            </span>
          )}
          {toolInfo && toolInfo.server && (
            <span className="badge badge-purple" style={{ fontSize: 10, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 5, opacity: 0.8 }} title={t('common.server_tool_desc')}>
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
              {t('common.server_tool')}
            </span>
          )}
        </div>

        {/* Right: Menu actions in remaining space */}
        <div className="header-actions">
          <div className="dropdown-container" ref={menuRef}>
            <button className="theme-toggle-btn" onClick={() => setIsMenuOpen(!isMenuOpen)} title="Menu">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="1" /><circle cx="12" cy="5" r="1" /><circle cx="12" cy="19" r="1" /></svg>
            </button>

            <div className={`dropdown-menu ${isMenuOpen ? 'is-open' : ''}`}>
              <div className="dropdown-item" onClick={triggerGlobalShare}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" /></svg>
                {t('common.share')}
              </div>
              <div className="dropdown-divider" />
              <div className="dropdown-item" onClick={() => { setShowSearch(true); setIsMenuOpen(false); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                {t('common.search')}
                <span style={{ marginLeft: 'auto', opacity: 0.4, fontSize: 10 }}>Ctrl+K</span>
              </div>

              <div className="dropdown-item" onClick={() => { setIsMenuOpen(false); setShowLangModal(true); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" /><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" /></svg>
                {t('common.language')}
                <span style={{ marginLeft: 'auto', opacity: 0.4, fontSize: 10 }}>Ctrl+L</span>
              </div>

              <div className="dropdown-divider" />

              <div className="dropdown-item" onClick={() => { setTheme('light'); setIsMenuOpen(false); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                {t('common.theme_light')} {theme === 'light' && '✓'}
              </div>
              <div className="dropdown-item" onClick={() => { setTheme('dark'); setIsMenuOpen(false); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                {t('common.theme_dark')} {theme === 'dark' && '✓'}
              </div>
              <div className="dropdown-item" onClick={() => { setTheme('system'); setIsMenuOpen(false); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
                {t('common.theme_system')} {theme === 'system' && '✓'}
              </div>

              <div className="dropdown-divider" />

              <div className="dropdown-item" onClick={() => { setShowHelp(true); setIsMenuOpen(false); }}>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                {t('common.help')}
                <span style={{ marginLeft: 'auto', opacity: 0.4, fontSize: 10 }}>Ctrl+Alt+H</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="main-layout">
        {isSidebarOpen && <div className="sidebar-overlay" onClick={() => setIsSidebarOpen(false)} />}
        <aside className={'sidebar ' + (isSidebarOpen ? 'is-open' : '')}>
          <div className="sidebar-mobile-header">
            <div className="logo">
              <div className="logo-icon">
                <BrandLogo gradId="nekLogoSidebar" />
              </div>
              <div style={{ marginLeft: 10, fontWeight: 700, letterSpacing: '-0.01em', fontSize: 15, color: 'var(--text)' }}>NetEngKit</div>
            </div>
            <button className="sidebar-close" onClick={() => setIsSidebarOpen(false)}>X</button>
          </div>
          <div className="sidebar-search">
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="search-input-wrapper" style={{ flex: 1 }}>
                <svg className="search-icon" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
                <input className="search-input" value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder={t('common.search')} />
                {searchQuery && (
                  <div className="search-clear" onClick={() => setSearchQuery('')}>X</div>
                )}
              </div>
              {(() => {
                const toolsWithSubs = TOOLS.filter(t => t.subTools?.length > 0);
                const allExpanded = toolsWithSubs.every(t => expandedTools.has(t.id));
                return (
                  <button
                    title={allExpanded ? t('common.collapse_all', 'Collapse all') : t('common.expand_all', 'Expand all')}
                    onClick={() => allExpanded
                      ? setExpandedTools(new Set())
                      : setExpandedTools(new Set(toolsWithSubs.map(t => t.id)))
                    }
                    style={{ background: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '0 8px', cursor: 'pointer', color: 'var(--muted)', flexShrink: 0, display: 'flex', alignItems: 'center', alignSelf: 'stretch', lineHeight: 1 }}>
                    {allExpanded
                      ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="17 11 12 6 7 11"/><polyline points="17 18 12 13 7 18"/></svg>
                      : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="7 13 12 18 17 13"/><polyline points="7 6 12 11 17 6"/></svg>
                    }
                  </button>
                );
              })()}
            </div>
          </div>

          <div className="sidebar-nav">
            {navTypes.map(type => {
              const typeItems = filteredTools.filter(tool => tool.type === type.id);
              if (typeItems.length === 0) return null;
              return (
                <div key={type.id}>
                  <div className="sidebar-group-title">{type.label}</div>
                  {navGroups.map(grp => {
                    const items = typeItems.filter(tool => tool.group === grp);
                    if (items.length === 0) return null;
                    return (
                      <div key={grp}>
                        <div className="sidebar-section">{t(navGroupMap[grp] || grp)}</div>
                        {items.map(item => {
                          const hasSubs = item.subTools && item.subTools.length > 0;
                          const querying = searchQuery.trim() !== '';
                          // Sub-tools to show: when searching, all matching; otherwise only when explicitly expanded
                          const subsToShow = !hasSubs ? [] :
                            querying ? item.subTools.filter(subMatchesQuery)
                              : expandedTools.has(item.id) ? item.subTools : [];
                          return (
                            <div key={item.id}>
                              <div className={'nav-item ' + (activeTool === item.id ? 'active' : '')}
                                style={hasSubs ? { justifyContent: 'space-between' } : {}}
                                onClick={() => {
                                  handleSelectTool(item.id);
                                  if (hasSubs) setExpandedTools(prev => new Set([...prev, item.id]));
                                  setIsSidebarOpen(false);
                                }}>
                                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                  <div className="nav-dot" />
                                  {t(`tools.${item.id}.title`, item.label)}
                                </span>
                                {hasSubs && !querying && (
                                  <span
                                    onClick={e => { e.stopPropagation(); setExpandedTools(prev => { const n = new Set(prev); n.has(item.id) ? n.delete(item.id) : n.add(item.id); return n; }); }}
                                    style={{ fontSize: 13, opacity: 0.8, padding: '0 4px', flexShrink: 0, lineHeight: 1 }}>
                                    {expandedTools.has(item.id) ? '▴' : '▾'}
                                  </span>
                                )}
                              </div>
                              {subsToShow.map((sub, si) => (
                                <div key={si}
                                  className={'nav-item ' + (isSubActive(sub) ? 'active' : '')}
                                  style={{ paddingLeft: 34, fontSize: 12 }}
                                  onClick={() => { handleSelectTool(item.id, sub.nav); setIsSidebarOpen(false); }}>
                                  <div className="nav-dot" style={{ opacity: 0.5, transform: 'scale(0.7)' }} />
                                  {t(sub.labelKey, sub.labelKey)}
                                </div>
                              ))}
                            </div>
                          );
                        })}
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {filteredTools.length === 0 && (
              <div style={{ padding: 20, textAlign: 'center', color: 'var(--dim)', fontSize: 12 }}>{t('common.no_results')}</div>
            )}
          </div>
        </aside>

        <main className="main">
          <div className="content">
            {renderTool()}
          </div>
        </main>
      </div>

      <footer className="footer">
        <div>NetEngKit • {t('common.built_for')} • v{window.APP_VERSION || 'v1.0.0'}</div>
      </footer>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 30, left: '50%', transform: 'translateX(-50%)',
          background: 'var(--cyan)', color: '#000', padding: '10px 24px', borderRadius: 20,
          fontWeight: 600, fontSize: 13, zIndex: 1000, boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
          animation: 'fadeUp 0.3s ease-out'
        }}>
          {toast}
        </div>
      )}
      {showSearch && <CommandPalette onSelect={handleSearchSelect} onClose={() => setShowSearch(false)} />}
      <LanguagePicker open={showLangModal} lang={lang} setLang={setLang} onClose={() => setShowLangModal(false)} />
      <HelpModal
        open={showHelp}
        onClose={() => setShowHelp(false)}
        tools={TOOLS}
        onNavigate={(id, nav) => setHashData({ tool: id, ...(nav || {}) })}
      />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <LanguageProvider>
    <App />
  </LanguageProvider>
);
