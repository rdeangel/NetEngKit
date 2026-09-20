const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── Tunnel Overhead Reference Data ──────────────────────────
const TO_BASE_DATA = [
  { id: 'mpls', name: 'MPLS', rfc: 'RFC 3032', baseOverhead: 0 },
  { id: 'l2tpv3', name: 'L2TPv3 (IP)', rfc: 'RFC 3931', baseOverhead: 0 },
  { id: 'gre', name: 'GRE', rfc: 'RFC 2784', baseOverhead: 24 },
  { id: 'ipsec_esp_transport', name: 'IPsec ESP Transport', rfc: 'RFC 4303', baseOverhead: 0 },
  { id: 'nvgre', name: 'NVGRE', rfc: 'RFC 7637', baseOverhead: 42 },
  { id: 'gre_ipv6', name: 'GRE over IPv6', rfc: 'RFC 7676', baseOverhead: 44 },
  { id: 'l2tpv3_udp', name: 'L2TPv3 (UDP)', rfc: 'RFC 3931', baseOverhead: 0 },
  { id: 'capwap', name: 'CAPWAP', rfc: 'RFC 5415', baseOverhead: 44 },
  { id: 'vxlan', name: 'VXLAN', rfc: 'RFC 7348', baseOverhead: 50 },
  { id: 'ipsec_esp_tunnel', name: 'IPsec ESP Tunnel', rfc: 'RFC 4303', baseOverhead: 0 },
  { id: 'geneve', name: 'GENEVE', rfc: 'RFC 8926', baseOverhead: 0 },
  { id: 'wireguard', name: 'WireGuard', rfc: 'RFC 4039 (Informative)', baseOverhead: 60 },
  { id: 'ipsec_esp_tunnel_ipv6', name: 'IPsec ESP Tunnel (IPv6)', rfc: 'RFC 4303', baseOverhead: 0 },
  { id: 'wireguard_ipv6', name: 'WireGuard over IPv6', rfc: 'RFC 4039', baseOverhead: 80 },
];

// IPsec ESP overhead by cipher (transport mode payload only, no outer IP)
const TO_IPSEC_CIPHERS = {
  'aes_cbc_hmac_sha1': { label: 'AES-CBC / HMAC-SHA1', transportOverhead: 38, tunnelIpv4Overhead: 58, tunnelIpv6Overhead: 78, key: 'aes_cbc' },
  'aes_gcm': { label: 'AES-GCM', transportOverhead: 30, tunnelIpv4Overhead: 50, tunnelIpv6Overhead: 70, key: 'aes_gcm' },
  'chacha20_poly1305': { label: 'ChaCha20-Poly1305', transportOverhead: 28, tunnelIpv4Overhead: 48, tunnelIpv6Overhead: 68, key: 'chacha' },
};

