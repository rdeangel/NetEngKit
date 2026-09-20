const { useState, useEffect, useCallback, useMemo } = React;

// ── Vendor presets ──────────────────────────────────────────────────
const VENDOR_PRESETS = {
  cisco_ios: {
    label: 'Cisco IOS/IOS-XE',
    user: 'admin',
    port: 22,
    keepalive: true,
    keepaliveInterval: 60,
    keepaliveCountMax: 3,
    keyExchange: '+aes128-ctr,aes192-ctr,aes256-ctr',
  },
  cisco_nxos: {
    label: 'Cisco NX-OS',
    user: 'admin',
    port: 22,
    keepalive: true,
    keepaliveInterval: 60,
    keepaliveCountMax: 3,
    keyExchange: '+aes128-ctr,aes192-ctr,aes256-ctr',
  },
  juniper_junos: {
    label: 'Juniper Junos',
    user: 'root',
    port: 22,
    keepalive: true,
    keepaliveInterval: 60,
    keepaliveCountMax: 3,
    keyExchange: '',
  },
  arista_eos: {
    label: 'Arista EOS',
    user: 'admin',
    port: 22,
    keepalive: true,
    keepaliveInterval: 60,
    keepaliveCountMax: 3,
    keyExchange: '',
  },
  linux_generic: {
    label: 'Linux / Generic',
    user: 'root',
    port: 22,
    keepalive: false,
    keepaliveInterval: 60,
    keepaliveCountMax: 3,
    keyExchange: '',
  },
};

const KEY_TYPES = [
  { value: 'ed25519', label: 'Ed25519 (recommended)' },
  { value: 'rsa',     label: 'RSA 4096' },
  { value: 'ecdsa',   label: 'ECDSA 521' },
];

const PROVISION_VENDORS = Object.keys(VENDOR_PRESETS);

const DEFAULT_HOST = () => ({
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  alias: '',
  hostname: '',
  user: 'admin',
  port: 22,
  identityFile: '',
  proxyJump: '',
  localForward: '',
  remoteForward: '',
  keepalive: true,
  keepaliveInterval: 60,
  keepaliveCountMax: 3,
  strictHostKeyChecking: '',
  userKnownHostsFile: '',
  kexAlgorithms: '',
  ciphers: '',
  logLevel: '',
  additionalOptions: '',
  vendor: '',
});

// ── Helpers ─────────────────────────────────────────────────────────
function buildKeygenCmd(keyType, comment, filename) {
  const parts = ['ssh-keygen'];
  if (keyType === 'rsa') {
    parts.push('-t rsa', '-b 4096');
  } else if (keyType === 'ecdsa') {
    parts.push('-t ecdsa', '-b 521');
  } else {
    parts.push('-t ed25519');
  }
  if (comment.trim()) parts.push(`-C "${comment.trim()}"`);
  if (filename.trim()) parts.push(`-f ${filename.trim()}`);
  return parts.join(' ');
}

function chunkKey(keyStr, size) {
  const chunks = [];
  for (let i = 0; i < keyStr.length; i += size) {
    chunks.push(keyStr.slice(i, i + size));
  }
  return chunks;
}

function buildProvisionSnippet(vendor, pubKey, username) {
  const key = pubKey.trim() || '<paste contents of .pub file here>';
  const user = (username || 'admin').trim();

  if (vendor === 'cisco_ios') {
    const lines = pubKey.trim()
      ? chunkKey(pubKey.trim(), 254)
      : ['<paste .pub file contents — wrap at 254 chars per line>'];
    return (
`! Enable SSH (if not already done)
ip domain-name corp.local
ip ssh version 2
crypto key generate rsa modulus 4096

! Authorize public key for ${user}
ip ssh pubkey-chain
  username ${user}
    key-string
${lines.map(l => `      ${l}`).join('\n')}
    exit
  exit
exit`
    );
  }

  if (vendor === 'cisco_nxos') {
    return (
`! Enable SSH (if not already done)
feature ssh

! Authorize public key
username ${user} sshkey ${key}`
    );
  }

  if (vendor === 'juniper_junos') {
    return (
`# Authorize public key for ${user}
set system login user ${user} class super-user
set system login user ${user} authentication ssh-ed25519 "${key}"
commit`
    );
  }

  if (vendor === 'arista_eos') {
    return (
`! Authorize public key
username ${user} sshkey ${key}`
    );
  }

  if (vendor === 'linux_generic') {
    return (
`# Option 1 — ssh-copy-id (easiest)
ssh-copy-id -i ~/.ssh/id_ed25519.pub ${user}@<host>

# Option 2 — Manual
mkdir -p ~/.ssh && chmod 700 ~/.ssh
echo "${key}" >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys`
    );
  }

  return '';
}

