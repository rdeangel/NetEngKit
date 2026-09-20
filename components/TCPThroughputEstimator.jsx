const { useState, useEffect, useCallback, useRef, useMemo } = React;

/* ── RFC-Grounded Constants ── */
const TCP_HDR = 20;       // RFC 793 §3.1 — minimum TCP header
const IPV4_HDR = 20;      // RFC 791 — minimum IPv4 header
const IPV6_HDR = 40;      // RFC 8200 — fixed IPv6 header
const ETH_OVERHEAD = 38;  // 14 (hdr) + 4 (FCS) + 12 (IFG) + 7 (preamble) + 1 (SFD)
const MAX_WIN16 = 65535;  // 16-bit window field max (RFC 793)
const MAX_SCALE = 14;     // RFC 7323 §2.3 — max shift count

const LINK_PRESETS = [
  { label: 'T1 (1.5M)',             bw: 1.5,    unit: 'Mbps' },
  { label: 'DS3 (45M)',             bw: 45,     unit: 'Mbps' },
  { label: '100M LAN',              bw: 100,    unit: 'Mbps' },
  { label: '1G LAN',                bw: 1000,   unit: 'Mbps' },
  { label: '10G LAN',               bw: 10000,  unit: 'Mbps' },
  { label: '100G WAN',              bw: 100000, unit: 'Mbps' },
  { label: 'Satellite (50M)',       bw: 50,     unit: 'Mbps', rtt: 500 },
  { label: 'Trans-Pac (1G)',        bw: 1000,   unit: 'Mbps', rtt: 160 },
  { label: 'Trans-Atl (1G)',        bw: 1000,   unit: 'Mbps', rtt: 80  },
  { label: 'Cross-US (1G)',         bw: 1000,   unit: 'Mbps', rtt: 60  },
];

const RTT_PRESETS = [
  { label: 'LAN (0.1ms)',           rtt: 0.1 },
  { label: 'Metro (5ms)',           rtt: 5 },
  { label: 'Regional (20ms)',       rtt: 20 },
  { label: 'Cross-US (60ms)',       rtt: 60 },
  { label: 'Trans-Atl (80ms)',      rtt: 80 },
  { label: 'Trans-Pac (160ms)',     rtt: 160 },
  { label: 'Satellite (500ms)',     rtt: 500 },
];

function fmtBps(bps) {
  if (!isFinite(bps) || bps <= 0) return '—';
  if (bps >= 1e12) return (bps / 1e12).toFixed(2) + ' Tbps';
  if (bps >= 1e9)  return (bps / 1e9).toFixed(2)  + ' Gbps';
  if (bps >= 1e6)  return (bps / 1e6).toFixed(2)  + ' Mbps';
  if (bps >= 1e3)  return (bps / 1e3).toFixed(2)  + ' Kbps';
  return bps.toFixed(2) + ' bps';
}

function fmtBytes(b) {
  if (!isFinite(b) || b <= 0) return '—';
  if (b >= 1073741824) return (b / 1073741824).toFixed(2) + ' GiB';
  if (b >= 1048576)    return (b / 1048576).toFixed(2)    + ' MiB';
  if (b >= 1024)       return (b / 1024).toFixed(2)       + ' KiB';
  return b.toFixed(0) + ' B';
}

function formatBits(bits) {
  if (!isFinite(bits) || bits <= 0) return '—';
  if (bits < 1000)    return `${bits.toFixed(0)} bits`;
  if (bits < 1000000) return `${(bits/1000).toFixed(2)} Kbits`;
  if (bits < 1e9)     return `${(bits/1e6).toFixed(2)} Mbits`;
  return `${(bits/1e9).toFixed(2)} Gbits`;
}

function formatTime(seconds) {
  if (!isFinite(seconds) || seconds <= 0) return '—';
  if (seconds < 0.001) return (seconds * 1e6).toFixed(0) + ' μs';
  if (seconds < 1) return (seconds * 1000).toFixed(1) + ' ms';
  if (seconds < 60) return seconds.toFixed(2) + ' s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s.toFixed(0)}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  if (h < 24) return `${h}h ${mm}m`;
  const d = Math.floor(h / 24);
  const hh = h % 24;
  return `${d}d ${hh}h`;
}

