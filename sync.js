#!/usr/bin/env node
/**
 * sync.js — Pinz Bowling League data sync
 *
 * Hybrid standings strategy:
 *   1. API  → Place, TeamNum, TeamName, PtsWon, PtsLost, %Won, YTDWon, ScratchPins,
 *             TeamAvg, HSG, HSS
 *   2. Computed from bowler JSON → hdcpPins (exact), ytdLost (derived)
 *   3. PDF (only when unearned points exist) → patches unearnedPoints + gamesWon
 *   4. Mismatch detector → warns when ptsWon+ptsLost < ptsPerWeek (unearned signal)
 *
 * Usage:
 *   node sync.js                        — sync all new weeks
 *   node sync.js --week 5               — force re-sync specific week
 *   node sync.js --standings-only 5     — re-fetch standings only for week 5
 *   node sync.js --pdf ./standings.pdf  — use specific PDF (implies --standings-only current)
 *
 * Requires Node 18+. No npm deps for primary path.
 * PDF support: npm install pdf-parse
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, 'public', 'data.json')

const LEAGUE_ID = 147337
const SLUG_BASE = 'https://www.leaguesecretary.com/bowling-centers/pinz-bowling-center/bowling-leagues/tuesday-nite-league/league'
const PNG_URL   = `${SLUG_BASE}/standings-png/${LEAGUE_ID}`
const API_URL   = 'https://www.leaguesecretary.com/League/InteractiveStandings_Read'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args          = process.argv.slice(2)
const forceWeek     = args.includes('--week')           ? args[args.indexOf('--week')           + 1] : null
const standingsOnly = args.includes('--standings-only') ? args[args.indexOf('--standings-only') + 1] : null
const forcePdf      = args.includes('--pdf')            ? args[args.indexOf('--pdf')            + 1] : null

// ── HTTP ──────────────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'

async function fetchHtml(url) {
  console.log(`  GET  ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return res.text()
}

async function fetchStandingsApi(year, season, weekNum) {
  const body = new URLSearchParams({
    sort: '', page: '1', pageSize: '50', skip: '0', take: '50',
    leagueId: String(LEAGUE_ID), year: String(year), season: String(season), week: String(weekNum),
  })
  console.log(`  POST ${API_URL}  [wk=${weekNum} yr=${year} s=${season}]`)
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': UA, 'Accept': 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${SLUG_BASE}/standings/${LEAGUE_ID}`,
    },
    body: body.toString(),
  })
  if (!res.ok) throw new Error(`API HTTP ${res.status} ${res.statusText}`)
  const json = await res.json()
  if (!json?.Data || !Array.isArray(json.Data))
    throw new Error(`Unexpected API shape: ${JSON.stringify(json).slice(0, 120)}`)
  return json.Data
}

// ── Bowler / week parsers ─────────────────────────────────────────────────────

function extractBowlers(html) {
  const marker = '"dataSource":[{"TeamID"'
  const start  = html.indexOf(marker)
  if (start === -1) throw new Error('Bowler data marker not found')
  const arrStart = html.indexOf('[', start + '"dataSource":'.length)
  let depth = 0, i = arrStart
  while (i < html.length) {
    if (html[i] === '[') depth++
    else if (html[i] === ']') { depth--; if (depth === 0) break }
    i++
  }
  return JSON.parse(html.slice(arrStart, i + 1))
}

function extractWeeks(html) {
  const idx = html.indexOf('"SelectedID":"')
  if (idx === -1) return []
  let pos = idx
  while (pos > 0 && html[pos] !== '[') pos--
  let depth = 0, i = pos
  while (i < html.length) {
    if (html[i] === '[') depth++
    else if (html[i] === ']') { depth--; if (depth === 0) break }
    i++
  }
  try { return JSON.parse(html.slice(pos, i + 1)) } catch { return [] }
}

// ── Computed fields ───────────────────────────────────────────────────────────

/**
 * Compute team HDCP pins from bowler JSON.
 *   bowler hdcpPins = TotalPins (scratch) + HandicapAfterBowling × TotalGames
 *   team hdcpPins   = sum of all active bowlers on that team
 */
