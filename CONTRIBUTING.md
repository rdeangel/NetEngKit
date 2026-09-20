# Contributing

Same rules the agent copies at the repo root already state. `AGENTS.md` is the tracked copy. `CLAUDE.md` and `GEMINI.md` are local symlinks to it (gitignored). This file is the human version.

Layout, rebuilds, and i18n workflow: [docs/SETUP/development.md](docs/SETUP/development.md). Full add-a-tool checklist: [`.agents/skills/add-tool/SKILL.md`](.agents/skills/add-tool/SKILL.md).

## Voice and UI

Read `design.md` before any frontend change. Voice is senior network engineer talking to a peer — no marketing copy, no “getting started wizard” tone. Use the CSS variables in `design.md`. Prefer vanilla CSS in JSX, matching existing components.

## i18n

Do not hardcode user-facing strings in JSX.

1. Add keys to `languages/en.js` first.
2. Sync the other language files with the `i18n-fill-sections` skill ([`.agents/skills/i18n-fill-sections/SKILL.md`](.agents/skills/i18n-fill-sections/SKILL.md)) when you are asked to translate, not as part of every tool add. Missing keys fall back to English.

## Components

Functional React components. Prefer local `useState` / `useEffect` for tool-specific logic. A new major tool is a file under `components/`, registered in `components/app.jsx` `TOOLS`, with a script tag in `NetEngKit.html`.

## TOOLS.md

Every new tool or reference needs a `###` section in `TOOLS.md` (ID, type, online/offline, inputs/outputs or tabs). `docs/FEATURES/` is an index into that catalog, not a second catalog.

## Bugs and bad references

A wrong formula, a misquoted RFC, or an incorrect default is a first-class bug. Use the [Incorrect reference](.github/ISSUE_TEMPLATE/incorrect-reference.md) issue form.
