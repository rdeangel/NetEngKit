const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── RFC 5424 / RFC 3164 Syslog Reference Data ────────────────────────────
const SB_FACILITIES = [
  { num: 0,  keyword: 'kern',     name: 'Kernel messages' },
  { num: 1,  keyword: 'user',     name: 'User-level messages' },
  { num: 2,  keyword: 'mail',     name: 'Mail system' },
  { num: 3,  keyword: 'daemon',   name: 'System daemons' },
  { num: 4,  keyword: 'auth',     name: 'Security/authorization messages' },
  { num: 5,  keyword: 'syslog',   name: 'Messages generated internally by syslogd' },
  { num: 6,  keyword: 'lpr',      name: 'Line printer subsystem' },
  { num: 7,  keyword: 'news',     name: 'Network news subsystem' },
  { num: 8,  keyword: 'uucp',     name: 'UUCP subsystem' },
  { num: 9,  keyword: 'cron',     name: 'Clock daemon' },
  { num: 10, keyword: 'authpriv', name: 'Security/authorization messages (private)' },
  { num: 11, keyword: 'ftp',      name: 'FTP daemon' },
  { num: 12, keyword: 'ntp',      name: 'NTP subsystem' },
  { num: 13, keyword: 'logaudit', name: 'Log audit' },
  { num: 14, keyword: 'logalert', name: 'Log alert' },
  { num: 15, keyword: 'clock',    name: 'Clock daemon (note 2)' },
  { num: 16, keyword: 'local0',   name: 'Local use 0' },
  { num: 17, keyword: 'local1',   name: 'Local use 1' },
  { num: 18, keyword: 'local2',   name: 'Local use 2' },
  { num: 19, keyword: 'local3',   name: 'Local use 3' },
  { num: 20, keyword: 'local4',   name: 'Local use 4' },
  { num: 21, keyword: 'local5',   name: 'Local use 5' },
  { num: 22, keyword: 'local6',   name: 'Local use 6' },
  { num: 23, keyword: 'local7',   name: 'Local use 7' },
];

const SB_SEVERITIES = [
  { num: 0, keyword: 'emerg',   name: 'Emergency',     desc: 'System is unusable' },
  { num: 1, keyword: 'alert',   name: 'Alert',         desc: 'Action must be taken immediately' },
  { num: 2, keyword: 'crit',    name: 'Critical',      desc: 'Critical conditions' },
  { num: 3, keyword: 'err',     name: 'Error',         desc: 'Error conditions' },
  { num: 4, keyword: 'warning', name: 'Warning',       desc: 'Warning conditions' },
  { num: 5, keyword: 'notice',  name: 'Notice',        desc: 'Normal but significant condition' },
  { num: 6, keyword: 'info',    name: 'Informational', desc: 'Informational messages' },
  { num: 7, keyword: 'debug',   name: 'Debug',         desc: 'Debug-level messages' },
];

function sbSevBadge(sev) {
  if (sev <= 3) return 'badge-red';
  if (sev === 4) return 'badge-yellow';
  if (sev <= 6) return 'badge-cyan';
  return '';
}

