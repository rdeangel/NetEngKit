const { useState, useEffect, useCallback, useRef } = React;

function SubnetPlanner({ onShare, initialData, onNav }) {
  const { t } = useTranslation();
  const [mode, setMode] = usePersistentState('subnet-planner:mode', initialData?.mode ?? 'vlsm');
  const skipNavReport = useRef(false);

  // Apply-down: sidebar / Ctrl+K nav drives the active mode
  useEffect(() => {
    if (initialData?.mode && initialData.mode !== mode) {
      skipNavReport.current = true;
      setMode(initialData.mode);
    }
  }, [initialData]);

  // Report-up: tell the sidebar which sub-tab is active
  useEffect(() => {
    if (skipNavReport.current) { skipNavReport.current = false; return; }
    onNav?.({ mode });
  }, [mode]);

  const tabBtnStyle = (active) => ({
    background: active ? 'var(--card)' : 'transparent',
    border: '1px solid var(--border)',
    borderBottom: active ? '1px solid var(--card)' : '1px solid var(--border)',
    borderRadius: 'var(--radius) var(--radius) 0 0',
    color: active ? 'var(--fg)' : 'var(--dim)',
    padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer',
    marginBottom: -1, position: 'relative',
  });

  const tabs = [
    { id: 'vlsm', label: t('tools.vlsm.title') },
    { id: 'supernet', label: t('tools.supernet.title') },
    { id: 'split', label: t('tools.split.title') },
    { id: 'range', label: t('tools.range.title') },
    { id: 'overlap', label: t('tools.overlap.title') },
  ];

  return (
    <div className="fadein">
      <div style={{ display: 'flex', gap: 0, marginBottom: 12, borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setMode(tab.id)} style={tabBtnStyle(mode === tab.id)}>{tab.label}</button>
        ))}
      </div>

      {mode === 'vlsm' && <VLSMPlanner initialData={initialData} onShare={onShare} />}
      {mode === 'supernet' && <SupernetCalc initialData={initialData} onShare={onShare} />}
      {mode === 'split' && <SplitMerge initialData={initialData} onShare={onShare} />}
      {mode === 'range' && <RangeCIDR initialData={initialData} onShare={onShare} />}
      {mode === 'overlap' && <OverlapDetector initialData={initialData} onShare={onShare} />}
    </div>
  );
}

window.SubnetPlanner = SubnetPlanner;
