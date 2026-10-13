/** Fixed GET adapter for the two existing Libby composition oracles. */
import { wireRequest } from './http-wire.mjs';

export default function request(app) {
  return {
    async get(url) {
      const response = await wireRequest(app, 'GET', url);
      const contentType = String(response.headers['content-type'] || '');
      if (/\bjson\b/i.test(contentType)) return { ...response, body: response.json() };
      // These existing fixtures return one ASCII audio byte. Reject other
      // binary fixtures instead of pretending a UTF-8 string is byte-faithful.
      if (!/^[\x00-\x7F]*$/.test(response.body)) throw new Error('Unsupported non-ASCII content fixture');
      return { ...response, body: Buffer.from(response.body, 'ascii') };
    },
  };
}
