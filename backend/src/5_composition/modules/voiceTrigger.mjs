// backend/src/5_composition/modules/voiceTrigger.mjs
// Builds the voice-transcript trigger service. The decision gateway is
// optional: null (no Jev key) leaves exact keywords working and every free-text
// transcript answering VOICE_NO_MATCH.

import { VoiceCommandMatcher } from '#apps/trigger/VoiceCommandMatcher.mjs';
import { VoiceTriggerService } from '#apps/trigger/VoiceTriggerService.mjs';

/**
 * @param {Object} deps
 * @param {Object} deps.config - live trigger registry
 * @param {Object|null} [deps.decisionGateway] - IDecisionGateway
 * @param {Object} deps.triggerDispatchService
 * @param {Function} deps.createProposalId
 * @param {Object} [deps.logger]
 * @returns {VoiceTriggerService}
 */
export function createVoiceTriggerService({ config, decisionGateway = null, triggerDispatchService, createProposalId, logger = console }) {
  const matcher = new VoiceCommandMatcher({ decisionGateway, logger });
  return new VoiceTriggerService({ config, matcher, triggerDispatchService, createProposalId, logger });
}

export default createVoiceTriggerService;