function computeHdcpPins(bowlers) {
  const map = {}
  for (const b of bowlers) {
    if (!b.TeamName || b.BowlerStatus !== 'R') continue
    const pins = (b.TotalPins ?? 0) + (b.HandicapAfterBowling ?? 0) * (b.TotalGames ?? 0)
    map[b.TeamName] = (map[b.TeamName] ?? 0) + pins
  }
  return map  // { teamName → hdcpPins }
}

// Each week a team can win a maximum of 4 points (league rule — constant).
// ytdTotal = weekNum × 4  (e.g. after week 3: max possible = 12)
const PTS_PER_WEEK = 4

/**
 * Compute ytdLost from what the API gives us.
 *   ytdLost = (weekNum × ptsPerWeek) − ytdWon
 * This is exact when unearnedPoints = 0.
 * When unearned points exist the result may be slightly off — the PDF patch
 * will correct it for those weeks.
 */
function computeYtdLost(standings, weekNum, ptsPerWeek) {
  const map = {}
  for (const t of standings) {
    if (t.teamNum === 16) { map[t.teamNum] = 0; continue }
    map[t.teamNum] = Math.max(0, (weekNum * ptsPerWeek) - (t.ytdWon ?? 0))
  }
  return map  // { teamNum → ytdLost }
}

/**
 * Report teams with computed unearned points (informational — no action needed,
 * we compute it automatically from PTS_PER_WEEK - ptsWon - ptsLost).
 */
function detectUnearnedMismatches(standings) {
  const warnings = []
  for (const t of standings) {
    if (t.teamNum === 16) continue
    if (t.unearnedPoints > 0) {
      warnings.push(`    ℹ️  ${t.teamName}: ${t.unearnedPoints} unearned pt(s) this week (won ${t.pointsWon} + lost ${t.pointsLost} = ${t.pointsWon + t.pointsLost} of ${PTS_PER_WEEK})`)
    }
  }
  return warnings
}

/**
 * Enrich API standings with computed hdcpPins + ytdLost.
 * unearnedPoints and gamesWon stay at 0 until PDF patches them.
 */
function enrichStandings(apiStandings, bowlers, weekNum) {
  const hdcpMap    = computeHdcpPins(bowlers)
  const ytdLostMap = computeYtdLost(apiStandings, weekNum, PTS_PER_WEEK)

  return {
    standings: apiStandings.map(t => ({
      ...t,
      hdcpPins:       Math.round(hdcpMap[t.teamName] ?? t.hdcpPins ?? 0),
      ytdLost:        ytdLostMap[t.teamNum] ?? t.ytdLost ?? 0,
      unearnedPoints: t.teamNum === 16 ? 0
                        : Math.max(0, (parseInt(weekNum) * PTS_PER_WEEK) - (t.pointsWon ?? 0) - (t.pointsLost ?? 0)),
      gamesWon:       t.gamesWon ?? 0,   // still not in API — PDF patch if needed
    })),
    ptsPerWeek: PTS_PER_WEEK,
  }
}

// ── API → internal schema ─────────────────────────────────────────────────────

function mapApiStandings(rows) {
  return rows.map(r => ({
    place:             r.Place,
    teamNum:           r.TeamNum,
    teamName:          r.TeamName,
    pctWon:            Math.round((r.PercentWinLoss ?? 0) * 1000) / 10,  // 0.9375 → 93.8
    pointsWon:         r.PointsWonSplit   ?? 0,
    pointsLost:        r.PointsLostSplit  ?? 0,
    unearnedPoints:    0,   // not in API — computed/patched later
    ytdWon:            r.PointsWonYTD     ?? 0,
    ytdLost:           0,   // not in API — computed below
    gamesWon:          0,   // not in API — PDF patch if needed
    teamAverage:       r.AverageAfterBowling ?? 0,
    scratchPins:       r.TotalPinsSplit   ?? 0,
    hdcpPins:          0,   // not in API — computed from bowler JSON below
    highScratchGame:   r.HighScratchGame  ?? 0,
    highScratchSeries: r.HighScratchSeries ?? 0,
  }))
}

