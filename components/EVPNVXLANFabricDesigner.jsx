const { useState, useEffect, useCallback, useMemo } = React;

function EVPNVXLANFabricDesigner({ initialData, onShare }) {
  const { t } = useTranslation();

  // Inputs
  const [spineCount, setSpineCount] = usePersistentState('evpn:spine_count', 2);
  const [leafCount, setLeafCount] = usePersistentState('evpn:leaf_count', 4);
  const [underlayProto, setUnderlayProto] = usePersistentState('evpn:underlay_proto', 'ospf');
  const [bgpAsnMode, setBgpAsnMode] = usePersistentState('evpn:bgp_asn_mode', 'ebgp');
  const [spineAsn, setSpineAsn] = usePersistentState('evpn:spine_asn', '65000');
  const [leafBaseAsn, setLeafBaseAsn] = usePersistentState('evpn:leaf_base_asn', '65001');
  const [vniStart, setVniStart] = usePersistentState('evpn:vni_start', '10000');
  const [anycastGwIp, setAnycastGwIp] = usePersistentState('evpn:anycast_gw_ip', '10.254.254.1');

  // VLAN to VNI mappings list
  const DEFAULT_MAPPINGS = () => [
    { id: '1', vlan: '10', name: 'Web_Prod', vni: '10010' },
    { id: '2', vlan: '20', name: 'App_Prod', vni: '10020' },
    { id: '3', vlan: '30', name: 'Db_Prod', vni: '10030' }
  ];

  const [mappings, setMappings] = usePersistentState('evpn:mappings', () => {
    if (initialData?.mappings?.length) return initialData.mappings;
    return DEFAULT_MAPPINGS();
  });

  // Active Output tab
  const [activeTab, setActiveTab] = useState('topology');
  const [selectedDevice, setSelectedDevice] = useState('spine-1');

  // Share URL sync
  useEffect(() => {
    const handleShare = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'evpn-vxlan-designer',
        spineCount,
        leafCount,
        underlayProto,
        bgpAsnMode,
        spineAsn,
        leafBaseAsn,
        vniStart,
        anycastGwIp,
        mappings
      });
    };
    window.addEventListener('app:request-share', handleShare);
    return () => window.removeEventListener('app:request-share', handleShare);
  }, [spineCount, leafCount, underlayProto, bgpAsnMode, spineAsn, leafBaseAsn, vniStart, anycastGwIp, mappings, onShare]);

  // Handlers for VLAN list
  const addMapping = () => {
    const nextVlan = mappings.length > 0 ? (Math.max(...mappings.map(m => parseInt(m.vlan) || 0)) + 10).toString() : '10';
    const nextVni = (parseInt(vniStart) + parseInt(nextVlan)).toString();
    setMappings([
      ...mappings,
      {
        id: Math.random().toString(36).substring(2, 9),
        vlan: nextVlan,
        name: `VLAN_${nextVlan}`,
        vni: nextVni
      }
    ]);
  };

  const removeMapping = (id) => {
    if (mappings.length > 1) {
      setMappings(mappings.filter(m => m.id !== id));
    }
  };

  const updateMapping = (id, key, val) => {
    setMappings(mappings.map(m => m.id === id ? { ...m, [key]: val } : m));
  };

  // Calculations for configs
  const configData = useMemo(() => {
    const spines = [];
    const leafs = [];
    const loopbackPrefix = '192.168.0.';
    const vtepPrefix = '192.168.1.';

    // Generate Spines
    for (let i = 1; i <= spineCount; i++) {
      spines.push({
        id: `spine-${i}`,
        name: `Spine-${i}`,
        loopback: `${loopbackPrefix}${i}`,
        asn: spineAsn
      });
    }

    // Generate Leafs
    for (let i = 1; i <= leafCount; i++) {
      const asn = bgpAsnMode === 'ebgp' ? (parseInt(leafBaseAsn) + i - 1).toString() : spineAsn;
      leafs.push({
        id: `leaf-${i}`,
        name: `Leaf-${i}`,
        loopback: `${loopbackPrefix}${10 + i}`,
        vtep: `${vtepPrefix}${10 + i}`,
        asn: asn
      });
    }

    return { spines, leafs };
  }, [spineCount, leafCount, bgpAsnMode, spineAsn, leafBaseAsn]);

  // Render Topology
  const renderTopologyText = useMemo(() => {
    let top = `=======================================================================\n`;
    top += `                    EVPN/VXLAN FABRIC TOPOLOGY MAP\n`;
    top += `=======================================================================\n\n`;
    top += `  [Underlay Routing: ${underlayProto.toUpperCase()}]   |   [Overlay BGP EVPN ASN Mode: ${bgpAsnMode.toUpperCase()}]\n\n`;

    top += `  SPINES:\n`;
    configData.spines.forEach(s => {
      top += `    +-- ${s.name} (Loopback0: ${s.loopback}, ASN: ${s.asn})\n`;
    });

    top += `\n         |   |   |   (Full Mesh Physical Underlay Topology)   |   |   |\n`;
    top += `         v   v   v                                            v   v   v\n\n`;

    top += `  LEAFS (VTEPs):\n`;
    configData.leafs.forEach(l => {
      top += `    +-- ${l.name} (Router-ID: ${l.loopback}, VTEP IP: ${l.vtep}, ASN: ${l.asn})\n`;
      const mapped = mappings.map(m => `VLAN ${m.vlan} -> VNI ${m.vni}`);
      const chunked = [];
      for (let i = 0; i < mapped.length; i += 3) {
        chunked.push(mapped.slice(i, i + 3).join(', '));
      }
      top += `        Mappings: ` + chunked.join('\n                  ') + `\n`;
    });

    top += `\n=======================================================================\n`;
    return top;
  }, [configData, underlayProto, bgpAsnMode, mappings]);

  // Generate configurations
  const generatedConfig = useMemo(() => {
    const currentDeviceType = selectedDevice.startsWith('spine') ? 'spine' : 'leaf';
    const deviceIndex = parseInt(selectedDevice.split('-')[1]) - 1;

    if (currentDeviceType === 'spine') {
      const device = configData.spines[deviceIndex];
      if (!device) return '';

      let conf = `! ==========================================\n`;
      conf += `! HOSTNAME: ${device.name}\n`;
      conf += `! ROLE: Spine Router (EVPN Route Reflector)\n`;
      conf += `! ==========================================\n\n`;

      conf += `! -- Features Enabled --\n`;
      conf += `feature ospf\n`;
      conf += `feature bgp\n`;
      conf += `feature interface-vlan\n\n`;

      conf += `! -- Underlay IP Routing Loopback --\n`;
      conf += `interface loopback0\n`;
      conf += `  ip address ${device.loopback}/32\n`;
      if (underlayProto === 'ospf') {
        conf += `  ip router ospf 1 area 0.0.0.0\n`;
      } else {
        conf += `  ip router isis UNDERLAY\n`;
      }
      conf += `\n`;

      conf += `! -- Physical Ports to Leafs --\n`;
      configData.leafs.forEach((l, idx) => {
        conf += `interface Ethernet1/${idx + 1}\n`;
        conf += `  description Link to ${l.name}\n`;
        conf += `  no switchport\n`;
        conf += `  ip address 10.${deviceIndex + 1}.${idx + 1}.1/30\n`;
        if (underlayProto === 'ospf') {
          conf += `  ip router ospf 1 area 0.0.0.0\n`;
        } else {
          conf += `  ip router isis UNDERLAY\n`;
        }
        conf += `  no shutdown\n\n`;
      });

      if (underlayProto === 'ospf') {
        conf += `router ospf 1\n`;
        conf += `  router-id ${device.loopback}\n\n`;
      } else {
        conf += `router isis UNDERLAY\n`;
        conf += `  net 49.0001.${device.loopback.split('.').map(o => o.padStart(3, '0')).join('')}.00\n`;
        conf += `  is-type level-2\n\n`;
      }

      conf += `! -- Overlay BGP EVPN Route Reflector Config --\n`;
      conf += `router bgp ${device.asn}\n`;
      conf += `  router-id ${device.loopback}\n`;
      conf += `  address-family l2vpn evpn\n`;
      conf += `    retain route-target all\n\n`;

      configData.leafs.forEach(l => {
        conf += `  neighbor ${l.loopback} remote-as ${l.asn}\n`;
        conf += `    update-source loopback0\n`;
        conf += `    address-family l2vpn evpn\n`;
        conf += `      send-community extended\n`;
        if (bgpAsnMode === 'ibgp') {
          conf += `      route-reflector-client\n`;
        }
      });

      return conf;
    } else {
      const device = configData.leafs[deviceIndex];
      if (!device) return '';

      let conf = `! ==========================================\n`;
      conf += `! HOSTNAME: ${device.name}\n`;
      conf += `! ROLE: Leaf Router (VXLAN VTEP Gateway)\n`;
      conf += `! ==========================================\n\n`;

      conf += `! -- Features Enabled --\n`;
      conf += `feature ospf\n`;
      conf += `feature bgp\n`;
      conf += `feature nv overlay\n`;
      conf += `feature vn-segment-vlan-based\n`;
      conf += `feature interface-vlan\n\n`;

      conf += `! -- VLAN to VNI Segment Allocation --\n`;
      mappings.forEach(m => {
        conf += `vlan ${m.vlan}\n`;
        conf += `  vn-segment ${m.vni}\n`;
      });
      conf += `\n`;

      conf += `! -- Underlay and VTEP Loopbacks --\n`;
      conf += `interface loopback0\n`;
      conf += `  ip address ${device.loopback}/32\n`;
      if (underlayProto === 'ospf') {
        conf += `  ip router ospf 1 area 0.0.0.0\n`;
      } else {
        conf += `  ip router isis UNDERLAY\n`;
      }
      conf += `\n`;
      conf += `interface loopback1\n`;
      conf += `  description VTEP NVE IP\n`;
      conf += `  ip address ${device.vtep}/32\n`;
      if (underlayProto === 'ospf') {
        conf += `  ip router ospf 1 area 0.0.0.0\n`;
      } else {
        conf += `  ip router isis UNDERLAY\n`;
      }
      conf += `\n`;

      conf += `! -- Physical Ports to Spines --\n`;
      configData.spines.forEach((s, idx) => {
        conf += `interface Ethernet1/${idx + 1}\n`;
        conf += `  description Link to ${s.name}\n`;
        conf += `  no switchport\n`;
        conf += `  ip address 10.${idx + 1}.${deviceIndex + 1}.2/30\n`;
        if (underlayProto === 'ospf') {
          conf += `  ip router ospf 1 area 0.0.0.0\n`;
        } else {
          conf += `  ip router isis UNDERLAY\n`;
        }
        conf += `  no shutdown\n\n`;
      });

      if (underlayProto === 'ospf') {
        conf += `router ospf 1\n`;
        conf += `  router-id ${device.loopback}\n\n`;
      } else {
        conf += `router isis UNDERLAY\n`;
        conf += `  net 49.0001.${device.loopback.split('.').map(o => o.padStart(3, '0')).join('')}.00\n`;
        conf += `  is-type level-2\n\n`;
      }

      conf += `! -- NVE Overlay (VXLAN Tunnel) Config --\n`;
      conf += `interface nve1\n`;
      conf += `  no shutdown\n`;
      conf += `  source-interface loopback1\n`;
      mappings.forEach(m => {
        conf += `  member vni ${m.vni}\n`;
        conf += `    mcast-group 239.1.1.${m.vlan}\n`;
      });
      conf += `\n`;

      conf += `! -- Anycast Gateway VLAN Interfaces (L3 VNIs) --\n`;
      conf += `ip nve anycast-gateway mac-address 0000.face.b00c\n\n`;
      mappings.forEach((m, idx) => {
        conf += `interface Vlan${m.vlan}\n`;
        conf += `  description Anycast GW for ${m.name}\n`;
        conf += `  no shutdown\n`;
        conf += `  vrf member tenant-VRF\n`;
        conf += `  ip address 10.${m.vlan}.0.1/24\n`;
        conf += `  ip router ospf 1 area 0.0.0.0\n`;
        conf += `  ip nve anycast-gateway\n\n`;
      });

      conf += `! -- Overlay BGP EVPN Configuration --\n`;
      conf += `router bgp ${device.asn}\n`;
      conf += `  router-id ${device.loopback}\n`;
      configData.spines.forEach(s => {
        conf += `  neighbor ${s.loopback} remote-as ${s.asn}\n`;
        conf += `    update-source loopback0\n`;
        conf += `    address-family l2vpn evpn\n`;
        conf += `      send-community extended\n`;
      });
      conf += `\n`;
      conf += `  vrf tenant-VRF\n`;
      conf += `    rd ${device.loopback}:1\n`;
      mappings.forEach(m => {
        conf += `    route-target import ${spineAsn}:${m.vni}\n`;
        conf += `    route-target export ${spineAsn}:${m.vni}\n`;
      });

      return conf;
    }
  }, [configData, selectedDevice, underlayProto, bgpAsnMode, mappings, spineAsn]);

  const copyConfig = () => {
    navigator.clipboard.writeText(activeTab === 'topology' ? renderTopologyText : generatedConfig);
  };

  return (
    <div className="fadein">
      <div className="two-col">
        {/* Left Inputs Card */}
        <div className="card">
          <h2 className="card-title">{t('evpn_vxlan_designer.title')}</h2>
          
          <div className="field">
            <label className="label">{t('evpn_vxlan_designer.spine_count')}</label>
            <select className="select" value={spineCount} onChange={e => setSpineCount(parseInt(e.target.value))}>
              <option value="1">1 Spine</option>
              <option value="2">2 Spines</option>
              <option value="3">3 Spines</option>
              <option value="4">4 Spines</option>
            </select>
          </div>

          <div className="field">
            <label className="label">{t('evpn_vxlan_designer.leaf_count')}</label>
            <input type="number" min="1" max="16" className="input" value={leafCount} onChange={e => setLeafCount(Math.min(16, Math.max(1, parseInt(e.target.value) || 1)))} />
            <span className="hint">{t('evpn_vxlan_designer.leaf_count_hint')}</span>
          </div>

          <div className="field">
            <label className="label">{t('evpn_vxlan_designer.underlay_proto')}</label>
            <select className="select" value={underlayProto} onChange={e => setUnderlayProto(e.target.value)}>
              <option value="ospf">OSPF (Area 0.0.0.0)</option>
              <option value="isis">IS-IS (Level 2)</option>
            </select>
          </div>

          <div className="field">
            <label className="label">{t('evpn_vxlan_designer.bgp_asn_mode')}</label>
            <select className="select" value={bgpAsnMode} onChange={e => setBgpAsnMode(e.target.value)}>
              <option value="ebgp">eBGP (Unique Leaf ASNs)</option>
              <option value="ibgp">iBGP (Single Fabric ASN)</option>
            </select>
          </div>

          <div className="two-col">
            <div className="field">
              <label className="label">{t('evpn_vxlan_designer.spine_asn')}</label>
              <input type="text" className="input" value={spineAsn} onChange={e => setSpineAsn(e.target.value)} />
            </div>
            {bgpAsnMode === 'ebgp' && (
              <div className="field">
                <label className="label">{t('evpn_vxlan_designer.leaf_base_asn')}</label>
                <input type="text" className="input" value={leafBaseAsn} onChange={e => setLeafBaseAsn(e.target.value)} />
              </div>
            )}
          </div>

          <div className="field">
            <label className="label">{t('evpn_vxlan_designer.vni_start')}</label>
            <input type="text" className="input" value={vniStart} onChange={e => setVniStart(e.target.value)} />
          </div>

          {/* VLAN to VNI mappings table */}
          <div className="field" style={{ marginTop: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <label className="label" style={{ marginBottom: 0 }}>{t('evpn_vxlan_designer.vlan_vni_mappings')}</label>
              <button className="btn btn-sm btn-primary" onClick={addMapping}>+ Add VLAN</button>
            </div>
            
            <div style={{ maxHeight: '200px', overflowY: 'auto', border: '1px solid var(--border)', padding: '0.5rem', borderRadius: 'var(--radius)' }}>
              {mappings.map((m) => (
                <div key={m.id} style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                  <input type="text" placeholder="VLAN" className="input" style={{ width: '60px' }} value={m.vlan} onChange={e => updateMapping(m.id, 'vlan', e.target.value)} />
                  <input type="text" placeholder="Name" className="input" style={{ flex: 1 }} value={m.name} onChange={e => updateMapping(m.id, 'name', e.target.value)} />
                  <input type="text" placeholder="VNI" className="input" style={{ width: '80px' }} value={m.vni} onChange={e => updateMapping(m.id, 'vni', e.target.value)} />
                  <button className="btn btn-sm btn-danger" disabled={mappings.length <= 1} onClick={() => removeMapping(m.id)}>×</button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Output Card */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="card-title" style={{ margin: 0 }}>{t('common.results')}</h2>
            <CopyBtn text={activeTab === 'topology' ? renderTopologyText : generatedConfig} />
          </div>

          {/* Tabs */}
          <div className="btn-row" style={{ marginBottom: '1rem' }}>
            <button className={`btn btn-sm ${activeTab === 'topology' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('topology')}>
              {t('evpn_vxlan_designer.tab_topology')}
            </button>
            <button className={`btn btn-sm ${activeTab === 'configs' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('configs')}>
              {t('evpn_vxlan_designer.tab_configs')}
            </button>
          </div>

          {activeTab === 'configs' && (
            <div className="field" style={{ marginBottom: '1rem' }}>
              <label className="label">{t('evpn_vxlan_designer.select_device')}</label>
              <select className="select" value={selectedDevice} onChange={e => setSelectedDevice(e.target.value)}>
                <optgroup label="Spines">
                  {configData.spines.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </optgroup>
                <optgroup label="Leafs">
                  {configData.leafs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
                </optgroup>
              </select>
            </div>
          )}

          <div style={{ flex: 1 }}>
            <pre className="result-value" style={{ margin: 0, padding: '1rem', height: '100%', minHeight: '300px', maxHeight: '550px', overflow: 'auto', backgroundColor: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '0.9rem', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
              {activeTab === 'topology' ? renderTopologyText : generatedConfig}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

window.EVPNVXLANFabricDesigner = EVPNVXLANFabricDesigner;
