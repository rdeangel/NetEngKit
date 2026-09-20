const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ── Constants ──────────────────────────────────────────────────────
const ALGO_COLORS = {
  reno:   '#ff6b6b',
  cubic:  '#4ecdc4',
  bbr:    '#ffd93d',
};

const ALGO_IDS = ['reno', 'cubic', 'bbr'];

const BW_PRESETS = [
  { key: 'preset_10m', bw: 10 },
  { key: 'preset_100m', bw: 100 },
  { key: 'preset_1g', bw: 1000 },
  { key: 'preset_10g', bw: 10000 },
];

const TCP_RTT_PRESETS = [
  { key: 'preset_1ms', rtt: 1 },
  { key: 'preset_20ms', rtt: 20 },
  { key: 'preset_60ms', rtt: 60 },
  { key: 'preset_120ms', rtt: 120 },
  { key: 'preset_250ms', rtt: 250 },
];

const GRAPH_PAD = { top: 30, right: 30, bottom: 50, left: 70 };

// ── Simulation helpers ─────────────────────────────────────────────

function calcBDPsegments(bwMbps, rttMs, mss) {
  const bdpBytes = (bwMbps * 1e6 / 8) * (rttMs / 1000);
  return Math.ceil(bdpBytes / mss);
}

// Deterministic loss model: trigger loss every lossInterval segments
function shouldTriggerLoss(segmentsSentThisStep, cumulativeBefore, lossRate) {
  if (lossRate <= 0) return false;
  const lossInterval = Math.max(1, Math.round(100 / lossRate));
  const before = cumulativeBefore % lossInterval;
  const after = (cumulativeBefore + segmentsSentThisStep) % lossInterval;
  // Loss triggers if we cross a multiple of lossInterval
  const crossed = Math.floor((cumulativeBefore + segmentsSentThisStep) / lossInterval)
                - Math.floor(cumulativeBefore / lossInterval);
  return crossed > 0;
}

// ── TCP Reno simulation ────────────────────────────────────────────
function simulateReno(bwMbps, rttMs, mss, initCwnd, lossRate, maxTime) {
  const bdpSeg = calcBDPsegments(bwMbps, rttMs, mss);
  const rtt = rttMs / 1000;
  const points = [];
  let cwnd = initCwnd;
  let ssthresh = bdpSeg;
  let time = 0;
  let cumSegs = 0;
  let maxCwnd = cwnd;
  let fullUtilTime = null;
  let lossEvents = 0;

  // Add initial point
  points.push({ time, cwnd, ssthresh, event: null, phase: 'slow_start' });

  while (time < maxTime) {
    // Determine phase
    const phase = cwnd < ssthresh ? 'slow_start' : 'congestion_avoidance';

    // Check for loss
    const segsThisRTT = Math.round(cwnd);
    const loss = shouldTriggerLoss(segsThisRTT, cumSegs, lossRate);

    if (loss) {
      lossEvents++;
      // 3 dup ACKs: fast retransmit/recovery
      ssthresh = Math.max(Math.floor(cwnd / 2), 2);
      // ~75% of losses are triple dup ACK, 25% are timeouts
      const isTimeout = (lossEvents % 4 === 0);
      if (isTimeout) {
        ssthresh = Math.max(Math.floor(cwnd / 2), 2);
        cwnd = 1;
      } else {
        cwnd = ssthresh;
      }
      cumSegs += segsThisRTT;
      time += rtt;
      points.push({ time, cwnd, ssthresh, event: isTimeout ? 'timeout' : '3dupack', phase: isTimeout ? 'slow_start' : 'congestion_avoidance' });
      maxCwnd = Math.max(maxCwnd, cwnd);
      continue;
    }

    // Growth
    if (phase === 'slow_start') {
      cwnd = cwnd * 2;
    } else {
      cwnd = cwnd + 1; // ~1 segment per RTT in congestion avoidance
    }

    cumSegs += segsThisRTT;
    time += rtt;

    // Cap cwnd at something reasonable (2x BDP)
    cwnd = Math.min(cwnd, bdpSeg * 3);

    if (fullUtilTime === null && cwnd >= bdpSeg) {
      fullUtilTime = time;
    }

    maxCwnd = Math.max(maxCwnd, cwnd);
    points.push({ time, cwnd, ssthresh, event: null, phase: cwnd < ssthresh ? 'slow_start' : 'congestion_avoidance' });
  }

  return { points, fullUtilTime, maxCwnd, lossEvents, bdpSeg };
}

