# Releases

A GitHub tag matching `v*.*.*` (for example `v1.0.0`) runs `.github/workflows/release.yml`. Users get three artifacts. This page is what to download and run — not how the maintainer cuts the tag.

Current version is `package.json` and [GitHub Releases](https://github.com/rdeangel/NetEngKit/releases).

## GitHub Pages

The workflow bundles `NetEngKit.html` to `index.html` and deploys that single file as the Pages site. No CDN at runtime. Server tools are unavailable — there is no `proxy.js` on Pages.

https://rdeangel.github.io/NetEngKit/

Same file as the offline HTML artifact below, served over HTTPS.

Set the GitHub repo Pages source to **GitHub Actions** before the first tag. If it is still “Deploy from a branch”, `deploy-pages` fails and the Release job does not run.

## Offline HTML

Release asset name: `NetEngKit-vX.Y.Z-Offline.html` (workflow: `NetEngKit-${GITHUB_REF_NAME}-Offline.html`). Attached to the GitHub Release.

Open the file in a browser. No Node, no Docker, no CDN. The 14 `server: true` tools stay unavailable.

Building that file yourself: `npm install` then `npm run build:offline`. The bundler needs `esbuild` (`devDependency`). See [development.md](../SETUP/development.md).

## Docker images

The same tag builds a multi-arch image (`linux/amd64`, `linux/arm64`, `linux/arm/v7`) and always pushes it to **GHCR** with semver tags `X.Y.Z`, `X.Y`, `X`, and `latest`. Docker Hub publish is skipped when `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` are unset.

GHCR (owner/repo lowercased, matching the workflow release notes):

```bash
docker pull ghcr.io/rdeangel/netengkit:latest
```

When Hub secrets are set, the image is also pushed to `${DOCKERHUB_USERNAME}/netengkit` and the GitHub Release notes print that `docker pull` line. GHCR is always printed.

Then run as in [docker.md](docker.md) (`-p 8080:8080`, `--cap-add=NET_RAW` if you need capture/scan). Compose in this repo builds locally as `netengkit:latest`; it does not pull GHCR or Hub unless you change the `image:` line.

## What a tag does not ship

Pages and the offline HTML are the client kit only. Diagnostics that need nmap, tcpdump, iperf, or the CORS proxy need the Docker image (or `node scripts/proxy.js` plus those binaries on the host).
