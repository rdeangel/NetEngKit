const { useState, useEffect, useCallback, useRef, useMemo } = React;

function IPv6Transition() {
  const { t } = useTranslation();
  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('ipv6_trans.title')}</div>
        <div className="result-grid grid-mobile-1" style={{gap:16}}>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, borderLeft:'4px solid var(--cyan)'}}>
            <strong style={{color:'var(--cyan)', fontSize:14}}>{t('ipv6_trans.dual_stack')}</strong>
            <p style={{fontSize:11, color:'var(--muted)', marginTop:6, lineHeight:1.4}}>{t('ipv6_trans.dual_stack_desc')}</p>
          </div>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, borderLeft:'4px solid var(--green)'}}>
            <strong style={{color:'var(--green)', fontSize:14}}>{t('ipv6_trans.nat64')}</strong>
            <p style={{fontSize:11, color:'var(--muted)', marginTop:6, lineHeight:1.4}}>{t('ipv6_trans.nat64_desc')}</p>
          </div>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, borderLeft:'4px solid var(--yellow)'}}>
            <strong style={{color:'var(--yellow)', fontSize:14}}>{t('ipv6_trans.xlat')}</strong>
            <p style={{fontSize:11, color:'var(--muted)', marginTop:6, lineHeight:1.4}}>{t('ipv6_trans.xlat_desc')}</p>
          </div>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, borderLeft:'4px solid var(--blue)'}}>
            <strong style={{color:'var(--blue)', fontSize:14}}>{t('ipv6_trans.dslite')}</strong>
            <p style={{fontSize:11, color:'var(--muted)', marginTop:6, lineHeight:1.4}}>{t('ipv6_trans.dslite_desc')}</p>
          </div>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, borderLeft:'4px solid var(--red)'}}>
            <strong style={{color:'var(--red)', fontSize:14}}>{t('ipv6_trans.mape')}</strong>
            <p style={{fontSize:11, color:'var(--muted)', marginTop:6, lineHeight:1.4}}>{t('ipv6_trans.mape_desc')}</p>
          </div>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, borderLeft:'4px solid var(--purple)'}}>
            <strong style={{color:'var(--purple)', fontSize:14}}>{t('ipv6_trans.gre')}</strong>
            <p style={{fontSize:11, color:'var(--muted)', marginTop:6, lineHeight:1.4}}>{t('ipv6_trans.gre_desc')}</p>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('ipv6_trans.comparison')}</div>
        <div className="table-wrap hide-mobile">
          <table>
            <thead>
              <tr>
                <th>{t('ipv6_trans.mechanism')}</th>
                <th>{t('subnet.type')}</th>
                <th>{t('common.th_status')}</th>
                <th>{t('ipv6_trans.key_use_case')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td><span className="badge badge-cyan">{t('ipv6_trans.dual_stack')}</span></td>
                <td>{t('common.native')}</td>
                <td>{t('ipv6_trans.status_stateful')}</td>
                <td>{t('ipv6_trans.use_case_dual_stack')}</td>
              </tr>
              <tr>
                <td><span className="badge badge-green">{t('ipv6_trans.nat64')}</span></td>
                <td>{t('common.translation')}</td>
                <td>{t('ipv6_trans.status_stateful')}</td>
                <td>{t('ipv6_trans.use_case_nat64')}</td>
              </tr>
              <tr>
                <td><span className="badge badge-yellow">{t('ipv6_trans.xlat')}</span></td>
                <td>{t('common.translation')}</td>
                <td>{t('ipv6_trans.status_stateful')}</td>
                <td>{t('ipv6_trans.use_case_xlat')}</td>
              </tr>
              <tr>
                <td><span className="badge badge-blue">{t('ipv6_trans.dslite')}</span></td>
                <td>{t('common.tunneling')}</td>
                <td>{t('ipv6_trans.status_stateful')}</td>
                <td>{t('ipv6_trans.use_case_dslite')}</td>
              </tr>
              <tr>
                <td><span className="badge badge-red">{t('ipv6_trans.mape')}</span></td>
                <td>{t('common.encapsulation')}</td>
                <td>{t('ipv6_trans.status_stateless')}</td>
                <td>{t('ipv6_trans.use_case_mape')}</td>
              </tr>
              <tr>
                <td><span className="badge badge-purple">{t('ipv6_trans.gre')}</span></td>
                <td>{t('common.tunneling')}</td>
                <td>{t('ipv6_trans.status_static')}</td>
                <td>{t('ipv6_trans.use_case_gre')}</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {[
            {m:t('ipv6_trans.dual_stack'), t:t('common.native'), s:'N/A', c:'badge-cyan'},
            {m:t('ipv6_trans.nat64'), t:t('common.translation'), s:t('ipv6_trans.status_stateful'), c:'badge-green'},
            {m:t('ipv6_trans.xlat'), t:t('common.translation'), s:t('ipv6_trans.status_stateful'), c:'badge-yellow'},
            {m:t('ipv6_trans.dslite'), t:t('common.tunneling'), s:t('ipv6_trans.status_stateful'), c:'badge-blue'},
            {m:t('ipv6_trans.mape'), t:t('common.encapsulation'), s:t('ipv6_trans.status_stateless'), c:'badge-red'},
            {m:t('ipv6_trans.gre'), t:t('common.tunneling'), s:t('ipv6_trans.status_static'), c:'badge-purple'}
          ].map(v => (
            <div key={v.m} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('ipv6_trans.mechanism')}</span>
                <span className={`badge ${v.c}`}>{v.m}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('subnet.type')} / Status</span>
                <span className="mobile-card-value">{v.t} / {v.s}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col grid-mobile-1">
        <div className="card">
          <div className="card-title">{t('ipv6_trans.flow_nat64')}</div>
          <div style={{fontFamily:'var(--mono)', fontSize:11, padding:15, background:'var(--panel)', border:'1px solid var(--border)', borderRadius:8, color:'var(--dim)'}}>
            <div style={{color:'var(--text)'}}>[ IPv6 Client ] ----&gt; [ NAT64 GW ] ----&gt; [ IPv4 Server ]</div>
            <div style={{marginTop:10}}>
              <span style={{color:'var(--cyan)'}}>SRC: 2001:db8::1</span><br/>
              <span style={{color:'var(--green)'}}>DST: 64:ff9b::1.1.1.1</span> {t('ipv6_trans.flow_synthesized')}
            </div>
            <div style={{margin:'10px 0', borderLeft:'2px dashed var(--dim)', marginLeft:60, paddingLeft:10}}>
               {t('ipv6_trans.status_stateful')} {t('ipv6_trans.translation_label')}
            </div>
            <div>
              <span style={{color:'var(--yellow)'}}>SRC: 203.0.113.5</span> {t('ipv6_trans.flow_pool_v4')}<br/>
              <span style={{color:'var(--text)'}}>DST: 1.1.1.1</span> {t('ipv6_trans.flow_actual_v4')}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('ipv6_trans.flow_dslite')}</div>
          <div style={{fontFamily:'var(--mono)', fontSize:11, padding:15, background:'var(--panel)', border:'1px solid var(--border)', borderRadius:8, color:'var(--dim)'}}>
            <div style={{color:'var(--text)'}}>[ CPE (B4) ] ===== IPv6 Tunnel ===== [ Carrier (AFTR) ]</div>
            <div style={{marginTop:10}}>
              <span style={{color:'var(--yellow)'}}>Inner v4: 192.168.1.10 -&gt; 8.8.8.8</span><br/>
              <span style={{color:'var(--blue)'}}>Outer v6: 2001:db8::B4 -&gt; 2001:db8::AFTR</span>
            </div>
            <div style={{margin:'10px 0', borderLeft:'2px dashed var(--dim)', marginLeft:60, paddingLeft:10}}>
               {t('ipv6_trans.flow_decaps_nat')}
            </div>
            <div>
              <span style={{color:'var(--cyan)'}}>Public: 198.51.100.1 -&gt; 8.8.8.8</span><br/>
              <span style={{color:'var(--dim)'}}>{t('ipv6_trans.flow_shared_pool')}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('ipv6_trans.term_ref')}</div>
        <div className="result-grid grid-mobile-1" style={{gap:20}}>
          <div>
            <div style={{fontSize:12, fontWeight:600, color:'var(--cyan)', marginBottom:4}}>B4 (Basic Bridging BroadBand)</div>
            <p style={{fontSize:11, color:'var(--muted)'}}>{t('ipv6_trans.b4_desc')}</p>
          </div>
          <div>
            <div style={{fontSize:12, fontWeight:600, color:'var(--green)', marginBottom:4}}>AFTR (Address Family Transition Router)</div>
            <p style={{fontSize:11, color:'var(--muted)'}}>{t('ipv6_trans.aftr_desc')}</p>
          </div>
          <div>
            <div style={{fontSize:12, fontWeight:600, color:'var(--yellow)', marginBottom:4}}>CLAT / PLAT</div>
            <p style={{fontSize:11, color:'var(--muted)'}}>{t('ipv6_trans.clat_plat_desc')}</p>
          </div>
          <div>
            <div style={{fontSize:12, fontWeight:600, color:'var(--purple)', marginBottom:4}}><RFCLink rfc="RFC 6052" /> Prefix</div>
            <p style={{fontSize:11, color:'var(--muted)'}}>{t('ipv6_trans.rfc6052_desc')}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BGP Looking Glass ──────────────────────────────────────────
window.IPv6Transition = IPv6Transition;
