import path from 'node:path';
import { createReadStream, getFileStats } from '#system/utils/FileIO.mjs';

const CONTENT_TYPES = {
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.data': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gb': 'application/octet-stream',
  '.gbc': 'application/octet-stream',
  '.srm': 'application/octet-stream',
  '.state': 'application/octet-stream',
};

export function contentTypeFor(filePath) {
  return CONTENT_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}

export function missing(message = 'not found') {
  const error = new Error(message);
  error.code = 'ENOENT';
  return error;
}

export function assertSafeSegment(value, { dot = false } = {}) {
  if (typeof value !== 'string' || value === '' || value.includes('..')) {
    throw new Error('unsafe path segment');
  }
  const pattern = dot ? /^[a-z0-9_.-]+$/i : /^[a-z0-9_-]+$/i;
  if (!pattern.test(value)) throw new Error('unsafe path segment');
  return value;
}

export function containedPath(rootDir, relativePath) {
  const root = path.resolve(rootDir);
  const candidate = path.resolve(root, relativePath);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) throw missing();
  return candidate;
}

export function fileResource(filePath, { mimeType = contentTypeFor(filePath) } = {}) {
  const stat = getFileStats(filePath);
  return Object.freeze({
    size: stat.size,
    mimeType,
    open(range) {
      return range === undefined ? createReadStream(filePath) : createReadStream(filePath, range);
    },
  });
}
