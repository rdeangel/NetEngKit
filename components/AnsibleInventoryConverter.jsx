const { useState, useEffect, useCallback, useMemo } = React;

// ── Host range expansion  web[01:03] → web01 web02 web03 ─────────────
function aniExpandHost(hostname) {
  const m = hostname.match(/^(.+)\[(\d+):(\d+)\](.*)$/);
  if (!m) return [hostname];
  const [, pre, s, e, suf] = m;
  const start = parseInt(s, 10), end = parseInt(e, 10), pad = s.length;
  const out = [];
  for (let i = start; i <= end && i - start < 500; i++) {
    out.push(...aniExpandHost(`${pre}${String(i).padStart(pad, '0')}${suf}`));
  }
  return out;
}

// ── Parse host line: "host key=val key2=val2" ────────────────────────
function aniParseHostLine(line) {
  const parts = line.trim().split(/\s+/);
  const hostname = parts[0];
  const vars = {};
  for (let i = 1; i < parts.length; i++) {
    const eq = parts[i].indexOf('=');
    if (eq > 0) vars[parts[i].slice(0, eq)] = parts[i].slice(eq + 1);
  }
  return { hostname, vars };
}

// ── INI Parser ───────────────────────────────────────────────────────
function aniParseINI(text) {
  const groups = { all: { hosts: [], vars: {}, children: [] }, ungrouped: { hosts: [], vars: {}, children: [] } };
  const hostvars = {};
  let cur = null, mode = 'hosts';

  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;

    const sec = line.match(/^\[([^\]]+)\]$/);
    if (sec) {
      const name = sec[1].trim();
      if (name.endsWith(':vars')) { cur = name.slice(0, -5); mode = 'vars'; }
      else if (name.endsWith(':children')) { cur = name.slice(0, -9); mode = 'children'; }
      else { cur = name; mode = 'hosts'; groups[cur] = groups[cur] || { hosts: [], vars: {}, children: [] }; }
      continue;
    }

    if (!cur) {
      const { hostname, vars } = aniParseHostLine(line);
      for (const h of aniExpandHost(hostname)) {
        if (!groups.ungrouped.hosts.includes(h)) groups.ungrouped.hosts.push(h);
        hostvars[h] = { ...hostvars[h], ...vars };
      }
      continue;
    }

    if (mode === 'vars') {
      const eq = line.indexOf('=');
      if (eq > 0) {
        groups[cur] = groups[cur] || { hosts: [], vars: {}, children: [] };
        groups[cur].vars[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
    } else if (mode === 'children') {
      const child = line.split(/\s+/)[0];
      groups[cur] = groups[cur] || { hosts: [], vars: {}, children: [] };
      if (!groups[cur].children.includes(child)) groups[cur].children.push(child);
      groups[child] = groups[child] || { hosts: [], vars: {}, children: [] };
    } else {
      groups[cur] = groups[cur] || { hosts: [], vars: {}, children: [] };
      const { hostname, vars } = aniParseHostLine(line);
      for (const h of aniExpandHost(hostname)) {
        if (!groups[cur].hosts.includes(h)) groups[cur].hosts.push(h);
        hostvars[h] = { ...hostvars[h], ...vars };
      }
    }
  }

  // Auto-populate all.children if empty
  if (!groups.all.children.length && !groups.all.hosts.length) {
    for (const g of Object.keys(groups)) {
      if (g !== 'all' && g !== 'ungrouped' && !isChildOf(g, groups)) {
        groups.all.children.push(g);
      }
    }
  }
  return { groups, hostvars };
}

function isChildOf(name, groups) {
  for (const g of Object.values(groups)) {
    if (g.children.includes(name)) return true;
  }
  return false;
}

// ── Simple YAML tree builder ─────────────────────────────────────────
function aniParseYAML(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ indent: -1, node: root }];

  for (const raw of lines) {
    const trimmed = raw.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const indent = raw.search(/\S/);
    if (indent === -1) continue;

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) stack.pop();
    const parent = stack[stack.length - 1].node;

    if (trimmed.startsWith('- ')) {
      const val = trimmed.slice(2).trim();
      // Find parent key's array
      const parentNode = stack[stack.length - 1].node;
      // This is tricky without tracking last key - skip list items for now
      continue;
    }

    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    const val = trimmed.slice(colon + 1).trim();

    if (val === '' || val === '~' || val === 'null') {
      if (typeof parent[key] !== 'object' || parent[key] === null) parent[key] = {};
      stack.push({ indent, node: parent[key] });
    } else {
      parent[key] = val;
    }
  }

  const groups = {};
  const hostvars = {};

  function processGroup(name, node) {
    if (!groups[name]) groups[name] = { hosts: [], vars: {}, children: [] };
    if (!node || typeof node !== 'object') return;

    if (node.hosts && typeof node.hosts === 'object') {
      for (const [hn, hvars] of Object.entries(node.hosts)) {
        for (const h of aniExpandHost(hn)) {
          if (!groups[name].hosts.includes(h)) groups[name].hosts.push(h);
          if (hvars && typeof hvars === 'object') hostvars[h] = { ...hostvars[h], ...hvars };
        }
      }
    }
    if (node.vars && typeof node.vars === 'object') Object.assign(groups[name].vars, node.vars);
    if (node.children && typeof node.children === 'object') {
      for (const [cn, cv] of Object.entries(node.children)) {
        if (!groups[name].children.includes(cn)) groups[name].children.push(cn);
        processGroup(cn, typeof cv === 'object' && cv !== null ? cv : {});
      }
    }
  }

  for (const [g, n] of Object.entries(root)) processGroup(g, n);
  return { groups, hostvars };
}

