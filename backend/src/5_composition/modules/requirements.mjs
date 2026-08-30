import { RequirementsContainer } from '#apps/requirements/RequirementsContainer.mjs';
import {
  AuthenticatedRequirementsIngress,
  ConfigRequirementsSubjectCatalog,
  HttpRequirementsIdentityAdapter,
  RequirementsEventBusPublisher,
  RoleRequirementsAdministrationAuthorizer,
  YamlRequirementsPolicySource,
  YamlRequirementsProjectionRepository,
  YamlRequirementsStateEngine,
  YamlRequirementsTransitionRepository,
} from '#adapters/requirements/index.mjs';
import { createEntitlementsRouter, createRequirementsRouter } from '#api/v1/routers/requirements.mjs';

export async function createRequirementsModule({
  configService, eventBus, householdId, clock = { now: () => Date.now() }, logger = console,
  roleIds = [], producerPrincipals = {},
  journalRetention = { maxEntries: 5000, maxAgeMs: 30 * 24 * 60 * 60 * 1000 },
}) {
  const moduleLogger = logger.child?.({ module: 'requirements' }) ?? logger;
  const identity = new HttpRequirementsIdentityAdapter();
  const subjectCatalog = new ConfigRequirementsSubjectCatalog({ configService });
  const engine = new YamlRequirementsStateEngine({
    resolveFilePath: id => `${configService.getHouseholdPath('requirements/current', id)}.yml`,
    ...journalRetention,
  });
  const projectionRepository = new YamlRequirementsProjectionRepository({ engine });
  const transitionRepository = new YamlRequirementsTransitionRepository({ engine });
  const policySource = new YamlRequirementsPolicySource({
    load: id => configService.reloadHouseholdAppConfig(id, 'requirements') ?? configService.getHouseholdAppConfig(id, 'requirements'),
  });
  // Producer authorities are added here only when their own bounded context is
  // explicitly migrated. Foundation ships with human attestations as the sole
  // authenticated publisher; a YAML publisher declaration cannot authorize itself.
  const publisherIds = async () => ['manual-attestation', ...Object.keys(producerPrincipals)];
  const container = new RequirementsContainer({
    policySource,
    projectionRepository,
    transitionRepository,
    eventPublisher: new RequirementsEventBusPublisher({ eventBus }),
    administrationAuthorizer: new RoleRequirementsAdministrationAuthorizer(),
    loadSubjects: id => subjectCatalog.load(id),
    publisherIds,
    roleIds: async () => roleIds,
    now: () => clock.now(),
    timezone: id => configService.getHouseholdTimezone(id),
    logger: moduleLogger,
  });
  const actorFromRequest = req => identity.actorFromRequest(req);
  let afterMutation = async () => {};
  const withBoundaryRefresh = operation => async (...args) => {
    const result = await operation(...args);
    try {
      await afterMutation(args[0]);
    } catch (error) {
      // The command is already durably committed at this point. Timer refresh
      // is lifecycle housekeeping, so a refresh failure must not make a caller
      // retry an operation that actually succeeded.
      moduleLogger.error?.('requirements.boundary.refresh_failed', {
        householdId: args[0],
        error: error.message,
      });
    }
    return result;
  };
  const operations = Object.freeze({
    observeAssertion: withBoundaryRefresh(container.observeAssertion),
    retractAssertion: withBoundaryRefresh(container.retractAssertion),
    observeManualAttestation: withBoundaryRefresh(container.observeManualAttestation),
    retractManualAttestation: withBoundaryRefresh(container.retractManualAttestation),
    activatePolicyGraph: withBoundaryRefresh(container.activatePolicyGraph),
    evaluateRequirements: withBoundaryRefresh(container.evaluateRequirements),
    getCurrentRequirements: container.getCurrentRequirements,
    getCurrentEntitlements: container.getCurrentEntitlements,
    getDiagnostics: container.getDiagnostics,
    replayTransitions: container.replayTransitions,
  });
  const ingress = new AuthenticatedRequirementsIngress({
    observeAssertion: operations.observeAssertion,
    retractAssertion: operations.retractAssertion,
    resolvePublisher: principal => Object.entries(producerPrincipals).find(([, fixedPrincipal]) => fixedPrincipal === principal)?.[0] ?? null,
  });
  const configuredHouseholdIds = configService.getAllHouseholdIds?.() ?? [];
  const householdIds = configuredHouseholdIds.length ? configuredHouseholdIds : [householdId];
  const timers = new Map();
  const arm = (id, boundary) => {
    if (timers.has(id)) clearTimeout(timers.get(id));
    if (!Number.isFinite(boundary)) return;
    const delay = Math.max(0, Math.min(2_147_000_000, boundary - clock.now()));
    const timer = setTimeout(async () => {
      try {
        if (clock.now() < boundary) {
          arm(id, boundary);
          return;
        }
        await container.evaluateRequirements(id, 'validity_boundary');
        const snapshot = await projectionRepository.load(id);
        arm(id, container.engine.nextBoundary(snapshot));
      } catch (error) {
        moduleLogger.error?.('requirements.boundary.failed', { householdId: id, error: error.message });
      }
    }, delay);
    timer.unref?.();
    timers.set(id, timer);
  };
  afterMutation = async id => {
    const snapshot = await projectionRepository.load(id);
    arm(id, container.engine.nextBoundary(snapshot));
  };
  for (const id of householdIds) {
    try {
      const lifecycle = await container.reconcile(id);
      arm(id, lifecycle.nextBoundary);
    } catch (error) {
      // Requirements may be unavailable without taking down unrelated household
      // capabilities. The admin endpoint retains activation diagnostics and can
      // recover after the candidate is corrected.
      moduleLogger.error?.('requirements.startup.unavailable', { householdId: id, code: error.code, error: error.message });
    }
  }
  return {
    container,
    ingress,
    requirementsRouter: createRequirementsRouter({ operations, actorFromRequest }),
    entitlementsRouter: createEntitlementsRouter({ operations }),
    administrationOperations: operations,
    actorFromRequest,
    dispose() { for (const timer of timers.values()) clearTimeout(timer); timers.clear(); },
  };
}

export default createRequirementsModule;
