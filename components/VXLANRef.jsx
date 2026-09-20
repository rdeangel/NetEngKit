const { useState, useEffect, useCallback, useRef, useMemo } = React;

function VXLANRef() {
  const { t } = useTranslation();
  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title" style={{color:'var(--cyan)'}}>{t('switching.vxlan_title')} — <RFCLink rfc="RFC 7348" /></div>
        <div style={{fontSize:13, color:'var(--muted)', lineHeight:1.6, marginBottom:16}}>
          {t('switching.vxlan_desc')}
        </div>
        <div className="result-grid">
          <ResultItem label={t('switching.std_port')} value="UDP 4789" accent />
          <ResultItem label={t('switching.legacy_port')} value="UDP 8472" />
          <ResultItem label={t('switching.addr_space')} value="24-bit VNI (16.7M)" green />
          <ResultItem label={t('switching.total_overhead')} value="50 Bytes" red />
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('switching.vxlan_header_title')}</div>
        <div style={{display:'grid', gridTemplateColumns:'repeat(8, 1fr)', gap:2, background:'var(--border)', padding:2, borderRadius:4, fontFamily:'var(--mono)', fontSize:11, textAlign:'center'}}>
          {/* Row 1: Bits 0-31 */}
          <div style={{gridColumn:'span 1', background:'var(--panel)', padding:8, color:'var(--cyan)'}} title="Flags (Bit 3 = I bit)">{t('switching.flags')}</div>
          <div style={{gridColumn:'span 3', background:'var(--panel)', padding:8, color:'var(--dim)'}}>{t('switching.reserved')} (24 bits)</div>
          <div style={{gridColumn:'span 3', background:'var(--panel)', padding:8, color:'var(--yellow)'}} title="VXLAN Network Identifier">{t('switching.vni')}</div>
          <div style={{gridColumn:'span 1', background:'var(--panel)', padding:8, color:'var(--dim)'}}>{t('switching.reserved')}</div>
        </div>
        <div style={{marginTop:12, fontSize:12, color:'var(--muted)', display:'flex', gap:20}}>
          <div><span style={{color:'var(--cyan)', fontWeight:600}}>I-Flag:</span> {t('switching.i_flag_desc')}</div>
          <div><span style={{color:'var(--yellow)', fontWeight:600}}>VNI:</span> {t('switching.vni_desc')}</div>
        </div>
      </div>

      <div className="two-col grid-mobile-1">
        <div className="card">
          <div className="card-title">{t('switching.mtu_reqs')}</div>
          <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.6}}>
            {t('switching.mtu_desc')}
            <br/><br/>
            <ul style={{paddingLeft:16}}>
              <li><strong style={{color:'var(--text)'}}>{t('switching.std_eth')}</strong> 1500 bytes</li>
              <li><strong style={{color:'var(--cyan)'}}>{t('switching.min_underlay')}</strong> 1550 bytes</li>
              <li><strong style={{color:'var(--green)'}}>{t('switching.best_practice')}</strong> 1600 or 9216 ({t('switching.jumbo')})</li>
            </ul>
            <br/>
            <div style={{padding:10, background:'rgba(239, 68, 68, 0.05)', border:'1px solid rgba(239, 68, 68, 0.2)', borderRadius:6}}>
              <strong style={{color:'var(--red)'}}>{t('common.error') || 'Warning'}:</strong> {t('switching.fragmentation_warn')}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card-title">{t('switching.encap_stack')}</div>
          <div style={{display:'flex', flexDirection:'column', gap:2}}>
            <div style={{background:'var(--panel)', padding:'6px 12px', border:'1px solid var(--border)', borderRadius:4, fontSize:11, display:'flex', justifyContent:'space-between'}}>
              <span>{t('switching.outer_eth')}</span><span style={{color:'var(--dim)'}}>14 Bytes</span>
            </div>
            <div style={{background:'var(--panel)', padding:'6px 12px', border:'1px solid var(--border)', borderRadius:4, fontSize:11, display:'flex', justifyContent:'space-between'}}>
              <span>{t('switching.outer_ip')}</span><span style={{color:'var(--dim)'}}>20 Bytes</span>
            </div>
            <div style={{background:'var(--panel)', padding:'6px 12px', border:'1px solid var(--border)', borderRadius:4, fontSize:11, display:'flex', justifyContent:'space-between'}}>
              <span>{t('switching.udp_hdr')}</span><span style={{color:'var(--dim)'}}>8 Bytes</span>
            </div>
            <div style={{background:'rgba(0, 212, 200, 0.1)', padding:'6px 12px', border:'1px solid var(--cyan)', borderRadius:4, fontSize:11, display:'flex', justifyContent:'space-between', fontWeight:600}}>
              <span>{t('switching.vxlan_hdr')}</span><span style={{color:'var(--cyan)'}}>8 Bytes</span>
            </div>
            <div style={{background:'var(--card)', padding:'12px', border:'1px dashed var(--dim)', borderRadius:4, fontSize:11, textAlign:'center', marginTop:4}}>
              <span style={{color:'var(--dim)'}}>{t('switching.orig_l2')}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('switching.deployment_model')}</div>
        <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.7}}>
          <strong style={{color:'var(--text)'}}>{t('switching.spine_leaf')}</strong> {t('switching.spine_leaf_desc')}
        </div>
      </div>
    </div>
  );
}

window.VXLANRef = VXLANRef;
