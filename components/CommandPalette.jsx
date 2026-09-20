const { useState, useEffect, useCallback, useRef, useMemo } = React;

function CommandPalette({ onSelect, onClose }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef(null);
  useEffect(() => {
    inputRef.current?.focus();
    const handleEsc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, []);
  useEffect(() => {
    setResults(getSearchResults(query, t));
    setActiveIndex(0);
  }, [query, t]);
  const handleKeyDown = (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIndex(prev => (prev + 1) % results.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIndex(prev => (prev - 1 + results.length) % results.length); }
    else if (e.key === 'Enter' && results[activeIndex]) { onSelect(results[activeIndex]); }
  };
  return (
    <div className="cmd-overlay" onClick={onClose}>
      <div className="cmd-box" onClick={e => e.stopPropagation()}>
        <div className="cmd-input-wrap">
          <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{color:'var(--cyan)'}}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/></svg>
          <input ref={inputRef} className="cmd-input" placeholder={t('common.cmd_palette.placeholder')}
            value={query} onChange={e => setQuery(e.target.value)} onKeyDown={handleKeyDown} />
        </div>
        <div className="cmd-results">
          {results.length > 0 ? results.map((r, i) => (
            <div key={i} className={`cmd-item ${i === activeIndex ? 'active' : ''}`}
              onMouseEnter={() => setActiveIndex(i)} onClick={() => onSelect(r)}>
              <div className="cmd-item-main">
                <span className="cmd-item-badge">{r.type}</span>
                <div>
                  <div className="cmd-item-title">{r.title}</div>
                  <div className="cmd-item-desc">{r.desc}</div>
                </div>
              </div>
              {i === activeIndex && <span style={{fontSize:10, color:'var(--dim)'}}>↵ {t('common.cmd_palette.enter')}</span>}
            </div>
          )) : (
            <div style={{padding:'40px 20px', textAlign:'center', color:'var(--dim)', fontSize:14}}>
              {query.length < 2 ? t('common.cmd_palette.start_typing') : t('common.no_results')}
            </div>
          )}
        </div>
        <div className="cmd-hint">
          <div dangerouslySetInnerHTML={{ __html: t('common.cmd_palette.hint_nav') }}></div>
          <div dangerouslySetInnerHTML={{ __html: t('common.cmd_palette.hint_close') }}></div>
        </div>
      </div>
    </div>
  );
}

window.CommandPalette = CommandPalette;
