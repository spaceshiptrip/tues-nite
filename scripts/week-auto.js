#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const WEEK = process.argv[2];

if (!WEEK) {
  console.error('Usage: npm run week:auto 7');
  process.exit(1);
}

const weekNum = String(WEEK).padStart(3, '0');
const file = `history/weeks/week-${weekNum}.json`;

if (!fs.existsSync(file)) {
  console.error(`Missing weekly file: ${file}`);
  process.exit(1);
}

console.log(`\n=== Week ${WEEK} Auto Pipeline ===\n`);

try {
  execSync('npm run sync', { stdio: 'inherit' });

  execSync(`npm run validate:week -- ${file}`, { stdio: 'inherit' });

  execSync(`npm run merge -- ${file}`, { stdio: 'inherit' });

  execSync('npm run validate:history', { stdio: 'inherit' });

  console.log('\n✅ Week pipeline complete\n');
} catch (err) {
  console.error('\n❌ Pipeline failed\n');
  process.exit(1);
}
