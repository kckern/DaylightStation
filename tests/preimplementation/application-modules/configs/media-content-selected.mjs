/** Fixed existing oracles; preserve runner ownership. No listeners or live data in selected fixtures. */
export const mediaContentVitest = [
  "backend/src/3_applications/media/MediaSuggestionsService.test.mjs",
  "backend/src/3_applications/media/HouseholdMediaMemoryService.test.mjs",
  "backend/src/3_applications/media/MediaQueueCommandService.test.mjs",
  "backend/src/3_applications/media/RoutineHistoryService.test.mjs",
  "backend/src/3_applications/media/ScreenPlaybackService.test.mjs",
  "backend/src/3_applications/content/ContentAccessService.test.mjs",
  "backend/src/3_applications/content/ItemService.test.mjs",
  "backend/src/3_applications/catalog/GenerateCatalog.test.mjs",
  "frontend/src/modules/Content/combobox/comboboxMachine.test.js",
  "frontend/src/modules/Content/combobox/ContentCombobox.test.jsx",
  "frontend/src/modules/Media/browse/HomeView.test.jsx",
  "backend/src/3_applications/content/services/PlaybackReadService.test.mjs",
  "backend/src/3_applications/content/services/PlayResponseService.surround.test.mjs"
];
export const mediaContentNode = [
  "backend/tests/unit/applications/content/ContentQueryService.test.mjs"
];
export const mediaContentJest = [
  "tests/unit/content/ContentQueryService.searchStream.test.mjs"
];
