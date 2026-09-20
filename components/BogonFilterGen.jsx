// BogonFilterGen.jsx — Bogon / Martian Filter Generator
// Generates platform-specific firewall rules to deny bogon/martian address ranges.

function BogonFilterGen({ initialData, onShare }) {
  const { t } = useTranslation();

  // ─── Bogon / Martian address definitions ─────────────────────────────────
  const BOGON_CATEGORIES = [
    {
      key: 'rfc1918',
      rfcs: ['1918'],
      cidrs_v4: ['10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16'],
      cidrs_v6: [],
    },
    {
      key: 'loopback',
      rfcs: ['5735', '4291'],
      cidrs_v4: ['127.0.0.0/8'],
      cidrs_v6: ['::1/128'],
    },
    {
      key: 'link_local',
      rfcs: ['3927', '4291'],
      cidrs_v4: ['169.254.0.0/16'],
      cidrs_v6: ['fe80::/10'],
    },
    {
      key: 'documentation',
      rfcs: ['5737', '3849'],
      cidrs_v4: ['192.0.2.0/24', '198.51.100.0/24', '203.0.113.0/24'],
      cidrs_v6: ['2001:db8::/32'],
    },
    {
      key: 'multicast',
      rfcs: ['1112', '4291'],
      cidrs_v4: ['224.0.0.0/4'],
      cidrs_v6: ['ff00::/8'],
    },
    {
      key: 'class_e',
      rfcs: ['1112'],
      cidrs_v4: ['240.0.0.0/4'],
      cidrs_v6: [],
    },
    {
      key: 'iana_special',
      rfcs: ['6598', '6890'],
      cidrs_v4: ['0.0.0.0/8', '100.64.0.0/10', '192.0.0.0/24', '198.18.0.0/15'],
      cidrs_v6: ['::ffff:0:0/96', '64:ff9b::/96', '2001::/23'],
    },
    {
      key: 'default_route',
      rfcs: [],
      cidrs_v4: ['0.0.0.0/0'],
      cidrs_v6: ['::/0'],
    },
  ];

  const ALL_CATEGORY_KEYS = BOGON_CATEGORIES.map(c => c.key);

  const DEFAULT_CATEGORIES = ['rfc1918', 'loopback', 'link_local', 'documentation', 'multicast', 'class_e', 'iana_special'];

  // ─── State ────────────────────────────────────────────────────────────────
  const [platform,   setPlatform]   = usePersistentState('bogon:platform',   initialData?.platform   ?? 'cisco-ios-acl');
  const [direction,  setDirection]  = usePersistentState('bogon:direction',  initialData?.direction  ?? 'inbound');
  const [aclName,    setAclName]    = usePersistentState('bogon:aclName',    initialData?.aclName    ?? '');
  const [categories, setCategories] = usePersistentState('bogon:categories', initialData?.categories ?? DEFAULT_CATEGORIES);
  const [includeV4,  setIncludeV4]  = usePersistentState('bogon:includeV4',  initialData?.includeV4  ?? true);
  const [includeV6,  setIncludeV6]  = usePersistentState('bogon:includeV6',  initialData?.includeV6  ?? true);
  const [action,     setAction]     = usePersistentState('bogon:action',     initialData?.action     ?? 'deny');

  const [output, setOutput] = usePersistentState('bogon:output', '');
  const debounceRef = useRef(null);

  // ─── Share URL ────────────────────────────────────────────────────────────
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'bogon-filter', platform, direction, aclName, categories, includeV4, includeV6, action });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [platform, direction, aclName, categories, includeV4, includeV6, action, onShare]);

  // ─── Generator helpers ────────────────────────────────────────────────────

  function getActiveCidrs() {
    const v4 = [];
    const v6 = [];
    for (const cat of BOGON_CATEGORIES) {
      if (!categories.includes(cat.key)) continue;
      if (includeV4) v4.push(...cat.cidrs_v4.map(cidr => ({ cidr, catKey: cat.key, rfcs: cat.rfcs })));
      if (includeV6) v6.push(...cat.cidrs_v6.map(cidr => ({ cidr, catKey: cat.key, rfcs: cat.rfcs })));
    }
    return { v4, v6 };
  }

  function catLabel(key) {
    return t(`bogon_filter.cat_${key}`);
  }

  // Compute wildcard mask string from prefix length for IPv4
  function prefixToWildcard(prefix) {
    const p = parseInt(prefix, 10);
    const mask = (0xFFFFFFFF << (32 - p)) >>> 0;
    const wc = (~mask) >>> 0;
    return [(wc >>> 24) & 0xFF, (wc >>> 16) & 0xFF, (wc >>> 8) & 0xFF, wc & 0xFF].join('.');
  }

  function prefixToMask(prefix) {
    const p = parseInt(prefix, 10);
    const mask = p === 0 ? 0 : ((0xFFFFFFFF << (32 - p)) >>> 0);
    return [(mask >>> 24) & 0xFF, (mask >>> 16) & 0xFF, (mask >>> 8) & 0xFF, mask & 0xFF].join('.');
  }

  function parseNet(cidr) {
    const [ip, prefix] = cidr.split('/');
    return { ip, prefix: prefix || '32', wc: prefixToWildcard(prefix || '32'), mask: prefixToMask(prefix || '32') };
  }

  function isIPv6(cidr) { return cidr.includes(':'); }

  // Build a comment line appropriate for the platform
  function commentLine(platform, text) {
    if (platform === 'pf') return `# ${text}`;
    if (platform === 'iptables' || platform === 'nftables' || platform === 'mikrotik') return `# ${text}`;
    if (platform === 'junos-filter' || platform === 'junos-prefix') return `/* ${text} */`;
    if (platform === 'fortigate' || platform === 'checkpoint' || platform === 'vyos') return `# ${text}`;
    return `! ${text}`;
  }

  function rfcNote(rfcs) {
    if (!rfcs || !rfcs.length) return '';
    return ` (${rfcs.map(r => `RFC ${r}`).join(', ')})`;
  }

  // ─── Per-platform output generators ──────────────────────────────────────

  function genCiscoIosAcl(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const aclv4 = name || 'BOGON_V4_ACL';
    const aclv6 = name ? `${name}_V6` : 'BOGON_V6_ACL';
    const deny = act === 'deny' ? 'deny' : 'permit';
    const permit = act === 'deny' ? 'permit' : 'deny';
    const dirKw = dir === 'outbound' ? 'out' : 'in';
    const cm = (txt) => commentLine('cisco-ios-acl', txt);

    if (v4entries.length) {
      lines.push(cm(`IPv4 Bogon Filter — generated by NetEngKit`));
      lines.push(`ip access-list extended ${aclv4}`);
      let lastCat = '';
      let seq = 10;
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(` remark ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const { ip, wc } = parseNet(e.cidr);
        lines.push(` ${seq} ${deny} ip ${ip} ${wc} any`);
        seq += 10;
      }
      lines.push(` ${seq} ${permit} ip any any`);
      lines.push('!');
      if (dir !== 'both') {
        lines.push(cm(`Apply to interface:`));
        lines.push(`interface <interface>`);
        lines.push(` ip access-group ${aclv4} ${dirKw}`);
        lines.push('!');
      } else {
        lines.push(cm(`Apply inbound and outbound:`));
        lines.push(`interface <interface>`);
        lines.push(` ip access-group ${aclv4} in`);
        lines.push(` ip access-group ${aclv4} out`);
        lines.push('!');
      }
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(cm(`IPv6 Bogon Filter`));
      lines.push(`ipv6 access-list ${aclv6}`);
      let lastCat = '';
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(` remark ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(` ${deny} ipv6 ${e.cidr} any`);
      }
      lines.push(` ${permit} ipv6 any any`);
      lines.push('!');
      if (dir !== 'both') {
        lines.push(`interface <interface>`);
        lines.push(` ipv6 traffic-filter ${aclv6} ${dirKw}`);
        lines.push('!');
      } else {
        lines.push(`interface <interface>`);
        lines.push(` ipv6 traffic-filter ${aclv6} in`);
        lines.push(` ipv6 traffic-filter ${aclv6} out`);
        lines.push('!');
      }
    }

    return lines.join('\n');
  }

  function genCiscoIosPrefix(v4entries, v6entries, name, act) {
    const lines = [];
    const plName = name || 'BOGON_V4_PFX';
    const pl6Name = name ? `${name}_V6` : 'BOGON_V6_PFX';
    const deny = act === 'deny' ? 'deny' : 'permit';
    const permit = act === 'deny' ? 'permit' : 'deny';
    const cm = (txt) => commentLine('cisco-ios-prefix', txt);

    if (v4entries.length) {
      lines.push(cm(`IPv4 Bogon Prefix-List — generated by NetEngKit`));
      let seq = 5;
      let lastCat = '';
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(cm(`  ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`));
          lastCat = e.catKey;
        }
        const pfx = parseInt(e.cidr.split('/')[1], 10);
        const leStr = pfx < 32 ? ` le 32` : '';
        lines.push(`ip prefix-list ${plName} seq ${seq} ${deny} ${e.cidr}${leStr}`);
        seq += 5;
      }
      lines.push(`ip prefix-list ${plName} seq ${seq} ${permit} 0.0.0.0/0 le 32`);
      lines.push('!');
      lines.push(cm(`Apply to BGP neighbor:`));
      lines.push(`router bgp <ASN>`);
      lines.push(` neighbor <peer-ip> prefix-list ${plName} in`);
      lines.push('!');
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(cm(`IPv6 Bogon Prefix-List`));
      let seq = 5;
      let lastCat = '';
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(cm(`  ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`));
          lastCat = e.catKey;
        }
        const pfx = parseInt(e.cidr.split('/')[1], 10);
        const leStr = pfx < 128 ? ` le 128` : '';
        lines.push(`ipv6 prefix-list ${pl6Name} seq ${seq} ${deny} ${e.cidr}${leStr}`);
        seq += 5;
      }
      lines.push(`ipv6 prefix-list ${pl6Name} seq ${seq} ${permit} ::/0 le 128`);
      lines.push('!');
      lines.push(cm(`Apply to BGP neighbor:`));
      lines.push(`router bgp <ASN>`);
      lines.push(` neighbor <peer-ip> prefix-list ${pl6Name} in`);
      lines.push('!');
    }

    return lines.join('\n');
  }

  function genCiscoNxosAcl(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const aclv4 = name || 'BOGON_V4_ACL';
    const aclv6 = name ? `${name}_V6` : 'BOGON_V6_ACL';
    const deny = act === 'deny' ? 'deny' : 'permit';
    const permit = act === 'deny' ? 'permit' : 'deny';
    const dirKw = dir === 'outbound' ? 'out' : 'in';
    const cm = (txt) => commentLine('cisco-nxos-acl', txt);

    if (v4entries.length) {
      lines.push(cm(`IPv4 Bogon Filter — NX-OS — generated by NetEngKit`));
      lines.push(`ip access-list ${aclv4}`);
      let lastCat = '';
      let seq = 10;
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(`  remark ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const { ip, wc } = parseNet(e.cidr);
        lines.push(`  ${seq} ${deny} ip ${ip} ${wc} any`);
        seq += 10;
      }
      lines.push(`  ${seq} ${permit} ip any any`);
      lines.push('!');
      if (dir !== 'both') {
        lines.push(`interface <interface>`);
        lines.push(`  ip access-group ${aclv4} ${dirKw}`);
      } else {
        lines.push(`interface <interface>`);
        lines.push(`  ip access-group ${aclv4} in`);
        lines.push(`  ip access-group ${aclv4} out`);
      }
      lines.push('!');
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(cm(`IPv6 Bogon Filter — NX-OS`));
      lines.push(`ipv6 access-list ${aclv6}`);
      let lastCat = '';
      let seq = 10;
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(`  remark ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(`  ${seq} ${deny} ipv6 ${e.cidr} any`);
        seq += 10;
      }
      lines.push(`  ${seq} ${permit} ipv6 any any`);
      lines.push('!');
      if (dir !== 'both') {
        lines.push(`interface <interface>`);
        lines.push(`  ipv6 traffic-filter ${aclv6} ${dirKw}`);
      } else {
        lines.push(`interface <interface>`);
        lines.push(`  ipv6 traffic-filter ${aclv6} in`);
        lines.push(`  ipv6 traffic-filter ${aclv6} out`);
      }
      lines.push('!');
    }

    return lines.join('\n');
  }

  function genCiscoNxosPrefix(v4entries, v6entries, name, act) {
    // NX-OS prefix-list syntax is identical to IOS
    return genCiscoIosPrefix(v4entries, v6entries, name, act);
  }

  function genCiscoXrAcl(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const aclv4 = name || 'BOGON_V4_ACL';
    const aclv6 = name ? `${name}_V6` : 'BOGON_V6_ACL';
    const deny = act === 'deny' ? 'deny' : 'permit';
    const permit = act === 'deny' ? 'permit' : 'deny';
    const dirKw = dir === 'outbound' ? 'egress' : 'ingress';
    const cm = (txt) => commentLine('cisco-xr-acl', txt);

    if (v4entries.length) {
      lines.push(cm(`IPv4 Bogon Filter — IOS-XR — generated by NetEngKit`));
      lines.push(`ipv4 access-list ${aclv4}`);
      let lastCat = '';
      let seq = 10;
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(` remark ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const { ip, wc } = parseNet(e.cidr);
        lines.push(` ${seq} ${deny} ipv4 ${ip} ${wc} any`);
        seq += 10;
      }
      lines.push(` ${seq} ${permit} ipv4 any any`);
      lines.push('!');
      if (dir !== 'both') {
        lines.push(`interface <interface>`);
        lines.push(` ipv4 access-group ${aclv4} ${dirKw}`);
      } else {
        lines.push(`interface <interface>`);
        lines.push(` ipv4 access-group ${aclv4} ingress`);
        lines.push(` ipv4 access-group ${aclv4} egress`);
      }
      lines.push(`commit`);
      lines.push('!');
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(cm(`IPv6 Bogon Filter — IOS-XR`));
      lines.push(`ipv6 access-list ${aclv6}`);
      let lastCat = '';
      let seq = 10;
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(` remark ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(` ${seq} ${deny} ipv6 ${e.cidr} any`);
        seq += 10;
      }
      lines.push(` ${seq} ${permit} ipv6 any any`);
      lines.push('!');
      if (dir !== 'both') {
        lines.push(`interface <interface>`);
        lines.push(` ipv6 access-group ${aclv6} ${dirKw}`);
      } else {
        lines.push(`interface <interface>`);
        lines.push(` ipv6 access-group ${aclv6} ingress`);
        lines.push(` ipv6 access-group ${aclv6} egress`);
      }
      lines.push(`commit`);
      lines.push('!');
    }

    return lines.join('\n');
  }

  function genCiscoXrPrefix(v4entries, v6entries, name, act) {
    const lines = [];
    const plName = name || 'BOGON_V4_PFX';
    const pl6Name = name ? `${name}_V6` : 'BOGON_V6_PFX';
    const deny = act === 'deny' ? 'drop' : 'pass';
    const permit = act === 'deny' ? 'pass' : 'drop';
    const cm = (txt) => commentLine('cisco-xr-prefix', txt);

    if (v4entries.length) {
      lines.push(cm(`IPv4 Bogon Prefix-Set — IOS-XR — generated by NetEngKit`));
      lines.push(`prefix-set ${plName}`);
      const pfxLines = [];
      let lastCat = '';
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          pfxLines.push(`  ${cm(`  ${catLabel(e.catKey)}`)}`);
          lastCat = e.catKey;
        }
        const pfx = parseInt(e.cidr.split('/')[1], 10);
        const leStr = pfx < 32 ? ` le 32` : '';
        pfxLines.push(`  ${e.cidr}${leStr}`);
      }
      lines.push(pfxLines.join(',\n'));
      lines.push(`end-set`);
      lines.push('!');
      lines.push(cm(`Use in route-policy:`));
      lines.push(`route-policy BOGON_FILTER`);
      lines.push(`  if destination in ${plName} then`);
      lines.push(`    ${deny}`);
      lines.push(`  else`);
      lines.push(`    ${permit}`);
      lines.push(`  endif`);
      lines.push(`end-policy`);
      lines.push(`commit`);
      lines.push('!');
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(cm(`IPv6 Bogon Prefix-Set — IOS-XR`));
      lines.push(`prefix-set ${pl6Name}`);
      const pfxLines = [];
      let lastCat = '';
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          pfxLines.push(`  ${cm(`  ${catLabel(e.catKey)}`)}`);
          lastCat = e.catKey;
        }
        const pfx = parseInt(e.cidr.split('/')[1], 10);
        const leStr = pfx < 128 ? ` le 128` : '';
        pfxLines.push(`  ${e.cidr}${leStr}`);
      }
      lines.push(pfxLines.join(',\n'));
      lines.push(`end-set`);
      lines.push('!');
      lines.push(cm(`Use in route-policy:`));
      lines.push(`route-policy BOGON_V6_FILTER`);
      lines.push(`  if destination in ${pl6Name} then`);
      lines.push(`    ${deny}`);
      lines.push(`  else`);
      lines.push(`    ${permit}`);
      lines.push(`  endif`);
      lines.push(`end-policy`);
      lines.push(`commit`);
      lines.push('!');
    }

    return lines.join('\n');
  }

  function genCiscoAsaAcl(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const aclName2 = name || 'BOGON_ACL';
    const deny = act === 'deny' ? 'deny' : 'permit';
    const permit = act === 'deny' ? 'permit' : 'deny';
    const dirKw = dir === 'outbound' ? 'out' : 'in';
    const cm = (txt) => commentLine('cisco-asa', txt);

    lines.push(cm(`Bogon / Martian Filter — Cisco ASA — generated by NetEngKit`));
    lines.push(cm(`Step 1: Create network objects`));
    lines.push('');

    const allEntries = [
      ...v4entries.map(e => ({ ...e, v6: false })),
      ...v6entries.map(e => ({ ...e, v6: true })),
    ];

    const objLines = [];
    const objNames = [];
    for (const e of allEntries) {
      const safeName = `BOGON_${e.cidr.replace(/[./:/]/g, '_')}`;
      objNames.push(safeName);
      objLines.push(`object network ${safeName}`);
      if (e.v6) {
        objLines.push(` host ${e.cidr}`);
      } else {
        const { ip, mask } = parseNet(e.cidr);
        objLines.push(` subnet ${ip} ${mask}`);
      }
    }
    lines.push(...objLines);
    lines.push('');
    lines.push(cm(`Step 2: Create object-group`));
    lines.push(`object-group network ${aclName2}_BOGONS`);
    for (const on of objNames) {
      lines.push(` network-object object ${on}`);
    }
    lines.push('');
    lines.push(cm(`Step 3: ACL referencing the group`));
    lines.push(`access-list ${aclName2} extended ${deny} ip object-group ${aclName2}_BOGONS any`);
    lines.push(`access-list ${aclName2} extended ${permit} ip any any`);
    lines.push('');
    lines.push(cm(`Step 4: Apply to interface`));
    if (dir !== 'both') {
      lines.push(`access-group ${aclName2} ${dirKw} interface outside`);
    } else {
      lines.push(`access-group ${aclName2} in interface outside`);
      lines.push(`access-group ${aclName2} out interface outside`);
    }

    return lines.join('\n');
  }

  function genJunosFilter(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const fName = name || 'BOGON_FILTER';
    const fName6 = name ? `${name}_v6` : 'BOGON_FILTER_V6';
    const deny = act === 'deny' ? 'discard' : 'accept';
    const permit = act === 'deny' ? 'accept' : 'discard';
    const dirKw = dir === 'outbound' ? 'output' : 'input';

    if (v4entries.length) {
      lines.push(`/* IPv4 Bogon Filter — JunOS — generated by NetEngKit */`);
      lines.push(`firewall {`);
      lines.push(`  family inet {`);
      lines.push(`    filter ${fName} {`);
      let termSeq = 1;
      let lastCat = '';
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(`      /* ${catLabel(e.catKey)}${rfcNote(e.rfcs)} */`);
          lastCat = e.catKey;
        }
        const termName = `bogon-${termSeq}`;
        lines.push(`      term ${termName} {`);
        lines.push(`        from {`);
        lines.push(`          source-address { ${e.cidr}; }`);
        lines.push(`        }`);
        lines.push(`        then { ${deny}; }`);
        lines.push(`      }`);
        termSeq++;
      }
      lines.push(`      term ALLOW-ALL {`);
      lines.push(`        then { ${permit}; }`);
      lines.push(`      }`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push(`}`);
      lines.push('');
      if (dir !== 'both') {
        lines.push(`/* Apply to interface: */`);
        lines.push(`interfaces <interface-name> {`);
        lines.push(`  unit 0 {`);
        lines.push(`    family inet {`);
        lines.push(`      filter { ${dirKw} ${fName}; }`);
        lines.push(`    }`);
        lines.push(`  }`);
        lines.push(`}`);
      } else {
        lines.push(`interfaces <interface-name> {`);
        lines.push(`  unit 0 {`);
        lines.push(`    family inet {`);
        lines.push(`      filter { input ${fName}; output ${fName}; }`);
        lines.push(`    }`);
        lines.push(`  }`);
        lines.push(`}`);
      }
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(`/* IPv6 Bogon Filter — JunOS */`);
      lines.push(`firewall {`);
      lines.push(`  family inet6 {`);
      lines.push(`    filter ${fName6} {`);
      let termSeq = 1;
      let lastCat = '';
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(`      /* ${catLabel(e.catKey)}${rfcNote(e.rfcs)} */`);
          lastCat = e.catKey;
        }
        const termName = `bogon-v6-${termSeq}`;
        lines.push(`      term ${termName} {`);
        lines.push(`        from {`);
        lines.push(`          source-address { ${e.cidr}; }`);
        lines.push(`        }`);
        lines.push(`        then { ${deny}; }`);
        lines.push(`      }`);
        termSeq++;
      }
      lines.push(`      term ALLOW-ALL {`);
      lines.push(`        then { ${permit}; }`);
      lines.push(`      }`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push(`}`);
      lines.push('');
      if (dir !== 'both') {
        lines.push(`interfaces <interface-name> {`);
        lines.push(`  unit 0 {`);
        lines.push(`    family inet6 {`);
        lines.push(`      filter { ${dirKw} ${fName6}; }`);
        lines.push(`    }`);
        lines.push(`  }`);
        lines.push(`}`);
      } else {
        lines.push(`interfaces <interface-name> {`);
        lines.push(`  unit 0 {`);
        lines.push(`    family inet6 {`);
        lines.push(`      filter { input ${fName6}; output ${fName6}; }`);
        lines.push(`    }`);
        lines.push(`  }`);
        lines.push(`}`);
      }
    }

    return lines.join('\n');
  }

  function genJunosPrefix(v4entries, v6entries, name, act) {
    const lines = [];
    const plName = name || 'BOGON_PREFIXES';
    const pl6Name = name ? `${name}-v6` : 'BOGON_PREFIXES_V6';
    const deny = act === 'deny' ? 'reject' : 'accept';
    const permit = act === 'deny' ? 'accept' : 'reject';

    if (v4entries.length) {
      lines.push(`/* IPv4 Bogon Prefix-List — JunOS — generated by NetEngKit */`);
      lines.push(`policy-options {`);
      lines.push(`  prefix-list ${plName} {`);
      let lastCat = '';
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(`    /* ${catLabel(e.catKey)}${rfcNote(e.rfcs)} */`);
          lastCat = e.catKey;
        }
        const pfx = parseInt(e.cidr.split('/')[1], 10);
        const rangeStr = pfx < 32 ? `upto /32` : '';
        lines.push(`    ${e.cidr}${rangeStr ? ` ${rangeStr}` : ''};`);
      }
      lines.push(`  }`);
      lines.push(`  policy-statement BOGON_DENY {`);
      lines.push(`    term BOGON {`);
      lines.push(`      from {`);
      lines.push(`        prefix-list ${plName};`);
      lines.push(`      }`);
      lines.push(`      then ${deny};`);
      lines.push(`    }`);
      lines.push(`    term ALLOW {`);
      lines.push(`      then ${permit};`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push(`}`);
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(`/* IPv6 Bogon Prefix-List — JunOS */`);
      lines.push(`policy-options {`);
      lines.push(`  prefix-list ${pl6Name} {`);
      let lastCat = '';
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(`    /* ${catLabel(e.catKey)}${rfcNote(e.rfcs)} */`);
          lastCat = e.catKey;
        }
        const pfx = parseInt(e.cidr.split('/')[1], 10);
        const rangeStr = pfx < 128 ? `upto /128` : '';
        lines.push(`    ${e.cidr}${rangeStr ? ` ${rangeStr}` : ''};`);
      }
      lines.push(`  }`);
      lines.push(`  policy-statement BOGON_V6_DENY {`);
      lines.push(`    term BOGON_V6 {`);
      lines.push(`      from {`);
      lines.push(`        prefix-list ${pl6Name};`);
      lines.push(`      }`);
      lines.push(`      then ${deny};`);
      lines.push(`    }`);
      lines.push(`    term ALLOW {`);
      lines.push(`      then ${permit};`);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push(`}`);
    }

    return lines.join('\n');
  }

  function genAristaAcl(v4entries, v6entries, name, dir, act) {
    // Arista EOS ACL syntax is very similar to Cisco IOS
    const lines = [];
    const aclv4 = name || 'BOGON_V4_ACL';
    const aclv6 = name ? `${name}_V6` : 'BOGON_V6_ACL';
    const deny = act === 'deny' ? 'deny' : 'permit';
    const permit = act === 'deny' ? 'permit' : 'deny';
    const dirKw = dir === 'outbound' ? 'out' : 'in';
    const cm = (txt) => commentLine('arista-acl', txt);

    if (v4entries.length) {
      lines.push(cm(`IPv4 Bogon Filter — Arista EOS — generated by NetEngKit`));
      lines.push(`ip access-list ${aclv4}`);
      let lastCat = '';
      let seq = 10;
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(`   remark ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const { ip, wc } = parseNet(e.cidr);
        lines.push(`   ${seq} ${deny} ip ${ip} ${wc} any`);
        seq += 10;
      }
      lines.push(`   ${seq} ${permit} ip any any`);
      lines.push('!');
      if (dir !== 'both') {
        lines.push(`interface <interface>`);
        lines.push(`   ip access-group ${aclv4} ${dirKw}`);
      } else {
        lines.push(`interface <interface>`);
        lines.push(`   ip access-group ${aclv4} in`);
        lines.push(`   ip access-group ${aclv4} out`);
      }
      lines.push('!');
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(cm(`IPv6 Bogon Filter — Arista EOS`));
      lines.push(`ipv6 access-list ${aclv6}`);
      let lastCat = '';
      let seq = 10;
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(`   remark ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(`   ${seq} ${deny} ipv6 ${e.cidr} any`);
        seq += 10;
      }
      lines.push(`   ${seq} ${permit} ipv6 any any`);
      lines.push('!');
      if (dir !== 'both') {
        lines.push(`interface <interface>`);
        lines.push(`   ipv6 access-group ${aclv6} ${dirKw}`);
      } else {
        lines.push(`interface <interface>`);
        lines.push(`   ipv6 access-group ${aclv6} in`);
        lines.push(`   ipv6 access-group ${aclv6} out`);
      }
      lines.push('!');
    }

    return lines.join('\n');
  }

  function genAristaPrefix(v4entries, v6entries, name, act) {
    // Arista prefix-list syntax identical to IOS
    return genCiscoIosPrefix(v4entries, v6entries, name, act);
  }

  function genMikrotik(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const listName = name || 'bogon-filter';
    const listName6 = name ? `${name}-v6` : 'bogon-filter-v6';
    const drop = act === 'deny' ? 'drop' : 'accept';
    const accept = act === 'deny' ? 'accept' : 'drop';
    const chainDir = dir === 'outbound' ? 'output' : 'forward';

    lines.push(`# IPv4 Bogon / Martian Filter — MikroTik RouterOS — generated by NetEngKit`);
    lines.push(`# Step 1: Create address lists`);
    lines.push('');

    if (v4entries.length) {
      let lastCat = '';
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(`/ip firewall address-list add list=${listName} address=${e.cidr} comment="${catLabel(e.catKey)}"`);
      }
      lines.push('');
      lines.push(`# Step 2: Add filter rule (place at top of chain)`);
      if (dir !== 'both') {
        lines.push(`/ip firewall filter add chain=${chainDir} src-address-list=${listName} action=${drop} comment="Drop IPv4 bogons" place-before=0`);
      } else {
        lines.push(`/ip firewall filter add chain=forward src-address-list=${listName} action=${drop} comment="Drop IPv4 bogons (forward in)" place-before=0`);
        lines.push(`/ip firewall filter add chain=output src-address-list=${listName} action=${drop} comment="Drop IPv4 bogons (output)" place-before=0`);
      }
      lines.push('');
    }

    if (v6entries.length) {
      lines.push(`# IPv6 Bogon Address Lists`);
      let lastCat = '';
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(`/ipv6 firewall address-list add list=${listName6} address=${e.cidr} comment="${catLabel(e.catKey)}"`);
      }
      lines.push('');
      lines.push(`# IPv6 filter rule`);
      if (dir !== 'both') {
        lines.push(`/ipv6 firewall filter add chain=${chainDir} src-address-list=${listName6} action=${drop} comment="Drop IPv6 bogons" place-before=0`);
      } else {
        lines.push(`/ipv6 firewall filter add chain=forward src-address-list=${listName6} action=${drop} comment="Drop IPv6 bogons (forward)" place-before=0`);
        lines.push(`/ipv6 firewall filter add chain=output src-address-list=${listName6} action=${drop} comment="Drop IPv6 bogons (output)" place-before=0`);
      }
    }

    return lines.join('\n');
  }

  function genIptables(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const drop = act === 'deny' ? 'DROP' : 'ACCEPT';
    const chainDir = dir === 'outbound' ? 'OUTPUT' : 'INPUT';

    if (v4entries.length) {
      lines.push(`# IPv4 Bogon / Martian Filter — iptables — generated by NetEngKit`);
      lines.push(`# Flush existing bogon chain if it exists`);
      lines.push(`iptables -N BOGON_FILTER 2>/dev/null || iptables -F BOGON_FILTER`);
      lines.push('');
      let lastCat = '';
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(`iptables -A BOGON_FILTER -s ${e.cidr} -j ${drop}`);
      }
      lines.push('');
      lines.push(`# Jump to bogon chain from main chain`);
      if (dir !== 'both') {
        lines.push(`iptables -I ${chainDir} 1 -j BOGON_FILTER`);
      } else {
        lines.push(`iptables -I INPUT 1 -j BOGON_FILTER`);
        lines.push(`iptables -I OUTPUT 1 -j BOGON_FILTER`);
        lines.push(`iptables -I FORWARD 1 -j BOGON_FILTER`);
      }
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(`# IPv6 Bogon / Martian Filter — ip6tables`);
      lines.push(`ip6tables -N BOGON6_FILTER 2>/dev/null || ip6tables -F BOGON6_FILTER`);
      lines.push('');
      let lastCat = '';
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(`ip6tables -A BOGON6_FILTER -s ${e.cidr} -j ${drop}`);
      }
      lines.push('');
      lines.push(`# Jump to bogon chain`);
      if (dir !== 'both') {
        lines.push(`ip6tables -I ${chainDir} 1 -j BOGON6_FILTER`);
      } else {
        lines.push(`ip6tables -I INPUT 1 -j BOGON6_FILTER`);
        lines.push(`ip6tables -I OUTPUT 1 -j BOGON6_FILTER`);
        lines.push(`ip6tables -I FORWARD 1 -j BOGON6_FILTER`);
      }
    }

    return lines.join('\n');
  }

  function genNftables(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const drop = act === 'deny' ? 'drop' : 'accept';
    const accept = act === 'deny' ? 'accept' : 'drop';
    const setName = name || 'bogon_v4';
    const setName6 = name ? `${name}_v6` : 'bogon_v6';

    lines.push(`# IPv4/IPv6 Bogon / Martian Filter — nftables — generated by NetEngKit`);
    lines.push(`table inet bogon_filter {`);
    lines.push('');

    if (v4entries.length) {
      lines.push(`  # IPv4 bogon set`);
      lines.push(`  set ${setName} {`);
      lines.push(`    type ipv4_addr`);
      lines.push(`    flags interval`);
      lines.push(`    elements = {`);
      let lastCat = '';
      const elements = [];
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          elements.push(`      # ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        elements.push(`      ${e.cidr},`);
      }
      lines.push(...elements);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push('');
    }

    if (v6entries.length) {
      lines.push(`  # IPv6 bogon set`);
      lines.push(`  set ${setName6} {`);
      lines.push(`    type ipv6_addr`);
      lines.push(`    flags interval`);
      lines.push(`    elements = {`);
      let lastCat = '';
      const elements = [];
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          elements.push(`      # ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        elements.push(`      ${e.cidr},`);
      }
      lines.push(...elements);
      lines.push(`    }`);
      lines.push(`  }`);
      lines.push('');
    }

    lines.push(`  chain input {`);
    lines.push(`    type filter hook input priority 0; policy ${accept};`);
    if (v4entries.length) {
      lines.push(`    ip saddr @${setName} ${drop} comment "IPv4 bogon"`);
    }
    if (v6entries.length) {
      lines.push(`    ip6 saddr @${setName6} ${drop} comment "IPv6 bogon"`);
    }
    lines.push(`  }`);

    if (dir === 'outbound' || dir === 'both') {
      lines.push(`  chain output {`);
      lines.push(`    type filter hook output priority 0; policy ${accept};`);
      if (v4entries.length) {
        lines.push(`    ip daddr @${setName} ${drop} comment "IPv4 bogon out"`);
      }
      if (v6entries.length) {
        lines.push(`    ip6 daddr @${setName6} ${drop} comment "IPv6 bogon out"`);
      }
      lines.push(`  }`);
    }

    if (dir === 'both') {
      lines.push(`  chain forward {`);
      lines.push(`    type filter hook forward priority 0; policy ${accept};`);
      if (v4entries.length) {
        lines.push(`    ip saddr @${setName} ${drop} comment "IPv4 bogon forward"`);
      }
      if (v6entries.length) {
        lines.push(`    ip6 saddr @${setName6} ${drop} comment "IPv6 bogon forward"`);
      }
      lines.push(`  }`);
    }

    lines.push(`}`);
    return lines.join('\n');
  }

  function genPf(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const tableName = name ? name.replace(/[^a-z0-9_]/gi, '_') : 'bogons';
    const tableName6 = `${tableName}_v6`;
    const drop = act === 'deny' ? 'block' : 'pass';
    const dirKw = dir === 'outbound' ? 'out' : 'in';

    lines.push(`# IPv4/IPv6 Bogon / Martian Filter — BSD pf — generated by NetEngKit`);
    lines.push('');

    if (v4entries.length) {
      lines.push(`# IPv4 bogon table`);
      lines.push(`table <${tableName}> persist { \\`);
      let lastCat = '';
      const tableEntries = [];
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          tableEntries.push(`  # ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        tableEntries.push(`  ${e.cidr}, \\`);
      }
      lines.push(...tableEntries);
      lines.push(`}`);
      lines.push('');
    }

    if (v6entries.length) {
      lines.push(`# IPv6 bogon table`);
      lines.push(`table <${tableName6}> persist { \\`);
      let lastCat = '';
      const tableEntries = [];
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          tableEntries.push(`  # ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        tableEntries.push(`  ${e.cidr}, \\`);
      }
      lines.push(...tableEntries);
      lines.push(`}`);
      lines.push('');
    }

    lines.push(`# Filter rules`);
    if (v4entries.length) {
      if (dir !== 'both') {
        lines.push(`${drop} quick ${dirKw} from <${tableName}> to any`);
      } else {
        lines.push(`${drop} quick in from <${tableName}> to any`);
        lines.push(`${drop} quick out from any to <${tableName}>`);
      }
    }
    if (v6entries.length) {
      if (dir !== 'both') {
        lines.push(`${drop} quick inet6 ${dirKw} from <${tableName6}> to any`);
      } else {
        lines.push(`${drop} quick inet6 in from <${tableName6}> to any`);
        lines.push(`${drop} quick inet6 out from any to <${tableName6}>`);
      }
    }

    return lines.join('\n');
  }

  function genVyos(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const fwName = name || 'BOGON_FILTER';
    const fwName6 = name ? `${name}_V6` : 'BOGON_V6_FILTER';
    const drop = act === 'deny' ? 'drop' : 'accept';
    const accept = act === 'deny' ? 'accept' : 'drop';
    const dirKw = dir === 'outbound' ? 'out' : 'in';

    if (v4entries.length) {
      lines.push(`# IPv4 Bogon Filter — VyOS — generated by NetEngKit`);
      lines.push(`set firewall name ${fwName} default-action ${accept}`);
      lines.push(`set firewall name ${fwName} description 'IPv4 Bogon/Martian Filter'`);
      let ruleNum = 10;
      let lastCat = '';
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(`set firewall name ${fwName} rule ${ruleNum} action ${drop}`);
        lines.push(`set firewall name ${fwName} rule ${ruleNum} source address ${e.cidr}`);
        lines.push(`set firewall name ${fwName} rule ${ruleNum} description '${catLabel(e.catKey)}'`);
        ruleNum += 10;
      }
      lines.push('');
      lines.push(`# Apply to interface`);
      if (dir !== 'both') {
        lines.push(`set interfaces ethernet <ethX> firewall ${dirKw} name ${fwName}`);
      } else {
        lines.push(`set interfaces ethernet <ethX> firewall in name ${fwName}`);
        lines.push(`set interfaces ethernet <ethX> firewall out name ${fwName}`);
      }
      lines.push('');
    }

    if (v6entries.length) {
      lines.push(`# IPv6 Bogon Filter — VyOS`);
      lines.push(`set firewall ipv6-name ${fwName6} default-action ${accept}`);
      lines.push(`set firewall ipv6-name ${fwName6} description 'IPv6 Bogon/Martian Filter'`);
      let ruleNum = 10;
      let lastCat = '';
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(`set firewall ipv6-name ${fwName6} rule ${ruleNum} action ${drop}`);
        lines.push(`set firewall ipv6-name ${fwName6} rule ${ruleNum} source address ${e.cidr}`);
        lines.push(`set firewall ipv6-name ${fwName6} rule ${ruleNum} description '${catLabel(e.catKey)}'`);
        ruleNum += 10;
      }
      lines.push('');
      lines.push(`# Apply to interface`);
      if (dir !== 'both') {
        lines.push(`set interfaces ethernet <ethX> firewall ${dirKw} ipv6-name ${fwName6}`);
      } else {
        lines.push(`set interfaces ethernet <ethX> firewall in ipv6-name ${fwName6}`);
        lines.push(`set interfaces ethernet <ethX> firewall out ipv6-name ${fwName6}`);
      }
    }

    return lines.join('\n');
  }

  function genFortigate(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const grpName = name || 'GRP_BOGONS';
    const grpName6 = name ? `${name}_V6` : 'GRP_BOGONS_V6';
    const drop = act === 'deny' ? 'deny' : 'accept';
    const accept = act === 'deny' ? 'accept' : 'deny';

    if (v4entries.length) {
      lines.push(`# IPv4 Bogon / Martian Filter — FortiGate — generated by NetEngKit`);
      lines.push(`# Step 1: Create address objects`);
      lines.push('');
      const objNames = [];
      let objIdx = 1;
      let lastCat = '';
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const objName = `BOGON_${objIdx}`;
        objNames.push(objName);
        const { ip, mask } = parseNet(e.cidr);
        lines.push(`config firewall address`);
        lines.push(`    edit "${objName}"`);
        lines.push(`        set type ipmask`);
        lines.push(`        set subnet ${ip} ${mask}`);
        lines.push(`        set comment "${catLabel(e.catKey)}"`);
        lines.push(`    next`);
        lines.push(`end`);
        objIdx++;
      }
      lines.push('');
      lines.push(`# Step 2: Create address group`);
      lines.push(`config firewall addrgrp`);
      lines.push(`    edit "${grpName}"`);
      for (const on of objNames) {
        lines.push(`        append member "${on}"`);
      }
      lines.push(`    next`);
      lines.push(`end`);
      lines.push('');
      lines.push(`# Step 3: Create firewall policy`);
      lines.push(`config firewall policy`);
      lines.push(`    edit 0`);
      lines.push(`        set name "Block_Bogons"`);
      if (dir === 'outbound') {
        lines.push(`        set srcintf "internal"`);
        lines.push(`        set dstintf "wan1"`);
        lines.push(`        set dstaddr "${grpName}"`);
      } else {
        lines.push(`        set srcintf "wan1"`);
        lines.push(`        set dstintf "internal"`);
        lines.push(`        set srcaddr "${grpName}"`);
      }
      lines.push(`        set action ${drop}`);
      lines.push(`        set schedule "always"`);
      lines.push(`        set service "ALL"`);
      lines.push(`        set logtraffic all`);
      lines.push(`    next`);
      lines.push(`end`);
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(`# IPv6 Bogon / Martian Filter — FortiGate`);
      const objNames6 = [];
      let objIdx = 1;
      let lastCat = '';
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const objName = `BOGON6_${objIdx}`;
        objNames6.push(objName);
        lines.push(`config firewall address6`);
        lines.push(`    edit "${objName}"`);
        lines.push(`        set type ipprefix`);
        lines.push(`        set ip6 ${e.cidr}`);
        lines.push(`        set comment "${catLabel(e.catKey)}"`);
        lines.push(`    next`);
        lines.push(`end`);
        objIdx++;
      }
      lines.push('');
      lines.push(`config firewall addrgrp6`);
      lines.push(`    edit "${grpName6}"`);
      for (const on of objNames6) {
        lines.push(`        append member "${on}"`);
      }
      lines.push(`    next`);
      lines.push(`end`);
    }

    return lines.join('\n');
  }

  function genCheckpoint(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const grpName = name || 'Bogon_Networks';
    const drop = act === 'deny' ? 'Drop' : 'Accept';
    const accept = act === 'deny' ? 'Accept' : 'Drop';

    lines.push(`# Bogon / Martian Filter — Check Point — generated by NetEngKit`);
    lines.push(`# Use SmartConsole to create network objects, or use mgmt_cli:`);
    lines.push('');

    const allV4 = v4entries;
    const allV6 = v6entries;

    if (allV4.length) {
      lines.push(`# Step 1: Create IPv4 network objects`);
      let lastCat = '';
      let objIdx = 1;
      const objNames = [];
      for (const e of allV4) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const objName = `Bogon_${objIdx}`;
        objNames.push(objName);
        const { ip, mask } = parseNet(e.cidr);
        lines.push(`mgmt_cli add network name "${objName}" subnet "${ip}" subnet-mask "${mask}" comments "${catLabel(e.catKey)}"`);
        objIdx++;
      }
      lines.push('');
      lines.push(`# Step 2: Create group`);
      lines.push(`mgmt_cli add group name "${grpName}" members.1 "${objNames[0]}" ${objNames.slice(1).map((n, i) => `members.${i+2} "${n}"`).join(' ')}`);
      lines.push('');
      lines.push(`# Step 3: Add access rule`);
      lines.push(`mgmt_cli add access-rule layer "Network" position "top" name "Block Bogons" source "${grpName}" destination "Any" action "${drop}" track "Log"`);
    }

    if (allV6.length) {
      lines.push('');
      lines.push(`# IPv6 objects`);
      let lastCat = '';
      let objIdx = 1;
      for (const e of allV6) {
        if (e.catKey !== lastCat) {
          lines.push(`# ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const objName = `Bogon6_${objIdx}`;
        lines.push(`mgmt_cli add network name "${objName}" subnet "${e.cidr}" comments "${catLabel(e.catKey)}"`);
        objIdx++;
      }
    }

    return lines.join('\n');
  }

  function genHpComware(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const aclNum = 3000;
    const aclNum6 = 3001;
    const deny = act === 'deny' ? 'deny' : 'permit';
    const permit = act === 'deny' ? 'permit' : 'deny';
    const dirKw = dir === 'outbound' ? 'outbound' : 'inbound';
    const cm = (txt) => commentLine('hp-comware', txt);

    if (v4entries.length) {
      lines.push(cm(`IPv4 Bogon Filter — HP/H3C Comware — generated by NetEngKit`));
      lines.push(`acl advanced ${aclNum}`);
      let lastCat = '';
      let ruleNum = 0;
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(` description ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const { ip, wc } = parseNet(e.cidr);
        lines.push(` rule ${ruleNum} ${deny} ip source ${ip} ${wc}`);
        ruleNum += 5;
      }
      lines.push(` rule ${ruleNum} ${permit} ip`);
      lines.push('#');
      lines.push(cm(`Apply to interface`));
      lines.push(`interface <interface>`);
      if (dir !== 'both') {
        lines.push(` packet-filter ${aclNum} ${dirKw}`);
      } else {
        lines.push(` packet-filter ${aclNum} inbound`);
        lines.push(` packet-filter ${aclNum} outbound`);
      }
      lines.push('#');
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(cm(`IPv6 Bogon Filter — HP/H3C Comware`));
      lines.push(`acl ipv6 advanced ${aclNum6}`);
      let lastCat = '';
      let ruleNum = 0;
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(` description ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(` rule ${ruleNum} ${deny} ipv6 source ${e.cidr}`);
        ruleNum += 5;
      }
      lines.push(` rule ${ruleNum} ${permit} ipv6`);
      lines.push('#');
      lines.push(`interface <interface>`);
      if (dir !== 'both') {
        lines.push(` packet-filter ipv6 ${aclNum6} ${dirKw}`);
      } else {
        lines.push(` packet-filter ipv6 ${aclNum6} inbound`);
        lines.push(` packet-filter ipv6 ${aclNum6} outbound`);
      }
      lines.push('#');
    }

    return lines.join('\n');
  }

  function genHuawei(v4entries, v6entries, name, dir, act) {
    const lines = [];
    const aclNum = 3000;
    const aclNum6 = 3001;
    const deny = act === 'deny' ? 'deny' : 'permit';
    const permit = act === 'deny' ? 'permit' : 'deny';
    const dirKw = dir === 'outbound' ? 'outbound' : 'inbound';
    const cm = (txt) => commentLine('huawei', txt);

    if (v4entries.length) {
      lines.push(cm(`IPv4 Bogon Filter — Huawei VRP — generated by NetEngKit`));
      lines.push(`acl number ${aclNum}`);
      let lastCat = '';
      let ruleNum = 5;
      for (const e of v4entries) {
        if (e.catKey !== lastCat) {
          lines.push(` description ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        const { ip, wc } = parseNet(e.cidr);
        lines.push(` rule ${ruleNum} ${deny} ip source ${ip} ${wc}`);
        ruleNum += 5;
      }
      lines.push(` rule ${ruleNum} ${permit} ip`);
      lines.push('#');
      lines.push(`interface <interface>`);
      if (dir !== 'both') {
        lines.push(` traffic-filter ${dirKw} acl ${aclNum}`);
      } else {
        lines.push(` traffic-filter inbound acl ${aclNum}`);
        lines.push(` traffic-filter outbound acl ${aclNum}`);
      }
      lines.push('#');
    }

    if (v6entries.length) {
      lines.push('');
      lines.push(cm(`IPv6 Bogon Filter — Huawei VRP`));
      lines.push(`acl ipv6 number ${aclNum6}`);
      let lastCat = '';
      let ruleNum = 5;
      for (const e of v6entries) {
        if (e.catKey !== lastCat) {
          lines.push(` description ${catLabel(e.catKey)}${rfcNote(e.rfcs)}`);
          lastCat = e.catKey;
        }
        lines.push(` rule ${ruleNum} ${deny} ipv6 source ${e.cidr}`);
        ruleNum += 5;
      }
      lines.push(` rule ${ruleNum} ${permit} ipv6`);
      lines.push('#');
      lines.push(`interface <interface>`);
      if (dir !== 'both') {
        lines.push(` traffic-filter ipv6 ${dirKw} acl ${aclNum6}`);
      } else {
        lines.push(` traffic-filter ipv6 inbound acl ${aclNum6}`);
        lines.push(` traffic-filter ipv6 outbound acl ${aclNum6}`);
      }
      lines.push('#');
    }

    return lines.join('\n');
  }

  // ─── Main generate function ───────────────────────────────────────────────
  function generate() {
    const { v4, v6 } = getActiveCidrs();

    if (!v4.length && !v6.length) {
      setOutput(t('bogon_filter.no_categories_selected'));
      return;
    }

    const nm = (aclName || '').trim();
    let out = '';

    switch (platform) {
      case 'cisco-ios-acl':    out = genCiscoIosAcl(v4, v6, nm, direction, action); break;
      case 'cisco-ios-prefix': out = genCiscoIosPrefix(v4, v6, nm, action); break;
      case 'cisco-nxos-acl':   out = genCiscoNxosAcl(v4, v6, nm, direction, action); break;
      case 'cisco-nxos-prefix': out = genCiscoNxosPrefix(v4, v6, nm, action); break;
      case 'cisco-xr-acl':    out = genCiscoXrAcl(v4, v6, nm, direction, action); break;
      case 'cisco-xr-prefix':  out = genCiscoXrPrefix(v4, v6, nm, action); break;
      case 'cisco-asa':        out = genCiscoAsaAcl(v4, v6, nm, direction, action); break;
      case 'junos-filter':     out = genJunosFilter(v4, v6, nm, direction, action); break;
      case 'junos-prefix':     out = genJunosPrefix(v4, v6, nm, action); break;
      case 'arista-acl':       out = genAristaAcl(v4, v6, nm, direction, action); break;
      case 'arista-prefix':    out = genAristaPrefix(v4, v6, nm, action); break;
      case 'mikrotik':         out = genMikrotik(v4, v6, nm, direction, action); break;
      case 'iptables':         out = genIptables(v4, v6, nm, direction, action); break;
      case 'nftables':         out = genNftables(v4, v6, nm, direction, action); break;
      case 'pf':               out = genPf(v4, v6, nm, direction, action); break;
      case 'vyos':             out = genVyos(v4, v6, nm, direction, action); break;
      case 'fortigate':        out = genFortigate(v4, v6, nm, direction, action); break;
      case 'checkpoint':       out = genCheckpoint(v4, v6, nm, direction, action); break;
      case 'hp-comware':       out = genHpComware(v4, v6, nm, direction, action); break;
      case 'huawei':           out = genHuawei(v4, v6, nm, direction, action); break;
      default:                 out = genCiscoIosAcl(v4, v6, nm, direction, action);
    }

    setOutput(out);
  }

  // ─── Auto-calc with debounce ──────────────────────────────────────────────
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(generate, 300);
    return () => clearTimeout(debounceRef.current);
  }, [platform, direction, aclName, categories, includeV4, includeV6, action]);

  // ─── Download helper ──────────────────────────────────────────────────────
  function handleDownload() {
    if (!output) return;
    const ext = platform.includes('prefix') ? 'txt' : platform === 'nftables' ? 'nft' : platform === 'pf' ? 'conf' : 'txt';
    const blob = new Blob([output + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bogon-filter-${platform}.${ext}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ─── Category toggle ──────────────────────────────────────────────────────
  function toggleCategory(key) {
    setCategories(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
  }

  // ─── Is prefix-list platform (direction doesn't apply) ───────────────────
  const isPrefixPlatform = platform === 'cisco-ios-prefix' || platform === 'cisco-nxos-prefix' ||
    platform === 'cisco-xr-prefix' || platform === 'junos-prefix' || platform === 'arista-prefix';

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fadein">
      <div className="card">
        <div className="card-title">{t('bogon_filter.title')}</div>
        <p style={{marginTop: 0, marginBottom: '1rem', color: 'var(--muted)', fontSize: '0.875rem'}}>
          {t('bogon_filter.subtitle')}
        </p>

        {/* Platform + Direction row */}
        <div className="two-col">
          <div className="field">
            <label className="label">{t('bogon_filter.platform_label')}</label>
            <select className="select" value={platform} onChange={e => setPlatform(e.target.value)}>
              <optgroup label={t('bogon_filter.optgroup_cisco')}>
                <option value="cisco-ios-acl">{t('bogon_filter.plat_cisco_ios_acl')}</option>
                <option value="cisco-ios-prefix">{t('bogon_filter.plat_cisco_ios_prefix')}</option>
                <option value="cisco-nxos-acl">{t('bogon_filter.plat_cisco_nxos_acl')}</option>
                <option value="cisco-nxos-prefix">{t('bogon_filter.plat_cisco_nxos_prefix')}</option>
                <option value="cisco-xr-acl">{t('bogon_filter.plat_cisco_xr_acl')}</option>
                <option value="cisco-xr-prefix">{t('bogon_filter.plat_cisco_xr_prefix')}</option>
                <option value="cisco-asa">{t('bogon_filter.plat_cisco_asa')}</option>
              </optgroup>
              <optgroup label={t('bogon_filter.optgroup_juniper')}>
                <option value="junos-filter">{t('bogon_filter.plat_junos_filter')}</option>
                <option value="junos-prefix">{t('bogon_filter.plat_junos_prefix')}</option>
              </optgroup>
              <optgroup label={t('bogon_filter.optgroup_arista')}>
                <option value="arista-acl">{t('bogon_filter.plat_arista_acl')}</option>
                <option value="arista-prefix">{t('bogon_filter.plat_arista_prefix')}</option>
              </optgroup>
              <optgroup label={t('bogon_filter.optgroup_linux')}>
                <option value="iptables">{t('bogon_filter.plat_iptables')}</option>
                <option value="nftables">{t('bogon_filter.plat_nftables')}</option>
              </optgroup>
              <optgroup label={t('bogon_filter.optgroup_other')}>
                <option value="mikrotik">{t('bogon_filter.plat_mikrotik')}</option>
                <option value="pf">{t('bogon_filter.plat_pf')}</option>
                <option value="vyos">{t('bogon_filter.plat_vyos')}</option>
                <option value="fortigate">{t('bogon_filter.plat_fortigate')}</option>
                <option value="checkpoint">{t('bogon_filter.plat_checkpoint')}</option>
                <option value="hp-comware">{t('bogon_filter.plat_hp_comware')}</option>
                <option value="huawei">{t('bogon_filter.plat_huawei')}</option>
              </optgroup>
            </select>
          </div>

          <div className="field">
            <label className="label">{t('bogon_filter.direction_label')}</label>
            <select className="select" value={direction} onChange={e => setDirection(e.target.value)} disabled={isPrefixPlatform}>
              <option value="inbound">{t('bogon_filter.dir_inbound')}</option>
              <option value="outbound">{t('bogon_filter.dir_outbound')}</option>
              <option value="both">{t('bogon_filter.dir_both')}</option>
            </select>
            {isPrefixPlatform && (
              <span className="hint">{t('bogon_filter.prefix_dir_hint')}</span>
            )}
          </div>
        </div>

        {/* ACL Name + Action row */}
        <div className="two-col">
          <div className="field">
            <label className="label">{t('bogon_filter.acl_name_label')}</label>
            <input
              className="input"
              type="text"
              value={aclName}
              onChange={e => setAclName(e.target.value)}
              placeholder={t('bogon_filter.acl_name_placeholder')}
            />
            <span className="hint">{t('bogon_filter.acl_name_hint')}</span>
          </div>

          <div className="field">
            <label className="label">{t('bogon_filter.action_label')}</label>
            <select className="select" value={action} onChange={e => setAction(e.target.value)}>
              <option value="deny">{t('bogon_filter.action_deny')}</option>
              <option value="permit">{t('bogon_filter.action_permit')}</option>
            </select>
            <span className="hint">{t('bogon_filter.action_hint')}</span>
          </div>
        </div>

        {/* IP Version toggles */}
        <div className="field" style={{marginBottom: '0.5rem'}}>
          <label className="label">{t('bogon_filter.ip_version_label')}</label>
          <div style={{display: 'flex', gap: '1.5rem'}}>
            <label style={{display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer'}}>
              <input type="checkbox" checked={includeV4} onChange={e => setIncludeV4(e.target.checked)} />
              {t('bogon_filter.include_ipv4')}
            </label>
            <label style={{display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer'}}>
              <input type="checkbox" checked={includeV6} onChange={e => setIncludeV6(e.target.checked)} />
              {t('bogon_filter.include_ipv6')}
            </label>
          </div>
        </div>
      </div>

      {/* RFC Category selection */}
      <div className="card">
        <div className="card-title">{t('bogon_filter.categories_title')}</div>
        <p style={{marginTop: 0, marginBottom: '0.75rem', color: 'var(--muted)', fontSize: '0.875rem'}}>
          {t('bogon_filter.categories_hint')}
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
          gap: '0.5rem',
        }}>
          {BOGON_CATEGORIES.map(cat => {
            const checked = categories.includes(cat.key);
            const v4List = cat.cidrs_v4.join(', ');
            const v6List = cat.cidrs_v6.join(', ');
            const cidrSummary = [v4List, v6List].filter(Boolean).join(' | ');
            return (
              <label key={cat.key} style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.6rem',
                cursor: 'pointer',
                padding: '0.5rem 0.6rem',
                borderRadius: '6px',
                border: `1px solid ${checked ? 'var(--cyan)' : 'var(--border)'}`,
                background: checked ? 'rgba(0, 212, 200, 0.08)' : 'transparent',
                transition: 'border-color 0.15s, background 0.15s',
              }}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleCategory(cat.key)}
                  style={{marginTop: '2px', flexShrink: 0}}
                />
                <div style={{flex: 1, minWidth: 0}}>
                  <div style={{fontWeight: 500, fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap'}}>
                    {t(`bogon_filter.cat_${cat.key}`)}
                    {cat.rfcs.length > 0 && cat.rfcs.map(rfc => (
                      <span key={rfc} style={{fontSize: '0.75rem'}}>
                        <RFCLink rfc={rfc} className="badge badge-blue" />
                      </span>
                    ))}
                  </div>
                  <div style={{fontSize: '0.75rem', color: 'var(--muted)', marginTop: '2px', fontFamily: 'var(--mono)', wordBreak: 'break-all'}}>
                    {cidrSummary}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      </div>

      {/* Output */}
      <div className="card">
        <div style={{display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem', flexWrap: 'wrap', gap: '0.5rem'}}>
          <div className="card-title" style={{marginBottom: 0}}>{t('bogon_filter.output_title')}</div>
          <div className="btn-row" style={{margin: 0}}>
            <CopyBtn text={output} label="copy" id="bogon-output" />
            <button className="btn btn-ghost btn-sm" onClick={handleDownload} disabled={!output}>
              {t('bogon_filter.btn_download')}
            </button>
          </div>
        </div>
        <textarea
          className="input"
          readOnly
          value={output}
          rows={24}
          style={{
            fontFamily: 'var(--mono)',
            fontSize: '0.8rem',
            resize: 'vertical',
            width: '100%',
            boxSizing: 'border-box',
          }}
          spellCheck={false}
          placeholder={t('bogon_filter.output_placeholder')}
        />
      </div>
    </div>
  );
}

window.BogonFilterGen = BogonFilterGen;
