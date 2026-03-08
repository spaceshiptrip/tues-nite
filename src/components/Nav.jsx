const TABS = [
  { id: "dashboard", label: "🏠 Dashboard" },
  { id: "superstars", label: "⭐ Superstars" },
  { id: "schedule", label: "📅 Schedule" },
  { id: "teams", label: "🏆 Standings" },
  { id: "bowlers", label: "🎳 Bowlers" },
  { id: "improved", label: "📈 Most Improved" },
  { id: "trends", label: "📊 Trends" },
  { id: "h2h", label: "⚔️ Head-to-Head" },
];

export default function Nav({ currentView, onViewChange }) {
  return (
    <nav className="bg-alley-800 border-b border-white/[0.06] overflow-x-auto">
      <div className="flex">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => onViewChange(t.id)}
            className={`nav-tab ${currentView === t.id ? "active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>
    </nav>
  );
}
