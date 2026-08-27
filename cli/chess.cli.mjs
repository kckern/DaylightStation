#!/usr/bin/env node
/**
 * Play a real game against the deployed chess engine, over the same HTTP
 * routes the Piano Chess game uses (`POST /api/v1/piano-games/chess/move`,
 * `GET/PUT /api/v1/piano-games/chess/config`).
 *
 * This exists so a human can feel the difficulty ladder rung to rung instead
 * of inferring it from a log line, and so a broken router shows up as a CLI
 * failure rather than a silent client-side fallback. It never imports the
 * engine adapter directly — going around the router would test different
 * code than the kiosk runs.
 */

import readline from 'node:readline';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  INITIAL_FEN,
  applyMove,
  legalMoves,
  describePosition,
  isValidFen,
} from '../shared/gaming/rulesets/chess/engine.mjs';
import { fenToPosition } from '../shared/gaming/rulesets/chess/position.mjs';

const DEFAULT_HOST = 'http://localhost:3112';
const DEFAULT_RUNG = 'learner';

const UNICODE_PIECES = {
  wP: '♙', wN: '♘', wB: '♗', wR: '♖', wQ: '♕', wK: '♔',
  bP: '♟', bN: '♞', bB: '♝', bR: '♜', bQ: '♛', bK: '♚',
};

function requiredValue(argv, index, option) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
  return value;
}

