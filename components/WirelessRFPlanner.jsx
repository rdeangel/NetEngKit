const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ═══════════════════════════════════════════════════════════════════════════
//  RF ENGINE — pure helper functions shared by every tab. No React in here.
//  Single source of truth for rates (MCS_RATES), channels (CH_*), and the
//  path-loss / airtime / SNR→MCS math. All distances in metres, freqs in MHz
//  unless a name says otherwise.
// ═══════════════════════════════════════════════════════════════════════════
const RF = (() => {
  const log10 = (x) => Math.log10(x);

  // — Power conversions —
  const dbmToMw = (dbm) => Math.pow(10, dbm / 10);
  const mwToDbm = (mw) => 10 * log10(mw);

  // — Free-space path loss (dB). 20log10(d_m)+20log10(f_MHz)−27.55
  //   (equivalently +32.45 with distance in km). —
  const fspl = (dM, fMHz) => 20 * log10(dM) + 20 * log10(fMHz) - 27.55;

  // — EIRP (dBm) —
  const eirp = (txDbm, antGainDbi, cableLossDb = 0) => txDbm + antGainDbi - cableLossDb;

  // — Log-distance (Rappaport) coverage model —
  //   d0 = 1 m, PL(d0) = fspl(1,f) = 20log10(f)−27.55.
  //   Pr(d) = Ptx + Gtx − [PL(d0) + 10·n·log10(d)].
  //   We require Pr ≥ targetRssi + fadeMarginDb at the cell edge — the fade margin
  //   covers log-normal shadowing / spatial RSSI variance and is standard coverage
  //   planning (without it the modelled cell is unrealistically large).
  //   Solve Pr = targetRssi + fadeMarginDb:
  //     d = 10^((Ptx+Gtx−PL(d0)−(targetRssi+fadeMarginDb))/(10n)).
  const cellRadius = ({ txDbm, antGainDbi, targetRssi, n, fMHz, fadeMarginDb = 0 }) => {
    const plD0 = 20 * log10(fMHz) - 27.55;
    const exp = (txDbm + antGainDbi - plD0 - (targetRssi + fadeMarginDb)) / (10 * n);
    return Math.pow(10, exp);
  };

  // — Inverse: distance at which a given total path loss is reached —
  const distanceFromPathLoss = ({ pathLossDb, n, fMHz }) => {
    const plD0 = 20 * log10(fMHz) - 27.55;
    return Math.pow(10, (pathLossDb - plD0) / (10 * n));
  };

  // — First Fresnel zone radius at the link midpoint (m). F1 = 8.657·√(d_km/f_GHz);
  //   higher zones scale by √(zone). —
  const fresnelRadius = (dM, fMHz, zone = 1) =>
    8.657 * Math.sqrt((dM / 1000) / (fMHz / 1000)) * Math.sqrt(zone);

  // Path-loss exponent n by environment (ITU-R P.1238 / Rappaport log-distance).
  // Free space is n=2.0; indoor clutter raises it. ITU distance-power-loss
  // coefficient N ≈ 10·n (5 GHz): commercial ~22, office ~31, residential ~28.
  const PATH_LOSS_N = {
    open: 2.2,      // open-plan / warehouse floor, near line-of-sight (ITU commercial ~2.2)
    drywall: 3.0,   // cubicles, drywall/glass partition offices (ITU office ~3.1)
    dense: 3.5,     // brick/concrete interior walls, hospitals
    warehouse: 3.3, // high-rack warehouse: open volume but metal racking scatter
  };

  // Minimum SNR (dB) to sustain each 802.11ax MCS. Approximate receiver
  // requirements (typical Cisco/Aruba design-guide values; vary by chipset).
  const MIN_SNR = [
    { mcs: 0, snr: 5, mod: 'BPSK 1/2' }, { mcs: 1, snr: 8, mod: 'QPSK 1/2' },
    { mcs: 2, snr: 10, mod: 'QPSK 3/4' }, { mcs: 3, snr: 13, mod: '16-QAM 1/2' },
    { mcs: 4, snr: 16, mod: '16-QAM 3/4' }, { mcs: 5, snr: 19, mod: '64-QAM 2/3' },
    { mcs: 6, snr: 21, mod: '64-QAM 3/4' }, { mcs: 7, snr: 25, mod: '64-QAM 5/6' },
    { mcs: 8, snr: 29, mod: '256-QAM 3/4' }, { mcs: 9, snr: 31, mod: '256-QAM 5/6' },
    { mcs: 10, snr: 34, mod: '1024-QAM 3/4' }, { mcs: 11, snr: 37, mod: '1024-QAM 5/6' },
  ];

  // Highest MCS whose minimum-SNR threshold is satisfied; null below MCS 0.
  const mcsForSnr = (snrDb) => {
    let best = null;
    for (const e of MIN_SNR) if (snrDb >= e.snr) best = e;
    return best;
  };

  // — 802.11n/ac/ax per-spatial-stream PHY rates (Mbps) by channel width —
  const MCS_RATES = {
    'HT-0': { 20: 6.5, 40: 13.5 }, 'HT-1': { 20: 13, 40: 27 }, 'HT-2': { 20: 19.5, 40: 40.5 }, 'HT-3': { 20: 26, 40: 54 },
    'HT-4': { 20: 39, 40: 81 }, 'HT-5': { 20: 52, 40: 108 }, 'HT-6': { 20: 58.5, 40: 121.5 }, 'HT-7': { 20: 65, 40: 135 },
    'VHT-0': { 20: 6.5, 40: 13.5, 80: 29.3 }, 'VHT-1': { 20: 13, 40: 27, 80: 58.5 }, 'VHT-2': { 20: 19.5, 40: 40.5, 80: 87.8 },
    'VHT-3': { 20: 26, 40: 54, 80: 117 }, 'VHT-4': { 20: 39, 40: 81, 80: 175.5 }, 'VHT-5': { 20: 52, 40: 108, 80: 234 },
    'VHT-6': { 20: 58.5, 40: 121.5, 80: 263.3 }, 'VHT-7': { 20: 65, 40: 135, 80: 292.5 }, 'VHT-8': { 20: 78, 40: 162, 80: 351 },
    'VHT-9': { 20: null, 40: 180, 80: 390 },
    'HE-0': { 20: 8.6, 40: 17.2, 80: 36.0, 160: 72.1 }, 'HE-1': { 20: 17.2, 40: 34.4, 80: 72.1, 160: 144.1 },
    'HE-2': { 20: 25.8, 40: 51.6, 80: 108.1, 160: 216.2 }, 'HE-3': { 20: 34.4, 40: 68.8, 80: 144.1, 160: 288.2 },
    'HE-4': { 20: 51.6, 40: 103.2, 80: 216.2, 160: 432.4 }, 'HE-5': { 20: 68.8, 40: 137.6, 80: 288.2, 160: 576.5 },
    'HE-6': { 20: 77.4, 40: 154.9, 80: 324.3, 160: 648.5 }, 'HE-7': { 20: 86.0, 40: 172.1, 80: 360.3, 160: 720.6 },
    'HE-8': { 20: 103.2, 40: 206.5, 80: 432.4, 160: 864.7 }, 'HE-9': { 20: 114.7, 40: 229.4, 80: 480.4, 160: 960.8 },
    'HE-10': { 20: 129.0, 40: 258.1, 80: 540.4, 160: 1080.9 }, 'HE-11': { 20: 143.4, 40: 286.8, 80: 600.5, 160: 1201.0 },
  };

  // — Airtime / capacity model (A-MPDU aggregation within a ~4 ms TXOP) —
  const airtime = ({ clients, tputMbps, mcsKey, bw, ss, mgmtOverhead }) => {
    const mcsEntry = MCS_RATES[mcsKey];
    if (!mcsEntry) return null;
    const base = mcsEntry[bw];
    if (base === null || base === undefined) return null;
    const rawRate = base * ss;
    if (!rawRate) return null;

    const MPDU_PAYLOAD = 1500, MPDU_AIR_BYTES = 1536, TXOP_US = 4000, AMPDU_OVERHEAD_US = 150;
    const AGG_CAP = { HT: 42, VHT: 64, HE: 256 };
    const proto = mcsKey.startsWith('HT') ? 'HT' : mcsKey.startsWith('VHT') ? 'VHT' : 'HE';
    const mpduAirUs = (MPDU_AIR_BYTES * 8) / rawRate;
    const agg = Math.max(1, Math.min(AGG_CAP[proto] || 64, Math.floor(TXOP_US / mpduAirUs)));
    const ampduTotalUs = agg * mpduAirUs + AMPDU_OVERHEAD_US;
    const effectiveRate = (agg * MPDU_PAYLOAD * 8) / ampduTotalUs;
    const framesPerSec = (tputMbps * 1e6) / (MPDU_PAYLOAD * 8);
    const airtimePerClientUs = (framesPerSec / agg) * ampduTotalUs;
    const airtimeFrac = airtimePerClientUs / 1e6;
    const usable = 1 - (mgmtOverhead / 100);
    return {
      rawRate: Math.round(rawRate * 10) / 10,
      effectiveRate: Math.round(effectiveRate),
      airtimePerClientPct: Math.min(100, Math.round(airtimeFrac * 1000) / 10),
      totalUsedPct: Math.min(100, Math.round(airtimeFrac * clients * 100)),
      usablePct: Math.round(usable * 100),
      maxClients: airtimeFrac > 0 ? Math.floor(usable / airtimeFrac) : 0,
    };
  };

  // — Channel / DFS / UNII data —
  const CH_5 = [
    { ch: 36, freq: 5180, band: 'UNII-1' }, { ch: 40, freq: 5200, band: 'UNII-1' },
    { ch: 44, freq: 5220, band: 'UNII-1' }, { ch: 48, freq: 5240, band: 'UNII-1' },
    { ch: 52, freq: 5260, band: 'UNII-2A', dfs: true }, { ch: 56, freq: 5280, band: 'UNII-2A', dfs: true },
    { ch: 60, freq: 5300, band: 'UNII-2A', dfs: true }, { ch: 64, freq: 5320, band: 'UNII-2A', dfs: true },
    { ch: 100, freq: 5500, band: 'UNII-2C', dfs: true }, { ch: 104, freq: 5520, band: 'UNII-2C', dfs: true },
    { ch: 108, freq: 5540, band: 'UNII-2C', dfs: true }, { ch: 112, freq: 5560, band: 'UNII-2C', dfs: true },
    { ch: 116, freq: 5580, band: 'UNII-2C', dfs: true }, { ch: 120, freq: 5600, band: 'UNII-2C', dfs: true },
    { ch: 124, freq: 5620, band: 'UNII-2C', dfs: true }, { ch: 128, freq: 5640, band: 'UNII-2C', dfs: true },
    { ch: 132, freq: 5660, band: 'UNII-2C', dfs: true }, { ch: 136, freq: 5680, band: 'UNII-2C', dfs: true },
    { ch: 140, freq: 5700, band: 'UNII-2C', dfs: true }, { ch: 144, freq: 5720, band: 'UNII-2C', dfs: true },
    { ch: 149, freq: 5745, band: 'UNII-3' }, { ch: 153, freq: 5765, band: 'UNII-3' },
    { ch: 157, freq: 5785, band: 'UNII-3' }, { ch: 161, freq: 5805, band: 'UNII-3' },
    { ch: 165, freq: 5825, band: 'UNII-3' },
  ];
  // 2.4 GHz channels 1–13 (center = 2412 + 5·(ch−1)).
  const CH_24 = Array.from({ length: 13 }, (_, i) => ({ ch: i + 1, freq: 2412 + 5 * i, band: 'ISM' }));
  // 6 GHz 20 MHz channels 1,5,9,… (center = 5950 + 5·ch). PSC = every 16 ch from ch 5.
  const CH_6 = Array.from({ length: 59 }, (_, i) => {
    const ch = 1 + i * 4;
    const unii = ch <= 93 ? 'UNII-5' : ch <= 117 ? 'UNII-6' : ch <= 185 ? 'UNII-7' : 'UNII-8';
    return { ch, freq: 5950 + 5 * ch, band: unii, psc: ((ch - 5) % 16 === 0) };
  });

  // Non-overlapping 20 MHz channel lists used for auto channel planning.
  const PREFERRED_24 = [1, 6, 11];
  const PREFERRED_5_NODFS = [36, 40, 44, 48, 149, 153, 157, 161, 165];
  const PSC_6 = CH_6.filter((c) => c.psc).map((c) => c.ch);

  // Look up a channel record by channel number or center frequency across all bands.
  const findChannel = (input) => {
    const v = parseFloat(input);
    if (!isFinite(v)) return null;
    const all = [...CH_24, ...CH_5, ...CH_6];
    // Treat large values as a frequency (MHz), small as a channel number.
    if (v >= 2400) {
      return all.reduce((best, c) => (Math.abs(c.freq - v) < Math.abs((best?.freq ?? Infinity) - v) ? c : best), null);
    }
    return all.find((c) => c.ch === v) || null;
  };

  // Auto-assign a non-overlapping channel set for `apCount` APs on a band/width.
  // Returns { channels, available, coChannel, reuseGroups }.
  const assignChannelPlan = (apCount, band, width, avoidDFS = true) => {
    let list;
    if (band === '2.4') list = PREFERRED_24;
    else if (band === '6') list = PSC_6;
    else list = avoidDFS ? PREFERRED_5_NODFS : CH_5.map((c) => c.ch);
    // A wider channel bonds (width/20) of the 20 MHz slots, so fewer fit.
    const step = Math.max(1, Math.round(width / 20));
    const wide = list.filter((_, i) => i % step === 0);
    const available = Math.max(1, wide.length);
    const channels = [];
    for (let i = 0; i < apCount; i++) channels.push(wide[i % available]);
    return { channels, available, coChannel: apCount > available, reuseGroups: Math.ceil(apCount / available) };
  };

  return {
    dbmToMw, mwToDbm, fspl, eirp, cellRadius, distanceFromPathLoss, fresnelRadius,
    mcsForSnr, airtime, assignChannelPlan, findChannel,
    PATH_LOSS_N, MIN_SNR, MCS_RATES, CH_24, CH_5, CH_6,
  };
})();

