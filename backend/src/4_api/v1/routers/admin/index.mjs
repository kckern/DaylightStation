import express from 'express';
import { HouseholdAdminService } from '#apps/admin/HouseholdAdminService.mjs';
import { YamlConfigFileService } from '#apps/admin/YamlConfigFileService.mjs';
import { createAdminContentRouter } from './content.mjs';
import { createAdminConfigRouter } from './config.mjs';
import { createAdminImagesRouter } from './images.mjs';
import { createEventBusRouter } from './eventbus.mjs';
import { createAdminMediaRouter } from './media.mjs';
import { createAdminSchedulerRouter } from './scheduler.mjs';
import { createAdminHouseholdRouter } from './household.mjs';
import { createAdminIntegrationsRouter } from './integrations.mjs';
import { createAdminAppsRouter } from './apps.mjs';
import { createAdminArtRouter } from './art.mjs';

/**
 * Combined Admin Router
 *
 * Mounts all admin sub-routers:
 *   /content/*   - List/folder management
 *   /config/*    - Generic YAML config file CRUD
 *   /scheduler/* - Cron job management
 *   /household/* - Household config, members, and devices
 *   /integrations/* - Integration status and health checks
 *   /images/*    - Image uploads
 *   /media/*     - Media operations (freshvideo metadata)
 *   /ws/*        - EventBus/WebSocket management
 *
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for household paths
 * @param {Object} config.configService - ConfigService for default household
 * @param {string} config.mediaPath - Base path for media storage
 * @param {Function} [config.loadFile] - Function to load config files
 * @param {Object} [config.mediaDownloadService] - MediaDownloadService instance (optional)
 * @param {Object} [config.eventBus] - WebSocketEventBus instance (optional)
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminRouter(config) {
  const { userDataService, configService, mediaPath, loadFile, mediaDownloadService, eventBus, logger = console } = config;
  const router = express.Router();

  // Mount content router
  const contentRouter = createAdminContentRouter({
    userDataService,
    configService,
    logger: logger.child?.({ submodule: 'content' }) || logger
  });
  router.use('/content', contentRouter);

  // Mount config router (security policy + I/O live in YamlConfigFileService)
  const configLogger = logger.child?.({ submodule: 'config' }) || logger;
  const yamlConfigFileService = new YamlConfigFileService({
    configService,
    logger: configLogger
  });
  const configRouter = createAdminConfigRouter({
    yamlConfigFileService,
    configService,
    logger: configLogger
  });
  router.use('/config', configRouter);

  // Mount scheduler router
  const schedulerRouter = createAdminSchedulerRouter({
    configService,
    logger: logger.child?.({ submodule: 'scheduler' }) || logger
  });
  router.use('/scheduler', schedulerRouter);

  // Mount household router (persistence + rules live in HouseholdAdminService)
  const householdLogger = logger.child?.({ submodule: 'household' }) || logger;
  const householdAdminService = new HouseholdAdminService({
    configService,
    logger: householdLogger
  });
  const householdRouter = createAdminHouseholdRouter({
    householdAdminService,
    configService,
    logger: householdLogger
  });
  router.use('/household', householdRouter);

  // Mount integrations router
  const integrationsRouter = createAdminIntegrationsRouter({
    configService,
    logger: logger.child?.({ submodule: 'integrations' }) || logger
  });
  router.use('/integrations', integrationsRouter);

  // Mount apps config router
  const appsRouter = createAdminAppsRouter({
    configService,
    logger: logger.child?.({ submodule: 'apps' }) || logger
  });
  router.use('/apps', appsRouter);

  // Mount art router (ArtMode library curation). householdDir lets the collection-aware
  // tag filter read collection defs from <householdDir>/config/art.yml.
  const artRouter = createAdminArtRouter({
    mediaPath,
    householdDir: configService?.getHouseholdPath?.(''),
    logger: logger.child?.({ submodule: 'art' }) || logger
  });
  router.use('/art', artRouter);

  // Mount images router
  const imagesRouter = createAdminImagesRouter({
    mediaPath,
    logger: logger.child?.({ submodule: 'images' }) || logger
  });
  router.use('/images', imagesRouter);

  // Mount media router (freshvideo metadata, etc.)
  if (mediaDownloadService && loadFile) {
    const mediaRouter = createAdminMediaRouter({
      mediaDownloadService,
      loadFile,
      logger: logger.child?.({ submodule: 'media' }) || logger
    });
    router.use('/media', mediaRouter);
  }

  // Mount eventbus router (existing)
  if (eventBus) {
    const eventBusRouter = createEventBusRouter({
      eventBus,
      logger: logger.child?.({ submodule: 'eventbus' }) || logger
    });
    router.use('/ws', eventBusRouter);
  }

  logger.info?.('admin.router.mounted', { subroutes: ['/content', '/config', '/scheduler', '/household', '/integrations', '/apps', '/art', '/images', '/media', '/ws'] });
  return router;
}

export { createAdminContentRouter } from './content.mjs';
export { createAdminConfigRouter } from './config.mjs';
export { createAdminImagesRouter } from './images.mjs';
export { createAdminMediaRouter } from './media.mjs';
export { createEventBusRouter } from './eventbus.mjs';
export { createAdminSchedulerRouter } from './scheduler.mjs';
export { createAdminHouseholdRouter } from './household.mjs';
export { createAdminIntegrationsRouter } from './integrations.mjs';
export { createAdminAppsRouter } from './apps.mjs';
export { createAdminArtRouter } from './art.mjs';
