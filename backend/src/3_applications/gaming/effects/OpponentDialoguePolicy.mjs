/**
 * Game-neutral guardrails for short, player-facing opponent dialogue.
 *
 * A game owns its facts and any vocabulary that must remain private. This
 * policy owns the common boundary: child safety, concise output, no repetition
 * of what the player has already seen, and data-authored lore allowlists.
 */
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

function words(text) {
  return text.toLowerCase().match(/[a-z]+(?:'[a-z]+)?/g) || [];
}

function repeatsShownDialogue(text, dialogue) {
  const candidate = words(text);
  if (candidate.length < 2 || !Array.isArray(dialogue)) return false;
  return dialogue.some((entry) => {
    const previous = words(entry?.quip || '');
    if (previous.length < 2) return false;
    if (candidate[0] === previous[0] && candidate[1] === previous[1]) return true;
    for (let index = 0; index <= candidate.length - 3; index += 1) {
      const phrase = candidate.slice(index, index + 3).join(' ');
      for (let offset = 0; offset <= previous.length - 3; offset += 1) {
        if (phrase === previous.slice(offset, offset + 3).join(' ')) return true;
      }
    }
    return false;
  });
}

function containsUnapprovedLore(text, lore) {
  const allowed = new Set((lore?.references || []).map((value) => String(value).toLowerCase()));
  return (lore?.known_references || []).some((reference) => {
    const phrase = String(reference).trim();
    return phrase && new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\b`, 'i').test(text)
      && !allowed.has(phrase.toLowerCase());
  });
}

/** Return a safe line or null, never a partially sanitized model response. */
export function normalizeOpponentDialogue(value, {
  maxChars = 96,
  dialogue = [],
  lore = null,
  forbiddenPatterns = [],
} = {}) {
  if (typeof value !== 'string') return null;
  let text = value.replace(/\s+/g, ' ').trim();
  text = text.replace(/^\s*(?:quip|opponent|response)\s*:\s*/i, '');
  text = text.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  if (!text || UNSAFE.test(text) || /\p{Extended_Pictographic}/u.test(text)
    || forbiddenPatterns.some((pattern) => pattern?.test?.(text))) return null;
  const sentenceEnd = text.search(/[.!?](?:\s|$)/);
  if (sentenceEnd >= 0) text = text.slice(0, sentenceEnd + 1);
  text = clampWords(text, maxChars);
  if (!text || text.split(/\s+/).length < 2 || repeatsShownDialogue(text, dialogue) || containsUnapprovedLore(text, lore)) return null;
  if (/[.!?]$/.test(text)) return text;
  const punctuated = text.length < maxChars ? `${text}.` : `${clampWords(text, maxChars - 1)}.`;
  return punctuated.length <= maxChars ? punctuated : null;
}

export default { normalizeOpponentDialogue };
