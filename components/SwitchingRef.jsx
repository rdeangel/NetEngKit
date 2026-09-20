const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SwitchingRef({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const [tab, setTab]           = usePersistentState('switching-ref:tab', initialData?.tab ?? 'stp');
  const [stpTab, setStpTab]     = useState('variants');
  const [hello, setHello]       = useState('2');
  const [fwdDelay, setFwdDelay] = useState('15');
  const [maxAge, setMaxAge]     = useState('20');
  const [priority, setPriority] = useState('32768');
  const [macAddr, setMacAddr]   = useState('00:1A:2B:3C:4D:5E');

  // Apply-down: sidebar sub-row → switch tab
  useEffect(() => {
    if (initialData?.tab && initialData.tab !== tab) setTab(initialData.tab);
  }, [initialData]);

  // Report-up: tab change → sidebar highlight follows
  useEffect(() => { onNav?.({ tab }); }, [tab]);

  // Share wiring
  useEffect(() => {
    const handle = (e) => (e.detail?.respond ?? onShare)({ tool: 'switching-ref', tab });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [tab, onShare]);

  const helloSec    = parseInt(hello)||2;
  const fwdDelaySec = parseInt(fwdDelay)||15;
  const maxAgeSec   = parseInt(maxAge)||20;
  const conv8021d   = maxAgeSec + 2*fwdDelaySec;
  const convRSTP    = 3*helloSec;
  const bridgePri   = parseInt(priority)||32768;
  const macClean    = macAddr.replace(/[^0-9a-fA-F]/g,'').toUpperCase().padEnd(12,'0').slice(0,12);
  const bridgeId    = `${(bridgePri+1).toString(16).toUpperCase().padStart(4,'0')}:${macClean.match(/.{2}/g).join(':')}`;

  const topTabs = [
    {id:'stp',      l: t('switching.stp_title')},
    {id:'ether',    l: t('switching.etherchannel_title')},
    {id:'vpc',      l: t('switching.vpc_title')},
  ];
  const stpTabs = [
    {id:'variants', l: t('switching.stp_variants')},
    {id:'states',   l: t('switching.stp_states')},
    {id:'timers',   l: t('switching.stp_timers')},
    {id:'bridge',   l: t('switching.stp_bridge')},
    {id:'configs',  l: t('switching.stp_configs')},
  ];

  return (
    <div className="fadein">
      <div style={{display:'flex',gap:8,marginBottom:20,flexWrap:'wrap'}}>
        {topTabs.map(t_tab=>(
          <button key={t_tab.id} className={`btn btn-sm ${tab===t_tab.id?'btn-primary':'btn-ghost'}`}
            onClick={()=>setTab(t_tab.id)} style={{flex:1,minWidth:130}}>{t_tab.l}</button>
        ))}
      </div>

      {/* ── STP TAB ── */}
      {tab==='stp' && (
        <div className="fadein">
          <div style={{display:'flex',gap:6,marginBottom:16,flexWrap:'wrap'}}>
            {stpTabs.map(t_tab=>(
              <button key={t_tab.id} className={`btn btn-sm ${stpTab===t_tab.id?'btn-primary':'btn-ghost'}`}
                onClick={()=>setStpTab(t_tab.id)} style={{flex:1,minWidth:100}}>{t_tab.l}</button>
            ))}
          </div>

          {stpTab==='variants' && (
            <div className="fadein">
              <div className="card">
                <div className="card-title">{t('switching.stp_variant_comp')}</div>
                <div className="table-wrap hide-mobile"><table>
                  <thead><tr><th>{t('switching.std')}</th><th>{t('switching.name')}</th><th>{t('switching.instances')}</th><th>{t('switching.convergence')}</th><th>{t('switching.bpdu')}</th><th>{t('switching.note')}</th></tr></thead>
                  <tbody>
                    {[
                      ['IEEE 802.1D','STP (Classic)','1 (CST)','30–50 s','v0 Config',t('switching.var_note_8021d')],
                      ['Cisco','PVST+','1 per VLAN','30–50 s','v0 Config',t('switching.var_note_pvst')],
                      ['IEEE 802.1w','RSTP','1 (CST)','< 1–5 s','v2 RST BPDU',t('switching.var_note_rstp')],
                      ['Cisco','Rapid-PVST+','1 per VLAN','< 1–5 s','v2 RST BPDU',t('switching.var_note_rapid_pvst')],
                      ['IEEE 802.1s','MST','Up to 16','< 1–5 s','v3 MST BPDU',t('switching.var_note_mstp')],
                      ['Cisco','MST (Cisco impl)','1–16','< 1–5 s','v3 MST BPDU',t('switching.var_note_mst_boundary')],
                    ].map(([std,name,inst,conv,bpdu,note])=>(
                      <tr key={name}>
                        <td><span className="badge badge-blue">{std}</span></td>
                        <td style={{fontWeight:600}}>{name}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:12}}>{inst}</td>
                        <td style={{color:conv.includes('<')?'var(--green)':'var(--yellow)',fontWeight:600}}>{conv}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:11}}>{bpdu}</td>
                        <td style={{fontSize:12,color:'var(--muted)'}}>{note}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {/* Mobile View */}
                <div className="show-mobile mobile-cards">
                  {[
                    {n:'STP (Classic)', std:'802.1D', c:'30-50s'},
                    {n:'PVST+', std:'Cisco', c:'30-50s'},
                    {n:'RSTP', std:'802.1w', c:'< 1s'},
                    {n:'Rapid-PVST+', std:'Cisco', c:'< 1s'},
                    {n:'MST', std:'802.1s', c:'< 1s'}
                  ].map(v => (
                    <div key={v.n} className="mobile-card">
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{v.n}</span>
                        <span className="badge badge-blue">{v.std}</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('switching.convergence')}</span>
                        <span className="mobile-card-value" style={{color:v.c.includes('<')?'var(--green)':'var(--yellow)', fontWeight:600}}>{v.c}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-title">{t('switching.cost_ref')}</div>
                <div className="table-wrap hide-mobile"><table>
                  <thead><tr><th>{t('switching.link_speed')}</th><th>{t('switching.cost_98')}</th><th>{t('switching.cost_04')}</th></tr></thead>
                  <tbody>
                    {[['10 Mbps','100','2,000,000'],['100 Mbps','19','200,000'],['1 Gbps','4','20,000'],
                      ['2 Gbps','3','10,000'],['10 Gbps','2','2,000'],['100 Gbps','—','200'],['1 Tbps','—','20']].map(([sp,c98,c04])=>(
                      <tr key={sp}>
                        <td>{sp}</td>
                        <td style={{fontFamily:'var(--mono)'}}>{c98}</td>
                        <td style={{fontFamily:'var(--mono)',color:'var(--cyan)'}}>{c04}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {/* Mobile View */}
                <div className="show-mobile mobile-cards">
                  {[['10M','100','2M'],['100M','19','200k'],['1G','4','20k'],['10G','2','2k'],['100G','-','200']].map(([sp,c98,c04]) => (
                    <div key={sp} className="mobile-card">
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{sp}</span>
                        <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{c04} <span style={{color:'var(--muted)', fontSize:10, fontWeight:400}}>{t('switching.cost_long')}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-title">{t('switching.bpdu_fields')}</div>
                <div className="table-wrap hide-mobile"><table>
                  <thead><tr><th>{t('switching.field')}</th><th>{t('switching.size')}</th><th>{t('switching.notes')}</th></tr></thead>
                  <tbody>
                    {[
                      [t('switching.bpdu_protocol_id'),'2 B',t('switching.bpdu_note_protocol')],
                      [t('switching.bpdu_version'),'1 B',t('switching.bpdu_note_version')],
                      [t('switching.bpdu_type'),'1 B',t('switching.bpdu_note_type')],
                      [t('switching.bpdu_flags'),'1 B',t('switching.bpdu_note_flags')],
                      [t('switching.bpdu_root_id'),'8 B',t('switching.bpdu_note_root')],
                      [t('switching.bpdu_root_cost'),'4 B',t('switching.bpdu_note_cost')],
                      [t('switching.bpdu_bridge_id'),'8 B',t('switching.bpdu_note_bridge')],
                      [t('switching.bpdu_port_id'),'2 B',t('switching.bpdu_note_port')],
                      [t('switching.bpdu_msg_age'),'2 B',t('switching.bpdu_note_msgage')],
                      [t('switching.bpdu_max_age'),'2 B',t('switching.bpdu_note_maxage')],
                      [t('switching.bpdu_hello'),'2 B',t('switching.bpdu_note_hello')],
                      [t('switching.bpdu_fwd'),'2 B',t('switching.bpdu_note_fwd')],
                    ].map(([f,sz,n])=>(
                      <tr key={f}>
                        <td style={{fontFamily:'var(--mono)',fontSize:12}}>{f}</td>
                        <td><span className="badge badge-cyan">{sz}</span></td>
                        <td style={{fontSize:12,color:'var(--muted)'}}>{n}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {/* Mobile View */}
                <div className="show-mobile mobile-cards">
                  {[
                    {f:t('switching.bpdu_protocol_id'), s:'2 B', n:'0x0000'},
                    {f:t('switching.bpdu_version'), s:'1 B', n:'0=STP, 2=RSTP'},
                    {f:t('switching.bpdu_type'), s:'1 B', n:'0x00, 0x80, 0x02'},
                    {f:t('switching.bpdu_root_id'), s:'8 B', n:'Pri + MAC'},
                    {f:t('switching.bpdu_root_cost'), s:'4 B', n:'Sum to root'}
                  ].map(b => (
                    <div key={b.f} className="mobile-card">
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{b.f}</span>
                        <span className="badge badge-cyan">{b.s}</span>
                      </div>
                      <div className="mobile-card-row" style={{borderBottom:'none'}}>
                        <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{b.n}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {stpTab==='states' && (
            <div className="fadein">
              <div className="card">
                <div className="card-title">{t('switching.port_states')}</div>
                <div className="table-wrap hide-mobile"><table>
                  <thead><tr><th>{t('switching.state_8021d')}</th><th>{t('switching.state_rstp')}</th><th>{t('switching.bpdu')}s</th><th>{t('switching.learns_macs')}</th><th>{t('switching.forwards_data')}</th><th>{t('switching.duration')}</th></tr></thead>
                  <tbody>
                    {[
                      [t('switching.state_blocking'),t('switching.state_discarding'),t('switching.learns_listens'),t('switching.learns_no'),t('switching.learns_no'),t('switching.dur_maxage'),'var(--red)'],
                      [t('switching.state_listening'),'—',t('switching.learns_yes'),t('switching.learns_no'),t('switching.learns_no'),t('switching.dur_fwddelay'),'var(--yellow)'],
                      [t('switching.state_learning'),t('switching.state_learning'),t('switching.learns_yes'),t('switching.learns_yes'),t('switching.learns_no'),t('switching.dur_fwddelay'),'var(--yellow)'],
                      [t('switching.state_forwarding'),t('switching.state_forwarding'),t('switching.learns_yes'),t('switching.learns_yes'),t('switching.learns_yes'),t('switching.dur_stable'),'var(--green)'],
                      [t('switching.state_disabled'),t('switching.state_discarding'),t('switching.learns_no'),t('switching.learns_no'),t('switching.learns_no'),'—','var(--muted)'],
                    ].map(([s1,s2,bpdu,mac,fwd,dur,col])=>(
                      <tr key={s1}>
                        <td style={{fontWeight:600,color:col}}>{s1}</td>
                        <td style={{color:'var(--muted)'}}>{s2}</td>
                        <td>{bpdu===t('switching.learns_yes')?<span className="badge badge-green">{bpdu}</span>:<span className="badge badge-red">{bpdu}</span>}</td>
                        <td>{mac===t('switching.learns_yes')?<span className="badge badge-green">{mac}</span>:<span className="badge badge-red">{mac}</span>}</td>
                        <td>{fwd===t('switching.learns_yes')?<span className="badge badge-green">{fwd}</span>:<span className="badge badge-red">{fwd}</span>}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:12}}>{dur}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {/* Mobile View */}
                <div className="show-mobile mobile-cards">
                  {[
                    {s:t('switching.state_blocking'), r:t('switching.state_discarding'), f:t('switching.learns_no'), d:'20s', c:'var(--red)'},
                    {s:t('switching.state_listening'), r:'-', f:t('switching.learns_no'), d:'15s', c:'var(--yellow)'},
                    {s:t('switching.state_learning'), r:t('switching.state_learning'), f:t('switching.learns_no'), d:'15s', c:'var(--yellow)'},
                    {s:t('switching.state_forwarding'), r:t('switching.state_forwarding'), f:t('switching.learns_yes'), d:t('switching.dur_stable'), c:'var(--green)'}
                  ].map(p => (
                    <div key={p.s} className="mobile-card" style={{borderLeft:`3px solid ${p.c}`}}>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{p.s} (STP)</span>
                        <span className="mobile-card-value" style={{color:'var(--muted)'}}>{p.r} (RSTP)</span>
                      </div>
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{t('switching.forwards_data')} / {t('switching.duration')}</span>
                        <span className="mobile-card-value">{p.f} / {p.d}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="card">
                <div className="card-title">{t('switching.port_roles')}</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:12}}>
                  {[
                    {role: t('switching.root_port'),col:'var(--cyan)',desc:t('switching.desc_root_port')},
                    {role: t('switching.designated_port'),col:'var(--green)',desc:t('switching.desc_designated_port')},
                    {role: t('switching.alternate_port'),col:'var(--yellow)',desc:t('switching.desc_alternate_port')},
                    {role: t('switching.backup_port'),col:'var(--purple)',desc:t('switching.desc_backup_port')},
                    {role: t('switching.non_designated'),col:'var(--red)',desc:t('switching.desc_non_designated')},
                    {role: t('switching.edge_port'),col:'var(--blue)',desc:t('switching.desc_edge_port')},
                  ].map(({role,col,desc})=>(
                    <div key={role} style={{padding:'12px 14px',border:'1px solid var(--border)',borderLeft:`3px solid ${col}`,borderRadius:'var(--radius)',background:'var(--card)'}}>
                      <div style={{fontWeight:600,color:col,marginBottom:6}}>{role}</div>
                      <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.5}}>{desc}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {stpTab==='timers' && (
            <div className="fadein">
              <div className="card">
                <div className="card-title">{t('switching.timer_cfg')}</div>
                <div className="hint" style={{marginBottom:12}}>{t('switching.timer_hint')}</div>
                <div className="two-col grid-mobile-1" style={{gap:20}}>
                  <div className="field">
                    <label className="label">{t('switching.hello_time')}</label>
                    <input className="input" value={hello} onChange={e=>setHello(e.target.value)} placeholder="2"/>
                    <div className="hint">{t('switching.hello_hint')}</div>
                  </div>
                  <div className="field">
                    <label className="label">{t('switching.fwd_delay')}</label>
                    <input className="input" value={fwdDelay} onChange={e=>setFwdDelay(e.target.value)} placeholder="15"/>
                    <div className="hint">{t('switching.fwd_hint')}</div>
                  </div>
                </div>
                <div className="field" style={{marginTop:12}}>
                  <label className="label">{t('switching.max_age')}</label>
                  <input className="input" value={maxAge} onChange={e=>setMaxAge(e.target.value)} placeholder="20" style={{maxWidth:200}}/>
                  <div className="hint">{t('switching.max_age_hint')}</div>
                </div>
              </div>
              <div className="card fadein">
                <div className="card-title">{t('switching.conv_analysis')}</div>
                <div className="result-grid grid-mobile-1">
                  <ResultItem label={t('switching.max_conv')} value={`${conv8021d} s`}
                    red={conv8021d>50} yellow={conv8021d>30&&conv8021d<=50} green={conv8021d<=30}/>
                  <ResultItem label={t('switching.rstp_worst')} value={`${convRSTP} s`} green/>
                  <ResultItem label={t('switching.listening_fwd')} value={`${2*fwdDelaySec} s`}/>
                  <ResultItem label={t('switching.bpdu_aging')} value={`${maxAgeSec} s`}/>
                </div>
                <div style={{marginTop:16}}>
                  <div className="label" style={{marginBottom:8}}>{t('switching.diameter_timers')}</div>
                  <div className="table-wrap hide-mobile"><table>
                    <thead><tr><th>{t('switching.diameter')}</th><th>{t('switching.hello_time').split('(')[0]}</th><th>{t('switching.fwd_delay').split('(')[0]}</th><th>{t('switching.max_age').split('(')[0]}</th><th>{t('switching.convergence')}</th></tr></thead>
                    <tbody>
                      {[2,3,4,5,6,7].map(d=>{
                        const fd=Math.min(30,Math.ceil((d+2)/2+10)), ma=Math.min(40,Math.ceil(fd*2-2));
                        return (
                          <tr key={d}>
                            <td>{d}{d===2?` ${t('switching.diam_min')}`:d===7?` ${t('switching.diam_cisco_max')}`:''}</td>
                            <td style={{fontFamily:'var(--mono)'}}>2 s</td>
                            <td style={{fontFamily:'var(--mono)'}}>{fd} s</td>
                            <td style={{fontFamily:'var(--mono)'}}>{ma} s</td>
                            <td style={{fontFamily:'var(--mono)',color:'var(--cyan)'}}>{ma+2*fd} s</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table></div>
                  {/* Mobile View */}
                  <div className="show-mobile mobile-cards">
                    {[2,4,7].map(d => {
                      const fd=Math.min(30,Math.ceil((d+2)/2+10)), ma=Math.min(40,Math.ceil(fd*2-2));
                      return (
                        <div key={d} className="mobile-card">
                          <div className="mobile-card-row">
                            <span className="mobile-card-label">{t('switching.diameter')}: {d}</span>
                            <span className="mobile-card-value" style={{fontWeight:600}}>{ma+2*fd}s {t('switching.conv_short')}</span>
                          </div>
                          <div className="mobile-card-row">
                            <span className="mobile-card-label">{t('switching.hello_fwd_max')}</span>
                            <span className="mobile-card-value">2s / {fd}s / {ma}s</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
                <div style={{marginTop:12,padding:'10px 14px',background:'var(--card)',borderRadius:'var(--radius)',border:'1px solid var(--border)',fontFamily:'var(--mono)',fontSize:12}}>
                  <div style={{color:'var(--muted)',marginBottom:4}}>{t('switching.cisco_root_only')}</div>
                  <div style={{color:'var(--cyan)'}}>spanning-tree vlan 1 hello-time {helloSec}</div>
                  <div style={{color:'var(--cyan)'}}>spanning-tree vlan 1 forward-time {fwdDelaySec}</div>
                  <div style={{color:'var(--cyan)'}}>spanning-tree vlan 1 max-age {maxAgeSec}</div>
                </div>
              </div>
            </div>
          )}

          {stpTab==='bridge' && (
            <div className="fadein">
              <div className="card">
                <div className="card-title">{t('switching.bridge_id_builder')}</div>
                <div className="hint" style={{marginBottom:12}}>{t('switching.bridge_id_hint')}</div>
                <div className="two-col grid-mobile-1" style={{gap:20}}>
                  <div className="field">
                    <label className="label">{t('switching.bridge_priority')}</label>
                    <select className="input" value={priority} onChange={e=>setPriority(e.target.value)}>
                      {[0,4096,8192,12288,16384,20480,24576,28672,32768,36864,40960,45056,49152,53248,57344,61440].map(p=>(
                        <option key={p} value={p}>{p}{p===0?` ${t('switching.pri_highest')}`:p===32768?` ${t('switching.pri_default')}`:p===61440?` ${t('switching.pri_lowest')}`:''}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="label">{t('switching.base_mac')}</label>
                    <input className="input" value={macAddr} onChange={e=>setMacAddr(e.target.value)} placeholder="00:1A:2B:3C:4D:5E"/>
                  </div>
                </div>
              </div>
              <div className="card fadein">
                <div className="card-title">{t('switching.bridge_id_vlan1')}</div>
                <div className="result-grid grid-mobile-1">
                  <ResultItem label={t('switching.pri_configured')} value={bridgePri}/>
                  <ResultItem label={t('switching.sys_id_ext')} value="1"/>
                  <ResultItem label={t('switching.effective_pri')} value={bridgePri+1} accent/>
                  <ResultItem label={t('switching.bridge_id_hex')} value={bridgeId}/>
                </div>
              </div>
              <div className="card">
                <div className="card-title">{t('switching.pri_planning')}</div>
                <div className="table-wrap hide-mobile"><table>
                  <thead><tr><th>{t('switching.role')}</th><th>{t('switching.priority')}</th><th>{t('switching.ios_cmd')}</th></tr></thead>
                  <tbody>
                    {[
                      [t('switching.role_primary_root'),'0','spanning-tree vlan X priority 0'],
                      [t('switching.role_secondary_root'),'4096','spanning-tree vlan X priority 4096'],
                      [t('switching.role_distribution'),'16384','spanning-tree vlan X priority 16384'],
                      [t('switching.role_access_default'),'32768',t('switching.role_no_cmd')],
                      [t('switching.role_never_root'),'61440','spanning-tree vlan X priority 61440'],
                      [t('switching.role_auto_primary'),'macro','spanning-tree vlan X root primary'],
                      [t('switching.role_auto_secondary'),'macro','spanning-tree vlan X root secondary'],
                    ].map(([r,p,c])=>(
                      <tr key={r}>
                        <td>{r}</td>
                        <td style={{fontFamily:'var(--mono)'}}>{p}</td>
                        <td style={{fontFamily:'var(--mono)',fontSize:11,color:'var(--cyan)'}}>{c}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {/* Mobile View */}
                <div className="show-mobile mobile-cards">
                  {[
                    {r:t('switching.mobile_primary_root'), p:'0', c:'priority 0'},
                    {r:t('switching.mobile_secondary_root'), p:'4096', c:'priority 4096'},
                    {r:t('switching.mobile_ensure_never'), p:'61440', c:'priority 61440'},
                  ].map(v => (
                    <div key={v.r} className="mobile-card">
                      <div className="mobile-card-row">
                        <span className="mobile-card-label">{v.r}</span>
                        <span className="mobile-card-value" style={{fontWeight:600, color:'var(--cyan)'}}>{v.p}</span>
                      </div>
                      <div className="mobile-card-row" style={{borderBottom:'none'}}>
                        <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:10, fontFamily:'var(--mono)'}}>... {v.c}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {stpTab==='configs' && (
            <div className="fadein">
              <div className="card">
                <div className="card-title">{t('switching.typical_configs')}</div>
                <div className="two-col grid-mobile-1" style={{gap:20}}>
                  <div>
                    <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.access_port')}</strong>
                    <div style={{background:'var(--mono-bg)',padding:10,borderRadius:6,fontFamily:'var(--mono)',fontSize:11,color:'var(--green)',border:'1px solid var(--border)'}}>
                      interface Gi1/0/1<br/>
                      &nbsp;switchport mode access<br/>
                      &nbsp;switchport access vlan 10<br/>
                      &nbsp;<span style={{color:'var(--cyan)'}}>spanning-tree portfast</span><br/>
                      &nbsp;<span style={{color:'var(--yellow)'}}>spanning-tree bpduguard enable</span>
                    </div>
                  </div>
                  <div>
                    <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.trunk_port')}</strong>
                    <div style={{background:'var(--mono-bg)',padding:10,borderRadius:6,fontFamily:'var(--mono)',fontSize:11,color:'var(--green)',border:'1px solid var(--border)'}}>
                      interface Gi1/0/48<br/>
                      &nbsp;switchport trunk encapsulation dot1q<br/>
                      &nbsp;switchport mode trunk<br/>
                      &nbsp;switchport trunk allowed vlan 10,20<br/>
                      &nbsp;switchport trunk native vlan 99
                    </div>
                  </div>
                </div>
                <div className="hint" style={{marginTop:12}}>
                  <strong style={{color:'var(--text)'}}>{t('switching.security_note')}</strong> {t('switching.bpdu_guard_note')}
                </div>
              </div>
              <div className="card">
                <div className="card-title">{t('switching.root_bridge_cfg')}</div>
                <div className="two-col grid-mobile-1" style={{gap:20}}>
                  <div>
                    <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.manual_pri')}</strong>
                    <div style={{background:'var(--mono-bg)',padding:10,borderRadius:6,fontFamily:'var(--mono)',fontSize:11,color:'var(--green)',border:'1px solid var(--border)'}}>
                      <span style={{color:'var(--muted)'}}>{t('switching.cfg_comment_primary')}</span><br/>
                      spanning-tree vlan 10 priority 0<br/><br/>
                      <span style={{color:'var(--muted)'}}>{t('switching.cfg_comment_secondary')}</span><br/>
                      spanning-tree vlan 10 priority 4096
                    </div>
                  </div>
                  <div>
                    <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.macro_cmd')}</strong>
                    <div style={{background:'var(--mono-bg)',padding:10,borderRadius:6,fontFamily:'var(--mono)',fontSize:11,color:'var(--green)',border:'1px solid var(--border)'}}>
                      <span style={{color:'var(--muted)'}}>{t('switching.cfg_comment_auto_primary')}</span><br/>
                      spanning-tree vlan 10 root primary<br/><br/>
                      <span style={{color:'var(--muted)'}}>{t('switching.cfg_comment_auto_sec')}</span><br/>
                      spanning-tree vlan 10 root secondary
                    </div>
                  </div>
                </div>
              </div>
              <div className="card">
                <div className="card-title">{t('switching.verif_cmds')}</div>
                <div className="table-wrap hide-mobile"><table>
                  <thead><tr><th>{t('switching.command')}</th><th>{t('switching.purpose')}</th></tr></thead>
                  <tbody>
                    {[
                      ['show spanning-tree',t('switching.verif_stp_state')],
                      ['show spanning-tree vlan X detail',t('switching.verif_stp_detail')],
                      ['show spanning-tree summary',t('switching.verif_stp_summary')],
                      ['show spanning-tree inconsistentports',t('switching.verif_stp_inconsistent')],
                      ['debug spanning-tree events',t('switching.verif_stp_debug')],
                    ].map(([cmd,desc])=>(
                      <tr key={cmd}>
                        <td style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--cyan)'}}>{cmd}</td>
                        <td style={{fontSize:12,color:'var(--muted)'}}>{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
                {/* Mobile View */}
                <div className="show-mobile mobile-cards">
                  {[
                    ['show spanning-tree', t('switching.mob_verif_general')],
                    ['show spanning-tree vlan X', t('switching.mob_verif_vlan')],
                    ['show spanning-tree summary', t('switching.mob_verif_summary')],
                    ['show spanning-tree inconsistent', t('switching.mob_verif_error')]
                  ].map(([cmd, desc]) => (
                    <div key={cmd} className="mobile-card">
                      <div className="mobile-card-row">
                        <span className="mobile-card-value" style={{color:'var(--cyan)', fontFamily:'var(--mono)', textAlign:'left', paddingLeft:0}}>{cmd}</span>
                      </div>
                      <div className="mobile-card-row" style={{borderBottom:'none'}}>
                        <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{desc}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── ETHERCHANNEL TAB ── */}
      {tab==='ether' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('switching.lacp_pagp_static')}</div>
            <div className="table-wrap hide-mobile"><table>
              <thead><tr><th>{t('switching.feature')}</th><th>{t('switching.ether_lacp_header')}</th><th>{t('switching.ether_pagp_header')}</th><th>{t('switching.ether_static_header')}</th></tr></thead>
              <tbody>
                {[
                  [t('switching.std'),t('switching.val_ieee_open'),t('switching.val_cisco_proprietary'),t('switching.val_manual_none')],
                  [t('switching.active_mode'),t('switching.val_active'),t('switching.val_desirable'),t('switching.val_on')],
                  [t('switching.passive_mode'),t('switching.val_passive'),t('switching.val_auto'),'—'],
                  [t('switching.max_active_ports'),t('switching.val_8plus8'),t('switching.val_8'),t('switching.val_8')],
                  [t('switching.negotiation'),t('switching.val_pdu_yes'),t('switching.val_pdu_yes'),t('switching.val_none')],
                  [t('switching.interop'),t('switching.val_ieee_any'),t('switching.val_cisco_only'),t('switching.val_cisco_only')],
                  [t('switching.hot_standby'),t('switching.val_standby_yes'),t('switching.val_none'),t('switching.val_none')],
                ].map(([f,l,p,s])=>(
                  <tr key={f}>
                    <td style={{fontWeight:600}}>{f}</td>
                    <td style={{color:f===t('switching.active_mode')?'var(--green)':f===t('switching.std')?'var(--cyan)':'inherit'}}>{l}</td>
                    <td style={{color:f===t('switching.active_mode')?'var(--green)':'inherit'}}>{p}</td>
                    <td style={{color:f===t('switching.active_mode')?'var(--cyan)':'inherit'}}>{s}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              {[
                {f: t('switching.std'), l:t('switching.mob_ieee_open'), p:'Cisco'},
                {f: t('switching.active_mode'), l:t('switching.val_active'), p:t('switching.val_desirable')},
                {f: t('switching.negotiation'), l:t('switching.mob_pdu_yes'), p:t('switching.mob_pdu_yes')}
              ].map(f => (
                <div key={f.f} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{f.f}</span>
                    <span className="mobile-card-value" style={{fontWeight:600}}>{f.l} <span style={{fontWeight:400, color:'var(--muted)'}}>(LACP)</span></span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-value" style={{marginLeft:'auto', fontWeight:600}}>{f.p} <span style={{fontWeight:400, color:'var(--muted)'}}>(PAgP)</span></span>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="card">
            <div className="card-title">{t('switching.mode_matrix')}</div>
            <div className="table-wrap hide-mobile"><table>
              <thead><tr><th>{t('switching.side_a_b')}</th><th>{t('switching.active_mode').split(' ')[0]}</th><th>{t('switching.passive_mode').split(' ')[0]}</th><th>On</th></tr></thead>
              <tbody>
                {[
                  ['Active',t('switching.forms'),t('switching.forms'),t('switching.no_form')],
                  ['Passive',t('switching.forms'),t('switching.no_form'),t('switching.no_form')],
                  ['On',t('switching.no_form'),t('switching.no_form'),t('switching.forms')],
                ].map(([mode,...cells])=>(
                  <tr key={mode}>
                    <td style={{fontWeight:600}}>{mode}</td>
                    {cells.map((c,i)=>(
                      <td key={i} style={{color:c.startsWith('✓')?'var(--green)':'var(--red)',fontWeight:600}}>{c}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table></div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              {[
                {a:'Active', b:'Active / Passive', s:t('switching.forms')},
                {a:'Active', b:'On', s:t('switching.no_form')},
                {a:'Passive', b:'Passive', s:t('switching.no_form')},
                {a:'On', b:'On', s:t('switching.forms')}
              ].map((r,i) => (
                <div key={i} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{r.a} + {r.b}</span>
                    <span className="mobile-card-value" style={{color:r.s.startsWith('✓')?'var(--green)':'var(--red)', fontWeight:600}}>{r.s}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="hint" style={{marginTop:10}}>{t('switching.matrix_hint')}</div>
          </div>
          <div className="card">
            <div className="card-title">{t('switching.lb_methods')}</div>
            <div className="table-wrap hide-mobile"><table>
              <thead><tr><th>{t('switching.method')}</th><th>{t('switching.command')}</th><th>{t('switching.best_for')}</th></tr></thead>
              <tbody>
                {[
                  [t('switching.lb_src_mac'),'src-mac',t('switching.lb_use_l2')],
                  [t('switching.lb_dst_mac'),'dst-mac',t('switching.lb_use_server_gw')],
                  [t('switching.lb_src_dst_mac'),'src-dst-mac',t('switching.lb_use_mixed_l2')],
                  [t('switching.lb_src_ip'),'src-ip',t('switching.lb_use_multi_client')],
                  [t('switching.lb_dst_ip'),'dst-ip',t('switching.lb_use_multi_server')],
                  [t('switching.lb_src_dst_ip'),'src-dst-ip',t('switching.lb_use_routed')],
                  [t('switching.lb_src_dst_ip_port'),'src-dst-mixed-ip-port',t('switching.lb_use_l4')],
                ].map(([m,cmd,use])=>(
                  <tr key={m}>
                    <td style={{fontWeight:600}}>{m}</td>
                    <td style={{fontFamily:'var(--mono)',fontSize:12,color:'var(--cyan)'}}>{cmd}</td>
                    <td style={{fontSize:12,color:'var(--muted)'}}>{use}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              {[
                {m:t('switching.lb_src_dst_ip'), c:'src-dst-ip', u:t('switching.mob_lb_routed')},
                {m:t('switching.lb_src_dst_ip_port'), c:'src-dst-mixed-ip-port', u:t('switching.mob_lb_l4')},
                {m:t('switching.lb_src_mac'), c:'src-mac', u:t('switching.mob_lb_l2')}
              ].map(v => (
                <div key={v.m} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{v.m}</span>
                    <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600, fontFamily:'var(--mono)', fontSize:10}}>{v.c}</span>
                  </div>
                  <div className="mobile-card-row" style={{borderBottom:'none'}}>
                    <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{v.u}</span>
                  </div>
                </div>
              ))}
            </div>
            <div style={{marginTop:12,padding:'10px 14px',background:'var(--card)',borderRadius:'var(--radius)',border:'1px solid var(--border)',fontFamily:'var(--mono)',fontSize:12}}>
              <div style={{color:'var(--muted)',marginBottom:4}}>{t('switching.ether_cisco_ios')}</div>
              <div style={{color:'var(--cyan)'}}>port-channel load-balance src-dst-ip</div>
              <div style={{color:'var(--muted)',marginTop:8,marginBottom:4}}>{t('switching.ether_verify_hash')}</div>
              <div style={{color:'var(--cyan)'}}>test etherchannel load-balance interface Po1 ip 10.1.1.1 10.2.2.2</div>
            </div>
          </div>
          <div className="card">
            <div className="card-title">{t('switching.etherchannel_cfg')}</div>
            <div className="two-col grid-mobile-1" style={{gap:20}}>
              <div>
                <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.lacp_active')}</strong>
                <div style={{background:'var(--mono-bg)',padding:10,borderRadius:6,fontFamily:'var(--mono)',fontSize:11,color:'var(--green)',border:'1px solid var(--border)'}}>
                  interface range Gi1/0/1-2<br/>
                  &nbsp;channel-group 1 mode active<br/>
                  &nbsp;channel-protocol lacp<br/><br/>
                  interface Port-channel1<br/>
                  &nbsp;switchport mode trunk<br/>
                  &nbsp;switchport trunk allowed vlan 10,20
                </div>
              </div>
              <div>
                <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.verification')}</strong>
                <div style={{background:'var(--mono-bg)',padding:10,borderRadius:6,fontFamily:'var(--mono)',fontSize:11,color:'var(--green)',border:'1px solid var(--border)'}}>
                  show etherchannel summary<br/>
                  show etherchannel 1 detail<br/>
                  show lacp neighbor<br/>
                  show interfaces Po1 trunk
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── vPC TAB ── */}
      {tab==='vpc' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title" style={{color:'var(--cyan)'}}>{t('switching.vpc_nexus')}</div>
            <div className="two-col grid-mobile-1" style={{gap:20}}>
              <div>
                <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.core_components')}</strong>
                <ul style={{fontSize:12,color:'var(--muted)',lineHeight:1.7,paddingLeft:16}}>
                  <li><strong style={{color:'var(--cyan)'}}>vPC Peer-Link:</strong> {t('switching.vpc_peer_link_desc')}</li>
                  <li><strong style={{color:'var(--cyan)'}}>vPC Peer-Keepalive:</strong> {t('switching.vpc_keepalive_desc')}</li>
                  <li><strong style={{color:'var(--cyan)'}}>vPC Domain:</strong> {t('switching.vpc_domain_desc')}</li>
                  <li><strong style={{color:'var(--cyan)'}}>vPC Member Port:</strong> {t('switching.vpc_member_desc')}</li>
                </ul>
              </div>
              <div>
                <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.consistency_checks')}</strong>
                <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.6}}>
                  <div style={{marginBottom:8,padding:8,background:'rgba(239,68,68,0.1)',borderRadius:6,border:'1px solid rgba(239,68,68,0.2)'}}>
                    <strong style={{color:'var(--red)'}}>Type 1 (Critical):</strong> {t('switching.vpc_type1_desc')}
                  </div>
                  <div style={{padding:8,background:'rgba(245,158,11,0.1)',borderRadius:6,border:'1px solid rgba(245,158,11,0.2)'}}>
                    <strong style={{color:'var(--yellow)'}}>Type 2 (Warning):</strong> {t('switching.vpc_type2_desc')}
                  </div>
                </div>
              </div>
            </div>
            <div style={{marginTop:16,background:'var(--panel)',padding:12,borderRadius:8,border:'1px solid var(--border)'}}>
              <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:6}}>{t('switching.key_features')}</strong>
              <div className="result-grid" style={{gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))'}}>
                <ResultItem label={t('switching.vpc_peer_gw_label')} value={t('switching.vpc_peer_gw_val')}/>
                <ResultItem label={t('switching.vpc_peer_sw_label')} value={t('switching.vpc_peer_sw_val')}/>
                <ResultItem label={t('switching.vpc_auto_rec_label')} value={t('switching.vpc_auto_rec_val')}/>
                <ResultItem label={t('switching.vpc_delay_label')} value={t('switching.vpc_delay_val')}/>
              </div>
            </div>
          </div>
          <div className="card">
            <div className="two-col grid-mobile-1" style={{gap:20}}>
              <div>
                <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.vpc_data_rule')}</strong>
                <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7,padding:10,background:'rgba(6,182,212,0.05)',borderRadius:6,border:'1px solid var(--border)'}}>
                  <strong style={{color:'var(--cyan)'}}>{t('switching.the_rule')}</strong> {t('switching.rule_desc')}<br/><br/>
                  <strong style={{color:'var(--text)'}}>{t('switching.why')}</strong> {t('switching.why_desc')}
                </div>
              </div>
              <div>
                <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.orphan_ports')}</strong>
                <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7,padding:10,background:'rgba(245,158,11,0.05)',borderRadius:6,border:'1px solid var(--border)'}}>
                  {t('switching.orphan_desc')}<br/><br/>
                  <strong style={{color:'var(--text)'}}>{t('switching.risk')}</strong> {t('switching.risk_desc')}<br/><br/>
                  <strong style={{color:'var(--text)'}}>{t('switching.fix')}</strong> {t('switching.fix_desc')}
                </div>
              </div>
            </div>
            <div style={{marginTop:16}}>
              <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.hsrp_peer_gw')}</strong>
              <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
                {t('switching.hsrp_desc')}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-title">{t('switching.vpc_skeleton')}</div>
            <div className="two-col grid-mobile-1" style={{gap:20}}>
              <div>
                <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.domain_keepalive')}</strong>
                <div style={{background:'var(--mono-bg)',padding:10,borderRadius:6,fontFamily:'var(--mono)',fontSize:11,color:'var(--green)',border:'1px solid var(--border)'}}>
                  <span style={{color:'var(--muted)'}}>{t('switching.vpc_both_peers')}</span><br/>
                  feature vpc<br/>
                  feature lacp<br/><br/>
                  vpc domain 10<br/>
                  &nbsp;peer-keepalive destination 192.168.1.2<br/>
                  &nbsp;&nbsp;source 192.168.1.1 vrf management<br/>
                  &nbsp;peer-gateway<br/>
                  &nbsp;auto-recovery
                </div>
              </div>
              <div>
                <strong style={{color:'var(--text)',fontSize:13,display:'block',marginBottom:8}}>{t('switching.peer_member')}</strong>
                <div style={{background:'var(--mono-bg)',padding:10,borderRadius:6,fontFamily:'var(--mono)',fontSize:11,color:'var(--green)',border:'1px solid var(--border)'}}>
                  <span style={{color:'var(--muted)'}}>{t('switching.vpc_peer_link_cmt')}</span><br/>
                  interface port-channel1<br/>
                  &nbsp;vpc peer-link<br/><br/>
                  <span style={{color:'var(--muted)'}}>{t('switching.vpc_member_cmt')}</span><br/>
                  interface port-channel10<br/>
                  &nbsp;vpc 10
                </div>
              </div>
            </div>
            <div style={{marginTop:12,padding:'10px 14px',background:'var(--card)',borderRadius:'var(--radius)',border:'1px solid var(--border)',fontFamily:'var(--mono)',fontSize:12}}>
              <div style={{color:'var(--muted)',marginBottom:4}}># {t('switching.key_verif')}</div>
              {['show vpc','show vpc consistency-parameters','show vpc peer-keepalive','show vpc role'].map(c=>(
                <div key={c} style={{color:'var(--cyan)'}}>{c}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Arcade Hub ───────────────────────────────────────────────
window.SwitchingRef = SwitchingRef;
