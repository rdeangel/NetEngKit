const { useState, useEffect, useMemo } = React;

// ── NAT/PAT Calculator — Unified Translation Flow ─────────────────────────────

function parsePool(str) {
  if (!str) return null;
  const trimmed = str.trim();

  const parts = trimmed.split('-');
  if (parts.length === 2) {
    const s = IPv4.parse(parts[0]), e = IPv4.parse(parts[1]);
    if (s !== null && e !== null && s <= e) {
      const total = e - s + 1;
      return {
        list: Array.from({ length: Math.min(total, 256) }, (_, i) => IPv4.str(s + i)),
        total, start: parts[0], end: parts[1], prefix: null, mask: null,
      };
    }
  }

  const cidr = IPv4.parseCIDR(trimmed);
  if (cidr) {
    const sub = IPv4.subnet(cidr.ip, cidr.prefix);
    const sn = sub.firstHost, en = sub.lastHost;
    const total = en - sn + 1;
    return {
      list: Array.from({ length: Math.min(total, 256) }, (_, i) => IPv4.str(sn + i)),
      total, start: IPv4.str(sn), end: IPv4.str(en), prefix: cidr.prefix, mask: sub.maskStr,
    };
  }

  const single = IPv4.parse(trimmed);
  if (single !== null) {
    return { list: [trimmed], total: 1, start: trimmed, end: trimmed, prefix: 32, mask: '255.255.255.255' };
  }

  return null;
}

function randomPublicIP() {
  const reserved = (a, b, c) => (
    a === 0 ||
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) ||  // 100.64.0.0/10 CGNAT
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||              // 192.0.0.0/24 + 192.0.2.0/24
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
  for (let i = 0; i < 100; i++) {
    const a = Math.floor(Math.random() * 256);
    const b = Math.floor(Math.random() * 256);
    const c = Math.floor(Math.random() * 256);
    const d = Math.floor(Math.random() * 256);
    if (!reserved(a, b, c)) return `${a}.${b}.${c}.${d}`;
  }
  return '1.1.1.1';
}

const TRAFFIC_TEMPLATES = {
  web:  [{ p: 'TCP', d: 80 }, { p: 'TCP', d: 443 }, { p: 'UDP', d: 53 }, { p: 'TCP', d: 8080 }],
  voip: [{ p: 'UDP', d: 5060 }, { p: 'UDP', d: 16384 }, { p: 'UDP', d: 16386 }],
  p2p:  [{ p: 'TCP', d: 6881 }, { p: 'TCP', d: 6882 }, { p: 'UDP', d: 6881 }, { p: 'UDP', d: 6882 }],
};

