#!/usr/bin/env node
/**
 * tues-nite data validator
 * Run from repo root: node test-data.js [path/to/data.json]
 *
 * Checks:
 *   1. Schema      — required fields present on every bowler/standings record
 *   2. Averages    — TotalPins / TotalGames ≈ Average (±1); API weeks only
 *                    PDF-sourced weeks (standingsSrc starts with "pdf") are skipped:
 *                    their Average field is the prior-season entering average, not
 *                    derived from current TotalPins/TotalGames.
 *                    Subs are also skipped: their Average is their home-league average.
 *   3. Improvement — Average - EnteringAverage is plausible (warn if |Δ| > 50)
 *   4. Position    — known week-5 subs have BowlerPosition ≥ 5
 *   5. Roster size — each active team has 4 roster bowlers (pos 1–4) in week 5
 *   6. Standings   — pointsWon ≈ pointsLost per week (API weeks only)
 *                    pctWon stored as 0–100; warn if > 100
 *   7. Team 16     — F-ING 10 PIN first appears in standings at week 5
 *                    (bowler check excluded: TeamID=16 bowlers existed earlier as BYE subs)
 */

import { readFileSync } from 'fs'
import path from 'path'

const dataPath = process.argv[2] ?? path.resolve('public/data.json')
const raw = readFileSync(dataPath, 'utf8')
const db = JSON.parse(raw)

let passed = 0
let failed = 0
let warned = 0

function pass(msg)    { console.log(`  ✅  ${msg}`);  passed++ }
function fail(msg)    { console.error(`  ❌  ${msg}`); failed++ }
function warn(msg)    { console.warn(`  ⚠️   ${msg}`);  warned++ }
function section(t)   { console.log(`\n── ${t} ──`) }

function isPdfWeek(w) { return String(w.standingsSrc ?? '').startsWith('pdf') }

// ─── 1. Meta ────────────────────────────────────────────────────────────────
section('Meta')
const REQUIRED_META = ['leagueId', 'leagueName', 'center', 'lastSynced', 'currentWeek', 'season']
for (const f of REQUIRED_META) {
  db.meta?.[f] != null ? pass(`meta.${f} present`) : fail(`meta.${f} MISSING`)
}

// ─── 2. Week presence ────────────────────────────────────────────────────────
section('Week presence')
const weekNums = Object.keys(db.weeks ?? {}).map(Number).sort((a, b) => a - b)
pass(`${weekNums.length} weeks found: ${weekNums.join(', ')}`)
for (const n of weekNums) {
  const w = db.weeks[n]
  if (!w.bowlers?.length) fail(`Week ${n}: no bowlers`)
  else pass(`Week ${n}: ${w.bowlers.length} bowlers, ${w.standings?.length ?? 0} standings rows (src: ${w.standingsSrc ?? 'unknown'})`)
}

// ─── 3. Bowler schema ────────────────────────────────────────────────────────
section('Bowler schema (week 5)')
const BOWLER_REQ = ['BowlerID', 'BowlerName', 'TeamID', 'TeamName', 'Average', 'TotalGames', 'TotalPins']
const w5 = db.weeks[5]
if (!w5) {
  fail('Week 5 missing — skipping bowler schema checks')
} else {
  let schemaFails = 0
  for (const b of w5.bowlers) {
    for (const f of BOWLER_REQ) {
      if (b[f] == null) { fail(`Week 5 ${b.BowlerName ?? b.BowlerID}: missing ${f}`); schemaFails++ }
    }
  }
  if (schemaFails === 0) pass(`Week 5 bowler schema OK (${w5.bowlers.length} bowlers checked)`)
}

// ─── 4. Average math (API weeks only, skip subs) ────────────────────────────
section('Average = TotalPins / TotalGames (API-sourced weeks, non-subs)')
const KNOWN_SUB_IDS = new Set([74, 72, 67, 70, 60])
let avgErrors = 0
let avgSkipped = 0
for (const [wNum, w] of Object.entries(db.weeks)) {
  if (isPdfWeek(w)) {
    avgSkipped++
    continue  // PDF weeks: Average = prior-season entering avg, not pins/games derived
  }
  for (const b of w.bowlers) {
    if (!b.TotalGames || b.TotalGames === 0) continue
    if (KNOWN_SUB_IDS.has(b.BowlerID)) continue  // subs carry home-league average
    const computed = Math.round(b.TotalPins / b.TotalGames)
    const delta = Math.abs(computed - b.Average)
    if (delta > 1) {
      fail(`Week ${wNum} ${b.BowlerName}: Average=${b.Average} but ${b.TotalPins}÷${b.TotalGames}=${computed} (Δ${delta})`)
      avgErrors++
    }
  }
}
if (avgSkipped > 0) warn(`Skipped ${avgSkipped} PDF-sourced week(s) — Average field is entering avg in those weeks`)
if (avgErrors === 0) pass('All API-week averages check out (±1 rounding tolerance)')

// ─── 5. Improvement sanity (API weeks only) ──────────────────────────────────
section('Improvement sanity (API-sourced weeks)')
let impWarnings = 0
for (const [wNum, w] of Object.entries(db.weeks)) {
  if (isPdfWeek(w)) continue
  for (const b of w.bowlers) {
    if (!b.EnteringAverage) continue
    const imp = b.Average - b.EnteringAverage
    if (Math.abs(imp) > 50) {
      warn(`Week ${wNum} ${b.BowlerName}: improvement ${imp > 0 ? '+' : ''}${imp} (entering=${b.EnteringAverage}, current=${b.Average})`)
      impWarnings++
    }
  }
}
if (impWarnings === 0) pass('All improvement values within ±50 of entering average')

