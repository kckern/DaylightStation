// refusedUpload.mjs — prove a route refuses a large upload BEFORE reading it.
//
// supertest uploads the whole body and only then reads the response. A server
// that refuses early answers and closes while the client is still writing, so
// the client may get EPIPE or ECONNRESET first. How often depends on the OS's
// socket buffers (macOS hits it, Linux mostly does not), which made such tests
// pass or fail by platform rather than by behavior.
//
// This helper keeps writing until the response arrives, and records on the
// server side, at the moment the response is sent, whether the request body had
// been read in full or parsed. A broken pipe is accepted only alongside that
// server-side record; the caller asserts the refusal from it.
import express from 'express';
import http from 'node:http';
import { once } from 'node:events';

// Below this a body can arrive whole in the first packets, so `req.complete`
// would read true even for a route that never touched it.
const MIN_SIZE = 8 * 1024 * 1024;

export async function postRefusedUpload(app, { path, headers = {}, size }) {
  if (!Number.isSafeInteger(size) || size < MIN_SIZE) throw new TypeError(`postRefusedUpload needs a body of at least 8 MB to tell an early refusal from a full read (got ${size})`);
  let refusal = null;
  const outer = express();
  outer.use((req, res, next) => {
    const end = res.end;
    res.end = function spyEnd(...args) {
      // readableFlowing stays null until something attaches a reader or resumes the stream.
      if (!refusal) refusal = { status: res.statusCode, bodyRead: req.readableFlowing !== null, bodyComplete: req.complete, bodyParsed: Buffer.isBuffer(req.body) || (req.body != null && typeof req.body === 'object' && Object.keys(req.body).length > 0) };
      return end.apply(this, args);
    };
    next();
  });
  outer.use(app);
  const server = outer.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const client = await new Promise((resolve, reject) => {
      let status = null; let body = ''; let settled = false;
      const settle = (value) => { if (!settled) { settled = true; resolve(value); } };
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path, headers: { ...headers, 'Content-Length': size } });
      req.on('response', (res) => {
        status = res.statusCode; res.setEncoding('utf8');
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => { settle({ status, body, uploadError: null }); req.destroy(); });
        // The server closing mid-response is the same broken connection as EPIPE on the upload.
        res.on('error', () => settle({ status, body, uploadError: 'ECONNRESET' }));
        res.on('aborted', () => settle({ status, body, uploadError: 'ECONNRESET' }));
      });
      req.on('error', (error) => {
        if (error.code === 'EPIPE' || error.code === 'ECONNRESET') settle({ status, body, uploadError: error.code });
        else if (!settled) { settled = true; reject(error); }
      });
      const chunk = Buffer.alloc(64 * 1024); let sent = 0;
      const pump = () => {
        while (sent < size && status === null && !settled && !req.destroyed) {
          const piece = chunk.subarray(0, Math.min(chunk.length, size - sent)); sent += piece.length;
          if (!req.write(piece)) { req.once('drain', pump); return; }
        }
        if (sent >= size && !req.destroyed) req.end();
      };
      pump();
    });
    // Without a received status, only the server-side record can prove refusal.
    return { ...client, refusal, refusedStatus: client.status ?? (client.uploadError ? refusal?.status ?? null : null) };
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}
