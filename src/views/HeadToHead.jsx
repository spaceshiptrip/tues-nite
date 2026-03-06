import { useState, useMemo } from 'react'
import { computeTeams } from '../utils/dataUtils.js'
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer, Tooltip } from 'recharts'

function StatRow({ label, aVal, bVal, higherIsBetter = true }) {
  const aNum = typeof aVal === 'number' ? aVal : null
  const bNum = typeof bVal === 'number' ? bVal : null
  const aWins = aNum !== null && bNum !== null && (higherIsBetter ? aNum > bNum : aNum < bNum)
  const bWins = aNum !== null && bNum !== null && (higherIsBetter ? bNum > aNum : bNum < aNum)

  return (
    <div className="grid grid-cols-3 items-center py-2 border-b border-white/[0.04] last:border-0">
      <div className={`font-mono text-right pr-4 ${aWins ? 'text-pin-400 font-bold text-lg' : 'text-gray-400'}`}>
        {aVal ?? '—'}
      </div>
      <div className="text-center font-ui text-xs text-gray-500 uppercase tracking-wider">{label}</div>
      <div className={`font-mono text-left pl-4 ${bWins ? 'text-pin-400 font-bold text-lg' : 'text-gray-400'}`}>
        {bVal ?? '—'}
      </div>
    </div>
  )
}

