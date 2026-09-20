const { useState, useEffect, useCallback, useRef, useMemo } = React;

function SplitMerge({ onShare, initialData, modeOverride }) {
  const { t } = useTranslation();
  const [localMode, setLocalMode] = usePersistentState('split:mode', initialData?.mode ?? 'split');
  const mode = modeOverride || localMode;
  const setMode = modeOverride ? () => {} : setLocalMode;
  const [cidr, setCidr] = usePersistentState('split:cidr', initialData?.cidr ?? '192.168.0.0/22');
  const [splitCount, setSplitCount] = usePersistentState('split:splitCount', initialData?.splitCount ?? 4);
  const [mergeLines, setMergeLines] = usePersistentState('split:mergeLines', initialData?.mergeLines ?? '192.168.0.0/24\n192.168.1.0/24\n192.168.2.0/24\n192.168.3.0/24');
  const [mergeMethod, setMergeMethod] = usePersistentState('split:mergeMethod', initialData?.mergeMethod ?? 'auto');
  const [targetPrefixLen, setTargetPrefixLen] = usePersistentState('split:targetPrefixLen', initialData?.targetPrefixLen ?? 23);
  const [targetPrefixesInput, setTargetPrefixesInput] = usePersistentState('split:targetPrefixesInput', initialData?.targetPrefixesInput ?? '');
  const [result, setResult] = usePersistentState('split:result', null);
  const [err, setErr] = useState('');

  const calc = () => {
    setErr(''); setResult(null);
    if (mode === 'split') {
      const c = IPv4.parseCIDR(cidr);
      if (!c) { setErr(t('range.err_invalid_cidr')); return; }
      const bits = Math.ceil(Math.log2(splitCount));
      const newPrefix = c.prefix + bits;
      if (newPrefix > 32) { setErr(t('split.err_too_many')); return; }
      const count = Math.pow(2, bits);
      const parent = IPv4.subnet(c.ip, c.prefix);
      const subnets = Array.from({length: count}, (_, i) => {
        const net = (parent.network + i * Math.pow(2, 32 - newPrefix)) >>> 0;
        return IPv4.subnet(net, newPrefix);
      });
      setResult({ mode:'split', subnets, newPrefix, parent });
    } else {
      const entries = mergeLines.trim().split('\n').map(l => l.trim()).filter(Boolean);
      if (entries.length < 2) { setErr(t('overlap.err_at_least_two')); return; }
      const parsed = entries.map(e => { const c = IPv4.parseCIDR(e); return c ? IPv4.subnet(c.ip, c.prefix) : null; });
      if (parsed.some(p => !p)) { setErr(t('range.err_invalid_cidr')); return; }

      if (mergeMethod === 'auto') {
        const allIPs = parsed.flatMap(n => [n.network, n.broadcast]);
        const sup = IPv4.supernet(allIPs);
        setResult({ mode: 'merge', mergeMethod: 'auto', subnets: parsed, supernet: sup });

      } else if (mergeMethod === 'length') {
        const P = parseInt(targetPrefixLen, 10);
        // Group each input subnet under the /P block it falls in
        const groups = {};
        parsed.forEach(sn => {
          const targetSn = IPv4.subnet(sn.network, P);
          const key = targetSn.cidr;
          if (!groups[key]) groups[key] = { target: targetSn, subnets: [] };
          groups[key].subnets.push(sn);
        });
        setResult({ mode: 'merge', mergeMethod: 'length', groups: Object.values(groups), targetPrefixLen: P });

      } else if (mergeMethod === 'custom') {
        const targetLines = targetPrefixesInput.trim().split('\n').map(l => l.trim()).filter(Boolean);
        if (!targetLines.length) { setErr(t('split.err_invalid_target')); return; }
        const parsedTargets = targetLines.map(l => { const c = IPv4.parseCIDR(l); return c ? IPv4.subnet(c.ip, c.prefix) : null; });
        if (parsedTargets.some(t => !t)) { setErr(t('split.err_invalid_target')); return; }
        // Sort longest prefix first for most-specific matching
        parsedTargets.sort((a, b) => b.prefix - a.prefix);
        const groups = {};
        parsedTargets.forEach(t => { groups[t.cidr] = { target: t, subnets: [] }; });
        const unmatched = [];
        parsed.forEach(sn => {
          const match = parsedTargets.find(t => sn.prefix >= t.prefix && (sn.network & t.mask) >>> 0 === t.network);
          if (match) groups[match.cidr].subnets.push(sn);
          else unmatched.push(sn);
        });
        setResult({ mode: 'merge', mergeMethod: 'custom', groups: Object.values(groups), unmatched });
      }
    }
  };

  useEffect(() => {
    if (initialData) {
      if (initialData.mode !== undefined) setMode(initialData.mode);
      if (initialData.cidr !== undefined) setCidr(initialData.cidr);
      if (initialData.splitCount !== undefined) setSplitCount(initialData.splitCount);
      if (initialData.mergeLines !== undefined) setMergeLines(initialData.mergeLines);
    }
    calc();
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (cidr || mergeLines) (e.detail?.respond ?? onShare)({ tool: 'subnet-planner', mode, cidr, splitCount, mergeLines });
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [mode, cidr, splitCount, mergeLines, onShare]);

  return (
    <div className="fadein">
      <div className="card">
        {!modeOverride && (
          <div style={{display:'flex',gap:8,marginBottom:16}}>
            {[[ 'split', t('split.split_subnet')],[ 'merge', t('split.merge_summarize')]].map(([v,l]) => (
              <button key={v} className={`btn ${mode===v?'btn-primary':'btn-ghost'}`} onClick={() => { setMode(v); setResult(null); setErr(''); }}>{l}</button>
            ))}
          </div>
        )}
        {mode === 'split' ? (
          <div className="two-col grid-mobile-1">
            <div className="field"><label className="label">{t('split.parent_network')}</label>
              <input className="input" value={cidr} onChange={e => setCidr(e.target.value)} placeholder="192.168.0.0/22" /></div>
            <div className="field"><label className="label">{t('split.num_subnets')}</label>
              <select className="select" value={splitCount} onChange={e => setSplitCount(parseInt(e.target.value))}>
                {[2,4,8,16,32,64,128,256].map(n => <option key={n} value={n}>{t('split.equal_subnets', {n})}</option>)}
              </select></div>
          </div>
        ) : (
          <>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="label">{t('split.networks_to_merge')}</label>
              <textarea className="input" rows={5} value={mergeLines} onChange={e => setMergeLines(e.target.value)} style={{ resize: 'vertical' }} />
            </div>
            <div className="field" style={{ marginBottom: 12 }}>
              <label className="label">{t('split.merge_method')}</label>
              <select className="select" value={mergeMethod} onChange={e => { setMergeMethod(e.target.value); setResult(null); setErr(''); }}>
                <option value="auto">{t('split.merge_method_auto')}</option>
                <option value="length">{t('split.merge_method_length')}</option>
                <option value="custom">{t('split.merge_method_custom')}</option>
              </select>
            </div>
            {mergeMethod === 'length' && (
              <div className="field" style={{ marginBottom: 12 }}>
                <label className="label">{t('split.target_prefix_len')}</label>
                <select className="select" value={targetPrefixLen} onChange={e => setTargetPrefixLen(parseInt(e.target.value))}>
                  {Array.from({ length: 32 }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>/{n}</option>
                  ))}
                </select>
              </div>
            )}
            {mergeMethod === 'custom' && (
              <div className="field" style={{ marginBottom: 12 }}>
                <label className="label">{t('split.target_prefixes')}</label>
                <textarea className="input" rows={4} value={targetPrefixesInput}
                  onChange={e => setTargetPrefixesInput(e.target.value)}
                  style={{ resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 13 }}
                  placeholder="10.0.0.0/16&#10;192.168.0.0/22" />
              </div>
            )}
          </>
        )}
        <Err msg={err} />
        <button className="btn btn-primary" onClick={calc}>{mode==='split'?t('split.split_subnet'):t('split.merge_summarize')}</button>
      </div>

      {result && (
        <div className="card fadein">
          {result.mode === 'split' ? (
            <>
              <div className="card-title">{t('split.subnets_of', { count: result.subnets.length, prefix: result.newPrefix, parent: result.parent.cidr })}</div>
              <div className="table-wrap hide-mobile">
                <table><thead><tr><th>{t('common.th_num')}</th><th>{t('subnet.network_addr')}</th><th>{t('common.th_cidr')}</th><th>{t('subnet.first_host')}</th><th>{t('subnet.last_host')}</th><th>{t('subnet.broadcast_addr')}</th></tr></thead>
                <tbody>{result.subnets.map((sn,i) => (
                  <tr key={i}><td style={{color:'var(--dim)'}}>{i+1}</td><td style={{color:'var(--cyan)'}}>{sn.networkStr}</td><td>{sn.cidr}</td><td>{sn.firstHostStr}</td><td>{sn.lastHostStr}</td><td style={{color:'var(--red)'}}>{sn.broadcastStr}</td></tr>
                ))}</tbody></table>
              </div>
              {/* Mobile View */}
              <div className="show-mobile mobile-cards">
                {result.subnets.map((sn,i) => (
                  <div key={i} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('subnet.title')} {i+1}</span>
                      <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{sn.cidr}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('nav.tools')}</span>
                      <span className="mobile-card-value" style={{fontSize:11}}>{sn.firstHostStr} - {sn.lastHostStr}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="btn-row">
                <button className="btn btn-ghost btn-sm" onClick={() => exportCSV(result.subnets.map((s,i)=>({index:i+1,cidr:s.cidr,network:s.networkStr,first:s.firstHostStr,last:s.lastHostStr,broadcast:s.broadcastStr})),'split.csv')}>{t('common.export_csv')}</button>
              </div>
            </>
          ) : result.mergeMethod === 'auto' ? (
            <>
              <div className="card-title">{t('supernet.summary_route')}</div>
              <div className="result-grid grid-mobile-1" style={{marginBottom:16}}>
                <ResultItem label={t('supernet.supernet_cidr')} value={result.supernet.cidr} accent />
                <ResultItem label={t('subnet.network_addr')} value={result.supernet.networkStr} />
                <ResultItem label={t('subnet.broadcast_addr')} value={result.supernet.broadcastStr} />
                <ResultItem label={t('subnet.subnet_mask')} value={result.supernet.maskStr} />
                <ResultItem label={t('subnet.total_addr')} value={result.supernet.totalCount} />
              </div>
              <div className="card-title">{t('supernet.input_networks')}</div>
              <div className="table-wrap hide-mobile">
                <table><thead><tr><th>{t('common.th_cidr')}</th><th>{t('subnet.network_addr')}</th><th>{t('subnet.broadcast_addr')}</th><th>{t('subnet.usable_hosts')}</th></tr></thead>
                <tbody>{result.subnets.map((n,i) => <tr key={i}><td style={{color:'var(--cyan)'}}>{n.cidr}</td><td>{n.networkStr}</td><td>{n.broadcastStr}</td><td style={{color:'var(--green)'}}>{n.hostCount}</td></tr>)}</tbody>
                </table>
              </div>
              <div className="show-mobile mobile-cards">
                {result.subnets.map((n,i) => (
                  <div key={i} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">CIDR</span>
                      <span className="mobile-card-value" style={{color:'var(--cyan)', fontWeight:600}}>{n.cidr}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('subnet.usable_hosts')}</span>
                      <span className="mobile-card-value" style={{color:'var(--green)'}}>{n.hostCount}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="card-title">{t('split.merged_groups')}</div>
              {result.groups.map((g, gi) => (
                <div key={gi} style={{ marginBottom: 20 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--cyan)' }}>{g.target.cidr}</span>
                    <span style={{ fontSize: 11, color: 'var(--muted)', background: 'var(--panel)', borderRadius: 4, padding: '2px 7px', border: '1px solid var(--border)' }}>
                      {g.subnets.length} subnet{g.subnets.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  {g.subnets.length > 0 ? (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>{t('common.th_cidr')}</th><th>{t('subnet.network_addr')}</th><th>{t('subnet.broadcast_addr')}</th><th>{t('subnet.usable_hosts')}</th></tr></thead>
                        <tbody>
                          {g.subnets.map((n, i) => (
                            <tr key={i}>
                              <td style={{ color: 'var(--cyan)' }}>{n.cidr}</td>
                              <td>{n.networkStr}</td>
                              <td>{n.broadcastStr}</td>
                              <td style={{ color: 'var(--green)' }}>{n.hostCount}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--muted)', fontStyle: 'italic', paddingLeft: 4 }}>No matching input networks</div>
                  )}
                </div>
              ))}
              {result.unmatched && result.unmatched.length > 0 && (
                <>
                  <div className="card-title" style={{ color: 'var(--warning, #f59e0b)', marginTop: 8 }}>
                    ⚠ {t('split.unmatched_networks')} ({result.unmatched.length})
                  </div>
                  <div className="table-wrap">
                    <table>
                      <thead><tr><th>{t('common.th_cidr')}</th><th>{t('subnet.network_addr')}</th><th>{t('subnet.broadcast_addr')}</th><th>{t('subnet.usable_hosts')}</th></tr></thead>
                      <tbody>
                        {result.unmatched.map((n, i) => (
                          <tr key={i}>
                            <td style={{ color: 'var(--warning, #f59e0b)' }}>{n.cidr}</td>
                            <td>{n.networkStr}</td>
                            <td>{n.broadcastStr}</td>
                            <td style={{ color: 'var(--green)' }}>{n.hostCount}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tool: Port Reference ─────────────────────────────────────
const PORT_DATA = [
  {port:20,proto:'TCP',serviceKey:'p_20_tcp_ftp_data_service',descKey:'p_20_tcp_ftp_data_desc'},
  {port:21,proto:'TCP',serviceKey:'p_21_tcp_ftp_control_service',descKey:'p_21_tcp_ftp_control_desc'},
  {port:22,proto:'TCP',serviceKey:'p_22_tcp_ssh_service',descKey:'p_22_tcp_ssh_desc'},
  {port:23,proto:'TCP',serviceKey:'p_23_tcp_telnet_service',descKey:'p_23_tcp_telnet_desc'},
  {port:25,proto:'TCP',serviceKey:'p_25_tcp_smtp_service',descKey:'p_25_tcp_smtp_desc'},
  {port:53,proto:'TCP/UDP',serviceKey:'p_53_tcp_udp_dns_service',descKey:'p_53_tcp_udp_dns_desc'},
  {port:67,proto:'UDP',serviceKey:'p_67_udp_dhcp_server_service',descKey:'p_67_udp_dhcp_server_desc'},
  {port:68,proto:'UDP',serviceKey:'p_68_udp_dhcp_client_service',descKey:'p_68_udp_dhcp_client_desc'},
  {port:69,proto:'UDP',serviceKey:'p_69_udp_tftp_service',descKey:'p_69_udp_tftp_desc'},
  {port:80,proto:'TCP',serviceKey:'p_80_tcp_http_service',descKey:'p_80_tcp_http_desc'},
  {port:88,proto:'TCP/UDP',serviceKey:'p_88_tcp_udp_kerberos_service',descKey:'p_88_tcp_udp_kerberos_desc'},
  {port:110,proto:'TCP',serviceKey:'p_110_tcp_pop3_service',descKey:'p_110_tcp_pop3_desc'},
  {port:111,proto:'TCP/UDP',serviceKey:'p_111_tcp_udp_rpc_service',descKey:'p_111_tcp_udp_rpc_desc'},
  {port:119,proto:'TCP',serviceKey:'p_119_tcp_nntp_service',descKey:'p_119_tcp_nntp_desc'},
  {port:123,proto:'UDP',serviceKey:'p_123_udp_ntp_service',descKey:'p_123_udp_ntp_desc'},
  {port:135,proto:'TCP/UDP',serviceKey:'p_135_tcp_udp_rpc_epmap_service',descKey:'p_135_tcp_udp_rpc_epmap_desc'},
  {port:137,proto:'UDP',serviceKey:'p_137_udp_netbios_ns_service',descKey:'p_137_udp_netbios_ns_desc'},
  {port:138,proto:'UDP',serviceKey:'p_138_udp_netbios_dgm_service',descKey:'p_138_udp_netbios_dgm_desc'},
  {port:139,proto:'TCP',serviceKey:'p_139_tcp_netbios_ssn_service',descKey:'p_139_tcp_netbios_ssn_desc'},
  {port:143,proto:'TCP',serviceKey:'p_143_tcp_imap_service',descKey:'p_143_tcp_imap_desc'},
  {port:161,proto:'UDP',serviceKey:'p_161_udp_snmp_service',descKey:'p_161_udp_snmp_desc'},
  {port:162,proto:'UDP',serviceKey:'p_162_udp_snmp_trap_service',descKey:'p_162_udp_snmp_trap_desc'},
  {port:179,proto:'TCP',serviceKey:'p_179_tcp_bgp_service',descKey:'p_179_tcp_bgp_desc'},
  {port:194,proto:'TCP',serviceKey:'p_194_tcp_irc_service',descKey:'p_194_tcp_irc_desc'},
  {port:389,proto:'TCP/UDP',serviceKey:'p_389_tcp_udp_ldap_service',descKey:'p_389_tcp_udp_ldap_desc'},
  {port:443,proto:'TCP',serviceKey:'p_443_tcp_https_service',descKey:'p_443_tcp_https_desc'},
  {port:445,proto:'TCP',serviceKey:'p_445_tcp_smb_service',descKey:'p_445_tcp_smb_desc'},
  {port:465,proto:'TCP',serviceKey:'p_465_tcp_smtps_service',descKey:'p_465_tcp_smtps_desc'},
  {port:500,proto:'UDP',serviceKey:'p_500_udp_ike_service',descKey:'p_500_udp_ike_desc'},
  {port:514,proto:'UDP',serviceKey:'p_514_udp_syslog_service',descKey:'p_514_udp_syslog_desc'},
  {port:515,proto:'TCP',serviceKey:'p_515_tcp_lpd_service',descKey:'p_515_tcp_lpd_desc'},
  {port:520,proto:'UDP',serviceKey:'p_520_udp_rip_service',descKey:'p_520_udp_rip_desc'},
  {port:546,proto:'UDP',serviceKey:'p_546_udp_dhcpv6_client_service',descKey:'p_546_udp_dhcpv6_client_desc'},
  {port:547,proto:'UDP',serviceKey:'p_547_udp_dhcpv6_server_service',descKey:'p_547_udp_dhcpv6_server_desc'},
  {port:587,proto:'TCP',serviceKey:'p_587_tcp_smtp_submit_service',descKey:'p_587_tcp_smtp_submit_desc'},
  {port:636,proto:'TCP',serviceKey:'p_636_tcp_ldaps_service',descKey:'p_636_tcp_ldaps_desc'},
  {port:646,proto:'TCP/UDP',serviceKey:'p_646_tcp_udp_ldp_service',descKey:'p_646_tcp_udp_ldp_desc'},
  {port:853,proto:'TCP',serviceKey:'p_853_tcp_dns_over_tls_service',descKey:'p_853_tcp_dns_over_tls_desc'},
  {port:989,proto:'TCP',serviceKey:'p_989_tcp_ftps_data_service',descKey:'p_989_tcp_ftps_data_desc'},
  {port:990,proto:'TCP',serviceKey:'p_990_tcp_ftps_control_service',descKey:'p_990_tcp_ftps_control_desc'},
  {port:993,proto:'TCP',serviceKey:'p_993_tcp_imaps_service',descKey:'p_993_tcp_imaps_desc'},
  {port:995,proto:'TCP',serviceKey:'p_995_tcp_pop3s_service',descKey:'p_995_tcp_pop3s_desc'},
  {port:1080,proto:'TCP',serviceKey:'p_1080_tcp_socks_service',descKey:'p_1080_tcp_socks_desc'},
  {port:1194,proto:'UDP',serviceKey:'p_1194_udp_openvpn_service',descKey:'p_1194_udp_openvpn_desc'},
  {port:1433,proto:'TCP',serviceKey:'p_1433_tcp_mssql_service',descKey:'p_1433_tcp_mssql_desc'},
  {port:1434,proto:'UDP',serviceKey:'p_1434_udp_mssql_browser_service',descKey:'p_1434_udp_mssql_browser_desc'},
  {port:1521,proto:'TCP',serviceKey:'p_1521_tcp_oracle_db_service',descKey:'p_1521_tcp_oracle_db_desc'},
  {port:1701,proto:'UDP',serviceKey:'p_1701_udp_l2tp_service',descKey:'p_1701_udp_l2tp_desc'},
  {port:1723,proto:'TCP',serviceKey:'p_1723_tcp_pptp_service',descKey:'p_1723_tcp_pptp_desc'},
  {port:1812,proto:'UDP',serviceKey:'p_1812_udp_radius_auth_service',descKey:'p_1812_udp_radius_auth_desc'},
  {port:1813,proto:'UDP',serviceKey:'p_1813_udp_radius_acct_service',descKey:'p_1813_udp_radius_acct_desc'},
  {port:2049,proto:'TCP/UDP',serviceKey:'p_2049_tcp_udp_nfs_service',descKey:'p_2049_tcp_udp_nfs_desc'},
  {port:2181,proto:'TCP',serviceKey:'p_2181_tcp_zookeeper_service',descKey:'p_2181_tcp_zookeeper_desc'},
  {port:2375,proto:'TCP',serviceKey:'p_2375_tcp_docker_service',descKey:'p_2375_tcp_docker_desc'},
  {port:2376,proto:'TCP',serviceKey:'p_2376_tcp_docker_tls_service',descKey:'p_2376_tcp_docker_tls_desc'},
  {port:3306,proto:'TCP',serviceKey:'p_3306_tcp_mysql_service',descKey:'p_3306_tcp_mysql_desc'},
  {port:3389,proto:'TCP',serviceKey:'p_3389_tcp_rdp_service',descKey:'p_3389_tcp_rdp_desc'},
  {port:4500,proto:'UDP',serviceKey:'p_4500_udp_ipsec_nat_t_service',descKey:'p_4500_udp_ipsec_nat_t_desc'},
  {port:4789,proto:'UDP',serviceKey:'p_4789_udp_vxlan_service',descKey:'p_4789_udp_vxlan_desc'},
  {port:5000,proto:'TCP',serviceKey:'p_5000_tcp_docker_registry_service',descKey:'p_5000_tcp_docker_registry_desc'},
  {port:5060,proto:'TCP/UDP',serviceKey:'p_5060_tcp_udp_sip_service',descKey:'p_5060_tcp_udp_sip_desc'},
  {port:5061,proto:'TCP',serviceKey:'p_5061_tcp_sip_tls_service',descKey:'p_5061_tcp_sip_tls_desc'},
  {port:5355,proto:'UDP',serviceKey:'p_5355_udp_llmnr_service',descKey:'p_5355_udp_llmnr_desc'},
  {port:5432,proto:'TCP',serviceKey:'p_5432_tcp_postgresql_service',descKey:'p_5432_tcp_postgresql_desc'},
  {port:5900,proto:'TCP',serviceKey:'p_5900_tcp_vnc_service',descKey:'p_5900_tcp_vnc_desc'},
  {port:6379,proto:'TCP',serviceKey:'p_6379_tcp_redis_service',descKey:'p_6379_tcp_redis_desc'},
  {port:6443,proto:'TCP',serviceKey:'p_6443_tcp_kubernetes_api_service',descKey:'p_6443_tcp_kubernetes_api_desc'},
  {port:6514,proto:'TCP',serviceKey:'p_6514_tcp_syslog_tls_service',descKey:'p_6514_tcp_syslog_tls_desc'},
  {port:8080,proto:'TCP',serviceKey:'p_8080_tcp_http_alt_service',descKey:'p_8080_tcp_http_alt_desc'},
  {port:8443,proto:'TCP',serviceKey:'p_8443_tcp_https_alt_service',descKey:'p_8443_tcp_https_alt_desc'},
  {port:8883,proto:'TCP',serviceKey:'p_8883_tcp_mqtt_tls_service',descKey:'p_8883_tcp_mqtt_tls_desc'},
  {port:9092,proto:'TCP',serviceKey:'p_9092_tcp_kafka_service',descKey:'p_9092_tcp_kafka_desc'},
  {port:9200,proto:'TCP',serviceKey:'p_9200_tcp_elasticsearch_service',descKey:'p_9200_tcp_elasticsearch_desc'},
  {port:9300,proto:'TCP',serviceKey:'p_9300_tcp_elasticsearch_service',descKey:'p_9300_tcp_elasticsearch_desc'},
  {port:10250,proto:'TCP',serviceKey:'p_10250_tcp_kubelet_service',descKey:'p_10250_tcp_kubelet_desc'},
  {port:27017,proto:'TCP',serviceKey:'p_27017_tcp_mongodb_service',descKey:'p_27017_tcp_mongodb_desc'},
  {port:5004,proto:'UDP',serviceKey:'p_5004_udp_rtp_service',descKey:'p_5004_udp_rtp_desc'},
  {port:5005,proto:'UDP',serviceKey:'p_5005_udp_rtcp_service',descKey:'p_5005_udp_rtcp_desc'},
  {port:554,proto:'TCP/UDP',serviceKey:'p_554_tcp_udp_rtsp_service',descKey:'p_554_tcp_udp_rtsp_desc'},
  {port:111,proto:'TCP/UDP',serviceKey:'p_111_tcp_udp_sunrpc_service',descKey:'p_111_tcp_udp_sunrpc_desc'},
  {port:2049,proto:'TCP/UDP',serviceKey:'p_2049_tcp_udp_nfs_service',descKey:'p_2049_tcp_udp_nfs_desc'},
  {port:5900,proto:'TCP',serviceKey:'p_5900_tcp_vnc_service',descKey:'p_5900_tcp_vnc_desc'},
  {port:6000,proto:'TCP',serviceKey:'p_6000_tcp_x11_service',descKey:'p_6000_tcp_x11_desc'},
  {port:1723,proto:'TCP',serviceKey:'p_1723_tcp_pptp_service',descKey:'p_1723_tcp_pptp_desc'},
  {port:1701,proto:'UDP',serviceKey:'p_1701_udp_l2tp_service',descKey:'p_1701_udp_l2tp_desc'},
  {port:1194,proto:'UDP',serviceKey:'p_1194_udp_openvpn_service',descKey:'p_1194_udp_openvpn_desc'},
  {port:500,proto:'UDP',serviceKey:'p_500_udp_isakmp_service',descKey:'p_500_udp_isakmp_desc'},
  {port:4500,proto:'UDP',serviceKey:'p_4500_udp_ipsec_nat_t_service',descKey:'p_4500_udp_ipsec_nat_t_desc'},
  {port:5060,proto:'TCP/UDP',serviceKey:'p_5060_tcp_udp_sip_service',descKey:'p_5060_tcp_udp_sip_desc'},
  {port:5061,proto:'TCP/UDP',serviceKey:'p_5061_tcp_udp_sips_service',descKey:'p_5061_tcp_udp_sips_desc'},
  {port:1812,proto:'UDP',serviceKey:'p_1812_udp_radius_auth_service',descKey:'p_1812_udp_radius_auth_desc'},
  {port:1813,proto:'UDP',serviceKey:'p_1813_udp_radius_acct_service',descKey:'p_1813_udp_radius_acct_desc'},
  {port:37,proto:'TCP/UDP',serviceKey:'p_37_tcp_udp_time_service',descKey:'p_37_tcp_udp_time_desc'},
  {port:43,proto:'TCP',serviceKey:'p_43_tcp_whois_service',descKey:'p_43_tcp_whois_desc'},
  {port:70,proto:'TCP',serviceKey:'p_70_tcp_gopher_service',descKey:'p_70_tcp_gopher_desc'},
  {port:79,proto:'TCP',serviceKey:'p_79_tcp_finger_service',descKey:'p_79_tcp_finger_desc'},
  {port:514,proto:'UDP',serviceKey:'p_514_udp_syslog_service',descKey:'p_514_udp_syslog_desc'},
  {port:515,proto:'TCP',serviceKey:'p_515_tcp_lpd_service',descKey:'p_515_tcp_lpd_desc'},
  {port:520,proto:'UDP',serviceKey:'p_520_udp_rip_service',descKey:'p_520_udp_rip_desc'},
  {port:521,proto:'UDP',serviceKey:'p_521_udp_ripng_service',descKey:'p_521_udp_ripng_desc'},
  {port:631,proto:'TCP/UDP',serviceKey:'p_631_tcp_udp_ipp_service',descKey:'p_631_tcp_udp_ipp_desc'},
  {port:873,proto:'TCP',serviceKey:'p_873_tcp_rsync_service',descKey:'p_873_tcp_rsync_desc'},
  {port:1433,proto:'TCP',serviceKey:'p_1433_tcp_mssql_service',descKey:'p_1433_tcp_mssql_desc'},
  {port:3306,proto:'TCP',serviceKey:'p_3306_tcp_mysql_service',descKey:'p_3306_tcp_mysql_desc'},
  {port:5432,proto:'TCP',serviceKey:'p_5432_tcp_postgresql_service',descKey:'p_5432_tcp_postgresql_desc'},
  {port:6379,proto:'TCP',serviceKey:'p_6379_tcp_redis_service',descKey:'p_6379_tcp_redis_desc'},
  {port:27017,proto:'TCP',serviceKey:'p_27017_tcp_mongodb_service',descKey:'p_27017_tcp_mongodb_desc'},
  {port:8080,proto:'TCP',serviceKey:'p_8080_tcp_http_alt_service',descKey:'p_8080_tcp_http_alt_desc'},
  {port:8443,proto:'TCP',serviceKey:'p_8443_tcp_https_alt_service',descKey:'p_8443_tcp_https_alt_desc'},
  {port:9092,proto:'TCP',serviceKey:'p_9092_tcp_kafka_service',descKey:'p_9092_tcp_kafka_desc'},
  {port:10000,proto:'TCP',serviceKey:'p_10000_tcp_webmin_service',descKey:'p_10000_tcp_webmin_desc'},
];

const PROTOCOL_DATA = [
  {num:1,nameKey:'pr_1_icmp_name',descKey:'pr_1_icmp_desc',rfc:'RFC 792'},
  {num:2,nameKey:'pr_2_igmp_name',descKey:'pr_2_igmp_desc',rfc:'RFC 1112'},
  {num:4,nameKey:'pr_4_ip_in_ip_name',descKey:'pr_4_ip_in_ip_desc',rfc:'RFC 2003'},
  {num:6,nameKey:'pr_6_tcp_name',descKey:'pr_6_tcp_desc',rfc:'RFC 793'},
  {num:8,nameKey:'pr_8_egp_name',descKey:'pr_8_egp_desc',rfc:'RFC 827'},
  {num:9,nameKey:'pr_9_igp_name',descKey:'pr_9_igp_desc',rfc:'any private IGP'},
  {num:17,nameKey:'pr_17_udp_name',descKey:'pr_17_udp_desc',rfc:'RFC 768'},
  {num:27,nameKey:'pr_27_rdp_name',descKey:'pr_27_rdp_desc',rfc:'RFC 908'},
  {num:41,nameKey:'pr_41_ipv6_in_ipv4_name',descKey:'pr_41_ipv6_in_ipv4_desc',rfc:'RFC 2473'},
  {num:46,nameKey:'pr_46_rsvp_name',descKey:'pr_46_rsvp_desc',rfc:'RFC 2205'},
  {num:47,nameKey:'pr_47_gre_name',descKey:'pr_47_gre_desc',rfc:'RFC 2784'},
  {num:50,nameKey:'pr_50_esp_name',descKey:'pr_50_esp_desc',rfc:'RFC 4303'},
  {num:51,nameKey:'pr_51_ah_name',descKey:'pr_51_ah_desc',rfc:'RFC 4302'},
  {num:58,nameKey:'pr_58_ipv6_icmp_name',descKey:'pr_58_ipv6_icmp_desc',rfc:'RFC 4443'},
  {num:88,nameKey:'pr_88_eigrp_name',descKey:'pr_88_eigrp_desc',rfc:'Cisco'},
  {num:89,nameKey:'pr_89_ospf_name',descKey:'pr_89_ospf_desc',rfc:'RFC 2328'},
  {num:103,nameKey:'pr_103_pim_name',descKey:'pr_103_pim_desc',rfc:'RFC 4601'},
  {num:112,nameKey:'pr_112_vrrp_name',descKey:'pr_112_vrrp_desc',rfc:'RFC 5798'},
  {num:115,nameKey:'pr_115_l2tp_name',descKey:'pr_115_l2tp_desc',rfc:'RFC 2661'},
  {num:132,nameKey:'pr_132_sctp_name',descKey:'pr_132_sctp_desc',rfc:'RFC 4960'},
];


const ROUTING_DATA = [
  {name:'Connected', ad:0, type:'Direct', algo:'—', metric:'Direct', descKey:'route_connected'},
  {name:'Static', ad:1, type:'Manual', algo:'—', metric:'Manual', descKey:'route_static'},
  {name:'EIGRP (Summary)', ad:5, type:'IGP', algo:'DUAL', metric:'Bandwidth/Delay', descKey:'route_eigrp_summary'},
  {name:'eBGP', ad:20, type:'EGP', algo:'Path Vector', metric:'AS Path', descKey:'route_ebgp'},
  {name:'EIGRP (Internal)', ad:90, type:'IGP', algo:'DUAL', metric:'Composite', descKey:'route_eigrp_internal'},
  {name:'IGRP', ad:100, type:'IGP', algo:'Dist. Vector', metric:'Composite', descKey:'route_igrp'},
  {name:'OSPF', ad:110, type:'IGP', algo:'Link State', metric:'Cost', descKey:'route_ospf'},
  {name:'IS-IS', ad:115, type:'IGP', algo:'Link State', metric:'Cost', descKey:'route_isis'},
  {name:'RIP', ad:120, type:'IGP', algo:'Dist. Vector', metric:'Hop Count', descKey:'route_rip'},
  {name:'EIGRP (External)', ad:170, type:'IGP', algo:'DUAL', metric:'Composite', descKey:'route_eigrp_external'},
  {name:'iBGP', ad:200, type:'EGP', algo:'Path Vector', metric:'AS Path', descKey:'route_ibgp'},
  {name:'Unreachable', ad:255, type:'—', algo:'—', metric:'—', descKey:'route_unreachable'},
];

window.SplitMerge = SplitMerge;
window.AD_DATA = ROUTING_DATA;
