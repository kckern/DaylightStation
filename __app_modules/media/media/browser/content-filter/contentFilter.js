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
import { mapSpan, mapTime, snapToFrames } from '../../../../../shared/contracts/content-filter/syncMap.mjs';
import { cueModality, fitEffectToChannel, isWordLabel } from '../../../../../shared/contracts/content-filter/cueModality.mjs';
import { languageGroupOf, languageWordOf, groupOfTerm } from '../../../../../shared/contracts/content-filter/languageGroups.mjs';
import { getChildLogger } from '../../../../../frontend/src/lib/logging/singleton.js';
import { HIDE_RANK, SCENE_AXES, trustedAxes, sceneEffect } from '../../../../../shared/contracts/content-filter/sceneEffect.mjs';

let _logger;
const logger = () => (_logger ||= getChildLogger({ component: 'content-filter' }));

export const PRECISE = new Set(['ms', 'frame']);

// R3/R4: a tone is word-sized; tones closer than this merge; a said cue that is
// not a single word is muted up to LINE_MAX_SEC and skipped with a card beyond it.
export const TONE_MAX_SEC = 1.5;
export const TONE_MERGE_GAP_SEC = 0.3;
export const LINE_MAX_SEC = 4;
const AUDIO_EFFECTS = new Set(['mute', 'bleep', 'duck']);

// Overlay effects can be confined to a region track; the rest act on the whole cue.
const REGIONAL = new Set(['blur', 'censor-bar', 'pixelate']);
// Visual overlays: the effects a same-subject group (R6) can merge.
const OVERLAY = new Set(['blur', 'full-blur', 'censor-bar', 'pixelate', 'blackout']);
// How much of the picture an overlay hides: a group plays its strongest member's effect.
const STRENGTH = { blur: 1, pixelate: 2, 'censor-bar': 2, 'full-blur': 3, blackout: 4, skip: 5, 'skip-card': 5 };

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

const WORD_EFFECTS = new Set(['off', 'mute', 'bleep']);

/** A word-list (SRT) cue: its stamped `effect: mute` is a default, not a ruling. */
export const isWordListCue = (cue) => cue?.source === 'srt';

/**
 * R9: the rule for a language cue. Precedence: per-word exception
 * (`profile.languageWords`, off|mute|bleep) > a rule for a deeper category path >
 * a level-2 rule for the cue's group (`language/<group>` or any alias of it, e.g.
 * `language/language_racial`; the canonical key wins) > the old single `language`
 * rule. Not a language cue: the ordinary longest-prefix rule.
 */
