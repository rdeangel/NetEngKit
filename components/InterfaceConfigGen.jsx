const { useState, useEffect, useCallback, useRef, useMemo } = React;

function InterfaceConfigGen({ onShare, initialData }) {
  const { t } = useTranslation();
  const ip2int = ip => ip.split('.').reduce((a,b) => (a*256)+parseInt(b,10), 0) >>> 0;
  const int2ip = n  => [(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255].join('.');
  const mkMask = p  => p===0 ? 0 : ((0xffffffff << (32-p)) >>> 0);

  const [prefix, setPrefix] = usePersistentState('config-gen:prefix', initialData?.prefix ?? "GigabitEthernet1/0/");
  const [start, setStart] = usePersistentState('config-gen:start', initialData?.start ?? "1");
  const [end, setEnd] = usePersistentState('config-gen:end', initialData?.end ?? "4");
  const [baseIP, setBaseIP] = usePersistentState('config-gen:baseIP', initialData?.baseIP ?? "10.10.10.0");
  const [subnetCIDR, setSubnetCIDR] = usePersistentState('config-gen:subnetCIDR', initialData?.subnetCIDR ?? "30");
  const [template, setTemplate] = usePersistentState(
    'config-gen:template',
    initialData?.template ?? `interface {{int}}
  description Peering-Link-{{i}}
  no switchport
  ip address {{ip}} {{mask}}
  no shutdown`
  );

  useEffect(() => {
    if (initialData) {
      if (initialData.prefix !== undefined) setPrefix(initialData.prefix);
      if (initialData.start !== undefined) setStart(initialData.start);
      if (initialData.end !== undefined) setEnd(initialData.end);
      if (initialData.baseIP !== undefined) setBaseIP(initialData.baseIP);
      if (initialData.subnetCIDR !== undefined) setSubnetCIDR(initialData.subnetCIDR);
      if (initialData.template !== undefined) setTemplate(initialData.template);
    }
  }, [initialData]);

  useEffect(() => {
    const handleGlobalShare = (e) => {
      if (baseIP || prefix) {
        (e.detail?.respond ?? onShare)({ tool: 'config-gen', prefix, start, end, baseIP, subnetCIDR, template });
      }
    };
    window.addEventListener('app:request-share', handleGlobalShare);
    return () => window.removeEventListener('app:request-share', handleGlobalShare);
  }, [prefix, start, end, baseIP, subnetCIDR, template, onShare]);

  const generateOutput = () => {
    let out = [];
    let currentIPNum = 0;

    // Parse the base IP to get its numeric value if provided
    if (baseIP) {
      const parsed = IPv4.parseCIDR(baseIP + "/" + (subnetCIDR || "32"));
      if (parsed) {
        currentIPNum = parsed.ip;
      }
    }

    let cidr = parseInt(subnetCIDR, 10);
    if (isNaN(cidr) || cidr < 0 || cidr > 32) cidr = 32;

    const numIPsPerSubnet = Math.pow(2, 32 - cidr);
    const mask = int2ip(mkMask(cidr));

    const s = parseInt(start, 10) || 1;
    const e = parseInt(end, 10) || 4;
    for (let i = s; i <= e; i++) {
      let blockStr = template;

      blockStr = blockStr.replace(/\{\{int\}\}/g, prefix + i);
      blockStr = blockStr.replace(/\{\{i\}\}/g, i);

      if (baseIP) {
        const netInt = currentIPNum;
        const netStr = int2ip(netInt);
        const bcastInt = netInt + numIPsPerSubnet - 1;
        const bcastStr = int2ip(bcastInt);

        let usableIPStr = "";
        if (cidr === 32 || cidr === 31) {
          usableIPStr = netStr; // For /31 and /32, network address is usable
        } else {
          usableIPStr = int2ip(netInt + 1); // For others, network + 1 is the first usable
        }

        blockStr = blockStr.replace(/\{\{ip\}\}/g, usableIPStr);
        blockStr = blockStr.replace(/\{\{mask\}\}/g, mask);
        blockStr = blockStr.replace(/\{\{cidr\}\}/g, cidr);
        blockStr = blockStr.replace(/\{\{net\}\}/g, netStr);
        blockStr = blockStr.replace(/\{\{bcast\}\}/g, bcastStr);

        currentIPNum += numIPsPerSubnet;
      } else {
        blockStr = blockStr.replace(/\{\{ip\}\}/g, "");
        blockStr = blockStr.replace(/\{\{mask\}\}/g, "");
        blockStr = blockStr.replace(/\{\{cidr\}\}/g, "");
        blockStr = blockStr.replace(/\{\{net\}\}/g, "");
        blockStr = blockStr.replace(/\{\{bcast\}\}/g, "");
      }

      out.push(blockStr);
    }
    return out.join("\n\n");
  };

  const output = generateOutput();

  return (
    <div className="card">
      <div className="card-title">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div className="icon-badge">📝</div>
          {t('switching.config_gen_title')}
        </div>
      </div>
      <div className="card-body">
        <div
          style={{
            marginBottom: 16,
            fontSize: 13,
            color: "var(--muted)",
            lineHeight: 1.5,
          }}
        >
          {t('switching.config_gen_desc')}
          <div style={{ marginTop: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--dim)' }}>
            {t('switching.regex_tip', 'Need more complex bulk transforms from a spreadsheet?')}{' '}
            <button
              onClick={() => {
                window.location.hash = btoa(unescape(encodeURIComponent(JSON.stringify({ tool: 'regex' }))));
              }}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                color: 'var(--cyan)', fontSize: 11, fontFamily: 'inherit',
                textDecoration: 'underline',
              }}
            >
              {t('switching.regex_link', 'Try Regex Find & Replace')}
            </button>
          </span>
          </div>
        </div>

        <div className="two-col grid-mobile-1">
          {/* LEFT: Inputs */}
          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div
              className="grid-mobile-1"
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr",
                gap: 12,
              }}
            >
              <div className="input-group">
                <label>{t('switching.prefix')}</label>
                <input
                  className="input"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="Eth1/"
                />
              </div>
              <div className="input-group">
                <label>{t('switching.start')}</label>
                <input
                  className="input"
                  type="number"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </div>
              <div className="input-group">
                <label>{t('switching.end')}</label>
                <input
                  className="input"
                  type="number"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </div>
            </div>

            <div
              className="grid-mobile-1"
              style={{
                display: "grid",
                gridTemplateColumns: "2fr 1fr 1fr",
                gap: 12,
              }}
            >
              <div className="input-group">
                <label>{t('switching.base_ip_opt')}</label>
                <input
                  className="input"
                  value={baseIP}
                  onChange={(e) => setBaseIP(e.target.value)}
                  placeholder="10.0.0.0"
                />
              </div>
              <div className="input-group">
                <label>{t('switching.cidr_size')}</label>
                <input
                  className="input"
                  type="number"
                  value={subnetCIDR}
                  onChange={(e) => setSubnetCIDR(e.target.value)}
                  placeholder="30"
                />
              </div>
            </div>

            <div
              className="input-group"
              style={{ flex: 1, display: "flex", flexDirection: "column" }}
            >
              <label>{t('switching.config_template')}</label>
              <textarea
                className="input"
                style={{
                  flex: 1,
                  minHeight: 200,
                  fontFamily: "var(--mono)",
                  resize: "vertical",
                  whiteSpace: "pre",
                }}
                value={template}
                onChange={(e) => setTemplate(e.target.value)}
                spellCheck={false}
              />
            </div>

            <div
              style={{
                background: "var(--panel)",
                padding: 12,
                borderRadius: "var(--radius)",
                border: "1px solid var(--border)",
                fontSize: 12,
                fontFamily: "var(--mono)",
              }}
            >
              <div
                style={{
                  color: "var(--muted)",
                  marginBottom: 8,
                  fontSize: 11,
                  textTransform: "uppercase",
                  letterSpacing: 1,
                }}
              >
                {t('switching.avail_vars')}
              </div>
              <div
                className="grid-mobile-1"
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 8,
                }}
              >
                <div>
                  <span style={{ color: "var(--cyan)" }}>{"{{int}}"}</span> -
                  {t('switching.var_int')}
                </div>
                <div>
                  <span style={{ color: "var(--cyan)" }}>{"{{i}}"}</span> - {t('switching.var_i')}
                </div>
                <div>
                  <span style={{ color: "var(--green)" }}>{"{{ip}}"}</span> -
                  {t('switching.var_ip')}
                </div>
                <div>
                  <span style={{ color: "var(--green)" }}>{"{{mask}}"}</span> -
                  {t('switching.var_mask')}
                </div>
                <div>
                  <span style={{ color: "var(--dim)" }}>{"{{cidr}}"}</span> -
                  {t('switching.var_cidr')} (/{subnetCIDR})
                </div>
                <div>
                  <span style={{ color: "var(--dim)" }}>{"{{net}}"}</span> -
                  {t('switching.var_net')}
                </div>
                <div>
                  <span style={{ color: "var(--dim)" }}>{"{{bcast}}"}</span> -
                  {t('switching.var_bcast')}
                </div>
              </div>
            </div>
          </div>

          {/* RIGHT: Output */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              position: "relative",
            }}
          >
            <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
              <CopyBtn text={output} id="config" />
            </div>
            <textarea
              className="input"
              readOnly
              value={output}
              style={{
                flex: 1,
                height: "100%",
                minHeight: 400,
                fontFamily: "var(--mono)",
                backgroundColor: "var(--panel)",
                color: "var(--text)",
                border: "1px solid var(--border)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
                resize: "none",
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Tool: ACL / Firewall Rule Generator ────────────────────


window.InterfaceConfigGen = InterfaceConfigGen;
