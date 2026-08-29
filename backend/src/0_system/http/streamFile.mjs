/**
 * Range-request aware file streaming helper.
 *
 * Handles the standard HTTP range-request dance (RFC 7233) for
 * audio/video seeking and sends the appropriate 206 / 200 response.
 *
 * @module infrastructure/http/streamFile
 */

import fs from 'node:fs';

const localFilePaths = new WeakMap();

/**
 * Create an opaque local-file resource.
 *
 * The absolute path stays inside the system layer. Adapters may return the
 * resource through an application port, while HTTP adapters retain access to
 * Express' native `sendFile` semantics through `sendLocalFileResource`.
 *
 * @param {string} filePath
 * @param {object} [options]
 * @param {string} [options.mimeType]
 * File existence is deliberately left to the eventual consumer. In particular,
 * Express `sendFile` must retain ownership of its original asynchronous error
 * and callback behavior if a file disappears between resolution and delivery.
 *
 * @returns {{size: number, mimeType: string, open: Function}}
 */
export function createLocalFileResource(filePath, { mimeType = 'application/octet-stream' } = {}) {
  const resource = Object.freeze({
    get size() { return fs.statSync(filePath).size; },
    mimeType,
    open(options) {
      return options === undefined
        ? fs.createReadStream(filePath)
        : fs.createReadStream(filePath, options);
    },
  });
  localFilePaths.set(resource, filePath);
  return resource;
}

/**
 * Send an opaque local-file resource with Express' exact `sendFile` behavior.
 *
 * This deliberately delegates range parsing, conditional requests, ETags,
 * Last-Modified, HEAD handling, and callback errors to Express rather than
 * approximating those wire semantics in application code.
 */
export function sendLocalFileResource(_req, res, resource, callback = undefined) {
  const filePath = localFilePaths.get(resource);
  if (!filePath) throw new TypeError('sendLocalFileResource requires an opaque local-file resource');
  return callback === undefined ? res.sendFile(filePath) : res.sendFile(filePath, callback);
}

/**
 * Stream an opaque media resource to an Express response, honouring Range headers.
 *
 * @param {import('express').Request}  req          - Express request (reads `range` header)
 * @param {import('express').Response} res          - Express response
 * @param {{size: number, mimeType: string, open: Function}} resource
 *   Storage-agnostic resource. `open({ start, end })` returns a readable stream.
 * @param {Object}                     [extraHeaders={}] - Additional headers merged into every response
 */
export function streamMediaResourceWithRanges(req, res, resource, extraHeaders = {}) {
  if (!resource || !Number.isFinite(resource.size) || typeof resource.open !== 'function') {
    throw new TypeError('streamMediaResourceWithRanges requires an opaque media resource');
  }

  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : resource.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      ...extraHeaders,
      'Content-Range': `bytes ${start}-${end}/${resource.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': resource.mimeType,
    });

    resource.open({ start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      ...extraHeaders,
      'Accept-Ranges': 'bytes',
      'Content-Length': resource.size,
      'Content-Type': resource.mimeType,
    });

    resource.open().pipe(res);
  }
}

/**
 * Legacy path-based entry point retained for existing API slices. New code
 * should resolve storage behind an application port and call
 * `streamMediaResourceWithRanges` with an opaque resource instead.
 */
export function streamFileWithRanges(req, res, filePath, contentType, extraHeaders = {}) {
  const stat = fs.statSync(filePath);
  return streamMediaResourceWithRanges(req, res, {
    size: stat.size,
    mimeType: contentType,
    open(options) {
      return options === undefined
        ? fs.createReadStream(filePath)
        : fs.createReadStream(filePath, options);
    },
  }, extraHeaders);
}
