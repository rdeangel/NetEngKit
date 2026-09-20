#!/usr/bin/env node
// generate-oui-db.js — Downloads and converts the maclookup.app full JSON database
// into the compact OUI_DB format used by MACTools.jsx.
//
// Supports MA-L (24-bit/6-char keys), MA-M (28-bit/7-char keys),
// and MA-S/IAB (36-bit/9-char keys) for accurate sub-OUI vendor resolution.
//
// Usage:
//   node scripts/build/generate-oui-db.js
//   node scripts/build/generate-oui-db.js --input /path/to/db.json   # use local file

'use strict';

const fs   = require('fs');
const path = require('path');
const https = require('https');

const ROOT    = path.join(__dirname, '../..');
const OUT     = path.join(ROOT, 'oui-db.js');
const DB_URL  = 'https://maclookup.app/downloads/json-database/get-db';

const args = process.argv.slice(2);
const inputFlag = args.indexOf('--input');
const localInput = inputFlag !== -1 ? args[inputFlag + 1] : null;

function build(raw) {
  const entries = JSON.parse(raw);
  const db = {};
  for (const e of entries) {
    if (!e.macPrefix || !e.vendorName) continue;
    const key = e.macPrefix.replace(/:/g, '').toUpperCase();
    if (!key) continue;
    db[key] = e.vendorName;
  }

  const entryCount = Object.keys(db).length;
  const now = new Date().toISOString().slice(0, 10);
  const out =
    `// MAC OUI Database — sourced from maclookup.app\n` +
    `// License: Free to use with attribution. See https://maclookup.app/terms-and-conditions\n` +
    `// Database: https://maclookup.app/downloads/json-database\n` +
    `// ${entryCount} entries (MA-L + MA-M + MA-S + IAB), auto-generated ${now}\n` +
    `const OUI_DB = ${JSON.stringify(db)};\n`;

  fs.writeFileSync(OUT, out, 'utf8');
  const kb = (fs.statSync(OUT).size / 1024).toFixed(1);
  console.log(`Written: oui-db.js (${entryCount} entries, ${kb} KB)`);
}

if (localInput) {
  console.log(`Using local file: ${localInput}`);
  build(fs.readFileSync(localInput, 'utf8'));
} else {
  console.log(`Downloading from ${DB_URL} ...`);
  https.get(DB_URL, (res) => {
    if (res.statusCode !== 200) {
      console.error(`HTTP ${res.statusCode}`);
      process.exit(1);
    }
    const chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => build(Buffer.concat(chunks).toString('utf8')));
  }).on('error', err => { console.error(err.message); process.exit(1); });
}
