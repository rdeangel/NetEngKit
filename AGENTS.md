# Project Mandates: NetEngKit

## UI & UX Development
- **Design Source of Truth:** Always refer to `design.md` before implementing any frontend changes, new components, or UI tweaks.
- **Aesthetic Integrity:** Adhere strictly to the "Senior Network Engineer to a Peer" voice and tone defined in `design.md`.
- **Styling:** Use the CSS variables defined in the `design.md` tokens. Prioritize Vanilla CSS within JSX as per project patterns.

## Internationalization (i18n)
- **Hardcoding:** NEVER hardcode user-facing strings in JSX.
- **Workflow:** All strings must be added to `languages/en.js` first.
- **Synchronization:** After adding new keys or sections to `en.js`, you MUST run the `i18n-fill-sections` skill to synchronize all other language files.

## Component Architecture
- **Functional Components:** Use React functional components.
- **State Management:** Prefer local `useState` and `useEffect` for tool-specific logic.
- **File Structure:** New major tools should be added as separate files in `components/` and then integrated into `NetEngKit.html`. Follow `.agents/skills/add-tool/SKILL.md`.

## Feature Planning Ledgers (private)
- **Discovery:** repo-wide glob `**/*TOOLS.md` → `internal/plans/PROPOSED_TOOLS.md` (feature proposals with implementation-status markers) and `internal/plans/DEFERRED_TOOLS.md` (proposals rejected, with reasons). These live under the gitignored `internal/` tree and are NOT part of the public repo — their absence from `git status` does not mean they don't exist.
- **Usage:** Read both before proposing, scoping, or implementing a new tool; follow the marker conventions in each file's header legend.
- **Feature wave:** the approval roster and progress ledger live under `.keleon/schedule/` (referenced from the delegation prompts). Never implement a roster row that is not `approved` — the `proposed → approved` flip belongs to the operator.
