---
name: add-tool
description: Use when adding a new tool or reference entry to NetEngKit — covers every file to touch, registration pattern, i18n keys, share URL wiring, and component interface without needing codebase discovery.
---

# Adding a Tool to NetEngKit

## Before You Start: Tool Definition Source

Use the operator’s description as the spec.

---

## Documentation: TOOLS.md (Mandatory)

**You MUST add a TOOLS.md entry for every new tool or reference.** This file (`TOOLS.md`) is the source of truth for tool discoverability and user documentation. Do not skip this step.

### Follow Existing Documentation Patterns

Reference `TOOLS.md` to understand the established documentation style for your tool's category:

1. **Locate your tool's category** — tools are grouped by category (IPv4, IPv6, Multicast, Switching, Routing, Infrastructure, Media, Diagnostics, Education)
2. **Find a similar tool** in that category and note the structure:
   - **ID, Type, Status** — e.g., `ID: subnet | Type: Tool | Offline`
   - **Description** — 1–2 sentences explaining what the tool does
   - **Inputs** — bulleted list (for simple tools) or **Tabs** section (for complex tools)
   - **Outputs** — what results the tool produces, including any export formats
   - **Current Keywords** — space-separated keywords already in `app.jsx` (often `_(none)_` for new tools)
   - **Suggested Keywords to Add** — keywords you plan to add to `app.jsx`

### Adding Your Tool Entry

**Add a new `### Tool Name` section** in the appropriate category group. Follow this template:

```markdown
### My Tool Name
**ID:** `mytool` | **Type:** Tool | **Offline**

**Description:** One or two sentences describing what the tool does and its primary use case.

**Inputs:**
- Input field 1 (format/example)
- Input field 2 (format/example)
- Optional features

**Outputs:**
- Output 1 (unit/format)
- Output 2 (unit/format)
- Export formats if applicable (JSON, CSV, etc.)

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `keyword1 keyword2 keyword3 keyword4`
```

**For complex tools with multiple tabs:**

```markdown
### Complex Tool
**ID:** `complextool` | **Type:** Tool | **Online**

**Description:** Main purpose of the tool...

**Tabs:**

#### Tab 1 Name
**Inputs:**
- ...

**Outputs:**
- ...

#### Tab 2 Name
**Inputs:**
- ...

**Outputs:**
- ...

**Current Keywords:** _(none)_

**Suggested Keywords to Add:** `...`
```

### Keyword Consistency

**The keywords in TOOLS.md must match keywords in `app.jsx` TOOLS array entry.** When you add keywords to app.jsx:
1. Add the exact same space-separated string to `app.jsx` `keywords` field
2. List those keywords as "Current Keywords" in TOOLS.md entry
3. If you discover gaps while documenting, list additional ideas under "Suggested Keywords to Add"

---

## Files to Touch (in order)

| File | What to do |
|------|-----------|
| `TOOLS.md` | **MANDATORY** — Add comprehensive documentation entry for the tool (see "Documentation: TOOLS.md" section above) |
| `components/MyTool.jsx` | Create component, expose as `window.MyTool` |
| `NetEngKit.html` | Add `<script type="text/babel" src="components/MyTool.jsx"></script>` |
| `components/app.jsx` | Add entry to `TOOLS` array (with `keywords` field matching TOOLS.md) + `case` in `renderTool()` switch |
| `languages/en.js` | Add ALL i18n keys (sidebar title + every tool string) |
| `languages/*.js` (14 files) | Only when user requests translation — use `.agents/skills/i18n-fill-sections/` |
| `README.md` | Update features list if the tool category is missing from the features bullet (check existing category coverage) |

Script tag order in the HTML matters: `shared.jsx` first, all tool components next (alphabetical), `app.jsx` last.

---

## Help Modal

