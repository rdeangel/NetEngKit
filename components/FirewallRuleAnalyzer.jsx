const { useState, useEffect, useMemo } = React;

const FWRA_VENDORS = ['auto', 'ios', 'asa', 'iptables', 'fortios', 'junos'];
const FWRA_TYPES = ['duplicate', 'shadowed', 'contradiction', 'merge', 'any_wide', 'undetermined'];
const FWRA_MAX = 200000;

// ponytail: debounce + useMemo is enough for a few thousand rules (O(n²) per scope).
// A Web Worker is the upgrade path for 20k-line pastes.

function fwraHydrateVendor(v) {
  return FWRA_VENDORS.includes(v) ? v : 'auto';
}
function fwraStr(v, d, n) {
  return String(v != null ? v : d).slice(0, n);
}

function fwraParsers() {
  const P = (typeof window !== 'undefined' && window.FwParsers) || {};
  return { ios: P.ios, asa: P.asa, iptables: P.iptables, fortios: P.fortios, junos: P.junos };
}

function fwraPick(vendor, text) {
  const P = fwraParsers();
  if (vendor !== 'auto') return P[vendor] || null;
  let best = null, score = -1, name = '';
  FWRA_VENDORS.slice(1).forEach(id => {
    const p = P[id];
    if (!p || !p.detect) return;
    const s = p.detect(text);
    if (s > score) { score = s; best = p; name = id; }
  });
  if (score < 20) return { err: 'detect', score };
  return best;
}

function fwraFmtRefs(refs, t) {
  if (!refs || !refs.length) return t('fw_rule_analyzer.any');
  return refs.map(r => {
    if (typeof r === 'string') return r;
    if (r && r.lit) {
      const lit = r.lit;
      if (lit.kind === 'any' || lit.any) return t('fw_rule_analyzer.any');
      if (lit.value != null && typeof lit.value === 'string') return lit.value;
      if (Array.isArray(lit.proto)) {
        const p = lit.proto[0] === 0 && lit.proto[1] === 255 ? 'ip' : String(lit.proto[0]);
        const d = (lit.dport && lit.dport[0] && !(lit.dport[0][0] === 0 && lit.dport[0][1] === 65535))
          ? (':' + lit.dport.map(iv => iv[0] === iv[1] ? iv[0] : iv[0] + '-' + iv[1]).join(','))
          : '';
        return p + d;
      }
      if (typeof lit.proto === 'number') return String(lit.proto);
    }
    return String(r);
  }).join(', ');
}

function fwraScopeLabel(scope, t) {
  if (!scope) return '';
  const k = scope.kind;
  if (k === 'acl') return t('fw_rule_analyzer.scope_acl', { name: scope.label || scope.key });
  if (k === 'chain') {
    const parts = String(scope.key || '').split(':');
    return t('fw_rule_analyzer.scope_chain', { table: parts[1] || 'filter', name: parts[2] || scope.label });
  }
  if (k === 'zone-pair') return t('fw_rule_analyzer.scope_zone_pair', { from: scope.from, to: scope.to });
  if (k === 'global') return t('fw_rule_analyzer.scope_global');
  if (k === 'filter') return t('fw_rule_analyzer.scope_filter', { name: scope.label, family: scope.from || 'inet' });
  if (k === 'policy-list') return t('fw_rule_analyzer.scope_policy_list', { name: scope.label });
  return scope.label || scope.key;
}

function fwraByText(f) {
  if (!f.by || !f.by.length) return '';
  return f.by.map(b => b.id + ' (' + (b.lines || []).join(',') + ')').join(', ');
}

