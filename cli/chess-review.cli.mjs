#!/usr/bin/env node
/**
 * Review archived Piano Chess games with a full-strength engine.
 *
 * The history file records WHICH rung a child faced and whether they won. It
 * cannot say how well they played, and those are different questions: "lost to
 * Level 0" covers both a child who was outplayed from move one and a child who
 * was winning until one move. Everything here exists to answer the second one,
 * and then to make the answer usable — as a report to read, as PGN to open in
 * any board, as drills to re-solve, as a trend across months.
 *
 * The reviewing engine is never handicapped. A review is only comparable across
 * games if the yardstick never moves, so the rung being reviewed changes
 * nothing about how it is measured. Because both sides get measured in the same
 * pass, the opponent's real strength comes out alongside the child's, which is
 * the only honest way to ask whether a rung is placed right.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import dotenv from 'dotenv';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { CHESS_ARCHIVE_DIR } from '../shared/gaming/rulesets/chess/archivePaths.mjs';
import { createStockfishAnalyst } from '../backend/src/1_adapters/chess/StockfishAnalysisAdapter.mjs';
import { reviewGame, THRESHOLDS, bandForAcpl } from '../backend/src/3_applications/chess/ChessGameReview.mjs';
import { coach } from '../backend/src/3_applications/chess/ChessGameCoaching.mjs';
import { analyzeTiming, formatThink } from '../backend/src/3_applications/chess/ChessGameTiming.mjs';
import { toPgn, toDrills } from '../backend/src/3_applications/chess/ChessGameExport.mjs';
import { renderBoard } from './chess.cli.mjs';

dotenv.config({ path: path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env'), quiet: true });

const DEFAULT_DEPTH = 16;


function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

export function parseArgs(argv) {
  const options = {
    file: null,
    user: null,
    opponent: null,
    date: null,
    since: null,
    latest: false,
    all: false,
    list: false,
    depth: DEFAULT_DEPTH,
    format: 'report',
    brief: false,
    dialogue: false,
    out: null,
    help: false,
  };
  const setFormat = (value) => {
    if (options.format !== 'report') throw new Error('choose one output format at a time');
    options.format = value;
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--file') options.file = requiredValue(argv, index++, token);
    else if (token === '--user') options.user = requiredValue(argv, index++, token);
    else if (token === '--opponent') options.opponent = requiredValue(argv, index++, token);
    else if (token === '--date') options.date = requiredValue(argv, index++, token);
    else if (token === '--since') options.since = requiredValue(argv, index++, token);
    else if (token === '--depth') options.depth = Number(requiredValue(argv, index++, token));
    else if (token === '--out') options.out = requiredValue(argv, index++, token);
    else if (token === '--latest') options.latest = true;
    else if (token === '--all') options.all = true;
    else if (token === '--list') options.list = true;
    else if (token === '--brief') options.brief = true;
    else if (token === '--dialogue') options.dialogue = true;
    else if (token === '--pgn') setFormat('pgn');
    else if (token === '--drills') setFormat('drills');
    else if (token === '--trend') setFormat('trend');
    else if (token === '--json') setFormat('json');
    else if (token === '--help' || token === '-h') options.help = true;
    else if (!token.startsWith('--') && !options.file) options.file = token;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!Number.isInteger(options.depth) || options.depth < 6 || options.depth > 30) {
    throw new Error('--depth must be an integer between 6 and 30');
  }
  // A trend over one game is a report with extra steps; asking for it should
  // widen the selection rather than silently produce a one-row table.
  if (options.format === 'trend' && !options.all && !options.date && !options.file) options.all = true;
  return options;
}

function archiveRoot() {
  const base = process.env.DAYLIGHT_BASE_PATH;
  if (!base) throw new Error('DAYLIGHT_BASE_PATH is not set — pass --file instead');
  const root = path.join(base, 'data', 'household', ...CHESS_ARCHIVE_DIR.split('/'));
  // Loudly, not emptily. This directory moved once in a household
  // reorganisation and the CLIs went on reporting "no archived games" for a
  // corpus that was sitting one directory away — a wrong path must never look
  // like an empty one.
  if (!fs.existsSync(root)) throw new Error(`No chess archive at ${root}`);
  return root;
}

/** Every archived game, newest first, narrowed by user, day, or start date. */
export function findGames({ user = null, opponent = null, date = null, since = null, root = archiveRoot() } = {}) {
  if (!fs.existsSync(root)) return [];
  const games = [];
  for (const day of fs.readdirSync(root)) {
    if (date && day !== date) continue;
    if (since && day < since) continue;
    const dayDir = path.join(root, day);
    if (!fs.statSync(dayDir).isDirectory()) continue;
    for (const name of fs.readdirSync(dayDir)) {
      if (!name.endsWith('.yml')) continue;
      // The filename leads with the user id, so a prefix test avoids opening
      // and parsing every archived game just to filter by player.
      if (user && !name.startsWith(`${user}_`)) continue;
      if (opponent) {
        const record = YAML.parse(fs.readFileSync(path.join(dayDir, name), 'utf8'));
        if (String(record?.opponent?.name || '').toLowerCase() !== String(opponent).toLowerCase()) continue;
      }
      games.push({ day, name, file: path.join(dayDir, name) });
    }
  }
  return games.sort((a, b) => (a.day === b.day ? b.name.localeCompare(a.name) : b.day.localeCompare(a.day)));
}