The Help modal (`components/HelpModal.jsx`) receives the `TOOLS` array as a prop and renders every entry automatically — **no manual update to HelpModal is needed**. Once the TOOLS array entry is registered in `app.jsx`, the new tool appears in the Tools Directory section automatically, with the correct group heading, TOOL/REF badge, and 🌐 icon.

**One exception — new group:** If the tool's `group` value is not already in the list below, you must add a `help_modal.groups.{group}` key to `languages/en.js`:

```javascript
// existing groups — no action needed
"IPv4" | "IPv6" | "BOTH (IPv4 and IPv6)" | "Multicast" | "Switching" |
"Routing" | "Infrastructure" | "Media" | "Tools" | "Education"

// new group — add to help_modal.groups in en.js
"help_modal": {
  "groups": {
    "MyNewGroup": "My New Group Label"
  }
}
```

The `t('help_modal.groups.{group}', group)` call falls back to the raw group string if the key is missing, so the modal won't break — but the heading will be untranslated.

---

## i18n: Every String Must Be a Translation Key

**ALL user-facing text must be added to `languages/en.js`** — no hardcoded strings in JSX. This includes:

- Sidebar title (in `tools.{id}.title`)
- Every label, button, placeholder, heading, tooltip, error message, and hint in the component
- Tab names, section headers, dropdown options
- Descriptive text, helper text, and footnotes

**In JSX:** `t('mytool.input_label')` — never a raw string like `"Input"`.

**Reuse common keys** where they exist: `t('common.calculate')`, `t('common.results')`, `t('common.copy')`, `t('common.input')`, `t('common.clear')`, `t('common.reset')`, `t('common.export')`, etc.

### When to update other language files

**Only update `languages/en.js` initially.** Do NOT touch the other 14 language files as part of adding a new tool. The app gracefully falls back to English for missing keys.

When the user explicitly asks to translate the new tool into other languages, use the `i18n-fill-sections` skill to synchronize translations across all language files.

### en.js Structure

```javascript
// 1. Sidebar title — in the "tools" object
"tools": {
  "mytool": { "title": "My Tool" }
},

// 2. Tool-specific strings — keyed by tool ID, as a top-level section
"mytool": {
  "input_label": "Input",
  "result_label": "Result",
  "err_invalid": "Invalid input"
}
```

---

## TOOLS Array Registration (`components/app.jsx`)

```javascript
const TOOLS = [
  {
    id: 'mytool',          // lowercase, no spaces — used as i18n key and switch case
    label: 'My Tool',      // display name in sidebar
    group: 'IPv4',         // sidebar category — see valid values below
    type: 'tool',          // 'tool' (utility) or 'ref' (read-only reference)
    online: false,         // true only if requires internet
    keywords: 'keyword1 keyword2 keyword3',  // REQUIRED — for Ctrl+K search
  },
];
```

**Valid groups:** `IPv4`, `IPv6`, `BOTH`, `Multicast`, `Switching`, `Routing`, `Infrastructure`, `Media`, `Tools`, `Education`

### Keywords (Ctrl+K Search Discoverability)

The `keywords` field is **required** for every new tool. The Ctrl+K command palette and sidebar search both match against it. Choose keywords that a network engineer would naturally type to find the tool.

**Rules for good keywords:**
- Include the primary protocol/technology names (e.g., `bgp`, `ospf`, `nat`, `vlan`)
- Include abbreviations and alternate names (e.g., both `dscp` and `qos`)
- Include vendor names if vendor-specific (e.g., `cisco`, `juniper`, `arista`)
- Include synonyms a user might search for (e.g., for subnet calculator: `subnet mask cidr prefix`)
- Include CLI command names if applicable (e.g., `show ip route`, `ntpq`, `tcpdump`)
- Keep to 5–15 words, space-separated, all lowercase

**Examples:**
```javascript
keywords: 'bgp as-path regex filter access-list community'
keywords: 'dns txt spf dkim dmarc email authentication record'
keywords: 'stp spanning-tree root bridge port cost rstp mst priority'
keywords: 'vlan 802.1q qinq tag stack pcp dei decode encode'
keywords: 'poe power budget class watt ieee 802.3af at bt switch'
```

