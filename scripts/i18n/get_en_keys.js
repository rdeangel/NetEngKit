const fs = require('fs');
const path = require('path');
const content = fs.readFileSync(path.join(__dirname, '../../languages/en.js'), 'utf8');

// Use a regex to extract the keys from the en object
const enMatch = content.match(/TRANSLATIONS\["en"\] = \{([\s\S]*)\};/);
if (!enMatch) {
  console.error("Could not find en block");
  process.exit(1);
}

const enStr = "{" + enMatch[1] + "}";
// We can't easily JSON.parse because it's JS, not JSON.
// But we can extract keys.
const toolKeys = [];
const lines = enMatch[1].split('\n');
let currentKey = null;
let depth = 0;

for (let line of lines) {
    const keyMatch = line.match(/^    ([a-z0-9_-]+): \{/);
    if (keyMatch) {
        toolKeys.push(keyMatch[1]);
    }
}
console.log(toolKeys.join(','));
