const { useEffect, useMemo, useRef } = React;

// <copp-math>
function coppIpToInt(ip) {
  const p = String(ip).split('.');
  if (p.length !== 4) return null;
  let n = 0;
  for (const o of p) {
    if (!/^\d{1,3}$/.test(o) || +o > 255) return null;
    n = n * 256 + +o;
  }
  return n;
}
function coppIntToIp(n) {
  return [24, 16, 8, 0].map(s => Math.floor(n / 2 ** s) % 256).join('.');
}
// Parse 'any' | 'a.b.c.d' | 'a.b.c.d/len'. Returns { any:true } | { ip, len } | null.
// Host bits set → null (an ACL with host bits set is a typo, not intent).
function coppParsePrefix(s) {
  const v = String(s || '').trim().toLowerCase();
  if (v === 'any' || v === '0.0.0.0/0') return { any: true };
  const m = v.match(/^([\d.]+)(?:\/(\d{1,2}))?$/);
  if (!m) return null;
  const ipInt = coppIpToInt(m[1]);
  const len = m[2] === undefined ? 32 : +m[2];
  if (ipInt === null || len > 32) return null;
  const size = 2 ** (32 - len);
  if (ipInt % size !== 0) return null;
  return { ip: m[1], len, wild: coppIntToIp(size - 1) };
}
// Cisco IOS / IOS-XE ACL source token.
function coppIosSrc(s) {
  const p = coppParsePrefix(s);
  if (!p) return null;
  if (p.any) return 'any';
  if (p.len === 32) return 'host ' + p.ip;
  return p.ip + ' ' + p.wild;
}
// NX-OS ACL source token (CIDR).
function coppNxosSrc(s) {
  const p = coppParsePrefix(s);
  if (!p) return null;
  return p.any ? 'any' : p.ip + '/' + p.len;
}
// Junos bandwidth-limit token: exact m / k suffix when divisible, raw bps otherwise.
function coppJunosBw(bps) {
  if (bps % 1000000 === 0) return (bps / 1000000) + 'm';
  if (bps % 1000 === 0) return (bps / 1000) + 'k';
  return String(bps);
}
// Milliseconds of traffic at CIR that the burst absorbs. bytes*8 / (kbps*1000) s → ms.
function coppBurstMs(kbps, bytes) {
  if (!(kbps > 0) || !(bytes >= 0)) return NaN;
  return (bytes * 8) / kbps;
}
// </copp-math>

const COPP_TABS = ['config', 'reference'];
const COPP_PLATFORMS = ['ios', 'iosxe', 'nxos', 'junos'];
const COPP_ATTACH = ['aggregate', 'host', 'transit'];
const COPP_ACTIONS_FIXED  = ['police', 'monitor'];
const COPP_ACTIONS_CUSTOM = ['police', 'monitor', 'block'];
const COPP_CUSTOM_PROTOS  = ['tcp', 'udp', 'icmp', 'gre', 'esp', 'ip'];
const COPP_MAX_CUSTOM = 6;
const COPP_P = 'COPP';
const COPP_NAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

const COPP_FIXED = [
  { key: 'bgp',  cls: 'BGP',  acl: [{ proto: 'tcp', port: 179, bidir: true }] },
  { key: 'ospf', cls: 'OSPF', acl: [{ proto: 'ospf' }] },
  { key: 'isis', cls: 'ISIS', special: 'isis' },
  { key: 'ssh',  cls: 'SSH',  acl: [{ proto: 'tcp', port: 22 }] },
  { key: 'snmp', cls: 'SNMP', acl: [{ proto: 'udp', port: 161 }] },
  { key: 'ntp',  cls: 'NTP',  acl: [{ proto: 'udp', port: 123, bidir: true }] },
  { key: 'icmp', cls: 'ICMP', acl: [{ proto: 'icmp' }] },
  { key: 'arp',  cls: 'ARP',  special: 'arp' },
];

const COPP_RESERVED = [...COPP_FIXED.map(s => s.cls.toLowerCase()), 'default', 'class-default'];

// [kbps, bytes, pps, pkts]
const COPP_PRESETS = {
  lenient:  { action: 'monitor', junosDefault: 'police',
    rows: { bgp: [4000, 500000, 2000, 256], ospf: [2000, 250000, 1000, 128], ssh: [1000, 125000, 500, 64],
            snmp: [1000, 125000, 500, 64], ntp: [256, 32000, 100, 32], icmp: [512, 64000, 250, 32],
            arp: [512, 64000, 500, 64] },
    def: [2000, 250000, 1000, 128] },
  moderate: { action: 'police', junosDefault: 'police',
    rows: { bgp: [2000, 250000, 1000, 128], ospf: [1000, 125000, 500, 64], ssh: [512, 64000, 250, 32],
            snmp: [512, 64000, 250, 32], ntp: [128, 16000, 50, 32], icmp: [256, 32000, 100, 32],
            arp: [256, 32000, 250, 32] },
    def: [1000, 125000, 500, 64] },
  strict:   { action: 'police', junosDefault: 'discard',
    rows: { bgp: [1000, 125000, 500, 64], ospf: [512, 64000, 250, 32], ssh: [256, 32000, 100, 32],
            snmp: [256, 32000, 100, 32], ntp: [64, 8000, 25, 16], icmp: [64, 8000, 50, 16],
            arp: [128, 16000, 100, 32] },
    def: [256, 32000, 100, 32] },
};

function coppDefaultRows() {
  const p = COPP_PRESETS.moderate;
  const out = {};
  for (const spec of COPP_FIXED) {
    const k = spec.key;
    if (k === 'isis') {
      out[k] = { on: false, action: p.action };
      continue;
    }
    const [kbps, bytes, pps, pkts] = p.rows[k];
    const row = {
      on: true,
      kbps: String(kbps), bytes: String(bytes), pps: String(pps), pkts: String(pkts),
      action: p.action,
    };
    if (k !== 'arp') row.src = (k === 'ssh' || k === 'snmp') ? '10.0.0.0/24' : 'any';
    out[k] = row;
  }
  return out;
}

