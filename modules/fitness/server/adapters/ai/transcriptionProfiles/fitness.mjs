/**
 * Fitness transcription profile.
 *
 * The two prompts that used to be baked into
 * `1_adapters/fitness/VoiceMemoTranscriptionService.mjs`: the Whisper
 * recognition bias (moved verbatim from `fitness/transcriptionContext.mjs`)
 * and the cleanup system prompt. Both are reproduced character-for-character —
 * `VoiceTranscriptionService.fitnessProfile.char.test.mjs` pins them, because a
 * drifting prompt changes what the recogniser hears without changing any code
 * path a normal test would notice.
 *
 * NOTE FOR ANYONE COPYING THIS FILE AS A TEMPLATE: this cleanup prompt asks the
 * model to REPAIR the transcript ("Fix obvious mistranscriptions (eg
 * thumbbells -> dumbbells)"). That is correct here — a memo shouted over a fan
 * mid-workout is full of mishearings and nobody is being graded on it. It is
 * exactly wrong for anything that assesses the speaker. See ./language.mjs.
 */

/**
 * Build the Whisper bias prompt for a fitness voice memo.
 *
 * Moved here from `1_adapters/fitness/transcriptionContext.mjs` when the
 * transcription service was generalised: a Whisper bias prompt IS the profile,
 * and an adapter in the `fitness` family may not be imported from the `ai`
 * family (`adapters-no-cross-adapter`, a hard gate at zero).
 *
 * @param {Object} sessionData - Session context data
 * @param {string} [sessionData.currentShow] - Currently playing show
 * @param {string} [sessionData.currentEpisode] - Current episode
 * @param {string[]} [sessionData.recentShows] - Recently played shows
 * @param {string[]} [sessionData.householdMembers] - Household member names
 * @param {string[]} [sessionData.activeUsers] - Active session participants
 * @returns {string} Context prompt for Whisper
 */
export function buildTranscriptionContext(sessionData = {}) {
  const contextParts = [];

  // Baseline fitness transcription prompt
  contextParts.push(
    'Transcribe this description of a fitness workout. Common terms: pounds (lbs), weights, dumbbells, reps, sets, squats, lunges, burpees, HIIT, intervals, warmup, cooldown, rest, cardio, kettlebell, pushups, pullups, planks, crunches.'
  );

  // Current media context
  if (sessionData.currentShow) {
    contextParts.push(`Currently playing: ${sessionData.currentShow}`);
    if (sessionData.currentEpisode) {
      contextParts.push(`Episode: ${sessionData.currentEpisode}`);
    }
  }

  // Recently played shows
  if (
    sessionData.recentShows &&
    Array.isArray(sessionData.recentShows) &&
    sessionData.recentShows.length > 0
  ) {
    const uniqueShows = [...new Set(sessionData.recentShows)].slice(0, 5);
    contextParts.push(`Recent shows: ${uniqueShows.join(', ')}`);
  }

  // Household members
  if (
    sessionData.householdMembers &&
    Array.isArray(sessionData.householdMembers) &&
    sessionData.householdMembers.length > 0
  ) {
    contextParts.push(
      `Family and household members: ${sessionData.householdMembers.join(', ')}`
    );
  }

  // Active session users
  if (
    sessionData.activeUsers &&
    Array.isArray(sessionData.activeUsers) &&
    sessionData.activeUsers.length > 0
  ) {
    contextParts.push(
      `Participants present in this session: ${sessionData.activeUsers.join(', ')}`
    );
  }

  // Custom exercise terminology (App specific)
  contextParts.push(
    'Additional terms: YUVI, Cadence, Heart Rate, Zone, Sprint, Climb, Resistance.'
  );

  return contextParts.join('. ');
}

const CLEANUP_SYSTEM_PROMPT = 'You clean short voice memos recorded during fitness sessions. Remove duplicated words, filler like "uh", obvious transcription glitches. Keep numeric data and intent intact. Return ONLY the cleaned text - no commentary or additions. Fix obvious mistranscriptions (eg thumbbells -> dumbbells). ONLY respond with "[No Memo]" if the audio is literally silence, static noise, or completely unintelligible gibberish. If the person said actual words - even if unrelated to fitness - return those words cleaned up.';

export const fitnessTranscriptionProfile = Object.freeze({
  // `slug` names both the log events and the upload filename stem. It stays
  // 'voice-memo' so the existing log queries and dashboards keep matching.
  slug: 'voice-memo',
  whisperPrompt: buildTranscriptionContext,
  cleanupPrompt: CLEANUP_SYSTEM_PROMPT,
  cleanupOptions: Object.freeze({ temperature: 0.2, maxTokens: 1000 }),
  emptyMarker: 'no memo'
});

export default fitnessTranscriptionProfile;
