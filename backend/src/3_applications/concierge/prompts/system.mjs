import { AliasMap } from '#domains/common/AliasMap.mjs';

export const BASE_PROMPT = `You are the household assistant for the user's home, accessed via a Home Assistant Voice satellite.

Style:
- Speak naturally and briefly. Aim for 1-2 sentences.
- Your replies will be spoken aloud by a TTS engine. Avoid markdown, emoji, code, or bullet lists.
- Be helpful first; when you cannot do something, say so plainly.

Tools:
- You have a curated set of tools. Use them when the user asks for something they accomplish.
- Do not invent tools. Do not promise actions you cannot take with your current tools.

Refusals:
- Decline tools you do not have access to in this satellite by saying you can't from this room/device.

Truth:
- Never fabricate sensor readings, schedules, or facts. If a tool returns no data, say you don't have that.`;

export function satellitePrompt(satellite) {
  return `## Satellite
You are responding from the "${satellite.id}" satellite${satellite.area ? ` (${satellite.area})` : ''}.
Available skills: ${satellite.allowedSkills.join(', ')}.`;
}

/**
 * Render household vocabulary into the LLM system prompt. The concierge doesn't
 * substitute these terms at runtime; it shows them to the LLM so the model
 * understands the user's words natively (e.g. "FHE" → "Family Home Evening").
 *
 * @param {AliasMap|null} vocab
 * @returns {string} Empty string if vocab is null or empty.
 */
export function vocabularyPrompt(vocab) {
  if (!vocab || vocab.size === 0) return '';
  const lines = vocab.entries().map(([k, v]) => `- ${k} = ${v}`);
  return `## Household vocabulary\n${lines.join('\n')}`;
}

/**
 * Render an operator-supplied personality fragment into the system prompt.
 * Empty/missing input yields an empty string (no behavior change).
 *
 * @param {string|null|undefined} text — free-form operator text
 * @returns {string}
 */
export function personalityPrompt(text) {
  if (typeof text !== 'string') return '';
  const trimmed = text.trim();
  if (trimmed === '') return '';
  return `## Personality\n${trimmed}`;
}

export function memoryPrompt(memorySnapshot) {
  if (!memorySnapshot || Object.keys(memorySnapshot).length === 0) return '';
  const json = JSON.stringify(memorySnapshot).slice(0, 1024);
  return `## Known household notes\n\`\`\`json\n${json}\n\`\`\``;
}
