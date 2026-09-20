<div align="center">
  <img src="logo.svg" width="80" height="80" alt="NetEngKit Logo" style="margin-bottom: 20px;">

  # NetEngKit
  A browser-based network engineering toolkit (addressing, multicast, routing, switching, diagnostics, and related utilities). React 18 + Babel Standalone in `NetEngKit.html`.
</div>

> **Disclaimer:** The reference content, protocol summaries, and tool outputs in this toolkit were researched and authored with the assistance of AI (large language models). I've reviewed as much as I could, but not everything — LLMs can occasionally produce inaccurate or hallucinated information. If you spot something that looks wrong — a bad formula, a misquoted RFC, an incorrect default — please open an issue. Corrections are always welcome.

## Try it

- **GitHub Pages** — https://rdeangel.github.io/NetEngKit/ — bundled HTML, no CDN at runtime. Server tools are unavailable there (no `proxy.js`).
- **Offline HTML** — download `NetEngKit-vX.Y.Z-Offline.html` from [GitHub Releases](https://github.com/rdeangel/NetEngKit/releases) and open it locally. Same file Pages serves.
- **Docker** (bundled UI + `proxy.js` + host binaries):

```bash
docker pull ghcr.io/rdeangel/netengkit:latest
docker run -p 8080:8080 --cap-add=NET_RAW ghcr.io/rdeangel/netengkit:latest
# then open http://localhost:8080
```

Docker Hub is optional: the release workflow pushes there only when `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` are set. Release notes print a Hub `docker pull` line when that publish ran; GHCR is always printed. Compose in this repo builds locally as `netengkit:latest` — [docker.md](docs/DEPLOYMENT/docker.md). Anyone who can reach the published port can drive nmap, tcpdump, and scapy. Do not expose it on an untrusted network.

From a clone, `node scripts/proxy.js` listens on **8080** (`PORT` overrides). `npm start` is the same server with `PORT=8880`. Modes: [running.md](docs/SETUP/running.md).

## Client vs server

The in-app registry (`components/app.jsx` `TOOLS`) has **118** entries: **104** tools and **14** references. Most run in the browser with no server. **Fourteen** (`server: true`) need the optional Node process (`scripts/proxy.js` or Docker). **Eleven** of those fourteen also need the internet (`online: true`). There is no product REST API.

Default listen port is **8080** (`PORT` overrides). `npm start` uses 8880. Building `NetEngKit-offline.html` or `NetEngKit-file.html` needs `npm install` first (`esbuild`). Only `scripts/proxy.js` is Node-built-ins-only.

## Documentation

- [Documentation index](docs/DOCUMENTATION_INDEX.md)
- [How to run](docs/SETUP/running.md) · [Development](docs/SETUP/development.md)
- [Docker](docs/DEPLOYMENT/docker.md) · [Releases](docs/DEPLOYMENT/releases.md)
- [Configuration](docs/CONFIGURATION/README.md)
- [Features](docs/FEATURES/README.md) — area map into [TOOLS.md](TOOLS.md)
- [Troubleshooting](docs/TROUBLESHOOTING/README.md)
- [CONTRIBUTING](CONTRIBUTING.md) · [SECURITY](SECURITY.md)
- [CHANGELOG](CHANGELOG.md)

## License

[MIT](LICENSE).

## Issues

Bugs, bad formulas, and corrections: [github.com/rdeangel/NetEngKit/issues](https://github.com/rdeangel/NetEngKit/issues).
