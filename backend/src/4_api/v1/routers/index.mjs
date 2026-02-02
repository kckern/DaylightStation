// Core API routers
export { createApiRouter } from './api.mjs';
export { createHealthRouter } from './health.mjs';
export { createStaticRouter } from './static.mjs';

// Domain routers - Agents & AI
export { createAgentsRouter } from './agents.mjs';
export { createAIRouter } from './ai.mjs';

// Domain routers - Bots
export { createHomebotRouter } from './homebot.mjs';
export { createJournalistRouter } from './journalist.mjs';
export { createNutribotRouter } from './nutribot.mjs';

// Domain routers - Content & Media
export { createContentRouter } from './content.mjs';
export { createLocalContentRouter } from './localContent.mjs';
export { createPlayRouter } from './play.mjs';

// Domain routers - Finance
export { createFinanceRouter } from './finance.mjs';

// Domain routers - Fitness & Health
export { createFitnessRouter } from './fitness.mjs';
export { createNutritionRouter } from './nutrition.mjs';

// Domain routers - Home & Automation
export { createHomeAutomationRouter } from './homeAutomation.mjs';
export { createDeviceRouter } from './device.mjs';
export { createPrinterRouter } from './printer.mjs';

// Domain routers - Journaling & Tracking
export { createGratitudeRouter } from './gratitude.mjs';
export { createJournalingRouter } from './journaling.mjs';
export { createLifelogRouter } from './lifelog.mjs';

// Domain routers - Productivity
export { createCalendarRouter } from './calendar.mjs';
export { createHarvestRouter } from './harvest.mjs';
export { createItemRouter } from './item.mjs';
export { createListRouter, toListItem } from './list.mjs';
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
export { createEventBusRouter } from './admin/eventbus.mjs';