// Band → representative center frequency (MHz) for path-loss sizing.
const BAND_CENTER = { '2.4': 2437, '5': 5500, '6': 6500 };
// Use-case → target cell-edge RSSI (dBm).
const USECASE_RSSI = { voice: -67, highdensity: -67, data: -72, coverage: -75 };
// Representative client MCS for capacity sizing (64-QAM 5/6, 2×2) — a defensible
// mid-cell sustained rate, not the peak.
const CAPACITY_MCS = 'HE-7';
// Log-normal shadow-fade margin (dB) applied to the cell-edge link budget, giving
// ~90% cell-edge coverage probability. Keeps modelled cells at realistic indoor
// sizes (~15–18 m radius at 5 GHz) instead of free-space-like distances.
const SHADOW_FADE_MARGIN_DB = 10;

// ═══════════════════════════════════════════════════════════════════════════
//  TAB 1 — Design Studio
// ═══════════════════════════════════════════════════════════════════════════
function DesignStudioSection({ initialData, onShare }) {
  const { t } = useTranslation();
  const d = initialData?.tool === 'wifi-rf-planner' ? initialData : null;

  const [units, setUnits] = usePersistentState('wifi-rf:ds-units', d?.units ?? 'm');
  const [length, setLength] = usePersistentState('wifi-rf:ds-length', d?.length ?? 40);
  const [width, setWidth] = usePersistentState('wifi-rf:ds-width', d?.width ?? 25);
  const [areaOverride, setAreaOverride] = usePersistentState('wifi-rf:ds-area', d?.areaOverride ?? '');
  const [env, setEnv] = usePersistentState('wifi-rf:ds-env', d?.env ?? 'drywall');
  const [band, setBand] = usePersistentState('wifi-rf:ds-band', d?.band ?? '5');
  const [chWidth, setChWidth] = usePersistentState('wifi-rf:ds-chwidth', d?.chWidth ?? 80);
  const [useCase, setUseCase] = usePersistentState('wifi-rf:ds-usecase', d?.useCase ?? 'data');
  const [devices, setDevices] = usePersistentState('wifi-rf:ds-devices', d?.devices ?? 60);
  const [perDevice, setPerDevice] = usePersistentState('wifi-rf:ds-perdevice', d?.perDevice ?? 5);
  const [txPower, setTxPower] = usePersistentState('wifi-rf:ds-tx', d?.txPower ?? 18);
  const [antGain, setAntGain] = usePersistentState('wifi-rf:ds-gain', d?.antGain ?? 4);

  useEffect(() => {
    const handler = (e) => (e.detail?.respond ?? onShare)({
      tool: 'wifi-rf-planner', tab: 'design',
      units, length, width, areaOverride, env, band, chWidth, useCase, devices, perDevice, txPower, antGain,
    });
    window.addEventListener('app:request-share', handler);
    return () => window.removeEventListener('app:request-share', handler);
  }, [units, length, width, areaOverride, env, band, chWidth, useCase, devices, perDevice, txPower, antGain, onShare]);

  // 2.4 GHz only supports 20/40 MHz.
  const widthOptions = band === '2.4' ? [20, 40] : [20, 40, 80, 160];
  useEffect(() => { if (!widthOptions.includes(chWidth)) setChWidth(widthOptions[widthOptions.length - 1]); }, [band]);

  const result = useMemo(() => {
    const toM = (v) => (units === 'ft' ? v * 0.3048 : v);
    let areaM2;
    if (areaOverride !== '' && isFinite(parseFloat(areaOverride))) {
      areaM2 = parseFloat(areaOverride) * (units === 'ft' ? 0.092903 : 1);
    } else {
      areaM2 = toM(parseFloat(length)) * toM(parseFloat(width));
    }
    const devCount = parseInt(devices, 10);
    if (!isFinite(areaM2) || areaM2 <= 0 || !isFinite(devCount) || devCount <= 0) return null;

    const n = RF.PATH_LOSS_N[env];
    const fMHz = BAND_CENTER[band];
    const targetRssi = USECASE_RSSI[useCase];

    // Coverage: cell radius → effective area (π·r²·0.7 overlap factor).
    const radius = RF.cellRadius({ txDbm: parseFloat(txPower), antGainDbi: parseFloat(antGain), targetRssi, n, fMHz, fadeMarginDb: SHADOW_FADE_MARGIN_DB });
    const effCellArea = Math.PI * radius * radius * 0.7;
    const apsCoverage = Math.max(1, Math.ceil(areaM2 / effCellArea));

    // Capacity: usable per-AP goodput from the airtime engine at a representative MCS.
    const at = RF.airtime({ clients: devCount, tputMbps: parseFloat(perDevice), mcsKey: CAPACITY_MCS, bw: chWidth, ss: 2, mgmtOverhead: 15 });
    const perApTput = at ? at.effectiveRate * (at.usablePct / 100) : 0;
    const totalDemand = devCount * parseFloat(perDevice);
    const apsCapacity = perApTput > 0 ? Math.max(1, Math.ceil(totalDemand / perApTput)) : 1;

    const aps = Math.max(apsCoverage, apsCapacity);
    const bound = apsCapacity > apsCoverage ? 'capacity' : apsCoverage > apsCapacity ? 'coverage' : 'balanced';
    const devicesPerAp = Math.ceil(devCount / aps);
    const plan = RF.assignChannelPlan(aps, band, chWidth, true);

    return {
      areaM2, n, targetRssi, radius, apsCoverage, apsCapacity, aps, bound,
      devicesPerAp, perApTput: Math.round(perApTput), plan,
    };
  }, [units, length, width, areaOverride, env, band, chWidth, useCase, devices, perDevice, txPower, antGain]);

  const verdict = useMemo(() => {
    if (!result) return null;
    const vars = { aps: result.aps, radius: result.radius.toFixed(1), perAp: result.devicesPerAp };
    if (result.bound === 'capacity') return t('wifi_rf.ds_verdict_capacity', vars);
    if (result.bound === 'coverage') return t('wifi_rf.ds_verdict_coverage', vars);
    return t('wifi_rf.ds_verdict_balanced', vars);
  }, [result, t]);

  return (
    <div className="fadein">
      <div className="two-col">
        <div className="card">
          <div className="card-title">{t('wifi_rf.ds_inputs_title')}</div>

          <div className="field">
            <label className="label">{t('wifi_rf.ds_units')}</label>
            <select className="input" value={units} onChange={(e) => setUnits(e.target.value)}>
              <option value="m">{t('wifi_rf.unit_m')}</option>
              <option value="ft">{t('wifi_rf.unit_ft')}</option>
            </select>
          </div>
          <div className="three-col">
            <div className="field">
              <label className="label">{t('wifi_rf.ds_length')} ({t(`wifi_rf.unit_${units}`)})</label>
              <input className="input" type="number" value={length} onChange={(e) => setLength(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('wifi_rf.ds_width')} ({t(`wifi_rf.unit_${units}`)})</label>
              <input className="input" type="number" value={width} onChange={(e) => setWidth(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('wifi_rf.ds_area')}</label>
              <input className="input" type="number" value={areaOverride} placeholder="—" onChange={(e) => setAreaOverride(e.target.value)} />
            </div>
          </div>
          <div className="hint">{t('wifi_rf.ds_area_hint')}</div>

          <div className="two-col" style={{ marginTop: 12 }}>
            <div className="field">
              <label className="label">{t('wifi_rf.ds_environment')}</label>
              <select className="input" value={env} onChange={(e) => setEnv(e.target.value)}>
                <option value="open">{t('wifi_rf.env_open')}</option>
                <option value="drywall">{t('wifi_rf.env_drywall')}</option>
                <option value="dense">{t('wifi_rf.env_dense')}</option>
                <option value="warehouse">{t('wifi_rf.env_warehouse')}</option>
              </select>
              <div className="hint">{t('wifi_rf.ds_env_hint')}</div>
            </div>
            <div className="field">
              <label className="label">{t('wifi_rf.ds_usecase')}</label>
              <select className="input" value={useCase} onChange={(e) => setUseCase(e.target.value)}>
                <option value="voice">{t('wifi_rf.uc_voice')}</option>
                <option value="highdensity">{t('wifi_rf.uc_highdensity')}</option>
                <option value="data">{t('wifi_rf.uc_data')}</option>
                <option value="coverage">{t('wifi_rf.uc_coverage')}</option>
              </select>
              <div className="hint">{t('wifi_rf.ds_usecase_hint')}</div>
            </div>
          </div>

          <div className="two-col">
            <div className="field">
              <label className="label">{t('wifi_rf.ds_band')}</label>
              <select className="input" value={band} onChange={(e) => setBand(e.target.value)}>
                <option value="5">{t('wifi_rf.band_5')}</option>
                <option value="6">{t('wifi_rf.band_6')}</option>
                <option value="2.4">{t('wifi_rf.band_24')}</option>
              </select>
            </div>
            <div className="field">
              <label className="label">{t('wifi_rf.ds_width_ch')}</label>
              <select className="input" value={chWidth} onChange={(e) => setChWidth(+e.target.value)}>
                {widthOptions.map((w) => <option key={w} value={w}>{w} MHz</option>)}
              </select>
            </div>
          </div>

          <div className="card-title" style={{ marginTop: 16 }}>{t('wifi_rf.ds_capacity_title')}</div>
          <div className="two-col">
            <div className="field">
              <label className="label">{t('wifi_rf.ds_devices')}</label>
              <input className="input" type="number" value={devices} onChange={(e) => setDevices(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('wifi_rf.ds_per_device')} (Mbps)</label>
              <input className="input" type="number" value={perDevice} onChange={(e) => setPerDevice(e.target.value)} />
            </div>
          </div>

          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>{t('wifi_rf.ds_advanced')}</summary>
            <div className="two-col" style={{ marginTop: 10 }}>
              <div className="field">
                <label className="label">{t('wifi_rf.ds_tx_power')} (dBm)</label>
                <input className="input" type="number" value={txPower} onChange={(e) => setTxPower(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('wifi_rf.ds_ant_gain')} (dBi)</label>
                <input className="input" type="number" value={antGain} onChange={(e) => setAntGain(e.target.value)} />
              </div>
            </div>
          </details>
        </div>

        <div>
          <div className="card">
            <div className="card-title">{t('wifi_rf.ds_verdict_title')}</div>
            {!result && <Err msg={t('wifi_rf.ds_err_inputs')} />}
            {result && (
              <>
                <div style={{
                  padding: '14px 16px', borderRadius: 8, marginBottom: 16, lineHeight: 1.5, fontSize: 14,
                  background: result.bound === 'capacity' ? 'rgba(245,158,11,0.1)' : 'rgba(0,212,200,0.08)',
                  border: `1px solid ${result.bound === 'capacity' ? 'var(--yellow)' : 'var(--cyan)'}`,
                }}>
                  <strong style={{ color: result.bound === 'capacity' ? 'var(--yellow)' : 'var(--cyan)' }}>
                    {result.aps} {t('wifi_rf.ds_ap_count')}
                  </strong>
                  <div style={{ marginTop: 6, color: 'var(--fg)' }}>{verdict}</div>
                </div>

                <div className="result-grid">
                  <ResultItem label={t('wifi_rf.ds_ap_count')} value={String(result.aps)} accent />
                  <ResultItem label={t('wifi_rf.ds_bound')} value={t(`wifi_rf.ds_bound_${result.bound === 'balanced' ? 'capacity' : result.bound}`)} />
                  <ResultItem label={t('wifi_rf.ds_coverage_aps')} value={String(result.apsCoverage)} />
                  <ResultItem label={t('wifi_rf.ds_capacity_aps')} value={String(result.apsCapacity)} />
                  <ResultItem label={t('wifi_rf.ds_cell_radius')} value={result.radius.toFixed(1) + ' m'} />
                  <ResultItem label={t('wifi_rf.ds_devices_per_ap')} value={String(result.devicesPerAp)} />
                  <ResultItem label={t('wifi_rf.ds_per_ap_tput')} value={result.perApTput + ' Mbps'} />
                  <ResultItem label={t('wifi_rf.ds_target_rssi')} value={result.targetRssi + ' dBm'} />
                  <ResultItem label={t('wifi_rf.ds_path_loss_n')} value={result.n.toFixed(1)} />
                  <ResultItem label={t('wifi_rf.ds_channel_set')} value={result.plan.channels.join(', ')} green={!result.plan.coChannel} yellow={result.plan.coChannel} />
                </div>

                {result.plan.coChannel && (
                  <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(245,158,11,0.1)', border: '1px solid var(--yellow)', borderRadius: 8, fontSize: 12, color: 'var(--fg)' }}>
                    {t('wifi_rf.ds_cochannel_warn', { size: result.plan.reuseGroups })}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="card" style={{ borderColor: 'var(--border)' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>⚠ {t('wifi_rf.disclaimer')}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TAB 2 — Reference Deck   (assembled from delegated subagent output)
// ═══════════════════════════════════════════════════════════════════════════
function ReferenceDeckSection() {
  const { t } = useTranslation();

  // Card 1: dBm <-> mW
  const [dbmVal, setDbmVal] = usePersistentState('wifi-rf:rd-dbm', 20);
  const [mwVal, setMwVal] = usePersistentState('wifi-rf:rd-mw', 100);

  // Card 2: EIRP & headroom
  const [eirpTx, setEirpTx] = usePersistentState('wifi-rf:rd-eirp-tx', 20);
  const [eirpGain, setEirpGain] = usePersistentState('wifi-rf:rd-eirp-gain', 6);
  const [eirpCable, setEirpCable] = usePersistentState('wifi-rf:rd-eirp-cable', 2);
  const [eirpRegion, setEirpRegion] = usePersistentState('wifi-rf:rd-eirp-region', 'fcc');

  // Card 3: FSPL & distance-from-RSSI
  const [fsplFreq, setFsplFreq] = usePersistentState('wifi-rf:rd-fspl-freq', 5500);
  const [fsplDist, setFsplDist] = usePersistentState('wifi-rf:rd-fspl-dist', 100);
  const [fsplBudget, setFsplBudget] = usePersistentState('wifi-rf:rd-fspl-budget', 90);

  // Card 4: SNR -> MCS
  const [snrVal, setSnrVal] = usePersistentState('wifi-rf:rd-snr', 30);

  // Card 5: Channel lookup
  const [chanInput, setChanInput] = usePersistentState('wifi-rf:rd-chan', 36);

  // Card 6: Fresnel radius
  const [frDist, setFrDist] = usePersistentState('wifi-rf:rd-fr-dist', 1000);
  const [frFreq, setFrFreq] = usePersistentState('wifi-rf:rd-fr-freq', 5800);

  const CAP = { fcc: 36, etsi: 20 };

  // Card 1 memo
  const card1 = React.useMemo(() => {
    const dbm = parseFloat(dbmVal);
    const mw = parseFloat(mwVal);
    const mwFromDbm = isNaN(dbm) ? null : RF.dbmToMw(dbm);
    const dbmFromMw = isNaN(mw) ? null : RF.mwToDbm(mw);
    return { mwFromDbm, dbmFromMw };
  }, [dbmVal, mwVal]);

  // Card 2 memo
  const card2 = React.useMemo(() => {
    const tx = parseFloat(eirpTx);
    const gain = parseFloat(eirpGain);
    const cable = parseFloat(eirpCable);
    if (isNaN(tx) || isNaN(gain) || isNaN(cable)) return null;
    const eirp = RF.eirp(tx, gain, cable);
    const cap = CAP[eirpRegion] ?? 36;
    const headroom = cap - eirp;
    return { eirp, cap, headroom };
  }, [eirpTx, eirpGain, eirpCable, eirpRegion]);

  // Card 3 memo
  const card3 = React.useMemo(() => {
    const freq = parseFloat(fsplFreq);
    const dist = parseFloat(fsplDist);
    const budget = parseFloat(fsplBudget);
    if (isNaN(freq) || isNaN(dist) || isNaN(budget)) return null;
    const fspl = RF.fspl(dist, freq);
    const reach = RF.distanceFromPathLoss({ pathLossDb: budget, n: 2.0, fMHz: freq });
    return { fspl, reach };
  }, [fsplFreq, fsplDist, fsplBudget]);

  // Card 4 memo
  const card4 = React.useMemo(() => {
    const snr = parseFloat(snrVal);
    if (isNaN(snr)) return null;
    return RF.mcsForSnr(snr);
  }, [snrVal]);

  // Card 5 memo
  const card5 = React.useMemo(() => {
    const input = String(chanInput).trim();
    if (!input) return null;
    return RF.findChannel(input);
  }, [chanInput]);

  // Card 6 memo
  const card6 = React.useMemo(() => {
    const dist = parseFloat(frDist);
    const freq = parseFloat(frFreq);
    if (isNaN(dist) || isNaN(freq)) return null;
    const first = RF.fresnelRadius(dist, freq);
    const sixty = first * 0.6;
    return { first, sixty };
  }, [frDist, frFreq]);

  const fmt = (v, dp = 2) => (v == null || isNaN(v) ? '—' : Number(v).toFixed(dp));

  return (
    <div>
      {/* Header card */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">{t('wifi_rf.rd_title')}</div>
        <div style={{ color: 'var(--muted)', fontSize: '0.875rem' }}>{t('wifi_rf.rd_subtitle')}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Card 1: dBm <-> mW */}
        <div className="card">
          <div className="card-title">{t('wifi_rf.rd_dbm_mw')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_dbm')}
              <input className="input"
                type="number"
                value={dbmVal}
                onChange={e => setDbmVal(e.target.value)}
                style={{ marginLeft: 8, width: 90 }}
              />
              {' dBm'}
            </label>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_mw')}
              <input className="input"
                type="number"
                value={mwVal}
                onChange={e => setMwVal(e.target.value)}
                style={{ marginLeft: 8, width: 90 }}
              />
              {' mW'}
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            <ResultItem label={t('wifi_rf.rd_dbm')} value={`${fmt(card1.mwFromDbm)} mW`} />
            <ResultItem label={t('wifi_rf.rd_mw')} value={`${fmt(card1.dbmFromMw)} dBm`} />
          </div>
          <div style={{ marginTop: 8 }}>
            <CopyBtn
              text={`${fmt(parseFloat(dbmVal))} dBm = ${fmt(card1.mwFromDbm)} mW; ${fmt(parseFloat(mwVal))} mW = ${fmt(card1.dbmFromMw)} dBm`}
              id="rd-dbm-mw-copy"
            />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            {t('wifi_rf.rd_dbm_mw_desc')}
          </div>
        </div>

        {/* Card 2: EIRP & headroom */}
        <div className="card">
          <div className="card-title">{t('wifi_rf.rd_eirp')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_tx_power')}
              <input className="input"
                type="number"
                value={eirpTx}
                onChange={e => setEirpTx(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
              {' dBm'}
            </label>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_ant_gain')}
              <input className="input"
                type="number"
                value={eirpGain}
                onChange={e => setEirpGain(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
              {' dBi'}
            </label>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_cable_loss')}
              <input className="input"
                type="number"
                value={eirpCable}
                onChange={e => setEirpCable(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
              {' dB'}
            </label>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_region')}
              <select className="input"
                value={eirpRegion}
                onChange={e => setEirpRegion(e.target.value)}
                style={{ marginLeft: 8 }}
              >
                <option value="fcc">{t('wifi_rf.rd_region_fcc')}</option>
                <option value="etsi">{t('wifi_rf.rd_region_etsi')}</option>
              </select>
            </label>
          </div>
          {card2 && (
            <div style={{ marginTop: 8 }}>
              <ResultItem label={t('wifi_rf.rd_eirp_result')} value={`${fmt(card2.eirp)} dBm`} />
              <ResultItem label={t('wifi_rf.rd_cap')} value={`${card2.cap} dBm`} />
              <ResultItem
                label={t('wifi_rf.rd_headroom')}
                value={`${fmt(card2.headroom)} dB${card2.headroom < 0 ? ' — ' + t('wifi_rf.rd_over_cap') : ''}`}
                red={card2.headroom < 0}
                green={card2.headroom >= 0}
              />
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <CopyBtn
              text={card2 ? `EIRP ${fmt(card2.eirp)} dBm, cap ${card2.cap} dBm, headroom ${fmt(card2.headroom)} dB` : '—'}
              id="rd-eirp-copy"
            />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            {t('wifi_rf.rd_eirp_desc')}
          </div>
        </div>

        {/* Card 3: FSPL & distance-from-budget */}
        <div className="card">
          <div className="card-title">{t('wifi_rf.rd_fspl')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_freq')}
              <input className="input"
                type="number"
                value={fsplFreq}
                onChange={e => setFsplFreq(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
              {' MHz'}
            </label>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_distance')}
              <input className="input"
                type="number"
                value={fsplDist}
                onChange={e => setFsplDist(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
              {' m'}
            </label>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_budget')}
              <input className="input"
                type="number"
                value={fsplBudget}
                onChange={e => setFsplBudget(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
              {' dB'}
            </label>
          </div>
          {card3 && (
            <div style={{ marginTop: 8 }}>
              <ResultItem label={t('wifi_rf.rd_fspl_result')} value={`${fmt(card3.fspl)} dB`} />
              <ResultItem label={t('wifi_rf.rd_reach')} value={`${fmt(card3.reach)} m`} />
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <CopyBtn
              text={card3 ? `FSPL ${fmt(card3.fspl)} dB, reach ${fmt(card3.reach)} m` : '—'}
              id="rd-fspl-copy"
            />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            {t('wifi_rf.rd_fspl_desc_card')}
          </div>
        </div>

        {/* Card 4: SNR -> MCS */}
        <div className="card">
          <div className="card-title">{t('wifi_rf.rd_snr_mcs')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_snr')}
              <input className="input"
                type="number"
                value={snrVal}
                onChange={e => setSnrVal(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
              {' dB'}
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            {card4 === null && !isNaN(parseFloat(snrVal)) ? (
              <ResultItem label={t('wifi_rf.rd_mcs_result')} value={t('wifi_rf.rd_snr_too_low')} red />
            ) : card4 ? (
              <>
                <ResultItem label={t('wifi_rf.rd_mcs_result')} value={`MCS ${card4.mcs}`} green />
                <ResultItem label={t('wifi_rf.rd_modulation')} value={card4.mod} />
              </>
            ) : null}
          </div>
          <div style={{ marginTop: 8 }}>
            <CopyBtn
              text={card4 ? `SNR ${fmt(parseFloat(snrVal))} dB → MCS ${card4.mcs} (${card4.mod})` : `SNR ${fmt(parseFloat(snrVal))} dB → no MCS`}
              id="rd-snr-mcs-copy"
            />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            {t('wifi_rf.rd_snr_mcs_desc')}
          </div>
        </div>

        {/* Card 5: Channel lookup */}
        <div className="card">
          <div className="card-title">{t('wifi_rf.rd_channel')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_ch_or_freq')}
              <input className="input"
                type="text"
                value={chanInput}
                onChange={e => setChanInput(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
            </label>
          </div>
          <div style={{ marginTop: 8 }}>
            {String(chanInput).trim() && !card5 ? (
              <ResultItem label={t('wifi_rf.rd_ch')} value={t('wifi_rf.rd_not_found')} red />
            ) : card5 ? (
              <>
                <ResultItem label={t('wifi_rf.rd_ch')} value={String(card5.ch)} />
                <ResultItem label={t('wifi_rf.rd_center_freq')} value={`${card5.freq} MHz`} />
                <ResultItem label={t('wifi_rf.rd_band')} value={card5.band} />
                <ResultItem label={t('wifi_rf.rd_dfs')} value={card5.dfs ? t('common.yes') : t('common.no')} />
                <ResultItem label={t('wifi_rf.rd_psc')} value={card5.psc ? t('common.yes') : t('common.no')} />
              </>
            ) : null}
          </div>
          <div style={{ marginTop: 8 }}>
            <CopyBtn
              text={card5 ? `Ch ${card5.ch} ${card5.freq} MHz ${card5.band} DFS:${card5.dfs ? 'yes' : 'no'} PSC:${card5.psc ? 'yes' : 'no'}` : `ch ${chanInput} not found`}
              id="rd-channel-copy"
            />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            {t('wifi_rf.rd_channel_desc')}
          </div>
        </div>

        {/* Card 6: Fresnel radius */}
        <div className="card">
          <div className="card-title">{t('wifi_rf.rd_fresnel')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_distance')}
              <input className="input"
                type="number"
                value={frDist}
                onChange={e => setFrDist(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
              {' m'}
            </label>
            <label style={{ fontSize: '0.875rem' }}>
              {t('wifi_rf.rd_freq')}
              <input className="input"
                type="number"
                value={frFreq}
                onChange={e => setFrFreq(e.target.value)}
                style={{ marginLeft: 8, width: 80 }}
              />
              {' MHz'}
            </label>
          </div>
          {card6 && (
            <div style={{ marginTop: 8 }}>
              <ResultItem label={t('wifi_rf.rd_fresnel_first')} value={`${fmt(card6.first)} m`} />
              <ResultItem label={t('wifi_rf.rd_fresnel_60')} value={`${fmt(card6.sixty)} m`} />
            </div>
          )}
          <div style={{ marginTop: 8 }}>
            <CopyBtn
              text={card6 ? `Fresnel zone 1: ${fmt(card6.first)} m, 60%: ${fmt(card6.sixty)} m` : '—'}
              id="rd-fresnel-copy"
            />
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 10, fontSize: '0.8rem', color: 'var(--muted)', lineHeight: 1.4 }}>
            {t('wifi_rf.rd_fresnel_desc_card')}
          </div>
        </div>

      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TAB 3 — PtP Link   (assembled from delegated subagent output)
// ═══════════════════════════════════════════════════════════════════════════
function PtPLinkSection({ initialData, onShare }) {
  const { t } = useTranslation();
  const d = initialData?.tool === 'wifi-rf-planner' ? initialData : null;

  const [freq, setFreq] = usePersistentState('wifi-rf:lb-freq', d?.freq ?? 5200);
  const [txPower, setTxPower] = usePersistentState('wifi-rf:lb-tx-power', d?.txPower ?? 20);
  const [txGain, setTxGain] = usePersistentState('wifi-rf:lb-tx-gain', d?.txGain ?? 3);
  const [rxSens, setRxSens] = usePersistentState('wifi-rf:lb-rx-sens', d?.rxSens ?? -70);
  const [rxGain, setRxGain] = usePersistentState('wifi-rf:lb-rx-gain', d?.rxGain ?? 3);
  const [fadeMargin, setFadeMargin] = usePersistentState('wifi-rf:lb-fade', d?.fadeMargin ?? 15);
  const [dist, setDist] = usePersistentState('wifi-rf:lb-dist', d?.dist ?? 100);

  useEffect(() => {
    const handler = (e) => (e.detail?.respond ?? onShare)({
      tool: 'wifi-rf-planner', tab: 'ptp', freq, txPower, txGain, rxSens, rxGain, fadeMargin, dist,
    });
    window.addEventListener('app:request-share', handler);
    return () => window.removeEventListener('app:request-share', handler);
  }, [freq, txPower, txGain, rxSens, rxGain, fadeMargin, dist, onShare]);

  const freqOptions = [
    { label: '2.4 GHz (802.11b/g/n)', MHz: 2437 },
    { label: '5 GHz (802.11a/ac/ax)', MHz: 5200 },
    { label: '6 GHz (802.11ax/be)', MHz: 6000 },
  ];

  const results = useMemo(() => {
    const f = parseFloat(freq), tx = parseFloat(txPower), tg = parseFloat(txGain);
    const rs = parseFloat(rxSens), rg = parseFloat(rxGain), fm = parseFloat(fadeMargin), dm = parseFloat(dist);
    if ([f, tx, tg, rs, rg, fm, dm].some((v) => isNaN(v)) || dm <= 0 || f <= 0) return null;

    const fspl = RF.fspl(dm, f);
    const budget = tx + tg + rg - rs;
    const margin = budget - fspl - fm;
    const fsplConst = 20 * Math.log10(f) - 27.55;
    const maxRange = Math.pow(10, (budget - fm - fsplConst) / 20);
    const R = RF.fresnelRadius(dm, f);
    const fresnel60 = R * 0.6;
    const recPower = fspl + fm + rs - rg - tg;
    return { fspl, budget, margin, maxRange, R, fresnel60, recPower };
  }, [freq, txPower, txGain, rxSens, rxGain, fadeMargin, dist]);

  const R = results?.R ?? 0;

  return (
    <div className="fadein">
      <div className="two-col">
        <div className="card">
          <div className="card-title">{t('wifi_rf.lb_title')}</div>
          <div className="field">
            <label className="label">{t('wifi_rf.lb_freq')}</label>
            <select className="input" value={freq} onChange={(e) => setFreq(+e.target.value)}>
              {freqOptions.map((o) => <option key={o.MHz} value={o.MHz}>{o.label}</option>)}
            </select>
          </div>
          <div className="two-col">
            <div className="field">
              <label className="label">{t('wifi_rf.lb_tx_power')} (dBm)</label>
              <input className="input" type="number" value={txPower} onChange={(e) => setTxPower(e.target.value)} />
              <div className="hint">{t('wifi_rf.lb_tx_hint')}</div>
            </div>
            <div className="field">
              <label className="label">{t('wifi_rf.lb_tx_gain')} (dBi)</label>
              <input className="input" type="number" value={txGain} onChange={(e) => setTxGain(e.target.value)} />
            </div>
          </div>
          <div className="two-col">
            <div className="field">
              <label className="label">{t('wifi_rf.lb_rx_sens')} (dBm)</label>
              <input className="input" type="number" value={rxSens} onChange={(e) => setRxSens(e.target.value)} />
              <div className="hint">{t('wifi_rf.lb_rx_sens_hint')}</div>
            </div>
            <div className="field">
              <label className="label">{t('wifi_rf.lb_rx_gain')} (dBi)</label>
              <input className="input" type="number" value={rxGain} onChange={(e) => setRxGain(e.target.value)} />
            </div>
          </div>
          <div className="two-col">
            <div className="field">
              <label className="label">{t('wifi_rf.lb_fade_margin')} (dB)</label>
              <input className="input" type="number" value={fadeMargin} onChange={(e) => setFadeMargin(e.target.value)} />
              <div className="hint">{t('wifi_rf.lb_fade_hint')}</div>
            </div>
            <div className="field">
              <label className="label">{t('wifi_rf.lb_distance')} (m)</label>
              <input className="input" type="number" value={dist} onChange={(e) => setDist(e.target.value)} />
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-title">{t('common.results')}</div>
            {results ? (
              <>
                <div className="result-grid">
                  <ResultItem label={t('wifi_rf.lb_fspl')} value={results.fspl.toFixed(1) + ' dB'} />
                  <ResultItem label={t('wifi_rf.lb_link_budget')} value={results.budget.toFixed(1) + ' dB'} />
                  <ResultItem label={t('wifi_rf.lb_link_margin')} value={results.margin.toFixed(1) + ' dB'} green={results.margin >= 0} red={results.margin < 0} />
                  <ResultItem label={t('wifi_rf.lb_result_dist')} value={results.maxRange.toFixed(0) + ' m'} />
                  <ResultItem label={t('wifi_rf.lb_result_fresnel')} value={results.fresnel60.toFixed(2) + ' m'} />
                </div>

                <div style={{ marginTop: 20, padding: 12, background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{t('wifi_rf.lb_rec_tx_power')}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--cyan)' }}>{results.recPower.toFixed(1)} dBm</div>
                  <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 4 }}>{t('wifi_rf.lb_rec_note')}</div>
                </div>

                {results.margin < 0 ? (
                  <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(239,68,68,0.1)', border: '1px solid var(--red)', borderRadius: 8, fontSize: 13, color: 'var(--fg)' }}>
                    <strong style={{ color: 'var(--red)' }}>{t('wifi_rf.lb_insufficient_margin')}</strong>
                  </div>
                ) : (
                  <div style={{ marginTop: 16, padding: '10px 14px', background: 'rgba(34,197,94,0.1)', border: '1px solid var(--green)', borderRadius: 8, fontSize: 13, color: 'var(--fg)' }}>
                    {t('wifi_rf.link_margin_ok')}
                  </div>
                )}
              </>
            ) : null}
          </div>

          <div className="card">
            <div className="card-title">{t('wifi_rf.lb_fresnel')}</div>
            <p style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{t('wifi_rf.lb_fresnel_desc')}</p>
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <svg width="100%" height="60" viewBox="0 0 200 60">
                <line x1="10" y1="30" x2="190" y2="30" stroke="var(--border)" strokeWidth="1" strokeDasharray="4 2" />
                <ellipse cx="100" cy="30" rx="90" ry="25" fill="none" stroke="var(--cyan)" strokeWidth="1" opacity="0.3" />
                <ellipse cx="100" cy="30" rx="90" ry="15" fill="none" stroke="var(--cyan)" strokeWidth="1.5" />
                <circle cx="10" cy="30" r="3" fill="var(--cyan)" />
                <circle cx="190" cy="30" r="3" fill="var(--cyan)" />
                <text x="100" y="55" textAnchor="middle" fontSize="8" fill="var(--dim)">{t('wifi_rf.lb_distance')}: {dist}m</text>
                <text x="100" y="25" textAnchor="middle" fontSize="8" fill="var(--cyan)">r = {R.toFixed(2)}m</text>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TAB 4 — Cheat Sheet   (assembled from delegated subagent output)
// ═══════════════════════════════════════════════════════════════════════════
function CheatSheetSection() {
  const { t } = useTranslation();

  const thStyle = { textAlign: 'left', padding: '8px 10px', color: 'var(--muted)' };
  const tdStyle = { padding: '8px 10px' };
  const rowStyle = { borderBottom: '1px solid var(--border)' };
  const tableStyle = { width: '100%', borderCollapse: 'collapse', fontSize: 13 };

  return (
    <div className="fadein">

      {/* Header card */}
      <div className="card">
        <div className="card-title">{t('wifi_rf.cs_title')}</div>
        <p style={{ margin: '4px 0 0', color: 'var(--muted)', fontSize: 13 }}>{t('wifi_rf.cs_subtitle')}</p>
      </div>

      {/* 1. Standards matrix */}
      <div className="card">
        <div className="card-title">{t('wifi_rf.cs_standards')}</div>
        <table style={tableStyle}>
          <thead>
            <tr style={rowStyle}>
              <th style={thStyle}>{t('wifi_rf.cs_col_std')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_wifi')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_band')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_maxrate')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_widths')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_streams')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_mod')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_year')}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11a</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>5 GHz</td>
              <td style={tdStyle}>54 Mbps</td>
              <td style={tdStyle}>20</td>
              <td style={tdStyle}>1</td>
              <td style={tdStyle}>64-QAM</td>
              <td style={tdStyle}>1999</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11b</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>2.4 GHz</td>
              <td style={tdStyle}>11 Mbps</td>
              <td style={tdStyle}>22</td>
              <td style={tdStyle}>1</td>
              <td style={tdStyle}>CCK</td>
              <td style={tdStyle}>1999</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11g</td>
              <td style={tdStyle}>—</td>
              <td style={tdStyle}>2.4 GHz</td>
              <td style={tdStyle}>54 Mbps</td>
              <td style={tdStyle}>20</td>
              <td style={tdStyle}>1</td>
              <td style={tdStyle}>64-QAM</td>
              <td style={tdStyle}>2003</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11n</td>
              <td style={tdStyle}>Wi-Fi 4</td>
              <td style={tdStyle}>2.4/5 GHz</td>
              <td style={tdStyle}>600 Mbps</td>
              <td style={tdStyle}>20/40</td>
              <td style={tdStyle}>4</td>
              <td style={tdStyle}>64-QAM</td>
              <td style={tdStyle}>2009</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11ac</td>
              <td style={tdStyle}>Wi-Fi 5</td>
              <td style={tdStyle}>5 GHz</td>
              <td style={tdStyle}>6.9 Gbps</td>
              <td style={tdStyle}>20/40/80/160</td>
              <td style={tdStyle}>8</td>
              <td style={tdStyle}>256-QAM</td>
              <td style={tdStyle}>2013</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11ax</td>
              <td style={tdStyle}>Wi-Fi 6/6E</td>
              <td style={tdStyle}>2.4/5/6 GHz</td>
              <td style={tdStyle}>9.6 Gbps</td>
              <td style={tdStyle}>20/40/80/160</td>
              <td style={tdStyle}>8</td>
              <td style={tdStyle}>1024-QAM</td>
              <td style={tdStyle}>2019</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11be</td>
              <td style={tdStyle}>Wi-Fi 7</td>
              <td style={tdStyle}>2.4/5/6 GHz</td>
              <td style={tdStyle}>46 Gbps</td>
              <td style={tdStyle}>up to 320</td>
              <td style={tdStyle}>16</td>
              <td style={tdStyle}>4096-QAM</td>
              <td style={tdStyle}>2024</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 2. Channels & regulatory */}
      <div className="card">
        <div className="card-title">{t('wifi_rf.cs_channels')}</div>
        <table style={tableStyle}>
          <thead>
            <tr style={rowStyle}>
              <th style={thStyle}>{t('wifi_rf.cs_col_region')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_notes')}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={rowStyle}>
              <td style={tdStyle}>2.4 GHz</td>
              <td style={tdStyle}>{t('wifi_rf.cs_ch_24')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>5 GHz UNII-1</td>
              <td style={tdStyle}>{t('wifi_rf.cs_ch_unii1')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>5 GHz UNII-2A</td>
              <td style={tdStyle}>{t('wifi_rf.cs_ch_unii2a')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>5 GHz UNII-2C</td>
              <td style={tdStyle}>{t('wifi_rf.cs_ch_unii2c')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>5 GHz UNII-3</td>
              <td style={tdStyle}>{t('wifi_rf.cs_ch_unii3')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>6 GHz</td>
              <td style={tdStyle}>{t('wifi_rf.cs_ch_6ghz')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>Width</td>
              <td style={tdStyle}>{t('wifi_rf.cs_width_map')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 3. Signal quality */}
      <div className="card">
        <div className="card-title">{t('wifi_rf.cs_signal')}</div>
        <table style={tableStyle}>
          <thead>
            <tr style={rowStyle}>
              <th style={thStyle}>{t('wifi_rf.cs_col_metric')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_meaning')}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={rowStyle}>
              <td style={tdStyle}>RSSI −67</td>
              <td style={tdStyle}>{t('wifi_rf.cs_rssi_67')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>RSSI −72</td>
              <td style={tdStyle}>{t('wifi_rf.cs_rssi_72')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>RSSI −80</td>
              <td style={tdStyle}>{t('wifi_rf.cs_rssi_80')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>SNR voice</td>
              <td style={tdStyle}>{t('wifi_rf.cs_snr_voice')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>SNR data</td>
              <td style={tdStyle}>{t('wifi_rf.cs_snr_data')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>SNR min</td>
              <td style={tdStyle}>{t('wifi_rf.cs_snr_min')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 4. Power & regulatory limits */}
      <div className="card">
        <div className="card-title">{t('wifi_rf.cs_power')}</div>
        <table style={tableStyle}>
          <thead>
            <tr style={rowStyle}>
              <th style={thStyle}>{t('wifi_rf.cs_col_band_region')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_notes')}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={rowStyle}>
              <td style={tdStyle}>2.4 FCC</td>
              <td style={tdStyle}>{t('wifi_rf.cs_eirp_24_fcc')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>5 UNII-1 FCC</td>
              <td style={tdStyle}>{t('wifi_rf.cs_eirp_5_fcc_u1')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>5 UNII-3 FCC</td>
              <td style={tdStyle}>{t('wifi_rf.cs_eirp_5_fcc_u3')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>2.4 ETSI</td>
              <td style={tdStyle}>{t('wifi_rf.cs_eirp_24_etsi')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>5 ETSI</td>
              <td style={tdStyle}>{t('wifi_rf.cs_eirp_5_etsi')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>6 FCC LPI</td>
              <td style={tdStyle}>{t('wifi_rf.cs_eirp_6_fcc')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>dBm↔mW</td>
              <td style={tdStyle}>{t('wifi_rf.cs_dbm_mw_quick')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 5. Security & roaming */}
      <div className="card">
        <div className="card-title">{t('wifi_rf.cs_security')}</div>
        <table style={tableStyle}>
          <thead>
            <tr style={rowStyle}>
              <th style={thStyle}>{t('wifi_rf.cs_col_feature')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_desc')}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={rowStyle}>
              <td style={tdStyle}>WPA2</td>
              <td style={tdStyle}>{t('wifi_rf.cs_wpa2')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>WPA3</td>
              <td style={tdStyle}>{t('wifi_rf.cs_wpa3')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11r</td>
              <td style={tdStyle}>{t('wifi_rf.cs_11r')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11k</td>
              <td style={tdStyle}>{t('wifi_rf.cs_11k')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11v</td>
              <td style={tdStyle}>{t('wifi_rf.cs_11v')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>802.11w</td>
              <td style={tdStyle}>{t('wifi_rf.cs_11w')}</td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* 6. Frame & airtime basics */}
      <div className="card">
        <div className="card-title">{t('wifi_rf.cs_airtime')}</div>
        <table style={tableStyle}>
          <thead>
            <tr style={rowStyle}>
              <th style={thStyle}>{t('wifi_rf.cs_col_topic')}</th>
              <th style={thStyle}>{t('wifi_rf.cs_col_desc')}</th>
            </tr>
          </thead>
          <tbody>
            <tr style={rowStyle}>
              <td style={tdStyle}>Overhead</td>
              <td style={tdStyle}>{t('wifi_rf.cs_overhead')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>Guard Interval</td>
              <td style={tdStyle}>{t('wifi_rf.cs_gi')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>2.4 GHz</td>
              <td style={tdStyle}>{t('wifi_rf.cs_24_slow')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>DFS CAC</td>
              <td style={tdStyle}>{t('wifi_rf.cs_dfs_cac')}</td>
            </tr>
            <tr style={rowStyle}>
              <td style={tdStyle}>A-MPDU</td>
              <td style={tdStyle}>{t('wifi_rf.cs_ampdu')}</td>
            </tr>
          </tbody>
        </table>
      </div>

    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  BONDED CHANNELS & MAPPING FOR CHANNEL SELECTION
// ═══════════════════════════════════════════════════════════════════════════
const BONDED_CHANNELS = {
  '2.4': {
    20: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
    40: [3, 4, 5, 6, 7, 8, 9, 10, 11]
  },
  '5': {
    20: [36, 40, 44, 48, 52, 56, 60, 64, 100, 104, 108, 112, 116, 120, 124, 128, 132, 136, 140, 144, 149, 153, 157, 161, 165],
    40: [38, 46, 54, 62, 102, 110, 118, 126, 134, 142, 151, 159],
    80: [42, 58, 106, 122, 138, 155],
    160: [50, 114]
  },
  '6': {
    20: Array.from({ length: 59 }, (_, i) => 1 + i * 4),
    40: Array.from({ length: 29 }, (_, i) => 3 + i * 8),
    80: Array.from({ length: 14 }, (_, i) => 7 + i * 16),
    160: Array.from({ length: 7 }, (_, i) => 15 + i * 32),
    320: Array.from({ length: 3 }, (_, i) => 31 + i * 64)
  }
};

const getSubChannels = (centerCh, width) => {
  const step = width / 20;
  if (step <= 1) return [centerCh];
  if (width === 40) return [centerCh - 2, centerCh + 2];
  if (width === 80) return [centerCh - 6, centerCh - 2, centerCh + 2, centerCh + 6];
  if (width === 160) return [centerCh - 14, centerCh - 10, centerCh - 6, centerCh - 2, centerCh + 2, centerCh + 6, centerCh + 10, centerCh + 14];
  if (width === 320) return Array.from({ length: 16 }, (_, i) => centerCh - 30 + i * 4);
  return [centerCh];
};

// ═══════════════════════════════════════════════════════════════════════════
//  TAB 5 — Channel Selection
// ═══════════════════════════════════════════════════════════════════════════
function ChannelSelectionSection() {
  const { t } = useTranslation();
  const [band, setBand] = usePersistentState('wifi-rf:cs-band', '5');
  const [width, setWidth] = usePersistentState('wifi-rf:cs-width', 80);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [interferenceMap, setInterferenceMap] = usePersistentState('wifi-rf:cs-interference-map', {});

  const widthOptions = band === '2.4' ? [20, 40] : band === '5' ? [20, 40, 80, 160] : [20, 40, 80, 160, 320];

  useEffect(() => {
    if (!widthOptions.includes(width)) {
      setWidth(widthOptions[0]);
    }
  }, [band]);

  const simulateScan = useCallback(() => {
    const map = { ...interferenceMap };
    const channels = BONDED_CHANNELS[band]?.[width] || [];
    channels.forEach(ch => {
      const rand = Math.random();
      map[`${band}:${width}:${ch}`] = rand < 0.6 ? 'low' : rand < 0.85 ? 'medium' : 'high';
    });
    setInterferenceMap(map);
  }, [band, width, interferenceMap]);

  const channelsData = useMemo(() => {
    const channels = BONDED_CHANNELS[band]?.[width] || [];
    return channels.map(ch => {
      let freq;
      if (band === '2.4') freq = 2407 + 5 * ch;
      else if (band === '5') freq = 5000 + 5 * ch;
      else freq = 5950 + 5 * ch;

      const key = `${band}:${width}:${ch}`;
      const interference = interferenceMap[key] || 'low';

      // DFS Status
      let dfs = false;
      if (band === '5') {
        const subChannels = getSubChannels(ch, width);
        dfs = subChannels.some(sc => (sc >= 52 && sc <= 64) || (sc >= 100 && sc <= 144));
      }

      // PSC Status
      let psc = false;
      if (band === '6') {
        const subChannels = getSubChannels(ch, width);
        psc = subChannels.some(sc => (sc - 5) % 16 === 0);
      }

      // Base Recommendation
      let recommendation = 'recommended';
      if (band === '2.4') {
        if (width === 20) {
          recommendation = [1, 6, 11].includes(ch) ? 'recommended' : 'avoid';
        } else {
          recommendation = 'avoid';
        }
      } else if (band === '5') {
        recommendation = dfs ? 'acceptable' : 'recommended';
      } else if (band === '6') {
        recommendation = psc ? 'recommended' : 'acceptable';
      }

      // Interference level overrides
      if (interference === 'high') {
        recommendation = 'avoid';
      } else if (interference === 'medium' && recommendation === 'recommended') {
        recommendation = 'acceptable';
      }

      return { ch, freq, dfs, psc, interference, recommendation };
    });
  }, [band, width, interferenceMap]);

  const recommended = channelsData.filter(c => c.recommendation === 'recommended');
  const acceptable = channelsData.filter(c => c.recommendation === 'acceptable');
  const avoid = channelsData.filter(c => c.recommendation === 'avoid');

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('wifi_rf.ch_sel_title')}</div>
        <p style={{ margin: '4px 0 16px', color: 'var(--muted)', fontSize: 13 }}>{t('wifi_rf.ch_sel_subtitle')}</p>

        <div className="two-col">
          <div className="field">
            <label className="label">{t('wifi_rf.ds_band')}</label>
            <select className="input" value={band} onChange={(e) => setBand(e.target.value)}>
              <option value="2.4">{t('wifi_rf.band_24')}</option>
              <option value="5">{t('wifi_rf.band_5')}</option>
              <option value="6">{t('wifi_rf.band_6')}</option>
            </select>
          </div>
          <div className="field">
            <label className="label">{t('wifi_rf.ds_width_ch')}</label>
            <select className="input" value={width} onChange={(e) => setWidth(+e.target.value)}>
              {widthOptions.map(w => <option key={w} value={w}>{w} MHz</option>)}
            </select>
          </div>
        </div>

        <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }} onClick={simulateScan}>
          ⚡ {t('wifi_rf.ch_sel_sim_scan')}
        </button>
      </div>

      <div className="three-col">
        <div className="card">
          <div className="card-title" style={{ color: 'var(--green)' }}>
            <span className="badge badge-green" style={{ marginRight: 8 }}>✓</span>
            {t('wifi_rf.ch_sel_rec_channels')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {recommended.length > 0 ? recommended.map(c => (
              <span key={c.ch} className="badge badge-green" style={{ cursor: 'pointer' }} onClick={() => setSelectedChannel(c)}>
                Ch {c.ch} ({c.freq} MHz){c.dfs && ' DFS'}
              </span>
            )) : <div style={{ fontSize: 12, color: 'var(--dim)' }}>None available</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{ color: 'var(--yellow)' }}>
            <span className="badge badge-yellow" style={{ marginRight: 8 }}>!</span>
            {t('wifi_rf.ch_sel_acc_channels')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {acceptable.length > 0 ? acceptable.map(c => (
              <span key={c.ch} className="badge badge-yellow" style={{ cursor: 'pointer' }} onClick={() => setSelectedChannel(c)}>
                Ch {c.ch} ({c.freq} MHz){c.dfs && ' DFS'}
              </span>
            )) : <div style={{ fontSize: 12, color: 'var(--dim)' }}>None available</div>}
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{ color: 'var(--red)' }}>
            <span className="badge badge-red" style={{ marginRight: 8 }}>✗</span>
            {t('wifi_rf.ch_sel_avd_channels')}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
            {avoid.length > 0 ? avoid.map(c => (
              <span key={c.ch} className="badge badge-red" style={{ cursor: 'pointer' }} onClick={() => setSelectedChannel(c)}>
                Ch {c.ch} ({c.freq} MHz)
              </span>
            )) : <div style={{ fontSize: 12, color: 'var(--dim)' }}>None available</div>}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('wifi_rf.ch_sel_overview', { band })}</div>
        <p style={{ margin: '4px 0 16px', color: 'var(--muted)', fontSize: 12 }}>{t('wifi_rf.ch_sel_overview_subtitle')}</p>

        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
          gap: 10
        }}>
          {channelsData.map(c => {
            const isSel = selectedChannel?.ch === c.ch;
            const infColor = c.interference === 'high' ? 'var(--red)' : c.interference === 'medium' ? 'var(--yellow)' : 'var(--green)';
            const borderCol = isSel ? 'var(--cyan)' : 'var(--border)';

            return (
              <div key={c.ch} onClick={() => setSelectedChannel(c)} style={{
                padding: '12px 10px',
                background: 'var(--panel)',
                border: `1.5px solid ${borderCol}`,
                borderRadius: 8,
                cursor: 'pointer',
                textAlign: 'center',
                transition: 'border 0.2s',
                boxShadow: isSel ? '0 0 8px rgba(0, 212, 200, 0.25)' : 'none'
              }}>
                <div style={{ fontWeight: 700, fontSize: 14 }}>Ch {c.ch}</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', margin: '4px 0' }}>{c.freq} MHz</div>
                <div style={{ fontSize: 9, color: infColor, fontWeight: 600 }}>
                  ● {t(`wifi_rf.ch_sel_${c.interference}`)}
                </div>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginTop: 6 }}>
                  {c.dfs && <span className="badge badge-blue" style={{ fontSize: 8, padding: '1px 3px' }}>DFS</span>}
                  {c.psc && <span className="badge badge-purple" style={{ fontSize: 8, padding: '1px 3px' }}>PSC</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {selectedChannel && (
        <div className="card" style={{ borderColor: 'var(--cyan)' }}>
          <div className="card-title">Channel Detail: Ch {selectedChannel.ch}</div>
          <div className="result-grid" style={{ marginTop: 8 }}>
            <ResultItem label="Center Frequency" value={`${selectedChannel.freq} MHz`} />
            <ResultItem label="Channel Width" value={width + ' MHz'} />
            <ResultItem label="Interference Level" value={t(`wifi_rf.ch_sel_${selectedChannel.interference}`).toUpperCase()} red={selectedChannel.interference === 'high'} yellow={selectedChannel.interference === 'medium'} green={selectedChannel.interference === 'low'} />
            <ResultItem label="DFS Channel" value={selectedChannel.dfs ? 'Yes (requires Radar detection CAC)' : 'No'} />
            <ResultItem label="Preferred Scanning Channel (PSC)" value={selectedChannel.psc ? 'Yes (fast discovery)' : 'No'} />
            <ResultItem label="Recommendation" value={selectedChannel.recommendation.toUpperCase()} green={selectedChannel.recommendation === 'recommended'} yellow={selectedChannel.recommendation === 'acceptable'} red={selectedChannel.recommendation === 'avoid'} />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TAB 6 — WAP Config Generator
// ═══════════════════════════════════════════════════════════════════════════
function WAPConfigSection() {
  const { t } = useTranslation();
  const [ssid, setSsid] = usePersistentState('wifi-rf:wc-ssid', 'ENTERPRISE-WIFI');
  const [security, setSecurity] = usePersistentState('wifi-rf:wc-sec', 'wpa3');
  const [psk, setPsk] = usePersistentState('wifi-rf:wc-psk', 'SecureP@ss123');
  const [vlan, setVlan] = usePersistentState('wifi-rf:wc-vlan', 10);
  const [txPower, setTxPower] = usePersistentState('wifi-rf:wc-tx', 3);
  const [bands, setBands] = usePersistentState('wifi-rf:wc-bands', ['2.4', '5']);
  const [cfgTab, setCfgTab] = usePersistentState('wifi-rf:wc-tab', 'cisco');

  const toggleBand = useCallback((b) => {
    setBands(prev => prev.includes(b) ? prev.filter(x => x !== b) : [...prev, b]);
  }, []);

  const generatedConfigs = useMemo(() => {
    return {
      cisco: `! Cisco Catalyst 9800 WLC Configuration
wlan "${ssid}" 10 "${ssid}"
 client association limit 200
 vlan ${vlan}
${security === 'wpa2' ? ` security wpa psk set-key ascii 0 ${psk}
 security wpa wpa2
 security wpa wpa2 aes` : security === 'wpa3' ? ` security wpa psk set-key ascii 0 ${psk}
 security wpa wpa3 sae
 security wpa pmf mandatory` : security === 'mixed' ? ` security wpa psk set-key ascii 0 ${psk}
 security wpa wpa2
 security wpa wpa3 sae
 security wpa pmf optional` : ` security wpa wpa2
 security dot1x authentication wlan-auth-list`}
 no shutdown
!
wlan profile-policy "${ssid}-policy"
 description "Generated Policy Profile"
 vlan ${vlan}
 central switching
 central association
 central dhcp
 no shutdown
!
${bands.includes('2.4') ? `ap profile default-ap-profile
  radio 2.4ghz
   tx-power level ${txPower}
   shutdown
   no shutdown
!
` : ''}${bands.includes('5') ? `ap profile default-ap-profile
  radio 5ghz
   tx-power level ${txPower}
   shutdown
   no shutdown
!
` : ''}`,
      aruba: `! ArubaOS Mobility Controller CLI
wlan ssid-profile "${ssid}-ssid"
  essid "${ssid}"
  opmode ${security === 'ent' ? 'wpa2-ent' : 'opensystem'}
${security === 'wpa2' ? `  wpa2-psk-aes ${psk}` : security === 'wpa3' ? `  wpa3-sae-aes ${psk}
  wpa3-sae-pmf-mandatory` : security === 'mixed' ? `  wpa2-psk-aes ${psk}
  wpa3-sae-aes ${psk}
  wpa3-sae-pmf-optional` : `  wpa2-enterprise-aes
  opmode wpa2-ent`}
  vlan ${vlan}
  rf-band ${bands.join('-')}
!
wlan virtual-ap "${ssid}-vap"
  vlan ${vlan}
  ssid-profile "${ssid}-ssid"
  allowed-band ${bands.join('-')}
!
rf dot11a-radio-profile "default-a"
  tx-power-max ${Math.max(10, 21 - txPower * 2)}
  tx-power-min ${Math.max(6, 12 - txPower)}
!
rf dot11g-radio-profile "default-g"
  tx-power-max ${Math.max(8, 15 - txPower * 2)}
  tx-power-min ${Math.max(4, 6 - txPower)}
`,
      ruckus: `# Ruckus SmartZone CLI Configuration
configure
  wlan "${ssid}"
    ssid "${ssid}"
    type standard
    vlan ${vlan}
    encryption aes
    security-mode ${security === 'wpa3' ? 'wpa3' : security === 'mixed' ? 'wpa-mixed' : security === 'ent' ? 'wpa2-enterprise' : 'wpa2'}
    ${security !== 'ent' ? `passphrase "${psk}"` : 'radius-server corporate-radius'}
    no shutdown
  exit
  ap-group "Default"
    wlan-member "${ssid}"
    radio 2.4G tx-power-control ${txPower}
    radio 5G tx-power-control ${txPower}
exit
`,
      ubiquiti: `# Ubiquiti UniFi CLI Config Commands
set service unifi-controller wlan "${ssid}" ssid "${ssid}"
set service unifi-controller wlan "${ssid}" vlan ${vlan}
${security === 'wpa2' ? `set service unifi-controller wlan "${ssid}" security wpa2 psk "${psk}"` : security === 'wpa3' ? `set service unifi-controller wlan "${ssid}" security wpa3 sae "${psk}"
set service unifi-controller wlan "${ssid}" pmf mandatory` : security === 'mixed' ? `set service unifi-controller wlan "${ssid}" security wpa-mixed psk "${psk}"
set service unifi-controller wlan "${ssid}" pmf optional` : `set service unifi-controller wlan "${ssid}" security wpa2 enterprise`}
set service unifi-controller wlan "${ssid}" enabled true
set interfaces ethernet eth0 vif ${vlan} description "${ssid}-VLAN"
`
    };
  }, [ssid, security, psk, vlan, txPower, bands]);

  const activeConfig = generatedConfigs[cfgTab];

  return (
    <div className="fadein">
      <div className="two-col">
        <div className="card">
          <div className="card-title">{t('wifi_rf.wap_cfg_title')}</div>
          <p style={{ margin: '4px 0 16px', color: 'var(--muted)', fontSize: 13 }}>{t('wifi_rf.wap_cfg_subtitle')}</p>

          <div className="field">
            <label className="label">{t('wifi_rf.wap_cfg_ssid')}</label>
            <input className="input" type="text" value={ssid} onChange={(e) => setSsid(e.target.value)} />
          </div>

          <div className="field">
            <label className="label">{t('wifi_rf.wap_cfg_sec')}</label>
            <select className="input" value={security} onChange={(e) => setSecurity(e.target.value)}>
              <option value="wpa2">WPA2-PSK (AES)</option>
              <option value="wpa3">WPA3-SAE (Mandatory PMF)</option>
              <option value="mixed">WPA2/WPA3 Mixed</option>
              <option value="ent">WPA2/WPA3 Enterprise (802.1X)</option>
            </select>
          </div>

          {security !== 'ent' && (
            <div className="field">
              <label className="label">{t('wifi_rf.wap_cfg_psk')}</label>
              <input className="input" type="password" value={psk} onChange={(e) => setPsk(e.target.value)} />
            </div>
          )}

          <div className="two-col">
            <div className="field">
              <label className="label">{t('wifi_rf.wap_cfg_vlan')}</label>
              <input className="input" type="number" value={vlan} onChange={(e) => setVlan(+e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('wifi_rf.wap_cfg_tx_power')}</label>
              <select className="input" value={txPower} onChange={(e) => setTxPower(+e.target.value)}>
                <option value="1">1 (Max Power)</option>
                <option value="2">2</option>
                <option value="3">3 (Default)</option>
                <option value="4">4</option>
                <option value="5">5</option>
                <option value="6">6</option>
                <option value="7">7</option>
                <option value="8">8 (Min Power)</option>
              </select>
            </div>
          </div>

          <div className="field">
            <label className="label">{t('wifi_rf.wap_cfg_radios')}</label>
            <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={bands.includes('2.4')} onChange={() => toggleBand('2.4')} />
                {t('wifi_rf.wap_cfg_radio_24')}
              </label>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={bands.includes('5')} onChange={() => toggleBand('5')} />
                {t('wifi_rf.wap_cfg_radio_5')}
              </label>
              <label style={{ fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                <input type="checkbox" checked={bands.includes('6')} onChange={() => toggleBand('6')} />
                {t('wifi_rf.wap_cfg_radio_6')}
              </label>
            </div>
          </div>
        </div>

        <div>
          <div className="card">
            <div style={{ display: 'flex', gap: 6, marginBottom: 12, overflowX: 'auto' }}>
              <button className={`btn btn-sm ${cfgTab === 'cisco' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCfgTab('cisco')}>
                {t('wifi_rf.wap_cfg_cisco')}
              </button>
              <button className={`btn btn-sm ${cfgTab === 'aruba' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCfgTab('aruba')}>
                {t('wifi_rf.wap_cfg_aruba')}
              </button>
              <button className={`btn btn-sm ${cfgTab === 'ruckus' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCfgTab('ruckus')}>
                {t('wifi_rf.wap_cfg_ruckus')}
              </button>
              <button className={`btn btn-sm ${cfgTab === 'ubiquiti' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCfgTab('ubiquiti')}>
                {t('wifi_rf.wap_cfg_ubiquiti')}
              </button>
            </div>

            <pre style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              padding: '12px 14px',
              borderRadius: 8,
              fontSize: '0.8rem',
              overflow: 'auto',
              fontFamily: 'monospace',
              maxHeight: 380
            }}>
              <code>{activeConfig}</code>
            </pre>

            <div style={{ marginTop: 12 }}>
              <CopyBtn text={activeConfig} id="wap-cfg-copy" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  TAB 7 — Security Practices
// ═══════════════════════════════════════════════════════════════════════════
function SecurityPracticesSection() {
  const { t } = useTranslation();
  const [checklist, setChecklist] = usePersistentState('wifi-rf:sec-checklist', {
    wpa3: true,
    pmf: true,
    guest_iso: true,
    no_legacy: false,
    mgmt_acl: false,
    rogue_det: false,
    mfa: false,
    fast_roam: true
  });

  const toggleCheck = useCallback((key) => {
    setChecklist(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  const checklistItems = [
    { key: 'wpa3', weight: 15, label: t('wifi_rf.sec_prac_opt_wpa3') },
    { key: 'pmf', weight: 15, label: t('wifi_rf.sec_prac_opt_pmf') },
    { key: 'guest_iso', weight: 15, label: t('wifi_rf.sec_prac_opt_guest_iso') },
    { key: 'no_legacy', weight: 15, label: t('wifi_rf.sec_prac_opt_no_legacy') },
    { key: 'mgmt_acl', weight: 10, label: t('wifi_rf.sec_prac_opt_mgmt_acl') },
    { key: 'rogue_det', weight: 10, label: t('wifi_rf.sec_prac_opt_rogue_det') },
    { key: 'mfa', weight: 10, label: t('wifi_rf.sec_prac_opt_mfa') },
    { key: 'fast_roam', weight: 10, label: t('wifi_rf.sec_prac_opt_fast_roam') }
  ];

  const score = useMemo(() => {
    return checklistItems.reduce((acc, item) => {
      return acc + (checklist[item.key] ? item.weight : 0);
    }, 0);
  }, [checklist]);

  const grade = useMemo(() => {
    if (score >= 90) return { label: 'A', class: 'badge-green' };
    if (score >= 80) return { label: 'B', class: 'badge-green' };
    if (score >= 70) return { label: 'C', class: 'badge-yellow' };
    if (score >= 60) return { label: 'D', class: 'badge-yellow' };
    return { label: 'F', class: 'badge-red' };
  }, [score]);

  return (
    <div className="fadein">
      <div className="two-col">
        <div className="card">
          <div className="card-title">{t('wifi_rf.sec_prac_title')}</div>
          <p style={{ margin: '4px 0 16px', color: 'var(--muted)', fontSize: 13 }}>{t('wifi_rf.sec_prac_subtitle')}</p>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {checklistItems.map(item => (
              <label key={item.key} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontSize: 13,
                cursor: 'pointer',
                padding: '6px 0'
              }}>
                <input type="checkbox" checked={checklist[item.key]} onChange={() => toggleCheck(item.key)} style={{ marginTop: 3 }} />
                <div>
                  <span style={{ fontWeight: 600 }}>{item.label}</span>
                  <span className="badge badge-blue" style={{ fontSize: 9, padding: '1px 4px', marginLeft: 8 }}>+{item.weight} pts</span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-title">{t('wifi_rf.sec_prac_score')}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16, margin: '14px 0' }}>
              <div style={{ fontSize: 36, fontWeight: 800, color: 'var(--cyan)' }}>{score} / 100</div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{t('wifi_rf.sec_prac_grade')}</div>
                <span className={`badge ${grade.class}`} style={{ fontSize: 16, padding: '3px 8px' }}>{grade.label}</span>
              </div>
            </div>

            <div style={{
              background: 'var(--panel)',
              height: 10,
              borderRadius: 5,
              overflow: 'hidden',
              border: '1px solid var(--border)'
            }}>
              <div style={{
                background: 'var(--cyan)',
                width: `${score}%`,
                height: '100%',
                transition: 'width 0.3s'
              }}></div>
            </div>

            <div className="card-title" style={{ marginTop: 20 }}>{t('wifi_rf.sec_prac_action')}</div>
            <ul style={{
              paddingLeft: 18,
              fontSize: 12,
              color: 'var(--muted)',
              lineHeight: 1.6,
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}>
              {checklistItems.filter(item => !checklist[item.key]).map(item => (
                <li key={item.key}>
                  <strong style={{ color: 'var(--fg)' }}>{item.label}</strong>
                  <span style={{ marginLeft: 6 }}>— Recommended security mitigation. (+{item.weight} points score increase)</span>
                </li>
              ))}
              {score === 100 && (
                <li style={{ color: 'var(--green)', listStyleType: 'none', marginLeft: -18 }}>
                  🎉 <strong>All controls set! Your deployment meets our enterprise baseline requirements.</strong>
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Shell
// ═══════════════════════════════════════════════════════════════════════════
function WirelessRFPlanner({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('wifi-rf:active-tab', initialData?.tab ?? 'design');
  const skipNavReport = useRef(false);
  useEffect(() => {
    if (initialData?.tab && initialData.tab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.tab);
    }
  }, [initialData]);
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ tab: activeTab });
  }, [activeTab]);

  const tabs = [
    { id: 'design', label: t('wifi_rf.tab_design') },
    { id: 'channels', label: t('wifi_rf.tab_channels') },
    { id: 'wapconfig', label: t('wifi_rf.tab_wapconfig') },
    { id: 'security', label: t('wifi_rf.tab_security') },
    { id: 'reference', label: t('wifi_rf.tab_reference') },
    { id: 'ptp', label: t('wifi_rf.tab_ptp') },
    { id: 'cheatsheet', label: t('wifi_rf.tab_cheatsheet') },
  ];

  return (
    <div className="fadein">
      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {tabs.map((tab) => (
          <button key={tab.id} className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab(tab.id)}>
            {tab.label}
          </button>
        ))}
      </div>
      <div className="tab-content">
        {activeTab === 'design' && <DesignStudioSection initialData={initialData} onShare={onShare} />}
        {activeTab === 'channels' && <ChannelSelectionSection />}
        {activeTab === 'wapconfig' && <WAPConfigSection />}
        {activeTab === 'security' && <SecurityPracticesSection />}
        {activeTab === 'reference' && <ReferenceDeckSection />}
        {activeTab === 'ptp' && <PtPLinkSection initialData={initialData} onShare={onShare} />}
        {activeTab === 'cheatsheet' && <CheatSheetSection />}
      </div>
    </div>
  );
}

window.WirelessRFPlanner = WirelessRFPlanner;
window.__RF_ENGINE = RF; // exposed for engine unit checks

