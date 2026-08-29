/** Provider-neutral AI console orchestration. Provider identities are data supplied by composition. */
export class AIConsoleService {
  #providers;
  #transcription;
  #embedding;

  constructor({ providers = [], transcription = null, embedding = null } = {}) {
    this.#providers = providers.map(({ id, gateway = null }) => ({ id, gateway }));
    this.#transcription = transcription;
    this.#embedding = embedding;
  }

  status() {
    return {
      module: 'ai',
      providers: Object.fromEntries(this.#providers.map(({ id, gateway }) => [id, {
        configured: Boolean(gateway),
        model: gateway?.model || null,
      }])),
    };
  }

  supportsTranscription() { return Boolean(this.#transcription?.gateway); }
  supportsEmbedding() { return Boolean(this.#embedding?.gateway); }

  #select(requested) {
    const selected = this.#providers.find(({ id, gateway }) => id === requested && gateway)
      || this.#providers.find(({ gateway }) => gateway)
      || null;
    return { name: requested || selected?.id || null, gateway: selected?.gateway || null };
  }

  async chat(messages, options = {}) { return this.#invoke('chat', messages, options); }
  async chatJson(messages, options = {}) { return this.#invoke('chatWithJson', messages, options); }

  async #invoke(method, messages, { provider, ...options }) {
    const selected = this.#select(provider);
    if (!selected.gateway) return null;
    return { response: await selected.gateway[method](messages, options), provider: selected.name };
  }

  async chatVision(messages, imageUrl, { provider, ...options } = {}) {
    const selected = this.#select(provider);
    if (!selected.gateway) return null;
    return { response: await selected.gateway.chatWithImage(messages, imageUrl, options), provider: selected.name };
  }

  async transcribe(audioBuffer, options) {
    if (!this.#transcription?.gateway) return null;
    return {
      text: await this.#transcription.gateway.transcribe(audioBuffer, options),
      provider: this.#transcription.id,
    };
  }

  async embed(text) {
    if (!this.#embedding?.gateway) return null;
    const value = await this.#embedding.gateway.embed(text);
    return { embedding: value, dimensions: value.length, provider: this.#embedding.id };
  }

  metrics() {
    return Object.fromEntries(this.#providers.map(({ id, gateway }) => [id, gateway?.getMetrics() || null]));
  }

  resetMetrics() {
    for (const { gateway } of this.#providers) gateway?.resetMetrics();
    return { success: true };
  }
}
