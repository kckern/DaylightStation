/**
 * contentfilter audit <ratingKey> [--profile <name>] [--part <id>] [--json]
 *
 * Proof for a title (spec: ops:docs/superpowers/specs/2026-11-06-content-filter-pipeline-rules-design.md).
 * Loads the refined EDL (else the raw one), the household override with its profilePatch and the
 * profile exactly as GetContentFilter does, runs the player's own resolver (resolveEffectiveCues)
 * and measures what would play. Read-only.
 *
 * Hard checks (exit non-zero): no tone longer than 1.5 s; no audio effect on a `shown` cue; no
 * visual effect on a `said` cue. Reported (target flagged, not fatal): region-track DATA share of
 * `shown` cues (>= 70%), same-subject groups resolved to one effect, R4 line/exchange/card
 * counts, scene edge leaks, certification level, and language counts per R9 group.
 */
import { existsSync, readFileSync } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { resolveEffectiveCues, TONE_MAX_SEC } from '../../browser/content-filter/contentFilter.js';
import { cueModality } from '../../../../../shared/contracts/content-filter/cueModality.mjs';
import { LANGUAGE_GROUPS, languageGroupOf, groupOfTerm } from '../../../../../shared/contracts/content-filter/languageGroups.mjs';
import { mergeProfilePatch } from '../../../../../shared/contracts/content-filter/filterSettings.mjs';
import { refinedEdlName } from '../../server/domain/content-filter/refine/refinedEdl.mjs';
import { reviewRows } from './reviewRows.mjs';
import { certify } from '../../server/domain/content-filter/refine/certification.mjs';

export const AUDIT_USAGE = 'Usage: contentfilter audit <ratingKey> [--profile <name>] [--part <id>] [--json]\n\n'
  + 'Resolve the title as the player does and report: tone cap, channel match, region-track share,\n'
  + 'same-subject groups, R4 counts, scene edge leaks, certification and language counts per group.\n'
  + 'Exits 1 when a hard check (tone cap, channel match) fails.';

