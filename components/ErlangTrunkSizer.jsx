const { useState, useEffect, useCallback, useMemo, useRef } = React;

// <erlang-math>
// Numerically stable Erlang B. Never compute A^N / N! — both overflow past N≈170.
// Recurrence: B(0,A) = 1 ; B(n,A) = A*B(n-1,A) / (n + A*B(n-1,A))
// Every term stays in [0,1], so this is stable for any N the UI can reach.
const ERLANG_MAX_CIRCUITS = 10000;

function erlangB(N, A) {
  if (!isFinite(N) || !isFinite(A) || A < 0 || N < 0) return NaN;
  if (A === 0) return 0;                 // no offered load -> nothing can block
  const n = Math.min(Math.floor(N), ERLANG_MAX_CIRCUITS);
  let b = 1;                             // B(0,A) = 1 : with zero circuits everything blocks
  for (let k = 1; k <= n; k++) {
    const ab = A * b;
    b = ab / (k + ab);
  }
  return b;
}

// Smallest N with B(N,A) <= target. Iterates N from 0 reusing the recurrence term,
// so this is one pass, not N passes.
function erlangBSize(A, target) {
  if (!isFinite(A) || A < 0) return null;
  if (!isFinite(target) || target <= 0 || target >= 1) return null;
  if (A === 0) return 0;                 // A=0 -> B=0 at N=0, target already met
  let b = 1;
  if (b <= target) return 0;
  for (let k = 1; k <= ERLANG_MAX_CIRCUITS; k++) {
    const ab = A * b;
    b = ab / (k + ab);
    if (b <= target) return k;
  }
  return null;                           // did not converge inside the cap
}

// Erlang C (Erlang second formula) derived from B — cheaper and just as stable
// as its own recurrence. C(N,A) = B / (1 - rho*(1-B)) with rho = A/N.
// N <= A means the queue grows without bound: probability of waiting is 1.
function erlangC(N, A) {
  if (!isFinite(N) || !isFinite(A) || A < 0 || N <= 0) return NaN;
  if (A === 0) return 0;
  if (N <= A) return 1;
  const b = erlangB(N, A);
  return b / (1 - (A / N) * (1 - b));
}
// </erlang-math>

// ponytail: the B recurrence is the whole algorithm — no factorials, no bignum, no lookup table
// ponytail: known value — erlangBSize(10, 0.01) === 18 (standard Erlang B table).
// Checked by the node harness in .keleon/plans/fw3-erlang-trunk-sizer.md §9.2.

const ERLANG_TABS = ['size', 'erlangc', 'reference'];

// GoS presets. `label` is a protocol literal (P-notation) and stays untranslated.
const ERLANG_GOS_PRESETS = [
  { id: '0.01',   b: 0.01,   label: 'P.01'  },
  { id: '0.001',  b: 0.001,  label: 'P.001' },
];
const ERLANG_GOS_DEFAULT = '0.01';         // P.01 — the roster-pinned default

const ERLANG_TABLE_SPAN = 3;               // sizing table shows N-3 .. N+3

