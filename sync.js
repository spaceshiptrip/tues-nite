#!/usr/bin/env node
/**
 * sync.js — Pinz Bowling League data sync  v0.32.0
 *
 * What's new in v0.32.0:
 *   - Recap PDF parser: OCR via pdftoppm + tesseract
 *   - Patches per-game scores, absent flags, entering averages from recap
 *   - Adds missing bowlers (e.g. Bernard Badion / Team 15)
 *   - Put recap PDFs in: pdfs/wk05-2026-03-03-recap.pdf
 *
 * Requires: brew install poppler tesseract
 */

const SYNC_VERSION = 'v0.32.0'

import { readFileSync, writeFileSync, existsSync, readdirSync, unlinkSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createInterface } from 'readline'
import { createRequire } from 'module'
import { execSync } from 'child_process'
import os from 'os'
const require = createRequire(import.meta.url)

const __dirname = dirname(fileURLToPath(import.meta.url))

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
const PDF_BASE   = 'https://pdf.leaguesecretary.com/uploads'
const LOGIN_URL  = 'https://www.leaguesecretary.com/account/login'
const BASE_URL   = 'https://www.leaguesecretary.com'

function buildPdfUrl(year, seasonCode, weekNum, dateBowled) {
  const [y, m, d] = dateBowled.split('-')
  const ddmmyyyy  = `${d}${m}${y}`
  const ww        = String(weekNum).padStart(2, '0')
  return `${PDF_BASE}/${year}/${seasonCode}/${weekNum}/${LEAGUE_ID}${ddmmyyyy}s${year}${ww}standg00.pdf`
}

const args          = process.argv.slice(2)
const forceWeek     = args.includes('--week')           ? args[args.indexOf('--week')           + 1] : null
const standingsOnly = args.includes('--standings-only') ? args[args.indexOf('--standings-only') + 1] : null
const forcePdf      = args.includes('--pdf')            ? args[args.indexOf('--pdf')            + 1] : null

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
let sessionCookie = ''
let positionMap   = null   // BowlerID → BowlerPosition; populated after roster fetch

// ── Auth ──────────────────────────────────────────────────────────────────────

function parseSetCookies(headers) {
  const raw = headers.getSetCookie?.() ?? []
  return raw.map(c => c.split(';')[0]).filter(Boolean).join('; ')
}

async function prompt(question, secret = false) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    if (secret) {
      process.stdout.write(question)
      process.stdin.setRawMode?.(true)
      process.stdin.resume()
      process.stdin.setEncoding('utf8')
      let input = ''
      const onData = ch => {
        if (ch === '\n' || ch === '\r' || ch === '\u0003') {
          process.stdin.setRawMode?.(false); process.stdin.pause()
          process.stdin.removeListener('data', onData)
          process.stdout.write('\n'); rl.close(); resolve(input)
        } else if (ch === '\u007f') { input = input.slice(0, -1) } else { input += ch }
      }
      process.stdin.on('data', onData)
    } else {
      rl.question(question, answer => { rl.close(); resolve(answer.trim()) })
    }
  })
}

async function login() {
  let email    = process.env.LS_EMAIL    ?? ''
  let password = process.env.LS_PASSWORD ?? ''
  if (!email)    email    = await prompt('  LeagueSecretary email: ')
  if (!password) password = await prompt('  LeagueSecretary password: ', true)
  process.env.LS_EMAIL = email; process.env.LS_PASSWORD = password

  console.log(`  🔐 Logging in as ${email}…`)
  const getRes = await fetch(LOGIN_URL, { headers: { 'User-Agent': UA, 'Accept': 'text/html' }, redirect: 'follow' })
  if (!getRes.ok) throw new Error(`Login GET failed: ${getRes.status}`)
  const getCookies       = parseSetCookies(getRes.headers)
  const antiforgeryMatch = getCookies.match(/\.AspNetCore\.Antiforgery\.[^=]+=([^;]+)/)
  const antiforgeryToken = antiforgeryMatch ? antiforgeryMatch[1] : ''
  if (!antiforgeryToken) console.log('  ⚠️  No antiforgery cookie — attempting login without token')

  const postRes = await fetch(LOGIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml', 'Referer': LOGIN_URL, 'Cookie': getCookies,
      ...(antiforgeryToken ? { 'RequestVerificationToken': antiforgeryToken } : {}),
    },
    body: new URLSearchParams({ Email: email, Password: password }).toString(),
    redirect: 'manual',
  })
  const postCookies = parseSetCookies(postRes.headers)
  const merged = {}
  for (const pair of `${getCookies}; ${postCookies}`.split(';')) {
    const [k, ...v] = pair.trim().split('='); if (k) merged[k.trim()] = v.join('=').trim()
  }
  sessionCookie = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ')

  if (postRes.status === 302) {
    const dest        = postRes.headers.get('location') ?? ''
    const redirectUrl = dest.startsWith('http') ? dest : `${BASE_URL}${dest}`
    console.log(`  ✓ Logged in (→ ${dest})`)
    const redirectRes     = await fetch(redirectUrl, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Cookie': sessionCookie }, redirect: 'manual' })
    const redirectCookies = parseSetCookies(redirectRes.headers)
    if (redirectCookies) {
      for (const pair of redirectCookies.split(';')) {
        const [k, ...v] = pair.trim().split('='); if (k) merged[k.trim()] = v.join('=').trim()
      }
      sessionCookie = Object.entries(merged).map(([k, v]) => `${k}=${v}`).join('; ')
      const ok = sessionCookie.includes('.LeagueSecretary.Session')
      console.log(`  ${ok ? '✓' : '⚠️ '} Session cookie${ok ? ' ✓' : ' — .LeagueSecretary.Session not found'}`)
    }
    return true
  }
  if (postRes.status === 200) throw new Error('Login returned 200 — wrong email/password?')
  throw new Error(`Unexpected login response: ${postRes.status}`)
}

