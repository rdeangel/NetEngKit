const { useEffect, useMemo, useRef } = React;

// <aspr-engine>
const ASPR_MAX32 = 4294967295;
const ASPR_DIALECTS = ['cisco', 'junos', 'eos_asn', 'eos_string'];
const ASPR_MAX_ENTRIES = 8;
const ASPR_MAX_PATHS = 200;
const ASPR_MAX_PATH_LEN = 512;
// Cisco IOS/IOS-XE '_' = start, end, space, comma, brace, paren (Cisco doc 13754).
const ASPR_US = '(?:^|$|[ ,{}()])';

// One test line → { subject, tokens, seg } | { err } | null (blank line, skipped).
// '""' = empty AS_PATH (locally originated). Sets {a b}/{a,b} → Cisco form {a,b};
// confed (a b) kept. tokens = every ASN flattened, for the token dialects.
function asprParsePath(line) {
  const s = String(line || '').trim();
  if (!s) return null;
  if (s === '""') return { subject: '', tokens: [], seg: false };
  if (s.length > ASPR_MAX_PATH_LEN) return { err: 'err_path_long' };
  const re = /\s*(\{[^{}()]*\}|\([^{}()]*\)|\d+)\s*/y;
  const out = [], tokens = [];
  let i = 0, seg = false;
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) return { err: 'err_path' };
    i = re.lastIndex;
    const tok = m[1], br = tok[0];
    const nums = /\d/.test(br) ? [tok] : tok.slice(1, -1).split(/[\s,]+/).filter(Boolean);
    if (!nums.length || nums.some(a => !/^\d+$/.test(a) || +a > ASPR_MAX32)) return { err: 'err_path' };
    tokens.push(...nums);
    if (br === '{') { seg = true; out.push('{' + nums.join(',') + '}'); }
    else if (br === '(') { seg = true; out.push('(' + nums.join(' ') + ')'); }
    else out.push(tok);
  }
  return { subject: out.join(' '), tokens, seg };
}

// Cisco / EOS string mode: POSIX 1003.2 subset → JS RegExp source.
function asprCompileString(src) {
  let js = '', i = 0, groups = 0, prevQ = false, canQ = false;
  const refs = [];
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') {
      const n = src[i + 1];
      if (n === undefined) return { err: { key: 'err_escape', vars: { tok: '\\' } } };
      if (/[1-9]/.test(n)) { refs.push(+n); js += '\\' + n; }
      else if ('.^$*+?()[]{}|\\_'.includes(n)) js += n === '_' ? '_' : '\\' + n;
      else return { err: { key: 'err_non_posix', vars: { tok: '\\' + n } } };
      i += 2; prevQ = false; canQ = true; continue;
    }
    if (c === '[') {
      // POSIX bracket: ']' first is literal, backslash literal. No [:class:].
      let j = i + 1, body = '';
      if (src[j] === '^') { body += '^'; j++; }
      if (src[j] === ']') { body += '\\]'; j++; }
      while (j < src.length && src[j] !== ']') {
        if (src[j] === '[' && src[j + 1] === ':') return { err: { key: 'err_non_posix', vars: { tok: '[:' } } };
        body += src[j] === '\\' ? '\\\\' : src[j];
        j++;
      }
      if (j >= src.length) return { err: { key: 'err_regex', vars: { msg: '[' } } };
      js += '[' + body + ']';
      i = j + 1; prevQ = false; canQ = true; continue;
    }
    if ('*+?'.includes(c)) {
      if (prevQ) return { err: { key: 'err_non_posix', vars: { tok: src[i - 1] + c } } };
      if (!canQ) return { err: { key: 'err_nothing_to_repeat', vars: { tok: c } } };
      js += c; i++; prevQ = true; continue;
    }
    prevQ = false;
    if (c === '(') {
      if (src[i + 1] === '?') return { err: { key: 'err_non_posix', vars: { tok: '(?' } } };
      groups++; js += '('; canQ = false;
    } else if (c === '_') { js += ASPR_US; canQ = true; }
    else if (c === '{' || c === '}') { js += '\\' + c; canQ = true; }   // literal: AS_SET braces
    else if (c === '|') { js += c; canQ = false; }
    else if (c === '^') { js += c; canQ = false; }
    else { js += c; canQ = true; }   // '.', '$', ')', digits, space, ','…
    i++;
  }
  const bad = refs.find(n => n > groups);
  if (bad) return { err: { key: 'err_backref', vars: { n: bad } } };
  try { return { kind: 'string', re: new RegExp(js) }; }
  catch (e) { return { err: { key: 'err_regex', vars: { msg: e.message } } }; }
}

// Junos / EOS asn mode: lex into whole-AS terms.
function asprLexToken(src, dialect) {
  const J = dialect === 'junos';
  const out = [];
  let i = 0, aStart = false, aEnd = false;
  const bad = (key, tok) => ({ err: { key, vars: { tok } } });
  while (i < src.length) {
    const c = src[i], rest = src.slice(i);
    let m;
    if (aEnd && !/\s/.test(c)) return bad('err_anchor', '$');
    if (/\s/.test(c) || (!J && c === '_')) { i++; continue; }
    if ((m = /^(\d+)(?:-(\d+))?/.exec(rest))) {
      if (m[2] !== undefined && !J) return bad('err_eos_asn_unsupported', m[0]);
      if (+m[1] > ASPR_MAX32 || (m[2] !== undefined && (+m[2] > ASPR_MAX32 || +m[2] < +m[1]))) return bad('err_asn_range', m[0]);
      out.push(m[2] !== undefined ? { t: 'set', neg: false, items: [[+m[1], +m[2]]] } : { t: 'num', v: m[1] });
      i += m[0].length; continue;
    }
    if (c === '[') {
      if (!J) return bad('err_eos_asn_unsupported', '[');
      m = /^\[(\^?)([^\]]*)\]/.exec(rest);
      if (!m) return bad('err_char', c);
      const items = [];
      for (const it of m[2].trim().split(/\s+/).filter(Boolean)) {
        const r = /^(\d+)(?:-(\d+))?$/.exec(it);
        if (!r) return bad('err_char', it);
        const lo = +r[1], hi = r[2] !== undefined ? +r[2] : lo;
        if (hi > ASPR_MAX32 || hi < lo) return bad('err_asn_range', it);
        items.push([lo, hi]);
      }
      if (!items.length) return bad('err_char', m[0]);
      out.push({ t: 'set', neg: m[1] === '^', items });
      i += m[0].length; continue;
    }
    if (c === '{') {
      if (!J) return bad('err_eos_asn_unsupported', '{');
      m = /^\{(\d+)(,(\d*))?\}/.exec(rest);
      if (!m) return bad('err_char', c);
      out.push({ t: 'q', s: m[0] });
      i += m[0].length; continue;
    }
    if (c === '^') { if (out.length) return bad('err_anchor', '^'); aStart = true; i++; continue; }
    if (c === '$') { aEnd = true; i++; continue; }
    if (c === '.') out.push({ t: 'any' });
    else if ('()|'.includes(c)) out.push({ t: c });
    else if ('*+?'.includes(c)) {
      const prev = out[out.length - 1];
      if (prev && prev.t === 'q') return bad('err_non_posix', (prev.s || '') + c);
      out.push({ t: 'q', s: c });
    }
    else return bad('err_char', c);
    i++;
  }
  return { toks: out, aStart, aEnd };
}