Then add a `case` in `renderTool()`:

```javascript
case 'mytool': return <MyTool initialData={hashData} onShare={handleShare} />;
```

---

## Component Interface

Every tool component must:

```javascript
function MyTool({ initialData, onShare }) {
  const { t } = useTranslation();

  // Restore/persist state across browser navigations
  const [input, setInput] = usePersistentState('mytool:input', initialData?.input ?? '');

  // Wire into share URL system
  useEffect(() => {
    const handle = (e) =>
      (e.detail?.respond ?? onShare)({ tool: 'mytool', input });
    window.addEventListener('app:request-share', handle);
    return () => window.removeEventListener('app:request-share', handle);
  }, [input, onShare]);

  return <div className="fadein">...</div>;
}

window.MyTool = MyTool; // Required — app loads components as globals
```

**Props:**
- `initialData` — parsed state object from URL hash on load, or `null`
- `onShare` — callback; invoke with `{ tool: 'mytool', ...state }`

---

## Share URL State Object

The share URL encodes a plain object as base64 JSON. Put anything the tool needs to restore its state:

```javascript
{ tool: 'mytool', input: '10.0.0.0/8', mode: 'advanced' }
```

The app base64-encodes this into the URL hash automatically when the user clicks Share. Your tool just needs to respond to `app:request-share` with its current state and accept `initialData` on mount.

---

## Consolidated Toolkits: Making Sub-Tools Discoverable

When a tool consolidates several functions behind internal tabs/sub-tabs (e.g. Multicast Toolkit, Cypher Deck, Capture Toolkit, Wireless & RF Planner, Zigbee Toolkit, Format Toolkit, JWT Toolkit), each tab is effectively its own **sub-tool**. The sidebar, sidebar search, Ctrl+K palette, and Help modal all read the flat `TOOLS` array, so without extra wiring those sub-tools are invisible/unsearchable. Add a `subTools` array to surface them in all four surfaces **without un-consolidating** the tool. The rest of this section is the working spec.

### 1. Declare `subTools` on the `TOOLS` entry (`components/app.jsx`)

```javascript
{ id: 'mcast-toolkit', label: 'Multicast Toolkit', group: 'Multicast', type: 'tool',
  keywords: 'multicast igmp mld pim rpf ipv6',   // keep ONLY toolkit-wide terms here
  subTools: [
    { labelKey: 'mcast_toolkit.tabs.reference',     nav: { activeTab: 'reference' } },
    { labelKey: 'mcast_toolkit.sub_tabs.glop',       nav: { activeTab: 'calculators', subTab: 'glop' }, keywords: 'glop 233 as asn rfc3180' },
    { labelKey: 'wifi_rf.tab_channels',              nav: { tab: 'channels' }, keywords: 'channel plan unii 2.4ghz 5ghz 6ghz' }, // note: different toolkit uses `tab`
  ] },
```

Rules:
- **`labelKey` — reuse an EXISTING i18n key.** Point at the key the tool's tab bar already renders (e.g. `mcast_toolkit.sub_tabs.glop`, `wifi_rf.tab_channels`). **Add NO new translation strings** — this keeps all 15 languages in sync automatically. Verify the key exists in `languages/en.js`.
- **`nav` — explicit coords object, merged into the URL-hash state.** The deep-link param key **varies per component**: some read `initialData?.activeTab` / `initialData?.subTab`, others read `initialData?.tab`. Match exactly what the target component reads — `grep "initialData?." components/TheComponent.jsx` to confirm. This is the #1 source of bugs.
- **`keywords` (optional, English-only)** — add synonyms the translated tab label won't match (`33:33`, `solicited-node`, `5ghz`). **Move** sub-specific terms OFF the parent's `keywords` blob onto the relevant sub so each term lives in one place; leave only genuinely toolkit-wide terms on the parent (the parent still appears in results whenever any sub matches).

