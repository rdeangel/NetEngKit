const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── Default record factory ───────────────────────────────────
const DEFAULT_RECORD = () => ({
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  name: '@',
  ttl: '',
  type: 'A',
  value: '',
  mxPref: '10',
  srvPri: '0',
  srvWeight: '5',
  srvPort: '',
  target: '',
});

// ─── Helpers ──────────────────────────────────────────────────
function isValidIPv4(s) {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(s) && s.split('.').every(o => parseInt(o) <= 255);
}

function isValidIPv6(s) {
  // Basic IPv6 format check
  if (!s) return false;
  return /^[0-9a-fA-F:]+$/.test(s) && s.includes(':') && !/:{3}/.test(s);
}

function isHostname(s) {
  if (!s) return false;
  return /^[a-zA-Z0-9@]([a-zA-Z0-9\-_.]*[a-zA-Z0-9.])?\.?$/.test(s);
}

function looksLikeFQDN(s) {
  return s && s.endsWith('.');
}

function splitTxtChunks(text) {
  // RFC 1035: TXT strings max 255 chars each
  if (text.length <= 255) return `"${text}"`;
  const chunks = [];
  for (let i = 0; i < text.length; i += 255) {
    chunks.push(`"${text.slice(i, i + 255)}"`);
  }
  return chunks.join(' ');
}

// Convert admin@example.com → admin.example.com. (RFC 1035 RNAME encoding)
function convertRname(rname) {
  if (!rname) return rname;
  if (rname.includes('@')) {
    // Replace only the first '@' with '.'
    const idx = rname.indexOf('@');
    const local = rname.slice(0, idx).replace(/\./g, '\\.');
    const domain = rname.slice(idx + 1);
    const result = `${local}.${domain}`;
    return looksLikeFQDN(result) ? result : result + '.';
  }
  return rname;
}

// Today-based serial YYYYMMDDnn
function generateSerial(currentSerial) {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const datePrefix = `${yyyy}${mm}${dd}`;

  const cur = String(currentSerial || '');
  if (cur.startsWith(datePrefix) && cur.length === 10) {
    const nn = parseInt(cur.slice(8)) + 1;
    return `${datePrefix}${String(nn).padStart(2, '0')}`;
  }
  return `${datePrefix}01`;
}

// Pad / align zone file columns
function buildZoneFile(origin, ttl, mname, rname, serial, refresh, retry, expire, minimum, records) {
  const lines = [];

  if (origin) lines.push(`$ORIGIN ${origin}`);
  if (ttl) lines.push(`$TTL    ${ttl}`);
  lines.push('');

  // SOA record — multi-line with parentheses
  const rnameEncoded = convertRname(rname) || 'hostmaster.example.com.';
  const mnameFqdn = mname || 'ns1.example.com.';
  lines.push(`@       IN      SOA     ${mnameFqdn} ${rnameEncoded} (`);
  lines.push(`                        ${(serial || '2024010101').padEnd(12)} ; serial`);
  lines.push(`                        ${(refresh || '3600').padEnd(12)} ; refresh`);
  lines.push(`                        ${(retry || '900').padEnd(12)} ; retry`);
  lines.push(`                        ${(expire || '604800').padEnd(12)} ; expire`);
  lines.push(`                        ${(minimum || '300').padEnd(12)} ) ; minimum/negative TTL`);
  lines.push('');

  // Resource records
  for (const rec of records) {
    const name = (rec.name || '@').padEnd(16);
    const ttlPart = rec.ttl ? String(rec.ttl).padEnd(8) : '        ';
    const prefix = `${name}${ttlPart}IN      ${rec.type.padEnd(8)}`;

    let rdata = '';
    switch (rec.type) {
      case 'A':
        rdata = rec.value;
        break;
      case 'AAAA':
        rdata = rec.value;
        break;
      case 'CNAME':
      case 'NS':
      case 'PTR':
        rdata = rec.target || rec.value;
        break;
      case 'MX':
        rdata = `${rec.mxPref || '10'} ${rec.target || rec.value}`;
        break;
      case 'SRV':
        rdata = `${rec.srvPri || '0'} ${rec.srvWeight || '5'} ${rec.srvPort || '0'} ${rec.target || rec.value}`;
        break;
      case 'TXT':
        rdata = splitTxtChunks(rec.value || '');
        break;
      default:
        rdata = rec.value;
    }

    lines.push(`${prefix}${rdata}`);
  }

  return lines.join('\n');
}

