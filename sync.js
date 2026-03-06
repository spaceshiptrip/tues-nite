#!/usr/bin/env node
/**
 * sync.js — Pinz Bowling League data sync
 *
 * Fetches bowler stats + standings automatically from LeagueSecretary.
 *
 * Standings strategy (tried in order):
 *   1. POST /League/InteractiveStandings_Read  (JSON API — best, no PDF needed)
 *   2. HTML <table> on /standings/ page        (fallback)
 *   3. Local PDF named standings.pdf           (last resort — npm install pdf-parse)
 *
 * Usage:
 *   node sync.js                        — sync all new weeks
 *   node sync.js --week 5               — force re-sync specific week (bowlers + standings)
 *   node sync.js --standings-only 5     — re-fetch standings only for a week
 *   node sync.js --pdf ./standings.pdf  — use a specific PDF for standings
 *
 * Requires Node 18+ (native fetch). No npm deps needed for the primary path.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH = join(__dirname, 'public', 'data.json')

const LEAGUE_ID = 147337
const SLUG_BASE = 'https://www.leaguesecretary.com/bowling-centers/pinz-bowling-center/bowling-leagues/tuesday-nite-league/league'
const PNG_URL   = `${SLUG_BASE}/standings-png/${LEAGUE_ID}`   // bowler JSON lives here
const API_URL   = 'https://www.leaguesecretary.com/League/InteractiveStandings_Read'

// ── CLI args ─────────────────────────────────────────────────────────────────

const args          = process.argv.slice(2)
const forceWeek     = args.includes('--week')             ? args[args.indexOf('--week')             + 1] : null
const standingsOnly = args.includes('--standings-only')   ? args[args.indexOf('--standings-only')   + 1] : null
const forcePdf      = args.includes('--pdf')              ? args[args.indexOf('--pdf')              + 1] : null

// ── HTTP helpers ──────────────────────────────────────────────────────────────

const HEADERS_HTML = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml',
}

async function fetchHtml(url) {
  console.log(`  GET  ${url}`)
  const res = await fetch(url, { headers: HEADERS_HTML })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return res.text()
}

/**
 * POST to the Kendo grid API endpoint.
 * Kendo server-side grids expect form-encoded params including
 * pagination (take/skip) plus our custom league params.
 */
async function fetchStandingsApi(year, season, weekNum) {
  const params = new URLSearchParams({
    // Kendo pagination — request all rows
    sort:     '',
    page:     '1',
    pageSize: '50',
    skip:     '0',
    take:     '50',
    // League params (matches what getLeagueParams() returns in site.js)
    leagueId: String(LEAGUE_ID),
    year:     String(year),
    season:   String(season),
    week:     String(weekNum),
  })

  console.log(`  POST ${API_URL}  [league=${LEAGUE_ID} year=${year} season=${season} week=${weekNum}]`)

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent':   HEADERS_HTML['User-Agent'],
      'Accept':       'application/json, text/javascript, */*',
      'X-Requested-With': 'XMLHttpRequest',
      'Referer': `${SLUG_BASE}/standings/${LEAGUE_ID}`,
    },
    body: params.toString(),
  })

  if (!res.ok) throw new Error(`API HTTP ${res.status} ${res.statusText}`)

  const json = await res.json()

  // Kendo response shape: { Data: [...], Total: N, Errors: null }
  if (!json?.Data || !Array.isArray(json.Data)) {
    throw new Error(`Unexpected API response shape: ${JSON.stringify(json).slice(0, 200)}`)
  }

  return json.Data
}

// ── Bowler parser (unchanged) ─────────────────────────────────────────────────

function extractBowlers(html) {
  const marker   = '"dataSource":[{"TeamID"'
  const startIdx = html.indexOf(marker)
  if (startIdx === -1) throw new Error('Bowler data marker not found in page HTML')

  const arrayStart = html.indexOf('[', startIdx + '"dataSource":'.length)
  let depth = 0, i = arrayStart
  while (i < html.length) {
    if      (html[i] === '[') depth++
    else if (html[i] === ']') { depth--; if (depth === 0) break }
    i++
  }
  return JSON.parse(html.slice(arrayStart, i + 1))
}

function extractWeeks(html) {
  const marker = '"SelectedID":"'
  const idx    = html.indexOf(marker)
  if (idx === -1) return []

  let pos = idx
  while (pos > 0 && html[pos] !== '[') pos--

  let depth = 0, i = pos
  while (i < html.length) {
    if      (html[i] === '[') depth++
    else if (html[i] === ']') { depth--; if (depth === 0) break }
    i++
  }
  try { return JSON.parse(html.slice(pos, i + 1)) } catch { return [] }
}

// ── Standings: map API response → our schema ──────────────────────────────────