### 2. The four discovery surfaces are automatic

Once `subTools` exists, the generic plumbing already handles rendering — **no per-tool changes needed here**:
- Sidebar: expand-on-select nested rows (`expandedTool` state); active sub highlighted via `isSubActive(sub)`.
- Sidebar search: `filteredTools` matches when any sub matches via `subMatchesQuery(sub)`.
- Ctrl+K palette: `getSearchResults()` in `components/ShareModal.jsx` pushes a result per matching sub `{ type:'Tool', title, desc, id: parentId, nav: sub.nav }`.
- Help modal: `components/HelpModal.jsx` renders nested sub-rows calling `onNavigate(parentId, sub.nav)`.

### 3. Bidirectional nav sync — REQUIRED for the highlight to track tabs

The sidebar highlight is driven by `hashData`. For it to be correct when you click the parent, reload, or switch tabs *inside* the tool, the toolkit component must sync **both directions**. Without this, sub-rows list but never highlight, and clicking a sidebar sub won't switch an already-mounted tool's tab.

**Reference implementation:** `components/MulticastToolkit.jsx` — copy this shape exactly.

#### Step A — accept `onNav` in the function signature

```javascript
function MyToolkit({ initialData, onShare, onNav }) {
```

#### Step B — declare tab state (unchanged from what you already have)

```javascript
const [activeTab, setActiveTab] = usePersistentState('mytk:activeTab', initialData?.activeTab ?? 'first');
const [subTab, setSubTab]       = usePersistentState('mytk:subTab', initialData?.subTab ?? 'a');
```

#### Step C — apply-down effect (App → component) with anti-loop guard

Fires when `initialData` changes (sidebar click, Ctrl+K, Help modal deep-link on an already-mounted tool).

**IMPORTANT:** `usePersistentState` initialises from the session cache, which may differ from the incoming nav coords. Without the guard, apply-down and report-up fire simultaneously on mount — apply-down sets the new tab while report-up emits the old cached value, which writes it back to `hashData`, which triggers apply-down again → **infinite oscillation**. The `skipNavReport` ref breaks the cycle.

```javascript
const skipNavReport = useRef(false);   // add this near top of component body

useEffect(() => {
  if (initialData?.activeTab && initialData.activeTab !== activeTab) {
    skipNavReport.current = true;
    setActiveTab(initialData.activeTab);
  }
  if (initialData?.subTab && initialData.subTab !== subTab) {
    skipNavReport.current = true;
    setSubTab(initialData.subTab);
  }
}, [initialData]);   // dep = [initialData] ONLY
```

For single-tab toolkits omit the `subTab` block. Adapt the key name (e.g. `initialData?.tab` vs `initialData?.activeTab`) to match the nav key — see the table below.

`useRef` must be destructured from React on line 1. Check: `const { useState, useEffect, useCallback, useRef … } = React;`

#### Step D — report-up effect (component → App)

Fires on mount and on every tab change so the sidebar highlight follows in-app navigation. Checks the flag set by Step C to skip the one stale-cache emission that would otherwise restart the oscillation.

```javascript
useEffect(() => {
  if (skipNavReport.current) { skipNavReport.current = false; return; }
  onNav?.({ activeTab, subTab });   // emit the SAME keys your subTools[].nav uses
}, [activeTab, subTab]);            // dep = tab state vars ONLY — NEVER add initialData
```

#### Critical: nav key ≠ internal variable name (most common bug)

The key in `subTools[].nav` is what `hashData` stores. The `usePersistentState` variable inside the component can be named differently. Map them correctly in **both** effects.

