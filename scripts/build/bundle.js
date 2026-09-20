#!/usr/bin/env node
// bundle.js — Converts an online HTML file with external CDN/font resources
// into a self-contained offline HTML using the __bundler format.
// JSX is pre-compiled to plain JS via esbuild — no Babel needed at runtime.
//
// Usage: node bundle.js input.html [-o output.html]

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');
const { compileJsxFiles } = require('./compile-jsx');
const { generateMozillaRoots } = require('./generate-mozilla-roots');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    mod.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetchUrl(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
    }).on('error', reject);
  });
}

function uuid() {
  return crypto.randomUUID();
}

function gzip(buf) {
  return new Promise((resolve, reject) => {
    zlib.gzip(buf, { level: 9 }, (err, result) => {
      if (err) reject(err);
      else resolve(result);
    });
  });
}

function getMime(url) {
  if (url.endsWith('.woff2')) return 'font/woff2';
  if (url.endsWith('.woff')) return 'font/woff';
  if (url.endsWith('.ttf')) return 'font/ttf';
  if (url.endsWith('.css')) return 'text/css';
  if (url.endsWith('.js') || url.endsWith('.jsx')) return 'text/javascript';
  return 'application/octet-stream';
}

function shouldCompress(mime) {
  return mime.startsWith('text/') || mime === 'application/javascript';
}

// ---------------------------------------------------------------------------
// Boot script (generic __bundler loader — copied from reference offline file)
// ---------------------------------------------------------------------------