/**
 * API fields:
 *   Place, TeamNum, TeamName, TeamDivision
 *   PointsWonSplit, PointsLostSplit, PercentWinLoss, PointsWonYTD
 *   AverageAfterBowling, TotalPinsSplit, HighScratchGame, HighScratchSeries
 *
 * PercentWinLoss comes back as a decimal (0.9375 = 93.75%)
 */
function mapApiStandings(apiRows) {
  return apiRows.map(r => ({
    place:            r.Place,
    teamNum:          r.TeamNum,
    teamName:         r.TeamName,
    pctWon:           Math.round((r.PercentWinLoss ?? 0) * 1000) / 10,  // 0.9375 → 93.8
    pointsWon:        r.PointsWonSplit   ?? 0,
    pointsLost:       r.PointsLostSplit  ?? 0,
    unearnedPoints:   r.UnearnedPoints   ?? 0,   // may not exist in API; default 0
    ytdWon:           r.PointsWonYTD     ?? 0,
    ytdLost:          r.PointsLostYTD    ?? 0,   // may not exist; default 0
    gamesWon:         r.GamesWon         ?? 0,   // may not exist; default 0
    teamAverage:      r.AverageAfterBowling ?? 0,
    scratchPins:      r.TotalPinsSplit   ?? 0,
    hdcpPins:         r.HdcpPinsSplit    ?? 0,   // may not exist
    highScratchGame:  r.HighScratchGame  ?? 0,
    highScratchSeries:r.HighScratchSeries ?? 0,
  }))
}

// ── Standings: HTML table fallback ────────────────────────────────────────────

function extractStandingsFromHtml(html) {
  const tableMatches = html.match(/<table[^>]*>([\s\S]*?)<\/table>/gi)
  if (!tableMatches) return null

  for (const tableHtml of tableMatches) {
    const rowMatches = tableHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/gi) || []
    const rows = rowMatches.map(r =>
      r.replace(/<[^>]+>/g, ' ')
       .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
       .replace(/\s+/g, ' ').trim()
    ).filter(Boolean)

    const dataRows = rows.filter(r => /^\d{1,2}\s/.test(r))
    if (dataRows.length >= 8) {
      const standings = parseStandingsRows(dataRows)
      if (standings.length >= 8) {
        console.log(`  ✓ HTML standings table (${standings.length} teams)`)
        return standings
      }
    }
  }
  return null
}

// ── Standings: PDF fallback ────────────────────────────────────────────────────

async function tryLoadPdfParse() {
  try { const m = await import('pdf-parse/lib/pdf-parse.js'); return m.default ?? m }
  catch { try { const m = await import('pdf-parse'); return m.default ?? m } catch { return null } }
}

