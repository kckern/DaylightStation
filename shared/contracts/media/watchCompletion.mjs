/**
 * When a partial watch counts as finished, defined once for both sides of the wire.
 *
 * A percentage alone scales with length. The last tenth of a 30-minute class is a
 * cooldown; of a 5-hour racing longplay it is half an hour of riding (2026-10-20:
 * Sonic & Sega All Stars Racing was marked watched at 94% with a whole cup left and
 * its Plex resume point was wiped). For films the percentage is the right signal —
 * credits run ~4-10% of a modern feature — so the default stays "movie mode" and a
 * library opts into a stricter rule in the household media config (`media/config.yml`):
 *
 *   watch_completion:
 *     default: { min_percent: 90 }
 *     libraries:
 *       plex/14_fitness:            # progress namespace
 *         min_watch_sec: 30         # a seek or preview never counts
 *         tiers:                    # first tier whose max_duration_sec fits wins
 *           - { max_duration_sec: 2700, min_percent: 50 }
 *           - { min_percent: 95, max_remaining_sec: 300 }
 *
 * A natural end always counts and is the caller's to pass separately.
 */

/** Movie mode: 90% played, no cap on what is left. */
export const DEFAULT_RULE = Object.freeze({ minPercent: 90, maxRemainingSec: null, minWatchSec: null });

/**
 * Whether a partial watch counts as finished under `rule`.
 *
 * With no usable duration the remaining time is unknowable, so the cap is skipped.
 * With no watchTime the anti-seek floor is skipped (older records lack it).
 *
 * @param {{percent?:number, playhead?:number, duration?:number, watchTime?:number}} progress
 *   percent 0-100; seconds otherwise
 * @param {{minPercent:number, maxRemainingSec:number|null, minWatchSec:number|null}} [rule]
 * @returns {boolean}
 */
export function isWatchComplete({ percent, playhead, duration, watchTime } = {}, rule = DEFAULT_RULE) {
  const pct = Number(percent);
  if (!Number.isFinite(pct) || pct < rule.minPercent) return false;
  if (rule.minWatchSec != null && watchTime != null && Number(watchTime) < rule.minWatchSec) return false;
  if (rule.maxRemainingSec == null) return true;
  const total = Number(duration);
  const at = Number(playhead);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(at)) return true;
  return total - at <= rule.maxRemainingSec;
}

const RULE_KEYS = ['min_percent', 'max_remaining_sec', 'min_watch_sec'];
const ENTRY_KEYS = new Set([...RULE_KEYS, 'tiers']);
const TIER_KEYS = new Set([...RULE_KEYS, 'max_duration_sec']);

function readNumber(raw, key, { max = Infinity } = {}) {
  if (raw[key] == null) return null;
  const value = Number(raw[key]);
  if (typeof raw[key] === 'boolean' || !Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${key} must be a number from 0 to ${max === Infinity ? 'any' : max}`);
  }
  return value;
}

function readRule(raw, inherited) {
  return {
    minPercent: readNumber(raw, 'min_percent', { max: 100 }) ?? inherited.minPercent ?? DEFAULT_RULE.minPercent,
    maxRemainingSec: readNumber(raw, 'max_remaining_sec') ?? inherited.maxRemainingSec ?? null,
    minWatchSec: readNumber(raw, 'min_watch_sec') ?? inherited.minWatchSec ?? null,
  };
}

/** @returns {Array<{maxDurationSec:number|null, rule:object}>} tiers, last one catch-all */
function parseEntry(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('entry must be a mapping');
  const unknown = Object.keys(raw).filter((k) => !ENTRY_KEYS.has(k));
  if (unknown.length) throw new Error(`unknown key(s): ${unknown.join(', ')}`);
  const base = readRule(raw, {});
  if (raw.tiers == null) return [{ maxDurationSec: null, rule: base }];
  if (!Array.isArray(raw.tiers) || raw.tiers.length === 0) throw new Error('tiers must be a non-empty list');
  const tiers = raw.tiers.map((tier, i) => {
    if (!tier || typeof tier !== 'object') throw new Error(`tier ${i} must be a mapping`);
    const bad = Object.keys(tier).filter((k) => !TIER_KEYS.has(k));
    if (bad.length) throw new Error(`tier ${i}: unknown key(s): ${bad.join(', ')}`);
    return { maxDurationSec: readNumber(tier, 'max_duration_sec'), rule: readRule(tier, base) };
  });
  if (tiers[tiers.length - 1].maxDurationSec != null) throw new Error('last tier must have no max_duration_sec (catch-all)');
  return tiers;
}

function pickTier(tiers, duration) {
  const d = Number(duration);
  if (!Number.isFinite(d) || d <= 0) return tiers.length - 1;
  const i = tiers.findIndex((t) => t.maxDurationSec == null || d <= t.maxDurationSec);
  return i === -1 ? tiers.length - 1 : i;
}

/**
 * Compile the `watch_completion` config block. Never throws: a bad entry is
 * dropped (that library uses the default) and reported in `errors`.
 *
 * @param {object|undefined} raw
 * @returns {{ ruleFor:(namespace:string|null, duration?:number)=>object, errors:Array<{namespace:string, reason:string}> }}
 */
export function compileWatchCompletion(raw) {
  const errors = [];
  const compile = (namespace, entry) => {
    try { return parseEntry(entry); } catch (error) { errors.push({ namespace, reason: error.message }); return null; }
  };
  const fallback = [{ maxDurationSec: null, rule: DEFAULT_RULE }];
  const defaultTiers = (raw?.default != null && compile('default', raw.default)) || fallback;
  const libraries = new Map();
  const listed = raw?.libraries && typeof raw.libraries === 'object' ? raw.libraries : {};
  for (const [namespace, entry] of Object.entries(listed)) {
    const tiers = compile(namespace, entry);
    if (tiers) libraries.set(namespace, tiers);
  }
  const ruleFor = (namespace, duration) => {
    const own = namespace != null ? libraries.get(namespace) : undefined;
    const tiers = own || defaultTiers;
    const tier = pickTier(tiers, duration);
    return { ...tiers[tier].rule, source: own ? namespace : 'default', tier };
  };
  return { ruleFor, errors };
}

/**
 * The `completionRules` port composition hands to use cases. Reads config on every
 * call (so a household config reload takes effect) but recompiles only when the
 * block changed, and warns once per bad entry per change.
 *
 * @param {{ readConfig: () => object|undefined, logger?: object }} deps
 * @returns {{ ruleFor:(namespace:string|null, duration?:number)=>object }}
 */
export function createWatchCompletionRules({ readConfig, logger = null } = {}) {
  let lastRaw;
  let compiled = null;
  const current = () => {
    let raw;
    try { raw = readConfig?.(); } catch { raw = undefined; }
    if (compiled && raw === lastRaw) return compiled;
    lastRaw = raw;
    compiled = compileWatchCompletion(raw);
    for (const error of compiled.errors) logger?.warn?.('media.watch_completion.rule_invalid', error);
    return compiled;
  };
  return { ruleFor: (namespace, duration) => current().ruleFor(namespace, duration) };
}
