const { useState, useEffect, useCallback, useRef, useMemo } = React;

// ─── Regex Syntax Highlighter ───────────────────────────────
// Tokenizes a regex pattern and returns an array of { text, type } spans
function tokenizeRegex(pattern) {
  const tokens = [];
  let i = 0;
  const len = pattern.length;

  while (i < len) {
    // Escape sequences
    if (pattern[i] === '\\' && i + 1 < len) {
      const next = pattern[i + 1];
      let type = 'escape';
      // Character class shorthand: \d \D \w \W \s \S \b \B \A \Z \z \G \h \H \R \X \N
      if ('dDwWsSbB AZzGhHRXN'.includes(next)) type = 'class';
      // Hex / unicode
      else if (next === 'x' || next === 'u' || next === 'p' || next === 'P') type = 'escape';
      // Octal or backreference \1..\9
      else if (next >= '1' && next <= '9') type = 'backref';
      // Named backref \k<name>
      else if (next === 'k' && i + 2 < len && (pattern[i + 2] === '<' || pattern[i + 2] === "'")) type = 'backref';
      tokens.push({ text: pattern[i] + pattern[i + 1], type });
      i += 2;
      continue;
    }

    // Quantifiers
    if ('*+?'.includes(pattern[i])) {
      tokens.push({ text: pattern[i], type: 'quantifier' });
      i++;
      // Lazy modifier
      if (i < len && pattern[i] === '?') {
        tokens.push({ text: '?', type: 'quantifier' });
        i++;
      }
      continue;
    }

    // Quantifier {n,m}
    if (pattern[i] === '{') {
      let j = i + 1;
      while (j < len && pattern[j] !== '}') j++;
      if (j < len) {
        tokens.push({ text: pattern.substring(i, j + 1), type: 'quantifier' });
        i = j + 1;
        // Lazy modifier
        if (i < len && pattern[i] === '?') {
          tokens.push({ text: '?', type: 'quantifier' });
          i++;
        }
        continue;
      }
    }

    // Groups
    if (pattern[i] === '(') {
      let type = 'group';
      if (i + 1 < len) {
        if (pattern[i + 1] === '?') {
          if (i + 2 < len) {
            const ch = pattern[i + 2];
            if (ch === ':') type = 'group';
            else if (ch === '=' || ch === '!') type = 'lookaround';
            else if (ch === '<') {
              if (i + 3 < len && (pattern[i + 3] === '=' || pattern[i + 3] === '!')) type = 'lookaround';
              else type = 'named-group';
            }
            else if (ch === "'") type = 'named-group';
            else type = 'group';
          }
        }
      }
      tokens.push({ text: '(', type });
      i++;
      continue;
    }
    if (pattern[i] === ')') {
      tokens.push({ text: ')', type: 'group' });
      i++;
      continue;
    }

    // Character class [...]
    if (pattern[i] === '[') {
      let j = i + 1;
      // Handle negation
      if (j < len && pattern[j] === '^') j++;
      // Handle leading ] inside char class
      if (j < len && pattern[j] === ']') j++;
      while (j < len && pattern[j] !== ']') {
        if (pattern[j] === '\\' && j + 1 < len) j += 2; // skip escape
        else j++;
      }
      if (j < len) j++; // include ]
      tokens.push({ text: pattern.substring(i, j), type: 'charset' });
      i = j;
      continue;
    }

    // Anchors
    if (pattern[i] === '^' || pattern[i] === '$') {
      tokens.push({ text: pattern[i], type: 'anchor' });
      i++;
      continue;
    }

    // Dot (any char)
    if (pattern[i] === '.') {
      tokens.push({ text: '.', type: 'meta' });
      i++;
      continue;
    }

    // Pipe (alternation)
    if (pattern[i] === '|') {
      tokens.push({ text: '|', type: 'meta' });
      i++;
      continue;
    }

    // Literal
    tokens.push({ text: pattern[i], type: 'literal' });
    i++;
  }
  return tokens;
}

// Maps token types to CSS class names
const TOKEN_STYLES = {
  escape:      { color: '#f97583' },
  class:       { color: '#79c0ff' },
  backref:     { color: '#d2a8ff' },
  quantifier:  { color: '#ffa657' },
  group:       { color: '#7ee787' },
  lookaround:  { color: '#ff7b72' },
  'named-group': { color: '#7ee787' },
  charset:     { color: '#ffa657' },
  anchor:      { color: '#ff7b72' },
  meta:        { color: '#d2a8ff' },
  literal:     { color: 'var(--text)' },
};

const TOKEN_EXPLANATIONS = {
  escape:        'escape sequence',
  class:         'char class shorthand (\\d \\w \\s…)',
  backref:       'backreference',
  quantifier:    'quantifier (* + ? {n})',
  group:         'capturing group',
  lookaround:    'lookahead / lookbehind',
  'named-group': 'named capturing group',
  charset:       'character set [...]',
  anchor:        'anchor (^ $)',
  meta:          'meta (. or |)',
  literal:       'literal text',
};

