const { useState, useCallback } = React;

const OID_PRESETS = [
  { group: 'System Info',     label: 'System Description',          oid: '1.3.6.1.2.1.1.1.0',     cmd: 'get' },
  { group: 'System Info',     label: 'System Name (sysName)',       oid: '1.3.6.1.2.1.1.5.0',     cmd: 'get' },
  { group: 'System Info',     label: 'System Uptime',               oid: '1.3.6.1.2.1.1.3.0',     cmd: 'get' },
  { group: 'System Info',     label: 'System Contact',              oid: '1.3.6.1.2.1.1.4.0',     cmd: 'get' },
  { group: 'System Info',     label: 'System Location',             oid: '1.3.6.1.2.1.1.6.0',     cmd: 'get' },
  { group: 'System Info',     label: 'SNMP Engine ID',              oid: '1.3.6.1.6.3.10.2.1.1.0',cmd: 'get' },
  { group: 'Interfaces',      label: 'Interface Table (all)',        oid: '1.3.6.1.2.1.2.2',       cmd: 'walk' },
  { group: 'Interfaces',      label: 'Interface Descriptions',      oid: '1.3.6.1.2.1.2.2.1.2',   cmd: 'walk' },
  { group: 'Interfaces',      label: 'Interface Oper Status',       oid: '1.3.6.1.2.1.2.2.1.8',   cmd: 'walk' },
  { group: 'Interfaces',      label: 'Interface Speed (ifSpeed)',   oid: '1.3.6.1.2.1.2.2.1.5',   cmd: 'walk' },
  { group: 'Interfaces',      label: 'High-Speed (ifHighSpeed GB)', oid: '1.3.6.1.2.1.31.1.1.1.15',cmd:'walk' },
  { group: 'Interfaces',      label: 'In Octets (ifInOctets)',      oid: '1.3.6.1.2.1.2.2.1.10',  cmd: 'walk' },
  { group: 'Interfaces',      label: 'Out Octets (ifOutOctets)',    oid: '1.3.6.1.2.1.2.2.1.16',  cmd: 'walk' },
  { group: 'Interfaces',      label: 'In Errors (ifInErrors)',      oid: '1.3.6.1.2.1.2.2.1.14',  cmd: 'walk' },
  { group: 'Interfaces',      label: 'Out Errors (ifOutErrors)',    oid: '1.3.6.1.2.1.2.2.1.20',  cmd: 'walk' },
  { group: 'Interfaces',      label: 'In Discards',                 oid: '1.3.6.1.2.1.2.2.1.13',  cmd: 'walk' },
  { group: 'Interfaces',      label: 'Out Discards',                oid: '1.3.6.1.2.1.2.2.1.19',  cmd: 'walk' },
  { group: 'Routing',         label: 'IP Route Table',              oid: '1.3.6.1.2.1.4.21',      cmd: 'walk' },
  { group: 'Routing',         label: 'ARP Table (ipNetToMedia)',    oid: '1.3.6.1.2.1.4.22',      cmd: 'walk' },
  { group: 'Routing',         label: 'IP Forwarding (on/off)',      oid: '1.3.6.1.2.1.4.1.0',     cmd: 'get' },
  { group: 'Cisco IOS',       label: 'CPU 5-min Utilization',       oid: '1.3.6.1.4.1.9.2.1.58.0',cmd: 'get' },
  { group: 'Cisco IOS',       label: 'CPU 1-min Utilization',       oid: '1.3.6.1.4.1.9.9.109.1.1.1.1.8.1', cmd: 'get' },
  { group: 'Cisco IOS',       label: 'Free Memory (Processor)',     oid: '1.3.6.1.4.1.9.9.48.1.1.1.6.1',    cmd: 'get' },
  { group: 'Cisco IOS',       label: 'Used Memory (Processor)',     oid: '1.3.6.1.4.1.9.9.48.1.1.1.5.1',    cmd: 'get' },
  { group: 'Cisco IOS',       label: 'BGP Peer Table',              oid: '1.3.6.1.2.1.15.3',      cmd: 'walk' },
  { group: 'Cisco IOS',       label: 'BGP Peer State',              oid: '1.3.6.1.2.1.15.3.1.2',  cmd: 'walk' },
  { group: 'Cisco IOS',       label: 'Environment Temps',           oid: '1.3.6.1.4.1.9.9.13.1.3',cmd: 'walk' },
  { group: 'Cisco IOS',       label: 'OSPF Neighbor Table',         oid: '1.3.6.1.2.1.14.10',     cmd: 'walk' },
  { group: 'Juniper',         label: 'System CPU Utilization',      oid: '1.3.6.1.4.1.2636.3.1.13.1.8',cmd:'walk' },
  { group: 'Juniper',         label: 'Routing Engine Memory Used',  oid: '1.3.6.1.4.1.2636.3.1.13.1.11',cmd:'walk' },
  { group: 'Juniper',         label: 'BGP Peer State',              oid: '1.3.6.1.4.1.2636.5.1.1.2.1.1.1.2',cmd:'walk' },
  { group: 'Juniper',         label: 'Chassis Alarm Active',        oid: '1.3.6.1.4.1.2636.3.4.2.2.1',cmd:'walk' },
  { group: 'Linux / Net-SNMP',label: 'CPU Idle (UCD-SNMP)',         oid: '1.3.6.1.4.1.2021.11.11.0',cmd:'get' },
  { group: 'Linux / Net-SNMP',label: 'Memory Total RAM',            oid: '1.3.6.1.4.1.2021.4.5.0', cmd: 'get' },
  { group: 'Linux / Net-SNMP',label: 'Memory Available',            oid: '1.3.6.1.4.1.2021.4.6.0', cmd: 'get' },
  { group: 'Linux / Net-SNMP',label: 'Disk Used %',                 oid: '1.3.6.1.4.1.2021.9.1.9', cmd: 'walk' },
  { group: 'Linux / Net-SNMP',label: 'Load Average (1m)',           oid: '1.3.6.1.4.1.2021.10.1.3.1',cmd:'get' },
];

