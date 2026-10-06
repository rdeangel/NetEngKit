# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.1] - 2026-10-06

### Since v1.1.0
### ✨ Features
- feat(tools): list capture interfaces and rotate auto pcap filenames ([649b2e8](https://github.com/rdeangel/NetEngKit/commit/649b2e8))
- feat(security): add session token auth and Host allow-list to proxy ([2a0afbc](https://github.com/rdeangel/NetEngKit/commit/2a0afbc))
### 📝 Chore
- chore(scripts): remove one-off i18n helpers and test-doh.js ([f606e8e](https://github.com/rdeangel/NetEngKit/commit/f606e8e))

## [1.1.0] - 2026-10-05

### Since v1.0.0
### ✨ Features
- feat(tools): add EIGRP classic vs wide metric calculator panel ([7d3f331](https://github.com/rdeangel/NetEngKit/commit/7d3f331))
- feat(tools): add IPv4 fragmentation & PMTUD simulator ([985121e](https://github.com/rdeangel/NetEngKit/commit/985121e))
- feat(tools): raise firewall translator input cap and warn on truncation ([8bdc4de](https://github.com/rdeangel/NetEngKit/commit/8bdc4de))
- feat(tools): add VLAN planner & allocator with site-aware subnet audit ([64d4282](https://github.com/rdeangel/NetEngKit/commit/64d4282))
- feat(tools): add STP/RSTP root bridge & port role election simulator ([a940478](https://github.com/rdeangel/NetEngKit/commit/a940478))
- feat(tools): rebuild device converter firewall path as policy translator ([2dd91d1](https://github.com/rdeangel/NetEngKit/commit/2dd91d1))
- feat(tools): add firewall rule shadowing & redundancy analyzer ([559c786](https://github.com/rdeangel/NetEngKit/commit/559c786))
- feat(tools): add keep-input option and raise regex extra group cap ([d8a2cef](https://github.com/rdeangel/NetEngKit/commit/d8a2cef))
- feat(tools): add network table sorter (row-preserving natural sort) ([31fbfae](https://github.com/rdeangel/NetEngKit/commit/31fbfae))
- feat(tools): add reverse DNS & RFC 2317 delegation generator ([8ed31e3](https://github.com/rdeangel/NetEngKit/commit/8ed31e3))
- feat(tools): add BGP AS-path regex & filter tester ([89526d6](https://github.com/rdeangel/NetEngKit/commit/89526d6))
- feat(tools): add private VLAN (PVLAN) designer ([6374f00](https://github.com/rdeangel/NetEngKit/commit/6374f00))
- feat(tools): add subnet host slicer ([c1c419d](https://github.com/rdeangel/NetEngKit/commit/c1c419d))
- feat(tools): add BGP best path selection simulator ([b753d5e](https://github.com/rdeangel/NetEngKit/commit/b753d5e))
- feat(tools): add CoPP / control plane policing config builder ([7067637](https://github.com/rdeangel/NetEngKit/commit/7067637))
- feat(tools): add IP SLA / TWAMP synthetic probe config builder ([fb2547b](https://github.com/rdeangel/NetEngKit/commit/fb2547b))
- feat(tools): add MACsec/802.1AE link encryption config builder ([ccf83d1](https://github.com/rdeangel/NetEngKit/commit/ccf83d1))
- feat(tools): add Erlang B/C voice trunk sizer ([2b8c927](https://github.com/rdeangel/NetEngKit/commit/2b8c927))
- feat(tools): add IPsec/IKEv2 site-to-site config builder ([730c5d9](https://github.com/rdeangel/NetEngKit/commit/730c5d9))
### 🐛 Bug Fixes
- fix(build): correct relative paths in sync-version.js ([2d48032](https://github.com/rdeangel/NetEngKit/commit/2d48032))
- fix(tools): polish MACsec key seeding and IP SLA/TWAMP labels ([5fdcf63](https://github.com/rdeangel/NetEngKit/commit/5fdcf63))
### ♻️ Refactor
- refactor(tools): fold subnet host slicer into subnetting planner ([eaf175f](https://github.com/rdeangel/NetEngKit/commit/eaf175f))
### 📚 Documentation
- docs: align tool and registry counts across catalog and guides ([ec27797](https://github.com/rdeangel/NetEngKit/commit/ec27797))
- docs(agents): document private feature planning ledgers ([9e05590](https://github.com/rdeangel/NetEngKit/commit/9e05590))
### 📝 Chore
- chore(skills): expose add-tool skill to Claude Code ([669845b](https://github.com/rdeangel/NetEngKit/commit/669845b))

## [1.0.0]

First public release of NetEngKit.

### Added

- **Sub-tool Discovery for Consolidated Toolkits** — Restored discoverability of sub-tools within consolidated toolkits (Multicast Toolkit, Cypher Deck, Capture Toolkit, Wireless & RF Planner, Zigbee Toolkit, Format Toolkit, JWT Toolkit) across all four discovery surfaces: sidebar navigation (nested rows), sidebar search, Ctrl+K command palette, and Ctrl+Alt+H help modal. Sub-tools are defined via a `subTools` registry field that reuses existing i18n keys for labels and supports English-only keywords for search. Each sub-tool deep-links directly to its tab/sub-tab via explicit navigation parameters.
