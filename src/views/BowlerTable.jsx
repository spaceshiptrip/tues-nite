import { useState, useMemo } from 'react'
import { isRosterBowler, isSubBowler } from '../utils/dataUtils.js'

// Pos column first so team view reads: Pos | Name | Avg | ...
const COLS = [
  { key: 'BowlerPosition',      label: 'Pos',         cls: 'text-center w-10 text-gray-400', num: true  },
  { key: 'BowlerName',           label: 'Name',        cls: 'name-cell text-gray-100',        num: false },
  { key: 'TeamName',             label: 'Team',        cls: 'name-cell text-gray-400',        num: false },
  { key: 'Average',              label: 'Avg',         cls: 'text-pin-400 font-bold',         num: true  },
  { key: 'EnteringAverage',      label: 'Enter',       cls: 'text-gray-500',                  num: true  },
  { key: '_improvement',         label: '+/−',         cls: '',                               num: true  },
  { key: 'HandicapAfterBowling', label: 'Hcp',         cls: 'text-blue-400',                  num: true  },
  { key: 'HighScratchGame',      label: 'Hi Game',     cls: 'text-gray-200',                  num: true  },
  { key: 'HighScratchSeries',    label: 'Hi Series',   cls: 'text-gray-200',                  num: true  },
  { key: 'HighHandicapGame',     label: 'Hi Hcp Game', cls: 'text-gray-400',                  num: true  },
  { key: 'TotalGames',           label: 'Games',       cls: 'text-gray-500',                  num: true  },
]

