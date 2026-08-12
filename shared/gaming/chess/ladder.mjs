/**
 * The opponent ladder: twenty-one characters to beat, in order.
 *
 * The engine exposes skill levels 0 to 20 — a blundering buffoon at the bottom,
 * unbeatable at the top. A number is not something a child wants to defeat, so
 * each level is a character with a name and a face, and the ladder is climbed
 * rather than selected.
 *
 * Three rules, all deliberate:
 *
 *   - **No demotion.** Once an opponent is beaten they stay beaten. A ladder
 *     that can take a rung back turns a bad afternoon into lost ground, and the
 *     point is to make a child want to sit down again tomorrow.
 *   - **No skipping ahead.** You may replay anyone you have already beaten —
 *     that is practice, and practice is good — but the next character is the
 *     only one who can be promoted against.
 *   - **Help-heavy games do not count.** The record already knows how much help
 *     was asked for. A game where the engine was asked for the best move was
 *     partly played by the engine, and promoting on it would certify a skill
 *     nobody has.
 *
 * Promotion is by recent form, not by a lifetime tally: winning five of your
 * last seven says something about today, where "has beaten them nine times
 * since March" says nothing at all.
 *
 * This module is pure and shared. The backend owns the writes, but the kiosk
 * needs the same arithmetic to show a player where they stand, and two
 * implementations of a promotion rule would eventually disagree.
 */

export const LADDER_SIZE = 21;
export const TOP_LEVEL = LADDER_SIZE - 1;

/**
 * The house roster: docile at the bottom, frightening at the top.
 *
 * Names only — the face is an identicon generated from the name, so a roster
 * needs no artwork to be usable. Replaceable wholesale from YAML (see
 * `resolveRoster`), which is how a Pokémon roster gets in.
 */
export const DEFAULT_ROSTER = Object.freeze([
  'Pip', 'Dozy', 'Mumble', 'Clover', 'Tumble', 'Waddle', 'Biscuit',
  'Bramble', 'Piper', 'Quill', 'Ferris', 'Sable', 'Vesper', 'Corvin',
  'Talon', 'Grimsby', 'Vandal', 'Marrow', 'Skarn', 'Brutus', 'Malgrave',
].map((name, level) => Object.freeze({ level, name, art: null })));

/**
 * Promotion policy. Every number here is a judgement call, which is why they
 * live in YAML rather than in this file's constants.
 *
 * `max_best_moves: 0` — asking the engine for the best move is the engine
 * taking the turn. `max_hints: 1` — one look at what can legally move is a
 * child orienting themselves, not being carried.
 */
export const DEFAULT_LADDER_POLICY = Object.freeze({
  window: 7,
  wins_required: 5,
  max_hints: 1,
  max_best_moves: 0,
  movetime_ms: 400,
});

export function resolvePolicy(config) {
  const ladder = config?.ladder || {};
  const policy = { ...DEFAULT_LADDER_POLICY, ...(ladder.promotion || {}) };
  // A window smaller than the wins required can never be satisfied, which would
  // strand every player on level 0 with no visible cause.
  if (policy.wins_required > policy.window) policy.wins_required = policy.window;
  return Object.freeze(policy);
}

/**
 * The roster in play: the house one, or a YAML override.
 *
 * An override is a list of entries — a bare string is a name, an object may
 * carry `name` and `art`. Short lists fill from the default rather than
 * leaving holes, because a half-length roster would make the top of the ladder
 * unreachable and nothing about the failure would be visible on screen.
 */
export function resolveRoster(config) {
  const raw = config?.ladder?.roster;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_ROSTER;
  return Object.freeze(DEFAULT_ROSTER.map((fallback, level) => {
    const entry = raw[level];
    if (entry === undefined || entry === null) return fallback;
    if (typeof entry === 'string') return Object.freeze({ level, name: entry, art: null });
    return Object.freeze({
      level,
      name: typeof entry.name === 'string' && entry.name ? entry.name : fallback.name,
      art: entry.art ?? entry.image ?? null,
    });
  }));
}

/** A fresh climber: level 0 unlocked, nothing played. */
export function createLadderProgress() {
  return { unlocked_through: 0, results: [] };
}

