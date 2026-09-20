const { useState, useCallback } = React;

const WELL_KNOWN = [
  { name: 'NO_EXPORT (65535:65281)',          value: '65535:65281', desc: 'Do not advertise beyond the local AS boundary (not sent to eBGP peers).' },
  { name: 'NO_ADVERTISE (65535:65282)',        value: '65535:65282', desc: 'Do not advertise to ANY peer (iBGP or eBGP). Route stays local.' },
  { name: 'NO_EXPORT_SUBCONFED (65535:65283)', value: '65535:65283', desc: 'Do not export to sub-AS peers (used in confederations). Stays within the sub-AS.' },
  { name: 'LOCAL_AS (65535:65283)',            value: '65535:65283', desc: <span>Alias for NO_EXPORT_SUBCONFED per <RFCLink rfc="RFC 4893" /> / <RFCLink rfc="RFC 1997" />.</span> },
  { name: 'BLACKHOLE (65535:666)',             value: '65535:666',   desc: 'RTBH — Remote Triggered Black Hole. Widely accepted by IXPs and upstreams for DDoS mitigation.' },
  { name: 'GRACEFUL_SHUTDOWN (65535:0)',       value: '65535:0',     desc: <span><RFCLink rfc="RFC 8326" /> — signals a peer is going down for maintenance. Receiving routers lower local preference to 0.</span> },
];

const BGP_PRESETS = [
  { label: 'Prepend ×1 to upstream (common ISP)',  communities: '65000:100',  desc: 'Signal upstreams to add 1 AS path prepend.' },
  { label: 'Prepend ×2 to upstream',              communities: '65000:200',  desc: 'Signal upstreams to add 2 prepends (makes route less preferred).' },
  { label: 'No export to upstreams',              communities: '65535:65281', desc: 'Suppress advertisement to all eBGP peers.' },
  { label: 'RTBH blackhole',                      communities: '65535:666',  desc: 'Remote Triggered Black Hole — discard matching traffic.' },
  { label: 'Customer routes (tag for policy)',    communities: '65000:1000', desc: 'Internal tagging: customer-learned routes.' },
  { label: 'Peer routes (tag for policy)',        communities: '65000:2000', desc: 'Internal tagging: peering-learned routes.' },
  { label: 'Transit/upstream routes',            communities: '65000:3000', desc: 'Internal tagging: transit/upstream-learned routes.' },
  { label: 'Graceful shutdown (maintenance)',     communities: '65535:0',    desc: <span><RFCLink rfc="RFC 8326" /> — lower local-pref on receiving routers to drain traffic before maintenance.</span> },
];

const EXT_TYPES = [
  { label: 'Route Target (0x0002)',       type: '0002', desc: 'VPN route import/export policy (MPLS VPN, EVPN).' },
  { label: 'Route Origin (0x0003)',       type: '0003', desc: 'Identifies the origin routing policy of a VPN route.' },
  { label: 'IPv4 Source AS (0x0007)',     type: '0007', desc: 'Carries the source AS number for multicast RPF.' },
  { label: 'Encapsulation (0x030c)',      type: '030c', desc: 'EVPN / BGP-LU — signals tunnel encapsulation type.' },
  { label: 'Traffic Rate (FlowSpec)',     type: 'traffic-rate', desc: <span><RFCLink rfc="RFC 5575" /> — rate-limit in bits/sec for FlowSpec actions.</span> },
  { label: 'Redirect AS:VRF (FlowSpec)', type: 'redirect', desc: <span><RFCLink rfc="RFC 5575" /> — redirect traffic to a VRF.</span> },
];

