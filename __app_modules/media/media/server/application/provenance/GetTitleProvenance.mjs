/**
 * GetTitleProvenance — the service a household title is shown as coming from,
 * for the provenance scene, decided by the household's rules
 * (domain/provenance/rules.mjs, configured in the household's provenance.yml):
 *
 *   1. overrides  (the title's facts: content filter on, collection, studio...)
 *   2. priority   (the availability service's offers, by provider group)
 *   3. fallbacks  (year, length, library, studio, then usually "always")
 *
 * The title's facts come from the media server on every play. Availability is
 * looked up on demand (when a title is about to play), never in a library
 * sweep: the service allows a limited number of calls a month. An override
 * that matches spends no lookup.
 *
 * Returns null when no rule names a service with a logo, or the title is out
 * of scope (kind, library); the player then shows no scene.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import {
  isFresh, lookupIdFor, streamingOffers, hasQuotaRoom, providerIdFor, PROVIDER_NAMES,
} from '../../domain/provenance/provenance.mjs';
import { firstRule, rankOffers, needsContentFilter, parseRules } from '../../domain/provenance/rules.mjs';

const monthOf = (d) => d.toISOString().slice(0, 7);

/** A rule's `when`, as a short label for logs ("collection=living scriptures"). */
function describeWhen(when = {}) {
  if (when.always) return 'always';
  return Object.entries(when).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`).join(',') || 'always';
}

export class GetTitleProvenance {
  #identityReader; #availability; #store; #logos; #policy; #clock; #logger; #contentFilter;
  #inflight = new Map();

  /**
   * @param {object} deps
   * @param {import('./ports/ITitleIdentityReader.mjs').ITitleIdentityReader} deps.identityReader
   * @param {import('./ports/IStreamingAvailabilityGateway.mjs').IStreamingAvailabilityGateway|null} deps.availability - null when no API key
   * @param {import('./ports/IProvenanceStore.mjs').IProvenanceStore} deps.store
   * @param {import('./ports/IProviderLogoCatalog.mjs').IProviderLogoCatalog} deps.logos
   * @param {() => {tiers:{free:string[],subscribed:string[]}, refreshDays:number, quotaReserve:number, enabled:boolean, kinds?:string[]}} deps.policy
   * @param {() => Date} [deps.clock]
   * @param {{ isActive(ratingKey:string): Promise<boolean> }|null} [deps.contentFilter] - asked only when a rule uses `content_filter`
   */
  constructor({ identityReader, availability, store, logos, policy, clock = () => new Date(), logger = console, contentFilter = null }) {
    if (!identityReader) throw new Error('GetTitleProvenance requires identityReader');
    if (!store) throw new Error('GetTitleProvenance requires store');
    if (!logos) throw new Error('GetTitleProvenance requires logos');
    if (typeof policy !== 'function') throw new Error('GetTitleProvenance requires policy');
    this.#identityReader = identityReader;
    this.#availability = availability || null;
    this.#store = store;
    this.#logos = logos;
    this.#policy = policy;
    this.#clock = clock;
    this.#logger = logger;
    this.#contentFilter = contentFilter;
  }

  /**
   * @param {{ ratingKey: string }} input
   * @returns {Promise<{ ratingKey:string, provider:string, name:string, tier:string, source:string, rule:string|null, offerType:string|null, checkedAt:string|null }|null>}
   *   `source`: override | availability | fallback; `tier`: the priority group for
   *   an availability answer, else the source.
   */
  async execute({ ratingKey }) {
    const rk = String(ratingKey ?? '');
    if (!/^\d+$/.test(rk)) return null;
    const policy = this.#policy();
    if (policy.enabled === false) return null;
    const now = this.#clock();
    // Movies by default: other players (fitness, school, piano) also play Plex shows.
    const kinds = Array.isArray(policy.kinds) && policy.kinds.length ? policy.kinds : ['movie'];
    const rules = policy.rules || parseRules({ providers: policy.tiers });
    const canShow = (p) => this.#logos.has(p);

    // The title's facts, every play (rules read collections, studio, library...).
    // An episode or season answers as its show.
    let identity = await this.#identify(rk);
    let record = null;
    if (!identity) {
      // Media server unreachable: a cached record still answers from the offers.
      record = await this.#store.get(rk);
      if (!record) return null;
      identity = { key: record.key || rk, kind: record.kind, title: record.title ?? null, year: record.year ?? null };
    }
    if (!kinds.includes(identity.kind)) return null;
    const libraries = (policy.libraries || []).map((l) => String(l).toLowerCase());
    if (libraries.length && identity.library && !libraries.includes(String(identity.library).toLowerCase())) return null;

    const facts = {
      ...identity,
      contentFilterActive: needsContentFilter(rules) ? await this.#filterActive(rk) : false,
    };

    const override = firstRule(rules.overrides, facts, canShow);
    if (override) return this.#answer(rk, { provider: override.provider, source: 'override', rule: override.rule });

    const key = identity.key || rk;
    record ||= await this.#store.get(key);
    if (!record || !isFresh(record, now, policy.refreshDays)) {
      record = await this.#refresh(key, record, identity.imdb !== undefined ? identity : null, { ...policy, kinds }, now);
    }
    // The id comes from the name each time, so a stored record ranks by today's
    // mapping (a channel counts as the app it is watched in; older records carry
    // `provider: null`).
    const offers = (record?.offers || []).map((o) => (o?.name ? { ...o, provider: providerIdFor(o.name) ?? o.provider ?? null } : o));
    const ranked = rankOffers(offers, rules.priority, canShow);
    if (ranked) {
      return this.#answer(rk, {
        provider: ranked.offer.provider, source: 'availability', tier: ranked.group.name,
        name: ranked.offer.name, offerType: ranked.offer.type, checkedAt: record.checkedAt,
      });
    }

    const fallback = firstRule(rules.fallbacks, facts, canShow);
    if (fallback) return this.#answer(rk, { provider: fallback.provider, source: 'fallback', rule: fallback.rule, checkedAt: record?.checkedAt ?? null });
    return null;
  }

  #answer(rk, { provider, source, tier = null, rule = null, name = null, offerType = null, checkedAt = null }) {
    return {
      ratingKey: rk,
      provider,
      name: PROVIDER_NAMES[provider] || name || provider,
      tier: tier || source,
      source,
      rule: rule ? (rule.name || describeWhen(rule.when)) : null,
      offerType,
      checkedAt,
    };
  }

  async #filterActive(rk) {
    if (!this.#contentFilter) return false;
    try {
      return (await this.#contentFilter.isActive(rk)) === true;
    } catch (error) {
      this.#logger.warn?.('provenance.content-filter.read-failed', { ratingKey: rk, error: error?.message });
      return false;
    }
  }

  async #identify(rk) {
    try {
      return await this.#identityReader.identify(rk);
    } catch (error) {
      this.#logger.warn?.('provenance.identify.failed', { ratingKey: rk, error: error?.message });
      return null;
    }
  }

  /** One lookup per title at a time; concurrent plays share it. */
  #refresh(key, stale, identity, policy, now) {
    if (this.#inflight.has(key)) return this.#inflight.get(key);
    const p = this.#doRefresh(key, stale, identity, policy, now).finally(() => this.#inflight.delete(key));
    this.#inflight.set(key, p);
    return p;
  }

  async #doRefresh(key, stale, identity, policy, now) {
    if (!this.#availability) return stale;
    const id = identity && identity.key === key ? identity : await this.#identify(key);
    if (!id) return stale;
    // A kind the household does not show (a music track, an episode when only
    // movies are on) never spends a lookup; nothing is recorded for it either.
    if (!policy.kinds.includes(id.kind)) return stale;
    const lookupId = lookupIdFor(id);
    const base = { key, kind: id.kind, title: id.title ?? null, year: id.year ?? null, lookupId };
    if (!lookupId) {
      const record = { ...base, checkedAt: now.toISOString(), offers: [], note: 'no external id' };
      await this.#store.put(key, record);
      this.#logger.info?.('provenance.lookup.no-external-id', { ratingKey: key, title: base.title });
      return record;
    }
    const month = monthOf(now);
    if (!hasQuotaRoom(await this.#store.usage(), { month, reserve: policy.quotaReserve })) {
      this.#logger.warn?.('provenance.lookup.quota-reserved', { ratingKey: key, month });
      return stale;
    }
    const startedAt = Date.now();
    try {
      const { sources, quota, quotaUsed } = await this.#availability.sources(lookupId);
      const offers = streamingOffers(sources);
      const record = { ...base, checkedAt: now.toISOString(), offers };
      await this.#store.put(key, record, { month, quota, quotaUsed });
      this.#logger.info?.('provenance.lookup.done', {
        ratingKey: key, lookupId, title: base.title, offers: offers.length,
        providers: offers.map((o) => o.provider).filter(Boolean), quotaUsed, quota, elapsedMs: Date.now() - startedAt,
      });
      return record;
    } catch (error) {
      this.#logger.warn?.('provenance.lookup.failed', { ratingKey: key, lookupId, error: error?.message, status: error?.status ?? null });
      return stale;
    }
  }
}
