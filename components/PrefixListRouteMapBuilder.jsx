const { useState, useEffect, useCallback, useRef, useMemo } = React;

/* ── Helpers ── */
function parseCIDR(str) {
  const m = str.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/);
  if (!m) return null;
  const octets = [+m[1], +m[2], +m[3], +m[4]];
  const prefix = +m[5];
  if (octets.some(o => o > 255) || prefix > 32) return null;
  const ip = (octets[0] << 24 | octets[1] << 16 | octets[2] << 8 | octets[3]) >>> 0;
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  const network = (ip & mask) >>> 0;
  return { ip, mask, prefix, network, octets, str: str.trim() };
}

function ipStr(n) {
  return [(n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF].join('.');
}

function wildcardStr(mask) {
  return ipStr((~mask) >>> 0);
}

function fmtEntry(e) {
  const parsed = parseCIDR(e.prefix);
  if (!parsed) return e.prefix;
  let s = `ip prefix-list ${e.listName} seq ${e.seq} ${e.action} ${parsed.str}`;
  if (e.ge !== '' && e.ge !== undefined) s += ` ge ${e.ge}`;
  if (e.le !== '' && e.le !== undefined) s += ` le ${e.le}`;
  return s;
}

function fmtRouteMapEntry(e, idx) {
  const lines = [];
  lines.push(`route-map ${e.mapName} ${e.action === 'permit' ? 'permit' : 'deny'} ${e.seq}`);
  if (e.matchPrefixList) lines.push(` match ip address prefix-list ${e.matchPrefixList}`);
  if (e.matchTag !== '') lines.push(` match tag ${e.matchTag}`);
  if (e.setMetric !== '') lines.push(` set metric ${e.setMetric}`);
  if (e.setLocalPref !== '') lines.push(` set local-preference ${e.setLocalPref}`);
  if (e.setMetricType) lines.push(` set metric-type ${e.setMetricType}`);
  if (e.setTag !== '') lines.push(` set tag ${e.setTag}`);
  if (e.setNextHop !== '') lines.push(` set ip next-hop ${e.setNextHop}`);
  if (e.setCommunity !== '') lines.push(` set community ${e.setCommunity}`);
  if (e.setAsPathPrepend !== '') lines.push(` set as-path prepend ${e.setAsPathPrepend}`);
  return lines.join('\n');
}

const DEFAULT_PREFIX = () => ({
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  listName: 'NETENGKIT-PREFIXES',
  seq: 10,
  action: 'permit',
  prefix: '',
  ge: '',
  le: '',
});

const DEFAULT_ROUTEMAP = () => ({
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  mapName: 'NETENGKIT-MAP',
  seq: 10,
  action: 'permit',
  matchPrefixList: '',
  matchTag: '',
  setMetric: '',
  setLocalPref: '',
  setMetricType: '',
  setTag: '',
  setNextHop: '',
  setCommunity: '',
  setAsPathPrepend: '',
});

function PrefixListRouteMapBuilder({ onShare, initialData }) {
  const { t } = useTranslation();

  const [tab, setTab] = usePersistentState('prefixlist:tab', initialData?.tab ?? 'prefix');
  const [platform, setPlatform] = usePersistentState('prefixlist:platform', initialData?.platform ?? 'cisco-ios');
  const [prefixEntries, setPrefixEntries] = usePersistentState('prefixlist:prefixes', () => {
    if (initialData?.prefixes?.length) return initialData.prefixes;
    return [DEFAULT_PREFIX()];
  });
  const [routeMapEntries, setRouteMapEntries] = usePersistentState('prefixlist:routemaps', () => {
    if (initialData?.routemaps?.length) return initialData.routemaps;
    return [DEFAULT_ROUTEMAP()];
  });
  const [copied, copy] = useCopy();

  // Share URL wiring
  useEffect(() => {
    const handle = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'prefix-list-builder', tab, platform, prefixes: prefixEntries, routemaps: routeMapEntries,
      });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, platform, prefixEntries, routeMapEntries, onShare]);

  // Prefix entry helpers
  const updatePrefix = useCallback((id, field, value) => {
    setPrefixEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }, []);
  const addPrefix = useCallback(() => {
    setPrefixEntries(prev => {
      const last = prev[prev.length - 1];
      return [...prev, { ...DEFAULT_PREFIX(), seq: (parseInt(last?.seq) || 0) + 10 }];
    });
  }, []);
  const removePrefix = useCallback((id) => {
    setPrefixEntries(prev => prev.length <= 1 ? prev : prev.filter(e => e.id !== id));
  }, []);

  // Route map entry helpers
  const updateRM = useCallback((id, field, value) => {
    setRouteMapEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
  }, []);
  const addRM = useCallback(() => {
    setRouteMapEntries(prev => {
      const last = prev[prev.length - 1];
      return [...prev, { ...DEFAULT_ROUTEMAP(), seq: (parseInt(last?.seq) || 0) + 10 }];
    });
  }, []);
  const removeRM = useCallback((id) => {
    setRouteMapEntries(prev => prev.length <= 1 ? prev : prev.filter(e => e.id !== id));
  }, []);

  // Generate output
  const output = useMemo(() => {
    const lines = [];
    if (tab === 'prefix' || tab === 'combined') {
      // Group prefix-list entries by listName
      const groups = {};
      prefixEntries.forEach(e => {
        if (!e.prefix.trim()) return;
        const parsed = parseCIDR(e.prefix);
        if (!parsed) return;
        if (!groups[e.listName]) groups[e.listName] = [];
        groups[e.listName].push(e);
      });
      Object.entries(groups).forEach(([name, entries]) => {
        lines.push(`! Prefix-List: ${name}`);
        if (platform === 'cisco-nxos') {
          lines.push(`ip prefix-list ${name}`);
        }
        entries.forEach(e => {
          if (platform === 'junos') {
            let line = `route-filter ${e.prefix}`;
            if (e.ge !== '' && e.le !== '') line += ` prefix-length-range /${e.ge}-/${e.le}`;
            else if (e.le !== '') line += ` orlonger`;
            else if (e.ge !== '') line += ` prefix-length-range /${e.ge}-/32`;
            line += ` ${e.action === 'permit' ? 'then accept' : 'then reject'}`;
            lines.push(line);
          } else if (platform === 'arista') {
            let line = `ip prefix-list ${name} seq ${e.seq} ${e.action} ${e.prefix}`;
            if (e.ge !== '') line += ` ge ${e.ge}`;
            if (e.le !== '') line += ` le ${e.le}`;
            lines.push(line);
          } else {
            lines.push(fmtEntry(e));
          }
        });
        lines.push('');
      });
    }
    if (tab === 'routemap' || tab === 'combined') {
      lines.push('! Route-Maps');
      routeMapEntries.forEach((e, idx) => {
        if (e.matchPrefixList || e.matchTag !== '' || e.setMetric !== '' || e.setLocalPref !== '' || e.setTag !== '') {
          if (platform === 'junos') {
            lines.push(`policy-statement ${e.mapName} {`);
            lines.push(`  term ${e.seq} {`);
            lines.push(`    from {`);
            if (e.matchPrefixList) lines.push(`      protocol ${e.matchPrefixList};`);
            if (e.matchTag !== '') lines.push(`      tag ${e.matchTag};`);
            lines.push(`    }`);
            lines.push(`    then {`);
            if (e.action === 'deny') { lines.push(`      reject;`); }
            else {
              if (e.setMetric !== '') lines.push(`      metric ${e.setMetric};`);
              if (e.setLocalPref !== '') lines.push(`      local-preference ${e.setLocalPref};`);
              if (e.setTag !== '') lines.push(`      tag ${e.setTag};`);
              if (e.setNextHop !== '') lines.push(`      next-hop ${e.setNextHop};`);
              if (e.setCommunity !== '') lines.push(`      community ${e.setCommunity};`);
              if (e.setAsPathPrepend !== '') lines.push(`      as-path-prepend ${e.setAsPathPrepend};`);
              lines.push(`      accept;`);
            }
            lines.push(`    }`);
            lines.push(`  }`);
            lines.push(`}`);
          } else {
            lines.push(fmtRouteMapEntry(e, idx));
          }
          lines.push('');
        }
      });
    }
    return lines.join('\n');
  }, [tab, platform, prefixEntries, routeMapEntries]);

  const doExport = () => {
    const blob = new Blob([output + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prefix-list-route-map-${platform}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fadein">
      <div className="card">
        <h2 className="card-title">{t('prefix_list.title')}</h2>
        <p style={{ color: 'var(--text2)', fontSize: '0.88rem', marginBottom: '1rem' }}>
          {t('prefix_list.subtitle')}
        </p>

        {/* Tabs */}
        <div className="btn-row" style={{ marginBottom: '1rem' }}>
          {['prefix', 'routemap', 'combined'].map(tb => (
            <button key={tb} className={`btn btn-sm ${tab === tb ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setTab(tb)}>
              {t(`prefix_list.tab_${tb}`)}
            </button>
          ))}
          <div style={{ flex: 1 }} />
          <select className="select" style={{ width: 160 }} value={platform} onChange={e => setPlatform(e.target.value)}>
            <option value="cisco-ios">Cisco IOS</option>
            <option value="cisco-nxos">Cisco NX-OS</option>
            <option value="junos">Juniper JunOS</option>
            <option value="arista">Arista EOS</option>
          </select>
        </div>

        <div className="two-col">
          <div>
            {/* Prefix List Entries */}
            {(tab === 'prefix' || tab === 'combined') && (
              <>
                <h3 style={{ marginTop: 0 }}>{t('prefix_list.prefix_entries')}</h3>
                {prefixEntries.map((entry, idx) => (
                  <div key={entry.id} style={{
                    padding: '0.75rem', marginBottom: '0.5rem',
                    background: 'var(--panel)', borderRadius: 'var(--radius, 8px)',
                    border: '1px solid var(--border)'
                  }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                      <input className="input" style={{ flex: 2, minWidth: 120 }}
                        value={entry.listName} onChange={e => updatePrefix(entry.id, 'listName', e.target.value)}
                        placeholder={t('prefix_list.list_name')} />
                      <input className="input" style={{ width: 60 }}
                        value={entry.seq} onChange={e => updatePrefix(entry.id, 'seq', e.target.value)}
                        placeholder="Seq" />
                      <select className="select" style={{ width: 80 }}
                        value={entry.action} onChange={e => updatePrefix(entry.id, 'action', e.target.value)}>
                        <option value="permit">permit</option>
                        <option value="deny">deny</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <input className="input" style={{ flex: 3, minWidth: 140 }}
                        value={entry.prefix} onChange={e => updatePrefix(entry.id, 'prefix', e.target.value)}
                        placeholder="10.0.0.0/8" />
                      <input className="input" style={{ width: 50 }}
                        value={entry.ge} onChange={e => updatePrefix(entry.id, 'ge', e.target.value)}
                        placeholder="ge" />
                      <input className="input" style={{ width: 50 }}
                        value={entry.le} onChange={e => updatePrefix(entry.id, 'le', e.target.value)}
                        placeholder="le" />
                      <button className="btn btn-danger btn-sm"
                        onClick={() => removePrefix(entry.id)}>×</button>
                    </div>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={addPrefix}>
                  + {t('prefix_list.add_prefix')}
                </button>
              </>
            )}

            {/* Route Map Entries */}
            {(tab === 'routemap' || tab === 'combined') && (
              <>
                <h3>{t('prefix_list.routemap_entries')}</h3>
                {routeMapEntries.map((entry) => (
                  <div key={entry.id} style={{
                    padding: '0.75rem', marginBottom: '0.5rem',
                    background: 'var(--panel)', borderRadius: 'var(--radius, 8px)',
                    border: '1px solid var(--border)'
                  }}>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.4rem', flexWrap: 'wrap' }}>
                      <input className="input" style={{ flex: 2, minWidth: 120 }}
                        value={entry.mapName} onChange={e => updateRM(entry.id, 'mapName', e.target.value)}
                        placeholder={t('prefix_list.map_name')} />
                      <input className="input" style={{ width: 60 }}
                        value={entry.seq} onChange={e => updateRM(entry.id, 'seq', e.target.value)}
                        placeholder="Seq" />
                      <select className="select" style={{ width: 80 }}
                        value={entry.action} onChange={e => updateRM(entry.id, 'action', e.target.value)}>
                        <option value="permit">permit</option>
                        <option value="deny">deny</option>
                      </select>
                      <button className="btn btn-danger btn-sm"
                        onClick={() => removeRM(entry.id)}>×</button>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', fontSize: '0.85rem' }}>
                      <div className="field" style={{ margin: 0, minWidth: 120 }}>
                        <label className="label" style={{ fontSize: '0.75rem' }}>match prefix-list</label>
                        <input className="input" style={{ fontSize: '0.85rem' }}
                          value={entry.matchPrefixList} onChange={e => updateRM(entry.id, 'matchPrefixList', e.target.value)}
                          placeholder={t('prefix_list.pl_name')} />
                      </div>
                      <div className="field" style={{ margin: 0, width: 80 }}>
                        <label className="label" style={{ fontSize: '0.75rem' }}>set metric</label>
                        <input className="input" style={{ fontSize: '0.85rem' }}
                          value={entry.setMetric} onChange={e => updateRM(entry.id, 'setMetric', e.target.value)}
                          placeholder="0" />
                      </div>
                      <div className="field" style={{ margin: 0, width: 80 }}>
                        <label className="label" style={{ fontSize: '0.75rem' }}>set local-pref</label>
                        <input className="input" style={{ fontSize: '0.85rem' }}
                          value={entry.setLocalPref} onChange={e => updateRM(entry.id, 'setLocalPref', e.target.value)}
                          placeholder="100" />
                      </div>
                      <div className="field" style={{ margin: 0, width: 100 }}>
                        <label className="label" style={{ fontSize: '0.75rem' }}>set tag</label>
                        <input className="input" style={{ fontSize: '0.85rem' }}
                          value={entry.setTag} onChange={e => updateRM(entry.id, 'setTag', e.target.value)}
                          placeholder="100" />
                      </div>
                      <div className="field" style={{ margin: 0, width: 140 }}>
                        <label className="label" style={{ fontSize: '0.75rem' }}>set next-hop</label>
                        <input className="input" style={{ fontSize: '0.85rem' }}
                          value={entry.setNextHop} onChange={e => updateRM(entry.id, 'setNextHop', e.target.value)}
                          placeholder="10.0.0.1" />
                      </div>
                      <div className="field" style={{ margin: 0, width: 140 }}>
                        <label className="label" style={{ fontSize: '0.75rem' }}>set community</label>
                        <input className="input" style={{ fontSize: '0.85rem' }}
                          value={entry.setCommunity} onChange={e => updateRM(entry.id, 'setCommunity', e.target.value)}
                          placeholder="65000:100" />
                      </div>
                    </div>
                  </div>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={addRM}>
                  + {t('prefix_list.add_routemap')}
                </button>
              </>
            )}
          </div>

          {/* Output */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{t('prefix_list.generated_config')}</h3>
              <div className="btn-row">
                <button className="btn btn-sm btn-ghost" onClick={doExport}>
                  {t('common.export')}
                </button>
                <button className="btn btn-sm btn-primary" onClick={() => copy(output, 'prefixlist-out')}>
                  {copied === 'prefixlist-out' ? '✓' : t('common.copy')}
                </button>
              </div>
            </div>
            <pre style={{
              background: 'var(--pre-bg, #0d1117)', color: 'var(--pre-fg, #c9d1d9)',
              padding: '1rem', borderRadius: 'var(--radius, 8px)', fontSize: '0.82rem',
              overflow: 'auto', maxHeight: '600px', lineHeight: '1.5',
              border: '1px solid var(--border, #333)',
            }}>{output || t('prefix_list.empty_output')}</pre>

            <div className="hint" style={{ marginTop: '0.5rem' }}>
              {t('prefix_list.ge_le_hint')}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.PrefixListRouteMapBuilder = PrefixListRouteMapBuilder;
