const { useState, useEffect, useCallback, useMemo, useRef } = React;

const FE_VENDORS = [
  { id: 'ios_classic', versions: ['v5', 'v9'] },
  { id: 'ios_fnf',     versions: ['v9', 'ipfix'] },
  { id: 'iosxr',       versions: ['v9', 'ipfix'] },
  { id: 'junos',       versions: ['v5', 'v9', 'ipfix', 'sflow'] },
  { id: 'eos',         versions: ['v5', 'v9', 'ipfix', 'sflow'] },
  { id: 'softflowd',   versions: ['v5', 'v9', 'ipfix'] },
];

const FE_DEFAULT_PORT = { v5: '2055', v9: '9995', ipfix: '4739', sflow: '6343' };

const FE_LINE_PRESETS = [
  { bps: 10e6,  label: '10M' },
  { bps: 100e6, label: '100M' },
  { bps: 1e9,   label: '1G' },
  { bps: 10e9,  label: '10G' },
  { bps: 25e9,  label: '25G' },
  { bps: 40e9,  label: '40G' },
  { bps: 100e9, label: '100G' },
  { bps: 400e9, label: '400G' },
];

const FE_V5_FIELDS = [
  { field: 'srcaddr',   bytes: 4, desc: 'Source IPv4 address' },
  { field: 'dstaddr',   bytes: 4, desc: 'Destination IPv4 address' },
  { field: 'nexthop',   bytes: 4, desc: 'Next-hop IPv4 address' },
  { field: 'input',     bytes: 2, desc: 'SNMP ifIndex of ingress interface' },
  { field: 'output',    bytes: 2, desc: 'SNMP ifIndex of egress interface' },
  { field: 'dPkts',     bytes: 4, desc: 'Packets in the flow' },
  { field: 'dOctets',   bytes: 4, desc: 'Layer-3 bytes in the flow' },
  { field: 'first',     bytes: 4, desc: 'sysUptime at flow start' },
  { field: 'last',      bytes: 4, desc: 'sysUptime at last packet' },
  { field: 'srcport',   bytes: 2, desc: 'Source transport port' },
  { field: 'dstport',   bytes: 2, desc: 'Destination transport port' },
  { field: 'tcp_flags', bytes: 1, desc: 'Cumulative TCP flags' },
  { field: 'prot',      bytes: 1, desc: 'IP protocol number' },
  { field: 'tos',       bytes: 1, desc: 'IP ToS / DSCP' },
  { field: 'src_as',    bytes: 2, desc: 'Source BGP AS (trailing)' },
  { field: 'dst_as',    bytes: 2, desc: 'Destination BGP AS (trailing)' },
  { field: 'src_mask',  bytes: 1, desc: 'Source prefix mask length (trailing)' },
  { field: 'dst_mask',  bytes: 1, desc: 'Destination prefix mask length (trailing)' },
];

const FE_IE_FIELDS = [
  { id: 1,   name: 'octetDeltaCount',          desc: 'Delta of bytes observed for this flow' },
  { id: 2,   name: 'packetDeltaCount',         desc: 'Delta of packets observed for this flow' },
  { id: 4,   name: 'protocolIdentifier',       desc: 'IP protocol number' },
  { id: 5,   name: 'ipClassOfService',         desc: 'IPv4 ToS / IPv6 traffic class' },
  { id: 6,   name: 'tcpControlBits',           desc: 'TCP flags observed on the flow' },
  { id: 7,   name: 'sourceTransportPort',      desc: 'Source L4 port' },
  { id: 8,   name: 'sourceIPv4Address',        desc: 'Source IPv4 address' },
  { id: 10,  name: 'ingressInterface',         desc: 'Ingress SNMP ifIndex' },
  { id: 11,  name: 'destinationTransportPort', desc: 'Destination L4 port' },
  { id: 12,  name: 'destinationIPv4Address',   desc: 'Destination IPv4 address' },
  { id: 14,  name: 'egressInterface',          desc: 'Egress SNMP ifIndex' },
  { id: 16,  name: 'bgpSourceAsNumber',        desc: 'BGP source AS' },
  { id: 17,  name: 'bgpDestinationAsNumber',   desc: 'BGP destination AS' },
  { id: 21,  name: 'flowEndSysUpTime',         desc: 'sysUptime at last packet (v9)' },
  { id: 22,  name: 'flowStartSysUpTime',       desc: 'sysUptime at flow start (v9)' },
  { id: 27,  name: 'sourceIPv6Address',        desc: 'Source IPv6 address' },
  { id: 28,  name: 'destinationIPv6Address',   desc: 'Destination IPv6 address' },
  { id: 60,  name: 'ipVersion',                desc: 'IP version (4 or 6)' },
  { id: 152, name: 'flowStartMilliseconds',    desc: 'Absolute start timestamp (IPFIX)' },
  { id: 153, name: 'flowEndMilliseconds',      desc: 'Absolute end timestamp (IPFIX)' },
];

