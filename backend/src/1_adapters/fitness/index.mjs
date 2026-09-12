/**
 * Fitness Adapters barrel export
 * @module fitness/adapters
 */

export { AmbientLedAdapter } from './AmbientLedAdapter.mjs';
// Voice transcription moved to `1_adapters/ai/VoiceTranscriptionService.mjs`
// with the fitness prompts as a profile (`ai/transcriptionProfiles/fitness.mjs`).
// It cannot be re-exported from here: an adapter in the `fitness` family may
// not import one in the `ai` family (`adapters-no-cross-adapter`, a hard gate
// at zero). The composition root binds the profile instead.

// Backward compatibility alias (deprecated)
export { AmbientLedAdapter as HomeAssistantZoneLedAdapter } from './AmbientLedAdapter.mjs';
