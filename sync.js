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

const SYNC_VERSION = 'v0.31.0'

import { readFileSync, writeFileSync, existsSync, readdirSync, createReadStream, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const __dirname = dirname(fileURLToPath(import.meta.url))

// Load .env if present (LS_EMAIL / LS_PASSWORD for API auth)
const envPath = join(__dirname, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m) process.env[m[1]] ??= m[2].replace(/^["']|["']$/g, '')
  }
}
const DATA_PATH = join(__dirname, 'public', 'data.json')

const LEAGUE_ID  = 147337
const SLUG_BASE  = 'https://www.leaguesecretary.com/bowling-centers/pinz-bowling-center/bowling-leagues/tuesday-nite-league/league'
const PNG_URL    = `${SLUG_BASE}/standings-png/${LEAGUE_ID}`
const API_URL    = 'https://www.leaguesecretary.com/League/InteractiveStandings_Read'
const PDF_BASE   = 'https://pdf.leaguesecretary.com/uploads'

/**
 * Build the direct PDF URL for a given week.
 * Pattern from page source:
 *   https://pdf.leaguesecretary.com/uploads/2026/s/1/14733702032026s202601standg00.pdf
 *   {leagueId}{DDMMYYYY}s{YYYY}{WW:02d}standg00.pdf
 */
function buildPdfUrl(year, seasonCode, weekNum, dateBowled) {
  // dateBowled is "2026-02-03" → DDMMYYYY = "02032026"
  const [y, m, d] = dateBowled.split('-')
  const ddmmyyyy  = `${d}${m}${y}`
  const ww        = String(weekNum).padStart(2, '0')
  const filename  = `${LEAGUE_ID}${ddmmyyyy}s${year}${ww}standg00.pdf`
  return `${PDF_BASE}/${year}/${seasonCode}/${weekNum}/${filename}`
}
const LOGIN_URL  = 'https://www.leaguesecretary.com/account/login'
const BASE_URL   = 'https://www.leaguesecretary.com'

// ── CLI args ──────────────────────────────────────────────────────────────────

const args          = process.argv.slice(2)
const forceWeek     = args.includes('--week')           ? args[args.indexOf('--week')           + 1] : null
const standingsOnly = args.includes('--standings-only') ? args[args.indexOf('--standings-only') + 1] : null
const forcePdf      = args.includes('--pdf')            ? args[args.indexOf('--pdf')            + 1] : null

// ── HTTP / Session ────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'

// Module-level session cookie — populated by login(), used by all requests after
let sessionCookie = ''

/**
 * Parse Set-Cookie headers into a single cookie string.
 * Keeps only the name=value part of each cookie (strips path/expires/etc).
 */
function parseSetCookies(headers) {
  const raw = headers.getSetCookie?.() ?? []
  return raw.map(c => c.split(';')[0]).filter(Boolean).join('; ')
}

/**
 * Prompt for a value on stdin. If `secret` is true, disables echo (password).
 */
async function prompt(question, secret = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    if (secret) {
      // Write question manually, suppress echo via raw mode
      process.stdout.write(question)
      process.stdin.setRawMode?.(true)
      process.stdin.resume()
      process.stdin.setEncoding('utf8')
      let input = ''
      const onData = ch => {
        if (ch === '\n' || ch === '\r' || ch === '\u0003') {
          process.stdin.setRawMode?.(false)
          process.stdin.pause()
          process.stdin.removeListener('data', onData)
          process.stdout.write('\n')
          rl.close()
          resolve(input)
        } else if (ch === '\u007f') {
          input = input.slice(0, -1)  // backspace
        } else {
          input += ch
        }
      }
      process.stdin.on('data', onData)
    } else {
      rl.question(question, answer => { rl.close(); resolve(answer.trim()) })
    }
  })
}

/**
 * Log into LeagueSecretary using LS_EMAIL / LS_PASSWORD from .env.
 * If either is missing, prompts interactively.
 *
 * LeagueSecretary uses Kendo Form (fields built by JS) so there is no
 * __RequestVerificationToken hidden input in the HTML.  Instead ASP.NET Core
 * sets an antiforgery cookie on the GET, and Kendo reads + sends it as the
 * RequestVerificationToken request header on the POST.
 */
