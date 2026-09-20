const { useState, useEffect, useCallback, useMemo, useRef } = React;

function QinQConfig({ initialData, onShare }) {
  const { t } = useTranslation();

  const [mode, setMode] = usePersistentState('qinq:mode', initialData?.mode ?? 'selective-qinq');
  const [platform, setPlatform] = usePersistentState('qinq:platform', initialData?.platform ?? 'cisco-ios');
  const [customerVlans, setCustomerVlans] = usePersistentState('qinq:customerVlans', initialData?.customerVlans ?? '100,200');
  const [serviceVlan, setServiceVlan] = usePersistentState('qinq:serviceVlan', initialData?.serviceVlan ?? '1000');
  const [interfaceName, setInterfaceName] = usePersistentState('qinq:interfaceName', initialData?.interfaceName ?? 'GigabitEthernet1/0/1');
  const [tpid, setTpid] = usePersistentState('qinq:tpid', initialData?.tpid ?? '0x8100');
  const [tunnelCDP, setTunnelCDP] = usePersistentState('qinq:tunnelCDP', initialData?.tunnelCDP ?? false);
  const [tunnelSTP, setTunnelSTP] = usePersistentState('qinq:tunnelSTP', initialData?.tunnelSTP ?? false);
  const [tunnelVTP, setTunnelVTP] = usePersistentState('qinq:tunnelVTP', initialData?.tunnelVTP ?? false);
  const [tunnelLACP, setTunnelLACP] = usePersistentState('qinq:tunnelLACP', initialData?.tunnelLACP ?? false);

  useEffect(() => {
    if (initialData) {
      if (initialData.mode !== undefined) setMode(initialData.mode);
      if (initialData.platform !== undefined) setPlatform(initialData.platform);
      if (initialData.customerVlans !== undefined) setCustomerVlans(initialData.customerVlans);
      if (initialData.serviceVlan !== undefined) setServiceVlan(initialData.serviceVlan);
      if (initialData.interfaceName !== undefined) setInterfaceName(initialData.interfaceName);
      if (initialData.tpid !== undefined) setTpid(initialData.tpid);
      if (initialData.tunnelCDP !== undefined) setTunnelCDP(initialData.tunnelCDP);
      if (initialData.tunnelSTP !== undefined) setTunnelSTP(initialData.tunnelSTP);
      if (initialData.tunnelVTP !== undefined) setTunnelVTP(initialData.tunnelVTP);
      if (initialData.tunnelLACP !== undefined) setTunnelLACP(initialData.tunnelLACP);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'qinq-config', mode, platform, customerVlans, serviceVlan,
        interfaceName, tpid, tunnelCDP, tunnelSTP, tunnelVTP, tunnelLACP
      });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [mode, platform, customerVlans, serviceVlan, interfaceName, tpid, tunnelCDP, tunnelSTP, tunnelVTP, tunnelLACP, onShare]);

  // Parse customer VLANs
  const parseVlans = (raw) => {
    const vlans = [];
    if (!raw.trim()) return vlans;
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (trimmed.includes('-')) {
        const [a, b] = trimmed.split('-').map(Number);
        if (!isNaN(a) && !isNaN(b) && a >= 1 && a <= 4094 && b >= 1 && b <= 4094) {
          for (let i = a; i <= b; i++) vlans.push(i);
        }
      } else {
        const v = Number(trimmed);
        if (!isNaN(v) && v >= 1 && v <= 4094) vlans.push(v);
      }
    }
    return [...new Set(vlans)].sort((a, b) => a - b);
  };

  const cVlans = useMemo(() => parseVlans(customerVlans), [customerVlans]);
  const sVlan = useMemo(() => {
    const v = Number(serviceVlan);
    return (!isNaN(v) && v >= 1 && v <= 4094) ? v : null;
  }, [serviceVlan]);

  const vlanError = useMemo(() => {
    if (!customerVlans.trim()) return t('qinq_config.err_no_cvlan');
    if (cVlans.length === 0) return t('qinq_config.err_invalid_cvlan');
    if (sVlan === null) return t('qinq_config.err_invalid_svlan');
    if (cVlans.includes(sVlan)) return t('qinq_config.err_overlap');
    return null;
  }, [cVlans, sVlan, customerVlans, t]);

  // ── Config generators ─────────────────────────────────────
  const generateConfig = useCallback(() => {
    if (vlanError || !sVlan || cVlans.length === 0) return '';
    const iface = interfaceName.trim() || 'GigabitEthernet1/0/1';
    const vlanList = cVlans.join(',');
    const vlanRange = cVlans.length > 1 ? `${cVlans[0]}-${cVlans[cVlans.length - 1]}` : String(cVlans[0]);

    const l2TunnelLines = (indent = '') => {
      const lines = [];
      if (tunnelCDP) lines.push(`${indent}l2protocol-tunnel cdp`);
      if (tunnelSTP) lines.push(`${indent}l2protocol-tunnel stp`);
      if (tunnelVTP) lines.push(`${indent}l2protocol-tunnel vtp`);
      if (tunnelLACP) lines.push(`${indent}l2protocol-tunnel lacp`);
      return lines;
    };

    const switchportBase = (platform === 'cisco-nxos' || platform === 'arista-eos')
      ? `  switchport`
      : ``;

    switch (platform) {
      case 'cisco-ios': {
        let cfg = '';
        if (mode === 'selective-qinq') {
          cfg += `! ${t('qinq_config.mode_selective')} - Cisco IOS\n`;
          cfg += `! IEEE 802.1ad (QinQ) - TPID ${tpid}\n`;
          cfg += `!\n`;
          cfg += `vlan ${sVlan}\n`;
          cfg += ` name S-VLAN_${sVlan}\n`;
          cfg += `!\n`;
          cfg += `interface ${iface}\n`;
          cfg += ` description Customer Edge - QinQ\n`;
          cfg += ` switchport access vlan ${cVlans[0]}\n`;
          if (tpid === '0x88a8') {
            cfg += `!\n! Note: IOS does not natively support TPID 0x88a8 on all platforms.\n`;
            cfg += `! Use 'dot1q tunnel ethertype 0x88a8' if supported on your hardware.\n`;
          }
          cfg += ` switchport mode dot1q-tunnel\n`;
          cfg += ` switchport access vlan ${sVlan}\n`;
          if (cVlans.length > 1) {
            cfg += `!\n`;
            cfg += `! ${t('qinq_config.inner_vlan_hint')}\n`;
            cfg += `! Customer VLANs: ${vlanList}\n`;
          }
          cfg += l2TunnelLines(' ').join('\n') + (l2TunnelLines(' ').length ? '\n' : '');
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.provider_edge')}\n`;
          cfg += `! Configure on a SEPARATE uplink interface towards the provider core\n`;
          cfg += `interface <PE-UPLINK-INTERFACE>\n`;
          cfg += ` switchport trunk encapsulation dot1q\n`;
          cfg += ` switchport mode trunk\n`;
          cfg += ` switchport trunk allowed vlan ${sVlan}\n`;
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.uplink_note')}\n`;
          cfg += `! The PE uplink carries S-VLAN ${sVlan} towards the core\n`;
          cfg += `! C-VLANs ${vlanList} are tunneled inside S-VLAN ${sVlan}\n`;
        } else if (mode === 'vlan-translation') {
          cfg += `! ${t('qinq_config.mode_translation')} - Cisco IOS\n`;
          cfg += `! VLAN Translation\n`;
          cfg += `!\n`;
          for (const cv of cVlans) {
            cfg += `vlan ${cv}\n name C-VLAN_${cv}\n!\n`;
          }
          cfg += `!\n`;
          cfg += `interface ${iface}\n`;
          cfg += ` description VLAN Translation Edge\n`;
          cfg += ` switchport trunk encapsulation dot1q\n`;
          cfg += ` switchport mode trunk\n`;
          cfg += ` switchport trunk allowed vlan ${vlanList}\n`;
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.translation_map')}\n`;
          for (const cv of cVlans) {
            cfg += `! C-VLAN ${cv} -> S-VLAN ${sVlan}\n`;
          }
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.ios_translation_note')}\n`;
          cfg += `! On Catalyst platforms use:\n`;
          cfg += `!   switchport vlan mapping ${cVlans[0]} ${sVlan}\n`;
          cfg += `! On Nexus platforms this is done via 'vlan mapping' under the interface.\n`;
          cfg += ` switchport vlan mapping enable\n`;
          if (cVlans.length === 1) {
            cfg += ` switchport vlan mapping ${cVlans[0]} ${sVlan}\n`;
          } else {
            for (const cv of cVlans) {
              cfg += ` switchport vlan mapping ${cv} ${sVlan + (cv - cVlans[0])}\n`;
            }
          }
          cfg += l2TunnelLines(' ').join('\n') + (l2TunnelLines(' ').length ? '\n' : '');
        } else if (mode === 'vlan-bundling') {
          cfg += `! ${t('qinq_config.mode_bundling')} - Cisco IOS\n`;
          cfg += `! VLAN Bundling: ${t('qinq_config.bundling_desc')}\n`;
          cfg += `!\n`;
          cfg += `vlan ${sVlan}\n`;
          cfg += ` name BUNDLE_S-VLAN_${sVlan}\n`;
          cfg += `!\n`;
          cfg += `interface ${iface}\n`;
          cfg += ` description Customer Port - VLAN Bundle\n`;
          cfg += ` switchport access vlan ${sVlan}\n`;
          cfg += ` switchport mode dot1q-tunnel\n`;
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.bundled_vlans')}: ${vlanList}\n`;
          cfg += `! All customer VLANs are tunneled inside S-VLAN ${sVlan}\n`;
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.provider_edge')}\n`;
          cfg += `! PE must preserve the inner tags and apply S-VLAN ${sVlan} as the outer tag\n`;
          cfg += l2TunnelLines(' ').join('\n') + (l2TunnelLines(' ').length ? '\n' : '');
        }
        return cfg;
      }

      case 'cisco-nxos': {
        let cfg = '';
        if (mode === 'selective-qinq') {
          cfg += `! ${t('qinq_config.mode_selective')} - Cisco NX-OS\n`;
          cfg += `! IEEE 802.1ad (QinQ) - TPID ${tpid}\n`;
          cfg += `!\n`;
          cfg += `vlan ${sVlan}\n`;
          cfg += `  name S-VLAN_${sVlan}\n`;
          cfg += `!\n`;
          cfg += `! Option 1: Port-based QinQ tunnel (simple, all C-VLANs tunneled)\n`;
          cfg += `interface ${iface}\n`;
          cfg += `  description Customer Edge - QinQ Tunnel\n`;
          cfg += `  switchport\n`;
          cfg += `  switchport mode dot1q-tunnel\n`;
          cfg += `  switchport access vlan ${sVlan}\n`;
          cfg += `  spanning-tree port type edge\n`;
          if (tpid === '0x88a8') {
            cfg += `  dot1q ethertype 0x88a8\n`;
          }
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.service_instance')}\n`;
          cfg += `! Option 2: Selective QinQ via service instance (N9K/N7K)\n`;
          cfg += `interface ${iface}\n`;
          cfg += `  service instance ${sVlan} ethernet\n`;
          if (tpid === '0x88a8') {
            cfg += `    dot1q ethertype 0x88a8\n`;
          }
          cfg += `    encapsulation dot1q ${vlanRange}\n`;
          cfg += `    rewrite ingress tag push dot1q ${sVlan} symmetric\n`;
          cfg += `    bridge-domain ${sVlan}\n`;
          cfg += l2TunnelLines('  ').join('\n') + (l2TunnelLines('  ').length ? '\n' : '');
        } else if (mode === 'vlan-translation') {
          cfg += `! ${t('qinq_config.mode_translation')} - Cisco NX-OS\n`;
          cfg += `!\n`;
          cfg += `vlan ${sVlan}\n`;
          cfg += `  name TRANSLATED_S-VLAN_${sVlan}\n`;
          cfg += `!\n`;
          cfg += `interface ${iface}\n`;
          cfg += `  description VLAN Translation Edge\n`;
          cfg += `  switchport\n`;
          cfg += `  switchport mode trunk\n`;
          cfg += `  switchport trunk allowed vlan ${vlanList}\n`;
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.translation_map')}\n`;
          for (const cv of cVlans) {
            cfg += `! C-VLAN ${cv} -> S-VLAN ${sVlan}\n`;
          }
          if (cVlans.length === 1) {
            cfg += `  switchport vlan mapping ${cVlans[0]} ${sVlan}\n`;
          } else {
            for (const cv of cVlans) {
              cfg += `  switchport vlan mapping ${cv} ${sVlan + (cv - cVlans[0])}\n`;
            }
          }
          cfg += l2TunnelLines('  ').join('\n') + (l2TunnelLines('  ').length ? '\n' : '');
        } else if (mode === 'vlan-bundling') {
          cfg += `! ${t('qinq_config.mode_bundling')} - Cisco NX-OS\n`;
          cfg += `!\n`;
          cfg += `vlan ${sVlan}\n`;
          cfg += `  name BUNDLE_S-VLAN_${sVlan}\n`;
          cfg += `!\n`;
          cfg += `interface ${iface}\n`;
          cfg += `  description Customer Port - VLAN Bundle\n`;
          cfg += `  switchport\n`;
          cfg += `  switchport mode dot1q-tunnel\n`;
          cfg += `  switchport access vlan ${sVlan}\n`;
          cfg += `  spanning-tree port type edge\n`;
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.bundled_vlans')}: ${vlanList}\n`;
          cfg += `! All C-VLANs are encapsulated within S-VLAN ${sVlan}\n`;
          cfg += l2TunnelLines('  ').join('\n') + (l2TunnelLines('  ').length ? '\n' : '');
        }
        return cfg;
      }

      case 'junos': {
        let cfg = '';
        const vlanRangeJunos = cVlans.length > 1 ? `${cVlans[0]}-${cVlans[cVlans.length - 1]}` : String(cVlans[0]);
        if (mode === 'selective-qinq') {
          cfg += `# ${t('qinq_config.mode_selective')} - Juniper JunOS\n`;
          cfg += `# IEEE 802.1ad (QinQ) - TPID ${tpid}\n`;
          cfg += `#\n`;
          cfg += `interfaces {\n`;
          cfg += `    ${iface} {\n`;
          cfg += `        unit 0 {\n`;
          cfg += `            description "Customer Edge - Selective QinQ";\n`;
          cfg += `            encapsulation flexible-ethernet-services;\n`;
          if (tpid === '0x88a8') {
            cfg += `            dot1q-tunneling {\n`;
            cfg += `                ethertype 0x88a8;\n`;
            cfg += `            }\n`;
          }
          cfg += `            vlan-tags outer ${sVlan} inner-list [${vlanList}];\n`;
          cfg += `            family bridge {\n`;
          cfg += `                interface-mode trunk;\n`;
          cfg += `                vlan-id-list [ ${vlanList} ];\n`;
          cfg += `            }\n`;
          cfg += `        }\n`;
          cfg += `    }\n`;
          cfg += `}\n`;
          cfg += `#\n`;
          cfg += `# ${t('qinq_config.alternative_bridge')}\n`;
          cfg += `# Using bridge-domain on MX/EX:\n`;
          cfg += `# bridge-domains {\n`;
          cfg += `#     BD-${sVlan} {\n`;
          cfg += `#         vlan-id ${sVlan};\n`;
          cfg += `#         interface ${iface}.0;\n`;
          cfg += `#     }\n`;
          cfg += `# }\n`;
          cfg += `#\n`;
          cfg += `# ${t('qinq_config.l2_tunnel_junos')}\n`;
          if (tunnelCDP) cfg += `# set protocols l2circuit neighbor ... interface ${iface} tunnel-attributes protocol cdp\n`;
          if (tunnelSTP) cfg += `# set protocols l2circuit neighbor ... interface ${iface} tunnel-attributes protocol stp\n`;
          if (tunnelLACP) cfg += `# set protocols l2circuit neighbor ... interface ${iface} tunnel-attributes protocol lacp\n`;
        } else if (mode === 'vlan-translation') {
          cfg += `# ${t('qinq_config.mode_translation')} - Juniper JunOS\n`;
          cfg += `#\n`;
          cfg += `interfaces {\n`;
          cfg += `    ${iface} {\n`;
          cfg += `        unit 0 {\n`;
          cfg += `            description "VLAN Translation Edge";\n`;
          cfg += `            family bridge {\n`;
          cfg += `                interface-mode trunk;\n`;
          cfg += `                vlan-id-list [ ${vlanList} ];\n`;
          cfg += `            }\n`;
          cfg += `        }\n`;
          cfg += `    }\n`;
          cfg += `}\n`;
          cfg += `#\n`;
          cfg += `# ${t('qinq_config.translation_map')}\n`;
          for (const cv of cVlans) {
            cfg += `# C-VLAN ${cv} -> S-VLAN ${sVlan}\n`;
          }
          cfg += `#\n`;
          cfg += `# ${t('qinq_config.junos_translate_note')}\n`;
          cfg += `# On MX/EX with ELS:\n`;
          if (cVlans.length === 1) {
            cfg += `# set vlans S${sVlan} vlan-id ${sVlan}\n`;
            cfg += `# set interfaces ${iface} unit 0 family bridge vlan-members ${cVlans[0]}\n`;
            cfg += `# set bridge-domains BD-${sVlan} vlan-id ${sVlan}\n`;
          } else {
            cfg += `# set interfaces ${iface} flexible-vlan-tagging\n`;
            cfg += `# set interfaces ${iface} unit 0 vlan-tags outer ${sVlan} inner <original-c-vlan>\n`;
          }
        } else if (mode === 'vlan-bundling') {
          cfg += `# ${t('qinq_config.mode_bundling')} - Juniper JunOS\n`;
          cfg += `#\n`;
          cfg += `interfaces {\n`;
          cfg += `    ${iface} {\n`;
          cfg += `        flexible-vlan-tagging;\n`;
          cfg += `        unit 0 {\n`;
          cfg += `            description "Customer Port - VLAN Bundle";\n`;
          cfg += `            vlan-tags outer ${sVlan};\n`;
          cfg += `            family bridge {\n`;
          cfg += `                interface-mode trunk;\n`;
          cfg += `                vlan-id-list [ ${vlanList} ];\n`;
          cfg += `            }\n`;
          cfg += `        }\n`;
          cfg += `    }\n`;
          cfg += `}\n`;
          cfg += `#\n`;
          cfg += `# ${t('qinq_config.bundled_vlans')}: ${vlanList}\n`;
          cfg += `# All C-VLANs are encapsulated within S-VLAN ${sVlan}\n`;
        }
        return cfg;
      }

      case 'arista-eos': {
        let cfg = '';
        if (mode === 'selective-qinq') {
          cfg += `! ${t('qinq_config.mode_selective')} - Arista EOS\n`;
          cfg += `! IEEE 802.1ad (QinQ) - TPID ${tpid}\n`;
          cfg += `!\n`;
          cfg += `vlan ${sVlan}\n`;
          cfg += `   name S-VLAN_${sVlan}\n`;
          cfg += `!\n`;
          cfg += `interface ${iface}\n`;
          cfg += `   description Customer Edge - Selective QinQ\n`;
          cfg += `   switchport\n`;
          cfg += `   switchport mode dot1q-tunnel\n`;
          cfg += `   switchport access vlan ${sVlan}\n`;
          cfg += `   spanning-tree port type edge\n`;
          cfg += `   spanning-tree bpduguard enable\n`;
          if (tpid === '0x88a8') {
            cfg += `!\n`;
            cfg += `! ${t('qinq_config.arista_tpid_note')}\n`;
            cfg += `   dot1q ethertype 0x88a8\n`;
          }
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.inner_vlan_hint')}\n`;
          cfg += `! Customer VLANs ${vlanList} are preserved as inner tags\n`;
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.provider_edge')}\n`;
          cfg += `! On the PE uplink, trunk S-VLAN ${sVlan} towards the core\n`;
          cfg += l2TunnelLines('   ').join('\n') + (l2TunnelLines('   ').length ? '\n' : '');
        } else if (mode === 'vlan-translation') {
          cfg += `! ${t('qinq_config.mode_translation')} - Arista EOS\n`;
          cfg += `!\n`;
          cfg += `vlan ${sVlan}\n`;
          cfg += `   name TRANSLATED_S-VLAN_${sVlan}\n`;
          cfg += `!\n`;
          cfg += `interface ${iface}\n`;
          cfg += `   description VLAN Translation Edge\n`;
          cfg += `   switchport\n`;
          cfg += `   switchport mode trunk\n`;
          cfg += `   switchport trunk allowed vlan ${vlanList}\n`;
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.translation_map')}\n`;
          for (const cv of cVlans) {
            cfg += `! C-VLAN ${cv} -> S-VLAN ${sVlan}\n`;
          }
          cfg += `!\n`;
          if (cVlans.length === 1) {
            cfg += `   switchport vlan translation ${cVlans[0]} ${sVlan}\n`;
          } else {
            for (const cv of cVlans) {
              cfg += `   switchport vlan translation ${cv} ${sVlan + (cv - cVlans[0])}\n`;
            }
          }
          cfg += l2TunnelLines('   ').join('\n') + (l2TunnelLines('   ').length ? '\n' : '');
        } else if (mode === 'vlan-bundling') {
          cfg += `! ${t('qinq_config.mode_bundling')} - Arista EOS\n`;
          cfg += `!\n`;
          cfg += `vlan ${sVlan}\n`;
          cfg += `   name BUNDLE_S-VLAN_${sVlan}\n`;
          cfg += `!\n`;
          cfg += `interface ${iface}\n`;
          cfg += `   description Customer Port - VLAN Bundle\n`;
          cfg += `   switchport\n`;
          cfg += `   switchport mode dot1q-tunnel\n`;
          cfg += `   switchport access vlan ${sVlan}\n`;
          cfg += `   spanning-tree port type edge\n`;
          cfg += `!\n`;
          cfg += `! ${t('qinq_config.bundled_vlans')}: ${vlanList}\n`;
          cfg += `! All C-VLANs are encapsulated within S-VLAN ${sVlan}\n`;
          cfg += l2TunnelLines('   ').join('\n') + (l2TunnelLines('   ').length ? '\n' : '');
        }
        return cfg;
      }

      default:
        return '';
    }
  }, [mode, platform, cVlans, sVlan, interfaceName, tpid, tunnelCDP, tunnelSTP, tunnelVTP, tunnelLACP, vlanError, t]);

  const configOutput = useMemo(() => generateConfig(), [generateConfig]);

  // ── Frame structure visualization ─────────────────────────
  const FrameTag = ({ label, bits, value, color }) => {
    const widthPct = (bits / 32) * 100;
    return (
      <div style={{
        display: 'inline-block',
        width: `${widthPct}%`,
        background: color,
        textAlign: 'center',
        padding: '6px 2px',
        fontSize: 11,
        fontFamily: 'var(--mono)',
        color: '#000',
        borderRadius: 2,
        borderRight: '1px solid rgba(0,0,0,0.15)',
        boxSizing: 'border-box',
        verticalAlign: 'top'
      }}>
        <div style={{ fontWeight: 700, fontSize: 10, opacity: 0.7 }}>{label}</div>
        <div style={{ fontWeight: 600, fontSize: 12 }}>{value}</div>
        <div style={{ fontSize: 9, opacity: 0.6 }}>{bits}b</div>
      </div>
    );
  };

  const FrameRow = ({ title, children, highlight }) => (
    <div style={{ marginBottom: 8 }}>
      <div style={{
        fontSize: 11, fontWeight: 600, marginBottom: 4,
        color: highlight ? 'var(--cyan)' : 'var(--dim)',
        fontFamily: 'var(--mono)'
      }}>
        {title}
      </div>
      <div style={{ display: 'flex', width: '100%', borderRadius: 4, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  );

  const tagPCP = 0;
  const tagDEI = 0;
  const outerTPID = tpid;
  const innerTPID = '0x8100';

  const cvlanHex = cVlans.length > 0 ? `0x${cVlans[0].toString(16).toUpperCase().padStart(3, '0')}` : '---';
  const svlanHex = sVlan ? `0x${sVlan.toString(16).toUpperCase().padStart(3, '0')}` : '---';

  const handleExport = () => {
    const blob = new Blob([configOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qinq-config-${mode}-${platform}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const platformLabels = {
    'cisco-ios': t('qinq_config.platform_cisco_ios'),
    'cisco-nxos': t('qinq_config.platform_cisco_nxos'),
    'junos': t('qinq_config.platform_junos'),
    'arista-eos': t('qinq_config.platform_arista_eos')
  };

  return (
    <div className="fadein">
      {/* Configuration inputs */}
      <div className="card">
        <div className="card-title">{t('qinq_config.title')}</div>

        <div className="two-col grid-mobile-1" style={{ gap: 20, marginBottom: 16 }}>
          <div className="field">
            <label className="label">{t('qinq_config.mode_label')}</label>
            <select className="input" value={mode} onChange={e => setMode(e.target.value)}>
              <option value="selective-qinq">{t('qinq_config.mode_selective')}</option>
              <option value="vlan-translation">{t('qinq_config.mode_translation')}</option>
              <option value="vlan-bundling">{t('qinq_config.mode_bundling')}</option>
            </select>
            <div className="hint">{t('qinq_config.mode_hint')}</div>
          </div>

          <div className="field">
            <label className="label">{t('qinq_config.platform_label')}</label>
            <select className="input" value={platform} onChange={e => setPlatform(e.target.value)}>
              <option value="cisco-ios">{t('qinq_config.platform_cisco_ios')}</option>
              <option value="cisco-nxos">{t('qinq_config.platform_cisco_nxos')}</option>
              <option value="junos">{t('qinq_config.platform_junos')}</option>
              <option value="arista-eos">{t('qinq_config.platform_arista_eos')}</option>
            </select>
          </div>
        </div>

        <div className="three-col grid-mobile-1" style={{ gap: 20, marginBottom: 16 }}>
          <div className="field">
            <label className="label">{t('qinq_config.customer_vlans')}</label>
            <input className="input" value={customerVlans} onChange={e => setCustomerVlans(e.target.value)} placeholder={t('qinq_config.customer_vlans_ph')} />
            <div className="hint">{t('qinq_config.customer_vlans_hint')}</div>
          </div>

          <div className="field">
            <label className="label">{t('qinq_config.service_vlan')}</label>
            <input className="input" type="number" min="1" max="4094" value={serviceVlan} onChange={e => setServiceVlan(e.target.value)} />
            <div className="hint">{t('qinq_config.service_vlan_hint')}</div>
          </div>

          <div className="field">
            <label className="label">{t('qinq_config.interface_label')}</label>
            <input className="input" value={interfaceName} onChange={e => setInterfaceName(e.target.value)} placeholder="GigabitEthernet1/0/1" />
          </div>
        </div>

        <div className="two-col grid-mobile-1" style={{ gap: 20, marginBottom: 16 }}>
          <div className="field">
            <label className="label">{t('qinq_config.tpid_label')}</label>
            <select className="input" value={tpid} onChange={e => setTpid(e.target.value)}>
              <option value="0x8100">{t('qinq_config.tpid_8100')}</option>
              <option value="0x88a8">{t('qinq_config.tpid_88a8')}</option>
            </select>
            <div className="hint">{t('qinq_config.tpid_hint')}</div>
          </div>

          <div className="field">
            <label className="label">{t('qinq_config.l2_tunnel_label')}</label>
            <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={tunnelCDP} onChange={e => setTunnelCDP(e.target.checked)} /> CDP
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={tunnelSTP} onChange={e => setTunnelSTP(e.target.checked)} /> STP
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={tunnelVTP} onChange={e => setTunnelVTP(e.target.checked)} /> VTP
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={tunnelLACP} onChange={e => setTunnelLACP(e.target.checked)} /> LACP
              </label>
            </div>
            <div className="hint">{t('qinq_config.l2_tunnel_hint')}</div>
          </div>
        </div>

        <Err msg={vlanError} />
      </div>

      {/* Frame structure visualization */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">{t('qinq_config.frame_title')}</div>
        <div className="hint" style={{ marginBottom: 16 }}>{t('qinq_config.frame_desc')}</div>

        {/* Hop 1: Ingress (customer side) */}
        <FrameRow title={t('qinq_config.hop_ingress')} highlight>
          <FrameTag label="Dst MAC" bits={48} value="FF:FF:FF:FF:FF:FF" color="#3b82f6" />
          <FrameTag label="Src MAC" bits={48} value="AA:BB:CC:DD:EE:FF" color="#60a5fa" />
          <FrameTag label="EtherType" bits={16} value={innerTPID} color="#f59e0b" />
          <FrameTag label="PCP" bits={3} value={tagPCP} color="#a78bfa" />
          <FrameTag label="DEI" bits={1} value={tagDEI} color="#a78bfa" />
          <FrameTag label="C-VID" bits={12} value={cvlanHex} color="#a78bfa" />
          <FrameTag label="EtherType" bits={16} value="0x0800" color="#64748b" />
          <FrameTag label="Payload" bits={0} value="..." color="#334155" />
        </FrameRow>

        {/* Hop 2: Provider Edge (double-tagged) */}
        {mode !== 'vlan-translation' ? (
          <FrameRow title={t('qinq_config.hop_pe')} highlight>
            <FrameTag label="Dst MAC" bits={48} value="FF:FF:FF:FF:FF:FF" color="#3b82f6" />
            <FrameTag label="Src MAC" bits={48} value="AA:BB:CC:DD:EE:FF" color="#60a5fa" />
            <FrameTag label="S-TPID" bits={16} value={outerTPID} color="#ef4444" />
            <FrameTag label="PCP" bits={3} value={tagPCP} color="#f87171" />
            <FrameTag label="DEI" bits={1} value={tagDEI} color="#f87171" />
            <FrameTag label="S-VID" bits={12} value={svlanHex} color="#f87171" />
            <FrameTag label="C-TPID" bits={16} value={innerTPID} color="#f59e0b" />
            <FrameTag label="PCP" bits={3} value={tagPCP} color="#a78bfa" />
            <FrameTag label="DEI" bits={1} value={tagDEI} color="#a78bfa" />
            <FrameTag label="C-VID" bits={12} value={cvlanHex} color="#a78bfa" />
            <FrameTag label="EtherType" bits={16} value="0x0800" color="#64748b" />
            <FrameTag label="Payload" bits={0} value="..." color="#334155" />
          </FrameRow>
        ) : (
          <FrameRow title={t('qinq_config.hop_pe')} highlight>
            <FrameTag label="Dst MAC" bits={48} value="FF:FF:FF:FF:FF:FF" color="#3b82f6" />
            <FrameTag label="Src MAC" bits={48} value="AA:BB:CC:DD:EE:FF" color="#60a5fa" />
            <FrameTag label="TPID" bits={16} value={innerTPID} color="#f59e0b" />
            <FrameTag label="PCP" bits={3} value={tagPCP} color="#a78bfa" />
            <FrameTag label="DEI" bits={1} value={tagDEI} color="#a78bfa" />
            <FrameTag label="VID" bits={12} value={svlanHex} color="#22c55e" />
            <FrameTag label="EtherType" bits={16} value="0x0800" color="#64748b" />
            <FrameTag label="Payload" bits={0} value="..." color="#334155" />
          </FrameRow>
        )}

        {/* Hop 3: Egress (customer side again) */}
        <FrameRow title={t('qinq_config.hop_egress')}>
          <FrameTag label="Dst MAC" bits={48} value="FF:FF:FF:FF:FF:FF" color="#3b82f6" />
          <FrameTag label="Src MAC" bits={48} value="AA:BB:CC:DD:EE:FF" color="#60a5fa" />
          <FrameTag label="EtherType" bits={16} value={innerTPID} color="#f59e0b" />
          <FrameTag label="PCP" bits={3} value={tagPCP} color="#a78bfa" />
          <FrameTag label="DEI" bits={1} value={tagDEI} color="#a78bfa" />
          <FrameTag label="C-VID" bits={12} value={cvlanHex} color="#a78bfa" />
          <FrameTag label="EtherType" bits={16} value="0x0800" color="#64748b" />
          <FrameTag label="Payload" bits={0} value="..." color="#334155" />
        </FrameRow>

        {/* Byte breakdown */}
        <div style={{ marginTop: 12, padding: '10px 14px', background: 'var(--bg)', borderRadius: 6, fontFamily: 'var(--mono)', fontSize: 11, lineHeight: 1.8 }}>
          <div>
            <span style={{ color: 'var(--dim)' }}>{t('qinq_config.bytes_preamble')}: </span>
            <span>7B preamble + 1B SFD</span>
          </div>
          <div>
            <span style={{ color: 'var(--dim)' }}>{t('qinq_config.bytes_header')}: </span>
            <span>14B (dst 6B + src 6B + ethertype 2B)</span>
          </div>
          {mode !== 'vlan-translation' ? (
            <div>
              <span style={{ color: 'var(--dim)' }}>{t('qinq_config.bytes_tags')}: </span>
              <span>8B (outer tag 4B + inner tag 4B) — {tpid === '0x88a8' ? 'S-TAG 802.1ad' : 'S-TAG 802.1Q'} + C-TAG</span>
            </div>
          ) : (
            <div>
              <span style={{ color: 'var(--dim)' }}>{t('qinq_config.bytes_tags')}: </span>
              <span>4B (single translated tag)</span>
            </div>
          )}
          <div>
            <span style={{ color: 'var(--dim)' }}>{t('qinq_config.bytes_frame')}: </span>
            <span>{mode !== 'vlan-translation' ? '64-1522B' : '64-1518B'} ({t('qinq_config.min_max')})</span>
          </div>
          <div>
            <span style={{ color: 'var(--dim)' }}>{t('qinq_config.bytes_fcs')}: </span>
            <span>4B FCS (CRC-32)</span>
          </div>
        </div>
      </div>

      {/* Generated config */}
      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-title">
          {t('qinq_config.config_title')}
          <span className="badge badge-cyan" style={{ marginLeft: 10, fontSize: 10, padding: '2px 8px' }}>
            {platformLabels[platform]}
          </span>
        </div>

        {configOutput ? (
          <>
            <pre style={{
              background: 'var(--bg)',
              borderRadius: 6,
              padding: '14px 16px',
              fontSize: 12,
              fontFamily: 'var(--mono)',
              lineHeight: 1.6,
              overflowX: 'auto',
              margin: 0,
              border: '1px solid var(--border)'
            }}>
              {configOutput}
            </pre>
            <div className="btn-row" style={{ marginTop: 12 }}>
              <CopyBtn text={configOutput} label={t('qinq_config.copy_config')} id="config" />
              <button className="btn btn-ghost btn-sm" onClick={handleExport}>
                {t('qinq_config.export_txt')}
              </button>
            </div>
          </>
        ) : (
          <div className="hint">{t('qinq_config.fill_fields')}</div>
        )}
      </div>
    </div>
  );
}

window.QinQConfig = QinQConfig;
