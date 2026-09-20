const { useState, useEffect, useCallback, useRef, useMemo } = React;

function MPLSRef() {
  const { t } = useTranslation();
  const [activeLabel, setActiveLabel] = useState(null);

  const labelFields = [
    { id: 'label', name: t('routing.label'), bits: 20, color: 'var(--cyan)',    desc: t('routing.label_desc') },
    { id: 'tc',    name: t('routing.tc'),    bits: 3,  color: 'var(--yellow)',  desc: t('routing.tc_desc') },
    { id: 's',     name: t('routing.s_bit'), bits: 1,  color: 'var(--green)',   desc: t('routing.s_desc') },
    { id: 'ttl',   name: t('routing.ttl'),   bits: 8,  color: 'var(--red)',     desc: t('routing.ttl_desc') },
  ];

  const totalBits = labelFields.reduce((s, f) => s + f.bits, 0);

  return (
    <div className="fadein">

      {/* Overview */}
      <div className="card">
        <div className="card-title" style={{color:'var(--cyan)'}}>{t('routing.mpls_title')} (<RFCLink rfc="RFC 3031" />)</div>
        <div style={{fontSize:13, color:'var(--muted)', lineHeight:1.7, marginBottom:16}}>
          {t('routing.mpls_desc')}
        </div>
        <div className="result-grid">
          <ResultItem label={t('routing.label_size')}       value="32 bits (4 bytes)"  accent />
          <ResultItem label={t('routing.label_field')}      value="20 bits (1M labels)" green />
          <ResultItem label={t('routing.stack_depth')}      value="Unlimited (nested)"  />
          <ResultItem label={t('routing.reserved_labels')}  value="0 – 15"              red />
        </div>
      </div>

      {/* Label header illustration */}
      <div className="card">
        <div className="card-title">{t('routing.mpls_header_title')} <span style={{fontSize:11,color:'var(--muted)',fontWeight:400}}>{t('routing.click_field')}</span></div>

        {/* Bit ruler */}
        <div style={{display:'grid', gridTemplateColumns:`repeat(${totalBits}, 1fr)`, gap:0, fontFamily:'var(--mono)', fontSize:9, color:'var(--dim)', marginBottom:2, textAlign:'center'}}>
          {Array.from({length: totalBits}, (_, i) => (
            <div key={i} style={{borderLeft: i % 8 === 0 ? '1px solid var(--dim)' : 'none', paddingLeft:1}}>
              {i % 4 === 0 ? i : ''}
            </div>
          ))}
        </div>

        {/* Field blocks */}
        <div style={{display:'grid', gridTemplateColumns:`repeat(${totalBits}, 1fr)`, gap:0, background:'var(--border)', padding:1, borderRadius:6}}>
          {labelFields.map(f => (
            <div
              key={f.id}
              onClick={() => setActiveLabel(activeLabel === f.id ? null : f.id)}
              style={{
                gridColumn: `span ${f.bits}`,
                background: activeLabel === f.id ? f.color : 'var(--panel)',
                border: `2px solid ${f.color}`,
                borderRadius:4, padding:'10px 4px', textAlign:'center', cursor:'pointer',
                transition:'all 0.15s',
                boxShadow: activeLabel === f.id ? `0 0 12px ${f.color}66` : 'none',
              }}
            >
              <div style={{fontSize:12, fontWeight:700, color: activeLabel === f.id ? '#000' : f.color, fontFamily:'var(--mono)'}}>{f.name}</div>
              <div style={{fontSize:9, color: activeLabel === f.id ? '#000' : 'var(--muted)'}}>{f.bits}b</div>
            </div>
          ))}
        </div>

        {/* Field detail panel */}
        {activeLabel && (() => {
          const f = labelFields.find(x => x.id === activeLabel);
          return (
            <div style={{marginTop:12, padding:'10px 14px', background:'var(--panel)', border:`1px solid ${f.color}`, borderRadius:6, fontSize:13, color:'var(--muted)', lineHeight:1.6}}>
              <span style={{color: f.color, fontWeight:700, marginRight:8}}>{f.name} ({f.bits} bits)</span>
              {f.desc}
            </div>
          );
        })()}

        {/* Legend */}
        <div style={{display:'flex', gap:20, marginTop:14, flexWrap:'wrap'}}>
          {labelFields.map(f => (
            <div key={f.id} style={{display:'flex', alignItems:'center', gap:6, fontSize:12}}>
              <div style={{width:12, height:12, borderRadius:3, background:f.color}}></div>
              <span style={{color:'var(--muted)'}}>{f.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Packet stack */}
      <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(400px, 1fr))', gap:20}} className="grid-mobile-1">
        <div className="card">
          <div className="card-title">{t('routing.encap_stack')}</div>
          <div style={{display:'flex', flexDirection:'column', gap:4}}>
            {[
              { label:'Ethernet Header',       bytes:'14 B', color:'var(--layer-2)',  note:'EtherType 0x8847 (unicast) / 0x8848 (multicast)' },
              { label: t('routing.label_outer'), bytes:'4 B',  color:'var(--cyan)',     note: t('routing.transport_label'), highlight: true },
              { label: t('routing.label_inner'), bytes:'4 B',  color:'var(--yellow)',   note: t('routing.vpn_label'), highlight: true },
              { label:'IP Header',             bytes:'20 B', color:'var(--layer-3)',  note: t('routing.ip_hdr_desc') },
              { label:'TCP / UDP',             bytes:'≥8 B', color:'var(--layer-4)',  note: t('routing.tcp_udp_desc') },
              { label:'Payload',               bytes:'— ',   color:'var(--dim)',      note: t('cheatsheet.use'), dashed: true },
            ].map((row, i) => (
              <div key={i} style={{
                background: row.highlight ? 'rgba(0,212,200,0.06)' : 'var(--panel)',
                border: `1px solid ${row.highlight ? row.color : 'var(--border)'}`,
                borderRadius:6, padding:'10px 14px',
                display:'flex', justifyContent:'space-between', alignItems:'center',
                borderStyle: row.dashed ? 'dashed' : 'solid',
                gap: 12
              }}>
                <div style={{minWidth:0, flex:1}}>
                  <div style={{fontSize:13, fontWeight: row.highlight ? 700 : 500, color: row.highlight ? row.color : 'var(--text)'}}>{row.label}</div>
                  <div style={{fontSize:11, color:'var(--muted)', marginTop:2, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap'}}>{row.note}</div>
                </div>
                <div style={{fontSize:12, color:'var(--dim)', fontFamily:'var(--mono)', whiteSpace:'nowrap', flexShrink:0}}>{row.bytes}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('routing.label_ops')}</div>
          <div style={{display:'flex', flexDirection:'column', gap:10}}>
            {[
              { op:'PUSH',  color:'var(--green)',  role:'Ingress LER', desc: t('routing.push_desc') },
              { op:'SWAP',  color:'var(--cyan)',   role:'Transit LSR', desc: t('routing.swap_desc') },
              { op:'POP',   color:'var(--yellow)', role:'Egress LER',  desc: t('routing.pop_desc') },
              { op:'PHP',   color:'var(--yellow)', role:'Penultimate', desc: t('routing.php_desc') },
            ].map(item => (
              <div key={item.op} style={{display:'flex', gap:14, alignItems:'flex-start', padding:'12px', background:'var(--panel)', borderRadius:8, border:'1px solid var(--border)'}}>
                <div style={{
                  minWidth:54, textAlign:'center', fontFamily:'var(--mono)', fontWeight:900, fontSize:14, 
                  color:item.color, padding:'4px 0', borderRadius:6, border:`1.5px solid ${item.color}`, 
                  background:`${item.color}15`, flexShrink:0, marginTop:2
                }}>{item.op}</div>
                <div style={{flex:1}}>
                  <div style={{fontSize:11, fontWeight:700, color:'var(--dim)', textTransform:'uppercase', letterSpacing:0.5, marginBottom:4}}>{item.role}</div>
                  <div style={{fontSize:13, color:'var(--text)', lineHeight:1.6}}>{item.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>


      {/* Reserved labels + key protocols */}
      <div className="two-col grid-mobile-1">
        <div className="card">
          <div className="card-title">{t('routing.reserved_values')}</div>
          <div style={{display:'flex', flexDirection:'column', gap:4}}>
            {[
              { val:'0',  name:'IPv4 Explicit Null',   desc:'Pop label, look at IPv4 header for forwarding.' },
              { val:'1',  name:'Router Alert',          desc:'Deliver to control plane of each LSR.' },
              { val:'2',  name:'IPv6 Explicit Null',    desc:'Pop label, look at IPv6 header for forwarding.' },
              { val:'3',  name:'Implicit Null (PHP)',   desc:'Signals penultimate hop to pop the label.' },
              { val:'13', name:'GAL (Generic Alert)',   desc:'OAM alert — next header is a G-ACh channel.' },
              { val:'14', name:'OAM Alert Label',       desc:'Used for MPLS OAM packets (deprecated by GAL).' },
            ].map(r => (
              <div key={r.val} style={{display:'flex', gap:10, alignItems:'baseline', fontSize:12}}>
                <div style={{minWidth:24, fontFamily:'var(--mono)', fontWeight:700, color:'var(--cyan)', textAlign:'right'}}>{r.val}</div>
                <div style={{color:'var(--text)', fontWeight:600}}>{r.name}</div>
                <div style={{color:'var(--dim)', fontSize:11}}>{r.desc}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('routing.ldp_protocols')}</div>
          <div style={{display:'flex', flexDirection:'column', gap:8}}>
            {[
              { name:'LDP',      rfc:<RFCLink rfc="RFC 5036" />, color:'var(--cyan)',   desc: t('routing.ldp_desc') },
              { name:'RSVP-TE',  rfc:<RFCLink rfc="RFC 3209" />, color:'var(--yellow)', desc: t('routing.rsvp_desc') },
              { name:'BGP-LU',   rfc:<RFCLink rfc="RFC 3107" />, color:'var(--green)',  desc: t('routing.bgp_lu_desc') },
              { name:'SR-MPLS',  rfc:<RFCLink rfc="RFC 8660" />, color:'var(--magenta)',desc: t('routing.sr_mpls_desc') },
            ].map(p => (
              <div key={p.name} style={{padding:'8px 10px', background:'var(--panel)', borderRadius:6, border:`1px solid var(--border)`, borderLeft:`3px solid ${p.color}`}}>
                <div style={{display:'flex', justifyContent:'space-between', marginBottom:3}}>
                  <span style={{fontWeight:700, color:p.color, fontSize:13}}>{p.name}</span>
                  <span style={{fontSize:10, color:'var(--dim)', fontFamily:'var(--mono)'}}>{p.rfc}</span>
                </div>
                <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.5}}>{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

    </div>
  );
}

window.MPLSRef = MPLSRef;
