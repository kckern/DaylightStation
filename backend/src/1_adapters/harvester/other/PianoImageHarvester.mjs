/**
 * PianoImageHarvester — thin IHarvester adapter that plugs the piano-roll PNG
 * rendering use case into the scheduler. serviceId 'piano-png' must match the
 * jobs.yml id. Layer: ADAPTER (1_adapters/harvester). Delegates all work.
 * @module adapters/harvester/other/PianoImageHarvester
 */
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';

export class PianoImageHarvester extends IHarvester {
  #renderUseCase; #logger;

  constructor({ renderUseCase, logger = console }) {
    super();
    if (!renderUseCase) throw new Error('PianoImageHarvester requires renderUseCase');
    this.#renderUseCase = renderUseCase;
    this.#logger = logger;
  }

  get serviceId() { return 'piano-png'; }
  get category() { return HarvesterCategory.OTHER; }

  async harvest(_username, _options = {}) {
    return this.#renderUseCase.execute();
  }

  getStatus() {
    return { state: 'closed', failures: 0, lastFailure: null, cooldownUntil: null };
  }

  getParams() { return []; }
}

export default PianoImageHarvester;