function sbNow() {
  const d = new Date();
  const pad = (n, z) => String(n).padStart(z ?? 2, '0');
  const ms = pad(d.getUTCMilliseconds(), 3);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${ms}Z`;
}

function sbNilOrVal(v) {
  return (v && v.trim()) ? v.trim() : '-';
}

function sbBuildMessage({ facility, severity, timestamp, hostname, appName, procId, msgId, sdId, sdParams, msg, prependBOM }) {
  const pri = (parseInt(facility, 10) * 8) + parseInt(severity, 10);
  const ts  = sbNilOrVal(timestamp);
  const hn  = sbNilOrVal(hostname);
  const an  = sbNilOrVal(appName);
  const pid = sbNilOrVal(procId);
  const mid = sbNilOrVal(msgId);

  let sd = '-';
  const sdIdTrimmed = (sdId || '').trim();
  if (sdIdTrimmed) {
    const params = (sdParams || '').split(/\s+/).filter(Boolean).map(p => {
      const eqIdx = p.indexOf('=');
      if (eqIdx < 0) return null;
      const k = p.slice(0, eqIdx);
      const v = p.slice(eqIdx + 1).replace(/^"|"$/g, '');
      return `${k}="${v}"`;
    }).filter(Boolean);
    sd = `[${sdIdTrimmed}${params.length ? ' ' + params.join(' ') : ''}]`;
  }

  const bom = prependBOM ? '﻿' : '';
  const msgPart = msg ? ` ${bom}${msg}` : '';
  return `<${pri}>1 ${ts} ${hn} ${an} ${pid} ${mid} ${sd}${msgPart}`;
}

// ─── RFC 5424 Parser ──────────────────────────────────────────────────────
function sbParseRFC5424(line) {
  // <PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [SD-DATA] MSG
  const m = line.match(/^<(\d{1,3})>1 (\S+) (\S+) (\S+) (\S+) (\S+) ((?:\[[^\]]*\]|-))(.*)$/);
  if (!m) return null;
  const priNum = parseInt(m[1], 10);
  if (isNaN(priNum) || priNum < 0 || priNum > 191) return null;
  const facility = Math.floor(priNum / 8);
  const severity = priNum % 8;
  const facilityInfo = SB_FACILITIES[facility] || { num: facility, keyword: '?', name: '?' };
  const severityInfo = SB_SEVERITIES[severity] || { num: severity, keyword: '?', name: '?' };

  let sdParsed = null;
  const sdRaw = m[7];
  if (sdRaw !== '-') {
    const sdMatch = sdRaw.match(/^\[([^\s\]]+)((?:\s+[^\s=\]]+="[^"]*")*)\]$/);
    if (sdMatch) {
      const sdId = sdMatch[1];
      const params = {};
      const paramRe = /([^\s=\]]+)="([^"]*)"/g;
      let pm;
      while ((pm = paramRe.exec(sdMatch[2])) !== null) {
        params[pm[1]] = pm[2];
      }
      sdParsed = { id: sdId, params };
    } else {
      sdParsed = { raw: sdRaw };
    }
  }

  const msgBody = (m[8] || '').replace(/^\s/, '');
  const hasBOM = msgBody.startsWith('﻿');
  const finalMsg = hasBOM ? msgBody.slice(1) : msgBody;

  return {
    format: 'RFC 5424',
    pri: priNum,
    facility: facilityInfo,
    severity: severityInfo,
    version: '1',
    timestamp: m[2] === '-' ? null : m[2],
    hostname: m[3] === '-' ? null : m[3],
    appName: m[4] === '-' ? null : m[4],
    procId: m[5] === '-' ? null : m[5],
    msgId: m[6] === '-' ? null : m[6],
    structuredData: sdParsed,
    sdRaw,
    msg: finalMsg || null,
    hasBOM,
  };
}

// ─── RFC 3164 Parser ──────────────────────────────────────────────────────
function sbParseRFC3164(line) {
  // <PRI>Mmm dd hh:mm:ss host tag: msg
  const m = line.match(/^<(\d{1,3})>([A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2})\s+(\S+)\s+([^\s:]+)(?::\s*(.*))?$/);
  if (!m) return null;
  const priNum = parseInt(m[1], 10);
  if (isNaN(priNum) || priNum < 0 || priNum > 191) return null;
  const facility = Math.floor(priNum / 8);
  const severity = priNum % 8;
  const facilityInfo = SB_FACILITIES[facility] || { num: facility, keyword: '?', name: '?' };
  const severityInfo = SB_SEVERITIES[severity] || { num: severity, keyword: '?', name: '?' };
  return {
    format: 'RFC 3164',
    pri: priNum,
    facility: facilityInfo,
    severity: severityInfo,
    version: null,
    timestamp: m[2],
    hostname: m[3],
    appName: m[4],
    procId: null,
    msgId: null,
    structuredData: null,
    sdRaw: null,
    msg: m[5] || null,
    hasBOM: false,
  };
}

function sbParseLine(line) {
  const trimmed = (line || '').trim();
  if (!trimmed) return null;
  // Try RFC 5424 first (has version field "1")
  const r5424 = sbParseRFC5424(trimmed);
  if (r5424) return r5424;
  const r3164 = sbParseRFC3164(trimmed);
  if (r3164) return r3164;
  return { error: true };
}

// ─── Component ────────────────────────────────────────────────────────────
function SyslogBuilder({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  // Tab
  const [tab, setTab] = usePersistentState('syslog-builder:tab', initialData?.activeTab ?? 'build');

  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== tab) setTab(initialData.activeTab);
  }, [initialData]);

  useEffect(() => { onNav?.({ activeTab: tab }); }, [tab]);

  // Builder inputs
  const [facility,   setFacility]   = usePersistentState('syslog-builder:facility',   initialData?.facility   ?? '16');
  const [severity,   setSeverity]   = usePersistentState('syslog-builder:severity',   initialData?.severity   ?? '6');
  const [timestamp,  setTimestamp]  = usePersistentState('syslog-builder:timestamp',  initialData?.timestamp  ?? sbNow());
  const [hostname,   setHostname]   = usePersistentState('syslog-builder:hostname',   initialData?.hostname   ?? '');
  const [appName,    setAppName]    = usePersistentState('syslog-builder:appName',    initialData?.appName    ?? '');
  const [procId,     setProcId]     = usePersistentState('syslog-builder:procId',     initialData?.procId     ?? '');
  const [msgId,      setMsgId]      = usePersistentState('syslog-builder:msgId',      initialData?.msgId      ?? '');
  const [sdId,       setSdId]       = usePersistentState('syslog-builder:sdId',       initialData?.sdId       ?? '');
  const [sdParams,   setSdParams]   = usePersistentState('syslog-builder:sdParams',   initialData?.sdParams   ?? '');
  const [msg,        setMsg]        = usePersistentState('syslog-builder:msg',        initialData?.msg        ?? '');
  const [prependBOM, setPrependBOM] = usePersistentState('syslog-builder:bom',        initialData?.prependBOM ?? false);

  // Parser
  const [rawParse, setRawParse] = usePersistentState('syslog-builder:rawParse', initialData?.rawParse ?? '');

  // Copy
  const [copied, copy] = useCopy();

  // Restore from initialData
  useEffect(() => {
    if (!initialData) return;
    if (initialData.tab       !== undefined) setTab(initialData.tab);
    if (initialData.facility  !== undefined) setFacility(initialData.facility);
    if (initialData.severity  !== undefined) setSeverity(initialData.severity);
    if (initialData.timestamp !== undefined) setTimestamp(initialData.timestamp);
    if (initialData.hostname  !== undefined) setHostname(initialData.hostname);
    if (initialData.appName   !== undefined) setAppName(initialData.appName);
    if (initialData.procId    !== undefined) setProcId(initialData.procId);
    if (initialData.msgId     !== undefined) setMsgId(initialData.msgId);
    if (initialData.sdId      !== undefined) setSdId(initialData.sdId);
    if (initialData.sdParams  !== undefined) setSdParams(initialData.sdParams);
    if (initialData.msg       !== undefined) setMsg(initialData.msg);
    if (initialData.prependBOM !== undefined) setPrependBOM(initialData.prependBOM);
    if (initialData.rawParse  !== undefined) setRawParse(initialData.rawParse);
  }, [initialData]);

  // Share wiring
  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'syslog-builder', tab, facility, severity, hostname, appName, procId, msgId, msg, rawParse });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, facility, severity, hostname, appName, procId, msgId, msg, rawParse, onShare]);

  // Built message
  const builtMessage = useMemo(() => sbBuildMessage({ facility, severity, timestamp, hostname, appName, procId, msgId, sdId, sdParams, msg, prependBOM }), [facility, severity, timestamp, hostname, appName, procId, msgId, sdId, sdParams, msg, prependBOM]);

  const pri = (parseInt(facility, 10) * 8) + parseInt(severity, 10);
  const facilityInfo = SB_FACILITIES[parseInt(facility, 10)] || SB_FACILITIES[0];
  const severityInfo = SB_SEVERITIES[parseInt(severity, 10)] || SB_SEVERITIES[6];

  // Parse result
  const parseResult = useMemo(() => {
    if (!rawParse.trim()) return null;
    return sbParseLine(rawParse);
  }, [rawParse]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([builtMessage], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'syslog-message.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [builtMessage]);

  const handleCopyAll = useCallback(() => {
    copy(builtMessage);
  }, [builtMessage, copy]);

  const tabBtn = (id, label) => (
    <button
      key={id}
      className={`btn btn-sm ${tab === id ? 'btn-primary' : 'btn-ghost'}`}
      onClick={() => setTab(id)}
    >{label}</button>
  );

  return (
    <div className="fadein">
      {/* ── Header + Tabs ── */}
      <div className="card">
        <div className="card-title">{t('syslog_builder.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
          {t('syslog_builder.subtitle')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {tabBtn('build',     t('syslog_builder.tab_build'))}
          {tabBtn('parse',     t('syslog_builder.tab_parse'))}
          {tabBtn('reference', t('syslog_builder.tab_reference'))}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          BUILD TAB
          ══════════════════════════════════════════════════════ */}
      {tab === 'build' && (
        <div className="fadein">
          {/* ── PRI Section ── */}
          <div className="card">
            <div className="card-title">{t('syslog_builder.pri_section')}</div>
            <div className="two-col grid-mobile-1" style={{ gap: 20 }}>
              <div className="field">
                <label className="label">{t('syslog_builder.facility_label')}</label>
                <select className="input" value={facility} onChange={e => setFacility(e.target.value)}>
                  {SB_FACILITIES.map(f => (
                    <option key={f.num} value={String(f.num)}>
                      {f.num} — {f.keyword} ({f.name})
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label className="label">{t('syslog_builder.severity_label')}</label>
                <select className="input" value={severity} onChange={e => setSeverity(e.target.value)}>
                  {SB_SEVERITIES.map(s => (
                    <option key={s.num} value={String(s.num)}>
                      {s.num} — {s.keyword} ({s.name})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="result-grid" style={{ marginTop: 14 }}>
              <ResultItem
                label={t('syslog_builder.computed_pri')}
                value={
                  <span>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 15, color: 'var(--cyan)', fontWeight: 700 }}>{pri}</span>
                    {' '}
                    <span style={{ fontSize: 11, color: 'var(--muted)' }}>
                      = {facilityInfo.num} × 8 + {severityInfo.num}
                    </span>
                  </span>
                }
              />
              <ResultItem
                label={t('syslog_builder.facility_decoded')}
                value={<span><span className="badge badge-blue">{facilityInfo.keyword}</span> {facilityInfo.name}</span>}
              />
              <ResultItem
                label={t('syslog_builder.severity_decoded')}
                value={<span><span className={`badge ${sbSevBadge(parseInt(severity, 10))}`}>{severityInfo.keyword}</span> {severityInfo.name}</span>}
              />
            </div>
          </div>

          {/* ── Header Fields ── */}
          <div className="card">
            <div className="card-title">{t('syslog_builder.header_section')}</div>
            <div className="two-col grid-mobile-1" style={{ gap: 16 }}>
              <div className="field">
                <label className="label">{t('syslog_builder.timestamp_label')}</label>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    className="input"
                    type="text"
                    value={timestamp}
                    onChange={e => setTimestamp(e.target.value)}
                    placeholder="2024-01-15T12:34:56.789Z"
                    style={{ flex: 1 }}
                  />
                  <button className="btn btn-ghost btn-sm" onClick={() => setTimestamp(sbNow())} title={t('syslog_builder.now_hint')}>
                    {t('syslog_builder.now_btn')}
                  </button>
                </div>
                <div className="hint">{t('syslog_builder.timestamp_hint')}</div>
              </div>
              <div className="field">
                <label className="label">{t('syslog_builder.hostname_label')}</label>
                <input className="input" type="text" value={hostname} onChange={e => setHostname(e.target.value)} placeholder="router1.example.com" />
                <div className="hint">{t('syslog_builder.nilvalue_hint')}</div>
              </div>
            </div>
            <div className="three-col grid-mobile-1" style={{ gap: 16, marginTop: 14 }}>
              <div className="field">
                <label className="label">{t('syslog_builder.appname_label')}</label>
                <input className="input" type="text" value={appName} onChange={e => setAppName(e.target.value)} placeholder="sshd" />
              </div>
              <div className="field">
                <label className="label">{t('syslog_builder.procid_label')}</label>
                <input className="input" type="text" value={procId} onChange={e => setProcId(e.target.value)} placeholder="1234" />
              </div>
              <div className="field">
                <label className="label">{t('syslog_builder.msgid_label')}</label>
                <input className="input" type="text" value={msgId} onChange={e => setMsgId(e.target.value)} placeholder="ID47" />
              </div>
            </div>
          </div>

          {/* ── Structured Data ── */}
          <div className="card">
            <div className="card-title">{t('syslog_builder.sd_section')}</div>
            <div className="hint" style={{ marginBottom: 12 }}>{t('syslog_builder.sd_hint')}</div>
            <div className="two-col grid-mobile-1" style={{ gap: 16 }}>
              <div className="field">
                <label className="label">{t('syslog_builder.sd_id_label')}</label>
                <input className="input" type="text" value={sdId} onChange={e => setSdId(e.target.value)} placeholder="exampleSDID@32473" />
              </div>
              <div className="field">
                <label className="label">{t('syslog_builder.sd_params_label')}</label>
                <input className="input" type="text" value={sdParams} onChange={e => setSdParams(e.target.value)} placeholder={'iut=3 eventSource=Application'} />
                <div className="hint">{t('syslog_builder.sd_params_hint')}</div>
              </div>
            </div>
          </div>

          {/* ── Message Body ── */}
          <div className="card">
            <div className="card-title">{t('syslog_builder.msg_section')}</div>
            <div className="field">
              <label className="label">{t('syslog_builder.msg_label')}</label>
              <textarea
                className="input"
                rows={3}
                value={msg}
                onChange={e => setMsg(e.target.value)}
                placeholder={t('syslog_builder.msg_placeholder')}
                style={{ fontFamily: 'var(--mono)', fontSize: 13, resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
              <input
                type="checkbox"
                id="sb-bom"
                checked={prependBOM}
                onChange={e => setPrependBOM(e.target.checked)}
              />
              <label htmlFor="sb-bom" style={{ fontSize: 12, cursor: 'pointer' }}>
                {t('syslog_builder.bom_label')}
              </label>
              <span className="hint" style={{ marginLeft: 4 }}>{t('syslog_builder.bom_hint')}</span>
            </div>
          </div>

          {/* ── Built Message Output ── */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>{t('common.results')}</div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm btn-ghost" onClick={handleCopyAll}>
                  {copied ? t('common.copy') : t('common.copy_all')}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={handleDownload}>{t('syslog_builder.download_btn')}</button>
              </div>
            </div>
            <pre style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '12px 14px',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              color: 'var(--text)',
              wordBreak: 'break-all',
              whiteSpace: 'pre-wrap',
              margin: 0,
              lineHeight: 1.6,
            }}>
              {builtMessage}
            </pre>
            <div style={{ marginTop: 12, fontSize: 11, color: 'var(--muted)', lineHeight: 1.7 }}>
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)' }}>{'<PRI>VERSION TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [STRUCTURED-DATA] MSG'}</span>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          PARSE TAB
          ══════════════════════════════════════════════════════ */}
      {tab === 'parse' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('syslog_builder.parse_section')}</div>
            <div className="hint" style={{ marginBottom: 12 }}>{t('syslog_builder.parse_hint')}</div>
            <div className="field">
              <label className="label">{t('syslog_builder.parse_label')}</label>
              <textarea
                className="input"
                rows={4}
                value={rawParse}
                onChange={e => setRawParse(e.target.value)}
                placeholder={'<165>1 2003-08-24T05:14:15.000003-07:00 192.0.2.1 myproc 8710 - - %% It\'s time to make the donut.'}
                style={{ fontFamily: 'var(--mono)', fontSize: 12, resize: 'vertical' }}
              />
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setRawParse('')}>{t('common.clear')}</button>
            </div>
          </div>

          {rawParse.trim() && parseResult && !parseResult.error && (
            <div className="card fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14, flexWrap: 'wrap', gap: 8 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>{t('syslog_builder.parse_result_title')}</div>
                <span className="badge badge-cyan">{parseResult.format}</span>
              </div>

              <div className="result-grid grid-mobile-1">
                <ResultItem
                  label="PRI"
                  value={
                    <span>
                      <span style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)', fontWeight: 700 }}>{parseResult.pri}</span>
                      <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 8 }}>
                        ({t('syslog_builder.facility_label')} {parseResult.facility.num} × 8 + {t('syslog_builder.severity_label')} {parseResult.severity.num})
                      </span>
                    </span>
                  }
                />
                <ResultItem
                  label={t('syslog_builder.facility_label')}
                  value={<span><span className="badge badge-blue">{parseResult.facility.keyword}</span> {parseResult.facility.num} — {parseResult.facility.name}</span>}
                />
                <ResultItem
                  label={t('syslog_builder.severity_label')}
                  value={<span><span className={`badge ${sbSevBadge(parseResult.severity.num)}`}>{parseResult.severity.keyword}</span> {parseResult.severity.num} — {parseResult.severity.name}</span>}
                />
                {parseResult.version && (
                  <ResultItem label={t('syslog_builder.version_label')} value={parseResult.version} />
                )}
                <ResultItem label={t('syslog_builder.timestamp_label')} value={parseResult.timestamp || '-'} />
                <ResultItem label={t('syslog_builder.hostname_label')} value={parseResult.hostname || '-'} />
                <ResultItem label={t('syslog_builder.appname_label')} value={parseResult.appName || '-'} />
                {parseResult.format === 'RFC 5424' && (
                  <>
                    <ResultItem label={t('syslog_builder.procid_label')} value={parseResult.procId || '-'} />
                    <ResultItem label={t('syslog_builder.msgid_label')} value={parseResult.msgId || '-'} />
                  </>
                )}
              </div>

              {parseResult.structuredData && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {t('syslog_builder.sd_section')}
                  </div>
                  {parseResult.structuredData.raw ? (
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', background: 'var(--panel)', padding: '8px 12px', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      {parseResult.structuredData.raw}
                    </div>
                  ) : (
                    <div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <span className="badge badge-purple">{parseResult.structuredData.id}</span>
                        <span style={{ fontSize: 11, color: 'var(--muted)' }}>SD-ID</span>
                      </div>
                      {Object.keys(parseResult.structuredData.params || {}).length > 0 && (
                        <div className="table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>{t('syslog_builder.th_param_name')}</th>
                                <th>{t('syslog_builder.th_param_value')}</th>
                              </tr>
                            </thead>
                            <tbody>
                              {Object.entries(parseResult.structuredData.params).map(([k, v]) => (
                                <tr key={k}>
                                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{k}</td>
                                  <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {parseResult.msg && (
                <div style={{ marginTop: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
                    {t('syslog_builder.msg_label')}
                  </div>
                  <pre style={{
                    background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                    padding: '8px 12px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)',
                    whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
                  }}>
                    {parseResult.msg}
                  </pre>
                  {parseResult.hasBOM && (
                    <div className="hint" style={{ marginTop: 4 }}>{t('syslog_builder.bom_detected')}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {rawParse.trim() && parseResult && parseResult.error && (
            <div className="card fadein">
              <Err msg={t('syslog_builder.parse_error')} />
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════
          REFERENCE TAB
          ══════════════════════════════════════════════════════ */}
      {tab === 'reference' && (
        <div className="fadein">
          {/* RFCs */}
          <div className="card">
            <div className="card-title">{t('syslog_builder.ref_rfcs_title')}</div>
            <div className="result-grid grid-mobile-1" style={{ marginBottom: 8 }}>
              <ResultItem label="RFC 5424" value={<span>{t('syslog_builder.ref_rfc5424_desc')} <RFCLink rfc="RFC 5424" /></span>} />
              <ResultItem label="RFC 3164" value={<span>{t('syslog_builder.ref_rfc3164_desc')} <RFCLink rfc="RFC 3164" /></span>} />
            </div>
          </div>

          {/* Facility Table */}
          <div className="card">
            <div className="card-title">{t('syslog_builder.ref_facility_title')}</div>
            <div className="table-wrap hide-mobile">
              <table>
                <thead>
                  <tr>
                    <th>{t('syslog_builder.th_num')}</th>
                    <th>{t('syslog_builder.th_keyword')}</th>
                    <th>{t('syslog_builder.th_name')}</th>
                  </tr>
                </thead>
                <tbody>
                  {SB_FACILITIES.map(f => (
                    <tr key={f.num}>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)' }}>{f.num}</td>
                      <td><span className="badge badge-blue">{f.keyword}</span></td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{f.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="show-mobile">
              {SB_FACILITIES.map(f => (
                <div key={f.num} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)', minWidth: 24 }}>{f.num}</span>
                  <span className="badge badge-blue" style={{ minWidth: 70 }}>{f.keyword}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{f.name}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Severity Table */}
          <div className="card">
            <div className="card-title">{t('syslog_builder.ref_severity_title')}</div>
            <div className="table-wrap hide-mobile">
              <table>
                <thead>
                  <tr>
                    <th>{t('syslog_builder.th_num')}</th>
                    <th>{t('syslog_builder.th_keyword')}</th>
                    <th>{t('syslog_builder.th_name')}</th>
                    <th>{t('syslog_builder.th_meaning')}</th>
                  </tr>
                </thead>
                <tbody>
                  {SB_SEVERITIES.map(s => (
                    <tr key={s.num}>
                      <td style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)' }}>{s.num}</td>
                      <td><span className={`badge ${sbSevBadge(s.num)}`}>{s.keyword}</span></td>
                      <td style={{ fontWeight: 600, fontSize: 13 }}>{s.name}</td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{s.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="show-mobile">
              {SB_SEVERITIES.map(s => (
                <div key={s.num} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)', minWidth: 20 }}>{s.num}</span>
                  <span className={`badge ${sbSevBadge(s.num)}`} style={{ minWidth: 64 }}>{s.keyword}</span>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 12 }}>{s.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Message Format Quick Ref */}
          <div className="card">
            <div className="card-title">{t('syslog_builder.ref_format_title')}</div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>RFC 5424</div>
              <pre style={{
                background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--cyan)',
                overflowX: 'auto', margin: 0,
              }}>{'<PRI>1 TIMESTAMP HOSTNAME APP-NAME PROCID MSGID [SD-ID PARAM="VALUE"] MSG'}</pre>
            </div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 6 }}>RFC 3164</div>
              <pre style={{
                background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--yellow)',
                overflowX: 'auto', margin: 0,
              }}>{'<PRI>Mmm dd hh:mm:ss HOSTNAME TAG: MSG'}</pre>
            </div>
            <div style={{ marginTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 8 }}>{t('syslog_builder.ref_pri_formula')}</div>
              <pre style={{
                background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--green)', margin: 0,
              }}>{'PRI = (Facility × 8) + Severity'}</pre>
              <div className="hint" style={{ marginTop: 6 }}>{t('syslog_builder.ref_pri_example')}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

window.SyslogBuilder = SyslogBuilder;
