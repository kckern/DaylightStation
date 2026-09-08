/** Real Express/Node serialization over memory; never listen or open a socket. */
import {IncomingMessage, ServerResponse} from 'node:http';
import {Duplex} from 'node:stream';

function decodeChunks(wire) {
  const parts = [];
  let offset = 0;
  while (offset < wire.length) {
    const end = wire.indexOf('\r\n', offset);
    if (end < 0) throw new Error('Incomplete HTTP chunk header');
    const size = Number.parseInt(wire.subarray(offset, end).toString().split(';')[0], 16);
    if (!Number.isFinite(size)) throw new Error('Invalid HTTP chunk size');
    if (!size) return Buffer.concat(parts);
    offset = end + 2;
    if (offset + size + 2 > wire.length) throw new Error('Incomplete HTTP chunk');
    parts.push(wire.subarray(offset, offset + size));
    offset += size + 2;
  }
  throw new Error('Missing final HTTP chunk');
}

export async function wireRequest(app, method, url, {body, headers = {}} = {}) {
  const chunks = [];
  const stream = new Duplex({read() {}, write(chunk, _encoding, callback) {
    chunks.push(Buffer.from(chunk)); callback();
  }});
  const req = new IncomingMessage(stream);
  req.method = method;
  req.url = url;
  req.headers = {host: 'audit.invalid', connection: 'close', ...headers};
  req.httpVersionMajor = 1; req.httpVersionMinor = 1; req.httpVersion = '1.1';
  if (body !== undefined) {
    const encoded = Buffer.from(JSON.stringify(body));
    req.headers['content-type'] = 'application/json';
    req.headers['content-length'] = String(encoded.length);
    req.push(encoded);
  }
  // A real HTTP parser marks the complete message before ending its body stream.
  // Without this, IncomingMessage treats body completion as an aborted socket.
  req.complete = true;
  req.push(null);
  const res = new ServerResponse(req);
  res.assignSocket(stream);
  return new Promise((resolve, reject) => {
    const fail = error => { stream.destroy(); reject(error); };
    res.once('error', fail);
    res.once('finish', () => {
      try {
        const wire = Buffer.concat(chunks);
        const separator = wire.indexOf('\r\n\r\n');
        if (separator < 0) throw new Error('Missing HTTP header delimiter');
        const rawBody = wire.subarray(separator + 4);
        const chunked = /transfer-encoding:\s*chunked/i.test(wire.subarray(0, separator).toString());
        const text = (chunked && method !== 'HEAD' ? decodeChunks(rawBody) : rawBody).toString();
        resolve({status: res.statusCode, headers: res.getHeaders(), body: text,
          json: () => JSON.parse(text)});
      } catch (error) { reject(error); }
      finally { stream.destroy(); }
    });
    app.handle(req, res, error => {
      if (error) fail(error);
      else { res.statusCode = 404; res.end(); }
    });
  });
}
