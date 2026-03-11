#!/usr/bin/env node
/**
 * tues-nite data validator
 * Run from repo root: node test-data.js [path/to/data.json]
 *
 * Checks:
 *   1.  Schema          — required fields on every bowler/standings record
 *   2.  Averages        — TotalPins / TotalGames ≈ Average (±1); API weeks only
 *                         PDF-sourced weeks skipped: Average = prior-season entering avg
 *                         Subs skipped: Average is their home-league average
 *   3.  Improvement     — Average - EnteringAverage plausible (warn if |Δ| > 50)
 *   4.  Position        — known week-5 subs have BowlerPosition ≥ 5
 *   5.  Roster size     — each active team has 4 roster bowlers (pos 1–4) in week 5
 *   6.  Standings       — pointsWon ≈ pointsLost per week (API weeks only)
 *   7.  Team 16         — F-ING 10 PIN first appears in standings at week 5
 *   8.  Recap patch     — if _recapPatched, bowlers have valid _games / _absent arrays
 *   9.  Game scores     — individual game scores are plausible (50–300)
 *   10. Absent flags    — absent bowlers have _games but reduced TotalGames
 *   11. Missing bowlers — Bernard Badion present in week 5 if recap was applied
 *   12. Trevor Reed     — correctly marked absent all 3 games (week 5)
 */

import { readFileSync } from 'fs'
import path from 'path'

const dataPath = process.argv[2] ?? path.resolve('public/data.json')
const raw = readFileSync(dataPath, 'utf8')
const db = JSON.parse(raw)

let passed = 0
let failed = 0
let warned = 0

function pass(msg)  { console.log(`  ✅  ${msg}`);  passed++ }
function fail(msg)  { console.error(`  ❌  ${msg}`); failed++ }
function warn(msg)  { console.warn(`  ⚠️   ${msg}`);  warned++ }
function section(t) { console.log(`\n── ${t} ──`) }
function info(msg)  { console.log(`  ℹ️   ${msg}`) }

function isPdfWeek(w) { return String(w.standingsSrc ?? '').startsWith('pdf') }

// ─── 1. Meta ─────────────────────────────────────────────────────────────────
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
  const recapTag = w._recapPatched ? ' [recap ✓]' : ''
  if (!w.bowlers?.length) fail(`Week ${n}: no bowlers`)
  else pass(`Week ${n}: ${w.bowlers.length} bowlers, ${w.standings?.length ?? 0} standings (src: ${w.standingsSrc ?? 'unknown'})${recapTag}`)
}

// ─── 3. Bowler schema ────────────────────────────────────────────────────────
section('Bowler schema (week 5)')
// BowlerID is optional for recap-only bowlers added from PDF
const BOWLER_REQ = ['BowlerName', 'TeamID', 'TeamName', 'Average', 'TotalGames', 'TotalPins']
const w5 = db.weeks[5]
if (!w5) {
  fail('Week 5 missing — skipping bowler schema checks')
} else {
  let schemaFails = 0
  for (const b of w5.bowlers) {
    for (const f of BOWLER_REQ) {
      if (b[f] == null) {
        fail(`Week 5 ${b.BowlerName ?? '(unnamed)'}: missing ${f}`)
        schemaFails++
      }
    }
    if (b.BowlerID == null && !b._recapOnly) {
      warn(`Week 5 ${b.BowlerName}: BowlerID is null but not flagged _recapOnly`)
    }
  }
  if (schemaFails === 0) pass(`Week 5 bowler schema OK (${w5.bowlers.length} bowlers checked)`)
}

// ─── 4. Average math (API weeks only, skip subs) ─────────────────────────────
section('Average = TotalPins / TotalGames (API-sourced weeks, non-subs)')
const KNOWN_SUB_IDS = new Set([74, 72, 67, 70, 60])
let avgErrors = 0, avgSkipped = 0
for (const [wNum, w] of Object.entries(db.weeks)) {
  if (isPdfWeek(w)) { avgSkipped++; continue }
  for (const b of w.bowlers) {
    if (!b.TotalGames || b.TotalGames === 0) continue
    if (KNOWN_SUB_IDS.has(b.BowlerID)) continue
    if (b._recapOnly) continue  // recap-only bowlers: average computed from limited games this week only
    const computed = Math.round(b.TotalPins / b.TotalGames)
    const delta    = Math.abs(computed - b.Average)
    if (delta > 1) {
      fail(`Week ${wNum} ${b.BowlerName}: Average=${b.Average} but ${b.TotalPins}÷${b.TotalGames}=${computed} (Δ${delta})`)
      avgErrors++
    }
  }
}
if (avgSkipped > 0) warn(`Skipped ${avgSkipped} PDF-sourced week(s) — Average is entering avg in those weeks`)
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