/**
 * Read stored progress defensively.
 *
 * Progress is the one piece of state a child would be genuinely upset to lose,
 * and it lives in a hand-editable YAML file. A malformed or truncated file
 * reads as a fresh climber rather than throwing — but a level that is merely
 * out of range is clamped, so a typo cannot silently hand someone the top of
 * the ladder either.
 */
export function normalizeProgress(stored) {
  const base = createLadderProgress();
  if (!stored || typeof stored !== 'object') return base;
  const level = Number(stored.unlocked_through);
  base.unlocked_through = Number.isFinite(level) ? Math.min(TOP_LEVEL, Math.max(0, Math.floor(level))) : 0;
  base.results = Array.isArray(stored.results)
    ? stored.results
      .filter((entry) => entry && Number.isFinite(Number(entry.level)))
      .map((entry) => ({
        level: Math.min(TOP_LEVEL, Math.max(0, Math.floor(Number(entry.level)))),
        result: entry.result === 'win' || entry.result === 'loss' || entry.result === 'draw' ? entry.result : 'draw',
        counted: !!entry.counted,
        at: typeof entry.at === 'string' ? entry.at : null,
      }))
    : [];
  return base;
}

/**
 * Does this game count toward promotion?
 *
 * Unfinished games never do — you cannot be promoted for walking away — and
 * neither do games played against anyone other than the opponent being climbed,
 * which is what "no skipping ahead" means in arithmetic.
 */
export function countsTowardPromotion(record, policy, currentLevel) {
  if (!record || !record.completed) return false;
  if (Number(record.level) !== currentLevel) return false;
  const help = record.help || {};
  if (Number(help.best_moves || 0) > Number(policy.max_best_moves)) return false;
  if (Number(help.hints || 0) > Number(policy.max_hints)) return false;
  return true;
}

/** Wins among the last `window` counted games against the current opponent. */
export function promotionStatus(progress, policy) {
  const level = progress.unlocked_through;
  const recent = progress.results
    .filter((entry) => entry.level === level && entry.counted)
    .slice(-policy.window);
  const wins = recent.filter((entry) => entry.result === 'win').length;
  return {
    level,
    window: policy.window,
    needed: policy.wins_required,
    wins,
    played: recent.length,
    promotes: wins >= policy.wins_required,
    at_top: level >= TOP_LEVEL,
  };
}

/**
 * Fold a finished game into a player's progress.
 *
 * Returns the next progress and whether it promoted, so a caller can say so on
 * screen. Every game is remembered, counted or not — the record of what was
 * played is worth keeping even when it earns nothing.
 */
export function applyGameToProgress(stored, record, policy) {
  const progress = normalizeProgress(stored);
  const level = progress.unlocked_through;
  const counted = countsTowardPromotion(record, policy, level);
  const result = record?.result === 'win' || record?.result === 'loss' ? record.result : 'draw';

  const results = [...progress.results, {
    level: Number.isFinite(Number(record?.level)) ? Number(record.level) : level,
    result,
    counted,
    at: record?.ended_at || null,
  }];
  // Bounded: enough history to answer "how are they doing lately" for every
  // rung they have climbed, without growing without limit for a child who plays
  // this for years.
  const trimmed = results.slice(-(policy.window * LADDER_SIZE));

  const next = { unlocked_through: level, results: trimmed };
  const status = promotionStatus(next, policy);
  if (status.promotes && !status.at_top) {
    next.unlocked_through = level + 1;
    return { progress: next, promoted: true, from: level, to: next.unlocked_through };
  }
  return { progress: next, promoted: false, from: level, to: level };
}

/**
 * Which opponents a player may face: everyone up to and including the one they
 * are currently climbing. Never further — the ladder is the whole point.
 */
export function availableOpponents(progress, roster) {
  return roster.slice(0, progress.unlocked_through + 1);
}

/** The engine settings for a level, in the shape the move endpoint expects. */
export function rungForLevel(level, policy) {
  const skill = Math.min(TOP_LEVEL, Math.max(0, Math.floor(Number(level) || 0)));
  return { id: `level-${skill}`, label: `Level ${skill}`, skill, movetime_ms: policy.movetime_ms };
}

export default {
  LADDER_SIZE, TOP_LEVEL, DEFAULT_ROSTER, DEFAULT_LADDER_POLICY,
  resolvePolicy, resolveRoster, createLadderProgress, normalizeProgress,
  countsTowardPromotion, promotionStatus, applyGameToProgress, availableOpponents, rungForLevel,
};