// ── JSON Dynamic Inventory Parser ────────────────────────────────────
function aniParseJSON(text) {
  const data = JSON.parse(text);
  const groups = {};
  const hostvars = {};

  if (data._meta?.hostvars) Object.assign(hostvars, data._meta.hostvars);

  for (const [key, value] of Object.entries(data)) {
    if (key === '_meta') continue;
    groups[key] = groups[key] || { hosts: [], vars: {}, children: [] };

    if (Array.isArray(value)) {
      groups[key].hosts = value.flatMap(aniExpandHost);
    } else if (typeof value === 'object' && value !== null) {
      if (Array.isArray(value.hosts)) {
        groups[key].hosts = value.hosts.flatMap(aniExpandHost);
      } else if (value.hosts && typeof value.hosts === 'object') {
        groups[key].hosts = Object.keys(value.hosts).flatMap(aniExpandHost);
        for (const [h, hv] of Object.entries(value.hosts)) {
          if (hv && typeof hv === 'object') hostvars[h] = { ...hostvars[h], ...hv };
        }
      }
      if (value.vars && typeof value.vars === 'object') Object.assign(groups[key].vars, value.vars);
      if (Array.isArray(value.children)) {
        groups[key].children = value.children;
        for (const c of value.children) groups[c] = groups[c] || { hosts: [], vars: {}, children: [] };
      } else if (value.children && typeof value.children === 'object') {
        groups[key].children = Object.keys(value.children);
        for (const [cn, cv] of Object.entries(value.children)) {
          groups[cn] = groups[cn] || { hosts: [], vars: {}, children: [] };
          if (cv && typeof cv === 'object') {
            const ch = cv.hosts ? (Array.isArray(cv.hosts) ? cv.hosts : Object.keys(cv.hosts)) : [];
            groups[cn].hosts = [...new Set([...groups[cn].hosts, ...ch.flatMap(aniExpandHost)])];
            if (cv.vars) Object.assign(groups[cn].vars, cv.vars);
          }
        }
      }
    }
  }
  return { groups, hostvars };
}

