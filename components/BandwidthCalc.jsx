const { useState, useEffect, useCallback, useRef, useMemo } = React;

function BandwidthCalc({ onShare, initialData }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('bandwidth:activeTab', initialData?.activeTab ?? 'convert');
  const [bwValue, setBwValue]     = usePersistentState('bandwidth:bwValue', initialData?.bwValue ?? '100');
  const [bwUnit, setBwUnit]       = usePersistentState('bandwidth:bwUnit', initialData?.bwUnit ?? 'Mbps');
  const [fileSize, setFileSize]   = usePersistentState('bandwidth:fileSize', initialData?.fileSize ?? '1');
  const [fileSizeUnit, setFileSizeUnit] = usePersistentState('bandwidth:fileSizeUnit', initialData?.fileSizeUnit ?? 'GB');
  const [linkSpeed, setLinkSpeed] = usePersistentState('bandwidth:linkSpeed', initialData?.linkSpeed ?? '1000');
  const [linkUnit, setLinkUnit]   = usePersistentState('bandwidth:linkUnit', initialData?.linkUnit ?? 'Mbps');
  const [pktSize, setPktSize]     = usePersistentState('bandwidth:pktSize', initialData?.pktSize ?? '1500');
  const [serialSpeed, setSerialSpeed] = usePersistentState('bandwidth:serialSpeed', initialData?.serialSpeed ?? '1000');
  const [serialUnit, setSerialUnit]   = usePersistentState('bandwidth:serialUnit', initialData?.serialUnit ?? 'Mbps');
  const [pps, setPps]             = usePersistentState('bandwidth:pps', initialData?.pps ?? '1000');
  const [avgPktSize, setAvgPktSize]   = usePersistentState('bandwidth:avgPktSize', initialData?.avgPktSize ?? '512');
  const [ifaceSpeed, setIfaceSpeed]   = usePersistentState('bandwidth:ifaceSpeed', initialData?.ifaceSpeed ?? '1000');
  const [ifaceUnit, setIfaceUnit]     = usePersistentState('bandwidth:ifaceUnit', initialData?.ifaceUnit ?? 'Mbps');

  useEffect(() => {
    if (initialData) {
      if (initialData.activeTab !== undefined) setActiveTab(initialData.activeTab);
      if (initialData.bwValue !== undefined) setBwValue(initialData.bwValue);
      if (initialData.bwUnit !== undefined) setBwUnit(initialData.bwUnit);
      if (initialData.fileSize !== undefined) setFileSize(initialData.fileSize);
      if (initialData.fileSizeUnit !== undefined) setFileSizeUnit(initialData.fileSizeUnit);
      if (initialData.linkSpeed !== undefined) setLinkSpeed(initialData.linkSpeed);
      if (initialData.linkUnit !== undefined) setLinkUnit(initialData.linkUnit);
      if (initialData.pktSize !== undefined) setPktSize(initialData.pktSize);
      if (initialData.serialSpeed !== undefined) setSerialSpeed(initialData.serialSpeed);
      if (initialData.serialUnit !== undefined) setSerialUnit(initialData.serialUnit);
      if (initialData.pps !== undefined) setPps(initialData.pps);
      if (initialData.avgPktSize !== undefined) setAvgPktSize(initialData.avgPktSize);
      if (initialData.ifaceSpeed !== undefined) setIfaceSpeed(initialData.ifaceSpeed);
      if (initialData.ifaceUnit !== undefined) setIfaceUnit(initialData.ifaceUnit);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (bwValue || fileSize || pktSize || pps || ifaceSpeed) {
        (e.detail?.respond ?? onShare)({ tool: 'bandwidth', activeTab, bwValue, bwUnit, fileSize, fileSizeUnit, linkSpeed, linkUnit, pktSize, serialSpeed, serialUnit, pps, avgPktSize, ifaceSpeed, ifaceUnit });
      }
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [activeTab, bwValue, bwUnit, fileSize, fileSizeUnit, linkSpeed, linkUnit, pktSize, serialSpeed, serialUnit, pps, avgPktSize, ifaceSpeed, ifaceUnit, onShare]);

  const toBps = (v, unit) => {
    const n = parseFloat(v) || 0;
    return unit==='bps'?n:unit==='Kbps'?n*1e3:unit==='Mbps'?n*1e6:unit==='Gbps'?n*1e9:unit==='Tbps'?n*1e12:
           unit==='B/s'?n*8:unit==='KB/s'?n*8e3:unit==='MB/s'?n*8e6:unit==='GB/s'?n*8e9:unit==='TB/s'?n*8e12:n;
  };
  const toBytes = (v, unit) => {
    const n = parseFloat(v) || 0;
    return unit==='KB'?n*1e3:unit==='MB'?n*1e6:unit==='GB'?n*1e9:unit==='TB'?n*1e12:
           unit==='KiB'?n*1024:unit==='MiB'?n*1048576:unit==='GiB'?n*1073741824:n;
  };
  const fmtTime = s => {
    if(s<0.001) return `${(s*1e6).toFixed(2)} μs`;
    if(s<1)     return `${(s*1000).toFixed(2)} ms`;
    if(s<60)    return `${s.toFixed(2)} s`;
    if(s<3600)  return `${Math.floor(s/60)}m ${Math.round(s%60)}s`;
    return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
  };
  const fmtBps = bps => {
    if(bps>=1e12) return `${(bps/1e12).toFixed(4)} Tbps`;
    if(bps>=1e9)  return `${(bps/1e9).toFixed(4)} Gbps`;
    if(bps>=1e6)  return `${(bps/1e6).toFixed(4)} Mbps`;
    if(bps>=1e3)  return `${(bps/1e3).toFixed(4)} Kbps`;
    return `${bps.toFixed(4)} bps`;
  };

  const convBps       = toBps(bwValue, bwUnit);
  const transferBytes = toBytes(fileSize, fileSizeUnit);
  const transferBps   = toBps(linkSpeed, linkUnit);
  const transferSec   = transferBps > 0 ? (transferBytes*8)/transferBps : 0;
  const serialBps     = toBps(serialSpeed, serialUnit);
  const serialDelaySec= serialBps > 0 ? ((parseInt(pktSize)||0)*8)/serialBps : 0;
  const utilBps       = (parseInt(pps)||0)*(parseInt(avgPktSize)||0)*8;
  const ifaceBps      = toBps(ifaceSpeed, ifaceUnit);
  const utilPct       = ifaceBps > 0 ? Math.min(100,(utilBps/ifaceBps)*100) : 0;
  let utilColor = 'var(--green)';
  if (utilPct >= 80) {
    utilColor = 'var(--red)';
  } else if (utilPct >= 60) {
    utilColor = 'var(--yellow)';
  }
  const units         = ['bps','Kbps','Mbps','Gbps','Tbps'];
  const sizeUnits     = ['KB','MB','GB','TB','KiB','MiB','GiB'];

  const [obsRate, setObsRate]   = usePersistentState('bandwidth:obsRate', '');
  const [obsUnit, setObsUnit]   = usePersistentState('bandwidth:obsUnit', 'MB/s');

  const tabs = [
    {id:'convert',   l:t('bandwidth.tabs.convert')},
    {id:'transfer',  l:t('bandwidth.tabs.transfer')},
    {id:'linkrate',  l:t('bandwidth.tabs.linkrate')},
    {id:'serial',    l:t('bandwidth.tabs.serial')},
    {id:'util',      l:t('bandwidth.tabs.util')},
  ];

  return (
    <div className="fadein">
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
        {tabs.map(t_tab=>(
          <button key={t_tab.id} className={`btn btn-sm ${activeTab===t_tab.id?'btn-primary':'btn-ghost'}`}
            onClick={()=>setActiveTab(t_tab.id)}>{t_tab.l}</button>
        ))}
      </div>

      {activeTab==='convert' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('bandwidth.convert.title')}</div>
            <div className="field">
              <label className="label">{t('bandwidth.convert.value')}</label>
              <div className="input-row">
                <input className="input" value={bwValue} onChange={e=>setBwValue(e.target.value)} placeholder="100"/>
                <select className="input" style={{width:110}} value={bwUnit} onChange={e=>setBwUnit(e.target.value)}>
                  <optgroup label={t('bandwidth.convert.bits_sec')}>
                    {units.map(u=><option key={u}>{u}</option>)}
                  </optgroup>
                  <optgroup label={t('bandwidth.convert.bytes_sec')}>
                    {['B/s','KB/s','MB/s','GB/s','TB/s'].map(u=><option key={u}>{u}</option>)}
                  </optgroup>
                </select>
              </div>
              <div className="hint">{t('bandwidth.convert.hint')}</div>
            </div>
          </div>
          <div className="card fadein">
            <div className="card-title">{t('bandwidth.convert.equivalents')}</div>
            <div style={{marginBottom:8,fontSize:11,color:'var(--muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>{t('bandwidth.convert.bits_per_sec')}</div>
            <div className="result-grid grid-mobile-1" style={{marginBottom:16}}>
              {units.map(u=>{
                const v=u==='bps'?convBps:u==='Kbps'?convBps/1e3:u==='Mbps'?convBps/1e6:u==='Gbps'?convBps/1e9:convBps/1e12;
                return <ResultItem key={u} label={u} value={v.toLocaleString(undefined,{maximumFractionDigits:6})} accent={u===bwUnit}/>;
              })}
            </div>
            <div style={{marginBottom:8,fontSize:11,color:'var(--muted)',fontWeight:600,textTransform:'uppercase',letterSpacing:'0.06em'}}>{t('bandwidth.convert.bytes_per_sec')}</div>
            <div className="result-grid grid-mobile-1">
              <ResultItem label="B/s"   value={(convBps/8).toLocaleString(undefined,{maximumFractionDigits:2})}        accent={bwUnit==='B/s'}/>
              <ResultItem label="KB/s"  value={(convBps/8/1e3).toLocaleString(undefined,{maximumFractionDigits:4})}   accent={bwUnit==='KB/s'}/>
              <ResultItem label="MB/s"  value={(convBps/8/1e6).toLocaleString(undefined,{maximumFractionDigits:4})}   accent={bwUnit==='MB/s'}  green/>
              <ResultItem label="GB/s"  value={(convBps/8/1e9).toLocaleString(undefined,{maximumFractionDigits:6})}   accent={bwUnit==='GB/s'}/>
              <ResultItem label="KiB/s" value={(convBps/8/1024).toLocaleString(undefined,{maximumFractionDigits:4})}/>
              <ResultItem label="MiB/s" value={(convBps/8/1048576).toLocaleString(undefined,{maximumFractionDigits:4})} yellow/>
              <ResultItem label="GiB/s" value={(convBps/8/1073741824).toLocaleString(undefined,{maximumFractionDigits:6})}/>
            </div>
            <div style={{marginTop:12,padding:'8px 12px',background:'var(--card)',borderRadius:'var(--radius)',border:'1px solid var(--border)',fontSize:12,color:'var(--muted)'}}>
              <strong style={{color:'var(--text)'}}>{t('bandwidth.convert.mb_vs_mib')}</strong> {t('bandwidth.convert.mb_vs_mib_desc')}
            </div>
          </div>
          <div className="card">
            <div className="card-title">{t('bandwidth.convert.common_speeds')}</div>
            <div className="table-wrap hide-mobile"><table>
              <thead><tr><th>{t('bandwidth.convert.interface')}</th><th>{t('bandwidth.convert.speed')}</th><th>{t('bandwidth.convert.mbps')}</th><th>{t('bandwidth.convert.mb_s')}</th><th>{t('bandwidth.convert.mib_s')}</th></tr></thead>
              <tbody>
                {[[t('bandwidth.interfaces.fast_e'),100],[t('bandwidth.interfaces.gig_e'),1000],[t('bandwidth.interfaces.10g_e'),10000],
                  [t('bandwidth.interfaces.25g_e'),25000],[t('bandwidth.interfaces.100g_e'),100000],[t('bandwidth.interfaces.400g_e'),400000],
                  [t('bandwidth.interfaces.t1'),1.544],[t('bandwidth.interfaces.t3'),44.736],[t('bandwidth.interfaces.oc3'),155.52],[t('bandwidth.interfaces.oc48'),2488.32],
                ].map(([name,mbps])=>(
                  <tr key={name}>
                    <td style={{fontFamily:'var(--mono)',fontSize:12}}>{name}</td>
                    <td><span className="badge badge-cyan">{mbps>=1000?mbps/1000+'G':mbps+'M'}</span></td>
                    <td style={{fontFamily:'var(--mono)'}}>{mbps.toLocaleString()}</td>
                    <td style={{fontFamily:'var(--mono)'}}>{(mbps/8).toFixed(2)}</td>
                    <td style={{fontFamily:'var(--mono)'}}>{(mbps*1e6/8/1048576).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              {[[t('bandwidth.interfaces.fast_e'),100],[t('bandwidth.interfaces.gig_e'),1000],[t('bandwidth.interfaces.10g_e'),10000],[t('bandwidth.interfaces.t1'),1.544],[t('bandwidth.interfaces.oc3'),155.52]].map(([name,mbps])=>(
                <div key={name} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{name}</span>
                    <span className="mobile-card-value" style={{color:'var(--cyan)',fontWeight:600}}>{mbps>=1000?mbps/1000+'G':mbps+'M'}</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('bandwidth.convert.mb_s')} | {t('bandwidth.convert.mib_s')}</span>
                    <span className="mobile-card-value">{(mbps/8).toFixed(1)} | {(mbps*1e6/8/1048576).toFixed(1)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab==='transfer' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('bandwidth.transfer.title')}</div>
            <div className="two-col grid-mobile-1" style={{gap:20}}>
              <div className="field">
                <label className="label">{t('bandwidth.transfer.file_size')}</label>
                <div className="input-row">
                  <input className="input" value={fileSize} onChange={e=>setFileSize(e.target.value)} placeholder="1"/>
                  <select className="input" style={{width:90}} value={fileSizeUnit} onChange={e=>setFileSizeUnit(e.target.value)}>
                    {sizeUnits.map(u=><option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="label">{t('bandwidth.transfer.link_speed')}</label>
                <div className="input-row">
                  <input className="input" value={linkSpeed} onChange={e=>setLinkSpeed(e.target.value)} placeholder="1000"/>
                  <select className="input" style={{width:100}} value={linkUnit} onChange={e=>setLinkUnit(e.target.value)}>
                    <optgroup label={t('bandwidth.transfer.data_bits')}>
                      {units.map(u=><option key={u}>{u}</option>)}
                    </optgroup>
                    <optgroup label={t('bandwidth.convert.bytes_sec')}>
                      {['B/s','KB/s','MB/s','GB/s'].map(u=><option key={u}>{u}</option>)}
                    </optgroup>
                  </select>
                </div>
                <div className="hint">{t('bandwidth.transfer.hint')}</div>
              </div>
            </div>
          </div>
          <div className="card fadein">
            <div className="card-title">{t('common.results')}</div>
            <div className="result-grid grid-mobile-1">
              <ResultItem label={t('bandwidth.transfer.data_bits')}    value={(transferBytes*8).toLocaleString()}/>
              <ResultItem label={t('bandwidth.transfer.speed')}          value={fmtBps(transferBps)}/>
              <ResultItem label={t('bandwidth.transfer.transfer_time')}  value={fmtTime(transferSec)} accent/>
            </div>
            <div style={{marginTop:16}}>
              <div className="label" style={{marginBottom:8}}>{t('bandwidth.transfer.at_different_speeds')}</div>
              <div className="table-wrap hide-mobile"><table>
                <thead><tr><th>{t('bandwidth.transfer.link')}</th><th>{t('bandwidth.transfer.eff_100')}</th><th>{t('bandwidth.transfer.eff_95')}</th><th>{t('bandwidth.transfer.eff_70')}</th></tr></thead>
                <tbody>
                  {[['T1',1.544e6],['Fast-E',100e6],['GigE',1e9],['10G',10e9],['100G',100e9],['200G',200e9],['400G',400e9],['800G',800e9]].map(([l,b])=>(
                    <tr key={l}>
                      <td>{l}</td>
                      <td style={{fontFamily:'var(--mono)'}}>{fmtTime(transferBytes*8/b)}</td>
                      <td style={{fontFamily:'var(--mono)'}}>{fmtTime(transferBytes*8/(b*0.95))}</td>
                      <td style={{fontFamily:'var(--mono)'}}>{fmtTime(transferBytes*8/(b*0.70))}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
              {/* Mobile View */}
              <div className="show-mobile mobile-cards">
                {[['T1',1.544e6],['Fast-E',100e6],['GigE',1e9],['10G',10e9]].map(([l,b])=>(
                  <div key={l} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{l}</span>
                      <span className="mobile-card-value" style={{color:'var(--cyan)',fontWeight:600}}>{fmtTime(transferBytes*8/b)}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('bandwidth.transfer.eff_95').split(' ')[0]} | {t('bandwidth.transfer.eff_70').split(' ')[0]}</span>
                      <span className="mobile-card-value">{fmtTime(transferBytes*8/(b*0.95))} | {fmtTime(transferBytes*8/(b*0.70))}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab==='linkrate' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('bandwidth.linkrate.title')}</div>
            <div className="hint" style={{marginBottom:12}}>{t('bandwidth.linkrate.hint')}</div>
            <div className="field">
              <label className="label">{t('bandwidth.linkrate.link_speed')}</label>
              <div className="input-row">
                <input className="input" value={linkSpeed} onChange={e=>setLinkSpeed(e.target.value)} placeholder="1000"/>
                <select className="input" style={{width:90}} value={linkUnit} onChange={e=>setLinkUnit(e.target.value)}>
                  {units.map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
          </div>
          {transferBps>0&&(
            <div className="card fadein">
              <div className="card-title">{t('bandwidth.linkrate.expected_rate')}</div>
              <div className="result-grid grid-mobile-1">
                <ResultItem label={t('bandwidth.linkrate.theo_max_mb')}  value={(transferBps/8/1e6).toFixed(3)}   accent green/>
                <ResultItem label={t('bandwidth.linkrate.theo_max_mib')} value={(transferBps/8/1048576).toFixed(3)} yellow/>
                <ResultItem label={t('bandwidth.linkrate.eff_95_mb')} value={(transferBps*0.95/8/1e6).toFixed(3)}/>
                <ResultItem label={t('bandwidth.linkrate.eff_70_mb')} value={(transferBps*0.70/8/1e6).toFixed(3)}/>
              </div>
              <div style={{marginTop:12,padding:'8px 12px',background:'var(--card)',borderRadius:'var(--radius)',border:'1px solid var(--border)',fontSize:12,color:'var(--muted)'}}>
                <strong style={{color:'var(--text)'}}>{t('bandwidth.linkrate.mb_vs_mib_short')}</strong> {t('bandwidth.linkrate.mb_vs_mib_desc_short')}
              </div>
              <div style={{marginTop:16}}>
                <div className="label" style={{marginBottom:8}}>{t('bandwidth.linkrate.common_ref')}</div>
                <div className="table-wrap hide-mobile"><table>
                  <thead><tr><th>{t('bandwidth.transfer.link')}</th><th>{t('bandwidth.convert.mbps')}</th><th>{t('bandwidth.linkrate.max_mb_s')}</th><th>{t('bandwidth.linkrate.max_mib_s')}</th><th>{t('bandwidth.linkrate.typical_mb_s')}</th></tr></thead>
                  <tbody>
                    {[[t('bandwidth.interfaces.fast_e'),100],[t('bandwidth.interfaces.gig_e'),1000],[t('bandwidth.interfaces.2_5g_e'),2500],[t('bandwidth.interfaces.10g_e'),10000],[t('bandwidth.interfaces.25g_e'),25000],[t('bandwidth.interfaces.100g_e'),100000]].map(([name,mbps])=>{
                      const bps=mbps*1e6;
                      return (
                        <tr key={name} style={Math.abs(transferBps-bps)<1?{background:'rgba(0,212,200,.07)'}:{}}>
                          <td style={{fontSize:12}}>{name}</td>
                          <td style={{fontFamily:'var(--mono)'}}>{mbps.toLocaleString()}</td>
                          <td style={{fontFamily:'var(--mono)',color:'var(--green)'}}>{(bps/8/1e6).toFixed(1)}</td>
                          <td style={{fontFamily:'var(--mono)',color:'var(--yellow)'}}>{(bps/8/1048576).toFixed(1)}</td>
                          <td style={{fontFamily:'var(--mono)'}}>{(bps*0.7/8/1e6).toFixed(1)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
                {/* Mobile View */}
                <div className="show-mobile mobile-cards">
                  {[['Fast-E',100],['GigE',1000],['2.5G',2500],['10G',10000]].map(([name,mbps])=>(
                    <div key={name} className="mobile-card">
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{name}</span>
                        <span className="mobile-card-value" style={{color:'var(--green)',fontWeight:600}}>{(mbps*1e6/8/1e6).toFixed(1)} MB/s</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('bandwidth.linkrate.typical_mb_s').split(' ')[0]} (70%)</span>
                        <span className="mobile-card-value">{(mbps*1e6*0.7/8/1e6).toFixed(1)} MB/s</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
          <div className="card">
            <div className="card-title">{t('bandwidth.linkrate.obs_title')}</div>
            <div className="hint" style={{marginBottom:12}}>{t('bandwidth.linkrate.obs_hint')}</div>
            <div className="field">
              <label className="label">{t('bandwidth.linkrate.obs_label')}</label>
              <div className="input-row">
                <input className="input" value={obsRate} onChange={e=>setObsRate(e.target.value)} placeholder="e.g. 11.2"/>
                <select className="input" style={{width:100}} value={obsUnit} onChange={e=>setObsUnit(e.target.value)}>
                  {['B/s','KB/s','MB/s','GB/s','MiB/s','GiB/s'].map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
            {obsRate&&parseFloat(obsRate)>0&&(()=>{
              const n=parseFloat(obsRate)||0;
              const bps=obsUnit==='B/s'?n*8:obsUnit==='KB/s'?n*8e3:obsUnit==='MB/s'?n*8e6:obsUnit==='GB/s'?n*8e9:obsUnit==='MiB/s'?n*8*1048576:obsUnit==='GiB/s'?n*8*1073741824:n*8e6;
              return (
                <div className="result-grid grid-mobile-1" style={{marginTop:12}}>
                  <ResultItem label={t('bandwidth.linkrate.implied_100')} value={fmtBps(bps)}/>
                  <ResultItem label={t('bandwidth.linkrate.implied_95')}  value={fmtBps(bps/0.95)}/>
                  <ResultItem label={t('bandwidth.linkrate.implied_70')}  value={fmtBps(bps/0.70)} accent/>
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {activeTab==='serial' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('bandwidth.serial.title')}</div>
            <div className="hint" style={{marginBottom:12}}>{t('bandwidth.serial.hint')}</div>
            <div className="two-col grid-mobile-1" style={{gap:20}}>
              <div className="field">
                <label className="label">{t('bandwidth.serial.pkt_size_bytes')}</label>
                <div className="input-row">
                  <input className="input" value={pktSize} onChange={e=>setPktSize(e.target.value)} placeholder="1500"/>
                  <select className="input" style={{width:130}} value={pktSize} onChange={e=>setPktSize(e.target.value)}>
                    {[[t('bandwidth.preset_pkt_sizes.eth_min'),'64'],['128 B','128'],['256 B','256'],['512 B','512'],[t('bandwidth.preset_pkt_sizes.mtu'),'1500'],[t('bandwidth.preset_pkt_sizes.jumbo'),'9000']].map(([l,v])=>(
                      <option key={v} value={v}>{l}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="field">
                <label className="label">{t('bandwidth.serial.link_speed')}</label>
                <div className="input-row">
                  <input className="input" value={serialSpeed} onChange={e=>setSerialSpeed(e.target.value)} placeholder="1000"/>
                  <select className="input" style={{width:90}} value={serialUnit} onChange={e=>setSerialUnit(e.target.value)}>
                    {units.map(u=><option key={u}>{u}</option>)}
                  </select>
                </div>
              </div>
            </div>
          </div>
          {serialBps>0 && (
            <div className="card fadein">
              <div className="card-title">{t('common.results')}</div>
              <div className="result-grid grid-mobile-1">
                <ResultItem label={t('bandwidth.serial.pkt_size_bytes').split(' ')[0]}  value={`${parseInt(pktSize)||0} ${t('bandwidth.bytes')}`}/>
                <ResultItem label={t('bandwidth.serial.bits_on_wire')} value={`${(parseInt(pktSize)||0)*8} ${t('bandwidth.bits')}`}/>
                <ResultItem label={t('bandwidth.serial.delay')}        value={fmtTime(serialDelaySec)} accent/>
                <ResultItem label={t('bandwidth.serial.delay_us')}   value={`${(serialDelaySec*1e6).toFixed(4)} μs`}/>
              </div>
              <div style={{marginTop:16}}>
                <div className="label" style={{marginBottom:8}}>{t('bandwidth.serial.across_sizes')}</div>
                <div className="table-wrap hide-mobile" style={{maxHeight:240,overflowY:'auto'}}><table>
                  <thead><tr><th>{t('bandwidth.serial.size')}</th><th>{t('bandwidth.serial.delay')}</th><th>{t('bandwidth.serial.max_rate')}</th></tr></thead>
                  <tbody>
                    {[64,128,256,512,1024,1500,9000].map(sz=>{
                      const d=serialBps>0?(sz*8)/serialBps:0;
                      const mx=serialBps>0?serialBps/(sz*8):0;
                      return (
                        <tr key={sz} style={sz===parseInt(pktSize)?{background:'rgba(0,212,200,.07)'}:{}}>
                          <td style={{fontFamily:'var(--mono)'}}>{sz} B</td>
                          <td style={{fontFamily:'var(--mono)'}}>{fmtTime(d)}</td>
                          <td style={{fontFamily:'var(--mono)'}}>{mx.toLocaleString(undefined,{maximumFractionDigits:0})} {t('bandwidth.pps')}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
                {/* Mobile View */}
                <div className="show-mobile mobile-cards">
                  {[64,512,1500,9000].map(sz=>{
                    const d=serialBps>0?(sz*8)/serialBps:0;
                    const mx=serialBps>0?serialBps/(sz*8):0;
                    return (
                      <div key={sz} className="mobile-card" style={sz===parseInt(pktSize)?{borderColor:'var(--cyan)'}:{}}>
                        <div className="mobile-card-row">
                          <span className="mobile-card-label">{sz} {t('bandwidth.bytes')}</span>
                          <span className="mobile-card-value" style={{color:'var(--cyan)',fontWeight:600}}>{fmtTime(d)}</span>
                        </div>
                        <div className="mobile-card-row">
                          <span className="mobile-card-label">{t('bandwidth.serial.max_rate')}</span>
                          <span className="mobile-card-value">{mx.toLocaleString(undefined,{maximumFractionDigits:0})} {t('bandwidth.pps')}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab==='util' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('bandwidth.util.title')}</div>
            <div className="hint" style={{marginBottom:12}}>{t('bandwidth.util.hint')}</div>
            <div className="two-col grid-mobile-1" style={{gap:20}}>
              <div className="field">
                <label className="label">{t('bandwidth.util.pkt_rate')}</label>
                <input className="input" value={pps} onChange={e=>setPps(e.target.value)} placeholder="1000"/>
              </div>
              <div className="field">
                <label className="label">{t('bandwidth.util.avg_pkt_size')}</label>
                <div className="input-row">
                  <input className="input" value={avgPktSize} onChange={e=>setAvgPktSize(e.target.value)} placeholder="512"/>
                  <select className="input" style={{width:140}}
                    value={['64','512','1500'].includes(avgPktSize) ? avgPktSize : 'custom'}
                    onChange={e=>{ if(e.target.value!=='custom') setAvgPktSize(e.target.value); }}>
                    {!['64','512','1500'].includes(avgPktSize) && (
                      <option value="custom">{t('bandwidth.util.custom')} ({avgPktSize||'?'}B)</option>
                    )}
                    <option value="64">{t('bandwidth.preset_pkt_sizes.eth_min')}</option>
                    <option value="512">{t('bandwidth.preset_pkt_sizes.avg')}</option>
                    <option value="1500">{t('bandwidth.preset_pkt_sizes.mtu')}</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="field" style={{marginTop:12}}>
              <label className="label">{t('bandwidth.util.interface_speed')}</label>
              <div className="input-row">
                <input className="input" value={ifaceSpeed} onChange={e=>setIfaceSpeed(e.target.value)} placeholder="1000"/>
                <select className="input" style={{width:90}} value={ifaceUnit} onChange={e=>setIfaceUnit(e.target.value)}>
                  {units.map(u=><option key={u}>{u}</option>)}
                </select>
              </div>
            </div>
          </div>
          <div className="card fadein">
            <div className="card-title">{t('common.results')}</div>
            <div className="result-grid grid-mobile-1">
              <ResultItem label={t('bandwidth.util.traffic_rate')}   value={fmtBps(utilBps)} accent/>
              <ResultItem label={t('bandwidth.util.link_capacity')}  value={fmtBps(ifaceBps)}/>
              <ResultItem label={t('bandwidth.util.utilization')}    value={`${utilPct.toFixed(2)}%`} green={utilPct < 60} yellow={utilPct >= 60 && utilPct < 80} red={utilPct >= 80}/>
              <ResultItem label={t('bandwidth.util.headroom')}       value={fmtBps(Math.max(0,ifaceBps-utilBps))}/>
              <ResultItem label={t('bandwidth.util.max_pps_64')}  value={(ifaceBps/(64*8)).toLocaleString(undefined,{maximumFractionDigits:0})}/>
              <ResultItem label={t('bandwidth.util.max_pps_1500')} value={(ifaceBps/(1500*8)).toLocaleString(undefined,{maximumFractionDigits:0})}/>
            </div>
            <div style={{marginTop:16,padding:'12px 16px',background:'var(--bg)',borderRadius:'var(--radius)',border:'1px solid ' + utilColor}}>
              <div style={{fontSize:11,color:'var(--muted)',marginBottom:6}}>{t('bandwidth.util.gauge_label')}</div>
              <div style={{height:10,background:'var(--border)',borderRadius:4,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${Math.min(100,utilPct)}%`,background:utilColor,borderRadius:4,transition:'width .3s'}}/>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:11,color:'var(--muted)'}}>
                <span>0%</span>
                <span style={{color:utilPct>=60?'var(--yellow)':'var(--muted)'}}>{t('bandwidth.util.warn_60')}</span>
                <span style={{color:utilPct>=80?'var(--red)':'var(--muted)'}}>{t('bandwidth.util.crit_80')}</span>
                <span>100%</span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool: MTU & Encapsulation Calculator ─────────────────────
window.BandwidthCalc = BandwidthCalc;