async function login() {
  let email    = process.env.LS_EMAIL    ?? ''
  let password = process.env.LS_PASSWORD ?? ''

  if (!email)    email    = await prompt('  LeagueSecretary email: ')
  if (!password) password = await prompt('  LeagueSecretary password: ', true)

  // Write back so Playwright can read via process.env
  process.env.LS_EMAIL    = email
  process.env.LS_PASSWORD = password

  // Step 1: GET login page — grab antiforgery cookie
  console.log(`  🔐 Logging in as ${email}…`)
  const getRes = await fetch(LOGIN_URL, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
    redirect: 'follow',
  })
  if (!getRes.ok) throw new Error(`Login GET failed: ${getRes.status}`)
  const getCookies = parseSetCookies(getRes.headers)

  // ASP.NET Core antiforgery cookie is named .AspNetCore.Antiforgery.XXXX
  // Kendo sends its value as the RequestVerificationToken header
  const antiforgeryMatch = getCookies.match(/\.AspNetCore\.Antiforgery\.[^=]+=([^;]+)/)
  const antiforgeryToken = antiforgeryMatch ? antiforgeryMatch[1] : ''

  if (!antiforgeryToken) {
    // Some ASP.NET Core configs don't require it — try without
    console.log('  ⚠️  No antiforgery cookie found — attempting login without token')
  }

  // Step 2: POST credentials
  const body = new URLSearchParams({ Email: email, Password: password })
  const postRes = await fetch(LOGIN_URL, {
    method:   'POST',
    headers:  {
      'Content-Type':              'application/x-www-form-urlencoded',
      'User-Agent':                UA,
      'Accept':                    'text/html,application/xhtml+xml',
      'Referer':                   LOGIN_URL,
      'Cookie':                    getCookies,
      ...(antiforgeryToken ? { 'RequestVerificationToken': antiforgeryToken } : {}),
    },
    body:     body.toString(),
    redirect: 'manual',
  })

  const postCookies = parseSetCookies(postRes.headers)

  // Merge GET + POST cookies; POST wins on duplicates
  const merged = {}
  for (const pair of `${getCookies}; ${postCookies}`.split(';')) {
    const [k, ...v] = pair.trim().split('=')
    if (k) merged[k.trim()] = v.join('=').trim()
  }
  sessionCookie = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ')

  // Successful login → 302 redirect away from /account/login
  // Failed login → 200 (re-renders the login page)
  if (postRes.status === 302) {
    const dest = postRes.headers.get('location') ?? ''
    console.log(`  ✓ Logged in (→ ${dest})`)

    // Follow the redirect — the server may set additional cookies (e.g.
    // .LeagueSecretary.Session) on the redirect destination, not on the
    // login POST response itself
    const redirectUrl = dest.startsWith('http') ? dest : `${BASE_URL}${dest}`
    const redirectRes = await fetch(redirectUrl, {
      headers: {
        'User-Agent': UA,
        'Accept':     'text/html',
        'Cookie':     sessionCookie,
      },
      redirect: 'manual',
    })
    const redirectCookies = parseSetCookies(redirectRes.headers)
    if (redirectCookies) {
      for (const pair of redirectCookies.split(';')) {
        const [k, ...v] = pair.trim().split('=')
        if (k) merged[k.trim()] = v.join('=').trim()
      }
      sessionCookie = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ')
      const hasSession = sessionCookie.includes('.LeagueSecretary.Session')
      console.log(`  ${hasSession ? '✓' : '⚠️ '} Session cookie${hasSession ? ' (.LeagueSecretary.Session ✓)' : ' — .LeagueSecretary.Session not found'}`)
    }
    return true
  }
  if (postRes.status === 200) {
    throw new Error('Login returned 200 — credentials likely incorrect (wrong email/password)')
  }
  throw new Error(`Unexpected login response: ${postRes.status}`)
}

async function fetchHtml(url) {
  console.log(`  GET  ${url}`)
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept':     'text/html',
      ...(sessionCookie ? { 'Cookie': sessionCookie } : {}),
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return res.text()
}

