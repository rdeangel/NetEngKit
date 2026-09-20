const { useState, useEffect, useCallback, useMemo } = React;

// normalizeMac, macOUI, detectArpFormat, parseArpOutput — from shared.jsx
const FORMAT_NAMES = { cisco: 'Cisco IOS', bsd: 'BSD / Linux (arp -a)', 'linux-detail': 'Linux (ip neigh / arp)', windows: 'Windows', junos: 'JunOS' };

// ── Flags ─────────────────────────────────────────────────────────────
function buildFlags(entries) {
  const macToIPs = {};
  const ipToMACs = {};
  const incomplete = new Set();
  for (const e of entries) {
    const m = e.mac.replace(/:/g, '');
    if (!macToIPs[m]) macToIPs[m] = new Set();
    macToIPs[m].add(e.ip);
    if (!ipToMACs[e.ip]) ipToMACs[e.ip] = new Set();
    ipToMACs[e.ip].add(m);
    if (e.mac === 'INCOMPLETE' || e.mac === '' || e.mac === '-') incomplete.add(e.ip);
  }
  const dupMacs = new Set();
  for (const [mac, ips] of Object.entries(macToIPs)) {
    if (ips.size > 1) dupMacs.add(mac);
  }
  return { dupMacs, incomplete, macToIPs };
}