const FE_COMPARE_ROWS = [
  { attr: 'Standard',                  v5: 'Cisco proprietary',            v9: 'RFC 3954 (informational)', v9rfc: 3954, ipfix: 'RFC 7011 (IETF standard)', ipfixrfc: 7011, sflow: 'sFlow.org v5 spec' },
  { attr: 'Record format',             v5: 'Fixed, 48-byte',               v9: 'Template-based',           ipfix: 'Template-based',                 sflow: 'Sampled datagram' },
  { attr: 'IPv6',                      v5: 'No',                           v9: 'Yes',                      ipfix: 'Yes',                            sflow: 'Yes' },
  { attr: 'MPLS / VLAN',               v5: 'No',                           v9: 'Yes',                      ipfix: 'Yes',                            sflow: 'Yes' },
  { attr: 'Variable-length fields',    v5: 'No',                           v9: 'No',                       ipfix: 'Yes',                            sflow: 'n/a' },
  { attr: 'Enterprise-specific fields',v5: 'No',                           v9: 'No',                       ipfix: 'Yes (PEN)',                      sflow: 'n/a' },
  { attr: 'Transport',                 v5: 'UDP',                          v9: 'UDP / SCTP',               ipfix: 'UDP / SCTP / TCP',                sflow: 'UDP' },
  { attr: 'Sampling',                  v5: 'Optional, external',           v9: 'Yes',                      ipfix: 'Yes',                            sflow: 'Always (by design)' },
  { attr: 'Flow state',                v5: 'Cached flow records',          v9: 'Cached flow records',      ipfix: 'Cached flow records',             sflow: 'Packet samples + counters' },
  { attr: 'Default port',              v5: '2055',                         v9: '9995 / 9996',              ipfix: '4739 (2055 common)',              sflow: '6343' },
  { attr: 'Vendor support',            v5: 'Cisco, legacy wide',           v9: 'Cisco, Arista, Juniper, Huawei', ipfix: 'Juniper, Cisco, nProbe, most modern', sflow: 'Arista, Extreme, HPE, Juniper, Mellanox' },
];

const FE_SFLOW_LAYERS = [
  { layer: 'sFlow datagram header', contents: 'version (5), agent address, sub-agent ID, sequence number, uptime, sample count' },
  { layer: 'Sample record',         contents: 'flow sample (type 1) or counter sample (type 2)' },
  { layer: 'Flow sample',           contents: 'sequence, source ID, sampling rate, sample pool, drops, input/output ifIndex, flow records' },
  { layer: 'Flow record',           contents: 'raw packet header (typically first 128 bytes), extended switch/router/gateway data' },
  { layer: 'Counter sample',        contents: 'generic/ethernet/VLAN interface counters, polled on an interval' },
];

const FE_PORTS = [
  { port: '2055/UDP', proto: 'NetFlow v5 / v9', notes: 'De-facto collector port' },
  { port: '9995/UDP', proto: 'NetFlow v9',      notes: 'Cisco default in many collectors' },
  { port: '9996/UDP', proto: 'NetFlow v9',      notes: 'Secondary v9 collector port' },
  { port: '4739/UDP', proto: 'IPFIX',           notes: 'IANA assigned' },
  { port: '4740/TCP', proto: 'IPFIX',           notes: 'IPFIX over DTLS/TLS' },
  { port: '6343/UDP', proto: 'sFlow',           notes: 'IANA assigned' },
];

function fmtRate(v) {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  if (abs >= 1e9) return (v / 1e9).toFixed(2) + 'G';
  if (abs >= 1e6) return (v / 1e6).toFixed(2) + 'M';
  if (abs >= 1e3) return (v / 1e3).toFixed(2) + 'k';
  return v.toFixed(2);
}

function feBadgeKind(metric, value) {
  if (metric === 'exportBps') {
    if (value < 1e6) return 'green';
    if (value <= 10e6) return 'yellow';
    return 'red';
  }
  if (metric === 'recCache') {
    if (value < 64000) return 'green';
    if (value <= 256000) return 'yellow';
    return 'red';
  }
  if (metric === 'sActiveTo') {
    if (value >= 15 && value <= 60) return 'green';
    if (value > 60 && value <= 300) return 'yellow';
    return 'red';
  }
  if (metric === 'sInactiveTo') {
    if (value >= 10 && value <= 30) return 'green';
    if (value > 30 && value <= 120) return 'yellow';
    return 'red';
  }
  return 'green';
}

function feBadgeClass(kind) {
  return kind === 'green' ? 'badge badge-green' : kind === 'yellow' ? 'badge badge-yellow' : 'badge badge-red';
}

