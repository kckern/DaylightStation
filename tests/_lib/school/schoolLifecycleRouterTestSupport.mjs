import { createSchoolLifecycleRouter } from "../../../__app_modules/school/server/api/schoolLifecycle.mjs";
import { SchoolLifecycleAgendaResource } from "../../../__app_modules/school/server/application/services/SchoolLifecycleAgendaResource.mjs";
import { SchoolLifecycleReadService } from "../../../__app_modules/school/server/application/services/SchoolLifecycleReadService.mjs";
import { SchoolLifecycleSyllabusService } from "../../../__app_modules/school/server/application/services/SchoolLifecycleSyllabusService.mjs";

export function createSchoolLifecycleTestRouter(legacy = {}) {
  const {
    buildAgenda = null, previewAgenda = null, receiptPngRenderer = null, roster = null,
    sessions = null, listLearnerSessions = null, listPrintableWorksheetSessions = null,
    reviewQueue = null, curriculum = null, assignments = null, syllabi = null,
    lifecycleAgendaResource = null, lifecycleReadService = null,
    lifecycleSyllabusService = null, ...options
  } = legacy;
  return createSchoolLifecycleRouter({
    ...options,
    lifecycleAgendaResource: lifecycleAgendaResource ?? new SchoolLifecycleAgendaResource({
      buildAgenda, previewAgenda, pngRenderer: receiptPngRenderer, roster,
    }),
    lifecycleReadService: lifecycleReadService ?? new SchoolLifecycleReadService({
      sessions, listLearnerSessions, listPrintableWorksheetSessions,
      reviewQueue, curriculum, assignments,
    }),
    lifecycleSyllabusService: lifecycleSyllabusService ?? new SchoolLifecycleSyllabusService({ syllabi }),
  });
}

export default createSchoolLifecycleTestRouter;