| Toolkit | `subTools` nav key | internal state var | apply-down reads | report-up emits |
|---------|-------------------|-------------------|-----------------|----------------|
| `mcast-toolkit` | `activeTab`, `subTab` | `activeTab`, `subTab` | `initialData?.activeTab` | `{ activeTab, subTab }` |
| `cypher` | `activeTab` | `activeTab` | `initialData?.activeTab` | `{ activeTab }` |
| `wireshark` | `activeTab` | `activeTab` | `initialData?.activeTab` | `{ activeTab }` |
| `jwt` | `activeTab` | `activeTab` | `initialData?.activeTab` | `{ activeTab }` |
| `wifi-rf-planner` | **`tab`** | `activeTab` | `initialData?.tab` | `{ tab: activeTab }` |
| `zigbee-toolkit` | **`tab`** | `activeTab` | `initialData?.tab` | `{ tab: activeTab }` |
| `jsonfmt` | **`tab`** | `tab` (plain useState) | `initialData?.tab` | `{ tab }` |

To find the nav key for a new toolkit: `grep "subTools" components/app.jsx` → look at the `nav:` objects.

To find the internal variable: `grep "usePersistentState\|useState.*activeTab\|useState.*tab" components/TheComponent.jsx`.

#### Only emit keys that appear in `subTools[].nav`

If a toolkit has extra internal state not present in any `nav` object (e.g., `tsharkSubTab` in CaptureTools is internal only), **do not emit it** in the report-up effect.

#### Step E — pass `onNav` in `renderTool()`

```javascript
case 'mytk': return <MyToolkit initialData={hashData} onShare={handleShare} onNav={handleNav} />;
```

`handleNav` is defined in `app.jsx` with value-equality short-circuit (returns same `hashData` reference when no values changed — prevents spurious `initialData` reference churn that would restart the loop):

```javascript
const handleNav = useCallback((nav) => {
  if (!nav) return;
  setHashData(h => {
    const base = h || {};
    if (Object.keys(nav).every(k => base[k] === nav[k])) return base;
    return { ...base, ...nav };
  });
}, []);
```

No other `app.jsx` change is needed.

#### Per-file syntax check

After editing each component file, verify before moving on:
```bash
npx esbuild components/MyToolkit.jsx --loader:.jsx=jsx --outfile=/dev/null
```

### 4. Update TOOLS.md for the existing tool entry — MANDATORY

When adding `subTools` to an **existing** tool (not a brand-new tool), you must update that tool's entry in `TOOLS.md` to accurately reflect the actual tabs. Stale docs are worse than no docs.

**Checklist for each wired toolkit:**
- [ ] `**ID:**` matches the id field in `app.jsx` TOOLS array exactly
- [ ] Each tab has its own `#### Tab Name (\`nav-id\`)` heading — include the nav ID (the value used in `subTools[].nav`) in backtick parens so it's unambiguous
- [ ] Tab inputs/outputs are accurate to the actual component, not aspirational
- [ ] `**Current Keywords:**` reflects the actual `keywords` field in app.jsx (toolkit-level + any sub-level keywords that were moved)
- [ ] Remove "Suggested Keywords to Add" entries that have already been added

**Tab heading format to follow:**

```markdown
#### Tab Display Name (`nav-id`)
```

This makes TOOLS.md the authoritative cross-reference between the user-visible label and the URL-hash nav coordinate.

### 5. Verify

Build (`npm run build:offline`), then confirm: clicking the parent highlights the shown tab; clicking a sub-row switches the inner tab AND highlights; switching tabs inside the tool moves the sidebar highlight; Ctrl+K and Help deep-link to the right sub-tab.

### 5. Sidebar expansion behaviour (already implemented — no code needed)

The sidebar in `components/app.jsx` manages `expandedTool` state. You do **not** need to touch this code when adding a new toolkit's `subTools` — the generic plumbing handles everything:

