function IOSXRConfigBuilder({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('iosxr:tab', 'builder');
  const skipNavReport = useRef(false);

  // Config Builder State
  const [hostname, setHostname] = usePersistentState('iosxr:hostname', initialData?.hostname ?? '');
  const [domainName, setDomainName] = usePersistentState('iosxr:domainName', initialData?.domainName ?? '');
  
  // Interfaces
  const DEFAULT_INTERFACE = () => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    name: '',
    desc: '',
    ipv4: '',
    ipv6: '',
    mtu: '',
    bundleId: '',
    shutdown: true
  });
  const [interfaces, setInterfaces] = usePersistentState('iosxr:interfaces', () => {
    if (initialData?.interfaces?.length) return initialData.interfaces;
    return [DEFAULT_INTERFACE()];
  });

  const addInterface = () => setInterfaces(prev => [...prev, DEFAULT_INTERFACE()]);
  const removeInterface = (id) => setInterfaces(prev => prev.length <= 1 ? prev : prev.filter(i => i.id !== id));
  const updateInterface = (id, field, val) => {
    setInterfaces(prev => prev.map(item => item.id === id ? { ...item, [field]: val } : item));
  };

  // OSPF
  const [enableOspf, setEnableOspf] = usePersistentState('iosxr:enableOspf', initialData?.enableOspf ?? false);
  const [ospfProcess, setOspfProcess] = usePersistentState('iosxr:ospfProcess', initialData?.ospfProcess ?? '1');
  const DEFAULT_OSPF_AREA = () => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    areaId: '0',
    interfaces: ''
  });
  const [ospfAreas, setOspfAreas] = usePersistentState('iosxr:ospfAreas', () => {
    if (initialData?.ospfAreas?.length) return initialData.ospfAreas;
    return [DEFAULT_OSPF_AREA()];
  });
  const addOspfArea = () => setOspfAreas(prev => [...prev, DEFAULT_OSPF_AREA()]);
  const removeOspfArea = (id) => setOspfAreas(prev => prev.length <= 1 ? prev : prev.filter(a => a.id !== id));
  const updateOspfArea = (id, field, val) => {
    setOspfAreas(prev => prev.map(item => item.id === id ? { ...item, [field]: val } : item));
  };

  // BGP
  const [enableBgp, setEnableBgp] = usePersistentState('iosxr:enableBgp', initialData?.enableBgp ?? false);
  const [localAs, setLocalAs] = usePersistentState('iosxr:localAs', initialData?.localAs ?? '');
  const [routerId, setRouterId] = usePersistentState('iosxr:routerId', initialData?.routerId ?? '');
  const DEFAULT_BGP_NEIGHBOR = () => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    ip: '',
    remoteAs: '',
    desc: '',
    ipv4Unicast: true,
    ipv6Unicast: false
  });
  const [bgpNeighbors, setBgpNeighbors] = usePersistentState('iosxr:bgpNeighbors', () => {
    if (initialData?.bgpNeighbors?.length) return initialData.bgpNeighbors;
    return [DEFAULT_BGP_NEIGHBOR()];
  });
  const addBgpNeighbor = () => setBgpNeighbors(prev => [...prev, DEFAULT_BGP_NEIGHBOR()]);
  const removeBgpNeighbor = (id) => setBgpNeighbors(prev => prev.length <= 1 ? prev : prev.filter(n => n.id !== id));
  const updateBgpNeighbor = (id, field, val) => {
    setBgpNeighbors(prev => prev.map(item => item.id === id ? { ...item, [field]: val } : item));
  };

  // Config Groups
  const DEFAULT_CONFIG_GROUP = () => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    name: '',
    desc: '',
    mtu: '',
    applyInterfaces: ''
  });
  const [configGroups, setConfigGroups] = usePersistentState('iosxr:configGroups', () => {
    if (initialData?.configGroups?.length) return initialData.configGroups;
    return [];
  });
  const addConfigGroup = () => setConfigGroups(prev => [...prev, DEFAULT_CONFIG_GROUP()]);
  const removeConfigGroup = (id) => setConfigGroups(prev => prev.filter(g => g.id !== id));
  const updateConfigGroup = (id, field, val) => {
    setConfigGroups(prev => prev.map(item => item.id === id ? { ...item, [field]: val } : item));
  };

  // Commit options
  const [commitLabel, setCommitLabel] = usePersistentState('iosxr:commitLabel', initialData?.commitLabel ?? '');
  const [commitComment, setCommitComment] = usePersistentState('iosxr:commitComment', initialData?.commitComment ?? '');
  const [replaceConfig, setReplaceConfig] = usePersistentState('iosxr:replaceConfig', initialData?.replaceConfig ?? false);

  // Migration Helper State
  const [iosConfigInput, setIosConfigInput] = usePersistentState('iosxr:iosConfigInput', '');
  const [migrationResult, setMigrationResult] = useState(null);

  // apply-down: sidebar/Ctrl+K/Help nav → inner tab
  useEffect(() => {
    if (!initialData?.activeTab || initialData.activeTab === activeTab) return;
    skipNavReport.current = true;
    setActiveTab(initialData.activeTab);
  }, [initialData]);

  // report-up: tab change → sidebar highlight
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  // Share URL synchronization
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'iosxr-cfg',
        hostname,
        domainName,
        interfaces,
        enableOspf,
        ospfProcess,
        ospfAreas,
        enableBgp,
        localAs,
        routerId,
        bgpNeighbors,
        configGroups,
        commitLabel,
        commitComment,
        replaceConfig
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [
    hostname,
    domainName,
    interfaces,
    enableOspf,
    ospfProcess,
    ospfAreas,
    enableBgp,
    localAs,
    routerId,
    bgpNeighbors,
    configGroups,
    commitLabel,
    commitComment,
    replaceConfig,
    onShare
  ]);

  // Generate IOS-XR Config Output
  const generatedConfigOutput = useMemo(() => {
    let out = [];

    // Header explanation or marker
    if (replaceConfig) {
      out.push("!! IOS-XR Candidate Configuration (Full Replace Model)");
    } else {
      out.push("!! IOS-XR Candidate Configuration (Merge Model)");
    }
    out.push("! \n");

    // Config Groups Definition
    if (configGroups.length > 0) {
      configGroups.forEach(cg => {
        if (!cg.name) return;
        out.push(`group ${cg.name}`);
        if (cg.desc) out.push(`  description ${cg.desc}`);
        out.push("  interface '*'");
        if (cg.mtu) out.push(`    mtu ${cg.mtu}`);
        out.push("  !");
        out.push("end-group");
        out.push("!");
      });
    }

    if (hostname) {
      out.push(`hostname ${hostname}`);
    }
    if (domainName) {
      out.push(`domain name ${domainName}`);
    }
    if (hostname || domainName) {
      out.push("!");
    }

    // Config Groups Application
    if (configGroups.length > 0) {
      configGroups.forEach(cg => {
        if (!cg.name || !cg.applyInterfaces) return;
        const targetInts = cg.applyInterfaces.split(',').map(s => s.trim()).filter(Boolean);
        targetInts.forEach(intName => {
          out.push(`interface ${intName}`);
          out.push(`  apply-group ${cg.name}`);
          out.push("!");
        });
      });
    }

    // Interfaces
    interfaces.forEach(i => {
      if (!i.name) return;
      out.push(`interface ${i.name}`);
      if (i.desc) {
        out.push(`  description ${i.desc}`);
      }
      if (i.bundleId) {
        out.push(`  bundle id ${i.bundleId} mode active`);
      }
      if (i.mtu) {
        out.push(`  mtu ${i.mtu}`);
      }
      if (i.ipv4) {
        // Enforce slash notation for XR. Users might enter address space space mask or IP/prefix
        let cleanIpv4 = i.ipv4.trim();
        if (cleanIpv4.includes(' ') && !cleanIpv4.includes('/')) {
          // Address mask format -> convert to CIDR
          const parts = cleanIpv4.split(/\s+/);
          if (parts.length === 2) {
            const mask = parts[1];
            let prefix = 32;
            if (mask.includes('.')) {
              // Convert dotted-decimal mask to CIDR prefix
              const octets = mask.split('.').map(Number);
              const binary = octets.map(o => o.toString(2).padStart(8, '0')).join('');
              prefix = binary.split('1').length - 1;
            }
            cleanIpv4 = `${parts[0]}/${prefix}`;
          }
        }
        out.push(`  ipv4 address ${cleanIpv4}`);
      }
      if (i.ipv6) {
        out.push(`  ipv6 address ${i.ipv6.trim()}`);
      }
      if (!i.shutdown) {
        // In XR, interface is shutdown by default, so we need nothing or remove shutdown.
        // We write nothing or comment if it is up
      } else {
        out.push("  shutdown");
      }
      out.push("!");
    });

    // OSPF
    if (enableOspf && ospfProcess) {
      out.push(`router ospf ${ospfProcess}`);
      
      // Determine if OSPF Router ID should be set
      if (routerId) {
        out.push(`  router-id ${routerId}`);
      }
      
      ospfAreas.forEach(a => {
        if (a.areaId === undefined || a.areaId === null || a.areaId === '') return;
        out.push(`  area ${a.areaId}`);
        if (a.interfaces) {
          const ints = a.interfaces.split(',').map(s => s.trim()).filter(Boolean);
          ints.forEach(intName => {
            out.push(`    interface ${intName}`);
            out.push("    !");
          });
        }
        out.push("  !");
      });
      out.push("!");
    }

    // BGP
    if (enableBgp && localAs) {
      out.push(`router bgp ${localAs}`);
      if (routerId) {
        out.push(`  router-id ${routerId}`);
      }

      // Check if address families are enabled on neighbors
      const hasIpv4 = bgpNeighbors.some(n => n.ipv4Unicast);
      const hasIpv6 = bgpNeighbors.some(n => n.ipv6Unicast);

      if (hasIpv4) {
        out.push("  address-family ipv4 unicast");
        out.push("  !");
      }
      if (hasIpv6) {
        out.push("  address-family ipv6 unicast");
        out.push("  !");
      }

      bgpNeighbors.forEach(n => {
        if (!n.ip || !n.remoteAs) return;
        out.push(`  neighbor ${n.ip}`);
        out.push(`    remote-as ${n.remoteAs}`);
        if (n.desc) {
          out.push(`    description ${n.desc}`);
        }
        if (n.ipv4Unicast) {
          out.push("    address-family ipv4 unicast");
          out.push("      route-policy PASS-ALL in");
          out.push("      route-policy PASS-ALL out");
          out.push("    !");
        }
        if (n.ipv6Unicast) {
          out.push("    address-family ipv6 unicast");
          out.push("      route-policy PASS-ALL in");
          out.push("      route-policy PASS-ALL out");
          out.push("    !");
        }
        out.push("  !");
      });
      out.push("!");
    }

    // Commit commands summary at the end
    out.push("! \n!! Commit Commands Execution");
    let cmd = "commit";
    if (commitComment) cmd += ` comment "${commitComment.replace(/"/g, '\\"')}"`;
    if (commitLabel) cmd += ` label ${commitLabel}`;
    out.push(`! Run: ${cmd}`);

    return out.join('\n');
  }, [hostname, domainName, interfaces, enableOspf, ospfProcess, ospfAreas, enableBgp, localAs, routerId, bgpNeighbors, configGroups, commitLabel, commitComment, replaceConfig]);

  // Migration Helper Parser
  const runMigration = () => {
    if (!iosConfigInput.trim()) {
      setMigrationResult(null);
      return;
    }

    const lines = iosConfigInput.split('\n');
    let migratedLines = [];
    let explanations = [];
    let currentBlock = null; // 'interface', 'router-ospf', 'router-bgp', etc.
    let ospfProcessId = '1';
    let bgpAsn = '';

    const addExpl = (feature, iosCmd, xrCmd, reason) => {
      explanations.push({ feature, iosCmd, xrCmd, reason });
    };

    lines.forEach(rawLine => {
      const line = rawLine.trim();
      if (!line || line.startsWith('!')) {
        migratedLines.push(rawLine);
        return;
      }

      // Check for interface context
      const interfaceMatch = line.match(/^interface\s+(.+)$/i);
      if (interfaceMatch) {
        currentBlock = 'interface';
        migratedLines.push(`interface ${interfaceMatch[1]}`);
        return;
      }

      // Check for router ospf context
      const ospfMatch = line.match(/^router\s+ospf\s+(\d+)$/i);
      if (ospfMatch) {
        currentBlock = 'router-ospf';
        ospfProcessId = ospfMatch[1];
        migratedLines.push(`router ospf ${ospfProcessId}`);
        addExpl('OSPF', 'router ospf <id>', `router ospf <id>`, 'OSPF configuration is fully hierarchical in IOS-XR. Interfaces must be declared nested inside OSPF areas rather than using global network commands.');
        return;
      }

      // Check for router bgp context
      const bgpMatch = line.match(/^router\s+bgp\s+(\d+)$/i);
      if (bgpMatch) {
        currentBlock = 'router-bgp';
        bgpAsn = bgpMatch[1];
        migratedLines.push(`router bgp ${bgpAsn}`);
        addExpl('BGP', 'router bgp <asn>', `router bgp <asn>`, 'BGP utilizes hierarchical configuration blocks per address-family. Unlike IOS-XE, routing policies (route-policy) are mandatory for safety; neighbor route-map is replaced by route-policy.');
        return;
      }

      // Exit block context
      if (line === 'exit' || line === 'quit') {
        currentBlock = null;
        migratedLines.push('!');
        return;
      }

      // Handling statements inside interface context
      if (currentBlock === 'interface') {
        // IP Address
        const ipAddrMatch = line.match(/^ip\s+address\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)$/i);
        if (ipAddrMatch) {
          const ip = ipAddrMatch[1];
          const mask = ipAddrMatch[2];
          // Convert mask to CIDR prefix length
          const octets = mask.split('.').map(Number);
          const binary = octets.map(o => o.toString(2).padStart(8, '0')).join('');
          const prefix = binary.split('1').length - 1;

          migratedLines.push(`  ipv4 address ${ip}/${prefix}`);
          addExpl('Interface IP', `ip address ${ip} ${mask}`, `ipv4 address ${ip}/${prefix}`, 'IOS-XR replaces the separate IP address and subnet mask with modern CIDR slash notation.');
          return;
        }

        // IPv6 Address
        const ipv6AddrMatch = line.match(/^ipv6\s+address\s+(.+)$/i);
        if (ipv6AddrMatch) {
          migratedLines.push(`  ipv6 address ${ipv6AddrMatch[1]}`);
          return;
        }

        // Description
        if (line.toLowerCase().startsWith('description ')) {
          migratedLines.push(`  ${line}`);
          return;
        }

        // Shutdown / No shutdown
        if (line.toLowerCase() === 'no shutdown') {
          migratedLines.push('  ! (In XR interfaces are up unless shutdown command is explicit)');
          addExpl('Shutdown', 'no shutdown', '(no command needed)', 'By default, interfaces in IOS-XR are shutdown, so modern deployments configure shutdown explicitly. To enable, simply do not write shutdown, or configure no shutdown.');
          return;
        }
        if (line.toLowerCase() === 'shutdown') {
          migratedLines.push('  shutdown');
          return;
        }

        // VRF forwarding
        const vrfMatch = line.match(/^ip\s+vrf\s+forwarding\s+(.+)$/i) || line.match(/^vrf\s+forwarding\s+(.+)$/i);
        if (vrfMatch) {
          migratedLines.push(`  vrf ${vrfMatch[1]}`);
          addExpl('VRF Member', line, `vrf ${vrfMatch[1]}`, 'IOS-XR uses "vrf" instead of "ip vrf forwarding" or "vrf forwarding". Be aware this will wipe existing IP configurations on the interface in classic IOS, and requires re-application in both.');
          return;
        }
      }

      // Handling statements inside OSPF context
      if (currentBlock === 'router-ospf') {
        const networkMatch = line.match(/^network\s+(\d+\.\d+\.\d+\.\d+)\s+(\d+\.\d+\.\d+\.\d+)\s+area\s+(\d+|\d+\.\d+\.\d+\.\d+)$/i);
        if (networkMatch) {
          const area = networkMatch[3];
          migratedLines.push(`  area ${area}`);
          migratedLines.push(`    ! Assign matching interfaces here`);
          migratedLines.push(`    ! interface <name>`);
          addExpl('OSPF Area Network', line, `area ${area} -> interface <name>`, 'IOS-XR does not support the "network" wildcard command. Interfaces must be listed explicitly under the OSPF area block.');
          return;
        }

        if (line.toLowerCase().startsWith('router-id ')) {
          migratedLines.push(`  ${line}`);
          return;
        }
      }

      // Handling statements inside BGP context
      if (currentBlock === 'router-bgp') {
        // Neighbor definition
        const neighborMatch = line.match(/^neighbor\s+(\d+\.\d+\.\d+\.\d+|[a-f0-9:]+)\s+remote-as\s+(\d+)$/i);
        if (neighborMatch) {
          const peerIp = neighborMatch[1];
          const peerAs = neighborMatch[2];
          migratedLines.push(`  neighbor ${peerIp}`);
          migratedLines.push(`    remote-as ${peerAs}`);
          migratedLines.push(`    address-family ipv4 unicast`);
          migratedLines.push(`      route-policy PASS-ALL in  ! (Required: BGP requires routing policy in XR)`);
          migratedLines.push(`      route-policy PASS-ALL out ! (Required: BGP requires routing policy in XR)`);
          migratedLines.push(`    !`);
          addExpl('BGP Neighbor', line, `neighbor ${peerIp} \n remote-as ${peerAs} \n address-family ipv4 unicast`, 'In IOS-XR, BGP neighbors require explicit address-family definitions. A route-policy is also mandatory; BGP will not advertise or accept routes without policy configured.');
          return;
        }
      }

      // Global Access Lists
      const aclMatch = line.match(/^ip\s+access-list\s+(standard|extended)\s+(.+)$/i);
      if (aclMatch) {
        const aclName = aclMatch[2];
        migratedLines.push(`ipv4 access-list ${aclName}`);
        addExpl('Access Control List', line, `ipv4 access-list ${aclName}`, 'IOS-XR specifies standard and extended IP access lists under the unified command "ipv4 access-list".');
        return;
      }

      // Global Route-maps
      const routeMapMatch = line.match(/^route-map\s+(\S+)\s+(permit|deny)\s+(\d+)$/i);
      if (routeMapMatch) {
        const rmName = routeMapMatch[1];
        const action = routeMapMatch[2];
        migratedLines.push(`route-policy ${rmName}`);
        migratedLines.push(`  ! Translate route-map statements to RPL (Route Policy Language)`);
        migratedLines.push(`  ! e.g., if destination in prefix-list then ${action} else drop`);
        migratedLines.push(`end-policy`);
        addExpl('Route Policy Language', line, `route-policy ${rmName}`, 'IOS-XR replaces traditional route-maps with Route Policy Language (RPL), which features programmatic if-then loops for safety and scaling.');
        return;
      }

      // Default fallback
      migratedLines.push(`! [UNSUPPORTED OR SAME] ${line}`);
    });

    setMigrationResult({
      config: migratedLines.join('\n'),
      explanations
    });
  };

  const copyRef = useRef();
  const [copied, copy] = useCopy();

  const handleExportText = () => {
    const blob = new Blob([generatedConfigOutput + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${hostname || 'cisco'}_ios_xr_config.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fadein">
      <div className="card">
        <h2 className="card-title">{t('iosxr_config.title')}</h2>
        <p className="hint">{t('iosxr_config.subtitle')}</p>

        {/* Tab Selection */}
        <div className="btn-row" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
          <button className={`btn ${activeTab === 'builder' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('builder')}>
            {t('iosxr_config.tab_builder')}
          </button>
          <button className={`btn ${activeTab === 'migration' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('migration')}>
            {t('iosxr_config.tab_migration')}
          </button>
          <button className={`btn ${activeTab === 'comparison' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('comparison')}>
            {t('iosxr_config.tab_comparison')}
          </button>
        </div>

        {activeTab === 'builder' && (
          <div className="two-col">
            <div>
              <div className="card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                <h3>Global & Interface Settings</h3>
                <div className="field">
                  <label className="label">{t('iosxr_config.hostname')}</label>
                  <input className="input" type="text" placeholder="PE-Router-01" value={hostname} onChange={e => setHostname(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">{t('iosxr_config.domain_name')}</label>
                  <input className="input" type="text" placeholder="net.corp" value={domainName} onChange={e => setDomainName(e.target.value)} />
                </div>

                <div style={{ marginTop: '1.5rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                    <h4 style={{ margin: 0 }}>{t('iosxr_config.interfaces')}</h4>
                    <button className="btn btn-sm btn-ghost" onClick={addInterface}>+ {t('iosxr_config.add_interface')}</button>
                  </div>

                  {interfaces.map((item, idx) => (
                    <div key={item.id} className="card" style={{ padding: '0.75rem', marginBottom: '0.75rem', position: 'relative' }}>
                      {interfaces.length > 1 && (
                        <button className="btn btn-sm btn-danger" style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', padding: '0.1rem 0.4rem' }} onClick={() => removeInterface(item.id)}>×</button>
                      )}
                      <div className="three-col" style={{ gap: '0.5rem' }}>
                        <div className="field">
                          <label className="label">{t('iosxr_config.int_name')}</label>
                          <input className="input" type="text" placeholder="GigabitEthernet0/0/0/1" value={item.name} onChange={e => updateInterface(item.id, 'name', e.target.value)} />
                        </div>
                        <div className="field">
                          <label className="label">{t('iosxr_config.int_desc')}</label>
                          <input className="input" type="text" placeholder="Uplink to Core" value={item.desc} onChange={e => updateInterface(item.id, 'desc', e.target.value)} />
                        </div>
                        <div className="field">
                          <label className="label">{t('iosxr_config.ipv4_addr')}</label>
                          <input className="input" type="text" placeholder="10.1.1.1/30" value={item.ipv4} onChange={e => updateInterface(item.id, 'ipv4', e.target.value)} />
                        </div>
                      </div>

                      <div className="three-col" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                        <div className="field">
                          <label className="label">{t('iosxr_config.ipv6_addr')}</label>
                          <input className="input" type="text" placeholder="2001:db8:1::1/64" value={item.ipv6} onChange={e => updateInterface(item.id, 'ipv6', e.target.value)} />
                        </div>
                        <div className="field">
                          <label className="label">{t('iosxr_config.bundle_id')}</label>
                          <input className="input" type="number" placeholder="10" value={item.bundleId} onChange={e => updateInterface(item.id, 'bundleId', e.target.value)} />
                        </div>
                        <div className="field">
                          <label className="label">{t('iosxr_config.mtu')}</label>
                          <input className="input" type="number" placeholder="1500" value={item.mtu} onChange={e => updateInterface(item.id, 'mtu', e.target.value)} />
                        </div>
                      </div>

                      <div className="field" style={{ display: 'flex', alignItems: 'center', marginTop: '0.5rem', gap: '0.5rem' }}>
                        <input type="checkbox" checked={item.shutdown} onChange={e => updateInterface(item.id, 'shutdown', e.target.checked)} />
                        <label className="label" style={{ marginBottom: 0 }}>{t('iosxr_config.shutdown')}</label>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* OSPF Section */}
              <div className="card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input type="checkbox" checked={enableOspf} onChange={e => setEnableOspf(e.target.checked)} />
                  <h3 style={{ margin: 0 }}>{t('iosxr_config.ospf_config')}</h3>
                </div>

                {enableOspf && (
                  <div>
                    <div className="field">
                      <label className="label">{t('iosxr_config.ospf_process')}</label>
                      <input className="input" type="text" placeholder="OSPF-CORE" value={ospfProcess} onChange={e => setOspfProcess(e.target.value)} />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0 0.5rem 0' }}>
                      <label className="label" style={{ fontWeight: 'bold' }}>{t('iosxr_config.ospf_areas')}</label>
                      <button className="btn btn-sm btn-ghost" onClick={addOspfArea}>+ {t('iosxr_config.add_area')}</button>
                    </div>

                    {ospfAreas.map((area, idx) => (
                      <div key={area.id} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'flex-end' }}>
                        <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                          <label className="label">{t('iosxr_config.area_id')}</label>
                          <input className="input" type="text" placeholder="0" value={area.areaId} onChange={e => updateOspfArea(area.id, 'areaId', e.target.value)} />
                        </div>
                        <div className="field" style={{ flex: 2, marginBottom: 0 }}>
                          <label className="label">{t('iosxr_config.area_interfaces')}</label>
                          <input className="input" type="text" placeholder="GigabitEthernet0/0/0/1, TenGigE0/0/0/2" value={area.interfaces} onChange={e => updateOspfArea(area.id, 'interfaces', e.target.value)} />
                        </div>
                        {ospfAreas.length > 1 && (
                          <button className="btn btn-sm btn-danger" style={{ height: '34px' }} onClick={() => removeOspfArea(area.id)}>×</button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* BGP Section */}
              <div className="card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.75rem' }}>
                  <input type="checkbox" checked={enableBgp} onChange={e => setEnableBgp(e.target.checked)} />
                  <h3 style={{ margin: 0 }}>{t('iosxr_config.bgp_config')}</h3>
                </div>

                {enableBgp && (
                  <div>
                    <div className="two-col">
                      <div className="field">
                        <label className="label">{t('iosxr_config.local_as')}</label>
                        <input className="input" type="number" placeholder="65001" value={localAs} onChange={e => setLocalAs(e.target.value)} />
                      </div>
                      <div className="field">
                        <label className="label">{t('iosxr_config.router_id')}</label>
                        <input className="input" type="text" placeholder="10.255.255.1" value={routerId} onChange={e => setRouterId(e.target.value)} />
                      </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '1rem 0 0.5rem 0' }}>
                      <label className="label" style={{ fontWeight: 'bold' }}>{t('iosxr_config.bgp_neighbors')}</label>
                      <button className="btn btn-sm btn-ghost" onClick={addBgpNeighbor}>+ {t('iosxr_config.add_neighbor')}</button>
                    </div>

                    {bgpNeighbors.map((n, idx) => (
                      <div key={n.id} className="card" style={{ padding: '0.75rem', marginBottom: '0.75rem', position: 'relative' }}>
                        {bgpNeighbors.length > 1 && (
                          <button className="btn btn-sm btn-danger" style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', padding: '0.1rem 0.4rem' }} onClick={() => removeBgpNeighbor(n.id)}>×</button>
                        )}
                        <div className="three-col" style={{ gap: '0.5rem' }}>
                          <div className="field">
                            <label className="label">{t('iosxr_config.neighbor_ip')}</label>
                            <input className="input" type="text" placeholder="10.1.1.2" value={n.ip} onChange={e => updateBgpNeighbor(n.id, 'ip', e.target.value)} />
                          </div>
                          <div className="field">
                            <label className="label">{t('iosxr_config.remote_as')}</label>
                            <input className="input" type="number" placeholder="65002" value={n.remoteAs} onChange={e => updateBgpNeighbor(n.id, 'remoteAs', e.target.value)} />
                          </div>
                          <div className="field">
                            <label className="label">{t('iosxr_config.neighbor_desc')}</label>
                            <input className="input" type="text" placeholder="Transit Link" value={n.desc} onChange={e => updateBgpNeighbor(n.id, 'desc', e.target.value)} />
                          </div>
                        </div>
                        <div className="field" style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <input type="checkbox" checked={n.ipv4Unicast} onChange={e => updateBgpNeighbor(n.id, 'ipv4Unicast', e.target.checked)} />
                            <label className="label" style={{ marginBottom: 0 }}>IPv4 Unicast</label>
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                            <input type="checkbox" checked={n.ipv6Unicast} onChange={e => updateBgpNeighbor(n.id, 'ipv6Unicast', e.target.checked)} />
                            <label className="label" style={{ marginBottom: 0 }}>IPv6 Unicast</label>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Config Groups Section */}
              <div className="card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', marginTop: '1.5rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3 style={{ margin: 0 }}>{t('iosxr_config.config_groups')}</h3>
                  <button className="btn btn-sm btn-ghost" onClick={addConfigGroup}>+ Add Group</button>
                </div>

                {configGroups.map((g, idx) => (
                  <div key={g.id} className="card" style={{ padding: '0.75rem', marginBottom: '0.75rem', position: 'relative' }}>
                    <button className="btn btn-sm btn-danger" style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', padding: '0.1rem 0.4rem' }} onClick={() => removeConfigGroup(g.id)}>×</button>
                    <div className="two-col" style={{ gap: '0.5rem' }}>
                      <div className="field">
                        <label className="label">{t('iosxr_config.group_name')}</label>
                        <input className="input" type="text" placeholder="WAN-PORTS" value={g.name} onChange={e => updateConfigGroup(g.id, 'name', e.target.value)} />
                      </div>
                      <div className="field">
                        <label className="label">{t('iosxr_config.group_description')}</label>
                        <input className="input" type="text" placeholder="Base config for WANs" value={g.desc} onChange={e => updateConfigGroup(g.id, 'desc', e.target.value)} />
                      </div>
                    </div>
                    <div className="two-col" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                      <div className="field">
                        <label className="label">{t('iosxr_config.group_mtu')}</label>
                        <input className="input" type="number" placeholder="9216" value={g.mtu} onChange={e => updateConfigGroup(g.id, 'mtu', e.target.value)} />
                      </div>
                      <div className="field">
                        <label className="label">{t('iosxr_config.group_interfaces')}</label>
                        <input className="input" type="text" placeholder="GigabitEthernet0/0/0/1, TenGigE0/0/0/3" value={g.applyInterfaces} onChange={e => updateConfigGroup(g.id, 'applyInterfaces', e.target.value)} />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Commit and replacement settings */}
              <div className="card" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', marginTop: '1.5rem' }}>
                <h3>{t('iosxr_config.commit_options')}</h3>
                <div className="field" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                  <input type="checkbox" checked={replaceConfig} onChange={e => setReplaceConfig(e.target.checked)} />
                  <label className="label" style={{ marginBottom: 0 }}>{t('iosxr_config.replace_config')}</label>
                </div>
                <div className="two-col">
                  <div className="field">
                    <label className="label">{t('iosxr_config.commit_label')}</label>
                    <input className="input" type="text" placeholder="LABEL_INT_UP_45" value={commitLabel} onChange={e => setCommitLabel(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('iosxr_config.commit_comment')}</label>
                    <input className="input" type="text" placeholder="Adding core interface 10G" value={commitComment} onChange={e => setCommitComment(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>

            {/* Generated Output Panel */}
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 style={{ margin: 0 }}>{t('iosxr_config.generated_config')}</h3>
                <div className="btn-row">
                  <button className="btn btn-sm btn-ghost" onClick={handleExportText}>
                    Export File
                  </button>
                  <button className={`btn btn-sm ${copied ? 'btn-primary' : 'btn-ghost'}`} onClick={() => copy(generatedConfigOutput)}>
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
              <pre style={{
                fontFamily: 'var(--typography-mono)',
                fontSize: '0.85rem',
                background: 'rgba(0,0,0,0.3)',
                padding: '1rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--spacing-radius)',
                minHeight: '400px',
                maxHeight: '800px',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
                color: '#8be9fd'
              }}>
                {generatedConfigOutput}
              </pre>
            </div>
          </div>
        )}

        {activeTab === 'migration' && (
          <div>
            <div className="two-col">
              <div>
                <h3>{t('iosxr_config.paste_ios')}</h3>
                <textarea
                  className="input"
                  style={{
                    fontFamily: 'var(--typography-mono)',
                    fontSize: '0.85rem',
                    minHeight: '350px',
                    width: '100%',
                    background: 'rgba(0,0,0,0.2)',
                    color: '#f8f8f2'
                  }}
                  placeholder={t('iosxr_config.ios_placeholder')}
                  value={iosConfigInput}
                  onChange={e => setIosConfigInput(e.target.value)}
                />
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: '1rem' }}
                  onClick={runMigration}
                >
                  {t('iosxr_config.migrate_btn')}
                </button>
              </div>

              <div>
                <h3>{t('iosxr_config.migrated_syntax')}</h3>
                {migrationResult ? (
                  <div>
                    <pre style={{
                      fontFamily: 'var(--typography-mono)',
                      fontSize: '0.85rem',
                      background: 'rgba(0,0,0,0.3)',
                      padding: '1rem',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--spacing-radius)',
                      minHeight: '350px',
                      whiteSpace: 'pre-wrap',
                      color: '#50fa7b'
                    }}>
                      {migrationResult.config}
                    </pre>
                  </div>
                ) : (
                  <div style={{
                    minHeight: '350px',
                    border: '1px dashed var(--border)',
                    borderRadius: 'var(--spacing-radius)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--text-hint)',
                    padding: '2rem',
                    textAlign: 'center'
                  }}>
                    {t('iosxr_config.empty_migration')}
                  </div>
                )}
              </div>
            </div>

            {migrationResult && migrationResult.explanations.length > 0 && (
              <div style={{ marginTop: '2rem' }}>
                <h3>{t('iosxr_config.explanation')}</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem' }}>{t('iosxr_config.col_feature')}</th>
                        <th style={{ padding: '0.5rem' }}>{t('iosxr_config.col_ios')}</th>
                        <th style={{ padding: '0.5rem' }}>{t('iosxr_config.col_xr')}</th>
                        <th style={{ padding: '0.5rem' }}>Explanation</th>
                      </tr>
                    </thead>
                    <tbody>
                      {migrationResult.explanations.map((e, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)' }}>
                          <td style={{ padding: '0.5rem', fontWeight: 'bold', color: 'var(--primary)' }}>{e.feature}</td>
                          <td style={{ padding: '0.5rem', fontFamily: 'var(--typography-mono)', color: '#ff5555', fontSize: '0.85rem' }}>{e.iosCmd}</td>
                          <td style={{ padding: '0.5rem', fontFamily: 'var(--typography-mono)', color: '#50fa7b', fontSize: '0.85rem' }}>{e.xrCmd}</td>
                          <td style={{ padding: '0.5rem', fontSize: '0.9rem', color: 'var(--text-hint)' }}>{e.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'comparison' && (
          <div>
            <p style={{ marginBottom: '1.5rem' }}>{t('iosxr_config.comparison_intro')}</p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem', width: '20%' }}>{t('iosxr_config.col_feature')}</th>
                    <th style={{ padding: '0.75rem', width: '40%', color: '#ff5555' }}>{t('iosxr_config.col_ios')}</th>
                    <th style={{ padding: '0.75rem', width: '40%', color: '#50fa7b' }}>{t('iosxr_config.col_xr')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>Configuration State</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Single state: edits instantly overwrite the running-config. No intermediate candidate.</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Two-stage: edits are written to a candidate-config, validated, and applied explicitly with <code>commit</code>.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>Routing Protocols</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Network statements match interfaces via IP and wildcard mask. Configuration is global.</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Hierarchical structure. Interfaces are explicitly associated inside the protocol routing block.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>Subnet Mask Syntax</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Requires classic dotted-decimal (e.g. <code>255.255.255.252</code>) or wildcard masks for OSPF.</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Uses slash CIDR notation exclusively (e.g. <code>/30</code>). Dotted-decimal masks are not supported.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>Route Maps vs Policies</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Uses <code>route-map</code> with permit/deny match clauses. Sequence number ordering logic.</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Uses <code>route-policy</code> (RPL). Structured programmatic flow supporting if/else conditions.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>Fail-Safe Commits</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Not supported by default (requires configuration archives or reload scheduling).</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Supports <code>commit confirmed</code> with automatic rollback if access is lost.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>Config Templates</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>None built-in. Requires external scripts or templates.</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Native <code>group</code> syntax. Inherit interface settings dynamically via wildcards.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

window.IOSXRConfigBuilder = IOSXRConfigBuilder;