const PAD = (value, width) => String(value).padStart(width);
const MOTIF_TITLES = Object.freeze({
  'missed-mate': 'Missed a checkmate',
  'missed-free-piece': 'Missed free material',
  'missed-queen': 'Missed winning the queen',
  'hung-piece': 'Left a piece undefended',
  'missed-castling': 'Left the king in the centre',
});

function renderMoveTable(review) {
  const lines = ['  #   move        eval before   after     lost   engine preferred', `  ${'-'.repeat(66)}`];
  for (const move of review.moves) {
    const label = move.color === 'w' ? `${move.moveNumber}.` : `${move.moveNumber}...`;
    const mark = { blunder: '  ?? BLUNDER', mistake: '  ?  mistake', inaccuracy: '  !? inaccuracy', ok: '' }[move.verdict];
    const preferred = move.matchedBest ? '(played it)' : (move.bestSan || '-');
    lines.push([
      PAD(move.ply, 4),
      ` ${label}${move.san}`.padEnd(13),
      PAD(move.evalBefore, 9),
      PAD(move.evalAfter, 11),
      PAD(move.lossCp, 7),
      `   ${preferred}`.padEnd(14),
      mark,
    ].join(''));
  }
  return lines.join('\n');
}

function renderSide(name, side) {
  return [
    `  ${name}`,
    `    average centipawn loss : ${side.acpl}  (${side.band}, roughly ${side.eloBand})`,
    `    blunders / mistakes    : ${side.blunders.length} / ${side.mistakes.length}  (+${side.inaccuracies.length} inaccuracies)`,
    `    played engine's choice : ${side.bestMoveRate}% of moves`,
  ].join('\n');
}

function renderCriticalMoment(readout, review, playerIsWhite) {
  const moment = readout.criticalMoment;
  if (!moment) return null;
  const fen = review.plyFens[moment.ply - 1];
  const label = moment.color === 'w' ? `${moment.moveNumber}.` : `${moment.moveNumber}...`;
  const lines = [
    '  THE MOMENT IT TURNED',
    '',
    renderBoard(fen, { orientation: playerIsWhite ? 'w' : 'b' }).split('\n').map((l) => `    ${l}`).join('\n'),
    '',
    `    played  ${label}${moment.san}   ${moment.evalBefore} -> ${moment.evalAfter}   (${moment.lossCp}cp given away)`,
  ];
  if (moment.bestSan && !moment.matchedBest) lines.push(`    better  ${moment.bestSan}`);
  if (readout.criticalMotif) lines.push(`    why     ${readout.criticalMotif.lesson}`);
  return lines.join('\n');
}

/**
 * What the clock says.
 *
 * Led by the haste finding rather than by the totals, because that is the part
 * that changes anyone's play. Totals are context.
 */