// ─── 6. Position classification — week 5 known subs ──────────────────────────
section('BowlerPosition — week 5 known subs')
const KNOWN_SUB_NAMES = { 74: 'Abaoag, Reigh', 72: 'Beckwith, Rick', 67: 'Costina, Sara', 70: 'Davis, Eric', 60: 'Tsutsui, Kiyo' }
if (!w5) {
  fail('Week 5 missing — skipping position checks')
} else {
  for (const id of KNOWN_SUB_IDS) {
    const b = w5.bowlers.find(x => x.BowlerID === id)
    if (!b)                               fail(`Known sub BowlerID ${id} (${KNOWN_SUB_NAMES[id]}) not found in week 5`)
    else if ((b.BowlerPosition ?? 0) < 5) fail(`${b.BowlerName}: BowlerPosition=${b.BowlerPosition} but expected ≥5 (sub)`)
    else                                  pass(`${b.BowlerName}: BowlerPosition=${b.BowlerPosition} ✓ sub`)
  }

  const rosterBowlers = w5.bowlers.filter(b =>
    !KNOWN_SUB_IDS.has(b.BowlerID) && b.TeamName !== 'BYE' && b.TeamID && b.TeamID !== 0 && !b._recapOnly
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

// ─── 7. Team roster counts (week 5) ──────────────────────────────────────────
section('Team roster counts (week 5, pos 1–4)')
if (w5) {
  const teamMap = {}
  for (const b of w5.bowlers) {
    if (!b.TeamID || b.TeamID === 0 || b.TeamName === 'BYE') continue
    if (!teamMap[b.TeamID]) teamMap[b.TeamID] = { name: b.TeamName, roster: 0, subs: 0, unknown: 0 }
    const p = b.BowlerPosition ?? 0
    if (p >= 1 && p <= 4)  teamMap[b.TeamID].roster++
    else if (p >= 5)        teamMap[b.TeamID].subs++
    else                    teamMap[b.TeamID].unknown++
  }
  for (const [tid, t] of Object.entries(teamMap)) {
    if (t.roster === 0)    fail(`Team ${tid} (${t.name}): 0 roster bowlers — handicap calc broken`)
    else if (t.roster < 4) warn(`Team ${tid} (${t.name}): only ${t.roster} roster bowler(s) (< 4)`)
    else                   pass(`Team ${tid} (${t.name}): ${t.roster} roster + ${t.subs} sub(s)`)
  }
}

// ─── 8. Standings sanity (API weeks only) ────────────────────────────────────
section('Standings sanity (API-sourced weeks)')
for (const [wNum, w] of Object.entries(db.weeks)) {
  const st = w.standings
  if (!st?.length) { warn(`Week ${wNum}: no standings`); continue }

  if (isPdfWeek(w)) {
    warn(`Week ${wNum}: PDF standings — skipping balance check`)
    continue
  }

  const totalWon  = st.reduce((s, r) => s + (r.pointsWon  ?? 0), 0)
  const totalLost = st.reduce((s, r) => s + (r.pointsLost ?? 0), 0)
  if (Math.abs(totalWon - totalLost) > 4) {
    warn(`Week ${wNum}: pointsWon (${totalWon}) ≠ pointsLost (${totalLost}) — may include BYE/unearned points`)
  } else {
    pass(`Week ${wNum}: pointsWon/Lost balanced (${totalWon} / ${totalLost})`)
  }

  const badPct = st.filter(r => (r.pctWon ?? 0) > 100)
  if (badPct.length) fail(`Week ${wNum}: ${badPct.length} team(s) with pctWon > 100`)
  else               pass(`Week ${wNum}: all pctWon values ≤ 100`)
}

// ─── 9. Team 16 join week (standings only) ────────────────────────────────────
section('Team 16 (F-ING 10 PIN) — standings join week')
let team16FirstWeek = null
for (const n of weekNums) {
  const w = db.weeks[n]
  const inStandings = w.standings?.some(r =>
    (r.teamNum === 16 || r.teamNum === '16') && r.teamName !== 'BYE' && r.teamName != null && r.teamName !== ''
  )
  if (inStandings && team16FirstWeek === null) team16FirstWeek = n
}
if      (team16FirstWeek === 5)    pass('Team 16 first appears in standings at week 5 as expected')
else if (team16FirstWeek !== null) warn(`Team 16 first appears in standings at week ${team16FirstWeek} (expected 5)`)
else                               warn('Team 16 not found in any standings row — may not be in data yet')

// ─── 10. Recap patch checks ───────────────────────────────────────────────────
section('Recap PDF patch (_recapPatched weeks)')

const recapWeeks = weekNums.filter(n => db.weeks[n]._recapPatched)

if (recapWeeks.length === 0) {
  info('No weeks have been recap-patched yet — skipping recap checks')
  info('To populate: put recap PDF in pdfs/wk05-YYYY-MM-DD-recap.pdf and run node sync.js')
} else {
  pass(`${recapWeeks.length} recap-patched week(s): ${recapWeeks.join(', ')}`)

  for (const n of recapWeeks) {
    const w = db.weeks[n]
    const recapBowlers = w.bowlers.filter(b => b._recapMatched)
    info(`Week ${n}: ${recapBowlers.length} recap-matched bowlers`)

    // ── 10a. _games and _absent array structure ───────────────────────────────
    let structFail = 0
    for (const b of recapBowlers) {
      if (!Array.isArray(b._games) || b._games.length !== 3) {
        fail(`Week ${n} ${b.BowlerName}: _games must be a 3-element array, got ${JSON.stringify(b._games)}`)
        structFail++
      }
      if (!Array.isArray(b._absent) || b._absent.length !== 3) {
        fail(`Week ${n} ${b.BowlerName}: _absent must be a 3-element array, got ${JSON.stringify(b._absent)}`)
        structFail++
      }
    }
    if (structFail === 0) pass(`Week ${n}: all ${recapBowlers.length} recap bowlers have valid _games/_absent arrays`)

    // ── 10b. Game score range (50–300 or null) ────────────────────────────────
    let scoreFail = 0
    for (const b of recapBowlers) {
      if (!Array.isArray(b._games)) continue
      for (let gi = 0; gi < 3; gi++) {
        const g = b._games[gi]
        if (g === null) continue  // null = unreadable OCR, acceptable
        if (typeof g !== 'number' || g < 50 || g > 300) {
          fail(`Week ${n} ${b.BowlerName}: game ${gi + 1} = ${g} (expected 50–300 or null)`)
          scoreFail++
        }
      }
    }
    if (scoreFail === 0) pass(`Week ${n}: all game scores in valid range (50–300)`)

    // ── 10c. _scratchSeries consistency ──────────────────────────────────────
    let seriesFail = 0
    for (const b of recapBowlers) {
      if (!Array.isArray(b._games)) continue
      const expected = b._games.reduce((s, g, i) => (g !== null && !b._absent?.[i]) ? s + g : s, 0)
      if (b._scratchSeries !== expected) {
        fail(`Week ${n} ${b.BowlerName}: _scratchSeries=${b._scratchSeries} but non-absent game total=${expected}`)
        seriesFail++
      }
    }
    if (seriesFail === 0) pass(`Week ${n}: all _scratchSeries values match game totals`)

    // ── 10d. Absent bowler TotalGames ─────────────────────────────────────────
    const absentBowlers = recapBowlers.filter(b => b._absent?.some(Boolean))
    if (absentBowlers.length === 0) {
      info(`Week ${n}: no absent bowlers this week`)
    } else {
      info(`Week ${n}: ${absentBowlers.length} bowler(s) with at least one absent game`)
      for (const b of absentBowlers) {
        const presentCount = b._absent.filter(a => !a).length
        if (b.TotalGames !== presentCount) {
          warn(`Week ${n} ${b.BowlerName}: ${b._absent.filter(Boolean).length} absent — TotalGames=${b.TotalGames} (expected ${presentCount})`)
        } else {
          pass(`Week ${n} ${b.BowlerName}: TotalGames=${b.TotalGames} matches present games`)
        }
      }
    }

    // ── 10e. EnteringAverage plausibility ─────────────────────────────────────
    let eavgFail = 0
    for (const b of recapBowlers) {
      if (b.EnteringAverage == null) {
        warn(`Week ${n} ${b.BowlerName}: EnteringAverage is null after recap patch`)
        eavgFail++
      } else if (b.EnteringAverage < 50 || b.EnteringAverage > 300) {
        fail(`Week ${n} ${b.BowlerName}: EnteringAverage=${b.EnteringAverage} out of range (50–300)`)
        eavgFail++
      }
    }
    if (eavgFail === 0) pass(`Week ${n}: all ${recapBowlers.length} recap bowlers have plausible EnteringAverage`)

    // ── 10f. Coverage — how many teams got recap data ─────────────────────────
    const teamsWithRecap = new Set(recapBowlers.map(b => b.TeamID))
    const totalTeams     = new Set(w.bowlers.filter(b => b.TeamID && b.TeamName !== 'BYE').map(b => b.TeamID)).size
    if (teamsWithRecap.size < Math.floor(totalTeams * 0.75)) {
      warn(`Week ${n}: recap data for only ${teamsWithRecap.size}/${totalTeams} teams — OCR may have missed some lanes`)
    } else {
      pass(`Week ${n}: recap coverage ${teamsWithRecap.size}/${totalTeams} teams`)
    }
  }
}

// ─── 11. Bernard Badion (Team 15, week 5) ─────────────────────────────────────
section('Known missing bowler: Badion, Bernard (Team 15, week 5)')
if (!w5) {
  fail('Week 5 missing — skipping Badion check')
} else {
  const badion = w5.bowlers.find(b =>
    b.BowlerName?.toLowerCase().includes('badion') ||
    (b.BowlerName?.toLowerCase().includes('bernard') && b.TeamNum === 15)
  )

  if (!badion) {
    if (w5._recapPatched) fail('Bernard Badion not found in week 5 despite recap patch being applied')
    else                   warn('Bernard Badion absent from week 5 — expected until recap PDF is applied')
  } else {
    pass(`Bernard Badion found: "${badion.BowlerName}" (Team ${badion.TeamNum})`)

    if (badion._recapOnly) pass('Correctly flagged _recapOnly=true (sourced from recap PDF, not API)')
    else                   info(`Badion has BowlerID=${badion.BowlerID} — came from API`)

    if (Array.isArray(badion._games)) {
      const display = badion._games.map((g, i) => g === null ? '?' : badion._absent?.[i] ? `a${g}` : String(g)).join(' ')
      pass(`Badion has game scores: [${display}]`)
      // Verify against recap PDF: 157 131 111 = 399 scratch
      if (badion._games[0] === 157 && badion._games[1] === 131 && badion._games[2] === 111) {
        pass('Badion scores match known recap values [157 131 111] = 399 scratch ✓')
      } else {
        warn(`Badion scores [${badion._games.join(' ')}] differ from expected [157 131 111] — OCR variance`)
      }
    } else if (w5._recapPatched) {
      warn('Badion found but missing _games array — recap patch may not have applied correctly')
    }
  }
}

// ─── 12. Trevor Reed absent (Team Won, week 5) ────────────────────────────────
section('Known absent bowler: Reed, Trevor (Team Won, week 5)')
if (!w5) {
  fail('Week 5 missing — skipping Trevor Reed check')
} else {
  const reed = w5.bowlers.find(b => b.BowlerName?.toLowerCase().includes('reed'))

  if (!reed) {
    warn('Trevor Reed not found in week 5')
  } else if (!w5._recapPatched) {
    info(`Trevor Reed present (BowlerPosition=${reed.BowlerPosition}) — absent flags require recap patch`)
  } else if (!Array.isArray(reed._absent)) {
    warn('Trevor Reed has no _absent array after recap patch')
  } else {
    const absentCount = reed._absent.filter(Boolean).length
    if (absentCount === 3) {
      pass('Trevor Reed correctly marked absent all 3 games')
      if (reed._games?.every(g => g === 120)) {
        pass('Absent scores are all 120 (entered average) ✓')
      } else if (reed._games) {
        info(`Absent scores: [${reed._games.join(' ')}] (entering avg may differ from 120)`)
      }
    } else if (absentCount > 0) {
      warn(`Trevor Reed: ${absentCount}/3 games absent — expected all 3 (a120 a120 a120 in recap)`)
    } else {
      fail('Trevor Reed: _absent=[false,false,false] — should be absent all 3 games')
    }
  }
}

// ─── Summary ─────────────────────────────────────────────────────────────────
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