// ── PDF helpers ───────────────────────────────────────────────────────────────

async function tryLoadPdfParse() {
  try { const m = await import('pdf-parse/lib/pdf-parse.js'); return m.default ?? m }
  catch { try { const m = await import('pdf-parse'); return m.default ?? m } catch { return null } }
}

function findLocalPdf() {
  if (forcePdf) {
    if (existsSync(forcePdf)) return forcePdf
    console.warn(`  ⚠️  --pdf not found: ${forcePdf}`)
    return null
  }
  const candidates = ['standings.pdf']
  try {
    for (const f of readdirSync(__dirname)) {
      if (/^(standings|week|wk).*\.pdf$/i.test(f) && !candidates.includes(f)) candidates.push(f)
    }
  } catch { /**/ }
  for (const name of candidates) {
    const full = join(__dirname, name)
    if (existsSync(full)) { console.log(`  Found local PDF: ${name}`); return full }
  }
  return null
}

/**
 * Parse PDF standings rows.
 * Returns a map: teamNum → { unearnedPoints, gamesWon, ytdLost, ... full row }
 * so we can surgically patch only the fields the API is missing.
 *
 * PDF column order (13 cols total, 10 trailing numerics):
 *   place teamNum TeamName  pctWon ptW ptL unearned ytd% ytdW ytdL gamesW scrPins hdcpPins
 */
async function parsePdfStandings(pdfPath) {
  const pdfParse = await tryLoadPdfParse()
  if (!pdfParse) {
    console.warn('  ⚠️  pdf-parse not installed — run: npm install pdf-parse')
    return null
  }
  try {
    const data  = await pdfParse(readFileSync(pdfPath))
    const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean)
    const rows  = lines.filter(l => /^\d{1,2}\s+\d{1,2}\s+\S/.test(l))
    if (rows.length < 4) { console.warn(`  ⚠️  PDF: only ${rows.length} rows found`); return null }

    const map = {}
    for (const row of rows) {
      const tokens = row.replace(/\t+/g, ' ').replace(/ {2,}/g, ' ').trim().split(' ')
      if (tokens.length < 13) continue
      const place   = parseInt(tokens[0], 10)
      const teamNum = parseInt(tokens[1], 10)
      if (isNaN(place) || isNaN(teamNum) || place < 1 || place > 20) continue
      const tail     = tokens.slice(-10)
      const teamName = tokens.slice(2, tokens.length - 10).join(' ').trim()
      if (!teamName) continue
      const nums = tail.map(t => parseFloat(t.replace(/,/g, '')))
      if (nums.some(isNaN)) continue
      map[teamNum] = {
        place, teamNum, teamName,
        pctWon:         nums[0], pointsWon:      nums[1], pointsLost:  nums[2],
        unearnedPoints: nums[3], ytdPctWon:      nums[4], ytdWon:      nums[5],
        ytdLost:        nums[6], gamesWon:        nums[7], scratchPins: nums[8],
        hdcpPins:       nums[9],
      }
    }
    const count = Object.keys(map).length
    if (count < 4) { console.warn(`  ⚠️  PDF parsed but only ${count} valid rows`); return null }
    console.log(`  ✓ PDF parsed (${count} teams)`)
    return map
  } catch (err) {
    console.warn(`  ⚠️  PDF error: ${err.message}`)
    return null
  }
}

/**
 * Patch standings with PDF data.
 * PDF is now only needed for gamesWon and ytdLost cross-check.
 * unearnedPoints is fully computed from PTS_PER_WEEK math.
 */
