const { useState, useEffect, useMemo, useRef } = React;

// <rdns-engine>
const RDNS_MODES = ['v4', 'rfc2317', 'v6'];
const RDNS_STYLES = ['dash', 'slash', 'range'];
const RDNS_FORMATS = ['bind', 'unbound'];
const RDNS_MAX_ENUM = 4096;      // hosts enumerated from the prefix; beyond this only imported hosts get PTRs
const RDNS_MAX_IMPORT = 4096;    // import lines
// ponytail: fixed SOA timers (DNSZoneBuilder defaults); expose as inputs if anyone asks.
const RDNS_SOA_TIMERS = [['3600', 'refresh'], ['900', 'retry'], ['604800', 'expire'], ['300', 'minimum']];
const RDNS_TOKENS = ['ip', 'dashes', 'octets', 'octet1', 'octet2', 'octet3', 'octet4', 'hex', 'v6hextets', 'n'];

function rdnsParseV4(s) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
  if (!m) return null;
  let n = 0n;
  for (let i = 1; i <= 4; i++) {
    if (m[i].length > 1 && m[i][0] === '0') return null;          // no leading zeros (octal ambiguity)
    const o = Number(m[i]); if (o > 255) return null;
    n = (n << 8n) | BigInt(o);
  }
  return n;
}

// ponytail: no embedded-IPv4 (::ffff:a.b.c.d) or zone-id (%eth0) forms; add if asked.
function rdnsParseV6(s) {
  s = String(s).trim().toLowerCase();
  if (!/^[0-9a-f:]+$/.test(s) || s.includes(':::')) return null;
  const halves = s.split('::');
  if (halves.length > 2) return null;
  const part = h => (h === '' ? [] : h.split(':'));
  const head = part(halves[0]), tail = halves.length === 2 ? part(halves[1]) : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (halves.length === 2 ? fill < 1 : head.length !== 8) return null;
  const groups = [...head, ...Array(fill).fill('0'), ...tail];
  let n = 0n;
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << 16n) | BigInt(parseInt(g, 16));
  }
  return n;
}

const rdnsBits = fam => (fam === 4 ? 32 : 128);
const rdnsMask = (fam, len) => ((1n << BigInt(rdnsBits(fam))) - 1n) ^ ((1n << BigInt(rdnsBits(fam) - len)) - 1n);

function rdnsFmtV4(n) { return [24n, 16n, 8n, 0n].map(s => String((n >> s) & 255n)).join('.'); }
function rdnsHextets(n) { const h = []; for (let i = 7; i >= 0; i--) h.push(Number((n >> BigInt(i * 16)) & 0xffffn)); return h; }
// RFC 5952: lowercase, no leading zeros, longest run (>=2) of zero groups → '::', first run on tie.
function rdnsFmtV6(n) {
  const h = rdnsHextets(n);
  let best = -1, bestLen = 1;
  for (let i = 0; i < 8;) {
    if (h[i] !== 0) { i++; continue; }
    let j = i; while (j < 8 && h[j] === 0) j++;
    if (j - i > bestLen) { best = i; bestLen = j - i; }
    i = j;
  }
  const hx = h.map(x => x.toString(16));
  if (best < 0) return hx.join(':');
  return hx.slice(0, best).join(':') + '::' + hx.slice(best + bestLen).join(':');
}
const rdnsFmt = (fam, n) => (fam === 4 ? rdnsFmtV4(n) : rdnsFmtV6(n));
const rdnsNibbles = n => n.toString(16).padStart(32, '0');

// Reverse owner name for the first `len` bits (len multiple of 8 / 4), absolute with trailing dot.
function rdnsZoneName(fam, addr, len) {
  if (fam === 4) {
    const o = rdnsFmtV4(addr).split('.').slice(0, len / 8).reverse();
    return (o.length ? o.join('.') + '.' : '') + 'in-addr.arpa.';
  }
  const nib = rdnsNibbles(addr).slice(0, len / 4).split('').reverse();
  return (nib.length ? nib.join('.') + '.' : '') + 'ip6.arpa.';
}
const rdnsPtrName = (fam, addr) => rdnsZoneName(fam, addr, rdnsBits(fam));

// "198.51.100.64/27" → { fam, net, len, hostBits } | { err: { key, vars } }
function rdnsParseCidr(text, mode) {
  const s = String(text || '').trim();
  if (!s) return { err: { key: '' } };                              // silent while empty
  const m = /^([^/\s]+)\/(\d{1,3})$/.exec(s);
  if (!m) return { err: { key: 'err_cidr_format' } };
  const fam = mode === 'v6' ? 6 : 4;
  const addr = fam === 4 ? rdnsParseV4(m[1]) : rdnsParseV6(m[1]);
  if (addr === null) return { err: { key: fam === 4 ? 'err_ipv4' : 'err_ipv6', vars: { value: m[1] } } };
  const len = Number(m[2]);
  const [lo, hi] = mode === 'v4' ? [8, 24] : mode === 'rfc2317' ? [25, 32] : [4, 128];
  if (len < lo || len > hi) return { err: { key: 'err_len_' + mode, vars: { len } } };
  const net = addr & rdnsMask(fam, len);
  return { fam, net, len, hostBits: rdnsBits(fam) - len, hostBitsSet: net !== addr };
}

