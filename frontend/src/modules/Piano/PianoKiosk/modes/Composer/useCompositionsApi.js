import { DaylightAPI } from '../../../../../lib/api.mjs';
import getLogger from '../../../../../lib/logging/Logger.js';

// Per-user compositions CRUD client. A plain factory (no internal hooks) so it
// stays directly callable. Every call is logged under `composer-api` (start at
// debug, success/failure at info/error with elapsed ms + a size hint) so the
// network leg of any "didn't save / didn't load" report is visible in the same
// log stream as the UI events, and slow calls are obvious by `ms`.
export function useCompositionsApi(userId, logger) {
  const log = logger || getLogger().child({ component: 'composer-api' });
  const base = `/api/v1/piano/users/${userId}/compositions`;

  const call = async (op, path, body, method, describe) => {
    const t0 = Date.now();
    log.debug(`composer.api.${op}-start`, { userId, ...describe });
    // Preserve the original call arity: GETs are DaylightAPI(path) with no
    // trailing body/method (writes pass all three).
    const args = method ? [path, body, method] : [path];
    try {
      const res = await DaylightAPI(...args);
      log.info(`composer.api.${op}`, { userId, ...describe, ms: Date.now() - t0 });
      return res;
    } catch (err) {
      log.error(`composer.api.${op}-failed`, { userId, ...describe, error: err?.message, ms: Date.now() - t0 });
      throw err;
    }
  };

  return {
    async list() {
      const res = await call('list', base, undefined, undefined, {});
      const compositions = res?.compositions || [];
      log.debug('composer.api.list-result', { userId, count: compositions.length });
      return compositions;
    },
    async get(id) {
      return call('get', `${base}/${id}`, undefined, undefined, { id });
    },
    async create(body) {
      const res = await call('create', base, body, 'POST', { title: body?.title, xmlLen: body?.musicxml?.length || 0 });
      log.info('composer.api.create-result', { userId, id: res?.id, revision: res?.revision });
      return res;
    },
    async save(id, body) {
      return call('save', `${base}/${id}`, body, 'PUT', { id, revision: body?.revision, xmlLen: body?.musicxml?.length || 0 });
    },
    async remove(id) {
      return call('remove', `${base}/${id}`, {}, 'DELETE', { id });
    },
  };
}
