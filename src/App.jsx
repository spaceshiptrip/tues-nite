import { useState, useEffect } from "react";
import Nav from "./components/Nav.jsx";
import Dashboard from "./views/Dashboard.jsx";
import Superstars from "./views/Superstars.jsx";
import TeamStandings from "./views/TeamStandings.jsx";
import BowlerTable from "./views/BowlerTable.jsx";
import MostImproved from "./views/MostImproved.jsx";
import WeekTrends from "./views/WeekTrends.jsx";
import HeadToHead from "./views/HeadToHead.jsx";
import Schedule from "./views/Schedule";

function Spinner() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4">
      <div className="text-6xl animate-bounce">🎳</div>
      <p className="font-ui text-pin-500 text-xl tracking-widest uppercase">
        Loading league data…
      </p>
    </div>
  );
}

function ErrorScreen({ message }) {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 p-8 text-center">
      <div className="text-5xl">⚠️</div>
      <h2 className="font-display text-3xl text-red-400">Data Not Found</h2>
      <p className="text-gray-400 max-w-md">
        Could not load{" "}
        <code className="text-amber-400 bg-alley-700 px-1 rounded">
          public/data.json
        </code>
        . Run{" "}
        <code className="text-amber-400 bg-alley-700 px-1 rounded">
          node sync.js
        </code>{" "}
        first to populate league data.
      </p>
      <p className="text-gray-600 text-sm mt-2">{message}</p>
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [currentView, setCurrentView] = useState("schedule");
  const [selectedWeek, setSelectedWeek] = useState(null);
  const [selectedTeam, setSelectedTeam] = useState(null);

  useEffect(() => {
    fetch("./data.json")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((d) => {
        setData(d);
        setSelectedWeek(d.meta.currentWeek);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, []);

  if (loading) return <Spinner />;
  if (error) return <ErrorScreen message={error} />;

  const sortedWeekNums = Object.keys(data.weeks)
    .map(Number)
    .sort((a, b) => a - b);
  const weekData =
    data.weeks[String(selectedWeek)] ??
    data.weeks[String(sortedWeekNums.at(-1))];

  function navigateToTeam(teamName) {
    setSelectedTeam(teamName);
    setCurrentView("bowlers");
  }

  const viewProps = {
    data,
    weekData,
    allWeeks: data.weeks,
    meta: data.meta,
    selectedTeam,
    onTeamClick: navigateToTeam,
  };

  return (
    <div className="min-h-screen bg-alley-900 font-body">
      {/* ── Header ── */}
      <header className="lane-header px-4 py-4">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl md:text-4xl text-pin-400 leading-none tracking-wider">
              TUESDAY NITE LEAGUE
            </h1>
            <p className="font-ui font-600 text-gray-400 text-sm tracking-widest uppercase mt-0.5">
              Pinz Bowling Center · Studio City, CA
            </p>
          </div>

          <div className="flex items-center gap-3">
            {/* Week selector */}
            <div className="flex items-center gap-2">
              <label className="font-ui text-xs text-gray-500 uppercase tracking-wider">
                Week
              </label>
              <select
                value={selectedWeek ?? ""}
                onChange={(e) => setSelectedWeek(Number(e.target.value))}
                className="bg-alley-600 border border-white/10 text-gray-200 font-mono text-sm rounded px-3 py-1.5 focus:outline-none focus:border-pin-500"
              >
                {sortedWeekNums.reverse().map((w) => (
                  <option key={w} value={w}>
                    Wk {w} — {data.weeks[w].dateBowled || `Week ${w}`}
                  </option>
                ))}
              </select>
            </div>

            <div className="text-right">
              <div className="font-ui text-xs text-gray-600 uppercase tracking-wider">
                Season
              </div>
              <div className="font-ui font-700 text-gray-300 text-sm">
                {data.meta.season}
              </div>
            </div>
          </div>
        </div>

        {/* Last synced */}
        {data.meta.lastSynced && (
          <div className="max-w-7xl mx-auto mt-1">
            <span className="text-xs text-gray-600 font-mono">
              Updated {data.meta.lastSynced} ·{" "}
              <a
                href="https://www.leaguesecretary.com/bowling-centers/pinz-bowling-center/bowling-leagues/tuesday-nite-league/dashboard/147337"
                target="_blank"
                rel="noreferrer"
                className="text-pin-600 hover:text-pin-400 underline underline-offset-2"
              >
                LeagueSecretary ↗
              </a>
            </span>
          </div>
        )}
      </header>

      {/* ── Nav ── */}
      <Nav
        currentView={currentView}
        onViewChange={(v) => {
          if (v !== "bowlers") setSelectedTeam(null);
          setCurrentView(v);
        }}
      />

      {/* ── Main ── */}
      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-6 animate-fade-in">
        {currentView === "dashboard" && (
          <Dashboard {...viewProps} onNavigate={setCurrentView} />
        )}
        {currentView === "superstars" && <Superstars {...viewProps} />}
        {currentView === "teams" && <TeamStandings {...viewProps} />}
        {currentView === "bowlers" && <BowlerTable {...viewProps} />}
        {currentView === "improved" && <MostImproved {...viewProps} />}
        {currentView === "trends" && <WeekTrends {...viewProps} />}
        {currentView === "h2h" && <HeadToHead {...viewProps} />}
        {currentView === "schedule" && (
          <Schedule
            currentWeek={data?.meta?.currentWeek}
            schedule={data?.meta?.schedule}
          />
        )}
      </main>
    </div>
  );
}