// ─── Validation ───────────────────────────────────────────────
function validateZone(origin, mname, rname, serial, records) {
  const issues = [];

  if (!origin) issues.push({ level: 'err', key: 'val_origin_required' });
  if (!mname) issues.push({ level: 'err', key: 'val_mname_required' });
  if (!rname) issues.push({ level: 'err', key: 'val_rname_required' });
  if (!serial) issues.push({ level: 'warn', key: 'val_serial_missing' });

  // Track names per type for CNAME conflict detection
  const nameTypes = {};
  for (const rec of records) {
    const n = (rec.name || '@').toLowerCase();
    if (!nameTypes[n]) nameTypes[n] = [];
    nameTypes[n].push(rec.type);
  }

  for (const [nm, types] of Object.entries(nameTypes)) {
    if (types.includes('CNAME') && types.length > 1) {
      issues.push({ level: 'err', key: 'val_cname_conflict', name: nm });
    }
  }

  for (const rec of records) {
    const n = rec.name || '@';

    if (rec.type === 'A' && rec.value && !isValidIPv4(rec.value)) {
      issues.push({ level: 'err', key: 'val_invalid_ipv4', name: n, value: rec.value });
    }
    if (rec.type === 'AAAA' && rec.value && !isValidIPv6(rec.value)) {
      issues.push({ level: 'err', key: 'val_invalid_ipv6', name: n, value: rec.value });
    }
    if (rec.type === 'MX' && !(rec.mxPref && rec.target)) {
      issues.push({ level: 'err', key: 'val_mx_missing', name: n });
    }
    if (rec.type === 'SRV' && !(rec.srvPort && rec.target)) {
      issues.push({ level: 'err', key: 'val_srv_missing', name: n });
    }
    if ((rec.type === 'CNAME' || rec.type === 'NS' || rec.type === 'PTR' || rec.type === 'MX') && rec.target && !looksLikeFQDN(rec.target)) {
      issues.push({ level: 'warn', key: 'val_target_not_fqdn', name: n, target: rec.target });
    }
    if (rec.type === 'TXT' && rec.value && rec.value.length > 512) {
      issues.push({ level: 'warn', key: 'val_txt_long', name: n });
    }
    if (rec.type === 'A' && !rec.value) {
      issues.push({ level: 'err', key: 'val_value_required', name: n, rtype: rec.type });
    }
    if (rec.type === 'AAAA' && !rec.value) {
      issues.push({ level: 'err', key: 'val_value_required', name: n, rtype: rec.type });
    }
  }

  return issues;
}

