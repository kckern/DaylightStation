/** Existing school learning runtime assembly; preserves construction order. */
import { YamlSchoolDatastore as YamlSchoolDatastore } from "../adapters/persistence/YamlSchoolDatastore.mjs";
import { YamlSessionResultArtifactStore as YamlSessionResultArtifactStore } from "../adapters/persistence/YamlSessionResultArtifactStore.mjs";
import { ConfiguredSchoolLearningDirectory as ConfiguredSchoolLearningDirectory } from "../adapters/progress/index.mjs";
import { ConfiguredAcademicPeriodSource as ConfiguredAcademicPeriodSource } from "../adapters/progress/index.mjs";
import { SchoolService as SchoolService } from "../application/SchoolService.mjs";
import { GeneratedBankSource as GeneratedBankSource } from "../adapters/generated-content/GeneratedBankSource.mjs";
import path from "path";
import { YamlLearningEvidenceRepository as YamlLearningEvidenceRepository } from "../adapters/progress/index.mjs";
import { YamlSchoolAttemptEvidenceSource as YamlSchoolAttemptEvidenceSource } from "../adapters/progress/index.mjs";
import { createSchoolLearningLoop as createSchoolLearningLoop } from "./schoolLearning.mjs";
import { ConfiguredLearningExpectationSource as ConfiguredLearningExpectationSource } from "../adapters/progress/index.mjs";
import { CurriculumExpectationSource as CurriculumExpectationSource } from "../adapters/progress/index.mjs";
import { GetLearningProgress as GetLearningProgress } from "../application/GetLearningProgress.mjs";
import { AssessmentReviewFollowUpSource as AssessmentReviewFollowUpSource } from "../application/AssessmentReviewFollowUpSource.mjs";
import { GetInstructionalInsights as GetInstructionalInsights } from "../application/GetInstructionalInsights.mjs";
import { RecordLearningReflection as RecordLearningReflection } from "../application/RecordLearningReflection.mjs";
import { createLearningReflectionEvidenceId as createLearningReflectionEvidenceId } from "./schoolLearning.mjs";

