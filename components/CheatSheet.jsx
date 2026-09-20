const { useState, useEffect, useCallback, useRef, useMemo } = React;

function CheatSheet() {
  const { t } = useTranslation();
  const privateRanges = PRIVATE_RANGES;
  const specialRanges = SPECIAL_RANGES;
  const ipv6Special = IPV6_SPECIAL;
  const classTable = CLASS_TABLE;

  return (
    <div className="fadein">
      <div className="cs-section">
        <div className="cs-title">{t('cheatsheet.ipv4_classes')}</div>
        <div className="table-wrap hide-mobile"><table>
          <thead><tr><th>{t('cheatsheet.class')}</th><th>{t('cheatsheet.first_octet')}</th><th>{t('cheatsheet.default_mask')}</th><th>{t('cheatsheet.networks')}</th><th>{t('cheatsheet.hosts_network')}</th><th>{t('cheatsheet.use')}</th></tr></thead>
          <tbody>{classTable.map(r => <tr key={r.cls}>
            <td><span className="badge badge-cyan">{r.cls}</span></td>
            <td>{r.range}</td><td>{r.mask}</td><td>{r.networks}</td>
            <td style={{color:'var(--green)'}}>{r.hostsPerNet}</td><td style={{fontFamily:'var(--sans)',color:'var(--muted)'}}>{t('cheatsheet.data.'+r.key+'_use', r.use)}</td>
          </tr>)}</tbody>
        </table></div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {classTable.map(r => (
            <div key={r.cls} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.class')}</span>
                <span className="badge badge-cyan">{r.cls}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.range_mask')}</span>
                <span className="mobile-card-value">{r.range} / {r.mask}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.hosts_net')}</span>
                <span className="mobile-card-value" style={{color:'var(--green)'}}>{r.hostsPerNet}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-title">{t('cheatsheet.private_special')}</div>
        <div className="table-wrap hide-mobile"><table>
          <thead><tr><th>{t('cheatsheet.cidr')}</th><th>{t('cheatsheet.start')}</th><th>{t('cheatsheet.end')}</th><th>{t('cheatsheet.usable_hosts')}</th><th>{t('cheatsheet.rfc')}</th><th>{t('cheatsheet.use')}</th></tr></thead>
          <tbody>{privateRanges.map(r => <tr key={r.range}>
            <td style={{color:'var(--cyan)'}}>{r.range}</td><td>{r.start}</td><td>{r.end}</td>
            <td style={{color:'var(--green)'}}>{r.hosts}</td>
            <td><RFCLink rfc={r.rfc} className="badge badge-blue" /></td>
            <td style={{fontFamily:'var(--sans)',color:'var(--muted)'}}>{t('cheatsheet.data.'+r.key+'_use', r.use)}</td>
          </tr>)}</tbody>
        </table></div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {privateRanges.map(r => (
            <div key={r.range} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.cidr')}</span>
                <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{r.range}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.hosts')} / {t('cheatsheet.rfc')}</span>
                <span className="mobile-card-value">{r.hosts} (<RFCLink rfc={r.rfc} />)</span>
              </div>
              <div className="mobile-card-row" style={{borderBottom:'none'}}>
                <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{t('cheatsheet.data.'+r.key+'_use', r.use)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-title">{t('cheatsheet.other_special')}</div>
        <div className="table-wrap hide-mobile"><table>
          <thead><tr><th>{t('cheatsheet.cidr')}</th><th>{t('cheatsheet.rfc')}</th><th>{t('cheatsheet.use')}</th></tr></thead>
          <tbody>{specialRanges.map(r => <tr key={r.range}>
            <td style={{color:'var(--yellow)'}}>{r.range}</td>
            <td><RFCLink rfc={r.rfc} className="badge badge-gray" /></td>
            <td style={{fontFamily:'var(--sans)',color:'var(--muted)'}}>{t('cheatsheet.data.'+r.key+'_use', r.use)}</td>
          </tr>)}</tbody>
        </table></div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {specialRanges.map(r => (
            <div key={r.range} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.cidr')}</span>
                <span className="mobile-card-value" style={{color:'var(--yellow)', fontWeight:600}}>{r.range}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.rfc')}</span>
                <span className="mobile-card-value"><RFCLink rfc={r.rfc} /></span>
              </div>
              <div className="mobile-card-row" style={{borderBottom:'none'}}>
                <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{t('cheatsheet.data.'+r.key+'_use', r.use)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-title">{t('cheatsheet.common_subnet')}</div>
        <div className="table-wrap hide-mobile"><table>
          <thead><tr><th>{t('cheatsheet.cidr')}</th><th>{t('cheatsheet.subnet_mask')}</th><th>{t('cheatsheet.wildcard')}</th><th>{t('cheatsheet.hosts')}</th><th>{t('cheatsheet.typical_use')}</th></tr></thead>
          <tbody>{[
            ['/30','255.255.255.252','0.0.0.3','2','Point-to-point links','subnet_30_use'],
            ['/29','255.255.255.248','0.0.0.7','6','Tiny LAN segments','subnet_29_use'],
            ['/28','255.255.255.240','0.0.0.15','14','Small VLAN','subnet_28_use'],
            ['/27','255.255.255.224','0.0.0.31','30','Small office floor','subnet_27_use'],
            ['/26','255.255.255.192','0.0.0.63','62','Department subnet','subnet_26_use'],
            ['/25','255.255.255.128','0.0.0.127','126','Half a /24','subnet_25_use'],
            ['/24','255.255.255.0','0.0.0.255','254','Standard LAN / VLAN','subnet_24_use'],
            ['/23','255.255.254.0','0.0.1.255','510','Two /24s combined','subnet_23_use'],
            ['/22','255.255.252.0','0.0.3.255','1,022','Campus block','subnet_22_use'],
            ['/21','255.255.248.0','0.0.7.255','2,046','Medium enterprise','subnet_21_use'],
            ['/20','255.255.240.0','0.0.15.255','4,094','Large enterprise','subnet_20_use'],
            ['/16','255.255.0.0','0.0.255.255','65,534','Class B block','subnet_16_use'],
            ['/8','255.0.0.0','0.255.255.255','16,777,214','Class A block','subnet_8_use'],
          ].map(([cidr,mask,wc,hosts,use,key]) => (
            <tr key={cidr}>
              <td style={{color:'var(--cyan)'}}>{cidr}</td><td>{mask}</td>
              <td style={{color:'var(--yellow)'}}>{wc}</td>
              <td style={{color:'var(--green)'}}>{hosts}</td>
              <td style={{fontFamily:'var(--sans)',color:'var(--muted)'}}>{t('cheatsheet.data.'+key, use)}</td>
            </tr>
          ))}</tbody>
        </table></div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {[
            ['/30','255.255.255.252','2','P2P','subnet_30_use'],
            ['/29','255.255.255.248','6','Tiny LAN','subnet_29_use'],
            ['/28','255.255.255.240','14','Small VLAN','subnet_28_use'],
            ['/27','255.255.255.224','30','Office Floor','subnet_27_use'],
            ['/24','255.255.255.0','254','Std LAN','subnet_24_use'],
            ['/22','255.255.252.0','1,022','Campus','subnet_22_use'],
            ['/16','255.255.0.0','64k','Class B','subnet_16_use'],
            ['/8','255.0.0.0','16M','Class A','subnet_8_use']
          ].map(([cidr,mask,hosts,use,key]) => (
            <div key={cidr} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{cidr}</span>
                <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{mask}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.hosts')}</span>
                <span className="mobile-card-value" style={{color:'var(--green)'}}>{hosts} ({t('cheatsheet.data.'+key, use)})</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-title">{t('cheatsheet.ipv6_special')}</div>
        <div className="table-wrap hide-mobile"><table>
          <thead><tr><th>{t('cheatsheet.prefix')}</th><th>{t('cheatsheet.type')}</th><th>{t('cheatsheet.rfc')}</th><th>{t('cheatsheet.use_case')}</th></tr></thead>
          <tbody>{ipv6Special.map(r => <tr key={r.addr}>
            <td style={{color:'var(--purple)',fontFamily:'var(--mono)'}}>{r.addr}</td>
            <td style={{fontFamily:'var(--sans)'}}>{t('cheatsheet.data.'+r.key+'_type', r.type)}</td>
            <td><RFCLink rfc={r.rfc} className="badge badge-gray" /></td>
            <td style={{fontFamily:'var(--sans)',color:'var(--muted)'}}>{t('cheatsheet.data.'+r.key+'_use', r.use)}</td>
          </tr>)}</tbody>
        </table></div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {ipv6Special.map(r => (
            <div key={r.addr} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.prefix')}</span>
                <span className="mobile-card-value" style={{color:'var(--purple)', fontWeight:600}}>{r.addr}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.type')}</span>
                <span className="mobile-card-value">{t('cheatsheet.data.'+r.key+'_type', r.type)}</span>
              </div>
              <div className="mobile-card-row" style={{borderBottom:'none'}}>
                <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{t('cheatsheet.data.'+r.key+'_use', r.use)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="cs-section">
        <div className="cs-title">{t('cheatsheet.ipv6_mcast_scopes')}</div>
        <div className="table-wrap hide-mobile"><table>
          <thead><tr><th>{t('cheatsheet.prefix')}</th><th>{t('cheatsheet.scope_name')}</th><th>{t('cheatsheet.use_case')}</th></tr></thead>
          <tbody>{IPV6_SCOPES.map(s => <tr key={s.scope}>
            <td style={{color:'var(--purple)',fontFamily:'var(--mono)'}}>{s.scope}</td>
            <td>{t('cheatsheet.data.'+s.key+'_name', s.name)}</td>
            <td style={{fontFamily:'var(--sans)',color:'var(--muted)'}}>{t('cheatsheet.data.'+s.key+'_use', s.use)}</td>
          </tr>)}</tbody>
        </table></div>
        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {IPV6_SCOPES.map(s => (
            <div key={s.scope} className="mobile-card">
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.scope')}</span>
                <span className="mobile-card-value" style={{color:'var(--purple)', fontWeight:600}}>{s.scope}</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('cheatsheet.scope_name')}</span>
                <span className="mobile-card-value">{t('cheatsheet.data.'+s.key+'_name', s.name)}</span>
              </div>
              <div className="mobile-card-row" style={{borderBottom:'none'}}>
                <span className="mobile-card-value" style={{textAlign:'left', paddingLeft:0, color:'var(--muted)', fontSize:11}}>{t('cheatsheet.data.'+s.key+'_use', s.use)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}



// ─── Tool: Interface Config Generator ──────────────────────────────────────────
window.CheatSheet = CheatSheet;
