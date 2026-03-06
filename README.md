# 🎳 Tuesday Nite League — Pinz Bowling Center

Live standings, player stats, and trends for the Tuesday Nite League at Pinz Bowling Center, Studio City CA.

Built with **React + Vite + Tailwind CSS** — deployed free to GitHub Pages.

---

## Features

| View | What it shows |
|------|---------------|
| 🏠 Dashboard | Season overview, top performers, quick navigation |
| ⭐ Superstars | High game/series (scratch & handicap), comeback kids |
| 🏆 Standings | Team rankings by avg, sortable table + cards |
| 🎳 Bowlers | Full roster — searchable, sortable by any stat |
| 📈 Most Improved | Gainers and losers vs entering average |
| 📊 Trends | Week-over-week team and bowler average charts |
| ⚔️ Head-to-Head | Compare any two teams with radar chart |

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/YOUR_USERNAME/pinz-bowling-league
cd pinz-bowling-league
npm install
```

### 2. Sync data

Run this once after each Tuesday session:

```bash
node sync.js
```

This fetches the latest data from LeagueSecretary and saves/merges it into `public/data.json`. Already includes Week 4 seed data — no need to run before first deploy.

### 3. Local dev

```bash
npm run dev
```

### 4. Deploy to GitHub Pages

#### One-time setup
1. Go to your GitHub repo → **Settings → Pages**
2. Set source to **GitHub Actions**
3. Edit `.github/workflows/deploy.yml` and set `VITE_BASE_PATH` to `/your-repo-name/`

#### Every Tuesday after bowling
```bash
node sync.js
git add public/data.json
git commit -m "Update standings week N"
git push
```

GitHub Actions will build and deploy automatically. Done. 🎳

---

## Weekly workflow (< 3 minutes)

```
After Tuesday bowling:
  1. node sync.js          # fetches new week, merges history
  2. git add public/data.json
  3. git commit -m "Week N update"
  4. git push              # GitHub deploys in ~60 seconds
```

---

## Tech stack

- **React 18** — UI
- **Vite 5** — build
- **Tailwind CSS 3** — styling  
- **Recharts** — trend charts
- **Node 18+** — sync script (native fetch, no extra deps)
- **GitHub Pages** — free hosting
- **GitHub Actions** — auto deploy on push

---

## Data source

[LeagueSecretary.com](https://www.leaguesecretary.com/bowling-centers/pinz-bowling-center/bowling-leagues/tuesday-nite-league/dashboard/147337) — League ID 147337

The sync script extracts the JSON already embedded in the LeagueSecretary standings page (no PDF parsing needed).
