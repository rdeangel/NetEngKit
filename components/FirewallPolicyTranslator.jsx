const { useState, useEffect, useMemo } = React;

const FWPT_SOURCES = ['auto', 'fortios', 'panos', 'junos', 'asa', 'ftd'];
const FWPT_MAX = 3000000;

// ponytail: debounce + useMemo is enough for typical pastes.
// A Web Worker is the upgrade path for 20k-line configs.

function fwptHydrateSource(v) {
  return FWPT_SOURCES.includes(v) ? v : 'auto';
}
function fwptHydrateTarget(v, source) {
  const T = window.FwTranslate;
  const list = T ? T.targetsFor(source === 'auto' ? 'ftd' : source) : ['fortios', 'panos', 'junos', 'asa'];
  return list.includes(v) ? v : list[0];
}
function fwptStr(v, d, n) {
  return String(v != null ? v : d).slice(0, n);
}
function fwptZoneMap(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const keys = Object.keys(raw).slice(0, 256);
  keys.forEach(k => {
    const row = raw[k];
    if (!row || typeof row !== 'object') return;
    out[String(k).slice(0, 63)] = {
      target: fwptStr(row.target, '', 63),
      ifaces: fwptStr(row.ifaces, '', 256)
    };
  });
  return out;
}

function fwptParsers() {
  const P = (typeof window !== 'undefined' && window.FwParsers) || {};
  return { fortios: P.fortios, panos: P.panos, junos: P.junos, asa: P.asa, ftd: P.ftd };
}

function fwptPick(vendor, text) {
  const P = fwptParsers();
  if (vendor !== 'auto') return P[vendor] || null;
  let best = null, score = -1;
  ['fortios', 'panos', 'junos', 'asa', 'ftd'].forEach(id => {
    const p = P[id];
    if (!p || !p.detect) return;
    const s = p.detect(text);
    if (s > score) { score = s; best = p; }
  });
  if (score < 20) return { err: 'detect', score };
  return best;
}