function SortArrow({ col, sort }) {
  if (sort.key !== col.key) return <span className="text-gray-700 ml-1">⇅</span>
  return <span className="text-pin-400 ml-1">{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

// Canonical sort key so roster (1–4) → subs (5+) → unassigned (0) last
function posSort(b) {
  const p = b.BowlerPosition ?? 0
  if (p === 0) return 99
  if (p >= 5) return 5
  return p
}

export default function BowlerTable({ weekData, selectedTeam }) {
  const [search, setSearch]             = useState('')
  const [teamFilter, setTeamFilter]     = useState(selectedTeam ?? 'ALL')
  const [genderFilter, setGenderFilter] = useState('ALL')
  const [showSubs, setShowSubs]         = useState(true)

  // Default: position sort when a team is pre-selected, avg otherwise
  const [sort, setSort] = useState(
    selectedTeam ? { key: 'BowlerPosition', dir: 'asc' } : { key: 'Average', dir: 'desc' }
  )

  if (!weekData) return <p className="text-gray-500">No data.</p>

  const bowlers = weekData.bowlers

  const teams = useMemo(() => {
    const names = [...new Set(bowlers.filter(b => b.TeamName).map(b => b.TeamName))].sort()
    return names.filter(n => n && n !== 'BYE')
  }, [bowlers])

  const enriched = useMemo(() =>
    bowlers.map(b => ({
      ...b,
      _isSub:       isSubBowler(b),
      _improvement: b.EnteringAverage ? b.Average - b.EnteringAverage : null,
      _posSort:     posSort(b),
    })),
    [bowlers]
  )

  const filtered = useMemo(() => {
    let rows = enriched
    if (!showSubs) rows = rows.filter(b => !b._isSub)
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(b =>
        b.BowlerName.toLowerCase().includes(q) || b.TeamName?.toLowerCase().includes(q)
      )
    }
    if (teamFilter !== 'ALL') rows = rows.filter(b => b.TeamName === teamFilter)
    if (genderFilter !== 'ALL') rows = rows.filter(b => b.Gender === genderFilter)

    return [...rows].sort((a, b) => {
      // Position column uses _posSort so subs land after roster, unknowns last
      if (sort.key === 'BowlerPosition') {
        const diff = a._posSort - b._posSort
        return sort.dir === 'asc' ? diff : -diff
      }
      let av = a[sort.key], bv = b[sort.key]
      if (av === null || av === undefined) av = -Infinity
      if (bv === null || bv === undefined) bv = -Infinity
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      if (av < bv) return sort.dir === 'asc' ? -1 : 1
      if (av > bv) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [enriched, search, teamFilter, genderFilter, sort, showSubs])

  const subCount = enriched.filter(b => b._isSub).length
  const hasPosData = enriched.some(b => (b.BowlerPosition ?? 0) > 0)

  function toggleSort(col) {
    setSort(s => s.key === col.key
      ? { key: col.key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
      : { key: col.key, dir: col.num ? 'desc' : 'asc' }
    )
  }

  // When selecting a team, auto-switch to position sort; back to avg on "All Teams"
  function handleTeamFilter(val) {
    setTeamFilter(val)
    setSort(val !== 'ALL'
      ? { key: 'BowlerPosition', dir: 'asc' }
      : { key: 'Average', dir: 'desc' }
    )
  }

  function impColor(v) {
    if (v === null) return 'text-gray-600'
    if (v > 0) return 'improved-pos'
    if (v < 0) return 'improved-neg'
    return 'improved-zero'
  }

  function renderCell(b, col) {
    if (col.key === 'BowlerPosition') {
      const p = b.BowlerPosition ?? 0
      if (p === 0) return <span className="text-gray-600 text-xs">—</span>
      if (p >= 5) return (
        <span className="inline-block px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-orange-900/50 text-orange-400 border border-orange-700/40">
          sub
        </span>
      )
      return <span className="text-gray-300 font-mono font-bold">{p}</span>
    }

    if (col.key === '_improvement') {
      const v = b._improvement
      return <span className={impColor(v)}>{v === null ? '—' : v > 0 ? `+${v}` : v}</span>
    }

    if (col.key === 'BowlerName') {
      return (
        <span className="flex items-center gap-1.5 flex-wrap">
          <span>{b.BowlerName}</span>
          {b.Gender && (
            <span className={`text-[10px] font-bold ${b.Gender === 'W' ? 'text-pink-400' : 'text-sky-400'}`}>
              {b.Gender}
            </span>
          )}
          {b._isSub && (
            <span
              title="Substitute bowler"
              className="px-1 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-orange-900/50 text-orange-400 border border-orange-700/40"
            >
              SUB
            </span>
          )}
        </span>
      )
    }

    if (col.key === 'EnteringAverage') return b.EnteringAverage || '—'
    const v = b[col.key]
    if (v === null || v === undefined || v === 0) return '—'
    return v
  }

  // Draw a thin separator between roster (pos 1–4) and subs when sorted by position asc
  function showSeparator(rows, i) {
    if (sort.key !== 'BowlerPosition' || sort.dir !== 'asc') return false
    if (i === 0) return false
    return rows[i - 1]._posSort < 5 && rows[i]._posSort >= 5
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <h2 className="font-display text-2xl text-pin-400">Bowler Stats</h2>
        <div className="flex items-center gap-2">
          <span className="badge badge-gray">{filtered.length} bowlers</span>
          {subCount > 0 && (
            <span className="badge badge-gray text-orange-400">{subCount} sub{subCount > 1 ? 's' : ''}</span>
          )}
        </div>
      </div>

      {selectedTeam && teamFilter === selectedTeam && (
        <div className="flex items-center gap-3 bg-alley-700 border border-pin-500/20 rounded-lg px-4 py-2">
          <span className="text-pin-400 font-ui font-700 text-sm">🏆 Filtered: {selectedTeam}</span>
          <button
            onClick={() => handleTeamFilter('ALL')}
            className="text-xs text-gray-500 hover:text-gray-300 border border-white/10 rounded px-2 py-0.5 transition-colors"
          >
            Show all bowlers
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-2">
        <input
          type="text"
          placeholder="Search name or team…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="bg-alley-700 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-pin-500 w-52"
        />
        <select
          value={teamFilter}
          onChange={e => handleTeamFilter(e.target.value)}
          className="bg-alley-700 border border-white/10 rounded px-3 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-pin-500"
        >
          <option value="ALL">All Teams</option>
          {teams.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <div className="flex gap-1">
          {['ALL', 'M', 'W'].map(g => (
            <button
              key={g}
              onClick={() => setGenderFilter(g)}
              className={`px-3 py-1.5 rounded text-xs font-ui font-700 uppercase tracking-wider transition-colors ${
                genderFilter === g
                  ? 'bg-pin-500 text-alley-900'
                  : 'bg-alley-700 text-gray-400 hover:text-gray-200 border border-white/10'
              }`}
            >
              {g === 'ALL' ? 'All' : g === 'M' ? 'Men' : 'Women'}
            </button>
          ))}
        </div>
        {subCount > 0 && (
          <button
            onClick={() => setShowSubs(s => !s)}
            className={`px-3 py-1.5 rounded text-xs font-ui font-700 uppercase tracking-wider transition-colors border ${
              showSubs
                ? 'bg-orange-900/30 text-orange-400 border-orange-700/40'
                : 'bg-alley-700 text-gray-500 border-white/10 hover:text-gray-300'
            }`}
          >
            {showSubs ? 'Subs: on' : 'Subs: off'}
          </button>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th className="w-8 text-center text-gray-600">#</th>
              {COLS.map(col => (
                <th key={col.key} onClick={() => toggleSort(col)} className="cursor-pointer select-none">
                  {col.label}
                  <SortArrow col={col} sort={sort} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((b, i) => (
              <>
                {showSeparator(filtered, i) && (
                  <tr key={`sep-${i}`}>
                    <td colSpan={COLS.length + 1} className="px-2 py-0">
                      <div className="border-t border-orange-700/30 my-0.5" />
                    </td>
                  </tr>
                )}
                <tr
                  key={b.BowlerID}
                  className={`${i % 2 === 0 ? 'bg-alley-800' : 'bg-alley-700'} ${b._isSub ? 'opacity-75' : ''}`}
                >
                  <td className="text-center text-gray-600 text-xs">{i + 1}</td>
                  {COLS.map(col => (
                    <td
                      key={col.key}
                      className={`${col.cls} ${col.key === '_improvement' ? impColor(b._improvement) : ''}`}
                    >
                      {renderCell(b, col)}
                    </td>
                  ))}
                </tr>
              </>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={COLS.length + 1} className="text-center text-gray-500 py-8">
                  No bowlers match your search.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Legend — only when position data is present (week 5+) */}
      {hasPosData && (
        <p className="text-xs text-gray-600">
          <span className="text-gray-500">Pos</span> — roster slot (1–4).{' '}
          <span className="text-orange-400">SUB</span> = substitute.{' '}
          <span className="text-gray-600">—</span> = not yet assigned (weeks 1–4).
        </p>
      )}
    </div>
  )
}
