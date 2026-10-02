/**
 * StructuredWireLayer — decides the wire format of structured data between
 * the IAIGateway port and a provider adapter. Use cases speak JS objects and
 * JSON-shaped strings; this layer may send tabular data and reply templates
 * as TOON and decodes TOON replies back into exactly what the caller expects.
 * Every failure falls back to today's behaviour. See
 * docs/reference/core/ai-structured-wire-layer.md.
 */
import { IAIGateway } from '#apps/common/ports/IAIGateway.mjs';
import { planWire } from './wire/planWire.mjs';
import { decodeReply } from './wire/replyFormat.mjs';

const MODES = new Set(['off', 'input', 'full']);

export class StructuredWireLayer extends IAIGateway {
  #inner;
  #config;

  /**
   * @param {IAIGateway} inner - The provider adapter (or a scoped view of it)
   * @param {Object} [config]
   * @param {'off'|'input'|'full'} [config.mode='off']
   * @param {number} [config.sample=1] - Share of eligible calls that get a TOON reply
   * @param {Object} [config.logger]
   * @param {() => number} [config.random=Math.random]
   * @param {Object} [config.tags] - Attribution tags, for log context only
   */
  constructor(inner, { mode = 'off', sample = 1, logger = null, random = Math.random, tags = {} } = {}) {
    super();
    this.#inner = inner;
    this.#config = {
      mode: MODES.has(mode) ? mode : 'off',
      sample: Number.isFinite(sample) ? Math.min(1, Math.max(0, sample)) : 1,
      logger, random, tags,
    };
    // Anything not on the port (adapter getters, helpers) resolves on the
    // inner adapter, so wrapping never hides an existing member.
    return new Proxy(this, {
      get: (target, prop) => {
        if (prop in target) {
          const value = target[prop];
          return typeof value === 'function' ? value.bind(target) : value;
        }
        const value = target.#inner?.[prop];
        return typeof value === 'function' ? value.bind(target.#inner) : value;
      },
    });
  }

  chat(messages, options = {}) {
    return this.#textCall(messages, options, (m, o) => this.#inner.chat(m, o));
  }

  chatWithImage(messages, image, options = {}) {
    return this.#textCall(messages, options, (m, o) => this.#inner.chatWithImage(m, image, o));
  }

  async chatStructured(messages, options = {}) {
    const plan = this.#plan(messages);
    if (plan.wire === 'off') return this.#inner.chatStructured(messages, options);
    if (!plan.toonReply) return this.#inner.chatStructured(plan.messages, this.#options(options, plan));
    const raw = await this.#inner.chat(plan.messages, this.#options(options, plan));
    const decoded = this.#decode(raw, plan);
    if (decoded.ok) return decoded.value;
    if (decoded.reason === 'json-reply') {
      try { return JSON.parse(raw.trim()); } catch { /* fall through to the JSON path */ }
    }
    return this.#inner.chatStructured(messages, this.#options(options, { wire: 'json', toonReply: false }));
  }

  transcribe(audioBuffer, options = {}) { return this.#inner.transcribe(audioBuffer, options); }
  embed(text, options = {}) { return this.#inner.embed(text, options); }
  isConfigured() { return typeof this.#inner.isConfigured === 'function' ? this.#inner.isConfigured() : Boolean(this.#inner); }

  scoped(tags = {}) {
    const inner = typeof this.#inner.scoped === 'function' ? this.#inner.scoped(tags) : this.#inner;
    return new StructuredWireLayer(inner, { ...this.#config, tags: { ...this.#config.tags, ...tags } });
  }

  async #textCall(messages, options, call) {
    const plan = this.#plan(messages);
    if (plan.wire === 'off') return call(messages, options);
    const raw = await call(plan.messages, this.#options(options, plan));
    if (!plan.toonReply) return raw;
    const decoded = this.#decode(raw, plan);
    return decoded.ok ? JSON.stringify(decoded.value) : raw;
  }

  #plan(messages) {
    const { mode, sample, random } = this.#config;
    if (mode === 'off') return { messages, wire: 'off', toonReply: false };
    const plan = planWire(messages, { reply: mode === 'full' && random() < sample });
    for (const rewrite of plan.rewrites) this.#log('debug', 'ai.wire.rewrite', rewrite);
    const reason = plan.skip ?? (plan.replyEligible && !plan.toonReply ? (mode === 'input' ? 'input-only' : 'not-sampled') : null);
    if (reason) this.#log('debug', 'ai.wire.skip', { reason });
    return { ...plan, wire: plan.toonReply ? 'toon' : plan.replyEligible ? 'json' : 'passthrough' };
  }

  /** A copy of the caller's options: never mutate theirs. TOON replies cannot use provider JSON mode. */
  #options(options, plan) {
    const { jsonMode, ...rest } = options ?? {};
    const out = plan.toonReply ? rest : { ...options };
    return { ...out, usageTags: { ...options?.usageTags, wire: plan.wire } };
  }

  #decode(raw, plan) {
    const decoded = decodeReply(raw, plan.shape);
    if (decoded.ok) this.#log('debug', 'ai.wire.decode.ok', { rows: decoded.value[plan.shape.arrayKey].length });
    else this.#log('warn', 'ai.wire.decode.fallback', { reason: decoded.reason, sample: typeof raw === 'string' ? raw.slice(0, 200) : null });
    return decoded;
  }

  #log(level, event, data) {
    const { app = null, feature = null } = this.#config.tags;
    this.#config.logger?.[level]?.(event, { app, feature, ...data });
  }
}

export default StructuredWireLayer;
