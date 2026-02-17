/**
 * Range-request aware file streaming helper.
 *
 * Handles the standard HTTP range-request dance (RFC 7233) for
 * audio/video seeking and sends the appropriate 206 / 200 response.
 *
 * @module infrastructure/http/streamFile
 */

import fs from 'fs';

/**
 * Stream a local file to an Express response, honouring Range headers.
 *
 * @param {import('express').Request}  req          - Express request (reads `range` header)
 * @param {import('express').Response} res          - Express response
 * @param {string}                     filePath     - Absolute path to the file on disk
 * @param {string}                     contentType  - MIME type for the Content-Type header
 * @param {Object}                     [extraHeaders={}] - Additional headers merged into every response
 */
export function streamFileWithRanges(req, res, filePath, contentType, extraHeaders = {}) {
  const stat = fs.statSync(filePath);
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      ...extraHeaders,
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType,
    });

    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      ...extraHeaders,
      'Accept-Ranges': 'bytes',
      'Content-Length': stat.size,
      'Content-Type': contentType,
    });

    fs.createReadStream(filePath).pipe(res);
  }
}
