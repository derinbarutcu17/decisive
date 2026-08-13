#!/usr/bin/env node
'use strict';

// Static regression audit for scatter-label motion.
// Run from the repository root with: node test/label-motion-regression.cjs

const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const appPath = path.join(repoRoot, 'app.js');
const stylePath = path.join(repoRoot, 'style.css');
let readError = false;

function readSource(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    readError = true;
    console.error(`LABEL MOTION REGRESSION AUDIT ERROR: cannot read ${filePath}`);
    console.error(error.message);
    return '';
  }
}

function lineNumber(source, index) {
  return source.slice(0, Math.max(0, index)).split('\n').length;
}

function lineAt(source, index) {
  return source.split('\n')[lineNumber(source, index) - 1]?.trim() || '';
}

function sourceBetween(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) return { text: '', start: -1, end: -1 };
  const end = source.indexOf(endMarker, start + startMarker.length);
  const resolvedEnd = end === -1 ? source.length : end;
  return { text: source.slice(start, resolvedEnd), start, end: resolvedEnd };
}

function cssBlocksContaining(source, selector) {
  const blocks = [];
  const selectorPattern = new RegExp(`[^{}]*${selector}[^{}]*\\{[^{}]*\\}`, 'g');
  for (const match of source.matchAll(selectorPattern)) {
    const block = match[0];
    const openingBrace = block.indexOf('{');
    blocks.push({
      text: block,
      body: block.slice(openingBrace + 1, -1),
      index: match.index,
    });
  }
  return blocks;
}

function firstMatch(source, pattern) {
  const match = source.match(pattern);
  return match ? { ...match, index: match.index } : null;
}

const appSource = readSource(appPath);
const styleSource = readSource(stylePath);
const layout = sourceBetween(
  appSource,
  'function layoutScatterLabels()',
  'function scheduleScatterLabelLayout()',
);

const checks = [];
function check(name, passed, evidence) {
  checks.push({ name, passed, evidence });
}

check('app.js and style.css are readable', !readError, 'Source files could not be read.');
check(
  'scatter label layout function is present',
  layout.start !== -1,
  `${appPath}: layoutScatterLabels() was not found`,
);

// A label may be measured for collision detection, but its in-flight DOM rect
// must not become the next animation target. That feedback loop makes the
// target chase the transition currently being rendered.
const liveRectFeedback = firstMatch(
  layout.text,
  /(?:const|let|var)\s+previousOffset\s*=\s*(?:currentOffset\b|[^;\n]*getBoundingClientRect\s*\()[^;\n]*;/,
);
const currentRectFeedback = firstMatch(
  layout.text,
  /(?:const|let|var)\s+currentOffset\s*=\s*[^;\n]*getBoundingClientRect\s*\([\s\S]*?\bpreviousOffset\s*=\s*currentOffset\b/,
);
const liveRectEvidence = liveRectFeedback || currentRectFeedback;
check(
  'scatter labels do not use a live getBoundingClientRect result as previous offset',
  !liveRectEvidence,
  liveRectEvidence
    ? `${appPath}:${lineNumber(appSource, layout.start + liveRectEvidence.index)} ${lineAt(appSource, layout.start + liveRectEvidence.index)}`
    : '',
);

// Label motion should be driven by transform so geometry reads do not force
// repeated left/top layout writes during a drag.
const labelBlocks = cssBlocksContaining(styleSource, '\\.scatter-task-label');
const leftTopTransitions = labelBlocks.filter(({ body }) =>
  /\btransition\s*:[^;{}]*(?:\bleft\b|\btop\b)/i.test(body),
);
check(
  'scatter labels do not transition left/top',
  leftTopTransitions.length === 0,
  leftTopTransitions.length
    ? leftTopTransitions.map(block => `${stylePath}:${lineNumber(styleSource, block.index)} ${lineAt(styleSource, block.index)}`).join('\n')
    : '',
);

// Dataset IDs are UUIDs, so numeric coercion is NaN and cannot provide a
// stable sort order for the label solver.
const uuidSort = firstMatch(
  layout.text,
  /\.sort\s*\([\s\S]*?Number\(\s*[A-Za-z_$][\w$]*\.dataset\.id\s*\)/,
);
check(
  'scatter label sorting does not numerically coerce UUID dataset IDs',
  !uuidSort,
  uuidSort
    ? `${appPath}:${lineNumber(appSource, layout.start + uuidSort.index)} ${lineAt(appSource, layout.start + uuidSort.index)}`
    : '',
);

const failed = checks.filter(result => !result.passed);
console.log(`LABEL MOTION REGRESSION AUDIT ${failed.length ? 'FAIL' : 'PASS'} (${checks.length - failed.length}/${checks.length})`);
for (const result of checks) {
  console.log(`${result.passed ? 'PASS' : 'FAIL'} ${result.name}`);
  if (!result.passed && result.evidence) console.log(`  ${result.evidence}`);
}

process.exitCode = failed.length ? 1 : 0;
