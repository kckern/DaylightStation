/**
 * Language-assessment transcription profile.
 *
 * For recordings where the speaker is being ASSESSED on what they said — a
 * learner saying aloud what a sentence means, instead of typing it. Typing is
 * sometimes the wrong test: someone who understands perfectly can be defeated
 * by an English keyboard, and then the record measures typing rather than
 * comprehension.
 *
 * This profile exists because the fitness one is actively dangerous here, in
 * two separate ways. Both produce a system that looks like it is working
 * perfectly while measuring nothing at all.
 *
 * TRAP 1 — THE CLEANUP PASS MUST NOT REPAIR.
 * The fitness cleanup prompt says "Fix obvious mistranscriptions (eg
 * thumbbells -> dumbbells)". Point that at a learner's spoken translation and
 * the model tidies a wrong answer into a right one: the evidence log then
 * records comprehension that did not happen, and the rung measures nothing.
 * So this prompt may do only what a transcript honestly needs — drop filler,
 * collapse a stutter — and when in doubt it returns the words as heard.
 *
 * TRAP 2 — THE EXPECTED ANSWER MUST NEVER REACH WHISPER.
 * A Whisper `prompt` biases recognition toward the words it contains. Feed it
 * the expected English sentence and it will *hear* that sentence whatever the
 * learner actually said. So `whisperPrompt` here does not stringify the
 * context it is handed: it reads two narrow, structurally-constrained fields
 * and ignores everything else, which makes smuggling a sentence through
 * impossible rather than merely discouraged.
 */

/**
 * Registers this profile will admit, keyed. A caller picks a KEY, never free
 * text — free text is how an expected answer would get in.
 */
const REGISTERS = Object.freeze({
  everyday: 'everyday conversational sentences',
  classroom: 'simple classroom sentences',
  narrative: 'short narrative sentences'
});

const DEFAULT_REGISTER = 'everyday';
const DEFAULT_SPOKEN_LANGUAGE = 'English';

// A language NAME, not a sentence: letters and spaces, at most a few words.
// Anything else is discarded rather than trusted.
const LANGUAGE_NAME = /^[A-Za-z][A-Za-z ]{0,23}$/;

/**
 * Build the Whisper bias prompt for a spoken language answer.
 *
 * Reads ONLY `spokenLanguage` (validated as a language name) and `register`
 * (a key of REGISTERS). Every other property of `context` — notably anything
 * carrying the expected answer — is ignored by construction. Do not "improve"
 * this by passing the context through: see TRAP 2 above.
 *
 * @param {Object} [context]
 * @param {string} [context.spokenLanguage] - Language the speaker is answering in
 * @param {string} [context.register] - One of the REGISTERS keys
 * @returns {string} Context prompt for Whisper
 */
export function buildLanguageTranscriptionContext(context = {}) {
  const spokenLanguage = LANGUAGE_NAME.test(String(context?.spokenLanguage ?? ''))
    ? String(context.spokenLanguage).trim()
    : DEFAULT_SPOKEN_LANGUAGE;

  const register = REGISTERS[context?.register] || REGISTERS[DEFAULT_REGISTER];

  return [
    `Transcribe a short spoken answer in ${spokenLanguage}.`,
    `The speaker is a language learner, often a child, speaking ${register}.`,
    'Their wording may be halting or grammatically wrong. Write down exactly the words they said.'
  ].join(' ');
}

/**
 * The cleanup prompt. Every word here is chosen to keep the model from
 * improving the answer; read TRAP 1 above before editing it.
 */
const CLEANUP_SYSTEM_PROMPT = [
  'You tidy a short spoken answer that a language learner recorded.',
  'Return ONLY the words they said, with no commentary.',
  'You may remove filler sounds such as "um" and "uh", and you may collapse an immediate stutter or false start into the single word they settled on.',
  'Change nothing else. Keep their wording, their word order and their grammar exactly as heard, even when the result reads oddly or states something untrue.',
  'Never add a word they did not say, never reword a phrase into better English, and never guess at what they meant to say.',
  'When you are unsure, return the words as heard.',
  'Respond with "[No Answer]" only if the audio is silence, noise, or entirely unintelligible.'
].join(' ');

export const languageTranscriptionProfile = Object.freeze({
  slug: 'voice-answer',
  whisperPrompt: buildLanguageTranscriptionContext,
  cleanupPrompt: CLEANUP_SYSTEM_PROMPT,
  // Temperature 0: an assessment transcript should be reproducible, and
  // sampling is one more place for the model to invent a better answer.
  cleanupOptions: Object.freeze({ temperature: 0, maxTokens: 1000 }),
  emptyMarker: 'no answer'
});

export default languageTranscriptionProfile;
