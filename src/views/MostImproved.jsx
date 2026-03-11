import { useState, useMemo } from 'react'
import { isSubBowler } from '../utils/dataUtils.js'

function SubBadge() {
  return (
    <span
      title="Substitute bowler"
      className="px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-orange-900/50 text-orange-400 border border-orange-700/40"
    >
      SUB
    </span>
  )
}

export default function MostImproved({ weekData }) {
  const [tab, setTab]           = useState('gainers')
  const [includeSubs, setIncludeSubs] = useState(false)

  if (!weekData) return <p className="text-gray-500">No data.</p>

  const active = weekData.bowlers.filter(b => b.TotalGames > 0 && b.EnteringAverage > 0)
  const rosterOnly = active.filter(b => !isSubBowler(b))
  const hasAnySubs = active.some(b => isSubBowler(b))

  const pool = includeSubs ? active : rosterOnly

  const gainers = useMemo(() =>
    [...pool]
      .map(b => ({ ...b, delta: b.Average - b.EnteringAverage, _isSub: isSubBowler(b) }))
      .sort((a, b) => b.delta - a.delta),
    [pool]
  )

  const losers  = useMemo(() => [...gainers].reverse(), [gainers])
  const rows    = tab === 'gainers' ? gainers : losers

  function barWidth(delta) {
    const pct = Math.min(Math.abs(delta) / 180 * 100, 100)
    return pct
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <h2 className="font-display text-2xl text-pin-400">📈 Most Improved</h2>
      <p className="text-gray-500 text-sm">Compares current average vs. entering average for the season.</p>

      {/* Tabs + sub toggle */}
      <div className="flex flex-wrap gap-2 items-center">
        {[
          { id: 'gainers', label: '↑ Gaining',    count: gainers.filter(b => b.delta > 0).length },
          { id: 'losers',  label: '↓ Below Pace', count: gainers.filter(b => b.delta < 0).length },
        ].map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 rounded font-ui font-700 text-sm uppercase tracking-wider transition-colors ${
              tab === t.id
                ? t.id === 'gainers' ? 'bg-green-800/50 text-green-400 border border-green-600/30'
                                     : 'bg-red-900/40 text-red-400 border border-red-700/30'
                : 'bg-alley-700 text-gray-500 border border-white/10 hover:text-gray-300'
            }`}
          >
            {t.label} <span className="ml-1 badge badge-gray text-xs">{t.count}</span>
          </button>
        ))}

        {hasAnySubs && (
          <button
            onClick={() => setIncludeSubs(s => !s)}
            className={`ml-2 px-3 py-2 rounded text-xs font-ui font-700 uppercase tracking-wider transition-colors border ${
              includeSubs
                ? 'bg-orange-900/30 text-orange-400 border-orange-700/40'
                : 'bg-alley-700 text-gray-500 border-white/10 hover:text-gray-300'
            }`}
          >
            {includeSubs ? 'Subs: included' : 'Subs: excluded'}
          </button>
        )}
      </div>

      {/* List */}
      <div className="bg-alley-700 rounded-lg border border-white/[0.06] overflow-hidden">
        {rows.map((b, i) => {
          const isPos = b.delta >= 0
          const pct   = barWidth(b.delta)
          return (
            <div
              key={b.BowlerID}
              className={`border-b border-white/[0.04] last:border-0 px-4 py-3 hover:bg-white/[0.02] ${b._isSub ? 'opacity-75' : ''}`}
            >
              <div className="flex items-center gap-3">
                <span className="font-mono text-gray-600 text-xs w-6 text-right">{i + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-ui font-700 text-gray-200 text-sm">{b.BowlerName}</span>
                      {b.Gender && (
                        <span className={`text-[10px] font-bold ${b.Gender === 'W' ? 'text-pink-400' : 'text-sky-400'}`}>
                          {b.Gender}
                        </span>
                      )}
                      {b._isSub && <SubBadge />}
                      <span className="ml-1 font-ui text-xs text-gray-500">{b.TeamName}</span>
                    </div>
                    <div className="flex items-center gap-4 text-right text-xs font-mono flex-shrink-0">
                      <span className="text-gray-500">{b.EnteringAverage} enter</span>
                      <span className="text-gray-300">{b.Average} now</span>
                      <span className={`font-bold text-sm w-12 ${isPos ? 'text-green-400' : 'text-red-400'}`}>
                        {b.delta > 0 ? `+${b.delta}` : b.delta}
                      </span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-alley-600 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${isPos ? 'bg-green-500' : 'bg-red-600'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
