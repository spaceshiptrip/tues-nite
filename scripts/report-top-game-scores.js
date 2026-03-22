#!/usr/bin/env node

import fs from "fs";
import path from "path";

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function usage() {
  console.log(`
Usage:
  node scripts/report-top-game-scores.js <week-json>
  node scripts/report-top-game-scores.js history/weeks/week-006.json

Optional env:
  TOP_N=10 node scripts/report-top-game-scores.js history/weeks/week-006.json
`);
}

function normalizeName(name) {
  return String(name || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function buildGenderMap(dataJson) {
  const byId = new Map();
  const byName = new Map();

  if (!dataJson?.weeks) return { byId, byName };

  for (const week of Object.values(dataJson.weeks)) {
    for (const b of week.bowlers || []) {
      if (b.BowlerID != null && b.Gender) {
        byId.set(Number(b.BowlerID), b.Gender);
      }
      if (b.BowlerName && b.Gender) {
        byName.set(normalizeName(b.BowlerName), b.Gender);
      }
    }
  }

  return { byId, byName };
}

function resolveGender(bowler, genderMaps) {
  const byId = genderMaps.byId.get(Number(bowler.bowlerId));
  if (byId) return byId;

  const byName = genderMaps.byName.get(normalizeName(bowler.bowlerName));
  if (byName) return byName;

  return null;
}

function toNumberOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getWeekNumberFromWeekObject(week) {
  return toNumberOrNull(
    week?.weekNum ??
      week?.WeekNum ??
      week?.meta?.weekNum ??
      week?.meta?.WeekNum
  );
}

function getBowlerId(b) {
  const id = toNumberOrNull(
    b?.BowlerID ?? b?.bowlerId ?? b?.bowlerID ?? b?.id
  );
  return id;
}

function getBowlerName(b) {
  return (
    b?.BowlerName ??
    b?.bowlerName ??
    b?.name ??
    ""
  );
}

function getBowlerAverage(b) {
  return toNumberOrNull(
    b?.Average ??
    b?.average ??
    b?.EnteringAverage ??
    b?.enteringAverage ??
    b?.Avg ??
    b?.avg
  );
}

function getBowlerHandicap(b) {
  return toNumberOrNull(
    b?.HandicapAfterBowling ??
    b?.handicapAfterBowling ??
    b?.HDCP ??
    b?.Hdcp ??
    b?.handicap ??
    b?.Handicap
  );
}

function buildPreviousWeekLookup(dataJson) {
  const byWeekNum = new Map();

  if (!dataJson?.weeks) return byWeekNum;

  for (const week of Object.values(dataJson.weeks)) {
    const weekNum = getWeekNumberFromWeekObject(week);
    if (!Number.isFinite(weekNum)) continue;

    const byId = new Map();
    const byName = new Map();

    for (const b of week.bowlers || []) {
      const bowlerId = getBowlerId(b);
      const bowlerName = getBowlerName(b);
      const average = getBowlerAverage(b);
      const handicap = getBowlerHandicap(b);

      const record = {
        bowlerId,
        bowlerName,
        average,
        handicap,
      };

      if (bowlerId != null) {
        byId.set(bowlerId, record);
      }

      if (bowlerName) {
        byName.set(normalizeName(bowlerName), record);
      }
    }

    byWeekNum.set(weekNum, { byId, byName });
  }

  return byWeekNum;
}

function resolvePreviousWeekScoringBasis(bowler, previousWeekIndex, currentWeekNum) {
  const prevWeekNum = Number(currentWeekNum) - 1;
  if (!Number.isFinite(prevWeekNum) || prevWeekNum < 1) {
    return {
      scoringAverage: null,
      scoringHandicap: Number(bowler.handicap || 0),
      scoringSource: "current-week-fallback-no-prev-week",
    };
  }

  const prevWeek = previousWeekIndex.get(prevWeekNum);
  if (!prevWeek) {
    return {
      scoringAverage: null,
      scoringHandicap: Number(bowler.handicap || 0),
      scoringSource: `current-week-fallback-missing-week-${prevWeekNum}`,
    };
  }

  const bowlerId = toNumberOrNull(bowler.bowlerId);
  const bowlerName = normalizeName(bowler.bowlerName);

  let prev = null;

  if (bowlerId != null && prevWeek.byId.has(bowlerId)) {
    prev = prevWeek.byId.get(bowlerId);
  } else if (bowlerName && prevWeek.byName.has(bowlerName)) {
    prev = prevWeek.byName.get(bowlerName);
  }

  if (prev && prev.handicap != null) {
    return {
      scoringAverage: prev.average,
      scoringHandicap: prev.handicap,
      scoringSource: `previous-week-${prevWeekNum}`,
    };
  }

  return {
    scoringAverage: null,
    scoringHandicap: Number(bowler.handicap || 0),
    scoringSource: `current-week-fallback-no-prev-bowler-match-week-${prevWeekNum}`,
  };
}

function toGameRows(weekJson, genderMaps, previousWeekIndex) {
  const rows = [];
  const currentWeekNum = toNumberOrNull(weekJson?.meta?.weekNum);

  for (const b of weekJson.bowlers || []) {
    const gender = resolveGender(b, genderMaps);
    const scoringBasis = resolvePreviousWeekScoringBasis(
      b,
      previousWeekIndex,
      currentWeekNum
    );

    for (let i = 0; i < 3; i++) {
      const scratch = Array.isArray(b.games) ? b.games[i] : null;
      const absent = Array.isArray(b.absent) ? b.absent[i] === true : false;

      if (scratch == null) continue;

      rows.push({
        gameNumber: i + 1,
        bowlerId: b.bowlerId,
        bowlerName: b.bowlerName,
        teamId: b.teamId,
        teamName: b.teamName,
        gender,
        handicap: Number(b.handicap || 0),
        scoringAverage: scoringBasis.scoringAverage,
        scoringHandicap: Number(scoringBasis.scoringHandicap || 0),
        scoringSource: scoringBasis.scoringSource,
        scratch: Number(scratch),
        handicapScore: Number(scratch) + Number(scoringBasis.scoringHandicap || 0),
        absent,
        didBowl: !!b.didBowl,
      });
    }
  }

  return rows;
}

function topN(rows, scoreKey, n) {
  return [...rows]
    .sort((a, b) => {
      if (b[scoreKey] !== a[scoreKey]) return b[scoreKey] - a[scoreKey];
      return a.bowlerName.localeCompare(b.bowlerName);
    })
    .slice(0, n);
}

function printSection(title, rows, scoreKey) {
  console.log(`\n${title}`);
  if (!rows.length) {
    console.log("  (none)");
    return;
  }

  rows.forEach((r, idx) => {
    const genderLabel = r.gender || "?";
    const absentLabel = r.absent ? " [absent/counting]" : "";
    const score =
      scoreKey === "scratch"
        ? `${r.scratch}`
        : `${r.scratch}+${r.scoringHandicap}=${r.handicapScore}`;
    const sourceLabel =
      scoreKey === "scratch"
        ? ""
        : ` [hdcp source: ${r.scoringSource}${
            r.scoringAverage != null ? `, avg=${r.scoringAverage}` : ""
          }]`;

    console.log(
      `  ${String(idx + 1).padStart(2, " ")}. ${r.bowlerName} (${genderLabel}) - ${score} - Team ${r.teamId} ${r.teamName}${absentLabel}${sourceLabel}`
    );
  });
}

function main() {
  const weekPath = process.argv[2];
  if (!weekPath) {
    usage();
    process.exit(1);
  }

  if (!fs.existsSync(weekPath)) {
    die(`Week JSON not found: ${weekPath}`);
  }

  const topNValue = Number(process.env.TOP_N || 10);
  const weekJson = loadJson(weekPath);

  const dataJsonPath = path.join(process.cwd(), "public", "data.json");
  const dataJson = fs.existsSync(dataJsonPath) ? loadJson(dataJsonPath) : null;
  const genderMaps = buildGenderMap(dataJson);
  const previousWeekIndex = buildPreviousWeekLookup(dataJson);

  const rows = toGameRows(weekJson, genderMaps, previousWeekIndex);

  console.log(
    `Week ${weekJson.meta?.weekNum} | ${weekJson.meta?.dateBowled} | ${path.basename(weekPath)}`
  );

  for (let gameNumber = 1; gameNumber <= 3; gameNumber++) {
    const gameRows = rows.filter((r) => r.gameNumber === gameNumber);

    const scratchOverall = topN(gameRows, "scratch", topNValue);
    const handicapOverall = topN(gameRows, "handicapScore", topNValue);
    const scratchMale = topN(
      gameRows.filter((r) => r.gender === "M"),
      "scratch",
      topNValue
    );
    const scratchFemale = topN(
      gameRows.filter((r) => r.gender === "W" || r.gender === "F"),
      "scratch",
      topNValue
    );

    console.log(`\n==================================================`);
    console.log(`Game ${gameNumber}`);
    console.log(`==================================================`);

    printSection(`Top ${topNValue} Scratch Overall`, scratchOverall, "scratch");
    printSection(
      `Top ${topNValue} Scratch+Handicap Overall`,
      handicapOverall,
      "handicapScore"
    );
    printSection(`Top ${topNValue} Male Scratch`, scratchMale, "scratch");
    printSection(`Top ${topNValue} Female Scratch`, scratchFemale, "scratch");
  }
}

main();