- **Chevron `▾`/`▴`** appears on every toolkit row (hidden during search). Click it to toggle the sub-list **without** changing the active tool or closing the sidebar.
- **Auto-expand on select:** `expandedTool` is set to `activeTool` automatically via a `useEffect([activeTool])` whenever a toolkit becomes active — from sidebar click, Ctrl+K, Help modal, or URL hash change.
- **Initial load:** `expandedTool` is initialised via a lazy `useState` initializer so the correct toolkit is already open when the page loads from a URL hash or localStorage.
- **Closing:** only the chevron closes the list. Clicking the tool name always expands it. This makes closing explicit and predictable.
- **Sub-rows only show** when `expandedTool === item.id` (or when searching, which overrides expansion state).

---

## Layout & Styling Quick Reference

**Root wrapper:** Use only `<div className="fadein">` — no inline `maxWidth` or `margin`. The app's panel layout handles width automatically.

**Available CSS classes** (defined in `NetEngKit.html` `<style>` block):

| Category | Classes |
|----------|---------|
| Layout | `card`, `card-title`, `two-col`, `three-col`, `fadein` |
| Form | `field`, `label`, `input`, `select`, `hint` |
| Buttons | `btn`, `btn-primary`, `btn-ghost`, `btn-sm`, `btn-danger`, `btn-row` |
| Results | `result-grid`, `result-item`, `result-label`, `result-value` |
| Badges | `badge`, `badge-cyan`, `badge-green`, `badge-yellow`, `badge-red`, `badge-blue`, `badge-purple` |
| Error | `err` |
| Mobile | `grid-mobile-1`, `hide-mobile`, `hide-desktop` |

Responsive breakpoints: `two-col` and `three-col` collapse to single column below 800px.

---

## Available Shared Helpers (from `shared.jsx`)

```javascript
useTranslation()                    // { lang, setLang, t }
usePersistentState(key, default)    // persists inputs/state under a unique key until browser refresh
useCopy()                           // [copied, copy(text, id)]
CopyBtn({ text, label, id })        // translates label via common section
ResultItem({ label, value, copy })  // single result row
Err({ msg })                        // styled error message
exportJSON(data, filename)
exportCSV(rows, filename)
getRFCUrl(rfc)
RFCLink({ rfc, className })
```

React hooks (`useState`, `useEffect`, `useCallback`, `useMemo`, `useRef`) are available globally — no import needed.

---

## Backend / Proxy (optional)

Only needed if the tool makes network requests. The dev proxy (`scripts/proxy.js`) injects `window.LOCAL_PROXY = '/proxy/fetch?url='` into every page response.

```javascript
const base = window.LOCAL_PROXY || '';
const res = await fetch(`${base}${encodeURIComponent('https://api.example.com/data')}`);
```

Existing SSE endpoints (`/api/ping-sweep`, `/api/nmap-run`, `/api/fping-run`) are wired in `proxy.js` and can be reused.

---

## en.js Section Key Naming

The `tools` object uses the tool `id` verbatim (including hyphens), but the tool-specific section uses underscores:

```javascript
// tools object — matches id exactly
"tools": {
  "ssh-config": { "title": "SSH Config Generator" },
  "poe-budget": { "title": "PoE Power Budget" }
},

// tool-specific sections — use underscores as the top-level key
"ssh_config": { "title": "...", "subtitle": "..." },
"poe_budget": { "title": "...", "subtitle": "..." }
```

This is a convention, not a hard rule — just stay consistent with existing tools.

---

## Variable Interpolation in i18n

Use `{varName}` in the en.js value and pass a second argument to `t()`:

```javascript
// en.js
"host_entry": "Host #{n}",

// JSX
t('ssh_config.host_entry', { n: idx + 1 })   // → "Host #1"
```

---

## Protocol/Technical Literals Are Not i18n Violations

SSH directives (`"yes"`, `"no"`, `"VERBOSE"`, `"accept-new"`), CLI flags, and technical placeholders (`"10.0.0.1"`, `"~/.ssh/id_ed25519"`) are protocol syntax — **do not wrap these in `t()`**. Only user-facing labels, buttons, headings, and descriptive text need i18n keys.

