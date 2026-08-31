import { StateGatesContainer } from '#apps/state-gates/StateGatesContainer.mjs';
import {
  AuthenticatedStateGatesIngress,
  ConfigStateGatesSubjectCatalog,
  HttpStateGatesIdentityAdapter,
  StateGatesEventBusPublisher,
  RoleStateGatesAdministrationAuthorizer,
  YamlStateGatesPolicySource,
  YamlStateGatesProjectionRepository,
  YamlStateGatesStateEngine,
  YamlStateGatesTransitionRepository,
} from '#adapters/state-gates/index.mjs';
import { createEntitlementsRouter, createStateGatesRouter } from '#api/v1/routers/state-gates.mjs';
import { INSTALLED_STATE_GATES_POLICY } from './installedStateGatesPolicy.mjs';

function normalizeRetryPolicy(value = {}) {
  const policy = {
    initialDelayMs: value.initialDelayMs ?? 1_000,
    multiplier: value.multiplier ?? 2,
    maxDelayMs: value.maxDelayMs ?? 60_000,
    jitterRatio: value.jitterRatio ?? 0.2,
  };
  if (!Number.isFinite(policy.initialDelayMs) || policy.initialDelayMs < 1
    || !Number.isFinite(policy.multiplier) || policy.multiplier < 1
    || !Number.isFinite(policy.maxDelayMs) || policy.maxDelayMs < policy.initialDelayMs
    || !Number.isFinite(policy.jitterRatio) || policy.jitterRatio < 0 || policy.jitterRatio > 1) {
    throw new Error('State Gates retry policy is invalid');
  }
  return Object.freeze(policy);
}

function deterministicUnit(seed) {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) / 4_294_967_296;
}

export function stateGatesRetryDelay(policy, channel, householdId, attempt) {
  const base = Math.min(
    policy.maxDelayMs,
    policy.initialDelayMs * (policy.multiplier ** attempt),
  );
  const jitter = policy.jitterRatio * ((2 * deterministicUnit(`${channel}:${householdId}:${attempt}`)) - 1);
  return Math.min(policy.maxDelayMs, Math.max(1, Math.round(base * (1 + jitter))));
}

