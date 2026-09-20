const { useState, useEffect, useMemo, useCallback } = React;

const CONVERTER_PLATFORMS = [
  // Switching/Routing Category
  { id: 'cisco', label: 'vendor_cisco_ios', category: 'network' },
  { id: 'nxos', label: 'Cisco NX-OS', category: 'network' },
  { id: 'junos', label: 'vendor_junos_set', category: 'network' },
  { id: 'comware', label: 'vendor_comware', category: 'network' },
  { id: 'arubacx', label: 'vendor_arubacx', category: 'network' },
  // Firewall Category
  { id: 'asa', label: 'Cisco ASA', category: 'security' },
  { id: 'paloalto', label: 'Palo Alto PAN-OS', category: 'security' },
  { id: 'fortios', label: 'Fortinet FortiOS', category: 'security' },
];

function DeviceConfigConverter({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  // Active Tab: 'converter' or 'cheatsheet'
  const [activeTab, setActiveTab] = usePersistentState('device_converter:tab', initialData?.activeTab ?? 'converter');

  // Input states
  const [sourceVendor, setSourceVendor] = usePersistentState('device_converter:source_vendor', initialData?.sourceVendor ?? 'auto');
  const [targetVendor, setTargetVendor] = usePersistentState('device_converter:target_vendor', initialData?.targetVendor ?? 'junos');
  const [sourceConfig, setSourceConfig] = usePersistentState('device_converter:source_config', initialData?.sourceConfig ?? '');

  // Wire Share System
  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== activeTab) setActiveTab(initialData.activeTab);
  }, [initialData]);

  useEffect(() => { onNav?.({ activeTab }); }, [activeTab]);

  useEffect(() => {
    const handleShareReq = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'device-converter',
        sourceVendor,
        targetVendor,
        sourceConfig
      });
    };
    window.addEventListener('app:request-share', handleShareReq);
    return () => window.removeEventListener('app:request-share', handleShareReq);
  }, [sourceVendor, targetVendor, sourceConfig, onShare]);

  // Normalize interface names (Switching)
  const normalizeInterfaceName = (name) => {
    if (!name) return '';
    return name
      .trim()
      .replace(/\s+/g, '')
      .replace(/^(gi|gig|gigabit)(ethernet)?/i, 'GigabitEthernet')
      .replace(/^(te|ten)(ethernet)?/i, 'TenGigabitEthernet')
      .replace(/^(fo|forty)(ethernet)?/i, 'FortyGigabitEthernet')
      .replace(/^(hu|hundred)(ethernet)?/i, 'HundredGigabitEthernet')
      .replace(/^(fa|fast)(ethernet)?/i, 'FastEthernet')
      .replace(/^(eth|ethernet)/i, 'Ethernet')
      .replace(/^(po|port-channel)/i, 'Port-Channel')
      .replace(/^(ae)/i, 'ae');
  };

  // Helper to parse Cisco Wildcard/Netmask to prefix
  const parseMaskToPrefix = (mask) => {
    if (!mask || mask === 'any') return '';
    const octets = mask.trim().split('.').map(Number);
    if (octets.length !== 4) return '';
    let isWildcard = octets[0] === 0 && octets[3] !== 0;
    let val = 0;
    if (isWildcard) {
      val = octets.reduce((acc, o) => acc + (255 - o), 0);
    } else {
      val = octets.reduce((acc, o) => acc + o, 0);
    }
    let bits = 0;
    let o = val;
    while (o > 0) {
      bits += o & 1;
      o = o >> 1;
    }
    return bits || 24;
  };

  // Parser selector (pure function returning vendor and category info, avoiding rendering-phase state updates)
  const parseSourceConfig = useCallback((configText, vendor) => {
    const lines = configText.split('\n');
    
    let actualCategory = 'network';
    let actualVendor = 'cisco';

    if (vendor === 'auto') {
      let scoreCisco = 0;
      let scoreJunos = 0;
      let scoreComware = 0;
      let scoreAruba = 0;
      let scoreASA = 0;
      let scorePalo = 0;
      let scoreForti = 0;

      for (let line of lines) {
        line = line.trim();
        if (line.match(/^switchport/i) || line.match(/^spanning-tree/i)) scoreCisco += 3;
        if (line.match(/^set\s+interfaces/i) || line.match(/^set\s+vlans/i) || line.includes('family ethernet-switching')) scoreJunos += 5;
        if (line.match(/^port\s+link-type/i) || line.match(/^port\s+access\s+vlan/i) || line.match(/^stp\s+edged-port/i)) scoreComware += 5;
        if (line.match(/^vlan\s+access/i) || line.match(/^vlan\s+trunk/i)) scoreAruba += 5;
        if (line.match(/^access-list\s+\w+\s+extended/i) || line.match(/^object\s+network/i)) scoreASA += 6;
        if (line.match(/^set\s+rulebase\s+security/i) || line.match(/^set\s+device-group/i)) scorePalo += 6;
        if (line.match(/^config\s+firewall\s+policy/i) || line.match(/^set\s+srcaddr/i)) scoreForti += 6;
      }

      const scores = [
        { id: 'cisco', val: scoreCisco, cat: 'network' },
        { id: 'junos', val: scoreJunos, cat: 'network' },
        { id: 'comware', val: scoreComware, cat: 'network' },
        { id: 'arubacx', val: scoreAruba, cat: 'network' },
        { id: 'asa', val: scoreASA, cat: 'security' },
        { id: 'paloalto', val: scorePalo, cat: 'security' },
        { id: 'fortios', val: scoreForti, cat: 'security' },
      ];

      scores.sort((a, b) => b.val - a.val);
      if (scores[0].val > 0) {
        actualVendor = scores[0].id;
        actualCategory = scores[0].cat;
      }
    } else {
      actualVendor = vendor;
      const found = CONVERTER_PLATFORMS.find(p => p.id === vendor);
      actualCategory = found ? found.category : 'network';
    }

    // Initial Output Structures
    const result = {
      vendor: actualVendor,
      category: actualCategory,
      hostname: '',
      // Switching
      vlans: {},
      interfaces: {},
      // Firewall Rules
      rules: [],
      warnings: [],
      convertedLinesCount: 0,
      ignoredLinesCount: 0
    };

    let activeIface = null;
    let activeVlanId = null;
    let activeFWPolicyId = null;

    lines.forEach((originalLine, lineIdx) => {
      const line = originalLine.trim();
      if (!line || line.startsWith('!') || line.startsWith('#') || line.startsWith('/*')) {
        return;
      }

      let parsed = false;

      // -------------------------------------------------------------
      // FIREWALL SECURITY POLICY PARSING
      // -------------------------------------------------------------
      if (actualCategory === 'security') {
        if (actualVendor === 'asa') {
          const aclMatch = line.match(/^access-list\s+(\w+)\s+extended\s+(permit|deny)\s+(\w+)\s+(any|host\s+[\d\.]+|[\d\.]+\s+[\d\.]+)\s+(any|host\s+[\d\.]+|[\d\.]+\s+[\d\.]+)(?:\s+eq\s+(\w+|\d+))?/i);
          if (aclMatch) {
            result.rules.push({
              name: aclMatch[1],
              action: aclMatch[2].toLowerCase() === 'permit' ? 'allow' : 'deny',
              proto: aclMatch[3].toLowerCase(),
              src: aclMatch[4].replace('host ', '').trim(),
              dst: aclMatch[5].replace('host ', '').trim(),
              port: aclMatch[6] || 'any'
            });
            parsed = true;
          }
        } else if (actualVendor === 'paloalto') {
          const ruleMatch = line.match(/^set\s+rulebase\s+security\s+rules\s+([\w\-]+)\s+(source|destination|service|action)\s+(.+)$/i);
          if (ruleMatch) {
            const ruleName = ruleMatch[1];
            const key = ruleMatch[2];
            const val = ruleMatch[3].trim();

            let rule = result.rules.find(r => r.name === ruleName);
            if (!rule) {
              rule = { name: ruleName, src: 'any', dst: 'any', port: 'any', proto: 'ip', action: 'allow' };
              result.rules.push(rule);
            }

            if (key === 'source') {
              rule.src = val.replace(/\[|\]/g, '').trim();
            } else if (key === 'destination') {
              rule.dst = val.replace(/\[|\]/g, '').trim();
            } else if (key === 'service') {
              rule.port = val.replace('service-', '');
            } else if (key === 'action') {
              rule.action = val === 'allow' ? 'allow' : 'deny';
            }
            parsed = true;
          }
        } else if (actualVendor === 'fortios') {
          if (line.match(/^edit\s+(\d+)/i)) {
            activeFWPolicyId = line.match(/^edit\s+(\d+)/i)[1];
            result.rules.push({ name: `Policy_${activeFWPolicyId}`, src: 'any', dst: 'any', port: 'any', proto: 'ip', action: 'allow' });
            parsed = true;
          } else if (activeFWPolicyId) {
            const latestRule = result.rules[result.rules.length - 1];
            const srcMatch = line.match(/^set\s+srcaddr\s+["']?([^"']+)["']?/i);
            const dstMatch = line.match(/^set\s+dstaddr\s+["']?([^"']+)["']?/i);
            const actionMatch = line.match(/^set\s+action\s+(accept|deny)/i);
            const serviceMatch = line.match(/^set\s+service\s+["']?([^"']+)["']?/i);

            if (srcMatch) { latestRule.src = srcMatch[1]; parsed = true; }
            if (dstMatch) { latestRule.dst = dstMatch[1]; parsed = true; }
            if (serviceMatch) { latestRule.port = serviceMatch[1]; parsed = true; }
            if (actionMatch) {
              latestRule.action = actionMatch[1] === 'accept' ? 'allow' : 'deny';
              parsed = true;
            }

            if (line === 'next' || line === 'end') {
              activeFWPolicyId = null;
            }
          }
        }
      }

      // -------------------------------------------------------------
      // SWITCHING/ROUTING CONFIG PARSING
      // -------------------------------------------------------------
      else {
        if (actualVendor === 'junos') {
          if (line.startsWith('set ')) {
            const hostnameMatch = line.match(/^set\s+(?:system\s+host-name|groups\s+global\s+system\s+host-name)\s+([\w\-]+)/i);
            if (hostnameMatch) {
              result.hostname = hostnameMatch[1];
              parsed = true;
            }

            const vlanMatch = line.match(/^set\s+vlans\s+([\w\-]+)\s+vlan-id\s+(\d+)/i);
            if (vlanMatch) {
              result.vlans[vlanMatch[2]] = vlanMatch[1];
              parsed = true;
            }

            const ifaceMatch = line.match(/^set\s+interfaces\s+([\w\-\/\:\.]+)\s+(.+)$/i);
            if (ifaceMatch) {
              const ifaceName = normalizeInterfaceName(ifaceMatch[1].split('.')[0]);
              const command = ifaceMatch[2].trim();

              if (!result.interfaces[ifaceName]) {
                result.interfaces[ifaceName] = { name: ifaceName, mode: 'access', shutdown: false };
              }
              const iface = result.interfaces[ifaceName];

              const descMatch = command.match(/^description\s+["']?([^"']+)["']?/i);
              if (descMatch) {
                iface.description = descMatch[1];
                parsed = true;
              }

              if (command === 'disable') {
                iface.shutdown = true;
                parsed = true;
              }

              const modeMatch = command.match(/interface-mode\s+(access|trunk)/i);
              if (modeMatch) {
                iface.mode = modeMatch[1];
                parsed = true;
              }

              const vlanMemberMatch = command.match(/vlan\s+members\s+\[?\s*([\w\-\s]+)\s*\]?/i);
              if (vlanMemberMatch) {
                const vlanVal = vlanMemberMatch[1].trim();
                if (iface.mode === 'trunk') {
                  iface.allowedVlans = (iface.allowedVlans ? iface.allowedVlans + ',' : '') + vlanVal.replace(/\s+/g, ',');
                } else {
                  iface.accessVlan = vlanVal;
                }
                parsed = true;
              }

              const nativeMatch = command.match(/native-vlan-id\s+(\d+)/i);
              if (nativeMatch) {
                iface.nativeVlan = nativeMatch[1];
                parsed = true;
              }

              const lagMatch = command.match(/(?:ether-options|gigether-options)\s+802\.3ad\s+(\w+)/i);
              if (lagMatch) {
                iface.lagGroup = lagMatch[1].replace('ae', '');
                iface.lagMode = 'active';
                parsed = true;
              }
            }
          }
        } else {
          const hostnameMatch = line.match(/^hostname\s+([\w\-]+)/i);
          if (hostnameMatch) {
            result.hostname = hostnameMatch[1];
            parsed = true;
          }

          const vlanContextMatch = line.match(/^vlan\s+(\d+)/i);
          if (vlanContextMatch) {
            activeVlanId = vlanContextMatch[1];
            result.vlans[activeVlanId] = `VLAN${activeVlanId}`;
            parsed = true;
          } else if (activeVlanId && line.match(/^name\s+(.+)/i)) {
            const nameMatch = line.match(/^name\s+(.+)/i);
            result.vlans[activeVlanId] = nameMatch[1];
            parsed = true;
            activeVlanId = null;
          }

          const ifaceContextMatch = line.match(/^interface\s+([\w\-\/\.\s]+)/i);
          if (ifaceContextMatch) {
            activeIface = normalizeInterfaceName(ifaceContextMatch[1]);
            if (!result.interfaces[activeIface]) {
              result.interfaces[activeIface] = { name: activeIface, mode: 'access', shutdown: false };
            }
            parsed = true;
            return;
          }

          if (activeIface) {
            const iface = result.interfaces[activeIface];

            if (line.match(/^(router|line|control-plane|snmp|logging|ntp|clock|service|ip route)/i)) {
              activeIface = null;
              return;
            }

            const descMatch = line.match(/^description\s+(.+)/i);
            if (descMatch) {
              iface.description = descMatch[1];
              parsed = true;
            }

            if (line === 'shutdown') {
              iface.shutdown = true;
              parsed = true;
            } else if (line === 'no shutdown') {
              iface.shutdown = false;
              parsed = true;
            }

            const modeMatch = line.match(/^(?:switchport\s+mode|no\s+routing|vlan\s+access|vlan\s+trunk)\s+(access|trunk)/i) || line.match(/^(port\s+link-type)\s+(access|trunk)/i);
            if (modeMatch) {
              iface.mode = modeMatch[1] === 'port link-type' ? modeMatch[2] : modeMatch[1];
              parsed = true;
            }

            const accessVlanMatch = line.match(/^(?:switchport\s+access\s+vlan|vlan\s+access|port\s+access\s+vlan)\s+(\d+)/i);
            if (accessVlanMatch) {
              iface.accessVlan = accessVlanMatch[1];
              parsed = true;
            }

            const allowedVlansMatch = line.match(/^(?:switchport\s+trunk\s+allowed\s+vlan|vlan\s+trunk\s+allowed|port\s+trunk\s+permit\s+vlan)\s+(.+)/i);
            if (allowedVlansMatch) {
              iface.allowedVlans = allowedVlansMatch[1].replace(/add\s+/i, '').trim();
              parsed = true;
            }

            const nativeVlanMatch = line.match(/^(?:switchport\s+trunk\s+native\s+vlan|vlan\s+trunk\s+native|port\s+trunk\s+pvid\s+vlan)\s+(\d+)/i);
            if (nativeVlanMatch) {
              iface.nativeVlan = nativeVlanMatch[1];
              parsed = true;
            }

            const lagMatch = line.match(/^(?:channel-group|port-group|port\s+link-aggregation\s+group)\s+(\d+)(?:\s+mode\s+(\w+))?/i) || line.match(/^lag\s+(\d+)/i);
            if (lagMatch) {
              iface.lagGroup = lagMatch[1];
              iface.lagMode = lagMatch[2] || 'active';
              parsed = true;
            }

            if (line.match(/^spanning-tree\s+portfast/i) || line.match(/^stp\s+edged-port/i)) {
              iface.stpPortfast = true;
              parsed = true;
            }
            if (line.match(/^spanning-tree\s+bpduguard/i) || line.match(/^stp\s+port\s+bpdu-protection/i)) {
              iface.stpBpduguard = true;
              parsed = true;
            }

            const ipMatch = line.match(/^ip\s+address\s+([\d\.]+)\s+([\d\.]+)/i);
            if (ipMatch) {
              iface.ipAddress = `${ipMatch[1]} ${ipMatch[2]}`;
              parsed = true;
            }
          }
        }
      }

      if (parsed) {
        result.convertedLinesCount++;
      } else {
        result.ignoredLinesCount++;
        if (line !== 'end' && line !== 'exit' && line !== '#') {
          result.warnings.push({
            lineNum: lineIdx + 1,
            text: originalLine,
            reason: t('device_converter.warning_skipped')
          });
        }
      }
    });

    return result;
  }, [t]);

  // Derived properties from parsed configuration, avoiding state updates during render
  const parsedConfig = useMemo(() => {
    return parseSourceConfig(sourceConfig, sourceVendor);
  }, [sourceConfig, sourceVendor, parseSourceConfig]);

  const detectedVendor = parsedConfig.vendor;
  const detectedCategory = parsedConfig.category || 'network';

  // Generate target CLI output
  const generatedTargetOutput = useMemo(() => {
    if (!sourceConfig.trim()) return '';

    const parsed = parsedConfig; // Use already derived parsedConfig
    let output = [];

    output.push(`! ============================================================`);
    output.push(`! ${t('device_converter.generated_prefix')} ${targetVendor.toUpperCase()}`);
    output.push(`! ${t('device_converter.source_detected')}: ${detectedVendor?.toUpperCase()}`);
    output.push(`! ============================================================`);
    output.push('');

    // FIREWALL TRANSLATION
    if (parsed.category === 'security') {
      if (targetVendor === 'asa') {
        parsed.rules.forEach(r => {
          output.push(`access-list OUTSIDE_IN extended ${r.action} ${r.proto} any host ${r.dst} ${r.port !== 'any' ? 'eq ' + r.port : ''}`);
        });
      } else if (targetVendor === 'paloalto') {
        parsed.rules.forEach((r, idx) => {
          const ruleId = r.name || `RULE_${idx + 1}`;
          output.push(`set rulebase security rules ${ruleId} from any to any source ${r.src} destination ${r.dst} service ${r.port !== 'any' ? 'service-' + r.port : 'any'} action ${r.action}`);
        });
      } else if (targetVendor === 'fortios') {
        output.push(`config firewall policy`);
        parsed.rules.forEach((r, idx) => {
          output.push(`  edit ${idx + 1}`);
          output.push(`    set srcaddr "${r.src}"`);
          output.push(`    set dstaddr "${r.dst}"`);
          output.push(`    set service "${r.port.toUpperCase()}"`);
          output.push(`    set action ${r.action === 'allow' ? 'accept' : 'deny'}`);
          output.push(`  next`);
        });
        output.push(`end`);
      } else {
        output.push(`! Invalid security platform choice`);
      }
      return output.join('\n');
    }

    // SWITCHING TRANSLATION
    if (parsed.hostname) {
      if (targetVendor === 'junos') {
        output.push(`set system host-name ${parsed.hostname}`);
      } else if (targetVendor === 'comware') {
        output.push(`sysname ${parsed.hostname}`);
      } else {
        output.push(`hostname ${parsed.hostname}`);
      }
      output.push('');
    }

    const vlanIds = Object.keys(parsed.vlans).sort((a, b) => parseInt(a) - parseInt(b));
    if (vlanIds.length > 0) {
      output.push(`! --- VLAN Definitions ---`);
      vlanIds.forEach(vid => {
        const vname = parsed.vlans[vid];
        if (targetVendor === 'junos') {
          output.push(`set vlans ${vname} vlan-id ${vid}`);
        } else if (targetVendor === 'comware' || targetVendor === 'arubacx') {
          output.push(`vlan ${vid}`);
          output.push(` name ${vname}`);
        } else {
          output.push(`vlan ${vid}`);
          output.push(` name ${vname}`);
        }
      });
      output.push('');
    }

    const ifaceNames = Object.keys(parsed.interfaces).sort();
    if (ifaceNames.length > 0) {
      output.push(`! --- Interface Configurations ---`);
      ifaceNames.forEach(iname => {
        const iface = parsed.interfaces[iname];

        if (targetVendor === 'junos') {
          if (iface.description) {
            output.push(`set interfaces ${iname} description "${iface.description}"`);
          }
          if (iface.shutdown) {
            output.push(`set interfaces ${iname} disable`);
          }

          if (iface.ipAddress) {
            const [ip, mask] = iface.ipAddress.split(' ');
            output.push(`set interfaces ${iname} unit 0 family inet address ${ip}/${calculateCIDRPrefix(mask)}`);
          } else {
            if (iface.mode === 'trunk') {
              output.push(`set interfaces ${iname} unit 0 family ethernet-switching interface-mode trunk`);
              if (iface.allowedVlans) {
                const vlanArr = sanitizeVlanList(iface.allowedVlans);
                output.push(`set interfaces ${iname} unit 0 family ethernet-switching vlan members [ ${vlanArr.join(' ')} ]`);
              }
              if (iface.nativeVlan) {
                output.push(`set interfaces ${iname} unit 0 family ethernet-switching native-vlan-id ${iface.nativeVlan}`);
              }
            } else {
              output.push(`set interfaces ${iname} unit 0 family ethernet-switching interface-mode access`);
              if (iface.accessVlan) {
                output.push(`set interfaces ${iname} unit 0 family ethernet-switching vlan members ${iface.accessVlan}`);
              }
            }
          }

          if (iface.lagGroup) {
            output.push(`set interfaces ${iname} ether-options 802.3ad ae${iface.lagGroup}`);
          }
          if (iface.stpPortfast) {
            output.push(`set protocols rstp interface ${iname} edge`);
          }
          if (iface.stpBpduguard) {
            output.push(`set protocols rstp interface ${iname} bpdu-block-on-edge`);
          }

        } else if (targetVendor === 'comware') {
          output.push(`interface ${iname}`);
          if (iface.description) {
            output.push(` description ${iface.description}`);
          }
          if (iface.mode === 'trunk') {
            output.push(` port link-type trunk`);
            if (iface.allowedVlans) {
              output.push(` port trunk permit vlan ${iface.allowedVlans}`);
            }
            if (iface.nativeVlan) {
              output.push(` port trunk pvid vlan ${iface.nativeVlan}`);
            }
          } else {
            output.push(` port link-type access`);
            if (iface.accessVlan) {
              output.push(` port access vlan ${iface.accessVlan}`);
            }
          }
          if (iface.lagGroup) {
            output.push(` port link-aggregation group ${iface.lagGroup}`);
          }
          if (iface.stpPortfast) {
            output.push(` stp edged-port`);
          }
          if (iface.stpBpduguard) {
            output.push(` stp port bpdu-protection enable`);
          }
          if (iface.shutdown) {
            output.push(` shutdown`);
          } else {
            output.push(` undo shutdown`);
          }

        } else if (targetVendor === 'arubacx') {
          output.push(`interface ${iname}`);
          if (iface.description) {
            output.push(` description ${iface.description}`);
          }
          if (iface.mode === 'trunk') {
            output.push(` routing`);
            output.push(` no routing`);
            output.push(` vlan trunk native ${iface.nativeVlan || 1}`);
            if (iface.allowedVlans) {
              output.push(` vlan trunk allowed ${iface.allowedVlans}`);
            }
          } else {
            output.push(` routing`);
            output.push(` no routing`);
            if (iface.accessVlan) {
              output.push(` vlan access ${iface.accessVlan}`);
            }
          }
          if (iface.lagGroup) {
            output.push(` lag ${iface.lagGroup}`);
          }
          if (iface.stpPortfast) {
            output.push(` spanning-tree portfast`);
          }
          if (iface.stpBpduguard) {
            output.push(` spanning-tree bpdu-guard`);
          }
          if (iface.shutdown) {
            output.push(` shutdown`);
          } else {
            output.push(` no shutdown`);
          }

        } else if (targetVendor === 'nxos') {
          output.push(`interface ${iname}`);
          if (iface.description) {
            output.push(` description ${iface.description}`);
          }
          if (iface.mode === 'trunk') {
            output.push(` switchport mode trunk`);
            if (iface.allowedVlans) {
              output.push(` switchport trunk allowed vlan ${iface.allowedVlans}`);
            }
            if (iface.nativeVlan) {
              output.push(` switchport trunk native vlan ${iface.nativeVlan}`);
            }
          } else {
            output.push(` switchport mode access`);
            if (iface.accessVlan) {
              output.push(` switchport access vlan ${iface.accessVlan}`);
            }
          }
          if (iface.lagGroup) {
            output.push(` channel-group ${iface.lagGroup} mode active`);
          }
          if (iface.stpPortfast) {
            output.push(` spanning-tree port type edge`);
          }
          if (iface.stpBpduguard) {
            output.push(` spanning-tree bpduguard enable`);
          }
          if (iface.shutdown) {
            output.push(` shutdown`);
          } else {
            output.push(` no shutdown`);
          }
        } else {
          output.push(`interface ${iname}`);
          if (iface.description) {
            output.push(` description ${iface.description}`);
          }
          if (iface.mode === 'trunk') {
            output.push(` switchport mode trunk`);
            if (iface.allowedVlans) {
              output.push(` switchport trunk allowed vlan ${iface.allowedVlans}`);
            }
            if (iface.nativeVlan) {
              output.push(` switchport trunk native vlan ${iface.nativeVlan}`);
            }
          } else {
            output.push(` switchport mode access`);
            if (iface.accessVlan) {
              output.push(` switchport access vlan ${iface.accessVlan}`);
            }
          }
          if (iface.lagGroup) {
            output.push(` channel-group ${iface.lagGroup} mode active`);
          }
          if (iface.stpPortfast) {
            output.push(` spanning-tree portfast edge`);
          }
          if (iface.stpBpduguard) {
            output.push(` spanning-tree bpduguard enable`);
          }
          if (iface.shutdown) {
            output.push(` shutdown`);
          } else {
            output.push(` no shutdown`);
          }
        }
        output.push('!');
      });
    }

    return output.join('\n');
  }, [sourceConfig, sourceVendor, targetVendor, parsedConfig, detectedVendor, t]);

  const sanitizeVlanList = (listStr) => {
    return listStr.split(/[\s,]+/).map(v => v.trim()).filter(Boolean);
  };

  const calculateCIDRPrefix = (mask) => {
    if (!mask) return 24;
    const octets = mask.split('.').map(Number);
    if (octets.length !== 4) return 24;
    let bits = 0;
    octets.forEach(o => {
      while (o > 0) {
        bits += o & 1;
        o = o >> 1;
      }
    });
    return bits;
  };

  const [copied, copy] = useCopy();

  const handleDownload = () => {
    const blob = new Blob([generatedTargetOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `converted_${targetVendor}_config.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Dynamically filter destination platforms based on the detected source type
  const targetPlatformsFiltered = useMemo(() => {
    return CONVERTER_PLATFORMS.filter(p => p.category === detectedCategory);
  }, [detectedCategory]);

  // Ensure target platform remains in the valid subset, or falls back to first matching entry
  useEffect(() => {
    const isTargetValid = targetPlatformsFiltered.some(p => p.id === targetVendor);
    if (!isTargetValid && targetPlatformsFiltered.length > 0) {
      setTargetVendor(targetPlatformsFiltered[0].id);
    }
  }, [targetPlatformsFiltered, targetVendor, setTargetVendor]);

  return (
    <div className="fadein">
      <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', paddingBottom: '0.5rem' }}>
        <button
          className={`btn ${activeTab === 'converter' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('converter')}
        >
          {t('device_converter.tab_converter')}
        </button>
        <button
          className={`btn ${activeTab === 'cheatsheet' ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setActiveTab('cheatsheet')}
        >
          {t('device_converter.tab_cheatsheet')}
        </button>
      </div>

      {activeTab === 'converter' && (
        <div>
          {/* Top selection controls card */}
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <div className="two-col" style={{ gap: '1.5rem' }}>
              <div className="field">
                <label className="label" style={{ color: 'var(--primary)', fontWeight: 500 }}>{t('device_converter.source_platform')}</label>
                <select
                  className="select"
                  value={sourceVendor}
                  onChange={e => setSourceVendor(e.target.value)}
                >
                  <option value="auto">{t('device_converter.vendor_auto')}</option>
                  {CONVERTER_PLATFORMS.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.label.startsWith('vendor_') ? t(`device_converter.${p.label}`) : p.label}
                    </option>
                  ))}
                </select>
                {sourceVendor === 'auto' && detectedVendor && (
                  <span className="hint" style={{ fontSize: '0.8rem', color: 'var(--primary)' }}>
                    {t('device_converter.detected_hint')}: <strong>{detectedVendor.toUpperCase()}</strong> ({detectedCategory === 'security' ? 'Firewall' : 'Switch/Router'})
                  </span>
                )}
              </div>

              <div className="field">
                <label className="label" style={{ color: 'var(--primary)', fontWeight: 500 }}>{t('device_converter.target_platform')}</label>
                <select
                  className="select"
                  value={targetVendor}
                  onChange={e => setTargetVendor(e.target.value)}
                >
                  {targetPlatformsFiltered.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.label.startsWith('vendor_') ? t(`device_converter.${p.label}`) : p.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Configuration Split */}
          <div className="two-col" style={{ gap: '1.5rem' }}>
            <div className="card">
              <h3 className="card-title">{t('device_converter.input_config')}</h3>
              <textarea
                className="input"
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: '0.85rem',
                  minHeight: '450px',
                  width: '100%',
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  border: '1px solid var(--border)',
                  padding: '0.75rem',
                  borderRadius: 'var(--radius)',
                  transition: 'border-color 0.2s',
                  lineHeight: '1.4',
                  resize: 'vertical'
                }}
                placeholder={detectedCategory === 'security' ? "access-list OUTSIDE extended permit tcp any host 10.1.1.10 eq 80" : t('device_converter.input_placeholder')}
                value={sourceConfig}
                onChange={e => setSourceConfig(e.target.value)}
              />
            </div>

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <h3 className="card-title" style={{ margin: 0 }}>{t('device_converter.output_config')}</h3>
                <div className="btn-row">
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={handleDownload}
                    disabled={!generatedTargetOutput}
                    style={{ border: '1px solid var(--border)' }}
                  >
                    {t('common.export')}
                  </button>
                  <button
                    className={`btn btn-sm ${copied ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => copy(generatedTargetOutput)}
                    disabled={!generatedTargetOutput}
                    style={{ border: copied ? 'none' : '1px solid var(--border)' }}
                  >
                    {copied ? t('common.copied') : t('common.copy_all')}
                  </button>
                </div>
              </div>
              <pre
                style={{
                  fontFamily: 'var(--mono)',
                  fontSize: '0.85rem',
                  minHeight: '450px',
                  maxHeight: '600px',
                  overflowY: 'auto',
                  background: 'var(--panel)',
                  border: '1px solid var(--border)',
                  padding: '1rem',
                  borderRadius: 'var(--radius)',
                  whiteSpace: 'pre-wrap',
                  color: 'var(--text)',
                  lineHeight: '1.4'
                }}
              >
                {generatedTargetOutput || t('device_converter.empty_state')}
              </pre>
            </div>
          </div>

          {/* Validation/Report logs */}
          {sourceConfig.trim() && (
            <div className="card" style={{ marginTop: '2rem' }}>
              <h3 className="card-title">{t('device_converter.conversion_report')}</h3>
              <div style={{ display: 'flex', gap: '1rem', marginBottom: '1.25rem' }}>
                <span className="badge badge-green" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem' }}>
                  {t('device_converter.report_converted', { count: parsedConfig.convertedLinesCount })}
                </span>
                <span className="badge badge-yellow" style={{ padding: '0.4rem 0.8rem', fontSize: '0.85rem', color: '#000' }}>
                  {t('device_converter.report_ignored', { count: parsedConfig.ignoredLinesCount })}
                </span>
              </div>

              {parsedConfig.warnings.length > 0 ? (
                <div style={{ overflowX: 'auto', borderRadius: 'var(--spacing-radius)', border: '1px solid var(--border)' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', background: 'rgba(0,0,0,0.2)' }}>
                    <thead>
                      <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', background: 'rgba(255,255,255,0.02)' }}>
                        <th style={{ padding: '0.75rem', width: '10%' }}>{t('device_converter.col_line')}</th>
                        <th style={{ padding: '0.75rem', width: '40%' }}>{t('device_converter.col_original')}</th>
                        <th style={{ padding: '0.75rem', width: '50%' }}>{t('device_converter.col_reason')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {parsedConfig.warnings.map((w, idx) => (
                        <tr key={idx} style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}>
                          <td style={{ padding: '0.75rem', fontFamily: 'var(--typography-mono)', color: 'var(--text-hint)' }}>#{w.lineNum}</td>
                          <td style={{ padding: '0.75rem', fontFamily: 'var(--typography-mono)', color: 'var(--error)', fontSize: '0.85rem' }}>
                            <code>{w.text}</code>
                          </td>
                          <td style={{ padding: '0.75rem', color: 'var(--text-hint)', fontSize: '0.9rem' }}>{w.reason}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--secondary)' }}>
                  <span style={{ fontSize: '1.2rem' }}>✓</span>
                  <span>{t('device_converter.no_warnings')}</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'cheatsheet' && (
        <div>
          {/* Switching Cheat Sheet */}
          <div className="card">
            <h3 className="card-title">{t('device_converter.cheatsheet_title')} ({t('common.utility_tools')})</h3>
            <div style={{ overflowX: 'auto', borderRadius: 'var(--spacing-radius)', border: '1px solid var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', background: 'rgba(0,0,0,0.1)' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', background: 'rgba(255,255,255,0.03)' }}>
                    <th style={{ padding: '0.85rem', width: '20%' }}>{t('device_converter.feature')}</th>
                    <th style={{ padding: '0.85rem', width: '25%', color: 'var(--primary)' }}>{t('device_converter.vendor_cisco')}</th>
                    <th style={{ padding: '0.85rem', width: '30%', color: 'var(--secondary)' }}>{t('device_converter.vendor_junos')}</th>
                    <th style={{ padding: '0.85rem', width: '25%', color: 'var(--warning)' }}>{t('device_converter.vendor_arubacx')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.85rem', fontWeight: 'bold' }}>{t('device_converter.feature_access')}</td>
                    <td><code>switchport mode access</code><br/><code>switchport access vlan 100</code></td>
                    <td><code>set interfaces ge-0/0/0 unit 0 family ethernet-switching interface-mode access</code><br/><code>set interfaces ge-0/0/0 unit 0 family ethernet-switching vlan members 100</code></td>
                    <td><code>vlan access 100</code></td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.85rem', fontWeight: 'bold' }}>{t('device_converter.feature_trunk')}</td>
                    <td><code>switchport mode trunk</code><br/><code>switchport trunk allowed vlan 10,20</code></td>
                    <td><code>set interfaces ge-0/0/0 unit 0 family ethernet-switching interface-mode trunk</code><br/><code>set interfaces ge-0/0/0 unit 0 family ethernet-switching vlan members [ 10 20 ]</code></td>
                    <td><code>vlan trunk allowed 10,20</code></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Firewall Cheat Sheet */}
          <div className="card" style={{ marginTop: '1.5rem' }}>
            <h3 className="card-title">Firewall Policy / Rules Reference</h3>
            <div style={{ overflowX: 'auto', borderRadius: 'var(--spacing-radius)', border: '1px solid var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', background: 'rgba(0,0,0,0.1)' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left', background: 'rgba(255,255,255,0.03)' }}>
                    <th style={{ padding: '0.85rem', width: '20%' }}>Platform</th>
                    <th style={{ padding: '0.85rem', width: '80%', color: 'var(--tertiary)' }}>Configuration Syntax</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.85rem', fontWeight: 'bold' }}>Cisco ASA ACL</td>
                    <td style={{ padding: '0.85rem' }}>
                      <code>access-list acl_name extended permit tcp any host 10.1.1.10 eq 80</code>
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.85rem', fontWeight: 'bold' }}>Palo Alto PAN-OS</td>
                    <td style={{ padding: '0.85rem' }}>
                      <code>set rulebase security rules RULE_1 source any destination 10.1.1.10 service service-80 action allow</code>
                    </td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.85rem', fontWeight: 'bold' }}>Fortinet FortiOS</td>
                    <td style={{ padding: '0.85rem' }}>
                      <code>config firewall policy</code><br/>
                      <code>&nbsp;&nbsp;edit 1</code><br/>
                      <code>&nbsp;&nbsp;&nbsp;&nbsp;set srcaddr "any"</code><br/>
                      <code>&nbsp;&nbsp;&nbsp;&nbsp;set dstaddr "10.1.1.10"</code><br/>
                      <code>&nbsp;&nbsp;&nbsp;&nbsp;set service "80"</code><br/>
                      <code>&nbsp;&nbsp;&nbsp;&nbsp;set action accept</code><br/>
                      <code>&nbsp;&nbsp;next</code><br/>
                      <code>end</code>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.DeviceConfigConverter = DeviceConfigConverter;
window.SwitchConfigConverter = DeviceConfigConverter; // Keep fallback to prevent load failures during refactor
