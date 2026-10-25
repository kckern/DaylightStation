import { observationFingerprintsOf } from './observations.mjs';

const SYSTEM_PROMPT = `Select one useful observation from current_evidence.observations, or choose silence.
Return exactly one JSON object: {"observationId":"an offered id"} or {"observationId":null}.
Do not add any other keys, prose, facts, numbers, or markup.
Current evidence is authoritative. historical_context is past messaging only; never treat it as current evidence.
Prefer useful unseen observations. Silence is appropriate when nothing adds useful context.`;

/** The model selects supported facts; its prose is never delivered. */
export class CoachingCommentaryService {
  #agentFactory; #runtime; #logger;
  constructor({ runtime, agentFactory, logger = {} }) {
    this.#runtime = runtime;
    this.#agentFactory = agentFactory;
    this.#logger = logger;
  }

  /** @returns {Promise<object|null>} Selected eligible Observation, never model text. */
  async generate(snapshot) {
    const history = snapshot.recent_coaching || [];
    const seen = new Set(history.flatMap(observationFingerprintsOf));
    const candidates = (snapshot.observations || []).filter(o => !observationFingerprintsOf(o).some(fingerprint => seen.has(fingerprint)))
      .sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
    if (!candidates.length) return null;
    const fallback = candidates[0];
    const input = JSON.stringify({ type: snapshot.type, date: snapshot.date,
      current_evidence: { observations: candidates },
      historical_context: { recent_coaching: history },
    });
    try {
      const response = this.#runtime ? await this.#runtime.execute({ agentId: 'health-coach-commentary',
        input, tools: [], systemPrompt: SYSTEM_PROMPT, context: { userId: snapshot.userId },
        limits: { timeoutMs: 30000, maxToolCalls: 1, maxSteps: 1 } })
        : await this.#agentFactory().generate(input);
      const selected = JSON.parse(response?.output ?? response?.text ?? '');
      if (!selected || Array.isArray(selected) || Object.keys(selected).length !== 1 || !Object.hasOwn(selected, 'observationId')) return fallback;
      if (selected.observationId === null) return null;
      const observation = candidates.find(o => o.id === selected.observationId) || fallback;
      this.#logger.debug?.('coaching.commentary.selected', { type: snapshot.type, observationId: observation.id, kind: observation.kind });
      return observation;
    } catch (error) {
      this.#logger.warn?.('coaching.commentary.selection_failed', { type: snapshot.type, error: error.message });
      return fallback;
    }
  }

  static get SYSTEM_PROMPT() { return SYSTEM_PROMPT; }
}
