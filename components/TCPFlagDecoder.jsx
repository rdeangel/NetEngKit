const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── TCP Flag Definitions (MSB→LSB, 9 bits) ──────────────────────────────────
const TCP_FLAGS = [
  {
    name: 'NS',
    mask: 0x100,
    bit: 8,
    wsField: 'tcp.flags.ns',
    rfc: 'RFC 3540',
    descKey: 'flag_desc_ns',
  },
  {
    name: 'CWR',
    mask: 0x080,
    bit: 7,
    wsField: 'tcp.flags.cwr',
    rfc: 'RFC 3168',
    descKey: 'flag_desc_cwr',
  },
  {
    name: 'ECE',
    mask: 0x040,
    bit: 6,
    wsField: 'tcp.flags.ece',
    rfc: 'RFC 3168',
    descKey: 'flag_desc_ece',
  },
  {
    name: 'URG',
    mask: 0x020,
    bit: 5,
    wsField: 'tcp.flags.urg',
    rfc: 'RFC 9293',
    descKey: 'flag_desc_urg',
  },
  {
    name: 'ACK',
    mask: 0x010,
    bit: 4,
    wsField: 'tcp.flags.ack',
    rfc: 'RFC 9293',
    descKey: 'flag_desc_ack',
  },
  {
    name: 'PSH',
    mask: 0x008,
    bit: 3,
    wsField: 'tcp.flags.push',
    rfc: 'RFC 9293',
    descKey: 'flag_desc_psh',
  },
  {
    name: 'RST',
    mask: 0x004,
    bit: 2,
    wsField: 'tcp.flags.reset',
    rfc: 'RFC 9293',
    descKey: 'flag_desc_rst',
  },
  {
    name: 'SYN',
    mask: 0x002,
    bit: 1,
    wsField: 'tcp.flags.syn',
    rfc: 'RFC 9293',
    descKey: 'flag_desc_syn',
  },
  {
    name: 'FIN',
    mask: 0x001,
    bit: 0,
    wsField: 'tcp.flags.fin',
    rfc: 'RFC 9293',
    descKey: 'flag_desc_fin',
  },
];

// ─── Common TCP Flag Combinations ────────────────────────────────────────────
const KNOWN_COMBOS = [
  { value: 0x000, labelKey: 'combo_null_scan',    descKey: 'combo_null_scan_desc' },
  { value: 0x001, labelKey: 'combo_fin',           descKey: 'combo_fin_desc' },
  { value: 0x002, labelKey: 'combo_syn',           descKey: 'combo_syn_desc' },
  { value: 0x004, labelKey: 'combo_rst',           descKey: 'combo_rst_desc' },
  { value: 0x008, labelKey: 'combo_psh',           descKey: 'combo_psh_desc' },
  { value: 0x010, labelKey: 'combo_ack',           descKey: 'combo_ack_desc' },
  { value: 0x011, labelKey: 'combo_fin_ack',       descKey: 'combo_fin_ack_desc' },
  { value: 0x012, labelKey: 'combo_syn_ack',       descKey: 'combo_syn_ack_desc' },
  { value: 0x014, labelKey: 'combo_rst_ack',       descKey: 'combo_rst_ack_desc' },
  { value: 0x018, labelKey: 'combo_psh_ack',       descKey: 'combo_psh_ack_desc' },
  { value: 0x019, labelKey: 'combo_fin_psh_ack',   descKey: 'combo_fin_psh_ack_desc' },
  { value: 0x029, labelKey: 'combo_xmas_scan',     descKey: 'combo_xmas_scan_desc' },
  { value: 0x03F, labelKey: 'combo_all_six',       descKey: 'combo_all_six_desc' },
];

// ─── Parse input string by mode ──────────────────────────────────────────────
function parseInput(raw, mode) {
  const s = raw.trim();
  if (!s) return null;
  let n;
  if (mode === 'hex') {
    const cleaned = s.replace(/^0x/i, '');
    n = parseInt(cleaned, 16);
  } else if (mode === 'bin') {
    const cleaned = s.replace(/^0b/i, '');
    n = parseInt(cleaned, 2);
  } else {
    n = parseInt(s, 10);
  }
  if (isNaN(n) || n < 0 || n > 0x1FF) return null;
  return n;
}

function toHex(v) {
  return '0x' + v.toString(16).toUpperCase().padStart(3, '0');
}

function toBin9(v) {
  return v.toString(2).padStart(9, '0');
}

