const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── NTP Reference Data ──────────────────────────────────────────────────────

const NTP_STRATA = [
  { level: 0,  badge: 'badge-purple', label: 'stratum0_label',  desc: 'stratum0_desc',  examples: 'stratum0_examples' },
  { level: 1,  badge: 'badge-cyan',   label: 'stratum1_label',  desc: 'stratum1_desc',  examples: 'stratum1_examples' },
  { level: 2,  badge: 'badge-green',  label: 'stratum2_label',  desc: 'stratum2_desc',  examples: 'stratum2_examples' },
  { level: 3,  badge: 'badge-green',  label: 'stratum3_label',  desc: 'stratum3_desc',  examples: 'stratum3_examples' },
  { level: '4–15', badge: 'badge-yellow', label: 'stratum4_15_label', desc: 'stratum4_15_desc', examples: 'stratum4_15_examples' },
  { level: 16, badge: 'badge-red',    label: 'stratum16_label', desc: 'stratum16_desc',  examples: 'stratum16_examples' },
];

const NTP_REFIDS = [
  { refid: '.GPS.',   meaning: 'refid_gps',    badge: 'badge-green' },
  { refid: '.PPS.',   meaning: 'refid_pps',    badge: 'badge-cyan' },
  { refid: '.GAL.',   meaning: 'refid_gal',    badge: 'badge-green' },
  { refid: '.GLNS.',  meaning: 'refid_glns',   badge: 'badge-green' },
  { refid: '.DCF.',   meaning: 'refid_dcf',    badge: 'badge-blue' },
  { refid: '.WWVB.',  meaning: 'refid_wwvb',   badge: 'badge-blue' },
  { refid: '.MSF.',   meaning: 'refid_msf',    badge: 'badge-blue' },
  { refid: '.ATOM.',  meaning: 'refid_atom',   badge: 'badge-purple' },
  { refid: '.LOCL.',  meaning: 'refid_locl',   badge: 'badge-yellow' },
  { refid: '.INIT.',  meaning: 'refid_init',   badge: 'badge-yellow' },
  { refid: '.STEP.',  meaning: 'refid_step',   badge: 'badge-yellow' },
  { refid: '.POOL.',  meaning: 'refid_pool',   badge: 'badge-cyan' },
  { refid: '.DENY.',  meaning: 'refid_deny',   badge: 'badge-red' },
  { refid: '.RSTR.',  meaning: 'refid_rstr',   badge: 'badge-red' },
  { refid: '.RATE.',  meaning: 'refid_rate',   badge: 'badge-red' },
  { refid: '.BCST.',  meaning: 'refid_bcst',   badge: 'badge-blue' },
  { refid: '.MCST.',  meaning: 'refid_mcst',   badge: 'badge-blue' },
];

// ─── ntpq/chronyc parse helpers ──────────────────────────────────────────────

const NTPQ_TALLY = {
  '*': { label: 'sys.peer',    badge: 'badge-green' },
  '+': { label: 'candidate',  badge: 'badge-cyan' },
  '-': { label: 'outlier',    badge: 'badge-yellow' },
  'x': { label: 'falseticker',badge: 'badge-red' },
  '#': { label: 'backup',     badge: 'badge-blue' },
  'o': { label: 'pps-peer',   badge: 'badge-purple' },
  ' ': { label: 'reject',     badge: 'badge-red' },
};

const CHRONY_MODE = {
  '^': 'server',
  '=': 'peer',
  '#': 'local ref',
};

const CHRONY_STATE = {
  '*': { label: 'synced',      badge: 'badge-green' },
  '+': { label: 'combined',    badge: 'badge-cyan' },
  '-': { label: 'not combined',badge: 'badge-yellow' },
  '?': { label: 'unreachable', badge: 'badge-red' },
  'x': { label: 'falseticker', badge: 'badge-red' },
  '~': { label: 'too variable',badge: 'badge-yellow' },
};

