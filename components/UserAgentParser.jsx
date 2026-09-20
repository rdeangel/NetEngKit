const { useState, useEffect, useCallback, useMemo } = React;

function UserAgentParser({ onShare, initialData }) {
  const { t } = useTranslation();
  const [uaInput, setUaInput] = usePersistentState('ua:uaInput', initialData?.uaInput ?? '');

  const PRESETS = [
    { label: t('uaparse.presets.chrome_win'), value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36' },
    { label: t('uaparse.presets.firefox_linux'), value: 'Mozilla/5.0 (X11; Linux x86_64; rv:123.0) Gecko/20100101 Firefox/123.0' },
    { label: t('uaparse.presets.safari_mac'), value: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Safari/605.1.15' },
    { label: t('uaparse.presets.edge_win'), value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0' },
    { label: t('uaparse.presets.iphone'), value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.2 Mobile/15E148 Safari/604.1' },
    { label: t('uaparse.presets.android'), value: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36' },
    { label: t('uaparse.presets.googlebot'), value: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' },
    { label: t('uaparse.presets.curl'), value: 'curl/8.5.0' },
    { label: t('uaparse.presets.python'), value: 'python-requests/2.31.0' },
    { label: t('uaparse.presets.wget'), value: 'Wget/1.21.4' },
    { label: t('uaparse.presets.ipad'), value: 'Mozilla/5.0 (iPad; CPU OS 17_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.89 Mobile/15E148 Safari/604.1' },
    { label: t('uaparse.presets.xbox'), value: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; Xbox; Xbox One) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edge/44.18363.8131' },
  ];

  useEffect(() => {
    if (initialData?.uaInput !== undefined) setUaInput(initialData.uaInput);
  }, [initialData]);

  useEffect(() => {
    const handle = (e) => {
      if (uaInput) (e.detail?.respond ?? onShare)({ tool: 'uaparse', uaInput });
    };
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [uaInput, onShare]);

  const parsed = useMemo(() => {
    if (!uaInput.trim()) return null;
    const ua = uaInput.trim();

    const result = {
      browser: { name: t('uaparse.unknown'), version: '', engine: '' },
      os: { name: t('uaparse.unknown'), version: '', arch: '' },
      device: { type: t('uaparse.desktop'), brand: '', model: '' },
      isBot: false,
      botName: '',
      renderingEngine: '',
      rawComponents: [],
    };

    // Bot detection
    const botPatterns = [
      { pattern: /Googlebot/i, name: 'Googlebot' },
      { pattern: /Bingbot/i, name: 'Bingbot' },
      { pattern: /Slurp/i, name: 'Yahoo Slurp' },
      { pattern: /DuckDuckBot/i, name: 'DuckDuckBot' },
      { pattern: /Baiduspider/i, name: 'Baiduspider' },
      { pattern: /YandexBot/i, name: 'YandexBot' },
      { pattern: /facebookexternalhit/i, name: 'Facebook Crawler' },
      { pattern: /Twitterbot/i, name: 'Twitterbot' },
      { pattern: /LinkedInBot/i, name: 'LinkedInBot' },
      { pattern: /Slackbot/i, name: 'Slackbot' },
      { pattern: /Discordbot/i, name: 'Discord Bot' },
      { pattern: /WhatsApp/i, name: 'WhatsApp' },
      { pattern: /TelegramBot/i, name: 'TelegramBot' },
      { pattern: /AhrefsBot/i, name: 'AhrefsBot' },
      { pattern: /MJ12bot/i, name: 'Majestic' },
      { pattern: /SemrushBot/i, name: 'SemrushBot' },
      { pattern: /crawler|spider|bot/i, name: t('uaparse.generic_crawler') },
    ];

    for (const bot of botPatterns) {
      if (bot.pattern.test(ua)) {
        result.isBot = true;
        result.botName = bot.name;
        result.device.type = t('uaparse.bot');
        break;
      }
    }

    // Tool/library detection
    const toolPatterns = [
      { pattern: /^curl\//i, name: 'curl' },
      { pattern: /^wget\//i, name: 'Wget' },
      { pattern: /python-requests/i, name: 'Python Requests' },
      { pattern: /python-urllib/i, name: 'Python urllib' },
      { pattern: /^HTTPie/i, name: 'HTTPie' },
      { pattern: /PostmanRuntime/i, name: 'Postman' },
      { pattern: /Insomnia/i, name: 'Insomnia' },
      { pattern: /axios/i, name: 'Axios' },
      { pattern: /node-fetch/i, name: 'node-fetch' },
      { pattern: /got\//i, name: 'Got' },
      { pattern: /java\//i, name: 'Java HTTP Client' },
      { pattern: /okhttp/i, name: 'OkHttp' },
    ];

    for (const tool of toolPatterns) {
      if (tool.pattern.test(ua)) {
        result.browser.name = tool.name;
        const m = ua.match(/[\d.]+/);
        result.browser.version = m ? m[0] : '';
        result.device.type = t('uaparse.tool');
        result.os.name = '-';
        return result;
      }
    }

    // Rendering engine
    if (/AppleWebKit/i.test(ua)) result.renderingEngine = t('uaparse.engine.webkit');
    if (/Gecko\//i.test(ua) && !/like Gecko/i.test(ua)) result.renderingEngine = t('uaparse.engine.gecko');
    if (/Trident/i.test(ua)) result.renderingEngine = t('uaparse.engine.trident');
    if (/Blink/i.test(ua)) result.renderingEngine = t('uaparse.engine.blink');

    // Browser detection (order matters - check specific first)
    const browserPatterns = [
      { pattern: /Edg\/([\d.]+)/i, name: 'Microsoft Edge', engine: 'Blink' },
      { pattern: /OPR\/([\d.]+)/i, name: 'Opera', engine: 'Blink' },
      { pattern: /Vivaldi\/([\d.]+)/i, name: 'Vivaldi', engine: 'Blink' },
      { pattern: /Brave/i, name: 'Brave', engine: 'Blink' },
      { pattern: /SamsungBrowser\/([\d.]+)/i, name: 'Samsung Internet', engine: 'Blink' },
      { pattern: /UCBrowser\/([\d.]+)/i, name: 'UC Browser', engine: '' },
      { pattern: /CriOS\/([\d.]+)/i, name: 'Chrome (iOS)', engine: 'WebKit' },
      { pattern: /Chrome\/([\d.]+)/i, name: 'Google Chrome', engine: 'Blink' },
      { pattern: /Firefox\/([\d.]+)/i, name: 'Mozilla Firefox', engine: 'Gecko' },
      { pattern: /FxiOS\/([\d.]+)/i, name: 'Firefox (iOS)', engine: 'WebKit' },
      { pattern: /Safari\/([\d.]+)/i, name: 'Apple Safari', engine: 'WebKit' },
      { pattern: /MSIE ([\d.]+)/i, name: 'Internet Explorer', engine: 'Trident' },
      { pattern: /Trident\/.*rv:([\d.]+)/i, name: 'Internet Explorer', engine: 'Trident' },
    ];

    for (const bp of browserPatterns) {
      const m = ua.match(bp.pattern);
      if (m) {
        result.browser.name = bp.name;
        result.browser.version = m[1] || '';
        result.browser.engine = bp.engine || result.renderingEngine;
        break;
      }
    }

    // OS detection
    const osPatterns = [
      { pattern: /Windows NT ([\d.]+)/i, name: 'Windows', versions: { '10.0': '10/11', '6.3': '8.1', '6.2': '8', '6.1': '7', '6.0': 'Vista', '5.1': 'XP' } },
      { pattern: /Mac OS X ([\d_]+)/i, name: 'macOS', prefix: '' },
      { pattern: /iPhone OS ([\d_]+)/i, name: 'iOS', prefix: '' },
      { pattern: /iPad.*OS ([\d_]+)/i, name: 'iPadOS', prefix: '' },
      { pattern: /Android ([\d.]+)/i, name: 'Android', prefix: '' },
      { pattern: /Linux/i, name: 'Linux', prefix: '' },
      { pattern: /CrOS/i, name: 'ChromeOS', prefix: '' },
      { pattern: /Ubuntu/i, name: 'Ubuntu', prefix: '' },
      { pattern: /Fedora/i, name: 'Fedora', prefix: '' },
    ];

    for (const op of osPatterns) {
      const m = ua.match(op.pattern);
      if (m) {
        result.os.name = op.name;
        if (op.versions && m[1]) {
          result.os.version = op.versions[m[1]] || m[1];
        } else if (m[1]) {
          result.os.version = m[1].replace(/_/g, '.');
        }
        break;
      }
    }

    // Architecture
    if (/x86-64|Win64|x64|amd64/i.test(ua)) result.os.arch = t('uaparse.arch.x86_64');
    else if (/x86|Win32|i686|i386/i.test(ua)) result.os.arch = t('uaparse.arch.x86');
    else if (/aarch64|arm64/i.test(ua)) result.os.arch = t('uaparse.arch.arm64');
    else if (/arm/i.test(ua)) result.os.arch = t('uaparse.arch.arm');

    // Device type
    if (/iPhone/i.test(ua)) { result.device.type = t('uaparse.mobile'); result.device.brand = 'Apple'; result.device.model = 'iPhone'; }
    else if (/iPad/i.test(ua)) { result.device.type = t('uaparse.tablet'); result.device.brand = 'Apple'; result.device.model = 'iPad'; }
    else if (/Android.*Mobile/i.test(ua)) { result.device.type = t('uaparse.mobile'); result.device.brand = 'Android'; }
    else if (/Android/i.test(ua)) { result.device.type = t('uaparse.tablet'); }
    else if (/Mobile/i.test(ua)) result.device.type = t('uaparse.mobile');
    else if (/Xbox/i.test(ua)) { result.device.type = t('uaparse.console'); result.device.brand = 'Microsoft'; result.device.model = 'Xbox'; }
    else if (/PlayStation/i.test(ua)) { result.device.type = t('uaparse.console'); result.device.brand = 'Sony'; }
    else if (/Nintendo/i.test(ua)) { result.device.type = t('uaparse.console'); result.device.brand = 'Nintendo'; }
    else if (/Smart-TV|SmartTV|HbbTV/i.test(ua)) result.device.type = t('uaparse.smart_tv');

    // Android device brand/model extraction
    if (/Android/i.test(ua)) {
      const brandMatch = ua.match(/;\s*([^;)]+)\s+Build/i);
      if (brandMatch) result.device.model = brandMatch[1].trim();
    }

    return result;
  }, [uaInput]);

  return (
    <div className="tool-content">

      <div className="card fadein">
        <div className="card-title">{t('uaparse.input_title')}</div>
        <textarea
          className="input"
          rows={3}
          placeholder={t('uaparse.input_placeholder')}
          value={uaInput}
          onChange={e => setUaInput(e.target.value)}
          style={{ fontFamily: 'var(--mono)', fontSize: 11, resize: 'vertical', width: '100%' }}
        />
        <div style={{ marginTop: 6 }}>
          <button className="btn btn-ghost btn-sm" onClick={() => setUaInput(navigator.userAgent)}>
            {t('uaparse.use_current')}
          </button>
        </div>
      </div>

      {/* Presets */}
      <div className="card fadein">
        <div className="card-title">{t('uaparse.presets_title')}</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {PRESETS.map(p => (
            <button key={p.label} className="btn btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }}
              onClick={() => setUaInput(p.value)}>{p.label}</button>
          ))}
        </div>
      </div>

      {/* Parsed result */}
      {parsed && (
        <div className="fadein">
          {/* Bot warning */}
          {parsed.isBot && (
            <div style={{ background: 'rgba(234,179,8,0.1)', border: '1px solid rgba(234,179,8,0.3)', borderRadius: 'var(--radius)', padding: '10px 14px', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 16 }}>🤖</span>
              <span style={{ color: 'var(--yellow)', fontWeight: 600, fontSize: 13 }}>{t('uaparse.bot_detected')}: {parsed.botName}</span>
            </div>
          )}

          {/* Browser */}
          <div className="card">
            <div className="card-title" style={{ color: 'var(--cyan)' }}>{t('uaparse.browser_section')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 8 }}>
              {[
                { label: t('uaparse.browser_name'), value: parsed.browser.name, color: 'var(--cyan)' },
                { label: t('uaparse.browser_version'), value: parsed.browser.version || '-', color: 'var(--text)' },
                { label: t('uaparse.rendering_engine'), value: parsed.browser.engine || parsed.renderingEngine || '-', color: 'var(--purple)' },
              ].map(item => (
                <div key={item.label} style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* OS */}
          <div className="card">
            <div className="card-title" style={{ color: 'var(--green)' }}>{t('uaparse.os_section')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {[
                { label: t('uaparse.os_name'), value: parsed.os.name, color: 'var(--green)' },
                { label: t('uaparse.os_version'), value: parsed.os.version || '-', color: 'var(--text)' },
                { label: t('uaparse.architecture'), value: parsed.os.arch || '-', color: 'var(--yellow)' },
              ].map(item => (
                <div key={item.label} style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Device */}
          <div className="card">
            <div className="card-title" style={{ color: 'var(--yellow)' }}>{t('uaparse.device_section')}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 8 }}>
              {[
                { label: t('uaparse.device_type'), value: parsed.device.type, color: 'var(--yellow)' },
                { label: t('uaparse.device_brand'), value: parsed.device.brand || '-', color: 'var(--text)' },
                { label: t('uaparse.device_model'), value: parsed.device.model || '-', color: 'var(--text)' },
              ].map(item => (
                <div key={item.label} style={{ padding: '10px 12px', background: 'var(--bg)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                  <div style={{ fontSize: 10, color: 'var(--dim)', marginBottom: 4 }}>{item.label}</div>
                  <div style={{ fontFamily: 'var(--mono)', fontSize: 13, fontWeight: 600, color: item.color }}>{item.value}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

window.UserAgentParser = UserAgentParser;
