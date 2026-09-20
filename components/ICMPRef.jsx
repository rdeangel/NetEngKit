const { useState, useEffect, useCallback, useMemo } = React;

function ICMPRef({ initialData, onShare, onNav }) {
  const { t } = useTranslation();

  // State management
  const [version, setVersion] = usePersistentState('icmp:version', initialData?.version ?? 'v4');
  const [search, setSearch] = usePersistentState('icmp:search', initialData?.search ?? '');
  const [selectedKey, setSelectedKey] = usePersistentState('icmp:selectedKey', initialData?.selectedKey ?? null);

  // Wire into share URL system
  useEffect(() => {
    const handleShareRequest = (e) => {
      (e.detail?.respond ?? onShare)({
        tool: 'icmp-ref',
        version,
        search,
        selectedKey
      });
    };
    window.addEventListener('app:request-share', handleShareRequest);
    return () => window.removeEventListener('app:request-share', handleShareRequest);
  }, [version, search, selectedKey, onShare]);

  // Report-up: version change → sidebar highlight follows
  useEffect(() => { onNav?.({ version }); }, [version]);

  // Restore state from URL on load
  useEffect(() => {
    if (initialData) {
      if (initialData.version !== undefined) setVersion(initialData.version);
      if (initialData.search !== undefined) setSearch(initialData.search);
      if (initialData.selectedKey !== undefined) setSelectedKey(initialData.selectedKey);
    }
  }, [initialData]);

  // Comprehensive ICMPv4 Data
  const icmpv4Data = useMemo(() => [
    { type: 0, code: 0, key: "v4_0_0", category: "cat_info", rfc: "RFC 792" },
    { type: 3, code: 0, key: "v4_3_0", category: "cat_error", rfc: "RFC 792" },
    { type: 3, code: 1, key: "v4_3_1", category: "cat_error", rfc: "RFC 792" },
    { type: 3, code: 2, key: "v4_3_2", category: "cat_error", rfc: "RFC 792" },
    { type: 3, code: 3, key: "v4_3_3", category: "cat_error", rfc: "RFC 792" },
    { type: 3, code: 4, key: "v4_3_4", category: "cat_error", rfc: "RFC 792" },
    { type: 3, code: 5, key: "v4_3_5", category: "cat_error", rfc: "RFC 792" },
    { type: 3, code: 9, key: "v4_3_9", category: "cat_error", rfc: "RFC 1812" },
    { type: 3, code: 10, key: "v4_3_10", category: "cat_error", rfc: "RFC 1812" },
    { type: 3, code: 13, key: "v4_3_13", category: "cat_error", rfc: "RFC 1812" },
    { type: 4, code: 0, key: "v4_4_0", category: "cat_error", rfc: "RFC 792" },
    { type: 5, code: 0, key: "v4_5_0", category: "cat_info", rfc: "RFC 792" },
    { type: 5, code: 1, key: "v4_5_1", category: "cat_info", rfc: "RFC 792" },
    { type: 8, code: 0, key: "v4_8_0", category: "cat_info", rfc: "RFC 792" },
    { type: 9, code: 0, key: "v4_9_0", category: "cat_info", rfc: "RFC 1256" },
    { type: 10, code: 0, key: "v4_10_0", category: "cat_info", rfc: "RFC 1256" },
    { type: 11, code: 0, key: "v4_11_0", category: "cat_error", rfc: "RFC 792" },
    { type: 11, code: 1, key: "v4_11_1", category: "cat_error", rfc: "RFC 792" },
    { type: 12, code: 0, key: "v4_12_0", category: "cat_error", rfc: "RFC 792" }
  ], []);

  // Comprehensive ICMPv6 Data
  const icmpv6Data = useMemo(() => [
    { type: 1, code: 0, key: "v6_1_0", category: "cat_error", rfc: "RFC 4443" },
    { type: 1, code: 1, key: "v6_1_1", category: "cat_error", rfc: "RFC 4443" },
    { type: 1, code: 2, key: "v6_1_2", category: "cat_error", rfc: "RFC 4443" },
    { type: 1, code: 3, key: "v6_1_3", category: "cat_error", rfc: "RFC 4443" },
    { type: 1, code: 4, key: "v6_1_4", category: "cat_error", rfc: "RFC 4443" },
    { type: 1, code: 5, key: "v6_1_5", category: "cat_error", rfc: "RFC 4443" },
    { type: 2, code: 0, key: "v6_2_0", category: "cat_error", rfc: "RFC 4443" },
    { type: 3, code: 0, key: "v6_3_0", category: "cat_error", rfc: "RFC 4443" },
    { type: 3, code: 1, key: "v6_3_1", category: "cat_error", rfc: "RFC 4443" },
    { type: 4, code: 0, key: "v6_4_0", category: "cat_error", rfc: "RFC 4443" },
    { type: 128, code: 0, key: "v6_128_0", category: "cat_info", rfc: "RFC 4443" },
    { type: 129, code: 0, key: "v6_129_0", category: "cat_info", rfc: "RFC 4443" },
    { type: 130, code: 0, key: "v6_130_0", category: "cat_mld", rfc: "RFC 2710" },
    { type: 133, code: 0, key: "v6_133_0", category: "cat_ndp", rfc: "RFC 4861" },
    { type: 134, code: 0, key: "v6_134_0", category: "cat_ndp", rfc: "RFC 4861" },
    { type: 135, code: 0, key: "v6_135_0", category: "cat_ndp", rfc: "RFC 4861" },
    { type: 136, code: 0, key: "v6_136_0", category: "cat_ndp", rfc: "RFC 4861" },
    { type: 137, code: 0, key: "v6_137_0", category: "cat_ndp", rfc: "RFC 4861" }
  ], []);

  const activeData = useMemo(() => {
    return version === 'v4' ? icmpv4Data : icmpv6Data;
  }, [version, icmpv4Data, icmpv6Data]);

  // Filtering
  const filteredData = useMemo(() => {
    if (!search.trim()) return activeData;
    const term = search.toLowerCase();
    return activeData.filter(item => {
      const typeStr = String(item.type);
      const codeStr = String(item.code);
      const name = t(`icmp_ref.msgs.${item.key}.name`).toLowerCase();
      const desc = t(`icmp_ref.msgs.${item.key}.desc`).toLowerCase();
      const causes = t(`icmp_ref.msgs.${item.key}.causes`).toLowerCase();
      const trouble = t(`icmp_ref.msgs.${item.key}.trouble`).toLowerCase();
      return (
        typeStr.includes(term) ||
        codeStr.includes(term) ||
        name.includes(term) ||
        desc.includes(term) ||
        causes.includes(term) ||
        trouble.includes(term) ||
        `${typeStr}:${codeStr}`.includes(term) ||
        `${typeStr}/${codeStr}`.includes(term)
      );
    });
  }, [activeData, search, t]);

  // Selected item detail
  const selectedItem = useMemo(() => {
    if (!selectedKey) return null;
    const [tKey, cKey] = selectedKey.split(':').map(Number);
    return activeData.find(item => item.type === tKey && item.code === cKey);
  }, [selectedKey, activeData]);

  const handleRowClick = (item) => {
    setSelectedKey(`${item.type}:${item.code}`);
  };

  const getCategoryClass = (cat) => {
    switch (cat) {
      case 'cat_error': return 'badge-red';
      case 'cat_info': return 'badge-cyan';
      case 'cat_ndp': return 'badge-purple';
      case 'cat_mld': return 'badge-blue';
      default: return 'badge-gray';
    }
  };

  return (
    <div className="fadein">
      {/* Introduction Card */}
      <div className="card">
        <div className="card-title">{t('icmp_ref.title')}</div>
        <p style={{ color: 'var(--muted)', fontSize: 13, lineHeight: '1.5', margin: '0 0 16px 0' }}>
          {t('icmp_ref.subtitle')}
        </p>

        {/* Version Switcher & Search */}
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="field" style={{ margin: 0, minWidth: 200 }}>
            <label className="label">{t('icmp_ref.version')}</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className={`btn ${version === 'v4' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => { setVersion('v4'); setSelectedKey(null); }}
                style={{ flex: 1 }}
              >
                {t('icmp_ref.ipv4')}
              </button>
              <button
                className={`btn ${version === 'v6' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => { setVersion('v6'); setSelectedKey(null); }}
                style={{ flex: 1 }}
              >
                {t('icmp_ref.ipv6')}
              </button>
            </div>
          </div>

          <div className="field" style={{ margin: 0, flex: 1, minWidth: 250 }}>
            <label className="label">{t('common.search')}</label>
            <input
              className="input"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('icmp_ref.search_placeholder')}
            />
          </div>
        </div>
      </div>

      <div className="two-col">
        {/* Left Side: Table list */}
        <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
            <span style={{ fontWeight: 600, fontSize: 14 }}>{t('icmp_ref.header_all')}</span>
            <span className="badge badge-gray" style={{ marginLeft: 8 }}>{filteredData.length}</span>
          </div>

          <div style={{ overflowX: 'auto', maxHeight: '550px', overflowY: 'auto' }}>
            <table className="table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ background: 'var(--panel)', borderBottom: '1px solid var(--border)', textAlign: 'left' }}>
                  <th style={{ padding: '10px 14px', width: '90px' }}>{t('icmp_ref.col_type_code')}</th>
                  <th style={{ padding: '10px 14px' }}>{t('icmp_ref.col_name')}</th>
                  <th style={{ padding: '10px 14px', width: '80px' }}>{t('icmp_ref.col_rfc')}</th>
                </tr>
              </thead>
              <tbody>
                {filteredData.length === 0 ? (
                  <tr>
                    <td colSpan={3} style={{ padding: '24px', textAlign: 'center', color: 'var(--muted)' }}>
                      {t('icmp_ref.no_results')}
                    </td>
                  </tr>
                ) : (
                  filteredData.map((item) => {
                    const rowKey = `${item.type}:${item.code}`;
                    const isSelected = selectedKey === rowKey;
                    return (
                      <tr
                        key={rowKey}
                        onClick={() => handleRowClick(item)}
                        style={{
                          borderBottom: '1px solid var(--border)',
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(0, 212, 200, 0.08)' : 'transparent',
                          transition: 'background 0.15s ease'
                        }}
                        className="table-row-hover"
                      >
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--mono)', fontWeight: 600 }}>
                          {item.type}:{item.code}
                        </td>
                        <td style={{ padding: '10px 14px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                            <span style={{ fontWeight: isSelected ? 600 : 400 }}>{t(`icmp_ref.msgs.${item.key}.name`)}</span>
                            <span className={`badge ${getCategoryClass(item.category)}`} style={{ fontSize: 9 }}>
                              {t(`icmp_ref.${item.category}`)}
                            </span>
                          </div>
                        </td>
                        <td style={{ padding: '10px 14px', fontFamily: 'var(--mono)', fontSize: 12 }}>
                          {item.rfc}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right Side: Details View */}
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {selectedItem ? (
            <div className="fadein">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                <div>
                  <h3 style={{ margin: '0 0 4px 0', fontSize: 18, color: 'var(--text)' }}>{t(`icmp_ref.msgs.${selectedItem.key}.name`)}</h3>
                  <div style={{ fontFamily: 'var(--mono)', color: 'var(--cyan)', fontSize: 13 }}>
                    {t('icmp_ref.type_code_fmt', { type: selectedItem.type, code: selectedItem.code })}
                  </div>
                </div>
                <span className={`badge ${getCategoryClass(selectedItem.category)}`}>
                  {t(`icmp_ref.${selectedItem.category}`)}
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>
                    {t('icmp_ref.lbl_description')}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: '1.5' }}>
                    {t(`icmp_ref.msgs.${selectedItem.key}.desc`)}
                  </div>
                </div>

                <div>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>
                    {t('icmp_ref.lbl_rfc')}
                  </div>
                  <div style={{ fontSize: 13, fontFamily: 'var(--mono)' }}>
                    <RFCLink rfc={selectedItem.rfc} />
                  </div>
                </div>

                <div style={{ borderLeft: '3px solid var(--border)', paddingLeft: 12 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--muted)', fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>
                    {t('icmp_ref.lbl_causes')}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: '1.5' }}>
                    {t(`icmp_ref.msgs.${selectedItem.key}.causes`)}
                  </div>
                </div>

                <div style={{ borderLeft: '3px solid var(--primary)', paddingLeft: 12 }}>
                  <div style={{ fontSize: 11, textTransform: 'uppercase', color: 'var(--primary)', fontWeight: 600, letterSpacing: 1, marginBottom: 4 }}>
                    {t('icmp_ref.lbl_troubleshooting')}
                  </div>
                  <div style={{ fontSize: 13, color: 'var(--text)', lineHeight: '1.5' }}>
                    {t(`icmp_ref.msgs.${selectedItem.key}.trouble`)}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', minHeight: '300px', color: 'var(--muted)', textAlign: 'center', gap: 12 }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 111.063.852l-.708 2.836a.75.75 0 001.063.852l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
              </svg>
              <div>{t('icmp_ref.select_prompt')}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

window.ICMPRef = ICMPRef;
