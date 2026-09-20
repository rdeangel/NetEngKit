---
name: i18n-fill-sections
description: Fill missing i18n sections in a partial language file, prune stale keys that were removed from en.js, fix untranslated/empty values in existing keys, or detect keys that are still in English across ALL language files simultaneously. Use when a language file has fewer sections than en.js, when adding a new language, when keys have been deleted from en.js, when sidebar menu titles or other tool keys are empty or still in English, or when you suspect a bulk injection left English values across every language.
type: flexible
---

# i18n Fill Missing Sections

## Script location

```
.agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py
```
`languages.json` sits next to the script. No dependencies beyond Python 3 stdlib. Portable to any project using the same `TRANSLATIONS["xx"] = { ... };` JS file structure.

---

## Five commands

### `info` — see what's missing, stale, or untranslated
```bash
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py info --lang hi
```
Lists:
- Every **missing section** with its line count.
- Any **stale keys** (keys present in the language file that have been removed from en.js).
- Any **orphan sections** (sections removed from en.js entirely).
- **Likely untranslated keys**: keys that exist in the target file but whose values exactly match the English source (ignoring short abbreviations like IP, MAC, etc.).

### `extract` — pull sections out for translation
```bash
# All missing sections at once
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py extract --lang hi

# First 5 sections only (control token consumption)
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py extract --lang hi --count 5

# Specific sections by name
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py extract --lang ko --section vlsm --section dhcp
```
Always writes to `to_translate.json`. Never use `--output` — custom file names
break the predictable cleanup contract (see "Temporary file hygiene" below).
Prints how many sections remain after this batch.

### `inject` — write translated sections back
```bash
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py inject --lang hi --cleanup
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py inject --lang all --cleanup
```
Validates the JSON, skips any sections already present, appends the rest to the
language file before the closing `};`. Reports how many sections still remain.
Always pass `--cleanup` — it deletes `to_translate.json` after successful injection.

### `prune` — remove stale keys or entire orphan sections deleted from en.js
```bash
# Preview what would be removed (no changes written)
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py prune --lang de --dry-run

# Prune a single language
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py prune --lang de

# Prune all non-English languages at once
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py prune --lang all
```
Handles two cases in a single pass:
- **Stale keys** — individual keys within a section that were removed from en.js
- **Orphan sections** — entire sections that no longer exist in en.js at all

`info` will report both before you prune. Always run `--dry-run` first to verify.

### `audit` — find keys that are still English across ALL languages
```bash
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py audit
```
Scans every non-English language file simultaneously. Reports keys whose values are
**identical to the English source in every single language** — the clearest sign of a
bulk injection that was never translated. Unlike `info --lang all` (which checks one
language at a time), `audit` surfaces keys that individual per-language checks would
each flag but that are easy to miss at scale.

Output shows the affected section + key paths. The command also prints the exact
`sync-force` command needed to fix each section.

**When to use:**
- After any bulk `sync-inject` or `sync-force-inject` run
- When you suspect a new tool's keys landed in English across all languages
- As a final cross-check before closing an i18n task

---

## Systematic audit checklist (run after adding any new tool)

The script's `info` and `sync` commands only catch **missing sections** and **missing keys**. They do NOT catch keys that exist but have **empty string values** (`""`) or values still in **English** — both of which silently break the UI. Always run all four checks below.

### Step 1 — Whole-section check
```bash
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py info --lang all
```
Expected: `87/87 present, 0 missing` for every language. If any are short, run the extract/inject workflow for those languages.

### Step 2 — Missing keys within existing sections
```bash
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync --lang all
```
Expected: `All languages are in sync — nothing to extract.` If keys are listed, translate and `sync-inject`.

### Step 3 — Sidebar menu (tools section) empty/English titles ⚠️
This is the most commonly missed failure mode. The `tools` section in `en.js` contains all sidebar menu titles. When a new tool is added, language files get the key injected but with an **empty string** — which `sync` reports as "in sync" because the key exists.

**Check for empty titles:**
```bash
for lang in de es fr hi it ja ko pl pt pt-BR ru vi zh-CN zh-TW; do
  python3 -c "
import re, sys
lang = '$lang'
with open(f'languages/{lang}.js') as f:
    content = f.read()
# Find tools section and look for empty or English-copy titles
tools_match = re.search(r'\"tools\"\s*:\s*\{(.+?)\n  \}', content, re.DOTALL)
if tools_match:
    empties = re.findall(r'\"([^\"]+)\"\s*:\s*\{\s*\"title\"\s*:\s*\"\"\s*\}', tools_match.group(1))
    if empties:
        print(f'{lang}: EMPTY titles for: {empties}')
  "
done
```

