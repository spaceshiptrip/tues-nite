import { computeTeams, getSuperstars } from '../utils/dataUtils.js'

function StatCard({ label, value, sub, accent = false }) {
  return (
    <div className={`stat-card rounded-lg p-4 ${accent ? 'border-pin-500/30' : ''}`}>
      <div className="font-ui text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`font-display text-3xl ${accent ? 'text-pin-400' : 'text-gray-100'}`}>{value}</div>
      {sub && <div className="font-ui text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  )
}

function StarRow({ rank, bowler, stat, label }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`
  return (
    <div className="flex items-center justify-between py-2 border-b border-white/[0.05] last:border-0">
      <div className="flex items-center gap-2">
        <span className="text-base w-7 text-center">{medal}</span>
        <div>
          <div className="font-ui font-700 text-sm text-gray-200">{bowler.BowlerName}</div>
          <div className="font-ui text-xs text-gray-500">{bowler.TeamName}</div>
        </div>
      </div>
      <div className="text-right">
        <div className="font-mono text-pin-400 font-bold">{stat}</div>
        <div className="font-ui text-xs text-gray-600">{label}</div>
      </div>
    </div>
  )
}

export default function Dashboard({ weekData, allWeeks, meta, onNavigate }) {
  if (!weekData) return <p className="text-gray-500">No week data available.</p>

  const bowlers = weekData.bowlers
  const active  = bowlers.filter(b => b.TotalGames > 0)
  const teams   = computeTeams(bowlers)
  const stars   = getSuperstars(bowlers)
  const weeksCount = Object.keys(allWeeks).length

  const avgAvg = active.length
    ? Math.round(active.reduce((s, b) => s + b.Average, 0) / active.length)
    : 0

  const topTeam = [...teams].sort((a, b) => b.teamAvg - a.teamAvg)[0]

  const highestBowler = [...active].sort((a, b) => b.Average - a.Average)[0]

  return (
    <div className="space-y-6 animate-slide-up">
      {/* Season summary strip */}
      <div className="bg-alley-700 rounded-lg border border-white/[0.06] px-5 py-3 flex flex-wrap gap-6 items-center">
        <div>
          <span className="font-ui text-xs text-gray-500 uppercase tracking-wider">Season</span>
          <span className="ml-2 font-ui font-700 text-gray-200">{meta.season}</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div>
          <span className="font-ui text-xs text-gray-500 uppercase tracking-wider">Current Week</span>
          <span className="ml-2 font-ui font-700 text-pin-400">{meta.currentWeek}</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div>
          <span className="font-ui text-xs text-gray-500 uppercase tracking-wider">Weeks Stored</span>
          <span className="ml-2 font-ui font-700 text-gray-200">{weeksCount}</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div>
          <span className="font-ui text-xs text-gray-500 uppercase tracking-wider">Last Bowled</span>
          <span className="ml-2 font-ui font-700 text-gray-200">{weekData.dateBowled || '—'}</span>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Active Bowlers" value={active.length} sub={`of ${bowlers.length} rostered`} accent />
        <StatCard label="Teams" value={teams.length} />
        <StatCard label="League Avg" value={avgAvg} sub="pins per game" />
        <StatCard
          label="High Scratch Game"
          value={stars.highScratchGame[0]?.HighScratchGame ?? '—'}
          sub={stars.highScratchGame[0]?.BowlerName}
          accent
        />
      </div>

      {/* 3-column panels */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* High Scratch Game */}
        <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-4">
          <h3 className="font-ui font-800 text-pin-500 uppercase tracking-wider text-sm mb-3 flex items-center gap-2">
            🎯 High Game (Scratch)
          </h3>
          {stars.highScratchGame.map((b, i) => (
            <StarRow key={b.BowlerID} rank={i+1} bowler={b} stat={b.HighScratchGame} label="scratch" />
          ))}
          <button onClick={() => onNavigate('superstars')} className="mt-3 text-xs font-ui text-gray-500 hover:text-pin-400 transition-colors">
            See all superstars →
          </button>
        </div>

        {/* High Series */}
        <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-4">
          <h3 className="font-ui font-800 text-pin-500 uppercase tracking-wider text-sm mb-3 flex items-center gap-2">
            🏅 High Series (Scratch)
          </h3>
          {stars.highScratchSeries.map((b, i) => (
            <StarRow key={b.BowlerID} rank={i+1} bowler={b} stat={b.HighScratchSeries} label="3-game" />
          ))}
        </div>

        {/* Most Improved */}
        <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-4">
          <h3 className="font-ui font-800 text-pin-500 uppercase tracking-wider text-sm mb-3 flex items-center gap-2">
            📈 Most Improved
          </h3>
          {stars.mostImproved.length === 0 && (
            <p className="text-gray-500 text-sm">No bowlers currently above entering average.</p>
          )}
          {stars.mostImproved.map((b, i) => (
            <StarRow key={b.BowlerID} rank={i+1} bowler={b} stat={`+${b.MostImproved}`} label="vs entering" />
          ))}
          <button onClick={() => onNavigate('improved')} className="mt-3 text-xs font-ui text-gray-500 hover:text-pin-400 transition-colors">
            Full leaderboard →
          </button>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { id: 'teams',      emoji: '🏆', label: 'Team Standings' },
          { id: 'bowlers',    emoji: '🎳', label: 'Bowler Stats' },
          { id: 'trends',     emoji: '📊', label: 'Week Trends' },
          { id: 'h2h',        emoji: '⚔️',  label: 'Head-to-Head' },
        ].map(({ id, emoji, label }) => (
          <button
            key={id}
            onClick={() => onNavigate(id)}
            className="bg-alley-700 hover:bg-alley-600 border border-white/[0.06] hover:border-pin-500/30 rounded-lg p-4 text-center transition-all group"
          >
            <div className="text-2xl mb-1">{emoji}</div>
            <div className="font-ui font-700 text-sm text-gray-400 group-hover:text-gray-200 uppercase tracking-wider transition-colors">{label}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
