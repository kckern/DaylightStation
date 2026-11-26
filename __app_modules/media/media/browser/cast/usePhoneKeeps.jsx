// cast/usePhoneKeeps.js
// "Keep on Phone" from the web (ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md §3.2):
// one provider for the whole app. It knows the phones that keep audio (content_control
// phone-inbox), reads what each says (GET /api/v1/device/:id/keeps) ONLY while
// something keepable is on screen and the page is visible, one read in flight at a
// time, and runs the verbs (POST keep / unkeep / keep/cancel). A request that fails is
// reported on the outcome tray with Retry; it is never silent.
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useDevices } from "../fleet/useDevices.js";
import { deviceKind } from "./castCopy.js";
import { DispatchContext } from "./DispatchProvider.jsx";
import mediaLog from "../logging/mediaLog.js";
import { keepTargets, keepStatus, keepEntries, parseKeepKind, isKeepable } from "./phoneKeeps.js";

export const KEEPS_REFRESH_MS = 20_000;

export const PhoneKeepsContext = createContext(null);

const NONE = Object.freeze({
  phones: [], views: {}, targets: [],
  forItem: () => ({ entries: [], lines: [] }),
  run: () => false,
  watch: () => () => {},
  refresh: () => Promise.resolve(),
});

function failureReason(err) {
  if (err?.status === 409) return 'Two phones are connected: choose one';
  if (err?.status === 503) return 'Home could not save it just now';
  if (err?.transient) return 'Home not reachable';
  return err?.message ?? 'Something went wrong';
}

export function PhoneKeepsProvider({ children }) {
  const { devices } = useDevices();
  const phones = useMemo(
    () => (devices ?? []).filter((d) => deviceKind(d) === 'phone').map((d) => ({ id: d.id, name: d.name || d.id })),
    [devices],
  );
  const outcomes = useContext(DispatchContext);
  const [views, setViews] = useState({});
  const [watchers, setWatchers] = useState(0);
  const inFlight = useRef(false);
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);

  const read = useCallback(async () => {
    if (inFlight.current || phones.length === 0) return;
    inFlight.current = true;
    try {
      for (const phone of phones) {
        try {
          const view = await DaylightAPI(`api/v1/device/${encodeURIComponent(phone.id)}/keeps`);
          if (!alive.current) return;
          setViews((prev) => ({ ...prev, [phone.id]: view }));
          mediaLog.phoneKeepsRead({ deviceId: phone.id, installs: view?.installs?.length ?? 0, waiting: view?.waiting?.length ?? 0 });
        } catch (err) {
          mediaLog.phoneKeepsReadFailed({ deviceId: phone.id, error: err?.message });
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [phones]);

  // Read while anything keepable is shown and the page is visible; never otherwise.
  useEffect(() => {
    if (watchers === 0 || phones.length === 0) return undefined;
    const visible = () => typeof document === 'undefined' || document.visibilityState !== 'hidden';
    if (visible()) read();
    const timer = setInterval(() => { if (visible()) read(); }, KEEPS_REFRESH_MS);
    const onVisible = () => { if (visible()) read(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
  }, [watchers, phones, read]);

  const watch = useCallback(() => {
    setWatchers((n) => n + 1);
    let done = false;
    return () => { if (!done) { done = true; setWatchers((n) => Math.max(0, n - 1)); } };
  }, []);

  const targets = useMemo(() => keepTargets(phones, views), [phones, views]);

  const forItem = useCallback((item) => {
    if (!isKeepable(item)) return { entries: [], lines: [] };
    const entries = []; const lines = [];
    for (const target of targets) {
      const status = keepStatus(views[target.deviceId], target, item);
      entries.push(...keepEntries(target, status));
      if (status.line) lines.push({ key: `${target.deviceId}@${target.installId ?? ''}`, line: status.line, state: status.state, deviceId: target.deviceId });
    }
    return { entries, lines };
  }, [targets, views]);

  /** Runs a keep entry (keepOn / unkeepOn / cancelKeepOn); false when the kind is not one. */
  const run = useCallback((kind, item) => {
    const parsed = parseKeepKind(kind);
    if (!parsed || !item?.id) return false;
    const { verb, deviceId, installId, commandId } = parsed;
    const target = targets.find((t) => t.deviceId === deviceId && (!installId || t.installId === installId));
    const targetName = target?.name ?? phones.find((p) => p.id === deviceId)?.name ?? deviceId;
    const outcomeKind = verb === 'keep' ? 'keepOnPhone' : verb === 'unkeep' ? 'unkeepOnPhone' : 'cancelKeepOnPhone';
    const attempt = async () => {
      mediaLog.phoneKeepAsked({ verb, deviceId, installId: installId ?? null, contentId: item.id });
      const attemptId = outcomes?.recordLocal?.({
        kind: outcomeKind, phase: 'running', item: { contentId: item.id, title: item.title ?? null }, targetName,
      }) ?? null;
      try {
        if (verb === 'cancel') {
          await DaylightAPI(`api/v1/device/${encodeURIComponent(deviceId)}/keep/cancel`, { commandId }, 'POST');
        } else {
          await DaylightAPI(`api/v1/device/${encodeURIComponent(deviceId)}/${verb}`, {
            contentId: item.id,
            ...(item.title ? { title: String(item.title).slice(0, 200) } : {}),
            ...(installId ? { installId } : {}),
          }, 'POST');
        }
        outcomes?.resolveLocal?.(attemptId, { phase: 'confirmed' });
      } catch (err) {
        const reason = failureReason(err);
        mediaLog.phoneKeepFailed({ verb, deviceId, contentId: item.id, status: err?.status ?? null, error: err?.message });
        if (attemptId) {
          outcomes?.resolveLocal?.(attemptId, { phase: 'failed', reason, retryAction: () => { outcomes?.removeDispatch?.(attemptId); attempt(); } });
        }
      }
      await read();
    };
    attempt();
    return true;
  }, [targets, phones, outcomes, read]);

  const value = useMemo(() => ({ phones, views, targets, forItem, run, watch, refresh: read }), [phones, views, targets, forItem, run, watch, read]);
  return <PhoneKeepsContext.Provider value={value}>{children}</PhoneKeepsContext.Provider>;
}

/** The app's keeps (a no-op outside the provider). */
export function usePhoneKeeps() {
  return useContext(PhoneKeepsContext) ?? NONE;
}

/** Keeps the keep states fresh while this item is on screen (and only when it is keepable). */
export function useWatchPhoneKeeps(item, { always = false } = {}) {
  const { watch } = usePhoneKeeps();
  const keepable = always || isKeepable(item);
  useEffect(() => (keepable ? watch() : undefined), [keepable, watch]);
}

export default usePhoneKeeps;
