import { useCallback, useEffect, useRef, useState } from 'react';
import { daylightApiResponse } from '../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';

let _logger;
function logger() {
  if (!_logger) _logger = getLogger().child({ component: 'charades-people-directory' });
  return _logger;
}

const PEOPLE = '/api/v1/admin/people';

async function request(path, { method = 'GET', body, etag, signal } = {}) {
  const response = await daylightApiResponse(path, {
    method, data: body, ifMatch: etag, signal, withContentType: body !== undefined,
  });
  const document = await response.json();
  if (!response.ok) throw Object.assign(new Error(document.message || 'Request failed'), document, { status: response.status });
  return { document, etag: response.headers.get('ETag') };
}

const newGuestId = () => `guest_${crypto.randomUUID()}`;

/**
 * The household people directory (users then guests, archived guests included
 * so a stored participant id still resolves to a name). `createGuest(name)`
 * adds a named guest and resolves to its directory entry.
 */
export default function usePeopleDirectory() {
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const etag = useRef(null);

  const load = useCallback(async signal => {
    const { document, etag: next } = await request(`${PEOPLE}?includeArchived=true`, { signal });
    etag.current = next;
    setPeople(Array.isArray(document.people) ? document.people : []);
    setError(null);
    return document.people;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    load(controller.signal)
      .then(list => { logger().debug('people.loaded', { count: list?.length ?? 0 }); })
      .catch(err => {
        if (controller.signal.aborted) return;
        logger().warn('people.load.failed', { message: err.message, status: err.status });
        setError(err);
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [load]);

  const createGuest = useCallback(async name => {
    const id = newGuestId();
    const send = () => request(`${PEOPLE}/guests`, { method: 'POST', body: { id, name }, etag: etag.current });
    const failed = (err, attempt) => {
      logger().warn('people.guest.create.failed', { message: err.message, status: err.status, code: err.code, attempt });
      return err;
    };
    let result;
    try {
      if (!etag.current) await load();
      result = await send();
    } catch (err) {
      if (err.code !== 'revision_conflict' && err.status !== 428) throw failed(err, 1);
      // The directory moved on since it was read: refresh the revision once and retry with the same id.
      try {
        await load();
        result = await send();
      } catch (retryErr) {
        throw failed(retryErr, 2);
      }
    }
    etag.current = result.etag || etag.current;
    const entry = result.document;
    setPeople(list => [...list.filter(p => !(p.person?.kind === 'guest' && p.person?.id === id)), entry]);
    logger().info('people.guest.created', { guestId: id });
    return entry;
  }, [load]);

  return { people, loading, error, createGuest };
}
