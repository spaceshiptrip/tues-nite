// src/utils/dataUtils.js

// ── Position helpers ──────────────────────────────────────────────────────────

/**
 * Returns true if this bowler is a registered roster member (pos 1–4).
 * Falls back gracefully for old data that doesn't have BowlerPosition.
 */
export function isRosterBowler(b) {
  const pos = Number(b.BowlerPosition ?? 0)
  if (pos > 0) return pos >= 1 && pos <= 4
  // Legacy fallback: Status=R and assigned to a team
  return b.BowlerStatus === 'R' && Number(b.TeamNum ?? 0) > 0
}

/**
 * Returns true if this bowler is a sub who has bowled for this team (pos ≥ 5).
 */
export function isSubBowler(b) {
  return Number(b.BowlerPosition ?? 0) >= 5
}

// ── computeTeams ──────────────────────────────────────────────────────────────

/**
 * Group bowlers by team and compute team-level stats.
 * Team averages and handicap totals use ONLY roster bowlers (pos 1–4).
 * Subs are included in t.bowlers but flagged with _isSub = true.
 */
export function computeTeams(bowlers) {
  const map = {}

  for (const b of bowlers) {
    if (!b.TeamName || b.TeamName === 'BYE') continue
    if (Number(b.TeamNum ?? 0) === 0) continue // unassigned pool subs

    if (!map[b.TeamName]) {
      map[b.TeamName] = {
        TeamName: b.TeamName,
        TeamID:   b.TeamID,
        TeamNum:  Number(b.TeamNum),
        bowlers:  [],
      }
    }

    map[b.TeamName].bowlers.push({
      ...b,
      _isSub: isSubBowler(b),
    })
  }

  return Object.values(map).map(t => {
    // Sort: pos 1 → 2 → 3 → 4 → subs (5+) → unknown (0)
    t.bowlers.sort((a, b) => {
      const pa = Number(a.BowlerPosition ?? 99)
      const pb = Number(b.BowlerPosition ?? 99)
      if (pa === 0 && pb !== 0) return 1
      if (pb === 0 && pa !== 0) return -1
      return pa - pb
    })

    // Stats use only active roster bowlers
    const rosterActive = t.bowlers.filter(b => !b._isSub && b.TotalGames > 0)

    const teamAvg = rosterActive.length
      ? Math.round(rosterActive.reduce((s, b) => s + (b.Average ?? 0), 0) / rosterActive.length)
      : 0

    const highSeries = rosterActive.length
      ? Math.max(...rosterActive.map(b => b.HighScratchSeries ?? 0))
      : 0

    const totalPins = rosterActive.reduce((s, b) => s + (b.TotalPins ?? 0), 0)

    // Per-game team handicap = sum of active roster bowlers' individual handicaps
    const gameHcp = rosterActive.reduce((s, b) => s + (b.HandicapAfterBowling ?? 0), 0)

    return { ...t, teamAvg, highSeries, totalPins, gameHcp }
  })
}

// ── getSuperstars ─────────────────────────────────────────────────────────────

/**
 * Returns top-N bowlers in each category.
 * Includes all bowlers (roster + subs) — subs can legitimately post high scores.
 */
export function getSuperstars(bowlers, n = 5) {
  const active = bowlers.filter(b => b.TotalGames > 0)

  const top = (arr, key) =>
    [...arr]
      .filter(b => (b[key] ?? 0) > 0)
      .sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0))
      .slice(0, n)

  const mostImproved = [...active]
    .filter(b => b.EnteringAverage > 0)
    .map(b => ({ ...b, MostImproved: b.Average - b.EnteringAverage }))
    .filter(b => b.MostImproved > 0)
    .sort((a, b) => b.MostImproved - a.MostImproved)
    .slice(0, n)

  return {
    highScratchGame:   top(active, 'HighScratchGame'),
    highScratchSeries: top(active, 'HighScratchSeries'),
    highHandicapGame:  top(active, 'HighHandicapGame'),
    highHandicapSeries:top(active, 'HighHandicapSeries'),
    mostImproved,
  }
}
