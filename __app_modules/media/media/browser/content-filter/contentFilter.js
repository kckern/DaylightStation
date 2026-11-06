/**
 * Content-filter resolver (pure logic, no DOM).
 *
 * The 3-layer cascade (see ops:docs/_wip/plans/2026-06-30-content-filter-layer-design.md):
 *   L1 base EDL (observation: category/channel/severity/in/out)
 *   L2 profile   (category -> effect + params, theming)
 *   L3 override  (per-title: addCues, cueOverrides, plot cards)
 *
 * resolveEffectiveCues merges the three into a flat list of cues each carrying a
 * concrete `effect` (a name in the effect registry) plus its params. cuesActiveAt
 * reports which cues apply at a time. Keeping these pure makes filtering behavior
 * fully unit-testable; useContentFilter dispatches the effects to the DOM.
 */

// Timing a refine pass measured on this file: no approximate widening.
export const PRECISE = new Set(['ms', 'frame']);

// Overlay effects can be confined to a region track; the rest act on the whole cue.
const REGIONAL = new Set(['blur', 'censor-bar', 'pixelate']);

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
  if (!PRECISE.has(eff.precision) && approxWidth > 0 && end - start < approxWidth) {
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
/**
 * @param {{edl: {cues: Array}, profile: Object, override?: Object, part?: string|number|null}} args
 *   part: the media part being played. Refined cue times (`cueOverrides[id].refine.part`)
 *   apply only to that part; on another part the cue falls back to the synced coarse time.
 */
export function resolveEffectiveCues({ edl, profile, override, part = null } = {}) {
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
    let ov = overrides[cue.id] || {};
    if (ov.disabled) continue;
    if (ov.refine && part != null && ov.refine.part != null && String(ov.refine.part) !== String(part)) {
      // Refined on another edition: keep person-set keys, drop the measured timing
      const { in: _i, out: _o, precision: _p, frameIn: _fi, frameOut: _fo, segments: _s, regions: _r, refine: _rf, ...rest } = ov;
      ov = rest;
    }

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
    for (const part of expandMeasured(eff, ov)) out.push(widenCue(part, profile?.treatments));
  }
  out.sort((a, b) => a.in - b.in || a.out - b.out);
  return out;
}

/**
 * A refined cue may carry several on-screen segments and a region track.
 * Segments become separate cues (so a skip does not swallow the cutaway
 * between them); a region track splits an overlay cue into one cue per
 * keyframe with its `rect`. Non-overlay effects ignore regions.
 */
function expandMeasured(eff, ov) {
  let parts = [eff];
  if (Array.isArray(ov.segments) && ov.segments.length > 1) {
    parts = ov.segments.map((s, i) => ({ ...eff, id: `${eff.id}#${i}`, in: s.in, out: s.out }));
  }
  if (!REGIONAL.has(eff.effect) || !Array.isArray(ov.regions) || !ov.regions.length || eff.rect) return parts;
  const keys = ov.regions;
  const out = [];
  for (const p of parts) {
    for (let k = 0; k < keys.length - 1; k++) {
      const a = Math.max(p.in, keys[k].in); const b = Math.min(p.out, keys[k + 1].in);
      if (b <= a) continue;
      const key = keys[k];
      if (!key.whole && !(key.cells && key.cells.length)) continue; // track gap: nothing to cover
      const rect = key.whole ? undefined : (key.box || cellsRect(key.grid, key.cells));
      out.push({ ...p, id: `${p.id}@${k}`, in: a, out: b, ...(rect ? { rect } : {}) });
    }
  }
  return out.length ? out : parts;
}

/** Bounding rect (fractions of the picture) of grid cells, row-major from 0. */
export function cellsRect(grid, cells) {
  if (!grid || !cells?.length) return undefined;
  const rows = cells.map((c) => Math.floor(c / grid)); const cols = cells.map((c) => c % grid);
  const r0 = Math.min(...rows); const r1 = Math.max(...rows); const c0 = Math.min(...cols); const c1 = Math.max(...cols);
  return { x: c0 / grid, y: r0 / grid, w: (c1 - c0 + 1) / grid, h: (r1 - r0 + 1) / grid };
}

/**
 * All effective cues active at time `t` (start inclusive, end exclusive).
 * @returns {Array}
 */
export function cuesActiveAt(cues, t) {
  return (cues || []).filter((c) => t >= c.in && t < c.out);
}
