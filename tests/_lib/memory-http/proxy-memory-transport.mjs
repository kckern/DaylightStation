/** Fixed proxy-fixture transport: serialized Node responses over paired local
 * Duplex streams. No socket/listener, kernel TCP, or backpressure parity claim.
 */
import { IncomingMessage, ServerResponse } from 'node:http';
import { Duplex, Writable } from 'node:stream';
const servers = new Map();
let nextAddress = 1;
function pair() {
  let left, right;
  const endpoint = peer => new Duplex({ read() {}, write(bytes, _encoding, done) {
    if (!peer().destroyed) peer().push(Buffer.from(bytes));
    done();
  }, destroy(error, done) {
    if (!peer().destroyed) peer().destroy();
    done(error);
  } });
  left = endpoint(() => right); right = endpoint(() => left);
  return { left, right };
}
export function createServer(handler) {
  const connections = new Set();
  let port;
  const server = {
    handler, connections,
    listen(_port, hostOrCallback, callback) {
      port = nextAddress++; servers.set(String(port), server);
      queueMicrotask(typeof hostOrCallback === 'function' ? hostOrCallback : callback);
      return server;
    },
    address() { return { port }; },
    close(callback) {
      servers.delete(String(port));
      for (const stream of connections) stream.destroy();
      queueMicrotask(() => callback?.());
    },
  };
  return server;
}
function responseReader(socket, callback) {
  const response = new IncomingMessage(socket);
  let pending = Buffer.alloc(0), ready = false, chunked = false, remaining = null, ended = false;
  socket.on('data', bytes => {
    pending = Buffer.concat([pending, bytes]);
    if (!ready) {
      const end = pending.indexOf('\r\n\r\n'); if (end < 0) return;
      const lines = pending.subarray(0, end).toString().split('\r\n');
      response.statusCode = Number(lines.shift().split(' ')[1]); response.headers = {};
      for (const line of lines) { const colon = line.indexOf(':'); response.headers[line.slice(0, colon).toLowerCase()] = line.slice(colon + 1).trim(); }
      chunked = /chunked/i.test(response.headers['transfer-encoding'] || '');
      pending = pending.subarray(end + 4); ready = true; callback(response);
    }
    if (!chunked) { if (pending.length) response.push(pending); pending = Buffer.alloc(0); return; }
    while (!ended) {
      if (remaining === null) {
        const end = pending.indexOf('\r\n'); if (end < 0) return;
        remaining = Number.parseInt(pending.subarray(0, end).toString().split(';')[0], 16);
        if (!Number.isFinite(remaining)) throw Error('Invalid fixture chunk');
        pending = pending.subarray(end + 2);
        if (remaining === 0) { ended = true; response.complete = true; response.push(null); return; }
      }
      if (pending.length < remaining + 2) return;
      response.push(pending.subarray(0, remaining)); pending = pending.subarray(remaining + 2); remaining = null;
    }
  });
  return { response, finish() { if (!ended) { ended = true; response.complete = true; response.push(null); } } };
}
export function request(_protocol, options, onResponse) {
  let clientSocket, serverSocket;
  const bodies = [];
  // finish/end alone MUST NOT abort an in-flight upstream response.
  const clientRequest = new Writable({ autoDestroy: false,
    write(bytes, _encoding, done) { bodies.push(Buffer.from(bytes)); done(); },
    final(done) {
      done();
      queueMicrotask(() => {
        if (clientRequest.destroyed) return;
        const server = servers.get(String(options.port));
        if (!server) { clientRequest.emit('error', Object.assign(new Error('fixture endpoint closed'), { code: 'ECONNREFUSED' })); return; }
        ({ left: serverSocket, right: clientSocket } = pair());
        server.connections.add(serverSocket);
        serverSocket.once('close', () => server.connections.delete(serverSocket));
        const reader = responseReader(clientSocket, onResponse);
        const req = new IncomingMessage(serverSocket);
        req.method = options.method || 'GET'; req.url = options.path;
        req.headers = { host: options.hostname || 'fixture.invalid', connection: 'close', ...(options.headers || {}) };
        req.httpVersionMajor = 1; req.httpVersionMinor = 1; req.httpVersion = '1.1';
        if (bodies.length) req.push(Buffer.concat(bodies));
        req.complete = true; req.push(null);
        const res = new ServerResponse(req); res.assignSocket(serverSocket);
        clientSocket.once('end', () => reader.finish());
        res.once('finish', () => clientSocket.push(null));
        server.handler(req, res);
      });
    },
    destroy(error, done) { clientSocket?.destroy(); done(error); },
  });
  return clientRequest;
}
export function get(options, onResponse) {
  const requestOptions = typeof options === 'string' ? (() => { const u = new URL(options); return { hostname: u.hostname, port: u.port, path: u.pathname + u.search }; })() : options;
  const result = request(null, { ...requestOptions, method: 'GET' }, onResponse); result.end(); return result;
}
export default { createServer, get };
