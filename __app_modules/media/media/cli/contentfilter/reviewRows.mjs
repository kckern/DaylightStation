/**
 * The Admin review list (ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md,
 * "Check it"): one row per moment the filter acts on, as the household will get it, with the
 * reasons the machine is unsure of it. Moments are the preview rail's (`buildMoments`, folded by
 * `unitKey`), so Admin and the preview count the same things.
 *
 * Row = { id, peekId, kind: 'words'|'picture'|'scenes', group, label, category, modality, in, out,
 *         effect, acts, timing, card: { text, approved }|null, handFixed, unsure: string[], members: string[] }
 * members: the cue ids a ruling or a send-back applies to (one for a cue, all for a subject, none for a scene).
 * acts: false for a part that plays (effect 'off'; why: 'settings', or 'removed' by a verdict). Every tag in the EDL is a
 *   row, so the owner sees all of them, not only the ones the filter acts on (owner, 2026-11-21).
 * timing: 'refined' (measured to the frame/ms), 'safe-window' (a mute window that covers the word),
 *   or 'rough' (VidAngel's second-approx times, not refined yet).
 */
import { buildMoments } from '../../browser/content-filter/preview/railItems.js';
import { cueModality, isWordLabel } from '../../../../../shared/contracts/content-filter/cueModality.mjs';
import { languageGroupOf } from '../../../../../shared/contracts/content-filter/languageGroups.mjs';
import { REVIEW_ROWS_VERSION } from '../../server/domain/content-filter/reviewRowsVersion.mjs';
import { mapSpan } from '../../../../../shared/contracts/content-filter/syncMap.mjs';

