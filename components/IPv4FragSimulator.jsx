const { useState, useEffect, useMemo } = React;

const FS_SEV_COLOR = { error: 'var(--red)', warn: 'var(--yellow)', info: 'var(--blue)' };
const FS_SEV_BADGE = { error: 'badge-red', warn: 'badge-yellow', info: 'badge-blue' };
const FS_SEV_RANK = { error: 0, warn: 1, info: 2 };
const FS_BARS_CAP = 200; // ponytail: render cap; table + exports still use every fragment.
const FS_TABS = ['pmtud', 'split', 'reassembly'];

const fsNum = (s) => (/^\d+$/.test(String(s).trim()) ? parseInt(String(s).trim(), 10) : NaN);
const fsId = (s) => {
  const v = String(s).trim();
  return /^0x[0-9a-f]+$/i.test(v) ? parseInt(v, 16) : fsNum(v);
};
const fsHex = (id) => '0x' + id.toString(16).padStart(4, '0');
const fsClamp = (v, lo, hi, dflt) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

function fsDownload(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// Worst severity per input row index.
function fsWorstByRow(findings) {
  const m = new Map();
  for (const f of findings) {
    for (const r of f.rows) {
      const cur = m.get(r);
      if (!cur || FS_SEV_RANK[f.sev] < FS_SEV_RANK[cur]) m.set(r, f.sev);
    }
  }
  return m;
}

// Table on desktop, cards on mobile. cols: [{ h, cell(row, i) }]
function FsTable({ cols, rows }) {
  return (
    <>
      <div className="table-wrap hide-mobile">
        <table>
          <thead><tr>{cols.map((c, i) => <th key={i}>{c.h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
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

// Finding / error code → translated text.
function fsText(t, f) {
  const params = { ...f.params };
  if (f.code === 'PARSE_ERROR') params.field = t('ipv4_frag_sim.field_' + params.field);
  return t('ipv4_frag_sim.f_' + f.code.toLowerCase(), params);
}

function FsFindings({ findings, rowLabel }) {
  const { t } = useTranslation();
  const n = { error: 0, warn: 0, info: 0 };
  findings.forEach(f => { n[f.sev]++; });
  return (
    <div className="card">
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: findings.length ? 10 : 0 }}>
        <div className="card-title" style={{ marginBottom: 0 }}>{t('ipv4_frag_sim.findings_title')}</div>
        {findings.length === 0
          ? <span className="badge badge-green">{t('ipv4_frag_sim.no_findings')}</span>
          : <span className={`badge ${n.error ? 'badge-red' : n.warn ? 'badge-yellow' : 'badge-blue'}`}>
              {t('ipv4_frag_sim.findings_count', { errors: n.error, warns: n.warn, infos: n.info })}
            </span>}
      </div>
      {findings.map((f, i) => {
        const ref = rowLabel ? rowLabel(f.rows) : '';
        return (
          <div key={i} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '7px 0', borderTop: '1px solid var(--border)', fontSize: 13 }}>
            <span className={`badge ${FS_SEV_BADGE[f.sev]}`} style={{ flexShrink: 0 }}>{t('ipv4_frag_sim.sev_' + f.sev)}</span>
            <div style={{ minWidth: 0 }}>
              <div>{fsText(t, f)}</div>
              {ref ? <div style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--mono)', marginTop: 2 }}>{ref}</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Proportional bar. segs: [{ start, end (inclusive), color, opacity, title, top }]; widths are % of `total` bytes.
function FsBar({ total, segs, height = 22 }) {
  return (
    <div style={{ position: 'relative', height, background: 'var(--border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
      {segs.map((s, i) => (
        <div
          key={i} title={s.title}
          style={{
            position: 'absolute', top: 0, bottom: 0,
            left: `${(s.start / total) * 100}%`,
            width: `${((s.end - s.start + 1) / total) * 100}%`,
            background: s.color, opacity: s.opacity == null ? 1 : s.opacity,
            backgroundImage: s.hatch ? 'repeating-linear-gradient(45deg, rgba(0,0,0,.35) 0 2px, transparent 2px 5px)' : undefined,
          }}
        />
      ))}
    </div>
  );
}

function FsLegend({ items }) {
  return (
    <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
      {items.map(([color, label, hatch], i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
          <span style={{
            width: 10, height: 10, borderRadius: 2, background: color,
            backgroundImage: hatch ? 'repeating-linear-gradient(45deg, rgba(0,0,0,.35) 0 2px, transparent 2px 5px)' : undefined,
          }} />
          {label}
        </span>
      ))}
    </div>
  );
}

// ICMP type 3 / code 4 as the RFC 792 / 1191 word layout.
function FsIcmpCard({ icmp, label }) {
  const { t } = useTranslation();
  const cell = (span, name, bits, value, color) => (
    <div style={{ gridColumn: `span ${span}`, border: '1px solid var(--border)', padding: '6px 10px', minWidth: 0 }}>
      <div style={{ fontSize: 10, color: 'var(--dim)' }}>{name} ({bits})</div>
      <div style={{ fontFamily: 'var(--mono)', fontSize: 13, color: color || 'var(--text)' }}>{value}</div>
    </div>
  );
  const q = icmp.quoted;
  return (
    <div className="card">
      <div className="card-title">{t('ipv4_frag_sim.icmp_title')}{label ? <span style={{ color: 'var(--dim)', fontWeight: 400 }}>{` · ${label}`}</span> : null}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', maxWidth: 560 }}>
        {cell(1, t('ipv4_frag_sim.icmp_type'), '8 bit', icmp.type, 'var(--red)')}
        {cell(1, t('ipv4_frag_sim.icmp_code'), '8 bit', icmp.code, 'var(--red)')}
        {cell(2, t('ipv4_frag_sim.icmp_checksum'), '16 bit', t('ipv4_frag_sim.icmp_checksum_value'), 'var(--dim)')}
        {cell(2, t('ipv4_frag_sim.icmp_unused'), '16 bit', 0, 'var(--dim)')}
        {cell(2, t('ipv4_frag_sim.icmp_next_hop'), '16 bit', icmp.nextHopMtu, icmp.nextHopMtu ? 'var(--cyan)' : 'var(--yellow)')}
        <div style={{ gridColumn: 'span 4', border: '1px solid var(--border)', padding: '6px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>
          {t('ipv4_frag_sim.icmp_quoted', { total: q.totalLength, id: fsHex(q.id), df: q.df, mf: q.mf, offset: q.offset8 })}
          <div style={{ color: 'var(--dim)', marginTop: 2 }}>{t('ipv4_frag_sim.icmp_quoted_data')}</div>
        </div>
      </div>
      {icmp.nextHopMtu === 0 && <div className="hint" style={{ marginTop: 8 }}>{t('ipv4_frag_sim.icmp_legacy_note')}</div>}
    </div>
  );
}

function IPv4FragSimulator({ initialData, onShare }) {
  const { t } = useTranslation();
  const F = window.FragSim;
  const D = F.DEFAULTS;
  const tt = (k, p) => t('ipv4_frag_sim.' + k, p);

  const [tab, setTab] = usePersistentState('fragsim:tab', 'pmtud');
  const [sizeMode, setSizeMode] = usePersistentState('fragsim:sizeMode', D.sizeMode);
  const [size, setSize] = usePersistentState('fragsim:size', String(D.size));
  const [hdrLen, setHdrLen] = usePersistentState('fragsim:hdrLen', D.hdrLen);
  const [optionsCopied, setOptionsCopied] = usePersistentState('fragsim:optionsCopied', D.optionsCopied);
  const [idText, setIdText] = usePersistentState('fragsim:id', fsHex(D.id));
  const [df, setDf] = usePersistentState('fragsim:df', false);
  const [hops, setHops] = usePersistentState('fragsim:hops', D.hops);
  const [pmtudHops, setPmtudHops] = usePersistentState('fragsim:pmtudHops', D.pmtudHops);
  const [legacy, setLegacy] = usePersistentState('fragsim:legacy', D.legacy);
  const [icmpBlocked, setIcmpBlocked] = usePersistentState('fragsim:icmpBlocked', D.icmpBlocked);
  const [offsetUnit, setOffsetUnit] = usePersistentState('fragsim:offsetUnit', 'bytes');
  const [rows, setRows] = usePersistentState('fragsim:rows', '');

  // Restore from share URL / cross-tool navigation (untrusted: sanitised).
  useEffect(() => {
    if (!initialData) return;
    const i = initialData;
    if (FS_TABS.includes(i.tab)) setTab(i.tab);
    if (i.sizeMode === 'total' || i.sizeMode === 'payload') setSizeMode(i.sizeMode);
    if (i.size != null) setSize(String(i.size).slice(0, 6));
    if (i.hdrLen != null) setHdrLen(fsClamp(i.hdrLen, 20, 60, 20) - (fsClamp(i.hdrLen, 20, 60, 20) % 4));
    if (i.optionsCopied != null) setOptionsCopied(!!i.optionsCopied);
    if (i.id != null) setIdText(String(i.id).slice(0, 8));
    if (i.df != null) setDf(!!i.df);
    if (i.hops != null) setHops(String(i.hops).slice(0, 200));
    if (i.pmtudHops != null) setPmtudHops(String(i.pmtudHops).slice(0, 200));
    if (i.legacy != null) setLegacy(!!i.legacy);
    if (i.icmpBlocked != null) setIcmpBlocked(!!i.icmpBlocked);
    if (i.offsetUnit === 'bytes' || i.offsetUnit === 'units') setOffsetUnit(i.offsetUnit);
    if (i.rows != null) setRows(String(i.rows).slice(0, 20000));
  }, [initialData]);

  useEffect(() => {
    const handle = (e) =>
      (e.detail && e.detail.respond ? e.detail.respond : onShare)({
        tool: 'ipv4-frag-sim', tab, sizeMode, size, hdrLen, optionsCopied, id: idText, df,
        hops, pmtudHops, legacy, icmpBlocked, offsetUnit, rows,
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, sizeMode, size, hdrLen, optionsCopied, idText, df, hops, pmtudHops, legacy, icmpBlocked, offsetUnit, rows, onShare]);
  // ponytail: large pasted fragment lists make long share URLs; same trade-off as vlan-planner.

  // 300 ms debounce on free-text inputs.
  const live = JSON.stringify([size, idText, hops, pmtudHops, rows]);
  const [liveD, setLiveD] = useState(live);
  useEffect(() => {
    const h = setTimeout(() => setLiveD(live), 300);
    return () => clearTimeout(h);
  }, [live]);
  const [sizeD, idD, hopsD, pmtudHopsD, rowsD] = useMemo(() => JSON.parse(liveD), [liveD]);

  // ── Derivations ─────────────────────────────────────────────────────
  const dgRes = useMemo(() => {
    const n = fsNum(sizeD);
    const r = F.fragDatagram({
      [sizeMode === 'total' ? 'totalLength' : 'payload']: n,
      hdrLen, optionsCopied, id: fsId(idD), df,
    });
    r.errors.forEach(e => {
      if (e.code === 'BAD_ID') e.params.id = idD;
      if (e.code === 'BAD_SIZE' && Number.isNaN(n)) e.params.size = sizeD;
    });
    return r;
  }, [F, sizeD, sizeMode, hdrLen, optionsCopied, idD, df]);
  const dg = dgRes.datagram;

  const hopsS = useMemo(() => F.fragParseHops(hopsD), [F, hopsD]);
  const hopsP = useMemo(() => F.fragParseHops(pmtudHopsD), [F, pmtudHopsD]);
  const path = useMemo(() => (dg ? F.fragPath(dg, hopsS) : null), [F, dg, hopsS]);
  const pmtud = useMemo(() => (dg ? F.fragPmtud(dg, hopsP, { legacy, icmpBlocked }) : null), [F, dg, hopsP, legacy, icmpBlocked]);
  const parsed = useMemo(() => F.fragParse(rowsD, { offsetUnit }), [F, rowsD, offsetUnit]);
  const rr = useMemo(() => F.fragReassemble(parsed.frags, { hdrLen: parsed.hdrLen }), [F, parsed]);
  const reasmFindings = useMemo(() => parsed.findings.concat(rr.findings)
    .sort((a, b) => FS_SEV_RANK[a.sev] - FS_SEV_RANK[b.sev]), [parsed, rr]);
  const reasmWorst = useMemo(() => fsWorstByRow(reasmFindings), [reasmFindings]);

  const openTool = (detail) => window.dispatchEvent(new CustomEvent('app:navigate', { detail }));

  const tabBtnStyle = (active) => ({
    background: active ? 'var(--card)' : 'transparent',
    border: '1px solid var(--border)',
    borderBottom: active ? '1px solid var(--card)' : '1px solid var(--border)',
    borderRadius: 'var(--radius) var(--radius) 0 0',
    color: active ? 'var(--fg)' : 'var(--dim)',
    padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    marginBottom: -1, position: 'relative',
  });
  const sevDot = (sev) => (sev
    ? <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: FS_SEV_COLOR[sev], marginRight: 6 }} />
    : null);
  const hopTxt = (i) => (i === 0 ? `${i + 1} (${tt('sender_egress')})` : String(i + 1));
  const checkStyle = { display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--muted)', cursor: 'pointer' };

  // ── Fragment table (shared by hop sections and the final result) ────
  const fragCols = [
    { h: tt('col_frag'), cell: f => f.origin },
    { h: tt('col_id'), cell: f => fsHex(f.id) },
    { h: tt('col_total'), cell: f => f.totalLength },
    { h: tt('col_hdr'), cell: f => f.hdrLen },
    { h: tt('col_payload'), cell: f => f.payload },
    { h: tt('col_offset8'), cell: f => f.offset8 },
    { h: tt('col_offset_bytes'), cell: f => f.offsetBytes },
    { h: tt('col_mf'), cell: f => <span className={`badge ${f.mf ? 'badge-yellow' : 'badge-green'}`}>{f.mf}</span> },
    { h: tt('col_slack'), cell: f => f.slack },
  ];
  const fragHeaders = fragCols.map(c => c.h);

  // ── Shared input card ───────────────────────────────────────────────
  const hopsValue = tab === 'pmtud' ? pmtudHops : hops;
  const setHopsValue = tab === 'pmtud' ? setPmtudHops : setHops;
  const inputErrors = [
    ...dgRes.errors,
    ...(tab === 'pmtud' ? (pmtud ? pmtud.errors : []) : (path ? path.errors : [])),
  ];

  const inputCard = (
    <div className="card">
      <div className="card-title">{tt('inputs_title')}</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
        <div className="field">
          <label className="label">{tt('size_mode')}</label>
          <select className="input" value={sizeMode} onChange={e => setSizeMode(e.target.value)}>
            <option value="total">{tt('size_mode_total')}</option>
            <option value="payload">{tt('size_mode_payload')}</option>
          </select>
        </div>
        <div className="field">
          <label className="label">{tt('size')}</label>
          <input className="input" style={{ fontFamily: 'var(--mono)' }} value={size} onChange={e => setSize(e.target.value.slice(0, 6))} />
        </div>
        <div className="field">
          <label className="label">{tt('hdr_len')}</label>
          <select className="input" value={hdrLen} onChange={e => setHdrLen(parseInt(e.target.value, 10))}>
            {Array.from({ length: 11 }, (_, k) => 20 + k * 4).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
          <div className="hint" style={{ marginTop: 4 }}>{tt('hdr_len_hint')}</div>
        </div>
        <div className="field">
          <label className="label">{tt('ident')}</label>
          <input className="input" style={{ fontFamily: 'var(--mono)' }} value={idText} onChange={e => setIdText(e.target.value.slice(0, 8))} />
          {Number.isFinite(fsId(idText)) && <div className="hint" style={{ marginTop: 4, fontFamily: 'var(--mono)' }}>{fsHex(fsId(idText))} = {fsId(idText)}</div>}
        </div>
      </div>
      {hdrLen > 20 && (
        <label style={{ ...checkStyle, marginTop: 10 }}>
          <input type="checkbox" checked={optionsCopied} onChange={e => setOptionsCopied(e.target.checked)} />
          {tt('options_copied')}
        </label>
      )}
      {hdrLen > 20 && <div className="hint" style={{ marginLeft: 24 }}>{tt('options_copied_hint')}</div>}
      <div className="field" style={{ marginTop: 12 }}>
        <label className="label">{tt('hops')}</label>
        <input className="input" style={{ fontFamily: 'var(--mono)' }} value={hopsValue} onChange={e => setHopsValue(e.target.value.slice(0, 200))} placeholder="9000, 1500, 1400" />
        <div className="hint" style={{ marginTop: 4 }}>{tt('hops_hint')}</div>
      </div>
      <div className="btn-row" style={{ marginBottom: 10 }}>
        <button className="btn btn-sm btn-ghost" onClick={() => setHopsValue('9000, 1500')}>{tt('preset_jumbo')}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setHopsValue('1500, 1400')}>{tt('preset_overlay')}</button>
        <button className="btn btn-sm btn-ghost" onClick={() => setHopsValue('1500, 1400, 576')}>{tt('preset_shrinking')}</button>
      </div>
      {dg && (
        <div className="hint" style={{ fontFamily: 'var(--mono)' }}>
          {tt('derived_sizes', { total: dg.totalLength, hdr: dg.hdrLen, payload: dg.payload })}
        </div>
      )}
      {inputErrors.map((e, i) => <Err key={i} msg={fsText(t, e)} />)}
    </div>
  );

  // ── Tab 1: Path MTU / DF ────────────────────────────────────────────
  const pmtudTab = () => {
    if (!dg || !pmtud || pmtud.status === 'invalid') return null;
    const at = pmtud.attempts;
    const resultCell = (a) => {
      if (a.droppedAtHop === null) return <span className="badge badge-green">{tt('res_delivered')}</span>;
      const p = { hop: hopTxt(a.droppedAtHop), mtu: a.hopMtu };
      return <span className="badge badge-red">{tt(a.icmp ? 'res_dropped_hop' : 'res_dropped_silent', p)}</span>;
    };
    const actionText = (a) => {
      if (a.droppedAtHop === null) return '—';
      if (!a.icmp) return tt('act_retransmit');
      return legacy ? tt('act_plateau', { size: a.nextSize }) : tt('act_pmtu', { size: a.nextSize });
    };
    const plain = (a) => {
      if (a.droppedAtHop === null) return tt('res_delivered');
      return tt(a.icmp ? 'res_dropped_hop' : 'res_dropped_silent', { hop: hopTxt(a.droppedAtHop), mtu: a.hopMtu });
    };
    const cols = [
      { h: tt('col_attempt'), cell: (a, i) => i + 1 },
      { h: tt('col_size'), cell: a => a.size },
      { h: tt('col_result'), cell: resultCell },
      { h: tt('col_action'), cell: actionText },
    ];
    const tsv = [cols.map(c => c.h).join('\t')]
      .concat(at.map((a, i) => [i + 1, a.size, plain(a), actionText(a)].join('\t'))).join('\n');
    const withIcmp = at.filter(a => a.icmp);
    const lastNext = withIcmp.length ? withIcmp[withIcmp.length - 1].nextSize : null;
    const pingPayload = at[0].size - 28;

    return (
      <>
        <div className="card">
          <div className="card-title">{tt('pmtud_title')}</div>
          <div className="hint" style={{ marginBottom: 12 }}>{tt('pmtud_intro')}</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            <select className="input" style={{ width: 'auto' }} value={legacy ? 'legacy' : 'rfc1191'} onChange={e => setLegacy(e.target.value === 'legacy')}>
              <option value="rfc1191">{tt('router_rfc1191')}</option>
              <option value="legacy">{tt('router_legacy')}</option>
            </select>
            <label style={checkStyle}>
              <input type="checkbox" checked={icmpBlocked} onChange={e => setIcmpBlocked(e.target.checked)} />
              {tt('icmp_filtered')}
            </label>
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>{tt('timeline_title')}</div>
            <CopyBtn text={tsv} label="copy_all" id="fragsim-timeline-copy-all" />
          </div>
          <FsTable cols={cols} rows={at} />
        </div>

        {withIcmp.map((a, i) => <FsIcmpCard key={i} icmp={a.icmp} label={`${tt('col_attempt')} ${at.indexOf(a) + 1}`} />)}

        {legacy && withIcmp.length > 0 && (
          <div className="card">
            <div className="card-title">{tt('plateau_title')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {F.PLATEAUS.map(p => {
                const used = at.some(a => a.nextSize === p);
                return <span key={p} className={`badge ${p === lastNext ? 'badge-cyan' : used ? 'badge-blue' : 'badge-gray'}`} style={{ fontFamily: 'var(--mono)' }}>{p}</span>;
              })}
            </div>
            <div className="hint">{tt('plateau_note')}</div>
          </div>
        )}

        <div className="card" style={{ borderColor: pmtud.status === 'blackhole' ? 'var(--red)' : 'var(--green)' }}>
          <div className="card-title" style={{ color: pmtud.status === 'blackhole' ? 'var(--red)' : 'var(--green)' }}>
            {pmtud.status === 'blackhole' ? tt('blackhole_title') : tt('result_title')}
          </div>
          {pmtud.status === 'delivered' ? (
            <>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 15, color: 'var(--green)', marginBottom: 6 }}>
                {tt('pmtu_result', { pmtu: pmtud.pmtu, mss: pmtud.mss })}
              </div>
              <div className="hint">{tt('mss_hint')}</div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 13, marginBottom: 10 }}>{tt('blackhole_body')}</div>
              <div className="hint" style={{ marginBottom: 6 }}>{tt('ping_hint')}</div>
              <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cyan)' }}>
                <div>{tt('ping_linux')}: ping -M do -s {pingPayload} &lt;host&gt;</div>
                <div>{tt('ping_windows')}: ping -f -l {pingPayload} &lt;host&gt;</div>
              </div>
            </>
          )}
        </div>

        <div className="card">
          <div className="hint" style={{ marginBottom: 8 }}>{tt('xlink_hint')}</div>
          <div className="btn-row">
            <button className="btn btn-sm btn-ghost" onClick={() => openTool({ tool: 'mtu' })}>{tt('xlink_mtu')}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => openTool({ tool: 'packet-headers', activeHeader: 'ipv4' })}>{tt('xlink_headers')}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => openTool({ tool: 'icmp-ref' })}>{tt('xlink_icmp')}</button>
          </div>
        </div>
      </>
    );
  };

  // ── Tab 2: Fragmentation ────────────────────────────────────────────
  const splitTab = () => {
    if (!dg || !path || path.errors.length) return null;
    const finalFrags = path.fragments;
    const lastHop = path.hops.length ? path.hops[path.hops.length - 1] : null;
    const P = dg.payload;
    const scale = Math.max(1, ...path.hops.map(h => h.mtu), path.hops.length ? 0 : dg.totalLength);
    const lastFrag = finalFrags[finalFrags.length - 1];
    const split = finalFrags.length > 1;

    const rulerSegs = [];
    finalFrags.forEach((f, i) => {
      rulerSegs.push({
        start: f.offsetBytes, end: f.offsetBytes + f.payload - 1, color: 'var(--cyan)', opacity: i % 2 ? 0.5 : 0.85,
        title: `#${f.origin}: ${f.offsetBytes}-${f.offsetBytes + f.payload - 1} (${f.payload} B)`,
      });
    });
    if (lastFrag && lastFrag.tail > 0) {
      const e = lastFrag.offsetBytes + lastFrag.payload - 1;
      rulerSegs.push({ start: e - lastFrag.tail + 1, end: e, color: 'var(--yellow)', title: `${lastFrag.tail} B` });
    }

    // Tail / slack explanation, computed for the bottleneck link that splits the packet.
    let explain = null;
    if (split && path.hops.length) {
      const bottleneckMtu = Math.min(...path.hops.map(h => h.mtu));
      const chunk = F.fragMaxChunk(bottleneckMtu, dg.tailHdrLen);
      const avail = bottleneckMtu - dg.tailHdrLen;
      explain = (
        <div className="card">
          {lastFrag.tail > 0 && (
            <div style={{ fontSize: 13, marginBottom: 8 }}>
              {tt('tail_explain', { chunk, mtu: bottleneckMtu, hdr: dg.tailHdrLen, rest: lastFrag.payload, tail: lastFrag.tail })}
            </div>
          )}
          <div className="hint">
            {avail === chunk
              ? tt('slack_none', { mtu: bottleneckMtu, hdr: dg.tailHdrLen, avail })
              : tt('slack_some', { mtu: bottleneckMtu, hdr: dg.tailHdrLen, avail, chunk, slack: avail - chunk })}
          </div>
        </div>
      );
    }

    const exportText = F.fragExport(finalFrags, { totalLength: dg.totalLength, hdrLen: dg.hdrLen, id: dg.id, hops: hopsS });
    const finalTSV = F.fragToTSV(finalFrags, fragHeaders);
    const bars = finalFrags.slice(0, FS_BARS_CAP);

    return (
      <>
        <div className="card">
          <label style={checkStyle}>
            <input type="checkbox" checked={df} onChange={e => setDf(e.target.checked)} />
            {tt('df_bit')}
          </label>
        </div>

        {path.icmp && <FsIcmpCard icmp={path.icmp} label={`${tt('col_hop')} ${hopTxt(path.droppedAtHop)} · ${tt('col_mtu')} ${lastHop.mtu}`} />}

        {path.icmp ? (
          <div className="card"><div className="hint">{tt('zero_frags')}</div></div>
        ) : (
          <>
            {path.hops.slice(0, -1).map((h, i) => (
              <div key={i} className="card">
                <details>
                  <summary style={{ cursor: 'pointer', fontSize: 13, fontFamily: 'var(--mono)' }}>
                    {tt('hop_summary', { hop: hopTxt(i), mtu: h.mtu, in: h.inCount, out: h.fragments.length })}
                  </summary>
                  <div style={{ marginTop: 10 }}><FsTable cols={fragCols} rows={h.fragments} /></div>
                </details>
              </div>
            ))}

            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
                <div>
                  <div className="card-title" style={{ marginBottom: 2 }}>{tt('split_title')}</div>
                  {lastHop && <div className="hint" style={{ fontFamily: 'var(--mono)' }}>{tt('hop_summary', { hop: hopTxt(path.hops.length - 1), mtu: lastHop.mtu, in: lastHop.inCount, out: finalFrags.length })}</div>}
                </div>
                <div className="btn-row">
                  <button className="btn btn-sm btn-ghost" onClick={() => fsDownload(exportText, 'ipv4-fragments.json')}>{tt('export_json')}</button>
                  <button className="btn btn-sm btn-ghost" onClick={() => { setRows(exportText); setTab('reassembly'); }}>{tt('send_to_reasm')}</button>
                  <CopyBtn text={finalTSV} label="copy_all" id="fragsim-frags-copy-all" />
                </div>
              </div>
              {!split && <div className="hint" style={{ marginBottom: 8 }}>{tt('no_split')}</div>}
              <FsTable cols={fragCols} rows={finalFrags.slice(0, 1000)} />
            </div>

            {explain}

            <div className="card">
              <div className="card-title">{tt('map_title')}</div>
              <div className="hint" style={{ fontFamily: 'var(--mono)', marginBottom: 6 }}>{tt('ruler_label', { last: P - 1 })}</div>
              <FsBar total={P} segs={rulerSegs} />
              {finalFrags.length <= 12 && (
                <div style={{ position: 'relative', height: 16, marginTop: 4 }}>
                  {finalFrags.map((f, i) => (
                    <span key={i} style={{ position: 'absolute', left: `${(f.offsetBytes / P) * 100}%`, fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--dim)' }}>{f.offsetBytes}</span>
                  ))}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 14 }}>
                {bars.map((f, i) => (
                  <FsBar
                    key={i} total={scale} height={14}
                    segs={[
                      { start: 0, end: f.hdrLen - 1, color: 'var(--blue)', title: `${tt('legend_header')} ${f.hdrLen} B` },
                      { start: f.hdrLen, end: f.hdrLen + f.payload - 1, color: 'var(--cyan)', title: `#${f.origin} ${tt('legend_payload')} ${f.payload} B` },
                      ...(f.slack > 0 ? [{ start: f.totalLength, end: f.totalLength + f.slack - 1, color: 'var(--yellow)', hatch: true, title: `${tt('legend_slack')} ${f.slack} B` }] : []),
                    ]}
                  />
                ))}
              </div>
              {finalFrags.length > FS_BARS_CAP && <div className="hint" style={{ marginTop: 6 }}>{tt('more_rows', { count: finalFrags.length - FS_BARS_CAP })}</div>}
              <FsLegend items={[['var(--blue)', tt('legend_header')], ['var(--cyan)', tt('legend_payload')], ['var(--yellow)', tt('legend_slack'), true]]} />
            </div>
          </>
        )}
      </>
    );
  };

  // ── Tab 3: Reassembly ───────────────────────────────────────────────
  const reasmTab = () => {
    const L = rr.payloadLength != null ? rr.payloadLength : Math.max(1, ...parsed.frags.map(f => f.offsetBytes + f.payload));
    const segs = [];
    rr.coverage.forEach(c => segs.push({ start: c.start, end: Math.min(c.end, L - 1), color: 'var(--cyan)', title: `${c.start}-${c.end}` }));
    rr.gaps.forEach(g => segs.push({ start: g.start, end: g.end, color: 'var(--red)', title: `${g.start}-${g.end}` }));
    rr.findings.filter(f => f.code === 'OVERLAP').forEach(f => {
      const s = Math.max(f.params.aStart, f.params.bStart), e = Math.min(f.params.aEnd, f.params.bEnd);
      if (e >= s && s < L) segs.push({ start: s, end: Math.min(e, L - 1), color: 'var(--magenta)', title: `${s}-${e}` });
    });
    const stateBadge = { complete: 'badge-green', incomplete: 'badge-yellow', invalid: 'badge-red' }[rr.state];
    const cols = [
      { h: tt('col_line'), cell: (f, i) => <>{sevDot(reasmWorst.get(i))}{f.origin}</> },
      { h: tt('col_id'), cell: f => fsHex(f.id) },
      { h: tt('col_payload'), cell: f => f.payload },
      { h: tt('col_offset8'), cell: f => f.offset8 },
      { h: tt('col_offset_bytes'), cell: f => f.offsetBytes },
      { h: tt('col_mf'), cell: f => <span className={`badge ${f.mf ? 'badge-yellow' : 'badge-green'}`}>{f.mf}</span> },
    ];
    const rowLabel = (r) => r.slice(0, 4).map(i => (parsed.frags[i] ? `${tt('col_line')} ${parsed.frags[i].origin}` : '')).filter(Boolean).join(', ');
    const reasmTSV = [cols.map(c => c.h).join('\t')]
      .concat(parsed.frags.slice(0, 1000).map(f => [f.origin, fsHex(f.id), f.payload, f.offset8, f.offsetBytes, f.mf].join('\t')))
      .join('\n');

    return (
      <>
        <div className="card">
          <div className="card-title">{tt('reasm_title')}</div>
          <div className="hint" style={{ marginBottom: 10 }}>{tt('rows_hint')}</div>
          <textarea
            className="input" rows={8} value={rows} placeholder={tt('rows_placeholder')}
            onChange={e => setRows(e.target.value.slice(0, 20000))}
            style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
          />
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 10 }}>
            <label className="label" style={{ margin: 0 }}>{tt('offset_unit')}</label>
            <select className="input" style={{ width: 'auto' }} value={offsetUnit} onChange={e => setOffsetUnit(e.target.value)}>
              <option value="bytes">{tt('offset_unit_bytes')}</option>
              <option value="units">{tt('offset_unit_units')}</option>
            </select>
            <button className="btn btn-sm btn-ghost" onClick={() => setRows(F.SAMPLE_ROWS)}>{tt('load_sample')}</button>
            <button className="btn btn-sm btn-ghost" onClick={() => setRows('')}>{tt('clear')}</button>
          </div>
        </div>

        {parsed.frags.length === 0 && reasmFindings.length === 0
          ? <div className="card"><div className="hint">{tt('rows_empty')}</div></div>
          : (
            <>
              <div className="card">
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  <span className={`badge ${stateBadge}`}>{tt('state_' + rr.state)}</span>
                  <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>
                    {rr.payloadLength != null
                      ? tt('reasm_summary', { payload: rr.payloadLength, total: rr.totalLength, count: parsed.frags.length })
                      : tt('reasm_unknown', { count: parsed.frags.length })}
                  </span>
                </div>
                {parsed.frags.length > 0 && (
                  <>
                    <div className="hint" style={{ fontFamily: 'var(--mono)', marginBottom: 6 }}>{tt('ruler_label', { last: L - 1 })}</div>
                    <FsBar total={L} segs={segs} />
                    <FsLegend items={[['var(--cyan)', tt('legend_covered')], ['var(--red)', tt('legend_gap')], ['var(--magenta)', tt('legend_overlap')]]} />
                  </>
                )}
                {rr.state === 'incomplete' && (
                  <div className="hint" style={{ marginTop: 10 }}>
                    <div>{tt('timeout_note')}</div>
                    <div>{rr.timeExceededSent ? tt('time_exceeded_yes') : tt('time_exceeded_no')}</div>
                  </div>
                )}
              </div>

              <FsFindings findings={reasmFindings} rowLabel={rowLabel} />

              {parsed.frags.length > 0 && (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                    <div className="card-title" style={{ marginBottom: 0 }}>{tt('rows_label')}</div>
                    <CopyBtn text={reasmTSV} label="copy_all" id="fragsim-rows-copy-all" />
                  </div>
                  <FsTable cols={cols} rows={parsed.frags.slice(0, 1000)} />
                </div>
              )}
            </>
          )}
      </>
    );
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{tt('title')}</div>
        <div className="hint" style={{ marginBottom: 12 }}>{tt('intro')}</div>
        <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--border)' }}>
          {FS_TABS.map(k => (
            <button key={k} style={tabBtnStyle(tab === k)} onClick={() => setTab(k)}>{tt('tab_' + k)}</button>
          ))}
        </div>
      </div>

      {tab !== 'reassembly' && inputCard}
      {tab === 'pmtud' && pmtudTab()}
      {tab === 'split' && splitTab()}
      {tab === 'reassembly' && reasmTab()}
    </div>
  );
}

window.IPv4FragSimulator = IPv4FragSimulator;
