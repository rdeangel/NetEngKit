/* ──────────────────────────────────────────────────────────────────────
 * netTableSortLib.js — Network Table Sorter comparator / parser / exporter.
 *
 * Pure, dependency-free. Loaded as a plain <script src> (global) and
 * requireable in Node for the assert harness.
 *
 *   NetTableSort.detectDelimiter(text)
 *   NetTableSort.parseTable(text, { delimiter, header })
 *   NetTableSort.cellKey(cell, opts)
 *   NetTableSort.compareCells(a, b, opts)
 *   NetTableSort.sortRows(rows, keys, opts)
 *   NetTableSort.toTSV / toCSV / toMarkdown
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function cmpStr(a, b) {
    const c = collator.compare(String(a), String(b));
    return c < 0 ? -1 : c > 0 ? 1 : 0;
  }

  function cmpNums(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      if (a[i] < b[i]) return -1;
      if (a[i] > b[i]) return 1;
    }
    if (a.length < b.length) return -1;
    if (a.length > b.length) return 1;
    return 0;
  }

  // ── IPv4 ────────────────────────────────────────────────────────────
  function parseV4(s) {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s).trim());
    if (!m) return null;
    let n = 0n;
    for (let i = 1; i <= 4; i++) {
      if (m[i].length > 1 && m[i][0] === '0') return null; // no leading zeros
      const o = Number(m[i]);
      if (o > 255) return null;
      n = (n << 8n) | BigInt(o);
    }
    return n;
  }

  function maskToLen(m) {
    if (m === 0n) return 0;
    const inv = ((1n << 32n) - 1n) ^ m;
    if ((inv & (inv + 1n)) !== 0n) return null; // non-contiguous (wildcard)
    let len = 0;
    let x = m;
    while (x) { len++; x &= x - 1n; }
    return len;
  }

  function v4Mask(len) {
    if (len <= 0) return 0n;
    if (len >= 32) return (1n << 32n) - 1n;
    return ((1n << 32n) - 1n) ^ ((1n << BigInt(32 - len)) - 1n);
  }

  function v6Mask(len) {
    if (len <= 0) return 0n;
    if (len >= 128) return (1n << 128n) - 1n;
    return ((1n << 128n) - 1n) ^ ((1n << BigInt(128 - len)) - 1n);
  }

  // Copied from ReverseDNSGenerator.jsx rdnsParseV6 (~15 lines).
  // ponytail: no embedded-IPv4 (::ffff:a.b.c.d) or zone-id (%eth0) forms; add if asked.
  function parseV6(s) {
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

  // ── MAC ─────────────────────────────────────────────────────────────
  const RE_MAC_SEP = /^[0-9a-f]{2}([:-])[0-9a-f]{2}(\1[0-9a-f]{2}){4}$/i;
  const RE_MAC_CISCO = /^[0-9a-f]{4}\.[0-9a-f]{4}\.[0-9a-f]{4}$/i;
  // ponytail: bare 12-hex not detected (ambiguous with numbers).

  function parseMac(s) {
    if (RE_MAC_SEP.test(s) || RE_MAC_CISCO.test(s)) {
      const hex = s.replace(/[:.\-]/g, '').toLowerCase();
      if (hex.length !== 12) return null;
      return BigInt('0x' + hex);
    }
    return null;
  }

  // ── Interfaces ──────────────────────────────────────────────────────
  const IFACE_ALIASES = {
    fa: 'FastEthernet', fas: 'FastEthernet', fastethernet: 'FastEthernet',
    gi: 'GigabitEthernet', gig: 'GigabitEthernet', gigabitethernet: 'GigabitEthernet', ge: 'GigabitEthernet',
    te: 'TenGigabitEthernet', ten: 'TenGigabitEthernet', tengig: 'TenGigabitEthernet', tengigabitethernet: 'TenGigabitEthernet',
    twe: 'TwentyFiveGigE', twentyfivegige: 'TwentyFiveGigE', twentyfivegigabitethernet: 'TwentyFiveGigE',
    fo: 'FortyGigabitEthernet', for: 'FortyGigabitEthernet', fortygige: 'FortyGigabitEthernet', fortygigabitethernet: 'FortyGigabitEthernet',
    hu: 'HundredGigE', hun: 'HundredGigE', hundredgige: 'HundredGigE', hundredgigabitethernet: 'HundredGigE',
    eth: 'Ethernet', et: 'Ethernet', ethernet: 'Ethernet',
    po: 'Port-channel', 'port-channel': 'Port-channel', portchannel: 'Port-channel',
    vl: 'Vlan', vlan: 'Vlan',
    lo: 'Loopback', loopback: 'Loopback',
    tu: 'Tunnel', tunnel: 'Tunnel',
    mgmt: 'Management', management: 'Management',
    nve: 'nve',
    bdi: 'BDI',
    se: 'Serial', serial: 'Serial',
    // Junos hyphenated prefixes — canonical keeps the short name (no trailing dash).
    'fe-': 'fe', 'ge-': 'ge', 'xe-': 'xe', 'et-': 'et',
    ae: 'ae', irb: 'irb',
  };

  // ponytail: Junos et- covers 25–400G; ranked with Hu. Arista Ethernet has no speed in its name → rank 99, alpha.
  const SPEED_RANK = {
    FastEthernet: 0, fe: 0,
    GigabitEthernet: 1, ge: 1,
    TenGigabitEthernet: 2, xe: 2,
    TwentyFiveGigE: 3,
    FortyGigabitEthernet: 4,
    HundredGigE: 5, et: 5,
  };

  const RE_IFACE = /^([A-Za-z][A-Za-z-]*?)\s?(\d+(?:[\/.:]\d+)*)(.*)$/;

  function parseIface(s) {
    const m = RE_IFACE.exec(s);
    if (!m) return null;
    const rawPrefix = m[1];
    const lookup = rawPrefix.toLowerCase();
    const canonical = IFACE_ALIASES[lookup];
    if (!canonical) return null; // unknown prefix → natural text (hostnames like sw-core-2)
    const nums = m[2].split(/[\/.:]/).map(BigInt);
    return { r: 3, type: canonical, n: nums, s: m[3] || '' };
  }

  function compareType(a, b, opts) {
    if (opts && opts.ifaceOrder === 'speed') {
      const ra = SPEED_RANK[a] !== undefined ? SPEED_RANK[a] : 99;
      const rb = SPEED_RANK[b] !== undefined ? SPEED_RANK[b] : 99;
      if (ra !== rb) return ra < rb ? -1 : 1;
    }
    return cmpStr(a, b);
  }

  // ── cellKey / compare ───────────────────────────────────────────────
  const RE_INT = /^\d+$/;
  const RE_V4_MASK = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\s*(?:\/|\s)\s*(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
  const RE_V4_PFX = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/;
  const RE_V4_PLAIN = /^\d{1,3}(\.\d{1,3}){3}$/;

  function cellKey(cell, opts) {
    const s = String(cell == null ? '' : cell).trim();
    if (!s) return { r: 4, s: '' };

    // 1. IPv4 + dotted mask
    const maskM = RE_V4_MASK.exec(s);
    if (maskM) {
      const addr = parseV4(maskM[1]);
      const mask = parseV4(maskM[2]);
      if (addr !== null && mask !== null) {
        const len = maskToLen(mask);
        if (len !== null) {
          return { r: 0, n: [addr & v4Mask(len), BigInt(len), addr] };
        }
      }
    }

    // 2. IPv4 / prefix
    const pfxM = RE_V4_PFX.exec(s);
    if (pfxM) {
      const addr = parseV4(pfxM[1]);
      const len = Number(pfxM[2]);
      if (addr !== null && Number.isInteger(len) && len >= 0 && len <= 32) {
        return { r: 0, n: [addr & v4Mask(len), BigInt(len), addr] };
      }
    }

    // 3. IPv4 plain
    if (RE_V4_PLAIN.test(s)) {
      const addr = parseV4(s);
      if (addr !== null) return { r: 0, n: [addr, 32n, addr] };
    }

    // 4. IPv6 / prefix and plain (must contain ':')
    if (s.includes(':') && !RE_MAC_SEP.test(s)) {
      let addrStr = s, len = 128;
      const slash = s.lastIndexOf('/');
      if (slash >= 0) {
        const ls = s.slice(slash + 1);
        if (/^\d{1,3}$/.test(ls)) {
          len = Number(ls);
          if (len <= 128) addrStr = s.slice(0, slash);
          else len = -1;
        } else {
          len = -1;
        }
      }
      if (len >= 0) {
        const addr = parseV6(addrStr);
        if (addr !== null) {
          return { r: 1, n: [addr & v6Mask(len), BigInt(len), addr] };
        }
      }
    }

    // 5. MAC
    const mac = parseMac(s);
    if (mac !== null) return { r: 2, n: [mac] };

    // 6. Interface (known alias only)
    const iface = parseIface(s);
    if (iface) return iface;

    // 7. Fallback natural. ponytail: add a VLAN-range detector (10-20,30) if someone sorts trunk allow-lists.
    return { r: 4, s: s };
  }

  function compareKeys(ka, kb, opts) {
    if (ka.r !== kb.r) return ka.r < kb.r ? -1 : 1;
    if (ka.r === 3) {
      const tc = compareType(ka.type, kb.type, opts);
      if (tc) return tc;
      const nc = cmpNums(ka.n, kb.n);
      if (nc) return nc;
      return cmpStr(ka.s || '', kb.s || '');
    }
    if (ka.r === 0 || ka.r === 1 || ka.r === 2) return cmpNums(ka.n, kb.n);
    return cmpStr(ka.s, kb.s);
  }

  function isEmptyCell(cell) {
    return String(cell == null ? '' : cell).trim() === '';
  }

  function compareCells(a, b, opts) {
    const ea = isEmptyCell(a), eb = isEmptyCell(b);
    if (ea && eb) return 0;
    if (ea) return 1;
    if (eb) return -1;
    return compareKeys(cellKey(a, opts), cellKey(b, opts), opts || {});
  }

  function isTypedCell(cell) {
    const s = String(cell == null ? '' : cell).trim();
    if (!s) return false;
    if (RE_INT.test(s)) return true;
    const k = cellKey(s);
    return k.r <= 3;
  }

  function sortRows(rows, keys, opts) {
    opts = opts || {};
    const wrapped = rows.map((cells, i) => ({ cells, i }));
    if (!keys || !keys.length) return wrapped;

    const caches = keys.map(k => wrapped.map(w => {
      const cell = w.cells[k.col];
      const empty = isEmptyCell(cell);
      return { empty, key: empty ? null : cellKey(cell, opts) };
    }));

    wrapped.sort((A, B) => {
      for (let ki = 0; ki < keys.length; ki++) {
        const ca = caches[ki][A.i];
        const cb = caches[ki][B.i];
        if (ca.empty && cb.empty) continue;
        if (ca.empty) return 1;  // empties last in BOTH directions
        if (cb.empty) return -1;
        const c = compareKeys(ca.key, cb.key, opts);
        if (c) return keys[ki].dir === 'desc' ? -c : c;
      }
      return 0; // stable — original order
    });
    return wrapped;
  }

  // ── Parsing ─────────────────────────────────────────────────────────
  // RFC-4180: records split only on newlines outside double quotes; "" is an escaped quote.
  // A " opens a quoted field only at field start (record start, after a delimiter,
  // or when the field so far is empty/whitespace). Mid-field inch marks are literal.
  function isDelimCandidate(ch) {
    return ch === '\t' || ch === ',' || ch === ';' || ch === '|';
  }

  function splitRecords(text) {
    const records = [];
    let cur = '';
    let field = '';
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        cur += ch;
        field += ch;
        if (ch === '"') {
          if (text[i + 1] === '"') { cur += text[++i]; field += text[i]; }
          else inQ = false;
        }
      } else if (ch === '"' && field.trim() === '') {
        inQ = true;
        cur += ch;
        field += ch;
      } else if (ch === '\n') {
        records.push(cur);
        cur = '';
        field = '';
      } else {
        cur += ch;
        if (isDelimCandidate(ch)) field = '';
        else field += ch;
      }
    }
    records.push(cur);
    return records;
  }

  function countDelimOutsideQuotes(line, delim) {
    let n = 0, inQ = false, cur = '';
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        cur += ch;
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += line[++i]; }
          else inQ = false;
        }
      } else if (ch === '"' && cur.trim() === '') {
        inQ = true;
        cur += ch;
      } else if (ch === delim) {
        n++;
        cur = '';
      } else {
        cur += ch;
      }
    }
    return n;
  }

  function detectDelimiter(text) {
    const raw = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = splitRecords(raw).filter(l => l.trim() !== '').slice(0, 20);
    if (!lines.length) return 'ws';
    const candidates = ['\t', ',', ';', '|'];
    let best = null, bestMin = -1;
    for (const delim of candidates) {
      const counts = lines.map(l => countDelimOutsideQuotes(l, delim));
      const hits = counts.filter(c => c >= 1);
      if (hits.length < 0.8 * lines.length) continue;
      const minCount = Math.min.apply(null, hits);
      if (minCount > bestMin) {
        bestMin = minCount;
        best = delim;
      }
    }
    return best || 'ws';
  }

  function parseDelimitedLine(line, delim) {
    const cells = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"') {
          if (line[i + 1] === '"') { cur += '"'; i++; }
          else inQ = false;
        } else {
          cur += ch;
        }
      } else if (ch === '"' && cur.trim() === '') {
        inQ = true;
      } else if (ch === '"') {
        cur += ch;
      } else if (delim === '|' && ch === '\\') {
        const nxt = line[i + 1];
        if (nxt === '|' || nxt === '\\') { cur += nxt; i++; }
        else cur += ch;
      } else if (ch === delim) {
        cells.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    return cells;
  }

  // Full separator row only (every cell dashes/colons). A data cell starting with --- is kept.
  const RE_MD_SEP = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

  function parseTable(text, opts) {
    opts = opts || {};
    const raw = String(text == null ? '' : text).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    // ponytail: blank lines are dropped (leading, trailing, and interior). Quoted newlines stay in the cell.
    const lines = splitRecords(raw).filter(l => l.trim() !== '');
    const delimiter = opts.delimiter && opts.delimiter !== 'auto'
      ? opts.delimiter
      : detectDelimiter(raw);

    let rows;
    if (delimiter === 'ws') {
      rows = lines.map(l => l.trim().split(/\t| {2,}/));
    } else if (delimiter === '|') {
      rows = [];
      for (const line of lines) {
        if (RE_MD_SEP.test(line)) continue;
        let s = line.trim();
        if (s.charAt(0) === '|') s = s.slice(1);
        if (s.charAt(s.length - 1) === '|') s = s.slice(0, -1);
        rows.push(parseDelimitedLine(s, '|'));
      }
    } else {
      rows = lines.map(l => parseDelimitedLine(l, delimiter));
    }

    let width = 0;
    for (const r of rows) if (r.length > width) width = r.length;
    for (const r of rows) while (r.length < width) r.push('');

    let hasHeader = false;
    const headerOpt = opts.header;
    if (headerOpt === true || headerOpt === 'yes') {
      hasHeader = rows.length > 0;
    } else if (headerOpt === false || headerOpt === 'no') {
      hasHeader = false;
    } else {
      // auto: no typed cell in row 0 AND at least one typed cell in rows 1..n
      if (rows.length >= 2 && !rows[0].some(isTypedCell)) {
        let typedLater = false;
        for (let i = 1; i < rows.length; i++) {
          if (rows[i].some(isTypedCell)) { typedLater = true; break; }
        }
        hasHeader = typedLater;
      }
    }

    let headers = null;
    if (hasHeader && rows.length) headers = rows.shift();
    return { delimiter, hasHeader: !!hasHeader, headers, rows };
  }

  // ── Exporters ───────────────────────────────────────────────────────
  function quoteIf(s, specials) {
    s = String(s == null ? '' : s);
    let need = false;
    for (let i = 0; i < specials.length; i++) {
      if (s.indexOf(specials[i]) !== -1) { need = true; break; }
    }
    if (!need) return s;
    return '"' + s.replace(/"/g, '""') + '"';
  }

  function joinRows(headers, rows, delim, specials) {
    const lines = [];
    if (headers && headers.length) lines.push(headers.map(c => quoteIf(c, specials)).join(delim));
    for (const row of rows) lines.push(row.map(c => quoteIf(c, specials)).join(delim));
    return lines.join('\n');
  }

  function toTSV(headers, rows) {
    return joinRows(headers, rows, '\t', ['\t', '\n', '"']);
  }

  function toCSV(headers, rows) {
    return joinRows(headers, rows, ',', [',', '"', '\n', '\r']);
  }

  function mdCell(s) {
    return String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
  }

  function toMarkdown(headers, rows) {
    const width = Math.max(
      headers && headers.length ? headers.length : 0,
      rows.reduce((m, r) => Math.max(m, r.length), 0)
    );
    const hdr = (headers ? headers.slice() : []).map(mdCell);
    while (hdr.length < width) hdr.push('');
    const sep = hdr.map(() => '---');
    const lines = [
      '| ' + hdr.join(' | ') + ' |',
      '| ' + sep.join(' | ') + ' |',
    ];
    for (const row of rows) {
      const cells = [];
      for (let i = 0; i < width; i++) cells.push(mdCell(row[i]));
      lines.push('| ' + cells.join(' | ') + ' |');
    }
    return lines.join('\n');
  }

  const SAMPLE = [
    'Port\tIP\tMAC\tHostname',
    'Eth1/10\t10.0.0.10\taa:bb:cc:00:00:0a\tsw-core-10',
    'Eth1/2\t10.0.0.2\taa:bb:cc:00:00:02\tsw-core-2',
    'Gi1/0/1\t2001:db8::10\taabb.cc00.0010\tleaf-1',
    'GigabitEthernet1/0/2\t2001:db8::a\taa-bb-cc-00-00-03\tleaf-2',
    'Te1/1\t10.2.0.0/16\taa:bb:cc:00:00:10\tcore-uplink',
    'Fa0/1\t10.2.0.0/24\t0000.0c00.0001\taccess-1',
  ].join('\n');

  const api = {
    detectDelimiter,
    parseTable,
    cellKey,
    compareCells,
    sortRows,
    toTSV,
    toCSV,
    toMarkdown,
    SAMPLE,
  };

  root.NetTableSort = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
