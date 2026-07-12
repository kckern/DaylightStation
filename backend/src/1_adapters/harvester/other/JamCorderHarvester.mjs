/**
 * JamCorderHarvester — thin IHarvester adapter that plugs the JamCorder harvest
 * use case into the scheduler. serviceId 'jamcorder' must match the jobs.yml id.
 * Layer: ADAPTER (1_adapters/harvester). Delegates all work to the use case.
 * @module adapters/harvester/other/JamCorderHarvester
 */
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';

export class JamCorderHarvester extends IHarvester {
  #harvestUseCase; #logger;

  constructor({ harvestUseCase, logger = console }) {
    super();
    if (!harvestUseCase) throw new Error('JamCorderHarvester requires harvestUseCase');
    this.#harvestUseCase = harvestUseCase;
    this.#logger = logger;
  }

  get serviceId() { return 'jamcorder'; }
  get category() { return HarvesterCategory.OTHER; }

  async harvest(_username, _options = {}) {
    return this.#harvestUseCase.execute();
  }

  getStatus() {
    return { state: 'closed', failures: 0, lastFailure: null, cooldownUntil: null };
  }

  getParams() { return []; }
}

export default JamCorderHarvester;
