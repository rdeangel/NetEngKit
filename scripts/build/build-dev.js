#!/usr/bin/env node
// build-dev.js — Produces a file://-compatible HTML by pre-compiling all JSX
// components to plain JS (via esbuild) and inlining them as a single <script> block.
// No Babel Standalone needed at runtime — faster load and smaller downloads.
//
// Source HTML and component files remain unchanged and editable.
// Dev server (npm start) still uses runtime Babel for fast iteration.
//
// Usage:
//   node scripts/build/build-dev.js                        # writes NetEngKit-file.html
//   node scripts/build/build-dev.js -o path/to/out.html    # custom output path

'use strict';

const fs   = require('fs');
const path = require('path');
const { compileJsxFiles } = require('./compile-jsx');
const { generateMozillaRoots } = require('./generate-mozilla-roots');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ROOT     = path.join(__dirname, '../..');
const SRC_HTML = path.join(ROOT, 'NetEngKit.html');

const args   = process.argv.slice(2);
const oFlag  = args.indexOf('-o');
const OUT_HTML = oFlag !== -1 && args[oFlag + 1]
  ? path.resolve(args[oFlag + 1])
  : path.join(ROOT, 'NetEngKit-file.html');

// ---------------------------------------------------------------------------
// Pre-build: generate data files (non-fatal)
// ---------------------------------------------------------------------------

async function generateDataFiles() {
  try {
    await generateMozillaRoots();
  } catch (e) {
    console.warn(`WARNING: Failed to generate Mozilla root store data: ${e.message}`);
    console.warn('Building without fresh root store data. Root trust check may use stale data.');
  }
}

// ---------------------------------------------------------------------------
// Parse ordered JSX file list from <script type="text/babel" src="..."> tags
// And language files from <script defer src="languages/..."> tags
// ---------------------------------------------------------------------------

(async () => {
  await generateDataFiles();

const html = fs.readFileSync(SRC_HTML, 'utf8');

const babelScriptRe = /<script\s+type="text\/babel"\s+src="([^"]+)"\s*><\/script>/g;
const jsxFiles = [];
let m;
while ((m = babelScriptRe.exec(html)) !== null) {
  jsxFiles.push(m[1]); // e.g. "components/shared.jsx"
}

if (jsxFiles.length === 0) {
  console.error('No <script type="text/babel" src="..."> tags found in source HTML.');
  process.exit(1);
}

// Also collect language files to inline before JSX
const langScriptRe = /<script[^>]*src="(languages\/[^"]+\.js)"/g;
const langFiles = [];
while ((m = langScriptRe.exec(html)) !== null) {
  langFiles.push(m[1]);
}

// Collect plain (non-Babel) component JS helper files (e.g. iface-spreadsheet-templates.js)
// These must be declared before the JSX files that reference their globals.
const plainCompScriptRe = /<script\s+src="(components\/[^"]+\.js)"\s*><\/script>/g;
const plainCompFiles = [];
while ((m = plainCompScriptRe.exec(html)) !== null) {
  plainCompFiles.push(m[1]);
}

// Collect data files (e.g. data/mozilla-roots.js) — plain JS that defines globals
const dataScriptRe = /<script\s+src="(data\/[^"]+\.js)"\s*><\/script>/g;
const dataFiles = [];
while ((m = dataScriptRe.exec(html)) !== null) {
  dataFiles.push(m[1]);
}

console.log(`Found ${langFiles.length} language files, ${plainCompFiles.length} plain component JS, ${dataFiles.length} data files, and ${jsxFiles.length} JSX files to inline.`);

// ---------------------------------------------------------------------------
// Read and concatenate language files and JSX files
// ---------------------------------------------------------------------------

// Language files first, then data files, then plain component JS, then JSX files
const allFiles = [...langFiles, ...dataFiles, ...plainCompFiles, ...jsxFiles];

// shared.jsx (after lang files) owns the one canonical React destructuring line.
// All subsequent JSX files have an identical line that would cause a const
// redeclaration error when everything runs in the same scope.
const REACT_DESTRUCTURE_RE = /^const\s+\{[^}]+\}\s*=\s*React\s*;?\s*$/m;

// Pre-compile JSX files via esbuild
const jsxCompiled = compileJsxFiles(jsxFiles, ROOT);
const jsxCompiledMap = new Map(jsxCompiled.map(r => [r.relPath, r.code]));

