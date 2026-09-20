// ─── RADIUS / TACACS+ Attribute Quick Reference ──────────────
const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── RADIUS Attribute Data ────────────────────────────────────
const RADIUS_ATTRS = [
  // RFC 2865 Core
  { num: 1,  name: 'User-Name',            type: 'string',   length: 'var',    rfc: '2865' },
  { num: 2,  name: 'User-Password',        type: 'string',   length: 'var',    rfc: '2865' },
  { num: 3,  name: 'CHAP-Password',        type: 'octets',   length: '19',     rfc: '2865' },
  { num: 4,  name: 'NAS-IP-Address',       type: 'ipaddr',   length: '6',      rfc: '2865' },
  { num: 5,  name: 'NAS-Port',             type: 'integer',  length: '6',      rfc: '2865' },
  { num: 6,  name: 'Service-Type',         type: 'integer',  length: '6',      rfc: '2865' },
  { num: 7,  name: 'Framed-Protocol',      type: 'integer',  length: '6',      rfc: '2865' },
  { num: 8,  name: 'Framed-IP-Address',    type: 'ipaddr',   length: '6',      rfc: '2865' },
  { num: 9,  name: 'Framed-IP-Netmask',    type: 'ipaddr',   length: '6',      rfc: '2865' },
  { num: 10, name: 'Framed-Routing',       type: 'integer',  length: '6',      rfc: '2865' },
  { num: 11, name: 'Filter-Id',            type: 'string',   length: 'var',    rfc: '2865' },
  { num: 12, name: 'Framed-MTU',           type: 'integer',  length: '6',      rfc: '2865' },
  { num: 13, name: 'Framed-Compression',   type: 'integer',  length: '6',      rfc: '2865' },
  { num: 14, name: 'Login-IP-Host',        type: 'ipaddr',   length: '6',      rfc: '2865' },
  { num: 15, name: 'Login-Service',        type: 'integer',  length: '6',      rfc: '2865' },
  { num: 16, name: 'Login-TCP-Port',       type: 'integer',  length: '6',      rfc: '2865' },
  { num: 18, name: 'Reply-Message',        type: 'string',   length: 'var',    rfc: '2865' },
  { num: 19, name: 'Callback-Number',      type: 'string',   length: 'var',    rfc: '2865' },
  { num: 20, name: 'Callback-Id',          type: 'string',   length: 'var',    rfc: '2865' },
  { num: 22, name: 'Framed-Route',         type: 'string',   length: 'var',    rfc: '2865' },
  { num: 23, name: 'Framed-IPX-Network',   type: 'integer',  length: '6',      rfc: '2865' },
  { num: 24, name: 'State',                type: 'octets',   length: 'var',    rfc: '2865' },
  { num: 25, name: 'Class',                type: 'octets',   length: 'var',    rfc: '2865' },
  { num: 26, name: 'Vendor-Specific',      type: 'octets',   length: 'var',    rfc: '2865' },
  { num: 27, name: 'Session-Timeout',      type: 'integer',  length: '6',      rfc: '2865' },
  { num: 28, name: 'Idle-Timeout',         type: 'integer',  length: '6',      rfc: '2865' },
  { num: 29, name: 'Termination-Action',   type: 'integer',  length: '6',      rfc: '2865' },
  { num: 30, name: 'Called-Station-Id',    type: 'string',   length: 'var',    rfc: '2865' },
  { num: 31, name: 'Calling-Station-Id',   type: 'string',   length: 'var',    rfc: '2865' },
  { num: 32, name: 'NAS-Identifier',       type: 'string',   length: 'var',    rfc: '2865' },
  { num: 33, name: 'Proxy-State',          type: 'octets',   length: 'var',    rfc: '2865' },
  { num: 34, name: 'Login-LAT-Service',    type: 'string',   length: 'var',    rfc: '2865' },
  { num: 35, name: 'Login-LAT-Node',       type: 'string',   length: 'var',    rfc: '2865' },
  { num: 36, name: 'Login-LAT-Group',      type: 'octets',   length: '34',     rfc: '2865' },
  { num: 37, name: 'Framed-AppleTalk-Link',    type: 'integer', length: '6',   rfc: '2865' },
  { num: 38, name: 'Framed-AppleTalk-Network', type: 'integer', length: '6',   rfc: '2865' },
  { num: 39, name: 'Framed-AppleTalk-Zone',    type: 'string',  length: 'var', rfc: '2865' },
  // RFC 2866 Accounting
  { num: 40, name: 'Acct-Status-Type',     type: 'integer',  length: '6',      rfc: '2866' },
  { num: 41, name: 'Acct-Delay-Time',      type: 'integer',  length: '6',      rfc: '2866' },
  { num: 42, name: 'Acct-Input-Octets',    type: 'integer',  length: '6',      rfc: '2866' },
  { num: 43, name: 'Acct-Output-Octets',   type: 'integer',  length: '6',      rfc: '2866' },
  { num: 44, name: 'Acct-Session-Id',      type: 'string',   length: 'var',    rfc: '2866' },
  { num: 45, name: 'Acct-Authentic',       type: 'integer',  length: '6',      rfc: '2866' },
  { num: 46, name: 'Acct-Session-Time',    type: 'integer',  length: '6',      rfc: '2866' },
  { num: 47, name: 'Acct-Input-Packets',   type: 'integer',  length: '6',      rfc: '2866' },
  { num: 48, name: 'Acct-Output-Packets',  type: 'integer',  length: '6',      rfc: '2866' },
  { num: 49, name: 'Acct-Terminate-Cause', type: 'integer',  length: '6',      rfc: '2866' },
  { num: 50, name: 'Acct-Multi-Session-Id',type: 'string',   length: 'var',    rfc: '2866' },
  { num: 51, name: 'Acct-Link-Count',      type: 'integer',  length: '6',      rfc: '2866' },
  // RFC 2869 Extensions
  { num: 52, name: 'Acct-Input-Gigawords', type: 'integer',  length: '6',      rfc: '2869' },
  { num: 53, name: 'Acct-Output-Gigawords',type: 'integer',  length: '6',      rfc: '2869' },
  { num: 55, name: 'Event-Timestamp',      type: 'date',     length: '6',      rfc: '2869' },
  { num: 60, name: 'CHAP-Challenge',       type: 'octets',   length: 'var',    rfc: '2865' },
  { num: 61, name: 'NAS-Port-Type',        type: 'integer',  length: '6',      rfc: '2865' },
  { num: 62, name: 'Port-Limit',           type: 'integer',  length: '6',      rfc: '2865' },
  { num: 63, name: 'Login-LAT-Port',       type: 'string',   length: 'var',    rfc: '2865' },
  // RFC 2869 continued
  { num: 68, name: 'Acct-Input-Gigawords', type: 'integer',  length: '6',      rfc: '2869' },
  { num: 69, name: 'Acct-Output-Gigawords',type: 'integer',  length: '6',      rfc: '2869' },
  { num: 70, name: 'ARAP-Password',        type: 'octets',   length: '10',     rfc: '2869' },
  { num: 71, name: 'ARAP-Features',        type: 'octets',   length: '14',     rfc: '2869' },
  { num: 72, name: 'ARAP-Zone-Access',     type: 'integer',  length: '6',      rfc: '2869' },
  { num: 73, name: 'ARAP-Security',        type: 'integer',  length: '6',      rfc: '2869' },
  { num: 74, name: 'ARAP-Security-Data',   type: 'string',   length: 'var',    rfc: '2869' },
  { num: 75, name: 'Password-Retry',       type: 'integer',  length: '6',      rfc: '2869' },
  { num: 76, name: 'Prompt',               type: 'integer',  length: '6',      rfc: '2869' },
  { num: 77, name: 'Connect-Info',         type: 'string',   length: 'var',    rfc: '2869' },
  { num: 78, name: 'Configuration-Token', type: 'string',    length: 'var',    rfc: '2869' },
  { num: 79, name: 'EAP-Message',          type: 'octets',   length: 'var',    rfc: '2869' },
  { num: 80, name: 'Message-Authenticator',type: 'octets',   length: '18',     rfc: '2869' },
  { num: 84, name: 'ARAP-Challenge-Response', type: 'octets', length: '10',    rfc: '2869' },
  { num: 85, name: 'Acct-Interim-Interval',type: 'integer',  length: '6',      rfc: '2869' },
  { num: 87, name: 'NAS-Port-Id',          type: 'string',   length: 'var',    rfc: '2869' },
  { num: 88, name: 'Framed-Pool',          type: 'string',   length: 'var',    rfc: '2869' },
  // RFC 3162 IPv6
  { num: 95, name: 'NAS-IPv6-Address',     type: 'ipv6addr', length: '18',     rfc: '3162' },
  { num: 96, name: 'Framed-Interface-Id',  type: 'ifid',     length: '10',     rfc: '3162' },
  { num: 97, name: 'Framed-IPv6-Prefix',   type: 'ipv6prefix','length': 'var', rfc: '3162' },
  { num: 98, name: 'Login-IPv6-Host',      type: 'ipv6addr', length: '18',     rfc: '3162' },
  { num: 99, name: 'Framed-IPv6-Route',    type: 'string',   length: 'var',    rfc: '3162' },
  { num: 100,name: 'Framed-IPv6-Pool',     type: 'string',   length: 'var',    rfc: '3162' },
  // Cisco VSA (Type 26, Vendor 9)
  { num: '26/9/1',  name: 'Cisco-AV-Pair (cisco-avpair)',      type: 'string', length: 'var', rfc: '2865' },
  { num: '26/9/2',  name: 'Cisco-NAS-Port (cisco-nas-port)',    type: 'string', length: 'var', rfc: '2865' },
  { num: '26/9/15', name: 'Cisco-Priv-Level (cisco-priv-lvl)', type: 'integer',length: 'var', rfc: '2865' },
  { num: '26/9/227',name: 'Cisco-Service-Info (cisco-service-info)', type: 'string', length: 'var', rfc: '2865' },
  { num: '26/9/252',name: 'Cisco-Command (cisco-command)',      type: 'string', length: 'var', rfc: '2865' },
];

