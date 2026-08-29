export class EpaperDisplayService {
  #display; #clock;
  constructor({ display = null, clock = () => new Date() } = {}) { this.#display = display; this.#clock = clock; }
  get configured() { return !!this.#display; }
  async image({ fresh = false } = {}) { if (!this.#display) return null; return (!fresh && this.#display.getCached()) || this.#display.render(); }
  async render(data) { if (!this.#display) return null; const bytes = await this.#display.render(data); return { ok: true, sizeBytes: bytes.length, renderedAt: this.#clock().toISOString() }; }
  status() { return this.#display ? this.#display.getStatus() : null; }
}