function ErlangTrunkSizer({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const skipNavReport = useRef(false);

  // --- navigation
  const [activeTab, setActiveTab] = usePersistentState('erlang:activeTab', (initialData?.activeTab) ?? 'size');

  // --- Size tab: direction toggle
  const [mode, setMode] = usePersistentState('erlang:mode', (initialData?.mode) ?? 'size');
  // 'size'     : offered load + target GoS -> circuits required
  // 'blocking' : offered load + circuit count -> blocking probability

  // --- offered load (shared by Size and Erlang C)
  const [loadMode, setLoadMode] = usePersistentState('erlang:loadMode', (initialData?.loadMode) ?? 'erlangs');
  // 'erlangs' | 'bhca'
  const [erlangs, setErlangs] = usePersistentState('erlang:erlangs', (initialData?.erlangs) ?? '10');
  const [bhca,    setBhca]    = usePersistentState('erlang:bhca',    (initialData?.bhca)    ?? '200');
  const [aht,     setAht]     = usePersistentState('erlang:aht',     (initialData?.aht)     ?? '180');
  const [ahtUnit, setAhtUnit] = usePersistentState('erlang:ahtUnit', (initialData?.ahtUnit) ?? 'sec'); // 'sec' | 'min'

  // --- Size tab: target GoS
  const [gos,       setGos]       = usePersistentState('erlang:gos',       (initialData?.gos)       ?? ERLANG_GOS_DEFAULT);
  // '0.01' | '0.001' | 'custom'
  const [gosCustom, setGosCustom] = usePersistentState('erlang:gosCustom', (initialData?.gosCustom) ?? '0.005');

  // --- Size tab: inverse mode input
  const [circuits, setCircuits] = usePersistentState('erlang:circuits', (initialData?.circuits) ?? '18');

  // --- Erlang C tab
  const [cServers, setCServers] = usePersistentState('erlang:cServers', (initialData?.cServers) ?? '13');
  const [cAht,     setCAht]     = usePersistentState('erlang:cAht',     (initialData?.cAht)     ?? '180'); // seconds
  const [cTarget,  setCTarget]  = usePersistentState('erlang:cTarget',  (initialData?.cTarget)  ?? '20');  // seconds

  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
  }, [initialData]);

  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'erlang-trunk',
      activeTab, mode, loadMode,
      erlangs, bhca, aht, ahtUnit,
      gos, gosCustom, circuits,
      cServers, cAht, cTarget,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [activeTab, mode, loadMode, erlangs, bhca, aht, ahtUnit, gos, gosCustom, circuits, cServers, cAht, cTarget, onShare]);

  // returns { A, valid, source } ; A in Erlangs
  const offeredLoad = useMemo(() => {
    if (loadMode === 'bhca') {
      const calls = parseFloat(bhca);
      const hold  = parseFloat(aht);
      if (!isFinite(calls) || !isFinite(hold) || calls < 0 || hold < 0) return { A: NaN, valid: false, source: 'bhca' };
      const holdSec = ahtUnit === 'min' ? hold * 60 : hold;
      return { A: (calls * holdSec) / 3600, valid: true, source: 'bhca' };
    }
    const a = parseFloat(erlangs);
    if (!isFinite(a) || a < 0) return { A: NaN, valid: false, source: 'erlangs' };
    return { A: a, valid: true, source: 'erlangs' };
  }, [loadMode, erlangs, bhca, aht, ahtUnit]);
  // ponytail: one conversion, one direction — no "Erlangs to CCS" converter nobody asked for

  const targetB = useMemo(() => (gos === 'custom' ? parseFloat(gosCustom) : parseFloat(gos)), [gos, gosCustom]);

  const gosShort = useMemo(() => {
    if (gos === 'custom') return String(gosCustom);
    const p = ERLANG_GOS_PRESETS.find(x => x.id === gos);
    return p ? p.label : gos;
  }, [gos, gosCustom]);

  const gosFull = useMemo(() => {
    if (gos === 'custom') return String(gosCustom);
    const p = ERLANG_GOS_PRESETS.find(x => x.id === gos);
    return p ? `${p.label} (${p.b})` : gos;
  }, [gos, gosCustom]);

  const sizeError = useMemo(() => {
    const raw = loadMode === 'bhca' ? `${bhca}${aht}` : erlangs;
    if (!String(raw).trim()) return '';
    if (!offeredLoad.valid)          return t('erlang_trunk.err_bad_load');
    if (offeredLoad.A > ERLANG_MAX_CIRCUITS) return t('erlang_trunk.err_load_too_large', { max: ERLANG_MAX_CIRCUITS });
    if (mode === 'size') {
      if (!isFinite(targetB) || targetB <= 0 || targetB >= 1) return t('erlang_trunk.err_bad_gos');
    } else {
      // Inverse: blank custom GoS is silent (same as a blank load). A present
      // but invalid custom GoS errors. Presets are always in (0, 1).
      if (gos === 'custom' && String(gosCustom).trim()) {
        if (!isFinite(targetB) || targetB <= 0 || targetB >= 1) return t('erlang_trunk.err_bad_gos');
      }
      if (!String(circuits).trim()) return '';
      const n = Number(circuits);
      if (!Number.isInteger(n) || n < 0 || n > ERLANG_MAX_CIRCUITS)
        return t('erlang_trunk.err_bad_circuits', { max: ERLANG_MAX_CIRCUITS });
    }
    return '';
  }, [loadMode, bhca, aht, erlangs, offeredLoad, mode, targetB, gos, gosCustom, circuits, t]);

  const cError = useMemo(() => {
    // Share load validation only. Size-tab circuit / GoS errors must not kill the C tab.
    const raw = loadMode === 'bhca' ? `${bhca}${aht}` : erlangs;
    if (!String(raw).trim()) return '';
    if (!offeredLoad.valid) return t('erlang_trunk.err_bad_load');
    if (offeredLoad.A > ERLANG_MAX_CIRCUITS) return t('erlang_trunk.err_load_too_large', { max: ERLANG_MAX_CIRCUITS });
    if (!String(cServers).trim() || !String(cAht).trim()) return '';
    const n = Number(cServers);
    if (!Number.isInteger(n) || n <= 0 || n > ERLANG_MAX_CIRCUITS) return t('erlang_trunk.err_bad_servers', { max: ERLANG_MAX_CIRCUITS });
    const h = parseFloat(cAht);
    if (!isFinite(h) || h <= 0) return t('erlang_trunk.err_bad_aht');
    const w = parseFloat(cTarget);
    if (String(cTarget).trim() && (!isFinite(w) || w < 0)) return t('erlang_trunk.err_bad_target');
    return '';
  }, [loadMode, bhca, aht, erlangs, offeredLoad, cServers, cAht, cTarget, t]);

  const sizeResult = useMemo(() => {
    if (sizeError) return null;
    if (!offeredLoad.valid) return null;
    const A = offeredLoad.A;
    if (mode === 'size') {
      if (!isFinite(targetB) || targetB <= 0 || targetB >= 1) return null;
      const nRequired = erlangBSize(A, targetB);
      if (nRequired === null) return null;
      const n = nRequired;
      const b = erlangB(n, A);
      const bPrev = n === 0 ? null : erlangB(n - 1, A);
      const carried = A * (1 - b);
      const lost = A * b;
      const efficiency = n > 0 ? carried / n : 0;
      const lo = Math.max(0, n - ERLANG_TABLE_SPAN);
      const hi = n + ERLANG_TABLE_SPAN;
      const table = [];
      for (let k = lo; k <= hi; k++) {
        const bk = erlangB(k, A);
        table.push({ k, b: bk, pct: bk * 100, carried: A * (1 - bk), meets: bk <= targetB });
      }
      return { A, n, b, bPrev, targetB, meetsTarget: b <= targetB, nRequired, carried, lost, efficiency, table };
    }
    if (!String(circuits).trim()) return null;
    const n = Number(circuits);
    if (!Number.isInteger(n) || n < 0 || n > ERLANG_MAX_CIRCUITS) return null;
    const b = erlangB(n, A);
    const bPrev = n === 0 ? null : erlangB(n - 1, A);
    const hasTarget = isFinite(targetB) && targetB > 0 && targetB < 1;
    const nRequired = hasTarget ? erlangBSize(A, targetB) : null;
    const carried = A * (1 - b);
    const lost = A * b;
    const efficiency = n > 0 ? carried / n : 0;
    const lo = Math.max(0, n - ERLANG_TABLE_SPAN);
    const hi = n + ERLANG_TABLE_SPAN;
    const table = [];
    for (let k = lo; k <= hi; k++) {
      const bk = erlangB(k, A);
      table.push({ k, b: bk, pct: bk * 100, carried: A * (1 - bk), meets: hasTarget ? bk <= targetB : null });
    }
    return { A, n, b, bPrev, targetB, meetsTarget: hasTarget ? b <= targetB : null, nRequired, carried, lost, efficiency, table };
  }, [sizeError, offeredLoad, mode, targetB, circuits]);

  const cResult = useMemo(() => {
    if (cError) return null;
    if (!offeredLoad.valid) return null;
    if (!String(cServers).trim() || !String(cAht).trim()) return null;
    const n = Number(cServers);
    const h = parseFloat(cAht);
    if (!Number.isInteger(n) || n <= 0 || !isFinite(h) || h <= 0) return null;
    const A = offeredLoad.A;
    const stable = n > A;
    const c = erlangC(n, A);
    const rho = A / n;
    const nStableMin = Math.floor(A) + 1;
    const targetRaw = String(cTarget).trim();
    const target = parseFloat(cTarget);
    const hasSlTarget = targetRaw !== '' && isFinite(target) && target >= 0;
    if (!stable) {
      return { A, n, stable: false, c: 1, rho, wAll: Infinity, wQueued: Infinity, serviceLevel: hasSlTarget ? 0 : null, nStableMin };
    }
    const wAll = c * h / (n - A);
    const wQueued = h / (n - A);
    // Blank target is silent: hide the SL row. Present 0 is SL(0) = 1 − C.
    const serviceLevel = hasSlTarget
      ? 1 - c * Math.exp(-(n - A) * target / h)
      : null;
    return { A, n, stable: true, c, rho, wAll, wQueued, serviceLevel, nStableMin };
  }, [cError, offeredLoad, cServers, cAht, cTarget]);

  const hints = useMemo(() => {
    const list = [];
    const A = offeredLoad.valid ? offeredLoad.A : NaN;
    if (A === 0) list.push({ level: 'yellow', key: 'erlang_trunk.hint_no_load', vars: undefined });
    if (sizeResult && sizeResult.efficiency < 0.5 && sizeResult.n > 0) {
      list.push({ level: 'yellow', key: 'erlang_trunk.hint_low_efficiency', vars: { pct: (sizeResult.efficiency * 100).toFixed(1) } });
    }
    if (sizeResult && sizeResult.n > 200) list.push({ level: 'yellow', key: 'erlang_trunk.hint_large_group', vars: undefined });
    if (A > 1000) list.push({ level: 'yellow', key: 'erlang_trunk.hint_aggregate_load', vars: undefined });
    if (mode === 'blocking' && sizeResult && sizeResult.nRequired !== null && sizeResult.meetsTarget === false) {
      list.push({ level: 'red', key: 'erlang_trunk.hint_misses_target', vars: { n: sizeResult.nRequired } });
    }
    if (isFinite(targetB) && targetB >= 0.05) list.push({ level: 'red', key: 'erlang_trunk.hint_loose_gos', vars: undefined });
    if (list.length === 0 && sizeResult && sizeResult.meetsTarget !== null) list.push({ level: 'green', key: 'erlang_trunk.hint_ok', vars: undefined });
    return list;
  }, [offeredLoad, sizeResult, mode, targetB]);
  // ponytail: a flat rule table, not a scoring engine

  const sizeCopyText = useMemo(() => {
    if (!sizeResult) return '';
    const r = sizeResult;
    const lines = [
      `${t('erlang_trunk.col_metric')}\t${t('erlang_trunk.col_value')}`,
      `${t('erlang_trunk.res_load')}\t${r.A.toFixed(3)} E`,
      `${t('erlang_trunk.res_gos')}\t${gosFull}`,
      `${t(mode === 'size' ? 'erlang_trunk.res_circuits' : 'erlang_trunk.res_circuits_given')}\t${r.n}`,
      `${t('erlang_trunk.res_blocking')}\t${(r.b * 100).toFixed(4)}%`,
    ];
    if (r.bPrev !== null) lines.push(`${t('erlang_trunk.res_blocking_prev')}\t${(r.bPrev * 100).toFixed(4)}%`);
    lines.push(`${t('erlang_trunk.res_carried')}\t${r.carried.toFixed(3)} E`);
    lines.push(`${t('erlang_trunk.res_lost')}\t${r.lost.toFixed(3)} E`);
    lines.push(`${t('erlang_trunk.res_efficiency')}\t${(r.efficiency * 100).toFixed(1)}%`);
    if (mode === 'blocking' && r.nRequired !== null) {
      lines.push(`${t('erlang_trunk.res_required_for_target')}\t${r.nRequired} (${gosShort})`);
    }
    lines.push('');
    lines.push(`${t('erlang_trunk.col_circuits')}\t${t('erlang_trunk.col_blocking')}\t${t('erlang_trunk.col_carried')}\t${t('erlang_trunk.col_meets')}`);
    r.table.forEach(row => {
      const meetsStr = row.meets === null ? '—' : (row.meets ? t('common.yes') : t('common.no'));
      lines.push(`${row.k}\t${row.pct.toFixed(4)}%\t${row.carried.toFixed(3)} E\t${meetsStr}`);
    });
    return lines.join('\n');
  }, [sizeResult, t, gosFull, gosShort, mode]);

  const cCopyText = useMemo(() => {
    if (!cResult) return '';
    const r = cResult;
    const waitAll = r.stable ? `${r.wAll.toFixed(1)} s` : '∞';
    const waitQ = r.stable ? `${r.wQueued.toFixed(1)} s` : '∞';
    const lines = [
      `${t('erlang_trunk.col_metric')}\t${t('erlang_trunk.col_value')}`,
      `${t('erlang_trunk.res_load')}\t${r.A.toFixed(3)} E`,
      `${t('erlang_trunk.c_servers')}\t${r.n}`,
      `${t('erlang_trunk.c_utilisation')}\t${(r.rho * 100).toFixed(1)}%`,
      `${t('erlang_trunk.c_prob_wait')}\t${(r.c * 100).toFixed(1)}%`,
      `${t('erlang_trunk.c_avg_wait')}\t${waitAll}`,
      `${t('erlang_trunk.c_avg_wait_queued')}\t${waitQ}`,
    ];
    if (r.serviceLevel !== null) {
      const sl = r.stable ? `${(r.serviceLevel * 100).toFixed(1)}%` : '0.0%';
      lines.push(`${t('erlang_trunk.c_service_level')}\t${sl}`);
    }
    return lines.join('\n');
  }, [cResult, t]);

  const tabKey = (id) => {
    if (id === 'erlangc') return 'erlang_trunk.tab_erlangc';
    if (id === 'reference') return 'erlang_trunk.tab_reference';
    return 'erlang_trunk.tab_size';
  };

  const thStyle = { padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase' };
  const tdStyle = { padding: '7px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12 };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('erlang_trunk.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>
          {t('erlang_trunk.subtitle')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ERLANG_TABS.map(id => (
            <button
              key={id}
              className={`btn ${activeTab === id ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12 }}
              onClick={() => setActiveTab(id)}
            >
              {t(tabKey(id))}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'size' && (
        <>
          <div className="card">
            <div className="card-title">{t('erlang_trunk.section_load')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <button className={`btn btn-sm ${loadMode === 'erlangs' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setLoadMode('erlangs')}>
                {t('erlang_trunk.load_mode_erlangs')}
              </button>
              <button className={`btn btn-sm ${loadMode === 'bhca' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setLoadMode('bhca')}>
                {t('erlang_trunk.load_mode_bhca')}
              </button>
            </div>
            {loadMode === 'erlangs' ? (
              <div className="field">
                <label className="label">{t('erlang_trunk.erlangs_label')}</label>
                <input className="input" value={erlangs} onChange={e => setErlangs(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint">{t('erlang_trunk.erlangs_hint')}</div>
              </div>
            ) : (
              <div className="two-col grid-mobile-1">
                <div className="field">
                  <label className="label">{t('erlang_trunk.bhca_label')}</label>
                  <input className="input" value={bhca} onChange={e => setBhca(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                  <div className="hint">{t('erlang_trunk.bhca_hint')}</div>
                </div>
                <div className="field">
                  <label className="label">{t('erlang_trunk.aht_label')}</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input className="input" value={aht} onChange={e => setAht(e.target.value)} style={{ fontFamily: 'var(--mono)', flex: 1 }} />
                    <select className="select" value={ahtUnit} onChange={e => setAhtUnit(e.target.value)} style={{ width: 120 }}>
                      <option value="sec">{t('erlang_trunk.unit_sec')}</option>
                      <option value="min">{t('erlang_trunk.unit_min')}</option>
                    </select>
                  </div>
                  <div className="hint">{t('erlang_trunk.aht_hint')}</div>
                </div>
              </div>
            )}
            {loadMode === 'bhca' && offeredLoad.valid && (
              <div className="hint" style={{ marginTop: 8 }}>{t('erlang_trunk.derived_load', { a: offeredLoad.A.toFixed(3) })}</div>
            )}
          </div>

          <div className="card">
            <div className="card-title">{t('erlang_trunk.section_target')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              <button className={`btn btn-sm ${mode === 'size' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('size')}>
                {t('erlang_trunk.mode_size')}
              </button>
              <button className={`btn btn-sm ${mode === 'blocking' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('blocking')}>
                {t('erlang_trunk.mode_blocking')}
              </button>
            </div>
            {mode === 'size' ? (
              <>
                <div className="field">
                  <label className="label">{t('erlang_trunk.gos_label')}</label>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {ERLANG_GOS_PRESETS.map(p => (
                      <button key={p.id} className={`btn btn-sm ${gos === p.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setGos(p.id)}>
                        {p.label}
                      </button>
                    ))}
                    <button className={`btn btn-sm ${gos === 'custom' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setGos('custom')}>
                      {t('erlang_trunk.gos_custom')}
                    </button>
                  </div>
                </div>
                {gos === 'custom' && (
                  <div className="field">
                    <label className="label">{t('erlang_trunk.gos_custom_label')}</label>
                    <input className="input" value={gosCustom} onChange={e => setGosCustom(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                    <div className="hint">{t('erlang_trunk.gos_custom_hint')}</div>
                  </div>
                )}
              </>
            ) : (
              <div className="field">
                <label className="label">{t('erlang_trunk.circuits_label')}</label>
                <input className="input" value={circuits} onChange={e => setCircuits(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint">{t('erlang_trunk.circuits_hint')}</div>
              </div>
            )}
          </div>

          <Err msg={sizeError} />

          {sizeResult && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <div className="card-title" style={{ margin: 0 }}>{t('erlang_trunk.section_result')}</div>
                <CopyBtn text={sizeCopyText} label="copy_all" id="erlang-size-copy-all" />
              </div>
              <div className="result-grid grid-mobile-1">
                <ResultItem label={t('erlang_trunk.res_load')} value={`${sizeResult.A.toFixed(3)} E`} />
                <ResultItem
                  label={t(mode === 'size' ? 'erlang_trunk.res_circuits' : 'erlang_trunk.res_circuits_given')}
                  value={String(sizeResult.n)}
                  accent
                />
                <ResultItem
                  label={t('erlang_trunk.res_blocking')}
                  value={`${(sizeResult.b * 100).toFixed(4)}%  ${sizeResult.b.toExponential(3)}`}
                />
                {sizeResult.bPrev !== null && (
                  <ResultItem
                    label={t('erlang_trunk.res_blocking_prev')}
                    value={`${(sizeResult.bPrev * 100).toFixed(4)}%  ${sizeResult.bPrev.toExponential(3)}`}
                  />
                )}
                <ResultItem label={t('erlang_trunk.res_carried')} value={`${sizeResult.carried.toFixed(3)} E`} green />
                <ResultItem label={t('erlang_trunk.res_lost')} value={`${sizeResult.lost.toFixed(3)} E`} red />
                <ResultItem
                  label={t('erlang_trunk.res_efficiency')}
                  value={`${(sizeResult.efficiency * 100).toFixed(1)}%`}
                  yellow={sizeResult.efficiency < 0.5}
                />
                {mode === 'blocking' && sizeResult.nRequired !== null && (
                  <ResultItem
                    label={t('erlang_trunk.res_required_for_target')}
                    value={`${sizeResult.nRequired} (${gosShort})`}
                  />
                )}
              </div>
              <div className="hint" style={{ marginTop: 12 }}>{t('erlang_trunk.equivalence_note')}</div>

              <div className="card-title" style={{ marginTop: 16 }}>{t('erlang_trunk.section_table')}</div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      <th style={thStyle}>{t('erlang_trunk.col_circuits')}</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>{t('erlang_trunk.col_blocking')}</th>
                      <th style={{ ...thStyle, textAlign: 'right' }}>{t('erlang_trunk.col_carried')}</th>
                      <th style={thStyle}>{t('erlang_trunk.col_meets')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sizeResult.table.map(row => {
                      const hi = row.k === sizeResult.n;
                      return (
                        <tr key={row.k} style={{ background: hi ? 'var(--panel)' : 'transparent', fontWeight: hi ? 600 : 400 }}>
                          <td style={tdStyle}>{row.k}</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{row.pct.toFixed(4)}%</td>
                          <td style={{ ...tdStyle, textAlign: 'right' }}>{row.carried.toFixed(3)} E</td>
                          <td style={tdStyle}>
                            {row.meets === null ? '—' : (
                              <span className={`badge ${row.meets ? 'badge-green' : 'badge-red'}`}>
                                {row.meets ? t('common.yes') : t('common.no')}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {hints.length > 0 && (
                <div style={{ marginTop: 16 }}>
                  <div className="card-title">{t('erlang_trunk.section_hints')}</div>
                  {hints.map(h => (
                    <div key={h.key} style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                      <span className={`badge badge-${h.level}`} />
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t(h.key, h.vars)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {activeTab === 'erlangc' && (
        <>
          <div className="card">
            <div className="hint" style={{ marginBottom: 12 }}>{t('erlang_trunk.c_load_note')}</div>
            <div className="card-title">{t('erlang_trunk.section_c_inputs')}</div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('erlang_trunk.c_servers')}</label>
                <input className="input" value={cServers} onChange={e => setCServers(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint">{t('erlang_trunk.c_servers_hint')}</div>
              </div>
              <div className="field">
                <label className="label">{t('erlang_trunk.c_aht')}</label>
                <input className="input" value={cAht} onChange={e => setCAht(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint">{t('erlang_trunk.c_aht_hint')}</div>
              </div>
              <div className="field">
                <label className="label">{t('erlang_trunk.c_target')}</label>
                <input className="input" value={cTarget} onChange={e => setCTarget(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
                <div className="hint">{t('erlang_trunk.c_target_hint')}</div>
              </div>
            </div>
          </div>

          <Err msg={cError} />

          {cResult && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
                <div className="card-title" style={{ margin: 0 }}>{t('erlang_trunk.section_c_result')}</div>
                <CopyBtn text={cCopyText} label="copy_all" id="erlang-c-copy-all" />
              </div>
              {!cResult.stable && (
                <div style={{ fontSize: 12, color: 'var(--yellow)', marginBottom: 12 }}>
                  {t('erlang_trunk.c_unstable', { min: cResult.nStableMin })}
                </div>
              )}
              <div className="result-grid grid-mobile-1">
                <ResultItem label={t('erlang_trunk.res_load')} value={`${cResult.A.toFixed(3)} E`} />
                <ResultItem label={t('erlang_trunk.c_servers')} value={String(cResult.n)} accent />
                <ResultItem label={t('erlang_trunk.c_utilisation')} value={`${(cResult.rho * 100).toFixed(1)}%`} />
                <ResultItem label={t('erlang_trunk.c_prob_wait')} value={`${(cResult.c * 100).toFixed(1)}%`} />
                <ResultItem label={t('erlang_trunk.c_avg_wait')} value={cResult.stable ? `${cResult.wAll.toFixed(1)} s` : '∞'} />
                <ResultItem label={t('erlang_trunk.c_avg_wait_queued')} value={cResult.stable ? `${cResult.wQueued.toFixed(1)} s` : '∞'} />
                {cResult.serviceLevel !== null && (
                  <ResultItem label={t('erlang_trunk.c_service_level')} value={cResult.stable ? `${(cResult.serviceLevel * 100).toFixed(1)}%` : '0.0%'} />
                )}
                {!cResult.stable && (
                  <ResultItem label={t('erlang_trunk.c_min_servers')} value={String(cResult.nStableMin)} />
                )}
              </div>
            </div>
          )}
        </>
      )}

      {activeTab === 'reference' && (
        <>
          <div className="card">
            <div className="card-title">{t('erlang_trunk.ref_bc_title')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={thStyle}>{t('erlang_trunk.ref_col_aspect')}</th>
                    <th style={thStyle}>Erlang B</th>
                    <th style={thStyle}>Erlang C</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_row_blocked')}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_b_blocked')}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_c_blocked')}</td>
                  </tr>
                  <tr>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_row_sizes')}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_b_sizes')}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_c_sizes')}</td>
                  </tr>
                  <tr>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_row_use')}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_b_use')}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_c_use')}</td>
                  </tr>
                  <tr>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_row_assumes')}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_b_assumes')}</td>
                    <td style={{ ...tdStyle, fontFamily: 'inherit' }}>{t('erlang_trunk.ref_c_assumes')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="card-title" style={{ marginTop: 16 }}>{t('erlang_trunk.ref_formula_title')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('erlang_trunk.ref_formula_b')}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('erlang_trunk.ref_formula_c')}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('erlang_trunk.ref_units_title')}</div>
            <div style={{ fontSize: 12, color: 'var(--text)', lineHeight: 1.6 }}>
              <div style={{ marginBottom: 8 }}>{t('erlang_trunk.ref_unit_erlang')}</div>
              <div style={{ marginBottom: 8 }}>{t('erlang_trunk.ref_unit_bhca')}</div>
              <div style={{ marginBottom: 8 }}>{t('erlang_trunk.ref_unit_aht')}</div>
              <div style={{ marginBottom: 8 }}>{t('erlang_trunk.ref_unit_gos')}</div>
              <div>{t('erlang_trunk.ref_unit_pnotation')}</div>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('erlang_trunk.ref_example_title')}</div>
            <pre style={{
              fontFamily: 'var(--mono)',
              fontSize: 12,
              whiteSpace: 'pre-wrap',
              color: 'var(--text)',
              background: 'var(--panel)',
              padding: 12,
              borderRadius: 'var(--radius)',
              margin: 0,
            }}>{t('erlang_trunk.ref_example')}</pre>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 14 }}>{t('erlang_trunk.related')}</div>
          </div>
        </>
      )}
    </div>
  );
}

window.ErlangTrunkSizer = ErlangTrunkSizer;