// ── Config builder ──────────────────────────────────────────────────
function buildSSHConfig(hosts) {
  const lines = [];
  for (const h of hosts) {
    const block = [];
    const alias = h.alias.trim();
    const hostname = h.hostname.trim();
    if (!alias && !hostname) continue;

    block.push(`Host ${alias || hostname}`);

    if (hostname && alias) block.push(`    HostName ${hostname}`);
    if (h.user) block.push(`    User ${h.user}`);
    if (h.port && h.port !== 22) block.push(`    Port ${h.port}`);
    if (h.identityFile) block.push(`    IdentityFile ${h.identityFile}`);
    if (h.proxyJump) block.push(`    ProxyJump ${h.proxyJump}`);
    if (h.localForward) {
      for (const fwd of h.localForward.split(',').map(s => s.trim()).filter(Boolean)) {
        block.push(`    LocalForward ${fwd}`);
      }
    }
    if (h.remoteForward) {
      for (const fwd of h.remoteForward.split(',').map(s => s.trim()).filter(Boolean)) {
        block.push(`    RemoteForward ${fwd}`);
      }
    }
    if (h.keepalive) {
      block.push(`    ServerAliveInterval ${h.keepaliveInterval}`);
      block.push(`    ServerAliveCountMax ${h.keepaliveCountMax}`);
    }
    if (h.strictHostKeyChecking) block.push(`    StrictHostKeyChecking ${h.strictHostKeyChecking}`);
    if (h.userKnownHostsFile) block.push(`    UserKnownHostsFile ${h.userKnownHostsFile}`);
    if (h.kexAlgorithms) block.push(`    KexAlgorithms ${h.kexAlgorithms}`);
    if (h.ciphers) block.push(`    Ciphers ${h.ciphers}`);
    if (h.logLevel) block.push(`    LogLevel ${h.logLevel}`);
    if (h.additionalOptions) {
      for (const line of h.additionalOptions.split('\n').map(s => s.trim()).filter(Boolean)) {
        block.push(`    ${line}`);
      }
    }

    lines.push(block.join('\n'));
  }
  return lines.join('\n\n');
}

