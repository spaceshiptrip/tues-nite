import { useState, useMemo, useEffect } from 'react'
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

export default function HeadToHead({ weekData, initialTeamA = '', initialTeamB = '' }) {
  const [teamA, setTeamA] = useState(initialTeamA)
  const [teamB, setTeamB] = useState(initialTeamB)

  // Sync when pre-selected teams arrive from Schedule view
  useEffect(() => { if (initialTeamA) setTeamA(initialTeamA) }, [initialTeamA])
  useEffect(() => { if (initialTeamB) setTeamB(initialTeamB) }, [initialTeamB])

  if (!weekData) return <p className="text-gray-500">No data.</p>

  const teams = useMemo(() => {
    const raw = computeTeams(weekData.bowlers)
    // gameHcp = sum of active bowlers' per-game handicap
    return raw.map(t => ({
      ...t,
      gameHcp: t.bowlers.filter(b => b.TotalGames > 0).reduce((sum, b) => sum + (b.HandicapAfterBowling ?? 0), 0)
    }))
  }, [weekData])
  const teamNames = teams.map(t => t.TeamName).sort()

  const tA = teams.find(t => t.TeamName === teamA)
  const tB = teams.find(t => t.TeamName === teamB)

  // Pull standings rows for each team
  const stA = useMemo(() => weekData.standings?.find(s => s.teamName === teamA) ?? null, [weekData, teamA])
  const stB = useMemo(() => weekData.standings?.find(s => s.teamName === teamB) ?? null, [weekData, teamB])

  // Normalize stats 0-100 for radar
  const radarData = useMemo(() => {
    if (!tA || !tB) return []
    const normVal = (a, b) => {
      const max = Math.max(a ?? 0, b ?? 0) || 1
      return { a: Math.round(((a ?? 0) / max) * 100), b: Math.round(((b ?? 0) / max) * 100) }
    }
    return [
      { stat: 'Pts Won',     ...normVal(stA?.pointsWon,                          stB?.pointsWon) },
      { stat: 'Ser Scratch', ...normVal(stA?.scratchPins,                         stB?.scratchPins) },
      { stat: 'Ser Hcp',     ...normVal(stA?.hdcpPins,                            stB?.hdcpPins) },
      { stat: 'Hi Series',   ...normVal(stA?.highScratchSeries ?? tA.highSeries,  stB?.highScratchSeries ?? tB.highSeries) },
      { stat: 'Hi Ser Hcp',  ...normVal(tA.highHcpSeries,                         tB.highHcpSeries) },
      { stat: 'Game Hcp',    ...normVal(tA.gameHcp,                               tB.gameHcp) },
    ]
  }, [tA, tB, stA, stB])

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
            <StatRow label="Points Won"          aVal={stA?.pointsWon}    bVal={stB?.pointsWon} />
            <StatRow label="Points Lost"         aVal={stA?.pointsLost}   bVal={stB?.pointsLost}   higherIsBetter={false} />
            <StatRow label="Game Hcp"            aVal={tA.gameHcp}        bVal={tB.gameHcp} />
            <StatRow label="Game Avg Scratch"    aVal={stA?.teamAverage ?? null}   bVal={stB?.teamAverage ?? null} />
            <StatRow label="Game Avg w/ Hcp"     aVal={stA ? Math.round(stA.teamAverage + tA.gameHcp) : null}
                                                 bVal={stB ? Math.round(stB.teamAverage + tB.gameHcp) : null} />
            <StatRow label="Series Avg Scratch"  aVal={stA ? Math.round(stA.teamAverage * 3) : null}
                                                 bVal={stB ? Math.round(stB.teamAverage * 3) : null} />
            <StatRow label="Series Avg w/ Hcp"   aVal={stA ? Math.round(stA.teamAverage * 3 + tA.gameHcp * 3) : null}
                                                 bVal={stB ? Math.round(stB.teamAverage * 3 + tB.gameHcp * 3) : null} />
            <StatRow label="Hi Series Scratch"   aVal={stA?.highScratchSeries ?? tA.highSeries}   bVal={stB?.highScratchSeries ?? tB.highSeries} />
            <StatRow label="Hi Series w/ Hcp"    aVal={tA.highHcpSeries}  bVal={tB.highHcpSeries} />
            <StatRow label="Total Pins Scratch"  aVal={stA?.scratchPins ?? tA.totalPins}   bVal={stB?.scratchPins ?? tB.totalPins} />
            <StatRow label="Total Pins w/ Hcp"   aVal={stA?.hdcpPins}     bVal={stB?.hdcpPins} />
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
                <h4 className={`font-ui font-800 ${color} uppercase tracking-wider text-sm mb-2`}>{team.TeamName} Roster</h4>
                <div className="grid grid-cols-5 text-xs text-zinc-600 uppercase tracking-wider pb-1 border-b border-white/[0.06] mb-1 gap-1">
                  <span className="col-span-2">Name</span>
                  <span className="text-center">Avg</span>
                  <span className="text-center">Hcp</span>
                  <span className="text-right">Avg+Hcp</span>
                </div>
                {[...team.bowlers]
                  .filter(b => b.TotalGames > 0)
                  .sort((a, b) => b.Average - a.Average)
                  .map(b => (
                    <div key={b.BowlerID} className="grid grid-cols-5 items-center py-1.5 border-b border-white/[0.04] last:border-0 text-xs gap-1">
                      <span className="font-ui text-gray-300 truncate col-span-2">{b.BowlerName.includes(',') ? b.BowlerName.split(', ').reverse().join(' ') : b.BowlerName}</span>
                      <span className="font-mono text-center text-gray-300 font-bold">{b.Average}</span>
                      <span className="font-mono text-center text-blue-400">+{b.HandicapAfterBowling}</span>
                      <span className="font-mono text-right text-zinc-300">{b.Average + (b.HandicapAfterBowling ?? 0)}</span>
                    </div>
                  ))}
                {(() => {
                  const active = team.bowlers.filter(b => b.TotalGames > 0)
                  const sumAvg = active.reduce((s, b) => s + (b.Average ?? 0), 0)
                  const sumAvgHcp = active.reduce((s, b) => s + (b.Average ?? 0) + (b.HandicapAfterBowling ?? 0), 0)
                  const sumHcp = active.reduce((s, b) => s + (b.HandicapAfterBowling ?? 0), 0)
                  return (
                    <div className="mt-2 pt-2 border-t border-white/[0.06] grid grid-cols-5 text-xs gap-1">
                      <span className="col-span-2 text-zinc-500 uppercase tracking-wider">Team Total</span>
                      <span className="font-mono text-center text-gray-400">{sumAvg}</span>
                      <span className="font-mono text-center text-blue-400">+{sumHcp}</span>
                      <span className="font-mono text-right text-zinc-300">{sumAvgHcp}</span>
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
