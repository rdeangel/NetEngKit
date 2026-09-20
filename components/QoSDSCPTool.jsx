const { useState, useEffect, useCallback, useRef, useMemo } = React;

function QoSDSCPTool({ onShare, initialData, onNav }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('qos:activeTab', initialData?.activeTab ?? 'dscp');
  const [dscpInput, setDscpInput] = usePersistentState('qos:dscpInput', initialData?.dscpInput ?? 'EF');

  // Latency State
  const [pktSize, setPktSize] = usePersistentState('qos:pktSize', initialData?.pktSize ?? 1500);
  const [linkSpeed, setLinkSpeed] = usePersistentState('qos:linkSpeed', initialData?.linkSpeed ?? 100); // Mbps
  const [distance, setDistance] = usePersistentState('qos:distance', initialData?.distance ?? 1000); // km

  // VoIP State
  const [codec, setCodec] = usePersistentState('qos:codec', initialData?.codec ?? 'g711');
  const [loss, setLoss] = usePersistentState('qos:loss', initialData?.loss ?? 0);
  const [jitter, setJitter] = usePersistentState('qos:jitter', initialData?.jitter ?? 20);
  const [latency, setLatency] = usePersistentState('qos:latency', initialData?.latency ?? 100);

  // Policer State
  const [cir, setCir] = usePersistentState('qos:cir', initialData?.cir ?? 1000); // kbps
  const [bc, setBc] = usePersistentState('qos:bc', initialData?.bc ?? 8000); // bits

  // CBWFQ/Shaping State
  const [cbwfqIntBw, setCbwfqIntBw] = usePersistentState('qos:cbwfqIntBw', initialData?.cbwfqIntBw ?? '1000'); // Mbps
  const [cbwfqBwUnit, setCbwfqBwUnit] = usePersistentState('qos:cbwfqBwUnit', initialData?.cbwfqBwUnit ?? 'Mbps');
  const [cbwfqTc, setCbwfqTc] = usePersistentState('qos:cbwfqTc', initialData?.cbwfqTc ?? '4'); // ms
  const [cbwfqMode, setCbwfqMode] = usePersistentState('qos:cbwfqMode', initialData?.cbwfqMode ?? 'average'); // average|peak
  const [cbwfqClasses, setCbwfqClasses] = usePersistentState('qos:cbwfqClasses', () => {
    if (initialData?.cbwfqClasses?.length) return initialData.cbwfqClasses;
    return [
      { id: 'c1', name: 'VOICE', type: 'priority', pct: '10' },
      { id: 'c2', name: 'VIDEO', type: 'bandwidth', pct: '20' },
      { id: 'c3', name: 'DATA', type: 'bandwidth', pct: '30' },
    ];
  });
  const skipNavReport = useRef(false);

  useEffect(() => {
    if (!initialData) return;
    if (initialData.activeTab !== undefined && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
    if (initialData.dscpInput !== undefined) setDscpInput(initialData.dscpInput);
    if (initialData.pktSize !== undefined) setPktSize(initialData.pktSize);
    if (initialData.linkSpeed !== undefined) setLinkSpeed(initialData.linkSpeed);
    if (initialData.distance !== undefined) setDistance(initialData.distance);
    if (initialData.codec !== undefined) setCodec(initialData.codec);
    if (initialData.loss !== undefined) setLoss(initialData.loss);
    if (initialData.jitter !== undefined) setJitter(initialData.jitter);
    if (initialData.latency !== undefined) setLatency(initialData.latency);
    if (initialData.cir !== undefined) setCir(initialData.cir);
    if (initialData.bc !== undefined) setBc(initialData.bc);
    if (initialData.cbwfqIntBw !== undefined) setCbwfqIntBw(initialData.cbwfqIntBw);
    if (initialData.cbwfqBwUnit !== undefined) setCbwfqBwUnit(initialData.cbwfqBwUnit);
    if (initialData.cbwfqTc !== undefined) setCbwfqTc(initialData.cbwfqTc);
    if (initialData.cbwfqMode !== undefined) setCbwfqMode(initialData.cbwfqMode);
    if (initialData.cbwfqClasses !== undefined) setCbwfqClasses(initialData.cbwfqClasses);
  }, [initialData]);

  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (dscpInput || pktSize || codec || cir) {
        (e.detail?.respond ?? onShare)({ tool: 'qos-tool', activeTab, dscpInput, pktSize, linkSpeed, distance, codec, loss, jitter, latency, cir, bc });
      }
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [activeTab, dscpInput, pktSize, linkSpeed, distance, codec, loss, jitter, latency, cir, bc, onShare]);

  const dscpMap = {
    'CS0':0,'BE':0,'CS1':8,'AF11':10,'AF12':12,'AF13':14,'CS2':16,'AF21':18,'AF22':20,'AF23':22,
    'CS3':24,'AF31':26,'AF32':28,'AF33':30,'CS4':32,'AF41':34,'AF42':36,'AF43':38,'CS5':40,'EF':46,'CS6':48,'CS7':56
  };

  const getDscpVal = () => {
    const v = dscpMap[dscpInput.toUpperCase()];
    return v !== undefined ? v : parseInt(dscpInput) || 0;
  };

  const calcMOS = () => {
    const effLatency = latency + (jitter * 2) + 10;
    let r = 0;
    if (effLatency < 160) r = 94.2 - (effLatency / 40);
    else r = 94.2 - (effLatency - 120) / 10;
    r = r - (loss * 2.5);
    const mos = 1 + (0.035) * r + (0.000007) * r * (r-60) * (100-r);
    return Math.max(1, Math.min(4.5, mos)).toFixed(2);
  };

  const getMOSLabel = (m) => {
    if (m >= 4.0) return { t:t('qos_tool.excellent'), c:'var(--green)' };
    if (m >= 3.0) return { t:t('qos_tool.good_fair'), c:'var(--cyan)' };
    if (m >= 2.0) return { t:t('qos_tool.poor'), c:'var(--yellow)' };
    return { t:t('qos_tool.unusable'), c:'var(--red)' };
  };

  return (
    <div className="fadein">
      <div style={{display:'flex', gap:8, marginBottom:20, flexWrap:'wrap'}}>
        {[
          {id:'dscp', l:t('qos_tool.dscp_decoder')},
          {id:'delay', l:t('qos_tool.delay_latency')},
          {id:'voip', l:t('qos_tool.voip_mos')},
          {id:'bucket', l:t('qos_tool.token_bucket')},
          {id:'cbwfq', l:t('qos_tool.cbwfq_shaping')}
        ].map(tab => (
          <button key={tab.id} className={'btn btn-sm ' + (activeTab===tab.id?'btn-primary':'btn-ghost')} onClick={()=>setActiveTab(tab.id)}>
            {tab.l}
          </button>
        ))}
      </div>

      {activeTab === 'dscp' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('qos_tool.title_dscp')}</div>
            <div className="two-col grid-mobile-1" style={{gap:20}}>
              <div className="field">
                <label className="label">{t('qos_tool.std_dscp_phb')}</label>
                <select className="input" value={dscpInput} onChange={e => setDscpInput(e.target.value)}>
                  <optgroup label={t('qos_tool.best_effort')}>
                    <option value="BE">BE / CS0 (0)</option>
                  </optgroup>
                  <optgroup label={t('qos_tool.expedited_forwarding')}>
                    <option value="EF">EF (46)</option>
                  </optgroup>
                  <optgroup label={t('qos_tool.class_selector')}>
                    <option value="CS1">CS1 (8)</option>
                    <option value="CS2">CS2 (16)</option>
                    <option value="CS3">CS3 (24)</option>
                    <option value="CS4">CS4 (32)</option>
                    <option value="CS5">CS5 (40)</option>
                    <option value="CS6">CS6 (48)</option>
                    <option value="CS7">CS7 (56)</option>
                  </optgroup>
                  <optgroup label={t('qos_tool.af_class4')}>
                    <option value="AF41">AF41 (34) - {t('qos_tool.af_high_drop')}</option>
                    <option value="AF42">AF42 (36) - {t('qos_tool.af_med_drop')}</option>
                    <option value="AF43">AF43 (38) - {t('qos_tool.af_low_drop')}</option>
                  </optgroup>
                  <optgroup label={t('qos_tool.af_class3')}>
                    <option value="AF31">AF31 (26)</option>
                    <option value="AF32">AF32 (28)</option>
                    <option value="AF33">AF33 (30)</option>
                  </optgroup>
                  <optgroup label={t('qos_tool.af_class2')}>
                    <option value="AF21">AF21 (18)</option>
                    <option value="AF22">AF20 (20)</option>
                    <option value="AF23">AF23 (22)</option>
                  </optgroup>
                  <optgroup label={t('qos_tool.af_class1')}>
                    <option value="AF11">AF11 (10)</option>
                    <option value="AF12">AF12 (12)</option>
                    <option value="AF13">AF13 (14)</option>
                  </optgroup>
                </select>
              </div>
              <div className="field">
                <label className="label">{t('qos_tool.custom_decimal')}</label>
                <input className="input" type="number" min="0" max="63" value={getDscpVal()} onChange={e => setDscpInput(e.target.value)} />
              </div>
            </div>

            <div style={{marginTop:20}}>
              <div className="label" style={{marginBottom:10, textAlign:'center'}}>{t('qos_tool.tos_structure')}</div>
              <div style={{display:'flex', gap:2, background:'var(--border)', padding:2, borderRadius:6, overflow:'hidden', border:'1px solid var(--border)'}}>
                {[...Array(8)].map((_, i) => (
                  <div key={i} style={{
                    flex:1, height:50, background: i < 6 ? 'rgba(0, 212, 200, 0.1)' : 'rgba(167, 139, 250, 0.1)',
                    display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
                    borderRight: i === 5 ? '2px solid var(--purple)' : 'none'
                  }}>
                    <div style={{fontSize:9, color:'var(--dim)'}}>{i}</div>
                    <div style={{fontSize:16, fontWeight:700, color: i < 6 ? 'var(--cyan)' : 'var(--purple)'}}>
                      {i < 6 ? (getDscpVal().toString(2).padStart(6,'0')[i]) : '0'}
                    </div>
                  </div>
                ))}
              </div>
              <div className="grid-mobile-1" style={{display:'flex', justifyContent:'space-between', marginTop:8, fontSize:10}}>
                <div style={{color:'var(--cyan)'}}>{t('qos_tool.dscp_bits')}</div>
                <div style={{color:'var(--purple)'}}>{t('qos_tool.ecn_bits')}</div>
              </div>
            </div>
            <div className="result-grid grid-mobile-1" style={{marginTop:24}}>
              <ResultItem label={t('qos_tool.tos_hex')} value={'0x' + (getDscpVal() << 2).toString(16).toUpperCase().padStart(2,'0')} />
              <ResultItem label={t('qos_tool.ip_precedence')} value={Math.floor(getDscpVal() / 8)} />
              <ResultItem label={t('qos_tool.cos_mapping')} value={Math.floor(getDscpVal() / 8)} />
            </div>
          </div>
          <div className="card">
            <div className="card-title">{t('qos_tool.std_app_markings')} <span style={{color:'var(--purple)', marginLeft:4}}>(<RFCLink rfc="RFC 4594" />)</span></div>
            <div className="table-wrap hide-mobile">
              <table>
                <thead><tr><th>{t('qos_tool.app_type')}</th><th>{t('qos_tool.th_dscp', 'DSCP')}</th><th>{t('qos_tool.dec')}</th><th>{t('qos_tool.cos')}</th><th>{t('qos_tool.priority')}</th></tr></thead>
                <tbody style={{fontSize:11, color:'var(--muted)'}}>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.network_control')}</td><td>CS6</td><td>48</td><td>6</td><td>{t('qos_tool.critical')}</td></tr>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.voice_voip')}</td><td>EF</td><td>46</td><td>5</td><td>{t('qos_tool.highest')}</td></tr>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.broadcast_video')}</td><td>CS4</td><td>32</td><td>4</td><td>{t('qos_tool.high')}</td></tr>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.realtime_interactive')}</td><td>AF41</td><td>34</td><td>4</td><td>{t('qos_tool.high')}</td></tr>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.multimedia_streaming')}</td><td>AF31</td><td>26</td><td>3</td><td>{t('qos_tool.medium')}</td></tr>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.signaling')}</td><td>CS3</td><td>24</td><td>3</td><td>{t('qos_tool.medium')}</td></tr>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.transactional_data')}</td><td>AF21</td><td>18</td><td>2</td><td>{t('qos_tool.normal')}</td></tr>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.bulk_data')}</td><td>AF11</td><td>10</td><td>1</td><td>{t('qos_tool.low')}</td></tr>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.scavenger')}</td><td>CS1</td><td>8</td><td>1</td><td>{t('qos_tool.lowest')}</td></tr>
                  <tr><td style={{color:'var(--text)'}}>{t('qos_tool.best_effort')}</td><td>BE</td><td>0</td><td>0</td><td>{t('qos_tool.none')}</td></tr>
                </tbody>
              </table>
            </div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              {[
                {a:t('qos_tool.network_control'), d:'CS6', dec:48, p:t('qos_tool.critical')},
                {a:t('qos_tool.voice_voip'), d:'EF', dec:46, p:t('qos_tool.highest')},
                {a:t('qos_tool.broadcast_video'), d:'CS4', dec:32, p:t('qos_tool.high')},
                {a:t('qos_tool.realtime_interactive'), d:'AF41', dec:34, p:t('qos_tool.high')},
                {a:t('qos_tool.multimedia_streaming'), d:'AF31', dec:26, p:t('qos_tool.medium')},
                {a:t('qos_tool.signaling'), d:'CS3', dec:24, p:t('qos_tool.medium')},
                {a:t('qos_tool.transactional_data'), d:'AF21', dec:18, p:t('qos_tool.normal')},
                {a:t('qos_tool.bulk_data'), d:'AF11', dec:10, p:t('qos_tool.low')},
                {a:t('qos_tool.scavenger'), d:'CS1', dec:8, p:t('qos_tool.lowest')},
                {a:t('qos_tool.best_effort'), d:'BE', dec:0, p:t('qos_tool.none')}
              ].map(m => (
                <div key={m.a} className="mobile-card">
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{m.a}</span>
                    <span className="mobile-card-value" style={{fontWeight:600}}>{m.d} ({m.dec})</span>
                  </div>
                  <div className="mobile-card-row">
                    <span className="mobile-card-label">{t('qos_tool.priority')}</span>
                    <span className="mobile-card-value" style={{color:m.p===t('qos_tool.critical')||m.p===t('qos_tool.highest')?'var(--red)':m.p.includes(t('qos_tool.high'))?'var(--yellow)':'inherit'}}>{m.p}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'delay' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('qos_tool.serialization_propagation')}</div>
            <div className="result-grid grid-mobile-1" style={{marginBottom:20}}>
              <div className="field">
                <label className="label">{t('qos_tool.packet_size')}</label>
                <input type="number" className="input" value={pktSize} onChange={e=>setPktSize(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('qos_tool.link_speed_mbps')}</label>
                <input type="number" className="input" value={linkSpeed} onChange={e=>setLinkSpeed(e.target.value)} />
              </div>
              <div className="field">
                <label className="label">{t('qos_tool.distance_km')}</label>
                <input type="number" className="input" value={distance} onChange={e=>setDistance(e.target.value)} />
              </div>
            </div>

            {/* Formulas:
                Serialization = (Size * 8) / Speed
                Propagation = Distance / (300,000 * 0.7)
            */}
            <div className="result-grid grid-mobile-1">
              <ResultItem label={t('qos_tool.serialization_delay')} value={`${((pktSize * 8) / (linkSpeed * 1000)).toFixed(3)} ms`} accent />
              <ResultItem label={t('qos_tool.propagation_delay')} value={`${(distance / 210).toFixed(3)} ms`} />
              <ResultItem label={t('qos_tool.total_delay')} value={`${(((pktSize * 8) / (linkSpeed * 1000)) + (distance / 210)).toFixed(3)} ms`} green />
            </div>
            <div className="hint" style={{marginTop:12}}>{t('qos_tool.delay_hint')}</div>
          </div>
        </div>
      )}

      {activeTab === 'voip' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('qos_tool.voip_estimator')}</div>
            <div className="result-grid grid-mobile-1" style={{marginBottom:20}}>
              <div className="field">
                <label className="label">{t('qos_tool.codec')}</label>
                <select className="input" value={codec} onChange={e=>setCodec(e.target.value)}>
                  <option value="g711">{t('qos_tool.codec_g711', 'G.711 (64k - Uncompressed)')}</option>
                  <option value="g729">{t('qos_tool.codec_g729', 'G.729 (8k - Compressed)')}</option>
                  <option value="opus">{t('qos_tool.codec_opus', 'Opus (Variable)')}</option>
                </select>
              </div>
              <div className="field">
                <label className="label">{t('qos_tool.latency_ms')}</label>
                <input type="number" className="input" value={latency} onChange={e=>setLatency(parseInt(e.target.value))} />
              </div>
              <div className="field">
                <label className="label">{t('qos_tool.jitter_ms')}</label>
                <input type="number" className="input" value={jitter} onChange={e=>setJitter(parseInt(e.target.value))} />
              </div>
              <div className="field">
                <label className="label">{t('qos_tool.packet_loss_pct')}</label>
                <input type="number" className="input" value={loss} onChange={e=>setLoss(parseFloat(e.target.value))} />
              </div>
            </div>

            <div style={{textAlign:'center', padding:24, background:'var(--panel)', borderRadius:12, border:`1px solid ${getMOSLabel(calcMOS()).c}`}}>
              <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', marginBottom:4}}>{t('qos_tool.est_mos_score')}</div>
              <div style={{fontSize:42, fontWeight:700, color:getMOSLabel(calcMOS()).c}}>{calcMOS()}</div>
              <div style={{fontSize:14, fontWeight:600, color:getMOSLabel(calcMOS()).c, marginTop:4}}>{getMOSLabel(calcMOS()).t}</div>
            </div>

            <div className="result-grid grid-mobile-1" style={{marginTop:24}}>
              <ResultItem label={t('qos_tool.bandwidth_call')} value={codec === 'g711' ? '87.2 kbps' : '31.2 kbps'} />
              <ResultItem label={t('qos_tool.payload_size')} value={codec === 'g711' ? '160B' : '20B'} />
              <ResultItem label={t('qos_tool.calls_per_10mbps')} value={codec === 'g711' ? '114' : '320'} />
            </div>
          </div>
        </div>
      )}

      {activeTab === 'bucket' && (
        <div className="fadein">
          <div className="card">
            <div className="card-title">{t('qos_tool.title_bucket')}</div>
            <div className="result-grid grid-mobile-1" style={{marginBottom:20}}>
              <div className="field">
                <label className="label">{t('qos_tool.cir_kbps')}</label>
                <input type="number" className="input" value={cir} onChange={e=>setCir(parseInt(e.target.value))} />
              </div>
              <div className="field">
                <label className="label">{t('qos_tool.bc_bits')}</label>
                <input type="number" className="input" value={bc} onChange={e=>setBc(parseInt(e.target.value))} />
              </div>
            </div>
            <div className="result-grid grid-mobile-1">
              <ResultItem label={t('qos_tool.tc_interval')} value={`${(bc / cir).toFixed(2)} ms`} accent />
              <ResultItem label={t('qos_tool.tokens_per_tc')} value={bc} />
              <ResultItem label={t('qos_tool.impact')} value={bc/cir < 10 ? t('qos_tool.high_cpu') : t('qos_tool.normal')} />
            </div>
            <div style={{marginTop:20, padding:15, background:'var(--panel)', borderRadius:8, border:'1px solid var(--border)', fontSize:12, lineHeight:1.6}}>
              <strong style={{color:'var(--cyan)'}}>{t('qos_tool.cisco_logic')}</strong><br/>
              {t('qos_tool.policer_desc')}
              <br/><br/>
              <code style={{color:'var(--dim)'}}>Tc = Bc / CIR</code>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'cbwfq' && (() => {
        // CBWFQ/Shaping Calculator
        const intBwVal = parseFloat(cbwfqIntBw) || 0;
        const intBwKbps = cbwfqBwUnit === 'Gbps' ? intBwVal * 1e6 : cbwfqBwUnit === 'Kbps' ? intBwVal : intBwVal * 1000;
        const tcMs = parseFloat(cbwfqTc) || 4;
        const tcSec = tcMs / 1000;

        // Calculate class bandwidths
        const priorityClasses = cbwfqClasses.filter(c => c.type === 'priority');
        const bwClasses = cbwfqClasses.filter(c => c.type === 'bandwidth');
        const totalPriorityPct = priorityClasses.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);
        const totalBwPct = bwClasses.reduce((s, c) => s + (parseFloat(c.pct) || 0), 0);
        const priorityKbps = intBwKbps * totalPriorityPct / 100;
        const remainingKbps = intBwKbps - priorityKbps;
        const totalAllocPct = totalPriorityPct + totalBwPct;
        const classDefaultPct = Math.max(0, 100 - totalAllocPct);
        const classDefaultKbps = intBwKbps - priorityKbps - bwClasses.reduce((s, c) => s + (intBwKbps * (parseFloat(c.pct) || 0) / 100), 0);

        // Shaping parameters per class
        const classCalc = cbwfqClasses.map(c => {
          const pct = parseFloat(c.pct) || 0;
          const classKbps = intBwKbps * pct / 100;
          const classBps = classKbps * 1000;
          const bcBits = classBps * tcSec;
          const beBits = cbwfqMode === 'peak' ? bcBits : 0;
          const sustainedRate = cbwfqMode === 'peak' ? classBps * 2 : classBps;
          return { ...c, classKbps, classBps, bcBits, beBits, sustainedRate, pct };
        });

        const updateClass = (id, field, value) => {
          setCbwfqClasses(prev => prev.map(c => c.id === id ? { ...c, [field]: value } : c));
        };
        const addClass = () => {
          setCbwfqClasses(prev => [...prev, { id: 'c' + (prev.length + 1), name: '', type: 'bandwidth', pct: '' }]);
        };
        const removeClass = (id) => {
          setCbwfqClasses(prev => prev.length <= 1 ? prev : prev.filter(c => c.id !== id));
        };

        return (
          <div className="fadein">
            <div className="card">
              <div className="card-title">{t('qos_tool.cbwfq_title')}</div>
              <div className="two-col grid-mobile-1" style={{gap:20}}>
                <div>
                  <div className="result-grid" style={{marginBottom:16}}>
                    <div className="field">
                      <label className="label">{t('qos_tool.interface_speed')}</label>
                      <div style={{display:'flex',gap:'0.5rem'}}>
                        <input className="input" style={{flex:1}} value={cbwfqIntBw} onChange={e=>setCbwfqIntBw(e.target.value)} />
                        <select className="select" style={{width:80}} value={cbwfqBwUnit} onChange={e=>setCbwfqBwUnit(e.target.value)}>
                          <option value="Kbps">Kbps</option>
                          <option value="Mbps">Mbps</option>
                          <option value="Gbps">Gbps</option>
                        </select>
                      </div>
                    </div>
                    <div className="field">
                      <label className="label">{t('qos_tool.tc_interval_ms')}</label>
                      <select className="select" value={cbwfqTc} onChange={e=>setCbwfqTc(e.target.value)}>
                        <option value="4">4 ms (default, low-latency)</option>
                        <option value="8">8 ms</option>
                        <option value="10">10 ms</option>
                        <option value="25">25 ms</option>
                        <option value="50">50 ms</option>
                        <option value="125">125 ms (legacy default)</option>
                      </select>
                    </div>
                    <div className="field">
                      <label className="label">{t('qos_tool.shaping_mode')}</label>
                      <select className="select" value={cbwfqMode} onChange={e=>setCbwfqMode(e.target.value)}>
                        <option value="average">shape average (CIR only)</option>
                        <option value="peak">shape peak (CIR + PIR)</option>
                      </select>
                    </div>
                  </div>

                  <h3 style={{marginBottom:8}}>{t('qos_tool.traffic_classes')}</h3>
                  {cbwfqClasses.map(c => (
                    <div key={c.id} style={{display:'flex',gap:'0.4rem',marginBottom:'0.4rem',flexWrap:'wrap',alignItems:'center'}}>
                      <input className="input" style={{width:90}} value={c.name}
                        onChange={e=>updateClass(c.id,'name',e.target.value)} placeholder={t('qos_tool.class_name')} />
                      <select className="select" style={{width:100}} value={c.type} onChange={e=>updateClass(c.id,'type',e.target.value)}>
                        <option value="priority">priority (LLQ)</option>
                        <option value="bandwidth">bandwidth</option>
                      </select>
                      <div style={{display:'flex',alignItems:'center',gap:'0.3rem'}}>
                        <input className="input" style={{width:60}} value={c.pct}
                          onChange={e=>updateClass(c.id,'pct',e.target.value)} placeholder="%" />
                        <span style={{color:'var(--text2)',fontSize:'0.85rem'}}>%</span>
                      </div>
                      <button className="btn btn-danger btn-sm" onClick={()=>removeClass(c.id)}>×</button>
                    </div>
                  ))}
                  <button className="btn btn-ghost btn-sm" onClick={addClass}>+ {t('qos_tool.add_class')}</button>
                </div>

                <div>
                  <h3 style={{margin:0,marginBottom:8}}>{t('qos_tool.bandwidth_allocation')}</h3>
                  <div style={{overflowX:'auto'}}>
                    <table style={{width:'100%',fontSize:'0.82rem',borderCollapse:'collapse'}}>
                      <thead>
                        <tr style={{borderBottom:'2px solid var(--border, #333)'}}>
                          <th style={{textAlign:'left',padding:'0.4rem'}}>{t('qos_tool.class_col')}</th>
                          <th style={{textAlign:'left',padding:'0.4rem'}}>{t('qos_tool.type_col')}</th>
                          <th style={{textAlign:'right',padding:'0.4rem'}}>%</th>
                          <th style={{textAlign:'right',padding:'0.4rem'}}>kbps</th>
                          <th style={{textAlign:'right',padding:'0.4rem'}}>Bc (bits)</th>
                          {cbwfqMode === 'peak' && <th style={{textAlign:'right',padding:'0.4rem'}}>Be (bits)</th>}
                        </tr>
                      </thead>
                      <tbody>
                        {classCalc.map(c => (
                          <tr key={c.id} style={{borderBottom:'1px solid var(--border, #333)'}}>
                            <td style={{padding:'0.4rem'}}>{c.name || c.id}</td>
                            <td style={{padding:'0.4rem'}}>
                              <span className={`badge ${c.type === 'priority' ? 'badge-red' : 'badge-cyan'}`}>
                                {c.type === 'priority' ? 'LLQ' : 'CBWFQ'}
                              </span>
                            </td>
                            <td style={{textAlign:'right',padding:'0.4rem'}}>{c.pct}%</td>
                            <td style={{textAlign:'right',padding:'0.4rem'}}>{c.classKbps.toLocaleString()}</td>
                            <td style={{textAlign:'right',padding:'0.4rem'}}>{c.bcBits.toLocaleString()}</td>
                            {cbwfqMode === 'peak' && <td style={{textAlign:'right',padding:'0.4rem'}}>{c.beBits.toLocaleString()}</td>}
                          </tr>
                        ))}
                        <tr style={{borderBottom:'1px solid var(--border, #333)'}}>
                          <td style={{padding:'0.4rem'}}>class-default</td>
                          <td style={{padding:'0.4rem'}}><span className="badge badge-yellow">best-effort</span></td>
                          <td style={{textAlign:'right',padding:'0.4rem'}}>{classDefaultPct.toFixed(1)}%</td>
                          <td style={{textAlign:'right',padding:'0.4rem'}}>{Math.max(0,classDefaultKbps).toLocaleString()}</td>
                          <td style={{textAlign:'right',padding:'0.4rem'}}>—</td>
                          {cbwfqMode === 'peak' && <td></td>}
                        </tr>
                      </tbody>
                      <tfoot>
                        <tr style={{borderTop:'2px solid var(--border, #333)',fontWeight:600}}>
                          <td colSpan={2} style={{padding:'0.4rem'}}>{t('qos_tool.total_allocated')}</td>
                          <td style={{textAlign:'right',padding:'0.4rem'}}>{totalAllocPct.toFixed(1)}%</td>
                          <td style={{textAlign:'right',padding:'0.4rem'}}>{(intBwKbps - Math.max(0,classDefaultKbps)).toLocaleString()}</td>
                          <td></td>
                          {cbwfqMode === 'peak' && <td></td>}
                        </tr>
                      </tfoot>
                    </table>
                  </div>

                  <div style={{marginTop:12,padding:'0.6rem 0.8rem',borderRadius:'var(--radius, 8px)',
                    background: totalAllocPct > 100 ? 'rgba(255,80,80,0.08)' : totalAllocPct > 75 ? 'rgba(255,200,0,0.08)' : 'rgba(0,200,100,0.08)',
                    border: `1px solid ${totalAllocPct > 100 ? 'rgba(255,80,80,0.25)' : totalAllocPct > 75 ? 'rgba(255,200,0,0.25)' : 'rgba(0,200,100,0.25)'}`,
                    fontSize:'0.85rem'
                  }}>
                    {totalAllocPct > 100 ? t('qos_tool.over_allocated') :
                     totalAllocPct > 75 ? t('qos_tool.high_allocation') :
                     t('qos_tool.allocation_ok')}
                    {' '}({totalAllocPct.toFixed(1)}% / 100%)
                  </div>

                  <div className="hint" style={{marginTop:12}}>
                    {cbwfqMode === 'average'
                      ? t('qos_tool.shape_average_formula')
                      : t('qos_tool.shape_peak_formula')} <RFCLink rfc={2697} /> <RFCLink rfc={2698} />
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── Tool: WiFi QR Code Generator ────────────────────────────
window.QoSDSCPTool = QoSDSCPTool;
