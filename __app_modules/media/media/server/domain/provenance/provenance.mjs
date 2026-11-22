/**
 * Provenance: which streaming service a household title is "from".
 *
 * A title in Plex may also stream on Netflix, Tubi, Hoopla and so on. The
 * provenance bumper names one of them before the film starts. These are the
 * pure rules behind that choice: which availability counts, what a provider
 * is called, and which one wins. No I/O and no clock (callers pass `now`).
 *
 * Reference: __docs/reference/media/provenance.md
 */

/** Offer types that mean "you can stream it there": a subscription or free (ad-supported, library card). */
export const STREAMING_OFFER_TYPES = Object.freeze(['sub', 'free']);

/** Tiers in priority order. `other` = a known service the household has no tier for. */
export const PROVIDER_TIERS = Object.freeze(['free', 'subscribed', 'other']);

/**
 * Service names as availability sources spell them, normalized (lower case,
 * `+` → `plus`, other non-alphanumerics dropped), mapped to provider ids. The ids
 * name the logo files in `data/content/providers/`.
 */
const PROVIDER_ALIASES = Object.freeze({
  netflix: 'netflix',
  primevideo: 'prime-video', amazonprime: 'prime-video', amazonprimevideo: 'prime-video',
  hulu: 'hulu',
  disneyplus: 'disney-plus',
  peacock: 'peacock', peacockpremium: 'peacock', peacockpremiumplus: 'peacock',
  max: 'hbo-max', hbomax: 'hbo-max',
  paramountplus: 'paramount-plus',
  appletvplus: 'apple-tv',
  tubi: 'tubi', tubitv: 'tubi',
  plutotv: 'pluto-tv',
  hoopla: 'hoopla',
  kanopy: 'kanopy',
  therokuchannel: 'roku-channel', rokuchannel: 'roku-channel',
  amcplus: 'amc-plus',
  philo: 'philo',
  directv: 'directv', directvondemand: 'directv', directvstream: 'directv',
  youtube: 'youtube', youtubefree: 'youtube', youtubetv: 'youtube-tv',
  curiositystream: 'curiosity-stream', magellantv: 'magellan-tv',
  crackle: 'crackle', vimeo: 'vimeo', dailymotion: 'dailymotion',
  byutv: 'byutv', vidangel: 'vidangel', angelstudios: 'vidangel',
  livingscriptures: 'living-scriptures', livingscripturesstreaming: 'living-scriptures',
  internetarchive: 'archive-org', archiveorg: 'archive-org',
});

/** Display names for the provider ids above (alt text, logs). */
export const PROVIDER_NAMES = Object.freeze({
  netflix: 'Netflix', 'prime-video': 'Prime Video', hulu: 'Hulu', 'disney-plus': 'Disney+',
  peacock: 'Peacock', 'hbo-max': 'HBO Max', 'paramount-plus': 'Paramount+', 'apple-tv': 'Apple TV',
  tubi: 'Tubi', 'pluto-tv': 'Pluto TV', hoopla: 'Hoopla', kanopy: 'Kanopy', 'roku-channel': 'The Roku Channel',
  'amc-plus': 'AMC+', philo: 'Philo', directv: 'DirecTV',
  youtube: 'YouTube', 'youtube-tv': 'YouTube TV', 'curiosity-stream': 'CuriosityStream', 'magellan-tv': 'MagellanTV',
  crackle: 'Crackle', vimeo: 'Vimeo', dailymotion: 'Dailymotion', byutv: 'BYUtv', vidangel: 'VidAngel',
  'living-scriptures': 'Living Scriptures', 'archive-org': 'Internet Archive',
});

export function normalizeServiceName(name) {
  return String(name ?? '').toLowerCase().replace(/\+/g, 'plus').replace(/[^a-z0-9]/g, '');
}

