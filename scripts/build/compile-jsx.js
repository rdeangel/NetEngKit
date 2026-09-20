/**
 * compile-jsx.js — Shared JSX pre-compilation utility
 *
 * Uses esbuild to transform JSX → plain JS (React.createElement calls).
 * No module system introduced — components remain global-scope scripts.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

/**
 * Compile an array of JSX files to plain JS.
 * @param {string[]} files - Relative file paths (e.g. ['components/SubnetCalc.jsx'])
 * @param {string} rootDir - Project root directory
 * @returns {{ relPath: string, code: string }[]}
 */
function compileJsxFiles(files, rootDir) {
  const results = [];
  for (const relPath of files) {
    const absPath = path.resolve(rootDir, relPath);
    const src = fs.readFileSync(absPath, 'utf8');
    try {
      const { code } = esbuild.transformSync(src, {
        loader: 'jsx',
        jsx: 'transform',
        jsxFactory: 'React.createElement',
        jsxFragment: 'React.Fragment',
        target: 'es2020',
      });
      results.push({ relPath, code });
    } catch (err) {
      console.error(`Error compiling ${relPath}:`);
      if (err.errors && err.errors.length) {
        for (const e of err.errors) {
          console.error(`  ${e.text} (line ${e.location?.line}, col ${e.location?.column})`);
        }
      } else {
        console.error(`  ${err.message}`);
      }
      process.exit(1);
    }
  }
  return results;
}

module.exports = { compileJsxFiles };