export const REGION_TARGET = 0.7;
const AUDIO = new Set(['mute', 'bleep', 'duck']);
const VISUAL = new Set(['blur', 'full-blur', 'censor-bar', 'pixelate', 'blackout']);
const OVERLAY = new Set(['blur', 'full-blur', 'censor-bar', 'pixelate']);
const GENERIC_CARD = 'Scene skipped.';
const EPS = 1e-6;
const baseId = (id) => String(id).split(/[#@]/)[0];
const pct = (n, d) => (d ? n / d : null);
const uniq = (a) => [...new Set(a)];

/**
 * Pure: measure one title. `resolve` is injectable so the hard checks can be exercised
 * with output the real resolver would never produce.
 */
export function computeAudit({ edl, profile, override, part = null, refineReview = null, resolve = resolveEffectiveCues }) {
  const overrides = override?.cueOverrides || {};
  const sourceCues = [...(edl?.cues || []), ...(override?.addCues || [])];
  const info = new Map();
  for (const cue of sourceCues) {
    if (info.has(cue.id)) continue;
    const ov = overrides[cue.id] || {};
    const kind = cue.kind ?? cue.refine?.kind ?? ov.refine?.kind;
    info.set(cue.id, { cue, ov, modality: cueModality({ ...cue, ...(kind ? { kind } : {}) }), subject: ov.subject ?? cue.subject });
  }
  const cues = resolve({ edl, profile, override, part });

  // pieces by source cue id (a same-subject piece belongs to each of its members)
  const pieces = new Map();
  const add = (id, c) => { if (!pieces.has(id)) pieces.set(id, []); pieces.get(id).push(c); };
  for (const c of cues) {
    if (c.scene) continue; // scene pieces stand for a whole scene, not a cue
    if (Array.isArray(c.cues) && c.cues.length) for (const m of uniq(c.cues)) add(m, c);
    else add(baseId(c.id), c);
  }

  // hard: tone cap
  const toneIds = uniq(cues.filter((c) => c.effect === 'bleep' && c.out - c.in > TONE_MAX_SEC + EPS).map((c) => c.id));
  // hard: channel
  const audioOnShown = []; const visualOnSaid = [];
  for (const c of cues) {
    if (c.scene) continue;
    const src = info.get(baseId(c.id));
    if (!src) continue;
    if (src.modality === 'shown' && AUDIO.has(c.effect)) audioOnShown.push(baseId(c.id));
    if (src.modality === 'said' && VISUAL.has(c.effect)) visualOnSaid.push(baseId(c.id));
  }

  // region tracks on shown cues that resolve to an overlay
  const trackedPiece = (c) => !!c.rect || String(c.id).includes('@');
  const shownCues = [...info.values()].filter(({ cue, modality }) => modality === 'shown' && (pieces.get(cue.id) || []).some((c) => OVERLAY.has(c.effect)));
  const trackedCues = shownCues.filter(({ cue }) => (pieces.get(cue.id) || []).some(trackedPiece));
  const coarseEdge = trackedCues.filter(({ cue, ov }) => (cue.refine?.edges ?? ov.refine?.edges) === 'coarse').length;
  const share = pct(trackedCues.length, shownCues.length);
  // Coverage of the DATA: shown cues carrying a region track whatever effect the profile picked
  // (a track with no sighting, or a stronger effect such as blackout, resolves full-frame).
  const withTrackData = shownCues.filter(({ cue, ov }) => (cue.regions?.length || ov.regions?.length)).length;
  const dataShare = pct(withTrackData, shownCues.length);

  // same-subject groups
  const bySubject = new Map();
  for (const s of info.values()) {
    if (s.modality !== 'shown' || !s.subject) continue;
    if (!bySubject.has(s.subject)) bySubject.set(s.subject, []);
    bySubject.get(s.subject).push(s.cue.id);
  }
  const groups = [...bySubject.entries()].filter(([, ids]) => ids.length > 1);
  const ownOf = (subject) => cues.filter((c) => !c.scene && (baseId(c.id) === subject || (c.subject === subject && Array.isArray(c.cues))));
  // A group none of whose members resolves to any piece (profile off, or a scene covers it) has no effect to disagree about.
  const noEffect = groups.filter(([subject, ids]) => !ownOf(subject).length && !ids.some((id) => (pieces.get(id) || []).length)).length;
  const resolvedOne = groups.filter(([subject, ids]) => {
    const own = ownOf(subject);
    if (!own.length) return false;
    const stray = ids.some((id) => (pieces.get(id) || []).some((c) => !own.includes(c)));
    return new Set(own.map((c) => c.effect)).size === 1 && !stray;
  }).length;
  const effective = groups.length - noEffect;

  // R4
  const wordsAsExchanges = uniq(cues.filter((c) => c.wordAsExchange).map((c) => baseId(c.id))).length;
  const lineIds = (kind) => uniq(cues.filter((c) => c.line === kind).map((c) => baseId(c.id)));
  const cards = cues.filter((c) => c.effect === 'skip-card' && !String(c.category || '').startsWith('credits'));
  const generic = cards.filter((c) => !c.text || c.text === GENERIC_CARD).length;

  // scene edge leaks: a member the scene's edges do not cover (the check SceneBuilder logs as scene-edge-uncovered)
  const byId = new Map((edl?.cues || []).map((c) => [c.id, c]));
  const leaks = [];
  for (const scene of edl?.scenes || []) {
    const cuesOut = (scene.cues || []).filter((id) => { const m = byId.get(id); return m && (m.in < scene.in - EPS || m.out > scene.out + EPS); });
    if (cuesOut.length) leaks.push({ scene: scene.id, cues: cuesOut });
  }

  // R9 language counts
  const language = Object.fromEntries([...LANGUAGE_GROUPS, 'unknown'].map((g) => [g, { total: 0, effects: {} }]));
  const seen = new Set();
  for (const { cue } of info.values()) {
    const group = languageGroupOf(cue.category);
    if (!group || seen.has(`${cue.id}|${cue.category}`)) continue;
    seen.add(`${cue.id}|${cue.category}`);
    const known = String(cue.category).split('/').slice(1).some((s) => groupOfTerm(s));
    const mine = [...(pieces.get(cue.id) || [])].sort((a, b) => a.in - b.in);
    const effect = (mine.find((c) => !c.toneRemainder) || mine[0])?.effect || 'off';
    const bucket = language[known ? group : 'unknown'];
    bucket.total++;
    bucket.effects[effect] = (bucket.effects[effect] || 0) + 1;
  }

  // Household nudges count (certification.mjs): a nudge that uncovers a word blocks.
  const nudged = Object.values(overrides).some((ov) => Number.isFinite(ov?.startMs) || Number.isFinite(ov?.endMs));
  const cert = edl?.timebase?.clock === 'vidangel' && nudged
    ? certify(edl, { at: edl.certification?.machine?.at ?? null, cueOverrides: overrides })
    : (edl?.certification || {});
  const checks = {
    toneCap: { ok: toneIds.length === 0, violations: toneIds.length, ids: toneIds, maxSec: TONE_MAX_SEC },
    channel: { ok: !audioOnShown.length && !visualOnSaid.length, audioOnShown: uniq(audioOnShown), visualOnSaid: uniq(visualOnSaid) },
  };
  return {
    rk: null, title: edl?.title ?? null, profile: null,
    ok: checks.toneCap.ok && checks.channel.ok,
    checks,
    // Proof metric: the DATA share (shown cues carrying a track). The resolved share is info:
    // a cue whose track never sighted its subject, or a stronger effect, plays full-frame.
    regions: { shown: shownCues.length, tracked: trackedCues.length, coarseEdge, share, withTrackData, dataShare, target: REGION_TARGET, pass: dataShare == null ? null : dataShare >= REGION_TARGET },
    subjects: { groups: groups.length, members: groups.reduce((n, [, ids]) => n + ids.length, 0), noEffect, resolvedOne, share: pct(resolvedOne, effective) },
    lines: { muted: lineIds('remark').length, skipped: lineIds('exchange').length, wordsAsExchanges, cardsApproved: cards.length - generic, cardsGeneric: generic },
    scenes: { total: (edl?.scenes || []).length, leaks, byEffect: cues.sceneSummary?.byEffect || {} },
    certification: { level: cert.level || 'none', ...(cert.blocking?.length ? { blocking: cert.blocking } : {}) },
    language,
    // The Admin review list: one row per moment, as the household gets it (reviewRows.mjs).
    rows: reviewRows({ cues, refined: edl, override, refineReview }),
  };
}

const p100 = (x) => (x == null ? 'n/a' : `${Math.round(x * 100)}%`);
const verdict = (ok) => (ok == null ? 'n/a' : ok ? 'PASS' : 'FAIL');

export function formatAudit(r) {
  const { checks: k, regions: g, subjects: s, lines: l, scenes: sc, certification: c } = r;
  const rows = [
    ['tone cap (<= 1.5 s)', verdict(k.toneCap.ok), k.toneCap.violations ? `${k.toneCap.violations} over: ${k.toneCap.ids.join(', ')}` : '0 over'],
    ['channel match', verdict(k.channel.ok), k.channel.ok ? 'none misplaced' : `audio on shown: ${k.channel.audioOnShown.join(', ') || '-'}; visual on said: ${k.channel.visualOnSaid.join(', ') || '-'}`],
    ['region tracks on shown', verdict(g.pass), `track data ${g.withTrackData}/${g.shown} (${p100(g.dataShare)}, target ${p100(g.target)}); resolved regional ${g.tracked}/${g.shown} (${p100(g.share)}), ${g.coarseEdge} coarse-edge`],
    ['same-subject groups', s.groups - s.noEffect ? verdict(s.resolvedOne === s.groups - s.noEffect) : 'n/a', `${s.groups} groups, ${s.members} members, ${s.resolvedOne} resolved to one effect (${p100(s.share)}), ${s.noEffect} with no effect (profile off or a scene covers them)`],
    ['lines / exchanges (R4)', '', `${l.muted} lines muted, ${l.skipped} exchanges skipped; ${l.wordsAsExchanges} words treated as exchanges; cards ${l.cardsApproved} approved, ${l.cardsGeneric} generic`],
    ['scene edge leaks', verdict(!sc.leaks.length), sc.leaks.length ? sc.leaks.map((x) => `${x.scene}: ${x.cues.join(' ')}`).join('; ') : `0 of ${sc.total} scenes`],
    ['certification', '', c.level + (c.blocking ? ` (approximate: ${c.blocking.join(', ')})` : '')],
  ];
  const w = Math.max(...rows.map((x) => x[0].length));
  const out = [`${r.title || r.rk} - audit under profile "${r.profile}": ${r.ok ? 'hard checks pass' : 'HARD CHECK FAILED'}`];
  for (const [a, b, c2] of rows) out.push(`  ${a.padEnd(w)}  ${b.padEnd(4)}  ${c2}`);
  out.push('  language by group (R9):');
  for (const [group, v] of Object.entries(r.language)) {
    out.push(`    ${group.padEnd(10)} ${String(v.total).padStart(3)}  ${Object.entries(v.effects).map(([e, n]) => `${e} ${n}`).join(', ')}`);
  }
  return out.join('\n');
}

const readYaml = (p) => yaml.load(readFileSync(p, 'utf8')) || {};

/** Load the cascade the way GetContentFilter does, then audit. Read-only. */
export function runAudit({ rk, flags = {}, mediaFilterDir, dataFilterDir }) {
  const rawPath = path.join(mediaFilterDir, 'edl', `${rk}.edl.yml`);
  if (!existsSync(rawPath)) throw new Error(`No EDL for ${rk} (${rawPath})`);
  const raw = readYaml(rawPath);
  let edl = raw;
  if (raw.sourceRef?.workId != null && raw.sourceRef?.tagSetId != null) {
    const refinedPath = path.join(mediaFilterDir, 'refined', refinedEdlName(raw));
    if (existsSync(refinedPath)) edl = readYaml(refinedPath);
  }
  const name = String(flags.profile || 'family').replace(/[^a-z0-9_-]/gi, '');
  const profilePath = path.join(dataFilterDir, 'profiles', `${name}.yml`);
  if (!existsSync(profilePath)) throw new Error(`No profile "${name}" (${profilePath})`);
  const overridePath = path.join(dataFilterDir, 'overrides', `${rk}.yml`);
  const override = existsSync(overridePath) ? readYaml(overridePath) : {};
  const profile = mergeProfilePatch(readYaml(profilePath), override.profilePatch);
  const reviewPath = path.join(dataFilterDir, 'review', `${rk}.refine.yml`);
  const refineReview = existsSync(reviewPath) ? readYaml(reviewPath) : null;
  const report = computeAudit({ edl, profile, override, part: flags.part ?? null, refineReview });
  return { ...report, rk, profile: name };
}
