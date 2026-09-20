# Utilities

The **41** Tools-group entries that are **not** `server: true`. Calculators, parsers, generators, and config helpers that run in the browser. The other 12 Tools entries are on [diagnostics.md](diagnostics.md).

Catalog: [TOOLS.md](../../TOOLS.md), mostly under [Diagnostics & Tools](../../TOOLS.md#diagnostics--tools). Six of these 41 have no `###` heading yet — named in the last section, not given a fake anchor.

## DNS, syslog, SNMP, CLI, flow export (6)

[DNS zone file builder](../../TOOLS.md#dns-zone-file-builder), [syslog builder & parser](../../TOOLS.md#syslog-builder--parser), [SNMP command builder](../../TOOLS.md#snmp-command-builder), [SysTool CLI builder](../../TOOLS.md#systool-cli-builder), [CLI quick reference](../../TOOLS.md#cli-quick-reference), [flow export builder](../../TOOLS.md#flow-export-builder).

## Crypto, certs, encoding (8)

[Hash generator](../../TOOLS.md#hash-generator--verifier), [text & file encryption](../../TOOLS.md#text--file-encryption), [Cypher Deck](../../TOOLS.md#cypher-deck), [JWT toolkit](../../TOOLS.md#jwt-toolkit), [password generator](../../TOOLS.md#password-generator), [self-signed cert generator](../../TOOLS.md#self-signed-cert-generator), [certificate chain validator](../../TOOLS.md#certificate-chain-validator), [Cisco password types](../../TOOLS.md#cisco-password-types).

Certificate Chain Validator can call `/api/get-cert-chain` when the proxy is up; it is **not** `server: true` and still works as a client-side PEM checker.

## Device config and automation (12)

[Device config parser](../../TOOLS.md#device-config-parser), [device config converter](../../TOOLS.md#device-config-converter), [config redactor](../../TOOLS.md#config-redactor), [config diff viewer](../../TOOLS.md#config-diff-viewer), [SSH config generator](../../TOOLS.md#ssh-config-generator), [NX-API request builder](../../TOOLS.md#nx-api--nexus-request-builder), [Arista eAPI builder](../../TOOLS.md#arista-eapi-builder), [Cisco DNAC builder](../../TOOLS.md#cisco-dnac-builder), [Ansible inventory converter](../../TOOLS.md#ansible-inventory-converter), [Terraform snippet builder](../../TOOLS.md#terraform-snippet-builder), [LLDP/CDP parser](../../TOOLS.md#lldp--cdp-parser), [routing table parser](../../TOOLS.md#routing-table-parser).

Parser and converter headings sit under Routing / Switching in the catalog. Registry `group:` is Tools.

## Text, diagrams, units, ops (9)

[Format toolkit](../../TOOLS.md#format-toolkit), [regex find & replace](../../TOOLS.md#regex-find--replace), [hex dump / ASCII decoder](../../TOOLS.md#hex-dump--ascii-decoder), [ASCII network diagram](../../TOOLS.md#ascii-network-diagram), [Mermaid network diagram](../../TOOLS.md#mermaid-network-diagram), [data unit converter](../../TOOLS.md#data-unit-converter), [uptime & SLA calculator](../../TOOLS.md#uptime--sla-calculator), [country & timezone reference](../../TOOLS.md#country--timezone-reference), [traffic generator (Scapy/TRex)](../../TOOLS.md#traffic--load-generator) (command/profile builder — not the host-binary capture path).

## In the app, no catalog heading yet (6)

These ids are in `components/app.jsx`. [TOOLS.md](../../TOOLS.md) has no `###` for them (114 headings vs 118 registry entries; two extra catalog headings are leftover). Treat the app as source of truth until the catalog headings catch up.

- Bandwidth & Throughput (`bandwidth`)
- TLS Cipher Suite Decoder (`cipher-suite`)
- Timestamp Converter (`tsconv`)
- Cron Parser (`cronparse`)
- User Agent Parser (`uaparse`)
- Config Templater (`config-template`)
