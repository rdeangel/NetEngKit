const { useState, useEffect, useCallback, useRef } = React;

const SVC_LIST = [
  { label: '— Custom —',          port: '',          proto: null },
  { label: 'HTTP (80)',            port: '80',        proto: 'tcp' },
  { label: 'HTTPS (443)',          port: '443',       proto: 'tcp' },
  { label: 'SSH (22)',             port: '22',        proto: 'tcp' },
  { label: 'Telnet (23)',          port: '23',        proto: 'tcp' },
  { label: 'DNS (53)',             port: '53',        proto: 'udp' },
  { label: 'SMTP (25)',            port: '25',        proto: 'tcp' },
  { label: 'SMTPS (465)',          port: '465',       proto: 'tcp' },
  { label: 'IMAPS (993)',          port: '993',       proto: 'tcp' },
  { label: 'FTP Control (21)',     port: '21',        proto: 'tcp' },
  { label: 'FTP Data (20)',        port: '20',        proto: 'tcp' },
  { label: 'RDP (3389)',           port: '3389',      proto: 'tcp' },
  { label: 'SNMP (161)',           port: '161',       proto: 'udp' },
  { label: 'SNMP Trap (162)',      port: '162',       proto: 'udp' },
  { label: 'NTP (123)',            port: '123',       proto: 'udp' },
  { label: 'DHCP Server (67)',     port: '67',        proto: 'udp' },
  { label: 'BGP (179)',            port: '179',       proto: 'tcp' },
  { label: 'LDAP (389)',           port: '389',       proto: 'tcp' },
  { label: 'LDAPS (636)',          port: '636',       proto: 'tcp' },
  { label: 'Kerberos (88)',        port: '88',        proto: 'tcp' },
  { label: 'RADIUS Auth (1812)',   port: '1812',      proto: 'udp' },
  { label: 'RADIUS Acct (1813)',   port: '1813',      proto: 'udp' },
  { label: 'Syslog (514)',         port: '514',       proto: 'udp' },
  { label: 'TFTP (69)',            port: '69',        proto: 'udp' },
  { label: 'MySQL (3306)',         port: '3306',      proto: 'tcp' },
  { label: 'MSSQL (1433)',         port: '1433',      proto: 'tcp' },
  { label: 'PostgreSQL (5432)',    port: '5432',      proto: 'tcp' },
  { label: 'Redis (6379)',         port: '6379',      proto: 'tcp' },
  { label: 'HTTP-Alt (8080)',      port: '8080',      proto: 'tcp' },
  { label: 'HTTPS-Alt (8443)',     port: '8443',      proto: 'tcp' },
  { label: 'Ephemeral (1024-65535)', port: '1024-65535', proto: 'tcp' },
];

// Cisco ACE port-match syntax: single port → "eq X", range → "range A B"
function fmtIosPort(p) {
  if (!p) return '';
  const m = p.match(/^(\d+)-(\d+)$/);
  return m ? ` range ${m[1]} ${m[2]}` : ` eq ${p}`;
}

function parseDst(val) {
  const v = (val || '').trim();
  if (!v || v.toLowerCase() === 'any') return { isAny: true };
  const d = IPv4.parseCIDR(v);
  if (!d) return null;
  const dsn = IPv4.subnet(d.ip, d.prefix);
  return { isAny: false, cidr: dsn.cidr, net: dsn.networkStr, mask: dsn.maskStr, wc: dsn.wildcardStr };
}

