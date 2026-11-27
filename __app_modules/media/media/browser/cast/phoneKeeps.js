// cast/phoneKeeps.js
// "Keep on Phone" from the web (ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md
// §2, §3.2, §3.8): which phone installs can keep something, what each says about an item
// in the lifecycle's words, and the menu entries. Pure: PhoneKeepsProvider fetches
// GET /api/v1/device/:id/keeps and posts keep / unkeep / keep/cancel.

/** Audio the phone can keep: a track (it keeps the album), an album, a playlist, a book. */
const AUDIO_TYPES = new Set(['track', 'album', 'artist', 'playlist', 'audiobook', 'podcast', 'audio', 'song']);
export function isKeepable(item) {
  if (!item) return false;
  if (item.mediaType === 'audio') return true;
  const type = String(item.type ?? item.metadata?.type ?? '').toLowerCase();
  return AUDIO_TYPES.has(type);
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return n > 0 ? `${Math.max(1, Math.round(n / 1e3))} KB` : '';
}

function clock(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/**
 * The places an item can be kept: one per phone, or one per live install of a phone
 * when two are live (named by model, never guessed between). Installs gone (not seen
 * for 30 days) are never targets.
 * @param {Array<{id:string, name?:string}>} phones
 * @param {Object<string, {installs?:Array}>} views GET keeps answers by device id
 */
export function keepTargets(phones = [], views = {}) {
  const out = [];
  for (const phone of phones) {
    const name = phone.name || phone.id;
    const installs = (views[phone.id]?.installs ?? []).filter((i) => !i.gone);
    const live = installs.filter((i) => i.live);
    if (live.length > 1) {
      for (const i of live) out.push({ deviceId: phone.id, installId: i.installId, name: `${name} · ${i.model || i.installId.slice(0, 6)}`, phoneName: name });
    } else {
      const current = installs.find((i) => i.current);
      out.push({ deviceId: phone.id, installId: current?.installId ?? null, name, phoneName: name });
    }
  }
  return out;
}

/**
 * The ids a kept collection may be filed under for this item: the item itself, and
 * for a track, its album (the phone keeps a track's album, never a stray track).
 */
export function keepIdsFor(item) {
  const ids = new Set();
  if (item?.id) ids.add(item.id);
  const source = typeof item?.id === 'string' && item.id.includes(':') ? item.id.split(':')[0] : null;
  for (const parent of [item?.albumId, item?.parentId, item?.metadata?.parentRatingKey, item?.metadata?.albumId]) {
    if (parent === undefined || parent === null || parent === '') continue;
    const p = String(parent);
    ids.add(p.includes(':') ? p : (source ? `${source}:${p}` : p));
  }
  return ids;
}

const forInstall = (target, installId) => !target.installId || !installId || installId === target.installId;

/** The phone's report of this item (by its id, its album, or a track it lists). */
function reported(view, target, item) {
  const report = target.installId ? view?.kept?.[target.installId] : Object.values(view?.kept ?? {})[0];
  const ids = keepIdsFor(item);
  const items = report?.items ?? [];
  return items.find((i) => ids.has(i.contentId))
    ?? items.find((i) => Array.isArray(i.trackIds) && i.trackIds.includes(item?.id))
    ?? null;
}

/**
 * What one target says about one item, in the lifecycle's words (§2):
 * {state, line, kept, cancel?}. `kept` offers Remove; `cancel` (a waiting keep the phone
 * has not received) offers Cancel.
 */
export function keepStatus(view, target, item) {
  if (!view || !item?.id) return { state: 'none', line: null, kept: false };
  const ids = keepIdsFor(item);
  const name = target.name;
  const waiting = (view.waiting ?? []).filter((w) => ids.has(w.contentId) && forInstall(target, w.installId)).pop();
  if (waiting) {
    if (waiting.command === 'unkeep') return { state: 'removing', line: `Removing from ${name}…`, kept: false };
    const asked = clock(waiting.queuedAt);
    return {
      state: 'asked',
      // Not yet picked up: a closed app checks in every 15 min, an open one at once.
      line: `Waiting for ${name}${asked ? ` · asked ${asked}` : ''}${waiting.handedOver ? '' : ' · usually within 15 min'}`,
      kept: true,
      ...(waiting.handedOver ? {} : { cancel: waiting.commandId }),
    };
  }
  const refusal = (view.refused ?? []).find((r) => ids.has(r.contentId) && forInstall(target, r.installId));
  const item0 = reported(view, target, item);
  if (refusal && !item0) return { state: 'refused', line: `${name} refused: ${refusal.reason}`, kept: false };
  const received = (view.received ?? []).find((r) => ids.has(r.contentId) && forInstall(target, r.installId));
  if (received && !item0) {
    return received.command === 'unkeep'
      ? { state: 'removing', line: `Removing from ${name}…`, kept: false }
      : { state: 'received', line: `Received by ${name}`, kept: true };
  }
  if (!item0) return { state: 'none', line: null, kept: false };
  const size = formatBytes(item0.bytes);
  const total = formatBytes(item0.totalBytes);
  const reason = item0.reason ? `: ${item0.reason}` : '';
  switch (item0.state) {
    case 'asked': return { state: 'asked', line: `Waiting for ${name}`, kept: true };
    case 'checking': return { state: 'checking', line: `Checking size on ${name}…`, kept: true };
    case 'needs-room': return { state: 'needs-room', line: `Needs ${formatBytes(item0.neededBytes) || 'more'} more room on ${name}`, kept: true };
    case 'queued': return { state: 'queued', line: `Queued on ${name}`, kept: true };
    case 'waiting-wifi': return { state: 'waiting-wifi', line: `Waiting for Wi-Fi on ${name}`, kept: true };
    case 'waiting-home': return { state: 'waiting-home', line: `${name} is waiting for home`, kept: true };
    case 'waiting-storage': return { state: 'waiting-storage', line: `${name} storage is full`, kept: true };
    case 'downloading': return {
      state: 'downloading',
      line: `Downloading ${item0.done} of ${item0.total}${size && total ? ` · ${size} of ${total}` : ''} on ${name}`,
      kept: true,
    };
    case 'paused': return { state: 'paused', line: `Paused on ${name}`, kept: true };
    case 'partly-ready': {
      const failed = item0.failed || Math.max(0, (item0.total || 0) - (item0.done || 0));
      return { state: 'partly-ready', line: `${item0.done} of ${item0.total} ready on ${name} · ${failed} couldn't download${reason}`, kept: true };
    }
    case 'ready': return { state: 'ready', line: [`On ${name}`, size].filter(Boolean).join(' · '), kept: true };
    case 'updating': return { state: 'updating', line: `Updating on ${name}`, kept: true };
    case 'removing': return { state: 'removing', line: `Removing from ${name}…`, kept: false };
    case 'not-available': return { state: 'not-available', line: `On ${name}'s SD card — not inserted`, kept: true };
    case 'damaged': return { state: 'damaged', line: `${item0.failed || 1} track${(item0.failed || 1) === 1 ? '' : 's'} on ${name} need${(item0.failed || 1) === 1 ? 's' : ''} downloading again`, kept: true };
    case 'failed': return { state: 'failed', line: `Failed on ${name}${reason}`, kept: true };
    case 'refused': return { state: 'refused', line: `${name} refused${reason}`, kept: false };
    default: return { state: 'none', line: null, kept: false };
  }
}

/** The problem states (shown in red). */
export const KEEP_PROBLEM_STATES = new Set(['needs-room', 'waiting-storage', 'partly-ready', 'not-available', 'damaged', 'failed', 'refused']);

const keyOf = (target) => `${target.deviceId}${target.installId ? `@${target.installId}` : ''}`;

/** The menu entries for one target: keep, or cancel a waiting keep, or remove. */
export function keepEntries(target, status) {
  const key = keyOf(target);
  if (status.cancel) return [{ kind: `cancelKeepOn:${target.deviceId}#${status.cancel}`, label: `Cancel keep on ${target.name}` }];
  return status.kept
    ? [{ kind: `unkeepOn:${key}`, label: `Remove from ${target.name}` }]
    : [{ kind: `keepOn:${key}`, label: `Keep on ${target.name}` }];
}

/** Kept for callers that want one entry. */
export function keepEntry(target, status) {
  return keepEntries(target, status)[0];
}

/**
 * "keepOn:phone@install-1" → {verb:'keep', deviceId, installId};
 * "cancelKeepOn:phone#<commandId>" → {verb:'cancel', deviceId, commandId}; null otherwise.
 */
export function parseKeepKind(kind) {
  const text = String(kind ?? '');
  const cancel = /^cancelKeepOn:([^#]+)#(.+)$/.exec(text);
  if (cancel) return { verb: 'cancel', deviceId: cancel[1], commandId: cancel[2] };
  const m = /^(keep|unkeep)On:([^@]+)(?:@(.+))?$/.exec(text);
  return m ? { verb: m[1], deviceId: m[2], installId: m[3] ?? null } : null;
}

export const isKeepKind = (kind) => parseKeepKind(kind) !== null;

/**
 * A phone's page (§3.2, §3.7): every install (gone ones marked), what each keeps
 * (largest first, with size and state), its free space and limit, and the keeps still
 * waiting for it.
 */
export function phonePage(phone, view) {
  const name = phone?.name || phone?.id;
  const installs = (view?.installs ?? []).map((i) => {
    const report = view?.kept?.[i.installId] ?? null;
    const target = { deviceId: phone.id, installId: i.installId, name };
    const items = (report?.items ?? [])
      .filter((it) => it.state !== 'removed')
      .map((it) => ({ ...it, status: keepStatus({ ...view, waiting: [], received: [], refused: [] }, target, { id: it.contentId }) }))
      .sort((a, b) => (b.bytes || 0) - (a.bytes || 0));
    const keptBytes = items.reduce((n, it) => n + (it.bytes || 0), 0);
    return {
      installId: i.installId,
      model: i.model,
      live: !!i.live,
      gone: !!i.gone,
      current: !!i.current,
      lastPollAt: i.lastPollAt ?? null,
      items,
      keptBytes,
      freeBytes: report?.freeBytes ?? null,
      limitBytes: report?.limitBytes ?? null,
      reportedAt: report?.at ?? null,
      space: [
        `${formatBytes(keptBytes) || '0 MB'} kept`,
        report?.limitBytes ? `${formatBytes(report.limitBytes)} limit` : null,
        report?.freeBytes ? `${formatBytes(report.freeBytes)} free on phone` : null,
      ].filter(Boolean).join(' · '),
    };
  });
  const waiting = (view?.waiting ?? []).map((w) => ({ ...w, asked: clock(w.queuedAt) }));
  return { name, installs, waiting, refused: view?.refused ?? [], storeUnavailable: !!view?.storeUnavailable };
}

/**
 * Play on with two phones (item 6, CHOOSE_PHONE): a phone with more than one live
 * install becomes one picker row per install, named by model ("Phone · SM-S921U"),
 * with the target id `phone#<installId>`; with one live install it stays one row.
 * Rows keep the phone's own id as `fleetId` (for its status) and `installId`.
 * @param {Array<Object>} devices picker devices (fleet rows)
 * @param {Object<string, {installs?:Array}>} views GET keeps answers by device id
 * @param {(device:Object)=>boolean} isPhone
 */
export function expandPhoneInstalls(devices = [], views = {}, isPhone = () => false) {
  const out = [];
  for (const device of devices) {
    const live = isPhone(device) ? (views[device.id]?.installs ?? []).filter((i) => i.live && !i.gone) : [];
    if (live.length < 2) { out.push(device); continue; }
    const name = device.name || device.id;
    for (const i of live) {
      out.push({ ...device, id: installTargetId(device.id, i.installId), fleetId: device.id, installId: i.installId, name: `${name} · ${i.model || i.installId.slice(0, 6)}` });
    }
  }
  return out;
}

/** `phone#<installId>`: one install of a phone as a dispatch target. */
export function installTargetId(deviceId, installId) {
  return `${deviceId}#${installId}`;
}

/** A dispatch target id → {deviceId, installId|null}. */
export function splitInstallTarget(targetId) {
  const text = String(targetId ?? '');
  const at = text.indexOf('#');
  if (at < 0) return { deviceId: text, installId: null };
  const installId = text.slice(at + 1);
  return /^[A-Za-z0-9_-]{8,64}$/.test(installId) ? { deviceId: text.slice(0, at), installId } : { deviceId: text.slice(0, at), installId: null };
}
