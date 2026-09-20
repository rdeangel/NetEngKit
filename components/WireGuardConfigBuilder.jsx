function WireGuardConfigBuilder({ initialData, onShare, onNav }) {
  const { t } = useTranslation();
  const skipNavReport = useRef(false);
  const [mode, setMode] = usePersistentState('wireguard:mode', initialData?.mode ?? 's2s');

  // Key Pair Generator Helper
  const generateWgKeyPair = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let privateKey = '';
    let publicKey = '';
    
    // Simulate base64 key generation (32 bytes -> 44 chars with '=')
    try {
      const arr = new Uint8Array(32);
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(arr);
      } else {
        for (let i = 0; i < 32; i++) arr[i] = Math.floor(Math.random() * 256);
      }
      
      // Convert to Base64
      let bin = '';
      for (let i = 0; i < arr.length; i++) {
        bin += String.fromCharCode(arr[i]);
      }
      privateKey = btoa(bin);
      
      // For public key, generate another unique key just for visual distinction
      const arr2 = new Uint8Array(32);
      if (window.crypto && window.crypto.getRandomValues) {
        window.crypto.getRandomValues(arr2);
      } else {
        for (let i = 0; i < 32; i++) arr2[i] = Math.floor(Math.random() * 256);
      }
      let bin2 = '';
      for (let i = 0; i < arr2.length; i++) {
        bin2 += String.fromCharCode(arr2[i]);
      }
      publicKey = btoa(bin2);
    } catch (e) {
      // Fallback
      privateKey = "PRIV_KEY_SIMULATED_" + Math.random().toString(36).slice(2) + "=====";
      publicKey = "PUB_KEY_SIMULATED_" + Math.random().toString(36).slice(2) + "=====";
    }
    
    return { privateKey, publicKey };
  };

  // Site-to-Site configuration state
  const [peerAPrivateKey, setPeerAPrivateKey] = usePersistentState('wireguard:peerAPrivateKey', initialData?.peerAPrivateKey ?? '');
  const [peerAPublicKey, setPeerAPublicKey] = usePersistentState('wireguard:peerAPublicKey', initialData?.peerAPublicKey ?? '');
  const [peerATunnelIp, setPeerATunnelIp] = usePersistentState('wireguard:peerATunnelIp', initialData?.peerATunnelIp ?? '10.0.0.1/30');
  const [peerAEndpoint, setPeerAEndpoint] = usePersistentState('wireguard:peerAEndpoint', initialData?.peerAEndpoint ?? '198.51.100.1:51820');
  const [peerAListenPort, setPeerAListenPort] = usePersistentState('wireguard:peerAListenPort', initialData?.peerAListenPort ?? '51820');
  const [peerAAllowedIps, setPeerAAllowedIps] = usePersistentState('wireguard:peerAAllowedIps', initialData?.peerAAllowedIps ?? '192.168.1.0/24');

  const [peerBPrivateKey, setPeerBPrivateKey] = usePersistentState('wireguard:peerBPrivateKey', initialData?.peerBPrivateKey ?? '');
  const [peerBPublicKey, setPeerBPublicKey] = usePersistentState('wireguard:peerBPublicKey', initialData?.peerBPublicKey ?? '');
  const [peerBTunnelIp, setPeerBTunnelIp] = usePersistentState('wireguard:peerBTunnelIp', initialData?.peerBTunnelIp ?? '10.0.0.2/30');
  const [peerBEndpoint, setPeerBEndpoint] = usePersistentState('wireguard:peerBEndpoint', initialData?.peerBEndpoint ?? '203.0.113.1:51820');
  const [peerBListenPort, setPeerBListenPort] = usePersistentState('wireguard:peerBListenPort', initialData?.peerBListenPort ?? '51820');
  const [peerBAllowedIps, setPeerBAllowedIps] = usePersistentState('wireguard:peerBAllowedIps', initialData?.peerBAllowedIps ?? '192.168.2.0/24');

  const [persistentKeepalive, setPersistentKeepalive] = usePersistentState('wireguard:persistentKeepalive', initialData?.persistentKeepalive ?? '25');

  // Hub and Spoke Configuration State
  const [hubPrivateKey, setHubPrivateKey] = usePersistentState('wireguard:hubPrivateKey', initialData?.hubPrivateKey ?? '');
  const [hubPublicKey, setHubPublicKey] = usePersistentState('wireguard:hubPublicKey', initialData?.hubPublicKey ?? '');
  const [hubTunnelIp, setHubTunnelIp] = usePersistentState('wireguard:hubTunnelIp', initialData?.hubTunnelIp ?? '10.8.0.1/24');
  const [hubListenPort, setHubListenPort] = usePersistentState('wireguard:hubListenPort', initialData?.hubListenPort ?? '51820');
  const [hubEndpoint, setHubEndpoint] = usePersistentState('wireguard:hubEndpoint', initialData?.hubEndpoint ?? '198.51.100.1:51820');

  const DEFAULT_SPOKE = () => ({
    id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
    name: 'Spoke-' + Math.floor(Math.random() * 100),
    tunnelIp: '10.8.0.2/32',
    privateKey: '',
    publicKey: '',
    allowedIps: '10.8.0.2/32, 192.168.10.0/24'
  });
  
  const [spokes, setSpokes] = usePersistentState('wireguard:spokes', () => {
    if (initialData?.spokes?.length) return initialData.spokes;
    return [DEFAULT_SPOKE()];
  });

  const addSpoke = () => {
    const keys = generateWgKeyPair();
    const newSpoke = DEFAULT_SPOKE();
    newSpoke.privateKey = keys.privateKey;
    newSpoke.publicKey = keys.publicKey;
    // Assign next available IP address
    const count = spokes.length + 2;
    newSpoke.tunnelIp = `10.8.0.${count}/32`;
    newSpoke.allowedIps = `10.8.0.${count}/32`;
    setSpokes(prev => [...prev, newSpoke]);
  };

  const removeSpoke = (id) => setSpokes(prev => prev.length <= 1 ? prev : prev.filter(s => s.id !== id));
  
  const updateSpoke = (id, field, val) => {
    setSpokes(prev => prev.map(s => s.id === id ? { ...s, [field]: val } : s));
  };

  // MTU & Tunnel Overhead State
  const [outerProto, setOuterProto] = usePersistentState('wireguard:outerProto', initialData?.outerProto ?? 'ipv4');
  const [wanMtu, setWanMtu] = usePersistentState('wireguard:wanMtu', initialData?.wanMtu ?? '1500');

  // Trigger keys generation on load if blank
  useEffect(() => {
    if (!peerAPrivateKey || !peerAPublicKey) {
      const keysA = generateWgKeyPair();
      setPeerAPrivateKey(keysA.privateKey);
      setPeerAPublicKey(keysA.publicKey);
    }
    if (!peerBPrivateKey || !peerBPublicKey) {
      const keysB = generateWgKeyPair();
      setPeerBPrivateKey(keysB.privateKey);
      setPeerBPublicKey(keysB.publicKey);
    }
    if (!hubPrivateKey || !hubPublicKey) {
      const keysHub = generateWgKeyPair();
      setHubPrivateKey(keysHub.privateKey);
      setHubPublicKey(keysHub.publicKey);
    }
    // Generate spoke keys if empty
    setSpokes(prev => prev.map(s => {
      if (!s.privateKey || !s.publicKey) {
        const k = generateWgKeyPair();
        return { ...s, privateKey: k.privateKey, publicKey: k.publicKey };
      }
      return s;
    }));
  }, []);

  const regenerateAllKeys = () => {
    const keysA = generateWgKeyPair();
    setPeerAPrivateKey(keysA.privateKey);
    setPeerAPublicKey(keysA.publicKey);

    const keysB = generateWgKeyPair();
    setPeerBPrivateKey(keysB.privateKey);
    setPeerBPublicKey(keysB.publicKey);

    const keysHub = generateWgKeyPair();
    setHubPrivateKey(keysHub.privateKey);
    setHubPublicKey(keysHub.publicKey);

    setSpokes(prev => prev.map(s => {
      const k = generateWgKeyPair();
      return { ...s, privateKey: k.privateKey, publicKey: k.publicKey };
    }));
  };

  // apply-down: sidebar/Ctrl+K/Help nav → inner mode
  useEffect(() => {
    if (!initialData?.mode || initialData.mode === mode) return;
    skipNavReport.current = true;
    setMode(initialData.mode);
  }, [initialData]);

  // report-up: mode change → sidebar highlight
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ mode });
  }, [mode]);

  // Share URL synchronization
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'wireguard-cfg',
        mode,
        peerAPrivateKey,
        peerAPublicKey,
        peerATunnelIp,
        peerAEndpoint,
        peerAListenPort,
        peerAAllowedIps,
        peerBPrivateKey,
        peerBPublicKey,
        peerBTunnelIp,
        peerBEndpoint,
        peerBListenPort,
        peerBAllowedIps,
        persistentKeepalive,
        hubPrivateKey,
        hubPublicKey,
        hubTunnelIp,
        hubListenPort,
        hubEndpoint,
        spokes,
        outerProto,
        wanMtu
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [
    mode,
    peerAPrivateKey,
    peerAPublicKey,
    peerATunnelIp,
    peerAEndpoint,
    peerAListenPort,
    peerAAllowedIps,
    peerBPrivateKey,
    peerBPublicKey,
    peerBTunnelIp,
    peerBEndpoint,
    peerBListenPort,
    peerBAllowedIps,
    persistentKeepalive,
    hubPrivateKey,
    hubPublicKey,
    hubTunnelIp,
    hubListenPort,
    hubEndpoint,
    spokes,
    outerProto,
    wanMtu,
    onShare
  ]);

  // MTU calculations
  // Overhead: Outer IP (20 for IPv4, 40 for IPv6) + UDP (8) + WG header (32) + Auth tag (16)
  // Total overhead: IPv4 = 60 bytes, IPv6 = 80 bytes
  const calculatedOverhead = outerProto === 'ipv4' ? 60 : 80;
  const recommendedMtu = Math.max(576, (parseInt(wanMtu) || 1500) - calculatedOverhead);

  // wg-quick Configuration Outputs (Site-to-Site)
  const wgQuickPeerA = useMemo(() => {
    const remotePublicKey = peerBPublicKey || '<PeerB_Public_Key>';
    const remoteEndpoint = peerBEndpoint || '203.0.113.1:51820';
    return `[Interface]
PrivateKey = ${peerAPrivateKey || '<PeerA_Private_Key>'}
Address = ${peerATunnelIp}
ListenPort = ${peerAListenPort}
MTU = ${recommendedMtu}

[Peer]
PublicKey = ${remotePublicKey}
Endpoint = ${remoteEndpoint}
AllowedIPs = ${peerAAllowedIps}
PersistentKeepalive = ${persistentKeepalive}`;
  }, [peerAPrivateKey, peerATunnelIp, peerAListenPort, peerBPublicKey, peerBEndpoint, peerAAllowedIps, persistentKeepalive, recommendedMtu]);

  const wgQuickPeerB = useMemo(() => {
    const remotePublicKey = peerAPublicKey || '<PeerA_Public_Key>';
    const remoteEndpoint = peerAEndpoint || '198.51.100.1:51820';
    return `[Interface]
PrivateKey = ${peerBPrivateKey || '<PeerB_Private_Key>'}
Address = ${peerBTunnelIp}
ListenPort = ${peerBListenPort}
MTU = ${recommendedMtu}

[Peer]
PublicKey = ${remotePublicKey}
Endpoint = ${remoteEndpoint}
AllowedIPs = ${peerBAllowedIps}
PersistentKeepalive = ${persistentKeepalive}`;
  }, [peerBPrivateKey, peerBTunnelIp, peerBListenPort, peerAPublicKey, peerAEndpoint, peerBAllowedIps, persistentKeepalive, recommendedMtu]);

  // systemd-networkd Configuration Outputs (Peer A)
  const systemdPeerA = useMemo(() => {
    const remotePublicKey = peerBPublicKey || '<PeerB_Public_Key>';
    const remoteEndpoint = peerBEndpoint || '203.0.113.1:51820';
    return `# /etc/systemd/network/wg0.netdev
[NetDev]
Name = wg0
Kind = wireguard
Description = WireGuard Tunnel

[WireGuard]
PrivateKey = ${peerAPrivateKey || '<PeerA_Private_Key>'}
ListenPort = ${peerAListenPort}

[WireGuardPeer]
PublicKey = ${remotePublicKey}
Endpoint = ${remoteEndpoint}
AllowedIPs = ${peerAAllowedIps}
PersistentKeepalive = ${persistentKeepalive}

# /etc/systemd/network/wg0.network
[Match]
Name = wg0

[Network]
Address = ${peerATunnelIp}
LinkLocalAddressing = no`;
  }, [peerAPrivateKey, peerATunnelIp, peerAListenPort, peerBPublicKey, peerBEndpoint, peerAAllowedIps, persistentKeepalive]);

  // Hub-Spoke Outputs
  const wgQuickHub = useMemo(() => {
    let out = `[Interface]
PrivateKey = ${hubPrivateKey || '<Hub_Private_Key>'}
Address = ${hubTunnelIp}
ListenPort = ${hubListenPort}
MTU = ${recommendedMtu}
`;
    spokes.forEach(s => {
      out += `\n# Spoke: ${s.name}
[Peer]
PublicKey = ${s.publicKey || '<Spoke_Public_Key>'}
AllowedIPs = ${s.allowedIps}
`;
    });
    return out;
  }, [hubPrivateKey, hubTunnelIp, hubListenPort, spokes, recommendedMtu]);

  const spokeConfigs = useMemo(() => {
    return spokes.map(s => {
      const config = `[Interface]
PrivateKey = ${s.privateKey || '<Spoke_Private_Key>'}
Address = ${s.tunnelIp}
MTU = ${recommendedMtu}

[Peer]
PublicKey = ${hubPublicKey || '<Hub_Public_Key>'}
Endpoint = ${hubEndpoint}
AllowedIPs = 0.0.0.0/0
PersistentKeepalive = ${persistentKeepalive}`;
      return { id: s.id, name: s.name, config };
    });
  }, [hubPublicKey, hubEndpoint, spokes, persistentKeepalive, recommendedMtu]);

  const [activeSpokeIdx, setActiveSpokeIdx] = useState(0);

  const [copiedA, copyA] = useCopy();
  const [copiedB, copyB] = useCopy();

  const handleExportText = (content, filename) => {
    const blob = new Blob([content + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fadein">
      <div className="card">
        <h2 className="card-title">{t('wireguard_config.title')}</h2>
        <p className="hint">{t('wireguard_config.subtitle')}</p>

        {/* Mode Selector */}
        <div className="btn-row" style={{ marginBottom: '1.5rem', borderBottom: '1px solid var(--border)', paddingBottom: '0.75rem' }}>
          <button className={`btn ${mode === 's2s' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('s2s')}>
            {t('wireguard_config.tab_s2s')}
          </button>
          <button className={`btn ${mode === 'hub_spoke' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('hub_spoke')}>
            {t('wireguard_config.tab_hub_spoke')}
          </button>
          <button className={`btn ${mode === 'comparison' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('comparison')}>
            {t('wireguard_config.tab_comparison')}
          </button>
        </div>

        {/* Regenerate Keys Shortcut */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '1rem' }}>
          <button className="btn btn-sm btn-ghost" onClick={regenerateAllKeys}>
            🔄 {t('wireguard_config.generate_keys')}
          </button>
        </div>

        {mode === 's2s' && (
          <div>
            <div className="two-col">
              {/* Peer A Form */}
              <div className="card" style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)' }}>
                <h3>{t('wireguard_config.peer_a')}</h3>
                <div className="field">
                  <label className="label">{t('wireguard_config.private_key')}</label>
                  <input className="input" type="text" value={peerAPrivateKey} onChange={e => setPeerAPrivateKey(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">{t('wireguard_config.public_key')}</label>
                  <input className="input" type="text" value={peerAPublicKey} onChange={e => setPeerAPublicKey(e.target.value)} />
                </div>
                <div className="two-col" style={{ gap: '0.5rem' }}>
                  <div className="field">
                    <label className="label">{t('wireguard_config.tunnel_ips')}</label>
                    <input className="input" type="text" value={peerATunnelIp} onChange={e => setPeerATunnelIp(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('wireguard_config.listen_port')}</label>
                    <input className="input" type="number" value={peerAListenPort} onChange={e => setPeerAListenPort(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label className="label">{t('wireguard_config.external_endpoint')}</label>
                  <input className="input" type="text" value={peerAEndpoint} onChange={e => setPeerAEndpoint(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">{t('wireguard_config.allowed_ips')}</label>
                  <input className="input" type="text" value={peerAAllowedIps} onChange={e => setPeerAAllowedIps(e.target.value)} />
                </div>
              </div>

              {/* Peer B Form */}
              <div className="card" style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)' }}>
                <h3>{t('wireguard_config.peer_b')}</h3>
                <div className="field">
                  <label className="label">{t('wireguard_config.private_key')}</label>
                  <input className="input" type="text" value={peerBPrivateKey} onChange={e => setPeerBPrivateKey(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">{t('wireguard_config.public_key')}</label>
                  <input className="input" type="text" value={peerBPublicKey} onChange={e => setPeerBPublicKey(e.target.value)} />
                </div>
                <div className="two-col" style={{ gap: '0.5rem' }}>
                  <div className="field">
                    <label className="label">{t('wireguard_config.tunnel_ips')}</label>
                    <input className="input" type="text" value={peerBTunnelIp} onChange={e => setPeerBTunnelIp(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('wireguard_config.listen_port')}</label>
                    <input className="input" type="number" value={peerBListenPort} onChange={e => setPeerBListenPort(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label className="label">{t('wireguard_config.external_endpoint')}</label>
                  <input className="input" type="text" value={peerBEndpoint} onChange={e => setPeerBEndpoint(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">{t('wireguard_config.allowed_ips')}</label>
                  <input className="input" type="text" value={peerBAllowedIps} onChange={e => setPeerBAllowedIps(e.target.value)} />
                </div>
              </div>
            </div>

            {/* MTU Overhead Calculator Widget */}
            <div className="card" style={{ marginTop: '1.5rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
              <h3>{t('wireguard_config.mtu_calculator')}</h3>
              <div className="three-col" style={{ gap: '1rem', alignItems: 'center' }}>
                <div className="field">
                  <label className="label">{t('wireguard_config.outer_ip_proto')}</label>
                  <select className="select" value={outerProto} onChange={e => setOuterProto(e.target.value)}>
                    <option value="ipv4">IPv4 Outer Transport</option>
                    <option value="ipv6">IPv6 Outer Transport</option>
                  </select>
                </div>
                <div className="field">
                  <label className="label">{t('wireguard_config.wan_mtu')}</label>
                  <input className="input" type="number" value={wanMtu} onChange={e => setWanMtu(e.target.value)} />
                </div>
                <div>
                  <div className="result-grid" style={{ gridTemplateColumns: '1fr 1fr', gap: '0.5rem' }}>
                    <div style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}>
                      <div className="result-label">{t('wireguard_config.calculated_overhead')}</div>
                      <div className="result-value yellow">{calculatedOverhead} Bytes</div>
                    </div>
                    <div style={{ padding: '0.5rem', border: '1px solid var(--border)', borderRadius: '4px' }}>
                      <div className="result-label">{t('wireguard_config.recommended_mtu')}</div>
                      <div className="result-value green">{recommendedMtu} Bytes</div>
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ marginTop: '1rem', fontSize: '0.85rem', color: 'var(--text-hint)' }}>
                {t('wireguard_config.wg_overhead_desc', { overhead: calculatedOverhead })}
              </div>
            </div>

            {/* Configurations Output */}
            <div className="two-col" style={{ marginTop: '1.5rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h4>{t('wireguard_config.wg_quick_conf')} (Peer A)</h4>
                  <div className="btn-row">
                    <button className="btn btn-sm btn-ghost" onClick={() => handleExportText(wgQuickPeerA, 'wg0-peer-a.conf')}>Export</button>
                    <button className={`btn btn-sm ${copiedA ? 'btn-primary' : 'btn-ghost'}`} onClick={() => copyA(wgQuickPeerA)}>
                      {copiedA ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <pre style={{
                  fontFamily: 'var(--typography-mono)',
                  fontSize: '0.85rem',
                  background: 'rgba(0,0,0,0.3)',
                  padding: '1rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--spacing-radius)',
                  minHeight: '220px',
                  color: '#8be9fd'
                }}>
                  {wgQuickPeerA}
                </pre>
              </div>

              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h4>{t('wireguard_config.wg_quick_conf')} (Peer B)</h4>
                  <div className="btn-row">
                    <button className="btn btn-sm btn-ghost" onClick={() => handleExportText(wgQuickPeerB, 'wg0-peer-b.conf')}>Export</button>
                    <button className={`btn btn-sm ${copiedB ? 'btn-primary' : 'btn-ghost'}`} onClick={() => copyB(wgQuickPeerB)}>
                      {copiedB ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <pre style={{
                  fontFamily: 'var(--typography-mono)',
                  fontSize: '0.85rem',
                  background: 'rgba(0,0,0,0.3)',
                  padding: '1rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--spacing-radius)',
                  minHeight: '220px',
                  color: '#50fa7b'
                }}>
                  {wgQuickPeerB}
                </pre>
              </div>
            </div>

            {/* systemd-networkd Example */}
            <div style={{ marginTop: '1.5rem' }}>
              <h4>{t('wireguard_config.systemd_networkd')} (Peer A)</h4>
              <pre style={{
                fontFamily: 'var(--typography-mono)',
                fontSize: '0.85rem',
                background: 'rgba(0,0,0,0.3)',
                padding: '1rem',
                border: '1px solid var(--border)',
                borderRadius: 'var(--spacing-radius)',
                color: '#f8f8f2'
              }}>
                {systemdPeerA}
              </pre>
            </div>
          </div>
        )}

        {mode === 'hub_spoke' && (
          <div>
            <p className="hint" style={{ marginBottom: '1.25rem', padding: '0.5rem', borderLeft: '3px solid var(--primary)', background: 'rgba(255,255,255,0.02)' }}>
              {t('wireguard_config.hub_spoke_hint')}
            </p>
            <div className="two-col">
              {/* Hub Settings */}
              <div className="card" style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)' }}>
                <h3>{t('wireguard_config.hub_settings')}</h3>
                <div className="field">
                  <label className="label">Hub Private Key</label>
                  <input className="input" type="text" value={hubPrivateKey} onChange={e => setHubPrivateKey(e.target.value)} />
                </div>
                <div className="field">
                  <label className="label">Hub Public Key</label>
                  <input className="input" type="text" value={hubPublicKey} onChange={e => setHubPublicKey(e.target.value)} />
                </div>
                <div className="two-col" style={{ gap: '0.5rem' }}>
                  <div className="field">
                    <label className="label">Hub Tunnel IP/CIDR</label>
                    <input className="input" type="text" value={hubTunnelIp} onChange={e => setHubTunnelIp(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">Hub Listen Port</label>
                    <input className="input" type="number" value={hubListenPort} onChange={e => setHubListenPort(e.target.value)} />
                  </div>
                </div>
                <div className="field">
                  <label className="label">Hub Public Endpoint</label>
                  <input className="input" type="text" value={hubEndpoint} onChange={e => setHubEndpoint(e.target.value)} />
                </div>
              </div>

              {/* Spoke Settings */}
              <div className="card" style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
                  <h3>{t('wireguard_config.spoke_settings')}</h3>
                  <button className="btn btn-sm btn-ghost" onClick={addSpoke}>+ {t('wireguard_config.add_spoke')}</button>
                </div>

                {spokes.map((s, idx) => (
                  <div key={s.id} className="card" style={{ padding: '0.75rem', marginBottom: '0.75rem', position: 'relative' }}>
                    {spokes.length > 1 && (
                      <button className="btn btn-sm btn-danger" style={{ position: 'absolute', top: '0.5rem', right: '0.5rem', padding: '0.1rem 0.4rem' }} onClick={() => removeSpoke(s.id)}>×</button>
                    )}
                    <div className="two-col" style={{ gap: '0.5rem' }}>
                      <div className="field">
                        <label className="label">{t('wireguard_config.spoke_name')}</label>
                        <input className="input" type="text" value={s.name} onChange={e => updateSpoke(s.id, 'name', e.target.value)} />
                      </div>
                      <div className="field">
                        <label className="label">Spoke Tunnel IP</label>
                        <input className="input" type="text" value={s.tunnelIp} onChange={e => updateSpoke(s.id, 'tunnelIp', e.target.value)} />
                      </div>
                    </div>
                    <div className="field">
                      <label className="label">Spoke Public Key</label>
                      <input className="input" type="text" value={s.publicKey} onChange={e => updateSpoke(s.id, 'publicKey', e.target.value)} />
                    </div>
                    <div className="field">
                      <label className="label">Spoke Allowed IPs</label>
                      <input className="input" type="text" value={s.allowedIps} onChange={e => updateSpoke(s.id, 'allowedIps', e.target.value)} />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Generated Configurations */}
            <div className="two-col" style={{ marginTop: '1.5rem' }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h4>Hub wg-quick Config</h4>
                  <div className="btn-row">
                    <button className="btn btn-sm btn-ghost" onClick={() => handleExportText(wgQuickHub, 'wg-hub.conf')}>Export</button>
                    <button className={`btn btn-sm ${copiedA ? 'btn-primary' : 'btn-ghost'}`} onClick={() => copyA(wgQuickHub)}>
                      {copiedA ? '✓ Copied' : 'Copy'}
                    </button>
                  </div>
                </div>
                <pre style={{
                  fontFamily: 'var(--typography-mono)',
                  fontSize: '0.85rem',
                  background: 'rgba(0,0,0,0.3)',
                  padding: '1rem',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--spacing-radius)',
                  minHeight: '300px',
                  color: '#8be9fd',
                  maxHeight: '600px',
                  overflowY: 'auto'
                }}>
                  {wgQuickHub}
                </pre>
              </div>

              <div>
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.5rem', overflowX: 'auto', paddingBottom: '0.25rem' }}>
                  {spokeConfigs.map((cfg, idx) => (
                    <button
                      key={cfg.id}
                      className={`btn btn-sm ${activeSpokeIdx === idx ? 'btn-primary' : 'btn-ghost'}`}
                      onClick={() => setActiveSpokeIdx(idx)}
                    >
                      {cfg.name}
                    </button>
                  ))}
                </div>
                {spokeConfigs[activeSpokeIdx] && (
                  <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <h4>Spoke Config: {spokeConfigs[activeSpokeIdx].name}</h4>
                      <div className="btn-row">
                        <button className="btn btn-sm btn-ghost" onClick={() => handleExportText(spokeConfigs[activeSpokeIdx].config, `wg-${spokeConfigs[activeSpokeIdx].name}.conf`)}>Export</button>
                        <button className={`btn btn-sm ${copiedB ? 'btn-primary' : 'btn-ghost'}`} onClick={() => copyB(spokeConfigs[activeSpokeIdx].config)}>
                          {copiedB ? '✓ Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                    <pre style={{
                      fontFamily: 'var(--typography-mono)',
                      fontSize: '0.85rem',
                      background: 'rgba(0,0,0,0.3)',
                      padding: '1rem',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--spacing-radius)',
                      minHeight: '260px',
                      color: '#50fa7b'
                    }}>
                      {spokeConfigs[activeSpokeIdx].config}
                    </pre>
                  </div>
                )}
            </div>
          </div>

            {/* Quick Deployment Guide */}
            <div className="card" style={{ marginTop: '2rem', background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
              <h3 style={{ margin: '0 0 1rem 0' }}>{t('wireguard_config.deployment_guide')}</h3>
              <div className="two-col" style={{ gap: '1.5rem' }}>
                <div>
                  <h4 style={{ color: 'var(--primary)', margin: '0 0 0.75rem 0' }}>{t('wireguard_config.hub_setup_title')}</h4>
                  <ol style={{ paddingLeft: '1.25rem', margin: 0, fontSize: '0.9rem', lineHeight: '1.6' }}>
                    <li style={{ marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: t('wireguard_config.hub_step_1') }}></li>
                    <li style={{ marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: t('wireguard_config.hub_step_2') }}></li>
                    <li style={{ marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: t('wireguard_config.hub_step_3') }}></li>
                    <li style={{ marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: t('wireguard_config.hub_step_4') }}></li>
                    <li style={{ marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: t('wireguard_config.hub_step_5') }}></li>
                  </ol>
                </div>
                <div>
                  <h4 style={{ color: 'var(--tertiary)', margin: '0 0 0.75rem 0' }}>{t('wireguard_config.spoke_setup_title')}</h4>
                  <ol style={{ paddingLeft: '1.25rem', margin: 0, fontSize: '0.9rem', lineHeight: '1.6' }}>
                    <li style={{ marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: t('wireguard_config.spoke_step_1') }}></li>
                    <li style={{ marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: t('wireguard_config.spoke_step_2') }}></li>
                    <li style={{ marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: t('wireguard_config.spoke_step_3') }}></li>
                    <li style={{ marginBottom: '0.5rem' }} dangerouslySetInnerHTML={{ __html: t('wireguard_config.spoke_step_4') }}></li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        )}

        {mode === 'comparison' && (
          <div>
            <h3>{t('wireguard_config.comparison_title')}</h3>
            <div style={{ overflowX: 'auto', marginTop: '1rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '0.75rem', width: '25%' }}>{t('wireguard_config.ipsec_aspect')}</th>
                    <th style={{ padding: '0.75rem', width: '37.5%', color: 'var(--primary)' }}>{t('wireguard_config.ipsec_wg')}</th>
                    <th style={{ padding: '0.75rem', width: '37.5%', color: 'var(--tertiary)' }}>{t('wireguard_config.ipsec_ipsec')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{t('wireguard_config.metric_perf')}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Outperforms IPsec in throughput and latency. Uses state-of-the-art crypto designed to run faster inside linux kernels.</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Can match WireGuard speeds with AES-GCM hardware acceleration (AES-NI), but typically consumes more CPU overhead.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{t('wireguard_config.metric_complexity')}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Extremely small code base (~4,000 lines of code). Easy to audit for security vulnerabilities.</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Extremely complex codebase (hundreds of thousands of lines). Difficult to audit; higher attack surface.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{t('wireguard_config.metric_handshake')}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Sub-millisecond handshake. Instant-on capability; acts like a stateless link.</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Multi-step IKEv2 negotiation. Handshake takes significantly longer, particularly over high-latency connections.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{t('wireguard_config.metric_crypto')}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Cryptographic opinionated (Noise framework, Curve25519, ChaCha20, Poly1305). No cipher negotiation (prevents downgrade attacks).</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Highly agile. Supports legacy algorithms (3DES, MD5, SHA-1) up to modern algorithms. Prone to configuration mismatch and downgrade vulnerability.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{t('wireguard_config.metric_roaming')}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Built-in support. Endpoint automatically updates when client IP changes (e.g. switching WiFi to cellular).</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Requires MOBIKE extensions for IKEv2. Often drops connections during IP roaming events.</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '0.75rem', fontWeight: 'bold' }}>{t('wireguard_config.metric_setup')}</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Simple configuration file exchange of public keys. Standardized interface style.</td>
                    <td style={{ padding: '0.75rem', color: 'var(--text-hint)' }}>Complex parameter negotiation (Phases 1 & 2 proposals, lifetimes, IDs, local/remote subnets). Highly error-prone.</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

window.WireGuardConfigBuilder = WireGuardConfigBuilder;
