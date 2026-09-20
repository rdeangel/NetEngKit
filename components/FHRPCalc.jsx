const { useState, useEffect, useCallback, useMemo } = React;

const FHRP_PROTOCOLS = [
  { id: 'hsrp_v1', key: 'fhrp_calc.hsrp_v1', macBase: '0000.0C07.AC', groupMin: 0, groupMax: 255, rfc: <span><RFCLink rfc="RFC 2281" /> / Cisco</span> },
  { id: 'hsrp_v2', key: 'fhrp_calc.hsrp_v2', macBase: '0000.0C9F.F', groupMin: 0, groupMax: 4095, rfc: <span><RFCLink rfc="RFC 2281" /> (extended) / Cisco</span> },
  { id: 'vrrp',    key: 'fhrp_calc.vrrp',    macBase: '0000.5E00.01', groupMin: 1, groupMax: 255, rfc: <RFCLink rfc="RFC 5798" /> },
  { id: 'glbp',    key: 'fhrp_calc.glbp',    macBase: '0007.B400',    groupMin: 0, groupMax: 1023, rfc: 'Cisco Proprietary' },
];

function fhrpPadHex(n, len) {
  return n.toString(16).toUpperCase().padStart(len, '0');
}

function computeMac(protocolId, groupId) {
  const gid = parseInt(groupId) || 0;
  switch (protocolId) {
    case 'hsrp_v1': {
      // 0000.0C07.ACXX where XX = group hex (2 chars)
      const hex = fhrpPadHex(gid, 2);
      return { mac: `0000.0C07.AC${hex}`, format: `00:00:0C:07:AC:${hex}`, cisco: `0000.0C07.AC${hex}` };
    }
    case 'hsrp_v2': {
      // 0000.0C9F.FXXX where XXX = group hex (3 chars, left-padded with F nibble)
      const hex = fhrpPadHex(gid, 3);
      return { mac: `0000.0C9F.F${hex}`, format: `00:00:0C:9F:F${hex.slice(0,1)}:${hex.slice(1)}`, cisco: `0000.0C9F.F${hex}` };
    }
    case 'vrrp': {
      // 0000.5E00.01XX where XX = VRID hex (2 chars)
      const hex = fhrpPadHex(gid, 2);
      return { mac: `0000.5E00.01${hex}`, format: `00:00:5E:00:01:${hex}`, cisco: `0000.5E00.01${hex}` };
    }
    case 'glbp': {
      // AVG: 0007.B4HH.LL00 where HH=high byte of group, LL=low byte, supports groups 0-1023
      const highByte = fhrpPadHex(gid >> 8, 2);
      const lowByte = fhrpPadHex(gid & 0xFF, 2);
      return {
        mac: `0007.B4${highByte}.${lowByte}00`,
        format: `00:07:B4:${highByte}:${lowByte}:00`,
        cisco: `0007.B4${highByte}.${lowByte}00`,
        forwarders: [1, 2, 3, 4].map(f => ({
          number: f,
          mac: `0007.B4${highByte}.${lowByte}${fhrpPadHex(f, 2)}`,
          cisco: `0007.B4${highByte}.${lowByte}${fhrpPadHex(f, 2)}`,
        })),
      };
    }
    default:
      return { mac: '', format: '', cisco: '' };
  }
}

