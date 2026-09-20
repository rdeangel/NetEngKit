#!/usr/bin/env node
// proxy.js — Static file server + CORS proxy for Docker / local use.
//
// Serves the app at http://localhost:PORT/ and exposes a server-side CORS
// proxy at /proxy/fetch?url=<encoded> so browser tools can reach APIs that
// don't send Access-Control-Allow-Origin headers (e.g. SSL Labs).
//
// Injects window.LOCAL_PROXY into HTML responses so components automatically
// use the local proxy instead of a public CORS relay like allorigins.win.
//
// Zero npm dependencies — Node built-ins only.
//
// Usage:
//   node scripts/proxy.js            # port 8080
//   PORT=3000 node scripts/proxy.js  # custom port

'use strict';

const http    = require('http');
const http2   = require('http2');
const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const url     = require('url');
const { execFileSync, spawn } = require('child_process');

const PORT = parseInt(process.env.PORT || '8080', 10);
const ROOT = path.join(__dirname, '..');

/** Return the first non-loopback IPv4 and IPv6 addresses on this host. */
function getLocalIPs() {
  const os = require('os');
  let ipv4 = null, ipv6 = null;
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of (addrs || [])) {
      if (addr.internal) continue;
      if (!ipv4 && addr.family === 'IPv4') ipv4 = addr.address;
      if (!ipv6 && addr.family === 'IPv6' && !addr.address.startsWith('fe80')) ipv6 = addr.address;
    }
    if (ipv4 && ipv6) break;
  }
  return { ipv4, ipv6 };
}

function getLocalIP() { return getLocalIPs().ipv4 || '127.0.0.1'; }

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript',
  '.jsx':  'text/javascript',
  '.css':  'text/css',
  '.json': 'application/json',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.txt':  'text/plain',
};

// ---------------------------------------------------------------------------
// Upstream fetch (follows one redirect, 15s timeout)
// ---------------------------------------------------------------------------

function fetchUpstream(targetUrl) {
  return new Promise((resolve, reject) => {
    const mod = targetUrl.startsWith('https') ? https : http;
    const req = mod.get(targetUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 NetEngKit-Proxy/1.0' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUpstream(res.headers.location).then(resolve, reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status:      res.statusCode,
        headers:     res.headers,
        body:        Buffer.concat(chunks),
      }));
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('Upstream timeout')));
  });
}

// ---------------------------------------------------------------------------
// DNS wire-format helpers (RFC 8484 DoH)
// ---------------------------------------------------------------------------

/** Build a DNS query buffer for the given name and record type number. */
function buildDnsQuery(name, qtype) {
  const labels = name.split('.').filter(Boolean);
  let qnameLen = 0;
  for (const l of labels) qnameLen += 1 + Buffer.byteLength(l);
  const buf = Buffer.alloc(12 + qnameLen + 1 + 2 + 2);
  let off = 0;
  // Header — transaction ID (random), flags = recursion desired
  buf.writeUInt16BE(0x1234, off); off += 2;  // ID
  buf.writeUInt16BE(0x0100, off); off += 2;  // flags: RD=1
  buf.writeUInt16BE(1, off);     off += 2;  // QDCOUNT
  buf.writeUInt16BE(0, off);     off += 2;  // ANCOUNT
  buf.writeUInt16BE(0, off);     off += 2;  // NSCOUNT
  buf.writeUInt16BE(0, off);     off += 2;  // ARCOUNT
  // Question
  for (const l of labels) {
    buf.writeUInt8(l.length, off); off += 1;
    buf.write(l, off, 'ascii'); off += Buffer.byteLength(l);
  }
  buf.writeUInt8(0, off); off += 1;         // root label
  buf.writeUInt16BE(qtype, off); off += 2;  // QTYPE
  buf.writeUInt16BE(1, off); off += 2;      // QCLASS = IN
  return buf.subarray(0, off);
}

