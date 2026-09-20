const { useState, useEffect, useCallback, useMemo } = React;

function TerraformBuilder({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  // State management
  const [provider, setProvider] = usePersistentState('tf:provider', initialData?.provider ?? 'aws');
  const [resource, setResource] = usePersistentState('tf:resource', initialData?.resource ?? 'aws_vpc_multi_subnet');
  const [params, setParams] = usePersistentState('tf:params', initialData?.params ?? {});

  // Presets default parameters
  const defaultParams = useMemo(() => ({
    // ACI
    aci_tenant: { tenant_name: 'prod_tenant' },
    aci_vrf: { tenant_name: 'prod_tenant', vrf_name: 'prod_vrf' },
    aci_bd: { tenant_name: 'prod_tenant', bd_name: 'web_bd', vrf_name: 'prod_vrf', gateway_ip: '10.100.1.1/24' },
    aci_epg: { tenant_name: 'prod_tenant', app_profile: 'ecommerce_app', epg_name: 'web_epg', bd_name: 'web_bd', vlan_id: '100' },
    aci_tenant_vrf_bd_epg: { tenant_name: 'prod_tenant', vrf_name: 'prod_vrf', bd_name: 'web_bd', gateway_ip: '10.100.1.1/24', app_profile: 'ecommerce_app', epg_name: 'web_epg', vlan_id: '100' },
    aci_contract: { tenant_name: 'prod_tenant', contract_name: 'web-contract', subject_name: 'web-subject', filter_name: 'web-filter', dest_port: '80' },
    aci_l3out:    { tenant_name: 'prod_tenant', vrf_name: 'prod_vrf', l3out_name: 'l3out-dc', node_profile: 'border-leaf', ext_epg_name: 'ext-epg', ext_subnet: '0.0.0.0/0' },

    // ASA
    asa_access_rules: { rules: 'permit ip any any\npermit tcp any host 192.168.1.50 eq 443\ndeny udp any any eq 53' },
    asa_static_route: { route_name: 'outside_default', interface: 'outside', dest_prefix: '0.0.0.0/0', next_hop: '203.0.113.1' },
    asa_nat: { nat_name: 'nat-outside', src_interface: 'inside', dst_interface: 'outside', real_ip: '192.168.1.10', mapped_ip: '203.0.113.50' },

    // Nexus (DCNM)
    nexus_vrf_network: { fabric_name: 'vxlan_fabric', vrf_name: 'tenant_a_vrf', network_name: 'web_network', gateway_ip: '192.168.10.1/24', vlan: '1010' },
    nexus_bgp: { fabric_name: 'vxlan_fabric', switch_name: 'leaf-101', asn: '65001', peer_ip: '10.1.1.2', peer_asn: '65002' },

    // AWS
    aws_vpc: { vpc_name: 'prod-vpc', vpc_cidr: '10.0.0.0/16', region: 'us-east-1' },
    aws_subnet: { vpc_name: 'prod-vpc', subnet_cidr: '10.0.1.0/24', region: 'us-east-1' },
    aws_sg: { security_group_name: 'web-sg', vpc_name: 'prod-vpc', rules: '80,tcp,0.0.0.0/0\n443,tcp,0.0.0.0/0\n22,tcp,203.0.113.50/32' },
    aws_vpc_multi_subnet: { vpc_name: 'prod-vpc', vpc_cidr: '10.0.0.0/16', subnet_public_cidr: '10.0.1.0/24', subnet_private_cidr: '10.0.2.0/24', region: 'us-east-1', security_group_name: 'web-sg' },
    aws_tgw:         { tgw_name: 'prod-tgw', amazon_asn: '64512', region: 'us-east-1' },
    aws_nat_gw:      { nat_name: 'prod-nat-gw', subnet_name: 'public', region: 'us-east-1' },
    aws_vpc_peering: { peering_name: 'prod-vpc-peering', vpc_id: 'vpc-aaaa1111', peer_vpc_id: 'vpc-bbbb2222', region: 'us-east-1' },
    aws_alb:         { alb_name: 'prod-alb', vpc_name: 'prod-vpc', subnet_ids: 'subnet-aaa111,subnet-bbb222', region: 'us-east-1' },

    // Azure
    azurerm_vnet: { vpc_name: 'prod-vnet', address_space: '10.0.0.0/16', region: 'eastus' },
    azurerm_nsg: { security_group_name: 'web-nsg', rules: '100,Inbound,Allow,Tcp,80,Internet\n110,Inbound,Allow,Tcp,443,Internet\n120,Inbound,Allow,Tcp,22,203.0.113.50' },
    azurerm_vnet_subnets: { vpc_name: 'prod-vnet', address_space: '10.0.0.0/16', subnet_public_cidr: '10.0.1.0/24', subnet_private_cidr: '10.0.2.0/24', region: 'eastus', security_group_name: 'web-nsg' },
    azurerm_aks:              { cluster_name: 'prod-aks', resource_group: 'rg-prod', region: 'eastus', node_count: '2' },
    azurerm_app_gateway:      { appgw_name: 'prod-appgw', resource_group: 'rg-prod', region: 'eastus', subnet_name: 'appgw-subnet' },
    azurerm_private_endpoint: { endpoint_name: 'prod-pe', resource_group: 'rg-prod', region: 'eastus', subnet_name: 'pe-subnet', target_resource_id: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-prod/providers/Microsoft.KeyVault/vaults/prod-kv' },
    azurerm_firewall:         { fw_name: 'prod-firewall', resource_group: 'rg-prod', region: 'eastus', subnet_name: 'AzureFirewallSubnet' },

    // GCP
    google_network: { vpc_name: 'prod-vpc-network', gcp_project: 'my-gcp-project-123' },
    google_subnetwork: { vpc_name: 'prod-vpc-network', subnet_cidr: '10.0.1.0/24', region: 'us-central1', gcp_project: 'my-gcp-project-123' },
    google_firewall: { firewall_name: 'allow-web', vpc_name: 'prod-vpc-network', rules: 'tcp:80,tcp:443', gcp_project: 'my-gcp-project-123' },
    google_vpc_custom: { vpc_name: 'prod-vpc-network', subnets_list: 'subnet-us=10.0.1.0/24,us-central1\nsubnet-eu=10.0.2.0/24,europe-west1', firewall_name: 'allow-web-traffic', gcp_project: 'my-gcp-project-123' }
  }), []);

  const providerResources = useMemo(() => ({
    aci: [
      { value: 'aci_tenant_vrf_bd_epg', label: t('terraform_builder.res_aci_tenant_vrf_bd_epg') },
      { value: 'aci_tenant',            label: t('terraform_builder.res_aci_tenant') },
      { value: 'aci_vrf',               label: t('terraform_builder.res_aci_vrf') },
      { value: 'aci_bd',                label: t('terraform_builder.res_aci_bd') },
      { value: 'aci_epg',               label: t('terraform_builder.res_aci_epg') },
      { value: 'aci_contract',          label: t('terraform_builder.res_aci_contract') },
      { value: 'aci_l3out',             label: t('terraform_builder.res_aci_l3out') },
    ],
    asa: [
      { value: 'asa_access_rules',  label: t('terraform_builder.res_asa_access_rules') },
      { value: 'asa_static_route',  label: t('terraform_builder.res_asa_static_route') },
      { value: 'asa_nat',           label: t('terraform_builder.res_asa_nat') },
    ],
    nexus: [
      { value: 'nexus_vrf_network', label: t('terraform_builder.res_nexus_vrf_network') },
      { value: 'nexus_bgp',         label: t('terraform_builder.res_nexus_bgp') },
    ],
    aws: [
      { value: 'aws_vpc_multi_subnet', label: t('terraform_builder.res_aws_vpc_multi_subnet') },
      { value: 'aws_vpc',              label: t('terraform_builder.res_aws_vpc') },
      { value: 'aws_subnet',           label: t('terraform_builder.res_aws_subnet') },
      { value: 'aws_sg',               label: t('terraform_builder.res_aws_sg') },
      { value: 'aws_tgw',              label: t('terraform_builder.res_aws_tgw') },
      { value: 'aws_nat_gw',           label: t('terraform_builder.res_aws_nat_gw') },
      { value: 'aws_vpc_peering',      label: t('terraform_builder.res_aws_vpc_peering') },
      { value: 'aws_alb',              label: t('terraform_builder.res_aws_alb') },
    ],
    azure: [
      { value: 'azurerm_vnet_subnets',      label: t('terraform_builder.res_azure_vnet_subnets') },
      { value: 'azurerm_vnet',              label: t('terraform_builder.res_azure_vnet') },
      { value: 'azurerm_nsg',               label: t('terraform_builder.res_azure_nsg') },
      { value: 'azurerm_aks',               label: t('terraform_builder.res_azure_aks') },
      { value: 'azurerm_app_gateway',       label: t('terraform_builder.res_azure_app_gateway') },
      { value: 'azurerm_private_endpoint',  label: t('terraform_builder.res_azure_private_endpoint') },
      { value: 'azurerm_firewall',          label: t('terraform_builder.res_azure_firewall') },
    ],
    gcp: [
      { value: 'google_vpc_custom',  label: t('terraform_builder.res_gcp_vpc_custom') },
      { value: 'google_network',     label: t('terraform_builder.res_gcp_network') },
      { value: 'google_subnetwork',  label: t('terraform_builder.res_gcp_subnetwork') },
      { value: 'google_firewall',    label: t('terraform_builder.res_gcp_firewall') },
    ],
  }), [t]);

  // Update parameters when resource preset changes
  useEffect(() => {
    // Check if current parameters match the template keys, if not, reset to defaults
    const keys = Object.keys(defaultParams[resource] || {});
    const matches = keys.every(k => params[k] !== undefined);
    if (!matches) {
      setParams(defaultParams[resource] || {});
    }
  }, [resource, params, defaultParams, setParams]);

  // Wire into share URL system
  useEffect(() => {
    const handleShareRequest = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'terraform-builder',
        provider,
        resource,
        params
      });
    };
    window.addEventListener('app:request-share', handleShareRequest);
    return () => window.removeEventListener('app:request-share', handleShareRequest);
  }, [provider, resource, params, onShare]);

  // Report-up: provider change → sidebar highlight follows
  useEffect(() => { onNav?.({ provider }); }, [provider]);

  // Restore state on load
  useEffect(() => {
    if (initialData) {
      if (initialData.provider !== undefined) {
        if (initialData.resource === undefined) {
          // Sidebar sub-row navigation — switch provider and reset to its default resource
          handleProviderChange(initialData.provider);
        } else {
          setProvider(initialData.provider);
        }
      }
      if (initialData.resource !== undefined) setResource(initialData.resource);
      if (initialData.params !== undefined) setParams(initialData.params);
    }
  }, [initialData]);

  // Handle provider changes & switch default resource
  const handleProviderChange = (p) => {
    setProvider(p);
    let defaultRes = 'aws_vpc_multi_subnet';
    if (p === 'aci') defaultRes = 'aci_tenant_vrf_bd_epg';
    else if (p === 'asa') defaultRes = 'asa_access_rules';
    else if (p === 'nexus') defaultRes = 'nexus_vrf_network';
    else if (p === 'azure') defaultRes = 'azurerm_vnet_subnets';
    else if (p === 'gcp') defaultRes = 'google_vpc_custom';
    
    setResource(defaultRes);
    setParams(defaultParams[defaultRes] || {});
  };

  const setParam = (key, val) => {
    setParams(p => ({ ...p, [key]: val }));
  };

  // Generate HCL Content
  const generatedHCL = useMemo(() => {
    const p = params;
    
    switch (resource) {
      // ─── CISCO ACI ────────────────────────────────────────────────
      case 'aci_tenant':
        return `# Configure Cisco ACI Provider
terraform {
  required_providers {
    aci = {
      source = "CiscoDevNet/aci"
    }
  }
}

resource "aci_tenant" "${p.tenant_name || 'tenant'}" {
  name        = "${p.tenant_name || 'prod_tenant'}"
  description = "Tenant provisioned by NetEngKit"
}`;

      case 'aci_vrf':
        return `resource "aci_vrf" "${p.vrf_name || 'vrf'}" {
  tenant_dn   = aci_tenant.${p.tenant_name || 'tenant'}.id
  name        = "${p.vrf_name || 'prod_vrf'}"
  description = "VRF created by NetEngKit"
}`;

      case 'aci_bd':
        return `resource "aci_bridge_domain" "${p.bd_name || 'bd'}" {
  tenant_dn          = aci_tenant.${p.tenant_name || 'tenant'}.id
  relation_fv_rs_ctx = aci_vrf.${p.vrf_name || 'vrf'}.id
  name               = "${p.bd_name || 'web_bd'}"
}

resource "aci_subnet" "${p.bd_name || 'bd'}_subnet" {
  parent_dn = aci_bridge_domain.${p.bd_name || 'bd'}.id
  ip        = "${p.gateway_ip || '10.100.1.1/24'}"
  scope     = ["public", "shared"]
}`;

      case 'aci_epg':
        return `resource "aci_application_profile" "${p.app_profile || 'ap'}" {
  tenant_dn = aci_tenant.${p.tenant_name || 'tenant'}.id
  name      = "${p.app_profile || 'ecommerce_app'}"
}

resource "aci_application_epg" "${p.epg_name || 'epg'}" {
  application_profile_dn = aci_application_profile.${p.app_profile || 'ap'}.id
  name                   = "${p.epg_name || 'web_epg'}"
  relation_fv_rs_bd      = aci_bridge_domain.${p.bd_name || 'bd'}.id
}

# VLAN encap link static binding
resource "aci_epg_to_static_path" "epg_path" {
  application_epg_dn = aci_application_epg.${p.epg_name || 'epg'}.id
  encap              = "vlan-${p.vlan_id || '100'}"
  # Specify your path DN below (e.g. topology/pod-1/paths-101/pathep-[eth1/10])
  tdn                = "topology/pod-1/paths-101/pathep-[eth1/10]"
  mode               = "regular"
}`;

      case 'aci_tenant_vrf_bd_epg':
        return `# Cisco ACI - Application Stack Configuration
# Tenant -> VRF -> Bridge Domain -> Application Profile -> EPG

resource "aci_tenant" "${p.tenant_name || 'tenant'}" {
  name = "${p.tenant_name || 'prod_tenant'}"
}

resource "aci_vrf" "${p.vrf_name || 'vrf'}" {
  tenant_dn = aci_tenant.${p.tenant_name || 'tenant'}.id
  name      = "${p.vrf_name || 'prod_vrf'}"
}

resource "aci_bridge_domain" "${p.bd_name || 'bd'}" {
  tenant_dn          = aci_tenant.${p.tenant_name || 'tenant'}.id
  relation_fv_rs_ctx = aci_vrf.${p.vrf_name || 'vrf'}.id
  name               = "${p.bd_name || 'web_bd'}"
}

resource "aci_subnet" "${p.bd_name || 'bd'}_subnet" {
  parent_dn = aci_bridge_domain.${p.bd_name || 'bd'}.id
  ip        = "${p.gateway_ip || '10.100.1.1/24'}"
  scope     = ["public", "shared"]
}

resource "aci_application_profile" "${p.app_profile || 'ap'}" {
  tenant_dn = aci_tenant.${p.tenant_name || 'tenant'}.id
  name      = "${p.app_profile || 'ecommerce_app'}"
}

resource "aci_application_epg" "${p.epg_name || 'epg'}" {
  application_profile_dn = aci_application_profile.${p.app_profile || 'ap'}.id
  name                   = "${p.epg_name || 'web_epg'}"
  relation_fv_rs_bd      = aci_bridge_domain.${p.bd_name || 'bd'}.id
}

resource "aci_epg_to_static_path" "epg_path" {
  application_epg_dn = aci_application_epg.${p.epg_name || 'epg'}.id
  encap              = "vlan-${p.vlan_id || '100'}"
  tdn                = "topology/pod-1/paths-101/pathep-[eth1/10]"
  mode               = "regular"
}`;

      case 'aci_contract':
        return `resource "aci_filter" "${p.filter_name || 'web-filter'}" {
  tenant_dn = aci_tenant.${p.tenant_name || 'prod_tenant'}.id
  name      = "${p.filter_name || 'web-filter'}"
}

resource "aci_filter_entry" "filter_entry" {
  filter_dn   = aci_filter.${p.filter_name || 'web-filter'}.id
  name        = "port-entry"
  ether_t     = "ipv4"
  prot        = "tcp"
  d_from_port = "${p.dest_port || '80'}"
  d_to_port   = "${p.dest_port || '80'}"
}

resource "aci_contract" "${p.contract_name || 'web-contract'}" {
  tenant_dn = aci_tenant.${p.tenant_name || 'prod_tenant'}.id
  name      = "${p.contract_name || 'web-contract'}"
}

resource "aci_contract_subject" "${p.subject_name || 'web-subject'}" {
  contract_dn                  = aci_contract.${p.contract_name || 'web-contract'}.id
  name                         = "${p.subject_name || 'web-subject'}"
  relation_vz_rs_subj_filt_att = [aci_filter.${p.filter_name || 'web-filter'}.id]
}`;

      case 'aci_l3out':
        return `resource "aci_l3_outside" "${p.l3out_name || 'l3out-dc'}" {
  tenant_dn              = aci_tenant.${p.tenant_name || 'prod_tenant'}.id
  name                   = "${p.l3out_name || 'l3out-dc'}"
  relation_l3ext_rs_ectx = aci_vrf.${p.vrf_name || 'prod_vrf'}.id
}

resource "aci_logical_node_profile" "${p.node_profile || 'border-leaf'}" {
  l3_outside_dn = aci_l3_outside.${p.l3out_name || 'l3out-dc'}.id
  name          = "${p.node_profile || 'border-leaf'}"
}

resource "aci_external_network_instance_profile" "${p.ext_epg_name || 'ext-epg'}" {
  l3_outside_dn = aci_l3_outside.${p.l3out_name || 'l3out-dc'}.id
  name          = "${p.ext_epg_name || 'ext-epg'}"
}

resource "aci_l3_ext_subnet" "ext_subnet" {
  external_network_instance_profile_dn = aci_external_network_instance_profile.${p.ext_epg_name || 'ext-epg'}.id
  ip                                   = "${p.ext_subnet || '0.0.0.0/0'}"
  scope                                = ["import-security"]
}`;

      // ─── CISCO ASA ────────────────────────────────────────────────
      case 'asa_access_rules':
        const asaRules = (p.rules || '').split('\n').map(r => r.trim()).filter(Boolean);
        let rulesHCL = '';
        asaRules.forEach((rule, index) => {
          const parts = rule.split(/\s+/);
          const action = parts[0] || 'permit';
          const proto = parts[1] || 'ip';
          const src = parts[2] || 'any';
          let destIndex = 3;
          let srcHost = '';
          
          if (src === 'host') {
            srcHost = parts[3];
            destIndex = 4;
          }

          const dest = parts[destIndex] || 'any';
          let destHost = '';
          let portIndex = destIndex + 1;
          
          if (dest === 'host') {
            destHost = parts[destIndex + 1];
            portIndex = destIndex + 2;
          }

          const eqOperator = parts[portIndex];
          const port = eqOperator === 'eq' ? parts[portIndex + 1] : '';

          const isPermit = action.toLowerCase() === 'permit';
          const srcAddr = (srcHost || src) === 'any' ? 'any4' : (srcHost || src);
          const dstAddr = (destHost || dest) === 'any' ? 'any4' : (destHost || dest);
          const svcStr = port ? `${proto}/${port}` : proto;

          rulesHCL += `resource "ciscoasa_access_in_rules" "rule_${index}" {
  interface = "outside"
  rule {
    permit              = ${isPermit}
    source              = "${srcAddr}"
    source_service      = ""
    destination         = "${dstAddr}"
    destination_service = "${svcStr}"
    active              = true
  }
}\n\n`;
        });
        return `# Cisco ASA Access Control List Rules
# Requires ciscoasa provider setup

${rulesHCL.trim()}`;

      case 'asa_static_route':
        return `resource "ciscoasa_static_route" "${p.route_name || 'static_route'}" {
  interface = "${p.interface || 'outside'}"
  network   = "${p.dest_prefix || '0.0.0.0/0'}"
  gateway   = "${p.next_hop || '203.0.113.1'}"
  metric    = 1
}`;

      case 'asa_nat':
        return `# Requires ciscoasa provider: registry.terraform.io/CiscoDevNet/ciscoasa

resource "ciscoasa_nat" "${p.nat_name || 'nat-outside'}" {
  section                   = "auto"
  mode                      = "static"
  original_interface_name   = "${p.src_interface || 'inside'}"
  translated_interface_name = "${p.dst_interface || 'outside'}"
  original_source_kind      = "object"
  original_source_value     = "${p.real_ip || '192.168.1.10'}"
  translated_source_kind    = "object"
  translated_source_value   = "${p.mapped_ip || '203.0.113.50'}"
}`;

      // ─── CISCO NEXUS (DCNM/NDFC) ──────────────────────────────────
      case 'nexus_vrf_network':
        return `# Cisco DCNM/NDFC VXLAN Fabric Network & VRF

resource "dcnm_vrf" "${p.vrf_name || 'vrf'}" {
  fabric_name = "${p.fabric_name || 'vxlan_fabric'}"
  name        = "${p.vrf_name || 'tenant_a_vrf'}"
  vlan        = 2000
}

resource "dcnm_network" "${p.network_name || 'network'}" {
  fabric_name  = "${p.fabric_name || 'vxlan_fabric'}"
  name         = "${p.network_name || 'web_network'}"
  vrf_name     = dcnm_vrf.${p.vrf_name || 'vrf'}.name
  vlan         = ${p.vlan || '1010'}
  ipv4_gateway = "${p.gateway_ip || '192.168.10.1/24'}"
  l2_only_flag = false
}`;

      case 'nexus_bgp':
        return `# Requires dcnm provider: registry.terraform.io/CiscoDevNet/dcnm

resource "dcnm_policy" "bgp_peer_${p.switch_name || 'leaf-101'}" {
  serial_number  = "${p.switch_name || 'leaf-101'}"
  template_name  = "neighbor_ebgp"
  template_props = "NEIGHBOR_IP=${p.peer_ip || '10.1.1.2'};NEIGHBOR_ASN=${p.peer_asn || '65002'};LOCAL_ASN=${p.asn || '65001'}"
}`;

      // ─── AWS VPC ──────────────────────────────────────────────────
      case 'aws_vpc':
        return `provider "aws" {
  region = "${p.region || 'us-east-1'}"
}

resource "aws_vpc" "${p.vpc_name || 'vpc'}" {
  cidr_block           = "${p.vpc_cidr || '10.0.0.0/16'}"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${p.vpc_name || 'prod-vpc'}"
  }
}`;

      case 'aws_subnet':
        return `resource "aws_subnet" "subnet" {
  vpc_id            = aws_vpc.${p.vpc_name || 'vpc'}.id
  cidr_block        = "${p.subnet_cidr || '10.0.1.0/24'}"
  availability_zone = "${p.region || 'us-east-1'}a"

  tags = {
    Name = "subnet"
  }
}`;

      case 'aws_sg':
        const awsRules = (p.rules || '').split('\n').map(r => r.trim()).filter(Boolean);
        let ingressHCL = '';
        awsRules.forEach((rule, idx) => {
          const [port, proto, cidr] = rule.split(',');
          ingressHCL += `  ingress {
    from_port   = ${port || 80}
    to_port     = ${port || 80}
    protocol    = "${proto || 'tcp'}"
    cidr_blocks = ["${cidr || '0.0.0.0/0'}"]
  }\n\n`;
        });

        return `resource "aws_security_group" "${p.security_group_name || 'sg'}" {
  name        = "${p.security_group_name || 'web-sg'}"
  description = "Allow inbound web traffic"
  vpc_id      = aws_vpc.${p.vpc_name || 'vpc'}.id

${ingressHCL}  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "${p.security_group_name || 'web-sg'}"
  }
}`;

      case 'aws_vpc_multi_subnet':
        return `provider "aws" {
  region = "${p.region || 'us-east-1'}"
}

resource "aws_vpc" "${p.vpc_name || 'vpc'}" {
  cidr_block           = "${p.vpc_cidr || '10.0.0.0/16'}"
  enable_dns_hostnames = true

  tags = {
    Name = "${p.vpc_name || 'prod-vpc'}"
  }
}

resource "aws_internet_gateway" "gw" {
  vpc_id = aws_vpc.${p.vpc_name || 'vpc'}.id

  tags = {
    Name = "${p.vpc_name || 'prod-vpc'}-igw"
  }
}

resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.${p.vpc_name || 'vpc'}.id
  cidr_block              = "${p.subnet_public_cidr || '10.0.1.0/24'}"
  map_public_ip_on_launch = true
  availability_zone       = "${p.region || 'us-east-1'}a"

  tags = {
    Name = "public-subnet"
  }
}

resource "aws_subnet" "private" {
  vpc_id            = aws_vpc.${p.vpc_name || 'vpc'}.id
  cidr_block        = "${p.subnet_private_cidr || '10.0.2.0/24'}"
  availability_zone = "${p.region || 'us-east-1'}b"

  tags = {
    Name = "private-subnet"
  }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.${p.vpc_name || 'vpc'}.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.gw.id
  }

  tags = {
    Name = "public-route-table"
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "web_sg" {
  name   = "${p.security_group_name || 'web-sg'}"
  vpc_id = aws_vpc.${p.vpc_name || 'vpc'}.id

  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}`;

      case 'aws_tgw':
        return `provider "aws" {
  region = "${p.region || 'us-east-1'}"
}

resource "aws_ec2_transit_gateway" "${p.tgw_name || 'prod-tgw'}" {
  description     = "Managed by Terraform"
  amazon_side_asn = ${p.amazon_asn || '64512'}

  tags = {
    Name = "${p.tgw_name || 'prod-tgw'}"
  }
}`;

      case 'aws_nat_gw':
        return `provider "aws" {
  region = "${p.region || 'us-east-1'}"
}

resource "aws_eip" "nat_eip" {
  domain = "vpc"
}

resource "aws_nat_gateway" "${p.nat_name || 'prod-nat-gw'}" {
  allocation_id = aws_eip.nat_eip.id
  subnet_id     = aws_subnet.${p.subnet_name || 'public'}.id

  tags = {
    Name = "${p.nat_name || 'prod-nat-gw'}"
  }

  depends_on = [aws_eip.nat_eip]
}`;

      case 'aws_vpc_peering':
        return `provider "aws" {
  region = "${p.region || 'us-east-1'}"
}

# Same-account peering: use auto_accept = true on the connection
# Cross-account peering: remove auto_accept and add aws_vpc_peering_connection_accepter
resource "aws_vpc_peering_connection" "${p.peering_name || 'prod-vpc-peering'}" {
  vpc_id      = "${p.vpc_id || 'vpc-aaaa1111'}"
  peer_vpc_id = "${p.peer_vpc_id || 'vpc-bbbb2222'}"
  auto_accept = true

  tags = {
    Name = "${p.peering_name || 'prod-vpc-peering'}"
  }
}`;

      case 'aws_alb': {
        const subnetList = (p.subnet_ids || 'subnet-aaa111,subnet-bbb222').split(',').map(s => `"${s.trim()}"`).join(', ');
        return `provider "aws" {
  region = "${p.region || 'us-east-1'}"
}

resource "aws_lb" "${p.alb_name || 'prod-alb'}" {
  name               = "${p.alb_name || 'prod-alb'}"
  internal           = false
  load_balancer_type = "application"
  subnets            = [${subnetList}]

  tags = {
    Name = "${p.alb_name || 'prod-alb'}"
  }
}

resource "aws_lb_listener" "http_redirect" {
  load_balancer_arn = aws_lb.${p.alb_name || 'prod-alb'}.arn
  port              = "80"
  protocol          = "HTTP"

  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}`; }

      // ─── AZURE VNET ────────────────────────────────────────────────
      case 'azurerm_vnet':
        return `provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "rg" {
  name     = "${p.vpc_name || 'prod-vnet'}-rg"
  location = "${p.region || 'eastus'}"
}

resource "azurerm_virtual_network" "vnet" {
  name                = "${p.vpc_name || 'prod-vnet'}"
  address_space       = ["${p.address_space || '10.0.0.0/16'}"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}`;

      case 'azurerm_nsg':
        const azRules = (p.rules || '').split('\n').map(r => r.trim()).filter(Boolean);
        let nsgRulesHCL = '';
        azRules.forEach(rule => {
          const [priority, dir, access, proto, port, src] = rule.split(',');
          nsgRulesHCL += `  security_rule {
    name                       = "rule-${priority}"
    priority                   = ${priority || 100}
    direction                  = "${dir || 'Inbound'}"
    access                     = "${access || 'Allow'}"
    protocol                   = "${proto || 'Tcp'}"
    source_port_range          = "*"
    destination_port_range     = "${port || '80'}"
    source_address_prefix      = "${src || '*'}"
    destination_address_prefix = "*"
  }\n\n`;
        });

        return `resource "azurerm_network_security_group" "${p.security_group_name || 'nsg'}" {
  name                = "${p.security_group_name || 'web-nsg'}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

${nsgRulesHCL.trim()}
}`;

      case 'azurerm_vnet_subnets':
        return `provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "rg" {
  name     = "${p.vpc_name || 'prod-vnet'}-rg"
  location = "${p.region || 'eastus'}"
}

resource "azurerm_virtual_network" "vnet" {
  name                = "${p.vpc_name || 'prod-vnet'}"
  address_space       = ["${p.address_space || '10.0.0.0/16'}"]
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
}

resource "azurerm_subnet" "public" {
  name                 = "public-subnet"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["${p.subnet_public_cidr || '10.0.1.0/24'}"]
}

resource "azurerm_subnet" "private" {
  name                 = "private-subnet"
  resource_group_name  = azurerm_resource_group.rg.name
  virtual_network_name = azurerm_virtual_network.vnet.name
  address_prefixes     = ["${p.subnet_private_cidr || '10.0.2.0/24'}"]
}

resource "azurerm_network_security_group" "nsg" {
  name                = "${p.security_group_name || 'web-nsg'}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name

  security_rule {
    name                       = "allow-http"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "80"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "allow-https"
    priority                   = 110
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "Tcp"
    source_port_range          = "*"
    destination_port_range     = "443"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }
}

resource "azurerm_subnet_network_security_group_association" "public_assoc" {
  subnet_id                 = azurerm_subnet.public.id
  network_security_group_id = azurerm_network_security_group.nsg.id
}`;

      case 'azurerm_aks':
        return `provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "rg" {
  name     = "${p.resource_group || 'rg-prod'}"
  location = "${p.region || 'eastus'}"
}

resource "azurerm_kubernetes_cluster" "${p.cluster_name || 'prod-aks'}" {
  name                = "${p.cluster_name || 'prod-aks'}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  dns_prefix          = "${p.cluster_name || 'prod-aks'}"

  default_node_pool {
    name       = "default"
    node_count = ${p.node_count || '2'}
    vm_size    = "Standard_D2_v2"
  }

  identity {
    type = "SystemAssigned"
  }
}`;

      case 'azurerm_app_gateway':
        return `provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "rg" {
  name     = "${p.resource_group || 'rg-prod'}"
  location = "${p.region || 'eastus'}"
}

resource "azurerm_public_ip" "appgw_pip" {
  name                = "${p.appgw_name || 'prod-appgw'}-pip"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_application_gateway" "${p.appgw_name || 'prod-appgw'}" {
  name                = "${p.appgw_name || 'prod-appgw'}"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location

  sku {
    name     = "Standard_v2"
    tier     = "Standard_v2"
    capacity = 2
  }

  gateway_ip_configuration {
    name      = "appgw-ip-config"
    subnet_id = azurerm_subnet.${p.subnet_name || 'appgw-subnet'}.id
  }

  frontend_port {
    name = "http-port"
    port = 80
  }

  frontend_ip_configuration {
    name                 = "public-ip-config"
    public_ip_address_id = azurerm_public_ip.appgw_pip.id
  }

  backend_address_pool {
    name = "backend-pool"
  }

  backend_http_settings {
    name                  = "http-settings"
    cookie_based_affinity = "Disabled"
    port                  = 80
    protocol              = "Http"
    request_timeout       = 60
  }

  http_listener {
    name                           = "http-listener"
    frontend_ip_configuration_name = "public-ip-config"
    frontend_port_name             = "http-port"
    protocol                       = "Http"
  }

  request_routing_rule {
    name                       = "routing-rule"
    rule_type                  = "Basic"
    http_listener_name         = "http-listener"
    backend_address_pool_name  = "backend-pool"
    backend_http_settings_name = "http-settings"
    priority                   = 100
  }
}`;

      case 'azurerm_private_endpoint':
        return `provider "azurerm" {
  features {}
}

resource "azurerm_private_endpoint" "${p.endpoint_name || 'prod-pe'}" {
  name                = "${p.endpoint_name || 'prod-pe'}"
  location            = "${p.region || 'eastus'}"
  resource_group_name = "${p.resource_group || 'rg-prod'}"
  subnet_id           = azurerm_subnet.${p.subnet_name || 'pe-subnet'}.id

  private_service_connection {
    name                           = "${p.endpoint_name || 'prod-pe'}-psc"
    private_connection_resource_id = "${p.target_resource_id || '/subscriptions/00000000/resourceGroups/rg/providers/Microsoft.KeyVault/vaults/kv'}"
    is_manual_connection           = false
    subresource_names              = ["vault"]
  }
}`;

      case 'azurerm_firewall':
        return `provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "rg" {
  name     = "${p.resource_group || 'rg-prod'}"
  location = "${p.region || 'eastus'}"
}

resource "azurerm_public_ip" "fw_pip" {
  name                = "${p.fw_name || 'prod-firewall'}-pip"
  resource_group_name = azurerm_resource_group.rg.name
  location            = azurerm_resource_group.rg.location
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_firewall" "${p.fw_name || 'prod-firewall'}" {
  name                = "${p.fw_name || 'prod-firewall'}"
  location            = azurerm_resource_group.rg.location
  resource_group_name = azurerm_resource_group.rg.name
  sku_name            = "AZFW_VNet"
  sku_tier            = "Standard"

  ip_configuration {
    name                 = "fw-ip-config"
    subnet_id            = azurerm_subnet.${p.subnet_name || 'AzureFirewallSubnet'}.id
    public_ip_address_id = azurerm_public_ip.fw_pip.id
  }
}`;

      // ─── GCP NETWORKS ──────────────────────────────────────────────
      case 'google_network':
        return `provider "google" {
  project = "${p.gcp_project || 'my-gcp-project-123'}"
}

resource "google_compute_network" "vpc" {
  name                    = "${p.vpc_name || 'prod-vpc-network'}"
  auto_create_subnetworks = false
}`;

      case 'google_subnetwork':
        return `resource "google_compute_subnetwork" "subnet" {
  name          = "subnet-1"
  ip_cidr_range = "${p.subnet_cidr || '10.0.1.0/24'}"
  region        = "${p.region || 'us-central1'}"
  network       = google_compute_network.vpc.id
}`;

      case 'google_firewall':
        const gcpPorts = (p.rules || 'tcp:80,tcp:443').split(',');
        let allowHCL = '';
        gcpPorts.forEach(rule => {
          const [proto, portsStr] = rule.split(':');
          allowHCL += `  allow {
    protocol = "${proto || 'tcp'}"
    ${portsStr ? `ports    = ["${portsStr}"]` : ''}
  }\n\n`;
        });

        return `resource "google_compute_firewall" "${p.firewall_name || 'allow-traffic'}" {
  name    = "${p.firewall_name || 'allow-web'}"
  network = google_compute_network.vpc.name

${allowHCL.trim()}

  source_ranges = ["0.0.0.0/0"]
}`;

      case 'google_vpc_custom':
        const rawSubnets = (p.subnets_list || '').split('\n').map(s => s.trim()).filter(Boolean);
        let subnetsHCL = '';
        rawSubnets.forEach((sub, idx) => {
          const [subName, subConfig] = sub.split('=');
          const [cidr, region] = (subConfig || '').split(',');
          subnetsHCL += `resource "google_compute_subnetwork" "${subName || `subnet_${idx}`}" {
  name          = "${subName || `subnet-${idx}`}"
  ip_cidr_range = "${cidr || '10.0.0.0/24'}"
  region        = "${region || 'us-central1'}"
  network       = google_compute_network.vpc.id
}\n\n`;
        });

        return `provider "google" {
  project = "${p.gcp_project || 'my-gcp-project'}"
}

resource "google_compute_network" "vpc" {
  name                    = "${p.vpc_name || 'prod-vpc-network'}"
  auto_create_subnetworks = false
}

${subnetsHCL}resource "google_compute_firewall" "allow_web" {
  name    = "${p.firewall_name || 'allow-web-traffic'}"
  network = google_compute_network.vpc.name

  allow {
    protocol = "tcp"
    ports    = ["80", "443"]
  }

  source_ranges = ["0.0.0.0/0"]
}`;

      default:
        return '';
    }
  }, [resource, params]);

  // Copy Snippet to clipboard
  const [copied, copy] = useCopy();

  // Download Terraform HCL file
  const handleDownload = () => {
    const blob = new Blob([generatedHCL + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = t('terraform_builder.download_filename');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fadein">
      {/* Intro Card */}
      <div className="card">
        <div className="card-title">{t('terraform_builder.title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: '1.5', margin: '0 0 16px 0' }}>
          {t('terraform_builder.subtitle')}
        </p>

        {/* Provider Switcher */}
        <div className="field">
          <label className="label">{t('terraform_builder.lbl_provider')}</label>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {[
              { id: 'aws', label: t('terraform_builder.opt_aws') },
              { id: 'azure', label: t('terraform_builder.opt_azure') },
              { id: 'gcp', label: t('terraform_builder.opt_gcp') },
              { id: 'aci', label: t('terraform_builder.opt_cisco_aci') },
              { id: 'asa', label: t('terraform_builder.opt_cisco_asa') },
              { id: 'nexus', label: t('terraform_builder.opt_cisco_nexus') }
            ].map(prov => (
              <button
                key={prov.id}
                className={`btn ${provider === prov.id ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                onClick={() => handleProviderChange(prov.id)}
              >
                {prov.label}
              </button>
            ))}
          </div>
        </div>

        {/* Resource Preset Selector */}
        <div className="field">
          <label className="label">{t('terraform_builder.lbl_resource')}</label>
          <SearchableSelect
            value={resource}
            placeholder={t('terraform_builder.lbl_resource')}
            options={providerResources[provider] || []}
            onChange={v => { if (v) setResource(v); }}
          />
        </div>
      </div>

      <div className="two-col">
        {/* Left Card: Input form parameters */}
        <div className="card">
          <div className="card-title" style={{ marginBottom: 16 }}>
            {t('terraform_builder.lbl_parameters')}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* Render dynamic inputs based on selected preset keys */}
            {Object.keys(params).map((key) => {
              const labelText = t(`terraform_builder.param_${key}`, key);
              const isTextarea = key === 'rules' || key === 'subnets_list';
              return (
                <div className="field" key={key} style={{ margin: 0 }}>
                  <label className="label">{labelText}</label>
                  {isTextarea ? (
                    <textarea
                      className="input"
                      rows={4}
                      style={{ fontFamily: 'var(--mono)', fontSize: 13 }}
                      value={params[key] || ''}
                      onChange={(e) => setParam(key, e.target.value)}
                    />
                  ) : (
                    <input
                      className="input"
                      style={{ fontFamily: key.includes('cidr') || key.includes('ip') || key.includes('vlan') ? 'var(--mono)' : 'inherit' }}
                      value={params[key] || ''}
                      onChange={(e) => setParam(key, e.target.value)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Card: HCL Output snippet */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t('terraform_builder.lbl_generated_hcl')}</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={`btn btn-ghost btn-sm ${copied ? 'copied' : ''}`}
                onClick={() => copy(generatedHCL)}
              >
                {copied ? t('terraform_builder.copied') : t('terraform_builder.btn_copy')}
              </button>
              <button
                className="btn btn-ghost btn-sm"
                onClick={handleDownload}
              >
                {t('terraform_builder.btn_download')}
              </button>
            </div>
          </div>

          <pre
            style={{
              background: 'var(--panel)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: '14px 18px',
              fontFamily: 'var(--mono)',
              fontSize: 12,
              color: 'var(--text)',
              maxHeight: '520px',
              overflowY: 'auto',
              whiteSpace: 'pre',
              overflowX: 'auto',
              margin: 0
            }}
          >
            {generatedHCL}
          </pre>
          <div className="hint">{t('terraform_builder.hint_copy')}</div>
        </div>
      </div>
    </div>
  );
}

window.TerraformBuilder = TerraformBuilder;
