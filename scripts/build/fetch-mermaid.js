#!/usr/bin/env node
// Download mermaid.min.js once (gitignored) so offline builds reuse a local copy.
// Usage:
//   node scripts/build/fetch-mermaid.js          # skip if the file already exists
//   node scripts/build/fetch-mermaid.js --force   # re-download

const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');

const MERMAID_CDN = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js';
const DEST = path.resolve(__dirname, '../../mermaid.min.js');

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'NetEngKit-fetch-mermaid' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

async function ensureMermaidFile(opts = {}) {
  const dest = opts.dest || DEST;
  const force = !!opts.force;
  if (!force && fs.existsSync(dest) && fs.statSync(dest).size > 0) {
    const buf = fs.readFileSync(dest);
    return { buf, dest, cached: true };
  }
  const buf = await fetchUrl(MERMAID_CDN);
  fs.writeFileSync(dest, buf);
  return { buf, dest, cached: false };
}

module.exports = { MERMAID_CDN, DEST, ensureMermaidFile };

if (require.main === module) {
  const force = process.argv.includes('--force');
  ensureMermaidFile({ force })
    .then(({ dest, buf, cached }) => {
      const mb = (buf.length / 1024 / 1024).toFixed(2);
      if (cached) {
        console.log(`mermaid.min.js already present (${mb} MB) — ${dest}`);
      } else {
        console.log(`Wrote mermaid.min.js (${mb} MB) — ${dest}`);
      }
    })
    .catch((err) => {
      console.warn(`fetch-mermaid: ${err.message}`);
      console.warn('Offline build will retry the download, or diagram tools will use the CDN at runtime.');
      process.exit(0);
    });
}
