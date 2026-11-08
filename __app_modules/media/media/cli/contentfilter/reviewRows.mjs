/**
 * The Admin review list (ops:docs/superpowers/specs/2026-11-07-content-filter-admin-workshop-design.md,
 * "Check it"): one row per moment the filter acts on, as the household will get it, with the
 * reasons the machine is unsure of it. Moments are the preview rail's (`buildMoments`, folded by
 * `unitKey`), so Admin and the preview count the same things.
 *
 * Row = { id, peekId, kind: 'words'|'picture'|'scenes', group, label, category, modality, in, out,
 *         effect, card: { text, approved }|null, handFixed, unsure: string[] }
 */
import { buildMoments } from '../../browser/content-filter/preview/railItems.js';
import { cueModality, isWordLabel } from '../../../../../shared/contracts/content-filter/cueModality.mjs';
import { languageGroupOf } from '../../../../../shared/contracts/content-filter/languageGroups.mjs';

const OVERLAY = new Set(['blur', 'full-blur', 'pixelate']);
const ms = (t) => Math.round(t * 1000) / 1000;

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
 * @param {{ cues: object[], refined?: object, override?: object, refineReview?: { items?: object[], subjectsUnsure?: string[][] } }} p
 *   cues: `resolveEffectiveCues` output
 * @returns {object[]} rows, unsure first, then by `in`
 */
export function reviewRows({ cues, refined = null, override = null, refineReview = null }) {
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
      card: cardOf(m, override),
      handFixed: all.some((c) => c.handFixed === true),
      unsure: [...new Set(unsure)],
    };
  });
  return rows.sort((a, b) => (b.unsure.length > 0) - (a.unsure.length > 0) || a.in - b.in);
}
