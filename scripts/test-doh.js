#!/usr/bin/env node
'use strict';
const http2 = require('http2');

function buildDnsQuery(name, qtype) {
  const labels = name.split('.').filter(Boolean);
  let qnameLen = 0;
  for (const l of labels) qnameLen += 1 + Buffer.byteLength(l);
  const buf = Buffer.alloc(12 + qnameLen + 1 + 2 + 2);
  let off = 0;
  buf.writeUInt16BE(0x1234, off); off += 2;
  buf.writeUInt16BE(0x0100, off); off += 2;
  buf.writeUInt16BE(1, off); off += 2;
  buf.writeUInt16BE(0, off); off += 2;
  buf.writeUInt16BE(0, off); off += 2;
  buf.writeUInt16BE(0, off); off += 2;
  for (const l of labels) { buf.writeUInt8(l.length, off); off += 1; buf.write(l, off, 'ascii'); off += Buffer.byteLength(l); }
  buf.writeUInt8(0, off); off += 1;
  buf.writeUInt16BE(qtype, off); off += 2;
  buf.writeUInt16BE(1, off); off += 2;
  return buf.subarray(0, off);
}

function readName(buf, start) {
  const seen = new Set();
  let o = start, parts = [], jumped = false, afterJump = null;
  while (true) {
    if (o >= buf.length) break;
    const len = buf[o];
    if (len === 0) { if (!jumped) afterJump = o + 1; break; }
    if ((len & 0xC0) === 0xC0) {
      if (!jumped) afterJump = o + 2;
      const ptr = ((len & 0x3F) << 8) | buf[o + 1];
      if (seen.has(ptr)) break; seen.add(ptr);
      o = ptr; jumped = true;
    } else { parts.push(buf.toString('ascii', o + 1, o + 1 + len)); o += 1 + len; }
  }
  return { name: parts.join('.') + '.', nextOff: afterJump || o + 1 };
}

function parseResp(buf) {
  let off = 2;
  const fl = buf.readUInt16BE(off); off += 2;
  const rc = fl & 0xF;
  const qd = buf.readUInt16BE(off); off += 2;
  const an = buf.readUInt16BE(off); off += 2;
  off += 4;
  function readRR(o) {
    const { name, nextOff } = readName(buf, o);
    let off2 = nextOff;
    const rt = buf.readUInt16BE(off2); off2 += 2;
    off2 += 2; // class
    const ttl = buf.readUInt32BE(off2); off2 += 4;
    const rdlen = buf.readUInt16BE(off2); off2 += 2;
    const rds = off2;
    let data = '';
    try {
      if (rt === 1 && rdlen === 4) data = buf[off2]+'.'+buf[off2+1]+'.'+buf[off2+2]+'.'+buf[off2+3];
      else if (rt === 5 || rt === 2 || rt === 12) data = readName(buf, off2).name;
      else data = buf.toString('hex', off2, rds + rdlen);
    } catch { data = buf.toString('hex', off2, rds + rdlen); }
    return { name, type: rt, TTL: ttl, data, _n: rds + rdlen };
  }
  let qO = off, qN = '';
  for (let i = 0; i < qd; i++) { const r = readName(buf, qO); qN = r.name; qO = r.nextOff + 4; }
  const A = [];
  for (let i = 0; i < an && qO < buf.length; i++) { const rr = readRR(qO); A.push({ name: rr.name, type: rr.type, TTL: rr.TTL, data: rr.data }); qO = rr._n; }
  return { Status: rc, Answer: A };
}

async function testDoH(name, dohUrl) {
  const q = buildDnsQuery('example.com', 1);
  const t = new URL(dohUrl);
  t.searchParams.set('dns', q.toString('base64url'));
  return new Promise((resolve, reject) => {
    const c = http2.connect(t.origin);
    c.on('error', reject);
    const r = c.request({ ':path': t.pathname + t.search, ':method': 'GET', 'accept': 'application/dns-message' });
    let s = 0;
    r.on('response', h => { s = parseInt(h[':status'] || 0); });
    const ch = [];
    r.on('data', d => ch.push(d));
    r.on('end', () => {
      c.close();
      if (s !== 200) { reject(new Error('HTTP ' + s)); return; }
      const p = parseResp(Buffer.concat(ch));
      resolve(name + ' OK  Status=' + p.Status + '  IPs: ' + p.Answer.map(a => a.data).join(', '));
    });
    r.on('error', reject);
    r.setTimeout(5000, () => { r.destroy(); reject(new Error('timeout')); });
    r.end();
  });
}

(async () => {
  const tests = [
    ['Quad9',        'https://dns.quad9.net/dns-query'],
    ['Cloudflare',   'https://cloudflare-dns.com/dns-query'],
    ['OpenDNS',      'https://doh.opendns.com/dns-query'],
    ['Mullvad',      'https://dns.mullvad.net/dns-query'],
    ['CleanBrowsing','https://doh.cleanbrowsing.org/doh/family-filter/'],
    ['dns0.eu',      'https://dns0.eu/dns-query'],
    ['NextDNS',      'https://dns.nextdns.io/dns-query'],
  ];
  for (const [n, u] of tests) {
    try { console.log(await testDoH(n, u)); }
    catch (e) { console.log(n.padEnd(16) + ' FAIL: ' + e.message); }
  }
  process.exit(0);
})();