const parts = allFiles.map((rel) => {
  const filePath = path.join(ROOT, rel);
  if (!fs.existsSync(filePath)) {
    console.warn(`  WARNING: missing file ${rel} — skipping`);
    return `// [build-dev] MISSING: ${rel}`;
  }

  let src;
  const isJsxFile = rel.endsWith('.jsx');
  const isFirstJsxFile = isJsxFile && allFiles.indexOf(rel) === langFiles.length + dataFiles.length + plainCompFiles.length;

  if (isJsxFile) {
    // Use pre-compiled JS from esbuild
    src = jsxCompiledMap.get(rel);
    if (src === undefined) {
      console.warn(`  WARNING: no compiled output for ${rel}`);
      src = fs.readFileSync(filePath, 'utf8');
    }
  } else {
    src = fs.readFileSync(filePath, 'utf8');
  }

  // Strip the React destructuring from JSX files except shared.jsx (first JSX file)
  if (isJsxFile && !isFirstJsxFile && REACT_DESTRUCTURE_RE.test(src)) {
    src = src.replace(REACT_DESTRUCTURE_RE, '').replace(/^\n/, '');
  }

  return `// ─── ${rel} ${'─'.repeat(Math.max(0, 60 - rel.length))}\n${src}`;
});

// Add a safety check for globals that may not exist in all environments.
// PORT_DATA is declared as `const` in SplitMerge.jsx — omit it here or typeof
// would hit the TDZ and throw in Firefox before the declaration is reached.
const globalsSafe = `
// [build-dev] Safety checks for global data
if (typeof KNOWLEDGE_BASE === 'undefined') window.KNOWLEDGE_BASE = [];
if (typeof AD_DATA === 'undefined') window.AD_DATA = [];
`;

// `defer` is ignored on inline scripts per the HTML spec, so we wrap in
// DOMContentLoaded to guarantee execution after all deferred external scripts
// (translations.js, oui-db.js, etc.) have finished running.

// Indent every line by 2 spaces EXCEPT continuation lines inside template literals.
// A naive blanket indent corrupts multi-line template literals — the added spaces
// become part of the string value at runtime and appear as output indentation.
function indentCode(code, prefix = '  ') {
  const lines = code.split('\n');
  let inTL = false; // are we currently inside a template literal?
  return lines.map(line => {
    // Decide indentation based on state at the START of this line.
    const shouldIndent = !inTL;
    // Scan unescaped backticks to update state for the NEXT line.
    for (let i = 0; i < line.length; i++) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === '`') inTL = !inTL;
    }
    return shouldIndent ? `${prefix}${line}` : line;
  }).join('\n');
}

const wrappedCode =
  `document.addEventListener('DOMContentLoaded', function() {\n` +
  indentCode(globalsSafe + '\n\n' + parts.join('\n\n')) +
  `\n});`;

// ---------------------------------------------------------------------------
// Replace the 62-tag script block with one inline <script> (pre-compiled JS)
// ---------------------------------------------------------------------------

// Match from the shared-helpers comment through the app.jsx closing tag.
// No capture groups — replacement uses a function to avoid $ backreference
// interpretation when JSX source contains regex substitution strings like $1.
const BLOCK_RE = /[ \t]*<!-- Shared helpers[\s\S]*?<!-- App shell[^<]*<script[^>]*><\/script>/;

const inlineBlock =
  `    <!-- Components inlined and pre-compiled by scripts/build/build-dev.js -->\n` +
  `    <script>\n` +
  indentCode(wrappedCode, '      ') +
  `\n    </script>`;

if (!BLOCK_RE.test(html)) {
  console.error('Could not locate the babel script block in the source HTML.');
  console.error('The source HTML structure may have changed — update BLOCK_RE in build-dev.js.');
  process.exit(1);
}

// Use a replacement function so that $ characters in the JSX source are not
// treated as regex backreference patterns by String.replace.
let outHtml = html.replace(BLOCK_RE, () => inlineBlock);

// Remove Babel Standalone CDN tag (no longer needed — JSX is pre-compiled)
outHtml = outHtml.replace(/\s*<script\s+defer\s+src="[^"]*@babel\/standalone[^"]*"[^>]*><\/script>\n?/, '');

// Switch React CDN URLs from development to production builds
outHtml = outHtml
  .replace('react@18.3.1/umd/react.development.js', 'react@18.3.1/umd/react.production.min.js')
  .replace('react-dom@18.3.1/umd/react-dom.development.js', 'react-dom@18.3.1/umd/react-dom.production.min.js');

// ---------------------------------------------------------------------------
// Write output
// ---------------------------------------------------------------------------

fs.writeFileSync(OUT_HTML, outHtml, 'utf8');

const kb = (fs.statSync(OUT_HTML).size / 1024).toFixed(1);
console.log(`Written: ${path.relative(ROOT, OUT_HTML)} (${kb} KB)`);
console.log('Open with:  open ' + OUT_HTML + '  # or drag into browser');
})(); // end async main
