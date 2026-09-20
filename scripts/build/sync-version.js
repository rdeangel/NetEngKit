#!/usr/bin/env node
// Reads version from package.json and writes it to version.js.
// Called automatically by the postversion npm hook.
const { version } = require('../package.json');
const fs = require('fs');
const path = require('path');

const out = `window.APP_VERSION = '${version}';\n`;
fs.writeFileSync(path.join(__dirname, '../version.js'), out);
console.log(`version.js updated to ${version}`);
