import { createTriageRouter } from './api/triageRouter.mjs';
import { resolveTriagePolicy } from './domain/triagePolicy.mjs';

/**
 * Triage runtime. `pass` and `session` are placeholders that later tasks fill in.
 * `configuration` is a function returning the household `triage` app config.
 */
export function createTriageRuntime(deps = {}) {
  const { configuration, defaultUsername, isKnownUser, logger } = deps;
  const router = createTriageRouter({
    resolvePolicy: (username) => resolveTriagePolicy({ configuration: configuration?.(), username }), defaultUsername, isKnownUser, logger });
  return {
    router,
    pass: null,
    session: null,
    async start() { logger?.info?.('triage.runtime.started', {}); },
    async dispose() { logger?.info?.('triage.runtime.disposed', {}); },
  };
}
