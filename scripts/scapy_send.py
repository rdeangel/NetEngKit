#!/usr/bin/env python3
"""Send a single crafted packet via Scapy. Called by proxy.js /api/scapy-send.

Usage:
  python3 scapy_send.py ipv4 <hex>
  python3 scapy_send.py ipv6 <hex>
  python3 scapy_send.py tcp  <hex> <src_ip> <dst_ip>
  python3 scapy_send.py udp  <hex> <src_ip> <dst_ip>

Prints "ok iface=<iface> dst_mac=<mac>" on success, "error: <msg>" on failure.
"""
import sys
import re
import subprocess


def get_route_v4(dst_ip):
    """Return (iface, next_hop) for dst_ip.

    Tries `ip route get` first (kernel-authoritative, requires iproute2).
    Falls back to Scapy's own routing table if `ip` is not on PATH.

    `ip route get` output examples:
      routed:  "8.8.8.8 via 172.17.0.1 dev eth0 src 172.17.0.2 uid 0"
      direct:  "192.168.1.5 dev eth0 src 192.168.1.2 uid 0"
    """
    try:
        out = subprocess.check_output(
            ['ip', 'route', 'get', dst_ip], text=True, timeout=3
        )
        via = re.search(r'\bvia\s+(\S+)', out)
        dev = re.search(r'\bdev\s+(\S+)', out)
        if dev:
            return dev.group(1), via.group(1) if via else dst_ip
    except FileNotFoundError:
        pass  # iproute2 not installed — fall through to Scapy fallback
    except Exception as e:
        raise RuntimeError(f'ip route get {dst_ip}: {e}')

    # Scapy fallback: conf.route.route returns (iface, src_ip, gw_ip)
    from scapy.all import conf
    iface, _, gw = conf.route.route(dst_ip)
    next_hop = dst_ip if (not gw or gw == '0.0.0.0') else gw
    return iface, next_hop


def get_route_v6(dst_ip):
    """Return (iface, next_hop) for an IPv6 dst.

    Tries `ip -6 route get` first, falls back to Scapy's route6 table.
    conf.route6.route returns (iface, next_hop, src_ip).
    """
    try:
        out = subprocess.check_output(
            ['ip', '-6', 'route', 'get', dst_ip], text=True, timeout=3
        )
        via = re.search(r'\bvia\s+(\S+)', out)
        dev = re.search(r'\bdev\s+(\S+)', out)
        if dev:
            return dev.group(1), via.group(1) if via else dst_ip
    except FileNotFoundError:
        pass
    except Exception as e:
        raise RuntimeError(f'ip -6 route get {dst_ip}: {e}')

    from scapy.all import conf
    iface, nh, _ = conf.route6.route(dst_ip)
    next_hop = dst_ip if (not nh or nh in ('::', '::0')) else nh
    return iface, next_hop


def resolve_mac_v4(next_hop, iface):
    from scapy.all import getmacbyip
    mac = getmacbyip(next_hop)
    if not mac:
        raise RuntimeError(f'ARP failed for {next_hop} on {iface}')
    return mac


def resolve_mac_v6(next_hop, iface):
    from scapy.all import getmacbyip6
    mac = getmacbyip6(next_hop)
    if not mac:
        raise RuntimeError(f'NDP failed for {next_hop} on {iface}')
    return mac


def main():
    if len(sys.argv) < 3:
        print('error: insufficient arguments', flush=True)
        sys.exit(1)

    proto   = sys.argv[1]
    hex_str = sys.argv[2]

    try:
        raw = bytes.fromhex(hex_str)
    except ValueError as e:
        print(f'error: invalid hex: {e}', flush=True)
        sys.exit(1)

    try:
        from scapy.all import Ether, IP, IPv6, TCP, UDP, Raw, sendp, get_if_hwaddr
    except ImportError:
        print('error: scapy not installed', flush=True)
        sys.exit(1)

    try:
        if proto == 'ipv4':
            payload_hex      = sys.argv[3] if len(sys.argv) > 3 else ''
            ip_pkt           = IP(raw)
            del ip_pkt.chksum   # let Scapy recompute over actual packet contents
            del ip_pkt.len      # let Scapy set correct total length
            iface, next_hop  = get_route_v4(ip_pkt.dst)
            dst_mac          = resolve_mac_v4(next_hop, iface)
            src_mac          = get_if_hwaddr(iface)
            pkt              = Ether(src=src_mac, dst=dst_mac) / ip_pkt

        elif proto == 'ipv6':
            payload_hex      = sys.argv[3] if len(sys.argv) > 3 else ''
            ip_pkt           = IPv6(raw)
            del ip_pkt.plen     # let Scapy set correct payload length
            iface, next_hop  = get_route_v6(ip_pkt.dst)
            dst_mac          = resolve_mac_v6(next_hop, iface)
            src_mac          = get_if_hwaddr(iface)
            pkt              = Ether(src=src_mac, dst=dst_mac) / ip_pkt

        elif proto in ('tcp', 'udp'):
            if len(sys.argv) < 5:
                print('error: tcp/udp requires src and dst IP arguments', flush=True)
                sys.exit(1)
            src_ip, dst_ip   = sys.argv[3], sys.argv[4]
            payload_hex      = sys.argv[5] if len(sys.argv) > 5 else ''
            iface, next_hop  = get_route_v4(dst_ip)
            dst_mac          = resolve_mac_v4(next_hop, iface)
            src_mac          = get_if_hwaddr(iface)
            if proto == 'tcp':
                inner = TCP(raw)
                del inner.chksum
            else:
                inner = UDP(raw)
                del inner.chksum
            pkt = Ether(src=src_mac, dst=dst_mac) / IP(src=src_ip, dst=dst_ip) / inner

        else:
            print(f'error: unknown proto: {proto}', flush=True)
            sys.exit(1)

        if payload_hex:
            pkt = pkt / Raw(bytes.fromhex(payload_hex))

        sendp(pkt, iface=iface, verbose=False)
        print(f'ok iface={iface} dst_mac={dst_mac}', flush=True)

    except Exception as e:
        print(f'error: {e}', flush=True)
        sys.exit(1)


main()
