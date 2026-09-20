const { useState, useRef, useEffect } = React;

const LANGUAGES = [
  { id: 'zh-CN', label: '简体中文', enLabel: 'Chinese (Simplified)', flag: '🇨🇳' },
  { id: 'zh-TW', label: '繁體中文', enLabel: 'Chinese (Traditional)', flag: '🇹🇼' },
  { id: 'en', label: 'English', enLabel: 'English', flag: '🇬🇧' },
  { id: 'fr', label: 'Français', enLabel: 'French', flag: '🇫🇷' },
  { id: 'de', label: 'Deutsch', enLabel: 'German', flag: '🇩🇪' },
  { id: 'hi', label: 'हिन्दी', enLabel: 'Hindi', flag: '🇮🇳' },
  { id: 'it', label: 'Italiano', enLabel: 'Italian', flag: '🇮🇹' },
  { id: 'ja', label: '日本語', enLabel: 'Japanese', flag: '🇯🇵' },
  { id: 'ko', label: '한국어', enLabel: 'Korean', flag: '🇰🇷' },
  { id: 'pl', label: 'Polski', enLabel: 'Polish', flag: '🇵🇱' },
  { id: 'pt', label: 'Português', enLabel: 'Portuguese', flag: '🇵🇹' },
  { id: 'pt-BR', label: 'Português (BR)', enLabel: 'Portuguese (Brazil)', flag: '🇧🇷' },
  { id: 'ru', label: 'Русский', enLabel: 'Russian', flag: '🇷🇺' },
  { id: 'es', label: 'Español', enLabel: 'Spanish', flag: '🇪🇸' },
  { id: 'vi', label: 'Tiếng Việt', enLabel: 'Vietnamese', flag: '🇻🇳' }
];

window.LANGUAGES = LANGUAGES;

function LanguagePicker({ open, lang, setLang, onClose }) {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);
  const overlayRef = useRef(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  const filtered = LANGUAGES.filter(l =>
    l.label.toLowerCase().includes(query.toLowerCase()) ||
    l.enLabel.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="cmd-overlay" ref={overlayRef} onClick={(e) => { if (e.target === overlayRef.current) onClose(); }}>
      <div className="cmd-box lang-picker">
        <div className="lang-picker-search">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input
            ref={inputRef}
            type="text"
            placeholder={t('common.search_language', 'Search language...')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="lang-picker-list">
          {filtered.length === 0 && (
            <div className="lang-picker-empty">{t('common.no_languages_found', 'No languages found')}</div>
          )}
          {filtered.map(l => (
            <button
              key={l.id}
              className={`lang-picker-item ${lang === l.id ? 'active' : ''}`}
              onClick={() => { setLang(l.id); onClose(); }}
            >
              <span className="lang-picker-flag">{l.flag}</span>
              <div className="lang-picker-label-wrap">
                <span className="lang-picker-label">{l.label}</span>
                {l.id !== 'en' && <span className="lang-picker-en-label">{l.enLabel}</span>}
              </div>
              {lang === l.id && (
                <svg className="lang-picker-check" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

window.LanguagePicker = LanguagePicker;
