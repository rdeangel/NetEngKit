const { useState, useEffect, useMemo } = React;

// Pure core — no React, no DOM.
const SplitTunnelCore = (() => {
  const SIZE = p => Math.pow(2, 32 - p);
  const end = n => n.a + SIZE(n.p) - 1;
  const overlaps = (x, y) => x.a <= end(y) && y.a <= end(x);
  const covers = (outer, inner) => outer.a <= inner.a && end(inner) <= end(outer);
  const cidr = n => `${IPv4.str(n.a)}/${n.p}`;

  // CIDR blocks are either nested or disjoint, so at most one half ever contains `ex`.
  function excludeOne(net, ex) {
    if (!overlaps(net, ex)) return [net];
    if (covers(ex, net)) return [];
    const p = net.p + 1;
    const lo = { a: net.a, p };
    const hi = { a: net.a + SIZE(p), p };
    return overlaps(lo, ex) ? [...excludeOne(lo, ex), hi] : [lo, ...excludeOne(hi, ex)];
  }

  function aggregate(nets) {
    let list = nets.slice().sort((x, y) => x.a - y.a || x.p - y.p);
    const kept = [];
    for (const n of list) if (!kept.some(k => covers(k, n))) kept.push(n);
    list = kept;
    for (let pass = true; pass;) {
      pass = false;
      const res = [];
      for (let i = 0; i < list.length; i++) {
        const a = list[i], b = list[i + 1];
        if (b && a.p === b.p && a.p > 0 && a.a % (2 * SIZE(a.p)) === 0 && b.a === a.a + SIZE(a.p)) {
          res.push({ a: a.a, p: a.p - 1 });
          i++;
          pass = true;
        } else res.push(a);
      }
      list = res.sort((x, y) => x.a - y.a || x.p - y.p);
    }
    return list;
  }

  function parseList(text) {
    const nets = [], bad = [];
    for (const tok of String(text || '').split(/[\s,]+/).filter(Boolean)) {
      let c = tok.includes('/') ? IPv4.parseCIDR(tok) : null;
      if (!c && !tok.includes('/')) {
        const ip = IPv4.parse(tok);
        if (ip !== null) c = { ip, prefix: 32 };
      }
      if (!c) { bad.push(tok); continue; }
      nets.push({ a: (c.ip & IPv4.mask(c.prefix)) >>> 0, p: c.prefix });
    }
    return { nets, bad };
  }

  function calc(includes, excludes) {
    let out = [];
    for (const inc of includes) {
      let parts = [inc];
      for (const ex of excludes) parts = parts.flatMap(p => excludeOne(p, ex));
      out = out.concat(parts);
    }
    return aggregate(out);
  }

  const RANGES = [
    ['rfc1918', '10.0.0.0/8'], ['rfc1918', '172.16.0.0/12'], ['rfc1918', '192.168.0.0/16'],
    ['current', '0.0.0.0/8'], ['loopback', '127.0.0.0/8'], ['linklocal', '169.254.0.0/16'],
    ['cgnat', '100.64.0.0/10'], ['testnet', '192.0.2.0/24'], ['testnet', '198.51.100.0/24'],
    ['testnet', '203.0.113.0/24'], ['multicast', '224.0.0.0/4'], ['reserved', '240.0.0.0/4'],
  ].map(([k, c]) => { const p = IPv4.parseCIDR(c); return { k, n: { a: p.ip, p: p.prefix } }; });

  const category = n => (RANGES.find(r => covers(r.n, n)) || { k: 'public' }).k;

  const RFC1918 = ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'];
  const PUBLIC = () => calc([{ a: 0, p: 0 }], parseList(RFC1918.join(',')).nets).map(cidr);

  return { SIZE, end, excludeOne, aggregate, parseList, calc, category, cidr, RFC1918, PUBLIC };
})();

if (typeof window !== 'undefined') window.SplitTunnelCore = SplitTunnelCore;