function renderTiming(timing, record) {
  if (!timing.timed) return null;
  const lines = ['  ON THE CLOCK'];
  lines.push(`    thought for ${formatThink(timing.totalMs)} over ${timing.moveCount} moves`
    + ` — median ${formatThink(timing.medianMs)}, mean ${formatThink(timing.meanMs)}`);
  lines.push(`    longest think: ${timing.slowest.moveNumber}.${timing.slowest.san} at ${formatThink(timing.slowest.thinkMs)}`);
  if (timing.opponentMs) {
    lines.push(`    ${record.opponent?.name || 'the opponent'} used ${formatThink(timing.opponentMs)}`);
  }
  if (timing.haste) {
    const { fast, slow, costOfHasteCp, rushing, cutMs } = timing.haste;
    lines.push('');
    lines.push(`    quick moves (under ${formatThink(cutMs)}): ${fast.acpl} ACPL, ${fast.errorRate}% went wrong`);
    lines.push(`    slow moves  (over  ${formatThink(cutMs)}): ${slow.acpl} ACPL, ${slow.errorRate}% went wrong`);
    if (rushing) {
      lines.push(`    >> Rushing costs ${costOfHasteCp} centipawns a move. The fix is a habit, not a skill:`);
      lines.push('       count to five before playing the origin chord.');
    } else if (costOfHasteCp <= -30) {
      lines.push('    >> Long thinks are the WORSE moves here — a sign of overthinking a lost');
      lines.push('       position rather than of care. Worth watching, not correcting yet.');
    } else {
      lines.push('    >> Speed and accuracy are unrelated in this game. Nothing to fix.');
    }
  }
  if (timing.rushedErrors.length) {
    lines.push('');
    lines.push('    played too fast, and it cost something:');
    for (const move of timing.rushedErrors) {
      const label = move.color === 'w' ? `${move.moveNumber}.` : `${move.moveNumber}...`;
      lines.push(`      ${label}${move.san} in ${formatThink(move.thinkMs)} — ${move.lossCp}cp`);
    }
  }
  return lines.join('\n');
}

function dialogueEntries(record) {
  const displayed = record?.commentary?.displayed;
  if (!Array.isArray(displayed)) return [];
  return displayed.filter((entry) => entry?.text || entry?.quip).map((entry) => ({
    ply: entry.ply ?? null,
    text: String(entry.text || entry.quip).replace(/\s+/g, ' ').trim(),
    source: entry.source || 'unknown',
    fallbackReason: entry.fallback_reason || entry.fallbackReason || null,
  })).filter((entry) => entry.text);
}

function dialogueSummary(record) {
  const entries = dialogueEntries(record);
  if (!entries.length) return record?.commentary?.final_line
    ? { entries: [], text: `legacy final line only: “${record.commentary.final_line}”` }
    : { entries: [], text: 'no player-visible dialogue archived' };
  const sources = entries.reduce((counts, entry) => ({ ...counts, [entry.source]: (counts[entry.source] || 0) + 1 }), {});
  return { entries, text: `${entries.length} displayed line${entries.length === 1 ? '' : 's'} (${Object.entries(sources).map(([source, count]) => `${source} ${count}`).join(', ')}); last: “${entries.at(-1).text}”` };
}

export function renderDialogue(record, detailed) {
  const summary = dialogueSummary(record);
  const lines = ['  DIALOGUE', `    ${summary.text}`];
  if (detailed && summary.entries.length) {
    for (const entry of summary.entries) {
      const provenance = entry.fallbackReason ? `${entry.source}/${entry.fallbackReason}` : entry.source;
      lines.push(`    ply ${entry.ply ?? '-'}  [${provenance}] ${entry.text}`);
    }
  }
  return lines.join('\n');
}

/**
 * Whether the rung is placed right.
 *
 * The comparison is between the two ACPLs from THIS game, not against any
 * absolute scale: an opponent that plays better than the child is too strong
 * regardless of what its label claims, and that judgement needs no calibration.
 */