export function resolveLanguageRule(cue, profile) {
  const group = languageGroupOf(cue?.category);
  if (!group) return resolveEffect(cue?.category, profile);
  const words = profile?.languageWords;
  const word = words ? languageWordOf(cue) : null;
  if (word && Object.prototype.hasOwnProperty.call(words, word)) {
    const effect = words[word];
    if (WORD_EFFECTS.has(effect)) return effect === 'off' ? null : { effect };
    logger().sampled('content-filter.language-word.invalid', { word, effect: String(effect) }, { maxPerMinute: 2, aggregate: true });
  }
  const rules = profile?.categories || {};
  const segs = String(cue.category).split('/');
  for (let n = segs.length; n > 2; n--) {
    const key = segs.slice(0, n).join('/');
    if (rules[key]) return resolveEffect(key, profile);
  }
  if (rules[`language/${group}`]) return resolveEffect(`language/${group}`, profile);
  for (const key of Object.keys(rules)) {
    const k = key.split('/');
    if (k.length === 2 && k[0] === 'language' && groupOfTerm(k[1]) === group) return resolveEffect(key, profile);
  }
  return resolveEffect(cue.category, profile);
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
  // A refined EDL keeps every cue on VidAngel's clock; this copy's sync maps it
  // (one speed, one offset per segment when the cut differs). Its precise cues
  // are only precise on the part the sync was fitted for.
  const refinedEdl = edl?.timebase?.clock === 'vidangel';
  const syncFitsPart = !!sync && (sync.part == null || part == null || String(sync.part) === String(part));
  const syncSpan = (a, b) => (sync ? mapSpan(a, b, sync) : [{ in: a, out: b }]);
  let notInCut = 0;
  const base = [
    ...(edl?.cues || []).map((cue) => ({ cue, synced: true })),
    ...(override?.addCues || []).map((cue) => ({ cue, synced: false })),
  ];

  const out = [];
  const groups = new Map();
  for (const { cue, synced } of base) {
    let ov = overrides[cue.id] || {};
    if (ov.disabled) continue;
    if (ov.refine && (refinedEdl || (part != null && ov.refine.part != null && String(ov.refine.part) !== String(part)))) {
      // Timing measured in one file's time: superseded by a refined EDL, or for another edition.
      const { in: _i, out: _o, precision: _p, frameIn: _fi, frameOut: _fo, segments: _s, regions: _r, refine: _rf, ...rest } = ov;
      ov = rest;
    }

    // Effect precedence: override > cue (addCues) > profile rule > cue.type.
    // The cue.type fallback (VidAngel audio=mute/audiovisual=skip) applies ONLY when
    // no profile categories are defined — a profile WITH categories is authoritative
    // (an unmapped category means "don't filter"), so a family profile can e.g. leave
    // credits/alcohol unfiltered without the source default sneaking them back in.
    let rule = null;
    // A word-list cue's stamped mute is a default: its language group and word exceptions decide (R9).
    const wordList = !!languageGroupOf(cue.category) && isWordListCue(cue);
    const explicit = ov.effect || (wordList ? null : cue.effect);
    const hasProfileRules = profile?.categories && Object.keys(profile.categories).length > 0;
    if (explicit) rule = { effect: explicit };
    else rule = resolveLanguageRule(cue, profile)
      || (!hasProfileRules ? (wordList && cue.effect ? { effect: cue.effect } : cue.type ? { effect: cue.type } : null) : null);
    if (!rule) continue;

    const eff = { ...cue, effect: rule.effect };
    let measured = ov;
    const coarseEdges = (cue.refine?.edges ?? ov.refine?.edges) === 'coarse';
    if (synced && refinedEdl && PRECISE.has(cue.precision)) {
      if (syncFitsPart) {
        // Precise on the reference clock: map through this copy's sync, snap
        // frame cues to this copy's frame grid. Segments and regions map too.
        const snap = (span) => (cue.precision === 'frame' ? snapToFrames(span, sync?.frames) : span);
        const spans = (cue.segments?.length ? cue.segments : [cue]).flatMap((sg) => syncSpan(sg.in, sg.out)).map(snap);
        if (!spans.length) { notInCut++; continue; }
        eff.in = spans[0].in; eff.out = spans[spans.length - 1].out;
        measured = {
          segments: spans.length > 1 ? spans : undefined,
          regions: cue.regions?.map((k) => ({ ...k, in: sync ? mapTime(k.in, sync) : k.in })).filter((k) => k.in != null),
        };
      } else {
        // No sync fitted for this part: the reference timing does not carry over exactly.
        const [span] = syncSpan(cue.in, cue.out);
        if (!span) { notInCut++; continue; }
        eff.in = span.in; eff.out = span.out; eff.precision = 'second-approx';
        delete eff.segments; delete eff.regions;
      }
      if (typeof ov.nudgeMs === 'number') { eff.in += ov.nudgeMs / 1000; eff.out += ov.nudgeMs / 1000; }
    } else if (ov.in != null || ov.out != null) {
      // Precise per-cue times (e.g. Whisper-snapped) are already LOCAL and ms —
      // use as-is, bypassing sync so they aren't offset a second time.
      if (ov.in != null) eff.in = ov.in;
      if (ov.out != null) eff.out = ov.out;
      eff.precision = ov.precision || 'ms';
    } else if (synced && sync) {
      const spans = syncSpan(cue.in, cue.out);
      // Coarse edges, measured region track (refined EDL): the track still applies over the synced window.
      if (refinedEdl && syncFitsPart && coarseEdges && cue.regions?.length) {
        measured = { regions: cue.regions.map((k) => ({ ...k, in: mapTime(k.in, sync) })).filter((k) => k.in != null) };
      }
      if (!spans.length) { notInCut++; continue; }
      eff.in = spans[0].in;
      eff.out = spans[spans.length - 1].out;
      // optional per-cue manual nudge (ms), applied after the global sync
      if (typeof ov.nudgeMs === 'number') { eff.in += ov.nudgeMs / 1000; eff.out += ov.nudgeMs / 1000; }
    }
    // The effect must fit the cue's channel (said/shown/heard). R2: a shown cue with a usable
    // region track (one sighting at least) gets the regional blur whether it asked for blur or
    // full-blur — a full-blur keeps its radius (`heavy`); an untracked one gets full-blur.
    // Cues with no type or refine kind (hand-added) carry no channel evidence: left as authored.
    const kind = cue.kind ?? cue.refine?.kind ?? ov.refine?.kind;
    const modality = cueModality({ ...cue, ...(kind ? { kind } : {}) });
    const typed = !!(cue.type || kind);
    const fitted = typed ? fitEffectToChannel(eff.effect, modality, { hasRegions: hasSighting(measured?.regions) }) : eff.effect;
    // R6: what this cue asks of its group when the group has a track: blur (audio effects fit to
    // it), full-blur, or a stronger effect as it is. The group decides what becomes regional.
    const groupEffect = !typed ? eff.effect
      : (modality === 'shown' && eff.effect === 'full-blur') ? 'full-blur'
        : fitEffectToChannel(eff.effect, modality, { hasRegions: true });
    if (fitted !== eff.effect) {
      logger().sampled('content-filter.effect.adjusted', { id: cue.id, from: eff.effect, to: fitted, modality, source: explicit ? 'override' : 'profile' }, { maxPerMinute: 10, aggregate: true });
      if (eff.effect === 'full-blur' && fitted === 'blur') eff.heavy = true;
      eff.effect = fitted;
    }
    // Coarse edges: the track covers only where it was seen, the cue's window is a guess. Hold
    // the track over the whole (padded) window, so the regional blur never hides less time than
    // the full-blur this cue would get untracked; an unsure keyframe inside hides the whole picture.
    if (coarseEdges && measured?.regions?.length && REGIONAL.has(eff.effect)) {
      const w = widenCue({ in: eff.in, out: eff.out, precision: eff.precision, effect: 'full-blur' }, profile?.treatments);
      eff.in = w.in; eff.out = w.out;
      measured = { ...measured, regions: coverTrack(measured.regions, eff.in, eff.out) };
    }
    // Param precedence: override > cue > profile rule.
    mergeParams(eff, ov, cue, rule);
    if (cardByCue.has(cue.id)) eff.card = cardByCue.get(cue.id);
    else if (ov.card?.text) eff.card = ov.card.text;

    // R4: a said cue that is not a single word is a line or an exchange. Up to
    // LINE_MAX_SEC it is muted (never a tone); longer, the scene is skipped behind a card.
    const isLine = modality === 'said' && (cue.type || kind) && AUDIO_EFFECTS.has(eff.effect)
      && !(cue.label && isWordLabel(cue.label));
    if (isLine) {
      const span = cue.tagIn != null && cue.tagOut != null ? cue.tagOut - cue.tagIn : eff.out - eff.in;
      if (span > LINE_MAX_SEC) {
        eff.effect = 'skip-card';
        eff.line = 'exchange';
        eff.text = eff.card || 'Scene skipped.';
        delete eff.sound;
      } else if (eff.effect === 'bleep') {
        eff.effect = 'mute';
        delete eff.sound;
      }
      if (eff.effect === 'mute') eff.line = 'remark';
    }
    // R3: where a tone would sit in a safe window = the tag's instant (mapped onto this file).
    if (eff.effect === 'bleep' && eff.precision === 'safe-window' && cue.tagIn != null) {
      const mid = (cue.tagIn + (cue.tagOut ?? cue.tagIn)) / 2;
      const t = synced && sync ? mapTime(mid, sync) : mid;
      if (t != null) eff.tagTime = t + (synced && typeof ov.nudgeMs === 'number' ? ov.nudgeMs / 1000 : 0);
    }

    // skip-card is driven by the hook (useContentFilter): on entering [in,out] it
    // seeks to `out`, PAUSES so the seek buffers behind the card, shows the card
    // for `holdSec`, then resumes instantly. Kept as one cue; just attach holdSec
    // + resolved card text here (no skip+title-card expansion).
    // R5: a skip the grown-up gave an approved card plays as a skip-card with that text.
    if (eff.effect === 'skip' && eff.card) eff.effect = 'skip-card';
    if (eff.effect === 'skip-card') {
      eff.holdSec = profile?.treatments?.['skip-card']?.holdSec ?? 2.5;
      eff.text = eff.line ? eff.text : (eff.card || eff.text || 'Scene skipped.');
      out.push(eff);
      continue;
    }

    // Widen (pads + min-width for approx cues) so short/zero-width cues fire and
    // survive driver granularity. Runs after sync so pads are in local time.
    // R6: shown cues of one subject resolve together, after the loop, to a single effect.
    const subject = ov.subject ?? cue.subject;
    if (subject && modality === 'shown' && OVERLAY.has(eff.effect)) {
      if (!groups.has(subject)) groups.set(subject, []);
      groups.get(subject).push({ eff, measured, groupEffect });
      continue;
    }
    for (const piece of expandMeasured(eff, measured)) out.push(widenCue(piece, profile?.treatments));
  }
  for (const [subject, members] of groups) {
    // Members are widened one by one inside resolveSubject; the pieces are not widened again.
    for (const piece of resolveSubject(subject, members, profile?.treatments)) out.push(piece);
  }
  const sceneSummary = applyScenes(out, { edl, profile, override, sync, refinedEdl });
  sizeTones(out);
  out.sort((a, b) => a.in - b.in || a.out - b.out);
  Object.defineProperty(out, 'sceneSummary', { value: sceneSummary, enumerable: false });
  // How many cues fall in scenes this copy does not have (for the debug overlay).
  Object.defineProperty(out, 'notInCut', { value: notInCut, enumerable: false });
  Object.defineProperty(out, 'syncSummary', { value: summarizeSync(sync, { refinedEdl, syncFitsPart }), enumerable: false });
  return out;
}

