import { getSuperstars } from '../utils/dataUtils.js'

function PodiumCard({ title, emoji, bowlers, statKey, statLabel }) {
  return (
    <div className="bg-alley-700 rounded-lg border border-white/[0.06] overflow-hidden">
      {/* Header */}
      <div className="bg-alley-600 px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
        <span className="text-xl">{emoji}</span>
        <h3 className="font-ui font-800 text-pin-400 uppercase tracking-wider text-sm">{title}</h3>
      </div>

      <div className="divide-y divide-white/[0.04]">
        {bowlers.map((b, i) => {
          const rank = i + 1
          const isTop = rank === 1
          return (
            <div
              key={b.BowlerID}
              className={`flex items-center justify-between px-4 py-3 transition-colors hover:bg-white/[0.02] ${isTop ? 'bg-amber-900/10' : ''}`}
            >
              <div className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-display text-sm ${
                  rank === 1 ? 'bg-amber-500 text-alley-900' :
                  rank === 2 ? 'bg-gray-400 text-alley-900' :
                  rank === 3 ? 'bg-amber-700 text-alley-900' :
                  'bg-alley-500 text-gray-400'
                }`}>
                  {rank === 1 ? '1' : rank === 2 ? '2' : rank === 3 ? '3' : rank}
                </div>
                <div>
                  <div className={`font-ui font-700 ${isTop ? 'text-gray-100 text-base' : 'text-gray-300 text-sm'}`}>
                    {b.BowlerName}
                  </div>
                  <div className="font-ui text-xs text-gray-600">{b.TeamName}</div>
                </div>
              </div>
              <div className="text-right">
                <div className={`font-mono font-bold ${isTop ? 'text-pin-400 text-2xl' : 'text-gray-300 text-lg'}`}>
                  {b[statKey]}
                </div>
                <div className="font-ui text-xs text-gray-600">{statLabel}</div>
              </div>
            </div>
          )
        })}
        {bowlers.length === 0 && (
          <p className="text-gray-600 text-sm px-4 py-6 text-center">No data yet.</p>
        )}
      </div>
    </div>
  )
}

export default function Superstars({ weekData }) {
  if (!weekData) return <p className="text-gray-500">No data.</p>

  const stars = getSuperstars(weekData.bowlers)

  return (
    <div className="space-y-4 animate-slide-up">
      <div className="flex items-center justify-between">
        <h2 className="font-display text-2xl text-pin-400">⭐ Superstars</h2>
        <span className="badge badge-gold">Week {weekData.weekNum} · {weekData.dateBowled}</span>
      </div>

      <p className="text-gray-500 text-sm">Season-high performances through this week.</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PodiumCard
          title="Strike King — High Game"
          emoji="🎯"
          bowlers={stars.highScratchGame}
          statKey="HighScratchGame"
          statLabel="scratch game"
        />
        <PodiumCard
          title="Series Sultan"
          emoji="👑"
          bowlers={stars.highScratchSeries}
          statKey="HighScratchSeries"
          statLabel="3-game scratch"
        />
        <PodiumCard
          title="Handicap Hero — High Game"
          emoji="🎖️"
          bowlers={stars.highHandicapGame}
          statKey="HighHandicapGame"
          statLabel="handicap game"
        />
        <PodiumCard
          title="Handicap Hero — High Series"
          emoji="🏅"
          bowlers={stars.highHandicapSeries}
          statKey="HighHandicapSeries"
          statLabel="3-game handicap"
        />
      </div>

      {/* Comeback Kid — Most Improved */}
      <div className="bg-alley-700 rounded-lg border border-white/[0.06] overflow-hidden mt-2">
        <div className="bg-alley-600 px-4 py-3 border-b border-white/[0.06] flex items-center gap-2">
          <span className="text-xl">📈</span>
          <h3 className="font-ui font-800 text-pin-400 uppercase tracking-wider text-sm">
            Comeback Kids — Above Entering Average
          </h3>
        </div>
        <div className="divide-y divide-white/[0.04]">
          {stars.mostImproved.length === 0 && (
            <p className="text-gray-600 text-sm px-4 py-6 text-center">No bowlers currently above entering average.</p>
          )}
          {stars.mostImproved.map((b, i) => (
            <div key={b.BowlerID} className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-3">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center font-display text-sm ${
                  i === 0 ? 'bg-green-500 text-alley-900' : 'bg-alley-500 text-gray-400'
                }`}>{i + 1}</div>
                <div>
                  <div className="font-ui font-700 text-gray-200 text-sm">{b.BowlerName}</div>
                  <div className="font-ui text-xs text-gray-600">{b.TeamName}</div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-right">
                <div>
                  <div className="font-mono text-green-400 font-bold text-lg">+{b.MostImproved}</div>
                  <div className="font-ui text-xs text-gray-600">improvement</div>
                </div>
                <div>
                  <div className="font-mono text-gray-300">{b.Average}</div>
                  <div className="font-ui text-xs text-gray-600">current avg</div>
                </div>
                <div>
                  <div className="font-mono text-gray-600">{b.EnteringAverage}</div>
                  <div className="font-ui text-xs text-gray-600">entering avg</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
