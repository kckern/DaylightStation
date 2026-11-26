// cast/phoneKeeps.js
// "Keep on Phone" from the web (ops:docs/superpowers/plans/2026-11-26-phone-downloads-hardening.md §H):
// which phone installs can keep something, and what each says about one item. Pure:
// the hook (usePhoneKeeps.js) fetches GET /api/v1/device/:id/keeps and posts keep/unkeep.

/** Audio the phone can keep: a track (it keeps the album), an album, a playlist, a book. */
const AUDIO_TYPES = new Set(['track', 'album', 'artist', 'playlist', 'audiobook', 'podcast', 'audio', 'song']);
export function isKeepable(item) {
  if (!item) return false;
  if (item.mediaType === 'audio') return true;
  const type = String(item.type ?? item.metadata?.type ?? '').toLowerCase();
  return AUDIO_TYPES.has(type);
}

function size(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return n > 0 ? `${Math.max(1, Math.round(n / 1e3))} KB` : '';
}

/**
 * The places an item can be kept: one per phone, or one per live install of a phone
 * when two are live (named by model, never guessed between).
 * @param {Array<{id:string, name?:string}>} phones
 * @param {Object<string, {installs?:Array}>} views GET keeps answers by device id
 */
export function keepTargets(phones = [], views = {}) {
  const out = [];
  for (const phone of phones) {
    const name = phone.name || phone.id;
    const live = (views[phone.id]?.installs ?? []).filter((i) => i.live);
    if (live.length > 1) {
      for (const i of live) out.push({ deviceId: phone.id, installId: i.installId, name: `${name} · ${i.model || i.installId.slice(0, 6)}` });
    } else {
      const current = (views[phone.id]?.installs ?? []).find((i) => i.current);
      out.push({ deviceId: phone.id, installId: current?.installId ?? null, name });
    }
  }
  return out;
}

/**
 * What one target says about one item: a waiting command, else the phone's own
 * report for that install. {state, line, kept}: `line` is the words to show
 * ("Waiting for Phone", "Downloading 3 of 12", "On Phone · 230 MB", "Failed: …").
 */
export function keepStatus(view, target, contentId) {
  if (!view || !contentId) return { state: 'none', line: null, kept: false };
  const forInstall = (installId) => !target.installId || !installId || installId === target.installId;
  const waiting = (view.waiting ?? []).filter((w) => w.contentId === contentId && forInstall(w.installId)).pop();
  if (waiting) {
    return waiting.command === 'keep'
      ? { state: 'waiting', line: `Waiting for ${target.name}`, kept: true }
      : { state: 'removing', line: `Removing from ${target.name}`, kept: false };
  }
  const report = target.installId ? view.kept?.[target.installId] : Object.values(view.kept ?? {})[0];
  const item = (report?.items ?? []).find((i) => i.contentId === contentId);
  if (!item || item.state === 'removed') return { state: 'none', line: null, kept: false };
  switch (item.state) {
    case 'queued': return { state: 'queued', line: `Queued on ${target.name}`, kept: true };
    case 'downloading': return { state: 'downloading', line: `Downloading ${item.done} of ${item.total} on ${target.name}`, kept: true };
    case 'ready': return { state: 'ready', line: [`On ${target.name}`, size(item.bytes)].filter(Boolean).join(' · '), kept: true };
    case 'failed': return { state: 'failed', line: `Failed on ${target.name}${item.reason ? `: ${item.reason}` : ''}`, kept: true };
    case 'refused': return { state: 'refused', line: `${target.name} refused${item.reason ? `: ${item.reason}` : ''}`, kept: false };
    default: return { state: 'none', line: null, kept: false };
  }
}

/** The menu entry for one target: keep it there, or remove it from there. */
export function keepEntry(target, status) {
  const key = `${target.deviceId}${target.installId ? `@${target.installId}` : ''}`;
  return status.kept
    ? { kind: `unkeepOn:${key}`, label: `Remove from ${target.name}` }
    : { kind: `keepOn:${key}`, label: `Keep on ${target.name}` };
}

/** "keepOn:phone@install-1" → {verb:'keep', deviceId:'phone', installId:'install-1'}; null otherwise. */
export function parseKeepKind(kind) {
  const m = /^(keep|unkeep)On:([^@]+)(?:@(.+))?$/.exec(String(kind ?? ''));
  return m ? { verb: m[1], deviceId: m[2], installId: m[3] ?? null } : null;
}