function coppIsBps(platform) {
  return platform === 'ios' || platform === 'iosxe' || platform === 'junos';
}

function coppParseUint(s) {
  const v = String(s ?? '').trim();
  if (v === '') return null;
  if (!/^\d+$/.test(v)) return NaN;
  return Number(v);
}

function coppSrcIsAny(s) {
  const p = coppParsePrefix(s);
  return !!(p && p.any);
}

function coppAclLines(acl, srcToken, indent) {
  const out = [];
  for (const e of acl) {
    const p = e.proto;
    if (p === 'tcp' || p === 'udp') {
      const port = e.port != null && String(e.port).trim() !== '' ? String(e.port).trim() : '';
      if (port) {
        out.push(indent + 'permit ' + p + ' ' + srcToken + ' any eq ' + port);
        if (e.bidir) out.push(indent + 'permit ' + p + ' ' + srcToken + ' eq ' + port + ' any');
      } else {
        out.push(indent + 'permit ' + p + ' ' + srcToken + ' any');
      }
    } else {
      out.push(indent + 'permit ' + p + ' ' + srcToken + ' any');
    }
  }
  return out;
}

function coppCustomAcl(row) {
  const proto = row.proto || 'ip';
  if (proto === 'tcp' || proto === 'udp') return [{ proto, port: row.port }];
  return [{ proto }];
}

function coppAclName(cls) { return COPP_P + '-ACL-' + cls; }
function coppClassName(cls) { return COPP_P + '-' + cls; }
function coppPolName(cls) { return COPP_P + '-POL-' + cls; }
function coppCntName(cls) { return COPP_P + '-CNT-' + cls; }

