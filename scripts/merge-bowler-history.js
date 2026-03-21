#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const HISTORY_PATH = path.resolve('public/bowler-history.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function saveJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function createEmptyHistory(meta = {}) {
  return {
    meta: {
      leagueId: meta.leagueId ?? null,
      leagueName: meta.leagueName ?? '',
      season: meta.season ?? '',
      lastMergedWeek: null,
      lastUpdated: todayYmd()
    },
    bowlers: {}
  };
}

function requireBowlerId(bowler, weekNum) {
  if (bowler.bowlerId === undefined || bowler.bowlerId === null || bowler.bowlerId === '') {
    throw new Error(
      `Weekly file week=${weekNum}: bowler "${bowler.bowlerName ?? 'UNKNOWN'}" is missing bowlerId`
    );
  }
}

function normalizeWeekEntry(raw, meta) {
  requireBowlerId(raw, meta.weekNum);

  const games = Array.isArray(raw.games) ? [...raw.games] : [null, null, null];
  const absent = Array.isArray(raw.absent) ? [...raw.absent] : [false, false, false];

  while (games.length < 3) games.push(null);
  while (absent.length < 3) absent.push(false);

  return {
    weekNum: meta.weekNum,
    dateBowled: meta.dateBowled ?? '',
    source: meta.source ?? 'recap-pdf',

    teamId: raw.teamId ?? null,
    teamName: raw.teamName ?? '',

    enteringAverage: raw.enteringAverage ?? null,
    handicap: raw.handicap ?? null,

    games,
    absent,
    didBowl: raw.didBowl ?? null,

    scratchSeries: raw.scratchSeries ?? null,
    handicapSeries: raw.handicapSeries ?? null,

    isSubstitute: raw.isSubstitute === true,
    substituteForBowlerId: raw.substituteForBowlerId ?? null,
    substituteForBowlerName: raw.substituteForBowlerName ?? null,
    assignmentMethod: raw.assignmentMethod ?? null,
    sourceSection: raw.sourceSection ?? null
  };
}

function ensureBowler(history, rawBowler) {
  const key = String(rawBowler.bowlerId);

  if (!history.bowlers[key]) {
    history.bowlers[key] = {
      bowlerId: rawBowler.bowlerId,
      bowlerName: rawBowler.bowlerName ?? '',
      weeks: []
    };
  } else if (!history.bowlers[key].bowlerName && rawBowler.bowlerName) {
    history.bowlers[key].bowlerName = rawBowler.bowlerName;
  }

  return history.bowlers[key];
}

function upsertWeek(history, weeklyFile) {
  if (!weeklyFile.meta?.weekNum) {
    throw new Error('Weekly file missing meta.weekNum');
  }
  if (!Array.isArray(weeklyFile.bowlers)) {
    throw new Error('Weekly file missing bowlers[]');
  }

  history.meta.leagueId ??= weeklyFile.meta.leagueId ?? null;
  history.meta.leagueName ||= weeklyFile.meta.leagueName ?? '';
  history.meta.season ||= weeklyFile.meta.season ?? '';

  let inserted = 0;
  let updated = 0;

  for (const raw of weeklyFile.bowlers) {
    const bowler = ensureBowler(history, raw);
    const normalizedWeek = normalizeWeekEntry(raw, weeklyFile.meta);

    const idx = bowler.weeks.findIndex(w => Number(w.weekNum) === Number(normalizedWeek.weekNum));

    if (idx >= 0) {
      bowler.weeks[idx] = normalizedWeek;
      updated += 1;
    } else {
      bowler.weeks.push(normalizedWeek);
      bowler.weeks.sort((a, b) => Number(a.weekNum) - Number(b.weekNum));
      inserted += 1;
    }
  }

  history.meta.lastMergedWeek = Math.max(
    Number(history.meta.lastMergedWeek ?? 0),
    Number(weeklyFile.meta.weekNum)
  );
  history.meta.lastUpdated = todayYmd();

  return { inserted, updated };
}

function summarize(history) {
  const bowlerIds = Object.keys(history.bowlers);
  const bowlerCount = bowlerIds.length;
  const weekEntries = bowlerIds.reduce(
    (sum, id) => sum + (Array.isArray(history.bowlers[id].weeks) ? history.bowlers[id].weeks.length : 0),
    0
  );

  return { bowlerCount, weekEntries };
}

function main() {
  const files = process.argv.slice(2);

  if (!files.length) {
    console.error(
      'Usage: node scripts/merge-bowler-history.js history/weeks/week-007.json [history/weeks/week-008.json ...]'
    );
    process.exit(1);
  }

  const history = fs.existsSync(HISTORY_PATH)
    ? loadJson(HISTORY_PATH)
    : createEmptyHistory();

  for (const file of files) {
    const weeklyFile = loadJson(path.resolve(file));
    const { inserted, updated } = upsertWeek(history, weeklyFile);
    console.log(`Merged ${file}: inserted=${inserted}, updated=${updated}`);
  }

  saveJson(HISTORY_PATH, history);

  const summary = summarize(history);
  console.log(`Saved ${HISTORY_PATH}`);
  console.log(`Bowlers: ${summary.bowlerCount}`);
  console.log(`Weekly entries: ${summary.weekEntries}`);
  console.log(`Last merged week: ${history.meta.lastMergedWeek}`);
}

main();
