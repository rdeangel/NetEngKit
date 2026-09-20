const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ── Payload byte builders (module-scope pure functions) ──────────────────────

function buildDnsQueryHex(domain) {
  const labels = (domain || 'example.com').split('.').filter(Boolean);
  const bytes = [0x12, 0x34, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
  for (const label of labels) {
    bytes.push(label.length);
    for (let i = 0; i < label.length; i++) bytes.push(label.charCodeAt(i) & 0xff);
  }
  bytes.push(0, 0x00, 0x01, 0x00, 0x01);
  return bytes.map(b => b.toString(16).padStart(2, '0')).join('');
}

function buildDhcpDiscoverHex() {
  const b = [];
  b.push(1, 1, 6, 0);
  b.push(0xde, 0xad, 0xbe, 0xef);
  b.push(0, 0, 0x80, 0x00);
  for (let i = 0; i < 16; i++) b.push(0);
  b.push(0xde, 0xad, 0xbe, 0xef, 0xca, 0xfe);
  for (let i = 0; i < 10; i++) b.push(0);
  for (let i = 0; i < 64; i++) b.push(0);
  for (let i = 0; i < 128; i++) b.push(0);
  b.push(0x63, 0x82, 0x53, 0x63);
  b.push(0x35, 0x01, 0x01);
  b.push(0xff);
  return b.map(x => x.toString(16).padStart(2, '0')).join('');
}

function buildTftpReadHex(filename) {
  const b = [0x00, 0x01];
  const f = filename || 'config.txt';
  for (let i = 0; i < f.length; i++) b.push(f.charCodeAt(i) & 0xff);
  b.push(0);
  for (const c of 'netascii') b.push(c.charCodeAt(0));
  b.push(0);
  return b.map(x => x.toString(16).padStart(2, '0')).join('');
}

function buildHttpGetHex(host) {
  const h = host || 'example.com';
  const text = `GET / HTTP/1.1\r\nHost: ${h}\r\nConnection: close\r\n\r\n`;
  return Array.from(text).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

function buildIcmpEchoHex(id, seq) {
  const idH = (id & 0xffff).toString(16).padStart(4, '0');
  const seqH = (seq & 0xffff).toString(16).padStart(4, '0');
  return `08000000${idH}${seqH}`;
}

// Minimal TLS 1.3 ClientHello (version negotiation only, no SNI)
// Record(58) / Handshake(54) / version / random(32) / sessionIDLen / CS(4) / compr / supported_versions ext
const TLS_CLIENT_HELLO_HEX = '160301003a0100003603030000000000000000000000000000000000000000000000000000000000000000000004130100ff01000009002b00050403040303';

// OSPF Hello (RFC 2328) – 44 bytes: v2, type=1, router 1.0.0.1, area 0, mask /24, interval 10, priority 1, dead 40
const OSPF_HELLO_HEX = '0201002c010000010000000000000000000000000000000000000000ffffff00000a0201000000280000000000000000';

// ICMPv6 Echo Request (RFC 4443) type=128, code=0, no data
function buildIcmpv6EchoHex(id, seq) {
  const idH = (id & 0xffff).toString(16).padStart(4, '0');
  const seqH = (seq & 0xffff).toString(16).padStart(4, '0');
  return `80000000${idH}${seqH}`;
}

// ICMPv6 Neighbor Solicitation (RFC 4861) type=135 – target 2001:db8::1
const ICMPV6_NS_HEX = '870000000000000020010db8000000000000000000000001';

// SSH-2.0 protocol version exchange banner
function buildSshBannerHex() {
  const banner = 'SSH-2.0-OpenSSH_9.3\r\n';
  return Array.from(banner).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

// SMTP EHLO greeting
function buildSmtpEhloHex(domain) {
  const text = `EHLO ${domain || 'mail.example.com'}\r\n`;
  return Array.from(text).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

// BGP OPEN (RFC 4271) – marker 16×0xFF, AS 65000, hold 90s, BGP ID 1.1.1.1, no opt params
const BGP_OPEN_HEX = 'ffffffffffffffffffffffffffffffff001d0104fde8005a0101010100';

// NTP client request (RFC 5905) – 48 bytes, LI=0, VN=4, Mode=3 (client)
function buildNtpRequestHex() {
  const b = new Array(48).fill(0);
  b[0] = 0x23; // LI=0, VN=4, Mode=3
  b[2] = 6;    // poll interval exponent (2^6 = 64 s)
  b[3] = 0xEC; // precision (-20 ≈ microsecond)
  return b.map(x => x.toString(16).padStart(2, '0')).join('');
}

// SNMP v1 GetRequest for sysDescr (1.3.6.1.2.1.1.1.0), community "public"
const SNMP_GET_HEX = '302902010004067075626c6963a01c020400000001020100020100300e300c06082b060102010101000500';

// Syslog RFC 3164 message
function buildSyslogHex(message) {
  const text = `<134>Jun  3 12:00:00 192.168.1.1 netengkit: ${message || 'test message'}`;
  return Array.from(text).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

// IGMP v2 Membership Report (RFC 2236) – type=0x16, group 224.0.0.1
const IGMP_MEMBERSHIP_HEX = '16000000e0000001';

// GRE tunnel header (RFC 2784) – minimal, inner proto=IPv4
const GRE_TUNNEL_HEX = '00000800';

// IPsec ESP header (RFC 4303) – SPI + sequence number only
const ESP_HEADER_HEX = '1234567800000001';

// VRRPv2 Advertisement (RFC 3768) – VRID=1, priority=100, virtual IP 192.168.1.1
const VRRP_ADVERT_HEX = '2101640100010000c0a80101';

// PIMv2 Hello (RFC 7761) – with Hold Time option 105 s
const PIM_HELLO_HEX = '20000000000100020069';

// ICMPv6 Router Advertisement (RFC 4861) – type=134, hop=64, lifetime=1800s
const ICMPV6_RA_HEX = '86000000400007080000000000000000';

// ICMPv6 Router Solicitation (RFC 4861) – type=133, reserved
const ICMPV6_RS_HEX = '8500000000000000';

// MLDv2 Membership Query (RFC 3810) – general query, QQIC=125
const MLDV2_QUERY_HEX = '820000002710000000000000000000000000000000000000027d0000';

// FTP login sequence
function buildFtpCmdHex() {
  const text = 'USER anonymous\r\nPASS guest@example.com\r\n';
  return Array.from(text).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

// Telnet IAC option negotiation (WILL ECHO, WILL SGA, DO TERMINAL-TYPE, DO NAWS)
const TELNET_IAC_HEX = 'fffb01fffb03fffd18fffd1f';

// LDAP v3 Anonymous BindRequest (RFC 4511)
const LDAP_BIND_HEX = '300c020101600702010304008000';

// SIP INVITE (RFC 3261) – minimal example call
function buildSipInviteHex() {
  const text = [
    'INVITE sip:100@192.168.1.100 SIP/2.0\r\n',
    'Via: SIP/2.0/UDP 192.168.1.10:5060;branch=z9hG4bK776\r\n',
    'Max-Forwards: 70\r\n',
    'To: <sip:100@192.168.1.100>\r\n',
    'From: <sip:200@192.168.1.10>;tag=9fxced76\r\n',
    'Call-ID: 30a21d33@192.168.1.10\r\n',
    'CSeq: 1 INVITE\r\n',
    'Content-Length: 0\r\n\r\n',
  ].join('');
  return Array.from(text).map(c => c.charCodeAt(0).toString(16).padStart(2, '0')).join('');
}

// RDP Connection Request (TPKT + X.224 CR + RDP Negotiation)
const RDP_CONNECT_HEX = '030000130ee00000000000010008000b000000';

// RIPv2 request for full routing table (RFC 2453)
const RIP_REQUEST_HEX = '010200000000000000000000000000000000000000000010';

// RADIUS Access-Request (RFC 2865) – header only, 20 bytes
const RADIUS_AUTH_HEX = '0101001400000000000000000000000000000000';

// RADIUS Accounting-Request (RFC 2866) – header only, 20 bytes
const RADIUS_ACCT_HEX = '0401001400000000000000000000000000000000';

// mDNS PTR query for _services._dns-sd._udp.local (RFC 6762)
function buildMdnsQueryHex() {
  const b = [
    0,0, 0,0, 0,1, 0,0, 0,0, 0,0,
    9,0x5f,0x73,0x65,0x72,0x76,0x69,0x63,0x65,0x73,
    7,0x5f,0x64,0x6e,0x73,0x2d,0x73,0x64,
    4,0x5f,0x75,0x64,0x70,
    5,0x6c,0x6f,0x63,0x61,0x6c,
    0, 0x00,0x0c, 0x00,0x01,
  ];
  return b.map(x => x.toString(16).padStart(2, '0')).join('');
}

// VXLAN (RFC 7348) – VNI=100, inner Ethernet broadcast frame
const VXLAN_HEX = '0800000000006400ffffffffffffdeadbeefcafe0800';

// NetFlow v9 header (RFC 3954) – 1 flow set, uptime 5 min
const NETFLOW_V9_HEX = '0009000100012c00678900000000000100000000';

// QUIC Initial packet (RFC 9000) – Long Header, version=1, DCID 8 bytes
const QUIC_INITIAL_HEX = 'c0000000010801020304050607080000000100';

// GTPv1-U G-PDU (3GPP TS 29.281) – TEID=1
const GTPU_HEX = '30ff000400000001';

// ── IPv6 parser ───────────────────────────────────────────────────────────────

function parseIPv6Chunks(addr) {
  try {
    const halves = addr.split('::');
    let groups;
    if (halves.length === 2) {
      const left  = halves[0] ? halves[0].split(':').map(g => parseInt(g, 16)) : [];
      const right = halves[1] ? halves[1].split(':').map(g => parseInt(g, 16)) : [];
      groups = [...left, ...Array(8 - left.length - right.length).fill(0), ...right];
    } else {
      groups = addr.split(':').map(g => parseInt(g, 16));
    }
    if (groups.length !== 8) return null;
    return [
      ((groups[0] << 16) | groups[1]) >>> 0,
      ((groups[2] << 16) | groups[3]) >>> 0,
      ((groups[4] << 16) | groups[5]) >>> 0,
      ((groups[6] << 16) | groups[7]) >>> 0,
    ];
  } catch { return null; }
}

// ── Component ─────────────────────────────────────────────────────────────────

function PacketHeaders({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [activeHeader, setActiveHeader] = usePersistentState('packet-headers:activeHeader', initialData?.activeHeader ?? 'ipv4');
  const [selectedField, setSelectedField] = useState(null);
  const [fieldValues, setFieldValues] = useState({});
  const [l4SendSrc, setL4SendSrc] = usePersistentState('packet-headers:l4SendSrc', '192.168.1.10');
  const [l4SendDst, setL4SendDst] = usePersistentState('packet-headers:l4SendDst', '8.8.8.8');
  const [scapyAvailable, setScapyAvailable] = useState(false);
  const [sendStatus, setSendStatus] = useState(null);
  const [detectedIPs, setDetectedIPs] = useState({});
  const [ipDraft, setIpDraft] = useState('');
  const [ipError, setIpError] = useState(false);

  // Payload state
  const [payloadMode, setPayloadMode] = usePersistentState('packet-headers:payloadMode', 'raw');
  const [payloadRaw, setPayloadRaw] = usePersistentState('packet-headers:payloadRaw', '');
  const [payloadAscii, setPayloadAscii] = usePersistentState('packet-headers:payloadAscii', '');
  const [payloadPreset, setPayloadPreset] = usePersistentState('packet-headers:payloadPreset', 'none');
  const [payloadDnsDomain, setPayloadDnsDomain] = usePersistentState('packet-headers:payloadDnsDomain', 'example.com');
  const [payloadTftpFile, setPayloadTftpFile] = usePersistentState('packet-headers:payloadTftpFile', 'config.txt');
  const [payloadHttpHost, setPayloadHttpHost] = usePersistentState('packet-headers:payloadHttpHost', 'example.com');
  const [payloadIcmpId, setPayloadIcmpId] = usePersistentState('packet-headers:payloadIcmpId', 1);
  const [payloadIcmpSeq, setPayloadIcmpSeq] = usePersistentState('packet-headers:payloadIcmpSeq', 1);
  const [payloadSmtpDomain, setPayloadSmtpDomain] = usePersistentState('packet-headers:payloadSmtpDomain', 'mail.example.com');
  const [payloadSyslogMsg, setPayloadSyslogMsg] = usePersistentState('packet-headers:payloadSyslogMsg', 'link up GigabitEthernet0/1');

  // Sync IP draft when user selects a different IP field
  useEffect(() => {
    if (selectedField?.isIP) {
      setIpDraft(IPv4.str(fieldValues[selectedField.id] || 0));
      setIpError(false);
    }
  }, [selectedField?.id]);

  // Apply-down: sidebar sub-row → switch header
  useEffect(() => {
    if (initialData?.activeHeader && initialData.activeHeader !== activeHeader) {
      setActiveHeader(initialData.activeHeader);
      setSelectedField(null);
    }
  }, [initialData]);

  // Report-up: header change → sidebar highlight follows
  useEffect(() => { onNav?.({ activeHeader }); }, [activeHeader]);

  // Detect scapy + auto-fill container IPs
  useEffect(() => {
    if (!window.LOCAL_PROXY) return;
    fetch('/api/capabilities').then(r => r.json()).then(d => {
      if (d.scapy) setScapyAvailable(true);
      if (d.localIPv4) setL4SendSrc(d.localIPv4);
      setDetectedIPs({ ipv4: d.localIPv4 || null, ipv6: d.localIPv6 || null });
    }).catch(() => {});
  }, []);

  // Share wiring
  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'packet-headers', activeHeader });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [activeHeader, onShare]);

  const headers = useMemo(() => ({
    ipv4: {
      title: <span>{t('packet_headers.ipv4_title')} (<RFCLink rfc="RFC 791" />)</span>,
      rows: [
        [
          { id: 'v4_ver', name: t('packet_headers.fields.version'), bits: 4, default: 4, color: 'var(--layer-3)', desc: t('packet_headers.desc.v4_ver') },
          { id: 'v4_ihl', name: t('packet_headers.fields.ihl'), bits: 4, default: 5, color: 'var(--layer-3)', desc: t('packet_headers.desc.v4_ihl') },
          { id: 'v4_dscp', name: t('packet_headers.fields.dscp'), bits: 6, default: 0, color: 'var(--layer-3)', desc: t('packet_headers.desc.v4_dscp') },
          { id: 'v4_ecn', name: t('packet_headers.fields.ecn'), bits: 2, default: 0, color: 'var(--layer-3)', desc: t('packet_headers.desc.v4_ecn') },
          { id: 'v4_len', name: t('packet_headers.fields.total_len'), bits: 16, default: 60, color: 'var(--layer-3)', desc: t('packet_headers.desc.v4_len') }
        ],
        [
          { id: 'v4_id', name: t('packet_headers.fields.id'), bits: 16, default: 0x4d2, color: 'var(--dim)', desc: t('packet_headers.desc.v4_id') },
          { id: 'v4_flags', name: t('packet_headers.fields.flags'), bits: 3, default: 2, color: 'var(--dim)', desc: t('packet_headers.desc.v4_flags'), isFlags: true, flags: ['Res', 'DF', 'MF'] },
          { id: 'v4_off', name: t('packet_headers.fields.frag_off'), bits: 13, default: 0, color: 'var(--dim)', desc: t('packet_headers.desc.v4_off') }
        ],
        [
          { id: 'v4_ttl', name: t('packet_headers.fields.ttl'), bits: 8, default: 64, color: 'var(--yellow)', desc: t('packet_headers.desc.v4_ttl') },
          { id: 'v4_proto', name: t('packet_headers.fields.proto'), bits: 8, default: 6, color: 'var(--green)', desc: t('packet_headers.desc.v4_proto') },
          { id: 'v4_chk', name: t('packet_headers.fields.checksum'), bits: 16, default: 0x0, color: 'var(--dim)', desc: t('packet_headers.desc.v4_chk') }
        ],
        [ { id: 'v4_src', name: t('packet_headers.fields.src_ip'), bits: 32, default: 0xc0a8010a, color: 'var(--cyan)', isIP: true, desc: t('packet_headers.desc.v4_src') } ],
        [ { id: 'v4_dst', name: t('packet_headers.fields.dst_ip'), bits: 32, default: 0x08080808, color: 'var(--cyan)', isIP: true, desc: t('packet_headers.desc.v4_dst') } ]
      ]
    },
    ipv6: {
      title: <span>{t('packet_headers.ipv6_title')} (<RFCLink rfc="RFC 8200" />)</span>,
      rows: [
        [
          { id: 'v6_ver', name: t('packet_headers.fields.version'), bits: 4, default: 6, color: 'var(--layer-3)', desc: t('packet_headers.desc.v6_ver') },
          { id: 'v6_tc', name: t('packet_headers.fields.tc'), bits: 8, default: 0, color: 'var(--layer-3)', desc: t('packet_headers.desc.v6_tc') },
          { id: 'v6_fl', name: t('packet_headers.fields.flow_label'), bits: 20, default: 0, color: 'var(--layer-3)', desc: t('packet_headers.desc.v6_fl') }
        ],
        [
          { id: 'v6_len', name: t('packet_headers.fields.payload_len'), bits: 16, default: 20, color: 'var(--layer-3)', desc: t('packet_headers.desc.v6_len') },
          { id: 'v6_next', name: t('packet_headers.fields.next_hdr'), bits: 8, default: 6, color: 'var(--green)', desc: t('packet_headers.desc.v6_next') },
          { id: 'v6_hop', name: t('packet_headers.fields.hop_limit'), bits: 8, default: 64, color: 'var(--yellow)', desc: t('packet_headers.desc.v6_hop') }
        ],
        [ { id: 'v6_src', name: t('packet_headers.fields.src_addr'), bits: 32, default: 0x20010db8, color: 'var(--cyan)', desc: t('packet_headers.desc.v6_src') } ],
        [ { id: 'v6_src_2', name: t('packet_headers.fields.src_cont'), bits: 32, default: 0x0, color: 'var(--cyan)', desc: t('packet_headers.bits_range', {start: 32, end: 63}) } ],
        [ { id: 'v6_src_3', name: t('packet_headers.fields.src_cont'), bits: 32, default: 0x0, color: 'var(--cyan)', desc: t('packet_headers.bits_range', {start: 64, end: 95}) } ],
        [ { id: 'v6_src_4', name: t('packet_headers.fields.src_cont'), bits: 32, default: 0x1, color: 'var(--cyan)', desc: t('packet_headers.bits_range', {start: 96, end: 127}) } ],
        [ { id: 'v6_dst', name: t('packet_headers.fields.dst_addr'), bits: 32, default: 0x20014860, color: 'var(--cyan)', desc: t('packet_headers.desc.v6_dst') } ],
        [ { id: 'v6_dst_2', name: t('packet_headers.fields.dst_cont'), bits: 32, default: 0x4860, color: 'var(--cyan)', desc: t('packet_headers.bits_range', {start: 32, end: 63}) } ],
        [ { id: 'v6_dst_3', name: t('packet_headers.fields.dst_cont'), bits: 32, default: 0x0, color: 'var(--cyan)', desc: t('packet_headers.bits_range', {start: 64, end: 95}) } ],
        [ { id: 'v6_dst_4', name: t('packet_headers.fields.dst_cont'), bits: 32, default: 0x8888, color: 'var(--cyan)', desc: t('packet_headers.bits_range', {start: 96, end: 127}) } ]
      ]
    },
    tcp: {
      title: <span>{t('packet_headers.tcp_title')} (<RFCLink rfc="RFC 9293" />)</span>,
      rows: [
        [
          { id: 'tcp_src', name: t('packet_headers.fields.src_port'), bits: 16, default: 443, color: 'var(--layer-4)', desc: t('packet_headers.desc.tcp_src') },
          { id: 'tcp_dst', name: t('packet_headers.fields.dst_port'), bits: 16, default: 51234, color: 'var(--layer-4)', desc: t('packet_headers.desc.tcp_dst') }
        ],
        [ { id: 'tcp_seq', name: t('packet_headers.fields.seq_num'), bits: 32, default: 0x12345678, color: 'var(--layer-4)', desc: t('packet_headers.desc.tcp_seq') } ],
        [ { id: 'tcp_ack', name: t('packet_headers.fields.ack_num'), bits: 32, default: 0, color: 'var(--layer-4)', desc: t('packet_headers.desc.tcp_ack') } ],
        [
          { id: 'tcp_off', name: t('packet_headers.fields.data_off'), bits: 4, default: 5, color: 'var(--layer-4)', desc: t('packet_headers.desc.tcp_off') },
          { id: 'tcp_res', name: t('packet_headers.fields.reserved'), bits: 4, default: 0, color: 'var(--dim)', desc: t('packet_headers.desc.tcp_res') },
          { id: 'tcp_flags', name: t('packet_headers.fields.flags'), bits: 8, default: 0x02, color: 'var(--red)', isFlags: true, flags: ['CWR','ECE','URG','ACK','PSH','RST','SYN','FIN'], desc: t('packet_headers.desc.tcp_flags') },
          { id: 'tcp_win', name: t('packet_headers.fields.win_size'), bits: 16, default: 64240, color: 'var(--yellow)', desc: t('packet_headers.desc.tcp_win') }
        ],
        [
          { id: 'tcp_chk', name: t('packet_headers.fields.checksum'), bits: 16, default: 0x0, color: 'var(--dim)', desc: t('packet_headers.desc.tcp_chk') },
          { id: 'tcp_urg', name: t('packet_headers.fields.urg_ptr'), bits: 16, default: 0, color: 'var(--dim)', desc: t('packet_headers.desc.tcp_urg') }
        ]
      ]
    },
    udp: {
      title: <span>{t('packet_headers.udp_title')} (<RFCLink rfc="RFC 768" />)</span>,
      rows: [
        [
          { id: 'udp_src', name: t('packet_headers.fields.src_port'), bits: 16, default: 53, color: 'var(--layer-4)', desc: t('packet_headers.desc.udp_src') },
          { id: 'udp_dst', name: t('packet_headers.fields.dst_port'), bits: 16, default: 53, color: 'var(--layer-4)', desc: t('packet_headers.desc.udp_dst') }
        ],
        [
          { id: 'udp_len', name: t('packet_headers.fields.length'), bits: 16, default: 8, color: 'var(--layer-4)', desc: t('packet_headers.desc.udp_len') },
          { id: 'udp_chk', name: t('packet_headers.fields.checksum'), bits: 16, default: 0x0, color: 'var(--dim)', desc: t('packet_headers.desc.udp_chk') }
        ]
      ]
    }
  }), [t]);

  // Initialize values (re-runs when detectedIPs arrives so auto-fill wins over defaults)
  useEffect(() => {
    const vals = {};
    Object.values(headers).forEach(h => {
      h.rows.forEach(row => {
        row.forEach(f => { vals[f.id] = f.default; });
      });
    });
    if (detectedIPs.ipv4) {
      const p = IPv4.parse(detectedIPs.ipv4);
      if (p !== null) vals.v4_src = p;
    }
    if (detectedIPs.ipv6) {
      const chunks = parseIPv6Chunks(detectedIPs.ipv6);
      if (chunks) {
        vals.v6_src = chunks[0]; vals.v6_src_2 = chunks[1];
        vals.v6_src_3 = chunks[2]; vals.v6_src_4 = chunks[3];
      }
    }
    setFieldValues(vals);
  }, [headers, detectedIPs]);

  const current = headers[activeHeader];
  const updateVal = (id, val) => setFieldValues(prev => ({ ...prev, [id]: val }));

  // Compute hex/binary strings for the header
  const getWireFormat = () => {
    let bits = '';
    current.rows.forEach(row => {
      row.forEach(f => {
        let v = fieldValues[f.id] || 0;
        bits += (v >>> 0).toString(2).padStart(f.bits, '0').slice(-f.bits);
      });
    });
    const hex = bits.match(/.{4}/g)?.map(b => parseInt(b,2).toString(16)).join('') || '';
    return {
      hex: hex.toUpperCase().match(/.{2}/g)?.join(' ') || '',
      bin: bits.match(/.{8}/g)?.join(' ') || bits
    };
  };

  const wire = getWireFormat();
  const scapyClass = activeHeader === 'ipv4' ? 'IP' : activeHeader === 'ipv6' ? 'IPv6' : activeHeader === 'tcp' ? 'TCP' : 'UDP';
  const isL4 = activeHeader === 'tcp' || activeHeader === 'udp';

  // ── Payload logic ──────────────────────────────────────────────────────────

  // All presets for the current tab — always shown; selecting one sets the header fields
  const availablePresets = useMemo(() => {
    if (activeHeader === 'ipv4') return ['none', 'icmp', 'igmp_membership', 'gre_tunnel', 'esp_header', 'vrrp_advert', 'pim_hello', 'ospf_hello'];
    if (activeHeader === 'ipv6') return ['none', 'icmpv6_echo', 'icmpv6_ns', 'icmpv6_ra', 'icmpv6_rs', 'mldv2_query'];
    if (activeHeader === 'tcp') return ['none', 'ssh_banner', 'ftp_cmd', 'telnet_iac', 'smtp_ehlo', 'http_get', 'ldap_bind', 'bgp_open', 'tls', 'rdp_connect', 'sip_invite'];
    if (activeHeader === 'udp') return ['none', 'dns', 'dhcp', 'tftp', 'ntp', 'snmp', 'syslog', 'rip_request', 'radius_auth', 'radius_acct', 'mdns_query', 'vxlan', 'netflow_v9', 'quic_initial', 'gtpu'];
    return ['none'];
  }, [activeHeader]);

  // Selecting a preset auto-fills the matching header field(s)
  const handlePresetSelect = useCallback((preset) => {
    setPayloadPreset(preset);
    if (preset === 'none') return;
    const u = {};
    if (preset === 'icmp')             u['v4_proto'] = 1;
    if (preset === 'igmp_membership')  u['v4_proto'] = 2;
    if (preset === 'gre_tunnel')       u['v4_proto'] = 47;
    if (preset === 'esp_header')       u['v4_proto'] = 50;
    if (preset === 'vrrp_advert')      u['v4_proto'] = 112;
    if (preset === 'pim_hello')        u['v4_proto'] = 103;
    if (preset === 'ospf_hello')       u['v4_proto'] = 89;
    if (['icmpv6_echo','icmpv6_ns','icmpv6_ra','icmpv6_rs','mldv2_query'].includes(preset)) u['v6_next'] = 58;
    if (preset === 'ssh_banner')   { u['tcp_dst'] = 22;   u['tcp_src'] = 49152; }
    if (preset === 'ftp_cmd')      { u['tcp_dst'] = 21;   u['tcp_src'] = 49152; }
    if (preset === 'telnet_iac')   { u['tcp_dst'] = 23;   u['tcp_src'] = 49152; }
    if (preset === 'smtp_ehlo')    { u['tcp_dst'] = 25;   u['tcp_src'] = 49152; }
    if (preset === 'http_get')     { u['tcp_dst'] = 80;   u['tcp_src'] = 49152; }
    if (preset === 'ldap_bind')    { u['tcp_dst'] = 389;  u['tcp_src'] = 49152; }
    if (preset === 'bgp_open')     { u['tcp_dst'] = 179;  u['tcp_src'] = 49152; }
    if (preset === 'tls')          { u['tcp_dst'] = 443;  u['tcp_src'] = 49152; }
    if (preset === 'rdp_connect')  { u['tcp_dst'] = 3389; u['tcp_src'] = 49152; }
    if (preset === 'sip_invite')   { u['tcp_dst'] = 5060; u['tcp_src'] = 49152; }
    if (preset === 'dns')          { u['udp_dst'] = 53;   u['udp_src'] = 49152; }
    if (preset === 'dhcp')         { u['udp_dst'] = 67;   u['udp_src'] = 68; }
    if (preset === 'tftp')         { u['udp_dst'] = 69;   u['udp_src'] = 49152; }
    if (preset === 'ntp')          { u['udp_dst'] = 123;  u['udp_src'] = 49152; }
    if (preset === 'snmp')         { u['udp_dst'] = 161;  u['udp_src'] = 49152; }
    if (preset === 'syslog')       { u['udp_dst'] = 514;  u['udp_src'] = 49152; }
    if (preset === 'rip_request')  { u['udp_dst'] = 520;  u['udp_src'] = 520; }
    if (preset === 'radius_auth')  { u['udp_dst'] = 1812; u['udp_src'] = 49152; }
    if (preset === 'radius_acct')  { u['udp_dst'] = 1813; u['udp_src'] = 49152; }
    if (preset === 'mdns_query')   { u['udp_dst'] = 5353; u['udp_src'] = 5353; }
    if (preset === 'vxlan')        { u['udp_dst'] = 4789; u['udp_src'] = 49152; }
    if (preset === 'netflow_v9')   { u['udp_dst'] = 2055; u['udp_src'] = 49152; }
    if (preset === 'quic_initial') { u['udp_dst'] = 443;  u['udp_src'] = 49152; }
    if (preset === 'gtpu')         { u['udp_dst'] = 2152; u['udp_src'] = 49152; }
    if (Object.keys(u).length) setFieldValues(prev => ({ ...prev, ...u }));
  }, []);

  // Effective preset: fall back to 'none' if tab changed and preset no longer applies
  const effectivePreset = availablePresets.includes(payloadPreset) ? payloadPreset : 'none';

  // Raw hex string for the payload (no spaces)
  const payloadHex = useMemo(() => {
    if (payloadMode === 'raw') {
      const clean = payloadRaw.replace(/\s/g, '');
      if (!clean || !/^[0-9a-fA-F]+$/.test(clean)) return '';
      return clean.length % 2 === 0 ? clean : clean + '0';
    }
    if (payloadMode === 'ascii') {
      if (!payloadAscii) return '';
      return Array.from(payloadAscii).map(c => (c.charCodeAt(0) & 0xff).toString(16).padStart(2, '0')).join('');
    }
    if (payloadMode === 'preset') {
      const p = effectivePreset;
      if (p === 'none') return '';
      if (p === 'dns') return buildDnsQueryHex(payloadDnsDomain);
      if (p === 'dhcp') return buildDhcpDiscoverHex();
      if (p === 'tftp') return buildTftpReadHex(payloadTftpFile);
      if (p === 'http_get') return buildHttpGetHex(payloadHttpHost);
      if (p === 'tls') return TLS_CLIENT_HELLO_HEX;
      if (p === 'icmp') return buildIcmpEchoHex(payloadIcmpId, payloadIcmpSeq);
      if (p === 'ospf_hello')       return OSPF_HELLO_HEX;
      if (p === 'icmpv6_echo')      return buildIcmpv6EchoHex(payloadIcmpId, payloadIcmpSeq);
      if (p === 'icmpv6_ns')        return ICMPV6_NS_HEX;
      if (p === 'ssh_banner')       return buildSshBannerHex();
      if (p === 'smtp_ehlo')        return buildSmtpEhloHex(payloadSmtpDomain);
      if (p === 'bgp_open')         return BGP_OPEN_HEX;
      if (p === 'ntp')              return buildNtpRequestHex();
      if (p === 'snmp')             return SNMP_GET_HEX;
      if (p === 'syslog')           return buildSyslogHex(payloadSyslogMsg);
      if (p === 'igmp_membership')  return IGMP_MEMBERSHIP_HEX;
      if (p === 'gre_tunnel')       return GRE_TUNNEL_HEX;
      if (p === 'esp_header')       return ESP_HEADER_HEX;
      if (p === 'vrrp_advert')      return VRRP_ADVERT_HEX;
      if (p === 'pim_hello')        return PIM_HELLO_HEX;
      if (p === 'icmpv6_ra')        return ICMPV6_RA_HEX;
      if (p === 'icmpv6_rs')        return ICMPV6_RS_HEX;
      if (p === 'mldv2_query')      return MLDV2_QUERY_HEX;
      if (p === 'ftp_cmd')          return buildFtpCmdHex();
      if (p === 'telnet_iac')       return TELNET_IAC_HEX;
      if (p === 'ldap_bind')        return LDAP_BIND_HEX;
      if (p === 'sip_invite')       return buildSipInviteHex();
      if (p === 'rdp_connect')      return RDP_CONNECT_HEX;
      if (p === 'rip_request')      return RIP_REQUEST_HEX;
      if (p === 'radius_auth')      return RADIUS_AUTH_HEX;
      if (p === 'radius_acct')      return RADIUS_ACCT_HEX;
      if (p === 'mdns_query')       return buildMdnsQueryHex();
      if (p === 'vxlan')            return VXLAN_HEX;
      if (p === 'netflow_v9')       return NETFLOW_V9_HEX;
      if (p === 'quic_initial')     return QUIC_INITIAL_HEX;
      if (p === 'gtpu')             return GTPU_HEX;
    }
    return '';
  }, [payloadMode, payloadRaw, payloadAscii, effectivePreset, payloadDnsDomain, payloadTftpFile, payloadHttpHost, payloadIcmpId, payloadIcmpSeq, payloadSmtpDomain, payloadSyslogMsg]);

  // Scapy layer string for the payload
  const scapyPayloadLayer = useMemo(() => {
    if (payloadMode === 'raw') {
      if (!payloadHex) return null;
      return `Raw(bytes.fromhex("${payloadHex}"))`;
    }
    if (payloadMode === 'ascii') {
      if (!payloadHex) return null;
      const escaped = payloadAscii.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r/g, '\\r').replace(/\n/g, '\\n');
      return `Raw(b"${escaped}")`;
    }
    if (payloadMode === 'preset') {
      const p = effectivePreset;
      if (p === 'none') return null;
      if (p === 'dns') return `DNS(rd=1, qd=DNSQR(qname="${payloadDnsDomain || 'example.com'}"))`;
      if (p === 'dhcp') return `BOOTP() / DHCP(options=[("message-type","discover"),"end"])`;
      if (p === 'tftp') return `Raw(bytes.fromhex("${buildTftpReadHex(payloadTftpFile)}"))`;
      if (p === 'http_get') {
        const h = payloadHttpHost || 'example.com';
        return `Raw(b"GET / HTTP/1.1\\r\\nHost: ${h}\\r\\nConnection: close\\r\\n\\r\\n")`;
      }
      if (p === 'tls') return `Raw(bytes.fromhex("${TLS_CLIENT_HELLO_HEX}"))`;
      if (p === 'icmp') return `ICMP(type=8, code=0, id=${payloadIcmpId}, seq=${payloadIcmpSeq})`;
      if (p === 'ospf_hello')      return `Raw(bytes.fromhex("${OSPF_HELLO_HEX}"))`;
      if (p === 'icmpv6_echo')     return `ICMPv6EchoRequest(id=${payloadIcmpId}, seq=${payloadIcmpSeq})`;
      if (p === 'icmpv6_ns')       return `ICMPv6ND_NS(tgt="2001:db8::1")`;
      if (p === 'icmpv6_ra')       return `ICMPv6ND_RA()`;
      if (p === 'icmpv6_rs')       return `ICMPv6ND_RS()`;
      if (p === 'mldv2_query')     return `ICMPv6MLQuery2()`;
      if (p === 'ssh_banner')      return `Raw(b"SSH-2.0-OpenSSH_9.3\\r\\n")`;
      if (p === 'smtp_ehlo')       return `Raw(b"EHLO ${payloadSmtpDomain || 'mail.example.com'}\\r\\n")`;
      if (p === 'ftp_cmd')         return `Raw(b"USER anonymous\\r\\nPASS guest@example.com\\r\\n")`;
      if (p === 'telnet_iac')      return `Raw(bytes.fromhex("${TELNET_IAC_HEX}"))`;
      if (p === 'ldap_bind')       return `Raw(bytes.fromhex("${LDAP_BIND_HEX}"))`;
      if (p === 'sip_invite')      return `Raw(b"INVITE sip:100@192.168.1.100 SIP/2.0\\r\\n...")`;
      if (p === 'rdp_connect')     return `Raw(bytes.fromhex("${RDP_CONNECT_HEX}"))`;
      if (p === 'bgp_open')        return `Raw(bytes.fromhex("${BGP_OPEN_HEX}"))`;
      if (p === 'tls')             return `Raw(bytes.fromhex("${TLS_CLIENT_HELLO_HEX}"))`;
      if (p === 'ntp')             return `NTP(version=4, mode=3)`;
      if (p === 'snmp')            return `Raw(bytes.fromhex("${SNMP_GET_HEX}"))`;
      if (p === 'syslog') {
        const escaped = (payloadSyslogMsg || 'test message').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        return `Raw(b"<134>Jun  3 12:00:00 192.168.1.1 netengkit: ${escaped}")`;
      }
      if (p === 'igmp_membership') return `IGMP(type=0x16, gaddr="224.0.0.1")`;
      if (p === 'gre_tunnel')      return `GRE(proto=0x0800)`;
      if (p === 'esp_header')      return `ESP(spi=0x12345678, seq=1)`;
      if (p === 'vrrp_advert')     return `VRRP(vrid=1, priority=100, addrlist=["192.168.1.1"])`;
      if (p === 'pim_hello')       return `Raw(bytes.fromhex("${PIM_HELLO_HEX}"))`;
      if (p === 'rip_request')     return `RIP(cmd=1) / RIPEntry(AF=0, metric=16)`;
      if (p === 'radius_auth')     return `Radius(code=1, id=1)`;
      if (p === 'radius_acct')     return `Radius(code=4, id=1)`;
      if (p === 'mdns_query')      return `DNS(rd=0, qd=DNSQR(qname="_services._dns-sd._udp.local", qtype="PTR"))`;
      if (p === 'vxlan')           return `VXLAN(vni=100) / Ether()`;
      if (p === 'netflow_v9')      return `Raw(bytes.fromhex("${NETFLOW_V9_HEX}"))`;
      if (p === 'quic_initial')    return `Raw(bytes.fromhex("${QUIC_INITIAL_HEX}"))`;
      if (p === 'gtpu')            return `GTPHeader(gtp_type=255, teid=1)`;
    }
    return null;
  }, [payloadMode, payloadHex, payloadAscii, effectivePreset, payloadDnsDomain, payloadTftpFile, payloadHttpHost, payloadIcmpId, payloadIcmpSeq, payloadSmtpDomain, payloadSyslogMsg]);

  // Combined wire hex (header + payload)
  const headerHexClean = wire.hex.replace(/\s/g, '');
  const fullHex = headerHexClean + payloadHex;
  const payloadHexDisplay = payloadHex.match(/.{2}/g)?.join(' ') || '';

  const handleScapySend = async () => {
    setSendStatus('sending');
    try {
      const body = { proto: activeHeader, hex: headerHexClean };
      if (payloadHex) body.payload = payloadHex;
      if (isL4) { body.src = l4SendSrc; body.dst = l4SendDst; }
      const r = await fetch('/api/scapy-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (data.ok) {
        setSendStatus({ sent: true, iface: data.iface, dstMac: data.dstMac });
        setTimeout(() => setSendStatus(null), 5000);
      } else {
        setSendStatus({ error: data.error || 'Unknown error' });
        setTimeout(() => setSendStatus(null), 5000);
      }
    } catch (e) {
      setSendStatus({ error: e.message });
      setTimeout(() => setSendStatus(null), 5000);
    }
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('packet_headers.title')}</div>
        <div className="tab-row">
          {Object.keys(headers).map(h => (
            <button key={h} className={`tab-btn ${activeHeader === h ? 'active' : ''}`}
              onClick={() => { setActiveHeader(h); setSelectedField(null); }}>
              {h.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      <div className="two-col grid-mobile-1" style={{alignItems:'stretch'}}>
        <div className="card fadein" style={{flex:2, overflowX:'auto'}}>
          <div className="card-title">{current.title} <span style={{fontSize:11,color:'var(--dim)',marginLeft:8}}>{t('packet_headers.click_to_edit')}</span></div>

          {/* Desktop: 32-bit wide grid */}
          <div className="hide-mobile" style={{display:'flex',flexDirection:'column',gap:1,border:'1px solid var(--border)',borderRadius:8,overflow:'hidden',background:'var(--border)'}}>
            <div style={{display:'flex',background:'var(--card)',fontSize:9,color:'var(--dim)',padding:'2px 4px',borderBottom:'1px solid var(--border)'}}>
              {Array.from({length:32}).map((_,i) => (
                <div key={i} style={{flex:1,textAlign:'center'}}>{i}</div>
              ))}
            </div>
            {current.rows.map((row, ri) => (
              <div key={ri} style={{display:'flex',height:48}}>
                {row.map((field, fi) => {
                  const val = fieldValues[field.id] || 0;
                  const displayVal = field.isIP ? IPv4.str(val) :
                                    field.isFlags ? `0x${val.toString(16).toUpperCase()}` :
                                    val.toString();
                  const isSelected = selectedField?.id === field.id;
                  return (
                    <div key={fi} style={{
                      flex: field.bits,
                      background: isSelected ? `${field.color}33` : 'var(--card)',
                      borderRight: fi===row.length-1?'none':'1px solid var(--border)',
                      display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',
                      padding:4,overflow:'hidden',transition:'all .15s',cursor:'pointer',
                      boxShadow: isSelected ? `inset 0 0 0 2px ${field.color}` : 'none',
                      zIndex: isSelected ? 1 : 0
                    }} onClick={() => setSelectedField(field)}>
                      <div style={{fontSize:9,fontWeight:700,color:field.color,textTransform:'uppercase',whiteSpace:'nowrap'}}>{field.name}</div>
                      <div style={{fontSize:10,color:'var(--text)',fontWeight:600,whiteSpace:'nowrap',marginTop:2}}>{displayVal}</div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Mobile: vertical field list */}
          <div className="show-mobile" style={{display:'grid', gridTemplateColumns:'1fr', gap:6}}>
             {current.rows.flat().map((field, fi) => {
                const val = fieldValues[field.id] || 0;
                const displayVal = field.isIP ? IPv4.str(val) :
                                  field.isFlags ? `0x${val.toString(16).toUpperCase()}` :
                                  val.toString();
                const isSelected = selectedField?.id === field.id;
                return (
                  <div key={fi}
                    style={{
                      borderLeft: `3px solid ${field.color}`,
                      cursor:'pointer',
                      background: isSelected ? `${field.color}11` : 'var(--panel)',
                      border: `1px solid ${isSelected ? field.color : 'var(--border)'}`,
                      borderRadius: 6,
                      padding: '6px 8px',
                      minWidth: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center'
                    }}
                    onClick={() => setSelectedField(field)}
                  >
                    <div style={{fontSize:9, color:field.color, textTransform:'uppercase', fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{field.name}</div>
                    <div style={{fontSize:10, color:'var(--text)', fontWeight:700, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis'}}>{displayVal}</div>
                  </div>
                );
             })}
          </div>

          {/* Wire format */}
          <div style={{marginTop:16}}>
            <div className="card-title" style={{fontSize:13}}>{t('packet_headers.wire_format')}</div>
            <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:6,padding:12,fontFamily:'var(--mono)',fontSize:12}}>
              <div style={{marginBottom:8, display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:8}}>
                <div style={{minWidth:0, flex:1, wordBreak:'break-all'}}>
                  <span style={{color:'var(--dim)',display:'inline-block',width:40}}>{t('packet_headers.hex')}</span>
                  <span style={{color:'var(--cyan)'}}>{wire.hex}</span>
                  {payloadHexDisplay && <span style={{color:'var(--yellow)'}}>{' '}{payloadHexDisplay}</span>}
                </div>
                <CopyBtn text={fullHex} label={t('packet_headers.copy_hex')} id="pkt-hex-copy" />
              </div>
              <div style={{minWidth:0}}>
                <span style={{color:'var(--dim)',display:'inline-block',width:40}}>{t('packet_headers.bin')}</span>
                <span style={{color:'var(--muted)',fontSize:10,wordBreak:'break-all'}}>{wire.bin}</span>
              </div>
            </div>
          </div>

          {/* Payload section */}
          <div style={{marginTop:16}}>
            <div className="card-title" style={{fontSize:13}}>{t('packet_headers.payload_section')}</div>

            {/* Mode selector */}
            <div style={{display:'flex', gap:6, marginBottom:10, flexWrap:'wrap'}}>
              {['raw', 'ascii', 'preset'].map(mode => (
                <button key={mode}
                  className={`btn btn-sm ${payloadMode === mode ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setPayloadMode(mode)}>
                  {t(`packet_headers.payload_mode_${mode}`)}
                </button>
              ))}
            </div>

            {payloadMode === 'raw' && (
              <div className="field">
                <label className="label">{t('packet_headers.payload_raw_label')}</label>
                <textarea className="input" style={{fontFamily:'var(--mono)', minHeight:60, resize:'vertical', width:'100%', boxSizing:'border-box'}}
                  value={payloadRaw}
                  placeholder={t('packet_headers.payload_raw_placeholder')}
                  onChange={e => setPayloadRaw(e.target.value.replace(/\s/g, ''))}
                />
                {payloadRaw && !/^[0-9a-fA-F]*$/.test(payloadRaw) && (
                  <div style={{fontSize:11,color:'var(--red)',marginTop:4}}>{t('packet_headers.payload_raw_err')}</div>
                )}
                <div style={{fontSize:11,color:'var(--dim)',marginTop:4}}>
                  {t('packet_headers.payload_byte_count', {n: Math.floor(payloadHex.length / 2)})}
                </div>
              </div>
            )}

            {payloadMode === 'ascii' && (
              <div className="field">
                <label className="label">{t('packet_headers.payload_ascii_label')}</label>
                <textarea className="input" style={{fontFamily:'var(--mono)', minHeight:60, resize:'vertical', width:'100%', boxSizing:'border-box'}}
                  value={payloadAscii}
                  placeholder={t('packet_headers.payload_ascii_placeholder')}
                  onChange={e => setPayloadAscii(e.target.value)}
                />
                <div style={{fontSize:11,color:'var(--dim)',marginTop:4}}>
                  {t('packet_headers.payload_byte_count', {n: payloadAscii.length})}
                </div>
              </div>
            )}

            {payloadMode === 'preset' && (
              <div>
                <div className="field">
                  <label className="label">{t('packet_headers.payload_preset_label')}</label>
                  <select className="select"
                    value={effectivePreset}
                    onChange={e => handlePresetSelect(e.target.value)}>
                    {availablePresets.map(p => (
                      <option key={p} value={p}>{t(`packet_headers.payload_preset_${p}`)}</option>
                    ))}
                  </select>
                </div>

                {effectivePreset === 'dns' && (
                  <div className="field">
                    <label className="label">{t('packet_headers.payload_dns_domain_label')}</label>
                    <input className="input" style={{fontFamily:'var(--mono)'}}
                      value={payloadDnsDomain}
                      placeholder={t('packet_headers.payload_dns_domain_placeholder')}
                      onChange={e => setPayloadDnsDomain(e.target.value)}
                    />
                  </div>
                )}

                {effectivePreset === 'tftp' && (
                  <div className="field">
                    <label className="label">{t('packet_headers.payload_tftp_filename_label')}</label>
                    <input className="input" style={{fontFamily:'var(--mono)'}}
                      value={payloadTftpFile}
                      placeholder={t('packet_headers.payload_tftp_filename_placeholder')}
                      onChange={e => setPayloadTftpFile(e.target.value)}
                    />
                  </div>
                )}

                {effectivePreset === 'http_get' && (
                  <div className="field">
                    <label className="label">{t('packet_headers.payload_http_host_label')}</label>
                    <input className="input" style={{fontFamily:'var(--mono)'}}
                      value={payloadHttpHost}
                      placeholder={t('packet_headers.payload_http_host_placeholder')}
                      onChange={e => setPayloadHttpHost(e.target.value)}
                    />
                  </div>
                )}

                {(effectivePreset === 'icmp' || effectivePreset === 'icmpv6_echo') && (
                  <div style={{display:'flex', gap:12, flexWrap:'wrap'}}>
                    <div className="field" style={{flex:1, minWidth:120}}>
                      <label className="label">{t('packet_headers.payload_icmp_id_label')}</label>
                      <input className="input" type="number" min="0" max="65535"
                        value={payloadIcmpId}
                        onChange={e => setPayloadIcmpId(Math.min(65535, Math.max(0, parseInt(e.target.value) || 0)))}
                      />
                    </div>
                    <div className="field" style={{flex:1, minWidth:120}}>
                      <label className="label">{t('packet_headers.payload_icmp_seq_label')}</label>
                      <input className="input" type="number" min="0" max="65535"
                        value={payloadIcmpSeq}
                        onChange={e => setPayloadIcmpSeq(Math.min(65535, Math.max(0, parseInt(e.target.value) || 0)))}
                      />
                    </div>
                  </div>
                )}

                {effectivePreset === 'smtp_ehlo' && (
                  <div className="field">
                    <label className="label">{t('packet_headers.payload_smtp_domain_label')}</label>
                    <input className="input" style={{fontFamily:'var(--mono)'}}
                      value={payloadSmtpDomain}
                      placeholder={t('packet_headers.payload_smtp_domain_placeholder')}
                      onChange={e => setPayloadSmtpDomain(e.target.value)}
                    />
                  </div>
                )}

                {effectivePreset === 'syslog' && (
                  <div className="field">
                    <label className="label">{t('packet_headers.payload_syslog_msg_label')}</label>
                    <input className="input" style={{fontFamily:'var(--mono)'}}
                      value={payloadSyslogMsg}
                      placeholder={t('packet_headers.payload_syslog_msg_placeholder')}
                      onChange={e => setPayloadSyslogMsg(e.target.value)}
                    />
                  </div>
                )}

                {effectivePreset !== 'none' && (
                  <div style={{fontSize:11,color:'var(--dim)',marginTop:4}}>
                    {t('packet_headers.payload_byte_count', {n: Math.floor(payloadHex.length / 2)})}
                  </div>
                )}
              </div>
            )}

            {payloadHex && (
              <div style={{marginTop:8}}>
                <CopyBtn text={payloadHex} label={t('packet_headers.payload_copy')} id="pkt-payload-copy" />
              </div>
            )}
          </div>

          {/* Scapy snippet */}
          {(() => {
            const hexStr = headerHexClean;
            const payloadSuffix = scapyPayloadLayer ? ` / ${scapyPayloadLayer}` : '';
            const sendLine = isL4
              ? `send(IP(src="${l4SendSrc}", dst="${l4SendDst}") / pkt)`
              : 'send(pkt)';
            const scapyCopyText = [
              t('packet_headers.scapy_comment'),
              'from scapy.all import *',
              `pkt = ${scapyClass}(bytes.fromhex("${hexStr}"))${payloadSuffix}`,
              'pkt.show()',
              ...(isL4 ? [`del pkt.chksum  ${t('packet_headers.scapy_chksum_comment')}`] : []),
              sendLine
            ].join('\n');
            return (
              <div style={{marginTop:16}}>
                <div className="card-title" style={{fontSize:13, display:'flex', justifyContent:'space-between'}}>
                  {t('packet_headers.scapy_snippet')}
                  <CopyBtn text={scapyCopyText} label={t('packet_headers.copy_snippet')} id="pkt-scapy-copy" />
                </div>
                {isL4 && (
                  <div style={{display:'flex', gap:12, marginBottom:8, alignItems:'center', flexWrap:'wrap'}}>
                    <span style={{fontSize:11, color:'var(--dim)', whiteSpace:'nowrap'}}>{t('packet_headers.scapy_ip_layer')}</span>
                    <div style={{display:'flex', gap:4, alignItems:'center'}}>
                      <span style={{fontSize:11, color:'var(--muted)', fontFamily:'var(--mono)'}}>{t('packet_headers.scapy_src_ip')}</span>
                      <input className="input" style={{width:130, fontSize:11, padding:'2px 6px', fontFamily:'var(--mono)'}}
                        value={l4SendSrc} onChange={e => setL4SendSrc(e.target.value)} />
                    </div>
                    <div style={{display:'flex', gap:4, alignItems:'center'}}>
                      <span style={{fontSize:11, color:'var(--muted)', fontFamily:'var(--mono)'}}>{t('packet_headers.scapy_dst_ip')}</span>
                      <input className="input" style={{width:130, fontSize:11, padding:'2px 6px', fontFamily:'var(--mono)'}}
                        value={l4SendDst} onChange={e => setL4SendDst(e.target.value)} />
                    </div>
                  </div>
                )}
                <div style={{background:'var(--panel)',border:'1px solid var(--border)',borderRadius:6,padding:'8px 12px',fontFamily:'var(--mono)',fontSize:11,color:'var(--green)', whiteSpace:'pre-wrap', wordBreak:'break-all'}}>
                  <span style={{color:'var(--muted)'}}>{t('packet_headers.scapy_comment')}</span><br/>
                  <span style={{color:'var(--purple)'}}>from</span> scapy.all <span style={{color:'var(--purple)'}}>import</span> *<br/>
                  pkt = {scapyClass}(bytes.fromhex(<span style={{color:'var(--yellow)'}}>{`"${hexStr}"`}</span>)){scapyPayloadLayer && <> / <span style={{color:'var(--cyan)'}}>{scapyPayloadLayer}</span></>}<br/>
                  pkt.show()<br/>
                  {isL4 && <><span style={{color:'var(--purple)'}}>del</span> pkt.chksum  <span style={{color:'var(--muted)'}}>{t('packet_headers.scapy_chksum_comment')}</span><br/></>}
                  {isL4
                    ? <>send(IP(src=<span style={{color:'var(--yellow)'}}>"{l4SendSrc}"</span>, dst=<span style={{color:'var(--yellow)'}}>"{l4SendDst}"</span>) / pkt)</>
                    : 'send(pkt)'}
                </div>
                {scapyAvailable && (
                  <div style={{marginTop:8, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap'}}>
                    {activeHeader === 'ipv6' && !detectedIPs.ipv6 ? (
                      <span style={{fontSize:12, color:'var(--muted)'}}>{t('packet_headers.scapy_no_v6')}</span>
                    ) : (
                      <button className="btn btn-sm"
                        style={{background:'var(--green)',color:'var(--btn-text)',border:'none',opacity: sendStatus === 'sending' ? 0.6 : 1}}
                        disabled={sendStatus === 'sending'}
                        onClick={handleScapySend}>
                        {sendStatus === 'sending' ? t('packet_headers.scapy_sending') : t('packet_headers.scapy_send_btn')}
                      </button>
                    )}
                    {sendStatus?.sent && (
                      <span style={{fontSize:12, color:'var(--green)', fontFamily:'var(--mono)'}}>
                        {t('packet_headers.scapy_sent')}
                        {sendStatus.iface && ` — ${sendStatus.iface} → ${sendStatus.dstMac}`}
                      </span>
                    )}
                    {sendStatus?.error && (
                      <span style={{fontSize:12, color:'var(--red)'}}>{t('packet_headers.scapy_send_error')}: {sendStatus.error}</span>
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>

        <div className="card fadein" style={{flex:1, minWidth:0}}>
          <div className="card-title">{t('packet_headers.field_details')}</div>
          {selectedField ? (
            <div className="fadein">
              <div style={{fontSize:16,fontWeight:700,color:selectedField.color,marginBottom:4}}>{selectedField.name}</div>
              <div style={{fontSize:11,color:'var(--dim)',marginBottom:12}}>{t('packet_headers.size_bits', {bits: selectedField.bits, max: Math.pow(2, selectedField.bits)-1})}</div>

              <div style={{fontSize:13,color:'var(--text)',lineHeight:1.5,marginBottom:selectedField.id.endsWith('_chk') ? 8 : 16}}>{selectedField.desc}</div>
              {selectedField.id.endsWith('_chk') && (
                <div style={{fontSize:11,color:'var(--yellow)',marginBottom:16,padding:'6px 10px',background:'rgba(255,200,0,0.06)',borderRadius:6,border:'1px solid var(--yellow)',lineHeight:1.5}}>
                  {t('packet_headers.checksum_recalc_note')}
                </div>
              )}

              <div className="field">
                <label className="label">{t('packet_headers.value')}</label>
                {selectedField.isFlags ? (
                  <div style={{display:'flex',flexDirection:'column',gap:4}}>
                    {selectedField.flags.map((fname, idx) => {
                      const bitIdx = selectedField.bits - 1 - idx;
                      const isSet = (fieldValues[selectedField.id] & (1 << bitIdx)) !== 0;
                      return (
                        <label key={fname} style={{display:'flex',alignItems:'center',gap:8,fontSize:12,cursor:'pointer',padding:'4px 8px',background:'var(--panel)',borderRadius:4}}>
                          <input type="checkbox" checked={isSet} onChange={e => {
                            const cur = fieldValues[selectedField.id];
                            updateVal(selectedField.id, e.target.checked ? (cur | (1 << bitIdx)) : (cur & ~(1 << bitIdx)));
                          }} />
                          <span style={{fontFamily:'var(--mono)',color:'var(--cyan)',width:30}}>{fname}</span>
                          <span style={{color:'var(--dim)'}}>Bit {bitIdx}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : selectedField.isIP ? (
                  <div>
                    <input className="input" value={ipDraft}
                      placeholder="e.g. 192.168.1.1"
                      style={{fontFamily:'var(--mono)', borderColor: ipError ? 'var(--red)' : undefined}}
                      onChange={e => {
                        const val = e.target.value;
                        setIpDraft(val);
                        setIpError(false);
                        const p = IPv4.parse(val);
                        if (p !== null) updateVal(selectedField.id, p);
                      }}
                      onBlur={() => {
                        if (IPv4.parse(ipDraft) === null) setIpError(true);
                      }}
                    />
                    {ipError && <div style={{fontSize:11,color:'var(--red)',marginTop:4}}>{t('packet_headers.invalid_ip')}</div>}
                  </div>
                ) : (
                  <div className="field">
                    <div className="input-row grid-mobile-1">
                      <input className="input" type="number"
                        min="0" max={Math.pow(2, selectedField.bits)-1}
                        value={fieldValues[selectedField.id] || 0}
                        onChange={e => updateVal(selectedField.id, parseInt(e.target.value) || 0)} />
                    </div>
                    {selectedField.name.toLowerCase().includes('port') && (
                      <div className="btn-row grid-mobile-1" style={{marginTop:8, display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(60px, 1fr))', gap:4}}>
                        {[80, 443, 53, 22, 21, 23, 25, 110, 143, 3306, 3389, 5060].map(p => (
                          <button key={p} className="btn btn-ghost btn-sm" style={{padding:'4px 2px'}} onClick={() => updateVal(selectedField.id, p)}>{p}</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div style={{height:200,display:'flex',alignItems:'center',justifyContent:'center',color:'var(--dim)',fontSize:13,textAlign:'center'}}>
              {t('packet_headers.click_field_hint').split('<br/>').map((line, i) => <React.Fragment key={i}>{line}<br/></React.Fragment>)}
            </div>
          )}
        </div>
      </div>

      <style>{`
        .tab-row { display: flex; gap: 8px; margin-top: 12px; overflow-x: auto; padding-bottom: 4px; }
        .tab-btn {
          padding: 8px 16px; border: 1px solid var(--border); background: var(--panel);
          color: var(--muted); border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: 600;
          transition: all 0.2s; white-space: nowrap;
        }
        .tab-btn:hover { background: var(--card); color: var(--text); }
        .tab-btn.active { background: var(--cyan); color: var(--btn-text); border-color: var(--cyan); }
      `}</style>
    </div>
  );
}

window.PacketHeaders = PacketHeaders;
