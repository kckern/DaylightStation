/** Polling trigger only. The publisher owns current snapshots, rendering,
 * bindings, delivery, and retry acknowledgements. No layout or transport here. */
export class NutritionSurfaceSync {
  #deps; #running = null;
  constructor(deps) {
    for (const key of ['users', 'publisher', 'logger']) if (!deps[key]) throw new Error(`NutritionSurfaceSync requires ${key}`);
    this.#deps = deps;
  }
  run() {
    if (this.#running) return this.#running;
    this.#running = this.#run().finally(() => { this.#running = null; });
    return this.#running;
  }
  async #run() {
    for (const userId of await this.#deps.users()) {
      try { await this.#deps.publisher.publish(userId); }
      catch (error) { this.#deps.logger.warn('nutrition.surface.retry', { userId, error: error.message }); }
    }
  }
}
