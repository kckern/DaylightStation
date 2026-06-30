/**
 * Pure naming + metadata mapping for fitness session recap videos.
 *
 * One place turns persisted session data into:
 *   - the human slug filename  (`{sessionId}_{Nm}_{users}_{video}`),
 *   - the Plex episode metadata (show / season / episode + artist / album / …),
 *   - the Plex-convention filename for a TV-library copy.
 *
 * No I/O — data in, strings/objects out. Shared by the timelapse use case, the
 * ffmpeg encoder (tag args), and the backfill tool.
 */

const SHOW_NAME = 'Family Fitness';
const GENRE = 'Fitness';

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/** The PRIMARY media item's title (honours the `.primary` flag, not media order). */
export function primaryTitle(data) {
  const media = Array.isArray(data?.summary?.media) ? data.summary.media : [];
  const primary = media.find(m => m?.primary) || media[0] || null;
  return primary?.showTitle || primary?.title || data?.strava?.name || 'Workout';
}

/** Real participant ids (slugs), excluding `device:*` pseudo-ids, in roster order. */
export function participantIds(data) {
  const participants = data?.summary?.participants || data?.participants || {};
  return Object.keys(participants).filter(id => id && !String(id).startsWith('device:'));
}

/**
 * Display names for the artist tag. Prefers the session's own `display_name`, but
 * only when it's a real name (not just the slug echoed back); otherwise consults
 * the injected `resolveName(id)` (profile lookup), then falls back to a
 * title-cased slug. So `felix`→`Felix`, and `kckern`→`KC Kern` via the resolver.
 */
export function participantNames(data, resolveName = null) {
  const participants = data?.summary?.participants || data?.participants || {};
  return participantIds(data).map(id => {
    const raw = (participants[id]?.display_name || participants[id]?.displayName || '').trim();
    let n = raw && raw.toLowerCase() !== 'unknown' && raw.toLowerCase() !== String(id).toLowerCase()
      ? raw : '';
    if (!n && resolveName) {
      const r = (resolveName(id) || '').trim();
      if (r && r.toLowerCase() !== 'unknown' && r.toLowerCase() !== String(id).toLowerCase()) n = r;
    }
    if (!n) n = id;
    if (n === n.toLowerCase()) n = n.replace(/\b\w/g, c => c.toUpperCase());
    return n;
  });
}

/** Dash-joined participant ids for the slug (e.g. `kckern-felix-milo`). */
export function participantSlug(data) {
  return participantIds(data).join('-');
}

/** Session length rounded to the nearest minute (min 1), or null when unknown. */
export function durationMinutes(data) {
  let sec = Number(data?.session?.duration_seconds);
  if (!Number.isFinite(sec) || sec <= 0) {
    const start = Number(data?.startTime), end = Number(data?.endTime);
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) sec = (end - start) / 1000;
  }
  if (!Number.isFinite(sec) || sec <= 0) return null;
  return Math.max(1, Math.round(sec / 60));
}

/**
 * Human slug stem `{sessionId}_{Nm}_{users}_{video-slug}`. sessionId is
 * `YYYYMMDDHHmmss` so it already carries the date — no separate date prefix.
 */
export function buildSlug(data) {
  const videoSlug = slugify(primaryTitle(data)) || 'workout';
  const parts = [String(data?.sessionId || '')];
  const minutes = durationMinutes(data);
  if (minutes != null) parts.push(`${minutes}m`);
  const users = participantSlug(data);
  if (users) parts.push(users);
  parts.push(videoSlug);
  return parts.filter(Boolean).join('_');
}

/** Description: the Strava notes (which already bundle the voice memo + media list),
 *  else the raw voice-memo transcripts. */
export function recapDescription(data) {
  const notes = data?.strava_notes?.text;
  if (typeof notes === 'string' && notes.trim()) return notes.trim();
  const memos = (data?.summary?.voiceMemos || data?.voiceMemos || [])
    .map(m => (m?.transcript || '').trim()).filter(Boolean);
  return memos.length ? memos.map(t => `🎙️ "${t}"`).join('\n\n') : '';
}