function renderRungFit(playerSide, engineSide, opponent) {
  const gap = playerSide.acpl - engineSide.acpl;
  const level = opponent?.level;
  const lines = ['  RUNG FIT'];
  if (gap > 25) {
    lines.push(`    ${opponent?.name || 'the opponent'} played BETTER than the player here (${engineSide.acpl} vs ${playerSide.acpl} ACPL).`);
    if (level === 0) {
      lines.push('    This is already the bottom rung. If it is still too strong, the rung itself');
      lines.push('    needs re-spacing — raise level 0\'s blunder_rate under `ladder.levels` in');
      lines.push('    the household chess config, then re-check with chess-calibrate.');
    } else {
      lines.push(`    Drop to a lower rung: level ${Math.max(0, level - 2)} or so.`);
    }
  } else if (gap < -25) {
    lines.push(`    The player outplayed ${opponent?.name || 'the opponent'} (${playerSide.acpl} vs ${engineSide.acpl} ACPL) — ready for the next rung.`);
  } else {
    lines.push(`    Well matched: ${playerSide.acpl} vs ${engineSide.acpl} ACPL. This rung is the right rung.`);
  }
  return lines.join('\n');
}

export function renderReport(record, review, { brief = false, dialogue = false } = {}) {
  const opponent = record.opponent || {};
  const rung = opponent.rung || {};
  const help = record.help || {};
  const playerIsWhite = record.player_color !== 'b';
  const side = playerIsWhite ? 'w' : 'b';
  const player = playerIsWhite ? review.white : review.black;
  const engine = playerIsWhite ? review.black : review.white;
  const readout = coach(review, { side, plyFens: review.plyFens });
  const lines = [''];

  lines.push(`  ${record.user_id} vs ${opponent.name || 'engine'} — ${record.result} by ${record.outcome}`);
  lines.push(`  ${record.played_on}  ·  ${Math.round((record.duration_ms || 0) / 60000)} min  ·  ${review.moves.length} plies`);
  // Which engine, not just which level. A game archived before the ladder was
  // re-spaced records level 0 as Stockfish; one archived after records it as the
  // teaching engine. Printing only the level would present two very different
  // opponents under one name.
  const tuning = rung.engine === 'homegrown'
    ? `teaching engine, depth ${rung.depth ?? '-'}, blunders ${Math.round((rung.blunder_rate ?? 0) * 100)}%`
    : `stockfish skill ${rung.skill ?? '-'}, ${rung.movetime_ms ?? '-'}ms/move`;
  lines.push(`  rung: ${rung.label || opponent.level} (${tuning})`);
  lines.push('');

  if (!brief) {
    lines.push(renderMoveTable(review));
    lines.push('');
  }

  const moment = renderCriticalMoment(readout, review, playerIsWhite);
  if (moment) { lines.push(moment); lines.push(''); }

  if (readout.wasWinning && record.result === 'loss') {
    lines.push(`  This game was winnable — the player held +${(readout.bestHeld / 100).toFixed(2)} at its best.`);
    lines.push('');
  }

  if (readout.phases.length > 1) {
    lines.push('  BY PHASE');
    for (const phase of readout.phases) {
      lines.push(`    ${phase.phase.padEnd(12)} ${PAD(phase.acpl, 4)} ACPL over ${phase.moveCount} moves, ${phase.blunders} blunders`);
    }
    lines.push('');
  }

  const timingReadout = analyzeTiming(review, record, { side });
  const timing = renderTiming(timingReadout, record);
  if (timing) { lines.push(timing); lines.push(''); }
  else if (timingReadout.invalid) {
    lines.push('  ON THE CLOCK');
    lines.push(`    unavailable: ${timingReadout.reason}.`);
    lines.push('');
  }
  lines.push(renderDialogue(record, dialogue));
  lines.push('');

  if (readout.motifs.length) {
    lines.push('  WHAT TO WORK ON');
    for (const motif of readout.motifs) {
      lines.push(`    ${MOTIF_TITLES[motif.motif] || motif.motif} (${motif.count}x)`);
      for (const example of motif.examples) {
        const label = example.move.color === 'w' ? `${example.move.moveNumber}.` : `${example.move.moveNumber}...`;
        lines.push(`      ${label}${example.move.san} — ${example.lesson}`);
      }
    }
    lines.push('');
  }

  lines.push(renderSide(`${record.user_id} (${playerIsWhite ? 'white' : 'black'})`, player));
  lines.push('');
  lines.push(renderSide(`${opponent.name || 'engine'} (${playerIsWhite ? 'black' : 'white'})`, engine));
  lines.push('');
  lines.push(renderRungFit(player, engine, opponent));

  if (review.retracted.length) {
    lines.push('');
    lines.push('  TAKEN BACK');
    for (const move of review.retracted) {
      const ply = Number.isInteger(move.ply) ? `ply ${move.ply}` : 'untracked ply';
      lines.push(`    ${ply}: ${move.san} (${move.color})`);
    }
  }
  lines.push('');
  lines.push(`  help used: ${help.hints || 0} hints, ${help.best_moves || 0} best-move reveals, ${help.takebacks || 0} takebacks`);
  lines.push('');
  return lines.join('\n');
}

