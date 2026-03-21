#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const HISTORY_PATH = path.resolve('public/bowler-history.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function usage() {
  console.log(`
Usage:
  node scripts/report-bowler-history.js --name "Jay Torres"
  node scripts/report-bowler-history.js --id 1
  node scripts/report-bowler-history.js --list
  node scripts/report-bowler-history.js --top-series
  node scripts/report-bowler-history.js --top-game

Options:
  --id <bowlerId>         Report one bowler by BowlerID
  --name "<name>"         Report one bowler by name contains match
  --list                  List all bowlers in bowler-history.json
  --top-series            Show top scratch series entries across all weeks
  --top-game              Show top single games across all weeks
`);
}

function requireHistory() {
  if (!fs.existsSync(HISTORY_PATH)) {
    throw new Error(`Missing ${HISTORY_PATH}. Run the merge script first.`);
  }
  return loadJson(HISTORY_PATH);
}

function normalize(s) {
  return String(s ?? '').toLowerCase().trim();
}

function formatGames(games) {
  if (!Array.isArray(games)) return '-';
  return games.map(v => (v == null ? '-' : v)).join(' / ');
}

function listBowlers(history) {
  const rows = Object.values(history.bowlers)
    .sort((a, b) => String(a.bowlerName).localeCompare(String(b.bowlerName)))
    .map(b => ({
      bowlerId: b.bowlerId,
      bowlerName: b.bowlerName,
      weeks: Array.isArray(b.weeks) ? b.weeks.length : 0
    }));

  for (const row of rows) {
    console.log(`${row.bowlerId}\t${row.bowlerName}\tweeks=${row.weeks}`);
  }
}

function findById(history, bowlerId) {
  return history.bowlers[String(bowlerId)] ?? null;
}

function findByName(history, name) {
  const q = normalize(name);
  return Object.values(history.bowlers).filter(b => normalize(b.bowlerName).includes(q));
}

function printBowlerReport(bowler) {
  console.log(`\n${bowler.bowlerName} (BowlerID ${bowler.bowlerId})`);
  console.log('='.repeat(60));

  const weeks = [...(bowler.weeks ?? [])].sort((a, b) => Number(a.weekNum) - Number(b.weekNum));

  if (!weeks.length) {
    console.log('No weeks found.');
    return;
  }

  for (const w of weeks) {
    const flags = [];
    if (w.didBowl === false) flags.push('ABSENT');
    if (w.isSubstitute === true) flags.push('SUB');
    const flagText = flags.length ? ` [${flags.join(', ')}]` : '';

    console.log(
      `Week ${w.weekNum} | ${w.dateBowled} | ${w.teamName} (${w.teamId})${flagText}`
    );
    console.log(
      `  games=${formatGames(w.games)} | scratch=${w.scratchSeries ?? '-'} | hdcp=${w.handicapSeries ?? '-'} | handicap=${w.handicap ?? '-'}`
    );

    if (w.isSubstitute) {
      console.log(
        `  substituteFor=${w.substituteForBowlerName ?? w.substituteForBowlerId ?? 'UNKNOWN'} | method=${w.assignmentMethod ?? 'UNKNOWN'}`
      );
    }
  }

  const bowledWeeks = weeks.filter(w => w.didBowl === true);
  const totalScratch = bowledWeeks.reduce((sum, w) => sum + Number(w.scratchSeries ?? 0), 0);
  const totalGames = bowledWeeks.reduce(
    (sum, w) => sum + (Array.isArray(w.games) ? w.games.filter(v => v != null).length : 0),
    0
  );
  const avg = totalGames ? (totalScratch / totalGames).toFixed(2) : '0.00';

  console.log('\nSummary');
  console.log(`  total weeks: ${weeks.length}`);
  console.log(`  bowled weeks: ${bowledWeeks.length}`);
  console.log(`  total scratch: ${totalScratch}`);
  console.log(`  average over recorded games: ${avg}`);
}

function getTopSeries(history, limit = 20) {
  const rows = [];

  for (const bowler of Object.values(history.bowlers)) {
    for (const w of bowler.weeks ?? []) {
      if (w.didBowl !== true) continue;
      rows.push({
        bowlerId: bowler.bowlerId,
        bowlerName: bowler.bowlerName,
        weekNum: w.weekNum,
        dateBowled: w.dateBowled,
        teamName: w.teamName,
        scratchSeries: w.scratchSeries ?? 0,
        handicapSeries: w.handicapSeries ?? 0,
        games: w.games ?? []
      });
    }
  }

  rows.sort((a, b) => Number(b.scratchSeries) - Number(a.scratchSeries));
  return rows.slice(0, limit);
}

function getTopGames(history, limit = 20) {
  const rows = [];

  for (const bowler of Object.values(history.bowlers)) {
    for (const w of bowler.weeks ?? []) {
      if (w.didBowl !== true) continue;
      for (let i = 0; i < (w.games ?? []).length; i++) {
        const g = w.games[i];
        if (g == null) continue;
        rows.push({
          bowlerId: bowler.bowlerId,
          bowlerName: bowler.bowlerName,
          weekNum: w.weekNum,
          dateBowled: w.dateBowled,
          teamName: w.teamName,
          gameNumber: i + 1,
          score: g,
          scoreWithHandicap: Number(g) + Number(w.handicap ?? 0)
        });
      }
    }
  }

  rows.sort((a, b) => Number(b.score) - Number(a.score));
  return rows.slice(0, limit);
}

function printTopSeries(rows) {
  console.log('\nTop Scratch Series');
  console.log('='.repeat(60));
  rows.forEach((r, idx) => {
    console.log(
      `${idx + 1}. ${r.bowlerName} (ID ${r.bowlerId}) | week ${r.weekNum} | ${r.scratchSeries} | games ${formatGames(r.games)} | ${r.teamName}`
    );
  });
}

function printTopGames(rows) {
  console.log('\nTop Scratch Games');
  console.log('='.repeat(60));
  rows.forEach((r, idx) => {
    console.log(
      `${idx + 1}. ${r.bowlerName} (ID ${r.bowlerId}) | week ${r.weekNum} game ${r.gameNumber} | scratch ${r.score} | hdcp ${r.scoreWithHandicap} | ${r.teamName}`
    );
  });
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    usage();
    process.exit(1);
  }

  const history = requireHistory();

  if (args.includes('--list')) {
    listBowlers(history);
    return;
  }

  if (args.includes('--top-series')) {
    printTopSeries(getTopSeries(history));
    return;
  }

  if (args.includes('--top-game')) {
    printTopGames(getTopGames(history));
    return;
  }

  const idIdx = args.indexOf('--id');
  if (idIdx >= 0) {
    const id = args[idIdx + 1];
    if (!id) throw new Error('--id requires a value');
    const bowler = findById(history, id);
    if (!bowler) throw new Error(`No bowler found for ID ${id}`);
    printBowlerReport(bowler);
    return;
  }

  const nameIdx = args.indexOf('--name');
  if (nameIdx >= 0) {
    const name = args[nameIdx + 1];
    if (!name) throw new Error('--name requires a value');
    const matches = findByName(history, name);
    if (!matches.length) throw new Error(`No bowlers found matching "${name}"`);
    if (matches.length > 1) {
      console.log('Multiple matches found:');
      matches.forEach(b => console.log(`  ${b.bowlerId}\t${b.bowlerName}`));
      process.exit(2);
    }
    printBowlerReport(matches[0]);
    return;
  }

  usage();
  process.exit(1);
}

try {
  main();
} catch (err) {
  console.error(`ERROR: ${err.message}`);
  process.exit(1);
}
