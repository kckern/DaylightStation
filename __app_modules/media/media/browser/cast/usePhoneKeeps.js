// cast/usePhoneKeeps.js
// "Keep on Phone" from the web: the phones that keep audio (content_control
// phone-inbox), what each says about an item, and the verbs. Reads
// GET /api/v1/device/:id/keeps while mounted (every 20 s; a keep is slow), posts
// POST /api/v1/device/:id/keep|unkeep (durable on the backend until the phone acks).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from "../../../../../frontend/src/lib/api.mjs";
import { useDevices } from "../fleet/useDevices.js";
import { deviceKind } from "./castCopy.js";
import mediaLog from "../logging/mediaLog.js";
import { keepTargets, keepStatus, keepEntry, parseKeepKind, isKeepable } from "./phoneKeeps.js";

const REFRESH_MS = 20_000;

export function usePhoneKeeps({ enabled = true } = {}) {
  const { devices } = useDevices();
  const phones = useMemo(() => devices.filter((d) => deviceKind(d) === 'phone').map((d) => ({ id: d.id, name: d.name || d.id })), [devices]);
  const [views, setViews] = useState({});
  const alive = useRef(true);

  const read = useCallback(async () => {
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
  }, [phones]);

  useEffect(() => {
    alive.current = true;
    if (!enabled || phones.length === 0) return () => { alive.current = false; };
    read();
    const timer = setInterval(read, REFRESH_MS);
    return () => { alive.current = false; clearInterval(timer); };
  }, [enabled, phones, read]);

  const targets = useMemo(() => keepTargets(phones, views), [phones, views]);

  /** Menu entries and status lines for one item (none when it is not audio). */
  const forItem = useCallback((item) => {
    if (!isKeepable(item)) return { entries: [], lines: [] };
    const entries = []; const lines = [];
    for (const target of targets) {
      const status = keepStatus(views[target.deviceId], target, item.id);
      entries.push(keepEntry(target, status));
      if (status.line) lines.push({ key: `${target.deviceId}@${target.installId ?? ''}`, line: status.line, state: status.state });
    }
    return { entries, lines };
  }, [targets, views]);

  /** Runs a keepOn:/unkeepOn: entry; false when the kind is not one. */
  const run = useCallback(async (kind, item) => {
    const parsed = parseKeepKind(kind);
    if (!parsed || !item?.id) return false;
    const { verb, deviceId, installId } = parsed;
    mediaLog.phoneKeepAsked({ verb, deviceId, installId, contentId: item.id });
    try {
      await DaylightAPI(`api/v1/device/${encodeURIComponent(deviceId)}/${verb}`, {
        contentId: item.id,
        ...(item.title ? { title: String(item.title).slice(0, 200) } : {}),
        ...(installId ? { installId } : {}),
      }, 'POST');
    } catch (err) {
      mediaLog.phoneKeepFailed({ verb, deviceId, contentId: item.id, error: err?.message });
    }
    await read();
    return true;
  }, [read]);

  return { forItem, run, phones };
}

export default usePhoneKeeps;