const BOOT_SCRIPT = `<script>

document.addEventListener('DOMContentLoaded', async function() {
  const loading = document.getElementById('__bundler_loading');
  function setStatus(msg) { if (loading) loading.textContent = msg; }

  window.addEventListener('error', function(e) {
    var p = document.body || document.documentElement;
    var d = document.getElementById('__bundler_err') || p.appendChild(document.createElement('div'));
    d.id = '__bundler_err';
    d.style.cssText = 'position:fixed;bottom:12px;left:12px;right:12px;font:12px/1.4 ui-monospace,monospace;background:#2a1215;color:#ff8a80;padding:10px 14px;border-radius:8px;border:1px solid #5c2b2e;z-index:99999;white-space:pre-wrap;max-height:40vh;overflow:auto';
    d.textContent = (d.textContent ? d.textContent + String.fromCharCode(10) : '') +
      '[bundle] ' + (e.message || e.type) +
      (e.filename ? ' (' + e.filename.slice(0, 60) + ':' + e.lineno + ')' : '');
  }, true);

  try {
    const manifestEl = document.querySelector('script[type="__bundler/manifest"]');
    const templateEl = document.querySelector('script[type="__bundler/template"]');
    if (!manifestEl || !templateEl) {
      setStatus('Error: missing bundle data');
      console.error('[bundler] Missing script tags');
      return;
    }

    const manifest = JSON.parse(manifestEl.textContent);
    let template = JSON.parse(templateEl.textContent);

    const uuids = Object.keys(manifest);
    setStatus('Unpacking ' + uuids.length + ' assets...');

    const blobUrls = {};
    await Promise.all(uuids.map(async (uuid) => {
      const entry = manifest[uuid];
      try {
        const binaryStr = atob(entry.data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

        let finalBytes = bytes;
        if (entry.compressed) {
          if (typeof DecompressionStream !== 'undefined') {
            const ds = new DecompressionStream('gzip');
            const writer = ds.writable.getWriter();
            const reader = ds.readable.getReader();
            writer.write(bytes);
            writer.close();
            const chunks = [];
            let totalLen = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              totalLen += value.length;
            }
            finalBytes = new Uint8Array(totalLen);
            let offset = 0;
            for (const chunk of chunks) { finalBytes.set(chunk, offset); offset += chunk.length; }
          } else {
            console.warn('DecompressionStream not available, asset ' + uuid + ' may not render');
          }
        }

        blobUrls[uuid] = URL.createObjectURL(new Blob([finalBytes], { type: entry.mime }));
      } catch (err) {
        console.error('Failed to decode asset ' + uuid + ':', err);
        blobUrls[uuid] = URL.createObjectURL(new Blob([], { type: entry.mime }));
      }
    }));

    const extResEl = document.querySelector('script[type="__bundler/ext_resources"]');
    const extResources = extResEl ? JSON.parse(extResEl.textContent) : [];
    const resourceMap = {};
    for (const entry of extResources) {
      if (blobUrls[entry.uuid]) resourceMap[entry.id] = blobUrls[entry.uuid];
    }

    setStatus('Rendering...');
    if (uuids.length > 0) {
      const regex = new RegExp(uuids.join('|'), 'g');
      template = template.replace(regex, (match) => blobUrls[match]);
    }

    template = template.replace(/\\s+integrity="[^"]*"/gi, '').replace(/\\s+crossorigin="[^"]*"/gi, '');

    const resourceScript = '<script>window.__resources = ' +
      JSON.stringify(resourceMap).split('</' + 'script>').join('<\\/' + 'script>') +
      ';</' + 'script>';
    const headOpen = template.match(/<head[^>]*>/i);
    if (headOpen) {
      const i = headOpen.index + headOpen[0].length;
      template = template.slice(0, i) + resourceScript + template.slice(i);
    }

    const doc = new DOMParser().parseFromString(template, 'text/html');
    document.documentElement.replaceWith(doc.documentElement);
    const dead = Array.from(document.scripts);
    for (const old of dead) {
      const s = document.createElement('script');
      for (const a of old.attributes) s.setAttribute(a.name, a.value);
      s.textContent = old.textContent;
      const p = s.src ? new Promise(function(r) { s.onload = s.onerror = r; }) : null;
      old.replaceWith(s);
      if (p) await p;
    }
    document.dispatchEvent(new Event('DOMContentLoaded', { bubbles: true, cancelable: true }));
    window.dispatchEvent(new Event('load'));
  } catch (err) {
    setStatus('Error unpacking: ' + err.message);
    console.error('Bundle unpack error:', err);
  }
});
  </script>`;

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    console.log('Usage: node bundle.js <input.html> [-o <output.html>]');
    process.exit(args.includes('-h') || args.includes('--help') ? 0 : 1);
  }

  // Pre-build: generate data files (non-fatal)
  try {
    await generateMozillaRoots();
  } catch (e) {
    console.warn(`WARNING: Failed to generate Mozilla root store data: ${e.message}`);
    console.warn('Bundling without fresh root store data. Root trust check may use stale data.');
  }

  const inputPath = args[0];
  let outputPath = null;
  const oIdx = args.indexOf('-o');
  if (oIdx !== -1 && args[oIdx + 1]) {
    outputPath = args[oIdx + 1];
  } else {
    const ext = path.extname(inputPath);
    const base = path.basename(inputPath, ext);
    outputPath = path.join(path.dirname(inputPath), base + '-offline' + ext);
  }

  console.log(`Reading ${inputPath}...`);
  const html = fs.readFileSync(inputPath, 'utf8');

  // ---- Extract metadata from source HTML ----
  const titleMatch = html.match(/<title>([^<]*)<\/title>/i);
  const pageTitle = titleMatch ? titleMatch[1] : path.basename(inputPath, path.extname(inputPath));

  // ---- Step 0: Pre-compile JSX files and replace in template ----
  const babelScriptRe = /<script\s+type="text\/babel"\s+src="([^"]+)"\s*><\/script>/g;
  const jsxTags = [];
  let bm;
  while ((bm = babelScriptRe.exec(html)) !== null) {
    jsxTags.push({ fullTag: bm[0], src: bm[1] });
  }
  console.log(`Found ${jsxTags.length} JSX script tags — pre-compiling...`);

  if (jsxTags.length > 0) {
    const jsxFiles = jsxTags.map(t => t.src);
    const compiled = compileJsxFiles(jsxFiles, path.dirname(inputPath));

    // Also handle React destructuring dedup (same as build-dev.js)
    const REACT_DESTRUCTURE_RE = /^const\s+\{[^}]+\}\s*=\s*React\s*;?\s*$/m;
    let template2 = html;
    for (let i = 0; i < jsxTags.length; i++) {
      let code = compiled[i].code;
      // Strip React destructuring from all except first JSX file
      if (i > 0 && REACT_DESTRUCTURE_RE.test(code)) {
        code = code.replace(REACT_DESTRUCTURE_RE, '').replace(/^\n/, '');
      }
      // Escape $ so replace() doesn't interpret $& / $1 etc. as replacement patterns,
      // then escape </script> to avoid prematurely closing the tag.
      const escapedCode = code
        .replace(/\$/g, '$$$$')
        .replace(/<\/(script)/gi, '<\\/$1');
      template2 = template2.replace(jsxTags[i].fullTag, `<script>\n${escapedCode}\n  </script>`);
    }
    // Write modified template to a temp var — we'll use it as the base template
    var precompiledHtml = template2;
  } else {
    var precompiledHtml = html;
  }

  // Use the pre-compiled HTML as the working source
  // Switch React to production builds before collecting script resources
  let workingHtml = precompiledHtml
    .replace('react@18.3.1/umd/react.development.js', 'react@18.3.1/umd/react.production.min.js')
    .replace('react-dom@18.3.1/umd/react-dom.development.js', 'react-dom@18.3.1/umd/react-dom.production.min.js');

  // ---- Step 1: Find <script src> tags (both remote and local) — skip Babel ----
  const scriptRe = /<script\s[^>]*src="([^"]+)"[^>]*><\/script>/gi;
  const scriptMatches = [];
  let m;
  while ((m = scriptRe.exec(workingHtml)) !== null) {
    const src = m[1];
    const isRemote = /^https?:\/\//.test(src);
    // Skip Babel Standalone — no longer needed after pre-compilation
    if (/@babel\/standalone/.test(src)) continue;
    scriptMatches.push({ fullTag: m[0], src, isRemote });
  }
  console.log(`Found ${scriptMatches.length} scripts (${scriptMatches.filter(s => s.isRemote).length} remote, ${scriptMatches.filter(s => !s.isRemote).length} local)`);

  // ---- Step 2: Find external CSS <link> tags ----
  const linkRe = /<link[^>]+href="(https?:\/\/[^"]+)"[^>]*rel="stylesheet"[^>]*\/?>|<link[^>]+rel="stylesheet"[^>]+href="(https?:\/\/[^"]+)"[^>]*\/?>/gi;
  const cssLinks = [];
  while ((m = linkRe.exec(workingHtml)) !== null) {
    const url = m[1] || m[2];
    cssLinks.push({ fullTag: m[0], url });
  }
  console.log(`Found ${cssLinks.length} external CSS links`);

  // ---- Step 2b: Find all <link rel="preconnect"> for cleanup later ----
  const preconnectRe = /<link[^>]+rel="preconnect"[^>]*\/?>/gi;
  const preconnectLinks = [];
  while ((m = preconnectRe.exec(workingHtml)) !== null) {
    preconnectLinks.push(m[0]);
  }

  // ---- Step 3: Fetch all JS resources ----
  const manifest = {};
  const srcToUuid = {};
  const allFetches = [];

  for (const sm of scriptMatches) {
    const id = uuid();
    srcToUuid[sm.src] = id;
    if (sm.isRemote) {
      console.log(`  Fetching JS: ${sm.src.substring(0, 70)}...`);
      allFetches.push(
        fetchUrl(sm.src).then(buf => {
          const mime = getMime(sm.src);
          return { id, mime, buf };
        })
      );
    } else {
      // Local file — read from disk relative to the input HTML
      const localPath = path.resolve(path.dirname(inputPath), sm.src);
      console.log(`  Reading local JS: ${sm.src}`);
      const buf = fs.readFileSync(localPath);
      const mime = getMime(sm.src);
      allFetches.push(Promise.resolve({ id, mime, buf }));
    }
  }

  // ---- Step 4: Fetch external CSS, parse font URLs ----
  for (const cl of cssLinks) {
    console.log(`  Fetching CSS: ${cl.url.substring(0, 70)}...`);
    const fetchCSS = () => new Promise((resolve, reject) => {
      const mod = cl.url.startsWith('https') ? https : http;
      mod.get(cl.url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
          'Accept': 'text/css,*/*;q=0.1',
        }
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return fetchCSS(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`HTTP ${res.statusCode} for CSS`));
        }
        const encoding = res.headers['content-encoding'];
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks);
          if (encoding === 'gzip') {
            zlib.gunzip(raw, (err, decoded) => err ? reject(err) : resolve(decoded));
          } else if (encoding === 'deflate') {
            zlib.inflate(raw, (err, decoded) => err ? reject(err) : resolve(decoded));
          } else if (encoding === 'br') {
            zlib.brotliDecompress(raw, (err, decoded) => err ? reject(err) : resolve(decoded));
          } else {
            resolve(raw);
          }
        });
      }).on('error', reject);
    });

    allFetches.push(
      fetchCSS().then(async (cssBuf) => {
        let css = cssBuf.toString('utf8');

        // Find all url() references to external font/image resources in the CSS
        const fontUrlRe = /url\((["']?)(https?:\/\/[^)"']+)\.(woff2|woff|ttf|otf|eot|svg|png|jpg|jpeg|gif|webp)["']?\)/gi;
        let fm;
        const fontUrls = new Map(); // url -> uuid
        while ((fm = fontUrlRe.exec(css)) !== null) {
          const fullUrl = fm[2] + '.' + fm[3];
          if (!fontUrls.has(fullUrl)) fontUrls.set(fullUrl, uuid());
        }
        console.log(`    Found ${fontUrls.size} external resources in CSS`);

        // Fetch each resource and add to manifest
        for (const [fUrl, fId] of fontUrls) {
          srcToUuid[fUrl] = fId;
          const fBuf = await fetchUrl(fUrl);
          const fMime = getMime(fUrl);
          const compressed = shouldCompress(fMime);
          if (compressed) {
            const gzipped = await gzip(fBuf);
            manifest[fId] = { mime: fMime, compressed: true, data: gzipped.toString('base64') };
          } else {
            manifest[fId] = { mime: fMime, compressed: false, data: fBuf.toString('base64') };
          }
          css = css.split(fUrl).join(fId);
        }

        return { type: 'cssLink', originalTag: cl.fullTag, url: cl.url, css };
      })
    );
  }

  const results = await Promise.all(allFetches);

  // ---- Step 5: Build manifest entries for JS resources ----
  for (const r of results) {
    if (r.type === 'cssLink') continue;
    const b64 = r.buf.toString('base64');
    const compressed = shouldCompress(r.mime);
    if (compressed) {
      const gzipped = await gzip(r.buf);
      manifest[r.id] = { mime: r.mime, compressed: true, data: gzipped.toString('base64') };
    } else {
      manifest[r.id] = { mime: r.mime, compressed: false, data: b64 };
    }
  }

  console.log(`Manifest has ${Object.keys(manifest).length} entries`);

  // ---- Step 5b: Embed Mermaid as a lazy resource ----
  // mermaid.min.js is gitignored. npm install / fetch-mermaid.js downloads it once;
  // later offline builds reuse that file. If it is missing, fetch and cache it here.
  const { ensureMermaidFile } = require('./fetch-mermaid');
  const mermaidLazyId = 'mermaid-lazy';
  const extResourcesExtra = [];
  try {
    const mermaidPath = path.resolve(path.dirname(inputPath), 'mermaid.min.js');
    const { buf: mermaidBuf, cached } = await ensureMermaidFile({ dest: mermaidPath });
    const src = cached ? 'local cache' : 'jsDelivr (cached for next build)';
    console.log(`  Embedded mermaid.min.js (${(mermaidBuf.length / 1024 / 1024).toFixed(2)} MB, ${src}) as lazy resource`);
    const mermaidUuid = uuid();
    const mermaidGz = await gzip(mermaidBuf);
    manifest[mermaidUuid] = { mime: 'text/javascript', compressed: true, data: mermaidGz.toString('base64') };
    extResourcesExtra.push({ id: mermaidLazyId, uuid: mermaidUuid });
  } catch (err) {
    console.warn(`  Could not embed mermaid (${err.message}); diagram tools will fall back to CDN at runtime`);
  }

  // ---- Step 6: Build the template ----
  let template = workingHtml;

  // Replace external <script src> tags with UUID'd versions, preserving all other attributes
  for (const sm of scriptMatches) {
    const id = srcToUuid[sm.src];
    template = template.replace(sm.fullTag, sm.fullTag.replace(`src="${sm.src}"`, `src="${id}"`));
  }

  // Replace external CSS <link> tags with inlined <style>
  for (const r of results) {
    if (r.type !== 'cssLink') continue;
    template = template.replace(r.originalTag, `<style>\n${r.css}\n  </style>`);
  }

  // Remove preconnect links for domains we've inlined
  for (const pl of preconnectLinks) {
    template = template.replace(pl, '');
  }

  // Remove Babel Standalone CDN tag from template
  template = template.replace(/\s*<script\s+defer\s+src="[^"]*@babel\/standalone[^"]*"[^>]*><\/script>\n?/, '');

  // Stringify the template, then escape </script> </style> </title> etc.
  // so the browser's HTML parser doesn't prematurely close our <script type="__bundler/template"> tag.
  let templateJSON = JSON.stringify(template);
  templateJSON = templateJSON.replace(/<\/(script|style|title)/gi, '<\\u002F$1');

  // ---- Step 7: Generate thumbnail SVG from title ----
  const thumbLines = [];
  const words = pageTitle.split(/\s+/);
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (test.length > 28) {
      if (line) thumbLines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) thumbLines.push(line);

  const thumbSvg = `<svg viewBox="0 0 400 300" xmlns="http://www.w3.org/2000/svg">
    <rect width="400" height="300" fill="#1a1a2e"></rect>
    <rect x="40" y="100" width="320" height="100" rx="8" fill="#16213e"></rect>
    <text x="200" y="155" fill="#e2e8f0" font-size="18" font-family="sans-serif" text-anchor="middle">${thumbLines[0] || ''}</text>
    ${thumbLines[1] ? `<text x="200" y="180" fill="#94a3b8" font-size="14" font-family="sans-serif" text-anchor="middle">${thumbLines[1]}</text>` : ''}
  </svg>`;

  // ---- Step 8: Assemble the output ----
  const extResources = [...extResourcesExtra];

  const output = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>${pageTitle}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: #1a1a2e; display: flex; align-items: center; justify-content: center; min-height: 100vh; font-family: -apple-system, BlinkMacSystemFont, sans-serif; }
    #__bundler_loading { position: fixed; bottom: 20px; right: 20px; font: 13px/1.4 -apple-system, BlinkMacSystemFont, sans-serif; color: #666; background: #fff; padding: 8px 14px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,0.12); z-index: 10000; }
    #__bundler_thumbnail { position: fixed; inset: 0; width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; background: #1a1a2e; z-index: 9999; }
    #__bundler_thumbnail svg { width: 100%; height: 100%; object-fit: contain; }
    #__bundler_placeholder { color: #999; font-size: 14px; }
  </style>
  <noscript>
    <style>#__bundler_loading { display: none; }</style>
    <div style="position:fixed;bottom:12px;left:12px;font:13px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;color:#999;background:rgba(255,255,255,0.9);padding:6px 12px;border-radius:6px;box-shadow:0 1px 4px rgba(0,0,0,0.08);z-index:10000;">
      This page requires JavaScript to display.
    </div>
  </noscript>
</head>
<body>
  <div id="__bundler_thumbnail">
  ${thumbSvg}
</div>
  <div id="__bundler_loading">Unpacking...</div>

${BOOT_SCRIPT}

  <script type="__bundler/manifest">
${JSON.stringify(manifest)}
  </script>
  <script type="__bundler/ext_resources">
${JSON.stringify(extResources)}
  </script>
  <script type="__bundler/template">
${templateJSON}
  </script>
</body>
</html>`;

  fs.writeFileSync(outputPath, output);
  const sizeMB = (Buffer.byteLength(output) / 1024 / 1024).toFixed(2);
  console.log(`\nDone! Wrote ${outputPath} (${sizeMB} MB)`);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
