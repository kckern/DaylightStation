#!/usr/bin/env node
/**
 * Measure how strong the opponent ladder's rungs actually are.
 *
 * The ladder is 21 named characters over Stockfish skill 0-20, and the labels
 * were never checked against anything. This checks them: every candidate answers
 * the same positions — drawn from games the children really played — and is
 * scored against a full-strength reference, so rungs, the homegrown teaching
 * opponent, and the children themselves land on one comparable scale.
 *
 * Two questions it exists to answer. Is a rung placed where its name claims?
 * And how many rungs are genuinely distinguishable, as opposed to the same
 * opponent wearing different faces — because a ladder of indistinguishable
 * rungs promises a child progress it cannot deliver.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHESS_ARCHIVE_DIR } from '../shared/gaming/chess/archivePaths.mjs';
import { createStockfishAnalyst } from '../backend/src/1_adapters/chess/StockfishAnalysisAdapter.mjs';
import { createStockfishEngine } from '../backend/src/1_adapters/chess/StockfishEngineAdapter.mjs';
import { chooseMove as homegrownMove } from '../shared/gaming/chess/opponent.mjs';
import {
  computeBaseline, distinctRungs, measureCandidate, samplePositions, saturationWarning,
} from '../backend/src/3_applications/chess/ChessLadderCalibration.mjs';
import { reviewGame } from '../backend/src/3_applications/chess/ChessGameReview.mjs';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true });


const DEFAULT_POSITIONS = 80;
const DEFAULT_DEPTH = 12;

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseArgs(argv) {
  const options = {
    positions: DEFAULT_POSITIONS,
    depth: DEFAULT_DEPTH,
    skills: null,
    homegrown: false,
    player: null,
    playerGames: 10,
    movetime: 400,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--positions') options.positions = Number(requiredValue(argv, index++, token));
    else if (token === '--depth') options.depth = Number(requiredValue(argv, index++, token));
    else if (token === '--movetime') options.movetime = Number(requiredValue(argv, index++, token));
    else if (token === '--skills') options.skills = requiredValue(argv, index++, token).split(',').map(Number);
    else if (token === '--player') options.player = requiredValue(argv, index++, token);
    else if (token === '--player-games') options.playerGames = Number(requiredValue(argv, index++, token));
    else if (token === '--homegrown') options.homegrown = true;
    else if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!Number.isInteger(options.positions) || options.positions < 10) {
    throw new Error('--positions must be an integer of at least 10');
  }
  if (options.skills?.some((skill) => !Number.isInteger(skill) || skill < 0 || skill > 20)) {
    throw new Error('--skills must be integers 0-20');
  }
  return options;
}

function archiveRoot() {
  const base = process.env.DAYLIGHT_BASE_PATH;
  if (!base) throw new Error('DAYLIGHT_BASE_PATH is not set');
  const root = path.join(base, 'data', 'household', ...CHESS_ARCHIVE_DIR.split('/'));
  // Loudly, not emptily. This directory moved once in a household
  // reorganisation and the CLIs went on reporting "no archived games" for a
  // corpus that was sitting one directory away — a wrong path must never look
  // like an empty one.
  if (!fs.existsSync(root)) throw new Error(`No chess archive at ${root}`);
  return root;
}

function loadRecords({ user = null } = {}) {
  const root = archiveRoot();
  if (!fs.existsSync(root)) return [];
  const records = [];
  for (const day of fs.readdirSync(root)) {
    const dayDir = path.join(root, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const name of fs.readdirSync(dayDir)) {
      if (!name.endsWith('.yml')) continue;
      if (user && !name.startsWith(`${user}_`)) continue;
      records.push({ file: path.join(dayDir, name), ...YAML.parse(fs.readFileSync(path.join(dayDir, name), 'utf8')) });
    }
  }
  return records;
}

const USAGE = `Measure how strong the opponent ladder's rungs actually are.

  node cli/chess-calibrate.cli.mjs [options]

  --skills <list>    Stockfish skill levels to measure, e.g. 0,4,8,12,16,20
                     (default: the whole ladder, 0-20 in steps of 2)
  --homegrown        Also measure the homegrown teaching opponent across its
                     depth and blunder-rate range
  --player <id>      Also score this child, so their strength lands in the same
                     table as the rungs
  --player-games <n> How many of their newest games to score (default 10)
  --positions <n>    Positions to sample from the archive (default ${DEFAULT_POSITIONS})
  --depth <n>        Reference search depth (default ${DEFAULT_DEPTH})
  --movetime <ms>    Movetime given to each Stockfish candidate (default 400)
  --json             Emit results as JSON
  -h, --help         Show this help

Lower ACPL means stronger. Candidates within 25cp of each other are reported as
one band: a ladder cannot promise progress between rungs it cannot tell apart.
`;

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  const records = loadRecords();
  if (!records.length) {
    process.stderr.write('No archived games to draw positions from.\n');
    process.exitCode = 1;
    return;
  }
  const positions = samplePositions(records, { limit: options.positions });
  const analyst = createStockfishAnalyst({ depth: options.depth });
  const engine = createStockfishEngine();
  const say = (line) => { if (!options.json) process.stdout.write(`${line}\n`); };
  const tick = (label) => (done, total) => {
    if (options.json || !process.stderr.isTTY) return;
    process.stderr.write(`\r  ${label.slice(0, 40).padEnd(40)} ${done}/${total}  `);
  };
  const clear = () => { if (process.stderr.isTTY) process.stderr.write(`\r${' '.repeat(60)}\r`); };

  try {
    say(`\n  ${positions.length} positions from ${records.length} archived games, reference depth ${options.depth}\n`);
    const baseline = await computeBaseline(positions, analyst, { onProgress: tick('reference evals') });
    clear();

    const candidates = [];
    const skills = options.skills || [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20];
    for (const skill of skills) {
      candidates.push({
        id: `stockfish skill ${skill}`,
        chooseMove: (fen, index) => engine.chooseMove({
          fen,
          rung: { id: `skill-${skill}`, skill, movetime_ms: options.movetime },
          // A distinct game id per position clears the transposition table, so
          // one position's search cannot warm the next and flatter the rung.
          // Keyed on the index, not on the FEN — unrelated positions collide on
          // any digest of the FEN cheap enough to be worth computing here.
          gameId: `cal-${skill}-${index}`,
        }),
      });
    }
    if (options.homegrown) {
      for (const [depth, rate] of [[1, 0.5], [1, 0.2], [1, 0], [2, 0.4], [2, 0.2], [2, 0], [3, 0.2], [3, 0]]) {
        candidates.push({
          id: `homegrown depth ${depth} blunder ${rate}`,
          chooseMove: async (fen) => homegrownMove(fen, { depth, blunder_rate: rate, seed: 7 }),
        });
      }
    }

    const results = [];
    for (const candidate of candidates) {
      const measured = await measureCandidate({
        positions, baseline, analyst, chooseMove: candidate.chooseMove, onProgress: tick(candidate.id),
      });
      clear();
      results.push({ id: candidate.id, ...measured });
      say(`  ${candidate.id.padEnd(34)} ACPL ${String(measured.acpl).padStart(4)}   blunders ${String(measured.blunderRate).padStart(3)}%`);
    }

    // The child, measured the same way — but from their own games, since a
    // child cannot be handed a position and asked to answer it on demand.
    let player = null;
    if (options.player) {
      // Newest games only. Reviewing a whole archive costs a full analysis pass
      // per game, and older games measure a child who no longer exists — the
      // question is where they are NOW, which is what places a rung.
      const own = loadRecords({ user: options.player })
        .sort((a, b) => String(b.played_on).localeCompare(String(a.played_on)))
        .slice(0, options.playerGames);
      let loss = 0;
      let moves = 0;
      for (const record of own) {
        const review = await reviewGame(record, analyst);
        const side = record.player_color === 'b' ? 'b' : 'w';
        for (const move of review.moves) {
          if (move.color !== side || move.ply <= 8) continue;
          loss += move.lossCp;
          moves += 1;
        }
        clear();
      }
      player = { id: `${options.player} (from ${own.length} games)`, acpl: moves ? Math.round(loss / moves) : 0, counted: moves };
      say(`\n  ${player.id.padEnd(34)} ACPL ${String(player.acpl).padStart(4)}`);
    }

    const bands = distinctRungs(results);
    const warning = saturationWarning(bands, results);
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ positions: positions.length, results, player, bands, warning }, null, 2)}\n`);
    } else {
      say(`\n  DISTINGUISHABLE BANDS (weakest first, 25cp apart)\n`);
      for (const band of bands) {
        const mark = player && Math.abs(player.acpl - band.acpl) < 25 ? '   <-- the player is here' : '';
        say(`    ACPL ${String(band.acpl).padStart(4)}  ${band.members.join(', ')}${mark}`);
      }
      say(`\n  ${bands.length} distinguishable strengths across ${results.length} candidates.`);
      if (warning) say(`\n  WARNING: ${warning}`);
      say('');
    }
  } catch (error) {
    process.stderr.write(`\nCalibration failed: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    analyst.dispose();
    engine.dispose();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