function findLocalPdf() {
  if (forcePdf) {
    if (existsSync(forcePdf)) return forcePdf
    console.warn(`  ⚠️  --pdf file not found: ${forcePdf}`)
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

async function extractStandingsFromPdf(pdfPath) {
  const pdfParse = await tryLoadPdfParse()
  if (!pdfParse) {
    console.warn('  ⚠️  pdf-parse not installed. Run: npm install pdf-parse')
    return null
  }
  try {
    const data  = await pdfParse(readFileSync(pdfPath))
    const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean)
    const rows  = lines.filter(l => /^\d{1,2}\s+\d{1,2}\s+\S/.test(l))
    if (rows.length < 4) { console.warn(`  ⚠️  PDF: only ${rows.length} standings rows found`); return null }
    const standings = parseStandingsRows(rows)
    if (standings.length >= 4) { console.log(`  ✓ PDF standings (${standings.length} teams)`); return standings }
    return null
  } catch (err) { console.warn(`  ⚠️  PDF parse error: ${err.message}`); return null }
}

/**
 * Shared row parser for HTML table / PDF text.
 * First 2 tokens = place, teamNum. Last 10 tokens = numeric cols. Middle = team name.
 */
function parseStandingsRows(rows) {
  const results = []
  for (const row of rows) {
    const tokens = row.replace(/\t+/g, ' ').replace(/ {2,}/g, ' ').trim().split(' ')
    if (tokens.length < 13) continue
    const place   = parseInt(tokens[0], 10)
    const teamNum = parseInt(tokens[1], 10)
    if (isNaN(place) || isNaN(teamNum) || place < 1 || place > 20 || teamNum < 1 || teamNum > 20) continue
    const tail     = tokens.slice(-10)
    const teamName = tokens.slice(2, tokens.length - 10).join(' ').trim()
    if (!teamName) continue
    const nums = tail.map(t => parseFloat(t.replace(/,/g, '')))
    if (nums.some(isNaN)) continue
    results.push({
      place, teamNum, teamName,
      pctWon: nums[0], pointsWon: nums[1], pointsLost: nums[2], unearnedPoints: nums[3],
      ytdPctWon: nums[4], ytdWon: nums[5], ytdLost: nums[6],
      gamesWon: nums[7], scratchPins: nums[8], hdcpPins: nums[9],
    })
  }
  return results
}

// ── Standings orchestrator ────────────────────────────────────────────────────

async function fetchStandings(year, season, weekNum, weekPngUrl) {
  // Strategy 1: JSON API endpoint
  try {
    console.log('  Trying JSON API…')
    const rows = await fetchStandingsApi(year, season, weekNum)
    if (rows.length > 0) {
      const standings = mapApiStandings(rows)
      console.log(`  ✓ API standings (${standings.length} teams)`)
      return { standings, source: 'api' }
    }
  } catch (err) {
    console.log(`  API unavailable: ${err.message}`)
  }

  // Strategy 2: HTML table on /standings/ page
  try {
    const standingsPageUrl = weekPngUrl.replace('/standings-png/', '/standings/')
    console.log('  Trying HTML standings page…')
    const html = await fetchHtml(standingsPageUrl)
    const standings = extractStandingsFromHtml(html)
    if (standings?.length > 0) return { standings, source: 'html' }
    console.log('  HTML page found but no parseable table')
  } catch (err) {
    console.log(`  HTML page unavailable: ${err.message}`)
  }

  // Strategy 3: local PDF
  const pdfPath = findLocalPdf()
  if (pdfPath) {
    const standings = await extractStandingsFromPdf(pdfPath)
    if (standings?.length > 0) return { standings, source: `pdf:${pdfPath}` }
  }

  return null
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

  // Fetch the latest page to discover available weeks
  console.log('Fetching standings page to discover weeks…')
  const latestHtml     = await fetchHtml(PNG_URL)
  const availableWeeks = extractWeeks(latestHtml)

  if (availableWeeks.length === 0) {
    console.warn('⚠️  Could not parse week selector')
    return
  }

  const seasonMatch = availableWeeks[0].SelectedDesc.match(/(Spring|Fall|Summer|Winter)\s+(\d{4})/)
  const season      = seasonMatch ? `${seasonMatch[1]} ${seasonMatch[2]}` : 'Current Season'
  const currentWeek = availableWeeks[0].WeekNum

  console.log(`Found ${availableWeeks.length} week(s): ${availableWeeks.map(w => w.SelectedDesc).join(' | ')}\n`)

  for (const wk of availableWeeks) {
    const key        = String(wk.WeekNum)
    const cached     = !!db.weeks[key]
    const forceThis  = forceWeek === key
    const soThis     = standingsOnly === key
    const missingStandings = !db.weeks[key]?.standings?.length

    // Determine what to do
    const skipAll       = cached && !forceThis && !soThis && !missingStandings
    const standingsOnlyMode = soThis && !forceThis

    if (skipAll) {
      console.log(`  Week ${key} already cached (bowlers ✓, standings ✓) — skipping`)
      continue
    }
    if (cached && missingStandings && !forceThis) {
      console.log(`  Week ${key} — bowlers cached, standings missing — retrying standings…`)
    }
    if (forceThis) {
      console.log(`  Week ${key} — force re-sync`)
    }

    const [weekNum, year, seasonCode] = wk.SelectedID.split('|')
    const weekPngUrl = `${PNG_URL}/${year}/${seasonCode}/${weekNum}`

    try {
      // ── Bowlers (skip if standings-only mode) ──
      let active = db.weeks[key]?.bowlers ?? []
      if (!standingsOnlyMode) {
        const html = await fetchHtml(weekPngUrl)
        const bowlers = extractBowlers(html)
        active = bowlers.filter(b => b.BowlerStatus === 'R')
        console.log(`  ✓ Week ${weekNum}: ${active.length} active bowlers`)
      }

      // ── Standings ──
      console.log(`  Fetching standings for week ${weekNum}…`)
      const result       = await fetchStandings(year, seasonCode, weekNum, weekPngUrl)
      const standings    = result?.standings ?? db.weeks[key]?.standings ?? []
      const standingsSrc = result?.source    ?? (standings.length > 0 ? 'cached' : 'none')

      if (standings.length === 0) {
        console.log(`  ⚠️  No standings for week ${weekNum}`)
        console.log(`     → Download standings PDF from LeagueSecretary, save as standings.pdf`)
        console.log(`       then run: node sync.js --standings-only ${weekNum}`)
      }

      // Merge — preserve existing data if new fetch failed
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
    console.log(`    Wk ${k.padEnd(2)}  bowlers: ${w.bowlers?.length ?? 0}  standings: ${cnt > 0 ? `✓ ${cnt} teams [${src}]` : '✗ missing'}`)
  }
  console.log(`\nNext:  git add public/data.json && git commit -m "Week ${currentWeek}" && git push`)
  console.log(`  or:  npm run push\n`)
}

main().catch(err => {
  console.error('\n❌ Sync failed:', err.message)
  process.exit(1)
})
