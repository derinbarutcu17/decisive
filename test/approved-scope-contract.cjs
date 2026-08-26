const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('index.html');
const app = read('app.js');
const background = read('ascii-background.js');
const server = read('server.js');

assert.match(app, /function archiveItems\(\) \{ return tasks\.filter\(t => t\.done && t\.archived\)/);
assert.match(html, /id="app-status"[^>]*role="status"/);
assert.match(html, /id="settings-toggle"/);
assert.match(html, /id="settings-toggle"[^>]*aria-haspopup="dialog"/);
assert.match(html, /id="ascii-background-toggle"/);
assert.match(html, /id="scatter-names-button"/);
assert.doesNotMatch(html, /id="task-names-toggle"/);
assert.match(app, /scatterNamesVisible/);
assert.match(app, /setScatterNamesVisible/);
assert.doesNotMatch(app, /task-names-toggle/);
assert.match(html, /id="archive-delete"/);
assert.match(app, /API\}\?archived=true/);
assert.match(server, /searchParams\.get\('archived'\) === 'true'/);
assert.match(read('style.css'), /#console > \.app-identity \{ z-index: 4; \}/);
assert.match(html, /class="scatter-zone zone-do"[^>]*aria-label="Do:/);
assert.match(html, /class="scatter-zone zone-schedule"[^>]*aria-label="Schedule:/);
assert.match(html, /class="scatter-zone zone-delegate"[^>]*aria-label="Delegate:/);
assert.match(html, /class="scatter-zone zone-eliminate"[^>]*aria-label="Eliminate:/);
assert.match(background, /decisive:ascii-background/);
assert.match(background, /decisive\.asciiBackgroundEnabled/);
assert.match(server, /only completed tasks can be archived/);

console.log('APPROVED SCOPE CONTRACT PASS');
