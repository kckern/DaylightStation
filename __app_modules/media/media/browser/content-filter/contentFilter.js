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
      if (refinedEdl && syncFitsPart && cue.refine?.edges === 'coarse' && cue.regions?.length) {
        measured = { regions: cue.regions.map((k) => ({ ...k, in: mapTime(k.in, sync) })).filter((k) => k.in != null) };
      }
      if (!spans.length) { notInCut++; continue; }
      eff.in = spans[0].in;
      eff.out = spans[spans.length - 1].out;
      // optional per-cue manual nudge (ms), applied after the global sync
      if (typeof ov.nudgeMs === 'number') { eff.in += ov.nudgeMs / 1000; eff.out += ov.nudgeMs / 1000; }
    }
    // The effect must fit the cue's channel (said/shown/heard); a tracked shown
    // cue gets the regional blur, an untracked one full-blur.
    // Cues with no type or refine kind (hand-added) carry no channel evidence: left as authored.
    const kind = cue.kind ?? cue.refine?.kind ?? ov.refine?.kind;
    const modality = cueModality({ ...cue, ...(kind ? { kind } : {}) });
    const fitted = (cue.type || kind)
      ? fitEffectToChannel(eff.effect, modality, { hasRegions: !!measured?.regions?.length })
      : eff.effect;
    if (fitted !== eff.effect) {
      logger().sampled('content-filter.effect.adjusted', { id: cue.id, from: eff.effect, to: fitted, modality, source: explicit ? 'override' : 'profile' }, { maxPerMinute: 10, aggregate: true });
      eff.effect = fitted;
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
      groups.get(subject).push({ eff, measured });
      continue;
    }
    for (const piece of expandMeasured(eff, measured)) out.push(widenCue(piece, profile?.treatments));
  }
  for (const [subject, members] of groups) {
    for (const piece of resolveSubject(subject, members)) out.push(widenCue(piece, profile?.treatments));
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
 * spans (segments merged), following the best-tracked member's region track (most keyframes).
 * The strongest member effect wins (blur/full-blur follow the track: regional when tracked).
 * The track is held at either end so the whole union is covered. The piece id is the subject id.
 * Members' ids go in `cues` so scenes still recognise them.
 */
function resolveSubject(subject, members) {
  const rank = (e) => HIDE_RANK[e] ?? 0;
  const tracked = members.filter((m) => m.measured?.regions?.length)
    .sort((a, b) => b.measured.regions.length - a.measured.regions.length)[0];
  const lead = [...members].sort((a, b) => rank(b.eff.effect) - rank(a.eff.effect))[0].eff;
  const spans = members.flatMap(({ eff, measured }) => (measured?.segments?.length > 1 ? measured.segments : [{ in: eff.in, out: eff.out }]))
    .sort((a, b) => a.in - b.in);
  const union = [];
  for (const sp of spans) {
    const last = union[union.length - 1];
    if (last && sp.in <= last.out) last.out = Math.max(last.out, sp.out);
    else union.push({ in: sp.in, out: sp.out });
  }
  const first = union[0].in; const end = union[union.length - 1].out;
  let regions;
  if (tracked) {
    regions = tracked.measured.regions.map((k) => ({ ...k }));
    if (regions[0].in > first) regions.unshift({ ...regions[0], in: first });
    const last = regions[regions.length - 1];
    if (last.in < end) regions[regions.length - 1] = { ...last, in: end };
  }
  const effect = lead.effect === 'blur' || lead.effect === 'full-blur' ? (regions ? 'blur' : 'full-blur') : lead.effect;
  const base = { ...(tracked?.eff || lead), effect, id: subject, subject, in: first, out: end, cues: members.map((m) => m.eff.id) };
  delete base.segments; delete base.regions; delete base.rect;
  if (members.some((m) => !PRECISE.has(m.eff.precision))) base.precision = 'second-approx';
  return expandMeasured(base, { segments: union.length > 1 ? union : undefined, regions });
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
      if (members.has(base) || (c.cues || []).some((id) => members.has(id)) || (inside(c) && !keepOwn.has(base))) out.splice(i, 1);
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