// ─── 6. Position classification — week 5 known subs ─────────────────────────
section('BowlerPosition — week 5 known subs')
const KNOWN_SUB_NAMES = { 74: 'Abaoag, Reigh', 72: 'Beckwith, Rick', 67: 'Costina, Sara', 70: 'Davis, Eric', 60: 'Tsutsui, Kiyo' }
if (!w5) {
  fail('Week 5 missing — skipping position checks')
} else {
  for (const id of KNOWN_SUB_IDS) {
    const b = w5.bowlers.find(x => x.BowlerID === id)
    if (!b) {
      fail(`Known sub BowlerID ${id} (${KNOWN_SUB_NAMES[id]}) not found in week 5`)
    } else if ((b.BowlerPosition ?? 0) < 5) {
      fail(`${b.BowlerName}: BowlerPosition=${b.BowlerPosition} but expected ≥5 (sub)`)
    } else {
      pass(`${b.BowlerName}: BowlerPosition=${b.BowlerPosition} ✓ sub`)
    }
  }

  const rosterBowlers = w5.bowlers.filter(b =>
    !KNOWN_SUB_IDS.has(b.BowlerID) && b.TeamName !== 'BYE' && b.TeamID && b.TeamID !== 0
  )
  const missingPos = rosterBowlers.filter(b => !b.BowlerPosition || b.BowlerPosition === 0)
  if (missingPos.length === 0) {
    pass(`All ${rosterBowlers.length} non-sub week-5 bowlers have BowlerPosition 1–4`)
  } else {
    for (const b of missingPos) {
      warn(`${b.BowlerName} (Team ${b.TeamNum}): BowlerPosition=0 but not a known sub`)
    }
  }
}

// ─── 7. Team roster counts (week 5) ─────────────────────────────────────────
section('Team roster counts (week 5, pos 1–4)')
if (w5) {
  const teamMap = {}
  for (const b of w5.bowlers) {
    if (!b.TeamID || b.TeamID === 0 || b.TeamName === 'BYE') continue
    if (!teamMap[b.TeamID]) teamMap[b.TeamID] = { name: b.TeamName, roster: 0, subs: 0, unknown: 0 }
    const p = b.BowlerPosition ?? 0
    if (p >= 1 && p <= 4) teamMap[b.TeamID].roster++
    else if (p >= 5)       teamMap[b.TeamID].subs++
    else                   teamMap[b.TeamID].unknown++
  }
  for (const [tid, t] of Object.entries(teamMap)) {
    if (t.roster === 0)    fail(`Team ${tid} (${t.name}): 0 roster bowlers — handicap calc broken`)
    else if (t.roster < 4) warn(`Team ${tid} (${t.name}): only ${t.roster} roster bowler(s) (< 4)`)
    else                   pass(`Team ${tid} (${t.name}): ${t.roster} roster + ${t.subs} sub(s)`)
  }
}

// ─── 8. Standings sanity (API weeks only) ────────────────────────────────────
// pctWon is stored as 0–100 (e.g. 75.0), not 0–1
// pointsWon and pointsLost should roughly balance across all teams per week
section('Standings sanity (API-sourced weeks)')
for (const [wNum, w] of Object.entries(db.weeks)) {
  const st = w.standings
  if (!st?.length) { warn(`Week ${wNum}: no standings`); continue }

  if (isPdfWeek(w)) {
    warn(`Week ${wNum}: PDF standings — skipping balance check (OCR values unreliable)`)
    continue
  }

  const totalWon  = st.reduce((s, r) => s + (r.pointsWon  ?? 0), 0)
  const totalLost = st.reduce((s, r) => s + (r.pointsLost ?? 0), 0)
  if (Math.abs(totalWon - totalLost) > 4) {
    warn(`Week ${wNum}: pointsWon (${totalWon}) ≠ pointsLost (${totalLost}) — may include BYE/unearned points`)
  } else {
    pass(`Week ${wNum}: pointsWon/Lost balanced (${totalWon} / ${totalLost})`)
  }

  // pctWon is 0–100, not 0–1
  const badPct = st.filter(r => (r.pctWon ?? 0) > 100)
  if (badPct.length) fail(`Week ${wNum}: ${badPct.length} team(s) with pctWon > 100`)
  else pass(`Week ${wNum}: all pctWon values ≤ 100`)
}

// ─── 9. Team 16 join week (standings only) ────────────────────────────────────
// Bowler check excluded: Chacon/Crockenberg/Gunkel had TeamID=16 in early weeks
// as BYE-team roster entries before the team officially started play.
section('Team 16 (F-ING 10 PIN) — standings join week')
let team16FirstWeek = null
for (const n of weekNums) {
  const w = db.weeks[n]
  const inStandings = w.standings?.some(r =>
    (r.teamNum === 16 || r.teamNum === '16') &&
    r.teamName !== 'BYE' &&
    r.teamName != null &&
    r.teamName !== ''
  )
  if (inStandings && team16FirstWeek === null) {
    team16FirstWeek = n
  }
}
if (team16FirstWeek === 5) {
  pass('Team 16 first appears in standings at week 5 as expected')
} else if (team16FirstWeek !== null) {
  warn(`Team 16 first appears in standings at week ${team16FirstWeek} (expected 5)`)
} else {
  warn('Team 16 not found in any standings row — may not be in data yet')
}

// ─── Summary ────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`)
console.log(`  ${passed} passed  |  ${warned} warnings  |  ${failed} failed`)
if (failed > 0) {
  console.error('\n  Some checks FAILED — review output above.')
  process.exit(1)
} else if (warned > 0) {
  console.warn('\n  All checks passed with warnings.')
} else {
  console.log('\n  All checks passed! 🎳')
}
