import express from 'express';
import { createAdminContentRouter } from './content.mjs';
import { createAdminImagesRouter } from './images.mjs';
import { createEventBusRouter } from './eventbus.mjs';

/**
 * Combined Admin Router
 *
 * Mounts all admin sub-routers:
 *   /content/* - List/folder management
 *   /images/*  - Image uploads
 *   /ws/*      - EventBus/WebSocket management
 *
 * @param {Object} config
 * @param {Object} config.userDataService - UserDataService for household paths
 * @param {Object} config.configService - ConfigService for default household
 * @param {string} config.mediaPath - Base path for media storage
 * @param {Object} [config.eventBus] - WebSocketEventBus instance (optional)
 * @param {Object} [config.logger=console] - Logger instance
 * @returns {express.Router}
 */
export function createAdminRouter(config) {
  const { userDataService, configService, mediaPath, eventBus, logger = console } = config;
  const router = express.Router();

  // Mount content router
  const contentRouter = createAdminContentRouter({
    userDataService,
    configService,
    logger: logger.child?.({ submodule: 'content' }) || logger
  });
  router.use('/content', contentRouter);

  // Mount images router
  const imagesRouter = createAdminImagesRouter({
    mediaPath,
    logger: logger.child?.({ submodule: 'images' }) || logger
  });
  router.use('/images', imagesRouter);

  // Mount eventbus router (existing)
  if (eventBus) {
    const eventBusRouter = createEventBusRouter({
      eventBus,
      logger: logger.child?.({ submodule: 'eventbus' }) || logger
    });
    router.use('/ws', eventBusRouter);
  }

  logger.info?.('admin.router.mounted', { subroutes: ['/content', '/images', '/ws'] });
  return router;
}

export { createAdminContentRouter } from './content.mjs';
export { createAdminImagesRouter } from './images.mjs';
export { createEventBusRouter } from './eventbus.mjs';
