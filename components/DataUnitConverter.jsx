const { useState, useEffect, useMemo } = React;

function DataUnitConverter({ onShare, initialData }) {
  const { t } = useTranslation();
  const [value, setValue] = usePersistentState('dataunit:value', initialData?.value ?? '100');
  const [unit, setUnit] = usePersistentState('dataunit:unit', initialData?.unit ?? 'MB');

  const UNITS = [
    // Bits (decimal)
    { id: 'b',   bits: 1,              group: 'bits', label: 'b',   name: 'Bits' },
    { id: 'Kb',  bits: 1e3,            group: 'bits', label: 'Kb',  name: 'Kilobits' },
    { id: 'Mb',  bits: 1e6,            group: 'bits', label: 'Mb',  name: 'Megabits' },
    { id: 'Gb',  bits: 1e9,            group: 'bits', label: 'Gb',  name: 'Gigabits' },
    { id: 'Tb',  bits: 1e12,           group: 'bits', label: 'Tb',  name: 'Terabits' },
    { id: 'Pb',  bits: 1e15,           group: 'bits', label: 'Pb',  name: 'Petabits' },
    { id: 'Eb',  bits: 1e18,           group: 'bits', label: 'Eb',  name: 'Exabits' },
    // Decimal bytes (SI, base-10)
    { id: 'B',   bits: 8,              group: 'si',   label: 'B',   name: 'Bytes' },
    { id: 'KB',  bits: 8e3,            group: 'si',   label: 'KB',  name: 'Kilobytes' },
    { id: 'MB',  bits: 8e6,            group: 'si',   label: 'MB',  name: 'Megabytes' },
    { id: 'GB',  bits: 8e9,            group: 'si',   label: 'GB',  name: 'Gigabytes' },
    { id: 'TB',  bits: 8e12,           group: 'si',   label: 'TB',  name: 'Terabytes' },
    { id: 'PB',  bits: 8e15,           group: 'si',   label: 'PB',  name: 'Petabytes' },
    { id: 'EB',  bits: 8e18,           group: 'si',   label: 'EB',  name: 'Exabytes' },
    // Binary bytes (IEC, base-2)
    { id: 'KiB', bits: 8 * 1024,       group: 'iec',  label: 'KiB', name: 'Kibibytes' },
    { id: 'MiB', bits: 8 * 1048576,    group: 'iec',  label: 'MiB', name: 'Mebibytes' },
    { id: 'GiB', bits: 8 * 1073741824, group: 'iec',  label: 'GiB', name: 'Gibibytes' },
    { id: 'TiB', bits: 8 * 1099511627776,     group: 'iec', label: 'TiB', name: 'Tebibytes' },
    { id: 'PiB', bits: 8 * 1125899906842624,  group: 'iec', label: 'PiB', name: 'Pebibytes' },
    { id: 'EiB', bits: 8 * 1152921504606846976, group: 'iec', label: 'EiB', name: 'Exbibytes' },
  ];

  const UNIT_MAP = useMemo(() => Object.fromEntries(UNITS.map(u => [u.id, u])), []);

  const PRESETS = [
    { label: '1 MB',   value: '1',     unit: 'MB' },
    { label: '100 MB', value: '100',   unit: 'MB' },
    { label: '700 MB', value: '700',   unit: 'MB' },
    { label: '1 GB',   value: '1',     unit: 'GB' },
    { label: '4.7 GB', value: '4.7',   unit: 'GB' },
    { label: '25 GB',  value: '25',    unit: 'GB' },
    { label: '1 TB',   value: '1',     unit: 'TB' },
    { label: '100 Mb', value: '100',   unit: 'Mb' },
    { label: '1 Gb',   value: '1',     unit: 'Gb' },
    { label: '10 Gb',  value: '10',    unit: 'Gb' },
    { label: '100 Gb', value: '100',   unit: 'Gb' },
  ];

  const fmt = (num) => {
    if (num === 0) return '0';
    const clean = parseFloat(num.toPrecision(10));
    const abs = Math.abs(clean);
    if (abs >= 1e15 || (abs > 0 && abs < 1e-4)) return clean.toExponential(3);
    const s = parseFloat(clean.toPrecision(7)).toString();
    const [int, dec] = s.split('.');
    const intFmt = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return dec ? `${intFmt}.${dec}` : intFmt;
  };

  const num = parseFloat(value);
  const validInput = value.trim() !== '' && !isNaN(num) && num >= 0;

  const results = useMemo(() => {
    if (!validInput) return null;
    const src = UNIT_MAP[unit];
    if (!src) return null;
    const bits = num * src.bits;
    return Object.fromEntries(UNITS.map(u => [u.id, bits / u.bits]));
  }, [value, unit]);

  useEffect(() => {
    if (initialData) {
      if (initialData.value !== undefined) setValue(initialData.value);
      if (initialData.unit !== undefined) setUnit(initialData.unit);
    }
  }, [initialData]);

  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'dataunit', value, unit });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [value, unit, onShare]);

  const err = value.trim() !== '' && (isNaN(num) || num < 0)
    ? (num < 0 ? t('dataunit.err_negative') : t('dataunit.err_invalid'))
    : '';

  const handleRowClick = (uid, val) => {
    setValue(parseFloat(parseFloat(val).toPrecision(10)).toString());
    setUnit(uid);
  };

  const copyText = results
    ? UNITS.map(u => `${u.name} (${u.label}): ${fmt(results[u.id])}`).join('\n')
    : '';

  const groups = [
    { key: 'bits', label: t('dataunit.bits'),      accent: 'var(--cyan)',   units: UNITS.filter(u => u.group === 'bits') },
    { key: 'si',   label: t('dataunit.si_bytes'),   accent: 'var(--yellow)', units: UNITS.filter(u => u.group === 'si') },
    { key: 'iec',  label: t('dataunit.iec_bytes'),  accent: 'var(--green)',  units: UNITS.filter(u => u.group === 'iec') },
  ];

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('common.input')}</div>
        <div className="field">
          <label className="label">{t('dataunit.value_and_unit')}</label>
          <div className="input-row">
            <input
              className={`input ${err ? 'error' : ''}`}
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="100"
              style={{ maxWidth: 180 }}
            />
            <select
              className="input"
              value={unit}
              onChange={e => setUnit(e.target.value)}
              style={{ maxWidth: 180 }}
            >
              <optgroup label={t('dataunit.bits')}>
                {UNITS.filter(u => u.group === 'bits').map(u => (
                  <option key={u.id} value={u.id}>{u.label} — {u.name}</option>
                ))}
              </optgroup>
              <optgroup label={t('dataunit.si_bytes')}>
                {UNITS.filter(u => u.group === 'si').map(u => (
                  <option key={u.id} value={u.id}>{u.label} — {u.name}</option>
                ))}
              </optgroup>
              <optgroup label={t('dataunit.iec_bytes')}>
                {UNITS.filter(u => u.group === 'iec').map(u => (
                  <option key={u.id} value={u.id}>{u.label} — {u.name}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <Err msg={err} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 4 }}>
          {PRESETS.map(p => (
            <button
              key={p.label}
              className="btn btn-ghost"
              style={{ fontSize: 12, padding: '3px 10px' }}
              onClick={() => { setValue(p.value); setUnit(p.unit); }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {results && (
        <div className="fadein">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
            <CopyBtn text={copyText} label="copy_all" id="dataunit-copy-all" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 12 }}>
            {groups.map(g => (
              <div key={g.key} className="card" style={{ margin: 0 }}>
                <div className="card-title" style={{ color: g.accent, fontSize: 13, marginBottom: 8 }}>{g.label}</div>
                {g.units.map(u => {
                  const val = results[u.id];
                  const isActive = u.id === unit;
                  return (
                    <div
                      key={u.id}
                      role="button"
                      tabIndex={0}
                      title={`${t('dataunit.click_to_use')} ${t('dataunit.' + u.nameKey, u.name)}`}
                      onClick={() => handleRowClick(u.id, val)}
                      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && handleRowClick(u.id, val)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'baseline',
                        gap: 8,
                        padding: '5px 8px',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        background: isActive ? 'var(--panel)' : 'transparent',
                        border: `1px solid ${isActive ? g.accent + '55' : 'transparent'}`,
                        marginBottom: 2,
                        outline: 'none',
                      }}
                    >
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 11,
                        color: isActive ? g.accent : 'var(--muted)',
                        minWidth: 34,
                        flexShrink: 0,
                      }}>{u.label}</span>
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontSize: 13,
                        color: isActive ? g.accent : 'var(--text)',
                        fontWeight: isActive ? 600 : 400,
                        textAlign: 'right',
                        wordBreak: 'break-all',
                      }}>{fmt(val)}</span>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--panel)', borderRadius: 'var(--radius)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.8 }}>
            <strong style={{ color: 'var(--yellow)' }}>{t('dataunit.si_label')}</strong>{' '}{t('dataunit.si_desc')}
            {' · '}
            <strong style={{ color: 'var(--green)' }}>{t('dataunit.iec_label')}</strong>{' '}{t('dataunit.iec_desc')}
            {' · '}
            {t('dataunit.click_hint')}
          </div>
        </div>
      )}
    </div>
  );
}

window.DataUnitConverter = DataUnitConverter;
