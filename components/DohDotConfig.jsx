const { useState, useEffect, useMemo } = React;

// Build resolver map from shared DOH_PROVIDERS (DoH-capable entries only)
const RESOLVERS = {};
(window.DOH_PROVIDERS || []).filter(p => p.doh_url).forEach(p => {
  RESOLVERS[p.key] = {
    name: p.name,
    dot_ips: [...p.ips_v4, ...p.ips_v6],
    doh_url: p.doh_url,
    hostname: p.dot_hostname,
    pin: p.pin,
  };
});

function DohDotConfig({ initialData, onShare }) {
  const { t } = useTranslation();
  const [copied, copy] = useCopy();

  const [resolverType, setResolverType] = usePersistentState('dohdot:resolver', initialData?.resolver ?? 'cloudflare');
  const [customName, setCustomName] = usePersistentState('dohdot:cust_name', initialData?.cust_name ?? 'MyResolver');
  const [customIps, setCustomIps] = usePersistentState('dohdot:cust_ips', initialData?.cust_ips ?? '10.0.0.5, 10.0.0.6');
  const [customDohUrl, setCustomDohUrl] = usePersistentState('dohdot:cust_doh', initialData?.cust_doh ?? 'https://dns.mycorp.local/dns-query');
  const [customHostname, setCustomHostname] = usePersistentState('dohdot:cust_host', initialData?.cust_host ?? 'dns.mycorp.local');
  const [customPin, setCustomPin] = usePersistentState('dohdot:cust_pin', initialData?.cust_pin ?? '');

  const [activePlatform, setActivePlatform] = usePersistentState('dohdot:platform', 'unbound');
  const [dnsOverQ, setDnsOverQ] = usePersistentState('dohdot:doq', false);
  const [fallbackDns, setFallbackDns] = usePersistentState('dohdot:fallback', '8.8.8.8');
  const [sourceIface, setSourceIface] = usePersistentState('dohdot:iface', 'GigabitEthernet1');

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'doh-dot-cfg',
        resolver: resolverType,
        cust_name: customName,
        cust_ips: customIps,
        cust_doh: customDohUrl,
        cust_host: customHostname,
        cust_pin: customPin,
        doq: dnsOverQ,
        fallback: fallbackDns,
        iface: sourceIface
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [resolverType, customName, customIps, customDohUrl, customHostname, customPin, dnsOverQ, fallbackDns, sourceIface, onShare]);

  const activeResolver = useMemo(() => {
    if (resolverType !== 'custom') {
      return RESOLVERS[resolverType];
    }
    const cleanIps = customIps.split(',').map(s => s.trim()).filter(Boolean);
    return {
      name: customName || t('doh_dot_cfg.resolvers.custom_ph', 'Custom Resolver'),
      dot_ips: cleanIps.length > 0 ? cleanIps : ['10.0.0.5'],
      doh_url: customDohUrl || 'https://dns.mycompany.local/dns-query',
      hostname: customHostname || 'dns.mycompany.local',
      pin: customPin || ''
    };
  }, [resolverType, customName, customIps, customDohUrl, customHostname, customPin, t]);

  // Generated configs
  const unboundConfig = useMemo(() => {
    const lines = [];
    lines.push('# Unbound configuration for TLS Forwarding (DoT)');
    lines.push('server:');
    lines.push('    # Enable TLS support');
    lines.push('    tls-cert-bundle: "/etc/ssl/certs/ca-certificates.crt"');
    lines.push('    # Port to listen on locally (Standard DNS)');
    lines.push('    port: 53');
    lines.push('    # To also listen locally on TLS port 853:');
    lines.push('    # interface: 0.0.0.0@853');
    lines.push('    # tls-service-key: "/etc/unbound/unbound_server.key"');
    lines.push('    # tls-service-pem: "/etc/unbound/unbound_server.pem"');
    lines.push('');
    lines.push('forward-zone:');
    lines.push('    name: "."');
    lines.push('    forward-tls-upstream: yes');
    activeResolver.dot_ips.forEach(ip => {
      lines.push(`    forward-addr: ${ip}@853#${activeResolver.hostname}`);
    });
    return lines.join('\n');
  }, [activeResolver]);

  const bindConfig = useMemo(() => {
    const lines = [];
    lines.push('// BIND named.conf forwarding via TLS (DoT)');
    lines.push('options {');
    lines.push('    directory "/var/cache/bind";');
    lines.push('    dnssec-validation auto;');
    lines.push('    auth-nxdomain no;    # conform to RFC1035');
    lines.push('    listen-on { any; };');
    lines.push('');
    lines.push('    // TLS profile definitions (BIND 9.18+)');
    lines.push(`    tls my-tls-profile {`);
    lines.push(`        ca-file "/etc/ssl/certs/ca-certificates.crt";`);
    lines.push(`    };`);
    lines.push('');
    lines.push('    // Forward requests to DoT servers');
    lines.push('    forwarders {');
    activeResolver.dot_ips.forEach(ip => {
      lines.push(`        ${ip} port 853 tls my-tls-profile;`);
    });
    lines.push('    };');
    lines.push('    forward only;');
    lines.push('};');
    return lines.join('\n');
  }, [activeResolver]);

  const systemdResolvedConfig = useMemo(() => {
    const lines = [];
    lines.push('# /etc/systemd/resolved.conf');
    lines.push('[Resolve]');
    const dnsServers = activeResolver.dot_ips.map(ip => `${ip}#${activeResolver.hostname}`).join(' ');
    lines.push(`DNS=${dnsServers}`);
    if (fallbackDns) {
      lines.push(`FallbackDNS=${fallbackDns}`);
    }
    lines.push('Domains=~.');
    lines.push('DNSOverTLS=yes');
    lines.push('MulticastDNS=no');
    lines.push('LLMNR=no');
    return lines.join('\n');
  }, [activeResolver, fallbackDns]);

  const ciscoConfig = useMemo(() => {
    const lines = [];
    lines.push('! Cisco IOS-XE Secure DNS Client configuration');
    lines.push('!');
    lines.push('! 1. Define name servers');
    activeResolver.dot_ips.forEach(ip => {
      lines.push(`ip name-server ${ip}`);
    });
    lines.push('!');
    lines.push('! 2. Create DNS over HTTPS profile (IOS-XE 17.6+)');
    lines.push('ip dns secure-profile SECURE-DOH-PROFILE');
    lines.push(' doh-group');
    lines.push(`  source interface ${sourceIface}`);
    lines.push(`  resolver address ${activeResolver.dot_ips[0]} url ${activeResolver.doh_url}`);
    lines.push('!');
    lines.push('! 3. Globally enable secure DNS client');
    lines.push('ip dns secure-client');
    lines.push('ip dns secure-profile use SECURE-DOH-PROFILE');
    lines.push('!');
    lines.push('! Verify status using: show ip dns secure-client status');
    return lines.join('\n');
  }, [activeResolver, sourceIface]);

  const browserConfig = useMemo(() => {
    const lines = [];
    lines.push('=== Firefox Secure DNS Configuration ===');
    lines.push('1. Open Settings and search for "DNS" or "DoH".');
    lines.push('2. Under "Enable DNS over HTTPS", select "Max Protection" or "Increased Protection".');
    lines.push('3. In the "Choose provider" dropdown, select Custom.');
    lines.push(`4. Enter the DoH URL: ${activeResolver.doh_url}`);
    lines.push('');
    lines.push('=== Chrome / Edge / Brave configuration ===');
    lines.push('1. Open Settings -> Privacy and Security -> Security.');
    lines.push('2. Enable "Use secure DNS".');
    lines.push('3. Select "With: Custom" and input the DoH query endpoint:');
    lines.push(`   ${activeResolver.doh_url}`);
    lines.push('');
    lines.push('=== Enterprise Policy GPO/plist Configuration ===');
    lines.push('# Chrome Policies JSON:');
    lines.push('{');
    lines.push(`  "DnsOverHttpsMode": "secure",`);
    lines.push(`  "DnsOverHttpsTemplates": "${activeResolver.doh_url}"`);
    lines.push('}');
    return lines.join('\n');
  }, [activeResolver]);

  const activeContent = useMemo(() => {
    switch (activePlatform) {
      case 'unbound': return unboundConfig;
      case 'bind': return bindConfig;
      case 'resolved': return systemdResolvedConfig;
      case 'cisco': return ciscoConfig;
      case 'browser': return browserConfig;
      default: return '';
    }
  }, [activePlatform, unboundConfig, bindConfig, systemdResolvedConfig, ciscoConfig, browserConfig]);

  const opensslPinCmd = useMemo(() => {
    const host = activeResolver.hostname;
    return `openssl s_client -connect ${host}:853 -showcerts 2>/dev/null | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der | openssl dgst -sha256 -binary | openssl enc -base64`;
  }, [activeResolver]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('doh_dot_cfg.title', 'DNS over HTTPS / DNS over TLS Config Builder')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          {t('doh_dot_cfg.subtitle', 'Generate DNS over HTTPS (DoH) and DNS over TLS (DoT) configurations for server resolvers, client devices, and browsers. Secure and encrypt upstream DNS lookups.')}
        </p>

        <div className="two-col grid-mobile-1" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' }}>
          {/* Settings Column */}
          <div>
            <div style={{ fontWeight: 600, marginBottom: 10, color: 'var(--cyan)' }}>
              {t('doh_dot_cfg.section_settings', '1. Resolver & General settings')}
            </div>

            <div className="field">
              <label className="label">{t('doh_dot_cfg.resolver_type', 'Resolver Provider')}</label>
              <select className="input" value={resolverType} onChange={e => setResolverType(e.target.value)}>
                {(window.DOH_PROVIDERS || []).filter(p => p.doh_url).map(p => (
                  <option key={p.key} value={p.key}>{p.name}</option>
                ))}
                <option value="custom">{t('doh_dot_cfg.custom', 'Custom Private Resolver')}</option>
              </select>
            </div>

            {resolverType === 'custom' && (
              <div style={{ padding: 12, background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--border)', marginBottom: 14 }}>
                <div className="field">
                  <label className="label">{t('doh_dot_cfg.cust_name', 'Name')}</label>
                  <input className="input" value={customName} onChange={e => setCustomName(e.target.value)} placeholder="My Corp Resolver" />
                </div>
                <div className="field">
                  <label className="label">{t('doh_dot_cfg.cust_ips', 'IP Addresses (comma separated)')}</label>
                  <input className="input" value={customIps} onChange={e => setCustomIps(e.target.value)} placeholder="10.0.0.5, 10.0.0.6" />
                </div>
                <div className="field">
                  <label className="label">{t('doh_dot_cfg.cust_doh', 'DoH Query URL')}</label>
                  <input className="input" value={customDohUrl} onChange={e => setCustomDohUrl(e.target.value)} placeholder="https://dns.mycorp.local/dns-query" />
                </div>
                <div className="field">
                  <label className="label">{t('doh_dot_cfg.cust_host', 'TLS Server Hostname')}</label>
                  <input className="input" value={customHostname} onChange={e => setCustomHostname(e.target.value)} placeholder="dns.mycorp.local" />
                </div>
                <div className="field">
                  <label className="label">{t('doh_dot_cfg.cust_pin', 'SHA-256 Pin Fingerprint (Optional)')}</label>
                  <input className="input" value={customPin} onChange={e => setCustomPin(e.target.value)} placeholder="Base64-encoded hash" />
                </div>
              </div>
            )}

            <div className="field">
              <label className="label">{t('doh_dot_cfg.fallback', 'Fallback Unencrypted IP (e.g. if DoT fails)')}</label>
              <input className="input" value={fallbackDns} onChange={e => setFallbackDns(e.target.value)} placeholder="8.8.8.8" />
            </div>

            <div className="field">
              <label className="label">{t('doh_dot_cfg.source_iface', 'Cisco Client Source Interface')}</label>
              <input className="input" value={sourceIface} onChange={e => setSourceIface(e.target.value)} placeholder="GigabitEthernet1" />
            </div>

            {/* Certificate Pinning Guide */}
            <div style={{ marginTop: 16, padding: 12, background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--border)' }}>
              <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--cyan)', marginBottom: 6 }}>
                🛡️ {t('doh_dot_cfg.cert_pinning', 'Certificate Pinning Guide')}
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', margin: '0 0 10 0' }}>
                {t('doh_dot_cfg.pin_desc', 'Use certificate pinning (SPKI) to prevent DNS hijacking by untrusted intermediate CA certificates. Extract the SHA-256 hash using the command below:')}
              </p>
              <div style={{ position: 'relative' }}>
                <pre style={{
                  background: 'var(--code-bg)',
                  color: 'var(--code-fg)',
                  padding: '10px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontFamily: 'monospace',
                  overflowX: 'auto',
                  margin: 0,
                  paddingRight: 32
                }}>
                  {opensslPinCmd}
                </pre>
                <div style={{ position: 'absolute', top: 4, right: 4 }}>
                  <CopyBtn text={opensslPinCmd} />
                </div>
              </div>
              {activeResolver.pin && (
                <div style={{ marginTop: 8, fontSize: 12 }}>
                  <strong>{resolverType === 'custom' ? activeResolver.name : t(`doh_dot_cfg.resolvers.${resolverType}`, activeResolver.name)} SPKI Pin:</strong>
                  <code style={{ display: 'block', background: 'var(--border)', padding: '2px 6px', borderRadius: 4, wordBreak: 'break-all', marginTop: 4 }}>
                    {activeResolver.pin}
                  </code>
                </div>
              )}
            </div>
          </div>

          {/* Configurations Column */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 10 }}>
              <div style={{ fontWeight: 600, color: 'var(--cyan)' }}>
                {t('doh_dot_cfg.section_output', '2. Configuration output')}
              </div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button className={`btn btn-sm ${activePlatform === 'unbound' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActivePlatform('unbound')}>Unbound</button>
                <button className={`btn btn-sm ${activePlatform === 'bind' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActivePlatform('bind')}>BIND</button>
                <button className={`btn btn-sm ${activePlatform === 'resolved' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActivePlatform('resolved')}>resolved</button>
                <button className={`btn btn-sm ${activePlatform === 'cisco' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActivePlatform('cisco')}>Cisco</button>
                <button className={`btn btn-sm ${activePlatform === 'browser' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActivePlatform('browser')}>Browsers</button>
              </div>
            </div>

            <div style={{ position: 'relative' }}>
              <pre style={{
                background: 'var(--code-bg)',
                color: 'var(--code-fg)',
                padding: '12px 14px',
                borderRadius: 8,
                border: '1px solid var(--border)',
                fontFamily: 'monospace',
                fontSize: 12,
                overflowX: 'auto',
                whiteSpace: 'pre',
                minHeight: 280,
                maxHeight: 400,
                margin: 0
              }}>
                {activeContent}
              </pre>
              <div style={{ position: 'absolute', top: 8, right: 8 }}>
                <CopyBtn text={activeContent} />
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', background: 'var(--panel)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
              <strong>{t('doh_dot_cfg.instructions.title', 'Platform Specific Instructions:')}</strong>
              {activePlatform === 'unbound' && <p style={{ margin: '4px 0 0 0' }} dangerouslySetInnerHTML={{ __html: t('doh_dot_cfg.instructions.unbound', 'Save as <code>/etc/unbound/unbound.conf.d/tls-forward.conf</code> and restart Unbound. Ensure your package manager installed CA certs.') }} />}
              {activePlatform === 'bind' && <p style={{ margin: '4px 0 0 0' }} dangerouslySetInnerHTML={{ __html: t('doh_dot_cfg.instructions.bind', 'Place options into your <code>named.conf.options</code> file. BIND 9.18+ has native support for TLS forwarding.') }} />}
              {activePlatform === 'resolved' && <p style={{ margin: '4px 0 0 0' }} dangerouslySetInnerHTML={{ __html: t('doh_dot_cfg.instructions.resolved', 'Edit <code>/etc/systemd/resolved.conf</code>, insert these lines, then run <code>systemctl restart systemd-resolved</code>.') }} />}
              {activePlatform === 'cisco' && <p style={{ margin: '4px 0 0 0' }}>{t('doh_dot_cfg.instructions.cisco', 'Paste into your Cisco console. Resolving requires that the source interface has route-ability to the resolver endpoint.')}</p>}
              {activePlatform === 'browser' && <p style={{ margin: '4px 0 0 0' }}>{t('doh_dot_cfg.instructions.browser', 'This configuration is local to the device browser. This bypasses the default operating system resolvers.')}</p>}
            </div>
          </div>
        </div>

        {/* Comparison Table Section */}
        <div style={{ marginTop: 24, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
          <div style={{ fontWeight: 600, color: 'var(--cyan)', marginBottom: 12 }}>
            📊 {t('doh_dot_cfg.title_comparison', 'Comparison: DoH vs. DoT vs. DoQ')}
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--border)', color: 'var(--muted)' }}>
                  <th style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.th_feature', 'Feature')}</th>
                  <th style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.th_doh', 'DNS over HTTPS (DoH)')}</th>
                  <th style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.th_dot', 'DNS over TLS (DoT)')}</th>
                  <th style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.th_doq', 'DNS over QUIC (DoQ)')}</th>
                </tr>
              </thead>
              <tbody>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{t('doh_dot_cfg.comparison.row_port', 'Port Number')}</td>
                  <td style={{ padding: 8 }}>TCP 443</td>
                  <td style={{ padding: 8 }}>TCP 853</td>
                  <td style={{ padding: 8 }}>UDP 784 / UDP 853</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{t('doh_dot_cfg.comparison.row_transport', 'Transport Protocol')}</td>
                  <td style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.row_transport_doh', 'HTTP/2 or HTTP/3 over TCP/UDP')}</td>
                  <td style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.row_transport_dot', 'TLS over TCP')}</td>
                  <td style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.row_transport_doq', 'QUIC over UDP')}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{t('doh_dot_cfg.comparison.row_overhead', 'Overhead')}</td>
                  <td style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.row_overhead_doh', 'High (HTTP headers, frames)')}</td>
                  <td style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.row_overhead_dot', 'Medium (TLS + TCP handshakes)')}</td>
                  <td style={{ padding: 8 }}>{t('doh_dot_cfg.comparison.row_overhead_doq', 'Low (Single-packet handshakes, UDP)')}</td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{t('doh_dot_cfg.comparison.row_resilience', 'Port Blocking Resilience')}</td>
                  <td style={{ padding: 8 }}>
                    <span className="badge badge-green">{t('doh_dot_cfg.comparison.row_resilience_doh', 'High')}</span> {t('doh_dot_cfg.comparison.row_resilience_doh_desc', '(Shares 443 with HTTPS)')}
                  </td>
                  <td style={{ padding: 8 }}>
                    <span className="badge badge-red">{t('doh_dot_cfg.comparison.row_resilience_dot', 'Low')}</span> {t('doh_dot_cfg.comparison.row_resilience_dot_desc', '(Dedicated port 853 is easily blocked)')}
                  </td>
                  <td style={{ padding: 8 }}>
                    <span className="badge badge-yellow">{t('doh_dot_cfg.comparison.row_resilience_doq', 'Medium')}</span> {t('doh_dot_cfg.comparison.row_resilience_doq_desc', '(Easy to block via UDP port filters)')}
                  </td>
                </tr>
                <tr style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: 8, fontWeight: 600 }}>{t('doh_dot_cfg.comparison.row_rfc', 'RFC Standard')}</td>
                  <td style={{ padding: 8 }}><RFCLink rfc="8484" /></td>
                  <td style={{ padding: 8 }}><RFCLink rfc="7858" /></td>
                  <td style={{ padding: 8 }}><RFCLink rfc="9250" /></td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Network Policy & Firewall Considerations */}
        <div style={{ marginTop: 24, padding: 14, background: 'rgba(0, 188, 212, 0.05)', borderLeft: '4px solid var(--cyan)', borderRadius: 4 }}>
          <div style={{ fontWeight: 600, color: 'var(--cyan)', fontSize: 14, marginBottom: 8 }}>
            🔒 {t('doh_dot_cfg.policy_title', 'Network Policy & Security Considerations for Firewalls')}
          </div>
          <div style={{ fontSize: 13, lineHeight: '1.5' }}>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              <li>
                <strong>{t('doh_dot_cfg.policy.enterprise.title', 'Enterprise Control:')}</strong> {t('doh_dot_cfg.policy.enterprise.desc', 'DoH bypasses local DNS monitors. Security policies typically block public DoH resolvers (e.g. by dropping traffic to common DoH IP list or blocking domains like <code>use-application-dns.net</code> to trigger browser fallback to local DNS).')}
              </li>
              <li>
                <strong>{t('doh_dot_cfg.policy.firewall.title', 'Firewall Inspection:')}</strong> {t('doh_dot_cfg.policy.firewall.desc', 'DoT can be identified via ALPN (Application-Layer Protocol Negotiation) with values like <code>dot</code> in TLS client hellos. DoH is harder to inspect without full SSL decryption since it blends with normal web traffic.')}
              </li>
              <li>
                <strong>{t('doh_dot_cfg.policy.split.title', 'Split DNS & Internal Domains:')}</strong> {t('doh_dot_cfg.policy.split.desc', 'Enabling encrypted DNS in browsers may cause failure when resolving internal domains (Active Directory, intranet). Ensure DNS profiles deploy corporate servers or exclusions are pushed via GPO.')}
              </li>
            </ul>
          </div>
        </div>

      </div>
    </div>
  );
}

window.DohDotConfig = DohDotConfig;
