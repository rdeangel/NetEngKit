const { useState, useEffect, useCallback, useMemo } = React;

const CIDR_RE    = /(\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2})/;
// Bare IP: not followed by / to avoid partial-matching CIDR addresses
const BARE_IP_RE = /(\d{1,3}(?:\.\d{1,3}){3})(?!\/\d)/;

const mkId = () => crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
const DEFAULT_PAIR = () => ({ id: mkId(), source: '', target: '' });
const DEFAULT_RULE = () => ({ id: mkId(), pattern: '', replacement: '' });

const EXAMPLE_PAIRS = [
  { id: 'ex1', source: '10.0.0.0/20',    target: '10.0.16.0/20' },
  { id: 'ex2', source: '192.168.0.0/24', target: '192.168.100.0/24' },
];
const EXAMPLE_ALLOCS =
`# SITE-A — Primary Block (10.0.0.0/20)
Management  VLAN10  10.0.0.0/24
  gateway           10.0.0.1
  ntp               10.0.0.5
Wired       VLAN20  10.0.1.0/24
WiFi        VLAN30  10.0.2.0/24
Voice       VLAN40  10.0.3.0/24
P2P         VLAN99  10.0.15.0/28

# SITE-A — Secondary Block (192.168.0.0/24)
Servers     VLAN50  192.168.0.0/26
  web-01            192.168.0.10
  db-01             192.168.0.20
Users       VLAN60  192.168.0.64/26`;
const EXAMPLE_RULES = [
  { id: 'er1', pattern: 'SITE-A', replacement: 'SITE-B' },
];

function applyRegex(text, rules) {
  let out = text;
  for (const rule of rules) {
    if (!rule.pattern.trim()) continue;
    try { out = out.replace(new RegExp(rule.pattern, 'g'), rule.replacement); } catch (_) {}
  }
  return out;
}

function rebaseLine(line, parsedPairs) {
  let rebased = false;
  let hasUnmatched = false;

  // Pass 1: replace every CIDR on the line
  let out = line.replace(new RegExp(CIDR_RE.source, 'g'), (cidrStr) => {
    const cidr = IPv4.parseCIDR(cidrStr);
    if (!cidr) return cidrStr;
    const sn = IPv4.subnet(cidr.ip, cidr.prefix);
    for (const { baseSn, targetSn } of parsedPairs) {
      if (sn.network >= baseSn.network && sn.broadcast <= baseSn.broadcast) {
        rebased = true;
        const newNet = (targetSn.network + (sn.network - baseSn.network)) >>> 0;
        return `${IPv4.str(newNet)}/${cidr.prefix}`;
      }
    }
    hasUnmatched = true;
    return cidrStr;
  });

  // Pass 2: replace every bare IP not already part of a CIDR (negative lookahead handles it)
  out = out.replace(new RegExp(BARE_IP_RE.source, 'g'), (match, ipStr) => {
    const ip = IPv4.parse(ipStr);
    if (ip === null) return match;
    for (const { baseSn, targetSn } of parsedPairs) {
      if (ip >= baseSn.network && ip <= baseSn.broadcast) {
        rebased = true;
        const newIp = (targetSn.network + (ip - baseSn.network)) >>> 0;
        return IPv4.str(newIp);
      }
    }
    return match;
  });

  return { out, rebased, hasUnmatched };
}

function rebaseLines(allocs, parsedPairs, regexRules, t) {
  return allocs.split('\n').map(line => {
    if (!line.trim()) return { out: line, status: 'empty' };
    const { out, rebased, hasUnmatched } = rebaseLine(line, parsedPairs);
    const finalOut = applyRegex(out, regexRules);
    if (rebased)      return { out: finalOut, status: 'ok' };
    if (hasUnmatched) return { out: finalOut, status: 'out-of-range', annotation: t('subnet_rebase.out_of_range') };
    return { out: finalOut, status: 'passthrough' };
  });
}