/** Slug for a service name: "AMC+" -> "amc-plus", "DirecTV On Demand" -> "directv-on-demand". */
export function serviceSlug(name) {
  return String(name ?? '').toLowerCase().replace(/\+/g, ' plus').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * A service sold as a channel inside another app ("Paramount+ (Via Amazon
 * Prime)", "AMC+ Amazon Channel", "Max Roku Channel", "HBO (Via Hulu)", "AMC
 * Plus Apple TV Channel") is watched in that app, so it counts as that app.
 * Any name tied to Amazon or Prime Video ("Prime Video Free", "Amazon
 * Freevee") counts as Prime Video.
 */
const CHANNEL_HOSTS = Object.freeze([
  [/\bamazon\b|\bprime video\b/i, 'prime-video'],
  [/\(via hulu\)/i, 'hulu'],
  [/\broku (premium )?channel\b/i, 'roku-channel'],
  [/\bapple tv channel\b/i, 'apple-tv'],
]);

function channelHost(name) {
  const text = String(name ?? '');
  for (const [pattern, host] of CHANNEL_HOSTS) if (pattern.test(text)) return host;
  return null;
}

/**
 * Provider id for a service name: a known alias, else the name's slug, so any
 * service shows once a logo named by its slug is dropped into the providers
 * folder (no code change). Null for an empty name, and for "AppleTV" alone,
 * which is Apple's store (rent/buy), not the Apple TV service.
 */
export function providerIdFor(name) {
  const key = normalizeServiceName(name);
  if (!key) return null;
  if (key === 'appletv') return null;
  const host = channelHost(name);
  if (host) return host;
  return PROVIDER_ALIASES[key] ?? (serviceSlug(name) || null);
}

/**
 * Streaming offers from raw availability sources. Keeps subscription and free
 * offers only, one per provider (the first wins; a free offer beats a
 * subscription offer for the same provider).
 * @param {Array<{name:string,type:string,url?:string|null}>} sources
 * @returns {Array<{provider:string|null,name:string,type:string,url:string|null}>}
 */
export function streamingOffers(sources) {
  const byKey = new Map();
  for (const s of Array.isArray(sources) ? sources : []) {
    if (!s || !STREAMING_OFFER_TYPES.includes(s.type)) continue;
    const provider = providerIdFor(s.name);
    const key = provider ?? `?${normalizeServiceName(s.name)}`;
    const prev = byKey.get(key);
    if (prev && !(prev.type === 'sub' && s.type === 'free')) continue;
    byKey.set(key, Object.freeze({ provider, name: String(s.name), type: s.type, url: s.url || null }));
  }
  return [...byKey.values()];
}

/**
 * The tier a provider sits in for this household.
 * @param {string} provider
 * @param {{free?:string[], subscribed?:string[]}} tiers
 */
export function tierOf(provider, tiers = {}) {
  if ((tiers.free || []).includes(provider)) return 'free';
  if ((tiers.subscribed || []).includes(provider)) return 'subscribed';
  return 'other';
}

/**
 * The provider a title is shown as coming from, or null when nothing qualifies.
 * Order: the household's free services, then its subscriptions, each in the
 * configured order; then any other known service, in the order found. A
 * provider qualifies only if `canShow(provider)` (e.g. a logo exists).
 * @param {Array<{provider:string|null,type:string,url?:string|null}>} offers
 * @param {{free?:string[], subscribed?:string[]}} tiers
 * @param {(provider:string)=>boolean} [canShow]
 * @returns {{provider:string,name:string,tier:string,offerType:string,url:string|null}|null}
 */
export function chooseProvider(offers, tiers = {}, canShow = () => true) {
  const ranked = [];
  (Array.isArray(offers) ? offers : []).forEach((raw, found) => {
    // Records stored before a service had an id carry `provider: null`: derive it from the name.
    const o = raw && !raw.provider && raw.name ? { ...raw, provider: providerIdFor(raw.name) } : raw;
    if (!o?.provider || !STREAMING_OFFER_TYPES.includes(o.type) || !canShow(o.provider)) return;
    const tier = tierOf(o.provider, tiers);
    const list = tier === 'free' ? tiers.free : tier === 'subscribed' ? tiers.subscribed : null;
    const rank = PROVIDER_TIERS.indexOf(tier) * 1000 + (list ? list.indexOf(o.provider) : found);
    ranked.push({ rank, o, tier });
  });
  if (!ranked.length) return null;
  ranked.sort((a, b) => a.rank - b.rank);
  const { o, tier } = ranked[0];
  return Object.freeze({
    provider: o.provider,
    name: PROVIDER_NAMES[o.provider] || o.name,
    tier,
    offerType: o.type,
    url: o.url || null,
  });
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
