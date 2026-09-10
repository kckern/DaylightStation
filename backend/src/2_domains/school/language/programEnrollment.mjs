import { RUNG_IDS } from './ladder.mjs';
import { normalizeUnits } from './units.mjs';

const ID_RE = /^[a-z0-9][a-z0-9_-]*$/i;

/** Validate teacher-authored language policy kept beside learner assignments. */
export function validateProgramEnrollment(raw, { corpus = null } = {}) {
  const errors = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { errors: ['program enrollment must be a mapping'] };
  if (typeof raw.programId !== 'string' || !raw.programId.trim()) errors.push('programId is required');
  if (raw.programId !== undefined && !ID_RE.test(String(raw.programId))) errors.push('programId must be alphanumeric with - or _');
  if (typeof raw.corpusId !== 'string' || !raw.corpusId.trim()) errors.push('corpusId is required');
  if (raw.lessonSize !== undefined && (!Number.isInteger(raw.lessonSize) || raw.lessonSize < 1)) {
    errors.push('lessonSize must be an integer >= 1');
  }
  if (raw.lessonSize === undefined) errors.push('lessonSize is required');
  // WHERE THE COURSE DIVIDES, in the teacher's words. Boundaries only: a unit
  // runs until the next one starts, so a gap or an overlap cannot be written
  // down. REJECTED rather than dropped — a mistyped chapter should stop an
  // enrollment, not leave a thousand sentences quietly unnamed on a card.
  //
  // Not `scope`, and not corpus `bands`: those SELECT which sentences are
  // studied, these NAME where the learner is. See `units.mjs`.
  if (raw.units !== undefined) {
    if (!Array.isArray(raw.units)) errors.push('units must be a list');
    else {
      raw.units.forEach((unit, i) => {
        if (!Number.isInteger(unit?.from) || unit.from < 1) errors.push(`units[${i}].from must be an integer >= 1`);
        if (typeof unit?.label !== 'string' || !unit.label.trim()) errors.push(`units[${i}].label is required`);
      });
      const starts = raw.units.map((unit) => unit?.from);
      if (new Set(starts).size !== starts.length) errors.push('units must not share a starting sentence');
    }
  }
  if (raw.dictationMode !== undefined && !['listen', 'copy'].includes(raw.dictationMode)) {
    errors.push('dictationMode must be listen or copy');
  }
  const rungs = raw.rungs ?? RUNG_IDS;
  if (!Array.isArray(rungs) || rungs.length === 0 || rungs.some((r) => !RUNG_IDS.includes(r))) {
    errors.push(`rungs must be a non-empty subset of ${RUNG_IDS.join(', ')}`);
  }
  if (raw.reward !== undefined) {
    if (!raw.reward || typeof raw.reward !== 'object' || Array.isArray(raw.reward)) errors.push('reward must be a mapping');
    else {
      if (!Number.isInteger(raw.reward.amount) || raw.reward.amount < 0) errors.push('reward.amount must be an integer >= 0');
      if (raw.reward.requiresSignoff !== undefined) errors.push('program rewards cannot require signoff');
    }
  }
  if (raw.scope !== undefined && !Array.isArray(raw.scope)) errors.push('scope must be an array');
  const bands = new Map((corpus?.bands ?? []).map((band) => [band.id, band]));
  const scope = [];
  for (const item of (Array.isArray(raw.scope) ? raw.scope : [])) {
    if (typeof item === 'string') {
      if (bands.has(item)) scope.push(item);
      else errors.push(`scope band '${item}' not found`);
    } else if (item?.range instanceof Array && item.range.length === 2
      && Number.isInteger(item.range[0]) && Number.isInteger(item.range[1])
      && item.range[0] >= 1 && item.range[1] <= (corpus?.size ?? 0) && item.range[0] <= item.range[1]) {
      scope.push({ range: [item.range[0], item.range[1]] });
    } else errors.push('scope entries must be known band ids or bounded integer ranges');
  }
  if (errors.length) return { errors };
  return { errors, enrollment: {
    programId: String(raw.programId), corpusId: String(raw.corpusId),
    lessonSize: raw.lessonSize, rungs: [...rungs],
    ...(raw.units !== undefined ? { units: normalizeUnits(raw.units) } : {}),
    ...(raw.dictationMode !== undefined ? { dictationMode: raw.dictationMode } : {}),
    ...(raw.reward ? { reward: { amount: raw.reward.amount } } : {}),
    ...(raw.scope !== undefined ? { scope } : {}),
  } };
}