export default function HeadToHead({ weekData }) {
  const [teamA, setTeamA] = useState('')
  const [teamB, setTeamB] = useState('')

  if (!weekData) return <p className="text-gray-500">No data.</p>

  const teams = useMemo(() => computeTeams(weekData.bowlers), [weekData])
  const teamNames = teams.map(t => t.TeamName).sort()

  const tA = teams.find(t => t.TeamName === teamA)
  const tB = teams.find(t => t.TeamName === teamB)

  // Normalize stats 0-100 for radar
  const radarData = useMemo(() => {
    if (!tA || !tB) return []
    const norm = (a, b, key) => {
      const max = Math.max(a[key], b[key]) || 1
      return { a: Math.round((a[key] / max) * 100), b: Math.round((b[key] / max) * 100) }
    }
    return [
      { stat: 'Avg',        ...norm(tA, tB, 'teamAvg') },
      { stat: 'Hi Game',    ...norm(tA, tB, 'highGame') },
      { stat: 'Hi Series',  ...norm(tA, tB, 'highSeries') },
      { stat: 'Hcp Game',   ...norm(tA, tB, 'highHcpGame') },
      { stat: 'Hcp Series', ...norm(tA, tB, 'highHcpSeries') },
      { stat: 'Pins',       ...norm(tA, tB, 'totalPins') },
    ]
  }, [tA, tB])

  return (
    <div className="space-y-4 animate-slide-up">
      <h2 className="font-display text-2xl text-pin-400">⚔️ Head-to-Head</h2>

      {/* Selectors */}
      <div className="grid grid-cols-2 gap-4">
        {[
          { label: 'Team A', val: teamA, set: setTeamA, other: teamB, color: 'text-amber-400' },
          { label: 'Team B', val: teamB, set: setTeamB, other: teamA, color: 'text-blue-400' },
        ].map(({ label, val, set, other, color }) => (
          <div key={label}>
            <label className={`font-ui font-700 text-xs uppercase tracking-wider ${color} mb-1 block`}>{label}</label>
            <select
              value={val}
              onChange={e => set(e.target.value)}
              className="w-full bg-alley-700 border border-white/10 rounded px-3 py-2 text-gray-200 font-ui focus:outline-none focus:border-pin-500"
            >
              <option value="">— Select Team —</option>
              {teamNames.filter(n => n !== other).map(n => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        ))}
      </div>

      {(!tA || !tB) && (
        <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-10 text-center text-gray-500">
          <div className="text-3xl mb-2">⚔️</div>
          <p className="font-ui">Select two teams above to compare them</p>
        </div>
      )}

      {tA && tB && (
        <>
          {/* Header */}
          <div className="grid grid-cols-3 items-center bg-alley-700 rounded-lg border border-white/[0.06] overflow-hidden">
            <div className="p-4 text-center bg-amber-900/20 border-r border-white/[0.06]">
              <div className="font-display text-2xl text-amber-400">{tA.TeamName}</div>
              <div className="font-ui text-xs text-gray-500">{tA.bowlers.filter(b=>b.TotalGames>0).length} active bowlers</div>
            </div>
            <div className="p-4 text-center">
              <div className="font-display text-4xl text-gray-600">VS</div>
            </div>
            <div className="p-4 text-center bg-blue-900/20 border-l border-white/[0.06]">
              <div className="font-display text-2xl text-blue-400">{tB.TeamName}</div>
              <div className="font-ui text-xs text-gray-500">{tB.bowlers.filter(b=>b.TotalGames>0).length} active bowlers</div>
            </div>
          </div>

          {/* Stat comparison */}
          <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-4">
            <StatRow label="Team Avg"    aVal={tA.teamAvg}      bVal={tB.teamAvg} />
            <StatRow label="Hi Game"     aVal={tA.highGame}     bVal={tB.highGame} />
            <StatRow label="Hi Series"   aVal={tA.highSeries}   bVal={tB.highSeries} />
            <StatRow label="Hcp Hi Game" aVal={tA.highHcpGame}  bVal={tB.highHcpGame} />
            <StatRow label="Hcp Series"  aVal={tA.highHcpSeries} bVal={tB.highHcpSeries} />
            <StatRow label="Total Pins"  aVal={tA.totalPins}    bVal={tB.totalPins} />
            <StatRow label="Bowlers"     aVal={tA.bowlers.length} bVal={tB.bowlers.length} />
          </div>

          {/* Radar chart */}
          <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-4">
            <h3 className="font-ui font-700 text-gray-300 mb-3 text-sm">Stat Comparison (normalized)</h3>
            <ResponsiveContainer width="100%" height={300}>
              <RadarChart data={radarData}>
                <PolarGrid stroke="#ffffff15" />
                <PolarAngleAxis dataKey="stat" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                <Radar name={tA.TeamName} dataKey="a" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.2} strokeWidth={2} />
                <Radar name={tB.TeamName} dataKey="b" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} strokeWidth={2} />
                <Tooltip contentStyle={{ background: '#1a1a20', border: '1px solid #f59e0b33', borderRadius: 6 }} />
              </RadarChart>
            </ResponsiveContainer>
            <div className="flex gap-6 justify-center mt-2">
              <div className="flex items-center gap-2"><span className="w-4 h-1 rounded bg-amber-400 inline-block"/>
                <span className="font-ui text-xs text-gray-400">{tA.TeamName}</span></div>
              <div className="flex items-center gap-2"><span className="w-4 h-1 rounded bg-blue-500 inline-block"/>
                <span className="font-ui text-xs text-gray-400">{tB.TeamName}</span></div>
            </div>
          </div>

          {/* Roster comparison */}
          <div className="grid grid-cols-2 gap-4">
            {[{ team: tA, color: 'text-amber-400', bgBorder: 'border-amber-700/30' },
              { team: tB, color: 'text-blue-400',  bgBorder: 'border-blue-700/30'  }].map(({ team, color, bgBorder }) => (
              <div key={team.TeamID} className={`bg-alley-700 rounded-lg border ${bgBorder} p-4`}>
                <h4 className={`font-ui font-800 ${color} uppercase tracking-wider text-sm mb-3`}>{team.TeamName} Roster</h4>
                {[...team.bowlers]
                  .filter(b => b.TotalGames > 0)
                  .sort((a, b) => b.Average - a.Average)
                  .map(b => (
                    <div key={b.BowlerID} className="flex justify-between py-1 border-b border-white/[0.04] last:border-0 text-xs">
                      <span className="font-ui text-gray-300">{b.BowlerName}</span>
                      <span className="font-mono text-gray-400">{b.Average} avg</span>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
