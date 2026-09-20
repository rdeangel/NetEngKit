# Routing

Layer-3 config builders and protocol references. **11** registry entries. Two of them need the local server **and** the internet; the other nine run in the browser.

Catalog: [TOOLS.md](../../TOOLS.md). Section: [Routing & Layer 3](../../TOOLS.md#routing--layer-3).

## Client-side (9)

- [IP protocol reference](../../TOOLS.md#ip-proto-reference)
- [Routing config builder](../../TOOLS.md#routing-config-builder)
- [Cisco IOS-XR config builder](../../TOOLS.md#cisco-ios-xr-config-builder)
- [MPLS reference](../../TOOLS.md#mpls-reference)
- [VPN / IPsec architect](../../TOOLS.md#vpn--ipsec-architect)
- [WireGuard tunnel config builder](../../TOOLS.md#wireguard-tunnel-config-builder)
- [BGP community builder](../../TOOLS.md#bgp-community-builder)
- [FHRP calculator](../../TOOLS.md#fhrp-calculator)
- [Prefix list & route map builder](../../TOOLS.md#prefix-list--route-map-builder)

## Needs the local server (2)

Both are `server: true` and `online: true`. Greyed out on Pages / offline HTML / `file://`. Details: [diagnostics.md](diagnostics.md), [running.md](../SETUP/running.md).

- [BGP looking glass](../../TOOLS.md#bgp-looking-glass) (`bgp-lg`)
- [BGP / ASN lookup](../../TOOLS.md#bgp--asn-lookup) (`asn`)

The catalog also files [Device Config Parser](../../TOOLS.md#device-config-parser) under this heading. In the registry that tool is `group: 'Tools'` — it lives on [utilities.md](utilities.md).