function SubnetRebase({ initialData, onShare }) {
  const { t } = useTranslation();
  const [copied, copy] = useCopy();
  const [showRegex, setShowRegex] = useState(false);

  const [pairs, setPairs] = usePersistentState('subnet_rebase:pairs', () => {
    if (initialData?.pairs?.length) return initialData.pairs;
    return [DEFAULT_PAIR()];
  });

  const [allocs, setAllocs] = usePersistentState('subnet_rebase:allocs',
    initialData?.allocs ?? '');

  const [regexRules, setRegexRules] = usePersistentState('subnet_rebase:regexRules', () => {
    if (initialData?.regexRules?.length) return initialData.regexRules;
    return [];
  });

  // Pair operations
  const addPair = useCallback(() => setPairs(p => [...p, DEFAULT_PAIR()]), []);
  const removePair = useCallback(id => setPairs(p => p.length > 1 ? p.filter(r => r.id !== id) : p), []);
  const updatePair = useCallback((id, field, val) =>
    setPairs(p => p.map(r => r.id === id ? { ...r, [field]: val } : r)), []);

  // Regex rule operations
  const addRule = useCallback(() => setRegexRules(r => [...r, DEFAULT_RULE()]), []);
  const removeRule = useCallback(id => setRegexRules(r => r.filter(x => x.id !== id)), []);
  const updateRule = useCallback((id, field, val) =>
    setRegexRules(r => r.map(x => x.id === id ? { ...x, [field]: val } : x)), []);

  const loadExample = useCallback(() => {
    setPairs(EXAMPLE_PAIRS.map(p => ({ ...p })));
    setAllocs(EXAMPLE_ALLOCS);
    setRegexRules(EXAMPLE_RULES.map(r => ({ ...r })));
    setShowRegex(true);
  }, []);

  const result = useMemo(() => {
    if (!allocs.trim()) return null;

    const parsedPairs = [];
    for (let i = 0; i < pairs.length; i++) {
      const { source, target } = pairs[i];
      if (!source.trim() && !target.trim()) continue;

      const baseCidr = IPv4.parseCIDR(source.trim());
      if (!baseCidr) return { error: `${t('subnet_rebase.err_base_invalid')} (${t('subnet_rebase.pair_n', { n: i + 1 })})` };

      const targetCidr = IPv4.parseCIDR(target.trim());
      if (!targetCidr) return { error: `${t('subnet_rebase.err_target_invalid')} (${t('subnet_rebase.pair_n', { n: i + 1 })})` };

      if (baseCidr.prefix !== targetCidr.prefix)
        return { error: `${t('subnet_rebase.err_prefix_mismatch')} (${t('subnet_rebase.pair_n', { n: i + 1 })})` };

      parsedPairs.push({
        baseSn:   IPv4.subnet(baseCidr.ip, baseCidr.prefix),
        targetSn: IPv4.subnet(targetCidr.ip, targetCidr.prefix),
      });
    }

    if (parsedPairs.length === 0) return null;
    return { lines: rebaseLines(allocs, parsedPairs, regexRules, t) };
  }, [pairs, allocs, regexRules]);

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'subnet', mode: 'rebase', pairs, allocs, regexRules });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [pairs, allocs, regexRules, onShare]);

  const outputLines = result?.lines ?? [];
  const copyText = outputLines
    .map(l => l.status === 'out-of-range' ? `${l.out}  [${l.annotation}]` : l.out)
    .join('\n');

  const arrowStyle = { alignSelf: 'center', opacity: 0.4, fontSize: 18, userSelect: 'none', paddingTop: 18 };
  const removeBtnStyle = { alignSelf: 'center', paddingTop: 18, background: 'none', border: 'none',
    color: 'var(--red)', cursor: 'pointer', fontSize: 16, lineHeight: 1, opacity: 0.7 };

  return (
    <div className="fadein">
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div>
            <div className="card-title" style={{ marginBottom: 2 }}>{t('subnet_rebase.title')}</div>
            <div className="hint" style={{ marginTop: 0 }}>{t('subnet_rebase.subtitle')}</div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={loadExample}>{t('subnet_rebase.load_example')}</button>
        </div>

        {/* Range mapping pairs */}
        <div className="field">
          <label className="label">{t('subnet_rebase.pairs_label')}</label>
          <div style={{ display: 'flex', gap: 6, marginBottom: 4, paddingLeft: 2 }}>
            <span style={{ flex: 1, fontSize: 11, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>{t('subnet_rebase.base_label')}</span>
            <span style={{ width: 24 }} />
            <span style={{ flex: 1, fontSize: 11, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>{t('subnet_rebase.target_label')}</span>
            {pairs.length > 1 && <span style={{ width: 28 }} />}
          </div>
          {pairs.map((pair, i) => (
            <div key={pair.id} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', marginBottom: 6 }}>
              <input className="input" style={{ flex: 1 }} value={pair.source}
                onChange={e => updatePair(pair.id, 'source', e.target.value)}
                placeholder={t('subnet_rebase.base_placeholder')} />
              <span style={arrowStyle}>→</span>
              <input className="input" style={{ flex: 1 }} value={pair.target}
                onChange={e => updatePair(pair.id, 'target', e.target.value)}
                placeholder={t('subnet_rebase.target_placeholder')} />
              {pairs.length > 1 && (
                <button style={removeBtnStyle} onClick={() => removePair(pair.id)} title={t('common.remove')}>×</button>
              )}
            </div>
          ))}
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 4 }} onClick={addPair}>
            {t('subnet_rebase.add_pair')}
          </button>
          <div className="hint">{t('subnet_rebase.pairs_hint')}</div>
        </div>

        {/* Allocations textarea */}
        <div className="field">
          <label className="label">{t('subnet_rebase.allocs_label')}</label>
          <textarea className="input" rows={8} value={allocs} onChange={e => setAllocs(e.target.value)}
            placeholder={t('subnet_rebase.allocs_placeholder')}
            style={{ fontFamily: 'monospace', fontSize: 13, resize: 'vertical' }} />
          <div className="hint">{t('subnet_rebase.allocs_hint')}</div>
        </div>

        {/* Regex section (collapsible) */}
        <div style={{ marginTop: 8 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowRegex(v => !v)}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 10, opacity: 0.6 }}>{showRegex ? '▾' : '▸'}</span>
            {t('subnet_rebase.regex_toggle')}
            {regexRules.length > 0 && (
              <span className="badge badge-cyan" style={{ fontSize: 10, padding: '1px 6px' }}>{regexRules.length}</span>
            )}
          </button>

          {showRegex && (
            <div style={{ marginTop: 10, paddingLeft: 4 }}>
              <div className="hint" style={{ marginBottom: 8 }}>{t('subnet_rebase.regex_hint')}</div>
              {regexRules.length > 0 && (
                <div style={{ display: 'flex', gap: 6, marginBottom: 4, paddingLeft: 2 }}>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>{t('subnet_rebase.regex_pattern')}</span>
                  <span style={{ flex: 1, fontSize: 11, fontWeight: 600, opacity: 0.5, textTransform: 'uppercase', letterSpacing: 1 }}>{t('subnet_rebase.regex_replacement')}</span>
                  <span style={{ width: 28 }} />
                </div>
              )}
              {regexRules.map(rule => (
                <div key={rule.id} style={{ display: 'flex', gap: 6, marginBottom: 6 }}>
                  <input className="input" style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
                    value={rule.pattern} onChange={e => updateRule(rule.id, 'pattern', e.target.value)}
                    placeholder={t('subnet_rebase.regex_pattern_placeholder')} />
                  <input className="input" style={{ flex: 1, fontFamily: 'monospace', fontSize: 12 }}
                    value={rule.replacement} onChange={e => updateRule(rule.id, 'replacement', e.target.value)}
                    placeholder={t('subnet_rebase.regex_replacement_placeholder')} />
                  <button style={removeBtnStyle} onClick={() => removeRule(rule.id)} title={t('common.remove')}>×</button>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" onClick={addRule}>{t('subnet_rebase.add_rule')}</button>
            </div>
          )}
        </div>
      </div>

      {result?.error && <Err msg={result.error} />}

      {result && !result.error && outputLines.length > 0 && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('subnet_rebase.output_label')}</div>
            <CopyBtn text={copyText} label="copy_all" id="subnet-rebase-copy" />
          </div>
          <div style={{ fontFamily: 'monospace', fontSize: 13, lineHeight: 1.8 }}>
            {outputLines.map((l, i) => {
              if (l.status === 'empty') return <div key={i}>&nbsp;</div>;
              if (l.status === 'out-of-range') return (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ opacity: 0.35, textDecoration: 'line-through' }}>{l.out}</span>
                  <span className="badge badge-red" style={{ fontSize: 10 }}>{l.annotation}</span>
                </div>
              );
              return <div key={i} style={{ color: 'var(--fg)' }}>{l.out}</div>;
            })}
          </div>
        </div>
      )}
    </div>
  );
}

window.SubnetRebase = SubnetRebase;
