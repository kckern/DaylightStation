/** Test-only playback client port over the existing serialized memory wire.
 * Exercises configured request deadlines and adapter error mapping, never TCP.
 */
import { wireRequest } from './http-wire.mjs';
let nextAddress = 1;
export async function listenWith(handler) {
  let closed = false;
  const responses = new Set();
  const app = { handle(req, res) {
    responses.add(res);
    res.once('finish', () => responses.delete(res));
    res.once('close', () => responses.delete(res));
    handler(req, res);
  } };
  const httpClient = { async requestRaw(method, url, options = {}) {
    if (closed) throw Object.assign(new Error('fixture transport closed'), { code: 'ECONNREFUSED' });
    const request = wireRequest(app, method, new URL(url).pathname + new URL(url).search, {
      headers: options.headers,
      ...(method === 'GET' ? {} : { body: options.body }),
    });
    let timer;
    try {
      const response = await Promise.race([request, new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          for (const response of responses) response.destroy();
          reject(Object.assign(new Error('fixture request deadline expired'), { code: 'TIMEOUT' }));
        }, options.timeout);
      })]);
      return { status: response.status, data: response.body, headers: response.headers };
    } finally { clearTimeout(timer); }
  } };
  const port = nextAddress++;
  const server = { httpClient, close(callback) {
    closed = true;
    for (const response of responses) response.destroy();
    callback?.();
  } };
  return { server, port, httpClient };
}
