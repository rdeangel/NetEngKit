const { useState, useEffect, useMemo } = React;

// <slicer-engine>
const SLICER_MAX_ROWS = 1000;
const SLICER_MODES = ['network', 'first', 'last', 'start', 'end', 'nth', 'pair'];
const SLICER_FMTS = ['cidr', 'plain', 'mask', 'wildcard', 'pair'];
const SLICER_OUTPUT_FMTS = [
  'cidr',
  'slash_mask',
  'tab_prefix',
  'tab_mask',
  'space_mask',
  'space_prefix',
  'comma_prefix',
  'comma_mask',
  'wildcard',
  'plain',
];
const SLICER_OFFSET_MODES = ['start', 'end', 'nth'];

function slicerAddr(s) {
  if (s.includes(':')) {
    const exp = IPv6.expand(s);
    return exp ? { v: 6, w: 128, n: BigInt('0x' + exp.replace(/:/g, '')) } : null;
  }
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
  const n = IPv4.parse(s);
  return n === null ? null : { v: 4, w: 32, n: BigInt(n) };
}

function slicerStr(n, v) {
  if (v === 4) return IPv4.str(Number(n));
  return IPv6.compress(n.toString(16).padStart(32, '0').match(/.{4}/g).join(':'));
}

// One subnet token → { v, p, net, last, lo, hi, count, hostBits } or { err }.
// Usable range: IPv4 excludes network + broadcast; IPv6 excludes only the
// Subnet-Router anycast (first address, RFC 4291 §2.6.1). /31 (RFC 3021) and
// /127 (RFC 6164) use both addresses; /32 and /128 are a single host.
function slicerCidr(tok) {
  const m = tok.match(/^([0-9a-fA-F:.]+)\/(.+)$/);
  if (!m) return { err: 'err_syntax' };
  const a = slicerAddr(m[1]);
  if (!a) return { err: 'err_addr' };
  let p;
  if (/^\d{1,3}$/.test(m[2])) {
    p = Number(m[2]);
  } else if (a.v === 4) {
    const mp = slicerMaskPrefix(m[2]);
    if (mp !== null && (mp > 0 || a.n === 0n)) {
      p = mp;
    } else {
      const wp = slicerWildPrefix(m[2]);
      if (wp !== null && (wp > 0 || a.n === 0n)) {
        p = wp;
      } else {
        return { err: 'err_syntax' };
      }
    }
  } else {
    return { err: 'err_syntax' };
  }
  if (p > a.w) return { err: 'err_prefix' };
  const h = BigInt(a.w - p);
  const net = (a.n >> h) << h;
  const last = net + (1n << h) - 1n;
  let lo = net + 1n, hi = a.v === 4 ? last - 1n : last;
  if (h === 0n) { lo = net; hi = net; }
  else if (h === 1n) { lo = net; hi = last; }
  return { v: a.v, p, net, last, lo, hi, count: hi - lo + 1n, hostBits: a.n !== net };
}

// Contiguous IPv4 dotted mask → prefix length, or null.
function slicerMaskPrefix(s) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
  const n = IPv4.parse(s);
  if (n === null) return null;
  const u = n >>> 0;
  const w = (~u) >>> 0;
  if ((w & (w + 1)) !== 0) return null;
  let p = 0;
  let x = u;
  while (p < 32 && (x & 0x80000000)) { p++; x = (x << 1) >>> 0; }
  return x === 0 ? p : null;
}

// Contiguous IPv4 dotted wildcard mask → prefix length, or null.
// 0.0.0.1 (/31) through 0.255.255.255 (/8); 0.0.0.0 excluded (handled per host/route).
function slicerWildPrefix(s) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
  const n = IPv4.parse(s);
  if (n === null) return null;
  const u = n >>> 0;
  if (u === 0) return null;
  if (((u + 1) & u) !== 0) return null;
  let p = 32;
  let x = u;
  while (x > 0) { p--; x = x >>> 1; }
  return p;
}

