const WINDOW_MS = 10_000;

function stable(value) {
  if (value == null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
}

function fallbackTriggerId({ content, targetId, kind }) {
  const value = stable({ content, targetId, kind });
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fallback-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export class RoutineTriggerDedupeService {
  #clock;
  #windowMs;
  #recent = new Map();

  constructor({ clock = Date, windowMs = WINDOW_MS } = {}) {
    this.#clock = clock;
    this.#windowMs = windowMs;
  }

  async run(input, execute) {
    if (input?.origin?.kind !== 'routine') return execute();
    const trigger = input?.triggerId || fallbackTriggerId(input ?? {});
    const key = JSON.stringify([trigger, input?.targetId]);
    const now = this.#clock.now();
    const prior = this.#recent.get(key);
    if (prior != null && now - prior.seenAt <= this.#windowMs) {
      const result = await prior.result;
      return { ...result, deduplicated: true };
    }
    const resultPromise = Promise.resolve().then(execute);
    this.#recent.set(key, { seenAt: now, result: resultPromise });
    try {
      const result = await resultPromise;
      if (result?.ok === false) this.#recent.delete(key);
      return result;
    } catch (error) {
      this.#recent.delete(key);
      throw error;
    }
  }
}

export default RoutineTriggerDedupeService;
