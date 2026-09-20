const { useState, useEffect, useCallback, useRef, useMemo } = React;

/* ── Mermaid loader (shared, offline-capable: local-first → CDN fallback) ── */

/* ── Preset templates ── */
const MERMAID_PRESETS = [
  {
    group: 'Data Center Fabric',
    templates: [
      {
        id: 'spine-leaf-2-4',
        label: 'Spine-Leaf (2 Spines, 4 Leaves)',
        code: `graph TD
    subgraph Spines
        SP1[Spine-01]
        SP2[Spine-02]
    end
    subgraph Leaves
        LF1[Leaf-01]
        LF2[Leaf-02]
        LF3[Leaf-03]
        LF4[Leaf-04]
    end
    SP1 --- LF1
    SP1 --- LF2
    SP1 --- LF3
    SP1 --- LF4
    SP2 --- LF1
    SP2 --- LF2
    SP2 --- LF3
    SP2 --- LF4
    LF1 -. Servers .-> SRV1[(Server Pool A)]
    LF2 -. Servers .-> SRV2[(Server Pool B)]
    LF3 -. Servers .-> SRV3[(Server Pool C)]
    LF4 -. Servers .-> SRV4[(Server Pool D)]
    style SP1 fill:#1e40af,stroke:#3b82f6,color:#fff
    style SP2 fill:#1e40af,stroke:#3b82f6,color:#fff
    style LF1 fill:#065f46,stroke:#10b981,color:#fff
    style LF2 fill:#065f46,stroke:#10b981,color:#fff
    style LF3 fill:#065f46,stroke:#10b981,color:#fff
    style LF4 fill:#065f46,stroke:#10b981,color:#fff`,
      },
      {
        id: 'spine-leaf-3-6',
        label: 'Spine-Leaf (3 Spines, 6 Leaves)',
        code: `graph TD
    subgraph Spines
        SP1[Spine-01]
        SP2[Spine-02]
        SP3[Spine-03]
    end
    subgraph Leaves
        LF1[Leaf-01]
        LF2[Leaf-02]
        LF3[Leaf-03]
        LF4[Leaf-04]
        LF5[Leaf-05]
        LF6[Leaf-06]
    end
    SP1 --- LF1
    SP1 --- LF2
    SP1 --- LF3
    SP1 --- LF4
    SP1 --- LF5
    SP1 --- LF6
    SP2 --- LF1
    SP2 --- LF2
    SP2 --- LF3
    SP2 --- LF4
    SP2 --- LF5
    SP2 --- LF6
    SP3 --- LF1
    SP3 --- LF2
    SP3 --- LF3
    SP3 --- LF4
    SP3 --- LF5
    SP3 --- LF6
    style SP1 fill:#1e40af,stroke:#3b82f6,color:#fff
    style SP2 fill:#1e40af,stroke:#3b82f6,color:#fff
    style SP3 fill:#1e40af,stroke:#3b82f6,color:#fff
    style LF1 fill:#065f46,stroke:#10b981,color:#fff
    style LF2 fill:#065f46,stroke:#10b981,color:#fff
    style LF3 fill:#065f46,stroke:#10b981,color:#fff
    style LF4 fill:#065f46,stroke:#10b981,color:#fff
    style LF5 fill:#065f46,stroke:#10b981,color:#fff
    style LF6 fill:#065f46,stroke:#10b981,color:#fff`,
      },
      {
        id: 'spine-leaf-border',
        label: 'Spine-Leaf with Border Leaf',
        code: `graph TD
    subgraph Spines
        SP1[Spine-01]
        SP2[Spine-02]
    end
    subgraph Leaves
        LF1[Leaf-01]
        LF2[Leaf-02]
        LF3[Leaf-03]
        LF4[Leaf-04]
        BL1[Border Leaf-01]
        BL2[Border Leaf-02]
    end
    SP1 --- LF1 & LF2 & LF3 & LF4 & BL1 & BL2
    SP2 --- LF1 & LF2 & LF3 & LF4 & BL1 & BL2
    BL1 --- FW1[Firewall / WAN]
    BL2 --- FW1
    style SP1 fill:#1e40af,stroke:#3b82f6,color:#fff
    style SP2 fill:#1e40af,stroke:#3b82f6,color:#fff
    style BL1 fill:#7c3aed,stroke:#a78bfa,color:#fff
    style BL2 fill:#7c3aed,stroke:#a78bfa,color:#fff`,
      },
    ],
  },
  {
    group: 'Campus Switching',
    templates: [
      {
        id: 'core-dist-access',
        label: 'Core–Distribution–Access (3-Tier)',
        code: `graph TD
    subgraph Core
        CR1[Core-SW-01]
        CR2[Core-SW-02]
    end
    subgraph Distribution
        DS1[Dist-SW-01]
        DS2[Dist-SW-02]
        DS3[Dist-SW-03]
        DS4[Dist-SW-04]
    end
    subgraph Access
        AC1[Access-SW-01]
        AC2[Access-SW-02]
        AC3[Access-SW-03]
        AC4[Access-SW-04]
    end
    CR1 --- DS1 & DS2
    CR2 --- DS3 & DS4
    CR1 <--> CR2
    DS1 --- AC1 & AC2
    DS2 --- AC1 & AC2
    DS3 --- AC3 & AC4
    DS4 --- AC3 & AC4
    style CR1 fill:#1e40af,stroke:#3b82f6,color:#fff
    style CR2 fill:#1e40af,stroke:#3b82f6,color:#fff
    style DS1 fill:#7c3aed,stroke:#a78bfa,color:#fff
    style DS2 fill:#7c3aed,stroke:#a78bfa,color:#fff
    style DS3 fill:#7c3aed,stroke:#a78bfa,color:#fff
    style DS4 fill:#7c3aed,stroke:#a78bfa,color:#fff`,
      },
      {
        id: 'collapsed-core',
        label: 'Collapsed Core–Access (2-Tier)',
        code: `graph TD
    subgraph Core["Collapsed Core"]
        CR1[Core-SW-01]
        CR2[Core-SW-02]
    end
    subgraph Access
        AC1[Access-SW-01]
        AC2[Access-SW-02]
        AC3[Access-SW-03]
        AC4[Access-SW-04]
    end
    CR1 <--> CR2
    CR1 --- AC1 & AC2 & AC3
    CR2 --- AC2 & AC3 & AC4
    style CR1 fill:#1e40af,stroke:#3b82f6,color:#fff
    style CR2 fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
      {
        id: 'single-switch',
        label: 'Single Switch (Small Office)',
        code: `graph TD
    SW1[Core-SW-01] --> PC1[Workstation-01]
    SW1 --> PC2[Workstation-02]
    SW1 --> PC3[Workstation-03]
    SW1 --> AP1[AP-01]
    SW1 --> PRT[Printer]
    SW1 --> RTR[Router / Gateway]
    style SW1 fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
      {
        id: 'campus-full',
        label: 'Campus with WAN Edge',
        code: `graph TD
    WAN[Internet / WAN]
    FW[Edge Firewall]
    subgraph Core
        CR1[Core-SW-01]
        CR2[Core-SW-02]
    end
    subgraph Distribution["Distribution — Building A"]
        DS1[Dist-SW-01]
        DS2[Dist-SW-02]
    end
    subgraph Access["Access — Floor 1 / 2"]
        AC1[Access-SW-01]
        AC2[Access-SW-02]
        AC3[Access-SW-03]
        AC4[Access-SW-04]
    end
    WAN --> FW
    FW --> CR1 & CR2
    CR1 <--> CR2
    CR1 --- DS1 & DS2
    CR2 --- DS1 & DS2
    DS1 --- AC1 & AC2
    DS2 --- AC3 & AC4
    style FW fill:#991b1b,stroke:#ef4444,color:#fff
    style CR1 fill:#1e40af,stroke:#3b82f6,color:#fff
    style CR2 fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
    ],
  },
  {
    group: 'Firewall & Security',
    templates: [
      {
        id: 'fw-dmz',
        label: 'Single Firewall DMZ',
        code: `graph LR
    INET([Internet])
    FW{Firewall}
    subgraph DMZ
        WEB[Web Server]
        MAIL[Mail Relay]
        DNS[DNS Server]
    end
    subgraph LAN
        PC1[Workstations]
        SRV[Internal Servers]
    end
    INET -->|untrust| FW
    FW -->|dmz| DMZ
    FW -->|trust| LAN
    style FW fill:#991b1b,stroke:#ef4444,color:#fff
    style INET fill:#374151,stroke:#6b7280,color:#fff`,
      },
      {
        id: 'fw-dual-dmz',
        label: 'Dual Firewall DMZ',
        code: `graph LR
    INET([Internet])
    FW1{Ext Firewall}
    subgraph DMZ
        WEB[Web / App Servers]
        PROXY[Reverse Proxy]
    end
    FW2{Int Firewall}
    subgraph LAN
        SRV[Internal Servers]
        DB[(Database)]
        PC[Workstations]
    end
    INET -->|untrust| FW1
    FW1 -->|dmz| DMZ
    DMZ -->|semi-trust| FW2
    FW2 -->|trust| LAN
    style FW1 fill:#991b1b,stroke:#ef4444,color:#fff
    style FW2 fill:#7c3aed,stroke:#a78bfa,color:#fff
    style INET fill:#374151,stroke:#6b7280,color:#fff`,
      },
      {
        id: 'fw-ha',
        label: 'Firewall HA (Active/Standby)',
        code: `graph TD
    INET([Internet])
    RTR[Edge Router]
    subgraph HA["Firewall HA Pair"]
        FW1{FW-01 Active}
        FW2{FW-02 Standby}
        FW1 <-->|HA Sync| FW2
    end
    SW1[Inside Switch]
    subgraph Zones
        DMZ[DMZ Segment]
        LAN[LAN Segment]
        MGMT[MGMT Segment]
    end
    INET --> RTR
    RTR --> FW1
    RTR --> FW2
    FW1 --> SW1
    FW2 --> SW1
    SW1 --> DMZ
    SW1 --> LAN
    SW1 --> MGMT
    style FW1 fill:#991b1b,stroke:#ef4444,color:#fff
    style FW2 fill:#374151,stroke:#6b7280,color:#fff`,
      },
      {
        id: 'fw-ngfw-zones',
        label: 'NGFW with Security Zones',
        code: `graph LR
    subgraph Untrust["Zone: Untrust"]
        INET([Internet])
        ISP[ISP Router]
    end
    FW{NGFW}
    subgraph DMZ["Zone: DMZ"]
        WEB[Web Server]
        APP[App Server]
    end
    subgraph Trust["Zone: Trust"]
        LAN[User LAN]
        IOT[IoT Segment]
    end
    subgraph Mgmt["Zone: Management"]
        MGMT[Out-of-Band Mgmt]
    end
    INET --> ISP --> FW
    FW -->|policy: dmz-rules| DMZ
    FW -->|policy: trust-rules| Trust
    FW -->|policy: mgmt-rules| Mgmt
    style FW fill:#991b1b,stroke:#ef4444,color:#fff`,
      },
      {
        id: 'fw-zpa',
        label: 'Zero Trust / ZTNA Architecture',
        code: `graph LR
    USERS([Remote Users])
    IDP[Identity Provider]
    ZTA{ZTA Broker / Cloud}
    subgraph Apps["Internal Apps"]
        APP1[App Server A]
        APP2[App Server B]
        DB[(Database)]
    end
    subgraph Connector["App Connectors - No inbound FW rules"]
        CON[ZTA Connector]
    end
    USERS -->|1 Auth request| IDP
    IDP -->|2 Token| USERS
    USERS -->|3 Encrypted tunnel| ZTA
    ZTA -->|4 Proxy session| CON
    CON --> APP1 & APP2 & DB
    style ZTA fill:#991b1b,stroke:#ef4444,color:#fff
    style IDP fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
    ],
  },
  {
    group: 'WAN & Routing',
    templates: [
      {
        id: 'wan-hub-spoke',
        label: 'Hub-and-Spoke WAN',
        code: `graph TD
    HUB["Hub Site\n(HQ / DC)"]
    SP1[Branch-01]
    SP2[Branch-02]
    SP3[Branch-03]
    SP4[Branch-04]
    SP5[Branch-05]
    HUB <-->|WAN| SP1
    HUB <-->|WAN| SP2
    HUB <-->|WAN| SP3
    HUB <-->|WAN| SP4
    HUB <-->|WAN| SP5
    style HUB fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
      {
        id: 'wan-hub-spoke-redundant',
        label: 'Hub-Spoke with Dual WAN',
        code: `graph TD
    HUB["Hub — HQ"]
    subgraph Branch1["Branch-01"]
        RTR1[Router-01]
        INET1([ISP-1 MPLS])
        INET2([ISP-2 Broadband])
    end
    subgraph Branch2["Branch-02"]
        RTR2[Router-02]
        INET3([ISP-1 MPLS])
        INET4([ISP-2 LTE])
    end
    RTR1 <-->|primary| INET1 --> HUB
    RTR1 <-->|backup| INET2 --> HUB
    RTR2 <-->|primary| INET3 --> HUB
    RTR2 <-->|backup| INET4 --> HUB
    style HUB fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
      {
        id: 'wan-mpls-vpn',
        label: 'MPLS L3VPN (PE-CE)',
        code: `graph LR
    subgraph Customer["Customer Sites"]
        CE1[CE Router\nSite A]
        CE2[CE Router\nSite B]
        CE3[CE Router\nSite C]
    end
    subgraph MPLS["MPLS Provider Network"]
        PE1[PE Router]
        P1[P Router]
        P2[P Router]
        PE2[PE Router]
        PE3[PE Router]
    end
    CE1 <-->|eBGP / Static| PE1
    CE2 <-->|eBGP / Static| PE2
    CE3 <-->|eBGP / Static| PE3
    PE1 <-->|LDP/RSVP| P1
    P1 <-->|LDP/RSVP| P2
    P2 <-->|LDP/RSVP| PE2
    P2 <-->|LDP/RSVP| PE3
    PE1 <-.->|MP-BGP VPNv4| PE2
    PE1 <-.->|MP-BGP VPNv4| PE3
    style P1 fill:#374151,stroke:#6b7280,color:#fff
    style P2 fill:#374151,stroke:#6b7280,color:#fff`,
      },
      {
        id: 'wan-sdwan',
        label: 'SD-WAN Overlay',
        code: `graph TD
    ORCH[SD-WAN Orchestrator\n/ vManage]
    subgraph HQ["HQ Data Center"]
        vSmart[vSmart Controller]
        vBond[vBond Orchestrator]
        vEdge0[vEdge / cEdge]
    end
    subgraph Branch1["Branch — Site A"]
        vEdge1[vEdge / cEdge]
        LAN1[LAN]
    end
    subgraph Branch2["Branch — Site B"]
        vEdge2[vEdge / cEdge]
        LAN2[LAN]
    end
    ORCH --- vSmart & vBond
    vBond <-->|DTLS/TLS| vEdge0 & vEdge1 & vEdge2
    vSmart <-->|OMP| vEdge0 & vEdge1 & vEdge2
    vEdge1 <-->|BFD Tunnel\nIPsec| vEdge0
    vEdge2 <-->|BFD Tunnel\nIPsec| vEdge0
    vEdge1 <-->|BFD Tunnel\nIPsec| vEdge2
    vEdge1 --- LAN1
    vEdge2 --- LAN2
    style ORCH fill:#1e40af,stroke:#3b82f6,color:#fff
    style vSmart fill:#7c3aed,stroke:#a78bfa,color:#fff`,
      },
      {
        id: 'bgp-ebgp',
        label: 'eBGP Peering (Multi-AS)',
        code: `graph LR
    subgraph AS65001["AS 65001 — Org A"]
        R1[Router-01\n192.0.2.1]
        R2[Router-02]
    end
    subgraph AS65002["AS 65002 — Org B"]
        R3[Router-03\n192.0.2.2]
        R4[Router-04]
    end
    subgraph AS65003["AS 65003 — Transit / ISP"]
        R5[Transit-01]
    end
    R1 <-->|eBGP\n192.0.2.0/30| R3
    R1 <-->|eBGP| R5
    R3 <-->|eBGP| R5
    R1 <-->|iBGP| R2
    R3 <-->|iBGP| R4`,
      },
      {
        id: 'ospf-areas',
        label: 'OSPF Multi-Area',
        code: `graph TD
    subgraph Area0["OSPF Area 0 — Backbone"]
        ABR1[ABR-01]
        ABR2[ABR-02]
        ABR1 <-->|backbone| ABR2
    end
    subgraph Area1["OSPF Area 1"]
        R1[Router-01]
        R2[Router-02]
    end
    subgraph Area2["OSPF Area 2 — Stub"]
        R3[Router-03]
        R4[Router-04]
    end
    subgraph Area3["OSPF Area 3 — NSSA"]
        R5[ASBR-01]
    end
    ABR1 --- R1 & R2
    ABR2 --- R3 & R4
    ABR1 --- R5
    R5 -->|Redistribute| EXT[External Route]
    style ABR1 fill:#1e40af,stroke:#3b82f6,color:#fff
    style ABR2 fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
    ],
  },
  {
    group: 'Data Center & Cloud',
    templates: [
      {
        id: 'dc-active-active',
        label: 'Active-Active Dual DC',
        code: `graph LR
    INET([Internet])
    GLB[Global Load Balancer\n/ Anycast DNS]
    subgraph DC1["Data Center — Primary"]
        FW1{Firewall Cluster A}
        LB1[Load Balancer A]
        APP1A[App Node 1a]
        APP1B[App Node 1b]
        DB1[(DB Primary)]
    end
    subgraph DC2["Data Center — Secondary"]
        FW2{Firewall Cluster B}
        LB2[Load Balancer B]
        APP2A[App Node 2a]
        APP2B[App Node 2b]
        DB2[(DB Replica)]
    end
    INET --> GLB
    GLB -->|50%| FW1
    GLB -->|50%| FW2
    FW1 --> LB1 --> APP1A & APP1B --> DB1
    FW2 --> LB2 --> APP2A & APP2B --> DB2
    DB1 <-->|replication| DB2
    style FW1 fill:#991b1b,stroke:#ef4444,color:#fff
    style FW2 fill:#991b1b,stroke:#ef4444,color:#fff`,
      },
      {
        id: 'dc-dr',
        label: 'Primary DC + DR Site',
        code: `graph TD
    subgraph Primary["Primary Data Center"]
        FW_P{Firewall}
        CORE_P[Core Switch]
        SRV_P[Production Servers]
        DB_P[(Primary DB)]
    end
    subgraph DR["DR Site"]
        FW_D{Firewall}
        CORE_D[Core Switch]
        SRV_D[DR Servers]
        DB_D[(DR DB — Standby)]
    end
    WAN[DCI — Dark Fiber / DWDM]
    INET([Internet])
    INET --> FW_P & FW_D
    FW_P --> CORE_P --> SRV_P & DB_P
    FW_D --> CORE_D --> SRV_D & DB_D
    DB_P <-->|synchronous / async repl| WAN <-->|replication| DB_D
    style FW_P fill:#991b1b,stroke:#ef4444,color:#fff
    style FW_D fill:#991b1b,stroke:#ef4444,color:#fff`,
      },
      {
        id: 'cloud-hybrid',
        label: 'Hybrid Cloud (On-Prem + Cloud)',
        code: `graph LR
    subgraph OnPrem["On-Premises"]
        FW{Edge Firewall}
        CORE[Core Network]
        SRV[Internal Servers]
    end
    subgraph Connectivity
        VPN[VPN / ExpressRoute\n/ Direct Connect]
    end
    subgraph Cloud["Cloud VPC / VNet"]
        CGW[Cloud VPN Gateway]
        LB[Cloud Load Balancer]
        APP[Cloud App Tier]
        DB[(Managed DB)]
    end
    INET([Internet]) --> FW
    FW --> CORE --> SRV
    CORE <-->|private link| VPN <--> CGW
    LB --> APP --> DB
    CGW --> LB
    style FW fill:#991b1b,stroke:#ef4444,color:#fff
    style CGW fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
    ],
  },
  {
    group: 'VPN & Tunneling',
    templates: [
      {
        id: 'ipsec-site-to-site',
        label: 'IPsec Site-to-Site VPN',
        code: `graph LR
    subgraph SiteA["Site A — 10.1.0.0/24"]
        PC_A[Workstations]
        GW_A[VPN Gateway A\n203.0.113.1]
    end
    INET([Internet])
    subgraph SiteB["Site B — 10.2.0.0/24"]
        GW_B[VPN Gateway B\n198.51.100.1]
        PC_B[Workstations]
    end
    PC_A --> GW_A
    GW_A <-->|"IKEv2 / IPsec\nESP AES-256-GCM"| INET
    INET <-->|"IKEv2 / IPsec\nESP AES-256-GCM"| GW_B
    GW_B --> PC_B
    style INET fill:#374151,stroke:#6b7280,color:#fff`,
      },
      {
        id: 'dmvpn',
        label: 'DMVPN Hub-Spoke (Phase 2/3)',
        code: `graph TD
    subgraph Hub["Hub — HQ"]
        HUB[Hub Router\nmGRE / NHRP]
    end
    subgraph Spokes
        SP1[Spoke-01\n10.100.1.1]
        SP2[Spoke-02\n10.100.2.1]
        SP3[Spoke-03\n10.100.3.1]
    end
    INET([NBMA — Internet])
    HUB <-->|mGRE Tunnel| INET
    SP1 <-->|mGRE Tunnel| INET
    SP2 <-->|mGRE Tunnel| INET
    SP3 <-->|mGRE Tunnel| INET
    SP1 <-.->|"Phase 2/3\nDirect spoke-spoke"| SP2
    SP2 <-.->|"Phase 2/3"| SP3
    style HUB fill:#1e40af,stroke:#3b82f6,color:#fff
    style INET fill:#374151,stroke:#6b7280,color:#fff`,
      },
      {
        id: 'remote-access-vpn',
        label: 'Remote Access VPN',
        code: `graph LR
    USERS([Remote Users\nAnyConnect / OpenVPN\nWireGuard])
    INET([Internet])
    FW{Firewall /\nVPN Headend}
    subgraph Internal
        LAN[Corporate LAN\n10.0.0.0/8]
        DC[Domain Controllers]
        APPS[Application Servers]
    end
    USERS <-->|TLS / IKEv2| INET
    INET <-->|Terminated| FW
    FW --> LAN
    LAN --> DC & APPS
    style FW fill:#991b1b,stroke:#ef4444,color:#fff
    style INET fill:#374151,stroke:#6b7280,color:#fff`,
      },
    ],
  },
  {
    group: 'Wireless & Access',
    templates: [
      {
        id: 'wifi-enterprise',
        label: 'Enterprise WiFi (Controller-Based)',
        code: `graph TD
    WLC[Wireless LAN Controller]
    subgraph Core
        CORE[Core Switch]
    end
    subgraph DistAPs["Distribution — Building A"]
        DS1[Dist Switch A]
        AP1[AP-01\n802.11ax]
        AP2[AP-02\n802.11ax]
        AP3[AP-03\n802.11ax]
    end
    subgraph DistBPs["Distribution — Building B"]
        DS2[Dist Switch B]
        AP4[AP-04\n802.11ax]
        AP5[AP-05\n802.11ax]
    end
    CORE --- WLC
    CORE --- DS1 & DS2
    DS1 --- AP1 & AP2 & AP3
    DS2 --- AP4 & AP5
    AP1 -. CAPWAP .-> WLC
    AP2 -. CAPWAP .-> WLC
    AP3 -. CAPWAP .-> WLC
    AP4 -. CAPWAP .-> WLC
    AP5 -. CAPWAP .-> WLC
    style WLC fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
      {
        id: 'wifi-mesh',
        label: 'Wireless Mesh Backhaul',
        code: `graph TD
    ROOT[Root AP\nWired Uplink]
    MAP1[Mesh AP-01\nBackhaul 5 GHz]
    MAP2[Mesh AP-02\nBackhaul 5 GHz]
    MAP3[Mesh AP-03\nBackhaul 5 GHz]
    MAP4[Leaf AP-04]
    MAP5[Leaf AP-05]
    ROOT <-->|5 GHz backhaul| MAP1 & MAP2
    MAP1 <-->|5 GHz backhaul| MAP3
    MAP2 <-->|5 GHz backhaul| MAP4
    MAP3 <-->|5 GHz backhaul| MAP5
    style ROOT fill:#1e40af,stroke:#3b82f6,color:#fff`,
      },
    ],
  },
  {
    group: 'Service Provider',
    templates: [
      {
        id: 'isp-network',
        label: 'ISP Core Network',
        code: `graph TD
    subgraph Peering["Peering / Internet Exchange"]
        IXP[IXP]
        PEER1[Peer AS-A]
        PEER2[Peer AS-B]
    end
    subgraph Edge["Edge / Backbone"]
        PE1[PE-01\neBGP]
        PE2[PE-02\neBGP]
    end
    subgraph Core["Core — MPLS"]
        P1[P-Core-01]
        P2[P-Core-02]
        P3[P-Core-03]
    end
    subgraph Access["Access / Aggregation"]
        AGG1[Aggregation-01]
        AGG2[Aggregation-02]
        CPE1[Customer CPE 1]
        CPE2[Customer CPE 2]
        CPE3[Customer CPE 3]
    end
    IXP --- PEER1 & PEER2
    IXP --- PE1 & PE2
    PE1 <-->|OSPF/ISIS| P1 & P2
    PE2 <-->|OSPF/ISIS| P2 & P3
    P1 <-->|OSPF/ISIS| P3
    P2 --- AGG1
    P3 --- AGG2
    AGG1 --- CPE1 & CPE2
    AGG2 --- CPE3
    style P1 fill:#374151,stroke:#6b7280,color:#fff
    style P2 fill:#374151,stroke:#6b7280,color:#fff
    style P3 fill:#374151,stroke:#6b7280,color:#fff`,
      },
      {
        id: 'carrier-ethernet',
        label: 'Carrier Ethernet (E-Line / E-LAN)',
        code: `graph LR
    subgraph CustomerA["Customer A (E-Line)"]
        CE_A1[CE Site A1]
        CE_A2[CE Site A2]
    end
    subgraph CustomerB["Customer B (E-LAN)"]
        CE_B1[CE Site B1]
        CE_B2[CE Site B2]
        CE_B3[CE Site B3]
    end
    subgraph Metro["Metro Ethernet Network"]
        PE1[PE-01]
        PE2[PE-02]
        PE3[PE-03]
        PE1 <-->|Metro| PE2
        PE2 <-->|Metro| PE3
        PE1 <-->|Metro| PE3
    end
    CE_A1 <-->|UNI| PE1
    CE_A2 <-->|UNI| PE3
    CE_B1 <-->|UNI| PE1
    CE_B2 <-->|UNI| PE2
    CE_B3 <-->|UNI| PE3`,
      },
    ],
  },
];

/* Flatten for quick lookup */
const ALL_TEMPLATES = MERMAID_PRESETS.flatMap(g => g.templates.map(t => ({ ...t, group: g.group })));

/* ── Render component ── */
function MermaidDiagramGenerator({ initialData, onShare }) {
  const { t } = useTranslation();
  const [copied, copy] = useCopy();

  const [selectedPreset, setSelectedPreset] = usePersistentState(
    'mermaid:preset',
    initialData?.preset ?? ''
  );
  const [code, setCode] = usePersistentState(
    'mermaid:code',
    initialData?.code ?? ''
  );
  const [mermaidReady, setMermaidReady] = useState(false);
  const [mermaidError, setMermaidError] = useState(null);
  const [renderError, setRenderError] = useState(null);
  const [svgOutput, setSvgOutput] = useState('');
  const renderIdRef = useRef(0);

  /* Load Mermaid.js once */
  useEffect(() => {
    window.ensureMermaid()
      .then(() => setMermaidReady(true))
      .catch(() => setMermaidError(t('mermaid_diagram.err_cdn')));
  }, []);

  /* Apply preset */
  const applyPreset = useCallback((id) => {
    const tpl = ALL_TEMPLATES.find(t => t.id === id);
    if (tpl) setCode(tpl.code);
    setSelectedPreset(id);
  }, []);

  /* Render diagram whenever code changes */
  useEffect(() => {
    if (!mermaidReady || !code.trim()) {
      setSvgOutput('');
      setRenderError(null);
      return;
    }
    const thisId = ++renderIdRef.current;
    const timer = setTimeout(async () => {
      try {
        const id = 'mermaid-render-' + Date.now();
        const { svg } = await window.mermaid.render(id, code);
        if (renderIdRef.current === thisId) {
          setSvgOutput(svg);
          setRenderError(null);
        }
      } catch (err) {
        if (renderIdRef.current === thisId) {
          setRenderError(err.message || t('mermaid_diagram.err_render'));
          setSvgOutput('');
        }
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [code, mermaidReady]);

  /* Share URL */
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'mermaid-diagram', preset: selectedPreset, code });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [selectedPreset, code, onShare]);

  const currentLabel = useMemo(() => {
    const tpl = ALL_TEMPLATES.find(t => t.id === selectedPreset);
    return tpl ? tpl.label : null;
  }, [selectedPreset]);

  return (
    <div className="fadein">
      {/* Preset selector */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <label className="label" style={{ margin: 0, whiteSpace: 'nowrap' }}>
            {t('mermaid_diagram.presets_title')}
          </label>
          <select
            className="select"
            style={{ flex: '1 1 280px', maxWidth: '480px' }}
            value={selectedPreset}
            onChange={e => applyPreset(e.target.value)}
          >
            <option value="">{t('mermaid_diagram.presets_placeholder')}</option>
            {MERMAID_PRESETS.map(grp => (
              <optgroup key={grp.group} label={grp.group}>
                {grp.templates.map(tpl => (
                  <option key={tpl.id} value={tpl.id}>{tpl.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      {/* Editor + Preview */}
      <div className="two-col">
        {/* Left — code editor */}
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
            <span className="card-title" style={{ margin: 0 }}>
              {t('mermaid_diagram.editor_title')}
              {currentLabel && (
                <span className="badge badge-cyan" style={{ marginLeft: '0.5rem', fontWeight: 400, fontSize: '0.72rem' }}>
                  {currentLabel}
                </span>
              )}
            </span>
            <CopyBtn text={code} label="common.copy" id="mermaid-code" />
          </div>
          <textarea
            className="input"
            style={{ fontFamily: 'monospace', fontSize: '0.82rem', minHeight: '520px', resize: 'vertical', lineHeight: 1.5 }}
            value={code}
            onChange={e => setCode(e.target.value)}
            placeholder={t('mermaid_diagram.editor_placeholder')}
            spellCheck={false}
          />
          <div className="hint">{t('mermaid_diagram.editor_hint')}</div>
        </div>

        {/* Right — preview */}
        <div className="card">
          <div className="card-title">{t('mermaid_diagram.preview_title')}</div>
          {mermaidError && (
            <Err msg={mermaidError} />
          )}
          {!mermaidReady && !mermaidError && (
            <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
              {t('mermaid_diagram.loading')}
            </div>
          )}
          {mermaidReady && !code.trim() && (
            <div style={{ color: 'var(--text-muted)', padding: '2rem', textAlign: 'center' }}>
              {t('mermaid_diagram.preview_empty')}
            </div>
          )}
          {renderError && (
            <Err msg={`${t('mermaid_diagram.err_render')}: ${renderError}`} />
          )}
          {svgOutput && !renderError && (
            <div
              style={{ overflowX: 'auto', background: 'var(--bg-card)', borderRadius: '6px', padding: '0.5rem' }}
              dangerouslySetInnerHTML={{ __html: svgOutput }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

window.MermaidDiagramGenerator = MermaidDiagramGenerator;