function generateConfig(protocolId, groupId, vip, priority, preempt, preemptDelay, trackIface, trackDecrement) {
  const lines = [];
  const g = groupId || '1';
  const protoLabel = protocolId.replace('_', ' ').toUpperCase();
  lines.push(`! ${protoLabel} Configuration`);
  lines.push(`interface <interface-name>`);
  switch (protocolId) {
    case 'hsrp_v1':
    case 'hsrp_v2':
      lines.push(` ip address ${vip || '<local-ip>'} <subnet-mask>`);
      if (vip) lines.push(` standby ${g} ip ${vip}`);
      else lines.push(` standby ${g} ip <virtual-ip>`);
      if (priority !== undefined && priority !== 100) lines.push(` standby ${g} priority ${priority}`);
      if (preempt) {
        if (preemptDelay > 0) lines.push(` standby ${g} preempt delay minimum ${preemptDelay}`);
        else lines.push(` standby ${g} preempt`);
      }
      if (trackIface) lines.push(` standby ${g} track ${trackIface} ${trackDecrement || 10}`);
      if (protocolId === 'hsrp_v2') lines.push(` standby ${g} version 2`);
      break;
    case 'vrrp':
      lines.push(` ip address ${vip || '<local-ip>'} <subnet-mask>`);
      if (vip) lines.push(` vrrp ${g} ip ${vip}`);
      else lines.push(` vrrp ${g} ip <virtual-ip>`);
      if (priority !== undefined && priority !== 100) lines.push(` vrrp ${g} priority ${priority}`);
      if (preempt) {
        if (preemptDelay > 0) lines.push(` vrrp ${g} preempt delay minimum ${preemptDelay}`);
        else lines.push(` vrrp ${g} preempt`);
      }
      if (trackIface) lines.push(` vrrp ${g} track ${trackIface} decrement ${trackDecrement || 10}`);
      break;
    case 'glbp':
      lines.push(` ip address ${vip || '<local-ip>'} <subnet-mask>`);
      if (vip) lines.push(` glbp ${g} ip ${vip}`);
      else lines.push(` glbp ${g} ip <virtual-ip>`);
      if (priority !== undefined && priority !== 100) lines.push(` glbp ${g} priority ${priority}`);
      if (preempt) {
        if (preemptDelay > 0) lines.push(` glbp ${g} preempt delay minimum ${preemptDelay}`);
        else lines.push(` glbp ${g} preempt`);
      }
      lines.push(` glbp ${g} forwarder preempt`);
      if (trackIface) lines.push(` glbp ${g} track ${trackIface} decrement ${trackDecrement || 10}`);
      break;
  }
  return lines.join('\n');
}

function simulateElection(routers, protocolId) {
  if (!routers.length) return [];

  // Sort: highest priority first, ties broken by highest IP address
  const sorted = [...routers].sort((a, b) => {
    const pa = parseInt(a.priority) || 100;
    const pb = parseInt(b.priority) || 100;
    if (pb !== pa) return pb - pa;
    // Tie-break by IP comparison (higher IP wins, numeric)
    const ipToNum = ip => ip.split('.').reduce((acc, oct) => (acc * 256) + (parseInt(oct, 10) || 0), 0);
    return ipToNum(b.ip || '0.0.0.0') - ipToNum(a.ip || '0.0.0.0');
  });

  return sorted.map((r, i) => {
    let role;
    if (protocolId === 'glbp') {
      if (i === 0) role = 'avg';
      else if (i === 1) role = 'standby';
      else role = 'listen';
    } else {
      if (i === 0) role = 'active';
      else if (i === 1) role = 'standby';
      else role = 'listen';
    }
    return { ...r, role };
  });
}

