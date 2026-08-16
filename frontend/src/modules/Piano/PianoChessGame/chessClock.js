/**
 * The chess clock, derived rather than ticked.
 *
 * A clock is normally a stateful thing that counts down and must be started,
 * stopped and handed over on every move. None of that is stored here. Each move
 * already records when it landed, so both sides' times are a pure function of
 * the move list plus "what time is it now" — which means the clock cannot drift
 * out of step with the board, cannot be left running on the wrong side after a
 * takeback, and survives a remount without special handling.
 *
 * Two modes, because a clock and a time limit are different things. FIDE
 * requires one for competitive play (Laws of Chess, Article 6), but a child
 * learning to spell chords does not need a losing condition to benefit from
 * seeing where their time went. `up` shows time spent and nothing is ever
 * forfeited; `down` shows time remaining against a control.
 *
 * Nothing here ends a game. A flagged clock is reported so the board can say so,
 * and what to do about it is the caller's decision.
 */

export const CLOCK_MODES = Object.freeze(['off', 'up', 'down']);

export const DEFAULT_TIMING = Object.freeze({
  // Shown by default: the timer is information a player wants even when there
  // is nothing at stake, and an untimed game is the normal case here.
  mode: 'up',
  initial_ms: 10 * 60 * 1000,
  increment_ms: 0,
});

/** The timing block from config, with anything unusable replaced. */
export function resolveTiming(config) {
  const timing = config?.timing || {};
  const mode = CLOCK_MODES.includes(timing.mode) ? timing.mode : DEFAULT_TIMING.mode;
  const initial = Number(timing.initial_ms);
  const increment = Number(timing.increment_ms);
  return {
    mode,
    initial_ms: Number.isFinite(initial) && initial > 0 ? initial : DEFAULT_TIMING.initial_ms,
    // Zero is a real setting (no increment), so only a negative or non-numeric
    // value falls back.
    increment_ms: Number.isFinite(increment) && increment >= 0 ? increment : DEFAULT_TIMING.increment_ms,
  };
}

/**
 * A timestamp, or null if there isn't a usable one.
 *
 * `Number(x) || null` cannot be used here: it maps a legitimate 0 to null, and
 * 0 is a real instant — every test fixture and any replay anchored at the epoch
 * would silently read as "untimed".
 */
function stamp(value) {
  // `== null` first: Number(null) is 0, which is finite, so a null timestamp
  // would otherwise read as "played at the epoch" rather than as untimed — and
  // every duration measured against it would be a plausible-looking lie.
  if (value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * How long each move took, in order.
 *
 * The first move is measured from when the game started; every later one from
 * when the previous move landed. An entry with no timestamp yields null rather
 * than a wrong number — games archived before timing existed have no `at`, and
 * inventing durations for them would put fiction into the analysis.
 */
export function moveDurations(history, startedAt) {
  const durations = [];
  let previous = stamp(startedAt);
  for (const entry of history) {
    const at = stamp(entry?.at);
    if (at == null || previous == null) {
      durations.push(null);
      // A gap must not make the NEXT move look enormous: resume measuring from
      // the first timestamp that exists, not from before the hole.
      previous = at ?? previous;
      continue;
    }
    durations.push(Math.max(0, at - previous));
    previous = at;
  }
  return durations;
}

/** Milliseconds each side has spent, from the moves that have landed. */
export function elapsedBySide(history, startedAt) {
  const durations = moveDurations(history, startedAt);
  const spent = { w: 0, b: 0 };
  history.forEach((entry, index) => {
    const duration = durations[index];
    if (duration == null) return;
    if (entry.color === 'w' || entry.color === 'b') spent[entry.color] += duration;
  });
  return spent;
}

/**
 * The clock as it should be drawn right now.
 *
 * `now` is passed in rather than read from the system so the whole model stays
 * pure and testable — the display supplies a ticking value, tests supply a fixed
 * one.
 *
 * The side to move has their in-progress think added on top of what they have
 * already spent, which is what makes the running side's number move.
 */
export function clockState({
  history = [], startedAt = null, now = null, turn = 'w', timing = DEFAULT_TIMING, gameOver = false,
}) {
  const settings = resolveTiming({ timing });
  if (settings.mode === 'off') return { mode: 'off', shown: false, w: null, b: null };

  const spent = elapsedBySide(history, startedAt);
  // A finished game freezes: the loser's clock must not keep climbing on the
  // result screen, which would make the archived total disagree with the board.
  if (!gameOver && now != null) {
    const lastAt = history.length ? stamp(history[history.length - 1]?.at) : stamp(startedAt);
    if (lastAt != null && (turn === 'w' || turn === 'b')) {
      spent[turn] += Math.max(0, now - lastAt);
    }
  }

  const movesBy = (color) => history.filter((entry) => entry.color === color).length;
  const build = (color) => {
    if (settings.mode === 'up') {
      return { elapsedMs: spent[color], remainingMs: null, flagged: false };
    }
    // Increment is credited per completed move, so the side to move has not yet
    // earned the one for the move they are still thinking about.
    const credited = settings.increment_ms * movesBy(color);
    const remaining = settings.initial_ms + credited - spent[color];
    return { elapsedMs: spent[color], remainingMs: Math.max(0, remaining), flagged: remaining <= 0 };
  };

  return {
    mode: settings.mode,
    shown: true,
    turn,
    w: build('w'),
    b: build('b'),
  };
}

/**
 * Clock face text.
 *
 * Under ten minutes the seconds are what a player is reading, so the hours slot
 * is dropped entirely rather than padded with a zero that never changes. Past an
 * hour it reappears, because "72:14" is not a time anyone parses at a glance.
 */
export function formatClock(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--:--';
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}

/** A single move's think time, for the move list — terse, sub-minute aware. */
export function formatThink(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  if (ms < 1000) return '<1s';
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.round((ms % 60000) / 1000);
  return seconds ? `${minutes}m${seconds}s` : `${minutes}m`;
}

export default {
  CLOCK_MODES, DEFAULT_TIMING, resolveTiming, moveDurations, elapsedBySide, clockState,
  formatClock, formatThink,
};
