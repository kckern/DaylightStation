import { applyMove, describeGame, undoMove } from '#shared/gaming/rulesets/chess/engine.mjs';
import { describeLevel } from '#shared/gaming/rulesets/chess/ladder.mjs';

const DEFAULTS = Object.freeze({
  enabled: true,
  model: 'gpt-5.6-luna',
  timeoutMs: 1800,
  maxChars: 96,
  maxTokens: 40,
});

const PIECES = Object.freeze({ p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' });
const UNSAFE = /\b(?:fuck|shit|bitch|damn|idiot|stupid|moron|hate|kill|die)\b/i;

function clampWords(text, maxChars) {
  const words = text.split(/\s+/).filter(Boolean).slice(0, 12);
  let result = '';
  for (const word of words) {
    const next = result ? `${result} ${word}` : word;
    if (next.length > maxChars) break;
    result = next;
  }
  return result.replace(/[,:;\-–—]+$/, '').trim();
}

export function normalizeQuip(value, maxChars = DEFAULTS.maxChars) {
  if (typeof value !== 'string') return null;
  let text = value.replace(/\s+/g, ' ').trim();
  text = text.replace(/^\s*(?:quip|opponent|response)\s*:\s*/i, '');
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!text || UNSAFE.test(text) || /\p{Extended_Pictographic}/u.test(text)) return null;
  const sentenceEnd = text.search(/[.!?](?:\s|$)/);
  if (sentenceEnd >= 0) text = text.slice(0, sentenceEnd + 1);
  text = clampWords(text, maxChars);
  if (!text || text.split(/\s+/).length < 2) return null;
  if (/[.!?]$/.test(text)) return text;
  const punctuated = text.length < maxChars ? `${text}.` : `${clampWords(text, maxChars - 1)}.`;
  return punctuated.length <= maxChars ? punctuated : null;
}

function fallbackFor({ move, status, playerColor }) {
  const playerMoved = move.color === playerColor;
  if (status.game_over && status.outcome === 'checkmate') {
    return status.winner === playerColor ? 'You found the finish.' : 'That was the final move.';
  }
  if (status.game_over) return 'A draw leaves us even.';
  if (status.check) return playerMoved ? 'Now my king must answer.' : 'Your king has company.';
  if (move.promotion) return playerMoved ? 'That pawn grew up fast.' : 'Meet my newest queen.';
  if (move.captured) return playerMoved ? 'That capture stung.' : `I found your ${PIECES[move.captured] || 'piece'}.`;
  if (move.piece === 'n') return 'Knights do enjoy a crooked path.';
  if (move.piece === 'p') return playerMoved ? 'A small step with plans.' : 'My pawn marches on.';
  return playerMoved ? 'I see what you are building.' : 'Your turn to answer that.';
}

function replayFacts(game, playerColor) {
  if (!game || !Array.isArray(game.moves) || game.moves.length === 0 || game.moves.length > 512) return null;
  if (playerColor !== 'w' && playerColor !== 'b') return null;
  const status = describeGame(game);
  if (!status) return null;
  const previous = undoMove(game);
  if (!previous || previous === game) return null;
  const applied = applyMove(previous.fen, game.moves.at(-1));
  if (applied.error || !applied.move || applied.fen !== status.fen) return null;
  return { move: applied.move, status };
}

function promptFor({ opponent, level, move, status, playerColor }) {
  const actor = move.color === playerColor ? 'the child' : opponent.name;
  return [
    `You are ${opponent.name}, a warm, competitive chess opponent in a children's piano game.`,
    `Personality: ${opponent.personality || describeLevel(level)}.`,
    'Write exactly one child-safe spoken reaction of 2 to 12 words.',
    'React only to the supplied chess facts. No insults, profanity, emoji, quotation marks, AI references, stage directions, or non-chess attacks.',
    'Do not explain the move and do not name the child.',
    `Facts: ${JSON.stringify({
      actor,
      san: move.san,
      piece: PIECES[move.piece] || move.piece,
      captured: move.captured ? PIECES[move.captured] || move.captured : null,
      promotion: move.promotion ? PIECES[move.promotion] || move.promotion : null,
      check: status.check,
      gameOver: status.game_over,
      outcome: status.outcome,
      winner: status.winner,
    })}`,
  ].join('\n');
}

function withDeadline(promise, timeoutMs) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('commentary_timeout')), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function safeOptions(config) {
  const timeout = Number(config.timeout_ms);
  const maxChars = Number(config.max_chars);
  return {
    // This endpoint is deliberately cheap. A crafted user config must not turn
    // a two-line flourish into an expensive model invocation.
    model: config.model === DEFAULTS.model ? config.model : DEFAULTS.model,
    timeoutMs: Number.isFinite(timeout) ? Math.min(2500, Math.max(500, timeout)) : DEFAULTS.timeoutMs,
    maxChars: Number.isFinite(maxChars) ? Math.min(96, Math.max(40, maxChars)) : DEFAULTS.maxChars,
  };
}

