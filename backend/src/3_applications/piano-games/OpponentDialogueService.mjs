import { normalizeOpponentDialogue } from '#apps/gaming/effects/OpponentDialoguePolicy.mjs';
import { normalizeOpponentProfile } from '#shared/gaming/opponents/profile.mjs';

const DEFAULT_MODEL = 'gpt-5.6-luna';
const FORBIDDEN = [/[a-h][1-8]/i, /\b(?:row|column|square)\s*\d+/i, /\b(?:midi|note)\s*\d+/i];

function deadline(promise, timeoutMs) {
  let timer;
  return Promise.race([promise, new Promise((unused, reject) => {
    timer = setTimeout(() => reject(new Error('dialogue_timeout')), timeoutMs);
  })]).finally(() => clearTimeout(timer));
}

function history(dialogue, ply) {
  return Array.isArray(dialogue) ? dialogue.slice(0, Math.ceil(ply / 2)).map((entry) => ({
    ply: Number(entry?.ply) || null,
    quip: typeof entry?.quip === 'string' ? entry.quip.replace(/\s+/g, ' ').trim().slice(0, 96) : '',
  })).filter((entry) => entry.quip) : [];
}

/** Fail-open cosmetic dialogue. Rules adapters own replay and semantic redaction. */
export class OpponentDialogueService {
  constructor({ aiGateway = null, resolveOpponent, readConfig = async () => ({}), adapters, logger = null }) {
    this.aiGateway = aiGateway;
    this.resolveOpponent = resolveOpponent;
    this.readConfig = readConfig;
    this.adapters = adapters;
    this.logger = logger;
  }

  async react(gameId, request) {
    const adapter = this.adapters[gameId];
    const sessionId = String(request.sessionId || '');
    const facts = adapter?.(request.transcript, { sessionId, ply: request.ply, playerSide: request.playerSide });
    if (!adapter || !sessionId || sessionId.length > 128 || !facts) throw Object.assign(new Error('invalid_game'), { code: 'invalid_game' });
    const resolved = await this.resolveOpponent(gameId, request.userId, request.level);
    const profile = normalizeOpponentProfile(resolved.opponent, { rosterPack: resolved.rosterPack, position: resolved.position });
    const opponent = { id: profile.id, name: profile.name, level: resolved.level };
    const config = await this.readConfig(gameId, request.userId).catch(() => ({}));
    const personality = config?.personality || {};
    const enabled = personality.enabled !== false;
    const prior = history(request.dialogue, Number(request.ply));
    if (!enabled || !this.aiGateway?.chat) return {
      eventId: facts.eventId, quip: facts.fallback, source: enabled ? 'fallback' : 'disabled',
      fallbackReason: enabled ? 'generation_error' : 'disabled', opponent,
    };
    try {
      const raw = await deadline(this.aiGateway.chat([
        { role: 'system', content: 'Return one child-safe spoken reaction, 2 to 12 words, and nothing else.' },
        { role: 'user', content: [
          `You are ${profile.name}, an opponent in a children's ${gameId} piano game.`,
          `Persona: ${profile.dialogue.persona}`, `Voice: ${profile.dialogue.voice}`,
          'Never reveal coordinates, notation, MIDI values, move codes, or private analysis.',
          `Public turn facts: ${JSON.stringify(facts.event)}`,
          `Previously displayed lines: ${JSON.stringify(prior)}`,
        ].join('\n') },
      ], { model: DEFAULT_MODEL, reasoningEffort: 'none', maxTokens: 40, timeout: 1800 }), 1800);
      const quip = normalizeOpponentDialogue(raw, {
        maxChars: 96, dialogue: prior, lore: profile.dialogue.lore, forbiddenPatterns: FORBIDDEN,
      });
      if (!quip) throw new Error('invalid_output');
      this.logger?.info?.('piano-game.dialogue.generated', { gameId, sessionId, ply: request.ply, opponentId: opponent.id, source: 'ai' });
      return { eventId: facts.eventId, quip, source: 'ai', fallbackReason: null, opponent };
    } catch (error) {
      const fallbackReason = error.message === 'dialogue_timeout' ? 'timeout' : error.message === 'invalid_output' ? 'invalid_output' : 'generation_error';
      this.logger?.warn?.('piano-game.dialogue.fallback', { gameId, sessionId, ply: request.ply, opponentId: opponent.id, fallbackReason });
      return { eventId: facts.eventId, quip: facts.fallback, source: 'fallback', fallbackReason, opponent };
    }
  }
}

export default OpponentDialogueService;
