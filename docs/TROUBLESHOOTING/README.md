# Troubleshooting

Real failure modes, verified against the current code. Run modes: [running.md](../SETUP/running.md). Ports, proxy, and capabilities: [Configuration](../CONFIGURATION/README.md). Docker caps: [docker.md](../DEPLOYMENT/docker.md).

Most of the 118 registry entries run in the browser. Fourteen need `scripts/proxy.js` or Docker. Eleven of those fourteen also need the internet.

## Blank page on `file://`

Opening `NetEngKit.html` from disk is a blank page. Source HTML loads every tool as `<script type="text/babel" src="components/….jsx">`. Babel Standalone fetches those files with XHR; browsers block XHR on `file://`.

Build a file that does not need that XHR:

```bash
npm install
npm run build:file
# then open NetEngKit-file.html
```

`NetEngKit-file.html` is gitignored. Re-run after editing a component. React and fonts still come from unpkg / Google Fonts — this is not the air-gapped file. That is `npm run build:offline` → `NetEngKit-offline.html`, or the GitHub Release `NetEngKit-*-Offline.html`. Details: [development.md](../SETUP/development.md).

## Port already in use, or the wrong port

`scripts/proxy.js` binds `process.env.PORT || '8080'`. Default listen port is **8080** (`PORT` overrides). `npm start` uses 8880. Docker / compose listen on **8080**.

`server.listen` has no `error` handler. If something else already owns the port, Node exits with `EADDRINUSE`. Pick a free port (`PORT=3000 node scripts/proxy.js`) or stop the other listener. A static `python3 -m http.server 8080` and the proxy cannot share 8080.

SSL Inspector, Security Headers (URL tab), and Redirect Checker default their proxy field to `http://localhost:8080/proxy/fetch?url=`. They do **not** read `window.LOCAL_PROXY`. If you started with `npm start` (8880) or `PORT=3000`, edit that field to match, or the fetch goes to a process that is not there.

Open `http://localhost:<the-port-you-actually-bound>/`. `/` is `NetEngKit.html`.

## Server tools greyed out (“Requires server mode”)

The sidebar still lists all 14 `server: true` tools. Greying is **inside** the tool: Network Scanner, Capture Toolkit, iPerf, Speed Test, and Packet Header Map send probe `GET /api/capabilities`. Client timeout is 1.5–2.5 s. Fetch failure (Pages, offline HTML, `file://`, proxy down) is treated as unavailable.

A `true` flag means `which <binary>` succeeded (or `python3 -c 'import scapy'`). Speed Test also short-circuits to unavailable on `file:` without probing. Network Scanner shows a separate “missing tools” state when the proxy answered but `ping` / `nslookup` / `timeout` / `gawk` are not all on `PATH`.

A laptop `node scripts/proxy.js` often has none of those binaries. The fat Docker image installs them. Capabilities table: [Configuration](../CONFIGURATION/README.md).

`which` succeeding is not the same as being allowed to open a raw socket — next section.

## tcpdump / nmap: permission denied (`NET_RAW`)

`/api/capabilities` does not check Linux capabilities. Compose grants `cap_add: NET_RAW`. A plain `docker run -p 8080:8080 …` does not. The UI can show tcpdump/nmap as available, then the spawn fails at the kernel (`Operation not permitted` / similar on the SSE stream — `scripts/proxy.js` forwards tcpdump stderr).

```bash
docker run -p 8080:8080 --cap-add=NET_RAW netengkit
```

Or use compose. Do not publish that port on an untrusted network — anyone who can reach it can drive nmap/tcpdump/scapy. [docker.md](../DEPLOYMENT/docker.md).

The i18n string `cap_needs_net_raw` exists; Capture Toolkit does not currently render it. Expect the binary’s own error, not a dedicated badge.

## CORS / proxy failures

APIs such as SSL Labs do not send `Access-Control-Allow-Origin`. The proxy fetches them server-side (`GET /proxy/fetch?url=<encoded>`) and always adds `Access-Control-Allow-Origin: *`. Timeout is 30 seconds. Missing `?url=` is 400; upstream failure is 502.

If the proxy is not running, the browser talks to SSL Labs (or to `http://localhost:8080/proxy/fetch?…`) and you get a CORS error or a connection refused. Start `node scripts/proxy.js` or Docker, then set the proxy field if `PORT` is not 8080.

Security Headers has a paste-raw tab that never hits the network. SSL Inspector and Redirect Checker do not.

Pages / offline HTML / `file://` never inject `window.LOCAL_PROXY`. Only ASN Lookup (IP mode) and Packet Header Map read that global.

## CDN / fonts blocked

Source `NetEngKit.html` and `NetEngKit-file.html` load React 18, Babel Standalone, and js-yaml from **unpkg**, plus Inter / JetBrains Mono from **Google Fonts**. On a network that blocks those hosts the page does not render (or renders with fallback fonts and then dies on missing React).

Use the offline HTML, GitHub Pages, or the Docker image. Those three serve a bundle with React, fonts, and CSS inlined. They still cannot run the 11 `online: true` tools without outbound internet.

Two extra runtime fetches, even after a bundle:

- Mermaid (diagram tools): bundled blob in the offline/Pages/Docker HTML from gitignored `mermaid.min.js` (downloaded once by `npm install` / `scripts/build/fetch-mermaid.js`, otherwise fetched at bundle time). Runtime without a bundle uses `cdn.jsdelivr.net/npm/mermaid@11`. Attribution: `mermaid.LICENSE` (MIT).
- Hash Generator fallback: `js-sha256` / `js-sha512` / `js-sha1` from jsDelivr, only when `crypto.subtle` is missing (non-HTTPS, including some `file://` contexts). HTTPS and `localhost` use Web Crypto.

## Stale `file://` or offline HTML after an edit

`build:file` and `build:offline` write gitignored snapshots (`NetEngKit-file.html`, `NetEngKit-offline.html`). Editing `components/*.jsx` does not update those files. Refreshing the generated HTML shows the last build.

Re-run the matching command. Docker’s UI is the HTML copied at **image** build time — rebuild the image (or `docker compose up --build`) after component changes. Serving source `NetEngKit.html` over HTTP (`python3 -m http.server 8080` or `node scripts/proxy.js` from a clone) does not need a rebuild; refresh is enough. Babel still XHRs the JSX.

## `Cannot find module 'esbuild'` / `npm install` missing

Both bundlers `require('./compile-jsx')`; that file `require`s **esbuild** (`devDependencies ^0.28.0`). A clone that runs `npm run build:offline` or `npm run build:file` without `npm install` dies there.

```bash
npm install
npm run build:offline   # or build:file
```

Dockerfile (`npm install`) and CI (`npm ci`) already install it. `node scripts/proxy.js` does **not** — that file uses Node built-ins only. Do not attach the zero-dependency claim to the bundlers.