// ─── TACACS+ AV Pair Data ─────────────────────────────────────
const TACACS_ATTRS = [
  // Authentication
  { attr: 'action',      service: 'authen', ios_ex: '', freetacacs_ex: '' },
  { attr: 'authen_type', service: 'authen', ios_ex: '', freetacacs_ex: '' },
  { attr: 'service',     service: 'authen', ios_ex: 'aaa authentication login default group tacacs+', freetacacs_ex: 'service = ppp' },
  // Shell / Exec
  { attr: 'priv-lvl',    service: 'shell',  ios_ex: 'username test privilege 15', freetacacs_ex: 'priv-lvl = 15' },
  { attr: 'cmd',         service: 'shell',  ios_ex: 'aaa authorization commands 15 default group tacacs+', freetacacs_ex: 'cmd = show\ncmd-arg = version' },
  { attr: 'cmd-arg',     service: 'shell',  ios_ex: '', freetacacs_ex: 'cmd-arg = version' },
  { attr: 'autocmd',     service: 'shell',  ios_ex: '', freetacacs_ex: 'autocmd = show version' },
  { attr: 'noescape',    service: 'shell',  ios_ex: '', freetacacs_ex: 'noescape = true' },
  { attr: 'nohangup',    service: 'shell',  ios_ex: '', freetacacs_ex: 'nohangup = true' },
  { attr: 'timeout',     service: 'shell',  ios_ex: '', freetacacs_ex: 'timeout = 600' },
  { attr: 'idletime',    service: 'shell',  ios_ex: '', freetacacs_ex: 'idletime = 10' },
  // PPP IP
  { attr: 'addr',        service: 'ppp/ip', ios_ex: 'ppp ip address pool radius', freetacacs_ex: 'addr = 10.0.0.100' },
  { attr: 'addr-pool',   service: 'ppp/ip', ios_ex: 'ip local pool mypool 10.0.0.1 10.0.0.254', freetacacs_ex: 'addr-pool = mypool' },
  { attr: 'inacl',       service: 'ppp/ip', ios_ex: '', freetacacs_ex: 'inacl = 101' },
  { attr: 'outacl',      service: 'ppp/ip', ios_ex: '', freetacacs_ex: 'outacl = 102' },
  { attr: 'route',       service: 'ppp/ip', ios_ex: '', freetacacs_ex: 'route = 192.168.1.0 255.255.255.0' },
  { attr: 'routing',     service: 'ppp/ip', ios_ex: '', freetacacs_ex: 'routing = true' },
  { attr: 'source-ip',   service: 'ppp/ip', ios_ex: '', freetacacs_ex: 'source-ip = 10.0.0.1' },
  // PPP IPX
  { attr: 'ipx-network', service: 'ppp/ipx',ios_ex: '', freetacacs_ex: 'ipx-network = 100' },
  { attr: 'ipx-pool',    service: 'ppp/ipx',ios_ex: '', freetacacs_ex: 'ipx-pool = ipxpool1' },
  // SLIP
  { attr: 'slip-address',service: 'slip',   ios_ex: '', freetacacs_ex: 'addr = 10.0.0.5' },
  // ARAP
  { attr: 'zone',        service: 'arap',   ios_ex: '', freetacacs_ex: 'zone = myzone' },
  { attr: 'callback-dialstring', service: 'arap', ios_ex: '', freetacacs_ex: 'callback-dialstring = 14155551234' },
  { attr: 'nocallback-verify',   service: 'arap', ios_ex: '', freetacacs_ex: 'nocallback-verify = true' },
  { attr: 'callback-line',       service: 'arap', ios_ex: '', freetacacs_ex: 'callback-line = 1' },
  { attr: 'callback-rotary',     service: 'arap', ios_ex: '', freetacacs_ex: 'callback-rotary = 1' },
  // Common
  { attr: 'tunnel-id',   service: 'common', ios_ex: '', freetacacs_ex: 'tunnel-id = vpdn1' },
  { attr: 'gw-password', service: 'common', ios_ex: '', freetacacs_ex: 'gw-password = secret' },
  { attr: 'svc-enabled', service: 'common', ios_ex: '', freetacacs_ex: 'svc-enabled = true' },
  { attr: 'old-prompts', service: 'common', ios_ex: '', freetacacs_ex: 'old-prompts = false' },
  // Accounting
  { attr: 'task_id',     service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'start_time',  service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'stop_time',   service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'elapsed_time',service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'status',      service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'disc-cause',  service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'disc-cause-ext', service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'bytes_in',    service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'bytes_out',   service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'paks_in',     service: 'acct', ios_ex: '', freetacacs_ex: '' },
  { attr: 'paks_out',    service: 'acct', ios_ex: '', freetacacs_ex: '' },
];

