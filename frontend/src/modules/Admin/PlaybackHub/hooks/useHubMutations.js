import { useCallback } from 'react';

const CONTENTION_RETRY_DELAY_MS = 500;

/**
 * Write helpers for the playback-hub admin.
 *
 * Constructor accepts `{ revalidate }` so each successful config-mutating
 * call (`updateDevice`, `saveFire`, `deleteFire`) can trigger a config
 * re-fetch. `sendCommand` does NOT revalidate (status changes flow back
 * via the WS broadcaster).
 *
 * Contention auto-retry semantics — `sendCommand` has built-in single
 * retry on `skipped[].reason === 'contention'` (matches the use case's
 * CommandResult). Retries fire only the contention'd targets, after a
 * 500 ms delay. There is at most ONE auto-retry per call.
 *
 * @param {object} options
 * @param {() => Promise<void>} [options.revalidate]
 * @returns {{
 *   sendCommand: (body: object) => Promise<object>,
 *   updateDevice: (color: string, patch: object) => Promise<object>,
 *   saveFire: (fire: object) => Promise<object>,
 *   deleteFire: (id: string) => Promise<{ ok: boolean }>,
 * }}
 */
export function useHubMutations({ revalidate } = {}) {
  const sendCommand = useCallback(async (body, _attempt = 0) => {
    const r = await fetch('/api/v1/playback-hub/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await r.json();

    // Auto-retry contention'd targets ONCE, after a short delay. Other
    // skip reasons (`unreachable`, `not-found`) are terminal and bubble
    // up to the caller as-is.
    if (_attempt === 0 && Array.isArray(result?.skipped)) {
      const contention = result.skipped.filter((s) => s?.reason === 'contention');
      if (contention.length > 0) {
        const retryTargets = contention.map((s) => s.color).join(',');
        await new Promise((res) => setTimeout(res, CONTENTION_RETRY_DELAY_MS));
        return sendCommand({ ...body, target: retryTargets }, 1);
      }
    }

    return result;
  }, []);

  const updateDevice = useCallback(async (color, patch) => {
    const r = await fetch(
      `/api/v1/playback-hub/devices/${encodeURIComponent(color)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      }
    );
    const result = await r.json();
    if (r.ok) revalidate?.();
    return result;
  }, [revalidate]);

  const saveFire = useCallback(async (fire) => {
    const isUpdate = !!fire?.id;
    const url = isUpdate
      ? `/api/v1/playback-hub/scheduled/${encodeURIComponent(fire.id)}`
      : `/api/v1/playback-hub/scheduled`;
    const r = await fetch(url, {
      method: isUpdate ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fire),
    });
    const result = await r.json();
    if (r.ok) revalidate?.();
    return result;
  }, [revalidate]);

  const deleteFire = useCallback(async (id) => {
    const r = await fetch(
      `/api/v1/playback-hub/scheduled/${encodeURIComponent(id)}`,
      { method: 'DELETE' }
    );
    if (r.ok) revalidate?.();
    return { ok: r.ok };
  }, [revalidate]);

  return { sendCommand, updateDevice, saveFire, deleteFire };
}

export default useHubMutations;
