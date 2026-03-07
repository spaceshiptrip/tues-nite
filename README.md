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


---

# Architecture

The project has **two major parts**:

```
browser UI (React)
        │
        ▼
public/data.json
        ▲
        │
sync.js (Node data pipeline)
```

The React app **never talks to LeagueSecretary directly**.

Instead:

1. `sync.js` pulls league data
2. Normalizes it
3. Writes `public/data.json`
4. The React UI reads that file.

This keeps the frontend **100% static**, allowing free hosting on GitHub Pages.

---

# Data Pipeline

The sync script gathers data using **three possible sources**, in order of preference:

```
1️⃣ LeagueSecretary API (current week)
2️⃣ LeagueSecretary HTML embedded JSON
3️⃣ LeagueSecretary PDF reports (OCR fallback)
```

### 1️⃣ API (Primary Source)

Current week standings are fetched using the authenticated LeagueSecretary endpoint:

```
/League/InteractiveStandings_Read
```

This provides:

* team standings
* points won/lost
* scratch pins
* team averages
* high game/series

Bowler stats are extracted from JSON embedded in the standings page.

---

### 2️⃣ Embedded Page JSON

LeagueSecretary embeds bowler data directly in the standings page.

The script extracts the JSON block containing:

```
dataSource: [...]
```

This includes:

* bowler name
* team
* games
* averages
* handicap
* pins
* high scores

---

### 3️⃣ PDF Parsing (Historical Weeks)

Older weeks may not expose bowler JSON.

When this happens the script falls back to parsing the official **league PDF reports**.

Example report:

```
Tuesday Nite League Week 3 Standings
```

The parser extracts:

* Team standings table
* Team rosters
* Individual game scores

If the PDF contains text, it is parsed directly.

If the PDF is **image-based**, OCR is used.

---

# OCR Pipeline

When text extraction fails, the script performs:

```
PDF
 │
 ▼
pdftoppm
 │
 ▼
PNG images
 │
 ▼
Tesseract OCR
 │
 ▼
text
 │
 ▼
parsed standings + rosters
```

This ensures **all historical reports remain parsable**.

---

# Required System Dependencies

The sync script uses several command-line tools.

Install them once using **Homebrew**:

```bash
brew install poppler
brew install tesseract
```

These provide:

| Tool        | Used for                        |
| ----------- | ------------------------------- |
| `pdftotext` | Extract text directly from PDFs |
| `pdftoppm`  | Convert PDFs to images for OCR  |
| `tesseract` | Optical Character Recognition   |

Without these installed the script can still run, but **PDF fallback will not work**.

---

# Environment Variables

Create a `.env` file in the project root:

```
LS_EMAIL=your_leaguesecretary_email
LS_PASSWORD=your_password
```

These credentials are only used to access the standings API.

They are **never exposed to the frontend**.

---

# Sync Script Flow

Each run of `sync.js` performs the following:

```
login to LeagueSecretary
        │
        ▼
discover available weeks
        │
        ▼
for each week:
    fetch bowlers
    fetch standings
    compute derived stats
    patch with PDF if needed
        │
        ▼
write public/data.json
```

Derived statistics include:

* handicap pins
* year-to-date losses
* unearned points
* trend data

---

# Name Canonicalization

LeagueSecretary PDFs list bowlers as:

```
First Last
```

While API data uses:

```
Last, First
```

The sync script normalizes names using **BowlerID** so the same player is never duplicated.

Example:

```
Jay Torres
Torres, Jay
```

Both resolve to:

```
BowlerID: 1
BowlerName: "Torres, Jay"
```

This prevents duplicate player records across weeks.

---

# Local Development Workflow

Typical development flow:

```
edit React UI
npm run dev
```

When league data changes:

```
node sync.js
git commit
git push
```

The site redeploys automatically.

---

# Production Deployment

Deployment uses **GitHub Actions**.

Pushes to `main` trigger:

```
npm install
npm run build
deploy to GitHub Pages
```

The site becomes available within ~60 seconds.

---

# Repository Structure

```
.
├─ public/
│  └─ data.json        # league data used by the UI
│
├─ src/
│  ├─ pages/
│  ├─ components/
│  └─ charts/
│
├─ sync.js             # LeagueSecretary data sync pipeline
├─ README.md
└─ .github/workflows/
   └─ deploy.yml       # GitHub Pages deploy
```

---

# Updating League Data

After each bowling session:

```
node sync.js
git add public/data.json
git commit -m "Week N update"
git push
```

Deployment happens automatically.

---

# Future Improvements

Possible enhancements:

* automated weekly sync via GitHub Actions
* per-bowler trend charts
* lane performance analysis
* season projections
* playoff simulations

