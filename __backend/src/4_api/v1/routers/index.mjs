// Core API routers
export { createApiRouter } from './api.mjs';
export { createConfigRouter } from './config.mjs';
export { createStaticRouter } from './static.mjs';
export { createArtRouter } from "../../../../../__app_modules/art/server/api/art.mjs";

// Domain routers - Agents & AI
export { createAIRouter } from './ai.mjs';

// Domain routers - Bots

// Domain routers - Content & Media
export { createContentRouter } from "../../../../../__capabilities/content-catalog/server/api/content.mjs";
export { createDisplayRouter } from "../../../../../__capabilities/content-catalog/server/api/display.mjs";
export { createInfoRouter } from "../../../../../__capabilities/content-catalog/server/api/info.mjs";
export { createQueueRouter } from "../../../../../__capabilities/playback/server/api/queue.mjs";
export { createSiblingsRouter } from "../../../../../__capabilities/content-catalog/server/api/siblings.mjs";
export { createLocalContentRouter } from "../../../../../__capabilities/content-catalog/server/api/localContent.mjs";
export { createPlayRouter } from "../../../../../__capabilities/playback/server/api/play.mjs";
export { createStreamRouter } from "../../../../../__app_modules/media/server/api/stream.mjs";

// Domain routers - Feed
export { createFeedRouter } from "../../../../../__app_modules/feed/server/api/feed.mjs";

// Domain routers - Finance
export { createFinanceRouter } from "../../../../../__app_modules/finance/server/api/finance.mjs";

// Domain routers - Fitness & Health
export { createFitnessRouter } from "../../../../../__app_modules/fitness/server/api-fitness.mjs";

// Domain routers - Home & Automation
export { createHomeAutomationRouter } from "../../../../../__app_modules/home/server/api/homeAutomation.mjs";
export { createHomeDashboardRouter } from "../../../../../__app_modules/home/server/api/home-dashboard.mjs";
export { createDeviceRouter } from './device.mjs';
export { createTriggerRouter } from "../../../../../__capabilities/device-dispatch/server/api/trigger.mjs";
export { createPrinterRouter } from './printer.mjs';
export { createPressureMatRouter } from './pressureMat.mjs';

// Domain routers - Journaling & Tracking
export { createLifelogRouter } from "../../../../../__capabilities/lifelog/server/api/lifelog.mjs";

// Domain routers - Productivity
export { createCalendarRouter } from "../../../../../__app_modules/calendar/server/api/calendar.mjs";
export { createHarvestRouter } from './harvest.mjs';
export { createItemRouter } from './item.mjs';
export { createListRouter, toListItem } from "../../../../../__capabilities/content-catalog/server/api/list.mjs";
export { createMessagingRouter } from './messaging.mjs';
export { createSchedulingRouter } from './scheduling.mjs';

// Domain routers - Utilities
export { createEntropyRouter } from './entropy.mjs';
export { createExternalProxyRouter } from './externalProxy.mjs';
export { createProxyRouter } from './proxy.mjs';
export { createScreensRouter } from './screens.mjs';
export { createTTSRouter } from './tts.mjs';

// Admin routers
export { createAdminRouter, createAdminContentRouter, createAdminImagesRouter } from './admin/index.mjs';
export { createStateGatesRouter, createEntitlementsRouter } from "../../../../../__capabilities/state-gates/server/api/state-gates.mjs";
export { createEventBusRouter } from './admin/eventbus.mjs';

// Test infrastructure (dev/test only)
export { createTestRouter } from './test.mjs';
