import { useState, useMemo } from 'react'
import { computeTeams } from '../utils/dataUtils.js'

const COLS = [
  { key: 'BowlerName',         label: 'Name',        cls: 'name-cell text-gray-100',  num: false },
  { key: 'TeamName',           label: 'Team',        cls: 'name-cell text-gray-400',  num: false },
  { key: 'Average',            label: 'Avg',         cls: 'text-pin-400 font-bold',   num: true },
  { key: 'EnteringAverage',    label: 'Enter',       cls: 'text-gray-500',            num: true },
  { key: '_improvement',       label: '+/−',         cls: '',                         num: true },
  { key: 'HandicapAfterBowling', label: 'Hcp',       cls: 'text-blue-400',            num: true },
  { key: 'HighScratchGame',    label: 'Hi Game',     cls: 'text-gray-200',            num: true },
  { key: 'HighScratchSeries',  label: 'Hi Series',   cls: 'text-gray-200',            num: true },
  { key: 'HighHandicapGame',   label: 'Hi Hcp Game', cls: 'text-gray-400',            num: true },
  { key: 'TotalGames',         label: 'Games',       cls: 'text-gray-500',            num: true },
]

function SortArrow({ col, sort }) {
  if (sort.key !== col.key) return <span className="text-gray-700 ml-1">⇅</span>
  return <span className="text-pin-400 ml-1">{sort.dir === 'asc' ? '↑' : '↓'}</span>
}

export default function BowlerTable({ weekData }) {
  const [search, setSearch] = useState('')
  const [teamFilter, setTeamFilter] = useState('ALL')
  const [sort, setSort] = useState({ key: 'Average', dir: 'desc' })
  const [genderFilter, setGenderFilter] = useState('ALL')

  if (!weekData) return <p className="text-gray-500">No data.</p>

  const bowlers = weekData.bowlers

  // Team list for filter
  const teams = useMemo(() => {
    const names = [...new Set(bowlers.filter(b => b.TeamName).map(b => b.TeamName))].sort()
    return names.filter(n => n && n !== 'BYE')
  }, [bowlers])

  const enriched = useMemo(() =>
    bowlers.map(b => ({
      ...b,
      _improvement: b.EnteringAverage ? b.Average - b.EnteringAverage : null,
    })),
    [bowlers]
  )

  const filtered = useMemo(() => {
    let rows = enriched
    if (search) {
      const q = search.toLowerCase()
      rows = rows.filter(b => b.BowlerName.toLowerCase().includes(q) || b.TeamName?.toLowerCase().includes(q))
    }
    if (teamFilter !== 'ALL') rows = rows.filter(b => b.TeamName === teamFilter)
    if (genderFilter !== 'ALL') rows = rows.filter(b => b.Gender === genderFilter)

    return [...rows].sort((a, b) => {
      let av = a[sort.key], bv = b[sort.key]
      if (av === null || av === undefined) av = -Infinity
      if (bv === null || bv === undefined) bv = -Infinity
      if (typeof av === 'string') av = av.toLowerCase()
      if (typeof bv === 'string') bv = bv.toLowerCase()
      if (av < bv) return sort.dir === 'asc' ? -1 : 1
      if (av > bv) return sort.dir === 'asc' ? 1 : -1
      return 0
    })
  }, [enriched, search, teamFilter, genderFilter, sort])

  function toggleSort(col) {
    setSort(s => s.key === col.key
      ? { key: col.key, dir: s.dir === 'desc' ? 'asc' : 'desc' }
      : { key: col.key, dir: col.num ? 'desc' : 'asc' }
    )
  }

  function impColor(v) {
    if (v === null) return 'text-gray-600'
    if (v > 0) return 'improved-pos'
    if (v < 0) return 'improved-neg'
    return 'improved-zero'
  }

  function renderCell(b, col) {
    if (col.key === '_improvement') {
      const v = b._improvement
      return <span className={impColor(v)}>{v === null ? '—' : v > 0 ? `+${v}` : v}</span>
    }
    if (col.key === 'EnteringAverage') return b.EnteringAverage || '—'
    const v = b[col.key]
    if (v === null || v === undefined || v === 0) return '—'
    return v
  }

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <h2 className="font-display text-2xl text-pin-400">Bowler Stats</h2>
        <span className="badge badge-gray">{filtered.length} bowlers</span>
      </div>

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
          onChange={e => setTeamFilter(e.target.value)}
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
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border border-white/[0.06]">
        <table className="data-table w-full">
          <thead>
            <tr>
              <th className="w-8 text-center">#</th>
              {COLS.map(col => (
                <th key={col.key} onClick={() => toggleSort(col)}>
                  {col.label}
                  <SortArrow col={col} sort={sort} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((b, i) => (
              <tr key={b.BowlerID} className={i % 2 === 0 ? 'bg-alley-800' : 'bg-alley-700'}>
                <td className="text-center text-gray-600 text-xs">{i + 1}</td>
                {COLS.map(col => (
                  <td key={col.key} className={`${col.cls} ${col.key === '_improvement' ? impColor(b._improvement) : ''}`}>
                    {renderCell(b, col)}
                  </td>
                ))}
              </tr>
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
    </div>
  )
}
