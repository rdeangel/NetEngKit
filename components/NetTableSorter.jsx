const { useState, useEffect, useMemo } = React;

const NTS_RENDER_CAP = 2000; // ponytail: render cap 2000 rows; exports always use all rows.
const NTS_DELIM_IDS = { '\t': 'tab', ',': 'comma', ';': 'semicolon', '|': 'pipe', ws: 'ws' };

function NetTableSorter({ initialData, onShare }) {
  const { t } = useTranslation();
  const [copied, copy] = useCopy();
  const S = window.NetTableSort;

  const [input, setInput] = usePersistentState('nettablesort:input', (initialData && initialData.input) ?? '');
  const [delimiter, setDelimiter] = usePersistentState('nettablesort:delimiter', (initialData && initialData.delimiter) ?? 'auto');
  const [header, setHeader] = usePersistentState('nettablesort:header', (initialData && initialData.header) ?? 'auto');
  const [sortKeys, setSortKeys] = usePersistentState('nettablesort:sortKeys', (initialData && initialData.sortKeys) ?? []);
  const [ifaceOrder, setIfaceOrder] = usePersistentState('nettablesort:ifaceOrder', (initialData && initialData.ifaceOrder) ?? 'alpha');

  useEffect(() => {
    if (!initialData) return;
    if (initialData.input != null) setInput(initialData.input);
    if (initialData.delimiter != null) setDelimiter(initialData.delimiter);
    if (initialData.header != null) setHeader(initialData.header);
    if (initialData.sortKeys != null) setSortKeys(initialData.sortKeys);
    if (initialData.ifaceOrder != null) setIfaceOrder(initialData.ifaceOrder);
  }, [initialData]);

  useEffect(() => {
    const handle = (e) =>
      (e.detail && e.detail.respond ? e.detail.respond : onShare)({
        tool: 'net-table-sorter',
        input, delimiter, header, sortKeys, ifaceOrder,
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [input, delimiter, header, sortKeys, ifaceOrder, onShare]);
  // ponytail: big tables make long share URLs; same as other paste tools.

  const detected = useMemo(() => S.detectDelimiter(input), [S, input]);

  const parsed = useMemo(() => {
    const headerOpt = header === 'yes' ? true : header === 'no' ? false : 'auto';
    return S.parseTable(input, { delimiter: delimiter === 'auto' ? 'auto' : delimiter, header: headerOpt });
  }, [S, input, delimiter, header]);
  // ponytail: parse is sync; debounce only if someone pastes >5k lines.

  const colCount = (parsed.headers && parsed.headers.length)
    || (parsed.rows[0] && parsed.rows[0].length)
    || 0;

  // Keep keys on empty input (Clear / share-link restore). Drop out-of-range keys at render only.
  const appliedSortKeys = useMemo(() => (
    colCount === 0 ? sortKeys : sortKeys.filter(k => k.col >= 0 && k.col < colCount)
  ), [sortKeys, colCount]);

  const sorted = useMemo(
    () => S.sortRows(parsed.rows, appliedSortKeys, { ifaceOrder }),
    [S, parsed.rows, appliedSortKeys, ifaceOrder]
  );

  const colLabel = (i) => (parsed.headers && parsed.headers[i])
    ? parsed.headers[i]
    : t('net_table_sorter.col_n', { n: i + 1 });

  const exportHeaders = parsed.hasHeader ? parsed.headers : null;
  const exportRows = sorted.map(r => r.cells);
  const mdHeaders = exportHeaders || Array.from({ length: colCount }, (_, i) => t('net_table_sorter.col_n', { n: i + 1 }));

  const tsvText = S.toTSV(exportHeaders, exportRows);
  const csvText = S.toCSV(exportHeaders, exportRows);
  const mdText = S.toMarkdown(mdHeaders, exportRows);
  const regexText = S.toTSV(null, exportRows);

  const shown = sorted.slice(0, NTS_RENDER_CAP);
  const hasInput = String(input).trim() !== '';
  const keyIndex = (col) => appliedSortKeys.findIndex(k => k.col === col);

  const onHeaderClick = (col, e) => {
    const shift = !!(e && e.shiftKey);
    setSortKeys(prev => {
      if (shift) {
        const idx = prev.findIndex(k => k.col === col);
        if (idx === -1) return prev.concat([{ col, dir: 'asc' }]);
        if (prev[idx].dir === 'asc') {
          return prev.map((k, i) => i === idx ? { col, dir: 'desc' } : k);
        }
        return prev.filter((_, i) => i !== idx);
      }
      if (prev.length === 1 && prev[0].col === col) {
        if (prev[0].dir === 'asc') return [{ col, dir: 'desc' }];
        return [];
      }
      return [{ col, dir: 'asc' }];
    });
  };

  const moveKey = (idx, delta) => {
    setSortKeys(prev => {
      const j = idx + delta;
      if (j < 0 || j >= prev.length) return prev;
      const next = prev.slice();
      const tmp = next[idx];
      next[idx] = next[j];
      next[j] = tmp;
      return next;
    });
  };

  const toggleKeyDir = (idx) => {
    setSortKeys(prev => prev.map((k, i) => i === idx ? { col: k.col, dir: k.dir === 'asc' ? 'desc' : 'asc' } : k));
  };

  const openRegex = () => {
    window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: 'regex', text: regexText } }));
  };

  const thBase = {
    padding: '8px 10px',
    textAlign: 'left',
    borderBottom: '1px solid var(--border)',
    color: 'var(--dim)',
    fontSize: 10,
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  };
  const tdBase = {
    padding: '7px 10px',
    borderBottom: '1px solid var(--border)',
    fontFamily: 'var(--mono)',
    fontSize: 12,
    verticalAlign: 'middle',
  };

  const delimId = NTS_DELIM_IDS[detected] || 'ws';

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('net_table_sorter.title')}</div>
        <div className="hint">{t('net_table_sorter.subtitle')}</div>
      </div>

      <div className="card">
        <div className="field">
          <label className="label">{t('net_table_sorter.input_label')}</label>
          <textarea
            className="input"
            rows={8}
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder={t('net_table_sorter.input_placeholder')}
            spellCheck={false}
            autoComplete="off"
            style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical', lineHeight: 1.45 }}
          />
        </div>
        <div className="btn-row" style={{ marginTop: 8 }}>
          <button className="btn btn-sm btn-ghost" onClick={() => setInput(S.SAMPLE)}>
            {t('net_table_sorter.load_sample')}
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setInput('')}>
            {t('common.clear')}
          </button>
        </div>
        <div className="three-col grid-mobile-1" style={{ marginTop: 12 }}>
          <div className="field">
            <label className="label">{t('net_table_sorter.delimiter_label')}</label>
            <select className="input" value={delimiter} onChange={e => setDelimiter(e.target.value)}>
              <option value="auto">{t('net_table_sorter.delim_auto_detected', { d: t('net_table_sorter.delim_' + delimId) })}</option>
              <option value={'\t'}>{t('net_table_sorter.delim_tab')}</option>
              <option value=",">{t('net_table_sorter.delim_comma')}</option>
              <option value=";">{t('net_table_sorter.delim_semicolon')}</option>
              <option value="|">{t('net_table_sorter.delim_pipe')}</option>
              <option value="ws">{t('net_table_sorter.delim_ws')}</option>
            </select>
          </div>
          <div className="field">
            <label className="label">{t('net_table_sorter.header_label')}</label>
            <select className="input" value={header} onChange={e => setHeader(e.target.value)}>
              <option value="auto">{t('net_table_sorter.header_auto')}</option>
              <option value="yes">{t('net_table_sorter.header_yes')}</option>
              <option value="no">{t('net_table_sorter.header_no')}</option>
            </select>
          </div>
          <div className="field">
            <label className="label">{t('net_table_sorter.iface_order_label')}</label>
            <select className="input" value={ifaceOrder} onChange={e => setIfaceOrder(e.target.value)}>
              <option value="alpha">{t('net_table_sorter.iface_order_alpha')}</option>
              <option value="speed">{t('net_table_sorter.iface_order_speed')}</option>
            </select>
            <div className="hint">{t('net_table_sorter.iface_order_hint')}</div>
          </div>
        </div>
        {hasInput ? (
          <div className="hint" style={{ marginTop: 8 }}>
            {t('net_table_sorter.stats', { rows: parsed.rows.length, cols: colCount })}
          </div>
        ) : null}
      </div>

      {sortKeys.length ? (
        <div className="card">
          <div className="card-title">{t('net_table_sorter.sort_keys_title')}</div>
          <div className="hint" style={{ marginBottom: 8 }}>{t('net_table_sorter.sort_hint')}</div>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {sortKeys.map((k, idx) => (
              <li key={k.col + '-' + idx} style={{ marginBottom: 6 }}>
                <span style={{ fontFamily: 'var(--mono)', marginRight: 8 }}>{colLabel(k.col)}</span>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => toggleKeyDir(idx)}
                  title={k.dir === 'asc' ? t('net_table_sorter.dir_asc') : t('net_table_sorter.dir_desc')}
                >
                  {k.dir === 'asc' ? '▲' : '▼'} {k.dir === 'asc' ? t('net_table_sorter.dir_asc') : t('net_table_sorter.dir_desc')}
                </button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => moveKey(idx, -1)}
                  disabled={idx === 0}
                  title={t('net_table_sorter.move_up')}
                  aria-label={t('net_table_sorter.move_up')}
                >↑</button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => moveKey(idx, 1)}
                  disabled={idx === sortKeys.length - 1}
                  title={t('net_table_sorter.move_down')}
                  aria-label={t('net_table_sorter.move_down')}
                >↓</button>
                <button
                  className="btn btn-sm btn-ghost"
                  onClick={() => setSortKeys(prev => prev.filter((_, i) => i !== idx))}
                  title={t('net_table_sorter.remove_key')}
                  aria-label={t('net_table_sorter.remove_key')}
                >×</button>
              </li>
            ))}
          </ol>
          <button className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => setSortKeys([])}>
            {t('net_table_sorter.clear_sort')}
          </button>
        </div>
      ) : null}

      <div className="card">
        {!hasInput ? (
          <div className="hint">{t('net_table_sorter.empty')}</div>
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr>
                    <th style={{ ...thBase, color: 'var(--muted)' }}>{t('net_table_sorter.th_orig')}</th>
                    {Array.from({ length: colCount }, (_, i) => {
                      const ki = keyIndex(i);
                      const active = ki >= 0;
                      const dir = active ? appliedSortKeys[ki].dir : null;
                      const aria = dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none';
                      return (
                        <th
                          key={i}
                          role="button"
                          tabIndex={0}
                          aria-sort={aria}
                          onClick={e => onHeaderClick(i, e)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              onHeaderClick(i, e);
                            }
                          }}
                          style={{
                            ...thBase,
                            cursor: 'pointer',
                            color: active ? 'var(--cyan)' : 'var(--dim)',
                          }}
                        >
                          {colLabel(i)}
                          {active ? (dir === 'asc' ? ' ▲' : ' ▼') : ''}
                          {active && appliedSortKeys.length > 1 ? (
                            <span style={{ marginLeft: 4, fontSize: 9, opacity: 0.8 }}>{ki + 1}</span>
                          ) : null}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {shown.map(r => (
                    <tr key={r.i}>
                      <td style={{ ...tdBase, color: 'var(--muted)', fontFamily: 'inherit' }}>{r.i + 1}</td>
                      {Array.from({ length: colCount }, (_, i) => (
                        <td key={i} style={tdBase}>{r.cells[i] || ''}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sorted.length > NTS_RENDER_CAP ? (
              <div className="hint" style={{ marginTop: 8 }}>
                {t('net_table_sorter.render_cap', { shown: NTS_RENDER_CAP, total: sorted.length })}
              </div>
            ) : null}
            {!sortKeys.length ? (
              <div className="hint" style={{ marginTop: 8 }}>{t('net_table_sorter.sort_hint')}</div>
            ) : null}
          </>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('net_table_sorter.export_title')}</div>
        <div className="btn-row">
          <button
            className="btn btn-sm btn-primary"
            disabled={!exportRows.length}
            onClick={() => copy(tsvText, 'tsv')}
          >
            {copied === 'tsv' ? t('common.copied') : t('net_table_sorter.copy_tsv')}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            disabled={!exportRows.length}
            onClick={() => copy(csvText, 'csv')}
          >
            {copied === 'csv' ? t('common.copied') : t('net_table_sorter.copy_csv')}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            disabled={!exportRows.length}
            onClick={() => copy(mdText, 'md')}
          >
            {copied === 'md' ? t('common.copied') : t('net_table_sorter.copy_md')}
          </button>
        </div>
        <div className="hint" style={{ marginTop: 8 }}>{t('net_table_sorter.export_hint')}</div>
      </div>

      <div className="card">
        <div className="card-title">{t('net_table_sorter.regex_link_title')}</div>
        <div className="hint" style={{ marginBottom: 8 }}>
          {t('net_table_sorter.regex_link_hint', { preset: t('regex.preset_iface_spreadsheet_label') })}
        </div>
        <button className="btn btn-sm btn-ghost" disabled={!exportRows.length} onClick={openRegex}>
          {t('net_table_sorter.regex_link_btn')}
        </button>
      </div>
    </div>
  );
}

window.NetTableSorter = NetTableSorter;