**Fix empty/English titles with sync-force:**
```bash
# Extract the keys that need translation (using multi-lang map format)
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync-force --lang all \
  --section tools \
  --key <tool-key>.title \
  --key <tool-key2>.title

# Translate to_translate.json (multi-language map: each value is a {lang: translation} object)
# Then inject and overwrite
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync-force-inject --lang all --cleanup
```

The translated JSON for `sync-force-inject --lang all` must use a **multi-language map** format:
```json
{
  "tools": {
    "sla-calc": {
      "title": {
        "de": "SLA Ausfallzeit-Rechner",
        "es": "Calculadora de Tiempo de Inactividad SLA",
        "fr": "Calculateur de Temps d'Arrêt SLA",
        "hi": "SLA डाउनटाइम कैलकुलेटर",
        "it": "Calcolatore Downtime SLA",
        "ja": "SLA ダウンタイム計算",
        "ko": "SLA 다운타임 계산기",
        "pl": "Kalkulator Przestoju SLA",
        "pt": "Calculadora de Downtime SLA",
        "pt-BR": "Calculadora de Downtime SLA",
        "ru": "Расчёт простоя SLA",
        "vi": "Tính Toán Thời Gian Ngừng SLA",
        "zh-CN": "SLA 停机时间计算",
        "zh-TW": "SLA 停機時間計算"
      }
    }
  }
}
```

### Step 3.5 — Cross-language universally-untranslated check ⚠️
```bash
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py audit
```
Expected: `All clear — no universally untranslated keys found.`

This catches keys that `info` and `sync` will both miss: values that exist in every
language file but still hold the original English text. A common outcome of bulk
injections where the translation step was skipped or only partially done.

If the audit reports any keys, use the printed `sync-force` command to extract them,
translate `to_translate.json`, then `sync-force-inject --lang all --cleanup`.

### Step 4 — Syntax validation
```bash
for lang in de es fr hi it ja ko pl pt pt-BR ru vi zh-CN zh-TW; do
  node -c languages/${lang}.js 2>&1 | grep -v "OK" && echo "$lang: ERROR" || echo "$lang: OK"
done
```

### Step 5 — Temp file cleanup
```bash
ls to_translate.json 2>/dev/null && echo "LEFTOVER — inject or delete" || echo "clean"
```
Expected: `clean`. If the file exists, inject it if not yet done, then delete it.
If any other stray JSON files appear in `git status --short`, delete them — see "Temporary file hygiene" below.

---

## Full workflow (LLM as translator)

1. **Check what's missing and what's stale**
   ```
   python3 ... info --lang hi
   ```

2. **Prune stale keys first** (if any reported)
   ```
   python3 ... prune --lang all --dry-run   # preview
   python3 ... prune --lang all             # apply
   ```

3. **Extract a batch** (user decides how many — controls token use)
   ```
   python3 ... extract --lang hi --count 5
   ```

4. **LLM translates** — read `to_translate.json`, translate all string values,
   write result back to `to_translate.json` (same structure, same keys, translated values).

5. **Inject** the translated file
   ```
   python3 ... inject --lang hi
   ```

6. **Repeat** from step 3 for the next batch until `info` shows 0 missing.

### `sync` / `sync-inject` — fill missing keys within existing sections
```bash
# Extract keys missing in a single language
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync --lang de

# Extract the union of all missing keys across every language
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync --lang all

# After translating to_translate.json, inject back
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync-inject --lang de
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync-inject --lang all
```
Handles the case where a **new key is added to an existing section** in en.js —
`extract`/`inject` only work for whole missing sections, so new keys in
already-present sections would otherwise go untranslated.

`sync-inject` is safe to run across all languages: it only adds keys that are
actually missing in each file and never overwrites existing translations.
Use `--cleanup` to delete the JSON file after successful injection.

### `sync-force` / `sync-force-inject` — force update existing keys
```bash
# Extract specific keys from en.js (even if already present in target langs)
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync-force --lang all --section wireshark --key tshark.run.cap_unavailable --key tcpdump.cap_unavailable

# After translating to_translate.json (supports multi-language map format), inject back and OVERWRITE
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync-force-inject --lang all --cleanup
```
Used for global terminology updates. Supports dot-separated deep paths for keys. `sync-force-inject` accepts a JSON file where values can be either strings (applied to the specific `--lang`) or objects mapping language codes to translations (applied globally when using `--lang all`). Use `--cleanup` to delete the JSON file after successful injection.