function FirewallPolicyTranslator({ initialData, onShare }) {
  const { t } = useTranslation();
  const [fwSource, setFwSource] = usePersistentState('device_converter:fw_source', fwptHydrateSource(initialData?.fwSource));
  const [fwTarget, setFwTarget] = usePersistentState('device_converter:fw_target', initialData?.fwTarget ?? 'panos');
  const [fwText, setFwText] = usePersistentState('device_converter:fw_text', fwptStr(initialData?.fwText, '', FWPT_MAX));
  const [fwZmap, setFwZmap] = usePersistentState('device_converter:fw_zmap', fwptZoneMap(initialData?.fwZoneMap || initialData?.fwZmap));
  const [outTab, setOutTab] = useState('draft');
  const [debounced, setDebounced] = useState({ fwSource, fwText });
  const [copied, copy] = useCopy();
  const [copiedReport, copyReport] = useCopy();
  const [fwOver, setFwOver] = useState(0);

  useEffect(() => {
    const h = setTimeout(() => setDebounced({ fwSource, fwText }), 300);
    return () => clearTimeout(h);
  }, [fwSource, fwText]);

  useEffect(() => {
    const h = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'device-converter',
        activeTab: 'firewall',
        fwSource, fwTarget, fwText, fwZoneMap: fwZmap
      });
    };
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [onShare, fwSource, fwTarget, fwText, fwZmap]);

  const parsed = useMemo(() => {
    const src = debounced.fwText || '';
    const vend = debounced.fwSource;
    if (!String(src).trim()) return { empty: true };
    try {
      const parser = fwptPick(vend, src);
      if (!parser) return { error: 'fw_err_detect' };
      if (parser.err === 'detect') return { error: 'fw_err_detect' };
      const policy = parser.parse(src.slice(0, FWPT_MAX));
      window.FwIR.finalize(policy);
      return { policy, parser, detected: parser.vendor };
    } catch (e) {
      console.error('FirewallPolicyTranslator parse', e);
      return { error: 'fw_err_translate', exception: e };
    }
  }, [debounced]);

  const sourceVendor = parsed.detected || (fwSource === 'auto' ? '' : fwSource);
  const targetList = useMemo(() => {
    const T = window.FwTranslate;
    const E = window.FwEmitters || {};
    const raw = (T && sourceVendor)
      ? T.targetsFor(sourceVendor)
      : ['fortios', 'panos', 'junos', 'asa'];
    return raw.filter(id => id !== 'ftd' && (!Object.keys(E).length || !!E[id]));
  }, [sourceVendor]);

  useEffect(() => {
    if (targetList.length && targetList.indexOf(fwTarget) < 0) setFwTarget(targetList[0]);
  }, [sourceVendor, fwTarget, targetList, setFwTarget]);

  useEffect(() => {
    if (!parsed.policy || !window.FwTranslate) return;
    const seed = window.FwTranslate.seedZones(parsed.policy);
    setFwZmap(prev => {
      const next = {};
      let changed = false;
      const prevObj = prev || {};
      seed.forEach(s => {
        const old = prevObj[s.src];
        if (!old) {
          next[s.src] = {
            target: s.target || s.src,
            ifaces: (s.srcIfaces || []).join(' ')
          };
          changed = true;
        } else {
          let row = old;
          if (!old.ifaces && s.srcIfaces && s.srcIfaces.length) {
            row = Object.assign({}, old, { ifaces: s.srcIfaces.join(' ') });
            changed = true;
          }
          next[s.src] = row;
        }
      });
      const prevKeys = Object.keys(prevObj);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) changed = true;
      else {
        for (let i = 0; i < prevKeys.length; i++) {
          if (!Object.prototype.hasOwnProperty.call(next, prevKeys[i])) { changed = true; break; }
        }
      }
      return changed ? next : prev;
    });
  }, [parsed.policy, setFwZmap]);

  const translated = useMemo(() => {
    if (parsed.empty) return { empty: true };
    if (parsed.error) return parsed;
    if (!parsed.policy || !window.FwTranslate) return { empty: true };
    const tgt = targetList.indexOf(fwTarget) >= 0 ? fwTarget : targetList[0];
    try {
      return window.FwTranslate.translate(parsed.policy, tgt, fwZmap);
    } catch (e) {
      console.error('FirewallPolicyTranslator translate', e);
      return { error: 'fw_err_translate', exception: e };
    }
  }, [parsed, fwTarget, fwZmap, targetList]);

  const loadSample = () => {
    const P = fwptParsers();
    const v = fwSource === 'auto' ? 'fortios' : fwSource;
    const p = P[v];
    if (p && p.sample) {
      setFwText(String(p.sample).slice(0, FWPT_MAX));
      setFwOver(0);
      if (fwSource === 'auto') setFwSource('fortios');
    }
  };

  const report = translated.report;
  const draft = translated.text || '';
  const counts = (report && report.counts) || { exact: 0, approximated: 0, not_translated: 0, rules: 0 };

  const tsv = (() => {
    if (!report) return '';
    const header = [
      t('device_converter.fw_col_num'),
      t('device_converter.fw_col_rule'),
      t('device_converter.fw_col_target_name'),
      t('device_converter.fw_col_status'),
      t('device_converter.fw_col_items'),
      t('device_converter.fw_col_line')
    ].join('\t');
    const rows = (report.rules || []).map((r, i) => [
      i + 1,
      r.name || r.id || '',
      r.targetName || '',
      t('device_converter.fw_status_' + r.status),
      (r.items || []).map(it => t('device_converter.fw_code_' + it.code, it.params || {})).join('; '),
      (r.lines || []).join(',')
    ].join('\t'));
    return [header].concat(rows).join('\n');
  })();

  const handleExport = () => {
    const blob = new Blob([draft], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (fwTarget || 'target') + '-policy-DRAFT.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const seedRows = parsed.policy && window.FwTranslate
    ? window.FwTranslate.seedZones(parsed.policy)
    : [];
  const zoneRows = seedRows.map(s => {
    const u = (fwZmap && fwZmap[s.src]) || {};
    return {
      src: s.src,
      srcIfaces: (s.srcIfaces || []).join(' '),
      target: u.target != null ? u.target : (s.target || s.src),
      ifaces: u.ifaces != null ? u.ifaces : (s.srcIfaces || []).join(' ')
    };
  });

  const setZoneField = (src, field, val) => {
    setFwZmap(prev => {
      const next = Object.assign({}, prev || {});
      const row = Object.assign({ target: src, ifaces: '' }, next[src] || {});
      row[field] = val;
      next[src] = row;
      return next;
    });
  };

  const th = { padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12, verticalAlign: 'top' };

  const statusBadge = (st) => {
    if (st === 'exact') return 'badge-green';
    if (st === 'approximated') return 'badge-yellow';
    return 'badge-red';
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '1.5rem', borderColor: 'var(--warning)' }}>
        <div style={{ fontSize: 13, color: 'var(--text)' }}>{t('device_converter.fw_draft_banner')}</div>
        {fwTarget ? (
          <div className="hint" style={{ marginTop: 8 }}>{t('device_converter.fw_draft_steps_' + fwTarget)}</div>
        ) : null}
      </div>

      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <div className="two-col" style={{ gap: '1.5rem' }}>
          <div className="field">
            <label className="label">{t('device_converter.fw_source')}</label>
            <select className="select" value={fwSource} onChange={e => setFwSource(e.target.value)}>
              {FWPT_SOURCES.map(id => (
                <option key={id} value={id}>{t('device_converter.fw_vendor_' + id)}</option>
              ))}
            </select>
            {fwSource === 'auto' && parsed.detected ? (
              <span className="hint">{t('device_converter.fw_detected', { vendor: parsed.detected })}</span>
            ) : null}
            {parsed.error === 'fw_err_detect' ? (
              <span className="hint" style={{ color: 'var(--error)' }}>{t('device_converter.fw_err_detect')}</span>
            ) : null}
          </div>
          <div className="field">
            <label className="label">{t('device_converter.fw_target')}</label>
            <select className="select" value={fwTarget} onChange={e => setFwTarget(e.target.value)}>
              {targetList.map(id => (
                <option key={id} value={id}>{t('device_converter.fw_vendor_' + id)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="btn-row" style={{ marginTop: 12 }}>
          <button className="btn btn-sm btn-ghost" onClick={loadSample} style={{ border: '1px solid var(--border)' }}>
            {t('device_converter.fw_load_sample')}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => { setFwText(''); setFwOver(0); }} style={{ border: '1px solid var(--border)' }}>
            {t('device_converter.fw_clear')}
          </button>
        </div>
      </div>

      <div className="field" style={{ marginBottom: '1.5rem' }}>
        <label className="label">{t('device_converter.fw_input')}</label>
        <textarea
          className="input"
          rows={12}
          style={{ fontFamily: 'var(--mono)', fontSize: '0.85rem', minHeight: 280, width: '100%' }}
          placeholder={t('device_converter.fw_input_placeholder')}
          value={fwText}
          onChange={e => {
            const v = e.target.value;
            setFwText(v.slice(0, FWPT_MAX));
            setFwOver(Math.max(0, v.length - FWPT_MAX));
          }}
        />
      </div>

      {(fwOver > 0 || fwText.length >= FWPT_MAX) && (
        <div className="card" style={{ marginBottom: '1.5rem', borderColor: 'var(--warning)' }}>
          <div style={{ color: 'var(--warning)', fontWeight: 600 }}>
            {t('device_converter.fw_input_cap_warn', { cap: FWPT_MAX.toLocaleString() })}
          </div>
          <div className="hint" style={{ marginTop: 4 }}>
            {fwOver > 0
              ? t('device_converter.fw_input_cap_dropped', { over: fwOver.toLocaleString() })
              : t('device_converter.fw_input_cap_batch')}
          </div>
        </div>
      )}

      {zoneRows.length > 0 && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 className="card-title">{t('device_converter.fw_zone_title')}</h3>
          <div className="hint" style={{ marginBottom: 8 }}>{t('device_converter.fw_zone_hint')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={th}>{t('device_converter.fw_col_src_zone')}</th>
                  <th style={th}>{t('device_converter.fw_col_src_ifaces')}</th>
                  <th style={th}>{t('device_converter.fw_col_tgt_zone')}</th>
                  <th style={th}>{t('device_converter.fw_col_tgt_ifaces')}</th>
                </tr>
              </thead>
              <tbody>
                {zoneRows.map(row => (
                  <tr key={row.src}>
                    <td style={td}>{row.src}</td>
                    <td style={td}>{row.srcIfaces}</td>
                    <td style={td}>
                      <input className="input" value={row.target} onChange={e => setZoneField(row.src, 'target', e.target.value.slice(0, 63))} />
                    </td>
                    <td style={td}>
                      <input className="input" value={row.ifaces} onChange={e => setZoneField(row.src, 'ifaces', e.target.value.slice(0, 256))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {translated.error === 'fw_err_translate' && (
        <div className="card" style={{ marginBottom: '1.5rem', borderColor: 'var(--error)' }}>
          {t('device_converter.fw_err_translate', { msg: String((translated.exception && translated.exception.message) || translated.exception || '') })}
        </div>
      )}

      <div className="card">
        <div style={{ display: 'flex', gap: '1rem', borderBottom: '1px solid var(--border)', marginBottom: '1rem', paddingBottom: '0.5rem', alignItems: 'center' }}>
          <button className={`btn ${outTab === 'draft' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOutTab('draft')}>
            {t('device_converter.fw_tab_draft')}
          </button>
          <button className={`btn ${outTab === 'report' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOutTab('report')}>
            {t('device_converter.fw_tab_report')}
            {report ? (
              <span className="badge" style={{ marginLeft: 8 }}>{counts.not_translated + counts.approximated}</span>
            ) : null}
          </button>
        </div>

        {parsed.empty && <div className="hint">{t('device_converter.fw_empty')}</div>}

        {outTab === 'draft' && !parsed.empty && (
          <div>
            {(counts.approximated > 0 || counts.not_translated > 0) && (
              <div className="hint" style={{ marginBottom: 8, color: 'var(--warning)' }}>
                {t('device_converter.fw_report_notice', { approx: counts.approximated, fail: counts.not_translated })}
              </div>
            )}
            <div className="btn-row" style={{ marginBottom: 8 }}>
              <button className="btn btn-sm btn-ghost" onClick={handleExport} disabled={!draft} style={{ border: '1px solid var(--border)' }}>
                {t('device_converter.fw_export')}
              </button>
              <button
                className={`btn btn-sm ${copied ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => copy(draft)}
                disabled={!draft}
                style={{ border: copied ? 'none' : '1px solid var(--border)' }}
              >
                {copied ? t('common.copied') : t('common.copy_all')}
              </button>
            </div>
            <pre style={{
              fontFamily: 'var(--mono)', fontSize: '0.85rem', minHeight: 320, maxHeight: 600,
              overflowY: 'auto', background: 'var(--panel)', border: '1px solid var(--border)',
              padding: '1rem', borderRadius: 'var(--radius)', whiteSpace: 'pre-wrap'
            }}>
              {draft || t('device_converter.fw_empty')}
            </pre>
          </div>
        )}

        {outTab === 'report' && report && (
          <div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: 12 }}>
              <span className="badge badge-green">{t('device_converter.fw_status_exact')}: {counts.exact}</span>
              <span className="badge badge-yellow">{t('device_converter.fw_status_approximated')}: {counts.approximated}</span>
              <span className="badge badge-red">{t('device_converter.fw_status_not_translated')}: {counts.not_translated}</span>
              <span className="badge">{t('device_converter.fw_sum_rules', { count: counts.rules })}</span>
              <span className="badge">{t('device_converter.fw_sum_objects', {
                addr: counts.addrObjs, addrgrp: counts.addrGroups, svc: counts.svcObjs, svcgrp: counts.svcGroups
              })}</span>
            </div>
            <div className="btn-row" style={{ marginBottom: 8 }}>
              <button
                className={`btn btn-sm ${copiedReport ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => copyReport(tsv)}
                disabled={!tsv}
                style={{ border: copiedReport ? 'none' : '1px solid var(--border)' }}
              >
                {copiedReport ? t('common.copied') : t('device_converter.fw_copy_report')}
              </button>
            </div>
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={th}>{t('device_converter.fw_col_num')}</th>
                    <th style={th}>{t('device_converter.fw_col_rule')}</th>
                    <th style={th}>{t('device_converter.fw_col_target_name')}</th>
                    <th style={th}>{t('device_converter.fw_col_status')}</th>
                    <th style={th}>{t('device_converter.fw_col_items')}</th>
                  </tr>
                </thead>
                <tbody>
                  {(report.rules || []).map((r, i) => (
                    <tr key={r.uid || i}>
                      <td style={td}>{i + 1}</td>
                      <td style={td}>{r.name || r.id}</td>
                      <td style={td}>{r.targetName}</td>
                      <td style={td}><span className={`badge ${statusBadge(r.status)}`}>{t('device_converter.fw_status_' + r.status)}</span></td>
                      <td style={td}>{(r.items || []).map(it => t('device_converter.fw_code_' + it.code, it.params || {})).join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <h3 className="card-title">{t('device_converter.fw_dropped_title')}</h3>
            {(report.dropped || []).length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
                <thead>
                  <tr>
                    <th style={th}>{t('device_converter.fw_col_construct')}</th>
                    <th style={th}>{t('device_converter.fw_col_count')}</th>
                    <th style={th}>{t('device_converter.fw_col_rule_ids')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.dropped.map(d => (
                    <tr key={d.code}>
                      <td style={td}>{t('device_converter.fw_code_' + d.code, {})}</td>
                      <td style={td}>{d.count}</td>
                      <td style={td}>{(d.ruleIds || []).join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="hint" style={{ marginBottom: 16 }}>{t('device_converter.fw_none')}</div>}

            <h3 className="card-title">{t('device_converter.fw_renamed_title')}</h3>
            {(report.renamed || []).length ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 16 }}>
                <thead>
                  <tr>
                    <th style={th}>{t('device_converter.fw_col_kind')}</th>
                    <th style={th}>{t('device_converter.fw_col_from')}</th>
                    <th style={th}>{t('device_converter.fw_col_to')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.renamed.map((rn, i) => (
                    <tr key={i}>
                      <td style={td}>{rn.kind}</td>
                      <td style={td}>{rn.from}</td>
                      <td style={td}>{rn.to}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : <div className="hint" style={{ marginBottom: 16 }}>{t('device_converter.fw_none')}</div>}

            <h3 className="card-title">{t('device_converter.fw_notes_title')}</h3>
            {(report.notes || []).length ? (
              <ul style={{ marginBottom: 16 }}>
                {report.notes.map((n, i) => (
                  <li key={i}>{t('device_converter.fw_note_' + n.code, n.params || {})}</li>
                ))}
              </ul>
            ) : <div className="hint" style={{ marginBottom: 16 }}>{t('device_converter.fw_none')}</div>}

            <h3 className="card-title">{t('device_converter.fw_warnings_title')}</h3>
            {(report.warnings || []).length ? (
              <ul>
                {report.warnings.map((w, i) => (
                  <li key={i}>{t('fw_rule_analyzer.warn_' + w.code, Object.assign({ line: w.line }, w.params || {}))}</li>
                ))}
              </ul>
            ) : <div className="hint">{t('device_converter.fw_none')}</div>}
          </div>
        )}
      </div>
    </div>
  );
}

window.FirewallPolicyTranslator = FirewallPolicyTranslator;