// ponytail: duplicated 10 lines; hoist to shared.jsx when a third builder needs it.
function coppDownloadTxt(content, filename) {
  const blob = new Blob([content + '\n'], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function CoPPBuilder({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  const [activeTab, setActiveTab] = usePersistentState('copp:activeTab', initialData?.activeTab ?? 'config');
  const [platform, setPlatform] = usePersistentState('copp:platform', initialData?.platform ?? 'iosxe');
  const [policyName, setPolicyName] = usePersistentState('copp:policy', initialData?.policyName ?? 'COPP-POLICY');
  const [attach, setAttach] = usePersistentState('copp:attach', initialData?.attach ?? 'aggregate');
  const [rows, setRows] = usePersistentState('copp:rows', () => {
    const base = coppDefaultRows();
    const incoming = initialData?.rows;
    if (!incoming || typeof incoming !== 'object') return base;
    const out = {};
    for (const spec of COPP_FIXED) {
      const k = spec.key;
      out[k] = incoming[k] ? { ...base[k], ...incoming[k] } : base[k];
    }
    return out;
  });
  const [customRows, setCustomRows] = usePersistentState('copp:custom', initialData?.customRows ?? []);
  const [defKbps, setDefKbps] = usePersistentState('copp:def_kbps', initialData?.defKbps ?? '1000');
  const [defBytes, setDefBytes] = usePersistentState('copp:def_bytes', initialData?.defBytes ?? '125000');
  const [defPps, setDefPps] = usePersistentState('copp:def_pps', initialData?.defPps ?? '500');
  const [defPkts, setDefPkts] = usePersistentState('copp:def_pkts', initialData?.defPkts ?? '64');
  const [defAction, setDefAction] = usePersistentState('copp:def_action', initialData?.defAction ?? 'police');
  const [junosDefault, setJunosDefault] = usePersistentState('copp:junos_default', initialData?.junosDefault ?? 'police');

  const skipNavReport = useRef(false);
  useEffect(() => {
    if (initialData?.activeTab && initialData.activeTab !== activeTab) {
      skipNavReport.current = true;
      setActiveTab(initialData.activeTab);
    }
  }, [initialData]);
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ activeTab });
  }, [activeTab]);

  useEffect(() => {
    const h = (e) => (e.detail?.respond ?? onShare)({
      tool: 'copp-builder', activeTab, platform, policyName, attach, rows, customRows,
      defKbps, defBytes, defPps, defPkts, defAction, junosDefault,
    });
    window.addEventListener('app:request-share', h);
    return () => window.removeEventListener('app:request-share', h);
  }, [onShare, activeTab, platform, policyName, attach, rows, customRows,
      defKbps, defBytes, defPps, defPkts, defAction, junosDefault]);

  const updateRow = (k, f, v) => setRows(r => ({ ...r, [k]: { ...r[k], [f]: v } }));
  const updateCustom = (id, f, v) => setCustomRows(prev => prev.map(e => e.id === id ? { ...e, [f]: v } : e));

  const applyPreset = (id) => {
    const p = COPP_PRESETS[id];
    if (!p) return;
    setRows(r => {
      const next = { ...r };
      for (const key of Object.keys(p.rows)) {
        const [kbps, bytes, pps, pkts] = p.rows[key];
        next[key] = {
          ...(next[key] || {}),
          kbps: String(kbps), bytes: String(bytes), pps: String(pps), pkts: String(pkts),
          action: p.action,
        };
      }
      return next;
    });
    setDefKbps(String(p.def[0]));
    setDefBytes(String(p.def[1]));
    setDefPps(String(p.def[2]));
    setDefPkts(String(p.def[3]));
    setDefAction(p.action);
    setJunosDefault(p.junosDefault);
  };

  const addCustom = () => {
    setCustomRows(prev => {
      if (prev.length >= COPP_MAX_CUSTOM) return prev;
      const id = Math.max(0, ...prev.map(r => r.id || 0)) + 1;
      return [...prev, {
        id, name: 'CUSTOM' + id, proto: 'udp', port: '514', src: 'any',
        kbps: '256', bytes: '32000', pps: '100', pkts: '32', action: 'police',
      }];
    });
  };
  const removeCustom = (id) => setCustomRows(prev => prev.filter(r => r.id !== id));

  const bpsPlat = coppIsBps(platform);
  const nxosPlat = platform === 'nxos';
  const ciscoAttach = platform === 'ios' || platform === 'iosxe';

  const { error, blocked } = useMemo(() => {
    const name = String(policyName || '').trim();
    if (!name) return { error: '', blocked: true };
    if (!COPP_NAME_RE.test(name)) return { error: t('copp_builder.err_bad_name'), blocked: true };

    const checkSrc = (src, cls) => {
      if (String(src || '').trim() === '') return { incomplete: true };
      if (coppParsePrefix(src) === null) return { error: t('copp_builder.err_bad_prefix', { cls }) };
      return null;
    };

    for (const spec of COPP_FIXED) {
      const row = rows[spec.key] || {};
      if (!row.on || spec.special) continue;
      const e = checkSrc(row.src, spec.cls);
      if (e?.error) return { error: e.error, blocked: true };
      if (e?.incomplete) return { error: '', blocked: true };
    }
    for (const cr of customRows) {
      const cls = (cr.name || '').trim() || 'CUSTOM';
      const e = checkSrc(cr.src, cls);
      if (e?.error) return { error: e.error, blocked: true };
      if (e?.incomplete) return { error: '', blocked: true };
    }

    const used = new Set(COPP_RESERVED);
    for (const cr of customRows) {
      const nm = String(cr.name || '').trim();
      if (!nm) return { error: '', blocked: true };
      if (!COPP_NAME_RE.test(nm) || used.has(nm.toLowerCase())) {
        return { error: t('copp_builder.err_bad_custom_name', { name: cr.name || '' }), blocked: true };
      }
      used.add(nm.toLowerCase());
    }

    for (const cr of customRows) {
      const cls = String(cr.name || '').trim() || 'CUSTOM';
      if (cr.proto === 'tcp' || cr.proto === 'udp') {
        const port = String(cr.port ?? '').trim();
        if (port !== '') {
          const n = coppParseUint(port);
          if (!Number.isFinite(n) || n < 1 || n > 65535) {
            return { error: t('copp_builder.err_bad_port', { cls }), blocked: true };
          }
        }
      }
    }

    const checkBps = (kbps, bytes, cls) => {
      const k = coppParseUint(kbps);
      const b = coppParseUint(bytes);
      if (k === null || b === null) return { incomplete: true };
      if (!Number.isFinite(k) || k < 8 || k > 10000000 || !Number.isFinite(b) || b < 1000 || b > 128000000) {
        return { error: t('copp_builder.err_bad_rate', { cls }) };
      }
      if (platform === 'junos' && (k < 32 || b < 1500)) {
        return { error: t('copp_builder.err_junos_min', { cls }) };
      }
      return null;
    };
    const checkPps = (pps, pkts, cls) => {
      const p = coppParseUint(pps);
      const k = coppParseUint(pkts);
      if (p === null || k === null) return { incomplete: true };
      if (!Number.isFinite(p) || p < 1 || p > 100000 || !Number.isFinite(k) || k < 1 || k > 100000) {
        return { error: t('copp_builder.err_bad_pps', { cls }) };
      }
      return null;
    };
    const checkRowRates = (row, cls, isBlock) => {
      if (isBlock && !nxosPlat) return null;
      if (platform === 'junos' && row.action === 'monitor') return null; // no policer emitted
      if (bpsPlat) return checkBps(row.kbps, row.bytes, cls);
      return checkPps(row.pps, row.pkts, cls);
    };

    for (const spec of COPP_FIXED) {
      if (spec.key === 'isis') continue;
      const row = rows[spec.key] || {};
      if (!row.on) continue;
      const e = checkRowRates(row, spec.cls, false);
      if (e?.error) return { error: e.error, blocked: true };
      if (e?.incomplete) return { error: '', blocked: true };
    }
    for (const cr of customRows) {
      const cls = String(cr.name || '').trim() || 'CUSTOM';
      const e = checkRowRates(cr, cls, cr.action === 'block');
      if (e?.error) return { error: e.error, blocked: true };
      if (e?.incomplete) return { error: '', blocked: true };
    }
    if (!(platform === 'junos' && junosDefault === 'discard')) {
      const e = checkRowRates(
        { kbps: defKbps, bytes: defBytes, pps: defPps, pkts: defPkts },
        'class-default', false,
      );
      if (e?.error) return { error: e.error, blocked: true };
      if (e?.incomplete) return { error: '', blocked: true };
    }
    return { error: '', blocked: false };
  }, [policyName, rows, customRows, platform, bpsPlat, nxosPlat, defKbps, defBytes, defPps, defPkts, junosDefault, t]);

  const config = useMemo(() => {
    if (blocked || !String(policyName || '').trim()) return '';
    const L = [];
    const push = s => L.push(s);
    const cpre = platform === 'junos' ? '#' : '!';
    const platLabel = t('copp_builder.platform_' + platform);
    const cmt = s => cpre + ' ' + s;

    const enabledFixed = COPP_FIXED.filter(s => rows[s.key]?.on);
    const isisOn = enabledFixed.some(s => s.special === 'isis');
    const arpOn = enabledFixed.some(s => s.special === 'arp');
    const aclFixed = enabledFixed.filter(s => s.acl);

    const exceedTx = (action) => action === 'monitor';
    const bpsOf = (kbps) => Number(kbps) * 1000;

    const emitCisco = () => {
      push(cmt(t('copp_builder.cmt_header', { name: policyName, platform: platLabel })));
      if (platform === 'nxos') push(cmt(t('copp_builder.cmt_nxos_profile')));
      push(cpre);
      const srcFn = platform === 'nxos' ? coppNxosSrc : coppIosSrc;
      const aceIndent = platform === 'nxos' ? '  ' : ' ';
      const aclHdr = (cls) => platform === 'nxos'
        ? 'ip access-list ' + coppAclName(cls)
        : 'ip access-list extended ' + coppAclName(cls);

      for (const spec of aclFixed) {
        const src = srcFn(rows[spec.key].src);
        push(aclHdr(spec.cls));
        coppAclLines(spec.acl, src, aceIndent).forEach(push);
        push(cpre);
      }
      for (const cr of customRows) {
        const cls = String(cr.name).toUpperCase();
        const src = srcFn(cr.src);
        push(aclHdr(cls));
        coppAclLines(coppCustomAcl(cr), src, aceIndent).forEach(push);
        push(cpre);
      }

      if (platform === 'nxos') {
        const cmap = (name, body) => {
          push('class-map type control-plane match-any ' + name);
          push('  ' + body);
          push(cpre);
        };
        for (const spec of aclFixed) {
          cmap(coppClassName(spec.cls), 'match access-group name ' + coppAclName(spec.cls));
        }
        if (arpOn) cmap(coppClassName('ARP'), 'match protocol arp');
        for (const cr of customRows) {
          const cls = String(cr.name).toUpperCase();
          cmap(coppClassName(cls), 'match access-group name ' + coppAclName(cls));
        }
        if (isisOn) {
          push(cmt(t('copp_builder.cmt_isis_1')));
          push(cmt(t('copp_builder.cmt_isis_2')));
        }
        push('policy-map type control-plane ' + policyName);
        const policeLine = (pps, pkts, action) => {
          if (action === 'block') {
            return '    police cir ' + pps + ' pps bc ' + pkts + ' packets conform drop violate drop';
          }
          return '    police cir ' + pps + ' pps bc ' + pkts + ' packets conform transmit violate ' + (exceedTx(action) ? 'transmit' : 'drop');
        };
        for (const spec of enabledFixed) {
          if (spec.special === 'isis') continue;
          const row = rows[spec.key];
          push('  class ' + coppClassName(spec.cls));
          push(policeLine(row.pps, row.pkts, row.action));
        }
        for (const cr of customRows) {
          const cls = String(cr.name).toUpperCase();
          push('  class ' + coppClassName(cls));
          push(policeLine(cr.pps, cr.pkts, cr.action));
        }
        push('  class class-default');
        push(policeLine(defPps, defPkts, defAction));
        push(cpre);
        push('control-plane');
        push('  service-policy input ' + policyName);
        push(cpre);
        push(cmt(t('copp_builder.cmt_verify')));
        push(cpre + ' show copp status');
        push(cpre + ' show policy-map interface control-plane');
        return;
      }

      const cmap = (name, body) => {
        push('class-map match-any ' + name);
        push(' ' + body);
        push(cpre);
      };
      for (const spec of aclFixed) {
        cmap(coppClassName(spec.cls), 'match access-group name ' + coppAclName(spec.cls));
      }
      if (arpOn) cmap(coppClassName('ARP'), 'match protocol arp');
      for (const cr of customRows) {
        const cls = String(cr.name).toUpperCase();
        cmap(coppClassName(cls), 'match access-group name ' + coppAclName(cls));
      }
      if (isisOn) {
        push(cmt(t('copp_builder.cmt_isis_1')));
        push(cmt(t('copp_builder.cmt_isis_2')));
      }
      push('policy-map ' + policyName);
      const policeLine = (kbps, bytes, action) => {
        if (action === 'block') return '  drop';
        const bps = bpsOf(kbps);
        const exceed = exceedTx(action) ? 'transmit' : 'drop';
        if (platform === 'iosxe') {
          return '  police cir ' + bps + ' bc ' + bytes + ' conform-action transmit exceed-action ' + exceed;
        }
        return '  police ' + bps + ' ' + bytes + ' ' + bytes + ' conform-action transmit exceed-action ' + exceed;
      };
      for (const spec of enabledFixed) {
        if (spec.special === 'isis') continue;
        const row = rows[spec.key];
        push(' class ' + coppClassName(spec.cls));
        push(policeLine(row.kbps, row.bytes, row.action));
      }
      for (const cr of customRows) {
        const cls = String(cr.name).toUpperCase();
        push(' class ' + coppClassName(cls));
        push(policeLine(cr.kbps, cr.bytes, cr.action));
      }
      push(' class class-default');
      push(policeLine(defKbps, defBytes, defAction));
      push(cpre);
      const attachLine = attach === 'host' ? 'control-plane host'
        : attach === 'transit' ? 'control-plane transit'
        : 'control-plane';
      push(attachLine);
      push(' service-policy input ' + policyName);
      push(cpre);
      push(cmt(t('copp_builder.cmt_verify')));
      push(cpre + ' show policy-map control-plane');
      push(cpre + ' show access-lists');
    };

    const emitJunos = () => {
      push(cmt(t('copp_builder.cmt_header', { name: policyName, platform: platLabel })));
      push(cmt(t('copp_builder.cmt_junos_commit')));
      if (isisOn) {
        push(cmt(t('copp_builder.cmt_isis_1')));
        push(cmt(t('copp_builder.cmt_isis_2')));
      }
      if (arpOn) push(cmt(t('copp_builder.cmt_arp_junos')));

      const emitPolicer = (cls, kbps, bytes) => {
        const pname = coppPolName(cls);
        push('set firewall policer ' + pname + ' if-exceeding bandwidth-limit ' + coppJunosBw(bpsOf(kbps)));
        push('set firewall policer ' + pname + ' if-exceeding burst-size-limit ' + bytes);
        push('set firewall policer ' + pname + ' then discard');
      };
      const emitTerm = (term, fromLines, action, cls) => {
        const F = 'set firewall family inet filter ' + policyName + ' term ' + term;
        fromLines.forEach(line => push(F + ' ' + line));
        if (action === 'police') {
          push(F + ' then policer ' + coppPolName(cls));
          push(F + ' then count ' + coppCntName(cls));
          push(F + ' then accept');
        } else if (action === 'monitor') {
          // ponytail: monitor on Junos = count-only accept; loss-priority remarking not offered.
          push(F + ' then count ' + coppCntName(cls));
          push(F + ' then accept');
        } else {
          push(F + ' then count ' + coppCntName(cls));
          push(F + ' then discard');
        }
      };
      const fromFor = (acl, src, bidirHint) => {
        const lines = [];
        const pfx = coppParsePrefix(src);
        if (pfx && !pfx.any) lines.push('from source-address ' + pfx.ip + '/' + pfx.len);
        for (const e of acl) {
          if (e.proto !== 'ip') lines.push('from protocol ' + e.proto);
          if ((e.proto === 'tcp' || e.proto === 'udp')) {
            const port = e.port != null && String(e.port).trim() !== '' ? String(e.port).trim() : '';
            if (port) {
              lines.push((e.bidir || bidirHint) ? ('from port ' + port) : ('from destination-port ' + port));
            }
          }
        }
        return lines;
      };

      for (const spec of aclFixed) {
        const row = rows[spec.key];
        if (row.action === 'police') emitPolicer(spec.cls, row.kbps, row.bytes);
      }
      for (const cr of customRows) {
        if (cr.action === 'police') emitPolicer(String(cr.name).toUpperCase(), cr.kbps, cr.bytes);
      }
      const defPolice = junosDefault === 'police' && defAction !== 'monitor';
      if (defPolice) emitPolicer('DEFAULT', defKbps, defBytes);

      for (const spec of aclFixed) {
        const row = rows[spec.key];
        emitTerm(spec.cls, fromFor(spec.acl, row.src), row.action, spec.cls);
      }
      for (const cr of customRows) {
        const cls = String(cr.name).toUpperCase();
        emitTerm(cr.name, fromFor(coppCustomAcl(cr), cr.src), cr.action, cls);
      }
      {
        const F = 'set firewall family inet filter ' + policyName + ' term DEFAULT';
        push(F + ' then count ' + coppCntName('DEFAULT'));
        if (junosDefault === 'discard') {
          push(F + ' then discard');
        } else if (defAction === 'monitor') {
          push(F + ' then accept');
        } else {
          push(F + ' then policer ' + coppPolName('DEFAULT'));
          push(F + ' then accept');
        }
      }
      push('set interfaces lo0 unit 0 family inet filter input ' + policyName);
      push(cpre);
      push(cmt(t('copp_builder.cmt_verify')));
      push(cpre + ' show firewall filter ' + policyName);
      push(cpre + ' show policer');
    };

    if (platform === 'junos') emitJunos();
    else emitCisco();
    return L.join('\n');
  }, [blocked, policyName, platform, attach, rows, customRows, defKbps, defBytes, defPps, defPkts, defAction, junosDefault, t]);

  const hints = useMemo(() => {
    const list = [];
    const ssh = rows.ssh || {};
    const snmp = rows.snmp || {};
    const bgp = rows.bgp || {};
    const isis = rows.isis || {};
    const arp = rows.arp || {};

    if (!ssh.on) list.push({ level: 'red', key: 'hint_ssh_uncovered' });
    if (platform === 'junos' && junosDefault === 'discard') list.push({ level: 'red', key: 'hint_junos_discard' });

    if (platform === 'ios' || platform === 'iosxe') {
      const below = [];
      const consider = (row, cls, skip) => {
        if (skip) return;
        const b = coppParseUint(row.bytes);
        if (Number.isFinite(b) && b < 1500) below.push(cls);
      };
      for (const spec of COPP_FIXED) {
        if (spec.key === 'isis') continue;
        const row = rows[spec.key] || {};
        if (!row.on) continue;
        consider(row, spec.cls, false);
      }
      for (const cr of customRows) {
        if (cr.action === 'block') continue;
        consider(cr, cr.name, false);
      }
      consider({ bytes: defBytes }, 'class-default', false);
      if (below.length) list.push({ level: 'red', key: 'hint_burst_below_mtu' });
    }

    if (bpsPlat) {
      const shortOf = (row, cls, skip) => {
        if (skip) return;
        const ms = coppBurstMs(Number(row.kbps), Number(row.bytes));
        if (Number.isFinite(ms) && ms < 100) {
          list.push({ level: 'yellow', key: 'hint_burst_short', vars: { cls, ms: ms.toFixed(0) } });
        }
      };
      for (const spec of COPP_FIXED) {
        if (spec.key === 'isis') continue;
        const row = rows[spec.key] || {};
        if (!row.on) continue;
        shortOf(row, spec.cls, false);
      }
      for (const cr of customRows) {
        if (cr.action === 'block') continue;
        shortOf(cr, cr.name, false);
      }
      shortOf({ kbps: defKbps, bytes: defBytes }, 'class-default', false);
    }

    const anyMonitor = defAction === 'monitor'
      || COPP_FIXED.some(s => s.key !== 'isis' && rows[s.key]?.on && rows[s.key]?.action === 'monitor')
      || customRows.some(cr => cr.action === 'monitor');
    if (anyMonitor) list.push({ level: 'yellow', key: 'hint_monitor' });

    if (ssh.on && coppSrcIsAny(ssh.src)) list.push({ level: 'yellow', key: 'hint_src_any_mgmt', vars: { cls: 'SSH' } });
    if (snmp.on && coppSrcIsAny(snmp.src)) list.push({ level: 'yellow', key: 'hint_src_any_mgmt', vars: { cls: 'SNMP' } });
    if (bgp.on && coppSrcIsAny(bgp.src)) list.push({ level: 'yellow', key: 'hint_bgp_src_any' });
    if (isis.on) list.push({ level: 'yellow', key: 'hint_isis_non_ip' });
    if (arp.on && platform === 'junos') list.push({ level: 'yellow', key: 'hint_arp_junos' });
    if (ciscoAttach && attach === 'transit') list.push({ level: 'yellow', key: 'hint_transit' });
    if (nxosPlat && anyMonitor) list.push({ level: 'yellow', key: 'hint_nxos_violate_transmit' });

    if (list.length === 0 && config) list.push({ level: 'green', key: 'hint_ok' });
    return list;
  }, [rows, customRows, platform, junosDefault, defAction, defBytes, defKbps, attach, ciscoAttach, bpsPlat, nxosPlat, config]);

  const showRate = (row, isBlock) => !(isBlock && !nxosPlat);
  const burstMsStr = (row) => {
    const ms = coppBurstMs(Number(row.kbps), Number(row.bytes));
    return Number.isFinite(ms) ? ms.toFixed(0) : '—';
  };

  const th = (key) => (
    <th style={{ padding: '8px 10px', color: 'var(--muted)', textAlign: 'left', whiteSpace: 'nowrap' }}>
      {t('copp_builder.' + key)}
    </th>
  );
  const td = (children, extra) => (
    <td style={{ padding: '6px 8px', verticalAlign: 'middle', ...(extra || {}) }}>{children}</td>
  );
  const rateInputs = (row, onKbps, onBytes, onPps, onPkts, disabled) => {
    if (nxosPlat) {
      return (
        <>
          {td(<input className="input" value={row.pps || ''} disabled={disabled} onChange={e => onPps(e.target.value)} />)}
          {td(<input className="input" value={row.pkts || ''} disabled={disabled} onChange={e => onPkts(e.target.value)} />)}
        </>
      );
    }
    return (
      <>
        {td(<input className="input" value={row.kbps || ''} disabled={disabled} onChange={e => onKbps(e.target.value)} />)}
        {td(<input className="input" value={row.bytes || ''} disabled={disabled} onChange={e => onBytes(e.target.value)} />)}
        {td(<span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{disabled ? '—' : burstMsStr(row)}</span>)}
      </>
    );
  };
  const actionSelect = (value, onChange, custom) => (
    <select className="select" value={value} onChange={e => onChange(e.target.value)}>
      {(custom ? COPP_ACTIONS_CUSTOM : COPP_ACTIONS_FIXED).map(a => (
        <option key={a} value={a}>{t('copp_builder.action_' + a)}</option>
      ))}
    </select>
  );

  const staticNotes = [
    'note_ipv4_only',
    platform === 'iosxe' ? 'note_iosxe_scope' : null,
    platform === 'nxos' ? 'note_nxos_profile' : null,
    platform === 'junos' ? 'note_junos_commit' : null,
    'note_no_run',
  ].filter(Boolean);

  const related = [
    { id: 'qos-tool', key: 'related_qos' },
    { id: 'acl', key: 'related_acl' },
    { id: 'bogon-filter', key: 'related_bogon' },
    { id: 'prefix-list-builder', key: 'related_prefix' },
    { id: 'config-gen', key: 'related_configgen' },
    { id: 'routing-cfg', key: 'related_routing' },
    { id: 'snmp-builder', key: 'related_snmp' },
    { id: 'ntp-stratum', key: 'related_ntp' },
  ];

  const presetCell = (arr) => (
    arr[0] + ' ' + t('copp_builder.unit_kbps') + ' / ' + arr[1] + ' ' + t('copp_builder.unit_bytes')
    + ' · ' + arr[2] + ' ' + t('copp_builder.unit_pps') + ' / ' + arr[3] + ' ' + t('copp_builder.unit_pkts')
  );

  return (
    <div className="fadein">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">{t('copp_builder.title')}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          {t('copp_builder.subtitle')}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {COPP_TABS.map(tabId => (
            <button
              key={tabId}
              className={`btn btn-sm ${activeTab === tabId ? 'btn-primary' : 'btn-ghost'}`}
              style={{ fontSize: 12 }}
              onClick={() => setActiveTab(tabId)}
            >
              {t('copp_builder.tab_' + tabId)}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'config' && (
        <div>
          <div className="card">
            <div className="card-title">{t('copp_builder.section_platform')}</div>
            <div className="field">
              <label className="label">{t('copp_builder.platform')}</label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }}>
                {COPP_PLATFORMS.map(id => (
                  <button
                    key={id}
                    className={`btn btn-sm ${platform === id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setPlatform(id)}
                  >
                    {t('copp_builder.platform_' + id)}
                  </button>
                ))}
              </div>
            </div>
            <div className="two-col grid-mobile-1">
              <div className="field">
                <label className="label">{t('copp_builder.policy_name')}</label>
                <input className="input" value={policyName} onChange={e => setPolicyName(e.target.value)} />
                <div className="hint">{t('copp_builder.policy_name_hint')}</div>
              </div>
              {ciscoAttach && (
                <div className="field">
                  <label className="label">{t('copp_builder.attach')}</label>
                  <select className="select" value={attach} onChange={e => setAttach(e.target.value)}>
                    {COPP_ATTACH.map(a => (
                      <option key={a} value={a}>{t('copp_builder.attach_' + a)}</option>
                    ))}
                  </select>
                  <div className="hint">{t('copp_builder.attach_hint')}</div>
                </div>
              )}
              {platform === 'junos' && (
                <div className="field">
                  <label className="label">{t('copp_builder.junos_default')}</label>
                  <select className="select" value={junosDefault} onChange={e => setJunosDefault(e.target.value)}>
                    <option value="police">{t('copp_builder.junos_default_police')}</option>
                    <option value="discard">{t('copp_builder.junos_default_discard')}</option>
                  </select>
                  <div className="hint">{t('copp_builder.junos_default_hint')}</div>
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('copp_builder.section_presets')}</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 6 }}>
              {['lenient', 'moderate', 'strict'].map(id => (
                <button key={id} className="btn btn-sm" onClick={() => applyPreset(id)}>
                  {t('copp_builder.preset_' + id)}
                </button>
              ))}
            </div>
            <div className="hint">{t('copp_builder.presets_hint')}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('copp_builder.section_classes')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    {th('col_enable')}
                    {th('col_class')}
                    {th('col_source')}
                    {nxosPlat ? th('col_rate_pps') : th('col_rate_kbps')}
                    {nxosPlat ? th('col_burst_pkts') : th('col_burst_bytes')}
                    {!nxosPlat && th('col_burst_ms')}
                    {th('col_action')}
                  </tr>
                </thead>
                <tbody>
                  {COPP_FIXED.map(spec => {
                    const row = rows[spec.key] || { on: false };
                    if (spec.key === 'isis') {
                      return (
                        <tr key={spec.key} style={{ borderBottom: '1px solid var(--border)' }}>
                          {td(<input type="checkbox" checked={!!row.on} onChange={e => updateRow(spec.key, 'on', e.target.checked)} />)}
                          {td(
                            <span title={t('copp_builder.proto_isis_hint')}>{t('copp_builder.proto_isis')}</span>
                          )}
                          <td colSpan={nxosPlat ? 4 : 5} style={{ padding: '6px 8px', color: 'var(--muted)', fontSize: 12 }}>
                            {t('copp_builder.isis_row_note')}
                          </td>
                        </tr>
                      );
                    }
                    return (
                      <tr key={spec.key} style={{ borderBottom: '1px solid var(--border)' }}>
                        {td(<input type="checkbox" checked={!!row.on} onChange={e => updateRow(spec.key, 'on', e.target.checked)} />)}
                        {td(
                          <span title={t('copp_builder.proto_' + spec.key + '_hint')}>
                            {t('copp_builder.proto_' + spec.key)}
                          </span>
                        )}
                        {spec.key === 'arp'
                          ? td(null)
                          : td(
                            <input
                              className="input"
                              value={row.src || ''}
                              onChange={e => updateRow(spec.key, 'src', e.target.value)}
                              title={t('copp_builder.source_hint')}
                            />
                          )}
                        {rateInputs(
                          row,
                          v => updateRow(spec.key, 'kbps', v),
                          v => updateRow(spec.key, 'bytes', v),
                          v => updateRow(spec.key, 'pps', v),
                          v => updateRow(spec.key, 'pkts', v),
                          false,
                        )}
                        {td(actionSelect(row.action || 'police', v => updateRow(spec.key, 'action', v), false))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 6 }}>{t('copp_builder.source_hint')}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('copp_builder.section_custom')}</div>
            {customRows.length === 0 && (
              <div className="hint" style={{ marginBottom: 8 }}>{t('copp_builder.custom_empty')}</div>
            )}
            {customRows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {th('col_name')}
                      {th('col_protocol')}
                      {th('col_port')}
                      {th('col_source')}
                      {nxosPlat ? th('col_rate_pps') : th('col_rate_kbps')}
                      {nxosPlat ? th('col_burst_pkts') : th('col_burst_bytes')}
                      {!nxosPlat && th('col_burst_ms')}
                      {th('col_action')}
                      <th key="rm" style={{ padding: '8px 10px' }} />
                    </tr>
                  </thead>
                  <tbody>
                    {customRows.map(cr => {
                      const hideRate = !showRate(cr, cr.action === 'block');
                      const portOk = cr.proto === 'tcp' || cr.proto === 'udp';
                      return (
                        <tr key={cr.id} style={{ borderBottom: '1px solid var(--border)' }}>
                          {td(<input className="input" value={cr.name} onChange={e => updateCustom(cr.id, 'name', e.target.value)} />)}
                          {td(
                            <select className="select" value={cr.proto} onChange={e => updateCustom(cr.id, 'proto', e.target.value)}>
                              {COPP_CUSTOM_PROTOS.map(p => (
                                <option key={p} value={p}>{p === 'ip' ? t('copp_builder.proto_any_ip') : p}</option>
                              ))}
                            </select>
                          )}
                          {td(
                            <input
                              className="input"
                              value={portOk ? (cr.port || '') : ''}
                              disabled={!portOk}
                              title={t('copp_builder.port_hint')}
                              onChange={e => updateCustom(cr.id, 'port', e.target.value)}
                            />
                          )}
                          {td(
                            <input
                              className="input"
                              value={cr.src || ''}
                              title={t('copp_builder.source_hint')}
                              onChange={e => updateCustom(cr.id, 'src', e.target.value)}
                            />
                          )}
                          {rateInputs(
                            cr,
                            v => updateCustom(cr.id, 'kbps', v),
                            v => updateCustom(cr.id, 'bytes', v),
                            v => updateCustom(cr.id, 'pps', v),
                            v => updateCustom(cr.id, 'pkts', v),
                            hideRate,
                          )}
                          {td(actionSelect(cr.action || 'police', v => updateCustom(cr.id, 'action', v), true))}
                          {td(
                            <button className="btn btn-sm btn-danger" onClick={() => removeCustom(cr.id)}>
                              {t('copp_builder.btn_remove')}
                            </button>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 8 }}>
              <button
                className="btn btn-sm btn-primary"
                disabled={customRows.length >= COPP_MAX_CUSTOM}
                onClick={addCustom}
              >
                {t('copp_builder.btn_add_custom')}
              </button>
              {customRows.length >= COPP_MAX_CUSTOM && (
                <span className="hint">{t('copp_builder.custom_limit')}</span>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('copp_builder.section_default')}</div>
            <div className="two-col grid-mobile-1">
              {nxosPlat ? (
                <>
                  <div className="field">
                    <label className="label">{t('copp_builder.col_rate_pps')}</label>
                    <input className="input" value={defPps} onChange={e => setDefPps(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('copp_builder.col_burst_pkts')}</label>
                    <input className="input" value={defPkts} onChange={e => setDefPkts(e.target.value)} />
                  </div>
                </>
              ) : (
                <>
                  <div className="field">
                    <label className="label">{t('copp_builder.col_rate_kbps')}</label>
                    <input className="input" value={defKbps} onChange={e => setDefKbps(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('copp_builder.col_burst_bytes')}</label>
                    <input className="input" value={defBytes} onChange={e => setDefBytes(e.target.value)} />
                  </div>
                  <div className="field">
                    <label className="label">{t('copp_builder.col_burst_ms')}</label>
                    <div style={{ fontFamily: 'var(--mono)', fontSize: 13, paddingTop: 8 }}>
                      {burstMsStr({ kbps: defKbps, bytes: defBytes })} {t('copp_builder.unit_ms')}
                    </div>
                  </div>
                </>
              )}
              <div className="field">
                <label className="label">{t('copp_builder.col_action')}</label>
                {actionSelect(defAction, setDefAction, false)}
              </div>
            </div>
            <div className="hint">{t('copp_builder.default_hint')}</div>
          </div>

          <Err msg={error} />

          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
              <div className="card-title" style={{ margin: 0 }}>{t('copp_builder.section_output')}</div>
              <div style={{ display: 'flex', gap: 6 }}>
                <CopyBtn text={config} label="copy_all" id="copp-cfg-copy" />
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={!config}
                  onClick={() => coppDownloadTxt(config, 'copp-' + platform + '-' + policyName + '.txt')}
                >
                  {t('copp_builder.btn_download')}
                </button>
              </div>
            </div>
            {staticNotes.map(k => (
              <div key={k} className="hint" style={{ marginBottom: 4 }}>{t('copp_builder.' + k)}</div>
            ))}
            <pre style={{ margin: '8px 0 0', fontFamily: 'var(--mono)', fontSize: 12, background: 'var(--bg)', padding: 12, borderRadius: 'var(--radius)', whiteSpace: 'pre-wrap', border: '1px solid var(--border)' }}>
              {(config || '').split('\n').map((line, i) => (
                <span key={i} style={/^\s*[!#]/.test(line) ? { color: 'var(--dim)' } : undefined}>
                  {line}{'\n'}
                </span>
              ))}
            </pre>
          </div>

          {hints.length > 0 && (
            <div className="card" style={{ marginTop: 12 }}>
              <div className="card-title">{t('copp_builder.section_review')}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {hints.map((h, idx) => (
                  <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge badge-${h.level}`}>{t('copp_builder.level_' + h.level)}</span>
                    <span style={{ fontSize: 13, color: 'var(--text)' }}>
                      {t('copp_builder.' + h.key, h.vars)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'reference' && (
        <div>
          <div className="card">
            <div className="card-title">{t('copp_builder.ref_profiles_title')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.ref_col_platform')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.ref_col_builtin')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.ref_col_adopt')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.ref_col_note')}</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ['platform_ios', 'ref_prof_ios_builtin', 'ref_prof_ios_adopt', 'ref_prof_ios_note'],
                    ['platform_iosxe', 'ref_prof_iosxe_builtin', 'ref_prof_iosxe_adopt', 'ref_prof_iosxe_note'],
                    ['ref_prof_cat9k_platform', 'ref_prof_cat9k_builtin', 'ref_prof_cat9k_adopt', 'ref_prof_cat9k_note'],
                    ['platform_nxos', 'ref_prof_nxos_builtin', 'ref_prof_nxos_adopt', 'ref_prof_nxos_note'],
                    ['platform_junos', 'ref_prof_junos_builtin', 'ref_prof_junos_adopt', 'ref_prof_junos_note'],
                  ].map(([plat, builtin, adopt, note]) => (
                    <tr key={plat} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('copp_builder.' + plat)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('copp_builder.' + builtin)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('copp_builder.' + adopt)}</td>
                      <td style={{ padding: '8px 10px' }}>{t('copp_builder.' + note)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-title">{t('copp_builder.ref_presets_title')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.col_class')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.preset_lenient')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.preset_moderate')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.preset_strict')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(COPP_PRESETS.moderate.rows).map(key => (
                    <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('copp_builder.proto_' + key)}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>{presetCell(COPP_PRESETS.lenient.rows[key])}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>{presetCell(COPP_PRESETS.moderate.rows[key])}</td>
                      <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>{presetCell(COPP_PRESETS.strict.rows[key])}</td>
                    </tr>
                  ))}
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('copp_builder.section_default')}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>{presetCell(COPP_PRESETS.lenient.def)}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>{presetCell(COPP_PRESETS.moderate.def)}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)', fontSize: 12 }}>{presetCell(COPP_PRESETS.strict.def)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>{t('copp_builder.ref_presets_note')}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('copp_builder.ref_dialect_title')}</div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.ref_col_dialect')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.ref_col_platforms')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.ref_col_unit')}</th>
                    <th style={{ padding: '8px 10px', color: 'var(--muted)' }}>{t('copp_builder.ref_col_actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('copp_builder.ref_dialect_mqc')}</td>
                    <td style={{ padding: '8px 10px' }}>{t('copp_builder.platform_ios') + ', ' + t('copp_builder.platform_iosxe')}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)' }}>bps + bytes</td>
                    <td style={{ padding: '8px 10px' }}>{t('copp_builder.ref_dialect_mqc_actions')}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('copp_builder.ref_dialect_nxos')}</td>
                    <td style={{ padding: '8px 10px' }}>{t('copp_builder.platform_nxos')}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)' }}>pps + packets</td>
                    <td style={{ padding: '8px 10px' }}>{t('copp_builder.ref_dialect_nxos_actions')}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('copp_builder.ref_dialect_junos')}</td>
                    <td style={{ padding: '8px 10px' }}>{t('copp_builder.platform_junos')}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)' }}>bandwidth-limit / burst-size-limit</td>
                    <td style={{ padding: '8px 10px' }}>{t('copp_builder.ref_dialect_junos_actions')}</td>
                  </tr>
                  <tr style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '8px 10px', fontWeight: 600 }}>{t('copp_builder.ref_dialect_car')}</td>
                    <td style={{ padding: '8px 10px' }}>{t('copp_builder.ref_dialect_car_platforms')}</td>
                    <td style={{ padding: '8px 10px', fontFamily: 'var(--mono)' }}>bps + bytes</td>
                    <td style={{ padding: '8px 10px' }}>{t('copp_builder.ref_dialect_car_actions')}</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="hint" style={{ marginTop: 8 }}>{t('copp_builder.ref_dialect_note')}</div>
          </div>

          <div className="card">
            <div className="card-title">{t('copp_builder.ref_deploy_title')}</div>
            <ol style={{ margin: 0, paddingLeft: 22, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
              {[1, 2, 3, 4, 5, 6, 7].map(n => (
                <li key={n} style={{ marginBottom: 6 }}>{t('copp_builder.ref_deploy_' + n)}</li>
              ))}
            </ol>
          </div>

          <div className="card">
            <div className="card-title">{t('copp_builder.related_title')}</div>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.6, color: 'var(--text)' }}>
              {related.map(({ id, key }, idx) => (
                <li key={id} style={{ marginBottom: idx < related.length - 1 ? 6 : 0 }}>
                  <button
                    className="btn btn-sm btn-ghost"
                    style={{ padding: '0 6px', height: 'auto', fontSize: 12, marginRight: 6, display: 'inline-flex', verticalAlign: 'baseline' }}
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('app:navigate', { detail: { tool: id } }));
                    }}
                  >
                    {t('copp_builder.' + key)}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

window.CoPPBuilder = CoPPBuilder;
