/** Existing school lesson hook runtime assembly; preserves construction order. */
import { studentDisplayName as studentDisplayName } from "./studentNames.mjs";

export async function createSchoolLessonHookRuntime(dependencies) {
  const { configService, homeAutomationAdapters, rootLogger, schoolLifecycleLogger } = dependencies;
const learnerDisplayName = studentDisplayName(configService);
  let pianoLessonHook = null;
  if (homeAutomationAdapters.haGateway) {
    try {
      const { SchoolGradingHookAdapter } = await import("../adapters/SchoolGradingHookAdapter.mjs");
      pianoLessonHook = new SchoolGradingHookAdapter({
        gateway: homeAutomationAdapters.haGateway,
        configKey: 'piano_lesson_hook',
        loadSchoolConfig: () => configService.getHouseholdAppConfig(null, 'school') || {},
        resolveStudent: learnerDisplayName,
        logger: rootLogger.child({ module: 'school-piano-lesson-hook' }),
      });
    } catch (err) {
      pianoLessonHook = null;
      schoolLifecycleLogger.warn('school.piano_lesson_hook.wiring-failed', { error: err.message });
    }
  }
  return { learnerDisplayName, pianoLessonHook };
}