// ── TCP CUBIC simulation ───────────────────────────────────────────
function simulateCubic(bwMbps, rttMs, mss, initCwnd, lossRate, maxTime) {
  const bdpSeg = calcBDPsegments(bwMbps, rttMs, mss);
  const rtt = rttMs / 1000;
  const C = 0.4;
  const beta = 0.7;
  const points = [];
  let cwnd = initCwnd;
  let ssthresh = bdpSeg;
  let time = 0;
  let cumSegs = 0;
  let maxCwnd = cwnd;
  let fullUtilTime = null;
  let lossEvents = 0;

  // CUBIC state after first loss
  let Wmax = cwnd; // will be set on first loss
  let epochStart = 0;
  let originPoint = 0;
  let cubicActive = false;

  points.push({ time, cwnd, ssthresh, event: null, phase: 'slow_start' });

  while (time < maxTime) {
    const segsThisRTT = Math.round(cwnd);
    const loss = shouldTriggerLoss(segsThisRTT, cumSegs, lossRate);

    if (loss) {
      lossEvents++;
      Wmax = cwnd;
      const isTimeout = (lossEvents % 4 === 0);
      if (isTimeout) {
        ssthresh = Math.max(Math.floor(cwnd * beta), 2);
        cwnd = 1;
        cubicActive = false;
      } else {
        ssthresh = Math.max(Math.floor(cwnd * beta), 2);
        cwnd = ssthresh;
        epochStart = time;
        cubicActive = true;
      }
      cumSegs += segsThisRTT;
      time += rtt;
      points.push({ time, cwnd, ssthresh, event: isTimeout ? 'timeout' : '3dupack', phase: cubicActive ? 'congestion_avoidance' : 'slow_start' });
      maxCwnd = Math.max(maxCwnd, cwnd);
      continue;
    }

    if (!cubicActive && cwnd < ssthresh) {
      // Slow start (before CUBIC kicks in)
      cwnd = cwnd * 2;
      if (cwnd >= ssthresh) {
        cubicActive = true;
        epochStart = time;
        Wmax = cwnd;
      }
    } else {
      // CUBIC growth
      if (!cubicActive) {
        cubicActive = true;
        epochStart = time;
        Wmax = cwnd;
      }
      const t = time - epochStart;
      const K = Math.cbrt(Wmax * (1 - beta) / C);
      const Wcubic = C * Math.pow(t - K, 3) + Wmax;
      cwnd = Math.max(Wcubic, 1);
    }

    cumSegs += segsThisRTT;
    time += rtt;

    cwnd = Math.min(cwnd, bdpSeg * 3);
    if (fullUtilTime === null && cwnd >= bdpSeg) {
      fullUtilTime = time;
    }

    maxCwnd = Math.max(maxCwnd, cwnd);
    points.push({ time, cwnd, ssthresh, event: null, phase: 'congestion_avoidance' });
  }

  return { points, fullUtilTime, maxCwnd, lossEvents, bdpSeg };
}

