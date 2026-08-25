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
assert.match(html, /id="scatter-names-setting"/);
assert.doesNotMatch(html, /id="task-names-toggle"/);
assert.match(app, /scatterNamesVisible/);
assert.match(app, /setScatterNamesVisible/);
assert.doesNotMatch(app, /task-names-toggle/);
assert.match(html, /id="archive-delete"/);
assert.match(app, /API\}\?archived=true/);
assert.match(server, /archived=true/);
assert.match(read('style.css'), /#console > \.app-identity \{ z-index: 4; \}/);
assert.match(html, /class="scatter-zone-label"[^>]*>Do</);
assert.match(html, /class="scatter-zone-label"[^>]*>Schedule</);
assert.match(html, /class="scatter-zone-label"[^>]*>Delegate</);
assert.match(html, /class="scatter-zone-label"[^>]*>Eliminate</);
assert.match(background, /decisive:ascii-background/);
assert.match(background, /decisive\.asciiBackgroundEnabled/);
assert.match(server, /only completed tasks can be archived/);

console.log('APPROVED SCOPE CONTRACT PASS');
