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
 * `resolveRoster`), which is how a content-provided roster gets in.
 */
/**
 * Each character tints the board's dark squares, so arriving at a new opponent
 * LOOKS like arriving somewhere new. Derived from the level rather than hand-
 * picked twenty-one times: the hue walks away from the friendly clay the board
 * starts on while the colour deepens and saturates, so the ladder darkens as it
 * climbs without anyone maintaining a palette. Cosmetic only — nothing about
 * addressing, promotion or play reads this.
 */
export function themeForLevel(level) {
  const t = Math.min(TOP_LEVEL, Math.max(0, level)) / TOP_LEVEL;
  const hue = Math.round(10 + t * 260);        // clay -> violet -> deep blue
  const saturation = Math.round(24 + t * 22);
  const lightness = Math.round(58 - t * 26);   // and steadily darker
  return `hsl(${hue} ${saturation}% ${lightness}%)`;
}

const GENERIC_PERSONAS = Object.freeze([
  'Curious and encouraging.', 'Sleepy but game for a challenge.', 'Thoughtful and gentle.',
  'Cheerful and adventurous.', 'Bouncy and optimistic.', 'Patient and warm.',
  'Friendly and snack-minded.', 'Calm and practical.', 'Quick-witted and bright.',
  'Quietly determined.', 'Fair and observant.', 'Composed and patient.',
  'Mysterious but kind.', 'Watchful and direct.', 'Bold and energetic.',
  'Reserved and steady.', 'Sharp and playful.', 'Strong-willed and focused.',
  'Tough and persistent.', 'Confident and exacting.', 'Formidable but respectful.',
]);

function profileText(value, max = 280) {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : null;
}

function profileList(value, maxItems = 6, maxText = 48) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => profileText(item, maxText)).filter(Boolean).slice(0, maxItems);
}

/** Normalize authored speech data; callers never receive raw configuration objects. */
export function normalizeDialogueProfile(value, legacyPersonality = null, level = 0, knownReferences = []) {
  const raw = value && typeof value === 'object' ? value : {};
  const lore = raw.lore && typeof raw.lore === 'object' ? raw.lore : {};
  const persona = profileText(raw.persona) || profileText(legacyPersonality) || GENERIC_PERSONAS[level] || 'A friendly chess opponent.';
  const chessVoice = profileText(raw.chess_voice)
    || 'Speak naturally about the immediate game at an age-appropriate level; do not overclaim analysis.';
  const references = profileList(lore.references);
  return Object.freeze({
    persona,
    voice: chessVoice,
    // Temporary read alias for archived/configured Chess profiles.
    chess_voice: chessVoice,
    lore: Object.freeze({
      type: Object.freeze(profileList(lore.type, 3, 24)),
      references: Object.freeze(references),
      known_references: Object.freeze(profileList(knownReferences, 80, 48)),
      use: references.length && lore.use === 'sparingly_as_playful_metaphor'
        ? 'sparingly_as_playful_metaphor'
        : 'never',
    }),
  });
}

export const DEFAULT_ROSTER = Object.freeze([
  'Pip', 'Dozy', 'Mumble', 'Clover', 'Tumble', 'Waddle', 'Biscuit',
  'Bramble', 'Piper', 'Quill', 'Ferris', 'Sable', 'Vesper', 'Corvin',
  'Talon', 'Grimsby', 'Vandal', 'Marrow', 'Skarn', 'Brutus', 'Malgrave',
].map((name, level) => Object.freeze({
  level, name, art: null, theme: themeForLevel(level), dialogue: normalizeDialogueProfile(null, null, level),
})));

/**
 * Promotion policy. Every number here is a judgement call, which is why they
 * live in YAML rather than in this file's constants.
 *
 * `max_best_moves: 0` — asking the engine for the best move is the engine
 * taking the turn. `max_hints: 1` — one look at what can legally move is a
 * child orienting themselves, not being carried. `max_takebacks: 1` follows the
 * hint rather than the best move: one slip corrected is a child noticing their
 * own mistake, which is the thing we want to encourage; a second is being
 * carried through the game.
 *
 * `unrestricted_below_level` exempts the bottom of the ladder from all three
 * ceilings, so the first rungs can teach the game before they teach the
 * discipline. Zero — the default — means the ceilings apply everywhere, which
 * is the behaviour this policy had before the key existed.
 */
export const DEFAULT_LADDER_POLICY = Object.freeze({
  window: 7,
  wins_required: 5,
  max_hints: 1,
  max_best_moves: 0,
  max_takebacks: 1,
  unrestricted_below_level: 0,
  movetime_ms: 400,
});