function decodeCommunity(val) {
  const trimmed = val.trim();
  // Standard: ASN:value
  const std = trimmed.match(/^(\d+):(\d+)$/);
  if (std) {
    const asn = parseInt(std[1], 10);
    const v   = parseInt(std[2], 10);
    const raw = (asn * 65536 + v) >>> 0;
    return {
      format: 'Standard',
      asn, value: v,
      raw32: raw,
      hex: '0x' + raw.toString(16).toUpperCase().padStart(8, '0'),
      wellKnown: WELL_KNOWN.find(w => w.value === trimmed) || null,
    };
  }
  // Raw 32-bit decimal
  const raw32 = parseInt(trimmed, 10);
  if (!isNaN(raw32) && raw32 >= 0 && raw32 <= 4294967295) {
    const asn = Math.floor(raw32 / 65536);
    const v   = raw32 % 65536;
    return {
      format: 'Standard (from raw 32-bit)',
      asn, value: v,
      raw32,
      hex: '0x' + raw32.toString(16).toUpperCase().padStart(8, '0'),
      canonical: `${asn}:${v}`,
      wellKnown: WELL_KNOWN.find(w => w.value === `${asn}:${v}`) || null,
    };
  }
  // Large community: ASN:value1:value2
  const large = trimmed.match(/^(\d+):(\d+):(\d+)$/);
  if (large) {
    return {
      format: 'Large Community (RFC 8092)',
      globalAdmin: parseInt(large[1], 10),
      localData1: parseInt(large[2], 10),
      localData2: parseInt(large[3], 10),
    };
  }
  return null;
}

function encodeCommunity(asn, val) {
  const a = parseInt(asn, 10);
  const v = parseInt(val, 10);
  if (isNaN(a) || isNaN(v) || a < 0 || a > 65535 || v < 0 || v > 65535) return null;
  const raw = (a * 65536 + v) >>> 0;
  return {
    standard: `${a}:${v}`,
    raw32: raw,
    hex: '0x' + raw.toString(16).toUpperCase().padStart(8, '0'),
  };
}

const BGP_PLATFORMS = [
  { id: 'cisco-ios', label: 'Cisco IOS/IOS-XE' },
  { id: 'cisco-nxos', label: 'Cisco NX-OS' },
  { id: 'junos', label: 'Juniper JunOS' },
  { id: 'frr', label: 'FRR / Quagga' },
  { id: 'bird', label: 'BIRD2' },
];

function genRouteMap(comms, asn, platform, action) {
  const commList = comms.split(/[\s,]+/).filter(Boolean);
  const act = action === 'permit' ? 'permit' : 'deny';
  if (platform === 'cisco-ios') {
    const matchLine = commList.map((c, i) =>
      i === 0 ? `  match community ${asn}_COMM_LIST` : ''
    ).filter(Boolean).join('\n');
    return (
`! Community list (standard):
ip community-list standard ${asn}_COMM_LIST permit ${commList.join(' ')}

! Route-map:
route-map SET_COMM_RM ${act} 10
  match community ${asn}_COMM_LIST
  set community ${commList.join(' ')} additive

! Apply to neighbor:
router bgp ${asn}
 neighbor <peer-ip> route-map SET_COMM_RM in`
    );
  }
  if (platform === 'cisco-nxos') {
    return (
`! NX-OS community list:
ip community-list standard ${asn}_COMM_LIST permit ${commList.join(' ')}

! Route-policy:
route-map SET_COMM_RM ${act} 10
  match community ${asn}_COMM_LIST
  set community ${commList.join(' ')} additive

router bgp ${asn}
  neighbor <peer-ip>
    address-family ipv4 unicast
      route-map SET_COMM_RM in`
    );
  }
  if (platform === 'junos') {
    const terms = commList.map((c, i) =>
`    community ${c.replace(':','_')} members ${c};`
    ).join('\n');
    return (
`# JunOS community + policy:
policy-options {
  community COMM_${asn} {
    members [ ${commList.join(' ')} ];
  }
  policy-statement SET_COMM {
    term MATCH_COMM {
      from community COMM_${asn};
      then {
        community ${act === 'permit' ? 'add' : 'delete'} COMM_${asn};
        accept;
      }
    }
  }
}
protocols {
  bgp {
    group PEER_GROUP {
      import SET_COMM;
    }
  }
}`
    );
  }
  if (platform === 'frr') {
    return (
`# FRR (FRRouting) community:
bgp community-list standard COMM_LIST permit ${commList.join(' ')}

route-map SET_COMM_RM ${act} 10
 match community COMM_LIST
 set community ${commList.join(' ')} additive

router bgp ${asn}
 neighbor <peer-ip> route-map SET_COMM_RM in`
    );
  }
  if (platform === 'bird') {
    return (
`# BIRD2 community filter:
filter SET_COMM {
  if bgp_community ~ [ ${commList.map(c => `(${c.replace(':',',')})`).join(', ')} ] then {
    bgp_community.add((${commList[0].replace(':',',')}));
    accept;
  }
  reject;
}`
    );
  }
  return '';
}

