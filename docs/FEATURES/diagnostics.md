# Diagnostics

The **14** registry entries with `server: true`. They need `scripts/proxy.js` or the Docker image. **Eleven** of those fourteen also have `online: true` (they talk to the public internet). The other three (`scanner`, `iperf`, `wireshark`) talk to host binaries on the box running the proxy.

Without the server they are greyed out. `/api/capabilities` is how the UI learns which binaries exist — see [Configuration](../CONFIGURATION/README.md). Do not expose the Docker port on an untrusted network ([docker.md](../DEPLOYMENT/docker.md)).

Catalog: [TOOLS.md](../../TOOLS.md). Two of these (`bgp-lg`, `asn`) are `group: 'Routing'`; the other twelve are `group: 'Tools'`. Client-only Tools stay on [utilities.md](utilities.md).

## Needs the local server and the internet (11)

| Tool | Registry id | Catalog |
|------|-------------|---------|
| BGP looking glass | `bgp-lg` | [heading](../../TOOLS.md#bgp-looking-glass) |
| BGP / ASN lookup | `asn` | [heading](../../TOOLS.md#bgp--asn-lookup) |
| DNS lookup | `dns` | [heading](../../TOOLS.md#dns-lookup) |
| WHOIS lookup | `whois` | [heading](../../TOOLS.md#whois-lookup) |
| Email diagnostics | `email-diag` | [heading](../../TOOLS.md#email-diagnostics) |
| Remote ping / MTR | `diag` | [heading](../../TOOLS.md#remote-ping--mtr) |
| Speed test | `speedtest` | [heading](../../TOOLS.md#speed-test) |
| IP geolocation | `geo` | [heading](../../TOOLS.md#ip-geolocation) |
| SSL/TLS inspector | `ssl` | [heading](../../TOOLS.md#ssltls-inspector) |
| Redirect checker | `redircheck` | [heading](../../TOOLS.md#redirect-checker) |
| Security headers | `sechdrs` | [heading](../../TOOLS.md#security-headers) |

SSL Inspector, Security Headers, and Redirect Checker default their proxy URL field to `http://localhost:8080/proxy/fetch?url=`. They do not read `window.LOCAL_PROXY`. If `PORT` is not 8080, edit that field.

## Needs the local server only (3)

Host binaries. Compose grants `NET_RAW`; a plain `docker run -p 8080:8080` does not.

| Tool | Registry id | Catalog | Typical binaries |
|------|-------------|---------|------------------|
| Network scanner | `scanner` | [heading](../../TOOLS.md#network-scanner) | nmap, fping, ping |
| iPerf command builder | `iperf` | [heading](../../TOOLS.md#iperf-command-builder) | iperf3 / iperf |
| Capture toolkit | `wireshark` | [heading](../../TOOLS.md#capture-toolkit) | tcpdump, tshark |

The catalog marks Capture Toolkit and Network Scanner as “Online”; the registry does not set `online: true` on them. The registry flag is the product split — they run against local binaries, not a public API.