/**
 * R6: `shown` cues sharing a subject are one thing on screen: one effect over the union of their
 * spans (segments merged), each member first widened as it would be alone (its own effect's pads
 * and minimum width), so the group never hides less time than any member would untracked.
 *
 * With a usable track (the best-tracked member's, most keyframes; at least one sighting) blur and
 * full-blur are one regional blur along it (R2) — `heavy` (full-blur radius) when any member asked
 * for full-blur; a censor-bar/pixelate member outranks them and follows the track; blackout and
 * skips outrank all. Without a track every member counts as the effect it would play alone (an
 * untracked blur is a full-blur) and the strongest wins (blackout > full-blur > censor-bar/pixelate).
 * An authored rect stays only with no track and when every member plays the same effect alone.
 * The track is held at either end and its gaps hide the whole picture, so no instant of any
 * member's span is left uncovered. The piece id is the subject id; members' ids go in `cues` so
 * scenes still recognise them.
 */
function resolveSubject(subject, members, treatments) {
  const tracked = members.filter((m) => hasSighting(m.measured?.regions))
    .sort((a, b) => b.measured.regions.length - a.measured.regions.length)[0];
  const want = (m) => (tracked ? (m.groupEffect ?? m.eff.effect) : (m.eff.effect === 'blur' ? 'full-blur' : m.eff.effect));
  // On a track a full-blur becomes a (heavy) regional blur: below an opaque bar or pixelation.
  const rank = (e) => (tracked && e === 'full-blur' ? 1.5 : (STRENGTH[e] ?? 0));
  const leader = [...members].sort((a, b) => rank(want(b)) - rank(want(a)))[0];
  const lead = want(leader);
  const regionalBlur = !!tracked && (lead === 'blur' || lead === 'full-blur');
  const effect = regionalBlur ? 'blur' : (lead === 'blur' ? 'full-blur' : lead);
  const heavy = regionalBlur && members.some((m) => want(m) === 'full-blur' || m.eff.heavy);
  const spans = members.flatMap(({ eff, measured }) => (measured?.segments?.length > 1 ? measured.segments : [{ in: eff.in, out: eff.out }])
    .map((sp) => widenCue({ in: sp.in, out: sp.out, precision: eff.precision, effect: eff.effect }, treatments)))
    .sort((a, b) => a.in - b.in);
  const union = [];
  for (const sp of spans) {
    const last = union[union.length - 1];
    if (last && sp.in <= last.out) last.out = Math.max(last.out, sp.out);
    else union.push({ in: sp.in, out: sp.out });
  }
  const first = union[0].in; const end = union[union.length - 1].out;
  const regions = tracked && REGIONAL.has(effect) ? coverTrack(tracked.measured.regions, first, end) : undefined;
  const base = { ...leader.eff, effect, id: subject, subject, in: first, out: end, cues: members.map((m) => m.eff.id) };
  delete base.segments; delete base.regions; delete base.heavy;
  if (heavy) base.heavy = true;
  // An authored rect (e.g. a censor bar) stays only when there is no track to follow and every
  // member plays that same effect alone — otherwise some member hid more than the rect.
  const keepRect = !regions && REGIONAL.has(effect) && members.every((m) => m.eff.effect === effect);
  if (!keepRect) delete base.rect;
  if (members.some((m) => !PRECISE.has(m.eff.precision))) base.precision = 'second-approx';
  return expandMeasured(base, { segments: union.length > 1 ? union : undefined, regions });
}

