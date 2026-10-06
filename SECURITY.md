# Security

Report a vulnerability, a bad formula, or a misquoted default as a [GitHub Issue](https://github.com/rdeangel/NetEngKit/issues). There is no private advisory mailbox yet — do not put credentials or exploit PoCs in the public issue. A one-line description of the class of bug is enough; we will ask for a private follow-up if needed.

## What this software can do on a network

When `scripts/proxy.js` or the Docker image is running, the server exposes backend capabilities that can drive:

- nmap
- tcpdump / tshark
- scapy packet send
- iperf / iperf3

`NET_RAW` is a run-time choice (`docker run --cap-add=NET_RAW` or compose `cap_add`). Without it, capture and some scan paths fail at the kernel; with it, they work. `/api/capabilities` only checks that the binary is on `PATH` — it does not tell you whether the process may open a raw socket.

### Threat model & local server security

- **Static / Offline mode:** GitHub Pages and the offline HTML file do not run `proxy.js` and cannot spawn host binaries.
- **Server / Docker mode:** Binding the server to localhost alone does **not** protect against malicious websites visited in your browser (cross-origin requests or DNS rebinding can still target localhost).
- To protect against unauthorized browser-driven execution, `proxy.js` enforces a random per-process session token (`NetEngKit-Token`, issued as an HttpOnly, `SameSite=Strict` cookie on HTML load and accepted via `X-NetEngKit-Token`), strictly validates the `Host` header against an allow-list to block DNS rebinding, and disables wildcard CORS.
- The session token rotates on every process start.
- If accessing the server remotely or in a container via LAN IP or custom domain, set `NETENGKIT_HOSTS` (comma-separated list of permitted hostnames or IP addresses, e.g. `NETENGKIT_HOSTS=netengkit.lan,192.168.1.100`) to allow those Host headers.
- Do **not** publish the port on an untrusted network or expose it without proper network access controls.

The 11 `online: true` tools call public APIs (RIPE Stat, rdap.org, SSL Labs, and similar). Treat their output as you would any other third-party lookup.

## Client kit

The browser tools are calculators, parsers, and generators. They do not grant this process extra host privileges. Still, do not paste production secrets into a shared browser profile; the Config Redactor exists for a reason.
