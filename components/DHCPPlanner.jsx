const { useState, useEffect, useCallback, useRef, useMemo } = React;

function DHCPPlanner({ onShare, initialData }) {
  const { t } = useTranslation();
  const [cidr, setCidr]               = usePersistentState('dhcp:cidr', initialData?.cidr ?? '192.168.1.0/24');
  const [excludeStart, setExcludeStart] = usePersistentState('dhcp:excludeStart', initialData?.excludeStart ?? '10');
  const [excludeEnd, setExcludeEnd]   = usePersistentState('dhcp:excludeEnd', initialData?.excludeEnd ?? '5');
  const [leaseDays, setLeaseDays]     = usePersistentState('dhcp:leaseDays', initialData?.leaseDays ?? '1');
  const [leaseHours, setLeaseHours]   = usePersistentState('dhcp:leaseHours', initialData?.leaseHours ?? '0');
  const [dnsServer, setDnsServer]     = usePersistentState('dhcp:dnsServer', initialData?.dnsServer ?? '8.8.8.8');
  const [dnsServer2, setDnsServer2]   = usePersistentState('dhcp:dnsServer2', initialData?.dnsServer2 ?? '8.8.4.4');
  const [domainName, setDomainName]   = usePersistentState('dhcp:domainName', initialData?.domainName ?? 'corp.local');
  const [poolName, setPoolName]       = usePersistentState('dhcp:poolName', initialData?.poolName ?? 'LAN_POOL');
  const [result, setResult]           = usePersistentState('dhcp:result', null);
  const [err, setErr]                 = useState('');

  const calculate = () => {
    setErr(''); setResult(null);
    const parsed = IPv4.parseCIDR(cidr.trim());
    if (!parsed) { setErr(t('subnet.err_invalid')); return; }
    if (parsed.prefix < 8 || parsed.prefix > 30) { setErr(t('dhcp.err_prefix')); return; }
    const info       = IPv4.subnet(parsed.ip, parsed.prefix);
    const totalHosts = info.hostCount;
    const excS       = Math.max(0, parseInt(excludeStart)||0);
    const excE       = Math.max(0, parseInt(excludeEnd)||0);
    if (excS + excE >= totalHosts) { setErr(t('dhcp.err_excluded')); return; }
    const firstNum   = IPv4.parse(info.firstHostStr);
    const lastNum    = IPv4.parse(info.lastHostStr);
    const scopeStartNum = firstNum + excS;
    const scopeEndNum   = lastNum  - excE;
    setResult({
      network:    info.networkStr,
      broadcast:  info.broadcastStr,
      subnetMask: info.maskStr,
      firstUsable:info.firstHostStr,
      lastUsable: info.lastHostStr,
      totalHosts, excS, excE,
      poolSize:   Math.max(0, totalHosts - excS - excE),
      scopeStart: IPv4.str(scopeStartNum),
      scopeEnd:   IPv4.str(scopeEndNum),
      defaultGw:  info.firstHostStr,
      prefix:     parsed.prefix,
    });
  };

  useEffect(() => {
    if (initialData) {
      if (initialData.cidr !== undefined) setCidr(initialData.cidr);
      if (initialData.poolName !== undefined) setPoolName(initialData.poolName);
      if (initialData.excludeStart !== undefined) setExcludeStart(initialData.excludeStart);
      if (initialData.excludeEnd !== undefined) setExcludeEnd(initialData.excludeEnd);
      if (initialData.dnsServer !== undefined) setDnsServer(initialData.dnsServer);
      if (initialData.dnsServer2 !== undefined) setDnsServer2(initialData.dnsServer2);
      if (initialData.domainName !== undefined) setDomainName(initialData.domainName);
      if (initialData.leaseDays !== undefined) setLeaseDays(initialData.leaseDays);
      if (initialData.leaseHours !== undefined) setLeaseHours(initialData.leaseHours);
    }
    calculate();
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (cidr) (e.detail?.respond ?? onShare)({ tool: 'dhcp', cidr, poolName, excludeStart, excludeEnd, dnsServer, dnsServer2, domainName, leaseDays, leaseHours });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [cidr, poolName, excludeStart, excludeEnd, dnsServer, dnsServer2, domainName, leaseDays, leaseHours, onShare]);

  const genIOS = () => {
    if (!result) return '';
    const excSNum = IPv4.parse(result.firstUsable);
    const excENum = IPv4.parse(result.lastUsable);
    const lines = ['! Cisco IOS DHCP Configuration'];
    if (result.excS > 0) lines.push(`ip dhcp excluded-address ${result.firstUsable} ${IPv4.str(excSNum + result.excS - 1)}`);
    if (result.excE > 0) lines.push(`ip dhcp excluded-address ${IPv4.str(excENum - result.excE + 1)} ${result.lastUsable}`);
    lines.push('!');
    lines.push(`ip dhcp pool ${poolName}`);
    lines.push(` network ${result.network} ${result.subnetMask}`);
    lines.push(` default-router ${result.defaultGw}`);
    lines.push(` dns-server ${dnsServer}${dnsServer2?' '+dnsServer2:''}`);
    if (domainName) lines.push(` domain-name ${domainName}`);
    lines.push(` lease ${parseInt(leaseDays)||0}${parseInt(leaseHours)>0?' '+leaseHours:''}`);
    return lines.join('\n');
  };

  const genNXOS = () => {
    if (!result) return '';
    const excSNum = IPv4.parse(result.firstUsable);
    const excENum = IPv4.parse(result.lastUsable);
    const lines = ['! Cisco NX-OS DHCP Configuration (feature dhcp required)'];
    lines.push('feature dhcp');
    lines.push('ip dhcp relay information option');
    if (result.excS > 0) lines.push(`ip dhcp excluded-address ${result.firstUsable} ${IPv4.str(excSNum + result.excS - 1)}`);
    if (result.excE > 0) lines.push(`ip dhcp excluded-address ${IPv4.str(excENum - result.excE + 1)} ${result.lastUsable}`);
    lines.push('!');
    lines.push(`ip dhcp pool ${poolName}`);
    lines.push(`  network ${result.network}/${result.prefix}`);
    lines.push(`  default-router ${result.defaultGw}`);
    lines.push(`  dns-server ${dnsServer}${dnsServer2?' '+dnsServer2:''}`);
    if (domainName) lines.push(`  domain-name ${domainName}`);
    lines.push(`  lease ${parseInt(leaseDays)||0} ${parseInt(leaseHours)||0} 0`);
    return lines.join('\n');
  };

  const [cfgTab, setCfgTab] = useState('ios');

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('dhcp.subnet_pool')}</div>
        <div className="two-col grid-mobile-1" style={{gap:20}}>
          <div className="field">
            <label className="label">{t('dhcp.network_cidr')}</label>
            <div className="input-row">
              <input className={`input ${err?'error':''}`} value={cidr} onChange={e=>setCidr(e.target.value)}
                onKeyDown={e=>e.key==='Enter'&&calculate()} placeholder="192.168.1.0/24"/>
              <button className="btn btn-primary" onClick={calculate}>{t('dhcp.plan')}</button>
            </div>
            <Err msg={err}/>
          </div>
          <div className="field">
            <label className="label">{t('dhcp.pool_name')}</label>
            <input className="input" value={poolName} onChange={e=>setPoolName(e.target.value)} placeholder="LAN_POOL"/>
          </div>
        </div>
        <div className="two-col grid-mobile-1" style={{gap:20,marginTop:12}}>
          <div className="field">
            <label className="label">{t('dhcp.exclude_start')}</label>
            <input className="input" type="number" min="0" value={excludeStart} onChange={e=>setExcludeStart(e.target.value)} placeholder="10"/>
            <div className="hint">{t('dhcp.exclude_start_hint')}</div>
          </div>
          <div className="field">
            <label className="label">{t('dhcp.exclude_end')}</label>
            <input className="input" type="number" min="0" value={excludeEnd} onChange={e=>setExcludeEnd(e.target.value)} placeholder="5"/>
            <div className="hint">{t('dhcp.exclude_end_hint')}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('dhcp.dhcp_options')}</div>
        <div className="two-col grid-mobile-1" style={{gap:20}}>
          <div className="field">
            <label className="label">{t('dhcp.primary_dns')}</label>
            <input className="input" value={dnsServer} onChange={e=>setDnsServer(e.target.value)} placeholder="8.8.8.8"/>
          </div>
          <div className="field">
            <label className="label">{t('dhcp.secondary_dns')}</label>
            <input className="input" value={dnsServer2} onChange={e=>setDnsServer2(e.target.value)} placeholder="8.8.4.4"/>
          </div>
          <div className="field">
            <label className="label">{t('dhcp.domain_name')}</label>
            <input className="input" value={domainName} onChange={e=>setDomainName(e.target.value)} placeholder="corp.local"/>
          </div>
          <div className="field">
            <label className="label">{t('dhcp.lease_duration')}</label>
            <div style={{display:'flex',gap:8,alignItems:'center'}}>
              <input className="input" type="number" min="0" value={leaseDays} onChange={e=>setLeaseDays(e.target.value)} style={{width:70}}/>
              <span style={{color:'var(--muted)',whiteSpace:'nowrap',fontSize:13}}>{t('dhcp.days')}</span>
              <input className="input" type="number" min="0" max="23" value={leaseHours} onChange={e=>setLeaseHours(e.target.value)} style={{width:70}}/>
              <span style={{color:'var(--muted)',whiteSpace:'nowrap',fontSize:13}}>{t('dhcp.hours')}</span>
            </div>
          </div>
        </div>
      </div>

      {result && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('dhcp.scope_summary')}</div>
            <div style={{display:'flex',justifyContent:'flex-end',marginBottom:8}}>
              <CopyBtn text={`${t('subnet.network_addr')}: ${result.network}/${result.prefix}\n${t('subnet.subnet_mask')}: ${result.subnetMask}\n${t('dhcp.default_gateway')}: ${result.defaultGw}\n${t('dhcp.total_usable')}: ${result.totalHosts.toLocaleString()}\n${t('dhcp.excluded_start_count')}: ${result.excS}\n${t('dhcp.excluded_end_count')}: ${result.excE}\n${t('dhcp.pool_size')}: ${result.poolSize.toLocaleString()}\n${t('dhcp.scope_start')}: ${result.scopeStart}\n${t('dhcp.scope_end')}: ${result.scopeEnd}\n${t('dhcp.lease')}: ${leaseDays}d ${leaseHours}h`} label="copy_all" id="dhcp-copy-all" />
            </div>
            <div className="result-grid grid-mobile-1">
              <ResultItem label={t('subnet.network_addr')} value={`${result.network}/${result.prefix}`}/>
              <ResultItem label={t('subnet.subnet_mask')}  value={result.subnetMask}/>
              <ResultItem label={t('dhcp.default_gateway')}  value={result.defaultGw} accent/>
              <ResultItem label={t('dhcp.total_usable')}     value={result.totalHosts.toLocaleString()}/>
              <ResultItem label={t('dhcp.excluded_start_count')} value={result.excS} red={result.excS>0}/>
              <ResultItem label={t('dhcp.excluded_end_count')}   value={result.excE} red={result.excE>0}/>
              <ResultItem label={t('dhcp.pool_size')}   value={result.poolSize.toLocaleString()} green/>
              <ResultItem label={t('dhcp.scope_start')}      value={result.scopeStart} accent/>
              <ResultItem label={t('dhcp.scope_end')}        value={result.scopeEnd} accent/>
              <ResultItem label={t('dhcp.lease')}            value={`${leaseDays}d ${leaseHours}h`}/>
            </div>
            {result.poolSize < 10 && (
              <div style={{marginTop:12,padding:'8px 12px',background:'rgba(239,68,68,.1)',border:'1px solid var(--red)',borderRadius:'var(--radius)',color:'var(--red)',fontSize:12}}>
                {t('dhcp.pool_warning', { count: result.poolSize })}
              </div>
            )}
          </div>

          <div className="card">
            <div className="card-title">{t('dhcp.lease_guide')}</div>
            <div className="table-wrap hide-mobile"><table>
              <thead><tr><th>{t('dhcp.environment')}</th><th>{t('dhcp.rec_lease')}</th><th>{t('dhcp.rationale')}</th></tr></thead>
              <tbody>
                {Object.values(t('dhcp.lease_guide_rows', { returnObjects: true }) || {}).map((row, idx) => (
                  <tr key={idx}>
                    <td style={{fontWeight:600}}>{row[0]}</td>
                    <td style={{color:'var(--cyan)',fontFamily:'var(--mono)',fontSize:12}}>{row[1]}</td>
                    <td style={{fontSize:12,color:'var(--muted)'}}>{row[2]}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              {Object.values(t('dhcp.lease_guide_rows', { returnObjects: true }) || {}).map((row, idx) => (
                <div key={idx} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{row[0]}</span>
                    <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{row[1]}</span>
                  </div>
                  <div className="mobile-card-row" style={{borderBottom:'none'}}>
                    <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{row[2]}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('dhcp.generated_cfg')}</div>
            <div style={{display:'flex',gap:8,marginBottom:12}}>
              {[{id:'ios',l:'Cisco IOS'},{id:'nxos',l:'Cisco NX-OS'}].map(p=>(
                <button key={p.id} className={`btn btn-sm ${cfgTab===p.id?'btn-primary':'btn-ghost'}`}
                  onClick={()=>setCfgTab(p.id)}>{p.l}</button>
              ))}
              <div style={{marginLeft:'auto'}}>
                <CopyBtn text={cfgTab==='ios'?genIOS():genNXOS()}/>
              </div>
            </div>
            <pre style={{margin:0,padding:'12px 16px',background:'var(--bg)',borderRadius:'var(--radius)',
              fontFamily:'var(--mono)',fontSize:12,color:'var(--cyan)',whiteSpace:'pre-wrap',lineHeight:1.7}}>
              {cfgTab==='ios'?genIOS():genNXOS()}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool: Network CLI Quick Reference ────────────────────────
window.DHCPPlanner = DHCPPlanner;