function fmtBDPBytes(bytes) {
  if (!isFinite(bytes) || bytes <= 0) return '—';
  if (bytes < 1024)       return `${bytes.toFixed(0)} B`;
  if (bytes < 1048576)    return `${(bytes/1024).toFixed(2)} KB`;
  if (bytes < 1073741824) return `${(bytes/1048576).toFixed(2)} MB`;
  return `${(bytes/1073741824).toFixed(2)} GB`;
}

function calcThroughput({ bwMbps, bwUnit, rtt, mss, ipVersion, winSize, winScale, winUnit, customBw }) {
  // Resolve bandwidth in Mbps
  const bwVal = bwUnit === 'custom' ? parseFloat(customBw) || 0 : parseFloat(bwMbps) || 0;
  const bwMbpsNum = bwUnit === 'Gbps' ? bwVal * 1000 :
                    bwUnit === 'Kbps' ? bwVal / 1000 : bwVal;
  const bwBps = bwMbpsNum * 1e6;
  const rttSec = parseFloat(rtt) / 1000; // ms → sec
  const mssVal = parseInt(mss) || 1460;
  const ipVer = ipVersion || 'v4';
  const wScale = parseInt(winScale) || 0;
  const wSize = parseFloat(winSize) || 64;
  const wUnit = winUnit || 'kb';

  if (bwBps <= 0 || rttSec <= 0 || mssVal <= 0) return null;

  // 1) Max window with scaling (RFC 7323 §2.3)
  //    True window = SEG.WND << shift_count
  const maxWinRaw = MAX_WIN16 << wScale; // bytes
  // User's actual window in bytes
  let userWinBytes;
  if (wUnit === 'kb')      userWinBytes = wSize * 1024;
  else if (wUnit === 'mb') userWinBytes = wSize * 1048576;
  else if (wUnit === 'gb') userWinBytes = wSize * 1073741824;
  else                     userWinBytes = wSize; // bytes

  const effectiveWin = Math.min(userWinBytes, maxWinRaw);

  // 2) BDP (RFC 6349 §3.3.1): BDP (bits) = RTT (sec) × BB (bps)
  const bdpBits = rttSec * bwBps;
  const bdpBytes = bdpBits / 8;

  // 3) Theoretical throughput (RFC 6349 §3.3.1):
  //    TCP Throughput = TCP RWND × 8 / RTT
  const throughWinLimited = (effectiveWin * 8) / rttSec;

  // 4) L4 effective throughput (accounting for TCP/IP headers)
  const ipHdr = ipVer === 'v6' ? IPV6_HDR : IPV4_HDR;
  const totalL3Overhead = ipHdr + TCP_HDR;
  const efficiency = mssVal / (mssVal + totalL3Overhead);
  const throughL4 = throughWinLimited * efficiency;

  // 5) L2 effective throughput (Ethernet framing)
  const frameBytes = mssVal + totalL3Overhead + ETH_OVERHEAD;
  const l2Efficiency = mssVal / frameBytes;
  const throughL2 = throughWinLimited * l2Efficiency;

  // 6) Is the window sufficient?
  const winSufficient = effectiveWin >= bdpBytes;

  // 7) Throughput without window scaling (window capped at 65535 bytes)
  const throughNoScale = (MAX_WIN16 * 8) / rttSec;
  const throughNoScaleL4 = throughNoScale * efficiency;

  // 8) Congestion window analysis
  // RFC 6928: initial cwnd = 10 * MSS (or ~14.6 KB for MSS 1460)
  const initCwnd = Math.min(10, Math.max(2, Math.floor(4 * mssVal / 1460))) * mssVal;
  // Slow start: cwnd doubles each RTT. RTTs to fill window:
  const rttToFillWin = winSufficient
    ? Math.ceil(Math.log2(Math.max(1, bdpBytes / initCwnd)))
    : null;
  const timeToFillWin = rttToFillWin !== null ? rttToFillWin * rttSec * 1000 : null;

  // ssthresh after loss: max(FlightSize/2, 2*MSS) — RFC 5681 eq 4
  const ssthreshAfterLoss = Math.max(Math.floor(effectiveWin / 2), 2 * mssVal);

  // 9) Impact table: throughput at different RTTs
  const rttTable = [1, 5, 10, 20, 50, 100, 200, 500, 1000]
    .map(r => ({
      rtt: r,
      throughput: (effectiveWin * 8) / (r / 1000),
      throughputL4: (effectiveWin * 8) / (r / 1000) * efficiency,
    }));

  // 10) Transfer Time modeling for common files
  const fileSizes = [
    { label: '1 MB', bytes: 1e6 },
    { label: '10 MB', bytes: 10e6 },
    { label: '100 MB', bytes: 100e6 },
    { label: '1 GB', bytes: 1e9 },
    { label: '10 GB', bytes: 10e9 },
    { label: '100 GB', bytes: 100e9 },
  ].map(f => {
    const idealSeconds = (f.bytes * 8) / bwBps;
    const actualThroughput = Math.min(bwBps, throughL4); // capped at physical bandwidth
    const tcpSeconds = (f.bytes * 8) / actualThroughput;
    return {
      label: f.label,
      ideal: formatTime(idealSeconds),
      tcp: formatTime(tcpSeconds),
    };
  });

  // 11) Theoretical max throughput with default TCP window (64 KB, 1 MB, 4 MB, 16 MB)
  const defaultWindows = [65536, 1048576, 4194304, 16777216];
  const maxThroughputs = defaultWindows.map(w => {
    const throughputBps = (w * 8) / rttSec;
    const efficiencyPct = Math.min(100, (throughputBps / bwBps) * 100);
    return {
      window: fmtBDPBytes(w),
      throughput: throughputBps,
      efficiency: efficiencyPct,
    };
  });

  return {
    bwBps,
    bwMbpsNum,
    rttSec,
    mssVal,
    ipHdr,
    totalL3Overhead,
    userWinBytes,
    maxWinRaw,
    effectiveWin,
    bdpBits,
    bdpBytes,
    throughWinLimited,
    throughL4,
    throughL2,
    efficiency,
    l2Efficiency,
    winSufficient,
    throughNoScale,
    throughNoScaleL4,
    initCwnd,
    rttToFillWin,
    timeToFillWin,
    ssthreshAfterLoss,
    rttTable,
    wScale,
    ipVer,
    fileSizes,
    maxThroughputs,
    bdpBitsFormatted: formatBits(bdpBits),
  };
}