// ── BBR simulation ─────────────────────────────────────────────────
function simulateBBR(bwMbps, rttMs, mss, initCwnd, lossRate, maxTime) {
  const bdpSeg = calcBDPsegments(bwMbps, rttMs, mss);
  const rtt = rttMs / 1000;
  const points = [];
  let time = 0;
  let inflight = initCwnd;
  let maxInflight = inflight;
  let fullUtilTime = null;
  let cumSegs = 0;
  let lossEvents = 0;

  // BBR phases
  let phase = 'startup';
  const startupGain = 2.89; // 2/ln(2)
  const drainGain = 1 / startupGain;
  const probeGains = [1.25, 0.75, 1, 1, 1, 1, 1, 1];
  let probeIdx = 0;
  let startupRTTs = 0;
  let phaseTimer = 0;
  let probeCycleCount = 0;
  const PROBE_BW_CYCLE = 8; // RTTs per ProbeBW cycle
  const PROBE_RTT_INTERVAL = 10; // seconds
  const PROBE_RTT_DURATION = 0.2; // 200ms
  let lastProbeRTT = 0;
  let estimatedBw = 0;

  points.push({ time, cwnd: inflight, event: null, phase });

  while (time < maxTime) {
    const segsThisRTT = Math.round(inflight);

    // BBR doesn't use loss as congestion signal, but loss still consumes retransmissions
    const loss = shouldTriggerLoss(segsThisRTT, cumSegs, lossRate);
    if (loss) lossEvents++;

    // BBR ProbeRTT check
    if (phase !== 'probe_rtt' && time - lastProbeRTT >= PROBE_RTT_INTERVAL && probeCycleCount > 0) {
      phase = 'probe_rtt';
      phaseTimer = PROBE_RTT_DURATION;
    }

    if (phase === 'startup') {
      inflight = inflight * startupGain;
      startupRTTs++;
      // Transition to drain when we've exceeded BDP
      if (inflight >= bdpSeg) {
        phase = 'drain';
        estimatedBw = bdpSeg / rtt; // segments/sec
        phaseTimer = 0;
      }
    } else if (phase === 'drain') {
      inflight = Math.max(bdpSeg, inflight * drainGain);
      phaseTimer += rtt;
      if (phaseTimer >= rtt * 2) {
        phase = 'probe_bw';
        probeIdx = 0;
        phaseTimer = 0;
      }
    } else if (phase === 'probe_bw') {
      const gain = probeGains[probeIdx % PROBE_BW_CYCLE];
      inflight = Math.max(Math.round(bdpSeg * gain), 4);
      probeIdx++;
      phaseTimer += rtt;
      if (probeIdx % PROBE_BW_CYCLE === 0) probeCycleCount++;
    } else if (phase === 'probe_rtt') {
      inflight = 4;
      phaseTimer -= rtt;
      if (phaseTimer <= 0) {
        phase = 'probe_bw';
        probeIdx = 0;
        lastProbeRTT = time;
        phaseTimer = 0;
      }
    }

    cumSegs += segsThisRTT;
    time += rtt;

    inflight = Math.min(inflight, bdpSeg * 3);

    if (fullUtilTime === null && inflight >= bdpSeg) {
      fullUtilTime = time;
    }

    maxInflight = Math.max(maxInflight, inflight);
    points.push({ time, cwnd: inflight, event: loss ? 'loss_ignored' : null, phase });
  }

  return { points, fullUtilTime, maxCwnd: maxInflight, lossEvents, bdpSeg };
}

