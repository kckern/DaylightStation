/**
 * Same-subject grouping (spec R6): `shown` tags whose spans overlap in time are asked of the
 * decision model pairwise, "do these describe the same thing on screen?", with both labels and
 * one frame from the overlap. A yes puts them under one `subject` id. Anything else (no, abstain,
 * timeout, error) leaves them separate: no merge on uncertainty.
 *
 * Pure of I/O: the question is the injected `ask(a, b, overlap)`; `jevSameSubject` builds the one
 * that talks to IDecisionGateway.
 */
import { cueModality } from '../../../../../../../shared/contracts/content-filter/cueModality.mjs';
import { sameSubjectQuestion, QUESTION_VERSION } from './refineQuestions.mjs';

const MIN_SPAN_SEC = 1; // a point tag is judged over a second centred on it

const spanOf = (c) => {
  const mid = (c.in + c.out) / 2;
  const half = Math.max(c.out - c.in, MIN_SPAN_SEC) / 2;
  return { in: mid - half, out: mid + half };
};

/** Pairs of shown cues whose spans overlap, with the overlap interval. */
export function overlapPairs(cues) {
  const shown = cues
    .filter((c) => c && c.in != null && c.out != null && cueModality(c) === 'shown')
    .map((c) => ({ c, s: spanOf(c) }))
    .sort((a, b) => a.s.in - b.s.in);
  const pairs = [];
  for (let i = 0; i < shown.length; i++) {
    for (let j = i + 1; j < shown.length && shown[j].s.in < shown[i].s.out; j++) {
      const a = shown[i]; const b = shown[j];
      pairs.push({ a: a.c, b: b.c, overlap: { in: Math.max(a.s.in, b.s.in), out: Math.min(a.s.out, b.s.out) } });
    }
  }
  return pairs;
}

/**
 * @param {object} p
 * @param {Array<{ id: string, label?: string, in: number, out: number }>} p.cues - on one clock
 * @param {Record<string, string>} [p.existing] - cue id -> subject id from the previous refined EDL
 * @param {boolean} [p.reask] - ignore `existing` and ask every overlapping pair again
 * @param {(a: object, b: object, overlap: {in: number, out: number}) => Promise<boolean|null>} p.ask
 * @param {(entry: object) => void} [p.log]
 * @returns {Promise<{ subjects: Record<string, string|null>, groups: string[][], asked: number, yes: number }>}
 *   subjects: cue id -> subject id (null = ungrouped, only set where a re-ask removed one);
 *   unchanged cues are omitted.
 */
export async function groupSubjects({ cues, existing = {}, reask = false, ask, log = () => {} }) {
  const prior = reask ? {} : existing;
  const parent = new Map();
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (x, y) => { parent.set(find(x), find(y)); };
  const pairs = overlapPairs(cues);
  for (const { a, b } of pairs) for (const c of [a, b]) if (!parent.has(c.id)) parent.set(c.id, c.id);
  // Earlier rulings stand: cues sharing a subject id stay together without asking.
  const bySubject = new Map();
  for (const id of parent.keys()) if (prior[id]) bySubject.set(prior[id], [...(bySubject.get(prior[id]) || []), id]);
  for (const ids of bySubject.values()) for (const id of ids.slice(1)) union(ids[0], id);
  let asked = 0; let yes = 0;
  for (const { a, b, overlap } of pairs) {
    if (find(a.id) === find(b.id)) continue;
    asked++;
    let same = false;
    try { same = (await ask(a, b, overlap)) === true; } catch (err) {
      log({ event: 'refine.subject.error', a: a.id, b: b.id, error: err.message, ...(err.code === 'JEV_TIMEOUT' ? { timeout: true } : {}) });
    }
    log({ event: 'refine.subject.pair', a: a.id, b: b.id, same });
    if (same) { yes++; union(a.id, b.id); }
  }
  const members = new Map();
  for (const id of parent.keys()) members.set(find(id), [...(members.get(find(id)) || []), id]);
  const subjects = {}; const groups = [];
  for (const ids of members.values()) {
    ids.sort();
    if (ids.length < 2) { if (reask && existing[ids[0]]) subjects[ids[0]] = null; continue; }
    const reuse = ids.map((id) => prior[id]).filter(Boolean).sort()[0];
    const subject = reuse || `subject-${ids[0]}`;
    for (const id of ids) subjects[id] = subject;
    groups.push(ids);
  }
  return { subjects, groups, asked, yes };
}

/**
 * The `ask` that uses Jev: one frame from the overlap plus both labels. Only a confident yes
 * counts; timeout, error and abstain are "no".
 * @param {object} p
 * @param {{ evaluate: Function }} p.decisions - IDecisionGateway
 * @param {{ frames: Function }} p.media
 * @param {string} p.src
 * @param {{ frameAt: Function, frameStart: Function }} p.timebase
 * @param {number} [p.width] - frame width sent to the model
 * @param {number} [p.timeoutMs]
 * @param {(entry: object) => void} [p.log]
 */
export function jevSameSubject({ decisions, media, src, timebase, width = 640, timeoutMs = 90000, log = () => {} }) {
  return async (a, b, overlap) => {
    const mid = (overlap.in + overlap.out) / 2;
    const [fr] = await media.frames(src, timebase.frameStart(timebase.frameAt(mid)), 1, { width });
    const built = sameSubjectQuestion(a.label, b.label, fr.png);
    const t0 = Date.now();
    const res = await decisions.evaluate(built.state, built.questions, { timeout: timeoutMs });
    const value = built.read(res.answers);
    log({ step: 'same-subject', a: a.id, b: b.id, v: QUESTION_VERSION, model: res.model, ms: Date.now() - t0, value });
    return value.v === true;
  };
}
