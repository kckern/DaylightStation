import { IWorkProvider } from '../application/ports/IWorkProvider.mjs';
import { readWorkSnapshot, getWorkItem, readCapabilities } from './workObservationProjection.mjs';
/** Reads scoped Todoist facts; no command authority in the initial increment. */
export class TodoistWorkProvider extends IWorkProvider {
  #options;
  constructor({
    loadCurrent,
    loadHistory,
    resolvePolicy,
    accountId
  }) {
    super();
    if (typeof loadCurrent !== 'function' || typeof loadHistory !== 'function' || typeof resolvePolicy !== 'function' || typeof accountId !== 'string') throw new TypeError('Todoist work reader dependencies required');
    this.#options = {
      loadCurrent,
      loadHistory,
      resolvePolicy,
      accountId,
      provider: 'todoist'
    };
  }
  readSnapshot({
    username,
    scope,
    asOf
  }) {
    return readWorkSnapshot({
      ...this.#options,
      username,
      scope,
      asOf
    });
  }
  getItem({
    username,
    ref,
    asOf
  }) {
    return getWorkItem({
      ...this.#options,
      username,
      ref,
      asOf
    });
  }
  capabilities({
    username
  }) {
    return readCapabilities({
      ...this.#options,
      username
    });
  }
}