/**
 * What facing this character is like, in words a child can weigh.
 *
 * A rung is an engine and a pair of numbers, which tells a player nothing.
 * These say what to expect, so the ones still ahead read as something to work
 * towards rather than as locked doors.
 *
 * They are worth re-reading against `DEFAULT_LEVEL_RUNGS` after any re-spacing:
 * "Gives pieces away" only became true of level 0 when that rung stopped being
 * Stockfish, and a blurb that promises a beginner while the rung plays like a
 * club player is how the ladder misled everyone in the first place.
 */
const LEVEL_BLURBS = [
  'Gives pieces away', 'Barely looks', 'Misses a lot', 'Plays by accident',
  'Notices captures', 'Defends sometimes', 'Takes what you leave', 'Has a plan, briefly',
  'Punishes mistakes', 'Sees two moves', 'Steady and patient', 'Sets small traps',
  'Rarely blunders', 'Sees three moves', 'Attacks properly', 'Hard to surprise',
  'Sharp and quick', 'Takes no gifts', 'Grinds you down', 'Nearly perfect', 'Does not lose',
];

export function describeLevel(level) {
  const index = Math.min(TOP_LEVEL, Math.max(0, Math.floor(Number(level) || 0)));
  return LEVEL_BLURBS[index];
}

export function resolvePolicy(config) {
  const ladder = config?.ladder || {};
  const policy = { ...DEFAULT_LADDER_POLICY, ...(ladder.promotion || {}) };
  // A window smaller than the wins required can never be satisfied, which would
  // strand every player on level 0 with no visible cause.
  if (policy.wins_required > policy.window) policy.wins_required = policy.window;
  // The level->engine table travels with the policy, so `rungForLevel` needs
  // only the policy to answer. Kept out of the promotion block deliberately:
  // how a rung plays and what it takes to beat it are separate decisions, and a
  // household re-spacing the ladder should not have to restate its win rules.
  if (Array.isArray(ladder.levels) && ladder.levels.length) policy.levels = ladder.levels;
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
  const ladder = config?.ladder || {};
  // A named pack, so a household defines its rosters once and each child picks
  // one by name. Duplicating twenty-one entries per user was the alternative,
  // and it would drift the moment one of them was edited.
  const pack = ladder.roster_pack && ladder.rosters ? ladder.rosters[ladder.roster_pack] : null;
  const raw = Array.isArray(pack) && pack.length ? pack : ladder.roster;
  if (!Array.isArray(raw) || raw.length === 0) return DEFAULT_ROSTER;
  const knownReferences = profileList(ladder.lore_reference_vocabulary, 80, 48);
  return Object.freeze(DEFAULT_ROSTER.map((fallback, level) => {
    const entry = raw[level];
    if (entry === undefined || entry === null) return fallback;
    if (typeof entry === 'string') return Object.freeze({ ...fallback, name: entry });
    return Object.freeze({
      level,
      name: typeof entry.name === 'string' && entry.name ? entry.name : fallback.name,
      art: entry.art ?? entry.image ?? null,
      // A roster may set its own board tint; the derived one is the fallback,
      // so a content-provided list gets a themed board for free and can override it.
      theme: typeof entry.theme === 'string' && entry.theme ? entry.theme : fallback.theme,
      // Optional per-opponent piece set — a named style the board resolves.
      pieces: entry.pieces ?? null,
      // Authored speech content is server-resolved with the roster. `personality`
      // remains a migration alias for old household configuration.
      dialogue: normalizeDialogueProfile(entry.dialogue, entry.personality, level, knownReferences),
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
  // The first rungs teach the game, not the discipline. Below this level a
  // game counts however much help was leant on — the ceilings resume above it.
  if (currentLevel < Number(policy.unrestricted_below_level || 0)) return true;
  const help = record.help || {};
  if (Number(help.best_moves || 0) > Number(policy.max_best_moves)) return false;
  if (Number(help.hints || 0) > Number(policy.max_hints)) return false;
  if (Number(help.takebacks || 0) > Number(policy.max_takebacks)) return false;
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

/**
 * What each level actually plays like.
 *
 * The ladder used to be level N = Stockfish skill N. Measurement killed that:
 * `cli/chess-calibrate.cli.mjs` scored every skill level against positions from
 * the children's own games and found the entire 0-20 range clustered at 32-79
 * centipawns lost per move, while the child it was built for scored 111. Skill 0
 * was never a beginner — it is a weakened strong engine, and Stockfish has no
 * setting below it (`skill` clamps at 0, `UCI_Elo` at 1320, and `go nodes 1`
 * measured *stronger*, not weaker).
 *
 * So the bottom of the ladder is the homegrown opponent instead, whose depth and
 * blunder rate reach the band children are actually in. The measured ACPL of each
 * rung is in the comments — re-measure with the calibrate CLI before moving one.
 *
 * The two tiers meet where they measured equal: depth 2 with no blundering (74)
 * sits alongside Stockfish skill 0 (79).
 */
export const DEFAULT_LEVEL_RUNGS = Object.freeze([
  // Learning what hangs. The blunder rate is what a child perceives here; these
  // four measured within noise of each other on ACPL (~195-243), so they are
  // graded by how OFTEN a piece is given away rather than by search strength.
  { engine: 'homegrown', depth: 1, blunder_rate: 0.60 },  // ~200
  { engine: 'homegrown', depth: 1, blunder_rate: 0.40 },  // ~205
  { engine: 'homegrown', depth: 1, blunder_rate: 0.20 },  // ~200
  { engine: 'homegrown', depth: 1, blunder_rate: 0.00 },  // 195
  // Now it looks a move ahead, and the blunder rate becomes a real dial.
  { engine: 'homegrown', depth: 2, blunder_rate: 0.50 },  // 146
  { engine: 'homegrown', depth: 2, blunder_rate: 0.35 },  // 134
  { engine: 'homegrown', depth: 2, blunder_rate: 0.20 },  // 101
  { engine: 'homegrown', depth: 2, blunder_rate: 0.10 },  // 83
  { engine: 'homegrown', depth: 2, blunder_rate: 0.00 },  // 74
  // Stockfish from here up. The spacing below is PROVISIONAL: a depth-12
  // reference could not separate skill 0 from skill 20, so these rungs are
  // ordered by construction rather than by measurement. Movetime rises alongside
  // skill because skill alone did not separate them at a flat 400ms. Re-run the
  // calibrate CLI with a much deeper reference before trusting this half.
  { engine: 'stockfish', skill: 0, movetime_ms: 300 },
  { engine: 'stockfish', skill: 2, movetime_ms: 350 },
  { engine: 'stockfish', skill: 4, movetime_ms: 400 },
  { engine: 'stockfish', skill: 6, movetime_ms: 450 },
  { engine: 'stockfish', skill: 8, movetime_ms: 500 },
  { engine: 'stockfish', skill: 10, movetime_ms: 600 },
  { engine: 'stockfish', skill: 12, movetime_ms: 700 },
  { engine: 'stockfish', skill: 14, movetime_ms: 800 },
  { engine: 'stockfish', skill: 16, movetime_ms: 1000 },
  { engine: 'stockfish', skill: 18, movetime_ms: 1200 },
  { engine: 'stockfish', skill: 20, movetime_ms: 2000 },
].map(Object.freeze));

/**
 * The engine settings for a level, in the shape the move endpoint expects.
 *
 * A household can replace the whole table from YAML under `ladder.levels`, the
 * same way it replaces the roster — the rungs are data, and re-spacing a ladder
 * after a calibration run should not be a code change. A short or missing list
 * falls back to the default entry for that level, so a partial override cannot
 * punch a hole in the middle of the ladder.
 */
export function rungForLevel(level, policy) {
  const index = Math.min(TOP_LEVEL, Math.max(0, Math.floor(Number(level) || 0)));
  const table = Array.isArray(policy?.levels) && policy.levels.length ? policy.levels : DEFAULT_LEVEL_RUNGS;
  const entry = table[index] || DEFAULT_LEVEL_RUNGS[index];
  const base = { id: `level-${index}`, label: `Level ${index}` };
  if (entry?.engine === 'homegrown') {
    return {
      ...base,
      engine: 'homegrown',
      depth: Number(entry.depth) || 1,
      // `??` not `||`, so a rung that never blunders stays at 0 rather than
      // falling through to a default rate.
      blunder_rate: Number(entry.blunder_rate ?? 0),
      movetime_ms: policy?.movetime_ms ?? DEFAULT_LADDER_POLICY.movetime_ms,
    };
  }
  return {
    ...base,
    engine: 'stockfish',
    skill: Math.min(20, Math.max(0, Number(entry?.skill ?? index))),
    movetime_ms: entry?.movetime_ms ?? policy?.movetime_ms ?? DEFAULT_LADDER_POLICY.movetime_ms,
  };
}

export default {
  LADDER_SIZE, TOP_LEVEL, DEFAULT_ROSTER, DEFAULT_LADDER_POLICY, DEFAULT_LEVEL_RUNGS, themeForLevel,
  resolvePolicy, resolveRoster, normalizeDialogueProfile, createLadderProgress, normalizeProgress, describeLevel,
  countsTowardPromotion, promotionStatus, applyGameToProgress, availableOpponents, rungForLevel,
};
