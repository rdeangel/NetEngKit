const { useState, useEffect, useCallback, useRef, useMemo } = React;

function IPListGenerator({ onShare, initialData }) {
  const { t } = useTranslation();
  const [cidr, setCidr] = usePersistentState('iplist:cidr', initialData?.cidr ?? '192.168.1.0/24');
  const [inclNetwork, setInclNetwork] = usePersistentState('iplist:inclNetwork', initialData?.inclNetwork ?? false);
  const [inclBroadcast, setInclBroadcast] = usePersistentState('iplist:inclBroadcast', initialData?.inclBroadcast ?? false);
  const [filter, setFilter] = usePersistentState('iplist:filter', initialData?.filter ?? '');
  const [result, setResult] = usePersistentState('iplist:result', null);
  const [err, setErr] = useState('');
  const [page, setPage] = usePersistentState('iplist:page', 0);
  const PAGE_SIZE = 100;

  const generate = useCallback((overrideCidr, overrideNet, overrideBcast) => {
    const cidrVal = overrideCidr !== undefined ? overrideCidr : cidr;
    const net = overrideNet !== undefined ? overrideNet : inclNetwork;
    const bcast = overrideBcast !== undefined ? overrideBcast : inclBroadcast;
    setErr(''); setResult(null); setPage(0);
    const c = IPv4.parseCIDR(cidrVal);
    if (!c) { setErr(t('iplist.err_invalid')); return; }
    const sn = IPv4.subnet(c.ip, c.prefix);
    if (sn.totalCount > 65536) { setErr(t('iplist.err_too_large')); return; }
    const ips = [];
    const start = net ? sn.network : (sn.network + 1) >>> 0;
    const end   = bcast ? sn.broadcast : (sn.broadcast - 1) >>> 0;
    for (let i = start; i <= end; i = (i + 1) >>> 0) {
      ips.push(IPv4.str(i));
    }
    setResult({ ips, sn });
  }, [cidr, inclNetwork, inclBroadcast, t]);

  useEffect(() => {
    if (initialData) {
      const c = initialData.cidr ?? cidr;
      const n = initialData.inclNetwork ?? inclNetwork;
      const b = initialData.inclBroadcast ?? inclBroadcast;
      if (initialData.cidr !== undefined) setCidr(c);
      if (initialData.inclNetwork !== undefined) setInclNetwork(n);
      if (initialData.inclBroadcast !== undefined) setInclBroadcast(b);
      if (initialData.filter !== undefined) setFilter(initialData.filter);
      generate(c, n, b);
    } else {
      generate();
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (result) (e.detail?.respond ?? onShare)({ tool: 'subnet', mode: 'iplist', cidr, inclNetwork, inclBroadcast, filter });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [result, cidr, inclNetwork, inclBroadcast, filter, onShare]);

  const filtered = useMemo(() =>
    result ? result.ips.filter(ip => !filter || ip.includes(filter)) : [],
    [result, filter]
  );

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const visible = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const downloadTxt = () => {
    const blob = new Blob([filtered.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `ip-list-${cidr.replace('/', '_')}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('iplist.title')}</div>
        <div className="field">
          <label className="label">{t('iplist.cidr_label')}</label>
          <div className="input-row">
            <input
              className={`input ${err ? 'error' : ''}`}
              value={cidr}
              onChange={e => setCidr(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && generate()}
              placeholder="192.168.1.0/24"
            />
            <button className="btn btn-primary" onClick={() => generate()}>{t('iplist.generate')}</button>
          </div>
          <Err msg={err} />
        </div>
        <div style={{ display: 'flex', gap: 24, marginTop: 8 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={inclNetwork}
              onChange={e => setInclNetwork(e.target.checked)}
              style={{ accentColor: 'var(--cyan)', width: 15, height: 15 }}
            />
            {t('iplist.incl_network')}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
            <input
              type="checkbox"
              checked={inclBroadcast}
              onChange={e => setInclBroadcast(e.target.checked)}
              style={{ accentColor: 'var(--cyan)', width: 15, height: 15 }}
            />
            {t('iplist.incl_broadcast')}
          </label>
        </div>
      </div>

      {result && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, gap: 8, flexWrap: 'wrap' }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {t('iplist.ip_list', { count: result.ips.length })}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <input
                className="input"
                style={{ width: 160 }}
                value={filter}
                onChange={e => { setFilter(e.target.value); setPage(0); }}
                placeholder={t('iplist.filter_placeholder')}
              />
              <button className="btn btn-ghost btn-sm" onClick={downloadTxt}>{t('iplist.txt')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(filtered.map(ip => ({ ip })), 'ip-list.csv')}>{t('iplist.csv')}</button>
              <button className="btn btn-ghost btn-sm" onClick={() => onShare({ tool: 'iplist', cidr, inclNetwork, inclBroadcast, filter })}>{t('common.share')}</button>
              <CopyBtn text={filtered.join('\n')} label="copy_all" id="iplist-copy-all" />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(155px,1fr))', gap: 4, marginBottom: 12 }}>
            {visible.map(ip => {
              const isNetwork = ip === result.sn.networkStr;
              const isBroadcast = ip === result.sn.broadcastStr;
              return (
                <div key={ip} style={{
                  fontFamily: 'var(--mono)', fontSize: 11, padding: '5px 8px', borderRadius: 4,
                  background: isNetwork ? 'rgba(0,212,200,.08)' : isBroadcast ? 'rgba(239,68,68,.1)' : 'var(--panel)',
                  border: `1px solid ${isNetwork ? 'rgba(0,212,200,.25)' : isBroadcast ? 'rgba(239,68,68,.25)' : 'var(--border)'}`,
                  color: isNetwork ? 'var(--cyan)' : isBroadcast ? 'var(--red)' : 'var(--text)',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 4,
                }}>
                  <span>{ip}</span>
                  <CopyBtn text={ip} />
                </div>
              );
            })}
          </div>

          {pageCount > 1 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}>{t('iplist.prev')}</button>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{t('iplist.page_info', { page: page + 1, total: pageCount, count: filtered.length })}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))} disabled={page === pageCount - 1}>{t('iplist.next')}</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

window.IPListGenerator = IPListGenerator;
