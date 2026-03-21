#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

const HISTORY_PATH = path.resolve('public/bowler-history.json');

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isFiniteNumber(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

function validateMeta(meta, issues) {
  if (!meta || typeof meta !== 'object') {
    issues.push('Missing top-level meta object.');
    return;
  }

  if (meta.lastMergedWeek != null && !Number.isFinite(Number(meta.lastMergedWeek))) {
    issues.push(`meta.lastMergedWeek is not numeric: ${meta.lastMergedWeek}`);
  }
}

function validateWeek(bowler, week, issues, notes) {
  const label = `${bowler.bowlerName} (ID ${bowler.bowlerId}) week ${week.weekNum}`;

  if (!Number.isFinite(Number(week.weekNum))) {
    issues.push(`${label}: invalid weekNum`);
  }

  if (!Array.isArray(week.games) || week.games.length !== 3) {
    issues.push(`${label}: games must be an array of length 3`);
  }

  if (!Array.isArray(week.absent) || week.absent.length !== 3) {
    issues.push(`${label}: absent must be an array of length 3`);
  }

  if (Array.isArray(week.games)) {
    for (let i = 0; i < week.games.length; i++) {
      const g = week.games[i];
      if (g !== null && !isFiniteNumber(g)) {
        issues.push(`${label}: games[${i}] must be number or null`);
      }
    }
  }

  if (Array.isArray(week.absent)) {
    for (let i = 0; i < week.absent.length; i++) {
      if (typeof week.absent[i] !== 'boolean') {
        issues.push(`${label}: absent[${i}] must be boolean`);
      }
    }
  }

  if (week.didBowl != null && typeof week.didBowl !== 'boolean') {
    issues.push(`${label}: didBowl must be boolean or null`);
  }

  if (week.scratchSeries != null && !Number.isFinite(Number(week.scratchSeries))) {
    issues.push(`${label}: scratchSeries must be numeric or null`);
  }

  if (week.handicapSeries != null && !Number.isFinite(Number(week.handicapSeries))) {
    issues.push(`${label}: handicapSeries must be numeric or null`);
  }

  if (week.handicap != null && !Number.isFinite(Number(week.handicap))) {
    issues.push(`${label}: handicap must be numeric or null`);
  }

  if (week.didBowl === false) {
    if (Array.isArray(week.games)) {
      const hasNonNullGame = week.games.some(v => v != null);
      if (hasNonNullGame && Array.isArray(week.absent) && !week.absent.every(Boolean)) {
        issues.push(`${label}: didBowl=false but absent is not all true`);
      }
    }
  }

  if (week.didBowl === true) {
    if (Array.isArray(week.games) && week.games.every(v => v == null)) {
      issues.push(`${label}: didBowl=true but all games are null`);
    }
  }

  if (week.didBowl === true && Array.isArray(week.games) && week.scratchSeries != null) {
    const gameSum = week.games.reduce((sum, v) => sum + Number(v ?? 0), 0);
    if (Number(gameSum) !== Number(week.scratchSeries)) {
      issues.push(
        `${label}: scratchSeries=${week.scratchSeries} does not match games sum=${gameSum}`
      );
    }
  }

  if (week.didBowl === true && week.handicapSeries != null && week.handicap != null && Array.isArray(week.games)) {
    const gameCount = week.games.filter(v => v != null).length;
    const expected = week.games.reduce((sum, v) => sum + Number(v ?? 0), 0) + Number(week.handicap) * gameCount;
    if (Number(expected) !== Number(week.handicapSeries)) {
      notes.push(
        `${label}: handicapSeries=${week.handicapSeries} differs from games+handicap expected=${expected} (may be OK if source has special handling)`
      );
    }
  }

  if (week.isSubstitute === true) {
    if (week.substituteForBowlerId == null && !week.substituteForBowlerName) {
      issues.push(`${label}: substitute missing substituteForBowlerId/substituteForBowlerName`);
    }
    if (!week.assignmentMethod) {
      issues.push(`${label}: substitute missing assignmentMethod`);
    }
  }
}

function validateBowler(history, bowlerId, bowler, issues, notes) {
  if (String(bowler.bowlerId) !== String(bowlerId)) {
    issues.push(
      `Bowler key mismatch: object key=${bowlerId}, bowlerId=${bowler.bowlerId}`
    );
  }

  if (!bowler.bowlerName) {
    issues.push(`Bowler ${bowlerId} missing bowlerName`);
  }

  if (!Array.isArray(bowler.weeks)) {
    issues.push(`Bowler ${bowlerId} weeks must be an array`);
    return;
  }

  const seenWeeks = new Set();
  let prevWeek = -Infinity;

  for (const week of bowler.weeks) {
    const wk = Number(week.weekNum);
    if (seenWeeks.has(wk)) {
      issues.push(`${bowler.bowlerName} (ID ${bowler.bowlerId}) has duplicate week ${wk}`);
    }
    seenWeeks.add(wk);

    if (wk < prevWeek) {
      issues.push(`${bowler.bowlerName} (ID ${bowler.bowlerId}) weeks are not sorted`);
    }
    prevWeek = wk;

    validateWeek(bowler, week, issues, notes);
  }
}

function validateCrossWeek(history, issues, notes) {
  const weekTeamMap = new Map();

  for (const bowler of Object.values(history.bowlers)) {
    for (const week of bowler.weeks ?? []) {
      const key = `${week.weekNum}::${week.teamId}`;
      if (!weekTeamMap.has(key)) weekTeamMap.set(key, []);
      weekTeamMap.get(key).push({
        bowlerId: bowler.bowlerId,
        bowlerName: bowler.bowlerName,
        ...week
      });
    }
  }

  for (const [key, rows] of [...weekTeamMap.entries()].sort()) {
    const [weekNum, teamId] = key.split('::');
    const active = rows.filter(r => r.didBowl === true);
    const absent = rows.filter(r => r.didBowl === false);
    const subs = rows.filter(r => r.isSubstitute === true);
    const teamName = rows[0]?.teamName ?? `Team ${teamId}`;

    if (active.length > 4) {
      issues.push(
        `Cross-check week ${weekNum} team ${teamId} (${teamName}): has ${active.length} active bowlers; expected <= 4`
      );
    }

    if (subs.length > 0 && absent.length === 0) {
      notes.push(
        `Cross-check week ${weekNum} team ${teamId} (${teamName}): substitutes exist but no absent rostered bowlers recorded`
      );
    }
  }
}

function main() {
  const fileArg = process.argv[2];
  const historyPath = fileArg ? path.resolve(fileArg) : HISTORY_PATH;

  if (!fs.existsSync(historyPath)) {
    console.error(`Missing file: ${historyPath}`);
    process.exit(1);
  }

  const history = loadJson(historyPath);
  const issues = [];
  const notes = [];

  if (!history || typeof history !== 'object') {
    console.error('Invalid JSON root.');
    process.exit(1);
  }

  validateMeta(history.meta, issues);

  if (!history.bowlers || typeof history.bowlers !== 'object' || Array.isArray(history.bowlers)) {
    issues.push('Top-level bowlers must be an object keyed by BowlerID.');
  } else {
    for (const [bowlerId, bowler] of Object.entries(history.bowlers)) {
      validateBowler(history, bowlerId, bowler, issues, notes);
    }
    validateCrossWeek(history, issues, notes);
  }

  console.log(`Validated: ${historyPath}`);
  console.log(`Issues: ${issues.length}`);
  if (issues.length) {
    console.log('\nIssue details:');
    issues.forEach(i => console.log(`- ${i}`));
  }

  console.log(`\nNotes: ${notes.length}`);
  if (notes.length) {
    console.log('\nNote details:');
    notes.forEach(n => console.log(`- ${n}`));
  }

  process.exit(issues.length ? 2 : 0);
}

main();