function ACLGenerator({ onShare, initialData }) {
  const { t } = useTranslation();
  const [cidr,       setCidr]       = usePersistentState('acl:cidr', initialData?.cidr       ?? '192.168.1.0/24');
  const [dstCidr,    setDstCidr]    = usePersistentState('acl:dstCidr', initialData?.dstCidr    ?? 'any');
  const [action,     setAction]     = usePersistentState('acl:action', initialData?.action     ?? 'permit');
  const [proto,      setProto]      = usePersistentState('acl:proto', initialData?.proto      ?? 'ip');
  const [port,       setPort]       = usePersistentState('acl:port', initialData?.port       ?? '');
  const [platform,   setPlatform]   = usePersistentState('acl:platform', initialData?.platform   ?? 'cisco-ios');
  const [ruleType,   setRuleType]   = usePersistentState('acl:ruleType', initialData?.ruleType   ?? 'filter');
  const [natTarget,  setNatTarget]  = usePersistentState('acl:natTarget', initialData?.natTarget  ?? '');
  const [natPort,    setNatPort]    = usePersistentState('acl:natPort', initialData?.natPort    ?? '');
  const [iface,      setIface]      = usePersistentState('acl:iface', initialData?.iface      ?? 'GigabitEthernet0/0');
  const [aclName,    setAclName]    = usePersistentState('acl:aclName', initialData?.aclName    ?? 'NET_ACL');
  const [direction,  setDirection]  = usePersistentState('acl:direction', initialData?.direction  ?? 'in');
  const [logTraffic, setLogTraffic] = usePersistentState('acl:logTraffic', initialData?.logTraffic ?? false);
  const [result,     setResult]     = usePersistentState('acl:result', '');
  const [err,        setErr]        = useState('');
  const debounceRef = useRef(null);

  const portMatchable = proto === 'tcp' || proto === 'udp';
  const showAction    = ruleType === 'filter';
  const showProto     = ruleType !== 'masquerade';
  const showMatchPort = (ruleType === 'filter' || ruleType === 'dnat') && portMatchable;
  const showNatTarget = ruleType === 'snat' || ruleType === 'dnat';
  const showNatPort   = ruleType === 'dnat';
  const showDst       = ruleType === 'filter';
  const showDirection = ruleType === 'filter';
  const showLog       = ruleType === 'filter';

  const generate = useCallback(() => {
    setErr('');
    const c = IPv4.parseCIDR((cidr || '').trim());
    if (!c) { setErr(t('range.err_invalid_cidr')); setResult(''); return; }
    const sn  = IPv4.subnet(c.ip, c.prefix);
    const dst = parseDst(dstCidr);
    if (dst === null) { setErr(t('acl.err_invalid_dst', 'Invalid destination CIDR (use "any" or a valid CIDR like 10.0.0.0/8)')); setResult(''); return; }

    const name       = (aclName || '').trim() || 'NET_ACL';
    const portStr    = (port || '').trim();
    const logKw      = logTraffic ? ' log' : '';
    const pm         = proto === 'tcp' || proto === 'udp';
    let out = '';

    const fmtPort = (p, plat) => {
      if (!p) return '';
      if (plat === 'iptables') return p.replace('-', ':');
      if (plat === 'nftables') return p.replace(':', '-');
      return p;
    };

    // Destination string helpers
    const dstIos  = dst.isAny ? 'any' : `${dst.net} ${dst.wc}`;
    const dstCidrStr = dst.isAny ? 'any' : dst.cidr;
    const dstNft  = dst.isAny ? '' : `ip daddr ${dst.cidr} `;
    const dstPf   = dst.isAny ? '' : ` to ${dst.cidr}`;

    // Direction helpers
    const dirIos = direction === 'in' ? 'in' : 'out';
    const dirXr  = direction === 'in' ? 'ingress' : 'egress';
    const dirJunos = direction === 'in' ? 'input' : 'output';

    // ─── Cisco IOS / IOS-XE ──────────────────────────────────────────────────
    if (platform === 'cisco-ios') {
      const wc  = sn.wildcardStr;
      const net = sn.networkStr;
      const dstPort = pm && portStr ? fmtIosPort(portStr) : '';
      if (ruleType === 'filter') {
        out =
`! Numbered extended ACL (legacy):
access-list 100 ${action} ${proto} ${net} ${wc} ${dstIos}${dstPort}${logKw}

! Named ACL (recommended):
ip access-list extended ${name}
 remark Generated by NetEngKit
 ${action} ${proto} ${net} ${wc} ${dstIos}${dstPort}${logKw}
!
! Apply to interface (${dirIos}):
interface ${iface}
 ip access-group ${name} ${dirIos}`;
      } else if (ruleType === 'masquerade') {
        out =
`! Cisco IOS PAT — Masquerade (Overload):
access-list 1 permit ${net} ${wc}
ip nat inside source list 1 interface ${iface} overload
!
interface ${iface}
 ip nat outside
interface <inside-interface>
 ip nat inside`;
      } else if (ruleType === 'snat') {
        out =
`! Cisco IOS Static SNAT (one-to-one):
ip nat inside source static ${net} ${natTarget || '1.2.3.4'}
!
interface ${iface}
 ip nat outside
interface <inside-interface>
 ip nat inside`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        const op = portStr || '80';
        const ip2 = natPort || op;
        out =
`! Cisco IOS Static Port Forward (DNAT):
ip nat inside source static ${np} ${natTarget || '192.168.1.10'} ${ip2} interface ${iface} ${op}
!
interface ${iface}
 ip nat outside
interface <inside-interface>
 ip nat inside`;
      }

    // ─── Cisco NX-OS (Nexus) ─────────────────────────────────────────────────
    } else if (platform === 'cisco-nxos') {
      const dstPort = pm && portStr ? fmtIosPort(portStr) : '';
      if (ruleType === 'filter') {
        out =
`! Cisco NX-OS IP ACL (named only, with sequence numbers):
ip access-list ${name}
  10 ${action} ${proto} ${sn.networkStr} ${sn.wildcardStr} ${dstIos}${dstPort}${logKw}
!
! Apply to interface (${dirIos}):
interface ${iface}
  ip access-group ${name} ${dirIos}

! Apply to VLAN SVI:
! interface Vlan10
!   ip access-group ${name} ${dirIos}`;
      } else if (ruleType === 'masquerade') {
        out =
`! Cisco NX-OS: PAT/NAT Overload
! Requires 'feature nat' — check license availability on your platform.
feature nat

ip access-list ${name}_NAT_ACL
  10 permit ip ${sn.networkStr} ${sn.wildcardStr} any
!
ip nat pool NAT_POOL ${natTarget || '<public-ip>'} ${natTarget || '<public-ip>'} prefix-length 32
ip nat inside source list ${name}_NAT_ACL pool NAT_POOL overload
!
interface ${iface}
  ip nat outside
interface <inside-interface>
  ip nat inside`;
      } else if (ruleType === 'snat') {
        out =
`! Cisco NX-OS: Static SNAT
feature nat
ip nat inside source static ${sn.networkStr} ${natTarget || '1.2.3.4'}
!
interface ${iface}
  ip nat outside
interface <inside-interface>
  ip nat inside`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        const op = portStr || '80';
        const ip2 = natPort || op;
        out =
`! Cisco NX-OS: Static DNAT (port redirect)
feature nat
ip nat inside source static ${np} ${natTarget || '192.168.1.10'} ${ip2} <outside-ip> ${op}
!
interface ${iface}
  ip nat outside
interface <inside-interface>
  ip nat inside`;
      }

    // ─── Cisco IOS-XR ────────────────────────────────────────────────────────
    } else if (platform === 'cisco-xr') {
      if (ruleType === 'filter') {
        const xrProto = proto === 'ip' ? 'ipv4' : proto;
        const dstPort = pm && portStr ? fmtIosPort(portStr) : '';
        out =
`! Cisco IOS-XR IPv4 ACL (uses "ipv4", not "ip"; "ingress"/"egress", not "in"/"out"):
ipv4 access-list ${name}
 10 ${action} ${xrProto} ${sn.networkStr} ${sn.wildcardStr} ${dstIos}${dstPort}${logKw}
!
! Apply to interface (${dirXr}):
interface ${iface}
 ipv4 access-group ${name} ${dirXr}
!
commit`;
      } else if (ruleType === 'masquerade') {
        out =
`! Cisco IOS-XR: NAT overload (PAT)
nat ipv4 access-list ${name}_NAT
 permit ${sn.networkStr} ${sn.wildcardStr}
!
nat ipv4 pool NAT_POOL ${natTarget || '<start-ip>'} ${natTarget || '<end-ip>'} prefix-length 32
nat ipv4 inside source list ${name}_NAT pool NAT_POOL overload
!
interface ${iface}
 ipv4 nat outside
interface <inside-interface>
 ipv4 nat inside
commit`;
      } else if (ruleType === 'snat') {
        out =
`! Cisco IOS-XR: Static SNAT
nat ipv4 inside source static ${sn.networkStr} ${natTarget || '1.2.3.4'}
!
interface ${iface}
 ipv4 nat outside
interface <inside-interface>
 ipv4 nat inside
commit`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        const op = portStr || '80';
        const ip2 = natPort || op;
        out =
`! Cisco IOS-XR: Static DNAT (port forward)
nat ipv4 inside source static ${np} ${natTarget || '192.168.1.10'} ${ip2} interface ${iface} ${op}
!
interface ${iface}
 ipv4 nat outside
interface <inside-interface>
 ipv4 nat inside
commit`;
      }

    // ─── Cisco ASA ──────────────────────────────────────────────────────────
    } else if (platform === 'cisco-asa') {
      const act     = action === 'permit' ? 'permit' : 'deny';
      const objName = `OBJ_${sn.networkStr.replace(/\./g,'_')}`;
      const dstPort = pm && portStr ? fmtIosPort(portStr) : '';
      if (ruleType === 'filter') {
        out =
`! Cisco ASA ACL:
access-list ${name} extended ${act} ${proto} ${sn.networkStr} ${sn.wildcardStr} ${dstIos}${dstPort}${logKw}

! Apply to interface (${dirIos}):
access-group ${name} ${dirIos} interface outside

! Object-based approach:
object network ${objName}
 subnet ${sn.networkStr} ${sn.maskStr}
access-list ${name} extended ${act} ${proto} object ${objName} ${dstIos}${dstPort}${logKw}`;
      } else if (ruleType === 'masquerade' || ruleType === 'snat') {
        out =
`! Cisco ASA: Object NAT (dynamic PAT / SNAT):
object network ${objName}
 subnet ${sn.networkStr} ${sn.maskStr}
 nat (inside,outside) dynamic ${ruleType === 'masquerade' ? 'interface' : (natTarget || '1.2.3.4')}`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        const op = portStr || '80';
        const ip2 = natPort || op;
        out =
`! Cisco ASA: Static port translation (DNAT):
object network OBJ_INTERNAL
 host ${natTarget || '192.168.1.10'}
 nat (inside,outside) static interface service ${np} ${ip2} ${op}`;
      }

    // ─── Juniper JunOS ──────────────────────────────────────────────────────
    } else if (platform === 'junos') {
      if (ruleType === 'filter') {
        const fromLines = [
          `source-address ${sn.cidr};`,
          !dst.isAny ? `destination-address ${dst.cidr};` : null,
          proto !== 'ip' ? `protocol ${proto};` : null,
          pm && portStr ? `destination-port ${portStr};` : null,
        ].filter(Boolean).map(l => `          ${l}`).join('\n');
        const thenVerb = action === 'permit' ? 'accept' : 'discard';
        const syslog  = logTraffic ? '\n          syslog;' : '';
        out =
`# Junos stateless firewall filter:
firewall {
  family inet {
    filter ${name} {
      term TERM1 {
        from {
${fromLines}
        }
        then {
          ${thenVerb};${syslog}
        }
      }
      term DEFAULT {
        then accept;
      }
    }
  }
}

# Apply to interface:
interfaces {
  ${iface} {
    unit 0 {
      family inet {
        filter {
          ${dirJunos} ${name};
        }
      }
    }
  }
}`;
      } else if (ruleType === 'masquerade') {
        out =
`# Junos Source NAT — interface (masquerade):
security {
  nat {
    source {
      rule-set SRC_RS {
        from zone trust;
        to zone untrust;
        rule SRC_R1 {
          match { source-address ${sn.cidr}; }
          then { source-nat { interface; } }
        }
      }
    }
  }
}`;
      } else if (ruleType === 'snat') {
        out =
`# Junos Source NAT — static pool:
security {
  nat {
    source {
      pool SRC_POOL { address { ${natTarget || '1.2.3.4'}/32; } }
      rule-set SRC_RS {
        from zone trust;
        to zone untrust;
        rule SRC_R1 {
          match { source-address ${sn.cidr}; }
          then { source-nat { pool { SRC_POOL; } } }
        }
      }
    }
  }
}`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        out =
`# Junos Destination NAT (port forward):
security {
  nat {
    destination {
      pool DST_POOL {
        address { ${natTarget || '192.168.1.10'}/32; }
        ${natPort ? `port ${natPort};` : ''}
      }
      rule-set DST_RS {
        from interface ${iface};
        rule DST_R1 {
          match {
            protocol ${np};
            destination-port ${portStr || '80'};
          }
          then { destination-nat pool { DST_POOL; } }
        }
      }
    }
  }
}`;
      }

    // ─── Palo Alto (PAN-OS) ─────────────────────────────────────────────────
    } else if (platform === 'palo-alto') {
      const act     = action === 'permit' ? 'allow' : 'deny';
      const addrObj = `ADDR_${sn.networkStr.replace(/\./g,'_')}_${c.prefix}`;
      const dstObj  = dst.isAny ? 'any' : `ADDR_${dst.net.replace(/\./g,'_')}`;
      if (ruleType === 'filter') {
        const svcName   = pm && portStr ? `SVC_${proto}_${portStr.replace('-','_')}` : 'any';
        const svcCreate = pm && portStr ? `\n# Service object:\nset service ${svcName} protocol ${proto} port ${portStr}\n` : '';
        const dstCreate = dst.isAny ? '' : `\n# Destination address object:\nset address ${dstObj} ip-netmask ${dst.cidr}\n`;
        out =
`# PAN-OS — Address objects + Security rule:
# Source address object:
set address ${addrObj} ip-netmask ${sn.cidr}${dstCreate}${svcCreate}
# Security rule:
set rulebase security rules ${name} from any
set rulebase security rules ${name} to any
set rulebase security rules ${name} source ${addrObj}
set rulebase security rules ${name} destination ${dst.isAny ? 'any' : dstObj}
set rulebase security rules ${name} application any
set rulebase security rules ${name} service ${svcName}
set rulebase security rules ${name} action ${act}
set rulebase security rules ${name} log-end yes${logTraffic ? `\nset rulebase security rules ${name} log-start yes` : ''}`;
      } else if (ruleType === 'masquerade' || ruleType === 'snat') {
        const srcXlat = ruleType === 'masquerade'
          ? `set rulebase nat rules ${name} source-translation dynamic-ip-and-port interface-address`
          : `set rulebase nat rules ${name} source-translation static-ip translated-address ${natTarget || '1.2.3.4'}`;
        out =
`# PAN-OS Source NAT:
set address ${addrObj} ip-netmask ${sn.cidr}
set rulebase nat rules ${name} from trust
set rulebase nat rules ${name} to untrust
set rulebase nat rules ${name} source ${addrObj}
set rulebase nat rules ${name} destination any
${srcXlat}`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        out =
`# PAN-OS Destination NAT:
set rulebase nat rules ${name} from untrust
set rulebase nat rules ${name} to untrust
set rulebase nat rules ${name} destination any
set rulebase nat rules ${name} service service-${np}-${portStr || '80'}
set rulebase nat rules ${name} destination-translation translated-address ${natTarget || '192.168.1.10'}${natPort ? `\nset rulebase nat rules ${name} destination-translation translated-port ${natPort}` : ''}`;
      }

    // ─── Fortinet FortiGate ──────────────────────────────────────────────────
    } else if (platform === 'fortigate') {
      const act      = action === 'permit' ? 'accept' : 'deny';
      const addrName = `ADDR_${sn.networkStr.replace(/\./g,'_')}`;
      if (ruleType === 'filter') {
        const svcObj  = portStr ? `"${proto.toUpperCase()}_${portStr}"` : '"ALL"';
        const srcIntf = direction === 'in' ? '"wan1"' : '"internal"';
        const dstIntf = direction === 'in' ? '"internal"' : '"wan1"';
        out =
`# FortiGate — address object + firewall policy:
config firewall address
  edit "${addrName}"
    set subnet ${sn.networkStr} ${sn.maskStr}
  next
end

config firewall policy
  edit 0
    set name "${name}"
    set srcintf ${srcIntf}
    set dstintf ${dstIntf}
    set srcaddr "${addrName}"
    set dstaddr "${dst.isAny ? 'all' : addrName + '_DST'}"
    set action ${act}
    set schedule "always"
    set service ${svcObj}
    set logtraffic ${logTraffic ? 'all' : 'utm'}
  next
end`;
      } else if (ruleType === 'masquerade' || ruleType === 'snat') {
        const poolIp   = ruleType === 'snat' ? (natTarget || '1.2.3.4') : '<wan-ip>';
        const poolType = ruleType === 'masquerade' ? 'overload' : 'one-to-one';
        out =
`# FortiGate: IP Pool + Outbound NAT policy:
config firewall ippool
  edit "SNAT_POOL"
    set startip ${poolIp}
    set endip ${poolIp}
    set type ${poolType}
  next
end

config firewall policy
  edit 0
    set srcintf "internal"
    set dstintf "${iface}"
    set srcaddr "${addrName}"
    set dstaddr "all"
    set action accept
    set nat enable
    set ippool enable
    set poolname "SNAT_POOL"
  next
end`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        out =
`# FortiGate: Virtual IP (port forward / DNAT):
config firewall vip
  edit "VIP_${portStr || '80'}"
    set extintf "${iface}"
    set portforward enable
    set protocol ${np}
    set extport ${portStr || '80'}
    set mappedip "${natTarget || '192.168.1.10'}"
    set mappedport ${natPort || portStr || '80'}
  next
end

# Firewall policy referencing the VIP:
config firewall policy
  edit 0
    set srcintf "${iface}"
    set dstintf "internal"
    set srcaddr "all"
    set dstaddr "VIP_${portStr || '80'}"
    set action accept
    set schedule "always"
    set service "ALL"
  next
end`;
      }

    // ─── Check Point Gaia ────────────────────────────────────────────────────
    } else if (platform === 'checkpoint') {
      const cpNet  = `NET_${sn.networkStr.replace(/\./g,'_')}_${c.prefix}`;
      const cpDst  = dst.isAny ? 'Any' : `NET_${dst.net.replace(/\./g,'_')}`;
      const cpSvc  = pm && portStr ? `${proto.toUpperCase()}_${portStr}` : 'Any';
      if (ruleType === 'filter') {
        out =
`# Check Point — Management API (mgmt_cli):
# Authenticate first (creates session file):
mgmt_cli login user admin password '<password>' -s id.txt

# Source network object:
mgmt_cli add network name "${cpNet}" \\
  subnet "${sn.networkStr}" mask-length ${c.prefix} \\
  -s id.txt
${!dst.isAny ? `
# Destination network object:
mgmt_cli add network name "${cpDst}" \\
  subnet "${dst.net}" mask-length <prefix> \\
  -s id.txt
` : ''}${pm && portStr ? `
# Service object:
mgmt_cli add service-${proto} name "${cpSvc}" port ${portStr} \\
  -s id.txt
` : ''}
# Access rule:
mgmt_cli add access-rule layer "Network" position top \\
  name "${name}" \\
  source "${cpNet}" \\
  destination "${dst.isAny ? 'Any' : cpDst}" \\
  service "${cpSvc}" \\
  action "${action === 'permit' ? 'Accept' : 'Drop'}" \\
  track "${logTraffic ? 'Log' : 'None'}" \\
  -s id.txt

# Publish and install:
mgmt_cli publish -s id.txt
mgmt_cli install-policy policy-package "standard" access true \\
  -s id.txt`;
      } else {
        const natMethod = ruleType === 'masquerade' ? 'hide' : 'static';
        const hideBehind = ruleType === 'masquerade' ? 'gateway' : (natTarget || '1.2.3.4');
        out =
`# Check Point NAT — SmartConsole: Policy > NAT > Add Rule
# Original:    Source=${sn.cidr}  Dest=${dstCidrStr}  Svc=${portStr || 'Any'}
# Translated:  ${ruleType === 'masquerade' ? 'Source=Hide (interface IP)' : ruleType === 'snat' ? `Source=${natTarget || '1.2.3.4'}` : `Dest=${natTarget || '192.168.1.10'}:${natPort || portStr || '80'}`}

# Automatic NAT on network object (mgmt_cli):
mgmt_cli set network name "${cpNet}" \\
  nat-settings.install-on "All" \\
  nat-settings.method "${natMethod}" \\
  nat-settings.hide-behind "${hideBehind}" \\
  -s id.txt

mgmt_cli publish -s id.txt`;
      }

    // ─── iptables ────────────────────────────────────────────────────────────
    } else if (platform === 'iptables') {
      const act    = action === 'permit' ? 'ACCEPT' : 'DROP';
      const iProto = proto === 'ip' ? 'all' : proto;
      const portArg = pm && portStr ? ` --dport ${fmtPort(portStr, 'iptables')}` : '';
      const dstArg  = dst.isAny ? '' : ` -d ${dst.cidr}`;
      const logLine = logTraffic
        ? `\niptables -A ${direction === 'in' ? 'INPUT' : 'OUTPUT'} -s ${sn.cidr}${dstArg} -p ${iProto}${portArg} -j LOG --log-prefix "[${name}] " --log-level 4`
        : '';
      if (ruleType === 'filter') {
        const chain = direction === 'in' ? 'INPUT' : 'OUTPUT';
        out =
`# iptables — stateful boilerplate + rule:
iptables -P INPUT DROP
iptables -P FORWARD DROP
iptables -A INPUT -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
iptables -A INPUT -i lo -j ACCEPT
${logLine}
# Rule: ${sn.cidr} → ${dstCidrStr}${portStr ? ` port ${portStr}` : ''}
iptables -A ${chain} -s ${sn.cidr}${dstArg} -p ${iProto}${portArg} -j ${act}
iptables -A FORWARD -s ${sn.cidr}${dstArg} -p ${iProto}${portArg} -j ${act}

# Persist (Debian/Ubuntu):
iptables-save > /etc/iptables/rules.v4
# Persist (RHEL/CentOS):
service iptables save`;
      } else if (ruleType === 'masquerade') {
        out =
`# iptables NAT: Masquerade (dynamic SNAT):
iptables -t nat -A POSTROUTING -s ${sn.cidr} -o ${iface} -j MASQUERADE
sysctl -w net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf`;
      } else if (ruleType === 'snat') {
        out =
`# iptables NAT: Static SNAT:
iptables -t nat -A POSTROUTING -s ${sn.cidr} -o ${iface} -j SNAT --to-source ${natTarget || '1.2.3.4'}
sysctl -w net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        const op = portStr || '80';
        out =
`# iptables NAT: DNAT (port forward):
iptables -t nat -A PREROUTING -i ${iface} -p ${np} --dport ${op} -j DNAT --to-destination ${natTarget || '192.168.1.10'}${natPort ? `:${natPort}` : ''}
iptables -A FORWARD -i ${iface} -p ${np} --dport ${natPort || op} -d ${natTarget || '192.168.1.10'} -j ACCEPT
sysctl -w net.ipv4.ip_forward=1
echo 'net.ipv4.ip_forward=1' >> /etc/sysctl.conf`;
      }

    // ─── nftables ────────────────────────────────────────────────────────────
    } else if (platform === 'nftables') {
      const act = action === 'permit' ? 'accept' : 'drop';
      if (ruleType === 'filter') {
        let nftMatch = '';
        if (proto !== 'ip' && portStr) {
          nftMatch = `${proto} dport ${fmtPort(portStr, 'nftables')} `;
        } else if (proto !== 'ip') {
          nftMatch = `ip protocol ${proto} `;
        } else if (portStr) {
          nftMatch = `th dport ${fmtPort(portStr, 'nftables')} `;
        }
        const hookType = direction === 'in' ? 'input' : 'output';
        const logStmt  = logTraffic ? `    ip saddr ${sn.cidr} ${dstNft}${nftMatch}log prefix "${name}: " level info\n` : '';
        out =
`table inet filter {
  chain ${hookType} {
    type filter hook ${hookType} priority 0; policy drop;
    ct state established,related accept
    iifname "lo" accept
${logStmt}    ip saddr ${sn.cidr} ${dstNft}${nftMatch}${act}
  }
}`;
      } else if (ruleType === 'masquerade' || ruleType === 'snat') {
        const natAct = ruleType === 'masquerade' ? 'masquerade' : `snat to ${natTarget || '1.2.3.4'}`;
        out =
`table ip nat {
  chain postrouting {
    type nat hook postrouting priority 100;
    ip saddr ${sn.cidr} oifname "${iface}" ${natAct}
  }
}`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        out =
`table ip nat {
  chain prerouting {
    type nat hook prerouting priority -100;
    iifname "${iface}" ${np} dport ${portStr || '80'} dnat to ${natTarget || '192.168.1.10'}${natPort ? `:${natPort}` : ''}
  }
}`;
      }

    // ─── pfSense / OPNsense ──────────────────────────────────────────────────
    } else if (platform === 'pfsense') {
      if (ruleType === 'filter') {
        out =
`# pfSense / OPNsense — Firewall > Rules:
Action:      ${action === 'permit' ? 'Pass' : 'Block'}
Interface:   ${iface}
Direction:   ${direction === 'in' ? 'In' : 'Out'}
Protocol:    ${proto === 'ip' ? 'any' : proto.toUpperCase()}
Source:      ${sn.cidr}
Destination: ${dstCidrStr}${portStr ? `\nDest Port:   ${portStr}` : ''}
Log:         ${logTraffic ? 'Yes' : 'No'}
Description: ${name}`;
      } else if (ruleType === 'masquerade' || ruleType === 'snat') {
        out =
`# pfSense / OPNsense — Firewall > NAT > Outbound
# Set mode to Hybrid or Manual Outbound NAT, then add:
Interface:   ${iface}
Source:      ${sn.cidr}
Translation: ${ruleType === 'snat' ? (natTarget || '1.2.3.4') : 'Interface Address (dynamic)'}`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        out =
`# pfSense / OPNsense — Firewall > NAT > Port Forward:
Interface:         ${iface}
Protocol:          ${np.toUpperCase()}
Dest port:         ${portStr || '80'}
Redirect target:   ${natTarget || '192.168.1.10'}
Redirect port:     ${natPort || portStr || '80'}`;
      }

    // ─── OpenBSD pf ─────────────────────────────────────────────────────────
    } else if (platform === 'openbsd-pf') {
      const act = action === 'permit' ? 'pass' : 'block';
      if (ruleType === 'filter') {
        const pfProto  = proto === 'ip' ? '{ tcp udp }' : proto;
        const portPart = pm && portStr ? ` port ${portStr.replace('-', ':')}` : '';
        const logPart  = logTraffic ? ' log' : '';
        const flagPart = proto === 'tcp' ? ' flags S/SA' : '';
        out =
`# OpenBSD pf.conf:
${act} ${direction === 'in' ? 'in' : 'out'} quick${logPart} on ${iface} proto ${pfProto} \\
  from ${sn.cidr}${dstPf}${portPart}${flagPart} keep state

# Table approach (multiple source networks):
table <${name.toLowerCase()}> { ${sn.cidr} }
${act} ${direction === 'in' ? 'in' : 'out'} quick${logPart} on ${iface} \\
  from <${name.toLowerCase()}>${dstPf}${portPart}

# Reload:
pfctl -f /etc/pf.conf`;
      } else if (ruleType === 'masquerade') {
        out =
`# OpenBSD pf: NAT masquerade:
match out on ${iface} from ${sn.cidr} to any nat-to (${iface})

pfctl -f /etc/pf.conf`;
      } else if (ruleType === 'snat') {
        out =
`# OpenBSD pf: Static SNAT:
match out on ${iface} from ${sn.cidr} to any nat-to ${natTarget || '1.2.3.4'}

pfctl -f /etc/pf.conf`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        out =
`# OpenBSD pf: Port forward (DNAT):
match in on ${iface} proto ${np} from any to any port ${portStr || '80'} \\
  rdr-to ${natTarget || '192.168.1.10'} port ${natPort || portStr || '80'}

pfctl -f /etc/pf.conf`;
      }

    // ─── UFW ────────────────────────────────────────────────────────────────
    } else if (platform === 'ufw') {
      if (ruleType !== 'filter') {
        out =
`# UFW does not manage NAT rules directly.
# Add iptables rules to /etc/ufw/before.rules
# or use iptables / nftables directly for NAT.`;
      } else {
        const act     = action === 'permit' ? 'allow' : 'deny';
        const ufwProto = proto === 'ip' ? 'tcp' : proto;
        out = portStr
          ? `# UFW with port:\nufw ${act} proto ${ufwProto} from ${sn.cidr} to ${dst.isAny ? 'any' : dst.cidr} port ${portStr}\n\n# Insert at position 1:\nufw insert 1 ${act} proto ${ufwProto} from ${sn.cidr} to any port ${portStr}\n\nufw status numbered`
          : `# UFW:\nufw ${act} from ${sn.cidr}${dst.isAny ? '' : ' to ' + dst.cidr}\n\n# Insert at position 1:\nufw insert 1 ${act} from ${sn.cidr}\n\nufw status numbered`;
      }

    // ─── AWS Security Group / NACL ───────────────────────────────────────────
    } else if (platform === 'aws-sg') {
      if (ruleType !== 'filter') {
        out =
`# AWS Security Groups and NACLs do not perform NAT.
# Outbound SNAT/masquerade: deploy an AWS NAT Gateway.
# Inbound port forwarding (DNAT): use an Application or Network Load Balancer.`;
      } else {
        const act      = action === 'permit' ? 'Allow' : 'Deny';
        const awsProto = proto === 'ip' ? '-1' : proto;
        const fromPort = portStr ? portStr.split('-')[0] : 0;
        const toPort   = portStr ? (portStr.split('-')[1] || portStr) : 65535;
        const ruleName = `${name}-${sn.networkStr.replace(/\./g,'-')}`;
        const gcDir    = direction === 'in' ? 'ingress' : 'egress';
        out =
`# AWS Security Group Rule (stateful — return traffic auto-allowed):
Direction:     ${direction === 'in' ? 'Inbound' : 'Outbound'}
Protocol:      ${proto === 'ip' ? 'All (-1)' : proto.toUpperCase()}
Port Range:    ${portStr || 'All'}
Source/Dest:   ${sn.cidr}
Description:   ${name}

# AWS CLI:
aws ec2 authorize-security-group-${gcDir} \\
  --group-id sg-XXXXXXXX \\
  --ip-permissions '[{"IpProtocol":"${awsProto}","FromPort":${fromPort},"ToPort":${toPort},"IpRanges":[{"CidrIp":"${sn.cidr}","Description":"${name}"}]}]'

# AWS NACL (stateless — requires explicit return rule):
Rule #:        100
Protocol:      ${proto === 'ip' ? 'All' : proto}
Port Range:    ${portStr || 'All'}
Source:        ${sn.cidr}
Action:        ${act}

aws ec2 create-network-acl-entry \\
  --network-acl-id acl-XXXXXXXX \\
  --rule-number 100 --protocol ${awsProto} \\
  --rule-action ${act.toLowerCase()} \\
  --${gcDir}${portStr ? ` \\\n  --port-range From=${fromPort},To=${toPort}` : ''} \\
  --cidr-block ${sn.cidr}`;
      }

    // ─── Azure NSG ──────────────────────────────────────────────────────────
    } else if (platform === 'azure-nsg') {
      if (ruleType !== 'filter') {
        out =
`# Azure NSGs do not perform NAT.
# Outbound NAT: use Azure NAT Gateway.
# Inbound port forwarding: use Azure Load Balancer NAT rules or Azure Firewall DNAT.`;
      } else {
        const act      = action === 'permit' ? 'Allow' : 'Deny';
        const ruleName = `${name}-${sn.networkStr.replace(/\./g,'-')}`;
        out =
`# Azure NSG Rule — Portal: NSG > ${direction === 'in' ? 'Inbound' : 'Outbound'} security rules > Add:
Name:               ${ruleName}
Priority:           100
Source IP ranges:   ${sn.cidr}
Source port:        *
Dest IP ranges:     ${dstCidrStr}
Dest port ranges:   ${portStr || '*'}
Protocol:           ${proto === 'ip' ? 'Any' : proto.toUpperCase()}
Action:             ${act}

# Azure CLI:
az network nsg rule create \\
  --resource-group MyRG --nsg-name MyNSG \\
  --name ${ruleName} \\
  --priority 100 \\
  --direction ${direction === 'in' ? 'Inbound' : 'Outbound'} \\
  --source-address-prefixes ${sn.cidr} \\
  --destination-address-prefixes ${dstCidrStr} \\
  --destination-port-ranges ${portStr || '*'} \\
  --protocol ${proto === 'ip' ? '*' : proto.toUpperCase()} \\
  --access ${act}`;
      }

    // ─── GCP Firewall ────────────────────────────────────────────────────────
    } else if (platform === 'gcp') {
      if (ruleType !== 'filter') {
        out =
`# GCP VPC Firewall Rules do not perform NAT.
# Outbound NAT: use Cloud NAT.
# Inbound load balancing: use Cloud Load Balancing.`;
      } else {
        const act      = action === 'permit' ? 'ALLOW' : 'DENY';
        const ruleName = `${name.toLowerCase().replace(/_/g,'-')}-${sn.networkStr.replace(/\./g,'-')}`;
        const gcpRules = proto === 'ip' ? 'all' : (portStr ? `${proto}:${portStr}` : proto);
        const gcpDir   = direction === 'in' ? 'INGRESS' : 'EGRESS';
        const rangeFlg = direction === 'in' ? '--source-ranges' : '--destination-ranges';
        out =
`# GCP VPC Firewall Rule:
Name:       ${ruleName}
Direction:  ${gcpDir}
Action:     ${act}
${direction === 'in' ? 'Source' : 'Destination'} ranges: ${sn.cidr}
Protocols:  ${gcpRules}

# gcloud CLI:
gcloud compute firewall-rules create ${ruleName} \\
  --network default \\
  --action ${act} \\
  --direction ${gcpDir} \\
  ${rangeFlg} ${sn.cidr} \\
  --rules ${gcpRules}`;
      }

    // ─── MikroTik RouterOS ───────────────────────────────────────────────────
    } else if (platform === 'mikrotik') {
      const act      = action === 'permit' ? 'accept' : 'drop';
      const protoArg = proto !== 'ip' ? ` protocol=${proto}` : '';
      const portArg  = pm && portStr ? ` dst-port=${portStr}` : '';
      const dstArg   = dst.isAny ? '' : ` dst-address=${dst.cidr}`;
      const logArg   = logTraffic ? ` log=yes log-prefix="${name}"` : '';
      if (ruleType === 'filter') {
        const chain = direction === 'in' ? 'input' : 'output';
        out =
`# MikroTik RouterOS — filter rule:
/ip firewall filter
add chain=${chain} action=${act} src-address=${sn.cidr}${dstArg}${protoArg}${portArg}${logArg} comment="${name}"

# Address-list approach:
/ip firewall address-list
add list=${name.toLowerCase()} address=${sn.cidr}
/ip firewall filter
add chain=forward action=${act} src-address-list=${name.toLowerCase()}${dstArg}${protoArg}${portArg}${logArg}`;
      } else if (ruleType === 'masquerade') {
        out =
`# MikroTik: Masquerade (dynamic SNAT):
/ip firewall nat
add chain=srcnat action=masquerade src-address=${sn.cidr} out-interface=${iface} comment="${name}"`;
      } else if (ruleType === 'snat') {
        out =
`# MikroTik: Static SNAT:
/ip firewall nat
add chain=srcnat action=src-nat src-address=${sn.cidr} out-interface=${iface} to-addresses=${natTarget || '1.2.3.4'} comment="${name}"`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        out =
`# MikroTik: DNAT (port forward):
/ip firewall nat
add chain=dstnat action=dst-nat protocol=${np} in-interface=${iface} dst-port=${portStr || '80'} to-addresses=${natTarget || '192.168.1.10'}${natPort ? ` to-ports=${natPort}` : ''} comment="${name}"`;
      }

    // ─── VyOS ────────────────────────────────────────────────────────────────
    } else if (platform === 'vyos') {
      const act = action === 'permit' ? 'accept' : 'drop';
      if (ruleType === 'filter') {
        out =
`# VyOS firewall rules:
set firewall name ${name} default-action drop
set firewall name ${name} rule 10 action ${act}
set firewall name ${name} rule 10 source address ${sn.cidr}${!dst.isAny ? `\nset firewall name ${name} rule 10 destination address ${dst.cidr}` : ''}${proto !== 'ip' ? `\nset firewall name ${name} rule 10 protocol ${proto}` : ''}${pm && portStr ? `\nset firewall name ${name} rule 10 destination port ${portStr}` : ''}\nset firewall name ${name} rule 10 state new enable${logTraffic ? `\nset firewall name ${name} rule 10 log enable` : ''}

# Apply to interface (${direction}):
set interfaces ethernet ${iface} firewall ${dirIos} name ${name}

commit
save`;
      } else if (ruleType === 'masquerade') {
        out =
`# VyOS: Masquerade (dynamic SNAT):
set nat source rule 10 outbound-interface ${iface}
set nat source rule 10 source address ${sn.cidr}
set nat source rule 10 translation address masquerade

commit
save`;
      } else if (ruleType === 'snat') {
        out =
`# VyOS: Static SNAT:
set nat source rule 10 outbound-interface ${iface}
set nat source rule 10 source address ${sn.cidr}
set nat source rule 10 translation address ${natTarget || '1.2.3.4'}

commit
save`;
      } else if (ruleType === 'dnat') {
        const np = proto === 'ip' ? 'tcp' : proto;
        out =
`# VyOS: DNAT (port forward):
set nat destination rule 10 inbound-interface ${iface}
set nat destination rule 10 protocol ${np}
set nat destination rule 10 destination port ${portStr || '80'}
set nat destination rule 10 translation address ${natTarget || '192.168.1.10'}${natPort ? `\nset nat destination rule 10 translation port ${natPort}` : ''}

commit
save`;
      }

    // ─── OpenWrt (UCI) ───────────────────────────────────────────────────────
    } else if (platform === 'openwrt') {
      const uciTarget = action === 'permit' ? 'ACCEPT' : 'DROP';
      if (ruleType === 'filter') {
        const ruleName = `${name}_${sn.networkStr.replace(/\./g,'_')}`;
        out =
`# OpenWrt UCI firewall rule:
uci add firewall rule
uci set firewall.@rule[-1].name='${ruleName}'
uci set firewall.@rule[-1].src='*'
uci set firewall.@rule[-1].src_ip='${sn.cidr}'
uci set firewall.@rule[-1].dest='*'${!dst.isAny ? `\nuci set firewall.@rule[-1].dest_ip='${dst.cidr}'` : ''}${proto !== 'ip' ? `\nuci set firewall.@rule[-1].proto='${proto}'` : ''}${pm && portStr ? `\nuci set firewall.@rule[-1].dest_port='${portStr}'` : ''}
uci set firewall.@rule[-1].target='${uciTarget}'
uci commit firewall
/etc/init.d/firewall restart`;
      } else if (ruleType === 'masquerade') {
        out =
`# OpenWrt: Masquerade (enable on WAN zone):
uci set firewall.wan.masq='1'
uci set firewall.wan.masq_src='${sn.cidr}'
uci commit firewall
/etc/init.d/firewall restart

# Or via /etc/firewall.user:
iptables -t nat -A POSTROUTING -s ${sn.cidr} -o ${iface} -j MASQUERADE`;
      } else if (ruleType === 'snat') {
        out =
`# OpenWrt: Static SNAT — add to /etc/firewall.user:
iptables -t nat -A POSTROUTING -s ${sn.cidr} -o ${iface} -j SNAT --to-source ${natTarget || '1.2.3.4'}

/etc/init.d/firewall restart`;
      } else if (ruleType === 'dnat') {
        const np  = proto === 'ip' ? 'tcp' : proto;
        const op  = portStr || '80';
        const ip2 = natPort || op;
        const fwdName = `PortFwd_${op}`;
        out =
`# OpenWrt UCI port forward (DNAT):
uci add firewall redirect
uci set firewall.@redirect[-1].name='${fwdName}'
uci set firewall.@redirect[-1].src='wan'
uci set firewall.@redirect[-1].dest='lan'
uci set firewall.@redirect[-1].proto='${np}'
uci set firewall.@redirect[-1].src_dport='${op}'
uci set firewall.@redirect[-1].dest_ip='${natTarget || '192.168.1.10'}'${ip2 !== op ? `\nuci set firewall.@redirect[-1].dest_port='${ip2}'` : ''}
uci set firewall.@redirect[-1].target='DNAT'
uci commit firewall
/etc/init.d/firewall restart`;
      }

    // ─── Windows Firewall ────────────────────────────────────────────────────
    } else if (platform === 'windows') {
      if (ruleType !== 'filter') {
        out =
`# Windows Firewall does not perform NAT.
# For NAT on Windows Server: use RRAS (Routing and Remote Access Service).
# For desktop NAT: enable Internet Connection Sharing (ICS).`;
      } else {
        const wfAct = action === 'permit' ? 'allow' : 'block';
        const wfDir = direction === 'in' ? 'in' : 'out';
        out =
`# Windows Defender Firewall — netsh advfirewall:
netsh advfirewall firewall add rule ^
  name="${name}" ^
  dir=${wfDir} ^
  action=${wfAct} ^
  protocol=${proto === 'ip' ? 'any' : proto} ^
  remoteip=${sn.cidr}${portStr ? ` ^\n  localport=${portStr}` : ''} ^
  enable=yes

# PowerShell (New-NetFirewallRule):
New-NetFirewallRule \`
  -DisplayName "${name}" \`
  -Direction ${direction === 'in' ? 'Inbound' : 'Outbound'} \`
  -Action ${action === 'permit' ? 'Allow' : 'Block'} \`
  -Protocol ${proto === 'ip' ? 'Any' : proto.toUpperCase()} \`
  -RemoteAddress ${sn.cidr}${portStr ? ` \`\n  -LocalPort ${portStr}` : ''}`;
      }
    }

    setResult(out);
  }, [cidr, dstCidr, action, proto, port, platform, ruleType, natTarget, natPort, iface, aclName, direction, logTraffic, t]);

  // Auto-generate with 300 ms debounce
  useEffect(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(generate, 300);
    return () => clearTimeout(debounceRef.current);
  }, [generate]);

  // Sync share-URL initialData on mount
  useEffect(() => {
    if (!initialData) return;
    if (initialData.cidr      !== undefined) setCidr(initialData.cidr);
    if (initialData.dstCidr   !== undefined) setDstCidr(initialData.dstCidr);
    if (initialData.platform  !== undefined) setPlatform(initialData.platform);
    if (initialData.ruleType  !== undefined) setRuleType(initialData.ruleType);
    if (initialData.iface     !== undefined) setIface(initialData.iface);
    if (initialData.action    !== undefined) setAction(initialData.action);
    if (initialData.proto     !== undefined) setProto(initialData.proto);
    if (initialData.port      !== undefined) setPort(initialData.port);
    if (initialData.natTarget !== undefined) setNatTarget(initialData.natTarget);
    if (initialData.natPort   !== undefined) setNatPort(initialData.natPort);
    if (initialData.aclName   !== undefined) setAclName(initialData.aclName);
    if (initialData.direction !== undefined) setDirection(initialData.direction);
    if (initialData.logTraffic!== undefined) setLogTraffic(initialData.logTraffic);
  }, [initialData]);

  useEffect(() => {
    const handleShare = (e) => {
      if (cidr) (e.detail?.respond ?? onShare)({ tool: 'acl', cidr, dstCidr, platform, ruleType, iface, action, proto, port, natTarget, natPort, aclName, direction, logTraffic });
    };
    window.addEventListener('app:request-share', handleShare);
    return () => window.removeEventListener('app:request-share', handleShare);
  }, [cidr, dstCidr, platform, ruleType, iface, action, proto, port, natTarget, natPort, aclName, direction, logTraffic, onShare]);

  const getExplanation = () => {
    if (platform === 'cisco-ios')   return t('acl.explanation_ios',    'IOS/IOS-XE ACLs are applied to interfaces using "ip access-group NAME in|out". Named ACLs (ip access-list extended) are preferred over numbered — they support adding/deleting individual entries without replacing the whole list. "log" adds CPU overhead on the router; use sparingly in production.');
    if (platform === 'cisco-nxos')  return t('acl.explanation_nxos',   'NX-OS only supports named ACLs (no numbered). Sequence numbers allow you to insert rules between existing entries. The "feature nat" command enables NAT — verify your license tier supports it (N5K/N7K require specific feature sets).');
    if (platform === 'cisco-xr')    return t('acl.explanation_xr',     'IOS-XR uses "ipv4 access-list" (not "ip") and "ingress"/"egress" (not "in"/"out"). All configuration is staged in candidate config and only takes effect after "commit". Use "rollback configuration last 1" to undo.');
    if (platform === 'cisco-asa')   return t('acl.explanation_asa',    'ASA ACLs are stateful (the state table handles return traffic). ACL entries are processed top-down with an implicit deny at the end. Object groups reduce ACL size significantly for repeated address/service patterns.');
    if (platform === 'junos')       return t('acl.explanation_junos',   'JunOS firewall filters are stateless. Apply "input" for ingress (arriving) and "output" for egress (leaving) traffic on the interface unit. Add "count COUNTER_NAME" in the then block for per-term hit counting. Commit with "commit confirmed 5" for a 5-minute auto-rollback safety window.');
    if (platform === 'palo-alto')   return t('acl.explanation_panos',   'PAN-OS uses App-ID (not raw L4 protocols) in the "application" field. Service objects define L4 protocol+port. Security rules are evaluated top-down. Use "application any / service any" when migrating from port-based firewalls, then incrementally tighten with App-ID.');
    if (platform === 'fortigate')   return t('acl.explanation_fortigate','FortiGate policies are directional: srcintf/dstintf define traffic flow. Implicit deny is at the bottom. logtraffic "all" logs both permitted and denied sessions — use "utm" for permit-only to reduce volume. IP pools define SNAT translation addresses.');
    if (platform === 'checkpoint')  return t('acl.explanation_checkpoint','Check Point enforces policy from the Security Management Server. Rules are compiled and pushed to gateways after "publish" + "install-policy". The mgmt_cli tool requires an active session token. Policy changes are atomic — partial installs are not possible.');
    if (platform === 'iptables')    {
      if (ruleType === 'filter')     return t('acl.explanation_iptables_filter');
      if (ruleType === 'masquerade') return t('acl.explanation_masquerade', { iface });
      if (ruleType === 'snat')       return t('acl.explanation_snat', { target: natTarget || '1.2.3.4' });
      if (ruleType === 'dnat')       return t('acl.explanation_dnat');
    }
    if (platform === 'nftables')    return t('acl.explanation_nftables');
    if (platform === 'pfsense')     return t('acl.explanation_pfsense',  'pfSense/OPNsense rules are processed top-down per interface. The first matching rule wins (pass or block). Floating rules can match across all interfaces. Outbound NAT in Hybrid mode allows manual rules while keeping auto-generated ones for other traffic.');
    if (platform === 'openbsd-pf')  return t('acl.explanation_pf',      'OpenBSD pf processes rules top-to-bottom but the last matching rule wins by default (use "quick" to stop at first match). Tables are efficient for large address sets. The "keep state" keyword enables stateful connection tracking.');
    if (platform === 'aws-sg')      return t('acl.explanation_aws_sg',   'Security Groups are stateful — return traffic is automatically allowed. NACLs are stateless and require explicit allow rules for both inbound and outbound, including ephemeral ports (1024-65535) for return TCP traffic. Lower NACL rule numbers have higher priority.');
    if (platform === 'azure-nsg')   return t('acl.explanation_azure_nsg','Azure NSGs are stateful and evaluated by priority (lower number = first match). They apply at the NIC or subnet level. Use Service Tags (e.g., "Internet", "VirtualNetwork", "AzureLoadBalancer") to match Azure service ranges without managing IPs.');
    if (platform === 'gcp')         return t('acl.explanation_gcp',      'GCP VPC firewall rules are stateful. ALLOW and DENY rules are evaluated separately — DENY rules with lower priority numbers win over ALLOW. Rules apply to all instances in the network unless target tags or service accounts are specified.');
    if (platform === 'mikrotik')    return t('acl.explanation_mikrotik', 'MikroTik processes filter rules top-to-bottom; the first matching rule applies. Use the "forward" chain for routed traffic, "input" for traffic destined to the router itself. Address-list groups simplify management for many source prefixes.');
    if (platform === 'vyos')        return t('acl.explanation_vyos',     'VyOS uses named rule sets applied to interfaces. Rules are evaluated by rule number (ascending). All config is staged and applied only after "commit". "save" writes to the persistent config — without it, changes are lost on reboot.');
    if (platform === 'openwrt')     return t('acl.explanation_openwrt',  'OpenWrt firewall uses a zone-based model on top of iptables. UCI rules translate to iptables rules at runtime. For advanced NAT, /etc/firewall.user provides a persistent hook for raw iptables commands that run at firewall init.');
    if (platform === 'windows')     return t('acl.explanation_windows',  'Windows Defender Firewall rules are stateful. netsh advfirewall and PowerShell New-NetFirewallRule produce equivalent rules. Rules are evaluated by priority with "block" taking precedence over "allow" by default for the same port/protocol.');
    if (platform === 'ufw')         return t('acl.explanation_ufw',      'UFW (Uncomplicated Firewall) is a frontend for iptables. Rules are evaluated in order — insert at position 1 for highest priority. UFW does not directly manage the NAT table; edit /etc/ufw/before.rules for POSTROUTING/PREROUTING rules.');
    return t('acl.explanation_default');
  };

  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('acl.configuration')}</div>

        {/* Source CIDR + Destination CIDR */}
        <div className="result-grid">
          <div className="field">
            <label className="label">{t('acl.network_cidr')}</label>
            <input className={`input ${err?'error':''}`} value={cidr} onChange={e => setCidr(e.target.value)} placeholder="192.168.1.0/24" />
          </div>
          {showDst && (
            <div className="field">
              <label className="label">{t('acl.dst_cidr', 'Destination CIDR')}</label>
              <input className="input" value={dstCidr} onChange={e => setDstCidr(e.target.value)} placeholder={t('acl.dst_placeholder', 'any')} />
            </div>
          )}
        </div>

        {/* Platform + Rule Category */}
        <div className="result-grid">
          <div className="field">
            <label className="label">{t('acl.platform')}</label>
            <select className="select" value={platform} onChange={e => setPlatform(e.target.value)}>
              <optgroup label="Cisco">
                <option value="cisco-ios">{t('acl.platform_cisco_ios')}</option>
                <option value="cisco-nxos">{t('acl.platform_cisco_nxos', 'Cisco NX-OS (Nexus)')}</option>
                <option value="cisco-xr">{t('acl.platform_cisco_xr', 'Cisco IOS-XR')}</option>
                <option value="cisco-asa">{t('acl.platform_cisco_asa')}</option>
              </optgroup>
              <optgroup label="Enterprise Firewalls">
                <option value="junos">{t('acl.platform_junos')}</option>
                <option value="palo-alto">{t('acl.platform_palo_alto')}</option>
                <option value="fortigate">{t('acl.platform_fortigate')}</option>
                <option value="checkpoint">{t('acl.platform_checkpoint', 'Check Point Gaia')}</option>
              </optgroup>
              <optgroup label="Linux / BSD">
                <option value="iptables">{t('acl.platform_iptables')}</option>
                <option value="nftables">{t('acl.platform_nftables')}</option>
                <option value="ufw">{t('acl.platform_ufw')}</option>
                <option value="openbsd-pf">{t('acl.platform_openbsd_pf')}</option>
              </optgroup>
              <optgroup label="SMB / SOHO">
                <option value="pfsense">{t('acl.platform_pfsense')}</option>
                <option value="mikrotik">{t('acl.platform_mikrotik')}</option>
                <option value="vyos">{t('acl.platform_vyos')}</option>
                <option value="openwrt">{t('acl.platform_openwrt')}</option>
              </optgroup>
              <optgroup label="Cloud">
                <option value="aws-sg">{t('acl.platform_aws_sg')}</option>
                <option value="azure-nsg">{t('acl.platform_azure_nsg')}</option>
                <option value="gcp">{t('acl.platform_gcp')}</option>
              </optgroup>
              <optgroup label="Host OS">
                <option value="windows">{t('acl.platform_windows')}</option>
              </optgroup>
            </select>
          </div>
          <div className="field">
            <label className="label">{t('acl.rule_category')}</label>
            <select className="select" value={ruleType} onChange={e => setRuleType(e.target.value)}>
              <option value="filter">{t('acl.rule_filter')}</option>
              <option value="masquerade">{t('acl.rule_masquerade')}</option>
              <option value="snat">{t('acl.rule_snat')}</option>
              <option value="dnat">{t('acl.rule_dnat')}</option>
            </select>
          </div>
        </div>

        {/* ACL Name + Interface */}
        <div className="two-col grid-mobile-1">
          <div className="field">
            <label className="label">{t('acl.acl_name', 'ACL / Rule Name')}</label>
            <input className="input" value={aclName} onChange={e => setAclName(e.target.value)} placeholder="NET_ACL" />
          </div>
          <div className="field">
            <label className="label">{t('acl.interface')}</label>
            <input className="input" value={iface} onChange={e => setIface(e.target.value)} placeholder={t('acl.eg_iface')} />
          </div>
        </div>

        {/* Action + Protocol */}
        {showAction && (
          <div className="two-col grid-mobile-1">
            <div className="field">
              <label className="label">{t('acl.action')}</label>
              <div style={{display:'flex',gap:8}}>
                {[['permit', t('acl.permit')],['deny', t('acl.deny')]].map(([v,l]) => (
                  <button key={v} className={`btn ${action===v?'btn-primary':'btn-ghost'}`} onClick={() => setAction(v)}>{l}</button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="label">{t('acl.protocol')}</label>
              <select className="select" value={proto} onChange={e => setProto(e.target.value)}>
                {['ip','tcp','udp','icmp','esp','ah','gre'].map(p => <option key={p}>{p}</option>)}
              </select>
            </div>
          </div>
        )}

        {showProto && !showAction && (
          <div className="field" style={{maxWidth:200}}>
            <label className="label">{t('acl.protocol')}</label>
            <select className="select" value={proto} onChange={e => setProto(e.target.value)}>
              {['ip','tcp','udp','icmp','esp','ah','gre'].map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
        )}

        {/* Direction + Log */}
        {(showDirection || showLog) && (
          <div className="two-col grid-mobile-1">
            {showDirection && (
              <div className="field">
                <label className="label">{t('acl.direction', 'Direction')}</label>
                <div style={{display:'flex',gap:8}}>
                  {[['in', t('acl.dir_in', 'Inbound (in)')],['out', t('acl.dir_out', 'Outbound (out)')]].map(([v,l]) => (
                    <button key={v} className={`btn ${direction===v?'btn-primary':'btn-ghost'}`} onClick={() => setDirection(v)}>{l}</button>
                  ))}
                </div>
              </div>
            )}
            {showLog && (
              <div className="field" style={{display:'flex',alignItems:'center',gap:10,paddingTop:22}}>
                <input type="checkbox" id="acl-log" checked={logTraffic} onChange={e => setLogTraffic(e.target.checked)}
                  style={{width:16,height:16,accentColor:'var(--cyan)',cursor:'pointer'}} />
                <label htmlFor="acl-log" style={{cursor:'pointer',fontSize:13,color:'var(--text)'}}>{t('acl.log_traffic', 'Log matched traffic')}</label>
              </div>
            )}
          </div>
        )}

        {/* NAT Target / NAT Port */}
        {showNatTarget && (
          <div className="two-col grid-mobile-1">
            <div className="field">
              <label className="label">{t('acl.nat_target')}</label>
              <input className="input" value={natTarget} onChange={e => setNatTarget(e.target.value)} placeholder={t('acl.eg_ip_or')} />
            </div>
            {showNatPort && (
              <div className="field">
                <label className="label">{t('acl.nat_port')}</label>
                <input className="input" value={natPort} onChange={e => setNatPort(e.target.value)} placeholder={t('acl.eg_port_alt')} />
              </div>
            )}
          </div>
        )}

        {/* Match Port + Common Service picker */}
        {showMatchPort && (
          <div className="two-col grid-mobile-1">
            <div className="field">
              <label className="label">{t('acl.match_port')}</label>
              <input className="input" value={port} onChange={e => setPort(e.target.value)} placeholder={t('acl.eg_port')} />
            </div>
            <div className="field">
              <label className="label">{t('acl.common_service', 'Common Service (quick-fill)')}</label>
              <select className="select" value="" onChange={e => {
                const svc = SVC_LIST.find(s => s.port === e.target.value);
                if (svc && svc.port) { setPort(svc.port); if (svc.proto) setProto(svc.proto); }
              }}>
                {SVC_LIST.map(s => <option key={s.label} value={s.port}>{s.label}</option>)}
              </select>
            </div>
          </div>
        )}

        <Err msg={err} />
      </div>

      {result && (
        <div className="card fadein">
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <div className="card-title" style={{marginBottom:0}}>{t('acl.generated_rules')}</div>
            <CopyBtn text={result} label="copy_all" id="acl-copy-all" />
          </div>
          <pre style={{fontFamily:'var(--mono)',fontSize:11,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'14px 16px',overflowX:'auto',color:'var(--text)',lineHeight:1.6,whiteSpace:'pre-wrap',wordBreak:'break-all'}}>{result}</pre>

          <div style={{marginTop:20,padding:15,background:'var(--panel)',borderLeft:'4px solid var(--cyan)',borderRadius:4}}>
            <div style={{fontSize:12,fontWeight:600,color:'var(--text)',marginBottom:6}}>{t('acl.explanation')}</div>
            <div style={{fontSize:11,color:'var(--muted)',lineHeight:1.5}}>{getExplanation()}</div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Tool: IP Geolocation ─────────────────────────────────────
// ipwhois.app doesn't send CORS headers for real HTTP origins — only works from
// file:// (where no Origin header is sent). ip-api.com and ipinfo.io support CORS.
const GEO_PROVIDERS = [
  ...(window.location.protocol === 'file:' ? [
    { id:'ipwhois', label:'ipwhois.app', url: ip => `https://ipwhois.app/json/${encodeURIComponent(ip)}` },
  ] : []),
  { id:'ipapi',   label:'ip-api.com',  url: ip => `http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,country,countryCode,regionName,city,zip,lat,lon,timezone,isp,org,as,asname,reverse,mobile,proxy,hosting,query,continent,continentCode,currency` },
  { id:'ipinfo',  label:'ipinfo.io',   url: ip => `https://ipinfo.io/${encodeURIComponent(ip)}/json` },
];

window.ACLGenerator = ACLGenerator;
