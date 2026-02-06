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
import path from 'path';
import { v7 as uuidv7 } from 'uuid';
import { ensureDir, writeBinary, listFiles, getStats } from '#system/utils/FileIO.mjs';
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

  // Allowed file extensions for browsing
  const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);

  /**
   * GET /list
   * List existing uploaded images in {mediaPath}/img/lists/
   *
   * Response: { images: [{ filename, path, size, modified }] }
   */
  router.get('/list', (req, res) => {
    try {
      const targetDir = path.join(mediaPath, 'img', 'lists');
      let files;
      try {
        files = listFiles(targetDir);
      } catch {
        // Directory doesn't exist yet
        return res.json({ images: [] });
      }

      const images = files
        .filter(f => {
          const ext = path.extname(f).slice(1).toLowerCase();
          return ALLOWED_EXTENSIONS.has(ext);
        })
        .map(f => {
          const filePath = path.join(targetDir, f);
          const stats = getStats(filePath);
          return {
            filename: f,
            path: `/media/img/lists/${f}`,
            size: stats.size,
            modified: stats.mtime.toISOString()
          };
        })
        .sort((a, b) => new Date(b.modified) - new Date(a.modified));

      res.json({ images });
    } catch (error) {
      logger.error?.('admin.images.list.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to list images' });
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
        throw new ValidationError('No URL provided', { field: 'url' });
      }

      const response = await fetch(url);
      if (!response.ok) {
        throw new ValidationError('Failed to fetch URL', { url, status: response.status });
      }

      const contentType = response.headers.get('content-type')?.split(';')[0];
      if (!ALLOWED_MIME_TYPES.includes(contentType)) {
        throw new ValidationError('URL does not point to an allowed image type', {
          allowed: ALLOWED_MIME_TYPES,
          received: contentType
        });
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.length > MAX_FILE_SIZE) {
        return res.status(413).json({
          error: 'Image too large',
          maxSize: MAX_FILE_SIZE,
          maxSizeMB: MAX_FILE_SIZE / 1024 / 1024
        });
      }

      const ext = EXTENSION_MAP[contentType];
      const uuid = uuidv7();
      const filename = `${uuid}.${ext}`;
      const targetDir = path.join(mediaPath, 'img', 'lists');
      const targetPath = path.join(targetDir, filename);

      ensureDir(targetDir);
      writeBinary(targetPath, buffer);

      const publicPath = `/media/img/lists/${filename}`;

      logger.info?.('admin.images.uploaded_url', {
        filename,
        size: buffer.length,
        type: contentType,
        path: publicPath,
        sourceUrl: url
      });

      res.json({
        ok: true,
        path: publicPath,
        size: buffer.length,
        type: contentType
      });
    } catch (error) {
      logger.error?.('admin.images.upload_url.failed', { error: error.message });

      if (error.httpStatus) {
        return res.status(error.httpStatus).json({
          error: error.message,
          context: error.context
        });
      }

      res.status(500).json({ error: 'Failed to upload image from URL' });
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