function TunnelOverhead({ onShare, initialData }) {
  const { t } = useTranslation();
  const [toMtu, setToMtu] = usePersistentState('tunnel_overhead:mtu', initialData?.mtu ?? 1500);
  const [toMplsLabels, setToMplsLabels] = usePersistentState('tunnel_overhead:mpls_labels', initialData?.mplsLabels ?? 2);
  const [toGeneveTlv, setToGeneveTlv] = usePersistentState('tunnel_overhead:geneve_tlv', initialData?.geneveTlv ?? 8);
  const [toL2tpCookie, setToL2tpCookie] = usePersistentState('tunnel_overhead:l2tp_cookie', initialData?.l2tpCookie ?? 4);
  const [toIpsecCipher, setToIpsecCipher] = usePersistentState('tunnel_overhead:ipsec_cipher', initialData?.ipsecCipher ?? 'aes_cbc_hmac_sha1');
  const [toSortBy, setToSortBy] = usePersistentState('tunnel_overhead:sort', initialData?.sortBy ?? 'overhead_asc');

  useEffect(() => {
    if (initialData) {
      if (initialData.mtu !== undefined) setToMtu(initialData.mtu);
      if (initialData.mplsLabels !== undefined) setToMplsLabels(initialData.mplsLabels);
      if (initialData.geneveTlv !== undefined) setToGeneveTlv(initialData.geneveTlv);
      if (initialData.l2tpCookie !== undefined) setToL2tpCookie(initialData.l2tpCookie);
      if (initialData.ipsecCipher !== undefined) setToIpsecCipher(initialData.ipsecCipher);
    }
  }, [initialData]);

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'tunnel-overhead', mtu: toMtu, mplsLabels: toMplsLabels, geneveTlv: toGeneveTlv, l2tpCookie: toL2tpCookie, ipsecCipher: toIpsecCipher });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [toMtu, toMplsLabels, toGeneveTlv, toL2tpCookie, toIpsecCipher, onShare]);

  const cipherData = TO_IPSEC_CIPHERS[toIpsecCipher] || TO_IPSEC_CIPHERS['aes_cbc_hmac_sha1'];

  // Compute overhead for each tunnel based on user settings
  const toComputed = useMemo(() => {
    const mtu = parseInt(toMtu) || 1500;
    const mplsLabels = Math.max(1, Math.min(5, parseInt(toMplsLabels) || 2));
    const geneveTlv = Math.max(0, Math.min(252, parseInt(toGeneveTlv) || 8));
    const l2tpCookie = parseInt(toL2tpCookie) || 4;

    return TO_BASE_DATA.map(entry => {
      let overhead = entry.baseOverhead;
      let breakdown = t(`tunnel_overhead.data.${entry.id}_breakdown`);
      let desc = t(`tunnel_overhead.data.${entry.id}_desc`);

      switch (entry.id) {
        case 'ipsec_esp_transport':
          overhead = cipherData.transportOverhead;
          breakdown = t(`tunnel_overhead.data.ipsec_${cipherData.key}_transport_breakdown`);
          break;
        case 'ipsec_esp_tunnel':
          overhead = cipherData.tunnelIpv4Overhead;
          breakdown = t(`tunnel_overhead.data.ipsec_${cipherData.key}_tunnel_breakdown`);
          break;
        case 'ipsec_esp_tunnel_ipv6':
          overhead = cipherData.tunnelIpv6Overhead;
          breakdown = t(`tunnel_overhead.data.ipsec_${cipherData.key}_tunnel_ipv6_breakdown`);
          break;
        case 'geneve':
          // 20B outer IP + 8B UDP + 8B Geneve base + geneveTlv TLVs + 14B Ethernet
          overhead = 20 + 8 + 8 + geneveTlv + 14;
          breakdown = t('tunnel_overhead.data.geneve_breakdown', { size: 8 + geneveTlv, tlv: geneveTlv });
          break;
        case 'mpls':
          overhead = 4 * mplsLabels;
          breakdown = t('tunnel_overhead.data.mpls_breakdown', { labels: mplsLabels, overhead, count: mplsLabels });
          break;
        case 'l2tpv3':
          // IP direct: session(4) + cookie(l2tpCookie) + header(4)
          overhead = 4 + l2tpCookie + 4;
          breakdown = t('tunnel_overhead.data.l2tpv3_breakdown', { cookie: l2tpCookie });
          break;
        case 'l2tpv3_udp':
          // 20B outer IP + 8B UDP + 4B Session + l2tpCookie + 8B L2TP hdr
          overhead = 20 + 8 + 4 + l2tpCookie + 8;
          breakdown = t('tunnel_overhead.data.l2tpv3_udp_breakdown', { cookie: l2tpCookie });
          break;
        default:
          break;
      }

      const effectiveMtu = mtu - overhead;
      const pctOverhead = mtu > 0 ? (overhead / mtu) * 100 : 0;

      return { ...entry, overhead, breakdown, desc, effectiveMtu: Math.max(0, effectiveMtu), pctOverhead };
    });
  }, [toMtu, toMplsLabels, toGeneveTlv, toL2tpCookie, toIpsecCipher, cipherData, t]);

  // Sort
  const toSorted = useMemo(() => {
    const copy = [...toComputed];
    switch (toSortBy) {
      case 'overhead_asc': return copy.sort((a, b) => a.overhead - b.overhead);
      case 'overhead_desc': return copy.sort((a, b) => b.overhead - a.overhead);
      case 'effective_mtu_desc': return copy.sort((a, b) => b.effectiveMtu - a.effectiveMtu);
      case 'name_asc': return copy.sort((a, b) => a.name.localeCompare(b.name));
      default: return copy;
    }
  }, [toComputed, toSortBy]);

  const mtu = parseInt(toMtu) || 1500;

  const toGetOverheadColor = (pct) => {
    if (pct <= 1) return 'var(--green)';
    if (pct <= 3) return 'var(--cyan)';
    if (pct <= 6) return 'var(--yellow)';
    return 'var(--red)';
  };

  const toGetOverheadBadge = (pct) => {
    if (pct <= 1) return 'badge-green';
    if (pct <= 3) return 'badge-cyan';
    if (pct <= 6) return 'badge-yellow';
    return 'badge-red';
  };

  const toBarColor = (pct) => {
    if (pct <= 1) return 'var(--green)';
    if (pct <= 3) return 'var(--cyan)';
    if (pct <= 6) return 'var(--yellow)';
    return 'var(--red)';
  };

  const handleExport = () => {
    const rows = toSorted.map(e => ({
      tunnel: e.name,
      rfc: e.rfc,
      overhead_bytes: e.overhead,
      effective_mtu: e.effectiveMtu,
      overhead_pct: e.pctOverhead.toFixed(2) + '%',
      breakdown: e.breakdown,
      description: e.desc,
    }));
    exportJSON({ physical_mtu: mtu, mpls_labels: parseInt(toMplsLabels) || 2, geneve_tlv_bytes: parseInt(toGeneveTlv) || 8, l2tpv3_cookie_bytes: parseInt(toL2tpCookie) || 4, ipsec_cipher: cipherData.label, tunnels: rows }, 'tunnel-overhead-comparison.json');
  };

  const ipsecCipherOptions = Object.entries(TO_IPSEC_CIPHERS).map(([k, v]) => ({ key: k, label: v.label }));
  const mplsCount = Math.max(1, Math.min(5, parseInt(toMplsLabels) || 2));
  const geneveTlvVal = Math.max(0, Math.min(252, parseInt(toGeneveTlv) || 8));

  return (
    <div className="fadein">
      {/* ── Input Card ── */}
      <div className="card">
        <div className="card-title">{t('tunnel_overhead.title')}</div>
        <div className="two-col grid-mobile-1" style={{ gap: 20 }}>
          <div className="field">
            <label className="label">{t('tunnel_overhead.physical_mtu')}</label>
            <div className="input-row">
              <input className="input" type="number" min="576" max="9216" value={toMtu} onChange={e => setToMtu(e.target.value)} placeholder="1500" style={{ maxWidth: 120 }} />
              <select className="input" style={{ width: 200 }} value={toMtu} onChange={e => setToMtu(e.target.value)}>
                <option value="1500">{t('tunnel_overhead.mtu_1500')}</option>
                <option value="9000">{t('tunnel_overhead.mtu_9000')}</option>
                <option value="9216">{t('tunnel_overhead.mtu_9216')}</option>
                <option value="4470">{t('tunnel_overhead.mtu_4470')}</option>
                <option value="1492">{t('tunnel_overhead.mtu_1492')}</option>
                <option value="1280">{t('tunnel_overhead.mtu_1280')}</option>
              </select>
            </div>
          </div>
          <div className="field">
            <label className="label">{t('tunnel_overhead.ipsec_cipher')}</label>
            <select className="input" value={toIpsecCipher} onChange={e => setToIpsecCipher(e.target.value)}>
              {ipsecCipherOptions.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12, marginTop: 16 }}>
          <div className="field">
            <label className="label">{t('tunnel_overhead.mpls_labels')}</label>
            <div className="input-row">
              <input className="input" type="number" min="1" max="5" value={toMplsLabels} onChange={e => setToMplsLabels(e.target.value)} style={{ maxWidth: 80 }} />
              <span className="hint" style={{ whiteSpace: 'nowrap' }}>{t('tunnel_overhead.mpls_labels_hint', { count: mplsCount, bytes: mplsCount * 4 })}</span>
            </div>
          </div>
          <div className="field">
            <label className="label">{t('tunnel_overhead.geneve_tlv')}</label>
            <div className="input-row">
              <input className="input" type="number" min="0" max="252" step="4" value={toGeneveTlv} onChange={e => setToGeneveTlv(e.target.value)} style={{ maxWidth: 80 }} />
              <span className="hint" style={{ whiteSpace: 'nowrap' }}>{t('tunnel_overhead.geneve_tlv_hint', { bytes: geneveTlvVal })}</span>
            </div>
          </div>
          <div className="field">
            <label className="label">{t('tunnel_overhead.l2tp_cookie')}</label>
            <select className="input" style={{ maxWidth: 120 }} value={toL2tpCookie} onChange={e => setToL2tpCookie(parseInt(e.target.value))}>
              <option value="0">0B</option>
              <option value="4">4B</option>
              <option value="8">8B</option>
            </select>
          </div>
        </div>
      </div>

      {/* ── Comparison Table ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{t('tunnel_overhead.comparison')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select className="input" style={{ width: 'auto', fontSize: 11 }} value={toSortBy} onChange={e => setToSortBy(e.target.value)}>
              <option value="overhead_asc">{t('tunnel_overhead.sort_overhead_asc')}</option>
              <option value="overhead_desc">{t('tunnel_overhead.sort_overhead_desc')}</option>
              <option value="effective_mtu_desc">{t('tunnel_overhead.sort_effective_mtu')}</option>
              <option value="name_asc">{t('tunnel_overhead.sort_name')}</option>
            </select>
            <button className="btn btn-sm btn-ghost" onClick={handleExport}>{t('common.export_json')}</button>
          </div>
        </div>

        <div className="table-wrap hide-mobile">
          <table>
            <thead>
              <tr>
                <th>{t('tunnel_overhead.th_tunnel')}</th>
                <th>{t('tunnel_overhead.th_overhead')}</th>
                <th>{t('tunnel_overhead.th_effective_mtu')}</th>
                <th>{t('tunnel_overhead.th_pct_overhead')}</th>
                <th>{t('tunnel_overhead.th_breakdown')}</th>
                <th>{t('tunnel_overhead.th_rfc')}</th>
              </tr>
            </thead>
            <tbody>
              {toSorted.map(entry => (
                <tr key={entry.id}>
                  <td>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>{entry.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{entry.desc}</div>
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', color: toGetOverheadColor(entry.pctOverhead), fontWeight: 600 }}>
                    {entry.overhead}B
                  </td>
                  <td style={{ fontFamily: 'var(--mono)', fontWeight: 600, color: entry.effectiveMtu < 1280 ? 'var(--red)' : entry.effectiveMtu < mtu * 0.9 ? 'var(--yellow)' : 'var(--cyan)' }}>
                    {entry.effectiveMtu}B
                  </td>
                  <td>
                    <span className={`badge ${toGetOverheadBadge(entry.pctOverhead)}`}>
                      {entry.pctOverhead.toFixed(1)}%
                    </span>
                  </td>
                  <td style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
                    {entry.breakdown}
                  </td>
                  <td><RFCLink rfc={entry.rfc} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile View */}
        <div className="show-mobile mobile-cards">
          {toSorted.map(entry => (
            <div key={entry.id} className="mobile-card" style={{ borderLeft: `3px solid ${toGetOverheadColor(entry.pctOverhead)}` }}>
              <div className="mobile-card-row">
                <span className="mobile-card-label" style={{ fontWeight: 600 }}>{entry.name}</span>
                <span className={`badge ${toGetOverheadBadge(entry.pctOverhead)}`}>{entry.pctOverhead.toFixed(1)}%</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('tunnel_overhead.th_overhead')}</span>
                <span className="mobile-card-value" style={{ color: toGetOverheadColor(entry.pctOverhead), fontWeight: 600 }}>{entry.overhead}B</span>
              </div>
              <div className="mobile-card-row">
                <span className="mobile-card-label">{t('tunnel_overhead.th_effective_mtu')}</span>
                <span className="mobile-card-value" style={{ color: entry.effectiveMtu < 1280 ? 'var(--red)' : 'var(--cyan)', fontWeight: 600 }}>{entry.effectiveMtu}B</span>
              </div>
              <div style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)', marginTop: 4 }}>{entry.breakdown}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Visual Bar Chart ── */}
      <div className="card">
        <div className="card-title">{t('tunnel_overhead.visual_chart')}</div>
        <div className="hint" style={{ marginBottom: 16 }}>{t('tunnel_overhead.visual_hint', { mtu })}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {toSorted.map(entry => {
            const barPct = mtu > 0 ? Math.max(0, (entry.effectiveMtu / mtu) * 100) : 0;
            const overheadPct = mtu > 0 ? Math.min(100, (entry.overhead / mtu) * 100) : 0;
            return (
              <div key={entry.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 150, flexShrink: 0, fontSize: 12, fontWeight: 600, textAlign: 'right', color: toGetOverheadColor(entry.pctOverhead) }} title={entry.name}>
                  {entry.name.length > 18 ? entry.name.substring(0, 16) + '...' : entry.name}
                </div>
                <div style={{ flex: 1, position: 'relative', height: 22 }}>
                  {/* Effective MTU bar */}
                  <div style={{
                    position: 'absolute', top: 0, left: 0, height: '100%', width: `${barPct}%`,
                    background: toBarColor(entry.pctOverhead), borderRadius: 'var(--radius)',
                    opacity: 0.25, transition: 'width 0.3s', maxWidth: '100%',
                  }} />
                  <div style={{
                    position: 'absolute', top: 0, left: 0, height: '100%', width: `${barPct}%`,
                    background: toBarColor(entry.pctOverhead), borderRadius: 'var(--radius)',
                    transition: 'width 0.3s', maxWidth: '100%',
                    display: 'flex', alignItems: 'center', justifyContent: 'flex-end', paddingRight: 6,
                    fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--bg)', fontWeight: 700,
                  }}>
                    {barPct > 12 ? `${entry.effectiveMtu}B` : ''}
                  </div>
                  {/* Overhead portion */}
                  {overheadPct > 0 && barPct < 100 && (
                    <div style={{
                      position: 'absolute', top: 0, left: `${barPct}%`, height: '100%',
                      width: `${Math.min(overheadPct, 100 - barPct)}%`,
                      background: 'var(--red)', borderRadius: '0 var(--radius) var(--radius) 0',
                      opacity: 0.3,
                    }} />
                  )}
                </div>
                <div style={{ width: 65, flexShrink: 0, fontSize: 11, fontFamily: 'var(--mono)', textAlign: 'right', color: 'var(--muted)' }}>
                  {entry.effectiveMtu}B
                </div>
              </div>
            );
          })}
        </div>
        {/* Legend */}
        <div style={{ display: 'flex', gap: 20, marginTop: 16, fontSize: 11, color: 'var(--muted)', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--green)', opacity: 0.8 }} />
            {t('tunnel_overhead.legend_low', { pct: '<=1%' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--cyan)', opacity: 0.8 }} />
            {t('tunnel_overhead.legend_moderate', { pct: '1-3%' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--yellow)', opacity: 0.8 }} />
            {t('tunnel_overhead.legend_high', { pct: '3-6%' })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{ width: 12, height: 12, borderRadius: 2, background: 'var(--red)', opacity: 0.8 }} />
            {t('tunnel_overhead.legend_very_high', { pct: '>6%' })}
          </div>
        </div>
        {/* Physical MTU reference */}
        <div style={{ marginTop: 12, padding: '8px 12px', background: 'var(--panel)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 12 }}>
          <span style={{ color: 'var(--muted)' }}>{t('tunnel_overhead.physical_mtu_label')}:</span>{' '}
          <span style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)', fontWeight: 600 }}>{mtu}B</span>
          {cipherData && (
            <>
              <span style={{ color: 'var(--muted)', marginLeft: 16 }}>{t('tunnel_overhead.ipsec_cipher_label')}:</span>{' '}
              <span style={{ fontFamily: 'var(--mono)', color: 'var(--text)' }}>{cipherData.label}</span>
            </>
          )}
        </div>
      </div>

      {/* ── Quick Reference ── */}
      <div className="card">
        <div className="card-title">{t('tunnel_overhead.quick_ref')}</div>
        <div className="hint" style={{ marginBottom: 12 }}>{t('tunnel_overhead.quick_ref_hint')}</div>
        <div className="result-grid grid-mobile-1">
          <ResultItem label={t('tunnel_overhead.ref_ipv6_min')} value="1280B" />
          <ResultItem label={t('tunnel_overhead.ref_tcp_mss')} value={`${Math.max(0, (parseInt(toMtu) || 1500) - 40)}B`} />
          <ResultItem label={t('tunnel_overhead.ref_jumbo')} value="9000B" />
          <ResultItem label={t('tunnel_overhead.ref_dot1q')} value="+4B" />
        </div>
      </div>
    </div>
  );
}
window.TunnelOverhead = TunnelOverhead;