/**
 * Form over many games.
 *
 * One game's ACPL is mostly noise — a single sharp position swings it — so the
 * row-by-row table exists to be read as a column, not as verdicts on individual
 * games.
 */
export function renderTrend(rows) {
  const lines = ['', '  date        opponent        result   ACPL   blunders   opp ACPL   dialogue     timing', `  ${'-'.repeat(88)}`];
  for (const row of rows) {
    lines.push([
      `  ${row.played_on}`.padEnd(14),
      String(row.opponent).padEnd(16),
      String(row.result).padEnd(9),
      PAD(row.acpl, 4),
      PAD(row.blunders, 10),
      PAD(row.opponentAcpl, 11),
      String(row.dialogue).padEnd(13),
      String(row.timingQuality),
    ].join(''));
  }
  const acpls = rows.map((row) => row.acpl);
  const mean = Math.round(acpls.reduce((sum, value) => sum + value, 0) / acpls.length);
  const band = bandForAcpl(mean);
  lines.push('');
  lines.push(`  ${rows.length} games · average ${mean} ACPL (${band.label}, roughly ${band.elo})`);
  // Oldest-half against newest-half: enough to see a direction without
  // pretending a dozen games support a regression line.
  if (rows.length >= 6) {
    const ordered = [...rows].reverse();
    const half = Math.floor(ordered.length / 2);
    const early = ordered.slice(0, half);
    const late = ordered.slice(-half);
    const avg = (list) => Math.round(list.reduce((sum, row) => sum + row.acpl, 0) / list.length);
    const delta = avg(early) - avg(late);
    const direction = delta > 8 ? 'improving' : delta < -8 ? 'sliding' : 'flat';
    lines.push(`  earliest ${half}: ${avg(early)} ACPL  ->  latest ${half}: ${avg(late)} ACPL  (${direction})`);
  }
  lines.push('');
  return lines.join('\n');
}

const USAGE = `Review archived Piano Chess games with a full-strength engine.

  node cli/chess-review.cli.mjs [file] [options]

Selecting games:
  --file <path>    Archived game YAML to review
  --user <id>      Household user id (e.g. test-user)
  --opponent <n>   Only games against this named opponent (e.g. Caterpie)
  --date <date>    A single archive day, YYYY-MM-DD
  --since <date>   Every game on or after this day
  --latest         Only the newest match (the default when several match)
  --all            Every matching game

Output:
  (default)        Coaching report: move table, the moment it turned, phase
                   breakdown, recurring mistakes, and whether the rung fits
  --brief          Coaching report without the move-by-move table
  --dialogue       Print every line actually shown, with its source/reason
  --trend          One row per game plus form over time (implies --all)
  --pgn            Annotated PGN — opens in Lichess or any board GUI
  --drills         The player's own mistakes as re-solvable positions (YAML)
  --json           The whole review as JSON
  --list           List matching games without analysing them
  --out <path>     Write to a file instead of stdout

Options:
  --depth <n>      Engine search depth, 6-30 (default ${DEFAULT_DEPTH}). Depth rather
                   than time, so two runs of the same game agree.
  -h, --help       Show this help

Centipawn-loss labels: inaccuracy >= ${THRESHOLDS.inaccuracy}, mistake >= ${THRESHOLDS.mistake}, blunder >= ${THRESHOLDS.blunder}.
`;

