const { useState, useEffect, useCallback, useRef, useMemo } = React;

function IPFMRef() {
  const { t } = useTranslation();

  const commands = [
    {
      cat: t('ipfm.tcam_carving'),
      cmds: [
        { c: 'hardware access-list tcam region ing-nbm 1536', d: t('ipfm.commands.tcam.0') },
        { c: 'show hardware access-list tcam region', d: t('ipfm.commands.tcam.1') }
      ]
    },
    {
      cat: t('ipfm.enable_infra'),
      cmds: [
        { c: 'feature ptp', d: t('ipfm.commands.infra.0') },
        { c: 'feature nbm', d: t('ipfm.commands.infra.1') },
        { c: 'feature ospf', d: t('ipfm.commands.infra.2') }
      ]
    },
    {
      cat: t('ipfm.ptp_global'),
      cmds: [
        { c: 'ptp source-ip 1.1.1.1', d: t('ipfm.commands.ptp_global.0') },
        { c: 'ptp domain 0', d: t('ipfm.commands.ptp_global.1') },
        { c: 'ptp profile smpte-2059-2', d: t('ipfm.commands.ptp_global.2') },
        { c: 'ptp priority1 128', d: t('ipfm.commands.ptp_global.3') },
        { c: 'ptp offload', d: t('ipfm.commands.ptp_global.4') },
        { c: 'ptp clock-mode one-step', d: t('ipfm.commands.ptp_global.5') }
      ]
    },
    {
      cat: t('ipfm.interface_cfg'),
      cmds: [
        { c: 'interface Eth1/1\n  ptp\n  nbm external-link', d: t('ipfm.commands.interface.0') },
        { c: 'interface Eth1/54\n  ptp', d: t('ipfm.commands.interface.1') },
        { c: 'interface Eth1/1\n  nbm bandwidth 10000000', d: t('ipfm.commands.interface.2') },
        { c: 'interface Eth1/1\n  nbm host-policy sender SENDER_POLICY\n  nbm host-policy receiver RECEIVER_POLICY', d: t('ipfm.commands.interface.3') }
      ]
    },
    {
      cat: t('ipfm.ptp_verif'),
      cmds: [
        { c: 'show ptp brief', d: t('ipfm.commands.ptp_verif.0') },
        { c: 'show ptp clock', d: t('ipfm.commands.ptp_verif.1') },
        { c: 'show ptp parent', d: t('ipfm.commands.ptp_verif.2') },
        { c: 'show ptp interfaces', d: t('ipfm.commands.ptp_verif.3') },
        { c: 'show ptp corrections', d: t('ipfm.commands.ptp_verif.4') }
      ]
    },
    {
      cat: t('ipfm.nbm_verif'),
      cmds: [
        { c: 'show nbm flows vrf all', d: t('ipfm.commands.nbm_verif.0') },
        { c: 'show nbm flows summary vrf all', d: t('ipfm.commands.nbm_verif.1') },
        { c: 'show nbm flows statistics vrf all', d: t('ipfm.commands.nbm_verif.2') },
        { c: 'show nbm flow-policy vrf all', d: t('ipfm.commands.nbm_verif.3') },
        { c: 'show nbm defaults vrf all', d: t('ipfm.commands.nbm_verif.4') },
        { c: 'show nbm host-policy applied sender all vrf all', d: t('ipfm.commands.nbm_verif.5') },
        { c: 'show nbm host-policy applied receiver local all vrf all', d: t('ipfm.commands.nbm_verif.6') },
        { c: 'show nbm flows static', d: t('ipfm.commands.nbm_verif.7') }
      ]
    }
  ];

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title" style={{color:'var(--red)'}}>{t('ipfm.title')}</div>
        <div style={{fontSize:13, color:'var(--muted)', lineHeight:1.6, marginBottom:16}}>
          {t('ipfm.desc')}
        </div>
        <div className="result-grid grid-mobile-1">
          <ResultItem label={t('ipfm.sync_std')} value="IEEE 1588 (PTPv2)" accent />
          <ResultItem label={t('ipfm.broadcast_profile')} value="SMPTE 2059-2" />
          <ResultItem label={t('ipfm.media_standards')} value="ST 2110 / ST 2022-6" green />
          <ResultItem label={t('ipfm.control_logic')} value="NBM (Active/Passive)" yellow />
        </div>
      </div>

      <div className="two-col grid-mobile-1">
        <div className="card">
          <div className="card-title">{t('ipfm.ptp_title')}</div>
          <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.6}}>
            {t('ipfm.ptp_desc')}
            <br/><br/>
            <strong style={{color:'var(--text)'}}>{t('ipfm.node_roles')}</strong>
            <ul style={{paddingLeft:16, marginTop:8}}>
              <li><strong style={{color:'var(--yellow)'}}>{t('ipfm.gm_title')}</strong> {t('ipfm.gm_desc')}</li>
              <li><strong style={{color:'var(--cyan)'}}>{t('ipfm.bc_title')}</strong> {t('ipfm.bc_desc')}</li>
              <li><strong style={{color:'var(--dim)'}}>{t('ipfm.slave_title')}</strong> {t('ipfm.slave_desc')}</li>
            </ul>
            <br/>
            <strong style={{color:'var(--text)'}}>{t('ipfm.key_params')}</strong>
            <ul style={{paddingLeft:16, marginTop:4}}>
              <li>{t('ipfm.domain_desc')}</li>
              <li>{t('ipfm.priority_desc')}</li>
              <li>{t('ipfm.intervals_desc')}</li>
            </ul>
          </div>
        </div>
        <div className="card">
          <div className="card-title">{t('ipfm.nbm_title')}</div>
          <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.6}}>
            {t('ipfm.nbm_desc')}
            <br/><br/>
            <strong style={{color:'var(--text)'}}>{t('ipfm.core_benefits')}</strong>
            <ul style={{paddingLeft:16, marginTop:8}}>
              <li><strong style={{color:'var(--green)'}}>{t('ipfm.zero_loss')}</strong> {t('ipfm.zero_loss_desc')}</li>
              <li><strong style={{color:'var(--cyan)'}}>{t('ipfm.active_mode')}</strong> {t('ipfm.active_mode_desc')}</li>
              <li><strong style={{color:'var(--yellow)'}}>{t('ipfm.passive_mode')}</strong> {t('ipfm.passive_mode_desc')}</li>
            </ul>
            <br/>
            <strong style={{color:'var(--text)'}}>{t('ipfm.ops_constraints')}</strong>
            <ul style={{paddingLeft:16, marginTop:4}}>
              <li>{t('ipfm.nbm_constraints')}</li>
            </ul>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('ipfm.ptp_hierarchy')}</div>
        <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.5, marginBottom:14}}>
          {t('ipfm.ptp_hierarchy_desc', { directly: <em style={{color:'var(--text)'}}>{t('ipfm.directly')}</em> })}
        </div>
        <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:8, padding:20, background:'var(--panel)', borderRadius:8, border:'1px solid var(--border)', overflowX:'auto'}}>
          <div style={{display:'flex', flexDirection:'column', alignItems:'center', gap:8, width:'100%'}}>
            {/* Tier 0 — GM */}
            <div style={{display:'flex', gap:20, alignItems:'center'}}>
              <div style={{padding:'8px 14px', background:'var(--red)', color:'#000', borderRadius:4, fontWeight:700, fontSize:11, border:'2px solid #fff'}}>
                {t('ipfm.gm_gps')}
                <div style={{fontSize:9, fontWeight:400, marginTop:2, opacity:0.8}}>{t('ipfm.ordinary_clock')} • {t('ipfm.priority_hint')}</div>
              </div>
            </div>
            <div style={{display:'flex', alignItems:'center', gap:6}}>
              <div style={{width:2, height:20, background:'var(--red)'}} />
              <div style={{fontSize:9, color:'var(--red)', fontFamily:'var(--mono)'}}>Sync / Announce / Delay_Req</div>
              <div style={{width:2, height:20, background:'var(--red)'}} />
            </div>
            {/* Tier 1 — Spine BC */}
            <div style={{padding:'10px 20px', background:'var(--card)', border:'1px solid var(--cyan)', borderRadius:6, fontWeight:600, fontSize:12, color:'var(--cyan)'}}>
              {t('ipfm.spine_bc')}
              <div style={{fontSize:9, fontWeight:400, color:'var(--dim)', marginTop:2}}>{t('ipfm.spine_hint')}</div>
            </div>
            <div style={{display:'flex', gap:80, marginTop:-4}}>
              <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}>
                <div style={{width:2, height:18, background:'var(--dim)', transform:'rotate(25deg)'}} />
                <div style={{fontSize:8, color:'var(--dim)', fontFamily:'var(--mono)'}}>{t('ipfm.slave_port')}</div>
              </div>
              <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}>
                <div style={{width:2, height:18, background:'var(--dim)', transform:'rotate(-25deg)'}} />
                <div style={{fontSize:8, color:'var(--dim)', fontFamily:'var(--mono)'}}>{t('ipfm.slave_port')}</div>
              </div>
            </div>
            {/* Tier 2 — Leaf BC */}
            <div style={{display:'flex', gap:30}}>
               <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}>
                 <div style={{padding:'8px 14px', border:'1px solid var(--cyan)', borderRadius:4, fontSize:11, fontWeight:500, textAlign:'center'}}>
                   {t('ipfm.leaf_bc')}
                   <div style={{fontSize:9, fontWeight:400, color:'var(--dim)', marginTop:2}}>{t('ipfm.leaf_hint')}</div>
                 </div>
                 <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}>
                   <div style={{width:2, height:14, background:'var(--dim)'}} />
                   <div style={{fontSize:8, color:'var(--dim)', fontFamily:'var(--mono)'}}>{t('ipfm.master_ports')}</div>
                 </div>
                 <div style={{padding:'6px 10px', background:'rgba(0,212,200,0.08)', border:'1px solid var(--border)', borderRadius:4, fontSize:10, color:'var(--muted)'}}>
                   {t('ipfm.endpoints')}
                   <div style={{fontSize:8, color:'var(--dim)'}}>{t('ipfm.diagram.cam_enc')}</div>
                 </div>
               </div>
               <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}>
                 <div style={{padding:'8px 14px', border:'1px solid var(--cyan)', borderRadius:4, fontSize:11, fontWeight:500, textAlign:'center'}}>
                   {t('ipfm.leaf_bc')}
                   <div style={{fontSize:9, fontWeight:400, color:'var(--dim)', marginTop:2}}>{t('ipfm.leaf_hint')}</div>
                 </div>
                 <div style={{display:'flex', flexDirection:'column', alignItems:'center'}}>
                   <div style={{width:2, height:14, background:'var(--dim)'}} />
                   <div style={{fontSize:8, color:'var(--dim)', fontFamily:'var(--mono)'}}>{t('ipfm.master_ports')}</div>
                 </div>
                 <div style={{padding:'6px 10px', background:'rgba(0,212,200,0.08)', border:'1px solid var(--border)', borderRadius:4, fontSize:10, color:'var(--muted)'}}>
                   {t('ipfm.endpoints')}
                   <div style={{fontSize:8, color:'var(--dim)'}}>{t('ipfm.diagram.mon_dec')}</div>
                 </div>
               </div>
            </div>
            {/* Notes */}
            <div style={{marginTop:12, display:'flex', gap:20, fontSize:10, color:'var(--dim)', flexWrap:'wrap', justifyContent:'center'}}>
              <div style={{display:'flex', gap:4, alignItems:'center'}}><div style={{width:8, height:3, background:'var(--red)', borderRadius:1}} /> {t('ipfm.sync_flow')}</div>
              <div>{t('ipfm.dual_plane_hint')}</div>
              <div>{t('ipfm.healthy_sync')}</div>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('ipfm.clos_title')}</div>
        <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.5, marginBottom:14}}>
          {t('ipfm.clos_desc', { double_spine: <strong style={{color:'var(--text)'}}>{t('ipfm.double_spine')}</strong> })}
        </div>
        <div style={{padding:20, background:'var(--panel)', borderRadius:8, border:'1px solid var(--border)', overflowX:'auto'}}>
          <svg viewBox="0 0 800 295" style={{width:'100%', maxWidth:820, display:'block', margin:'0 auto'}}>
            {/* === PLANE A === */}
            <text x="175" y="11" textAnchor="middle" fontSize="9" fill="var(--red)" fontWeight="700" letterSpacing="2" fontFamily="var(--mono)">{t('ipfm.plane_a')}</text>
            <rect x="95" y="16" width="160" height="24" rx="3" fill="var(--red)" />
            <text x="175" y="32" textAnchor="middle" fontSize="10" fontWeight="700" fill="#000">GM-A (GPS)</text>
            <line x1="155" y1="40" x2="85" y2="82" stroke="var(--red)" strokeWidth="1.5" />
            <line x1="195" y1="40" x2="265" y2="82" stroke="var(--red)" strokeWidth="1.5" />
            <rect x="25" y="82" width="120" height="32" rx="4" fill="var(--card)" stroke="var(--red)" strokeWidth="2" />
            <rect x="25" y="82" width="120" height="32" rx="4" fill="var(--red)" opacity="0.12" />
            <text x="85" y="97" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--red)">Spine-A1</text>
            <text x="85" y="109" textAnchor="middle" fontSize="7" fill="var(--dim)">N9500-R · BC</text>
            <rect x="205" y="82" width="120" height="32" rx="4" fill="var(--card)" stroke="var(--red)" strokeWidth="2" />
            <rect x="205" y="82" width="120" height="32" rx="4" fill="var(--red)" opacity="0.12" />
            <text x="265" y="97" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--red)">Spine-A2</text>
            <text x="265" y="109" textAnchor="middle" fontSize="7" fill="var(--dim)">N9500-R · BC</text>
            <line x1="85" y1="114" x2="50" y2="178" stroke="var(--red)" strokeWidth="1" />
            <line x1="85" y1="114" x2="175" y2="178" stroke="var(--red)" strokeWidth="1" />
            <line x1="85" y1="114" x2="300" y2="178" stroke="var(--red)" strokeWidth="1" opacity="0.4" />
            <line x1="265" y1="114" x2="50" y2="178" stroke="var(--red)" strokeWidth="1" opacity="0.4" />
            <line x1="265" y1="114" x2="175" y2="178" stroke="var(--red)" strokeWidth="1" />
            <line x1="265" y1="114" x2="300" y2="178" stroke="var(--red)" strokeWidth="1" />
            <text x="175" y="150" textAnchor="middle" fontSize="7" fill="var(--dim)" fontFamily="var(--mono)">{t('ipfm.ecmp_mesh')}</text>
            <rect x="5" y="178" width="90" height="26" rx="3" fill="var(--card)" stroke="var(--red)" strokeWidth="1" />
            <text x="50" y="190" textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--red)">Leaf-A1</text>
            <text x="50" y="200" textAnchor="middle" fontSize="7" fill="var(--dim)">N9300 · BC</text>
            <rect x="130" y="178" width="90" height="26" rx="3" fill="var(--card)" stroke="var(--red)" strokeWidth="1" />
            <text x="175" y="190" textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--red)">Leaf-A2</text>
            <text x="175" y="200" textAnchor="middle" fontSize="7" fill="var(--dim)">N9300 · BC</text>
            <rect x="255" y="178" width="90" height="26" rx="3" fill="var(--card)" stroke="var(--red)" strokeWidth="1" />
            <text x="300" y="190" textAnchor="middle" fontSize="9" fontWeight="600" fill="var(--red)">Leaf-A3</text>
            <text x="300" y="200" textAnchor="middle" fontSize="7" fill="var(--dim)">N9300 · BC</text>
            <line x1="50" y1="204" x2="50" y2="242" stroke="var(--dim)" strokeWidth="1" />
            <line x1="175" y1="204" x2="175" y2="242" stroke="var(--dim)" strokeWidth="1" />
            <line x1="300" y1="204" x2="300" y2="242" stroke="var(--dim)" strokeWidth="1" />
            <rect x="5" y="242" width="90" height="22" rx="3" fill="rgba(239,68,68,0.06)" stroke="var(--border)" strokeWidth="1" />
            <text x="50" y="257" textAnchor="middle" fontSize="8" fill="var(--muted)">{t('ipfm.diagram.cam_enc')}</text>
            <rect x="130" y="242" width="90" height="22" rx="3" fill="rgba(239,68,68,0.06)" stroke="var(--border)" strokeWidth="1" />
            <text x="175" y="257" textAnchor="middle" fontSize="8" fill="var(--muted)">{t('ipfm.diagram.mix_proc')}</text>
            <rect x="255" y="242" width="90" height="22" rx="3" fill="rgba(239,68,68,0.06)" stroke="var(--border)" strokeWidth="1" />
            <text x="300" y="257" textAnchor="middle" fontSize="8" fill="var(--muted)">{t('ipfm.diagram.aud_ctrl')}</text>

            {/* === PLANE B === */}
            <text x="625" y="11" textAnchor="middle" fontSize="9" fill="#3388ff" fontWeight="700" letterSpacing="2" fontFamily="var(--mono)">{t('ipfm.plane_b')}</text>
            <rect x="545" y="16" width="160" height="24" rx="3" fill="#3388ff" />
            <text x="625" y="32" textAnchor="middle" fontSize="10" fontWeight="700" fill="#000">GM-B (GPS)</text>
            <line x1="605" y1="40" x2="535" y2="82" stroke="#3388ff" strokeWidth="1.5" />
            <line x1="645" y1="40" x2="715" y2="82" stroke="#3388ff" strokeWidth="1.5" />
            <rect x="475" y="82" width="120" height="32" rx="4" fill="var(--card)" stroke="#3388ff" strokeWidth="2" />
            <rect x="475" y="82" width="120" height="32" rx="4" fill="#3388ff" opacity="0.12" />
            <text x="535" y="97" textAnchor="middle" fontSize="11" fontWeight="700" fill="#3388ff">Spine-B1</text>
            <text x="535" y="109" textAnchor="middle" fontSize="7" fill="var(--dim)">N9500-R · BC</text>
            <rect x="655" y="82" width="120" height="32" rx="4" fill="var(--card)" stroke="#3388ff" strokeWidth="2" />
            <rect x="655" y="82" width="120" height="32" rx="4" fill="#3388ff" opacity="0.12" />
            <text x="715" y="97" textAnchor="middle" fontSize="11" fontWeight="700" fill="#3388ff">Spine-B2</text>
            <text x="715" y="109" textAnchor="middle" fontSize="7" fill="var(--dim)">N9500-R · BC</text>
            <line x1="535" y1="114" x2="500" y2="178" stroke="#3388ff" strokeWidth="1" />
            <line x1="535" y1="114" x2="625" y2="178" stroke="#3388ff" strokeWidth="1" />
            <line x1="535" y1="114" x2="750" y2="178" stroke="#3388ff" strokeWidth="1" opacity="0.4" />
            <line x1="715" y1="114" x2="500" y2="178" stroke="#3388ff" strokeWidth="1" opacity="0.4" />
            <line x1="715" y1="114" x2="625" y2="178" stroke="#3388ff" strokeWidth="1" />
            <line x1="715" y1="114" x2="750" y2="178" stroke="#3388ff" strokeWidth="1" />
            <text x="625" y="150" textAnchor="middle" fontSize="7" fill="var(--dim)" fontFamily="var(--mono)">{t('ipfm.ecmp_mesh')}</text>
            <rect x="455" y="178" width="90" height="26" rx="3" fill="var(--card)" stroke="#3388ff" strokeWidth="1" />
            <text x="500" y="190" textAnchor="middle" fontSize="9" fontWeight="600" fill="#3388ff">Leaf-B1</text>
            <text x="500" y="200" textAnchor="middle" fontSize="7" fill="var(--dim)">N9300 · BC</text>
            <rect x="580" y="178" width="90" height="26" rx="3" fill="var(--card)" stroke="#3388ff" strokeWidth="1" />
            <text x="625" y="190" textAnchor="middle" fontSize="9" fontWeight="600" fill="#3388ff">Leaf-B2</text>
            <text x="625" y="200" textAnchor="middle" fontSize="7" fill="var(--dim)">N9300 · BC</text>
            <rect x="705" y="178" width="90" height="26" rx="3" fill="var(--card)" stroke="#3388ff" strokeWidth="1" />
            <text x="750" y="190" textAnchor="middle" fontSize="9" fontWeight="600" fill="#3388ff">Leaf-B3</text>
            <text x="750" y="200" textAnchor="middle" fontSize="7" fill="var(--dim)">N9300 · BC</text>
            <line x1="500" y1="204" x2="500" y2="242" stroke="var(--dim)" strokeWidth="1" />
            <line x1="625" y1="204" x2="625" y2="242" stroke="var(--dim)" strokeWidth="1" />
            <line x1="750" y1="204" x2="750" y2="242" stroke="var(--dim)" strokeWidth="1" />
            <rect x="455" y="242" width="90" height="22" rx="3" fill="rgba(51,136,255,0.06)" stroke="var(--border)" strokeWidth="1" />
            <text x="500" y="257" textAnchor="middle" fontSize="8" fill="var(--muted)">{t('ipfm.diagram.mon_dec')}</text>
            <rect x="580" y="242" width="90" height="22" rx="3" fill="rgba(51,136,255,0.06)" stroke="var(--border)" strokeWidth="1" />
            <text x="625" y="257" textAnchor="middle" fontSize="8" fill="var(--muted)">{t('ipfm.diagram.dec_mon')}</text>
            <rect x="705" y="242" width="90" height="22" rx="3" fill="rgba(51,136,255,0.06)" stroke="var(--border)" strokeWidth="1" />
            <text x="750" y="257" textAnchor="middle" fontSize="8" fill="var(--muted)">{t('ipfm.diagram.aud_aes67')}</text>

            {/* === ST 2022-7 INTER-PLANE REDUNDANCY === */}
            <line x1="325" y1="98" x2="475" y2="98" stroke="var(--dim)" strokeWidth="1.5" strokeDasharray="5,3" />
            <text x="400" y="93" textAnchor="middle" fontSize="7" fill="var(--dim)" fontFamily="var(--mono)">ST 2022-7</text>
            <text x="400" y="109" textAnchor="middle" fontSize="7" fill="var(--dim)" fontFamily="var(--mono)">{t('ipfm.diagram.redundancy')}</text>

            {/* === LEGEND === */}
            <rect x="105" y="278" width="10" height="3" rx="1" fill="var(--red)" />
            <text x="120" y="282" fontSize="9" fill="var(--dim)">{t('ipfm.plane_a')}</text>
            <rect x="185" y="278" width="10" height="3" rx="1" fill="#3388ff" />
            <text x="200" y="282" fontSize="9" fill="var(--dim)">{t('ipfm.plane_b')}</text>
            <text x="400" y="282" textAnchor="middle" fontSize="9" fill="var(--dim)">{t('ipfm.mesh_hint')}</text>
            <text x="695" y="282" textAnchor="middle" fontSize="9" fill="var(--dim)">{t('ipfm.nbm_link_hint')}</text>
          </svg>
        </div>

        {/* Non-blocking formula card */}
        <div style={{marginTop:12, padding:14, background:'var(--panel)', borderRadius:8, border:'1px solid var(--border)'}}>
          <div style={{fontSize:11, fontWeight:700, color:'var(--yellow)', textTransform:'uppercase', letterSpacing:1, marginBottom:8}}>{t('ipfm.clos_formula')}</div>
          <div style={{fontFamily:'var(--mono)', fontSize:11, color:'var(--text)', lineHeight:2, overflowWrap:'break-word', wordBreak:'break-word'}}>
            <div><span style={{color:'var(--cyan)'}}>{t('ipfm.sender_side')}</span> sum(all sender BW on leaf) ≤ sum(uplink BW to each spine)</div>
            <div><span style={{color:'var(--cyan)'}}>{t('ipfm.receiver_side')}</span> sum(all receiver BW on leaf) ≤ sum(downlink BW from each spine)</div>
            <div style={{color:'var(--dim)', fontSize:10, marginTop:4}}>{t('ipfm.formula_example')}</div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('ipfm.config_monitor')}</div>
        <div className="result-grid grid-mobile-1">
          {commands.map(g => (
            <div key={g.cat} style={{background:'var(--panel)', padding:16, borderRadius:8, border:'1px solid var(--border)'}}>
              <div style={{fontSize:11, fontWeight:700, color:'var(--cyan)', textTransform:'uppercase', letterSpacing:1, marginBottom:12}}>{g.cat}</div>
              <div style={{display:'flex', flexDirection:'column', gap:12}}>
                {g.cmds.map(c => (
                  <div key={c.c} style={{display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:10}}>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontFamily:'var(--mono)', color:'var(--green)', fontSize:12, marginBottom:4, whiteSpace:'pre-wrap', wordBreak:'break-all'}}>{c.c}</div>
                      <div style={{fontSize:11, color:'var(--dim)', lineHeight:1.4}}>{c.d}</div>
                    </div>
                    <CopyBtn text={c.c} id={c.c} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

window.IPFMRef = IPFMRef;