function SplitTunnel({ onShare, initialData }) {
  const { t } = useTranslation();
  const [mode, setMode] = usePersistentState('splittunnel:mode', initialData?.mode ?? 'include');
  const [inc, setInc] = usePersistentState('splittunnel:inc', initialData?.inc ?? '10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16');
  const [exc, setExc] = usePersistentState('splittunnel:exc', initialData?.exc ?? '10.10.10.0/24');

  useEffect(() => {
    if (initialData?.mode) setMode(initialData.mode);
    if (initialData?.inc !== undefined) setInc(initialData.inc);
    if (initialData?.exc !== undefined) setExc(initialData.exc);
  }, [initialData]);

  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'split-tunnel', mode, inc, exc });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [mode, inc, exc, onShare]);

  const { nets, err, totalIPs, byPrefix, byCategory } = useMemo(() => {
    const C = SplitTunnelCore;
    const incP = C.parseList(inc);
    const excP = C.parseList(exc);
    const bad = (mode === 'include' ? incP.bad : []).concat(excP.bad);
    if (bad.length) return { nets: [], err: t('split_tunnel.err_invalid', { list: bad.join(', ') }) };
    // ponytail: exclude mode = everything minus the exclude list; the include box is hidden there.
    const base = mode === 'include' ? incP.nets : [{ a: 0, p: 0 }];
    if (!base.length) return { nets: [], err: t('split_tunnel.err_no_include') };
    const nets = C.calc(base, excP.nets);
    const totalIPs = nets.reduce((s, n) => s + C.SIZE(n.p), 0);
    const byPrefix = {}, byCategory = {};
    for (const n of nets) {
      byPrefix[n.p] = (byPrefix[n.p] || 0) + 1;
      const c = C.category(n);
      byCategory[c] = byCategory[c] || { count: 0, ips: 0 };
      byCategory[c].count++;
      byCategory[c].ips += C.SIZE(n.p);
    }
    return { nets, err: '', totalIPs, byPrefix, byCategory };
  }, [mode, inc, exc, t]);

  const human = (n) => n >= 1e9 ? t('split_tunnel.count_billion', { n: (n / 1e9).toFixed(2) })
    : n >= 1e6 ? t('split_tunnel.count_million', { n: (n / 1e6).toFixed(2) })
    : n >= 1e3 ? t('split_tunnel.count_thousand', { n: (n / 1e3).toFixed(2) })
    : t('split_tunnel.count_ips', { n });

  const rows = nets.map(n => [
    SplitTunnelCore.cidr(n),
    `${IPv4.str(n.a)} - ${IPv4.str(SplitTunnelCore.end(n))}`,
    t(`split_tunnel.cat.${SplitTunnelCore.category(n)}`),
    SplitTunnelCore.SIZE(n.p).toLocaleString(),
  ]);
  const headers = [t('split_tunnel.subnet'), t('split_tunnel.range'), t('split_tunnel.category'), t('split_tunnel.addresses')];
  const copyAll = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');
  const objRows = rows.map(r => ({ subnet: r[0], range: r[1], category: r[2], addresses: r[3] }));

  const append = (setter, value) => setter(v => (v.trim() ? v.trim() + ', ' : '') + value);

  const presets = (setter) => (
    <div className="btn-row" style={{ marginTop: 6 }}>
      <button className="btn btn-ghost btn-sm" onClick={() => append(setter, SplitTunnelCore.RFC1918.join(', '))}>{t('split_tunnel.preset_rfc1918')}</button>
      <button className="btn btn-ghost btn-sm" onClick={() => append(setter, SplitTunnelCore.PUBLIC().join(', '))}>{t('split_tunnel.preset_public')}</button>
      <button className="btn btn-ghost btn-sm" onClick={() => setter('')}>{t('common.clear')}</button>
    </div>
  );

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('split_tunnel.config')}</div>
        <div className="field">
          <label className="label">{t('split_tunnel.mode')}</label>
          <select className="select" value={mode} onChange={e => setMode(e.target.value)}>
            <option value="include">{t('split_tunnel.mode_include')}</option>
            <option value="exclude">{t('split_tunnel.mode_exclude')}</option>
          </select>
          <div className="hint">{t(mode === 'include' ? 'split_tunnel.mode_include_hint' : 'split_tunnel.mode_exclude_hint')}</div>
        </div>
        <div className={mode === 'include' ? 'two-col' : ''}>
          {mode === 'include' && (
            <div className="field">
              <label className="label">{t('split_tunnel.include_label')}</label>
              <textarea className="input" rows={5} value={inc} onChange={e => setInc(e.target.value)} style={{ resize: 'vertical' }} />
              <div className="hint">{t('split_tunnel.list_hint')}</div>
              {presets(setInc)}
            </div>
          )}
          <div className="field">
            <label className="label">{t('split_tunnel.exclude_label')}</label>
            <textarea className="input" rows={5} value={exc} onChange={e => setExc(e.target.value)} style={{ resize: 'vertical' }} />
            <div className="hint">{t('split_tunnel.list_hint')}</div>
            {presets(setExc)}
          </div>
        </div>
        <Err msg={err} />
      </div>

      {!err && nets.length > 0 && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <div className="card-title" style={{ marginBottom: 0 }}>{t('common.results')}</div>
              <span className="badge badge-cyan">{t('split_tunnel.routes_count', { n: nets.length })}</span>
              <span className="badge badge-blue">{human(totalIPs)}</span>
            </div>
            <div className="btn-row">
              <CopyBtn text={copyAll} label="copy_all" id="st-all" />
              <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(objRows, 'split-tunnel.csv')}>CSV</button>
              <button className="btn btn-ghost btn-sm" onClick={() => exportJSON(objRows, 'split-tunnel.json')}>JSON</button>
            </div>
          </div>

          <div className="table-wrap"><table>
            <thead><tr>{headers.map(h => <th key={h} style={{ textAlign: 'left' }}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r[0]}>
                  <td style={{ fontFamily: 'monospace' }}>{r[0]}</td>
                  <td style={{ fontFamily: 'monospace' }}>{r[1]}</td>
                  <td>{r[2]}</td>
                  <td style={{ textAlign: 'right' }}>{r[3]}</td>
                </tr>
              ))}
            </tbody>
          </table></div>

          <div className="two-col" style={{ marginTop: 16 }}>
            <div>
              <div className="result-label">{t('split_tunnel.by_prefix')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {Object.keys(byPrefix).sort((a, b) => a - b).map(p => (
                  <span key={p} className="badge badge-purple">/{p} × {byPrefix[p]}</span>
                ))}
              </div>
            </div>
            <div>
              <div className="result-label">{t('split_tunnel.by_category')}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                {Object.keys(byCategory).sort().map(c => (
                  <span key={c} className="badge badge-green">{t(`split_tunnel.cat.${c}`)} × {byCategory[c].count} ({human(byCategory[c].ips)})</span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.SplitTunnel = SplitTunnel;
