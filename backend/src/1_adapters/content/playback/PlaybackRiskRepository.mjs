import { IPlaybackRiskRepository } from '#apps/content/ports/IPlaybackRiskRepository.mjs';

const clone = (value) => structuredClone(value);

/**
 * In-memory adapter seam for the control-plane increment. A3 will supply the
 * durable state-store implementation without changing the application port.
 */
export class PlaybackRiskRepository extends IPlaybackRiskRepository {
  #state;

  constructor({ state = {} } = {}) {
    super();
    this.#state = state;
    this.#state.rules ||= [];
    this.#state.outcomes ||= [];
  }

  async find({ profileKey, environmentVersion }) {
    return this.#state.rules
      .filter(rule => rule?.scope?.profileKey === profileKey && rule?.scope?.environmentVersion === environmentVersion)
      .map(clone);
  }

  async record(outcome) {
    if (!this.#state.outcomes.some(item => item?.incidentId === outcome?.incidentId)) this.#state.outcomes.push(clone(outcome));
  }

  async save(rule) {
    this.#state.rules.push(clone(rule));
  }
}

export default PlaybackRiskRepository;
