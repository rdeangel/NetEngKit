#!/usr/bin/env python3
"""
fill_missing_sections.py
Deterministic helper for LLM-assisted i18n translation.

WORKFLOW:
  1. Extract missing sections to a JSON file (LLM reads + translates it)
  2. LLM writes translated JSON to a file
  3. Inject the translated file back into the target language JS file

EXTRACT:
  python fill_missing_sections.py extract --lang zh-TW
  python fill_missing_sections.py extract --lang hi --count 5
  python fill_missing_sections.py extract --lang ko --section vlsm --section dhcp

INJECT:
  python fill_missing_sections.py inject --lang zh-TW --file translated.json

INFO:
  python fill_missing_sections.py info --lang hi

PRUNE (remove keys that were deleted from en.js):
  python fill_missing_sections.py prune --lang de
  python fill_missing_sections.py prune --lang all
  python fill_missing_sections.py prune --lang de --dry-run
"""

import json
import re
import sys
import argparse
from pathlib import Path

def _repo_root() -> Path:
    here = Path(__file__).resolve()
    for p in here.parents:
        if (p / "languages" / "en.js").exists():
            return p
    raise FileNotFoundError("Could not find repo root (languages/en.js) from " + str(here))


REPO_ROOT = _repo_root()
LANGUAGES_DIR = REPO_ROOT / "languages"
LANGUAGES_CONFIG = Path(__file__).parent / "languages.json"
INVOKE = "python3 .agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py"

DEFAULT_LANGUAGES = {
    "en": "English",
    "fr": "French",
    "es": "Spanish",
    "de": "German"
}