export async function createSchoolLearningRuntime(dependencies) {
  const { configService, userService, householdId, rootLogger, schoolTeacherGate, contentPath, scopedGateway } = dependencies;
const schoolDatastore = new YamlSchoolDatastore({ configService });
  const schoolFullConfig = configService.getHouseholdAppConfig(null, 'school') || {};
  const schoolSessionResultArtifacts = new YamlSessionResultArtifactStore({ configService });
  const schoolLearnerDirectory = new ConfiguredSchoolLearningDirectory({
    userService,
    config: schoolFullConfig,
    householdId,
    logger: rootLogger.child({ module: 'school-learners' }),
  });
  // Periods: config→data promotion (teacher-console W3-1). The stored source
  // serves the boot-validated config until the first teacher edit writes
  // school/plans/periods.yml; every downstream consumer (report cards, the
  // /periods route, agendas) inherits the same instance.
  const { YamlAcademicPeriodStore } = await import("../adapters/persistence/YamlAcademicPeriodStore.mjs");
  const schoolAcademicPeriods = new YamlAcademicPeriodStore({
    configService,
    fallback: new ConfiguredAcademicPeriodSource({ config: schoolFullConfig }),
    logger: rootLogger.child({ module: 'school-periods' }),
  });
  // The console write predicate for SchoolService's own teacher writes
  // (quiz-request dismissal). Built through the same factory the lifecycle
  // composition uses — one copy of the accessor text, no drift.
  // Wave-3 planning domains: stores + gated writes (teacher-console W3-1..4).
  const { SetAcademicPeriods } = await import("../application/usecases/SetAcademicPeriods.mjs");
  const { SetPassOverride } = await import("../application/usecases/SetPassOverride.mjs");
  const { YamlMilestoneStore } = await import("../adapters/persistence/YamlMilestoneStore.mjs");
  const { SetMilestones } = await import("../application/usecases/SetMilestones.mjs");
  const { GetMilestoneStatuses } = await import("../application/usecases/GetMilestoneStatuses.mjs");
  const { YamlEnrichmentLog } = await import("../adapters/persistence/YamlEnrichmentLog.mjs");
  const { RecordEnrichment } = await import("../application/usecases/RecordEnrichment.mjs");
  const schoolMilestoneStore = new YamlMilestoneStore({ configService, logger: rootLogger.child({ module: 'school-milestones' }) });
  const schoolEnrichmentLog = new YamlEnrichmentLog({ configService, logger: rootLogger.child({ module: 'school-enrichment' }) });
  // Mid-quiz resumability (Task 17): per-user users/{id}/apps/school/sittings.yml.
  const { YamlSittingStore } = await import("../adapters/persistence/YamlSittingStore.mjs");
  const schoolSittingStore = new YamlSittingStore({ configService, logger: rootLogger.child({ module: 'school-sittings' }) });
  const schoolService = new SchoolService({
    datastore: schoolDatastore,
    userService,
    sittings: schoolSittingStore,
    teacherGate: schoolTeacherGate,
    // Thunk: the notes store is constructed later in this function; dismissal
    // notes resolve it at call time.
    teacherNotesRef: () => dependencies.schoolTeacherNotes,
    learnerDirectory: schoolLearnerDirectory,
    logger: rootLogger.child({ module: 'school' }),
    bankSources: [new GeneratedBankSource({
      dataDir: path.join(contentPath, 'school', 'generated-banks'),
      logger: rootLogger.child({ module: 'school-generated-banks' })
    })]
  });
  const schoolLearningEvidence = new YamlLearningEvidenceRepository({ configService });
  const schoolEvidenceSources = [
    new YamlSchoolAttemptEvidenceSource({ datastore: schoolDatastore }),
    schoolLearningEvidence,
  ];
  const schoolLearningLoop = createSchoolLearningLoop({
    configService,
    householdId,
    aiGateway: scopedGateway(dependencies.sharedAiGateway, { app: 'school' }),
    logger: rootLogger.child({ module: 'school-remediation' }),
    evidenceRepository: schoolLearningEvidence,
    learnerDirectory: schoolLearnerDirectory,
  });
  // One configured-expectations instance shared by every consumer (Task 11):
  // constructed once, validated once, rather than re-parsing school.yml's
  // `progress.expectations` per use case.
  const schoolConfiguredExpectationSource = new ConfiguredLearningExpectationSource({ config: schoolFullConfig });
  // The curriculum accessor (`schoolLifecycle.stores.curriculum`) does not
  // exist yet at this point in composition — `schoolLifecycle` wires up
  // several hundred lines below, and `schoolCalc`'s composition (just below
  // this block) already depends on THIS EXACT `getLearningProgress` instance,
  // so construction can't simply be deferred until after the lifecycle block.
  // This thin forwarding source lets `getLearningProgress` be built now while
  // still picking up the real curriculum-derived outline the moment
  // `schoolLifecycle` finishes wiring: `schoolLifecycle` is a `let` reassigned
  // later in this same function, and a closure over it observes that
  // reassignment by the time an actual request runs `listExpectations`. An
  // unwired lifecycle (or no `stores.curriculum`) makes this emit nothing —
  // GetLearningProgress and curriculumHistory behave exactly as before Task 11.
  const schoolCurriculumExpectationSource = {
    async listExpectations(query) {
      const curriculum = dependencies.schoolLifecycle.stores?.curriculum;
      return curriculum ? new CurriculumExpectationSource({ curriculum }).listExpectations(query) : [];
    },
  };
  const getLearningProgress = new GetLearningProgress({
    evidenceSources: schoolEvidenceSources,
    cohortDirectory: schoolLearnerDirectory,
    academicPeriods: schoolAcademicPeriods,
    followUpSources: [new AssessmentReviewFollowUpSource({
      thresholdPercent: schoolFullConfig.progress?.reviewThresholdPercent ?? 80,
    }), schoolLearningLoop.followUps],
    // Configured pacing dates win a same-target collision over the
    // curriculum-derived outline (Task 11 merge rule) — order matters here.
    expectationSources: [schoolConfiguredExpectationSource, schoolCurriculumExpectationSource],
    logger: rootLogger.child({ module: 'school-progress' }),
  });
  const getInstructionalInsights = new GetInstructionalInsights({
    evidenceSources: schoolEvidenceSources,
    cohortDirectory: schoolLearnerDirectory,
    expectationSource: schoolConfiguredExpectationSource,
    policy: {
      accuracyThresholdPercent: schoolFullConfig.progress?.instructionalInsights?.accuracyThresholdPercent ?? 70,
      minimumResponses: schoolFullConfig.progress?.instructionalInsights?.minimumResponses ?? 2,
    },
    logger: rootLogger.child({ module: 'school-instructional-insights' }),
  });
  const recordLearningReflection = new RecordLearningReflection({
    evidenceRepository: schoolLearningEvidence,
    learnerDirectory: schoolLearnerDirectory,
    evidenceIdFactory: createLearningReflectionEvidenceId,
  });
  return { schoolDatastore, schoolFullConfig, schoolSessionResultArtifacts, schoolLearnerDirectory, schoolAcademicPeriods, schoolMilestoneStore, schoolEnrichmentLog, schoolService, schoolLearningEvidence, schoolLearningLoop, getLearningProgress, getInstructionalInsights, recordLearningReflection };
}