---

## Temporary file hygiene

### The rule: one file, one name, always `--cleanup`

Every extract/inject cycle uses exactly **one** temp file: `to_translate.json` in
the project root. No other names are permitted.

- **Never** pass `--output` to give it a custom name.
- **Never** manually create or rename translation JSON files.
- **Always** pass `--cleanup` to the inject command — this is mandatory, not optional.

The lifecycle is deterministic:

```
extract → to_translate.json exists → LLM translates → inject --cleanup → to_translate.json gone
```

If `to_translate.json` exists at the start of a session, a previous inject either
failed or was skipped. Inspect it, inject if needed, then delete.

### Mandatory `--cleanup` on every inject

```bash
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py inject --lang all --cleanup
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync-inject --lang all --cleanup
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py sync-force-inject --lang all --cleanup
```

The only exception: injecting into multiple languages sequentially with separate
runs (rare). In that case, delete the file manually after the final inject.

### End-of-session check (Step 5 of the audit)

One command — expected output is silence:
```bash
ls to_translate.json 2>/dev/null && echo "LEFTOVER — inject or delete" || echo "clean"
```

If the file exists and injection is already done, delete it:
```bash
rm to_translate.json
```

### Recovering from ad-hoc temp files

If files with non-standard names (`sections.json`, `tools_keys.json`, `batch1.json`,
etc.) are found untracked in the repo, they are always safe to delete — the script
never reads from a file unless explicitly passed via `--file`, and the standard
workflow never uses `--file` or `--output`. Delete them unconditionally:
```bash
# Find any stray JSON files not tracked by git
git status --short | grep "^??" | grep "\.json"
# Delete each one listed
rm <filename>.json
```

---

## When a feature is removed (dead key / section cleanup)

When keys or entire sections are deleted from en.js, clean up all language files:

```bash
# Preview first
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py prune --lang all --dry-run

# Apply
python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py prune --lang all
```

This handles both individual key removal and whole-section removal in one pass.
It is the safe replacement for manually editing each language file.

---

## Translation rules (tell the LLM every time)

When asking the LLM to translate the extracted JSON:

- Translate **string values only** — never touch keys
- Preserve placeholders exactly: `{n}`, `{type}`, `{count}`, `{msg}`, `{ip}`, `{prefix}`, etc.
- Preserve HTML tags: `<kbd>`, `</kbd>`, `<br>`, etc.
- Keep networking/technical terms in English: CIDR, VLAN, OSPF, BGP, DHCP, MPLS,
  VPN, IPsec, MTU, QoS, DSCP, LACP, STP, MAC, ACL, NAT, ASN, OUI, RIB, FIB, etc.
- Translate all other UI strings naturally and idiomatically
- Output must be valid JSON with identical structure to the input

---

## Known partial files (as of 2026-05-16)

All 14 language files are at 87/87 sections as of 2026-05-16. The remaining risk
is **empty or English-copy values** within existing sections — especially `tools`
sidebar menu titles. Run Step 3 and Step 3.5 of the audit checklist after every
new tool is added. Use `audit` to catch bulk untranslated injections that span all languages.

### Failure modes that `sync` and `info` will NOT catch

| Failure mode | Example | Correct fix |
|---|---|---|
| Empty title in `tools` section | `"sla-calc": { "title": "" }` | `sync-force` + `sync-force-inject` |
| English-copy title in `tools` section | `"qinq-config": { "title": "QinQ / VLAN Translation" }` | `sync-force` + `sync-force-inject` |
| English-copy value in any other section | Key exists but value == EN source | `sync-force` + `sync-force-inject` |
| English-copy value across **all** languages | Same EN value in every `xx.js` | `audit` to detect, then `sync-force` + `sync-force-inject` |

The first three happen per-language; `info --lang <x>` will eventually surface them.
The last one is invisible to per-language checks — only `audit` catches it reliably.

These happen because injection scripts add new keys with empty strings, and
`sync` considers a key "present" regardless of its value.

---

## Portability

The script works on any project where language files follow this pattern:
```js
TRANSLATIONS["xx"] = {
  "section_name": { ... },
  ...
};
```
Point it at the right `languages/` directory by editing `LANGUAGES_DIR` at the top of the script,
or pass `--languages-dir` if you add that flag later.
