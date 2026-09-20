const { useState, useEffect, useCallback, useRef, useMemo } = React;

function ShareModal({ data, onClose }) {
  const { t } = useTranslation();
  const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const url = `${location.origin}${location.pathname}#${b64}`;
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,.7)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:100}} onClick={onClose}>
      <div style={{background:'var(--card)',border:'1px solid var(--border)',borderRadius:10,padding:24,width:480,maxWidth:'90vw'}} onClick={e => e.stopPropagation()}>
        <div style={{fontWeight:600,marginBottom:12}}>{t('common.share_modal.title')}</div>
        <div style={{fontFamily:'var(--mono)',fontSize:12,background:'var(--panel)',border:'1px solid var(--border)',borderRadius:'var(--radius)',padding:'10px 12px',wordBreak:'break-all',color:'var(--cyan)',marginBottom:12}}>{url}</div>
        <div style={{display:'flex',gap:8}}>
          <CopyBtn text={url} label={t('common.share_modal.copy')} id="share" />
          <button className="btn btn-ghost" onClick={onClose}>{t('common.share_modal.close')}</button>
        </div>
      </div>
    </div>
  );
}

// ─── Global Search logic ──────────────────────────────────────
const getSearchResults = (q, t) => {
  if (!q || q.length < 2) return [];
  const query = q.toLowerCase();
  const tokens = query.split(/\s+/).filter(t => t.length > 0);
  const res = [];

  // Helper for multi-token matching
  const matches = (str, tags = []) => {
    if (!str) return false;
    const s = str.toLowerCase();
    return tokens.every(tok => s.includes(tok) || tags.some(tag => tag.toLowerCase().includes(tok)));
  };

  // 1. Smart Input Detection
  const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
  const cidrRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}\/([0-9]|[1-2][0-9]|3[0-2])$/;
  const ipv6Regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;
  const macRegex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$|^([0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}$|^[0-9A-Fa-f]{12}$/;

  if (ipv4Regex.test(query)) {
    res.push({ type:'Action', title: `Analyze IPv4: ${query}`, desc: t('common.cmd_palette.open_subnet'), id: 'subnet' });
    res.push({ type:'Action', title: `Geo/ASN Lookup: ${query}`, desc: t('common.cmd_palette.lookup_geo'), id: 'geo' });
  } else if (cidrRegex.test(query)) {
    res.push({ type:'Action', title: `Calculate Subnet: ${query}`, desc: t('common.cmd_palette.breakdown_cidr'), id: 'subnet' });
  } else if (ipv6Regex.test(query)) {
    res.push({ type:'Action', title: `Analyze IPv6: ${query}`, desc: t('common.cmd_palette.open_ipv6'), id: 'ipv6subnet' });
  } else if (macRegex.test(query)) {
    res.push({ type:'Action', title: `MAC Lookup: ${query}`, desc: t('common.cmd_palette.check_oui'), id: 'mac' });
  } else if (query.toLowerCase().includes('config') || query.toLowerCase().includes('template') || query.toLowerCase().includes('bulk') || query.toLowerCase().includes('interface')) {
    res.push({ type:'Action', title: `Interface Config Gen: ${query}`, desc: t('common.cmd_palette.bulk_provision'), id: 'config-gen' });
  }

  // 2. Tokenized Content Search
  const isOnlineQuery = /^onl?i/i.test(q.trim());
  const isServerQuery = /^serv?/i.test(q.trim());
  TOOLS.forEach(tool => {
    const localizedTitle = t(`tools.${tool.id}.title`, tool.label);
    const kwStr = tool.keywords || '';
    if (isOnlineQuery ? tool.online : isServerQuery ? tool.server : (matches(localizedTitle) || matches(tool.label) || matches(tool.group) || matches(kwStr))) {
      const desc = isOnlineQuery ? t('common.online_tool_desc') : isServerQuery ? t('common.server_tool_desc') : `${t('common.group')}: ${tool.group}`;
      res.push({ type:'Tool', title: localizedTitle, desc, id: tool.id });
    }
    // Sub-tools of consolidated toolkits (skip for online/server filters)
    if (!isOnlineQuery && !isServerQuery && tool.subTools) {
      tool.subTools.forEach(sub => {
        const subLabel = t(sub.labelKey, sub.labelKey);
        if (matches(subLabel) || matches(sub.keywords || '')) {
          res.push({ type:'Tool', title: subLabel, desc: localizedTitle, id: tool.id, nav: sub.nav });
        }
      });
    }
  });

  if (typeof KNOWLEDGE_BASE !== 'undefined') {
    KNOWLEDGE_BASE.forEach(k => {
      if (matches(k.title, k.tags)) {
        res.push({ type:'Topic', title: k.title, desc: `Reference: ${TOOLS.find(t=>t.id===k.id)?.label || k.id}`, id: k.id });
      }
    });
  }

  if (typeof AD_DATA !== 'undefined') {
    AD_DATA.forEach(a => {
      if (matches(a.name) || matches(String(a.ad)) || matches(a.desc)) {
        res.push({ type:'Protocol', title: `${a.name} (AD ${a.ad})`, desc: a.desc, id: 'proto-ref' });
      }
    });
  }

  if (typeof PORT_DATA !== 'undefined') {
    PORT_DATA.forEach(p => {
      if (matches(String(p.port)) || matches(p.service) || matches(p.desc) || matches(p.proto)) {
        res.push({ type:'Port', title: `${p.port}/${p.proto}`, desc: `${p.service}: ${p.desc}`, id: 'ports' });
      }
    });
  }

  PRIVATE_RANGES.forEach(r => {
    if (matches(r.range) || matches(r.rfc) || matches(r.use)) {
      res.push({ type:'Reference', title: r.range, desc: `${r.rfc}: ${r.use}`, id: 'cheatsheet' });
    }
  });

  SPECIAL_RANGES.forEach(r => {
    if (matches(r.range) || matches(r.rfc) || matches(r.use)) {
      res.push({ type:'Reference', title: r.range, desc: `${r.rfc}: ${r.use}`, id: 'cheatsheet' });
    }
  });

  IPV6_SPECIAL.forEach(r => {
    if (matches(r.addr) || matches(r.type) || matches(r.rfc) || matches(r.use)) {
      res.push({ type:'Reference', title: r.addr, desc: `${r.rfc}: ${r.type}`, id: 'cheatsheet' });
    }
  });

  // Deduplicate and limit
  const seen = new Set();
  return res.filter(r => {
    const key = `${r.type}:${r.title}:${r.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 15);
};

window.ShareModal = ShareModal;