// ── Component ─────────────────────────────────────────────────────────
function ARPTableParser({ initialData, onShare }) {
  const { t } = useTranslation();
  const [raw, setRaw] = usePersistentState('arp-parser:raw', initialData?.raw ?? '');
  const [filterText, setFilterText] = useState('');

  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'arp-parser', raw });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [raw, onShare]);

  const { entries, fmt } = useMemo(() => {
    if (!raw.trim()) return { entries: [], fmt: '' };
    const fmt = detectArpFormat(raw);
    const entries = parseArpOutput(raw);
    return { entries, fmt };
  }, [raw]);

  const { dupMacs, incomplete } = useMemo(() => buildFlags(entries), [entries]);

  const filtered = useMemo(() => {
    const q = filterText.toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      e.ip.includes(q) || e.mac.toLowerCase().includes(q) ||
      (e.iface || '').toLowerCase().includes(q) ||
      macOUI(e.mac).toLowerCase().includes(q)
    );
  }, [entries, filterText]);

  const dupCount = useMemo(() => {
    const macs = new Set(entries.filter(e => dupMacs.has(e.mac.replace(/:/g, ''))).map(e => e.mac.replace(/:/g, '')));
    return macs.size;
  }, [entries, dupMacs]);

  const incompleteCount = entries.filter(e => incomplete.has(e.ip)).length;

  const handleExportCSV = useCallback(() => {
    const rows = [['IP', 'MAC', 'Vendor', 'Interface', 'Age', 'Flags']];
    for (const e of entries) {
      const flags = [];
      if (dupMacs.has(e.mac.replace(/:/g, ''))) flags.push('DUP_MAC');
      if (incomplete.has(e.ip)) flags.push('INCOMPLETE');
      rows.push([e.ip, e.mac, macOUI(e.mac), e.iface, e.age ?? '', flags.join('+')]);
    }
    exportCSV(rows, 'arp-table.csv');
  }, [entries, dupMacs, incomplete]);

  const handleExportJSON = useCallback(() => {
    const data = entries.map(e => ({
      ip: e.ip, mac: e.mac, vendor: macOUI(e.mac), iface: e.iface, age: e.age,
      flags: {
        duplicate_mac: dupMacs.has(e.mac.replace(/:/g, '')),
        incomplete: incomplete.has(e.ip),
      }
    }));
    exportJSON(data, 'arp-table.json');
  }, [entries, dupMacs, incomplete]);

  const SAMPLE = `Protocol  Address          Age (min)  Hardware Addr   Type   Interface
Internet  192.168.1.1             -   c47d.4f12.3456  ARPA   Gi0/0/0
Internet  192.168.1.10           12   0014.d1ab.cdef  ARPA   Gi0/0/0
Internet  192.168.1.20            5   0014.d1ab.cdef  ARPA   Gi0/0/1
Internet  192.168.1.30            -   Incomplete      ARPA   Gi0/0/0`;

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('arp_parser.title')}</div>
        <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>{t('arp_parser.subtitle')}</p>
        <div className="field">
          <label className="label">{t('arp_parser.input_label')}</label>
          <textarea
            className="input"
            style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12 }}
            placeholder={t('arp_parser.placeholder')}
            value={raw}
            onChange={e => setRaw(e.target.value)}
          />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost btn-sm" onClick={() => setRaw(SAMPLE)}>{t('arp_parser.load_sample')}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setRaw(''); setFilterText(''); }}>{t('common.clear')}</button>
          {entries.length > 0 && <>
            <button className="btn btn-ghost btn-sm" onClick={handleExportCSV}>{t('common.export')} CSV</button>
            <button className="btn btn-ghost btn-sm" onClick={handleExportJSON}>{t('common.export')} JSON</button>
          </>}
        </div>
      </div>

      {entries.length > 0 && (
        <>
          <div className="card">
            <div className="card-title">{t('arp_parser.summary_title')}</div>
            <div className="result-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
              <ResultItem label={t('arp_parser.stat_total')} value={entries.length} />
              <ResultItem label={t('arp_parser.stat_format')} value={FORMAT_NAMES[fmt] || fmt} />
              <ResultItem label={t('arp_parser.stat_unique_macs')} value={new Set(entries.map(e => e.mac)).size} />
              {dupCount > 0 && <ResultItem label={t('arp_parser.stat_dup_macs')} value={<span style={{ color: 'var(--red)' }}>{dupCount}</span>} />}
              {incompleteCount > 0 && <ResultItem label={t('arp_parser.stat_incomplete')} value={<span style={{ color: 'var(--yellow)' }}>{incompleteCount}</span>} />}
            </div>

            {dupCount > 0 && (
              <div style={{ marginTop: 12, padding: '10px 14px', background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', borderRadius: 8, fontSize: 13 }}>
                <strong style={{ color: 'var(--red)' }}>⚠ {t('arp_parser.warn_dup_macs')}</strong>
                <ul style={{ margin: '6px 0 0 0', paddingLeft: 18, color: 'var(--fg)' }}>
                  {[...new Set(entries.filter(e => dupMacs.has(e.mac.replace(/:/g, ''))).map(e => e.mac))].map(mac => {
                    const ips = entries.filter(e => e.mac === mac).map(e => e.ip);
                    return <li key={mac}><code>{mac}</code> → {ips.join(', ')}</li>;
                  })}
                </ul>
              </div>
            )}

            {incompleteCount > 0 && (
              <div style={{ marginTop: 10, padding: '10px 14px', background: 'rgba(234,179,8,0.12)', border: '1px solid var(--yellow)', borderRadius: 8, fontSize: 13 }}>
                <strong style={{ color: 'var(--yellow)' }}>⚠ {t('arp_parser.warn_incomplete')}</strong>
                <div style={{ marginTop: 4, color: 'var(--muted)' }}>
                  {entries.filter(e => incomplete.has(e.ip)).map(e => e.ip).join(', ')}
                </div>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>{t('arp_parser.table_title')}</div>
              <input
                className="input"
                style={{ flex: 1, maxWidth: 260 }}
                placeholder={t('common.filter') + '…'}
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
              />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {['IP', 'MAC', t('arp_parser.col_vendor'), t('arp_parser.col_iface'), t('arp_parser.col_age'), t('arp_parser.col_flags')].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e, i) => {
                    const isDup = dupMacs.has(e.mac.replace(/:/g, ''));
                    const isInc = incomplete.has(e.ip);
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: isDup ? 'rgba(239,68,68,0.06)' : isInc ? 'rgba(234,179,8,0.06)' : 'transparent' }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{e.ip}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{e.mac}</td>
                        <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12 }}>{macOUI(e.mac) || '—'}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{e.iface || '—'}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>{e.age != null ? e.age + 'm' : '—'}</td>
                        <td style={{ padding: '6px 10px' }}>
                          {isDup && <span className="badge badge-red" style={{ marginRight: 4 }}>{t('arp_parser.flag_dup')}</span>}
                          {isInc && <span className="badge badge-yellow">{t('arp_parser.flag_incomplete')}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filtered.length === 0 && <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>{t('arp_parser.no_results')}</div>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

window.ARPTableParser = ARPTableParser;
