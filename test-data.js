#!/usr/bin/env node
/**
 * tues-nite data validator
 * Run from repo root: node test-data.js [path/to/data.json]
 *
 * Checks:
 *   1. Schema — required fields present on every bowler/standings record
 *   2. Averages — TotalPins / TotalGames ≈ Average (within 1, rounding)
 *   3. Improvement — Average - EnteringAverage is plausible (not wildly off)
 *   4. Position classification — pos 1–4 = roster, 5+ = sub, 0 = unknown
 *   5. Sub detection — known week-5 subs are correctly identified
 *   6. Team roster count — each active team has 1–4 roster bowlers (pos 1–4) in week 5
 *   7. Standings sanity — pointsWon + pointsLost roughly constant per week
 *   8. Team 16 join week — F-ING 10 PIN first appears in standings at week 5
 */

import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import path from 'path'

const dataPath = process.argv[2] ?? path.resolve('public/data.json')
const raw = readFileSync(dataPath, 'utf8')
const db = JSON.parse(raw)

let passed = 0
let failed = 0
let warned = 0

function pass(msg) { console.log(`  ✅  ${msg}`); passed++ }
function fail(msg) { console.error(`  ❌  ${msg}`); failed++ }
function warn(msg) { console.warn(`  ⚠️   ${msg}`); warned++ }

function section(title) { console.log(`\n── ${title} ──`) }

// ─── 1. Meta ────────────────────────────────────────────────────────────────
section('Meta')
const requiredMeta = ['leagueId', 'leagueName', 'center', 'lastSynced', 'currentWeek', 'season']
for (const f of requiredMeta) {
  db.meta?.[f] != null ? pass(`meta.${f} present`) : fail(`meta.${f} MISSING`)
}

// ─── 2. Week presence ────────────────────────────────────────────────────────
section('Week presence')
const weekNums = Object.keys(db.weeks ?? {}).map(Number).sort((a, b) => a - b)
pass(`${weekNums.length} weeks found: ${weekNums.join(', ')}`)
for (const n of weekNums) {
  const w = db.weeks[n]
  if (!w.bowlers?.length) fail(`Week ${n}: no bowlers`)
  else pass(`Week ${n}: ${w.bowlers.length} bowlers, ${w.standings?.length ?? 0} standings rows`)
}

// ─── 3. Bowler schema ────────────────────────────────────────────────────────
section('Bowler schema (week 5)')
const BOWLER_REQ = ['BowlerID', 'BowlerName', 'TeamID', 'TeamName', 'Average', 'TotalGames', 'TotalPins']
const w5 = db.weeks[5]
if (!w5) {
  fail('Week 5 missing — skipping bowler schema checks')
} else {
  for (const b of w5.bowlers) {
    for (const f of BOWLER_REQ) {
      if (b[f] == null) fail(`Week 5 bowler ${b.BowlerName ?? b.BowlerID}: missing ${f}`)
    }
  }
  pass(`Week 5 bowler schema OK (${w5.bowlers.length} bowlers checked)`)
}

// ─── 4. Average math ────────────────────────────────────────────────────────
section('Average = TotalPins / TotalGames (all weeks)')
let avgErrors = 0
for (const [wNum, w] of Object.entries(db.weeks)) {
  for (const b of w.bowlers) {
    if (!b.TotalGames || b.TotalGames === 0) continue
    const computed = Math.round(b.TotalPins / b.TotalGames)
    const delta = Math.abs(computed - b.Average)
    if (delta > 1) {
      fail(`Week ${wNum} ${b.BowlerName}: Average=${b.Average} but ${b.TotalPins}/${b.TotalGames}=${computed} (Δ${delta})`)
      avgErrors++
    }
  }
}
if (avgErrors === 0) pass('All averages check out (±1 rounding tolerance)')

// ─── 5. Improvement sanity ──────────────────────────────────────────────────
section('Improvement sanity (all weeks)')
let impWarnings = 0
for (const [wNum, w] of Object.entries(db.weeks)) {
  for (const b of w.bowlers) {
    if (!b.EnteringAverage) continue
    const imp = b.Average - b.EnteringAverage
    if (Math.abs(imp) > 50) {
      warn(`Week ${wNum} ${b.BowlerName}: improvement ${imp > 0 ? '+' : ''}${imp} seems large`)
      impWarnings++
    }
  }
}
if (impWarnings === 0) pass('All improvement values within ±50 of entering average')

// ─── 6. Position classification (week 5 only) ────────────────────────────────
section('BowlerPosition — week 5 known subs')

// These BowlerIDs are confirmed subs from the actual data.json
const KNOWN_SUB_IDS = [74, 72, 67, 70, 60]
const KNOWN_SUB_NAMES = {
  74: 'Abaoag Reigh',
  72: 'Beckwith Rick',
  67: 'Costina Sara',
  70: 'Davis Eric',
  60: 'Tsutsui Kiyo',
}

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

  // All non-sub bowlers in week 5 should have position 1–4
  const rosterBowlers = w5.bowlers.filter(b =>
    !KNOWN_SUB_IDS.includes(b.BowlerID) &&
    b.TeamName !== 'BYE' && b.TeamID && b.TeamID !== 0
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
    if (t.roster === 0) fail(`Team ${tid} (${t.name}): 0 roster bowlers — will break handicap calc`)
    else if (t.roster < 4) warn(`Team ${tid} (${t.name}): only ${t.roster} roster bowlers (< 4)`)
    else pass(`Team ${tid} (${t.name}): ${t.roster} roster + ${t.subs} sub(s)`)
  }
}

// ─── 8. Standings sanity ────────────────────────────────────────────────────
section('Standings sanity')
for (const [wNum, w] of Object.entries(db.weeks)) {
  const st = w.standings
  if (!st?.length) { warn(`Week ${wNum}: no standings`); continue }

  // Sum of pointsWon across all teams should be roughly equal to sum of pointsLost
  const totalWon  = st.reduce((s, r) => s + (r.pointsWon  ?? 0), 0)
  const totalLost = st.reduce((s, r) => s + (r.pointsLost ?? 0), 0)
  if (Math.abs(totalWon - totalLost) > 4) {
    warn(`Week ${wNum}: total pointsWon (${totalWon}) ≠ total pointsLost (${totalLost})`)
  } else {
    pass(`Week ${wNum}: pointsWon/Lost balanced (${totalWon} / ${totalLost})`)
  }

  // No team should have more pctWon than 1.0
  const badPct = st.filter(r => (r.pctWon ?? 0) > 1.0)
  if (badPct.length) fail(`Week ${wNum}: ${badPct.length} team(s) with pctWon > 1.0`)
}

// ─── 9. Team 16 join week ────────────────────────────────────────────────────
section('Team 16 (F-ING 10 PIN) join week')
let team16FirstWeek = null
for (const [wNum, w] of Object.entries(db.weeks)) {
  const inStandings = w.standings?.some(r => r.teamNum === 16 && r.teamName !== 'BYE')
  const inBowlers   = w.bowlers?.some(b => b.TeamID === 16 && b.TeamName !== 'BYE')
  if ((inStandings || inBowlers) && team16FirstWeek === null) {
    team16FirstWeek = Number(wNum)
  }
}
if (team16FirstWeek === 5) {
  pass('Team 16 first appears at week 5 as expected')
} else if (team16FirstWeek !== null) {
  warn(`Team 16 first appears at week ${team16FirstWeek} (expected 5) — check BYE handling`)
} else {
  warn('Team 16 not found in any week — may not be in data yet')
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
