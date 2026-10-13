/** Fixed test transport for the five retained agent HTTP suites.
 * Real Express/Node complete-body serialization. No sockets, TCP lifecycle,
 * disconnect, abort, backpressure, or inter-chunk timing coverage.
 */
import {wireRequest} from './http-wire.mjs';

// Retain the original test bodies: their legacy "port" slot carries the actual
// Express app, and "server.close" releases no OS resource. No server is created.
export async function startServer(app) {
  if (typeof app?.handle !== 'function') throw new TypeError('Expected real Express app');
  return {port: app, server: Object.freeze({close() {}})};
}

async function jsonRequest(app, method, url, body, headers = {}) {
  const response = await wireRequest(app, method, url, {body, headers});
  return {status: response.status, headers: response.headers,
    body: response.body ? response.json() : null};
}
export const postJson = (app, url, body, headers = {}) =>
  jsonRequest(app, 'POST', url, body, {'content-type': 'application/json', ...headers});
export const getJson = (app, url) => jsonRequest(app, 'GET', url);
export const req = (method, app, url, body) =>
  jsonRequest(app, method, url, body, {'content-type': 'application/json'});

export async function postSSE(app, url, body) {
  const response = await wireRequest(app, 'POST', url, {body});
  const events = [];
  // Same parser as the retained native fixture, applied after complete response.
  let buffer = response.body;
  let index;
  while ((index = buffer.indexOf('\n\n')) >= 0) {
    const block = buffer.slice(0, index);
    buffer = buffer.slice(index + 2);
    const dataLine = block.split('\n').find(line => line.startsWith('data: '));
    if (dataLine) events.push(JSON.parse(dataLine.slice(6)));
  }
  return {status: response.status, headers: response.headers, events};
}

// Only the get/post.send forms actually used by the retained Concierge fixture.
export default function request(app) {
  return {
    get: url => getJson(app, url),
    post: url => ({send: body => postJson(app, url, body)}),
  };
}
