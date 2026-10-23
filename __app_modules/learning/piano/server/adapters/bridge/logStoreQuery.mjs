/**
 * Read-side of the household log store (VictoriaLogs). The backend already ships
 * every event there (`logging.remoteSink`); the speaker ladder's weekly summary reads
 * the week back from it, so no state file is needed and a deploy cannot lose a week.
 */
const DEFAULT_LIMIT = 5000;

/** `http://victoria-logs:9428/insert/jsonline?...` → `http://victoria-logs:9428` */
export function logStoreBaseFromSinkUrl(url) {
  if (!url) return null;
  try { return new URL(url).origin; } catch { return null; }
}

/** @returns {(logsql: string) => Promise<Object[]>} rows as flattened JSON objects */
export function createLogStoreQuery({ baseUrl, fetchImpl = globalThis.fetch, timeoutMs = 15_000, limit = DEFAULT_LIMIT } = {}) {
  if (!baseUrl) throw new Error('createLogStoreQuery requires baseUrl');
  return async function queryLogs(logsql) {
    const res = await fetchImpl(`${baseUrl}/select/logsql/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ query: logsql, limit: String(limit) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res?.ok) throw new Error(`HTTP ${res?.status ?? 'error'} from log store`);
    const text = await res.text();
    return text.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  };
}

export default createLogStoreQuery;
