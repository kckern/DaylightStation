/**
 * GetTitleProvenance — the service a household title is shown as coming from,
 * for the provenance scene, decided by the household's rules
 * (domain/provenance/rules.mjs, configured in the household's provenance.yml):
 *
 *   1. overrides  (the title's facts: content filter on, collection, studio...)
 *   2. priority   (the availability service's offers, by provider group)
 *   3. fallbacks  (year, length, library, studio, then usually "always"); a
 *                 fallback with `judge: true` asks the decision model (Jev) to
 *                 pick from the config's `judge.choices` at that point, and the
 *                 pick is stored with the title so it is asked once
 *
 * The title's facts come from the media server on every play. Availability is
 * looked up on demand (when a title is about to play), never in a library
 * sweep: the service allows a limited number of calls a month. An override
 * that matches spends no lookup.
 *
 * Returns null when no rule names a service with a logo, or the title is out
 * of scope (kind, library); the player then shows no scene.
 *
 * A live channel (`contentId` whose source is listed in the policy's `live`
 * block, e.g. `plex-live:nfl-channel`) skips all of that: it answers with the
 * block's one provider, no facts read and no lookup spent.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import {
  isFresh, lookupIdFor, streamingOffers, hasQuotaRoom, providerIdFor, providerLabel,
} from '../../domain/provenance/provenance.mjs';
import {
  firstRule, rankOffers, needsContentFilter, parseRules, secondaryLogosFor, matchesWhen, pickProvider, judgeState,
} from '../../domain/provenance/rules.mjs';
import { choice } from '#apps/common/ports/IDecisionGateway.mjs';

const monthOf = (d) => d.toISOString().slice(0, 7);

/** A rule's `when`, as a short label for logs ("collection=<name>"). */
function describeWhen(when = {}) {
  if (when.always) return 'always';
  return Object.entries(when).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join('|') : v}`).join(',') || 'always';
}

export class GetTitleProvenance {
  #identityReader; #availability; #store; #logos; #policy; #clock; #logger; #contentFilter; #decisions;
  #inflight = new Map();

  /**
   * @param {object} deps
   * @param {import('./ports/ITitleIdentityReader.mjs').ITitleIdentityReader} deps.identityReader
   * @param {import('./ports/IStreamingAvailabilityGateway.mjs').IStreamingAvailabilityGateway|null} deps.availability - null when no API key
   * @param {import('./ports/IProvenanceStore.mjs').IProvenanceStore} deps.store
   * @param {import('./ports/IProviderLogoCatalog.mjs').IProviderLogoCatalog} deps.logos
   * @param {() => {tiers:{free:string[],subscribed:string[]}, services?:object, refreshDays:number, quotaReserve:number, enabled:boolean, kinds?:string[]}} deps.policy
   * @param {() => Date} [deps.clock]
   * @param {{ isActive(ratingKey:string): Promise<boolean> }|null} [deps.contentFilter] - asked only when a rule uses `content_filter`
   */
  constructor({ identityReader, availability, store, logos, policy, clock = () => new Date(), logger = console, contentFilter = null, decisions = null }) {
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
    // IDecisionGateway (Jev), for `judge` fallbacks; none = those rules are skipped.
    this.#decisions = decisions?.isConfigured?.() ? decisions : null;
  }

  /**
   * @param {{ ratingKey?: string, contentId?: string }} input - a media-server
   *   rating key, or a live channel's `<source>:<channel>` content id
   * @returns {Promise<{ ratingKey:string, provider:string, name:string, tier:string, source:string, rule:string|null, offerType:string|null, checkedAt:string|null }|null>}
   *   `source`: override | availability | judge | fallback; `tier`: the priority group for
   *   an availability answer, else the source.
   */
  async execute({ ratingKey, contentId }) {
    if (contentId != null) return this.#live(String(contentId));
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
    if (override) return this.#answer(rk, policy, { provider: override.provider, source: 'override', rule: override.rule });

    const key = identity.key || rk;
    record ||= await this.#store.get(key);
    if (!record || !isFresh(record, now, policy.refreshDays)) {
      record = await this.#refresh(key, record, identity.imdb !== undefined ? identity : null, { ...policy, kinds }, now);
    }
    // The id comes from the name each time, by the config's service map, so a
    // stored record ranks by today's map (older records carry `provider: null`).
    const services = policy.services;
    const offers = (record?.offers || []).map((o) => (o?.name ? { ...o, provider: providerIdFor(o.name, services) } : o));
    const ranked = rankOffers(offers, rules.priority, canShow);
    if (ranked) {
      return this.#answer(rk, policy, {
        provider: ranked.offer.provider, source: 'availability', tier: ranked.group.name,
        name: ranked.offer.name, offerType: ranked.offer.type, checkedAt: record.checkedAt,
      });
    }

    // Fallbacks in order; a judge rule asks the decision model at its place.
    for (const rule of rules.fallbacks || []) {
      if (!matchesWhen(rule.when, facts)) continue;
      if (rule.judge) {
        const picked = await this.#judge(rk, key, record, facts, policy, canShow);
        if (picked) return this.#answer(rk, policy, { provider: picked, source: 'judge', rule, checkedAt: record?.checkedAt ?? null });
        continue;
      }
      const provider = pickProvider(rule, facts.key, canShow);
      if (provider) return this.#answer(rk, policy, { provider, source: 'fallback', rule, checkedAt: record?.checkedAt ?? null });
    }
    return null;
  }

  /** A live channel: the policy's `live` provider, when the source is listed and its logo exists. */
  #live(contentId) {
    const match = /^([a-z0-9-]+):([a-z0-9-]+)$/.exec(contentId);
    if (!match) return null;
    const policy = this.#policy();
    if (policy.enabled === false) return null;
    const live = policy.live;
    if (!live || !live.sources.includes(match[1])) return null;
    if (!this.#logos.has(live.provider)) {
      this.#logger.warn?.('provenance.live.no-logo', { contentId, provider: live.provider });
      return null;
    }
    return this.#answer(contentId, policy, { provider: live.provider, source: 'live', name: live.label });
  }

  #answer(rk, policy, { provider, source, tier = null, rule = null, name = null, offerType = null, checkedAt = null }) {
    const services = policy.services;
    // Smaller logos under the service's (config `secondary_logos`), those whose file exists.
    const secondary = secondaryLogosFor(provider, policy.secondary, services, (id) => this.#logos.has(id));
    return {
      ratingKey: rk,
      provider,
      name: providerLabel(provider, services, name),
      // The scene's line colour (config `services[].accent`), null = default.
      accent: services?.accents?.[provider] ?? null,
      secondary: secondary.map((s) => ({ logo: s.logo, name: s.label })),
      tier: tier || source,
      source,
      rule: rule ? (rule.name || describeWhen(rule.when)) : null,
      offerType,
      checkedAt,
    };
  }

  /**
   * The decision model's pick for a title, or null (none configured, under
   * `min_confidence`, failed, or not one of the showable choices). A pick is
   * stored on the title's record with the brief's signature and reused until
   * the brief changes; an unsure answer is stored too, so it is not re-asked.
   */
  async #judge(rk, key, record, facts, policy, canShow) {
    const brief = policy.judge;
    if (!brief || !this.#decisions) return null;
    const options = brief.choices.filter((c) => canShow(c.provider));
    if (options.length < 2) return null;
    const usable = (p) => !!p && options.some((c) => c.provider === p);
    const stored = record?.judged;
    if (stored && stored.signature === brief.signature) {
      return usable(stored.provider) ? stored.provider : null;
    }
    const startedAt = Date.now();
    let answer;
    let model = null;
    try {
      const result = await this.#decisions.evaluate(
        judgeState(facts),
        { service: choice(brief.instructions, Object.fromEntries(options.map((c) => [c.provider, c.description]))) },
        { timeout: brief.timeoutMs },
      );
      answer = result?.answers?.service;
      model = result?.model ?? null;
    } catch (error) {
      this.#logger.warn?.('provenance.judge.failed', { ratingKey: rk, title: facts.title, error: error?.message, elapsedMs: Date.now() - startedAt });
      return null;
    }
    const confidence = Number.isFinite(answer?.confidence) ? +answer.confidence.toFixed(3) : 0;
    const sure = usable(answer?.choice) && confidence >= brief.minConfidence;
    this.#logger.info?.('provenance.judge.decided', {
      ratingKey: rk, title: facts.title, choice: answer?.choice ?? null, confidence, used: sure, model, elapsedMs: Date.now() - startedAt,
    });
    if (record) {
      const judged = { provider: sure ? answer.choice : null, choice: answer?.choice ?? null, confidence, model, signature: brief.signature, at: this.#clock().toISOString() };
      try {
        await this.#store.put(key, { ...record, judged });
      } catch (error) {
        this.#logger.warn?.('provenance.judge.store-failed', { ratingKey: rk, error: error?.message });
      }
    }
    return sure ? answer.choice : null;
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
      const record = { ...base, checkedAt: now.toISOString(), offers: [], note: 'no external id', ...(stale?.judged ? { judged: stale.judged } : {}) };
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
      const offers = streamingOffers(sources, policy.services);
      const record = { ...base, checkedAt: now.toISOString(), offers, ...(stale?.judged ? { judged: stale.judged } : {}) };
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
