/**
 * The server's copy of a player's unfinished chess games.
 *
 * WHY THIS EXISTS. A game used to be resumable only from the tablet's own
 * localStorage, and only if its last move was under six hours old. On
 * 2026-10-09 a child one or two moves from mate left at ply 74; the next
 * morning the checkpoint was 12.7 hours idle, `chess.resume.stale-discarded`
 * fired, and a won position was gone. The game was in the household archive
 * the whole time, but nothing read it back. The server is now the source of
 * truth for an unfinished game and localStorage is only a fast path.
 *
 * Pure functions over a plain object, so the backend service, the one-off pin
 * CLI and the tests share ONE definition of "which game resumes".
 *
 * Slot shape:
 *   { version: 1, pinned: <game_id|null>,
 *     games: { <game_id>: { state, updated_at, record } } }
 * `state` is one of OPEN | FINISHED | ABANDONED | SUPERSEDED. Everything but
 * OPEN is terminal for the ordinary write path: a late debounced save must not
 * resurrect a game the child finished or walked away from. Only `pinGame`
 * reopens one, and it is deliberate.
 */

export const DEFAULT_RESUME_MAX_DAYS = 3;
export const MAX_SLOT_GAMES = 12;
export const STATE = Object.freeze({
  OPEN: 'open', FINISHED: 'finished', ABANDONED: 'abandoned', SUPERSEDED: 'superseded',
});
const DAY_MS = 24 * 60 * 60 * 1000;

export function emptySlot() {
  return { version: 1, pinned: null, games: {} };
}

export function normalizeSlot(raw) {
  if (!raw || typeof raw !== 'object' || !raw.games || typeof raw.games !== 'object') return emptySlot();
  return { version: 1, pinned: raw.pinned || null, games: { ...raw.games } };
}

/** The moves that make up the board as it stands: played, not taken back, in ply order. */
export function playedMoves(record) {
  return (Array.isArray(record?.moves) ? record.moves : [])
    .filter((move) => move && !move.undone)
    .slice()
    .sort((a, b) => (a.ply || 0) - (b.ply || 0));
}

/** True when `shorter`'s played line is an initial run of `longer`'s, from the same start. */
export function isPrefixLine(shorter, longer) {
  if ((shorter?.initial_fen || null) !== (longer?.initial_fen || null)) return false;
  const a = playedMoves(shorter);
  const b = playedMoves(longer);
  if (!a.length || a.length > b.length) return false;
  return a.every((move, i) => move.from === b[i].from && move.to === b[i].to);
}

/** What state does this record put its game in? */
export function stateForRecord(record) {
  if (record?.completed || record?.ended_by === 'game_over') return STATE.FINISHED;
  if (record?.ended_by === 'restarted') return STATE.ABANDONED;
  return STATE.OPEN;
}

function prune(slot) {
  const ids = Object.keys(slot.games);
  if (ids.length <= MAX_SLOT_GAMES) return slot;
  const rank = ids
    .map((id) => ({ id, open: slot.games[id].state === STATE.OPEN, at: Date.parse(slot.games[id].updated_at) || 0 }))
    .sort((x, y) => (Number(x.open) - Number(y.open)) || (x.at - y.at));
  const games = { ...slot.games };
  // Oldest closed games go first; an OPEN game is dropped only when nothing else is left to drop.
  for (const { id } of rank) {
    if (Object.keys(games).length <= MAX_SLOT_GAMES) break;
    if (id === slot.pinned) continue;
    delete games[id];
  }
  return { ...slot, games };
}

/**
 * File a record (a progress save, or an archive on the way out).
 * Returns `{ slot, state, applied, reason }`; `applied: false` is a no-op that
 * leaves the slot untouched.
 */
export function recordIntoSlot(rawSlot, record, now = new Date()) {
  const slot = normalizeSlot(rawSlot);
  const gameId = record?.game_id;
  if (!gameId) return { slot, state: null, applied: false, reason: 'no-game-id' };
  if (playedMoves(record).length === 0 && stateForRecord(record) === STATE.OPEN) {
    return { slot, state: null, applied: false, reason: 'no-moves' };
  }
  const incoming = stateForRecord(record);
  const existing = slot.games[gameId];
  if (existing && existing.state !== STATE.OPEN) {
    // Terminal is sticky against an open write; a close may still refine a close.
    if (incoming === STATE.OPEN) return { slot, state: existing.state, applied: false, reason: 'terminal' };
  }
  if (existing && incoming === STATE.OPEN && existing.state === STATE.OPEN) {
    // Out-of-order delivery: an older save arriving late must not roll the game back.
    const had = Date.parse(existing.record?.ended_at) || 0;
    const has = Date.parse(record?.ended_at) || 0;
    if (has && had && has < had) return { slot, state: STATE.OPEN, applied: false, reason: 'stale' };
  }
  const games = {
    ...slot.games,
    [gameId]: { state: incoming, updated_at: now.toISOString(), record },
  };
  {
    // A game that is a prefix of this one is the same game earlier in its life
    // (a reload resumes under a new id). It must not resurface when this one
    // ends — whether it ends finished, restarted or left.
    for (const [otherId, other] of Object.entries(games)) {
      if (otherId === gameId || other.state !== STATE.OPEN) continue;
      // A PIN SURVIVES UNTIL A MOVE IS PLAYED IN THE PINNED GAME. A resume files
      // the same line under a new id; with no new move it must not retire the pin.
      if (otherId === slot.pinned && playedMoves(record).length <= playedMoves(other.record).length) continue;
      if (other.record?.user_id === record.user_id && isPrefixLine(other.record, record)) {
        games[otherId] = { ...other, state: STATE.SUPERSEDED, superseded_by: gameId };
      }
    }
  }
  return { slot: prune({ ...slot, games }), state: incoming, applied: true, reason: null };
}

