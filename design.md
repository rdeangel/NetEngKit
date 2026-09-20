---
name: "NetEngKit"
version: "1.0.0"
author: "RDA"
colors:
  primary: "#00d4c8"
  secondary: "#22c55e"
  tertiary: "#f472b6"
  background: "#0d0d12"
  panel: "#16161e"
  border: "#2a2a3a"
  text: "#e2e8f0"
  error: "#ef4444"
  warning: "#f59e0b"
typography:
  mono: '"JetBrains Mono", monospace'
  sans: '"Inter", sans-serif'
  base-size: "14px"
spacing:
  radius: "6px"
  header-height: "56px"
---

# Design System: NetEngKit

A high-utility, terminal-inspired toolkit for network professionals. The UI prioritizes information density and clear status signaling.

## Color Philosophy

- **Backgrounds:** Deep charcoal foundations in dark mode, stark white in light mode.
- **Accents:** High-vibrancy primary colors used for functional categorization.
  - **Cyan/Blue:** Informational tools and lookups.
  - **Green:** Success states and Subnetting tools.
  - **Magenta:** Complex protocol analysis (IPv6, BGP).
  - **Red:** Errors, warnings, and high-priority diagnostics.

## Voice & Tone

The project speaks as a **Senior Network Engineer to a Peer**. 

- **Direct & Technical:** Use precise terminology (e.g., "Interface ID" instead of "the end of the address").
- **No Fluff:** Avoid conversational filler. The UI should get straight to the data.
- **Instructional but Non-Patronizing:** Assume the user knows the basics but provide clear "at-a-glance" hints for complex calculations (like CIDR-to-Host mappings).
- **Error Clarity:** When a validation fails, explain *why* it failed in technical terms (e.g., "Invalid octet: 256 is out of range 0-255").

## i18n & Content Strategy

This project uses a strict internationalization (i18n) workflow. **No user-facing strings should be hardcoded in JSX components.**

- **Source of Truth:** `languages/en.js` is the master file. All new keys and sections must be added there first.
- **Section-Based Organization:** Keys are grouped into logical sections (e.g., `common`, `subnetCalc`, `arcade`).
- **Syncing:** Use the `i18n-fill-sections` skill/tool to propagate changes from `en.js` to all other language files. This ensures that the structure remains consistent even if translations are pending.
- **Variable Injection:** Use the established `t('section.key', { var: value })` pattern for dynamic content.

## Typography
...
The system uses **Inter** for high readability in UI controls and **JetBrains Mono** for all technical output, code snippets, and network addresses to ensure character clarity (distinguishing `0` vs `O` and `l` vs `1`).