function BGPCommunity({ onShare, initialData }) {
  const { t } = useTranslation();
  const [tab,       setTab]     = usePersistentState('bgp-comm:tab', 'decode');
  const [decInput,  setDecInput] = usePersistentState('bgp-comm:decInput', initialData?.decInput ?? '');
  const [decResult, setDecResult] = usePersistentState('bgp-comm:decResult', null);
  const [decErr,    setDecErr]  = useState('');
  const [encAsn,    setEncAsn]  = usePersistentState('bgp-comm:encAsn', initialData?.encAsn ?? '65000');
  const [encVal,    setEncVal]  = usePersistentState('bgp-comm:encVal', initialData?.encVal ?? '100');
  const [encResult, setEncResult] = usePersistentState('bgp-comm:encResult', null);
  const [genComms,  setGenComms] = usePersistentState('bgp-comm:genComms', initialData?.genComms ?? '65000:100');
  const [genAsn,    setGenAsn]  = usePersistentState('bgp-comm:genAsn', initialData?.genAsn ?? '65000');
  const [genPlat,   setGenPlat] = usePersistentState('bgp-comm:genPlat', initialData?.genPlat ?? 'cisco-ios');
  const [genAct,    setGenAct]  = usePersistentState('bgp-comm:genAct', 'permit');
  const [genOut,    setGenOut]  = usePersistentState('bgp-comm:genOut', '');

  const runDecode = useCallback(() => {
    setDecErr('');
    const r = decodeCommunity(decInput);
    if (!r) setDecErr('Unrecognized format. Enter ASN:value (e.g. 65000:100), raw 32-bit integer, or large community (ASN:v1:v2).');
    else setDecResult(r);
  }, [decInput]);

  const runEncode = useCallback(() => {
    setEncResult(encodeCommunity(encAsn, encVal));
  }, [encAsn, encVal]);

  const runGen = useCallback(() => {
    setGenOut(genRouteMap(genComms, genAsn, genPlat, genAct));
  }, [genComms, genAsn, genPlat, genAct]);

  const tabBtn = (id, label) => (
    <button className={`btn ${tab===id?'btn-primary':'btn-ghost'}`} style={{fontSize:12}} onClick={() => setTab(id)}>{label}</button>
  );

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('bgp_comm.title', 'BGP Community Builder')}</div>
        <div style={{fontSize:12,color:'var(--muted)',marginBottom:14}}>
          {t('bgp_comm.subtitle', 'Decode and encode BGP communities (standard, large), reference well-known values, and generate route-map/policy config for common platforms.')}
        </div>
        <div style={{display:'flex',gap:8,flexWrap:'wrap'}}>
          {tabBtn('decode',  t('bgp_comm.tab_decode', 'Decode'))}
          {tabBtn('encode',  t('bgp_comm.tab_encode', 'Encode'))}
          {tabBtn('ref',     t('bgp_comm.tab_ref',    'Well-Known'))}
          {tabBtn('gen',     t('bgp_comm.tab_gen',    'Route-Map Generator'))}
        </div>
      </div>

      {/* ── Decode ── */}
      {tab === 'decode' && (
        <div className="card fadein">
          <div className="card-title" style={{marginBottom:8}}>{t('bgp_comm.decode_title', 'Decode Community Value')}</div>
          <div style={{marginBottom:12,fontSize:12,color:'var(--muted)'}}>
            Accepts: <code>ASN:value</code> (standard), raw 32-bit decimal, or <code>ASN:v1:v2</code> (large community).
          </div>
          <div style={{display:'flex',gap:8,alignItems:'flex-end',flexWrap:'wrap'}}>
            <div className="field" style={{flex:1,minWidth:200}}>
              <label className="label">{t('bgp_comm.community_value', 'Community Value')}</label>
              <input className="input" style={{fontFamily:'var(--mono)'}}
                value={decInput} onChange={e => { setDecInput(e.target.value); setDecResult(null); setDecErr(''); }}
                placeholder="65535:65281  or  4294934529  or  65000:1:100"
              />
            </div>
            <div className="field">
              <label className="label">&nbsp;</label>
              <button className="btn btn-primary" onClick={runDecode}>{t('bgp_comm.decode_btn', 'Decode')}</button>
            </div>
          </div>

          <div style={{marginBottom:10,fontSize:11,color:'var(--muted)'}}>Presets:</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
            {BGP_PRESETS.map(p => (
              <button key={p.communities} className="btn btn-ghost" style={{fontSize:11,padding:'3px 10px'}}
                onClick={() => { setDecInput(p.communities); setDecResult(null); setDecErr(''); }}>
                {p.communities}
              </button>
            ))}
          </div>

          {decErr && <div style={{fontSize:12,color:'#e05252',marginTop:4}}>{decErr}</div>}
          {decResult && (
            <div style={{marginTop:12,padding:14,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)'}}>
              <div style={{fontSize:12,fontWeight:600,color:'var(--cyan)',marginBottom:10}}>{decResult.format}</div>
              <div style={{display:'grid',gridTemplateColumns:'140px 1fr',rowGap:6,fontSize:12}}>
                {decResult.asn !== undefined && <>
                  <span style={{color:'var(--muted)'}}>AS Number:</span>
                  <span style={{fontFamily:'var(--mono)',color:'var(--text)',fontWeight:600}}>{decResult.asn}</span>
                  <span style={{color:'var(--muted)'}}>Value:</span>
                  <span style={{fontFamily:'var(--mono)',color:'var(--text)',fontWeight:600}}>{decResult.value}</span>
                  <span style={{color:'var(--muted)'}}>Canonical:</span>
                  <span style={{fontFamily:'var(--mono)',color:'var(--text)'}}>{decResult.canonical || `${decResult.asn}:${decResult.value}`}</span>
                  <span style={{color:'var(--muted)'}}>Raw 32-bit:</span>
                  <span style={{fontFamily:'var(--mono)',color:'var(--text)'}}>{decResult.raw32} ({decResult.hex})</span>
                </>}
                {decResult.globalAdmin !== undefined && <>
                  <span style={{color:'var(--muted)'}}>Global Admin:</span>
                  <span style={{fontFamily:'var(--mono)',color:'var(--text)',fontWeight:600}}>{decResult.globalAdmin}</span>
                  <span style={{color:'var(--muted)'}}>Local Data 1:</span>
                  <span style={{fontFamily:'var(--mono)',color:'var(--text)'}}>{decResult.localData1}</span>
                  <span style={{color:'var(--muted)'}}>Local Data 2:</span>
                  <span style={{fontFamily:'var(--mono)',color:'var(--text)'}}>{decResult.localData2}</span>
                </>}
              </div>
              {decResult.wellKnown && (
                <div style={{marginTop:10,padding:10,background:'var(--bg)',borderLeft:'4px solid var(--cyan)',borderRadius:4,fontSize:12}}>
                  <div style={{fontWeight:600,color:'var(--text)',marginBottom:4}}>{decResult.wellKnown.name}</div>
                  <div style={{color:'var(--muted)'}}>{decResult.wellKnown.desc}</div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Encode ── */}
      {tab === 'encode' && (
        <div className="card fadein">
          <div className="card-title" style={{marginBottom:8}}>{t('bgp_comm.encode_title', 'Encode Standard Community')}</div>
          <div className="two-col grid-mobile-1">
            <div className="field">
              <label className="label">AS Number (0–65535)</label>
              <input className="input" style={{fontFamily:'var(--mono)'}} value={encAsn} onChange={e => { setEncAsn(e.target.value); setEncResult(null); }} placeholder="65000" />
            </div>
            <div className="field">
              <label className="label">Value (0–65535)</label>
              <input className="input" style={{fontFamily:'var(--mono)'}} value={encVal} onChange={e => { setEncVal(e.target.value); setEncResult(null); }} placeholder="100" />
            </div>
          </div>
          <button className="btn btn-primary" onClick={runEncode}>{t('bgp_comm.encode_btn', 'Encode')}</button>
          {encResult && (
            <div style={{marginTop:14,padding:14,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)'}}>
              <div style={{display:'grid',gridTemplateColumns:'130px 1fr',rowGap:6,fontSize:12}}>
                <span style={{color:'var(--muted)'}}>Standard form:</span>
                <span style={{fontFamily:'var(--mono)',fontWeight:700,color:'var(--cyan)',fontSize:14}}>{encResult.standard}</span>
                <span style={{color:'var(--muted)'}}>Raw 32-bit:</span>
                <span style={{fontFamily:'var(--mono)',color:'var(--text)'}}>{encResult.raw32}</span>
                <span style={{color:'var(--muted)'}}>Hex:</span>
                <span style={{fontFamily:'var(--mono)',color:'var(--text)'}}>{encResult.hex}</span>
              </div>
            </div>
          )}
          {encResult === null && encAsn && encVal && (
            <div style={{marginTop:8,fontSize:12,color:'#e05252'}}>ASN and value must be 0–65535.</div>
          )}
        </div>
      )}

      {/* ── Well-Known Reference ── */}
      {tab === 'ref' && (
        <div className="card fadein">
          <div className="card-title" style={{marginBottom:12}}>{t('bgp_comm.wellknown_title', 'Well-Known Communities')}</div>
          <div style={{display:'flex',flexDirection:'column',gap:10}}>
            {WELL_KNOWN.map(w => (
              <div key={w.value} style={{padding:12,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
                  <code style={{fontSize:13,fontWeight:700,color:'var(--cyan)'}}>{w.value}</code>
                  <span style={{fontSize:12,fontWeight:600,color:'var(--text)'}}>{w.name}</span>
                </div>
                <div style={{fontSize:12,color:'var(--muted)'}}>{w.desc}</div>
              </div>
            ))}
            {BGP_PRESETS.map(p => (
              <div key={p.communities} style={{padding:12,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
                  <code style={{fontSize:13,fontWeight:700,color:'var(--text)'}}>{p.communities}</code>
                  <span style={{fontSize:12,color:'var(--muted)'}}>{p.label}</span>
                </div>
                <div style={{fontSize:12,color:'var(--muted)'}}>{p.desc}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Route-Map Generator ── */}
      {tab === 'gen' && (
        <div className="card fadein">
          <div className="card-title" style={{marginBottom:8}}>{t('bgp_comm.gen_title', 'Route-Map / Policy Generator')}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12,marginBottom:12}} className="grid-mobile-1">
            <div className="field">
              <label className="label">Communities (space or comma separated)</label>
              <input className="input" style={{fontFamily:'var(--mono)'}} value={genComms} onChange={e => setGenComms(e.target.value)} placeholder="65000:100 65535:65281" />
            </div>
            <div className="field">
              <label className="label">Local AS Number</label>
              <input className="input" style={{fontFamily:'var(--mono)'}} value={genAsn} onChange={e => setGenAsn(e.target.value)} placeholder="65000" />
            </div>
            <div className="field">
              <label className="label">Platform</label>
              <select className="select" value={genPlat} onChange={e => setGenPlat(e.target.value)}>
                {BGP_PLATFORMS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div className="field">
              <label className="label">Route-Map Action</label>
              <div style={{display:'flex',gap:8,paddingTop:2}}>
                {[['permit','Permit'],['deny','Deny']].map(([v,l]) => (
                  <button key={v} className={`btn ${genAct===v?'btn-primary':'btn-ghost'}`} onClick={() => setGenAct(v)}>{l}</button>
                ))}
              </div>
            </div>
          </div>
          <div style={{marginBottom:8,fontSize:11,color:'var(--muted)'}}>Quick presets:</div>
          <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
            {BGP_PRESETS.slice(0,5).map(p => (
              <button key={p.communities} className="btn btn-ghost" style={{fontSize:11,padding:'3px 10px'}}
                onClick={() => setGenComms(p.communities)}>
                {p.label}
              </button>
            ))}
          </div>
          <button className="btn btn-primary" onClick={runGen}>{t('bgp_comm.gen_btn', 'Generate Config')}</button>
          {genOut && (
            <div style={{marginTop:12}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
                <span style={{fontSize:12,fontWeight:600,color:'var(--text)'}}>{BGP_PLATFORMS.find(p=>p.id===genPlat)?.label}</span>
                <CopyBtn text={genOut} label="copy_all" id="bgp-comm-copy" />
              </div>
              <pre style={{fontFamily:'var(--mono)',fontSize:11,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'14px 16px',color:'var(--text)',lineHeight:1.6,whiteSpace:'pre-wrap',overflowX:'auto'}}>{genOut}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

window.BGPCommunity = BGPCommunity;
