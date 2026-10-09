/** Fixed selections; baseline paths, candidate uses reviewed move map. Never root test setup. */
export const botsDisplaysVitest = [
  "tests/isolated/flow/homebot/AssignItemToUser.test.mjs",
  "tests/isolated/flow/homebot/ProcessGratitudeInput.test.mjs",
  "tests/isolated/flow/homebot/CancelGratitudeInput.test.mjs",
  "tests/isolated/flow/homebot/ToggleCategory.test.mjs",
  "tests/isolated/flow/homebot/HomeBotEventRouter.test.mjs",
  "tests/isolated/flow/journalist/JournalistContainer.test.mjs",
  "tests/isolated/flow/journalist/JournalistInputRouter.aiAvailability.test.mjs",
  "tests/isolated/flow/journalist/usecases/ProcessTextEntry.test.mjs",
  "tests/isolated/flow/journalist/usecases/GenerateMorningDebrief.test.mjs",
  "tests/isolated/flow/journalist/usecases/quiz.test.mjs",
  "tests/isolated/flow/journalist/DebriefRepository.test.mjs",
  "tests/isolated/domain/journaling/entities/JournalEntry.test.mjs",
  "tests/isolated/domain/journaling/services/JournalService.test.mjs",
  "backend/src/3_applications/homeline/CallLeaseService.test.mjs",
  "backend/src/3_applications/homeline/CallStateService.test.mjs",
  "frontend/src/Apps/CallApp.test.jsx",
  "frontend/src/Apps/call/callMachine.test.js",
  "frontend/src/Apps/call/useCallController.test.jsx",
  "frontend/src/modules/Input/hooks/useCallSignaling.test.jsx",
  "tests/isolated/application/devices/WakeAndLoadService.homeline-cancel.test.mjs",
  "tests/isolated/assembly/infrastructure/eventbus/WebSocketEventBus.homeline.test.mjs",
  "backend/src/3_applications/ambient/AmbientSchedulerService.test.mjs",
  "backend/src/1_adapters/ambient/YamlAmbientStateStore.test.mjs",
  "tests/unit/application/eink/stateSnapshot.test.mjs",
  "tests/unit/application/eink/telemetry.test.mjs",
  "tests/unit/application/eink/wakeSchedule.test.mjs",
  "tests/unit/rendering/eink/stub-widgets.test.mjs",
  "backend/src/3_applications/newsreporter/sinks/PrinterSink.printOutcome.test.mjs"
];
export const botsDisplaysNode = [
  "backend/src/3_applications/journalist/usecases/DeliverScheduledMorningDebrief.test.mjs",
  "backend/src/3_applications/eink/EinkPanelService.test.mjs"
];
export const botsDisplaysJest = [
  "tests/unit/suite/applications/newsreporter/NewsReporterService.test.mjs",
  "tests/unit/suite/applications/newsreporter/NewsReporterJobExecutor.test.mjs",
  "tests/unit/suite/applications/newsreporter/PrinterSink.test.mjs",
  "tests/unit/suite/applications/newsreporter/reportSchema.test.mjs",
  "tests/unit/suite/adapters/newsreporter/YamlReportRunDatastore.test.mjs",
  "tests/unit/suite/rendering/newsreporter/ReportReceiptRenderer.test.mjs",
  "tests/unit/suite/applications/scheduling/SchedulerOrchestrator.newsreporter.test.mjs",
  "tests/unit/suite/cli/newsreporter.cli.test.mjs"
];