const OID_GROUPS = [...new Set(OID_PRESETS.map(o => o.group))];

const AUTH_PROTOS   = ['MD5', 'SHA', 'SHA-224', 'SHA-256', 'SHA-384', 'SHA-512'];
const PRIV_PROTOS   = ['DES', 'AES', 'AES-128', 'AES-192', 'AES-256'];
const SNMP_VERSIONS = ['1', '2c', '3'];

function buildCommand(cfg) {
  const { cmd, host, ver, community, oid, v3user, authProto, authPass, privProto, privPass, secLevel, port, timeout, retries, bulk } = cfg;
  const portStr    = port    && port !== '161'   ? ` -p ${port}` : '';
  const toStr      = timeout && timeout !== '5'  ? ` -t ${timeout}` : '';
  const retStr     = retries && retries !== '3'  ? ` -r ${retries}` : '';
  const target     = host || '<host>';

  if (ver === '1' || ver === '2c') {
    const comm = community || 'public';
    const baseCmd = cmd === 'get' ? 'snmpget' : (cmd === 'walk' ? (ver === '2c' && bulk ? 'snmpbulkwalk' : 'snmpwalk') : 'snmpgetnext');
    const bulkOpts = (cmd === 'walk' && ver === '2c' && bulk) ? ' -Cr25' : '';
    return `${baseCmd} -v ${ver} -c ${comm}${portStr}${toStr}${retStr}${bulkOpts} ${target} ${oid || '1.3.6.1.2.1.1'}`;
  }

  // v3
  const baseCmd = cmd === 'get' ? 'snmpget' : (cmd === 'walk' ? (bulk ? 'snmpbulkwalk' : 'snmpwalk') : 'snmpgetnext');
  const bulkOpts = (cmd === 'walk' && bulk) ? ' -Cr25' : '';
  let secStr = '';
  if (secLevel === 'noAuthNoPriv') {
    secStr = ` -l noAuthNoPriv -u ${v3user || 'monitor'}`;
  } else if (secLevel === 'authNoPriv') {
    secStr = ` -l authNoPriv -u ${v3user || 'monitor'} -a ${authProto} -A '${authPass || '<authpass>'}'`;
  } else {
    secStr = ` -l authPriv -u ${v3user || 'monitor'} -a ${authProto} -A '${authPass || '<authpass>'}' -x ${privProto} -X '${privPass || '<privpass>'}'`;
  }
  return `${baseCmd} -v 3${secStr}${portStr}${toStr}${retStr}${bulkOpts} ${target} ${oid || '1.3.6.1.2.1.1'}`;
}

