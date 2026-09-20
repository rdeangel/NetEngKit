/* ── Config Template Variable Substitutor ─────────────────────── */
const { useState, useEffect, useCallback, useMemo } = React;

// ── IPv4 helpers ──────────────────────────────────────────────
function ctIpv4ToInt(ip) {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function ctIntToIpv4(n) {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}

function ctIpInc(base, offset) {
  return ctIntToIpv4((ctIpv4ToInt(base) + offset) >>> 0);
}

function ctSubnetMask(prefix) {
  if (prefix < 0 || prefix > 32) return 'invalid';
  return ctIntToIpv4(prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0);
}

// ── CSV parser ────────────────────────────────────────────────
function ctParseCSVLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = false;
      } else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ',') { result.push(current); current = ''; }
      else current += ch;
    }
  }
  result.push(current);
  return result;
}

function ctParseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = ctParseCSVLine(lines[0]).map(h => h.trim().replace(/^"|"$/g, ''));
  return lines.slice(1).filter(l => l.trim()).map((line, idx) => {
    const values = ctParseCSVLine(line);
    const obj = { row_index: idx, row_number: idx + 1 };
    headers.forEach((h, i) => { obj[h] = (values[i] || '').trim().replace(/^"|"$/g, ''); });
    return obj;
  });
}

function ctParseJSON(text) {
  try {
    const arr = JSON.parse(text);
    if (!Array.isArray(arr)) return [];
    return arr.map((obj, idx) => ({ row_index: idx, row_number: idx + 1, ...obj }));
  } catch { return []; }
}

// ── Template engine ───────────────────────────────────────────
function ctEvaluateExpression(expr, row) {
  // Built-in functions
  const funcMatch = expr.match(/^(\w+)\((.+)\)$/);
  if (funcMatch) {
    const [, fn, argsStr] = funcMatch;
    const args = ctParseFuncArgs(argsStr, row);
    switch (fn) {
      case 'ip_inc': return ctIpInc(args[0], parseInt(args[1]) || 0);
      case 'gateway': return ctIpInc(args[0], parseInt(args[1]) || 1);
      case 'subnet_mask': return ctSubnetMask(parseInt(args[0]));
      case 'upper': return String(args[0]).toUpperCase();
      case 'lower': return String(args[0]).toLowerCase();
      case 'pad': return String(args[0]).padStart(parseInt(args[1]) || 0, args[2] || ' ');
      default: return expr;
    }
  }
  // Simple variable lookup
  if (row.hasOwnProperty(expr)) return String(row[expr]);
  // Try as literal number
  if (/^\d+$/.test(expr)) return expr;
  return expr;
}

function ctParseFuncArgs(argsStr, row) {
  const args = [];
  let current = '';
  let depth = 0;
  for (let i = 0; i < argsStr.length; i++) {
    const ch = argsStr[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      args.push(resolveArg(current.trim(), row));
      current = '';
    } else current += ch;
  }
  if (current.trim()) args.push(resolveArg(current.trim(), row));
  return args;
}

function resolveArg(arg, row) {
  // String literal
  if (/^'.*'$/.test(arg) || /^".*"$/.test(arg)) return arg.slice(1, -1);
  // Variable from row
  if (row.hasOwnProperty(arg)) return String(row[arg]);
  // IP address literal
  if (/^\d+\.\d+\.\d+\.\d+$/.test(arg)) return arg;
  // Numeric literal
  return arg;
}

