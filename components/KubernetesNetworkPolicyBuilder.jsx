const { useState, useEffect, useCallback, useMemo } = React;

function KubernetesNetworkPolicyBuilder({ initialData, onShare }) {
  const { t } = useTranslation();

  // Inputs
  const [name, setName] = usePersistentState('k8s:name', 'allow-web-traffic');
  const [namespace, setNamespace] = usePersistentState('k8s:namespace', 'default');
  const [podSelectorKey, setPodSelectorKey] = usePersistentState('k8s:pod_key', 'app');
  const [podSelectorVal, setPodSelectorVal] = usePersistentState('k8s:pod_val', 'frontend');
  const [policyIngress, setPolicyIngress] = usePersistentState('k8s:policy_ingress', true);
  const [policyEgress, setPolicyEgress] = usePersistentState('k8s:policy_egress', false);

  // Ingress rules list
  const [ingressRules, setIngressRules] = usePersistentState('k8s:ingress_rules', () => {
    if (initialData?.ingressRules?.length) return initialData.ingressRules;
    return [{ id: 'i1', type: 'namespace', key: 'project', val: 'frontend', port: '80', protocol: 'TCP' }];
  });

  // Egress rules list
  const [egressRules, setEgressRules] = usePersistentState('k8s:egress_rules', () => {
    if (initialData?.egressRules?.length) return initialData.egressRules;
    return [];
  });

  // Share URL synchronization
  useEffect(() => {
    const handleShare = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'k8s-netpol-builder',
        name,
        namespace,
        podSelectorKey,
        podSelectorVal,
        policyIngress,
        policyEgress,
        ingressRules,
        egressRules
      });
    };
    window.addEventListener('app:request-share', handleShare);
    return () => window.removeEventListener('app:request-share', handleShare);
  }, [name, namespace, podSelectorKey, podSelectorVal, policyIngress, policyEgress, ingressRules, egressRules, onShare]);

  // Presets handler
  const applyPreset = (presetType) => {
    switch (presetType) {
      case 'deny-all':
        setName('default-deny-all');
        setPodSelectorKey('');
        setPodSelectorVal('');
        setPolicyIngress(true);
        setPolicyEgress(true);
        setIngressRules([]);
        setEgressRules([]);
        break;
      case 'allow-same-ns':
        setName('allow-same-namespace');
        setPodSelectorKey('');
        setPodSelectorVal('');
        setPolicyIngress(true);
        setPolicyEgress(false);
        setIngressRules([{ id: 'i-ns', type: 'namespace-self', key: '', val: '', port: '', protocol: 'TCP' }]);
        setEgressRules([]);
        break;
      case 'db-isolation':
        setName('db-isolation');
        setPodSelectorKey('role');
        setPodSelectorVal('db');
        setPolicyIngress(true);
        setPolicyEgress(false);
        setIngressRules([{ id: 'i-db', type: 'pod', key: 'role', val: 'backend', port: '5432', protocol: 'TCP' }]);
        setEgressRules([]);
        break;
      case 'allow-service':
        setName('allow-app-to-service');
        setPodSelectorKey('app');
        setPodSelectorVal('my-service');
        setPolicyIngress(true);
        setPolicyEgress(false);
        setIngressRules([{ id: 'i-svc', type: 'pod', key: 'app', val: 'gateway', port: '8080', protocol: 'TCP' }]);
        setEgressRules([]);
        break;
      case 'dns-egress':
        setName('allow-dns-egress');
        setPodSelectorKey('');
        setPodSelectorVal('');
        setPolicyIngress(false);
        setPolicyEgress(true);
        setIngressRules([]);
        setEgressRules([
          { id: 'e-dns1', type: 'namespace', key: 'kubernetes.io/metadata.name', val: 'kube-system', port: '53', protocol: 'UDP' },
          { id: 'e-dns2', type: 'namespace', key: 'kubernetes.io/metadata.name', val: 'kube-system', port: '53', protocol: 'TCP' },
        ]);
        break;
      case 'prometheus-scrape':
        setName('allow-prometheus-scrape');
        setPodSelectorKey('');
        setPodSelectorVal('');
        setPolicyIngress(true);
        setPolicyEgress(false);
        setIngressRules([
          { id: 'i-prom', type: 'namespace', key: 'kubernetes.io/metadata.name', val: 'monitoring', port: '9090', protocol: 'TCP' },
        ]);
        setEgressRules([]);
        break;
      case 'ingress-allow':
        setName('allow-ingress-controller');
        setPodSelectorKey('');
        setPodSelectorVal('');
        setPolicyIngress(true);
        setPolicyEgress(false);
        setIngressRules([
          { id: 'i-ing80',  type: 'namespace', key: 'kubernetes.io/metadata.name', val: 'ingress-nginx', port: '80',  protocol: 'TCP' },
          { id: 'i-ing443', type: 'namespace', key: 'kubernetes.io/metadata.name', val: 'ingress-nginx', port: '443', protocol: 'TCP' },
        ]);
        setEgressRules([]);
        break;
      case 'ns-to-ns-selective':
        setName('allow-namespace-selective');
        setPodSelectorKey('');
        setPodSelectorVal('');
        setPolicyIngress(true);
        setPolicyEgress(false);
        setIngressRules([
          { id: 'i-ns2ns', type: 'namespace', key: 'team', val: 'frontend', port: '8080', protocol: 'TCP' },
        ]);
        setEgressRules([]);
        break;
      default:
        break;
    }
  };

  const addRule = (direction) => {
    const newRule = {
      id: Math.random().toString(36).substring(2, 9),
      type: 'pod',
      key: 'app',
      val: 'client',
      port: '80',
      protocol: 'TCP'
    };
    if (direction === 'ingress') {
      setIngressRules([...ingressRules, newRule]);
    } else {
      setEgressRules([...egressRules, newRule]);
    }
  };

  const removeRule = (direction, id) => {
    if (direction === 'ingress') {
      setIngressRules(ingressRules.filter(r => r.id !== id));
    } else {
      setEgressRules(egressRules.filter(r => r.id !== id));
    }
  };

  const updateRule = (direction, id, field, value) => {
    const rules = direction === 'ingress' ? ingressRules : egressRules;
    const updated = rules.map(r => r.id === id ? { ...r, [field]: value } : r);
    if (direction === 'ingress') {
      setIngressRules(updated);
    } else {
      setEgressRules(updated);
    }
  };

  // Generate Manifest YAML
  const generatedYaml = useMemo(() => {
    let yaml = `apiVersion: networking.k8s.io/v1\n`;
    yaml += `kind: NetworkPolicy\n`;
    yaml += `metadata:\n`;
    yaml += `  name: ${name || 'policy-example'}\n`;
    yaml += `  namespace: ${namespace || 'default'}\n`;
    yaml += `spec:\n`;
    yaml += `  podSelector:\n`;
    if (podSelectorKey) {
      yaml += `    matchLabels:\n`;
      yaml += `      ${podSelectorKey}: "${podSelectorVal}"\n`;
    } else {
      yaml += `    matchLabels: {}\n`;
    }

    yaml += `  policyTypes:\n`;
    if (policyIngress) yaml += `    - Ingress\n`;
    if (policyEgress) yaml += `    - Egress\n`;

    if (policyIngress) {
      yaml += `  ingress:\n`;
      if (ingressRules.length === 0) {
        yaml += `    # Empty ingress list denies all incoming traffic\n`;
      } else {
        ingressRules.forEach(r => {
          yaml += `    - from:\n`;
          if (r.type === 'pod') {
            yaml += `        - podSelector:\n`;
            yaml += `            matchLabels:\n`;
            yaml += `              ${r.key}: "${r.val}"\n`;
          } else if (r.type === 'namespace') {
            yaml += `        - namespaceSelector:\n`;
            yaml += `            matchLabels:\n`;
            yaml += `              ${r.key}: "${r.val}"\n`;
          } else if (r.type === 'namespace-self') {
            yaml += `        - namespaceSelector: {}\n`;
          } else if (r.type === 'ipblock') {
            yaml += `        - ipBlock:\n`;
            yaml += `            cidr: ${r.val || '10.0.0.0/24'}\n`;
          }
          if (r.port) {
            yaml += `      ports:\n`;
            yaml += `        - protocol: ${r.protocol}\n`;
            yaml += `          port: ${r.port}\n`;
          }
        });
      }
    }

    if (policyEgress) {
      yaml += `  egress:\n`;
      if (egressRules.length === 0) {
        yaml += `    # Empty egress list denies all outgoing traffic\n`;
      } else {
        egressRules.forEach(r => {
          yaml += `    - to:\n`;
          if (r.type === 'pod') {
            yaml += `        - podSelector:\n`;
            yaml += `            matchLabels:\n`;
            yaml += `              ${r.key}: "${r.val}"\n`;
          } else if (r.type === 'namespace') {
            yaml += `        - namespaceSelector:\n`;
            yaml += `            matchLabels:\n`;
            yaml += `              ${r.key}: "${r.val}"\n`;
          } else if (r.type === 'namespace-self') {
            yaml += `        - namespaceSelector: {}\n`;
          } else if (r.type === 'ipblock') {
            yaml += `        - ipBlock:\n`;
            yaml += `            cidr: ${r.val || '10.0.0.0/24'}\n`;
          }
          if (r.port) {
            yaml += `      ports:\n`;
            yaml += `        - protocol: ${r.protocol}\n`;
            yaml += `          port: ${r.port}\n`;
          }
        });
      }
    }

    return yaml;
  }, [name, namespace, podSelectorKey, podSelectorVal, policyIngress, policyEgress, ingressRules, egressRules]);

  // Generate simple human text description
  const descriptionText = useMemo(() => {
    let desc = `Applied to pods: ${podSelectorKey ? `${podSelectorKey}=${podSelectorVal}` : 'All pods'} in namespace "${namespace}".\n\n`;
    
    if (policyIngress) {
      desc += `Ingress Rules:\n`;
      if (ingressRules.length === 0) {
        desc += `  - Denies all inbound traffic.\n`;
      } else {
        ingressRules.forEach((r, idx) => {
          desc += `  ${idx + 1}. Allow traffic from `;
          if (r.type === 'pod') desc += `pods matching label "${r.key}=${r.val}"`;
          else if (r.type === 'namespace') desc += `namespaces matching label "${r.key}=${r.val}"`;
          else if (r.type === 'namespace-self') desc += `all pods in the same namespace`;
          else if (r.type === 'ipblock') desc += `IP CIDR block "${r.val}"`;
          if (r.port) desc += ` on ${r.protocol} port ${r.port}`;
          desc += '.\n';
        });
      }
    }

    if (policyEgress) {
      desc += `\nEgress Rules:\n`;
      if (egressRules.length === 0) {
        desc += `  - Denies all outbound traffic.\n`;
      } else {
        egressRules.forEach((r, idx) => {
          desc += `  ${idx + 1}. Allow traffic to `;
          if (r.type === 'pod') desc += `pods matching label "${r.key}=${r.val}"`;
          else if (r.type === 'namespace') desc += `namespaces matching label "${r.key}=${r.val}"`;
          else if (r.type === 'namespace-self') desc += `all pods in the same namespace`;
          else if (r.type === 'ipblock') desc += `IP CIDR block "${r.val}"`;
          if (r.port) desc += ` on ${r.protocol} port ${r.port}`;
          desc += '.\n';
        });
      }
    }

    return desc;
  }, [podSelectorKey, podSelectorVal, namespace, policyIngress, policyEgress, ingressRules, egressRules]);

  const copyYaml = () => {
    navigator.clipboard.writeText(generatedYaml);
  };

  return (
    <div className="fadein">
      <div className="two-col">
        {/* Policy Configuration Fields */}
        <div className="card">
          <h2 className="card-title">{t('k8s_netpol_builder.title')}</h2>

          {/* Preset Selector Dropdown */}
          <div className="field">
            <label className="label">{t('k8s_netpol_builder.presets')}</label>
            <SearchableSelect
              value=""
              placeholder={t('k8s_netpol_builder.select_preset')}
              options={[
                { value: 'deny-all',           label: t('k8s_netpol_builder.preset_deny_all') },
                { value: 'allow-same-ns',      label: t('k8s_netpol_builder.preset_same_ns') },
                { value: 'db-isolation',       label: t('k8s_netpol_builder.preset_db_iso') },
                { value: 'allow-service',      label: t('k8s_netpol_builder.preset_allow_svc') },
                { value: 'dns-egress',         label: t('k8s_netpol_builder.preset_dns_egress') },
                { value: 'prometheus-scrape',  label: t('k8s_netpol_builder.preset_prometheus') },
                { value: 'ingress-allow',      label: t('k8s_netpol_builder.preset_ingress_allow') },
                { value: 'ns-to-ns-selective', label: t('k8s_netpol_builder.preset_ns_to_ns') },
              ]}
              onChange={v => { if (v) applyPreset(v); }}
            />
          </div>

          <div className="two-col">
            <div className="field">
              <label className="label">{t('k8s_netpol_builder.name')}</label>
              <input type="text" className="input" value={name} onChange={e => setName(e.target.value)} />
            </div>
            <div className="field">
              <label className="label">{t('k8s_netpol_builder.namespace')}</label>
              <input type="text" className="input" value={namespace} onChange={e => setNamespace(e.target.value)} />
            </div>
          </div>

          <div className="field">
            <label className="label">{t('k8s_netpol_builder.target_pods')}</label>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <input type="text" placeholder="Key (e.g. app)" className="input" value={podSelectorKey} onChange={e => setPodSelectorKey(e.target.value)} />
              <input type="text" placeholder="Value (e.g. backend)" className="input" value={podSelectorVal} onChange={e => setPodSelectorVal(e.target.value)} />
            </div>
            <span className="hint">{t('k8s_netpol_builder.target_pods_hint')}</span>
          </div>

          <div className="field">
            <label className="label">{t('k8s_netpol_builder.policy_types')}</label>
            <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <input type="checkbox" checked={policyIngress} onChange={e => setPolicyIngress(e.target.checked)} />
                {t('k8s_netpol_builder.ingress')}
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <input type="checkbox" checked={policyEgress} onChange={e => setPolicyEgress(e.target.checked)} />
                {t('k8s_netpol_builder.egress')}
              </label>
            </div>
          </div>

          {/* Ingress Rules Editor */}
          {policyIngress && (
            <div className="field" style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label className="label" style={{ marginBottom: 0 }}>{t('k8s_netpol_builder.ingress_rules')}</label>
                <button className="btn btn-sm btn-primary" onClick={() => addRule('ingress')}>+ Add Rule</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {ingressRules.map(r => (
                  <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', alignItems: 'center' }}>
                    <select className="select" style={{ width: '130px' }} value={r.type} onChange={e => updateRule('ingress', r.id, 'type', e.target.value)}>
                      <option value="pod">Pod Selector</option>
                      <option value="namespace">Namespace Sel</option>
                      <option value="namespace-self">Same Namespace</option>
                      <option value="ipblock">IP Block (CIDR)</option>
                    </select>

                    {r.type !== 'namespace-self' && (
                      <>
                        <input type="text" placeholder={r.type === 'ipblock' ? 'CIDR' : 'Label Key'} className="input" style={{ flex: 1, minWidth: '80px' }} value={r.key} onChange={e => updateRule('ingress', r.id, 'key', e.target.value)} />
                        {r.type !== 'ipblock' && (
                          <input type="text" placeholder="Label Value" className="input" style={{ flex: 1, minWidth: '80px' }} value={r.val} onChange={e => updateRule('ingress', r.id, 'val', e.target.value)} />
                        )}
                      </>
                    )}

                    <input type="text" placeholder="Port" className="input" style={{ width: '60px' }} value={r.port} onChange={e => updateRule('ingress', r.id, 'port', e.target.value)} />
                    
                    <select className="select" style={{ width: '70px' }} value={r.protocol} onChange={e => updateRule('ingress', r.id, 'protocol', e.target.value)}>
                      <option value="TCP">TCP</option>
                      <option value="UDP">UDP</option>
                      <option value="SCTP">SCTP</option>
                    </select>

                    <button className="btn btn-sm btn-danger" onClick={() => removeRule('ingress', r.id)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Egress Rules Editor */}
          {policyEgress && (
            <div className="field" style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <label className="label" style={{ marginBottom: 0 }}>{t('k8s_netpol_builder.egress_rules')}</label>
                <button className="btn btn-sm btn-primary" onClick={() => addRule('egress')}>+ Add Rule</button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {egressRules.map(r => (
                  <div key={r.id} style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', padding: '0.4rem', border: '1px solid var(--border)', borderRadius: 'var(--radius)', alignItems: 'center' }}>
                    <select className="select" style={{ width: '130px' }} value={r.type} onChange={e => updateRule('egress', r.id, 'type', e.target.value)}>
                      <option value="pod">Pod Selector</option>
                      <option value="namespace">Namespace Sel</option>
                      <option value="namespace-self">Same Namespace</option>
                      <option value="ipblock">IP Block (CIDR)</option>
                    </select>

                    {r.type !== 'namespace-self' && (
                      <>
                        <input type="text" placeholder={r.type === 'ipblock' ? 'CIDR' : 'Label Key'} className="input" style={{ flex: 1, minWidth: '80px' }} value={r.key} onChange={e => updateRule('egress', r.id, 'key', e.target.value)} />
                        {r.type !== 'ipblock' && (
                          <input type="text" placeholder="Label Value" className="input" style={{ flex: 1, minWidth: '80px' }} value={r.val} onChange={e => updateRule('egress', r.id, 'val', e.target.value)} />
                        )}
                      </>
                    )}

                    <input type="text" placeholder="Port" className="input" style={{ width: '60px' }} value={r.port} onChange={e => updateRule('egress', r.id, 'port', e.target.value)} />
                    
                    <select className="select" style={{ width: '70px' }} value={r.protocol} onChange={e => updateRule('egress', r.id, 'protocol', e.target.value)}>
                      <option value="TCP">TCP</option>
                      <option value="UDP">UDP</option>
                      <option value="SCTP">SCTP</option>
                    </select>

                    <button className="btn btn-sm btn-danger" onClick={() => removeRule('egress', r.id)}>×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* YAML Manifest output */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
            <h2 className="card-title" style={{ margin: 0 }}>NetworkPolicy YAML</h2>
            <CopyBtn text={generatedYaml} />
          </div>

          <div style={{ marginBottom: '1rem', borderBottom: '1px solid var(--border)', paddingBottom: '1rem' }}>
            <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--primary)' }}>Rule Summary</h3>
            <pre style={{ margin: 0, fontFamily: 'var(--mono)', fontSize: '0.85rem', color: 'var(--text)', whiteSpace: 'pre-wrap' }}>
              {descriptionText}
            </pre>
          </div>

          <div style={{ flex: 1 }}>
            <pre className="result-value" style={{ margin: 0, padding: '1rem', height: '100%', minHeight: '300px', maxHeight: '550px', overflow: 'auto', backgroundColor: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', color: 'var(--text)', fontFamily: 'var(--mono)', fontSize: '0.9rem', whiteSpace: 'pre' }}>
              {generatedYaml}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

window.KubernetesNetworkPolicyBuilder = KubernetesNetworkPolicyBuilder;