export async function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    process.stdout.write(USAGE);
    return;
  }

  let targets;
  if (options.file) {
    targets = [{ file: options.file, name: path.basename(options.file), day: null }];
  } else {
    targets = findGames({ user: options.user, opponent: options.opponent, date: options.date, since: options.since });
    if (!targets.length) {
      process.stderr.write('No archived games matched.\n');
      process.exitCode = 1;
      return;
    }
    if (!options.all) targets = targets.slice(0, 1);
  }

  if (options.list) {
    for (const target of targets) process.stdout.write(`${target.day || ''}  ${target.name}\n`);
    return;
  }

  const chunks = [];
  const emit = (text) => { chunks.push(text); };
  const analyst = createStockfishAnalyst({ depth: options.depth });
  try {
    const trendRows = [];
    const jsonReports = [];
    const drills = [];

    for (const [index, target] of targets.entries()) {
      const record = YAML.parse(fs.readFileSync(target.file, 'utf8'));
      // Progress is a redrawn line, so it only makes sense on a terminal. Piped
      // or redirected, `\r` erases nothing and every tick survives into the
      // captured output as its own smear of text.
      const showProgress = process.stderr.isTTY;
      const review = await reviewGame(record, analyst, {
        onProgress: (done, total) => {
          if (!showProgress) return;
          process.stderr.write(`\r  [${index + 1}/${targets.length}] ${target.name.slice(0, 34)}… ${done}/${total}  `);
        },
      });
      if (showProgress) process.stderr.write(`\r${' '.repeat(74)}\r`);

      const playerIsWhite = record.player_color !== 'b';
      const player = playerIsWhite ? review.white : review.black;
      const opponentSide = playerIsWhite ? review.black : review.white;

      if (options.format === 'trend') {
        trendRows.push({
          played_on: record.played_on,
          opponent: record.opponent?.name || `level ${record.opponent?.level}`,
          // An abandoned game has no result, and printing `null` in a column of
          // win/loss reads as a bug rather than as "they walked away" — which
          // the archive deliberately keeps as the interesting record.
          result: record.result || (record.completed === false ? 'quit' : 'unfinished'),
          acpl: player.acpl,
          blunders: player.blunders.length,
          opponentAcpl: opponentSide.acpl,
          dialogue: dialogueSummary(record).entries.length
            ? dialogueSummary(record).entries.reduce((out, entry) => `${out}${out ? '/' : ''}${entry.source}`, '')
            : (record.commentary?.final_line ? 'legacy' : '-'),
          timingQuality: record.timing?.quality || (record.timing?.mode === 'off' ? 'off' : 'legacy'),
        });
      } else if (options.format === 'json') {
        jsonReports.push({ file: target.file, record, review });
      } else if (options.format === 'pgn') {
        emit(toPgn(record, review));
        emit('\n');
      } else if (options.format === 'drills') {
        drills.push(...toDrills(record, review));
      } else {
        emit(renderReport(record, review, { brief: options.brief, dialogue: options.dialogue }));
      }
    }

    if (options.format === 'trend') emit(renderTrend(trendRows));
    if (options.format === 'json') emit(`${JSON.stringify(jsonReports, null, 2)}\n`);
    if (options.format === 'drills') {
      emit(drills.length
        ? YAML.stringify({ generated_from: targets.length, drills })
        : '# no drills: no mistake crossed the threshold\n');
    }

    const output = chunks.join('');
    if (options.out) {
      fs.writeFileSync(options.out, output);
      process.stderr.write(`Wrote ${options.out}\n`);
    } else {
      process.stdout.write(output);
    }
  } catch (error) {
    process.stderr.write(`\nReview failed: ${error.message}\n`);
    process.exitCode = 1;
  } finally {
    analyst.dispose();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  await main();
}
