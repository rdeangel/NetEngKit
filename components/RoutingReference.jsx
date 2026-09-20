const { useState, useEffect, useCallback, useRef, useMemo } = React;

function RoutingReference() {
  const { t } = useTranslation();
  const filtered = AD_DATA;

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('routing.proto_ref_title')}</div>
        <div className="table-wrap hide-mobile" style={{marginTop:16}}>
          <table>
            <thead><tr><th>{t('routing.ad_value')}</th><th>{t('routing.protocol')}</th><th>{t('routing.type')}</th><th>{t('routing.typical_use')}</th></tr></thead>
            <tbody>
              {filtered.map(r => (
                <tr key={r.ad}>
                  <td style={{color:'var(--cyan)',fontWeight:700,fontFamily:'var(--mono)'}}>{r.ad}</td>
                  <td style={{fontWeight:600}}>{r.name}</td>
                  <td><span className={`badge ${r.type==='IGP'?'badge-blue':r.type==='EGP'?'badge-purple':'badge-yellow'}`}>{r.type}</span></td>
                  <td style={{color:'var(--muted)',fontSize:12}}>{t(`routing.proto_${r.descKey.replace('route_', '')}`)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards" style={{marginTop:16}}>
          {filtered.map(r => (
            <div key={r.ad} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('routing.ad_value')}: {r.ad}</span>
                <span className="mobile-card-value" style={{fontWeight:600, color:'var(--cyan)'}}>{r.name}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('routing.type')}</span>
                <span className={`badge ${r.type==='IGP'?'badge-blue':r.type==='EGP'?'badge-purple':'badge-yellow'}`} style={{fontSize:10}}>{r.type}</span>
              </div>
              <div className="mobile-card-row" style={{borderBottom:'none'}}>
                <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{t(`routing.proto_${r.descKey.replace('route_', '')}`)}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="hint" style={{marginTop:8}}>{t('routing.ad_hint')}</div>
      </div>

      <div className="two-col grid-mobile-1">
        <div className="card">
          <div className="card-title" style={{color:'var(--green)'}}>{t('routing.ospf_dive')}</div>
          <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
            <strong style={{color:'var(--text)'}}>{t('routing.lsa_types')}</strong>
            <ul style={{marginTop:4,paddingLeft:16}}>
              <li><strong style={{color:'var(--cyan)'}}>Type 1:</strong> {t('routing.lsa_1')}</li>
              <li><strong style={{color:'var(--cyan)'}}>Type 2:</strong> {t('routing.lsa_2')}</li>
              <li><strong style={{color:'var(--cyan)'}}>Type 3:</strong> {t('routing.lsa_3')}</li>
              <li><strong style={{color:'var(--cyan)'}}>Type 4:</strong> {t('routing.lsa_4')}</li>
              <li><strong style={{color:'var(--cyan)'}}>Type 5:</strong> {t('routing.lsa_5')}</li>
              <li><strong style={{color:'var(--yellow)'}}>Type 7:</strong> {t('routing.lsa_7')}</li>
              <li><strong style={{color:'var(--muted)'}}>Type 8:</strong> {t('routing.lsa_8')}</li>
              <li><strong style={{color:'var(--muted)'}}>Type 9:</strong> {t('routing.lsa_9')}</li>
            </ul>
            <strong style={{color:'var(--text)',marginTop:8,display:'block'}}>{t('routing.area_types')}</strong>
            <ul style={{marginTop:4,paddingLeft:16}}>
              <li>{t('routing.area_0')}</li>
              <li>{t('routing.area_stub')}</li>
              <li>{t('routing.area_totally')}</li>
              <li>{t('routing.area_nssa')}</li>
            </ul>
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{color:'var(--purple)'}}>{t('routing.bgp_dive')}</div>
          <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
            <strong style={{color:'var(--text)'}}>{t('routing.bgp_best_path')}</strong>
            <ol style={{marginTop:4,paddingLeft:16}}>
              <li>{t('routing.bgp_weight')}</li>
              <li>{t('routing.bgp_local_pref')}</li>
              <li>{t('routing.bgp_originate')}</li>
              <li>{t('routing.bgp_as_path')}</li>
              <li>{t('routing.bgp_origin')}</li>
              <li>{t('routing.bgp_med')}</li>
              <li>{t('routing.bgp_ebgp_ibgp')}</li>
            </ol>
            <strong style={{color:'var(--text)',marginTop:8,display:'block'}}>{t('routing.neighbor_states')}</strong>
            <div style={{display:'flex',flexWrap:'wrap',gap:4,marginTop:4}}>
              <span className="badge badge-blue">{t('routing.bgp_idle')}</span>
              <span className="badge badge-blue">{t('routing.bgp_connect')}</span>
              <span className="badge badge-blue">{t('routing.bgp_active')}</span>
              <span className="badge badge-blue">{t('routing.bgp_opensent')}</span>
              <span className="badge badge-blue">{t('routing.bgp_openconfirm')}</span>
              <span className="badge badge-green">{t('routing.bgp_established')}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="two-col grid-mobile-1">
        <div className="card">
          <div className="card-title" style={{color:'var(--cyan)'}}>{t('routing.eigrp_dive')}</div>
          <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
            <strong style={{color:'var(--text)'}}>{t('routing.metric_classic')}</strong>
            <div style={{background:'var(--panel)',padding:8,borderRadius:4,fontFamily:'var(--mono)',color:'var(--cyan)',marginTop:4}}>
              256 * ((10⁷ / Bandwidth) + Delay)
            </div>
            <div style={{marginTop:4,fontSize:10}}>{t('routing.k_values')}</div>

            <strong style={{color:'var(--text)',marginTop:8,display:'block'}}>{t('routing.packet_types')}</strong>
            <ul style={{marginTop:4,paddingLeft:16}}>
              <li><strong style={{color:'var(--text)'}}>{t('routing.pkt_hello')}</strong></li>
              <li><strong style={{color:'var(--text)'}}>{t('routing.pkt_update')}</strong></li>
              <li><strong style={{color:'var(--text)'}}>{t('routing.pkt_query')}</strong></li>
              <li><strong style={{color:'var(--text)'}}>{t('routing.pkt_reply')}</strong></li>
              <li><strong style={{color:'var(--text)'}}>{t('routing.pkt_ack')}</strong></li>
            </ul>
            <strong style={{color:'var(--text)',marginTop:8,display:'block'}}>{t('routing.key_concepts')}</strong>
            <div style={{marginTop:4}}>{t('routing.eigrp_concepts')}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-title" style={{color:'var(--yellow)'}}>{t('routing.isis_dive')}</div>
          <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.7}}>
            <strong style={{color:'var(--text)'}}>{t('routing.hierarchy')}</strong>
            <ul style={{marginTop:4,paddingLeft:16}}>
              <li><strong style={{color:'var(--text)'}}>{t('routing.isis_l1')}</strong></li>
              <li><strong style={{color:'var(--text)'}}>{t('routing.isis_l2')}</strong></li>
              <li><strong style={{color:'var(--text)'}}>{t('routing.isis_l1l2')}</strong></li>
            </ul>
            <strong style={{color:'var(--text)',marginTop:8,display:'block'}}>{t('routing.nsap_addr')}</strong>
            <div style={{background:'var(--panel)',padding:8,borderRadius:4,fontFamily:'var(--mono)',fontSize:11,marginTop:4}}>
              49.0001.<span style={{color:'var(--cyan)'}}>0000.0000.0001</span>.00
            </div>
            <div style={{marginTop:4,fontSize:10}}>{t('routing.isis_id')}</div>

            <strong style={{color:'var(--text)',marginTop:8,display:'block'}}>{t('routing.pdus')}</strong>
            <div style={{marginTop:4}}>{t('routing.isis_pdus')}</div>
          </div>
        </div>
      </div>

      <div className="card fadein">
        <div className="card-title">{t('routing.timer_ref_title')}</div>
        <div className="table-wrap hide-mobile">
          <table>
            <thead>
              <tr>
                <th>{t('routing.protocol')}</th>
                <th>{t('routing.hello_keepalive')}</th>
                <th>{t('routing.hold_dead')}</th>
                <th>{t('routing.update_other')}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td style={{fontWeight:600,color:'var(--green)'}}>OSPF</td>
                <td>10s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_bcast_p2p')}</span> / 30s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_nbma')}</span></td>
                <td>40s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_bcast_p2p')}</span> / 120s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_nbma')}</span></td>
                <td>Wait: 40s / Rx: 5s</td>
              </tr>
              <tr>
                <td style={{fontWeight:600,color:'var(--cyan)'}}>EIGRP</td>
                <td>5s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_lan_p2p')}</span> / 60s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_low_speed')}</span></td>
                <td>15s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_lan_p2p')}</span> / 180s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_low_speed')}</span></td>
                <td>—</td>
              </tr>
              <tr>
                <td style={{fontWeight:600,color:'var(--purple)'}}>BGP</td>
                <td>60s</td>
                <td>180s</td>
                <td>Retry: 5s</td>
              </tr>
              <tr>
                <td style={{fontWeight:600,color:'var(--yellow)'}}>IS-IS</td>
                <td>10s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_l1_l2')}</span> / 3.3s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_dis')}</span></td>
                <td>30s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_l1_l2')}</span> / 10s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_dis')}</span></td>
                <td>—</td>
              </tr>
              <tr>
                <td style={{fontWeight:600}}>RIP</td>
                <td>—</td>
                <td>180s <span style={{fontSize:10,color:'var(--dim)'}}>{t('routing.timer_invalid')}</span></td>
                <td>Update: 30s / Flush: 240s</td>
              </tr>
            </tbody>
          </table>
        </div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {[
            {p:'OSPF', h:'10s / 30s', d:'40s / 120s', o:'Wait 40s', c:'var(--green)'},
            {p:'EIGRP', h:'5s / 60s', d:'15s / 180s', o:'-', c:'var(--cyan)'},
            {p:'BGP', h:'60s', d:'180s', o:'Retry 5s', c:'var(--purple)'},
            {p:'IS-IS', h:'10s / 3s', d:'30s / 10s', o:'-', c:'var(--yellow)'},
            {p:'RIP', h:'-', d:'180s', o:'Update 30s', c:'var(--text)'},
          ].map(t_row => (
            <div key={t_row.p} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('routing.protocol')}</span>
                <span className="mobile-card-value" style={{fontWeight:600, color:t_row.c}}>{t_row.p}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('routing.hello_keepalive').split(' / ')[0]} / {t('routing.hold_dead').split(' / ')[1]}</span>
                <span className="mobile-card-value">{t_row.h} / {t_row.d}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('routing.update_other').split(' / ')[0]}</span>
                <span className="mobile-card-value">{t_row.o}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="hint" style={{marginTop:8}}>{t('routing.timer_hint')}</div>
      </div>
    </div>
  );
}

// ─── Tool: Switching & Infrastructure Reference ───────────
// ─── VPN / IPsec Architect ──────────────────────────────────────
window.RoutingReference = RoutingReference;
