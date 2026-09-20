const { useState, useEffect, useCallback, useMemo } = React;

// ── LoRa Airtime Calculation ──────────────────────────────────────────
// Semtech SX1272/76 physical layer formula
function calcLoRaAirtime({ sf, bw, cr, payload, nPreamble }) {
  const bwHz = bw;
  const PL = payload;
  const CR = cr; // 1=4/5, 2=4/6, 3=4/7, 4=4/8
  const IH = 0;  // explicit header mode
  const CRC = 1;  // CRC enabled
  const DE = sf >= 11 ? 1 : 0; // low data rate optimize

  const tSymbol = Math.pow(2, sf) / bwHz; // seconds
  const tPreamble = (nPreamble + 4.25) * tSymbol;

  const numerator = 8 * PL - 4 * sf + 28 + 16 * CRC - 20 * IH;
  const denominator = 4 * (sf - 2 * DE);
  const nPayloadCycles = Math.max(Math.ceil(numerator / denominator) * (CR + 4), 0);
  const nPayload = 8 + nPayloadCycles;

  const tPayload = nPayload * tSymbol;
  const toa = tPreamble + tPayload; // seconds

  const dataRate = sf * (4 / (4 + CR)) * bwHz / Math.pow(2, sf); // bps

  return {
    toaMs: toa * 1000,
    toaS: toa,
    dataRate: dataRate,
    nPayload: nPayload,
    tPreambleMs: tPreamble * 1000,
    tPayloadMs: tPayload * 1000,
    tSymbolMs: tSymbol * 1000,
    de: DE,
  };
}

// ── SF reference data ─────────────────────────────────────────────────
const SF_DATA = {
  7:  { sensitivity: -123,  rangeUrban: 2,  rangeRural: 10 },
  8:  { sensitivity: -126,  rangeUrban: 3,  rangeRural: 15 },
  9:  { sensitivity: -128.5,rangeUrban: 5,  rangeRural: 20 },
  10: { sensitivity: -131,  rangeUrban: 7,  rangeRural: 25 },
  11: { sensitivity: -133.5,rangeUrban: 10, rangeRural: 30 },
  12: { sensitivity: -136,  rangeUrban: 15, rangeRural: 35 },
};

// ── Duty cycle regions ────────────────────────────────────────────────
const REGIONS = [
  { id: 'eu868',  dutyCycle: 0.01, maxDwell: null },
  { id: 'us915',  dutyCycle: null, maxDwell: 0.4  },
  { id: 'as923',  dutyCycle: 0.01, maxDwell: null },
  { id: 'au915',  dutyCycle: null, maxDwell: 0.4  },
  { id: 'cn470',  dutyCycle: 0.01, maxDwell: null },
  { id: 'in865',  dutyCycle: 0.01, maxDwell: null },
  { id: 'kr920',  dutyCycle: 0.01, maxDwell: null },
  { id: 'ru864',  dutyCycle: 0.01, maxDwell: null },
];

// ── SF distribution profiles ──────────────────────────────────────────
const SF_PROFILES = {
  balanced:  { 7: 0.15, 8: 0.17, 9: 0.18, 10: 0.18, 11: 0.16, 12: 0.16 },
  adr:       { 7: 0.35, 8: 0.25, 9: 0.20, 10: 0.12, 11: 0.05, 12: 0.03 },
  close:     { 7: 0.50, 8: 0.25, 9: 0.15, 10: 0.07, 11: 0.02, 12: 0.01 },
  long:      { 7: 0.05, 8: 0.10, 9: 0.15, 10: 0.25, 11: 0.25, 12: 0.20 },
};

function getRecommendedDistribution(density, environment) {
  // ADR-like recommendations based on density and environment
  if (environment === 'urban') {
    if (density < 100)  return { 7: 0.40, 8: 0.25, 9: 0.15, 10: 0.10, 11: 0.06, 12: 0.04 };
    if (density < 500)  return { 7: 0.30, 8: 0.25, 9: 0.20, 10: 0.13, 11: 0.07, 12: 0.05 };
    if (density < 2000) return { 7: 0.20, 8: 0.22, 9: 0.22, 10: 0.18, 11: 0.10, 12: 0.08 };
    return                  { 7: 0.15, 8: 0.18, 9: 0.20, 10: 0.20, 11: 0.14, 12: 0.13 };
  }
  // Rural
  if (density < 50)   return { 7: 0.20, 8: 0.20, 9: 0.20, 10: 0.20, 11: 0.12, 12: 0.08 };
  if (density < 200)  return { 7: 0.15, 8: 0.18, 9: 0.22, 10: 0.20, 11: 0.14, 12: 0.11 };
  return                  { 7: 0.10, 8: 0.15, 9: 0.20, 10: 0.22, 11: 0.18, 12: 0.15 };
}

