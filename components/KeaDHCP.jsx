const { useState, useEffect, useCallback, useMemo, useRef } = React;

// normalizeMac, macOUI, detectArpFormat, parseArpOutput — from shared.jsx

// ── Kea CSV constants ──────────────────────────────────────────────────
const KEA_CSV_HEADER = 'address,hwaddr,client_id,valid_lifetime,expire,subnet_id,fqdn_fwd,fqdn_rev,hostname,state,user_context,pool_id';

// ── Kea CSV parser ─────────────────────────────────────────────────────
function parseKeaCSV(text) {
  if (!text.trim()) return [];
  const lines = text.trim().split('\n');
  const dataLines = lines[0].trim().startsWith('address,') ? lines.slice(1) : lines;
  return dataLines.map(line => {
    const p = line.split(',');
    if (p.length < 2) return null;
    const address = p[0]?.trim() || '';
    if (!/^\d+\.\d+\.\d+\.\d+$/.test(address)) return null;
    return {
      address,
      hwaddr: normalizeMac(p[1]?.trim() || ''),
      client_id: p[2]?.trim() || '',
      valid_lifetime: parseInt(p[3]) || 86400,
      expire: parseInt(p[4]) || 0,
      subnet_id: parseInt(p[5]) || 1,
      fqdn_fwd: parseInt(p[6]) || 0,
      fqdn_rev: parseInt(p[7]) || 0,
      hostname: p[8]?.trim() || '',
      state: parseInt(p[9]) || 0,
      user_context: p[10]?.trim() || '',
      pool_id: parseInt(p[11]) || 0,
    };
  }).filter(Boolean);
}

function keaRowToLine(row) {
  return [
    row.address, row.hwaddr, row.client_id, row.valid_lifetime, row.expire,
    row.subnet_id, row.fqdn_fwd, row.fqdn_rev, row.hostname, row.state,
    row.user_context, row.pool_id,
  ].join(',');
}

function entriesToKeaCSV(entries) {
  return [KEA_CSV_HEADER, ...entries.map(keaRowToLine)].join('\n') + '\n';
}

function parseArpText(text) {
  if (!text.trim()) return { entries: [], fmt: '' };
  const fmt = detectArpFormat(text);
  const entries = parseArpOutput(text).filter(e => e.mac !== 'INCOMPLETE');
  return { entries, fmt };
}

// Display labels for detected ARP formats (tool-specific strings)
const ARP_FORMAT_NAMES = {
  cisco: 'Cisco IOS',
  bsd: 'BSD / OPNsense / FreeBSD',
  'linux-detail': 'Linux (ip neigh / arp)',
  windows: 'Windows',
  junos: 'JunOS',
};

// ── Date formatter ─────────────────────────────────────────────────────
function fmtUnixTs(ts) {
  if (!ts) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch (_) { return ts; }
}

// ── State badge ────────────────────────────────────────────────────────
function StateBadge({ state, t }) {
  if (state === 0) return <span className="badge badge-green">{t('kea_dhcp.state_active')}</span>;
  if (state === 1) return <span className="badge badge-yellow">{t('kea_dhcp.state_expired')}</span>;
  if (state === 2) return <span className="badge badge-red">{t('kea_dhcp.state_declined')}</span>;
  return <span className="badge">{state}</span>;
}

// ── Sample data ────────────────────────────────────────────────────────
const SAMPLE_LEASE_CSV = `address,hwaddr,client_id,valid_lifetime,expire,subnet_id,fqdn_fwd,fqdn_rev,hostname,state,user_context,pool_id
192.168.1.80,00:4b:12:00:00:01,,43200,1779745206,1,0,0,workstation-1,0,,0
192.168.1.52,f4:02:28:00:00:02,,43200,1779745308,1,0,0,phone-1,0,,0
192.168.1.66,68:a3:c4:00:00:03,,43200,1779745309,1,0,0,laptop-1,0,,0
192.168.1.66,,,86400,1779788518,1,0,0,,1,,0
192.168.1.10,bc:bb:58:00:00:04,,86400,1779788900,1,0,0,access-point-1,0,,0`;

const SAMPLE_ARP = `? (192.168.1.74) at bc:bb:58:00:00:04 on igc0 expires in 1174 seconds [ethernet]
server-1.local (192.168.1.44) at 64:62:66:00:00:05 on igc0 expires in 1198 seconds [ethernet]
? (192.168.1.52) at f4:02:28:00:00:02 on igc0 expires in 800 seconds [ethernet]
nas-1.local (192.168.1.20) at 00:11:32:00:00:06 on igc0 expires in 600 seconds [ethernet]`;

