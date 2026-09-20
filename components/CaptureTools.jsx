const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── ANSI escape → HTML (for tshark --color output) ──────────────────────
function ansiToHtml(raw) {
  const F16 = ['#1a1a1a','#cc0000','#4e9a06','#c4a000','#3465a4','#75507b','#06989a','#d3d7cf'];
  const B16 = ['#555753','#ef2929','#8ae234','#fce94f','#729fcf','#ad7fa8','#34e2e2','#eeeeec'];
  const esc = (s) => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const parts = raw.split(/(\x1b\[[0-9;]*m)/);
  let html = '', style = {};
  for (const part of parts) {
    if (part.startsWith('\x1b[')) {
      const codes = part.slice(2, -1).split(';').map(Number);
      let i = 0;
      while (i < codes.length) {
        const c = codes[i];
        if (c === 0) { style = {}; }
        else if (c === 1) { style.fontWeight = 'bold'; }
        else if (c >= 30 && c <= 37) { style.color = F16[c - 30]; }
        else if (c >= 90 && c <= 97) { style.color = B16[c - 90]; }
        else if (c >= 40 && c <= 47) { style.background = F16[c - 40]; }
        else if (c >= 100 && c <= 107) { style.background = B16[c - 100]; }
        else if (c === 38 && codes[i+1] === 2) { style.color = `rgb(${codes[i+2]},${codes[i+3]},${codes[i+4]})`; i += 4; }
        else if (c === 48 && codes[i+1] === 2) { style.background = `rgb(${codes[i+2]},${codes[i+3]},${codes[i+4]})`; i += 4; }
        i++;
      }
    } else if (part) {
      const css = Object.entries(style).map(([k,v])=>`${k.replace(/([A-Z])/g,'-$1').toLowerCase()}:${v}`).join(';');
      html += css ? `<span style="${css}">${esc(part)}</span>` : esc(part);
    }
  }
  return html;
}

// ─── tcpdump packet parser ────────────────────────────────────────────────
const PROTO_COLORS = {
  TCP:  { bg: 'rgba(31,111,235,0.12)',  accent: '#1f6feb' },
  UDP:  { bg: 'rgba(35,134,54,0.12)',   accent: '#238636' },
  DNS:  { bg: 'rgba(13,115,119,0.12)',  accent: '#0d7377' },
  ICMP: { bg: 'rgba(158,106,3,0.12)',   accent: '#9e6a03' },
  ARP:  { bg: 'rgba(110,64,201,0.12)',  accent: '#6e40c9' },
  IPv6: { bg: 'rgba(26,127,100,0.12)',  accent: '#1a7f64' },
};

function parseTcpdumpLine(text, num) {
  const timeMatch = text.match(/^(\d{2}:\d{2}:\d{2}\.\d+)/);
  const time = timeMatch ? timeMatch[1] : '';

  const ipMatch = text.match(/\bIP6?\s+([^\s>]+)\s+>\s+([^\s:]+):\s*(.*)/);
  if (ipMatch) {
    const [, srcFull, dstFull, rest] = ipMatch;
    const splitAddr = addr => {
      const lastDot = addr.lastIndexOf('.');
      const maybePort = addr.slice(lastDot + 1);
      if (/^\d+$/.test(maybePort) && lastDot > 0) return { host: addr.slice(0, lastDot), port: maybePort };
      return { host: addr, port: '' };
    };
    const src = splitAddr(srcFull);
    const dst = splitAddr(dstFull);
    const fmt = a => a.host + (a.port ? ':' + a.port : '');

    let proto = text.includes('IP6') ? 'IPv6' : 'IP';
    if (src.port === '53' || dst.port === '53') proto = 'DNS';
    else if (rest.includes('Flags')) proto = 'TCP';
    else if (/\bUDP\b/.test(rest)) proto = 'UDP';
    else if (/\bICMP\b/.test(text)) proto = 'ICMP';

    const lenMatch = rest.match(/length\s+(\d+)/);
    return { num, time, src: fmt(src), dst: fmt(dst), proto, length: lenMatch ? lenMatch[1] : '', info: rest, raw: text };
  }

  if (/\bARP\b/.test(text)) {
    const info = text.replace(/^\S+\s+ARP,?\s*/, '');
    const lenMatch = text.match(/length\s+(\d+)/);
    return { num, time, src: '', dst: '', proto: 'ARP', length: lenMatch ? lenMatch[1] : '', info, raw: text };
  }

  return { num, time, src: '', dst: '', proto: '?', length: '', info: text.slice(time.length).trim(), raw: text };
}

// Verbose tcpdump puts "src > dst: rest" on a continuation line (leading whitespace, no timestamp/IP keyword).
// Returns updated column fields if the line matches, otherwise null.
function parseContinuationForColumns(text) {
  const trimmed = text.trim();
  const m = trimmed.match(/^([^\s>]+)\s+>\s+([^\s:]+):\s*(.*)/);
  if (!m) return null;
  const [, srcFull, dstFull, rest] = m;
  const splitAddr = addr => {
    const lastDot = addr.lastIndexOf('.');
    const maybePort = addr.slice(lastDot + 1);
    if (/^\d+$/.test(maybePort) && lastDot > 0) return { host: addr.slice(0, lastDot), port: maybePort };
    return { host: addr, port: '' };
  };
  const src = splitAddr(srcFull);
  const dst = splitAddr(dstFull);
  const fmt = a => a.host + (a.port ? ':' + a.port : '');
  let proto = 'IP';
  if (src.port === '53' || dst.port === '53') proto = 'DNS';
  else if (rest.includes('Flags')) proto = 'TCP';
  else if (/\bUDP\b/.test(rest)) proto = 'UDP';
  else if (/\bICMP\b/.test(rest)) proto = 'ICMP';
  const lenMatch = rest.match(/length\s+(\d+)/);
  return { src: fmt(src), dst: fmt(dst), proto, length: lenMatch ? lenMatch[1] : '', info: rest };
}

function CaptureTools({ onShare, initialData, onNav }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('capture:activeTab', initialData?.activeTab ?? 'tcpdump');
  const [tsharkSubTab, setTsharkSubTab] = usePersistentState('capture:tsharkSubTab', initialData?.tsharkSubTab ?? 'builder');
  const skipNavReport = useRef(false);
  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
  }, [initialData]);
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  // ── Display Filter Builder state ──────────────────────────────
  const dfMigrate = (data) => {
    if (data?.dfItems) return data.dfItems;
    if (data?.dfRows) return data.dfRows.map(r => ({ ...r, type: 'condition' }));
    return [{ id: 1, type: 'condition', field: 'ip.addr', op: '==', value: '', connector: 'and' }];
  };
  const [dfItems, setDfItems] = usePersistentState('capture:dfItems', () => dfMigrate(initialData));
  const [dfMods, setDfMods] = usePersistentState('capture:dfMods', initialData?.dfMods ?? { synOnly: false, errorsOnly: false, noNoise: false, negate: false });
  const [dfProtoSub, setDfProtoSub] = usePersistentState('capture:dfProtoSub', initialData?.dfProtoSub ?? {}); // { [rowId]: { method:'', status:'', uri:'', ... } }

  // ── Capture Filter (BPF) Builder state ───────────────────────
  const bpfMigrate = (data) => {
    if (data?.bpfItems) return data.bpfItems;
    if (data?.bpfRows) return data.bpfRows.map(r => ({ ...r, type: 'condition' }));
    return [{ id: 1, type: 'condition', field: 'host', value: '', connector: 'and' }];
  };
  const [bpfItems, setBpfItems] = usePersistentState('capture:bpfItems', () => bpfMigrate(initialData));
  const [bpfNegate, setBpfNegate] = usePersistentState('capture:bpfNegate', initialData?.bpfNegate ?? false);

  // ── TShark Builder state ──────────────────────────────────────
  const [ts, setTs] = usePersistentState('capture:ts', initialData?.ts ?? {
    mode: 'live',          // 'live' | 'read'
    iface: 'eth0',
    readFile: '',
    writeFile: '',
    captureFilter: '',
    displayFilter: '',
    count: '',
    duration: '',
    outputFmt: 'default',  // 'default' | 'fields' | 'json' | 'pdml'
    fields: '',            // comma-separated list of -e fields
    stats: '',             // -z value e.g. 'io,phs'
  });

  // ── tcpdump tab state ─────────────────────────────────────────
  const [td, setTd] = usePersistentState('capture:td', initialData?.td ?? {
    mode: 'live',
    iface: 'eth0',
    filter: '',
    count: '100',
    snaplen: '',
    nodns: '',
    verbosity: '',
    output: '',
    timestamp: '',
    writeFile: '',
    readFile: '',
    linkLayer: false,
  });
  const [tcpdumpAvail, setTcpdumpAvail] = useState(null);
  const [tsharkAvail,  setTsharkAvail]  = useState(null);
  const [tsScanning,   setTsScanning]   = useState(false);
  const [tsLines,      setTsLines]      = useState([]);
  const [tsExitCode,   setTsExitCode]   = useState(null);
  const [tsWrittenFile, setTsWrittenFile] = useState(null);
  const [tsAutoFile] = useState(() => {
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    return `tshark_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.pcap`;
  });
  const [tsFullscreen, setTsFullscreen] = useState(false);
  const tsEsRef     = useRef(null);
  const tsTermRef   = useRef(null);
  const tsFsTermRef = useRef(null);
  const [tdScanning, setTdScanning]     = useState(false);
  const [tdLines, setTdLines]           = useState([]);
  const [tdExitCode, setTdExitCode]     = useState(null);
  const tdEsRef       = useRef(null);
  const tdTermRef     = useRef(null);
  const tdTableRef    = useRef(null);
  const tdFsTableRef  = useRef(null);
  const tdFsTermRef   = useRef(null);

  const [tdPackets,      setTdPackets]      = useState([]);
  const [tdOutputView,   setTdOutputView]   = useState('table');
  const [tdExpandedRows, setTdExpandedRows] = useState(new Set());
  const [tdAtBottom,     setTdAtBottom]     = useState(true);
  const [tdWrittenFile,  setTdWrittenFile]  = useState(null);
  const [tdFullscreen,   setTdFullscreen]   = useState(false);
  const [tdAutoFile]                        = useState(() => {
    const now = new Date();
    const p = n => String(n).padStart(2, '0');
    return `capture_${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}.pcap`;
  });

  useEffect(() => {
    if (initialData) {
      if (initialData.activeTab !== undefined) setActiveTab(initialData.activeTab);
      if (initialData.tsharkSubTab !== undefined) setTsharkSubTab(initialData.tsharkSubTab);
      if (initialData.dfItems !== undefined || initialData.dfRows !== undefined) setDfItems(dfMigrate(initialData));
      if (initialData.dfMods !== undefined) setDfMods(initialData.dfMods);
      if (initialData.dfProtoSub !== undefined) setDfProtoSub(initialData.dfProtoSub);
      if (initialData.bpfItems !== undefined || initialData.bpfRows !== undefined) setBpfItems(bpfMigrate(initialData));
      if (initialData.bpfNegate !== undefined) setBpfNegate(initialData.bpfNegate);
      if (initialData.ts !== undefined) setTs(initialData.ts);
      if (initialData.td !== undefined) setTd(initialData.td);
      // Display filter handed off from another tool (e.g. TCP Flag Decoder)
      if (initialData.incomingDisplayFilter !== undefined) {
        setTs(s => ({ ...s, displayFilter: initialData.incomingDisplayFilter }));
        setActiveTab('tshark');
        setTsharkSubTab('builder');
      }
    }
  }, [initialData]);

  useEffect(() => {
    fetch('/api/capabilities', { signal: AbortSignal.timeout(2500) })
      .then(r => r.json())
      .then(data => {
        setTcpdumpAvail(data.tcpdump ?? false);
        setTsharkAvail(data.tshark ?? false);
      })
      .catch(() => { setTcpdumpAvail(false); setTsharkAvail(false); });
  }, []);

  useEffect(() => {
    const tableEl = tdFullscreen ? tdFsTableRef.current : tdTableRef.current;
    const termEl  = tdFullscreen ? tdFsTermRef.current  : tdTermRef.current;
    if (tdOutputView === 'raw'   && termEl)              termEl.scrollTop  = termEl.scrollHeight;
    if (tdOutputView === 'table' && tableEl && tdAtBottom) tableEl.scrollTop = tableEl.scrollHeight;
  }, [tdLines, tdOutputView, tdAtBottom, tdFullscreen]);

  useEffect(() => {
    return () => {
      if (tdWrittenFile) {
        fetch(`/api/tcpdump-cleanup?file=${encodeURIComponent(tdWrittenFile)}`).catch(() => {});
      }
    };
  }, [tdWrittenFile]);

  useEffect(() => {
    return () => {
      if (tsWrittenFile) {
        fetch(`/api/tshark-cleanup?file=${encodeURIComponent(tsWrittenFile)}`).catch(() => {});
      }
    };
  }, [tsWrittenFile]);

  useEffect(() => {
    if (tsTermRef.current)   tsTermRef.current.scrollTop   = tsTermRef.current.scrollHeight;
    if (tsFsTermRef.current) tsFsTermRef.current.scrollTop = tsFsTermRef.current.scrollHeight;
  }, [tsLines]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (dfItems?.length || bpfItems?.length || ts?.interface) {
        (e.detail?.respond ?? onShare)({ tool: 'wireshark', activeTab, tsharkSubTab, dfItems, dfMods, dfProtoSub, bpfItems, bpfNegate, ts, td });
      }
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [activeTab, tsharkSubTab, dfItems, dfMods, dfProtoSub, bpfItems, bpfNegate, ts, td, onShare]);

  const commonFilters = [
    { cat: t('nav.infrastructure'), filters:[ // Reusing nav category names or tshark cats
      { f:'http.request.method == "POST"', d: t('wireshark.library.filters.http_post_exfiltration.desc') },
      { f:'tcp.flags.syn == 1 && tcp.flags.ack == 0', d: t('wireshark.library.filters.syn_scan_connection_attempts.desc') },
      { f:'dns.qry.name contains "malware"', d: t('wireshark.library.filters.suspicious_dns_queries.desc') },
      { f:'tls.handshake.extension.type == 0', d: t('wireshark.library.filters.identify_sni.desc') },
      { f:'frame contains "password"', d: t('wireshark.library.filters.search_sensitive_strings.desc') },
      { f:'http.request.method == "PUT"', d: t('wireshark.library.filters.detect_http_put_uploads.desc') },
      { f:'dns.qry.name.len > 50', d: t('wireshark.library.filters.long_dns_queries_tunneling.desc') },
      { f:'tcp.flags.syn == 1 && tcp.flags.ack == 0 && tcp.flags.fin == 0', d: t('wireshark.library.filters.syn_flood_indicator.desc') },
      { f:'ip.ttl < 10', d: t('wireshark.library.filters.low_ttl_packets.desc') },
    ]},
    { cat: t('wireshark.library.categories.tcp_performance'), filters:[
      { f:'tcp.analysis.retransmission', d: t('wireshark.library.filters.retransmitted_packets_loss.desc') },
      { f:'tcp.analysis.duplicate_ack', d: t('wireshark.library.filters.duplicate_acks_congestion.desc') },
      { f:'tcp.time_delta > 0.1', d: t('wireshark.library.filters.slow_responses_latency.desc') },
      { f:'tcp.window_size < 1000', d: t('wireshark.library.filters.small_window_size_throughput.desc') },
      { f:'tcp.flags.reset == 1', d: t('wireshark.library.filters.abrupt_connection_terminations.desc') },
      { f:'tcp.analysis.zero_window', d: t('wireshark.library.filters.zero_window_receiver_full.desc') },
      { f:'tcp.analysis.ack_rtt > 0.2', d: t('wireshark.library.filters.high_ack_rtt.desc') },
      { f:'tcp.analysis.out_of_order', d: t('wireshark.library.filters.out_of_order_segments.desc') },
      { f:'tcp.analysis.fast_retransmission', d: t('wireshark.library.filters.fast_retransmit_duplicate_acks.desc') },
    ]},
    { cat: t('wireshark.library.categories.application_web'), filters:[
      { f:'http.response.code >= 400', d: t('wireshark.library.filters.http_client_server_errors.desc') },
      { f:'dns.flags.rcode != 0', d: t('wireshark.library.filters.dns_error_responses.desc') },
      { f:'http2.headers.method == "POST"', d: t('wireshark.library.filters.modern_http2_post_requests.desc') },
      { f:'grpc.status > 0', d: t('wireshark.library.filters.failed_grpc_calls.desc') },
      { f:'json.value.string == "error"', d: t('wireshark.library.filters.search_errors_json_payloads.desc') },
      { f:'http.request.uri contains "admin"', d: t('wireshark.library.filters.requests_targeting_admin.desc') },
      { f:'http.response.code == 301 || http.response.code == 302', d: t('wireshark.library.filters.http_redirects_phishing.desc') },
      { f:'tls.record.content_type == 23 && tls.app_data', d: t('wireshark.library.filters.encrypted_tls_app_data.desc') },
      { f:'http.request.method in {"GET" "POST" "PUT" "DELETE"}', d: t('wireshark.library.filters.all_http_crud_methods.desc') },
    ]},
    { cat: t('wireshark.library.categories.voip_media'), filters:[
      { f:'sip.Method == "INVITE"', d: t('wireshark.library.filters.voip_sip_call_setup.desc') },
      { f:'rtp.ssrc', d: t('wireshark.library.filters.rtp_stream_identification.desc') },
      { f:'rtp.p_type == 0', d: t('wireshark.library.filters.g711_pcmu_audio.desc') },
      { f:'sip.Status-Code >= 400', d: t('wireshark.library.filters.sip_signaling_errors.desc') },
      { f:'sip.Method == "BYE"', d: t('wireshark.library.filters.sip_call_termination.desc') },
      { f:'rtp.marker == 1', d: t('wireshark.library.filters.rtp_marker_bit.desc') },
      { f:'rtcp.sr.ntp_timestamp', d: t('wireshark.library.filters.rtcp_sender_reports.desc') },
    ]},
    { cat: t('wireshark.library.categories.network_troubleshooting'), filters:[
      { f:'arp.opcode == 1', d: t('wireshark.library.filters.arp_requests_who_has.desc') },
      { f:'arp.duplicate-address-detected', d: t('wireshark.library.filters.arp_conflict_duplicate_ip.desc') },
      { f:'icmp.type == 3', d: t('wireshark.library.filters.icmp_destination_unreachable.desc') },
      { f:'icmp.type == 11', d: t('wireshark.library.filters.icmp_time_exceeded.desc') },
      { f:'icmp.type == 5', d: t('wireshark.library.filters.icmp_redirect_misconfigured_routing.desc') },
      { f:'dhcp.option.dhcp_message_type == 1', d: t('wireshark.library.filters.dhcp_discover_packets.desc') },
      { f:'dhcp.option.dhcp_message_type == 5', d: t('wireshark.library.filters.dhcp_ack_ip_assigned.desc') },
      { f:'stp.type == 0', d: t('wireshark.library.filters.stp_bridge_protocol_topology.desc') },
      { f:'vrrp.vrid || hsrp.state', d: t('wireshark.library.filters.first_hop_redundancy.desc') },
    ]},
    { cat: t('wireshark.library.categories.ipv6'), filters:[
      { f:'ipv6', d: t('wireshark.library.filters.all_ipv6_traffic.desc') },
      { f:'ipv6.hlim < 10', d: t('wireshark.library.filters.ipv6_packets_near_ttl_expiry.desc') },
      { f:'icmpv6.type == 134', d: t('wireshark.library.filters.ipv6_router_advertisements.desc') },
      { f:'icmpv6.type == 135', d: t('wireshark.library.filters.ipv6_neighbor_solicitation.desc') },
      { f:'dhcpv6.msgtype == 1', d: t('wireshark.library.filters.dhcpv6_solicit.desc') },
      { f:'ipv6.addr == fe80::/10', d: t('wireshark.library.filters.link_local_ipv6_traffic.desc') },
    ]},
    { cat: t('wireshark.library.categories.wireless_802_11'), filters:[
      { f:'wlan.fc.type == 0 && wlan.fc.subtype == 8', d: t('wireshark.library.filters.wifi_beacon_frames.desc') },
      { f:'wlan.fc.type == 0 && wlan.fc.subtype == 4', d: t('wireshark.library.filters.wifi_probe_requests.desc') },
      { f:'wlan.fc.retry == 1', d: t('wireshark.library.filters.retransmitted_wifi_frames.desc') },
      { f:'radiotap.dbm_antsignal < -70', d: t('wireshark.library.filters.weak_wifi_signal.desc') },
      { f:'wlan.fc.protected == 0', d: t('wireshark.library.filters.unencrypted_wifi_data.desc') },
    ]},
    { cat: t('wireshark.library.categories.industrial_scada'), filters:[
      { f:'mbtcp.prot_id == 0', d: t('wireshark.library.filters.modbus_tcp_traffic.desc') },
      { f:'s7comm.data.func == 0x05', d: t('wireshark.library.filters.siemens_s7_write_variable.desc') },
      { f:'enip.pccc.cmd == 0x0f', d: t('wireshark.library.filters.ethernetip_pccc_command.desc') },
      { f:'bacapp.service.choice == 1', d: t('wireshark.library.filters.bacnet_readproperty_request.desc') },
      { f:'cotp.tpdu == 0xf0', d: t('wireshark.library.filters.cotp_tpkt_s7comm_iec104.desc') },
    ]}
  ];

  const tsharkCmds = [
    { cat: t('wireshark.tshark.categories.live_capture'), cmds:[
      { c:'tshark -i eth0', d: t('wireshark.tshark.commands.start_live_capture_eth0.desc') },
      { c:'tshark -i eth0 -f "port 53" -w dns.pcap', d: t('wireshark.tshark.commands.capture_filter_dns_save_file.desc') },
      { c:'tshark -i any -f "host 10.0.0.1 and port 443"', d: t('wireshark.tshark.commands.capture_filter_host_port.desc') },
      { c:'tshark -i eth0 -c 1000 -w capture.pcap', d: t('wireshark.tshark.commands.capture_exactly_packets_stop.desc') },
      { c:'tshark -i eth0 -a duration:60 -w capture.pcap', d: t('wireshark.tshark.commands.capture_duration_stop.desc') },
      { c:'tshark -i eth0 -a filesize:100000 -b files:5 -w ring.pcap', d: t('wireshark.tshark.commands.ring_buffer_files.desc') },
    ]},
    { cat: t('wireshark.tshark.categories.packet_extraction'), cmds:[
      { c:'tshark -i 1 -Y "http.request" -T fields -e http.host -e http.request.uri', d: t('wireshark.tshark.commands.extract_http_hosts_uris.desc') },
      { c:'tshark -r file.pcap -Y "dns.flags.response == 0" -T fields -e dns.qry.name', d: t('wireshark.tshark.commands.list_unique_dns_queries.desc') },
      { c:'tshark -r file.pcap -T fields -e ip.src -e ip.dst -e tcp.port | sort | uniq -c | sort -rn | head -20', d: t('wireshark.tshark.commands.top_20_talkers.desc') },
      { c:'tshark -r file.pcap -T fields -e frame.time -e ip.src -e ip.dst -e http.user_agent', d: t('wireshark.tshark.commands.extract_user_agents_timestamps.desc') },
      { c:'tshark -r file.pcap -Y "http" -T fields -e http.request.method -e http.host -e http.request.uri -e http.response.code', d: t('wireshark.tshark.commands.full_http_transaction_summary.desc') },
      { c:'tshark -r file.pcap -Y "tcp.flags.syn==1 && tcp.flags.ack==1" -T fields -e ip.src -e ip.dst -e tcp.srcport -e tcp.dstport', d: t('wireshark.tshark.commands.extract_all_tcp_handshake_completions.desc') },
      { c:'tshark -r file.pcap -Y "ip.src == 10.0.0.1" -T fields -e frame.time_relative -e tcp.seq -e tcp.len', d: t('wireshark.tshark.commands.time_sequence_data_plot.desc') },
    ]},
    { cat: t('wireshark.tshark.categories.statistics_analysis'), cmds:[
      { c:'tshark -r file.pcap -z io,phs', d: t('wireshark.tshark.commands.protocol_hierarchy_statistics.desc') },
      { c:'tshark -r file.pcap -z expert', d: t('wireshark.tshark.commands.show_expert_info.desc') },
      { c:'tshark -r file.pcap -z conv,tcp', d: t('wireshark.tshark.commands.list_all_tcp_conversations.desc') },
      { c:'tshark -r file.pcap -z io,stat,1,"COUNT(tcp.flags.reset)tcp.flags.reset"', d: t('wireshark.tshark.commands.graph_tcp_resets_per_second.desc') },
      { c:'tshark -r file.pcap -z conv,ip', d: t('wireshark.tshark.commands.ip_conversation_statistics.desc') },
      { c:'tshark -r file.pcap -z dns,tree', d: t('wireshark.tshark.commands.dns_request_response_statistics.desc') },
      { c:'tshark -r file.pcap -z http,tree', d: t('wireshark.tshark.commands.http_request_distribution.desc') },
    ]},
    { cat: t('wireshark.tshark.categories.security_troubleshooting'), cmds:[
      { c:'tshark -r file.pcap -Y "tcp.flags.syn==1 && tcp.flags.ack == 0" -T fields -e ip.src | sort | uniq -c | sort -rn', d: t('wireshark.tshark.commands.find_ips_syn_scans.desc') },
      { c:'tshark -r file.pcap -z follow,tcp,ascii,0', d: t('wireshark.tshark.commands.follow_tcp_stream_gui.desc') },
      { c:'tshark -r file.pcap -o "tls.keylog_file:ssl.keys" -Y "http"', d: t('wireshark.tshark.commands.decrypt_tls_keylog.desc') },
      { c:'tshark -r file.pcap -Y "arp.duplicate-address-detected" -T fields -e arp.src.proto_ipv4 -e arp.src.hw_mac', d: t('wireshark.tshark.commands.find_arp_conflicts_mac.desc') },
      { c:'tshark -r file.pcap -Y "icmp.type == 3" -T fields -e ip.src -e icmp.dst_ip', d: t('wireshark.tshark.commands.destination_unreachable_sources.desc') },
      { c:'tshark -r file.pcap -Y "dns.flags.rcode == 3" -T fields -e dns.qry.name | sort | uniq -c | sort -rn', d: t('wireshark.tshark.commands.most_frequent_failed_dns.desc') },
    ]},
    { cat: t('wireshark.tshark.categories.voip_rtp'), cmds:[
      { c:'tshark -r voip.pcap -z rtp,streams', d: t('wireshark.tshark.commands.list_all_rtp_streams.desc') },
      { c:'tshark -r voip.pcap -Y "sip.Method == \\"INVITE\\"" -T fields -e sip.from.user -e sip.to.user', d: t('wireshark.tshark.commands.extract_sip_caller_callee.desc') },
      { c:'tshark -r voip.pcap -Y "rtp" -T fields -e ip.src -e ip.dst -e rtp.ssrc -e rtp.p_type | sort -u', d: t('wireshark.tshark.commands.unique_rtp_streams_codec.desc') },
      { c:'tshark -r voip.pcap -z voip,calls', d: t('wireshark.tshark.commands.voip_call_summary.desc') },
    ]}
  ];

  const dfFields = [
    { group:t('wireshark.fields.groups.ip'), fields:[
      { value:'ip.src',    label:t('wireshark.fields.ip_source.label'),     type:'ip'   },
      { value:'ip.dst',    label:t('wireshark.fields.ip_dest.label'),        type:'ip'   },
      { value:'ip.addr',   label:t('wireshark.fields.ip_any.label'),         type:'ip'   },
      { value:'ipv6.src',  label:t('wireshark.fields.ipv6_source.label'),    type:'ip'   },
      { value:'ipv6.dst',  label:t('wireshark.fields.ipv6_dest.label'),      type:'ip'   },
      { value:'ipv6.addr', label:t('wireshark.fields.ipv6_any.label'),       type:'ip'   },
    ]},
    { group:t('wireshark.fields.groups.transport'), fields:[
      { value:'tcp.port',     label:t('wireshark.fields.tcp_port_any.label'),  type:'port' },
      { value:'tcp.srcport',  label:t('wireshark.fields.tcp_src_port.label'),    type:'port' },
      { value:'tcp.dstport',  label:t('wireshark.fields.tcp_dst_port.label'),    type:'port' },
      { value:'udp.port',     label:t('wireshark.fields.udp_port_any.label'),  type:'port' },
      { value:'udp.srcport',  label:t('wireshark.fields.udp_src_port.label'),    type:'port' },
      { value:'udp.dstport',  label:t('wireshark.fields.udp_dst_port.label'),    type:'port' },
    ]},
    { group:t('wireshark.bpf.fields.groups.protocol'), fields:[
      { value:'http',   label:t('wireshark.fields.http.label'),       type:'proto', sub:'http' },
      { value:'tls',    label:t('wireshark.fields.tls_https.label'),  type:'proto', sub:'tls'  },
      { value:'dns',    label:t('wireshark.fields.dns.label'),        type:'proto', sub:'dns'  },
      { value:'tcp',    label:t('wireshark.fields.tcp.label'),        type:'proto' },
      { value:'udp',    label:t('wireshark.fields.udp.label'),        type:'proto' },
      { value:'icmp',   label:t('wireshark.fields.icmp.label'),       type:'proto' },
      { value:'icmpv6', label:t('wireshark.fields.icmpv6.label'),     type:'proto' },
      { value:'arp',    label:t('wireshark.fields.arp.label'),        type:'proto' },
      { value:'dhcp',   label:t('wireshark.fields.dhcp.label'),       type:'proto' },
      { value:'quic',   label:t('wireshark.fields.quic.label'),       type:'proto' },
      { value:'sip',    label:t('wireshark.fields.sip.label'),        type:'proto', sub:'sip' },
      { value:'rtp',    label:t('wireshark.fields.rtp.label'),        type:'proto' },
      { value:'ssh',    label:t('wireshark.fields.ssh.label'),        type:'proto' },
      { value:'ftp',    label:t('wireshark.fields.ftp.label'),        type:'proto' },
      { value:'smtp',   label:t('wireshark.fields.smtp.label'),       type:'proto' },
      { value:'mqtt',   label:t('wireshark.fields.mqtt.label'),       type:'proto' },
    ]},
    { group:t('wireshark.fields.groups.tcp_flags'), fields:[
      { value:'tcp.flags.syn',   label:t('wireshark.fields.tcp_syn.label'),  type:'flag' },
      { value:'tcp.flags.ack',   label:t('wireshark.fields.tcp_ack.label'),  type:'flag' },
      { value:'tcp.flags.fin',   label:t('wireshark.fields.tcp_fin.label'),  type:'flag' },
      { value:'tcp.flags.reset', label:t('wireshark.fields.tcp_rst.label'),  type:'flag' },
      { value:'tcp.flags.push',  label:t('wireshark.fields.tcp_psh.label'),  type:'flag' },
    ]},
    { group:t('wireshark.fields.groups.tcp_analysis'), fields:[
      { value:'tcp.analysis.retransmission',     label:t('wireshark.fields.retransmission.label'),  type:'bool' },
      { value:'tcp.analysis.duplicate_ack',      label:t('wireshark.fields.duplicate_ack.label'),   type:'bool' },
      { value:'tcp.analysis.zero_window',        label:t('wireshark.fields.zero_window.label'),     type:'bool' },
      { value:'tcp.analysis.out_of_order',       label:t('wireshark.fields.out_of_order.label'),    type:'bool' },
      { value:'tcp.analysis.fast_retransmission',label:t('wireshark.fields.fast_retransmit.label'), type:'bool' },
      { value:'tcp.analysis.ack_rtt',            label:t('wireshark.fields.ack_rtt.label'),         type:'num'  },
    ]},
    { group:t('wireshark.fields.groups.frame_ip'), fields:[
      { value:'frame.len',           label:t('wireshark.fields.frame_length.label'),    type:'num' },
      { value:'frame.time_relative', label:t('wireshark.fields.time_rel_s.label'),    type:'num' },
      { value:'ip.ttl',              label:t('wireshark.fields.ip_ttl.label'),          type:'num' },
      { value:'tcp.time_delta',      label:t('wireshark.fields.tcp_time_delta.label'),  type:'num' },
      { value:'tcp.stream',          label:t('wireshark.fields.tcp_stream.label'),      type:'num' },
      { value:'tcp.window_size',     label:t('wireshark.fields.tcp_window_size.label'), type:'num' },
      { value:'vlan.id',             label:t('wireshark.fields.vlan_id.label'),         type:'num' },
    ]},
  ];

  const dfOps = { ip:['==','!='], port:['==','!=','>','<','>=','<='], proto:[], flag:['==','!='], bool:[], num:['==','!=','>','<','>=','<='], str:['==','!=','contains','matches'] };

  const protoSubDefs = {
    http:[
      { key:'method', label:t('wireshark.protosub.http.method.label'),        type:'select', opts:['','GET','POST','PUT','DELETE','PATCH','HEAD','OPTIONS'], fn:v=>`http.request.method == "${v}"` },
      { key:'status', label:t('wireshark.protosub.http.status_code.label'),   type:'text',   fn:v=>`http.response.code == ${v}` },
      { key:'uri',    label:t('wireshark.protosub.http.uri_contains.label'),  type:'text',   fn:v=>`http.request.uri contains "${v}"` },
      { key:'host',   label:t('wireshark.protosub.http.host_contains.label'), type:'text',   fn:v=>`http.host contains "${v}"` },
    ],
    tls:[
      { key:'sni', label:t('wireshark.protosub.tls.sni_contains.label'), type:'text', fn:v=>`tls.handshake.extensions_server_name contains "${v}"` },
    ],
    dns:[
      { key:'qname', label:t('wireshark.protosub.dns.qname_contains.label'), type:'text', fn:v=>`dns.qry.name contains "${v}"` },
      { key:'qtype', label:t('wireshark.protosub.dns.record_type.label'), type:'select', opts:['','A','AAAA','MX','CNAME','NS','PTR','TXT','SOA'],
        fn:v=>{const m={A:'1',AAAA:'28',MX:'15',CNAME:'5',NS:'2',PTR:'12',TXT:'16',SOA:'6'};return `dns.qry.type == ${m[v]||v}`;} },
      { key:'rcode', label:t('wireshark.protosub.dns.response_code.label'), type:'select', opts:['','NOERROR','NXDOMAIN','SERVFAIL','REFUSED'],
        fn:v=>{const m={NOERROR:'0',NXDOMAIN:'3',SERVFAIL:'2',REFUSED:'5'};return `dns.flags.rcode == ${m[v]||v}`;} },
    ],
    sip:[
      { key:'method', label:t('wireshark.protosub.sip.method.label'),      type:'select', opts:['','INVITE','BYE','REGISTER','OPTIONS','ACK','CANCEL','UPDATE'], fn:v=>`sip.Method == "${v}"` },
      { key:'status', label:t('wireshark.protosub.sip.status_code.label'), type:'text',   fn:v=>`sip.Status-Code == ${v}` },
    ],
  };

  const bpfFields = [
    { group:t('wireshark.bpf.fields.groups.host'), fields:[
      { value:'host',      label:t('wireshark.bpf.fields.host_any.label'),    hasVal:true,  ex:'10.0.0.1' },
      { value:'src host',  label:t('wireshark.bpf.fields.source_host.label'),   hasVal:true,  ex:'10.0.0.1' },
      { value:'dst host',  label:t('wireshark.bpf.fields.dest_host.label'),     hasVal:true,  ex:'10.0.0.1' },
      { value:'net',       label:t('wireshark.bpf.fields.network_cidr.label'),hasVal:true,  ex:'192.168.1.0/24' },
      { value:'src net',   label:t('wireshark.bpf.fields.src_network.label'),   hasVal:true,  ex:'10.0.0.0/8' },
      { value:'dst net',   label:t('wireshark.bpf.fields.dst_network.label'),   hasVal:true,  ex:'10.0.0.0/8' },
    ]},
    { group:t('wireshark.bpf.fields.groups.port'), fields:[
      { value:'port',      label:t('wireshark.bpf.fields.port_any.label'),    hasVal:true, ex:'443' },
      { value:'src port',  label:t('wireshark.bpf.fields.source_port.label'),   hasVal:true, ex:'443' },
      { value:'dst port',  label:t('wireshark.bpf.fields.dest_port.label'),     hasVal:true, ex:'443' },
      { value:'portrange', label:t('wireshark.bpf.fields.port_range.label'),    hasVal:true, ex:'6000-6063' },
    ]},
    { group:t('wireshark.bpf.fields.groups.protocol'), fields:[
      { value:'tcp',   label:t('wireshark.fields.tcp.label'),    hasVal:false },
      { value:'udp',   label:t('wireshark.fields.udp.label'),    hasVal:false },
      { value:'icmp',  label:t('wireshark.fields.icmp.label'),   hasVal:false },
      { value:'icmp6', label:t('wireshark.fields.icmpv6.label'), hasVal:false },
      { value:'arp',   label:t('wireshark.fields.arp.label'),    hasVal:false },
      { value:'ip',    label:t('wireshark.bpf.fields.ipv4.label', 'IPv4'),   hasVal:false },
      { value:'ip6',   label:t('wireshark.bpf.fields.ipv6.label', 'IPv6'),   hasVal:false },
    ]},
    { group:t('wireshark.bpf.fields.groups.size'), fields:[
      { value:'less',    label:t('wireshark.bpf.fields.less_than.label', 'Less than (bytes)'),    hasVal:true, ex:'512'  },
      { value:'greater', label:t('wireshark.bpf.fields.greater_than.label', 'Greater than (bytes)'), hasVal:true, ex:'1000' },
    ]},
  ];

  const dfNextId  = React.useRef(2);
  const bpfNextId = React.useRef(2);
  const addDfCondition = () => setDfItems(r=>[...r,{id:dfNextId.current++,type:'condition',field:'ip.addr',op:'==',value:'',connector:'and'}]);
  const addDfGroup     = () => setDfItems(r=>[...r,{id:dfNextId.current++,type:'group',negate:false,connector:'and',rows:[{id:dfNextId.current++,field:'ip.addr',op:'==',value:'',connector:'and'}]}]);
  const removeDfItem   = id  => setDfItems(r=>r.filter(item=>item.id!==id));
  const updateDfItem   = (id,p) => setDfItems(r=>r.map(item=>item.id===id?{...item,...p}:item));
  const addGroupDfRow     = gid => setDfItems(r=>r.map(item=>item.id===gid&&item.type==='group'?{...item,rows:[...item.rows,{id:dfNextId.current++,field:'ip.addr',op:'==',value:'',connector:'and'}]}:item));
  const removeGroupDfRow  = (gid,rid) => setDfItems(r=>r.map(item=>item.id===gid&&item.type==='group'?{...item,rows:item.rows.filter(row=>row.id!==rid)}:item));
  const updateGroupDfRow  = (gid,rid,p) => setDfItems(r=>r.map(item=>item.id===gid&&item.type==='group'?{...item,rows:item.rows.map(row=>row.id===rid?{...row,...p}:row)}:item));
  const addBpfCondition = () => setBpfItems(r=>[...r,{id:bpfNextId.current++,type:'condition',field:'host',value:'',connector:'and'}]);
  const addBpfGroup     = () => setBpfItems(r=>[...r,{id:bpfNextId.current++,type:'group',negate:false,connector:'and',rows:[{id:bpfNextId.current++,field:'host',value:'',connector:'and'}]}]);
  const removeBpfItem   = id  => setBpfItems(r=>r.filter(item=>item.id!==id));
  const updateBpfItem   = (id,p) => setBpfItems(r=>r.map(item=>item.id===id?{...item,...p}:item));
  const addGroupRow     = gid => setBpfItems(r=>r.map(item=>item.id===gid&&item.type==='group'?{...item,rows:[...item.rows,{id:bpfNextId.current++,field:'host',value:'',connector:'and'}]}:item));
  const removeGroupRow  = (gid,rid) => setBpfItems(r=>r.map(item=>item.id===gid&&item.type==='group'?{...item,rows:item.rows.filter(row=>row.id!==rid)}:item));
  const updateGroupRow  = (gid,rid,p) => setBpfItems(r=>r.map(item=>item.id===gid&&item.type==='group'?{...item,rows:item.rows.map(row=>row.id===rid?{...row,...p}:row)}:item));
  const getFieldDef  = f       => dfFields.flatMap(g=>g.fields).find(x=>x.value===f);
  const getBpfDef    = f       => bpfFields.flatMap(g=>g.fields).find(x=>x.value===f);
  const getOps       = f       => { const fd=getFieldDef(f); return fd?dfOps[fd.type]||[]:['==']; };

  const dfClause = (row) => {
    const fd = getFieldDef(row.field);
    if (!fd) return '';
    let clause = '';
    if (fd.type === 'proto' || fd.type === 'bool') {
      clause = row.field;
    } else if (fd.type === 'flag') {
      if (row.value !== '') clause = `${row.field} ${row.op} ${row.value}`;
    } else {
      if (row.value) {
        const q = row.op === 'contains' || row.op === 'matches';
        clause = q ? `${row.field} ${row.op} "${row.value}"` : `${row.field} ${row.op} ${row.value}`;
      }
    }
    const sub = dfProtoSub[row.id];
    if (sub && fd.sub && protoSubDefs[fd.sub]) {
      const subs = protoSubDefs[fd.sub].filter(sd=>sub[sd.key]).map(sd=>sd.fn(sub[sd.key]));
      if (subs.length) clause = clause ? `(${[clause,...subs].join(' && ')})` : subs.join(' && ');
    }
    return clause;
  };

  const generateDisplayFilter = () => {
    const parts = [];
    dfItems.forEach((item, idx) => {
      let segment = '';
      if (item.type === 'condition') {
        segment = dfClause(item);
      } else if (item.type === 'group' && item.rows) {
        const inner = [];
        item.rows.forEach(r => {
          const c = dfClause(r);
          if (!c) return;
          if (inner.length > 0) {
            const prev = item.rows[item.rows.indexOf(r) - 1];
            inner.push((prev && prev.connector) === 'or' ? '||' : '&&');
          }
          inner.push(c);
        });
        const expr = inner.join(' ');
        if (!expr) return;
        segment = item.negate ? `!(${expr})` : `(${expr})`;
      }
      if (!segment) return;
      if (parts.length > 0) {
        const prev = dfItems[idx - 1];
        parts.push((prev && prev.connector) === 'or' ? '||' : '&&');
      }
      parts.push(segment);
    });
    if (dfMods.synOnly)    { if(parts.length) parts.push('&&'); parts.push('tcp.flags.syn == 1 && tcp.flags.ack == 0'); }
    if (dfMods.errorsOnly) { if(parts.length) parts.push('&&'); parts.push('(tcp.analysis.retransmission || tcp.analysis.duplicate_ack || tcp.flags.reset == 1)'); }
    if (dfMods.noNoise)    { if(parts.length) parts.push('&&'); parts.push('!(tcp.port == 22 || tcp.port == 3389 || tcp.port == 5900)'); }
    let f = parts.join(' ') || '...';
    if (dfMods.negate && f !== '...') f = `!(${f})`;
    return f;
  };

  const bpfClause = (row) => {
    const fd = getBpfDef(row.field);
    if (!fd) return '';
    return fd.hasVal ? (row.value ? `${row.field} ${row.value}` : '') : row.field;
  };

  const generateBpfFilter = () => {
    const parts = [];
    bpfItems.forEach((item, idx) => {
      let segment = '';
      if (item.type === 'condition') {
        segment = bpfClause(item);
      } else if (item.type === 'group' && item.rows) {
        const inner = [];
        item.rows.forEach(r => {
          const c = bpfClause(r);
          if (!c) return;
          if (inner.length > 0) {
            const prev = item.rows[item.rows.indexOf(r) - 1];
            inner.push((prev && prev.connector) === 'or' ? 'or' : 'and');
          }
          inner.push(c);
        });
        const expr = inner.join(' ');
        if (!expr) return;
        segment = item.negate ? `not (${expr})` : `(${expr})`;
      }
      if (!segment) return;
      if (parts.length > 0) {
        const prev = bpfItems[idx - 1];
        parts.push((prev && prev.connector) === 'or' ? 'or' : 'and');
      }
      parts.push(segment);
    });
    let f = parts.join(' ') || '...';
    if (bpfNegate && f !== '...') f = `not (${f})`;
    return f;
  };

  const displayFilterStr = generateDisplayFilter();
  const bpfFilterStr     = generateBpfFilter();

  const generateTcpdumpCmd = () => {
    const parts = ['tcpdump'];
    if (td.mode === 'live') {
      parts.push(`-i ${td.iface || 'eth0'}`);
      if (td.count)    parts.push(`-c ${td.count}`);
      const previewFile = td.writeFile.trim() || tdAutoFile;
      parts.push(`-w /tmp/${previewFile}`);
    } else {
      parts.push(`-r ${td.readFile || 'capture.pcap'}`);
    }
    if (td.snaplen)   parts.push(`-s ${td.snaplen}`);
    if (td.nodns)     parts.push(td.nodns);
    if (td.verbosity) parts.push(td.verbosity);
    if (td.output)    parts.push(td.output);
    if (td.timestamp) parts.push(td.timestamp);
    if (td.linkLayer) parts.push('-e');
    if (td.filter)    parts.push(`'${td.filter}'`);
    return parts.join(' ');
  };

  const startTcpdump = useCallback(() => {
    const effectiveWriteFile = td.writeFile.trim() || tdAutoFile;
    setTdLines([]); setTdPackets([]); setTdExpandedRows(new Set());
    setTdExitCode(null); setTdScanning(true);
    setTdWrittenFile(td.mode === 'live' ? effectiveWriteFile : null);
    setTdAtBottom(true);
    // Reset output format and timestamp — non-default values break table parsing
    setTd(s => ({ ...s, output: '', timestamp: '' }));

    const params = new URLSearchParams({
      iface: td.iface || 'eth0',
      count: td.count || '100',
    });
    if (td.filter)    params.set('filter', td.filter);
    if (td.snaplen)   params.set('snaplen', td.snaplen);
    if (td.nodns)     params.set('nodns', td.nodns);
    if (td.verbosity) params.set('verbosity', td.verbosity);
    // output and timestamp intentionally omitted — reset to defaults for table compatibility
    if (td.linkLayer) params.set('linkLayer', '1');
    if (td.mode === 'live') params.set('writeFile', effectiveWriteFile);

    const es = new EventSource(`/api/tcpdump-run?${params}`);
    tdEsRef.current = es;
    let packetCount = 0;
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'done') {
        setTdExitCode(Number(msg.line)); setTdScanning(false); es.close();
      } else {
        setTdLines(prev => [...prev, { type: msg.type, text: msg.line }]);
        // Continuation lines (leading whitespace) belong to the previous packet
        if (/^\s/.test(msg.line)) {
          setTdPackets(prev => {
            if (prev.length === 0) return prev;
            const last = prev[prev.length - 1];
            const updatedRaw = last.raw + '\n' + msg.line;
            // Verbose mode puts src > dst on the continuation line; promote columns if parent had none
            if (!last.src && !last.dst) {
              const fields = parseContinuationForColumns(msg.line);
              if (fields) return [...prev.slice(0, -1), { ...last, ...fields, raw: updatedRaw }];
            }
            return [...prev.slice(0, -1), { ...last, raw: updatedRaw }];
          });
        } else {
          packetCount++;
          const pkt = parseTcpdumpLine(msg.line, packetCount);
          setTdPackets(prev => {
            const capped = prev.length >= 2000 ? prev.slice(1) : prev;
            return [...capped, pkt];
          });
        }
      }
    };
    es.onerror = () => { setTdScanning(false); es.close(); };
  }, [td, tdAutoFile]);

  const stopTcpdump = () => {
    if (tdEsRef.current) { tdEsRef.current.close(); tdEsRef.current = null; }
    setTdScanning(false);
  };

  const startTshark = useCallback(() => {
    if (ts.mode !== 'live') return;
    const effectiveWriteFile = ts.writeFile.trim() || tsAutoFile;
    setTsLines([]); setTsExitCode(null); setTsScanning(true);
    setTsWrittenFile(effectiveWriteFile);

    const safeFmt = (ts.outputFmt === 'json' || ts.outputFmt === 'pdml') ? 'default' : ts.outputFmt;
    if (safeFmt !== ts.outputFmt) setTs(s => ({ ...s, outputFmt: safeFmt }));

    const params = new URLSearchParams({ iface: ts.iface || 'eth0' });
    if (ts.captureFilter) params.set('captureFilter', ts.captureFilter);
    if (ts.displayFilter) params.set('displayFilter', ts.displayFilter);
    if (ts.count)         params.set('count', ts.count);
    if (ts.duration)      params.set('duration', ts.duration);
    if (safeFmt !== 'default') params.set('outputFmt', safeFmt);
    if (safeFmt === 'fields' && ts.fields) params.set('fields', ts.fields);
    if (ts.stats)         params.set('stats', ts.stats);
    params.set('writeFile', effectiveWriteFile);

    const es = new EventSource(`/api/tshark-run?${params}`);
    tsEsRef.current = es;
    es.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'done') {
        setTsExitCode(Number(msg.line)); setTsScanning(false); es.close();
      } else {
        setTsLines(prev => [...prev, msg.line]);
      }
    };
    es.onerror = () => { setTsScanning(false); es.close(); };
  }, [ts, tsAutoFile]);

  const stopTshark = () => {
    if (tsEsRef.current) { tsEsRef.current.close(); tsEsRef.current = null; }
    setTsScanning(false);
  };

  return (
    <div className="fadein">
      <div style={{display:'flex', gap:8, marginBottom:20, flexWrap:'wrap'}}>
        {[
          { id:'tcpdump', label:t('wireshark.tcpdump.tab') },
          { id:'tshark',  label:t('wireshark.tabs.tshark') },
          { id:'display', label:t('wireshark.tabs.display') },
          { id:'capture', label:t('wireshark.tabs.capture') },
          { id:'library', label:t('wireshark.tabs.library') },
        ].map(t_tab => (
          <button key={t_tab.id} className={'btn btn-sm ' + (activeTab===t_tab.id?'btn-primary':'btn-ghost')} onClick={()=>setActiveTab(t_tab.id)}>
            {t_tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'display' && (
        <div className="card fadein">
          <div className="card-title">{t('wireshark.display.title')}</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {dfItems.map((item,idx)=>{
              const isLast = idx === dfItems.length - 1;
              if (item.type === 'condition') {
                const fd=getFieldDef(item.field);
                const ops=getOps(item.field);
                return (
                  <div key={item.id}>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <select className="select" style={{flex:'0 0 190px'}} value={item.field}
                        onChange={e=>{
                          const nf=e.target.value;
                          const nops=getOps(nf);
                          updateDfItem(item.id,{field:nf,op:nops[0]||'==',value:''});
                          setDfProtoSub(s=>{const n={...s};delete n[item.id];return n;});
                        }}>
                        {dfFields.map(g=>(
                          <optgroup key={g.group} label={g.group}>
                            {g.fields.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      {ops.length>0&&(
                        <select className="select" style={{flex:'0 0 110px'}} value={item.op}
                          onChange={e=>updateDfItem(item.id,{op:e.target.value})}>
                          {ops.map(o=><option key={o} value={o}>{o}</option>)}
                        </select>
                      )}
                      {fd&&fd.type!=='proto'&&fd.type!=='bool'?(
                        <input className="input" style={{flex:1}} placeholder={t('wireshark.display.value_placeholder', 'value')} value={item.value}
                          onChange={e=>updateDfItem(item.id,{value:e.target.value})}/>
                      ):(
                        <span style={{flex:1,color:'var(--muted)',fontSize:12}}>{t('wireshark.display.presence')}</span>
                      )}
                      {dfItems.length>1&&(
                        <button className="btn btn-ghost btn-sm" style={{color:'var(--muted)'}} onClick={()=>removeDfItem(item.id)}>×</button>
                      )}
                    </div>
                    {fd && fd.sub && protoSubDefs[fd.sub] && (
                      <div style={{marginLeft:16,marginTop:6,padding:10,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:6}}>
                        <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>{t('wireshark.display.subfields_hint', { label: fd.label })}</div>
                        <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
                          {protoSubDefs[fd.sub].map(sd=>{
                            const val = (dfProtoSub[item.id] && dfProtoSub[item.id][sd.key]) || '';
                            const setVal=v=>setDfProtoSub(s=>({...s,[item.id]:{...s[item.id],[sd.key]:v}}));
                            return (
                              <div key={sd.key} style={{display:'flex',flexDirection:'column',gap:4}}>
                                <label className="label" style={{fontSize:11}}>{sd.label}</label>
                                {sd.type==='select'?(
                                  <select className="select" style={{minWidth:120}} value={val} onChange={e=>setVal(e.target.value)}>
                                    {sd.opts.map(o=><option key={o} value={o}>{o||t('wireshark.display.any')}</option>)}
                                  </select>
                                ):(
                                  <input className="input" style={{minWidth:130}} placeholder={t('wireshark.display.optional_placeholder', 'optional')} value={val} onChange={e=>setVal(e.target.value)}/>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {!isLast&&(
                      <div style={{display:'flex',gap:6,marginTop:6,marginLeft:8}}>
                        {['and','or'].map(c=>(
                          <button key={c} onClick={()=>updateDfItem(item.id,{connector:c})}
                            className={`btn btn-sm ${item.connector===c?'btn-primary':'btn-ghost'}`}
                            style={{padding:'2px 14px',fontSize:11}}>{c.toUpperCase()}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              // group item
              return (
                <div key={item.id} style={{borderLeft:'3px solid var(--accent)',background:'var(--panel)',padding:12,borderRadius:6}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--accent)',textTransform:'uppercase',letterSpacing:1}}>{t('wireshark.display.group_label')}</span>
                    <label style={{display:'flex',alignItems:'center',gap:4,fontSize:12,cursor:'pointer',color:'var(--muted)'}}>
                      <input type="checkbox" checked={item.negate} onChange={e=>updateDfItem(item.id,{negate:e.target.checked})}/>
                      {t('wireshark.display.negate_group')}
                    </label>
                    <div style={{flex:1}}/>
                    {dfItems.length>1&&(
                      <button className="btn btn-ghost btn-sm" style={{color:'var(--muted)'}} onClick={()=>removeDfItem(item.id)}>×</button>
                    )}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:8,paddingLeft:8}}>
                    {item.rows.map((row,ri)=>{
                      const fd=getFieldDef(row.field);
                      const ops=getOps(row.field);
                      const rowLast = ri === item.rows.length - 1;
                      return (
                        <div key={row.id}>
                          <div style={{display:'flex',gap:8,alignItems:'center'}}>
                            <select className="select" style={{flex:'0 0 190px'}} value={row.field}
                              onChange={e=>{
                                const nf=e.target.value;
                                const nops=getOps(nf);
                                updateGroupDfRow(item.id,row.id,{field:nf,op:nops[0]||'==',value:''});
                                setDfProtoSub(s=>{const n={...s};delete n[row.id];return n;});
                              }}>
                              {dfFields.map(g=>(
                                <optgroup key={g.group} label={g.group}>
                                  {g.fields.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
                                </optgroup>
                              ))}
                            </select>
                            {ops.length>0&&(
                              <select className="select" style={{flex:'0 0 110px'}} value={row.op}
                                onChange={e=>updateGroupDfRow(item.id,row.id,{op:e.target.value})}>
                                {ops.map(o=><option key={o} value={o}>{o}</option>)}
                              </select>
                            )}
                            {fd&&fd.type!=='proto'&&fd.type!=='bool'?(
                              <input className="input" style={{flex:1}} placeholder={t('wireshark.display.value_placeholder', 'value')} value={row.value}
                                onChange={e=>updateGroupDfRow(item.id,row.id,{value:e.target.value})}/>
                            ):(
                              <span style={{flex:1,color:'var(--muted)',fontSize:12}}>{t('wireshark.display.presence')}</span>
                            )}
                            {item.rows.length>1&&(
                              <button className="btn btn-ghost btn-sm" style={{color:'var(--muted)'}} onClick={()=>removeGroupDfRow(item.id,row.id)}>×</button>
                            )}
                          </div>
                          {fd && fd.sub && protoSubDefs[fd.sub] && (
                            <div style={{marginLeft:16,marginTop:6,padding:10,background:'var(--bg)',border:'1px solid var(--border)',borderRadius:6}}>
                              <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>{t('wireshark.display.subfields_hint', { label: fd.label })}</div>
                              <div style={{display:'flex',flexWrap:'wrap',gap:10}}>
                                {protoSubDefs[fd.sub].map(sd=>{
                                  const val = (dfProtoSub[row.id] && dfProtoSub[row.id][sd.key]) || '';
                                  const setVal=v=>setDfProtoSub(s=>({...s,[row.id]:{...s[row.id],[sd.key]:v}}));
                                  return (
                                    <div key={sd.key} style={{display:'flex',flexDirection:'column',gap:4}}>
                                      <label className="label" style={{fontSize:11}}>{sd.label}</label>
                                      {sd.type==='select'?(
                                        <select className="select" style={{minWidth:120}} value={val} onChange={e=>setVal(e.target.value)}>
                                          {sd.opts.map(o=><option key={o} value={o}>{o||t('wireshark.display.any')}</option>)}
                                        </select>
                                      ):(
                                        <input className="input" style={{minWidth:130}} placeholder={t('wireshark.display.optional_placeholder', 'optional')} value={val} onChange={e=>setVal(e.target.value)}/>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                          {!rowLast&&(
                            <div style={{display:'flex',gap:6,marginTop:6,marginLeft:8}}>
                              {['and','or'].map(c=>(
                                <button key={c} onClick={()=>updateGroupDfRow(item.id,row.id,{connector:c})}
                                  className={`btn btn-sm ${row.connector===c?'btn-primary':'btn-ghost'}`}
                                  style={{padding:'2px 14px',fontSize:11}}>{c.toUpperCase()}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button className="btn btn-ghost btn-sm" style={{alignSelf:'flex-start'}} onClick={()=>addGroupDfRow(item.id)}>{t('wireshark.display.add_condition')}</button>
                  </div>
                  {!isLast&&(
                    <div style={{display:'flex',gap:6,marginTop:8,marginLeft:8}}>
                      {['and','or'].map(c=>(
                        <button key={c} onClick={()=>updateDfItem(item.id,{connector:c})}
                          className={`btn btn-sm ${item.connector===c?'btn-primary':'btn-ghost'}`}
                          style={{padding:'2px 14px',fontSize:11}}>{c.toUpperCase()}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:16,marginTop:10}}>
            <button className="btn btn-ghost btn-sm" onClick={addDfCondition}>{t('wireshark.display.add_condition')}</button>
            <button className="btn btn-ghost btn-sm" onClick={addDfGroup}>{t('wireshark.display.add_group')}</button>
          </div>
          <div style={{marginTop:16}}>
            <div className="label" style={{marginBottom:8}}>{t('wireshark.display.modifiers')}</div>
            <div style={{display:'flex',flexWrap:'wrap',gap:16}}>
              {[
                {k:'synOnly',l:t('wireshark.display.mod_syn')},
                {k:'errorsOnly',l:t('wireshark.display.mod_err')},
                {k:'noNoise',l:t('wireshark.display.mod_noise')},
                {k:'negate',l:t('wireshark.display.mod_negate')}
              ].map(m=>(
                <label key={m.k} style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}>
                  <input type="checkbox" checked={dfMods[m.k]} onChange={e=>setDfMods(d=>({...d,[m.k]:e.target.checked}))}/>
                  {m.l}
                </label>
              ))}
            </div>
          </div>
          <div style={{marginTop:20,padding:16,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:8}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
              <div className="label">{t('wireshark.display.generated')}</div>
              <div style={{display:'flex',alignItems:'center',gap:6}}>
                <button className="btn btn-ghost btn-sm" style={{fontSize:11}} title={t('wireshark.decode_tcp_flags_hint')}
                  onClick={()=>window.dispatchEvent(new CustomEvent('app:navigate',{detail:{tool:'tcp-flags'}}))}>
                  {t('wireshark.decode_tcp_flags')}
                </button>
                <CopyBtn text={displayFilterStr} label={t('wireshark.display.copy_string')} id="df" />
              </div>
            </div>
            <div style={{fontFamily:'var(--mono)',color:'var(--cyan)',fontSize:14,wordBreak:'break-all',background:'var(--bg)',padding:12,borderRadius:6,border:'1px solid var(--border)'}}>
              {displayFilterStr}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'capture' && (
        <div className="card fadein">
          <div className="card-title">{t('wireshark.capture.title')}</div>
          <div style={{fontSize:12,color:'var(--muted)',marginBottom:16}}>{t('wireshark.capture.hint')}</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {bpfItems.map((item,idx)=>{
              const isLast = idx === bpfItems.length - 1;
              if (item.type === 'condition') {
                const fd = getBpfDef(item.field);
                return (
                  <div key={item.id}>
                    <div style={{display:'flex',gap:8,alignItems:'center'}}>
                      <select className="select" style={{flex:'0 0 190px'}} value={item.field}
                        onChange={e=>updateBpfItem(item.id,{field:e.target.value,value:''})}>
                        {bpfFields.map(g=>(
                          <optgroup key={g.group} label={g.group}>
                            {g.fields.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
                          </optgroup>
                        ))}
                      </select>
                      {fd && fd.hasVal ? (
                        <input className="input" style={{flex:1}} placeholder={fd.ex||t('wireshark.capture.value_placeholder', 'value')} value={item.value}
                          onChange={e=>updateBpfItem(item.id,{value:e.target.value})}/>
                      ):(
                        <span style={{flex:1,color:'var(--muted)',fontSize:12}}>{t('wireshark.display.presence')}</span>
                      )}
                      {bpfItems.length>1&&(
                        <button className="btn btn-ghost btn-sm" style={{color:'var(--muted)'}} onClick={()=>removeBpfItem(item.id)}>×</button>
                      )}
                    </div>
                    {!isLast&&(
                      <div style={{display:'flex',gap:6,marginTop:6,marginLeft:8}}>
                        {['and','or'].map(c=>(
                          <button key={c} onClick={()=>updateBpfItem(item.id,{connector:c})}
                            className={`btn btn-sm ${item.connector===c?'btn-primary':'btn-ghost'}`}
                            style={{padding:'2px 14px',fontSize:11}}>{c.toUpperCase()}</button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              // group item
              return (
                <div key={item.id} style={{borderLeft:'3px solid var(--accent)',background:'var(--panel)',padding:12,borderRadius:6}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
                    <span style={{fontSize:12,fontWeight:600,color:'var(--accent)',textTransform:'uppercase',letterSpacing:1}}>{t('wireshark.capture.group_label')}</span>
                    <label style={{display:'flex',alignItems:'center',gap:4,fontSize:12,cursor:'pointer',color:'var(--muted)'}}>
                      <input type="checkbox" checked={item.negate} onChange={e=>updateBpfItem(item.id,{negate:e.target.checked})}/>
                      {t('wireshark.capture.negate_group')}
                    </label>
                    <div style={{flex:1}}/>
                    {bpfItems.length>1&&(
                      <button className="btn btn-ghost btn-sm" style={{color:'var(--muted)'}} onClick={()=>removeBpfItem(item.id)}>×</button>
                    )}
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:8,paddingLeft:8}}>
                    {item.rows.map((row,ri)=>{
                      const fd = getBpfDef(row.field);
                      const rowLast = ri === item.rows.length - 1;
                      return (
                        <div key={row.id}>
                          <div style={{display:'flex',gap:8,alignItems:'center'}}>
                            <select className="select" style={{flex:'0 0 190px'}} value={row.field}
                              onChange={e=>updateGroupRow(item.id,row.id,{field:e.target.value,value:''})}>
                              {bpfFields.map(g=>(
                                <optgroup key={g.group} label={g.group}>
                                  {g.fields.map(f=><option key={f.value} value={f.value}>{f.label}</option>)}
                                </optgroup>
                              ))}
                            </select>
                            {fd && fd.hasVal ? (
                              <input className="input" style={{flex:1}} placeholder={fd.ex||t('wireshark.capture.value_placeholder', 'value')} value={row.value}
                                onChange={e=>updateGroupRow(item.id,row.id,{value:e.target.value})}/>
                            ):(
                              <span style={{flex:1,color:'var(--muted)',fontSize:12}}>{t('wireshark.display.presence')}</span>
                            )}
                            {item.rows.length>1&&(
                              <button className="btn btn-ghost btn-sm" style={{color:'var(--muted)'}} onClick={()=>removeGroupRow(item.id,row.id)}>×</button>
                            )}
                          </div>
                          {!rowLast&&(
                            <div style={{display:'flex',gap:6,marginTop:6,marginLeft:8}}>
                              {['and','or'].map(c=>(
                                <button key={c} onClick={()=>updateGroupRow(item.id,row.id,{connector:c})}
                                  className={`btn btn-sm ${row.connector===c?'btn-primary':'btn-ghost'}`}
                                  style={{padding:'2px 14px',fontSize:11}}>{c.toUpperCase()}</button>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                    <button className="btn btn-ghost btn-sm" style={{alignSelf:'flex-start'}} onClick={()=>addGroupRow(item.id)}>{t('wireshark.capture.add_row')}</button>
                  </div>
                  {!isLast&&(
                    <div style={{display:'flex',gap:6,marginTop:8,marginLeft:8}}>
                      {['and','or'].map(c=>(
                        <button key={c} onClick={()=>updateBpfItem(item.id,{connector:c})}
                          className={`btn btn-sm ${item.connector===c?'btn-primary':'btn-ghost'}`}
                          style={{padding:'2px 14px',fontSize:11}}>{c.toUpperCase()}</button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{display:'flex',alignItems:'center',gap:16,marginTop:10}}>
            <button className="btn btn-ghost btn-sm" onClick={addBpfCondition}>{t('wireshark.capture.add_condition')}</button>
            <button className="btn btn-ghost btn-sm" onClick={addBpfGroup}>{t('wireshark.capture.add_group')}</button>
            <label style={{display:'flex',alignItems:'center',gap:8,fontSize:13,cursor:'pointer'}}>
              <input type="checkbox" checked={bpfNegate} onChange={e=>setBpfNegate(e.target.checked)}/>
              {t('wireshark.capture.negate')}
            </label>
          </div>
          <div style={{marginTop:20,padding:16,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:8}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
              <div className="label">{t('wireshark.capture.generated')}</div>
              <CopyBtn text={bpfFilterStr} label={t('wireshark.display.copy_string')} id="bpf" />
            </div>
            <div style={{fontFamily:'var(--mono)',color:'var(--green)',fontSize:14,wordBreak:'break-all',background:'var(--bg)',padding:12,borderRadius:6,border:'1px solid var(--border)'}}>
              {bpfFilterStr}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'library' && (
        <div className="fadein">
          {commonFilters.map((g, gi) => (
            <div key={g.cat} className="card">
              <div className="card-title">{t('wireshark.library.title', { cat: g.cat })}</div>
              <div className="table-wrap hide-mobile">
                <table>
                  <thead><tr><th>{t('wireshark.library.expression')}</th><th>{t('wireshark.library.description')}</th><th style={{width:80}}>{t('wireshark.library.action')}</th></tr></thead>
                  <tbody>
                    {g.filters.map((f, fi) => (
                      <tr key={f.f}>
                        <td style={{color:'var(--cyan)', fontFamily:'var(--mono)'}}>{f.f}</td>
                        <td style={{color:'var(--muted)'}}>{f.d}</td>
                        <td><CopyBtn text={f.f} id={f.f} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Mobile View */}
              <div className="show-mobile mobile-cards">
                {g.filters.map((f, fi) => (
                  <div key={f.f} className="mobile-card">
                    <div className="mobile-card-row" style={{borderBottom:'none', paddingBottom:0}}>
                      <span className="mobile-card-value" style={{color:'var(--cyan)', textAlign:'left', paddingLeft:0, fontFamily:'var(--mono)', fontSize:11, wordBreak:'break-all'}}>{f.f}</span>
                    </div>
                    <div className="mobile-card-row" style={{borderBottom:'none'}}>
                      <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{f.d}</span>
                    </div>
                    <div style={{marginTop:8, display:'flex', justifyContent:'flex-end'}}>
                      <CopyBtn text={f.f} label={t('wireshark.library.copy_filter')} id={`mob-${f.f}`} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'tshark' && (
        <div className="fadein">
          <div style={{display:'flex',gap:8,marginBottom:20}}>
            {[
              {id:'builder',label:t('wireshark.tshark.tabs.builder')},
              {id:'reference',label:t('wireshark.tshark.tabs.reference')}
            ].map(t_tab=>(
              <button key={t_tab.id} className={'btn btn-sm ' + (tsharkSubTab===t_tab.id?'btn-primary':'btn-ghost')} onClick={()=>setTsharkSubTab(t_tab.id)}>{t_tab.label}</button>
            ))}
          </div>

          {tsharkSubTab === 'reference' && (
            <div className="fadein">
              {tsharkCmds.map((g, gi) => (
                <div key={g.cat} className="card">
                  <div className="card-title">{t(`wireshark.library.${gi}.cat`)}</div>
                  <div style={{display:'flex',flexDirection:'column',gap:10}}>
                    {g.cmds.map((c, ci) => (
                      <div key={c.c} style={{background:'var(--panel)',padding:12,borderRadius:6,border:'1px solid var(--border)'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8}}>
                          <div style={{fontFamily:'var(--mono)',color:'var(--green)',fontSize:12,wordBreak:'break-all',flex:1}}>{c.c}</div>
                          <CopyBtn text={c.c} id={c.c} />
                        </div>
                        <div style={{fontSize:11,color:'var(--muted)',marginTop:4}}>{c.d}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tsharkSubTab === 'builder' && (
            <div className="card fadein">
              <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {t('wireshark.tshark.builder.title')}
                {tsharkAvail === null && (
                  <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal' }}>
                    {t('wireshark.tshark.run.cap_checking')}
                  </span>
                )}
                {tsharkAvail === false && (
                  <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
                    {t('wireshark.tshark.run.cap_unavailable')}
                  </span>
                )}
              </div>
              <div className="grid-mobile-1" style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
                <div>
                  <div className="field">
                    <label className="label">{t('wireshark.tshark.builder.mode')}</label>
                    <select className="select" value={ts.mode} onChange={e=>setTs(s=>({...s,mode:e.target.value}))}>
                      <option value="live">{t('wireshark.tshark.builder.mode_live')}</option>
                      <option value="read">{t('wireshark.tshark.builder.mode_read')}</option>
                    </select>
                  </div>
                  {ts.mode==='live'?(
                    <div className="field">
                      <label className="label">{t('wireshark.tshark.builder.iface')}</label>
                      <input className="input" placeholder={t('wireshark.tshark.builder.iface_placeholder')} value={ts.iface} onChange={e=>setTs(s=>({...s,iface:e.target.value}))}/>
                    </div>
                  ):(
                    <div className="field">
                      <label className="label">{t('wireshark.tshark.builder.input_file')}</label>
                      <input className="input" placeholder={t('wireshark.tshark.builder.input_placeholder')} value={ts.readFile} onChange={e=>setTs(s=>({...s,readFile:e.target.value}))}/>
                    </div>
                  )}
                  {ts.mode==='live'&&(
                    <div className="field">
                      <label className="label">{t('wireshark.tshark.builder.write_file')}</label>
                      <input className="input" placeholder={t('wireshark.tshark.builder.write_placeholder')} value={ts.writeFile} onChange={e=>setTs(s=>({...s,writeFile:e.target.value}))}/>
                    </div>
                  )}
                  <div className="field">
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                      <label className="label">{t('wireshark.tshark.builder.cap_filter')}</label>
                      {bpfFilterStr!=='...'&&(
                        <button className="btn btn-ghost btn-sm" style={{fontSize:11,marginBottom:4}}
                          onClick={()=>setTs(s=>({...s,captureFilter:bpfFilterStr}))}>
                          {t('wireshark.tshark.builder.use_built')}
                        </button>
                      )}
                    </div>
                    <input className="input" placeholder={t('wireshark.tshark.builder.cap_filter_placeholder', 'e.g. port 443')} value={ts.captureFilter} onChange={e=>setTs(s=>({...s,captureFilter:e.target.value}))}/>
                  </div>
                  <div className="field">
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                      <label className="label">{t('wireshark.tshark.builder.disp_filter')}</label>
                      <div style={{display:'flex',gap:6}}>
                        <button className="btn btn-ghost btn-sm" style={{fontSize:11,marginBottom:4}} title={t('wireshark.decode_tcp_flags_hint')}
                          onClick={()=>window.dispatchEvent(new CustomEvent('app:navigate',{detail:{tool:'tcp-flags'}}))}>
                          {t('wireshark.decode_tcp_flags')}
                        </button>
                        {displayFilterStr!=='...'&&(
                          <button className="btn btn-ghost btn-sm" style={{fontSize:11,marginBottom:4}}
                            onClick={()=>setTs(s=>({...s,displayFilter:displayFilterStr}))}>
                            {t('wireshark.tshark.builder.use_built')}
                          </button>
                        )}
                      </div>
                    </div>
                    <input className="input" placeholder={t('wireshark.tshark.builder.disp_filter_placeholder', 'e.g. http.response.code >= 400')} value={ts.displayFilter} onChange={e=>setTs(s=>({...s,displayFilter:e.target.value}))}/>
                  </div>
                </div>
                <div>
                  <div className="field">
                    <label className="label">{t('wireshark.tshark.builder.stop_count')}</label>
                    <input className="input" placeholder={t('wireshark.tshark.builder.stop_count_placeholder', 'e.g. 1000')} value={ts.count} onChange={e=>setTs(s=>({...s,count:e.target.value}))}/>
                  </div>
                  <div className="field">
                    <label className="label">{t('wireshark.tshark.builder.stop_duration')}</label>
                    <input className="input" placeholder={t('wireshark.tshark.builder.stop_duration_placeholder', 'e.g. 60')} value={ts.duration} onChange={e=>setTs(s=>({...s,duration:e.target.value}))}/>
                  </div>
                  <div className="field">
                    <label className="label">{t('wireshark.tshark.builder.output_fmt')}</label>
                    <select className="select" value={ts.outputFmt} onChange={e=>setTs(s=>({...s,outputFmt:e.target.value}))}>
                      <option value="default">{t('wireshark.tshark.builder.formats.default')}</option>
                      <option value="fields">{t('wireshark.tshark.builder.formats.fields')}</option>
                      <option value="json">{t('wireshark.tshark.builder.formats.json')}</option>
                      <option value="pdml">{t('wireshark.tshark.builder.formats.pdml')}</option>
                    </select>
                  </div>
                  {(ts.outputFmt==='json'||ts.outputFmt==='pdml')&&(
                    <p style={{color:'var(--color-warning,#c4a000)',fontSize:'0.82rem',marginTop:'0.25rem'}}>
                      {t('wireshark.tshark.builder.fmt_volume_warning','JSON/PDML output is very high-volume and will be reset to default when live capture starts.')}
                    </p>
                  )}
                  {ts.outputFmt==='fields'&&(
                    <div className="field">
                      <label className="label">{t('wireshark.tshark.builder.output_fields')}</label>
                      <input className="input" placeholder={t('wireshark.tshark.builder.output_fields_placeholder', 'e.g. ip.src,ip.dst,tcp.port')} value={ts.fields} onChange={e=>setTs(s=>({...s,fields:e.target.value}))}/>
                    </div>
                  )}
                  <div className="field">
                    <label className="label">{t('wireshark.tshark.builder.stats')}</label>
                    <select className="select" value={ts.stats} onChange={e=>setTs(s=>({...s,stats:e.target.value}))}>
                      <option value="">{t('wireshark.tshark.builder.stats_opts.none')}</option>
                      <option value="io,phs">{t('wireshark.tshark.builder.stats_opts.phs')}</option>
                      <option value="expert">{t('wireshark.tshark.builder.stats_opts.expert')}</option>
                      <option value="conv,tcp">{t('wireshark.tshark.builder.stats_opts.conv_tcp')}</option>
                      <option value="conv,ip">{t('wireshark.tshark.builder.stats_opts.conv_ip')}</option>
                      <option value="http,tree">{t('wireshark.tshark.builder.stats_opts.http')}</option>
                      <option value="dns,tree">{t('wireshark.tshark.builder.stats_opts.dns')}</option>
                    </select>
                  </div>
                </div>
              </div>
              {(()=>{
                const parts=['tshark'];
                if(ts.mode==='live'){
                  parts.push(`-i ${ts.iface||'eth0'}`);
                  if(ts.captureFilter) parts.push(`-f "${ts.captureFilter}"`);
                  if(ts.writeFile)     parts.push(`-w ${ts.writeFile}`);
                  if(ts.count)         parts.push(`-c ${ts.count}`);
                  if(ts.duration)      parts.push(`-a duration:${ts.duration}`);
                } else {
                  parts.push(`-r ${ts.readFile||'capture.pcap'}`);
                }
                if(ts.displayFilter)         parts.push(`-Y "${ts.displayFilter}"`);
                if(ts.outputFmt!=='default') parts.push(`-T ${ts.outputFmt}`);
                if(ts.outputFmt==='fields'&&ts.fields) ts.fields.split(',').map(f=>f.trim()).filter(Boolean).forEach(f=>parts.push(`-e ${f}`));
                if(ts.stats) parts.push(`-z ${ts.stats}`);
                const cmd=parts.join(' ');
                return (
                  <div style={{marginTop:20,padding:16,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:8}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:10}}>
                      <div className="label">{t('wireshark.tshark.builder.generated')}</div>
                      <CopyBtn text={cmd} id="ts" />
                    </div>
                    <div style={{fontFamily:'var(--mono)',color:'var(--green)',fontSize:13,wordBreak:'break-all',background:'var(--bg)',padding:12,borderRadius:6,border:'1px solid var(--border)'}}>
                      {cmd}
                    </div>
                  </div>
                );
              })()}

              {ts.mode === 'live' && (
                <div style={{marginTop:16}}>
                  {tsharkAvail === true && (
                    <div style={{display:'flex',gap:8,marginTop:4}}>
                      <button className="btn btn-primary" onClick={startTshark} disabled={tsScanning}>
                        {tsScanning ? t('wireshark.tshark.run.running') : t('wireshark.tshark.run.run')}
                      </button>
                      {tsScanning && (
                        <button className="btn btn-ghost" onClick={stopTshark}>{t('wireshark.tshark.run.stop')}</button>
                      )}
                    </div>
                  )}

                  {(tsLines.length > 0 || tsScanning) && (
                    <div style={{marginTop:12}}>
                      <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,flexWrap:'wrap'}}>
                        <div style={{flex:1}} />
                        {tsWrittenFile && (
                          <a href={`/api/tshark-download?file=${encodeURIComponent(tsWrittenFile)}`}
                            download={tsWrittenFile}
                            className="btn btn-ghost btn-sm"
                            style={{color:'var(--cyan)',textDecoration:'none'}}>
                            {t('wireshark.tshark.run.download_pcap')}
                          </a>
                        )}
                        <CopyBtn text={tsLines.join('\n')} id="ts-out" />
                        <button className="btn btn-ghost btn-sm" onClick={() => setTsFullscreen(true)}>
                          {t('wireshark.tshark.run.fullscreen')}
                        </button>
                      </div>
                      <div ref={tsTermRef} style={{
                        background:'#1a1f2e', border:'1px solid var(--border)', borderRadius:'var(--radius)',
                        padding:'12px 14px', maxHeight:420, overflowY:'auto', overflowX:'auto',
                        fontFamily:'var(--mono)', fontSize:12, lineHeight:1.6,
                      }}>
                        {tsLines.map((line, i) => (
                          <div key={i} style={{whiteSpace:'pre'}} dangerouslySetInnerHTML={{__html: ansiToHtml(line)}} />
                        ))}
                        {tsExitCode !== null && (
                          <div style={{marginTop:8,color:tsExitCode===0?'#3fb950':'#f85149',fontStyle:'italic'}}>
                            {t('scanner.scan_complete').replace('{code}', tsExitCode)}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'tcpdump' && (
        <div className="card fadein">
          <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t('wireshark.tcpdump.title')}
            {tcpdumpAvail === null && (
              <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal' }}>
                {t('wireshark.tcpdump.cap_checking')}
              </span>
            )}
            {tcpdumpAvail === false && (
              <span style={{ fontSize: 11, color: 'var(--dim)', fontWeight: 'normal', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 4, padding: '2px 8px' }}>
                {t('wireshark.tcpdump.cap_unavailable')}
              </span>
            )}
          </div>
          <p style={{ fontSize: 12, color: 'var(--dim)', margin: '0 0 16px' }}>
            {t('wireshark.tcpdump.subtitle')}
          </p>

          <div className="field">
            <label className="label">{t('wireshark.tcpdump.mode_label')}</label>
            <select className="select" value={td.mode} onChange={e => setTd(s => ({ ...s, mode: e.target.value }))} disabled={tdScanning}>
              <option value="live">{t('wireshark.tcpdump.mode_live')}</option>
              <option value="read">{t('wireshark.tcpdump.mode_read')}</option>
            </select>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginBottom: 16 }}>
            {td.mode === 'live' ? (
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('wireshark.tcpdump.iface_label')}</label>
                <input className="input" value={td.iface} placeholder={t('wireshark.tcpdump.iface_placeholder')}
                  onChange={e => setTd(s => ({ ...s, iface: e.target.value }))} disabled={tdScanning} />
              </div>
            ) : (
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('wireshark.tcpdump.read_label')}</label>
                <input className="input" value={td.readFile} placeholder={t('wireshark.tcpdump.read_placeholder')}
                  onChange={e => setTd(s => ({ ...s, readFile: e.target.value }))} disabled={tdScanning} />
              </div>
            )}

            {td.mode === 'live' && (
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('wireshark.tcpdump.count_label')}</label>
                <input className="input" type="number" min="1" max="100000" value={td.count}
                  placeholder={t('wireshark.tcpdump.count_placeholder')}
                  onChange={e => setTd(s => ({ ...s, count: e.target.value }))} disabled={tdScanning} />
              </div>
            )}

            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('wireshark.tcpdump.snaplen_label')}</label>
              <input className="input" type="number" min="1" value={td.snaplen}
                placeholder={t('wireshark.tcpdump.snaplen_placeholder')}
                onChange={e => setTd(s => ({ ...s, snaplen: e.target.value }))} disabled={tdScanning} />
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('wireshark.tcpdump.nodns_label')}</label>
              <select className="select" value={td.nodns} onChange={e => setTd(s => ({ ...s, nodns: e.target.value }))} disabled={tdScanning}>
                <option value="">{t('wireshark.tcpdump.nodns_none')}</option>
                <option value="-n">{t('wireshark.tcpdump.nodns_n')}</option>
                <option value="-nn">{t('wireshark.tcpdump.nodns_nn')}</option>
              </select>
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('wireshark.tcpdump.verbosity_label')}</label>
              <select className="select" value={td.verbosity} onChange={e => setTd(s => ({ ...s, verbosity: e.target.value }))} disabled={tdScanning}>
                <option value="">{t('wireshark.tcpdump.verbosity_default')}</option>
                <option value="-v">{t('wireshark.tcpdump.verbosity_v')}</option>
                <option value="-vv">{t('wireshark.tcpdump.verbosity_vv')}</option>
                <option value="-vvv">{t('wireshark.tcpdump.verbosity_vvv')}</option>
              </select>
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('wireshark.tcpdump.output_label')}</label>
              <select className="select" value={td.output} onChange={e => setTd(s => ({ ...s, output: e.target.value }))} disabled={tdScanning}>
                <option value="">{t('wireshark.tcpdump.output_default')}</option>
                <option value="-X">{t('wireshark.tcpdump.output_X')}</option>
                <option value="-A">{t('wireshark.tcpdump.output_A')}</option>
                <option value="-q">{t('wireshark.tcpdump.output_q')}</option>
              </select>
            </div>

            <div className="field" style={{ margin: 0 }}>
              <label className="label">{t('wireshark.tcpdump.timestamp_label')}</label>
              <select className="select" value={td.timestamp} onChange={e => setTd(s => ({ ...s, timestamp: e.target.value }))} disabled={tdScanning}>
                <option value="">{t('wireshark.tcpdump.timestamp_default')}</option>
                <option value="-t">{t('wireshark.tcpdump.timestamp_t')}</option>
                <option value="-tt">{t('wireshark.tcpdump.timestamp_tt')}</option>
                <option value="-ttt">{t('wireshark.tcpdump.timestamp_ttt')}</option>
                <option value="-tttt">{t('wireshark.tcpdump.timestamp_tttt')}</option>
              </select>
            </div>

            {td.mode === 'live' && (
              <div className="field" style={{ margin: 0 }}>
                <label className="label">{t('wireshark.tcpdump.write_label')}</label>
                <input className="input" value={td.writeFile} placeholder={tdAutoFile}
                  onChange={e => setTd(s => ({ ...s, writeFile: e.target.value }))} disabled={tdScanning} />
              </div>
            )}
          </div>

          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', marginBottom: 16 }}>
            <input type="checkbox" checked={td.linkLayer} onChange={e => setTd(s => ({ ...s, linkLayer: e.target.checked }))} disabled={tdScanning} />
            {t('wireshark.tcpdump.linklayer_label')}
          </label>

          <div className="field">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <label className="label">{t('wireshark.tcpdump.filter_label')}</label>
              {bpfFilterStr !== '...' && (
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
                  onClick={() => setTd(s => ({ ...s, filter: bpfFilterStr }))}>
                  {t('wireshark.tcpdump.import_filter')}
                </button>
              )}
            </div>
            <input className="input" value={td.filter} placeholder={t('wireshark.tcpdump.filter_placeholder')}
              onChange={e => setTd(s => ({ ...s, filter: e.target.value }))} disabled={tdScanning} />
          </div>

          <div style={{ marginTop: 4, padding: 16, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div className="label">{t('wireshark.tcpdump.generated')}</div>
              <CopyBtn text={generateTcpdumpCmd()} id="tcpdump-cmd" />
            </div>
            <div style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)', fontSize: 13, wordBreak: 'break-all', background: 'var(--bg)', padding: 12, borderRadius: 6, border: '1px solid var(--border)' }}>
              {generateTcpdumpCmd()}
            </div>
          </div>

          {tcpdumpAvail === true && td.mode === 'live' && (
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <button className="btn btn-primary" onClick={startTcpdump} disabled={tdScanning}>
                {tdScanning ? t('wireshark.tcpdump.running') : t('wireshark.tcpdump.run')}
              </button>
              {tdScanning && (
                <button className="btn btn-ghost" onClick={stopTcpdump}>{t('wireshark.tcpdump.stop')}</button>
              )}
            </div>
          )}

          {(tdLines.length > 0 || tdScanning) && (
            <div style={{ marginTop: 12 }}>

              {/* ── Output toolbar ── */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
                {['table', 'raw'].map(v => (
                  <button key={v}
                    className={'btn btn-sm ' + (tdOutputView === v ? 'btn-primary' : 'btn-ghost')}
                    onClick={() => setTdOutputView(v)}>
                    {v === 'table' ? t('wireshark.tcpdump.view_table') : t('wireshark.tcpdump.view_raw')}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                {tdWrittenFile && (
                  <a
                    href={`/api/tcpdump-download?file=${encodeURIComponent(tdWrittenFile)}`}
                    download={tdWrittenFile}
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--cyan)', textDecoration: 'none' }}
                  >
                    {t('wireshark.tcpdump.download_pcap')}
                  </a>
                )}
                <CopyBtn text={tdLines.map(l => l.text).join('\n')} keyName="copy_all" />
                <button className="btn btn-ghost btn-sm" onClick={() => setTdFullscreen(true)}>
                  {t('wireshark.tcpdump.fullscreen')}
                </button>
              </div>

              {/* ── Table view ── */}
              {tdOutputView === 'table' && (
                <div style={{ position: 'relative' }}>
                  <div
                    ref={tdTableRef}
                    onScroll={() => {
                      const el = tdTableRef.current;
                      if (!el) return;
                      setTdAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
                    }}
                    style={{
                      maxHeight: 420,
                      overflowY: 'auto',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--bg)',
                    }}
                  >
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--mono)' }}>
                      <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
                        <tr>
                          {['#', 'Time', 'Source', 'Destination', 'Protocol', 'Len', 'Info'].map(h => (
                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {tdPackets.map((pkt, i) => {
                          const c = PROTO_COLORS[pkt.proto] || {};
                          const expanded = tdExpandedRows.has(i);
                          return (
                            <React.Fragment key={i}>
                              <tr
                                onClick={() => setTdExpandedRows(s => {
                                  const n = new Set(s);
                                  n.has(i) ? n.delete(i) : n.add(i);
                                  return n;
                                })}
                                style={{
                                  cursor: 'pointer',
                                  background: expanded ? (c.bg || 'rgba(255,255,255,0.04)') : (c.bg || 'transparent'),
                                  borderLeft: `3px solid ${c.accent || 'transparent'}`,
                                }}
                              >
                                <td style={{ padding: '3px 8px', color: 'var(--dim)' }}>{pkt.num}</td>
                                <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>{pkt.time}</td>
                                <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>{pkt.src}</td>
                                <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>{pkt.dst}</td>
                                <td style={{ padding: '3px 8px' }}>
                                  <span style={{ color: c.accent || 'var(--dim)', fontWeight: 600 }}>{pkt.proto}</span>
                                </td>
                                <td style={{ padding: '3px 8px', color: 'var(--dim)' }}>{pkt.length}</td>
                                <td style={{ padding: '3px 8px', color: '#e6edf3', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pkt.info}</td>
                              </tr>
                              {expanded && (
                                <tr>
                                  <td colSpan={7} style={{ padding: '4px 8px 8px 28px', background: '#1a1f2e', borderLeft: `3px solid ${c.accent || 'transparent'}` }}>
                                    <div style={{ whiteSpace: 'pre-wrap', color: '#e6edf3', fontSize: 11, wordBreak: 'break-all' }}>{pkt.raw}</div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  {!tdAtBottom && (
                    <div style={{ position: 'absolute', bottom: 10, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
                      <button className="btn btn-ghost btn-sm"
                        onClick={() => {
                          if (tdTableRef.current) tdTableRef.current.scrollTop = tdTableRef.current.scrollHeight;
                          setTdAtBottom(true);
                        }}>
                        {t('wireshark.tcpdump.scroll_to_bottom')}
                      </button>
                    </div>
                  )}
                  {tdExitCode !== null && (
                    <div style={{ marginTop: 6, fontSize: 12, color: tdExitCode === 0 ? '#3fb950' : '#f85149', fontStyle: 'italic' }}>
                      {t('scanner.scan_complete').replace('{code}', tdExitCode)}
                    </div>
                  )}
                </div>
              )}

              {/* ── Raw view ── */}
              {tdOutputView === 'raw' && (
                <div ref={tdTermRef} style={{
                  background: '#1a1f2e',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  padding: '12px 14px',
                  maxHeight: 420,
                  overflowY: 'auto',
                  overflowX: 'auto',
                  fontFamily: 'var(--mono)',
                  fontSize: 12,
                  lineHeight: 1.6,
                }}>
                  {tdLines.map((l, i) => (
                    <div key={i} style={{ color: l.type === 'err' ? 'var(--dim)' : '#e6edf3', whiteSpace: 'pre' }}>{l.text}</div>
                  ))}
                  {tdExitCode !== null && (
                    <div style={{ marginTop: 8, color: tdExitCode === 0 ? '#3fb950' : '#f85149', fontStyle: 'italic' }}>
                      {t('scanner.scan_complete').replace('{code}', tdExitCode)}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── tshark Fullscreen Modal ────────────────────────────────────────── */}
      {tsFullscreen && (
        <div style={{
          position:'fixed', inset:0, zIndex:9000,
          background:'var(--bg)', display:'flex', flexDirection:'column',
        }}>
          <div style={{
            display:'flex', alignItems:'center', gap:8, flexWrap:'wrap',
            padding:'10px 16px', borderBottom:'1px solid var(--border)',
            background:'var(--panel)', flexShrink:0,
          }}>
            <span style={{fontFamily:'var(--mono)',fontSize:13,color:'var(--cyan)',marginRight:4}}>
              tshark — {ts.iface || 'eth0'}
            </span>
            {tsharkAvail === true && (
              <button className="btn btn-primary btn-sm" onClick={startTshark} disabled={tsScanning}>
                {tsScanning ? t('wireshark.tshark.run.running') : t('wireshark.tshark.run.run')}
              </button>
            )}
            {tsScanning && (
              <button className="btn btn-ghost btn-sm" onClick={stopTshark}>{t('wireshark.tshark.run.stop')}</button>
            )}
            {tsExitCode !== null && (
              <span style={{fontSize:12,color:tsExitCode===0?'#3fb950':'#f85149',fontStyle:'italic'}}>
                {t('scanner.scan_complete').replace('{code}', tsExitCode)}
              </span>
            )}
            <div style={{flex:1}} />
            {tsWrittenFile && (
              <a href={`/api/tshark-download?file=${encodeURIComponent(tsWrittenFile)}`}
                download={tsWrittenFile}
                className="btn btn-ghost btn-sm"
                style={{color:'var(--cyan)',textDecoration:'none'}}>
                {t('wireshark.tshark.run.download_pcap')}
              </a>
            )}
            <CopyBtn text={tsLines.join('\n')} id="ts-fs-out" />
            <button className="btn btn-ghost btn-sm" onClick={() => setTsFullscreen(false)}>
              {t('wireshark.tshark.run.exit_fullscreen')}
            </button>
          </div>
          <div ref={tsFsTermRef} style={{
            flex:1, overflowY:'auto', overflowX:'auto',
            padding:'12px 16px', fontFamily:'var(--mono)', fontSize:12, lineHeight:1.6,
            background:'#1a1f2e',
          }}>
            {tsLines.map((line, i) => (
              <div key={i} style={{whiteSpace:'pre'}} dangerouslySetInnerHTML={{__html: ansiToHtml(line)}} />
            ))}
            {tsExitCode !== null && (
              <div style={{marginTop:8,color:tsExitCode===0?'#3fb950':'#f85149',fontStyle:'italic'}}>
                {t('scanner.scan_complete').replace('{code}', tsExitCode)}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── tcpdump Fullscreen Modal ───────────────────────────────────────── */}
      {tdFullscreen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9000,
          background: 'var(--bg)', display: 'flex', flexDirection: 'column',
        }}>
          {/* Modal header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
            padding: '10px 16px', borderBottom: '1px solid var(--border)',
            background: 'var(--panel)', flexShrink: 0,
          }}>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--cyan)', marginRight: 4 }}>
              tcpdump — {td.iface || 'eth0'}
            </span>
            {tcpdumpAvail === true && td.mode === 'live' && (
              <button className="btn btn-primary btn-sm" onClick={startTcpdump} disabled={tdScanning}>
                {tdScanning ? t('wireshark.tcpdump.running') : t('wireshark.tcpdump.run')}
              </button>
            )}
            {tdScanning && (
              <button className="btn btn-ghost btn-sm" onClick={stopTcpdump}>{t('wireshark.tcpdump.stop')}</button>
            )}
            {tdExitCode !== null && (
              <span style={{ fontSize: 12, color: tdExitCode === 0 ? '#3fb950' : '#f85149', fontStyle: 'italic' }}>
                {t('scanner.scan_complete').replace('{code}', tdExitCode)}
              </span>
            )}
            <div style={{ flex: 1 }} />
            {['table', 'raw'].map(v => (
              <button key={v}
                className={'btn btn-sm ' + (tdOutputView === v ? 'btn-primary' : 'btn-ghost')}
                onClick={() => setTdOutputView(v)}>
                {v === 'table' ? t('wireshark.tcpdump.view_table') : t('wireshark.tcpdump.view_raw')}
              </button>
            ))}
            {tdWrittenFile && (
              <a
                href={`/api/tcpdump-download?file=${encodeURIComponent(tdWrittenFile)}`}
                download={tdWrittenFile}
                className="btn btn-ghost btn-sm"
                style={{ color: 'var(--cyan)', textDecoration: 'none' }}
              >
                {t('wireshark.tcpdump.download_pcap')}
              </a>
            )}
            <CopyBtn text={tdLines.map(l => l.text).join('\n')} keyName="copy_all" />
            <button className="btn btn-ghost btn-sm" onClick={() => setTdFullscreen(false)}>
              {t('wireshark.tcpdump.exit_fullscreen')}
            </button>
          </div>

          {/* Modal content */}
          <div style={{ flex: 1, overflow: 'hidden', position: 'relative', display: 'flex', flexDirection: 'column' }}>

            {/* Table view */}
            {tdOutputView === 'table' && (
              <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                <div
                  ref={tdFsTableRef}
                  onScroll={() => {
                    const el = tdFsTableRef.current;
                    if (!el) return;
                    setTdAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 40);
                  }}
                  style={{ height: '100%', overflowY: 'auto', background: 'var(--bg)' }}
                >
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--mono)' }}>
                    <thead style={{ position: 'sticky', top: 0, background: 'var(--panel)', zIndex: 1 }}>
                      <tr>
                        {['#', 'Time', 'Source', 'Destination', 'Protocol', 'Len', 'Info'].map(h => (
                          <th key={h} style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tdPackets.map((pkt, i) => {
                        const c = PROTO_COLORS[pkt.proto] || {};
                        const expanded = tdExpandedRows.has(i);
                        return (
                          <React.Fragment key={i}>
                            <tr
                              onClick={() => setTdExpandedRows(s => { const n = new Set(s); n.has(i) ? n.delete(i) : n.add(i); return n; })}
                              style={{ cursor: 'pointer', background: expanded ? (c.bg || 'rgba(255,255,255,0.04)') : (c.bg || 'transparent'), borderLeft: `3px solid ${c.accent || 'transparent'}` }}
                            >
                              <td style={{ padding: '3px 8px', color: 'var(--dim)' }}>{pkt.num}</td>
                              <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>{pkt.time}</td>
                              <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>{pkt.src}</td>
                              <td style={{ padding: '3px 8px', whiteSpace: 'nowrap' }}>{pkt.dst}</td>
                              <td style={{ padding: '3px 8px' }}><span style={{ color: c.accent || 'var(--dim)', fontWeight: 600 }}>{pkt.proto}</span></td>
                              <td style={{ padding: '3px 8px', color: 'var(--dim)' }}>{pkt.length}</td>
                              <td style={{ padding: '3px 8px', color: '#e6edf3', maxWidth: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pkt.info}</td>
                            </tr>
                            {expanded && (
                              <tr>
                                <td colSpan={7} style={{ padding: '4px 8px 8px 28px', background: '#1a1f2e', borderLeft: `3px solid ${c.accent || 'transparent'}` }}>
                                  <div style={{ whiteSpace: 'pre-wrap', color: '#e6edf3', fontSize: 11, wordBreak: 'break-all' }}>{pkt.raw}</div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {!tdAtBottom && (
                  <div style={{ position: 'absolute', bottom: 12, left: '50%', transform: 'translateX(-50%)', zIndex: 2 }}>
                    <button className="btn btn-ghost btn-sm"
                      onClick={() => {
                        if (tdFsTableRef.current) tdFsTableRef.current.scrollTop = tdFsTableRef.current.scrollHeight;
                        setTdAtBottom(true);
                      }}>
                      {t('wireshark.tcpdump.scroll_to_bottom')}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Raw view */}
            {tdOutputView === 'raw' && (
              <div ref={tdFsTermRef} style={{
                flex: 1, overflowY: 'auto', overflowX: 'auto',
                padding: '12px 16px', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6,
                background: '#1a1f2e',
              }}>
                {tdLines.map((l, i) => (
                  <div key={i} style={{ color: l.type === 'err' ? 'var(--dim)' : '#e6edf3', whiteSpace: 'pre' }}>{l.text}</div>
                ))}
                {tdExitCode !== null && (
                  <div style={{ marginTop: 8, color: tdExitCode === 0 ? '#3fb950' : '#f85149', fontStyle: 'italic' }}>
                    {t('scanner.scan_complete').replace('{code}', tdExitCode)}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool: IPFM / NBM / PTP ──────────────────────────────────
window.CaptureTools = CaptureTools;
