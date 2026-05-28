import { useCallback, useMemo } from 'react';
import getLogger from '../../../../lib/logging/Logger.js';
import { runWithFeedback } from '../../shared/feedback.js';

const CONTENTION_RETRY_DELAY_MS = 500;

/**
 * Write helpers for the playback-hub admin.
 *
 * Every call goes through `runWithFeedback` so the user sees a toast for
 * success / partial / failure, and an entry shows up in the structured log
 * stream under `playback-hub.<action>.<phase>`.
 *
 * Each mutation returns `{ ok, result?, error? }`:
 *   - on full success:    { ok: true, result: <wire body> }
 *   - on partial success: { ok: true, result: <wire body> }  (yellow toast shown)
 *   - on HTTP error or network throw: { ok: false, error }   (red toast shown)
 *
 * `sendCommand` keeps its existing contention auto-retry (500ms delay,
 * single retry, only the contention'd targets). Real protocol-level
 * errors (body has `ok: false`) become exceptions so they classify as
 * failure; partial outcomes (HTTP 502 but body `ok: true` with skipped[])
 * remain structured and classify as partial via `partialFromResult`.
 *
 * `verifyAudio` is read-only and silent-fail-tolerant: it never throws
 * and never calls revalidate. On non-2xx or network errors it returns
 * `{ ok: false, error }` instead of raising. This lets post-Play timers
 * call it safely without try/catch.
 *   verifyAudio: (color: string) => Promise<object>,
 */
export function useHubMutations({ revalidate } = {}) {
  const logger = useMemo(
    () => getLogger().child({ component: 'useHubMutations' }),
    [],
  );

  const sendCommandRaw = useCallback(async function inner(body, _attempt = 0) {
    const r = await fetch('/api/v1/playback-hub/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await r.json();

    if (_attempt === 0 && Array.isArray(result?.skipped)) {
      const contention = result.skipped.filter((s) => s?.reason === 'contention');
      if (contention.length > 0) {
        const retryTargets = contention.map((s) => s.color).join(',');
        await new Promise((res) => setTimeout(res, CONTENTION_RETRY_DELAY_MS));
        return inner({ ...body, target: retryTargets }, 1);
      }
    }

    if (result?.ok === false) {
      const err = new Error(result?.error ?? `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return result;
  }, []);

  const sendCommand = useCallback((body) => {
    return runWithFeedback(() => sendCommandRaw(body), {
      logger,
      eventName: `playback-hub.command.${body?.action ?? 'unknown'}`,
      successTitle: 'Command sent',
      successMessage: (r) =>
        `${body?.action ?? 'command'}: ${(r.applied ?? []).join(', ') || '(no targets)'}`,
      partialTitle: 'Command partial',
      partialFromResult: (r) => ({
        applied: r.applied ?? [],
        skipped: r.skipped ?? [],
        isPartial: (r.skipped ?? []).length > 0,
      }),
      failureTitle: 'Command failed',
      logContext: { action: body?.action, target: body?.target },
    });
  }, [logger, sendCommandRaw]);

  const updateDeviceRaw = useCallback(async (color, patch) => {
    const r = await fetch(
      `/api/v1/playback-hub/devices/${encodeURIComponent(color)}`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      },
    );
    const result = await r.json();
    if (!r.ok) {
      const err = new Error(result?.error ?? `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return result;
  }, []);

  const updateDevice = useCallback((color, patch) => {
    return runWithFeedback(() => updateDeviceRaw(color, patch), {
      logger,
      eventName: 'playback-hub.update-device',
      successTitle: 'Saved',
      successMessage: () => `${color} updated`,
      failureTitle: `Could not update ${color}`,
      logContext: { color },
    }).then((out) => {
      if (out.ok) revalidate?.();
      return out;
    });
  }, [logger, updateDeviceRaw, revalidate]);

  const saveFireRaw = useCallback(async (fire) => {
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
    if (!r.ok) {
      const err = new Error(result?.error ?? `HTTP ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return result;
  }, []);

  const saveFire = useCallback((fire) => {
    const isUpdate = !!fire?.id;
    return runWithFeedback(() => saveFireRaw(fire), {
      logger,
      eventName: isUpdate
        ? 'playback-hub.fire.update'
        : 'playback-hub.fire.create',
      successTitle: isUpdate ? 'Schedule updated' : 'Schedule created',
      successMessage: (r) =>
        `${r.fire?.target ?? fire?.target ?? '?'} @ ${r.fire?.time ?? fire?.time ?? '?'}`,
      failureTitle: 'Could not save schedule',
      logContext: { id: fire?.id, target: fire?.target },
    }).then((out) => {
      if (out.ok) revalidate?.();
      return out;
    });
  }, [logger, saveFireRaw, revalidate]);

  const deleteFireRaw = useCallback(async (id) => {
    const r = await fetch(
      `/api/v1/playback-hub/scheduled/${encodeURIComponent(id)}`,
      { method: 'DELETE' },
    );
    if (!r.ok) {
      let detail = `HTTP ${r.status}`;
      try {
        const body = await r.json();
        detail = body?.error ?? detail;
      } catch { /* no body */ }
      const err = new Error(detail);
      err.status = r.status;
      throw err;
    }
    return { ok: true };
  }, []);

  const deleteFire = useCallback((id) => {
    return runWithFeedback(() => deleteFireRaw(id), {
      logger,
      eventName: 'playback-hub.fire.delete',
      successTitle: 'Schedule deleted',
      successMessage: () => `id: ${id}`,
      failureTitle: 'Could not delete schedule',
      logContext: { id },
    }).then((out) => {
      if (out.ok) revalidate?.();
      return out;
    });
  }, [logger, deleteFireRaw, revalidate]);

  const verifyAudio = useCallback(async (color) => {
    try {
      const r = await fetch(
        `/api/v1/playback-hub/verify/${encodeURIComponent(color)}`
      );
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        return {
          ok: false,
          error: body?.error ?? `HTTP ${r.status}`,
          code: body?.code ?? null,
        };
      }
      return body;
    } catch (err) {
      return { ok: false, error: err?.message ?? 'network error' };
    }
  }, []);

  return { sendCommand, updateDevice, saveFire, deleteFire, verifyAudio };
}

export default useHubMutations;
