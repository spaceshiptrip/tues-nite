import React, { useState, useMemo } from 'react'
import { isRosterBowler, isSubBowler } from '../utils/dataUtils.js'

// GB = Games Behind = ((leader.ptsWon - team.ptsWon) + (team.ptsLost - leader.ptsLost)) / 2
function computeGB(standings) {
  const active = standings.filter(t => t.teamNum !== 16)
  if (!active.length) return {}
  const leader = [...active].sort((a, b) => b.pointsWon - a.pointsWon)[0]
  const map = {}
  for (const t of standings) {
    if (t.teamNum === 16) { map[t.teamNum] = null; continue }
    const gb = ((leader.pointsWon - t.pointsWon) + (t.pointsLost - leader.pointsLost)) / 2
    map[t.teamNum] = gb === 0 ? 0 : gb
  }
  return map
}

const SORT_COLS = [
  { key: 'place',          label: 'Place',       num: true  },
  { key: 'teamNum',        label: '#',            num: true  },
  { key: 'teamName',       label: 'Team Name',    num: false },
  { key: 'pointsWon',      label: 'Pts Won',      num: true  },
  { key: 'pointsLost',     label: 'Pts Lost',     num: true  },
  { key: 'unearnedPoints', label: 'Unearned',     num: true  },
  { key: '_gb',            label: 'GB',           num: true  },
  { key: 'pctWon',         label: '% Won',        num: true  },
  { key: 'ytdWon',         label: 'YTD Won',      num: true  },
  { key: 'ytdLost',        label: 'YTD Lost',     num: true  },
  { key: 'gamesWon',       label: 'Games Won',    num: true  },
  { key: 'scratchPins',    label: 'Scratch Pins', num: true  },
  { key: 'hdcpPins',       label: 'HDCP Pins',    num: true  },
]

function PlaceBadge({ place }) {
  if (place === 1) return <span className="text-xl">🥇</span>
  if (place === 2) return <span className="text-xl">🥈</span>
  if (place === 3) return <span className="text-xl">🥉</span>
  return <span className="font-mono text-gray-500 text-sm">{place}</span>
}

