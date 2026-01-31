/**
 * Fitness Adapters barrel export
 * @module fitness/adapters
 */

export { AmbientLedAdapter } from './AmbientLedAdapter.mjs';
export { VoiceMemoTranscriptionService } from './VoiceMemoTranscriptionService.mjs';
export { buildTranscriptionContext } from './transcriptionContext.mjs';

// Backward compatibility alias (deprecated)
export { AmbientLedAdapter as HomeAssistantZoneLedAdapter } from './AmbientLedAdapter.mjs';