function fwraDetail(f, t) {
  const by = fwraByText(f) || '—';
  if (f.type === 'duplicate') return t('fw_rule_analyzer.desc_duplicate', { by: by });
  if (f.type === 'shadowed') {
    return f.params && f.params.single === false
      ? t('fw_rule_analyzer.desc_shadowed_union', { by: by })
      : t('fw_rule_analyzer.desc_shadowed', { by: by });
  }
  if (f.type === 'contradiction') {
    return f.params && f.params.direction === 'permit_covers_deny'
      ? t('fw_rule_analyzer.desc_contradiction_pd', { by: by })
      : t('fw_rule_analyzer.desc_contradiction_dp', { by: by });
  }
  if (f.type === 'merge') {
    const dim = t('fw_rule_analyzer.dim_' + (f.params && f.params.dim));
    return t('fw_rule_analyzer.desc_merge', { by: by, dim: dim });
  }
  if (f.type === 'any_wide') {
    if (f.params && f.params.level === 'high') return t('fw_rule_analyzer.desc_any_wide_high');
    const dims = String((f.params && f.params.dims) || '').split(',').filter(Boolean)
      .map(d => t('fw_rule_analyzer.dim_' + d)).join(', ');
    return t('fw_rule_analyzer.desc_any_wide_medium', { dims: dims });
  }
  if (f.type === 'undetermined') return t('fw_rule_analyzer.desc_undetermined', { limit: (f.params && f.params.limit) || 20000 });
  return '';
}

function fwraBadge(f) {
  if (f.type === 'contradiction') return 'badge-red';
  if (f.type === 'any_wide') return (f.params && f.params.level === 'high') ? 'badge-red' : 'badge-yellow';
  if (f.type === 'shadowed') return 'badge-yellow';
  if (f.type === 'duplicate') return 'badge-cyan';
  return 'badge';
}

function fwraCleanupText(policy, analysis, t) {
  const L = [t('fw_rule_analyzer.cleanup_hint'), ''];
  const scopes = (analysis.cleanup && analysis.cleanup.perScope) || [];
  const scopeMap = {};
  (policy.scopes || []).forEach(s => { scopeMap[s.key] = s; });
  let any = false;
  scopes.forEach(sc => {
    const label = fwraScopeLabel(scopeMap[sc.scopeKey] || { key: sc.scopeKey, kind: '', label: sc.scopeKey }, t);
    if ((sc.remove && sc.remove.length) || (sc.review && sc.review.length)) {
      any = true;
      L.push('## ' + label);
      if (sc.remove && sc.remove.length) {
        L.push(t('fw_rule_analyzer.cleanup_remove_header'));
        sc.remove.forEach(item => {
          const line = (item.rule.lines || [])[0] || '';
          const by = (item.by || []).map(b => b.id).join(', ');
          L.push(t('fw_rule_analyzer.cleanup_line', { rule: item.rule.id, line: line, reason: t('fw_rule_analyzer.type_' + item.reason), by: by }));
        });
      }
      if (sc.review && sc.review.length) {
        L.push(t('fw_rule_analyzer.cleanup_review_header'));
        sc.review.forEach(item => {
          const line = (item.rule.lines || [])[0] || '';
          const by = (item.by || []).map(b => b.id).join(', ');
          L.push(t('fw_rule_analyzer.cleanup_line', { rule: item.rule.id, line: line, reason: t('fw_rule_analyzer.type_' + item.reason), by: by }));
        });
      }
      if (sc.keptOrder && sc.keptOrder.length) {
        L.push(t('fw_rule_analyzer.cleanup_order_header'));
        L.push(sc.keptOrder.join(' → '));
      }
      L.push('');
    }
  });
  if (!any) L.push(t('fw_rule_analyzer.cleanup_none'));
  const cmds = window.FwAnalyzer && window.FwAnalyzer.removalCommands
    ? window.FwAnalyzer.removalCommands(policy, analysis.cleanup)
    : '';
  if (cmds) {
    L.push(t('fw_rule_analyzer.cleanup_commands_header'));
    L.push(cmds);
  }
  return { text: L.join('\n'), cmds: cmds || '' };
}

