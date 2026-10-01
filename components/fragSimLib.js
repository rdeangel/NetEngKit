/* ──────────────────────────────────────────────────────────────────────
 * fragSimLib.js — IPv4 fragmentation / PMTUD / reassembly engine.
 *
 * Pure, dependency-free, no i18n strings. Loaded as a plain <script src>
 * (global window.FragSim) and requireable in Node for the assert harness.
 * Findings are { code, sev, params, rows } objects; the UI maps code → text.
 *
 *   fragDatagram / fragMaxChunk / fragSplit / fragPath
 *   fragIcmpNeeded / PLATEAUS / fragPlateauBelow / fragPmtud
 *   fragReassemble / fragParse / fragParseHops
 *   fragExport / fragToTSV / SAMPLE_ROWS / DEFAULTS
 *
 * All sizes are bytes. `payload` = IP payload (total length minus header).
 * ────────────────────────────────────────────────────────────────────── */
(function (root) {
  'use strict';

  const FRAG_EXPORT_VERSION = 1;
  const MAX_HOPS = 16;
  const MAX_LINES = 2000;
  const MAX_CHARS = 200000;
  const OVERLAP_CAP = 500; // ponytail: findings cap; O(n^2) pair walk stops here.
  const PLATEAUS = [65535, 32000, 17914, 8166, 4352, 2002, 1492, 1006, 508, 296, 68]; // RFC 1191 §7

  const finding = (code, sev, params, rows) => ({ code, sev, params: params || {}, rows: rows || [] });
  const isInt = (n) => typeof n === 'number' && Number.isInteger(n);

  // ── Datagram ────────────────────────────────────────────────────────
  function build(f) {
    const offset8 = f.offset8 || 0;
    return {
      id: f.id,
      hdrLen: f.hdrLen,
      tailHdrLen: f.tailHdrLen == null ? f.hdrLen : f.tailHdrLen,
      payload: f.payload,
      offset8,
      offsetBytes: offset8 * 8,
      mf: f.mf ? 1 : 0,
      df: f.df ? 1 : 0,
      totalLength: f.hdrLen + f.payload,
      tail: f.payload % 8,
      slack: f.slack || 0,
      origin: f.origin == null ? '1' : String(f.origin),
    };
  }

  function fragDatagram(opts) {
    const o = opts || {};
    const hdrLen = o.hdrLen == null ? 20 : o.hdrLen;
    const id = o.id == null ? 0x1c46 : o.id;
    const errors = [];
    if (!isInt(hdrLen) || hdrLen < 20 || hdrLen > 60 || hdrLen % 4) errors.push(finding('BAD_HDRLEN', 'error', { hdrLen }));
    if (!isInt(id) || id < 0 || id > 65535) errors.push(finding('BAD_ID', 'error', { id }));
    let payload = o.payload;
    if (payload == null && o.totalLength != null) payload = o.totalLength - hdrLen;
    if (!isInt(payload) || payload < 1) {
      errors.push(finding('BAD_SIZE', 'error', { hdrLen, size: o.totalLength != null ? o.totalLength : o.payload }));
    } else if (hdrLen + payload > 65535) {
      errors.push(finding('TOO_LARGE', 'error', { total: hdrLen + payload }));
    }
    if (errors.length) return { datagram: null, errors };
    const optionsCopied = o.optionsCopied !== false;
    return {
      datagram: build({ id, hdrLen, tailHdrLen: optionsCopied ? hdrLen : 20, payload, offset8: 0, mf: 0, df: o.df ? 1 : 0, origin: '1' }),
      errors,
    };
  }

  // Largest payload (multiple of 8) a packet with this header can carry at this MTU.
  function fragMaxChunk(mtu, hdrLen) { return Math.floor((mtu - hdrLen) / 8) * 8; }

  // ── ICMP type 3 code 4 ──────────────────────────────────────────────
  function fragIcmpNeeded(frag, nextHopMtu, o) {
    const legacy = !!(o && o.legacy);
    return {
      type: 3, code: 4,
      nextHopMtu: legacy ? 0 : nextHopMtu,
      quoted: { version: 4, ihl: frag.hdrLen / 4, totalLength: frag.totalLength, id: frag.id, df: frag.df, mf: frag.mf, offset8: frag.offset8 },
      quotedDataBytes: 8,
      rfc: 'RFC 1191',
    };
  }

  // ── Split one packet for one link ───────────────────────────────────
  function fragSplit(frag, mtu) {
    if (frag.totalLength <= mtu) return { pieces: [frag], icmp: null };
    if (frag.df) return { pieces: [], icmp: fragIcmpNeeded(frag, mtu) };
    const pieces = [];
    let remaining = frag.payload;
    let consumed = 0;
    for (let k = 0; remaining > 0; k++) {
      const hdrLen = frag.offset8 === 0 && k === 0 ? frag.hdrLen : frag.tailHdrLen;
      const last = remaining + hdrLen <= mtu;
      const chunk = last ? remaining : fragMaxChunk(mtu, hdrLen);
      if (chunk < 1) break; // fragPath rejects such MTUs up front
      const p = build({
        id: frag.id, hdrLen, tailHdrLen: frag.tailHdrLen, payload: chunk,
        offset8: frag.offset8 + consumed / 8,
        mf: last ? frag.mf : 1, // re-fragmentation: the final piece inherits the parent's MF
        df: 0,
        slack: last ? 0 : mtu - hdrLen - chunk,
        origin: frag.origin + '.' + (k + 1),
      });
      pieces.push(p);
      consumed += chunk;
      remaining -= chunk;
    }
    return { pieces, icmp: null };
  }

  // ── Whole path ──────────────────────────────────────────────────────
  function fragPath(datagram, hops) {
    const list = hops || [];
    const empty = (errors) => ({ hops: [], fragments: [], icmp: null, droppedAtHop: null, errors });
    const errors = [];
    if (list.length > MAX_HOPS) errors.push(finding('TOO_MANY_HOPS', 'error', { max: MAX_HOPS }));
    list.forEach((mtu, i) => {
      if (!isInt(mtu) || mtu > 65535) { errors.push(finding('MTU_BAD', 'error', { hop: i + 1, mtu: String(mtu) })); return; }
      if (mtu < 68) { errors.push(finding('MTU_BELOW_68', 'error', { hop: i + 1, mtu })); return; }
      if (fragMaxChunk(mtu, datagram.hdrLen) < 8 || fragMaxChunk(mtu, datagram.tailHdrLen) < 8) {
        errors.push(finding('MTU_TOO_SMALL_FOR_HDR', 'error', { hop: i + 1, mtu, hdrLen: datagram.hdrLen }));
      }
    });
    if (errors.length) return empty(errors);

    let current = [datagram];
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const next = [];
      for (const p of current) {
        const s = fragSplit(p, list[i]);
        if (s.icmp) {
          out.push({ mtu: list[i], inCount: current.length, fragments: [], icmp: s.icmp });
          return { hops: out, fragments: [], icmp: s.icmp, droppedAtHop: i, errors };
        }
        next.push(...s.pieces);
      }
      out.push({ mtu: list[i], inCount: current.length, fragments: next, icmp: null });
      current = next;
    }
    return { hops: out, fragments: current, icmp: null, droppedAtHop: null, errors };
  }

  // ── PMTUD ───────────────────────────────────────────────────────────
  function fragPlateauBelow(size) {
    for (const p of PLATEAUS) if (p < size) return p;
    return 68;
  }

  function fragPmtud(datagram, hops, o) {
    const legacy = !!(o && o.legacy);
    const icmpBlocked = !!(o && o.icmpBlocked);
    const maxAttempts = (o && o.maxAttempts) || 3;
    const attempts = [];
    let size = datagram.totalLength;
    const res = (status, extra) => Object.assign({ status, attempts, pmtu: null, mss: null, errors: [] }, extra);

    for (let n = 0; n < 32; n++) {
      const dg = build({ ...datagram, payload: size - datagram.hdrLen, offset8: 0, mf: 0, df: 1 });
      const r = fragPath(dg, hops);
      if (r.errors.length) return res('invalid', { errors: r.errors });
      if (r.droppedAtHop === null) {
        attempts.push({ size, droppedAtHop: null, hopMtu: null, icmp: null, nextSize: null });
        return res('delivered', { pmtu: size, mss: Math.max(0, size - datagram.hdrLen - 20) });
      }
      const hopMtu = hops[r.droppedAtHop];
      if (icmpBlocked) {
        attempts.push({ size, droppedAtHop: r.droppedAtHop, hopMtu, icmp: null, nextSize: null });
        if (attempts.length >= maxAttempts) return res('blackhole');
        continue; // retransmit at the same size
      }
      const icmp = legacy ? fragIcmpNeeded(dg, hopMtu, { legacy: true }) : r.icmp;
      const nextSize = legacy ? fragPlateauBelow(size) : icmp.nextHopMtu;
      attempts.push({ size, droppedAtHop: r.droppedAtHop, hopMtu, icmp, nextSize });
      if (!(nextSize < size) || nextSize <= datagram.hdrLen) {
        return res('invalid', { errors: [finding('PMTUD_NO_CONVERGE', 'error', { size })] });
      }
      size = nextSize;
    }
    return res('invalid', { errors: [finding('PMTUD_NO_CONVERGE', 'error', { size })] });
  }

  // ── Reassembly ──────────────────────────────────────────────────────
  function fragReassemble(frags, o) {
    // Effective header length: explicit option > offset-0 fragment's header
    // (RFC 791: the reassembled datagram carries the first fragment's header) > 20.
    const pickHdr = (h) => (isInt(h) && h >= 20 && h <= 60 && h % 4 === 0 ? h : null);
    const hdrLen = pickHdr(o && o.hdrLen) || pickHdr((frags.find(f => f.offsetBytes === 0) || {}).hdrLen) || 20;
    const findings = [];
    const out = (extra) => Object.assign({
      id: null, state: 'incomplete', payloadLength: null, totalLength: null,
      coverage: [], gaps: [], findings, timeExceededSent: false,
    }, extra);
    if (!frags.length) return out();

    // Reference ID = the most common ID (first seen wins ties), not simply row 0's.
    const idCount = new Map();
    frags.forEach(f => idCount.set(f.id, (idCount.get(f.id) || 0) + 1));
    let refId = frags[0].id, bestN = 0;
    idCount.forEach((n, id) => { if (n > bestN) { bestN = n; refId = id; } });
    const kept = [];
    frags.forEach((f, i) => {
      if (f.id !== refId) { findings.push(finding('ID_MISMATCH', 'warn', { id: f.id, expected: refId }, [i])); return; }
      if (f.mf && f.payload % 8) findings.push(finding('MISALIGNED_NONLAST', 'error', { payload: f.payload }, [i]));
      kept.push({ i, start: f.offsetBytes, end: f.offsetBytes + f.payload, mf: f.mf });
    });
    kept.sort((a, b) => a.start - b.start || a.i - b.i);

    // Last fragment(s)
    const lasts = kept.filter(k => !k.mf);
    let lastEnd = null;
    if (!lasts.length) {
      findings.push(finding('NO_LAST', 'error', {}, []));
    } else {
      lastEnd = lasts[0].end;
      if (lasts.some(l => l.end !== lastEnd)) {
        findings.push(finding('CONFLICTING_LAST', 'error', { ends: lasts.map(l => l.end).join(', ') }, lasts.map(l => l.i)));
      }
    }
    if (lastEnd !== null) {
      kept.forEach(k => { if (k.end > lastEnd) findings.push(finding('BEYOND_LAST', 'error', { end: k.end - 1, last: lastEnd - 1 }, [k.i])); });
    }

    // Overlap / duplicate (sorted by start, so the inner walk can stop early)
    let nOverlap = 0;
    for (let a = 0; a < kept.length && nOverlap < OVERLAP_CAP; a++) {
      for (let b = a + 1; b < kept.length && kept[b].start < kept[a].end; b++) {
        const A = kept[a], B = kept[b];
        nOverlap++;
        if (A.start === B.start && A.end === B.end) findings.push(finding('DUPLICATE', 'info', { start: A.start, end: A.end - 1 }, [A.i, B.i]));
        else findings.push(finding('OVERLAP', 'warn', { aStart: A.start, aEnd: A.end - 1, bStart: B.start, bEnd: B.end - 1 }, [A.i, B.i]));
        if (nOverlap >= OVERLAP_CAP) break;
      }
    }

    // Coverage + gaps (inclusive byte ranges)
    const coverage = [];
    for (const k of kept) {
      const c = coverage[coverage.length - 1];
      if (c && k.start <= c.end + 1) { c.end = Math.max(c.end, k.end - 1); c.rows.push(k.i); }
      else coverage.push({ start: k.start, end: k.end - 1, rows: [k.i] });
    }
    const gaps = [];
    let cursor = 0;
    for (const c of coverage) {
      if (c.start > cursor) gaps.push({ start: cursor, end: c.start - 1 });
      cursor = Math.max(cursor, c.end + 1);
    }
    if (lastEnd !== null && cursor < lastEnd) gaps.push({ start: cursor, end: lastEnd - 1 });
    gaps.forEach(g => findings.push(finding('GAP', 'error', { start: g.start, end: g.end }, [])));

    const maxEnd = kept.reduce((m, k) => Math.max(m, k.end), 0);
    if (maxEnd > 0 && hdrLen + maxEnd > 65535) findings.push(finding('TOTAL_TOO_LARGE', 'error', { total: hdrLen + maxEnd }, []));

    const hard = findings.some(f => f.sev === 'error' && f.code !== 'GAP' && f.code !== 'NO_LAST');
    const incomplete = gaps.length > 0 || lastEnd === null;
    const state = hard ? 'invalid' : incomplete ? 'incomplete' : 'complete';
    return out({
      id: refId, state,
      payloadLength: lastEnd, totalLength: lastEnd === null ? null : hdrLen + lastEnd,
      coverage, gaps,
      timeExceededSent: state === 'incomplete' && kept.some(k => k.start === 0),
    });
  }

  // ── Parse (own JSON export, or `id offset length mf` lines) ─────────
  function fragParseHops(text) {
    return String(text || '').split(/[\s,]+/).filter(Boolean).map(s => (/^\d+$/.test(s) ? parseInt(s, 10) : NaN));
  }

  const toNum = (s) => (/^0x[0-9a-f]+$/i.test(s) ? parseInt(s, 16) : /^\d+$/.test(s) ? parseInt(s, 10) : NaN);

  function mkParsed(id, payload, offset8, mf, origin, hdrLen) {
    return build({ id, hdrLen: hdrLen || 20, tailHdrLen: 20, payload, offset8, mf, df: 0, origin });
  }

  function fragParse(text, o) {
    const unit = (o && o.offsetUnit) || 'bytes';
    const findings = [];
    const frags = [];
    let src = String(text || '');
    if (src.length > MAX_CHARS) { src = src.slice(0, MAX_CHARS); findings.push(finding('INPUT_TRUNCATED', 'warn', { chars: MAX_CHARS })); }

    if (src.trim().charAt(0) === '{') {
      let j;
      try { j = JSON.parse(src); } catch (e) { return { frags, findings: [finding('PARSE_ERROR', 'error', { line: 1, field: 'json' })] }; }
      if (!j || j.kind !== 'ipv4-frag-sim') return { frags, findings: [finding('PARSE_ERROR', 'error', { line: 1, field: 'kind' })] };
      if (j.v !== FRAG_EXPORT_VERSION) return { frags, findings: [finding('PARSE_ERROR', 'error', { line: 1, field: 'version' })] };
      const metaHdr = j.meta && isInt(j.meta.hdrLen) && j.meta.hdrLen >= 20 && j.meta.hdrLen <= 60 && j.meta.hdrLen % 4 === 0 ? j.meta.hdrLen : 20;
      (Array.isArray(j.fragments) ? j.fragments : []).slice(0, MAX_LINES).forEach((f, n) => {
        const line = n + 1;
        const off8 = isInt(f.offset8) ? f.offset8 : isInt(f.offsetBytes) && f.offsetBytes % 8 === 0 ? f.offsetBytes / 8 : NaN;
        if (!isInt(f.id) || f.id < 0 || f.id > 65535) return findings.push(finding('PARSE_ERROR', 'error', { line, field: 'id' }));
        if (!isInt(off8) || off8 < 0 || off8 > 8191) return findings.push(finding('PARSE_ERROR', 'error', { line, field: 'offset' }));
        if (!isInt(f.payload) || f.payload < 1 || f.payload > 65535) return findings.push(finding('PARSE_ERROR', 'error', { line, field: 'length' }));
        frags.push(mkParsed(f.id, f.payload, off8, f.mf ? 1 : 0, String(line), metaHdr));
      });
      return { frags, findings, hdrLen: metaHdr };
    }

    const lines = src.split(/\r?\n/).slice(0, MAX_LINES);
    if (src.split(/\r?\n/).length > MAX_LINES) findings.push(finding('INPUT_TRUNCATED', 'warn', { lines: MAX_LINES }));
    let seenData = false;
    lines.forEach((raw, n) => {
      const line = n + 1;
      const s = raw.replace(/#.*/, '').trim();
      if (!s) return;
      const tok = s.split(/[\s,]+/).filter(Boolean);
      if (!seenData && !/^(0x[0-9a-f]+|\d+)$/i.test(tok[0])) { seenData = true; return; } // header line
      seenData = true;
      if (tok.length < 4) return findings.push(finding('PARSE_ERROR', 'error', { line, field: 'line' }));
      const id = toNum(tok[0]);
      if (!(id >= 0 && id <= 65535)) return findings.push(finding('PARSE_ERROR', 'error', { line, field: 'id' }));
      const off = toNum(tok[1]);
      if (!(off >= 0)) return findings.push(finding('PARSE_ERROR', 'error', { line, field: 'offset' }));
      let off8 = off;
      if (unit === 'bytes') {
        if (off % 8) return findings.push(finding('OFFSET_NOT_8', 'error', { line, offset: off }));
        off8 = off / 8;
      }
      if (off8 > 8191) return findings.push(finding('PARSE_ERROR', 'error', { line, field: 'offset' }));
      const len = toNum(tok[2]);
      if (!(len >= 1 && len <= 65535)) return findings.push(finding('PARSE_ERROR', 'error', { line, field: 'length' }));
      const mfRaw = tok[3].toLowerCase();
      const mf = mfRaw === '1' || mfRaw === 'true' ? 1 : mfRaw === '0' || mfRaw === 'false' ? 0 : NaN;
      if (Number.isNaN(mf)) return findings.push(finding('PARSE_ERROR', 'error', { line, field: 'mf' }));
      frags.push(mkParsed(id, len, off8, mf, String(line)));
    });
    return { frags, findings, hdrLen: 20 };
  }

  // ── Export ──────────────────────────────────────────────────────────
  function fragExport(fragments, meta) {
    const m = meta || {};
    return JSON.stringify({
      v: FRAG_EXPORT_VERSION,
      kind: 'ipv4-frag-sim',
      meta: { totalLength: m.totalLength, hdrLen: m.hdrLen, id: m.id, hops: m.hops },
      fragments: fragments.map(f => ({
        id: f.id, totalLength: f.totalLength, hdrLen: f.hdrLen, payload: f.payload,
        offset8: f.offset8, offsetBytes: f.offsetBytes, mf: f.mf, df: f.df,
      })),
    }, null, 2);
  }

  const TSV_HEADERS = ['#', 'ID', 'Total Length', 'Header', 'Payload', 'Offset (8-byte units)', 'Offset (bytes)', 'MF', 'Slack'];
  function fragToTSV(fragments, headers) {
    return [(headers || TSV_HEADERS).join('\t')]
      .concat(fragments.map(f => [f.origin, '0x' + f.id.toString(16).padStart(4, '0'), f.totalLength, f.hdrLen, f.payload, f.offset8, f.offsetBytes, f.mf, f.slack].join('\t')))
      .join('\n');
  }

  const SAMPLE_ROWS = [
    '# id offset(bytes) length mf — IP payload bytes per fragment',
    '# 4000-byte datagram over MTU 1500; middle fragment never arrived',
    '7238 2960 1020 0',
    '7238 0 1480 1',
  ].join('\n');

  const DEFAULTS = {
    sizeMode: 'total', size: 4000, hdrLen: 20, optionsCopied: true, id: 0x1c46,
    hops: '1500', pmtudHops: '1500, 1400, 1300', legacy: false, icmpBlocked: false,
  };

  const api = {
    FRAG_EXPORT_VERSION, PLATEAUS, SAMPLE_ROWS, DEFAULTS,
    fragDatagram, fragMaxChunk, fragSplit, fragPath, fragIcmpNeeded,
    fragPlateauBelow, fragPmtud, fragReassemble, fragParse, fragParseHops,
    fragExport, fragToTSV,
  };

  root.FragSim = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
