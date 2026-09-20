const { useState, useEffect, useCallback, useRef, useMemo } = React;

function VPNArchitect() {
  const { t } = useTranslation();
  const dhGroups = useMemo(() => [
    { g: 2,  bits: 1024, name: 'MODP', status: 'legacy', rec: t('vpn_ref.obsolete') },
    { g: 5,  bits: 1536, name: 'MODP', status: 'legacy', rec: t('vpn_ref.obsolete') },
    { g: 14, bits: 2048, name: 'MODP', status: 'secure', rec: t('vpn_ref.min_standard') },
    { g: 15, bits: 3072, name: 'MODP', status: 'secure', rec: t('vpn_ref.secure') },
    { g: 16, bits: 4096, name: 'MODP', status: 'secure', rec: t('vpn_ref.very_secure') },
    { g: 19, bits: 256,  name: 'ECP (NIST P-256)', status: 'fast', rec: t('vpn_ref.recommended') },
    { g: 20, bits: 384,  name: 'ECP (NIST P-384)', status: 'fast', rec: t('vpn_ref.recommended') },
    { g: 21, bits: 521,  name: 'ECP (NIST P-521)', status: 'fast', rec: t('vpn_ref.high_security') },
    { g: 24, bits: 2048, name: 'MODP (256-bit Prime Order)', status: 'secure', rec: t('vpn_ref.secure') },
  ], [t]);
  const [selectedDH, setSelectedDH] = useState(14);
  const dh = useMemo(() => dhGroups.find(d => d.g === parseInt(selectedDH)) || dhGroups[2], [dhGroups, selectedDH]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title" style={{color:'var(--purple)'}}>{t('vpn_ref.title')}</div>
        <div style={{fontSize:13, color:'var(--muted)', lineHeight:1.6, marginBottom:16}}>
          {t('vpn_ref.desc')}
        </div>

        <div className="two-col grid-mobile-1"
 style={{gap:16}}>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, border:'1px solid var(--border)'}}>
            <div style={{fontSize:11, fontWeight:700, color:'var(--cyan)', textTransform:'uppercase', letterSpacing:1, marginBottom:12}}>{t('vpn_ref.p1_title')}</div>
            <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.6}}>
              {t('vpn_ref.p1_desc')}
              <ul style={{marginTop:8, paddingLeft:16}}>
                <li><strong style={{color:'var(--text)'}}>{t('vpn_ref.purpose')}:</strong> {t('vpn_ref.p1_purpose')}</li>
                <li><strong style={{color:'var(--text)'}}>{t('vpn_ref.exchange')}:</strong> {t('vpn_ref.p1_exchange')}</li>
                <li><strong style={{color:'var(--text)'}}>{t('vpn_ref.lifetime')}:</strong> {t('vpn_ref.p1_lifetime')}</li>
                <li><strong style={{color:'var(--text)'}}>{t('vpn_ref.negotiates')}:</strong> {t('vpn_ref.p1_negotiates')}</li>
              </ul>
            </div>
          </div>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, border:'1px solid var(--border)'}}>
            <div style={{fontSize:11, fontWeight:700, color:'var(--purple)', textTransform:'uppercase', letterSpacing:1, marginBottom:12}}>{t('vpn_ref.p2_title')}</div>
            <div style={{fontSize:12, color:'var(--muted)', lineHeight:1.6}}>
              {t('vpn_ref.p2_desc')}
              <ul style={{marginTop:8, paddingLeft:16}}>
                <li><strong style={{color:'var(--text)'}}>{t('vpn_ref.purpose')}:</strong> {t('vpn_ref.p2_purpose')}</li>
                <li><strong style={{color:'var(--text)'}}>{t('vpn_ref.exchange')}:</strong> {t('vpn_ref.p2_exchange')}</li>
                <li><strong style={{color:'var(--text)'}}>{t('vpn_ref.lifetime')}:</strong> {t('vpn_ref.p2_lifetime')}</li>
                <li><strong style={{color:'var(--text)'}}>{t('vpn_ref.pfs')}:</strong> {t('vpn_ref.pfs_desc')}</li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <div className="two-col grid-mobile-1"
