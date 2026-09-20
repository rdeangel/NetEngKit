# Documentation index

NetEngKit is a browser-based network engineering toolkit (React 18 + Babel Standalone in `NetEngKit.html`). Most of the 118 registry entries run in the browser. Fourteen tools need the optional local server (`scripts/proxy.js` or Docker). There is no product REST API.

This hub is the map. The deep catalog stays at [TOOLS.md](../TOOLS.md).

## Start here

- [README](../README.md) — what it is and how to try it
- [TOOLS.md](../TOOLS.md) — the single tool catalog (inputs, outputs, tabs)
- [CHANGELOG](../CHANGELOG.md)
- [LICENSE](../LICENSE) — MIT

## Setup

- [Running](SETUP/running.md) — Pages / offline HTML, static server, proxy, Docker, `file://`
- [Development](SETUP/development.md) — `components/`, rebuilds, i18n, TOOLS.md obligation

## Deployment

- [Docker](DEPLOYMENT/docker.md) — image contents, compose, `PORT`, `NET_RAW`
- [Releases](DEPLOYMENT/releases.md) — GitHub Pages, offline HTML artifact, GHCR and Docker Hub

## Configuration

- [Configuration](CONFIGURATION/README.md) — `PORT`, `/proxy/fetch`, `window.LOCAL_PROXY`, `/api/capabilities`, language, internet vs proxy vs none

## Features

Short area pages. Each links into [TOOLS.md](../TOOLS.md). Not a second catalog.

- [Features index](FEATURES/README.md)
- [Addressing](FEATURES/addressing.md) — IPv4, IPv6, both, multicast
- [Switching](FEATURES/switching.md)
- [Routing](FEATURES/routing.md)
- [Infrastructure](FEATURES/infrastructure.md)
- [Diagnostics](FEATURES/diagnostics.md) — tools that need the server and/or the internet
- [Utilities](FEATURES/utilities.md) — client-only remainder of the Tools group
- [Media and education](FEATURES/media-and-education.md)

## Troubleshooting

- [Troubleshooting](TROUBLESHOOTING/README.md) — `file://` blank page, ports, greyed-out server tools, `NET_RAW`, CORS, blocked CDN, stale bundle, missing `npm install`

## Numbers

Recount from `components/app.jsx` `TOOLS` before changing a number.

| Fact | Value |
|---|---|
| Registry entries | 118 (104 tools, 14 references) |
| Need the local server (`server: true`) | 14 |
| Need the internet (`online: true`) | 11 (all 11 also `server: true`) |
| Proxy default port | 8080 (`PORT` overrides; `npm start` uses 8880) |
| License | MIT (`LICENSE`) |
