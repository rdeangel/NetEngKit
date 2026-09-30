# NetEngKit tools catalog

The in-app registry (`components/app.jsx` `TOOLS`) has **130** top-level entries: **116** tools and **14** references. Fourteen need the optional local server; eleven of those also need the internet.

This file documents **125** of them as `###` headings (inputs, outputs, tabs, keywords). Section titles have no counts — those rot. Heading totals live in [Summary](#summary). Area overviews: [docs/FEATURES/](docs/FEATURES/README.md).

---

## IPv4 Subnet & Addressing

### IPv4 Subnet Calculator
**ID:** `subnet` | **Type:** Tool | **Offline**

**Description:** Consolidated suite of IPv4 subnetting calculators and visualizers.

**Tabs:**

#### Calculator (`mode: calculator`) — sidebar label: "Calculator"
**Inputs:**
- IP address with CIDR notation (e.g., `192.168.1.0/24`)
- Quick preset buttons (common ranges: /8, /12, /16, /24)

**Outputs:**
- Network address, broadcast address
- Subnet mask (dotted decimal), wildcard mask
- First usable host, last usable host
- Total addresses, usable host count
- IP class (A/B/C/D/E), address type (private/public), RFC classification
- IP representations: decimal, binary, hex, integer
- Common sub-prefix table (/25, /26, /27, /28) with JSON/CSV export
- Copy All button for bulk copying

#### Rebase (`mode: rebase`) — sidebar label: "Rebase"
**Inputs:**
- Source base block (CIDR, e.g. `10.0.0.0/20`)
- Target base block (CIDR, same prefix length, e.g. `10.0.16.0/20`)
- Sub-allocations textarea (free-form; one subnet per line; any description/delimiter format)

**Outputs:**
- Rebased output preserving the original line format and descriptions
- Subnets outside the source block are flagged inline (`out of range`) and crossed out
- Copy All button

#### Subnet Binary Visualizer (`mode: binary`)
**Description:** Visual bit-level exploration of CIDR boundaries and subnet mask structure.
**Features:**
- Interactive binary grid showing network vs. host bits
- Click-to-toggle individual bits to explore CIDR boundaries
- Visual representation of how subnet masks partition address space

#### Wildcard Mask (`mode: wildcard`)
**Description:** Converts between subnet masks and wildcard (inverse) masks for ACL design.
**Inputs:**
- Subnet mask (dotted decimal) OR wildcard mask
**Outputs:**
- Wildcard mask representation, Subnet mask representation, Equivalent CIDR, Address range covered

#### Subnet Visual Map (`mode: map`)
**Description:** Hierarchical tree visualization of IP space allocation and subnet relationships.
**Inputs:**
- Parent network
- Subnet allocation list
**Outputs:**
- Tree diagram showing network hierarchy, Visual subnet relationships, Address utilization visualization

#### IP List Generator (`mode: iplist`)
**Description:** Generates formatted IP address lists from CIDR ranges.
**Inputs:**
- CIDR range
- Format selection (newline, CSV)
**Outputs:**
- Complete IP list in selected format

**Current Keywords:** `subnet calculator cidr ipv4 mask prefix network broadcast rebase remap renumber relocate block offset transpose allocation plan wildcard binary representation visualizer map iplist`

---

### Subnetting Planner
**ID:** `subnet-planner` | **Type:** Tool | **Offline**

**Description:** Multi-subnet planning and aggregation suite.

**Tabs:**

#### VLSM Planner (`mode: vlsm`)
**Description:** Variable-length subnet mask design for hierarchical subnetting with recursive host allocation.
**Inputs:**
- Parent network CIDR
- List of subnets with required host counts
**Outputs:**
- Assigned CIDR for each subnet, Network range per subnet, Usable hosts per subnet, Summary table showing allocation efficiency

#### Supernet / Summary (`mode: supernet`)
**Description:** Route aggregation/summarization of multiple subnet prefixes.
**Inputs:**
- List of CIDR ranges to aggregate
**Outputs:**
- Summarized CIDR(s), Network range of summary, Total addresses included

#### Split & Merge (`mode: split`)
**Description:** Splits a parent network into smaller subnets, or summarizes/aggregates adjacent subnets (internal toggle: Split Subnet ↔ Merge / Summarize).
**Inputs:**
- Split: parent CIDR, target prefix length or split count
- Merge / Summarize: multiple adjacent CIDR ranges
**Outputs:**
- Split: list of resulting subnets, address bounds, and export to CSV/JSON
- Merge / Summarize: merged prefix groups

#### Subnet Host Slicer (`mode: slicer`)
**Description:** Pulls the same host position out of a whole list of subnets in one go: first/last usable, +N from the network, −N from the broadcast, Nth host, or both point-to-point endpoints. Rows where the offset doesn't fit get an out-of-bounds flag. Handles IPv4 and IPv6, including /31 (RFC 3021), /127 (RFC 6164) and host routes.

**Inputs:**
- Subnet list (IPv4/IPv6 `addr/prefix`, or IPv4 `addr` + dotted mask; separated by space, comma or semicolon; `#`, `!` or `//` comments become row labels)
- Samples: P2P WAN links, campus subnets, IPv6 peering
- Mode: first usable, last usable, +N from start, −N from end, Nth host, P2P endpoints
- N (offset / host index)
- Output affixes (independent toggles): `/prefix`, dotted mask, wildcard (mask/wildcard exclusive); `A <-> B` join in P2P mode

**Outputs:**
- Output column ready to paste (out-of-bounds and invalid rows left out), one-click copy
- Per-subnet table: network, broadcast/last, usable range, usable count, selected address(es), mask, status (`[out-of-bounds]` with the valid N range, invalid, host bits set)
- Table copy (TSV with header), CSV and JSON export, share URL

#### Range ↔ CIDR (`mode: range`)
**Description:** Bidirectional conversion between IP ranges and CIDR notation.
**Inputs:**
- Starting IP + ending IP, OR CIDR notation
**Outputs:**
- CIDR notation with prefix lengths, IP range representation, Total addresses in range

#### Overlap Detector (`mode: overlap`)
**Description:** Identifies overlapping and conflicting subnets in a CIDR list.
**Inputs:**
- Multiple CIDR entries (one per row)
**Outputs:**
- Overlap detection with visual indicators and collision highlighting

**Current Keywords:** `subnet planner vlsm supernet summary split merge overlap range cidr collision check subnet host slicer batch bulk first last usable offset nth gateway peer point-to-point p2p /30 /31 /127 rfc 3021 rfc 6164 wildcard mask ipv6 extract`

**Suggested Keywords to Add:** _(none)_

---

### DHCP Scope Planner
**ID:** `dhcp` | **Type:** Tool | **Offline**

**Description:** Designs DHCP scopes with pools, exclusions, and multi-vendor configuration export.

**Inputs:**
- Network CIDR
- Gateway IP
- DNS servers (comma-separated)
- DHCP pool start/end
- Excluded ranges (optional)
- Lease time

**Outputs:**
- Scope configuration summary
- Usable IPs in pool
- Reserved pool details
- **Multi-vendor exports:**
  - Cisco IOS config
  - Kea DHCP config
  - ISC DHCP format

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `dhcp scope pool exclusion gateway dns lease time cisco kea isc dynamic host configuration protocol`

---

### IP Converter
**ID:** `converter` | **Type:** Tool | **Offline**

**Description:** Converts an IPv4 address between all four representations in one view. Toggle the input format to enter in whichever notation you have and instantly see all others.

**Modes (sub-tools):**

#### Dotted Decimal (`mode: decimal`)
**Inputs:** IPv4 dotted-decimal address (e.g. `192.168.1.100`)
**Outputs:** Binary (bit-grid + colored per-octet), hex, integer, octet breakdown

#### Binary (`mode: binary`)
**Inputs:** Dotted binary string (e.g. `11000000.10101000.00000001.01100100`)
**Outputs:** Decimal, hex, integer, octet breakdown

#### Hexadecimal (`mode: hex`)
**Inputs:** Hex-encoded address (e.g. `0xC0A80164`)
**Outputs:** Decimal, binary bit-grid, integer, octet breakdown

#### Integer (`mode: integer`)
**Inputs:** 32-bit unsigned integer (e.g. `3232235876`)
**Outputs:** Decimal, binary bit-grid, hex, octet breakdown

**Current Keywords:** `ip converter representation decimal binary hex integer conversion format`

---

### ACL Generator
**ID:** `acl` | **Type:** Tool | **Offline**

**Description:** Generates Access Control Lists from CIDR ranges with multi-vendor syntax support.

**Inputs:**
- CIDR ranges
- Vendor selection: Cisco IOS, NX-OS, Juniper, Arista, etc.

**Outputs:**
- Permit/deny statements in target vendor syntax
- Copy per format

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `acl access control list generator cisco juniper arista permit deny network range`

---

### Firewall Rule Shadowing Analyzer
**ID:** `fw-rule-analyzer` | **Type:** Tool | **Offline**

**Description:** Pastes a Cisco IOS/ASA ACL, iptables-save, FortiOS policy, or Junos SRX / firewall-filter rule base and reports shadowed, duplicate, and deny/permit-contradiction rules, plus merge candidates and any-wide permits. Analysis is scoped per ACL, chain, zone-pair, or FortiOS interface pair. Unsupported constructs (FQDN, user, schedule, App-ID, UTM, negation, IPv6) are listed as not analysed and never used as coverers.

**Inputs:**
- Syntax selector: auto-detect, Cisco IOS / IOS-XE ACL, Cisco ASA ACL, iptables / iptables-save, FortiOS (FortiGate), Junos (SRX policies / firewall filter)
- Paste area for the ACL or policy, including object-groups / address-books / services

**Outputs:**
- Findings: shadowed, duplicate, contradiction, merge candidate, any-wide permit, undetermined (with covering rule ids and line numbers)
- Not-analysed list (unsupported constructs and disabled rules)
- Parser warnings (unparsed lines, ignored blocks — nothing dropped silently)
- Cleanup text: safe removals, review list for contradictions, resulting order (no reordering), vendor-native removal commands
- Share URL embedding the pasted config

**Current Keywords:** `firewall rule shadow shadowed shadowing redundant duplicate contradiction conflict acl access-list audit cleanup optimizer policy order unused cisco ios asa iptables fortigate fortios juniper srx junos firewall-filter object-group address-book`

**Suggested Keywords to Add:** _(none)_

---

### NAT/PAT Calculator
**ID:** `nat-pat-calc` | **Type:** Tool | **Offline**

**Description:** Designs static, dynamic, and overload NAT translations with vendor-specific configs.

**Inputs:**
- Inside local networks
- Outside (public) IP(s)
- Translation type: static/dynamic/overload
- Protocol selection

**Outputs:**
- NAT translation summary
- Port mapping for PAT (if applicable)
- Cisco ASA configuration examples
- Export: JSON config

**Current Keywords:** `nat pat overload translation static mapping dual-nat cgnat iptables cisco asa dynamic translation port block allocation pba sizing`

**Assessment:** Good coverage. Could add: `nat44 carrier-grade nat port translation address rewriting`

---

### Split Tunnel Calculator
**ID:** `split-tunnel` | **Type:** Tool | **Offline**

**Description:** Calculates the minimum set of CIDR routes for a VPN split-tunnel policy by carving excluded networks out of the included space and re-aggregating the remainder. Useful for AnyConnect/OpenVPN route lists and WireGuard `AllowedIPs`.

**Inputs:**
- Mode: include (only listed networks tunnel) or exclude (everything tunnels except listed networks)
- Networks to route through the tunnel — CIDR or bare IP, comma/space/newline separated (bare IP = /32)
- Networks to carve out — same format
- Presets: append RFC1918 space or public (non-RFC1918) space to either list

**Outputs:**
- Minimal, non-overlapping, maximally summarised route list
- Start–end address range and address count per route
- Category per route (RFC1918, Public, Loopback, Link-Local, CGNAT, TEST-NET, Multicast, Reserved, Current Network)
- Totals: route count and aggregate address count
- Distribution by prefix length and by category
- Export: Copy All (with header row), CSV, JSON

**Current Keywords:** `split tunnel vpn route include exclude rfc1918 anyconnect wireguard allowedips openvpn minimal subnet list aggregate summarize carve`

---

### Bogon / Martian Filter Generator
**ID:** `bogon-filter` | **Type:** Tool | **Offline**

**Description:** Generates deny rules for invalid/reserved address ranges per IANA definitions.

**Inputs:**
- Vendor selection: Cisco IOS, NX-OS, Juniper, Arista, iptables, nftables
- Traffic direction

**Outputs:**
- ACL entries for RFC1918, loopback, link-local, Class E, CGNAT, reserved ranges
- **Multi-vendor syntax support:**
  - Cisco IOS/NX-OS ACL
  - Juniper prefix-list
  - iptables rules
  - nftables rules
  - Fortinet firewall rules
- Copy All for config

**Current Keywords:** `bogon martian rfc1918 private acl prefix-list firewall filter deny block iana reserved loopback link-local cgnat class-e cisco juniper iptables nftables vyos fortigate`

**Assessment:** Excellent IPv4 coverage. Could add: `invalid address filtering security rfc compliance reserved space`

---

## IPv6

### IPv6 Subnet Calc
**ID:** `ipv6subnet` | **Type:** Tool | **Offline**

**Description:** Complete IPv6 address and subnet calculator with hierarchical features.

**Tabs:**

#### Basic Tab
**Inputs:**
- IPv6 CIDR (e.g., `2001:db8::/32`)

**Outputs:**
- Network address (canonical form)
- Broadcast address (all 1s in host)
- Prefix length, mask
- Total addresses
- Usable hosts (excluding network/broadcast)
- Address type classification

#### Representations Tab
**Outputs:**
- Full notation (8 groups of 4 hex)
- Compressed form
- Binary representation
- Integer (BigInt)
- Network vs host portions

#### GUA (Global Unicast Address) Tab
**Inputs:**
- GUA prefix (typically /48 or /56)
- Subnet ID
- Interface ID (or auto-generate from MAC via EUI-64)

**Outputs:**
- Complete GUA address
- Visual hex bar showing allocation
- Binary cards for each 16-bit group
- Common address assignments table (subnet all-zeros, all-ones, etc.)
- Auto-calculation with live preview

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `ipv6 subnet calculator address global unicast gua prefix representations eui64 dhcpv6 stateless stateful scope`

---

### IPv6 Transition Mech
**ID:** `ipv6-trans` | **Type:** Reference | **Offline**

**Description:** Comprehensive reference for IPv4 ↔ IPv6 interoperability strategies.

**Sections:**
- **NAT64 / DNS64:** Stateless translation + DNS redirection mechanism
- **DS-Lite:** AFTR (Address Family Transition Router) and B4 element configuration
- **464XLAT:** Customer Equipment (CE) translation on client devices
- **6in4 / Automatic 6to4:** Tunnel setup and address derivation
- **GRE / Manual Tunnels:** Point-to-point IPv6 over IPv4

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `ipv6 transition nat64 dns64 ds-lite 464xlat 6in4 tunnel dual-stack interoperability migration`

---

## Cross-Version Addressing

### IP Classifier
**ID:** `classify` | **Type:** Tool | **Offline**

**Description:** Identifies IP type, scope, and RFC classification for any address (IPv4 or IPv6).

**Inputs:**
- Any IP address (single or comma-separated)

**Outputs:**
- Version (v4/v6)
- Type: unicast, multicast, loopback, link-local, private, etc.
- Scope (global, site-local, link-local, interface-local for v6)
- RFC classification
- In-addr.arpa PTR format (for reverse DNS)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `classify classification type scope unicast multicast loopback private public link-local global interface`

---

### MAC Address Tools
**ID:** `mac` | **Type:** Tool | **Offline**

**Description:** Comprehensive MAC address utilities across multiple modes.

**Tabs:**

#### Normalize Tab
**Inputs:**
- MAC address in any format (Cisco, IEEE, Windows, etc.)

**Outputs:**
- All 6 formats: `00:11:22:33:44:55`, `0011:2233:4455`, `001122334455`, etc.
- Vendor OUI lookup (57K+ entries)
- Copy buttons per format

#### EUI-64 Generator Tab
**Inputs:**
- MAC address
- Interface name (for link-local generation)

**Outputs:**
- IPv6 interface ID derived from MAC
- Link-local IPv6 address (`fe80::<eui64>`)
- Copy formatted

#### OUI Lookup Tab
**Inputs:**
- MAC prefix (first 3 octets)
- Search by vendor name

**Outputs:**
- Vendor name and organization
- MA-L / MA-M / MA-S classification
- Address assignment type

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `mac address normalize format vendor oui eui64 ipv6 interface id cisco ieee windows`

---

### ARP Table Parser
**ID:** `arp-parser` | **Type:** Tool | **Offline**

**Description:** Parses and analyzes ARP output from multiple platforms.

**Tabs:**

#### Parse Tab
**Inputs:**
- Raw ARP output (paste from: Cisco `show ip arp`, Linux `arp -a`, Windows `arp -a`, JunOS `show arp`, BSD)

**Outputs - Platform Detection:**
- Auto-detects source platform
- Normalizes to common format:
  - IP, MAC, Interface, Type (dynamic/static)
  - Vendor OUI lookup for each MAC
- Table view with sorting/filtering

#### Analysis Tab
**Outputs:**
- **Duplicate MACs:** Same MAC on multiple IPs (potential spoofing)
- **Incomplete Entries:** Unresolved ARP entries
- **Vendor Distribution:** Count by vendor
- **Interface Mapping:** MAC → Interface distribution
- **Port Security:** Flags multiple IPs per interface

#### Comparison Tab
**Inputs:**
- Two ARP snapshots (before/after network change)

**Outputs:**
- Side-by-side diff
- New entries, removed entries, changed entries
- Highlight suspicious changes

**Current Keywords:** `arp table parser show ip arp arp -a spoofing duplicate mac incomplete entry vendor oui cisco linux windows`

**Assessment:** Good. Could add: `table analysis snapshot diff comparison flapping detection security`

---

### IP Cheat Sheet
**ID:** `cheatsheet` | **Type:** Reference | **Offline**

**Description:** Quick-reference table of common IP ranges and classifications.

**Sections:**
- RFC1918 private ranges
- Link-local (169.254.0.0/16)
- Loopback ranges
- Multicast ranges
- Reserved (Class E, etc.)
- Broadcast addresses

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `cheat sheet quick reference rfc1918 private loopback link-local multicast reserved broadcast`

---

### ICMP Type/Code Reference
**ID:** `icmp-ref` | **Type:** Reference | **Offline**

**Description:** Comprehensive ICMP (v4/v6) message types and codes.

**Tabs:**

#### ICMPv4 (`v4`)
**Includes:**
- Echo Reply (0), Echo Request (8)
- Destination Unreachable (3): network, host, protocol, port, fragmentation needed, source route failed
- Time Exceeded (11)
- Redirect (5)
- Timestamp Request/Reply (13/14)
- Information Request/Reply (15/16)

#### ICMPv6 (`v6`)
**Includes:**
- Neighbor Discovery Protocol (ND): NS, NA, RS, RA
- Multicast Listener Discovery (MLD): Query, Report, Done
- Echo Request (128) / Echo Reply (129)
- Router Solicitation (133) / Router Advertisement (134)
- Neighbor Solicitation (135) / Neighbor Advertisement (136)

**Outputs:**
- Type & code decimal/hex
- RFC reference
- Protocol behavior description

**Current Keywords:** `icmp icmpv6 ping traceroute message code type redirect unreachable ndp mld dynamic port rfc792 rfc4443 error control icmpv4 ipv4 ipv6 echo reply neighbor discovery multicast listener`

---

## Multicast Toolkit

### Multicast Toolkit
**ID:** `mcast-toolkit` | **Type:** Tool | **Offline**

**Description:** A unified suite for multicast reference, address calculation, and network planning.

**Tabs:**

#### Reference & Protocols
- **Well-Known Addresses:** Searchable list of IPv4 and IPv6 well-known groups (RFCs 1112, 2365, 3306).
- **IPv4 Blocks:** Summary of 224.0.0.0/4 block allocations and TTL thresholds.
- **IPv6 Scopes:** ff0X:: scope value reference.
- **Protocol Comparison:** Feature matrix for IGMPv1/v2/v3 and MLDv1/v2.
- **PIM Decision Matrix:** Comparison of PIM-SM, PIM-SSM, and BIDIR-PIM.
- **RPF Check:** Conceptual overview of Reverse Path Forwarding.

#### Address Calculators
- **IP-to-MAC Mapping:** Maps IPv4/IPv6 multicast addresses to Ethernet MACs (01:00:5E / 33:33).
- **MAC-to-IP Reverse Lookup:** Shows all possible IPv4 IPs mapping to a specific multicast MAC.
- **Solicited-Node Calc:** Generates IPv6 solicited-node multicast addresses from unicast/MAC.
- **GLOP Calculator:** Maps 16-bit AS numbers to 233.0.0.0/8 GLOP blocks (RFC 3180).
- **IPv6 Address Builder:** Constructs ffXX:: addresses by selecting flags and scope.

#### Design & Planning
- **Group Planner:** Allocates blocks of multicast addresses from a parent /16 or /24.
- **Collision Analyzer:** Identifies MAC address overlaps in a list of multicast IP groups.
- **Join State Analyzer:** Decodes multicast addresses to identify scope, protocol, and well-known purpose.

**Current Keywords:** `multicast igmp mld pim rpf glop solicited-node ipv6 builder planner collision analyzer mac ip mapping`

---

## Switching & Layer 2

### Switching (STP/VPC)
**ID:** `switching-ref` | **Type:** Reference | **Offline**

**Description:** Reference for Spanning Tree Protocol variants, EtherChannel, and Nexus vPC — covering port states, timers, bridge ID calculator, and config snippets.

See also: [STP / RSTP Election Simulator](#stp--rstp-election-simulator) for a multi-switch root bridge and port role election.

**Tabs:**

#### STP / Spanning Tree (`stp`)
Sub-tabs: Variants, States, Timers, Bridge ID Calculator, Config Snippets
- STP (802.1d), RSTP (802.1w), MST (802.1s), PVST+ / Rapid-PVST+ variants
- Port states and roles (blocking/listening/learning/forwarding; root/designated/alternate/backup)
- Timer reference (Hello, Forward Delay, Max Age) with convergence calculator
- Bridge ID calculator (priority + MAC → Bridge ID hex)
- Cisco IOS config snippets for each variant

#### EtherChannel (`ether`)
- LACP, PAgP, and Static mode comparison
- Negotiation state table, load-balancing hash methods
- Configuration snippets for Cisco IOS / NX-OS

#### vPC (Nexus) (`vpc`)
- vPC architecture overview (peer-link, keepalive, peer-gateway)
- Consistency parameters (global vs. per-vlan)
- Orphan ports and dual-homed design notes
- NX-OS config snippets

**Current Keywords:** `stp spanning-tree vpc etherchannel lacp layer2 switching rstp mstp pvst rapid root bridge port cost priority variants states timers convergence port-channel pagp bonding aggregation link bundling nexus peer-link keepalive dual-homed consistency orphan`

---

### STP / RSTP Election Simulator
**ID:** `stp-simulator` | **Type:** Tool | **Offline**

**Description:** Models a switched topology and runs the STP / RSTP / PVST+ / Rapid PVST+ election: root bridge, root port, designated port, alternate and backup roles, with the tie-break field that decided each one. Roles are computed identically for every variant; 802.1D / PVST+ label non-forwarding ports Blocking, RSTP variants Discarding. Timers, convergence, BPDU/root guard, edge ports, MST and CLI generation are not modelled (see Switching (STP/VPC) for timers, BPDU fields and the Bridge ID builder).

**Inputs:**
- Protocol (802.1D, 802.1w, PVST+, Rapid PVST+) and path cost method (short 802.1D-1998 / long 802.1t)
- Switches (max 16): name, bridge priority (steps of 4096), bridge MAC, up/down, per-VLAN priority overrides (PVST variants)
- Links (max 32): ends with switch, port number and port priority; speed (10M to 400G) or manual cost; up/down; "+ end" turns a link into a shared segment (the only way, besides a self-loop, to get a Backup port)
- VLAN list (PVST variants, max 8)
- Presets: triangle, mixed-speed square, dual uplink, shared segment, campus core/distribution/access
- What-if: force links or switches down and compare against the baseline

**Outputs:**
- Root bridge per component with BID and why (priority / MAC), per-VLAN root strip
- Port-role table (switch, port, port ID, link, cost, root path cost, role, state, decided by) with Copy All (TSV)
- Per-switch summary (BID, root port, root path cost, forwarding / blocked counts)
- Mermaid topology diagram (root highlighted, blocked ends dashed; source shown if Mermaid does not load)
- What-if diff: changed ports and root-bridge change
- Share URL restores the topology, what-if and selected VLAN

**Current Keywords:** `stp rstp pvst rapid-pvst spanning-tree 802.1d 802.1w root bridge election root port designated alternate backup blocking port cost priority bridge id simulator what-if topology`

---

### LACP / Port-Channel
**ID:** `lacp-tool` | **Type:** Tool | **Offline**

**Description:** Visualizes port-channel load balancing and LACP hash calculations.

**Inputs:**
- Number of member links (2, 3, 4, 8)
- Protocol: LACP, Static

**Outputs - Hash Calculation:**
- Inputs to hash: Source IP XOR Dest IP (+ Port for L4)
- Resulting bundle member assignment
- Load mask (0x00–0xFF) for each member
- Visual distribution of traffic flows

**Outputs - Member Status:**
- Active/passive LACP actors
- System priority, port priority
- Individual/collective port states

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `lacp port-channel bundle load balancing hash distribution member link aggregation`

---

### QinQ / VLAN Translation
**ID:** `qinq-config` | **Type:** Tool | **Offline**

**Description:** Designs double-tagging (provider bridging) configurations.

**Inputs:**
- Outer VLAN (provider tag)
- Inner VLAN(s) (customer tags)
- Translation rule: map-translate / pass-through

**Outputs:**
- Frame format (with both tags)
- Cisco IOS config snippet
- Juniper config snippet
- MTU implications (extra 4 bytes for outer tag)

**Current Keywords:** `qinq 802.1ad vlan translation tunnel stacking double-tag provider bridging`

**Assessment:** Good. Could add: `nested vlan service provider customer tag frame format mtu`

---

### Private VLAN (PVLAN) Designer
**ID:** `pvlan-designer` | **Type:** Tool | **Offline**

**Description:** Designs an RFC 5517 private VLAN (one primary, one isolated, any number of communities), shows who can talk to whom, audits common PVLAN traps and generates Cisco IOS/IOS-XE, NX-OS, Arista EOS and Juniper Junos (ELS and non-ELS) config.

**Tabs:**

#### Design (`design`)
**Inputs:**
- Primary VLAN ID, name, optional SVI address (CIDR)
- Secondary VLANs: one isolated, up to 16 total with communities
- Ports: interface, description, role (promiscuous, host, 802.1Q inter-switch trunk, promiscuous PVLAN trunk, isolated PVLAN trunk), secondary VLAN
- Presets: multi-tenant DMZ, hotel / guest Wi-Fi, clustered app tier; JSON import/export

**Outputs:**
- Live audit: errors (duplicate/invalid VLANs, more than one isolated VLAN, host port without a secondary), warnings (VTP v1/v2 transparent mode, trunk pruning/native VLAN, local proxy ARP, vendor mode gaps), passes

#### Reachability Matrix (`matrix`)
**Outputs:**
- N×N Layer 2 reachability between ports with reason tooltips; click a port to focus on what it can reach

#### Config (`config`)
**Inputs:**
- Vendor: Cisco IOS / IOS-XE, Cisco NX-OS, Arista EOS, Juniper Junos ELS, Juniper Junos non-ELS; VTP version (IOS)

**Outputs:**
- Full config plus per-section copy (VLANs, interfaces, SVI); download as .txt

**Current Keywords:** `pvlan private vlan rfc5517 isolated community promiscuous primary secondary host-association mapping vtp transparent cisco nxos arista junos`

**Suggested Keywords to Add:** `port isolation protected port switchport protected`

---

### Interface Config Gen
**ID:** `config-gen` | **Type:** Tool | **Offline**

**Description:** Multi-vendor interface configurations builder.

**Inputs - Interface Tab:**
- Interface name (e.g., GigabitEthernet 0/0/0)
- IP address + netmask
- Description
- Speed, duplex, MTU
- Enable/shut state

**Inputs - VLAN Tab:**
- VLAN ID, name
- IP address + netmask (for SVI)
- Shutdown state

**Outputs:**
- Cisco IOS, NX-OS, Juniper, Arista config
- Copy per format

**Current Keywords:** `interface config generation ip address vlan svi description speed duplex mtu cisco juniper arista`

---

### Device Config Converter
**ID:** `device-converter` | **Type:** Tool | **Offline**

**Description:** Converts Layer 2/3 switch configurations (VLANs, trunk/access ports, LACP, STP) between vendors, and translates firewall security policy between FortiGate, Palo Alto PAN-OS, Juniper SRX and Cisco ASA (Cisco FTD/Firepower as source only) through a vendor-neutral model. Firewall output is a migration draft for candidate config / `commit check`, with a mandatory Translation Report. NAT is not translated yet.

**Inputs:**
- Converter tab: source vendor (Auto-Detect, Cisco IOS/EOS, Cisco NX-OS, Juniper Junos, HPE Comware, Aruba AOS-CX), target vendor, source CLI text
- Firewall Policy Translator tab: source (Auto-detect, FortiOS CLI, PAN-OS set or XML incl. Panorama pre/post, SRX set or curly, ASA running-config, FTD FMC access-rule JSON or LINA running-config), target (FortiOS, PAN-OS, SRX, ASA — never FTD), pasted policy, zone ↔ interface mapping table seeded from the source

**Outputs:**
- Converted switch configuration script
- Firewall draft: address/service objects and groups (nesting kept, predefined services mapped by exact port signature, names sanitised to target limits), security rules in order with names, comments, enable/disable, logging and address negation (native, or expanded to prefixes on ASA), zone definitions from the mapping table
- Translation Report: per-rule status (exact / approximated / not translated) with reasons, dropped constructs (security/UTM profiles, App-ID, URL categories, users/groups, schedules, geo, Panorama pre/post, NAT/VIP), renamed objects, parser warnings; copy as TSV
- Copy and download controls
- Line-by-line validation reports (converted, ignored/unsupported, and warning lines)
- Side-by-side switching and security syntax equivalency cheat sheet

**Current Keywords:** `device switch config converter migration translate cisco ios junos arista eos aruba aos-cx comware vlan trunk access port-channel lacp stp firewall rule policy security asa palo alto fortios pan-os fortinet acl access-list srx firepower ftd fmc translator migration object address-group service-group zone negate`

**Suggested Keywords to Add:** `migration translation switchport switch ethernet-switching native vlan mapping bundle interface security rules filter policy`

---


### MAC Address Table Parser
**ID:** `mac-table-parser` | **Type:** Tool | **Offline**

**Description:** Analyzes MAC tables for issues and changes.

**Inputs:**
- Raw `show mac address-table` output (Cisco, Juniper, etc.)

**Tabs:**

#### Parse Tab
**Outputs:**
- Parsed table: VLAN, MAC, Type (static/dynamic/secure), Interface
- OUI vendor lookup
- Sorting/filtering by VLAN, interface, type

#### Analysis Tab
**Outputs:**
- **MAC Flapping:** Same MAC appearing on different ports frequently (cable problem?)
- **Port Security:** Excessive MACs on single port (multicast flooding?)
- **VLAN Distribution:** MACs per VLAN histogram
- **Unknown Unicast:** CPU-redirected traffic
- Snapshot diff: Before/after comparison

**Current Keywords:** `mac address table parser show mac flapping port-security vlan distribution oui vendor cisco nxos snapshot diff`

**Assessment:** Excellent. Could add: `learned dynamic static secure unknown unicast` if analyzing table types.

---

### 802.1X / NAC Config Builder
**ID:** `dot1x-builder` | **Type:** Tool | **Offline**

**Description:** Port-based network access control configuration builder.

**Inputs:**
- Supplicant type: Host / IP Phone / Printer
- Authentication protocol: EAP-MD5 / PEAP / EAP-TLS
- Backup auth: MAB (MAC Authentication Bypass)
- CoA (Change of Authorization) VLAN
- Failure mode: open / closed

**Tabs:**

#### Device Config Tab
**Outputs:**
- Cisco IOS config
- Aruba Instant On / Cx config
- Includes: global 802.1X, interface settings, auth methods

#### RADIUS Tab
**Outputs:**
- RADIUS server config (IP, secret, accounting)
- Attribute requirements (User-Name, User-Password, Class)
- MAB attribute mapping

#### Troubleshooting Tab
**Outputs:**
- Common EAP failure modes
- Debug command summary per vendor
- Log interpretation guide

**Current Keywords:** `802.1x dot1x nac mab webauth radius coa cisco aruba port-access single-host multi-host multi-domain authentication`

**Assessment:** Good. Could add: `eap tls peap md5 supplicant authenticator authorization failure mode`

---

### MACsec / 802.1AE Config Builder
**ID:** `macsec-config` | **Type:** Tool | **Offline**

**Description:** Builds IEEE 802.1AE MACsec link-encryption configuration for Cisco IOS/IOS-XE, Cisco NX-OS and Juniper Junos from one set of parameters, and checks the configured SAK rekey interval against the packet-number budget the link actually burns at line rate. CAK and CKN are generated with `crypto.getRandomValues` in the browser, held in memory only, and excluded from the share URL.

**Tabs:**

#### Config Builder (`activeTab: builder`)
**Inputs:**
- Vendor: Cisco IOS/IOS-XE, Cisco NX-OS, Juniper Junos
- Interface, policy / connectivity-association name, key chain name
- CAK source: static CAK (pre-shared) or dynamic CAK (802.1X EAP-derived)
- CKN and CAK (generated, or pasted); CAK length follows the cipher suite key size
- Cipher suite: `GCM-AES-128`, `GCM-AES-256`, `GCM-AES-XPN-128`, `GCM-AES-XPN-256`
- Key server priority (0–255), SAK rekey interval (vendor-clamped), confidentiality offset (0/30/50)
- Include SCI in the SecTAG, replay protection window
- Behaviour when MKA does not come up: `must-secure` (fail closed) or `should-secure` (fail open)
- Emit key-encryption enabling commands as comments

**Outputs:**
- Complete per-vendor CLI: `key chain … macsec` + `mka policy` + interface on IOS-XE; `key chain … macsec` + `macsec policy` + interface on NX-OS; `set security macsec connectivity-association …` on Junos
- Verification commands as trailing comments
- Review chips: plaintext-CAK warning, XPN-required, packet-number headroom, AES-128, fail-open, strict replay window, confidentiality offset, key-server priority ties, Junos 64-digit CKN
- Copy and Export `.txt`

#### Key Rotation Planner (`activeTab: rekey`)
**Inputs:**
- Line rate: 1 / 10 / 25 / 40 / 100 / 400 GbE
- Frame size in bytes (64–9216; 64 is the worst case)
- Cipher suite, SCI setting and rekey interval are read from the Config Builder tab

**Outputs:**
- MACsec frame size on the wire with the SecTAG/ICV breakdown
- Packet-number burn rate in frames per second
- Time to exhaust the 32-bit or 64-bit packet-number space
- The same figure for the other packet-number width, so the XPN trade is explicit
- Recommended rekey interval, clamped to the selected vendor's range, or an explicit "no safe timer value" when the packet number exhausts faster than the platform's minimum timer
- Packet-number space consumed per SAK, data protected per SAK, SAK rotations per day
- KaY operational notes: key-server election and SCI tie-break, the EAPOL exception under `must-secure`, hitless vs forced rollover, delay protection vs replay window, per-member LAG sessions, MKA hello timeout, SecY counter reading
- Copy All (header row, tab-separated)

#### Reference (`activeTab: reference`)
**Outputs:**
- Static CAK vs dynamic CAK: key source, who configures it, typical use, scaling, rotation — with the note that both run MKA
- MACsec vs 802.1X vs IPsec: layer, what it protects, scope, hop behaviour, key exchange, where it runs, what it does not do
- Cipher suite table rendered from the same constant the builder uses, with XPN notes
- Worked example: 10 GbE, 64-byte frames, SCI on → 96 bytes on the wire, 10,775,862 fps, 32-bit PN wraps in 398.6 s, 64-bit XPN in ~54,245 years; 100 GbE wraps a 32-bit PN in 39.9 s

**Not covered here:** 802.1X authenticator and RADIUS configuration (see [802.1X / NAC Config Builder](#8021x--nac-config-builder)), routed-path encryption (see IPsec / IKEv2 Config Builder), TLS cipher suite naming (see Cipher Suite Reference). No key distribution, no certificate handling, and no network calls of any kind.

**Current Keywords:** `macsec 802.1ae mka link encryption cak ckn sak xpn gcm-aes key server rekey secy kay cisco nexus juniper junos nx-os layer2 encryption`

---

### Port Mirror / SPAN Builder
**ID:** `span-builder` | **Type:** Tool | **Offline**

**Description:** SPAN (Switched Port Analyzer) and ERSPAN configuration builder.

**Inputs - Local SPAN Tab:**
- Source port(s) (ingress/egress/both)
- Destination port (analyzer)
- VLAN filter (optional)

**Inputs - ERSPAN Tab:**
- Source port(s)
- Destination IP (remote analyzer)
- ERSPAN tunnel IP
- DSCP for tunnel traffic

**Outputs:**
- Cisco IOS / NX-OS / Juniper / Arista config
- Packet flow diagram
- MTU impact calculation

**Current Keywords:** `span rspan erspan mirror port mirroring monitoring analyzer packet capture traffic monitoring tap cisco arista juniper configuration`

**Assessment:** Good. Could add: `local remote encapsulated traffic mirroring destination port vlan`

---

### EVPN/VXLAN Fabric Designer
**ID:** `evpn-vxlan-designer` | **Type:** Tool | **Offline**

**Description:** Spine-leaf fabric designer for EVPN/VXLAN data center networks. Generates per-device CLI configurations for both Spine (route reflector) and Leaf (VTEP) roles, with VLAN-to-VNI mapping and anycast gateway support.

**Inputs:**
- Spine count (1–4) and leaf count (1–16)
- Underlay routing protocol: OSPF (Area 0.0.0.0) or IS-IS (Level 2)
- BGP ASN mode: eBGP (unique leaf ASNs) or iBGP (single fabric ASN)
- Spine ASN and leaf base ASN
- VNI start offset
- VLAN-to-VNI mapping table (VLAN ID, name, VNI)

**Tabs:**

#### Topology
**Outputs:**
- ASCII topology map showing all spines and leaves with loopback IPs, VTEP IPs, and ASNs
- Full VLAN-to-VNI mapping summary per leaf

#### Device Configs
**Inputs:**
- Device selector (per Spine or Leaf)

**Outputs:**
- NX-OS style CLI configuration for the selected device
- Spine: OSPF/IS-IS underlay, loopback, physical ports, BGP EVPN route-reflector config
- Leaf: VLAN VN-segment allocation, NVE interface (VXLAN tunnel), anycast gateway SVIs, BGP EVPN peering

**Current Keywords:** `evpn vxlan spine leaf bgp underlay overlay nve tenant fabric design switch routing config`

**Suggested Keywords to Add:** `vtep route-reflector anycast gateway vni l2vpn data center interconnect nxos`

---

### VXLAN Reference
**ID:** `vxlan-ref` | **Type:** Reference | **Offline**

**Description:** VXLAN protocol and deployment architecture.

**Sections:**
- **VXLAN Header:** VNI (24-bit), UDP port 4789, VTEP (tunnel endpoints)
- **Multicast vs Unicast:** Head-end replication, flood-and-learn, EVPN control plane
- **Segmentation:** Tenant isolation, VLAN-to-VNI mapping
- **Overlay Networks:** DCI (data center interconnect), active-active fabrics

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `vxlan overlay network virtual extensible lan vnni vtep multicast unicast evpn dci`

---

## Routing & Layer 3

### IP Proto Reference
**ID:** `proto-ref` | **Type:** Reference | **Offline**

**Description:** Complete IP protocol number and TCP/UDP port reference.

**Sections:**
- **IP Protocols:** ICMP (1), IGMP (2), TCP (6), UDP (17), GRE (47), ESP (50), AH (51), etc.
- **Well-Known Ports:** SSH (22), DNS (53), HTTP (80), HTTPS (443), Syslog (514), SNMP (161), NTP (123), etc.
- **Dynamic Range:** Ephemeral ports (49152–65535)
- **Multicast Ports:** mDNS (5353), SSDP (1900), etc.

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `protocol number ip icmp igmp tcp udp gre esp ah port well-known service`

---

### Routing Config Builder
**ID:** `routing-cfg` | **Type:** Tool | **Offline**

**Description:** Multi-vendor routing protocol configuration generator.

**Inputs - Static Routes Tab:**
- Destination CIDR
- Next-hop IP or interface
- Distance / metric
- Vendor selection: Cisco IOS, IOS-XE, IOS-XR, Juniper, Arista, Huawei

**Inputs - OSPF Tab:**
- Process ID, router ID
- Networks (area 0 + optional additional areas)
- Cost/metric (auto or manual)
- Passive interfaces
- Virtual links

**Inputs - EIGRP Tab:**
- AS number
- Networks
- K-values (bandwidth, delay, reliability, load, MTU)

**Inputs - BGP Tab:**
- Local AS, router ID
- Neighbor IP + remote AS
- Networks to advertise
- Route reflection (if applicable)

**Inputs - RIP Tab:**
- Version (v1 or v2)
- Networks
- Passive interfaces

**Outputs:**
- Complete running-config snippet per protocol and vendor
- Copy all / export JSON

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `routing config static ospf eigrp bgp rip isis protocol configuration builder cisco juniper`

---

### Cisco IOS-XR Config Builder
**ID:** `iosxr-cfg` | **Type:** Tool | **Offline**

**Description:** Generates IOS-XR candidate configurations with a live preview, translates classic IOS/IOS-XE configs to XR syntax, and provides a side-by-side CLI architecture comparison between the two platforms.

**Tabs:**

#### Config Builder (`activeTab: builder`)
**Inputs:**
- Hostname, domain name
- Interfaces: name, description, IPv4/IPv6, MTU, Bundle-ID, shutdown state
- OSPF: process ID, router-id, areas with interface lists
- BGP: local AS, router-id, neighbors with address-family selection
- Config Groups: name, description, MTU template, apply-to interface list
- Commit options: label, comment, replace-config toggle

**Outputs:**
- Live-generated IOS-XR candidate config (merge or full-replace model)
- Export as `.txt`, Copy to clipboard

#### IOS to IOS-XR Migration (`activeTab: migration`)
**Inputs:**
- Paste IOS / IOS-XE config block

**Outputs:**
- Translated IOS-XR syntax with inline annotations
- Explanation table: feature → IOS command → XR equivalent + reason

#### Architecture & CLI Comparison (`activeTab: comparison`)
**Outputs:**
- Side-by-side table: configuration state, routing protocols, subnet mask syntax, route-maps vs RPL, fail-safe commits, config templates

**Current Keywords:** `cisco ios-xr iosxr config builder route policy rpl commit groups migration interface bgp ospf`

---

### Device Config Parser
**ID:** `config-parser` | **Type:** Tool | **Offline**

**Description:** Multi-vendor configuration parser that decodes one or more device configs (loaded in parallel tabs) into queryable tables: interfaces with their parent/VRF/IP/VLAN bindings, aggregate (LAG/Port-channel) → physical member maps, VLAN membership, routing instances/VDOMs with their protocols, firewall policy rules, and system-level services. Vendor is auto-detected from the input or can be forced via the vendor tab strip. Multiple devices can be open simultaneously; cross-device relationships are reconciled automatically and rendered as a topology diagram.

**Vendors supported:**
- **JUNOS** — curly-brace and `set` style; security policies and firewall filters parsed as rules
- **Cisco** — IOS / IOS-XE / NX-OS / IOS-XR (sub-detected); ACLs parsed as rules; NX-OS extras: features, FEX, vPC
- **Arista EOS** — preprocessed onto the Cisco indented-section parser (handles `vrf instance`, `interface Ethernet`)
- **FortiOS** — `config / edit / next / end` blocks; full firewall-policy decoding; VDOMs treated as VRFs
- **Aruba AOS-CX** — `interface lag`, `vlan access/trunk`, `vrf attach`, `access-list ip` rewritten to Cisco-equivalents

**Result tabs (per device):**

#### Interfaces
Logical-unit table — parent, unit, type, VRF/VDOM, mode (access/trunk/subif), VLAN id or members, IPv4/IPv6 addresses, description; LAG/SVI badges; free-text filter with inline clear (×).

#### Aggregates / LACP
Each bundle (`ae*`, `Port-channel*`, `Bundle-Ether*`, `lag*`, FortiOS aggregate) with LACP mode, periodic timer, minimum-links, and the physical member list resolved from `802.3ad` / `channel-group N mode X` / `bundle id N` / `set member` references.

#### VLANs
VLAN name → vlan-id → L3 (SVI/IRB) interface → member interfaces (both trunk-allowed lists and access-vlan assignments).

#### Routing Instances
Each VRF / routing-instance / VDOM with type, RD, route-target, interface list, and a per-protocol summary (OSPF areas, BGP groups with neighbor counts, IS-IS/LDP/MPLS/PIM interface counts). Global protocols shown as a synthetic `master (default)` entry. FortiOS VDOMs map to the same view.

#### Firewall Rules (shown when present)
Normalized rule table — id, name, from-zone/source-intf, to-zone/dest-intf, source, destination, service, action, log flag. Sourced from JUNOS `security policies` and `firewall filter` terms, FortiOS `firewall policy` blocks, and Cisco/Arista/Aruba `ip access-list` entries.

#### System (shown when present)
Device identity (hostname, domain), platform details, NTP servers, DNS servers, AAA (TACACS+ and RADIUS hosts with VRF/key info), syslog servers, SNMP communities/trap-hosts/users, local users with privilege levels, and NX-OS-specific items: enabled features list, FEX inventory, vPC domain/peer-link/keepalive.

**Multi-device workflow:**

#### Device tabs
Each parsed config opens in its own tab. Tabs are reorderable (drag) and closeable. A device can optionally include a paste of `show cdp neighbors detail` or `show lldp neighbors detail` output to improve cross-device link detection.

#### Map Relationships
When 2+ device tabs are open, the **Map Relationships** button reconciles all parsed configs and produces a relationship table. Each discovered link is scored by confidence level:
- **Confirmed** — validated by CDP/LLDP neighbor data
- **Structural** — matching subnet on both sides
- **Plausible** — description-based match
- **Weak** — partial/heuristic match

Individual links can be removed from the view; removed links are listed below and can be restored.

#### Topology Diagram
The relationship table can be rendered as a Mermaid flowchart (Left-Right or Top-Down layout) showing devices as nodes and links annotated with interface names and confidence. Exports:
- **SVG** — vector graphic for documentation
- **draw.io XML** — importable into draw.io / diagrams.net
- **Copy Mermaid** — raw Mermaid source for pasting elsewhere

**Session management:**
- **Export Session** — saves all open device tabs (raw configs, vendor overrides, neighbor pastes, removed links) to a dated `.json` file
- **Import Session** — restores a previously exported session file

**Exports (per device):**
- **CSV** — five files prefixed with hostname: `{host}_interfaces.csv`, `{host}_aggregates.csv`, `{host}_vlans.csv`, `{host}_routing_instances.csv`, `{host}_firewall_rules.csv` (only when rules exist), plus `{host}_bgp_neighbors.csv` when BGP neighbors are configured
- **JSON** — the full normalized analysis tree
- **HTML** — styled standalone report for the current device or all open devices combined

**Architecture:** Each vendor parser is its own JSX module under `components/configParser/` exporting `{ detect, parse, sample }` on a `window.ConfigParser_X` global. `ConfigParser.jsx` is the shell that dispatches via Auto-detect or vendor selection. Adding a new vendor is one new file plus one entry in the `VENDORS` array.

**Current Keywords:** `config parser translator junos juniper cisco ios ios-xe ios-xr nxos nx-os arista eos fortinet fortios fortigate aruba aoscx aos-cx firewall policy acl rule aggregate ae lag lacp port-channel bundle-ether vlan vrf routing-instance vdom zone interface bgp ospf isis mpls ldp svi irb decode hierarchy auto-detect topology diagram relationship cdp lldp neighbor session export ntp dns aaa tacacs radius syslog snmp vpc fex features system`

**Suggested Keywords to Add:** `palo-alto panos checkpoint mikrotik routeros srx mx ex qfx nexus catalyst fortiweb drawio mermaid`

---

### MPLS Reference
**ID:** `mpls-ref` | **Type:** Reference | **Offline**

**Description:** MPLS header, label stack, and forwarding concepts.

**Sections:**
- **Label Format:** 20-bit label, 3-bit EXP, 1-bit S (bottom-of-stack), 8-bit TTL
- **Label Allocation:** Per-hop behavior (PHP), Penultimate Hop Popping
- **LDP, RSVP-TE:** Label distribution protocols
- **Traffic Engineering:** LSP setup, constrained paths, fast reroute (FRR)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `mpls multiprotocol label switching label stack header ldp rsvp-te traffic engineering fast reroute frr`

---

### VPN / IPsec Architect
**ID:** `vpn-ref` | **Type:** Reference | **Offline**

**Description:** IPsec and VPN architectural patterns.

**Sections:**
- **Transport vs Tunnel:** End-to-end vs intermediate gateway encryption
- **Phase 1 (IKE):** Diffie-Hellman, authentication (PSK/certificate)
- **Phase 2 (IPsec):** Encryption (AES), authentication (SHA), protocol (ESP/AH)
- **Encapsulation:** Tunnel encapsulation overhead
- **Dead Peer Detection:** Keepalive mechanism

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `vpn ipsec ikev1 ikev2 phase1 phase2 encryption authentication esp ah tunnel transport mode dh`

---

### WireGuard Tunnel Config Builder
**ID:** `wireguard-cfg` | **Type:** Tool | **Offline**

**Description:** Generates ready-to-deploy WireGuard configs for site-to-site and hub-and-spoke topologies, with a built-in MTU/overhead calculator and a WireGuard vs IPsec comparison table. Keys are auto-generated on load and can be regenerated.

**Tabs:**

#### Site-to-Site (P2P) (`mode: s2s`)
**Inputs:**
- Peer A & Peer B: private key, public key, tunnel IP/CIDR, listen port, external endpoint, allowed IPs
- Outer IP protocol (IPv4 / IPv6), WAN MTU
- Persistent keepalive interval

**Outputs:**
- wg-quick `.conf` for Peer A and Peer B
- systemd-networkd `.netdev` + `.network` for Peer A
- Calculated overhead (bytes) and recommended inner MTU

#### Hub & Spoke (`mode: hub_spoke`)
**Inputs:**
- Hub: private key, public key, tunnel IP/CIDR, listen port, public endpoint
- Spokes (add/remove): name, tunnel IP, public key, allowed IPs

**Outputs:**
- Hub wg-quick config with all spokes as `[Peer]` blocks
- Per-spoke wg-quick config (switchable tab)
- Deployment guide for hub and spoke setup steps

#### WireGuard vs IPsec (`mode: comparison`)
**Outputs:**
- Comparison table: performance, complexity, handshake speed, crypto agility, roaming support, setup complexity

**Current Keywords:** `wireguard wg tunnel config builder keys peer site-to-site hub spoke mtu overhead ipsec quick systemd`

---

### IPsec / IKEv2 Config Builder
**ID:** `ipsec-config` | **Type:** Tool | **Offline**

**Description:** Generates a complete IKEv2 site-to-site tunnel configuration — phase 1 and phase 2 — for Cisco IOS-XE, Juniper Junos, strongSwan/pfSense, and FortiGate from a single set of crypto parameters, with legacy/recommended hints on the proposal and a local pre-shared-key generator. Everything runs in the browser; the key never leaves the page and is excluded from the share URL.

**Tabs:** one per target platform. All tabs share the same inputs.

#### Cisco IOS / IOS-XE (`vendor: cisco_iosxe`)
**Outputs:**
- `crypto ikev2 proposal` / `policy` / `keyring` / `profile`
- `crypto ipsec transform-set` and `crypto ipsec profile` with PFS and SA lifetime
- `interface Tunnel` with `tunnel mode ipsec ipv4` and `tunnel protection ipsec profile` (route-based VTI, not crypto-map)
- Static routes for each remote network over the tunnel interface

#### Juniper Junos (SRX) (`vendor: junos`)
**Outputs:**
- `security ike proposal` / `policy` / `gateway` with `version v2-only` and DPD
- `security ipsec proposal` / `policy` / `vpn` bound to `st0`
- One `traffic-selector` per local/remote pair, plus `st0` addressing and static routes

#### strongSwan / pfSense (`vendor: strongswan`)
**Outputs:**
- `swanctl.conf` `connections {}` block with IKE and ESP proposal strings, `local_ts` / `remote_ts`, rekey and life times, DPD
- `secrets {}` block in PSK mode, or certificate file paths in certificate mode
- Note on where the same parameters live in the pfSense GUI (Phase 1 / Phase 2). No pfSense XML is produced.

#### FortiGate (FortiOS) (`vendor: fortigate`)
**Outputs:**
- `config vpn ipsec phase1-interface` — `set proposal`, `set dhgrp`, `set keylife`, `set ike-version 2`, DPD, PSK or certificate auth
- `config vpn ipsec phase2-interface` — `set proposal` (ESP), `set dhgrp`, `set pfs`, `set keylifeseconds`, `set src-subnet` / `set dst-subnet`, one stanza per pair
- `config system interface` transit addressing for the tunnel

**Inputs (shared by all tabs):**
- Tunnel name, local and peer public IPv4, outside interface, tunnel interface, tunnel transit prefix
- Local and remote protected networks (IPv4 CIDR, comma or newline separated)
- Authentication: pre-shared key (with a local `crypto.getRandomValues` generator, 16/24/32/48 characters, entropy readout) or certificates (local/CA object names and peer identity — no key material is generated)
- IKE proposal: encryption (3DES, AES-128/256-CBC, AES-128/256-GCM), integrity/PRF (SHA-1/256/384/512), DH group (2, 5, 14, 15, 16, 19, 20, 21), SA lifetime
- ESP proposal: encryption, authentication, PFS on/off with its own group, SA lifetime

**Outputs (shared):**
- Generated configuration for the selected platform, comment lines dimmed
- Proposal review: legacy / acceptable / recommended hints, including AEAD PRF behaviour and platform-version caveats
- Copy to clipboard, export as `.txt`

**Not covered here:** tunnel MTU and overhead math (see Tunnel Overhead / MTU calculator), WireGuard configuration (see WireGuard Tunnel Config Builder), and the phase-1/phase-2 architectural reference (see VPN / IPsec Architect). IPv4 endpoints only.

**Current Keywords:** `ipsec ikev2 ike vpn site-to-site s2s tunnel psk pre-shared-key esp phase1 phase2 crypto proposal transform-set dh pfs vti cisco ios-xe junos srx strongswan swanctl pfsense fortigate fortios st0`

---

### BGP Looking Glass
**ID:** `bgp-lg` | **Type:** Tool | **Online (backend required)**

**Description:** Live BGP routing table queries.

**Inputs:**
- Target AS number
- Prefix to query
- Query type: route, neighbors, AS path

**Outputs:**
- Current route advertisements
- AS path to prefix
- Neighboring AS info

*Note: Requires backend proxy or Looking Glass server access.*

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `bgp looking glass route query prefix as path neighbor autonomous system`

---

### BGP / ASN Lookup
**ID:** `asn` | **Type:** Tool | **Online (backend required)**

**Description:** AS number and organization lookup.

**Inputs:**
- AS number (e.g., AS15169 for Google)
- OR IP address (auto-queries ASN)

**Outputs:**
- Organization name
- ASN
- Prefix count, country
- WHOIS data

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `asn bgp autonomous system lookup organization prefix country whois`

---

### BGP Community Builder
**ID:** `bgp-community` | **Type:** Tool | **Offline**

**Description:** Constructs and decodes BGP communities.

**Tabs:**

#### Standard Community Tab
**Inputs:**
- AS number (16-bit)
- Value (16-bit)
- Preset communities: NO_EXPORT, NO_ADVERTISE, INTERNET

**Outputs:**
- Decimal format (e.g., `65001:100`)
- Hex format
- Cisco config syntax (e.g., `set community 65001:100`)

#### Large Community Tab (RFC 8092)
**Inputs:**
- Global Administrator (32-bit, usually ASN)
- Local Data Part 1 & 2 (32-bit each)

**Outputs:**
- Large community format: `65001:123:456`
- Juniper, Cisco syntax
- RFC reference

#### FlowSpec Tab
**Outputs:**
- FlowSpec extended communities
- Traffic rate limiting actions
- Redirect AS:VRF

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `bgp community standard large rfc8092 flowspec traffic rate limit redirect no-export no-advertise`

---

### BGP Best Path Simulator
**ID:** `bgp-best-path` | **Type:** Tool | **Offline**

**Description:** Simulates the BGP best-path decision process over 2–8 candidate paths and shows, round by round, which step eliminated each path and why. Cisco IOS/IOS-XE, Juniper Junos, Arista EOS and RFC 4271 step orders, MED modes (deterministic-med, always-compare-med, missing-as-worst) and multipath ECMP.

**Tabs:**

#### Simulator (`simulator`)
**Inputs:**
- Decision process: Cisco IOS / IOS-XE, Juniper Junos, Arista EOS, RFC 4271
- Knobs: deterministic-med, always-compare-med, missing MED as worst, compare router ID, maximum paths, multipath relax
- Per path: next-hop reachable, weight, local preference, locally originated, AS_PATH (AS_SET / confederation notation), origin, MED, eBGP/iBGP/confed, IGP metric, received order, router/originator ID, cluster list length, neighbor address
- Scenarios: AS-path prepend, transit vs peering, MED order trap, multipath ECMP, route reflector tiebreak

**Outputs:**
- Elimination trace per step (pairwise arrival-order walk when deterministic-med is off)
- Best path banner and ECMP set with exclusion reasons
- Review hints (MED order trap, missing MED, multipath prerequisites)
- Copy decision summary (text), JSON export, share URL

#### Reference (`reference`)
**Outputs:**
- Decision-order matrix: RFC 4271 vs Cisco vs Junos vs Arista
- Knob table with per-vendor CLI
- Common traps: MED order (RFC 3345), missing MED, unreachable next hop, multipath prerequisites, weight, oldest path, confederations

**Current Keywords:** `bgp best path bestpath selection decision algorithm simulator weight local preference local-pref as-path origin med multi-exit discriminator deterministic-med always-compare-med ebgp ibgp igp metric multipath ecmp router id originator cluster list route reflector tiebreak cisco juniper junos arista rfc 4271`

**Suggested Keywords to Add:** _(none)_

---

### BGP AS-Path Regex & Filter Tester
**ID:** `bgp-aspath-regex` | **Type:** Tool | **Offline**

**Description:** Tests BGP as-path filters (ordered permit/deny regex entries, first match wins, implicit deny) against a batch of AS paths, per vendor dialect: Cisco IOS/IOS-XE (POSIX with `_`), Juniper Junos (whole-AS terms, implicitly anchored), Arista EOS asn and string regex-mode. Shows which entry decided each path, the matched span and capture groups; converts Cisco ↔ Junos with explicit warnings and a verdict diff; generates CLI.

**Tabs:**

#### Tester (`tester`)
**Inputs:**
- Dialect: Cisco IOS / IOS-XE, Juniper Junos, Arista EOS (asn mode), Arista EOS (string mode)
- Filter: 1–8 permit/deny regex entries
- Test AS paths, one per line (`""` = empty path, `{a,b}` AS_SET, `(a b)` confederation)
- Recipes: `_` boundary, only local routes, customer's own prefixes, anything via neighbor, originated by AS, transit-carrier block, prepend detection, private ASN block

**Outputs:**
- Per-path verdict (permit / deny / implicit deny / invalid), deciding entry, highlighted match, capture groups
- Cisco ↔ Junos converter with unsupported/approximation warnings and a test-path verdict diff
- CLI: `ip as-path access-list` (IOS, EOS incl. `regex-mode`), Junos `policy-options as-path` + policy terms
- Review hints, copy results (with header row), JSON export, share URL

#### Reference (`reference`)
**Outputs:**
- Operator cheat sheet: IOS vs Junos vs EOS asn mode
- Recipe matrix per dialect
- Traps: undelimited ASN, Junos anchoring, `_.*_`, naive prepend regex, implicit deny vs default accept, EOS regex-mode, literal braces

**Current Keywords:** `bgp as-path aspath as_path regex regular expression filter access-list ip as-path access-list policy-options as-path underscore posix cisco ios ios-xe juniper junos arista eos regex-mode prepend private asn rfc 6996 transit leak customer peer upstream`

**Suggested Keywords to Add:** _(none)_

---

### FHRP Calculator
**ID:** `fhrp-calc` | **Type:** Tool | **Offline**

**Description:** Virtual gateway address and MAC calculation for redundancy.

**Tabs:**

#### HSRP v1 Tab
**Inputs:**
- Group number, virtual IP
- Priority, preempt setting

**Outputs:**
- Virtual MAC: `00:00:0C:07:AC:xx` (xx = group ID)
- Active/standby selection logic

#### HSRP v2 Tab
**Inputs:**
- Group number, virtual IP
- Priority

**Outputs:**
- Virtual MAC: `00:00:0C:9F:Fxxx` (xxx = group ID)
- Extended group support (0–4095)

#### VRRP Tab
**Inputs:**
- VRID, virtual IP
- Priority

**Outputs:**
- Virtual MAC: `00:00:5E:00:01:xx` (xx = VRID)
- RFC 5798 compliance

#### GLBP Tab
**Inputs:**
- Group, virtual IP
- Forwarders

**Outputs:**
- Virtual MAC mapping per forwarder

**Current Keywords:** `fhrp hsrp vrrp glbp redundancy gateway virtual mac priority preempt active standby election first hop`

**Assessment:** Good. Could add: `virtual router group id hello timer dead interval failover`

---

### Prefix List & Route Map Builder
**ID:** `prefix-list-builder` | **Type:** Tool | **Offline**

**Description:** Constructs prefix-list and route-map policies.

**Inputs - Prefix List Tab:**
- Network CIDR
- Operators: exact / ge (greater-equal) / le (less-equal)
- Sequence number

**Inputs - Route Map Tab:**
- Match conditions: prefix-list, AS path, community, route type
- Set actions: metric, AS path prepend, community, local preference

**Outputs:**
- Cisco IOS, NX-OS, Juniper route-policy syntax
- Export JSON
- Policy explanation

**Current Keywords:** `prefix-list route-map redistribution bgp ospf filter ge le cisco ios nxos juniper arista policy routing`

**Assessment:** Good. Could add: `sequence number match set permit deny attribute modification policy`

---

## Infrastructure, QoS & Planning

### OSI & TCP/IP Model
**ID:** `osi-model` | **Type:** Reference | **Offline**

**Description:** OSI 7-layer model and TCP/IP mapping.

**Layers:**
- **Layer 7 (Application):** HTTP, DNS, SMTP, SSH, Telnet, FTP
- **Layer 6 (Presentation):** Encryption, compression
- **Layer 5 (Session):** SOCKS, RPC, NFS
- **Layer 4 (Transport):** TCP, UDP, SCTP
- **Layer 3 (Network):** IP, ICMP, IGMP, routing
- **Layer 2 (Data Link):** Ethernet, PPP, MPLS
- **Layer 1 (Physical):** Fiber, copper, wireless

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `osi model layer tcp ip application presentation session transport network datalink physical`

---

### Cable & Transceiver Calculator
**ID:** `cable` | **Type:** Tool | **Offline**

**Description:** Comprehensive cabling and transceiver analysis including attenuation, distance calculations, fiber/copper specifications, and transceiver (SFP/QSFP) compatibility for network link budgeting.

**Tabs:**

#### Fiber Loss Budget (`fiber`)
**Inputs:**
- Fiber type (OS1, OS2, OM1–OM5)
- Distance + unit (km/m)
- Number of connectors + per-connector loss (dB)
- Number of splices + per-splice loss (dB)
- Safety margin (dB)
- TX power (dBm) + RX sensitivity (dBm)
- SFP/QSFP preset (optional — auto-fills TX/RX values)
- Connector type (LC, SC, MPO, etc.)

**Outputs:**
- Total link loss budget breakdown (cable, connectors, splices, margin)
- Available power margin (dB) with pass/warn/fail indicator
- Visual loss bar chart
- Budget summary table (exportable)

#### Copper Calculator (`copper`)
**Inputs:**
- Cable category (Cat5e, Cat6, Cat6A, Cat7, Cat8)
- Cable length (m)

**Outputs:**
- Maximum supported Ethernet speed at given length
- Per-category speed/distance limits
- Warn when length exceeds spec for selected speed

#### Reference Tables (`ref`)

##### Ethernet Distances (`ethdist`)
- IEEE 802.3 Ethernet standard distance limits for 100BASE-FX through 400GBASE variants
- Fiber type and connector requirements per standard

##### Fiber Types (`fiber`)
- OS1/OS2, OM1–OM5 specifications: core diameter, bandwidth, max reach, wavelength support

##### Transceivers (`txrx`)
- SFP/SFP+/QSFP/QSFP28/BiDi/CWDM/DWDM TX power, RX sensitivity, fiber type, and distance specs
- Cross-reference to fiber loss budget calculator

##### Copper Categories (`copper`)
- Cat5e–Cat8 specs: frequency (MHz), shielding options, max speed, impedance

##### Connectors & Splices (`conn`)
- LC, SC, ST, FC, MPO/MTP insertion loss specs
- Fusion vs. mechanical splice loss typical values
- MPO polarity types A/B/C with fiber mapping diagrams

**Current Keywords (parent):** `cable transceiver fiber copper fibre attenuation distance`

**Sub-tool Keywords:**
- Fiber Loss Budget: `sfp qsfp loss budget smf mmf os1 os2 om1 om2 om3 om4 wavelength 1310nm 1550nm 850nm`
- Copper Calculator: `cat5e cat6 cat6a cat7 cat8 tia-568 ethernet length speed`
- Ref: Ethernet Distances: `100base 1000base 10gbase 40gbase 100gbase ieee 802.3 ethernet standard reach`
- Ref: Fiber Types: `om1 om2 om3 om4 om5 os1 os2 singlemode multimode 50um 62.5um`
- Ref: Transceivers: `sfp+ qsfp28 bidi cwdm dwdm tx rx power sensitivity 100g 400g`
- Ref: Copper Categories: `cat8 shielded utp ftp bandwidth impedance 25gbase 40gbase`
- Ref: Connectors & Splices: `lc sc st fc mpo mtp splice fusion mechanical connector insertion`

---

### Packet Header Map
**ID:** `packet-headers` | **Type:** Reference | **Offline**

**Description:** Interactive bit-level header diagrams for IPv4, IPv6, TCP, and UDP. Click any field to edit its value and see the live wire encoding in hex, binary, and a Scapy snippet.

**Tabs:**

#### IPv4 Header (`ipv4`)
- Version, IHL, DSCP, ECN, Total Length, ID, Flags (DF/MF), Fragment Offset, TTL, Protocol, Checksum, Src/Dst IP
- RFC 791

#### IPv6 Header (`ipv6`)
- Version, Traffic Class, Flow Label, Payload Length, Next Header, Hop Limit, Src/Dst Address (128-bit)
- RFC 8200

#### TCP Header (`tcp`)
- Src/Dst Port, Sequence, Acknowledgment, Data Offset, Flags (SYN/ACK/FIN/RST/PSH/URG/ECE/CWR), Window, Checksum, Urgent Pointer
- RFC 9293

#### UDP Header (`udp`)
- Src/Dst Port, Length, Checksum
- RFC 768

**Outputs (all tabs):**
- Live hex wire encoding, binary layout, Scapy constructor snippet
- Copy wire bytes / copy Scapy snippet

**Current Keywords:** `packet header map bit field diagram ipv4 ipv6 tcp udp protocol rfc791 rfc8200 rfc9293 rfc768 ttl dscp ecn tos flags fragmentation checksum flow label hop limit next header traffic class syn ack fin rst sequence acknowledgment window connectionless datagram`

---

### TCP Flag Decoder
**ID:** `tcp-flags` | **Type:** Tool | **Offline**

**Description:** Two-way encode/decode of the 9 TCP control flags (NS, CWR, ECE, URG, ACK, PSH, RST, SYN, FIN) with Wireshark filter generation.

**Inputs:**
- Flag value in hex, decimal, or binary (mode selector)
- OR toggle individual flags via checkboxes (kept in sync with numeric input)

**Outputs:**
- Per-flag table:
  - Bit position (0–8)
  - Hex mask
  - Flag state (set/clear)
  - RFC description
  - Wireshark field name
- Combined value shown in hex/decimal/9-bit binary
- Common flag combinations with names:
  - SYN (initialization), SYN-ACK (response), FIN-ACK (graceful close)
  - RST (reset), ACK (acknowledgment), PSH (push data)
  - NULL scan, XMAS scan, FIN scan (common for port scanning)
  - Click-to-load for common combinations
- Generated Wireshark display filters:
  - Combined: `tcp.flags == 0xNNN`
  - Per-flag forms: `tcp.flags.syn == 1`, `tcp.flags.ack == 0`

**Current Keywords:** `tcp flags syn ack fin rst psh urg ece cwr ns decode xmas null scan wireshark filter hex binary`

**Suggested Keywords to Add:** `control bits handshake three-way rfc9293 rfc3168 tshark checksum`

---

### NTP Stratum Calculator
**ID:** `ntp-stratum` | **Type:** Tool | **Offline**

**Description:** NTP (Network Time Protocol) stratum analysis, timestamp calculations, and source parsing.

**Tabs:**

#### Stratum Hierarchy (`tab: hierarchy`)
**Outputs:**
- Visual stratum 0–16 reference cards with badge color, label, description, and examples
- RefID lookup table: `.GPS.`, `.PPS.`, `.GAL.`, `.GLNS.`, `.DCF.`, `.WWVB.`, `.ATOM.`, `.LOCL.`, `.INIT.`, `.DENY.`, `.RATE.`, etc.
- RFC 5905 and RFC 4330 reference links

#### Offset / Delay / Jitter (`tab: odj`)
**Inputs:**
- Four NTP timestamps T1–T4 (decimal seconds or ms; enter one sample or multiple for jitter)
- Add Sample button for multi-sample jitter accumulation

**Outputs:**
- Clock offset = ((T2−T1)+(T3−T4))/2
- Round-trip delay = (T4−T1)−(T3−T2)
- RMS jitter across accumulated samples

#### Parse ntpq / chronyc (`tab: parse`)
**Inputs:**
- Paste `ntpq -p` output (Linux ntpd or Cisco NTP) — auto-detected
- OR paste `chronyc sources` output (Chrony daemon) — auto-detected

**Outputs:**
- Decoded tally/state badges per peer (sys.peer, candidate, outlier, falseticker, backup, pps-peer)
- Structured table: remote, refid, stratum, type, when, poll, reach, delay, offset, jitter
- Export to JSON

**Current Keywords:** `ntp stratum hierarchy reference clock offset delay jitter ntpq chronyc sources sync time rfc5905 gps pps`

---

### QoS / DSCP Bit Map
**ID:** `qos-tool` | **Type:** Tool | **Offline**

**Description:** QoS policy design toolkit: DSCP marking decoder, link delay/latency calculator, VoIP MOS estimator, token-bucket policer, and CBWFQ/shaping bandwidth planner.

**Tabs:**

#### DSCP Decoder (`dscp`)
**Inputs:**
- DSCP value (decimal, hex, or name: EF, AF11–AF43, CS0–CS7, BE)

**Outputs:**
- 6-bit DSCP binary field
- 3-bit IP Precedence (legacy)
- Per-hop behavior (PHB): EF, AF, CS, BE
- RFC 4594 application mapping (VoIP → EF, Video → AF4x, Bulk → AF1x)
- Full DSCP reference table

#### Delay & Latency (`delay`)
**Inputs:**
- Packet size (bytes)
- Link speed (Mbps)
- Distance (km)

**Outputs:**
- Serialization delay (ms)
- Propagation delay (ms)
- Total one-way delay (ms)

#### VoIP & MOS (`voip`)
**Inputs:**
- Codec: G.711, G.729, G.722
- Latency (ms), jitter (ms), packet loss (%)

**Outputs:**
- MOS score (1.0–4.5, ITU-T E-model)
- Quality assessment: Excellent / Good / Fair / Poor
- Improvement recommendations

#### Token Bucket (`bucket`)
**Inputs:**
- CIR (kbps), Bc (bits burst)

**Outputs:**
- Token replenishment rate
- Burst duration (ms)
- Conforming vs. exceeding traffic behaviour

#### CBWFQ / Shaping (`cbwfq`)
**Inputs:**
- Interface bandwidth + unit (Mbps/Gbps)
- Tc interval (ms), shaping mode (average/peak)
- Per-class rows: name, type (priority/bandwidth), % allocation

**Outputs:**
- Per-class bandwidth (kbps/Mbps)
- Bc per class (bits)
- Cisco IOS-style policy-map config snippet

**Current Keywords (parent):** `qos dscp quality of service marking traffic`

**Sub-tool Keywords:**
- DSCP Decoder: `dscp codepoint 6-bit phb ef af cs precedence per-hop behavior rfc4594 tos`
- Delay & Latency: `delay latency propagation serialization queuing pkt packet size link speed`
- VoIP & MOS: `voip mos g711 g729 g722 e-model itu-t codec jitter packet loss mean opinion score`
- Token Bucket: `token bucket cir bc burst committed information rate policing shaping policer`
- CBWFQ / Shaping: `cbwfq class based weighted fair queue bandwidth allocation tc interval shaping cisco`

---

### CoPP / Control Plane Policing Builder
**ID:** `copp-builder` | **Type:** Tool | **Offline**

**Description:** Generates control-plane protection policy: per-protocol policers chained class-map → policy-map → control-plane for Cisco IOS, IOS-XE and NX-OS, and a policed lo0 firewall filter for Juniper Junos. Includes lenient/moderate/strict presets and a deployment reference.

**Tabs:**

#### Config (`config`)
**Inputs:**
- Platform: Cisco IOS, IOS-XE, NX-OS, Juniper Junos
- Policy/filter name; attachment (aggregate / host / transit) on IOS and IOS-XE; unmatched-traffic action on Junos
- Presets: Lenient (monitor), Moderate, Strict
- Protocol classes (SSH, SNMP, BGP, OSPF, IS-IS, ICMP, ARP, NTP): enable, source prefix, rate + burst (kbps/bytes, or pps/packets on NX-OS), action (police / monitor)
- Up to six custom ACL-backed classes: name, protocol, destination port, source, rate, action (police / monitor / block)
- class-default rate and action

**Outputs:**
- Full vendor configuration: ACLs, class-maps, policy-map with policers, control-plane service-policy (Cisco); policers, lo0 inet filter terms and interface attachment in set format (Junos)
- Burst duration per class; review hints (lockout risk, sub-MTU bursts, unrestricted management sources, non-IP protocols)
- Copy and .txt download

#### Reference (`reference`)
**Outputs:**
- Built-in CoPP per platform (NX-OS profiles, Catalyst 9000 system-cpp-policy, Junos ddos-protection)
- Tool preset table, policing dialect comparison, deployment guidance, related tools

**Current Keywords (parent):** `copp control plane policing protection cppr policer police rate burst class-map policy-map service-policy lo0 protect-re firewall filter cisco ios ios-xe nx-os nexus juniper junos ssh snmp bgp ospf icmp arp ntp`

**Sub-tool Keywords:**
- Config: `copp config class-map policy-map control-plane service-policy input police cir bc conform exceed violate lo0 filter policer preset lenient moderate strict`
- Reference: `copp profile strict moderate lenient dense system-cpp-policy ddos-protection deployment guidance rate-limit dialect`

---

### MTU & Encapsulation
**ID:** `mtu` | **Type:** Tool | **Offline**

**Description:** Calculates effective MTU considering tunnel/VPN overhead.

**Inputs:**
- Tunnel type: GRE, IPsec (ESP/AH), VXLAN, WireGuard, Geneve, L2TPv3
- Encryption cipher (if IPsec)
- Base interface MTU

**Outputs:**
- Encapsulation header size
- Effective MTU for payload
- Recommended MSS clamping value
- Impact on fragmentation

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `mtu encapsulation tunnel overhead gre ipsec vxlan wireguard geneve l2tpv3 nvgre capwap mss clamping`

---

### WLAN / 802.11 Planner
**ID:** `wlan-tool` | **Type:** Tool | **Offline**

**Description:** Designs Wi-Fi deployments with capacity and coverage planning.

**Inputs:**
- Coverage area (sq meters)
- Expected client density
- Applications: Data / VoIP / Video
- Standard: 802.11ac / 802.11ax (Wi-Fi 6)

**Outputs:**
- AP count recommendation
- Channel plan (1/6/11 for 2.4 GHz, non-overlapping 5 GHz)
- Roaming thresholds
- QoS parameter settings

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `wlan wifi 802.11 planner access point coverage capacity client density roaming qos`

---

### Wireless & RF Planner
**ID:** `wifi-rf-planner` | **Type:** Tool | **Offline**

**Description:** Scenario-driven Wi-Fi design, RF math converters, point-to-point link budgets, and an 802.11 reference cheat sheet — all sharing one pure path-loss / airtime / SNR→MCS engine. Replaces the legacy WLAN planner, channel planner, airtime calculator, and roaming optimizer.

**Tabs:**

#### Design Studio (`design`)
**Inputs:**
- Floor space: length × width (m/ft toggle) or direct area
- Environment preset → path-loss exponent n (open-plan 2.2 / drywall 3.0 / dense brick-concrete 3.5 / warehouse 3.3)
- Primary band (5/6/2.4 GHz) and channel width (20/40/80/160 MHz)
- Use-case preset → target cell-edge RSSI (voice/high-density −67, data −72, coverage −75 dBm)
- Device count and average throughput per device (Mbps)
- Optional AP TX power (default 18 dBm) and antenna gain (default 4 dBi)

**Outputs:**
- Plain-English design verdict (AP count, binding constraint, cell radius, devices/AP)
- AP count = max(coverage-bound, capacity-bound), with the dominant constraint reported
- Coverage via log-distance path loss (PL(d)=PL(d0)+10·n·log10(d)); capacity via A-MPDU airtime model
- Auto-assigned non-overlapping channel plan with co-channel-reuse flag
- Persistent "planning estimate, not a site survey" disclaimer
- Share-URL support (base64 input state)

#### RF Reference Deck (`reference`)
**Inputs/Outputs (six stateless converters, each with its own copy button):**
- dBm ↔ mW (bidirectional)
- EIRP & regulatory headroom (TX + gain − cable loss vs FCC/ETSI cap)
- FSPL & achievable distance from a link budget
- SNR → expected MCS index / modulation
- Channel ↔ center frequency with band / UNII / DFS / 6 GHz PSC lookup
- Fresnel zone: 1st-zone radius and 60% clearance

#### PtP Link Budget (`ptp`)
**Inputs:** Frequency band, TX power, TX/RX antenna gain, RX sensitivity, fade margin, distance

**Outputs:**
- FSPL, link budget, link margin (pass/fail), max free-space range, 60% Fresnel clearance
- Recommended TX power and a Fresnel-zone illustration
- Share-URL support (base64 input state)

#### 802.11 Cheat Sheet (`cheatsheet`)
**Outputs (six screenshot-friendly static reference tables):**
- 802.11 standards matrix (a/b/g/n/ac/ax/be ↔ Wi-Fi 4/5/6/6E/7)
- Channels & regulatory (2.4 GHz 1/6/11; 5 GHz UNII bands + DFS; 6 GHz PSC)
- Signal quality (RSSI thresholds, SNR targets)
- Power & regulatory limits (EIRP caps FCC/ETSI, dBm↔mW quick table)
- Security & roaming (WPA2/WPA3, 802.11r/k/v/w, PMF)
- Frame & airtime basics (overhead, guard intervals, DFS CAC, A-MPDU)

#### Channel Planner (`channels`)
**Inputs:** Band (2.4/5/6 GHz) and channel width (20/40/80/160/320 MHz).
**Outputs:**
- Categorized list of Recommended, Acceptable, and Avoid channels based on spectral constraints and simulated occupancy.
- Interactive channel spectrum grid illustrating bandwidth coverage, DFS/PSC status, and active interference levels.
- Simulated spectral scan trigger to refresh channel quality and details panel.

#### AP Config Builder (`wapconfig`)
**Inputs:** SSID, Security Type (WPA2-PSK, WPA3-SAE, WPA2/WPA3 Mixed, 802.1X Enterprise), pre-shared key, VLAN ID, Transmit Power Level (1-8), and active radio bands.
**Outputs:** Tabbed enterprise configuration commands for Cisco Catalyst (IOS-XE), ArubaOS CLI, Ruckus SmartZone CLI, and Ubiquiti UniFi CLI, with code copying.

#### Security Checklist (`security`)
**Inputs:** Interactive checkbox audits for critical wireless controls (WPA3, PMF, guest isolation, legacy protocol deprecation, admin ACLs, rogue scanning, 802.1X/MFA, and fast roaming).
**Outputs:** Wi-Fi Security Score (out of 100), Letter Grade (A-F), progress bar, and prioritized list of actionable remediation steps.

**Current Keywords:** `wifi wireless rf planner link budget path loss fspl fresnel channel airtime capacity mcs roaming 802.11 2.4ghz 5ghz 6ghz spectrum unii fast transition`

**Suggested Keywords to Add:** `eirp dbm rssi snr dfs psc cheat sheet design studio ptp point-to-point cell radius wap wpa3 pmf cli cisco aruba ruckus ubiquiti configuration security assessment`

---

### LoRaWAN / IoT Capacity Planner
**ID:** `lorawan-planner` | **Type:** Tool | **Offline**

**Description:** Airtime and gateway capacity estimation.

**Inputs:**
- Number of devices
- Message frequency (messages/day)
- Payload size (bytes)
- Spreading factor (SF7–SF12)
- Bandwidth (125 kHz, 250 kHz)
- Geography: ISM 915 MHz (Americas) / 868 MHz (EU)

**Outputs:**
- Time-on-air (ToA) per message
- Total airtime per device
- Gateway capacity (% utilization)
- Collision probability (ALOHA model)
- Recommendations: increase SF, add gateways, reduce frequency

**Current Keywords:** `lorawan iot lora spreading factor airtime gateway capacity duty cycle sf7 sf8 sf9 sf10 sf11 sf12 sub-ghz`

**Assessment:** Good. Could add: `time-on-air aloha collision probability capacity planning device density`

---

### QR Code Generator
**ID:** `wifi-qr` | **Type:** Tool | **Offline**

**Description:** Generate QR codes for Wi-Fi network onboarding, web URLs / management links, and arbitrary configuration or diagnostic text with customizable error correction levels — and decode QR codes back into their raw payload from screenshots or image files.

**Tabs:**

#### Wi-Fi Network (`wifi`)
**Inputs:**
- SSID (Network Name)
- Encryption: WPA/WPA2/WPA3 / WEP / None (Open)
- Password
- Hidden SSID (checkbox)

**Outputs:**
- High-resolution QR code image
- Formatted Wi-Fi spec string (`WIFI:S:...;T:...;P:...;H:...;;`)
- PNG Download & Shareable URL

#### URL / Link (`url`)
**Inputs:**
- Target URL / Web Address (HTTP / HTTPS / management portal)
- Quick Presets (router admin, NetEngKit)

**Outputs:**
- Direct URL QR code
- Raw URL payload preview
- PNG Download & Shareable URL

#### Plain Text (`text`)
**Inputs:**
- Multiline text area (configuration snippets, serial numbers, cryptographic public keys, arbitrary payload)

**Outputs:**
- Plain text QR code
- Character count & raw payload display
- PNG Download & Shareable URL

#### Decode QR Code (`decode`)
**Inputs:**
- Image file picker (PNG / JPG / WebP)
- Clipboard paste — Ctrl+V anywhere on the tab, or "Paste Screenshot" button
- Drag & drop zone

**Outputs:**
- Decoded raw payload (monospace box, copy button)
- Payload type badge: Wi-Fi Onboarding, URL, vCard / MECARD, OTP seed, Email, SMS, Geo, Plain Text
- Parsed Wi-Fi fields when payload is a `WIFI:` string (SSID, encryption, password, hidden flag)

**Common Options (generator tabs):**
- Error Correction Level (ECC): L (7%), M (15%), Q (25%), H (30%)
- Output Resolution: 192x192, 256x256, 384x384, 512x512 px

**Current Keywords:** `wifi qr code generator decoder decode scan ssid url link text general onboarding provisioning barcode 2d matrix`

**Sub-tool Keywords:** decode tab — `decode read scan parse screenshot image paste file reader`

---

### PoE Power Budget
**ID:** `poe-budget` | **Type:** Tool | **Offline**

**Description:** Power supply design for PoE devices.

**Inputs:**
- PSU manufacturer: Cisco / Aruba / Juniper / Ubiquiti / MikroTik
- Device count per power class (802.3af/at/bt)
- Cable length, gauge

**Tabs:**

#### Budget Tab
**Inputs:**
- Per-device power: 15.4W (af), 30W (at), 90W (bt)

**Outputs:**
- Total power draw
- Recommended PSU wattage
- Safety margin (typically 20%)

#### Cable Loss Tab
**Inputs:**
- Cable category (Cat5e, Cat6a)
- Length
- Temperature

**Outputs:**
- Voltage drop along cable
- Power loss (watts, %)
- End-device receive power

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `poe power over ethernet budget 802.3af at bt wattage cable loss voltage drop`

---

### SCP / TFTP Transfer Planner
**ID:** `image-transfer-planner` | **Type:** Tool | **Offline**

**Description:** Network image transfer time estimation.

**Inputs:**
- Image size (MB, GB)
- Protocol: SCP / TFTP / FTP / HTTP
- Network speed (Mbps)
- Device: Cisco IOS / Juniper Junos / Arista EOS (with vendor-specific transfer commands)

**Outputs:**
- Transfer time (seconds, minutes)
- Bandwidth utilization
- Fleet transfer time (# devices × serial transfer time)
- Vendor-specific command: `copy tftp: flash:` (Cisco), `request system software add ...` (Juniper), etc.

**Current Keywords:** `scp tftp ftp sftp http https image transfer planner speed upgrade fleet copy command cisco juniper arista fortinet panos linux bandwidth time`

**Assessment:** Good. Could add: `ios junos eos panos firmware upgrade serial parallel device command syntax`

---

### TCP Congestion Visualizer
**ID:** `tcp-congestion` | **Type:** Tool | **Offline**

**Description:** Visualizes TCP congestion window behavior.

**Inputs:**
- Algorithm: Reno / Cubic / BBR
- RTT (ms)
- Packet loss rate (%)
- Initial window (IW)

**Outputs:**
- CWND (congestion window) over time graph
- Slow start phase, congestion avoidance
- Throughput (Mbps) based on algorithm behavior
- Explanation of algorithm differences

**Current Keywords:** `tcp congestion window reno cubic bbr bdp slow start cwnd ssthresh sysctl tuning throughput`

**Assessment:** Good. Could add: `algorithm window scaling recovery fairness loss`

---

### TCP Throughput & BDP Calculator
**ID:** `tcp-throughput` | **Type:** Tool | **Offline**

**Description:** RFC-grounded TCP throughput, BDP (Bandwidth-Delay Product), window scaling (RFC 7323) calculator, and file transfer time modeling.

**Inputs:**
- Bandwidth (Kbps, Mbps, Gbps, or custom bps) with quick presets (T1, DS3, 1G, 10G, etc.)
- RTT (ms) with presets (LAN, Metro, Regional, Satellite, etc.)
- MSS (bytes, default 1460)
- IP version (IPv4 vs IPv6) for header overhead
- Window size & unit (B, KiB, MiB, GiB)
- Window scale factor (0 to 14)

**Outputs:**
- Max window-limited L3, L4 (TCP), and L2 (Ethernet) throughput
- BDP in bytes and bits
- Window scaling comparison (with vs without scaling)
- Congestion window analysis (initial cwnd, ssthresh, RTTs to fill BDP)
- RTT impact table showing throughput degradation across latency levels
- File transfer time estimation (Ideal time vs. TCP window-limited time for 1MB to 100GB files)

**Current Keywords:** `tcp throughput window scaling rfc 7323 rtt mss bdp bandwidth delay product lfn l2 l3 l4 overhead efficiency file transfer time presets`

**Assessment:** Consolidated BDP Calculator features with TCP Throughput Estimator into a unified tool. Added presets and file transfer time models.

---

### Load Balancer Config
**ID:** `lb-config` | **Type:** Tool | **Offline**

**Description:** Multi-vendor load balancer configuration.

**Inputs - Pool Tab:**
- Backend servers (IP:port)
- Health check method: TCP, HTTP status code
- Health check interval, timeout
- Load balancing algorithm: round-robin, least-conn, source-hash

**Inputs - Frontend Tab:**
- Virtual IP (VIP) + port
- SSL offload (Y/N)
- Session persistence method

**Outputs:**
- HAProxy config
- Nginx config
- F5 BIG-IP iControl CLI

**Current Keywords:** `load balancer haproxy nginx f5 big-ip reverse proxy lbaas backend frontend ssl termination health check session persistence rate limiting`

**Assessment:** Good. Could add: `pool member health check algorithm round-robin least connection stickiness`

---

### NetBox / Nautobot Import Builder
**ID:** `netbox-import` | **Type:** Tool | **Offline**

**Description:** Generates CSV/JSON for IPAM and DCIM data import.

**Inputs - Site Tab:**
- Site name, region, ASN
- Devices per site

**Inputs - Device Tab:**
- Device name, device type, site
- Primary IP

**Inputs - Interface Tab:**
- Interface name, type (Ethernet/SFP), device
- IP, prefix, VLAN

**Outputs:**
- CSV: devices.csv, interfaces.csv, ip_addresses.csv
- JSON: NetBox API-compatible format
- Import command for nautobot-cli

**Current Keywords:** `netbox nautobot inventory csv json import dcim ipam device interface vlan vrf circuit site rack`

**Assessment:** Good. Could add: `source of truth data importer integration api`

---

### Kea DHCP Lease Manager
**ID:** `kea-dhcp` | **Type:** Tool | **Offline**

**Description:** Parses and edits Kea `leases4.csv` files, converts ARP table output from any vendor into Kea-ready CSV, and diffs ARP tables against lease files to surface missing or stale bindings.

**Tabs:**

#### Lease Viewer (`tab: viewer`)
**Inputs:**
- Paste or load Kea `leases4.csv` content

**Outputs:**
- Summary stats: total, active, expired, declined, unique MACs, duplicate IPs
- Filterable table: IP, MAC, hostname, OUI vendor, state badge, subnet ID, expiry timestamp
- Inline edit (IP, MAC, hostname, subnet ID, expiry) and delete per row
- Remove Duplicates button (keeps best state/latest expiry)
- Export as `kea-leases4.csv`, Copy CSV

#### ARP → Lease (`tab: converter`)
**Inputs:**
- ARP table output: Cisco IOS, BSD/OPNsense/FreeBSD, Linux (`ip neigh` / `arp`), Windows, JunOS (auto-detected)
- Subnet ID, valid lifetime (seconds)

**Outputs:**
- Preview table: IP, MAC, OUI vendor, subnet, lifetime
- Kea CSV output ready to paste into `leases4.csv`
- Copy CSV, Download `kea-leases4.csv`

#### ARP vs Lease Diff (`tab: diff`)
**Inputs:**
- ARP table (any supported format)
- Kea `leases4.csv` content

**Outputs:**
- Summary: ARP entry count, lease count, missing count, stale count
- Missing table: IPs seen in ARP but absent from leases — with Add to Lease per row
- Stale table: active leases with no matching ARP entry — with Remove per row
- Export CSV of missing entries with configurable subnet ID and lifetime

**Current Keywords:** `kea dhcp lease csv mac address arp convert diff import isc dhcp4 leases4 subnet binding opnsense freebsd`

**Assessment:** Good. Could add: `lease binding expiry abandoned hostname fqdn duid`

---

### DNS over HTTPS/TLS Builder
**ID:** `doh-dot-cfg` | **Type:** Tool | **Offline**

**Description:** DoH / DoT / DoQ endpoint configuration.

**Inputs:**
- Protocol: DoH (DNS-over-HTTPS) / DoT (DNS-over-TLS) / DoQ (DNS-over-QUIC)
- DNS server IP
- Hostname (for certificate validation)
- Certificate: self-signed or CA-signed

**Tabs:**

#### DNS Server Config Tab
**Outputs:**
- Unbound / BIND9 config
- Cloudflare DNS config
- Google DNS config

#### Client Config Tab
**Outputs:**
- Firefox Policy (privacy.trr.uri)
- macOS `/etc/resolver/domain.plist`
- Linux /etc/systemd/resolved.conf
- Windows ProxyAutoConfig

#### Security Tab
**Outputs:**
- Certificate pinning setup
- DNSSEC validation config

**Current Keywords:** `dns doh dot doq https tls security cisco bind unbound resolved browser profile cert pin policy`

**Assessment:** Good. Could add: `dns-over-https dns-over-tls privacy encryption systemd resolved`

---

### Reverse DNS & RFC 2317 Generator
**ID:** `rdns-generator` | **Type:** Tool | **Offline**

**Description:** Generates reverse DNS from a prefix: `in-addr.arpa` zones for IPv4 /8–/24 (split on octet boundaries), RFC 2317 classless delegation for /25–/32 (parent NS + CNAME snippet and child zone), and `ip6.arpa` nibble zones for IPv6 (split on nibble boundaries). PTR names from a token template or an imported IP ↔ hostname list, with per-record edits. Exports BIND zone files and Unbound `local-zone` / `local-data`.

**Modes:** IPv4 zone (`v4`), IPv4 RFC 2317 (`rfc2317`), IPv6 ip6.arpa (`v6`)

**Inputs:**
- Prefix (CIDR)
- PTR name template with tokens `{ip}`, `{dashes}`, `{octets}`, `{octet1}`–`{octet4}`, `{hex}`, `{v6hextets}`, `{n}`
- RFC 2317 child label style: `start-length`, `start/length`, `first-last`; skip network/broadcast toggle
- SOA: nameservers, RNAME, TTL, serial
- Host list import (CSV or whitespace, header row tolerated)

**Outputs:**
- Zone names, PTR owner names (relative), per-record table with edit/delete/restore and filter
- BIND zone file(s); RFC 2317 parent snippet (NS + CNAMEs); Unbound config
- Checks: trailing-dot FQDN, hostname syntax, out-of-prefix / wrong-family / duplicate import lines, hosts without PTR, parent CNAMEs without a child PTR
- Copy (records with header row), JSON export, share URL

**Current Keywords:** `reverse dns rdns ptr pointer record in-addr.arpa ip6.arpa nibble zone file bind named unbound local-data local-zone rfc 2317 classless delegation cname subnet /25 /26 /27 /28 /29 ipv6 prefix bulk hostname template csv import soa ns`

**Suggested Keywords to Add:** _(none)_

---

### Zigbee / IEEE 802.15.4 Toolkit
**ID:** `zigbee-toolkit` | **Type:** Tool | **Offline**

**Description:** Unified Zigbee and IEEE 802.15.4 radio planning suite: channel interference analysis, network capacity estimation, battery life, frame decode, link budget, and protocol comparison.

**Tabs:**

#### Channel & Interference (`channel`)
**Inputs:**
- Wi-Fi channel in 2.4 GHz range
- Zigbee channel (11–26, each 2 MHz wide, 5 MHz apart)

**Outputs:**
- Overlap visualization
- Recommended Zigbee channels: 15, 20, 25 (minimal Wi-Fi overlap)

#### Network Capacity (`capacity`)
**Inputs:**
- Network topology (tree / star / mesh)
- Stack profile (Z3 / ZHA / ZLL / custom)
- Number of routers, coordinator to mesh depth

**Outputs:**
- Estimated max end devices
- Routing capacity and buffer limits
- Recommended coordinator/router ratios

#### Battery Life (`battery`)
**Inputs:**
- Transmission power (dBm), message frequency (messages/day)
- Payload size (bytes), battery capacity (mAh), RX window duration
- Sleep interval, battery type (CR2032 etc.)

**Outputs:**
- Transmit current (mA), average current (sleeping + TX)
- Battery life estimate (months/years)

#### Frame Decoder (`frame`)
**Inputs:**
- IEEE 802.15.4 frame hex — decode or encode

**Outputs:**
- Frame type (Beacon, Data, ACK, Command), addressing mode, security bit
- Bit-level FCF field breakdown

#### Link Budget (`linkbudget`)
**Inputs:**
- TX power (dBm), frequency (2.4 GHz), distance (m)
- TX/RX antenna gain (dBi), RX sensitivity (dBm), fade margin

**Outputs:**
- Path loss, received power, link margin (pass/fail), maximum range

#### Protocol Comparison (`compare`)
**Outputs:**
- Side-by-side feature matrix: Zigbee vs Thread vs Z-Wave vs BLE vs LoRaWAN vs Matter
- Frequency, range, data rate, topology, power, security, ecosystem

**Current Keywords:** `zigbee ieee 802.15.4 channel interference battery life frame decoder link budget iot protocol thread z-wave ble lorawan matter smart home sensor mesh coordinator router capacity network`

---

### Cabling Reference
**ID:** `cabling-ref` | **Type:** Reference | **Offline**

**Description:** Copper, fiber, and specialty cabling standards.

**Sections:**
- **Copper:** TIA-568A/B pinout, Cat5e–Cat8 specs
- **Fiber:** Single-mode (OS1/OS2), multimode (OM1–OM5), MPO/MTP polarity (Type A/B/C)
- **Specialty:** Coax (RG6, RG11), Twinax, Power cables for POE

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `cabling reference copper fiber category cat5e cat6a mpo mtp polarity tia-568 standard`

---

### RADIUS / TACACS+ Reference
**ID:** `radius-tacacs` | **Type:** Reference | **Offline**

**Description:** AAA protocol reference and attribute mapping.

**RADIUS (RFC 2865/2866):**
- Attributes: User-Name, User-Password, Service-Type, Framed-IP-Address
- Accounting: Start, Stop, Interim-Update
- Encryption: MD5 hashing for password

**TACACS+ (Cisco proprietary):**
- Attributes: User-Name, User-Password, Privilege Level
- Separation: Authentication, Authorization, Accounting
- Encryption: MD5-based, full packet encryption

**Current Keywords:** `radius tacacs aaa authentication authorization accounting attribute av-pair rfc2865 rfc2866 rfc3162 cisco freeradius priv-lvl shell ppp`

**Assessment:** Good. Could add: `secret shared key password encryption md5 radius port 1812 1813 tacacs port 49`

---

## Media & Broadcast

### IPFM / NBM / PTP Reference
**ID:** `ipfm-ref` | **Type:** Reference | **Offline**

**Description:** SMPTE ST 2110 IP media and precision timing reference.

**Sections:**
- **IPFM (IP Flow Management):** ST 2110-20 video, ST 2110-30 audio, ST 2110-40 data
- **NBM (Network-based Media):** Flow identification, clock recovery
- **PTP (Precision Time Protocol, IEEE 1588):** Grand master, boundary clock, ordinary clock

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `smpte st 2110 ip broadcast media ipfm nbm ptp precision time clock synchronization`

---

### Image Steganography
**ID:** `stego` | **Type:** Tool | **Offline**

**Description:** Hides messages inside PNG images using LSB (Least Significant Bit) embedding.

**Tabs:**

#### Encode (`tab: encode`)
**Inputs:**
- Carrier image: PNG or BMP (drag/drop or browse)
- Payload mode: Text message OR file(s)
- Optional AES-256-GCM passphrase (encrypts payload + shuffles pixel order via PBKDF2 seed)
- Capacity indicator shows bytes available vs. payload size

**Outputs:**
- Stego PNG download with payload embedded in LSBs
- Pixel-order shuffling when passphrase is set (passphrase-protected extraction required)

#### Decode (`tab: decode`)
**Inputs:**
- Stego image: PNG or BMP
- Optional passphrase (required if encoded with one)

**Outputs:**
- Extracted text message or file(s) download
- Decryption via AES-256-GCM if passphrase protected
- Error feedback for wrong passphrase, missing payload, or image too small

**Current Keywords:** `steganography lsb hide message image png secret embed extract stego invisible covert encode decode`

---

## Diagnostics & Tools

### DNS Lookup
**ID:** `dns` | **Type:** Tool | **Online**

**Description:** DNS resolution and query inspection across multiple query types and nameservers.

**Inputs:**
- Domain name or hostname
- Query type: A, AAAA, MX, NS, CNAME, TXT, SOA, SRV, SPF, CAA
- Optional: Custom nameserver (IP address)
- Optional: Recursive vs. non-recursive

**Outputs:**
- Query results with answer section
- Authority and additional records
- TTL for each record
- Query response time
- Nameserver used
- Export: JSON/CSV results

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `dns lookup query resolution a aaaa mx ns cname txt soa srv spf caa nameserver recursive`

---

### DNS Zone File Builder
**ID:** `dns-zone-builder` | **Type:** Tool | **Offline**

**Description:** Build and validate BIND-style DNS zone files offline. Supports $ORIGIN, default $TTL, SOA fields, date-based serial generation (RFC 1982), and dynamic resource records (A, AAAA, CNAME, MX, TXT, SRV, PTR, NS).

**Inputs:**
- $ORIGIN (zone origin domain)
- Default $TTL (time-to-live)
- SOA fields: primary nameserver (MNAME), responsible party (RNAME), serial (with RFC 1982-aware auto-increment or YYYYMMDDnn format), refresh, retry, expire, minimum
- Dynamic resource record list with type-specific value fields:
  - A, AAAA (address records)
  - CNAME (canonical name)
  - MX (mail exchange with preference)
  - TXT (text records)
  - SRV (service records)
  - PTR (pointer records for reverse DNS)
  - NS (nameserver records)

**Outputs:**
- Live-rendered zone file text
- Validation panel with errors + warnings:
  - Invalid IPv4/IPv6 addresses
  - CNAME-and-other-data conflicts
  - Missing MX preference values
  - SRV field validation
  - Non-FQDN target warnings
  - TTL consistency checks
- Copy zone file / download as .zone file

**Current Keywords:** `dns zone file builder bind soa serial rfc1035 rfc1982 a aaaa mx txt srv cname ns ptr records validate`

**Suggested Keywords to Add:** `zonefile authoritative resource record negative ttl mname rname incremental`

---

### WHOIS Lookup
**ID:** `whois` | **Type:** Tool | **Online**

**Description:** Domain registration and IP address ownership lookup.

**Inputs:**
- Domain name OR IP address
- Optional: Custom WHOIS server

**Outputs:**
- Domain registrant information (if public)
- Registrar, registration date, expiration
- Name servers
- For IPs: ASN, CIDR, RIR (ARIN/RIPE/APNIC/LACNIC/AfriNIC)
- Abuse contact email

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `whois lookup domain registrar registration expiration ip owner asn rir`

---

### Email Diagnostics
**ID:** `email-diag` | **Type:** Tool | **Online**

**Description:** Email header analysis, SPF/DKIM/DMARC validation, and server diagnostics.

**Tabs:**

#### Header Analyzer Tab
**Inputs:**
- Full email header (paste raw)

**Outputs:**
- From/To/Date parsing
- Route analysis (hops)
- SPF/DKIM/DMARC results
- Authentication-Results header
- Suspicious indicators (phishing risk, spoofing potential)

#### SPF/DKIM/DMARC Tab
**Inputs:**
- Domain name

**Outputs:**
- SPF record (v=spf1 mechanisms)
- DKIM selectors and public keys
- DMARC policy (p=reject/quarantine/none)
- Enforcement: subdomain handling, alignment

#### MX Lookup Tab
**Inputs:**
- Domain name

**Outputs:**
- MX records with priority
- SMTP connectivity test per MX
- TTL and nameserver info

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `email spf dkim dmarc header analysis phishing security authentication mail server`

---

### Syslog Builder & Parser
**ID:** `syslog-builder` | **Type:** Tool | **Offline**

**Description:** Build, parse, and reference syslog messages (RFC 5424 and RFC 3164) with facility/severity decoding and structured data support.

**Tabs:**

#### Build (`build`)
**Inputs:**
- Facility (0–23): kernel, user, mail, daemon, auth, syslog, lpr, news, uucp, cron, authpriv, local0–local7
- Severity (0–7): Emergency, Alert, Critical, Error, Warning, Notice, Informational, Debug
- Timestamp (RFC3339 format, defaults to "Now")
- Hostname
- App-name
- Procid (process ID or dash)
- Msgid (message ID or dash)
- Structured data (optional): SD-ID + key=value params (e.g., `[exampleSDID@32473 iut="3" eventSource="Application" eventID="1011"]`)
- Message text
- UTF-8 BOM toggle

**Outputs:**
- Assembled RFC 5424 message: `<PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID STRUCTURED-DATA MESSAGE`
- Computed PRI value (facility × 8 + severity)
- Copy message / download as .log

#### Parse (`parse`)
**Inputs:**
- Syslog message text (single or multiple lines)

**Outputs:**
- Auto-detection of RFC 5424 vs RFC 3164 format
- Decoded fields:
  - PRI (priority), facility, severity
  - Timestamp, hostname, application, process ID, message ID
  - Structured data (per SDID with all key=value pairs)
  - Message body
- Syntax validation (RFC compliance)

#### Reference (`reference`)
**Outputs:**
- Facility table (0–23 with descriptions)
- Severity table (0–7 with descriptions)
- RFC links and format reference

**Current Keywords:** `syslog rfc5424 rfc3164 facility severity priority pri structured data builder parser message logging build construct compose message parse decode extract analyze facility severity reference table codes rfc`

**Suggested Keywords to Add:** `log message local0 emergency debug nilvalue sd-id timestamp hostname app-name`

---

### Remote Ping / MTR
**ID:** `diag` | **Type:** Tool | **Online**

**Description:** Network latency and path tracing from server-side.

**Inputs:**
- Target IP or hostname
- Ping count (1-30)
- Packet size (32-1500 bytes)

**Outputs:**
- Round-trip time (min/avg/max/stddev)
- Packet loss percentage
- Hop-by-hop latency (if MTR mode enabled)
- Geolocation of hops
- Timeout indicators

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `ping latency rtt packet loss mtr traceroute hop diagnostic network path`

---

### Speed Test
**ID:** `speedtest` | **Type:** Tool | **Online**

**Description:** Download/upload bandwidth measurement and performance metrics.

**Inputs:**
- Test server selection (auto or manual)
- Protocol: HTTP, HTTPS, WebSocket

**Outputs:**
- Download speed (Mbps)
- Upload speed (Mbps)
- Latency (ms)
- Jitter
- Packet loss (if detectable)
- Connection type (detected)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `speed test bandwidth download upload latency jitter performance measurement`

---

### IP Geolocation
**ID:** `geo` | **Type:** Tool | **Online**

**Description:** Geographic location lookup for IP addresses.

**Inputs:**
- IP address or hostname

**Outputs:**
- Country, region, city
- Latitude, longitude
- ASN, organization
- ISP, connection type (residential/business)
- Time zone
- Map (if available via external API)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `geolocation geoip country city asn isp coordinates map`

---

### SSL/TLS Inspector
**ID:** `ssl` | **Type:** Tool | **Online**

**Description:** Certificate chain and TLS configuration analysis.

**Inputs:**
- Hostname:port or URL

**Outputs:**
- Certificate chain (root → leaf)
- Subject, Issuer, Validity
- Public key algorithm, key size
- SANs (Subject Alternative Names)
- Certificate transparency logs
- OCSP responder
- TLS version, cipher suites
- Warnings: self-signed, expired, mismatched domain, weak key
- Grade/score (like SSL Labs)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `ssl tls certificate chain inspection cipher security hostname validation crl ocsp`

---

### Security Headers
**ID:** `sechdrs` | **Type:** Tool | **Online**

**Description:** HTTP security header analysis and recommendations.

**Inputs:**
- URL to scan

**Outputs:**
- Detected security headers:
  - Strict-Transport-Security (HSTS)
  - Content-Security-Policy (CSP)
  - X-Frame-Options
  - X-Content-Type-Options
  - X-XSS-Protection
  - Referrer-Policy
  - Permissions-Policy
  - Others
- Missing headers (best practices)
- Grade/score and remediation suggestions

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `security headers http csp hsts x-frame-options best practices vulnerability`

---

### Redirect Checker
**ID:** `redircheck` | **Type:** Tool | **Online**

**Description:** HTTP redirect chain analysis and loop detection.

**Inputs:**
- URL to follow

**Outputs:**
- Redirect chain (all hops)
- Status codes (301/302/307/308)
- Location header values
- Final destination
- Redirect loop detection with warning
- Timing per redirect

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `redirect checker loop chain http status code follow url`

---

### Capture Toolkit
**ID:** `wireshark` | **Type:** Tool | **Online**

**Description:** Unified packet capture command builder and filter reference for tcpdump, tshark, Wireshark display filters, BPF capture filters, and a saved filter library.

**Tabs:**

#### tcpdump (`tcpdump`)
**Outputs:**
- Interactive tcpdump command builder (interface, snaplen, count, host/port/protocol filters)
- Output and write-to-file flags
- Copy-ready command

#### tshark (`tshark`)
**Outputs:**
- tshark command builder with field extraction (-T fields), decode-as, and follow-stream options
- Copy-ready command

#### Display Filter (`display`)
**Outputs:**
- Wireshark display filter builder and syntax reference
- Common protocol dissectors, coloring rule examples

#### Capture Filter (`capture`)
**Outputs:**
- BPF capture filter builder (host, port, proto, VLAN, direction)
- Copy-ready filter expression

#### Filter Library (`library`)
**Outputs:**
- Curated library of common capture and display filters
- Searchable by protocol / use-case

**Current Keywords:** `wireshark packet capture filter server tcpdump tshark bpf display filter pcap network analysis`

---

### Network Scanner
**ID:** `scanner` | **Type:** Tool | **Online**

**Description:** Port scanning and host discovery guidance (Nmap reference).

**Tabs:**

#### Port Scan Tab
**Inputs:**
- Target IP or range
- Port range (1-65535)
- Scan type: SYN, Connect, UDP, etc.

**Outputs:**
- Open/closed/filtered port status
- Service identification (if available)
- OS fingerprinting (if supported)

#### Host Discovery Tab
**Inputs:**
- Network range (CIDR)
- Ping type: ICMP, TCP, UDP

**Outputs:**
- Live hosts with response time
- Subnet summary

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `network scanner port scan nmap host discovery icmp tcp udp service identification`

---

### iPerf Command Builder
**ID:** `iperf` | **Type:** Tool | **Offline** (live execution available when self-hosted under Docker)

**Description:** Build iperf3 and iperf2 client and server commands with every common option, with a cheat sheet explaining the differences between the two versions. Generates ready-to-paste commands plus Docker run and docker-compose snippets so two servers in different locations can be deployed and tested against each other. When self-hosted under Docker, can start a live server and run live client throughput/jitter tests with streamed output.

**Tabs:**

#### Client (`client`)
**Inputs:**
- Host and port
- Protocol: TCP, UDP, SCTP (iperf3 only)
- Bandwidth limit
- Duration or byte/block limit (blocks: iperf3 only)
- Parallel streams (number of concurrent connections)
- Direction: normal, reverse/bidir (iperf3), dualtest/tradeoff/full-duplex (iperf2)
- Interval
- Advanced options: buffer length, window size, MSS, ToS/DSCP marking, omit duration (iperf3), congestion control algorithm (iperf3), title (iperf3), IPv4/IPv6, no-delay, zero-copy (iperf3), JSON output (iperf3), enhanced reporting (iperf2), CSV (iperf2)

**Preset Buttons (version-filtered):** TCP throughput, UDP jitter, reverse/bidir (iperf3) or dual test (iperf2), parallel, MTU discovery

**Outputs:**
- Generated client CLI command (iperf3 or iperf2 syntax)
- Docker run command for containerized execution
- Ready-to-paste command

#### Server (`server`)
**Inputs:**
- Port
- Bind address
- One-off or daemon mode
- Interval for statistics
- JSON output
- UDP-specific options
- IPv4/IPv6

**Preset Buttons:** Basic server, daemon mode

**Outputs:**
- Generated server CLI command
- Docker run command
- Docker compose YAML with server definition
- Docker compose snippets for client-server deployment

#### Cheat Sheet (`cheatsheet`)
**Outputs:**
- iperf2 vs iperf3 feature comparison table (binary names, protocol support, output formats, compatibility)
- Options reference: common flags and their meanings
- Common test scenarios with full command examples
- Installation commands for Linux, macOS, Windows, Docker
- Docker deploy snippets and deployment patterns
- Gotchas and known issues per version

**Current Keywords (parent):** `iperf iperf3 iperf2 bandwidth throughput network performance speed test`

**Sub-tool Keywords:**
- Client: `tcp udp sctp jitter packet loss client parallel streams reverse bidir`
- Server: `server daemon listen`
- Cheat Sheet: `cheatsheet reference flags options comparison benchmark`

---

### SNMP Command Builder
**ID:** `snmp-builder` | **Type:** Tool | **Offline**

**Description:** SNMP query command generation and OID reference.

**Inputs:**
- Device IP
- Community string (v1/v2c) or credentials (v3)
- OID or object name
- SNMP version: 1, 2c, 3

**Outputs:**
- snmpget/snmpwalk/snmptrap command lines
- MIB lookup (system, interfaces, IP-MIB, TCP-MIB, UDP-MIB, etc.)
- Common OID reference table
- Export: shell script

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `snmp query snmpget snmpwalk oid mib community string v3 monitoring`

---

### SysTool CLI Builder
**ID:** `systools` | **Type:** Tool | **Offline**

**Description:** Linux and Windows diagnostic command generation.

**Tabs:**

#### Linux Tab
**Commands:**
- Network: `ip addr`, `ip route`, `ss`, `netstat`, `ethtool`
- Process: `ps`, `top`, `lsof`
- Filesystem: `df`, `mount`, `lsblk`
- System: `uname`, `uptime`, `free`, `dmesg`

**Outputs:**
- Formatted command with options
- Export to shell script

#### Windows Tab
**Commands:**
- Network: `ipconfig`, `route`, `netstat`, `Get-NetAdapter`
- Process: `tasklist`, `Get-Process`
- Disk: `wmic logicaldisk`, `diskpart`
- System: `systeminfo`, `tasklist /svc`

**Outputs:**
- CMD or PowerShell format
- Export to batch/ps1 script

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `systool cli command builder linux windows diagnostic network process filesystem`

---

### CLI Quick Reference
**ID:** `cli-ref` | **Type:** Reference | **Offline**

**Description:** Quick-reference tables for common network CLI commands.

**Sections:**
- **Cisco IOS:** show commands, config, troubleshooting
- **Juniper JunOS:** show, configuration, debugging
- **Linux:** ip, ss, tcpdump, iptables, nmcli
- **Windows:** ipconfig, netstat, Get-NetAdapter
- **OpenWrt:** uci, logread, iwconfig
- **Arista EOS:** show, configuration

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `cli quick reference command cheat sheet cisco juniper linux windows`

---

### Port Reference
**ID:** `ports` | **Type:** Reference | **Offline**

**Description:** Common network service ports (TCP/UDP) with IANA registry lookup.

**Sections:**
- Well-known ports (0–1023)
- Registered ports (1024–49151)
- Dynamic/private ports (49152–65535)
- By protocol: HTTP, HTTPS, SSH, Telnet, SMTP, POP3, IMAP, DNS, DHCP, NTP, SNMP, VNC, RDP, MySQL, PostgreSQL, MongoDB, Redis

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `port reference service tcp udp well-known registered dynamic iana`

---

### Format Toolkit
**ID:** `jsonfmt` | **Type:** Tool | **Offline**

**Description:** Multi-format data converter, validator, and diff tool. Supports JSON, XML, YAML, CSV, TSV, TOML, INI, JSONL, Markdown tables, JSONPath queries, and side-by-side diff.

**Tabs:**

#### JSON (`json`)
**Inputs:** JSON text **Outputs:** Pretty-print / minify, validation with error location, convert to XML/YAML/CSV

#### XML (`xml`)
**Inputs:** XML text **Outputs:** Pretty-print / minify, schema validation, convert to JSON/YAML

#### YAML (`yaml`)
**Inputs:** YAML text **Outputs:** Validation, convert to JSON/XML, pretty-print

#### CSV (`csv`)
**Inputs:** CSV text **Outputs:** Table view, convert to JSON/YAML/XML

#### TSV (`tsv`)
**Inputs:** TSV text **Outputs:** Table view, convert to JSON/CSV

#### TOML (`toml`)
**Inputs:** TOML text **Outputs:** Pretty-print, convert to JSON/YAML

#### INI / Properties (`ini`)
**Inputs:** INI / .properties text **Outputs:** Key-value view, convert to JSON/YAML

#### JSONL (`jsonl`)
**Inputs:** Newline-delimited JSON **Outputs:** Per-line parse, convert to JSON array

#### Markdown (`markdown`)
**Inputs:** Markdown table **Outputs:** Convert to JSON/CSV

#### JSONPath Query (`jsonpath`)
**Inputs:** JSON + JSONPath expression **Outputs:** Matching nodes, copy results

#### Diff / Compare (`diff`)
**Inputs:** Two JSON/XML/YAML/TOML documents **Outputs:** Side-by-side diff, added/removed/changed keys highlighted

**Current Keywords:** `json xml yaml csv tsv toml ini jsonl markdown jsonpath diff format formatter beautify minify convert compare netconf restconf openconfig ansible frr bgp netplan kubernetes k8s`

---

### JWT Toolkit
**ID:** `jwt` | **Type:** Tool | **Offline**

**Description:** JWT token decoder and encoder. Decode and signature-verify existing tokens or build and sign new ones with custom headers, claims, and secrets.

**Tabs:**

#### Decode (`decode`)
**Inputs:** JWT token string, optional HMAC secret for signature verification
**Outputs:**
- Header (typ, alg, kid) — pretty-printed JSON
- Payload (all claims: sub, aud, iss, exp, iat, nbf, custom) — pretty-printed JSON
- Signature validity (valid / invalid / unverified)
- Token expiry status with human-readable relative time

#### Encode (`encode`)
**Inputs:**
- Header JSON (alg, typ, kid)
- Payload JSON (sub, aud, iss, exp, custom claims)
- HMAC secret (HS256/HS384/HS512) or note for RS256

**Outputs:**
- Signed JWT token string
- Copy button

**Current Keywords:** `jwt json web token decode encode verify sign signature hs256 rs256 claims payload header secure`

---

### Password Generator
**ID:** `passgen` | **Type:** Tool | **Offline**

**Description:** Secure password generation with customizable complexity.

**Inputs:**
- Length (8-128)
- Character types: uppercase, lowercase, digits, symbols
- Exclude ambiguous (0/O, l/I, 1, etc.)
- Passphrase mode (words instead of random)

**Outputs:**
- Generated passwords (multiple)
- Entropy estimate (bits)
- Strength indicator
- Copy button

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `password generator secure random entropy strength complexity`

---

### Data Unit Converter
**ID:** `dataunit` | **Type:** Tool | **Offline**

**Description:** Convert between data sizes, bandwidth rates, and time units.

**Tabs:**

#### Data Size Tab
**Conversions:** bytes ↔ KB/MB/GB/TB, binary (KiB/MiB/GiB) ↔ decimal (KB/MB/GB)

#### Bandwidth Tab
**Conversions:** bps, Kbps, Mbps, Gbps, Tbps ↔ bytes/sec, file download time

#### Time Tab
**Conversions:** seconds, minutes, hours, days, weeks

**Outputs:**
- All equivalent units displayed
- Copy per unit

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `unit converter data size bandwidth time kb mb gb bps kbps mbps`

---

### Hash Generator & Verifier
**ID:** `hashgen` | **Type:** Tool | **Offline**

**Description:** Generate and verify hashes (MD5, SHA-1, SHA-256, SHA-512, Blake3).

**Tabs:**

#### Generate Tab
**Inputs:**
- Text or file
- Algorithm selection: MD5, SHA-1, SHA-256, SHA-384, SHA-512, Blake3, HMAC variants

**Outputs:**
- Hash value (hex/base64)
- Copy button

#### Verify Tab
**Inputs:**
- Hash value and expected value
- Algorithm

**Outputs:**
- Match / no match indicator
- Algorithm confirmation

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `hash generator md5 sha-1 sha-256 sha-512 blake3 hmac verify integrity`

---

### Text & File Encryption
**ID:** `aescrypt` | **Type:** Tool | **Offline**

**Description:** AES-256-GCM encryption for text and files with passphrase support.

**Tabs:**

#### Text Encryption Tab
**Inputs:**
- Plaintext message
- Passphrase or key
- Key derivation: PBKDF2 iterations

**Outputs:**
- Encrypted text (NEK1 format or base64)
- Copy encrypted text

#### File Encryption Tab
**Inputs:**
- File upload
- Passphrase
- PBKDF2 iterations (adjustable for performance)

**Outputs:**
- Encrypted file download
- Capacity info

#### Decryption Tab
**Inputs:**
- Encrypted text/file
- Passphrase

**Outputs:**
- Decrypted result
- Copy or download

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `encryption aes-256-gcm passphrase pbkdf2 symmetric file text security`

---

### Regex Find & Replace
**ID:** `regex` | **Type:** Tool | **Offline**

**Description:** Regular expression matching and text replacement utility.

**Inputs:**
- Input text
- Regex pattern (with flags: case-insensitive, multiline, etc.)
- Replacement text (with capture group support: $1, $2, etc.)

**Outputs:**
- Matches found with line/column numbers
- Replaced text
- Replace all or selective
- Export results

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `regex regular expression find replace pattern matching capture group`

---

### Network Table Sorter
**ID:** `net-table-sorter` | **Type:** Tool | **Offline**

**Description:** Sorts pasted tables in network order while keeping every row intact: interfaces (`Eth1/2` before `Eth1/10`, `Gi` = `GigabitEthernet`), IPv4/IPv6 addresses and prefixes numerically (network, then prefix length), MACs across `:`/`-`/`.` formats, and hostnames naturally. Multi-column stable sort. Hands sorted rows to Regex Find & Replace for config generation.

**Inputs:**
- Table: TSV (Excel/Sheets), CSV, semicolon, pipe/Markdown, or whitespace-aligned CLI output
- Delimiter (auto-detected, overridable); header row (auto / yes / no)
- Sort keys: click header (asc → desc → off), shift-click for secondary keys, reorder list
- Interface type order: alphabetical or speed (Fa < Gi < Te < Twe < Fo < Hu)

**Outputs:**
- Sorted table with original line numbers; empty cells last in both directions; mixed columns IPv4 < IPv6 < other
- Copy as TSV, CSV, Markdown (header row included); share URL
- Send to Regex Find & Replace (Interfaces from Spreadsheet preset)

**Current Keywords:** `sort table natural interface ip ipv4 ipv6 cidr mac spreadsheet excel csv tsv markdown cabling schedule ipam column order`

**Suggested Keywords to Add:** _(none)_

---

### Config Redactor
**ID:** `config-redactor` | **Type:** Tool | **Offline**

**Description:** Pastes device configuration files or arbitrary text and redacts sensitive information such as passwords, hostnames, IP addresses, MAC addresses, SNMP strings, and API keys/tokens.

**Inputs:**
- Raw configuration or text
- Option to redact passwords of all kinds
- Option to obfuscate IPv4/IPv6 addresses (with options for consistent topology mapping and/or network portion shifting)
- Option to obfuscate hostnames
- Option to obfuscate MAC addresses
- Option to redact SNMP community strings and keys
- Option to redact API keys and tokens (AWS keys, bearer tokens, access/refresh tokens, environment variables, JSON/YAML key-value pairs, CLI patterns)
- Custom text/regex search and replace patterns

**Outputs:**
- Redacted/obfuscated configuration text
- Redaction audit log detailing what patterns were matched and what replacements were made
- Fast copy and file download options

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `redact config sanitize obfuscate mask password ip-obfuscation snmp key credential security api-key token bearer`

---


### Self-Signed Cert Generator
**ID:** `cert-gen` | **Type:** Tool | **Offline**

**Description:** Self-signed certificate generation for testing and internal use.

**Inputs:**
- Common Name (CN)
- Subject Alternative Names (SANs)
- Validity (days)
- Key size (2048/4096 bits RSA)
- Signature algorithm: SHA-256 with RSA

**Outputs:**
- PEM-formatted certificate
- Private key
- Download separate or combined (.pfx)
- Display fingerprint (SHA-256)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `self-signed certificate generation csr private key pem pfx testing`

---

### Certificate Chain Validator
**ID:** `cert-chain` | **Type:** Tool | **Online**

**Description:** Certificate chain validation and ECDSA/RSA signature verification.

**Inputs:**
- Certificate (PEM or DER)
- Root CA certificate (if not system CA)
- Hostname to verify

**Outputs:**
- Chain validation result
- Signature verification (valid/invalid)
- Common name, SANs, validity dates
- Key algorithm and size
- Certificate transparency status

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `certificate validation chain signature ecdsa rsa x.509 root ca intermediate`

---

### Cypher Deck
**ID:** `cypher` | **Type:** Tool | **Offline**

**Description:** Multi-format encoding/decoding toolkit for networking and security payloads. Handles Base64, Hex, Binary, URL Encoding, ROT13, and hashes.

**Tabs:**

#### Encode / Decode Tab
**Features:**
- **Bidirectional Conversion:** Text ↔ Base64 ↔ Hex ↔ Binary ↔ URL ↔ ROT13 ↔ ASCII
- **URL-safe Base64:** Toggle for `+`/`/` to `-`/`_` mapping and padding removal.
- **Aggressive URL Encode:** Option to encode all characters including alphanumeric.
- **Presets:** Quick-load samples for Hello World, Sample URL, JSON, Credentials, URL Params, and Special Chars.
- **Live Stats:** Character and byte counts for input.

#### Hash Generator Tab
**Features:**
- **Algorithms:** MD5, SHA-1, SHA-256, SHA-512.
- **HMAC Support:** Optional secret key for keyed-hash message authentication.
- **Input Modes:** Text or Hex input support.

#### JWT Decoder Tab
**Features:**
- **Part Breakdown:** Color-coded display of Header, Payload, and Signature.
- **JSON Validation:** Automatic parsing and formatting of claims.
- **Time Claims:** Live relative time conversion for `exp`, `iat`, `nbf` (e.g., "expired 2h ago").

#### XOR / Bitwise Tab
**Features:**
- **Bitwise Operations:** XOR, AND, OR, NOT.
- **Key Modes:** Repeat key (vigenere style) or single-pass.
- **Brute Force:** Single-byte XOR brute force analyzer with printable score ranking.

#### URL Query Breakdown (Contextual)
**Features:**
- Automatically appears when the decoded text looks like a URL or query string.
- Parses and displays key-value pairs in a readable grid.
- Individual copy buttons for specific parameters.

**Current Keywords:** `base64 url encode decode rot13 hex binary hash jwt xor cipher encoding decoding encoder decoder`

**Assessment:** Consolidated standalone Base64 and URL encoders into this toolkit. Added presets, URL-safe modes, and query breakdown features.

---

### Traffic / Load Generator
**ID:** `traffic-gen` | **Type:** Tool | **Online**

**Description:** Synthetic traffic generation for testing (TCP, UDP, HTTP).

**Inputs:**
- Target IP:port
- Protocol: TCP, UDP, HTTP
- Rate (packets/sec)
- Payload size
- Duration

**Outputs:**
- Generation status (sending)
- Packets sent, bytes transferred
- Estimated impact on network

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `traffic generator load test synthetic tcp udp http performance`

---

### Cisco Password Types
**ID:** `cisco-passwords` | **Type:** Reference | **Offline**

**Description:** Cisco password encryption types and formats.

**Types:**
- Type 0: Plaintext (never used)
- Type 5: MD5-based (enable secret, user passwords) — crackable
- Type 7: Proprietary Cisco (deprecated) — easily decoded
- Type 8: PBKDF2 (modern Cisco IOS XE 15.3+)
- Type 9: Scrypt (Cisco IOS XE 16+)
- RADIUS/TACACS+ external authentication

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `cisco password type 5 type 7 type 8 scrypt pbkdf2 md5 encryption`

---

### Config Diff Viewer
**ID:** `config-diff` | **Type:** Tool | **Offline**

**Description:** Side-by-side configuration comparison and change highlighting.

**Inputs:**
- Two configuration files (before/after)
- Optional: ignore whitespace, comments

**Outputs:**
- Diff view (added, removed, changed lines)
- Stats (additions, deletions)
- Export as unified diff

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `config diff comparison before after change highlight version control`

---

### SSH Config Generator
**ID:** `ssh-config` | **Type:** Tool | **Offline**

**Description:** OpenSSH config file generator and reference.

**Inputs:**
- Host name / IP
- Port, user, identity file
- Proxy settings
- Cipher/key exchange preferences

**Outputs:**
- SSH config stanza
- Copy/download as ~/.ssh/config entry
- Security hardening suggestions

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `ssh config openssh key identity port proxy hardening security`

---

### NX-API / Nexus Request Builder
**ID:** `nxapi-builder` | **Type:** Tool | **Offline**

**Description:** Cisco NX-OS REST API request builder.

**Inputs:**
- Device hostname/IP
- API endpoint path (e.g., `/api/v1/config/sys/intf`)
- Method: GET, POST, PUT, DELETE
- Payload (JSON)
- Authentication: username/password or token

**Outputs:**
- cURL command
- Python requests code
- Postman export
- Response preview (if executable)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `nxapi cisco nexus rest api request builder automation`

---

### Arista eAPI Builder
**ID:** `arista-api-builder` | **Type:** Tool | **Offline**

**Description:** Arista eAPI command builder and response parser.

**Inputs:**
- Device hostname/IP
- eAPI commands (show, config)
- Output format: text, json
- Authentication: username/password

**Outputs:**
- API request format
- Python script generator (using Arista Python SDK)
- Response preview

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `arista eapi api command builder automation python sdk`

---

### Cisco DNAC Builder
**ID:** `cisco-dnac-builder` | **Type:** Tool | **Offline**

**Description:** DNA Center API request and intent-based networking builder.

**Inputs:**
- DNAC controller IP
- API endpoint (network devices, sites, intents)
- Method, authentication
- Payload (intent template)

**Outputs:**
- REST API call syntax
- Python script (using dnacenter-api SDK)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `dnac dna center api intent automation network`

---

### LLDP / CDP Parser
**ID:** `lldp-cdp-parser` | **Type:** Tool | **Offline**

**Description:** LLDP and CDP neighbor data parsing and topology builder.

**Tabs:**

#### LLDP Parser Tab
**Inputs:**
- Raw LLDP output (paste from `show lldp neighbors`, etc.)

**Outputs:**
- Normalized neighbor table (chassis ID, port, system name, capabilities)
- Topology visualization (if multiple devices)

#### CDP Parser Tab
**Inputs:**
- Raw CDP output (paste from `show cdp neighbors`, etc.)

**Outputs:**
- Neighbor table (device ID, port, platform, IP)
- Topology visualization

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `lldp cdp parser neighbor topology discovery device`

---

### Routing Table Parser
**ID:** `routing-table-parser` | **Type:** Tool | **Offline**

**Description:** Parse and analyze routing tables from different vendors.

**Inputs:**
- Raw routing table output (Cisco `show ip route`, Juniper `show route`, Linux `ip route`)

**Outputs:**
- Normalized table (destination, metric, next hop, interface)
- Route count by protocol (static, BGP, OSPF, etc.)
- Longest prefix match lookup
- Export: CSV, JSON

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `routing table route parser bgp ospf static metric next hop`

---

### Tunnel / VPN Overhead Calculator
**ID:** `tunnel-overhead` | **Type:** Tool | **Offline**

**Description:** Encapsulation overhead estimation for VPNs, tunnels, and MPLS.

**Inputs:**
- Tunnel type: IPsec, GRE, Wireguard, VXLAN, MPLS, L2TP
- MTU of underlying network
- Encryption: ESP, AES-GCM, ChaCha20

**Outputs:**
- Encapsulation overhead (bytes)
- Effective MTU after encapsulation
- Fragmentation risk assessment
- Recommended underlying MTU

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `tunnel overhead vpn ipsec gre wireguard vxlan mpls mtu fragmentation`

---

### Country & Timezone Reference
**ID:** `country-tz` | **Type:** Reference | **Offline**

**Description:** Country codes (ISO 3166), timezones, and telecom data.

**Sections:**
- ISO 3166-1 (alpha-2, alpha-3, numeric)
- Timezones (UTC offsets, daylight saving)
- International calling codes
- Top-level domains (.com, .uk, etc.)
- Dialing prefixes for various countries

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `country timezone iso 3166 code utc offset daylight saving`

---

### ASCII Network Diagram
**ID:** `ascii-diagram` | **Type:** Tool | **Offline**

**Description:** Create ASCII art network diagrams and topologies.

**Inputs:**
- Predefined templates: 2-tier, 3-tier campus, hub-and-spoke, mesh
- Custom node names and connections

**Outputs:**
- ASCII diagram
- Export as text/SVG
- Copy to clipboard

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `ascii diagram network topology art text drawing visualization`

---

### Mermaid Network Diagram
**ID:** `mermaid-diagram` | **Type:** Tool | **Offline**

**Description:** Network topology visualization with 30+ topology presets (Mermaid diagram generator).

**Templates:**
- Spine-leaf fabric
- 3-tier campus (access/distribution/core)
- DMZ with firewall high-availability
- ZTNA (Zero Trust Network Access)
- MPLS backbone with CE/PE routers
- SD-WAN hub-and-spoke
- OSPF multi-area
- IPsec site-to-site VPN mesh
- DMVPN dynamic mesh
- Hybrid cloud (on-prem + AWS/Azure)
- Kubernetes cluster networking
- Docker overlay networks

**Inputs:**
- Topology preset selection
- Node names (routers, switches, firewalls, clouds)
- Link types (direct, redundant, MPLS, VPN)

**Outputs:**
- Mermaid diagram (SVG)
- Export: PNG, SVG, markdown embed
- Edit mode to add/remove nodes

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `mermaid diagram network topology visualization graph preset template`

---

### Ansible Inventory Converter
**ID:** `ansible-inventory` | **Type:** Tool | **Offline**

**Description:** Convert between Ansible inventory formats (INI, YAML, JSON, CSV).

**Tabs:**

#### INI to YAML Tab
**Inputs:**
- INI format inventory
**Outputs:**
- YAML format
- Preserves groups, variables, host_vars/group_vars

#### CSV to INI/YAML Tab
**Inputs:**
- CSV (header: hostname, ip, group, var1, var2)
**Outputs:**
- INI or YAML format

#### Variable Inheritance Tab
**Inputs:**
- Inventory with group and host variables
**Outputs:**
- Resolved variable values per host (showing which level each came from)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `ansible inventory converter ini yaml json csv group host variables`

---

### Docker / Podman Network Builder
**ID:** `docker-net-builder` | **Type:** Tool | **Offline**

**Description:** Docker and Podman network configuration and compose file generator.

**Tabs:**

#### Network Config Tab
**Inputs:**
- Network type: bridge, overlay, macvlan, ipvlan
- Network name, subnet
- Gateway, MTU

**Outputs:**
- Docker network create command
- Podman network create equivalent
- Docker Compose YAML snippet

#### Compose Generator Tab
**Inputs:**
- Multiple services (names, images, ports, volumes)
- Network type: host, bridge, custom overlay

**Outputs:**
- Full docker-compose.yml file
- Export for download

#### K8s CNI Comparison Tab
**Outputs:**
- Comparison table: Flannel, Calico, Weave, Cilium
- Use case guidance

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `docker podman network bridge overlay macvlan ipvlan compose kubernetes cni`

---

### Kubernetes Network Policy Builder
**ID:** `k8s-netpol-builder` | **Type:** Tool | **Offline**

**Description:** Interactive builder for Kubernetes `NetworkPolicy` manifests. Generates valid YAML with configurable ingress and egress rules based on pod selector labels, namespace selectors, IP blocks, and port/protocol constraints.

**Inputs:**
- Policy name and target namespace
- Pod selector (matchLabels key/value, or empty for all pods)
- Policy types: Ingress, Egress, or both
- Presets: Deny All, Allow Same Namespace, DB Isolation, Allow App-to-Service
- Ingress rules: source type (Pod Selector / Namespace Selector / Same Namespace / IP Block), label key/value, port, protocol (TCP/UDP/SCTP)
- Egress rules: destination type (same options), label key/value, port, protocol

**Outputs:**
- Live-generated `NetworkPolicy` YAML (`apiVersion: networking.k8s.io/v1`)
- Human-readable rule summary (plain text description of the effective policy)
- Copy to clipboard

**Current Keywords:** `kubernetes networkpolicy network policy yaml manifest pod selector ingress egress namespace container security rules`

**Suggested Keywords to Add:** `k8s cni calico cilium ipblock label matchlabels deny allow isolation microservices`

---

### Rack Elevation Designer
**ID:** `rack-elevation` | **Type:** Tool | **Offline**

**Description:** Visual rack elevation designer with power, weight, and airflow tracking.

**Inputs:**
- Rack height (U count)
- Equipment list: device name, height (U), power (W), weight (kg)
- Orientation: front/back

**Outputs:**
- ASCII rack elevation (front view)
- SVG rack diagram (visual)
- BOM (bill of materials) with totals
- Power summary (W), weight summary (kg), airflow (CFM)
- Export: ASCII, SVG, CSV (BOM)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `rack elevation designer bom bill of materials power weight airflow capacity`

---

### Hex Dump / ASCII Decoder
**ID:** `hex-dump` | **Type:** Tool | **Offline**

**Description:** Hexadecimal dump viewer with ASCII interpretation.

**Inputs:**
- Binary data (file or hex paste)

**Outputs:**
- Hex dump format (offset, hex values, ASCII)
- Copy hex or ASCII separately
- Search by hex pattern or ASCII string

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `hex hexdump dump ascii decoder binary data offset`

---

### Terraform Snippet Builder
**ID:** `terraform-builder` | **Type:** Tool | **Offline**

**Description:** Generate ready-to-use HCL resource blocks for Cisco (ACI, ASA, Nexus/DCNM), AWS VPC, Azure VNet, and GCP networks. Select a provider and resource preset, fill in parameters, and copy or download the `.tf` file.

**Providers:**

#### AWS VPC (`aws`)
**Resources:** VPC with public/private subnets & SG, VPC only, Subnet, Security Group, Transit Gateway, NAT Gateway, VPC Peering, ALB

#### Azure VNet (`azure`)
**Resources:** VNet with subnets, VNet only, NSG, AKS cluster, Application Gateway, Private Endpoint, Azure Firewall

#### GCP Compute Network (`gcp`)
**Resources:** VPC (custom subnets + firewall), VPC only, Subnetwork, Firewall rule

#### Cisco ACI (`aci`)
**Resources:** Full App Stack (Tenant + VRF + BD + EPG), Tenant, VRF, Bridge Domain, Application EPG, Contract, L3Out

#### Cisco ASA (`asa`)
**Resources:** Access Control Rules & Objects, Static Route, NAT rule

#### Cisco Nexus / DCNM (`nexus`)
**Resources:** Fabric Network & VRF (DCNM), BGP peer config

**Outputs:**
- Generated HCL code block with provider config + resource definitions
- Parameterised inputs (pre-filled with realistic defaults)
- Copy snippet / download as `.tf` file

**Current Keywords:** `terraform provider snippet builder hcl resource infrastructure-as-code iac aws vpc subnet security group tgw nat alb peering azure vnet nsg aks app gateway private endpoint firewall azurerm gcp google subnetwork compute cisco aci tenant vrf bd epg contract l3out asa access rules nat static route nexus dcnm vxlan fabric bgp`

---

### Radius TACACS Reference
**ID:** `radius-tacacs-ref` | **Type:** Reference | **Offline**

**Description:** RADIUS and TACACS+ protocol reference.

**Sections:**
- RADIUS (RFC 2865): request/response, attributes, accounting
- TACACS+ (Cisco proprietary): authentication/authorization/accounting separation
- Comparison table
- Common attribute/AV-pair examples

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `radius tacacs aaa authentication authorization accounting rfc`

---

### Uptime & SLA Calculator
**ID:** `uptime` | **Type:** Tool | **Offline**

**Description:** Calculate allowed downtime budget for SLA percentages, cumulative availability across multiple components, and the impact of a specific outage duration.

**Tabs:**

#### SLA → Downtime Tab
**Inputs:**
- SLA target percentage (e.g. `99.9%`)
- Measurement period (Year, Quarter, Month, Week, Day)
- Quick preset buttons for nines levels (90% to 99.99999%)

**Outputs:**
- Allowed downtime duration (days, hours, minutes, seconds, milliseconds)
- Allowed downtime percentages and breakdown
- Reference table displaying year/month/week downtime across all nines levels

#### Composite SLA Tab
**Inputs:**
- Unlimited components/segments list (e.g. ISP, firewall, switch, server)
- Individual SLA percentages per component

**Outputs:**
- Cumulative end-to-end composite availability percentage
- Cumulative maximum allowed downtime breakdown per period (Year, Month, Week, Day)

#### Outage Impact Tab
**Inputs:**
- Target SLA percentage
- Actual outage duration (hours, minutes, seconds)
- Measurement period selection

**Outputs:**
- Actual SLA achieved this period
- Total allowed downtime budget
- Remaining downtime budget
- Clear breach detection indicator and explanation

**Current Keywords:** `uptime calculator sla downtime availability composite outage impact budget breach`

**Suggested Keywords to Add:** `sla downtime calculator availability nines composite sla outage budget tracker breach check`

---

### Erlang B / C Voice Trunk Sizer
**ID:** `erlang-trunk` | **Type:** Tool | **Offline**

**Description:** Sizes voice circuits from offered traffic and a target grade of service using the numerically stable Erlang B recursion, runs the same model backwards to read blocking off a circuit count you already have, and covers queued contact-centre trunks with Erlang C. Replaces the printed Erlang B table. One Erlang is one busy circuit — one concurrent SIP session, or one DS0 on a PRI; there is no access-technology selector because the arithmetic does not have one.

**Tabs:**

#### Size (`activeTab: size`)
**Inputs:**
- Offered load, entered either directly in Erlangs or as BHCA × mean hold time (seconds or minutes; `A = BHCA × T ÷ 3600`)
- Direction: load → circuits, or circuits → blocking
- Target grade of service: `P.01`, `P.001`, or a custom blocking fraction
- Circuit count (inverse direction only)

**Outputs:**
- Circuits required, or blocking probability at the configured count
- Blocking at the sized count and at one circuit lower, as a percentage and in exponential notation
- Carried load, lost load, trunk efficiency
- Erlang B table for ±3 circuits around the answer, with a meets/misses target flag per row
- Review hints: small-group efficiency, large-group Engset caveat, aggregate-load caveat, loose GoS target
- Copy All (header row + metric block + table block, tab-separated)

#### Erlang C (`activeTab: erlangc`)
**Inputs:**
- Server / trunk count
- Mean handle time (seconds)
- Answer target (seconds)
- Offered load is taken from the Size tab — it is not re-entered here

**Outputs:**
- Server utilisation, probability of waiting
- Average wait across all calls and across the delayed calls only
- Service level: share of calls answered within the answer target
- Explicit unstable-queue message with the minimum stable server count when servers ≤ offered load (never `NaN`, never `Infinity`)
- Copy All with a header row

#### Reference (`activeTab: reference`)
**Outputs:**
- Erlang B vs Erlang C comparison: what happens to a blocked call, what each sizes, typical use, key assumption
- Unit definitions: Erlang, BHCA, mean hold time, grade of service, P-notation
- Worked example: 200 BHCA × 180 s = 10.0 E; at P.01 the answer is 18 circuits (blocking 0.714% at 18, 1.295% at 17)
- The recursion itself, stated

**Not covered here:** availability and downtime budgets (see [Uptime & SLA Calculator](#uptime--sla-calculator)), codec bit rate and link sizing (see Bandwidth & Throughput and the TCP Throughput Estimator), voice RSSI and airtime (see Wireless & RF Planner), DSCP marking and MOS estimation (see QoS & DSCP Tool). No SIP, CUBE, or PRI configuration is generated.

**Current Keywords:** `erlang trunk sizing voice telephony circuits sip sessions ds0 pri concurrent calls blocking grade of service gos busy hour bhca`

---

### IP SLA / TWAMP Probe Builder
**ID:** `ipsla-twamp` | **Type:** Tool | **Offline**

**Description:** Generates persistent synthetic-probe configuration — Cisco IP SLA operations (ICMP echo, UDP jitter with an optional codec profile, HTTP, DNS) with frequency/timeout/threshold, a lifetime and schedule, an optional track object binding and an optional reaction, plus TWAMP sender and reflector sessions for Cisco IOS-XE and Juniper Junos in full and Light modes. Also sizes what a UDP jitter probe costs the link it measures. Configuration only — no probe is run from the browser.

**Tabs:**

#### IP SLA (`activeTab: ipsla`)
**Inputs:**
- Operation number; probe type (icmp-echo, udp-jitter, http, dns)
- Target, destination port (udp-jitter), name server (dns), URL (http)
- Codec profile (`g711alaw`, `g711ulaw`, `g729a`) or raw packet count / size / interval; optional advantage factor
- Source address or source interface, VRF
- Frequency (s), timeout (ms), threshold (ms), tag, owner, optional enhanced history
- Lifetime (forever or fixed) and start time (now or after hh:mm:ss)
- Optional track object: number, reachability or state, delay down/up
- Optional reaction: monitored element, rising/falling thresholds, threshold type, action

**Outputs:**
- Cisco IOS / IOS-XE configuration block: operation, schedule, track, reaction, verify comments
- Separate far-end `ip sla responder` block for UDP jitter
- Probe budget: L3 packet size, in-burst packet and bit rate, burst duration, averaged rate, duty cycle (Copy All with a header row)
- Review hints: responder requirement, duty cycle, ICMP punt caveat, inert threshold, track damping, VRF reachability, trap prerequisites
- `.txt` export

#### TWAMP (`activeTab: twamp`)
**Inputs:**
- Vendor (Cisco IOS-XE, Juniper Junos), role (sender, reflector), mode (full, Light)
- Server address, test target, control port, test port
- Control-connection and test-session names, history size
- Probe count, probe interval, test interval, padding / data size
- Client list name and allowed client prefix (server), control inactivity timer and reflector timeout (Cisco)

**Outputs:**
- Cisco IOS-XE `ip sla server twamp` + `ip sla responder twamp` reflector block
- Junos `set services rpm twamp client` / `server` blocks, full and Light
- An explicit "not supported, nothing generated" block for the two Cisco cells that have no CLI (sender role, Light mode)
- Review hints: role support, Light has no negotiation, padding is the sender's, clock sync only matters for the one-way split
- `.txt` export

#### Reference (`activeTab: reference`)
**Outputs:**
- IP SLA vs TWAMP vs OWAMP comparison (standard, what it measures, direction, clock requirement, interoperability, control plane, use case)
- Round-trip vs one-way delay, and why one-way inherits clock offset
- Threshold interpretation: frequency, timeout, threshold, rising/falling, threshold types
- What consumes a probe: track objects, HSRP, EEM, SNMP traps and collectors
- Worked example: G.711 probe cost arithmetic
- Cross-links to Remote Ping / MTR, iPerf, Uptime & SLA, QoS / DSCP, NTP toolkit, Flow Export

**Current Keywords:** `ip sla ipsla twamp owamp synthetic probe icmp-echo udp-jitter http dns operation responder reflector sender track object reaction threshold frequency schedule cisco ios-xe juniper junos rpm sla monitoring`

**Suggested Keywords to Add:** _(none)_

---

### Flow Export Builder
**ID:** `flow-export` | **Type:** Tool | **Offline**

**Description:** Generates NetFlow, IPFIX, and sFlow exporter configuration for six platforms, sizes the flow cache against a link's sampled packet rate, and carries a reference for the four export protocols.

**Tabs:**

#### Config Builder (`builder`)
**Inputs:**
- Vendor / platform: Cisco IOS Classic, Cisco IOS Flexible NetFlow, Cisco IOS-XR, Juniper Junos, Arista EOS, Linux softflowd
- Export version (filtered per platform): NetFlow v5, NetFlow v9, IPFIX, sFlow
- Monitored interface(s) — comma or newline separated
- Export source interface (loopback recommended)
- Collector IP and UDP port (defaults 2055 / 9995 / 4739 / 6343 by version)
- Capture direction: ingress, egress, or both
- Sample rate 1:N, active timeout, inactive timeout, flow cache entries
- Monitor / instance name

**Outputs:**
- Device configuration for the selected platform, with per-interface stanzas and a sampler block when N > 1
- Copy to clipboard
- Export as `.txt`

#### Sampler Calculator (`sampler`)
**Inputs:**
- Interface line rate — preset (10M / 100M / 1G / 10G / 25G / 40G / 100G / 400G) or manual bps
- Average packet size (bytes)
- Sample rate 1:N
- Active and inactive timeouts (seconds)
- Flow fanout (flows/s before sampling)

**Outputs:**
- Line-rate and post-sampling packet rate (pps)
- Exported flow rate (flows/s)
- Export bandwidth estimate (bps, ~50 bytes per exported flow)
- Concurrent active flows and recommended cache size (30% headroom)
- Colour-coded safe / caution / overload badges, with timer and cache warnings
- Copy All (tab-separated, with header row)

#### Protocol Reference (`reference`)
**Outputs:**
- NetFlow v5 vs v9 vs IPFIX vs sFlow comparison (standard, record format, IPv6, extensibility, transport, sampling, default port, vendor support)
- NetFlow v5 fixed record field table
- Common NetFlow v9 / IPFIX Information Elements
- sFlow datagram structure
- Well-known collector ports: 2055, 9995/9996, 4739, 4740, 6343
- IPFIX vs NetFlow v9 notes (RFC 7011 vs RFC 3954, variable-length fields, enterprise IEs)

**Current Keywords:** `netflow ipfix sflow flow export collector jflow sampling telemetry cisco juniper arista softflowd`

---

## Education & Entertainment

### Network Arcade
**ID:** `net-arcade` | **Type:** Tool | **Offline**

**Description:** Interactive learning games for network protocols and subnetting.

**Games:**

#### PACKET RAIN (`packet-rain`)
**Gameplay:**
- Falling protocol packets (IP, TCP, UDP, ICMP, DNS, HTTP)
- Classify by protocol type or layer
- Level progression: Level 1 (basic), each level 3000 points
- Difficulty increases with speed

**Learning Outcome:**
- Protocol recognition, OSI layer familiarity

#### SUBNET SPRINT (`subnet-ipv4`)
**Gameplay:**
- Rapid-fire CIDR math questions
- Questions: "How many hosts in 192.168.0.0/25?"
- Timed rounds, score tracking
- Difficulty: easy (common /24, /16), hard (/30, /32)

**Learning Outcome:**
- Subnet math fluency, CIDR notation mastery

#### IPv6 GAUNTLET (`subnet-ipv6`)
**Gameplay:**
- IPv6 address type classification, hex compression
- Questions: "Compress fe80:0000:0000:0000:..."
- Scoring based on speed and accuracy

**Learning Outcome:**
- IPv6 address format, notation skills

**Features Across All Games:**
- Leaderboard
- Sound on/off toggle
- Difficulty settings
- Progress tracking

**Current Keywords:** `arcade game learning education interactive quiz packet rain protocol layer classification drag drop reflexes subnet sprint ipv4 cidr subnetting math ipv6 gauntlet compress expand eui-64 prefix`

---

## Summary

**Registry (source of truth):** 130 top-level entries in `components/app.jsx` — 116 tools, 14 references.

**This catalog:** 126 `###` headings.

**Heading counts in this file** (not registry `group:` values):

- IPv4 Subnet & Addressing — 9
- IPv6 — 2
- Cross-Version Addressing — 5
- Multicast Toolkit — 1
- Switching & Layer 2 — 12
- Routing & Layer 3 — 15
- Infrastructure, QoS & Planning — 24
- Media & Broadcast — 2
- Diagnostics & Tools — 54
- Education & Entertainment — 1

**Catalog drift vs the registry:** seven registry ids have no `###` heading (`subnet-slicer` — documented as a `####` tab of Subnetting Planner; `bandwidth`, `cipher-suite`, `tsconv`, `cronparse`, `uaparse`, `config-template`). Two leftover headings are not in the registry (`wlan-tool` — use `wifi-rf-planner`; `radius-tacacs-ref` — duplicate of `radius-tacacs`). Remaining `**ID:**` tokens match the registry except those leftover headings and the seven missing headings.