// ─── Comparison Data ──────────────────────────────────────────
const COMPARE_ROWS = [
  { feature: 'transport' },
  { feature: 'encryption' },
  { feature: 'aaa_separation' },
  { feature: 'accounting' },
  { feature: 'multiprotocol' },
  { feature: 'standard' },
  { feature: 'open_servers' },
  { feature: 'vendor_support' },
  { feature: 'authz_granularity' },
  { feature: 'ipv6_support' },
  { feature: 'reliability' },
  { feature: 'typical_use' },
];

// ─── Component ───────────────────────────────────────────────
function RadiusTacacsRef({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('radius-tacacs-tab', 'radius');
  const [radiusSearch, setRadiusSearch] = usePersistentState('radius-tacacs-rsearch', '');
  const [tacacsSearch, setTacacsSearch] = usePersistentState('radius-tacacs-tsearch', '');

  // AV Pair Builder state
  const [builderMode, setBuilderMode] = usePersistentState('radius-tacacs-bmode', 'cisco-shell');
  const [privLevel, setPrivLevel] = usePersistentState('radius-tacacs-priv', '15');
  const [autocmd, setAutocmd] = usePersistentState('radius-tacacs-autocmd', '');
  const [aclIn, setAclIn] = usePersistentState('radius-tacacs-acl-in', '');
  const [aclOut, setAclOut] = usePersistentState('radius-tacacs-acl-out', '');
  const [idleTimeout, setIdleTimeout] = usePersistentState('radius-tacacs-idle', '');
  const [frUsername, setFrUsername] = usePersistentState('radius-tacacs-fr-user', '');
  const [frRows, setFrRows] = usePersistentState('radius-tacacs-fr-rows', [{ attr: 'Service-Type', value: 'Administrative' }]);
  const [tacacsUsername, setTacacsUsername] = usePersistentState('radius-tacacs-tc-user', '');

  const [copied, copy] = useCopy();
  const radiusSearchRef = useRef(null);
  const tacacsSearchRef = useRef(null);

  // Load from share URL
  useEffect(() => {
    if (initialData && initialData.tool === 'radius-tacacs') {
      if (initialData.tab) setActiveTab(initialData.tab);
      if (initialData.search) {
        if (initialData.tab === 'radius') setRadiusSearch(initialData.search);
        else if (initialData.tab === 'tacacs') setTacacsSearch(initialData.search);
      }
    }
  }, []);

  // Share URL
  useEffect(() => {
    const handler = (e) => {
      const search = activeTab === 'radius' ? radiusSearch : (activeTab === 'tacacs' ? tacacsSearch : '');
      e.detail.respond({ tool: 'radius-tacacs', tab: activeTab, search });
    };
    window.addEventListener('app:request-share', handler);
    return () => window.removeEventListener('app:request-share', handler);
  }, [activeTab, radiusSearch, tacacsSearch]);

  // Apply-down: sidebar sub-row → switch tab on already-mounted component
  useEffect(() => {
    if (initialData?.tab && initialData.tab !== activeTab) setActiveTab(initialData.tab);
  }, [initialData]);

  // Report-up: tab change → sidebar highlight follows
  useEffect(() => { onNav?.({ tab: activeTab }); }, [activeTab]);

  // Auto-focus search on tab switch
  useEffect(() => {
    if (activeTab === 'radius' && radiusSearchRef.current) radiusSearchRef.current.focus();
    if (activeTab === 'tacacs' && tacacsSearchRef.current) tacacsSearchRef.current.focus();
  }, [activeTab]);

  // Filtered RADIUS attributes
  const filteredRadius = useMemo(() => {
    const q = radiusSearch.toLowerCase().trim();
    const allWithI18n = RADIUS_ATTRS.map(a => {
      const keyPrefix = `r_${String(a.num).replace(/\//g, '_')}`;
      return {
        ...a,
        desc: t(`radius_tacacs.${keyPrefix}_desc`),
        values: t(`radius_tacacs.${keyPrefix}_vals`)
      };
    });
    if (!q) return allWithI18n;
    return allWithI18n.filter(a =>
      String(a.num).includes(q) ||
      a.name.toLowerCase().includes(q) ||
      a.type.toLowerCase().includes(q) ||
      a.rfc.includes(q) ||
      a.desc.toLowerCase().includes(q) ||
      a.values.toLowerCase().includes(q)
    );
  }, [radiusSearch, t]);

  // Filtered TACACS+ attrs
  const filteredTacacs = useMemo(() => {
    const q = tacacsSearch.toLowerCase().trim();
    const allWithI18n = TACACS_ATTRS.map(a => {
      const keyPrefix = `t_${a.attr.replace(/-/g, '_')}`;
      return {
        ...a,
        desc: t(`radius_tacacs.${keyPrefix}_desc`),
        values: t(`radius_tacacs.${keyPrefix}_vals`)
      };
    });
    if (!q) return allWithI18n;
    return allWithI18n.filter(a =>
      a.attr.toLowerCase().includes(q) ||
      a.service.toLowerCase().includes(q) ||
      a.values.toLowerCase().includes(q) ||
      a.desc.toLowerCase().includes(q)
    );
  }, [tacacsSearch, t]);

  // AV Pair Builder output
  const builderOutput = useMemo(() => {
    if (builderMode === 'cisco-shell') {
      const lines = ['service=shell', `priv-lvl=${privLevel}`];
      if (autocmd) lines.push(`autocmd=${autocmd}`);
      if (aclIn) lines.push(`inacl=${aclIn}`);
      if (aclOut) lines.push(`outacl=${aclOut}`);
      if (idleTimeout) lines.push(`idletime=${idleTimeout}`);
      return lines.join('\n');
    }
    if (builderMode === 'freeradius') {
      const user = frUsername || 'username';
      const attrLines = frRows.map(r => `\t${r.attr} = ${r.value || '"value"'}`).join(',\n');
      return `${user} Auth-Type := Local, User-Password == "changeme"\n${attrLines}`;
    }
    if (builderMode === 'tac_plus') {
      const user = tacacsUsername || 'username';
      const lines = [`user = ${user} {`, `\tdefault service = deny`, `\tlogin = des "password"`, `\tservice = shell {`, `\t\tdefault attribute = permit`, `\t\tset priv-lvl = ${privLevel}`];
      if (autocmd) lines.push(`\t\tset autocmd = "${autocmd}"`);
      if (aclIn) lines.push(`\t\tset inacl = "${aclIn}"`);
      if (aclOut) lines.push(`\t\tset outacl = "${aclOut}"`);
      if (idleTimeout) lines.push(`\t\tset idletime = ${idleTimeout}`);
      lines.push('\t}', '}');
      return lines.join('\n');
    }
    return '';
  }, [builderMode, privLevel, autocmd, aclIn, aclOut, idleTimeout, frUsername, frRows, tacacsUsername]);

  const addFrRow = () => setFrRows(prev => [...prev, { attr: 'Framed-IP-Address', value: '' }]);
  const removeFrRow = (i) => setFrRows(prev => prev.filter((_, idx) => idx !== i));
  const updateFrRow = (i, field, val) => setFrRows(prev => prev.map((r, idx) => idx === i ? { ...r, [field]: val } : r));

  const tabs = [
    { id: 'radius', label: t('radius_tacacs.tab_radius') },
    { id: 'tacacs', label: t('radius_tacacs.tab_tacacs') },
    { id: 'builder', label: t('radius_tacacs.tab_builder') },
    { id: 'compare', label: t('radius_tacacs.tab_compare') },
  ];

  const rfcColor = rfc => {
    if (rfc === '2865') return 'var(--cyan)';
    if (rfc === '2866') return 'var(--green)';
    if (rfc === '2869') return 'var(--yellow)';
    if (rfc === '3162') return 'var(--purple)';
    return 'var(--muted)';
  };

  const serviceColor = svc => {
    if (svc === 'shell') return 'var(--cyan)';
    if (svc === 'ppp/ip' || svc === 'ppp/ipx') return 'var(--green)';
    if (svc === 'acct') return 'var(--yellow)';
    if (svc === 'authen') return 'var(--purple)';
    if (svc === 'common') return 'var(--muted)';
    return 'var(--text)';
  };

  return (
    <div className="fadein">
      <style>{`
        .rt-table { width:100%; border-collapse:collapse; font-size:12px; font-family:var(--mono); }
        .rt-table th { position:sticky; top:0; background:var(--panel); color:var(--muted); font-weight:600; text-align:left; padding:8px 10px; border-bottom:1px solid var(--border); font-size:11px; text-transform:uppercase; letter-spacing:.04em; z-index:2; }
        .rt-table td { padding:6px 10px; border-bottom:1px solid var(--border); vertical-align:top; line-height:1.4; }
        .rt-table tr:hover td { background:rgba(0,212,200,.04); }
        .rt-num { color:var(--cyan); font-weight:700; min-width:48px; }
        .rt-name { color:var(--text); font-weight:600; white-space:nowrap; }
        .rt-type { color:var(--green); font-size:11px; }
        .rt-len { color:var(--muted); font-size:11px; }
        .rt-desc { color:var(--dim); font-size:11px; max-width:240px; }
        .rt-vals { color:var(--yellow); font-size:10px; max-width:200px; word-break:break-word; }
        .rt-attr { color:var(--cyan); font-weight:700; }
        .rt-svc { font-size:10px; padding:2px 6px; border-radius:4px; background:rgba(0,212,200,.08); }
        .rt-code { font-family:var(--mono); font-size:11px; background:var(--panel); padding:2px 5px; border-radius:3px; color:var(--green); }
        .rt-build-output { font-family:var(--mono); font-size:12px; background:var(--panel); border:1px solid var(--border); border-radius:6px; padding:14px; white-space:pre; overflow-x:auto; min-height:80px; color:var(--cyan); line-height:1.6; }
        .rt-compare table { width:100%; border-collapse:collapse; font-size:12px; }
        .rt-compare th { background:var(--panel); padding:9px 12px; text-align:left; font-size:11px; font-weight:700; text-transform:uppercase; color:var(--muted); border-bottom:2px solid var(--border); }
        .rt-compare td { padding:8px 12px; border-bottom:1px solid var(--border); vertical-align:middle; }
        .rt-compare tr:hover td { background:rgba(0,212,200,.03); }
        .rt-feature { color:var(--text); font-weight:600; min-width:160px; }
        .rt-radius-cell { color:var(--cyan); }
        .rt-tacacs-cell { color:var(--green); }
        .rt-search-bar { display:flex; gap:8px; align-items:center; }
        .rt-count { font-size:11px; color:var(--muted); white-space:nowrap; }
      `}</style>

      <div className="card">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {tabs.map(tab => (
            <button key={tab.id} className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab(tab.id)}>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Tab 1: RADIUS Attributes ── */}
      {activeTab === 'radius' && (
        <div className="card fadein" style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'12px 14px', borderBottom:'1px solid var(--border)', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
            <div style={{flex:1, minWidth:200}}>
              <input ref={radiusSearchRef} className="input" style={{width:'100%'}} value={radiusSearch}
                onChange={e => setRadiusSearch(e.target.value)}
                placeholder={t('radius_tacacs.search_radius')} />
            </div>
            <span className="rt-count">
              {filteredRadius.length} / {RADIUS_ATTRS.length} {t('radius_tacacs.attrs')}
            </span>
          </div>
          <div style={{overflowX:'auto', maxHeight:'calc(100vh - 280px)', overflowY:'auto'}}>
            <table className="rt-table">
              <thead>
                <tr>
                  <th>{t('radius_tacacs.col_num')}</th>
                  <th>{t('radius_tacacs.col_name')}</th>
                  <th>{t('radius_tacacs.col_type')}</th>
                  <th>{t('radius_tacacs.col_length')}</th>
                  <th>{t('radius_tacacs.col_rfc')}</th>
                  <th>{t('radius_tacacs.col_desc')}</th>
                  <th>{t('radius_tacacs.col_values')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredRadius.map((a, i) => (
                  <tr key={i}>
                    <td className="rt-num">{a.num}</td>
                    <td className="rt-name">{a.name}</td>
                    <td className="rt-type">{a.type}</td>
                    <td className="rt-len">{a.length}</td>
                    <td style={{whiteSpace:'nowrap'}}>
                      <a href={`https://www.rfc-editor.org/rfc/rfc${a.rfc}.html`} target="_blank" rel="noopener"
                        style={{color: rfcColor(a.rfc), textDecoration:'none', fontWeight:600}}>
                        RFC {a.rfc}
                      </a>
                    </td>
                    <td className="rt-desc">{a.desc}</td>
                    <td className="rt-vals">{a.values || <span style={{color:'var(--border)'}}>—</span>}</td>
                  </tr>
                ))}
                {filteredRadius.length === 0 && (
                  <tr><td colSpan={7} style={{textAlign:'center', padding:24, color:'var(--muted)'}}>{t('radius_tacacs.no_results')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 2: TACACS+ AV Pairs ── */}
      {activeTab === 'tacacs' && (
        <div className="card fadein" style={{padding:0,overflow:'hidden'}}>
          <div style={{padding:'12px 14px', borderBottom:'1px solid var(--border)', display:'flex', gap:10, alignItems:'center', flexWrap:'wrap'}}>
            <div style={{flex:1, minWidth:200}}>
              <input ref={tacacsSearchRef} className="input" style={{width:'100%'}} value={tacacsSearch}
                onChange={e => setTacacsSearch(e.target.value)}
                placeholder={t('radius_tacacs.search_tacacs')} />
            </div>
            <span className="rt-count">
              {filteredTacacs.length} / {TACACS_ATTRS.length} {t('radius_tacacs.pairs')}
            </span>
          </div>
          <div style={{overflowX:'auto', maxHeight:'calc(100vh - 280px)', overflowY:'auto'}}>
            <table className="rt-table">
              <thead>
                <tr>
                  <th>{t('radius_tacacs.col_attr')}</th>
                  <th>{t('radius_tacacs.col_service')}</th>
                  <th>{t('radius_tacacs.col_values')}</th>
                  <th>{t('radius_tacacs.col_ios_example')}</th>
                  <th>{t('radius_tacacs.col_tacacs_example')}</th>
                  <th>{t('radius_tacacs.col_desc')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredTacacs.map((a, i) => (
                  <tr key={i}>
                    <td className="rt-attr">{a.attr}</td>
                    <td><span className="rt-svc" style={{color: serviceColor(a.service)}}>{a.service}</span></td>
                    <td className="rt-vals">{a.values}</td>
                    <td>{a.ios_ex ? <code className="rt-code">{a.ios_ex}</code> : <span style={{color:'var(--border)'}}>—</span>}</td>
                    <td>{a.freetacacs_ex ? <code className="rt-code">{a.freetacacs_ex}</code> : <span style={{color:'var(--border)'}}>—</span>}</td>
                    <td className="rt-desc">{a.desc}</td>
                  </tr>
                ))}
                {filteredTacacs.length === 0 && (
                  <tr><td colSpan={6} style={{textAlign:'center', padding:24, color:'var(--muted)'}}>{t('radius_tacacs.no_results')}</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab 3: AV Pair Builder ── */}
      {activeTab === 'builder' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title" style={{marginBottom:12}}>{t('radius_tacacs.builder_title')}</div>
            <div style={{marginBottom:14}}>
              <label className="label">{t('radius_tacacs.builder_mode')}</label>
              <div style={{display:'flex', gap:6, flexWrap:'wrap'}}>
                {[
                  { id: 'cisco-shell', label: t('radius_tacacs.mode_cisco_shell') },
                  { id: 'freeradius', label: t('radius_tacacs.mode_freeradius') },
                  { id: 'tac_plus', label: t('radius_tacacs.mode_tac_plus') },
                ].map(m => (
                  <button key={m.id}
                    className={`btn ${builderMode === m.id ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                    onClick={() => setBuilderMode(m.id)}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>

            {(builderMode === 'cisco-shell' || builderMode === 'tac_plus') && (
              <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(200px, 1fr))', gap:10, marginBottom:14}}>
                <div>
                  <label className="label">{t('radius_tacacs.field_priv_level')}</label>
                  <select className="select" value={privLevel} onChange={e => setPrivLevel(e.target.value)}>
                    {Array.from({length:16},(_,i)=>i).map(n =>
                      <option key={n} value={n}>{n}{n===0?' (min)':n===15?' (root)':''}</option>
                    )}
                  </select>
                </div>
                <div>
                  <label className="label">{t('radius_tacacs.field_autocmd')}</label>
                  <input className="input" value={autocmd} onChange={e => setAutocmd(e.target.value)} placeholder="show version" />
                </div>
                <div>
                  <label className="label">{t('radius_tacacs.field_acl_in')}</label>
                  <input className="input" value={aclIn} onChange={e => setAclIn(e.target.value)} placeholder="MGMT_IN" />
                </div>
                <div>
                  <label className="label">{t('radius_tacacs.field_acl_out')}</label>
                  <input className="input" value={aclOut} onChange={e => setAclOut(e.target.value)} placeholder="MGMT_OUT" />
                </div>
                <div>
                  <label className="label">{t('radius_tacacs.field_idle_timeout')}</label>
                  <input className="input" value={idleTimeout} onChange={e => setIdleTimeout(e.target.value)} placeholder="10 (min)" />
                </div>
                {builderMode === 'tac_plus' && (
                  <div>
                    <label className="label">{t('radius_tacacs.field_username')}</label>
                    <input className="input" value={tacacsUsername} onChange={e => setTacacsUsername(e.target.value)} placeholder="netadmin" />
                  </div>
                )}
              </div>
            )}

            {builderMode === 'freeradius' && (
              <div style={{marginBottom:14}}>
                <div style={{marginBottom:10}}>
                  <label className="label">{t('radius_tacacs.field_username')}</label>
                  <input className="input" style={{maxWidth:300}} value={frUsername} onChange={e => setFrUsername(e.target.value)} placeholder="netadmin" />
                </div>
                <label className="label">{t('radius_tacacs.field_attributes')}</label>
                {frRows.map((row, i) => (
                  <div key={i} style={{display:'flex', gap:6, marginBottom:6, alignItems:'center'}}>
                    <input className="input" style={{flex:1, minWidth:120}} value={row.attr}
                      onChange={e => updateFrRow(i, 'attr', e.target.value)} placeholder="Attribute" />
                    <input className="input" style={{flex:1, minWidth:120}} value={row.value}
                      onChange={e => updateFrRow(i, 'value', e.target.value)} placeholder="Value" />
                    <button className="btn btn-ghost btn-sm" style={{color:'var(--red)'}} onClick={() => removeFrRow(i)}>✕</button>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={addFrRow}>
                  + {t('radius_tacacs.add_attr')}
                </button>
              </div>
            )}
          </div>

          <div className="card">
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10}}>
              <div className="card-title" style={{marginBottom:0, fontSize:13}}>{t('radius_tacacs.builder_output')}</div>
              <CopyBtn text={builderOutput} id="radius-tacacs-copy-all" />
            </div>
            <div className="rt-build-output">{builderOutput}</div>
          </div>
        </div>
      )}

      {/* ── Tab 4: RADIUS vs TACACS+ Comparison ── */}
      {activeTab === 'compare' && (
        <div className="card fadein rt-compare">
          <div className="card-title" style={{marginBottom:16}}>{t('radius_tacacs.compare_title')}</div>
          <div style={{overflowX:'auto'}}>
            <table>
              <thead>
                <tr>
                  <th>{t('radius_tacacs.col_feature')}</th>
                  <th style={{color:'var(--cyan)'}}>{t('radius_tacacs.col_radius')}</th>
                  <th style={{color:'var(--green)'}}>{t('radius_tacacs.col_tacacs')}</th>
                </tr>
              </thead>
              <tbody>
                {COMPARE_ROWS.map((row, i) => (
                  <tr key={i}>
                    <td className="rt-feature">{t(`radius_tacacs.feat_${row.feature}`)}</td>
                    <td className="rt-radius-cell">{t(`radius_tacacs.feat_${row.feature}_r`)}</td>
                    <td className="rt-tacacs-cell">{t(`radius_tacacs.feat_${row.feature}_t`)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

window.RadiusTacacsRef = RadiusTacacsRef;