function parseNtpq(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line || line.startsWith('=') || line.startsWith('remote') || line.startsWith('     remote')) continue;
    // must start with a tally code character or space
    if (line.length < 10) continue;
    const tally = line[0];
    const rest = line.slice(1).trim();
    if (!rest) continue;
    const parts = rest.split(/\s+/);
    if (parts.length < 9) continue;
    const [remote, refid, st, t, when, poll, reach, delay, offset, jitter] = parts;
    if (isNaN(parseInt(st))) continue;
    const tallyInfo = NTPQ_TALLY[tally] || { label: tally || 'unknown', badge: 'badge-yellow' };
    rows.push({ tally, tallyInfo, remote, refid, st: parseInt(st), t: t || '-', when: when || '-', poll: poll || '-', reach: reach || '-', delay: delay || '-', offset: offset || '-', jitter: jitter || '-' });
  }
  return rows;
}

function parseChrony(text) {
  const rows = [];
  const lines = text.split('\n');
  for (const line of lines) {
    if (!line || line.startsWith('MS ') || line.startsWith('210 ') || line.startsWith('=')) continue;
    if (line.length < 4) continue;
    const mChar = line[0];
    const sChar = line[1];
    if (!CHRONY_MODE[mChar] && !'^=# '.includes(mChar)) continue;
    const rest = line.slice(2).trim();
    if (!rest) continue;
    const parts = rest.split(/\s+/);
    if (parts.length < 6) continue;
    const [name, stratum, poll, reach, lastRx, ...sampleParts] = parts;
    const sample = sampleParts.join(' ');
    const stNum = parseInt(stratum);
    if (isNaN(stNum)) continue;
    const stateInfo = CHRONY_STATE[sChar] || { label: sChar || 'unknown', badge: 'badge-yellow' };
    const mode = CHRONY_MODE[mChar] || mChar;
    rows.push({ mChar, sChar, mode, stateInfo, name, stratum: stNum, poll: poll || '-', reach: reach || '-', lastRx: lastRx || '-', sample: sample || '-' });
  }
  return rows;
}

