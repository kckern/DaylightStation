/** Existing school assessment ingress assembly; preserves construction order. */
import path from "path";
import { createQuizScanRecorder as createQuizScanRecorder } from "../application/quizzes/quizScanRecorder.mjs";
import { YamlDecodedQuizScanStore as YamlDecodedQuizScanStore } from "../adapters/persistence/YamlDecodedQuizScanStore.mjs";

export async function registerSchoolAssessmentIngress(dependencies) {
  const { omrReadersConfig, dataDir, configService, householdId, EventBusEventInputSource, eventBus, relayHistoryRoot, rootLogger } = dependencies;
const decodedQuizRoot = omrReadersConfig?.quizzes?.dir
    ? path.join(dataDir, ...String(omrReadersConfig.quizzes.dir).replace(/^\/+/, '').split('/'))
    : configService.getHouseholdPath('school/records/assessments/omr', householdId);
  createQuizScanRecorder({
    scanSource: new EventBusEventInputSource({ eventBus, topics: ['omr'] }),
    decodedScanStore: new YamlDecodedQuizScanStore({
      decodedRoot: decodedQuizRoot,
      rawHistoryRoot: relayHistoryRoot(omrReadersConfig, 'hardware/omr/log'),
    }),
    logger: rootLogger.child({ module: 'quiz-scan' }),
  });
  return {  };
}
