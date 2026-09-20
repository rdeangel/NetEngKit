# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0]

First public release of NetEngKit.

### Added

- **Sub-tool Discovery for Consolidated Toolkits** — Restored discoverability of sub-tools within consolidated toolkits (Multicast Toolkit, Cypher Deck, Capture Toolkit, Wireless & RF Planner, Zigbee Toolkit, Format Toolkit, JWT Toolkit) across all four discovery surfaces: sidebar navigation (nested rows), sidebar search, Ctrl+K command palette, and Ctrl+Alt+H help modal. Sub-tools are defined via a `subTools` registry field that reuses existing i18n keys for labels and supports English-only keywords for search. Each sub-tool deep-links directly to its tab/sub-tab via explicit navigation parameters.
