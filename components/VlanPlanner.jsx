const { useState, useEffect, useMemo, useRef } = React;

const VP_FINDINGS_CAP = 500;
const VP_ROWS_CAP = 1000; // ponytail: render cap; exports and copy always use every row.
const VP_SEV_COLOR = { error: 'var(--red)', warn: 'var(--yellow)', info: 'var(--blue)' };
const VP_SEV_BADGE = { error: 'badge-red', warn: 'badge-yellow', info: 'badge-blue' };
const VP_SEV_RANK = { error: 0, warn: 1, info: 2 };

// Worst severity per entry index.
function vpWorstByRow(findings) {
  const m = new Map();
  for (const f of findings) {
    for (const r of f.rows) {
      const cur = m.get(r);
      if (!cur || VP_SEV_RANK[f.sev] < VP_SEV_RANK[cur]) m.set(r, f.sev);
    }
  }
  return m;
}

function vpDownload(text, filename) {
  const blob = new Blob([text], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Table on desktop, cards on mobile. cols: [{ h, cell(row, i) }]
function VpTable({ cols, rows, rowStyle }) {
  return (
    <>
      <div className="table-wrap hide-mobile">
        <table>
          <thead><tr>{cols.map((c, i) => <th key={i}>{c.h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} style={rowStyle ? rowStyle(r, i) : undefined}>
                {cols.map((c, j) => <td key={j} style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{c.cell(r, i)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="show-mobile mobile-cards">
        {rows.map((r, i) => (
          <div key={i} className="mobile-card">
            {cols.map((c, j) => (
              <div key={j} className="mobile-card-row">
                <span className="mobile-card-label">{c.h}</span>
                <span className="mobile-card-value">{c.cell(r, i)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </>
  );
}

function VpFindings({ findings, rowLabel }) {
  const { t } = useTranslation();
  const n = { error: 0, warn: 0, info: 0 };
  findings.forEach(f => { n[f.sev]++; });
  const shown = findings.slice(0, VP_FINDINGS_CAP);
  const text = (f) => {
    const params = { ...f.params };
    if (f.code === 'PARSE_ERROR') params.field = t('vlan_planner.field_' + params.field);
    return t('vlan_planner.f_' + f.code.toLowerCase(), params);
  };
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: findings.length ? 10 : 0 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{t('vlan_planner.findings_title')}</div>
        {findings.length === 0
          ? <span className="badge badge-green">{t('vlan_planner.no_findings')}</span>
          : <span className={`badge ${n.error ? 'badge-red' : n.warn ? 'badge-yellow' : 'badge-blue'}`}>
              {t('vlan_planner.findings_count', { errors: n.error, warns: n.warn, infos: n.info })}
            </span>}
      </div>
      {shown.map((f, i) => {
        const ref = rowLabel ? rowLabel(f.rows) : '';
        return (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
            <span className={`badge ${VP_SEV_BADGE[f.sev]}`} style={{ flexShrink: 0 }}>{t('vlan_planner.sev_' + f.sev)}</span>
            <div style={{ minWidth: 0 }}>
              <div>{text(f)}</div>
              {ref ? <div style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 2 }}>{ref}</div> : null}
            </div>
          </div>
        );
      })}
      {findings.length > shown.length && (
        <div className="hint" style={{ marginTop: 8 }}>{t('vlan_planner.findings_more', { count: findings.length - shown.length })}</div>
      )}
    </div>
  );
}

function VlanPlanner({ initialData, onShare }) {
  const { t } = useTranslation();
  const [copied, copy] = useCopy();
  const P = window.VlanPlan;

  const [tab, setTab] = usePersistentState('vlanplanner:tab', 'plan');
  const [sites, setSites] = usePersistentState('vlanplanner:sites', P.DEFAULT_PLAN.sites);
  const [roles, setRoles] = usePersistentState('vlanplanner:roles', P.DEFAULT_PLAN.roles);
  const [csv, setCsv] = usePersistentState('vlanplanner:csv', '');
  const [useSiteRules, setUseSiteRules] = usePersistentState('vlanplanner:useSiteRules', false);
  const [csvD, setCsvD] = useState(csv);
  const [fileErr, setFileErr] = useState('');
  const fileRef = useRef(null);

  // Restore from share URL / cross-tool navigation (untrusted: sanitised).
  useEffect(() => {
    if (!initialData) return;
    if (initialData.sites || initialData.roles) {
      const clean = P.sanitizePlan(initialData);
      if (initialData.sites) setSites(clean.sites);
      if (initialData.roles) setRoles(clean.roles);
    }
    if (initialData.csv != null) setCsv(String(initialData.csv).slice(0, 200000));
    if (initialData.tab === 'plan' || initialData.tab === 'audit') setTab(initialData.tab);
    if (initialData.useSiteRules != null) setUseSiteRules(!!initialData.useSiteRules);
  }, [initialData]);

  useEffect(() => {
    const handle = (e) =>
      (e.detail && e.detail.respond ? e.detail.respond : onShare)({
        tool: 'vlan-planner', tab, sites, roles, csv, useSiteRules,
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, sites, roles, csv, useSiteRules, onShare]);
  // ponytail: large pasted CSVs make long share URLs; same trade-off as net-table-sorter.

  // 300 ms debounce on the pasted CSV.
  useEffect(() => {
    const id = setTimeout(() => setCsvD(csv), 300);
    return () => clearTimeout(id);
  }, [csv]);

  // ── Plan tab derivations ────────────────────────────────────────────
  const clean = useMemo(() => P.sanitizePlan({ sites, roles }), [P, sites, roles]);
  const alloc = useMemo(() => P.allocate(clean), [P, clean]);
  const planFindings = useMemo(() => P.sortFindings([
    ...P.validateSites(clean.sites),
    ...alloc.findings,
    ...P.audit(alloc.entries, clean.sites),
  ]), [P, clean, alloc]);
  const planWorst = useMemo(() => vpWorstByRow(planFindings), [planFindings]);
  const summary = useMemo(() => P.summarize(alloc.entries, clean.sites), [P, alloc, clean]);

  // ── Audit tab derivations ───────────────────────────────────────────
  const parsed = useMemo(() => P.parseCSV(csvD), [P, csvD]);
  const auditFindings = useMemo(() => P.sortFindings([
    ...parsed.findings,
    ...P.audit(parsed.entries, useSiteRules ? clean.sites : undefined),
  ]), [P, parsed, useSiteRules, clean]);
  const auditWorst = useMemo(() => vpWorstByRow(auditFindings), [auditFindings]);

  const setSite = (i, patch) => setSites(prev => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const setRole = (i, patch) => setRoles(prev => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const intVal = (v) => (v === '' ? NaN : parseInt(v, 10));
  const numShown = (n) => (Number.isInteger(n) ? n : '');

  const addSite = () => setSites(prev => prev.concat([{
    name: `SITE${prev.length + 1}`, domain: '', vlanStart: 100, vlanEnd: 199, v4Pool: '', v6Block: '',
  }]));
  const addRole = () => setRoles(prev => prev.concat([{ name: `ROLE${prev.length + 1}`, prefix: 24, count: 1 }]));
  const loadExample = () => {
    setSites(P.DEFAULT_PLAN.sites.map(s => ({ ...s })));
    setRoles(P.DEFAULT_PLAN.roles.map(r => ({ ...r })));
  };

  const openTool = (tool) => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool } }));

  const readFile = (file) => {
    setFileErr('');
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) { setFileErr(t('vlan_planner.err_file_too_big')); return; }
    const fr = new FileReader();
    fr.onload = () => setCsv(String(fr.result || '').slice(0, 200000));
    fr.onerror = () => setFileErr(t('vlan_planner.err_file_read'));
    fr.readAsText(file);
  };

  const tabBtnStyle = (active) => ({
    background: active ? 'var(--card)' : 'transparent',
    border: '1px solid var(--border)',
    borderBottom: active ? '1px solid var(--card)' : '1px solid var(--border)',
    borderRadius: 'var(--radius) var(--radius) 0 0',
    color: active ? 'var(--fg)' : 'var(--dim)',
    padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    marginBottom: -1, position: 'relative',
  });
  const cellIn = { padding: '4px 6px', fontSize: 12, fontFamily: 'var(--mono)', minWidth: 0 };

  const sevDot = (sev) => (sev
    ? <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: VP_SEV_COLOR[sev], marginRight: 6 }} />
    : null);

  const statusBadge = (sev) => (sev
    ? <span className={`badge ${VP_SEV_BADGE[sev]}`}>{t('vlan_planner.sev_' + sev)}</span>
    : <span className="badge badge-green">{t('vlan_planner.status_ok')}</span>);

  const gatewayOf = (subnet) => {
    const d = subnet ? P.describeV4(subnet) : null;
    if (!d) return { gw: '', hosts: '' };
    const p2p = /\/31$/.test(subnet);
    return { gw: p2p ? t('vlan_planner.p2p_ends', { a: d.first, b: d.last }) : d.gateway, hosts: d.usable };
  };

  // ── Plan tab: allocation table ──────────────────────────────────────
  const unalloc = <span style={{ color: 'var(--red)' }}>{t('vlan_planner.unallocated')}</span>;
  const allocCols = [
    { h: t('vlan_planner.col_site'), cell: (e, i) => <>{sevDot(planWorst.get(i))}{e.site}</> },
    { h: t('vlan_planner.col_vlan'), cell: e => (e.vlan === null ? unalloc : e.vlan) },
    { h: t('vlan_planner.col_name'), cell: e => e.name },
    { h: t('vlan_planner.col_subnet'), cell: e => (e.subnet === null ? unalloc : e.subnet || '') },
    { h: t('vlan_planner.col_gateway'), cell: e => gatewayOf(e.subnet).gw },
    { h: t('vlan_planner.col_hosts'), cell: e => gatewayOf(e.subnet).hosts },
    { h: t('vlan_planner.col_subnet6'), cell: e => e.subnet6 || '' },
  ];
  const allocTSV = [allocCols.map(c => c.h).join('\t')]
    .concat(alloc.entries.map(e => [
      e.site, e.vlan ?? t('vlan_planner.unallocated'), e.name, e.subnet ?? t('vlan_planner.unallocated'),
      gatewayOf(e.subnet).gw, gatewayOf(e.subnet).hosts, e.subnet6 || '',
    ].join('\t'))).join('\n');

  const summaryLines = summary.map(s => t('vlan_planner.sum_line', {
    site: s.site, used: s.vlansUsed, size: s.rangeSize, poolUsed: s.poolUsed, poolSize: s.poolSize,
    pct: s.poolSize ? Math.round((s.poolUsed / s.poolSize) * 1000) / 10 : 0,
  }));
  const counts = { error: 0, warn: 0, info: 0 };
  planFindings.forEach(f => { counts[f.sev]++; });
  const summaryText = [
    t('vlan_planner.summary_text_header'),
    ...summaryLines,
    t('vlan_planner.findings_count', { errors: counts.error, warns: counts.warn, infos: counts.info }),
  ].join('\n');

  const planRowLabel = (rows) => rows.slice(0, 3).map(i => {
    const e = alloc.entries[i];
    return e ? `${e.site}/${e.vlan ?? '-'} ${e.name}` : '';
  }).filter(Boolean).join(', ');

  // ── Audit tab: parsed rows ──────────────────────────────────────────
  const dash = (v) => (v === null || v === undefined ? '' : v);
  const auditCols = [
    { h: t('vlan_planner.col_line'), cell: e => e.line },
    { h: t('vlan_planner.col_site'), cell: e => dash(e.site) },
    { h: t('vlan_planner.col_vlan'), cell: e => dash(e.vlan) },
    { h: t('vlan_planner.col_name'), cell: e => e.name },
    { h: t('vlan_planner.col_subnet'), cell: e => dash(e.subnet) },
    { h: t('vlan_planner.col_subnet6'), cell: e => dash(e.subnet6) },
    { h: t('vlan_planner.col_status'), cell: (e, i) => statusBadge(auditWorst.get(i)) },
  ];
  const auditTSV = [auditCols.map(c => c.h).join('\t')]
    .concat(parsed.entries.map((e, i) => [
      e.line, dash(e.site), dash(e.vlan), e.name, dash(e.subnet), dash(e.subnet6),
      auditWorst.get(i) ? t('vlan_planner.sev_' + auditWorst.get(i)) : t('vlan_planner.status_ok'),
    ].join('\t'))).join('\n');
  const auditRowLabel = (rows) => rows.slice(0, 5).map(i => {
    const e = parsed.entries[i];
    return e && e.line ? t('vlan_planner.line_ref', { line: e.line }) : '';
  }).filter(Boolean).join(', ');

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('vlan_planner.title')}</div>
        <div className="hint" style={{ marginBottom: 12 }}>{t('vlan_planner.subtitle')}</div>
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
          <button style={tabBtnStyle(tab === 'plan')} onClick={() => setTab('plan')}>{t('vlan_planner.tab_plan')}</button>
          <button style={tabBtnStyle(tab === 'audit')} onClick={() => setTab('audit')}>{t('vlan_planner.tab_audit')}</button>
        </div>
      </div>

      {tab === 'plan' && (
        <>
          <div className="card">
            <div className="card-title">{t('vlan_planner.sites_title')}</div>
            <div className="hint" style={{ marginBottom: 10 }}>{t('vlan_planner.sites_hint')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('vlan_planner.col_site')}</th><th>{t('vlan_planner.col_domain')}</th>
                    <th>{t('vlan_planner.col_vlan_start')}</th><th>{t('vlan_planner.col_vlan_end')}</th>
                    <th>{t('vlan_planner.col_v4_pool')}</th><th>{t('vlan_planner.col_v6_block')}</th><th />
                  </tr>
                </thead>
                <tbody>
                  {sites.map((s, i) => (
                    <tr key={i}>
                      <td><input className="input" style={{ ...cellIn, width: 90 }} value={s.name} onChange={e => setSite(i, { name: e.target.value })} /></td>
                      <td><input className="input" style={{ ...cellIn, width: 100 }} value={s.domain} placeholder={t('vlan_planner.domain_placeholder')} onChange={e => setSite(i, { domain: e.target.value })} /></td>
                      <td><input className="input" type="number" min="1" max="4094" style={{ ...cellIn, width: 80 }} value={numShown(s.vlanStart)} onChange={e => setSite(i, { vlanStart: intVal(e.target.value) })} /></td>
                      <td><input className="input" type="number" min="1" max="4094" style={{ ...cellIn, width: 80 }} value={numShown(s.vlanEnd)} onChange={e => setSite(i, { vlanEnd: intVal(e.target.value) })} /></td>
                      <td><input className="input" style={{ ...cellIn, width: 130 }} value={s.v4Pool} placeholder="10.0.0.0/22" onChange={e => setSite(i, { v4Pool: e.target.value })} /></td>
                      <td><input className="input" style={{ ...cellIn, width: 170 }} value={s.v6Block} placeholder={t('vlan_planner.v6_optional')} onChange={e => setSite(i, { v6Block: e.target.value })} /></td>
                      <td><button className="btn btn-sm btn-ghost" onClick={() => setSites(prev => prev.filter((_, j) => j !== i))}>{t('vlan_planner.remove')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm btn-ghost" disabled={sites.length >= P.LIMITS.sites} onClick={addSite}>{t('vlan_planner.add_site')}</button>
              <button className="btn btn-sm btn-ghost" onClick={loadExample}>{t('vlan_planner.load_example')}</button>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('vlan_planner.roles_title')}</div>
            <div className="hint" style={{ marginBottom: 10 }}>{t('vlan_planner.roles_hint')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table>
                <thead>
                  <tr>
                    <th>{t('vlan_planner.col_role')}</th><th>{t('vlan_planner.col_prefix')}</th>
                    <th>{t('vlan_planner.col_count')}</th><th>{t('vlan_planner.col_v6')}</th><th />
                  </tr>
                </thead>
                <tbody>
                  {roles.map((r, i) => (
                    <tr key={i}>
                      <td><input className="input" style={{ ...cellIn, width: 110 }} value={r.name} onChange={e => setRole(i, { name: e.target.value })} /></td>
                      <td>
                        <select className="input" style={{ ...cellIn, width: 150 }} value={r.prefix} onChange={e => setRole(i, { prefix: parseInt(e.target.value, 10) })}>
                          {Array.from({ length: 16 }, (_, k) => 16 + k).map(p => (
                            <option key={p} value={p}>{p === 31 ? `/31 ${t('vlan_planner.prefix_p2p_suffix')}` : `/${p}`}</option>
                          ))}
                        </select>
                      </td>
                      <td><input className="input" type="number" min="1" max={P.LIMITS.count} style={{ ...cellIn, width: 70 }} value={numShown(r.count)} onChange={e => setRole(i, { count: intVal(e.target.value) })} /></td>
                      <td><input type="checkbox" checked={r.v6 ?? r.prefix < 31} onChange={e => setRole(i, { v6: e.target.checked })} /></td>
                      <td><button className="btn btn-sm btn-ghost" onClick={() => setRoles(prev => prev.filter((_, j) => j !== i))}>{t('vlan_planner.remove')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="btn-row" style={{ marginTop: 10 }}>
              <button className="btn btn-sm btn-ghost" disabled={roles.length >= P.LIMITS.roles} onClick={addRole}>{t('vlan_planner.add_role')}</button>
            </div>
          </div>

          <VpFindings findings={planFindings} rowLabel={planRowLabel} />

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>{t('vlan_planner.alloc_title')}</div>
              <div className="btn-row">
                <button className="btn btn-sm btn-ghost" disabled={!alloc.entries.length} onClick={() => vpDownload(P.toCSV(alloc.entries), 'vlan-plan.csv')}>{t('vlan_planner.export_csv')}</button>
                {alloc.entries.length > 0 && <CopyBtn text={allocTSV} label="copy_all" id="vlanplanner-alloc-copy-all" />}
              </div>
            </div>
            {alloc.entries.length === 0
              ? <div className="hint">{t('vlan_planner.alloc_empty')}</div>
              : <VpTable cols={allocCols} rows={alloc.entries.slice(0, VP_ROWS_CAP)} />}
            {alloc.entries.length > VP_ROWS_CAP && (
              <div className="hint" style={{ marginTop: 8 }}>{t('vlan_planner.findings_more', { count: alloc.entries.length - VP_ROWS_CAP })}</div>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>{t('vlan_planner.summary_title')}</div>
              <button className="btn btn-sm btn-ghost" onClick={() => copy(summaryText, 'summary')}>
                {copied === 'summary' ? t('common.copied') : t('vlan_planner.copy_summary')}
              </button>
            </div>
            {summaryLines.map((l, i) => <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 12, padding: '2px 0' }}>{l}</div>)}
          </div>

          <div className="card">
            <div className="hint" style={{ marginBottom: 8 }}>{t('vlan_planner.xlink_hint')}</div>
            <div className="btn-row">
              <button className="btn btn-sm btn-ghost" onClick={() => openTool('subnet')}>{t('vlan_planner.xlink_subnet')}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => openTool('pvlan-designer')}>{t('vlan_planner.xlink_pvlan')}</button>
            </div>
          </div>
        </>
      )}

      {tab === 'audit' && (
        <>
          <div className="card">
            <div className="card-title">{t('vlan_planner.audit_title')}</div>
            <div className="hint" style={{ marginBottom: 10 }}>{t('vlan_planner.audit_hint')}</div>
            <textarea
              className="input" rows={10} value={csv} placeholder={t('vlan_planner.audit_placeholder')}
              onChange={e => setCsv(e.target.value.slice(0, 200000))}
              style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
            />
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); readFile(e.dataTransfer.files && e.dataTransfer.files[0]); }}
              style={{ border: '1px dashed var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px', margin: '10px 0', display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', color: 'var(--dim)', fontSize: 12 }}
            >
              <span>{t('vlan_planner.drop_hint')}</span>
              <button className="btn btn-sm btn-ghost" onClick={() => fileRef.current && fileRef.current.click()}>{t('vlan_planner.choose_file')}</button>
              <input ref={fileRef} type="file" accept=".csv,.tsv,.txt" style={{ display: 'none' }} onChange={e => { readFile(e.target.files && e.target.files[0]); e.target.value = ''; }} />
            </div>
            <Err msg={fileErr} />
            <div className="btn-row" style={{ marginBottom: 10 }}>
              <button className="btn btn-sm btn-ghost" onClick={() => { setCsv(P.SAMPLE_CSV); setFileErr(''); }}>{t('vlan_planner.load_sample')}</button>
              <button className="btn btn-sm btn-ghost" onClick={() => { setCsv(''); setFileErr(''); }}>{t('common.clear')}</button>
            </div>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' }}>
              <input type="checkbox" checked={useSiteRules} onChange={e => setUseSiteRules(e.target.checked)} />
              {t('vlan_planner.use_site_rules')}
            </label>
          </div>

          {parsed.entries.length === 0 && auditFindings.length === 0
            ? <div className="card"><div className="hint">{t('vlan_planner.audit_empty')}</div></div>
            : (
              <>
                <VpFindings findings={auditFindings} rowLabel={auditRowLabel} />
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                      <div className="card-title" style={{ marginBottom: 0 }}>{t('vlan_planner.audit_rows_title')}</div>
                      <span className="badge badge-blue">{t('vlan_planner.rows_count', { count: parsed.entries.length })}</span>
                    </div>
                    <div className="btn-row">
                      <button className="btn btn-sm btn-ghost" disabled={!parsed.entries.length} onClick={() => vpDownload(P.toCSV(parsed.entries), 'vlan-audit.csv')}>{t('vlan_planner.export_csv')}</button>
                      {parsed.entries.length > 0 && <CopyBtn text={auditTSV} label="copy_all" id="vlanplanner-audit-copy-all" />}
                    </div>
                  </div>
                  <VpTable cols={auditCols} rows={parsed.entries.slice(0, VP_ROWS_CAP)} />
                  {parsed.entries.length > VP_ROWS_CAP && (
                    <div className="hint" style={{ marginTop: 8 }}>{t('vlan_planner.findings_more', { count: parsed.entries.length - VP_ROWS_CAP })}</div>
                  )}
                </div>
              </>
            )}
        </>
      )}
    </div>
  );
}

window.VlanPlanner = VlanPlanner;