/** Application service for cosmetic, fail-open opponent dialogue. */
export function createChessOpponentCommentaryService({
  aiGateway,
  ladderService,
  readConfig = async () => ({}),
  logger = null,
}) {
  return {
    async react({ userId = null, gameId, ply, level, playerColor, game }) {
      const facts = replayFacts(game, playerColor);
      if (!facts || typeof gameId !== 'string' || !gameId || gameId.length > 128
        || Number(ply) !== game.moves.length) {
        const error = new Error('invalid_game');
        error.code = 'invalid_game';
        throw error;
      }

      let resolved = { level: Number(level) || 0, opponent: null };
      try {
        resolved = await ladderService.rungFor(userId, level);
      } catch (error) {
        logger?.warn?.('chess.commentary.opponent-fallback', { gameId, reason: error.message });
      }
      const rawOpponent = resolved.opponent || {};
      const opponent = {
        name: String(rawOpponent.name || 'Opponent').replace(/\s+/g, ' ').trim().slice(0, 40) || 'Opponent',
        personality: typeof rawOpponent.personality === 'string'
          ? rawOpponent.personality.replace(/\s+/g, ' ').trim().slice(0, 120)
          : null,
      };
      let config = {};
      try {
        config = await readConfig(userId);
      } catch (error) {
        logger?.warn?.('chess.commentary.config-fallback', { gameId, reason: error.message });
      }
      const personality = { ...DEFAULTS, ...(config?.personality || {}) };
      const options = safeOptions(personality);
      const fallback = fallbackFor({ ...facts, playerColor });
      const eventId = `${gameId}:${game.moves.length}:${facts.move.san}`;
      if (!personality.enabled || !aiGateway?.chat) {
        return { eventId, quip: fallback, source: personality.enabled ? 'fallback' : 'disabled' };
      }

      try {
        const raw = await withDeadline(aiGateway.chat([
          { role: 'system', content: 'Return only the requested one-line chess reaction.' },
          { role: 'user', content: promptFor({ opponent, level: resolved.level, ...facts, playerColor }) },
        ], {
          model: options.model,
          reasoningEffort: 'none',
          maxTokens: DEFAULTS.maxTokens,
          timeout: options.timeoutMs,
        }), options.timeoutMs);
        const quip = normalizeQuip(raw, options.maxChars);
        if (!quip) throw new Error('invalid_commentary');
        logger?.info?.('chess.commentary.generated', {
          gameId, ply: game.moves.length, level: resolved.level, opponent: opponent.name, quip,
        });
        return { eventId, quip, source: 'ai' };
      } catch (error) {
        logger?.warn?.('chess.commentary.fallback', {
          gameId,
          ply: game.moves.length,
          level: resolved.level,
          opponent: opponent.name,
          reason: error.message,
          apiError: error.apiError || null,
          quip: fallback,
        });
        return { eventId, quip: fallback, source: 'fallback' };
      }
    },
  };
}

export default { createChessOpponentCommentaryService };
