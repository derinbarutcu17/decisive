#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME || '';

if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error(`package version is not valid semver: ${pkg.version}`);
if (tag && tag !== `v${pkg.version}`) throw new Error(`release tag ${tag} does not match package version v${pkg.version}`);
if (!tag) console.warn('Release tag not supplied; version/tag comparison skipped for local use.');

const requiredFiles = ['main.cjs', 'server.js', 'index.html', 'app.js', 'style.css', 'examples/demo-data.json'];
for (const file of requiredFiles) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`required release file is missing: ${file}`);
}

async function main() {
  if (process.argv.includes('--artifacts')) {
    const dist = path.join(root, 'dist');
    const assets = fs.readdirSync(dist).filter(file => /\.(dmg|zip)$/.test(file));
    if (assets.length < 2) throw new Error(`expected arm64 and x64 release artifacts in dist; found ${assets.length}`);
    const lines = [];
    for (const asset of assets.sort()) {
      const buffer = await fsp.readFile(path.join(dist, asset));
      const digest = crypto.createHash('sha256').update(buffer).digest('hex');
      lines.push(`${digest}  ${asset}`);
    }
    await fsp.writeFile(path.join(dist, 'SHA256SUMS.txt'), `${lines.join('\n')}\n`);
    console.log(`RELEASE ARTIFACTS PASS (${assets.length} assets + SHA256SUMS.txt)`);
  } else {
    console.log(`RELEASE PREFLIGHT PASS (Decisive ${pkg.version})`);
  }
}

main().catch(error => {
  console.error(`RELEASE PREFLIGHT FAIL: ${error.message}`);
  process.exitCode = 1;
});
