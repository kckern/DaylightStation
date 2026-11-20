import { SUBJECT_IDS } from './curriculum/unitValidation.mjs';
import { validGratitudeEvidence, combineGratitudeAnswers } from './gratitudeEvidence.mjs';

export { combineGratitudeAnswers };

export const GRATITUDE_PROGRAM_ID = 'gratitude';
export const GRATITUDE_UNIT_ID = 'gratitude:daily';
export const GRATITUDE_TITLE = 'Gratitude';
export const GRATITUDE_PROMPT = Object.freeze({ id: 'gratitude', text: 'What are you grateful for today?', required: true });
/** The transcription prompt. On silence or noise the transcriber can hand this hint back as the "words". */
export const GRATITUDE_TRANSCRIPTION_HINT = 'A child saying what they are grateful for, in English or Korean.';
const hintWords = text => String(text ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** True when a take carries no words of the child's: empty, or the prompt hint leaking out. */
export function isUnheardTranscript(text) {
  const words = hintWords(text);
  return !words || words.includes(hintWords(GRATITUDE_TRANSCRIPTION_HINT)) || words.includes('a child saying what they are grateful for');
}
export function validateGratitudeEnrollment(raw = {}) {
  const subject = raw.subject ?? 'scripture';
  if (!SUBJECT_IDS.includes(subject)) return { errors: ['gratitude subject must be a known School subject'] };
  return { errors: [], enrollment: { programId: GRATITUDE_PROGRAM_ID, corpusId: null, subject, title: String(raw.title || GRATITUDE_TITLE).trim() } };
}
export function gratitudeConfigOf(config = {}) {
  const value = config.gratitude ?? {};
  const positive = (v, fallback) => Number.isFinite(v) && v > 0 ? v : fallback;
  return { spacingDays: 7, cooldownMs: STANDARD_COOLDOWN_MS,
    judge: { model: value.judge?.model, minConfidence: Math.min(1, positive(value.judge?.min_confidence, 0.8)), timeoutMs: positive(value.judge?.timeout_ms, 8000) },
    extractor: { model: value.extractor?.model ?? config.debrief?.judge?.model ?? 'gpt-5-nano', timeoutMs: positive(value.extractor?.timeout_ms, 8000) },
    // Learners on the preschool screen and verdict ladder (spec 2026-11-19); everyone else keeps the text box.
    preschool: { learners: Array.isArray(value.preschool) ? value.preschool.filter(id => typeof id === 'string' && id) : [], cooldownMs: PRESCHOOL_COOLDOWN_MS, blueLimit: PRESCHOOL_BLUE_LIMIT },
    followUp: { enabled: value.follow_up?.enabled !== false, model: value.follow_up?.model ?? value.extractor?.model ?? config.debrief?.judge?.model ?? 'gpt-5-nano', timeoutMs: positive(value.follow_up?.timeout_ms, 8000) },
  };
}
export const STANDARD_COOLDOWN_MS = 30 * 60_000;
export const PRESCHOOL_COOLDOWN_MS = 5 * 60_000;
// Steers in a row; the next good-faith answer is accepted and flagged.
export const PRESCHOOL_BLUE_LIMIT = 2;
export const gratitudePublicationId = (learnerId, day) => `school-gratitude:${learnerId}:${day}`;

const answerPhase = phase => phase === 'follow-up' ? 'follow-up' : 'draft';
/** Event-derived evidence, separate from the browser view and all wall-clock policy. */
export function deriveGratitudeState(events = [], { now = null } = {}) {
  if(!validGratitudeEvidence(events))throw new Error('Invalid Gratitude evidence');
  const state = { phase: 'not-started', attemptId: null, draft: null, submitted: null, assessment: null, publication: null, subject: null, selectionId: null, retryAt: null, reason: null, followUp: null, followUpAsked: false, assessText: null, steer: null, cooldownMs: null, blueRun: 0, sillyRun: 0 };
  const takeBases=new Map();
  for (const event of events) {
    switch (event.type) {
      case 'opened': if (state.phase === 'not-started') state.phase = 'draft'; break;
      case 'take-saved': {
        // A new take REPLACES the draft (2026-11-19: appended takes filled the box with refused words).
        // The draft from before the take is kept so an unheard take can put it back.
        if(!takeBases.has(event.takeId))takeBases.set(event.takeId,state.draft);
        state.draft={text:event.text??'',via:'voice',audioRef:event.audioRef,takeId:event.takeId,edited:false};
        state.phase=answerPhase(state.phase);break;
      }
      case 'take-unheard': state.draft=takeBases.get(event.takeId)??null; break;
      case 'draft-saved': state.draft = {...event.draft,takeId:event.draft.audioRef===state.draft?.audioRef?state.draft?.takeId:null}; state.phase = answerPhase(state.phase); break;
      case 'submitted':
        state.assessText = event.followUpOf && state.followUp?.attemptId === event.followUpOf ? combineGratitudeAnswers(state.followUp.firstText, event.text) : event.text;
        state.followUp = null; state.steer = null;
        state.attemptId = event.attemptId; state.submitted = event; state.draft = event; state.assessment = null; state.publication = null; state.reason = null; state.retryAt=null; state.phase = 'assessing'; break;
      case 'follow-up-asked': state.followUp = { attemptId: event.attemptId, question: event.question, firstText: state.submitted?.text ?? '' }; state.followUpAsked = true; state.draft = null; state.phase = 'follow-up'; break;
      case 'assessed':
        state.assessment = event;
        // A retried answer starts from an empty box.
        if (event.verdict === 'uncertain') { state.phase = 'retry'; state.reason = 'unclear'; state.draft = null; }
        break;
      case 'refused': state.phase = 'cooldown'; state.retryAt = event.retryAt; state.reason = event.reason; state.draft = null; state.cooldownMs = event.cooldownMs ?? STANDARD_COOLDOWN_MS;
        // The run starts over once the break is done; no answer can arrive during it.
        state.blueRun = 0; state.sillyRun = 0; break;
      // Preschool ladder: blue (try something new) and yellow (that was silly). Neither is a break.
      case 'steered': state.phase = 'steered'; state.reason = event.reason; state.steer = { reason: event.reason, matchedId: event.matchedId ?? null }; state.draft = null; state.blueRun += 1; break;
      case 'warned': state.phase = 'warned'; state.reason = 'nonsense'; state.draft = null; state.sillyRun += 1; state.blueRun = 0; break;
      case 'publication-pending': state.publication = event; state.subject = event.subject; state.selectionId = event.selectionId; state.phase = 'pending'; state.reason = 'publication'; break;
      case 'completed': state.blueRun = 0; state.sillyRun = 0; state.phase = 'completed'; state.selectionId = event.selectionId ?? state.selectionId; state.reason = null; state.retryAt = null; break;
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
