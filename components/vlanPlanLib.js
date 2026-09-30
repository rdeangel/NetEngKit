/* ──────────────────────────────────────────────────────────────────────
 * vlanPlanLib.js — VLAN Planner & Allocator: allocation + audit engine.
 *
 * Pure, dependency-free, returns data only (never user-facing strings).
 * Loaded as a plain <script src> (window.VlanPlan) and requireable in Node.
 *
 *   VlanPlan.allocate({sites, roles})   -> { entries, findings }
 *   VlanPlan.audit(entries, sites?)     -> Finding[]
 *   VlanPlan.parseCSV / toCSV / summarize / validateSites / sanitizePlan
 *   VlanPlan.parseV4 / describeV4 / parseV6 / v6ToStr / vlanClass
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  const LIMITS = { sites: 32, roles: 24, count: 64, entries: 2048, csvRows: 5000 };
  const PAIR_CAP = 500;

  // Display order within a severity.
  const CODES = [
    'PARSE_ERROR', 'SITE_DUP', 'SITE_BAD_RANGE', 'SITE_BAD_POOL', 'V6_BLOCK_INVALID', 'POOL_OVERLAP',
    'RANGE_EXHAUSTED', 'POOL_EXHAUSTED', 'V6_EXHAUSTED', 'VLAN_INVALID', 'VLAN_RESERVED', 'OUT_OF_RANGE',
    'DUP_VLAN', 'SUBNET_REUSE', 'OVERLAP', 'VLAN_MULTI_SUBNET', 'DUP_ROW', 'HOST_BITS', 'OUT_OF_POOL',
    'VLAN_DEFAULT', 'NAME_DRIFT', 'VLAN_NXOS', 'TRUNCATED',
  ];
  const SEV = {
    PARSE_ERROR: 'error', SITE_DUP: 'error', SITE_BAD_RANGE: 'error', SITE_BAD_POOL: 'error',
    V6_BLOCK_INVALID: 'warn', POOL_OVERLAP: 'error', RANGE_EXHAUSTED: 'error', POOL_EXHAUSTED: 'error',
    V6_EXHAUSTED: 'warn', VLAN_INVALID: 'error', VLAN_RESERVED: 'error', OUT_OF_RANGE: 'error',
    DUP_VLAN: 'error', SUBNET_REUSE: 'error', OVERLAP: 'error', VLAN_MULTI_SUBNET: 'warn', DUP_ROW: 'info',
    HOST_BITS: 'warn', OUT_OF_POOL: 'warn', VLAN_DEFAULT: 'warn', NAME_DRIFT: 'info', VLAN_NXOS: 'info',
    TRUNCATED: 'info',
  };
  const SEV_RANK = { error: 0, warn: 1, info: 2 };
  const F = (code, rows, params) => ({ code, sev: SEV[code], rows: rows || [], params: params || {} });

  // ── IPv4 (plain numbers 0..2^32-1; never use << / | on them) ────────
  function v4ToStr(n) {
    return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
  }

  function parseV4(text) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(String(text ?? '').trim());
    if (!m) return null;
    const o = [+m[1], +m[2], +m[3], +m[4]];
    const len = +m[5];
    if (o.some(x => x > 255) || len > 32) return null;
    const addr = o[0] * 16777216 + o[1] * 65536 + o[2] * 256 + o[3];
    const size = 2 ** (32 - len);
    const start = addr - (addr % size);
    return { start, end: start + size - 1, len, net: v4ToStr(start) + '/' + len, hostBits: addr !== start };
  }

  function describeV4(text) {
    const p = parseV4(text);
    if (!p) return null;
    const size = p.end - p.start + 1;
    const mask = v4ToStr(size === 4294967296 ? 0 : 4294967296 - size);
    if (p.len === 32) return { net: p.net, mask, first: v4ToStr(p.start), last: v4ToStr(p.start), usable: 1, gateway: v4ToStr(p.start) };
    if (p.len === 31) return { net: p.net, mask, first: v4ToStr(p.start), last: v4ToStr(p.end), usable: 2, gateway: v4ToStr(p.start) };
    return { net: p.net, mask, first: v4ToStr(p.start + 1), last: v4ToStr(p.end - 1), usable: size - 2, gateway: v4ToStr(p.start + 1) };
  }

  // ── IPv6 (BigInt) ───────────────────────────────────────────────────
  function parseV6(text) {
    const s = String(text ?? '').trim();
    const sl = s.split('/');
    if (sl.length !== 2 || !/^\d{1,3}$/.test(sl[1])) return null;
    const len = +sl[1];
    if (len > 128) return null;
    const halves = sl[0].split('::');
    if (halves.length > 2) return null;
    const left = halves[0] ? halves[0].split(':') : [];
    const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
    let groups;
    if (halves.length === 2) {
      if (left.length + right.length > 7) return null;
      groups = left.concat(Array(8 - left.length - right.length).fill('0'), right);
    } else {
      groups = left;
    }
    if (groups.length !== 8 || !groups.every(g => /^[0-9a-fA-F]{1,4}$/.test(g))) return null;
    let n = 0n;
    for (const g of groups) n = (n << 16n) | BigInt(parseInt(g, 16));
    const mask = (1n << BigInt(128 - len)) - 1n;
    return { net: n & ~mask, len };
  }

  function v6ToStr(x) {
    const h = [];
    for (let i = 0; i < 8; i++) h.push(Number((x >> BigInt(16 * (7 - i))) & 0xffffn));
    let bestS = -1, bestL = 0;
    for (let i = 0; i < 8;) {
      if (h[i] !== 0) { i++; continue; }
      let j = i;
      while (j < 8 && h[j] === 0) j++;
      if (j - i > bestL) { bestS = i; bestL = j - i; }
      i = j;
    }
    const hex = h.map(v => v.toString(16));
    if (bestL < 2) return hex.join(':');
    return hex.slice(0, bestS).join(':') + '::' + hex.slice(bestS + bestL).join(':');
  }

  // ── VLAN classes ────────────────────────────────────────────────────
  function vlanClass(n) {
    if (!Number.isInteger(n) || n < 1 || n > 4094) return 'invalid';
    if (n >= 1002 && n <= 1005) return 'reserved';
    if (n === 1) return 'default';
    if (n >= 3968) return 'nxos';
    return null;
  }

  // ── Plan sanitiser (share URLs are untrusted) ───────────────────────
  const str = (x, n = 64) => String(x ?? '').trim().slice(0, n);
  const arr = (x, cap) => (Array.isArray(x) ? x.filter(o => o && typeof o === 'object').slice(0, cap) : []);
  const clamp = (x, lo, hi, dflt) => { const n = Math.trunc(+x); return Number.isNaN(n) ? dflt : Math.min(hi, Math.max(lo, n)); };

  function sanitizePlan(raw) {
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
      sites: arr(r.sites, LIMITS.sites).map(s => ({
        name: str(s.name), domain: str(s.domain),
        vlanStart: Math.trunc(+s.vlanStart), vlanEnd: Math.trunc(+s.vlanEnd),
        v4Pool: str(s.v4Pool), v6Block: str(s.v6Block),
      })),
      roles: arr(r.roles, LIMITS.roles).map(o => ({
        name: str(o.name), prefix: clamp(o.prefix, 16, 31, 24), count: clamp(o.count, 1, LIMITS.count, 1),
        v6: typeof o.v6 === 'boolean' ? o.v6 : undefined,
      })),
    };
  }

  // ── Site validation ─────────────────────────────────────────────────
  function poolOf(site) {
    const p = parseV4(site.v4Pool);
    return p && p.len >= 8 && p.len <= 31 ? p : null;
  }
  function rangeOk(site) {
    const a = site.vlanStart, b = site.vlanEnd;
    return Number.isInteger(a) && Number.isInteger(b) && a <= b && a >= 1 && b <= 4094;
  }
  const domKey = (site) => (site.domain || site.name).toLowerCase();

  // Fatal per-site problems (these sites are skipped by allocate).
  function siteFatal(site, seen) {
    const c = [];
    if (seen.has(site.name.toLowerCase())) c.push('SITE_DUP');
    if (!rangeOk(site)) c.push('SITE_BAD_RANGE');
    if (!poolOf(site)) c.push('SITE_BAD_POOL');
    return c;
  }

  function validateSites(sites) {
    const out = [];
    const seen = new Set();
    const pools = [];
    (sites || []).forEach(s => {
      for (const c of siteFatal(s, seen)) {
        if (c === 'SITE_DUP') out.push(F(c, [], { site: s.name }));
        else if (c === 'SITE_BAD_RANGE') out.push(F(c, [], { site: s.name, start: s.vlanStart, end: s.vlanEnd }));
        else out.push(F(c, [], { site: s.name, pool: s.v4Pool }));
      }
      seen.add(s.name.toLowerCase());
      if (s.v6Block) {
        const v6 = parseV6(s.v6Block);
        if (!v6 || v6.len > 64) out.push(F('V6_BLOCK_INVALID', [], { site: s.name, block: s.v6Block }));
      }
      const p = poolOf(s);
      if (p) pools.push({ p, s });
    });
    for (let i = 0; i < pools.length; i++) {
      for (let j = i + 1; j < pools.length; j++) {
        const a = pools[i], b = pools[j];
        if (a.p.start <= b.p.end && b.p.start <= a.p.end) {
          out.push(F('POOL_OVERLAP', [], { a: a.p.net, b: b.p.net, siteA: a.s.name, siteB: b.s.name }));
        }
      }
    }
    return out;
  }

  // ── Allocation ──────────────────────────────────────────────────────
  function allocate(plan) {
    const { sites, roles } = sanitizePlan(plan);
    const entries = [];
    const findings = [];
    const usedByDomain = new Map();
    const seen = new Set();
    let truncated = false;

    for (const site of sites) {
      if (!site.name) continue;
      const fatal = siteFatal(site, seen);
      seen.add(site.name.toLowerCase());
      if (fatal.length) continue; // findings come from validateSites
      const pool = poolOf(site);
      const dk = domKey(site);
      if (!usedByDomain.has(dk)) usedByDomain.set(dk, new Set());
      const used = usedByDomain.get(dk);
      const v6 = site.v6Block ? parseV6(site.v6Block) : null;
      const v6ok = v6 && v6.len <= 64 ? v6 : null;
      const reqs = [];
      let v6k = 0;

      for (const role of roles) {
        if (!role.name) continue;
        for (let i = 0; i < role.count; i++) {
          if (entries.length >= LIMITS.entries) { truncated = true; break; }
          const e = {
            site: site.name, domain: site.domain || site.name, vlan: null,
            name: role.count > 1 ? `${role.name}-${i + 1}` : role.name, role: role.name,
            subnet: null, subnet6: '', line: null,
          };
          const idx = entries.length;
          entries.push(e);
          let v = null;
          for (let c = site.vlanStart; c <= site.vlanEnd; c++) {
            const k = vlanClass(c);
            if (k === 'invalid' || k === 'reserved' || k === 'default' || used.has(c)) continue;
            v = c; break;
          }
          if (v === null) {
            findings.push(F('RANGE_EXHAUSTED', [idx], { site: site.name, name: e.name, start: site.vlanStart, end: site.vlanEnd }));
            continue;
          }
          used.add(v);
          e.vlan = v;
          reqs.push({ idx, prefix: role.prefix });
          if (v6ok && (role.v6 ?? role.prefix < 31)) {
            if (v6ok.len <= 48) {
              e.subnet6 = v6ToStr(v6ok.net | (BigInt(parseInt(String(v), 16)) << 64n)) + '/64';
            } else if (BigInt(v6k) >= (1n << BigInt(64 - v6ok.len))) {
              findings.push(F('V6_EXHAUSTED', [idx], { site: site.name, block: site.v6Block }));
            } else {
              e.subnet6 = v6ToStr(v6ok.net + (BigInt(v6k) << 64n)) + '/64';
            }
            v6k++;
          }
        }
        if (truncated) break;
      }

      // VLSM: biggest blocks first (stable sort). ponytail: O(n^2) scan of taken ranges, fine at <=2048 entries.
      const taken = [];
      reqs.slice().sort((a, b) => a.prefix - b.prefix).forEach(rq => {
        const e = entries[rq.idx];
        let got = null;
        if (rq.prefix >= pool.len) {
          const size = 2 ** (32 - rq.prefix);
          let cand = pool.start;
          while (cand + size - 1 <= pool.end) {
            let hitEnd = -1;
            for (const t of taken) if (t[0] <= cand + size - 1 && cand <= t[1] && t[1] > hitEnd) hitEnd = t[1];
            if (hitEnd < 0) { got = cand; break; }
            cand = Math.ceil((hitEnd + 1) / size) * size;
          }
          if (got !== null) taken.push([got, got + size - 1]);
        }
        if (got === null) {
          findings.push(F('POOL_EXHAUSTED', [rq.idx], { site: site.name, name: e.name, prefix: rq.prefix, pool: pool.net }));
        } else {
          e.subnet = v4ToStr(got) + '/' + rq.prefix;
        }
      });
      if (truncated) break;
    }
    if (truncated) findings.push(F('TRUNCATED', [], { limit: LIMITS.entries }));
    return { entries, findings };
  }

  // ── Audit ───────────────────────────────────────────────────────────
  function sortFindings(list) {
    const minRow = f => (f.rows.length ? Math.min(...f.rows) : -1);
    return list.slice().sort((a, b) =>
      SEV_RANK[a.sev] - SEV_RANK[b.sev]
      || CODES.indexOf(a.code) - CODES.indexOf(b.code)
      || minRow(a) - minRow(b)
      || JSON.stringify(a.params).localeCompare(JSON.stringify(b.params)));
  }

  function audit(entries, sites) {
    const out = [];
    const cfgOf = new Map();
    (sites || []).forEach(s => { const k = s.name.toLowerCase(); if (!cfgOf.has(k)) cfgOf.set(k, s); });
    const rows = (entries || []).map((e, i) => {
      const site = String(e.site ?? '');
      const cfg = cfgOf.get(site.toLowerCase());
      const dom = e.domain || (cfg && cfg.domain) || site;
      const v4 = e.subnet ? parseV4(e.subnet) : null;
      return { e, i, site, cfg, dom, dk: dom.toLowerCase(), v4 };
    });

    // Per-row checks
    for (const r of rows) {
      const { e, i, site, cfg, v4 } = r;
      if (e.vlan !== null && e.vlan !== undefined) {
        const k = vlanClass(e.vlan);
        if (k === 'invalid') out.push(F('VLAN_INVALID', [i], { vlan: e.vlan, site }));
        else if (k === 'reserved') out.push(F('VLAN_RESERVED', [i], { vlan: e.vlan, site }));
        else if (k === 'default') out.push(F('VLAN_DEFAULT', [i], { site }));
        else if (k === 'nxos') out.push(F('VLAN_NXOS', [i], { vlan: e.vlan, site }));
        if (cfg && rangeOk(cfg) && (e.vlan < cfg.vlanStart || e.vlan > cfg.vlanEnd)) {
          out.push(F('OUT_OF_RANGE', [i], { vlan: e.vlan, site, start: cfg.vlanStart, end: cfg.vlanEnd }));
        }
      }
      if (v4) {
        if (v4.hostBits) out.push(F('HOST_BITS', [i], { subnet: e.subnet, net: v4.net }));
        const pool = cfg && poolOf(cfg);
        if (pool && !(v4.start >= pool.start && v4.end <= pool.end)) {
          out.push(F('OUT_OF_POOL', [i], { subnet: e.subnet, site, pool: pool.net }));
        }
      }
    }

    // (domain, vlan) groups: exactly one of DUP_VLAN / VLAN_MULTI_SUBNET / DUP_ROW
    const groups = new Map();
    for (const r of rows) {
      if (r.e.vlan === null || r.e.vlan === undefined) continue;
      const k = r.dk + '\u0000' + r.e.vlan;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(r);
    }
    const norm = s => String(s ?? '').trim().toLowerCase();
    const byVlan = new Map();
    for (const g of groups.values()) {
      const vlan = g[0].e.vlan;
      if (!byVlan.has(vlan)) byVlan.set(vlan, []);
      byVlan.get(vlan).push(g);
      if (g.length < 2) continue;
      const idx = g.map(r => r.i);
      const names = [...new Set(g.map(r => String(r.e.name ?? '').trim()))];
      const nets = [...new Set(g.map(r => (r.v4 ? r.v4.net : '')))];
      if (new Set(g.map(r => norm(r.e.name))).size > 1) {
        out.push(F('DUP_VLAN', idx, { vlan, domain: g[0].dom, names: names.join(', ') }));
      } else if (nets.length > 1) {
        out.push(F('VLAN_MULTI_SUBNET', idx, { vlan, domain: g[0].dom, subnets: nets.filter(Boolean).join(', ') }));
      } else {
        out.push(F('DUP_ROW', idx, { vlan, domain: g[0].dom }));
      }
    }

    // NAME_DRIFT: same ID, different domains, different names
    for (const [vlan, gs] of byVlan) {
      if (gs.length < 2) continue;
      const all = gs.flat();
      const names = [...new Set(all.map(r => String(r.e.name ?? '').trim()))];
      if (new Set(all.map(r => norm(r.e.name))).size > 1) {
        out.push(F('NAME_DRIFT', all.map(r => r.i), { vlan, names: names.join(', ') }));
      }
    }

    // SUBNET_REUSE: same net under different (domain, vlan) keys
    const byNet = new Map();
    for (const r of rows) {
      if (!r.v4) continue;
      if (!byNet.has(r.v4.net)) byNet.set(r.v4.net, []);
      byNet.get(r.v4.net).push(r);
    }
    for (const [net, g] of byNet) {
      const keys = [...new Set(g.map(r => r.dk + '\u0000' + r.e.vlan))];
      if (keys.length < 2) continue;
      const vl = [...new Set(g.map(r => `${r.site}/${r.e.vlan}`))];
      out.push(F('SUBNET_REUSE', g.map(r => r.i), { subnet: net, vlans: vl.join(', ') }));
    }

    // OVERLAP sweep (equal ranges are handled above)
    const s = rows.filter(r => r.v4).map(r => ({ ...r.v4, idx: r.i }));
    s.sort((a, b) => a.start - b.start || a.len - b.len);
    let pairs = 0, capped = false;
    for (let i = 0; i < s.length && !capped; i++) {
      for (let j = i + 1; j < s.length && s[j].start <= s[i].end; j++) {
        if (s[j].start === s[i].start && s[j].end === s[i].end) continue;
        if (pairs >= PAIR_CAP) { capped = true; break; }
        pairs++;
        out.push(F('OVERLAP', [s[i].idx, s[j].idx], { a: s[i].net, b: s[j].net }));
      }
    }
    // ponytail: cap pair findings at 500; a fully nested paste is noise past that.
    if (capped) out.push(F('TRUNCATED', [], { limit: PAIR_CAP }));

    return sortFindings(out);
  }

  // ── CSV ─────────────────────────────────────────────────────────────
  const ALIASES = {
    site: ['site', 'location', 'building', 'pod'],
    vlan: ['vlan', 'vlan id', 'vlanid', 'vid', 'id'],
    name: ['name', 'vlan name', 'description', 'desc'],
    subnet: ['subnet', 'network', 'prefix', 'ipv4', 'cidr'],
    subnet6: ['subnet6', 'ipv6', 'v6', 'prefix6'],
  };
  const FIELDS = ['site', 'vlan', 'name', 'subnet', 'subnet6'];

  // Quote-aware split. ponytail: no multiline quoted cells; VLAN tables don't have them.
  function splitLine(line, delim) {
    const out = [];
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c;
      } else if (c === '"') q = true;
      else if (c === delim) { out.push(cur); cur = ''; } else cur += c;
    }
    out.push(cur);
    return out.map(x => x.trim());
  }

  function parseCSV(text) {
    const entries = [];
    const findings = [];
    const lines = String(text ?? '').split(/\r?\n/)
      .map((raw, n) => ({ raw, line: n + 1 }))
      .filter(l => l.raw.trim() !== '' && l.raw.trim()[0] !== '#');
    if (!lines.length) return { entries, findings };
    const first = lines[0].raw;
    const delim = first.includes('\t') && !first.includes(',') ? '\t' : ',';

    let col = { site: 0, vlan: 1, name: 2, subnet: 3, subnet6: 4 };
    const hdr = splitLine(first, delim).map(c => c.toLowerCase());
    if (hdr.some(c => FIELDS.some(f => ALIASES[f].includes(c)))) {
      col = {};
      FIELDS.forEach(f => { const i = hdr.findIndex(c => ALIASES[f].includes(c)); col[f] = i; });
      lines.shift();
    }
    let truncated = false;
    for (const l of lines) {
      if (entries.length >= LIMITS.csvRows) { truncated = true; break; }
      const cells = splitLine(l.raw, delim);
      const cell = f => (col[f] >= 0 && col[f] !== undefined ? (cells[col[f]] ?? '') : '');
      const idx = entries.length;
      const e = { site: cell('site'), domain: '', vlan: null, name: cell('name'), role: '', subnet: cell('subnet'), subnet6: cell('subnet6'), line: l.line };
      const bad = (field) => findings.push(F('PARSE_ERROR', [idx], { line: l.line, field }));
      if (!e.site) { e.site = null; bad('site'); }
      const v = cell('vlan');
      if (/^\d+$/.test(v)) e.vlan = parseInt(v, 10); else bad('vlan');
      if (e.subnet && !parseV4(e.subnet)) { e.subnet = null; bad('subnet'); }
      if (e.subnet6 && !parseV6(e.subnet6)) { e.subnet6 = null; bad('subnet6'); }
      entries.push(e);
    }
    if (truncated) findings.push(F('TRUNCATED', [], { limit: LIMITS.csvRows }));
    return { entries, findings };
  }

  const csvCell = v => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  function toCSV(entries) {
    return ['site,vlan,name,subnet,subnet6']
      .concat((entries || []).map(e => [e.site, e.vlan, e.name, e.subnet, e.subnet6].map(csvCell).join(',')))
      .join('\n');
  }

  // ── Summary ─────────────────────────────────────────────────────────
  function summarize(entries, sites) {
    return (sites || []).map(s => {
      const own = (entries || []).filter(e => String(e.site ?? '').toLowerCase() === s.name.toLowerCase());
      let rangeSize = 0;
      if (rangeOk(s)) {
        for (let v = s.vlanStart; v <= s.vlanEnd; v++) {
          const k = vlanClass(v);
          if (k !== 'invalid' && k !== 'reserved' && k !== 'default') rangeSize++;
        }
      }
      const pool = poolOf(s);
      let poolUsed = 0;
      if (pool) {
        for (const e of own) {
          const p = e.subnet ? parseV4(e.subnet) : null;
          if (p && p.start >= pool.start && p.end <= pool.end) poolUsed += p.end - p.start + 1;
        }
      }
      return {
        site: s.name,
        vlansUsed: own.filter(e => e.vlan !== null && e.vlan !== undefined).length,
        rangeSize,
        poolSize: pool ? pool.end - pool.start + 1 : 0,
        poolUsed,
      };
    });
  }

  const DEFAULT_PLAN = {
    sites: [
      { name: 'HQ', domain: '', vlanStart: 100, vlanEnd: 199, v4Pool: '10.10.0.0/20', v6Block: '2001:db8:10::/48' },
      { name: 'BR01', domain: '', vlanStart: 200, vlanEnd: 299, v4Pool: '10.20.0.0/21', v6Block: '' },
    ],
    roles: [
      { name: 'USER', prefix: 24, count: 2 },
      { name: 'VOICE', prefix: 24, count: 1 },
      { name: 'MGMT', prefix: 27, count: 1 },
      { name: 'P2P', prefix: 31, count: 2 },
    ],
  };

  const SAMPLE_CSV = [
    'site,vlan,name,subnet,subnet6',
    'HQ,1,DEFAULT,10.10.0.0/24,',
    'HQ,10,USER,10.10.10.0/24,',
    'HQ,20,VOICE,10.10.20.0/24,',
    'HQ,20,PRINTERS,10.10.21.0/25,',
    'HQ,30,MGMT,10.10.30.1/24,',
    'HQ,40,GUEST,10.10.10.128/25,',
    'BR01,10,USER,10.20.10.0/24,',
    'BR01,20,PRINTERS,10.20.20.0/24,',
  ].join('\n');

  const api = {
    parseV4, v4ToStr, describeV4, parseV6, v6ToStr, vlanClass, sanitizePlan, validateSites,
    allocate, audit, parseCSV, toCSV, summarize, sortFindings, CODES, LIMITS, DEFAULT_PLAN, SAMPLE_CSV,
  };
  root.VlanPlan = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
