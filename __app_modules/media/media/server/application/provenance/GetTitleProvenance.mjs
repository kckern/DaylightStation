/**
 * GetTitleProvenance — the streaming service a household title is shown as
 * coming from, for the provenance bumper. Looks the title up on demand (when it
 * is about to play), never in a library sweep: the availability service allows a
 * limited number of calls a month.
 *
 * Returns null whenever nothing is confirmed (no external id, found nowhere,
 * lookup failed, allowance used up); the player then shows no bumper.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import {
  chooseProvider, isFresh, lookupIdFor, streamingOffers, hasQuotaRoom,
} from '../../domain/provenance/provenance.mjs';

const monthOf = (d) => d.toISOString().slice(0, 7);

export class GetTitleProvenance {
  #identityReader; #availability; #store; #logos; #policy; #clock; #logger;
  #inflight = new Map();

  /**
   * @param {object} deps
   * @param {import('./ports/ITitleIdentityReader.mjs').ITitleIdentityReader} deps.identityReader
   * @param {import('./ports/IStreamingAvailabilityGateway.mjs').IStreamingAvailabilityGateway|null} deps.availability - null when no API key
   * @param {import('./ports/IProvenanceStore.mjs').IProvenanceStore} deps.store
   * @param {import('./ports/IProviderLogoCatalog.mjs').IProviderLogoCatalog} deps.logos
   * @param {() => {tiers:{free:string[],subscribed:string[]}, refreshDays:number, quotaReserve:number, enabled:boolean, kinds?:string[]}} deps.policy
   * @param {() => Date} [deps.clock]
   */
  constructor({ identityReader, availability, store, logos, policy, clock = () => new Date(), logger = console }) {
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
  }

  /**
   * @param {{ ratingKey: string }} input
   * @returns {Promise<{ ratingKey:string, provider:string, name:string, tier:string, offerType:string, checkedAt:string }|null>}
   */
  async execute({ ratingKey }) {
    const rk = String(ratingKey ?? '');
    if (!/^\d+$/.test(rk)) return null;
    const policy = this.#policy();
    if (policy.enabled === false) return null;
    const now = this.#clock();

    // Movies by default: other players (fitness, school, piano) also play Plex shows.
    const kinds = Array.isArray(policy.kinds) && policy.kinds.length ? policy.kinds : ['movie'];

    let record = await this.#store.get(rk);
    if (!record || !isFresh(record, now, policy.refreshDays)) {
      // An episode or season is recorded under its show.
      const identity = record?.key ? null : await this.#identify(rk);
      const key = record?.key || identity?.key || rk;
      if (key !== rk) record = await this.#store.get(key);
      if (!record || !isFresh(record, now, policy.refreshDays)) {
        record = await this.#refresh(key, record, identity, { ...policy, kinds }, now);
      }
    }
    if (!record) return null;
    if (!kinds.includes(record.kind)) return null;

    const choice = chooseProvider(record.offers, policy.tiers, (p) => this.#logos.has(p));
    if (!choice) return null;
    return { ratingKey: rk, provider: choice.provider, name: choice.name, tier: choice.tier, offerType: choice.offerType, checkedAt: record.checkedAt };
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
