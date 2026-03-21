#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const HISTORY_PATH = path.resolve('public/bowler-history.json');
const WEEK_FILE = process.argv[2];

if (!WEEK_FILE) {
  console.error('Usage: npm run week:diff -- history/weeks/week-007.json');
  process.exit(1);
}

if (!fs.existsSync(HISTORY_PATH)) {
  console.error('Missing bowler-history.json');
  process.exit(1);
}

const history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
const week = JSON.parse(fs.readFileSync(WEEK_FILE, 'utf8'));

const weekNum = week.meta.weekNum;

console.log(`\n=== Diff for Week ${weekNum} ===\n`);

for (const b of week.bowlers) {
  const existing = history.bowlers?.[String(b.bowlerId)];
  if (!existing) continue;

  const prev = existing.weeks?.find(w => Number(w.weekNum) === Number(weekNum));
  if (!prev) continue;

  const newGames = b.games || [];
  const oldGames = prev.games || [];

  for (let i = 0; i < 3; i++) {
    if (newGames[i] !== oldGames[i]) {
      console.log(
        `${b.bowlerName} game ${i + 1}: ${oldGames[i] ?? '-'} → ${newGames[i] ?? '-'}`
      );
    }
  }

  if (b.scratchSeries !== prev.scratchSeries) {
    console.log(
      `${b.bowlerName} series: ${prev.scratchSeries} → ${b.scratchSeries}`
    );
  }
}

console.log('\nDone.\n');