/** A region track that saw its subject at least once (an all-gap track hides nothing regionally). */
const hasSighting = (regions) => Array.isArray(regions) && regions.some((k) => !isTrackGap(k));

const isTrackGap = (k) => !k.whole && !(k.cells && k.cells.length);
// A miss this short between two sightings is a keyframe Jev did not see the subject in, not the
// subject leaving: the box spanning both sightings is held over it.
const BRIDGE_SEC = 1;
// A whole-frame piece this short at a cut (frame snapping) is held under the next box instead.
const SLIVER_SEC = 0.1;
const keyRect = (k) => k.box || cellsRect(k.grid, k.cells);
const spanRect = (a, b) => {
  if (!a || !b) return undefined;
  const x = Math.min(a.x, b.x); const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/**
 * A region track made to cover [from, to] with no uncovered instant. The last keyframe is the
 * track's end marker. Before the first sighting the first box is held back to `from`; after the
 * last sighting the last box is held forward (to `to`, or the marker if later); a gap (empty or
 * unsure keyframe) between two sightings hides the box spanning both when the next sighting comes
 * within BRIDGE_SEC, else the whole picture. A track with no sighting at all is whole-frame throughout.
 */
function coverTrack(regions, from, to) {
  const keys = [...regions].sort((a, b) => a.in - b.in);
  const body = keys.length > 1 ? keys.slice(0, -1) : keys;
  const endAt = Math.max(to, keys.length > 1 ? keys[keys.length - 1].in : to);
  const firstSeen = body.findIndex((k) => !isTrackGap(k));
  if (firstSeen < 0) return [{ in: Math.min(from, body[0].in), whole: true }, { in: endAt, cells: [] }];
  let lastSeen = body.length - 1;
  while (isTrackGap(body[lastSeen])) lastSeen--;
  let prev = firstSeen; let missFrom = null;
  const out = body.map((k, i) => {
    if (!isTrackGap(k)) { prev = i; missFrom = null; return k; }
    if (i < firstSeen) return { ...body[firstSeen], in: k.in };
    if (i > lastSeen) return { ...body[lastSeen], in: k.in };
    missFrom ??= k.in;
    let next = i + 1;
    while (isTrackGap(body[next])) next++;
    const box = body[next].in - missFrom <= BRIDGE_SEC ? spanRect(keyRect(body[prev]), keyRect(body[next])) : undefined;
    return box ? { in: k.in, box, cells: body[next].cells, grid: body[next].grid } : { in: k.in, whole: true };
  });
  if (out[0].in > from) out.unshift({ ...body[firstSeen], in: from });
  out.push({ in: endAt, cells: [] });
  return out;
}

/**
 * R3: a bleep tone is word-sized. Each bleep piece keeps at most TONE_MAX_SEC of
 * tone (centred on the tag instant in a safe window, else on the piece); the rest
 * of its window is muted. Tones less than TONE_MERGE_GAP_SEC apart become one tone,
 * re-capped, with mute filling whatever the tone does not cover. Mutates `out`.
 */
function sizeTones(out) {
  const tones = out.filter((c) => c.effect === 'bleep').sort((a, b) => a.in - b.in);
  if (!tones.length) return;
  const keep = (c) => !(c.effect === 'bleep');
  const rest = out.filter(keep);
  const remainders = [];
  const cap = (c, centre) => {
    const len = c.out - c.in;
    if (len <= TONE_MAX_SEC) return { ...c, words: c.words || 1 };
    const lo = Math.min(Math.max(centre - TONE_MAX_SEC / 2, c.in), c.out - TONE_MAX_SEC);
    const hi = lo + TONE_MAX_SEC;
    const mute = (id, a, b) => remainders.push({ ...c, id, effect: 'mute', in: a, out: b, toneRemainder: true, words: 0, sound: undefined });
    if (lo > c.in) mute(`${c.id}#m0`, c.in, lo);
    if (c.out > hi) mute(`${c.id}#m1`, hi, c.out);
    return { ...c, in: lo, out: hi, words: c.words || 1 };
  };
  const sized = [];
  for (const c of tones) {
    const centre = c.tagTime ?? (c.in + c.out) / 2;
    const t = cap(c, Math.min(Math.max(centre, c.in), c.out));
    const prev = sized[sized.length - 1];
    if (prev && t.in - prev.out < TONE_MERGE_GAP_SEC) {
      const merged = { ...prev, id: prev.id, in: Math.min(prev.in, t.in), out: Math.max(prev.out, t.out), words: prev.words + t.words, merged: true };
      delete merged.tagTime;
      // The merged tone supersedes both tones' remainders (unique ids, no overlap
      // with the tone); the window takes in their extent so nothing they muted
      // is left uncovered, and mute fills what the merged tone does not cover.
      let wIn = merged.in; let wOut = merged.out;
      for (const id of [`${prev.id}#m0`, `${prev.id}#m1`, `${t.id}#m0`, `${t.id}#m1`]) {
        const i = remainders.findIndex((r) => r.id === id);
        if (i < 0) continue;
        wIn = Math.min(wIn, remainders[i].in); wOut = Math.max(wOut, remainders[i].out);
        remainders.splice(i, 1);
      }
      if (merged.out - merged.in > TONE_MAX_SEC) {
        const mid = (merged.in + merged.out) / 2;
        merged.in = mid - TONE_MAX_SEC / 2; merged.out = mid + TONE_MAX_SEC / 2;
      }
      const mute = (id, x, y) => remainders.push({ ...merged, id, effect: 'mute', in: x, out: y, toneRemainder: true, words: 0, sound: undefined });
      if (merged.in > wIn) mute(`${merged.id}#m0`, wIn, merged.in);
      if (wOut > merged.out) mute(`${merged.id}#m1`, merged.out, wOut);
      sized[sized.length - 1] = merged;
    } else sized.push(t);
  }
  out.length = 0;
  out.push(...rest, ...remainders, ...sized);
}

/**
 * Scenes from a refined EDL (ops:docs/superpowers/specs/2026-11-06-content-filter-scenes-design.md).
 * A scene's effect (profile `scenes:` thresholds on trusted axes, or the
 * override's `sceneOverrides.<id>.effect`) takes over from the cues inside it:
 * skip -> one skip-card; blackout -> a black overlay piece per synced segment.
 * Word mutes, credits and anything that hides more stay. Only an approved card
 * (sceneOverrides.<id>.card.text) is ever shown; otherwise generic text.
 * Mutates `out`; returns a summary for the hook's log.
 */
const SCENE_BRIDGE_SEC = 30;

function applyScenes(out, { edl, profile, override, sync, refinedEdl }) {
  const scenes = refinedEdl ? edl?.scenes || [] : [];
  const trusted = trustedAxes(edl);
  const summary = { scenes: scenes.length, byEffect: {}, untrusted: SCENE_AXES.filter((a) => !trusted.has(a)) };
  if (!scenes.length) return summary;
  const ov = override?.sceneOverrides || {};
  const holdSec = profile?.treatments?.['skip-card']?.holdSec ?? 2.5;
  // A grown-up turned these scenes off: their cues play by their own rules even
  // where an overlapping scene's span covers them.
  const keepOwn = new Set(scenes.filter((sc) => {
    const so = ov[sc.id];
    return so?.disabled || so?.effect === 'off';
  }).flatMap((sc) => sc.cues || []));
  // Effects first, then bridge neighbours of a shared group with the same effect
  // across a short gap, so the child sees one black (or one card), not black-picture-black.
  const ruled = [...scenes].sort((a, b) => a.in - b.in)
    .map((scene) => ({ scene, so: ov[scene.id] || {}, effect: sceneEffect(scene, { profile, sceneOverride: ov[scene.id] || {}, trusted }) }))
    .filter((r) => r.effect);
  const bridged = [];
  for (const r of ruled) {
    const prev = bridged[bridged.length - 1];
    const shares = prev && (prev.scene.groups || []).some((g) => (r.scene.groups || []).includes(g));
    if (prev && shares && prev.effect === r.effect && r.scene.in - prev.scene.out <= SCENE_BRIDGE_SEC) {
      prev.scene = { ...prev.scene, out: Math.max(prev.scene.out, r.scene.out), cues: [...(prev.scene.cues || []), ...(r.scene.cues || [])] };
      prev.so = prev.so.card ? prev.so : { ...prev.so, card: r.so.card };
      prev.bridged = (prev.bridged || 1) + 1;
      continue;
    }
    bridged.push({ ...r });
  }
  for (const { scene, so, effect } of bridged) {
    const spans = sync ? mapSpan(scene.in, scene.out, sync) : [{ in: scene.in, out: scene.out }];
    if (!spans.length) continue;
    const members = new Set(scene.cues || []);
    const inside = (c) => spans.some((sp) => c.in >= sp.in - 0.5 && c.out <= sp.out + 0.5);
    for (let i = out.length - 1; i >= 0; i--) {
      const c = out[i];
      const rank = HIDE_RANK[c.effect];
      if (rank == null || rank > HIDE_RANK[effect] || String(c.category || '').startsWith('credits')) continue;
      const base = String(c.id).split(/[#@]/)[0];
      const own = inside(c) && !keepOwn.has(base);
      if (!own && !members.has(base) && !(c.cues || []).some((id) => members.has(id))) continue;
      if (inside(c)) { out.splice(i, 1); continue; }
      // A member (or a subject piece with a member in the scene) that reaches outside the scene:
      // the scene takes over only its own time; the rest still hides.
      const rest = outsideSpans(c, spans);
      out.splice(i, 1, ...rest.map((r, k) => ({ ...c, id: rest.length > 1 ? `${c.id}#x${k}` : c.id, in: r.in, out: r.out })));
    }
    const approved = so.card?.text || null;
    const category = `scene/${(scene.groups || [])[0] || 'other'}`;
    summary.byEffect[effect] = (summary.byEffect[effect] || 0) + 1;
    if (effect === 'skip') {
      out.push({ id: scene.id, scene: scene.id, effect: 'skip-card', category, in: spans[0].in, out: spans[spans.length - 1].out,
        holdSec, text: approved || 'Scene skipped.', precision: 'frame' });
    } else {
      spans.forEach((sp, i) => out.push({ id: `${scene.id}#${i}`, scene: scene.id, effect, category, in: sp.in, out: sp.out,
        text: approved || 'Scene hidden.', cardSec: holdSec, firstPiece: i === 0, precision: 'frame' }));
    }
  }
  return summary;
}

/** The parts of [c.in, c.out] outside every span. */
function outsideSpans(c, spans) {
  let rest = [{ in: c.in, out: c.out }];
  for (const sp of spans) {
    rest = rest.flatMap((r) => {
      if (sp.out <= r.in || sp.in >= r.out) return [r];
      return [...(sp.in > r.in ? [{ in: r.in, out: sp.in }] : []), ...(sp.out < r.out ? [{ in: sp.out, out: r.out }] : [])];
    });
  }
  return rest.filter((r) => r.out - r.in > 1e-6);
}

/** One line for the debug overlay: how this copy is synced, or why refined times are not used. */
function summarizeSync(sync, { refinedEdl, syncFitsPart }) {
  if (!sync) return refinedEdl ? 'no sync: refined times not used' : 'no sync';
  const parts = [`sync ${sync.method || 'manual'}`];
  if (sync.segments?.length > 1) parts.push(`${sync.segments.length} segments`);
  if (typeof sync.medAbsResidSec === 'number') parts.push(`±${Math.round(sync.medAbsResidSec * 1000)}ms`);
  if (refinedEdl && !syncFitsPart) parts.push('other part: approx');
  return parts.join(' ');
}

/**
 * A refined cue may carry several on-screen segments and a region track.
 * Segments become separate cues (so a skip does not swallow the cutaway
 * between them); a region track splits an overlay cue into one cue per
 * keyframe with its `rect`. Non-overlay effects ignore regions.
 */
function expandMeasured(eff, ov) {
  let parts = [eff];
  if (Array.isArray(ov?.segments) && ov.segments.length > 1) {
    parts = ov.segments.map((s, i) => ({ ...eff, id: `${eff.id}#${i}`, in: s.in, out: s.out }));
  }
  if (!REGIONAL.has(eff.effect) || !Array.isArray(ov?.regions) || !ov.regions.length || eff.rect) return parts;
  const keys = ov.regions;
  const out = [];
  for (const p of parts) {
    for (let k = 0; k < keys.length - 1; k++) {
      const a = Math.max(p.in, keys[k].in); const b = Math.min(p.out, keys[k + 1].in);
      if (b <= a) continue;
      const key = keys[k];
      if (!key.whole && !(key.cells && key.cells.length)) continue; // track gap: nothing to cover
      const rect = key.whole ? undefined : (key.box || cellsRect(key.grid, key.cells));
      const prevPiece = out[out.length - 1];
      // A whole-frame sliver just before a box (a cut snapped to frames) takes that box.
      if (rect && prevPiece && !prevPiece.rect && prevPiece.in >= p.in && prevPiece.out === a && prevPiece.out - prevPiece.in < SLIVER_SEC) {
        prevPiece.out = b; prevPiece.rect = rect;
        continue;
      }
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
