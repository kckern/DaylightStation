/**
 * AiGatewayService — the contract behind `/api/v1/ai`.
 *
 * The router was written against this service and app.mjs was handing it
 * bare adapters, which is why every route under `/ai` threw the moment the
 * router was finally mounted. This is the thin thing in between: pick a
 * provider, delegate, and answer "not configured" as `null` rather than a
 * throw so the router can turn it into a 503.
 *
 * Providers are ports (IAIGateway); nothing here knows how a call is made.
 */
export class AiGatewayService {
  #providers;
  #defaultProvider;
  #logger;

  /**
   * @param {{openai?: object|null, anthropic?: object|null}} providers
   * @param {{defaultProvider?: string, logger?: object}} [opts]
   */
  constructor(providers = {}, { defaultProvider = 'openai', logger = console } = {}) {
    this.#providers = Object.fromEntries(Object.entries(providers).filter(([, p]) => p));
    this.#defaultProvider = this.#providers[defaultProvider] ? defaultProvider : Object.keys(this.#providers)[0] ?? null;
    this.#logger = logger;
  }

  #pick(name) {
    if (name && !this.#providers[name]) return null;
    return this.#providers[name ?? this.#defaultProvider] ?? null;
  }

  status() {
    return {
      providers: Object.keys(this.#providers),
      default: this.#defaultProvider,
      transcription: this.supportsTranscription(),
      embedding: this.supportsEmbedding(),
    };
  }

  async chat(messages, { provider, ...options } = {}) {
    const p = this.#pick(provider);
    if (!p) return null;
    return { provider: provider ?? this.#defaultProvider, content: await p.chat(messages, options) };
  }

  async chatJson(messages, { provider, ...options } = {}) {
    const p = this.#pick(provider);
    if (!p) return null;
    return { provider: provider ?? this.#defaultProvider, json: await p.chatWithJson(messages, options) };
  }

  async chatVision(messages, imageUrl, { provider, ...options } = {}) {
    const p = this.#pick(provider);
    if (!p) return null;
    return { provider: provider ?? this.#defaultProvider, content: await p.chatWithImage(messages, imageUrl, options) };
  }

  supportsTranscription() { return Boolean(this.#providers.openai); }

  async transcribe(audioBuffer, options = {}) {
    if (!this.supportsTranscription()) return null;
    return { text: await this.#providers.openai.transcribe(audioBuffer, options) };
  }

  supportsEmbedding() { return Boolean(this.#providers.openai); }

  async embed(text) {
    if (!this.supportsEmbedding()) return null;
    return { embedding: await this.#providers.openai.embed(text) };
  }

  metrics() {
    return Object.fromEntries(Object.entries(this.#providers).map(([name, p]) => [name, p.getMetrics?.() ?? null]));
  }

  resetMetrics() {
    for (const p of Object.values(this.#providers)) p.resetMetrics?.();
    this.#logger.info?.('ai.metrics.reset', { providers: Object.keys(this.#providers) });
    return this.metrics();
  }
}

export default AiGatewayService;