// Template → name for one address. Unknown token / wrong family → { err }.
function rdnsRender(tpl, fam, addr, net) {
  let err = null;
  const v4 = fam === 4 ? rdnsFmtV4(addr).split('.') : null;
  const out = String(tpl).replace(/\{([^{}]*)\}/g, (m, tok) => {
    if (err) return m;
    switch (tok) {
      case 'ip': return fam === 4 ? v4.join('.') : rdnsFmtV6(addr).replace(/:/g, '-');
      case 'dashes': return fam === 4 ? v4.join('-') : rdnsHextets(addr).map(x => x.toString(16)).join('-');
      case 'octets': if (fam === 4) return v4.slice().reverse().join('.'); break;
      case 'octet1': case 'octet2': case 'octet3': case 'octet4':
        if (fam === 4) return v4[Number(tok[5]) - 1]; break;
      case 'hex': return addr.toString(16).padStart(fam === 4 ? 8 : 32, '0');
      case 'v6hextets': if (fam === 6) return rdnsHextets(addr).map(x => x.toString(16).padStart(4, '0')).join('-'); break;
      case 'n': return String(addr - net);
      default: err = { key: 'err_token_unknown', vars: { token: m } }; return m;
    }
    err = { key: 'err_token_family', vars: { token: m } };
    return m;
  });
  return err ? { err } : { name: out };
}

// Hostname check for PTR targets / NS names. Returns null (ok) or an i18n key.
function rdnsCheckHost(name) {
  const s = String(name);
  if (!s) return 'err_host_empty';
  const body = s.endsWith('.') ? s.slice(0, -1) : s;
  if (!body || body.length > 253) return 'err_host_len';
  for (const l of body.split('.')) {
    if (!l || l.length > 63) return 'err_host_label_len';
    if (!/^[A-Za-z0-9-]+$/.test(l)) return 'err_host_chars';
    if (l[0] === '-' || l[l.length - 1] === '-') return 'err_host_hyphen';
  }
  return null;
}

// Import text: "IP[, ;\t]hostname" per line; '#' comments; a non-IP first field on line 1 = CSV header.
// → { rows: Map(key → { addr, name, line }), issues }
function rdnsParseImport(text, P) {
  const rows = new Map(), issues = [];
  let seen = false;
  const lines = String(text || '').split('\n');
  if (lines.length > RDNS_MAX_IMPORT) issues.push({ level: 'err', key: 'imp_too_many', vars: { max: RDNS_MAX_IMPORT } });
  lines.slice(0, RDNS_MAX_IMPORT).forEach((raw, i) => {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) return;
    const [ipTxt, nameTxt = ''] = line.split(/[\s,;]+/);
    const addr = P.fam === 4 ? rdnsParseV4(ipTxt) : rdnsParseV6(ipTxt);
    const vars = { line: i + 1, value: ipTxt };
    if (addr === null) {
      if (!seen) { seen = true; return; }                            // first data line not an IP = CSV header
      const other = P.fam === 4 ? rdnsParseV6(ipTxt) : rdnsParseV4(ipTxt);
      issues.push({ level: 'warn', key: other === null ? 'imp_bad_ip' : 'imp_family', vars });
      return;
    }
    seen = true;
    if ((addr & rdnsMask(P.fam, P.len)) !== P.net) { issues.push({ level: 'warn', key: 'imp_foreign', vars }); return; }
    const k = addr.toString();
    if (rows.has(k)) issues.push({ level: 'warn', key: 'imp_dup', vars: { ...vars, first: rows.get(k).line } });
    rows.set(k, { addr, name: nameTxt, line: i + 1 });
  });
  return { rows, issues };
}

function rdnsRname(r) {
  const s = String(r || '').trim();
  const at = s.indexOf('@');
  if (at < 0) return s;
  const out = s.slice(0, at).replace(/\./g, '\\.') + '.' + s.slice(at + 1);
  return out.endsWith('.') ? out : out + '.';
}

function rdnsZoneFile(origin, o, ownerRecs) {
  const w = Math.max(8, ...ownerRecs.map(r => r[0].length)) + 2;
  const L = ['$ORIGIN ' + origin, '$TTL ' + o.ttl, '',
    '@ IN SOA ' + o.ns[0] + ' ' + o.rname + ' (',
    '    ' + String(o.serial).padEnd(10) + ' ; serial', ...RDNS_SOA_TIMERS.map(([v, c]) => '    ' + v.padEnd(10) + ' ; ' + c), '    )'];
  o.ns.forEach(n => L.push('@'.padEnd(w) + 'IN NS     ' + n));
  L.push('');
  ownerRecs.forEach(([own, type, data]) => L.push(own.padEnd(w) + 'IN ' + type.padEnd(6) + ' ' + data));
  return L.join('\n');
}

