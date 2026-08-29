import { ValidationError, EntityNotFoundError, DomainInvariantError } from '#domains/core/errors/index.mjs';
import { slugify } from '#domains/school/documents/receipts.mjs';
import { SchoolResourceService } from '#apps/school/services/SchoolResourceService.mjs';
import { SchoolPrintAccessService } from '#apps/school/services/SchoolPrintAccessService.mjs';
import { SchoolRecordsQueryService } from '#apps/school/services/SchoolRecordsQueryService.mjs';
import { SchoolReportDocumentService } from '#apps/school/services/SchoolReportDocumentService.mjs';
import { SchoolCurriculumQueryService } from '#apps/school/services/SchoolCurriculumQueryService.mjs';
import { SchoolArtifactService } from '#apps/school/services/SchoolArtifactService.mjs';
import { SchoolApiSessionService } from '#apps/school/services/SchoolApiSessionService.mjs';
import { createSchoolRouter } from '#api/v1/routers/school.mjs';

/** Test composition mirroring the production School API service boundaries. */
export function schoolRouterTestOptions(legacy = {}) {
  const {
    flashcardAssets = null, materialProgressStore = null, learningCatalog = null,
    learnerDirectory = null, surfaceRegistry = null, getScreenConfig = null,
    renderPrintDocument = null, printDocumentsRepo = null,
    printAllocationStore = null, getPrintTeacherPin = null,
    attemptsStore = null, attestationLog = null, teacherNotesStore = null,
    enrichmentLog = null, academicPeriods = null, passOverrideStore = null,
    reviewQueue = null, academicPeriodStore = null, milestoneStore = null,
    assignmentsStore = null, reassignmentLog = null,
    reportCardsStore = null, renderReportCardPdf = null,
    renderProgressReportPdf = null, renderCertificatePdf = null,
    renderTranscriptPdf = null, renderSyllabusPdf = null,
    getHouseholdOffsetMinutes = null, curriculumForSyllabus = null,
    issuedArtifactStore = null, renderWorksheetThumbnail = null,
    renderArtifactPostview = null, reprintIssuedArtifact = null,
    reprintResultReceiptArtifact = null,
    schoolResourceService = null, schoolPrintAccess = null,
    schoolRecordsQuery = null, schoolReportDocuments = null,
    schoolCurriculumQuery = null, schoolArtifactService = null, schoolApiSessions = null,
    ...options
  } = legacy;

  const curriculumQuery = schoolCurriculumQuery ?? new SchoolCurriculumQueryService({
    curriculum: curriculumForSyllabus,
    getLearnerTimeline: options.getLearnerTimeline ?? null,
    manageCurriculumException: options.manageCurriculumException ?? null,
  });

  return {
    ...options,
    coreErrors: legacy.coreErrors ?? { ValidationError, EntityNotFoundError, DomainInvariantError },
    slugify: legacy.slugify ?? slugify,
    schoolResourceService: schoolResourceService ?? new SchoolResourceService({
      flashcardAssets, materialProgressStore, learningCatalog, learnerDirectory,
      surfaceRegistry, getScreenConfig,
    }),
    schoolPrintAccess: schoolPrintAccess ?? new SchoolPrintAccessService({
      renderPrintDocument, printDocumentsRepo, printAllocationStore, getPrintTeacherPin,
    }),
    schoolRecordsQuery: schoolRecordsQuery ?? new SchoolRecordsQueryService({
      attemptsStore, attestationLog, teacherNotesStore, enrichmentLog,
      academicPeriods, passOverrideStore, reviewQueue, curriculumQuery,
      schoolService: options.schoolService ?? null, academicPeriodStore,
      milestoneStore, assignmentsStore, reassignmentLog,
    }),
    schoolReportDocuments: schoolReportDocuments ?? new SchoolReportDocumentService({
      reportCardsStore, learnerDirectory, curriculumQuery,
      getReportCard: options.getReportCard ?? null,
      renderReportCardPdf, renderProgressReportPdf, renderCertificatePdf,
      renderTranscriptPdf, renderSyllabusPdf, getHouseholdOffsetMinutes,
    }),
    schoolCurriculumQuery: curriculumQuery,
    schoolArtifactService: schoolArtifactService ?? new SchoolArtifactService({
      issuedArtifactStore, renderWorksheetThumbnail, renderArtifactPostview,
      getTeacherSession: options.getTeacherSession ?? null,
      teacherCapabilitySessions: options.teacherCapabilitySessions ?? null,
      reprintIssuedArtifact, reprintResultReceiptArtifact,
    }),
    schoolApiSessions: schoolApiSessions ?? new SchoolApiSessionService({
      school: options.schoolService,
      flashcards: options.flashcardStudy ?? null,
      openCatalogLearning: options.openCatalogLearningSession ?? null,
    }),
  };
}

export function createSchoolTestRouter(options = {}) {
  return createSchoolRouter(schoolRouterTestOptions(options));
}

export default schoolRouterTestOptions;
