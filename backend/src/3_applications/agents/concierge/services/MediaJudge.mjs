/**
 * MediaJudge — picks the single best candidate for a voice play_media query
 * from a list of search results. Backed by a (cheap) IAgentRuntime so it can
 * exercise the existing Mastra wiring without coupling to the runtime.
 *
 * Returns: { index: number, reason: string, latencyMs: number }
 *  - index === -1 when the judge cannot decide; caller falls back to its
 *    default pick (top of rank).
 */
const SYSTEM_PROMPT = `You are a music-library disambiguator.
Given a user's spoken request and a short list of candidate items, pick the single best match.
Prefer:
- exact title matches over partial matches
- the original/original-artist version over covers (unless the user named the cover artist)
- tracks over containers when the user named a specific song
- containers (album, artist, playlist) when the user did NOT name a specific song
- higher userRating and playCount as tie-breakers
Respond with strict JSON: {"index": <0-based int>, "reason": "<short phrase>"}.
If nothing seems right return {"index": -1, "reason": "no_confident_pick"}.
No prose outside the JSON.`;

export class MediaJudge {
  #agentRuntime;
  #logger;
  #timeoutMs;

  constructor({ agentRuntime, logger = console, timeoutMs = 8000 }) {
    if (!agentRuntime?.execute) throw new Error('MediaJudge: agentRuntime with execute() required');
    this.#agentRuntime = agentRuntime;
    this.#logger = logger;
    this.#timeoutMs = timeoutMs;
  }

  /**
   * @param {{query: string, candidates: Array<{id, title, source, mediaType, userRating, playCount}>}} args
   * @returns {Promise<{index: number, reason: string, latencyMs: number}>}
   */
  async pick({ query, candidates }) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      return { index: -1, reason: 'no_candidates', latencyMs: 0 };
    }
    if (candidates.length === 1) return { index: 0, reason: 'only_candidate', latencyMs: 0 };

    const start = Date.now();
    const userPrompt = buildPrompt(query, candidates);

    const racer = (async () => {
      const result = await this.#agentRuntime.execute({
        agentId: 'concierge.media-judge',
        input: userPrompt,
        tools: [],
        systemPrompt: SYSTEM_PROMPT,
        context: {},
      });
      return result?.output ?? '';
    })();
    const timer = new Promise((_, rej) => setTimeout(() => rej(new Error('judge_timeout')), this.#timeoutMs));

    let raw;
    try {
      raw = await Promise.race([racer, timer]);
    } catch (err) {
      this.#logger.warn?.('concierge.media.judge.timeout_or_error', { error: err.message });
      return { index: -1, reason: `judge_failed:${err.message}`, latencyMs: Date.now() - start };
    }

    const parsed = parseJudgeOutput(raw);
    if (!parsed || typeof parsed.index !== 'number') {
      this.#logger.warn?.('concierge.media.judge.parse_failed', { raw: String(raw).slice(0, 200) });
      return { index: -1, reason: 'judge_parse_failed', latencyMs: Date.now() - start };
    }
    if (parsed.index < -1 || parsed.index >= candidates.length) {
      return { index: -1, reason: 'judge_out_of_range', latencyMs: Date.now() - start };
    }
    return {
      index: parsed.index,
      reason: parsed.reason || 'judge_picked',
      latencyMs: Date.now() - start,
    };
  }
}

function buildPrompt(query, candidates) {
  const lines = candidates.map((c, i) => {
    const bits = [`${i}: ${c.title ?? '?'}`];
    if (c.source) bits.push(`source=${c.source}`);
    if (c.mediaType) bits.push(`type=${c.mediaType}`);
    if (c.userRating != null && c.userRating !== 0) bits.push(`userRating=${c.userRating}`);
    if (c.playCount != null && c.playCount !== 0) bits.push(`plays=${c.playCount}`);
    bits.push(`id=${c.id}`);
    return `  - ${bits.join('  ')}`;
  });
  return `User asked: "${query}"

Candidates:
${lines.join('\n')}

Pick the best one.`;
}

function parseJudgeOutput(raw) {
  if (typeof raw !== 'string') return null;
  // Try a strict parse first, then fall back to extracting the first JSON object.
  try {
    return JSON.parse(raw.trim());
  } catch { /* fall through */ }
  const match = raw.match(/\{[^{}]*"index"\s*:\s*(-?\d+)[^{}]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return { index: parseInt(match[1], 10), reason: 'extracted' };
  }
}

export default MediaJudge;
