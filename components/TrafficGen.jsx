const { useState, useEffect, useMemo } = React;

const TRAFFIC_PRESETS = [
  { id: 'rfc2544', label: 'RFC 2544 Throughput Test' },
  { id: 'imix', label: 'IMIX (Internet Traffic Mix)' },
  { id: 'mcast_stress', label: 'Multicast Control Plane Stress' },
  { id: 'convergence', label: 'Network Convergence Monitor' }
];

const LINK_SPEEDS = [
  { label: '10 Mbps', bps: 10000000 },
  { label: '100 Mbps', bps: 100000000 },
  { label: '1 Gbps (1G)', bps: 1000000000 },
  { label: '10 Gbps (10G)', bps: 10000000000 },
  { label: '25 Gbps (25G)', bps: 25000000000 },
  { label: '40 Gbps (40G)', bps: 40000000000 },
  { label: '100 Gbps (100G)', bps: 100000000000 }
];

function TrafficGen({ initialData, onShare }) {
  const { t } = useTranslation();
  const [copied, copy] = useCopy();

  const [preset, setPreset] = usePersistentState('traffic:preset', initialData?.preset ?? 'rfc2544');
  const [linkSpeedBps, setLinkSpeedBps] = usePersistentState('traffic:speed', initialData?.speed ?? 1000000000); // Default 1G
  const [customSpeedMbps, setCustomSpeedMbps] = usePersistentState('traffic:custom_speed', initialData?.custom_speed ?? '');
  const [customFrameSize, setCustomFrameSize] = usePersistentState('traffic:frame_size', initialData?.frame_size ?? 64);
  
  const [srcIp, setSrcIp] = usePersistentState('traffic:src_ip', initialData?.src_ip ?? '192.168.10.10');
  const [dstIp, setDstIp] = usePersistentState('traffic:dst_ip', initialData?.dst_ip ?? '192.168.20.20');
  const [srcMac, setSrcMac] = usePersistentState('traffic:src_mac', initialData?.src_mac ?? '00:11:22:33:44:55');
  const [dstMac, setDstMac] = usePersistentState('traffic:dst_mac', initialData?.dst_mac ?? '00:aa:bb:cc:dd:ee');
  const [vlanTag, setVlanTag] = usePersistentState('traffic:vlan', initialData?.vlan ?? '');
  const [udpSrcPort, setUdpSrcPort] = usePersistentState('traffic:sport', initialData?.sport ?? '5001');
  const [udpDstPort, setUdpDstPort] = usePersistentState('traffic:dport', initialData?.dport ?? '5001');

  const [activeCodeTab, setActiveCodeTab] = usePersistentState('traffic:code_tab', 'scapy');

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'traffic-gen',
        preset,
        speed: linkSpeedBps,
        custom_speed: customSpeedMbps,
        frame_size: customFrameSize,
        src_ip: srcIp,
        dst_ip: dstIp,
        src_mac: srcMac,
        dst_mac: dstMac,
        vlan: vlanTag,
        sport: udpSrcPort,
        dport: udpDstPort
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [preset, linkSpeedBps, customSpeedMbps, customFrameSize, srcIp, dstIp, srcMac, dstMac, vlanTag, udpSrcPort, udpDstPort, onShare]);

  // Actual bandwidth bps
  const speedBps = useMemo(() => {
    if (customSpeedMbps) {
      const val = parseFloat(customSpeedMbps);
      return isNaN(val) ? 1000000000 : val * 1000000;
    }
    return linkSpeedBps;
  }, [linkSpeedBps, customSpeedMbps]);

  // Calculations for PPS
  const calculations = useMemo(() => {
    // Physical wire overhead per frame: Preamble (7B) + SFD (1B) + IPG (12B) = 20B
    const overhead = 20;

    if (preset === 'imix') {
      // Standard Simple IMIX distribution
      // 7x 64B, 4x 570B, 1x 1518B
      const totalFrames = 12;
      const totalBytes = (7 * 64) + (4 * 570) + (1 * 1518); // 4246 bytes
      const avgFrameSize = totalBytes / totalFrames; // ~353.83 B
      const avgWireSize = avgFrameSize + overhead; // ~373.83 B

      const ppsAtLineRate = speedBps / (avgWireSize * 8);

      return {
        avgFrameSize: avgFrameSize.toFixed(1),
        avgWireSize: avgWireSize.toFixed(1),
        pps: Math.round(ppsAtLineRate),
        isImix: true,
        imixBreakdown: [
          { size: 64, count: 7, percentage: '58.3%', pps: Math.round((7 / 12) * ppsAtLineRate) },
          { size: 570, count: 4, percentage: '33.3%', pps: Math.round((4 / 12) * ppsAtLineRate) },
          { size: 1518, count: 1, percentage: '8.3%', pps: Math.round((1 / 12) * ppsAtLineRate) }
        ]
      };
    } else {
      let size = parseInt(customFrameSize, 10);
      if (isNaN(size) || size < 64) size = 64;
      if (size > 9000) size = 9000;

      const wireSize = size + overhead;
      const pps = speedBps / (wireSize * 8);

      // If RFC 2544, calculate standard size steps
      const rfcSizes = [64, 128, 256, 512, 1024, 1280, 1518];
      const rfcTable = rfcSizes.map(sz => {
        const wireSz = sz + overhead;
        return {
          size: sz,
          pps: Math.round(speedBps / (wireSz * 8))
        };
      });

      return {
        avgFrameSize: size,
        avgWireSize: wireSize,
        pps: Math.round(pps),
        isImix: false,
        rfcTable
      };
    }
  }, [preset, speedBps, customFrameSize]);

  // Determine multicast MAC
  const derivedDstMac = useMemo(() => {
    if (preset === 'mcast_stress') {
      const parts = dstIp.split('.');
      if (parts.length === 4) {
        const o2 = parseInt(parts[1], 10) & 0x7f;
        const o3 = parseInt(parts[2], 10);
        const o4 = parseInt(parts[3], 10);
        if (!isNaN(o2) && !isNaN(o3) && !isNaN(o4)) {
          const hex2 = o2.toString(16).padStart(2, '0');
          const hex3 = o3.toString(16).padStart(2, '0');
          const hex4 = o4.toString(16).padStart(2, '0');
          return `01:00:5e:${hex2}:${hex3}:${hex4}`;
        }
      }
    }
    return dstMac;
  }, [preset, dstIp, dstMac]);

  // Python Scapy Script Generator
  const scapyScript = useMemo(() => {
    const lines = [];
    lines.push('#!/usr/bin/env python3');
    lines.push('# Generated by NetEngKit Traffic Generator Builder');
    lines.push('# Run with sudo / root permissions');
    lines.push('import sys');
    lines.push('import time');
    lines.push('from scapy.all import *');
    lines.push('');

    // Common packet layers setup
    const dot1q = vlanTag ? `Dot1Q(vlan=${vlanTag})/` : '';
    const layer2 = `Ether(src="${srcMac}", dst="${derivedDstMac}")`;

    if (preset === 'convergence') {
      lines.push('# --- Network Convergence Test (Sender) ---');
      lines.push('def start_sender(interface, target_pps):');
      lines.push('    print(f"Starting convergence monitor sender on {interface} at {target_pps} PPS...")');
      lines.push('    seq_num = 0');
      lines.push('    interval = 1.0 / target_pps');
      lines.push('    ');
      lines.push('    try:');
      lines.push('        while True:');
      lines.push('            # Inject sequence number and timestamp in packet payload');
      lines.push('            payload = f"SEQ:{seq_num:010d}:TS:{time.time():.6f}:CONVERGENCE_TEST"');
      lines.push(`            pkt = ${layer2}/${dot1q}IP(src="${srcIp}", dst="${dstIp}")/UDP(sport=${udpSrcPort}, dport=${udpDstPort})/Raw(load=payload)`);
      lines.push('            sendp(pkt, iface=interface, verbose=False)');
      lines.push('            seq_num += 1');
      lines.push('            time.sleep(interval)');
      lines.push('    except KeyboardInterrupt:');
      lines.push('        print("\\nSender stopped.")');
      lines.push('');
      lines.push('# Receiver side code to analyze drops and calculate exact outage duration');
      lines.push('def run_receiver(interface):');
      lines.push('    print(f"Monitoring convergence packet drops on {interface}...")');
      lines.push('    last_seq = None');
      lines.push('    outages = []');
      lines.push('    ');
      lines.push('    def process_packet(pkt):');
      lines.push('        nonlocal last_seq');
      lines.push('        if Raw in pkt:');
      lines.push('            try:');
      lines.push('                payload = pkt[Raw].load.decode()');
      lines.push('                if "CONVERGENCE_TEST" in payload:');
      lines.push('                    parts = payload.split(":")');
      lines.push('                    seq = int(parts[1])');
      lines.push('                    ts = float(parts[3])');
      lines.push('                    curr_time = time.time()');
      lines.push('                    ');
      lines.push('                    if last_seq is not None and (seq - last_seq) > 1:');
      lines.push('                        lost = seq - last_seq - 1');
      lines.push('                        outage_dur = curr_time - ts');
      lines.push('                        print(f"[-] Drop detected! Lost: {lost} packets. Est outage duration: {outage_dur:.4f}s")');
      lines.push('                        outages.append(outage_dur)');
      lines.push('                    last_seq = seq');
      lines.push('            except Exception:');
      lines.push('                pass');
      lines.push('    ');
      lines.push('    sniff(iface=interface, filter="udp and port 5001", prn=process_packet, store=False)');
      lines.push('');
      lines.push('if __name__ == "__main__":');
      lines.push('    if len(sys.argv) < 3:');
      lines.push('        print("Usage: sudo python3 script.py [sender|receiver] [interface]")');
      lines.push('        sys.exit(1)');
      lines.push('    ');
      lines.push('    mode = sys.argv[1]');
      lines.push('    iface = sys.argv[2]');
      lines.push('    if mode == "sender":');
      lines.push(`        start_sender(iface, ${calculations.pps})`);
      lines.push('    elif mode == "receiver":');
      lines.push('        run_receiver(iface)');
    } else if (preset === 'mcast_stress') {
      lines.push('# --- Multicast Stress Generator ---');
      lines.push('# Sends IGMP join reports and storms UDP multicast groups');
      lines.push(`def send_mcast_storm(iface, count=${calculations.pps}):`);
      lines.push(`    print(f"Sending multicast stress packets to group ${dstIp} on {iface}...")`);
      lines.push(`    # Craft IGMPv2 Join Report`);
      lines.push(`    igmp_join = Ether(src="${srcMac}", dst="01:00:5e:00:00:16")/${dot1q}IP(src="${srcIp}", dst="224.0.0.22", ttl=1)/IGMP(type=0x22, gaddr="${dstIp}")`);
      lines.push('    sendp(igmp_join, iface=iface, verbose=False)');
      lines.push('    print("IGMP Join Report Sent. Waiting 1 second before storm...")');
      lines.push('    time.sleep(1.0)');
      lines.push('    ');
      lines.push('    # Multicast UDP packet storm');
      lines.push(`    pkt = ${layer2}/${dot1q}IP(src="${srcIp}", dst="${dstIp}", ttl=16)/UDP(sport=${udpSrcPort}, dport=${udpDstPort})/("X" * ${calculations.avgFrameSize - 42})`);
      lines.push('    ');
      lines.push('    # Fast send loop using scapy socket sendp');
      lines.push('    s = conf.L2socket(iface=iface)');
      lines.push('    try:');
      lines.push('        print("Sending UDP multicast flood... Press Ctrl+C to terminate.")');
      lines.push('        start_t = time.time()');
      lines.push('        for _ in range(count * 10): # sends for 10 seconds');
      lines.push('            s.send(pkt)');
      lines.push('        print(f"Sent {count*10} packets in {time.time() - start_t:.2f}s")');
      lines.push('    except KeyboardInterrupt:');
      lines.push('        print("\\nStorm terminated.")');
      lines.push('');
      lines.push('if __name__ == "__main__":');
      lines.push('    if len(sys.argv) < 2:');
      lines.push('        print("Usage: sudo python3 script.py [interface]")');
      lines.push('        sys.exit(1)');
      lines.push('    send_mcast_storm(sys.argv[1])');
    } else if (preset === 'imix') {
      lines.push('# --- IMIX (Internet Mix) Packet Generator ---');
      lines.push('def send_imix(iface, duration=10):');
      lines.push('    print(f"Injecting IMIX profiles to {iface}...")');
      lines.push('    # Prepare standard packets templates');
      lines.push(`    pkt_64 = ${layer2}/${dot1q}IP(src="${srcIp}", dst="${dstIp}")/UDP(sport=${udpSrcPort}, dport=${udpDstPort})/("X" * 18) # 64B Ethernet`);
      lines.push(`    pkt_570 = ${layer2}/${dot1q}IP(src="${srcIp}", dst="${dstIp}")/UDP(sport=${udpSrcPort}, dport=${udpDstPort})/("X" * 528) # 570B Ethernet`);
      lines.push(`    pkt_1518 = ${layer2}/${dot1q}IP(src="${srcIp}", dst="${dstIp}")/UDP(sport=${udpSrcPort}, dport=${udpDstPort})/("X" * 1476) # 1518B Ethernet`);
      lines.push('    ');
      lines.push('    s = conf.L2socket(iface=iface)');
      lines.push('    interval = 1.0 / 12.0 # 12 packets per batch');
      lines.push('    ');
      lines.push('    try:');
      lines.push('        while True:');
      lines.push('            # Send 12 packets conforming to the IMIX distribution (7:4:1)');
      lines.push('            for _ in range(7): s.send(pkt_64)');
      lines.push('            for _ in range(4): s.send(pkt_570)');
      lines.push('            s.send(pkt_1518)');
      lines.push('            time.sleep(interval)');
      lines.push('    except KeyboardInterrupt:');
      lines.push('        print("\\nIMIX Stopped.")');
      lines.push('');
      lines.push('if __name__ == "__main__":');
      lines.push('    if len(sys.argv) < 2:');
      lines.push('        print("Usage: sudo python3 script.py [interface]")');
      lines.push('        sys.exit(1)');
      lines.push('    send_imix(sys.argv[1])');
    } else {
      lines.push('# --- Standard Fixed-size packet flood ---');
      lines.push('def send_packets(iface):');
      lines.push(`    print("Preparing packets (Frame size: ${calculations.avgFrameSize} bytes)...")`);
      lines.push(`    pkt = ${layer2}/${dot1q}IP(src="${srcIp}", dst="${dstIp}")/UDP(sport=${udpSrcPort}, dport=${udpDstPort})/("X" * ${calculations.avgFrameSize - 42})`);
      lines.push('    ');
      lines.push('    # Efficient socket-based send loop');
      lines.push('    s = conf.L2socket(iface=iface)');
      lines.push('    try:');
      lines.push('        print("Flooding... Press Ctrl+C to terminate.")');
      lines.push('        while True:');
      lines.push('            s.send(pkt)');
      lines.push('    except KeyboardInterrupt:');
      lines.push('        print("\\nStopped.")');
      lines.push('');
      lines.push('if __name__ == "__main__":');
      lines.push('    if len(sys.argv) < 2:');
      lines.push('        print("Usage: sudo python3 script.py [interface]")');
      lines.push('        sys.exit(1)');
      lines.push('    send_packets(sys.argv[1])');
    }

    return lines.join('\n');
  }, [preset, srcIp, dstIp, srcMac, derivedDstMac, vlanTag, udpSrcPort, udpDstPort, calculations]);

  // TRex Stateless Profile YAML/Python Generator
  const trexProfile = useMemo(() => {
    const lines = [];
    lines.push('# TRex Stateless Traffic Generator Profile (stl format)');
    lines.push('# Save as stl_profile.py and execute via trex command line:');
    lines.push('# trex-console -f stl_profile.py -m 10gbps --port 0');
    lines.push('');
    lines.push('from trex_stl_lib.api import *');
    lines.push('');
    lines.push('class STLProfile(object):');
    lines.push('    def get_streams(self, direction=0, **kwargs):');
    lines.push('        streams = []');
    lines.push('');

    // Core packet templates
    const dot1q = vlanTag ? `Dot1Q(vlan=${vlanTag})/` : '';

    if (preset === 'imix') {
      lines.push('        # Stream 1: 64B Packets (58.3% proportion)');
      lines.push(`        base_pkt1 = Ether(src="${srcMac}", dst="${derivedDstMac}")/${dot1q}IP(src="${srcIp}", dst="${dstIp}")/UDP(sport=${udpSrcPort}, dport=${udpDstPort})`);
      lines.push('        pkt1 = STLPktBuilder(pkt=base_pkt1, size=64)');
      lines.push('        # Rate is configured weighted to 7/12th of overall profile');
      lines.push('        streams.append(STLStream(packet=pkt1, mode=STLIptg(pps=7000)))');
      lines.push('');
      lines.push('        # Stream 2: 570B Packets (33.3% proportion)');
      lines.push(`        base_pkt2 = Ether(src="${srcMac}", dst="${derivedDstMac}")/${dot1q}IP(src="${srcIp}", dst="${dstIp}")/UDP(sport=${udpSrcPort}, dport=${udpDstPort})`);
      lines.push('        pkt2 = STLPktBuilder(pkt=base_pkt2, size=570)');
      lines.push('        streams.append(STLStream(packet=pkt2, mode=STLIptg(pps=4000)))');
      lines.push('');
      lines.push('        # Stream 3: 1518B Packets (8.3% proportion)');
      lines.push(`        base_pkt3 = Ether(src="${srcMac}", dst="${derivedDstMac}")/${dot1q}IP(src="${srcIp}", dst="${dstIp}")/UDP(sport=${udpSrcPort}, dport=${udpDstPort})`);
      lines.push('        pkt3 = STLPktBuilder(pkt=base_pkt3, size=1518)');
      lines.push('        streams.append(STLStream(packet=pkt3, mode=STLIptg(pps=1000)))');
    } else {
      lines.push(`        # Main stream (fixed size: ${calculations.avgFrameSize}B)`);
      lines.push(`        base_pkt = Ether(src="${srcMac}", dst="${derivedDstMac}")/${dot1q}IP(src="${srcIp}", dst="${dstIp}")/UDP(sport=${udpSrcPort}, dport=${udpDstPort})`);
      lines.push(`        pkt = STLPktBuilder(pkt=base_pkt, size=${calculations.avgFrameSize})`);
      lines.push('');
      lines.push('        # Field Engine (VM) to simulate random host IPs / source ports');
      lines.push('        vm = STLVM()');
      lines.push('        # Randomize source IP within subnet range');
      lines.push('        vm.var(name="src", min_value="192.168.10.10", max_value="192.168.10.250", size=4, op="random")');
      lines.push('        vm.write(fv_name="src", pkt_offset="IP.src")');
      lines.push('        # Recompute IP and UDP checksums dynamically');
      lines.push('        vm.fix_chksum()');
      lines.push('');
      lines.push(`        streams.append(STLStream(packet=pkt, mode=STLIptg(pps=${calculations.pps}), vm=vm))`);
    }

    lines.push('');
    lines.push('        return streams');
    lines.push('');
    lines.push('def register():');
    lines.push('    return STLProfile()');
    return lines.join('\n');
  }, [preset, srcIp, dstIp, srcMac, derivedDstMac, vlanTag, udpSrcPort, udpDstPort, calculations]);

  const activeContent = useMemo(() => {
    return activeCodeTab === 'scapy' ? scapyScript : trexProfile;
  }, [activeCodeTab, scapyScript, trexProfile]);

  const handleExport = useCallback(() => {
    const filename = activeCodeTab === 'scapy' ? 'scapy_generator.py' : 'trex_stl_profile.py';
    const blob = new Blob([activeContent], { type: 'text/x-python' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeCodeTab, activeContent]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('traffic_gen.title', 'Traffic Generator Config Builder')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          {t('traffic_gen.subtitle', 'Build configurations for Scapy and TRex traffic generators. Calculate exact packet rates (PPS) to saturate networks at line rates and configure performance diagnostics profiles.')}
        </p>

        <div className="two-col grid-mobile-1" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {/* Builder Controls */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 10, color: 'var(--cyan)' }}>
              {t('traffic_gen.section_presets', '1. Test Type & Line Rate')}
            </div>

            <div className="field">
              <label className="label">{t('traffic_gen.preset', 'Test Preset profile')}</label>
              <select className="input" value={preset} onChange={e => setPreset(e.target.value)}>
                {TRAFFIC_PRESETS.map(p => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
            </div>

            <div className="two-col">
              <div className="field">
                <label className="label">{t('traffic_gen.line_rate', 'Link speed')}</label>
                <select className="input" value={linkSpeedBps} onChange={e => {
                  setLinkSpeedBps(parseInt(e.target.value, 10));
                  setCustomSpeedMbps('');
                }}>
                  {LINK_SPEEDS.map((s, idx) => (
                    <option key={idx} value={s.bps}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">{t('traffic_gen.custom_speed', 'Or custom Mbps')}</label>
                <input className="input" value={customSpeedMbps} onChange={e => setCustomSpeedMbps(e.target.value)} placeholder="e.g. 500" />
              </div>
            </div>

            {preset !== 'imix' && (
              <div className="field">
                <label className="label">{t('traffic_gen.frame_size', 'Ethernet Frame size (Bytes)')}</label>
                <input className="input" type="number" min="64" max="9000" value={customFrameSize} onChange={e => setCustomFrameSize(parseInt(e.target.value, 10) || 64)} />
                <span className="hint">{t('traffic_gen.frame_size_hint', 'Standard: 64 to 1518. Jumbo: up to 9000.')}</span>
              </div>
            )}

            <div style={{ fontWeight: 600, marginTop: 16, marginBottom: 10, color: 'var(--cyan)' }}>
              {t('traffic_gen.section_pkt', '2. Packet Header templates')}
            </div>

            <div className="two-col">
              <div className="field">
                <label className="label">{t('traffic_gen.src_ip', 'Source IP')}</label>
                <input className="input" value={srcIp} onChange={e => setSrcIp(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('traffic_gen.dst_ip', 'Destination IP')}</label>
                <input className="input" value={dstIp} onChange={e => setDstIp(e.target.value)} />
              </div>
            </div>

            <div className="two-col">
              <div className="field">
                <label className="label">{t('traffic_gen.src_mac', 'Source MAC')}</label>
                <input className="input" value={srcMac} onChange={e => setSrcMac(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('traffic_gen.dst_mac', 'Destination MAC')}</label>
                <input className="input" disabled={preset === 'mcast_stress'} value={preset === 'mcast_stress' ? derivedDstMac : dstMac} onChange={e => setDstMac(e.target.value)} />
              </div>
            </div>

            <div className="three-col">
              <div className="field">
                <label className="label">{t('traffic_gen.vlan', '802.1Q VLAN')}</label>
                <input className="input" value={vlanTag} onChange={e => setVlanTag(e.target.value)} placeholder="Optional tag" />
              </div>
              <div className="field">
                <label className="label">{t('traffic_gen.sport', 'Source Port')}</label>
                <input className="input" value={udpSrcPort} onChange={e => setUdpSrcPort(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('traffic_gen.dport', 'Dest Port')}</label>
                <input className="input" value={udpDstPort} onChange={e => setUdpDstPort(e.target.value)} />
              </div>
            </div>

            {/* Link-rate calculations results block */}
            <div style={{ marginTop: 16, padding: 14, background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--cyan)', marginBottom: 8 }}>
                📈 {t('traffic_gen.calculation_summary', 'Line Rate Saturation Metrics')}
              </div>
              <div className="result-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 10, margin: 0 }}>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('traffic_gen.payload_size')}</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{calculations.avgFrameSize} {t('common.bytes')}</div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('traffic_gen.wire_size')}</div>
                  <div style={{ fontSize: 15, fontWeight: 600 }}>{calculations.avgWireSize} {t('common.bytes')}</div>
                </div>
                <div style={{ gridColumn: 'span 2' }}>
                  <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('traffic_gen.saturation_rate')}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--green)' }}>
                    {calculations.pps.toLocaleString()} {t('traffic_gen.pps')}
                  </div>
                </div>
              </div>
              
              {calculations.isImix && (
                <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan)' }}>{t('traffic_gen.imix_breakdown')}</div>
                  <table style={{ width: '100%', fontSize: 11, marginTop: 4 }}>
                    <thead>
                      <tr style={{ textAlign: 'left', color: 'var(--muted)' }}>
                        <th>{t('traffic_gen.th_size')}</th>
                        <th>{t('traffic_gen.th_ratio')}</th>
                        <th>{t('traffic_gen.th_freq')}</th>
                        <th>{t('traffic_gen.th_pps')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {calculations.imixBreakdown.map((row, idx) => (
                        <tr key={idx}>
                          <td>{row.size}B</td>
                          <td>{row.count === 7 ? '7/12' : row.count === 4 ? '4/12' : '1/12'}</td>
                          <td>{row.percentage}</td>
                          <td>{row.pps.toLocaleString()} {t('traffic_gen.pps').toLowerCase()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

          </div>

          {/* Generated Code Output */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 10 }}>
              <div style={{ fontWeight: 600, color: 'var(--cyan)' }}>
                {t('traffic_gen.code_output', '3. Generated script')}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button className={`btn btn-sm ${activeCodeTab === 'scapy' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveCodeTab('scapy')}>{t('traffic_gen.tab_scapy')}</button>
                <button className={`btn btn-sm ${activeCodeTab === 'trex' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveCodeTab('trex')}>{t('traffic_gen.tab_trex')}</button>
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              <pre style={{
                background: 'var(--code-bg)',
                color: 'var(--code-fg)',
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: 12,
                overflowX: 'auto',
                whiteSpace: 'pre',
                minHeight: 460,
                maxHeight: 600,
                margin: 0
              }}>
                {activeContent}
              </pre>
              <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
                <CopyBtn text={activeContent} />
                <button className="copy-btn" onClick={handleExport} title={t('common.export', 'Export File')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', background: 'var(--panel)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
              <strong>{t('traffic_gen.execution_guidelines')}</strong>
              {activeCodeTab === 'scapy' && (
                <ul style={{ paddingLeft: 18, margin: '4px 0 0 0' }}>
                  <li>{t('traffic_gen.scapy_desc')}</li>
                  {preset === 'convergence' && <li><strong>{t('traffic_gen.convergence_test')}</strong> {t('traffic_gen.convergence_desc')}</li>}
                </ul>
              )}
              {activeCodeTab === 'trex' && (
                <ul style={{ paddingLeft: 18, margin: '4px 0 0 0' }}>
                  <li>{t('traffic_gen.trex_desc_1')}</li>
                  <li>{t('traffic_gen.trex_desc_2', { code: <code>trex-console</code> })}</li>
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* RFC 2544 Size Metrics reference grid */}
        {!calculations.isImix && (
          <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontWeight: 600, color: 'var(--cyan)', marginBottom: 8 }}>
              {t('traffic_gen.rfc_title')}
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
              {t('traffic_gen.rfc_desc', { speed: (speedBps / 1e9).toFixed(1) })}
            </p>
            <div className="result-grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 10 }}>
              {calculations.rfcTable.map((row, idx) => (
                <div key={idx} className="result-item" style={{ flexDirection: 'column', alignItems: 'flex-start', padding: 10 }}>
                  <div className="result-label">{t('traffic_gen.rfc_frame', { size: row.size })}</div>
                  <div className="result-value" style={{ fontSize: 14, fontWeight: 700, color: 'var(--cyan)' }}>
                    {row.pps.toLocaleString()} {t('traffic_gen.pps')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

window.TrafficGen = TrafficGen;