function HighlightedRegex({ pattern, hasError }) {
  if (!pattern) return <span style={{ color: 'var(--dim)' }}>&#8203;</span>;
  try {
    const tokens = tokenizeRegex(pattern);
    return (
      <span style={{ fontFamily: 'monospace', fontSize: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {tokens.map((tok, i) => (
          <span key={i} style={TOKEN_STYLES[tok.type] || { color: 'var(--text)' }}>{tok.text}</span>
        ))}
      </span>
    );
  } catch {
    return <span style={{ color: 'var(--text)' }}>{pattern}</span>;
  }
}

// ─── Notepad++ to JS Regex Converter ────────────────────────
// Converts Notepad++ extended / regex replace notation to JS equivalents
function nppToJsFind(pattern, mode) {
  if (mode === 'extended') {
    // Extended mode: handle literal escape sequences
    return pattern
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '\r')
      .replace(/\\t/g, '\t')
      .replace(/\\0/g, '\0');
  }
  // Regex mode: Notepad++ uses mostly standard regex, but some syntax needs mapping
  // Notepad++ uses \R for any line break → (?:\r\n|\r|\n)
  let converted = pattern.replace(/\\R/g, '(?:\\r\\n|\\r|\\n)');
  // \h for horizontal whitespace → [\t ]
  converted = converted.replace(/\\h/g, '[\\t ]');
  // \H for non-horizontal-whitespace → [^\t ]
  converted = converted.replace(/\\H/g, '[^\\t ]');
  return converted;
}

function nppToJsReplace(replacement) {
  // Notepad++ uses $1, $2 etc. for group refs (same as JS)
  // But also supports \1, \2 backslash notation → convert to $N
  let result = replacement
    // Named groups: ${name} is already JS compatible
    // \n backslash notation for groups → $n
    .replace(/\\(\d+)/g, '$$$1')
    // \r, \n, \t literal escapes in replacement
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    // \u \U \l \L Notepad++ case modifiers (simplified)
    // These are complex - we'll note them in the reference
    ;
  return result;
}

// ─── Match Highlighting in Text ──────────────────────────────
function highlightMatches(text, matches) {
  if (!matches || matches.length === 0) return <span>{text}</span>;
  
  // Sort matches by index
  const sorted = [...matches].sort((a, b) => a.index - b.index);
  const parts = [];
  let lastIndex = 0;

  for (const m of sorted) {
    if (m.index > lastIndex) {
      parts.push(<span key={`t-${m.index}`}>{text.slice(lastIndex, m.index)}</span>);
    }
    parts.push(
      <mark key={`m-${m.index}`} className="regex-match-highlight" style={{
        backgroundColor: 'rgba(0, 212, 200, 0.25)',
        borderRadius: 2,
        padding: '0 1px',
        borderBottom: '2px solid var(--cyan, #00d4c8)',
      }}>
        {text.slice(m.index, m.index + m[0].length)}
      </mark>
    );
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(<span key="end">{text.slice(lastIndex)}</span>);
  }
  return <>{parts}</>;
}

// ─── Quick Reference Data ────────────────────────────────────
const REFERENCE_SECTIONS = [
  {
    title_key: 'regex.ref_chars',
    items: [
      ['.', 'regex.ref_any_char'],
      ['\\d', 'regex.ref_digit'],
      ['\\D', 'regex.ref_non_digit'],
      ['\\w', 'regex.ref_word_char'],
      ['\\W', 'regex.ref_non_word_char'],
      ['\\s', 'regex.ref_whitespace'],
      ['\\S', 'regex.ref_non_whitespace'],
      ['\\b', 'regex.ref_word_boundary'],
      ['\\B', 'regex.ref_non_word_boundary'],
      ['\\R', 'regex.ref_line_break'],
      ['\\h', 'regex.ref_horiz_ws'],
      ['\\n', 'regex.ref_newline'],
      ['\\r', 'regex.ref_cr'],
      ['\\t', 'regex.ref_tab'],
    ]
  },
  {
    title_key: 'regex.ref_quantifiers',
    items: [
      ['*', 'regex.ref_zero_more'],
      ['+', 'regex.ref_one_more'],
      ['?', 'regex.ref_zero_one'],
      ['{n}', 'regex.ref_exactly_n'],
      ['{n,}', 'regex.ref_n_more'],
      ['{n,m}', 'regex.ref_n_m'],
      ['*?', 'regex.ref_lazy_zero_more'],
      ['+?', 'regex.ref_lazy_one_more'],
    ]
  },
  {
    title_key: 'regex.ref_groups',
    items: [
      ['(abc)', 'regex.ref_capturing_group'],
      ['(?:abc)', 'regex.ref_non_capturing_group'],
      ['(?<name>abc)', 'regex.ref_named_group'],
      ['(?=abc)', 'regex.ref_pos_lookahead'],
      ['(?!abc)', 'regex.ref_neg_lookahead'],
      ['(?<=abc)', 'regex.ref_pos_lookbehind'],
      ['(?<!abc)', 'regex.ref_neg_lookbehind'],
      ['$1 … $9', 'regex.ref_group_ref'],
      ['${name}', 'regex.ref_named_group_ref'],
    ]
  },
  {
    title_key: 'regex.ref_anchors',
    items: [
      ['^', 'regex.ref_start_line'],
      ['$', 'regex.ref_end_line'],
      ['\\A', 'regex.ref_start_string'],
      ['\\Z', 'regex.ref_end_string'],
    ]
  },
  {
    title_key: 'regex.ref_npp_replace',
    items: [
      ['$1, $2 …', 'regex.ref_group_ref'],
      ['\\r\\n', 'regex.ref_crlf'],
      ['\\n', 'regex.ref_newline'],
      ['\\t', 'regex.ref_tab'],
      ['\\U\\E', 'regex.ref_uppercase'],
      ['\\L\\E', 'regex.ref_lowercase'],
    ]
  },
];

// ─── Preset Library ─────────────────────────────────────────
const REGEX_PRESETS = [
  // Network Addresses
  {
    id: 'ipv4',
    category: 'network',
    label: 'regex.preset_ipv4_label',
    description: 'regex.preset_ipv4_desc',
    find: '\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'ipv4-cidr',
    category: 'network',
    label: 'regex.preset_ipv4_cidr_label',
    description: 'regex.preset_ipv4_cidr_desc',
    find: '\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\/(?:[12]?\\d|3[012])\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'mac-colon',
    category: 'network',
    label: 'regex.preset_mac_colon_label',
    description: 'regex.preset_mac_colon_desc',
    find: '\\b(?:[0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'mac-hyphen',
    category: 'network',
    label: 'regex.preset_mac_hyphen_label',
    description: 'regex.preset_mac_hyphen_desc',
    find: '\\b(?:[0-9a-fA-F]{2}-){5}[0-9a-fA-F]{2}\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'mac-cisco',
    category: 'network',
    label: 'regex.preset_mac_cisco_label',
    description: 'regex.preset_mac_cisco_desc',
    find: '\\b[0-9a-fA-F]{4}\\.[0-9a-fA-F]{4}\\.[0-9a-fA-F]{4}\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'fqdn',
    category: 'network',
    label: 'regex.preset_fqdn_label',
    description: 'regex.preset_fqdn_desc',
    find: '\\b(?:[a-zA-Z0-9](?:[a-zA-Z0-9\\-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,}\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  // Cisco / Nexus
  {
    id: 'iface-short',
    category: 'cisco',
    label: 'regex.preset_iface_short_label',
    description: 'regex.preset_iface_short_desc',
    find: '(?:Gi|Fa|Te|Eth|Po|Lo|Tun|Vlan|mgmt)\\d+(?:\\/\\d+)*',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'iface-long',
    category: 'cisco',
    label: 'regex.preset_iface_long_label',
    description: 'regex.preset_iface_long_desc',
    find: '(?:GigabitEthernet|FastEthernet|TenGigabitEthernet|Ethernet|Port-channel|Loopback|Tunnel|Vlan)\\d+(?:\\/\\d+)*',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'vlan-id',
    category: 'cisco',
    label: 'regex.preset_vlan_id_label',
    description: 'regex.preset_vlan_id_desc',
    find: '\\bvlan\\s+(\\d{1,4})\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: true, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'ip-route',
    category: 'cisco',
    label: 'regex.preset_ip_route_label',
    description: 'regex.preset_ip_route_desc',
    find: '^ip route\\s+(\\S+)\\s+(\\S+)\\s+(\\S+)',
    replace: '',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'bgp-as',
    category: 'cisco',
    label: 'regex.preset_bgp_as_label',
    description: 'regex.preset_bgp_as_desc',
    find: '\\b(?:remote-as|local-as|autonomous-system)\\s+(\\d+)\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: true, dotAll: false },
    sampleInput: '',
  },
  // Logs & Syslog
  {
    id: 'syslog-msg',
    category: 'logs',
    label: 'regex.preset_syslog_msg_label',
    description: 'regex.preset_syslog_msg_desc',
    find: '%([A-Z_]+)-(\\d)-([A-Z_]+):\\s*(.+)',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'iso-timestamp',
    category: 'logs',
    label: 'regex.preset_iso_timestamp_label',
    description: 'regex.preset_iso_timestamp_desc',
    find: '\\d{4}-\\d{2}-\\d{2}[T ]\\d{2}:\\d{2}:\\d{2}(?:\\.\\d+)?(?:Z|[+-]\\d{2}:\\d{2})?',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'log-level',
    category: 'logs',
    label: 'regex.preset_log_level_label',
    description: 'regex.preset_log_level_desc',
    find: '\\b(EMERGENCY|ALERT|CRITICAL|ERROR|WARNING|NOTICE|INFO|DEBUG)\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: true, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'log-ipv4',
    category: 'logs',
    label: 'regex.preset_log_ipv4_label',
    description: 'regex.preset_log_ipv4_desc',
    find: '\\b(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  // Security
  {
    id: 'cve',
    category: 'security',
    label: 'regex.preset_cve_label',
    description: 'regex.preset_cve_desc',
    find: 'CVE-\\d{4}-\\d{4,7}',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'url',
    category: 'security',
    label: 'regex.preset_url_label',
    description: 'regex.preset_url_desc',
    find: 'https?:\\/\\/[^\\s/$.?#][^\\s]*',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'email',
    category: 'security',
    label: 'regex.preset_email_label',
    description: 'regex.preset_email_desc',
    find: '[a-zA-Z0-9._%+\\-]+@[a-zA-Z0-9.\\-]+\\.[a-zA-Z]{2,}',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'hash-sha256',
    category: 'security',
    label: 'regex.preset_hash_sha256_label',
    description: 'regex.preset_hash_sha256_desc',
    find: '\\b[0-9a-fA-F]{64}\\b',
    replace: '',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  // Config Transform
  {
    id: 'iface-spreadsheet',
    category: 'transform',
    label: 'regex.preset_iface_spreadsheet_label',
    description: 'regex.preset_iface_spreadsheet_desc',
    find: '^(\\S+)\\t(.*?)\\t(\\d+)\\t(.+?)\\r?$',
    replace: 'interface $1\\n  description $2\\n  switchport mode access\\n  switchport access vlan $3\\n  $4\\n!',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput: 'Ethernet1/1\tport to server rack-A\t111\tshutdown\nEthernet1/2\tuplink to core-sw-01\t211\tno shutdown\nEthernet1/3\tprinter vlan mgmt\t301\tshutdown',
  },
  {
    id: 'add-prefix-suffix',
    category: 'transform',
    label: 'regex.preset_add_prefix_suffix_label',
    description: 'regex.preset_add_prefix_suffix_desc',
    find: '^(.+)$',
    replace: 'prefix_$1_suffix',
    flags: { global: true, multiline: true, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
  {
    id: 'extract-quoted',
    category: 'transform',
    label: 'regex.preset_extract_quoted_label',
    description: 'regex.preset_extract_quoted_desc',
    find: '"([^"]+)"',
    replace: '$1',
    flags: { global: true, multiline: false, caseInsensitive: false, dotAll: false },
    sampleInput: '',
  },
];

// ─── Main Component ─────────────────────────────────────────
function RegexTool({ onShare, initialData }) {
  const { t } = useTranslation();
  const [inputText, setInputText] = usePersistentState('regex:inputText', initialData?.text ?? '');
  const [findPattern, setFindPattern] = usePersistentState('regex:findPattern', '');
  const [replacePattern, setReplacePattern] = usePersistentState('regex:replacePattern', '');
  const [searchMode, setSearchMode] = usePersistentState('regex:searchMode', 'regex'); // 'regex' | 'extended' | 'normal'
  const [flags, setFlags] = usePersistentState('regex:flags', { global: true, multiline: true, caseInsensitive: false, dotAll: false });
  const [result, setResult] = usePersistentState('regex:result', null);
  const [error, setError] = useState(null);
  const [activeRefTab, setActiveRefTab] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const [showRef, setShowRef] = useState(false);
  const [showPresets, setShowPresets] = useState(true);
  const [activePresetCategory, setActivePresetCategory] = useState('transform');
  const [ifaceStep, setIfaceStep] = useState(null); // null | 'picker' | 'configure'
  const [ifaceVendor, setIfaceVendor] = useState('All');
  const [ifaceType, setIfaceType] = useState('all');
  const [ifaceSelectedTpl, setIfaceSelectedTpl] = useState(null);
  const [ifaceExtraMode, setIfaceExtraMode] = useState('default'); // 'default' | 'more'
  const [ifaceExtraCount, setIfaceExtraCount] = useState(1);
  const [showTsvDrop, setShowTsvDrop] = useState(false);
  const [tsvDragOver, setTsvDragOver] = useState(false);
  const jsonFileRef = useRef(null);
  const tsvFileRef = useRef(null);

  const inputRef = useRef(null);

  const explainedTokens = useMemo(() => {
    try {
      const toks = tokenizeRegex(findPattern);
      const seen = new Set();
      return toks.filter(tok => {
        if (seen.has(tok.type)) return false;
        seen.add(tok.type);
        return true;
      });
    } catch {
      return [];
    }
  }, [findPattern]);

  useEffect(() => {
    if (initialData?.text) setInputText(initialData.text);
  }, [initialData]);

  // Convert Notepad++ case modifiers \U...\E and \L...\E in replacement
  function applyNppCaseModifiers(text, replaced) {
    // Process \U...\E (uppercase) and \L...\E (lowercase) in the replacement string
    let result = '';
    let i = 0;
    let upperUntil = -1;
    let lowerUntil = -1;
    
    while (i < replaced.length) {
      if (i + 1 < replaced.length && replaced[i] === '\\' && replaced[i + 1] === 'U') {
        upperUntil = replaced.indexOf('\\E', i + 2);
        if (upperUntil === -1) upperUntil = replaced.length;
        const segment = replaced.slice(i + 2, upperUntil).toUpperCase();
        result += segment;
        i = upperUntil + 2;
        continue;
      }
      if (i + 1 < replaced.length && replaced[i] === '\\' && replaced[i + 1] === 'L') {
        lowerUntil = replaced.indexOf('\\E', i + 2);
        if (lowerUntil === -1) lowerUntil = replaced.length;
        const segment = replaced.slice(i + 2, lowerUntil).toLowerCase();
        result += segment;
        i = lowerUntil + 2;
        continue;
      }
      result += replaced[i];
      i++;
    }
    return result;
  }

  const performFind = useCallback(() => {
    if (!findPattern) {
      setError(null);
      setResult(null);
      setMatchCount(0);
      return;
    }
    if (!inputText) {
      setError(t('regex.err_no_text', 'Enter text to search in'));
      return;
    }

    try {
      setError(null);
      let jsPattern;
      if (searchMode === 'normal') {
        // Plain text search - escape regex special chars
        jsPattern = findPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      } else if (searchMode === 'extended') {
        jsPattern = nppToJsFind(findPattern, 'extended').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      } else {
        jsPattern = nppToJsFind(findPattern, 'regex');
      }

      let flagStr = '';
      if (flags.global) flagStr += 'g';
      if (flags.multiline) flagStr += 'm';
      if (flags.caseInsensitive) flagStr += 'i';
      if (flags.dotAll) flagStr += 's';

      const regex = new RegExp(jsPattern, flagStr);

      // Find all matches
      const matches = [];
      let match;
      if (flags.global) {
        while ((match = regex.exec(inputText)) !== null) {
          matches.push(match);
          if (match[0].length === 0) regex.lastIndex++; // prevent infinite loop on zero-length matches
        }
      } else {
        match = regex.exec(inputText);
        if (match) matches.push(match);
      }

      setMatchCount(matches.length);

      if (matches.length === 0) {
        setResult({ type: 'find', matches: [], highlighted: inputText });
        return;
      }

      setResult({ type: 'find', matches, highlighted: inputText });
    } catch (e) {
      setError(e.message);
      setResult(null);
      setMatchCount(0);
    }
  }, [findPattern, inputText, searchMode, flags, t]);

  const performReplace = useCallback(() => {
    if (!findPattern) {
      setError(t('regex.err_no_find', 'Enter a find pattern'));
      return;
    }
    if (!inputText) {
      setError(t('regex.err_no_text', 'Enter text to search in'));
      return;
    }

    try {
      setError(null);
      let jsPattern;
      if (searchMode === 'normal') {
        jsPattern = findPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      } else if (searchMode === 'extended') {
        jsPattern = nppToJsFind(findPattern, 'extended').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      } else {
        jsPattern = nppToJsFind(findPattern, 'regex');
      }

      let flagStr = '';
      if (flags.global) flagStr += 'g';
      if (flags.multiline) flagStr += 'm';
      if (flags.caseInsensitive) flagStr += 'i';
      if (flags.dotAll) flagStr += 's';

      const regex = new RegExp(jsPattern, flagStr);

      // Convert replacement pattern (Notepad++ notation → JS)
      let jsReplacement = searchMode === 'normal' ? replacePattern : nppToJsReplace(replacePattern);

      // Perform replacement
      let replaced = inputText.replace(regex, jsReplacement);

      // Apply Notepad++ case modifiers if in regex mode
      if (searchMode === 'regex') {
        replaced = applyNppCaseModifiers(replacePattern, replaced);
      }

      // Count matches in original
      const tempRegex = new RegExp(jsPattern, flagStr.replace('g', '') + (flags.global ? 'g' : ''));
      const allMatches = [];
      let m;
      if (flags.global) {
        while ((m = tempRegex.exec(inputText)) !== null) {
          allMatches.push(m);
          if (m[0].length === 0) tempRegex.lastIndex++;
        }
      } else {
        m = tempRegex.exec(inputText);
        if (m) allMatches.push(m);
      }

      setResult({ type: 'replace', original: inputText, replaced, matchCount: allMatches.length });
      setMatchCount(allMatches.length);
    } catch (e) {
      setError(e.message);
      setResult(null);
      setMatchCount(0);
    }
  }, [findPattern, replacePattern, inputText, searchMode, flags, t]);

  const handleUseResult = useCallback(() => {
    if (result?.type === 'replace' && result.replaced) {
      setInputText(result.replaced);
      setResult(null);
      setMatchCount(0);
    }
  }, [result]);

  const [copied, copy] = useCopy();
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [showTsvMenu, setShowTsvMenu] = useState(false);

  // Whitespace Clean-up Helper states
  const [wsTarget, setWsTarget] = useState('both'); // 'both' | 'spaces' | 'tabs'
  const [wsPosition, setWsPosition] = useState('end'); // 'end' | 'beginning' | 'both'
  const [wsQuantityType, setWsQuantityType] = useState('any'); // 'any' | 'exact' | 'atLeast'
  const [wsQuantityNum, setWsQuantityNum] = useState(1);
  const [showWhitespaceHelper, setShowWhitespaceHelper] = useState(false);

  const generatedWhitespacePattern = useMemo(() => {
    let charSet = '';
    if (wsTarget === 'both') {
      charSet = '[ \\t]';
    } else if (wsTarget === 'spaces') {
      charSet = ' ';
    } else if (wsTarget === 'tabs') {
      charSet = '\\t';
    }

    let qty = '';
    if (wsQuantityType === 'any') {
      qty = '+';
    } else if (wsQuantityType === 'exact') {
      qty = `{${wsQuantityNum}}`;
    } else if (wsQuantityType === 'atLeast') {
      qty = `{${wsQuantityNum},}`;
    }

    if (wsPosition === 'beginning') {
      return '^' + charSet + qty;
    } else if (wsPosition === 'end') {
      return charSet + qty + '$';
    } else {
      return `^${charSet}${qty}|${charSet}${qty}$`;
    }
  }, [wsTarget, wsPosition, wsQuantityType, wsQuantityNum]);

  const loadWhitespaceRegex = useCallback(() => {
    setFindPattern(generatedWhitespacePattern);
    setReplacePattern('');
    setSearchMode('regex');
    setFlags({
      global: true,
      multiline: true,
      caseInsensitive: false,
      dotAll: false,
    });
    setResult(null);
    setError(null);
  }, [generatedWhitespacePattern]);

  const cleanWhitespaceNow = useCallback(() => {
    if (!inputText) {
      setError(t('regex.err_no_text', 'Enter text to search in'));
      return;
    }
    try {
      setError(null);
      const regex = new RegExp(generatedWhitespacePattern, 'gm');
      const replaced = inputText.replace(regex, '');
      
      const countRegex = new RegExp(generatedWhitespacePattern, 'gm');
      let count = 0;
      let m;
      while ((m = countRegex.exec(inputText)) !== null) {
        count++;
        if (m[0].length === 0) countRegex.lastIndex++;
      }
      
      setInputText(replaced);
      setResult({
        type: 'replace',
        original: inputText,
        replaced,
        matchCount: count
      });
      setMatchCount(count);
    } catch (e) {
      setError(e.message);
      setResult(null);
      setMatchCount(0);
    }
  }, [generatedWhitespacePattern, inputText, t]);

  const flagToggles = [
    { key: 'global', label: t('regex.flag_global_label', 'Global (g)'), desc: t('regex.flag_global_desc', 'Find all matches') },
    { key: 'multiline', label: t('regex.flag_multiline_label', 'Multiline (m)'), desc: t('regex.flag_multiline_desc', '^ and $ match line start/end') },
    { key: 'caseInsensitive', label: t('regex.flag_icase_label', 'Case insensitive (i)'), desc: t('regex.flag_icase_desc', 'Ignore case') },
    { key: 'dotAll', label: t('regex.flag_dotall_label', 'DotAll (s)'), desc: t('regex.flag_dotall_desc', 'Dot matches newlines') },
  ];

  const PRESET_CATEGORIES = [
    { id: 'transform', label: t('regex.preset_cat_transform', 'Config Transform') },
    { id: 'network',   label: t('regex.preset_cat_network',   'Network Addresses') },
    { id: 'cisco',     label: t('regex.preset_cat_cisco',     'Cisco / Nexus') },
    { id: 'logs',      label: t('regex.preset_cat_logs',      'Logs & Syslog') },
    { id: 'security',  label: t('regex.preset_cat_security',  'Security') },
  ];

  const normalizeReplace = (s) => s.replace(/\\n/g, '\n').replace(/\\t/g, '\t');

  const applyPreset = useCallback((preset) => {
    if (preset.id === 'iface-spreadsheet') {
      setIfaceStep('picker');
      return;
    }
    setFindPattern(preset.find);
    setReplacePattern(normalizeReplace(preset.replace));
    setFlags(preset.flags);
    setResult(null);
    setError(null);
    if (preset.sampleInput) {
      setInputText(preset.sampleInput);
    }
  }, []);

  function buildTemplateWithExtra(tpl, extraCount) {
    if (extraCount === 0) return tpl;
    const base = tpl.columns.length;
    const extraCols = Array.from({ length: extraCount }, (_, i) => 'GROUP' + (base + i + 1));
    // Append extra tab captures before \r?$ in the find pattern
    const extraCaptures = Array.from({ length: extraCount }, () => '\\t([^\\t\\r]*)').join('');
    const find = tpl.find.replace('\\r?$', extraCaptures + '\\r?$');
    // Detect indentation from the second line of the replace template
    const replLines = tpl.replace.split('\n');
    const indentMatch = replLines.length > 1 ? replLines[1].match(/^(\s+)/) : null;
    const indent = indentMatch ? indentMatch[1] : '  ';
    const extraLines = Array.from({ length: extraCount }, (_, i) => indent + '$' + (base + i + 1)).join('\n');
    // Insert before trailing block terminator if present, otherwise append
    let replace;
    if (tpl.replace.endsWith('\n!')) {
      replace = tpl.replace.slice(0, -2) + '\n' + extraLines + '\n!';
    } else if (tpl.replace.endsWith('\n#')) {
      replace = tpl.replace.slice(0, -2) + '\n' + extraLines + '\n#';
    } else {
      replace = tpl.replace + '\n' + extraLines;
    }
    const sampleInput = tpl.sampleInput.split('\n')
      .map(line => line + '\t' + extraCols.join('\t'))
      .join('\n');
    return { ...tpl, find, replace, sampleInput };
  }

  const applyIfaceTemplate = useCallback(() => {
    if (!ifaceSelectedTpl) return;
    const extraCount = ifaceExtraMode === 'more' ? Math.max(1, Math.min(10, ifaceExtraCount)) : 0;
    const tpl = buildTemplateWithExtra(ifaceSelectedTpl, extraCount);
    setFindPattern(tpl.find);
    setReplacePattern(tpl.replace);
    setFlags(tpl.flags);
    setInputText(tpl.sampleInput);
    setResult(null);
    setError(null);
    setIfaceStep(null);
    setIfaceSelectedTpl(null);
    setIfaceExtraMode('default');
    setIfaceExtraCount(1);
  }, [ifaceSelectedTpl, ifaceExtraMode, ifaceExtraCount]);

  return (
    <div className="tool-content">
      {/* Interfaces from Spreadsheet — step 1: template picker */}
      {ifaceStep === 'picker' && (() => {
        const visibleTemplates = IFACE_TEMPLATES.filter(tpl =>
          (ifaceVendor === 'All' || tpl.vendor === ifaceVendor) &&
          (ifaceType === 'all' || tpl.type === 'any' || tpl.type === ifaceType)
        );
        const TYPE_COLORS = { access: '#52c41a', trunk: '#1890ff', routed: '#fa8c16', any: '#00d4c8' };
        return (
          <div style={{
            position: 'fixed', inset: 0, zIndex: 1000,
            background: 'rgba(0,0,0,0.6)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16,
          }} onClick={() => setIfaceStep(null)}>
            <div style={{
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: 24, maxWidth: 620, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
              maxHeight: '90vh', display: 'flex', flexDirection: 'column',
            }} onClick={e => e.stopPropagation()}>

              {/* Header */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{t('regex.ss_modal_title', 'Interfaces from Spreadsheet')}</div>
                <button onClick={() => setIfaceStep(null)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--dim)', fontSize: 18, padding: '0 4px', lineHeight: 1,
                }}>&#x2715;</button>
              </div>
              <div style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 16 }}>
                {t('regex.ss_modal_subtitle', 'Pick a vendor and port type — sample data is loaded automatically.')}
              </div>

              {/* Vendor tabs */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{t('regex.ss_device', 'Device:')}</span>
                {IFACE_VENDORS.map(v => (
                  <button key={v} onClick={() => setIfaceVendor(v)} style={{
                    background: ifaceVendor === v ? 'rgba(0,212,200,0.15)' : 'var(--bg)',
                    color: ifaceVendor === v ? 'var(--cyan)' : 'var(--dim)',
                    border: ifaceVendor === v ? '1px solid var(--cyan)' : '1px solid var(--border)',
                    borderRadius: 20, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
                    padding: '4px 12px', fontWeight: ifaceVendor === v ? 700 : 400,
                  }}>{v}</button>
                ))}
              </div>

              {/* Type filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginBottom: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)', whiteSpace: 'nowrap' }}>{t('regex.ss_port', 'Port:')}</span>
                {IFACE_TYPES.map(tp => (
                  <button key={tp} onClick={() => setIfaceType(tp)} style={{
                    background: ifaceType === tp ? 'rgba(0,212,200,0.15)' : 'var(--bg)',
                    color: ifaceType === tp ? 'var(--cyan)' : 'var(--dim)',
                    border: ifaceType === tp ? '1px solid var(--cyan)' : '1px solid var(--border)',
                    borderRadius: 20, cursor: 'pointer', fontSize: 11, fontFamily: 'inherit',
                    padding: '4px 12px', fontWeight: ifaceType === tp ? 700 : 400,
                  }}>{t('regex.ss_type_' + tp, tp.charAt(0).toUpperCase() + tp.slice(1))}</button>
                ))}
              </div>

              {/* Template cards */}
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {visibleTemplates.length === 0 ? (
                  <div style={{ color: 'var(--dim)', fontSize: 13, textAlign: 'center', padding: '24px 0' }}>
                    {t('regex.ss_no_match', 'No templates match the selected filters.')}
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 10 }}>
                    {visibleTemplates.map(tpl => (
                      <button key={tpl.id} onClick={() => { setIfaceSelectedTpl(tpl); setIfaceExtraMode('default'); setIfaceExtraCount(1); setIfaceStep('configure'); }} style={{
                        background: 'var(--bg)', border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)', padding: '12px 14px',
                        cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--cyan)'; e.currentTarget.style.background = 'rgba(0,212,200,0.06)'; }}
                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg)'; }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--dim)' }}>{tpl.vendor}</span>
                          <span style={{
                            fontSize: 10, fontWeight: 700, padding: '1px 7px', borderRadius: 20,
                            background: (TYPE_COLORS[tpl.type] || 'var(--cyan)') + '22',
                            color: TYPE_COLORS[tpl.type] || 'var(--cyan)',
                            border: '1px solid ' + (TYPE_COLORS[tpl.type] || 'var(--cyan)') + '55',
                            textTransform: 'uppercase', letterSpacing: '0.04em',
                          }}>{t('regex.ss_type_' + tpl.type, tpl.type)}</span>
                          <span style={{
                            fontSize: 10, fontWeight: 600, padding: '1px 7px', borderRadius: 20,
                            background: 'rgba(255,255,255,0.06)', color: 'var(--dim)',
                            border: '1px solid var(--border)', marginLeft: 'auto',
                          }}>{t('regex.ss_card_columns', '{count} cols', { count: tpl.columns.length })}</span>
                        </div>
                        <div style={{ fontWeight: 600, fontSize: 13, color: 'var(--text)', marginBottom: 5 }}>
                          {t(tpl.label_key, t(tpl.label_key?.replace('regex.spreadsheet.', 'regex.ss_'), tpl.label))}
                        </div>
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                          {tpl.columns.map((col, i) => (
                            <span key={i} style={{
                              fontSize: 10, padding: '1px 6px', borderRadius: 4,
                              background: 'rgba(255,255,255,0.06)', color: 'var(--dim)',
                              border: '1px solid var(--border)',
                            }}>{t('regex.ss_col_' + col.toLowerCase().replace(/[^a-z0-9]/g, '_'), col)}</span>
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ marginTop: 16, display: 'flex', justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setIfaceStep(null)}
                  style={{ fontSize: 12, padding: '6px 16px' }}>
                  {t('regex.ss_cancel', 'Cancel')}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Interfaces from Spreadsheet — step 2: configure extra groups */}
      {ifaceStep === 'configure' && ifaceSelectedTpl && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1001,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }} onClick={() => setIfaceStep('picker')}>
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            padding: 28, maxWidth: 420, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 2 }}>
              {ifaceSelectedTpl.vendor} — {t(ifaceSelectedTpl.label_key, t(ifaceSelectedTpl.label_key?.replace('regex.spreadsheet.', 'regex.ss_'), ifaceSelectedTpl.label))}
            </div>
            <div style={{ color: 'var(--dim)', fontSize: 13, marginBottom: 20 }}>
              {t('regex.ss_setup_subtitle', 'How would you like to set up this template?')}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 14px',
                border: '1px solid ' + (ifaceExtraMode === 'default' ? 'var(--cyan)' : 'var(--border)'),
                borderRadius: 'var(--radius)', cursor: 'pointer',
                background: ifaceExtraMode === 'default' ? 'rgba(0,212,200,0.08)' : 'var(--bg)',
              }}>
                <input type="radio" name="ifaceMode" value="default" checked={ifaceExtraMode === 'default'}
                  onChange={() => setIfaceExtraMode('default')} style={{ marginTop: 2 }} />
                <div>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>
                    {t('regex.ss_setup_default', 'Proceed with defaults ({count} columns)', { count: ifaceSelectedTpl.columns.length })}
                  </div>
                  <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 2 }}>
                    {t('regex.ss_setup_default_desc', '{cols} — loads sample data', {
                      cols: ifaceSelectedTpl.columns.map(c => t('regex.ss_col_' + c.toLowerCase().replace(/[^a-z0-9]/g, '_'), c)).join(', ')
                    })}
                  </div>
                </div>
              </label>

              <label style={{
                display: 'flex', alignItems: 'flex-start', gap: 12,
                padding: '12px 14px',
                border: '1px solid ' + (ifaceExtraMode === 'more' ? 'var(--cyan)' : 'var(--border)'),
                borderRadius: 'var(--radius)', cursor: 'pointer',
                background: ifaceExtraMode === 'more' ? 'rgba(0,212,200,0.08)' : 'var(--bg)',
              }}>
                <input type="radio" name="ifaceMode" value="more" checked={ifaceExtraMode === 'more'}
                  onChange={() => setIfaceExtraMode('more')} style={{ marginTop: 2 }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span>{t('regex.ss_setup_more', 'Add extra capture groups')}</span>
                    <span style={{
                      fontSize: 11, fontWeight: 700, color: 'var(--cyan)',
                      background: 'rgba(0,212,200,0.12)', border: '1px solid rgba(0,212,200,0.3)',
                      borderRadius: 12, padding: '1px 8px', whiteSpace: 'nowrap'
                    }}>
                      {t('regex.ss_setup_total_badge', '{total} cols total', { total: ifaceSelectedTpl.columns.length + ifaceExtraCount })}
                    </span>
                  </div>
                  <div style={{ color: 'var(--dim)', fontSize: 11, marginTop: 2 }}>
                    {t('regex.ss_setup_more_desc', 'Appends extra columns to the sample and replace')}
                  </div>
                  {ifaceExtraMode === 'more' && (
                    <div style={{ marginTop: 12, padding: '10px 12px', background: 'rgba(0,0,0,0.2)', borderRadius: 'var(--radius)', border: '1px solid var(--border)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <label style={{ fontSize: 12, color: 'var(--dim)', flex: 1 }}>{t('regex.ss_setup_more_label', 'How many additional groups?')}</label>
                        <input
                          type="number" min={1} max={10}
                          value={ifaceExtraCount}
                          onChange={e => setIfaceExtraCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                          className="input"
                          style={{ width: 64, fontFamily: 'monospace', fontSize: 13, padding: '4px 8px', textAlign: 'center' }}
                        />
                      </div>
                      <div style={{ marginTop: 8, fontSize: 12, fontWeight: 600, color: 'var(--cyan)', display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span>
                          {t('regex.ss_setup_total_columns', 'Total columns: {total} ({base} base + {extra} extra)', {
                            base: ifaceSelectedTpl.columns.length,
                            extra: ifaceExtraCount,
                            total: ifaceSelectedTpl.columns.length + ifaceExtraCount
                          })}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => setIfaceStep('picker')}
                style={{ fontSize: 12, padding: '6px 16px' }}>
                {t('regex.ss_back', 'Back')}
              </button>
              <button className="btn btn-primary" onClick={applyIfaceTemplate}
                style={{ fontSize: 12, padding: '6px 16px' }}>
                {t('regex.ss_setup_btn', 'Apply')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Presets (collapsible card) */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
             onClick={() => setShowPresets(prev => !prev)}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            {t('regex.presets_title', 'Presets')}
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               style={{ transform: showPresets ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        {showPresets && (
          <div style={{ marginTop: 14 }}>
            {/* Category tabs */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
              {PRESET_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setActivePresetCategory(cat.id)}
                  style={{
                    background: activePresetCategory === cat.id ? 'rgba(0, 212, 200, 0.15)' : 'var(--bg)',
                    color: activePresetCategory === cat.id ? 'var(--cyan)' : 'var(--dim)',
                    border: activePresetCategory === cat.id ? '1px solid var(--cyan)' : '1px solid var(--border)',
                    borderRadius: 20,
                    cursor: 'pointer',
                    fontSize: 11,
                    fontFamily: 'inherit',
                    padding: '5px 14px',
                    fontWeight: activePresetCategory === cat.id ? 700 : 400,
                    transition: 'all 0.15s',
                  }}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            {/* Preset cards */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {REGEX_PRESETS.filter(p => p.category === activePresetCategory).map(p => (
                <div
                  key={p.id}
                  onClick={() => applyPreset(p)}
                  style={{
                    cursor: 'pointer',
                    padding: '10px 14px',
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    minWidth: 180,
                    flex: '1 1 180px',
                    maxWidth: 320,
                    transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--cyan)'}
                  onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}
                >
                  <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
                    {t(p.label, p.id.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}
                  </div>
                  <div style={{ color: 'var(--dim)', fontSize: 11, lineHeight: 1.4 }}>
                    {t(p.description, '')}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Whitespace Clean-up Helper (collapsible card) */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
             onClick={() => setShowWhitespaceHelper(prev => !prev)}>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="card-title" style={{ marginBottom: 2 }}>
              {t('regex.helper_title', 'Whitespace Clean-up Helper')}
            </div>
            <div style={{ color: 'var(--dim)', fontSize: 11 }}>
              {t('regex.helper_desc', 'Configure custom patterns to remove spaces or tabs from lines.')}
            </div>
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               style={{ transform: showWhitespaceHelper ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s', flexShrink: 0 }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        {showWhitespaceHelper && (
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            
            {/* Whitespace Target selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)' }}>
                {t('regex.helper_target_label', 'Whitespace Type')}
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { id: 'both', label: t('regex.helper_target_both', 'Spaces & Tabs') },
                  { id: 'spaces', label: t('regex.helper_target_spaces', 'Spaces Only') },
                  { id: 'tabs', label: t('regex.helper_target_tabs', 'Tabs Only') }
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setWsTarget(opt.id)}
                    style={{
                      background: wsTarget === opt.id ? 'rgba(0, 212, 200, 0.15)' : 'var(--bg)',
                      color: wsTarget === opt.id ? 'var(--cyan)' : 'var(--dim)',
                      border: wsTarget === opt.id ? '1px solid var(--cyan)' : '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontFamily: 'inherit',
                      padding: '5px 12px',
                      fontWeight: wsTarget === opt.id ? 600 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Position selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)' }}>
                {t('regex.helper_pos_label', 'Line Position')}
              </label>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {[
                  { id: 'beginning', label: t('regex.helper_pos_beginning', 'Beginning of Line (Leading)') },
                  { id: 'end', label: t('regex.helper_pos_end', 'End of Line (Trailing)') },
                  { id: 'both', label: t('regex.helper_pos_both', 'Both (Leading & Trailing)') }
                ].map(opt => (
                  <button
                    key={opt.id}
                    onClick={() => setWsPosition(opt.id)}
                    style={{
                      background: wsPosition === opt.id ? 'rgba(0, 212, 200, 0.15)' : 'var(--bg)',
                      color: wsPosition === opt.id ? 'var(--cyan)' : 'var(--dim)',
                      border: wsPosition === opt.id ? '1px solid var(--cyan)' : '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      fontSize: 11,
                      fontFamily: 'inherit',
                      padding: '5px 12px',
                      fontWeight: wsPosition === opt.id ? 600 : 400,
                      transition: 'all 0.15s',
                    }}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Quantity Selection */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: 'var(--dim)' }}>
                {t('regex.helper_qty_label', 'Quantity')}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  {[
                    { id: 'any', label: t('regex.helper_qty_any', 'Any quantity (1 or more)') },
                    { id: 'exact', label: t('regex.helper_qty_exact', 'Exactly') },
                    { id: 'atLeast', label: t('regex.helper_qty_atleast', 'At least') }
                  ].map(opt => (
                    <button
                      key={opt.id}
                      onClick={() => setWsQuantityType(opt.id)}
                      style={{
                        background: wsQuantityType === opt.id ? 'rgba(0, 212, 200, 0.15)' : 'var(--bg)',
                        color: wsQuantityType === opt.id ? 'var(--cyan)' : 'var(--dim)',
                        border: wsQuantityType === opt.id ? '1px solid var(--cyan)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        fontSize: 11,
                        fontFamily: 'inherit',
                        padding: '5px 12px',
                        fontWeight: wsQuantityType === opt.id ? 600 : 400,
                        transition: 'all 0.15s',
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                {(wsQuantityType === 'exact' || wsQuantityType === 'atLeast') && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 11, color: 'var(--dim)' }}>
                      {t('regex.helper_qty_num_label', 'Count (N)')}:
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={wsQuantityNum}
                      onChange={e => setWsQuantityNum(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                      className="input"
                      style={{ width: 60, height: 26, padding: '2px 6px', fontSize: 12, fontFamily: 'monospace' }}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* Generated Pattern Preview */}
            <div style={{
              marginTop: 4,
              padding: '10px 14px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontFamily: 'monospace',
              fontSize: 12,
              lineHeight: 1.4,
            }}>
              <span style={{ color: 'var(--cyan)', fontWeight: 600, marginRight: 8 }}>
                {t('regex.helper_preview_label', 'Generated Pattern:')}
              </span>
              find: <code style={{ color: 'var(--text)', background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: 4, marginRight: 10 }}>/{generatedWhitespacePattern}/gm</code>
              replace: <code style={{ color: 'var(--text)', background: 'rgba(255,255,255,0.04)', padding: '2px 6px', borderRadius: 4 }}>""</code>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
              <button
                className="btn btn-primary"
                onClick={loadWhitespaceRegex}
                style={{
                  background: 'none',
                  border: '1px solid var(--cyan)',
                  color: 'var(--cyan)',
                  fontSize: 12,
                  padding: '6px 16px',
                  cursor: 'pointer',
                  borderRadius: 'var(--radius)',
                  fontWeight: 600,
                  transition: 'all 0.15s',
                }}
                onMouseEnter={e => {
                  e.currentTarget.style.background = 'rgba(0, 212, 200, 0.08)';
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.background = 'none';
                }}
              >
                {t('regex.helper_btn_load', 'Load into Find & Replace')}
              </button>
              <button
                className="btn btn-primary"
                onClick={cleanWhitespaceNow}
                disabled={!inputText}
                style={{
                  background: 'var(--secondary, #22c55e)',
                  border: '1px solid var(--secondary, #22c55e)',
                  color: '#fff',
                  fontSize: 12,
                  padding: '6px 16px',
                  cursor: inputText ? 'pointer' : 'default',
                  borderRadius: 'var(--radius)',
                  fontWeight: 600,
                  transition: 'all 0.15s',
                  opacity: inputText ? 1 : 0.5,
                }}
                onMouseEnter={e => {
                  if (inputText) e.currentTarget.style.background = '#16a34a';
                }}
                onMouseLeave={e => {
                  if (inputText) e.currentTarget.style.background = 'var(--secondary, #22c55e)';
                }}
              >
                {t('regex.helper_btn_clean', 'Clean Text Now')}
              </button>
            </div>
            
          </div>
        )}
      </div>

      {/* TSV drop modal */}
      {showTsvDrop && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 1000,
          background: 'rgba(0,0,0,0.6)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 16,
        }} onClick={() => setShowTsvDrop(false)}>
          <div style={{
            background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 'var(--radius)',
            padding: 28, maxWidth: 440, width: '100%', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 4 }}>{t('regex.tsv_modal_title', 'Load from TSV')}</div>
            <div style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 18 }}>
              {t('regex.tsv_modal_desc', 'Tab-separated values. Commas in fields (e.g. VLAN lists) are preserved as-is.')}
            </div>
            <div
              onDragOver={e => { e.preventDefault(); setTsvDragOver(true); }}
              onDragLeave={() => setTsvDragOver(false)}
              onDrop={e => {
                e.preventDefault();
                setTsvDragOver(false);
                const file = e.dataTransfer.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                  setInputText(ev.target.result);
                  setResult(null);
                  setShowTsvDrop(false);
                };
                reader.readAsText(file);
              }}
              onClick={() => tsvFileRef.current && tsvFileRef.current.click()}
              style={{
                border: '2px dashed ' + (tsvDragOver ? 'var(--cyan)' : 'var(--border)'),
                borderRadius: 'var(--radius)',
                background: tsvDragOver ? 'rgba(0,212,200,0.08)' : 'var(--bg)',
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 32, marginBottom: 10, color: tsvDragOver ? 'var(--cyan)' : 'var(--dim)' }}>
                {tsvDragOver ? '↓' : '↑'}
              </div>
              <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                {tsvDragOver ? 'Drop to load' : 'Drop a TSV file here'}
              </div>
              <div style={{ color: 'var(--dim)', fontSize: 11 }}>or click to browse</div>
            </div>
            <input
              ref={tsvFileRef}
              type="file"
              accept=".tsv,.txt,text/tab-separated-values,text/plain"
              style={{ display: 'none' }}
              onChange={e => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = ev => {
                  setInputText(ev.target.result);
                  setResult(null);
                  setShowTsvDrop(false);
                };
                reader.readAsText(file);
                e.target.value = '';
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn btn-primary" onClick={() => setShowTsvDrop(false)}
                style={{ fontSize: 12, padding: '6px 16px' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Hidden JSON pattern file input */}
      <input
        ref={jsonFileRef}
        type="file"
        accept=".json,application/json"
        style={{ display: 'none' }}
        onChange={e => {
          const file = e.target.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = ev => {
            try {
              const tpl = JSON.parse(ev.target.result);
              if (tpl.find !== undefined) setFindPattern(tpl.find);
              if (tpl.replace !== undefined) setReplacePattern(normalizeReplace(tpl.replace));
              if (tpl.flags) setFlags(f => ({ ...f, ...tpl.flags }));
              if (tpl.searchMode) setSearchMode(tpl.searchMode);
              if (tpl.sampleInput !== undefined) setInputText(tpl.sampleInput);
              setResult(null);
            } catch {}
          };
          reader.readAsText(file);
          e.target.value = '';
        }}
      />

      {/* Input Text */}
      <div className="card fadein">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <div className="card-title" style={{ marginBottom: 0 }}>{t('regex.input_title', 'Input Text')}</div>
          <div style={{ position: 'relative' }}>
            {showTsvMenu && (
              <div style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                onClick={() => setShowTsvMenu(false)} />
            )}
            <button className="btn btn-ghost" onClick={() => setShowTsvMenu(v => !v)}
              style={{ fontSize: 11, padding: '4px 12px', position: 'relative', zIndex: 100 }}>
              Export &#x25BE;
            </button>
            {showTsvMenu && (
              <div style={{
                position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 100,
                background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                minWidth: 170, overflow: 'hidden',
              }}>
                {[
                  { label: 'Copy to clipboard', disabled: !inputText, action: () => { copy(inputText); setShowTsvMenu(false); } },
                  { label: 'Export as TSV', disabled: !inputText, action: () => {
                    const blob = new Blob([inputText], { type: 'text/tab-separated-values' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'interfaces.tsv'; a.click();
                    URL.revokeObjectURL(url);
                    setShowTsvMenu(false);
                  }},
                  { label: 'Load from TSV', disabled: false, action: () => { setShowTsvDrop(true); setTsvDragOver(false); setShowTsvMenu(false); } },
                  { divider: true },
                  { label: 'Save pattern (.json)', disabled: !findPattern, action: () => {
                    const tpl = JSON.stringify({ find: findPattern, replace: replacePattern, flags, searchMode, sampleInput: inputText }, null, 2);
                    const blob = new Blob([tpl], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'pattern.json'; a.click();
                    URL.revokeObjectURL(url);
                    setShowTsvMenu(false);
                  }},
                  { label: 'Load pattern (.json)', disabled: false, action: () => { jsonFileRef.current && jsonFileRef.current.click(); setShowTsvMenu(false); } },
                ].map(item => item.divider
                  ? <div key="divider" style={{ height: 1, background: 'var(--border)', margin: '2px 0' }} />
                  : (
                  <button key={item.label} onClick={item.disabled ? undefined : item.action} style={{
                    display: 'block', width: '100%', textAlign: 'left',
                    padding: '9px 14px', fontSize: 12, fontFamily: 'inherit',
                    background: 'none', border: 'none', cursor: item.disabled ? 'default' : 'pointer',
                    color: item.disabled ? 'var(--dim)' : 'var(--text)',
                    borderBottom: '1px solid var(--border)',
                    opacity: item.disabled ? 0.5 : 1,
                  }}
                    onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = 'rgba(0,212,200,0.08)'; }}
                    onMouseLeave={e => e.currentTarget.style.background = 'none'}
                  >{item.label}</button>
                ))}
              </div>
            )}
          </div>
        </div>
        <textarea
          ref={inputRef}
          className="input"
          rows={10}
          placeholder={t('regex.input_placeholder', 'Paste or type text here…')}
          value={inputText}
          onChange={e => { setInputText(e.target.value); setResult(null); }}
          onKeyDown={e => {
            if (e.key === 'Tab') {
              e.preventDefault();
              const el = e.target;
              const start = el.selectionStart;
              const end = el.selectionEnd;
              const next = inputText.substring(0, start) + '\t' + inputText.substring(end);
              setInputText(next);
              setResult(null);
              requestAnimationFrame(() => {
                el.selectionStart = el.selectionEnd = start + 1;
              });
            }
          }}
          style={{ fontFamily: 'monospace', resize: 'vertical', width: '100%', fontSize: 13, lineHeight: 1.5 }}
        />
      </div>

      {/* Find & Replace */}
      <div className="card fadein">
        <div className="card-title">{t('regex.find_replace_title', 'Find & Replace')}</div>

        {/* Search Mode */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
          {[
            { id: 'regex', label: t('regex.mode_regex', 'Regular Expression') },
            { id: 'extended', label: t('regex.mode_extended', 'Extended (\\n, \\r, \\t)') },
            { id: 'normal', label: t('regex.mode_normal', 'Normal (Plain Text)') },
          ].map(mode => (
            <button key={mode.id} onClick={() => { setSearchMode(mode.id); setResult(null); }} style={{
              background: searchMode === mode.id ? 'var(--cyan)' : 'var(--bg)',
              color: searchMode === mode.id ? 'var(--btn-text)' : 'var(--dim)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              fontSize: 11,
              fontFamily: 'inherit',
              padding: '5px 12px',
              fontWeight: searchMode === mode.id ? 700 : 400,
              transition: 'all 0.15s',
            }}>
              {mode.label}
            </button>
          ))}
        </div>

        {/* Find Pattern with Syntax Highlighting */}
        <div style={{ marginBottom: 10 }}>
          <label className="label">{t('regex.find_label', 'Find')}</label>
          <div style={{ position: 'relative', background: 'var(--panel)', borderRadius: 'var(--radius)' }}>
            {/* Highlighting overlay */}
            <div style={{
              position: 'absolute',
              top: 0, left: 0, right: 0, bottom: 0,
              padding: '8px 12px',
              fontFamily: 'monospace',
              fontSize: 14,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              pointerEvents: 'none',
              color: 'transparent',
              overflow: 'hidden',
            }}>
              {searchMode === 'regex' ? (
                <HighlightedRegex pattern={findPattern} hasError={!!error} />
              ) : (
                <span style={{ color: 'transparent' }}>{findPattern || '\u00A0'}</span>
              )}
            </div>
            <input
              className="input"
              placeholder={searchMode === 'regex'
                ? t('regex.find_placeholder_regex', 'Regular expression pattern…')
                : searchMode === 'extended'
                  ? t('regex.find_placeholder_ext', 'Extended search (\\n, \\r, \\t)…')
                  : t('regex.find_placeholder_plain', 'Plain text to find…')
              }
              value={findPattern}
              onChange={e => { setFindPattern(e.target.value); setResult(null); setError(null); }}
              style={{
                fontFamily: 'monospace',
                fontSize: 14,
                padding: '8px 12px',
                background: 'transparent',
                caretColor: 'var(--cyan, #00d4c8)',
                color: searchMode === 'regex' ? 'transparent' : 'var(--text)',
                position: 'relative',
                zIndex: 1,
              }}
              spellCheck={false}
              autoComplete="off"
            />
          </div>
          {/* Syntax highlighted preview below the input (always visible in regex mode) */}
          {searchMode === 'regex' && findPattern && (
            <div style={{
              marginTop: 6,
              padding: '6px 10px',
              background: 'var(--bg)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              fontSize: 13,
              overflow: 'auto',
              maxHeight: 60,
            }}>
              <span style={{ fontSize: 10, color: 'var(--dim)', marginRight: 8 }}>{t('regex.preview', 'PREVIEW:')}</span>
              <HighlightedRegex pattern={findPattern} hasError={!!error} />
            </div>
          )}
        </div>

        {/* Replace Pattern */}
        <div style={{ marginBottom: 14 }}>
          <label className="label">{t('regex.replace_label', 'Replace with')}</label>
          <textarea
            className="input"
            placeholder={searchMode === 'regex'
              ? t('regex.replace_placeholder_regex', 'Replacement ($1, \\t…) — press Enter for newline…')
              : t('regex.replace_placeholder', 'Replacement text…')
            }
            value={replacePattern}
            onChange={e => { setReplacePattern(e.target.value); setResult(null); }}
            style={{ fontFamily: 'monospace', fontSize: 13, resize: 'vertical', minHeight: 110, lineHeight: 1.5 }}
            spellCheck={false}
            autoComplete="off"
            rows={5}
          />
        </div>

        {/* Pattern Explainer */}
        {searchMode === 'regex' && findPattern.length > 0 && !error && explainedTokens.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, color: 'var(--dim)', marginBottom: 6 }}>
              {t('regex.explainer_title', 'Pattern contains')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {explainedTokens.map(tok => {
                const color = (TOKEN_STYLES[tok.type] || { color: 'var(--text)' }).color;
                const isHex = color.startsWith('#');
                return (
                  <span key={tok.type} style={{
                    background: isHex ? color + '26' : 'rgba(128,128,128,0.12)',
                    border: '1px solid ' + (isHex ? color + '4d' : 'var(--border)'),
                    color,
                    borderRadius: 4,
                    padding: '2px 6px',
                    fontSize: 11,
                  }}>
                    {TOKEN_EXPLANATIONS[tok.type] || tok.type}
                  </span>
                );
              })}
            </div>
          </div>
        )}

        {/* Flags */}
        <div style={{ marginBottom: 14 }}>
          <label className="label">{t('regex.flags_label', 'Flags')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {flagToggles.map(f => (
              <button
                key={f.key}
                onClick={() => setFlags(prev => ({ ...prev, [f.key]: !prev[f.key] }))}
                title={f.desc}
                style={{
                  background: flags[f.key] ? 'rgba(0, 212, 200, 0.15)' : 'var(--bg)',
                  color: flags[f.key] ? 'var(--cyan)' : 'var(--dim)',
                  border: flags[f.key] ? '1px solid var(--cyan)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'monospace',
                  padding: '4px 10px',
                  fontWeight: flags[f.key] ? 600 : 400,
                  transition: 'all 0.15s',
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-primary" onClick={performFind} disabled={!findPattern || !inputText}>
            {t('regex.find_btn', 'Find All')}
          </button>
          <button className="btn btn-primary" onClick={performReplace} disabled={!findPattern || !inputText}>
            {t('regex.replace_btn', 'Replace')}
          </button>
        </div>

        {/* Error */}
        <Err msg={error} />

        {/* Match count */}
        {matchCount > 0 && !error && (
          <div style={{
            marginTop: 10, padding: '8px 14px', borderRadius: 'var(--radius)',
            background: 'rgba(0, 212, 200, 0.08)', border: '1px solid rgba(0, 212, 200, 0.2)',
            fontSize: 13, fontWeight: 600, color: 'var(--cyan)',
          }}>
            {t('regex.match_count', '{{count}} match(es) found').replace('{{count}}', matchCount)}
          </div>
        )}
        {matchCount === 0 && findPattern && inputText && result && !error && (
          <div style={{
            marginTop: 10, padding: '8px 14px', borderRadius: 'var(--radius)',
            background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)',
            fontSize: 13, fontWeight: 600, color: 'var(--error, #ef4444)',
          }}>
            {t('regex.no_matches', 'No matches found')}
          </div>
        )}
      </div>

      {/* Results */}
      {result && result.type === 'find' && result.matches.length > 0 && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {t('regex.matches_title', 'Highlighted Matches')}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <CopyBtn text={result.matches.map((m, i) => `#${i + 1}: "${m[0]}" (index ${m.index})`).join('\n')} id="matches" />
            </div>
          </div>
          <pre style={{
            fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6,
            padding: 14, background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', overflow: 'auto', maxHeight: 400,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
          }}>
            {highlightMatches(inputText, result.matches)}
          </pre>

          {/* Match list */}
          <div style={{ marginTop: 10 }}>
            <div className="card-title">{t('regex.match_list_title', 'Match Details')}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 200, overflow: 'auto' }}>
              {result.matches.map((m, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: 10,
                  padding: '6px 10px', background: 'var(--bg)',
                  border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                  fontSize: 12, fontFamily: 'monospace',
                }}>
                  <span style={{ color: 'var(--cyan)', fontWeight: 700, minWidth: 30 }}>#{i + 1}</span>
                  <span style={{ color: 'var(--dim)' }}>idx:{m.index}</span>
                  <span style={{ color: 'var(--text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    "{m[0]}"
                  </span>
                  {m.length > 1 && (
                    <span style={{ color: 'var(--dim)', fontSize: 11 }}>
                      groups: {m.slice(1).map((g, gi) => `$${gi + 1}="${g ?? ''}"`).join(', ')}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {result && result.type === 'replace' && (
        <div className="card fadein">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <div className="card-title" style={{ marginBottom: 0 }}>
              {t('regex.replace_result_title', 'Replace Result')}
              <span style={{ fontSize: 12, fontWeight: 400, marginLeft: 8, color: 'var(--dim)' }}>
                ({result.matchCount} {t('regex.replacements', 'replacement(s)')})
              </span>
            </div>
            <div style={{ position: 'relative' }}>
              {showExportMenu && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 99 }}
                  onClick={() => setShowExportMenu(false)} />
              )}
              <button className="btn btn-ghost" onClick={() => setShowExportMenu(v => !v)}
                style={{ fontSize: 11, padding: '5px 12px', position: 'relative', zIndex: 100 }}>
                Export &#x25BE;
              </button>
              {showExportMenu && (
                <div style={{
                  position: 'absolute', right: 0, top: 'calc(100% + 4px)', zIndex: 100,
                  background: 'var(--card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                  minWidth: 160, overflow: 'hidden',
                }}>
                  {[
                    { label: t('regex.export_copy', 'Copy to clipboard'), action: () => { copy(result.replaced); setShowExportMenu(false); } },
                    { label: t('regex.export_use_input', 'Use as Input'), action: () => { handleUseResult(); setShowExportMenu(false); } },
                    { label: t('regex.export_txt', 'Export to .txt'), action: () => {
                      const blob = new Blob([result.replaced], { type: 'text/plain' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = 'result.txt'; a.click();
                      URL.revokeObjectURL(url);
                      setShowExportMenu(false);
                    }},
                  ].map(item => (
                    <button key={item.label} onClick={item.action} style={{
                      display: 'block', width: '100%', textAlign: 'left',
                      padding: '9px 14px', fontSize: 12, fontFamily: 'inherit',
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: 'var(--text)', borderBottom: '1px solid var(--border)',
                    }}
                      onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,212,200,0.08)'}
                      onMouseLeave={e => e.currentTarget.style.background = 'none'}
                    >{item.label}</button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <pre style={{
            fontFamily: 'monospace', fontSize: 13, lineHeight: 1.6,
            padding: 14, background: 'var(--bg)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius)', overflow: 'auto', maxHeight: 400,
            whiteSpace: 'pre-wrap', wordBreak: 'break-all', margin: 0,
            color: 'var(--text)',
          }}>
            {result.replaced}
          </pre>

          {/* Diff view: show removed/added */}
          {result.original !== result.replaced && (
            <div style={{ marginTop: 12 }}>
              <div className="card-title">{t('regex.diff_title', 'Changes')}</div>
              <div style={{
                display: 'flex', gap: 8, fontSize: 11, fontFamily: 'monospace',
                padding: '8px 12px', background: 'var(--bg)',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                maxHeight: 200, overflow: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
              }}>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--error, #ef4444)', fontWeight: 700, marginBottom: 4 }}>
                    {t('regex.before', 'Before')}
                  </div>
                  <div style={{ color: 'var(--dim)' }}>{result.original}</div>
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ color: 'var(--success, #22c55e)', fontWeight: 700, marginBottom: 4 }}>
                    {t('regex.after', 'After')}
                  </div>
                  <div>{result.replaced}</div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quick Reference */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
             onClick={() => setShowRef(prev => !prev)}>
          <div className="card-title" style={{ marginBottom: 0 }}>
            {t('regex.reference_title', 'Regex Quick Reference (Notepad++ Style)')}
          </div>
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
               style={{ transform: showRef ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>

        {showRef && (
          <div style={{ marginTop: 14 }}>
            {/* Reference tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 10, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
              {REFERENCE_SECTIONS.map((section, i) => (
                <button key={i} onClick={() => setActiveRefTab(i)} style={{
                  background: activeRefTab === i ? 'var(--card)' : 'transparent',
                  border: '1px solid var(--border)',
                  borderBottom: activeRefTab === i ? '1px solid var(--card)' : '1px solid var(--border)',
                  borderRadius: 'var(--radius) var(--radius) 0 0',
                  color: activeRefTab === i ? 'var(--text)' : 'var(--dim)',
                  cursor: 'pointer',
                  fontSize: 11,
                  fontFamily: 'inherit',
                  padding: '6px 12px',
                  marginBottom: -1,
                  fontWeight: activeRefTab === i ? 600 : 400,
                }}>
                  {t(section.title_key, section.title_key.split('.').pop().replace('ref_', ''))}
                </button>
              ))}
            </div>

            {/* Reference content */}
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 4,
            }}>
              {REFERENCE_SECTIONS[activeRefTab].items.map(([syntax, desc], i) => (
                <div key={i} style={{
                  display: 'flex', gap: 10, padding: '6px 10px',
                  borderRadius: 'var(--radius)',
                  fontSize: 12,
                  alignItems: 'baseline',
                }}>
                  <code style={{
                    fontFamily: 'monospace', fontWeight: 700, color: 'var(--cyan)',
                    minWidth: 70, flexShrink: 0, fontSize: 12,
                  }}>{syntax}</code>
                  <span style={{ color: 'var(--dim)' }}>{desc}</span>
                </div>
              ))}
            </div>

            {/* Notepad++ specific notes */}
            {activeRefTab === REFERENCE_SECTIONS.length - 1 && (
              <div style={{
                marginTop: 12, padding: '10px 14px',
                background: 'rgba(0, 212, 200, 0.06)',
                border: '1px solid rgba(0, 212, 200, 0.15)',
                borderRadius: 'var(--radius)',
                fontSize: 12, lineHeight: 1.6, color: 'var(--dim)',
              }}>
                <strong style={{ color: 'var(--cyan)' }}>Notepad++ Note:</strong>{' '}
                {t('regex.npp_note', 'Notepad++ uses PCRE (Perl Compatible Regular Expressions). This tool converts Notepad++ patterns to JavaScript regex. Most features are supported including \\R (any line break), \\h (horizontal whitespace), named groups, lookaround assertions, and case modifiers \\U/\\L/\\E in replacements.')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Syntax Highlighting Legend */}
      {searchMode === 'regex' && (
        <div className="card">
          <div className="card-title">{t('regex.syntax_legend_title', 'Syntax Highlighting Legend')}</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {Object.entries(TOKEN_STYLES).map(([type, style]) => {
              if (type === 'literal') return null;
              return (
                <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                  <span style={{
                    ...style, fontFamily: 'monospace', fontWeight: 700,
                    padding: '2px 8px', borderRadius: 4,
                    background: 'var(--bg)', border: '1px solid var(--border)',
                  }}>
                    {type}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

window.RegexTool = RegexTool;