const rdnsRel = (full, origin) => (full === origin ? '@' : full.slice(0, -(origin.length + 1)));

// cfg: { mode, cidr, template, imports, overrides:{ [addrDecimal]: string|false }, ns, rname, ttl, serial, style, skipEnds }
// → { err:{key,vars} } | { P, zones, records, cnames, issues, missing, enumerated, bind, bindParent, unbound }
function rdnsBuild(cfg) {
  const mode = RDNS_MODES.includes(cfg.mode) ? cfg.mode : 'v4';
  const P = rdnsParseCidr(cfg.cidr, mode);
  if (P.err) return P;
  const fam = P.fam, issues = [];
  if (P.hostBitsSet) issues.push({ level: 'warn', key: 'w_host_bits', vars: { net: rdnsFmt(fam, P.net) + '/' + P.len } });

  const ttl = String(cfg.ttl ?? '').trim(), serial = String(cfg.serial ?? '').trim();
  if (!/^\d{1,10}$/.test(ttl) || Number(ttl) > 2147483647) return { err: { key: 'err_ttl' } };
  if (!/^\d{1,10}$/.test(serial) || Number(serial) < 1 || Number(serial) > 4294967295) return { err: { key: 'err_serial' } };
  const ns = String(cfg.ns || '').split(/[\s,]+/).filter(Boolean);
  if (!ns.length) return { err: { key: 'err_ns_required' } };
  for (const n of ns) {
    const k = rdnsCheckHost(n);
    if (k) return { err: { key: 'err_ns', vars: { name: n, why: k } } };
    if (!n.endsWith('.')) issues.push({ level: 'warn', key: 'w_ns_not_fqdn', vars: { name: n } });
  }
  const rname = rdnsRname(cfg.rname);
  if (!rname) return { err: { key: 'err_rname' } };
  // \. is a legal escaped dot in RNAME (user@domain with dots in the local part).
  const rnameBad = rdnsCheckHost(rname.replace(/\\\./g, '-'));
  if (rnameBad) issues.push({ level: 'warn', key: 'w_rname_invalid', vars: { name: rname, why: rnameBad } });
  else if (!rname.endsWith('.')) issues.push({ level: 'warn', key: 'w_rname_not_fqdn', vars: { name: rname } });

  const tpl = String(cfg.template || '').trim();
  if (tpl) { const t = rdnsRender(tpl, fam, P.net, P.net); if (t.err) return t; }

  const imp = rdnsParseImport(cfg.imports, P);
  issues.push(...imp.issues);

  // Host set: enumerate the prefix when small enough, plus every imported address.
  const total = 1n << BigInt(P.hostBits);
  const enumerated = total <= BigInt(RDNS_MAX_ENUM);
  const skip = fam === 4 && cfg.skipEnds !== false && P.len <= 30;
  const hosts = new Map();
  if (enumerated) for (let i = 0n; i < total; i++) {
    if (skip && (i === 0n || i === total - 1n)) continue;
    hosts.set((P.net + i).toString(), P.net + i);
  } else issues.push({ level: 'info', key: 'i_no_enum', vars: { max: RDNS_MAX_ENUM } });
  for (const [k, r] of imp.rows) hosts.set(k, r.addr);
  const addrs = [...hosts.values()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const ov = cfg.overrides && typeof cfg.overrides === 'object' ? cfg.overrides : {};
  const zoneLen = mode === 'rfc2317' ? 24 : Math.ceil(P.len / (fam === 4 ? 8 : 4)) * (fam === 4 ? 8 : 4);
  const parentZone = mode === 'rfc2317' ? rdnsZoneName(4, P.net, 24) : null;
  const first = Number(P.net & 255n), last = first + Number(total) - 1;
  const label = mode !== 'rfc2317' ? null
    : cfg.style === 'slash' ? first + '/' + P.len
    : cfg.style === 'range' ? first + '-' + last
    : first + '-' + P.len;
  const childZone = label === null ? null : label + '.' + parentZone;

  const records = [], missing = [], zoneMap = new Map();
  let notFqdn = 0;
  for (const a of addrs) {
    const k = a.toString(), r = imp.rows.get(k);
    const ptr = rdnsPtrName(fam, a);
    const zone = childZone || rdnsZoneName(fam, a, zoneLen);
    const owner = childZone ? String(Number(a & 255n)) : rdnsRel(ptr, zone);
    const rec = { key: k, ip: rdnsFmt(fam, a), ptr, zone, owner, name: '', src: 'tpl', deleted: false, bad: null };
    if (ov[k] === false) { rec.deleted = true; rec.src = 'edit'; }
    else if (typeof ov[k] === 'string') { rec.name = ov[k].trim(); rec.src = 'edit'; }
    else if (r && r.name) { rec.name = r.name; rec.src = 'imp'; }
    else if (tpl) rec.name = rdnsRender(tpl, fam, a, P.net).name;
    if (rec.name) {
      rec.bad = rdnsCheckHost(rec.name);
      if (!rec.bad && !rec.name.endsWith('.')) notFqdn++;
    }
    if (rec.deleted || !rec.name) missing.push(rec.ip);
    if (rec.bad) issues.push({ level: 'err', key: 'err_ptr_name', vars: { ip: rec.ip, name: rec.name, why: rec.bad } });
    records.push(rec);
    if (!zoneMap.has(zone)) zoneMap.set(zone, []);
    zoneMap.get(zone).push(rec);
  }
  if (notFqdn) issues.push({ level: 'warn', key: 'w_not_fqdn', vars: { count: notFqdn } });
  if (missing.length && mode !== 'rfc2317') {
    issues.push({ level: 'warn', key: 'w_missing', vars: { count: missing.length, first: missing.slice(0, 5).join(', ') } });
  }

  const live = recs => recs.filter(r => r.name && !r.deleted && !r.bad);
  // Zone list: every aligned zone under the prefix, even when empty (so /22 → four /24 files).
  const step = 1n << BigInt(rdnsBits(fam) - zoneLen);
  const zones = [];
  if (childZone) zones.push(childZone);
  else for (let z = P.net; z < P.net + total; z += step) zones.push(rdnsZoneName(fam, z, zoneLen));
  const o = { ns, rname, ttl, serial };
  const bind = zones.map(z => rdnsZoneFile(z, o, live(zoneMap.get(z) || []).map(r => [r.owner, 'PTR', r.name]))).join('\n\n');

  // RFC 2317 parent side: NS for the child label + a CNAME per address in the block (all of it, so the
  // child can add PTRs without touching the parent). Targets are absolute.
  let cnames = [], bindParent = null;
  if (childZone) {
    const liveKeys = new Set(live(records).map(r => r.key));
    for (let i = 0n; i < total; i++) {
      const a = P.net + i;
      // skipEnds drops network/broadcast, except an imported end that has a PTR
      // (otherwise the child PTR has no parent CNAME and can never resolve).
      if (skip && (i === 0n || i === total - 1n) && !liveKeys.has(a.toString())) continue;
      const oct = String(Number(a & 255n));
      cnames.push({ owner: oct, target: oct + '.' + childZone });
    }
    const w = Math.max(8, label.length) + 2;
    bindParent = ['$ORIGIN ' + parentZone,
      ...ns.map(n => label.padEnd(w) + 'IN NS     ' + n),
      ...cnames.map(c => c.owner.padEnd(w) + 'IN CNAME  ' + c.target)].join('\n');
    const cnameOwners = new Set(cnames.map(c => c.owner));
    const dangling = records.filter(r => cnameOwners.has(r.owner) && (r.deleted || !r.name));
    if (dangling.length) {
      issues.push({
        level: 'warn',
        key: 'w_dangling_cname',
        vars: { count: dangling.length, first: dangling.slice(0, 5).map(r => r.ip).join(', ') },
      });
    }
  }

  // Unbound: resolver-local data. RFC 2317 indirection is collapsed (PTR at the real in-addr name);
  // the /24 is 'transparent' so the rest of it still resolves upstream.
  const U = ['server:'];
  if (childZone) U.push('  local-zone: "' + parentZone + '" transparent');
  else zones.forEach(z => U.push('  local-zone: "' + z + '" static'));
  live(records).forEach(r => U.push('  local-data: "' + r.ptr + ' ' + ttl + ' IN PTR ' + (r.name.endsWith('.') ? r.name : r.name + '.') + '"'));
  const unbound = U.join('\n');

  return { P, mode, zones, records, cnames, parentZone, childZone, label, issues, missing, enumerated, bind, bindParent, unbound };
}
// </rdns-engine>

const RDNS_EXAMPLES = { v4: '192.0.2.0/24', rfc2317: '198.51.100.64/27', v6: '2001:db8:acad::/48' };
const RDNS_DEF_TEMPLATE = { v4: 'host-{dashes}.example.net.', rfc2317: 'host-{dashes}.example.net.', v6: '' };
const RDNS_IMPORT_PLACEHOLDER = '198.51.100.65,gw.example.net.\n198.51.100.70 mail.example.net.';
const RDNS_TABLE_MAX = 256;
const RDNS_RELATED = [
  { id: 'dns-zone-builder', key: 'related_dns_zone' },
  { id: 'dns', key: 'related_dns_lookup' },
  { id: 'subnet', key: 'related_subnet' },
  { id: 'ipv6subnet', key: 'related_ipv6_subnet' },
];
const RDNS_FMTS = ['bind', 'parent', 'unbound'];
const rdnsTodaySerial = () => {
  const d = new Date();
  return String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '01';
};

const rdnsHydrateMode = (v) => (RDNS_MODES.includes(v) ? v : 'v4');
const rdnsHydrateStyle = (v) => (RDNS_STYLES.includes(v) ? v : 'dash');
const rdnsHydrateFmt = (v, mode) => {
  const f = RDNS_FMTS.includes(v) ? v : 'bind';
  return (f === 'parent' && mode !== 'rfc2317') ? 'bind' : f;
};
const rdnsStr = (v, d, n) => String(v ?? d).slice(0, n);

function rdnsHydrateOverrides(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  let n = 0;
  for (const k of Object.keys(raw)) {
    if (n >= 4096) break;
    if (!/^\d{1,39}$/.test(k)) continue;
    const v = raw[k];
    if (v === false) { out[k] = false; n++; }
    else if (typeof v === 'string') { out[k] = v.slice(0, 253); n++; }
  }
  return out;
}

const rdnsTokOff = (tok, fam) => (fam === 6
  ? (tok === 'octets' || tok === 'octet1' || tok === 'octet2' || tok === 'octet3' || tok === 'octet4')
  : tok === 'v6hextets');

const rdnsIsCidrErr = (key) => !!(key && /^(err_cidr|err_ipv|err_len)/.test(key));

function ReverseDNSGenerator({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const skipNavReport = useRef(false);

  const initMode = rdnsHydrateMode(initialData?.mode);

  const [mode, setMode] = usePersistentState('rdns:mode', initMode);
  const [cidr, setCidr] = usePersistentState('rdns:cidr', rdnsStr(initialData?.cidr, RDNS_EXAMPLES[initMode], 64));
  const [template, setTemplate] = usePersistentState('rdns:template', rdnsStr(initialData?.template, RDNS_DEF_TEMPLATE[initMode], 253));
  const [style, setStyle] = usePersistentState('rdns:style', rdnsHydrateStyle(initialData?.style));
  const [skipEnds, setSkipEnds] = usePersistentState('rdns:skipEnds', initialData?.skipEnds !== false);
  const [ns, setNs] = usePersistentState('rdns:ns', rdnsStr(initialData?.ns, 'ns1.example.net. ns2.example.net.', 1024));
  const [rname, setRname] = usePersistentState('rdns:rname', rdnsStr(initialData?.rname, 'hostmaster.example.net.', 253));
  const [ttl, setTtl] = usePersistentState('rdns:ttl', rdnsStr(initialData?.ttl, '3600', 10));
  const [serial, setSerial] = usePersistentState('rdns:serial', rdnsStr(initialData?.serial, rdnsTodaySerial(), 10));
  const [imports, setImports] = usePersistentState('rdns:imports', rdnsStr(initialData?.imports, '', 200000));
  const [overrides, setOverrides] = usePersistentState('rdns:overrides', rdnsHydrateOverrides(initialData?.overrides));
  const [fmt, setFmt] = usePersistentState('rdns:fmt', rdnsHydrateFmt(initialData?.fmt, initMode));
  const [filter, setFilter] = useState('');

  const applyMode = (newMode) => {
    if (!RDNS_MODES.includes(newMode) || newMode === mode) return;
    const parsed = rdnsParseCidr(cidr, newMode);
    if (parsed.err) setCidr(RDNS_EXAMPLES[newMode]);
    if (!template.trim() || template === RDNS_DEF_TEMPLATE[mode]) setTemplate(RDNS_DEF_TEMPLATE[newMode]);
    setOverrides({});
    if (fmt === 'parent' && newMode !== 'rfc2317') setFmt('bind');
    setMode(newMode);
  };

  useEffect(() => {
    if (RDNS_MODES.includes(initialData?.mode) && initialData.mode !== mode) {
      skipNavReport.current = true;
      applyMode(initialData.mode);
    }
  }, [initialData]);

  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ mode });
  }, [mode]);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'rdns-generator', mode, cidr, template, style, skipEnds, ns, rname, ttl, serial, imports, overrides, fmt,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [onShare, mode, cidr, template, style, skipEnds, ns, rname, ttl, serial, imports, overrides, fmt]);

  const result = useMemo(() => rdnsBuild({ mode, cidr, template, imports, overrides, ns, rname, ttl, serial, style, skipEnds }),
    [mode, cidr, template, imports, overrides, ns, rname, ttl, serial, style, skipEnds]);
  const errMsg = result.err && result.err.key
    ? t('rdns_generator.' + result.err.key, { ...(result.err.vars || {}), why: result.err.vars?.why ? t('rdns_generator.' + result.err.vars.why) : '' })
    : '';
  const outText = result.err ? '' : fmt === 'unbound' ? result.unbound : (fmt === 'parent' ? (result.bindParent || '') : result.bind);
  const preview = useMemo(() => {
    const P = rdnsParseCidr(cidr, mode);
    if (P.err || !template.trim()) return null;
    const first = P.fam === 4 && P.len <= 30 && skipEnds ? P.net + 1n : P.net;
    const r = rdnsRender(template.trim(), P.fam, first, P.net);
    return r.err ? null : { ip: rdnsFmt(P.fam, first), name: r.name };
  }, [cidr, mode, template, skipEnds]);
  const shown = result.records ? result.records.filter(r => !filter || r.ip.includes(filter) || r.name.toLowerCase().includes(filter.toLowerCase())) : [];

  const fam = mode === 'v6' ? 6 : 4;
  const styleExamples = useMemo(() => {
    const P = rdnsParseCidr(cidr, 'rfc2317');
    if (P.err) return null;
    const total = Number(1n << BigInt(P.hostBits));
    const first = Number(P.net & 255n);
    const last = first + total - 1;
    return {
      dash: first + '-' + P.len,
      slash: first + '/' + P.len,
      range: first + '-' + last,
    };
  }, [cidr]);

  const liveCount = result.records ? result.records.filter(r => r.name && !r.deleted && !r.bad).length : 0;
  const copyRecords = shown.length
    ? [t('rdns_generator.col_ip'), t('rdns_generator.col_ptr'), t('rdns_generator.col_name'), t('rdns_generator.col_src')].join('\t') + '\n' +
      shown.map(r => [r.ip, r.owner, (r.deleted || !r.name) ? '-' : r.name, t('rdns_generator.src_' + r.src)].join('\t')).join('\n')
    : '';
  const issueText = (i) => t('rdns_generator.' + i.key, { ...(i.vars || {}), why: i.vars?.why ? t('rdns_generator.' + i.vars.why) : undefined });
  const badgeFor = (level) => (level === 'err' ? 'badge-red' : level === 'warn' ? 'badge-yellow' : 'badge-green');
  const cidrErr = rdnsIsCidrErr(result.err && result.err.key);
  const rows = shown.slice(0, RDNS_TABLE_MAX);
  const hasEdits = Object.keys(overrides).length > 0;
  const fmtOrder = mode === 'rfc2317' ? ['parent', 'bind', 'unbound'] : ['bind', 'unbound'];
  const noteKey = (fmt === 'unbound' && mode === 'rfc2317') ? 'note_unbound_2317' : ('note_' + fmt);

  const th = { padding: '8px 10px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 10, textTransform: 'uppercase', whiteSpace: 'nowrap' };
  const td = { padding: '7px 10px', borderBottom: '1px solid var(--border)', fontFamily: 'var(--mono)', fontSize: 12, verticalAlign: 'middle' };

  const goRelated = (id) => window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: id } }));

  const exportJson = () => {
    if (result.err) return;
    exportJSON({
      tool: 'rdns-generator',
      mode,
      cidr: result.P ? rdnsFmt(result.P.fam, result.P.net) + '/' + result.P.len : cidr,
      zones: result.zones,
      parentZone: result.parentZone,
      childZone: result.childZone,
      records: result.records.map(r => ({ ip: r.ip, ptr: r.ptr, name: r.deleted ? null : r.name, source: r.src })),
      cnames: result.cnames,
      issues: result.issues.map(i => i.key),
    }, 'rdns-' + (result.zones?.[0] || 'zone').replace(/\.$/, '') + '.json');
  };

  const setRecName = (key, value) => setOverrides(o => ({ ...o, [key]: value }));
  const delRec = (key) => setOverrides(o => ({ ...o, [key]: false }));
  const restoreRec = (key) => setOverrides(o => { const { [key]: _, ...rest } = o; return rest; });

  const styleLabel = (id) => {
    const base = t('rdns_generator.style_' + id);
    return styleExamples ? (base + ' (' + styleExamples[id] + ')') : base;
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('rdns_generator.title')}</div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
          {t('rdns_generator.subtitle')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RDNS_MODES.map(id => (
            <button
              key={id}
              className={`btn btn-sm ${mode === id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => applyMode(id)}
            >
              {t('rdns_generator.mode_' + id)}
            </button>
          ))}
        </div>
        <div className="hint" style={{ marginTop: 8 }}>{t('rdns_generator.mode_hint_' + mode)}</div>
      </div>

      <div className="card">
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('rdns_generator.cidr_label')}</label>
            <input
              className="input"
              value={cidr}
              onChange={e => setCidr(e.target.value)}
              placeholder={RDNS_EXAMPLES[mode]}
              style={{ fontFamily: 'var(--mono)' }}
            />
            <div className="hint">{t('rdns_generator.cidr_hint_' + mode)}</div>
            {cidrErr ? <Err msg={errMsg} /> : null}
          </div>
          <div className="field">
            <label className="label">{t('rdns_generator.template_label')}</label>
            <input
              className="input"
              value={template}
              onChange={e => setTemplate(e.target.value)}
              style={{ fontFamily: 'var(--mono)' }}
            />
            <div className="hint">{t('rdns_generator.template_hint')}</div>
            {preview ? (
              <div className="hint" style={{ fontFamily: 'var(--mono)', marginTop: 6 }}>
                {t('rdns_generator.template_preview', { ip: preview.ip, name: preview.name })}
              </div>
            ) : null}
          </div>
        </div>

        <div className="card-title" style={{ marginTop: 12 }}>{t('rdns_generator.tokens_title')}</div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>
              {RDNS_TOKENS.map(tok => (
                <tr key={tok} style={{ opacity: rdnsTokOff(tok, fam) ? 0.5 : 1 }}>
                  <td style={{ ...td, width: 140, color: 'var(--cyan)' }}>{'{' + tok + '}'}</td>
                  <td style={{ ...td, fontFamily: 'inherit' }}>{t('rdns_generator.tok_' + tok)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {mode === 'rfc2317' ? (
          <div className="field" style={{ marginTop: 12 }}>
            <label className="label">{t('rdns_generator.style_label')}</label>
            <select className="select" value={style} onChange={e => setStyle(e.target.value)} style={{ fontFamily: 'var(--mono)' }}>
              {RDNS_STYLES.map(id => (
                <option key={id} value={id}>{styleLabel(id)}</option>
              ))}
            </select>
            <div className="hint">{t('rdns_generator.style_hint')}</div>
          </div>
        ) : null}

        {mode !== 'v6' ? (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                id="rdns-skip-ends"
                checked={skipEnds}
                onChange={e => setSkipEnds(e.target.checked)}
              />
              <label htmlFor="rdns-skip-ends" style={{ fontSize: 12, cursor: 'pointer' }}>
                {t('rdns_generator.skip_ends_label')}
              </label>
            </div>
            <div className="hint">{t('rdns_generator.skip_ends_hint')}</div>
          </div>
        ) : null}
      </div>

      <div className="card">
        <div className="card-title">{t('rdns_generator.soa_title')}</div>
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('rdns_generator.ns_label')}</label>
            <input className="input" value={ns} onChange={e => setNs(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
            <div className="hint">{t('rdns_generator.ns_hint')}</div>
          </div>
          <div className="field">
            <label className="label">{t('rdns_generator.rname_label')}</label>
            <input className="input" value={rname} onChange={e => setRname(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
            <div className="hint">{t('rdns_generator.rname_hint')}</div>
          </div>
          <div className="field">
            <label className="label">{t('rdns_generator.ttl_label')}</label>
            <input className="input" value={ttl} onChange={e => setTtl(e.target.value)} style={{ fontFamily: 'var(--mono)' }} />
          </div>
          <div className="field">
            <label className="label">{t('rdns_generator.serial_label')}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input className="input" value={serial} onChange={e => setSerial(e.target.value)} style={{ fontFamily: 'var(--mono)', flex: 1 }} />
              <button className="btn btn-sm btn-ghost" onClick={() => setSerial(rdnsTodaySerial())}>
                {t('rdns_generator.serial_today')}
              </button>
            </div>
            <div className="hint">{t('rdns_generator.serial_hint')}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="field">
          <label className="label">{t('rdns_generator.import_label')}</label>
          <textarea
            className="input"
            rows={6}
            value={imports}
            onChange={e => setImports(e.target.value)}
            placeholder={RDNS_IMPORT_PLACEHOLDER}
            style={{ fontFamily: 'var(--mono)', resize: 'vertical' }}
          />
          <div className="hint">{t('rdns_generator.import_hint')}</div>
        </div>
      </div>

      {!cidrErr ? <Err msg={errMsg} /> : null}

      {!result.err ? (
        <div className="card">
          <div className="result-grid grid-mobile-1">
            <ResultItem
              label={t('rdns_generator.fact_zones')}
              value={String(result.zones.length)}
              sub={<span style={{ fontFamily: 'var(--mono)' }}>{result.zones[0]}</span>}
            />
            <ResultItem label={t('rdns_generator.fact_records')} value={String(liveCount)} />
            <ResultItem label={t('rdns_generator.fact_missing')} value={String(result.missing.length)} yellow={result.missing.length > 0} />
            {mode === 'rfc2317' ? (
              <>
                <ResultItem label={t('rdns_generator.fact_parent')} value={result.parentZone} />
                <ResultItem label={t('rdns_generator.fact_child')} value={result.childZone} />
                <ResultItem label={t('rdns_generator.fact_cnames')} value={String(result.cnames.length)} />
              </>
            ) : null}
          </div>
          <div className="card-title" style={{ marginTop: 16 }}>{t('rdns_generator.issues_title')}</div>
          {result.issues.length === 0 ? (
            <div style={{ color: 'var(--green)', fontSize: 13 }}>{t('rdns_generator.no_issues')}</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {result.issues.slice(0, RDNS_TABLE_MAX).map((i, n) => (
                <div key={n} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span className={`badge ${badgeFor(i.level)}`}>{t('rdns_generator.lvl_' + i.level)}</span>
                  <span style={{ fontSize: 13 }}>{issueText(i)}</span>
                </div>
              ))}
              {result.issues.length > RDNS_TABLE_MAX ? (
                <div className="hint">{t('rdns_generator.issues_overflow', { count: result.issues.length - RDNS_TABLE_MAX })}</div>
              ) : null}
            </div>
          )}
        </div>
      ) : null}

      {result.records && result.records.length ? (
        <div className="card">
          <div className="card-title">{t('rdns_generator.records_title')}</div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
            <input
              className="input"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder={t('rdns_generator.filter_placeholder')}
              style={{ fontFamily: 'var(--mono)', flex: '1 1 180px', minWidth: 140 }}
            />
            <button className="btn btn-sm btn-ghost" disabled={!hasEdits} onClick={() => setOverrides({})}>
              {t('rdns_generator.btn_reset_edits')}
            </button>
            <CopyBtn text={copyRecords} label="copy_all" id="rdns-copy-records" />
          </div>
          <div className="hint" style={{ marginBottom: 8 }}>
            {t('rdns_generator.records_summary', { shown: shown.length, total: result.records.length, missing: result.missing.length })}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={th}>{t('rdns_generator.col_ip')}</th>
                  <th style={th}>{t('rdns_generator.col_ptr')}</th>
                  <th style={th}>{t('rdns_generator.col_name')}</th>
                  <th style={th}>{t('rdns_generator.col_src')}</th>
                  <th style={th}></th>
                </tr>
              </thead>
              <tbody>
                {rows.map(rec => {
                  const ov = overrides[rec.key];
                  const nameVal = ov === false ? '' : (typeof ov === 'string' ? ov : rec.name);
                  return (
                    <tr key={rec.key} style={rec.deleted ? { opacity: 0.55, color: 'var(--muted)', textDecoration: 'line-through' } : undefined}>
                      <td style={td}>{rec.ip}</td>
                      <td style={td} title={rec.ptr}>{rec.owner}</td>
                      <td style={{ ...td, minWidth: 180 }}>
                        <input
                          className="input"
                          value={nameVal}
                          disabled={rec.deleted}
                          onChange={e => setRecName(rec.key, e.target.value)}
                          style={{
                            fontFamily: 'var(--mono)',
                            fontSize: 12,
                            outline: rec.bad ? '1px solid var(--red)' : undefined,
                          }}
                        />
                      </td>
                      <td style={{ ...td, fontFamily: 'inherit' }}>{t('rdns_generator.src_' + rec.src)}</td>
                      <td style={{ ...td, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                        {rec.deleted ? (
                          <button className="btn btn-ghost btn-sm" onClick={() => restoreRec(rec.key)}>
                            {t('rdns_generator.btn_restore')}
                          </button>
                        ) : (
                          <button className="btn btn-ghost btn-sm" onClick={() => delRec(rec.key)}>
                            {t('rdns_generator.btn_delete')}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {shown.length > RDNS_TABLE_MAX ? (
            <div className="hint" style={{ marginTop: 8 }}>{t('rdns_generator.table_truncated', { max: RDNS_TABLE_MAX })}</div>
          ) : null}
        </div>
      ) : null}

      {!result.err ? (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('rdns_generator.output_title')}</div>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <CopyBtn text={outText} id="rdns-copy-out" />
              <button className="btn btn-sm btn-ghost" onClick={exportJson} disabled={!!result.err}>
                {t('common.export_json')}
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
            {fmtOrder.map(id => (
              <button
                key={id}
                className={`btn btn-sm ${fmt === id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setFmt(id)}
              >
                {t('rdns_generator.fmt_' + id)}
              </button>
            ))}
          </div>
          <div className="hint" style={{ marginBottom: 8 }}>{t('rdns_generator.' + noteKey)}</div>
          <pre style={{ fontFamily: 'var(--mono)', fontSize: 12, maxHeight: 480, overflow: 'auto', margin: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            {outText}
          </pre>
        </div>
      ) : null}

      <div className="card">
        <div className="card-title">{t('rdns_generator.related_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {RDNS_RELATED.map(({ id, key }) => (
            <button key={id} className="btn btn-sm btn-ghost" onClick={() => goRelated(id)}>
              {t('rdns_generator.' + key)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

window.ReverseDNSGenerator = ReverseDNSGenerator;
