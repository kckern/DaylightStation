import { IWorkProvider } from '../application/ports/IWorkProvider.mjs';
import { readWorkSnapshot, getWorkItem, readCapabilities } from './workObservationProjection.mjs';
/** Board workflow is source context, never a signal to reactivate old work. */
export class ClickUpWorkProvider extends IWorkProvider {
  #options;
  constructor({
    loadCurrent,
    loadHistory,
    resolvePolicy,
    accountId
  }) {
    super();
    if (typeof loadCurrent !== 'function' || typeof loadHistory !== 'function' || typeof resolvePolicy !== 'function' || typeof accountId !== 'string') throw new TypeError('ClickUp work reader dependencies required');
    this.#options = {
      loadCurrent,
      loadHistory,
      resolvePolicy,
      accountId,
      provider: 'clickup'
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
