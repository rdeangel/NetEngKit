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
