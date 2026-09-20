const { useState, useEffect, useCallback, useRef, useMemo } = React;

function CLIReference({ initialData, onNav }) {
  const { t } = useTranslation();
  const [platform, setPlatform] = useState(initialData?.activeTab ?? 'ios');
  const [category, setCategory] = useState('interfaces');
  const [search, setSearch]     = useState('');

  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== platform) {
      setPlatform(initialData.activeTab);
      setCategory('interfaces');
      setSearch('');
    }
  }, [initialData]);

  useEffect(() => { onNav?.({ activeTab: platform }); }, [platform]);

  const CLI = {
    ios: {
      interfaces: [
        {i:0, cmd:'show interfaces',                                         desc:'All interface counters, errors, and line/protocol state'},
        {i:1, cmd:'show interfaces GigabitEthernet0/1',                      desc:'Detailed stats for a specific interface'},
        {i:2, cmd:'show interfaces status',                                  desc:'Port status table — speed, duplex, VLAN (Cat switches)'},
        {i:3, cmd:'show interfaces trunk',                                   desc:'Trunk interfaces and allowed/active VLANs'},
        {i:4, cmd:'show interfaces counters errors',                         desc:'Per-interface error counters (runts, giants, CRC)'},
        {i:5, cmd:'show ip interface brief',                                 desc:'Quick view: IP, line protocol, and admin state'},
        {i:6, cmd:'show ip interface GigabitEthernet0/1',                    desc:'IP config detail: helper-address, ACLs, proxy-ARP'},
        {i:7, cmd:'show controllers GigabitEthernet0/1',                     desc:'PHY-level hardware stats and transceiver info'},
        {i:8, cmd:'clear counters GigabitEthernet0/1',                       desc:'Reset interface counters (non-destructive)'},
        {i:9, cmd:'show interfaces GigabitEthernet0/1 | inc rate',           desc:'Current input/output rate in bps and pps'},
      ],
      routing: [
        {i:0, cmd:'show ip route',                                           desc:'Full IPv4 RIB'},
        {i:1, cmd:'show ip route summary',                                   desc:'Route count broken down by protocol'},
        {i:2, cmd:'show ip route 10.0.0.0 255.255.255.0 longer-prefixes',    desc:'All routes within a given prefix'},
        {i:3, cmd:'show ip route 192.168.1.1',                               desc:'Best route for a specific host'},
        {i:4, cmd:'show ip protocols',                                       desc:'Active routing protocols, timers, redistributions'},
        {i:5, cmd:'show ip ospf neighbor',                                   desc:'OSPF adjacencies and state'},
        {i:6, cmd:'show ip ospf database',                                   desc:'OSPF LSDB summary (LSA counts per type)'},
        {i:7, cmd:'show ip ospf interface brief',                            desc:'OSPF cost, state, and DR/BDR per interface'},
        {i:8, cmd:'show ip eigrp neighbors',                                 desc:'EIGRP neighbors, hold timer, uptime'},
        {i:9, cmd:'show ip eigrp topology',                                  desc:'EIGRP topology table — FD, RD, successors'},
        {i:10, cmd:'show ip eigrp topology all-links',                        desc:'Full topology including feasible successors'},
        {i:11, cmd:'show ip bgp summary',                                     desc:'BGP peer state, uptime, and prefix counts'},
        {i:12, cmd:'show ip bgp neighbors 10.0.0.1',                          desc:'Detailed BGP neighbor: timers, capabilities, errors'},
        {i:13, cmd:'show ip bgp 0.0.0.0/0 longer-prefixes',                   desc:'BGP routes within a prefix range'},
        {i:14, cmd:'show ip CEF 10.0.0.0/24',                                 desc:'CEF FIB entry for prefix'},
        {i:15, cmd:'show ip cef exact-route 10.1.1.1 10.2.2.2',              desc:'CEF forwarding path for a source→destination pair'},
      ],
      switching: [
        {i:0, cmd:'show spanning-tree',                                      desc:'STP state for all VLANs'},
        {i:1, cmd:'show spanning-tree vlan 10',                              desc:'STP topology for VLAN 10'},
        {i:2, cmd:'show spanning-tree vlan 10 detail',                       desc:'Timers, topology changes, port roles for VLAN 10'},
        {i:3, cmd:'show spanning-tree summary',                              desc:'STP mode (PVST/RSTP/MST) and root port counts'},
        {i:4, cmd:'show vlan brief',                                         desc:'VLAN table with member ports'},
        {i:5, cmd:'show mac address-table',                                  desc:'Full MAC address table'},
        {i:6, cmd:'show mac address-table address aabb.ccdd.eeff',           desc:'Find where a specific MAC is learned'},
        {i:7, cmd:'show mac address-table vlan 10',                          desc:'MACs learned on VLAN 10'},
        {i:8, cmd:'clear mac address-table dynamic',                         desc:'Flush entire dynamic MAC table'},
        {i:9, cmd:'show etherchannel summary',                               desc:'Port-channel groups, member ports, and LACP state'},
        {i:10, cmd:'show cdp neighbors detail',                               desc:'CDP neighbor info: IP, platform, IOS version'},
        {i:11, cmd:'show lldp neighbors detail',                              desc:'LLDP neighbor detail'},
      ],
      acl_nat: [
        {i:0, cmd:'show ip access-lists',                                    desc:'All ACLs with per-entry match counts'},
        {i:1, cmd:'show ip access-lists ACL_NAME',                           desc:'Specific ACL with hit counts'},
        {i:2, cmd:'show ip nat translations',                                desc:'Active NAT/PAT translation table'},
        {i:3, cmd:'show ip nat translations verbose',                        desc:'NAT table with protocol, ports, flags'},
        {i:4, cmd:'show ip nat statistics',                                  desc:'NAT hits, misses, translation peak counts'},
        {i:5, cmd:'debug ip nat',                                            desc:'Real-time NAT translation events (use briefly)'},
        {i:6, cmd:'clear ip nat translation *',                              desc:'Clear all dynamic NAT translations'},
        {i:7, cmd:'show policy-map interface GigabitEthernet0/1',            desc:'QoS policy class statistics and drops'},
      ],
      troubleshoot: [
        {i:0, cmd:'ping 8.8.8.8 repeat 100 size 1500 df-bit',               desc:'Extended ping — MTU path test with DF-bit set'},
        {i:1, cmd:'traceroute 8.8.8.8 probe 3 ttl 1 30',                    desc:'Traceroute with 3 probes and TTL range 1–30'},
        {i:2, cmd:'show processes cpu sorted',                               desc:'CPU usage by process — find top consumers'},
        {i:3, cmd:'show processes cpu history',                              desc:'CPU utilization graph over last 60s/60m/72h'},
        {i:4, cmd:'show memory statistics',                                  desc:'Memory pool free/used breakdown'},
        {i:5, cmd:'show log',                                                desc:'Syslog buffer (most recent messages)'},
        {i:6, cmd:'show log | include %OSPF|%BGP|%LINK',                    desc:'Filter log for specific process messages'},
        {i:7, cmd:'show ntp status',                                         desc:'NTP sync state, stratum, and reference clock'},
        {i:8, cmd:'show ntp associations',                                   desc:'NTP peers and their stratum/offset'},
        {i:9, cmd:'show version',                                            desc:'IOS version, uptime, config register, memory'},
        {i:10, cmd:'show inventory',                                          desc:'Hardware PIDs and serial numbers (chassis, cards)'},
        {i:11, cmd:'show environment all',                                    desc:'Temperature, fan, and power supply status'},
        {i:12, cmd:'show ip traffic',                                         desc:'IP protocol counters (packets in/out, errors, fragments)'},
        {i:13, cmd:'show tech-support',                                       desc:'Full diagnostic snapshot for TAC cases'},
      ],
    },
    nxos: {
      interfaces: [
        {i:0, cmd:'show interface',                                          desc:'All interfaces: counters, errors, line/protocol'},
        {i:1, cmd:'show interface Ethernet1/1',                              desc:'Detail for a specific interface'},
        {i:2, cmd:'show interface status',                                   desc:'Port status table (speed, duplex, VLAN, type)'},
        {i:3, cmd:'show interface brief',                                    desc:'One-line per interface with IP and state'},
        {i:4, cmd:'show interface counters errors',                          desc:'Error counters — runts, giants, CRC, input errors'},
        {i:5, cmd:'show ip interface brief',                                 desc:'IP and line-protocol status for all interfaces'},
        {i:6, cmd:'show interface trunk',                                    desc:'Trunk port allowed and active VLANs'},
        {i:7, cmd:'clear counters interface Ethernet1/1',                    desc:'Reset interface counters'},
        {i:8, cmd:'show interface Ethernet1/1 | inc rate',                   desc:'Current input/output rate in bps'},
        {i:9, cmd:'show hardware internal forwarding detail',                desc:'ASIC forwarding counters (platform-specific)'},
      ],
      routing: [
        {i:0, cmd:'show ip route',                                           desc:'IPv4 RIB'},
        {i:1, cmd:'show ip route summary',                                   desc:'Route count by protocol'},
        {i:2, cmd:'show ip ospf neighbor',                                   desc:'OSPF adjacency table'},
        {i:3, cmd:'show ip ospf database',                                   desc:'OSPF LSDB summary'},
        {i:4, cmd:'show ip ospf interface brief',                            desc:'OSPF per-interface state and cost'},
        {i:5, cmd:'show bgp sessions',                                       desc:'BGP session state (all VRFs and address families)'},
        {i:6, cmd:'show bgp ipv4 unicast summary',                           desc:'BGP peer table: state, uptime, prefixes'},
        {i:7, cmd:'show bgp ipv4 unicast 10.0.0.0/24',                       desc:'BGP RIB entry for a prefix'},
        {i:8, cmd:'show bgp ipv4 unicast neighbors 10.0.0.1 advertised-routes', desc:'Prefixes being advertised to a BGP peer'},
        {i:9, cmd:'show bgp ipv4 unicast neighbors 10.0.0.1 received-routes',   desc:'Prefixes received from a BGP peer (pre-policy)'},
        {i:10, cmd:'show forwarding ipv4 route 10.0.0.0/24',                 desc:'Hardware FIB lookup for a prefix'},
        {i:11, cmd:'show route-map',                                          desc:'Route maps with match/set clauses'},
        {i:12, cmd:'show ip prefix-list',                                     desc:'Prefix-list entries with match counters'},
      ],
      switching: [
        {i:0, cmd:'show spanning-tree',                                      desc:'STP state all VLANs'},
        {i:1, cmd:'show spanning-tree vlan 10',                              desc:'STP for VLAN 10'},
        {i:2, cmd:'show spanning-tree summary',                              desc:'STP mode and root counts'},
        {i:3, cmd:'show vlan',                                               desc:'VLAN database'},
        {i:4, cmd:'show vlan brief',                                         desc:'VLAN list with member ports'},
        {i:5, cmd:'show mac address-table',                                  desc:'MAC address table'},
        {i:6, cmd:'show mac address-table dynamic',                          desc:'Dynamic MAC entries only'},
        {i:7, cmd:'show vpc',                                                desc:'vPC domain status and peer link state'},
        {i:8, cmd:'show vpc consistency-parameters',                         desc:'vPC config consistency check between peers'},
        {i:9, cmd:'show vpc peer-keepalive',                                 desc:'vPC keepalive link status and last message'},
        {i:10, cmd:'show port-channel summary',                               desc:'Port-channel groups and member state'},
        {i:11, cmd:'show feature',                                            desc:'Enabled NX-OS feature licenses'},
        {i:12, cmd:'show cdp neighbors detail',                               desc:'CDP neighbor IP, platform, NX-OS version'},
      ],
      acl_nat: [
        {i:0, cmd:'show ip access-lists',                                    desc:'All ACLs with match counts'},
        {i:1, cmd:'show access-list statistics',                             desc:'Hardware ACL TCAM hit counters'},
        {i:2, cmd:'show ip nat translations',                                desc:'Active NAT translations (if configured)'},
        {i:3, cmd:'show ip nat statistics',                                  desc:'NAT statistics'},
        {i:4, cmd:'show policy-map interface Ethernet1/1',                   desc:'QoS policy class stats and drops on interface'},
        {i:5, cmd:'show queuing interface Ethernet1/1',                      desc:'Queueing stats per class'},
      ],
      troubleshoot: [
        {i:0, cmd:'show processes cpu',                                      desc:'CPU usage by process'},
        {i:1, cmd:'show processes cpu history',                              desc:'CPU utilization history graph'},
        {i:2, cmd:'show system resources',                                   desc:'CPU, memory, and file-system usage'},
        {i:3, cmd:'show logging',                                            desc:'Syslog buffer'},
        {i:4, cmd:'show logging last 50',                                    desc:'Last 50 syslog entries'},
        {i:5, cmd:'ping 8.8.8.8 count 100 packet-size 1500 df-bit',         desc:'MTU path test with DF-bit'},
        {i:6, cmd:'traceroute 8.8.8.8',                                      desc:'Traceroute'},
        {i:7, cmd:'show ntp peer-status',                                    desc:'NTP peers and stratum'},
        {i:8, cmd:'show version',                                            desc:'NX-OS version, hardware, uptime'},
        {i:9, cmd:'show environment',                                        desc:'Temperature, fans, power supplies'},
        {i:10, cmd:'show hardware internal errors',                           desc:'Hardware ASIC error counters'},
        {i:11, cmd:'ethanalyzer local interface inband display-filter "icmp"',desc:'Packet capture on mgmt plane (control-plane traffic)'},
        {i:12, cmd:'show tech-support',                                       desc:'Full diagnostic output for TAC'},
      ],
    },
    junos: {
      interfaces: [
        {i:0, cmd:'show interfaces terse',                                   desc:'Quick all-interface status (up/down, IP)'},
        {i:1, cmd:'show interfaces ge-0/0/0 detail',                         desc:'Detailed stats: errors, drops, PHY info'},
        {i:2, cmd:'show interfaces descriptions',                            desc:'Interface description list'},
        {i:3, cmd:'show interfaces statistics',                              desc:'Traffic stats for all interfaces'},
        {i:4, cmd:'show interfaces ge-0/0/0 extensive',                      desc:'Full hardware and error counter detail'},
        {i:5, cmd:'clear interfaces statistics ge-0/0/0',                    desc:'Reset interface counters'},
        {i:6, cmd:'show interfaces ge-0/0/0 | match "Physical|input rate"',  desc:'Filter for PHY state and current rates'},
      ],
      routing: [
        {i:0, cmd:'show route',                                              desc:'Full routing table (all protocols)'},
        {i:1, cmd:'show route 10.0.0.0/24 exact',                            desc:'Exact prefix match in RIB'},
        {i:2, cmd:'show route protocol ospf',                                desc:'OSPF routes only'},
        {i:3, cmd:'show route protocol bgp',                                 desc:'BGP routes only'},
        {i:4, cmd:'show ospf neighbor',                                      desc:'OSPF neighbor adjacencies'},
        {i:5, cmd:'show ospf database',                                      desc:'OSPF LSDB summary'},
        {i:6, cmd:'show ospf interface',                                     desc:'OSPF interface state, cost, DR/BDR'},
        {i:7, cmd:'show bgp summary',                                        desc:'BGP peer state and prefix counts'},
        {i:8, cmd:'show bgp neighbor 10.0.0.1',                              desc:'Detailed BGP neighbor info'},
        {i:9, cmd:'show route advertising-protocol bgp 10.0.0.1',           desc:'Prefixes being advertised to a BGP peer'},
        {i:10, cmd:'show route receive-protocol bgp 10.0.0.1',               desc:'Prefixes received from a BGP peer'},
        {i:11, cmd:'show policy-options',                                     desc:'Routing policies and prefix-lists'},
        {i:12, cmd:'show route forwarding-table',                             desc:'Kernel forwarding table (FIB)'},
      ],
      switching: [
        {i:0, cmd:'show spanning-tree interface',                            desc:'STP interface state and port role'},
        {i:1, cmd:'show spanning-tree bridge',                               desc:'Bridge STP state and root info'},
        {i:2, cmd:'show ethernet-switching table',                           desc:'MAC address table (EX/QFX series)'},
        {i:3, cmd:'show vlans',                                              desc:'VLAN database with member interfaces'},
        {i:4, cmd:'show lacp interfaces',                                    desc:'LACP member interface state'},
        {i:5, cmd:'show lacp statistics interfaces ae0',                     desc:'LACP PDU counters for a bundle'},
        {i:6, cmd:'show lldp neighbors',                                     desc:'LLDP neighbor table'},
        {i:7, cmd:'show lldp neighbors detail',                              desc:'LLDP neighbor detail: platform, capabilities'},
      ],
      acl_nat: [
        {i:0, cmd:'show firewall filter',                                    desc:'Stateless firewall filter counter summary'},
        {i:1, cmd:'show firewall filter FILTER_NAME',                        desc:'Per-term counter detail for a specific filter'},
        {i:2, cmd:'show nat source summary',                                 desc:'Source NAT pool and rule summary'},
        {i:3, cmd:'show nat source translations',                            desc:'Active NAT translation entries'},
        {i:4, cmd:'show nat source statistics',                              desc:'NAT hit/miss statistics per rule'},
        {i:5, cmd:'show security flow session',                              desc:'Active stateful sessions (SRX)'},
      ],
      troubleshoot: [
        {i:0, cmd:'ping 8.8.8.8 count 100 size 1500 do-not-fragment',       desc:'MTU path test with DF-bit'},
        {i:1, cmd:'traceroute 8.8.8.8',                                      desc:'Traceroute'},
        {i:2, cmd:'show system processes extensive',                         desc:'CPU-intensive processes and memory'},
        {i:3, cmd:'show chassis routing-engine',                             desc:'RE CPU, memory, temp, uptime'},
        {i:4, cmd:'show chassis environment',                                desc:'Temperature, fans, power supply status'},
        {i:5, cmd:'show log messages',                                       desc:'System log messages'},
        {i:6, cmd:'show log messages | match "error|Error|RPD_OSPF"',       desc:'Filter logs by pattern'},
        {i:7, cmd:'show ntp associations',                                   desc:'NTP peer stratum and offset'},
        {i:8, cmd:'show version',                                            desc:'Junos version, hardware model'},
        {i:9, cmd:'request support information | save /var/tmp/rsi.txt',    desc:'Full diagnostic dump (equiv. show tech-support)'},
        {i:10, cmd:'monitor traffic interface ge-0/0/0 detail',              desc:'Live packet capture on interface'},
        {i:11, cmd:'show pfe statistics traffic',                             desc:'Packet Forwarding Engine traffic stats'},
      ],
    },
  };

  const cats = [
    {id:'interfaces',  l:t('cliref.categories.interfaces')},
    {id:'routing',     l:t('cliref.categories.routing')},
    {id:'switching',   l:t('cliref.categories.switching')},
    {id:'acl_nat',     l:t('cliref.categories.acl_nat')},
    {id:'troubleshoot',l:t('cliref.categories.troubleshoot')},
  ];
  const platforms = [
    {id:'ios',   l:t('cliref.platforms.ios')},
    {id:'nxos',  l:t('cliref.platforms.nxos')},
    {id:'junos', l:t('cliref.platforms.junos')},
  ];

  const allCmds = Object.entries(CLI[platform]||{}).flatMap(([cat, cmds]) => cmds.map(c => ({...c, cat})));
  const searchedCmds = search.trim()
    ? allCmds.filter(c=>c.cmd.toLowerCase().includes(search.toLowerCase())||c.desc.toLowerCase().includes(search.toLowerCase()))
    : (CLI[platform]?.[category]||[]);

  return (
    <div className="fadein">
      <div style={{display:'flex',gap:8,marginBottom:12,flexWrap:'wrap'}}>
        {platforms.map(p=>(
          <button key={p.id} className={`btn btn-sm ${platform===p.id?'btn-primary':'btn-ghost'}`}
            onClick={()=>{setPlatform(p.id);setSearch('');}} style={{flex:1,minWidth:140}}>{p.l}</button>
        ))}
      </div>
      <div className="field" style={{marginBottom:12}}>
        <input className="input" value={search} onChange={e=>setSearch(e.target.value)}
          placeholder={t('cliref.search_placeholder', { platform: platforms.find(p=>p.id===platform)?.l })}/>
      </div>
      {!search.trim() && (
        <div style={{display:'flex',gap:8,marginBottom:16,flexWrap:'wrap'}}>
          {cats.map(c=>(
            <button key={c.id} className={`btn btn-sm ${category===c.id?'btn-primary':'btn-ghost'}`}
              onClick={()=>setCategory(c.id)} style={{flex:1,minWidth:100}}>{c.l}</button>
          ))}
        </div>
      )}
      <div className="card">
        <div className="card-title">
          {search.trim()
            ? t('cliref.search_results', { count: searchedCmds.length, s: searchedCmds.length!==1?'s':'' })
            : `${platforms.find(p=>p.id===platform)?.l} · ${cats.find(c=>c.id===category)?.l}`}
        </div>
        <div style={{display:'flex',flexDirection:'column',gap:4}}>
          {searchedCmds.map((c,i)=>(
            <div key={i} style={{display:'flex',alignItems:'flex-start',gap:12,padding:'10px 12px',
              background:'var(--bg)',borderRadius:'var(--radius)',border:'1px solid var(--border)'}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--cyan)',marginBottom:3,wordBreak:'break-all'}}>{c.cmd}</div>
                <div style={{fontSize:12,color:'var(--muted)'}}>
                  {t(`cliref.commands.${platform}.${c.cat || category}.${c.i}.desc`)}
                </div>
              </div>
              <CopyBtn text={c.cmd} id={`cli-${i}`} />
            </div>
          ))}
          {searchedCmds.length===0 && (
            <div style={{padding:24,textAlign:'center',color:'var(--muted)'}}>{t('cliref.no_results')}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Tool: Cypher Deck ──────────────────────────────────────
// ... (rest of the file unchanged)
window.CLIReference = CLIReference;