const OVERLAY = new Set(['blur', 'full-blur', 'pixelate']);
const ms = (t) => Math.round(t * 1000) / 1000;
export { REVIEW_ROWS_VERSION };
const baseId = (id) => String(id).split(/[#@]/)[0];
/** The source cue ids a resolved piece stands for: a subject's members, a merged tone's tones, else its own. */
const sourceIds = (c) => [...new Set([baseId(c.id), ...(c.cues || []), ...(c.mergedFrom || [])].map(baseId))]
  .filter((id) => !(c.subject != null && id === String(c.subject) && (c.cues || []).length));
const AUDIO_FX = new Set(['mute', 'bleep', 'duck']);
const PICTURE_FX = new Set(['blur', 'full-blur', 'pixelate', 'censor-bar', 'blackout']);
/** Does a resolved piece hide this channel? A skip hides both. */
const hides = (effect, modality) => (effect === 'skip' || effect === 'skip-card')
  || (modality === 'shown' ? PICTURE_FX.has(effect) : AUDIO_FX.has(effect));

/** The worst timing among a row's pieces: one rough piece makes the row rough. */
export function timingOf(cues) {
  const each = (cues || []).map((c) => (c?.precision === 'safe-window' ? 'safe-window' : (c?.precision === 'ms' || c?.precision === 'frame') ? 'refined' : 'rough'));
  if (!each.length) return 'rough';
  return each.includes('rough') ? 'rough' : each.includes('safe-window') ? 'safe-window' : 'refined';
}

function cardOf(m, override) {
  if (m.kind === 'scene') {
    const approved = override?.sceneOverrides?.[m.id]?.card?.text;
    if (approved) return { text: approved, approved: true };
    const draft = m.scene?.card?.text;
    return draft ? { text: draft, approved: false } : null;
  }
  const ov = override?.cueOverrides?.[m.id];
  if (ov?.card?.text) return { text: ov.card.text, approved: true };
  return ov?.cardDraft?.text ? { text: ov.cardDraft.text, approved: false } : null;
}

/**
 * @param {{ cues: object[], source?: object[], refined?: object, override?: object, refineReview?: { items?: object[], subjectsUnsure?: string[][] } }} p
 *   cues: `resolveEffectiveCues` output; source: every cue in the EDL (and addCues), so parts the
 *   filter lets play are rows too (`acts: false`)
 * @returns {object[]} rows, unsure first, then by `in`
 */
export function reviewRows({ cues, source = [], refined = null, override = null, refineReview = null }) {
  const refineStatus = new Map((refineReview?.items || []).map((i) => [String(i.id), i.status]));
  const subjectUnsure = new Set((refineReview?.subjectsUnsure || []).flat().map(String));
  const pieces = new Map();
  for (const c of cues || []) {
    const k = c.scene != null ? `scene:${c.scene}` : c.subject != null ? `subject:${c.subject}` : null;
    if (k) pieces.set(k, [...(pieces.get(k) || []), c]);
  }
  const rows = buildMoments(cues, refined?.scenes).map((m) => {
    const all = pieces.get(m.key) || [m.cue];
    const members = m.kind === 'scene' ? [] : [...new Set(all.flatMap(sourceIds))];
    const isScene = m.kind === 'scene';
    const modality = isScene ? null : cueModality(m.cue);
    const tracked = all.some((c) => c.regions?.length);
    const unsure = [];
    for (const id of members) if (refineStatus.has(id)) unsure.push(`refine-${refineStatus.get(id)}`);
    if (!isScene && all.some((c) => c.precision === 'safe-window' && !c.handFixed)) unsure.push('safe-window');
    if (isScene && m.scene?.reviewNote) unsure.push('check-levels');
    if (!isScene && m.effect === 'skip-card' && isWordLabel(m.cue.label)) unsure.push('exchange-by-length');
    if (modality === 'shown' && OVERLAY.has(m.effect) && !tracked) unsure.push('untracked-visual');
    if (members.some((id) => subjectUnsure.has(id))) unsure.push('subject-unsure');
    return {
      id: m.key,
      peekId: m.id,
      kind: m.group,
      group: isScene ? (m.scene?.groups?.[0] ?? null) : (languageGroupOf(m.category) ?? (String(m.category || '').split('/')[0] || null)),
      label: m.label,
      category: m.category,
      modality,
      tracked: !!tracked,
      in: ms(m.in),
      out: ms(m.out),
      effect: m.effect,
      acts: true,
      timing: timingOf(all),
      card: cardOf(m, override),
      handFixed: all.some((c) => c.handFixed === true),
      unsure: [...new Set(unsure)],
      members,
    };
  });
  // Parts the household lets play: every source cue that resolved to nothing. On this file's clock
  // (the sync the resolver uses). A cue another piece stands for (a subject's member, a merged
  // tone) is that piece's; so is one a scene lists or one a piece on its channel already covers (a
  // stacked picture effect trimmed away, a scene that swallowed it).
  const acted = new Set((cues || []).flatMap(sourceIds));
  for (const sc of refined?.scenes || []) {
    if ((cues || []).some((c) => c.scene != null && String(c.scene) === String(sc.id))) for (const id of sc.cues || []) acted.add(baseId(id));
  }
  const disabled = new Set(Object.entries(override?.cueOverrides || {}).filter(([, ov]) => ov?.disabled).map(([id]) => baseId(id)));
  const sync = override?.sync || null;
  const added = new Set((override?.addCues || []).map((c) => String(c.id))); // authored in local time
  const seen = new Set();
  for (const c of source || []) {
    const id = baseId(c.id);
    if (acted.has(id) || seen.has(id)) continue;
    seen.add(id);
    const a = Number(c.in) || 0; const b = Number(c.out ?? c.in) || a;
    const spans = sync && !added.has(String(c.id)) ? mapSpan(a, Math.max(a, b), sync) : [{ in: a, out: Math.max(a, b) }];
    if (!spans.length) continue; // not in this copy's cut
    const local = { in: spans[0].in, out: spans[spans.length - 1].out };
    const modality = cueModality(c);
    if ((cues || []).some((p) => hides(p.effect, modality) && local.in >= p.in - 0.5 && local.out <= p.out + 0.5)) continue;
    rows.push({
      id: `cue:${id}`, peekId: id, kind: modality === 'shown' ? 'picture' : 'words',
      group: languageGroupOf(c.category) ?? (String(c.category || '').split('/')[0] || null),
      label: c.label, category: c.category, modality, tracked: !!(c.regions?.length || override?.cueOverrides?.[id]?.regions?.length), in: ms(local.in), out: ms(local.out),
      effect: 'off', acts: false, why: disabled.has(id) ? 'removed' : 'settings', timing: timingOf([c]), card: null,
      handFixed: false, unsure: [], members: [id],
    });
  }
  // VidAngel sometimes tags one moment twice (same label, same span): one row, both cues as members,
  // so the parent reviews it once (review 2026-11-21: two identical "G*d 10:29" rows in Sonic).
  const merged = [];
  const byMoment = new Map();
  for (const r of rows) {
    const k = r.kind !== 'scenes' && r.id.startsWith('cue:') ? `${r.acts}|${r.label}|${r.in}|${r.out}|${r.effect}` : null;
    const twin = k ? byMoment.get(k) : null;
    if (twin) { twin.members = [...new Set([...twin.members, ...r.members])]; twin.unsure = [...new Set([...twin.unsure, ...r.unsure])]; continue; }
    if (k) byMoment.set(k, r);
    merged.push(r);
  }
  return merged.sort((a, b) => (b.unsure.length > 0) - (a.unsure.length > 0) || (b.acts - a.acts) || a.in - b.in);
}