/** Parse a DNS wire-format response into Google-style JSON. */
function parseDnsResponse(buf) {
  let off = 0;
  const id      = buf.readUInt16BE(off); off += 2;
  const flags   = buf.readUInt16BE(off); off += 2;
  const rcode   = flags & 0xF;
  const qdcount = buf.readUInt16BE(off); off += 2;
  const ancount = buf.readUInt16BE(off); off += 2;
  const nscount = buf.readUInt16BE(off); off += 2;
  const arcount = buf.readUInt16BE(off); off += 2;

  const typeNames  = {1:'A',2:'NS',5:'CNAME',6:'SOA',12:'PTR',15:'MX',16:'TXT',28:'AAAA',33:'SRV',257:'CAA'};
  const typeNums   = {}; for (const [n,t] of Object.entries(typeNames)) typeNums[t] = +n;

  /** Read a domain name from the buffer handling compression pointers. */
  function readName(start) {
    const seen = new Set();
    let o = start, parts = [], jumped = false, afterJump = null;
    while (true) {
      if (o >= buf.length) break;
      const len = buf[o];
      if (len === 0) { if (!jumped) afterJump = o + 1; break; }
      if ((len & 0xC0) === 0xC0) {
        if (!jumped) afterJump = o + 2;
        const ptr = ((len & 0x3F) << 8) | buf[o + 1];
        if (seen.has(ptr)) break;
        seen.add(ptr);
        o = ptr; jumped = true;
      } else {
        parts.push(buf.toString('ascii', o + 1, o + 1 + len));
        o += 1 + len;
      }
    }
    return { name: parts.join('.') + '.', nextOff: afterJump || o + 1 };
  }

  /** Read a resource record, return Google-style JSON object. */
  function readRR(o) {
    const { name, nextOff } = readName(o);
    let off = nextOff;
    const rtype = buf.readUInt16BE(off); off += 2;
    const rclass = buf.readUInt16BE(off); off += 2;
    const ttl = buf.readUInt32BE(off); off += 4;
    const rdlen = buf.readUInt16BE(off); off += 2;
    const rdStart = off;
    let data = '';

    try {
      if (rtype === 1 && rdlen === 4) {       // A
        data = `${buf[off]}.${buf[off+1]}.${buf[off+2]}.${buf[off+3]}`;
      } else if (rtype === 28 && rdlen === 16) { // AAAA
        const segs = [];
        for (let i = 0; i < 16; i += 2) segs.push(buf.readUInt16BE(off + i).toString(16));
        data = segs.join(':').replace(/(^|:)0(:0)*:0?(:|$)/, '$1$3$4').replace(/(^|:)0(:0)*:0?(:|$)/, '$1$3$4').replace(/:{3,}/, '::') || '::1';
      } else if (rtype === 5 || rtype === 2 || rtype === 12) { // CNAME, NS, PTR
        data = readName(off).name;
      } else if (rtype === 15) {              // MX
        const pref = buf.readUInt16BE(off);
        data = `${pref} ${readName(off + 2).name}`;
      } else if (rtype === 16) {             // TXT
        const txts = []; let p = off;
        while (p < rdStart + rdlen) { const l = buf[p++]; txts.push(buf.toString('utf8', p, p + l)); p += l; }
        data = txts.join('');
      } else if (rtype === 6) {              // SOA
        const mname = readName(off);
        const rname = readName(mname.nextOff);
        let s = rname.nextOff;
        const serial = buf.readUInt32BE(s); s += 4;
        const refresh = buf.readUInt32BE(s); s += 4;
        const retry = buf.readUInt32BE(s); s += 4;
        const expire = buf.readUInt32BE(s); s += 4;
        const minttl = buf.readUInt32BE(s);
        data = `${mname.name} ${rname.name} ${serial} ${refresh} ${retry} ${expire} ${minttl}`;
      } else if (rtype === 33) {             // SRV
        const prio = buf.readUInt16BE(off);
        const weight = buf.readUInt16BE(off + 2);
        const port = buf.readUInt16BE(off + 4);
        const target = readName(off + 6);
        data = `${prio} ${weight} ${port} ${target.name}`;
      } else {
        data = buf.toString('hex', off, rdStart + rdlen);
      }
    } catch { data = buf.toString('hex', rdStart, rdStart + rdlen); }

    return { name, type: rtype, TTL: ttl, data, _nextOff: rdStart + rdlen };
  }

  // Skip question section
  let qOff = off;
  let qName = '';
  for (let i = 0; i < qdcount; i++) {
    const r = readName(qOff);
    qName = r.name;
    qOff = r.nextOff + 4; // skip QTYPE + QCLASS
  }

  const Answer = [];
  for (let i = 0; i < ancount && qOff < buf.length; i++) {
    const rr = readRR(qOff);
    Answer.push({ name: rr.name, type: rr.type, TTL: rr.TTL, data: rr.data });
    qOff = rr._nextOff;
  }

  const Authority = [];
  for (let i = 0; i < nscount && qOff < buf.length; i++) {
    const rr = readRR(qOff);
    Authority.push({ name: rr.name, type: rr.type, TTL: rr.TTL, data: rr.data });
    qOff = rr._nextOff;
  }

  return { Status: rcode, Question: [{ name: qName, type: 0 }], Answer, Authority: Authority.length ? Authority : undefined };
}

// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  try {
    const parsed   = url.parse(req.url, true);
    const pathname = decodeURIComponent(parsed.pathname);

    res.setHeader('Access-Control-Allow-Origin',  '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

  // ── Regular DNS lookup ────────────────────────────────────────────────────
  if (pathname === '/api/dns-lookup') {
    const { name: qname, type: qtype, server } = parsed.query;

    if (!qname || !/^[a-zA-Z0-9._\-]+$/.test(qname)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing or invalid name parameter' }));
      return;
    }

    const validTypes = ['A','AAAA','CNAME','MX','NS','PTR','SOA','SRV','TXT','CAA'];
    const recordType = validTypes.includes((qtype || '').toUpperCase()) ? qtype.toUpperCase() : 'A';
    const typeNum = { A:1, NS:2, CNAME:5, SOA:6, PTR:12, MX:15, TXT:16, AAAA:28, SRV:33, CAA:257 };

    if (server) {
      const isIPv4 = /^\d{1,3}(\.\d{1,3}){3}$/.test(server);
      const isIPv6 = /^[0-9a-fA-F:]+$/.test(server);
      if (!isIPv4 && !isIPv6) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid server IP address' }));
        return;
      }
    }

    const dns = require('dns');
    const resolver = new dns.promises.Resolver();
    if (server) {
      const isIPv6addr = server.includes(':');
      resolver.setServers([isIPv6addr ? `[${server}]` : server]);
    }

    const dot = s => s.endsWith('.') ? s : s + '.';

    try {
      let answers = [];

      if (recordType === 'A') {
        const recs = await resolver.resolve4(qname, { ttl: true });
        answers = recs.map(r => ({ name: dot(qname), type: 1, TTL: r.ttl, data: r.address }));
      } else if (recordType === 'AAAA') {
        const recs = await resolver.resolve6(qname, { ttl: true });
        answers = recs.map(r => ({ name: dot(qname), type: 28, TTL: r.ttl, data: r.address }));
      } else if (recordType === 'MX') {
        const recs = await resolver.resolveMx(qname);
        answers = recs.map(r => ({ name: dot(qname), type: 15, TTL: 0, data: `${r.priority} ${dot(r.exchange)}` }));
      } else if (recordType === 'NS') {
        const recs = await resolver.resolveNs(qname);
        answers = recs.map(r => ({ name: dot(qname), type: 2, TTL: 0, data: dot(r) }));
      } else if (recordType === 'CNAME') {
        const recs = await resolver.resolveCname(qname);
        answers = recs.map(r => ({ name: dot(qname), type: 5, TTL: 0, data: dot(r) }));
      } else if (recordType === 'TXT') {
        const recs = await resolver.resolveTxt(qname);
        answers = recs.map(r => ({ name: dot(qname), type: 16, TTL: 0, data: r.join('') }));
      } else if (recordType === 'SOA') {
        const r = await resolver.resolveSoa(qname);
        answers = [{ name: dot(qname), type: 6, TTL: 0, data: `${dot(r.nsname)} ${dot(r.hostmaster)} ${r.serial} ${r.refresh} ${r.retry} ${r.expire} ${r.minttl}` }];
      } else if (recordType === 'PTR') {
        const recs = await resolver.resolvePtr(qname);
        answers = recs.map(r => ({ name: dot(qname), type: 12, TTL: 0, data: dot(r) }));
      } else if (recordType === 'SRV') {
        const recs = await resolver.resolveSrv(qname);
        answers = recs.map(r => ({ name: dot(qname), type: 33, TTL: 0, data: `${r.priority} ${r.weight} ${r.port} ${dot(r.name)}` }));
      } else if (recordType === 'CAA') {
        const recs = await resolver.resolveCaa(qname);
        answers = recs.map(r => ({
          name: dot(qname), type: 257, TTL: 0,
          data: `${r.critical} ${r.issue !== undefined ? 'issue' : r.issuewild !== undefined ? 'issuewild' : 'iodef'} "${r.issue ?? r.issuewild ?? r.iodef}"`,
        }));
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        Status: 0,
        Question: [{ name: dot(qname), type: typeNum[recordType] }],
        Answer: answers,
      }));
    } catch (e) {
      const nxdomain = e.code === 'ENOTFOUND' || e.code === 'ENODATA';
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({
        Status: nxdomain ? 3 : 2,
        Question: [{ name: dot(qname), type: typeNum[recordType] }],
        Answer: [],
        Comment: e.message,
      }));
    }
    return;
  }

  // ── DoH lookup (proxied to avoid CORS + handle RFC 8484 wire format) ──────
  if (pathname === '/api/doh-lookup') {
    const { name: qname, type: qtype, url: dohUrl, json: isJson } = parsed.query;

    if (!qname || !dohUrl) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: 'Missing name or url parameter' }));
      return;
    }

    const validTypes = ['A','AAAA','CNAME','MX','NS','PTR','SOA','SRV','TXT','CAA'];
    const recordType = validTypes.includes((qtype || 'A').toUpperCase()) ? qtype.toUpperCase() : 'A';
    const typeNum = { A:1, NS:2, CNAME:5, SOA:6, PTR:12, MX:15, TXT:16, AAAA:28, SRV:33, CAA:257 };

    try {
      let data;
      if (isJson === '1') {
        // Google-style JSON API — just proxy the request
        const target = new URL(dohUrl);
        target.searchParams.set('name', qname);
        target.searchParams.set('type', recordType);
        data = await new Promise((resolve, reject) => {
          const mod = target.protocol === 'https:' ? https : http;
          mod.get(target.toString(), { timeout: 8000 }, (upstream) => {
            let body = '';
            upstream.on('data', c => body += c);
            upstream.on('end', () => {
              try { resolve(JSON.parse(body)); }
              catch { reject(new Error('Invalid JSON from DoH server')); }
            });
          }).on('error', reject);
        });
      } else {
        // RFC 8484 wire format — build DNS query packet, send as ?dns=base64url
        // Uses HTTP/2 as required by RFC 8484 §5.2 (many servers reject HTTP/1.1)
        const queryBuf = buildDnsQuery(qname, typeNum[recordType]);
        const dnsParam = queryBuf.toString('base64url');
        const target = new URL(dohUrl);
        target.searchParams.set('dns', dnsParam);

        const wireBuf = await new Promise((resolve, reject) => {
          const client = http2.connect(target.origin);
          client.on('error', reject);
          const req = client.request({
            ':path': target.pathname + target.search,
            ':method': 'GET',
            'accept': 'application/dns-message',
          });
          let status = 0;
          req.on('response', (hdrs) => { status = parseInt(hdrs[':status'] || 0); });
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => {
            client.close();
            if (status !== 200) {
              reject(new Error(`DoH server returned HTTP ${status}: ${Buffer.concat(chunks).toString('utf8').slice(0, 200)}`));
            } else {
              resolve(Buffer.concat(chunks));
            }
          });
          req.on('error', reject);
          req.setTimeout(8000, () => { req.destroy(); reject(new Error('DoH request timed out')); });
          req.end();
        });

        data = parseDnsResponse(wireBuf);
      }

      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(data));
    } catch (e) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ Status: 2, Question: [{ name: qname, type: typeNum[recordType] }], Answer: [], Comment: e.message }));
    }
    return;
  }

  // ── Get cert chain ────────────────────────────────────────────────────────
  if (pathname === '/api/get-cert-chain') {
    const { domain, port } = parsed.query;
    if (!domain) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing domain parameter' }));
      return;
    }

    const cleanDomain = domain.trim().replace(/^https?:\/\//i, '').split('/')[0].split(':')[0];
    const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(cleanDomain);
    const isHostname = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,15}$/.test(cleanDomain) || /^localhost$/.test(cleanDomain);

    if (!isIp && !isHostname) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid domain name or IP address' }));
      return;
    }

    const targetPort = parseInt(port || '443', 10);
    const tls = require('tls');
    const crypto = require('crypto');
    let socket;

    const cleanup = () => {
      if (socket) {
        socket.destroy();
        socket = null;
      }
    };

    const timeoutTimer = setTimeout(() => {
      if (socket) {
        cleanup();
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Timeout connecting to host' }));
      }
    }, 15000);

    try {
      socket = tls.connect({
        host: cleanDomain,
        port: targetPort,
        servername: isIp ? undefined : cleanDomain, // SNI (only for hostname)
        rejectUnauthorized: false
      }, async () => {
        clearTimeout(timeoutTimer);
        const peerCert = socket.getPeerCertificate(true);
        cleanup();

        if (!peerCert || !Object.keys(peerCert).length) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No certificate received from host' }));
          return;
        }

        const derToPem = (buffer) => {
          const base64 = buffer.toString('base64');
          const lines = [];
          for (let i = 0; i < base64.length; i += 64) {
            lines.push(base64.slice(i, i + 64));
          }
          return `-----BEGIN CERTIFICATE-----\n${lines.join('\n')}\n-----END CERTIFICATE-----`;
        };

        const chain = [];
        let current = peerCert;
        const seen = new Set();

        while (current) {
          if (current.raw) {
            const pem = derToPem(current.raw);
            chain.push(pem);
          }
          
          if (!current.issuerCertificate || current.issuerCertificate.fingerprint === current.fingerprint || seen.has(current.fingerprint)) {
            break;
          }
          seen.add(current.fingerprint);
          current = current.issuerCertificate;
        }

        // Try to fetch missing parent certificates using AIA recursively
        try {
          let currentParent = peerCert;
          while (currentParent.issuerCertificate && currentParent.issuerCertificate.fingerprint !== currentParent.fingerprint) {
            currentParent = currentParent.issuerCertificate;
          }
          
          if (currentParent.raw) {
            let topCertObj = new crypto.X509Certificate(currentParent.raw);
            const maxFetchCount = 5;
            let fetchCount = 0;

            while (topCertObj.subject !== topCertObj.issuer && fetchCount < maxFetchCount) {
              const infoAccess = topCertObj.infoAccess;
              if (!infoAccess) break;

              const match = infoAccess.match(/CA Issuers - URI:(https?:\/\/\S+)/);
              if (!match) break;

              const parentUrl = match[1];
              // fetch parent
              const parentDer = await fetchUpstream(parentUrl).then(r => r.body);
              if (!parentDer || !parentDer.length) break;

              const parentCertObj = new crypto.X509Certificate(parentDer);
              chain.push(derToPem(parentDer));
              topCertObj = parentCertObj;
              fetchCount++;
            }
          }
        } catch (_) {
          // If AIA fetching fails, we still return whatever chain we have
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ chain }));
      });

      socket.on('error', (err) => {
        clearTimeout(timeoutTimer);
        cleanup();
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Connection failed: ${err.message}` }));
      });
    } catch (e) {
      clearTimeout(timeoutTimer);
      cleanup();
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── Capabilities ─────────────────────────────────────────────────────────
  if (pathname === '/api/capabilities') {
    const coreTools = ['ping', 'nslookup', 'timeout', 'gawk'];
    const allToolNames = [...coreTools, 'nmap', 'fping', 'tcpdump', 'tshark', 'speedtest', 'librespeed-cli', 'iperf3', 'iperf'];
    const available = {};
    for (const tool of allToolNames) {
      try { execFileSync('which', [tool], { stdio: 'ignore' }); available[tool] = true; }
      catch { available[tool] = false; }
    }
    try { execFileSync('python3', ['-c', 'import scapy'], { stdio: 'ignore', timeout: 5000 }); available['scapy'] = true; }
    catch { available['scapy'] = false; }
    const pingSweep = coreTools.every(t => available[t]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const localIPs = getLocalIPs();
    res.end(JSON.stringify({ pingSweep, nmap: available.nmap, fping: available.fping, tcpdump: available.tcpdump, tshark: available.tshark, speedtest: available.speedtest, librespeed: available['librespeed-cli'], iperf3: available.iperf3, iperf2: available.iperf, scapy: available.scapy, localIP: localIPs.ipv4 || '127.0.0.1', localIPv4: localIPs.ipv4, localIPv6: localIPs.ipv6, tools: available }));
    return;
  }

  // ── Local IP ──────────────────────────────────────────────────────────────
  if (pathname === '/api/local-ip') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(getLocalIPs()));
    return;
  }

  // ── Scapy packet send ─────────────────────────────────────────────────────
  if (pathname === '/api/scapy-send' && req.method === 'POST') {
    const body = await new Promise((resolve) => {
      let data = '';
      req.on('data', c => { data += c; if (data.length > 16384) { data = ''; req.destroy(); } });
      req.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    });

    const ipv4Re = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
    const validProtos = ['ipv4', 'ipv6', 'tcp', 'udp'];

    if (!body || !validProtos.includes(body.proto) || !body.hex || !/^[0-9a-fA-F]+$/.test(body.hex) || body.hex.length > 320) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid request body' }));
      return;
    }

    if ((body.proto === 'tcp' || body.proto === 'udp') && (!ipv4Re.test(body.src) || !ipv4Re.test(body.dst))) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid src/dst IP for L4 packet' }));
      return;
    }

    if (body.payload !== undefined) {
      if (typeof body.payload !== 'string' || !/^[0-9a-fA-F]*$/.test(body.payload) || body.payload.length > 4096) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid payload field' }));
        return;
      }
    }

    const scriptPath = path.join(__dirname, 'scapy_send.py');
    const args = ['python3', scriptPath, body.proto, body.hex];
    if (body.proto === 'tcp' || body.proto === 'udp') args.push(body.src, body.dst);
    if (body.payload) args.push(body.payload);

    const result = await new Promise((resolve) => {
      const proc = spawn(args[0], args.slice(1));
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
      setTimeout(() => { proc.kill(); resolve({ code: 1, stdout: '', stderr: 'timeout' }); }, 10000);
    });

    if (result.code === 0 && result.stdout.startsWith('ok')) {
      // Parse "ok iface=eth0 dst_mac=02:42:ac:11:00:01"
      const ifaceM  = result.stdout.match(/iface=(\S+)/);
      const macM    = result.stdout.match(/dst_mac=(\S+)/);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true, iface: ifaceM?.[1], dstMac: macM?.[1] }));
    } else {
      const msg = result.stdout.replace(/^error:\s*/i, '') || result.stderr || `exit code ${result.code}`;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, error: msg }));
    }
    return;
  }

  // ── Ping sweep SSE stream ─────────────────────────────────────────────────
  if (pathname === '/api/ping-sweep') {
    const { subnet, c, i, n, s } = parsed.query;

    if (!subnet || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(subnet)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing subnet');
      return;
    }

    const args = [];
    const pingCount = parseInt(c, 10);
    if (pingCount >= 1 && pingCount <= 10) args.push('-c', String(pingCount));
    const pingInterval = parseInt(i, 10);
    if (pingInterval >= 1 && pingInterval <= 10) args.push('-i', String(pingInterval));
    if (n && /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(n)) args.push('-n', n);
    if (s) args.push('-s', s.replace(/[^a-zA-Z0-9._\-]/g, ''));
    args.push(subnet);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const scriptPath = path.join(__dirname, 'subnet_scan.sh');
    const proc = spawn('bash', [scriptPath, ...args]);

    const send = (type, line) => res.write(`data: ${JSON.stringify({ type, line })}\n\n`);

    proc.stdout.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && send('out', l)));
    proc.stderr.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && send('err', l)));
    proc.on('close', code => { send('done', String(code)); res.end(); });

    req.on('close', () => proc.kill());
    return;
  }

  // ── nmap run SSE stream ───────────────────────────────────────────────────
  if (pathname === '/api/nmap-run') {
    const { target, type, ports, timing, open: showOpen, verbose } = parsed.query;

    const isCidr = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(target);
    const isIp = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(target);
    const isHostname = /^([a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/.test(target) || /^localhost$/.test(target);

    if (!target || !(isCidr || isIp || isHostname)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing target');
      return;
    }

    const validScanTypes = ['sn', 'sT', 'sV'];
    const scanType = validScanTypes.includes(type) ? type : 'sn';
    const args = [`-${scanType}`];

    const t = parseInt(timing, 10);
    if (t >= 1 && t <= 5) args.push(`-T${t}`);

    if (showOpen === '1') args.push('--open');
    if (verbose === '1') args.push('-v');

    if (ports && /^[\d,\-]+$/.test(ports) && scanType !== 'sn') {
      args.push('-p', ports);
    }

    args.push(target);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const nmapSend = (type, line) => res.write(`data: ${JSON.stringify({ type, line })}\n\n`);
    const nmapProc = spawn('nmap', args);

    nmapProc.stdout.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && nmapSend('out', l)));
    nmapProc.stderr.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && nmapSend('err', l)));
    nmapProc.on('close', code => { nmapSend('done', String(code)); res.end(); });
    req.on('close', () => nmapProc.kill());
    return;
  }

  // ── iperf client run SSE stream ───────────────────────────────────────────
  if (pathname === '/api/iperf-run') {
    const { bin, host, port, proto, bw, time, parallel, reverse, bidir, interval, length, window: win, ipv } = parsed.query;

    const isIPv4     = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
    const isIPv6     = host && /^[0-9a-fA-F:]+$/.test(host);
    const isHostname = /^[a-zA-Z0-9]([a-zA-Z0-9.\-]{0,253}[a-zA-Z0-9])?$/.test(host);
    if (!host || !(isIPv4 || isIPv6 || isHostname)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing host');
      return;
    }

    const binary = bin === 'iperf3' ? 'iperf3' : 'iperf';
    const isV3   = binary === 'iperf3';
    const args   = ['-c', host];

    const portNum = parseInt(port, 10);
    if (portNum >= 1 && portNum <= 65535) args.push('-p', String(portNum));

    if (proto === 'udp') args.push('-u');
    else if (proto === 'sctp' && isV3) args.push('--sctp');

    if (bw && /^\d+(\.\d+)?[KMGkmg]?$/.test(bw)) args.push('-b', bw);

    const timeNum = Math.min(parseInt(time, 10) || 0, 60);
    if (timeNum >= 1) args.push('-t', String(timeNum));

    const parallelNum = parseInt(parallel, 10);
    if (parallelNum >= 1 && parallelNum <= 128) args.push('-P', String(parallelNum));

    if (isV3 && reverse === '1') args.push('-R');
    if (isV3 && bidir === '1') args.push('--bidir');

    const intervalNum = parseInt(interval, 10);
    if (!isNaN(intervalNum) && intervalNum >= 0 && intervalNum <= 60) args.push('-i', String(intervalNum));

    if (length && /^\d+[KMGkmg]?$/.test(length)) args.push('-l', length);
    if (win && /^\d+[KMGkmg]?$/.test(win)) args.push('-w', win);

    if (ipv === '4') args.push('-4');
    else if (ipv === '6') args.push('-6');

    // iperf3/iperf fully buffer stdout when it is a pipe; force live streaming.
    if (isV3) args.push('--forceflush');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const iperfRunSend = (type, line) => res.write(`data: ${JSON.stringify({ type, line })}\n\n`);
    // For iperf2 there is no --forceflush, so line-buffer via stdbuf.
    const iperfRunProc = isV3 ? spawn(binary, args) : spawn('stdbuf', ['-oL', '-eL', binary, ...args]);

    iperfRunProc.stdout.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && iperfRunSend('out', l)));
    iperfRunProc.stderr.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && iperfRunSend('err', l)));
    iperfRunProc.on('error', e => { iperfRunSend('err', `failed to start ${binary}: ${e.message}`); iperfRunSend('done', '1'); res.end(); });
    iperfRunProc.on('close', code => { iperfRunSend('done', String(code === null ? 1 : code)); res.end(); });
    req.on('close', () => iperfRunProc.kill());
    return;
  }

  // ── iperf server SSE stream ───────────────────────────────────────────────
  if (pathname === '/api/iperf-server') {
    const { bin, port, bind, oneoff, json, udp, interval: srvInterval, ipv } = parsed.query;

    const binary = bin === 'iperf3' ? 'iperf3' : 'iperf';
    const isV3   = binary === 'iperf3';
    const args   = ['-s'];

    const portNum = parseInt(port, 10);
    if (portNum >= 1 && portNum <= 65535) args.push('-p', String(portNum));

    if (bind) {
      const isBindIPv4     = /^\d{1,3}(\.\d{1,3}){3}$/.test(bind);
      const isBindIPv6     = /^[0-9a-fA-F:]+$/.test(bind);
      const isBindHostname = /^[a-zA-Z0-9]([a-zA-Z0-9.\-]{0,253}[a-zA-Z0-9])?$/.test(bind);
      if (isBindIPv4 || isBindIPv6 || isBindHostname) args.push('-B', bind);
    }

    if (isV3 && oneoff === '1') args.push('-1');
    if (isV3 && json === '1') args.push('-J');
    if (!isV3 && udp === '1') args.push('-u');

    const intervalNum = parseInt(srvInterval, 10);
    if (!isNaN(intervalNum) && intervalNum >= 0 && intervalNum <= 60) args.push('-i', String(intervalNum));

    if (ipv === '4') args.push('-4');
    else if (ipv === '6') args.push('-6');

    // Stream server output live (see iperf-run note above).
    if (isV3) args.push('--forceflush');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const iperfSrvSend = (type, line) => res.write(`data: ${JSON.stringify({ type, line })}\n\n`);
    const iperfSrvProc = isV3 ? spawn(binary, args) : spawn('stdbuf', ['-oL', '-eL', binary, ...args]);

    iperfSrvProc.stdout.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && iperfSrvSend('out', l)));
    iperfSrvProc.stderr.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && iperfSrvSend('err', l)));
    iperfSrvProc.on('error', e => { iperfSrvSend('err', `failed to start ${binary}: ${e.message}`); iperfSrvSend('done', '1'); res.end(); });
    iperfSrvProc.on('close', code => { iperfSrvSend('done', String(code === null ? 1 : code)); res.end(); });
    req.on('close', () => iperfSrvProc.kill());
    return;
  }

  // ── fping run SSE stream ──────────────────────────────────────────────────
  if (pathname === '/api/fping-run') {
    const { subnet, count, timeout: fpTimeout, interval: fpInterval, quiet, stats } = parsed.query;

    if (!subnet || !/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}$/.test(subnet)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing subnet');
      return;
    }

    const fpArgs = ['-ag'];
    const cnt = parseInt(count, 10);
    if (cnt >= 1 && cnt <= 20) fpArgs.push('-c', String(cnt));
    const tms = parseInt(fpTimeout, 10);
    if (tms >= 50 && tms <= 5000) fpArgs.push('-t', String(tms));
    const ims = parseInt(fpInterval, 10);
    if (ims >= 1 && ims <= 1000) fpArgs.push('-i', String(ims));
    if (quiet === '1') fpArgs.push('-q');
    if (stats === '1') fpArgs.push('-s');
    fpArgs.push(subnet);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const fpingSend = (type, line) => res.write(`data: ${JSON.stringify({ type, line })}\n\n`);
    const fpingProc = spawn('fping', fpArgs);

    fpingProc.stdout.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && fpingSend('out', l)));
    fpingProc.stderr.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && fpingSend('err', l)));
    fpingProc.on('close', code => { fpingSend('done', String(code)); res.end(); });
    req.on('close', () => fpingProc.kill());
    return;
  }

  // ── tcpdump run SSE stream ────────────────────────────────────────────────
  if (pathname === '/api/tcpdump-run') {
    const { iface, filter, count, snaplen, nodns, verbosity, output, timestamp, linkLayer, writeFile } = parsed.query;

    if (!iface || !/^[a-zA-Z0-9._-]{1,15}$/.test(iface)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing interface');
      return;
    }

    // Base args shared by both display and capture processes
    const baseArgs = ['-i', iface];

    const cnt = parseInt(count, 10);
    if (cnt >= 1 && cnt <= 100000) baseArgs.push('-c', String(cnt));
    else baseArgs.push('-c', '100');

    const snap = parseInt(snaplen, 10);
    if (snap >= 1 && snap <= 262144) baseArgs.push('-s', String(snap));

    if (nodns === '-n' || nodns === '-nn') baseArgs.push(nodns);
    if (linkLayer === '1') baseArgs.push('-e');
    if (filter && filter.length < 500) baseArgs.push(filter);

    // Display process: output flags apply here (for human-readable SSE stream)
    const displayArgs = [...baseArgs];
    if (['-v', '-vv', '-vvv'].includes(verbosity)) displayArgs.push(verbosity);
    if (['-X', '-A', '-q'].includes(output)) displayArgs.push(output);
    if (['-t', '-tt', '-ttt', '-tttt'].includes(timestamp)) displayArgs.push(timestamp);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const tdSend = (type, line) => res.write(`data: ${JSON.stringify({ type, line })}\n\n`);

    // Display process — no -w, outputs packet summaries to the SSE stream
    const displayProc = spawn('tcpdump', displayArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
    displayProc.stdout.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && tdSend('out', l)));
    displayProc.stderr.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && tdSend('out', l)));
    displayProc.on('close', code => { tdSend('done', String(code)); res.end(); });

    // Capture process — always writes pcap to /tmp, silent (no stdout/stderr needed)
    let captureProc = null;
    if (writeFile && /^[a-zA-Z0-9._-]+$/.test(writeFile)) {
      const captureArgs = [...baseArgs, '-w', path.join('/tmp', writeFile)];
      captureProc = spawn('tcpdump', captureArgs, { stdio: 'ignore' });
    }

    req.on('close', () => {
      displayProc.kill();
      if (captureProc) captureProc.kill();
    });
    return;
  }

  // ── tcpdump PCAP download ─────────────────────────────────────────────────
  if (pathname === '/api/tcpdump-download') {
    const { file } = parsed.query;
    if (!file || !/^[a-zA-Z0-9._-]+$/.test(file)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid file');
      return;
    }
    const filePath = path.join('/tmp', file);
    fs.stat(filePath, (err, stat) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.tcpdump.pcap',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  // ── tcpdump PCAP cleanup ──────────────────────────────────────────────────
  if (pathname === '/api/tcpdump-cleanup') {
    const { file } = parsed.query;
    if (!file || !/^[a-zA-Z0-9._-]+$/.test(file)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid file');
      return;
    }
    fs.unlink(path.join('/tmp', file), () => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('ok');
    });
    return;
  }

  // ── tshark run SSE stream ─────────────────────────────────────────────────
  // Architecture: tcpdump (known-working in container) captures to a named
  // FIFO; tshark -r <fifo> reads packets in real-time for display/color.
  // Avoids both the tshark→dumpcap execve() block and stdin buffering of -r -.
  if (pathname === '/api/tshark-run') {
    const { iface, captureFilter, displayFilter, count, duration, outputFmt, fields, stats, writeFile } = parsed.query;

    if (!iface || !/^[a-zA-Z0-9._-]{1,15}$/.test(iface)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid or missing interface');
      return;
    }

    const fifoPath = path.join('/tmp', `ts_fifo_${Date.now()}`);
    try { execFileSync('mkfifo', [fifoPath]); } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('mkfifo failed: ' + e.message);
      return;
    }

    // tcpdump capture args — writes pcap to FIFO (and optionally to /tmp file)
    const tdArgs = ['-i', iface, '-U']; // -U flushes pcap per packet
    if (captureFilter && captureFilter.length < 500) tdArgs.push(captureFilter);
    const cnt = parseInt(count, 10);
    if (cnt >= 1 && cnt <= 100000) tdArgs.push('-c', String(cnt));

    // tshark display args — reads from the FIFO, never spawns dumpcap itself
    const tsArgs = ['-r', fifoPath, '-l'];
    if (displayFilter && displayFilter.length < 500) tsArgs.push('-Y', displayFilter);
    if (outputFmt && ['fields', 'json', 'pdml'].includes(outputFmt)) tsArgs.push('-T', outputFmt);
    if (outputFmt === 'fields' && fields) {
      fields.split(',').map(f => f.trim()).filter(Boolean).forEach(f => tsArgs.push('-e', f));
    }
    if (stats && stats.length < 100) tsArgs.push('-z', stats);
    tsArgs.push('--color');

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const tsSend = (type, line) => res.write(`data: ${JSON.stringify({ type, line })}\n\n`);
    const cleanFifo = () => fs.unlink(fifoPath, () => {});

    // tcpdump writes pcap to FIFO; tshark reads from it in real-time
    const tdDisplay = spawn('tcpdump', [...tdArgs, '-w', fifoPath], { stdio: 'ignore' });
    const tsDisplay = spawn('tshark', tsArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

    tdDisplay.on('error', err => tsSend('out', `tcpdump: ${err.message}`));
    tsDisplay.on('error', err => tsSend('out', `tshark: ${err.message}`));

    tsDisplay.stdout.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && tsSend('out', l)));
    tsDisplay.stderr.on('data', chunk =>
      chunk.toString().split('\n').forEach(l => l && tsSend('out', l)));
    tsDisplay.on('close', code => { tsSend('done', String(code)); cleanFifo(); res.end(); });

    // File-capture process — tcpdump writes directly to /tmp, silent
    let tdCapture = null;
    if (writeFile && /^[a-zA-Z0-9._-]+$/.test(writeFile)) {
      tdCapture = spawn('tcpdump', [...tdArgs, '-w', path.join('/tmp', writeFile)], { stdio: 'ignore' });
      tdCapture.on('error', () => {});
    }

    req.on('close', () => {
      tdDisplay.kill();
      tsDisplay.kill();
      if (tdCapture) tdCapture.kill();
      cleanFifo();
    });
    return;
  }

  // ── tshark PCAP download ──────────────────────────────────────────────────
  if (pathname === '/api/tshark-download') {
    const { file } = parsed.query;
    if (!file || !/^[a-zA-Z0-9._-]+$/.test(file)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid file');
      return;
    }
    const filePath = path.join('/tmp', file);
    fs.stat(filePath, (err, stat) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('File not found');
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/vnd.tcpdump.pcap',
        'Content-Disposition': `attachment; filename="${file}"`,
        'Content-Length': stat.size,
        'Access-Control-Allow-Origin': '*',
      });
      fs.createReadStream(filePath).pipe(res);
    });
    return;
  }

  // ── tshark PCAP cleanup ───────────────────────────────────────────────────
  if (pathname === '/api/tshark-cleanup') {
    const { file } = parsed.query;
    if (!file || !/^[a-zA-Z0-9._-]+$/.test(file)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Invalid file');
      return;
    }
    fs.unlink(path.join('/tmp', file), () => {
      res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
      res.end('ok');
    });
    return;
  }

  // ── Speedtest nearby server list ─────────────────────────────────────────
  if (pathname === '/api/speedtest-servers') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    const proc = spawn('speedtest', ['--servers', '--format=json', '--accept-license', '--accept-gdpr']);
    let out = '';
    proc.stdout.on('data', d => { out += d.toString(); });
    proc.stderr.on('data', () => {});
    proc.on('close', () => {
      try { res.end(JSON.stringify(JSON.parse(out).servers || [])); }
      catch { res.end('[]'); }
    });
    return;
  }

  // ── Speedtest CLI SSE stream ──────────────────────────────────────────────
  if (pathname === '/api/speedtest-run') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const serverId = parsed.query.serverId;
    const stArgs = ['--format=json', '--progress=yes', '--accept-license', '--accept-gdpr'];
    if (serverId) stArgs.push(`--server-id=${serverId}`);
    const proc = spawn('speedtest', stArgs);

    proc.stdout.on('data', chunk =>
      chunk.toString().split('\n').forEach(line => {
        if (!line.trim()) return;
        res.write(`data: ${line}\n\n`);
        if (line.includes('"type":"result"')) gotResult = true;
      })
    );

    // Buffer stderr — license banner and informational text land here on first run.
    // Only forward as error if the process exits non-zero without having produced a result.
    let stderrBuf = '';
    let gotResult = false;
    proc.stderr.on('data', chunk => { stderrBuf += chunk.toString(); });

    proc.on('close', code => {
      if (code !== 0 && !gotResult) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: stderrBuf.trim() || `speedtest exited with code ${code}` })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'done', code })}\n\n`);
      res.end();
    });

    req.on('close', () => proc.kill());
    return;
  }

  // ── LibreSpeed CLI: server list ──────────────────────────────────────────
  if (pathname === '/api/librespeed-servers') {
    try {
      const out = await new Promise((resolve, reject) => {
        let stdout = '', stderr = '';
        const p = spawn('librespeed-cli', ['--list']);
        p.stdout.on('data', d => { stdout += d.toString(); });
        p.stderr.on('data', d => { stderr += d.toString(); });
        p.on('close', code => { code === 0 ? resolve(stdout) : reject(new Error(stderr || `exit ${code}`)); });
        setTimeout(() => { p.kill(); reject(new Error('timeout')); }, 30000);
      });
      // Parse "ID: Name (URL)  [Sponsor: ...]" lines
      const servers = [];
      for (const line of out.split('\n')) {
        const m = line.match(/^(\d+):\s+(.+?)\s+\((https?:\/\/[^)]+)\)\s+\[Sponsor:\s+(.+?)(?:\s+@\s+(https?:\/\/\S+))?\]/);
        if (m) servers.push({ id: m[1], name: m[2], url: m[3], sponsor: m[4], sponsorUrl: m[5] || '' });
      }
      res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify(servers));
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── LibreSpeed CLI SSE stream ─────────────────────────────────────────────
  // librespeed-cli --json outputs a single JSON object at the end (no streaming).
  // We emit timed phase events during the test so the UI can animate like OoklaTab.
  if (pathname === '/api/librespeed-run') {
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection':    'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    const { serverId, serverJson } = parsed.query;
    const args = ['--json', '--no-icmp', '--skip-cert-verify'];
    let tmpFile = null;
    if (serverJson) {
      // Custom server URL — write a temp server list and use --local-json
      const base = serverJson.replace(/\/+$/, '');
      const payload = JSON.stringify([{
        name: 'Custom', server: base,
        dlURL: 'garbage.php', ulURL: 'empty.php',
        pingURL: 'empty.php', getIpURL: 'getIP.php',
      }]);
      tmpFile = `/tmp/ls-${Date.now()}.json`;
      fs.writeFileSync(tmpFile, payload);
      args.push('--local-json', tmpFile, '--server', '0');
    } else if (serverId) {
      args.push('--server', String(serverId));
    }
    const proc = spawn('librespeed-cli', args);

    let stdout = '';
    let stderrBuf = '';

    // Timed phase events so the gauge animates (CLI has no streaming output)
    // librespeed-cli --json outputs everything at the end, so we fake progress.
    const phaseTimers = [];
    const send = (type, data = {}) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, ...data })}\n\n`);
    };

    // Helper: emit speed ticks for a phase
    const speedTickPhase = (phase, startMs, durationMs) => {
      let ticks = 0;
      const maxTicks = Math.floor(durationMs / 500);
      const iv = setInterval(() => {
        ticks++;
        if (ticks > maxTicks || res.writableEnded) { clearInterval(iv); return; }
        // Ramp up speed with some noise
        const progress = ticks / maxTicks;
        const base = 50 + progress * 200; // ramp 50→250 Mbps range
        const noise = (Math.random() - 0.5) * 40;
        const speed = Math.max(1, base + noise);
        send('speed', { phase, speed: Math.round(speed * 10) / 10 });
      }, 500);
      phaseTimers.push(iv);
    };

    phaseTimers.push(setTimeout(() => send('testStart'), 500));
    phaseTimers.push(setTimeout(() => send('ping'), 1500));
    phaseTimers.push(setTimeout(() => { send('download'); speedTickPhase('download', 0, 10000); }, 4000));
    phaseTimers.push(setTimeout(() => { send('upload'); speedTickPhase('upload', 0, 9000); }, 14000));
    const clearTimers = () => phaseTimers.forEach(t => { clearTimeout(t); clearInterval(t); });

    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderrBuf += d.toString(); });

    proc.on('close', (code) => {
      clearTimers();
      if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
      if (code === 0) {
        try {
          const raw = JSON.parse(stdout.trim());
          const r = Array.isArray(raw) ? raw[0] : raw;
          res.write(`data: ${JSON.stringify({
            type:     'result',
            ping:     r.ping,
            jitter:   r.jitter,
            download: r.download,
            upload:   r.upload,
            server:   r.server,
            client:   r.client,
          })}\n\n`);
        } catch {
          res.write(`data: ${JSON.stringify({ type: 'error', message: 'Failed to parse librespeed-cli output' })}\n\n`);
        }
      } else {
        res.write(`data: ${JSON.stringify({ type: 'error', message: stderrBuf.trim() || `librespeed-cli exited with code ${code}` })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      res.end();
    });

    req.on('close', () => { clearTimers(); proc.kill(); });
    return;
  }

  // ── CORS proxy ────────────────────────────────────────────────────────────
  if (pathname === '/proxy/fetch') {
    const target = parsed.query.url;
    if (!target) {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Missing ?url= parameter');
      return;
    }
    try {
      const upstream = await fetchUpstream(target);
      const forwardHeaders = { 'Access-Control-Allow-Origin': '*' };
      const skip = new Set(['transfer-encoding', 'connection', 'keep-alive', 'upgrade']);
      for (const [k, v] of Object.entries(upstream.headers)) {
        if (!skip.has(k)) forwardHeaders[k] = v;
      }
      res.writeHead(upstream.status, forwardHeaders);
      res.end(upstream.body);
    } catch (e) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end(`Proxy error: ${e.message}`);
    }
    return;
  }

  // ── Static files ──────────────────────────────────────────────────────────
  const rel      = pathname === '/' ? 'NetEngKit.html' : pathname.slice(1);
  const filePath = path.join(ROOT, rel);

  // Prevent path traversal
  if (!filePath.startsWith(ROOT + path.sep) && filePath !== ROOT) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }

  const ext  = path.extname(filePath).toLowerCase();
  const mime = MIME[ext] || 'application/octet-stream';
  let   body = fs.readFileSync(filePath);

  // Inject LOCAL_PROXY so components auto-use the local proxy
  if (ext === '.html') {
    body = Buffer.from(
      body.toString('utf8').replace(
        '</head>',
        `  <script>window.LOCAL_PROXY = '/proxy/fetch?url=';</script>\n  </head>`
      )
    );
  }

  res.writeHead(200, { 'Content-Type': mime });
  res.end(body);
  } catch (err) {
    console.error(`[${new Date().toISOString()}] Error handling ${req.method} ${req.url}:`, err);
    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal Server Error');
    }
  }
});

server.listen(PORT, () => {
  console.log(`NetEngKit — http://localhost:${PORT}`);
  console.log(`CORS proxy     — http://localhost:${PORT}/proxy/fetch?url=<encoded>`);
});
