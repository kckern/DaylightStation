/**
 * VoiceTriggerService — turns a transcript at a location into a trigger.
 *
 * Order: validate text → location → token (before any model call, so an
 * unauthenticated caller never spends a decision) → VoiceCommandMatcher →
 *   exact keyword          dispatch (the documented /voice/<keyword> contract)
 *   model match, route     dispatch
 *   model match, confirm   store a proposal; POST .../voice/confirm dispatches it
 *   anything else          VOICE_NO_MATCH, nothing happens
 *
 * Dispatch always goes through TriggerDispatchService.handleTrigger(location,
 * 'voice', command) so debounce, broadcast and response handling are the
 * same as every other modality.
 *
 * Proposals are in memory: a restart drops them, which only costs a re-ask.
 * Layer: APPLICATION (3_applications/trigger).
 */
import { authenticate } from './guards/authenticate.mjs';
import { VoiceResolver } from '#domains/trigger/services/VoiceResolver.mjs';

const MAX_TRANSCRIPT_CHARS = 500;
const PROPOSAL_TTL_MS = 120_000;
const MAX_PROPOSALS = 50;

export class VoiceTriggerService {
  #config; #matcher; #dispatch; #createProposalId; #clock; #logger;
  #proposals = new Map();

  /**
   * @param {Object} deps
   * @param {Object} deps.config - live trigger registry (reads config.voice.locations)
   * @param {Object} deps.matcher - VoiceCommandMatcher
   * @param {Object} deps.triggerDispatchService - TriggerDispatchService
   * @param {Function} deps.createProposalId
   * @param {Function} [deps.clock]
   * @param {Object} [deps.logger]
   */
  constructor({ config, matcher, triggerDispatchService, createProposalId, clock = () => Date.now(), logger = console }) {
    if (typeof triggerDispatchService?.handleTrigger !== 'function') throw new Error('VoiceTriggerService requires triggerDispatchService');
    if (typeof matcher?.match !== 'function') throw new Error('VoiceTriggerService requires matcher');
    if (typeof createProposalId !== 'function') throw new Error('VoiceTriggerService requires createProposalId');
    this.#config = config || {};
    this.#matcher = matcher;
    this.#dispatch = triggerDispatchService;
    this.#createProposalId = createProposalId;
    this.#clock = clock;
    this.#logger = logger;
  }

  #locationConfig(location) {
    return this.#config?.voice?.locations?.[location] ?? null;
  }

  #guard(location, token) {
    const locationConfig = this.#locationConfig(location);
    if (!locationConfig) return { error: { ok: false, code: 'LOCATION_NOT_FOUND', error: `Unknown voice location: ${location}`, location } };
    if (!authenticate({ expectedToken: locationConfig.auth_token, providedToken: token }).ok) {
      this.#logger.warn?.('trigger.voice.auth_failed', { location });
      return { error: { ok: false, code: 'AUTH_FAILED', error: 'Authentication failed', location } };
    }
    return { locationConfig };
  }

  #prune(now) {
    for (const [id, p] of this.#proposals) {
      if (p.expiresAt < now) this.#proposals.delete(id);
    }
    while (this.#proposals.size >= MAX_PROPOSALS) {
      this.#proposals.delete(this.#proposals.keys().next().value);
    }
  }

  /**
   * @param {string} location
   * @param {string} transcript
   * @param {{ token?: string, dryRun?: boolean }} [options]
   */
  async handleTranscript(location, transcript, options = {}) {
    const text = typeof transcript === 'string' ? transcript.trim() : '';
    if (!text || text.length > MAX_TRANSCRIPT_CHARS) {
      return { ok: false, code: 'INVALID_TRANSCRIPT', error: `transcript must be 1..${MAX_TRANSCRIPT_CHARS} characters`, location };
    }
    const { locationConfig, error } = this.#guard(location, options.token);
    if (error) return error;

    const mode = locationConfig.routing?.mode ?? 'confirm';
    const match = await this.#matcher.match({ location, transcript: text, locationConfig, useModel: mode !== 'off' });

    if (!match.command) {
      this.#logger.info?.('trigger.voice.no_match', { location, reason: match.reason, mode });
      return { ok: false, code: 'VOICE_NO_MATCH', error: 'No configured command matched', location, reason: match.reason };
    }

    const voice = { transcript: text, command: match.command, via: match.via, confidence: match.confidence };

    if (match.via === 'exact' || mode === 'route') {
      const result = await this.#dispatch.handleTrigger(location, 'voice', match.command, { token: options.token, dryRun: options.dryRun });
      return { ...result, voice };
    }

    const now = this.#clock();
    this.#prune(now);
    const id = this.#createProposalId();
    this.#proposals.set(id, { location, command: match.command, via: match.via, confidence: match.confidence, createdAt: now, expiresAt: now + PROPOSAL_TTL_MS });
    this.#logger.info?.('trigger.voice.proposed', { proposalId: id, location, command: match.command, confidence: match.confidence, model: match.model ?? null });
    return {
      ok: true,
      confirm: true,
      location,
      proposal: {
        id,
        command: match.command,
        description: VoiceResolver.commandOptions(locationConfig)[match.command],
        confidence: match.confidence,
        expiresInMs: PROPOSAL_TTL_MS,
      },
    };
  }

  /**
   * Dispatch a stored proposal. One use; expires after PROPOSAL_TTL_MS.
   * @param {string} location
   * @param {string} proposalId
   * @param {{ token?: string }} [options]
   */
  async confirm(location, proposalId, options = {}) {
    const { error } = this.#guard(location, options.token);
    if (error) return error;

    const now = this.#clock();
    const proposal = this.#proposals.get(proposalId);
    if (!proposal || proposal.location !== location || proposal.expiresAt < now) {
      this.#logger.info?.('trigger.voice.confirm_missed', { proposalId: proposalId ?? null, location, expired: !!proposal && proposal.expiresAt < now });
      return { ok: false, code: 'PROPOSAL_NOT_FOUND', error: 'Proposal not found or expired', location };
    }
    this.#proposals.delete(proposalId);

    const result = await this.#dispatch.handleTrigger(location, 'voice', proposal.command, { token: options.token });
    this.#logger.info?.('trigger.voice.confirmed', {
      proposalId, location, command: proposal.command, confidence: proposal.confidence,
      latencyMs: now - proposal.createdAt, ok: !!result.ok, code: result.code ?? null,
    });
    return { ...result, voice: { command: proposal.command, via: proposal.via, confidence: proposal.confidence, proposalId } };
  }
}

export default VoiceTriggerService;
