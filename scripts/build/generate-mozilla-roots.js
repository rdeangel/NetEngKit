#!/usr/bin/env node
/**
 * Fetches the Mozilla Root Store PEM bundle from CCADB and generates
 * a JS data file containing normalized Subject DNs for all included roots.
 *
 * Usage: node scripts/build/generate-mozilla-roots.js
 *
 * Output: data/mozilla-roots.js
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const CCADB_URL = 'https://ccadb.my.salesforce-sites.com/mozilla/IncludedRootsPEMTxt?TrustBitsInclude=Websites';
const OUTPUT_PATH = path.join(__dirname, '..', '..', 'data', 'mozilla-roots.js');

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        body: Buffer.concat(chunks).toString('utf-8'),
        lastModified: res.headers['last-modified'] || null
      }));
    }).on('error', reject);
  });
}

// Minimal ASN.1 DER parser — just enough to extract Subject DN
function parseDER(buf) {
  let offset = 0;
  function readTLV() {
    if (offset >= buf.length) return null;
    const tag = buf[offset++];
    let len = buf[offset++];
    if (len & 0x80) {
      const numBytes = len & 0x7f;
      len = 0;
      for (let i = 0; i < numBytes; i++) len = (len << 8) | buf[offset++];
    }
    const value = buf.slice(offset, offset + len);
    offset += len;
    return { tag, value, raw: buf.slice(offset - len - (len > 127 ? (len & 0x7f) + 2 : 2), offset) };
  }
  return readTLV();
}

// Known OID to short name mapping
const OID_MAP = {
  '2.5.4.3': 'CN',
  '2.5.4.6': 'C',
  '2.5.4.7': 'L',
  '2.5.4.8': 'ST',
  '2.5.4.10': 'O',
  '2.5.4.11': 'OU',
  '2.5.4.5': 'serialNumber',
  '2.5.4.97': 'organizationIdentifier',
  '1.3.6.1.4.1.311.60.2.1.3': 'jurisdictionOfIncorporationCountryName',
};

function oidFromBytes(bytes) {
  if (bytes.length === 0) return '';
  const components = [];
  components.push(Math.floor(bytes[0] / 40));
  components.push(bytes[0] % 40);
  let value = 0;
  for (let i = 1; i < bytes.length; i++) {
    value = (value << 7) | (bytes[i] & 0x7f);
    if (!(bytes[i] & 0x80)) {
      components.push(value);
      value = 0;
    }
  }
  return components.join('.');
}

function parseRDNSequence(rdnBuf) {
  const attrs = [];
  let offset = 0;
  // RDNSequence is a SEQUENCE of SETs
  while (offset < rdnBuf.length) {
    // Read each SET
    const setTag = rdnBuf[offset]; offset++;
    let setLen = rdnBuf[offset]; offset++;
    if (setLen & 0x80) {
      const nb = setLen & 0x7f;
      setLen = 0;
      for (let i = 0; i < nb; i++) setLen = (setLen << 8) | rdnBuf[offset++];
    }
    const setEnd = offset + setLen;
    // Each SET contains SEQUENCE { OID, value }
    while (offset < setEnd) {
      const seqTag = rdnBuf[offset]; offset++;
      let seqLen = rdnBuf[offset]; offset++;
      if (seqLen & 0x80) {
        const nb = seqLen & 0x7f;
        seqLen = 0;
        for (let i = 0; i < nb; i++) seqLen = (seqLen << 8) | rdnBuf[offset++];
      }
      const seqEnd = offset + seqLen;
      // OID
      const oidTag = rdnBuf[offset]; offset++;
      let oidLen = rdnBuf[offset]; offset++;
      if (oidLen & 0x80) {
        const nb = oidLen & 0x7f;
        oidLen = 0;
        for (let i = 0; i < nb; i++) oidLen = (oidLen << 8) | rdnBuf[offset++];
      }
      const oidBytes = rdnBuf.slice(offset, offset + oidLen);
      offset += oidLen;
      const oid = oidFromBytes(oidBytes);
      const shortName = OID_MAP[oid] || oid;
      // Value (could be PRINTABLE_STRING, UTF8_STRING, etc.)
      const valTag = rdnBuf[offset]; offset++;
      let valLen = rdnBuf[offset]; offset++;
      if (valLen & 0x80) {
        const nb = valLen & 0x7f;
        valLen = 0;
        for (let i = 0; i < nb; i++) valLen = (valLen << 8) | rdnBuf[offset++];
      }
      const value = rdnBuf.slice(offset, offset + valLen).toString('utf-8');
      offset += valLen;
      attrs.push({ shortName, value });
    }
    offset = setEnd;
  }
  return attrs;
}

function extractSubjectDN(derBuf) {
  // Certificate SEQUENCE
  const cert = parseDER(derBuf);
  if (!cert || cert.value.length === 0) return null;
  // TBSCertificate SEQUENCE
  const tbs = parseDER(cert.value);
  if (!tbs) return null;
  // Walk tbs children to find subject (index 5 for v3, index 4 for v1)
  let tbsOffset = 0;
  const tbsChildren = [];
  while (tbsOffset < tbs.value.length) {
    const child = parseDER(tbs.value.slice(tbsOffset));
    if (!child) break;
    tbsChildren.push(child);
    // Calculate total bytes consumed for this TLV
    let headerSize = 2;
    if (child.value.length > 127) {
      headerSize += Math.ceil(Math.log2(child.value.length + 1) / 8);
    }
    tbsOffset += headerSize + child.value.length;
  }
  // subject is at index 5 for v3 certs (with version), index 4 for v1
  const subjectIdx = tbsChildren[0]?.tag === 0xa0 ? 5 : 4;
  const subjectChild = tbsChildren[subjectIdx];
  if (!subjectChild) return null;
  return parseRDNSequence(subjectChild.value);
}

function normalizeDN(attrs) {
  const pairs = attrs.map(a => `${a.shortName.toLowerCase()}=${a.value.toLowerCase()}`);
  pairs.sort();
  return pairs.join(',');
}

async function generateMozillaRoots(outputPath) {
  const out = outputPath || OUTPUT_PATH;

  console.log('Fetching Mozilla Root Store from CCADB...');
  const { body: pemText, lastModified } = await fetch(CCADB_URL);
  console.log(`Downloaded ${(pemText.length / 1024).toFixed(0)} KB`);

  const pemBlocks = pemText.match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g) || [];
  console.log(`Found ${pemBlocks.length} PEM blocks`);

  const subjects = new Set();
  let parseErrors = 0;
  for (const pem of pemBlocks) {
    try {
      const b64 = pem.replace(/-----[^-]+-----/g, '').replace(/\s/g, '');
      const der = Buffer.from(b64, 'base64');
      const attrs = extractSubjectDN(der);
      if (attrs && attrs.length > 0) {
        subjects.add(normalizeDN(attrs));
      }
    } catch (e) {
      parseErrors++;
    }
  }

  console.log(`Parsed ${subjects.size} unique Subject DNs (${parseErrors} parse errors)`);
  if (lastModified) console.log(`Data date: ${lastModified}`);

  // Generate output
  const dateStr = lastModified ? new Date(lastModified).toISOString().split('T')[0] : new Date().toISOString().split('T')[0];
  const entries = Array.from(subjects).sort().map(s => `  '${s}'`).join(',\n');

  const output = `// Auto-generated by scripts/build/generate-mozilla-roots.js
// Source: Mozilla CCADB Included Root Certificates (Trust Bits: Websites)
// Date: ${dateStr}
// Total roots: ${subjects.size}
// To regenerate: node scripts/build/generate-mozilla-roots.js

const MOZILLA_ROOT_SUBJECTS = new Set([
${entries}
]);

const MOZILLA_ROOT_DATE = '${dateStr}';
const MOZILLA_ROOT_COUNT = ${subjects.size};
`;

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, output);
  console.log(`Written to ${out}`);
  return { count: subjects.size, date: dateStr };
}

// Export for use as a module by build scripts
module.exports = { generateMozillaRoots, OUTPUT_PATH };

// Run standalone when invoked directly
if (require.main === module) {
  generateMozillaRoots().catch(e => { console.error(e); process.exit(1); });
}
