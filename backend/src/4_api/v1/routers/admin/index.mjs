import express from 'express';
import { createAdminContentRouter } from './content.mjs';
import { createAdminConfigRouter } from './config.mjs';
import { createAdminImagesRouter } from './images.mjs';
import { createEventBusRouter } from './eventbus.mjs';
import { createAdminMediaRouter } from './media.mjs';
import { createAdminSchedulerRouter } from './scheduler.mjs';

/**
 * Combined Admin Router
 *
 * Mounts all admin sub-routers:
 *   /content/* - List/folder management
 *   /config/*  - Generic YAML config file CRUD
 *   /images/*  - Image uploads
 *   /media/*   - Media operations (freshvideo metadata)
 *   /ws/*      - EventBus/WebSocket management
 *
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for household paths
 * @param {Object} config.configService - ConfigService for default household
 * @param {string} config.mediaPath - Base path for media storage
 * @param {Function} [config.loadFile] - Function to load config files
 * @param {Object} [config.eventBus] - WebSocketEventBus instance (optional)
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminRouter(config) {
  const { userDataService, configService, mediaPath, loadFile, eventBus, logger = console } = config;
  const router = express.Router();

  // Mount content router
  const contentRouter = createAdminContentRouter({
    userDataService,
    configService,
    logger: logger.child?.({ submodule: 'content' }) || logger
  });
  router.use('/content', contentRouter);

  // Mount config router
  const configRouter = createAdminConfigRouter({
    configService,
    logger: logger.child?.({ submodule: 'config' }) || logger
  });
  router.use('/config', configRouter);

  // Mount scheduler router
  const schedulerRouter = createAdminSchedulerRouter({
    configService,
    logger: logger.child?.({ submodule: 'scheduler' }) || logger
  });
  router.use('/scheduler', schedulerRouter);

  // Mount images router
  const imagesRouter = createAdminImagesRouter({
    mediaPath,
    logger: logger.child?.({ submodule: 'images' }) || logger
  });
  router.use('/images', imagesRouter);

  // Mount media router (freshvideo metadata, etc.)
  if (loadFile) {
    const mediaRouter = createAdminMediaRouter({
      mediaPath,
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

  logger.info?.('admin.router.mounted', { subroutes: ['/content', '/config', '/scheduler', '/images', '/media', '/ws'] });
  return router;
}

export { createAdminContentRouter } from './content.mjs';
export { createAdminConfigRouter } from './config.mjs';
export { createAdminImagesRouter } from './images.mjs';
export { createAdminMediaRouter } from './media.mjs';
export { createEventBusRouter } from './eventbus.mjs';
export { createAdminSchedulerRouter } from './scheduler.mjs';