// Strip characters that break filenames; keep spaces, commas, hyphens, parens.
function fsSafe(s) {
  return String(s).replace(/[\/\\:*?"<>|]/g, ' ').replace(/\s+/g, ' ').trim();
}

const pad2 = (n) => String(n).padStart(2, '0');

// Minutes `tz` is ahead of UTC at the given instant (e.g. -420 for PDT).
function tzOffsetMinutes(utcMs, tz) {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
    const p = dtf.formatToParts(new Date(utcMs)).reduce((a, x) => (a[x.type] = x.value, a), {});
    const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour % 24), +p.minute, +p.second);
    return Math.round((asUTC - utcMs) / 60000);
  } catch { return 0; }
}

/**
 * The session's START instant, as both a UTC ISO string (for the mp4 `creation_time`
 * atom → Immich/Plex sort date) and a timezone-aware local string (for exiftool's
 * QuickTime:CreationDate, which fixes the displayed calendar day). Derived from
 * `session.start` (local wall time) + `timezone`, falling back to `sessionId`.
 */
export function sessionStart(data) {
  const tz = typeof data?.timezone === 'string' ? data.timezone : null;
  let Y, Mo, D, h, mi, s;
  const start = data?.session?.start;
  const m = typeof start === 'string'
    ? start.trim().match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/) : null;
  if (m) [, Y, Mo, D, h, mi, s] = m.map(Number);
  else {
    const sid = String(data?.sessionId || '');
    if (sid.length >= 14) {
      Y = +sid.slice(0, 4); Mo = +sid.slice(4, 6); D = +sid.slice(6, 8);
      h = +sid.slice(8, 10); mi = +sid.slice(10, 12); s = +sid.slice(12, 14);
    }
  }
  if (!Number.isFinite(Y)) return null;
  const wallUTC = Date.UTC(Y, Mo - 1, D, h, mi, s);
  const offMin = tz ? tzOffsetMinutes(wallUTC, tz) : 0;
  const utcISO = new Date(wallUTC - offMin * 60000).toISOString().replace(/\.000Z$/, 'Z');
  const sign = offMin < 0 ? '-' : '+'; const a = Math.abs(offMin);
  const offsetStr = tz ? `${sign}${pad2(Math.floor(a / 60))}:${pad2(a % 60)}` : 'Z';
  const local = `${Y}-${pad2(Mo)}-${pad2(D)} ${pad2(h)}:${pad2(mi)}:${pad2(s)}`;
  return { utcISO, local, offsetStr, localWithOffset: `${local}${offsetStr}`, tz };
}

/**
 * Plex episode metadata + the TV-library filename base.
 *   show=Family Fitness · season={year} · episode={MMDDHHMM}
 *   title=`Family Fitness - S{year}E{MMDDHHMM} - {Users} - {Video}`
 *   artist=Users · album=Video · genre=Fitness · date={year} · comment/description=notes
 */
export function buildPlexMeta(data, { resolveName = null } = {}) {
  const sid = String(data?.sessionId || '');
  const year = sid.slice(0, 4) || '0000';
  const episodeCode = sid.slice(4, 12) || '00000000'; // MMDDHHMM
  const video = primaryTitle(data);
  const names = participantNames(data, resolveName);
  const artist = names.join(', ');
  const description = recapDescription(data);
  const epTag = `S${year}E${episodeCode}`;
  const titleParts = [SHOW_NAME, epTag, artist, video].filter(Boolean);
  const title = titleParts.join(' - ');
  const start = sessionStart(data);

  // NOTE: deliberately NO `season_number`/`episode_sort` integer atoms — ffmpeg's
  // mov muxer truncates `tvsn`/`tves` to one byte (2026→234, 6251702→182), writing
  // misleading values. Plex's TV agent reads season/episode from the FILENAME
  // (`S{year}E{MMDDHHMM}`) anyway; `show`+`episode_id` (string atoms) cover the rest.
  const tags = {
    title,
    show: SHOW_NAME,
    episode_id: episodeCode,
    media_type: '10', // Apple/Plex "stik" = TV Show
    artist,
    album_artist: SHOW_NAME,
    album: video,
    genre: GENRE,
    date: year,
    comment: description,
    description,
    synopsis: description,
    // creation_time = the workout's actual start instant (UTC), so Immich/Plex sort
    // by when the session happened — NOT the (much later) encode time.
    creation_time: start?.utcISO || undefined,
  };
  // ffmpeg rejects empty -metadata values awkwardly; drop blanks.
  for (const k of Object.keys(tags)) if (tags[k] == null || tags[k] === '') delete tags[k];

  return { showName: SHOW_NAME, season: year, episodeCode, epTag, video, artist, description, title, start, tags, plexFileBase: fsSafe(title) };
}
