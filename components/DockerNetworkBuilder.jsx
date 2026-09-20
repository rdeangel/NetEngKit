const { useState, useEffect, useCallback, useMemo } = React;

// ── Network driver defaults ───────────────────────────────────────────
const DNB_DEFAULTS = {
  bridge:  { name: 'mynet',     subnet: '172.20.0.0/16', gateway: '172.20.0.1',   ipRange: '', mtu: '1500', icc: true, ipMasq: true, ipForward: true, iptables: true, enableIpv6: false, ipv6Subnet: 'fd00::/80', ipv6Gateway: '', labels: '', driverOpts: '', auxAddresses: '' },
  overlay: { name: 'myoverlay', subnet: '10.0.9.0/24',   gateway: '10.0.9.1',    ipRange: '', attachable: true, encrypted: false, ingress: false, scope: 'swarm', labels: '', driverOpts: '', enableIpv6: false, ipv6Subnet: '' },
  macvlan: { name: 'macnet',    subnet: '192.168.1.0/24',gateway: '192.168.1.1', ipRange: '192.168.1.128/25', parentIface: 'eth0', macvlanMode: 'bridge', labels: '', auxAddresses: '', enableIpv6: false, ipv6Subnet: '', ipv6Gateway: '' },
  ipvlan:  { name: 'ipvnet',    subnet: '192.168.2.0/24',gateway: '192.168.2.1', ipRange: '', parentIface: 'eth0', ipvlanMode: 'l2', ipvlanFlag: '', labels: '', enableIpv6: false, ipv6Subnet: '' },
  host:    { name: 'host' },
  none:    { name: 'none' },
};

// ── Row factories ─────────────────────────────────────────────────────
const DNB_MK_ID  = () => Math.random().toString(36).slice(2);
const DNB_MK_PORT = () => ({ id: DNB_MK_ID(), hostIp: '', hostPort: '', containerPort: '', protocol: 'tcp' });
const DNB_MK_VOL  = () => ({ id: DNB_MK_ID(), type: 'bind', source: '', target: '', readOnly: false });
const DNB_MK_ENV  = () => ({ id: DNB_MK_ID(), key: '', value: '' });
const DNB_MK_NVOL = () => ({ id: DNB_MK_ID(), name: '', driver: 'local', external: false });
const DNB_MK_XNET = () => ({ id: DNB_MK_ID(), name: '', driver: 'bridge', external: false });

function dnbMkService(n) {
  return {
    id: DNB_MK_ID(), expanded: true,
    name: `service${n}`, image: 'nginx:latest', containerName: '',
    restart: 'unless-stopped', command: '', entrypoint: '', workingDir: '',
    privileged: false, readOnly: false,
    ports: [], volumes: [], environment: [], envFile: '',
    attachedNets: [], staticIps: {}, netAliases: {},
    dependsOn: '', labels: '',
    healthcheck: { enabled: false, test: '', interval: '30s', timeout: '10s', retries: '3', startPeriod: '0s' },
    replicas: '', cpuLimit: '', memLimit: '',
  };
}

// ── docker network create CLI builders (unchanged) ────────────────────
function dnbBuildDockerCmd(type, cfg) {
  if (type === 'host') return `docker network create \\\n  --driver host \\\n  host`;
  if (type === 'none') return `docker network create \\\n  --driver null \\\n  none`;
  const parts = [`docker network create \\`];
  parts.push(`  --driver ${type} \\`);
  const push = (flag, val) => { if (val) parts.push(`  ${flag} ${val} \\`); };
  push('--subnet', cfg.subnet); push('--gateway', cfg.gateway);
  if (cfg.ipRange) push('--ip-range', cfg.ipRange);
  if (type === 'bridge') {
    if (cfg.mtu && cfg.mtu !== '1500') parts.push(`  --opt com.docker.network.bridge.mtu=${cfg.mtu} \\`);
    if (!cfg.icc) parts.push(`  --opt com.docker.network.bridge.enable_icc=false \\`);
    if (!cfg.ipMasq) parts.push(`  --opt com.docker.network.bridge.enable_ip_masquerade=false \\`);
    if (!cfg.iptables) parts.push(`  --opt com.docker.network.bridge.enable_iptables=false \\`);
  }
  if (type === 'overlay') {
    if (cfg.attachable) parts.push(`  --attachable \\`);
    if (cfg.encrypted) parts.push(`  --opt encrypted \\`);
    if (cfg.ingress)   parts.push(`  --ingress \\`);
  }
  if (type === 'macvlan') {
    push('--opt parent=', cfg.parentIface);
    if (cfg.macvlanMode && cfg.macvlanMode !== 'bridge') push('--opt macvlan_mode=', cfg.macvlanMode);
    if (cfg.auxAddresses) {
      for (const a of cfg.auxAddresses.split(',').map(s => s.trim()).filter(Boolean))
        parts.push(`  --aux-address ${a} \\`);
    }
  }
  if (type === 'ipvlan') {
    push('--opt parent=', cfg.parentIface);
    if (cfg.ipvlanMode && cfg.ipvlanMode !== 'l2') push('--opt ipvlan_mode=', cfg.ipvlanMode);
    if (cfg.ipvlanFlag) push('--opt ipvlan_flag=', cfg.ipvlanFlag);
  }
  if (cfg.enableIpv6 && cfg.ipv6Subnet) {
    parts.push(`  --ipv6 \\`); push('--subnet', cfg.ipv6Subnet);
    if (cfg.ipv6Gateway) push('--gateway', cfg.ipv6Gateway);
  }
  if (cfg.labels) for (const l of cfg.labels.split('\n').map(s => s.trim()).filter(Boolean)) parts.push(`  --label ${l} \\`);
  if (cfg.driverOpts) for (const o of cfg.driverOpts.split('\n').map(s => s.trim()).filter(Boolean)) parts.push(`  --opt ${o} \\`);
  parts.push(`  ${cfg.name || 'mynet'}`);
  return parts.join('\n').replace(/ \\$/, '');
}

function dnbBuildPodmanCmd(type, cfg) {
  if (type === 'host') return `podman network create \\\n  --driver host \\\n  host`;
  if (type === 'none') return `podman network create \\\n  --driver null \\\n  none`;
  const parts = [`podman network create \\`];
  parts.push(`  --driver ${type === 'overlay' ? 'bridge' : type} \\`);
  const push = (flag, val) => { if (val) parts.push(`  ${flag} ${val} \\`); };
  push('--subnet', cfg.subnet); push('--gateway', cfg.gateway);
  if (cfg.ipRange) push('--ip-range', cfg.ipRange);
  if (type === 'bridge' && cfg.mtu && cfg.mtu !== '1500') push('--interface-name mtu=', cfg.mtu);
  if (type === 'macvlan') push('--interface-name', cfg.parentIface);
  if (type === 'ipvlan') { push('--interface-name', cfg.parentIface); if (cfg.ipvlanMode) push('--opt mode=', cfg.ipvlanMode); }
  if (cfg.enableIpv6 && cfg.ipv6Subnet) { parts.push(`  --ipv6 \\`); push('--subnet', cfg.ipv6Subnet); }
  if (cfg.labels) for (const l of cfg.labels.split('\n').map(s => s.trim()).filter(Boolean)) parts.push(`  --label ${l} \\`);
  parts.push(`  ${cfg.name || 'mynet'}`);
  return parts.join('\n').replace(/ \\$/, '');
}

