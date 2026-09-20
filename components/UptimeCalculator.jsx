const { useState, useEffect, useCallback, useMemo } = React;

function UptimeCalculator({ onShare, onNav, initialData }) {
  const { t } = useTranslation();

  // Tab State
  const [tab, setTab] = usePersistentState('uptime:tab', initialData?.activeTab ?? initialData?.tab ?? 'downtime');

  // Tab 1: SLA -> Downtime State
  const [uptimePercent, setUptimePercent] = usePersistentState('uptime:uptimePercent', initialData?.uptimePercent ?? '99.9');
  const [period, setPeriod] = usePersistentState('uptime:period', initialData?.period ?? 'year'); // year | quarter | month | week | day

  // Tab 2: Composite SLA State
  const [segs, setSegs] = usePersistentState('uptime:segs', initialData?.segs ?? [
    { name: 'ISP / WAN',     sla: '99.9' },
    { name: 'Firewall',      sla: '99.95' },
    { name: 'Core Switch',   sla: '99.999' },
    { name: 'Server',        sla: '99.9' },
  ]);

  // Tab 3: Outage Impact State
  const [outageSla, setOutageSla] = usePersistentState('uptime:outageSla', initialData?.outageSla ?? '99.9');
  const [outageDur, setOutageDur] = usePersistentState('uptime:outageDur', initialData?.outageDur ?? '4');
  const [outageUnit, setOutageUnit] = usePersistentState('uptime:outageUnit', initialData?.outageUnit ?? 'hours'); // hours | minutes | seconds
  const [outagePer, setOutagePer] = usePersistentState('uptime:outagePer', initialData?.outagePer ?? 'month'); // year | quarter | month | week | day

  const PERIOD_SECONDS = useMemo(() => ({
    year: 365.25 * 86400,
    quarter: (365.25 / 4) * 86400,
    month: (365.25 / 12) * 86400,
    week: 7 * 86400,
    day: 86400
  }), []);

  const PERIOD_LABELS = useMemo(() => ({
    year: t('uptime.periods.year'),
    quarter: t('uptime.periods.quarter'),
    month: t('uptime.periods.month'),
    week: t('uptime.periods.week'),
    day: t('uptime.periods.day')
  }), [t]);

  const NINES_TABLE = useMemo(() => [
    { label: t('uptime.nines.one'), pct: 90, color: 'var(--red)' },
    { label: t('uptime.nines.two'), pct: 99, color: 'var(--red)' },
    { label: t('uptime.nines.two_five'), pct: 99.5, color: 'var(--yellow)' },
    { label: t('uptime.nines.three'), pct: 99.9, color: 'var(--yellow)' },
    { label: t('uptime.nines.three_five'), pct: 99.95, color: 'var(--green)' },
    { label: t('uptime.nines.four'), pct: 99.99, color: 'var(--green)' },
    { label: t('uptime.nines.four_five'), pct: 99.995, color: 'var(--cyan)' },
    { label: t('uptime.nines.five'), pct: 99.999, color: 'var(--cyan)' },
    { label: t('uptime.nines.six'), pct: 99.9999, color: 'var(--purple)' },
    { label: t('uptime.nines.seven'), pct: 99.99999, color: 'var(--purple)' },
  ], [t]);

  const SLA_PRESETS = useMemo(() => [
    { label: '99% (2 nines)',     sla: 99.0 },
    { label: '99.5%',             sla: 99.5 },
    { label: '99.9% (3 nines)',   sla: 99.9 },
    { label: '99.95%',            sla: 99.95 },
    { label: '99.99% (4 nines)',  sla: 99.99 },
    { label: '99.999% (5 nines)', sla: 99.999 },
    { label: '99.9999% (6 nines)',sla: 99.9999 },
  ], []);

  // Hydrate Initial Data from Share URL
  useEffect(() => {
    if (initialData) {
      const incomingTab = initialData.activeTab ?? initialData.tab;
      if (incomingTab !== undefined) setTab(incomingTab);
      if (initialData.uptimePercent !== undefined) setUptimePercent(initialData.uptimePercent);
      if (initialData.period !== undefined) setPeriod(initialData.period);
      if (initialData.segs !== undefined) setSegs(initialData.segs);
      if (initialData.outageSla !== undefined) setOutageSla(initialData.outageSla);
      if (initialData.outageDur !== undefined) setOutageDur(initialData.outageDur);
      if (initialData.outageUnit !== undefined) setOutageUnit(initialData.outageUnit);
      if (initialData.outagePer !== undefined) setOutagePer(initialData.outagePer);
    }
  }, [initialData]);

  useEffect(() => { onNav?.({ activeTab: tab }); }, [tab]);

  // Hook up Share functionality
  useEffect(() => {
    const handle = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'uptime',
        tab,
        uptimePercent,
        period,
        segs,
        outageSla,
        outageDur,
        outageUnit,
        outagePer,
      });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, uptimePercent, period, segs, outageSla, outageDur, outageUnit, outagePer, onShare]);

  // Localized, High-Resolution Duration Formatter
  const formatDuration = useCallback((seconds) => {
    if (seconds < 0) seconds = 0;
    if (seconds < 1) {
      return t('uptime.ms', { n: (seconds * 1000).toFixed(0) });
    }
    if (seconds < 60) {
      return t('uptime.seconds_decimal', { n: seconds.toFixed(2) });
    }
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    
    const parts = [];
    if (days > 0) parts.push(t('uptime.days', { n: days }));
    if (hours > 0) parts.push(t('uptime.hours', { n: hours }));
    if (minutes > 0) parts.push(t('uptime.minutes', { n: minutes }));
    if (secs > 0 || parts.length === 0) {
      if (secs < 10 && secs % 1 !== 0) {
        parts.push(t('uptime.seconds_decimal', { n: secs.toFixed(2) }));
      } else {
        parts.push(t('uptime.seconds', { n: Math.floor(secs) }));
      }
    }
    return parts.join(' ');
  }, [t]);

  // Helper for computing allowed downtime per period
  const calcDowntime = useCallback((slaPct) => {
    const upFrac = slaPct / 100;
    return Object.entries(PERIOD_SECONDS).map(([k, seconds]) => ({
      key: k,
      label: PERIOD_LABELS[k],
      downtime: seconds * (1 - upFrac),
      uptime: seconds * upFrac,
    }));
  }, [PERIOD_SECONDS, PERIOD_LABELS]);

  // Tab 1 Calculations (SLA -> Downtime)
  const calc = useMemo(() => {
    const pct = parseFloat(uptimePercent);
    if (isNaN(pct) || pct < 0 || pct > 100) return null;
    const totalSec = PERIOD_SECONDS[period];
    const downtimePct = 100 - pct;
    const downtimeSec = totalSec * (downtimePct / 100);
    const uptimeSec = totalSec - downtimeSec;

    return {
      uptime: formatDuration(uptimeSec),
      downtime: formatDuration(downtimeSec),
      downtimeSec,
      downtimeMinutes: downtimeSec / 60,
      downtimeHours: downtimeSec / 3600,
      downtimeDays: downtimeSec / 86400,
      totalSec,
      downtimePct,
    };
  }, [uptimePercent, period, PERIOD_SECONDS, formatDuration]);

  const num = parseFloat(uptimePercent);
  const validInput = !isNaN(num) && num >= 0 && num <= 100;

  // Tab 2 Calculations (Composite SLA)
  const compositeSlaVal = useMemo(() => {
    return segs.reduce((acc, s) => acc * ((parseFloat(s.sla) || 100) / 100), 1) * 100;
  }, [segs]);

  const compositeDowntimes = useMemo(() => {
    return calcDowntime(compositeSlaVal);
  }, [compositeSlaVal, calcDowntime]);

  const addSeg = () => setSegs(s => [...s, { name: 'Component', sla: '99.9' }]);
  const delSeg = (i) => setSegs(s => s.filter((_, j) => j !== i));
  const updSeg = (i, field, val) => setSegs(s => s.map((sg, j) => j === i ? { ...sg, [field]: val } : sg));

  // Tab 3 Calculations (Outage Impact)
  const outageSecs = useMemo(() => {
    const dur = parseFloat(outageDur) || 0;
    if (outageUnit === 'hours') return dur * 3600;
    if (outageUnit === 'minutes') return dur * 60;
    return dur;
  }, [outageDur, outageUnit]);

  const outagePeriodSecs = useMemo(() => {
    return PERIOD_SECONDS[outagePer] || PERIOD_SECONDS.month;
  }, [outagePer, PERIOD_SECONDS]);

  const impact = useMemo(() => {
    const target = parseFloat(outageSla) || 99.9;
    const allowed = outagePeriodSecs * (1 - target / 100);
    const pctUsed = Math.min(100, (outageSecs / outagePeriodSecs) * 100);
    const slaActual = Math.max(0, (1 - outageSecs / outagePeriodSecs) * 100);
    const budgetRemaining = Math.max(0, allowed - outageSecs);
    return { pctUsed, slaActual, budgetRemaining, allowed };
  }, [outageSla, outageSecs, outagePeriodSecs]);

  return (
    <div className="tool-content">

      {/* Title & Subtitle Card */}
      <div className="card fadein">
        <div className="card-title">{t('uptime.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          {t('uptime.subtitle')}
        </div>
        
        {/* Navigation Tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <button className={`btn ${tab === 'downtime' ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 12 }} onClick={() => setTab('downtime')}>
            {t('uptime.tab_downtime')}
          </button>
          <button className={`btn ${tab === 'composite' ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 12 }} onClick={() => setTab('composite')}>
            {t('uptime.tab_composite')}
          </button>
          <button className={`btn ${tab === 'impact' ? 'btn-primary' : 'btn-ghost'}`} style={{ fontSize: 12 }} onClick={() => setTab('impact')}>
            {t('uptime.tab_impact')}
          </button>
        </div>
      </div>

      {/* TAB 1: SLA -> Downtime */}
      {tab === 'downtime' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('uptime.config_title')}</div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 14 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="label">{t('uptime.uptime_label')}</label>
                <input
                  className={`input ${!validInput && uptimePercent ? 'error' : ''}`}
                  value={uptimePercent}
                  onChange={e => setUptimePercent(e.target.value)}
                  placeholder="99.9"
                  style={{ width: 140, fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600 }}
                />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <label className="label">{t('uptime.period_label')}</label>
                <select className="input" value={period} onChange={e => setPeriod(e.target.value)} style={{ width: 140 }}>
                  {Object.entries(PERIOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
            </div>
            <div className="hint">{t('uptime.hint')}</div>
          </div>

          {/* Quick nines buttons */}
          <div className="card">
            <div className="card-title">{t('uptime.quick_nines')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {NINES_TABLE.map(n => (
                <button key={n.pct} className={`btn ${uptimePercent === String(n.pct) ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ fontSize: 12, padding: '4px 10px' }}
                  onClick={() => setUptimePercent(String(n.pct))}>
                  {n.label}
                </button>
              ))}
            </div>
          </div>

          {/* Result */}
          {calc && validInput && (
            <div className="fadein">
              <div className="card">
                <div className="card-title">{t('uptime.result_title')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }} className="grid-mobile-1">
                  <div style={{ padding: 16, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{t('uptime.uptime_duration')}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>{calc.uptime}</div>
                  </div>
                  <div style={{ padding: 16, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: 'var(--red)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>{t('uptime.downtime_duration')}</div>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>{calc.downtime}</div>
                  </div>
                </div>
              </div>

              <div className="card">
                <div className="card-title">{t('uptime.downtime_breakdown')}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
                  {[
                    { label: t('uptime.dt_seconds'), value: calc.downtimeSec.toFixed(calc.downtimeSec < 1 ? 4 : 1), color: 'var(--red)' },
                    { label: t('uptime.dt_minutes'), value: calc.downtimeMinutes.toFixed(calc.downtimeMinutes < 1 ? 4 : 2), color: 'var(--yellow)' },
                    { label: t('uptime.dt_hours'), value: calc.downtimeHours.toFixed(calc.downtimeHours < 1 ? 4 : 4), color: 'var(--cyan)' },
                    { label: t('uptime.dt_days'), value: calc.downtimeDays.toFixed(calc.downtimeDays < 1 ? 6 : 4), color: 'var(--muted)' },
                    { label: t('uptime.dt_percent'), value: `${calc.downtimePct.toFixed(4)}%`, color: 'var(--purple)' },
                  ].map(item => (
                    <div key={item.label} style={{
                      padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radius)',
                      border: '1px solid var(--border)', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>{item.label}</div>
                      <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 600, color: item.color }}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Reference table */}
          <div className="card">
            <div className="card-title">{t('uptime.reference_title')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase' }}>{t('uptime.col_level')}</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase' }}>{t('uptime.col_pct')}</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase' }}>{t('uptime.col_per_year')}</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase' }}>{t('uptime.col_per_month')}</th>
                    <th style={{ padding: '8px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase' }}>{t('uptime.col_per_week')}</th>
                  </tr>
                </thead>
                <tbody>
                  {NINES_TABLE.map(n => {
                    const dtYear = PERIOD_SECONDS.year * ((100 - n.pct) / 100);
                    const dtMonth = dtYear / 12;
                    const dtWeek = PERIOD_SECONDS.week * ((100 - n.pct) / 100);
                    const isActive = uptimePercent === String(n.pct);
                    return (
                      <tr key={n.pct} style={{ background: isActive ? 'var(--panel)' : 'transparent', cursor: 'pointer' }}
                        onClick={() => setUptimePercent(String(n.pct))}>
                        <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', fontWeight: isActive ? 600 : 400, color: n.color }}>{n.label}</td>
                        <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontFamily: 'var(--mono)', fontWeight: 600 }}>{n.pct}%</td>
                        <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--red)' }}>
                          {formatDuration(dtYear)}
                        </td>
                        <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--yellow)' }}>
                          {formatDuration(dtMonth)}
                        </td>
                        <td style={{ padding: '7px 10px', borderBottom: '1px solid var(--border)', textAlign: 'right', fontFamily: 'var(--mono)', color: 'var(--cyan)' }}>
                          {formatDuration(dtWeek)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ marginTop: 16, padding: 12, background: 'var(--panel)', borderLeft: '4px solid var(--cyan)', borderRadius: 4, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
              {t('uptime.reading_table_note', { sla: parseFloat(uptimePercent) || 99.9, downtime: formatDuration(calc?.downtimeSec ?? PERIOD_SECONDS.year * 0.001) })}
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: Composite SLA */}
      {tab === 'composite' && (
        <div className="card fadein">
          <div className="card-title" style={{ marginBottom: 8 }}>{t('uptime.composite_title')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            {t('uptime.composite_hint')}
          </div>

          {segs.map((seg, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8 }}>
              <div className="field" style={{ flex: 2 }}>
                {i === 0 && <label className="label">{t('uptime.col_component')}</label>}
                <input className="input" value={seg.name} onChange={e => updSeg(i, 'name', e.target.value)} placeholder="Component name" />
              </div>
              <div className="field" style={{ flex: 1 }}>
                {i === 0 && <label className="label">{t('uptime.col_sla_pct')}</label>}
                <input className="input" style={{ fontFamily: 'var(--mono)' }} value={seg.sla}
                  onChange={e => updSeg(i, 'sla', e.target.value)}
                  placeholder="99.9" type="number" min="0" max="100" step="0.001" />
              </div>
              <div style={{ paddingBottom: 2 }}>
                <button className="btn btn-ghost" style={{ fontSize: 11, padding: '5px 10px' }} onClick={() => delSeg(i)}>✕</button>
              </div>
            </div>
          ))}
          <button className="btn btn-ghost" style={{ marginBottom: 16, fontSize: 12 }} onClick={addSeg}>
            {t('uptime.add_component')}
          </button>

          <div style={{ padding: 16, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{t('uptime.composite_result')}</div>
            <div style={{
              fontFamily: 'var(--mono)',
              fontSize: 22,
              fontWeight: 700,
              color: compositeSlaVal >= 99.99 ? '#52c4a8' : compositeSlaVal >= 99.9 ? '#a8c452' : compositeSlaVal >= 99 ? '#e0c452' : '#e05252',
              marginBottom: 8
            }}>
              {compositeSlaVal.toFixed(4)}%
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ color: 'var(--muted)' }}>
                    { [t('uptime.col_period'), t('uptime.col_max_downtime'), t('uptime.col_uptime_duration'), t('uptime.col_availability_seconds')].map(h => (
                      <th key={h} style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {compositeDowntimes.map((row, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--text)', fontWeight: 600 }}>{row.label}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', color: row.downtime < 60 ? '#52c4a8' : '#e0c452', fontWeight: 600 }}>{formatDuration(row.downtime)}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', color: 'var(--text)' }}>{formatDuration(row.uptime)}</td>
                      <td style={{ padding: '6px 8px', fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                        {row.uptime.toFixed(3)} / {(row.uptime + row.downtime).toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div style={{ marginTop: 12, padding: 10, background: 'var(--panel)', borderLeft: '4px solid var(--cyan)', borderRadius: 4, fontSize: 11, color: 'var(--muted)', lineHeight: 1.5 }}>
            {t('uptime.composite_formula')}
          </div>
        </div>
      )}

      {/* TAB 3: Outage Impact */}
      {tab === 'impact' && (
        <div className="card fadein">
          <div className="card-title" style={{ marginBottom: 8 }}>{t('uptime.impact_title')}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
            {t('uptime.impact_hint')}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }} className="grid-mobile-1">
            <div className="field">
              <label className="label">{t('uptime.target_sla')}</label>
              <input className="input" style={{ fontFamily: 'var(--mono)' }} value={outageSla}
                onChange={e => setOutageSla(e.target.value)} placeholder="99.9" type="number" min="0" max="100" step="0.001" />
            </div>
            <div className="field">
              <label className="label">{t('uptime.outage_duration')}</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <input className="input" style={{ fontFamily: 'var(--mono)', flex: 1 }} value={outageDur}
                  onChange={e => setOutageDur(e.target.value)} placeholder="4" type="number" min="0" />
                <select className="select" style={{ width: 'auto' }} value={outageUnit} onChange={e => setOutageUnit(e.target.value)}>
                  <option value="hours">{t('uptime.dt_hours')}</option>
                  <option value="minutes">{t('uptime.dt_minutes')}</option>
                  <option value="seconds">{t('uptime.dt_seconds')}</option>
                </select>
              </div>
            </div>
            <div className="field">
              <label className="label">{t('uptime.measurement_period')}</label>
              <select className="select" value={outagePer} onChange={e => setOutagePer(e.target.value)}>
                {Object.entries(PERIOD_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 10 }}>
            {SLA_PRESETS.map(p => (
              <button key={p.sla} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 10px' }}
                onClick={() => setOutageSla(String(p.sla))}>{p.label}</button>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 8 }} className="grid-mobile-1">
            {[
              {
                label: t('uptime.actual_sla'),
                value: impact.slaActual.toFixed(4) + '%',
                color: impact.slaActual >= (parseFloat(outageSla) || 99.9) ? '#52c4a8' : '#e05252'
              },
              {
                label: t('uptime.allowed_budget'),
                value: formatDuration(impact.allowed),
                color: 'var(--text)'
              },
              {
                label: t('uptime.budget_remaining'),
                value: formatDuration(impact.budgetRemaining),
                color: impact.budgetRemaining <= 0 ? '#e05252' : impact.budgetRemaining < 600 ? '#e0c452' : '#52c4a8'
              },
            ].map(card => (
              <div key={card.label} style={{ padding: 14, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', textAlign: 'center' }}>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>{card.label}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 700, color: card.color }}>{card.value}</div>
              </div>
            ))}
          </div>

          <div style={{
            marginTop: 12,
            padding: 10,
            background: 'var(--panel)',
            borderLeft: `4px solid ${impact.slaActual >= (parseFloat(outageSla) || 99.9) ? '#52c4a8' : '#e05252'}`,
            borderRadius: 4,
            fontSize: 12,
            color: 'var(--muted)',
            lineHeight: 1.5
          }}>
            {impact.slaActual >= (parseFloat(outageSla) || 99.9)
              ? t('uptime.impact_summary_within', {
                  duration: formatDuration(outageSecs),
                  target: parseFloat(outageSla) || 99.9,
                  period: PERIOD_LABELS[outagePer]?.toLowerCase(),
                  remaining: formatDuration(impact.budgetRemaining)
                })
              : t('uptime.impact_summary_breach', {
                  duration: formatDuration(outageSecs),
                  target: parseFloat(outageSla) || 99.9,
                  period: PERIOD_LABELS[outagePer]?.toLowerCase(),
                  actual: impact.slaActual.toFixed(4),
                  exceeded: formatDuration(outageSecs - impact.allowed)
                })
            }
          </div>
        </div>
      )}

    </div>
  );
}

window.UptimeCalculator = UptimeCalculator;