function TCPThroughputEstimator({ onShare, initialData }) {
  const { t } = useTranslation();

  const [bwMbps, setBwMbps] = usePersistentState('tcpthru:bw', initialData?.bw ?? '100');
  const [bwUnit, setBwUnit] = usePersistentState('tcpthru:bwUnit', initialData?.bwUnit ?? 'Mbps');
  const [customBw, setCustomBw] = usePersistentState('tcpthru:customBw', initialData?.customBw ?? '');
  const [rtt, setRtt] = usePersistentState('tcpthru:rtt', initialData?.rtt ?? '50');
  const [mss, setMss] = usePersistentState('tcpthru:mss', initialData?.mss ?? '1460');
  const [ipVersion, setIpVersion] = usePersistentState('tcpthru:ipVer', initialData?.ipVer ?? 'v4');
  const [winSize, setWinSize] = usePersistentState('tcpthru:winSize', initialData?.winSize ?? '64');
  const [winScale, setWinScale] = usePersistentState('tcpthru:winScale', initialData?.winScale ?? '3');
  const [winUnit, setWinUnit] = usePersistentState('tcpthru:winUnit', initialData?.winUnit ?? 'kb');
  const [copied, copy] = useCopy();

  // Share URL wiring
  useEffect(() => {
    const handle = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'tcp-throughput',
        bw: bwMbps, bwUnit, customBw, rtt, mss, ipVer: ipVersion,
        winSize, winScale, winUnit,
      });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [bwMbps, bwUnit, customBw, rtt, mss, ipVersion, winSize, winScale, winUnit, onShare]);

  const result = useMemo(() => calcThroughput({
    bwMbps, bwUnit, rtt, mss, ipVersion, winSize, winScale, winUnit, customBw,
  }), [bwMbps, bwUnit, rtt, mss, ipVersion, winSize, winScale, winUnit, customBw]);

  const scaleOptions = Array.from({ length: 15 }, (_, i) => i);

  return (
    <div className="fadein">
      <div className="card">
        <h2 className="card-title">{t('tcp_throughput.title')}</h2>
        <p style={{ color: 'var(--text2)', fontSize: '0.88rem', marginBottom: '1rem' }}>
          {t('tcp_throughput.subtitle')}
        </p>

        <div className="two-col">
          {/* Left: Inputs */}
          <div>
            <h3 style={{ marginTop: 0 }}>{t('tcp_throughput.link_params')}</h3>

            <div className="field">
              <label className="label">{t('tcp_throughput.bandwidth')}</label>
              <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem' }}>
                <input className="input" style={{ flex: 1 }}
                  value={bwUnit === 'custom' ? customBw : bwMbps}
                  onChange={e => bwUnit === 'custom' ? setCustomBw(e.target.value) : setBwMbps(e.target.value)}
                  placeholder={bwUnit === 'custom' ? 'e.g. 250000000' : '100'} />
                <select className="select" style={{ width: 100 }}
                  value={bwUnit} onChange={e => setBwUnit(e.target.value)}>
                  <option value="Mbps">Mbps</option>
                  <option value="Gbps">Gbps</option>
                  <option value="Kbps">Kbps</option>
                  <option value="custom">{t('tcp_throughput.custom_bps')}</option>
                </select>
              </div>
              
              {/* Bandwidth Presets */}
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px', marginBottom: '8px' }}>
                <span style={{ fontSize: '10px', color: 'var(--dim)', display: 'block', width: '100%' }}>{t('tcp_throughput.presets_link')}:</span>
                {LINK_PRESETS.map(p => (
                  <button key={p.label} className="btn btn-ghost" style={{ fontSize: '10px', padding: '2px 6px' }}
                    onClick={() => { setBwMbps(String(p.bw)); setBwUnit(p.unit); if (p.rtt) setRtt(String(p.rtt)); }}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="label">{t('tcp_throughput.rtt')}</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                <input className="input" style={{ flex: 1 }}
                  value={rtt} onChange={e => setRtt(e.target.value)} placeholder="50" />
                <span style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>ms</span>
              </div>
              
              {/* RTT Presets */}
              <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px', marginBottom: '8px' }}>
                <span style={{ fontSize: '10px', color: 'var(--dim)', display: 'block', width: '100%' }}>{t('tcp_throughput.presets_rtt')}:</span>
                {RTT_PRESETS.map(p => (
                  <button key={p.label} className="btn btn-ghost" style={{ fontSize: '10px', padding: '2px 6px' }}
                    onClick={() => setRtt(String(p.rtt))}>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="field">
              <label className="label">{t('tcp_throughput.mss')}</label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <input className="input" style={{ flex: 1 }}
                  value={mss} onChange={e => setMss(e.target.value)} placeholder="1460" />
                <span style={{ color: 'var(--text2)', fontSize: '0.85rem' }}>{t('tcp_throughput.bytes')}</span>
              </div>
              <div className="hint">{t('tcp_throughput.mss_hint')}</div>
            </div>

            <div className="field">
              <label className="label">{t('tcp_throughput.ip_version')}</label>
              <select className="select" value={ipVersion} onChange={e => setIpVersion(e.target.value)}>
                <option value="v4">IPv4 ({IPV4_HDR} {t('tcp_throughput.hdr_bytes')})</option>
                <option value="v6">IPv6 ({IPV6_HDR} {t('tcp_throughput.hdr_bytes')})</option>
              </select>
            </div>

            <h3>{t('tcp_throughput.tcp_window')}</h3>

            <div className="field">
              <label className="label">{t('tcp_throughput.win_size')}</label>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input className="input" style={{ flex: 1 }}
                  value={winSize} onChange={e => setWinSize(e.target.value)} placeholder="64" />
                <select className="select" style={{ width: 80 }}
                  value={winUnit} onChange={e => setWinUnit(e.target.value)}>
                  <option value="b">{t('tcp_throughput.unit_b')}</option>
                  <option value="kb">{t('tcp_throughput.unit_kb')}</option>
                  <option value="mb">{t('tcp_throughput.unit_mb')}</option>
                  <option value="gb">{t('tcp_throughput.unit_gb')}</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label className="label">{t('tcp_throughput.win_scale')} <RFCLink rfc={7323} /></label>
              <select className="select" value={winScale} onChange={e => setWinScale(e.target.value)}>
                {scaleOptions.map(s => (
                  <option key={s} value={s}>
                    {s} ({t('tcp_throughput.scale_max')}: {fmtBytes(MAX_WIN16 << s)})
                  </option>
                ))}
              </select>
              <div className="hint">{t('tcp_throughput.win_scale_hint')}</div>
            </div>
          </div>

          {/* Right: Results */}
          <div>
            {result && (
              <>
                <h3 style={{ marginTop: 0 }}>{t('tcp_throughput.results')}</h3>

                <div style={{
                  textAlign: 'center', padding: '1.2rem', marginBottom: '1rem',
                  background: 'var(--panel)', borderRadius: 'var(--radius, 8px)',
                  border: '1px solid var(--border)'
                }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginBottom: '0.25rem' }}>
                    {t('tcp_throughput.max_throughput_l3')}
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 700, color: 'var(--cyan)' }}>
                    {fmtBps(result.throughWinLimited)}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginTop: '0.25rem' }}>
                    L4: {fmtBps(result.throughL4)} &middot; L2 (Eth): {fmtBps(result.throughL2)}
                  </div>
                </div>

                <div className="result-grid">
                  <ResultItem label={t('tcp_throughput.bdp')} value={fmtBDPBytes(result.bdpBytes)} copy />
                  <ResultItem label={t('tcp_throughput.bdp_bits')} value={result.bdpBits.toLocaleString() + ' bits'} copy />
                  <ResultItem label={t('tcp_throughput.eff_win')} value={fmtBytes(result.effectiveWin)} copy />
                  <ResultItem label={t('tcp_throughput.max_win_scaled')} value={fmtBytes(result.maxWinRaw)} copy />
                  <ResultItem label={t('tcp_throughput.l3_overhead')} value={`${result.totalL3Overhead} ${t('tcp_throughput.bytes')} (${result.ipVer === 'v6' ? '40+20' : '20+20'} TCP+IP)`} />
                  <ResultItem label={t('tcp_throughput.efficiency_l4')} value={`${(result.efficiency * 100).toFixed(2)}%`} />
                  <ResultItem label={t('tcp_throughput.efficiency_l2')} value={`${(result.l2Efficiency * 100).toFixed(2)}%`} />
                </div>

                <div style={{ marginTop: '0.75rem', padding: '0.6rem 0.8rem', borderRadius: 'var(--radius, 8px)',
                  background: result.winSufficient ? 'rgba(0,200,100,0.08)' : 'rgba(255,80,80,0.08)',
                  border: `1px solid ${result.winSufficient ? 'rgba(0,200,100,0.25)' : 'rgba(255,80,80,0.25)'}`,
                  fontSize: '0.85rem'
                }}>
                  {result.winSufficient
                    ? t('tcp_throughput.win_sufficient')
                    : t('tcp_throughput.win_insufficient')}
                </div>

                {/* Window scaling comparison */}
                <h3 style={{ marginTop: '1.2rem' }}>{t('tcp_throughput.scale_compare')}</h3>
                <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border, #333)' }}>
                      <th style={{ textAlign: 'left', padding: '0.4rem' }}></th>
                      <th style={{ textAlign: 'right', padding: '0.4rem' }}>{t('tcp_throughput.no_scale')}</th>
                      <th style={{ textAlign: 'right', padding: '0.4rem' }}>{t('tcp_throughput.with_scale')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ borderBottom: '1px solid var(--border, #333)' }}>
                      <td style={{ padding: '0.4rem' }}>{t('tcp_throughput.max_win')}</td>
                      <td style={{ textAlign: 'right', padding: '0.4rem' }}>{fmtBytes(MAX_WIN16)}</td>
                      <td style={{ textAlign: 'right', padding: '0.4rem' }}>{fmtBytes(result.maxWinRaw)}</td>
                    </tr>
                    <tr style={{ borderBottom: '1px solid var(--border, #333)' }}>
                      <td style={{ padding: '0.4rem' }}>{t('tcp_throughput.throughput_l3')}</td>
                      <td style={{ textAlign: 'right', padding: '0.4rem' }}>{fmtBps(result.throughNoScale)}</td>
                      <td style={{ textAlign: 'right', padding: '0.4rem', color: 'var(--cyan)' }}>{fmtBps(result.throughWinLimited)}</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '0.4rem' }}>{t('tcp_throughput.throughput_l4')}</td>
                      <td style={{ textAlign: 'right', padding: '0.4rem' }}>{fmtBps(result.throughNoScaleL4)}</td>
                      <td style={{ textAlign: 'right', padding: '0.4rem', color: 'var(--cyan)' }}>{fmtBps(result.throughL4)}</td>
                    </tr>
                  </tbody>
                </table>
              </>
            )}
          </div>
        </div>

        {/* BDP Hero Cards and TCP Window Size vs. Throughput table */}
        {result && (
          <div className="card" style={{ marginTop: '1.5rem', borderTop: '1px solid var(--border, #333)', paddingTop: '1rem' }}>
            <h2 className="card-title">{t('tcp_throughput.window_vs_throughput_title')}</h2>
            
            {/* Hero Cards */}
            <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
              {[
                { label: t('tcp_throughput.bdp_hero_title'), value: fmtBDPBytes(result.bdpBytes), sub: result.bdpBitsFormatted, color: 'var(--cyan)' },
                { label: t('tcp_throughput.bdp_link_speed'), value: bwUnit === 'custom' ? fmtBps(parseFloat(customBw) || 0) : `${result.bwMbpsNum} Mbps`, sub: null, color: 'var(--text)' },
                { label: t('tcp_throughput.rtt'), value: `${rtt} ms`, sub: t('tcp_throughput.bdp_rtt_one_way', { n: (parseFloat(rtt) / 2).toFixed(1) }), color: 'var(--text)' },
              ].map(card => (
                <div key={card.label} style={{ flex: 1, minWidth: '150px', padding: '12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', color: 'var(--dim)', marginBottom: '4px' }}>{card.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: '16px', fontWeight: 700, color: card.color }}>{card.value}</div>
                  {card.sub && <div style={{ fontSize: '10px', color: 'var(--dim)', marginTop: '2px' }}>{card.sub}</div>}
                </div>
              ))}
            </div>

            <p style={{ color: 'var(--text2)', fontSize: '0.85rem', marginBottom: '0.75rem' }}>
              {t('tcp_throughput.window_vs_throughput_desc', { bdp: fmtBDPBytes(result.bdpBytes) })}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: 'var(--panel)', color: 'var(--muted)' }}>
                    <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontWeight: 600 }}>{t('tcp_throughput.col_window_size')}</th>
                    <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontWeight: 600 }}>{t('tcp_throughput.results')}</th>
                    <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontWeight: 600 }}>{t('tcp_throughput.col_pct_capacity')}</th>
                    <th style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', textAlign: 'left', fontWeight: 600 }}>{t('tcp_throughput.col_verdict')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.maxThroughputs.map((row, i) => {
                    const pct = row.efficiency;
                    const verdict = pct >= 99 ? t('tcp_throughput.verdict_saturation') : pct >= 50 ? t('tcp_throughput.verdict_partial') : t('tcp_throughput.verdict_bottleneck');
                    const verdictColor = pct >= 99 ? '#52c4a8' : pct >= 50 ? '#e0c452' : '#e05252';
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'var(--panel)' }}>
                        <td style={{ padding: '8px 12px', fontFamily: 'var(--mono)', fontWeight: 600, color: 'var(--text)' }}>{row.window}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--text)' }}>{fmtBps(row.throughput)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontFamily: 'var(--mono)', color: verdictColor }}>
                          {pct >= 100 ? '100' : pct.toFixed(1)}%
                        </td>
                        <td style={{ padding: '8px 12px', fontSize: '11px', color: verdictColor, fontWeight: 600 }}>{verdict}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* File Transfer Time estimation */}
        {result && (
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title">{t('tcp_throughput.transfer_time_title')}</h2>
            <p style={{ color: 'var(--text2)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('tcp_throughput.transfer_time_desc')}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border, #333)' }}>
                    <th style={{ textAlign: 'left', padding: '0.4rem' }}>{t('tcp_throughput.col_file_size')}</th>
                    <th style={{ textAlign: 'right', padding: '0.4rem' }}>{t('tcp_throughput.col_ideal_time')}</th>
                    <th style={{ textAlign: 'right', padding: '0.4rem' }}>{t('tcp_throughput.col_tcp_time')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.fileSizes.map(row => (
                    <tr key={row.label} style={{ borderBottom: '1px solid var(--border, #333)' }}>
                      <td style={{ padding: '0.4rem', fontWeight: 600 }}>{row.label}</td>
                      <td style={{ textAlign: 'right', padding: '0.4rem', fontFamily: 'var(--mono)' }}>{row.ideal}</td>
                      <td style={{ textAlign: 'right', padding: '0.4rem', fontFamily: 'var(--mono)', color: 'var(--cyan)', fontWeight: 600 }}>{row.tcp}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Congestion Window Analysis */}
        {result && (
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title">{t('tcp_throughput.cwnd_analysis')}</h2>
            <div className="two-col">
              <div className="result-grid">
                <ResultItem label={t('tcp_throughput.init_cwnd')} value={`${(result.initCwnd / result.mssVal).toFixed(0)} ${t('tcp_throughput.segments')} (${fmtBytes(result.initCwnd)})`} />
                <ResultItem label={t('tcp_throughput.ssthresh_after_loss')}
                  value={fmtBytes(result.ssthreshAfterLoss)} />
                {result.rttToFillWin !== null && (
                  <ResultItem label={t('tcp_throughput.rtts_to_fill')}
                    value={`${result.rttToFillWin} ${t('tcp_throughput.rtts')} (${result.timeToFillWin !== null ? result.timeToFillWin.toFixed(0) + ' ms' : '—'})`} />
                )}
              </div>
              <div>
                <div className="hint" style={{ marginBottom: '0.5rem' }}>
                  {t('tcp_throughput.cwnd_note')}
                </div>
                <div className="hint">
                  <RFCLink rfc={5681} /> &middot; <RFCLink rfc={6928} /> &middot; <RFCLink rfc={7323} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* RTT Impact Table */}
        {result && (
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title">{t('tcp_throughput.rtt_impact')}</h2>
            <p style={{ color: 'var(--text2)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              {t('tcp_throughput.rtt_impact_desc')}
            </p>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', fontSize: '0.85rem', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border, #333)' }}>
                    <th style={{ textAlign: 'left', padding: '0.4rem' }}>RTT</th>
                    <th style={{ textAlign: 'right', padding: '0.4rem' }}>{t('tcp_throughput.throughput_l3')}</th>
                    <th style={{ textAlign: 'right', padding: '0.4rem' }}>{t('tcp_throughput.throughput_l4')}</th>
                    <th style={{ textAlign: 'right', padding: '0.4rem' }}>% {t('tcp_throughput.of_link')}</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rttTable.map(row => {
                    const isCurrent = row.rtt === parseFloat(rtt);
                    const rowStyle = isCurrent
                      ? { background: 'rgba(0,200,255,0.08)', fontWeight: 600 }
                      : {};
                    return (
                      <tr key={row.rtt} style={{ borderBottom: '1px solid var(--border, #333)', ...rowStyle }}>
                        <td style={{ padding: '0.4rem' }}>{row.rtt} ms {isCurrent ? '←' : ''}</td>
                        <td style={{ textAlign: 'right', padding: '0.4rem' }}>{fmtBps(row.throughput)}</td>
                        <td style={{ textAlign: 'right', padding: '0.4rem' }}>{fmtBps(row.throughputL4)}</td>
                        <td style={{ textAlign: 'right', padding: '0.4rem' }}>
                          {result.bwBps > 0 ? (row.throughputL4 / result.bwBps * 100).toFixed(1) : 0}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Tuning recommendations */}
        {result && (
          <div className="card" style={{ marginTop: '1rem' }}>
            <h2 className="card-title">{t('tcp_throughput.tuning_title')}</h2>
            <div style={{ padding: 14, background: 'var(--panel)', borderLeft: '4px solid var(--cyan)', borderRadius: 4, marginBottom: 12 }}>
              <pre style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--text)', margin: 0, lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
{`${t('tcp_throughput.tuning_comment_set_buffers', { bdp: fmtBDPBytes(result.bdpBytes) })}
${t('tcp_throughput.tuning_comment_optimal')}
sysctl -w net.core.rmem_max=${Math.ceil(result.bdpBytes * 2)}
sysctl -w net.core.wmem_max=${Math.ceil(result.bdpBytes * 2)}
sysctl -w net.ipv4.tcp_rmem="4096 87380 ${Math.ceil(result.bdpBytes * 2)}"
sysctl -w net.ipv4.tcp_wmem="4096 65536 ${Math.ceil(result.bdpBytes * 2)}"
sysctl -w net.ipv4.tcp_window_scaling=1

${t('tcp_throughput.tuning_comment_congestion')}
sysctl -w net.ipv4.tcp_congestion_control=bbr

${t('tcp_throughput.tuning_comment_persist')}`}
              </pre>
              <div style={{ marginTop: '10px' }}>
                <CopyBtn text={`sysctl -w net.core.rmem_max=${Math.ceil(result.bdpBytes * 2)}\nsysctl -w net.core.wmem_max=${Math.ceil(result.bdpBytes * 2)}\nsysctl -w net.ipv4.tcp_rmem="4096 87380 ${Math.ceil(result.bdpBytes * 2)}"\nsysctl -w net.ipv4.tcp_wmem="4096 65536 ${Math.ceil(result.bdpBytes * 2)}"\nsysctl -w net.ipv4.tcp_window_scaling=1\nsysctl -w net.ipv4.tcp_congestion_control=bbr`} label={t('tcp_throughput.tuning_copy_label')} id="bdp-copy" />
              </div>
            </div>

            <div style={{ padding: 10, background: 'var(--panel)', borderLeft: '4px solid var(--muted)', borderRadius: 4, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              {t('tcp_throughput.bdp_formula_note', {
                bw: bwUnit === 'custom' ? fmtBps(parseFloat(customBw) || 0) : `${bwMbps} ${bwUnit}`,
                rtt: rtt,
                bdp: fmtBDPBytes(result.bdpBytes)
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

window.TCPThroughputEstimator = TCPThroughputEstimator;