>
        <div className="card">
          <div className="card-title">{t('vpn_ref.dh_ref')}</div>
          <div className="field">
            <label className="label">{t('vpn_ref.select_dh')}</label>
            <select className="input" value={selectedDH} onChange={e => setSelectedDH(e.target.value)}>
              {dhGroups.map(d => <option key={d.g} value={d.g}>{t('vpn_ref.dh_group_name', {g: d.g, name: d.name})}</option>)}
            </select>
          </div>
          <div className="result-grid" style={{marginTop:16}}>
            <ResultItem label={t('vpn_ref.security_strength')} value={`${dh.bits}-bit`} accent />
            <ResultItem label={t('vpn_ref.type')} value={dh.name} />
            <ResultItem label={t('vpn_ref.recommendation')} value={dh.rec} green={dh.status!=='legacy'} red={dh.status==='legacy'} />
          </div>
          <div style={{marginTop:16, padding:12, background:'rgba(0, 212, 200, 0.05)', borderRadius:6, border:'1px solid var(--border)', fontSize:12}}>
            <strong style={{color:'var(--cyan)'}}>{t('vpn_ref.modern_suite_b')}</strong> {t('vpn_ref.pair_with', {dh: <strong style={{color:'var(--text)'}}>DH Group 19+</strong>, aes: <strong style={{color:'var(--text)'}}>AES-256-GCM</strong>, sha: <strong style={{color:'var(--text)'}}>SHA-384</strong>})}
          </div>
        </div>

        <div className="card">
          <div className="card-title">{t('vpn_ref.ike_comp')}</div>
          <div className="table-wrap hide-mobile">
            <table style={{fontSize:11}}>
              <thead>
                <tr>
                  <th>{t('vpn_ref.feature')}</th>
                  <th>{t('vpn_ref.ikev1')}</th>
                  <th>{t('vpn_ref.ikev2')}</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={{color:'var(--text)'}}>{t('vpn_ref.complexity')}</td>
                  <td>{t('vpn_ref.high_multi')}</td>
                  <td style={{color:'var(--green)'}}>{t('vpn_ref.low_unified')}</td>
                </tr>
                <tr>
                  <td style={{color:'var(--text)'}}>{t('vpn_ref.init_exchange')}</td>
                  <td>{t('vpn_ref.msg_6_9')}</td>
                  <td style={{color:'var(--green)'}}>{t('vpn_ref.msg_4')}</td>
                </tr>
                <tr>
                  <td style={{color:'var(--text)'}}>{t('vpn_ref.nat_t')}</td>
                  <td>{t('vpn_ref.optional_addon')}</td>
                  <td style={{color:'var(--green)'}}>{t('vpn_ref.built_in')}</td>
                </tr>
                <tr>
                  <td style={{color:'var(--text)'}}>{t('vpn_ref.mobility')}</td>
                  <td>{t('vpn_ref.not_supported')}</td>
                  <td style={{color:'var(--green)'}}>MOBIKE (Native)</td>
                </tr>
                <tr>
                  <td style={{color:'var(--text)'}}>{t('vpn_ref.reliability')}</td>
                  <td>{t('vpn_ref.no_seq')}</td>
                  <td style={{color:'var(--green)'}}>{t('vpn_ref.seq_ack')}</td>
                </tr>
              </tbody>
            </table>
          </div>
          {/* Mobile View */}
          <div className="show-mobile mobile-cards">
            {[
              {f:t('vpn_ref.complexity'), v1:t('vpn_ref.high_multi'), v2:t('vpn_ref.low_unified')},
              {f:t('vpn_ref.init_exchange'), v1:t('vpn_ref.msg_6_9'), v2:t('vpn_ref.msg_4')},
              {f:t('vpn_ref.nat_t'), v1:t('vpn_ref.optional_addon'), v2:t('vpn_ref.built_in')},
              {f:t('vpn_ref.reliability'), v1:t('vpn_ref.no_seq'), v2:t('vpn_ref.seq_ack')}
            ].map(r => (
              <div key={r.f} className="mobile-card">
                <div className="mobile-card-row">
                  <span className="mobile-card-label">{r.f}</span>
                  <span className="mobile-card-value" style={{fontWeight:600}}>{r.v2} <span style={{fontWeight:400, color:'var(--muted)'}}>(v2)</span></span>
                </div>
                <div className="mobile-card-row">
                  <span className="mobile-card-value" style={{marginLeft:'auto', color:'var(--dim)'}}>{r.v1} <span style={{fontWeight:400, color:'var(--muted)'}}>(v1)</span></span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-title">{t('vpn_ref.proto_comp')}</div>
        <div className="two-col grid-mobile-1"
 style={{gap:20}}>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, border:'1px solid var(--border)'}}>
            <div style={{fontSize:12, fontWeight:700, color:'var(--yellow)', marginBottom:8}}>{t('vpn_ref.esp_title')}</div>
            <div style={{fontSize:11, color:'var(--muted)', lineHeight:1.6}}>
              {t('vpn_ref.esp_desc')}
              <br/><br/>
              <span style={{color:'var(--green)'}}>✔ {t('vpn_ref.encryption')}</span><br/>
              <span style={{color:'var(--green)'}}>✔ {t('vpn_ref.authentication')}</span><br/>
              <span style={{color:'var(--green)'}}>✔ {t('vpn_ref.anti_replay')}</span>
            </div>
          </div>
          <div style={{background:'var(--panel)', padding:16, borderRadius:8, border:'1px solid var(--border)'}}>
            <div style={{fontSize:12, fontWeight:700, color:'var(--dim)', marginBottom:8}}>{t('vpn_ref.ah_title')}</div>
            <div style={{fontSize:11, color:'var(--muted)', lineHeight:1.6}}>
              {t('vpn_ref.ah_desc')}
              <br/><br/>
              <span style={{color:'var(--red)'}}>✖ {t('vpn_ref.no_encryption')}</span><br/>
              <span style={{color:'var(--green)'}}>✔ {t('vpn_ref.authentication')}</span><br/>
              <span style={{color:'var(--red)'}}>✖ {t('vpn_ref.fails_nat')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── QoS / DSCP Engineering Suite ──────────────────────────────
window.VPNArchitect = VPNArchitect;
