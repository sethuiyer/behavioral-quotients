#!/usr/bin/env node
// Typeset every equation in index.html through the MathJax v3 node API and fail
// on the first error. Exit code 0 = every equation rendered without a `merror`.
//
// Run standalone (`node check-math.mjs`) or as part of verify.mjs (test T9);
// both call lib/mathcheck.mjs, so they can never disagree about what counts as
// rendering.

import fs from 'node:fs';
import path from 'node:path';

import { checkMath } from './lib/mathcheck.mjs';
import { SITE_DIR, INDEX_PATH, stableJson } from './lib/util.mjs';

const report = checkMath(fs.readFileSync(INDEX_PATH, 'utf8'));
fs.writeFileSync(path.join(SITE_DIR, 'math-report.json'), stableJson(report));

if (report.errors) {
  console.error(`MathJax reported ${report.errors} error(s) over ${report.equations} equations:`);
  for (const f of report.failures.slice(0, 20)) {
    console.error(`  [${f.display ? 'display' : 'inline'}/${f.where}] ${f.tex}`);
    console.error(`      -> ${f.error}`);
  }
  if (report.errors > 20) console.error(`  … and ${report.errors - 20} more`);
  process.exit(1);
}

console.log(`0 errors over ${report.equations} equations`);