def load_language_names(config_path: Path) -> dict:
    if config_path.exists():
        try:
            return json.loads(config_path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            print(f"Warning: Failed to parse {config_path}. Using default samples.")
    return DEFAULT_LANGUAGES

LANGUAGE_NAMES = load_language_names(LANGUAGES_CONFIG)


# ---------------------------------------------------------------------------
# Parsing
# ---------------------------------------------------------------------------

def extract_sections(js_path: Path) -> dict[str, str]:
    """
    Parse a language JS file and return {section_name: raw_json_text}.
    Preserves the original formatting of each section.
    Specifically finds keys at the TOP LEVEL of the TRANSLATIONS object.
    """
    text = js_path.read_text(encoding="utf-8")
    
    # Find start of the main object
    m_start = re.search(r'TRANSLATIONS\["[a-z\-]+"\]\s*=\s*\{', text, re.IGNORECASE)
    if not m_start:
        return {}
    
    start_idx = text.index("{", m_start.start())
    sections = {}
    
    # Track depth within the main object
    # We want keys that are at depth 1 relative to the main object's start
    # Main object starts at start_idx (depth 1)
    # Sections start at depth 1 and go to depth 2, then back to 1.
    
    depth = 0
    i = start_idx
    while i < len(text):
        ch = text[i]
        if ch == '{':
            depth += 1
            i += 1
        elif ch == '}':
            depth -= 1
            if depth == 0: # End of main object
                break
            i += 1
        elif ch == '"' and depth == 1:
            # Possible top-level key
            j = i + 1
            while j < len(text) and text[j] != '"':
                if text[j] == '\\': j += 2
                else: j += 1
            key = text[i+1 : j]
            
            # Look ahead for : {
            k = j + 1
            while k < len(text) and text[k].isspace(): k += 1
            if k < len(text) and text[k] == ':':
                k += 1
                while k < len(text) and text[k].isspace(): k += 1
                if k < len(text) and text[k] == '{':
                    # This is a section start!
                    section_name = key
                    section_start = k
                    # Find matching brace for this section
                    s_depth = 1
                    l = k + 1
                    while l < len(text):
                        if text[l] == '{': s_depth += 1
                        elif text[l] == '}':
                            s_depth -= 1
                            if s_depth == 0:
                                sections[section_name] = text[section_start : l + 1]
                                break
                        elif text[l] == '"':
                            l2 = l + 1
                            while l2 < len(text) and text[l2] != '"':
                                if text[l2] == '\\': l2 += 2
                                else: l2 += 1
                            l = l2
                        l += 1
                    i = l + 1
                    continue
            i = j + 1
        elif ch == '"':
            # Skip strings
            j = i + 1
            while j < len(text) and text[j] != '"':
                if text[j] == '\\': j += 2
                else: j += 1
            i = j + 1
        else:
            i += 1
            
    return sections


def count_lines(text: str) -> int:
    return text.count("\n") + 1


def get_missing(lang: str) -> list[str]:
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    target_path = LANGUAGES_DIR / f"{lang}.js"
    if not target_path.exists():
        return list(en_sections.keys())
    target_sections = extract_sections(target_path)
    return [s for s in en_sections if s not in target_sections]


def get_stale_keys(lang: str) -> dict[str, list[str]]:
    """
    Returns {section_name: [stale_key, ...]} for every key that exists in
    the target language section but is absent from the corresponding en.js section.
    Only considers sections that exist in both files.
    """
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    target_path = LANGUAGES_DIR / f"{lang}.js"
    if not target_path.exists():
        return {}
    target_sections = extract_sections(target_path)

    stale = {}
    for section, raw in target_sections.items():
        if section not in en_sections:
            continue
        try:
            en_keys = set(json.loads(en_sections[section]).keys())
            tgt_keys = set(json.loads(raw).keys())
        except json.JSONDecodeError:
            continue
        extra = sorted(tgt_keys - en_keys)
        if extra:
            stale[section] = extra
    return stale


def get_orphan_sections(lang: str) -> list[str]:
    """
    Returns section names that exist in the target language file but have been
    removed from en.js entirely. These are candidates for full section removal.
    """
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    target_path = LANGUAGES_DIR / f"{lang}.js"
    if not target_path.exists():
        return []
    target_sections = extract_sections(target_path)
    return [s for s in target_sections if s not in en_sections]


def remove_section_from_text(text: str, section_name: str) -> str:
    """
    Remove a top-level section block (including its trailing comma) from JS text.
    Handles both  `"name": { ... },`  and  `"name": { ... }` (last section, no comma).
    """
    # Match: optional leading newline + indent + "name": { ... } + optional comma
    pattern = re.compile(
        r'\n  "' + re.escape(section_name) + r'":\s*\{',
    )
    m = pattern.search(text)
    if not m:
        return text

    # Find the opening brace and walk to the matching close
    brace_start = text.index("{", m.start())
    depth = 0
    i = brace_start
    while i < len(text):
        ch = text[i]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                break
        elif ch == '"':
            i += 1
            while i < len(text):
                if text[i] == "\\":
                    i += 1
                elif text[i] == '"':
                    break
                i += 1
        i += 1

    block_end = i + 1  # character after closing }

    # Consume an optional trailing comma and newline
    rest = text[block_end:]
    if rest.startswith(","):
        block_end += 1
        rest = text[block_end:]
    if rest.startswith("\n"):
        block_end += 1

    # Re-join with a newline (the one after the block was consumed above).
    # Middle section: text[:m.start()] ends with "prev}," and text[block_end:]
    #   starts with "  next_section" — the \n between them was consumed.
    # Last section:   text[:m.start()] ends with "prev}," and text[block_end:]
    #   starts with "};" — same issue, plus the comma itself is now dangling.
    result = text[:m.start()] + '\n' + text[block_end:]
    # Last-section case: strip the dangling comma that preceded the removed block
    result = re.sub(r',\n(\};)$', r'\n\1', result)
    return result


def get_missing_keys_recursive(en_data: dict, tgt_data: dict) -> dict:
    """
    Recursively find keys in en_data that are missing in tgt_data.
    """
    gap = {}
    for k, v in en_data.items():
        if k not in tgt_data:
            gap[k] = v
        elif isinstance(v, dict) and isinstance(tgt_data[k], dict):
            sub_gap = get_missing_keys_recursive(v, tgt_data[k])
            if sub_gap:
                gap[k] = sub_gap
    return gap


def get_untranslated_keys_recursive(en_data: dict, tgt_data: dict) -> list[str]:
    """
    Recursively find keys in tgt_data that have the same value as en_data.
    Returns a list of dot-separated paths.
    """
    untranslated = []
    for k, v in en_data.items():
        if k in tgt_data:
            tgt_v = tgt_data[k]
            if isinstance(v, dict) and isinstance(tgt_v, dict):
                sub = get_untranslated_keys_recursive(v, tgt_v)
                untranslated.extend([f"{k}.{path}" for path in sub])
            elif v == tgt_v and isinstance(v, str) and v.strip() != "":
                # Ignore very short strings or common technical abbreviations that usually don't change
                if len(v) > 2 and v not in ["IP", "MAC", "CIDR", "DNS", "BGP", "RFC", "TCP", "UDP", "MTU", "QoS"]:
                    untranslated.append(k)
    return untranslated


def clean_json_text(text: str) -> str:
    """
    Makes the raw section text more JSON-compliant by removing trailing commas.
    """
    # Remove trailing commas before } or ]
    return re.sub(r',\s*([}\]])', r'\1', text)


def get_missing_keys(lang: str) -> dict[str, dict]:
    """
    Returns {section_name: {key: en_value, ...}} for every key that exists in
    en.js but is missing from the corresponding section in the target language.
    Only considers sections present in both files. Recursively checks nested objects.
    """
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    target_path = LANGUAGES_DIR / f"{lang}.js"
    if not target_path.exists():
        return {}
    target_sections = extract_sections(target_path)

    missing = {}
    for section, raw in en_sections.items():
        if section not in target_sections:
            continue
        try:
            en_data = json.loads(clean_json_text(raw))
            tgt_data = json.loads(clean_json_text(target_sections[section]))
        except json.JSONDecodeError:
            continue
        gap = get_missing_keys_recursive(en_data, tgt_data)
        if gap:
            missing[section] = gap
    return missing


def get_untranslated_keys(lang: str) -> dict[str, list[str]]:
    """
    Returns {section_name: [key_path, ...]} for keys that exist but match the English value.
    """
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    target_path = LANGUAGES_DIR / f"{lang}.js"
    if not target_path.exists():
        return {}
    target_sections = extract_sections(target_path)

    untranslated = {}
    for section, raw in en_sections.items():
        if section not in target_sections:
            continue
        try:
            en_data = json.loads(clean_json_text(raw))
            tgt_data = json.loads(clean_json_text(target_sections[section]))
        except json.JSONDecodeError:
            continue
        paths = get_untranslated_keys_recursive(en_data, tgt_data)
        if paths:
            untranslated[section] = paths
    return untranslated


def get_universally_untranslated_recursive(
    en_data: dict, lang_datas: list[dict]
) -> list[str]:
    """
    Walk en_data keys. For each leaf string, check whether ALL supplied lang_datas
    have the same value as EN. Returns dot-separated key paths that match.
    """
    EXCLUDED_TERMS = {"IP", "MAC", "CIDR", "DNS", "BGP", "RFC", "TCP", "UDP", "MTU", "QoS"}
    result = []
    for k, v in en_data.items():
        if isinstance(v, dict):
            sub_datas = [ld.get(k, {}) for ld in lang_datas if isinstance(ld, dict)]
            sub = get_universally_untranslated_recursive(v, sub_datas)
            result.extend([f"{k}.{path}" for path in sub])
        elif isinstance(v, str) and v.strip() and len(v) > 2 and v not in EXCLUDED_TERMS:
            tgt_vals = [ld.get(k) for ld in lang_datas if isinstance(ld, dict)]
            total = len(tgt_vals)
            if total > 0 and all(tv == v for tv in tgt_vals):
                result.append(k)
    return result


def get_universally_untranslated(langs: list[str]) -> dict[str, list[str]]:
    """
    Returns {section_name: [key_path, ...]} for keys where ALL non-English
    language files have the same value as en.js (universally untranslated).
    """
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    lang_sections: dict[str, dict[str, str]] = {}
    for lang in langs:
        path = LANGUAGES_DIR / f"{lang}.js"
        if path.exists():
            lang_sections[lang] = extract_sections(path)

    result = {}
    for section, raw in en_sections.items():
        try:
            en_data = json.loads(clean_json_text(raw))
        except json.JSONDecodeError:
            continue

        lang_datas = []
        for lang in langs:
            sec_raw = lang_sections.get(lang, {}).get(section)
            if sec_raw:
                try:
                    lang_datas.append(json.loads(clean_json_text(sec_raw)))
                except json.JSONDecodeError:
                    pass

        if not lang_datas:
            continue

        paths = get_universally_untranslated_recursive(en_data, lang_datas)
        if paths:
            result[section] = paths

    return result


def all_langs() -> list[str]:
    return sorted(
        p.stem for p in LANGUAGES_DIR.glob("*.js") if p.stem != "en"
    )


def resolve_lang(data, l):
    """
    Recursively resolve multi-language dictionary maps to a single language string.
    """
    if not isinstance(data, dict):
        return data
    if data and all(k in LANGUAGE_NAMES or k == "en" for k in data.keys()):
        return data.get(l, data.get("en", next(iter(data.values()))))
    return {k: resolve_lang(v, l) for k, v in data.items()}


# ---------------------------------------------------------------------------
# Commands
# ---------------------------------------------------------------------------

def _print_info(lang, en_sections):
    missing = get_missing(lang)
    stale = get_stale_keys(lang)
    orphans = get_orphan_sections(lang)
    missing_keys = get_missing_keys(lang)
    untranslated = get_untranslated_keys(lang)

    total_lines = sum(count_lines(en_sections[s]) for s in missing)
    present = len(en_sections) - len(missing)

    print(f"Language : {lang} ({LANGUAGE_NAMES.get(lang, 'unknown')})")
    print(f"Sections : {present}/{len(en_sections)} present, {len(missing)} missing")
    print(f"Est. lines to translate: {total_lines}")

    if missing:
        print()
        print(f"{'#':<4} {'Section':<25} {'Lines':>6}")
        print("-" * 38)
        for i, s in enumerate(missing, 1):
            lines = count_lines(en_sections[s])
            print(f"{i:<4} {s:<25} {lines:>6}")

    if stale:
        stale_count = sum(len(v) for v in stale.values())
        print()
        print(f"Stale keys (in {lang}.js but removed from en.js): {stale_count}")
        for section, keys in stale.items():
            print(f"  [{section}]  {', '.join(keys)}")
        print(f"Run: python fill_missing_sections.py prune --lang {lang}")

    if orphans:
        print()
        print(f"Orphan sections (removed from en.js entirely): {len(orphans)}")
        for s in orphans:
            print(f"  [{s}]")
        print(f"Run: python fill_missing_sections.py prune --lang {lang}")

    if missing_keys:
        total_mk = sum(len(v) for v in missing_keys.values())
        print()
        print(f"Missing keys within existing sections: {total_mk}")
        for section, keys in missing_keys.items():
            print(f"  [{section}]  {', '.join(keys)}")
        print(f"Run: python fill_missing_sections.py sync --lang {lang}")

    if untranslated:
        total_un = sum(len(v) for v in untranslated.values())
        print()
        print(f"Likely untranslated (matches EN source): {total_un}")
        for section, keys in untranslated.items():
            # Show first 5 keys per section to avoid terminal bloat
            display_keys = keys[:5]
            more = len(keys) - 5
            suffix = f" ... (+{more} more)" if more > 0 else ""
            print(f"  [{section}]  {', '.join(display_keys)}{suffix}")
        print(f"Run: python fill_missing_sections.py sync-force --lang {lang} --section SECTION --key KEY")


def cmd_info(args):
    langs = all_langs() if args.lang == "all" else [args.lang]
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    for lang in langs:
        _print_info(lang, en_sections)
        if len(langs) > 1:
            print()


def cmd_extract(args):
    lang = args.lang
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    missing = get_missing(lang)

    if not missing and not args.force:
        print(f"No missing sections in {lang}.js — nothing to extract. Use --force to extract existing sections.")
        return

    if args.section:
        if args.force:
            selected = [s for s in args.section if s in en_sections]
        else:
            selected = [s for s in args.section if s in missing]
            not_missing = [s for s in args.section if s not in missing]
            if not_missing:
                print(f"Warning: already present, skipping: {', '.join(not_missing)}")
    elif args.count:
        selected = missing[: args.count]
    else:
        selected = missing

    if not selected:
        print("Nothing to extract.")
        return

    output = {}
    for s in selected:
        output[s] = json.loads(en_sections[s])

    out_path = Path(args.output)
    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")

    total_lines = sum(count_lines(en_sections[s]) for s in selected)
    remaining = [s for s in missing if s not in selected]

    print(f"Extracted {len(selected)} section(s) → {out_path}  ({total_lines} lines)")
    print(f"Sections : {', '.join(selected)}")
    if remaining:
        print(f"Remaining: {len(remaining)} section(s) still missing after this batch")
        print(f"           ({', '.join(remaining[:5])}{'...' if len(remaining) > 5 else ''})")
    else:
        print("This covers all missing sections.")

    print()
    print("Next step: translate the extracted file, then run:")
    print(f"  python fill_missing_sections.py inject --lang {lang} --file {out_path}")


def cmd_inject(args):
    lang = args.lang
    target_path = LANGUAGES_DIR / f"{lang}.js"
    translated_path = Path(args.file)

    if not target_path.exists():
        print(f"Target file not found: {target_path}")
        sys.exit(1)
    if not translated_path.exists():
        print(f"Translated file not found: {translated_path}")
        sys.exit(1)

    try:
        translated: dict = json.loads(translated_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"Invalid JSON in {translated_path}: {e}")
        sys.exit(1)

    translated = resolve_lang(translated, lang)

    text = target_path.read_text(encoding="utf-8")
    existing_sections = extract_sections(target_path)
    
    # Separate sections into "to update" and "to append"
    to_update = [s for s in translated if s in existing_sections]
    to_append = [s for s in translated if s not in existing_sections]

    if not translated:
        print("Nothing to inject.")
        return

    # 1. Update existing sections
    for name in to_update:
        content = translated[name]
        if not isinstance(content, dict):
            print(f"Section '{name}' is not a JSON object — skipping.")
            continue
        
        raw_old = existing_sections[name]
        json_str = json.dumps(content, indent=2, ensure_ascii=False)
        # Re-apply our specific "inner section" formatting (indented)
        new_raw = "{\n" + "\n".join("  " + line for line in json_str.splitlines()[1:-1]) + "\n}"
        text = text.replace(raw_old, new_raw, 1)
        print(f"  [{name}] updated existing section")

    # 2. Append new sections
    if to_append:
        insert_parts = []
        for name in to_append:
            content = translated[name]
            if not isinstance(content, dict):
                print(f"Section '{name}' is not a JSON object — skipping.")
                continue
            json_str = json.dumps(content, indent=2, ensure_ascii=False)
            indented = "\n".join("  " + line for line in json_str.splitlines())
            insert_parts.append(f'  "{name}": {indented}')

        insertion = ",\n".join(insert_parts)
        close_idx = text.rfind("};")
        if close_idx == -1:
            print(f"Could not find closing '}}' in {target_path}")
            sys.exit(1)

        before_close = text[:close_idx].rstrip()
        text = before_close + ",\n" + insertion + "\n};"
        print(f"  [{', '.join(to_append)}] appended new sections")

    target_path.write_text(text, encoding="utf-8")
    print(f"Injection complete for {target_path}")

    if args.cleanup and translated_path.exists():
        translated_path.unlink()
        print(f"Cleaned up temporary file: {translated_path}")


def cmd_prune(args):
    """
    Remove stale keys and orphan sections from language files.
    - Stale keys: keys within a shared section that were removed from en.js
    - Orphan sections: entire sections removed from en.js entirely
    Operates on one language or all non-English languages.
    Use --dry-run to preview without writing.
    """
    langs = all_langs() if args.lang == "all" else [args.lang]
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    dry = args.dry_run

    total_removed_keys = 0
    total_removed_sections = 0

    for lang in langs:
        target_path = LANGUAGES_DIR / f"{lang}.js"
        if not target_path.exists():
            print(f"Skipping {lang}: file not found")
            continue

        stale = get_stale_keys(lang)
        orphans = get_orphan_sections(lang)

        if not stale and not orphans:
            if len(langs) == 1:
                print(f"{lang}.js: nothing to prune.")
            continue

        text = target_path.read_text(encoding="utf-8")
        target_sections = extract_sections(target_path)
        report = []

        # Remove stale keys within shared sections
        for section, stale_keys in stale.items():
            if section not in target_sections:
                continue
            raw = target_sections[section]
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                print(f"  [{lang}] Could not parse section '{section}' — skipping")
                continue

            en_keys = set(json.loads(en_sections[section]).keys())
            pruned = {k: v for k, v in data.items() if k in en_keys}

            new_json = json.dumps(pruned, indent=2, ensure_ascii=False)
            new_raw = "{\n" + "\n".join("  " + line for line in new_json.splitlines()[1:-1]) + "\n}"

            text = text.replace(raw, new_raw, 1)
            report.append(f"  [{section}] removed keys: {', '.join(stale_keys)}")
            total_removed_keys += len(stale_keys)

        # Remove orphan sections entirely
        for section in orphans:
            text = remove_section_from_text(text, section)
            report.append(f"  [{section}] section removed entirely")
            total_removed_sections += 1

        if dry:
            print(f"[dry-run] {lang}.js — would prune:")
            print("\n".join(report))
        else:
            target_path.write_text(text, encoding="utf-8")
            print(f"Pruned {lang}.js:")
            print("\n".join(report))

    if total_removed_keys == 0 and total_removed_sections == 0:
        print("Nothing to prune.")
    elif not dry:
        parts = []
        if total_removed_keys:
            parts.append(f"{total_removed_keys} key(s) removed")
        if total_removed_sections:
            parts.append(f"{total_removed_sections} section(s) removed")
        print(f"\nTotal: {', '.join(parts)}")


def cmd_sync(args):
    """
    Extract missing keys from within existing sections so the LLM can translate
    just the gaps — without needing to re-translate whole sections.

    Produces a to_translate.json shaped like:
      { "section_name": { "missing_key": "English value", ... }, ... }

    After translation, inject with:
      python fill_missing_sections.py sync-inject --lang de
    """
    langs = all_langs() if args.lang == "all" else [args.lang]
    out_path = Path(args.output)

    if args.lang == "all":
        # Merge gaps from all languages — union of all missing keys per section
        combined: dict[str, dict] = {}
        for lang in langs:
            for section, keys in get_missing_keys(lang).items():
                for k, v in keys.items():
                    combined.setdefault(section, {})[k] = v
        if not combined:
            print("All languages are in sync — nothing to extract.")
            return
        out_path.write_text(json.dumps(combined, indent=2, ensure_ascii=False), encoding="utf-8")
        total = sum(len(v) for v in combined.values())
        print(f"Extracted {total} missing key(s) across all languages → {out_path}")
        print("Translate values, then run:")
        print(f"  python fill_missing_sections.py sync-inject --lang all")
    else:
        lang = args.lang
        missing_keys = get_missing_keys(lang)
        if not missing_keys:
            print(f"{lang}.js: all keys in sync — nothing to extract.")
            return
        out_path.write_text(json.dumps(missing_keys, indent=2, ensure_ascii=False), encoding="utf-8")
        total = sum(len(v) for v in missing_keys.values())
        print(f"Extracted {total} missing key(s) for {lang} → {out_path}")
        print("Translate values, then run:")
        print(f"  python fill_missing_sections.py sync-inject --lang {lang}")


def deep_update(base: dict, update: dict):
    """
    Recursively update a dictionary. Only adds keys; does not overwrite.
    """
    for k, v in update.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            deep_update(base[k], v)
        elif k not in base:
            base[k] = v


def cmd_sync_inject(args):
    """
    Merge translated keys back into existing sections in the language file.
    Only adds keys; never overwrites existing translations.
    """
    langs = all_langs() if args.lang == "all" else [args.lang]
    translated_path = Path(args.file)

    if not translated_path.exists():
        print(f"Translated file not found: {translated_path}")
        sys.exit(1)
    try:
        translated: dict = json.loads(translated_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"Invalid JSON in {translated_path}: {e}")
        sys.exit(1)

    total_added = 0

    for lang in langs:
        target_path = LANGUAGES_DIR / f"{lang}.js"
        if not target_path.exists():
            print(f"Skipping {lang}: file not found")
            continue

        missing_keys = get_missing_keys(lang)
        target_sections = extract_sections(target_path)
        text = target_path.read_text(encoding="utf-8")
        added_report = []

        lang_data = resolve_lang(translated, lang)

        for section, new_keys in lang_data.items():
            if section not in target_sections:
                continue
            # Only inject keys actually missing in this language (recursively)
            lang_missing = missing_keys.get(section, {})
            if not lang_missing:
                continue

            # We only want to add what is in lang_missing AND provided in translated
            # This is slightly tricky with recursion. 
            # We'll intersect new_keys with lang_missing.
            def intersect(source, mask):
                res = {}
                for k, v in mask.items():
                    if k in source:
                        if isinstance(v, dict) and isinstance(source[k], dict):
                            sub = intersect(source[k], v)
                            if sub: res[k] = sub
                        else:
                            res[k] = source[k]
                return res

            to_add = intersect(new_keys, lang_missing)
            if not to_add:
                continue

            raw = target_sections[section]
            try:
                data = json.loads(clean_json_text(raw))
            except json.JSONDecodeError:
                print(f"  [{lang}] Could not parse section '{section}' — skipping")
                continue

            deep_update(data, to_add)
            new_json = json.dumps(data, indent=2, ensure_ascii=False)
            new_raw = "{\n" + "\n".join("  " + line for line in new_json.splitlines()[1:-1]) + "\n}"
            text = text.replace(raw, new_raw, 1)
            added_report.append(f"  [{section}] synced missing keys")
            total_added += 1 # Count sections modified instead of individual keys for simplicity here

        if added_report:
            target_path.write_text(text, encoding="utf-8")
            print(f"Synced {lang}.js:")
            print("\n".join(added_report))
        elif len(langs) == 1:
            print(f"{lang}.js: nothing to add.")

    if total_added:
        print(f"\nTotal sections updated: {total_added}")
    
    if args.cleanup and translated_path.exists():
        translated_path.unlink()
        print(f"Cleaned up temporary file: {translated_path}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def get_deep_value(data: dict, path: str):
    """
    Retrieve a value from a nested dict using a dot-separated path.
    """
    keys = path.split(".")
    curr = data
    for k in keys:
        if isinstance(curr, dict) and k in curr:
            curr = curr[k]
        else:
            return None
    return curr


def set_deep_value(data: dict, path: str, value):
    """
    Set a value in a nested dict using a dot-separated path.
    """
    keys = path.split(".")
    curr = data
    for k in keys[:-1]:
        if k not in curr or not isinstance(curr[k], dict):
            curr[k] = {}
        curr = curr[k]
    curr[keys[-1]] = value


def cmd_sync_force(args):
    """
    Explicitly extract specific keys from en.js for translation, 
    even if they already exist in target languages.
    Supports deep paths like "wireshark.tshark.run.cap_unavailable".
    """
    en_sections = extract_sections(LANGUAGES_DIR / "en.js")
    out_path = Path(args.output)
    
    sections_to_force = args.section
    keys_to_force = args.key # These can be dot-separated paths

    output = {}
    for section_name in sections_to_force:
        if section_name not in en_sections:
            print(f"Warning: Section '{section_name}' not found in en.js")
            continue
        
        try:
            en_data = json.loads(clean_json_text(en_sections[section_name]))
        except json.JSONDecodeError:
            print(f"Error: Failed to parse section '{section_name}' as JSON")
            continue
            
        section_output = {}
        for path in keys_to_force:
            val = get_deep_value(en_data, path)
            if val is not None:
                set_deep_value(section_output, path, val)
            else:
                # Try path relative to section if absolute fails
                # e.g. section="wireshark", path="tshark.run.cap_unavailable"
                pass
        
        if section_output:
            output[section_name] = section_output

    if not output:
        print("Nothing to extract with specified sections/keys.")
        return

    out_path.write_text(json.dumps(output, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Extracted {len(output)} section(s) for forced synchronization → {out_path}")
    print("Translate values, then run:")
    print(f"  python fill_missing_sections.py sync-force-inject --lang {args.lang}")


def deep_update_forced(base: dict, update: dict):
    """
    Recursively update a dictionary, overwriting existing keys.
    """
    for k, v in update.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            deep_update_forced(base[k], v)
        else:
            base[k] = v


def cmd_sync_force_inject(args):
    """
    Merge translated keys back, OVERWRITING existing translations.
    Supports multi-language objects: { "key": { "de": "...", "es": "..." } }
    """
    langs = all_langs() if args.lang == "all" else [args.lang]
    translated_path = Path(args.file)

    if not translated_path.exists():
        print(f"Translated file not found: {translated_path}")
        sys.exit(1)
    try:
        translated: dict = json.loads(translated_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        print(f"Invalid JSON in {translated_path}: {e}")
        sys.exit(1)

    total_added = 0

    for lang in langs:
        target_path = LANGUAGES_DIR / f"{lang}.js"
        if not target_path.exists():
            continue

        target_sections = extract_sections(target_path)
        text = target_path.read_text(encoding="utf-8")
        updated_report = []

        lang_data = resolve_lang(translated, lang)

        for section, new_keys in lang_data.items():
            if section not in target_sections:
                continue

            raw = target_sections[section]
            try:
                data = json.loads(clean_json_text(raw))
            except json.JSONDecodeError:
                continue

            deep_update_forced(data, new_keys)
            new_json = json.dumps(data, indent=2, ensure_ascii=False)
            json_lines = new_json.splitlines()[1:-1]
            new_raw = "{\n" + "\n".join("  " + line for line in json_lines) + "\n}"
            text = text.replace(raw, new_raw, 1)
            updated_report.append(f"  [{section}] force-updated keys")
            total_added += 1

        if updated_report:
            target_path.write_text(text, encoding="utf-8")
            print(f"Force-updated {lang}.js:")
            print("\n".join(updated_report))

    if total_added:
        print(f"\nTotal sections force-updated: {total_added}")

    if args.cleanup and translated_path.exists():
        translated_path.unlink()
        print(f"Cleaned up temporary file: {translated_path}")


def cmd_audit(args):
    """
    Cross-language audit: find keys that are identical to English across ALL language files.
    These are universally untranslated — injected as English and never sent for translation.
    """
    langs = all_langs()
    print(f"Auditing {len(langs)} languages for universally untranslated keys...")
    print()

    universally_untranslated = get_universally_untranslated(langs)

    if not universally_untranslated:
        print("All clear — no universally untranslated keys found.")
        return

    total = sum(len(v) for v in universally_untranslated.values())
    print(f"Universally untranslated (identical to EN across all {len(langs)} languages): {total} key(s)")
    print()

    for section, paths in universally_untranslated.items():
        display = paths[:5]
        more = len(paths) - 5
        suffix = f" ... (+{more} more)" if more > 0 else ""
        print(f"  [{section}]  {', '.join(display)}{suffix}")

    print()
    print("Fix with sync-force + sync-force-inject for each affected section:")
    shown = 0
    for section, paths in universally_untranslated.items():
        keys_args = " ".join(f"--key {p}" for p in paths[:5])
        print(f"  {INVOKE} sync-force --lang all --section {section} {keys_args}")
        shown += 1
        if shown >= 3 and len(universally_untranslated) > 3:
            print(f"  ... (and {len(universally_untranslated) - 3} more sections)")
            break


def main():
    parser = argparse.ArgumentParser(
        description="LLM-assisted i18n section filler",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--config", help="Path to languages.json config file")
    sub = parser.add_subparsers(dest="command", required=True)

    p_info = sub.add_parser("info", help="List missing sections and stale keys")
    p_info.add_argument("--lang", required=True)

    p_ext = sub.add_parser("extract", help="Extract missing EN sections to a JSON file")
    p_ext.add_argument("--lang", required=True)
    p_ext.add_argument("--count", type=int)
    p_ext.add_argument("--section", action="append")
    p_ext.add_argument("--output", default="to_translate.json")
    p_ext.add_argument("--force", action="store_true", help="Extract even if already present in target lang")

    p_inj = sub.add_parser("inject", help="Inject translated JSON into the language file")
    p_inj.add_argument("--lang", required=True)
    p_inj.add_argument("--file", default="to_translate.json")
    p_inj.add_argument("--cleanup", action="store_true", help="Delete the translated file after successful injection")

    p_prune = sub.add_parser("prune", help="Remove keys absent from en.js across one or all languages")
    p_prune.add_argument("--lang", required=True, help="Language code or 'all'")
    p_prune.add_argument("--dry-run", action="store_true", help="Preview without writing")

    p_sync = sub.add_parser("sync", help="Extract missing keys within existing sections for translation")
    p_sync.add_argument("--lang", required=True, help="Language code or 'all'")
    p_sync.add_argument("--output", default="to_translate.json")

    p_sync_inj = sub.add_parser("sync-inject", help="Merge translated keys back into existing sections")
    p_sync_inj.add_argument("--lang", required=True, help="Language code or 'all'")
    p_sync_inj.add_argument("--file", default="to_translate.json")
    p_sync_inj.add_argument("--cleanup", action="store_true", help="Delete the translated file after successful injection")

    p_sync_force = sub.add_parser("sync-force", help="Force update specific keys from EN regardless of presence")
    p_sync_force.add_argument("--lang", required=True, help="Language code or 'all'")
    p_sync_force.add_argument("--section", required=True, action="append", help="Section names to force sync")
    p_sync_force.add_argument("--key", required=True, action="append", help="Keys to force sync from EN (comma-separated within section)")
    p_sync_force.add_argument("--output", default="to_translate.json")

    p_sync_force_inj = sub.add_parser("sync-force-inject", help="Merge translated keys back, OVERWRITING existing translations")
    p_sync_force_inj.add_argument("--lang", required=True, help="Language code or 'all'")
    p_sync_force_inj.add_argument("--file", default="to_translate.json")
    p_sync_force_inj.add_argument("--cleanup", action="store_true", help="Delete the translated file after successful injection")

    sub.add_parser("audit", help="Find keys that are identical to EN across ALL language files (universally untranslated)")

    args = parser.parse_args()

    global LANGUAGE_NAMES
    if args.config:
        LANGUAGE_NAMES = load_language_names(Path(args.config))

    if args.command == "info":
        cmd_info(args)
    elif args.command == "extract":
        cmd_extract(args)
    elif args.command == "inject":
        cmd_inject(args)
    elif args.command == "prune":
        cmd_prune(args)
    elif args.command == "sync":
        cmd_sync(args)
    elif args.command == "sync-inject":
        cmd_sync_inject(args)
    elif args.command == "sync-force":
        cmd_sync_force(args)
    elif args.command == "sync-force-inject":
        cmd_sync_force_inject(args)
    elif args.command == "audit":
        cmd_audit(args)


if __name__ == "__main__":
    main()
