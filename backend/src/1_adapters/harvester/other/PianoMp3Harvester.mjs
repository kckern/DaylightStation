/**
 * PianoMp3Harvester — thin IHarvester adapter that plugs the piano MIDI→MP3
 * conversion use case into the scheduler. serviceId 'piano-mp3' must match the
 * jobs.yml id. Layer: ADAPTER (1_adapters/harvester). Delegates all work.
 * @module adapters/harvester/other/PianoMp3Harvester
 */
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';

export class PianoMp3Harvester extends IHarvester {
  #convertUseCase; #logger;

  constructor({ convertUseCase, logger = console }) {
    super();
    if (!convertUseCase) throw new Error('PianoMp3Harvester requires convertUseCase');
    this.#convertUseCase = convertUseCase;
    this.#logger = logger;
  }

  get serviceId() { return 'piano-mp3'; }
  get category() { return HarvesterCategory.OTHER; }

  async harvest(_username, _options = {}) {
    return this.#convertUseCase.execute();
  }

  getStatus() {
    return { state: 'closed', failures: 0, lastFailure: null, cooldownUntil: null };
  }

  getParams() { return []; }
}

export default PianoMp3Harvester;
