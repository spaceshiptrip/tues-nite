#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const { PDFParse } = require("pdf-parse");

function die(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function usage() {
  console.log(`
Usage:
  node scripts/parse-recap-pdf.js <pdf-file> [output-json]

Examples:
  node scripts/parse-recap-pdf.js history/source/TuesNite-Week5-recap.pdf
  node scripts/parse-recap-pdf.js history/source/TuesNite-Week5-recap.pdf history/weeks/week-005.json
`);
}

function normalizeName(raw) {
  return raw.replace(/\s+/g, " ").trim();
}

function titleCaseNameFromRoster(raw) {
  return normalizeName(raw);
}

function parseDateToIso(mmddyyyy) {
  const m = mmddyyyy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return mmddyyyy;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

function weekFileNameFromMeta(meta) {
  return `week-${String(meta.weekNum).padStart(3, "0")}.json`;
}

function chunkPages(text) {
  const lines = text.split(/\r?\n/);
  const pages = [];
  let current = [];

  for (const line of lines) {
    if (/Page \d+ of \d+/i.test(line) && current.length) {
      current.push(line);
      pages.push(current.join("\n"));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length) pages.push(current.join("\n"));
  return pages;
}

function parseMeta(fullText) {
  const m = fullText.match(
    /^(.+?)(\d{1,2}\/\d{1,2}\/\d{4})\s+Week\s+(\d+)\s+of\s+\d+\s+Page\s+1/im,
  );
  if (!m) die("Could not parse date/week/league name from PDF.");

  const [, leagueName, dateBowledRaw, weekNumRaw] = m;

  const seasonMatch = fullText.match(
    /Spring\s+(\d{4})|Fall\s+(\d{4})|Summer\s+(\d{4})|Winter\s+(\d{4})/i,
  );
  const seasonYear =
    seasonMatch?.[1] ||
    seasonMatch?.[2] ||
    seasonMatch?.[3] ||
    seasonMatch?.[4] ||
    dateBowledRaw.slice(-4);

  return {
    leagueId: 147337,
    leagueName: normalizeName(leagueName),
    season: `Spring ${seasonYear}`,
    weekNum: Number(weekNumRaw),
    dateBowled: parseDateToIso(dateBowledRaw),
    source: "recap-pdf",
  };
}

function parseTeamStandings(page1) {
  const standings = [];
  const lines = page1.split(/\r?\n/);

  const startIdx = lines.findIndex((l) => /^Place\s+#\s+Team Name/i.test(l));
  if (startIdx < 0) return standings;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^Review of Last Week/i.test(line)) break;

    const m = line.match(
      /^(\d+)\s+(\d+)\s+(.+?)\s+([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)?\s*([\d.]+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/,
    );

    if (!m) continue;

    standings.push({
      place: Number(m[1]),
      teamId: Number(m[2]),
      teamName: normalizeName(m[3]),
      pctWon: Number(m[4]),
      won: Number(m[5]),
      lost: Number(m[6]),
      unearnedPoints: m[7] ? Number(m[7]) : 0,
      ytdPctWon: Number(m[8]),
      ytdWon: Number(m[9]),
      ytdLost: Number(m[10]),
      gamesWon: Number(m[11]),
      scratchPins: Number(m[12]),
      hdcpPins: Number(m[13]),
    });
  }

  return standings;
}

function parseTeamRecap(page1) {
  const recap = {};
  const lines = page1.split(/\r?\n/);

  const startIdx = lines.findIndex((l) => /^Lanes\s+Team Name/i.test(l));
  if (startIdx < 0) return recap;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || /^Lane Assignments/i.test(line)) break;

    const m = line.match(
      /^(\d+)-(\d+)\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+<--->\s+(.+?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)$/i,
    );
    if (!m) continue;

    const leftName = normalizeName(m[3]);
    const leftGames = [Number(m[4]), Number(m[5]), Number(m[6])];
    const leftTotal = Number(m[7]);
    const leftWon = Number(m[8]);

    const rightName = normalizeName(m[9]);
    const rightGames = [Number(m[10]), Number(m[11]), Number(m[12])];
    const rightTotal = Number(m[13]);
    const rightWon = Number(m[14]);

    recap[leftName] = {
      games: leftGames,
      total: leftTotal,
      won: leftWon,
      opponentTeamName: rightName,
    };
    recap[rightName] = {
      games: rightGames,
      total: rightTotal,
      won: rightWon,
      opponentTeamName: leftName,
    };
  }

  return recap;
}

function parseRosterPages(pages) {
  const bowlers = [];
  const teamNameMap = new Map();

  for (const page of pages) {
    const lines = page.split(/\r?\n/);

    let currentTeamId = null;
    let currentTeamName = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      const teamHeader = line.match(/^(\d+)\s+-\s+(.+)$/);
      if (teamHeader) {
        currentTeamId = Number(teamHeader[1]);
        currentTeamName = normalizeName(teamHeader[2]);
        teamNameMap.set(currentTeamId, currentTeamName);
        continue;
      }

      if (currentTeamId == null) continue;

      if (/^Temporary Substitutes Division/i.test(line)) {
        // TODO: parse substitutes later
        continue;
      }

      if (/^Bowling To Raise To Drop HDCP/i.test(line)) continue;
      if (/^ID\s+#\s+Hand\s+Name/i.test(line)) continue;

      const parts = line.split(/\s+/);

      // Need at least:
      // ID Name... Avg HDCP Pins Gms Avg+1 Avg-1 ...
      if (parts.length < 9) {
        if (/^\d+\s/.test(line)) {
          console.log("UNMATCHED ROW:", line);
        }
        continue;
      }

      // Row must start with numeric bowler ID
      if (!/^\d+$/.test(parts[0])) {
        continue;
      }

      const bowlerId = Number(parts[0]);

      // Find entering average token: either bk### or ###
      let avgIdx = -1;
      for (let i = 1; i < parts.length; i++) {
        if (/^(bk\d+|\d+)$/.test(parts[i]) && i + 4 < parts.length) {
          // next 4 fields should be numeric-ish: HDCP Pins Gms Avg+1 Avg-1
          if (
            /^\d+$/.test(parts[i + 1]) &&
            /^\d+$/.test(parts[i + 2]) &&
            /^\d+$/.test(parts[i + 3]) &&
            /^\d+$/.test(parts[i + 4])
          ) {
            avgIdx = i;
            break;
          }
        }
      }

      if (avgIdx < 2) {
        if (/^\d+\s/.test(line)) {
          console.log("UNMATCHED ROW:", line);
        }
        continue;
      }

      const bowlerName = normalizeName(parts.slice(1, avgIdx).join(" "));
      const enteringAverageRaw = parts[avgIdx];
      const handicap = Number(parts[avgIdx + 1]);

      // Remaining tokens after Avg/HDCP/Pins/Gms/Avg+1/Avg-1
      const tail = parts.slice(avgIdx + 6);

      let games = [];
      let absent = [];
      let scratchSeries = 0;
      let handicapSeries = 0;

      // Case A: short row ending in 0 0
      if (tail.length === 2 && tail[0] === "0" && tail[1] === "0") {
        games = [null, null, null];
        absent = [true, true, true];
        scratchSeries = 0;
        handicapSeries = 0;
      } else {
        // Last two tokens are scratchSeries + handicapSeries
        if (tail.length < 5) {
          console.log("UNMATCHED ROW:", line);
          continue;
        }

        scratchSeries = Number(tail[tail.length - 2]);
        handicapSeries = Number(tail[tail.length - 1]);

        const gameTokens = tail.slice(0, tail.length - 2);

        for (let i = 0; i < 3; i++) {
          const tok = gameTokens[i] ?? null;

          if (tok == null) {
            games.push(null);
            absent.push(true);
            continue;
          }

          if (/^a\d+$/i.test(tok)) {
            games.push(Number(tok.slice(1)));
            absent.push(true);
            continue;
          }

          if (/^v\d+$/i.test(tok)) {
            games.push(Number(tok.slice(1)));
            absent.push(true);
            continue;
          }

          if (/^\d+$/.test(tok)) {
            const val = Number(tok);
            if (val === 0) {
              games.push(null);
              absent.push(true);
            } else {
              games.push(val);
              absent.push(false);
            }
            continue;
          }

          games.push(null);
          absent.push(true);
        }
      }

      const enteringAverage = Number(String(enteringAverageRaw).replace(/^bk/i, ""));
      const didBowl = absent.some((a) => a === false);

      bowlers.push({
        bowlerId,
        bowlerName,
        teamId: currentTeamId,
        teamName: currentTeamName,
        enteringAverage,
        handicap,
        games,
        absent,
        didBowl,
        scratchSeries,
        handicapSeries,
      });

      continue;
    }
  }

  return { bowlers, teamNameMap };
}

function attachTeamRecapToMeta(meta, standings, teamRecapByName) {
  const teamRecap = {};

  for (const s of standings) {
    const rec = teamRecapByName[s.teamName];
    if (!rec) continue;

    teamRecap[String(s.teamId)] = {
      games: rec.games,
      total: rec.total,
      won: rec.won,
      opponentTeamName: rec.opponentTeamName,
    };
  }

  meta.teamRecap = teamRecap;
  return meta;
}

function inferSimpleSubstitutes(data) {
  const byTeam = new Map();

  for (const b of data.bowlers) {
    if (!byTeam.has(b.teamId)) byTeam.set(b.teamId, []);
    byTeam.get(b.teamId).push(b);
  }

  for (const [, teamBowlers] of byTeam.entries()) {
    const active = teamBowlers.filter((b) => b.didBowl === true);
    const inactive = teamBowlers.filter((b) => b.didBowl === false);

    if (teamBowlers.length > 4 && active.length === 4 && inactive.length >= 1) {
      // intentionally conservative for phase 1
    }
  }

  return data;
}

async function main() {
  const pdfPath = process.argv[2];
  const outPathArg = process.argv[3];

  if (!pdfPath) {
    usage();
    process.exit(1);
  }

  if (!fs.existsSync(pdfPath)) die(`File not found: ${pdfPath}`);

  const buffer = fs.readFileSync(pdfPath);

  const parser = new PDFParse({ data: buffer });
  await parser.load();
  const result = await parser.getText();
  const text = result.text;

  if (!text || !text.trim()) die("PDF text extraction returned empty text.");

  const pages = chunkPages(text);
  if (pages.length < 2) die("Expected multi-page recap PDF.");

  const meta = parseMeta(text);
  const teamStandings = parseTeamStandings(pages[0]);
  const teamRecapByName = parseTeamRecap(pages[0]);
  const rosterPages = pages.slice(1);
  const { bowlers } = parseRosterPages(rosterPages);

  const output = {
    meta: attachTeamRecapToMeta(meta, teamStandings, teamRecapByName),
    bowlers,
  };

  inferSimpleSubstitutes(output);

  const outPath =
    outPathArg ||
    path.join(process.cwd(), "history", "weeks", weekFileNameFromMeta(meta));

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n", "utf8");

  console.log(`Wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