function SortArrow({ colKey, sort }) {
  if (sort.key !== colKey) return <span className="text-gray-700 ml-1">⇅</span>
  return <span className="text-pin-400 ml-1">{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

function GenderBadge({ gender }) {
  if (!gender) return null
  return (
    <span className={`text-xs font-bold ml-1 ${gender === 'W' ? 'text-pink-400' : 'text-sky-400'}`}>
      {gender}
    </span>
  )
}

function SubBadge() {
  return (
    <span
      title="Substitute bowler — not counted in team averages"
      className="ml-1.5 px-1 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-orange-900/50 text-orange-400 border border-orange-700/40"
    >
      SUB
    </span>
  )
}

function RosterPanel({ teamName, bowlers, onClose, onFullStats }) {
  // Sort: roster pos 1–4 first, then subs, each sub-sorted by position
  const sorted = [...bowlers].sort((a, b) => {
    const pa = Number(a.BowlerPosition ?? 99)
    const pb = Number(b.BowlerPosition ?? 99)
    if (pa === 0 && pb !== 0) return 1
    if (pb === 0 && pa !== 0) return -1
    return pa - pb
  })

  const active = sorted.filter(b => b.TotalGames > 0)
  const rosterActive = active.filter(b => isRosterBowler(b))
  const subsActive   = active.filter(b => isSubBowler(b))

  const teamScratchAvg = rosterActive.length
    ? Math.round(rosterActive.reduce((s, b) => s + b.Average, 0) / rosterActive.length)
    : 0
  const teamHcpAvg = rosterActive.length
    ? Math.round(rosterActive.reduce((s, b) => s + b.HandicapAfterBowling, 0) / rosterActive.length)
    : 0

  return (
    <div className="mt-1 mb-1 rounded-lg border border-pin-500/20 overflow-hidden animate-slide-up">
      <div className="flex items-center justify-between px-4 py-2 bg-alley-600 border-b border-white/[0.06]">
        <div className="flex items-center gap-3">
          <h4 className="font-ui font-800 text-pin-400 uppercase tracking-wider text-sm">
            🎳 {teamName}
          </h4>
          <span className="badge badge-gold text-xs">Scratch avg {teamScratchAvg}</span>
          <span className="badge badge-blue text-xs">Hcp avg {teamHcpAvg}</span>
          <span className="badge badge-gray text-xs">Combined {teamScratchAvg + teamHcpAvg}</span>
          {subsActive.length > 0 && (
            <span className="text-xs text-orange-400 font-ui">+{subsActive.length} sub{subsActive.length > 1 ? 's' : ''}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={onFullStats}
            className="text-xs font-ui text-gray-500 hover:text-pin-400 transition-colors border border-white/10 rounded px-2 py-0.5"
          >
            Full stats →
          </button>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg leading-none ml-1">×</button>
        </div>
      </div>

      <div className="overflow-x-auto bg-alley-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-alley-700">
              <th className="text-left px-3 py-2 font-ui text-xs text-gray-500 uppercase tracking-wider w-6">#</th>
              <th className="text-left px-3 py-2 font-ui text-xs text-gray-500 uppercase tracking-wider">Bowler</th>
              <th className="text-center px-3 py-2 font-ui text-xs text-gray-500 uppercase tracking-wider">G</th>
              <th className="text-right px-3 py-2 font-ui text-xs text-pin-500 uppercase tracking-wider">Scratch Avg</th>
              <th className="text-right px-3 py-2 font-ui text-xs text-blue-500 uppercase tracking-wider">Handicap</th>
              <th className="text-right px-3 py-2 font-ui text-xs text-green-500 uppercase tracking-wider">Avg + Hcp</th>
              <th className="text-right px-3 py-2 font-ui text-xs text-gray-500 uppercase tracking-wider">Hi Game</th>
              <th className="text-right px-3 py-2 font-ui text-xs text-gray-500 uppercase tracking-wider">Hi Series</th>
              <th className="text-right px-3 py-2 font-ui text-xs text-gray-500 uppercase tracking-wider">Hi Hcp Gm</th>
              <th className="text-right px-3 py-2 font-ui text-xs text-gray-500 uppercase tracking-wider">Hi Hcp Ser</th>
            </tr>
          </thead>
          <tbody>
            {active.map((b, i) => {
              const isSub    = isSubBowler(b)
              const combined = b.Average + (b.HandicapAfterBowling ?? 0)
              return (
                <tr
                  key={b.BowlerID}
                  className={`${i % 2 === 0 ? 'bg-alley-800' : 'bg-alley-700'} hover:bg-white/[0.03] ${isSub ? 'opacity-75' : ''}`}
                >
                  <td className="px-3 py-2 text-center font-mono text-gray-600 text-xs">
                    {isSub ? '—' : b.BowlerPosition}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-ui font-700 text-gray-200">{b.BowlerName}</span>
                      <GenderBadge gender={b.Gender} />
                      {isSub && <SubBadge />}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-center font-mono text-gray-500">{b.TotalGames}</td>
                  <td className={`px-3 py-2 text-right font-mono font-bold text-base ${isSub ? 'text-gray-400' : 'text-pin-400'}`}>
                    {b.Average}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono ${isSub ? 'text-gray-500' : 'text-blue-400'}`}>
                    {b.HandicapAfterBowling}
                  </td>
                  <td className={`px-3 py-2 text-right font-mono font-bold ${isSub ? 'text-gray-500' : 'text-green-400'}`}>
                    {combined}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">{b.HighScratchGame || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-300">{b.HighScratchSeries || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-400">{b.HighHandicapGame || '—'}</td>
                  <td className="px-3 py-2 text-right font-mono text-gray-400">{b.HighHandicapSeries || '—'}</td>
                </tr>
              )
            })}
            {active.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center text-gray-600 py-4 text-sm">No games bowled yet</td>
              </tr>
            )}
          </tbody>
          {rosterActive.length > 0 && (
            <tfoot>
              <tr className="bg-alley-600 border-t border-white/[0.08]">
                <td />
                <td className="px-3 py-2 font-ui font-700 text-gray-400 text-xs uppercase tracking-wider">
                  Roster ({rosterActive.length})
                  {subsActive.length > 0 && (
                    <span className="ml-1 text-orange-500/70">+{subsActive.length} sub</span>
                  )}
                </td>
                <td className="px-3 py-2 text-center font-mono text-gray-500 text-xs">
                  {rosterActive.reduce((s, b) => s + b.TotalGames, 0)}
                </td>
                <td className="px-3 py-2 text-right font-mono text-pin-400 font-bold">{teamScratchAvg}</td>
                <td className="px-3 py-2 text-right font-mono text-blue-400">{teamHcpAvg}</td>
                <td className="px-3 py-2 text-right font-mono text-green-400 font-bold">{teamScratchAvg + teamHcpAvg}</td>
                <td className="px-3 py-2 text-right font-mono text-gray-300">
                  {Math.max(...rosterActive.map(b => b.HighScratchGame ?? 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-300">
                  {Math.max(...rosterActive.map(b => b.HighScratchSeries ?? 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">
                  {Math.max(...rosterActive.map(b => b.HighHandicapGame ?? 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono text-gray-400">
                  {Math.max(...rosterActive.map(b => b.HighHandicapSeries ?? 0))}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  )
}

export default function TeamStandings({ weekData, onTeamClick }) {
  const [sort, setSort]           = useState({ key: 'place', dir: 'asc' })
  const [expandedTeam, setExpanded] = useState(null)

  if (!weekData) return <p className="text-gray-500">No data.</p>

  const standings = weekData.standings ?? []

  const bowlerMap = useMemo(() => {
    const m = {}
    weekData.bowlers.forEach(b => {
      if (!m[b.TeamName]) m[b.TeamName] = []
      m[b.TeamName].push(b)
    })
    return m
  }, [weekData])

  const gbMap = useMemo(() => computeGB(standings), [standings])

  const enriched = useMemo(() =>
    standings.map(t => ({ ...t, _gb: gbMap[t.teamNum] ?? null })),
    [standings, gbMap]
  )

  const sorted = useMemo(() => {
    return [...enriched].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key]
      if (av == null) av = sort.dir === 'asc' ? Infinity : -Infinity
      if (bv == null) bv = sort.dir === 'asc' ? Infinity : -Infinity
      if (typeof av === 'string') return sort.dir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
      return sort.dir === 'asc' ? av - bv : bv - av
    })
  }, [enriched, sort])

  function toggleSort(col) {
    setSort(s => ({
      key: col.key,
      dir: s.key === col.key ? (s.dir === 'asc' ? 'desc' : 'asc') : 'asc'
    }))
  }

  if (standings.length === 0) {
    return (
      <div className="space-y-3 animate-slide-up">
        <h2 className="font-display text-2xl text-pin-400">🏆 Team Standings</h2>
        <div className="bg-alley-700 rounded-lg border border-white/[0.06] p-6 text-center">
          <p className="text-gray-400 mb-2">Official standings not yet synced.</p>
          <p className="text-gray-600 text-sm">
            Run <code className="text-pin-400 bg-alley-600 px-1 rounded">node sync.js</code> to pull Points Won/Lost from LeagueSecretary.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2 animate-slide-up">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h2 className="font-display text-2xl text-pin-400">🏆 Team Standings</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Week {weekData.weekNum} · {weekData.dateBowled} · Lanes 1–16 · 8:00 PM
            <span className="mx-2 text-gray-700">·</span>
            <span className="text-gray-600">Click team name to expand roster</span>
          </p>
        </div>
        <span className="badge badge-gold">{sorted.filter(t => t.teamNum !== 16).length} teams</span>
      </div>

      <div className="rounded-lg border border-white/[0.06] overflow-auto max-h-[72vh]">
        <table className="data-table w-full">
          <thead className="sticky top-0 z-10">
            <tr>
              {SORT_COLS.map(col => (
                <th
                  key={col.key}
                  onClick={() => toggleSort(col)}
                  className={sort.key === col.key ? 'sorted' : ''}
                  style={{
                    textAlign: col.key === 'teamName' ? 'left' : 'right',
                    background: '#111116',
                    boxShadow: '0 1px 0 rgba(245,158,11,0.3)',
                  }}
                >
                  {col.label} <SortArrow colKey={col.key} sort={sort} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((t, i) => {
              const isBye      = t.teamNum === 16
              const isExpanded = expandedTeam === t.teamName
              return (
                <React.Fragment key={t.teamNum}>
                  <tr
                    className={`
                      ${i % 2 === 0 ? 'bg-alley-800' : 'bg-alley-700'}
                      ${isBye ? 'opacity-40' : ''}
                      ${isExpanded ? 'border-l-2 border-l-pin-500' : ''}
                    `}
                  >
                    <td className="text-center"><PlaceBadge place={t.place} /></td>
                    <td className="text-right font-mono text-gray-500">{t.teamNum}</td>
                    <td className="name-cell">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => !isBye && setExpanded(e => e === t.teamName ? null : t.teamName)}
                          disabled={isBye}
                          className={`font-ui font-700 text-left transition-colors ${
                            isBye
                              ? 'text-gray-600 cursor-default'
                              : isExpanded
                                ? 'text-pin-400'
                                : 'text-gray-100 hover:text-pin-400'
                          }`}
                        >
                          {isExpanded ? '▼ ' : '▶ '}{t.teamName}
                        </button>
                        {!isBye && (
                          <button
                            onClick={() => onTeamClick?.(t.teamName)}
                            title="Bowler stats view"
                            className="opacity-50 hover:opacity-100 text-xs transition-opacity"
                          >📋</button>
                        )}
                      </div>
                    </td>
                    <td className="text-right font-mono font-bold text-green-400">{t.pointsWon}</td>
                    <td className="text-right font-mono text-red-400">{t.pointsLost}</td>
                    <td className="text-right font-mono">
                      {t.unearnedPoints > 0
                        ? <span className="text-yellow-400">{t.unearnedPoints}</span>
                        : <span className="text-gray-700">—</span>}
                    </td>
                    <td className="text-right font-mono">
                      {isBye || t._gb === null ? (
                        <span className="text-gray-700">—</span>
                      ) : t._gb === 0 ? (
                        <span className="text-pin-400 font-bold">—</span>
                      ) : (
                        <span className="text-gray-300">{t._gb % 1 === 0 ? t._gb : t._gb.toFixed(1)}</span>
                      )}
                    </td>
                    <td className="text-right">
                      <span className={`font-mono text-sm font-bold ${
                        t.pctWon >= 50 ? 'text-green-400' : t.pctWon > 0 ? 'text-red-400' : 'text-gray-600'
                      }`}>
                        {t.pctWon > 0 ? `${t.pctWon}%` : '—'}
                      </span>
                    </td>
                    <td className="text-right font-mono text-gray-300">{t.ytdWon}</td>
                    <td className="text-right font-mono text-gray-500">{t.ytdLost}</td>
                    <td className="text-right font-mono text-gray-300 font-bold">{t.gamesWon}</td>
                    <td className="text-right font-mono text-gray-400">
                      {t.scratchPins > 0 ? t.scratchPins.toLocaleString() : '—'}
                    </td>
                    <td className="text-right font-mono text-gray-200">
                      {t.hdcpPins > 0 ? t.hdcpPins.toLocaleString() : '—'}
                    </td>
                  </tr>

                  {isExpanded && !isBye && (
                    <tr>
                      <td colSpan={SORT_COLS.length} className="px-3 pb-2 bg-alley-800">
                        <RosterPanel
                          teamName={t.teamName}
                          bowlers={bowlerMap[t.teamName] ?? []}
                          onClose={() => setExpanded(null)}
                          onFullStats={() => onTeamClick?.(t.teamName)}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-700 pt-1 italic">
        ▶ Click team name to expand roster inline &nbsp;·&nbsp; 📋 jumps to full bowler stats view
      </p>
    </div>
  )
}