function FlowExportBuilder({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = usePersistentState('flowexp:tab', (initialData && initialData.tab) ?? 'builder');

  const [vendor,       setVendor]       = usePersistentState('flowexp:vendor',       (initialData && initialData.vendor) ?? 'ios_classic');
  const [version,      setVersion]      = usePersistentState('flowexp:version',      (initialData && initialData.version) ?? 'v9');
  const [srcIface,     setSrcIface]     = usePersistentState('flowexp:src_iface',    (initialData && initialData.srcIface) ?? 'GigabitEthernet0/0/0');
  const [srcVrf,       setSrcVrf]       = usePersistentState('flowexp:src_vrf',      '');
  const [exportIface,  setExportIface]  = usePersistentState('flowexp:export_iface', 'Loopback0');
  const [collectorIp,  setCollectorIp]  = usePersistentState('flowexp:collector_ip', (initialData && initialData.collectorIp) ?? '10.0.0.10');
  const [collectorPort,setCollectorPort]= usePersistentState('flowexp:collector_port', (initialData && initialData.collectorPort) ?? '9995');
  const [portTouched,  setPortTouched]  = usePersistentState('flowexp:port_touched', false);
  const [directionCfg, setDirectionCfg] = usePersistentState('flowexp:direction',    'ingress');
  const [sampleRate,   setSampleRate]   = usePersistentState('flowexp:sample_rate',  '1000');
  const [activeTo,     setActiveTo]     = usePersistentState('flowexp:active_to',    '60');
  const [inactiveTo,   setInactiveTo]   = usePersistentState('flowexp:inactive_to',  '15');
  const [cacheSize,    setCacheSize]    = usePersistentState('flowexp:cache_size',   '4096');
  const [monitorName,  setMonitorName]  = usePersistentState('flowexp:monitor_name', 'NEK-MONITOR');
  const [collectorSrc, setCollectorSrc] = usePersistentState('flowexp:collector_src', '');
  const [error,        setError]        = useState('');

  const [lineRate,     setLineRate]     = usePersistentState('flowexp:line_rate',    '10000000000');
  const [lineRateMode, setLineRateMode] = usePersistentState('flowexp:line_rate_mode','preset');
  const [avgPkt,       setAvgPkt]       = usePersistentState('flowexp:avg_pkt',      '512');
  const [sSampleRate,  setSSampleRate]  = usePersistentState('flowexp:s_sample',     '1000');
  const [sActiveTo,    setSActiveTo]    = usePersistentState('flowexp:s_active_to',  '60');
  const [sInactiveTo,  setSInactiveTo]  = usePersistentState('flowexp:s_inactive_to','15');
  const [fanout,       setFanout]       = usePersistentState('flowexp:fanout',       '50000');

  const skipNavReport = useRef(false);

  useEffect(() => {
    if (initialData && initialData.tab && initialData.tab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.tab);
    }
  }, [initialData]);

  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ tab: activeTab });
  }, [activeTab]);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'flow-export', tab: activeTab, vendor, version, srcIface, collectorIp, collectorPort,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [activeTab, vendor, version, srcIface, collectorIp, collectorPort, onShare]);

  const vendorEntry = FE_VENDORS.find(v => v.id === vendor) || FE_VENDORS[0];
  const allowedVersions = vendorEntry.versions;

  const handleVendorChange = (id) => {
    setVendor(id);
    const v = FE_VENDORS.find(x => x.id === id);
    if (v && !v.versions.includes(version)) {
      const next = v.versions[0];
      setVersion(next);
      if (!portTouched) setCollectorPort(FE_DEFAULT_PORT[next]);
    }
  };

  const handleVersionChange = (next) => {
    setVersion(next);
    if (!portTouched) setCollectorPort(FE_DEFAULT_PORT[next]);
  };

  const cfgError = useMemo(() => {
    if (!srcIface.trim()) return t('flow_export.err_no_iface');
    if (IPv4.parse(collectorIp) === null) return t('flow_export.err_bad_ip');
    const p = parseInt(collectorPort, 10);
    if (!Number.isFinite(p) || p < 1 || p > 65535) return t('flow_export.err_bad_port');
    const n = parseInt(sampleRate, 10);
    if (!Number.isFinite(n) || n < 1) return t('flow_export.err_bad_sample');
    return '';
  }, [srcIface, collectorIp, collectorPort, sampleRate, t]);

  const unsupported = !allowedVersions.includes(version);

  const generatedConfig = useMemo(() => {
    if (cfgError || unsupported) return '';

    const ifaces  = srcIface.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
    const sr      = parseInt(sampleRate, 10) || 1;
    const sampled = sr > 1;
    const dirs    = directionCfg === 'both' ? ['ingress', 'egress'] : [directionCfg];
    const name    = (monitorName || 'NEK-MONITOR').trim() || 'NEK-MONITOR';
    const expIf   = exportIface.trim();
    const at      = parseInt(activeTo, 10) || 60;
    const it      = parseInt(inactiveTo, 10) || 15;
    const cache   = cacheSize.trim() || '4096';
    const bang    = (vendor === 'junos' || vendor === 'softflowd') ? '#' : '!';

    const lines = [];
    const push = (s) => lines.push(s);

    if (vendor === 'ios_classic') {
      push(`${bang} ${t('flow_export.cmt_ios_classic')}`);
      // Version line: v5 stays v5; v9 gets origin-as appended only when sampled
      if (version === 'v5') {
        push('ip flow-export version 5');
      } else {
        push(sampled ? 'ip flow-export version 9 origin-as' : 'ip flow-export version 9');
      }
      push(`ip flow-export destination ${collectorIp} ${collectorPort}`);
      if (expIf) push(`ip flow-export source ${expIf}`);
      push(`ip flow-cache timeout active ${Math.max(1, Math.ceil(at / 60))}`);
      push(`ip flow-cache entries ${cache}`);
      if (sampled) {
        push('!');
        push(`${bang} ${t('flow_export.cmt_sampler')}`);
        push('flow-sampler-map NEK-SAMPLER');
        push(` mode random one-out-of ${sr}`);
      }
      push('!');
      push(`${bang} ${t('flow_export.cmt_interfaces')}`);
      ifaces.forEach(iface => {
        push(`interface ${iface}`);
        dirs.forEach(d => push(` ip flow ${d}`));
        if (sampled) push(' flow-sampler NEK-SAMPLER');
        push('!');
      });
      return lines.join('\n');
    }

    if (vendor === 'ios_fnf') {
      const proto = version === 'ipfix' ? 'ipfix' : 'netflow-v9';
      push(`${bang} ${t('flow_export.cmt_ios_fnf')}`);
      push(`flow record ${name}-RECORD`);
      push(' match ipv4 source address');
      push(' match ipv4 destination address');
      push(' match ipv4 protocol');
      push(' match transport source-port');
      push(' match transport destination-port');
      push(' match ipv4 tos');
      push(' match interface input');
      push(' collect interface output');
      push(' collect counter bytes');
      push(' collect counter packets');
      push(' collect timestamp sys-uptime first');
      push(' collect timestamp sys-uptime last');
      push('!');
      push(`flow exporter ${name}-EXP`);
      push(` destination ${collectorIp}`);
      if (expIf) push(` source ${expIf}`);
      push(` transport udp ${collectorPort}`);
      push(` export-protocol ${proto}`);
      push(' template data timeout 60');
      push('!');
      push(`flow monitor ${name}`);
      push(` exporter ${name}-EXP`);
      push(` record ${name}-RECORD`);
      push(` cache timeout active ${at}`);
      push(` cache timeout inactive ${it}`);
      push(` cache entries ${cache}`);
      push('!');
      if (sampled) {
        push(`${bang} ${t('flow_export.cmt_sampler')}`);
        push(`sampler ${name}-SAMPLER`);
        push(` mode random 1 out-of ${sr}`);
        push('!');
      }
      push(`${bang} ${t('flow_export.cmt_interfaces')}`);
      ifaces.forEach(iface => {
        push(`interface ${iface}`);
        dirs.forEach(d => {
          const io = d === 'egress' ? 'output' : 'input';
          const samp = sampled ? ` sampler ${name}-SAMPLER` : '';
          push(` ip flow monitor ${name}${samp} ${io}`);
        });
        push('!');
      });
      return lines.join('\n');
    }

    if (vendor === 'iosxr') {
      const verKw = version === 'ipfix' ? 'ipfix' : 'v9';
      push(`${bang} ${t('flow_export.cmt_iosxr')}`);
      push(`flow exporter-map ${name}-EXP`);
      push(` version ${verKw}`);
      push('  options interface-table timeout 60');
      push('  template data timeout 60');
      push(' !');
      push(` transport udp ${collectorPort}`);
      if (expIf) push(` source ${expIf}`);
      push(` destination ${collectorIp}`);
      push('!');
      push(`flow monitor-map ${name}`);
      push(' record ipv4');
      push(` exporter ${name}-EXP`);
      push(` cache entries ${cache}`);
      push(` cache timeout active ${at}`);
      push(` cache timeout inactive ${it}`);
      push('!');
      if (sampled) {
        push(`${bang} ${t('flow_export.cmt_sampler')}`);
        push(`sampler-map ${name}-SAMPLER`);
        push(` random 1 out-of ${sr}`);
        push('!');
      }
      push(`${bang} ${t('flow_export.cmt_interfaces')}`);
      ifaces.forEach(iface => {
        push(`interface ${iface}`);
        dirs.forEach(d => {
          const dirKw = d === 'egress' ? 'egress' : 'ingress';
          const samp = sampled ? ` sampler ${name}-SAMPLER` : '';
          push(` flow ipv4 monitor ${name}${samp} ${dirKw}`);
        });
        push('!');
      });
      return lines.join('\n');
    }

    if (vendor === 'junos' && version === 'sflow') {
      push(`${bang} ${t('flow_export.cmt_junos_sflow')}`);
      push('set protocols sflow polling-interval 20');
      push(`set protocols sflow sample-rate ingress ${sr}`);
      if (dirs.includes('egress')) push(`set protocols sflow sample-rate egress ${sr}`);
      push(`set protocols sflow collector ${collectorIp} udp-port ${collectorPort}`);
      ifaces.forEach(iface => push(`set protocols sflow interfaces ${iface}`));
      return lines.join('\n');
    }

    if (vendor === 'junos') {
      push(`${bang} ${t('flow_export.cmt_junos')}`);
      push(`set forwarding-options sampling instance ${name} input rate ${sr}`);
      push(`set forwarding-options sampling instance ${name} family inet output flow-server ${collectorIp} port ${collectorPort}`);
      if (version === 'ipfix') {
        push(`set forwarding-options sampling instance ${name} family inet output flow-server ${collectorIp} version-ipfix template ${name}-TPL`);
      } else {
        push(`set forwarding-options sampling instance ${name} family inet output flow-server ${collectorIp} version ${version === 'v5' ? '5' : '9'}`);
      }
      push(`set forwarding-options sampling instance ${name} family inet output flow-server ${collectorIp} autonomous-system-type origin`);
      if (collectorSrc && IPv4.parse(collectorSrc) !== null) {
        push(`set forwarding-options sampling instance ${name} family inet output inline-jflow source-address ${collectorSrc}`);
      }
      if (version !== 'v5') {
        const tpl = version === 'ipfix' ? 'version-ipfix' : 'version9';
        push(`set services flow-monitoring ${tpl} template ${name}-TPL flow-active-timeout ${at}`);
        push(`set services flow-monitoring ${tpl} template ${name}-TPL flow-inactive-timeout ${it}`);
        push(`set services flow-monitoring ${tpl} template ${name}-TPL ipv4-template`);
      }
      push(`set chassis fpc 0 sampling-instance ${name}`);
      ifaces.forEach(iface => {
        if (dirs.includes('ingress')) push(`set interfaces ${iface} unit 0 family inet sampling input`);
        if (dirs.includes('egress'))  push(`set interfaces ${iface} unit 0 family inet sampling output`);
      });
      return lines.join('\n');
    }

    if (vendor === 'eos' && version === 'sflow') {
      push(`${bang} ${t('flow_export.cmt_eos_sflow')}`);
      push(`sflow destination ${collectorIp} ${collectorPort}`);
      if (expIf) push(`sflow source-interface ${expIf}`);
      push(`sflow sample ${sr}`);
      push('sflow polling-interval 30');
      push('sflow run');
      push('!');
      push(`${bang} ${t('flow_export.cmt_interfaces')}`);
      ifaces.forEach(iface => {
        push(`interface ${iface}`);
        push('   sflow enable');
        push('!');
      });
      return lines.join('\n');
    }

    if (vendor === 'eos' && version === 'v5') {
      push(`${bang} ${t('flow_export.cmt_eos_legacy')}`);
      push(`ip flow-export destination ${collectorIp} ${collectorPort}`);
      push('ip flow-export version 5');
      push(`${bang} ${t('flow_export.cmt_interfaces')}`);
      ifaces.forEach(iface => {
        push(`interface ${iface}`);
        dirs.forEach(d => push(`   ip flow ${d}`));
        push('!');
      });
      return lines.join('\n');
    }

    if (vendor === 'eos') {
      push(`${bang} ${t('flow_export.cmt_eos')}`);
      push('flow tracking hardware');
      push(`   tracker ${name}`);
      push(`      record export on inactive timeout ${it * 1000}`);
      push(`      record export on interval ${at * 1000}`);
      push(`      exporter ${name}-EXP`);
      push(`         collector ${collectorIp} port ${collectorPort}`);
      if (expIf) push(`         local interface ${expIf}`);
      push('         template interval 30000');
      push('   no shutdown');
      push('!');
      push(`${bang} ${t('flow_export.cmt_interfaces')}`);
      ifaces.forEach(iface => {
        push(`interface ${iface}`);
        push(`   flow tracker hardware ${name}`);
        push('!');
      });
      return lines.join('\n');
    }

    if (vendor === 'softflowd') {
      const vFlag = version === 'ipfix' ? '10' : (version === 'v5' ? '5' : '9');
      const sampFlag = sampled ? ` -s ${sr}` : '';
      push(`${bang} ${t('flow_export.cmt_softflowd')}`);
      ifaces.forEach(iface => {
        push(`softflowd -i ${iface} -n ${collectorIp}:${collectorPort} -v ${vFlag} -t maxlife=${at} -t expint=${it} -m ${cache}${sampFlag}`);
      });
      push(`${bang} ${t('flow_export.cmt_softflowd_systemd')}`);
      push(`${bang} /etc/systemd/system/softflowd@.service  →  ExecStart=/usr/sbin/softflowd -D -i %i -n ${collectorIp}:${collectorPort} -v ${vFlag}`);
      if (ifaces[0]) push(`systemctl enable --now softflowd@${ifaces[0]}`);
      return lines.join('\n');
    }

    return '';
  }, [cfgError, unsupported, srcIface, sampleRate, directionCfg, monitorName, exportIface, activeTo, inactiveTo, cacheSize, vendor, version, collectorIp, collectorPort, t]);

  const downloadTxt = useCallback(() => {
    const blob = new Blob([generatedConfig + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `flow-export-${vendor}-${version}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [generatedConfig, vendor, version]);

  const calc = useMemo(() => {
    const rate = parseFloat(lineRate), pkt = parseFloat(avgPkt);
    const n    = parseInt(sSampleRate, 10) || 1;
    const at   = parseFloat(sActiveTo), it = parseFloat(sInactiveTo);
    const fo   = parseFloat(fanout);
    if (![rate, pkt, at, it, fo].every(v => Number.isFinite(v) && v > 0) || pkt < 20) return null;

    const wirePps    = rate / (pkt * 8);
    const sampledPps = wirePps / n;
    const flowsPerSec= fo / n;
    const exportBps  = flowsPerSec * 50 * 8;
    const activeFlows= Math.ceil(flowsPerSec * Math.max(at, it));
    const recCache   = Math.ceil(activeFlows * 1.3);
    return { wirePps, sampledPps, flowsPerSec, exportBps, activeFlows, recCache };
  }, [lineRate, avgPkt, sSampleRate, sActiveTo, sInactiveTo, fanout]);

  const samplerWarnings = useMemo(() => {
    if (!calc) return [];
    const at = parseFloat(sActiveTo), it = parseFloat(sInactiveTo);
    const w = [];
    if (at > 60) w.push(t('flow_export.warn_active_high'));
    if (at < 15) w.push(t('flow_export.warn_active_low'));
    if (it > 120) w.push(t('flow_export.warn_inactive_high'));
    if (calc.recCache > 256000) w.push(t('flow_export.warn_cache_high'));
    if (calc.exportBps > 10e6) w.push(t('flow_export.warn_export_high'));
    return w;
  }, [calc, sActiveTo, sInactiveTo, t]);

  const samplerCopyAll = useMemo(() => {
    if (!calc) return '';
    const rows = [
      [t('flow_export.col_name'), t('common.results')].join('\t'),
      [t('flow_export.res_wire_pps'), fmtRate(calc.wirePps) + ' pps'].join('\t'),
      [t('flow_export.res_sampled_pps'), fmtRate(calc.sampledPps) + ' pps'].join('\t'),
      [t('flow_export.res_flows_per_sec'), fmtRate(calc.flowsPerSec) + ' fps'].join('\t'),
      [t('flow_export.res_export_bw'), fmtRate(calc.exportBps) + 'bps'].join('\t'),
      [t('flow_export.res_active_flows'), String(calc.activeFlows)].join('\t'),
      [t('flow_export.res_cache_recommended'), String(calc.recCache)].join('\t'),
    ];
    return rows.join('\n');
  }, [calc, t]);

  const badgeLabel = (kind) => kind === 'green' ? t('flow_export.badge_safe') : kind === 'yellow' ? t('flow_export.badge_caution') : t('flow_export.badge_overload');

  const tabs = [
    { id: 'builder',   label: t('flow_export.tab_builder') },
    { id: 'sampler',   label: t('flow_export.tab_sampler') },
    { id: 'reference', label: t('flow_export.tab_reference') },
  ];

  const renderCompareCell = (row, key) => {
    const rfcKey = key + 'rfc';
    if (row[rfcKey]) {
      return <span>{row[key].replace(/RFC \d+/, '').trim()} (<RFCLink rfc={row[rfcKey]} />)</span>;
    }
    return row[key];
  };

  return (
    <div className="fadein">
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12, flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button
            key={tab.id}
            className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setActiveTab(tab.id)}
            style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none', margin: '2px 2px 0 0' }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'builder' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('flow_export.section_target')}</div>
            <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
              <div className="field">
                <label className="label">{t('flow_export.vendor')}</label>
                <select className="input" value={vendor} onChange={e => handleVendorChange(e.target.value)}>
                  {FE_VENDORS.map(v => (
                    <option key={v.id} value={v.id}>{t('flow_export.vendor_' + v.id)}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">{t('flow_export.version')}</label>
                <select className="input" value={allowedVersions.includes(version) ? version : allowedVersions[0]} onChange={e => handleVersionChange(e.target.value)}>
                  {allowedVersions.map(ver => (
                    <option key={ver} value={ver}>{t('flow_export.version_' + ver)}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label">{t('flow_export.monitor_name')}</label>
              <input className="input" value={monitorName} onChange={e => setMonitorName(e.target.value)} />
              <div className="hint">{t('flow_export.monitor_name_hint')}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('flow_export.section_export')}</div>
            <div className="field">
              <label className="label">{t('flow_export.src_iface')}</label>
              <textarea className="input" rows={2} value={srcIface} onChange={e => setSrcIface(e.target.value)} placeholder={t('flow_export.src_iface_placeholder')} />
              <div className="hint">{t('flow_export.src_iface_hint')}</div>
            </div>
            <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
              <div className="field">
                <label className="label">{t('flow_export.export_iface')}</label>
                <input className="input" value={exportIface} onChange={e => setExportIface(e.target.value)} />
                <div className="hint">{t('flow_export.export_iface_hint')}</div>
              </div>
              <div className="field">
                <label className="label">{t('flow_export.direction')}</label>
                <select className="input" value={directionCfg} onChange={e => setDirectionCfg(e.target.value)}>
                  <option value="ingress">{t('flow_export.direction_ingress')}</option>
                  <option value="egress">{t('flow_export.direction_egress')}</option>
                  <option value="both">{t('flow_export.direction_both')}</option>
                </select>
              </div>
            </div>
            {vendor === 'junos' && (
              <div className="field">
                <label className="label">{t('flow_export.collector_src')}</label>
                <input className="input" value={collectorSrc} onChange={e => setCollectorSrc(e.target.value)} placeholder="192.0.2.1" />
                <div className="hint">{t('flow_export.collector_src_hint')}</div>
              </div>
            )}
            <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
              <div className="field">
                <label className="label">{t('flow_export.collector_ip')}</label>
                <input className="input" value={collectorIp} onChange={e => setCollectorIp(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('flow_export.collector_port')}</label>
                <input className="input" value={collectorPort} onChange={e => { setCollectorPort(e.target.value); setPortTouched(true); }} />
                <div className="hint">{t('flow_export.collector_port_hint')}</div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('flow_export.section_timers')}</div>
            <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
              <div className="field">
                <label className="label">{t('flow_export.sample_rate')}</label>
                <input className="input" value={sampleRate} onChange={e => setSampleRate(e.target.value)} />
                <div className="hint">{t('flow_export.sample_rate_hint')}</div>
              </div>
              <div className="field">
                <label className="label">{t('flow_export.cache_size')}</label>
                <input className="input" value={cacheSize} onChange={e => setCacheSize(e.target.value)} />
              </div>
            </div>
            <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
              <div className="field">
                <label className="label">{t('flow_export.active_timeout')}</label>
                <input className="input" value={activeTo} onChange={e => setActiveTo(e.target.value)} />
                <div className="hint">{t('flow_export.active_timeout_hint')}</div>
              </div>
              <div className="field">
                <label className="label">{t('flow_export.inactive_timeout')}</label>
                <input className="input" value={inactiveTo} onChange={e => setInactiveTo(e.target.value)} />
                <div className="hint">{t('flow_export.inactive_timeout_hint')}</div>
              </div>
            </div>
          </div>

          <Err msg={cfgError || (unsupported ? t('flow_export.err_unsupported') : '') || error} />

          {!cfgError && !unsupported && generatedConfig && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="card-title" style={{ margin: 0 }}>{t('flow_export.config_output')}</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <CopyBtn text={generatedConfig} label="copy" id="flowexp-cfg-copy" />
                  <button className="btn btn-sm btn-ghost" onClick={downloadTxt}>{t('flow_export.export_txt')}</button>
                </div>
              </div>
              <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--background)', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                {generatedConfig.split('\n').map((line, i) => (
                  <span key={i} style={/^[!#]/.test(line) ? { color: 'var(--dim)' } : undefined}>{line}{'\n'}</span>
                ))}
              </pre>
            </div>
          )}
        </div>
      )}

      {activeTab === 'sampler' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('flow_export.section_inputs')}</div>
            <div className="field">
              <label className="label">{t('flow_export.line_rate')}</label>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                <button
                  className={`btn btn-sm ${lineRateMode === 'preset' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setLineRateMode('preset')}
                >{t('flow_export.line_rate_mode_preset')}</button>
                <button
                  className={`btn btn-sm ${lineRateMode === 'manual' ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setLineRateMode('manual')}
                >{t('flow_export.line_rate_mode_manual')}</button>
              </div>
              {lineRateMode === 'preset' ? (
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {FE_LINE_PRESETS.map(p => (
                    <button
                      key={p.label}
                      className={`btn btn-sm ${String(lineRate) === String(p.bps) ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setLineRate(String(p.bps))}
                    >{p.label}</button>
                  ))}
                </div>
              ) : (
                <div className="field" style={{ marginTop: 8 }}>
                  <label className="label">{t('flow_export.line_rate_manual')}</label>
                  <input className="input" value={lineRate} onChange={e => setLineRate(e.target.value)} />
                </div>
              )}
            </div>
            <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
              <div className="field">
                <label className="label">{t('flow_export.avg_pkt')}</label>
                <input className="input" value={avgPkt} onChange={e => setAvgPkt(e.target.value)} />
                <div className="hint">{t('flow_export.avg_pkt_hint')}</div>
              </div>
              <div className="field">
                <label className="label">{t('flow_export.sample_rate')}</label>
                <input className="input" value={sSampleRate} onChange={e => setSSampleRate(e.target.value)} />
                <div className="hint">{t('flow_export.sample_rate_hint')}</div>
              </div>
            </div>
            <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
              <div className="field">
                <label className="label">{t('flow_export.active_timeout')}</label>
                <input className="input" value={sActiveTo} onChange={e => setSActiveTo(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('flow_export.inactive_timeout')}</label>
                <input className="input" value={sInactiveTo} onChange={e => setSInactiveTo(e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="label">{t('flow_export.fanout')}</label>
              <input className="input" value={fanout} onChange={e => setFanout(e.target.value)} />
              <div className="hint">{t('flow_export.fanout_hint')}</div>
            </div>
          </div>

          {calc && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="card-title" style={{ margin: 0 }}>{t('flow_export.section_results')}</div>
                <CopyBtn text={samplerCopyAll} label="copy_all" id="flowexp-sampler-copy-all" />
              </div>
              <div className="result-grid">
                <ResultItem label={t('flow_export.res_wire_pps')} value={fmtRate(calc.wirePps) + ' pps'} />
                <ResultItem label={t('flow_export.res_sampled_pps')} value={fmtRate(calc.sampledPps) + ' pps'} />
                <ResultItem label={t('flow_export.res_flows_per_sec')} value={fmtRate(calc.flowsPerSec) + ' fps'} />
                <ResultItem label={t('flow_export.res_export_bw')} value={fmtRate(calc.exportBps) + 'bps'} />
                <ResultItem label={t('flow_export.res_active_flows')} value={String(calc.activeFlows)} />
                <ResultItem label={t('flow_export.res_cache_recommended')} value={String(calc.recCache)} />
              </div>
              <div className="hint">{t('flow_export.res_export_bw_hint')}</div>
              <div className="hint">{t('flow_export.res_cache_hint')}</div>

              <div className="card-title" style={{ marginTop: 16 }}>{t('flow_export.section_guidance')}</div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                {(() => {
                  const k = feBadgeKind('exportBps', calc.exportBps);
                  return <span className={feBadgeClass(k)}>{t('flow_export.res_export_bw')}: {badgeLabel(k)}</span>;
                })()}
                {(() => {
                  const k = feBadgeKind('recCache', calc.recCache);
                  return <span className={feBadgeClass(k)}>{t('flow_export.res_cache_recommended')}: {badgeLabel(k)}</span>;
                })()}
                {(() => {
                  const k = feBadgeKind('sActiveTo', parseFloat(sActiveTo));
                  return <span className={feBadgeClass(k)}>{t('flow_export.active_timeout')}: {badgeLabel(k)}</span>;
                })()}
                {(() => {
                  const k = feBadgeKind('sInactiveTo', parseFloat(sInactiveTo));
                  return <span className={feBadgeClass(k)}>{t('flow_export.inactive_timeout')}: {badgeLabel(k)}</span>;
                })()}
              </div>
              {samplerWarnings.map((w, i) => (
                <div key={i} className="err" style={{ marginTop: 6 }}>⚠ {w}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'reference' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('flow_export.ref_compare_title')}</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('flow_export.col_attribute')}</th>
                    <th>NetFlow v5</th>
                    <th>NetFlow v9</th>
                    <th>IPFIX</th>
                    <th>sFlow</th>
                  </tr>
                </thead>
                <tbody>
                  {FE_COMPARE_ROWS.map(row => (
                    <tr key={row.attr}>
                      <td>{row.attr}</td>
                      <td>{renderCompareCell(row, 'v5')}</td>
                      <td>{renderCompareCell(row, 'v9')}</td>
                      <td>{renderCompareCell(row, 'ipfix')}</td>
                      <td>{row.sflow}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('flow_export.ref_v5_title')}</div>
            <p style={{ fontSize: 12, color: 'var(--dim)', marginTop: 0 }}>{t('flow_export.ref_v5_note')}</p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('flow_export.col_field')}</th>
                    <th>{t('flow_export.col_bytes')}</th>
                    <th>{t('flow_export.col_description')}</th>
                  </tr>
                </thead>
                <tbody>
                  {FE_V5_FIELDS.map(r => (
                    <tr key={r.field}>
                      <td>{r.field}</td>
                      <td>{r.bytes}</td>
                      <td>{r.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('flow_export.ref_v9_title')}</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('flow_export.col_id')}</th>
                    <th>{t('flow_export.col_name')}</th>
                    <th>{t('flow_export.col_description')}</th>
                  </tr>
                </thead>
                <tbody>
                  {FE_IE_FIELDS.map(r => (
                    <tr key={r.id}>
                      <td>{r.id}</td>
                      <td>{r.name}</td>
                      <td>{r.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('flow_export.ref_sflow_title')}</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('flow_export.col_layer')}</th>
                    <th>{t('flow_export.col_contents')}</th>
                  </tr>
                </thead>
                <tbody>
                  {FE_SFLOW_LAYERS.map(r => (
                    <tr key={r.layer}>
                      <td>{r.layer}</td>
                      <td>{r.contents}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('flow_export.ref_ports_title')}</div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{t('flow_export.col_port')}</th>
                    <th>{t('flow_export.col_protocol')}</th>
                    <th>{t('flow_export.col_notes')}</th>
                  </tr>
                </thead>
                <tbody>
                  {FE_PORTS.map(r => (
                    <tr key={r.port}>
                      <td>{r.port}</td>
                      <td>{r.proto}</td>
                      <td>{r.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('flow_export.ref_ipfix_title')}</div>
            <p style={{ fontSize: 13, margin: 0, lineHeight: 1.55 }}>
              {t('flow_export.ref_ipfix_note')}{' '}
              <RFCLink rfc={7011} /> / <RFCLink rfc={3954} /> / <RFCLink rfc={5101} />
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

window.FlowExportBuilder = FlowExportBuilder;
