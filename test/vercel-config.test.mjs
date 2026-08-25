import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const configPath = path.join(root, 'vercel.json');
assert.ok(existsSync(configPath), 'Vercel must have an explicit project config');

const config = JSON.parse(readFileSync(configPath, 'utf8'));
assert.equal(config.framework, null, 'the browser shell must use Vercel’s static/Other preset');
assert.ok(existsSync(path.join(root, 'index.html')), 'the browser shell entrypoint must exist');
assert.ok(existsSync(path.join(root, 'api', 'tasks.js')), 'the task API function must exist');
const packageJson = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
assert.ok(packageJson.build.files.includes('examples/demo-data.json'), 'the packaged app must include the demo fixture');
const index = readFileSync(path.join(root, 'index.html'), 'utf8');
assert.match(index, /id="restore-demo-content"/, 'settings must expose demo restore');
const apiSource = readFileSync(path.join(root, 'api', 'tasks.js'), 'utf8');
assert.match(apiSource, /\/api\/demo\/restore/, 'Vercel API must expose demo restore');

console.log('Vercel config PASS');
