function ConfigRedactor({ initialData, onShare }) {
  const { t } = useTranslation();
  const [input, setInput] = usePersistentState('config-redactor:input', initialData?.input ?? '');
  const [activeOptions, setActiveOptions] = usePersistentState('config-redactor:active-options', ['passwords', 'ips', 'hostnames', 'macs', 'snmp', 'apikeys', 'bgpasn', 'snmp_metadata', 'desc', 'wifi', 'banners', 'serials']);
  const [ipShift, setIpShift] = usePersistentState('config-redactor:ip-shift', true);
  const [customPatterns, setCustomPatterns] = usePersistentState('config-redactor:custom', '');
  
  const [copied, copy] = useCopy();

  // Share state sync
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({
        tool: 'config-redactor',
        input,
        activeOptions,
        ipShift,
        customPatterns
      });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [input, activeOptions, ipShift, customPatterns, onShare]);

  const customPresets = useMemo(() => [
    { label: t('config_redactor.preset_domain'), value: '/[a-zA-Z0-9-]+\\.[a-zA-Z0-9-.]+/g' },
    { label: t('config_redactor.preset_email'), value: '/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}/g' },
    { label: t('config_redactor.preset_phone'), value: '/\\b(?:\\+?\\d{1,3}[- ]?)?\\(?\\d{3}\\)?[- ]?\\d{3}[- ]?\\d{4}\\b/g' },
    { label: t('config_redactor.preset_banner'), value: '/(banner motd \\S+)[\\s\\S]+?(\\^)/i' },
    { label: t('config_redactor.preset_desc'), value: '/description\\s+.+/gi' },
    { label: t('config_redactor.preset_key_block'), value: '/-----BEGIN [A-Z ]+-----[\\s\\S]+?-----END [A-Z ]+-----/g' },
    { label: t('config_redactor.preset_url'), value: '/https?:\\/\\/\\S+/gi' },
    { label: t('config_redactor.preset_cidr'), value: '/(\\b(?:[0-9]{1,3}\\.){3}[0-9]{1,3}\\/[0-9]{1,2}\\b)/g' },
    { label: t('config_redactor.preset_mac'), value: '/\\b(?:[0-9a-fA-F]{2}[:.-]){5}[0-9a-fA-F]{2}\\b|\\b[0-9a-fA-F]{4}\\.[0-9a-fA-F]{4}\\.[0-9a-fA-F]{4}\\b/g' },
    { label: t('config_redactor.preset_ipv6'), value: '/\\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\\b|\\b(?:[0-9a-fA-F]{1,4}:){1,7}:[0-9a-fA-F]{1,4}\\b|\\b::(?:[0-9a-fA-F]{1,4}:){0,7}[0-9a-fA-F]{1,4}\\b|\\b(?:[0-9a-fA-F]{1,4}:){1,7}:\\b/g' }
  ], [t]);

  const addPreset = useCallback((value) => {
    setCustomPatterns(prev => {
      const trimmed = prev.trim();
      return trimmed ? `${trimmed}\n${value}` : value;
    });
  }, [setCustomPatterns]);

  // Generate consistent seed shifts once per component mount (or session)
  const sessionSeeds = useMemo(() => {
    return {
      r1: Math.floor(Math.random() * 254) + 1,
      r2: Math.floor(Math.random() * 254) + 1,
      r3: Math.floor(Math.random() * 254) + 1,
      ipv6Seed: Math.floor(Math.random() * 0xffff)
    };
  }, []);

  // Helper to determine if an IP address matches standard subnet mask formats
  const isSubnetMask = useCallback((ipStr) => {
    const masks = [
      '255.255.255.255', '255.255.255.254', '255.255.255.252', '255.255.255.248',
      '255.255.255.240', '255.255.255.224', '255.255.255.192', '255.255.255.128',
      '255.255.255.0',   '255.255.254.0',   '255.255.252.0',   '255.255.248.0',
      '255.255.240.0',   '255.255.224.0',   '255.255.192.0',   '255.255.128.0',
      '255.255.0.0',     '255.254.0.0',     '255.252.0.0',     '255.248.0.0',
      '255.240.0.0',     '255.224.0.0',     '255.192.0.0',     '255.128.0.0',
      '255.0.0.0',       '254.0.0.0',       '252.0.0.0',       '248.0.0.0',
      '240.0.0.0',       '224.0.0.0',       '192.0.0.0',       '128.0.0.0',
      '0.0.0.0'
    ];
    return masks.includes(ipStr);
  }, []);

  const availableOptions = useMemo(() => [
    { value: 'passwords', label: t('config_redactor.toggle_passwords'), hint: t('config_redactor.toggle_passwords_hint') },
    { value: 'ips', label: t('config_redactor.toggle_ips'), hint: t('config_redactor.toggle_ips_hint') },
    { value: 'hostnames', label: t('config_redactor.toggle_hostnames'), hint: t('config_redactor.toggle_hostnames_hint') },
    { value: 'macs', label: t('config_redactor.toggle_macs'), hint: t('config_redactor.toggle_macs_hint') },
    { value: 'snmp', label: t('config_redactor.toggle_snmp'), hint: t('config_redactor.toggle_snmp_hint') },
    { value: 'apikeys', label: t('config_redactor.toggle_apikeys'), hint: t('config_redactor.toggle_apikeys_hint') },
    { value: 'bgpasn', label: t('config_redactor.toggle_bgpasn'), hint: t('config_redactor.toggle_bgpasn_hint') },
    { value: 'snmp_metadata', label: t('config_redactor.toggle_snmp_metadata'), hint: t('config_redactor.toggle_snmp_metadata_hint') },
    { value: 'desc', label: t('config_redactor.toggle_desc'), hint: t('config_redactor.toggle_desc_hint') },
    { value: 'wifi', label: t('config_redactor.toggle_wifi'), hint: t('config_redactor.toggle_wifi_hint') },
    { value: 'banners', label: t('config_redactor.toggle_banners'), hint: t('config_redactor.toggle_banners_hint') },
    { value: 'serials', label: t('config_redactor.toggle_serials'), hint: t('config_redactor.toggle_serials_hint') }
  ], [t]);

  // Main redaction processing
  const redactionResult = useMemo(() => {
    if (!input) return { redactedText: '', log: [] };

    const log = [];
    let text = input;

    // Track active choices
    const hasPasswords = activeOptions.includes('passwords');
    const hasIPs = activeOptions.includes('ips');
    const hasHostnames = activeOptions.includes('hostnames');
    const hasMacs = activeOptions.includes('macs');
    const hasSnmp = activeOptions.includes('snmp');
    const hasApiKeys = activeOptions.includes('apikeys');
    const hasBgpAsn = activeOptions.includes('bgpasn');
    const hasSnmpMetadata = activeOptions.includes('snmp_metadata');
    const hasDesc = activeOptions.includes('desc');
    const hasWifi = activeOptions.includes('wifi');
    const hasBanners = activeOptions.includes('banners');
    const hasSerials = activeOptions.includes('serials');

    // Trackers for consistent replacements
    const ipMap = {};
    let ipCounter = 1;

    const hostnameMap = {};
    let hostnameCounter = 1;

    const macMap = {};
    let macCounter = 1;

    const asnMap = {};

    // 1. Parse Hostnames first (so we can replace references consistently)
    if (hasHostnames) {
      const hostnameLinesRegex = /^\s*(?:hostname|sysName)\s+(\S+)/gim;
      let match;
      while ((match = hostnameLinesRegex.exec(input)) !== null) {
        const originalName = match[1].replace(/[;"'\s]/g, '');
        if (originalName && !hostnameMap[originalName]) {
          hostnameMap[originalName] = `Hostname-${hostnameCounter++}`;
        }
      }
    }

    // Process line-by-line for passwords, snmp, hostnames, bgp, custom patterns
    const lines = text.split('\n');
    const processedLines = lines.map((line, lineIdx) => {
      let l = line;

      // --- Passwords & Secrets ---
      if (hasPasswords) {
        // Cisco/Arista enable, username, neighbor passwords/secrets
        const pwRegexes = [
          { re: /(enable\s+(?:password|secret)\s+(?:[0-9]\s+)?)(\S+)/i, type: 'enable' },
          { re: /(username\s+\S+\s+(?:privilege\s+\d+\s+)?(?:password|secret)\s+(?:[0-9]\s+)?)(\S+)/i, type: 'username' },
          { re: /(\s*password\s+(?:[0-9]\s+)?)(\S+)/i, type: 'general' },
          { re: /(\s*secret\s+(?:[0-9]\s+)?)(\S+)/i, type: 'general' },
          { re: /(\s*key-string\s+(?:[0-9]\s+)?)(\S+)/i, type: 'key-string' },
          { re: /(\s*(?:wpa-psk|pre-shared-key)\s+(?:ascii|hex)?\s*)(\S+)/i, type: 'psk' },
          { re: /(\s*neighbor\s+\S+\s+password\s+(?:[0-9]\s+)?)(\S+)/i, type: 'bgp' },
          { re: /(\s*(?:tacacs|radius)-server\s+(?:host\s+\S+\s+)?key\s+(?:[0-9]\s+)?)(\S+)/i, type: 'aaa' }
        ];

        for (const item of pwRegexes) {
          const match = l.match(item.re);
          if (match) {
            const prefix = match[1];
            const originalVal = match[2];
            const cleanVal = originalVal.replace(/[;"'\s]/g, '');
            if (cleanVal.length > 2 && cleanVal !== '[REDACTED_PASSWORD]') {
              l = l.replace(originalVal, '[REDACTED_PASSWORD]');
              log.push({
                line: lineIdx + 1,
                category: t('config_redactor.cat_password'),
                original: originalVal,
                redacted: '[REDACTED_PASSWORD]'
              });
            }
            break; // Match one password style per line
          }
        }
      }

      // --- SNMP / Credentials ---
      if (hasSnmp) {
        const snmpRegexes = [
          { re: /(\s*snmp-server\s+community\s+)(\S+)/i, replacement: '$1[REDACTED_SNMP]' },
          { re: /(\s*snmp-server\s+host\s+\S+\s+(?:version\s+\S+\s+)?community\s+)(\S+)/i, replacement: '$1[REDACTED_SNMP]' },
          { re: /(\s*snmp-server\s+host\s+\S+\s+)(\S+)(\s+version\s+)/i, replacement: '$1[REDACTED_SNMP]$3' }
        ];

        for (const item of snmpRegexes) {
          const match = l.match(item.re);
          if (match) {
            const originalVal = match[2];
            if (originalVal && originalVal !== '[REDACTED_SNMP]') {
              l = l.replace(originalVal, '[REDACTED_SNMP]');
              log.push({
                line: lineIdx + 1,
                category: t('config_redactor.cat_snmp'),
                original: originalVal,
                redacted: '[REDACTED_SNMP]'
              });
            }
          }
        }

        // Redact SNMPv3 Engine ID
        const engineIdMatch = l.match(/(\bsnmp-server\s+engineID\s+local\s+)([0-9a-fA-F]+)\b/i);
        if (engineIdMatch) {
          const originalVal = engineIdMatch[2];
          l = l.replace(originalVal, '[REDACTED_ENGINE_ID]');
          log.push({
            line: lineIdx + 1,
            category: t('config_redactor.cat_snmp'),
            original: originalVal,
            redacted: '[REDACTED_ENGINE_ID]'
          });
        }

        // Redact SNMPv3 User auth and priv keys
        const snmpv3UserMatch = l.match(/(\bsnmp-server\s+user\s+\S+\s+\S+\s+v3\s+auth\s+\S+\s+)(\S+)(?:\s+priv\s+\S+(?:\s+\d+)?\s+(\S+))?/i);
        if (snmpv3UserMatch) {
          const authKey = snmpv3UserMatch[2];
          const privKey = snmpv3UserMatch[3];
          if (authKey && authKey !== '[REDACTED_SNMP_KEY]') {
            l = l.replace(authKey, '[REDACTED_SNMP_KEY]');
            log.push({
              line: lineIdx + 1,
              category: t('config_redactor.cat_snmp'),
              original: authKey,
              redacted: '[REDACTED_SNMP_KEY]'
            });
          }
          if (privKey && privKey !== '[REDACTED_SNMP_KEY]') {
            l = l.replace(privKey, '[REDACTED_SNMP_KEY]');
            log.push({
              line: lineIdx + 1,
              category: t('config_redactor.cat_snmp'),
              original: privKey,
              redacted: '[REDACTED_SNMP_KEY]'
            });
          }
        }
      }

      // --- SNMP Metadata ---
      if (hasSnmpMetadata) {
        const metadataRegexes = [
          /(\bsnmp-server\s+contact\s+)(.+)/i,
          /(\bsnmp-server\s+location\s+)(.+)/i
        ];
        for (const re of metadataRegexes) {
          const match = l.match(re);
          if (match) {
            const prefix = match[1];
            const originalVal = match[2];
            if (originalVal && originalVal.trim() !== '[REDACTED_SNMP_METADATA]') {
              l = l.replace(originalVal, '[REDACTED_SNMP_METADATA]');
              log.push({
                line: lineIdx + 1,
                category: t('config_redactor.cat_snmp_metadata'),
                original: originalVal,
                redacted: '[REDACTED_SNMP_METADATA]'
              });
            }
          }
        }
      }

      // --- Interface Descriptions ---
      if (hasDesc) {
        const descMatch = l.match(/^(\s*(?:description|remark)\s+)(.+)/i);
        if (descMatch) {
          const prefix = descMatch[1];
          const originalVal = descMatch[2];
          if (originalVal && originalVal.trim() !== '[REDACTED_DESCRIPTION]') {
            l = l.replace(originalVal, '[REDACTED_DESCRIPTION]');
            log.push({
              line: lineIdx + 1,
              category: t('config_redactor.cat_desc'),
              original: originalVal,
              redacted: '[REDACTED_DESCRIPTION]'
            });
          }
        }
      }

      // --- WiFi SSIDs ---
      if (hasWifi) {
        const wifiRegexes = [
          /(\bssid\s+)(["']?[^"'\r\n]+["']?)/i,
          /(\bwlan\s+)(["']?[^"'\r\n]+["']?)/i,
          /(\bwpa-ssid\s+)(["']?[^"'\r\n]+["']?)/i
        ];
        for (const re of wifiRegexes) {
          const match = l.match(re);
          if (match) {
            const prefix = match[1];
            const originalVal = match[2];
            const cleanVal = originalVal.replace(/["']/g, '');
            if (cleanVal && cleanVal !== '[REDACTED_SSID]') {
              l = l.replace(originalVal, '[REDACTED_SSID]');
              log.push({
                line: lineIdx + 1,
                category: t('config_redactor.cat_wifi'),
                original: originalVal,
                redacted: '[REDACTED_SSID]'
              });
            }
          }
        }
      }

      // --- BGP ASNs (Line Processing) ---
      if (hasBgpAsn) {
        const bgpRegexes = [
          /(\brouter\s+bgp\s+)(\d+)\b/i,
          /(\bremote-as\s+)(\d+)\b/i,
          /(\blocal-as\s+)(\d+)(?:\s+no-prepend)?\b/i,
          /(\bautonomous-system\s+)(\d+)\b/i,
          /(\bconfederation\s+identifier\s+)(\d+)\b/i
        ];

        for (const re of bgpRegexes) {
          const match = l.match(re);
          if (match) {
            const prefix = match[1];
            const originalAsn = match[2];
            if (!asnMap[originalAsn]) {
              const asnVal = parseInt(originalAsn, 10);
              if (asnVal >= 64512 && asnVal <= 65535) {
                asnMap[originalAsn] = String(64512 + ((asnVal + sessionSeeds.r1) % 1024));
              } else if (asnVal >= 4200000000 && asnVal <= 4294967294) {
                asnMap[originalAsn] = String(4200000000 + ((asnVal + sessionSeeds.r1) % 94967294));
              } else {
                asnMap[originalAsn] = String(64496 + ((asnVal + sessionSeeds.r2) % 16));
              }
            }
            const fakeAsn = asnMap[originalAsn];
            l = l.replace(new RegExp(prefix + originalAsn, 'i'), prefix + fakeAsn);
            log.push({
              line: lineIdx + 1,
              category: t('config_redactor.cat_bgpasn'),
              original: originalAsn,
              redacted: fakeAsn
            });
          }
        }

        const peerMatch = l.match(/(\bconfederation\s+peers\s+)([\d\s]+)\b/i);
        if (peerMatch) {
          const prefix = peerMatch[1];
          const peerListStr = peerMatch[2];
          const peers = peerListStr.split(/\s+/).filter(Boolean);
          const replacedPeers = peers.map(p => {
            if (!asnMap[p]) {
              const asnVal = parseInt(p, 10);
              if (asnVal >= 64512 && asnVal <= 65535) {
                asnMap[p] = String(64512 + ((asnVal + sessionSeeds.r1) % 1024));
              } else {
                asnMap[p] = String(64496 + ((asnVal + sessionSeeds.r2) % 16));
              }
            }
            return asnMap[p];
          });
          l = l.replace(peerListStr, replacedPeers.join(' '));
          log.push({
            line: lineIdx + 1,
            category: t('config_redactor.cat_bgpasn'),
            original: peerListStr,
            redacted: replacedPeers.join(' ')
          });
        }
      }

      // --- API Keys & Tokens ---
      if (hasApiKeys) {
        // Vendor-prefixed keys: the token itself is the entire match
        const vendorKeyRegexes = [
          // AWS Access Key IDs & STS Temp Keys
          /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
          // Google API Key (AIza + 35 chars)
          /\bAIza[0-9A-Za-z\-_]{35}\b/g,
          // Google OAuth Access Token
          /\bya29\.[0-9A-Za-z\-_]+/g,
          // GitHub PATs (classic, fine-grained, OAuth, user-to-server, server-to-server, refresh)
          /\b(?:ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}|gho_[a-zA-Z0-9]{36}|ghu_[a-zA-Z0-9]{36}|ghs_[a-zA-Z0-9]{36}|ghr_[a-zA-Z0-9]{36})\b/g,
          // GitLab PAT & Trigger Token
          /\b(?:glpat-[0-9a-zA-Z\-]{20,}|glptt-[0-9a-zA-Z\-]{20,})\b/g,
          // Stripe Live/Test Keys
          /\b(?:sk_live_[0-9a-zA-Z]{24}|sk_test_[0-9a-zA-Z]{24}|rk_live_[0-9a-zA-Z]{99})\b/g,
          // Slack Tokens
          /\b(?:xox[pboa]-[0-9]{10,13}-[0-9]{10,13}-[0-9]{10,13}-[a-zA-Z0-9]{24,34})\b/g,
          // SendGrid API Key
          /\bSG\.[a-zA-Z0-9\-_]{22}\.[a-zA-Z0-9\-_]{43}\b/g,
          // Twilio API Key
          /\bSK[0-9a-fA-F]{32}\b/g,
          // Square Access Token & OAuth
          /\b(?:sq0atp-[0-9A-Za-z\-_]{22}|sq0csp-[0-9A-Za-z\-_]{43})\b/g,
          // Mailgun API Key
          /\bkey-[0-9a-zA-Z]{32}\b/g,
          // Mailchimp API Key
          /\b[0-9a-f]{32}-us[0-9]{1,2}\b/g,
          // OpenAI Keys
          /\b(?:sk-proj-[A-Za-z0-9_\-]{48,}|sk-[A-Za-z0-9]{20}T3BlbkFJ[A-Za-z0-9]{20}|sk-svcacct-[A-Za-z0-9_\-]{48,})\b/g,
          // Anthropic (Claude) Key
          /\bsk-ant-[a-zA-Z0-9_\-]{93,}/g,
          // Shopify Tokens
          /\b(?:shpat_[a-fA-F0-9]{32}|shpca_[a-fA-F0-9]{32}|shppa_[a-fA-F0-9]{32})\b/g,
          // Telegram Bot Token
          /\b[0-9]{8,10}:[a-zA-Z0-9_\-]{35}\b/g,
          // Vercel PAT
          /\bvcp_[a-zA-Z0-9]{24}\b/g,
          // DigitalOcean Token
          /\b(?:dop_v1_[a-f0-9]{64}|doo_v1_[a-f0-9]{64})\b/g,
          // Cloudflare API Token
          /\bcf_[a-zA-Z0-9_\-]{30,}/g,
          // Facebook Access Token
          /\bEAACEdEose0cBA[0-9A-Za-z]+/g,
          // xAI (Grok) API Key: xai- followed by long alphanumeric
          /\bxai-[a-zA-Z0-9]{20,}/g,
          // X/Twitter Bearer Token: AAAA-prefix base64 (consumer:secret encoded), 80+ chars
          /\bAAAA[A-Za-z0-9+%\/=]{76,}/g
        ];

        for (const re of vendorKeyRegexes) {
          const rx = new RegExp(re.source, re.flags);
          let m;
          while ((m = rx.exec(l)) !== null) {
            const val = m[0];
            if (val && !val.includes('[REDACTED')) {
              l = l.replace(val, '[REDACTED_API_KEY]');
              log.push({
                line: lineIdx + 1,
                category: t('config_redactor.cat_apikey'),
                original: val,
                redacted: '[REDACTED_API_KEY]'
              });
            }
          }
        }

        // Context-aware patterns: key name followed by its value
        const contextKeyRegexes = [
          // HTTP header style: X-API-Key: *** X-Api-Secret: ***
          { re: /((?:X-)?(?:API|Api|api)[_-]?(?:Key|Secret|Token|Access)[_-]?(?:Key|Secret|Token)?\s*:\s*)([^\s"';,}]{8,})/i },
          // Generic key=value: api_key=*** access_token=*** secret_key=*** etc.
          { re: /((?:api[_-]?key|apikey|access[_-]?token|auth[_-]?token|secret[_-]?key|private[_-]?key|client[_-]?secret|bearer[_-]?token|refresh[_-]?token|consumer[_-]?key|consumer[_-]?secret|x[_-]?api[_-]?key|x[_-]?api[_-]?secret)\s*[=:]\s*["']?\s*)([^\s"';,}]{8,})/i },
          // Authorization: Bearer *** Basic <token>
          { re: /((?:authorization|auth)\s*(?::|=>|=)\s*(?:bearer|basic|token)\s+)([^\s"';,}]{8,})/i },
          // Cisco: 'api key <value>' / 'rest-api key <value>' / 'token <value>'
          { re: /(\s*(?:api\s+key|rest-api\s+key|token)\s+(?:[0-9]\s+)?)(\S+)/i },
          // Env var style: API_KEY=*** BEARER_TOKEN=*** XAI_API_KEY=*** CONSUMER_SECRET=***
          { re: /((?:API_KEY|APIKEY|API_SECRET|SECRET_KEY|ACCESS_TOKEN|AUTH_TOKEN|PRIVATE_KEY|CLIENT_SECRET|BEARER_TOKEN|X_API_KEY|X_API_SECRET|XAI_API_KEY|XAI_API_SECRET|CONSUMER_KEY|CONSUMER_SECRET)\s*=\s*["']?)([^\s"']{8,})/i },
          // JSON/YAML style: "api_key": "***" or api_key: "***"
          { re: /((?:api[_-]?key|api[_-]?secret|access[_-]?token|auth[_-]?token|secret[_-]?key|private[_-]?key|client[_-]?secret|bearer[_-]?token|refresh[_-]?token|consumer[_-]?key|consumer[_-]?secret|x[_-]?api[_-]?key|x[_-]?api[_-]?secret)\s*["']?\s*[:=]\s*["']?\s*)([A-Za-z0-9+/=_\-]{8,})/i },
          // Generic catch-all: any key/token/secret assignment with long hex value (32-64 chars)
          { re: /((?:key|token|secret|api)\S*\s*[=:]\s*["']?)([0-9a-f]{32,64})\b/i },
          // Generic catch-all: any key/token/secret assignment with long base64 value (24+ chars)
          { re: /((?:key|token|secret|api)\S*\s*[=:]\s*["']?)([A-Za-z0-9+/]{24,}={0,2})\b/i }
        ];

        for (const item of contextKeyRegexes) {
          const match = l.match(item.re);
          if (match) {
            const originalVal = match[match.length - 1];
            if (originalVal && !originalVal.includes('[REDACTED')) {
              l = l.replace(originalVal, '[REDACTED_API_KEY]');
              log.push({
                line: lineIdx + 1,
                category: t('config_redactor.cat_apikey'),
                original: originalVal,
                redacted: '[REDACTED_API_KEY]'
              });
            }
          }
        }
      }

      // --- Hostnames (Line definition replacements) ---
      if (hasHostnames) {
        const hostnameLineMatch = l.match(/^\s*(hostname|sysName)\s+(\S+)/i);
        if (hostnameLineMatch) {
          const keyword = hostnameLineMatch[1];
          const originalVal = hostnameLineMatch[2];
          const mapped = hostnameMap[originalVal] || `Hostname-${hostnameCounter++}`;
          hostnameMap[originalVal] = mapped;
          l = l.replace(originalVal, mapped);
          log.push({
            line: lineIdx + 1,
            category: t('config_redactor.cat_hostname'),
            original: `${keyword} ${originalVal}`,
            redacted: `${keyword} ${mapped}`
          });
        }
      }

      // --- Device Serial Numbers ---
      if (hasSerials) {
        const serialRegexes = [
          { re: /(\bchassis\s+serial-number\s+)(\S+)/i },
          { re: /(\bsystem\s+serial-number\s+)(\S+)/i },
          { re: /(\bserial-number\s+)(\S+)/i },
          { re: /(\budi\s+pid\s+\S+\s+sn\s+)(\S+)/i },
          { re: /(\blicense\s+installation-key\s+)(\S+)/i },
          // Common 11-character Cisco/Juniper serial formats starting with typical prefixes (FTX, FOC, JAB, MXS, REF, JPE)
          { re: /\b((?:FTX|FOC|JAB|MXS|REF|JPE)[0-9A-Z]{8})\b/i }
        ];

        for (const item of serialRegexes) {
          const match = l.match(item.re);
          if (match) {
            const originalVal = match[match.length - 1];
            if (originalVal && originalVal !== '[REDACTED_SERIAL]') {
              l = l.replace(originalVal, '[REDACTED_SERIAL]');
              log.push({
                line: lineIdx + 1,
                category: t('config_redactor.cat_serial'),
                original: originalVal,
                redacted: '[REDACTED_SERIAL]'
              });
            }
          }
        }
      }

      return l;
    });

    let processedText = processedLines.join('\n');

    // 2. Global replacements for Hostname references (if mapped)
    if (hasHostnames) {
      Object.keys(hostnameMap).forEach(orig => {
        const fake = hostnameMap[orig];
        // Create regex to match hostname safely avoiding subset of word matches
        const escapedOrig = orig.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedOrig}\\b`, 'g');
        
        // Count occurrences before replacement
        const matches = processedText.match(regex);
        if (matches && matches.length > 0) {
          processedText = processedText.replace(regex, fake);
          // Only log global references once
          log.push({
            line: 'Global',
            category: t('config_redactor.cat_hostname'),
            original: `${orig} (${matches.length} refs)`,
            redacted: fake
          });
        }
      });
    }

    // 3. Obfuscate IP Addresses
    if (hasIPs) {
      // IPv4 Matcher (avoiding octets > 255)
      const ipv4Regex = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
      
      processedText = processedText.replace(ipv4Regex, (matchedIp) => {
        if (isSubnetMask(matchedIp)) return matchedIp; // Skip subnet masks

        if (ipMap[matchedIp]) return ipMap[matchedIp];

        let fakeIp = '';
        if (ipShift) {
          const parts = matchedIp.split('.').map(Number);
          // Detect private ranges
          if (parts[0] === 10) {
            // 10.x.y.z -> Shift x and y using sessionSeeds
            fakeIp = `10.${(parts[1] + sessionSeeds.r1) % 254 + 1}.${(parts[2] + sessionSeeds.r2) % 254 + 1}.${parts[3]}`;
          } else if (parts[0] === 192 && parts[1] === 168) {
            // 192.168.x.y -> Shift x
            fakeIp = `192.168.${(parts[2] + sessionSeeds.r1) % 254 + 1}.${parts[3]}`;
          } else if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
            // 172.16-31.x.y -> Shift 16-31 and x
            const sub = parts[1] - 16;
            fakeIp = `172.${(sub + sessionSeeds.r1) % 16 + 16}.${(parts[2] + sessionSeeds.r2) % 254 + 1}.${parts[3]}`;
          } else {
            // Public range -> Shift first three octets
            fakeIp = `${(parts[0] + sessionSeeds.r1) % 222 + 1}.${(parts[1] + sessionSeeds.r2) % 254 + 1}.${(parts[2] + sessionSeeds.r3) % 254 + 1}.${parts[3]}`;
          }
        } else {
          // Standard mapping: 192.0.2.x (RFC 5737 documentation space)
          fakeIp = `192.0.2.${ipCounter++}`;
        }

        ipMap[matchedIp] = fakeIp;
        log.push({
          line: 'Global',
          category: t('config_redactor.cat_ip'),
          original: matchedIp,
          redacted: fakeIp
        });
        return fakeIp;
      });

      // IPv6 Matcher (simple matching)
      const ipv6Regex = /\b(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:[0-9a-fA-F]{1,4}\b|\b::(?:[0-9a-fA-F]{1,4}:){0,7}[0-9a-fA-F]{1,4}\b|\b(?:[0-9a-fA-F]{1,4}:){1,7}:\b/g;
      
      processedText = processedText.replace(ipv6Regex, (matchedIp) => {
        // Exclude loopback or unspecified addresses
        if (matchedIp === '::' || matchedIp === '::1') return matchedIp;
        if (ipMap[matchedIp]) return ipMap[matchedIp];

        let fakeIp = '';
        if (ipShift) {
          // Add seed shifts for IPv6 segments
          const segments = matchedIp.split(':');
          const obfuscatedSegments = segments.map((seg, idx) => {
            if (!seg) return '';
            const val = parseInt(seg, 16);
            if (isNaN(val)) return seg;
            // Obfuscate non-leading network parts or shift all segments
            return ((val + sessionSeeds.ipv6Seed + idx) % 65535).toString(16);
          });
          fakeIp = obfuscatedSegments.join(':').replace(/:{2,}/g, '::');
        } else {
          fakeIp = `2001:db8::${ipCounter++}`;
        }

        ipMap[matchedIp] = fakeIp;
        log.push({
          line: 'Global',
          category: t('config_redactor.cat_ip'),
          original: matchedIp,
          redacted: fakeIp
        });
        return fakeIp;
      });
    }

    // 4. Obfuscate MAC Addresses
    if (hasMacs) {
      // 00:11:22:aa:bb:cc or 00-11-22-aa-bb-cc or 0011.22aa.bbcc
      const macRegex = /\b(?:[0-9a-fA-F]{2}[:.-]){5}[0-9a-fA-F]{2}\b|\b[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\.[0-9a-fA-F]{4}\b/g;

      processedText = processedText.replace(macRegex, (matchedMac) => {
        if (macMap[matchedMac]) return macMap[matchedMac];

        // Anonymize but preserve delimiter
        let fakeMac = '';
        const seedVal = macCounter++;
        const hex = seedVal.toString(16).padStart(6, '0');
        
        if (matchedMac.includes(':')) {
          fakeMac = `00:e0:fc:${hex.slice(0, 2)}:${hex.slice(2, 4)}:${hex.slice(4, 6)}`;
        } else if (matchedMac.includes('-')) {
          fakeMac = `00-e0-fc-${hex.slice(0, 2)}-${hex.slice(2, 4)}-${hex.slice(4, 6)}`;
        } else {
          fakeMac = `00e0.fc${hex.slice(0, 2)}.${hex.slice(2, 6)}`;
        }

        macMap[matchedMac] = fakeMac;
        log.push({
          line: 'Global',
          category: t('config_redactor.cat_mac'),
          original: matchedMac,
          redacted: fakeMac
        });
        return fakeMac;
      });
    }

    // 5. Redact Delimited Banners (MOTD, Login, etc.)
    if (hasBanners) {
      const bannerRegex = /(banner\s+(?:motd|login|exec|incoming)\s+(\S))([\s\S]+?)(\2)/gi;
      processedText = processedText.replace(bannerRegex, (match, prefix, delimiter, content, closingDelimiter) => {
        if (content.trim() === '[REDACTED_BANNER]') return match;
        log.push({
          line: 'Global',
          category: t('config_redactor.cat_banner'),
          original: `Banner (${content.length} chars)`,
          redacted: `[REDACTED_BANNER]`
        });
        return `${prefix}\n[REDACTED_BANNER]\n${closingDelimiter}`;
      });
    }

    // 6. Custom Search/Replace patterns
    if (customPatterns.trim()) {
      const customLines = customPatterns.split('\n');
      customLines.forEach((patLine, idx) => {
        if (!patLine.trim()) return;

        let pattern;
        let isRegex = false;

        // Check if pattern is a regex e.g. /my-regex/i
        if (patLine.startsWith('/') && patLine.lastIndexOf('/') > 0) {
          const lastSlash = patLine.lastIndexOf('/');
          const expr = patLine.slice(1, lastSlash);
          const flags = patLine.slice(lastSlash + 1);
          try {
            pattern = new RegExp(expr, flags.includes('g') ? flags : flags + 'g');
            isRegex = true;
          } catch {
            pattern = patLine;
          }
        } else {
          pattern = patLine.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
          pattern = new RegExp(pattern, 'g');
        }

        const matches = processedText.match(pattern);
        if (matches && matches.length > 0) {
          processedText = processedText.replace(pattern, '[REDACTED_CUSTOM]');
          log.push({
            line: `Custom #${idx + 1}`,
            category: t('config_redactor.cat_custom'),
            original: isRegex ? patLine : patLine,
            redacted: `[REDACTED_CUSTOM] (${matches.length} matches)`
          });
        }
      });
    }

    return { redactedText: processedText, log };
  }, [input, activeOptions, ipShift, customPatterns, sessionSeeds, t, isSubnetMask]);

  // Download redacted text as file
  const handleDownload = useCallback(() => {
    if (!redactionResult.redactedText) return;
    const blob = new Blob([redactionResult.redactedText], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = t('config_redactor.download_filename');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [redactionResult.redactedText, t]);

  const handleClear = useCallback(() => {
    setInput('');
  }, [setInput]);

  return (
    <div className="fadein">
      <div className="card">
        <h2 className="card-title">{t('tools.config-redactor.title')}</h2>
        <p className="hint">{t('config_redactor.subtitle')}</p>

        <div className="two-col grid-mobile-1" style={{ marginTop: '1.5rem' }}>
          {/* Options Panel */}
          <div>
            <h3 className="card-title" style={{ fontSize: '1.1rem', marginBottom: '1.1rem' }}>
              {t('config_redactor.options_title')}
            </h3>

            <div className="field" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              <MultiSearchableSelect
                activeOptions={activeOptions}
                onChange={setActiveOptions}
                options={availableOptions}
                placeholder={t('config_redactor.opt_search_placeholder')}
                selectLabel={activeOptions.length === 0 ? t('config_redactor.opt_select_redactions') : `${activeOptions.length} options active`}
              />

              {/* Selected Option Badges */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginTop: '0.5rem' }}>
                {activeOptions.map(val => {
                  const opt = availableOptions.find(o => o.value === val);
                  if (!opt) return null;
                  return (
                    <div
                      key={val}
                      title={opt.hint}
                      className="badge badge-cyan"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '0.35rem',
                        padding: '0.25rem 0.5rem',
                        fontSize: '0.8rem',
                        cursor: 'default'
                      }}
                    >
                      <span>{opt.label}</span>
                      <button
                        type="button"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          padding: 0,
                          fontSize: '0.8rem',
                          lineHeight: 1
                        }}
                        onClick={() => setActiveOptions(prev => prev.filter(v => v !== val))}
                      >
                        ×
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Dynamic IP Shift Option */}
              {activeOptions.includes('ips') && (
                <div style={{ marginTop: '0.5rem', paddingLeft: '0.25rem' }}>
                  <label className="label" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={ipShift}
                      onChange={(e) => setIpShift(e.target.checked)}
                    />
                    <div>
                      <div>{t('config_redactor.opt_ip_shift')}</div>
                      <span className="hint">{t('config_redactor.opt_ip_shift_hint')}</span>
                    </div>
                  </label>
                </div>
              )}
            </div>
          </div>

          {/* Custom Patterns Panel */}
          <div>
            <h3 className="card-title" style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>
              {t('config_redactor.custom_patterns_title')}
            </h3>
            <div className="field">
              <span className="hint" style={{ marginBottom: '0.5rem', display: 'block' }}>
                {t('config_redactor.custom_patterns_hint')}
              </span>
              <textarea
                className="input"
                style={{ fontFamily: 'var(--typography-mono)', fontSize: '0.9rem', height: '180px', width: '100%', boxSizing: 'border-box' }}
                placeholder={t('config_redactor.custom_placeholder')}
                value={customPatterns}
                onChange={(e) => setCustomPatterns(e.target.value)}
              />
              <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                {customPresets.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    className="btn btn-sm btn-ghost"
                    style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                    onClick={() => addPreset(p.value)}
                  >
                    + {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Text Areas Input/Output */}
        <div className="two-col grid-mobile-1" style={{ marginTop: '1.5rem' }}>
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span className="label" style={{ fontWeight: 'bold' }}>{t('config_redactor.input_label')}</span>
              {input && (
                <button className="btn btn-sm btn-ghost" onClick={handleClear}>
                  {t('common.clear')}
                </button>
              )}
            </div>
            <textarea
              className="input"
              style={{
                fontFamily: 'var(--typography-mono)',
                fontSize: '0.85rem',
                minHeight: '400px',
                width: '100%',
                boxSizing: 'border-box',
                whiteSpace: 'pre',
                overflowX: 'auto'
              }}
              placeholder={t('config_redactor.input_placeholder')}
              value={input}
              onChange={(e) => setInput(e.target.value)}
            />
          </div>

          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <span className="label" style={{ fontWeight: 'bold' }}>{t('config_redactor.output_label')}</span>
              {redactionResult.redactedText && (
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button className="btn btn-sm" onClick={() => copy(redactionResult.redactedText)}>
                    {copied ? '✓ ' + t('common.copied') : t('config_redactor.btn_copy')}
                  </button>
                  <button className="btn btn-sm btn-primary" onClick={handleDownload}>
                    {t('config_redactor.btn_download')}
                  </button>
                </div>
              )}
            </div>
            <textarea
              className="input"
              style={{
                fontFamily: 'var(--typography-mono)',
                fontSize: '0.85rem',
                minHeight: '400px',
                width: '100%',
                boxSizing: 'border-box',
                whiteSpace: 'pre',
                overflowX: 'auto'
              }}
              readOnly
              placeholder={t('config_redactor.output_placeholder')}
              value={redactionResult.redactedText}
            />
          </div>
        </div>

        {/* Audit Log / Redacted Items Summary */}
        <div style={{ marginTop: '2rem' }}>
          <h3 className="card-title" style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between' }}>
            <span>{t('config_redactor.results_summary')}</span>
            {redactionResult.log.length > 0 && (
              <span className="badge badge-green">
                {t('config_redactor.stats_redacted', { count: redactionResult.log.length })}
              </span>
            )}
          </h3>

          <div style={{ overflowX: 'auto', maxHeight: '300px', border: '1px solid var(--colors-border)', borderRadius: 'var(--spacing-radius)' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--colors-panel)', textAlign: 'left', borderBottom: '1px solid var(--colors-border)' }}>
                  <th style={{ padding: '0.5rem 0.75rem', color: '#888' }}>Line</th>
                  <th style={{ padding: '0.5rem 0.75rem', color: '#888' }}>{t('config_redactor.th_type')}</th>
                  <th style={{ padding: '0.5rem 0.75rem', color: '#888' }}>{t('config_redactor.th_original')}</th>
                  <th style={{ padding: '0.5rem 0.75rem', color: '#888' }}>{t('config_redactor.th_redacted')}</th>
                </tr>
              </thead>
              <tbody>
                {redactionResult.log.length === 0 ? (
                  <tr>
                    <td colSpan="4" style={{ padding: '2rem', textAlign: 'center', color: '#666', fontStyle: 'italic' }}>
                      {t('config_redactor.no_redactions')}
                    </td>
                  </tr>
                ) : (
                  redactionResult.log.map((entry, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #1f1f2e', fontFamily: 'var(--typography-mono)' }}>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#888' }}>{entry.line}</td>
                      <td style={{ padding: '0.5rem 0.75rem' }}>
                        <span className="badge badge-cyan" style={{ fontSize: '0.75rem' }}>
                          {entry.category}
                        </span>
                      </td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#e06c75', wordBreak: 'break-all' }}>{entry.original}</td>
                      <td style={{ padding: '0.5rem 0.75rem', color: '#98c379', wordBreak: 'break-all' }}>{entry.redacted}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  );
}

window.ConfigRedactor = ConfigRedactor;
