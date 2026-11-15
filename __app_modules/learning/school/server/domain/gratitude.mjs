import { SUBJECT_IDS } from './curriculum/unitValidation.mjs';
import { validGratitudeEvidence } from './gratitudeEvidence.mjs';

export const GRATITUDE_PROGRAM_ID = 'gratitude';
export const GRATITUDE_UNIT_ID = 'gratitude:daily';
export const GRATITUDE_TITLE = 'Gratitude';
export const GRATITUDE_PROMPT = Object.freeze({ id: 'gratitude', text: 'What are you grateful for today?', required: true });
export function validateGratitudeEnrollment(raw = {}) {
  const subject = raw.subject ?? 'scripture';
  if (!SUBJECT_IDS.includes(subject)) return { errors: ['gratitude subject must be a known School subject'] };
  return { errors: [], enrollment: { programId: GRATITUDE_PROGRAM_ID, corpusId: null, subject, title: String(raw.title || GRATITUDE_TITLE).trim() } };
}
export function gratitudeConfigOf(config = {}) {
  const value = config.gratitude ?? {};
  const positive = (v, fallback) => Number.isFinite(v) && v > 0 ? v : fallback;
  return { spacingDays: 7, cooldownMs: 30 * 60_000,
    judge: { model: value.judge?.model, minConfidence: Math.min(1, positive(value.judge?.min_confidence, 0.8)), timeoutMs: positive(value.judge?.timeout_ms, 8000) },
    extractor: { model: value.extractor?.model ?? config.debrief?.judge?.model ?? 'gpt-5-nano', timeoutMs: positive(value.extractor?.timeout_ms, 8000) },
  };
}
export const gratitudePublicationId = (learnerId, day) => `school-gratitude:${learnerId}:${day}`;

/** Event-derived evidence, separate from the browser view and all wall-clock policy. */
export function deriveGratitudeState(events = [], { now = null } = {}) {
  if(!validGratitudeEvidence(events))throw new Error('Invalid Gratitude evidence');
  const state = { phase: 'not-started', attemptId: null, draft: null, submitted: null, assessment: null, publication: null, subject: null, selectionId: null, retryAt: null, reason: null };
  const takeBases=new Map();
  for (const event of events) {
    switch (event.type) {
      case 'opened': if (state.phase === 'not-started') state.phase = 'draft'; break;
      case 'take-saved': {
        if(!takeBases.has(event.takeId))takeBases.set(event.takeId,state.draft?.text??'');
        const base=takeBases.get(event.takeId);
        state.draft={text:event.text?(base?`${base} ${event.text}`:event.text):base,via:'voice',audioRef:event.audioRef,takeId:event.takeId,edited:false};
        state.phase='draft';break;
      }
      case 'draft-saved': state.draft = {...event.draft,takeId:event.draft.audioRef===state.draft?.audioRef?state.draft?.takeId:null}; state.phase = 'draft'; break;
      case 'submitted': state.attemptId = event.attemptId; state.submitted = event; state.draft = event; state.assessment = null; state.publication = null; state.reason = null; state.retryAt=null; state.phase = 'assessing'; break;
      case 'assessed': state.assessment = event; if (event.verdict === 'uncertain') { state.phase = 'retry'; state.reason = 'unclear'; } break;
      case 'refused': state.phase = 'cooldown'; state.retryAt = event.retryAt; state.reason = event.reason; break;
      case 'publication-pending': state.publication = event; state.subject = event.subject; state.selectionId = event.selectionId; state.phase = 'pending'; state.reason = 'publication'; break;
      case 'completed': state.phase = 'completed'; state.selectionId = event.selectionId ?? state.selectionId; state.reason = null; state.retryAt = null; break;
      default: break;
    }
  }
  if (state.phase === 'cooldown' && Date.parse(state.retryAt) <= Date.parse(now)) { state.phase = 'retry'; state.retryAt = null; }
  return state;
}
export function recentGratitudeFacts(records, { learnerId, studyDay, spacingDays = 7 }) {
  const end = Date.parse(`${studyDay}T12:00:00Z`);
  return records.filter(r => r.learnerId === learnerId).flatMap(record => {
    const days = Math.round((end - Date.parse(`${record.studyDay}T12:00:00Z`)) / 86400000);
    if (days < 0 || days >= spacingDays) return [];
    const publication = record.events.find(e => e.type === 'publication-pending');
    return publication ? [{ id: publication.selectionId, studyDay: record.studyDay, text: publication.text, subject: publication.subject }] : [];
  });
}
