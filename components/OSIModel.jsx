const { useState, useEffect, useCallback, useRef, useMemo } = React;

function OSIModel() {
  const { t } = useTranslation();
  const data = useMemo(() => [
    { osi: 7, name: t('osi_model.application'), pdu: t('osi_model.data'), tcp: t('osi_model.application'), examples: t('osi_model.examples_layer_7'), span: 3 },
    { osi: 6, name: t('osi_model.presentation'), pdu: t('osi_model.data'), tcp: null, examples: t('osi_model.examples_layer_6') },
    { osi: 5, name: t('osi_model.session'), pdu: t('osi_model.data'), tcp: null, examples: t('osi_model.examples_layer_5') },
    { osi: 4, name: t('osi_model.transport'), pdu: t('osi_model.segments'), tcp: t('osi_model.transport'), examples: t('osi_model.examples_layer_4'), span: 1 },
    { osi: 3, name: t('osi_model.network'), pdu: t('osi_model.packets'), tcp: t('osi_model.internet'), examples: t('osi_model.examples_layer_3'), span: 1 },
    { osi: 2, name: t('osi_model.data_link'), pdu: t('osi_model.frames'), tcp: t('osi_model.network_access'), examples: t('osi_model.examples_layer_2'), span: 2 },
    { osi: 1, name: t('osi_model.physical'), pdu: t('osi_model.bits'), tcp: null, examples: t('osi_model.examples_layer_1') },
  ], [t]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('osi_model.title')}</div>
        <div className="table-wrap hide-mobile">
          <table className="osi-table">
            <thead>
              <tr>
                <th style={{width:100}}>{t('osi_model.osi_layer')}</th>
                <th style={{width:130}}>{t('osi_model.layer_name')}</th>
                <th style={{width:110}}>{t('osi_model.pdu')}</th>
                <th style={{width:140}}>{t('osi_model.tcp_layer')}</th>
                <th>{t('osi_model.examples')}</th>
              </tr>
            </thead>
            <tbody>
              {data.map((l, i) => {
                const tcpColor = l.tcp === t('osi_model.application') ? 'var(--layer-7)' : l.tcp === t('osi_model.transport') ? 'var(--layer-4)' : l.tcp === t('osi_model.internet') ? 'var(--layer-3)' : 'var(--layer-2)';
                return (
                  <tr key={l.osi} style={{borderLeft:`4px solid var(--layer-${l.osi})`}}>
                    <td style={{fontWeight:700,color:`var(--layer-${l.osi})`}}>
                      {t('osi_model.layer_n', {n: l.osi})}
                    </td>
                    <td style={{fontWeight:600}}>{l.name}</td>
                    <td style={{color:'var(--muted)',fontSize:12}}>{l.pdu}</td>
                    {l.tcp !== null ? (
                      <td rowSpan={l.span} style={{
                        verticalAlign:'middle',
                        textAlign:'center',
                        background: tcpColor,
                        color: '#fff',
                        fontWeight: 800,
                        fontSize: '11px',
                        padding: '0 12px',
                        textTransform: 'uppercase',
                        letterSpacing: '1px',
                        boxShadow: 'inset 0 0 40px rgba(0,0,0,0.2)',
                        border: 'none'
                      }}>
                        {l.tcp}
                      </td>
                    ) : null}
                    <td style={{fontSize:12,color:'var(--dim)'}}>{l.examples}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {data.map(l => (
            <div key={l.osi} className="mobile-card" style={{borderLeft:`4px solid var(--layer-${l.osi})`}}>
              <div className="mobile-card-row">
                <span className="mobile-card-label" style={{color:`var(--layer-${l.osi})`, fontWeight:700}}>{t('osi_model.layer_n', {n: l.osi})}</span>
                <span className="mobile-card-value" style={{fontWeight:600}}>{l.name}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('osi_model.pdu')} / TCP-IP</span>
                <span className="mobile-card-value">{l.pdu} {l.tcp ? `(${l.tcp})` : ''}</span>
              </div>
              <div className="mobile-card-row" style={{borderBottom:'none'}}>
                <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--dim)', fontSize:11}}>{l.examples}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="two-col grid-mobile-1">
        <div className="card">
          <div className="card-title">{t('osi_model.encap_flow')}</div>
          <div style={{display:'flex',flexDirection:'column',gap:8}}>
            {[7,4,3,2].map(l => {
              const item = data.find(d => d.osi === l);
              return (
                <div key={l} style={{
                  background:'var(--panel)', border:`1px solid var(--layer-${l})`, borderRadius:6, padding:'8px 12px',
                  display:'flex', justifyContent:'space-between', alignItems:'center'
                }}>
                  <div style={{fontSize:11,fontWeight:600}}>{item.name}</div>
                  <div style={{fontSize:10,color:'var(--dim)',fontFamily:'var(--mono)'}}>{item.pdu}</div>
                </div>
              );
            })}
            <div style={{textAlign:'center',color:'var(--muted)',fontSize:18}}>↓</div>
            <div style={{background:'var(--cyan)', color:'#000', borderRadius:6, padding:8, textAlign:'center', fontWeight:700, fontSize:12}}>{t('osi_model.physical_wire')}</div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('osi_model.key_concepts')}</div>
          <div style={{fontSize:12,color:'var(--muted)',lineHeight:1.6}}>
            <strong style={{color:'var(--text)'}}>{t('osi_model.osi_desc').split(': ')[0]}:</strong> {t('osi_model.osi_desc').split(': ')[1]}
            <br/><br/>
            <strong style={{color:'var(--text)'}}>{t('osi_model.tcp_desc').split(': ')[0]}:</strong> {t('osi_model.tcp_desc').split(': ')[1]}
            <br/><br/>
            <strong style={{color:'var(--text)'}}>{t('osi_model.encap_desc').split(': ')[0]}:</strong> {t('osi_model.encap_desc').split(': ')[1]}
            <br/><br/>
            <strong style={{color:'var(--text)'}}>{t('osi_model.deencap_desc').split(': ')[0]}:</strong> {t('osi_model.deencap_desc').split(': ')[1]}
          </div>
        </div>
      </div>

      <style>{`
        :root {
          --layer-7: #ef4444; --layer-6: #f97316; --layer-5: #f59e0b;
          --layer-4: #22c55e; --layer-3: #06b6d4; --layer-2: #3b82f6; --layer-1: #8b5cf6;
        }
        .osi-table { border-collapse: collapse; width: 100%; border: 1px solid var(--border); }
        .osi-table td { padding: 12px 8px; border: 1px solid var(--border); }
        .osi-table th { background: var(--panel); padding: 10px 8px; border: 1px solid var(--border); text-align: left; font-size: 11px; color: var(--muted); }
      `}</style>
    </div>
  );
}

// ─── Tool: Packet Header Map ────────────────────────────────
window.OSIModel = OSIModel;
