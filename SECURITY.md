# Security

Report a vulnerability, a bad formula, or a misquoted default as a [GitHub Issue](https://github.com/rdeangel/NetEngKit/issues). There is no private advisory mailbox yet — do not put credentials or exploit PoCs in the public issue. A one-line description of the class of bug is enough; we will ask for a private follow-up if needed.

## What this software can do on a network

The Docker image and `scripts/proxy.js` expose an **unauthenticated HTTP port**. Anyone who can reach it can drive:

- nmap
- tcpdump / tshark
- scapy packet send
- iperf / iperf3

`NET_RAW` is a run-time choice (`docker run --cap-add=NET_RAW` or compose `cap_add`). Without it, capture and some scan paths fail at the kernel; with it, they work. `/api/capabilities` only checks that the binary is on `PATH` — it does not tell you whether the process may open a raw socket.

Do **not** publish that port on an untrusted network. Bind it to localhost, put it behind a VPN, or do not run the server tools at all. GitHub Pages and the offline HTML file do not include `proxy.js`; those surfaces cannot spawn host binaries.

The 11 `online: true` tools call public APIs (RIPE Stat, rdap.org, SSL Labs, and similar). Treat their output as you would any other third-party lookup.

## Client kit

The browser tools are calculators, parsers, and generators. They do not grant this process extra host privileges. Still, do not paste production secrets into a shared browser profile; the Config Redactor exists for a reason.
