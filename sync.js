#!/usr/bin/env node
/**
 * sync.js — Pinz Bowling League data sync
 *
 * Run once after Tuesday bowling:
 *   node sync.js
 *
 * Then push to GitHub:
 *   git add public/data.json && git commit -m "Update week N" && git push
 *
 * Requires Node 18+ (uses native fetch).
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DATA_PATH  = join(__dirname, 'public', 'data.json')
const BASE_URL   = 'https://www.leaguesecretary.com/bowling-centers/pinz-bowling-center/bowling-leagues/tuesday-nite-league/league/standings-png/147337'

// ── Fetch ──────────────────────────────────────────────────────────────────

async function fetchPage(url) {
  console.log(`  GET ${url}`)
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return res.text()
}

// ── Parsers ────────────────────────────────────────────────────────────────

/**
 * The bowler roster is embedded as a kendoDropDownList dataSource in the HTML.
 * We find it by locating the first occurrence of '"TeamID"' inside a JSON array.
 */
function extractBowlers(html) {
  const marker = '"dataSource":[{"TeamID"'
  const startIdx = html.indexOf(marker)
  if (startIdx === -1) throw new Error('Bowler data marker not found in page HTML')

  const arrayStart = html.indexOf('[', startIdx + '"dataSource":'.length)
  let depth = 0, i = arrayStart
  while (i < html.length) {
    if      (html[i] === '[') depth++
    else if (html[i] === ']') { depth--; if (depth === 0) break }
    i++
  }
  if (depth !== 0) throw new Error('Could not find closing bracket for bowler array')

  const raw = html.slice(arrayStart, i + 1)
  return JSON.parse(raw)
}

/**
 * The week/season dropdown is embedded as another kendoDropDownList.
 * Values look like: {"SelectedID":"4|2026|s","SelectedDesc":"Spring 2026 Week 4 02/24/2026",...}
 */
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

  try {
    return JSON.parse(html.slice(pos, i + 1))
  } catch {
    return []
  }
}

// ── Data helpers ───────────────────────────────────────────────────────────

function loadExisting() {
  if (existsSync(DATA_PATH)) {
    try { return JSON.parse(readFileSync(DATA_PATH, 'utf8')) } catch {}
  }
  return {
    meta: {
      leagueId:      147337,
      leagueName:    'Tuesday Nite League',
      center:        'Pinz Bowling Center',
      centerAddress: '12655 Ventura Blvd, Studio City, CA',
      phone:         '818-769-7600',
      lastSynced:    null,
      currentWeek:   0,
      season:        '',
    },
    weeks: {},
  }
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎳  Pinz Bowling League Sync\n')

  const db = loadExisting()

  // Step 1: fetch the default (latest) page to discover available weeks
  console.log('Fetching latest standings page…')
  const latestHtml = await fetchPage(BASE_URL)
  const availableWeeks = extractWeeks(latestHtml)

  if (availableWeeks.length === 0) {
    console.warn('⚠️  Could not parse week selector — trying to extract current page data only')
    const bowlers = extractBowlers(latestHtml)
    db.weeks['?'] = { weekNum: '?', dateBowled: '', description: 'Unknown week', bowlers }
    writeFileSync(DATA_PATH, JSON.stringify(db, null, 2))
    console.log(`✅ Saved ${bowlers.length} bowlers to public/data.json`)
    return
  }

  console.log(`Found ${availableWeeks.length} weeks: ${availableWeeks.map(w => w.SelectedDesc).join(' | ')}\n`)

  // Parse season from first entry  e.g. "Spring 2026 Week 4 …"
  const seasonMatch = availableWeeks[0].SelectedDesc.match(/(Spring|Fall|Summer|Winter)\s+(\d{4})/)
  const season      = seasonMatch ? `${seasonMatch[1]} ${seasonMatch[2]}` : 'Current Season'
  const currentWeek = availableWeeks[0].WeekNum

  // Step 2: fetch each week we don't already have cached
  for (const wk of availableWeeks) {
    const key = String(wk.WeekNum)

    if (db.weeks[key]) {
      console.log(`  Week ${key} already cached — skipping`)
      continue
    }

    const [weekNum, year, seasonCode] = wk.SelectedID.split('|')
    const weekUrl = `${BASE_URL}/${year}/${seasonCode}/${weekNum}`

    try {
      const html    = await fetchPage(weekUrl)
      const bowlers = extractBowlers(html)
      const active  = bowlers.filter(b => b.BowlerStatus === 'R')

      db.weeks[key] = {
        weekNum:     wk.WeekNum,
        dateBowled:  wk.DateBowled?.split('T')[0] ?? '',
        description: wk.SelectedDesc,
        bowlers:     active,
      }

      console.log(`  ✓ Week ${weekNum}: ${active.length} active bowlers`)

      // Be polite
      await new Promise(r => setTimeout(r, 1200))
    } catch (err) {
      console.error(`  ✗ Week ${weekNum}: ${err.message}`)
    }
  }

  // Step 3: update meta
  db.meta = {
    ...db.meta,
    lastSynced:  new Date().toISOString().split('T')[0],
    currentWeek,
    season,
  }

  writeFileSync(DATA_PATH, JSON.stringify(db, null, 2))

  const weekKeys = Object.keys(db.weeks).sort((a, b) => Number(a) - Number(b))
  console.log(`\n✅ Saved to public/data.json`)
  console.log(`   Season  : ${season}`)
  console.log(`   Weeks   : ${weekKeys.join(', ')}`)
  console.log(`\nNext steps:`)
  console.log(`  git add public/data.json`)
  console.log(`  git commit -m "Update standings week ${currentWeek}"`)
  console.log(`  git push`)
  console.log(`\nGitHub Actions will deploy automatically. 🎳\n`)
}

main().catch(err => {
  console.error('\n❌ Sync failed:', err.message)
  process.exit(1)
})