function SNMPBuilder({ onShare, initialData }) {
  const { t } = useTranslation();
  const [cmd,       setCmd]       = usePersistentState('snmp:cmd', 'walk');
  const [host,      setHost]      = usePersistentState('snmp:host', '192.168.1.1');
  const [ver,       setVer]       = usePersistentState('snmp:ver', '2c');
  const [community, setCommunity] = usePersistentState('snmp:community', 'public');
  const [oid,       setOid]       = usePersistentState('snmp:oid', '1.3.6.1.2.1.1');
  const [port,      setPort]      = usePersistentState('snmp:port', '161');
  const [timeout,   setTimeout_]  = usePersistentState('snmp:timeout', '5');
  const [retries,   setRetries]   = usePersistentState('snmp:retries', '3');
  const [bulk,      setBulk]      = usePersistentState('snmp:bulk', true);
  const [v3user,    setV3user]    = usePersistentState('snmp:v3user', 'monitor');
  const [secLevel,  setSecLevel]  = usePersistentState('snmp:secLevel', 'authPriv');
  const [authProto, setAuthProto] = usePersistentState('snmp:authProto', 'SHA-256');
  const [authPass,  setAuthPass]  = usePersistentState('snmp:authPass', '');
  const [privProto, setPrivProto] = usePersistentState('snmp:privProto', 'AES-256');
  const [privPass,  setPrivPass]  = usePersistentState('snmp:privPass', '');
  const [selGroup,  setSelGroup]  = usePersistentState('snmp:selGroup', 'System Info');

  const cfg = { cmd, host, ver, community, oid, v3user, authProto, authPass, privProto, privPass, secLevel, port, timeout, retries, bulk };
  const command = buildCommand(cfg);

  const groupPresets = OID_PRESETS.filter(o => o.group === selGroup);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('snmp.title', 'SNMP Command Builder')}</div>
        <div style={{fontSize:12,color:'var(--muted)',marginBottom:14}}>
          {t('snmp.subtitle', 'Build complete snmpget / snmpwalk / snmpbulkwalk commands for v1, v2c, and v3. Select from a library of common OIDs for Cisco, Juniper, and Linux.')}
        </div>

        {/* Target + Command type */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}} className="grid-mobile-1">
          <div className="field">
            <label className="label">{t('snmp.host', 'Target Host / IP')}</label>
            <input className="input" value={host} onChange={e => setHost(e.target.value)} placeholder="192.168.1.1" />
          </div>
          <div className="field">
            <label className="label">{t('snmp.command', 'Command')}</label>
            <select className="select" value={cmd} onChange={e => setCmd(e.target.value)}>
              <option value="get">snmpget — single OID</option>
              <option value="walk">snmpwalk / bulkwalk — subtree</option>
              <option value="getnext">snmpgetnext</option>
            </select>
          </div>
          <div className="field">
            <label className="label">{t('snmp.version', 'SNMP Version')}</label>
            <select className="select" value={ver} onChange={e => setVer(e.target.value)}>
              {SNMP_VERSIONS.map(v => <option key={v}>{v}</option>)}
            </select>
          </div>
        </div>

        {/* v1/v2c community */}
        {(ver === '1' || ver === '2c') && (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}} className="grid-mobile-1">
            <div className="field">
              <label className="label">{t('snmp.community', 'Community String')}</label>
              <input className="input" style={{fontFamily:'var(--mono)'}} value={community} onChange={e => setCommunity(e.target.value)} placeholder="public" />
            </div>
            <div className="field">
              <label className="label">{t('snmp.port', 'UDP Port')}</label>
              <input className="input" style={{fontFamily:'var(--mono)'}} value={port} onChange={e => setPort(e.target.value)} placeholder="161" />
            </div>
            {cmd === 'walk' && ver === '2c' && (
              <div className="field" style={{display:'flex',alignItems:'center',gap:10,paddingTop:22}}>
                <input type="checkbox" id="snmp-bulk" checked={bulk} onChange={e => setBulk(e.target.checked)}
                  style={{width:16,height:16,accentColor:'var(--cyan)',cursor:'pointer'}} />
                <label htmlFor="snmp-bulk" style={{cursor:'pointer',fontSize:13,color:'var(--text)'}}>{t('snmp.bulk', 'Use bulk walk (-Cr25)')}</label>
              </div>
            )}
          </div>
        )}

        {/* v3 options */}
        {ver === '3' && (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12,marginBottom:12}} className="grid-mobile-1">
            <div className="field">
              <label className="label">Username</label>
              <input className="input" style={{fontFamily:'var(--mono)'}} value={v3user} onChange={e => setV3user(e.target.value)} placeholder="monitor" />
            </div>
            <div className="field">
              <label className="label">Security Level</label>
              <select className="select" value={secLevel} onChange={e => setSecLevel(e.target.value)}>
                <option value="noAuthNoPriv">noAuthNoPriv</option>
                <option value="authNoPriv">authNoPriv</option>
                <option value="authPriv">authPriv (recommended)</option>
              </select>
            </div>
            <div className="field">
              <label className="label">UDP Port</label>
              <input className="input" style={{fontFamily:'var(--mono)'}} value={port} onChange={e => setPort(e.target.value)} placeholder="161" />
            </div>
            {secLevel !== 'noAuthNoPriv' && (
              <>
                <div className="field">
                  <label className="label">Auth Protocol</label>
                  <select className="select" value={authProto} onChange={e => setAuthProto(e.target.value)}>
                    {AUTH_PROTOS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Auth Password</label>
                  <input className="input" type="password" value={authPass} onChange={e => setAuthPass(e.target.value)} placeholder="Min 8 chars" />
                </div>
              </>
            )}
            {secLevel === 'authPriv' && (
              <>
                <div className="field">
                  <label className="label">Privacy Protocol</label>
                  <select className="select" value={privProto} onChange={e => setPrivProto(e.target.value)}>
                    {PRIV_PROTOS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label className="label">Privacy Password</label>
                  <input className="input" type="password" value={privPass} onChange={e => setPrivPass(e.target.value)} placeholder="Min 8 chars" />
                </div>
              </>
            )}
          </div>
        )}

        {/* OID picker */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:4}} className="grid-mobile-1">
          <div className="field">
            <label className="label">{t('snmp.oid', 'OID')}</label>
            <input className="input" style={{fontFamily:'var(--mono)'}} value={oid} onChange={e => setOid(e.target.value)} placeholder="1.3.6.1.2.1.1" />
          </div>
          <div className="field">
            <label className="label">{t('snmp.oid_group', 'OID Library Group')}</label>
            <select className="select" value={selGroup} onChange={e => setSelGroup(e.target.value)}>
              {OID_GROUPS.map(g => <option key={g}>{g}</option>)}
            </select>
          </div>
        </div>
        <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:16}}>
          {groupPresets.map(p => (
            <button key={p.oid} className="btn btn-ghost" style={{fontSize:11,padding:'3px 10px'}}
              onClick={() => { setOid(p.oid); if (p.cmd !== 'walk' || cmd !== 'walk') setCmd(p.cmd); }}
              title={p.oid}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Generated command */}
      <div className="card fadein">
        <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:10}}>
          <div className="card-title" style={{marginBottom:0}}>{t('snmp.generated', 'Generated Command')}</div>
          <CopyBtn text={command} label="common.copy" id="snmp-copy" />
        </div>
        <pre style={{fontFamily:'var(--mono)',fontSize:12,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'12px 14px',color:'var(--cyan)',lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-all',margin:0}}>{command}</pre>

        {ver === '1' && (
          <div style={{marginTop:10,padding:10,background:'var(--panel)',borderLeft:'4px solid #e05252',borderRadius:4,fontSize:11,color:'var(--muted)'}}>
            <strong style={{color:'#e05252'}}>Security:</strong> SNMPv1 transmits community strings in plaintext and has no authentication. Use v3 with authPriv in production environments.
          </div>
        )}
        {ver === '2c' && (
          <div style={{marginTop:10,padding:10,background:'var(--panel)',borderLeft:'4px solid #e0c452',borderRadius:4,fontSize:11,color:'var(--muted)'}}>
            <strong style={{color:'#e0c452'}}>Security:</strong> SNMPv2c uses plaintext community strings. Restrict SNMP access with an ACL on the device and firewall rules. Prefer v3 authPriv for new deployments.
          </div>
        )}
        {ver === '3' && secLevel === 'authPriv' && (
          <div style={{marginTop:10,padding:10,background:'var(--panel)',borderLeft:'4px solid #52c4a8',borderRadius:4,fontSize:11,color:'var(--muted)'}}>
            <strong style={{color:'#52c4a8'}}>Recommended:</strong> SNMPv3 authPriv with SHA-256/AES-256 is current best practice. SHA/MD5 and DES are legacy and should be avoided on new deployments.
          </div>
        )}

        <div style={{marginTop:14,padding:12,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)'}}>
          <div style={{fontSize:11,fontWeight:600,color:'var(--text)',marginBottom:8}}>Related Commands</div>
          <pre style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--muted)',margin:0,lineHeight:1.7,whiteSpace:'pre-wrap'}}>
{`# Test connectivity (ping SNMP port):
nc -zu ${host || '<host>'} ${port || '161'}

# MIB module information:
snmptranslate -Td ${oid || '1.3.6.1.2.1.1'}

# List all OIDs in subtree (numeric):
snmpwalk -v ${ver} ${ver !== '3' ? `-c ${community || 'public'}` : `-l ${secLevel} -u ${v3user || 'monitor'}`} -On ${host || '<host>'} ${oid || '1.3.6.1.2.1.1'}

# Trap listener (receive traps on port 162):
snmptrapd -f -Lo -c /etc/snmp/snmptrapd.conf`}
          </pre>
        </div>
      </div>
    </div>
  );
}

window.SNMPBuilder = SNMPBuilder;