function ctProcessConditionals(template, row) {
  let result = template;
  const ifRegex = /\{%\s*if\s+(.+?)\s*%\}([\s\S]*?)\{%\s*endif\s*%\}/g;
  result = result.replace(ifRegex, (_, cond, body) => {
    // Handle == comparison
    const eqMatch = cond.match(/^(\w+)\s*==\s*['"](.+?)['"]$/);
    if (eqMatch) {
      const val = row[eqMatch[1]];
      return val === eqMatch[2] ? body : '';
    }
    // Handle != comparison
    const neqMatch = cond.match(/^(\w+)\s*!=\s*['"](.+?)['"]$/);
    if (neqMatch) {
      const val = row[neqMatch[1]];
      return val !== neqMatch[2] ? body : '';
    }
    // Truthy check
    const val = row[cond];
    return val ? body : '';
  });
  return result;
}

function ctEvaluateTemplate(template, row) {
  let result = ctProcessConditionals(template, row);
  result = result.replace(/\{\{(.+?)\}\}/g, (match, expr) => {
    return ctEvaluateExpression(expr.trim(), row);
  });
  return result;
}

function ctDetectVariables(template) {
  const vars = new Set();
  const re = /\{\{(\w+)\}\}/g;
  let m;
  while ((m = re.exec(template)) !== null) {
    const v = m[1];
    if (!['row_index', 'row_number'].includes(v)) vars.add(v);
  }
  return [...vars].sort();
}

// ── Component ─────────────────────────────────────────────────
function ConfigTemplateSubstitutor({ initialData, onShare }) {
  const { t } = useTranslation();
  const [ctTemplate, setCtTemplate] = useState(initialData?.template ?? '');
  const [ctDataInput, setCtDataInput] = useState(initialData?.data ?? '');
  const [ctDataFormat, setCtDataFormat] = useState(initialData?.format ?? 'csv');
  const [ctShowRef, setCtShowRef] = useState(false);
  const [ctActiveOutput, setCtActiveOutput] = useState(0);

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'config-template', template: ctTemplate, data: ctDataInput, format: ctDataFormat });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [ctTemplate, ctDataInput, ctDataFormat, onShare]);

  const detectedVars = useMemo(() => ctDetectVariables(ctTemplate), [ctTemplate]);
  const sampleCSVHeader = useMemo(() => detectedVars.length > 0 ? detectedVars.join(',') : '', [detectedVars]);

  const parsedRows = useMemo(() => {
    if (!ctDataInput.trim()) return [];
    return ctDataFormat === 'csv' ? ctParseCSV(ctDataInput) : ctParseJSON(ctDataInput);
  }, [ctDataInput, ctDataFormat]);

  const generatedConfigs = useMemo(() => {
    if (!ctTemplate.trim() || parsedRows.length === 0) return [];
    return parsedRows.map((row, idx) => ({
      name: row.hostname || row.name || row.device || `${t('config_template.output_config')} #${idx + 1}`,
      config: ctEvaluateTemplate(ctTemplate, row),
    }));
  }, [ctTemplate, parsedRows]);

  const combinedOutput = useMemo(() => {
    const sep = '! ' + '='.repeat(70);
    return generatedConfigs.map(c =>
      `${sep}\n! Device: ${c.name}\n${sep}\n!\n${c.config}\n!`
    ).join('\n\n');
  }, [generatedConfigs]);

  const ctExportCombined = useCallback(() => {
    const blob = new Blob([combinedOutput + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'device-configs.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [combinedOutput]);

  const ctExportSingle = useCallback((config, name) => {
    const blob = new Blob([config + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, []);

  const ctExportJSON = useCallback(() => {
    exportJSON(generatedConfigs.map(c => ({ name: c.name, config: c.config })), 'device-configs.json');
  }, [generatedConfigs]);

  const ctCopy = useCopy();

  const refFunctions = [
    { fn: '{{variable}}', desc: t('config_template.ref_var') },
    { fn: '{{ip_inc(ip, offset)}}', desc: t('config_template.ref_ip_inc') },
    { fn: '{{gateway(ip, offset)}}', desc: t('config_template.ref_gateway') },
    { fn: '{{subnet_mask(prefix)}}', desc: t('config_template.ref_subnet_mask') },
    { fn: '{{upper(var)}}', desc: t('config_template.ref_upper') },
    { fn: '{{lower(var)}}', desc: t('config_template.ref_lower') },
    { fn: '{{pad(var, width, char)}}', desc: t('config_template.ref_pad') },
    { fn: '{{row_number}}', desc: t('config_template.ref_row_number') },
    { fn: '{% if var %}...{% endif %}', desc: t('config_template.ref_if') },
    { fn: '{% if var == \'val\' %}...{% endif %}', desc: t('config_template.ref_if_eq') },
  ];

  const CT_PRESETS = [
    {
      id: 'cisco_access',
      labelKey: 'config_template.preset_cisco_access',
      format: 'csv',
      template: `hostname {{hostname}}
!
no ip domain lookup
ip domain name {{domain}}
!
username admin privilege 15 secret {{enable_secret}}
enable secret {{enable_secret}}
!
interface Vlan{{mgmt_vlan}}
 description MANAGEMENT
 ip address {{mgmt_ip}} {{subnet_mask(mgmt_prefix)}}
 no shutdown
!
ip default-gateway {{gateway}}
!
line vty 0 15
 login local
 transport input ssh
!
ntp server {{ntp_server}}`,
      data: `hostname,domain,enable_secret,mgmt_vlan,mgmt_ip,mgmt_prefix,gateway,ntp_server
ACC-SW-01,corp.local,S3cr3tPass,10,10.10.10.11,24,10.10.10.1,10.0.0.1
ACC-SW-02,corp.local,S3cr3tPass,10,10.10.10.12,24,10.10.10.1,10.0.0.1
ACC-SW-03,corp.local,S3cr3tPass,10,10.10.10.13,24,10.10.10.1,10.0.0.1`,
    },
    {
      id: 'bgp_peers',
      labelKey: 'config_template.preset_bgp_peers',
      format: 'csv',
      template: `router bgp {{local_asn}}
 neighbor {{peer_ip}} remote-as {{peer_asn}}
 neighbor {{peer_ip}} description {{upper(peer_name)}}
 neighbor {{peer_ip}} password {{bgp_password}}
 neighbor {{peer_ip}} update-source Loopback0
{% if peer_type == 'rr' %}
 neighbor {{peer_ip}} route-reflector-client
{% endif %}
 !
 address-family ipv4
  neighbor {{peer_ip}} activate
  neighbor {{peer_ip}} send-community both
  neighbor {{peer_ip}} soft-reconfiguration inbound
 exit-address-family`,
      data: `local_asn,peer_ip,peer_asn,peer_name,bgp_password,peer_type
65001,10.0.0.2,65001,rr-server-1,BGPpass!1,rr
65001,10.0.0.3,65001,leaf-1,BGPpass!1,leaf
65001,10.0.0.4,65001,leaf-2,BGPpass!1,leaf`,
    },
    {
      id: 'loopbacks',
      labelKey: 'config_template.preset_loopbacks',
      format: 'csv',
      template: `hostname {{hostname}}
!
interface Loopback0
 description ROUTER-ID / MGMT
 ip address {{loopback_ip}} 255.255.255.255
 ip ospf 1 area {{ospf_area}}
!
router ospf 1
 router-id {{loopback_ip}}
 passive-interface Loopback0`,
      data: `hostname,loopback_ip,ospf_area
CORE-R1,10.255.0.1,0
CORE-R2,10.255.0.2,0
DIST-R1,10.255.1.1,1
DIST-R2,10.255.1.2,1
EDGE-R1,10.255.2.1,2`,
    },
    {
      id: 'ntp_snmp',
      labelKey: 'config_template.preset_ntp_snmp',
      format: 'csv',
      template: `hostname {{hostname}}
!
ntp server {{ntp_primary}} prefer
ntp server {{ntp_secondary}}
ntp update-calendar
!
snmp-server community {{snmp_ro}} RO
snmp-server community {{snmp_rw}} RW
snmp-server location {{location}}
snmp-server contact {{contact}}
snmp-server host {{snmp_trap_host}} version 2c {{snmp_ro}}
!
logging host {{syslog_host}}
logging trap informational`,
      data: `hostname,ntp_primary,ntp_secondary,snmp_ro,snmp_rw,location,contact,snmp_trap_host,syslog_host
CORE-SW-01,10.0.0.1,10.0.0.2,public_ro,private_rw,DC1-Rack-A1,noc@corp.local,10.1.1.100,10.1.1.200
DIST-SW-01,10.0.0.1,10.0.0.2,public_ro,private_rw,DC1-Rack-B3,noc@corp.local,10.1.1.100,10.1.1.200`,
    },
    {
      id: 'vlan_svi',
      labelKey: 'config_template.preset_vlan_svi',
      format: 'csv',
      template: `vlan {{vlan_id}}
 name {{upper(vlan_name)}}
!
interface Vlan{{vlan_id}}
 description {{vlan_name}}
 ip address {{ip_inc(network, 1)}} {{subnet_mask(prefix)}}
 ip helper-address {{dhcp_relay}}
 no shutdown`,
      data: `vlan_id,vlan_name,network,prefix,dhcp_relay
100,Users,10.100.0.0,24,10.0.0.10
200,Servers,10.200.0.0,24,10.0.0.10
300,VoIP,10.30.0.0,24,10.0.0.10
400,IoT,192.168.40.0,24,10.0.0.10`,
    },
  ];

  const ctSampleTemplate = `hostname {{hostname}}
!
interface Loopback0
 ip address {{loopback_ip}} 255.255.255.255
!
interface GigabitEthernet0/0
 ip address {{ip_inc(network, 1)}} {{subnet_mask(prefix)}}
!
{% if role == 'spine' %}
router ospf 1
 router-id {{loopback_ip}}
{% endif %}`;

  const ctSampleCSV = `hostname,loopback_ip,network,prefix,role
SPINE-01,10.0.0.1,10.1.0.0,24,spine
LEAF-01,10.0.0.2,10.1.1.0,24,leaf`;

  return (
    <div className="fadein">
      <div className="two-col" style={{ alignItems: 'start' }}>
        {/* Template */}
        <div className="card">
          <div className="card-title">{t('config_template.template_title')}</div>
          <div className="field">
            <label className="label">{t('config_template.presets_label')}</label>
            <select
              className="select"
              value=""
              onChange={e => {
                const preset = CT_PRESETS.find(p => p.id === e.target.value);
                if (!preset) return;
                setCtTemplate(preset.template);
                setCtDataInput(preset.data);
                setCtDataFormat(preset.format);
              }}
            >
              <option value="">{t('config_template.preset_none')}</option>
              {CT_PRESETS.map(p => (
                <option key={p.id} value={p.id}>{t(p.labelKey)}</option>
              ))}
            </select>
            <div className="hint" style={{ marginTop: 4 }}>{t('config_template.presets_hint')}</div>
          </div>
          <div className="field">
            <textarea
              className="input"
              rows={14}
              style={{ fontFamily: 'var(--mono)', fontSize: '0.85em', resize: 'vertical' }}
              placeholder={ctSampleTemplate}
              value={ctTemplate}
              onInput={e => setCtTemplate(e.target.value)}
            />
          </div>
          {detectedVars.length > 0 && (
            <div className="hint" style={{ marginTop: 4 }}>
              {t('config_template.detected_vars')}: {detectedVars.map(v => (
                <span key={v} className="badge badge-cyan" style={{ marginRight: 4, fontSize: '0.78em' }}>{v}</span>
              ))}
            </div>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => setCtShowRef(!ctShowRef)} style={{ marginTop: 8 }}>
            {ctShowRef ? t('config_template.hide_ref') : t('config_template.show_ref')}
          </button>
          {ctShowRef && (
            <div style={{ marginTop: 8 }}>
              <table style={{ width: '100%', fontSize: '0.82em' }}>
                <thead><tr>
                  <th style={{ textAlign: 'left', padding: '2px 6px' }}>{t('config_template.col_function')}</th>
                  <th style={{ textAlign: 'left', padding: '2px 6px' }}>{t('config_template.col_description')}</th>
                </tr></thead>
                <tbody>
                  {refFunctions.map(r => (
                    <tr key={r.fn}>
                      <td style={{ padding: '2px 6px', fontFamily: 'var(--mono)', whiteSpace: 'nowrap' }}>{r.fn}</td>
                      <td style={{ padding: '2px 6px' }}>{r.desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Data source */}
        <div className="card">
          <div className="card-title">{t('config_template.data_title')}</div>
          <div className="field">
            <label className="label">{t('config_template.format_label')}</label>
            <div className="btn-row">
              <button className={`btn btn-sm ${ctDataFormat === 'csv' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCtDataFormat('csv')}>CSV</button>
              <button className={`btn btn-sm ${ctDataFormat === 'json' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setCtDataFormat('json')}>JSON</button>
            </div>
          </div>
          <div className="field">
            <textarea
              className="input"
              rows={10}
              style={{ fontFamily: 'var(--mono)', fontSize: '0.85em', resize: 'vertical' }}
              placeholder={ctDataFormat === 'csv' ? ctSampleCSV : '[\n  { "hostname": "SW-01", "loopback_ip": "10.0.0.1" }\n]'}
              value={ctDataInput}
              onInput={e => setCtDataInput(e.target.value)}
            />
          </div>
          {sampleCSVHeader && ctDataFormat === 'csv' && !ctDataInput.trim() && (
            <div className="hint">{t('config_template.sample_header')}: <code style={{ fontFamily: 'var(--mono)' }}>{sampleCSVHeader}</code></div>
          )}
          {parsedRows.length > 0 && (
            <div className="hint">{t('config_template.rows_found', { count: parsedRows.length })}</div>
          )}
        </div>
      </div>

      {/* Results */}
      {generatedConfigs.length > 0 && (
        <>
          <div className="card" style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                {t('config_template.output_title')} ({generatedConfigs.length})
              </div>
              <div className="btn-row">
                <CopyBtn text={combinedOutput} label={t('common.copy')} id="ct-combined" />
                <button className="btn btn-ghost btn-sm" onClick={ctExportCombined}>{t('config_template.export_all')}</button>
                <button className="btn btn-ghost btn-sm" onClick={ctExportJSON}>{t('common.export')} JSON</button>
              </div>
            </div>

            {/* Tabs for individual configs */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 8, marginBottom: 8 }}>
              {generatedConfigs.map((c, i) => (
                <button
                  key={i}
                  className={`btn btn-sm ${ctActiveOutput === i ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setCtActiveOutput(i)}
                >
                  {c.name}
                </button>
              ))}
            </div>

            {generatedConfigs[ctActiveOutput] && (
              <div style={{ position: 'relative' }}>
                <pre style={{
                  background: 'var(--bg-alt)',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  padding: 12,
                  fontFamily: 'var(--mono)',
                  fontSize: '0.82em',
                  overflow: 'auto',
                  maxHeight: 400,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}>
                  {generatedConfigs[ctActiveOutput].config}
                </pre>
                <div style={{ position: 'absolute', top: 8, right: 8 }} className="btn-row">
                  <CopyBtn text={generatedConfigs[ctActiveOutput].config} label={t('common.copy')} id={`ct-out-${ctActiveOutput}`} />
                  <button className="btn btn-ghost btn-sm" onClick={() => ctExportSingle(generatedConfigs[ctActiveOutput].config, generatedConfigs[ctActiveOutput].name)}>
                    {t('common.export')}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Combined view */}
          <div className="card" style={{ marginTop: 12 }}>
            <div className="card-title">{t('config_template.combined_title')}</div>
            <pre style={{
              background: 'var(--bg-alt)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 12,
              fontFamily: 'var(--mono)',
              fontSize: '0.78em',
              overflow: 'auto',
              maxHeight: 300,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {combinedOutput}
            </pre>
          </div>
        </>
      )}

      {ctTemplate.trim() && ctDataInput.trim() && parsedRows.length === 0 && (
        <Err msg={t('config_template.err_parse_data')} />
      )}
    </div>
  );
}

window.ConfigTemplateSubstitutor = ConfigTemplateSubstitutor;