// Subject for token dialects: every ASN followed by one space ("100 65001 200 ").
function asprTokenSource(lex, dialect, pathTokens) {
  const inSet = (v, s) => s.items.some(([lo, hi]) => v >= lo && v <= hi) !== s.neg;
  const body = lex.toks.map(k => {
    if (k.t === 'num') return '(?:' + k.v + ' )';
    if (k.t === 'any') return '(?:\\d+ )';
    if (k.t === 'set') {
      const hit = [...new Set(pathTokens.filter(v => inSet(+v, k)))];
      return hit.length ? '(?:' + hit.map(v => v + ' ').join('|') + ')' : '(?!)';
    }
    if (k.t === 'q') return k.s;
    return k.t;
  }).join('');
  if (dialect === 'junos') return '^(?:' + body + ')$';   // Junos: always whole-path
  return (lex.aStart ? '^' : '(?<![^ ])') + '(?:' + body + ')' + (lex.aEnd ? '$' : '');
}

function asprCompile(src, dialect) {
  if (!String(src).trim()) return { err: { key: '' } };
  if (dialect === 'cisco' || dialect === 'eos_string') return asprCompileString(src);
  const lex = asprLexToken(src, dialect);
  if (lex.err) return lex;
  try { new RegExp(asprTokenSource(lex, dialect, [])); }
  catch (e) { return { err: { key: 'err_regex', vars: { msg: e.message } } }; }
  return { kind: 'token', lex, dialect };
}

// → null (no match) | { span: [start, end] in display string, groups: [...] }
function asprMatch(comp, path) {
  if (comp.kind === 'string') {
    const m = comp.re.exec(path.subject);
    if (!m) return null;
    return { display: path.subject, span: [m.index, m.index + m[0].length], groups: m.slice(1).map(g => (g === undefined ? null : g)) };
  }
  const subj = path.tokens.map(v => v + ' ').join('');
  const m = new RegExp(asprTokenSource(comp.lex, comp.dialect, path.tokens)).exec(subj);
  if (!m) return null;
  const display = path.tokens.join(' ');
  return { display, span: [m.index, m.index + m[0].replace(/ +$/, '').length], groups: m.slice(1).map(g => (g === undefined ? null : g.trim())) };
}

// entries: [{ action: 'permit'|'deny', regex }]. First match wins; none → implicit deny.
// ponytail: no Worker/timeout; crafted regex can freeze the tab, reload recovers. Move asprEvaluate into a Worker if anyone reports a hang.
function asprEvaluate(entries, dialect, text) {
  const comps = [];
  for (let n = 0; n < entries.length; n++) {
    const c = asprCompile(entries[n].regex, dialect);
    if (c.err) return { err: c.err.key ? { ...c.err, vars: { ...c.err.vars, entry: n + 1 } } : c.err };
    comps.push(c);
  }
  if (!comps.length) return { err: { key: '' } };
  const rows = [];
  for (const line of String(text || '').split('\n')) {
    if (rows.length >= ASPR_MAX_PATHS) break;
    const p = asprParsePath(line);
    if (!p) continue;
    if (p.err) { rows.push({ line: line.trim(), invalid: p.err }); continue; }
    let hit = -1, m = null;
    for (let n = 0; n < comps.length && hit < 0; n++) {
      m = asprMatch(comps[n], p);
      if (m) hit = n;
    }
    rows.push({
      line: line.trim(), seg: p.seg,
      entry: hit, action: hit < 0 ? 'deny' : entries[hit].action, implicit: hit < 0,
      display: m ? m.display : (comps[0].kind === 'string' ? p.subject : p.tokens.join(' ')),
      span: m ? m.span : null, groups: m ? m.groups : [],
    });
  }
  return { rows };
}

// Cisco ↔ Junos, best effort. → { out: string|null, warn: [keys] }.
// out === null ⇒ not convertible; UI shows warn only. Never silent.
function asprConvert(src, from) {
  return from === 'cisco' ? asprCiscoToJunos(src) : asprJunosToCisco(src);
}

