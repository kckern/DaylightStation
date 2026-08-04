import { BuildSchoolCalcArtifact } from './BuildSchoolCalcArtifact.mjs';
import { BuildSchoolCalcInstallSet } from './BuildSchoolCalcInstallSet.mjs';
import { BuildLearningLesson } from '../catalog/BuildLearningLesson.mjs';
import { EnrollSchoolCalcDevice } from './EnrollSchoolCalcDevice.mjs';
import { ExchangeSchoolCalcInteraction } from './ExchangeSchoolCalcInteraction.mjs';
import { GetSchoolCalcArtifact } from './GetSchoolCalcArtifact.mjs';
import { GetSchoolCalcCatalog } from './GetSchoolCalcCatalog.mjs';
import { GetSchoolCalcLearnerRoster } from './GetSchoolCalcLearnerRoster.mjs';
import { GetSchoolCalcProgressProjection } from './GetSchoolCalcProgressProjection.mjs';
import { IdentifySchoolCalcDevice } from './IdentifySchoolCalcDevice.mjs';
import { ImportSchoolCalcResult } from './ImportSchoolCalcResult.mjs';
import { ImportSchoolCalcResultQueue } from './ImportSchoolCalcResultQueue.mjs';
import { ObserveSchoolCalcDevice } from './ObserveSchoolCalcDevice.mjs';
import { PlanSchoolCalcSync } from './PlanSchoolCalcSync.mjs';
import { RequestSchoolCalcDelivery } from './RequestSchoolCalcDelivery.mjs';
import { SchoolCalcCodecRegistry } from './SchoolCalcCodecRegistry.mjs';
import { createCoreLearningModuleRegistry } from '../catalog/LearningModuleRegistry.mjs';
import { SyncSchoolCalcDevice } from './SyncSchoolCalcDevice.mjs';
import { ValidateSchoolCalcPublication } from './ValidateSchoolCalcPublication.mjs';
import { HydrateSchoolCalcActions } from './HydrateSchoolCalcActions.mjs';
import { ResolveSchoolCalcAction } from './ResolveSchoolCalcAction.mjs';
import { ResolveSchoolCalcFollowUp } from './ResolveSchoolCalcFollowUp.mjs';

/** Injection-only application composition. Concrete adapters remain in the bootstrap layer. */
export class SchoolCalcContainer {
  constructor({
    codecs,
    catalogs,
    content,
    artifacts,
    devices,
    resultLedger,
    progress,
    learningProgress,
    grader,
    deviceIdFactory,
    learners,
    catalogAccess,
    lessonBundles = null,
    moduleRegistry = null,
    customModuleDefinitions = [],
    actionTokens = null,
    actionExecutor = null,
    remediationOffers = null,
    remediationTutor = null,
    probeEvidenceRepository = null,
    logger = null,
    clock = () => new Date(),
  } = {}) {
    if (!catalogs || !content || !artifacts || !devices || !resultLedger || !progress
        || !learningProgress || typeof learningProgress.execute !== 'function' || !grader
        || !learners || typeof learners.listLearners !== 'function' || !catalogAccess) {
      throw new Error('SchoolCalcContainer requires catalog, content, artifact, device, ledger, progress, grader, and learner dependencies');
    }
    const codecRegistry = new SchoolCalcCodecRegistry({ codecs });
    const modules = moduleRegistry
      ?? createCoreLearningModuleRegistry({ customDefinitions: customModuleDefinitions });
    const bundles = lessonBundles
      ?? new BuildLearningLesson({ catalogs, content, modules });
    const actions = actionTokens ? new HydrateSchoolCalcActions({ content, issuer: actionTokens }) : null;
    const buildArtifact = new BuildSchoolCalcArtifact({
      devices, codecs: codecRegistry, bundles, artifacts, actions,
    });
    const buildInstallSet = new BuildSchoolCalcInstallSet({ catalogs, buildArtifact });
    const catalog = new GetSchoolCalcCatalog({
      devices, catalogs, bundles, codecs: codecRegistry, artifacts, access: catalogAccess,
    });
    const importResult = new ImportSchoolCalcResult({
      codecs: codecRegistry, devices, artifacts, ledger: resultLedger, grader, progress,
      remediationOffers, clock,
      probeEvidenceRepository,
    });

    this.codecRegistry = codecRegistry;
    this.moduleRegistry = modules;
    this.buildLessonBundle = bundles;
    this.hydrateActions = actions;
    this.resolveAction = actionExecutor
      ? new ResolveSchoolCalcAction({ devices, content, executor: actionExecutor })
      : null;
    const getProgressProjection = new GetSchoolCalcProgressProjection({
      devices, progress: learningProgress, codecs: codecRegistry, logger,
    });
    this.createRemediationOffer = remediationOffers;
    this.remediationTutor = remediationTutor;
    this.validatePublication = new ValidateSchoolCalcPublication({ catalogs, bundles });
    this.enrollDevice = new EnrollSchoolCalcDevice({ devices, codecs: codecRegistry, deviceIdFactory, learners, clock });
    this.getLearnerRoster = new GetSchoolCalcLearnerRoster({ devices, learners, codecs: codecRegistry, clock });
    this.getProgressProjection = getProgressProjection;
    const resolveFollowUp = new ResolveSchoolCalcFollowUp({
      devices, progress: getProgressProjection, codecs: codecRegistry, remediationTutor,
    });
    const exchangeInteraction = remediationTutor
      ? new ExchangeSchoolCalcInteraction({
        devices, codecs: codecRegistry, followUps: resolveFollowUp,
        remediationTutor, logger,
      })
      : null;
    this.resolveFollowUp = resolveFollowUp;
    this.exchangeInteraction = exchangeInteraction;
    this.identifyDevice = new IdentifySchoolCalcDevice({ devices, codecs: codecRegistry });
    this.observeDevice = new ObserveSchoolCalcDevice({ devices, codecs: codecRegistry, clock });
    this.buildArtifact = buildArtifact;
    this.buildInstallSet = buildInstallSet;
    this.getArtifact = new GetSchoolCalcArtifact({ artifacts });
    this.getCatalog = catalog;
    this.requestDelivery = new RequestSchoolCalcDelivery({
      devices, codecs: codecRegistry, catalog, buildArtifact, buildInstallSet, clock,
    });
    this.importResult = importResult;
    this.importResultQueue = new ImportSchoolCalcResultQueue({ devices, codecs: codecRegistry, importResult });
    this.planSync = new PlanSchoolCalcSync({ devices, artifacts, ledger: resultLedger, catalog, codecs: codecRegistry });
    this.syncDevice = new SyncSchoolCalcDevice({
      profiles: this.getLearnerRoster,
      progress: this.getProgressProjection,
      observe: this.observeDevice,
      importQueue: this.importResultQueue,
      requests: this.requestDelivery,
      interactions: exchangeInteraction,
      plan: this.planSync,
    });
  }
}

export default SchoolCalcContainer;
