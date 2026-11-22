/**
 * The Admin review list (ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md,
 * "Check it"): one row per moment the filter acts on, as the household will get it, with the
 * reasons the machine is unsure of it. Moments are the preview rail's (`buildMoments`, folded by
 * `unitKey`), so Admin and the preview count the same things.
 *
 * Row = { id, peekId, kind: 'words'|'picture'|'scenes', group, label, category, modality, in, out,
 *         effect, acts, timing, card: { text, approved }|null, handFixed, unsure: string[], members: string[] }
 * members: the cue ids a ruling or a send-back applies to (one for a cue, all for a subject, none for a scene).
 * acts: false for a part the household's settings let play (effect 'off'). Every tag in the EDL is a
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
    const members = m.kind === 'scene' ? [] : [...new Set(all.map((c) => String(c.id).split(/[#@]/)[0]))];
    const isScene = m.kind === 'scene';
    const modality = isScene ? null : cueModality(m.cue);
    const unsure = [];
    for (const id of members) if (refineStatus.has(id)) unsure.push(`refine-${refineStatus.get(id)}`);
    if (!isScene && all.some((c) => c.precision === 'safe-window' && !c.handFixed)) unsure.push('safe-window');
    if (isScene && m.scene?.reviewNote) unsure.push('check-levels');
    if (!isScene && m.effect === 'skip-card' && isWordLabel(m.cue.label)) unsure.push('exchange-by-length');
    if (modality === 'shown' && OVERLAY.has(m.effect) && !all.some((c) => c.regions?.length)) unsure.push('untracked-visual');
    if (members.some((id) => subjectUnsure.has(id))) unsure.push('subject-unsure');
    return {
      id: m.key,
      peekId: m.id,
      kind: m.group,
      group: isScene ? (m.scene?.groups?.[0] ?? null) : (languageGroupOf(m.category) ?? (String(m.category || '').split('/')[0] || null)),
      label: m.label,
      category: m.category,
      modality,
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
  // (the sync the resolver uses); one a hidden scene covers is that scene's, as the resolver decides.
  const acted = new Set((cues || []).map((c) => baseId(c.id)));
  const sceneSpans = (cues || []).filter((c) => c.scene != null);
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
    if (sceneSpans.some((sp) => local.in >= sp.in - 0.5 && local.out <= sp.out + 0.5)) continue;
    const modality = cueModality(c);
    rows.push({
      id: `cue:${id}`, peekId: id, kind: modality === 'shown' ? 'picture' : 'words',
      group: languageGroupOf(c.category) ?? (String(c.category || '').split('/')[0] || null),
      label: c.label, category: c.category, modality, in: ms(local.in), out: ms(local.out),
      effect: 'off', acts: false, timing: timingOf([c]), card: null,
      handFixed: false, unsure: [], members: [id],
    });
  }
  return rows.sort((a, b) => (b.unsure.length > 0) - (a.unsure.length > 0) || (b.acts - a.acts) || a.in - b.in);
}
