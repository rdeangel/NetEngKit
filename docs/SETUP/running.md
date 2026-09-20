# Running NetEngKit

Five ways to run it. Pick by whether you need a CORS proxy, host binaries (nmap, tcpdump, iperf, …), or a single file you can open anywhere.

**Ports:** Default listen port is **8080** (`PORT` overrides). `npm start` uses 8880.

Most of the 118 registry entries run in the browser. Fourteen (`server: true`) call the optional Node server. Eleven of those fourteen also need the internet (`online: true`). The rest of this page is how to get a process listening; [TOOLS.md](../../TOOLS.md) is the catalog.

## Mode comparison

| Mode | How to run | Internet to load the app | Build step | CORS proxy + server tools | Best for |
|------|-----------|--------------------------|------------|---------------------------|----------|
| **Pages / offline HTML** | Open the Pages site, or a `NetEngKit-*-Offline.html` release file | No — assets are inlined | CI / `build:offline` | No | Using the kit |
| **Static HTTP** | `python3 -m http.server 8080` then open `NetEngKit.html` | Yes (unpkg + Google Fonts) | None | No | Edit and refresh |
| **Proxy server** | `node scripts/proxy.js` (or `npm start`) | Yes, if you serve the source HTML | None | Yes | Testing the 14 server tools |
| **Docker** | `docker compose up` or `docker run -p 8080:8080 …` | No for the UI (image is pre-bundled). Yes for the 11 online tools | `docker build` | Yes | Sharing / self-host |
| **file://** | Open `NetEngKit-file.html` | Yes (CDN + fonts) | `build:file` after each change | No | Opening from disk without a server |

## Pages / offline HTML

A `v*.*.*` tag builds a self-contained HTML file and deploys it as GitHub Pages `index.html`. Expected URL from the GitHub remote `rdeangel/NetEngKit`:

https://rdeangel.github.io/NetEngKit/

Download the same file from the GitHub Release (`NetEngKit-vX.Y.Z-Offline.html`) and open it locally. No Node, no Docker, no CDN at runtime. Server tools stay unavailable — there is no `proxy.js`.

Building that file yourself is `npm run build:offline` after `npm install`. See [development.md](development.md).

## Static HTTP server

Serve the project root so Babel Standalone can XHR the `components/*.jsx` files. Source `NetEngKit.html` loads React 18, Babel, and fonts from the network.

```bash
python3 -m http.server 8080
# then open http://localhost:8080/NetEngKit.html
```

Edit a file under `components/` and refresh. No CORS proxy, so SSL Labs / header tools that lack browser CORS will fail. No host binaries, so nmap/tcpdump/iperf tools stay greyed out.

## Proxy server

Runs Node, serves `/` as `NetEngKit.html`, and injects `window.LOCAL_PROXY = '/proxy/fetch?url='` into HTML responses. Default port **8080**.

```bash
node scripts/proxy.js
# then open http://localhost:8080
```

`scripts/proxy.js` uses Node built-ins only — no `npm install` for this command. Override the port with `PORT`:

```bash
PORT=3000 node scripts/proxy.js
```

`npm start` is `PORT=8880 node scripts/proxy.js`. That 8880 is a convenience in `package.json`, not the proxy default.

From a git clone this serves the **source** HTML, so you still need internet for unpkg and fonts. Server tools also need the matching host binaries; the fat Docker image ships those.

## Docker

```bash
docker compose up
# or: docker build -t netengkit . && docker run -p 8080:8080 netengkit
# then open http://localhost:8080
```

The image bundles HTML at build time (the Dockerfile runs `npm install` then `bundle.js` inside the builder stage) and starts `scripts/proxy.js` on **8080**. Compose maps `8080:8080` and grants `NET_RAW`. Image contents, pull URLs, and the security note live in [Docker deployment](../DEPLOYMENT/docker.md).

## file://

Modern browsers block Babel Standalone's XHR on `file://`, so opening `NetEngKit.html` from disk is a blank page. `build:file` pre-compiles JSX and writes `NetEngKit-file.html` (gitignored).

```bash
npm install          # esbuild — required
npm run build:file   # or: node scripts/build/build-dev.js
# then open NetEngKit-file.html
```

Re-run after editing a component. Custom output: `node scripts/build/build-dev.js -o ~/Desktop/nettools.html`. React and fonts still come from CDN; this is not the air-gapped build.

## Which file to ship

| Goal | What to use | Internet at runtime? |
|------|-------------|----------------------|
| Public web / GitHub Pages | `bundle.js` output served as `index.html` | No |
| Downloadable / air-gapped file | `NetEngKit-offline.html` (or the Release artifact) | No |
| Docker / intranet with diagnostics | The image (bundled HTML + `proxy.js` + host binaries) | Only for the 11 `online: true` tools |
| Local `file://` testing | `NetEngKit-file.html` | Yes — CDN + fonts |

`build-dev.js` only removes the Babel XHR requirement. `bundle.js` embeds React, fonts, and CSS so the file has no third-party fetches at runtime.
