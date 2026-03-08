// src/views/Schedule.jsx
import { useState } from "react";

const LANE_PAIRS = ["1–2","3–4","5–6","7–8","9–10","11–12","13–14","15–16"];

const TEAMS = {
  1:  "Team Won",
  2:  "Team 2",
  3:  "Team 3",
  4:  "Social Butterflies",
  5:  "Team 5",
  6:  "Team 6",
  7:  "Team 7",
  8:  "Fill Donahue",
  9:  "Team 9",
  10: "Chips Gutter Crew",
  11: "Lumber Liquidators",
  12: "Mostly Moser",
  13: "Team 13",
  14: "Team 14",
  15: "Team 15",
  16: "F-ING 10 PIN",
};

// Complete verified schedule — extracted directly from the official PDF.
const SCHEDULE = [
  { week:1,  date:"2026-02-03", matchups:[[1,2],[3,4],[5,6],[7,8],[9,10],[11,12],[13,14],[15,16]] },
  { week:2,  date:"2026-02-10", matchups:[[13,12],[6,15],[8,3],[10,5],[11,7],[9,2],[1,16],[4,14]] },
  { week:3,  date:"2026-02-17", matchups:[[9,16],[8,14],[15,10],[11,3],[5,2],[7,13],[4,12],[1,6]] },
  { week:4,  date:"2026-02-24", matchups:[[7,4],[1,10],[14,11],[15,2],[3,13],[16,5],[6,9],[12,8]] },
  { week:5,  date:"2026-03-03", matchups:[[8,5],[2,12],[13,1],[14,16],[15,4],[6,3],[10,7],[9,11]] },
  { week:6,  date:"2026-03-10", matchups:[[10,3],[9,13],[12,16],[4,1],[6,14],[15,8],[5,11],[2,7]] },
  { week:7,  date:"2026-03-17", matchups:[[15,11],[7,16],[4,9],[12,6],[8,1],[10,14],[3,2],[13,5]] },
  { week:8,  date:"2026-03-24", matchups:[[6,7],[11,1],[2,14],[8,9],[10,12],[5,4],[15,13],[16,3]] },
  { week:9,  date:"2026-03-31", matchups:[[4,13],[15,3],[11,8],[1,14],[2,16],[12,9],[7,5],[6,10]] },
  { week:10, date:"2026-04-07", matchups:[[12,1],[10,8],[3,5],[2,4],[14,9],[13,16],[11,6],[7,15]] },
  { week:11, date:"2026-04-14", matchups:[[11,10],[13,2],[16,4],[5,15],[7,3],[8,6],[9,1],[14,12]] },
  { week:12, date:"2026-04-21", matchups:[[2,6],[4,11],[9,15],[3,12],[13,8],[14,7],[16,10],[5,1]] },
  { week:13, date:"2026-04-28", matchups:[[5,9],[12,7],[6,13],[16,11],[1,15],[4,10],[14,3],[8,2]] },
  { week:14, date:"2026-05-05", matchups:[[14,15],[16,6],[1,7],[13,10],[12,5],[2,11],[8,4],[3,9]] },
  { week:15, date:"2026-05-12", matchups:[[16,8],[14,5],[10,2],[9,7],[4,6],[3,1],[12,15],[11,13]] },
  { week:16, date:"2026-05-19", matchups:[[4,3],[12,11],[14,13],[16,15],[2,1],[8,7],[10,9],[6,5]] },
  { week:17, date:"2026-05-26", matchups:[[15,6],[2,9],[16,1],[14,4],[12,13],[5,10],[7,11],[3,8]] },
  { week:18, date:"2026-06-02", matchups:[[14,8],[13,7],[12,4],[6,1],[16,9],[3,11],[2,5],[10,15]] },
  { week:19, date:"2026-06-09", matchups:[[10,1],[5,16],[9,6],[8,12],[4,7],[2,15],[13,3],[11,14]] },
  { week:20, date:"2026-06-16", matchups:null, special:"Position Round \u2014 Start Lane 1" },
  { week:21, date:"2026-06-23", matchups:null, special:"Fun Night! \u2014 Start Lane 1 \u00b7 No Points" },
];

function formatDate(dateStr) {
  const d = new Date(dateStr + "T12:00:00");
  return d.toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" });
}

function getActiveWeekNum(schedule) {
  const today = new Date();
  // Show the next upcoming week — the first week whose date is in the future
  const next = schedule.find(w => new Date(w.date + "T23:59:59") > today);
  if (next) return next.week;
  // All weeks have passed — show the last one
  return schedule[schedule.length - 1].week;
}