// ── Unix timestamp ↔ datetime-local helpers ────────────────────────────
function tsToDatetimeLocal(ts) {
  if (!ts) return '';
  const d = new Date(ts * 1000);
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function datetimeLocalToTs(s) {
  return s ? Math.floor(new Date(s).getTime() / 1000) : 0;
}

// ── Lease Viewer tab ───────────────────────────────────────────────────
function LeaseViewer({ t }) {
  const [csv, setCsv] = usePersistentState('kea-dhcp:lease-csv', '');
  const [entries, setEntries] = useState(() => parseKeaCSV(csv));
  const [filter, setFilter] = useState('');
  const [editingEntry, setEditingEntry] = useState(null); // { ref, form }
  const [dupMsg, setDupMsg] = useState('');
  const [copied, copy] = useCopy();

  // Keep csv textarea in sync whenever entries are mutated from the table
  const applyEntries = useCallback((next) => {
    setEntries(next);
    setCsv(next.length ? entriesToKeaCSV(next) : '');
  }, []);

  const handleCsvChange = useCallback((newCsv) => {
    setCsv(newCsv);
    setEntries(parseKeaCSV(newCsv));
    setDupMsg('');
  }, []);

  const handleDelete = useCallback((entry) => {
    const idx = entries.indexOf(entry);
    if (idx === -1) return;
    applyEntries(entries.filter((_, j) => j !== idx));
  }, [entries, applyEntries]);

  const handleEditOpen = useCallback((entry) => {
    setEditingEntry({
      ref: entry,
      form: {
        address: entry.address,
        hwaddr: entry.hwaddr,
        hostname: entry.hostname,
        subnet_id: String(entry.subnet_id),
        expire: entry.expire,
      },
    });
  }, []);

  const handleSaveEdit = useCallback(() => {
    if (!editingEntry) return;
    const { ref, form } = editingEntry;
    applyEntries(entries.map(e => e !== ref ? e : {
      ...e,
      address: form.address.trim(),
      hwaddr: normalizeMac(form.hwaddr.trim()),
      hostname: form.hostname.trim(),
      subnet_id: parseInt(form.subnet_id) || 1,
      expire: form.expire,
    }));
    setEditingEntry(null);
  }, [editingEntry, entries, applyEntries]);

  const updateForm = useCallback((field, value) => {
    setEditingEntry(prev => prev ? { ...prev, form: { ...prev.form, [field]: value } } : prev);
  }, []);

  const handleRemoveDups = useCallback(() => {
    const seen = new Map();
    const result = [];
    for (const e of entries) {
      if (!seen.has(e.address)) {
        seen.set(e.address, result.length);
        result.push(e);
      } else {
        const idx = seen.get(e.address);
        const existing = result[idx];
        if (e.state < existing.state || (e.state === existing.state && e.expire > existing.expire)) {
          result[idx] = e;
        }
      }
    }
    const removed = entries.length - result.length;
    applyEntries(result);
    setDupMsg(removed > 0 ? t('kea_dhcp.dup_removed', { n: removed }) : t('kea_dhcp.no_dups'));
  }, [entries, applyEntries, t]);

  const handleExportKea = useCallback(() => {
    const blob = new Blob([entriesToKeaCSV(entries)], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'kea-leases4.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [entries]);

  const stats = useMemo(() => {
    const active = entries.filter(e => e.state === 0).length;
    const expired = entries.filter(e => e.state === 1).length;
    const declined = entries.filter(e => e.state === 2).length;
    const uniqueMacs = new Set(entries.filter(e => e.hwaddr).map(e => e.hwaddr)).size;
    const dupIPs = entries.length - new Set(entries.map(e => e.address)).size;
    return { active, expired, declined, uniqueMacs, dupIPs };
  }, [entries]);

  const filtered = useMemo(() => {
    const q = filter.toLowerCase();
    if (!q) return entries;
    return entries.filter(e =>
      e.address.includes(q) ||
      e.hwaddr.toLowerCase().includes(q) ||
      e.hostname.toLowerCase().includes(q) ||
      macOUI(e.hwaddr).toLowerCase().includes(q)
    );
  }, [entries, filter]);

  const TD = { padding: '6px 10px' };

  return (
    <div>
      {/* ── Edit modal ─────────────────────────────────────────────── */}
      {editingEntry && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) setEditingEntry(null); }}
        >
          <div className="card" style={{ width: 500, maxWidth: '92vw', margin: 0 }}>
            <div className="card-title">{t('kea_dhcp.edit_title')}</div>
            <div className="two-col">
              <div className="field">
                <label className="label">{t('common.ip', 'IP')}</label>
                <input className="input" style={{ fontFamily: 'monospace' }} value={editingEntry.form.address}
                  onChange={e => updateForm('address', e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('common.mac', 'MAC')}</label>
                <input className="input" style={{ fontFamily: 'monospace' }} value={editingEntry.form.hwaddr}
                  onChange={e => updateForm('hwaddr', e.target.value)} />
              </div>
            </div>
            <div className="field">
              <label className="label">{t('kea_dhcp.col_hostname')}</label>
              <input className="input" value={editingEntry.form.hostname}
                onChange={e => updateForm('hostname', e.target.value)} />
            </div>
            <div className="two-col">
              <div className="field">
                <label className="label">{t('kea_dhcp.col_subnet')} ID</label>
                <input className="input" type="number" min="1" value={editingEntry.form.subnet_id}
                  onChange={e => updateForm('subnet_id', e.target.value)} />
                <span className="hint">{t('kea_dhcp.edit_subnet_hint')}</span>
              </div>
              <div className="field">
                <label className="label">{t('kea_dhcp.col_expires')}</label>
                <input className="input" type="datetime-local" value={tsToDatetimeLocal(editingEntry.form.expire)}
                  onChange={e => updateForm('expire', datetimeLocalToTs(e.target.value))} />
              </div>
            </div>
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button className="btn btn-primary btn-sm" onClick={handleSaveEdit}>{t('kea_dhcp.edit_save')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setEditingEntry(null)}>{t('kea_dhcp.edit_cancel')}</button>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-title">{t('kea_dhcp.viewer_title')}</div>
        <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>{t('kea_dhcp.viewer_subtitle')}</p>
        <div className="field">
          <label className="label">{t('kea_dhcp.viewer_input_label')}</label>
          <textarea
            className="input"
            style={{ minHeight: 140, fontFamily: 'monospace', fontSize: 12 }}
            placeholder={t('kea_dhcp.viewer_placeholder')}
            value={csv}
            onChange={e => handleCsvChange(e.target.value)}
          />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost btn-sm" onClick={() => handleCsvChange(SAMPLE_LEASE_CSV)}>{t('common.load_sample')}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { handleCsvChange(''); setFilter(''); setDupMsg(''); }}>{t('common.clear')}</button>
          {entries.length > 0 && <>
            <button className="btn btn-ghost btn-sm" onClick={handleExportKea}>{t('kea_dhcp.btn_export_kea')}</button>
            <button className="btn btn-ghost btn-sm" onClick={() => copy(entriesToKeaCSV(entries), 'kea-csv')}>{copied === 'kea-csv' ? '✓' : t('common.copy') + ' CSV'}</button>
          </>}
        </div>
      </div>

      {entries.length > 0 && (
        <>
          <div className="card">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
              <div className="card-title" style={{ margin: 0 }}>{t('kea_dhcp.summary_title')}</div>
              <button className="btn btn-ghost btn-sm" onClick={handleRemoveDups}>{t('kea_dhcp.btn_remove_dups')}</button>
            </div>
            <div className="result-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(140px,1fr))' }}>
              <ResultItem label={t('kea_dhcp.stat_total')} value={entries.length} />
              <ResultItem label={t('kea_dhcp.stat_active')} value={<span style={{ color: 'var(--green)' }}>{stats.active}</span>} />
              {stats.expired > 0 && <ResultItem label={t('kea_dhcp.stat_expired')} value={<span style={{ color: 'var(--yellow)' }}>{stats.expired}</span>} />}
              {stats.declined > 0 && <ResultItem label={t('kea_dhcp.stat_declined')} value={<span style={{ color: 'var(--red)' }}>{stats.declined}</span>} />}
              <ResultItem label={t('kea_dhcp.stat_unique_macs')} value={stats.uniqueMacs} />
              {stats.dupIPs > 0 && <ResultItem label={t('kea_dhcp.stat_dup_ips')} value={<span style={{ color: 'var(--yellow)' }}>{stats.dupIPs}</span>} />}
            </div>
            {dupMsg && (
              <div style={{ marginTop: 10, padding: '8px 12px', background: 'rgba(6,182,212,0.1)', border: '1px solid var(--cyan)', borderRadius: 6, fontSize: 13, color: 'var(--cyan)' }}>
                {dupMsg}
              </div>
            )}
          </div>

          <div className="card">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>{t('kea_dhcp.viewer_table_title')}</div>
              <input
                className="input"
                style={{ flex: 1, maxWidth: 260 }}
                placeholder={t('common.filter') + '…'}
                value={filter}
                onChange={e => setFilter(e.target.value)}
              />
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {[
                      t('common.ip', 'IP'), t('common.mac', 'MAC'), t('kea_dhcp.col_hostname'), t('kea_dhcp.col_vendor'),
                      t('kea_dhcp.col_state'), t('kea_dhcp.col_subnet'), t('kea_dhcp.col_expires'), '',
                    ].map((h, i) => (
                      <th key={i} style={{ textAlign: i === 7 ? 'right' : 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: e.state === 1 ? 'rgba(234,179,8,0.05)' : e.state === 2 ? 'rgba(239,68,68,0.05)' : 'transparent' }}>
                      <td style={{ ...TD, fontFamily: 'monospace' }}>{e.address}</td>
                      <td style={{ ...TD, fontFamily: 'monospace' }}>{e.hwaddr || '—'}</td>
                      <td style={TD}>{e.hostname || '—'}</td>
                      <td style={{ ...TD, color: 'var(--muted)', fontSize: 12 }}>{macOUI(e.hwaddr) || '—'}</td>
                      <td style={TD}><StateBadge state={e.state} t={t} /></td>
                      <td style={{ ...TD, textAlign: 'center' }}>{e.subnet_id}</td>
                      <td style={{ ...TD, fontSize: 12, whiteSpace: 'nowrap', color: 'var(--muted)' }}>{fmtUnixTs(e.expire)}</td>
                      <td style={{ ...TD, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <button className="btn btn-ghost btn-sm" style={{ marginRight: 4 }} onClick={() => handleEditOpen(e)}>{t('kea_dhcp.btn_edit')}</button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleDelete(e)}>{t('kea_dhcp.btn_delete')}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filtered.length === 0 && (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--muted)' }}>{t('kea_dhcp.no_results')}</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── ARP → Lease tab ────────────────────────────────────────────────────
function ArpConverter({ t }) {
  const [arpRaw, setArpRaw] = usePersistentState('kea-dhcp:arp-raw', '');
  const [subnetId, setSubnetId] = usePersistentState('kea-dhcp:subnet-id', '1');
  const [validLifetime, setValidLifetime] = usePersistentState('kea-dhcp:valid-lifetime', '86400');
  const [copied, copy] = useCopy();

  const { entries: arpEntries, fmt } = useMemo(() => parseArpText(arpRaw), [arpRaw]);

  const keaRows = useMemo(() => {
    if (!arpEntries.length) return [];
    const expireTs = Math.floor(Date.now() / 1000) + (parseInt(validLifetime) || 86400);
    return arpEntries.map(e => ({
      address: e.ip,
      hwaddr: e.mac.toLowerCase(),
      client_id: '',
      valid_lifetime: parseInt(validLifetime) || 86400,
      expire: expireTs,
      subnet_id: parseInt(subnetId) || 1,
      fqdn_fwd: 0,
      fqdn_rev: 0,
      hostname: '',
      state: 0,
      user_context: '',
      pool_id: 0,
    }));
  }, [arpEntries, subnetId, validLifetime]);

  const csvOutput = useMemo(() => entriesToKeaCSV(keaRows), [keaRows]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([csvOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'kea-leases4.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [csvOutput]);

  return (
    <div>
      <div className="card">
        <div className="card-title">{t('kea_dhcp.conv_title')}</div>
        <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>{t('kea_dhcp.conv_subtitle')}</p>
        <div className="field">
          <label className="label">{t('kea_dhcp.conv_arp_label')}</label>
          <textarea
            className="input"
            style={{ minHeight: 140, fontFamily: 'monospace', fontSize: 12 }}
            placeholder={t('kea_dhcp.conv_arp_placeholder')}
            value={arpRaw}
            onChange={e => setArpRaw(e.target.value)}
          />
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost btn-sm" onClick={() => setArpRaw(SAMPLE_ARP)}>{t('common.load_sample')}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setArpRaw('')}>{t('common.clear')}</button>
          {fmt && (
            <span style={{ fontSize: 12, color: 'var(--muted)', alignSelf: 'center' }}>
              {t('kea_dhcp.conv_detected_format')}: <strong style={{ color: 'var(--cyan)' }}>{ARP_FORMAT_NAMES[fmt] || fmt}</strong>
            </span>
          )}
        </div>
        <div className="two-col" style={{ marginTop: 16 }}>
          <div className="field">
            <label className="label">{t('kea_dhcp.conv_subnet_id')}</label>
            <input className="input" type="number" min="1" value={subnetId} onChange={e => setSubnetId(e.target.value)} />
          </div>
          <div className="field">
            <label className="label">{t('kea_dhcp.conv_valid_lifetime')}</label>
            <input className="input" type="number" min="60" value={validLifetime} onChange={e => setValidLifetime(e.target.value)} />
            <span className="hint">{t('kea_dhcp.conv_lifetime_hint')}</span>
          </div>
        </div>
      </div>

      {keaRows.length > 0 && (
        <>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>{t('kea_dhcp.conv_preview_title')} ({keaRows.length})</div>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {[t('common.ip', 'IP'), t('common.mac', 'MAC'), t('kea_dhcp.col_vendor'), t('kea_dhcp.col_subnet'), t('kea_dhcp.col_lifetime')].map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {keaRows.map((r, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.address}</td>
                      <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{r.hwaddr}</td>
                      <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12 }}>{macOUI(r.hwaddr) || '—'}</td>
                      <td style={{ padding: '6px 10px', textAlign: 'center' }}>{r.subnet_id}</td>
                      <td style={{ padding: '6px 10px' }}>{r.valid_lifetime}s</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div className="card-title" style={{ margin: 0 }}>{t('kea_dhcp.conv_output_label')}</div>
              <div className="btn-row" style={{ margin: 0 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => copy(csvOutput, 'kea-csv')}>{copied === 'kea-csv' ? '✓' : t('common.copy')}</button>
                <button className="btn btn-primary btn-sm" onClick={handleDownload}>{t('kea_dhcp.conv_download')}</button>
              </div>
            </div>
            <textarea
              readOnly
              className="input"
              style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 11 }}
              value={csvOutput}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── ARP vs Lease Diff tab ──────────────────────────────────────────────
function ArpLeaseDiff({ t }) {
  const [diffArp, setDiffArp] = usePersistentState('kea-dhcp:diff-arp', '');
  const [diffLease, setDiffLease] = usePersistentState('kea-dhcp:diff-lease', '');
  const [subnetId, setSubnetId] = usePersistentState('kea-dhcp:diff-subnet-id', '1');
  const [validLifetime, setValidLifetime] = usePersistentState('kea-dhcp:diff-valid-lifetime', '86400');
  const [copied, copy] = useCopy();

  const { entries: arpEntries, fmt } = useMemo(() => parseArpText(diffArp), [diffArp]);
  const leaseEntries = useMemo(() => parseKeaCSV(diffLease), [diffLease]);

  const diff = useMemo(() => {
    if (!arpEntries.length && !leaseEntries.length) return null;
    const leaseIPs = new Set(leaseEntries.map(e => e.address));
    const arpIPs = new Set(arpEntries.map(e => e.ip));

    const missing = arpEntries.filter(e => !leaseIPs.has(e.ip));
    const stale = leaseEntries.filter(e => e.state === 0 && !arpIPs.has(e.address));
    return { missing, stale };
  }, [arpEntries, leaseEntries]);

  const missingKeaCSV = useMemo(() => {
    if (!diff?.missing?.length) return '';
    const expireTs = Math.floor(Date.now() / 1000) + (parseInt(validLifetime) || 86400);
    const rows = diff.missing.map(e => ({
      address: e.ip,
      hwaddr: e.mac.toLowerCase(),
      client_id: '',
      valid_lifetime: parseInt(validLifetime) || 86400,
      expire: expireTs,
      subnet_id: parseInt(subnetId) || 1,
      fqdn_fwd: 0,
      fqdn_rev: 0,
      hostname: '',
      state: 0,
      user_context: '',
      pool_id: 0,
    }));
    return entriesToKeaCSV(rows);
  }, [diff, subnetId, validLifetime]);

  // Add a single ARP entry into the lease CSV (makes the diff row disappear)
  const handleAddToLease = useCallback((arpEntry) => {
    const expireTs = Math.floor(Date.now() / 1000) + (parseInt(validLifetime) || 86400);
    const newRow = {
      address: arpEntry.ip,
      hwaddr: arpEntry.mac.toLowerCase(),
      client_id: '',
      valid_lifetime: parseInt(validLifetime) || 86400,
      expire: expireTs,
      subnet_id: parseInt(subnetId) || 1,
      fqdn_fwd: 0, fqdn_rev: 0,
      hostname: '',
      state: 0,
      user_context: '',
      pool_id: 0,
    };
    const current = parseKeaCSV(diffLease);
    const next = [...current, newRow];
    setDiffLease(entriesToKeaCSV(next));
  }, [diffLease, subnetId, validLifetime]);

  // Remove a lease entry from the lease CSV by IP (makes the diff row disappear)
  const handleRemoveFromLease = useCallback((leaseEntry) => {
    const current = parseKeaCSV(diffLease);
    const next = current.filter(e => e.address !== leaseEntry.address);
    setDiffLease(next.length ? entriesToKeaCSV(next) : '');
  }, [diffLease]);

  const handleDownloadMissing = useCallback(() => {
    const blob = new Blob([missingKeaCSV], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'kea-missing-leases.csv';
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
  }, [missingKeaCSV]);

  return (
    <div>
      <div className="card">
        <div className="card-title">{t('kea_dhcp.diff_title')}</div>
        <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>{t('kea_dhcp.diff_subtitle')}</p>
        <div className="two-col">
          <div className="field">
            <label className="label">{t('kea_dhcp.diff_arp_label')}</label>
            <textarea
              className="input"
              style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12 }}
              placeholder={t('kea_dhcp.diff_arp_placeholder')}
              value={diffArp}
              onChange={e => setDiffArp(e.target.value)}
            />
            {fmt && (
              <span className="hint">{t('kea_dhcp.conv_detected_format')}: <strong>{ARP_FORMAT_NAMES[fmt] || fmt}</strong></span>
            )}
          </div>
          <div className="field">
            <label className="label">{t('kea_dhcp.diff_lease_label')}</label>
            <textarea
              className="input"
              style={{ minHeight: 160, fontFamily: 'monospace', fontSize: 12 }}
              placeholder={t('kea_dhcp.diff_lease_placeholder')}
              value={diffLease}
              onChange={e => setDiffLease(e.target.value)}
            />
          </div>
        </div>
        <div className="btn-row">
          <button className="btn btn-ghost btn-sm" onClick={() => { setDiffArp(SAMPLE_ARP); setDiffLease(SAMPLE_LEASE_CSV); }}>{t('common.load_sample')}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { setDiffArp(''); setDiffLease(''); }}>{t('common.clear')}</button>
        </div>
      </div>

      {diff && (
        <>
          <div className="card">
            <div className="result-grid" style={{ gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', marginBottom: 0 }}>
              <ResultItem label={t('kea_dhcp.stat_arp_entries')} value={arpEntries.length} />
              <ResultItem label={t('kea_dhcp.stat_lease_entries')} value={leaseEntries.length} />
              <ResultItem label={t('kea_dhcp.diff_missing_count')} value={
                <span style={{ color: diff.missing.length > 0 ? 'var(--red)' : 'var(--green)' }}>{diff.missing.length}</span>
              } />
              <ResultItem label={t('kea_dhcp.diff_stale_count')} value={
                <span style={{ color: diff.stale.length > 0 ? 'var(--yellow)' : 'var(--green)' }}>{diff.stale.length}</span>
              } />
            </div>
          </div>

          {diff.missing.length > 0 ? (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
                <div>
                  <div className="card-title" style={{ margin: 0 }}>{t('kea_dhcp.diff_missing_title')}</div>
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 0 0' }}>{t('kea_dhcp.diff_missing_hint')}</p>
                </div>
              </div>
              <div style={{ overflowX: 'auto', marginBottom: 16 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {[t('common.ip', 'IP'), t('common.mac', 'MAC'), t('kea_dhcp.col_vendor'), t('kea_dhcp.col_iface'), ''].map((h, i) => (
                        <th key={i} style={{ textAlign: i === 4 ? 'right' : 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {diff.missing.map((e, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: 'rgba(239,68,68,0.05)' }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{e.ip}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{e.mac}</td>
                        <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12 }}>{macOUI(e.mac) || '—'}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 12 }}>{e.iface || '—'}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                          <button className="btn btn-primary btn-sm" onClick={() => handleAddToLease(e)}>{t('kea_dhcp.btn_add_to_lease')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{t('kea_dhcp.diff_generate_hint')}</p>
                <div className="two-col" style={{ marginBottom: 12 }}>
                  <div className="field">
                    <label className="label">{t('kea_dhcp.conv_subnet_id')}</label>
                    <input className="input" type="number" min="1" value={subnetId} onChange={e => setSubnetId(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('kea_dhcp.conv_valid_lifetime')}</label>
                    <input className="input" type="number" min="60" value={validLifetime} onChange={e => setValidLifetime(e.target.value)} />
                  </div>
                </div>
                <div className="btn-row">
                  <button className="btn btn-ghost btn-sm" onClick={() => copy(missingKeaCSV, 'diff-csv')}>{copied === 'diff-csv' ? '✓' : t('kea_dhcp.diff_copy_csv')}</button>
                  <button className="btn btn-primary btn-sm" onClick={handleDownloadMissing}>{t('kea_dhcp.diff_download_missing')}</button>
                </div>
              </div>
            </div>
          ) : (arpEntries.length > 0 && leaseEntries.length > 0) && (
            <div className="card">
              <div style={{ padding: '12px 0', color: 'var(--green)', fontWeight: 600 }}>{t('kea_dhcp.diff_no_missing')}</div>
            </div>
          )}

          {diff.stale.length > 0 && (
            <div className="card">
              <div className="card-title">{t('kea_dhcp.diff_stale_title')}</div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>{t('kea_dhcp.diff_stale_hint')}</p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {[t('common.ip', 'IP'), t('common.mac', 'MAC'), t('kea_dhcp.col_hostname'), t('kea_dhcp.col_vendor'), ''].map((h, i) => (
                        <th key={i} style={{ textAlign: i === 4 ? 'right' : 'left', padding: '6px 10px', color: 'var(--muted)', fontWeight: 600 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {diff.stale.map((e, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)', background: 'rgba(234,179,8,0.05)' }}>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{e.address}</td>
                        <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{e.hwaddr || '—'}</td>
                        <td style={{ padding: '6px 10px' }}>{e.hostname || '—'}</td>
                        <td style={{ padding: '6px 10px', color: 'var(--muted)', fontSize: 12 }}>{macOUI(e.hwaddr) || '—'}</td>
                        <td style={{ padding: '6px 10px', textAlign: 'right' }}>
                          <button className="btn btn-danger btn-sm" onClick={() => handleRemoveFromLease(e)}>{t('kea_dhcp.btn_remove_from_lease')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────
function KeaDHCP({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [tab, setTab] = usePersistentState('kea-dhcp:tab', initialData?.tab ?? 'viewer');
  const skipNavReport = useRef(false);

  // apply-down: sidebar/Ctrl+K/Help nav → inner tab
  useEffect(() => {
    if (!initialData?.tab || initialData.tab === tab) return;
    skipNavReport.current = true;
    setTab(initialData.tab);
  }, [initialData]);

  // report-up: tab change → sidebar highlight
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ tab });
  }, [tab]);

  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'kea-dhcp', tab });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, onShare]);

  const TABS = [
    { id: 'viewer', label: t('kea_dhcp.tab_viewer') },
    { id: 'converter', label: t('kea_dhcp.tab_converter') },
    { id: 'diff', label: t('kea_dhcp.tab_diff') },
  ];

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('kea_dhcp.title')}</div>
        <p style={{ color: 'var(--muted)', marginBottom: 16, fontSize: 13 }}>{t('kea_dhcp.subtitle')}</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map(tb => (
            <button
              key={tb.id}
              className={tab === tb.id ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
              onClick={() => setTab(tb.id)}
            >{tb.label}</button>
          ))}
        </div>
      </div>

      {tab === 'viewer' && <LeaseViewer t={t} />}
      {tab === 'converter' && <ArpConverter t={t} />}
      {tab === 'diff' && <ArpLeaseDiff t={t} />}
    </div>
  );
}

window.KeaDHCP = KeaDHCP;
