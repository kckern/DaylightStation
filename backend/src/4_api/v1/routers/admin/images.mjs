import { sendInternalError } from '#api/utils/internalError.mjs';
/**
 * Admin Images Router
 *
 * Handles image uploads for list item thumbnails.
 *
 * Endpoints:
 * - GET  /list       - List existing uploaded images
 * - POST /upload     - Upload an image file (multipart/form-data)
 * - POST /upload-url - Download an image from a URL and save it
 */
import express from 'express';
import multer from 'multer';

function requestValidationError(message, context = {}) {
  const error = new Error(message);
  error.name = 'ValidationError';
  error.context = context;
  return error;
}

/**
 * Create Admin Images Router
 *
 * @param {Object} config
 * @param {Object} config.imageService - Image catalog and upload operations
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminImagesRouter(config) {
  const { imageService, logger = console } = config;
  if (!imageService) throw new Error('createAdminImagesRouter requires imageService');
  const router = express.Router();
  const maxFileSize = imageService.maxFileSize;
  const allowedMimeTypes = imageService.allowedMimeTypes;

  // Configure multer for memory storage
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: maxFileSize
    },
    fileFilter: (req, file, cb) => {
      if (imageService.isAllowedMimeType(file.mimetype)) {
        cb(null, true);
      } else {
        cb(requestValidationError('Invalid file type', {
          field: 'image',
          allowed: allowedMimeTypes,
          received: file.mimetype
        }));
      }
    }
  });

  /**
   * GET /list
   * List existing uploaded images.
   *
   * Response: { images: [{ filename, path, size, modified }] }
   */
  router.get('/list', (req, res) => {
    try {
      res.json({ images: imageService.list() });
    } catch (error) {
      logger.error?.('admin.images.list.failed', { error: error.message });
      sendInternalError(res, { error: 'Failed to list images' });
    }
  });

  /**
   * POST /upload
   * Upload an image file for list items
   *
   * Request: multipart/form-data with 'image' field
   * Response: { ok: true, path: '/media/img/lists/{uuid}.ext', size, type }
   */
  router.post('/upload', upload.single('image'), (req, res) => {
    try {
      if (!req.file) {
        throw requestValidationError('No image file provided', { field: 'image' });
      }

      res.json({ ok: true, ...imageService.upload({
        buffer: req.file.buffer,
        mimeType: req.file.mimetype,
        size: req.file.size,
      }) });
    } catch (error) {
      logger.error?.('admin.images.upload.failed', { error: error.message });

      if (error?.name === 'ValidationError') {
        return res.status(400).json({
          error: error.message,
          context: error.context
        });
      }

      sendInternalError(res, { error: 'Failed to upload image' });
    }
  });

  /**
   * POST /upload-url
   * Download an image from a URL and save it
   *
   * Request: JSON { url: "https://..." }
   * Response: { ok: true, path: '/media/img/lists/{uuid}.ext', size, type }
   */
  router.post('/upload-url', express.json(), async (req, res) => {
    try {
      const { url } = req.body;
      if (!url) {
        throw requestValidationError('No URL provided', { field: 'url' });
      }

      res.json({ ok: true, ...await imageService.uploadFromUrl(url) });
    } catch (error) {
      logger.error?.('admin.images.upload_url.failed', { error: error.message });

      if (error?.name === 'PayloadTooLargeError') {
        return res.status(413).json({
          error: error.message,
          maxSize: error.limit,
          maxSizeMB: error.limit / 1024 / 1024,
        });
      }
      if (error?.name === 'ValidationError') {
        const context = error.code === 'IMAGE_SOURCE_REJECTED'
          ? { ...error.context, status: error.sourceResponseCode }
          : error.context;
        return res.status(400).json({
          error: error.message,
          context
        });
      }

      sendInternalError(res, { error: 'Failed to upload image from URL' });
    }
  });

  // Multer error handler middleware
  router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        logger.error?.('admin.images.upload.size_exceeded', {
          limit: maxFileSize
        });
        return res.status(413).json({
          error: 'File too large',
          maxSize: maxFileSize,
          maxSizeMB: maxFileSize / 1024 / 1024
        });
      }
      logger.error?.('admin.images.upload.multer_error', {
        code: error.code,
        message: error.message
      });
      return res.status(400).json({ error: error.message });
    }

    if (error?.name === 'ValidationError') {
      return res.status(400).json({
        error: error.message,
        context: error.context
      });
    }

    next(error);
  });

  return router;
}

export default createAdminImagesRouter;