function MatchupCard({ t1, t2, laneLabel, isCurrentWeek, onClick }) {
  return (
    <div
      onClick={onClick}
      title="View Head-to-Head"
      className={`flex flex-col gap-1 rounded-lg px-3 py-2.5 cursor-pointer transition-all ${
        isCurrentWeek
          ? "bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 hover:border-amber-400 hover:shadow-lg hover:shadow-amber-500/10"
          : "bg-zinc-800/70 border border-zinc-700/50 hover:bg-zinc-700/60 hover:border-zinc-500"
      }`}
    >
      <div className="flex items-center justify-between mb-1">
        <div
          className={`text-sm font-black tracking-widest ${isCurrentWeek ? "text-amber-500" : "text-zinc-300"}`}
          style={{ fontFamily: "'Share Tech Mono', monospace" }}
        >
          LANES {laneLabel}
        </div>
        <div className="text-xs text-zinc-600 group-hover:text-zinc-400">⚔️</div>
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <div className={`text-sm font-black truncate ${isCurrentWeek ? "text-amber-300" : "text-zinc-100"}`}
            style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "0.95rem" }}>
            {TEAMS[t1] ?? `Team ${t1}`}
          </div>
          <div className="text-xs text-zinc-500 font-semibold">#{t1}</div>
        </div>
        <div className={`text-xs font-black shrink-0 ${isCurrentWeek ? "text-amber-600" : "text-zinc-500"}`}
          style={{ fontFamily: "'Share Tech Mono', monospace" }}>VS</div>
        <div className="flex-1 min-w-0 text-right">
          <div className={`text-sm font-black truncate ${isCurrentWeek ? "text-amber-300" : "text-zinc-100"}`}
            style={{ fontFamily: "'Barlow Condensed', sans-serif", fontSize: "0.95rem" }}>
            {TEAMS[t2] ?? `Team ${t2}`}
          </div>
          <div className="text-xs text-zinc-500 font-semibold text-right">#{t2}</div>
        </div>
      </div>
    </div>
  );
}

