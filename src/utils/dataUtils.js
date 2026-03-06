// Compute team summaries from a bowler array
export function computeTeams(bowlers) {
  const map = {}
  for (const b of bowlers) {
    if (!b.TeamID || b.TeamID === 0 || b.TeamName === 'BYE') continue
    if (!map[b.TeamID]) {
      map[b.TeamID] = {
        TeamID: b.TeamID,
        TeamName: b.TeamName,
        bowlers: [],
      }
    }
    map[b.TeamID].bowlers.push(b)
  }

  return Object.values(map).map(t => {
    const active = t.bowlers.filter(b => b.TotalGames > 0)
    const teamAvg = active.length
      ? Math.round(active.reduce((s, b) => s + b.Average, 0) / active.length)
      : 0
    const highGame = Math.max(0, ...t.bowlers.map(b => b.HighScratchGame))
    const highSeries = Math.max(0, ...t.bowlers.map(b => b.HighScratchSeries))
    const highHcpGame = Math.max(0, ...t.bowlers.map(b => b.HighHandicapGame))
    const highHcpSeries = Math.max(0, ...t.bowlers.map(b => b.HighHandicapSeries))
    const totalPins = t.bowlers.reduce((s, b) => s + b.TotalPins, 0)
    const totalGames = t.bowlers.reduce((s, b) => s + b.TotalGames, 0)
    return { ...t, teamAvg, highGame, highSeries, highHcpGame, highHcpSeries, totalPins, totalGames }
  })
}

// Get superstars for the week
export function getSuperstars(bowlers) {
  const active = bowlers.filter(b => b.TotalGames > 0)
  const top = (arr, key, n = 5) =>
    [...arr].sort((a, b) => b[key] - a[key]).slice(0, n)

  return {
    highScratchGame: top(active, 'HighScratchGame'),
    highScratchSeries: top(active, 'HighScratchSeries'),
    highHandicapGame: top(active, 'HighHandicapGame'),
    highHandicapSeries: top(active, 'HighHandicapSeries'),
    mostImproved: [...active]
      .filter(b => b.MostImproved > 0)
      .sort((a, b) => b.MostImproved - a.MostImproved)
      .slice(0, 5),
  }
}

// Build week-over-week trend data for a bowler
export function buildTrend(bowlerName, weeks) {
  return Object.values(weeks)
    .sort((a, b) => a.weekNum - b.weekNum)
    .map(w => {
      const b = w.bowlers.find(x => x.BowlerName === bowlerName)
      return b ? { week: `Wk ${w.weekNum}`, avg: b.Average, date: w.dateBowled } : null
    })
    .filter(Boolean)
}

// Build team average trend across weeks
export function buildTeamTrend(teams, weeks) {
  return teams.map(teamName => ({
    name: teamName,
    data: Object.values(weeks)
      .sort((a, b) => a.weekNum - b.weekNum)
      .map(w => {
        const wTeams = computeTeams(w.bowlers)
        const t = wTeams.find(x => x.TeamName === teamName)
        return { week: `Wk ${w.weekNum}`, avg: t?.teamAvg ?? null }
      })
      .filter(d => d.avg !== null),
  }))
}

export function improvement(b) {
  if (!b.EnteringAverage) return null
  return b.Average - b.EnteringAverage
}

export function fmt(n) {
  if (n === null || n === undefined || n === 0) return '—'
  return n
}
