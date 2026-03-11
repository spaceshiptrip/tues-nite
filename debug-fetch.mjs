// debug-fetch.mjs — LeagueSecretary bowler list API probe
// Usage: node debug-fetch.mjs

import { chromium } from 'playwright'
import * as readline from 'readline'

import { existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
const __dirname = dirname(fileURLToPath(import.meta.url))

// ── Load .env (LS_EMAIL / LS_PASSWORD) ───────────────────────────────────────
const envPath = join(__dirname, '.env')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (m) process.env[m[1]] ??= m[2].replace(/^["\'\']|["\'\']$/g, '')
  }
}

const LEAGUE_ID  = 147337
const BASE_URL   = 'https://www.leaguesecretary.com'
const LOGIN_URL  = `${BASE_URL}/account/login`
const LIST_URL   = `${BASE_URL}/bowling-centers/pinz-bowling-center/bowling-leagues/tuesday-nite-league/bowler/list/${LEAGUE_ID}`

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()) }))
}

function askPasswordSilent(question) {
  return new Promise(resolve => {
    process.stdout.write(question)
    process.stdin.setRawMode(true)
    process.stdin.resume()
    process.stdin.setEncoding('utf8')
    let pwd = ''
    const onData = ch => {
      if (ch === '\n' || ch === '\r' || ch === '\u0003') {
        process.stdin.setRawMode(false)
        process.stdin.pause()
        process.stdin.removeListener('data', onData)
        process.stdout.write('\n')
        resolve(pwd)
      } else if (ch === '\u007f') {
        pwd = pwd.slice(0, -1)
      } else {
        pwd += ch
      }
    }
    process.stdin.on('data', onData)
  })
}

;(async () => {
  const email    = process.env.LS_EMAIL    || await ask('LS Email: ')
  const password = process.env.LS_PASSWORD || await askPasswordSilent('LS Password (silent): ')
  if (process.env.LS_EMAIL)    console.log(`Using .env email: ${email}`)
  if (process.env.LS_PASSWORD) console.log('Using .env password: [from .env]')

  console.log('\n🎳  Launching browser…')
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page    = await context.newPage()

  // ── Login ─────────────────────────────────────────────────────────────────
  console.log('🔐  Logging in…')
  await page.goto(LOGIN_URL, { waitUntil: 'networkidle' })
  await page.fill('input[name="Email"]',    email)
  await page.fill('input[name="Password"]', password)
  await page.click('button[type="submit"]')
  await page.waitForNavigation({ waitUntil: 'networkidle' }).catch(() => {})

  const cookies = await context.cookies()
  const session = cookies.find(c => c.name === '.LeagueSecretary.Session')
  if (!session) {
    console.error('❌  Login failed — no session cookie.')
    await browser.close(); process.exit(1)
  }
  console.log('✅  Logged in\n')

  // ── Paginate through all pages ────────────────────────────────────────────
  console.log('── Paginating through all pages (server returns 20/page) ──')
  const allRows = []
  let pageNum = 1

  while (true) {
    const url = `${LIST_URL}?sortCol=TeamNum&order=asc&page=${pageNum}`
    console.log(`  Fetching page ${pageNum}…`)

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

    if (pageRows.length === 0) {
      console.log(`  No rows on page ${pageNum} — done`)
      break
    }

    allRows.push(...pageRows)
    console.log(`  Page ${pageNum}: ${pageRows.length} rows  (running total: ${allRows.length})`)
    if (pageRows.length < 20) break
    pageNum++
  }

  console.log(`\n✅  Collected ${allRows.length} total bowlers\n`)

  // ── Position distribution ─────────────────────────────────────────────────
  const positions = [...new Set(allRows.map(r => r.BowlerPosition))].sort((a,b) => a-b)
  console.log('── BowlerPosition distribution ──')
  for (const pos of positions) {
    const group = allRows.filter(r => r.BowlerPosition === pos)
    const label = pos === 0 ? '(unassigned/pool)'
                : pos <= 4  ? '(roster)'
                :              '(sub on team)'
    console.log(`  Pos ${pos} ${label}: ${group.length} bowlers`)
    if (pos >= 5) {
      group.forEach(b => console.log(`    → ${b.BowlerName.padEnd(24)} Team#${b.TeamNum} ${b.TeamName} Status:${b.BowlerStatus}`))
    }
  }

  // ── Status distribution ───────────────────────────────────────────────────
  console.log('\n── BowlerStatus distribution ──')
  const statuses = [...new Set(allRows.map(r => r.BowlerStatus))].sort()
  for (const s of statuses) {
    const count = allRows.filter(r => r.BowlerStatus === s).length
    const label = s === 'R' ? '(regular)' : s === 'T' ? '(temporary/sub)' : ''
    console.log(`  ${s} ${label}: ${count}`)
  }

  // ── Team roster breakdown ─────────────────────────────────────────────────
  console.log('\n── Team rosters ──')
  const teamNums = [...new Set(allRows.filter(r => r.TeamNum > 0).map(r => r.TeamNum))].sort((a,b) => a-b)
  for (const tn of teamNums) {
    const members = allRows.filter(r => r.TeamNum === tn).sort((a,b) => a.BowlerPosition - b.BowlerPosition)
    const teamName = members[0]?.TeamName ?? ''
    const roster   = members.filter(b => b.BowlerPosition >= 1 && b.BowlerPosition <= 4)
    const subs     = members.filter(b => b.BowlerPosition >= 5)
    const rStr = roster.map(b => `[${b.BowlerPosition}]${b.BowlerName.split(',')[0].trim()} avg:${b.Average}`).join('  ')
    const sStr = subs.length ? `   SUB: ${subs.map(b => b.BowlerName.split(',')[0].trim()).join(', ')}` : ''
    console.log(`  Team ${String(tn).padEnd(2)} ${teamName.padEnd(22)} ${rStr}${sStr}`)
  }

  // ── Pool subs (Team# = 0) ─────────────────────────────────────────────────
  const pool = allRows.filter(r => r.TeamNum === 0)
  if (pool.length) {
    console.log(`\n── Unassigned pool subs (${pool.length}) ──`)
    pool.forEach(b => console.log(`  ${b.BowlerName.padEnd(24)} avg:${b.Average} hcp:${b.HandicapAfterBowling} Status:${b.BowlerStatus}`))
  }

  await browser.close()
  console.log('\n✅  Done')
})()
