import { TsFsrsEngine } from '#system/scheduling/TsFsrsEngine.mjs';
import { IFlashcardScheduler } from '#apps/school/ports/IFlashcardScheduler.mjs';

/** Anti-corruption adapter for the package-backed FSRS engine. */
export class TsFsrsFlashcardScheduler extends IFlashcardScheduler {
  #engine;
  constructor({ engine = new TsFsrsEngine() } = {}) { super(); this.#engine = engine; }
  initial(args) { return this.#engine.initial(args); }
  rate(args) { return this.#engine.rate(args); }
  preview(args) { return this.#engine.preview(args); }
  retrievability(args) { return this.#engine.retrievability(args); }
  forget(args) { return this.#engine.forget(args); }
  rollback(args) { return this.#engine.rollback(args); }
}
export default TsFsrsFlashcardScheduler;