function asprCiscoToJunos(src) {
  const warn = [];
  let s = String(src).trim();
  if (!s) return { out: null, warn: [] };
  if (s === '^$') return { out: '()', warn };
  if (s === '.*') return { out: '.*', warn };
  let aS = false, aE = false;
  if (s.startsWith('^')) { aS = true; s = s.slice(1); } else if (s.startsWith('.*')) s = s.slice(2);
  if (s.endsWith('$') && !s.endsWith('\\$')) { aE = true; s = s.slice(0, -1); } else if (s.endsWith('.*')) s = s.slice(0, -2);
  const toks = [];
  const re = /\[0-9\]\+|\d+|[_()|*+?]|\.\*|./y;
  let m, i = 0;
  while (i < s.length) {
    re.lastIndex = i; m = re.exec(s); i = re.lastIndex;
    const k = m[0];
    if (k === '[0-9]+') toks.push({ t: 'term', j: '.' });
    else if (/^\d+$/.test(k)) toks.push({ t: 'term', j: k });
    else if (k === '_') toks.push({ t: '_' });
    else if ('()|'.includes(k)) toks.push({ t: k });
    else if ('*+?'.includes(k)) toks.push({ t: 'q', j: k });
    else return { out: null, warn: ['conv_w_unsupported'] };   // '.*' mid-pattern, classes, backrefs…
  }
  // Split a group's inner tokens at depth-0 '|'.
  const splitAlt = inner => {
    const branches = [[]];
    let d = 0;
    for (const t of inner) {
      if (t.t === '(') d++;
      else if (t.t === ')') d--;
      if (t.t === '|' && d === 0) branches.push([]);
      else branches[branches.length - 1].push(t);
    }
    return branches;
  };
  const matchClose = open => {
    let d = 1;
    for (let j = open + 1; j < toks.length; j++) {
      if (toks[j].t === '(') d++;
      else if (toks[j].t === ')') { d--; if (d === 0) return j; }
    }
    return -1;
  };
  // Top-level '|' binds loosest in both dialects; anchors/edge .* then land on single branches.
  if (splitAlt(toks).length > 1) return { out: null, warn: ['conv_w_unsupported'] };
  // Every term must be delimited by '_' (or an anchor) from the previous term.
  for (let n = 0; n < toks.length; n++) {
    const k = toks[n], p = toks[n - 1];
    const glued = p && (p.t === 'term' || p.t === ')' || (p.t === 'q' && n > 1));
    if (k.t === 'term' && glued) return { out: null, warn: ['conv_w_unsupported'] };
    // Glued '(': a later '|'-branch without a leading '_' would concatenate digits in IOS
    // (1(_1|2) matches "12") but become a whole AS in Junos ("1 2").
    if (k.t === '(' && glued) {
      const close = matchClose(n);
      if (close < 0) return { out: null, warn: ['conv_w_unsupported'] };
      // Every glued '(' (any quantifier, including '?') needs every depth-0 '|' branch
      // to start with '_'. Mixed-side and later-branch concat both diverge on IOS.
      if (!splitAlt(toks.slice(n + 1, close)).every(b => b[0] && b[0].t === '_')) {
        return { out: null, warn: ['conv_w_unsupported'] };
      }
    }
    if (k.t === '|' && (p.t === '(' || p.t === '|' || !toks[n + 1] || toks[n + 1].t === ')')) return { out: null, warn: ['conv_w_unsupported'] };
    if (k.t === '_' && p && p.t === '_') return { out: null, warn: ['conv_w_unsupported'] };
    if (k.t === 'q' && p && p.t === '_') return { out: null, warn: ['conv_w_unsupported'] };
    if (k.t === 'q' && p && p.t === 'term') return { out: null, warn: ['conv_w_unsupported'] };
    // IOS * / + after ) repeats the last digit; Junos repeats whole ASes. Keep only
    // groups whose branches are uniform-side (all start with '_' or all end with '_').
    if (k.t === 'q' && p && p.t === ')' && (k.j === '*' || k.j === '+')) {
      let depth = 1, open = -1;
      for (let j = n - 2; j >= 0; j--) {
        if (toks[j].t === ')') depth++;
        else if (toks[j].t === '(') {
          depth--;
          if (depth === 0) { open = j; break; }
        }
      }
      if (open < 0) return { out: null, warn: ['conv_w_unsupported'] };
      const inner = toks.slice(open + 1, n - 1);
      const br = splitAlt(inner), ok = br.every(b => b[0] && b[0].t === '_') || br.every(b => b[b.length - 1] && b[b.length - 1].t === '_');
      if (!ok) return { out: null, warn: ['conv_w_unsupported'] };
    }
  }
  // Undelimited, unanchored edge: Cisco matches digit substrings (65001 hits 165001), Junos can't.
  if ((!aS && !/^\(?_/.test(s)) || (!aE && !/_\)?[*+?]?$/.test(s))) warn.push('conv_w_substring');
  const body = toks.map(k => k.t === 'term' ? k.j : k.t === 'q' ? k.j : k.t === '_' ? ' ' : k.t)
    .join('').replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')').replace(/ \|/g, '|').replace(/\| /g, '|').replace(/([\d.)*+?])\(/g, '$1 (').trim();
  const out = ((aS ? '' : '.* ') + body + (aE ? '' : ' .*')).replace(/\s+/g, ' ').trim();
  return { out, warn };
}