// ── Component ───────────────────────────────────────────────────────
function SSHConfigGen({ initialData, onShare }) {
  const { t } = useTranslation();
  const [copied, copy] = useCopy();

  const [hosts, setHosts] = usePersistentState('ssh-config:hosts', () => {
    if (initialData?.hosts?.length) return initialData.hosts;
    return [DEFAULT_HOST()];
  });
  const [globalHeader, setGlobalHeader] = usePersistentState('ssh-config:globalHeader', initialData?.globalHeader ?? '');

  // Keygen helper state
  const [keyType, setKeyType] = usePersistentState('ssh-config:keyType', initialData?.keyType ?? 'ed25519');
  const [keyComment, setKeyComment] = usePersistentState('ssh-config:keyComment', initialData?.keyComment ?? '');
  const [keyFilename, setKeyFilename] = usePersistentState('ssh-config:keyFilename', initialData?.keyFilename ?? '');

  // Device provisioning state
  const [provisionVendor, setProvisionVendor] = usePersistentState('ssh-config:provisionVendor', PROVISION_VENDORS[0]);
  const [provisionPubKey, setProvisionPubKey] = usePersistentState('ssh-config:provisionPubKey', '');
  const [provisionUser, setProvisionUser] = useState('admin');

  // ── Share URL ──
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'ssh-config', hosts, globalHeader, keyType, keyComment, keyFilename });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [hosts, globalHeader, keyType, keyComment, keyFilename, onShare]);

  // ── Host helpers ──
  const updateHost = useCallback((id, field, value) => {
    setHosts(prev => prev.map(h => h.id === id ? { ...h, [field]: value } : h));
  }, []);

  const applyVendor = useCallback((id, vendorKey) => {
    if (!vendorKey) return;
    const preset = VENDOR_PRESETS[vendorKey];
    if (!preset) return;
    setHosts(prev => prev.map(h =>
      h.id === id
        ? {
            ...h,
            user: preset.user,
            port: preset.port,
            keepalive: preset.keepalive,
            keepaliveInterval: preset.keepaliveInterval,
            keepaliveCountMax: preset.keepaliveCountMax,
            vendor: vendorKey,
            ...(preset.keyExchange ? { ciphers: preset.keyExchange } : {}),
          }
        : h
    ));
  }, []);

  const addHost = useCallback(() => {
    setHosts(prev => [...prev, DEFAULT_HOST()]);
  }, []);

  const removeHost = useCallback((id) => {
    setHosts(prev => prev.length <= 1 ? prev : prev.filter(h => h.id !== id));
  }, []);

  const duplicateHost = useCallback((id) => {
    setHosts(prev => {
      const idx = prev.findIndex(h => h.id === id);
      if (idx === -1) return prev;
      const src = { ...prev[idx], id: Math.random().toString(36).slice(2) };
      const next = [...prev];
      next.splice(idx + 1, 0, src);
      return next;
    });
  }, []);

  const moveHost = useCallback((id, dir) => {
    setHosts(prev => {
      const idx = prev.findIndex(h => h.id === id);
      if (idx === -1) return prev;
      const newIdx = idx + dir;
      if (newIdx < 0 || newIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[newIdx]] = [next[newIdx], next[idx]];
      return next;
    });
  }, []);

  // ── Generated config ──
  const config = useMemo(() => {
    const parts = [];
    const header = globalHeader.trim();
    if (header) parts.push(header.split('\n').map(l => `# ${l}`).join('\n'));
    const body = buildSSHConfig(hosts);
    if (body) parts.push(body);
    return parts.join('\n\n');
  }, [hosts, globalHeader]);

  const keygenCmd = useMemo(() => buildKeygenCmd(keyType, keyComment, keyFilename), [keyType, keyComment, keyFilename]);

  const provisionSnippet = useMemo(
    () => buildProvisionSnippet(provisionVendor, provisionPubKey, provisionUser),
    [provisionVendor, provisionPubKey, provisionUser]
  );

  const hasContent = config.trim().length > 0;

  // ── Export ──
  const handleExport = useCallback(() => {
    const blob = new Blob([config + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'ssh_config';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [config]);

  // ── Styles ──
  const mono = { fontFamily: 'var(--mono)', fontSize: 13 };
  const fieldGap = { display: 'flex', flexDirection: 'column', gap: 4 };

  return (
    <div className="fadein">

      {/* ── How to Use ── */}
      <details className="card" style={{ marginBottom: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, color: 'var(--accent)' }}>
          {t('ssh_config.how_to_use')}
        </summary>
        <div style={{ marginTop: 14 }}>
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
            {t('ssh_config.subtitle')}
          </p>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('ssh_config.step1_title')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('ssh_config.step1_body')}</div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('ssh_config.step2_title')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('ssh_config.step2_body')}</div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{t('ssh_config.step3_title')}</div>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{t('ssh_config.step3_body')}</div>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 4 }}>
            {t('ssh_config.how_to_use_note')}
          </div>
        </div>
      </details>

      {/* ── Keygen Helper ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">{t('ssh_config.keygen_title')}</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 12 }}>
          {t('ssh_config.keygen_subtitle')}
        </p>
        <div className="three-col" style={{ marginBottom: 10 }}>
          <div style={fieldGap}>
            <label className="label">{t('ssh_config.key_type')}</label>
            <select className="select" value={keyType} onChange={e => setKeyType(e.target.value)}>
              {KEY_TYPES.map(k => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </div>
          <div style={fieldGap}>
            <label className="label">{t('ssh_config.key_comment')}</label>
            <input className="input" style={mono} placeholder={t('ssh_config.key_comment_ph')}
              value={keyComment} onChange={e => setKeyComment(e.target.value)} />
          </div>
          <div style={fieldGap}>
            <label className="label">{t('ssh_config.key_filename')}</label>
            <input className="input" style={mono} placeholder={t('ssh_config.key_filename_ph')}
              value={keyFilename} onChange={e => setKeyFilename(e.target.value)} />
          </div>
        </div>
        <div style={fieldGap}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <label className="label" style={{ marginBottom: 0 }}>{t('ssh_config.keygen_command')}</label>
            <CopyBtn text={keygenCmd} label={t('common.copy')} id="keygen-cmd" />
          </div>
          <pre style={{
            ...mono, fontSize: 12, background: 'var(--bg)', padding: '10px 14px',
            borderRadius: 'var(--radius)', border: '1px solid var(--border)',
            color: 'var(--green)', overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          }}>{keygenCmd}</pre>
          <span className="hint">{t('ssh_config.keygen_hint')}</span>
        </div>
      </div>

      {/* ── Global header comment ── */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-title">{t('ssh_config.header_comment')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
          {t('ssh_config.header_comment_hint')}
        </div>
        <textarea
          className="input"
          style={{ ...mono, minHeight: 48, resize: 'vertical' }}
          placeholder={t('ssh_config.header_comment_ph')}
          value={globalHeader}
          onChange={e => setGlobalHeader(e.target.value)}
          rows={2}
        />
      </div>

      {/* ── Host entries ── */}
      {hosts.map((h, idx) => (
        <div key={h.id} className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {t('ssh_config.host_entry', { n: idx + 1 })}
            </div>
            <div style={{ display: 'flex', gap: 4 }}>
              {hosts.length > 1 && (
                <button className="btn btn-ghost btn-sm" onClick={() => moveHost(h.id, -1)}
                  title={t('ssh_config.move_up')} disabled={idx === 0}>&#9650;</button>
              )}
              {hosts.length > 1 && (
                <button className="btn btn-ghost btn-sm" onClick={() => moveHost(h.id, 1)}
                  title={t('ssh_config.move_down')} disabled={idx === hosts.length - 1}>&#9660;</button>
              )}
              <button className="btn btn-ghost btn-sm" onClick={() => duplicateHost(h.id)}
                title={t('ssh_config.duplicate')}>&#10697;</button>
              {hosts.length > 1 && (
                <button className="btn btn-ghost btn-sm" style={{ color: 'var(--error)' }}
                  onClick={() => removeHost(h.id)} title={t('ssh_config.remove')}>&#10005;</button>
              )}
            </div>
          </div>

          {/* Vendor preset */}
          <div style={{ marginBottom: 12 }}>
            <label className="label">{t('ssh_config.vendor_preset')}</label>
            <select className="select" value={h.vendor || ''} onChange={e => applyVendor(h.id, e.target.value)}>
              <option value="">{t('ssh_config.vendor_none')}</option>
              {Object.entries(VENDOR_PRESETS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </div>

          {/* Row 1: Alias + Hostname */}
          <div className="two-col" style={{ marginBottom: 8 }}>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.alias')}</label>
              <input className="input" style={mono} placeholder="core-rtr-01"
                value={h.alias} onChange={e => updateHost(h.id, 'alias', e.target.value)} />
            </div>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.hostname')}</label>
              <input className="input" style={mono} placeholder="10.0.0.1"
                value={h.hostname} onChange={e => updateHost(h.id, 'hostname', e.target.value)} />
            </div>
          </div>

          {/* Row 2: User + Port + IdentityFile */}
          <div className="three-col" style={{ marginBottom: 8 }}>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.user')}</label>
              <input className="input" style={mono} placeholder="admin"
                value={h.user} onChange={e => updateHost(h.id, 'user', e.target.value)} />
            </div>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.port')}</label>
              <input className="input" style={mono} type="number" min={1} max={65535}
                value={h.port} onChange={e => updateHost(h.id, 'port', parseInt(e.target.value) || 22)} />
            </div>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.identity_file')}</label>
              <input className="input" style={mono} placeholder="~/.ssh/id_ed25519"
                value={h.identityFile} onChange={e => updateHost(h.id, 'identityFile', e.target.value)} />
            </div>
          </div>

          {/* Row 3: ProxyJump + Tunnels */}
          <div className="two-col" style={{ marginBottom: 8 }}>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.proxy_jump')}</label>
              <input className="input" style={mono} placeholder="bastion-host"
                value={h.proxyJump} onChange={e => updateHost(h.id, 'proxyJump', e.target.value)} />
              <span className="hint">{t('ssh_config.proxy_jump_hint')}</span>
            </div>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.local_forward')}</label>
              <input className="input" style={mono} placeholder="8080 10.0.0.1:80"
                value={h.localForward} onChange={e => updateHost(h.id, 'localForward', e.target.value)} />
              <span className="hint">{t('ssh_config.forward_hint')}</span>
            </div>
          </div>

          <div className="two-col" style={{ marginBottom: 8 }}>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.remote_forward')}</label>
              <input className="input" style={mono} placeholder="9090 127.0.0.1:8080"
                value={h.remoteForward} onChange={e => updateHost(h.id, 'remoteForward', e.target.value)} />
              <span className="hint">{t('ssh_config.forward_hint')}</span>
            </div>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.kex_algorithms')}</label>
              <input className="input" style={mono} placeholder="+diffie-hellman-group14-sha256"
                value={h.kexAlgorithms} onChange={e => updateHost(h.id, 'kexAlgorithms', e.target.value)} />
            </div>
          </div>

          {/* Keepalive section */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 10, marginBottom: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 8 }}>
              <input type="checkbox" checked={h.keepalive}
                onChange={e => updateHost(h.id, 'keepalive', e.target.checked)} />
              <span className="label" style={{ marginBottom: 0 }}>{t('ssh_config.keepalive')}</span>
            </label>
            {h.keepalive && (
              <div className="two-col">
                <div style={fieldGap}>
                  <label className="label">{t('ssh_config.keepalive_interval')}</label>
                  <input className="input" style={mono} type="number" min={1}
                    value={h.keepaliveInterval} onChange={e => updateHost(h.id, 'keepaliveInterval', parseInt(e.target.value) || 60)} />
                </div>
                <div style={fieldGap}>
                  <label className="label">{t('ssh_config.keepalive_count_max')}</label>
                  <input className="input" style={mono} type="number" min={1}
                    value={h.keepaliveCountMax} onChange={e => updateHost(h.id, 'keepaliveCountMax', parseInt(e.target.value) || 3)} />
                </div>
              </div>
            )}
          </div>

          {/* Advanced options */}
          <details style={{ marginTop: 8 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: 13, marginBottom: 8 }}>
              {t('ssh_config.advanced')}
            </summary>
            <div className="two-col" style={{ marginBottom: 8 }}>
              <div style={fieldGap}>
                <label className="label">{t('ssh_config.strict_host_key')}</label>
                <select className="select" value={h.strictHostKeyChecking}
                  onChange={e => updateHost(h.id, 'strictHostKeyChecking', e.target.value)}>
                  <option value="">{t('ssh_config.default_inherit')}</option>
                  <option value="yes">yes</option>
                  <option value="no">no</option>
                  <option value="accept-new">accept-new</option>
                  <option value="ask">ask</option>
                </select>
              </div>
              <div style={fieldGap}>
                <label className="label">{t('ssh_config.known_hosts_file')}</label>
                <input className="input" style={mono} placeholder="~/.ssh/known_hosts"
                  value={h.userKnownHostsFile} onChange={e => updateHost(h.id, 'userKnownHostsFile', e.target.value)} />
              </div>
            </div>
            <div className="two-col" style={{ marginBottom: 8 }}>
              <div style={fieldGap}>
                <label className="label">{t('ssh_config.ciphers')}</label>
                <input className="input" style={mono} placeholder="+aes256-gcm@openssh.com"
                  value={h.ciphers} onChange={e => updateHost(h.id, 'ciphers', e.target.value)} />
              </div>
              <div style={fieldGap}>
                <label className="label">{t('ssh_config.log_level')}</label>
                <select className="select" value={h.logLevel}
                  onChange={e => updateHost(h.id, 'logLevel', e.target.value)}>
                  <option value="">{t('ssh_config.default_inherit')}</option>
                  <option value="QUIET">QUIET</option>
                  <option value="FATAL">FATAL</option>
                  <option value="ERROR">ERROR</option>
                  <option value="INFO">INFO</option>
                  <option value="VERBOSE">VERBOSE</option>
                  <option value="DEBUG">DEBUG</option>
                  <option value="DEBUG1">DEBUG1</option>
                  <option value="DEBUG2">DEBUG2</option>
                  <option value="DEBUG3">DEBUG3</option>
                </select>
              </div>
            </div>
            <div style={fieldGap}>
              <label className="label">{t('ssh_config.additional_options')}</label>
              <textarea className="input" style={{ ...mono, minHeight: 48, resize: 'vertical' }}
                placeholder={t('ssh_config.additional_options_ph')}
                value={h.additionalOptions} onChange={e => updateHost(h.id, 'additionalOptions', e.target.value)}
                rows={2} />
              <span className="hint">{t('ssh_config.additional_options_hint')}</span>
            </div>
          </details>
        </div>
      ))}

      {/* Add host button */}
      <div style={{ marginBottom: 16 }}>
        <button className="btn btn-ghost" onClick={addHost}>+ {t('ssh_config.add_host')}</button>
      </div>

      {/* Generated config output */}
      {hasContent && (
        <div className="card fadein" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>{t('ssh_config.output_title')}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <CopyBtn text={config} label={t('common.copy')} id="ssh-config-copy" />
              <button className="btn btn-ghost btn-sm" onClick={handleExport}>{t('ssh_config.export')}</button>
            </div>
          </div>
          <pre style={{
            ...mono, fontSize: 12, lineHeight: 1.6,
            background: 'var(--bg)', padding: 16, borderRadius: 'var(--radius)',
            overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
            color: 'var(--green)', border: '1px solid var(--border)',
          }}>{config}</pre>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
            {t('ssh_config.output_hint')}
          </p>
        </div>
      )}

      {/* ── Device Provisioning ── */}
      <div className="card">
        <div className="card-title">{t('ssh_config.provision_title')}</div>
        <p style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
          {t('ssh_config.provision_subtitle')}
        </p>

        {/* Inputs row */}
        <div className="two-col" style={{ marginBottom: 12 }}>
          <div style={fieldGap}>
            <label className="label">{t('ssh_config.provision_username')}</label>
            <input className="input" style={mono} placeholder="admin"
              value={provisionUser} onChange={e => setProvisionUser(e.target.value)} />
          </div>
          <div style={fieldGap}>
            <label className="label">{t('ssh_config.vendor_preset')}</label>
            <select className="select" value={provisionVendor} onChange={e => setProvisionVendor(e.target.value)}>
              {PROVISION_VENDORS.map(k => (
                <option key={k} value={k}>{VENDOR_PRESETS[k].label}</option>
              ))}
            </select>
          </div>
        </div>

        <div style={{ ...fieldGap, marginBottom: 12 }}>
          <label className="label">{t('ssh_config.provision_pubkey_label')}</label>
          <textarea className="input"
            style={{ ...mono, fontSize: 12, minHeight: 52, resize: 'vertical' }}
            placeholder={t('ssh_config.provision_pubkey_ph')}
            value={provisionPubKey}
            onChange={e => setProvisionPubKey(e.target.value)}
            rows={2}
          />
          <span className="hint">{t('ssh_config.provision_pubkey_hint')}</span>
        </div>

        {provisionVendor === 'cisco_ios' && (
          <div style={{
            fontSize: 12, color: 'var(--yellow, #e5c07b)',
            background: 'rgba(229,192,123,0.08)', border: '1px solid rgba(229,192,123,0.25)',
            borderRadius: 'var(--radius)', padding: '8px 12px', marginBottom: 10,
          }}>
            {t('ssh_config.provision_note_ios')}
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span className="label" style={{ marginBottom: 0 }}>{t('ssh_config.provision_snippet_label')}</span>
          <CopyBtn text={provisionSnippet} label={t('common.copy')} id="provision-snippet" />
        </div>
        <pre style={{
          ...mono, fontSize: 12, lineHeight: 1.6,
          background: 'var(--bg)', padding: 16, borderRadius: 'var(--radius)',
          overflowX: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
          color: 'var(--green)', border: '1px solid var(--border)',
        }}>{provisionSnippet}</pre>
      </div>

      {/* ── Quick Reference ── */}
      <details className="card" style={{ marginTop: 16 }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: 14, color: 'var(--accent)' }}>
          {t('ssh_config.ref_title')}
        </summary>
        <p style={{ fontSize: 13, color: 'var(--muted)', margin: '10px 0 16px' }}>
          {t('ssh_config.ref_subtitle')}
        </p>

        <RefSection
          title={t('ssh_config.ref_s2s_title')}
          desc={t('ssh_config.ref_s2s_desc')}
          mono={mono}
          snippets={[
            {
              label: t('ssh_config.ref_cmd_label'),
              id: 'ref-s2s-cmd',
              code:
`# On the source server — generate a key
ssh-keygen -t ed25519 -C "server-a"

# Deploy public key to the destination server
ssh-copy-id -i ~/.ssh/id_ed25519.pub user@server-b

# Connect
ssh user@server-b`,
            },
            {
              label: t('ssh_config.ref_config_label'),
              id: 'ref-s2s-cfg',
              code:
`Host server-b
    HostName 10.0.0.2
    User user
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60`,
            },
          ]}
        />

        <RefSection
          title={t('ssh_config.ref_local_fwd_title')}
          desc={t('ssh_config.ref_local_fwd_desc')}
          mono={mono}
          snippets={[
            {
              label: t('ssh_config.ref_cmd_label'),
              id: 'ref-lfwd-cmd',
              code:
`# ssh -L [localPort]:[targetHost]:[targetPort] [jumpHost]
ssh -L 8080:internal-server:80 bastion

# Access the tunnelled service locally
# http://localhost:8080  →  internal-server:80 (via bastion)

# Keep tunnel open without a shell (-N) in background (-f)
ssh -fN -L 8080:internal-server:80 bastion`,
            },
            {
              label: t('ssh_config.ref_config_label'),
              id: 'ref-lfwd-cfg',
              code:
`Host internal-web
    HostName bastion
    User admin
    IdentityFile ~/.ssh/id_ed25519
    LocalForward 8080 internal-server:80

# Then: ssh -N internal-web`,
            },
          ]}
        />

        <RefSection
          title={t('ssh_config.ref_remote_fwd_title')}
          desc={t('ssh_config.ref_remote_fwd_desc')}
          mono={mono}
          snippets={[
            {
              label: t('ssh_config.ref_cmd_label'),
              id: 'ref-rfwd-cmd',
              code:
`# ssh -R [remotePort]:[localHost]:[localPort] [remoteServer]
ssh -R 9090:localhost:3000 public-server

# Anyone on public-server:9090 is forwarded to localhost:3000
# Requires GatewayPorts yes on the remote sshd_config
# for access from outside the remote server itself`,
            },
            {
              label: t('ssh_config.ref_config_label'),
              id: 'ref-rfwd-cfg',
              code:
`Host expose-local
    HostName public-server
    User deploy
    IdentityFile ~/.ssh/id_ed25519
    RemoteForward 9090 localhost:3000

# Then: ssh -N expose-local`,
            },
          ]}
        />

        <RefSection
          title={t('ssh_config.ref_socks_title')}
          desc={t('ssh_config.ref_socks_desc')}
          mono={mono}
          last
          snippets={[
            {
              label: t('ssh_config.ref_cmd_label'),
              id: 'ref-socks-cmd',
              code:
`# Open a SOCKS5 proxy on localhost:1080 via remote-server
ssh -D 1080 -N remote-server

# Point browser or app at SOCKS5 proxy: localhost:1080
# All traffic is tunnelled through remote-server`,
            },
            {
              label: t('ssh_config.ref_config_label'),
              id: 'ref-socks-cfg',
              code:
`Host socks-proxy
    HostName remote-server
    User admin
    IdentityFile ~/.ssh/id_ed25519
    DynamicForward 1080

# Then: ssh -N socks-proxy`,
            },
          ]}
        />
      </details>
    </div>
  );
}

function RefSection({ title, desc, snippets, mono, last }) {
  const [copied, copy] = useCopy();
  const preStyle = {
    fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6,
    background: 'var(--bg)', padding: '10px 14px', borderRadius: 'var(--radius)',
    overflowX: 'auto', whiteSpace: 'pre', color: 'var(--green)',
    border: '1px solid var(--border)', marginTop: 6,
  };
  return (
    <div style={{ marginBottom: last ? 0 : 20, paddingBottom: last ? 0 : 20, borderBottom: last ? 'none' : '1px solid var(--border)' }}>
      <div style={{ fontWeight: 600, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>{desc}</div>
      {snippets.map(s => (
        <div key={s.id} style={{ marginBottom: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 11, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</span>
            <CopyBtn text={s.code} label="" id={s.id} />
          </div>
          <pre style={preStyle}>{s.code}</pre>
        </div>
      ))}
    </div>
  );
}

window.SSHConfigGen = SSHConfigGen;