function FirewallRuleAnalyzer({ initialData, onShare }) {
  const { t } = useTranslation();
  const [vendor, setVendor] = usePersistentState('fwra:vendor', fwraHydrateVendor(initialData?.vendor));
  const [text, setText] = usePersistentState('fwra:text', fwraStr(initialData?.text, '', FWRA_MAX));
  const [typeFilter, setTypeFilter] = usePersistentState('fwra:typeFilter', 'all');
  const [showRules, setShowRules] = usePersistentState('fwra:showRules', false);
  const [debounced, setDebounced] = useState({ vendor, text });

  useEffect(() => {
    const h = setTimeout(() => setDebounced({ vendor, text }), 300);
    return () => clearTimeout(h);
  }, [vendor, text]);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({ tool: 'fw-rule-analyzer', vendor, text });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [onShare, vendor, text]);

  const analysis = useMemo(() => {
    const src = debounced.text || '';
    const vend = debounced.vendor;
    if (!String(src).trim()) return { empty: true };
    try {
      const parser = fwraPick(vend, src);
      if (!parser) return { error: 'err_detect' };
      if (parser.err === 'detect') return { error: 'err_detect' };
      const policy = parser.parse(src);
      window.FwIR.finalize(policy);
      const result = window.FwAnalyzer.analyze(policy);
      if (!policy.rules.length) return { error: 'err_no_rules', vendor: parser.vendor, policy, result };
      return { policy, result, parser, detected: parser.vendor };
    } catch (e) {
      console.error('FirewallRuleAnalyzer', e);
      return { error: 'err_parse', exception: e };
    }
  }, [debounced]);

  const loadSample = () => {
    const P = fwraParsers();
    const v = vendor === 'auto' ? 'fortios' : vendor;
    const p = P[v];
    if (p && p.sample) {
      setText(p.sample);
      if (vendor === 'auto') setVendor('fortios');
    }
  };

  const findings = (analysis.result && analysis.result.findings) || [];
  const shown = typeFilter === 'all' ? findings : findings.filter(f => f.type === typeFilter);
  const typeCounts = {};
  FWRA_TYPES.forEach(tp => { typeCounts[tp] = findings.filter(f => f.type === tp).length; });

  const grouped = [];
  if (analysis.policy) {
    const byScope = {};
    shown.forEach(f => {
      const k = f.scopeKey + '\0' + (f.pairLabel || '');
      if (!byScope[k]) byScope[k] = { scopeKey: f.scopeKey, pairLabel: f.pairLabel, items: [] };
      byScope[k].items.push(f);
    });
    (analysis.policy.scopes || []).forEach(sc => {
      Object.keys(byScope).forEach(k => {
        if (byScope[k].scopeKey === sc.key) grouped.push({ scope: sc, pairLabel: byScope[k].pairLabel, items: byScope[k].items });
      });
    });
  }

  const notAnalysed = analysis.policy
    ? analysis.policy.rules.filter(r => (r.unsupported && r.unsupported.length) || r.disabled)
    : [];
  const warnings = (analysis.policy && analysis.policy.warnings) || [];
  const cleanup = analysis.policy && analysis.result ? fwraCleanupText(analysis.policy, analysis.result, t) : { text: '', cmds: '' };

  const tsvScopeMap = {};
  (analysis.policy && analysis.policy.scopes || []).forEach(s => { tsvScopeMap[s.key] = s; });
  const tsv = shown.length
    ? [t('fw_rule_analyzer.col_type'), t('fw_rule_analyzer.col_scope'), t('fw_rule_analyzer.col_rule'), t('fw_rule_analyzer.col_lines'), t('fw_rule_analyzer.col_covered_by'), t('fw_rule_analyzer.col_detail')].join('\t') + '\n' +
      shown.map(f => [
        t('fw_rule_analyzer.type_' + f.type),
        fwraScopeLabel(tsvScopeMap[f.scopeKey] || { key: f.scopeKey, kind: '', label: f.scopeKey }, t) + (f.pairLabel ? ' ' + f.pairLabel : ''),
        f.rule.id,
        (f.rule.lines || []).join(','),
        fwraByText(f),
        fwraDetail(f, t)
      ].join('\t')).join('\n')
    : '';

  const th = { padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12, verticalAlign: 'top' };

  const stats = analysis.result && analysis.result.stats;

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('fw_rule_analyzer.title')}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>{t('fw_rule_analyzer.subtitle')}</div>
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('fw_rule_analyzer.vendor_label')}</label>
            <select className="select" value={vendor} onChange={e => setVendor(e.target.value)}>
              {FWRA_VENDORS.map(id => (
                <option key={id} value={id}>{t('fw_rule_analyzer.vendor_' + id)}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label className="label">{t('fw_rule_analyzer.input_label')}</label>
          <textarea
            className="input"
            rows={12}
            value={text}
            onChange={e => setText(e.target.value.slice(0, FWRA_MAX))}
            placeholder={t('fw_rule_analyzer.input_placeholder')}
            spellCheck={false}
            autoComplete="off"
            style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', lineHeight: 1.45 }}
          />
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={loadSample}>{t('common.load_sample')}</button>
          <button className="btn btn-sm btn-ghost" onClick={() => setText('')}>{t('common.clear')}</button>
        </div>
        {vendor === 'auto' && analysis.detected ? (
          <div className="hint" style={{ marginTop: 8 }}>{t('fw_rule_analyzer.detected', { vendor: t('fw_rule_analyzer.vendor_' + analysis.detected) })}</div>
        ) : null}
        <div className="hint" style={{ marginTop: 8 }}>{t('fw_rule_analyzer.share_hint')}</div>
      </div>

      {analysis.empty ? (
        <div className="card"><div className="hint">{t('fw_rule_analyzer.empty_hint')}</div></div>
      ) : null}

      {analysis.error ? (
        <Err msg={t('fw_rule_analyzer.' + analysis.error, { vendor: analysis.vendor || vendor })} />
      ) : null}

      {stats ? (
        <div className="card">
          <div className="result-grid grid-mobile-1">
            <ResultItem label={t('fw_rule_analyzer.summary_rules')} value={String(stats.rules)} />
            <ResultItem label={t('fw_rule_analyzer.summary_scopes')} value={String(stats.scopes)} />
            <ResultItem label={t('fw_rule_analyzer.summary_findings')} value={String(stats.findings)} yellow={stats.findings > 0} />
            <ResultItem label={t('fw_rule_analyzer.summary_not_analysed')} value={String(stats.notAnalysed)} />
            <ResultItem label={t('fw_rule_analyzer.summary_disabled')} value={String(stats.disabled)} />
            <ResultItem label={t('fw_rule_analyzer.summary_warnings')} value={String(stats.warnings)} />
          </div>
        </div>
      ) : null}

      {analysis.result ? (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>{t('fw_rule_analyzer.section_findings')}</span>
            {tsv ? <CopyBtn text={tsv} label="copy_all" id="fwra-findings" /> : null}
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
            <button className={`btn btn-sm ${typeFilter === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTypeFilter('all')}>
              {t('fw_rule_analyzer.filter_all')} ({findings.length})
            </button>
            {FWRA_TYPES.map(tp => (
              <button key={tp} className={`btn btn-sm ${typeFilter === tp ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTypeFilter(tp)}>
                {t('fw_rule_analyzer.type_' + tp)} ({typeCounts[tp] || 0})
              </button>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="hint">{t('fw_rule_analyzer.no_findings', { n: (analysis.policy.scopes || []).length })}</div>
          ) : (
            grouped.map((g, gi) => (
              <div key={gi} style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>
                  {fwraScopeLabel(g.scope, t)}{g.pairLabel ? ' · ' + g.pairLabel : ''}
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={th}>{t('fw_rule_analyzer.col_type')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_rule')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_lines')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_covered_by')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_detail')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.items.map((f, fi) => (
                        <tr key={fi}>
                          <td style={td}><span className={`badge ${fwraBadge(f)}`}>{t('fw_rule_analyzer.type_' + f.type)}</span></td>
                          <td style={td}>{f.rule.id}</td>
                          <td style={td}>{(f.rule.lines || []).join(', ')}</td>
                          <td style={td}>{fwraByText(f) || '—'}</td>
                          <td style={{ ...td, fontFamily: 'inherit' }}>{fwraDetail(f, t)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))
          )}
        </div>
      ) : null}

      {notAnalysed.length ? (
        <div className="card">
          <div className="card-title">{t('fw_rule_analyzer.section_not_analysed')}</div>
          <div className="hint" style={{ marginBottom: 8 }}>{t('fw_rule_analyzer.section_not_analysed_hint')}</div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={th}>{t('fw_rule_analyzer.col_rule')}</th>
                  <th style={th}>{t('fw_rule_analyzer.col_lines')}</th>
                  <th style={th}>{t('fw_rule_analyzer.col_status')}</th>
                  <th style={th}>{t('fw_rule_analyzer.col_constructs')}</th>
                </tr>
              </thead>
              <tbody>
                {notAnalysed.map(r => (
                  <tr key={r.uid}>
                    <td style={td}>{r.id}</td>
                    <td style={td}>{(r.lines || []).join(', ')}</td>
                    <td style={td}>{t('fw_rule_analyzer.status_' + (r.disabled ? 'disabled' : 'active'))}</td>
                    <td style={{ ...td, fontFamily: 'inherit' }}>
                      {(r.unsupported || []).map(u => t('fw_rule_analyzer.na_' + u.construct, { name: u.detail || '' })).join('; ') || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {warnings.length ? (
        <div className="card">
          <div className="card-title">{t('fw_rule_analyzer.section_warnings')}</div>
          <div className="hint" style={{ marginBottom: 8 }}>{t('fw_rule_analyzer.section_warnings_hint')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {warnings.map((w, i) => (
              <div key={i} style={{ fontSize: 13 }}>
                {t('fw_rule_analyzer.warn_' + w.code, Object.assign({ line: w.line }, w.params || {}))}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {analysis.policy ? (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>{t('fw_rule_analyzer.section_rules')}</span>
            <button className="btn btn-sm btn-ghost" onClick={() => setShowRules(!showRules)}>
              {showRules ? t('common.collapse_all') : t('common.expand_all')}
            </button>
          </div>
          {showRules ? (analysis.policy.scopes || []).map(sc => {
            const rules = analysis.policy.rules.filter(r => r.scopeKey === sc.key);
            return (
              <div key={sc.key} style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{fwraScopeLabel(sc, t)}</div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead>
                      <tr>
                        <th style={th}>{t('fw_rule_analyzer.col_order')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_rule')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_lines')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_action')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_src')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_dst')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_svc')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_intf')}</th>
                        <th style={th}>{t('fw_rule_analyzer.col_status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rules.map(r => (
                        <tr key={r.uid}>
                          <td style={td}>{r.order}</td>
                          <td style={td}>{r.id}</td>
                          <td style={td}>{(r.lines || []).join(', ')}</td>
                          <td style={td}>{t('fw_rule_analyzer.action_' + r.action)}</td>
                          <td style={td}>{fwraFmtRefs(r.srcRefs, t)}</td>
                          <td style={td}>{fwraFmtRefs(r.dstRefs, t)}</td>
                          <td style={td}>{fwraFmtRefs(r.svcRefs, t)}</td>
                          <td style={td}>{(r.srcIntf || []).concat(r.dstIntf || []).length ? (r.srcIntf || []).join(',') + '→' + (r.dstIntf || []).join(',') : '—'}</td>
                          <td style={td}>{t('fw_rule_analyzer.status_' + (r.disabled ? 'disabled' : 'active'))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          }) : null}
        </div>
      ) : null}

      {analysis.result ? (
        <div className="card">
          <div className="card-title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <span>{t('fw_rule_analyzer.section_cleanup')}</span>
            <CopyBtn text={cleanup.text} label="copy_all" id="fwra-cleanup" />
          </div>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre-wrap', margin: 0 }}>{cleanup.text}</pre>
          {cleanup.cmds ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div className="card-title" style={{ margin: 0 }}>{t('fw_rule_analyzer.cleanup_commands_header')}</div>
                <CopyBtn text={cleanup.cmds} id="fwra-cmds" />
              </div>
              <pre style={{ fontFamily: 'var(--mono)', fontSize: 12, whiteSpace: 'pre-wrap', margin: '8px 0 0' }}>{cleanup.cmds}</pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

window.FirewallRuleAnalyzer = FirewallRuleAnalyzer;