async function fetchHtml(url) {
  console.log(`  GET  ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html', ...(sessionCookie ? { 'Cookie': sessionCookie } : {}) } })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`)
  return res.text()
}

// ── Playwright helpers ────────────────────────────────────────────────────────

async function getChromium() {
  try { return (await import('playwright')).chromium }
  catch { console.log('  ⚠️  playwright not installed — run: npm install playwright && npx playwright install chromium'); return null }
}

async function playwrightLogin(page) {
  const email = process.env.LS_EMAIL ?? ''; const password = process.env.LS_PASSWORD ?? ''
  if (!email || !password) return false
  await page.goto('https://www.leaguesecretary.com/account/login')
  await page.fill('input[name=Email]', email)
  await page.fill('input[name=Password]', password)
  await Promise.all([page.waitForNavigation(), page.click('button[type=submit], input[type=submit]')])
  return true
}

async function fetchStandingsApi(year, season, weekNum) {
  const chromium = await getChromium(); if (!chromium) return []
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage()
  try {
    let standingsData = null
    page.on('response', async res => {
      if (res.url().includes('InteractiveStandings_Read') && res.request().method() === 'POST') {
        try { const j = await res.json(); if (j?.Data?.length) standingsData = j.Data } catch {}
      }
    })
    console.log(`  🌐 Browser: standings week ${weekNum}…`)
    await playwrightLogin(page)
    await page.goto(`${SLUG_BASE}/standings/${LEAGUE_ID}/${year}/${season}/${weekNum}`, { waitUntil: 'networkidle' })
    console.log(standingsData?.length ? `  ✓ Got ${standingsData.length} standings rows` : '  ⚠️  No standings data intercepted')
    return standingsData ?? []
  } finally { await browser.close() }
}

async function fetchAllBowlersWithPositions() {
  const chromium = await getChromium(); if (!chromium) return []
  if (!process.env.LS_EMAIL || !process.env.LS_PASSWORD) { console.log('  ⚠️  LS_EMAIL/LS_PASSWORD not set'); return [] }
  console.log('  🌐 Fetching full bowler roster with positions…')
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage()
  try {
    await playwrightLogin(page)
    const BOWLER_LIST_URL = `${SLUG_BASE}/bowler/list/${LEAGUE_ID}`
    const allRows = []; let pageNum = 1
    while (true) {
      const pageRows = []
      const handler = async res => {
        if (!res.url().includes('BowlerByWeekList_Read')) return
        try { const j = await res.json(); pageRows.push(...(j?.Data ?? [])) } catch {}
      }
      page.on('response', handler)
      await page.goto(`${BOWLER_LIST_URL}?sortCol=TeamNum&order=asc&page=${pageNum}`, { waitUntil: 'networkidle' })
      page.off('response', handler)
      if (pageRows.length === 0) break
      allRows.push(...pageRows)
      if (pageRows.length < 20) break
      pageNum++
    }
    const seen = new Set()
    const deduped = allRows.filter(b => { if (seen.has(b.BowlerID)) return false; seen.add(b.BowlerID); return true })
    console.log(`  ✓ Roster: ${deduped.length} unique bowlers across ${pageNum} page(s)`)
    const pos5plus = deduped.filter(b => b.BowlerPosition >= 5)
    if (pos5plus.length) {
      console.log(`  ℹ️  ${pos5plus.length} sub(s): `)
      pos5plus.forEach(b => console.log(`    → ${b.BowlerName} (pos ${b.BowlerPosition}) Team#${b.TeamNum} ${b.TeamName}`))
    }
    return deduped
  } finally { await browser.close() }
}

async function fetchPastWeekBowlersViaPlaywright(year, seasonCode, weekNum) {
  const chromium = await getChromium(); if (!chromium) return []
  if (!process.env.LS_EMAIL || !process.env.LS_PASSWORD) return []
  console.log(`  🌐 Fetching week ${weekNum} bowlers via browser…`)
  const browser = await chromium.launch({ headless: true }); const page = await browser.newPage()
  try {
    await playwrightLogin(page)
    await page.goto(`${SLUG_BASE}/standings/${LEAGUE_ID}/${year}/${seasonCode}/${weekNum}`, { waitUntil: 'networkidle' })
    const html = await page.content()
    const bowlers = extractBowlers(html)
    const active  = bowlers.filter(b => b.BowlerStatus === 'R')
    console.log(active.length ? `  ✓ Week ${weekNum}: ${active.length} bowlers` : `  ⚠️  Week ${weekNum}: no bowler JSON in page`)
    return active
  } finally { await browser.close() }
}

// ── Bowler extraction ─────────────────────────────────────────────────────────

