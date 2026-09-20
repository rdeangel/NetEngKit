const { useState, useEffect, useCallback, useMemo } = React;

function CronParser({ onShare, initialData }) {
  const { t } = useTranslation();
  const [expression, setExpression] = usePersistentState('cron:expression', initialData?.expression ?? '');
  const [error, setError] = useState('');

  const PRESETS = [
    { label: t('cron.presets.every_minute'), value: '* * * * *' },
    { label: t('cron.presets.every_hour'), value: '0 * * * *' },
    { label: t('cron.presets.every_day_midnight'), value: '0 0 * * *' },
    { label: t('cron.presets.every_day_6am'), value: '0 6 * * *' },
    { label: t('cron.presets.every_monday'), value: '0 0 * * 1' },
    { label: t('cron.presets.every_weekday'), value: '0 9 * * 1-5' },
    { label: t('cron.presets.every_month'), value: '0 0 1 * *' },
    { label: t('cron.presets.every_quarter'), value: '0 0 1 1,4,7,10 *' },
    { label: t('cron.presets.every_5min'), value: '*/5 * * * *' },
    { label: t('cron.presets.every_15min'), value: '*/15 * * * *' },
    { label: t('cron.presets.every_30min'), value: '0,30 * * * *' },
    { label: t('cron.presets.every_sunday_3am'), value: '0 3 * * 0' },
    { label: t('cron.presets.weekdays_8am'), value: '0 8 * * 1-5' },
    { label: t('cron.presets.first_friday'), value: '0 0 1-7 * 5' },
    { label: t('cron.presets.every_6_hours'), value: '0 */6 * * *' },
    { label: t('cron.presets.last_day_month'), value: '0 0 28-31 * *' },
    { label: t('cron.presets.new_year'), value: '0 0 1 1 *' },
    { label: t('cron.presets.every_10min_weekdays'), value: '*/10 * * * 1-5' },
  ];

  useEffect(() => {
    if (initialData?.expression !== undefined) setExpression(initialData.expression);
  }, [initialData]);

  useEffect(() => {
    const handle = (e) => {
      if (expression) (e.detail?.respond ?? onShare)({ tool: 'cronparse', expression });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [expression, onShare]);

  const parseField = (field, min, max) => {
    if (field === '*') return { type: 'wildcard', values: Array.from({ length: max - min + 1 }, (_, i) => i + min), desc: t('cron.desc.every') };
    if (field.startsWith('*/')) {
      const step = parseInt(field.slice(2));
      if (isNaN(step) || step <= 0) return null;
      const vals = [];
      for (let i = min; i <= max; i += step) vals.push(i);
      return { type: 'step', values: vals, desc: t('cron.desc.every_step', { step }) };
    }
    const vals = new Set();
    for (const part of field.split(',')) {
      if (part.includes('-')) {
        const [start, end] = part.split('-').map(Number);
        if (isNaN(start) || isNaN(end)) return null;
        for (let i = start; i <= end; i++) vals.add(i);
      } else if (part.includes('/')) {
        const [range, step] = part.split('/');
        const stepN = parseInt(step);
        if (isNaN(stepN) || stepN <= 0) return null;
        if (range === '*') {
          for (let i = min; i <= max; i += stepN) vals.add(i);
        } else {
          const [start, end] = range.split('-').map(Number);
          for (let i = start; i <= (end || max); i += stepN) vals.add(i);
        }
      } else {
        const n = parseInt(part);
        if (isNaN(n)) return null;
        vals.add(n);
      }
    }
    return { type: 'specific', values: [...vals].sort((a, b) => a - b), desc: [...vals].sort((a, b) => a - b).join(', ') };
  };

  const parsed = useMemo(() => {
    if (!expression.trim()) { setError(''); return null; }
    const parts = expression.trim().split(/\s+/);
    if (parts.length < 5 || parts.length > 7) {
      setError(t('cron.err_parts'));
      return null;
    }

    // Handle both 5 and 6/7 field formats
    let minuteIdx = 0, hourIdx = 1, domIdx = 2, monthIdx = 3, dowIdx = 4;
    const fields = [
      { name: t('cron.field_minute'), field: parts[minuteIdx], min: 0, max: 59 },
      { name: t('cron.field_hour'), field: parts[hourIdx], min: 0, max: 23 },
      { name: t('cron.field_dom'), field: parts[domIdx], min: 1, max: 31 },
      { name: t('cron.field_month'), field: parts[monthIdx], min: 1, max: 12 },
      { name: t('cron.field_dow'), field: parts[dowIdx], min: 0, max: 7 },
    ];

    const parsedFields = fields.map(f => ({
      ...f,
      parsed: parseField(f.field, f.min, f.max),
    }));

    if (parsedFields.some(f => !f.parsed)) {
      setError(t('cron.err_parse'));
      return null;
    }

    setError('');
    return { fields: parsedFields, raw: parts };
  }, [expression]);

  // Generate next run times
  const nextRuns = useMemo(() => {
    if (!parsed) return [];
    try {
      const runs = [];
      const now = new Date();
      let candidate = new Date(now.getTime() + 60000); // start from next minute
      candidate.setSeconds(0, 0);

      const maxAttempts = 525600; // up to 1 year of minutes
      let attempts = 0;

      while (runs.length < 10 && attempts < maxAttempts) {
        attempts++;
        const m = candidate.getMinutes();
        const h = candidate.getHours();
        const d = candidate.getDate();
        const mo = candidate.getMonth() + 1;
        const dow = candidate.getDay();

        const minuteOk = parsed.fields[0].parsed.values.includes(m);
        const hourOk = parsed.fields[1].parsed.values.includes(h);
        const domOk = parsed.fields[2].parsed.values.includes(d);
        const monthOk = parsed.fields[3].parsed.values.includes(mo);
        // Handle both 0 and 7 as Sunday
        const dowOk = parsed.fields[4].parsed.values.includes(dow) || (parsed.fields[4].parsed.values.includes(7) && dow === 0);

        if (minuteOk && hourOk && domOk && monthOk && dowOk) {
          runs.push(new Date(candidate));
        }
        candidate = new Date(candidate.getTime() + 60000);
      }
      return runs;
    } catch {
      return [];
    }
  }, [parsed]);

  // Human readable description
  const description = useMemo(() => {
    if (!parsed) return '';
    const f = parsed.fields;
    const minute = f[0].parsed;
    const hour = f[1].parsed;
    const dom = f[2].parsed;
    const month = f[3].parsed;
    const dow = f[4].parsed;

    // Simple human-readable
    const isEvery = (p) => p.type === 'wildcard';
    const timeStr = isEvery(minute) && isEvery(hour) ? t('cron.human.every_minute')
      : isEvery(hour) ? t('cron.human.minutes_only', { m: minute.desc })
      : isEvery(minute) ? t('cron.human.hourly_at', { h: hour.desc })
      : t('cron.human.at_time', { h: hour.desc, m: minute.desc });

    let whenStr = '';
    if (isEvery(dom) && isEvery(month) && isEvery(dow)) whenStr = t('cron.human.every_day');
    else if (!isEvery(dow) && isEvery(dom)) whenStr = t('cron.human.on_days', { d: dow.values.map(v => t('common.days')[v] || t('common.days')[0]).join(', ') });
    else if (!isEvery(month)) whenStr = t('cron.human.in_months', { m: month.values.map(v => t('common.months')[v - 1]).join(', ') });
    else if (!isEvery(dom)) whenStr = t('cron.human.on_dates', { d: dom.desc });

    return `${timeStr} ${whenStr}`.trim();
  }, [parsed, t]);

  return (
    <div className="tool-content">

      <div className="card fadein">
        <div className="card-title">{t('cron.input_title')}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 250 }}>
            <label className="label">{t('cron.expression_label')}</label>
            <input
              className={`input ${error ? 'error' : ''}`}
              placeholder="* * * * *"
              value={expression}
              onChange={e => setExpression(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 16, fontWeight: 600 }}
            />
          </div>
        </div>
        <Err msg={error} />
        {expression.trim() && !error && (
          <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--panel)', borderRadius: 'var(--radius)', fontSize: 13, color: 'var(--text)' }}>
            <span style={{ color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5 }}>{t('cron.human_label')}</span>
            <div style={{ marginTop: 4, fontWeight: 500 }}>{description}</div>
          </div>
        )}
      </div>

      {/* Presets */}
      <div className="card fadein">
        <div className="card-title">{t('cron.presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.value} className={`btn ${expression === p.value ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => setExpression(p.value)}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Field breakdown */}
      {parsed && !error && (
        <div className="card fadein">
          <div className="card-title">{t('cron.breakdown_title')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8 }}>
            {parsed.fields.map((f, i) => (
              <div key={i} style={{
                padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
              }}>
                <div style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 }}>{f.name}</div>
                <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--cyan)', marginBottom: 4 }}>{f.field}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{f.parsed.desc}</div>
                <div style={{ fontSize: 10, color: 'var(--dim)', marginTop: 4 }}>
                  {t('cron.values')}: [{f.parsed.values.slice(0, 20).join(', ')}{f.parsed.values.length > 20 ? '...' : ''}]
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Next runs */}
      {nextRuns.length > 0 && (
        <div className="card fadein">
          <div className="card-title">{t('cron.next_runs_title')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {nextRuns.map((run, i) => {
              const diff = run.getTime() - Date.now();
              const isPast = diff < 0;
              const absDiff = Math.abs(diff);
              const relStr = absDiff < 3600000 ? `${Math.floor(absDiff / 60000)}${t('common.unit_m')}`
                : absDiff < 86400000 ? `${Math.floor(absDiff / 3600000)}${t('common.unit_h')} ${Math.floor((absDiff % 3600000) / 60000)}${t('common.unit_m')}`
                : `${Math.floor(absDiff / 86400000)}${t('common.unit_d')} ${Math.floor((absDiff % 86400000) / 3600000)}${t('common.unit_h')}`;
              return (
                <div key={i} style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  padding: '7px 12px', background: i === 0 ? 'var(--panel)' : 'var(--bg)',
                  borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: i === 0 ? 'var(--cyan)' : 'var(--dim)', minWidth: 20 }}>#{i + 1}</span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{run.toLocaleString()}</span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--dim)' }}>{run.toISOString()}</span>
                    {i === 0 && (
                      <span style={{ fontSize: 11, color: 'var(--green)', fontWeight: 600 }}>
                        {t('cron.in_future', { t: relStr })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </div>
  );
}

window.CronParser = CronParser;
