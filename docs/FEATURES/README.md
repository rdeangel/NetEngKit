# Features

Area pages follow `group:` (and `server:` / `online:`) on the `TOOLS` array in `components/app.jsx`. They are a map, not a second catalog. Inputs, tabs, and keywords stay in [TOOLS.md](../../TOOLS.md).

Most of the **119** registry entries run in the browser. **Fourteen** need the optional local server. **Eleven** of those fourteen also need the internet. Those fourteen are collected on [diagnostics.md](diagnostics.md) even when their `group:` is Routing.

Six client-only Tools entries have no `###` heading yet — named on [utilities.md](utilities.md).

| Area | Registry count | Page |
|------|----------------|------|
| Addressing (IPv4 + IPv6 + both + multicast) | 16 | [addressing.md](addressing.md) |
| Switching | 10 | [switching.md](switching.md) |
| Routing | 11 | [routing.md](routing.md) |
| Infrastructure | 26 | [infrastructure.md](infrastructure.md) |
| Diagnostics (`server: true`) | 14 | [diagnostics.md](diagnostics.md) |
| Utilities (client-only Tools) | 41 | [utilities.md](utilities.md) |
| Media and education | 3 | [media-and-education.md](media-and-education.md) |

The column sums to 121 because Diagnostics also lists the two Routing server tools (`bgp-lg`, `asn`). Unique registry size is 119 with MACsec added.

How to run the server tools: [running.md](../SETUP/running.md). Ports and capabilities: [Configuration](../CONFIGURATION/README.md).