function extractBowlers(html) {
  const directMarker = '"dataSource":[{"TeamID"'
  const directStart  = html.indexOf(directMarker)
  if (directStart !== -1) {
    const arrStart = html.indexOf('[', directStart + '"dataSource":'.length)
    let depth = 0, i = arrStart
    while (i < html.length) { if (html[i]==='[') depth++; else if (html[i]===']') { depth--; if (depth===0) break }; i++ }
    return JSON.parse(html.slice(arrStart, i + 1))
  }
  const escapedMarker = '\\"dataSource\\":[{\\"TeamID\\"'
  const escapedStart  = html.indexOf(escapedMarker)
  if (escapedStart === -1) throw new Error('Bowler data marker not found')
  const arrStart = html.indexOf('[', escapedStart + '\\"dataSource\\":'.length)
  let depth = 0, i = arrStart
  while (i < html.length) {
    if (html[i]==='\\' && html[i+1]==='"') { i+=2; continue }
    if (html[i]==='[') depth++; else if (html[i]===']') { depth--; if (depth===0) break }; i++
  }
  return JSON.parse(html.slice(arrStart, i + 1).replace(/\\"/g, '"').replace(/\\\\/g, '\\'))
}

async function fetchCurrentWeekBowlers(year, seasonCode, weekNum) {
  for (const [label, url] of [['standings-png', PNG_URL], ['standings', `${SLUG_BASE}/standings/${LEAGUE_ID}`]]) {
    try {
      const html   = await fetchHtml(url)
      const active = extractBowlers(html).filter(b => b.BowlerStatus === 'R')
      if (active.length) { console.log(`  ✓ Week ${weekNum}: ${active.length} bowlers (${label})`); return { active } }
    } catch (err) { console.log(`  ✗ ${label}: ${err.message}`) }
  }
  throw new Error(`Could not extract bowlers for week ${weekNum}`)
}

function extractWeeks(html) {
  const idx = html.indexOf('"SelectedID":"'); if (idx === -1) return []
  let pos = idx; while (pos > 0 && html[pos] !== '[') pos--
  let depth = 0, i = pos
  while (i < html.length) { if (html[i]==='[') depth++; else if (html[i]===']') { depth--; if (depth===0) break }; i++ }
  try { return JSON.parse(html.slice(pos, i + 1)) } catch { return [] }
}

// ── Standings calculations ────────────────────────────────────────────────────

const PTS_PER_WEEK = 4

function computeHdcpPins(bowlers, posMap = null) {
  const map = {}
  for (const b of bowlers) {
    if (!b.TeamName || b.BowlerStatus !== 'R') continue
    if (posMap) { const pos = posMap.get(Number(b.BowlerID)); if (pos === 0 || pos >= 5) continue }
    const pins = (b.TotalPins ?? 0) + (b.HandicapAfterBowling ?? 0) * (b.TotalGames ?? 0)
    map[b.TeamName] = (map[b.TeamName] ?? 0) + pins
  }
  return map
}

function enrichStandings(apiStandings, bowlers, weekNum, posMap = null) {
  const hdcpMap = computeHdcpPins(bowlers, posMap)
  return apiStandings.map(t => ({
    ...t,
    hdcpPins:       Math.round(hdcpMap[t.teamName] ?? t.hdcpPins ?? 0),
    ytdLost:        t.teamNum === 16 ? 0 : Math.max(0, (weekNum * PTS_PER_WEEK) - (t.ytdWon ?? 0)),
    unearnedPoints: t.teamNum === 16 ? 0 : Math.max(0, (parseInt(weekNum) * PTS_PER_WEEK) - (t.pointsWon ?? 0) - (t.pointsLost ?? 0)),
    gamesWon:       t.gamesWon ?? 0,
  }))
}

function mapApiStandings(rows) {
  return rows.map(r => ({
    place: r.Place, teamNum: r.TeamNum, teamName: r.TeamName,
    pctWon: Math.round((r.PercentWinLoss ?? 0) * 1000) / 10,
    pointsWon: r.PointsWonSplit ?? 0, pointsLost: r.PointsLostSplit ?? 0,
    unearnedPoints: 0, ytdWon: r.PointsWonYTD ?? 0, ytdLost: 0, gamesWon: 0,
    teamAverage: r.AverageAfterBowling ?? 0, scratchPins: r.TotalPinsSplit ?? 0, hdcpPins: 0,
    highScratchGame: r.HighScratchGame ?? 0, highScratchSeries: r.HighScratchSeries ?? 0,
  }))
}

// ── Standings PDF helpers ─────────────────────────────────────────────────────

async function tryLoadPdfParse() {
  try {
    const m = require('pdf-parse')
    const fn = typeof m === 'function' ? m : (m?.PDFParse ?? m?.default ?? null)
    if (typeof fn !== 'function') throw new Error('pdf-parse did not export a function')
    return fn
  } catch (err) { console.warn(`  ⚠️  pdf-parse load failed: ${err.message}`); return null }
}

function findLocalPdf() {
  if (forcePdf) { if (existsSync(forcePdf)) return forcePdf; console.warn(`  ⚠️  --pdf not found: ${forcePdf}`); return null }
  const candidates = ['standings.pdf']
  try { for (const f of readdirSync(__dirname)) { if (/^(standings|week|wk).*\.pdf$/i.test(f) && !candidates.includes(f)) candidates.push(f) } } catch {}
  for (const name of candidates) { const full = join(__dirname, name); if (existsSync(full)) { console.log(`  Found local PDF: ${name}`); return full } }
  return null
}

async function fetchPdfForWeek(year, seasonCode, weekNum, dateBowled) {
  const url     = buildPdfUrl(year, seasonCode, weekNum, dateBowled)
  const tmpPath = join(__dirname, `_wk${weekNum}.pdf`)
  console.log(`  GET  ${url}`)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) { console.log(`  ⚠️  PDF fetch failed: HTTP ${res.status}`); return null }
  writeFileSync(tmpPath, Buffer.from(await res.arrayBuffer()))
  return tmpPath
}

async function parsePdfStandings(pdfPath) {
  const pdfParse = await tryLoadPdfParse(); if (!pdfParse) return null
  try {
    const data  = await new pdfParse(readFileSync(pdfPath))
    const lines = data.text.split('\n').map(l => l.trim()).filter(Boolean)
    const rows  = lines.filter(l => /^\d{1,2}\s+\d{1,2}\s+\S/.test(l))
    if (rows.length < 4) { console.warn(`  ⚠️  PDF: only ${rows.length} rows found`); return null }
    const map = {}
    for (const row of rows) {
      const tokens = row.replace(/\t+/g, ' ').replace(/ {2,}/g, ' ').trim().split(' ')
      if (tokens.length < 13) continue
      const place = parseInt(tokens[0], 10); const teamNum = parseInt(tokens[1], 10)
      if (isNaN(place) || isNaN(teamNum) || place < 1 || place > 20) continue
      const tail = tokens.slice(-10); const teamName = tokens.slice(2, tokens.length - 10).join(' ').trim()
      if (!teamName) continue
      const nums = tail.map(t => parseFloat(t.replace(/,/g, '')))
      if (nums.some(isNaN)) continue
      map[teamNum] = {
        place, teamNum, teamName,
        pctWon: nums[0], pointsWon: nums[1], pointsLost: nums[2], unearnedPoints: nums[3],
        ytdPctWon: nums[4], ytdWon: nums[5], ytdLost: nums[6], gamesWon: nums[7],
        scratchPins: nums[8], hdcpPins: nums[9],
      }
    }
    const count = Object.keys(map).length
    if (count < 4) { console.warn(`  ⚠️  PDF parsed but only ${count} valid rows`); return null }
    console.log(`  ✓ PDF parsed (${count} teams)`); return map
  } catch (err) { console.warn(`  ⚠️  PDF error: ${err.message}`); return null }
}

function patchWithPdf(standings, pdfMap) {
  return standings.map(t => { const pdf = pdfMap[t.teamNum]; if (!pdf) return t; return { ...t, gamesWon: pdf.gamesWon, ytdLost: pdf.ytdLost } })
}

async function buildStandings(year, season, weekNum, bowlers, dateBowled = null) {
  function buildFromPdfMap(pdfMap, source) {
    const hdcpMap = computeHdcpPins(bowlers, positionMap)
    return {
      standings: Object.values(pdfMap).map(r => ({
        place: r.place, teamNum: r.teamNum, teamName: r.teamName,
        pctWon: r.pctWon, pointsWon: r.pointsWon, pointsLost: r.pointsLost,
        unearnedPoints: r.unearnedPoints, ytdWon: r.ytdWon, ytdLost: r.ytdLost,
        gamesWon: r.gamesWon, teamAverage: 0, scratchPins: r.scratchPins,
        hdcpPins: hdcpMap[r.teamName] ? Math.round(hdcpMap[r.teamName]) : r.hdcpPins,
        highScratchGame: 0, highScratchSeries: 0,
      })).sort((a, b) => a.place - b.place),
      source,
    }
  }

  const localPdf = findLocalPdf()
  if (localPdf) {
    console.log(`  📄 Local standings PDF found — using as primary source`)
    const pdfMap = await parsePdfStandings(localPdf)
    if (pdfMap) { console.log(`  ✓ Standings from PDF (${Object.keys(pdfMap).length} teams)`); return buildFromPdfMap(pdfMap, 'pdf') }
  }

  let apiRows = null
  try {
    apiRows = await fetchStandingsApi(year, season, weekNum)
    if (!apiRows.length) { console.log('  API returned 0 rows'); apiRows = null }
  } catch (err) { console.log(`  API failed: ${err.message}`) }

  if (apiRows) {
    let standings = enrichStandings(mapApiStandings(apiRows), bowlers, parseInt(weekNum), positionMap)
    const unearned = standings.filter(t => t.unearnedPoints > 0)
    if (unearned.length) unearned.forEach(t => console.log(`    ℹ️  ${t.teamName}: ${t.unearnedPoints} unearned pt(s)`))

    let pdfPath = findLocalPdf()
    if (!pdfPath && dateBowled) pdfPath = await fetchPdfForWeek(year, season, weekNum, dateBowled)
    if (pdfPath) {
      const pdfMap = await parsePdfStandings(pdfPath)
      if (pdfMap) { standings = patchWithPdf(standings, pdfMap); return { standings, source: 'api+computed+pdf' } }
    }
    return { standings, source: 'api+computed' }
  }

  let pdfPath = findLocalPdf()
  if (!pdfPath && dateBowled) pdfPath = await fetchPdfForWeek(year, season, weekNum, dateBowled)
  if (pdfPath) {
    const pdfMap = await parsePdfStandings(pdfPath)
    if (pdfMap) return buildFromPdfMap(pdfMap, 'pdf')
  }

  return null
}

// ── Data helpers ──────────────────────────────────────────────────────────────

function loadExisting() {
  if (existsSync(DATA_PATH)) { try { return JSON.parse(readFileSync(DATA_PATH, 'utf8')) } catch {} }
  return {
    meta: {
      leagueId: LEAGUE_ID, leagueName: 'Tuesday Nite League',
      center: 'Pinz Bowling Center', centerAddress: '12655 Ventura Blvd, Studio City, CA',
      phone: '818-769-7600', lastSynced: null, currentWeek: 0, season: '',
    },
    weeks: {},
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// RECAP PDF PARSER
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Find the recap PDF for a given week.
 * Put your PDFs in the pdfs/ folder using this naming pattern:
 *   pdfs/wk05-2026-03-03-recap.pdf
 *   pdfs/wk5-recap.pdf
 * Or just drop recap.pdf in the repo root as a fallback.
 */
function findRecapPdf(weekNum) {
  const wkPad = String(weekNum).padStart(2, '0')
  for (const dir of [join(__dirname, 'pdfs'), __dirname]) {
    try {
      const files = readdirSync(dir)
        .filter(f => /recap/i.test(f) && f.toLowerCase().endsWith('.pdf'))
        .filter(f => new RegExp(`wk0?${weekNum}[^0-9]|wk${wkPad}[^0-9]|week0?${weekNum}[^0-9]`, 'i').test(f))
      if (files.length) {
        const found = join(dir, files[0])
        console.log(`  📄 Recap PDF: ${found}`)
        return found
      }
    } catch {}
  }
  const rootFallback = join(__dirname, 'recap.pdf')
  if (existsSync(rootFallback)) { console.log(`  📄 Recap PDF (root fallback): recap.pdf`); return rootFallback }
  return null
}

/**
 * OCR a recap PDF. Renders each page at 300dpi and runs tesseract on the
 * full page image. Column splitting is done in post-processing by
 * splitTwoColumns(), not at the image level.
 *
 * Returns an array of raw OCR text strings, one per page.
 * Requires: brew install poppler tesseract
 */
async function ocrRecapPdf(pdfPath) {
  const tmpDir = join(os.tmpdir(), `bowling-recap-${Date.now()}`)
  mkdirSync(tmpDir, { recursive: true })
  const pages = []
  try {
    execSync(`pdftoppm -r 300 "${pdfPath}" "${join(tmpDir, 'page')}"`, { stdio: 'pipe' })
    const pageFiles = readdirSync(tmpDir).filter(f => f.startsWith('page') && f.endsWith('.ppm')).sort()
    if (!pageFiles.length) throw new Error('pdftoppm produced no images — is poppler installed? (brew install poppler)')
    for (const pf of pageFiles) {
      const base = join(tmpDir, pf.replace('.ppm', '_out'))
      execSync(`tesseract "${join(tmpDir, pf)}" "${base}" --psm 6 -l eng 2>/dev/null`, { stdio: 'pipe' })
      pages.push(readFileSync(`${base}.txt`, 'utf8'))
    }
  } finally {
    try { rmSync(tmpDir, { recursive: true, force: true }) } catch {}
  }
  return pages
}

/**
 * The recap sheet is a 2-column layout. Tesseract reads across the full
 * width, merging both columns onto each line:
 *   "Lane 1 #- FilDonahue Week 5 3/3/2026  Lane? 5-TeamS WeekS 3/3/2026"
 *   "Dakota Fine 158 ... 610  Freddy Reynoso 139 ... 423"
 *
 * This function detects the column split position by finding lines where
 * "Lane" appears twice, then splits every line at that character position.
 * Returns { left, right } strings suitable for parseRecapColumn().
 */
function splitTwoColumns(pageText) {
  const lines = pageText.split('\n')

  // Find split position from lines containing two lane headers
  const splitPositions = []
  for (const line of lines) {
    const matches = [...line.matchAll(/Lane/gi)]
    if (matches.length >= 2) splitPositions.push(matches[1].index)
  }

  if (splitPositions.length === 0) {
    // Single-column page (or no lane headers found) — treat as left only
    return { left: pageText, right: '' }
  }

  // Use median to avoid outliers
  splitPositions.sort((a, b) => a - b)
  const splitCol = splitPositions[Math.floor(splitPositions.length / 2)]

  const leftLines = [], rightLines = []
  for (const line of lines) {
    leftLines.push(line.slice(0, splitCol))
    rightLines.push(line.slice(splitCol))
  }
  return { left: leftLines.join('\n'), right: rightLines.join('\n') }
}


/**
 * Parse a single game score token from OCR output.
 *   "197"  → { score: 197, absent: false }
 *   "a120" → { score: 120, absent: true  }  (absent — bowled average)
 *   "8100" → { score: 100, absent: true  }  (OCR misread 'a' as '8')
 */
function parseScoreToken(token) {
  if (!token) return null
  const t = token.toLowerCase().replace(/[^a0-9]/g, '')
  if (/^a\d{2,3}$/.test(t))  { const s = parseInt(t.slice(1), 10); return s >= 50 && s <= 300 ? { score: s, absent: true  } : null }
  if (/^\d{2,3}$/.test(t))   { const s = parseInt(t, 10);          return s >= 50 && s <= 300 ? { score: s, absent: false } : null }
  if (/^[83]\d{3}$/.test(t)) { const s = parseInt(t.slice(1), 10); return s >= 50 && s <= 300 ? { score: s, absent: true  } : null }
  return null
}

/**
 * Parse one column of OCR'd recap text into an array of lane sections.
 */
let _unknownLaneCounter = 100  // for garbled lane numbers — stays unique across calls

/**
 * Clean an OCR token for numeric testing.
 * OCR introduces noise chars like #, $, «, §, ©, O (capital O) before digits.
 * Strip everything except 'a' (absent marker) and digits.
 */
function cleanToken(t) { return t.toLowerCase().replace(/[^a0-9]/g, '') }
function looksLikeScore(token) {
  const t = cleanToken(token)
  return /^a?\d{2,3}$/.test(t) || /^[83]\d{3}$/.test(t)
}
function cleanInt(token) { return parseInt(cleanToken(token).replace(/^a/, ''), 10) }

function parseRecapColumn(text) {
  const lines    = text.split('\n').map(l => l.trim()).filter(Boolean)
  const sections = []; let current = null
  const SKIP_RE  = /^(Name|Old|Avg|Avq|HDCP|HDGP|Scratch|Handicap|^Total$|Pinz|Tuesday|Reprint|BLS|Page\s|\d{4}\/)/i

  for (const line of lines) {
    const laneHdr = line.match(/^Lane\s*(\S+)\s+(.+?)\s+Week/i)
    if (laneHdr) {
      if (current?.bowlers.length) sections.push(current)
      const parsedLane = parseInt(laneHdr[1], 10)
      const laneNum = Number.isFinite(parsedLane) ? parsedLane : ++_unknownLaneCounter
      // Strip leading garbled team-number prefix like "7-", "#-", "73-", "T4-"
      const rawTeamName = laneHdr[2].replace(/^[^a-z]+[-:]\s*/i, '').trim()
      current = { laneNum, rawTeamName, weekNum: null, bowlers: [], pointsWon: [null, null, null], totalPointsWon: null }
      continue
    }
    if (!current) continue
    if (/Team\s+Points/i.test(line)) {
      const nums = [...line.matchAll(/[\d.]+/g)].map(m => parseFloat(m[0]))
      if (nums.length >= 4) { current.pointsWon = [nums[0], nums[1], nums[2]]; current.totalPointsWon = nums[nums.length - 1] }
      continue
    }
    if (SKIP_RE.test(line)) continue

    // Use looksLikeScore() which cleans tokens first — handles #197, $137, «99, O02, etc.
    const tokens = line.split(/\s+/).filter(Boolean)
    if (tokens.length < 5) continue
    let numStart = -1
    for (let i = tokens.length - 1; i >= 1; i--) {
      if (looksLikeScore(tokens[i]) && tokens.slice(i).filter(t => looksLikeScore(t)).length >= 5) {
        numStart = i; while (numStart > 1 && looksLikeScore(tokens[numStart - 1])) numStart--; break
      }
    }
    if (numStart < 1) continue

    const rawName = tokens.slice(0, numStart).join(' ')
    const numParts = tokens.slice(numStart)
    if (numParts.length < 7 || !rawName || rawName.length < 3) continue

    // Clean oldAvg and oldHdcp — OCR noise like «130, #72 etc.
    const oldAvg  = cleanInt(numParts[0])
    const oldHdcp = cleanInt(numParts[1])
    if (isNaN(oldAvg) || oldAvg < 50 || oldAvg > 300 || isNaN(oldHdcp) || oldHdcp < 0 || oldHdcp > 200) continue

    const games = [], absent = []
    for (let gi = 2; gi <= 4; gi++) { const p = parseScoreToken(numParts[gi]); games.push(p?.score ?? null); absent.push(p?.absent ?? false) }
    if (games.filter(s => s !== null).length < 2) continue

    current.bowlers.push({ rawName, oldAvg, oldHdcp, games, absent,
      scratchTotal: cleanInt(numParts[5]) || null,
      hdcpTotal:    cleanInt(numParts[6]) || null })
  }
  if (current?.bowlers.length) sections.push(current)
  return sections
}
/**
 * OCR + parse a recap PDF. Returns sorted array of lane sections.
 */
async function parseRecapPdf(pdfPath) {
  console.log(`  🔍 OCR-ing recap PDF (takes ~10s)…`)
  let pages
  try { pages = await ocrRecapPdf(pdfPath) }
  catch (err) {
    console.warn(`  ⚠️  Recap OCR failed: ${err.message}`)
    console.warn(`       brew install poppler tesseract`)
    return []
  }
  const seen = new Set(); const all = []
  for (const pageText of pages) {
    const { left, right } = splitTwoColumns(pageText)
    for (const s of [...parseRecapColumn(left), ...parseRecapColumn(right)]) {
      if (seen.has(s.laneNum)) continue; seen.add(s.laneNum); all.push(s)
    }
  }
  all.sort((a, b) => a.laneNum - b.laneNum)
  console.log(`  ✓ Recap: ${all.length} lane section(s)`)
  for (const s of all) {
    const absent = s.bowlers.flatMap(b => b.absent).filter(Boolean).length
    console.log(`    Lane ${String(s.laneNum).padStart(2)}: "${s.rawTeamName}" — ${s.bowlers.length} bowler(s), pts=${s.totalPointsWon ?? '?'}${absent ? ` [${absent} absent]` : ''}`)
  }
  return all
}

// Team name OCR garble variants — add to this as new errors are discovered
const TEAM_OCR_ALIASES = {
  'Fill Donahue':       ['FilDonahwe', 'Fil Donahue', 'Fill Donahwe'],
  'Chips Gutter Crew':  ['ChipsGutter', 'Chips Gutter'],
  'Lumber Liquidators': ['Lumber Liq'],
  'Mostly Moser':       ['MostlyMoser', 'Mosity Moser'],
  'Social Butterflies': ['Socia/ Butterflies', 'Socia Butterflies'],
  'F-ING 10 PIN':       ['F-INGTOPIN', 'FING TOPIN', 'F-ING10PIN'],
  'Team Won':           ['TeamWon'],
  'Team 2':             ['Team?', 'TeamF'],
  'Team 5':             ['TeamS', 'Teams'],
  'Team 7':             ['TeamiT?', 'TeamiT', 'Teamit'],
  'Team 14':            ['Teamid4', 'Teamid'],
  'Team 15':            ['TeamiS5', 'Team15'],
  'Social Butterflies': ['Socia/ Butterflies', 'Socia Butterflies', 'Social! Butterflies'],
}

function recapNameToDataJson(name) {
  const p = name.trim().split(/\s+/).filter(Boolean)
  return p.length < 2 ? name : `${p[p.length - 1]}, ${p.slice(0, -1).join(' ')}`
}

function nameMatchScore(recapName, dataName) {
  if (recapNameToDataJson(recapName).toLowerCase() === dataName.toLowerCase()) return 1.0
  const [dl = '', df = ''] = dataName.toLowerCase().split(',').map(s => s.trim())
  const rp = recapName.toLowerCase().split(/\s+/)
  if (rp[rp.length - 1] === dl) return rp[0]?.[0] === df[0] ? 0.9 : 0.7
  return 0
}

function matchRecapTeam(rawName, dbTeams) {
  const raw = rawName.toLowerCase().trim()
  for (const team of dbTeams) {
    if (team.TeamName.toLowerCase() === raw) return team
    if ((TEAM_OCR_ALIASES[team.TeamName] ?? []).some(a => a.toLowerCase() === raw || raw.includes(a.toLowerCase()))) return team
  }
  let best = null, bestScore = 0
  for (const team of dbTeams) {
    const rawT = raw.split(/\s+/); const dbT = team.TeamName.toLowerCase().split(/\s+/)
    const score = rawT.filter(t => dbT.includes(t)).length / Math.max(rawT.length, dbT.length)
    if (score > bestScore) { bestScore = score; best = team }
  }
  if (bestScore >= 0.5) return best
  console.warn(`    ⚠️  Could not match recap team "${rawName}"`); return null
}

/**
 * Apply recap PDF sections to a week's data.json entry.
 * Patches existing bowlers with game scores and entering averages.
 * Adds completely missing bowlers (e.g. Bernard Badion on Team 15).
 */
function patchWeekWithRecap(weekData, recapSections) {
  const bowlers = weekData.bowlers.map(b => ({ ...b }))
  const teamsByID = {}
  for (const b of bowlers) {
    if (!b.TeamID) continue
    if (!teamsByID[b.TeamID]) teamsByID[b.TeamID] = { TeamID: b.TeamID, TeamName: b.TeamName, bowlers: [] }
    teamsByID[b.TeamID].bowlers.push(b)
  }
  const dbTeams = Object.values(teamsByID)

  for (const section of recapSections) {
    const dbTeam = matchRecapTeam(section.rawTeamName, dbTeams); if (!dbTeam) continue
    console.log(`  → Lane ${section.laneNum}: "${section.rawTeamName}" → "${dbTeam.TeamName}"`)

    for (const rb of section.bowlers) {
      let bestMatch = null, bestScore = 0
      for (const db of dbTeam.bowlers) { const s = nameMatchScore(rb.rawName, db.BowlerName); if (s > bestScore) { bestScore = s; bestMatch = db } }

      if (bestMatch && bestScore >= 0.7) {
        const nonAbsent = rb.games.filter((g, i) => g !== null && !rb.absent[i])
        const scratchTotal = nonAbsent.reduce((s, g) => s + g, 0)
        bestMatch._games = rb.games; bestMatch._absent = rb.absent
        bestMatch._scratchSeries = scratchTotal; bestMatch._recapMatched = true; bestMatch._recapName = rb.rawName

        if (rb.oldAvg && rb.oldAvg !== bestMatch.EnteringAverage) {
          console.log(`    ✏️  ${bestMatch.BowlerName}: EnteringAverage ${bestMatch.EnteringAverage} → ${rb.oldAvg}`)
          bestMatch.EnteringAverage = rb.oldAvg
        }
        // NOTE: do NOT overwrite TotalPins / TotalGames — those are cumulative
        // season totals from the API. The recap only has this week's games.
        // Per-game data lives in _games / _absent / _scratchSeries.
        const absentTag = rb.absent.some(Boolean) ? ` [${rb.absent.filter(Boolean).length} absent]` : ''
        console.log(`    ✓ ${bestMatch.BowlerName}: [${rb.games.map((g, i) => g === null ? '?' : rb.absent[i] ? `a${g}` : g).join(' ')}]${absentTag}`)

      } else {
        // Missing bowler — add them to the week
        const normalized = recapNameToDataJson(rb.rawName)
        const nonAbsent  = rb.games.filter((g, i) => g !== null && !rb.absent[i])
        const totalPins  = nonAbsent.reduce((s, g) => s + g, 0)
        const tmpl       = dbTeam.bowlers[0] ?? {}
        console.log(`    ➕ Adding missing bowler: ${normalized} (${dbTeam.TeamName})`)
        const newBowler = {
          BowlerID: null, BowlerName: normalized, TeamID: dbTeam.TeamID, TeamName: dbTeam.TeamName,
          TeamNum: tmpl.TeamNum ?? 0, Gender: '', TotalPins: totalPins, TotalGames: nonAbsent.length,
          Average: nonAbsent.length ? Math.round(totalPins / nonAbsent.length) : rb.oldAvg,
          ScratchHandicapFlag: tmpl.ScratchHandicapFlag ?? 'H',
          EnteringAverage: rb.oldAvg, HandicapAfterBowling: rb.oldHdcp,
          HighScratchGame: nonAbsent.length ? Math.max(...nonAbsent) : 0, HighScratchSeries: totalPins,
          HighHandicapGame: 0, HighHandicapSeries: 0, MostImproved: 0,
          BowlerPosition: 0,   // unknown — test will warn, that's expected
          BowlerStatus: 'R', _games: rb.games, _absent: rb.absent, _scratchSeries: totalPins,
          _recapMatched: true, _recapOnly: true, _source: 'recap-pdf',
        }
        bowlers.push(newBowler); dbTeam.bowlers.push(newBowler)
      }
    }
  }
  return { ...weekData, bowlers, _recapPatched: true }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🎳  Pinz Bowling League Sync  ${SYNC_VERSION}\n`)
  const db = loadExisting()

  try {
    await login()
    const verifyHtml = await fetchHtml(`${BASE_URL}/account/myleagues`)
    console.log(verifyHtml.includes('Sign In') && !verifyHtml.includes('Sign Out') ? '  ⚠️  Session check failed' : '  ✓ Session verified')
    const leaguesRes = await fetch(`${BASE_URL}/Account/AccountBowlerLeagues_Read`, {
      headers: { 'User-Agent': UA, 'Accept': 'application/json, text/javascript, */*; q=0.01', 'X-Requested-With': 'XMLHttpRequest', 'Referer': `${BASE_URL}/account/myleagues`, 'Cookie': sessionCookie },
    })
    if (leaguesRes.ok) {
      const j = await leaguesRes.json().catch(() => null)
      const l = j?.Data?.find(l => l.LeagueID === LEAGUE_ID)
      if (l) console.log(`  ✓ League context set (BowlerID=${l.BowlerID})`)
    }
    console.log()
  } catch (err) { console.log(`  ⚠️  Login failed: ${err.message}\n`) }

  console.log('\nFetching master bowler roster…')
  try {
    const masterRoster = await fetchAllBowlersWithPositions()
    if (masterRoster.length) {
      db.meta.bowlerRoster = masterRoster.map(b => ({
        BowlerID: b.BowlerID, BowlerName: b.BowlerName, TeamID: b.TeamID, TeamNum: b.TeamNum,
        TeamName: b.TeamName, BowlerPosition: b.BowlerPosition, BowlerStatus: b.BowlerStatus,
        Average: b.Average, HandicapAfterBowling: b.HandicapAfterBowling, EnteringAverage: b.EnteringAverage, Gender: b.Gender,
      }))
      positionMap = new Map(masterRoster.map(b => [Number(b.BowlerID), b.BowlerPosition]))
      console.log(`  ✓ Position map built for ${positionMap.size} bowlers`)
    }
  } catch (err) { console.log(`  ⚠️  Roster fetch failed: ${err.message}`) }

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
    const skipAll          = cached && !forceThis && !soThis && !missingStandings && !missingBowlers
    const standingsOnlyMode = soThis && !forceThis

    if (skipAll) { console.log(`  Week ${key} already cached — skipping`); continue }
    if (forceThis) console.log(`  Week ${key} — force re-sync`)

    const [weekNum, year, seasonCode] = wk.SelectedID.split('|')

    try {
      let active = db.weeks[key]?.bowlers ?? []
      if (!standingsOnlyMode) {
        if (isCurrentWeek) {
          try { const r = await fetchCurrentWeekBowlers(year, seasonCode, weekNum); active = r.active }
          catch (err) { console.log(`  ✗ Week ${weekNum}: ${err.message}`) }
        } else if (forceThis) {
          try {
            const bowlers = extractBowlers(await fetchHtml(`${PNG_URL}/${year}/${seasonCode}/${weekNum}`))
            active = bowlers.filter(b => b.BowlerStatus === 'R')
            console.log(`  ✓ Week ${weekNum}: ${active.length} bowlers`)
          } catch { console.log(`  ℹ️  Week ${weekNum}: past-week bowler JSON unavailable`) }
        } else if (missingBowlers) {
          const fetched = await fetchPastWeekBowlersViaPlaywright(year, seasonCode, weekNum)
          if (fetched.length) active = fetched; else console.log(`  ℹ️  Week ${weekNum}: no bowler data for past week`)
        } else {
          console.log(`  ✓ Week ${weekNum}: ${active.length} bowlers (cached)`)
        }
      }

      const dateBowled = wk.DateBowled?.split('T')[0] ?? null
      console.log(`  Building standings for week ${weekNum}…`)
      const result       = await buildStandings(year, seasonCode, weekNum, active, dateBowled)
      const tmpPdf       = join(__dirname, `_wk${weekNum}.pdf`)
      try { if (existsSync(tmpPdf)) unlinkSync(tmpPdf) } catch {}
      const standings    = result?.standings ?? db.weeks[key]?.standings ?? []
      const standingsSrc = result?.source    ?? (standings.length > 0 ? 'cached' : 'none')
      if (!standings.length) console.log(`  ⚠️  No standings for week ${weekNum}`)

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

      // ── Recap PDF patch ────────────────────────────────────────────────────
      // Adds per-game scores, fixes entering averages, adds missing bowlers.
      // Place your PDF at: pdfs/wk05-2026-03-03-recap.pdf
      const recapPdfPath = findRecapPdf(weekNum)
      if (recapPdfPath) {
        console.log(`\n  📋 Applying recap PDF to week ${weekNum}…`)
        const recapSections = await parseRecapPdf(recapPdfPath)
        if (recapSections.length) {
          db.weeks[key] = patchWeekWithRecap(db.weeks[key], recapSections)
          console.log(`  ✓ Week ${weekNum} patched from recap PDF`)
        }
      }

      await new Promise(r => setTimeout(r, 1000))
    } catch (err) { console.error(`  ✗ Week ${weekNum}: ${err.message}`) }
  }

  db.meta = { ...db.meta, lastSynced: new Date().toISOString().split('T')[0], currentWeek, season }
  writeFileSync(DATA_PATH, JSON.stringify(db, null, 2))

  const weekKeys = Object.keys(db.weeks).sort((a, b) => Number(a) - Number(b))
  console.log(`\n✅  Saved → public/data.json\n    Season: ${season}  |  Weeks: ${weekKeys.join(', ')}\n`)
  for (const k of weekKeys) {
    const w   = db.weeks[k]
    const bow = w.bowlers?.length ?? 0
    const cnt = w.standings?.length ?? 0
    const src = w.standingsSrc ?? 'none'
    const tags = [w.standings?.some(t => t.unearnedPoints > 0) ? 'unearned ✓' : '', w._recapPatched ? 'recap ✓' : ''].filter(Boolean).join(', ')
    console.log(`    Wk ${k.padEnd(2)}  bowlers: ${bow}  standings: ${cnt > 0 ? `✓ ${cnt} [${src}]${tags ? ` [${tags}]` : ''}` : '✗ missing'}`)
  }
  console.log(`\nNext:  git add public/data.json && git commit -m "Week ${currentWeek}" && git push\n`)
}

main().catch(err => { console.error('\n❌ Sync failed:', err.message); process.exit(1) })
