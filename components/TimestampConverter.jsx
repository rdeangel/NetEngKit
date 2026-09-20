const { useState, useEffect, useCallback, useRef, useMemo } = React;

function TimestampConverter({ onShare, initialData }) {
  const { t } = useTranslation();
  const [epochInput, setEpochInput] = usePersistentState('ts:epochInput', initialData?.epochInput ?? '');
  const [epochScale, setEpochScale] = usePersistentState('ts:epochScale', initialData?.epochScale ?? 'seconds'); // seconds | milliseconds
  const [liveEpoch, setLiveEpoch] = useState(Math.floor(Date.now() / 1000));

  // Date→Epoch: split fields for reliable cross-browser editing
  const [datePartInput, setDatePartInput] = usePersistentState('ts:datePart', initialData?.datePart ?? '');
  const [timePartInput, setTimePartInput] = usePersistentState('ts:timePart', initialData?.timePart ?? '');
  const [tzMode, setTzMode] = usePersistentState('ts:tzMode', initialData?.tzMode ?? 'local'); // 'local' | 'utc'

  const PRESETS = [
    { label: t('tsconv.presets.unix_epoch'), epoch: 0 },
    { label: t('tsconv.presets.y2k'), epoch: 946684800 },
    { label: t('tsconv.presets.2024_start'), epoch: 1704067200 },
    { label: t('tsconv.presets.2025_start'), epoch: 1735689600 },
    { label: t('tsconv.presets.2038_problem'), epoch: 2147483647 },
    { label: t('tsconv.presets.one_hour'), epoch: 3600 },
    { label: t('tsconv.presets.one_day'), epoch: 86400 },
    { label: t('tsconv.presets.one_week'), epoch: 604800 },
  ];

  // Live clock
  useEffect(() => {
    const iv = setInterval(() => setLiveEpoch(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (initialData) {
      if (initialData.epochInput !== undefined) setEpochInput(initialData.epochInput);
      if (initialData.epochScale !== undefined) setEpochScale(initialData.epochScale);
      if (initialData.datePart !== undefined) setDatePartInput(initialData.datePart);
      if (initialData.timePart !== undefined) setTimePartInput(initialData.timePart);
      if (initialData.tzMode !== undefined) setTzMode(initialData.tzMode);
    }
  }, [initialData]);

  useEffect(() => {
    const handle = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'tsconv', epochInput, epochScale,
        datePart: datePartInput, timePart: timePartInput, tzMode,
      });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [epochInput, epochScale, datePartInput, timePartInput, tzMode, onShare]);

  // ─── Epoch → Date ────────────────────────────────────────────
  const epochResult = useMemo(() => {
    if (!epochInput.trim()) return null;
    let ts = Number(epochInput);
    if (isNaN(ts)) return null;
    const msTs = epochScale === 'seconds' ? ts * 1000 : ts;
    const date = new Date(msTs);
    if (isNaN(date.getTime())) return null;

    // RFC 3339 / ISO 8601 with offset
    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const off = -date.getTimezoneOffset();
    const offSign = off >= 0 ? '+' : '-';
    const offH = pad(Math.floor(Math.abs(off) / 60));
    const offM = pad(Math.abs(off) % 60);
    const localRfc3339 = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offSign}${offH}:${offM}`;

    // Syslog RFC 5424 timestamp
    const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const syslogFmt = `${date.getUTCFullYear()}-${pad(date.getUTCMonth()+1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}Z`;

    // HTTP Date (RFC 7231)
    const DAYS_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const httpDate = date.toUTCString(); // already in RFC 7231 format

    // Julian Day Number (JDN)
    const a = Math.floor((14 - (date.getUTCMonth() + 1)) / 12);
    const y = date.getUTCFullYear() + 4800 - a;
    const m = (date.getUTCMonth() + 1) + 12 * a - 3;
    const jdn = date.getUTCDate() + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;

    // Unix Day (days since 1970-01-01)
    const unixDay = Math.floor(msTs / 86400000);

    // Epoch as hex
    const epochSec = Math.floor(msTs / 1000);
    const epochHex = '0x' + (epochSec >>> 0).toString(16).toUpperCase();

    return {
      date,
      iso: date.toISOString(),
      rfc3339: localRfc3339,
      utc: date.toUTCString(),
      local: date.toLocaleString(),
      localDate: date.toLocaleDateString(),
      localTime: date.toLocaleTimeString(),
      syslogFmt,
      httpDate,
      epochSeconds: epochSec,
      epochMillis: msTs,
      epochHex,
      julianDay: jdn,
      unixDay,
      dayOfYear: Math.floor((date - new Date(date.getUTCFullYear(), 0, 0)) / 86400000),
      weekNumber: (() => {
        const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
        const dayNum = d.getUTCDay() || 7;
        d.setUTCDate(d.getUTCDate() + 4 - dayNum);
        const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
        return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      })(),
      quarter: Math.ceil((date.getUTCMonth() + 1) / 3),
      dayOfWeek: t('common.days')[date.getUTCDay()],
      isLeapYear: ((date.getUTCFullYear() % 4 === 0) && (date.getUTCFullYear() % 100 !== 0)) || (date.getUTCFullYear() % 400 === 0),
      relativeNow: (() => {
        const diff = msTs - Date.now();
        const abs = Math.abs(diff);
        const isPast = diff < 0;
        const str = abs < 1000 ? `${Math.floor(abs / 100)}${t('common.unit_ms')}`
          : abs < 60000 ? `${Math.floor(abs / 1000)}${t('common.unit_s')}`
          : abs < 3600000 ? `${Math.floor(abs / 60000)}${t('common.unit_m')}`
          : abs < 86400000 ? `${Math.floor(abs / 3600000)}${t('common.unit_h')}`
          : abs < 2592000000 ? `${Math.floor(abs / 86400000)}${t('common.unit_d')}`
          : abs < 31536000000 ? `${(abs / 2592000000).toFixed(1)}${t('common.unit_mo')}`
          : `${(abs / 31536000000).toFixed(1)}${t('common.unit_y')}`;
        return { text: str, isPast };
      })(),
      localOffset: (() => {
        const off = -date.getTimezoneOffset();
        const sign = off >= 0 ? '+' : '-';
        const h = pad(Math.floor(Math.abs(off) / 60));
        const m = pad(Math.abs(off) % 60);
        return `UTC${sign}${h}:${m}`;
      })(),
    };
  }, [epochInput, epochScale]);

  // ─── Date → Epoch ────────────────────────────────────────────
  const dateResult = useMemo(() => {
    if (!datePartInput.trim()) return null;
    const datePart = datePartInput.trim();
    const timePart = timePartInput.trim() || '00:00:00';

    let date;
    if (tzMode === 'utc') {
      date = new Date(`${datePart}T${timePart}Z`);
    } else {
      // Parse as local time
      date = new Date(`${datePart}T${timePart}`);
    }
    if (isNaN(date.getTime())) return null;

    const pad = (n, len = 2) => String(n).padStart(len, '0');
    const off = -date.getTimezoneOffset();
    const offSign = off >= 0 ? '+' : '-';
    const offH = pad(Math.floor(Math.abs(off) / 60));
    const offM = pad(Math.abs(off) % 60);
    const localRfc3339 = `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offSign}${offH}:${offM}`;

    const localOffset = (() => {
      const sign = off >= 0 ? '+' : '-';
      const h = pad(Math.floor(Math.abs(off) / 60));
      const m2 = pad(Math.abs(off) % 60);
      return `UTC${sign}${h}:${m2}`;
    })();

    return {
      epochSeconds: Math.floor(date.getTime() / 1000),
      epochMillis: date.getTime(),
      epochHex: '0x' + (Math.floor(date.getTime() / 1000) >>> 0).toString(16).toUpperCase(),
      iso: date.toISOString(),
      rfc3339: localRfc3339,
      utc: date.toUTCString(),
      local: date.toLocaleString(),
      localOffset,
    };
  }, [datePartInput, timePartInput, tzMode]);

  const setNow = () => {
    const now = Math.floor(Date.now() / 1000);
    setEpochInput(String(now));
  };

  const setDateNow = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    setDatePartInput(`${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}`);
    setTimePartInput(`${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`);
  };

  // ─── Render helpers ───────────────────────────────────────────
  const ResultRow = ({ label, value, color }) => (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8,
      padding: '6px 10px', background: 'var(--bg)', borderRadius: 'var(--radius)',
      border: '1px solid var(--border)',
    }}>
      <span style={{ fontSize: 11, color: 'var(--dim)', flexShrink: 0 }}>{label}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
        <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: color || 'var(--text)', fontWeight: 500, wordBreak: 'break-all', textAlign: 'right' }}>{value}</span>
        <CopyBtn text={String(value)} id={`ts-${label}`} />
      </div>
    </div>
  );

  return (
    <div className="tool-content">

      {/* Live clock */}
      <div className="card fadein" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 10, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>{t('tsconv.live_epoch')}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div style={{ fontFamily: 'var(--mono)', fontSize: 24, fontWeight: 700, color: 'var(--cyan)' }}>{liveEpoch}</div>
          <CopyBtn text={String(liveEpoch)} id="live-epoch" />
        </div>
        <div style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{new Date().toISOString()}</div>
      </div>

      {/* Epoch → Date */}
      <div className="card fadein">
        <div className="card-title">{t('tsconv.epoch_to_date')}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1, minWidth: 200 }}>
            <label className="label">{t('tsconv.epoch_label')}</label>
            <input
              className="input"
              placeholder={t('tsconv.epoch_placeholder')}
              value={epochInput}
              onChange={e => setEpochInput(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
            />
          </div>
          <select className="input" value={epochScale} onChange={e => setEpochScale(e.target.value)} style={{ width: 130 }}>
            <option value="seconds">{t('tsconv.seconds')}</option>
            <option value="milliseconds">{t('tsconv.milliseconds')}</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={setNow}>{t('tsconv.now_btn')}</button>
        </div>

        {epochResult && (
          <div className="fadein">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 6 }}>
              {/* Primary display formats */}
              <ResultRow label={t('tsconv.iso_8601')}   value={epochResult.iso}         color="var(--cyan)" />
              <ResultRow label={t('tsconv.rfc3339')}    value={epochResult.rfc3339}     color="var(--cyan)" />
              <ResultRow label={t('tsconv.utc')}        value={epochResult.utc}         color="var(--green)" />
              <ResultRow label={t('tsconv.local_time')} value={epochResult.local}       color="var(--text)" />
              <ResultRow label={t('tsconv.syslog_fmt')} value={epochResult.syslogFmt}   color="var(--yellow)" />
              <ResultRow label={t('tsconv.http_date')}  value={epochResult.httpDate}    color="var(--muted)" />
              {/* Date/time parts */}
              <ResultRow label={t('tsconv.date_only')}  value={epochResult.localDate}   color="var(--text)" />
              <ResultRow label={t('tsconv.time_only')}  value={epochResult.localTime}   color="var(--text)" />
              <ResultRow label={t('tsconv.local_offset')} value={epochResult.localOffset} color="var(--muted)" />
              {/* Epoch variants */}
              <ResultRow label={t('tsconv.epoch_sec')}  value={epochResult.epochSeconds} color="var(--yellow)" />
              <ResultRow label={t('tsconv.epoch_ms')}   value={epochResult.epochMillis}  color="var(--yellow)" />
              <ResultRow label={t('tsconv.epoch_hex')}  value={epochResult.epochHex}     color="var(--yellow)" />
              {/* Calendar fields */}
              <ResultRow label={t('tsconv.julian_day')} value={epochResult.julianDay}    color="var(--muted)" />
              <ResultRow label={t('tsconv.unix_day')}   value={epochResult.unixDay}      color="var(--muted)" />
              <ResultRow label={t('tsconv.day_of_year')} value={epochResult.dayOfYear}   color="var(--muted)" />
              <ResultRow label={t('tsconv.week_number')} value={`W${epochResult.weekNumber}`} color="var(--muted)" />
              <ResultRow label={t('tsconv.quarter')}    value={`Q${epochResult.quarter}`} color="var(--muted)" />
              <ResultRow label={t('tsconv.day_of_week')} value={epochResult.dayOfWeek}   color="var(--muted)" />
              <ResultRow label={t('tsconv.leap_year')}  value={epochResult.isLeapYear ? t('common.yes') : t('common.no')} color={epochResult.isLeapYear ? 'var(--green)' : 'var(--red)'} />
            </div>
            {/* Relative time */}
            <div style={{ marginTop: 8, padding: '8px 12px', background: 'var(--panel)', borderRadius: 'var(--radius)', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ color: 'var(--dim)' }}>{t('tsconv.relative')}:</span>
              <span style={{ color: epochResult.relativeNow.isPast ? 'var(--yellow)' : 'var(--green)', fontWeight: 600 }}>
                {epochResult.relativeNow.isPast ? t('tsconv.ago', { t: epochResult.relativeNow.text }) : t('tsconv.in_future', { t: epochResult.relativeNow.text })}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Date → Epoch */}
      <div className="card fadein">
        <div className="card-title">{t('tsconv.date_to_epoch')}</div>

        {/* Input row: date + time + tz + Now button */}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 10 }}>
          {/* Date field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 140px', minWidth: 130 }}>
            <label className="label">{t('tsconv.date_label')}</label>
            <input
              className="input"
              type="date"
              value={datePartInput}
              onChange={e => setDatePartInput(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 13, colorScheme: 'dark' }}
            />
          </div>

          {/* Time field */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: '2 1 120px', minWidth: 110 }}>
            <label className="label">{t('tsconv.time_label')}</label>
            <input
              className="input"
              type="time"
              step="1"
              value={timePartInput}
              onChange={e => setTimePartInput(e.target.value)}
              style={{ fontFamily: 'var(--mono)', fontSize: 13, colorScheme: 'dark' }}
            />
          </div>

          {/* TZ toggle */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 90 }}>
            <label className="label">{t('tsconv.tz_label')}</label>
            <select
              className="input"
              value={tzMode}
              onChange={e => setTzMode(e.target.value)}
              style={{ width: '100%' }}
            >
              <option value="local">{t('tsconv.tz_local')}</option>
              <option value="utc">{t('tsconv.tz_utc')}</option>
            </select>
          </div>

          <button className="btn btn-primary btn-sm" style={{ alignSelf: 'flex-end' }} onClick={setDateNow}>{t('tsconv.now_btn')}</button>
        </div>

        {dateResult && (
          <div className="fadein" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 6 }}>
            <ResultRow label={t('tsconv.epoch_sec')}       value={dateResult.epochSeconds}  color="var(--yellow)" />
            <ResultRow label={t('tsconv.epoch_ms')}        value={dateResult.epochMillis}   color="var(--yellow)" />
            <ResultRow label={t('tsconv.epoch_hex')}       value={dateResult.epochHex}      color="var(--yellow)" />
            <ResultRow label={t('tsconv.iso_8601')}        value={dateResult.iso}           color="var(--cyan)" />
            <ResultRow label={t('tsconv.rfc3339')}         value={dateResult.rfc3339}       color="var(--cyan)" />
            <ResultRow label={t('tsconv.utc')}             value={dateResult.utc}           color="var(--green)" />
            <ResultRow label={t('tsconv.local_time')}      value={dateResult.local}         color="var(--text)" />
            <ResultRow label={t('tsconv.local_offset')}    value={dateResult.localOffset}   color="var(--muted)" />
          </div>
        )}
      </div>

      {/* Presets */}
      <div className="card fadein">
        <div className="card-title">{t('tsconv.presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }}
              onClick={() => {
                setEpochInput(String(p.epoch));
                setEpochScale('seconds');
                // Sync Date → Epoch fields from the preset epoch
                const d = new Date(p.epoch * 1000);
                const pad = (n) => String(n).padStart(2, '0');
                setDatePartInput(`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`);
                setTimePartInput(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`);
                setTzMode('local');
              }}>{p.label}</button>
          ))}
        </div>
      </div>

    </div>
  );
}

window.TimestampConverter = TimestampConverter;