// ── Format auto-detect ───────────────────────────────────────────────
function aniDetectFormat(text) {
  const t = text.trim();
  if (t.startsWith('{') || t.startsWith('[')) return 'json';
  if (/^\s*(all|webservers|dbservers|production|staging):\s*$/m.test(t)) return 'yaml';
  if (/^---/.test(t)) return 'yaml';
  if (!/^\[/.test(t) && /^\s{2,}\w+:/.test(t)) return 'yaml';
  return 'ini';
}

// ── Variable inheritance engine ──────────────────────────────────────
function aniResolveVars(hostname, groups, hostvars) {
  // Find all groups this host belongs to
  const hostGroups = new Set();
  for (const [gname, g] of Object.entries(groups)) {
    if (g.hosts.includes(hostname)) hostGroups.add(gname);
  }

  // Walk parent chain upward
  let changed = true;
  while (changed) {
    changed = false;
    for (const [gname, g] of Object.entries(groups)) {
      if (g.children.some(c => hostGroups.has(c)) && !hostGroups.has(gname)) {
        hostGroups.add(gname);
        changed = true;
      }
    }
  }

  // Order groups by depth from 'all' (BFS)
  const depth = {};
  const queue = [['all', 0]];
  const visited = new Set();
  while (queue.length) {
    const [n, d] = queue.shift();
    if (visited.has(n)) continue;
    visited.add(n); depth[n] = d;
    for (const c of (groups[n]?.children || [])) queue.push([c, d + 1]);
  }

  const ordered = [...hostGroups].sort((a, b) => (depth[a] ?? 99) - (depth[b] ?? 99));
  const resolved = {};
  const sources = {};

  for (const g of ordered) {
    for (const [k, v] of Object.entries(groups[g]?.vars || {})) {
      if (!(k in resolved)) { resolved[k] = v; sources[k] = `group:${g}`; }
    }
  }
  for (const [k, v] of Object.entries(hostvars[hostname] || {})) {
    resolved[k] = v; sources[k] = 'host';
  }

  return { resolved, sources, memberGroups: [...hostGroups] };
}

// ── All unique hosts ─────────────────────────────────────────────────
function aniGetAllHosts(groups, hostvars) {
  const s = new Set();
  for (const g of Object.values(groups)) for (const h of g.hosts) s.add(h);
  for (const h of Object.keys(hostvars)) s.add(h);
  return [...s].sort();
}

// ── Export helpers ────────────────────────────────────────────────────
function aniExportINI(groups, hostvars) {
  const lines = [];
  const done = new Set(['all', 'ungrouped']);

  for (const [gname, g] of Object.entries(groups)) {
    if (done.has(gname)) continue;
    done.add(gname);
    lines.push(`[${gname}]`);
    for (const h of g.hosts) {
      const vars = hostvars[h] || {};
      const vs = Object.entries(vars).map(([k, v]) => `${k}=${v}`).join(' ');
      lines.push(vs ? `${h} ${vs}` : h);
    }
    if (Object.keys(g.vars).length) {
      lines.push('', `[${gname}:vars]`);
      for (const [k, v] of Object.entries(g.vars)) lines.push(`${k}=${v}`);
    }
    if (g.children.length) {
      lines.push('', `[${gname}:children]`);
      for (const c of g.children) lines.push(c);
    }
    lines.push('');
  }
  if (groups.ungrouped?.hosts.length) {
    lines.push('[ungrouped]');
    for (const h of groups.ungrouped.hosts) {
      const vs = Object.entries(hostvars[h] || {}).map(([k, v]) => `${k}=${v}`).join(' ');
      lines.push(vs ? `${h} ${vs}` : h);
    }
  }
  return lines.join('\n');
}

function aniExportYAML(groups, hostvars) {
  const lines = ['---'];
  const written = new Set();

  function writeGroup(name, indent) {
    if (written.has(name)) return;
    written.add(name);
    const g = groups[name] || { hosts: [], vars: {}, children: [] };
    const p = ' '.repeat(indent), p2 = ' '.repeat(indent + 2), p4 = ' '.repeat(indent + 4);

    if (g.hosts.length) {
      lines.push(`${p}hosts:`);
      for (const h of g.hosts) {
        const hv = hostvars[h] || {};
        if (Object.keys(hv).length) {
          lines.push(`${p2}${h}:`);
          for (const [k, v] of Object.entries(hv)) lines.push(`${p4}${k}: ${v}`);
        } else {
          lines.push(`${p2}${h}:`);
        }
      }
    }
    if (Object.keys(g.vars).length) {
      lines.push(`${p}vars:`);
      for (const [k, v] of Object.entries(g.vars)) lines.push(`${p2}${k}: ${v}`);
    }
    if (g.children.length) {
      lines.push(`${p}children:`);
      for (const c of g.children) {
        lines.push(`${p2}${c}:`);
        writeGroup(c, indent + 4);
      }
    }
  }

  const allG = groups.all || { hosts: [], vars: {}, children: Object.keys(groups).filter(g => g !== 'all') };
  lines.push('all:');
  writeGroup('all', 2);
  return lines.join('\n');
}

function aniExportJSONDynamic(groups, hostvars) {
  const out = { _meta: { hostvars: {} } };
  for (const [g, data] of Object.entries(groups)) {
    out[g] = {};
    if (data.hosts.length) out[g].hosts = data.hosts;
    if (Object.keys(data.vars).length) out[g].vars = data.vars;
    if (data.children.length) out[g].children = data.children;
  }
  for (const [h, vars] of Object.entries(hostvars)) {
    if (Object.keys(vars).length) out._meta.hostvars[h] = vars;
  }
  return JSON.stringify(out, null, 2);
}

function aniExportCSV(hosts, groups, hostvars) {
  if (!hosts.length) return '';
  // Collect all var keys
  const allKeys = new Set(['hostname', 'groups']);
  for (const h of hosts) {
    const { resolved } = aniResolveVars(h, groups, hostvars);
    for (const k of Object.keys(resolved)) allKeys.add(k);
  }
  const keys = [...allKeys];
  const rows = [keys.join(',')];
  for (const h of hosts) {
    const { resolved, memberGroups } = aniResolveVars(h, groups, hostvars);
    const row = keys.map(k => {
      if (k === 'hostname') return `"${h}"`;
      if (k === 'groups') return `"${memberGroups.filter(g => g !== 'all').join(';')}"`;
      return `"${(resolved[k] ?? '').toString().replace(/"/g, '""')}"`;
    });
    rows.push(row.join(','));
  }
  return rows.join('\n');
}

// ── Sample inventories ────────────────────────────────────────────────
const ANI_SAMPLES = {
  ini: `# Multi-tier production inventory
[webservers]
web[01:03].prod.example.com ansible_host=10.0.1.1{n} ansible_user=deploy http_port=8080

[webservers:vars]
nginx_version=1.24.0
ssl_cert=/etc/ssl/certs/prod.pem
max_connections=1024

[dbservers]
db1.prod.example.com ansible_host=10.0.2.11 ansible_user=postgres pg_port=5432
db2.prod.example.com ansible_host=10.0.2.12 ansible_user=postgres pg_port=5432 pg_replica=true

[dbservers:vars]
pg_version=15
pg_max_connections=500
pg_shared_buffers=256MB

[loadbalancers]
lb1.prod.example.com ansible_host=10.0.0.11 ansible_user=haproxy
lb2.prod.example.com ansible_host=10.0.0.12 ansible_user=haproxy

[loadbalancers:vars]
haproxy_mode=tcp
haproxy_timeout=30s

[monitoring]
mon1.prod.example.com ansible_host=10.0.3.11 ansible_user=prometheus

[production:children]
webservers
dbservers
loadbalancers
monitoring

[production:vars]
env=production
ntp_server=pool.ntp.org
dns_servers=10.0.0.1,10.0.0.2
ansible_python_interpreter=/usr/bin/python3

[staging]
staging1.example.com ansible_host=192.168.10.10 ansible_user=ubuntu

[staging:vars]
env=staging
ntp_server=pool.ntp.org

[datacenter_us:children]
production
staging

[datacenter_us:vars]
region=us-east-1
timezone=America/New_York`,
  yaml: `---
all:
  vars:
    ansible_python_interpreter: /usr/bin/python3
    ntp_server: pool.ntp.org
  children:
    production:
      vars:
        env: production
        dns_servers: 10.0.0.1,10.0.0.2
      children:
        webservers:
          vars:
            nginx_version: 1.24.0
            http_port: "80"
          hosts:
            web1.prod.example.com:
              ansible_host: 10.0.1.11
              ansible_user: deploy
            web2.prod.example.com:
              ansible_host: 10.0.1.12
              ansible_user: deploy
        dbservers:
          vars:
            pg_version: "15"
            pg_max_connections: "500"
          hosts:
            db1.prod.example.com:
              ansible_host: 10.0.2.11
              ansible_user: postgres
            db2.prod.example.com:
              ansible_host: 10.0.2.12
              ansible_user: postgres
              pg_replica: "true"
    staging:
      vars:
        env: staging
      hosts:
        staging1.example.com:
          ansible_host: 192.168.10.10
          ansible_user: ubuntu`,
  json: `{
  "webservers": {
    "hosts": ["web1.prod.example.com", "web2.prod.example.com"],
    "vars": {"nginx_version": "1.24.0", "http_port": 80}
  },
  "dbservers": {
    "hosts": ["db1.prod.example.com", "db2.prod.example.com"],
    "vars": {"pg_version": 15, "pg_max_connections": 500}
  },
  "production": {
    "children": ["webservers", "dbservers"],
    "vars": {"env": "production", "dns_servers": "10.0.0.1,10.0.0.2"}
  },
  "staging": {
    "hosts": ["staging1.example.com"],
    "vars": {"env": "staging"}
  },
  "_meta": {
    "hostvars": {
      "web1.prod.example.com": {"ansible_host": "10.0.1.11", "ansible_user": "deploy"},
      "web2.prod.example.com": {"ansible_host": "10.0.1.12", "ansible_user": "deploy"},
      "db1.prod.example.com": {"ansible_host": "10.0.2.11", "ansible_user": "postgres"},
      "db2.prod.example.com": {"ansible_host": "10.0.2.12", "ansible_user": "postgres", "pg_replica": "true"},
      "staging1.example.com": {"ansible_host": "192.168.10.10", "ansible_user": "ubuntu"}
    }
  }
}`
};

// ── Styles ────────────────────────────────────────────────────────────
const ANI_S = {
  textarea: { width: '100%', minHeight: 280, resize: 'vertical', fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.5, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 10, color: 'var(--text)', boxSizing: 'border-box' },
  tableWrap: { overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--panel)' },
  table: { width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.5 },
  th: { textAlign: 'left', padding: '7px 10px', borderBottom: '1px solid var(--border)', color: 'var(--dim)', fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5, whiteSpace: 'nowrap', background: 'var(--bg)' },
  td: { padding: '5px 10px', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis' },
  codeBox: { fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.6, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: 14, overflowX: 'auto', whiteSpace: 'pre', maxHeight: 480, overflowY: 'auto' },
  treeItem: { fontFamily: 'var(--mono)', fontSize: 13, lineHeight: 1.7, padding: '2px 0' },
  badge: { display: 'inline-block', padding: '1px 7px', borderRadius: 12, fontSize: 11, fontWeight: 600, marginRight: 4 },
};

// ── Group Tree ────────────────────────────────────────────────────────
function AniGroupTree({ groups, hostvars, onSelectGroup }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(() => new Set(['all']));

  function toggle(g) {
    setExpanded(prev => {
      const n = new Set(prev);
      n.has(g) ? n.delete(g) : n.add(g);
      return n;
    });
  }

  function renderGroup(name, indent) {
    const g = groups[name];
    if (!g) return null;
    const hasChildren = g.children.length > 0;
    const hostCount = g.hosts.length;
    const varCount = Object.keys(g.vars).length;
    const allHostsInChildren = () => {
      let count = 0;
      function countDeep(n) {
        const grp = groups[n];
        if (!grp) return;
        count += grp.hosts.length;
        for (const c of grp.children) countDeep(c);
      }
      for (const c of g.children) countDeep(c);
      return count;
    };

    return (
      <div key={name} style={{ marginLeft: indent }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0', cursor: hasChildren ? 'pointer' : 'default' }}
          onClick={() => hasChildren && toggle(name)}>
          {hasChildren && (
            <span style={{ fontSize: 10, color: 'var(--dim)', userSelect: 'none', width: 14 }}>
              {expanded.has(name) ? '▼' : '▶'}
            </span>
          )}
          {!hasChildren && <span style={{ width: 14 }} />}
          <span style={{ fontFamily: 'var(--mono)', fontSize: 13, color: 'var(--accent)', fontWeight: 600 }}>{name}</span>
          {hostCount > 0 && (
            <span style={{ ...ANI_S.badge, background: 'rgba(0,212,200,0.1)', color: 'var(--accent)' }}>
              {hostCount} {t('ansible_inventory.hosts_label')}
            </span>
          )}
          {hasChildren && (
            <span style={{ ...ANI_S.badge, background: 'rgba(100,100,200,0.1)', color: 'var(--dim)' }}>
              {g.children.length} {t('ansible_inventory.children_label')}
            </span>
          )}
          {varCount > 0 && (
            <span style={{ ...ANI_S.badge, background: 'rgba(255,180,0,0.1)', color: '#f5a623' }}>
              {varCount} {t('ansible_inventory.vars_label')}
            </span>
          )}
        </div>
        {Object.keys(g.vars).length > 0 && (
          <div style={{ marginLeft: 30, marginBottom: 2 }}>
            {Object.entries(g.vars).map(([k, v]) => (
              <div key={k} style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)' }}>
                <span style={{ color: '#f5a623' }}>{k}</span>
                <span style={{ color: 'var(--dim)' }}>=</span>
                <span style={{ color: 'var(--text)' }}>{v}</span>
              </div>
            ))}
          </div>
        )}
        {expanded.has(name) && g.hosts.map(h => (
          <div key={h} style={{ marginLeft: 30, fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--text)', padding: '1px 0' }}>
            <span style={{ color: 'var(--dim)', marginRight: 4 }}>├─</span>{h}
            {hostvars[h] && Object.keys(hostvars[h]).length > 0 && (
              <span style={{ color: 'var(--dim)', fontSize: 11, marginLeft: 6 }}>
                ({Object.keys(hostvars[h]).length} {t('ansible_inventory.vars_label')})
              </span>
            )}
          </div>
        ))}
        {expanded.has(name) && g.children.map(c => renderGroup(c, 20))}
      </div>
    );
  }

  const topLevel = Object.keys(groups).filter(g => !isChildOf(g, groups) && g !== 'ungrouped');

  return (
    <div style={{ padding: 12, fontFamily: 'var(--mono)', fontSize: 13 }}>
      {topLevel.map(g => renderGroup(g, 0))}
      {groups.ungrouped?.hosts.length > 0 && renderGroup('ungrouped', 0)}
    </div>
  );
}

// ── Variable Matrix ───────────────────────────────────────────────────
function AniVarMatrix({ hosts, groups, hostvars }) {
  const { t } = useTranslation();
  const [filterKey, setFilterKey] = useState('');

  const allKeys = useMemo(() => {
    const s = new Set();
    for (const h of hosts) {
      const { resolved } = aniResolveVars(h, groups, hostvars);
      for (const k of Object.keys(resolved)) s.add(k);
    }
    return [...s].sort();
  }, [hosts, groups, hostvars]);

  const filteredKeys = useMemo(() => {
    if (!filterKey.trim()) return allKeys;
    return allKeys.filter(k => k.toLowerCase().includes(filterKey.toLowerCase()));
  }, [allKeys, filterKey]);

  if (!hosts.length) return <div style={{ padding: 20, color: 'var(--dim)', textAlign: 'center' }}>{t('ansible_inventory.no_data')}</div>;

  return (
    <div>
      <div style={{ padding: '0 0 10px' }}>
        <input
          className="input"
          style={{ maxWidth: 280 }}
          placeholder={t('ansible_inventory.filter_vars')}
          value={filterKey}
          onChange={e => setFilterKey(e.target.value)}
        />
      </div>
      <div style={ANI_S.tableWrap}>
        <table style={ANI_S.table}>
          <thead>
            <tr>
              <th style={{ ...ANI_S.th, position: 'sticky', left: 0, zIndex: 2, background: 'var(--bg)' }}>
                {t('ansible_inventory.variable')}
              </th>
              {hosts.slice(0, 20).map(h => (
                <th key={h} style={{ ...ANI_S.th, maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {h.split('.')[0]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredKeys.map(key => {
              const rowVals = hosts.slice(0, 20).map(h => {
                const { resolved, sources } = aniResolveVars(h, groups, hostvars);
                return { val: resolved[key], src: sources[key] };
              });
              const hasAny = rowVals.some(r => r.val !== undefined);
              if (!hasAny) return null;
              return (
                <tr key={key}>
                  <td style={{ ...ANI_S.td, position: 'sticky', left: 0, background: 'var(--panel)', fontWeight: 600, color: '#f5a623' }}>
                    {key}
                  </td>
                  {rowVals.map((r, i) => (
                    <td key={i} style={{ ...ANI_S.td, color: r.src === 'host' ? 'var(--accent)' : r.val !== undefined ? 'var(--text)' : 'var(--dim)' }}>
                      {r.val !== undefined ? String(r.val) : '—'}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {hosts.length > 20 && (
        <div style={{ padding: '8px 10px', color: 'var(--dim)', fontSize: 12 }}>
          {t('ansible_inventory.showing_first')} 20 {t('ansible_inventory.of')} {hosts.length} {t('ansible_inventory.hosts_label')}
        </div>
      )}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────
function AnsibleInventoryConverter({ initialData, onShare }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('ansible_inv:input', initialData?.input ?? '');
  const [activeTab, setActiveTab] = usePersistentState('ansible_inv:tab', initialData?.tab ?? 'hosts');
  const [exportFmt, setExportFmt] = usePersistentState('ansible_inv:exportFmt', 'csv');
  const [hostFilter, setHostFilter] = useState('');
  const [groupFilter, setGroupFilter] = useState('');
  const [error, setError] = useState(null);
  const [parsed, setParsed] = useState(null);
  const [detectedFmt, setDetectedFmt] = useState('ini');
  const [copied, copy] = useCopy();

  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'ansible-inventory', input, tab: activeTab });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [input, activeTab, onShare]);

  const parse = useCallback(() => {
    if (!input.trim()) { setParsed(null); setError(null); return; }
    try {
      const fmt = aniDetectFormat(input);
      setDetectedFmt(fmt);
      let result;
      if (fmt === 'json') result = aniParseJSON(input);
      else if (fmt === 'yaml') result = aniParseYAML(input);
      else result = aniParseINI(input);
      setParsed(result);
      setError(null);
    } catch (e) {
      setError(e.message || t('ansible_inventory.parse_error'));
      setParsed(null);
    }
  }, [input]);

  // Auto-parse
  useEffect(() => { parse(); }, [input]);

  const allHosts = useMemo(() => parsed ? aniGetAllHosts(parsed.groups, parsed.hostvars) : [], [parsed]);

  const filteredHosts = useMemo(() => {
    let h = allHosts;
    if (hostFilter.trim()) h = h.filter(x => x.toLowerCase().includes(hostFilter.toLowerCase()));
    if (groupFilter && groupFilter !== '__all__') {
      const g = parsed?.groups[groupFilter];
      if (g) h = h.filter(x => g.hosts.includes(x));
    }
    return h;
  }, [allHosts, hostFilter, groupFilter, parsed]);

  const stats = useMemo(() => {
    if (!parsed) return null;
    const { groups, hostvars } = parsed;
    const hostCount = allHosts.length;
    const groupCount = Object.keys(groups).filter(g => g !== 'ungrouped').length;
    const allKeys = new Set();
    for (const h of allHosts) {
      const { resolved } = aniResolveVars(h, groups, hostvars);
      for (const k of Object.keys(resolved)) allKeys.add(k);
    }
    return { hostCount, groupCount, varCount: allKeys.size };
  }, [parsed, allHosts]);

  const exportContent = useMemo(() => {
    if (!parsed) return '';
    const { groups, hostvars } = parsed;
    if (exportFmt === 'csv') return aniExportCSV(allHosts, groups, hostvars);
    if (exportFmt === 'ini') return aniExportINI(groups, hostvars);
    if (exportFmt === 'yaml') return aniExportYAML(groups, hostvars);
    if (exportFmt === 'json') return aniExportJSONDynamic(groups, hostvars);
    return '';
  }, [parsed, exportFmt, allHosts]);

  const doExport = useCallback(() => {
    const ext = exportFmt === 'json' ? 'json' : exportFmt === 'yaml' ? 'yml' : exportFmt === 'ini' ? 'ini' : 'csv';
    const mime = exportFmt === 'json' ? 'application/json' : exportFmt === 'csv' ? 'text/csv' : 'text/plain';
    const blob = new Blob([exportContent], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `inventory.${ext}`; a.click();
    URL.revokeObjectURL(url);
  }, [exportContent, exportFmt]);

  const TABS = [
    { id: 'hosts', label: 'ansible_inventory.tab_hosts' },
    { id: 'groups', label: 'ansible_inventory.tab_groups' },
    { id: 'vars', label: 'ansible_inventory.tab_vars' },
    { id: 'export', label: 'ansible_inventory.tab_export' },
  ];

  const FMT_BADGE = { ini: 'badge-cyan', yaml: 'badge-green', json: 'badge-yellow' };

  return (
    <div className="fadein">
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, flexWrap: 'wrap', gap: 8 }}>
          <div className="card-title" style={{ margin: 0 }}>{t('ansible_inventory.title')}</div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <span className={`badge ${FMT_BADGE[detectedFmt] || 'badge-cyan'}`}>
              {detectedFmt.toUpperCase()}
            </span>
            <select className="select" style={{ height: 30, fontSize: 12, padding: '0 8px' }}
              value={detectedFmt}
              onChange={e => { setDetectedFmt(e.target.value); }}>
              <option value="ini">INI</option>
              <option value="yaml">YAML</option>
              <option value="json">JSON</option>
            </select>
            <select className="select" style={{ height: 30, fontSize: 12, padding: '0 8px' }}
              onChange={e => setInput(ANI_SAMPLES[e.target.value] || '')}
              defaultValue="">
              <option value="">{t('ansible_inventory.load_sample')}</option>
              <option value="ini">{t('ansible_inventory.sample_ini')}</option>
              <option value="yaml">{t('ansible_inventory.sample_yaml')}</option>
              <option value="json">{t('ansible_inventory.sample_json')}</option>
            </select>
          </div>
        </div>
        <textarea
          style={ANI_S.textarea}
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t('ansible_inventory.placeholder')}
          spellCheck={false}
        />
        {error && <div className="err" style={{ marginTop: 8 }}>⚠ {error}</div>}
        {stats && (
          <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
            <span className="badge badge-cyan">{stats.hostCount} {t('ansible_inventory.hosts_label')}</span>
            <span className="badge badge-blue">{stats.groupCount} {t('ansible_inventory.groups_label')}</span>
            <span className="badge badge-yellow">{stats.varCount} {t('ansible_inventory.unique_vars')}</span>
            <span style={{ fontSize: 12, color: 'var(--dim)', alignSelf: 'center' }}>
              {t('ansible_inventory.detected')} {detectedFmt.toUpperCase()}
            </span>
          </div>
        )}
      </div>

      {parsed && (
        <div className="card">
          <div className="btn-row" style={{ marginBottom: 16 }}>
            {TABS.map(tab => (
              <button key={tab.id}
                className={`btn btn-sm ${activeTab === tab.id ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setActiveTab(tab.id)}>
                {t(tab.label)}
              </button>
            ))}
          </div>

          {/* HOSTS TAB */}
          {activeTab === 'hosts' && (
            <div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <input className="input" style={{ maxWidth: 260, flex: 1 }}
                  placeholder={t('ansible_inventory.filter_hosts')}
                  value={hostFilter} onChange={e => setHostFilter(e.target.value)} />
                <select className="select" value={groupFilter || '__all__'}
                  onChange={e => setGroupFilter(e.target.value === '__all__' ? '' : e.target.value)}>
                  <option value="__all__">{t('ansible_inventory.all_groups')}</option>
                  {Object.keys(parsed.groups).filter(g => parsed.groups[g].hosts.length > 0).sort().map(g => (
                    <option key={g} value={g}>{g} ({parsed.groups[g].hosts.length})</option>
                  ))}
                </select>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const rows = filteredHosts.map(h => {
                      const { resolved, memberGroups } = aniResolveVars(h, parsed.groups, parsed.hostvars);
                      return { hostname: h, groups: memberGroups.filter(g => g !== 'all').join(';'), ...resolved };
                    });
                    exportCSV(rows, 'hosts.csv');
                  }}>
                  {t('common.export_csv')}
                </button>
                <button className="btn btn-ghost btn-sm"
                  onClick={() => {
                    const rows = filteredHosts.map(h => {
                      const { resolved, memberGroups } = aniResolveVars(h, parsed.groups, parsed.hostvars);
                      return { hostname: h, groups: memberGroups.filter(g => g !== 'all'), ...resolved };
                    });
                    exportJSON(rows, 'hosts.json');
                  }}>
                  {t('common.export_json')}
                </button>
              </div>
              <div style={ANI_S.tableWrap}>
                <table style={ANI_S.table}>
                  <thead>
                    <tr>
                      <th style={ANI_S.th}>{t('ansible_inventory.col_host')}</th>
                      <th style={ANI_S.th}>{t('ansible_inventory.col_groups')}</th>
                      <th style={ANI_S.th}>ansible_host</th>
                      <th style={ANI_S.th}>ansible_user</th>
                      <th style={ANI_S.th}>ansible_port</th>
                      <th style={ANI_S.th}>{t('ansible_inventory.col_vars')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredHosts.map(h => {
                      const { resolved, memberGroups } = aniResolveVars(h, parsed.groups, parsed.hostvars);
                      const extraVars = Object.entries(resolved)
                        .filter(([k]) => !['ansible_host', 'ansible_user', 'ansible_port'].includes(k));
                      return (
                        <tr key={h}>
                          <td style={{ ...ANI_S.td, fontWeight: 600, color: 'var(--accent)' }}>{h}</td>
                          <td style={{ ...ANI_S.td, maxWidth: 200 }}>
                            {memberGroups.filter(g => g !== 'all' && g !== 'ungrouped').map(g => (
                              <span key={g} style={{ ...ANI_S.badge, background: 'rgba(0,212,200,0.08)', color: 'var(--accent)', fontSize: 10, marginBottom: 2 }}>{g}</span>
                            ))}
                          </td>
                          <td style={ANI_S.td}>{resolved.ansible_host || <span style={{ color: 'var(--dim)' }}>—</span>}</td>
                          <td style={ANI_S.td}>{resolved.ansible_user || <span style={{ color: 'var(--dim)' }}>—</span>}</td>
                          <td style={ANI_S.td}>{resolved.ansible_port || <span style={{ color: 'var(--dim)' }}>22</span>}</td>
                          <td style={{ ...ANI_S.td, maxWidth: 300 }}>
                            {extraVars.slice(0, 4).map(([k, v]) => (
                              <span key={k} style={{ fontFamily: 'var(--mono)', fontSize: 11, marginRight: 6 }}>
                                <span style={{ color: '#f5a623' }}>{k}</span>=<span>{String(v)}</span>
                              </span>
                            ))}
                            {extraVars.length > 4 && <span style={{ color: 'var(--dim)', fontSize: 11 }}>+{extraVars.length - 4} {t('ansible_inventory.more')}</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: '8px 10px', color: 'var(--dim)', fontSize: 12 }}>
                {filteredHosts.length} {t('ansible_inventory.of')} {allHosts.length} {t('ansible_inventory.hosts_label')}
              </div>
            </div>
          )}

          {/* GROUPS TAB */}
          {activeTab === 'groups' && (
            <div>
              <div className="card-title" style={{ marginBottom: 12 }}>{t('ansible_inventory.group_hierarchy')}</div>
              <div style={{ ...ANI_S.tableWrap, marginBottom: 16 }}>
                <AniGroupTree groups={parsed.groups} hostvars={parsed.hostvars} />
              </div>
              <div className="card-title" style={{ marginBottom: 8 }}>{t('ansible_inventory.group_summary')}</div>
              <div style={ANI_S.tableWrap}>
                <table style={ANI_S.table}>
                  <thead>
                    <tr>
                      <th style={ANI_S.th}>{t('ansible_inventory.col_group')}</th>
                      <th style={ANI_S.th}>{t('ansible_inventory.col_direct_hosts')}</th>
                      <th style={ANI_S.th}>{t('ansible_inventory.col_children')}</th>
                      <th style={ANI_S.th}>{t('ansible_inventory.col_group_vars')}</th>
                      <th style={ANI_S.th}>{t('ansible_inventory.col_parents')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(parsed.groups).sort(([a], [b]) => a.localeCompare(b)).map(([g, data]) => {
                      const parents = Object.entries(parsed.groups)
                        .filter(([, gd]) => gd.children.includes(g))
                        .map(([p]) => p);
                      return (
                        <tr key={g}>
                          <td style={{ ...ANI_S.td, fontWeight: 600, color: 'var(--accent)' }}>{g}</td>
                          <td style={ANI_S.td}>{data.hosts.length}</td>
                          <td style={ANI_S.td}>{data.children.join(', ') || <span style={{ color: 'var(--dim)' }}>—</span>}</td>
                          <td style={ANI_S.td}>
                            {Object.entries(data.vars).map(([k, v]) => (
                              <div key={k} style={{ fontSize: 11, fontFamily: 'var(--mono)' }}>
                                <span style={{ color: '#f5a623' }}>{k}</span>=<span>{v}</span>
                              </div>
                            ))}
                            {!Object.keys(data.vars).length && <span style={{ color: 'var(--dim)' }}>—</span>}
                          </td>
                          <td style={ANI_S.td}>{parents.join(', ') || <span style={{ color: 'var(--dim)' }}>—</span>}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* VARS TAB */}
          {activeTab === 'vars' && (
            <div>
              <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--dim)' }}>
                {t('ansible_inventory.vars_legend')}
                <span style={{ color: 'var(--accent)', marginLeft: 12 }}>■ {t('ansible_inventory.host_var')}</span>
                <span style={{ color: 'var(--text)', marginLeft: 12 }}>■ {t('ansible_inventory.group_var')}</span>
              </div>
              <AniVarMatrix hosts={filteredHosts} groups={parsed.groups} hostvars={parsed.hostvars} />
            </div>
          )}

          {/* EXPORT TAB */}
          {activeTab === 'export' && (
            <div>
              <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--dim)' }}>{t('ansible_inventory.export_as')}</span>
                {['csv', 'ini', 'yaml', 'json'].map(f => (
                  <button key={f}
                    className={`btn btn-sm ${exportFmt === f ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setExportFmt(f)}>
                    {f.toUpperCase()}
                  </button>
                ))}
                <button className="btn btn-ghost btn-sm" onClick={() => copy(exportContent, 'export')}>
                  {copied === 'export' ? '✓' : t('common.copy')}
                </button>
                <button className="btn btn-primary btn-sm" onClick={doExport}>
                  {t('ansible_inventory.download')}
                </button>
              </div>
              {exportFmt === 'csv' && (
                <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--dim)' }}>
                  {t('ansible_inventory.csv_note')} — {allHosts.length} {t('ansible_inventory.rows')}
                </div>
              )}
              {exportFmt === 'json' && (
                <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--dim)' }}>
                  {t('ansible_inventory.json_note')}
                </div>
              )}
              <div style={ANI_S.codeBox}>{exportContent}</div>
            </div>
          )}
        </div>
      )}

      {!parsed && !error && (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: 'var(--dim)' }}>
          {t('ansible_inventory.empty_state')}
        </div>
      )}
    </div>
  );
}

window.AnsibleInventoryConverter = AnsibleInventoryConverter;