// ── Canvas drawing ─────────────────────────────────────────────────
function drawGraph(canvas, simulations, bdpSeg, maxTime, axisLabels) {
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx.scale(dpr, dpr);

  const plotW = W - GRAPH_PAD.left - GRAPH_PAD.right;
  const plotH = H - GRAPH_PAD.top - GRAPH_PAD.bottom;

  // Determine Y max
  let yMax = bdpSeg * 1.3;
  simulations.forEach(sim => {
    if (!sim.data?.points) return;
    sim.data.points.forEach(p => {
      if (p.cwnd > yMax) yMax = p.cwnd;
    });
  });
  yMax = Math.ceil(yMax * 1.1);

  // Scale functions
  const xScale = (t) => GRAPH_PAD.left + (t / maxTime) * plotW;
  const yScale = (c) => GRAPH_PAD.top + plotH - (c / yMax) * plotH;

  // Clear
  ctx.fillStyle = '#0f0f18';
  ctx.fillRect(0, 0, W, H);

  // Grid
  ctx.strokeStyle = '#2a2a3a';
  ctx.lineWidth = 0.5;
  const xTicks = niceTickCount(maxTime);
  const xStep = maxTime / xTicks;
  for (let i = 0; i <= xTicks; i++) {
    const x = xScale(i * xStep);
    ctx.beginPath(); ctx.moveTo(x, GRAPH_PAD.top); ctx.lineTo(x, GRAPH_PAD.top + plotH); ctx.stroke();
    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'center';
    ctx.fillText((i * xStep).toFixed(1) + 's', x, GRAPH_PAD.top + plotH + 18);
  }

  const yTicks = niceTickCount(yMax);
  const yStep = yMax / yTicks;
  for (let i = 0; i <= yTicks; i++) {
    const y = yScale(i * yStep);
    ctx.beginPath(); ctx.moveTo(GRAPH_PAD.left, y); ctx.lineTo(GRAPH_PAD.left + plotW, y); ctx.stroke();
    ctx.fillStyle = '#888';
    ctx.font = '11px monospace';
    ctx.textAlign = 'right';
    ctx.fillText(Math.round(i * yStep), GRAPH_PAD.left - 8, y + 4);
  }

  // BDP line
  if (bdpSeg <= yMax) {
    const bdpY = yScale(bdpSeg);
    ctx.strokeStyle = '#00d4c855';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath(); ctx.moveTo(GRAPH_PAD.left, bdpY); ctx.lineTo(GRAPH_PAD.left + plotW, bdpY); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#00d4c8';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'left';
    ctx.fillText(axisLabels.bdpLabel.replace('{n}', bdpSeg), GRAPH_PAD.left + 4, bdpY - 5);
  }

  // Draw each algorithm trace
  simulations.forEach(sim => {
    if (!sim.enabled || !sim.data?.points?.length) return;
    const pts = sim.data.points;
    const color = ALGO_COLORS[sim.id];

    // Main line
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    pts.forEach((p, i) => {
      const x = xScale(p.time);
      const y = yScale(Math.min(p.cwnd, yMax));
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Loss event markers
    pts.forEach(p => {
      if (p.event && p.event !== 'loss_ignored') {
        const x = xScale(p.time);
        const y = yScale(Math.min(p.cwnd, yMax));
        ctx.fillStyle = p.event === 'timeout' ? '#ff4444' : '#ff8844';
        ctx.beginPath();
        // Draw X
        const s = 4;
        ctx.strokeStyle = p.event === 'timeout' ? '#ff4444' : '#ff8844';
        ctx.lineWidth = 2;
        ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s);
        ctx.stroke();
      }
    });
  });

  // Axis labels
  ctx.fillStyle = '#aaa';
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(axisLabels.time, GRAPH_PAD.left + plotW / 2, H - 5);
  ctx.save();
  ctx.translate(14, GRAPH_PAD.top + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(axisLabels.cwnd, 0, 0);
  ctx.restore();
}

function niceTickCount(max) {
  if (max <= 0) return 5;
  const rough = max / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const residual = rough / mag;
  if (residual <= 1.5) return Math.round(max / (1 * mag));
  if (residual <= 3.5) return Math.round(max / (2 * mag));
  if (residual <= 7.5) return Math.round(max / (5 * mag));
  return Math.round(max / (10 * mag));
}

// ── Sysctl generator ───────────────────────────────────────────────
function generateSysctl(bwMbps, rttMs, mss, algo) {
  const bdpBytes = Math.ceil((bwMbps * 1e6 / 8) * (rttMs / 1000));
  const rmemMax = Math.max(bdpBytes * 2, 6291456);
  const wmemMax = Math.max(bdpBytes * 2, 6291456);
  const lines = [
    '# TCP buffer sizing for ' + bwMbps + ' Mbps / ' + rttMs + ' ms RTT',
    '# BDP = ' + (bdpBytes / 1024).toFixed(0) + ' KB',
    'net.core.rmem_max = ' + rmemMax,
    'net.core.wmem_max = ' + wmemMax,
    'net.ipv4.tcp_rmem = 4096 87380 ' + rmemMax,
    'net.ipv4.tcp_wmem = 4096 65536 ' + wmemMax,
    '',
    '# Congestion control',
    'net.ipv4.tcp_congestion_control = ' + algo,
    'net.ipv4.tcp_allowed_congestion_control = ' + algo + ' reno cubic',
    '',
    '# TCP tuning',
    'net.ipv4.tcp_window_scaling = 1',
    'net.ipv4.tcp_timestamps = 1',
    'net.ipv4.tcp_sack = 1',
    '# net.ipv4.tcp_fack = 1         # Removed in Linux 4.15',
    '# net.ipv4.tcp_low_latency = 0  # Removed in Linux 4.14',
    'net.ipv4.tcp_slow_start_after_idle = 0',
    'net.ipv4.tcp_mtu_probing = 1',
  ];
  if (rttMs > 100) {
    lines.push('');
    lines.push('# High-latency path tuning');
    lines.push('net.ipv4.tcp_keepalive_time = 60');
    lines.push('net.ipv4.tcp_keepalive_intvl = 10');
    lines.push('net.ipv4.tcp_keepalive_probes = 6');
    lines.push('net.ipv4.tcp_retries2 = 8');
  }
  return lines.join('\n');
}

// ── Component ──────────────────────────────────────────────────────
function TCPCongestion({ initialData, onShare }) {
  const { t } = useTranslation();

  const canvasRef = useRef(null);

  // State
  const [bwMbps, setBwMbps]       = usePersistentState('tcp:bwMbps', initialData?.bw ?? 100);
  const [rttMs, setRttMs]         = usePersistentState('tcp:rttMs', initialData?.rtt ?? 60);
  const [mss, setMss]             = usePersistentState('tcp:mss', initialData?.mss ?? 1460);
  const [initCwnd, setInitCwnd]   = usePersistentState('tcp:initCwnd', initialData?.initCwnd ?? 10);
  const [lossRate, setLossRate]   = usePersistentState('tcp:lossRate', initialData?.loss ?? 0.5);
  const [maxTime, setMaxTime]     = usePersistentState('tcp:maxTime', initialData?.maxTime ?? 10);
  const [algoSelect, setAlgoSelect] = usePersistentState('tcp:algoSelect', initialData?.algos ?? { reno: true, cubic: true, bbr: false });

  // Share URL
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'tcp-congestion', bw: bwMbps, rtt: rttMs, mss, initCwnd, loss: lossRate, maxTime, algos: algoSelect });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [bwMbps, rttMs, mss, initCwnd, lossRate, maxTime, algoSelect, onShare]);

  // Run simulations
  const bdpSeg = useMemo(() => calcBDPsegments(bwMbps, rttMs, mss), [bwMbps, rttMs, mss]);
  const bdpBytes = useMemo(() => (bwMbps * 1e6 / 8) * (rttMs / 1000), [bwMbps, rttMs]);

  const simulations = useMemo(() => {
    const params = [bwMbps, rttMs, mss, initCwnd, lossRate, maxTime];
    const result = {};
    if (algoSelect.reno)   result.reno   = simulateReno(...params);
    if (algoSelect.cubic)  result.cubic  = simulateCubic(...params);
    if (algoSelect.bbr)    result.bbr    = simulateBBR(...params);
    return result;
  }, [bwMbps, rttMs, mss, initCwnd, lossRate, maxTime, algoSelect]);

  const simList = useMemo(() => [
    { id: 'reno', enabled: !!algoSelect.reno, data: simulations.reno },
    { id: 'cubic', enabled: !!algoSelect.cubic, data: simulations.cubic },
    { id: 'bbr', enabled: !!algoSelect.bbr, data: simulations.bbr },
  ], [algoSelect, simulations]);

  // Draw canvas
  useEffect(() => {
    if (!canvasRef.current) return;
    drawGraph(canvasRef.current, simList, bdpSeg, maxTime, {
      time: t('tcp_congestion.axis_time'),
      cwnd: t('tcp_congestion.axis_cwnd'),
      bdpLabel: t('tcp_congestion.bdp_line_label'),
    });
  }, [simList, bdpSeg, maxTime]);

  // Sysctl output
  const [sysctlAlgo, setSysctlAlgo] = usePersistentState('tcp:sysctlAlgo', 'cubic');
  const sysctlOutput = useMemo(() => generateSysctl(bwMbps, rttMs, mss, sysctlAlgo), [bwMbps, rttMs, mss, sysctlAlgo]);

  const toggleAlgo = (id) => {
    setAlgoSelect(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const algoLabel = (id) => {
    const labels = { reno: t('tcp_congestion.algo_reno'), cubic: t('tcp_congestion.algo_cubic'), bbr: t('tcp_congestion.algo_bbr') };
    return labels[id] || id;
  };

  const phaseLabel = (phase) => {
    const map = {
      slow_start: t('tcp_congestion.phase_slow_start'),
      congestion_avoidance: t('tcp_congestion.phase_ca'),
      fast_recovery: t('tcp_congestion.phase_fast_recovery'),
      startup: t('tcp_congestion.phase_startup'),
      drain: t('tcp_congestion.phase_drain'),
      probe_bw: t('tcp_congestion.phase_probe_bw'),
      probe_rtt: t('tcp_congestion.phase_probe_rtt'),
    };
    return map[phase] || phase;
  };

  const formatBytes = (b) => {
    if (b < 1024) return b.toFixed(0) + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1048576).toFixed(2) + ' MB';
  };

  const formatTime = (s) => {
    if (s === null || s === undefined) return '--';
    if (s < 1) return (s * 1000).toFixed(0) + ' ms';
    return s.toFixed(2) + ' s';
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('tcp_congestion.title')}</div>
        <div className="hint" style={{marginBottom: '12px'}}>{t('tcp_congestion.subtitle')}</div>

        {/* ── Inputs ── */}
        <div className="three-col">
          <div className="field">
            <label className="label">{t('tcp_congestion.bandwidth')}</label>
            <div style={{display: 'flex', gap: '6px'}}>
              <input className="input" type="number" min="0.1" step="1" value={bwMbps}
                onChange={e => setBwMbps(Math.max(0.1, +e.target.value))} />
              <span style={{alignSelf: 'center', color: '#888'}}>{t('tcp_congestion.unit_mbps')}</span>
            </div>
            <div style={{display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px'}}>
              {BW_PRESETS.map(p => (
                <button key={p.key} className="btn btn-sm" onClick={() => setBwMbps(p.bw)}>{t('tcp_congestion.' + p.key)}</button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="label">{t('tcp_congestion.rtt')}</label>
            <div style={{display: 'flex', gap: '6px'}}>
              <input className="input" type="number" min="0.1" step="1" value={rttMs}
                onChange={e => setRttMs(Math.max(0.1, +e.target.value))} />
              <span style={{alignSelf: 'center', color: '#888'}}>{t('tcp_congestion.unit_ms')}</span>
            </div>
            <div style={{display: 'flex', gap: '4px', flexWrap: 'wrap', marginTop: '4px'}}>
              {TCP_RTT_PRESETS.map(p => (
                <button key={p.key} className="btn btn-sm" onClick={() => setRttMs(p.rtt)}>{t('tcp_congestion.' + p.key)}</button>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="label">{t('tcp_congestion.mss')}</label>
            <input className="input" type="number" min="536" step="1" value={mss}
              onChange={e => setMss(Math.max(536, +e.target.value))} />
            <div className="hint">{t('tcp_congestion.mss_hint')}</div>
          </div>
        </div>

        <div className="three-col" style={{marginTop: '8px'}}>
          <div className="field">
            <label className="label">{t('tcp_congestion.init_cwnd')}</label>
            <input className="input" type="number" min="1" step="1" value={initCwnd}
              onChange={e => setInitCwnd(Math.max(1, Math.round(+e.target.value)))} />
            <div className="hint">{t('tcp_congestion.init_cwnd_hint')}</div>
          </div>

          <div className="field">
            <label className="label">{t('tcp_congestion.loss_rate')}</label>
            <div style={{display: 'flex', gap: '6px'}}>
              <input className="input" type="number" min="0" max="50" step="0.1" value={lossRate}
                onChange={e => setLossRate(Math.max(0, Math.min(50, +e.target.value)))} />
              <span style={{alignSelf: 'center', color: '#888'}}>{t('tcp_congestion.unit_pct')}</span>
            </div>
            <div className="hint">{t('tcp_congestion.loss_rate_hint')}</div>
          </div>

          <div className="field">
            <label className="label">{t('tcp_congestion.sim_duration')}</label>
            <div style={{display: 'flex', gap: '6px'}}>
              <input className="input" type="number" min="1" max="300" step="1" value={maxTime}
                onChange={e => setMaxTime(Math.max(1, Math.min(300, +e.target.value)))} />
              <span style={{alignSelf: 'center', color: '#888'}}>{t('tcp_congestion.unit_s')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── BDP Reference ── */}
      <div className="card">
        <div className="card-title">{t('tcp_congestion.bdp_ref')}</div>
        <div className="result-grid" style={{gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))'}}>
          <ResultItem label={t('tcp_congestion.bdp_bytes')} value={formatBytes(bdpBytes)} />
          <ResultItem label={t('tcp_congestion.bdp_segs')} value={t('tcp_congestion.val_segments', { n: bdpSeg })} />
          <ResultItem label={t('tcp_congestion.bw_label')} value={t('tcp_congestion.val_mbps', { n: bwMbps })} />
          <ResultItem label={t('tcp_congestion.rtt_label')} value={t('tcp_congestion.val_ms', { n: rttMs })} />
        </div>
      </div>

      {/* ── Algorithm Selection ── */}
      <div className="card">
        <div className="card-title">{t('tcp_congestion.algo_select')}</div>
        <div style={{display: 'flex', gap: '8px', flexWrap: 'wrap'}}>
          {ALGO_IDS.map(id => (
            <button key={id}
              className={'btn ' + (algoSelect[id] ? 'btn-primary' : 'btn-ghost')}
              style={algoSelect[id] ? {background: ALGO_COLORS[id] + '33', borderColor: ALGO_COLORS[id], color: ALGO_COLORS[id]} : {}}
              onClick={() => toggleAlgo(id)}>
              <span style={{display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: ALGO_COLORS[id], marginRight: '6px', verticalAlign: 'middle'}}></span>
              {algoLabel(id)}
            </button>
          ))}
        </div>
        <div className="hint" style={{marginTop: '6px'}}>{t('tcp_congestion.algo_select_hint')}</div>
      </div>

      {/* ── Graph ── */}
      <div className="card">
        <div className="card-title">{t('tcp_congestion.graph_title')}</div>
        <div style={{position: 'relative', width: '100%'}}>
          <canvas ref={canvasRef} style={{width: '100%', height: '380px', borderRadius: '6px', border: '1px solid #2a2a3a'}} />
        </div>
        <div style={{display: 'flex', gap: '16px', marginTop: '8px', flexWrap: 'wrap'}}>
          {ALGO_IDS.filter(id => algoSelect[id]).map(id => (
            <div key={id} style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
              <span style={{display: 'inline-block', width: '20px', height: '3px', background: ALGO_COLORS[id], borderRadius: '2px'}}></span>
              <span style={{color: ALGO_COLORS[id], fontSize: '12px'}}>{algoLabel(id)}</span>
            </div>
          ))}
          <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
            <span style={{display: 'inline-block', width: '20px', height: '3px', background: '#00d4c8', borderRadius: '2px', opacity: 0.5, borderTop: '2px dashed #00d4c8'}}></span>
            <span style={{color: '#00d4c8', fontSize: '12px'}}>BDP</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
            <span style={{color: '#ff8844', fontSize: '12px'}}>X</span>
            <span style={{color: '#888', fontSize: '12px'}}>{t('tcp_congestion.legend_3dupack')}</span>
          </div>
          <div style={{display: 'flex', alignItems: 'center', gap: '4px'}}>
            <span style={{color: '#ff4444', fontSize: '12px'}}>X</span>
            <span style={{color: '#888', fontSize: '12px'}}>{t('tcp_congestion.legend_timeout')}</span>
          </div>
        </div>
      </div>

      {/* ── Comparison Table ── */}
      {Object.keys(simulations).length > 0 && (
        <div className="card">
          <div className="card-title">{t('tcp_congestion.comparison_title')}</div>
          <div style={{overflowX: 'auto'}}>
            <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '13px'}}>
              <thead>
                <tr style={{borderBottom: '1px solid #2a2a3a'}}>
                  <th style={{textAlign: 'left', padding: '8px 12px', color: '#888'}}>{t('tcp_congestion.col_metric')}</th>
                  {ALGO_IDS.filter(id => simulations[id]).map(id => (
                    <th key={id} style={{textAlign: 'center', padding: '8px 12px', color: ALGO_COLORS[id]}}>{algoLabel(id)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr style={{borderBottom: '1px solid #1e1e28'}}>
                  <td style={{padding: '8px 12px', color: '#ccc'}}>{t('tcp_congestion.metric_full_util')}</td>
                  {ALGO_IDS.filter(id => simulations[id]).map(id => (
                    <td key={id} style={{textAlign: 'center', padding: '8px 12px', color: '#fff'}}>
                      {formatTime(simulations[id]?.fullUtilTime)}
                    </td>
                  ))}
                </tr>
                <tr style={{borderBottom: '1px solid #1e1e28'}}>
                  <td style={{padding: '8px 12px', color: '#ccc'}}>{t('tcp_congestion.metric_max_cwnd')}</td>
                  {ALGO_IDS.filter(id => simulations[id]).map(id => (
                    <td key={id} style={{textAlign: 'center', padding: '8px 12px', color: '#fff'}}>
                      {t('tcp_congestion.val_seg', { n: simulations[id]?.maxCwnd })}
                    </td>
                  ))}
                </tr>
                <tr style={{borderBottom: '1px solid #1e1e28'}}>
                  <td style={{padding: '8px 12px', color: '#ccc'}}>{t('tcp_congestion.metric_loss_events')}</td>
                  {ALGO_IDS.filter(id => simulations[id]).map(id => (
                    <td key={id} style={{textAlign: 'center', padding: '8px 12px', color: '#fff'}}>
                      {simulations[id]?.lossEvents}
                    </td>
                  ))}
                </tr>
                <tr style={{borderBottom: '1px solid #1e1e28'}}>
                  <td style={{padding: '8px 12px', color: '#ccc'}}>{t('tcp_congestion.metric_strategy')}</td>
                  {ALGO_IDS.filter(id => simulations[id]).map(id => (
                    <td key={id} style={{textAlign: 'center', padding: '8px 12px', color: '#fff', fontSize: '12px'}}>
                      {id === 'reno' ? t('tcp_congestion.strat_reno') : id === 'cubic' ? t('tcp_congestion.strat_cubic') : t('tcp_congestion.strat_bbr')}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td style={{padding: '8px 12px', color: '#ccc'}}>{t('tcp_congestion.metric_loss_response')}</td>
                  {ALGO_IDS.filter(id => simulations[id]).map(id => (
                    <td key={id} style={{textAlign: 'center', padding: '8px 12px', color: '#fff', fontSize: '12px'}}>
                      {id === 'reno' ? t('tcp_congestion.loss_resp_reno') : id === 'cubic' ? t('tcp_congestion.loss_resp_cubic') : t('tcp_congestion.loss_resp_bbr')}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Loss Impact ── */}
      {lossRate > 0 && Object.keys(simulations).length > 0 && (
        <div className="card">
          <div className="card-title">{t('tcp_congestion.loss_impact_title')}</div>
          <div className="hint" style={{marginBottom: '8px'}}>{t('tcp_congestion.loss_impact_hint')}</div>
          <div style={{overflowX: 'auto'}}>
            <table style={{width: '100%', borderCollapse: 'collapse', fontSize: '13px'}}>
              <thead>
                <tr style={{borderBottom: '1px solid #2a2a3a'}}>
                  <th style={{textAlign: 'left', padding: '8px 12px', color: '#888'}}>{t('tcp_congestion.col_algo')}</th>
                  <th style={{textAlign: 'center', padding: '8px 12px', color: '#888'}}>{t('tcp_congestion.col_losses')}</th>
                  <th style={{textAlign: 'center', padding: '8px 12px', color: '#888'}}>{t('tcp_congestion.col_recovery')}</th>
                  <th style={{textAlign: 'center', padding: '8px 12px', color: '#888'}}>{t('tcp_congestion.col_notes')}</th>
                </tr>
              </thead>
              <tbody>
                {ALGO_IDS.filter(id => simulations[id]).map(id => {
                  const sim = simulations[id];
                  const losses = sim?.lossEvents || 0;
                  return (
                    <tr key={id} style={{borderBottom: '1px solid #1e1e28'}}>
                      <td style={{padding: '8px 12px', color: ALGO_COLORS[id], fontWeight: 'bold'}}>{algoLabel(id)}</td>
                      <td style={{textAlign: 'center', padding: '8px 12px', color: '#fff'}}>{losses}</td>
                      <td style={{textAlign: 'center', padding: '8px 12px', color: '#fff', fontSize: '12px'}}>
                        {id === 'reno' ? t('tcp_congestion.recovery_reno') : id === 'cubic' ? t('tcp_congestion.recovery_cubic') : t('tcp_congestion.recovery_bbr')}
                      </td>
                      <td style={{textAlign: 'center', padding: '8px 12px', color: '#aaa', fontSize: '12px'}}>
                        {id === 'reno' ? t('tcp_congestion.notes_reno') : id === 'cubic' ? t('tcp_congestion.notes_cubic') : t('tcp_congestion.notes_bbr')}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Sysctl Generator ── */}
      <div className="card">
        <div className="card-title">{t('tcp_congestion.sysctl_title')}</div>
        <div className="hint" style={{marginBottom: '8px'}}>{t('tcp_congestion.sysctl_subtitle')}</div>
        <div className="field" style={{marginBottom: '8px'}}>
          <label className="label">{t('tcp_congestion.sysctl_algo')}</label>
          <select className="select" value={sysctlAlgo} onChange={e => setSysctlAlgo(e.target.value)}>
            <option value="reno">{t('tcp_congestion.algo_reno')}</option>
            <option value="cubic">{t('tcp_congestion.algo_cubic')}</option>
            <option value="bbr">{t('tcp_congestion.algo_bbr')}</option>
          </select>
        </div>
        <div>
          <pre style={{background: '#0a0a14', padding: '12px', borderRadius: '6px', fontSize: '12px', color: '#c0c0c0', overflow: 'auto', maxHeight: '340px', border: '1px solid #2a2a3a', margin: 0}}>
            {sysctlOutput}
          </pre>
          <CopyBtn text={sysctlOutput} />
        </div>
        <div className="hint" style={{marginTop: '6px'}}>{t('tcp_congestion.sysctl_apply_hint')}</div>
      </div>

      {/* ── Reference ── */}
      <div className="card">
        <div className="card-title">{t('tcp_congestion.ref_title')}</div>
        <div style={{fontSize: '13px', lineHeight: '1.7'}}>
          <div style={{marginBottom: '12px'}}>
            <strong style={{color: ALGO_COLORS.reno}}>{t('tcp_congestion.algo_reno')}</strong>
            <div style={{color: '#aaa', marginTop: '4px'}}>{t('tcp_congestion.ref_reno_desc')}</div>
          </div>
          <div style={{marginBottom: '12px'}}>
            <strong style={{color: ALGO_COLORS.cubic}}>{t('tcp_congestion.algo_cubic')}</strong>
            <div style={{color: '#aaa', marginTop: '4px'}}>{t('tcp_congestion.ref_cubic_desc')}</div>
          </div>
          <div>
            <strong style={{color: ALGO_COLORS.bbr}}>{t('tcp_congestion.algo_bbr')}</strong>
            <div style={{color: '#aaa', marginTop: '4px'}}>{t('tcp_congestion.ref_bbr_desc')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.TCPCongestion = TCPCongestion;
