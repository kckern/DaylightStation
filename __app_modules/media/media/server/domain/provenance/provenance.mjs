/**
 * Provenance: which streaming service a household title is "from".
 *
 * A title in the media library may also stream on one or more services. The
 * provenance scene names one of them before the film starts. Every service
 * name, id, label and colour comes from the household config (`services`). These are the
 * pure rules behind that choice: which availability counts, what a provider
 * is called, and which one wins. No I/O and no clock (callers pass `now`).
 *
 * Reference: __docs/reference/media/provenance.md
 */

/** Offer types that mean "you can stream it there": a subscription or free (ad-supported, library card). */
export const STREAMING_OFFER_TYPES = Object.freeze(['sub', 'free']);

export function normalizeServiceName(name) {
  return String(name ?? '').toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
}

/** Slug for a service name: "Some TV+" -> "some-tv-plus", "Some Service On Demand" -> "some-service-on-demand". */
export function serviceSlug(name) {
  return String(name ?? '').toLowerCase().replace(/\+/g, ' plus').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/** The `provider` value that drops a name (e.g. a rent/buy store's listing). */
export const NO_PROVIDER = 'none';

const asList = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]).map((x) => String(x).trim()).filter(Boolean);

/**
 * The household's service map (the `services` section of its provenance
 * config): how the availability service's names become provider ids (the logo
 * file names in `data/content/providers/`) and what each id is called. Read
 * top to bottom; the first entry that matches a name wins.
 *
 *   - provider: <id>               # logo file name; `none` drops the name
 *     label: <name>                # display name (alt text, logs)
 *     names: [<spelling>, ...]     # exact, ignoring case/spaces/punctuation, + = plus
 *     match: '<regex>'             # or a regular expression (case-insensitive)
 *     paid: true                   # a paid subscription (for `secondary` rules)
 *     accent: '#1399ff'            # colour of the scene's lines and dots (default white)
 *
 * Returns `{ entries, labels, paid, accents, invalid }`; `paid` is the set of paid
 * provider ids; `invalid` lists `match` patterns that did not compile (that
 * entry matches by `names` only).
 */
export function parseServices(raw) {
  const invalid = [];
  const entries = [];
  const labels = {};
  const paid = new Set();
  const accents = {};
  for (const item of Array.isArray(raw) ? raw : []) {
    if (!item || typeof item !== 'object') continue;
    const provider = String(item.provider ?? '').trim();
    if (!provider) continue;
    const patterns = [];
    for (const source of asList(item.match)) {
      try { patterns.push(new RegExp(source, 'i')); } catch { invalid.push({ provider, match: source }); }
    }
    const names = asList(item.names).map(normalizeServiceName).filter(Boolean);
    entries.push(Object.freeze({ provider, names, patterns }));
    if (item.label && provider !== NO_PROVIDER && !labels[provider]) labels[provider] = String(item.label);
    if (item.paid === true && provider !== NO_PROVIDER) paid.add(provider);
    const accent = String(item.accent ?? '').trim();
    if (/^#[0-9a-f]{3,8}$/i.test(accent) && provider !== NO_PROVIDER && !accents[provider]) accents[provider] = accent;
  }
  return Object.freeze({ entries: Object.freeze(entries), labels: Object.freeze(labels), paid, accents: Object.freeze(accents), invalid });
}

/**
 * Provider id for a service name, by the service map: the first entry whose
 * `names` or `match` fits, else the name's slug, so any service shows once a
 * logo named by its slug is dropped into the providers folder. Null for an
 * empty name and for a name mapped to `none`.
 */
export function providerIdFor(name, services) {
  const key = normalizeServiceName(name);
  if (!key) return null;
  const text = String(name);
  for (const entry of services?.entries || []) {
    if (entry.names.includes(key) || entry.patterns.some((p) => p.test(text))) {
      return entry.provider === NO_PROVIDER ? null : entry.provider;
    }
  }
  return serviceSlug(name) || null;
}

/** Display name for a provider id: the map's label, else `fallback`, else the id. */
export function providerLabel(provider, services, fallback = null) {
  return services?.labels?.[provider] || fallback || provider;
}

/**
 * Streaming offers from raw availability sources. Keeps subscription and free
 * offers only, one per provider (the first wins; a free offer beats a
 * subscription offer for the same provider).
 * @param {Array<{name:string,type:string,url?:string|null}>} sources
 * @param {ReturnType<typeof parseServices>} services
 * @returns {Array<{provider:string|null,name:string,type:string,url:string|null}>}
 */
export function streamingOffers(sources, services) {
  const byKey = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!s || !STREAMING_OFFER_TYPES.includes(s.type)) continue;
    const provider = providerIdFor(s.name, services);
    const key = provider ?? `?${normalizeServiceName(s.name)}`;
    const prev = byKey.get(key);
    if (prev && !(prev.type === 'sub' && s.type === 'free')) continue;
    byKey.set(key, Object.freeze({ provider, name: String(s.name), type: s.type, url: s.url || null }));
  }
  return [...byKey.values()];
}

/** Whether a stored availability record is young enough to trust. */
export function isFresh(record, now, refreshDays) {
  const at = Date.parse(record?.checkedAt ?? '');
  if (!Number.isFinite(at)) return false;
  const days = Number.isFinite(refreshDays) && refreshDays > 0 ? refreshDays : 30;
  return now.getTime() - at < days * 86_400_000;
}

/**
 * The id an availability source looks a title up by: an IMDb id when there is
 * one, else a TMDB id typed by kind (`movie-603`, `tv-1396`). Null when neither.
 * @param {{kind:'movie'|'show', imdb?:string|null, tmdb?:string|number|null}} identity
 */
export function lookupIdFor(identity) {
  if (!identity) return null;
  const imdb = String(identity.imdb ?? '');
  if (/^tt\d+$/.test(imdb)) return imdb;
  const tmdb = String(identity.tmdb ?? '');
  if (/^\d+$/.test(tmdb)) return `${identity.kind === 'show' ? 'tv' : 'movie'}-${tmdb}`;
  return null;
}

/** External ids from Plex `Guid` entries (`imdb://tt…`, `tmdb://…`). */
export function externalIdsFromGuids(guids) {
  const out = { imdb: null, tmdb: null };
  for (const g of Array.isArray(guids) ? guids : []) {
    const m = String(g?.id ?? '').match(/^(imdb|tmdb):\/\/(.+)$/);
    if (m && !out[m[1]]) out[m[1]] = m[2];
  }
  return out;
}

/**
 * Whether another lookup fits in the month's allowance, keeping `reserve` calls back.
 * Unknown usage (never looked up, or a new month) counts as room.
 */
export function hasQuotaRoom(usage, { month, reserve = 100 } = {}) {
  if (!usage || usage.month !== month) return true;
  const quota = Number(usage.quota), used = Number(usage.quotaUsed);
  if (!Number.isFinite(quota) || !Number.isFinite(used)) return true;
  return used < quota - reserve;
}

/**
 * Whether a resume comes after a long absence: last played more than `hours`
 * ago (by `now`). An unknown or unreadable time is not a long absence.
 */
export function isLongAbsence(lastPlayedAt, now, hours) {
  if (!lastPlayedAt || !(Number(hours) > 0)) return false;
  const at = Date.parse(String(lastPlayedAt));
  if (!Number.isFinite(at)) return false;
  return now.getTime() - at > Number(hours) * 3600000;
}
