/**
 * Admin Images Router
 *
 * Handles image uploads for list item thumbnails.
 *
 * Endpoints:
 * - POST /upload - Upload an image file (multipart/form-data)
 */
import express from 'express';
import multer from 'multer';
import path from 'path';
import { v7 as uuidv7 } from 'uuid';
import { ensureDir, writeBinary } from '#system/utils/FileIO.mjs';
import { ValidationError } from '#system/utils/errors/index.mjs';

// Allowed MIME types
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

// Max file size: 5MB
const MAX_FILE_SIZE = 5 * 1024 * 1024;

// File extension map
const EXTENSION_MAP = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
};

/**
 * Create Admin Images Router
 *
 * @param {Object} config
 * @param {string} config.mediaPath - Base path for media storage (e.g., '/media')
 * @param {Object} [config.logger] - Logger instance
 * @returns {express.Router}
 */
export function createAdminImagesRouter(config) {
  const { mediaPath, logger = console } = config;
  const router = express.Router();

  // Configure multer for memory storage
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: MAX_FILE_SIZE
    },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new ValidationError('Invalid file type', {
          field: 'image',
          allowed: ALLOWED_MIME_TYPES,
          received: file.mimetype
        }));
      }
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
        throw new ValidationError('No image file provided', { field: 'image' });
      }

      const { buffer, mimetype, size } = req.file;
      const ext = EXTENSION_MAP[mimetype];
      const uuid = uuidv7();
      const filename = `${uuid}.${ext}`;

      // Target directory: {mediaPath}/img/lists/
      const targetDir = path.join(mediaPath, 'img', 'lists');
      const targetPath = path.join(targetDir, filename);

      // Ensure directory exists and write file
      ensureDir(targetDir);
      writeBinary(targetPath, buffer);

      // Public path for frontend
      const publicPath = `/media/img/lists/${filename}`;

      logger.info?.('admin.images.uploaded', {
        filename,
        size,
        type: mimetype,
        path: publicPath
      });

      res.json({
        ok: true,
        path: publicPath,
        size,
        type: mimetype
      });
    } catch (error) {
      logger.error?.('admin.images.upload.failed', { error: error.message });

      if (error.httpStatus) {
        return res.status(error.httpStatus).json({
          error: error.message,
          context: error.context
        });
      }

      res.status(500).json({ error: 'Failed to upload image' });
    }
  });

  // Multer error handler middleware
  router.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
      if (error.code === 'LIMIT_FILE_SIZE') {
        logger.error?.('admin.images.upload.size_exceeded', {
          limit: MAX_FILE_SIZE
        });
        return res.status(413).json({
          error: 'File too large',
          maxSize: MAX_FILE_SIZE,
          maxSizeMB: MAX_FILE_SIZE / 1024 / 1024
        });
      }
      logger.error?.('admin.images.upload.multer_error', {
        code: error.code,
        message: error.message
      });
      return res.status(400).json({ error: error.message });
    }

    if (error && error.httpStatus) {
      return res.status(error.httpStatus).json({
        error: error.message,
        context: error.context
      });
    }

    next(error);
  });

  return router;
}

export default createAdminImagesRouter;