function patchWithPdf(standings, pdfMap) {
  return standings.map(t => {
    const pdf = pdfMap[t.teamNum]
    if (!pdf) return t
    return { ...t, gamesWon: pdf.gamesWon, ytdLost: pdf.ytdLost }
  })
}

// ── Standings orchestrator ────────────────────────────────────────────────────

async function buildStandings(year, season, weekNum, bowlers) {
  let apiRows = null

  // Step 1: try the API
  try {
    apiRows = await fetchStandingsApi(year, season, weekNum)
    if (!apiRows.length) {
      console.log('  API returned 0 rows (likely requires auth session)')
      apiRows = null
    }
  } catch (err) {
    console.log(`  API failed: ${err.message}`)
  }

  if (!apiRows) return null   // nothing to work with

  // Step 2: map + compute
  let standings    = mapApiStandings(apiRows)
  const { standings: enriched, ptsPerWeek } = enrichStandings(standings, bowlers, parseInt(weekNum))
  standings = enriched

  // Step 3: report any computed unearned points (informational)
  const warnings = detectUnearnedMismatches(standings)
  if (warnings.length) {
    console.log(`  ℹ️  Unearned points computed for ${warnings.length} team(s):`)
    warnings.forEach(w => console.log(w))
  }

  // Step 4: PDF patch (only needed for gamesWon now — everything else is computed)
  const pdfPath = findLocalPdf()
  if (pdfPath) {
    const pdfMap = await parsePdfStandings(pdfPath)
    if (pdfMap) {
      standings = patchWithPdf(standings, pdfMap)
      console.log(`  ✓ Patched gamesWon + ytdLost from PDF`)
      return { standings, source: 'api+computed+pdf' }
    }
  }

  return { standings, source: 'api+computed' }
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function loadExisting() {
  if (existsSync(DATA_PATH)) {
    try { return JSON.parse(readFileSync(DATA_PATH, 'utf8')) } catch {}
  }
  return {
    meta: {
      leagueId: LEAGUE_ID, leagueName: 'Tuesday Nite League',
      center: 'Pinz Bowling Center', centerAddress: '12655 Ventura Blvd, Studio City, CA',
      phone: '818-769-7600', lastSynced: null, currentWeek: 0, season: '',
    },
    weeks: {},
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎳  Pinz Bowling League Sync\n')
  const db = loadExisting()

  console.log('Fetching standings page to discover weeks…')
  const latestHtml     = await fetchHtml(PNG_URL)
  const availableWeeks = extractWeeks(latestHtml)

  if (!availableWeeks.length) { console.warn('⚠️  Could not parse week selector'); return }

  const seasonMatch = availableWeeks[0].SelectedDesc.match(/(Spring|Fall|Summer|Winter)\s+(\d{4})/)
  const season      = seasonMatch ? `${seasonMatch[1]} ${seasonMatch[2]}` : 'Current Season'
  const currentWeek = availableWeeks[0].WeekNum

  console.log(`Found ${availableWeeks.length} week(s): ${availableWeeks.map(w => w.SelectedDesc).join(' | ')}\n`)

  for (const [idx, wk] of availableWeeks.entries()) {
    const key              = String(wk.WeekNum)
    const isCurrentWeek    = idx === 0
    const cached           = !!db.weeks[key]
    const forceThis        = forceWeek === key
    const soThis           = standingsOnly === key
    const missingStandings = !db.weeks[key]?.standings?.length
    const missingBowlers   = !db.weeks[key]?.bowlers?.length

    const skipAll           = cached && !forceThis && !soThis && !missingStandings && !missingBowlers
    const standingsOnlyMode = soThis && !forceThis

    if (skipAll) { console.log(`  Week ${key} already cached (bowlers ✓ standings ✓) — skipping`); continue }
    if (cached && missingStandings && !forceThis) console.log(`  Week ${key} — standings missing — retrying…`)
    if (forceThis) console.log(`  Week ${key} — force re-sync`)

    const [weekNum, year, seasonCode] = wk.SelectedID.split('|')
    const weekPngUrl = `${PNG_URL}/${year}/${seasonCode}/${weekNum}`

    try {
      // ── Bowlers ───────────────────────────────────────────────────────────
      // Bowler JSON only exists on the current-week main page (LeagueSecretary
      // embeds it for the subscriber dropdown). Past week URLs serve images only.
      let active = db.weeks[key]?.bowlers ?? []
      if (!standingsOnlyMode) {
        if (isCurrentWeek) {
          const bowlers = extractBowlers(latestHtml)   // reuse — already fetched
          active = bowlers.filter(b => b.BowlerStatus === 'R')
          console.log(`  ✓ Week ${weekNum}: ${active.length} active bowlers`)
        } else if (forceThis) {
          try {
            const html    = await fetchHtml(weekPngUrl)
            const bowlers = extractBowlers(html)
            active = bowlers.filter(b => b.BowlerStatus === 'R')
            console.log(`  ✓ Week ${weekNum}: ${active.length} active bowlers`)
          } catch {
            console.log(`  ℹ️  Week ${weekNum}: past-week bowler JSON unavailable — keeping cached`)
          }
        } else {
          console.log(active.length
            ? `  ✓ Week ${weekNum}: ${active.length} bowlers (cached)`
            : `  ℹ️  Week ${weekNum}: no bowler snapshot (normal for past weeks)`)
        }
      }

      // ── Standings ─────────────────────────────────────────────────────────
      console.log(`  Building standings for week ${weekNum}…`)
      const result   = await buildStandings(year, seasonCode, weekNum, active)
      const standings    = result?.standings ?? db.weeks[key]?.standings ?? []
      const standingsSrc = result?.source    ?? (standings.length > 0 ? 'cached' : 'none')

      if (!standings.length) {
        console.log(`  ⚠️  No standings for week ${weekNum}`)
        console.log(`     API may require auth — drop standings.pdf and re-run: node sync.js --standings-only ${weekNum}`)
      }

      db.weeks[key] = {
        ...(db.weeks[key] ?? {}),
        weekNum:     wk.WeekNum,
        dateBowled:  wk.DateBowled?.split('T')[0] ?? '',
        description: wk.SelectedDesc,
        bowlers:     active,
        standings,
        standingsSrc,
      }

      await new Promise(r => setTimeout(r, 1000))
    } catch (err) {
      console.error(`  ✗ Week ${weekNum}: ${err.message}`)
    }
  }

  db.meta = { ...db.meta, lastSynced: new Date().toISOString().split('T')[0], currentWeek, season }
  writeFileSync(DATA_PATH, JSON.stringify(db, null, 2))

  const weekKeys = Object.keys(db.weeks).sort((a, b) => Number(a) - Number(b))
  console.log(`\n✅  Saved → public/data.json`)
  console.log(`    Season : ${season}`)
  console.log(`    Weeks  : ${weekKeys.join(', ')}`)
  console.log()
  for (const k of weekKeys) {
    const w   = db.weeks[k]
    const cnt = w.standings?.length ?? 0
    const src = w.standingsSrc ?? 'none'
    const bow = w.bowlers?.length ?? 0
    const hasUnearned = w.standings?.some(t => t.unearnedPoints > 0)
    const unearnedTag = hasUnearned ? ' [unearned ✓]' : ''
    console.log(`    Wk ${k.padEnd(2)}  bowlers: ${bow}  standings: ${cnt > 0 ? `✓ ${cnt} [${src}]${unearnedTag}` : '✗ missing'}`)
  }
  console.log()
  console.log(`Next:  npm run push   (or: git add public/data.json && git commit -m "Week ${currentWeek}" && git push)\n`)
}

main().catch(err => {
  console.error('\n❌ Sync failed:', err.message)
  process.exit(1)
})