function NATPATCalculator({ initialData, onShare }) {
  const { t } = useTranslation();

  const [natMode, setNatMode]           = usePersistentState('natpat:mode', 'pat');
  const [insideLocal, setInsideLocal]   = usePersistentState('natpat:inside_local', initialData?.insideLocal ?? '192.168.1.0/24');
  const [insideGlobal, setInsideGlobal] = usePersistentState('natpat:inside_global', initialData?.insideGlobal ?? '203.0.113.8/29');
  const [outsideGlobal, setOutsideGlobal] = usePersistentState('natpat:outside_global', initialData?.outsideGlobal ?? '8.8.8.8');
  const [activeHosts, setActiveHosts]   = usePersistentState('natpat:subscribers', initialData?.activeHosts ?? 8);
  const [trafficProfile, setTrafficProfile] = usePersistentState('natpat:traffic_profile', 'web');
  const [patStrategy, setPatStrategy]     = usePersistentState('natpat:pat_strategy', 'dynamic');
  const CGNAT_LOCAL = '100.64.0.0/22';
  const handlePatStrategy = (s) => {
    setPatStrategy(s);
    if (s === 'deterministic' && (insideLocal === '' || insideLocal === '192.168.1.0/24')) setInsideLocal(CGNAT_LOCAL);
    if (s !== 'deterministic' && insideLocal === CGNAT_LOCAL) setInsideLocal('192.168.1.0/24');
  };
  const [sessionsPerHost, setSessionsPerHost] = usePersistentState('natpat:sessions_per_host', 4);
  const [blockSize, setBlockSize]         = usePersistentState('natpat:block_size', 512);
  const [configPlatform, setConfigPlatform] = usePersistentState('natpat:config_platform', 'cisco_ios');
  const [tablePage, setTablePage] = useState(1);

  // Reset table pagination when simulation inputs change
  useEffect(() => { setTablePage(1); }, [insideLocal, insideGlobal, outsideGlobal, natMode, activeHosts, trafficProfile, patStrategy, sessionsPerHost, blockSize]);

  // ── Simulation ───────────────────────────────────────────────────────────────
  const simResults = useMemo(() => {
    const localPool  = parsePool(insideLocal);
    const globalPool = parsePool(insideGlobal);
    const dstIp      = outsideGlobal.trim();
    if (!localPool || !globalPool || IPv4.parse(dstIp) === null) return null;

    const numHosts    = Math.min(Math.max(0, Number(activeHosts) || 0), localPool.total);
    const baseTemplates = TRAFFIC_TEMPLATES[trafficProfile] || TRAFFIC_TEMPLATES.web;
    // For dynamic PAT use sessionsPerHost count; for deterministic/static/dynamic NAT use the profile directly
    const sessCount   = natMode !== 'pat' ? baseTemplates.length
      : patStrategy === 'deterministic' ? blockSize
      : Math.max(0, Number(sessionsPerHost) || 0);
    const templates   = Array.from({ length: sessCount }, (_, i) => baseTemplates[i % baseTemplates.length]);
    const sessions    = [];

    // Dynamic PAT allocator state
    let dynIpIdx = 0, dynPort = 1024;

    // Deterministic PAT: pre-assign port blocks per host
    const hostsPerIp   = Math.max(1, Math.floor(64512 / blockSize));
    const detBlocks    = {};
    if (natMode === 'pat' && patStrategy === 'deterministic') {
      for (let h = 0; h < numHosts; h++) {
        const ipIdx = Math.floor(h / hostsPerIp);
        if (ipIdx < globalPool.total) {
          const blockInIp = h % hostsPerIp;
          detBlocks[h] = {
            ip:       globalPool.list[ipIdx],
            nextPort: 1024 + blockInIp * blockSize,
            portEnd:  1024 + (blockInIp + 1) * blockSize - 1,
          };
        }
      }
    }

    // Cap rows stored in the table; counts are tracked separately so stats remain accurate
    const MAX_TABLE_ROWS = 2000;
    let activeCount = 0, droppedCount = 0;
    const allocIpSet = new Set();

    for (let hIdx = 0; hIdx < numHosts; hIdx++) {
      const srcIp = localPool.list[hIdx] || localPool.start;

      templates.forEach((tpl, tIdx) => {
        const srcPort = 49152 + hIdx * templates.length + tIdx;
        let sess;

        if (natMode === 'static' || natMode === 'dynamic') {
          if (hIdx < globalPool.total) {
            sess = { srcIp, srcPort, dstIp, dstPort: tpl.d, proto: tpl.p, tIp: globalPool.list[hIdx], tPort: srcPort, dropped: false };
            activeCount++; allocIpSet.add(sess.tIp);
          } else {
            sess = { srcIp, srcPort, dstIp, dstPort: tpl.d, proto: tpl.p, tIp: '', tPort: null, dropped: true };
            droppedCount++;
          }
        } else if (patStrategy === 'deterministic') {
          const b = detBlocks[hIdx];
          if (b && b.nextPort <= b.portEnd) {
            const ap = b.nextPort++;
            sess = { srcIp, srcPort, dstIp, dstPort: tpl.d, proto: tpl.p, tIp: b.ip, tPort: ap, dropped: false };
            activeCount++; allocIpSet.add(sess.tIp);
          } else {
            sess = { srcIp, srcPort, dstIp, dstPort: tpl.d, proto: tpl.p, tIp: '', tPort: null, dropped: true };
            droppedCount++;
          }
        } else {
          // Dynamic PAT — sequential allocation across pool IPs
          if (dynIpIdx >= globalPool.total) {
            sess = { srcIp, srcPort, dstIp, dstPort: tpl.d, proto: tpl.p, tIp: '', tPort: null, dropped: true };
            droppedCount++;
          } else {
            sess = { srcIp, srcPort, dstIp, dstPort: tpl.d, proto: tpl.p, tIp: globalPool.list[dynIpIdx], tPort: dynPort, dropped: false };
            activeCount++; allocIpSet.add(sess.tIp);
            dynPort++;
            if (dynPort > 65535) { dynIpIdx++; dynPort = 1024; }
          }
        }

        if (sessions.length < MAX_TABLE_ROWS) sessions.push(sess);
      });
    }

    const allocIps = allocIpSet.size;
    const totalPortCap = globalPool.total * 64512;
    const utilPct = natMode === 'pat'
      ? Math.min(100, (activeCount / Math.max(1, totalPortCap)) * 100)
      : (allocIps / Math.max(1, globalPool.total)) * 100;

    let sizingWarn = '', sizingColor = 'green';
    if (natMode === 'pat') {
      if (droppedCount > 0) { sizingWarn = t('nat_pat_calc.warning_exhausted'); sizingColor = 'red'; }
      else if (utilPct > 80) { sizingWarn = t('nat_pat_calc.warning_oversubscribed'); sizingColor = 'yellow'; }
      else { sizingWarn = t('nat_pat_calc.safe_pool'); }
    } else {
      if (numHosts > globalPool.total) { sizingWarn = t('nat_pat_calc.warning_nat_oversubscribed'); sizingColor = 'red'; }
      else { sizingWarn = t('nat_pat_calc.safe_nat_pool'); }
    }

    return {
      sessions, activeCount, droppedCount, allocIps,
      utilPct: utilPct.toFixed(1), sizingWarn, sizingColor,
      localStart: localPool.start, localEnd: localPool.end, localTotal: localPool.total,
      globalStart: globalPool.start, globalEnd: globalPool.end, globalTotal: globalPool.total,
      localPrefix: localPool.prefix ?? 24, localMask: localPool.mask ?? '255.255.255.0',
      globalPrefix: globalPool.prefix ?? 29, globalMask: globalPool.mask ?? '255.255.255.248',
    };
  }, [insideLocal, insideGlobal, outsideGlobal, natMode, activeHosts, trafficProfile, patStrategy, sessionsPerHost, blockSize]);

  // ── Input validation message ─────────────────────────────────────────────────
  const inputErr = useMemo(() => {
    if (!insideLocal.trim() && !insideGlobal.trim()) return '';
    if (!parsePool(insideLocal))  return t('nat_pat_calc.err_invalid_local');
    if (!parsePool(insideGlobal)) return t('nat_pat_calc.err_invalid_global');
    if (IPv4.parse(outsideGlobal.trim()) === null) return t('nat_pat_calc.err_invalid_ip');
    return '';
  }, [insideLocal, insideGlobal, outsideGlobal]);

  // ── Config generation ────────────────────────────────────────────────────────
  const generatedConfigs = useMemo(() => {
    if (!simResults) return null;
    const locSub = insideLocal.includes('/') ? insideLocal : `${simResults.localStart}/${simResults.localPrefix}`;
    const { globalStart: gs, globalEnd: ge, globalPrefix: gp, localStart: ls, localMask: lm } = simResults;

    let ios = '', nxos = '', asa = '', iptables = '', srx = '', pan = '', forti = '', tik = '', huawei = '';

    if (natMode === 'static') {
      ios = [
        `! Cisco IOS 1-to-1 Static NAT`,
        `ip nat inside source static ${ls} ${gs}`,
        `!`,
        `interface GigabitEthernet0/0`,
        ` ip nat inside`,
        `interface GigabitEthernet0/1`,
        ` ip nat outside`,
      ].join('\n');
      nxos = [
        `! Cisco NX-OS Static NAT`,
        `ip nat inside source static ${ls} ${gs}`,
        `!`,
        `interface Ethernet1/1`,
        ` ip nat inside`,
        `interface Ethernet1/2`,
        ` ip nat outside`,
      ].join('\n');
      asa = [
        `! Cisco ASA Static NAT`,
        `object network HOST_LAN`,
        ` host ${ls}`,
        `object network HOST_WAN`,
        ` host ${gs}`,
        `nat (inside,outside) source static HOST_LAN HOST_WAN`,
      ].join('\n');
      iptables = [
        `# Linux iptables Static NAT`,
        `iptables -t nat -A PREROUTING -d ${gs} -j DNAT --to-destination ${ls}`,
        `iptables -t nat -A POSTROUTING -s ${ls} -j SNAT --to-source ${gs}`,
      ].join('\n');
      srx = [
        `# Juniper SRX Static NAT`,
        `set security nat static rule-set rs-static from zone untrust`,
        `set security nat static rule-set rs-static rule rule1 match destination-address ${gs}`,
        `set security nat static rule-set rs-static rule rule1 then static-nat prefix ${ls}`,
      ].join('\n');
      pan = [
        `# Palo Alto PAN-OS Static NAT`,
        `set rulebase nat rules StaticNAT to untrust from trust source any destination ${gs} service any translate-to-destination static-ip ${ls} bi-directional yes`,
      ].join('\n');
      forti = [
        `# FortiGate Virtual IP (Static NAT)`,
        `config firewall vip`,
        `    edit "StaticNAT_${ls.replace(/\./g, '_')}"`,
        `        set extip ${gs}`,
        `        set mappedip "${ls}"`,
        `        set extintf "any"`,
        `    next`,
        `end`,
      ].join('\n');
      tik = [
        `# MikroTik RouterOS Static NAT`,
        `/ip firewall nat`,
        `add chain=dstnat dst-address=${gs} action=dst-nat to-addresses=${ls}`,
        `add chain=srcnat src-address=${ls} action=src-nat to-addresses=${gs}`,
      ].join('\n');
      huawei = [
        `# Huawei VRP Static NAT`,
        `interface GigabitEthernet0/0/1`,
        ` nat static global ${gs} inside ${ls}`,
      ].join('\n');

    } else if (natMode === 'dynamic') {
      ios = [
        `! Cisco IOS Dynamic NAT (IP Pool)`,
        `ip nat pool DYNAMIC_POOL ${gs} ${ge} prefix-length ${gp}`,
        `access-list 1 permit ${ls} 0.0.0.255`,
        `ip nat inside source list 1 pool DYNAMIC_POOL`,
      ].join('\n');
      nxos = [
        `! Cisco NX-OS Dynamic NAT`,
        `ip nat pool DYNAMIC_POOL ${gs} ${ge} prefix-length ${gp}`,
        `ip nat inside source list 1 pool DYNAMIC_POOL`,
      ].join('\n');
      asa = [
        `! Cisco ASA Dynamic NAT Pool`,
        `object network INSIDE_NET`,
        ` subnet ${ls} ${lm}`,
        `object network DYNAMIC_POOL`,
        ` range ${gs} ${ge}`,
        `nat (inside,outside) source dynamic INSIDE_NET pool DYNAMIC_POOL`,
      ].join('\n');
      iptables = [
        `# Linux iptables Dynamic NAT`,
        `iptables -t nat -A POSTROUTING -s ${locSub} -o eth1 -j SNAT --to-source ${gs}-${ge}`,
      ].join('\n');
      srx = [
        `# Juniper SRX Dynamic NAT`,
        `set security nat source pool DYNAMIC_POOL address ${gs} to ${ge}`,
        `set security nat source pool DYNAMIC_POOL port no-translation`,
        `set security nat source rule-set rs-src from zone trust`,
        `set security nat source rule-set rs-src to zone untrust`,
        `set security nat source rule-set rs-src rule r1 match source-address ${locSub}`,
        `set security nat source rule-set rs-src rule r1 then source-nat pool DYNAMIC_POOL`,
      ].join('\n');
      pan = [
        `# Palo Alto Dynamic NAT (No Port Overload)`,
        `set rulebase nat rules DynamicNAT to untrust from trust source ${locSub} destination any service any translate-to-source dynamic-ip-pool member [ ${gs}-${ge} ]`,
      ].join('\n');
      forti = [
        `# FortiGate Dynamic IP Pool (One-to-One)`,
        `config firewall ippool`,
        `    edit "Dynamic_IP_Pool"`,
        `        set startip ${gs}`,
        `        set endip ${ge}`,
        `        set type one-to-one`,
        `    next`,
        `end`,
      ].join('\n');
      tik = [
        `# MikroTik Dynamic Source NAT`,
        `/ip firewall nat`,
        `add chain=srcnat src-address=${locSub} action=src-nat to-addresses=${gs}-${ge}`,
      ].join('\n');
      huawei = [
        `# Huawei VRP Dynamic NAT (No PAT)`,
        `nat address-group 1 ${gs} ${ge}`,
        `interface GigabitEthernet0/0/1`,
        ` nat outbound 2000 address-group 1 no-pat`,
      ].join('\n');

    } else if (patStrategy === 'deterministic') {
      ios = [
        `! Cisco IOS CGNAT / Deterministic PAT`,
        `ip nat settings port-block block-size ${blockSize}`,
        `ip nat pool CGN_POOL ${gs} ${ge} prefix-length ${gp}`,
        `access-list 1 permit ${ls} 0.0.0.255`,
        `ip nat inside source list 1 pool CGN_POOL`,
      ].join('\n');
      nxos = [
        `! Cisco NX-OS Deterministic PAT`,
        `ip nat pool PAT_POOL ${gs} ${ge} prefix-length ${gp}`,
        `ip nat inside source list 1 pool PAT_POOL overload`,
      ].join('\n');
      asa = [
        `! Cisco ASA PAT with Port Block Allocation`,
        `object network INSIDE_NET`,
        ` subnet ${ls} ${lm}`,
        `object network PAT_POOL`,
        ` range ${gs} ${ge}`,
        `nat (inside,outside) source dynamic INSIDE_NET pat-pool PAT_POOL round-robin block-allocation size ${blockSize}`,
      ].join('\n');
      iptables = [
        `# Linux iptables PAT (dynamic — no native port-block support)`,
        `iptables -t nat -A POSTROUTING -s ${locSub} -o eth1 -j SNAT --to-source ${gs}-${ge}`,
      ].join('\n');
      srx = [
        `# Juniper SRX Deterministic Port Block NAT (CGNAT)`,
        `set security nat source pool PAT_POOL address ${gs} to ${ge}`,
        `set security nat source pool PAT_POOL port deterministic-port-block-allocation block-size ${blockSize}`,
        `set security nat source rule-set rs-src from zone trust`,
        `set security nat source rule-set rs-src to zone untrust`,
        `set security nat source rule-set rs-src rule r1 match source-address ${locSub}`,
        `set security nat source rule-set rs-src rule r1 then source-nat pool PAT_POOL`,
      ].join('\n');
      pan = [
        `# Palo Alto Dynamic IP and Port (Block Allocation)`,
        `set rulebase nat rules CGNAT to untrust from trust source ${locSub} destination any service any translate-to-source dynamic-ip-and-port translated-address [ ${gs}-${ge} ]`,
      ].join('\n');
      forti = [
        `# FortiGate CGNAT (Fixed Port Range)`,
        `config firewall ippool`,
        `    edit "CGNAT_Pool"`,
        `        set startip ${gs}`,
        `        set endip ${ge}`,
        `        set type fixed-port-range`,
        `        set source-startip ${ls}`,
        `        set source-endip ${simResults.localEnd}`,
        `    next`,
        `end`,
      ].join('\n');
      tik = [
        `# MikroTik PAT (src-nat overload)`,
        `/ip firewall nat`,
        `add chain=srcnat src-address=${locSub} action=src-nat to-addresses=${gs}-${ge}`,
      ].join('\n');
      huawei = [
        `# Huawei VRP Port Block Allocation (CGNAT)`,
        `nat instance my_instance id 1`,
        ` nat address-group 1`,
        `  section 1 ${gs} ${ge}`,
        `  port-block block-size ${blockSize}`,
        `interface GigabitEthernet0/0/1`,
        ` nat outbound-mapping-system nat-instance my_instance`,
      ].join('\n');

    } else {
      // Dynamic PAT (standard overload)
      ios = [
        `! Cisco IOS NAT Overload (PAT)`,
        `ip nat pool PAT_POOL ${gs} ${ge} prefix-length ${gp}`,
        `access-list 1 permit ${ls} 0.0.0.255`,
        `ip nat inside source list 1 pool PAT_POOL overload`,
      ].join('\n');
      nxos = [
        `! Cisco NX-OS PAT (NAT Overload)`,
        `ip nat pool PAT_POOL ${gs} ${ge} prefix-length ${gp}`,
        `ip nat inside source list 1 pool PAT_POOL overload`,
      ].join('\n');
      asa = [
        `! Cisco ASA Port Address Translation (PAT)`,
        `object network INSIDE_NET`,
        ` subnet ${ls} ${lm}`,
        `object network PAT_POOL`,
        ` range ${gs} ${ge}`,
        `nat (inside,outside) source dynamic INSIDE_NET pat-pool PAT_POOL`,
      ].join('\n');
      iptables = [
        `# Linux iptables PAT (Source NAT)`,
        `iptables -t nat -A POSTROUTING -s ${locSub} -o eth1 -j SNAT --to-source ${gs}-${ge}`,
      ].join('\n');
      srx = [
        `# Juniper SRX PAT (Source NAT Overload)`,
        `set security nat source pool PAT_POOL address ${gs} to ${ge}`,
        `set security nat source rule-set rs-src from zone trust`,
        `set security nat source rule-set rs-src to zone untrust`,
        `set security nat source rule-set rs-src rule r1 match source-address ${locSub}`,
        `set security nat source rule-set rs-src rule r1 then source-nat pool PAT_POOL`,
      ].join('\n');
      pan = [
        `# Palo Alto Dynamic IP and Port (PAT)`,
        `set rulebase nat rules DynamicNAT to untrust from trust source ${locSub} destination any service any translate-to-source dynamic-ip-and-port translated-address [ ${gs}-${ge} ]`,
      ].join('\n');
      forti = [
        `# FortiGate PAT IP Pool (Overload)`,
        `config firewall ippool`,
        `    edit "PAT_Pool"`,
        `        set startip ${gs}`,
        `        set endip ${ge}`,
        `        set type overload`,
        `    next`,
        `end`,
      ].join('\n');
      tik = [
        `# MikroTik RouterOS PAT (src-nat)`,
        `/ip firewall nat`,
        `add chain=srcnat src-address=${locSub} action=src-nat to-addresses=${gs}-${ge}`,
      ].join('\n');
      huawei = [
        `# Huawei VRP PAT (NAT Outbound)`,
        `nat address-group 1 ${gs} ${ge}`,
        `interface GigabitEthernet0/0/1`,
        ` nat outbound 2000 address-group 1`,
      ].join('\n');
    }

    return { ios, nxos, asa, iptables, srx, pan, forti, tik, huawei };
  }, [simResults, natMode, patStrategy, blockSize, insideLocal]);

  // ── Share URL ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({
      tool: 'nat-pat-calc', insideLocal, insideGlobal, outsideGlobal, natMode, activeHosts, trafficProfile,
    });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [insideLocal, insideGlobal, outsideGlobal, natMode, activeHosts, trafficProfile, onShare]);

  // ── Compressed translation table ─────────────────────────────────────────────
  const PAGE_SIZE = 50;
  const renderTable = (sessions) => {
    const total = sessions.length;
    const visible = Math.min(total, PAGE_SIZE * tablePage);
    const rows = sessions.slice(0, visible);
    const remaining = total - visible;

    return (
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--mono)' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
              <th style={{ padding: '8px' }}>{t('nat_pat_calc.th_inside_local')}</th>
              <th style={{ padding: '8px', color: 'var(--primary)' }}>{t('nat_pat_calc.th_inside_global')}</th>
              <th style={{ padding: '8px' }}>{t('nat_pat_calc.th_outside_global')}</th>
              <th style={{ padding: '8px' }}>{t('nat_pat_calc.th_protocol')}</th>
              <th style={{ padding: '8px' }}>{t('nat_pat_calc.th_status')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((s, i) => {
              const dropped = s.dropped;
              return (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)', opacity: dropped ? 0.7 : 1 }}>
                  <td style={{ padding: '7px 8px' }}>{s.srcIp}:{s.srcPort}</td>
                  <td style={{ padding: '7px 8px', color: dropped ? 'var(--error)' : 'var(--primary)' }}>
                    {dropped ? '—' : `${s.tIp}:${s.tPort}`}
                  </td>
                  <td style={{ padding: '7px 8px' }}>{s.dstIp}:{s.dstPort}</td>
                  <td style={{ padding: '7px 8px' }}>
                    <span className={`badge ${s.proto === 'UDP' ? 'badge-yellow' : 'badge-cyan'}`} style={{ fontSize: 9 }}>{s.proto}</span>
                  </td>
                  <td style={{ padding: '7px 8px' }}>
                    <span className={`badge ${dropped ? 'badge-red' : 'badge-green'}`} style={{ fontSize: 9 }}>
                      {dropped ? t('nat_pat_calc.status_dropped') : t('nat_pat_calc.status_active')}
                    </span>
                  </td>
                </tr>
              );
            })}
            {remaining > 0 && (
              <tr>
                <td colSpan={5} style={{ padding: '10px 8px', textAlign: 'center' }}>
                  <button className="btn btn-sm btn-ghost" onClick={() => setTablePage(p => p + 1)}
                    style={{ cursor: 'pointer', fontSize: 11 }}>
                    {t('nat_pat_calc.show_more', { count: Math.min(remaining, PAGE_SIZE) })}
                  </button>
                  <span style={{ marginLeft: 10, color: 'var(--dim)', fontSize: 11 }}>
                    {t('nat_pat_calc.remaining', { count: remaining })}
                  </span>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    );
  };

  // ── Config platform list ──────────────────────────────────────────────────────
  const CONFIG_PLATFORMS = [
    { id: 'cisco_ios',      labelKey: 'cisco_ios_title',      cfg: 'ios' },
    { id: 'cisco_nxos',     labelKey: 'cisco_nxos_title',     cfg: 'nxos' },
    { id: 'cisco_asa',      labelKey: 'cisco_asa_title',      cfg: 'asa' },
    { id: 'linux_iptables', labelKey: 'iptables_title',       cfg: 'iptables' },
    { id: 'juniper_srx',    labelKey: 'juniper_srx_title',    cfg: 'srx' },
    { id: 'palo_alto',      labelKey: 'palo_alto_title',      cfg: 'pan' },
    { id: 'fortinet',       labelKey: 'fortinet_title',       cfg: 'forti' },
    { id: 'mikrotik',       labelKey: 'mikrotik_title',       cfg: 'tik' },
    { id: 'huawei',         labelKey: 'huawei_title',         cfg: 'huawei' },
  ];

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="fadein">

      {/* ── Panel 1: Network Definition ──────────────────────────────────────── */}
      <div className="card">
        <div className="card-title">{t('nat_pat_calc.network_definition')}</div>

        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {['static', 'dynamic', 'pat'].map(mode => (
            <button key={mode} className={`btn btn-sm ${natMode === mode ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setNatMode(mode)}>
              {t(`nat_pat_calc.mode_${mode}`)}
            </button>
          ))}
        </div>

        <div className="two-col grid-mobile-1">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label className="label">{t('nat_pat_calc.inside_local')}</label>
              <input className="input" value={insideLocal} onChange={e => setInsideLocal(e.target.value)}
                placeholder={natMode === 'pat' && patStrategy === 'deterministic' ? CGNAT_LOCAL : t('nat_pat_calc.inside_local_placeholder')} />
            </div>
            <div className="field">
              <label className="label">{t('nat_pat_calc.inside_global')}</label>
              <input className="input" value={insideGlobal} onChange={e => setInsideGlobal(e.target.value)} placeholder={t('nat_pat_calc.inside_global_placeholder')} />
            </div>
            <div className="field">
              <label className="label">{t('nat_pat_calc.outside_global')}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" style={{ flex: 1 }} value={outsideGlobal} onChange={e => setOutsideGlobal(e.target.value)} placeholder={t('nat_pat_calc.outside_global_placeholder')} />
                <button className="btn btn-sm btn-ghost" onClick={() => setOutsideGlobal(randomPublicIP())}
                  title={t('nat_pat_calc.randomize_ip')} style={{ whiteSpace: 'nowrap' }}>
                  {t('nat_pat_calc.randomize_ip')}
                </button>
              </div>
              <div className="hint">{t('nat_pat_calc.outside_global_sim_hint')}</div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div className="field">
              <label className="label">
                {natMode === 'pat' && patStrategy === 'deterministic'
                  ? t('nat_pat_calc.active_subscribers')
                  : t('nat_pat_calc.active_hosts')}
              </label>
              <input className="input" type="text" inputMode="numeric" value={activeHosts}
                onChange={e => { const v = e.target.value.replace(/\D/g, ''); setActiveHosts(v === '' ? '' : Number(v)); }} />
              <div className="hint">
                {natMode === 'pat' && patStrategy === 'deterministic'
                  ? t('nat_pat_calc.subscribers_hint')
                  : t('nat_pat_calc.hosts_hint')}
              </div>
            </div>
            <div className="field">
              <label className="label">{t('nat_pat_calc.traffic_profile')}</label>
              <select className="select" value={trafficProfile} onChange={e => setTrafficProfile(e.target.value)}>
                <option value="web">{t('nat_pat_calc.profile_web')}</option>
                <option value="voip">{t('nat_pat_calc.profile_voip')}</option>
                <option value="p2p">{t('nat_pat_calc.profile_p2p')}</option>
              </select>
            </div>

            {natMode === 'pat' && (
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="field">
                  <label className="label">{t('nat_pat_calc.pat_strategy_label')}</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button className={`btn btn-sm ${patStrategy === 'dynamic' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => handlePatStrategy('dynamic')}>
                      {t('nat_pat_calc.strategy_dynamic')}
                    </button>
                    <button className={`btn btn-sm ${patStrategy === 'deterministic' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => handlePatStrategy('deterministic')}>
                      {t('nat_pat_calc.strategy_deterministic')}
                    </button>
                  </div>
                  <div className="hint" style={{ marginTop: 6, overflowWrap: 'break-word', wordBreak: 'break-word' }}>
                    {patStrategy === 'dynamic' ? t('nat_pat_calc.desc_strategy_dynamic') : t('nat_pat_calc.desc_strategy_deterministic')}
                  </div>
                </div>
                {patStrategy === 'dynamic' ? (
                  <div className="field">
                    <label className="label">{t('nat_pat_calc.sessions_per_host')}</label>
                    <input className="input" type="text" inputMode="numeric" value={sessionsPerHost}
                      onChange={e => { const v = e.target.value.replace(/\D/g, ''); setSessionsPerHost(v === '' ? '' : Number(v)); }} />
                    <div className="hint">{t('nat_pat_calc.sessions_per_host_hint')}</div>
                  </div>
                ) : (
                  <>
                    <div className="field">
                      <label className="label">{t('nat_pat_calc.block_size_cgnat')}</label>
                      <select className="select" value={blockSize} onChange={e => setBlockSize(Number(e.target.value))}>
                        {[128, 256, 512, 1024, 2048, 4096, 8192, 16384].map(n => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </div>
                    <div style={{ borderLeft: '3px solid var(--yellow, #f59e0b)', background: 'var(--background)', borderRadius: 6, padding: '10px 12px', fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
                      <div style={{ fontWeight: 700, marginBottom: 4, color: 'var(--yellow, #f59e0b)' }}>{t('nat_pat_calc.double_nat_title')}</div>
                      {t('nat_pat_calc.double_nat_body', {
                        rfc1918: <a href="https://www.rfc-editor.org/rfc/rfc1918.html" target="_blank" rel="noopener noreferrer" style={{ color: 'var(--cyan)', textDecoration: 'none' }}>RFC 1918</a>
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {inputErr && <Err msg={inputErr} />}
      </div>

      {/* ── Panel 2: Translation Results ─────────────────────────────────────── */}
      {simResults && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16, gap: 12, flexWrap: 'wrap' }}>
            <div className="result-grid" style={{ flex: 1, margin: 0 }}>
              <ResultItem label={t('nat_pat_calc.stats_active_sessions')} value={simResults.activeCount} />
              <ResultItem label={t('nat_pat_calc.stats_allocated_ips')} value={simResults.allocIps} />
              <ResultItem label={t('nat_pat_calc.stats_port_util')} value={`${simResults.utilPct}%`} accent={Number(simResults.utilPct) > 80} />
              <ResultItem label={t('nat_pat_calc.stats_dropped_flows')} value={simResults.droppedCount} yellow={simResults.droppedCount > 0} />
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', background: 'var(--background)', padding: '10px 14px', borderRadius: 6, borderLeft: '3px solid var(--primary)', fontSize: 12, overflowWrap: 'break-word', wordBreak: 'break-word', minWidth: 0 }}>
              <span style={{ fontWeight: 700, color: 'var(--primary)' }}>{t(`nat_pat_calc.mode_${natMode}`)}</span>
              <span style={{ color: 'var(--dim)', marginLeft: 8 }}>{t(`nat_pat_calc.mode_desc_${natMode}`)}</span>
            </div>
            <div className={`badge badge-${simResults.sizingColor}`} style={{ padding: '10px 14px', fontSize: 11, display: 'inline-block', whiteSpace: 'normal', overflowWrap: 'break-word', wordBreak: 'break-word', maxWidth: '100%' }}>
              {simResults.sizingWarn}
            </div>
          </div>

          <div className="card-title" style={{ fontSize: 13, marginBottom: 8 }}>{t('nat_pat_calc.translation_table')}</div>
          {renderTable(simResults.sessions)}
        </div>
      )}

      {/* ── Panel 3: Vendor Configuration ────────────────────────────────────── */}
      {simResults && generatedConfigs && (
        <div className="card fadein">
          <div className="card-title">{t('nat_pat_calc.tab_device_configs')}</div>
          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12, flexWrap: 'wrap' }}>
            {CONFIG_PLATFORMS.map(p => (
              <button key={p.id}
                className={`btn btn-sm ${configPlatform === p.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setConfigPlatform(p.id)}
                style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none', margin: '2px 2px 0 0' }}>
                {t(`nat_pat_calc.${p.labelKey}`).replace(' Configuration', '')}
              </button>
            ))}
          </div>

          {(() => {
            const plat = CONFIG_PLATFORMS.find(p => p.id === configPlatform);
            const cfg  = plat ? generatedConfigs[plat.cfg] : '';
            return (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <div className="card-title" style={{ margin: 0, fontSize: 13 }}>
                    {t(`nat_pat_calc.${plat?.labelKey}`, configPlatform)}
                  </div>
                  <CopyBtn text={cfg} label="copy" id={`copy-nat-${configPlatform}`} />
                </div>
                <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--background)', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>
                  {cfg}
                </pre>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

window.NATPATCalculator = NATPATCalculator;
