const { useState, useEffect, useCallback, useMemo } = React;

function SPANConfigBuilder({ initialData, onShare }) {
  const { t } = useTranslation();

  // Platforms Config Tabs
  const [activePlatform, setActivePlatform] = usePersistentState('span:active_platform', 'cisco_ios');

  // Input states
  const [sessionId, setSessionId] = usePersistentState('span:session_id', '1');
  const [sessionType, setSessionType] = usePersistentState('span:session_type', 'span');
  const [sourceType, setSourceType] = usePersistentState('span:source_type', 'interface');
  const [sourceVal, setSourceVal] = usePersistentState('span:source_val', initialData?.sourceVal ?? 'gigabitEthernet 1/0/1 - 4');
  const [direction, setDirection] = usePersistentState('span:direction', 'both');
  
  // Destinations depending on Type
  const [destination, setDestination] = usePersistentState('span:destination', initialData?.destination ?? 'gigabitEthernet 1/0/10');
  const [rspanVlan, setRspanVlan] = usePersistentState('span:rspan_vlan', '999');
  
  // ERSPAN parameters
  const [erspanSrcIp, setErspanSrcIp] = usePersistentState('span:erspan_src_ip', '10.1.1.1');
  const [erspanDstIp, setErspanDstIp] = usePersistentState('span:erspan_dst_ip', '10.99.99.1');
  const [erspanId, setErspanId] = usePersistentState('span:erspan_id', '10');
  const [erspanVni, setErspanVni] = usePersistentState('span:erspan_vni', '100');

  // Checkboxes
  const [optReplicate, setOptReplicate] = usePersistentState('span:opt_replicate', false);
  const [optIngress, setOptIngress] = usePersistentState('span:opt_ingress', false);

  const [error, setError] = useState('');

  // Wire Share System
  useEffect(() => {
    const handleShareReq = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'span-builder',
        sourceVal,
        destination,
        sessionType,
        direction
      });
    };
    window.addEventListener('app:request-share', handleShareReq);
    return () => window.removeEventListener('app:request-share', handleShareReq);
  }, [sourceVal, destination, sessionType, direction, onShare]);

  const validateInputs = () => {
    setError('');
    if (!sourceVal.trim()) {
      setError(t('span_builder.err_invalid_interfaces'));
      return false;
    }
    if (sessionType === 'span' && !destination.trim()) {
      setError(t('span_builder.err_invalid_dest'));
      return false;
    }
    if (sessionType === 'erspan') {
      if (IPv4.parse(erspanSrcIp) === null || IPv4.parse(erspanDstIp) === null) {
        setError(t('span_builder.err_invalid_ip'));
        return false;
      }
    }
    return true;
  };

  const generatedConfigText = useMemo(() => {
    if (!validateInputs()) return '';

    const sess = sessionId || '1';
    const dir = direction === 'both' ? 'both' : (direction === 'rx' ? 'rx' : 'tx');

    if (activePlatform === 'cisco_ios') {
      if (sessionType === 'span') {
        const repl = optReplicate ? ' encapsulation replicate' : '';
        const ing = optIngress ? ' ingress vlan default' : '';
        return [
          `! Cisco IOS / XE Local SPAN Configuration`,
          `no monitor session ${sess}`,
          `monitor session ${sess} source ${sourceType} ${sourceVal} ${dir}`,
          `monitor session ${sess} destination interface ${destination}${repl}${ing}`
        ].join('\n');
      }

      if (sessionType === 'rspan') {
        return [
          `! Cisco RSPAN Configuration`,
          `! ${t('span_builder.step_vlan_create')}`,
          `vlan ${rspanVlan}`,
          ` name RSPAN_VLAN`,
          ` remote-span`,
          `!`,
          `! ${t('span_builder.step_session_config')}`,
          `no monitor session ${sess}`,
          `monitor session ${sess} source ${sourceType} ${sourceVal} ${dir}`,
          `monitor session ${sess} destination remote vlan ${rspanVlan}`
        ].join('\n');
      }

      if (sessionType === 'erspan') {
        return [
          `! Cisco ERSPAN Source Switch Configuration`,
          `monitor session ${sess} type erspan-source`,
          ` source ${sourceType} ${sourceVal} ${dir}`,
          ` destination`,
          `  erspan-id ${erspanId}`,
          `  ip address ${erspanDstIp}`,
          `  origin ip address ${erspanSrcIp}`
        ].join('\n');
      }
    }

    if (activePlatform === 'cisco_nxos') {
      if (sessionType === 'span') {
        return [
          `! Cisco NX-OS Local SPAN Configuration`,
          `monitor session ${sess}`,
          `  source ${sourceType} ${sourceVal} ${dir}`,
          `  destination interface ${destination}`,
          `  no shut`
        ].join('\n');
      }

      if (sessionType === 'rspan') {
        return [
          `! Cisco NX-OS RSPAN Configuration`,
          `vlan ${rspanVlan}`,
          `  mode-span`,
          `!`,
          `monitor session ${sess}`,
          `  source ${sourceType} ${sourceVal} ${dir}`,
          `  destination remote vlan ${rspanVlan}`,
          `  no shut`
        ].join('\n');
      }

      if (sessionType === 'erspan') {
        return [
          `! Cisco NX-OS ERSPAN Source Configuration`,
          `monitor session ${sess} type erspan-source`,
          `  source ${sourceType} ${sourceVal} ${dir}`,
          `  destination ip ${erspanDstIp}`,
          `  erspan-id ${erspanId}`,
          `  vrf default`,
          `  no shut`
        ].join('\n');
      }
    }

    if (activePlatform === 'ers_arista') {
      if (sessionType === 'span') {
        return [
          `# Arista EOS Local SPAN Configuration`,
          `monitor session ${sess} source ${sourceVal} ${dir}`,
          `monitor session ${sess} destination ${destination}`
        ].join('\n');
      }

      if (sessionType === 'rspan') {
        return [
          `# Arista EOS RSPAN Configuration`,
          `vlan ${rspanVlan}`,
          `  state active`,
          `!`,
          `monitor session ${sess} source ${sourceVal} ${dir}`,
          `monitor session ${sess} destination vlan ${rspanVlan}`
        ].join('\n');
      }

      if (sessionType === 'erspan') {
        return [
          `# Arista EOS ERSPAN Gre Tunnel Configuration`,
          `monitor session ${sess} source ${sourceVal} ${dir}`,
          `monitor session ${sess} destination tunnel gre IP ${erspanDstIp}`
        ].join('\n');
      }
    }

    if (activePlatform === 'juniper') {
      const srcInt = sourceVal.includes('.') ? sourceVal : `${sourceVal}.0`;
      const dstInt = destination.includes('.') ? destination : `${destination}.0`;
      
      if (sessionType === 'span') {
        return [
          `# Juniper Junos Port Mirroring (Analyzer) Configuration`,
          `set forwarding-options analyzer session${sess} input ingress interface ${srcInt}`,
          `set forwarding-options analyzer session${sess} output interface ${dstInt}`
        ].join('\n');
      }

      if (sessionType === 'rspan') {
        return [
          `# Juniper Junos RSPAN Configuration`,
          `set vlans rspan-vlan vlan-id ${rspanVlan}`,
          `set forwarding-options analyzer session${sess} input ingress interface ${srcInt}`,
          `set forwarding-options analyzer session${sess} output vlan rspan-vlan`
        ].join('\n');
      }

      if (sessionType === 'erspan') {
        return [
          `# Juniper Junos ERSPAN Gre Tunnel Configuration`,
          `set forwarding-options analyzer session${sess} input ingress interface ${srcInt}`,
          `set forwarding-options analyzer session${sess} output tunnel gre destination-address ${erspanDstIp} source-address ${erspanSrcIp}`
        ].join('\n');
      }
    }

    if (activePlatform === 'huawei') {
      const vrpDir = direction === 'both' ? 'both' : (direction === 'rx' ? 'inbound' : 'outbound');
      if (sessionType === 'span') {
        if (sourceType === 'interface') {
          return [
            `# Huawei VRP Local Port Mirroring`,
            `observe-port ${sess} interface ${destination}`,
            `interface ${sourceVal}`,
            ` port-mirroring to observe-port ${sess} ${vrpDir}`
          ].join('\n');
        } else {
          return [
            `# Huawei VRP Local VLAN Mirroring`,
            `observe-port ${sess} interface ${destination}`,
            `vlan ${sourceVal}`,
            ` mirroring to observe-port ${sess} ${vrpDir}`
          ].join('\n');
        }
      }

      if (sessionType === 'rspan') {
        if (sourceType === 'interface') {
          return [
            `# Huawei VRP Remote Port Mirroring (RSPAN)`,
            `vlan ${rspanVlan}`,
            `# Configure observing port with remote-destination VLAN`,
            `observe-port ${sess} interface ${destination} vlan ${rspanVlan}`,
            `interface ${sourceVal}`,
            ` port-mirroring to observe-port ${sess} ${vrpDir}`
          ].join('\n');
        } else {
          return [
            `# Huawei VRP Remote VLAN Mirroring (RSPAN)`,
            `vlan ${rspanVlan}`,
            `observe-port ${sess} interface ${destination} vlan ${rspanVlan}`,
            `vlan ${sourceVal}`,
            ` mirroring to observe-port ${sess} ${vrpDir}`
          ].join('\n');
        }
      }

      if (sessionType === 'erspan') {
        return [
          `# Huawei VRP ERSPAN (Encapsulated Port Mirroring)`,
          `observe-port ${sess} destination-ip ${erspanDstIp} source-ip ${erspanSrcIp}`,
          `interface ${sourceVal}`,
          ` port-mirroring to observe-port ${sess} ${vrpDir}`
        ].join('\n');
      }
    }

    if (activePlatform === 'dell') {
      const dellDir = direction === 'both' ? 'both' : (direction === 'rx' ? 'rx' : 'tx');
      const dellSrcType = sourceType === 'interface' ? 'interface' : 'vlan';
      
      if (sessionType === 'span') {
        return [
          `! Dell SmartFlow OS10 Local SPAN Configuration`,
          `monitor session ${sess}`,
          `  source ${dellSrcType} ${sourceVal} direction ${dellDir}`,
          `  destination interface ${destination}`,
          `  no shut`
        ].join('\n');
      }

      if (sessionType === 'rspan') {
        return [
          `! Dell SmartFlow OS10 RSPAN Configuration`,
          `vlan ${rspanVlan}`,
          `  mode rspan`,
          `!`,
          `monitor session ${sess}`,
          `  source ${dellSrcType} ${sourceVal} direction ${dellDir}`,
          `  destination remote-vlan ${rspanVlan}`,
          `  no shut`
        ].join('\n');
      }

      if (sessionType === 'erspan') {
        return [
          `! Dell SmartFlow OS10 ERSPAN Configuration`,
          `monitor session ${sess} type erspan-source`,
          `  source ${dellSrcType} ${sourceVal} direction ${dellDir}`,
          `  destination ip ${erspanDstIp} source-ip ${erspanSrcIp} erspan-id ${erspanId}`,
          `  no shut`
        ].join('\n');
      }
    }

    if (activePlatform === 'aruba') {
      const arubaDir = direction === 'both' ? 'both' : (direction === 'rx' ? 'rx' : 'tx');
      const arubaSrcType = sourceType === 'interface' ? 'interface' : 'vlan';

      if (sessionType === 'span') {
        return [
          `! Aruba AOS-CX Local Mirror Configuration`,
          `mirror session ${sess}`,
          `  source ${arubaSrcType} ${sourceVal} ${arubaDir}`,
          `  destination interface ${destination}`,
          `  enable`
        ].join('\n');
      }

      if (sessionType === 'rspan') {
        return [
          `! Aruba AOS-CX RSPAN Configuration`,
          `vlan ${rspanVlan}`,
          `  name RSPAN_VLAN`,
          `  remote-span`,
          `!`,
          `mirror session ${sess}`,
          `  source ${arubaSrcType} ${sourceVal} ${arubaDir}`,
          `  destination vlan ${rspanVlan}`,
          `  enable`
        ].join('\n');
      }

      if (sessionType === 'erspan') {
        return [
          `! Aruba AOS-CX ERSPAN Configuration`,
          `mirror session ${sess}`,
          `  source ${arubaSrcType} ${sourceVal} ${arubaDir}`,
          `  destination tunnel ip ${erspanDstIp} source-ip ${erspanSrcIp}`,
          `  enable`
        ].join('\n');
      }
    }

    if (activePlatform === 'mikrotik') {
      if (sessionType === 'span') {
        if (sourceType === 'interface') {
          return [
            `# MikroTik RouterOS Local Switch-Level Port Mirroring`,
            `/interface ethernet switch`,
            `set [find name=switch1] mirror-source=${sourceVal} mirror-target=${destination}`,
            `# Enable mirroring on the target switch port:`,
            `/interface ethernet switch port`,
            `set [find name=${sourceVal}] ingress-mirror=yes egress-mirror=yes`
          ].join('\n');
        } else {
          return [
            `# MikroTik RouterOS Local VLAN Switch-Rule Mirroring`,
            `/interface ethernet switch rule`,
            `add switch=switch1 ports=${destination} vlan-id=${sourceVal} mirror=yes`
          ].join('\n');
        }
      }

      if (sessionType === 'rspan') {
        return [
          `# MikroTik RouterOS RSPAN-like (VLAN) Configuration`,
          `# 1. Create RSPAN VLAN on the destination port`,
          `/interface vlan`,
          `add name=RSPAN_VLAN vlan-id=${rspanVlan} interface=${destination}`,
          `# 2. Configure mirror source and direct it to destination`,
          `/interface ethernet switch`,
          `set [find name=switch1] mirror-source=${sourceVal} mirror-target=${destination}`
        ].join('\n');
      }

      if (sessionType === 'erspan') {
        return [
          `# MikroTik RouterOS Remote Mirroring via EoIP (ERSPAN Alternative)`,
          `/interface eoip`,
          `add name=eoip-mirror remote-address=${erspanDstIp} local-address=${erspanSrcIp} tunnel-id=${erspanId}`,
          `/interface ethernet switch`,
          `set [find name=switch1] mirror-source=${sourceVal} mirror-target=eoip-mirror`
        ].join('\n');
      }
    }

    if (activePlatform === 'asa') {
      const asaDir = direction === 'both' ? 'bidirectional' : (direction === 'rx' ? 'incoming' : 'outgoing');
      
      if (sessionType === 'span') {
        return [
          `! Cisco ASA Traffic Export (SPAN Alternative)`,
          `! 1. Define the traffic export profile`,
          `traffic-export profile SPAN_PROFILE`,
          `  interface ${destination}`,
          `  ${asaDir}`,
          `! 2. Apply the profile to the monitored interface`,
          `interface ${sourceVal}`,
          `  traffic-export apply SPAN_PROFILE`
        ].join('\n');
      }

      if (sessionType === 'rspan') {
        return [
          `! Cisco ASA Traffic Export over RSPAN VLAN`,
          `! 1. Configure RSPAN subinterface`,
          `interface ${destination}.${rspanVlan}`,
          `  vlan ${rspanVlan}`,
          `! 2. Define the RSPAN traffic export profile`,
          `traffic-export profile RSPAN_PROFILE`,
          `  interface ${destination}.${rspanVlan}`,
          `  ${asaDir}`,
          `! 3. Apply the profile to the source interface`,
          `interface ${sourceVal}`,
          `  traffic-export apply RSPAN_PROFILE`
        ].join('\n');
      }

      if (sessionType === 'erspan') {
        return [
          `! Cisco ASA does not support native ERSPAN encapsulation.`,
          `! Use CLI capture with real-time streaming to ${erspanDstIp}:`,
          `capture cap1 interface ${sourceVal} match ip any any type raw-data buffer 524288`,
          `capture cap1 real-time`
        ].join('\n');
      }
    }

    return '';
  }, [activePlatform, sessionType, sourceType, sourceVal, direction, destination, rspanVlan, erspanSrcIp, erspanDstIp, erspanId, erspanVni, optReplicate, optIngress, sessionId, t]);

  const handleValidationTrigger = () => {
    validateInputs();
  };

  return (
    <div className="fadein">
      <div className="two-col grid-mobile-1">
        <div>
          <div className="card">
            <div className="card-title">{t('common.input')}</div>
            
            <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
              <div className="field">
                <label className="label">{t('span_builder.session_id')}</label>
                <input className="input" type="number" min="1" max="64" value={sessionId} onChange={e => setSessionId(e.target.value)} onBlur={handleValidationTrigger} />
              </div>
              <div className="field">
                <label className="label">{t('span_builder.session_type')}</label>
                <select className="input" value={sessionType} onChange={e => setSessionType(e.target.value)}>
                  <option value="span">SPAN (Local)</option>
                  <option value="rspan">RSPAN (VLAN)</option>
                  <option value="erspan">ERSPAN (GRE)</option>
                </select>
              </div>
            </div>

            <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
              <div className="field">
                <label className="label">{t('span_builder.source_type')}</label>
                <select className="input" value={sourceType} onChange={e => setSourceType(e.target.value)}>
                  <option value="interface">Interface(s)</option>
                  <option value="vlan">VLAN(s)</option>
                </select>
              </div>
              <div className="field">
                <label className="label">{t('span_builder.direction')}</label>
                <select className="input" value={direction} onChange={e => setDirection(e.target.value)}>
                  <option value="both">{t('span_builder.direction_both')}</option>
                  <option value="rx">{t('span_builder.direction_rx')}</option>
                  <option value="tx">{t('span_builder.direction_tx')}</option>
                </select>
              </div>
            </div>

            <div className="field">
              <label className="label">{t('span_builder.source_val')}</label>
              <input className="input" value={sourceVal} onChange={e => setSourceVal(e.target.value)} onBlur={handleValidationTrigger} placeholder={t('span_builder.source_val_placeholder')} />
            </div>

            {sessionType === 'span' && (
              <div className="field">
                <label className="label">{t('span_builder.destination')}</label>
                <input className="input" value={destination} onChange={e => setDestination(e.target.value)} onBlur={handleValidationTrigger} placeholder={t('span_builder.destination_placeholder')} />
              </div>
            )}

            {sessionType === 'rspan' && (
              <div className="field">
                <label className="label">{t('span_builder.rspan_vlan')}</label>
                <input className="input" type="number" value={rspanVlan} onChange={e => setRspanVlan(e.target.value)} />
              </div>
            )}

            {sessionType === 'erspan' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
                  <div className="field">
                    <label className="label">{t('span_builder.erspan_src_ip')}</label>
                    <input className="input" value={erspanSrcIp} onChange={e => setErspanSrcIp(e.target.value)} onBlur={handleValidationTrigger} />
                  </div>
                  <div className="field">
                    <label className="label">{t('span_builder.erspan_dst_ip')}</label>
                    <input className="input" value={erspanDstIp} onChange={e => setErspanDstIp(e.target.value)} onBlur={handleValidationTrigger} />
                  </div>
                </div>
                <div className="two-col grid-mobile-1" style={{ gap: 10 }}>
                  <div className="field">
                    <label className="label">{t('span_builder.erspan_id')}</label>
                    <input className="input" type="number" value={erspanId} onChange={e => setErspanId(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('span_builder.erspan_vni')}</label>
                    <input className="input" type="number" value={erspanVni} onChange={e => setErspanVni(e.target.value)} />
                  </div>
                </div>
              </div>
            )}

            {sessionType === 'span' && (
              <div style={{ marginTop: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                  <input type="checkbox" id="opt-replicate" checked={optReplicate} onChange={e => setOptReplicate(e.target.checked)} />
                  <label htmlFor="opt-replicate" style={{ fontSize: 12, cursor: 'pointer' }}>{t('span_builder.opt_replicate')}</label>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" id="opt-ingress" checked={optIngress} onChange={e => setOptIngress(e.target.checked)} />
                  <label htmlFor="opt-ingress" style={{ fontSize: 12, cursor: 'pointer' }}>{t('span_builder.opt_ingress')}</label>
                </div>
              </div>
            )}

            <Err msg={error} />
          </div>
        </div>

        <div>
          <div className="card">
            <div className="card-title">{t('span_builder.session_type')} Summary</div>
            <p style={{ fontSize: 12, color: 'var(--dim)', margin: 0 }}>
              {sessionType === 'span' && t('span_builder.description_span')}
              {sessionType === 'rspan' && t('span_builder.description_rspan')}
              {sessionType === 'erspan' && t('span_builder.description_erspan')}
            </p>
          </div>

          <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12, marginTop: 16, flexWrap: 'wrap' }}>
            {[
              { id: 'cisco_ios', label: t('span_builder.tab_cisco_ios') },
              { id: 'cisco_nxos', label: t('span_builder.tab_cisco_nxos') },
              { id: 'ers_arista', label: t('span_builder.tab_arista') },
              { id: 'juniper', label: t('span_builder.tab_juniper') },
              { id: 'huawei', label: t('span_builder.tab_huawei') },
              { id: 'dell', label: t('span_builder.tab_dell') },
              { id: 'aruba', label: t('span_builder.tab_aruba') },
              { id: 'mikrotik', label: t('span_builder.tab_mikrotik') },
              { id: 'asa', label: t('span_builder.tab_asa') }
            ].map(p => (
              <button key={p.id} className={`btn btn-sm ${activePlatform === p.id ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActivePlatform(p.id)} style={{ borderRadius: '6px 6px 0 0', borderBottom: 'none', margin: '2px 2px 0 0' }}>
                {p.label}
              </button>
            ))}
          </div>

          {generatedConfigText && (
            <div className="card fadein" style={{ marginTop: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <div className="card-title" style={{ margin: 0 }}>{t('span_builder.config_output', 'Configuration Output')}</div>
                <CopyBtn text={generatedConfigText} label="copy" id="span-config-copy" />
              </div>
              <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--background)', padding: 12, borderRadius: 6, whiteSpace: 'pre-wrap' }}>
                {generatedConfigText}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.SPANConfigBuilder = SPANConfigBuilder;