function FHRPCalc({ initialData, onShare }) {
  const { t } = useTranslation();
  const [protocol, setProtocol]         = usePersistentState('fhrp:protocol', initialData?.protocol ?? 'hsrp_v2');
  const [groupId, setGroupId]           = usePersistentState('fhrp:groupId', initialData?.groupId ?? '1');
  const [virtualIp, setVirtualIp]       = usePersistentState('fhrp:virtualIp', initialData?.virtualIp ?? '');
  const [priority, setPriority]         = usePersistentState('fhrp:priority', initialData?.priority ?? '100');
  const [preempt, setPreempt]           = usePersistentState('fhrp:preempt', initialData?.preempt ?? true);
  const [preemptDelay, setPreemptDelay] = usePersistentState('fhrp:preemptDelay', initialData?.preemptDelay ?? '0');
  const [trackIface, setTrackIface]     = usePersistentState('fhrp:trackIface', initialData?.trackIface ?? '');
  const [trackDecrement, setTrackDecrement] = usePersistentState('fhrp:trackDecrement', initialData?.trackDecrement ?? '10');
  const [routers, setRouters]           = usePersistentState('fhrp:routers', initialData?.routers ?? []);
  const [routerName, setRouterName]     = useState('');
  const [routerIp, setRouterIp]         = useState('');
  const [routerPriority, setRouterPriority] = useState('100');
  const [routerPreempt, setRouterPreempt] = useState(true);
  const [errors, setErrors]             = useState({});

  // Restore from initialData
  useEffect(() => {
    if (initialData) {
      if (initialData.protocol !== undefined) setProtocol(initialData.protocol);
      if (initialData.groupId !== undefined) setGroupId(initialData.groupId);
      if (initialData.virtualIp !== undefined) setVirtualIp(initialData.virtualIp);
      if (initialData.priority !== undefined) setPriority(initialData.priority);
      if (initialData.preempt !== undefined) setPreempt(initialData.preempt);
      if (initialData.preemptDelay !== undefined) setPreemptDelay(initialData.preemptDelay);
      if (initialData.trackIface !== undefined) setTrackIface(initialData.trackIface);
      if (initialData.trackDecrement !== undefined) setTrackDecrement(initialData.trackDecrement);
      if (initialData.routers !== undefined) setRouters(initialData.routers);
    }
  }, [initialData]);

  // Share URL wiring
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'fhrp-calc',
        protocol, groupId, virtualIp, priority, preempt, preemptDelay,
        trackIface, trackDecrement, routers,
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [protocol, groupId, virtualIp, priority, preempt, preemptDelay, trackIface, trackDecrement, routers, onShare]);

  const protoInfo = useMemo(() => FHRP_PROTOCOLS.find(p => p.id === protocol) || FHRP_PROTOCOLS[0], [protocol]);

  // Validate group ID range
  const groupIdNum = parseInt(groupId) || 0;
  const groupValid = groupIdNum >= protoInfo.groupMin && groupIdNum <= protoInfo.groupMax;

  // Computed MAC
  const macResult = useMemo(() => {
    if (!groupValid) return null;
    return computeMac(protocol, groupIdNum);
  }, [protocol, groupIdNum, groupValid]);

  // Election results
  const electionResults = useMemo(() => simulateElection(routers, protocol), [routers, protocol]);

  // Config snippet
  const configSnippet = useMemo(() => {
    return generateConfig(protocol, groupIdNum, virtualIp, parseInt(priority) || 100, preempt, parseInt(preemptDelay) || 0, trackIface, parseInt(trackDecrement) || 10);
  }, [protocol, groupIdNum, virtualIp, priority, preempt, preemptDelay, trackIface, trackDecrement]);

  const copyHook = useCopy();

  const addRouter = () => {
    if (!routerName.trim() || !routerIp.trim()) return;
    setRouters(prev => [...prev, {
      id: crypto.randomUUID(),
      name: routerName.trim(),
      ip: routerIp.trim(),
      priority: parseInt(routerPriority) || 100,
      preempt: routerPreempt,
    }]);
    setRouterName('');
    setRouterIp('');
    setRouterPriority('100');
    setRouterPreempt(true);
  };

  const removeRouter = (id) => {
    setRouters(prev => prev.filter(r => r.id !== id));
  };

  const resetAll = () => {
    setProtocol('hsrp_v2');
    setGroupId('1');
    setVirtualIp('');
    setPriority('100');
    setPreempt(true);
    setPreemptDelay('0');
    setTrackIface('');
    setTrackDecrement('10');
    setRouters([]);
    setErrors({});
  };

  const roleBadge = (role) => {
    switch (role) {
      case 'active':
      case 'avg':
        return { cls: 'badge badge-green', label: role === 'avg' ? t('fhrp_calc.role_avg') : t('fhrp_calc.role_active') };
      case 'standby':
        return { cls: 'badge badge-cyan', label: t('fhrp_calc.role_standby') };
      case 'listen':
        return { cls: 'badge badge-yellow', label: t('fhrp_calc.role_listen') };
      case 'backup':
        return { cls: 'badge badge-yellow', label: t('fhrp_calc.role_backup') };
      default:
        return { cls: 'badge', label: role };
    }
  };

  const protocolNotes = useMemo(() => {
    switch (protocol) {
      case 'hsrp_v1':
        return t('fhrp_calc.notes_hsrp_v1', 'HSRP v1 uses multicast 224.0.0.2 (UDP port 1985). Group range 0-255. Default hello 3s, hold 10s.');
      case 'hsrp_v2':
        return t('fhrp_calc.notes_hsrp_v2', 'HSRP v2 uses multicast 224.0.0.102 (UDP port 1985). Group range 0-4095. Default hello 3s, hold 10s. Improved hello packet format with longer group ID.');
      case 'vrrp':
        return t('fhrp_calc.notes_vrrp', 'VRRP uses multicast 224.0.0.18 (IP protocol 112). VRID range 0-255. Default advertisement interval 1s. Master/Backup terminology per RFC 5798.');
      case 'glbp':
        return t('fhrp_calc.notes_glbp', 'GLBP uses multicast 224.0.0.102 (UDP port 3222). Group range 0-1023. Provides load balancing via up to 4 AVG forwarders. Cisco-proprietary.');
      default:
        return '';
    }
  }, [protocol, t]);

  return (
    <div className="fadein">
      {/* Protocol Selector */}
      <div className="card">
        <div className="card-title">{t('fhrp_calc.title', 'FHRP Calculator')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
          {t('fhrp_calc.subtitle', 'First Hop Redundancy Protocol calculator for HSRP, VRRP, and GLBP. Compute virtual MACs, simulate elections, and generate device configurations.')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
          {FHRP_PROTOCOLS.map(p => (
            <button
              key={p.id}
              className={`btn btn-sm ${protocol === p.id ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => {
                setProtocol(p.id);
                setGroupId('1');
              }}
            >
              {t(p.key)}
            </button>
          ))}
        </div>

        {/* Configuration Parameters */}
        <div className="two-col grid-mobile-1" style={{ gap: 16 }}>
          <div className="field">
            <label className="label">{t('fhrp_calc.group_id', 'Group ID')}</label>
            <input
              className="input"
              style={{ fontFamily: 'var(--mono)' }}
              type="number"
              min="0"
              max={protoInfo.groupMax}
              value={groupId}
              onChange={e => setGroupId(e.target.value)}
              placeholder="1"
            />
            <div className="hint">
              {t('fhrp_calc.group_range_hint', 'Range')}: {protoInfo.groupMin} - {protoInfo.groupMax}
            </div>
            {!groupValid && groupId !== '' && (
              <Err msg={t('fhrp_calc.err_group_range', 'Group ID out of range for selected protocol')} />
            )}
          </div>

          <div className="field">
            <label className="label">{t('fhrp_calc.virtual_ip', 'Virtual IP')}</label>
            <input
              className="input"
              style={{ fontFamily: 'var(--mono)' }}
              type="text"
              value={virtualIp}
              onChange={e => setVirtualIp(e.target.value)}
              placeholder="10.0.0.1"
            />
          </div>

          <div className="field">
            <label className="label">{t('fhrp_calc.priority', 'Priority')}</label>
            <input
              className="input"
              style={{ fontFamily: 'var(--mono)' }}
              type="number"
              min="0"
              max="255"
              value={priority}
              onChange={e => setPriority(e.target.value)}
              placeholder="100"
            />
            <div className="hint">{t('fhrp_calc.priority_hint', '0-255, default 100. Higher wins.')}</div>
          </div>

          <div className="field">
            <label className="label">{t('fhrp_calc.preempt', 'Preempt')}</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <button
                className={`btn btn-sm ${preempt ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setPreempt(true)}
              >
                {t('common.yes')}
              </button>
              <button
                className={`btn btn-sm ${!preempt ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setPreempt(false)}
              >
                {t('common.no')}
              </button>
            </div>
          </div>

          <div className="field">
            <label className="label">{t('fhrp_calc.preempt_delay', 'Preempt Delay (s)')}</label>
            <input
              className="input"
              style={{ fontFamily: 'var(--mono)' }}
              type="number"
              min="0"
              max="3600"
              value={preemptDelay}
              onChange={e => setPreemptDelay(e.target.value)}
              placeholder="0"
            />
            <div className="hint">{t('fhrp_calc.preempt_delay_hint', '0-3600 seconds. 0 = immediate.')}</div>
          </div>

          <div className="field">
            <label className="label">{t('fhrp_calc.track_interface', 'Track Interface')}</label>
            <input
              className="input"
              type="text"
              value={trackIface}
              onChange={e => setTrackIface(e.target.value)}
              placeholder="GigabitEthernet0/0"
            />
          </div>

          <div className="field">
            <label className="label">{t('fhrp_calc.track_decrement', 'Track Decrement')}</label>
            <input
              className="input"
              style={{ fontFamily: 'var(--mono)' }}
              type="number"
              min="1"
              max="255"
              value={trackDecrement}
              onChange={e => setTrackDecrement(e.target.value)}
              placeholder="10"
            />
          </div>
        </div>

        <div className="btn-row" style={{ marginTop: 16 }}>
          <button className="btn btn-ghost btn-sm" onClick={resetAll}>{t('common.reset')}</button>
        </div>
      </div>

      {/* Virtual MAC Results */}
      {macResult && (
        <div className="card fadein">
          <div className="card-title">{t('fhrp_calc.virtual_mac', 'Virtual MAC Address')}</div>
          <div className="result-grid grid-mobile-1">
            <ResultItem
              label={t('fhrp_calc.mac_cisco', 'Cisco Format')}
              value={macResult.cisco}
              accent
            />
            <ResultItem
              label={t('fhrp_calc.mac_format', 'IEEE 802 Format')}
              value={macResult.format}
            />
            <ResultItem
              label={t('fhrp_calc.protocol_label', 'Protocol')}
              value={t(protoInfo.key)}
            />
            <ResultItem
              label={t('fhrp_calc.rfc_ref', 'Reference')}
              value={protoInfo.rfc}
            />
          </div>

          {/* GLBP Forwarder MACs */}
          {macResult.forwarders && (
            <div style={{ marginTop: 16 }}>
              <div className="label" style={{ marginBottom: 8 }}>
                {t('fhrp_calc.forwarder_macs', 'Forwarder Virtual MACs')}
              </div>
              <div className="result-grid grid-mobile-1">
                {macResult.forwarders.map(fw => (
                  <ResultItem
                    key={fw.number}
                    label={`${t('fhrp_calc.forwarder', 'Forwarder')} ${fw.number}`}
                    value={fw.cisco}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Protocol Notes */}
          <div style={{ marginTop: 16, padding: 12, background: 'var(--panel)', borderLeft: '4px solid var(--cyan)', borderRadius: 4, fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text)' }}>{t('fhrp_calc.protocol_notes', 'Protocol Notes')}</strong>
            <div style={{ marginTop: 4 }}>{protocolNotes}</div>
          </div>
        </div>
      )}

      {/* Election Simulation */}
      <div className="card">
        <div className="card-title">{t('fhrp_calc.election_sim', 'Election Simulation')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>
          {t('fhrp_calc.election_desc', 'Add routers to simulate the FHRP election. Highest priority wins (ties broken by highest IP). If preempt is disabled, the first router up stays active.')}
        </div>

        {/* Add Router Form */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 100px auto auto', gap: 8, alignItems: 'end', marginBottom: 12 }}
          className="grid-mobile-1">
          <div className="field">
            <label className="label">{t('fhrp_calc.router_name', 'Router Name')}</label>
            <input
              className="input"
              type="text"
              value={routerName}
              onChange={e => setRouterName(e.target.value)}
              placeholder="R1"
            />
          </div>
          <div className="field">
            <label className="label">{t('fhrp_calc.router_ip', 'IP Address')}</label>
            <input
              className="input"
              style={{ fontFamily: 'var(--mono)' }}
              type="text"
              value={routerIp}
              onChange={e => setRouterIp(e.target.value)}
              placeholder="10.0.0.2"
            />
          </div>
          <div className="field">
            <label className="label">{t('fhrp_calc.priority', 'Priority')}</label>
            <input
              className="input"
              style={{ fontFamily: 'var(--mono)' }}
              type="number"
              min="0"
              max="255"
              value={routerPriority}
              onChange={e => setRouterPriority(e.target.value)}
              placeholder="100"
            />
          </div>
          <div className="field">
            <label className="label">{t('fhrp_calc.preempt', 'Preempt')}</label>
            <button
              className={`btn btn-sm ${routerPreempt ? 'btn-primary' : 'btn-ghost'}`}
              style={{ minWidth: 56 }}
              onClick={() => setRouterPreempt(!routerPreempt)}
            >
              {routerPreempt ? t('common.yes') : t('common.no')}
            </button>
          </div>
          <div className="field">
            <button className="btn btn-primary btn-sm" onClick={addRouter} style={{ height: 36 }}>
              {t('fhrp_calc.add_router', 'Add')}
            </button>
          </div>
        </div>

        {/* Router List */}
        {routers.length > 0 ? (
          <div style={{ marginTop: 8 }}>
            <div className="table-wrap hide-mobile">
              <table>
                <thead>
                  <tr>
                    <th>{t('fhrp_calc.router_name', 'Router Name')}</th>
                    <th>{t('fhrp_calc.router_ip', 'IP Address')}</th>
                    <th>{t('fhrp_calc.priority', 'Priority')}</th>
                    <th>{t('fhrp_calc.preempt', 'Preempt')}</th>
                    <th>{t('fhrp_calc.role', 'Role')}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {electionResults.map(r => {
                    const badge = roleBadge(r.role);
                    return (
                      <tr key={r.id}>
                        <td style={{ fontFamily: 'var(--mono)', fontWeight: 600 }}>{r.name}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{r.ip}</td>
                        <td style={{ fontFamily: 'var(--mono)' }}>{r.priority}</td>
                        <td>{r.preempt ? t('common.yes') : t('common.no')}</td>
                        <td><span className={badge.cls}>{badge.label}</span></td>
                        <td>
                          <button className="btn btn-ghost btn-sm" onClick={() => removeRouter(r.id)} style={{ color: 'var(--red)', padding: '2px 8px' }}>
                            x
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {/* Mobile View */}
            <div className="show-mobile mobile-cards">
              {electionResults.map(r => {
                const badge = roleBadge(r.role);
                return (
                  <div key={r.id} className="mobile-card">
                    <div className="mobile-card-row">
                      <span className="mobile-card-label" style={{ fontWeight: 600 }}>{r.name}</span>
                      <span className={badge.cls}>{badge.label}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('fhrp_calc.router_ip', 'IP')}</span>
                      <span className="mobile-card-value" style={{ fontFamily: 'var(--mono)' }}>{r.ip}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('fhrp_calc.priority', 'Priority')}</span>
                      <span className="mobile-card-value">{r.priority}</span>
                    </div>
                    <div className="mobile-card-row">
                      <span className="mobile-card-label">{t('fhrp_calc.preempt', 'Preempt')}</span>
                      <span className="mobile-card-value">{r.preempt ? t('common.yes') : t('common.no')}</span>
                    </div>
                    <button className="btn btn-ghost btn-sm" onClick={() => removeRouter(r.id)} style={{ color: 'var(--red)', marginTop: 4, width: '100%' }}>
                      {t('common.remove', 'Remove')}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <div style={{ padding: 20, textAlign: 'center', color: 'var(--muted)', fontSize: 13, background: 'var(--panel)', borderRadius: 'var(--radius)' }}>
            {t('fhrp_calc.no_routers', 'No routers added. Use the form above to add routers for election simulation.')}
          </div>
        )}

        {routers.length > 0 && (
          <div className="btn-row" style={{ marginTop: 12 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setRouters([])}>
              {t('common.clear')}
            </button>
          </div>
        )}
      </div>

      {/* Generated Configuration */}
      <div className="card">
        <div className="card-title">{t('fhrp_calc.generated_config', 'Generated Configuration')}</div>
        <div style={{ position: 'relative' }}>
          <pre style={{
            fontFamily: 'var(--mono)',
            fontSize: 12,
            lineHeight: 1.7,
            background: 'var(--bg)',
            padding: 16,
            borderRadius: 'var(--radius)',
            border: '1px solid var(--border)',
            overflowX: 'auto',
            whiteSpace: 'pre',
            margin: 0,
          }}>
            <code>{configSnippet}</code>
          </pre>
          <CopyBtn text={configSnippet} label="fhrp_calc.copy_config" id="fhrp-config-copy" />
        </div>
      </div>
    </div>
  );
}
window.FHRPCalc = FHRPCalc;