// Text → rows. Comment (#, !, //) = label for every subnet on that line.
// Separators: whitespace, comma, semicolon.
// IPv4 "addr mask" (contiguous dotted mask or wildcard) and "addr prefix" pairs are accepted.
function slicerParse(text) {
  const rows = [];
  let truncated = false;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const ci = raw.search(/#|!|\/\//);
    const label = ci >= 0 ? raw.slice(ci).replace(/^(#|!|\/\/)\s*/, '').trim() : '';
    const body = (ci >= 0 ? raw.slice(0, ci) : raw).replace(/\s*\/\s*/g, '/');
    const toks = body.split(/[\s,;]+/).filter(Boolean);
    for (let i = 0; i < toks.length; i++) {
      if (rows.length >= SLICER_MAX_ROWS) { truncated = true; break; }
      const tok = toks[i];
      const next = toks[i + 1];
      if (next && !tok.includes('/') && !next.includes('/')) {
        const a = slicerAddr(tok);
        if (a) {
          const mp = a.v === 4 ? slicerMaskPrefix(next) : null;
          if (mp !== null && (mp > 0 || a.n === 0n)) {
            rows.push({ input: tok + ' ' + next, label, ...slicerCidr(tok + '/' + mp) });
            i++;
            continue;
          }
          const wp = a.v === 4 ? slicerWildPrefix(next) : null;
          if (wp !== null && (wp > 0 || a.n === 0n)) {
            rows.push({ input: tok + ' ' + next, label, ...slicerCidr(tok + '/' + wp) });
            i++;
            continue;
          }
          if (/^\d{1,3}$/.test(next)) {
            const p = Number(next);
            if (p <= a.w) {
              rows.push({ input: tok + ' ' + next, label, ...slicerCidr(tok + '/' + p) });
              i++;
              continue;
            }
          }
        }
      }
      rows.push({ input: tok, label, ...slicerCidr(tok) });
    }
  }
  return { rows, truncated };
}

// Selected address(es) for one parsed subnet. off is a BigInt (>= 0; nth >= 1).
// Returns { a } | { a, b } | { oob, min, max } (min/max are the valid N range).
function slicerPick(s, mode, off) {
  const ok = x => x >= s.lo && x <= s.hi;
  if (mode === 'network') return { a: s.net };
  if (mode === 'first') return { a: s.lo };
  if (mode === 'last') return { a: s.hi };
  if (mode === 'pair') return s.count >= 2n ? { a: s.lo, b: s.hi } : { oob: 'oob_pair' };
  if (mode === 'start') { const x = s.net + off; return ok(x) ? { a: x } : { oob: 'oob_start', min: s.lo - s.net, max: s.hi - s.net }; }
  if (mode === 'end') { const x = s.last - off; return ok(x) ? { a: x } : { oob: 'oob_end', min: s.last - s.hi, max: s.last - s.lo }; }
  if (mode === 'nth') return off <= s.count ? { a: s.lo + off - 1n } : { oob: 'oob_nth', min: 1n, max: s.count };
  return { oob: 'oob_pair' };
}

function slicerAffix(s, x, fmt) {
  const ip = slicerStr(x, s.v);
  if (typeof fmt === 'object') {
    let res = ip;
    if (fmt.prefix) res += '/' + s.p;
    if (s.v === 4) {
      const wild = (1n << BigInt(32 - s.p)) - 1n;
      if (fmt.mask) res += ' ' + IPv4.str(Number(0xffffffffn ^ wild));
      else if (fmt.wild) res += ' ' + IPv4.str(Number(wild));
    } else if ((fmt.mask || fmt.wild) && !fmt.prefix) {
      res += '/' + s.p;
    }
    return res;
  }
  if (fmt === 'plain') return ip;
  if (s.v === 6) {
    if (fmt === 'tab_prefix' || fmt === 'tab_mask') return ip + '\t' + s.p;
    if (fmt === 'space_prefix' || fmt === 'space_mask') return ip + ' ' + s.p;
    if (fmt === 'comma_prefix' || fmt === 'comma_mask') return ip + ', ' + s.p;
    return ip + '/' + s.p;
  }
  const wild = (1n << BigInt(32 - s.p)) - 1n;
  const mask = IPv4.str(Number(0xffffffffn ^ wild));
  const wildStr = IPv4.str(Number(wild));
  switch (fmt) {
    case 'slash_mask':   return ip + '/' + mask;
    case 'tab_prefix':   return ip + '\t' + s.p;
    case 'tab_mask':     return ip + '\t' + mask;
    case 'mask':
    case 'space_mask':   return ip + ' ' + mask;
    case 'space_prefix': return ip + ' ' + s.p;
    case 'comma_prefix': return ip + ', ' + s.p;
    case 'comma_mask':   return ip + ', ' + mask;
    case 'wildcard':     return ip + ' ' + wildStr;
    case 'cidr':
    default:             return ip + '/' + s.p;
  }
}

function slicerFmt(s, x, fmt) {
  if (fmt === 'pair') return slicerStr(x, s.v);
  return slicerAffix(s, x, fmt);
}

// Output-column text for one ok row. Pair mode: 'pair' → "A <-> B", else "A<TAB>B".
function slicerLine(s, r, fmt) {
  if (r.b === undefined) return slicerFmt(s, r.a, fmt);
  return fmt === 'pair'
    ? slicerStr(r.a, s.v) + ' <-> ' + slicerStr(r.b, s.v)
    : slicerFmt(s, r.a, fmt) + '\t' + slicerFmt(s, r.b, fmt);
}

// Whole run. offErr: '' | 'blank' (silent) | 'err_offset' | 'err_nth'.
function slicerRun(text, mode, offStr) {
  const { rows, truncated } = slicerParse(text);
  let off = 0n, offErr = '';
  if (SLICER_OFFSET_MODES.includes(mode)) {
    const raw = String(offStr ?? '').trim();
    const m = raw.match(/^[+-]?(\d{1,39})$/);
    if (!m) offErr = raw ? 'err_offset' : 'blank';
    else { off = BigInt(m[1]); if (mode === 'nth' && off < 1n) offErr = 'err_nth'; }
  }
  return {
    truncated, offErr,
    rows: rows.map(r => (r.err || offErr) ? r : { ...r, pick: slicerPick(r, mode, off) }),
  };
}
// </slicer-engine>

const SLICER_SAMPLES = {
  p2p:    { mode: 'pair',  text: '10.0.0.0/30 # WAN-A CORE1-PE1\n10.0.0.4/30 # WAN-B CORE2-PE2\n10.0.0.8/31 # RFC3021 CORE1-CORE2\n10.0.0.10/31, 10.0.0.12/31 # DC-SPINES\n192.0.2.1/32 # LO0' },
  campus: { mode: 'first', text: '10.10.0.0/24 # USERS\n10.10.1.0/27 # PRINTERS\n10.10.1.32/28 # MGMT\n10.10.1.48/28, 10.10.1.64/28 # APS' },
  v6:     { mode: 'pair',  text: '2001:db8:0:1::/127 # PE1-CE1\n2001:db8:0:2::/127 # PE2-CE2\n2001:db8:100::/64 # SERVERS\n2001:db8::1/128 # LO0' },
  sheet:  { mode: 'first', text: '10.20.0.0\t24 # SITE-A\n10.20.1.0\t255.255.255.0 # SITE-B\n10.20.2.0\t28 # WAN-C' },
};

const SLICER_RELATED = [
  { nav: { tool: 'subnet', mode: 'calculator' }, key: 'related_subnet' },
  { nav: { tool: 'subnet', mode: 'rebase' }, key: 'related_rebase' },
  { nav: { tool: 'subnet', mode: 'iplist' }, key: 'related_iplist' },
  { nav: { tool: 'subnet-planner' }, key: 'related_planner' },
  { nav: { tool: 'ipv6subnet' }, key: 'related_ipv6' },
];

const SLICER_DASH = '—';
const SLICER_SAMPLE_IDS = ['p2p', 'campus', 'v6', 'sheet'];

function slicerCsvEsc(v) {
  return String(v).replace(/"/g, '""');
}

function slicerOutLine(s, r, fmt, join) {
  if (r.b === undefined) return slicerAffix(s, r.a, fmt);
  const a = slicerAffix(s, r.a, fmt);
  const b = slicerAffix(s, r.b, fmt);
  return join ? a + ' <-> ' + b : a + '\t' + b;
}

function SubnetHostSlicer({ initialData, onShare }) {
  const { t } = useTranslation();

  const fmtInit = initialData?.fmt;
  const initialFmt = useMemo(() => {
    if (fmtInit && SLICER_OUTPUT_FMTS.includes(fmtInit)) return fmtInit;
    if (fmtInit === 'mask' || fmtInit === 'both') return 'space_mask';
    if (fmtInit === 'wildcard') return 'wildcard';
    if (fmtInit === 'plain') return 'plain';
    if (initialData?.wild) return 'wildcard';
    if (initialData?.mask) return 'space_mask';
    if (initialData?.prefix === false) return 'plain';
    return 'cidr';
  }, [fmtInit, initialData]);

  const [input, setInput]       = usePersistentState('subnet-slicer:input',  initialData?.input  ?? SLICER_SAMPLES.p2p.text);
  const [mode, setMode]         = usePersistentState('subnet-slicer:mode',   initialData?.mode   ?? 'first');
  const [offset, setOffset]     = usePersistentState('subnet-slicer:offset', initialData?.offset ?? '2');
  const [outFmt, setOutFmt]     = usePersistentState('subnet-slicer:fmt',    initialFmt);
  const [pairJoin, setPairJoin] = usePersistentState('subnet-slicer:join',   initialData?.join   ?? (fmtInit === 'pair'));

  useEffect(() => {
    if (!initialData || initialData.tool !== 'subnet-slicer') return;
    if (typeof initialData.input === 'string') setInput(initialData.input);
    if (SLICER_MODES.includes(initialData.mode)) setMode(initialData.mode);
    if (initialData.offset != null) setOffset(String(initialData.offset));
    if (typeof initialData.join === 'boolean') setPairJoin(initialData.join);
    else if (initialData.fmt === 'pair') setPairJoin(true);
    if (typeof initialData.fmt === 'string') {
      if (SLICER_OUTPUT_FMTS.includes(initialData.fmt)) {
        setOutFmt(initialData.fmt);
      } else if (initialData.fmt === 'mask' || initialData.fmt === 'both') {
        setOutFmt('space_mask');
      } else if (initialData.fmt === 'plain') {
        setOutFmt('plain');
      } else if (initialData.fmt === 'wildcard') {
        setOutFmt('wildcard');
      } else if (initialData.fmt === 'pair') {
        setOutFmt('cidr');
      }
    } else {
      if (initialData.wild) setOutFmt('wildcard');
      else if (initialData.mask) setOutFmt('space_mask');
      else if (initialData.prefix === false) setOutFmt('plain');
      else if (initialData.prefix) setOutFmt('cidr');
    }
  }, [initialData]);

  const m = SLICER_MODES.includes(mode) ? mode : 'first';
  const effFmt = SLICER_OUTPUT_FMTS.includes(outFmt)
    ? outFmt
    : (outFmt === 'mask' || outFmt === 'both' ? 'space_mask' : (outFmt === 'wildcard' ? 'wildcard' : (outFmt === 'plain' ? 'plain' : 'cidr')));

  const res = useMemo(() => slicerRun(input, m, offset), [input, m, offset]);
  const okRows  = res.rows.filter(r => r.pick && !r.pick.oob);
  const outText = okRows.map(r => slicerOutLine(r, r.pick, effFmt, pairJoin && m === 'pair')).join('\n');
  const counts  = { ok: okRows.length,
                    oob: res.rows.filter(r => r.pick?.oob).length,
                    invalid: res.rows.filter(r => r.err).length,
                    hostbits: res.rows.filter(r => r.hostBits).length };
  const hasV6 = res.rows.some(r => r.v === 6);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'subnet-slicer', input, mode: m, offset, fmt: effFmt, join: pairJoin,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [input, m, offset, effFmt, pairJoin, onShare]);

  const records = useMemo(() => res.rows.map((r, i) => {
    if (r.err) {
      return {
        i: i + 1,
        subnet: r.input,
        label: r.label,
        network: SLICER_DASH,
        last: SLICER_DASH,
        range: SLICER_DASH,
        usable: SLICER_DASH,
        selected: SLICER_DASH,
        a: SLICER_DASH,
        b: SLICER_DASH,
        mask: SLICER_DASH,
        status: t('subnet_slicer.status_invalid') + ' ' + t('subnet_slicer.' + r.err),
        err: r.err,
        oob: '',
        oobMin: '',
        oobMax: '',
        hostBits: false,
        netStr: '',
      };
    }
    const hasPick = !!(r.pick && !r.pick.oob);
    const selected = hasPick ? slicerAffix(r, r.pick.a, effFmt) : SLICER_DASH;
    const a = hasPick ? slicerAffix(r, r.pick.a, effFmt) : SLICER_DASH;
    const b = hasPick && r.pick.b !== undefined ? slicerAffix(r, r.pick.b, effFmt) : SLICER_DASH;
    let status;
    if (r.pick && r.pick.oob) {
      status = t('subnet_slicer.status_oob') + ' ' + t('subnet_slicer.' + r.pick.oob, {
        min: String(r.pick.min),
        max: String(r.pick.max),
      });
    } else {
      status = t('subnet_slicer.status_ok');
    }
    const netStr = slicerStr(r.net, r.v);
    if (r.hostBits) {
      status += ' ' + t('subnet_slicer.status_hostbits', { net: netStr });
    }
    const loS = slicerStr(r.lo, r.v);
    const hiS = slicerStr(r.hi, r.v);
    return {
      i: i + 1,
      subnet: netStr + '/' + r.p,
      label: r.label,
      network: netStr,
      last: slicerStr(r.last, r.v),
      range: r.lo === r.hi ? loS : loS + ' – ' + hiS,
      usable: r.count.toLocaleString(),
      selected,
      a,
      b,
      mask: r.v === 4 ? slicerFmt(r, r.net, 'mask').split(' ').slice(1).join(' ') : '/' + r.p,
      status,
      err: '',
      oob: (r.pick && r.pick.oob) ? r.pick.oob : '',
      oobMin: (r.pick && r.pick.min !== undefined) ? String(r.pick.min) : '',
      oobMax: (r.pick && r.pick.max !== undefined) ? String(r.pick.max) : '',
      hostBits: !!r.hostBits,
      netStr,
    };
  }), [res, effFmt, t]);

  const csvRows = useMemo(() => records.map(rec => {
    const row = {
      [t('common.th_num')]: rec.i,
      [t('subnet_slicer.th_subnet')]: slicerCsvEsc(rec.subnet),
      [t('subnet_slicer.th_label')]: slicerCsvEsc(rec.label),
      [t('subnet_slicer.th_network')]: slicerCsvEsc(rec.network),
      [t('subnet_slicer.th_last')]: slicerCsvEsc(rec.last),
      [t('subnet_slicer.th_range')]: slicerCsvEsc(rec.range),
      [t('subnet_slicer.th_usable')]: slicerCsvEsc(rec.usable),
    };
    if (m === 'pair') {
      row[t('subnet_slicer.th_router_a')] = slicerCsvEsc(rec.a);
      row[t('subnet_slicer.th_router_b')] = slicerCsvEsc(rec.b);
    } else {
      row[t('subnet_slicer.th_selected')] = slicerCsvEsc(rec.selected);
    }
    row[t('subnet_slicer.th_mask')] = slicerCsvEsc(rec.mask);
    row[t('common.th_status')] = slicerCsvEsc(rec.status);
    return row;
  }), [records, m, t]);

  const tsv = useMemo(() => {
    if (!csvRows.length) {
      const heads = [
        t('common.th_num'),
        t('subnet_slicer.th_subnet'),
        t('subnet_slicer.th_label'),
        t('subnet_slicer.th_network'),
        t('subnet_slicer.th_last'),
        t('subnet_slicer.th_range'),
        t('subnet_slicer.th_usable'),
        m === 'pair' ? t('subnet_slicer.th_router_a') : t('subnet_slicer.th_selected'),
        ...(m === 'pair' ? [t('subnet_slicer.th_router_b')] : []),
        t('subnet_slicer.th_mask'),
        t('common.th_status'),
      ];
      return heads.join('\t');
    }
    const keys = Object.keys(csvRows[0]);
    return [keys.join('\t'), ...csvRows.map(row => keys.map(k => String(row[k]).replace(/""/g, '"')).join('\t'))].join('\n');
  }, [csvRows, m, t]);

  const jsonRows = useMemo(() => records.map(rec => {
    const row = {
      subnet: rec.subnet,
      label: rec.label,
      network: rec.network,
      last: rec.last,
      range: rec.range,
      usable: rec.usable,
    };
    if (m === 'pair') {
      row.a = rec.a;
      row.b = rec.b;
    } else {
      row.selected = rec.selected;
    }
    row.mask = rec.mask;
    row.status = rec.status;
    return row;
  }), [records, m]);

  const skipped = counts.oob + counts.invalid;
  const showOffErr = res.offErr === 'err_offset' || res.offErr === 'err_nth';

  const applySample = (id) => {
    const s = SLICER_SAMPLES[id];
    setInput(s.text);
    setMode(s.mode);
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('subnet_slicer.input_title')}</div>
        <div className="field">
          <textarea
            className="input"
            rows={8}
            spellCheck={false}
            placeholder={t('subnet_slicer.input_placeholder')}
            value={input}
            onChange={e => setInput(e.target.value)}
            style={{ resize: 'vertical' }}
          />
          <div className="hint">{t('subnet_slicer.input_hint')}</div>
        </div>
        <div className="btn-row">
          {SLICER_SAMPLE_IDS.map(id => (
            <button
              key={id}
              className="btn btn-sm btn-ghost"
              onClick={() => applySample(id)}
            >
              {t('subnet_slicer.sample_' + id)}
            </button>
          ))}
          <button className="btn btn-sm btn-ghost" onClick={() => setInput('')}>
            {t('common.clear')}
          </button>
        </div>
        {res.truncated && (
          <div style={{ marginTop: 8 }}>
            <span className="badge badge-yellow">{t('subnet_slicer.warn_truncated', { max: SLICER_MAX_ROWS })}</span>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('subnet_slicer.slice_title')}</div>
        <div className="btn-row">
          {SLICER_MODES.map(id => (
            <button
              key={id}
              className={'btn btn-sm ' + (m === id ? 'btn-primary' : 'btn-ghost')}
              onClick={() => setMode(id)}
            >
              {t('subnet_slicer.mode_' + id)}
            </button>
          ))}
        </div>
        <div className="hint">{t('subnet_slicer.mode_' + m + '_hint')}</div>
        {SLICER_OFFSET_MODES.includes(m) && (
          <div className="field" style={{ marginTop: 12 }}>
            <label className="label">{t('subnet_slicer.offset_label_' + m)}</label>
            <input
              className="input"
              type="text"
              inputMode="numeric"
              value={offset}
              onChange={e => setOffset(e.target.value)}
              style={{ width: 120 }}
            />
            {showOffErr && <Err msg={t('subnet_slicer.' + res.offErr)} />}
          </div>
        )}
        <div className="field" style={{ marginTop: 12 }}>
          <label className="label">{t('subnet_slicer.format_title')}</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="select"
              value={effFmt}
              onChange={e => setOutFmt(e.target.value)}
              style={{ width: 'auto', minWidth: 280, maxWidth: '100%' }}
            >
              {SLICER_OUTPUT_FMTS.map(id => (
                <option key={id} value={id}>
                  {t('subnet_slicer.fmt_' + id)}
                </option>
              ))}
            </select>
            {m === 'pair' && (
              <button
                className={'btn btn-sm ' + (pairJoin ? 'btn-primary' : 'btn-ghost')}
                onClick={() => setPairJoin(v => !v)}
                title={t('subnet_slicer.fmt_pair_hint')}
              >
                {t('subnet_slicer.fmt_pair')}
              </button>
            )}
          </div>
          <div className="hint">{t('subnet_slicer.format_hint')}</div>
          {hasV6 && (effFmt.includes('mask') || effFmt === 'wildcard') && (
            <div className="hint">{t('subnet_slicer.fmt_v6_note')}</div>
          )}
        </div>
      </div>

      {res.rows.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <span className="badge badge-green">{t('subnet_slicer.sum_ok', { n: counts.ok })}</span>
          {counts.oob > 0 && (
            <span className="badge badge-red">{t('subnet_slicer.sum_oob', { n: counts.oob })}</span>
          )}
          {counts.invalid > 0 && (
            <span className="badge badge-red">{t('subnet_slicer.sum_invalid', { n: counts.invalid })}</span>
          )}
          {counts.hostbits > 0 && (
            <span className="badge badge-yellow">{t('subnet_slicer.sum_hostbits', { n: counts.hostbits })}</span>
          )}
        </div>
      )}

      <div className="card">
        <div className="card-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {t('subnet_slicer.output_title')}
          <CopyBtn text={outText} id="slicer-out" />
        </div>
        {okRows.length === 0 ? (
          <div className="hint">{t('subnet_slicer.output_empty')}</div>
        ) : (
          <pre style={{ fontFamily: 'var(--mono)', whiteSpace: 'pre', overflowX: 'auto', margin: 0, fontSize: 13 }}>{outText}</pre>
        )}
        {m === 'pair' && !pairJoin && okRows.length > 0 && (
          <div className="hint">{t('subnet_slicer.output_pair_tab_hint')}</div>
        )}
        {skipped > 0 && (
          <div className="hint">{t('subnet_slicer.output_skipped', { n: skipped })}</div>
        )}
      </div>

      <div className="card">
        <div className="card-title">{t('subnet_slicer.table_title')}</div>
        <div className="btn-row" style={{ marginBottom: 8 }}>
          <CopyBtn text={tsv} id="slicer-tsv" />
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => exportCSV(csvRows, 'subnet-slicer.csv')}
          >
            {t('common.export_csv')}
          </button>
          <button
            className="btn btn-sm btn-ghost"
            onClick={() => exportJSON({ tool: 'subnet-slicer', mode: m, offset, fmt: effFmt, join: pairJoin, rows: jsonRows }, 'subnet-slicer.json')}
          >
            {t('common.export_json')}
          </button>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('common.th_num')}</th>
                <th>{t('subnet_slicer.th_subnet')}</th>
                <th>{t('subnet_slicer.th_label')}</th>
                <th>{t('subnet_slicer.th_network')}</th>
                <th>{t('subnet_slicer.th_last')}</th>
                <th>{t('subnet_slicer.th_range')}</th>
                <th>{t('subnet_slicer.th_usable')}</th>
                {m === 'pair' ? (
                  <>
                    <th>{t('subnet_slicer.th_router_a')}</th>
                    <th>{t('subnet_slicer.th_router_b')}</th>
                  </>
                ) : (
                  <th>{t('subnet_slicer.th_selected')}</th>
                )}
                <th>{t('subnet_slicer.th_mask')}</th>
                <th>{t('common.th_status')}</th>
              </tr>
            </thead>
            <tbody>
              {records.map(rec => (
                <tr key={rec.i}>
                  <td>{rec.i}</td>
                  <td>{rec.subnet}</td>
                  <td>{rec.label}</td>
                  <td>{rec.network}</td>
                  <td>{rec.last}</td>
                  <td>{rec.range}</td>
                  <td>{rec.usable}</td>
                  {m === 'pair' ? (
                    <>
                      <td style={{ fontFamily: 'var(--mono)' }}>{rec.a}</td>
                      <td style={{ fontFamily: 'var(--mono)' }}>{rec.b}</td>
                    </>
                  ) : (
                    <td style={{ fontFamily: 'var(--mono)' }}>{rec.selected}</td>
                  )}
                  <td>{rec.mask}</td>
                  <td>
                    {rec.err ? (
                      <>
                        <span className="badge badge-red">{t('subnet_slicer.status_invalid')}</span>
                        {' '}
                        <span className="hint">{t('subnet_slicer.' + rec.err)}</span>
                      </>
                    ) : rec.oob ? (
                      <>
                        <span className="badge badge-red">{t('subnet_slicer.status_oob')}</span>
                        {' '}
                        <span className="hint">{t('subnet_slicer.' + rec.oob, { min: rec.oobMin, max: rec.oobMax })}</span>
                      </>
                    ) : (
                      <span className="badge badge-green">{t('subnet_slicer.status_ok')}</span>
                    )}
                    {rec.hostBits ? (
                      <>
                        {' '}
                        <span className="badge badge-yellow">{t('subnet_slicer.status_hostbits', { net: rec.netStr })}</span>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('subnet_slicer.related_title')}</div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
          {SLICER_RELATED.map(({ nav, key }, idx) => (
            <li key={key} style={{ marginBottom: idx < SLICER_RELATED.length - 1 ? 6 : 0 }}>
              <button
                className="btn btn-sm btn-ghost"
                style={{ padding: '0 6px', height: 'auto', fontSize: 12, marginRight: 6, display: 'inline-flex', verticalAlign: 'baseline' }}
                onClick={() => {
                  window.dispatchEvent(new CustomEvent('app:navigate', { detail: nav }));
                }}
              >
                {t('subnet_slicer.' + key)}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

window.SubnetHostSlicer = SubnetHostSlicer;
