const { useState, useEffect, useCallback, useRef, useMemo } = React;

function LACPSimulator({ onShare, initialData }) {
  const { t } = useTranslation();
  const [method, setMethod] = usePersistentState('lacp:method', initialData?.method ?? 'src-dst-ip');
  const [enhanced, setEnhanced] = usePersistentState('lacp:enhanced', initialData?.enhanced ?? false);
  const [ingressPort, setIngressPort] = usePersistentState('lacp:ingressPort', initialData?.ingressPort ?? 1);
  const [sip, setSIP] = usePersistentState('lacp:sip', initialData?.sip ?? '192.168.1.10');
  const [dip, setDIP] = usePersistentState('lacp:dip', initialData?.dip ?? '10.0.0.50');
  const [sport, setSPORT] = usePersistentState('lacp:sport', initialData?.sport ?? '54321');
  const [dport, setDPORT] = usePersistentState('lacp:dport', initialData?.dport ?? '443');
  const [links, setLinks] = usePersistentState('lacp:links', initialData?.links ?? 4);
  const [portLabels, setPortLabels] = usePersistentState('lacp:portLabels', initialData?.portLabels ?? ['Gi1/0/1', 'Gi1/0/2', 'Gi1/0/3', 'Gi1/0/4', 'Gi1/0/5', 'Gi1/0/6', 'Gi1/0/7', 'Gi1/0/8']);
  const [namingTemplate, setNamingTemplate] = usePersistentState('lacp:namingTemplate', initialData?.namingTemplate ?? 'ios');

  useEffect(() => {
    if (initialData) {
      if (initialData.method !== undefined) setMethod(initialData.method);
      if (initialData.enhanced !== undefined) setEnhanced(initialData.enhanced);
      if (initialData.ingressPort !== undefined) setIngressPort(initialData.ingressPort);
      if (initialData.sip !== undefined) setSIP(initialData.sip);
      if (initialData.dip !== undefined) setDIP(initialData.dip);
      if (initialData.sport !== undefined) setSPORT(initialData.sport);
      if (initialData.dport !== undefined) setDPORT(initialData.dport);
      if (initialData.links !== undefined) setLinks(initialData.links);
      if (initialData.portLabels !== undefined) setPortLabels(initialData.portLabels);
      if (initialData.namingTemplate !== undefined) setNamingTemplate(initialData.namingTemplate);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (sip || dip) {
        (e.detail?.respond ?? onShare)({ tool: 'lacp-tool', method, enhanced, ingressPort, sip, dip, sport, dport, links, portLabels, namingTemplate });
      }
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [method, enhanced, ingressPort, sip, dip, sport, dport, links, portLabels, namingTemplate, onShare]);

  const applyTemplate = (type) => {
    setNamingTemplate(type);
    let newLabels = [...portLabels];
    if (type === 'nexus') {
      newLabels = [...Array(8)].map((_, i) => `Ethernet1/${i + 1}`);
    } else if (type === 'ios') {
      newLabels = [...Array(8)].map((_, i) => `Gi1/0/${i + 1}`);
    } else if (type === 'generic') {
      newLabels = [...Array(8)].map((_, i) => `Port ${i + 1}`);
    }
    setPortLabels(newLabels);
  };

  const calculateRBH = () => {
    let val = 0;
    const getIPVal = (ip) => {
      const parts = ip.split('.');
      return parts.length === 4 ? parseInt(parts[3]) : 0;
    };
    const getPortVal = (p) => parseInt(p) || 0;

    switch(method) {
      case 'src-ip': val = getIPVal(sip); break;
      case 'dst-ip': val = getIPVal(dip); break;
      case 'src-dst-ip': val = getIPVal(sip) ^ getIPVal(dip); break;
      case 'src-dst-mixed': val = getIPVal(sip) ^ getIPVal(dip) ^ getPortVal(sport) ^ getPortVal(dport); break;
      default: val = getIPVal(sip) ^ getIPVal(dip);
    }

    if (enhanced) val = val ^ ingressPort;
    return val % 8;
  };

  const rbh = calculateRBH();

  const getPortFromRBH = (r) => {
    if (links === 1) return 1;
    if (links === 2) return (r % 2 === 0) ? 1 : 2; // Interleaved: 0,2,4,6 -> P1; 1,3,5,7 -> P2
    if (links === 4) return (r % 4) + 1; // Interleaved: 0,4 -> P1; 1,5 -> P2...
    if (links === 8) return r + 1;
    if (links === 3) return [1,2,3,1,2,3,1,2][r]; // Uneven distribution
    return (r % links) + 1;
  };

  // Calculate the "Load Mask" (Hex representation of which RBH bits are handled by this link)
  const getLoadMask = (portIdx) => {
    let mask = 0;
    for (let i = 0; i < 8; i++) {
      if (getPortFromRBH(i) === portIdx + 1) {
        mask |= (1 << i);
      }
    }
    return '0x' + mask.toString(16).toUpperCase().padStart(2, '0');
  };

  const currentPort = getPortFromRBH(rbh);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('switching.lacp_sim_title')}</div>

        <div className="two-col grid-mobile-1"
 style={{gap:20, marginBottom:16}}>
          <div className="field">
            <label className="label">{t('switching.algo')}</label>
            <select className="input" value={method} onChange={e => setMethod(e.target.value)}>
              <option value="src-dst-ip">{t('switching.source_ip')} XOR {t('switching.dest_ip')}</option>
              <option value="src-dst-mixed">{t('switching.source_ip')} + {t('switching.source_port')} Mixed (L4-Aware)</option>
              <option value="src-ip">{t('switching.source_ip')} Only</option>
              <option value="dst-ip">{t('switching.dest_ip')} Only</option>
            </select>
          </div>
          <div className="field">
            <label className="label">{t('switching.adv_mode')}</label>
            <div style={{display:'flex', gap:10, marginTop:8}}>
              <label style={{display:'flex', alignItems:'center', gap:6, fontSize:12, cursor:'pointer'}}>
                <input type="checkbox" checked={enhanced} onChange={e => setEnhanced(e.target.checked)} />
                {t('switching.ingress_polarization')}
              </label>
            </div>
          </div>
        </div>

        {enhanced && (
          <div className="field fadein" style={{background:'rgba(167, 139, 250, 0.05)', padding:12, borderRadius:6, border:'1px solid var(--purple)', marginBottom:16}}>
            <label className="label" style={{color:'var(--purple)'}}>{t('switching.ingress_port_idx')}</label>
            <input type="range" min="1" max="8" value={ingressPort} onChange={e => setIngressPort(parseInt(e.target.value))} style={{width:'100%', accentColor:'var(--purple)'}} />
            <div style={{fontSize:10, color:'var(--dim)', marginTop:4}}>{t('switching.ingress_hint')}</div>
          </div>
        )}

        <div className="two-col grid-mobile-1"
 style={{gap:20}}>
          <div>
            <div className="field">
              <label className="label">{t('switching.source_ip')}</label>
              <input className="input" value={sip} onChange={e => setSIP(e.target.value)} />
            </div>
            {method.includes('mixed') && (
              <div className="field fadein">
                <label className="label">{t('switching.source_port')}</label>
                <input className="input" value={sport} onChange={e => setSPORT(e.target.value)} />
              </div>
            )}
          </div>
          <div>
            <div className="field">
              <label className="label">{t('switching.dest_ip')}</label>
              <input className="input" value={dip} onChange={e => setDIP(e.target.value)} />
            </div>
            {method.includes('mixed') && (
              <div className="field fadein">
                <label className="label">{t('switching.dest_port')}</label>
                <input className="input" value={dport} onChange={e => setDPORT(e.target.value)} />
              </div>
            )}
          </div>
        </div>

        <div className="field">
          <label className="label">{t('switching.naming_template')}</label>
          <div style={{display:'flex', gap:8}}>
            {['ios','nexus','generic'].map(t_templ => (
              <button key={t_templ} className={`btn btn-sm ${namingTemplate===t_templ?'btn-primary':'btn-ghost'}`} onClick={()=>applyTemplate(t_templ)} style={{flex:1, fontSize:10}}>
                {t_templ === 'ios' ? 'Cisco IOS (Gi1/0/x)' : t_templ === 'nexus' ? 'Cisco Nexus (Eth1/x)' : 'Generic (Port x)'}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="label">{t('switching.num_links')}</label>
          <div style={{display:'flex', gap:8}}>
            {[2,3,4,8].map(n => (
              <button key={n} className={`btn btn-sm ${links===n?'btn-primary':'btn-ghost'}`} onClick={()=>setLinks(n)} style={{flex:1}}>
                {n} {t('nav.tools')} {n===3 && '(Uneven)'}
              </button>
            ))}
          </div>
        </div>

        <div style={{marginTop:24}}>
           <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', textAlign:'center', marginBottom:12}}>{t('switching.bucket_assignment')}</div>
           <div style={{display:'flex', gap:4, height:40, background:'var(--panel)', borderRadius:6, padding:4, border:'1px solid var(--border)'}}>
              {[...Array(8)].map((_, i) => (
                <div key={i} style={{
                  flex:1, borderRadius:3, border:'1px solid var(--border)',
                  background: rbh === i ? 'var(--cyan)' : (getPortFromRBH(i) % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'transparent'),
                  display:'flex', alignItems:'center', justifyContent:'center', fontSize:10, color:rbh===i ? '#000' : 'var(--dim)',
                  fontWeight: rbh===i ? 700 : 400, transition:'all .3s'
                }}>
                  {i}
                </div>
              ))}
           </div>
           <div style={{fontSize:9, color:'var(--dim)', textAlign:'center', marginTop:4}}>{t('switching.current_rbh')} <span style={{color:'var(--cyan)'}}>{rbh}</span></div>
        </div>

        <div style={{marginTop:24}}>
           <div style={{fontSize:11, color:'var(--muted)', textTransform:'uppercase', textAlign:'center', marginBottom:12}}>{t('switching.bundle_mapping')}</div>
           <div className="grid-mobile-1" style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(100px, 1fr))', gap:10}}>
              {[...Array(links)].map((_, i) => (
                <div key={i} style={{
                  background:currentPort === i+1 ? 'var(--cyan)' : 'var(--panel)',
                  border:'1px solid var(--border)', borderRadius:8, padding:12, textAlign:'center', transition:'all .3s',
                  boxShadow: currentPort === i+1 ? '0 0 20px rgba(0, 212, 200, 0.4)' : 'none',
                  position:'relative'
                }}>
                  <div style={{fontSize:10, color:currentPort === i+1 ? '#000' : 'var(--muted)', fontWeight:600}}>{t('switching.link_index')} {i}</div>
                  <input style={{
                    width:'100%', background:'transparent', border:'none', borderBottom:currentPort === i+1 ? '1px solid #000' : '1px solid var(--border)',
                    textAlign:'center', fontSize:13, marginTop:4, color:currentPort === i+1 ? '#000' : 'var(--text)', fontWeight:700
                  }} value={portLabels[i]} onChange={e => {
                    const nl = [...portLabels]; nl[i] = e.target.value; setPortLabels(nl);
                  }} />
                  <div style={{marginTop:8, fontSize:10, color:currentPort === i+1 ? '#000' : 'var(--dim)', fontFamily:'var(--mono)'}}>
                    {t('switching.mask')} {getLoadMask(i)}
                  </div>
                </div>
              ))}
           </div>
        </div>

        <div style={{marginTop:24, padding:16, background:'rgba(0, 212, 200, 0.05)', borderRadius:8, border:'1px solid var(--border)', fontSize:12}}>
          <strong style={{color:'var(--cyan)'}}>{t('switching.how_maps')}</strong><br/>
          <div style={{color:'var(--muted)', marginTop:8, lineHeight:1.6}}>
            {t('switching.how_maps_desc_1')}<br/>
            {t('switching.how_maps_desc_2').replace('{links-1}', links-1)} <br/>
               <span style={{fontSize:11, color:'var(--dim)'}}>💡 {t('switching.how_maps_desc_3')}</span><br/>
            {t('switching.how_maps_desc_4').replace('{links}', links)}<br/>
            {t('switching.how_maps_desc_5').replace('{rbh}', rbh).replace('{idx}', currentPort-1).replace('{label}', portLabels[currentPort-1])}
          </div>
        </div>
      </div>
    </div>
  );
}

window.LACPSimulator = LACPSimulator;