// ── Component ─────────────────────────────────────────────────────────
function LoRaWANPlanner({ initialData, onShare }) {
  const { t } = useTranslation();

  // Airtime calculator state
  const [sf, setSf] = usePersistentState('lorawan:sf', (initialData || {}).sf ?? 7);
  const [bw, setBw] = usePersistentState('lorawan:bw', (initialData || {}).bw ?? 125000);
  const [cr, setCr] = usePersistentState('lorawan:cr', (initialData || {}).cr ?? 1);
  const [payload, setPayload] = usePersistentState('lorawan:payload', (initialData || {}).payload ?? 20);
  const [nPreamble] = usePersistentState('lorawan:preamble', (initialData || {}).nPreamble ?? 8);

  // Capacity estimator state
  const [region, setRegion] = usePersistentState('lorawan:region', (initialData || {}).region ?? 'eu868');
  const [numGateways, setNumGateways] = usePersistentState('lorawan:gateways', (initialData || {}).gateways ?? 1);
  const [msgsPerDay, setMsgsPerDay] = usePersistentState('lorawan:msgs', (initialData || {}).msgs ?? 24);
  const [sfProfile, setSfProfile] = usePersistentState('lorawan:profile', (initialData || {}).profile ?? 'adr');

  // Collision probability state
  const [colDevices, setColDevices] = usePersistentState('lorawan:colDevices', (initialData || {}).colDevices ?? 100);
  const [colInterval, setColInterval] = usePersistentState('lorawan:colInterval', (initialData || {}).colInterval ?? 600);

  // Recommendation state
  const [density, setDensity] = usePersistentState('lorawan:density', (initialData || {}).density ?? 200);
  const [env, setEnv] = usePersistentState('lorawan:env', (initialData || {}).env ?? 'urban');

  // Share URL
  useEffect(() => {
    const handle = (e) => (e.detail || {}).respond !== undefined
      ? (e.detail.respond(onShare))
      : onShare({
          tool: 'lorawan-planner', sf, bw, cr, payload, nPreamble,
          region, gateways: numGateways, msgs: msgsPerDay, profile: sfProfile,
          colDevices, colInterval, density, env,
        });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [sf, bw, cr, payload, nPreamble, region, numGateways, msgsPerDay, sfProfile, colDevices, colInterval, density, env, onShare]);

  // ── Calculations ──
  const airtimeResult = useMemo(() => calcLoRaAirtime({ sf, bw, cr, payload, nPreamble }), [sf, bw, cr, payload, nPreamble]);

  const sfComparison = useMemo(() => {
    return [7, 8, 9, 10, 11, 12].map(s => {
      const r = calcLoRaAirtime({ sf: s, bw, cr, payload, nPreamble });
      return { sf: s, ...r, ...SF_DATA[s] };
    });
  }, [bw, cr, payload, nPreamble]);

  const capacityResult = useMemo(() => {
    const regionInfo = REGIONS.find(r => r.id === region) || REGIONS[0];
    const dist = SF_PROFILES[sfProfile] || SF_PROFILES.adr;
    // Weighted average ToA across SF distribution
    let weightedToA = 0;
    for (let s = 7; s <= 12; s++) {
      const r = calcLoRaAirtime({ sf: s, bw, cr, payload, nPreamble });
      weightedToA += (dist[s] || 0) * r.toaS;
    }
    const dutyCycleFraction = (regionInfo.dutyCycle || 0.01);
    const dailyBudget = dutyCycleFraction * 86400; // seconds per day per channel
    const perDeviceDaily = msgsPerDay * weightedToA; // seconds
    const maxPerGateway = perDeviceDaily > 0 ? Math.floor(dailyBudget / perDeviceDaily) : 0;
    const totalMax = maxPerGateway * numGateways;
    const perDeviceUtilization = perDeviceDaily * totalMax / (dailyBudget * numGateways);

    return {
      weightedToAMs: weightedToA * 1000,
      dailyBudgetMs: dailyBudget * 1000,
      perDeviceDailyMs: perDeviceDaily * 1000,
      maxPerGateway,
      totalMax,
      utilization: perDeviceUtilization * 100,
      distribution: dist,
      regionInfo,
    };
  }, [region, numGateways, msgsPerDay, sfProfile, bw, cr, payload, nPreamble]);

  const collisionResult = useMemo(() => {
    const N = colDevices;
    const T = colInterval; // seconds between transmissions
    const ToA = airtimeResult.toaS;
    // Pure ALOHA: P_collision = 1 - e^(-2 * N * ToA / T)
    const g = 2 * N * ToA / T; // offered load
    const pCollision = 1 - Math.exp(-g);
    const pSuccess = 1 - pCollision;
    return { pCollision: pCollision * 100, pSuccess: pSuccess * 100, g };
  }, [colDevices, colInterval, airtimeResult.toaS]);

  const recommendation = useMemo(() => {
    return getRecommendedDistribution(density, env);
  }, [density, env]);

  // ── Helpers ──
  const formatMs = (ms) => ms < 1 ? ms.toFixed(3) : ms < 100 ? ms.toFixed(2) : ms.toFixed(1);
  const formatRate = (bps) => bps >= 1000 ? (bps / 1000).toFixed(2) : bps.toFixed(1);
  const colorForPercent = (pct) => pct > 70 ? 'var(--red)' : pct > 40 ? 'var(--yellow)' : 'var(--green)';

  return (
    <div className="fadein">
      {/* ── Airtime Calculator ── */}
      <div className="card">
        <div className="card-title">{t('lorawan_planner.airtime_title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>{t('lorawan_planner.airtime_desc')}</p>

        <div className="two-col">
          <div className="field">
            <label className="label">{t('lorawan_planner.sf')}</label>
            <select className="input" value={sf} onChange={e => setSf(+e.target.value)}>
              {[7, 8, 9, 10, 11, 12].map(s => <option key={s} value={s}>SF{s}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">{t('lorawan_planner.bandwidth')}</label>
            <select className="input" value={bw} onChange={e => setBw(+e.target.value)}>
              <option value={125000}>125 kHz</option>
              <option value={250000}>250 kHz</option>
              <option value={500000}>500 kHz</option>
            </select>
          </div>
        </div>
        <div className="two-col">
          <div className="field">
            <label className="label">{t('lorawan_planner.coding_rate')}</label>
            <select className="input" value={cr} onChange={e => setCr(+e.target.value)}>
              <option value={1}>4/5</option>
              <option value={2}>4/6</option>
              <option value={3}>4/7</option>
              <option value={4}>4/8</option>
            </select>
          </div>
          <div className="field">
            <label className="label">{t('lorawan_planner.payload_size')}</label>
            <input className="input" type="number" min="1" max="255" value={payload}
              onChange={e => setPayload(Math.max(1, Math.min(255, +e.target.value || 1)))} />
            <div className="hint">{t('lorawan_planner.payload_hint')}</div>
          </div>
        </div>

        {airtimeResult && (
          <div style={{ marginTop: 16 }}>
            <div className="result-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
              <ResultItem label={t('lorawan_planner.result_toa')} value={formatMs(airtimeResult.toaMs) + ' ms'} accent />
              <ResultItem label={t('lorawan_planner.result_data_rate')} value={formatRate(airtimeResult.dataRate) + ' bps'} />
              <ResultItem label={t('lorawan_planner.result_payload_symbols')} value={airtimeResult.nPayload} />
              <ResultItem label={t('lorawan_planner.result_preamble_time')} value={formatMs(airtimeResult.tPreambleMs) + ' ms'} />
              <ResultItem label={t('lorawan_planner.result_payload_time')} value={formatMs(airtimeResult.tPayloadMs) + ' ms'} />
            </div>
            {airtimeResult.de === 1 && (
              <div className="hint" style={{ marginTop: 8 }}>
                {t('lorawan_planner.de_enabled')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── SF Comparison Table ── */}
      <div className="card">
        <div className="card-title">{t('lorawan_planner.comparison_title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 12, marginBottom: 12 }}>
          {t('lorawan_planner.comparison_note', { payload: payload, bw: bw / 1000, cr: cr + 4 })}
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                {[
                  t('lorawan_planner.col_sf'),
                  t('lorawan_planner.col_toa'),
                  t('lorawan_planner.col_data_rate'),
                  t('lorawan_planner.col_sensitivity'),
                  t('lorawan_planner.col_range_urban'),
                  t('lorawan_planner.col_range_rural'),
                ].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sfComparison.map((row, i) => (
                <tr key={row.sf} style={{ borderBottom: '1px solid var(--border)', background: row.sf === sf ? 'var(--panel)' : undefined }}>
                  <td style={{ padding: '6px 10px', fontWeight: 600 }}>SF{row.sf}</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{formatMs(row.toaMs)} ms</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{formatRate(row.dataRate)} bps</td>
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{row.sensitivity} dBm</td>
                  <td style={{ padding: '6px 10px' }}>~{row.rangeUrban} km</td>
                  <td style={{ padding: '6px 10px' }}>~{row.rangeRural} km</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Duty Cycle Limits by Region ── */}
      <div className="card">
        <div className="card-title">{t('lorawan_planner.duty_cycle_title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 12 }}>{t('lorawan_planner.duty_cycle_desc')}</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '2px solid var(--border)' }}>
                {[
                  t('lorawan_planner.col_region'),
                  t('lorawan_planner.col_duty_cycle'),
                  t('lorawan_planner.col_max_airtime'),
                  t('lorawan_planner.col_notes'),
                ].map(h => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {REGIONS.map(r => {
                const dcPct = r.dutyCycle !== null ? (r.dutyCycle * 100) + '%' : t('lorawan_planner.no_limit');
                const maxAirtime = r.dutyCycle !== null ? (r.dutyCycle * 3600).toFixed(1) + ' s' : '—';
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>{t('lorawan_planner.region_' + r.id)}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{dcPct}</td>
                    <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{maxAirtime}</td>
                    <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>{t('lorawan_planner.note_' + r.id)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Gateway Capacity Estimator ── */}
      <div className="card">
        <div className="card-title">{t('lorawan_planner.capacity_title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>{t('lorawan_planner.capacity_desc')}</p>

        <div className="two-col">
          <div className="field">
            <label className="label">{t('lorawan_planner.region')}</label>
            <select className="input" value={region} onChange={e => setRegion(e.target.value)}>
              {REGIONS.map(r => <option key={r.id} value={r.id}>{t('lorawan_planner.region_' + r.id)}</option>)}
            </select>
          </div>
          <div className="field">
            <label className="label">{t('lorawan_planner.num_gateways')}</label>
            <input className="input" type="number" min="1" max="1000" value={numGateways}
              onChange={e => setNumGateways(Math.max(1, +e.target.value || 1))} />
          </div>
        </div>
        <div className="two-col">
          <div className="field">
            <label className="label">{t('lorawan_planner.msgs_per_day')}</label>
            <input className="input" type="number" min="1" max="1440" value={msgsPerDay}
              onChange={e => setMsgsPerDay(Math.max(1, +e.target.value || 1))} />
          </div>
          <div className="field">
            <label className="label">{t('lorawan_planner.sf_distribution')}</label>
            <select className="input" value={sfProfile} onChange={e => setSfProfile(e.target.value)}>
              <option value="balanced">{t('lorawan_planner.profile_balanced')}</option>
              <option value="adr">{t('lorawan_planner.profile_adr')}</option>
              <option value="close">{t('lorawan_planner.profile_close')}</option>
              <option value="long">{t('lorawan_planner.profile_long')}</option>
            </select>
          </div>
        </div>

        {capacityResult && (
          <div style={{ marginTop: 16 }}>
            <div className="result-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
              <ResultItem label={t('lorawan_planner.result_max_devices')} value={<span style={{ color: 'var(--green)' }}>{capacityResult.totalMax.toLocaleString()}</span>} accent />
              <ResultItem label={t('lorawan_planner.result_per_gw')} value={capacityResult.maxPerGateway.toLocaleString()} />
              <ResultItem label={t('lorawan_planner.result_weighted_toa')} value={formatMs(capacityResult.weightedToAMs) + ' ms'} />
              <ResultItem label={t('lorawan_planner.result_per_device')} value={formatMs(capacityResult.perDeviceDailyMs) + ' ms'} />
              <ResultItem label={t('lorawan_planner.result_utilization')} value={<span style={{ color: colorForPercent(capacityResult.utilization) }}>{capacityResult.utilization.toFixed(1)}%</span>} />
            </div>

            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{t('lorawan_planner.sf_profile_breakdown')}</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {[7, 8, 9, 10, 11, 12].map(s => (
                  <span key={s} className="badge" style={{ fontFamily: 'monospace' }}>
                    SF{s}: {Math.round(((capacityResult.distribution[s] || 0) * 100))}%
                  </span>
                ))}
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>{t('lorawan_planner.capacity_note')}</p>
          </div>
        )}
      </div>

      {/* ── Collision Probability ── */}
      <div className="card">
        <div className="card-title">{t('lorawan_planner.collision_title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>{t('lorawan_planner.collision_desc')}</p>

        <div className="two-col">
          <div className="field">
            <label className="label">{t('lorawan_planner.num_devices')}</label>
            <input className="input" type="number" min="1" max="100000" value={colDevices}
              onChange={e => setColDevices(Math.max(1, +e.target.value || 1))} />
          </div>
          <div className="field">
            <label className="label">{t('lorawan_planner.avg_interval')} (s)</label>
            <input className="input" type="number" min="1" max="86400" value={colInterval}
              onChange={e => setColInterval(Math.max(1, +e.target.value || 1))} />
          </div>
        </div>

        {collisionResult && (
          <div style={{ marginTop: 16 }}>
            <div className="result-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))' }}>
              <ResultItem label={t('lorawan_planner.collision_prob')} value={<span style={{ color: colorForPercent(collisionResult.pCollision) }}>{collisionResult.pCollision.toFixed(2)}%</span>} accent />
              <ResultItem label={t('lorawan_planner.collision_success')} value={<span style={{ color: collisionResult.pSuccess > 60 ? 'var(--green)' : 'var(--yellow)' }}>{collisionResult.pSuccess.toFixed(2)}%</span>} />
              <ResultItem label={t('lorawan_planner.offered_load')} value={collisionResult.g.toFixed(4)} />
              <ResultItem label={t('lorawan_planner.result_toa_used')} value={formatMs(airtimeResult.toaMs) + ' ms'} />
            </div>

            <div style={{ marginTop: 16, marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>
                <span>{t('lorawan_planner.collision_prob')}</span>
                <span>{collisionResult.pCollision.toFixed(1)}%</span>
              </div>
              <div style={{ position: 'relative', height: 20, background: 'var(--panel)', borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
                <div style={{
                  height: '100%',
                  width: Math.min(100, collisionResult.pCollision) + '%',
                  background: collisionResult.pCollision > 70 ? 'var(--red)' : collisionResult.pCollision > 40 ? 'var(--yellow)' : 'var(--green)',
                  borderRadius: 10,
                  transition: 'width 0.3s',
                }} />
              </div>
            </div>

            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 0, marginBottom: 4 }}>
              {t('lorawan_planner.collision_formula')}
            </p>
            <p style={{ fontSize: 12, color: 'var(--muted)' }}>
              {t('lorawan_planner.collision_note')}
            </p>
          </div>
        )}
      </div>

      {/* ── Recommended SF Distribution ── */}
      <div className="card">
        <div className="card-title">{t('lorawan_planner.recommendation_title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>{t('lorawan_planner.recommendation_desc')}</p>

        <div className="two-col">
          <div className="field">
            <label className="label">{t('lorawan_planner.density')} (devices/km²)</label>
            <input className="input" type="number" min="1" max="100000" value={density}
              onChange={e => setDensity(Math.max(1, +e.target.value || 1))} />
          </div>
          <div className="field">
            <label className="label">{t('lorawan_planner.environment')}</label>
            <select className="input" value={env} onChange={e => setEnv(e.target.value)}>
              <option value="urban">{t('lorawan_planner.env_urban')}</option>
              <option value="rural">{t('lorawan_planner.env_rural')}</option>
            </select>
          </div>
        </div>

        {recommendation && (
          <div style={{ marginTop: 16 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)' }}>
                    <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)' }}>{t('lorawan_planner.col_sf')}</th>
                    <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)' }}>{t('lorawan_planner.col_allocation')}</th>
                    <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', minWidth: 200 }}>{t('lorawan_planner.col_distribution')}</th>
                    <th style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)' }}>{t('lorawan_planner.col_est_range')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[7, 8, 9, 10, 11, 12].map(s => {
                    const pct = Math.round((recommendation[s] || 0) * 100);
                    const rangeData = SF_DATA[s];
                    const range = env === 'urban' ? rangeData.rangeUrban : rangeData.rangeRural;
                    return (
                      <tr key={s} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '6px 10px', fontWeight: 600 }}>SF{s}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{pct}%</td>
                        <td style={{ padding: '6px 10px' }}>
                          <div style={{ position: 'relative', height: 14, background: 'var(--panel)', borderRadius: 7, overflow: 'hidden', border: '1px solid var(--border)' }}>
                            <div style={{
                              height: '100%',
                              width: pct + '%',
                              background: 'var(--cyan)',
                              borderRadius: 7,
                              transition: 'width 0.3s',
                              opacity: 0.8,
                            }} />
                          </div>
                        </td>
                        <td style={{ padding: '6px 10px', color: 'var(--muted)' }}>~{range} km</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 12 }}>{t('lorawan_planner.recommendation_note')}</p>
          </div>
        )}
      </div>
    </div>
  );
}

window.LoRaWANPlanner = LoRaWANPlanner;