// ── Compose YAML builder (full service spec) ──────────────────────────
function dnbServiceToYaml(svc, indent, primaryNet, allNetNames) {
  const p = ' '.repeat(indent);
  const pp = ' '.repeat(indent + 2);
  const lines = [];

  lines.push(`${p}${svc.name || 'web'}:`);
  lines.push(`${pp}image: ${svc.image || 'nginx:latest'}`);
  if (svc.containerName) lines.push(`${pp}container_name: ${svc.containerName}`);
  if (svc.restart && svc.restart !== 'no') lines.push(`${pp}restart: ${svc.restart}`);
  if (svc.command)    lines.push(`${pp}command: ${svc.command}`);
  if (svc.entrypoint) lines.push(`${pp}entrypoint: ${svc.entrypoint}`);
  if (svc.workingDir) lines.push(`${pp}working_dir: ${svc.workingDir}`);
  if (svc.privileged) lines.push(`${pp}privileged: true`);
  if (svc.readOnly)   lines.push(`${pp}read_only: true`);

  // Ports
  const validPorts = (svc.ports || []).filter(p => p.containerPort);
  if (validPorts.length) {
    lines.push(`${pp}ports:`);
    for (const p of validPorts) {
      let s = '';
      if (p.hostIp)   s += `${p.hostIp}:`;
      if (p.hostPort) s += `${p.hostPort}:`;
      s += p.containerPort;
      if (p.protocol && p.protocol !== 'tcp') s += `/${p.protocol}`;
      lines.push(`${pp}  - "${s}"`);
    }
  }

  // Volumes
  const validVols = (svc.volumes || []).filter(v => v.target);
  if (validVols.length) {
    lines.push(`${pp}volumes:`);
    for (const v of validVols) {
      if (v.type === 'tmpfs') {
        lines.push(`${pp}  - type: tmpfs`);
        lines.push(`${pp}    target: ${v.target}`);
      } else if (v.readOnly) {
        lines.push(`${pp}  - type: ${v.type}`);
        if (v.source) lines.push(`${pp}    source: ${v.source}`);
        lines.push(`${pp}    target: ${v.target}`);
        lines.push(`${pp}    read_only: true`);
      } else if (v.source) {
        lines.push(`${pp}  - ${v.source}:${v.target}`);
      } else {
        lines.push(`${pp}  - ${v.target}`);
      }
    }
  }

  // Environment
  const validEnv = (svc.environment || []).filter(e => e.key);
  if (validEnv.length) {
    lines.push(`${pp}environment:`);
    for (const e of validEnv) lines.push(`${pp}  - ${e.key}${e.value !== '' ? '=' + e.value : ''}`);
  }
  if (svc.envFile) {
    const files = svc.envFile.split(',').map(s => s.trim()).filter(Boolean);
    if (files.length) { lines.push(`${pp}env_file:`); for (const f of files) lines.push(`${pp}  - ${f}`); }
  }

  // Networks
  if (primaryNet === 'host' || primaryNet === 'none') {
    lines.push(`${pp}network_mode: "${primaryNet}"`);
  } else {
    const nets = (svc.attachedNets && svc.attachedNets.length) ? svc.attachedNets : [primaryNet];
    const hasOpts = nets.some(n => svc.staticIps?.[n] || svc.netAliases?.[n]);
    lines.push(`${pp}networks:`);
    if (hasOpts) {
      for (const n of nets) {
        if (svc.staticIps?.[n] || svc.netAliases?.[n]) {
          lines.push(`${pp}  ${n}:`);
          if (svc.staticIps[n]) lines.push(`${pp}    ipv4_address: ${svc.staticIps[n]}`);
          if (svc.netAliases[n]) {
            lines.push(`${pp}    aliases:`);
            for (const a of svc.netAliases[n].split(/\s+/).filter(Boolean)) lines.push(`${pp}      - ${a}`);
          }
        } else {
          lines.push(`${pp}  ${n}:`);
        }
      }
    } else {
      for (const n of nets) lines.push(`${pp}  - ${n}`);
    }
  }

  // depends_on
  const deps = svc.dependsOn ? svc.dependsOn.split(',').map(s => s.trim()).filter(Boolean) : [];
  if (deps.length) { lines.push(`${pp}depends_on:`); for (const d of deps) lines.push(`${pp}  - ${d}`); }

  // Healthcheck
  const hc = svc.healthcheck || {};
  if (hc.enabled && hc.test) {
    lines.push(`${pp}healthcheck:`);
    lines.push(`${pp}  test: ${hc.test}`);
    if (hc.interval)    lines.push(`${pp}  interval: ${hc.interval}`);
    if (hc.timeout)     lines.push(`${pp}  timeout: ${hc.timeout}`);
    if (hc.retries)     lines.push(`${pp}  retries: ${hc.retries}`);
    if (hc.startPeriod && hc.startPeriod !== '0s') lines.push(`${pp}  start_period: ${hc.startPeriod}`);
  }

  // Labels
  if (svc.labels) {
    const lbls = svc.labels.split('\n').map(s => s.trim()).filter(Boolean);
    if (lbls.length) { lines.push(`${pp}labels:`); for (const l of lbls) lines.push(`${pp}  - "${l}"`); }
  }

  // Deploy
  if (svc.replicas || svc.cpuLimit || svc.memLimit) {
    lines.push(`${pp}deploy:`);
    if (svc.replicas) lines.push(`${pp}  replicas: ${svc.replicas}`);
    if (svc.cpuLimit || svc.memLimit) {
      lines.push(`${pp}  resources:`);
      lines.push(`${pp}    limits:`);
      if (svc.cpuLimit) lines.push(`${pp}      cpus: '${svc.cpuLimit}'`);
      if (svc.memLimit) lines.push(`${pp}      memory: ${svc.memLimit}`);
    }
  }

  return lines.join('\n');
}

function dnbBuildCompose(netType, cfg, extraNets, services, namedVols) {
  const primaryNet = netType === 'host' || netType === 'none' ? netType : (cfg.name || 'mynet');
  const allNetNames = [primaryNet, ...extraNets.map(n => n.name).filter(Boolean)];
  const lines = [];

  // Services
  if (services.length) {
    lines.push('services:');
    for (const svc of services) lines.push(dnbServiceToYaml(svc, 2, primaryNet, allNetNames));
  }

  // Networks — host/none have no custom network definition
  const netBlk = [];
  if (netType !== 'host' && netType !== 'none') {
  netBlk.push(`  ${primaryNet}:`);
  netBlk.push(`    driver: ${netType}`);
  if (cfg.subnet || cfg.gateway || cfg.ipRange) {
    netBlk.push(`    ipam:`);
    netBlk.push(`      config:`);
    if (cfg.subnet)  netBlk.push(`        - subnet: ${cfg.subnet}`);
    if (cfg.gateway) netBlk.push(`          gateway: ${cfg.gateway}`);
    if (cfg.ipRange) netBlk.push(`          ip_range: ${cfg.ipRange}`);
  }
  if (netType === 'bridge') {
    const opts = [];
    if (cfg.mtu && cfg.mtu !== '1500') opts.push(`      com.docker.network.bridge.mtu: "${cfg.mtu}"`);
    if (!cfg.icc) opts.push(`      com.docker.network.bridge.enable_icc: "false"`);
    if (!cfg.ipMasq) opts.push(`      com.docker.network.bridge.enable_ip_masquerade: "false"`);
    if (opts.length) { netBlk.push(`    driver_opts:`); for (const o of opts) netBlk.push(o); }
  }
  if (netType === 'overlay' && cfg.attachable) netBlk.push(`    attachable: true`);
  if (netType === 'macvlan') {
    const opts = [];
    if (cfg.parentIface) opts.push(`      parent: ${cfg.parentIface}`);
    if (cfg.macvlanMode && cfg.macvlanMode !== 'bridge') opts.push(`      macvlan_mode: ${cfg.macvlanMode}`);
    if (opts.length) { netBlk.push(`    driver_opts:`); for (const o of opts) netBlk.push(o); }
  }
  if (netType === 'ipvlan') {
    const opts = [];
    if (cfg.parentIface) opts.push(`      parent: ${cfg.parentIface}`);
    if (cfg.ipvlanMode && cfg.ipvlanMode !== 'l2') opts.push(`      ipvlan_mode: ${cfg.ipvlanMode}`);
    if (opts.length) { netBlk.push(`    driver_opts:`); for (const o of opts) netBlk.push(o); }
  }
  if (cfg.enableIpv6) netBlk.push(`    enable_ipv6: true`);
  if (cfg.labels) {
    const lbls = cfg.labels.split('\n').map(s => s.trim()).filter(Boolean);
    if (lbls.length) { netBlk.push(`    labels:`); for (const l of lbls) netBlk.push(`      - "${l}"`); }
  }
  } // end if not host/none

  for (const xn of extraNets.filter(n => n.name)) {
    netBlk.push(xn.external ? `  ${xn.name}:\n    external: true` : `  ${xn.name}:\n    driver: ${xn.driver || 'bridge'}`);
  }

  if (netBlk.length) {
    lines.push('', 'networks:');
    lines.push(...netBlk);
  }

  // Named volumes
  const validNVols = namedVols.filter(v => v.name);
  if (validNVols.length) {
    lines.push('', 'volumes:');
    for (const v of validNVols) {
      if (v.external) {
        lines.push(`  ${v.name}:`);
        lines.push(`    external: true`);
      } else {
        lines.push(`  ${v.name}:`);
        lines.push(`    driver: ${v.driver || 'local'}`);
      }
    }
  }

  return lines.join('\n');
}

