/**
 * Content-filter resolver (pure logic, no DOM).
 *
 * The 3-layer cascade (see docs/_wip/plans/2026-06-30-content-filter-layer-design.md):
 *   L1 base EDL (observation: category/channel/severity/in/out)
 *   L2 profile   (category -> effect + params, theming)
 *   L3 override  (per-title: addCues, cueOverrides, plot cards)
 *
 * resolveEffectiveCues merges the three into a flat list of cues each carrying a
 * concrete `effect` (a name in the effect registry) plus its params. cuesActiveAt
 * reports which cues apply at a time. Keeping these pure makes filtering behavior
 * fully unit-testable; useContentFilter dispatches the effects to the DOM.
 */

// Params we carry from a profile rule / override onto the effective cue.
const PARAM_KEYS = ['sound', 'rect', 'style', 'level', 'text'];

/**
 * Resolve the effect rule for a category using longest-prefix matching.
 * Accepts either `{ effect }` or the legacy `{ action }` shorthand.
 * @returns {{effect: string}|null} rule (with normalized `effect`) or null when off/unmatched.
 */
export function resolveEffect(categoryPath, profile) {
  const rules = profile?.categories || {};
  const segments = String(categoryPath || '').split('/');
  for (let n = segments.length; n >= 1; n--) {
    const rule = rules[segments.slice(0, n).join('/')];
    if (!rule) continue;
    const effect = rule.effect || rule.action;
    if (!effect || effect === 'off') return null;
    return { ...rule, effect };
  }
  return null;
}

// Built-in widening defaults (ms). Pads absorb driver granularity + safety;
// approxWidthMs is the minimum coverage for a cue whose timing is NOT ms-precise
// (VidAngel second-approx points), so a short/zero-width cue still covers the word.
const WIDEN_DEFAULTS = {
  // srtLineWidthMs is wider than approxWidthMs because a caption-derived word's
  // exact position is uncertain (±~1s within the line) — a narrow window can end
  // just before a late-in-caption word and leak it (the "damn hands" case).
  mute: { padLeadMs: 200, padTrailMs: 150, approxWidthMs: 900, srtLineWidthMs: 1800 },
  bleep: { padLeadMs: 200, padTrailMs: 150, approxWidthMs: 900, srtLineWidthMs: 1800 },
  skip: { padLeadMs: 400, padTrailMs: 250, approxWidthMs: 0, srtLineWidthMs: 0 },
  // Overlay blurs from VidAngel visual point-tags (e.g. "cleavage is shown") are
  // often zero-width — without a min width they never fire (nudity shows unblurred).
  // Blur a few seconds around the flagged moment.
  'full-blur': { padLeadMs: 150, padTrailMs: 250, approxWidthMs: 3000, srtLineWidthMs: 0 },
  'censor-bar': { padLeadMs: 150, padTrailMs: 250, approxWidthMs: 3000, srtLineWidthMs: 0 },
  pixelate: { padLeadMs: 150, padTrailMs: 250, approxWidthMs: 3000, srtLineWidthMs: 0 },
};

/**
 * Widen an effective cue's [in,out] by effect-appropriate pads. Cues that are not
 * ms-precise are additionally expanded to a min width (centered) to absorb source
 * timing uncertainty — larger for `srt-line` cues (uncertain word position) than
 * for VidAngel second-approx points. Never returns a negative start.
 */
function widenCue(eff, treatments) {
  const base = WIDEN_DEFAULTS[eff.effect];
  if (!base) return eff;
  const t = (treatments && treatments[eff.effect]) || {};
  const lead = (t.padLeadMs ?? base.padLeadMs) / 1000;
  const trail = (t.padTrailMs ?? base.padTrailMs) / 1000;
  const approxWidth = (eff.precision === 'srt-line'
    ? (t.srtLineWidthMs ?? base.srtLineWidthMs)
    : (t.approxWidthMs ?? base.approxWidthMs)) / 1000;

  let start = eff.in - lead;
  let end = eff.out + trail;
  if (eff.precision !== 'ms' && approxWidth > 0 && end - start < approxWidth) {
    const center = (eff.in + eff.out) / 2;
    start = center - approxWidth / 2 - lead;
    end = center + approxWidth / 2 + trail;
  }
  eff.in = Math.max(0, start);
  eff.out = Math.max(eff.in + 0.001, end);
  return eff;
}