function asprJunosToCisco(src) {
  const s = String(src).trim();
  if (!s) return { out: null, warn: [] };
  if (s.replace(/\s/g, '') === '()') return { out: '^$', warn: [] };
  const lex = asprLexToken(s, 'junos');
  if (lex.err) return { out: null, warn: ['conv_w_unsupported'] };
  let body = '';
  let depth = 0, topAlt = false;
  for (const k of lex.toks) {
    if (k.t === '(') depth++;
    else if (k.t === ')') depth--;
    else if (k.t === '|' && depth === 0) topAlt = true;
    if (k.t === 'num') body += '(' + k.v + '_)';
    else if (k.t === 'any') body += '([0-9]+_)';
    else if (k.t === 'set') return { out: null, warn: ['conv_w_range'] };
    else if (k.t === 'q') { if (k.s[0] === '{') return { out: null, warn: ['conv_w_bounded'] }; body += k.s; }
    else body += k.t;
  }
  let out = topAlt ? '^(' + body + ')$' : '^' + body + '$';
  if (out === '^([0-9]+_)*$') return { out: '.*', warn: [] };
  // Prettify: exact rewrites only. (n_) = n followed by '_' (delimiter or end).
  out = out.replace(/^\^\(\[0-9\]\+_\)\*/, '_').replace(/\(\[0-9\]\+_\)\*\$$/, '');
  out = out.replace(/\((\d+|\[0-9\]\+)_\)(?![*+?{])/g, '$1_');
  out = out.replace(/\(((?:\d+_\|)+\d+_)\)(?![*+?{])/g, (m, g) => '(' + g.replace(/_/g, '') + ')_');
  out = out.replace(/_\$$/, '$');
  return { out, warn: [] };
}

// Honesty check: run source and converted regex over the same test paths;
// return the lines whose verdict differs (UI lists them as conv_w_diff).
function asprConvertDiff(src, from, out, text) {
  const to = from === 'cisco' ? 'junos' : 'cisco';
  const a = asprCompile(src, from), b = asprCompile(out, to);
  if (a.err || b.err) return [];
  const diff = [];
  for (const line of String(text || '').split('\n').slice(0, ASPR_MAX_PATHS)) {
    const p = asprParsePath(line);
    if (!p || p.err) continue;
    if (!asprMatch(a, p) !== !asprMatch(b, p)) diff.push(line.trim());
  }
  return diff;
}

// CLI for the current dialect. name = list name; Cisco uses the number.
function asprCli(entries, dialect, name, num) {
  const q = r => '"' + r.replace(/"/g, '\\"') + '"';
  if (dialect === 'cisco') return entries.map(e => `ip as-path access-list ${num} ${e.action} ${e.regex}`)
    .concat(['!', `route-map ${name} permit 10`, ` match as-path ${num}`]).join('\n');
  if (dialect === 'junos') {
    const l = [];
    entries.forEach((e, n) => l.push(`set policy-options as-path ${name}-${n + 1} ${q(e.regex)}`));
    entries.forEach((e, n) => {
      l.push(`set policy-options policy-statement ${name} term e${n + 1} from as-path ${name}-${n + 1}`);
      l.push(`set policy-options policy-statement ${name} term e${n + 1} then ${e.action === 'permit' ? 'accept' : 'reject'}`);
    });
    l.push(`set policy-options policy-statement ${name} term implicit-deny then reject`);
    return l.join('\n');
  }
  return [`ip as-path regex-mode ${dialect === 'eos_asn' ? 'asn' : 'string'}`]
    .concat(entries.map(e => `ip as-path access-list ${name} ${e.action} ${e.regex} any`))
    .concat(['!', `route-map ${name} permit 10`, `   match as-path ${name}`]).join('\n');
}
// </aspr-engine>

// <aspr-presets>
// Per preset: entries per dialect (null = can't be expressed in that dialect → preset_na),
// test paths (one per line, '""' = empty path), and the harness verdicts (P/D per line).
const ASPR_E = (...pairs) => pairs.map(([action, regex]) => ({ action, regex }));
const ASPR_PRESETS = {
  boundary: {
    entries: {
      cisco: ASPR_E(['permit', '_65001_']), junos: ASPR_E(['permit', '.* 65001 .*']),
      eos_asn: ASPR_E(['permit', '65001']), eos_string: ASPR_E(['permit', '_65001_']),
    },
    paths: '100 65001 200\n100 165001 200\n650011\n65001\n{64600,65001}\n""',
    expect: { cisco: 'PDDPPD', junos: 'PDDPPD', eos_asn: 'PDDPPD', eos_string: 'PDDPPD' },
  },
  only_local: {
    entries: {
      cisco: ASPR_E(['permit', '^$']), junos: ASPR_E(['permit', '()']),
      eos_asn: ASPR_E(['permit', '^$']), eos_string: ASPR_E(['permit', '^$']),
    },
    paths: '""\n64500\n65001 64500',
    expect: { cisco: 'PDD', junos: 'PDD', eos_asn: 'PDD', eos_string: 'PDD' },
  },
  neighbor_origin: {
    entries: {
      cisco: ASPR_E(['permit', '^64500(_64500)*$']), junos: ASPR_E(['permit', '64500+']),
      eos_asn: ASPR_E(['permit', '^64500+$']), eos_string: ASPR_E(['permit', '^64500(_64500)*$']),
    },
    paths: '64500\n64500 64500 64500\n64500 64501\n645001\n64500 645001',
    expect: { cisco: 'PPDDD', junos: 'PPDDD', eos_asn: 'PPDDD', eos_string: 'PPDDD' },
  },
  neighbor_cone: {
    entries: {
      cisco: ASPR_E(['permit', '^64500_']), junos: ASPR_E(['permit', '64500 .*']),
      eos_asn: ASPR_E(['permit', '^64500']), eos_string: ASPR_E(['permit', '^64500_']),
    },
    paths: '64500\n64500 64501 64502\n645001 1\n174 64500',
    expect: { cisco: 'PPDD', junos: 'PPDD', eos_asn: 'PPDD', eos_string: 'PPDD' },
  },
  origin_as: {
    entries: {
      cisco: ASPR_E(['permit', '_64500$']), junos: ASPR_E(['permit', '.* 64500']),
      eos_asn: ASPR_E(['permit', '64500$']), eos_string: ASPR_E(['permit', '_64500$']),
    },
    paths: '174 3356 64500\n64500\n64500 174\n174 164500',
    expect: { cisco: 'PPDD', junos: 'PPDD', eos_asn: 'PPDD', eos_string: 'PPDD' },
  },
  transit_block: {
    entries: {
      cisco: ASPR_E(['deny', '_(174|3356|1299)_'], ['permit', '.*']),
      junos: ASPR_E(['deny', '.* (174|3356|1299) .*'], ['permit', '.*']),
      eos_asn: ASPR_E(['deny', '_174_'], ['deny', '_3356_'], ['deny', '_1299_'], ['permit', '.*']),
      eos_string: ASPR_E(['deny', '_(174|3356|1299)_'], ['permit', '.*']),
    },
    paths: '64500 174 3356\n64500 65001\n64500 13335\n1299\n""\n64500 11740',
    expect: { cisco: 'DPPDPP', junos: 'DPPDPP', eos_asn: 'DPPDPP', eos_string: 'DPPDPP' },
  },
  prepend_detect: {
    entries: {
      cisco: ASPR_E(['permit', '_([0-9]+)(_\\1)+_']), junos: null,
      eos_asn: null, eos_string: ASPR_E(['permit', '_([0-9]+)(_\\1)+_']),
    },
    paths: '100 100 200\n100 200 200\n100 1000\n1100 100\n100 200',
    expect: { cisco: 'PPDDD', eos_string: 'PPDDD' },
  },
  private_as: {
    entries: {
      cisco: ASPR_E(['deny', '_(6451[2-9]|645[2-9][0-9]|64[6-9][0-9][0-9]|65[0-4][0-9][0-9]|655[0-2][0-9]|6553[0-4])_'], ['permit', '.*']),
      junos: ASPR_E(['deny', '.* [64512-65534 4200000000-4294967294] .*'], ['permit', '.*']),
      eos_asn: null,
      eos_string: ASPR_E(['deny', '_(6451[2-9]|645[2-9][0-9]|64[6-9][0-9][0-9]|65[0-4][0-9][0-9]|655[0-2][0-9]|6553[0-4])_'], ['permit', '.*']),
    },
    paths: '64500 64512\n64500 65535\n65534\n64500 4200000001\n3356 64511',
    // Cisco string form covers 16-bit private only (RFC 6996 32-bit range noted in preset hint).
    expect: { cisco: 'DPDPP', junos: 'DPDDP', eos_string: 'DPDPP' },
  },
};
const ASPR_PRESET_IDS = Object.keys(ASPR_PRESETS);
// </aspr-presets>

const ASPR_TABS = ['tester', 'reference'];
const ASPR_DEF = { dialect: 'cisco', preset: 'boundary', cliName: 'AS-FILTER', cliNum: '10' };
// Reference cheat sheet: operator → which dialect columns. Cell text = t('bgp_aspath_regex.ref_' + id + '_' + col).
const ASPR_REF_OPS = [
  ['^', 'caret'], ['$', 'dollar'], ['_', 'us'], ['.', 'dot'], ['*', 'star'], ['+', 'plus'], ['?', 'qmark'],
  ['[ ]', 'class'], ['a-b', 'range'], ['|', 'alt'], ['( )', 'group'], ['{m,n}', 'brace'], ['\\1', 'backref'], ['␠', 'space'],
];
const ASPR_REF_COLS = ['cisco', 'junos', 'eos_asn'];   // eos_string column omitted: ref_eos_string_note says "as IOS"
const ASPR_TRAPS = ['bare_asn', 'junos_anchor', 'mid_any', 'naive_prepend', 'implicit_deny', 'eos_mode', 'brace_literal'];
const ASPR_RELATED = [
  { id: 'bgp-best-path', key: 'related_best_path' },
  { id: 'bgp-community', key: 'related_community' },
  { id: 'prefix-list-builder', key: 'related_prefix_list' },
  { id: 'bgp-lg', key: 'related_bgp_lg' },
];

function asprSanitizeName(v) {
  return String(v || '').replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32);
}

function asprHydrateEntries(raw) {
  const src = (Array.isArray(raw) ? raw : [])
    .filter(e => e && typeof e.regex === 'string' && !/[\r\n]/.test(e.regex))
    .slice(0, ASPR_MAX_ENTRIES)
    .map(e => ({ action: e.action === 'deny' ? 'deny' : 'permit', regex: e.regex.slice(0, 256) }));
  if (src.length) return src;
  return ASPR_PRESETS.boundary.entries.cisco.map(e => ({ ...e }));
}

// ponytail: fourth copy of this helper; hoist to shared.jsx in a cleanup pass.
function asprDownload(content, filename) {
  const blob = new Blob([content + '\n'], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const ASPR_MARK = { background: 'var(--border)', color: 'var(--text)', outline: '1px solid var(--cyan)', borderRadius: 2 };

function BGPASPathRegexTester({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = usePersistentState(
    'aspr:activeTab',
    ASPR_TABS.includes(initialData?.activeTab) ? initialData.activeTab : 'tester'
  );
  const [dialect, setDialect] = usePersistentState(
    'aspr:dialect',
    ASPR_DIALECTS.includes(initialData?.dialect) ? initialData.dialect : ASPR_DEF.dialect
  );
  const [entries, setEntries] = usePersistentState('aspr:entries', () => asprHydrateEntries(initialData?.entries));
  const [paths, setPaths] = usePersistentState(
    'aspr:paths',
    typeof initialData?.paths === 'string' ? initialData.paths : ASPR_PRESETS.boundary.paths
  );
  const [cliName, setCliName] = usePersistentState(
    'aspr:cliName',
    (asprSanitizeName((initialData?.cliName ?? ASPR_DEF.cliName)) || ASPR_DEF.cliName)
  );
  const [cliNum, setCliNum] = usePersistentState('aspr:cliNum', initialData?.cliNum ?? ASPR_DEF.cliNum);

  const skipNavReport = useRef(false);
  useEffect(() => {
    if (ASPR_TABS.includes(initialData?.activeTab) && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
  }, [initialData]);
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'bgp-aspath-regex', activeTab, dialect, entries, paths, cliName, cliNum,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [onShare, activeTab, dialect, entries, paths, cliName, cliNum]);

  // ponytail: no debounce; add one if ReDoS reports come in.
  const result = useMemo(() => asprEvaluate(entries, dialect, paths), [entries, dialect, paths]);
  const errMsg = result.err && result.err.key
    ? t('bgp_aspath_regex.err_in_entry', {
      entry: result.err.vars.entry,
      msg: t('bgp_aspath_regex.' + result.err.key, result.err.vars),
    })
    : '';
  const rows = result.rows || null;
  const cliNumOk = /^\d+$/.test(cliNum) && +cliNum >= 1 && +cliNum <= 500;
  const conv = useMemo(() => {
    if (dialect !== 'cisco' && dialect !== 'junos') return null;
    return entries.map(e => {
      const c = asprConvert(e.regex, dialect);
      return { ...c, diff: c.out === null ? [] : asprConvertDiff(e.regex, dialect, c.out, paths) };
    });
  }, [entries, dialect, paths]);
  const cliText = useMemo(
    () => (rows ? asprCli(entries, dialect, cliName.trim() || 'AS-FILTER', cliNumOk ? +cliNum : 10) : ''),
    [rows, entries, dialect, cliName, cliNum, cliNumOk]
  );

  const counts = useMemo(() => {
    if (!rows) return { permit: 0, deny: 0, implicit: 0, invalid: 0 };
    let permit = 0, deny = 0, implicit = 0, invalid = 0;
    for (const r of rows) {
      if (r.invalid) invalid++;
      else if (r.implicit) implicit++;
      else if (r.action === 'permit') permit++;
      else deny++;
    }
    return { permit, deny, implicit, invalid };
  }, [rows]);

  const hints = useMemo(() => {
    if (!rows) return [];
    const list = [];
    if (dialect === 'cisco' || dialect === 'eos_string') {
      for (const e of entries) {
        const re = e.regex;
        if (/^\^?\d+\$?$/.test(re) && !/^\^\d+\$$/.test(re)) {
          list.push({ level: 'yellow', key: 'hint_bare_asn', vars: { re } });
          break;
        }
      }
      if (entries.some(e => /\{\d/.test(e.regex))) list.push({ level: 'yellow', key: 'hint_brace' });
    }
    if ((dialect === 'junos' || dialect === 'eos_asn') && rows.some(r => r.seg)) {
      list.push({ level: 'yellow', key: 'hint_segments' });
    }
    if (counts.implicit > 0) list.push({ level: 'yellow', key: 'hint_implicit', vars: { n: counts.implicit } });
    if (dialect === 'eos_asn' || dialect === 'eos_string') list.push({ level: 'yellow', key: 'hint_eos_mode' });
    if (counts.invalid > 0) list.push({ level: 'yellow', key: 'hint_invalid_rows', vars: { n: counts.invalid } });
    const nNonBlank = String(paths || '').split('\n').filter(l => l.trim()).length;
    if (nNonBlank > ASPR_MAX_PATHS) list.push({ level: 'yellow', key: 'hint_truncated', vars: { max: ASPR_MAX_PATHS } });
    if (list.length === 0) list.push({ level: 'green', key: 'hint_ok' });
    return list;
  }, [rows, entries, dialect, paths, counts]);

  const copyText = useMemo(() => {
    if (!rows) return '';
    const header = [
      t('bgp_aspath_regex.col_path'),
      t('bgp_aspath_regex.col_verdict'),
      t('bgp_aspath_regex.col_entry'),
      t('bgp_aspath_regex.col_match'),
      t('bgp_aspath_regex.col_groups'),
    ].join('\t');
    const lines = rows.map(r => {
      const verdict = t('bgp_aspath_regex.v_' + (r.invalid ? 'invalid' : r.implicit ? 'implicit' : r.action));
      const entry = (r.invalid || r.implicit || r.entry < 0) ? '\u2014' : '#' + (r.entry + 1);
      const match = r.span ? (r.display.slice(...r.span) || '-') : '-';
      const groups = (r.groups || []).map(g => (g === null ? '\u2014' : g)).join(' | ');
      return [r.line, verdict, entry, match, groups].join('\t');
    });
    return [header, ...lines].join('\n');
  }, [rows, t]);

  const applyPreset = (id) => {
    const p = ASPR_PRESETS[id];
    if (!p || !p.entries[dialect]) return;
    setEntries(p.entries[dialect].map(e => ({ ...e })));
    setPaths(p.paths);
  };

  const addEntry = () => {
    setEntries(es => (es.length >= ASPR_MAX_ENTRIES ? es : es.concat([{ action: 'permit', regex: '' }])));
  };
  const removeEntry = (n) => {
    setEntries(es => (es.length <= 1 ? es : es.filter((_, i) => i !== n)));
  };
  const moveEntry = (n, dir) => {
    setEntries(es => {
      const j = n + dir;
      if (j < 0 || j >= es.length) return es;
      const next = es.slice();
      const tmp = next[n];
      next[n] = next[j];
      next[j] = tmp;
      return next;
    });
  };
  const updEntry = (n, f, v) => setEntries(es => es.map((e, i) => (i === n ? { ...e, [f]: v } : e)));

  const convTo = dialect === 'cisco' ? 'junos' : 'cisco';
  const convReady = !!(conv && conv.every(c => c.out !== null));
  const applyConv = () => {
    if (!convReady) return;
    setEntries(entries.map((e, i) => ({ action: e.action, regex: conv[i].out })));
    setDialect(convTo);
  };

  const exportJson = () => {
    asprDownload(
      JSON.stringify({
        tool: 'bgp-aspath-regex',
        dialect,
        entries,
        paths: paths.split('\n').filter(l => l.trim()),
        verdicts: rows && rows.map(r => ({
          path: r.line,
          verdict: r.invalid ? 'invalid' : r.implicit ? 'implicit-deny' : r.action,
          entry: r.entry + 1,
        })),
      }, null, 2),
      'bgp-aspath-' + dialect + '.json'
    );
  };

  const tryPreset = (id) => {
    applyPreset(id);
    setActiveTab('tester');
    window.scrollTo(0, 0);
  };

  const tryNaivePrepend = () => {
    setDialect('cisco');
    setEntries([{ action: 'permit', regex: '([0-9]+)(_\\1)+' }]);
    setPaths(ASPR_PRESETS.prepend_detect.paths);
    setActiveTab('tester');
    window.scrollTo(0, 0);
  };

  const renderMatch = (row) => {
    if (row.invalid) {
      return (
        <span style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 12 }}>
          {t('bgp_aspath_regex.' + row.invalid)}
        </span>
      );
    }
    if (row.display === '') {
      return <span style={{ color: 'var(--muted)' }}>{t('bgp_aspath_regex.empty_path')}</span>;
    }
    const d = row.display || '';
    if (!row.span) {
      return <span style={{ fontFamily: 'var(--mono)' }}>{d}</span>;
    }
    return (
      <span style={{ fontFamily: 'var(--mono)' }}>
        {d.slice(0, row.span[0])}
        <mark style={ASPR_MARK}>{d.slice(row.span[0], row.span[1])}</mark>
        {d.slice(row.span[1])}
      </span>
    );
  };

  const verdictBadge = (row) => {
    if (row.invalid) {
      return (
        <span className="badge badge-yellow" title={t('bgp_aspath_regex.' + row.invalid)}>
          {t('bgp_aspath_regex.v_invalid')}
        </span>
      );
    }
    if (row.implicit) {
      return (
        <span className="badge badge-red" style={{ opacity: 0.7 }}>
          {t('bgp_aspath_regex.v_implicit')}
        </span>
      );
    }
    if (row.action === 'permit') {
      return <span className="badge badge-green">{t('bgp_aspath_regex.v_permit')}</span>;
    }
    return <span className="badge badge-red">{t('bgp_aspath_regex.v_deny')}</span>;
  };

  const relatedBlock = (
    <div className="card">
      <div className="card-title">{t('bgp_aspath_regex.related_title')}</div>
      <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
        {ASPR_RELATED.map(({ id, key }, idx) => (
          <li key={id} style={{ marginBottom: idx < ASPR_RELATED.length - 1 ? 6 : 0 }}>
            <button
              className="btn btn-sm btn-ghost"
              style={{ padding: '0 6px', height: 'auto', fontSize: 12, marginRight: 6, display: 'inline-flex', verticalAlign: 'baseline' }}
              onClick={() => {
                window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: id } }));
              }}
            >
              {t('bgp_aspath_regex.' + key)}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  const th = { padding: '8px 10px', color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' };
  const td = { padding: '8px 10px', verticalAlign: 'top', borderBottom: '1px solid var(--border)' };

  return (
    <div className="fadein">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">{t('bgp_aspath_regex.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {t('bgp_aspath_regex.subtitle')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {ASPR_TABS.map(tabId => (
            <button
              key={tabId}
              className={`btn btn-sm ${activeTab === tabId ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12 }}
              onClick={() => setActiveTab(tabId)}
            >
              {t('bgp_aspath_regex.tab_' + tabId)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'tester' && (
        <div>
          <div className="card">
            <div className="card-title">{t('bgp_aspath_regex.dialect_label')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
              {ASPR_DIALECTS.map(id => (
                <button
                  key={id}
                  className={`btn btn-sm ${dialect === id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setDialect(id)}
                >
                  {t('bgp_aspath_regex.dialect_' + id)}
                </button>
              ))}
            </div>
            <div className="hint">{t('bgp_aspath_regex.dialect_note_' + dialect)}</div>
            <div className="hint" style={{ marginTop: 4 }}>{t('bgp_aspath_regex.dialect_changed_hint')}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('bgp_aspath_regex.presets_title')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {ASPR_PRESET_IDS.map(id => {
                const na = !ASPR_PRESETS[id].entries[dialect];
                return (
                  <button
                    key={id}
                    className="btn btn-sm"
                    disabled={na}
                    title={na ? t('bgp_aspath_regex.preset_na') : t('bgp_aspath_regex.preset_' + id + '_desc')}
                    onClick={() => applyPreset(id)}
                  >
                    {t('bgp_aspath_regex.preset_' + id)}
                  </button>
                );
              })}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>{t('bgp_aspath_regex.presets_hint')}</div>
          </div>

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              <div className="card-title" style={{ marginBottom: 0 }}>
                {t('bgp_aspath_regex.filter_title')}{' '}
                <span className="hint">{entries.length}/{ASPR_MAX_ENTRIES}</span>
              </div>
              <div className="btn-row">
                <button className="btn btn-sm" disabled={entries.length >= ASPR_MAX_ENTRIES} onClick={addEntry}>
                  {t('bgp_aspath_regex.btn_add')}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={exportJson}>
                  {t('common.export_json')}
                </button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {entries.map((e, n) => (
                <div key={n} style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ fontFamily: 'var(--mono)', color: 'var(--muted)', minWidth: 24 }}>#{n + 1}</span>
                  <select
                    className="select"
                    value={e.action}
                    onChange={ev => updEntry(n, 'action', ev.target.value)}
                    style={{ width: 'auto' }}
                  >
                    <option value="permit">{t('bgp_aspath_regex.action_permit')}</option>
                    <option value="deny">{t('bgp_aspath_regex.action_deny')}</option>
                  </select>
                  <input
                    className="input"
                    value={e.regex}
                    onChange={ev => updEntry(n, 'regex', ev.target.value)}
                    placeholder={t('bgp_aspath_regex.regex_placeholder_' + dialect)}
                    spellCheck={false}
                    autoComplete="off"
                    maxLength={256}
                    style={{ flex: 1, minWidth: 160, fontFamily: 'var(--mono)' }}
                  />
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={n === 0}
                    aria-label={t('bgp_aspath_regex.btn_up')}
                    onClick={() => moveEntry(n, -1)}
                  >{'\u2191'}</button>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={n === entries.length - 1}
                    aria-label={t('bgp_aspath_regex.btn_down')}
                    onClick={() => moveEntry(n, 1)}
                  >{'\u2193'}</button>
                  <button
                    className="btn btn-sm btn-ghost"
                    disabled={entries.length <= 1}
                    aria-label={t('bgp_aspath_regex.btn_remove')}
                    onClick={() => removeEntry(n)}
                  >{'\u00d7'}</button>
                </div>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 8 }}>{t('bgp_aspath_regex.filter_hint')}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('bgp_aspath_regex.paths_title')}</div>
            <textarea
              className="input"
              rows={8}
              spellCheck={false}
              value={paths}
              onChange={e => setPaths(e.target.value)}
              placeholder={t('bgp_aspath_regex.paths_placeholder')}
              style={{ fontFamily: 'var(--mono)', width: '100%', resize: 'vertical' }}
            />
            <div className="hint" style={{ marginTop: 8 }}>{t('bgp_aspath_regex.paths_hint')}</div>
          </div>

          <Err msg={errMsg} />

          {rows && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
                <div className="card-title" style={{ marginBottom: 0 }}>
                  {t('bgp_aspath_regex.results_title')}
                  <span className="hint" style={{ marginLeft: 8 }}>
                    {t('bgp_aspath_regex.results_counts', counts)}
                  </span>
                </div>
                <CopyBtn text={copyText} id="aspr-results" />
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                      <th style={th}>{t('bgp_aspath_regex.col_path')}</th>
                      <th style={th}>{t('bgp_aspath_regex.col_verdict')}</th>
                      <th style={th}>{t('bgp_aspath_regex.col_entry')}</th>
                      <th style={th}>{t('bgp_aspath_regex.col_match')}</th>
                      <th style={th}>{t('bgp_aspath_regex.col_groups')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr key={i}>
                        <td style={{ ...td, fontFamily: 'var(--mono)' }}>{r.line}</td>
                        <td style={td}>{verdictBadge(r)}</td>
                        <td style={{ ...td, fontFamily: 'var(--mono)' }}>
                          {(r.invalid || r.implicit || r.entry < 0) ? '\u2014' : '#' + (r.entry + 1)}
                        </td>
                        <td style={td}>{renderMatch(r)}</td>
                        <td style={td}>
                          {(r.groups && r.groups.length) ? r.groups.map((g, gi) => (
                            <span
                              key={gi}
                              style={{
                                fontFamily: 'var(--mono)',
                                fontSize: 11,
                                padding: '1px 6px',
                                border: '1px solid var(--border)',
                                borderRadius: 2,
                                marginRight: 4,
                                display: 'inline-block',
                              }}
                            >
                              {g === null ? '\u2014' : g}
                            </span>
                          )) : '\u2014'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {conv ? (
            <div className="card">
              <div className="card-title">
                {t('bgp_aspath_regex.conv_title', { to: t('bgp_aspath_regex.conv_to_' + convTo) })}
              </div>
              {conv.map((c, i) => (
                <div key={i} style={{ marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{entries[i].regex}</span>
                    <span style={{ color: 'var(--muted)' }}>{'\u2192'}</span>
                    {c.out === null ? (
                      <span style={{ color: 'var(--muted)' }}>{t('bgp_aspath_regex.conv_none')}</span>
                    ) : (
                      <>
                        <span style={{ fontFamily: 'var(--mono)', fontSize: 13 }}>{c.out}</span>
                        <CopyBtn text={c.out} id={'aspr-conv-' + i} />
                      </>
                    )}
                  </div>
                  {c.warn.map(k => (
                    <div key={k} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6 }}>
                      <span className="badge badge-yellow">{'\u00a0'}</span>
                      <span style={{ fontSize: 13 }}>{t('bgp_aspath_regex.' + k)}</span>
                    </div>
                  ))}
                  {c.diff.length > 0 && (
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 6 }}>
                      <span className="badge badge-red">{'\u00a0'}</span>
                      <span style={{ fontSize: 13 }}>
                        {t('bgp_aspath_regex.conv_w_diff', { n: c.diff.length, list: c.diff.slice(0, 5).join(', ') })}
                      </span>
                    </div>
                  )}
                </div>
              ))}
              <button className="btn btn-sm" disabled={!convReady} onClick={applyConv}>
                {t('bgp_aspath_regex.conv_apply')}
              </button>
              <div className="hint" style={{ marginTop: 8 }}>{t('bgp_aspath_regex.conv_note')}</div>
            </div>
          ) : (
            <div className="card">
              <div className="card-title">{t('bgp_aspath_regex.conv_title_eos')}</div>
              <div className="hint">{t('bgp_aspath_regex.conv_na_eos')}</div>
            </div>
          )}

          <div className="card">
            <div className="card-title">{t('bgp_aspath_regex.cli_title')}</div>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
              <div className="field" style={{ flex: 1, minWidth: 160 }}>
                <label className="label">{t('bgp_aspath_regex.cli_name')}</label>
                <input
                  className="input"
                  value={cliName}
                  onChange={e => setCliName(e.target.value.replace(/[^A-Za-z0-9_.-]/g, '').slice(0, 32))}
                  style={{ fontFamily: 'var(--mono)' }}
                />
              </div>
              {dialect === 'cisco' && (
                <div className="field" style={{ width: 140 }}>
                  <label className="label">{t('bgp_aspath_regex.cli_num')}</label>
                  <input
                    className="input"
                    value={cliNum}
                    onChange={e => setCliNum(e.target.value)}
                    style={{ fontFamily: 'var(--mono)' }}
                  />
                </div>
              )}
            </div>
            {!rows ? (
              <div className="hint">{t('bgp_aspath_regex.cli_fix_errors')}</div>
            ) : (dialect === 'cisco' && !cliNumOk) ? (
              <Err msg={t('bgp_aspath_regex.err_cli_num')} />
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                  <CopyBtn text={cliText} id="aspr-cli" />
                </div>
                <pre style={{ margin: '8px 0 0', fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius)', whiteSpace: 'pre-wrap', border: '1px solid var(--border)' }}>
                  {cliText.split('\n').map((line, i) => (
                    <span key={i} style={/^\s*[!#]/.test(line) ? { color: 'var(--dim)' } : undefined}>
                      {line}{'\n'}
                    </span>
                  ))}
                </pre>
              </div>
            )}
            <div className="hint" style={{ marginTop: 8 }}>{t('bgp_aspath_regex.cli_note_' + dialect)}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('bgp_aspath_regex.review_title')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {hints.map((h, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                  <span className={`badge badge-${h.level}`}>{'\u00a0'}</span>
                  <span style={{ fontSize: 13, color: 'var(--text)' }}>
                    {t('bgp_aspath_regex.' + h.key, h.vars)}
                  </span>
                </div>
              ))}
            </div>
            <div className="hint" style={{ marginTop: 10 }}>{t('bgp_aspath_regex.note_client')}</div>
          </div>
          {relatedBlock}
        </div>
      )}

      {activeTab === 'reference' && (
        <div>
          <div className="card">
            <div className="card-title">{t('bgp_aspath_regex.ref_ops_title')}</div>
            <div className="hint" style={{ marginBottom: 10 }}>{t('bgp_aspath_regex.ref_ops_note')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={th}>{t('bgp_aspath_regex.ref_col_op')}</th>
                    {ASPR_REF_COLS.map(col => (
                      <th key={col} style={th}>{t('bgp_aspath_regex.ref_col_' + col)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ASPR_REF_OPS.map(([glyph, id]) => (
                    <tr key={id} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ ...td, fontFamily: 'var(--mono)' }}>{glyph}</td>
                      {ASPR_REF_COLS.map(col => (
                        <td key={col} style={td}>{t('bgp_aspath_regex.ref_' + id + '_' + col)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 10 }}>{t('bgp_aspath_regex.ref_eos_string_note')}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('bgp_aspath_regex.ref_recipes_title')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={th}>{t('bgp_aspath_regex.presets_title')}</th>
                    {ASPR_DIALECTS.map(d => (
                      <th key={d} style={th}>{t('bgp_aspath_regex.dialect_' + d)}</th>
                    ))}
                    <th style={th} />
                  </tr>
                </thead>
                <tbody>
                  {ASPR_PRESET_IDS.map(id => {
                    const p = ASPR_PRESETS[id];
                    const na = !p.entries[dialect];
                    return (
                      <tr key={id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={td}>
                          <div>{t('bgp_aspath_regex.preset_' + id)}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{t('bgp_aspath_regex.preset_' + id + '_desc')}</div>
                        </td>
                        {ASPR_DIALECTS.map(d => (
                          <td key={d} style={{ ...td, fontFamily: 'var(--mono)', fontSize: 12 }}>
                            {p.entries[d]
                              ? p.entries[d].map(e => e.action + ' ' + e.regex).join(' / ')
                              : '\u2014'}
                          </td>
                        ))}
                        <td style={td}>
                          <button
                            className="btn btn-sm"
                            disabled={na}
                            title={na ? t('bgp_aspath_regex.preset_na') : undefined}
                            onClick={() => tryPreset(id)}
                          >
                            {t('bgp_aspath_regex.ref_try')}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('bgp_aspath_regex.ref_traps_title')}</div>
            {ASPR_TRAPS.map(id => (
              <div key={id} className="card" style={{ marginBottom: 10, background: 'var(--bg)' }}>
                <div className="card-title">{t('bgp_aspath_regex.trap_' + id + '_title')}</div>
                <div style={{ fontSize: 13, color: 'var(--text)', marginBottom: id === 'naive_prepend' ? 8 : 0 }}>
                  {t('bgp_aspath_regex.trap_' + id + '_body')}
                </div>
                {id === 'naive_prepend' && (
                  <button className="btn btn-sm" onClick={tryNaivePrepend}>
                    {t('bgp_aspath_regex.ref_try')}
                  </button>
                )}
              </div>
            ))}
          </div>

          {relatedBlock}
        </div>
      )}
    </div>
  );
}

window.BGPASPathRegexTester = BGPASPathRegexTester;
