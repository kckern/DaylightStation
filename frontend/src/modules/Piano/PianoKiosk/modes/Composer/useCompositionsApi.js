import { DaylightAPI } from '../../../../../lib/api.mjs';

export function useCompositionsApi(userId) {
  const base = `/api/v1/piano/users/${userId}/compositions`;
  return {
    async list() { return (await DaylightAPI(base)).compositions || []; },
    async get(id) { return DaylightAPI(`${base}/${id}`); },
    async create(body) { return DaylightAPI(base, body, 'POST'); },
    async save(id, body) { return DaylightAPI(`${base}/${id}`, body, 'PUT'); },
    async remove(id) { return DaylightAPI(`${base}/${id}`, {}, 'DELETE'); },
  };
}