function dnbBuildPodmanCompose(netType, cfg, services, namedVols) {
  const primaryNet = cfg.name || 'mynet';
  const lines = [`# Podman Compose`, `version: '3'`];

  if (services.length) {
    lines.push('', 'services:');
    for (const svc of services) {
      lines.push(`  ${svc.name || 'web'}:`);
      lines.push(`    image: ${svc.image || 'nginx:latest'}`);
      if (svc.containerName) lines.push(`    container_name: ${svc.containerName}`);
      if (svc.restart && svc.restart !== 'no') lines.push(`    restart: ${svc.restart}`);
      if (svc.command) lines.push(`    command: ${svc.command}`);

      const validPorts = (svc.ports || []).filter(p => p.containerPort);
      if (validPorts.length) {
        lines.push(`    ports:`);
        for (const p of validPorts) {
          let s = '';
          if (p.hostIp)   s += `${p.hostIp}:`;
          if (p.hostPort) s += `${p.hostPort}:`;
          s += p.containerPort;
          if (p.protocol && p.protocol !== 'tcp') s += `/${p.protocol}`;
          lines.push(`      - "${s}"`);
        }
      }

      const validVols = (svc.volumes || []).filter(v => v.target);
      if (validVols.length) {
        lines.push(`    volumes:`);
        for (const v of validVols) {
          if (v.source) lines.push(`      - ${v.source}:${v.target}${v.readOnly ? ':ro' : ''}`);
          else          lines.push(`      - ${v.target}`);
        }
      }

      const validEnv = (svc.environment || []).filter(e => e.key);
      if (validEnv.length) {
        lines.push(`    environment:`);
        for (const e of validEnv) lines.push(`      - ${e.key}${e.value !== '' ? '=' + e.value : ''}`);
      }

      const nets = (svc.attachedNets && svc.attachedNets.length) ? svc.attachedNets : [primaryNet];
      const hasOpts = nets.some(n => svc.staticIps?.[n]);
      lines.push(`    networks:`);
      if (hasOpts) {
        for (const n of nets) {
          lines.push(`      ${n}:`);
          if (svc.staticIps[n]) lines.push(`        ipv4_address: ${svc.staticIps[n]}`);
        }
      } else {
        for (const n of nets) lines.push(`      - ${n}`);
      }

      const deps = svc.dependsOn ? svc.dependsOn.split(',').map(s => s.trim()).filter(Boolean) : [];
      if (deps.length) { lines.push(`    depends_on:`); for (const d of deps) lines.push(`      - ${d}`); }
    }
  }

  lines.push('', 'networks:');
  lines.push(`  ${primaryNet}:`);
  lines.push(`    driver: ${netType === 'overlay' ? 'bridge' : netType}`);
  if (cfg.subnet) {
    lines.push(`    ipam:`, `      config:`, `        - subnet: ${cfg.subnet}`);
    if (cfg.gateway) lines.push(`          gateway: ${cfg.gateway}`);
  }
  if ((netType === 'macvlan' || netType === 'ipvlan') && cfg.parentIface)
    lines.push(`    driver_opts:`, `      parent: ${cfg.parentIface}`);

  const validNVols = namedVols.filter(v => v.name);
  if (validNVols.length) {
    lines.push('', 'volumes:');
    for (const v of validNVols) {
      lines.push(`  ${v.name}:`);
      if (v.external) lines.push(`    external: true`);
      else            lines.push(`    driver: ${v.driver || 'local'}`);
    }
  }

  return lines.join('\n');
}

