# Configuration

NetEngKit has a handful of real knobs: listen port, the CORS proxy, host-binary capabilities, and UI language. There is no product REST API and no config file. `/api/*` routes in `scripts/proxy.js` are helpers the app calls; they are not a public surface.

Most of the 132 registry entries run in the browser with no server. Fourteen are flagged `server: true`. Eleven of those fourteen are also `online: true`. Run modes: [running.md](../SETUP/running.md). Catalog: [TOOLS.md](../../TOOLS.md).

## PORT

`scripts/proxy.js` binds `process.env.PORT || '8080'`. Default listen port is **8080** (`PORT` overrides). `npm start` uses 8880.

| How you start it | Port |
|------------------|------|
| `node scripts/proxy.js` | **8080** |
| `PORT=3000 node scripts/proxy.js` | 3000 |
| `npm start` (`package.json`) | **8880** — convenience, not the default |
| Docker / compose | **8080** (`EXPOSE`, `PORT=8080`, map `8080:8080`) |

Open `http://localhost:<port>/`. `/` serves `NetEngKit.html`. Change the container mapping if you change `PORT` inside Docker; see [docker.md](../DEPLOYMENT/docker.md).

## NETENGKIT_HOSTS

To protect against DNS rebinding attacks, `scripts/proxy.js` validates the HTTP `Host` header against an allow-list (`localhost`, `127.0.0.1`, `::1`, and the host's local network interface IP addresses).

When running in a container, behind a reverse proxy, or accessing NetEngKit from another device on your LAN using a custom hostname, domain, or IP address, pass the `NETENGKIT_HOSTS` environment variable:

```bash
# Allow any host (recommended for reverse proxies or trusted home/lab setups)
NETENGKIT_HOSTS=* node scripts/proxy.js

# Allow all private RFC 1918 subnets (10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16)
NETENGKIT_HOSTS=lan node scripts/proxy.js

# Allow specific CIDR subnets or wildcard domains
NETENGKIT_HOSTS=192.168.1.0/24,*.lan,*.local node scripts/proxy.js

# Allow specific hostnames or IP addresses
NETENGKIT_HOSTS=netengkit.lan,192.168.1.100 node scripts/proxy.js
```

Or in `docker-compose.yml`:

```yaml
environment:
  - NETENGKIT_HOSTS=*  # or: lan, 192.168.1.0/24, myhost.lan
```

Requests with unrecognised `Host` headers receive HTTP 403 (`Host "<received>" not allowed. Set NETENGKIT_HOSTS to allow this host`).

## CORS proxy (`/proxy/fetch`)

APIs such as SSL Labs do not send `Access-Control-Allow-Origin`. The proxy fetches them server-side:

```
GET /proxy/fetch?url=<encoded-target>
```

Requests require authentication (session token via cookie, `X-NetEngKit-Token`, or `nekToken`). The proxy enforces:
- **HTTPS-only:** Plain `http://` targets are rejected (HTTP 502).
- **Private IP blocking:** RFC 1918, loopback, link-local, multicast, and cloud metadata (`169.254.169.254`) addresses are blocked.
- **Resource caps:** Maximum 3 redirects (pass `&follow=0` to inspect intermediate redirects) and a 2 MiB response body limit.
- **Sandboxed output:** Standard requests return `text/plain` with `X-Content-Type-Options: nosniff` and `Content-Security-Policy: sandbox`.
- **Metadata mode:** Pass `&meta=1` to receive `{ status, headers }` as JSON (used by Security Headers and Redirect Checker).

Missing `?url=` is HTTP 400. Upstream timeout is **30 seconds**. Fetch failure is HTTP 502.

This is the same process as the static file server. `scripts/proxy.js` uses Node built-ins only — no `npm install` for the proxy itself.

## `window.LOCAL_PROXY`

Every HTML response from the proxy has this injected before `</head>`:

```html
<script>window.LOCAL_PROXY = '/proxy/fetch?url=';</script>
```

The value is a **relative** prefix, so it follows whatever `PORT` you chose.

What actually reads it (verified in `components/`):

- **BGP / ASN Lookup** (IP mode) prefixes `ipwhois.app` with `LOCAL_PROXY` when it is set; without it, the browser hits the API directly.
- **Packet Header Map** only probes `/api/capabilities` (and Scapy send) when `LOCAL_PROXY` is set — a cheap “is the proxy serving this page?” gate.

SSL Inspector, Security Headers (URL tab), and Redirect Checker do **not** read `window.LOCAL_PROXY`. Each has a proxy URL field that defaults to the absolute string `http://localhost:8080/proxy/fetch?url=`. If you changed `PORT`, edit that field. Pages / offline HTML / `file://` never inject `LOCAL_PROXY`.

## `/api/capabilities`

`GET /api/capabilities` returns JSON. The UI uses it to enable or grey out host-binary features. A `true` flag means `which <binary>` succeeded (or `python3 -c 'import scapy'` for Scapy). It does **not** mean the process has `NET_RAW` or that a raw-socket call will work. Compose grants `NET_RAW`; plain `docker run -p 8080:8080` does not.

| JSON key | How it is decided | Used by |
|----------|-------------------|---------|
| `pingSweep` | `ping`, `nslookup`, `timeout`, and `gawk` all present | Network Scanner ping-sweep |
| `nmap` | `which nmap` | Network Scanner nmap tab |
| `fping` | `which fping` | Network Scanner fping tab |
| `tcpdump` | `which tcpdump` | Capture Toolkit |
| `tshark` | `which tshark` | Capture Toolkit |
| `speedtest` | `which speedtest` (Ookla CLI) | Speed Test (Ookla tab) |
| `librespeed` | `which librespeed-cli` | Speed Test (LibreSpeed tab) |
| `iperf3` | `which iperf3` | iPerf Command Builder |
| `iperf2` | `which iperf` | iPerf Command Builder (iperf2) |
| `scapy` | `python3 -c 'import scapy'` | Packet Header Map send |
| `localIP` / `localIPv4` / `localIPv6` | first non-loopback addresses | Packet Header Map auto-fill |
| `tools` | raw map of every `which` check, including the four ping-sweep binaries | debugging |

Timeout on the client is 1.5–2.5 s depending on the tool. Fetch failure (proxy not running, `file://`, Pages) is treated as “unavailable.” The fat Docker image installs the binaries; a laptop `node scripts/proxy.js` often does not.

Do not treat the other `/api/*` paths as a documented API. They exist so those same components can spawn nmap, tcpdump, iperf, DoH, and so on.

## Internet vs proxy vs nothing

Sidebar badges and search (`online` / `server`) come from `components/app.jsx` `TOOLS`. Quote those flags; they are the product split.

| Need | Count | What it means in practice |
|------|-------|---------------------------|
| Nothing extra | **118** of 132 | No `server` / `online` flag. Calculators, parsers, references. |
| Local server, no extra internet | **3** | `scanner`, `iperf`, `wireshark`. Talk to `/api/*` and host binaries. |
| Local server **and** internet | **11** | Also `online: true`. Mixed: some call `/api/*`, some need `/proxy/fetch`, some fetch public APIs from the browser. |

The eleven `online: true` ids: `bgp-lg`, `asn`, `dns`, `whois`, `email-diag`, `diag`, `speedtest`, `geo`, `ssl`, `redircheck`, `sechdrs`.

Runtime (code, not the flag name):

- **Need `/api/*` plus binaries:** Network Scanner, iPerf, Capture Toolkit, Speed Test. Packet Header Map send is the same idea but is a reference page, not a `server: true` entry.
- **Need `/api/*` for DNS:** DNS Lookup (`/api/dns-lookup`, `/api/doh-lookup`). Needs outbound internet from the server.
- **Need the CORS proxy field:** SSL Inspector (SSL Labs), Security Headers URL tab, Redirect Checker. Defaults assume port 8080. Security Headers also has a paste-raw tab that is client-only.
- **Browser fetch to public APIs:** BGP Looking Glass and ASN (RIPE Stat), WHOIS (rdap.org), Email Diagnostics (dns.google), GeoIP (ip-api.com / ipinfo.io; ipwhois.app only on `file://` because it lacks CORS on real HTTP origins), Remote Ping (no-cors timing + links out). They are still flagged `server`/`online` in the registry so the UI badges them.

Loading the **app** is a separate question: source `NetEngKit.html` and `NetEngKit-file.html` still need unpkg and fonts; Pages, the offline HTML, and Docker do not. See [running.md](../SETUP/running.md).

## Language

Fifteen files under `languages/`, loaded as `<script>` tags from `NetEngKit.html`. `en.js` is the source of truth.

| Code | Language |
|------|----------|
| `en` | English |
| `zh-CN` / `zh-TW` | Chinese (Simplified / Traditional) |
| `fr` `de` `hi` `it` `ja` `ko` `pl` `pt` `pt-BR` `ru` `es` `vi` | French, German, Hindi, Italian, Japanese, Korean, Polish, Portuguese, Portuguese (Brazil), Russian, Spanish, Vietnamese |

Selection: hamburger menu → Language, or **Ctrl+L** / **Cmd+L** to cycle. Stored in `localStorage` key `NetEngKit-lang`. First visit: exact `navigator.language`, then the language prefix, then `en`. Missing keys fall back to English.

Adding strings: edit `languages/en.js` first, then the `i18n-fill-sections` skill. See [development.md](../SETUP/development.md).
