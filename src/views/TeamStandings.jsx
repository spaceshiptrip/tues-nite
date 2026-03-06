import { useState, useMemo } from 'react'
import { computeTeams } from '../utils/dataUtils.js'

const SORT_OPTS = [
  { key: 'teamAvg',     label: 'Team Avg',   dir: 'desc' },
  { key: 'TeamName',    label: 'Name',        dir: 'asc'  },
  { key: 'highGame',    label: 'High Game',   dir: 'desc' },
  { key: 'highSeries',  label: 'High Series', dir: 'desc' },
]

function TeamCard({ team, rank }) {
  const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : null
  return (
    <div className="stat-card rounded-lg p-4 hover:border-pin-500/40">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {medal && <span className="text-xl">{medal}</span>}
          {!medal && <span className="font-mono text-gray-600 w-6 text-sm">#{rank}</span>}
          <div>
            <h3 className="font-ui font-800 text-gray-100 text-base leading-tight">{team.TeamName}</h3>
            <p className="font-ui text-xs text-gray-500">{team.bowlers.length} bowlers</p>
          </div>
        </div>
        <div className="text-right">
          <div className="font-display text-3xl text-pin-400">{team.teamAvg}</div>
          <div className="font-ui text-xs text-gray-600 uppercase tracking-wider">Team Avg</div>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-4 gap-2 text-center border-t border-white/[0.06] pt-3">
        {[
          { label: 'Hi Game', val: team.highGame },
          { label: 'Hi Series', val: team.highSeries },
          { label: 'Hi Hcp Game', val: team.highHcpGame },
          { label: 'Total Pins', val: team.totalPins.toLocaleString() },
        ].map(({ label, val }) => (
          <div key={label}>
            <div className="font-mono text-sm text-gray-200">{val || '—'}</div>
            <div className="font-ui text-xs text-gray-600">{label}</div>
          </div>
        ))}
      </div>

      {/* Top bowlers */}
      <div className="mt-3 space-y-1">
        {[...team.bowlers]
          .filter(b => b.TotalGames > 0)
          .sort((a, b) => b.Average - a.Average)
          .slice(0, 4)
          .map(b => (
            <div key={b.BowlerID} className="flex items-center justify-between text-xs">
              <span className="font-ui text-gray-400">{b.BowlerName}</span>
              <span className="font-mono text-gray-300">{b.Average}</span>
            </div>
          ))}
      </div>
    </div>
  )
}

export default function TeamStandings({ weekData }) {
  const [sortKey, setSortKey] = useState('teamAvg')

  if (!weekData) return <p className="text-gray-500">No data.</p>

  const teams = useMemo(() => computeTeams(weekData.bowlers), [weekData])

  const sorted = useMemo(() => {
    const opt = SORT_OPTS.find(o => o.key === sortKey) ?? SORT_OPTS[0]
    return [...teams].sort((a, b) => {
      const av = a[sortKey], bv = b[sortKey]
      if (typeof av === 'string') return opt.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return opt.dir === 'desc' ? bv - av : av - bv
    })
  }, [teams, sortKey])

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-2xl text-pin-400">Team Standings</h2>
        <p className="text-xs text-gray-600 italic">Rankings by team avg (W/L from standings sheet)</p>
      </div>

      {/* Sort controls */}
      <div className="flex flex-wrap gap-2">
        <span className="font-ui text-xs text-gray-500 uppercase tracking-wider self-center mr-1">Sort by:</span>
        {SORT_OPTS.map(opt => (
          <button
            key={opt.key}
            onClick={() => setSortKey(opt.key)}
            className={`px-3 py-1.5 rounded text-xs font-ui font-700 uppercase tracking-wider transition-colors ${
              sortKey === opt.key
                ? 'bg-pin-500 text-alley-900'
                : 'bg-alley-700 text-gray-400 hover:text-gray-200 border border-white/10'
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {/* Summary table */}
      <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th>#</th>
              <th>Team</th>
              <th>Bowlers</th>
              <th>Team Avg</th>
              <th>Hi Game</th>
              <th>Hi Series</th>
              <th>Hi Hcp Game</th>
              <th>Hi Hcp Series</th>
              <th>Total Pins</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => (
              <tr key={t.TeamID} className={i % 2 === 0 ? 'bg-alley-800' : 'bg-alley-700'}>
                <td className="text-center text-gray-600 text-xs">{i + 1}</td>
                <td className="name-cell text-gray-100 font-bold">{t.TeamName}</td>
                <td className="text-gray-400">{t.bowlers.filter(b => b.TotalGames > 0).length}</td>
                <td className="text-pin-400 font-bold">{t.teamAvg}</td>
                <td className="text-gray-200">{t.highGame || '—'}</td>
                <td className="text-gray-200">{t.highSeries || '—'}</td>
                <td className="text-gray-400">{t.highHcpGame || '—'}</td>
                <td className="text-gray-400">{t.highHcpSeries || '—'}</td>
                <td className="text-gray-500">{t.totalPins.toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
        {sorted.map((t, i) => <TeamCard key={t.TeamID} team={t} rank={i + 1} />)}
      </div>
    </div>
  )
}