---

## TOOLS Array Insertion Point

The TOOLS array is grouped by category (IPv4, IPv6, Tools, Education, etc.). Insert the new entry near other tools in the same `group`, not at the end of the array.

---

## Dynamic Entry Lists (Add/Remove/Reorder)

For tools with variable-length lists of entries (hosts, rules, rows):

```javascript
const DEFAULT_ENTRY = () => ({
  id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2),
  field1: '',
  field2: 'default',
});

const [entries, setEntries] = usePersistentState('mytool:entries', () => {
  if (initialData?.entries?.length) return initialData.entries;
  return [DEFAULT_ENTRY()];
});

const updateEntry = useCallback((id, field, value) => {
  setEntries(prev => prev.map(e => e.id === id ? { ...e, [field]: value } : e));
}, []);

const addEntry = useCallback(() => {
  setEntries(prev => [...prev, DEFAULT_ENTRY()]);
}, []);

const removeEntry = useCallback((id) => {
  setEntries(prev => prev.length <= 1 ? prev : prev.filter(e => e.id !== id));
}, []);
```

---

## Custom File Export (Non-JSON/Non-CSV)

`shared.jsx` provides `exportJSON()` and `exportCSV()`. For plain text or other formats:

```javascript
const blob = new Blob([content + '\n'], { type: 'text/plain' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'filename';
document.body.appendChild(a);
a.click();
document.body.removeChild(a);
URL.revokeObjectURL(url);
```

---

## Common Mistakes

- **Skipping TOOLS.md documentation** — **this is mandatory**. Every new tool must have a documentation entry in TOOLS.md with description, inputs/outputs, and keywords. This is not optional. The tool is incomplete without it.
- **Forgetting `window.MyTool = MyTool`** — the app can't find the component and silently shows nothing.
- **Not restoring `initialData`** — share URLs load the tool but state is blank.
- **Hardcoding strings in JSX** — every label, button, error message, and tooltip must use `t('key')`. No raw English strings.
- **Missing sidebar i18n key** — add `"mytool": { "title": "My Tool" }` to the `tools` object in en.js, not just the tool-specific section.
- **Missing `keywords` in TOOLS entry** — without it the tool is invisible in Ctrl+K search (only matches label and group). Keywords must match between app.jsx and TOOLS.md.
- **Adding i18n keys only to `en.js`** — this is correct behavior. Other languages fall back to English. Only add to other language files when the user explicitly requests translation via the `i18n-fill-sections` skill.
- **Introducing a new group without a Help modal label** — the Tools Directory in the Help modal falls back to the raw group string, so it won't break, but the heading stays in English. If the new `group` value isn't in the existing 10 groups, add `help_modal.groups.{group}` to `en.js`.
- **Babel inline operator precedence** — dev server Babel rejects mixed `??` and `||` without parens; wrap the `||` group: `(a || b) ?? c`. The production esbuild build is unaffected.
- **Keywords in app.jsx don't match TOOLS.md** — when you add a `keywords` field to the TOOLS array entry in app.jsx, copy the exact same space-separated string to the "Current Keywords" field in TOOLS.md. Keep them synchronized.

---

## Build Verification

After all files are in place, run both builds to verify the JSX compiles cleanly:

```bash
node scripts/build/build-dev.js
node scripts/build/bundle.js NetEngKit.html
```

**`build-dev.js`** pre-compiles all JSX via esbuild and writes `NetEngKit-file.html`. A clean exit confirms:
- JSX syntax is valid and esbuild can parse the new component
- No `const` redeclaration of the React destructure line
- The script block regex in `build-dev.js` still matches (HTML structure intact)

**`bundle.js NetEngKit.html`** produces the full offline bundle (`NetEngKit-offline.html`) — the same artifact deployed to GitHub Pages and shipped as a release download. Run this second to confirm the complete production output is clean.

If either errors, fix before declaring the tool done.