function detectFormat(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  // ntpq -p has columns: remote refid st t when poll reach delay offset jitter
  if (/^\s*[*+\-xo# ][a-zA-Z0-9.[\]()_-]/.test(trimmed) && /\d+\s+\d+\s+\d+\s+[\d.+-]+\s+[\d.+-]+/.test(trimmed)) {
    // check for ntpq header hint
    if (trimmed.includes('refid') || trimmed.includes('reach') || /\d{1,3}\s+\d+\s+\d{1,3}\s+[\d.]+\s+[\d.+-]+/.test(trimmed)) {
      if (trimmed.match(/\.(GPS|PPS|LOCL|INIT|STEP|ATOM|DCF)\./)) return 'ntpq';
    }
    // chrony sources have MS columns
    if (/^[\\^=#][*+\-?x~]/.test(trimmed)) return 'chrony';
  }
  if (/^[\\^=#][*+\-?x~]\s/.test(trimmed) || trimmed.match(/^MS\s+Name/)) return 'chrony';
  if (trimmed.match(/refid\s+st\s+t\s+when/) || trimmed.match(/remote\s+refid/)) return 'ntpq';
  // Heuristic: chrony has two leading non-space chars
  const firstDataLine = trimmed.split('\n').find(l => l.trim().length > 0);
  if (firstDataLine && /^[\\^=#][*+\-?x~]/.test(firstDataLine)) return 'chrony';
  return 'ntpq'; // default
}

// ─── Component ───────────────────────────────────────────────────────────────

function NTPStratum({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  // Tab state
  const [tab, setTab] = usePersistentState('ntp-stratum:tab', initialData?.tab ?? 'hierarchy');
  const skipNavReport = useRef(false);

  // Offset/Delay/Jitter tab
  const [t1, setT1] = usePersistentState('ntp-stratum:t1', initialData?.t1 ?? '');
  const [t2, setT2] = usePersistentState('ntp-stratum:t2', initialData?.t2 ?? '');
  const [t3, setT3] = usePersistentState('ntp-stratum:t3', initialData?.t3 ?? '');
  const [t4, setT4] = usePersistentState('ntp-stratum:t4', initialData?.t4 ?? '');
  const [samples, setSamples] = usePersistentState('ntp-stratum:samples', []);

  // Parse tab
  const [raw, setRaw] = usePersistentState('ntp-stratum:raw', initialData?.raw ?? '');
  const [parseResult, setParseResult] = usePersistentState('ntp-stratum:parseResult', null);
  const [parseFormat, setParseFormat] = usePersistentState('ntp-stratum:parseFormat', null);
  const [parseErr, setParseErr] = useState('');

  // apply-down: sidebar/Ctrl+K/Help nav → inner tab + share-URL field restore
  useEffect(() => {
    if (!initialData) return;
    if (initialData.tab !== undefined && initialData.tab !== tab) {
      skipNavReport.current = true;
      setTab(initialData.tab);
    }
    if (initialData.t1 !== undefined) setT1(initialData.t1);
    if (initialData.t2 !== undefined) setT2(initialData.t2);
    if (initialData.t3 !== undefined) setT3(initialData.t3);
    if (initialData.t4 !== undefined) setT4(initialData.t4);
    if (initialData.raw !== undefined) setRaw(initialData.raw);
  }, [initialData]);

  // report-up: tab change → sidebar highlight
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ tab });
  }, [tab]);

  // Share wiring
  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'ntp-stratum', tab, raw, t1, t2, t3, t4 });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, raw, t1, t2, t3, t4, onShare]);

  // ── Offset / Delay / Jitter computation ────────────────────────────────────
  const odj = useMemo(() => {
    const v1 = parseFloat(t1);
    const v2 = parseFloat(t2);
    const v3 = parseFloat(t3);
    const v4 = parseFloat(t4);
    if ([v1, v2, v3, v4].some(isNaN)) return null;
    const offset = ((v2 - v1) + (v3 - v4)) / 2;
    const delay  = (v4 - v1) - (v3 - v2);
    return { offset, delay, valid: delay >= 0 };
  }, [t1, t2, t3, t4]);

  const addSample = useCallback(() => {
    if (!odj) return;
    setSamples(prev => [...prev, odj.offset]);
  }, [odj]);

  const clearSamples = useCallback(() => setSamples([]), []);

  const jitter = useMemo(() => {
    if (samples.length < 2) return null;
    const diffs = [];
    for (let i = 1; i < samples.length; i++) diffs.push(samples[i] - samples[i - 1]);
    const rms = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length);
    return rms;
  }, [samples]);

  // ── Parse logic ────────────────────────────────────────────────────────────
  const handleParse = useCallback(() => {
    setParseErr('');
    if (!raw.trim()) { setParseErr(t('ntp_stratum.parse_empty_err')); return; }
    const fmt = detectFormat(raw);
    setParseFormat(fmt);
    try {
      if (fmt === 'chrony') {
        const rows = parseChrony(raw);
        if (!rows.length) { setParseErr(t('ntp_stratum.parse_no_rows')); return; }
        setParseResult({ fmt, rows });
      } else {
        const rows = parseNtpq(raw);
        if (!rows.length) { setParseErr(t('ntp_stratum.parse_no_rows')); return; }
        setParseResult({ fmt, rows });
      }
    } catch (ex) {
      setParseErr(String(ex));
    }
  }, [raw, t]);

  const handleExportParse = useCallback(() => {
    if (!parseResult) return;
    exportJSON(parseResult, 'ntp-parse-result.json');
  }, [parseResult]);

  const handleClearParse = useCallback(() => {
    setRaw('');
    setParseResult(null);
    setParseFormat(null);
    setParseErr('');
  }, []);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fadein">
      {/* Tab bar */}
      <div style={{ display: 'flex', gap: '0.5rem', borderBottom: '1px solid var(--border)', marginBottom: '1.5rem', paddingBottom: '0.5rem', flexWrap: 'wrap' }}>
        <button className={`btn ${tab === 'hierarchy' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('hierarchy')}>
          {t('ntp_stratum.tab_hierarchy')}
        </button>
        <button className={`btn ${tab === 'odj' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('odj')}>
          {t('ntp_stratum.tab_odj')}
        </button>
        <button className={`btn ${tab === 'parse' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('parse')}>
          {t('ntp_stratum.tab_parse')}
        </button>
      </div>

      {/* ══ TAB 1: Stratum Hierarchy ══════════════════════════════════════════ */}
      {tab === 'hierarchy' && (
        <div>
          <div className="card">
            <div className="card-title">{t('ntp_stratum.title')}</div>
            <div className="hint" style={{ marginBottom: 20 }}>{t('ntp_stratum.hierarchy_hint')}</div>

            {/* Vertical chain diagram */}
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0, maxWidth: 720 }}>
              {NTP_STRATA.map((s, idx) => (
                <div key={idx} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', width: '100%' }}>
                  <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 16,
                    padding: '14px 18px', borderRadius: 'var(--radius)',
                    background: 'var(--panel)', border: '1px solid var(--border)', width: '100%',
                    boxSizing: 'border-box',
                  }}>
                    {/* Stratum badge */}
                    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 80 }}>
                      <span className={`badge ${s.badge}`} style={{ fontSize: 13, fontFamily: 'var(--mono)', fontWeight: 700, padding: '4px 10px' }}>
                        {t('ntp_stratum.stratum_prefix')} {s.level}
                      </span>
                    </div>
                    {/* Description */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>{t(`ntp_stratum.${s.label}`)}</div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{t(`ntp_stratum.${s.desc}`)}</div>
                      <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--cyan)', marginTop: 6 }}>{t(`ntp_stratum.${s.examples}`)}</div>
                    </div>
                  </div>
                  {/* Arrow connector (not after last) */}
                  {idx < NTP_STRATA.length - 1 && (
                    <div style={{ paddingLeft: 40, color: 'var(--muted)', fontSize: 18, lineHeight: '20px', margin: '2px 0' }}>&#8595;</div>
                  )}
                </div>
              ))}
            </div>

            {/* Notes */}
            <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 12, padding: '10px 14px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', lineHeight: 1.6 }}>
                <span style={{ fontWeight: 600, color: 'var(--yellow)' }}>{t('ntp_stratum.note_label')}: </span>
                {t('ntp_stratum.notes_text')}
              </div>
            </div>

            {/* RFC links */}
            <div style={{ marginTop: 12, display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
              <RFCLink rfc="RFC 5905" /> <span style={{ color: 'var(--muted)' }}>{t('ntp_stratum.rfc5905_label')}</span>
              <RFCLink rfc="RFC 4330" /> <span style={{ color: 'var(--muted)' }}>{t('ntp_stratum.rfc4330_label')}</span>
            </div>
          </div>

          {/* Reference IDs table */}
          <div className="card">
            <div className="card-title">{t('ntp_stratum.refid_title')}</div>
            <div className="hint" style={{ marginBottom: 16 }}>{t('ntp_stratum.refid_hint')}</div>
            <div className="table-wrap hide-mobile">
              <table>
                <thead>
                  <tr>
                    <th>refid</th>
                    <th>{t('ntp_stratum.th_meaning')}</th>
                  </tr>
                </thead>
                <tbody>
                  {NTP_REFIDS.map(r => (
                    <tr key={r.refid}>
                      <td><span className={`badge ${r.badge}`} style={{ fontFamily: 'var(--mono)' }}>{r.refid}</span></td>
                      <td style={{ fontSize: 13 }}>{t(`ntp_stratum.${r.meaning}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile */}
            <div className="show-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {NTP_REFIDS.map(r => (
                <div key={r.refid} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 12px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <span className={`badge ${r.badge}`} style={{ fontFamily: 'var(--mono)', minWidth: 70, textAlign: 'center' }}>{r.refid}</span>
                  <span style={{ fontSize: 12, color: 'var(--text)' }}>{t(`ntp_stratum.${r.meaning}`)}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Kiss-o'-Death */}
          <div className="card">
            <div className="card-title">{t('ntp_stratum.kod_title')}</div>
            <div style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>{t('ntp_stratum.kod_desc')}</div>
            <div className="result-grid" style={{ marginTop: 12 }}>
              <ResultItem label=".DENY." value={t('ntp_stratum.kod_deny')} />
              <ResultItem label=".RSTR." value={t('ntp_stratum.kod_rstr')} />
              <ResultItem label=".RATE." value={t('ntp_stratum.kod_rate')} />
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB 2: Offset / Delay / Jitter ═══════════════════════════════════ */}
      {tab === 'odj' && (
        <div>
          <div className="card">
            <div className="card-title">{t('ntp_stratum.odj_title')}</div>
            <div className="hint" style={{ marginBottom: 16 }}>{t('ntp_stratum.odj_hint')}</div>

            {/* Timestamp inputs */}
            <div className="two-col grid-mobile-1" style={{ gap: 20, marginBottom: 16 }}>
              <div className="field">
                <label className="label">T1 — {t('ntp_stratum.t1_label')}</label>
                <input className="input" type="number" step="any" placeholder="0.000" value={t1} onChange={e => setT1(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint">{t('ntp_stratum.t1_hint')}</div>
              </div>
              <div className="field">
                <label className="label">T2 — {t('ntp_stratum.t2_label')}</label>
                <input className="input" type="number" step="any" placeholder="0.000" value={t2} onChange={e => setT2(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint">{t('ntp_stratum.t2_hint')}</div>
              </div>
              <div className="field">
                <label className="label">T3 — {t('ntp_stratum.t3_label')}</label>
                <input className="input" type="number" step="any" placeholder="0.000" value={t3} onChange={e => setT3(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint">{t('ntp_stratum.t3_hint')}</div>
              </div>
              <div className="field">
                <label className="label">T4 — {t('ntp_stratum.t4_label')}</label>
                <input className="input" type="number" step="any" placeholder="0.000" value={t4} onChange={e => setT4(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint">{t('ntp_stratum.t4_hint')}</div>
              </div>
            </div>

            {/* Formula explanation */}
            <div style={{ padding: '10px 14px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)', marginBottom: 16, lineHeight: 1.8 }}>
              <div><span style={{ color: 'var(--cyan)' }}>offset</span> = ((T2 − T1) + (T3 − T4)) / 2</div>
              <div><span style={{ color: 'var(--cyan)' }}>delay</span> &nbsp;= (T4 − T1) − (T3 − T2)</div>
            </div>

            {/* Results */}
            {odj && (
              <div>
                <div className="result-grid" style={{ marginBottom: 12 }}>
                  <ResultItem
                    label={t('ntp_stratum.offset_label')}
                    value={`${odj.offset.toFixed(6)} s (${(odj.offset * 1000).toFixed(3)} ms)`}
                  />
                  <ResultItem
                    label={t('ntp_stratum.delay_label')}
                    value={`${odj.delay.toFixed(6)} s (${(odj.delay * 1000).toFixed(3)} ms)`}
                  />
                </div>
                {!odj.valid && (
                  <Err msg={t('ntp_stratum.delay_negative_err')} />
                )}
                <div className="btn-row" style={{ marginTop: 8 }}>
                  <button className="btn btn-sm btn-ghost" onClick={addSample}>{t('ntp_stratum.add_sample')}</button>
                  {samples.length > 0 && (
                    <button className="btn btn-sm btn-ghost" onClick={clearSamples}>{t('common.clear')}</button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Jitter from multiple samples */}
          {samples.length > 0 && (
            <div className="card">
              <div className="card-title">{t('ntp_stratum.jitter_title')}</div>
              <div style={{ marginBottom: 12 }}>
                <div className="hint">{t('ntp_stratum.jitter_hint', { n: samples.length })}</div>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t('ntp_stratum.offset_label')} (s)</th>
                      <th>{t('ntp_stratum.offset_label')} (ms)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {samples.map((s, i) => (
                      <tr key={i}>
                        <td style={{ fontFamily: 'var(--mono)', color: 'var(--muted)' }}>{i + 1}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{s.toFixed(6)}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{(s * 1000).toFixed(3)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {jitter !== null && (
                <div className="result-grid" style={{ marginTop: 12 }}>
                  <ResultItem label={t('ntp_stratum.jitter_rms_label')} value={`${jitter.toFixed(6)} s (${(jitter * 1000).toFixed(3)} ms)`} />
                  <ResultItem label={t('ntp_stratum.sample_count')} value={String(samples.length)} />
                </div>
              )}
              {samples.length < 2 && (
                <div className="hint" style={{ marginTop: 8 }}>{t('ntp_stratum.jitter_need_more')}</div>
              )}
            </div>
          )}

          {/* Quick formula reference */}
          <div className="card">
            <div className="card-title">{t('ntp_stratum.odj_ref_title')}</div>
            <div style={{ fontSize: 12, lineHeight: 1.8, color: 'var(--muted)' }}>
              <div>{t('ntp_stratum.odj_ref_desc')}</div>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div><span style={{ color: 'var(--cyan)', fontFamily: 'var(--mono)' }}>T1</span>: {t('ntp_stratum.t1_label')} — {t('ntp_stratum.t1_desc')}</div>
                <div><span style={{ color: 'var(--cyan)', fontFamily: 'var(--mono)' }}>T2</span>: {t('ntp_stratum.t2_label')} — {t('ntp_stratum.t2_desc')}</div>
                <div><span style={{ color: 'var(--cyan)', fontFamily: 'var(--mono)' }}>T3</span>: {t('ntp_stratum.t3_label')} — {t('ntp_stratum.t3_desc')}</div>
                <div><span style={{ color: 'var(--cyan)', fontFamily: 'var(--mono)' }}>T4</span>: {t('ntp_stratum.t4_label')} — {t('ntp_stratum.t4_desc')}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══ TAB 3: Parse ntpq / chronyc ══════════════════════════════════════ */}
      {tab === 'parse' && (
        <div>
          <div className="card">
            <div className="card-title">{t('ntp_stratum.parse_title')}</div>
            <div className="hint" style={{ marginBottom: 12 }}>{t('ntp_stratum.parse_hint')}</div>
            <div className="field">
              <label className="label">{t('ntp_stratum.parse_input_label')}</label>
              <textarea
                className="input"
                rows={10}
                style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', width: '100%', boxSizing: 'border-box' }}
                placeholder={t('ntp_stratum.parse_placeholder')}
                value={raw}
                onChange={e => setRaw(e.target.value)}
              />
            </div>
            <div className="btn-row">
              <button className="btn btn-primary" onClick={handleParse}>{t('ntp_stratum.parse_btn')}</button>
              <button className="btn btn-ghost" onClick={handleClearParse}>{t('common.clear')}</button>
            </div>
            {parseErr && <Err msg={parseErr} />}
          </div>

          {parseResult && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <div>
                  <div className="card-title" style={{ marginBottom: 2 }}>{t('common.results')}</div>
                  <div className="hint">
                    {t('ntp_stratum.detected_format')}: <span style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)', fontWeight: 600 }}>{parseResult.fmt === 'chrony' ? 'chronyc sources' : 'ntpq -p'}</span>
                    {' · '}{parseResult.rows.length} {t('ntp_stratum.peers_found')}
                  </div>
                </div>
                <button className="btn btn-sm btn-ghost" onClick={handleExportParse}>{t('common.export_json')}</button>
              </div>

              {/* ntpq table */}
              {parseResult.fmt === 'ntpq' && (
                <>
                  <div className="table-wrap hide-mobile">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('ntp_stratum.th_state')}</th>
                          <th>{t('ntp_stratum.th_remote')}</th>
                          <th>refid</th>
                          <th>{t('ntp_stratum.th_stratum')}</th>
                          <th>reach</th>
                          <th>delay</th>
                          <th>offset</th>
                          <th>jitter</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parseResult.rows.map((row, i) => (
                          <tr key={i} style={row.tally === '*' ? { background: 'rgba(80,200,120,0.07)' } : {}}>
                            <td>
                              <span className={`badge ${row.tallyInfo.badge}`} title={`tally: ${row.tally}`}>{row.tallyInfo.label}</span>
                            </td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.remote}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cyan)' }}>{row.refid}</td>
                            <td style={{ fontFamily: 'var(--mono)', textAlign: 'center' }}>
                              <span className={row.st <= 1 ? 'badge badge-purple' : row.st <= 3 ? 'badge badge-green' : row.st <= 8 ? 'badge badge-cyan' : row.st <= 15 ? 'badge badge-yellow' : 'badge badge-red'}>
                                {row.st}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.reach}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.delay}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.offset}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.jitter}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile cards for ntpq */}
                  <div className="show-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {parseResult.rows.map((row, i) => (
                      <div key={i} style={{ padding: '12px 14px', background: 'var(--panel)', border: `1px solid ${row.tally === '*' ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius)', borderLeft: `3px solid ${row.tally === '*' ? 'var(--green)' : 'var(--border)'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>{row.remote}</span>
                          <span className={`badge ${row.tallyInfo.badge}`}>{row.tallyInfo.label}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12, fontFamily: 'var(--mono)' }}>
                          <span style={{ color: 'var(--muted)' }}>refid:</span><span style={{ color: 'var(--cyan)' }}>{row.refid}</span>
                          <span style={{ color: 'var(--muted)' }}>stratum:</span><span>{row.st}</span>
                          <span style={{ color: 'var(--muted)' }}>offset:</span><span>{row.offset}</span>
                          <span style={{ color: 'var(--muted)' }}>jitter:</span><span>{row.jitter}</span>
                          <span style={{ color: 'var(--muted)' }}>delay:</span><span>{row.delay}</span>
                          <span style={{ color: 'var(--muted)' }}>reach:</span><span>{row.reach}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* chrony table */}
              {parseResult.fmt === 'chrony' && (
                <>
                  <div className="table-wrap hide-mobile">
                    <table>
                      <thead>
                        <tr>
                          <th>{t('ntp_stratum.th_state')}</th>
                          <th>{t('ntp_stratum.th_mode')}</th>
                          <th>{t('ntp_stratum.th_name')}</th>
                          <th>{t('ntp_stratum.th_stratum')}</th>
                          <th>reach</th>
                          <th>last rx</th>
                          <th>{t('ntp_stratum.th_sample')}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {parseResult.rows.map((row, i) => (
                          <tr key={i} style={row.sChar === '*' ? { background: 'rgba(80,200,120,0.07)' } : {}}>
                            <td><span className={`badge ${row.stateInfo.badge}`}>{row.stateInfo.label}</span></td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--muted)' }}>{row.mode}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.name}</td>
                            <td style={{ fontFamily: 'var(--mono)', textAlign: 'center' }}>
                              <span className={row.stratum <= 1 ? 'badge badge-purple' : row.stratum <= 3 ? 'badge badge-green' : row.stratum <= 8 ? 'badge badge-cyan' : row.stratum <= 15 ? 'badge badge-yellow' : 'badge badge-red'}>
                                {row.stratum}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.reach}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.lastRx}</td>
                            <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{row.sample}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {/* Mobile cards for chrony */}
                  <div className="show-mobile" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {parseResult.rows.map((row, i) => (
                      <div key={i} style={{ padding: '12px 14px', background: 'var(--panel)', border: `1px solid ${row.sChar === '*' ? 'var(--green)' : 'var(--border)'}`, borderRadius: 'var(--radius)', borderLeft: `3px solid ${row.sChar === '*' ? 'var(--green)' : 'var(--border)'}` }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                          <span style={{ fontFamily: 'var(--mono)', fontWeight: 600, fontSize: 13 }}>{row.name}</span>
                          <span className={`badge ${row.stateInfo.badge}`}>{row.stateInfo.label}</span>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, fontSize: 12, fontFamily: 'var(--mono)' }}>
                          <span style={{ color: 'var(--muted)' }}>mode:</span><span>{row.mode}</span>
                          <span style={{ color: 'var(--muted)' }}>stratum:</span><span>{row.stratum}</span>
                          <span style={{ color: 'var(--muted)' }}>reach:</span><span>{row.reach}</span>
                          <span style={{ color: 'var(--muted)' }}>last rx:</span><span>{row.lastRx}</span>
                          <span style={{ color: 'var(--muted)' }}>sample:</span><span style={{ gridColumn: 'span 1' }}>{row.sample}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {/* Tally code legend (ntpq) */}
              {parseResult.fmt === 'ntpq' && (
                <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: 'var(--muted)' }}>{t('ntp_stratum.tally_legend')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {Object.entries(NTPQ_TALLY).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)', minWidth: 14 }}>{k === ' ' ? '(space)' : k}</span>
                        <span className={`badge ${v.badge}`}>{v.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Chrony state legend */}
              {parseResult.fmt === 'chrony' && (
                <div style={{ marginTop: 16, padding: '10px 14px', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
                  <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 8, color: 'var(--muted)' }}>{t('ntp_stratum.chrony_legend')}</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {Object.entries(CHRONY_STATE).map(([k, v]) => (
                      <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--text)' }}>{k}</span>
                        <span className={`badge ${v.badge}`}>{v.label}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

window.NTPStratum = NTPStratum;
