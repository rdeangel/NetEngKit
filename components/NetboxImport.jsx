const { useState, useEffect, useCallback, useMemo } = React;

const INVENTORY_CATEGORIES = [
  { id: 'sites', label: 'Sites' },
  { id: 'racks', label: 'Racks' },
  { id: 'devices', label: 'Devices' },
  { id: 'interfaces', label: 'Interfaces' },
  { id: 'ips', label: 'IP Addresses' },
  { id: 'vlans', label: 'VLANs' },
  { id: 'vrfs', label: 'VRFs' },
  { id: 'circuits', label: 'Circuits' }
];

const DEFAULT_ITEMS = {
  sites: [
    { id: 's1', name: 'NYC-DataCenter', slug: 'nyc-dc', status: 'active', description: 'Primary East Coast DC' },
    { id: 's2', name: 'LON-DataCenter', slug: 'lon-dc', status: 'active', description: 'European Core Hub' }
  ],
  racks: [
    { id: 'r1', site: 'NYC-DataCenter', name: 'Rack-A1', facility_id: 'NYC-A1', u_height: 42, status: 'active' },
    { id: 'r2', site: 'LON-DataCenter', name: 'Rack-B2', facility_id: 'LON-B2', u_height: 48, status: 'active' }
  ],
  devices: [
    { id: 'd1', name: 'nyc-core-sw01', site: 'NYC-DataCenter', rack: 'Rack-A1', position: 40, face: 'front', device_type: 'cisco-c9300-48t', role: 'core-switch', status: 'active' },
    { id: 'd2', name: 'lon-edge-rt01', site: 'LON-DataCenter', rack: 'Rack-B2', position: 44, face: 'front', device_type: 'juniper-mx240', role: 'edge-router', status: 'active' }
  ],
  interfaces: [
    { id: 'i1', device: 'nyc-core-sw01', name: 'GigabitEthernet1/0/1', type: '1000base-t', enabled: true, mac_address: '00:11:22:33:44:55', description: 'Uplink to FW01' },
    { id: 'i2', device: 'lon-edge-rt01', name: 'xe-0/0/0', type: '10gbase-x-sfpp', enabled: true, mac_address: '00:aa:bb:cc:dd:ee', description: 'WAN Circuit Link' }
  ],
  ips: [
    { id: 'ip1', address: '10.100.1.1/24', status: 'active', vrf: 'production', description: 'nyc-core-sw01 Management' },
    { id: 'ip2', address: '172.16.50.2/30', status: 'active', vrf: 'global', description: 'lon-edge-rt01 WAN Peer' }
  ],
  vlans: [
    { id: 'vl1', name: 'Production-Data', vid: 100, site: 'NYC-DataCenter', status: 'active', description: 'NYC Production Subnet' },
    { id: 'vl2', name: 'LON-Mgmt', vid: 99, site: 'LON-DataCenter', status: 'active', description: 'London Out-of-Band Mgmt' }
  ],
  vrfs: [
    { id: 'vrf1', name: 'production', rd: '65000:100', description: 'Prod Routing Table' },
    { id: 'vrf2', name: 'oob-mgmt', rd: '65000:99', description: 'Out of Band VRF' }
  ],
  circuits: [
    { id: 'c1', cid: 'CKT-10045239', provider: 'Verizon Enterprise', type: 'direct-internet-access', site: 'NYC-DataCenter', status: 'active', description: '10G Primary WAN' },
    { id: 'c2', cid: 'CKT-EU-00892', provider: 'British Telecom', type: 'mpls-backbone', site: 'LON-DataCenter', status: 'active', description: '1G Transit Circuit' }
  ]
};

const DEFAULT_NEW_ROW = {
  sites: () => ({ name: '', slug: '', status: 'active', description: '' }),
  racks: () => ({ site: '', name: '', facility_id: '', u_height: 42, status: 'active' }),
  devices: () => ({ name: '', site: '', rack: '', position: 42, face: 'front', device_type: '', role: '', status: 'active' }),
  interfaces: () => ({ device: '', name: '', type: '1000base-t', enabled: true, mac_address: '', description: '' }),
  ips: () => ({ address: '', status: 'active', vrf: '', description: '' }),
  vlans: () => ({ name: '', vid: 10, site: '', status: 'active', description: '' }),
  vrfs: () => ({ name: '', rd: '', description: '' }),
  circuits: () => ({ cid: '', provider: '', type: 'direct-internet-access', site: '', status: 'active', description: '' })
};