async function fetchStandingsApi(year, season, weekNum) {
  let chromium
  try {
    chromium = (await import('playwright')).chromium
  } catch {
    console.log('  ⚠️  playwright not installed — run: npm install playwright && npx playwright install chromium')
    return []
  }

  const email    = process.env.LS_EMAIL    ?? ''
  const password = process.env.LS_PASSWORD ?? ''
  if (!email || !password) { console.log('  ⚠️  LS_EMAIL/LS_PASSWORD not set'); return [] }

  console.log(`  🌐 Launching browser for week ${weekNum}…`)
  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  try {
    // Intercept the standings AJAX response
    let standingsData = null
    page.on('response', async res => {
      if (res.url().includes('InteractiveStandings_Read') && res.request().method() === 'POST') {
        try {
          const json = await res.json()
          if (json?.Data?.length) standingsData = json.Data
        } catch {}
      }
    })

    // Step 1: login
    console.log('  → Logging in…')
    await page.goto('https://www.leaguesecretary.com/account/login')
    await page.fill('input[name=Email]',    email)
    await page.fill('input[name=Password]', password)
    await Promise.all([
      page.waitForNavigation(),
      page.click('button[type=submit], input[type=submit]'),
    ])
    console.log(`  → Logged in, at: ${page.url()}`)

    // Step 2: navigate to standings page — Kendo grid fires AJAX automatically
    const url = `${SLUG_BASE}/standings/${LEAGUE_ID}/${year}/${season}/${weekNum}`
    console.log(`  → Loading standings week ${weekNum}…`)
    // waitUntil networkidle means all AJAX has completed — no manual setTimeout needed
    await page.goto(url, { waitUntil: 'networkidle' })

    if (standingsData?.length) {
      console.log(`  ✓ Got ${standingsData.length} standings rows`)
    } else {
      console.log('  ⚠️  No standings data intercepted')
    }
    return standingsData ?? []
  } finally {
    await browser.close()
  }
}

// ── Bowler / week parsers ─────────────────────────────────────────────────────

