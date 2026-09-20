const { useEffect } = React;

const WrenchIcon = ({ size = 10 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
  </svg>
);

const BookIcon = ({ size = 10 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
    <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
  </svg>
);

const ServerIcon = ({ size = 10 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
    <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
    <line x1="6" y1="6" x2="6.01" y2="6" />
    <line x1="6" y1="18" x2="6.01" y2="18" />
  </svg>
);

const GlobeIcon = ({ size = 10 }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'block' }}>
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

function HelpModal({ open, onClose, tools, onNavigate }) {
  const { t } = useTranslation();

  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const groups = [...new Set(tools.map(tool => tool.group))];

  const groupLabel = (g) => t(`help_modal.groups.${g}`, g);

  const scrollTo = (id) => {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const overlayStyle = {
    position: 'fixed', inset: 0, zIndex: 2000,
    background: 'rgba(0,0,0,0.7)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  };

  const boxStyle = {
    background: 'var(--bg)', border: '1px solid var(--border)',
    borderRadius: 12, width: 'min(960px, 95vw)', height: 'min(90vh, 900px)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 64px rgba(0,0,0,0.5)',
  };

  const headerStyle = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '14px 20px', borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  };

  const jumpNavStyle = {
    display: 'flex', gap: 6, flexWrap: 'wrap',
    padding: '8px 20px', borderBottom: '1px solid var(--border)',
    flexShrink: 0, background: 'var(--bg-2)',
  };

  const jumpLinkStyle = {
    color: 'var(--cyan)', textDecoration: 'none', cursor: 'pointer',
    padding: '2px 10px', borderRadius: 4, fontSize: 12, fontWeight: 600,
    background: 'var(--bg-3)',
  };

  const scrollBodyStyle = {
    flex: 1, overflowY: 'auto', padding: '20px',
    display: 'flex', flexDirection: 'column', gap: 32,
  };

  const sectionHeadingStyle = {
    fontSize: 13, fontWeight: 700, color: 'var(--cyan)',
    marginBottom: 12, display: 'flex', alignItems: 'center', gap: 6,
  };

  const categoryHeadingStyle = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
    opacity: 0.5, marginBottom: 6, textTransform: 'uppercase',
  };

  const toolGridStyle = {
    display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 4,
  };

  const toolItemStyle = {
    background: 'var(--bg-2)', padding: '5px 10px', borderRadius: 4,
    display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer',
    fontSize: 12, border: '1px solid transparent',
  };

  const iconBadgeStyle = (bgColor, textColor) => ({
    width: 18,
    height: 18,
    borderRadius: 4,
    background: bgColor,
    color: textColor,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  });

  const shortcutRowStyle = {
    background: 'var(--bg-2)', padding: '7px 12px', borderRadius: 5,
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    gap: 8, fontSize: 12,
  };

  const keyStyle = {
    fontFamily: 'monospace', fontWeight: 600, color: 'var(--cyan)',
    flexShrink: 0,
  };

  const shortcuts = [
    { key: 'Ctrl+K',          desc: t('help_modal.shortcut_search') },
    { key: 'Ctrl+L',          desc: t('help_modal.shortcut_language') },
    { key: 'Ctrl+Shift+→',    desc: t('help_modal.shortcut_next_tool') },
    { key: 'Ctrl+Shift+←',    desc: t('help_modal.shortcut_prev_tool') },
    { key: '/',               desc: t('help_modal.shortcut_focus_search') },
    { key: 'Ctrl+Alt+H',      desc: t('help_modal.shortcut_help') },
  ];

  const tips = [
    t('help_modal.tips.offline'),
    t('help_modal.tips.online'),
    t('help_modal.tips.server'),
    t('help_modal.tips.share'),
    t('help_modal.tips.search'),
  ];

  return (
    <div style={overlayStyle} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={boxStyle}>

        {/* Header */}
        <div style={headerStyle}>
          <span style={{ fontWeight: 700, fontSize: 15 }}>{t('help_modal.title')}</span>
          <button
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text)', opacity: 0.6, fontSize: 18, lineHeight: 1, padding: '2px 6px' }}
            aria-label={t('common.close')}
          >×</button>
        </div>

        {/* Jump nav */}
        <div style={jumpNavStyle}>
          <span style={{ opacity: 0.4, fontSize: 10, alignSelf: 'center', marginRight: 4 }}>{t('help_modal.jump_label')}</span>
          {[
            ['help-shortcuts', '⌨', t('help_modal.jump_shortcuts')],
            ['help-tools',     '🗂', t('help_modal.jump_tools')],
            ['help-tips',      '💡', t('help_modal.jump_tips')],
            ['help-about',     'ℹ',  t('help_modal.jump_about')],
          ].map(([id, icon, label]) => (
            <span key={id} style={jumpLinkStyle} onClick={() => scrollTo(id)}>
              {icon} {label}
            </span>
          ))}
        </div>

        {/* Scroll body */}
        <div style={scrollBodyStyle}>

          {/* Shortcuts */}
          <section id="help-shortcuts">
            <div style={sectionHeadingStyle}>⌨ {t('help_modal.shortcuts_heading')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {shortcuts.map(({ key, desc }) => (
                <div key={key} style={shortcutRowStyle}>
                  <span style={keyStyle}>{key}</span>
                  <span style={{ opacity: 0.7 }}>{desc}</span>
                </div>
              ))}
            </div>
          </section>

          {/* Tools directory */}
          <section id="help-tools">
            <div style={sectionHeadingStyle}>🗂 {t('help_modal.tools_heading')}</div>
            {groups.map(group => (
              <div key={group} style={{ marginBottom: 16 }}>
                <div style={categoryHeadingStyle}>{groupLabel(group)}</div>
                <div style={toolGridStyle}>
                  {tools.filter(tool => tool.group === group).map(tool => {
                  const hasSubs = tool.subTools && tool.subTools.length > 0;
                  return (
                    <div key={tool.id} style={hasSubs ? { gridColumn: '1 / -1' } : undefined}>
                    <div
                      style={toolItemStyle}
                      onClick={() => { onNavigate(tool.id); onClose(); }}
                      onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--cyan)'; e.currentTarget.style.color = 'var(--cyan)'; }}
                      onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = ''; }}
                    >
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {t(`tools.${tool.id}.title`, tool.label)}
                      </span>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        {tool.type === 'ref' ? (
                          <div style={iconBadgeStyle('rgba(245, 158, 11, 0.12)', 'var(--yellow)')} title={t('help_modal.type_ref')}>
                            <BookIcon size={10} />
                          </div>
                        ) : (
                          <div style={iconBadgeStyle('rgba(0, 212, 200, 0.12)', 'var(--cyan)')} title={t('help_modal.type_tool')}>
                            <WrenchIcon size={10} />
                          </div>
                        )}
                        {tool.server && (
                          <div style={iconBadgeStyle('rgba(167, 139, 250, 0.15)', 'var(--purple)')} title={t('common.server_tool_desc')}>
                            <ServerIcon size={10} />
                          </div>
                        )}
                        {tool.online && (
                          <div style={iconBadgeStyle('rgba(74, 158, 255, 0.12)', 'var(--blue)')} title={t('common.online_tool_desc')}>
                            <GlobeIcon size={10} />
                          </div>
                        )}
                      </div>
                    </div>
                    {hasSubs && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 4, marginTop: 4, paddingLeft: 16 }}>
                        {tool.subTools.map((sub, si) => (
                          <div
                            key={si}
                            style={{ ...toolItemStyle, fontSize: 11, opacity: 0.85 }}
                            onClick={() => { onNavigate(tool.id, sub.nav); onClose(); }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--cyan)'; e.currentTarget.style.color = 'var(--cyan)'; }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.color = ''; }}
                          >
                            <span style={{ opacity: 0.5 }}>›</span>
                            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {t(sub.labelKey, sub.labelKey)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    </div>
                  );
                  })}
                </div>
              </div>
            ))}

            {/* Legend */}
            <div style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '16px',
              marginTop: '24px',
              padding: '12px 16px',
              background: 'var(--bg-2)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '11px',
              color: 'var(--text)',
              opacity: 0.85
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px', flex: '1 1 auto' }}>
                <div style={iconBadgeStyle('rgba(0, 212, 200, 0.12)', 'var(--cyan)')}>
                  <WrenchIcon size={10} />
                </div>
                <div>
                  <strong>{t('help_modal.type_tool')}</strong> — {t('help_modal.legend_tool_desc')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px', flex: '1 1 auto' }}>
                <div style={iconBadgeStyle('rgba(245, 158, 11, 0.12)', 'var(--yellow)')}>
                  <BookIcon size={10} />
                </div>
                <div>
                  <strong>{t('help_modal.type_ref')}</strong> — {t('help_modal.legend_ref_desc')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px', flex: '1 1 auto' }}>
                <div style={iconBadgeStyle('rgba(167, 139, 250, 0.15)', 'var(--purple)')}>
                  <ServerIcon size={10} />
                </div>
                <div>
                  <strong>{t('common.server_tool')}</strong> — {t('common.server_tool_desc')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '180px', flex: '1 1 auto' }}>
                <div style={iconBadgeStyle('rgba(74, 158, 255, 0.12)', 'var(--blue)')}>
                  <GlobeIcon size={10} />
                </div>
                <div>
                  <strong>{t('common.online_tool')}</strong> — {t('common.online_tool_desc')}
                </div>
              </div>
            </div>
          </section>

          {/* Tips */}
          <section id="help-tips">
            <div style={sectionHeadingStyle}>💡 {t('help_modal.tips_heading')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {tips.map((tip, i) => (
                <div key={i} style={{ background: 'var(--bg-2)', padding: '8px 12px', borderRadius: 5, fontSize: 12, lineHeight: 1.5 }}>
                  {tip}
                </div>
              ))}
            </div>
          </section>

          {/* About */}
          <section id="help-about">
            <div style={sectionHeadingStyle}>ℹ {t('help_modal.about_heading')}</div>
            <div style={{ background: 'var(--bg-2)', padding: '12px 16px', borderRadius: 5, fontSize: 12, lineHeight: 1.8 }}>
              <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>NetEngKit</div>
              <div style={{ opacity: 0.8 }}>{t('help_modal.about_tagline')}</div>
              {window.APP_VERSION && (
                <div style={{ opacity: 0.5, marginTop: 4 }}>v{window.APP_VERSION}</div>
              )}
              {window.APP_GITHUB_URL && (
                <a href={window.APP_GITHUB_URL} target="_blank" rel="noopener noreferrer"
                   style={{ color: 'var(--cyan)', display: 'inline-block', marginTop: 6, fontSize: 12 }}>
                  {t('help_modal.about_github')} →
                </a>
              )}
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}

