# Development

Source of truth is `NetEngKit.html` plus `components/*.jsx`. There is no framework CLI. Most iteration is edit-and-refresh over HTTP. Building a `file://` or offline HTML file needs **`npm install` first** — `esbuild` is a `devDependency`, and both bundlers `require` it.

`scripts/proxy.js` is the exception: Node built-ins only (`http`, `http2`, `https`, `fs`, `path`, `url`, `child_process`, plus lazy `os` / `dns` / `tls` / `crypto`). Do not attach that zero-dependency claim to `bundle.js` or `build-dev.js`.

## Layout

| Path | Role |
|------|------|
| `NetEngKit.html` | Source. Loads React 18 + Babel Standalone from unpkg and each component as `<script type="text/babel" src="…">`. Needs HTTP (or a build) and internet for CDN/fonts. |
| `components/` | One major tool per `.jsx` file, plus shared UI. Edit here. |
| `languages/` | 15 files. `en.js` is the source of truth. |
| `ip-utils.js` | `window.IPv4` / `window.IPv6`. Inlined by the bundlers. |
| `oui-db.js` | MAC OUI table (`window.OUI_DB`). Inlined by the bundlers. |
| `scripts/proxy.js` | Static server + CORS proxy + `/api/*` helpers. Default port 8080. |
| `scripts/build/build-dev.js` | `npm run build:file` → `NetEngKit-file.html` (gitignored). |
| `scripts/build/bundle.js` | `npm run build:offline` → `NetEngKit-offline.html` (gitignored). |
| `TOOLS.md` | The single public tool catalog. Mandatory for every new tool. |

`NetEngKit-file.html` and `NetEngKit-offline.html` are gitignored (`*-file.html`, `*-offline.html`). `mermaid.min.js` is also gitignored; `npm install` downloads it once via `postinstall` (`scripts/build/fetch-mermaid.js`). Re-download with `npm run fetch:mermaid -- --force`.

## Making changes

Components live in `components/` as individual `.jsx` files. `NetEngKit.html` loads them in order via Babel `src=` tags. Shared helpers (`ip-utils.js`, `oui-db.js`) load as ordinary `<script src>` tags.

New major tools: add a file under `components/`, register it in `components/app.jsx` `TOOLS`, add the script tag in `NetEngKit.html`, add strings to `languages/en.js` first, and add a `###` entry in `TOOLS.md`. Full checklist: [`.agents/skills/add-tool/SKILL.md`](../../.agents/skills/add-tool/SKILL.md).

## HTTP (no build)

```bash
python3 -m http.server 8080
# open http://localhost:8080/NetEngKit.html
```

Babel fetches JSX over HTTP. Refresh after edits. Default listen port is **8080** (`PORT` overrides). `npm start` uses 8880.

## Proxy (for server tools)

```bash
node scripts/proxy.js          # http://localhost:8080 — no npm install
# or
npm start                      # same server, PORT=8880
PORT=3000 node scripts/proxy.js
```

The server injects `window.LOCAL_PROXY = '/proxy/fetch?url='`. Only some tools read that prefix — SSL Inspector, Security Headers, and Redirect Checker still default to `http://localhost:8080/proxy/fetch?url=`. See [Configuration](../CONFIGURATION/README.md). Edit a component and refresh. Host binaries for nmap/tcpdump/iperf are a separate problem — Docker ships them; a laptop often does not.

## file:// build

```bash
npm install
npm run build:file
# open NetEngKit-file.html
```

`scripts/build/build-dev.js` compiles JSX with esbuild (`scripts/build/compile-jsx.js`) and inlines one `<script>` block so Babel XHR is not needed. Re-run after any component change. Custom path: `node scripts/build/build-dev.js -o ~/Desktop/nettools.html`.

CDN React and Google Fonts still load at runtime. This is not the air-gapped artifact.

## Offline build

```bash
npm install
npm run build:offline
# writes NetEngKit-offline.html next to NetEngKit.html
```

Same esbuild compile path, then `bundle.js` fetches CDN scripts/CSS/fonts, gzip-compresses them, and emits a self-extracting HTML file. Mermaid is read from the local `mermaid.min.js` cache when present (filled by `npm install` or the first offline build). Custom output: `node scripts/build/bundle.js NetEngKit.html -o my-output.html`.

Dockerfile and CI (`npm ci` then `bundle.js`) already install dependencies. A clone that skips `npm install` will fail at `require('esbuild')`.

### When to rebuild

Re-run `build:file` or `build:offline` after:

- Any change under `components/` or in `NetEngKit.html`
- Changes to `ip-utils.js`
- CDN library version bumps in the source HTML

Font and CDN bytes are fetched live during `bundle.js`, so the offline file tracks the URLs in `NetEngKit.html` at build time.

## OUI database

The MAC vendor table is generated from [maclookup.app](https://maclookup.app/downloads/json-database) (free with attribution; MA-L / MA-M / MA-S). Refresh:

```bash
npm run update:oui-db
```

That is `node scripts/build/generate-oui-db.js` (Node `fs` / `https` only). Internet required for the download.

## i18n

Do not hardcode user-facing strings in JSX.

1. Add keys to `languages/en.js` first.
2. Run the `i18n-fill-sections` skill ([`.agents/skills/i18n-fill-sections/SKILL.md`](../../.agents/skills/i18n-fill-sections/SKILL.md); script: `.agents/skills/i18n-fill-sections/scripts/fill_missing_sections.py`) so the other 14 language files stay in sync.

## TOOLS.md

Every new tool or reference needs a `###` section in [`TOOLS.md`](../../TOOLS.md) at the repo root — ID, type, offline/online, inputs/outputs (or tabs). Do not skip it. Do not add a second catalog under `docs/FEATURES/`; those pages only index into TOOLS.md. Agent checklist: [`.agents/skills/add-tool/SKILL.md`](../../.agents/skills/add-tool/SKILL.md).