function NetboxImport({ initialData, onShare }) {
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = usePersistentState('netbox:active_tab', 'sites');
  const [outMode, setOutMode] = usePersistentState('netbox:out_mode', 'csv');
  const [copied, copy] = useCopy();

  const [sites, setSites] = usePersistentState('netbox:sites', initialData?.sites ?? DEFAULT_ITEMS.sites);
  const [racks, setRacks] = usePersistentState('netbox:racks', initialData?.racks ?? DEFAULT_ITEMS.racks);
  const [devices, setDevices] = usePersistentState('netbox:devices', initialData?.devices ?? DEFAULT_ITEMS.devices);
  const [interfaces, setInterfaces] = usePersistentState('netbox:interfaces', initialData?.interfaces ?? DEFAULT_ITEMS.interfaces);
  const [ips, setIps] = usePersistentState('netbox:ips', initialData?.ips ?? DEFAULT_ITEMS.ips);
  const [vlans, setVlans] = usePersistentState('netbox:vlans', initialData?.vlans ?? DEFAULT_ITEMS.vlans);
  const [vrfs, setVrfs] = usePersistentState('netbox:vrfs', initialData?.vrfs ?? DEFAULT_ITEMS.vrfs);
  const [circuits, setCircuits] = usePersistentState('netbox:circuits', initialData?.circuits ?? DEFAULT_ITEMS.circuits);

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'netbox-import',
        sites, racks, devices, interfaces, ips, vlans, vrfs, circuits
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [sites, racks, devices, interfaces, ips, vlans, vrfs, circuits, onShare]);

  const items = useMemo(() => {
    return { sites, racks, devices, interfaces, ips, vlans, vrfs, circuits };
  }, [sites, racks, devices, interfaces, ips, vlans, vrfs, circuits]);

  const setItems = useCallback((cat, callback) => {
    if (cat === 'sites') setSites(callback);
    else if (cat === 'racks') setRacks(callback);
    else if (cat === 'devices') setDevices(callback);
    else if (cat === 'interfaces') setInterfaces(callback);
    else if (cat === 'ips') setIps(callback);
    else if (cat === 'vlans') setVlans(callback);
    else if (cat === 'vrfs') setVrfs(callback);
    else if (cat === 'circuits') setCircuits(callback);
  }, [setSites, setRacks, setDevices, setInterfaces, setIps, setVlans, setVrfs, setCircuits]);

  const updateItem = useCallback((cat, id, field, value) => {
    setItems(cat, prev => prev.map(item => item.id === id ? { ...item, [field]: value } : item));
  }, [setItems]);

  const addItem = useCallback((cat) => {
    const newRow = {
      id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
      ...DEFAULT_NEW_ROW[cat]()
    };
    setItems(cat, prev => [...prev, newRow]);
  }, [setItems]);

  const removeItem = useCallback((cat, id) => {
    setItems(cat, prev => prev.filter(item => item.id !== id));
  }, [setItems]);

  const clearAll = useCallback((cat) => {
    setItems(cat, () => []);
  }, [setItems]);

  const resetDefault = useCallback((cat) => {
    setItems(cat, () => DEFAULT_ITEMS[cat]);
  }, [setItems]);

  // Validation
  const validationErrors = useMemo(() => {
    const errors = {};
    
    // Sites
    errors.sites = sites.map(s => {
      const e = {};
      if (!s.name.trim()) e.name = t('netbox_import.err_required', 'Name is required');
      if (!s.slug.trim()) e.slug = t('netbox_import.err_required', 'Slug is required');
      else if (!/^[a-z0-9_-]+$/.test(s.slug)) e.slug = t('netbox_import.err_slug', 'Only a-z, 0-9, _, -');
      return e;
    });

    // Racks
    errors.racks = racks.map(r => {
      const e = {};
      if (!r.name.trim()) e.name = t('netbox_import.err_required', 'Name is required');
      if (!r.site.trim()) e.site = t('netbox_import.err_required', 'Site is required');
      if (!r.u_height || r.u_height <= 0) e.u_height = t('netbox_import.err_u_height', 'Must be > 0');
      return e;
    });

    // Devices
    errors.devices = devices.map(d => {
      const e = {};
      if (!d.name.trim()) e.name = t('netbox_import.err_required', 'Name is required');
      if (!d.site.trim()) e.site = t('netbox_import.err_required', 'Site is required');
      if (!d.device_type.trim()) e.device_type = t('netbox_import.err_required', 'Type is required');
      if (!d.role.trim()) e.role = t('netbox_import.err_required', 'Role is required');
      return e;
    });

    // Interfaces
    errors.interfaces = interfaces.map(inf => {
      const e = {};
      if (!inf.device.trim()) e.device = t('netbox_import.err_required', 'Device is required');
      if (!inf.name.trim()) e.name = t('netbox_import.err_required', 'Interface name is required');
      if (inf.mac_address.trim()) {
        const cleanMac = inf.mac_address.replace(/[:.-]/g, '');
        if (!/^[0-9a-fA-F]{12}$/.test(cleanMac)) {
          e.mac_address = t('netbox_import.err_mac', 'Invalid MAC address format');
        }
      }
      return e;
    });

    // IP Addresses
    errors.ips = ips.map(ip => {
      const e = {};
      if (!ip.address.trim()) {
        e.address = t('netbox_import.err_required', 'Address is required');
      } else {
        const parts = ip.address.split('/');
        if (parts.length !== 2) {
          e.address = t('netbox_import.err_cidr', 'Must use CIDR notation (e.g. /24)');
        } else {
          const mask = parseInt(parts[1], 10);
          if (isNaN(mask) || mask < 0 || mask > 128) {
            e.address = t('netbox_import.err_prefix', 'Invalid prefix length');
          }
        }
      }
      return e;
    });

    // VLANs
    errors.vlans = vlans.map(v => {
      const e = {};
      if (!v.name.trim()) e.name = t('netbox_import.err_required', 'Name is required');
      const vidNum = parseInt(v.vid, 10);
      if (isNaN(vidNum) || vidNum < 1 || vidNum > 4094) {
        e.vid = t('netbox_import.err_vid', 'VLAN ID must be 1-4094');
      }
      return e;
    });

    // VRFs
    errors.vrfs = vrfs.map(v => {
      const e = {};
      if (!v.name.trim()) e.name = t('netbox_import.err_required', 'Name is required');
      if (v.rd && !/^\d+:\d+$/.test(v.rd.trim())) {
        e.rd = t('netbox_import.err_rd', 'Must be ASN:NN or IP:NN (e.g. 65000:100)');
      }
      return e;
    });

    // Circuits
    errors.circuits = circuits.map(c => {
      const e = {};
      if (!c.cid.trim()) e.cid = t('netbox_import.err_required', 'Circuit ID is required');
      if (!c.provider.trim()) e.provider = t('netbox_import.err_required', 'Provider is required');
      if (!c.site.trim()) e.site = t('netbox_import.err_required', 'Site is required');
      return e;
    });

    return errors;
  }, [sites, racks, devices, interfaces, ips, vlans, vrfs, circuits, t]);

  const hasAnyError = useMemo(() => {
    for (const key of Object.keys(validationErrors)) {
      const catErrors = validationErrors[key];
      for (const rowError of catErrors) {
        if (Object.keys(rowError).length > 0) return true;
      }
    }
    return false;
  }, [validationErrors]);

  // CSV Output Builder
  const csvContent = useMemo(() => {
    const dataList = items[activeTab] || [];
    if (!dataList.length) return '';
    const headers = Object.keys(dataList[0]).filter(k => k !== 'id');
    const headerRow = headers.join(',');
    const dataRows = dataList.map(item =>
      headers.map(h => {
        let val = item[h];
        if (typeof val === 'boolean') val = val ? 'true' : 'false';
        val = String(val).replace(/"/g, '""');
        return val.includes(',') || val.includes('"') || val.includes('\n') ? `"${val}"` : val;
      }).join(',')
    );
    return [headerRow, ...dataRows].join('\n');
  }, [items, activeTab]);

  // JSON Output Builder
  const jsonContent = useMemo(() => {
    const dataList = items[activeTab] || [];
    const sanitized = dataList.map(item => {
      const copy = { ...item };
      delete copy.id;
      return copy;
    });
    return JSON.stringify(sanitized, null, 2);
  }, [items, activeTab]);

  // Python Script Generator (pynetbox)
  const pythonScript = useMemo(() => {
    const scriptLines = [
      '# Install dependencies: pip install pynetbox',
      'import pynetbox',
      '',
      'NETBOX_URL = "https://netbox.local"',
      'NETBOX_TOKEN = "YOUR_API_TOKEN_HERE"',
      '',
      'nb = pynetbox.api(NETBOX_URL, token=NETBOX_TOKEN)',
      '# If you have SSL certification validation issues:',
      '# import urllib3; urllib3.disable_warnings(); import requests; session = requests.Session(); session.verify = False; nb.http_session = session',
      ''
    ];

    if (activeTab === 'sites') {
      scriptLines.push('sites = [');
      sites.forEach(s => {
        scriptLines.push(`    {"name": "${s.name}", "slug": "${s.slug}", "status": "${s.status}", "description": "${s.description}"},`);
      });
      scriptLines.push(']');
      scriptLines.push('');
      scriptLines.push('for site_data in sites:');
      scriptLines.push('    try:');
      scriptLines.push('        site = nb.dcim.sites.create(**site_data)');
      scriptLines.push('        print(f"Successfully created site: {site.name}")');
      scriptLines.push('    except Exception as e:');
      scriptLines.push('        print(f"Error creating site {site_data[\'name\']}: {e}")');
    } else if (activeTab === 'racks') {
      scriptLines.push('racks = [');
      racks.forEach(r => {
        scriptLines.push(`    {"site_name": "${r.site}", "name": "${r.name}", "facility_id": "${r.facility_id}", "u_height": ${r.u_height}, "status": "${r.status}"},`);
      });
      scriptLines.push(']');
      scriptLines.push('');
      scriptLines.push('for rack_data in racks:');
      scriptLines.push('    try:');
      scriptLines.push('        # Find the site object first');
      scriptLines.push('        site = nb.dcim.sites.get(name=rack_data["site_name"])');
      scriptLines.push('        if not site:');
      scriptLines.push('            print(f"Site {rack_data[\'site_name\']} not found for rack {rack_data[\'name\']}")');
      scriptLines.push('            continue');
      scriptLines.push('        ');
      scriptLines.push('        nb.dcim.racks.create(');
      scriptLines.push('            site=site.id,');
      scriptLines.push('            name=rack_data["name"],');
      scriptLines.push('            facility_id=rack_data["facility_id"],');
      scriptLines.push('            u_height=rack_data["u_height"],');
      scriptLines.push('            status=rack_data["status"]');
      scriptLines.push('        )');
      scriptLines.push('        print(f"Successfully created rack: {rack_data[\'name\']}")');
      scriptLines.push('    except Exception as e:');
      scriptLines.push('        print(f"Error creating rack {rack_data[\'name\']}: {e}")');
    } else if (activeTab === 'devices') {
      scriptLines.push('devices = [');
      devices.forEach(d => {
        scriptLines.push(`    {"name": "${d.name}", "site_name": "${d.site}", "rack_name": "${d.rack}", "position": ${d.position}, "face": "${d.face}", "device_type_model": "${d.device_type}", "role_name": "${d.role}", "status": "${d.status}"},`);
      });
      scriptLines.push(']');
      scriptLines.push('');
      scriptLines.push('for dev_data in devices:');
      scriptLines.push('    try:');
      scriptLines.push('        site = nb.dcim.sites.get(name=dev_data["site_name"])');
      scriptLines.push('        rack = nb.dcim.racks.get(name=dev_data["rack_name"], site_id=site.id) if dev_data["rack_name"] and site else None');
      scriptLines.push('        # Note: NetBox requires DeviceType and DeviceRole to be pre-provisioned. slug is typically used for lookup');
      scriptLines.push('        dev_type = nb.dcim.device_types.get(model=dev_data["device_type_model"])');
      scriptLines.push('        role = nb.dcim.device_roles.get(name=dev_data["role_name"])');
      scriptLines.push('        ');
      scriptLines.push('        if not (site and dev_type and role):');
      scriptLines.push('            print(f"Dependencies missing for {dev_data[\'name\']} (Site: {site}, Type: {dev_type}, Role: {role})")');
      scriptLines.push('            continue');
      scriptLines.push('            ');
      scriptLines.push('        nb.dcim.devices.create(');
      scriptLines.push('            name=dev_data["name"],');
      scriptLines.push('            site=site.id,');
      scriptLines.push('            rack=rack.id if rack else None,');
      scriptLines.push('            position=dev_data["position"] if rack else None,');
      scriptLines.push('            face=dev_data["face"] if rack else None,');
      scriptLines.push('            device_type=dev_type.id,');
      scriptLines.push('            role=role.id,');
      scriptLines.push('            status=dev_data["status"]');
      scriptLines.push('        )');
      scriptLines.push('        print(f"Successfully created device: {dev_data[\'name\']}")');
      scriptLines.push('    except Exception as e:');
      scriptLines.push('        print(f"Error creating device {dev_data[\'name\']}: {e}")');
    } else if (activeTab === 'interfaces') {
      scriptLines.push('interfaces = [');
      interfaces.forEach(i => {
        scriptLines.push(`    {"device_name": "${i.device}", "name": "${i.name}", "type": "${i.type}", "enabled": ${i.enabled ? 'True' : 'False'}, "mac_address": "${i.mac_address}", "description": "${i.description}"},`);
      });
      scriptLines.push(']');
      scriptLines.push('');
      scriptLines.push('for iface_data in interfaces:');
      scriptLines.push('    try:');
      scriptLines.push('        device = nb.dcim.devices.get(name=iface_data["device_name"])');
      scriptLines.push('        if not device:');
      scriptLines.push('            print(f"Device {iface_data[\'device_name\']} not found for interface {iface_data[\'name\']}")');
      scriptLines.push('            continue');
      scriptLines.push('            ');
      scriptLines.push('        nb.dcim.interfaces.create(');
      scriptLines.push('            device=device.id,');
      scriptLines.push('            name=iface_data["name"],');
      scriptLines.push('            type=iface_data["type"],');
      scriptLines.push('            enabled=iface_data["enabled"],');
      scriptLines.push('            mac_address=iface_data["mac_address"] or None,');
      scriptLines.push('            description=iface_data["description"]');
      scriptLines.push('        )');
      scriptLines.push('        print(f"Successfully created interface {iface_data[\'name\']} on {iface_data[\'device_name\']}")');
      scriptLines.push('    except Exception as e:');
      scriptLines.push('        print(f"Error creating interface {iface_data[\'name\']}: {e}")');
    } else if (activeTab === 'ips') {
      scriptLines.push('ips = [');
      ips.forEach(ip => {
        scriptLines.push(`    {"address": "${ip.address}", "status": "${ip.status}", "vrf_name": "${ip.vrf}", "description": "${ip.description}"},`);
      });
      scriptLines.push(']');
      scriptLines.push('');
      scriptLines.push('for ip_data in ips:');
      scriptLines.push('    try:');
      scriptLines.push('        vrf = nb.ipam.vrfs.get(name=ip_data["vrf_name"]) if ip_data["vrf_name"] and ip_data["vrf_name"] != "global" else None');
      scriptLines.push('        ');
      scriptLines.push('        nb.ipam.ip_addresses.create(');
      scriptLines.push('            address=ip_data["address"],');
      scriptLines.push('            status=ip_data["status"],');
      scriptLines.push('            vrf=vrf.id if vrf else None,');
      scriptLines.push('            description=ip_data["description"]');
      scriptLines.push('        )');
      scriptLines.push('        print(f"Successfully created IP address: {ip_data[\'address\']}")');
      scriptLines.push('    except Exception as e:');
      scriptLines.push('        print(f"Error creating IP {ip_data[\'address\']}: {e}")');
    } else if (activeTab === 'vlans') {
      scriptLines.push('vlans = [');
      vlans.forEach(v => {
        scriptLines.push(`    {"name": "${v.name}", "vid": ${v.vid}, "site_name": "${v.site}", "status": "${v.status}", "description": "${v.description}"},`);
      });
      scriptLines.push(']');
      scriptLines.push('');
      scriptLines.push('for vlan_data in vlans:');
      scriptLines.push('    try:');
      scriptLines.push('        site = nb.dcim.sites.get(name=vlan_data["site_name"]) if vlan_data["site_name"] else None');
      scriptLines.push('        ');
      scriptLines.push('        nb.ipam.vlans.create(');
      scriptLines.push('            name=vlan_data["name"],');
      scriptLines.push('            vid=vlan_data["vid"],');
      scriptLines.push('            site=site.id if site else None,');
      scriptLines.push('            status=vlan_data["status"],');
      scriptLines.push('            description=vlan_data["description"]');
      scriptLines.push('        )');
      scriptLines.push('        print(f"Successfully created VLAN: {vlan_data[\'vid\']} ({vlan_data[\'name\']})")');
      scriptLines.push('    except Exception as e:');
      scriptLines.push('        print(f"Error creating VLAN {vlan_data[\'vid\']}: {e}")');
    } else if (activeTab === 'vrfs') {
      scriptLines.push('vrfs = [');
      vrfs.forEach(v => {
        scriptLines.push(`    {"name": "${v.name}", "rd": "${v.rd}", "description": "${v.description}"},`);
      });
      scriptLines.push(']');
      scriptLines.push('');
      scriptLines.push('for vrf_data in vrfs:');
      scriptLines.push('    try:');
      scriptLines.push('        nb.ipam.vrfs.create(');
      scriptLines.push('            name=vrf_data["name"],');
      scriptLines.push('            rd=vrf_data["rd"] or None,');
      scriptLines.push('            description=vrf_data["description"]');
      scriptLines.push('        )');
      scriptLines.push('        print(f"Successfully created VRF: {vrf_data[\'name\']}")');
      scriptLines.push('    except Exception as e:');
      scriptLines.push('        print(f"Error creating VRF {vrf_data[\'name\']}: {e}")');
    } else if (activeTab === 'circuits') {
      scriptLines.push('circuits = [');
      circuits.forEach(c => {
        scriptLines.push(`    {"cid": "${c.cid}", "provider_name": "${c.provider}", "type_name": "${c.type}", "site_name": "${c.site}", "status": "${c.status}", "description": "${c.description}"},`);
      });
      scriptLines.push(']');
      scriptLines.push('');
      scriptLines.push('for c_data in circuits:');
      scriptLines.push('    try:');
      scriptLines.push('        provider = nb.circuits.providers.get(name=c_data["provider_name"])');
      scriptLines.push('        c_type = nb.circuits.circuit_types.get(name=c_data["type_name"])');
      scriptLines.push('        site = nb.dcim.sites.get(name=c_data["site_name"])');
      scriptLines.push('        ');
      scriptLines.push('        if not (provider and c_type and site):');
      scriptLines.push('            print(f"Dependencies missing for circuit {c_data[\'cid\']} (Provider: {provider}, Type: {c_type}, Site: {site})")');
      scriptLines.push('            continue');
      scriptLines.push('            ');
      scriptLines.push('        nb.circuits.circuits.create(');
      scriptLines.push('            cid=c_data["cid"],');
      scriptLines.push('            provider=provider.id,');
      scriptLines.push('            type=c_type.id,');
      scriptLines.push('            status=c_data["status"],');
      scriptLines.push('            tenant=None,');
      scriptLines.push('            description=c_data["description"]');
      scriptLines.push('        )');
      scriptLines.push('        print(f"Successfully created circuit: {c_data[\'cid\']}")');
      scriptLines.push('    except Exception as e:');
      scriptLines.push('        print(f"Error creating circuit {c_data[\'cid\']}: {e}")');
    }

    return scriptLines.join('\n');
  }, [activeTab, sites, racks, devices, interfaces, ips, vlans, vrfs, circuits]);

  // Export File logic
  const handleExport = useCallback(() => {
    if (outMode === 'csv') {
      const blob = new Blob([csvContent], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `netbox_${activeTab}_import.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } else if (outMode === 'json') {
      const blob = new Blob([jsonContent], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `netbox_${activeTab}_import.json`;
      a.click();
      URL.revokeObjectURL(url);
    } else {
      const blob = new Blob([pythonScript], { type: 'text/x-python' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `import_${activeTab}.py`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [outMode, activeTab, csvContent, jsonContent, pythonScript]);

  const renderActiveForm = () => {
    const errorList = validationErrors[activeTab] || [];
    
    switch (activeTab) {
      case 'sites':
        return (
          <tbody>
            {sites.map((item, idx) => (
              <tr key={item.id}>
                <td>
                  <input className={`input ${errorList[idx]?.name ? 'is-invalid' : ''}`} value={item.name} onChange={e => {
                    updateItem('sites', item.id, 'name', e.target.value);
                    // Auto-slugify
                    const slugified = e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
                    updateItem('sites', item.id, 'slug', slugified);
                  }} placeholder="e.g. NYC-DataCenter" />
                  {errorList[idx]?.name && <span className="hint error-text">{errorList[idx].name}</span>}
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.slug ? 'is-invalid' : ''}`} value={item.slug} onChange={e => updateItem('sites', item.id, 'slug', e.target.value)} placeholder="nyc-dc" />
                  {errorList[idx]?.slug && <span className="hint error-text">{errorList[idx].slug}</span>}
                </td>
                <td>
                  <select className="input" value={item.status} onChange={e => updateItem('sites', item.id, 'status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="planned">Planned</option>
                    <option value="retired">Retired</option>
                  </select>
                </td>
                <td>
                  <input className="input" value={item.description} onChange={e => updateItem('sites', item.id, 'description', e.target.value)} placeholder="Description" />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem('sites', item.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        );
      case 'racks':
        return (
          <tbody>
            {racks.map((item, idx) => (
              <tr key={item.id}>
                <td>
                  <input className={`input ${errorList[idx]?.site ? 'is-invalid' : ''}`} value={item.site} onChange={e => updateItem('racks', item.id, 'site', e.target.value)} placeholder="NYC-DataCenter" />
                  {errorList[idx]?.site && <span className="hint error-text">{errorList[idx].site}</span>}
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.name ? 'is-invalid' : ''}`} value={item.name} onChange={e => updateItem('racks', item.id, 'name', e.target.value)} placeholder="Rack-01" />
                  {errorList[idx]?.name && <span className="hint error-text">{errorList[idx].name}</span>}
                </td>
                <td>
                  <input className="input" value={item.facility_id} onChange={e => updateItem('racks', item.id, 'facility_id', e.target.value)} placeholder="A-102" />
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.u_height ? 'is-invalid' : ''}`} type="number" value={item.u_height} onChange={e => updateItem('racks', item.id, 'u_height', parseInt(e.target.value, 10) || 0)} />
                  {errorList[idx]?.u_height && <span className="hint error-text">{errorList[idx].u_height}</span>}
                </td>
                <td>
                  <select className="input" value={item.status} onChange={e => updateItem('racks', item.id, 'status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="reserved">Reserved</option>
                    <option value="deprecated">Deprecated</option>
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem('racks', item.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        );
      case 'devices':
        return (
          <tbody>
            {devices.map((item, idx) => (
              <tr key={item.id}>
                <td>
                  <input className={`input ${errorList[idx]?.name ? 'is-invalid' : ''}`} value={item.name} onChange={e => updateItem('devices', item.id, 'name', e.target.value)} placeholder="nyc-rt01" />
                  {errorList[idx]?.name && <span className="hint error-text">{errorList[idx].name}</span>}
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.site ? 'is-invalid' : ''}`} value={item.site} onChange={e => updateItem('devices', item.id, 'site', e.target.value)} placeholder="NYC-DataCenter" />
                  {errorList[idx]?.site && <span className="hint error-text">{errorList[idx].site}</span>}
                </td>
                <td>
                  <input className="input" value={item.rack} onChange={e => updateItem('devices', item.id, 'rack', e.target.value)} placeholder="Rack-A1" />
                </td>
                <td>
                  <input className="input" type="number" value={item.position} onChange={e => updateItem('devices', item.id, 'position', parseInt(e.target.value, 10) || 0)} style={{ width: 65 }} />
                </td>
                <td>
                  <select className="input" value={item.face} onChange={e => updateItem('devices', item.id, 'face', e.target.value)} style={{ width: 85 }}>
                    <option value="front">Front</option>
                    <option value="rear">Rear</option>
                  </select>
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.device_type ? 'is-invalid' : ''}`} value={item.device_type} onChange={e => updateItem('devices', item.id, 'device_type', e.target.value)} placeholder="cisco-c9300-48t" />
                  {errorList[idx]?.device_type && <span className="hint error-text">{errorList[idx].device_type}</span>}
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.role ? 'is-invalid' : ''}`} value={item.role} onChange={e => updateItem('devices', item.id, 'role', e.target.value)} placeholder="core-switch" />
                  {errorList[idx]?.role && <span className="hint error-text">{errorList[idx].role}</span>}
                </td>
                <td>
                  <select className="input" value={item.status} onChange={e => updateItem('devices', item.id, 'status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="staged">Staged</option>
                    <option value="failed">Failed</option>
                    <option value="offline">Offline</option>
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem('devices', item.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        );
      case 'interfaces':
        return (
          <tbody>
            {interfaces.map((item, idx) => (
              <tr key={item.id}>
                <td>
                  <input className={`input ${errorList[idx]?.device ? 'is-invalid' : ''}`} value={item.device} onChange={e => updateItem('interfaces', item.id, 'device', e.target.value)} placeholder="nyc-core-sw01" />
                  {errorList[idx]?.device && <span className="hint error-text">{errorList[idx].device}</span>}
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.name ? 'is-invalid' : ''}`} value={item.name} onChange={e => updateItem('interfaces', item.id, 'name', e.target.value)} placeholder="GigabitEthernet1/0/1" />
                  {errorList[idx]?.name && <span className="hint error-text">{errorList[idx].name}</span>}
                </td>
                <td>
                  <select className="input" value={item.type} onChange={e => updateItem('interfaces', item.id, 'type', e.target.value)}>
                    <option value="1000base-t">1G Base-T</option>
                    <option value="10gbase-x-sfpp">10G SFP+</option>
                    <option value="25gbase-x-sfp28">25G SFP28</option>
                    <option value="40gbase-x-qsfpp">40G QSFP+</option>
                    <option value="100gbase-x-qsfp28">100G QSFP28</option>
                    <option value="virtual">Virtual (SVI/Loopback)</option>
                    <option value="lag">Link Aggregation (LAG)</option>
                  </select>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <input type="checkbox" checked={item.enabled} onChange={e => updateItem('interfaces', item.id, 'enabled', e.target.checked)} />
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.mac_address ? 'is-invalid' : ''}`} value={item.mac_address} onChange={e => updateItem('interfaces', item.id, 'mac_address', e.target.value)} placeholder="00:11:22:aa:bb:cc" />
                  {errorList[idx]?.mac_address && <span className="hint error-text">{errorList[idx].mac_address}</span>}
                </td>
                <td>
                  <input className="input" value={item.description} onChange={e => updateItem('interfaces', item.id, 'description', e.target.value)} placeholder="Uplink" />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem('interfaces', item.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        );
      case 'ips':
        return (
          <tbody>
            {ips.map((item, idx) => (
              <tr key={item.id}>
                <td>
                  <input className={`input ${errorList[idx]?.address ? 'is-invalid' : ''}`} value={item.address} onChange={e => updateItem('ips', item.id, 'address', e.target.value)} placeholder="10.0.0.1/24" />
                  {errorList[idx]?.address && <span className="hint error-text">{errorList[idx].address}</span>}
                </td>
                <td>
                  <select className="input" value={item.status} onChange={e => updateItem('ips', item.id, 'status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="reserved">Reserved</option>
                    <option value="deprecated">Deprecated</option>
                    <option value="dhcp">DHCP</option>
                  </select>
                </td>
                <td>
                  <input className="input" value={item.vrf} onChange={e => updateItem('ips', item.id, 'vrf', e.target.value)} placeholder="production (or blank)" />
                </td>
                <td>
                  <input className="input" value={item.description} onChange={e => updateItem('ips', item.id, 'description', e.target.value)} placeholder="Router Loopback" />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem('ips', item.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        );
      case 'vlans':
        return (
          <tbody>
            {vlans.map((item, idx) => (
              <tr key={item.id}>
                <td>
                  <input className={`input ${errorList[idx]?.vid ? 'is-invalid' : ''}`} type="number" value={item.vid} onChange={e => updateItem('vlans', item.id, 'vid', parseInt(e.target.value, 10) || 0)} style={{ width: 80 }} />
                  {errorList[idx]?.vid && <span className="hint error-text">{errorList[idx].vid}</span>}
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.name ? 'is-invalid' : ''}`} value={item.name} onChange={e => updateItem('vlans', item.id, 'name', e.target.value)} placeholder="Web-Traffic" />
                  {errorList[idx]?.name && <span className="hint error-text">{errorList[idx].name}</span>}
                </td>
                <td>
                  <input className="input" value={item.site} onChange={e => updateItem('vlans', item.id, 'site', e.target.value)} placeholder="NYC-DataCenter" />
                </td>
                <td>
                  <select className="input" value={item.status} onChange={e => updateItem('vlans', item.id, 'status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="reserved">Reserved</option>
                    <option value="deprecating">Deprecating</option>
                  </select>
                </td>
                <td>
                  <input className="input" value={item.description} onChange={e => updateItem('vlans', item.id, 'description', e.target.value)} placeholder="Client Access Network" />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem('vlans', item.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        );
      case 'vrfs':
        return (
          <tbody>
            {vrfs.map((item, idx) => (
              <tr key={item.id}>
                <td>
                  <input className={`input ${errorList[idx]?.name ? 'is-invalid' : ''}`} value={item.name} onChange={e => updateItem('vrfs', item.id, 'name', e.target.value)} placeholder="production" />
                  {errorList[idx]?.name && <span className="hint error-text">{errorList[idx].name}</span>}
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.rd ? 'is-invalid' : ''}`} value={item.rd} onChange={e => updateItem('vrfs', item.id, 'rd', e.target.value)} placeholder="65000:100" />
                  {errorList[idx]?.rd && <span className="hint error-text">{errorList[idx].rd}</span>}
                </td>
                <td>
                  <input className="input" value={item.description} onChange={e => updateItem('vrfs', item.id, 'description', e.target.value)} placeholder="VRF description" />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem('vrfs', item.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        );
      case 'circuits':
        return (
          <tbody>
            {circuits.map((item, idx) => (
              <tr key={item.id}>
                <td>
                  <input className={`input ${errorList[idx]?.cid ? 'is-invalid' : ''}`} value={item.cid} onChange={e => updateItem('circuits', item.id, 'cid', e.target.value)} placeholder="CKT-12345" />
                  {errorList[idx]?.cid && <span className="hint error-text">{errorList[idx].cid}</span>}
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.provider ? 'is-invalid' : ''}`} value={item.provider} onChange={e => updateItem('circuits', item.id, 'provider', e.target.value)} placeholder="Verizon" />
                  {errorList[idx]?.provider && <span className="hint error-text">{errorList[idx].provider}</span>}
                </td>
                <td>
                  <select className="input" value={item.type} onChange={e => updateItem('circuits', item.id, 'type', e.target.value)}>
                    <option value="direct-internet-access">DIA (Direct Internet)</option>
                    <option value="mpls-backbone">MPLS Backbone</option>
                    <option value="dark-fiber">Dark Fiber</option>
                    <option value="point-to-point">Point-to-Point Private Line</option>
                  </select>
                </td>
                <td>
                  <input className={`input ${errorList[idx]?.site ? 'is-invalid' : ''}`} value={item.site} onChange={e => updateItem('circuits', item.id, 'site', e.target.value)} placeholder="NYC-DataCenter" />
                  {errorList[idx]?.site && <span className="hint error-text">{errorList[idx].site}</span>}
                </td>
                <td>
                  <select className="input" value={item.status} onChange={e => updateItem('circuits', item.id, 'status', e.target.value)}>
                    <option value="active">Active</option>
                    <option value="planned">Planned</option>
                    <option value="decommissioned">Decommissioned</option>
                  </select>
                </td>
                <td>
                  <input className="input" value={item.description} onChange={e => updateItem('circuits', item.id, 'description', e.target.value)} placeholder="Backup Internet Link" />
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button className="btn btn-sm btn-danger" onClick={() => removeItem('circuits', item.id)}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        );
      default:
        return null;
    }
  };

  const getHeaders = () => {
    switch (activeTab) {
      case 'sites':
        return [
          t('netbox_import.th_name', 'Name *'),
          t('netbox_import.th_slug', 'Slug *'),
          t('netbox_import.th_status', 'Status'),
          t('netbox_import.th_desc', 'Description'),
          t('netbox_import.th_action', 'Delete')
        ];
      case 'racks':
        return [
          t('netbox_import.th_site', 'Site *'),
          t('netbox_import.th_name', 'Name *'),
          t('netbox_import.th_facility', 'Facility ID'),
          t('netbox_import.th_height', 'U Height'),
          t('netbox_import.th_status', 'Status'),
          t('netbox_import.th_action', 'Delete')
        ];
      case 'devices':
        return [
          t('netbox_import.th_name', 'Name *'),
          t('netbox_import.th_site', 'Site *'),
          t('netbox_import.th_rack', 'Rack'),
          t('netbox_import.th_pos', 'U Position'),
          t('netbox_import.th_face', 'Face'),
          t('netbox_import.th_dev_type', 'Device Model *'),
          t('netbox_import.th_role', 'Device Role *'),
          t('netbox_import.th_status', 'Status'),
          t('netbox_import.th_action', 'Delete')
        ];
      case 'interfaces':
        return [
          t('netbox_import.th_device', 'Device *'),
          t('netbox_import.th_name', 'Name *'),
          t('netbox_import.th_type', 'Type'),
          t('netbox_import.th_enabled', 'Enabled'),
          t('netbox_import.th_mac', 'MAC Address'),
          t('netbox_import.th_desc', 'Description'),
          t('netbox_import.th_action', 'Delete')
        ];
      case 'ips':
        return [
          t('netbox_import.th_ip', 'IP Address *'),
          t('netbox_import.th_status', 'Status'),
          t('netbox_import.th_vrf', 'VRF'),
          t('netbox_import.th_desc', 'Description'),
          t('netbox_import.th_action', 'Delete')
        ];
      case 'vlans':
        return [
          t('netbox_import.th_vid', 'VID *'),
          t('netbox_import.th_name', 'Name *'),
          t('netbox_import.th_site', 'Site'),
          t('netbox_import.th_status', 'Status'),
          t('netbox_import.th_desc', 'Description'),
          t('netbox_import.th_action', 'Delete')
        ];
      case 'vrfs':
        return [
          t('netbox_import.th_name', 'Name *'),
          t('netbox_import.th_rd', 'Route Target (RD)'),
          t('netbox_import.th_desc', 'Description'),
          t('netbox_import.th_action', 'Delete')
        ];
      case 'circuits':
        return [
          t('netbox_import.th_cid', 'Circuit ID *'),
          t('netbox_import.th_provider', 'Provider *'),
          t('netbox_import.th_type', 'Type'),
          t('netbox_import.th_site', 'Site *'),
          t('netbox_import.th_status', 'Status'),
          t('netbox_import.th_desc', 'Description'),
          t('netbox_import.th_action', 'Delete')
        ];
      default:
        return [];
    }
  };

  const activeContent = useMemo(() => {
    if (outMode === 'csv') return csvContent;
    if (outMode === 'json') return jsonContent;
    return pythonScript;
  }, [outMode, csvContent, jsonContent, pythonScript]);

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('netbox_import.title', 'NetBox / Nautobot Inventory Import Builder')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 16 }}>
          {t('netbox_import.subtitle', 'Build and validate inventory spreadsheets or configuration files for NetBox/Nautobot DCIM/IPAM bulk imports.')}
        </p>

        {/* Inventory Category Selection Tabs */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
          {INVENTORY_CATEGORIES.map(cat => {
            const hasCatErrors = validationErrors[cat.id]?.some(x => Object.keys(x).length > 0);
            return (
              <button
                key={cat.id}
                className={`btn btn-sm ${activeTab === cat.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveTab(cat.id)}
                style={{ position: 'relative' }}
              >
                {cat.label}
                {hasCatErrors && (
                  <span style={{
                    position: 'absolute',
                    top: -4,
                    right: -4,
                    background: 'var(--red)',
                    width: 8,
                    height: 8,
                    borderRadius: '50%'
                  }} />
                )}
              </button>
            );
          })}
        </div>

        <div className="two-col grid-mobile-1" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 16 }}>
          {/* Builder spreadsheet grid */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontWeight: 600, color: 'var(--cyan)' }}>
                {INVENTORY_CATEGORIES.find(c => c.id === activeTab)?.label} List
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-sm" onClick={() => addItem(activeTab)}>
                  + {t('netbox_import.add_row', 'Add Row')}
                </button>
                <button className="btn btn-sm btn-ghost" onClick={() => resetDefault(activeTab)}>
                  {t('netbox_import.reset_defaults', 'Reset Defaults')}
                </button>
                <button className="btn btn-sm btn-danger" onClick={() => clearAll(activeTab)}>
                  {t('netbox_import.clear_all', 'Clear')}
                </button>
              </div>
            </div>

            <div style={{ overflowX: 'auto', background: 'var(--panel)', borderRadius: 8, border: '1px solid var(--border)', padding: 4 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }} className="spreadsheet-table">
                <thead>
                  <tr style={{ borderBottom: '2px solid var(--border)', textAlign: 'left' }}>
                    {getHeaders().map((h, i) => (
                      <th key={i} style={{ padding: '8px 6px', fontWeight: 600, color: 'var(--muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                {renderActiveForm()}
              </table>
            </div>

            {hasAnyError && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(239, 83, 80, 0.1)', borderLeft: '4px solid var(--red)', borderRadius: 4, fontSize: 13, color: 'var(--red)' }}>
                ⚠ {t('netbox_import.errors_found', 'Validation errors found. Fix invalid fields to ensure clean imports.')}
              </div>
            )}
            {!hasAnyError && (
              <div style={{ marginTop: 12, padding: 10, background: 'rgba(102, 187, 106, 0.1)', borderLeft: '4px solid var(--green)', borderRadius: 4, fontSize: 13, color: 'var(--green)' }}>
                ✓ {t('netbox_import.all_valid', 'Validation passed! No errors detected.')}
              </div>
            )}
          </div>

          {/* Outputs */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px 12px', marginBottom: 12 }}>
              <div style={{ fontWeight: 600, color: 'var(--cyan)' }}>{t('netbox_import.generated_output', 'Generated Output')}</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <button className={`btn btn-sm ${outMode === 'csv' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOutMode('csv')}>CSV</button>
                <button className={`btn btn-sm ${outMode === 'json' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOutMode('json')}>JSON</button>
                <button className={`btn btn-sm ${outMode === 'python' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setOutMode('python')}>pynetbox</button>
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
                minHeight: 340,
                maxHeight: 480,
                margin: 0
              }}>
                {activeContent}
              </pre>

              <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 6 }}>
                <CopyBtn text={activeContent} />
                <button className="copy-btn" onClick={handleExport} title={t('common.export', 'Export File')}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="7 10 12 15 17 10" />
                    <line x1="12" y1="15" x2="12" y2="3" />
                  </svg>
                </button>
              </div>
            </div>

            <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', background: 'var(--panel)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
              <strong>Tips:</strong>
              <ul style={{ paddingLeft: 18, margin: '4px 0 0 0' }}>
                {outMode === 'csv' && (
                  <li>Copy and paste directly into the NetBox bulk import textarea or save as a CSV file to upload.</li>
                )}
                {outMode === 'json' && (
                  <li>Suitable for NetBox API payloads and Ansible/Terraform inventory data sources.</li>
                )}
                {outMode === 'python' && (
                  <li>Run the Python script locally to programmatically inject this data. Make sure you install <code>pynetbox</code> and set your URL & Token.</li>
                )}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

window.NetboxImport = NetboxImport;
