const { useState, useEffect, useCallback, useRef, useMemo } = React;

function PasswordGenerator({ onShare, initialData }) {
  const { t } = useTranslation();
  const [length, setLength] = usePersistentState('pass:length', initialData?.length ?? 16);
  const [count, setCount] = usePersistentState('pass:count', initialData?.count ?? 1);
  const [uppercase, setUppercase] = usePersistentState('pass:uppercase', initialData?.uppercase ?? true);
  const [lowercase, setLowercase] = usePersistentState('pass:lowercase', initialData?.lowercase ?? true);
  const [numbers, setNumbers] = usePersistentState('pass:numbers', initialData?.numbers ?? true);
  const [symbols, setSymbols] = usePersistentState('pass:symbols', initialData?.symbols ?? true);
  const [excludeAmbiguous, setExcludeAmbiguous] = usePersistentState('pass:excludeAmbiguous', initialData?.excludeAmbiguous ?? false);
  const [excludeChars, setExcludeChars] = usePersistentState('pass:excludeChars', initialData?.excludeChars ?? '');
  const [requireEach, setRequireEach] = usePersistentState('pass:requireEach', initialData?.requireEach ?? true);
  const [passwords, setPasswords] = usePersistentState('pass:passwords', []);

  const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const LOWER = 'abcdefghijklmnopqrstuvwxyz';
  const DIGITS = '0123456789';
  const SYMBOLS = '!@#$%^&*()_+-=[]{}|;:,.<>?';
  const AMBIGUOUS = 'Il1O0o';

  const PRESETS = [
    { label: t('passgen.presets.pin'), length: 4, upper: false, lower: false, numbers: true, symbols: false, ambiguous: false },
    { label: t('passgen.presets.simple'), length: 8, upper: true, lower: true, numbers: true, symbols: false, ambiguous: false },
    { label: t('passgen.presets.standard'), length: 12, upper: true, lower: true, numbers: true, symbols: true, ambiguous: false },
    { label: t('passgen.presets.strong'), length: 16, upper: true, lower: true, numbers: true, symbols: true, ambiguous: true },
    { label: t('passgen.presets.passphrase_len'), length: 24, upper: true, lower: true, numbers: true, symbols: true, ambiguous: true },
    { label: t('passgen.presets.ultra'), length: 32, upper: true, lower: true, numbers: true, symbols: true, ambiguous: true },
    { label: t('passgen.presets.numeric'), length: 6, upper: false, lower: false, numbers: true, symbols: false, ambiguous: false },
    { label: t('passgen.presets.hex'), length: 32, upper: false, lower: false, numbers: true, symbols: false, ambiguous: false },
  ];

  useEffect(() => {
    if (initialData) {
      if (initialData.length !== undefined) setLength(initialData.length);
      if (initialData.count !== undefined) setCount(initialData.count);
      if (initialData.uppercase !== undefined) setUppercase(initialData.uppercase);
      if (initialData.lowercase !== undefined) setLowercase(initialData.lowercase);
      if (initialData.numbers !== undefined) setNumbers(initialData.numbers);
      if (initialData.symbols !== undefined) setSymbols(initialData.symbols);
      if (initialData.excludeAmbiguous !== undefined) setExcludeAmbiguous(initialData.excludeAmbiguous);
      if (initialData.excludeChars !== undefined) setExcludeChars(initialData.excludeChars);
      if (initialData.requireEach !== undefined) setRequireEach(initialData.requireEach);
    }
  }, [initialData]);

  useEffect(() => {
    const handle = (e) => {
      (e.detail?.respond ?? onShare)({ tool: 'passgen', length, count, uppercase, lowercase, numbers, symbols, excludeAmbiguous, excludeChars, requireEach });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [length, count, uppercase, lowercase, numbers, symbols, excludeAmbiguous, excludeChars, requireEach, onShare]);

  const getCharset = useMemo(() => {
    let chars = '';
    if (uppercase) chars += UPPER;
    if (lowercase) chars += LOWER;
    if (numbers) chars += DIGITS;
    if (symbols) chars += SYMBOLS;
    if (excludeAmbiguous) chars = chars.split('').filter(c => !AMBIGUOUS.includes(c)).join('');
    if (excludeChars) chars = chars.split('').filter(c => !excludeChars.includes(c)).join('');
    return chars;
  }, [uppercase, lowercase, numbers, symbols, excludeAmbiguous, excludeChars]);

  const calcEntropy = useMemo(() => {
    const poolSize = getCharset.length;
    if (!poolSize || length <= 0) return { bits: 0, pool: 0 };
    const bits = Math.floor(length * Math.log2(poolSize));
    return { bits, pool: poolSize };
  }, [getCharset, length]);

  const getStrength = (bits) => {
    if (bits < 28) return { label: t('passgen.strength.very_weak'), color: 'var(--red)', pct: 10 };
    if (bits < 36) return { label: t('passgen.strength.weak'), color: 'var(--red)', pct: 25 };
    if (bits < 60) return { label: t('passgen.strength.fair'), color: 'var(--yellow)', pct: 50 };
    if (bits < 80) return { label: t('passgen.strength.strong'), color: 'var(--green)', pct: 75 };
    if (bits < 128) return { label: t('passgen.strength.very_strong'), color: 'var(--green)', pct: 90 };
    return { label: t('passgen.strength.excellent'), color: 'var(--cyan)', pct: 100 };
  };

  const generatePassword = (len, charset, reqEach) => {
    if (!charset) return '';
    const getSecureRandom = (max) => {
      const arr = new Uint32Array(1);
      crypto.getRandomValues(arr);
      return arr[0] % max;
    };

    if (reqEach) {
      let pwd = [];
      const ensure = (set) => { if (set) pwd.push(set[getSecureRandom(set.length)]); };
      let filteredUpper = uppercase ? (excludeAmbiguous ? UPPER.split('').filter(c => !AMBIGUOUS.includes(c)).join('') : UPPER) : '';
      let filteredLower = lowercase ? (excludeAmbiguous ? LOWER.split('').filter(c => !AMBIGUOUS.includes(c)).join('') : LOWER) : '';
      let filteredDigits = numbers ? (excludeAmbiguous ? DIGITS.split('').filter(c => !AMBIGUOUS.includes(c)).join('') : DIGITS) : '';
      let filteredSymbols = symbols ? SYMBOLS : '';
      if (excludeChars) {
        filteredUpper = filteredUpper.split('').filter(c => !excludeChars.includes(c)).join('');
        filteredLower = filteredLower.split('').filter(c => !excludeChars.includes(c)).join('');
        filteredDigits = filteredDigits.split('').filter(c => !excludeChars.includes(c)).join('');
        filteredSymbols = filteredSymbols.split('').filter(c => !excludeChars.includes(c)).join('');
      }
      ensure(filteredUpper);
      ensure(filteredLower);
      ensure(filteredDigits);
      ensure(filteredSymbols);
      while (pwd.length < len) pwd.push(charset[getSecureRandom(charset.length)]);
      // Shuffle
      for (let i = pwd.length - 1; i > 0; i--) {
        const j = getSecureRandom(i + 1);
        [pwd[i], pwd[j]] = [pwd[j], pwd[i]];
      }
      return pwd.join('');
    }
    const arr = new Uint32Array(len);
    crypto.getRandomValues(arr);
    return Array.from(arr, v => charset[v % charset.length]).join('');
  };

  const handleGenerate = () => {
    const n = Math.max(1, Math.min(count, 100));
    const result = [];
    for (let i = 0; i < n; i++) {
      result.push(generatePassword(length, getCharset, requireEach));
    }
    setPasswords(result);
  };

  const strength = getStrength(calcEntropy.bits);

  return (
    <div className="tool-content">

      <div className="card fadein">
        <div className="card-title">{t('passgen.config_title')}</div>

        {/* Length slider */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label className="label" style={{ margin: 0 }}>{t('passgen.length_label')}</label>
            <span style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: 'var(--cyan)' }}>{length}</span>
          </div>
          <input type="range" min={1} max={128} value={length} onChange={e => setLength(Number(e.target.value))}
            style={{ width: '100%', accentColor: 'var(--cyan)' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--dim)' }}>
            <span>1</span><span>32</span><span>64</span><span>96</span><span>128</span>
          </div>
        </div>

        {/* Character sets */}
        <div style={{ marginBottom: 14 }}>
          <div className="label">{t('passgen.charset_label')}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {[
              { id: 'uppercase', label: t('passgen.uppercase_label'), desc: UPPER, state: uppercase, setter: setUppercase },
              { id: 'lowercase', label: t('passgen.lowercase_label'), desc: LOWER, state: lowercase, setter: setLowercase },
              { id: 'numbers', label: t('passgen.numbers_label'), desc: DIGITS, state: numbers, setter: setNumbers },
              { id: 'symbols', label: t('passgen.symbols_label'), desc: SYMBOLS, state: symbols, setter: setSymbols },
            ].map(cs => (
              <label key={cs.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', padding: '6px 10px', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                <input type="checkbox" checked={cs.state} onChange={e => cs.setter(e.target.checked)} />
                <span style={{ fontWeight: 600, fontSize: 13 }}>{cs.label}</span>
                <code style={{ fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--dim)', marginLeft: 'auto' }}>{cs.desc}</code>
              </label>
            ))}
          </div>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 14 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>
            <input type="checkbox" checked={excludeAmbiguous} onChange={e => setExcludeAmbiguous(e.target.checked)} />
            {t('passgen.exclude_ambiguous')} <code style={{ fontFamily: 'var(--mono)', fontSize: 10 }}>({AMBIGUOUS})</code>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 12, color: 'var(--muted)' }}>
            <input type="checkbox" checked={requireEach} onChange={e => setRequireEach(e.target.checked)} />
            {t('passgen.require_each')}
          </label>
        </div>

        {/* Exclude characters */}
        <div style={{ marginBottom: 14 }}>
          <label className="label">{t('passgen.exclude_label')}</label>
          <input className="input" value={excludeChars} onChange={e => setExcludeChars(e.target.value)}
            placeholder={t('passgen.exclude_placeholder')} style={{ fontFamily: 'var(--mono)', fontSize: 12, maxWidth: 300 }} />
        </div>

        {/* Count */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
          <div>
            <label className="label">{t('passgen.count_label')}</label>
            <input type="number" className="input" min={1} max={100} value={count}
              onChange={e => setCount(Math.max(1, Math.min(100, Number(e.target.value))))}
              style={{ width: 80 }} />
          </div>
          <button className="btn btn-primary" onClick={handleGenerate} disabled={!getCharset.length}
            style={{ marginTop: 16 }}>
            {t('passgen.generate_btn')}
          </button>
        </div>
      </div>

      {/* Presets */}
      <div className="card fadein">
        <div className="card-title">{t('passgen.presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost" style={{ fontSize: 12, padding: '3px 10px' }}
              onClick={() => { setLength(p.length); setUppercase(p.upper); setLowercase(p.lower); setNumbers(p.numbers); setSymbols(p.symbols); setExcludeAmbiguous(p.ambiguous); }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Entropy info */}
      <div className="card fadein">
        <div className="card-title">{t('passgen.entropy_title')}</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 10 }}>
          <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{t('passgen.pool_size')}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: 'var(--cyan)' }}>{calcEntropy.pool}</div>
          </div>
          <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{t('passgen.entropy_bits')}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 18, fontWeight: 700, color: strength.color }}>{calcEntropy.bits} {t('passgen.bits')}</div>
          </div>
          <div style={{ padding: 12, background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)', textAlign: 'center' }}>
            <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 4 }}>{t('passgen.strength_label')}</div>
            <div style={{ fontFamily: 'var(--mono)', fontSize: 14, fontWeight: 700, color: strength.color }}>{strength.label}</div>
          </div>
        </div>
        {/* Strength bar */}
        <div style={{ marginTop: 10, height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
          <div style={{ width: `${strength.pct}%`, height: '100%', background: strength.color, borderRadius: 3, transition: 'all 0.3s' }} />
        </div>
        {calcEntropy.pool > 0 && (
          <div style={{ fontSize: 11, color: 'var(--dim)', marginTop: 8 }}>
            {t('passgen.combinations')}: ~10^{Math.floor(calcEntropy.bits / 3.32)} {t('passgen.possible_combos')}
          </div>
        )}
      </div>

      {/* Generated Passwords */}
      {passwords.length > 0 && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div className="card-title" style={{ margin: 0 }}>{t('passgen.results_title')}</div>
            <CopyBtn text={passwords.join('\n')} label="copy_all" id="passgen-copy-all" />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {passwords.map((pwd, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px',
                background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
              }}>
                <span style={{ fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--dim)', minWidth: 24 }}>{i + 1}.</span>
                <code style={{
                  fontFamily: 'var(--mono)', fontSize: 13, flex: 1, wordBreak: 'break-all',
                  color: 'var(--text)', letterSpacing: 0.5,
                }}>{pwd}</code>
                <CopyBtn text={pwd} id={`pwd-${i}`} />
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

window.PasswordGenerator = PasswordGenerator;