export async function createStateGatesModule({
  configService, eventBus, householdId, clock = { now: () => Date.now() }, logger = console,
  roleIds = [], producerPrincipals = {},
  installedPolicy = INSTALLED_STATE_GATES_POLICY,
  journalRetention = { maxEntries: 5000, maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
  retryPolicy: retryPolicyInput = {},
}) {
  const moduleLogger = logger.child?.({ module: 'state-gates' }) ?? logger;
  const retryPolicy = normalizeRetryPolicy(retryPolicyInput);
  const identity = new HttpStateGatesIdentityAdapter();
  const subjectCatalog = new ConfigStateGatesSubjectCatalog({ configService });
  const engine = new YamlStateGatesStateEngine({
    resolveFilePath: id => `${configService.getHouseholdPath('state-gates/current', id)}.yml`,
    ...journalRetention,
  });
  const projectionRepository = new YamlStateGatesProjectionRepository({ engine });
  const transitionRepository = new YamlStateGatesTransitionRepository({ engine });
  const policySource = new YamlStateGatesPolicySource({
    load: id => configService.reloadHouseholdAppConfig(id, 'state-gates')
      ?? configService.getHouseholdAppConfig(id, 'state-gates')
      ?? installedPolicy,
  });
  // A YAML publisher declaration cannot authorize itself. Only fixed
  // composition-owned principals can enter through authenticated ingress.
  const publisherIds = async () => ['manual-attestation', ...Object.keys(producerPrincipals)];
  const container = new StateGatesContainer({
    policySource,
    projectionRepository,
    transitionRepository,
    eventPublisher: new StateGatesEventBusPublisher({ eventBus }),
    administrationAuthorizer: new RoleStateGatesAdministrationAuthorizer(),
    loadSubjects: id => subjectCatalog.load(id),
    publisherIds,
    roleIds: async () => roleIds,
    now: () => clock.now(),
    timezone: id => configService.getHouseholdTimezone(id),
    logger: moduleLogger,
  });
  const actorFromRequest = req => identity.actorFromRequest(req);
  const boundaryTimers = new Map();
  const deliveryTimers = new Map();
  let disposed = false;

  const retryDelay = (channel, id, attempt) => stateGatesRetryDelay(retryPolicy, channel, id, attempt);
  const clearScheduled = (timers, id) => {
    const timer = timers.get(id);
    if (timer) clearTimeout(timer);
    timers.delete(id);
  };

  const armBoundary = (id, boundary) => {
    clearScheduled(boundaryTimers, id);
    if (disposed || !Number.isFinite(boundary)) return;
    const delay = Math.max(0, Math.min(2_147_000_000, boundary - clock.now()));
    const timer = setTimeout(async () => {
      boundaryTimers.delete(id);
      if (disposed) return;
      if (clock.now() < boundary) {
        armBoundary(id, boundary);
        return;
      }
      try {
        const result = await container.evaluateGates(id, 'validity_boundary');
        if (result.deliveryPending) ensureDeliveryRetry(id);
        const snapshot = await projectionRepository.load(id);
        armBoundary(id, container.engine.nextBoundary(snapshot));
      } catch (error) {
        moduleLogger.error?.('state-gates.boundary.failed', {
          householdId: id, error: error.message, retryInMs: retryDelay('boundary', id, 0),
        });
        scheduleBoundaryRetry(id, 'evaluate', 0);
      }
    }, delay);
    timer.unref?.();
    boundaryTimers.set(id, timer);
  };

  const refreshBoundary = async id => {
    const snapshot = await projectionRepository.load(id);
    armBoundary(id, container.engine.nextBoundary(snapshot));
  };

  const scheduleBoundaryRetry = (id, mode, attempt) => {
    clearScheduled(boundaryTimers, id);
    if (disposed) return;
    const delay = retryDelay('boundary', id, attempt);
    const timer = setTimeout(async () => {
      boundaryTimers.delete(id);
      if (disposed) return;
      let retryMode = mode;
      try {
        if (mode === 'evaluate') {
          const result = await container.evaluateGates(id, 'validity_boundary');
          if (result.deliveryPending) ensureDeliveryRetry(id);
          retryMode = 'refresh';
        }
        await refreshBoundary(id);
      } catch (error) {
        const nextAttempt = attempt + 1;
        moduleLogger.error?.('state-gates.boundary.retry_failed', {
          householdId: id, mode: retryMode, attempt: nextAttempt,
          error: error.message, retryInMs: retryDelay('boundary', id, nextAttempt),
        });
        scheduleBoundaryRetry(id, retryMode, nextAttempt);
      }
    }, delay);
    timer.unref?.();
    boundaryTimers.set(id, timer);
  };

  const scheduleDeliveryRetry = (id, attempt) => {
    clearScheduled(deliveryTimers, id);
    if (disposed) return;
    const delay = retryDelay('delivery', id, attempt);
    const timer = setTimeout(async () => {
      deliveryTimers.delete(id);
      if (disposed) return;
      try {
        const result = await container.flushPendingTransitions(id);
        if (result.deliveryPending) scheduleDeliveryRetry(id, attempt + 1);
      } catch (error) {
        const nextAttempt = attempt + 1;
        moduleLogger.error?.('state-gates.delivery.retry_failed', {
          householdId: id, attempt: nextAttempt,
          error: error.message, retryInMs: retryDelay('delivery', id, nextAttempt),
        });
        scheduleDeliveryRetry(id, nextAttempt);
      }
    }, delay);
    timer.unref?.();
    deliveryTimers.set(id, timer);
  };

  function ensureDeliveryRetry(id) {
    if (!disposed && !deliveryTimers.has(id)) scheduleDeliveryRetry(id, 0);
  }

  const withBoundaryRefresh = operation => async (...args) => {
    const result = await operation(...args);
    try {
      await refreshBoundary(args[0]);
    } catch (error) {
      // The command is already durably committed at this point. Timer refresh
      // is lifecycle housekeeping, so a refresh failure must not make a caller
      // retry an operation that actually succeeded.
      moduleLogger.error?.('state-gates.boundary.refresh_failed', {
        householdId: args[0],
        error: error.message, retryInMs: retryDelay('boundary', args[0], 0),
      });
      scheduleBoundaryRetry(args[0], 'refresh', 0);
    }
    if (result.deliveryPending) ensureDeliveryRetry(args[0]);
    return result;
  };
  const operations = Object.freeze({
    observeAssertion: withBoundaryRefresh(container.observeAssertion),
    retractAssertion: withBoundaryRefresh(container.retractAssertion),
    observeManualAttestation: withBoundaryRefresh(container.observeManualAttestation),
    retractManualAttestation: withBoundaryRefresh(container.retractManualAttestation),
    activatePolicyGraph: withBoundaryRefresh(container.activatePolicyGraph),
    evaluateGates: withBoundaryRefresh(container.evaluateGates),
    getCurrentGates: container.getCurrentGates,
    getCurrentEntitlements: container.getCurrentEntitlements,
    getDiagnostics: container.getDiagnostics,
    replayTransitions: container.replayTransitions,
    flushPendingTransitions: container.flushPendingTransitions,
  });
  const ingress = new AuthenticatedStateGatesIngress({
    observeAssertion: operations.observeAssertion,
    retractAssertion: operations.retractAssertion,
    resolvePublisher: principal => Object.entries(producerPrincipals).find(([, fixedPrincipal]) => fixedPrincipal === principal)?.[0] ?? null,
  });
  const configuredHouseholdIds = configService.getAllHouseholdIds?.() ?? [];
  const householdIds = configuredHouseholdIds.length ? configuredHouseholdIds : [householdId];
  for (const id of householdIds) {
    try {
      const lifecycle = await container.reconcile(id);
      armBoundary(id, lifecycle.nextBoundary);
      if (lifecycle.deliveryPending) ensureDeliveryRetry(id);
    } catch (error) {
      // State Gates may be unavailable without taking down unrelated household
      // capabilities. The admin endpoint retains activation diagnostics and can
      // recover after the candidate is corrected.
      moduleLogger.error?.('state-gates.startup.unavailable', { householdId: id, code: error.code, error: error.message });
    }
  }
  return {
    container,
    ingress,
    stateGatesRouter: createStateGatesRouter({ operations, actorFromRequest }),
    entitlementsRouter: createEntitlementsRouter({ operations }),
    administrationOperations: operations,
    actorFromRequest,
    dispose() {
      disposed = true;
      for (const timer of [...boundaryTimers.values(), ...deliveryTimers.values()]) clearTimeout(timer);
      boundaryTimers.clear();
      deliveryTimers.clear();
    },
  };
}

export default createStateGatesModule;
