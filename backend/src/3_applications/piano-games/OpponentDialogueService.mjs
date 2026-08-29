import { normalizeOpponentDialogue } from '#apps/gaming/effects/OpponentDialoguePolicy.mjs';
import { normalizeOpponentProfile } from '#shared/gaming/opponents/profile.mjs';

const DEFAULT_MODEL = 'gpt-5.6-luna';
const FORBIDDEN = [/[a-h][1-8]/i, /\b(?:row|column|square)\s*\d+/i, /\b(?:midi|note)\s*\d+/i];
const DEFAULTS = Object.freeze({ timeoutMs: 1800, maxChars: 96, maxTokens: 40 });

function history(dialogue, ply) {
  return Array.isArray(dialogue) ? dialogue.slice(0, Math.ceil(ply / 2)).map((entry) => ({
    ply: Number(entry?.ply) || null,
    quip: typeof entry?.quip === 'string' ? entry.quip.replace(/\s+/g, ' ').trim().slice(0, 96) : '',
  })).filter((entry) => entry.quip) : [];
}

function safeOptions(personality = {}) {
  const timeout = Number(personality.timeout_ms);
  const maxChars = Number(personality.max_chars);
  return {
    // Cosmetic copy is permanently constrained to the reviewed low-cost model.
    model: personality.model === DEFAULT_MODEL ? personality.model : DEFAULT_MODEL,
    timeoutMs: Number.isFinite(timeout) ? Math.min(2500, Math.max(500, timeout)) : DEFAULTS.timeoutMs,
    maxChars: Number.isFinite(maxChars) ? Math.min(96, Math.max(40, maxChars)) : DEFAULTS.maxChars,
  };
}

function publicRivalry(value) {
  if (!value) return null;
  return {
    record: value.record || null,
    recent: (Array.isArray(value.recent) ? value.recent : []).slice(-7).map((game) => ({
      result: game?.result || null,
      moves: Number(game?.moves) || 0,
      notable: Array.isArray(game?.notable) ? game.notable.slice(0, 3) : [],
      finalLine: typeof game?.finalLine === 'string' ? game.finalLine.slice(0, 96) : null,
    })),
  };
}

/** Fail-open cosmetic dialogue. Rules adapters own replay and semantic redaction. */
export class OpponentDialogueService {
  constructor({
    dialogueGenerator = null, resolveOpponent, readConfig = async () => ({}),
    recallRivalry = async () => null, readLadder = async () => null,
    adapters, logger = null,
  }) {
    this.dialogueGenerator = dialogueGenerator;
    this.resolveOpponent = resolveOpponent;
    this.readConfig = readConfig;
    this.recallRivalry = recallRivalry;
    this.readLadder = readLadder;
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
    const options = safeOptions(personality);
    const enabled = personality.enabled !== false;
    const prior = history(request.dialogue, Number(request.ply));
    const [rivalry, ladder] = await Promise.all([
      request.userId ? this.recallRivalry(gameId, request.userId, opponent.id).catch(() => null) : null,
      this.readLadder(gameId, request.userId).catch(() => null),
    ]);
    const promotion = ladder ? {
      position: resolved.position,
      total: resolved.total,
      wins: Number(ladder.wins || 0),
      needed: Number(ladder.wins_required || 0),
    } : null;
    if (!enabled || !this.dialogueGenerator?.available) {
      const source = enabled ? 'fallback' : 'disabled';
      const fallbackReason = enabled ? 'generation_error' : 'disabled';
      this.logger?.info?.('piano-game.dialogue.fallback', {
        gameId, sessionId, ply: request.ply, opponentId: opponent.id, source, fallbackReason,
      });
      return { eventId: facts.eventId, quip: facts.fallback, source, fallbackReason, opponent };
    }
    try {
      const raw = await this.dialogueGenerator.generate({
        instruction: 'Return one child-safe spoken reaction, 2 to 12 words, and nothing else.',
        prompt: [
          `You are ${profile.name}, an opponent in a children's ${gameId} piano game.`,
          `Persona: ${profile.dialogue.persona}`, `Voice: ${profile.dialogue.voice}`,
          'Never reveal coordinates, notation, MIDI values, move codes, or private analysis.',
          `Public turn facts: ${JSON.stringify(facts.event)}`,
          `Previously displayed lines: ${JSON.stringify(prior)}`,
          `Rivalry memory: ${JSON.stringify(publicRivalry(rivalry))}`,
          `Ladder position: ${JSON.stringify(promotion)}`,
        ].join('\n'),
        timeoutMs: options.timeoutMs,
        timeoutMessage: 'dialogue_timeout',
      });
      const quip = normalizeOpponentDialogue(raw, {
        maxChars: options.maxChars, dialogue: prior, lore: profile.dialogue.lore,
        forbiddenPatterns: [...FORBIDDEN, ...(facts.forbiddenPatterns || [])],
      });
      if (!quip) throw new Error('invalid_output');
      this.logger?.info?.('piano-game.dialogue.generated', { gameId, sessionId, ply: request.ply, opponentId: opponent.id, source: 'ai' });
      return { eventId: facts.eventId, quip, source: 'ai', fallbackReason: null, opponent };
    } catch (error) {
      const fallbackReason = error.message === 'dialogue_timeout' ? 'timeout' : error.message === 'invalid_output' ? 'invalid_output' : 'generation_error';
      this.logger?.warn?.('piano-game.dialogue.fallback', {
        gameId, sessionId, ply: request.ply, opponentId: opponent.id,
        source: 'fallback', fallbackReason,
      });
      return { eventId: facts.eventId, quip: facts.fallback, source: 'fallback', fallbackReason, opponent };
    }
  }
}

export default OpponentDialogueService;
