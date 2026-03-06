import { useState, useMemo } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  Legend, ResponsiveContainer
} from 'recharts'
import { computeTeams } from '../utils/dataUtils.js'

const COLORS = [
  '#f59e0b','#3b82f6','#10b981','#f43f5e','#8b5cf6',
  '#06b6d4','#84cc16','#fb923c','#e879f9','#a3e635',
]

function EmptyState() {
  return (
    <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-10 text-center">
      <div className="text-4xl mb-3">📊</div>
      <h3 className="font-ui font-700 text-gray-300 text-lg mb-2">Trends Available After Week 2</h3>
      <p className="text-gray-500 text-sm max-w-md mx-auto">
        Run <code className="text-pin-400 bg-alley-600 px-1 rounded">node sync.js</code> each week after bowling
        to accumulate data. Trend charts will appear once 2+ weeks are stored.
      </p>
    </div>
  )
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-alley-700 border border-white/10 rounded-lg p-3 shadow-xl">
      <p className="font-ui font-700 text-gray-300 text-xs mb-2 uppercase">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 text-xs">
          <span style={{ color: p.color }}>●</span>
          <span className="text-gray-400">{p.name}:</span>
          <span className="font-mono text-gray-200">{p.value}</span>
        </div>
      ))}
    </div>
  )
}

export default function WeekTrends({ allWeeks }) {
  const [mode, setMode] = useState('teams')
  const [selectedBowlers, setSelectedBowlers] = useState([])
  const [bowlerSearch, setBowlerSearch] = useState('')

  const weekNums = Object.keys(allWeeks).map(Number).sort((a, b) => a - b)
  const hasMultipleWeeks = weekNums.length >= 2

  // All unique bowler names across weeks
  const allBowlers = useMemo(() => {
    const names = new Set()
    weekNums.forEach(w => {
      allWeeks[w].bowlers.forEach(b => { if (b.TotalGames > 0) names.add(b.BowlerName) })
    })
    return [...names].sort()
  }, [allWeeks, weekNums])

  // All team names across weeks
  const allTeamNames = useMemo(() => {
    const names = new Set()
    weekNums.forEach(w => {
      computeTeams(allWeeks[w].bowlers).forEach(t => names.add(t.TeamName))
    })
    return [...names].sort()
  }, [allWeeks, weekNums])

  // Build chart data: array of { week: 'Wk N', Team1: avg, Team2: avg... }
  const teamChartData = useMemo(() => {
    return weekNums.map(w => {
      const teams = computeTeams(allWeeks[w].bowlers)
      const pt = { week: `Wk ${w}` }
      teams.forEach(t => { pt[t.TeamName] = t.teamAvg })
      return pt
    })
  }, [allWeeks, weekNums])

  const bowlerChartData = useMemo(() => {
    if (!selectedBowlers.length) return []
    return weekNums.map(w => {
      const pt = { week: `Wk ${w}` }
      selectedBowlers.forEach(name => {
        const b = allWeeks[w].bowlers.find(x => x.BowlerName === name)
        if (b?.TotalGames > 0) pt[name] = b.Average
      })
      return pt
    })
  }, [allWeeks, weekNums, selectedBowlers])

  if (!hasMultipleWeeks) return (
    <div className="space-y-4 animate-slide-up">
      <h2 className="font-display text-2xl text-pin-400">📊 Week-over-Week Trends</h2>
      <EmptyState />
    </div>
  )

  const filteredBowlers = bowlerSearch
    ? allBowlers.filter(n => n.toLowerCase().includes(bowlerSearch.toLowerCase()))
    : allBowlers

  function toggleBowler(name) {
    setSelectedBowlers(s =>
      s.includes(name) ? s.filter(n => n !== name) : [...s, name].slice(-8)
    )
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <h2 className="font-display text-2xl text-pin-400">📊 Week-over-Week Trends</h2>

      {/* Mode toggle */}
      <div className="flex gap-2">
        {['teams', 'bowlers'].map(m => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`px-4 py-2 rounded font-ui font-700 text-sm uppercase tracking-wider transition-colors ${
              mode === m ? 'bg-pin-500 text-alley-900' : 'bg-alley-700 text-gray-400 hover:text-gray-200 border border-white/10'
            }`}
          >
            {m === 'teams' ? '🏆 Teams' : '🎳 Bowlers'}
          </button>
        ))}
      </div>

      {mode === 'teams' && (
        <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-4">
          <h3 className="font-ui font-700 text-gray-300 mb-4">Team Average Trend</h3>
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={teamChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="week" tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <YAxis domain={['auto', 'auto']} tick={{ fill: '#9ca3af', fontSize: 12 }} />
              <Tooltip content={<CustomTooltip />} />
              <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
              {allTeamNames.map((name, i) => (
                <Line
                  key={name}
                  type="monotone"
                  dataKey={name}
                  stroke={COLORS[i % COLORS.length]}
                  strokeWidth={2}
                  dot={{ r: 4 }}
                  activeDot={{ r: 6 }}
                  connectNulls
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {mode === 'bowlers' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Bowler selector */}
          <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-4">
            <h3 className="font-ui font-700 text-gray-300 mb-2 text-sm">Select Bowlers (up to 8)</h3>
            <input
              type="text"
              placeholder="Search…"
              value={bowlerSearch}
              onChange={e => setBowlerSearch(e.target.value)}
              className="w-full bg-alley-600 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 mb-2 focus:outline-none focus:border-pin-500 placeholder-gray-600"
            />
            <div className="space-y-0.5 max-h-80 overflow-y-auto">
              {filteredBowlers.map(name => (
                <label key={name} className="flex items-center gap-2 px-2 py-1 rounded cursor-pointer hover:bg-alley-600 transition-colors">
                  <input
                    type="checkbox"
                    checked={selectedBowlers.includes(name)}
                    onChange={() => toggleBowler(name)}
                    className="accent-amber-500"
                  />
                  <span className="font-ui text-xs text-gray-300">{name}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Chart */}
          <div className="md:col-span-2 bg-alley-700 rounded-lg border border-white/[0.06] p-4">
            {selectedBowlers.length === 0 ? (
              <div className="flex items-center justify-center h-60 text-gray-500 text-sm">
                Select bowlers on the left to see trends
              </div>
            ) : (
              <>
                <h3 className="font-ui font-700 text-gray-300 mb-4 text-sm">Average Trend</h3>
                <ResponsiveContainer width="100%" height={320}>
                  <LineChart data={bowlerChartData} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                    <XAxis dataKey="week" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                    <YAxis domain={['auto', 'auto']} tick={{ fill: '#9ca3af', fontSize: 12 }} />
                    <Tooltip content={<CustomTooltip />} />
                    <Legend wrapperStyle={{ color: '#9ca3af', fontSize: 12 }} />
                    {selectedBowlers.map((name, i) => (
                      <Line
                        key={name}
                        type="monotone"
                        dataKey={name}
                        stroke={COLORS[i % COLORS.length]}
                        strokeWidth={2}
                        dot={{ r: 4 }}
                        activeDot={{ r: 6 }}
                        connectNulls
                      />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