function extractBowlers(html) {
  // standings-png page: bowler JSON embedded directly → unescaped quotes
  const directMarker = '"dataSource":[{"TeamID"'
  const directStart  = html.indexOf(directMarker)
  if (directStart !== -1) {
    const arrStart = html.indexOf('[', directStart + '"dataSource":'.length)
    let depth = 0, i = arrStart
    while (i < html.length) {
      if (html[i] === '[') depth++
      else if (html[i] === ']') { depth--; if (depth === 0) break }
      i++
    }
    return JSON.parse(html.slice(arrStart, i + 1))
  }

  // standings page: bowler JSON is inside a Kendo dialog "content" JSON string,
  // so all internal quotes are escaped as \"  →  look for the escaped marker
  const escapedMarker = '\\"dataSource\\":[{\\"TeamID\\"'
  const escapedStart  = html.indexOf(escapedMarker)
  if (escapedStart === -1) throw new Error('Bowler data marker not found')

  const arrStart = html.indexOf('[', escapedStart + '\\"dataSource\\":'.length)

  // Walk to the matching ] — skip over \" (escaped quotes won't be [ or ])
  // but bare [ and ] are real structure characters at this nesting level
  let depth = 0, i = arrStart
  while (i < html.length) {
    if (html[i] === '\\' && html[i + 1] === '"') { i += 2; continue } // skip \"
    if (html[i] === '[') depth++
    else if (html[i] === ']') { depth--; if (depth === 0) break }
    i++
  }

  // Unescape \" → " and \\ → \ then parse
  const escaped   = html.slice(arrStart, i + 1)
  const unescaped = escaped.replace(/\\"/g, '"').replace(/\\\\/g, '\\')
  return JSON.parse(unescaped)
}

/**
 * Fetch bowler JSON for the current week.
 * Primary: standings-png page (direct JSON embed, worked historically).
 * Fallback: /standings/LEAGUE_ID (no week suffix = current week, double-encoded JSON).
 */
async function fetchCurrentWeekBowlers(year, seasonCode, weekNum) {
  const pngUrl       = `${PNG_URL}`
  const standingsUrl = `${SLUG_BASE}/standings/${LEAGUE_ID}` // no week suffix — always current

  for (const [label, url] of [['standings-png', pngUrl], ['standings', standingsUrl]]) {
    try {
      const html    = await fetchHtml(url)
      const bowlers = extractBowlers(html)
      const active  = bowlers.filter(b => b.BowlerStatus === 'R')
      if (active.length > 0) {
        console.log(`  ✓ Week ${weekNum}: ${active.length} active bowlers (from ${label})`)
        return { active }
      }
    } catch (err) {
      console.log(`  ✗ ${label} bowler fetch: ${err.message}`)
    }
  }
  throw new Error(`Could not extract bowlers from any source for week ${weekNum}`)
}

/**
 * Use Playwright to navigate to a past week's standings page (which uses the
 * week-selector UI) and extract the bowler JSON embedded in the page HTML.
 * The server embeds bowler data for whatever week is currently displayed,
 * so navigating to /standings/147337/2026/s/1 should serve week 1 bowler data.
 */
async function fetchPastWeekBowlersViaPlaywright(year, seasonCode, weekNum) {
  let chromium
  try { chromium = (await import('playwright')).chromium }
  catch { console.log('  ⚠️  playwright not installed'); return [] }

  const email    = process.env.LS_EMAIL    ?? ''
  const password = process.env.LS_PASSWORD ?? ''
  if (!email || !password) return []

  console.log(`  🌐 Fetching week ${weekNum} bowlers via browser…`)
  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  try {
    // Login
    await page.goto('https://www.leaguesecretary.com/account/login')
    await page.fill('input[name=Email]',    email)
    await page.fill('input[name=Password]', password)
    await Promise.all([page.waitForNavigation(), page.click('button[type=submit], input[type=submit]')])

    // Navigate to the week-specific standings page — server embeds bowler JSON here
    const url = `${SLUG_BASE}/standings/${LEAGUE_ID}/${year}/${seasonCode}/${weekNum}`
    await page.goto(url, { waitUntil: 'networkidle' })

    const html    = await page.content()
    const bowlers = extractBowlers(html)
    const active  = bowlers.filter(b => b.BowlerStatus === 'R')

    if (active.length > 0) {
      console.log(`  ✓ Week ${weekNum}: ${active.length} bowlers (via browser)`)
    } else {
      console.log(`  ⚠️  Week ${weekNum}: no bowler JSON found in page HTML`)
    }
    return active
  } finally {
    await browser.close()
  }
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
 * Fetch the full bowler roster from BowlerByWeekList_Read, paginating until
 * all rows are collected. Returns a deduped array (by BowlerID) with each
 * bowler's BowlerPosition, TeamNum, TeamName, Average, HandicapAfterBowling.
 *
 * BowlerPosition semantics:
 *   0     = unassigned pool sub
 *   1–4   = registered roster bowler (scoring member)
 *   5+    = bowler who has subbed for this team at least once
 *
 * The server returns 20 rows per page regardless of pageSize param.
 * We paginate via Playwright (same browser session we already have open).
 */
async function fetchAllBowlersWithPositions() {
  let chromium
  try {
    chromium = (await import('playwright')).chromium
  } catch {
    console.log('  ⚠️  playwright not installed — skipping roster fetch')
    return []
  }

  const email    = process.env.LS_EMAIL    ?? ''
  const password = process.env.LS_PASSWORD ?? ''
  if (!email || !password) {
    console.log('  ⚠️  LS_EMAIL/LS_PASSWORD not set — skipping roster fetch')
    return []
  }

  console.log('  🌐 Fetching full bowler roster with positions…')
  const browser = await chromium.launch({ headless: true })
  const page    = await browser.newPage()

  try {
    // Login
    await page.goto('https://www.leaguesecretary.com/account/login')
    await page.fill('input[name=Email]',    email)
    await page.fill('input[name=Password]', password)
    await Promise.all([
      page.waitForNavigation(),
      page.click('button[type=submit], input[type=submit]'),
    ])

    // Paginate
    const allRows = []
    let pageNum   = 1

    while (true) {
      const url      = `${BOWLER_LIST_URL}?sortCol=TeamNum&order=asc&page=${pageNum}`
      const pageRows = []

      const handler = async res => {
        if (!res.url().includes('BowlerByWeekList_Read')) return
        try {
          const json = await res.json()
          pageRows.push(...(json?.Data ?? []))
        } catch {}
      }

      page.on('response', handler)
      await page.goto(url, { waitUntil: 'networkidle' })
      page.off('response', handler)

      if (pageRows.length === 0) break
      allRows.push(...pageRows)
      if (pageRows.length < 20) break
      pageNum++
    }

    // Deduplicate by BowlerID — keep first occurrence (alphabetical sort from server)
    const seen    = new Set()
    const deduped = allRows.filter(b => {
      if (seen.has(b.BowlerID)) return false
      seen.add(b.BowlerID)
      return true
    })

    console.log(`  ✓ Roster: ${deduped.length} unique bowlers across ${pageNum} page(s)`)

    // Log position summary
    const pos5plus = deduped.filter(b => b.BowlerPosition >= 5)
    if (pos5plus.length) {
      console.log(`  ℹ️  ${pos5plus.length} sub(s) on team (pos ≥ 5):`)
      pos5plus.forEach(b =>
        console.log(`    → ${b.BowlerName} (pos ${b.BowlerPosition}) → Team#${b.TeamNum} ${b.TeamName}`)
      )
    }

    return deduped
  } finally {
    await browser.close()
  }
}

/**
 * Compute team HDCP pins from bowler JSON.
 *   bowler hdcpPins = TotalPins (scratch) + HandicapAfterBowling × TotalGames
 *   team hdcpPins   = sum of all active bowlers on that team
 */
function computeHdcpPins(bowlers, positionMap = null) {
  const map = {}
  for (const b of bowlers) {
    if (!b.TeamName || b.BowlerStatus !== 'R') continue
    // If positionMap available, skip pool subs (pos 0) and team subs (pos >= 5)
    if (positionMap) {
      const pos = positionMap.get(Number(b.BowlerID))
      if (pos === 0 || pos >= 5) continue
    }
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
function enrichStandings(apiStandings, bowlers, weekNum, positionMap = null) {
  const hdcpMap    = computeHdcpPins(bowlers, positionMap)
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
  try {
    // pdf-parse is CommonJS — createRequire is the reliable way to load it from ESM
    const m = require('pdf-parse')
    // pdf-parse exports { PDFParse, ... } — PDFParse is the callable function
    const fn = typeof m === 'function' ? m : (m?.PDFParse ?? m?.default ?? null)
    if (typeof fn !== 'function') throw new Error('pdf-parse did not export a function')
    return fn
  } catch (err) {
    console.warn(`  ⚠️  pdf-parse load failed: ${err.message}`)
    return null
  }
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
/**
 * Fetch the standings PDF for a given week directly from the public CDN URL.
 * No auth required — the URL is embedded in the page source.
 * Saves to a temp file so parsePdfStandings() can read it.
 */
async function fetchPdfForWeek(year, seasonCode, weekNum, dateBowled) {
  const url     = buildPdfUrl(year, seasonCode, weekNum, dateBowled)
  const tmpPath = join(__dirname, `_wk${weekNum}.pdf`)
  console.log(`  GET  ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) {
    console.log(`  ⚠️  PDF fetch failed: HTTP ${res.status}`)
    return null
  }
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(tmpPath, buf)
  return tmpPath
}

async function parsePdfStandings(pdfPath) {
  const pdfParse = await tryLoadPdfParse()
  if (!pdfParse) {
    console.warn('  ⚠️  pdf-parse not installed — run: npm install pdf-parse')
    return null
  }
  try {
    const data  = await new pdfParse(readFileSync(pdfPath))
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

async function buildStandings(year, season, weekNum, bowlers, dateBowled = null) {
  // Step 0: local PDF takes priority if present — drop straight to PDF path
  const localPdf = findLocalPdf()
  if (localPdf) {
    console.log(`  📄 Local PDF found — using as primary source`)
    const pdfMap = await parsePdfStandings(localPdf)
    if (pdfMap) {
      const hdcpMap = computeHdcpPins(bowlers, positionMap)
      const standings = Object.values(pdfMap).map(r => ({
        place: r.place, teamNum: r.teamNum, teamName: r.teamName,
        pctWon: r.pctWon, pointsWon: r.pointsWon, pointsLost: r.pointsLost,
        unearnedPoints: r.unearnedPoints, ytdWon: r.ytdWon, ytdLost: r.ytdLost,
        gamesWon: r.gamesWon, teamAverage: 0,
        scratchPins: r.scratchPins,
        hdcpPins: hdcpMap[r.teamName] ? Math.round(hdcpMap[r.teamName]) : r.hdcpPins,
        highScratchGame: 0, highScratchSeries: 0,
      })).sort((a, b) => a.place - b.place)
      console.log(`  ✓ Standings from PDF (${standings.length} teams)`)
      return { standings, source: 'pdf' }
    }
  }

  let apiRows = null

  // Step 1: try the API
  try {
    apiRows = await fetchStandingsApi(year, season, weekNum)
    if (!apiRows.length) {
      console.log('  API returned 0 rows — will try PDF if available')
      apiRows = null
    }
  } catch (err) {
    console.log(`  API failed: ${err.message}`)
  }

  // Step 2: if API worked, enrich + return
  if (apiRows) {
    let standings = mapApiStandings(apiRows)
    const { standings: enriched } = enrichStandings(standings, bowlers, parseInt(weekNum), positionMap)
    standings = enriched

    const warnings = detectUnearnedMismatches(standings)
    if (warnings.length) {
      console.log(`  ℹ️  Unearned points computed for ${warnings.length} team(s):`)
      warnings.forEach(w => console.log(w))
    }

    // PDF can still patch gamesWon — check local then auto-fetch
    let pdfPath = findLocalPdf()
    if (!pdfPath && dateBowled) {
      pdfPath = await fetchPdfForWeek(year, season, weekNum, dateBowled)
    }
    if (pdfPath) {
      const pdfMap = await parsePdfStandings(pdfPath)
      if (pdfMap) {
        standings = patchWithPdf(standings, pdfMap)
        console.log(`  ✓ Patched gamesWon from PDF`)
        return { standings, source: 'api+computed+pdf' }
      }
    }
    return { standings, source: 'api+computed' }
  }

  // Step 3: API failed — try PDF as primary source
  // First check for a local PDF, then auto-fetch from the public CDN
  let pdfPath = findLocalPdf()
  if (!pdfPath && dateBowled) {
    pdfPath = await fetchPdfForWeek(year, season, weekNum, dateBowled)
  }
  if (pdfPath) {
    const pdfMap = await parsePdfStandings(pdfPath)
    if (pdfMap) {
      const hdcpMap = computeHdcpPins(bowlers)
      const standings = Object.values(pdfMap).map(r => ({
        place:             r.place,
        teamNum:           r.teamNum,
        teamName:          r.teamName,
        pctWon:            r.pctWon,
        pointsWon:         r.pointsWon,
        pointsLost:        r.pointsLost,
        unearnedPoints:    r.unearnedPoints,
        ytdWon:            r.ytdWon,
        ytdLost:           r.ytdLost,
        gamesWon:          r.gamesWon,
        teamAverage:       0,           // not in PDF
        scratchPins:       r.scratchPins,
        hdcpPins:          hdcpMap[r.teamName]
                             ? Math.round(hdcpMap[r.teamName])
                             : r.hdcpPins,
        highScratchGame:   0,           // not in PDF
        highScratchSeries: 0,           // not in PDF
      })).sort((a, b) => a.place - b.place)
      console.log(`  ✓ Standings built from PDF (${standings.length} teams)`)
      return { standings, source: 'pdf' }
    }
  }

  return null  // nothing worked
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
  console.log(`\n🎳  Pinz Bowling League Sync  ${SYNC_VERSION}\n`)
  const db = loadExisting()

  // Log in to get a session cookie for the standings API
  try {
    await login()
    // Quick verify — a logged-in page shows the user's name, not "Sign In"
    const verifyHtml = await fetchHtml(`${BASE_URL}/account/myleagues`)
    if (verifyHtml.includes('Sign In') && !verifyHtml.includes('Sign Out')) {
      console.log('  ⚠️  Session check failed — API standings may not work')
    } else {
      console.log('  ✓ Session verified')
    }

    // Hit the bowler leagues AJAX endpoint — this populates the myleagues grid in
    // the browser and likely establishes server-side league access context.
    const leaguesApiUrl = `${BASE_URL}/Account/AccountBowlerLeagues_Read`
    console.log(`  GET  ${leaguesApiUrl}`)
    const leaguesRes = await fetch(leaguesApiUrl, {
      headers: {
        'User-Agent':       UA,
        'Accept':           'application/json, text/javascript, */*; q=0.01',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer':          `${BASE_URL}/account/myleagues`,
        'Cookie':           sessionCookie,
      },
    })
    if (leaguesRes.ok) {
      const leaguesJson = await leaguesRes.json().catch(() => null)
      const myLeague = leaguesJson?.Data?.find(l => l.LeagueID === LEAGUE_ID)
      if (myLeague) {
        console.log(`  ✓ League context set (BowlerID=${myLeague.BowlerID}, UserPermissionID=${myLeague.UserPermissionID})`)
      }
    }
    console.log()
  } catch (err) { console.log(`  ⚠️  Login failed: ${err.message}\n`) }

  // ── Fetch master bowler roster with BowlerPosition data ─────────────────
  console.log('\nFetching master bowler roster…')
  let positionMap = null
  try {
    const masterRoster = await fetchAllBowlersWithPositions()
    if (masterRoster.length) {
      // Store full roster in meta for use by views
      db.meta.bowlerRoster = masterRoster.map(b => ({
        BowlerID:           b.BowlerID,
        BowlerName:         b.BowlerName,
        TeamID:             b.TeamID,
        TeamNum:            b.TeamNum,
        TeamName:           b.TeamName,
        BowlerPosition:     b.BowlerPosition,
        BowlerStatus:       b.BowlerStatus,
        Average:            b.Average,
        HandicapAfterBowling: b.HandicapAfterBowling,
        EnteringAverage:    b.EnteringAverage,
        Gender:             b.Gender,
      }))
      // Build fast lookup: BowlerID → BowlerPosition
      positionMap = new Map(masterRoster.map(b => [Number(b.BowlerID), b.BowlerPosition]))
      console.log(`  ✓ Position map built for ${positionMap.size} bowlers`)
    }
  } catch (err) {
    console.log(`  ⚠️  Roster fetch failed: ${err.message}`)
  }

  console.log('\nFetching standings page to discover weeks…')
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
          try {
            const result = await fetchCurrentWeekBowlers(year, seasonCode, weekNum)
            active = result.active
          } catch (err) {
            console.log(`  ✗ Week ${weekNum}: ${err.message}`)
          }
        } else if (forceThis) {
          try {
            const html    = await fetchHtml(weekPngUrl)
            const bowlers = extractBowlers(html)
            active = bowlers.filter(b => b.BowlerStatus === 'R')
            console.log(`  ✓ Week ${weekNum}: ${active.length} active bowlers`)
          } catch {
            console.log(`  ℹ️  Week ${weekNum}: past-week bowler JSON unavailable — keeping cached`)
          }
        } else if (missingBowlers) {
          // Past week with no bowlers — try Playwright to get them
          const fetched = await fetchPastWeekBowlersViaPlaywright(year, seasonCode, weekNum)
          if (fetched.length) active = fetched
          else console.log(`  ℹ️  Week ${weekNum}: no bowler data available for past week`)
        } else {
          console.log(`  ✓ Week ${weekNum}: ${active.length} bowlers (cached)`)
        }
      }

      // ── Standings ─────────────────────────────────────────────────────────
      const dateBowled = wk.DateBowled?.split('T')[0] ?? null
      console.log(`  Building standings for week ${weekNum}…`)
      const result   = await buildStandings(year, seasonCode, weekNum, active, dateBowled)
      // Clean up any auto-fetched temp PDF
      const tmpPdf = join(__dirname, `_wk${weekNum}.pdf`)
      try { if (existsSync(tmpPdf)) unlinkSync(tmpPdf) } catch {}
      const standings    = result?.standings ?? db.weeks[key]?.standings ?? []
      const standingsSrc = result?.source    ?? (standings.length > 0 ? 'cached' : 'none')

      if (!standings.length) {
        console.log(`  ⚠️  No standings for week ${weekNum}`)
        console.log(`     Download standings PDF from LeagueSecretary → save as standings.pdf → re-run: node sync.js --standings-only ${weekNum}`)
      }

      // Merge BowlerPosition from master roster into per-week bowler records
      const activeMerged = active.map(b => {
        const pos = positionMap?.get(Number(b.BowlerID))
        return pos !== undefined ? { ...b, BowlerPosition: pos } : b
      })

      db.weeks[key] = {
        ...(db.weeks[key] ?? {}),
        weekNum:     wk.WeekNum,
        dateBowled:  wk.DateBowled?.split('T')[0] ?? '',
        description: wk.SelectedDesc,
        bowlers:     activeMerged,
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