// ── YAML parser (for Compose validation) ─────────────────────────────
function dnbParseYaml(text) {
  const rawLines = text.split('\n');
  const tokens = [];
  for (let i = 0; i < rawLines.length; i++) {
    const stripped = rawLines[i].replace(/#[^'"]*$/, '').trimEnd();
    if (!stripped.trim()) continue;
    const indent = stripped.length - stripped.trimStart().length;
    tokens.push({ line: i + 1, indent, content: stripped.trimStart() });
  }

  let pos = 0;

  function peek() { return pos < tokens.length ? tokens[pos] : null; }

  function parseScalar(v) {
    v = v.trim();
    if (!v || v === '~' || v.toLowerCase() === 'null') return null;
    if (v.toLowerCase() === 'true'  || v === 'yes') return true;
    if (v.toLowerCase() === 'false' || v === 'no')  return false;
    if (/^-?\d+$/.test(v)) return parseInt(v, 10);
    if (/^-?\d*\.\d+$/.test(v)) return parseFloat(v);
    if ((v[0] === '"' && v[v.length - 1] === '"') || (v[0] === "'" && v[v.length - 1] === "'"))
      return v.slice(1, -1);
    return v;
  }

  function parseBlock(baseIndent) {
    if (!peek() || peek().indent < baseIndent) return null;
    const first = peek();

    if (first.content.startsWith('- ') || first.content === '-') {
      // Sequence
      const arr = [];
      while (peek() && peek().indent === baseIndent && (peek().content.startsWith('- ') || peek().content === '-')) {
        const tok = tokens[pos++];
        const rest = tok.content.slice(1).trimStart();
        if (!rest) {
          // child block
          if (peek() && peek().indent > baseIndent) arr.push(parseBlock(peek().indent));
          else arr.push(null);
        } else if (rest.includes(': ') || rest.endsWith(':')) {
          // inline mapping item
          const obj = {};
          const ci = rest.indexOf(':');
          const k = rest.slice(0, ci).trim();
          const v = rest.slice(ci + 1).trim();
          if (v) obj[k] = parseScalar(v);
          else if (peek() && peek().indent > tok.indent) obj[k] = parseBlock(peek().indent);
          else obj[k] = null;
          // pick up additional keys at the same indent
          while (peek() && peek().indent > baseIndent && peek().indent <= tok.indent + 2 && !peek().content.startsWith('- ')) {
            const t2 = tokens[pos++];
            const ci2 = t2.content.indexOf(':');
            if (ci2 < 0) continue;
            const k2 = t2.content.slice(0, ci2).trim();
            const v2 = t2.content.slice(ci2 + 1).trim();
            if (v2) obj[k2] = parseScalar(v2);
            else if (peek() && peek().indent > t2.indent) obj[k2] = parseBlock(peek().indent);
            else obj[k2] = null;
          }
          arr.push(obj);
        } else {
          arr.push(parseScalar(rest));
        }
      }
      return arr;
    }

    // Mapping
    const obj = {};
    while (peek() && peek().indent === baseIndent) {
      const tok = tokens[pos];
      if (tok.content.startsWith('- ')) break; // parent consumed wrong level
      const ci = tok.content.indexOf(':');
      if (ci < 0) { pos++; continue; }
      const key = tok.content.slice(0, ci).trim();
      const val = tok.content.slice(ci + 1).trim();
      pos++;
      if (val) {
        obj[key] = parseScalar(val);
      } else if (peek() && peek().indent > baseIndent) {
        obj[key] = parseBlock(peek().indent);
      } else {
        obj[key] = null;
      }
    }
    return obj;
  }

  try {
    if (!tokens.length) return { result: {}, error: null };
    const result = parseBlock(tokens[0].indent);
    return { result: result || {}, error: null };
  } catch (e) {
    return { result: null, error: e.message };
  }
}

// ── Compose validator ─────────────────────────────────────────────────
function dnbValidateCompose(yaml) {
  const out = { errors: [], warnings: [], info: [] };
  if (!yaml.trim()) { out.errors.push('Empty document'); return out; }

  const { result: doc, error: parseErr } = dnbParseYaml(yaml);
  if (parseErr) { out.errors.push(`YAML parse error: ${parseErr}`); return out; }
  if (!doc || typeof doc !== 'object') { out.errors.push('Document is not a YAML mapping'); return out; }

  const services = doc.services || {};
  const networks = doc.networks || {};
  const volumes  = doc.volumes  || {};

  const validRestarts = new Set(['no', 'always', 'unless-stopped', 'on-failure']);
  const validTopKeys  = new Set(['services','networks','volumes','secrets','configs','name','version','x-']);

  // Obsolete / unknown top-level keys
  if (doc.version !== undefined && doc.version !== null)
    out.info.push(`'version:' is obsolete in the Compose Specification — it is ignored by modern engines and can be removed`);

  for (const k of Object.keys(doc)) {
    if (!validTopKeys.has(k) && !k.startsWith('x-'))
      out.warnings.push(`Unknown top-level key '${k}' — may be a typo`);
  }

  const svcNames = Object.keys(services);
  if (!svcNames.length) { out.warnings.push('No services defined'); }

  // Per-service checks
  for (const [name, svc] of Object.entries(services)) {
    if (!svc || typeof svc !== 'object') { out.errors.push(`Service '${name}': empty or invalid definition`); continue; }

    // image or build required
    if (!svc.image && !svc.build)
      out.errors.push(`Service '${name}': must have 'image' or 'build'`);

    // latest tag
    if (typeof svc.image === 'string' && svc.image.endsWith(':latest'))
      out.info.push(`Service '${name}': uses ':latest' tag — image may change between pulls`);

    // restart policy
    if (svc.restart !== undefined && svc.restart !== null && !validRestarts.has(String(svc.restart)))
      out.errors.push(`Service '${name}': invalid restart policy '${svc.restart}' — valid values: no, always, unless-stopped, on-failure`);

    // privileged
    if (svc.privileged === true)
      out.warnings.push(`Service '${name}': privileged mode grants full host access — use only when absolutely necessary`);

    // network_mode: host
    if (svc.network_mode === 'host')
      out.warnings.push(`Service '${name}': host network_mode bypasses network isolation`);

    // ports format
    const ports = Array.isArray(svc.ports) ? svc.ports : [];
    for (const p of ports) {
      const ps = String(p);
      // valid: [ip:]host:container[/proto] or container[/proto]
      if (!/^(\d{1,3}(?:\.\d{1,3}){3}:)?\d+(-\d+)?:\d+(-\d+)?(\/(?:tcp|udp|sctp))?$|^\d+(-\d+)?(\/(?:tcp|udp|sctp))?$/.test(ps.replace(/"/g, '')))
        out.warnings.push(`Service '${name}': port '${ps}' format may be invalid (expected [ip:]host:container[/proto])`);
    }

    // volumes — check named volumes are declared
    const svcVols = Array.isArray(svc.volumes) ? svc.volumes : [];
    for (const v of svcVols) {
      if (typeof v === 'string') {
        const src = v.split(':')[0];
        if (src && !src.startsWith('.') && !src.startsWith('/') && src !== '' && !volumes[src])
          out.warnings.push(`Service '${name}': named volume '${src}' is not declared in top-level volumes:`);
      } else if (v && typeof v === 'object' && v.type === 'volume' && v.source && !volumes[v.source]) {
        out.warnings.push(`Service '${name}': named volume '${v.source}' is not declared in top-level volumes:`);
      }
    }

    // networks — check service networks are declared at top level
    let svcNets = [];
    if (Array.isArray(svc.networks))            svcNets = svc.networks;
    else if (svc.networks && typeof svc.networks === 'object') svcNets = Object.keys(svc.networks);
    for (const n of svcNets) {
      if (n !== 'host' && n !== 'none' && !networks[n])
        out.warnings.push(`Service '${name}': references network '${n}' not declared in top-level networks:`);
    }

    // depends_on
    let deps = [];
    if (Array.isArray(svc.depends_on)) deps = svc.depends_on;
    else if (svc.depends_on && typeof svc.depends_on === 'object') deps = Object.keys(svc.depends_on);
    for (const d of deps) {
      if (!svcNames.includes(d))
        out.errors.push(`Service '${name}': depends_on '${d}' which is not a defined service`);
    }

    // environment format
    const env = Array.isArray(svc.environment) ? svc.environment : [];
    for (const e of env) {
      if (typeof e === 'string' && e.includes('=') && e.indexOf('=') === 0)
        out.warnings.push(`Service '${name}': environment entry '${e}' has no key (starts with '=')`);
    }

    // healthcheck test format
    const hc = svc.healthcheck;
    if (hc && typeof hc === 'object' && hc.test) {
      if (!Array.isArray(hc.test) && typeof hc.test !== 'string')
        out.warnings.push(`Service '${name}': healthcheck.test should be a string or list`);
    }
  }

  // Circular dependency detection (DFS)
  function hasCycle(name, visited, stack) {
    visited.add(name); stack.add(name);
    const svc = services[name];
    let deps = [];
    if (Array.isArray(svc?.depends_on)) deps = svc.depends_on;
    else if (svc?.depends_on && typeof svc.depends_on === 'object') deps = Object.keys(svc.depends_on);
    for (const d of deps) {
      if (!visited.has(d) && hasCycle(d, visited, stack)) return true;
      if (stack.has(d)) return true;
    }
    stack.delete(name); return false;
  }
  const vis = new Set(), stk = new Set();
  for (const n of svcNames) if (!vis.has(n) && hasCycle(n, vis, stk))
    out.errors.push(`Circular dependency detected involving service '${n}'`);

  // Orphaned top-level networks
  const usedNets = new Set();
  for (const svc of Object.values(services)) {
    if (Array.isArray(svc?.networks)) svc.networks.forEach(n => usedNets.add(n));
    else if (svc?.networks && typeof svc.networks === 'object') Object.keys(svc.networks).forEach(n => usedNets.add(n));
  }
  for (const n of Object.keys(networks)) {
    if (!usedNets.has(n) && !(networks[n]?.external))
      out.info.push(`Network '${n}' is declared but not attached to any service`);
  }

  // Orphaned top-level volumes
  const usedVols = new Set();
  for (const svc of Object.values(services)) {
    for (const v of (Array.isArray(svc?.volumes) ? svc.volumes : [])) {
      if (typeof v === 'string') { const s = v.split(':')[0]; if (s && !s.startsWith('.') && !s.startsWith('/')) usedVols.add(s); }
      else if (v?.type === 'volume' && v.source) usedVols.add(v.source);
    }
  }
  for (const n of Object.keys(volumes)) {
    if (!usedVols.has(n) && !(volumes[n]?.external))
      out.info.push(`Volume '${n}' is declared but not mounted by any service`);
  }

  return out;
}

// ── K8s CNI table ─────────────────────────────────────────────────────
const DNB_CNI_TABLE = [
  { name: 'Flannel',   model: 'Overlay (VXLAN/UDP)',         policy: 'No',           perf: 'Good',      enc: 'No',         useCase: 'Simple clusters, dev environments' },
  { name: 'Calico',    model: 'L3 routed (BGP) / overlay',   policy: 'Yes (eBPF)',   perf: 'Excellent', enc: 'WireGuard',  useCase: 'Production, policy-heavy, multi-tenant' },
  { name: 'Cilium',    model: 'eBPF L3/L4',                  policy: 'Yes (L7)',     perf: 'Excellent', enc: 'WireGuard',  useCase: 'Advanced observability, L7 policy, service mesh' },
  { name: 'Weave Net', model: 'Mesh overlay',                 policy: 'Yes',         perf: 'Good',      enc: 'NaCl',       useCase: 'Multi-cloud, easy setup' },
  { name: 'Antrea',    model: 'OVS overlay',                  policy: 'Yes (L3-L7)', perf: 'Very Good', enc: 'IPsec/WG',   useCase: 'VMware environments, NSX integration' },
  { name: 'Canal',     model: 'Flannel + Calico policy',      policy: 'Yes',         perf: 'Good',      enc: 'No',         useCase: 'Calico policy with Flannel networking' },
  { name: 'Kube-OVN',  model: 'OVN-based underlay/overlay',  policy: 'Yes (QoS)',   perf: 'Good',      enc: 'IPsec',      useCase: 'Telco, advanced IPAM, QoS control' },
  { name: 'Multus',    model: 'Multi-CNI meta plugin',        policy: 'Delegated',   perf: 'Varies',    enc: 'Delegated',  useCase: 'Multiple NICs per pod (SR-IOV, DPDK, MACVLAN)' },
];

// ── Shared styles ─────────────────────────────────────────────────────
const S = {
  code:     { fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.65, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, overflowX: 'auto', whiteSpace: 'pre', maxHeight: 560, overflowY: 'auto' },
  tableWrap:{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--panel)' },
  table:    { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.5 },
  th:       { textAlign: 'left', padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', background: 'var(--bg)' },
  td:       { padding: '6px 10px', borderBottom: '1px solid var(--border)', verticalAlign: 'top' },
  lbl:      { fontSize: 12, color: 'var(--dim)', marginBottom: 4, display: 'block' },
  inp:      { width: '100%', boxSizing: 'border-box' },
  secTitle: { fontSize: 11, fontWeight: 700, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8, marginTop: 14 },
  svcCard:  { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', marginBottom: 10 },
  rowGroup: { overflowX: 'auto' },
  rowHdr:   { display: 'grid', gap: 6, fontSize: 11, color: 'var(--dim)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, padding: '4px 0', borderBottom: '1px solid var(--border)', marginBottom: 4 },
  row:      { display: 'grid', gap: 6, alignItems: 'center', marginBottom: 4 },
};

// ── Tiny label+field helper ───────────────────────────────────────────
function DnbF({ label, children }) {
  return <div><label style={S.lbl}>{label}</label>{children}</div>;
}

// ── Inline row lists (ports / volumes / env) ──────────────────────────
function DnbPortsEditor({ ports, onChange, t }) {
  const upd = (id, f, v) => onChange(ports.map(r => r.id === id ? { ...r, [f]: v } : r));
  const del = (id)       => onChange(ports.filter(r => r.id !== id));
  const add = ()         => onChange([...ports, DNB_MK_PORT()]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={S.secTitle}>{t('docker_net_builder.svc_ports')}</span>
        <button className="btn btn-ghost btn-sm" onClick={add}>{t('docker_net_builder.add_port')}</button>
      </div>
      {ports.length > 0 && (
        <div style={S.rowGroup}>
          <div style={{ ...S.rowHdr, gridTemplateColumns: '110px 80px 80px 70px 28px' }}>
            <span>{t('docker_net_builder.port_host_ip')}</span>
            <span>{t('docker_net_builder.port_host')}</span>
            <span>{t('docker_net_builder.port_container')}</span>
            <span>{t('docker_net_builder.port_proto')}</span>
            <span></span>
          </div>
          {ports.map(r => (
            <div key={r.id} style={{ ...S.row, gridTemplateColumns: '110px 80px 80px 70px 28px' }}>
              <input className="input" style={S.inp} value={r.hostIp} placeholder="127.0.0.1"   onChange={e => upd(r.id, 'hostIp', e.target.value)} />
              <input className="input" style={S.inp} value={r.hostPort} placeholder="8080"       onChange={e => upd(r.id, 'hostPort', e.target.value)} />
              <input className="input" style={S.inp} value={r.containerPort} placeholder="80"   onChange={e => upd(r.id, 'containerPort', e.target.value)} />
              <select className="select" style={S.inp} value={r.protocol} onChange={e => upd(r.id, 'protocol', e.target.value)}>
                <option value="tcp">tcp</option><option value="udp">udp</option><option value="sctp">sctp</option>
              </select>
              <button className="btn btn-danger btn-sm" onClick={() => del(r.id)} style={{ padding: '3px 7px' }}>×</button>
            </div>
          ))}
        </div>
      )}
      {!ports.length && <div style={{ fontSize: 12, color: 'var(--dim)' }}>{t('docker_net_builder.no_ports')}</div>}
    </div>
  );
}

const DNB_VOL_HINTS = {
  bind:   { color: '#f90',             label: 'Bind Mount',   srcLabel: 'Host path',    srcPlaceholder: './data',    srcHint: 'Host path must exist. Maps directly into container — changes visible on both sides immediately.' },
  volume: { color: 'var(--accent)',    label: 'Named Volume', srcLabel: 'Volume name',  srcPlaceholder: 'db-data',   srcHint: 'Managed by Docker/Podman. Declare the name in the Named Volumes card below. Better performance and portability than bind mounts.' },
  tmpfs:  { color: 'var(--dim)',       label: 'tmpfs',        srcLabel: '—',            srcPlaceholder: '',          srcHint: 'In-memory only. Contents are lost when the container stops. Use for secrets or scratch space that must not persist.' },
};

function DnbVolsEditor({ vols, onChange, t }) {
  const upd = (id, f, v) => onChange(vols.map(r => r.id === id ? { ...r, [f]: v } : r));
  const del = (id)       => onChange(vols.filter(r => r.id !== id));
  const add = ()         => onChange([...vols, DNB_MK_VOL()]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={S.secTitle}>{t('docker_net_builder.svc_volumes')}</span>
        <button className="btn btn-ghost btn-sm" onClick={add}>{t('docker_net_builder.add_vol')}</button>
      </div>
      {vols.length > 0 && (
        <div style={S.rowGroup}>
          <div style={{ ...S.rowHdr, gridTemplateColumns: '100px 1fr 1fr 40px 28px' }}>
            <span>{t('docker_net_builder.vol_type')}</span>
            <span>{t('docker_net_builder.vol_source')}</span>
            <span>{t('docker_net_builder.vol_target')}</span>
            <span>R/O</span>
            <span></span>
          </div>
          {vols.map(r => {
            const hint = DNB_VOL_HINTS[r.type] || DNB_VOL_HINTS.bind;
            return (
              <div key={r.id}>
                <div style={{ ...S.row, gridTemplateColumns: '100px 1fr 1fr 40px 28px' }}>
                  <select className="select" style={S.inp} value={r.type} onChange={e => upd(r.id, 'type', e.target.value)}>
                    <option value="bind">Bind Mount</option>
                    <option value="volume">Named Volume</option>
                    <option value="tmpfs">tmpfs (RAM)</option>
                  </select>
                  <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }}
                    value={r.source}
                    placeholder={hint.srcPlaceholder}
                    disabled={r.type === 'tmpfs'}
                    onChange={e => upd(r.id, 'source', e.target.value)} />
                  <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }}
                    value={r.target} placeholder="/data"
                    onChange={e => upd(r.id, 'target', e.target.value)} />
                  <input type="checkbox" checked={!!r.readOnly} onChange={e => upd(r.id, 'readOnly', e.target.checked)} style={{ margin: 'auto' }} />
                  <button className="btn btn-danger btn-sm" onClick={() => del(r.id)} style={{ padding: '3px 7px' }}>×</button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 6, paddingLeft: 4, lineHeight: 1.5 }}>
                  <span style={{ color: hint.color, fontWeight: 700, marginRight: 6 }}>{hint.label}</span>
                  {hint.srcHint}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {!vols.length && (
        <div>
          <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 8 }}>{t('docker_net_builder.no_vols')}</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
            {Object.entries(DNB_VOL_HINTS).map(([type, h]) => (
              <div key={type} style={{ fontSize: 11, padding: '8px 10px', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', lineHeight: 1.6 }}>
                <div style={{ fontWeight: 700, color: h.color, marginBottom: 3 }}>{h.label}</div>
                <div style={{ color: 'var(--dim)' }}>{h.srcHint}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function DnbEnvEditor({ env, onChange, t }) {
  const upd = (id, f, v) => onChange(env.map(r => r.id === id ? { ...r, [f]: v } : r));
  const del = (id)       => onChange(env.filter(r => r.id !== id));
  const add = ()         => onChange([...env, DNB_MK_ENV()]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <span style={S.secTitle}>{t('docker_net_builder.svc_env')}</span>
        <button className="btn btn-ghost btn-sm" onClick={add}>{t('docker_net_builder.add_env')}</button>
      </div>
      {env.length > 0 && (
        <div>
          <div style={{ ...S.rowHdr, gridTemplateColumns: '1fr 1fr 28px' }}>
            <span>{t('docker_net_builder.env_key')}</span>
            <span>{t('docker_net_builder.env_value')}</span>
            <span></span>
          </div>
          {env.map(r => (
            <div key={r.id} style={{ ...S.row, gridTemplateColumns: '1fr 1fr 28px' }}>
              <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={r.key} placeholder="MY_VAR" onChange={e => upd(r.id, 'key', e.target.value)} />
              <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={r.value} placeholder={t('docker_net_builder.env_value_hint')} onChange={e => upd(r.id, 'value', e.target.value)} />
              <button className="btn btn-danger btn-sm" onClick={() => del(r.id)} style={{ padding: '3px 7px' }}>×</button>
            </div>
          ))}
        </div>
      )}
      {!env.length && <div style={{ fontSize: 12, color: 'var(--dim)' }}>{t('docker_net_builder.no_env')}</div>}
    </div>
  );
}

// ── Service card ──────────────────────────────────────────────────────
function DnbServiceCard({ svc, onUpdate, onRemove, t, allNetNames }) {
  const upd = (f, v) => onUpdate(svc.id, f, v);
  const updHc = (f, v) => upd('healthcheck', { ...svc.healthcheck, [f]: v });
  const [showAdv, setShowAdv] = useState(false);

  const toggleNet = (name) => {
    const cur = svc.attachedNets || [];
    upd('attachedNets', cur.includes(name) ? cur.filter(n => n !== name) : [...cur, name]);
  };
  const updIp = (netName, v) => upd('staticIps', { ...(svc.staticIps || {}), [netName]: v });
  const updAlias = (netName, v) => upd('netAliases', { ...(svc.netAliases || {}), [netName]: v });

  const portCount = (svc.ports || []).filter(p => p.containerPort).length;
  const volCount  = (svc.volumes || []).filter(v => v.target).length;
  const envCount  = (svc.environment || []).filter(e => e.key).length;

  return (
    <div style={S.svcCard}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '8px 12px', gap: 10, background: 'var(--panel)', borderRadius: 'var(--radius) var(--radius) 0 0', borderBottom: svc.expanded ? '1px solid var(--border)' : 'none' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => upd('expanded', !svc.expanded)} style={{ padding: '2px 7px', fontSize: 13 }}>
          {svc.expanded ? '▾' : '▸'}
        </button>
        <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, color: 'var(--accent)', fontSize: 13, flex: 1 }}>
          {svc.name || 'unnamed'}
        </span>
        <span style={{ fontSize: 11, color: 'var(--dim)', fontFamily: 'var(--mono)' }}>{svc.image || ''}</span>
        {!svc.expanded && (
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
            {[portCount && `${portCount}p`, volCount && `${volCount}v`, envCount && `${envCount}e`].filter(Boolean).join('  ')}
          </span>
        )}
        <button className="btn btn-danger btn-sm" onClick={() => onRemove(svc.id)} style={{ padding: '2px 7px', fontSize: 12 }}>×</button>
      </div>

      {svc.expanded && (
        <div style={{ padding: 12 }}>
          {/* Basic */}
          <div style={{ ...S.rowHdr, display: 'block' }}>{t('docker_net_builder.sec_basic')}</div>
          <div className="two-col" style={{ gap: 10, marginBottom: 8 }}>
            <DnbF label={t('docker_net_builder.svc_name')}>
              <input className="input" style={S.inp} value={svc.name} onChange={e => upd('name', e.target.value)} />
            </DnbF>
            <DnbF label={t('docker_net_builder.svc_image')}>
              <input className="input" style={S.inp} value={svc.image} placeholder="nginx:latest" onChange={e => upd('image', e.target.value)} />
            </DnbF>
          </div>
          <div className="three-col" style={{ gap: 10, marginBottom: 8 }}>
            <DnbF label={t('docker_net_builder.svc_container_name')}>
              <input className="input" style={S.inp} value={svc.containerName || ''} placeholder={t('docker_net_builder.optional')} onChange={e => upd('containerName', e.target.value)} />
            </DnbF>
            <DnbF label={t('docker_net_builder.svc_restart')}>
              <select className="select" style={S.inp} value={svc.restart || 'unless-stopped'} onChange={e => upd('restart', e.target.value)}>
                <option value="no">no</option>
                <option value="always">always</option>
                <option value="unless-stopped">unless-stopped</option>
                <option value="on-failure">on-failure</option>
              </select>
            </DnbF>
            <DnbF label={t('docker_net_builder.svc_working_dir')}>
              <input className="input" style={S.inp} value={svc.workingDir || ''} placeholder="/app" onChange={e => upd('workingDir', e.target.value)} />
            </DnbF>
          </div>
          <div className="two-col" style={{ gap: 10, marginBottom: 8 }}>
            <DnbF label={t('docker_net_builder.svc_command')}>
              <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={svc.command || ''} placeholder={t('docker_net_builder.optional')} onChange={e => upd('command', e.target.value)} />
            </DnbF>
            <DnbF label={t('docker_net_builder.svc_entrypoint')}>
              <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={svc.entrypoint || ''} placeholder={t('docker_net_builder.optional')} onChange={e => upd('entrypoint', e.target.value)} />
            </DnbF>
          </div>
          <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
            {[['privileged', t('docker_net_builder.svc_privileged')], ['readOnly', t('docker_net_builder.svc_readonly')]].map(([field, label]) => (
              <label key={field} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={!!svc[field]} onChange={e => upd(field, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>

          {/* Ports */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 10 }}>
            <DnbPortsEditor ports={svc.ports || []} onChange={v => upd('ports', v)} t={t} />
          </div>

          {/* Volumes */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 10 }}>
            <DnbVolsEditor vols={svc.volumes || []} onChange={v => upd('volumes', v)} t={t} />
          </div>

          {/* Environment */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 10 }}>
            <DnbEnvEditor env={svc.environment || []} onChange={v => upd('environment', v)} t={t} />
            <div style={{ marginTop: 6 }}>
              <DnbF label={t('docker_net_builder.svc_env_file')}>
                <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={svc.envFile || ''} placeholder=".env, .env.local" onChange={e => upd('envFile', e.target.value)} />
              </DnbF>
            </div>
          </div>

          {/* Networks */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginBottom: 10 }}>
            <span style={S.secTitle}>{t('docker_net_builder.svc_networks')}</span>
            {(allNetNames[0] === 'host' || allNetNames[0] === 'none') ? (
              <div style={{ fontSize: 12, color: 'var(--dim)', padding: '6px 10px', background: 'rgba(0,212,200,0.05)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                {t('docker_net_builder.net_mode_fixed', { mode: allNetNames[0] })}
              </div>
            ) : allNetNames.length > 0 ? (
              <div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
                  {allNetNames.map(n => (
                    <label key={n} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 13 }}>
                      <input type="checkbox" checked={(svc.attachedNets || []).includes(n) || (!svc.attachedNets?.length && n === allNetNames[0])} onChange={() => toggleNet(n)} />
                      <span style={{ fontFamily: 'var(--mono)' }}>{n}</span>
                    </label>
                  ))}
                </div>
                {allNetNames.map(n => {
                  const attached = (svc.attachedNets || []).includes(n) || (!svc.attachedNets?.length && n === allNetNames[0]);
                  if (!attached) return null;
                  return (
                    <div key={n} className="two-col" style={{ gap: 10, marginBottom: 6 }}>
                      <DnbF label={`${n} — ${t('docker_net_builder.svc_static_ip')}`}>
                        <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={(svc.staticIps || {})[n] || ''} placeholder="172.20.0.10" onChange={e => updIp(n, e.target.value)} />
                      </DnbF>
                      <DnbF label={`${n} — ${t('docker_net_builder.svc_net_aliases')}`}>
                        <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={(svc.netAliases || {})[n] || ''} placeholder="alias1 alias2" onChange={e => updAlias(n, e.target.value)} />
                      </DnbF>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: 'var(--dim)' }}>{t('docker_net_builder.no_nets_defined')}</div>
            )}
            <div style={{ marginTop: 8 }}>
              <DnbF label={t('docker_net_builder.svc_depends_on')}>
                <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={svc.dependsOn || ''} placeholder="db, redis" onChange={e => upd('dependsOn', e.target.value)} />
              </DnbF>
            </div>
          </div>

          {/* Advanced (collapsible) */}
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowAdv(p => !p)} style={{ fontSize: 12, marginBottom: 6 }}>
              {showAdv ? '▾' : '▸'} {t('docker_net_builder.sec_advanced')}
            </button>
            {showAdv && (
              <div>
                {/* Healthcheck */}
                <div style={{ marginBottom: 10 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, marginBottom: 8 }}>
                    <input type="checkbox" checked={!!(svc.healthcheck?.enabled)} onChange={e => updHc('enabled', e.target.checked)} />
                    {t('docker_net_builder.svc_healthcheck')}
                  </label>
                  {svc.healthcheck?.enabled && (
                    <div>
                      <DnbF label={t('docker_net_builder.hc_test')}>
                        <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={svc.healthcheck.test || ''}
                          placeholder='["CMD","curl","-f","http://localhost"]'
                          onChange={e => updHc('test', e.target.value)} />
                      </DnbF>
                      <div className="three-col" style={{ gap: 10, marginTop: 6 }}>
                        <DnbF label={t('docker_net_builder.hc_interval')}>
                          <input className="input" style={S.inp} value={svc.healthcheck.interval || '30s'} onChange={e => updHc('interval', e.target.value)} />
                        </DnbF>
                        <DnbF label={t('docker_net_builder.hc_timeout')}>
                          <input className="input" style={S.inp} value={svc.healthcheck.timeout || '10s'} onChange={e => updHc('timeout', e.target.value)} />
                        </DnbF>
                        <DnbF label={t('docker_net_builder.hc_retries')}>
                          <input className="input" style={S.inp} value={svc.healthcheck.retries || '3'} onChange={e => updHc('retries', e.target.value)} />
                        </DnbF>
                      </div>
                      <div style={{ marginTop: 6 }}>
                        <DnbF label={t('docker_net_builder.hc_start_period')}>
                          <input className="input" style={{ width: '120px' }} value={svc.healthcheck.startPeriod || '0s'} onChange={e => updHc('startPeriod', e.target.value)} />
                        </DnbF>
                      </div>
                    </div>
                  )}
                </div>

                {/* Labels */}
                <DnbF label={t('docker_net_builder.labels')}>
                  <textarea className="input" style={{ ...S.inp, minHeight: 56, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                    value={svc.labels || ''} onChange={e => upd('labels', e.target.value)}
                    placeholder="com.example.app=web&#10;com.example.env=prod" />
                </DnbF>

                {/* Deploy */}
                <div className="three-col" style={{ gap: 10, marginTop: 8 }}>
                  <DnbF label={t('docker_net_builder.svc_replicas')}>
                    <input className="input" style={S.inp} type="number" min="1" value={svc.replicas || ''} placeholder="1" onChange={e => upd('replicas', e.target.value)} />
                  </DnbF>
                  <DnbF label={t('docker_net_builder.svc_cpu_limit')}>
                    <input className="input" style={S.inp} value={svc.cpuLimit || ''} placeholder="0.5" onChange={e => upd('cpuLimit', e.target.value)} />
                  </DnbF>
                  <DnbF label={t('docker_net_builder.svc_mem_limit')}>
                    <input className="input" style={S.inp} value={svc.memLimit || ''} placeholder="512M" onChange={e => upd('memLimit', e.target.value)} />
                  </DnbF>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Validate panel ────────────────────────────────────────────────────
function DnbValidatePanel({ t }) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState(null);
  const [copied, copy] = useCopy();

  const validate = useCallback(() => {
    setResult(dnbValidateCompose(input));
  }, [input]);

  useEffect(() => {
    if (!input.trim()) { setResult(null); return; }
    const id = setTimeout(validate, 600);
    return () => clearTimeout(id);
  }, [input]);

  const total = result ? result.errors.length + result.warnings.length + result.info.length : 0;

  return (
    <div>
      <div style={{ marginBottom: 10 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={S.secTitle}>{t('docker_net_builder.validate_paste_label')}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { setInput(''); setResult(null); }}>{t('common.clear')}</button>
          </div>
        </div>
        <textarea
          className="input"
          style={{ ...S.inp, minHeight: 280, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.6 }}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('docker_net_builder.validate_placeholder')}
          spellCheck={false}
        />
      </div>

      {result && (
        <div>
          {/* Summary badges */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {result.errors.length === 0 && result.warnings.length === 0 ? (
              <span className="badge badge-green">{t('docker_net_builder.validate_ok')}</span>
            ) : null}
            {result.errors.length > 0 && (
              <span className="badge badge-red">{result.errors.length} {t('docker_net_builder.validate_errors')}</span>
            )}
            {result.warnings.length > 0 && (
              <span className="badge badge-yellow">{result.warnings.length} {t('docker_net_builder.validate_warnings')}</span>
            )}
            {result.info.length > 0 && (
              <span className="badge badge-blue">{result.info.length} {t('docker_net_builder.validate_info')}</span>
            )}
          </div>

          {result.errors.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...S.secTitle, color: 'var(--danger, #f44)' }}>{t('docker_net_builder.validate_errors')}</div>
              {result.errors.map((e, i) => (
                <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 10px', marginBottom: 3, background: 'rgba(255,60,60,0.07)', borderLeft: '3px solid #f44', borderRadius: '0 4px 4px 0', lineHeight: 1.5 }}>
                  {e}
                </div>
              ))}
            </div>
          )}

          {result.warnings.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ ...S.secTitle, color: '#f90' }}>{t('docker_net_builder.validate_warnings')}</div>
              {result.warnings.map((w, i) => (
                <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 10px', marginBottom: 3, background: 'rgba(255,150,0,0.07)', borderLeft: '3px solid #f90', borderRadius: '0 4px 4px 0', lineHeight: 1.5 }}>
                  {w}
                </div>
              ))}
            </div>
          )}

          {result.info.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div style={{ ...S.secTitle, color: 'var(--accent)' }}>{t('docker_net_builder.validate_info')}</div>
              {result.info.map((m, i) => (
                <div key={i} style={{ fontFamily: 'var(--mono)', fontSize: 12, padding: '4px 10px', marginBottom: 3, background: 'rgba(0,212,200,0.06)', borderLeft: '3px solid var(--accent)', borderRadius: '0 4px 4px 0', lineHeight: 1.5 }}>
                  {m}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!input.trim() && (
        <div style={{ fontSize: 12, color: 'var(--dim)', fontStyle: 'italic' }}>
          {t('docker_net_builder.validate_hint')}
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────
function DockerNetworkBuilder({ initialData, onShare }) {
  const { t } = useTranslation();
  const [mode,     setMode]     = usePersistentState('dnb:mode',     initialData?.mode     ?? 'build');
  const [netType,  setNetType]  = usePersistentState('dnb:type',     initialData?.netType  ?? 'bridge');
  const [cfg,      setCfg]      = usePersistentState('dnb:cfg',      initialData?.cfg      ?? { ...DNB_DEFAULTS.bridge });
  const [extraNets,setExtraNets]= usePersistentState('dnb:xnets',    initialData?.extraNets ?? []);
  const [services, setServices] = usePersistentState('dnb:services2', initialData?.services ?? []);
  const [namedVols,setNamedVols]= usePersistentState('dnb:nvols',    initialData?.namedVols ?? []);
  const [activeTab,setActiveTab]= usePersistentState('dnb:tab',      initialData?.tab      ?? 'compose');
  const [copied,   copy]        = useCopy();

  const set = useCallback((field, val) => setCfg(prev => ({ ...prev, [field]: val })), []);

  const switchType = useCallback((type) => {
    setNetType(type);
    setCfg({ ...DNB_DEFAULTS[type] });
  }, []);

  const updateService = useCallback((id, field, val) => {
    setServices(prev => prev.map(s => s.id === id ? { ...s, [field]: val } : s));
  }, []);
  const addService = useCallback(() => {
    setServices(prev => [...prev, dnbMkService(prev.length + 1)]);
  }, []);
  const removeService = useCallback((id) => {
    setServices(prev => prev.filter(s => s.id !== id));
  }, []);

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'docker-net-builder', mode, netType, cfg, extraNets, services, namedVols, tab: activeTab });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [mode, netType, cfg, extraNets, services, namedVols, activeTab, onShare]);

  const primaryNet  = cfg.name || 'mynet';
  const allNetNames = useMemo(
    () => [primaryNet, ...extraNets.map(n => n.name).filter(Boolean)],
    [primaryNet, extraNets]
  );

  const dockerCmd    = useMemo(() => dnbBuildDockerCmd(netType, cfg),               [netType, cfg]);
  const podmanCmd    = useMemo(() => dnbBuildPodmanCmd(netType, cfg),               [netType, cfg]);
  const composeYaml  = useMemo(() => dnbBuildCompose(netType, cfg, extraNets, services, namedVols), [netType, cfg, extraNets, services, namedVols]);
  const podmanCompose= useMemo(() => dnbBuildPodmanCompose(netType, cfg, services, namedVols),       [netType, cfg, services, namedVols]);

  const NET_TYPES = [
    { id: 'bridge',  label: 'Bridge'  },
    { id: 'overlay', label: 'Overlay' },
    { id: 'macvlan', label: 'MACVLAN' },
    { id: 'ipvlan',  label: 'IPvLAN'  },
    { id: 'host',    label: 'Host'    },
    { id: 'none',    label: 'None'    },
  ];

  const OUT_TABS = [
    { id: 'compose',       label: t('docker_net_builder.tab_compose') },
    { id: 'podman_compose',label: t('docker_net_builder.tab_podman_compose') },
    { id: 'docker',        label: t('docker_net_builder.tab_docker') },
    { id: 'podman',        label: t('docker_net_builder.tab_podman') },
    { id: 'cni',           label: t('docker_net_builder.tab_cni') },
  ];

  const TYPE_DESC = {
    bridge:  t('docker_net_builder.desc_bridge'),
    overlay: t('docker_net_builder.desc_overlay'),
    macvlan: t('docker_net_builder.desc_macvlan'),
    ipvlan:  t('docker_net_builder.desc_ipvlan'),
    host:    t('docker_net_builder.desc_host'),
    none:    t('docker_net_builder.desc_none'),
  };

  const activeOutput = activeTab === 'docker' ? dockerCmd
    : activeTab === 'podman' ? podmanCmd
    : activeTab === 'compose' ? composeYaml
    : activeTab === 'podman_compose' ? podmanCompose
    : '';

  return (
    <div className="fadein">
      {/* Mode selector */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div className="card-title" style={{ margin: 0 }}>{t('docker_net_builder.title')}</div>
          <div className="btn-row">
            <button className={`btn btn-sm ${mode === 'build' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('build')}>
              {t('docker_net_builder.mode_build')}
            </button>
            <button className={`btn btn-sm ${mode === 'validate' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setMode('validate')}>
              {t('docker_net_builder.mode_validate')}
            </button>
          </div>
        </div>
      </div>

      {mode === 'validate' && (
        <div className="card">
          <DnbValidatePanel t={t} />
        </div>
      )}

      {mode === 'build' && (
        <>
          {/* Network config */}
          <div className="card">
            <div style={S.secTitle}>{t('docker_net_builder.network_type')}</div>
            <div className="btn-row" style={{ marginBottom: 8 }}>
              {NET_TYPES.map(nt => (
                <button key={nt.id}
                  className={`btn btn-sm ${netType === nt.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => switchType(nt.id)}>
                  {nt.label}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 14 }}>{TYPE_DESC[netType]}</div>

            {netType !== 'host' && netType !== 'none' && (
              <div>
                <div className="two-col" style={{ gap: 16 }}>
                  <DnbF label={t('docker_net_builder.network_name')}>
                    <input className="input" style={S.inp} value={cfg.name || ''} onChange={e => set('name', e.target.value)} placeholder="mynet" />
                  </DnbF>
                  <DnbF label={t('docker_net_builder.subnet')}>
                    <input className="input" style={S.inp} value={cfg.subnet || ''} onChange={e => set('subnet', e.target.value)} placeholder="172.20.0.0/16" />
                  </DnbF>
                </div>
                <div className="two-col" style={{ gap: 16 }}>
                  <DnbF label={t('docker_net_builder.gateway')}>
                    <input className="input" style={S.inp} value={cfg.gateway || ''} onChange={e => set('gateway', e.target.value)} placeholder="172.20.0.1" />
                  </DnbF>
                  <DnbF label={t('docker_net_builder.ip_range')}>
                    <input className="input" style={S.inp} value={cfg.ipRange || ''} onChange={e => set('ipRange', e.target.value)} placeholder="172.20.10.0/24" />
                  </DnbF>
                </div>

                {netType === 'bridge' && (
                  <div>
                    <div className="two-col" style={{ gap: 16 }}>
                      <DnbF label={t('docker_net_builder.mtu')}>
                        <input className="input" style={S.inp} value={cfg.mtu || '1500'} onChange={e => set('mtu', e.target.value)} />
                      </DnbF>
                      <DnbF label={t('docker_net_builder.driver_opts')}>
                        <textarea className="input" style={{ ...S.inp, minHeight: 52, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                          value={cfg.driverOpts || ''} onChange={e => set('driverOpts', e.target.value)} placeholder="key=value (one per line)" />
                      </DnbF>
                    </div>
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
                      {[['icc', t('docker_net_builder.icc')], ['ipMasq', t('docker_net_builder.ip_masq')], ['ipForward', t('docker_net_builder.ip_forward')], ['iptables', t('docker_net_builder.iptables')]].map(([f, l]) => (
                        <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                          <input type="checkbox" checked={!!cfg[f]} onChange={e => set(f, e.target.checked)} /> {l}
                        </label>
                      ))}
                    </div>
                  </div>
                )}

                {netType === 'overlay' && (
                  <div>
                    <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginBottom: 12 }}>
                      {[['attachable', t('docker_net_builder.attachable')], ['encrypted', t('docker_net_builder.encrypted')]].map(([f, l]) => (
                        <label key={f} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13 }}>
                          <input type="checkbox" checked={!!cfg[f]} onChange={e => set(f, e.target.checked)} /> {l}
                        </label>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--dim)', marginBottom: 12, padding: '8px 12px', background: 'rgba(0,212,200,0.05)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      {t('docker_net_builder.overlay_note')}
                    </div>
                  </div>
                )}

                {netType === 'macvlan' && (
                  <div>
                    <div className="two-col" style={{ gap: 16 }}>
                      <DnbF label={t('docker_net_builder.parent_iface')}>
                        <input className="input" style={S.inp} value={cfg.parentIface || ''} onChange={e => set('parentIface', e.target.value)} placeholder="eth0" />
                      </DnbF>
                      <DnbF label={t('docker_net_builder.macvlan_mode')}>
                        <select className="select" style={S.inp} value={cfg.macvlanMode || 'bridge'} onChange={e => set('macvlanMode', e.target.value)}>
                          <option value="bridge">bridge</option><option value="private">private</option>
                          <option value="vepa">vepa</option><option value="passthru">passthru</option>
                        </select>
                      </DnbF>
                    </div>
                    <DnbF label={t('docker_net_builder.aux_addresses')}>
                      <input className="input" style={S.inp} value={cfg.auxAddresses || ''} onChange={e => set('auxAddresses', e.target.value)} placeholder="host1=192.168.1.5, host2=192.168.1.6" />
                    </DnbF>
                    <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 8, padding: '8px 12px', background: 'rgba(255,165,0,0.05)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      {t('docker_net_builder.macvlan_note')}
                    </div>
                  </div>
                )}

                {netType === 'ipvlan' && (
                  <div>
                    <div className="two-col" style={{ gap: 16 }}>
                      <DnbF label={t('docker_net_builder.parent_iface')}>
                        <input className="input" style={S.inp} value={cfg.parentIface || ''} onChange={e => set('parentIface', e.target.value)} placeholder="eth0" />
                      </DnbF>
                      <DnbF label={t('docker_net_builder.ipvlan_mode')}>
                        <select className="select" style={S.inp} value={cfg.ipvlanMode || 'l2'} onChange={e => set('ipvlanMode', e.target.value)}>
                          <option value="l2">L2 (default)</option>
                          <option value="l3">L3 (no ARP)</option>
                          <option value="l3s">L3s (iptables)</option>
                        </select>
                      </DnbF>
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 8, padding: '8px 12px', background: 'rgba(100,200,255,0.05)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      {t('docker_net_builder.ipvlan_note')}
                    </div>
                  </div>
                )}

                <div style={{ marginTop: 8 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: 13, marginBottom: 8 }}>
                    <input type="checkbox" checked={!!cfg.enableIpv6} onChange={e => set('enableIpv6', e.target.checked)} />
                    {t('docker_net_builder.enable_ipv6')}
                  </label>
                  {cfg.enableIpv6 && (
                    <div className="two-col" style={{ gap: 16 }}>
                      <DnbF label={t('docker_net_builder.ipv6_subnet')}>
                        <input className="input" style={S.inp} value={cfg.ipv6Subnet || ''} onChange={e => set('ipv6Subnet', e.target.value)} placeholder="fd00::/80" />
                      </DnbF>
                      <DnbF label={t('docker_net_builder.ipv6_gateway')}>
                        <input className="input" style={S.inp} value={cfg.ipv6Gateway || ''} onChange={e => set('ipv6Gateway', e.target.value)} placeholder="fd00::1" />
                      </DnbF>
                    </div>
                  )}
                </div>
                <DnbF label={t('docker_net_builder.labels')}>
                  <textarea className="input" style={{ ...S.inp, minHeight: 52, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 12 }}
                    value={cfg.labels || ''} onChange={e => set('labels', e.target.value)} placeholder="com.example.env=prod&#10;com.example.team=netops" />
                </DnbF>
              </div>
            )}

            {(netType === 'host' || netType === 'none') && (
              <div style={{ padding: '10px 14px', background: 'rgba(0,212,200,0.05)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 13, color: 'var(--dim)' }}>
                {TYPE_DESC[netType]}
              </div>
            )}

            {/* Additional networks */}
            {netType !== 'host' && netType !== 'none' && (
              <div style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <span style={S.secTitle}>{t('docker_net_builder.extra_networks')}</span>
                  <button className="btn btn-ghost btn-sm" onClick={() => setExtraNets(p => [...p, DNB_MK_XNET()])}>
                    {t('docker_net_builder.add_network')}
                  </button>
                </div>
                {extraNets.map(xn => (
                  <div key={xn.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px auto auto', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                    <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={xn.name} placeholder="backend" onChange={e => setExtraNets(p => p.map(n => n.id === xn.id ? { ...n, name: e.target.value } : n))} />
                    <select className="select" style={S.inp} value={xn.driver} onChange={e => setExtraNets(p => p.map(n => n.id === xn.id ? { ...n, driver: e.target.value } : n))}>
                      <option value="bridge">bridge</option><option value="overlay">overlay</option><option value="macvlan">macvlan</option>
                    </select>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, whiteSpace: 'nowrap' }}>
                      <input type="checkbox" checked={!!xn.external} onChange={e => setExtraNets(p => p.map(n => n.id === xn.id ? { ...n, external: e.target.checked } : n))} />
                      {t('docker_net_builder.ext_network')}
                    </label>
                    <button className="btn btn-danger btn-sm" onClick={() => setExtraNets(p => p.filter(n => n.id !== xn.id))} style={{ padding: '3px 8px' }}>×</button>
                  </div>
                ))}
                {!extraNets.length && <div style={{ fontSize: 12, color: 'var(--dim)' }}>{t('docker_net_builder.no_extra_networks')}</div>}
              </div>
            )}
          </div>

          {/* Services */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{t('docker_net_builder.services')}</span>
              <button className="btn btn-ghost btn-sm" onClick={addService}>{t('docker_net_builder.add_service')}</button>
            </div>
            {services.map(svc => (
              <DnbServiceCard key={svc.id} svc={svc} onUpdate={updateService} onRemove={removeService} t={t} allNetNames={allNetNames} />
            ))}
            {!services.length && (
              <div style={{ color: 'var(--dim)', fontSize: 13, textAlign: 'center', padding: '12px 0' }}>
                {t('docker_net_builder.no_services')}
              </div>
            )}
          </div>

          {/* Named volumes */}
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>{t('docker_net_builder.named_volumes')}</span>
              <button className="btn btn-ghost btn-sm" onClick={() => setNamedVols(p => [...p, DNB_MK_NVOL()])}>
                {t('docker_net_builder.add_named_vol')}
              </button>
            </div>
            {namedVols.map(v => (
              <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '1fr 110px auto auto', gap: 8, marginBottom: 6, alignItems: 'center' }}>
                <input className="input" style={{ ...S.inp, fontFamily: 'var(--mono)', fontSize: 12 }} value={v.name} placeholder="db-data" onChange={e => setNamedVols(p => p.map(n => n.id === v.id ? { ...n, name: e.target.value } : n))} />
                <select className="select" style={S.inp} value={v.driver} onChange={e => setNamedVols(p => p.map(n => n.id === v.id ? { ...n, driver: e.target.value } : n))}>
                  <option value="local">local</option><option value="nfs">nfs</option><option value="cifs">cifs</option><option value="tmpfs">tmpfs</option>
                </select>
                <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, whiteSpace: 'nowrap' }}>
                  <input type="checkbox" checked={!!v.external} onChange={e => setNamedVols(p => p.map(n => n.id === v.id ? { ...n, external: e.target.checked } : n))} />
                  {t('docker_net_builder.ext_network')}
                </label>
                <button className="btn btn-danger btn-sm" onClick={() => setNamedVols(p => p.filter(n => n.id !== v.id))} style={{ padding: '3px 8px' }}>×</button>
              </div>
            ))}
            {!namedVols.length && <div style={{ fontSize: 12, color: 'var(--dim)' }}>{t('docker_net_builder.no_named_vols')}</div>}
            <div style={{ fontSize: 12, color: 'var(--dim)', marginTop: 10 }}>{t('docker_net_builder.named_vols_hint')}</div>
          </div>

          {/* Output */}
          <div className="card">
            <div className="btn-row" style={{ marginBottom: 14 }}>
              {OUT_TABS.map(tab => (
                <button key={tab.id}
                  className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setActiveTab(tab.id)}>
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab !== 'cni' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8, gap: 8 }}>
                  <button className="btn btn-ghost btn-sm" onClick={() => copy(activeOutput, 'out')}>
                    {copied === 'out' ? t('common.copied') : t('common.copy')}
                  </button>
                  {activeTab === 'docker' && (
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      const b = new Blob([activeOutput], { type: 'text/plain' });
                      const u = URL.createObjectURL(b); const a = document.createElement('a');
                      a.href = u; a.download = 'docker-network.sh'; a.click(); URL.revokeObjectURL(u);
                    }}>{t('docker_net_builder.download_sh')}</button>
                  )}
                  {(activeTab === 'compose' || activeTab === 'podman_compose') && (
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      const b = new Blob([activeOutput], { type: 'text/yaml' });
                      const u = URL.createObjectURL(b); const a = document.createElement('a');
                      a.href = u; a.download = activeTab === 'compose' ? 'docker-compose.yml' : 'podman-compose.yml'; a.click(); URL.revokeObjectURL(u);
                    }}>{t('docker_net_builder.download_yaml')}</button>
                  )}
                </div>
                <div style={S.code}>{activeOutput}</div>
                {activeTab === 'docker' && netType === 'bridge' && (
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--dim)' }}>
                    {t('docker_net_builder.quick_verify')}{' '}
                    <code style={{ fontFamily: 'var(--mono)', color: 'var(--accent)' }}>docker network inspect {cfg.name || 'mynet'}</code>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'cni' && (
              <div>
                <div style={{ marginBottom: 10, fontSize: 13, color: 'var(--dim)' }}>{t('docker_net_builder.cni_desc')}</div>
                <div style={S.tableWrap}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        {['CNI Plugin', t('docker_net_builder.cni_model'), t('docker_net_builder.cni_policy'), t('docker_net_builder.cni_perf'), t('docker_net_builder.cni_enc'), t('docker_net_builder.cni_usecase')].map(h => (
                          <th key={h} style={S.th}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {DNB_CNI_TABLE.map(row => (
                        <tr key={row.name}>
                          <td style={{ ...S.td, fontWeight: 700, color: 'var(--accent)' }}>{row.name}</td>
                          <td style={S.td}>{row.model}</td>
                          <td style={S.td}><span className={`badge ${row.policy === 'No' ? 'badge-red' : 'badge-green'}`} style={{ fontSize: 11 }}>{row.policy}</span></td>
                          <td style={S.td}><span className="badge badge-cyan" style={{ fontSize: 11 }}>{row.perf}</span></td>
                          <td style={S.td}>{row.enc}</td>
                          <td style={{ ...S.td, color: 'var(--dim)', fontSize: 12 }}>{row.useCase}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 14, fontSize: 12, color: 'var(--dim)', lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--text)' }}>Docker vs K8s:</strong>{' '}
                  {t('docker_net_builder.cni_vs_docker')}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

window.DockerNetworkBuilder = DockerNetworkBuilder;
