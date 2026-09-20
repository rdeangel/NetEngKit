# Docker

The image is a fat Node container: bundled UI plus `scripts/proxy.js` plus the host binaries the 14 `server: true` tools call. It is **not** source `NetEngKit.html` served with a CDN. The builder stage runs `npm install` then `node scripts/build/bundle.js NetEngKit.html -o NetEngKit.html`; the runtime stage copies that file and starts the proxy. React, Babel, and fonts are already in the HTML. The 11 `online: true` tools still need outbound internet.

Default listen port is **8080** (`PORT` overrides; `EXPOSE 8080`; `CMD` inherits `scripts/proxy.js` `process.env.PORT || '8080'`). Compose also sets `PORT=8080`. `npm start` uses 8880.

Other run modes (Pages, static HTTP, `node scripts/proxy.js` from a clone): [running.md](../SETUP/running.md). Pull URLs for published images: [releases.md](releases.md).

## What is in the image

Runtime base is `node:22-slim`. Copied in:

| Path | Role |
|------|------|
| `NetEngKit.html` | Offline bundle (overwrites the source filename) |
| `scripts/proxy.js` | Static server, CORS proxy at `/proxy/fetch?url=`, `/api/*` helpers. Serves `/` as `NetEngKit.html` and injects `window.LOCAL_PROXY` |
| `scripts/subnet_scan.sh` | Ping-sweep helper |
| `scripts/scapy_send.py` | Packet send helper (`/api/scapy-send`) |

Host packages installed in the runtime stage:

- nmap, fping, tcpdump, tshark, iperf, iperf3
- speedtest (Ookla), librespeed-cli
- python3, python3-scapy, iproute2
- ping (`iputils-ping`), dnsutils (`nslookup`)
- curl, ca-certificates, gnupg, coreutils, bash, gawk

`/api/capabilities` reports which of those binaries `which` can see (plus a Scapy import check). Missing binaries grey out the matching UI; present binaries do **not** imply the process can open raw sockets — that is `NET_RAW` (below).

## Run

Compose (repo root):

```bash
docker compose up
# then open http://localhost:8080
```

`docker-compose.yml` builds `.`, tags `netengkit:latest`, names the container `NetEngKit`, maps `8080:8080`, sets `PORT=8080`, adds `cap_add: NET_RAW`, and restarts `unless-stopped`.

Without compose:

```bash
docker build -t netengkit .
docker run -p 8080:8080 --cap-add=NET_RAW netengkit
```

Published images (no local build): [releases.md](releases.md). Map the same host port, and pass `--cap-add=NET_RAW` if you need capture or packet send. `docker run -p 8080:8080 …` without that cap still starts the UI and the proxy; nmap/tcpdump/scapy then fail at the kernel.

Change the listen port inside the container with `PORT`. Map it on the host to match:

```bash
docker run -p 3000:3000 -e PORT=3000 --cap-add=NET_RAW netengkit
```

## Security

Anyone who can reach the published port can drive the proxy helpers. Those routes spawn **nmap**, **tcpdump**, and **scapy** (and iperf, fping, speedtest, …) as the container user. Compose grants **`NET_RAW`**, which is the Linux capability those tools need for raw sockets and packet capture.

Do not publish this port on an untrusted network. Bind it to localhost or an admin VLAN. Treat the container like a diagnostic host you would not put on the internet.

`NET_RAW` is a compose/run choice, not something the Dockerfile sets. Drop the cap if you only need the bundled UI and the CORS proxy; keep it if you want scanner / capture / packet-send tools to actually work.