export default function Schedule({ schedule: scheduleProp, onMatchupClick }) {
  // Use live data from data.json if synced, otherwise use the hardcoded verified schedule
  const schedule = (scheduleProp?.length >= 19) ? scheduleProp : SCHEDULE;

  // Always derive from today's date — never trust meta.currentWeek which reflects
  // the last synced week, not the next upcoming bowling night.
  const activeWeekNum = getActiveWeekNum(schedule);
  const [sel, setSel] = useState(activeWeekNum);
  const today = new Date();
  const selected = schedule.find(w => w.week === sel) ?? schedule[0];

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2
            className="text-3xl text-amber-400 leading-none"
            style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.06em" }}
          >
            Season Schedule
          </h2>
          <p className="text-xs text-zinc-500 mt-0.5">
            Spring 2026 &middot; 21 Weeks &middot; Pinz Bowling Center &middot; Lanes 1&ndash;16
          </p>
        </div>
        <div className="text-right">
          <div className="text-xs text-zinc-500">Tuesdays &middot; 8:00 pm</div>
          <div className="text-xs text-zinc-600">Feb &ndash; Jun 2026</div>
        </div>
      </div>

      {/* Week pill selector */}
      <div className="flex gap-1.5 overflow-x-auto pb-1"
        style={{ msOverflowStyle:"none", scrollbarWidth:"none" }}>
        {schedule.map(wk => {
          const isPast = new Date(wk.date + "T23:59:59") < today;
          const isCurrent = wk.week === activeWeekNum;
          const isSelected = wk.week === sel;
          return (
            <button
              key={wk.week}
              onClick={() => setSel(wk.week)}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-bold transition-all ${
                isSelected
                  ? "bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                  : isCurrent
                  ? "bg-amber-500/20 text-amber-300 border border-amber-500/50"
                  : isPast
                  ? "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-500"
                  : "bg-zinc-900 text-zinc-500 border border-zinc-800 hover:border-zinc-600 hover:text-zinc-400"
              }`}
              style={{ fontFamily: "'Share Tech Mono', monospace" }}
            >
              Wk{String(wk.week).padStart(2, "0")}
            </button>
          );
        })}
      </div>

      {/* Selected week detail */}
      {selected && (
        <div className={`rounded-xl border-2 p-4 space-y-3 transition-all ${
          selected.week === activeWeekNum
            ? "border-amber-500 bg-zinc-800/80"
            : "border-zinc-700 bg-zinc-900/60"
        }`}>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <div
                className={`text-4xl font-black leading-none ${selected.week === activeWeekNum ? "text-amber-400" : "text-zinc-300"}`}
                style={{ fontFamily: "'Bebas Neue', sans-serif" }}
              >
                Week {selected.week}
              </div>
              <div>
                <div className="text-sm font-semibold text-zinc-200">{formatDate(selected.date)}</div>
                <div className="text-xs text-zinc-500" style={{ fontFamily: "'Share Tech Mono', monospace" }}>
                  {selected.date.replace(/-/g,"/")} &middot; 8:00 PM
                </div>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              {selected.week === activeWeekNum && (
                <span className="bg-amber-500 text-black text-xs font-bold px-2.5 py-1 rounded-full">NEXT UP</span>
              )}
              {new Date(selected.date + "T23:59:59") < today && selected.week !== activeWeekNum && (
                <span className="bg-zinc-700 text-zinc-400 text-xs px-2.5 py-1 rounded-full">Completed</span>
              )}
              {new Date(selected.date + "T23:59:59") > today && selected.week !== activeWeekNum && (
                <span className="bg-zinc-800 text-zinc-500 text-xs px-2.5 py-1 rounded-full border border-zinc-700">Upcoming</span>
              )}
            </div>
          </div>

          {selected.special && (
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 px-4 py-5 text-center">
              <div className="text-3xl mb-2">&#x1F3B3;</div>
              <div className="text-amber-300 font-bold text-xl"
                style={{ fontFamily: "'Bebas Neue', sans-serif", letterSpacing: "0.05em" }}>
                {selected.special}
              </div>
            </div>
          )}

          {selected.matchups && (
            <>
              <p className="text-xs text-zinc-600 text-right -mb-1">tap a matchup to compare ⚔️</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {selected.matchups.map(([t1, t2], i) => (
                  <MatchupCard
                    key={i}
                    t1={t1}
                    t2={t2}
                    laneLabel={LANE_PAIRS[i]}
                    isCurrentWeek={selected.week === activeWeekNum}
                    onClick={() => onMatchupClick(TEAMS[t1] ?? `Team ${t1}`, TEAMS[t2] ?? `Team ${t2}`)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Full season table */}
      <div>
        <h3 className="text-xs font-bold text-zinc-500 uppercase tracking-widest mb-2"
          style={{ fontFamily: "'Barlow Condensed', sans-serif" }}>
          Full Season
        </h3>
        <div className="rounded-xl border border-zinc-800 overflow-hidden overflow-x-auto">
          <table className="w-full text-xs whitespace-nowrap">
            <thead>
              <tr className="bg-zinc-800/80">
                <th className="text-left px-3 py-2 text-zinc-500 font-bold tracking-widest"
                  style={{ fontFamily: "'Share Tech Mono', monospace" }}>WK</th>
                <th className="text-left px-3 py-2 text-zinc-500 font-bold">DATE</th>
                {LANE_PAIRS.map(lp => (
                  <th key={lp} className="text-left px-3 py-2 text-zinc-600 font-bold">{lp}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {schedule.map(wk => {
                const isPast = new Date(wk.date + "T23:59:59") < today;
                const isCurrent = wk.week === activeWeekNum;
                const isSelected = wk.week === sel;
                return (
                  <tr key={wk.week} onClick={() => setSel(wk.week)}
                    className={`border-t border-zinc-800 cursor-pointer transition-colors ${
                      isSelected ? "bg-amber-500/10"
                      : isCurrent ? "bg-amber-500/5 hover:bg-amber-500/10"
                      : "hover:bg-zinc-800/40"
                    }`}>
                    <td className="px-3 py-2" style={{ fontFamily: "'Share Tech Mono', monospace" }}>
                      <span className={`font-bold ${isCurrent ? "text-amber-400" : isPast ? "text-zinc-500" : "text-zinc-400"}`}>
                        {String(wk.week).padStart(2,"0")}
                        {isCurrent && <span className="ml-1 text-amber-500">&#x25C0;</span>}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-zinc-400">{formatDate(wk.date)}</td>
                    {wk.matchups
                      ? wk.matchups.map(([t1, t2], i) => (
                          <td key={i} className="px-3 py-2">
                            <span className={isPast ? "text-zinc-600" : "text-zinc-400"}>
                              #{t1} <span className="text-zinc-700">v</span> #{t2}
                            </span>
                          </td>
                        ))
                      : <td colSpan={8} className="px-3 py-2 text-amber-600/60 italic">
                          {wk.special ?? "\u2014"}
                        </td>
                    }
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