function TCPFlagDecoder({ initialData, onShare }) {
  const { t } = useTranslation();
  const [copied, copy] = useCopy();

  const [value, setValue] = usePersistentState('tcp-flags:value', initialData?.value ?? 0x002);
  const [inMode, setInMode] = usePersistentState('tcp-flags:inMode', initialData?.inMode ?? 'hex');
  const [rawInput, setRawInput] = usePersistentState('tcp-flags:rawInput', initialData?.rawInput ?? '0x002');

  // Sync rawInput when value changes from checkbox toggling
  const inputRef = useRef(null);
  const skipSyncRef = useRef(false);

  // ── Restore from initialData ──────────────────────────────────────────────
  useEffect(() => {
    if (initialData) {
      if (initialData.value !== undefined) setValue(initialData.value);
      if (initialData.inMode !== undefined) setInMode(initialData.inMode);
      if (initialData.rawInput !== undefined) setRawInput(initialData.rawInput);
    }
  }, [initialData]);

  // ── Share wiring ──────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'tcp-flags', value, inMode });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [value, inMode, onShare]);

  // ── Parse text input → value ──────────────────────────────────────────────
  const debounceRef = useRef(null);

  const handleRawChange = useCallback((e) => {
    const raw = e.target.value;
    setRawInput(raw);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      const parsed = parseInput(raw, inMode);
      if (parsed !== null) {
        skipSyncRef.current = true;
        setValue(parsed);
      }
    }, 250);
  }, [inMode]);

  const handleModeChange = useCallback((e) => {
    const newMode = e.target.value;
    setInMode(newMode);
    // Re-format rawInput for new mode
    let formatted;
    if (newMode === 'hex') formatted = toHex(value);
    else if (newMode === 'bin') formatted = toBin9(value);
    else formatted = String(value);
    setRawInput(formatted);
  }, [value]);

  // ── Checkbox toggle ───────────────────────────────────────────────────────
  const handleToggle = useCallback((mask) => {
    const newVal = (value ^ mask) & 0x1FF;
    setValue(newVal);
    // Update rawInput to match new value
    let formatted;
    if (inMode === 'hex') formatted = toHex(newVal);
    else if (inMode === 'bin') formatted = toBin9(newVal);
    else formatted = String(newVal);
    setRawInput(formatted);
  }, [value, inMode]);

  // ── Derived display values ────────────────────────────────────────────────
  const hexStr = toHex(value);
  const decStr = String(value);
  const binStr = toBin9(value);

  const setFlags = useMemo(() => TCP_FLAGS.filter(f => (value & f.mask) !== 0), [value]);
  const flagList = setFlags.map(f => f.name).join(', ') || t('tcp_flags.no_flags');

  // Known combo detection
  const knownCombo = useMemo(() => KNOWN_COMBOS.find(c => c.value === value), [value]);

  // ── Wireshark filters ─────────────────────────────────────────────────────
  const wsCombined = `tcp.flags == ${hexStr}`;
  const wsPerFlag = setFlags.length > 0
    ? setFlags.map(f => `${f.wsField} == 1`).join(' && ')
    : 'tcp.flags == 0x000';

  // ── Export ────────────────────────────────────────────────────────────────
  const handleExport = () => {
    exportJSON({
      value_hex: hexStr,
      value_decimal: value,
      value_binary: binStr,
      flags_set: setFlags.map(f => f.name),
      flag_list: flagList,
      known_combination: knownCombo ? t(`tcp_flags.${knownCombo.labelKey}`) : null,
      wireshark_combined: wsCombined,
      wireshark_per_flag: wsPerFlag,
      all_flags: TCP_FLAGS.map(f => ({
        name: f.name,
        bit: f.bit,
        mask_hex: '0x' + f.mask.toString(16).toUpperCase().padStart(3, '0'),
        set: (value & f.mask) !== 0,
        wireshark_field: f.wsField,
        rfc: f.rfc,
      })),
    }, 'tcp-flags.json');
  };

  const badgeColor = (flag) => (value & flag.mask) !== 0 ? 'badge-cyan' : '';

  return (
    <div className="fadein">
      {/* ── Input Card ── */}
      <div className="card">
        <div className="card-title">{t('tcp_flags.title')}</div>
        <div className="hint" style={{ marginBottom: 16 }}>{t('tcp_flags.subtitle')}</div>

        <div className="two-col grid-mobile-1" style={{ gap: 16, alignItems: 'flex-end' }}>
          <div className="field">
            <label className="label">{t('tcp_flags.input_label')}</label>
            <div className="input-row" style={{ display: 'flex', gap: 8 }}>
              <select
                className="input"
                style={{ width: 'auto', flexShrink: 0 }}
                value={inMode}
                onChange={handleModeChange}
              >
                <option value="hex">{t('tcp_flags.mode_hex')}</option>
                <option value="dec">{t('tcp_flags.mode_dec')}</option>
                <option value="bin">{t('tcp_flags.mode_bin')}</option>
              </select>
              <input
                ref={inputRef}
                className="input"
                style={{ fontFamily: 'var(--mono)' }}
                value={rawInput}
                onChange={handleRawChange}
                placeholder={inMode === 'hex' ? '0x012' : inMode === 'bin' ? '000010010' : '18'}
                spellCheck={false}
              />
            </div>
            <div className="hint" style={{ marginTop: 6 }}>{t('tcp_flags.input_hint')}</div>
          </div>

          {/* Quick value display */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ textAlign: 'center' }}>
              <div className="hint" style={{ marginBottom: 2 }}>{t('tcp_flags.label_hex')}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: 'var(--cyan)' }}>{hexStr}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="hint" style={{ marginBottom: 2 }}>{t('tcp_flags.label_dec')}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: 'var(--text)' }}>{decStr}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div className="hint" style={{ marginBottom: 2 }}>{t('tcp_flags.label_bin')}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--yellow)', letterSpacing: 2 }}>{binStr}</div>
            </div>
          </div>
        </div>

        {/* Known combination banner */}
        {knownCombo && (
          <div style={{
            marginTop: 16,
            padding: '10px 14px',
            background: 'var(--panel)',
            border: '1px solid var(--border)',
            borderLeft: '3px solid var(--cyan)',
            borderRadius: 'var(--radius)',
            display: 'flex',
            gap: 12,
            alignItems: 'flex-start',
            flexWrap: 'wrap',
          }}>
            <span className="badge badge-cyan" style={{ flexShrink: 0, marginTop: 1 }}>
              {t(`tcp_flags.${knownCombo.labelKey}`)}
            </span>
            <span style={{ fontSize: 13, color: 'var(--muted)' }}>
              {t(`tcp_flags.${knownCombo.descKey}`)}
            </span>
          </div>
        )}
      </div>

      {/* ── Flag Checkboxes + Detail Table ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{t('tcp_flags.flags_title')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-sm btn-ghost" onClick={() => {
              setValue(0x000);
              const f = inMode === 'hex' ? '0x000' : inMode === 'bin' ? '000000000' : '0';
              setRawInput(f);
            }}>{t('common.clear')}</button>
            <button className="btn btn-sm btn-ghost" onClick={handleExport}>{t('common.export_json')}</button>
          </div>
        </div>

        {/* Checkbox row */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {TCP_FLAGS.map(flag => {
            const isSet = (value & flag.mask) !== 0;
            return (
              <label
                key={flag.name}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 4,
                  padding: '8px 12px',
                  background: isSet ? 'var(--panel)' : 'transparent',
                  border: `1px solid ${isSet ? 'var(--cyan)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                  userSelect: 'none',
                  minWidth: 52,
                }}
                onClick={() => handleToggle(flag.mask)}
              >
                <input
                  type="checkbox"
                  checked={isSet}
                  onChange={() => handleToggle(flag.mask)}
                  style={{ cursor: 'pointer' }}
                />
                <span style={{
                  fontFamily: 'var(--mono)',
                  fontWeight: 700,
                  fontSize: 13,
                  color: isSet ? 'var(--cyan)' : 'var(--muted)',
                }}>
                  {flag.name}
                </span>
                <span style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
                  bit {flag.bit}
                </span>
              </label>
            );
          })}
        </div>

        {/* Detail table — desktop */}
        <div className="table-wrap hide-mobile">
          <table>
            <thead>
              <tr>
                <th>{t('tcp_flags.th_flag')}</th>
                <th>{t('tcp_flags.th_bit')}</th>
                <th>{t('tcp_flags.th_mask')}</th>
                <th>{t('tcp_flags.th_state')}</th>
                <th>{t('tcp_flags.th_description')}</th>
                <th>{t('tcp_flags.th_wireshark')}</th>
                <th>{t('tcp_flags.th_rfc')}</th>
              </tr>
            </thead>
            <tbody>
              {TCP_FLAGS.map(flag => {
                const isSet = (value & flag.mask) !== 0;
                return (
                  <tr key={flag.name} style={{ opacity: isSet ? 1 : 0.55 }}>
                    <td>
                      <span style={{
                        fontFamily: 'var(--mono)',
                        fontWeight: 700,
                        color: isSet ? 'var(--cyan)' : 'var(--muted)',
                      }}>
                        {flag.name}
                      </span>
                    </td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{flag.bit}</td>
                    <td style={{ fontFamily: 'var(--mono)', color: 'var(--yellow)' }}>
                      {'0x' + flag.mask.toString(16).toUpperCase().padStart(3, '0')}
                    </td>
                    <td>
                      <span className={`badge ${isSet ? 'badge-green' : 'badge-red'}`}>
                        {isSet ? t('tcp_flags.state_set') : t('tcp_flags.state_unset')}
                      </span>
                    </td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{t(`tcp_flags.${flag.descKey}`)}</td>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{flag.wsField}</td>
                    <td><RFCLink rfc={flag.rfc} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile cards */}
        <div className="show-mobile mobile-cards">
          {TCP_FLAGS.map(flag => {
            const isSet = (value & flag.mask) !== 0;
            return (
              <div
                key={flag.name}
                className="mobile-card"
                style={{ borderLeft: `3px solid ${isSet ? 'var(--cyan)' : 'var(--border)'}`, opacity: isSet ? 1 : 0.6 }}
              >
                <div className="mobile-card-row">
                  <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: isSet ? 'var(--cyan)' : 'var(--muted)' }}>
                    {flag.name}
                  </span>
                  <span className={`badge ${isSet ? 'badge-green' : 'badge-red'}`}>
                    {isSet ? t('tcp_flags.state_set') : t('tcp_flags.state_unset')}
                  </span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('tcp_flags.th_bit')}</span>
                  <span className="mobile-card-value" style={{ fontFamily: 'var(--mono)' }}>{flag.bit}</span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{t('tcp_flags.th_mask')}</span>
                  <span className="mobile-card-value" style={{ fontFamily: 'var(--mono)', color: 'var(--yellow)' }}>
                    {'0x' + flag.mask.toString(16).toUpperCase().padStart(3, '0')}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
                  {t(`tcp_flags.${flag.descKey}`)} — {flag.wsField} — {flag.rfc}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Results Card ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{t('common.results')}</div>
          <CopyBtn text={flagList} label={t('tcp_flags.copy_flag_list')} id="flag-list" />
        </div>
        <div className="result-grid grid-mobile-1">
          <ResultItem label={t('tcp_flags.label_hex')} value={hexStr} />
          <ResultItem label={t('tcp_flags.label_dec')} value={decStr} />
          <ResultItem label={t('tcp_flags.label_bin')} value={binStr} />
          <ResultItem label={t('tcp_flags.label_flags_set')} value={flagList} />
        </div>
      </div>

      {/* ── Wireshark Filters Card ── */}
      <div className="card">
        <div className="card-title">{t('tcp_flags.ws_title')}</div>
        <div className="hint" style={{ marginBottom: 14 }}>{t('tcp_flags.ws_hint')}</div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {/* Combined filter */}
          <div>
            <div className="label" style={{ marginBottom: 6 }}>{t('tcp_flags.ws_combined_label')}</div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              flexWrap: 'wrap',
            }}>
              <code style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--cyan)', flex: 1 }}>
                {wsCombined}
              </code>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} title={t('tcp_flags.send_to_capture_hint')}
                onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: 'wireshark', activeTab: 'tshark', tsharkSubTab: 'builder', incomingDisplayFilter: wsCombined } }))}>
                {t('tcp_flags.send_to_capture')}
              </button>
              <CopyBtn text={wsCombined} label={t('common.copy')} id="ws-combined" />
            </div>
          </div>

          {/* Per-flag filter */}
          <div>
            <div className="label" style={{ marginBottom: 6 }}>{t('tcp_flags.ws_per_flag_label')}</div>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 14px',
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              flexWrap: 'wrap',
            }}>
              <code style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--green)', flex: 1, wordBreak: 'break-all' }}>
                {wsPerFlag}
              </code>
              <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} title={t('tcp_flags.send_to_capture_hint')}
                onClick={() => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: 'wireshark', activeTab: 'tshark', tsharkSubTab: 'builder', incomingDisplayFilter: wsPerFlag } }))}>
                {t('tcp_flags.send_to_capture')}
              </button>
              <CopyBtn text={wsPerFlag} label={t('common.copy')} id="ws-per-flag" />
            </div>
          </div>
        </div>
      </div>

      {/* ── Common Combinations Reference ── */}
      <div className="card">
        <div className="card-title">{t('tcp_flags.combos_title')}</div>
        <div className="hint" style={{ marginBottom: 14 }}>{t('tcp_flags.combos_hint')}</div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
          {KNOWN_COMBOS.map(combo => {
            const isActive = combo.value === value;
            return (
              <div
                key={combo.value}
                onClick={() => {
                  setValue(combo.value);
                  let f;
                  if (inMode === 'hex') f = toHex(combo.value);
                  else if (inMode === 'bin') f = toBin9(combo.value);
                  else f = String(combo.value);
                  setRawInput(f);
                }}
                style={{
                  padding: '10px 14px',
                  background: isActive ? 'var(--panel)' : 'transparent',
                  border: `1px solid ${isActive ? 'var(--cyan)' : 'var(--border)'}`,
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  transition: 'all 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span style={{ fontWeight: 700, fontSize: 13, color: isActive ? 'var(--cyan)' : 'var(--text)' }}>
                    {t(`tcp_flags.${combo.labelKey}`)}
                  </span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--yellow)' }}>
                    {toHex(combo.value)}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                  {t(`tcp_flags.${combo.descKey}`)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

window.TCPFlagDecoder = TCPFlagDecoder;