/** Options for a game run. Throws on a flag missing its value or an unknown flag. */
export function parseArgs(argv) {
  const options = {
    host: DEFAULT_HOST,
    rung: DEFAULT_RUNG,
    user: null,
    color: 'w',
    fen: INITIAL_FEN,
    json: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--host') options.host = requiredValue(argv, index++, token);
    else if (token === '--rung') options.rung = requiredValue(argv, index++, token);
    else if (token === '--user') options.user = requiredValue(argv, index++, token);
    else if (token === '--color') options.color = requiredValue(argv, index++, token);
    else if (token === '--fen') options.fen = requiredValue(argv, index++, token);
    else if (token === '--json') options.json = true;
    else if (token === '--help' || token === '-h') options.help = true;
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (options.color !== 'w' && options.color !== 'b') throw new Error('--color must be w or b');
  if (!isValidFen(options.fen)) throw new Error(`--fen is not a valid FEN: ${options.fen}`);
  return options;
}

/** Board string from White's or Black's point of view, unicode pieces, rank/file labels. */
export function renderBoard(fen, { orientation = 'w' } = {}) {
  const position = fenToPosition(fen);
  if (!position) return '(unrenderable position)';
  const files = orientation === 'b' ? ['h', 'g', 'f', 'e', 'd', 'c', 'b', 'a'] : ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
  const ranks = orientation === 'b' ? ['1', '2', '3', '4', '5', '6', '7', '8'] : ['8', '7', '6', '5', '4', '3', '2', '1'];
  const lines = [];
  for (const rank of ranks) {
    const squares = files.map((file) => {
      const piece = position[`${file}${rank}`];
      return piece ? UNICODE_PIECES[piece] : '.';
    });
    lines.push(`${rank} ${squares.join(' ')}`);
  }
  lines.push(`  ${files.join(' ')}`);
  return lines.join('\n');
}

/**
 * The HTTP call to `/api/v1/piano-games/chess/move`, isolated so tests inject a fake.
 * Throws on a non-2xx response or a network error, naming the host — "the
 * backend isn't running" is the most common failure this surfaces.
 */
export async function requestMove({ host, fen, rung, gameId, user }) {
  const url = new URL('/api/v1/piano-games/chess/move', host);
  if (user) url.searchParams.set('user', user);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fen, rung, gameId }),
    });
  } catch (error) {
    throw new Error(`Could not reach ${host} — is the backend running? (${error.message})`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${host} POST /api/v1/piano-games/chess/move returned HTTP ${response.status}: ${body}`);
  }
  return response.json();
}

/** The HTTP call to `GET /api/v1/piano-games/chess/config`, isolated the same way as requestMove. */
export async function requestConfig({ host, user }) {
  const url = new URL('/api/v1/piano-games/chess/config', host);
  if (user) url.searchParams.set('user', user);
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(`Could not reach ${host} — is the backend running? (${error.message})`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`${host} GET /api/v1/piano-games/chess/config returned HTTP ${response.status}: ${body}`);
  }
  return response.json();
}

function parseCoordinateInput(input) {
  const trimmed = input.trim();
  const match = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/i.exec(trimmed);
  if (!match) return null;
  const [, from, to, promotion] = match;
  return promotion ? { from: from.toLowerCase(), to: to.toLowerCase(), promotion: promotion.toLowerCase() } : { from: from.toLowerCase(), to: to.toLowerCase() };
}

/**
 * Applies the player's move, and — unless that move ended the game — asks the
 * server for the engine's reply and applies it too.
 *
 * Pure aside from `deps.requestMove`, so this is testable without a server.
 * Returns `{ accepted, playerSan, fen, reply, gameOver, outcome, error }`.
 */
export async function playTurn(state, input, deps) {
  const trimmed = String(input || '').trim();
  const asCoordinate = parseCoordinateInput(trimmed);
  const attempted = asCoordinate || trimmed;
  const played = applyMove(state.fen, attempted);
  if (played.error) {
    return {
      accepted: false,
      playerSan: null,
      fen: state.fen,
      reply: null,
      gameOver: false,
      outcome: null,
      error: played.error.message || played.error.code || 'illegal move',
    };
  }

  const afterPlayer = played.fen;
  const playerStatus = describePosition(afterPlayer);
  if (playerStatus?.game_over) {
    return {
      accepted: true,
      playerSan: played.move.san,
      fen: afterPlayer,
      reply: null,
      gameOver: true,
      outcome: playerStatus,
      error: null,
    };
  }

  const reply = await deps.requestMove({
    host: state.host,
    fen: afterPlayer,
    rung: state.rung,
    gameId: state.gameId,
    user: state.user,
  });

  if (!reply || reply.move === null) {
    return {
      accepted: true,
      playerSan: played.move.san,
      fen: afterPlayer,
      reply: null,
      gameOver: true,
      outcome: describePosition(afterPlayer),
      error: null,
    };
  }

  const engineApplied = applyMove(afterPlayer, {
    from: reply.from,
    to: reply.to,
    ...(reply.promotion ? { promotion: reply.promotion } : {}),
  });
  if (engineApplied.error) {
    return {
      accepted: true,
      playerSan: played.move.san,
      fen: afterPlayer,
      reply,
      gameOver: false,
      outcome: null,
      error: `engine returned an illegal move: ${engineApplied.error.message || engineApplied.error.code}`,
    };
  }

  const finalStatus = describePosition(engineApplied.fen);
  return {
    accepted: true,
    playerSan: played.move.san,
    fen: engineApplied.fen,
    reply,
    gameOver: Boolean(finalStatus?.game_over),
    outcome: finalStatus,
    error: null,
  };
}

function outcomeLine(outcome) {
  if (!outcome) return 'Game over.';
  const who = outcome.winner_name ? `${outcome.winner_name} wins` : 'Draw';
  return `Game over: ${outcome.outcome} — ${who} (${outcome.result}).`;
}

const USAGE = `Play a real game against the deployed chess engine.

  node cli/chess.cli.mjs [options]
  node cli/chess.cli.mjs analyze [review options]

Options:
  --host <url>     Backend base URL (default ${DEFAULT_HOST})
  --rung <id>      Difficulty rung (default ${DEFAULT_RUNG})
  --user <id>      Household user id, for per-user config overrides
  --color <w|b>    Which side you play (default w)
  --fen <FEN>      Start from this position instead of the initial one
  --json           One JSON object per move instead of a board (for scripting)
  -h, --help       Show this help

Analysis:
  analyze           Review archived games with full-strength Stockfish. For
                    example: analyze --user felix --opponent Caterpie --all

In-game commands (typed at the move prompt):
  moves            List legal moves in the current position
  fen              Print the current FEN
  rung <id>        Switch difficulty mid-game
  quit             Exit
`;

export async function main(argv = process.argv.slice(2)) {
  if (argv[0] === 'analyze') {
    const { main: reviewMain } = await import('./chess-review.cli.mjs');
    return reviewMain(argv.slice(1));
  }
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

  const state = {
    fen: options.fen,
    host: options.host,
    rung: options.rung,
    user: options.user,
    gameId: randomUUID(),
  };

  const print = (line) => {
    if (options.json) return;
    process.stdout.write(`${line}\n`);
  };
  const emitJson = (payload) => {
    if (!options.json) return;
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };

  print(`Playing as ${options.color === 'w' ? 'White' : 'Black'} against rung "${state.rung}" at ${state.host}`);
  print(renderBoard(state.fen, { orientation: options.color }));

  // `terminal: false` plus a `for await` consumer (rather than repeated
  // `rl.question()` calls) is deliberate: with piped stdin, `question()`
  // throws ERR_USE_AFTER_CLOSE once the pipe reaches EOF even when queued
  // lines are still waiting to be delivered. Iterating the interface drains
  // every buffered line first and only then ends, which is what both a
  // human at a TTY and `printf '...' | node cli/chess.cli.mjs` need.
  const rl = readline.createInterface({ input: process.stdin, output: options.json ? undefined : process.stdout, terminal: false });
  const showPrompt = () => { if (!options.json) process.stdout.write('\n> '); };

  let over = false;
  showPrompt();
  // eslint-disable-next-line no-restricted-syntax
  for await (const raw of rl) {
    const input = String(raw || '').trim();
    if (!input) { showPrompt(); continue; }

    if (input === 'quit') { over = true; break; }

    if (input === 'moves') {
      const moves = legalMoves(state.fen).map((move) => move.san);
      print(moves.length ? moves.join(' ') : '(no legal moves)');
      emitJson({ type: 'moves', moves });
      showPrompt();
      continue;
    }

    if (input === 'fen') {
      print(state.fen);
      emitJson({ type: 'fen', fen: state.fen });
      showPrompt();
      continue;
    }

    if (input.startsWith('rung ')) {
      state.rung = input.slice('rung '.length).trim();
      print(`Rung set to "${state.rung}".`);
      emitJson({ type: 'rung', rung: state.rung });
      showPrompt();
      continue;
    }

    let result;
    try {
      // eslint-disable-next-line no-await-in-loop
      result = await playTurn(state, input, { requestMove });
    } catch (error) {
      print(`Error: ${error.message}`);
      emitJson({ type: 'error', error: error.message });
      showPrompt();
      continue;
    }

    if (!result.accepted) {
      print(`Illegal move: ${result.error}`);
      emitJson({ type: 'rejected', input, error: result.error });
      showPrompt();
      continue;
    }

    state.fen = result.fen;
    print(`You played ${result.playerSan}.`);
    if (result.reply) {
      print(`Engine (${result.reply.engine}) replied ${result.reply.san} in ${result.reply.thinkingMs}ms.`);
    }
    emitJson({
      type: 'move',
      playerSan: result.playerSan,
      reply: result.reply,
      fen: result.fen,
      gameOver: result.gameOver,
      outcome: result.outcome,
    });

    if (result.error) print(`Warning: ${result.error}`);

    if (result.gameOver) {
      print(outcomeLine(result.outcome));
      over = true;
      break;
    }

    print(renderBoard(state.fen, { orientation: options.color }));
    showPrompt();
  }

  rl.close();
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`${error.stack || error.message}\n`);
    process.exitCode = 1;
  });
}
