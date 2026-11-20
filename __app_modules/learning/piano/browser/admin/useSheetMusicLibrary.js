import { useCallback, useEffect, useMemo, useState } from 'react';
import { DaylightAPI, buildHeaders } from "../../../../../frontend/src/lib/api.mjs";
import getLogger from "../../../../../frontend/src/lib/logging/Logger.js";

export const LIBRARY_PATH = 'api/v1/admin/sheet-music';
const UPLOAD_PATH = `/${LIBRARY_PATH}/upload`;

/**
 * Posts one score as multipart. DaylightAPI only speaks JSON, so this is a
 * plain fetch that carries the same headers (device id, request context and
 * the session Bearer token) minus Content-Type, which the browser sets with
 * the multipart boundary. Same pattern as the agenda admin client.
 *
 * Resolves `{ ok: true, result }` on 201, `{ ok: false, code, status }` on a
 * coded refusal or any other failure (`code` is null when the body had none).
 */
export async function uploadScore({ file, folder, filename }) {
  const body = new FormData();
  body.append('file', file);
  body.append('folder', folder);
  if (filename) body.append('filename', filename);
  let response;
  try {
    response = await fetch(UPLOAD_PATH, {
      method: 'POST',
      headers: buildHeaders(localStorage.getItem('ds_token'), false),
      body,
    });
  } catch (err) {
    return { ok: false, code: 'network', status: 0, message: err?.message };
  }
  let doc = null;
  try { doc = await response.json(); } catch { doc = null; }
  if (response.ok) return { ok: true, result: doc || {} };
  return { ok: false, code: typeof doc?.error === 'string' ? doc.error : null, status: response.status };
}

/** The sheet music library list (scores + upload folders) with reload. */
export function useSheetMusicLibrary() {
  const logger = useMemo(() => getLogger().child({ component: 'admin-sheet-music' }), []);
  const [scores, setScores] = useState([]);
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await DaylightAPI(LIBRARY_PATH);
      setScores(Array.isArray(res?.scores) ? res.scores : []);
      setFolders(Array.isArray(res?.folders) ? res.folders : []);
      logger.info('admin.sheetmusic.loaded', { scores: res?.scores?.length ?? 0 });
    } catch (err) {
      setError(err?.message || 'Request failed');
      logger.error('admin.sheetmusic.load-failed', { error: err?.message });
    } finally {
      setLoading(false);
    }
  }, [logger]);

  useEffect(() => { load(); }, [load]);

  return { scores, folders, loading, error, reload: load };
}