function mergeParams(target, ...sources) {
  for (const src of sources) {
    if (!src) continue;
    for (const k of PARAM_KEYS) if (src[k] !== undefined && target[k] === undefined) target[k] = src[k];
  }
  return target;
}

/**
 * Merge L1 EDL + L2 profile + L3 override into effective cues, each with a
 * concrete `effect` + params. Cues resolving to no effect (or disabled) are dropped.
 * @param {{edl: {cues: Array}, profile: Object, override?: Object}} args
 * @returns {Array} effective cues, sorted by start time
 */
export function resolveEffectiveCues({ edl, profile, override } = {}) {
  const overrides = override?.cueOverrides || {};
  const cardByCue = new Map((override?.cards || []).map((c) => [c.after, c.text]));
  // sync remaps imported (foreign-timed) cues onto this file: t_local = t*scale + offset.
  // Manual addCues are authored in local time, so they are NOT synced.
  const sync = override?.sync;
  const applySync = (t) => (sync ? t * (sync.scale ?? 1) + (sync.offsetSec || 0) : t);
  const base = [
    ...(edl?.cues || []).map((cue) => ({ cue, synced: true })),
    ...(override?.addCues || []).map((cue) => ({ cue, synced: false })),
  ];

  const out = [];
  for (const { cue, synced } of base) {
    const ov = overrides[cue.id] || {};
    if (ov.disabled) continue;

    // Effect precedence: override > cue (addCues) > profile rule > cue.type.
    // The cue.type fallback (VidAngel audio=mute/audiovisual=skip) applies ONLY when
    // no profile categories are defined — a profile WITH categories is authoritative
    // (an unmapped category means "don't filter"), so a family profile can e.g. leave
    // credits/alcohol unfiltered without the source default sneaking them back in.
    let rule = null;
    const explicit = ov.effect || cue.effect;
    const hasProfileRules = profile?.categories && Object.keys(profile.categories).length > 0;
    if (explicit) rule = { effect: explicit };
    else rule = resolveEffect(cue.category, profile) || (!hasProfileRules && cue.type ? { effect: cue.type } : null);
    if (!rule) continue;

    const eff = { ...cue, effect: rule.effect };
    if (ov.in != null || ov.out != null) {
      // Precise per-cue times (e.g. Whisper-snapped) are already LOCAL and ms —
      // use as-is, bypassing sync so they aren't offset a second time.
      if (ov.in != null) eff.in = ov.in;
      if (ov.out != null) eff.out = ov.out;
      eff.precision = ov.precision || 'ms';
    } else if (synced && sync) {
      eff.in = applySync(cue.in);
      eff.out = applySync(cue.out);
      // optional per-cue manual nudge (ms), applied after the global sync
      if (typeof ov.nudgeMs === 'number') { eff.in += ov.nudgeMs / 1000; eff.out += ov.nudgeMs / 1000; }
    }
    // Param precedence: override > cue > profile rule.
    mergeParams(eff, ov, cue, rule);
    if (cardByCue.has(cue.id)) eff.card = cardByCue.get(cue.id);

    // skip-card is driven by the hook (useContentFilter): on entering [in,out] it
    // seeks to `out`, PAUSES so the seek buffers behind the card, shows the card
    // for `holdSec`, then resumes instantly. Kept as one cue; just attach holdSec
    // + resolved card text here (no skip+title-card expansion).
    if (eff.effect === 'skip-card') {
      eff.holdSec = profile?.treatments?.['skip-card']?.holdSec ?? 2.5;
      eff.text = eff.card || eff.text || eff.label || 'Scene skipped.';
      out.push(eff);
      continue;
    }

    // Widen (pads + min-width for approx cues) so short/zero-width cues fire and
    // survive driver granularity. Runs after sync so pads are in local time.
    widenCue(eff, profile?.treatments);

    out.push(eff);
  }
  out.sort((a, b) => a.in - b.in || a.out - b.out);
  return out;
}

/**
 * All effective cues active at time `t` (start inclusive, end exclusive).
 * @returns {Array}
 */
export function cuesActiveAt(cues, t) {
  return (cues || []).filter((c) => t >= c.in && t < c.out);
}
