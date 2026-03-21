#!/usr/bin/env node

import fs from 'fs';
import path from 'path';

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isAbsentEntry(b) {
  if (b.didBowl === false) return true;
  if (Array.isArray(b.absent) && b.absent.every(Boolean)) return true;
  return false;
}

function isActiveEntry(b) {
  return b.didBowl === true;
}

function summarizeTeam(teamId, bowlers) {
  const teamName = bowlers[0]?.teamName ?? `Team ${teamId}`;
  const active = bowlers.filter(isActiveEntry);
  const absent = bowlers.filter(isAbsentEntry);
  const subs = bowlers.filter(b => b.isSubstitute === true);
  const regularActive = active.filter(b => b.isSubstitute !== true);

  const issues = [];
  const notes = [];

  if (active.length > 4) {
    issues.push(
      `Team ${teamId} (${teamName}) has ${active.length} active bowlers; expected at most 4 for a 4-person team.`
    );
  }

  if (subs.length > 0) {
    for (const sub of subs) {
      if (sub.substituteForBowlerId == null && !sub.substituteForBowlerName) {
        issues.push(
          `Team ${teamId} (${teamName}) substitute ${sub.bowlerName} is missing substituteForBowlerId/substituteForBowlerName.`
        );
      }
      if (!sub.assignmentMethod) {
        issues.push(
          `Team ${teamId} (${teamName}) substitute ${sub.bowlerName} is missing assignmentMethod.`
        );
      }
    }
  }

  if (absent.length > 0 && active.length === 4 && subs.length === 0) {
    notes.push(
      `Team ${teamId} (${teamName}) has absent rostered bowlers but still exactly 4 active bowlers and no explicit substitute metadata. This may be valid if roster size > 4, but review recommended.`
    );
  }

  if (subs.length > absent.length) {
    notes.push(
      `Team ${teamId} (${teamName}) has ${subs.length} substitutes but only ${absent.length} absent bowlers. Review assignment.`
    );
  }

  if (active.length < 4) {
    notes.push(
      `Team ${teamId} (${teamName}) has only ${active.length} active bowlers recorded.`
    );
  }

  return {
    teamId,
    teamName,
    totalListed: bowlers.length,
    activeCount: active.length,
    absentCount: absent.length,
    substituteCount: subs.length,
    regularActiveCount: regularActive.length,
    issues,
    notes,
    active,
    absent,
    subs
  };
}

function validateWeekFile(filePath) {
  const week = loadJson(filePath);

  if (!week.meta || !Array.isArray(week.bowlers)) {
    throw new Error(`${filePath}: invalid weekly file shape`);
  }

  const teams = new Map();
  for (const bowler of week.bowlers) {
    const key = String(bowler.teamId ?? 'unknown');
    if (!teams.has(key)) teams.set(key, []);
    teams.get(key).push(bowler);
  }

  const teamSummaries = [];
  for (const [teamId, bowlers] of [...teams.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    teamSummaries.push(summarizeTeam(teamId, bowlers));
  }

  const allIssues = teamSummaries.flatMap(t => t.issues);
  const allNotes = teamSummaries.flatMap(t => t.notes);

  console.log(`\n=== ${path.basename(filePath)} ===`);
  console.log(
    `Week ${week.meta.weekNum} | ${week.meta.dateBowled} | bowlers=${week.bowlers.length} | teams=${teamSummaries.length}`
  );

  for (const t of teamSummaries) {
    console.log(
      `- Team ${t.teamId} (${t.teamName}): listed=${t.totalListed}, active=${t.activeCount}, absent=${t.absentCount}, substitutes=${t.substituteCount}`
    );

    if (t.subs.length) {
      for (const s of t.subs) {
        console.log(
          `    sub: ${s.bowlerName} -> ${s.substituteForBowlerName ?? s.substituteForBowlerId ?? 'UNKNOWN'} (${s.assignmentMethod ?? 'no-method'})`
        );
      }
    }
  }

  if (allIssues.length) {
    console.log('\nIssues:');
    for (const issue of allIssues) console.log(`  - ${issue}`);
  } else {
    console.log('\nIssues: none');
  }

  if (allNotes.length) {
    console.log('\nNotes:');
    for (const note of allNotes) console.log(`  - ${note}`);
  } else {
    console.log('\nNotes: none');
  }

  return {
    filePath,
    issues: allIssues,
    notes: allNotes
  };
}

function main() {
  const files = process.argv.slice(2);
  if (!files.length) {
    console.error('Usage: node scripts/validate-weekly-history.js history/weeks/week-007.json [...]');
    process.exit(1);
  }

  let totalIssues = 0;

  for (const file of files) {
    const result = validateWeekFile(file);
    totalIssues += result.issues.length;
  }

  console.log(`\nValidation complete. Total issues: ${totalIssues}`);
  process.exit(totalIssues > 0 ? 2 : 0);
}

main();