export function markAbandoned(rawSlot, gameId) {
  const slot = normalizeSlot(rawSlot);
  const existing = slot.games[gameId];
  if (!existing || existing.state !== STATE.OPEN) return { slot, applied: false };
  return {
    slot: { ...slot, games: { ...slot.games, [gameId]: { ...existing, state: STATE.ABANDONED } } },
    applied: true,
  };
}

function isResumableRecord(entry) {
  return entry?.state === STATE.OPEN && !entry.record?.completed && playedMoves(entry.record).length > 0;
}

/**
 * The one game that resumes: the pin if there is a live one, else the newest
 * OPEN game inside the window. `maxDays` 0 turns ordinary resume off.
 */
export function selectResumable(rawSlot, { now = new Date(), maxDays = DEFAULT_RESUME_MAX_DAYS } = {}) {
  const slot = normalizeSlot(rawSlot);
  const pinned = slot.pinned ? slot.games[slot.pinned] : null;
  if (pinned && isResumableRecord(pinned)) {
    return { gameId: slot.pinned, record: pinned.record, pinned: true, ageMs: Math.max(0, now - Date.parse(pinned.updated_at)) };
  }
  const days = Number(maxDays);
  if (!(days > 0)) return null;
  let best = null;
  for (const [gameId, entry] of Object.entries(slot.games)) {
    if (!isResumableRecord(entry)) continue;
    const at = Date.parse(entry.updated_at);
    if (!Number.isFinite(at) || now - at > days * DAY_MS) continue;
    if (!best || at > best.at) best = { gameId, entry, at };
  }
  return best
    ? { gameId: best.gameId, record: best.entry.record, pinned: false, ageMs: Math.max(0, now - best.at) }
    : null;
}

/**
 * Make `record` the game this player's next launch resumes. Reopens it even if
 * it was closed, and marks every OTHER open game that began after it as
 * superseded — kept in the slot, never deleted. `newerUnfinished` are archived
 * records the slot has no entry for yet; they are filed as superseded too.
 */
export function pinGame(rawSlot, record, now = new Date(), newerUnfinished = []) {
  const slot = normalizeSlot(rawSlot);
  const gameId = record?.game_id;
  if (!gameId) throw new Error('record has no game_id');
  if (playedMoves(record).length === 0) throw new Error('record has no played moves');
  // A finished game never resumes — not even by hand.
  if (record.completed || record.ended_by === 'game_over') throw new Error('game is finished; a finished game never resumes');
  const startedAt = Date.parse(record.started_at) || 0;
  const games = { ...slot.games };
  const superseded = [];
  for (const [otherId, entry] of Object.entries(games)) {
    if (otherId === gameId || entry.state !== STATE.OPEN) continue;
    const otherStart = Date.parse(entry.record?.started_at) || 0;
    if (otherStart > startedAt) {
      games[otherId] = { ...entry, state: STATE.SUPERSEDED, superseded_by: gameId };
      superseded.push(otherId);
    }
  }
  // Games the slot has never heard of (filed before the server kept any) that
  // began after this one: recorded as superseded, so the decision is on file.
  for (const other of newerUnfinished) {
    if (!other?.game_id || other.game_id === gameId || games[other.game_id]) continue;
    if ((Date.parse(other.started_at) || 0) <= startedAt) continue;
    games[other.game_id] = { state: STATE.SUPERSEDED, superseded_by: gameId, updated_at: now.toISOString(), record: other };
    superseded.push(other.game_id);
  }
  games[gameId] = {
    state: STATE.OPEN,
    updated_at: now.toISOString(),
    record: { ...record, completed: false, ended_by: record.ended_by || 'left' },
  };
  return { slot: { ...slot, pinned: gameId, games }, superseded };
}

export default {
  DEFAULT_RESUME_MAX_DAYS, STATE, emptySlot, normalizeSlot, playedMoves, isPrefixLine,
  stateForRecord, recordIntoSlot, markAbandoned, selectResumable, pinGame,
};
