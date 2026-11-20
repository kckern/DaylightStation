import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';
import { getToken, subscribeToken } from '../../../lib/auth.js';
import { apiResourceReadToken, invalidateApiResources, nextApiResourceEvent } from '../../../lib/hooks/useApiResource.js';
import { createAppLogger } from '../../../lib/ui/index.js';

const logger = createAppLogger('admin').child('content-filter');
const approvals = new Map();

function readOwner() {
  try { return getToken(); } catch { return null; }
}

export function useFilmReviewOwner() {
  return useSyncExternalStore(subscribeToken, readOwner);
}

function subscribeApproval(key, listener) {
  let entry = approvals.get(key);
  if (!entry) {
    entry = { listeners: new Set(), operation: null };
    approvals.set(key, entry);
  }
  entry.listeners.add(listener);
  return () => {
    entry.listeners.delete(listener);
    // A departed write can still reconcile a replacement visit when it settles.
    if (!entry.listeners.size && entry.operation?.phase !== 'writing') approvals.delete(key);
  };
}

function publish(entry, operation) {
  entry.operation = operation;
  for (const listener of entry.listeners) listener();
}

/** One in-flight approval per browser session and film, through its server readback. */
export function useFilmApproval({ ratingKey, owner, data, error, reload, activeView }) {
  const path = `api/v1/content-filter/${encodeURIComponent(ratingKey)}`;
  const key = JSON.stringify([path, owner]);
  const subscribe = useCallback(listener => subscribeApproval(key, listener), [key]);
  const operation = useSyncExternalStore(subscribe, () => approvals.get(key)?.operation ?? null);

  useLayoutEffect(() => {
    if (operation?.phase !== 'confirming' || apiResourceReadToken(data) <= operation.readAfter) return;
    const entry = approvals.get(key);
    if (entry?.operation !== operation) return;

    // A newer same-film GET can confirm the review even if it replaced our reload.
    const approved = Boolean(data?.signOff?.parent);
    const notice = operation.action === 'withdraw'
      ? (approved ? 'The review still shows family approval.' : 'Approval withdrawn.')
      : (approved ? null : 'The review does not show family approval.');
    publish(entry, { action: operation.action, phase: 'complete', notice });
  }, [data, key, operation]);

  const submit = async (action) => {
    const entry = approvals.get(key);
    if (!entry || !activeView.current || readOwner() !== owner) return;
    if (entry.operation?.phase === 'writing' || entry.operation?.phase === 'confirming') return;
    publish(entry, { action, phase: 'writing' });
    try {
      const method = action === 'approve' ? 'POST' : 'DELETE';
      await DaylightAPI(`${path}/signoff`, {}, method);
      logger.info('signoff.action', { ratingKey, action });
    } catch (failure) {
      logger.warn('signoff.action_failed', { ratingKey, action, error: failure.message });
      if (entry.listeners.size) publish(entry, { action, phase: 'failed', notice: failure.message || 'That did not work.' });
      else approvals.delete(key);
      return;
    }

    const sameOwner = readOwner() === owner;
    if (entry.listeners.size) publish(entry, sameOwner ? { action, phase: 'confirming', readAfter: nextApiResourceEvent() } : null);
    else approvals.delete(key);
    if (sameOwner) invalidateApiResources(candidate => candidate === `${path}/review`);
  };

  const confirming = operation?.phase === 'confirming';
  const blocked = confirming || operation?.phase === 'writing';
  const readError = confirming ? error : null;
  return {
    action: operation?.action,
    notice: operation?.notice,
    blocked,
    busy: blocked && !readError,
    readError,
    submit,
    retry: reload,
  };
}