// ─── Component ────────────────────────────────────────────────
function DNSZoneBuilder({ initialData, onShare }) {
  const { t } = useTranslation();

  // ── SOA / zone settings ──
  const [origin, setOrigin] = usePersistentState('dns-zone-builder:origin', initialData?.origin ?? 'example.com.');
  const [ttl, setTtl] = usePersistentState('dns-zone-builder:ttl', initialData?.ttl ?? '3600');
  const [mname, setMname] = usePersistentState('dns-zone-builder:mname', initialData?.mname ?? 'ns1.example.com.');
  const [rname, setRname] = usePersistentState('dns-zone-builder:rname', initialData?.rname ?? 'hostmaster.example.com.');
  const [serial, setSerial] = usePersistentState('dns-zone-builder:serial', initialData?.serial ?? '2024010101');
  const [refresh, setRefresh] = usePersistentState('dns-zone-builder:refresh', initialData?.refresh ?? '3600');
  const [retry, setRetry] = usePersistentState('dns-zone-builder:retry', initialData?.retry ?? '900');
  const [expire, setExpire] = usePersistentState('dns-zone-builder:expire', initialData?.expire ?? '604800');
  const [minimum, setMinimum] = usePersistentState('dns-zone-builder:minimum', initialData?.minimum ?? '300');

  // ── Records ──
  const [records, setRecords] = usePersistentState('dns-zone-builder:records', () =>
    (initialData?.records?.length ? initialData.records : [DEFAULT_RECORD()])
  );

  // ── Restore from initialData ──
  useEffect(() => {
    if (initialData) {
      if (initialData.origin !== undefined) setOrigin(initialData.origin);
      if (initialData.ttl !== undefined) setTtl(initialData.ttl);
      if (initialData.mname !== undefined) setMname(initialData.mname);
      if (initialData.rname !== undefined) setRname(initialData.rname);
      if (initialData.serial !== undefined) setSerial(initialData.serial);
      if (initialData.refresh !== undefined) setRefresh(initialData.refresh);
      if (initialData.retry !== undefined) setRetry(initialData.retry);
      if (initialData.expire !== undefined) setExpire(initialData.expire);
      if (initialData.minimum !== undefined) setMinimum(initialData.minimum);
      if (initialData.records?.length) setRecords(initialData.records);
    }
  }, [initialData]);

  // ── Share wiring ──
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'dns-zone-builder',
        origin, ttl, mname, rname, serial, refresh, retry, expire, minimum, records,
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [origin, ttl, mname, rname, serial, refresh, retry, expire, minimum, records, onShare]);

  // ── Dynamic record list ──
  const addRecord = useCallback(() => setRecords(prev => [...prev, DEFAULT_RECORD()]), []);
  const removeRecord = useCallback((id) => setRecords(prev => prev.length <= 1 ? prev : prev.filter(r => r.id !== id)), []);
  const updateRecord = useCallback((id, field, value) =>
    setRecords(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r)), []);

  // ── Computed zone output ──
  const zoneText = useMemo(
    () => buildZoneFile(origin, ttl, mname, rname, serial, refresh, retry, expire, minimum, records),
    [origin, ttl, mname, rname, serial, refresh, retry, expire, minimum, records]
  );

  // ── Validation ──
  const issues = useMemo(
    () => validateZone(origin, mname, rname, serial, records),
    [origin, mname, rname, serial, records]
  );

  // ── Copy / Download ──
  const [copied, doCopy] = useCopy();

  const handleDownload = () => {
    const blob = new Blob([zoneText + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = (origin || 'zone').replace(/\.$/, '').replace(/[^a-zA-Z0-9._-]/g, '_');
    a.download = `${safeName}.zone`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleExport = () => {
    exportJSON({ origin, ttl, mname, rname, serial, refresh, retry, expire, minimum, records }, `${(origin || 'zone').replace(/\.$/, '')}-dns-zone.json`);
  };

  const errCount = issues.filter(i => i.level === 'err').length;
  const warnCount = issues.filter(i => i.level === 'warn').length;

  const RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'PTR', 'NS'];

  return (
    <div className="fadein">

      {/* ── Zone Settings Card ── */}
      <div className="card">
        <div className="card-title">{t('dns_zone.title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>{t('dns_zone.subtitle')}</p>

        <div className="two-col grid-mobile-1" style={{ gap: 16, marginBottom: 16 }}>
          <div className="field">
            <label className="label">{t('dns_zone.origin_label')}</label>
            <input className="input" value={origin} onChange={e => setOrigin(e.target.value)} placeholder="example.com." />
            <span className="hint">{t('dns_zone.origin_hint')}</span>
          </div>
          <div className="field">
            <label className="label">{t('dns_zone.ttl_label')}</label>
            <input className="input" type="number" min="0" value={ttl} onChange={e => setTtl(e.target.value)} placeholder="3600" />
            <span className="hint">{t('dns_zone.ttl_hint')}</span>
          </div>
        </div>

        {/* SOA fields */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16, marginBottom: 8 }}>
          <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--cyan)', marginBottom: 12 }}>
            {t('dns_zone.soa_section')} &nbsp;<RFCLink rfc="RFC 1035" />
          </div>
          <div className="two-col grid-mobile-1" style={{ gap: 16, marginBottom: 16 }}>
            <div className="field">
              <label className="label">{t('dns_zone.mname_label')}</label>
              <input className="input" value={mname} onChange={e => setMname(e.target.value)} placeholder="ns1.example.com." />
              <span className="hint">{t('dns_zone.mname_hint')}</span>
            </div>
            <div className="field">
              <label className="label">{t('dns_zone.rname_label')}</label>
              <input className="input" value={rname} onChange={e => setRname(e.target.value)} placeholder="hostmaster.example.com." />
              <span className="hint">{t('dns_zone.rname_hint')}</span>
            </div>
          </div>

          {/* Serial row */}
          <div className="field" style={{ marginBottom: 16 }}>
            <label className="label">{t('dns_zone.serial_label')}</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <input className="input" style={{ maxWidth: 160 }} value={serial} onChange={e => setSerial(e.target.value)} placeholder="2024010101" />
              <button className="btn btn-sm btn-ghost" onClick={() => setSerial(generateSerial(serial))}>
                {t('dns_zone.generate_serial')}
              </button>
            </div>
            <span className="hint">{t('dns_zone.serial_hint')} &nbsp;<RFCLink rfc="RFC 1982" /></span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            <div className="field">
              <label className="label">{t('dns_zone.refresh_label')}</label>
              <input className="input" type="number" min="0" value={refresh} onChange={e => setRefresh(e.target.value)} placeholder="3600" />
            </div>
            <div className="field">
              <label className="label">{t('dns_zone.retry_label')}</label>
              <input className="input" type="number" min="0" value={retry} onChange={e => setRetry(e.target.value)} placeholder="900" />
            </div>
            <div className="field">
              <label className="label">{t('dns_zone.expire_label')}</label>
              <input className="input" type="number" min="0" value={expire} onChange={e => setExpire(e.target.value)} placeholder="604800" />
            </div>
            <div className="field">
              <label className="label">{t('dns_zone.minimum_label')}</label>
              <input className="input" type="number" min="0" value={minimum} onChange={e => setMinimum(e.target.value)} placeholder="300" />
              <span className="hint">{t('dns_zone.minimum_hint')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Records List ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{t('dns_zone.records_title')}</div>
          <button className="btn btn-sm btn-primary" onClick={addRecord}>{t('dns_zone.add_record')}</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {records.map((rec, idx) => (
            <div key={rec.id} style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              position: 'relative',
            }}>
              {/* Row header */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>#{idx + 1}</span>
                <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--cyan)' }}>{rec.type}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)' }}>{rec.name}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'minmax(100px,1fr) 80px 100px', gap: 10, marginBottom: 10 }}>
                {/* Name */}
                <div className="field">
                  <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_name')}</label>
                  <input
                    className="input"
                    style={{ fontSize: 12 }}
                    value={rec.name}
                    onChange={e => updateRecord(rec.id, 'name', e.target.value)}
                    placeholder="@"
                  />
                </div>
                {/* TTL */}
                <div className="field">
                  <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_ttl')}</label>
                  <input
                    className="input"
                    style={{ fontSize: 12 }}
                    type="number"
                    min="0"
                    value={rec.ttl}
                    onChange={e => updateRecord(rec.id, 'ttl', e.target.value)}
                    placeholder={ttl || '3600'}
                  />
                </div>
                {/* Type */}
                <div className="field">
                  <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_type')}</label>
                  <select
                    className="input"
                    style={{ fontSize: 12 }}
                    value={rec.type}
                    onChange={e => updateRecord(rec.id, 'type', e.target.value)}
                  >
                    {RECORD_TYPES.map(rt => <option key={rt} value={rt}>{rt}</option>)}
                  </select>
                </div>
              </div>

              {/* Type-specific value fields */}
              {rec.type === 'A' && (
                <div className="field">
                  <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_ipv4')}</label>
                  <input className="input" style={{ fontSize: 12, maxWidth: 200 }} value={rec.value} onChange={e => updateRecord(rec.id, 'value', e.target.value)} placeholder="192.168.1.1" />
                </div>
              )}
              {rec.type === 'AAAA' && (
                <div className="field">
                  <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_ipv6')}</label>
                  <input className="input" style={{ fontSize: 12 }} value={rec.value} onChange={e => updateRecord(rec.id, 'value', e.target.value)} placeholder="2001:db8::1" />
                </div>
              )}
              {(rec.type === 'CNAME' || rec.type === 'NS' || rec.type === 'PTR') && (
                <div className="field">
                  <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_target')}</label>
                  <input className="input" style={{ fontSize: 12 }} value={rec.target} onChange={e => updateRecord(rec.id, 'target', e.target.value)} placeholder="target.example.com." />
                  <span className="hint" style={{ fontSize: 10 }}>{t('dns_zone.fqdn_hint')}</span>
                </div>
              )}
              {rec.type === 'MX' && (
                <div style={{ display: 'grid', gridTemplateColumns: '80px 1fr', gap: 10 }}>
                  <div className="field">
                    <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_mx_pref')}</label>
                    <input className="input" style={{ fontSize: 12 }} type="number" min="0" max="65535" value={rec.mxPref} onChange={e => updateRecord(rec.id, 'mxPref', e.target.value)} placeholder="10" />
                  </div>
                  <div className="field">
                    <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_mx_exchange')}</label>
                    <input className="input" style={{ fontSize: 12 }} value={rec.target} onChange={e => updateRecord(rec.id, 'target', e.target.value)} placeholder="mail.example.com." />
                    <span className="hint" style={{ fontSize: 10 }}>{t('dns_zone.fqdn_hint')}</span>
                  </div>
                </div>
              )}
              {rec.type === 'SRV' && (
                <div style={{ display: 'grid', gridTemplateColumns: '80px 80px 80px 1fr', gap: 10 }}>
                  <div className="field">
                    <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_srv_priority')}</label>
                    <input className="input" style={{ fontSize: 12 }} type="number" min="0" max="65535" value={rec.srvPri} onChange={e => updateRecord(rec.id, 'srvPri', e.target.value)} placeholder="0" />
                  </div>
                  <div className="field">
                    <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_srv_weight')}</label>
                    <input className="input" style={{ fontSize: 12 }} type="number" min="0" max="65535" value={rec.srvWeight} onChange={e => updateRecord(rec.id, 'srvWeight', e.target.value)} placeholder="5" />
                  </div>
                  <div className="field">
                    <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_srv_port')}</label>
                    <input className="input" style={{ fontSize: 12 }} type="number" min="0" max="65535" value={rec.srvPort} onChange={e => updateRecord(rec.id, 'srvPort', e.target.value)} placeholder="443" />
                  </div>
                  <div className="field">
                    <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_srv_target')}</label>
                    <input className="input" style={{ fontSize: 12 }} value={rec.target} onChange={e => updateRecord(rec.id, 'target', e.target.value)} placeholder="host.example.com." />
                  </div>
                </div>
              )}
              {rec.type === 'TXT' && (
                <div className="field">
                  <label className="label" style={{ fontSize: 11 }}>{t('dns_zone.rec_txt')}</label>
                  <textarea
                    className="input"
                    style={{ fontSize: 12, fontFamily: 'var(--mono)', minHeight: 60, resize: 'vertical' }}
                    value={rec.value}
                    onChange={e => updateRecord(rec.id, 'value', e.target.value)}
                    placeholder={'v=spf1 include:example.com ~all'}
                  />
                  <span className="hint" style={{ fontSize: 10 }}>{t('dns_zone.txt_hint')}</span>
                </div>
              )}

              {/* Remove button */}
              <button
                className="btn btn-sm btn-danger"
                style={{ position: 'absolute', top: 10, right: 10 }}
                onClick={() => removeRecord(rec.id)}
                title={t('dns_zone.remove_record')}
              >×</button>
            </div>
          ))}
        </div>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-primary" onClick={addRecord}>{t('dns_zone.add_record')}</button>
        </div>
      </div>

      {/* ── Validation Panel ── */}
      {issues.length > 0 && (
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>{t('dns_zone.validation_title')}</div>
            {errCount > 0 && <span className="badge badge-red">{t('dns_zone.val_errors', { n: errCount })}</span>}
            {warnCount > 0 && <span className="badge badge-yellow">{t('dns_zone.val_warnings', { n: warnCount })}</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {issues.map((issue, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 8,
                padding: '6px 10px',
                borderRadius: 'var(--radius)',
                background: issue.level === 'err' ? 'rgba(var(--red-rgb,220,53,69),0.08)' : 'rgba(var(--yellow-rgb,255,193,7),0.08)',
                border: `1px solid ${issue.level === 'err' ? 'var(--red)' : 'var(--yellow)'}`,
                fontSize: 12,
              }}>
                <span className={`badge ${issue.level === 'err' ? 'badge-red' : 'badge-yellow'}`} style={{ flexShrink: 0, marginTop: 1 }}>
                  {issue.level === 'err' ? t('dns_zone.badge_error') : t('dns_zone.badge_warning')}
                </span>
                <span>
                  {t(`dns_zone.${issue.key}`, { name: issue.name, value: issue.value, target: issue.target, rtype: issue.rtype })}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Live Zone Output ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{t('common.results')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <CopyBtn text={zoneText} label="copy" />
            <button className="btn btn-sm btn-ghost" onClick={handleDownload}>{t('dns_zone.download_zone')}</button>
            <button className="btn btn-sm btn-ghost" onClick={handleExport}>{t('common.export_json')}</button>
          </div>
        </div>

        <pre style={{
          fontFamily: 'var(--mono)',
          fontSize: 12,
          lineHeight: 1.6,
          background: 'var(--panel)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          padding: '14px 16px',
          overflowX: 'auto',
          whiteSpace: 'pre',
          color: 'var(--text)',
          margin: 0,
        }}>{zoneText}</pre>

        {/* Stats row */}
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          <div className="result-item">
            <span className="result-label">{t('dns_zone.stat_records')}</span>
            <span className="result-value" style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)' }}>{records.length}</span>
          </div>
          <div className="result-item">
            <span className="result-label">{t('dns_zone.stat_origin')}</span>
            <span className="result-value" style={{ fontFamily: 'var(--mono)', color: 'var(--green)' }}>{origin || '—'}</span>
          </div>
          <div className="result-item">
            <span className="result-label">{t('dns_zone.stat_serial')}</span>
            <span className="result-value" style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{serial || '—'}</span>
          </div>
          <div className="result-item">
            <span className="result-label">{t('dns_zone.stat_issues')}</span>
            <span className="result-value" style={{ fontFamily: 'var(--mono)', color: issues.length > 0 ? 'var(--yellow)' : 'var(--green)' }}>
              {issues.length > 0 ? issues.length : t('dns_zone.stat_clean')}
            </span>
          </div>
        </div>
      </div>

      {/* ── Quick Reference ── */}
      <div className="card">
        <div className="card-title">{t('dns_zone.quickref_title')}</div>
        <div className="result-grid grid-mobile-1" style={{ gap: 10 }}>
          <ResultItem label="RFC 1035" value={t('dns_zone.ref_rfc1035')} />
          <ResultItem label="RFC 1982" value={t('dns_zone.ref_rfc1982')} />
          <ResultItem label="RFC 2782" value={t('dns_zone.ref_rfc2782')} />
          <ResultItem label={t('dns_zone.ref_serial_fmt_label')} value="YYYYMMDDnn" />
          <ResultItem label={t('dns_zone.ref_txt_max_label')} value="255 bytes/chunk" />
          <ResultItem label={t('dns_zone.ref_cname_rule_label')} value={t('dns_zone.ref_cname_rule_value')} />
        </div>
        <div className="hint" style={{ marginTop: 12 }}>
          {t('dns_zone.quickref_hint')} <RFCLink rfc="RFC 1035" /> · <RFCLink rfc="RFC 1982" /> · <RFCLink rfc="RFC 2782" />
        </div>
      </div>

    </div>
  );
}

window.DNSZoneBuilder = DNSZoneBuilder;
