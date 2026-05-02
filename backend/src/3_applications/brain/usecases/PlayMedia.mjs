/**
 * PlayMediaUseCase — orchestrates the full voice-playback flow.
 *
 * Flow:
 *   1. Search the curated voice content surface (caller injects the search fn
 *      so this use case stays decoupled from ContentQueryService specifics).
 *   2. If no hits, retry once with a simplified query.
 *   3. Pick the best candidate. With multiple, defer to the judge; otherwise
 *      take the top of rank. Judge failures fall back to the top of rank.
 *   4. Walk candidates from the picked index outward, attempting to resolve()
 *      each into a playable audio URL — keeps trying until one works.
 *   5. Tell the gateway to play it on the satellite's media player.
 *
 * Returns a structured result the caller can include verbatim in a tool result.
 *
 * Dependencies are abstract — caller injects:
 *   - search(text): Promise<{items: Array}>
 *   - resolve(source, localId): Promise<{items: Array}>
 *   - filterPlayable(items): Array          // domain filter: which items are playable here
 *   - gateway: { callService(domain, service, data) }
 *   - urlBuilder(playable, source, localId): string  // builds the final media URL
 *   - judge?: { pick({query, candidates}): Promise<{index, reason, latencyMs}> }
 *   - logger
 */
export class PlayMediaUseCase {
  #search;
  #resolve;
  #filterPlayable;
  #gateway;
  #urlBuilder;
  #judge;
  #logger;
  #playbackPolicy;

  constructor({
    search,
    resolve,
    filterPlayable,
    gateway,
    urlBuilder,
    judge = null,
    logger = console,
    playbackPolicy = {},
  }) {
    if (typeof search !== 'function') throw new Error('PlayMediaUseCase: search(text) required');
    if (typeof resolve !== 'function') throw new Error('PlayMediaUseCase: resolve(source, localId) required');
    if (typeof filterPlayable !== 'function') throw new Error('PlayMediaUseCase: filterPlayable(items) required');
    if (!gateway?.callService) throw new Error('PlayMediaUseCase: gateway with callService required');
    if (typeof urlBuilder !== 'function') throw new Error('PlayMediaUseCase: urlBuilder required');
    this.#search = search;
    this.#resolve = resolve;
    this.#filterPlayable = filterPlayable;
    this.#gateway = gateway;
    this.#urlBuilder = urlBuilder;
    this.#judge = judge;
    this.#logger = logger;
    // Caller declares which resolved-container types should shuffle.
    // Defaults are intentionally conservative — caller should override.
    this.#playbackPolicy = {
      shuffleTypes: new Set(['artist', 'playlist', 'collection']),
      maxQueueSize: 50,
      ...playbackPolicy,
      shuffleTypes: new Set(playbackPolicy?.shuffleTypes ?? ['artist', 'playlist', 'collection']),
    };
  }

  /**
   * @param {Object} input
   * @param {string} input.query       - User's spoken request (already normalised)
   * @param {Object} input.satellite   - Satellite (must expose mediaPlayerEntity)
   * @param {string} [input.contentType='music']
   * @returns {Promise<PlayResult>}
   */
  async execute({ query, satellite, contentType = 'music' }) {
    if (!satellite?.mediaPlayerEntity) {
      return { ok: false, reason: 'no_media_player' };
    }
    const log = this.#logger;
    const attempts = [];

    // 1+2. Search with one-shot retry on no-match.
    let search = await this.#search(query);
    attempts.push({ kind: 'search', query, count: search.items?.length ?? 0 });

    if ((search.items?.length ?? 0) === 0) {
      const simplified = simplifyQuery(query);
      if (simplified && simplified !== query) {
        search = await this.#search(simplified);
        attempts.push({ kind: 'retry', query: simplified, count: search.items?.length ?? 0 });
        log.info?.('brain.skill.media.search_retry', {
          original: query, simplified, result_count: search.items?.length ?? 0,
        });
      }
    }

    let items = search.items ?? [];

    // 2.5. If we got results but NO container types AND the original query has
    // a compound-word pattern (e.g. "BabyJoyJoy" or "MotherGoose"), retry once
    // with the normalized spelling and merge. Plex's hub-search tokenizer
    // doesn't split compound words, so artist/album hubs come back empty;
    // the spaced variant lets it match. Cheap — only fires when results
    // already look weak.
    if (items.length > 0 && !items.some(isContainerCandidate)) {
      const split = splitCompoundWords(query);
      if (split && split !== query) {
        const extra = await this.#search(split);
        const extraItems = extra.items ?? [];
        if (extraItems.length > 0) {
          const seen = new Set(extraItems.map((i) => i.id));
          // New (better) results first; original results filtered to dedupe.
          items = [...extraItems, ...items.filter((i) => !seen.has(i.id))];
          attempts.push({ kind: 'compound_split', query: split, count: extraItems.length });
          log.info?.('brain.skill.media.compound_split', {
            original: query, split, added: extraItems.length, total: items.length,
          });
        }
      }
    }

    const candidates = items.slice(0, 5).map(toCandidateView);

    if (items.length === 0) {
      log.warn?.('brain.skill.media.no_match', { query, attempts });
      return { ok: false, reason: 'no_match', query, attempts };
    }

    // 3. Pick the best candidate.
    let pickIndex = 0;
    let pickReason = 'top_of_rank';
    if (items.length > 1 && this.#judge) {
      try {
        const judgement = await this.#judge.pick({ query, candidates });
        if (judgement?.index >= 0 && judgement.index < candidates.length) {
          pickIndex = judgement.index;
          pickReason = `judge:${judgement.reason ?? 'no_reason'}`;
          log.info?.('brain.skill.media.judge', {
            query, picked_id: candidates[pickIndex].id,
            reason: judgement.reason, latencyMs: judgement.latencyMs,
          });
        }
      } catch (err) {
        log.warn?.('brain.skill.media.judge_failed', { error: err.message });
      }
    }

    // 4. Walk candidates from pickIndex outward, attempting to resolve each.
    //    For container candidates (artist/album/playlist/collection) we keep
    //    ALL playables — sequence assembled below. For leaf candidates we just
    //    take the first.
    const tryOrder = orderForResolve(items, pickIndex);
    let played = null;
    let lastFailReason = null;
    const resolveAttempts = [];

    for (const candidate of tryOrder) {
      const localId = candidate.localId ?? extractLocalId(candidate.id, candidate.source);
      try {
        const resolved = await this.#resolve(candidate.source, localId);
        const playables = this.#filterPlayable(resolved.items ?? []);
        if (playables.length === 0) {
          resolveAttempts.push({ id: candidate.id, reason: 'no_playable' });
          lastFailReason = 'no_playable';
          continue;
        }
        played = { candidate, playables, localId };
        resolveAttempts.push({ id: candidate.id, reason: 'ok', count: playables.length });
        break;
      } catch (err) {
        resolveAttempts.push({ id: candidate.id, reason: 'error', error: err.message });
        lastFailReason = `error:${err.message}`;
      }
    }

    if (!played) {
      log.warn?.('brain.skill.media.all_resolve_failed', {
        query, candidates: candidates.map(c => c.id), resolveAttempts,
      });
      return {
        ok: false,
        reason: lastFailReason ?? 'no_resolvable_audio',
        query,
        candidates,
        resolveAttempts,
        attempts,
      };
    }

    // 5. Build play sequence based on candidate type. Containers expand to
    //    multiple tracks; shuffle is applied per the playback policy.
    const { candidate: top, playables, localId } = played;
    const candidateType = (top.mediaType ?? top.metadata?.type ?? '').toLowerCase();
    const isContainer = playables.length > 1 || CONTAINER_TYPES.has(candidateType);
    let sequence = playables.slice();
    let shuffled = false;
    if (isContainer && this.#playbackPolicy.shuffleTypes.has(candidateType)) {
      sequence = shuffleArray(sequence);
      shuffled = true;
    }
    if (sequence.length > this.#playbackPolicy.maxQueueSize) {
      sequence = sequence.slice(0, this.#playbackPolicy.maxQueueSize);
    }

    // 6. Play the sequence via HA. First item starts immediately (`enqueue:'play'`),
    //    rest are appended (`enqueue:'add'`). If the puck's media_player ignores
    //    enqueue, only the first track plays — failure is silent at HA level
    //    but we log the queue attempt so it's auditable.
    const queueResults = [];
    let firstPlayResult = null;
    for (let i = 0; i < sequence.length; i++) {
      const playable = sequence[i];
      const itemUrl = this.#urlBuilder(playable, top.source, playable.localId ?? localId);
      const enqueue = i === 0 ? 'play' : 'add';
      const args = {
        entity_id: satellite.mediaPlayerEntity,
        media_content_id: itemUrl,
        media_content_type: contentType,
        enqueue,
      };
      const result = await this.#gateway.callService('media_player', 'play_media', args);
      queueResults.push({ id: playable.id, ok: !!result?.ok, enqueue, error: result?.error });
      if (i === 0) firstPlayResult = result;
      if (i === 0 && !result?.ok) break; // first call failed — don't bother queueing the rest
    }

    log.info?.('brain.skill.media.play', {
      content_id: top.id,
      media_player: satellite.mediaPlayerEntity,
      first_url: queueResults[0]?.ok != null ? sequence[0]?.mediaUrl : null,
      content_type: contentType,
      ok: !!firstPlayResult?.ok,
      ha_error: firstPlayResult?.error,
      pick_reason: pickReason,
      candidate_type: candidateType,
      sequence_length: sequence.length,
      shuffled,
      resolve_attempts: resolveAttempts.length,
    });

    const firstPlayable = sequence[0];
    return {
      ok: !!firstPlayResult?.ok,
      title: top.title,
      artist: top.metadata?.artist ?? top.metadata?.parentTitle ?? null,
      mediaPlayer: satellite.mediaPlayerEntity,
      mediaUrl: this.#urlBuilder(firstPlayable, top.source, firstPlayable.localId ?? localId),
      mediaContentType: contentType,
      sourceContentId: top.id,
      candidateType,
      playableId: firstPlayable.id,
      sequenceLength: sequence.length,
      shuffled,
      queueResults,
      haResponse: firstPlayResult?.data ?? null,
      error: firstPlayResult?.error,
      candidates,
      resolveAttempts,
      pickReason,
      attempts,
    };
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

// Item types treated as containers (resolve to multiple playables).
const CONTAINER_TYPES = new Set(['artist', 'album', 'playlist', 'collection', 'show', 'season']);

/**
 * Fisher-Yates shuffle, returns a new array.
 */
export function shuffleArray(arr) {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function toCandidateView(it) {
  return {
    id: it.id,
    source: it.source,
    title: it.title,
    mediaType: it.mediaType ?? it.metadata?.type ?? null,
    userRating: it.metadata?.userRating ?? it.metadata?.rating ?? null,
    playCount: it.metadata?.viewCount ?? it.metadata?.playCount ?? null,
  };
}

/**
 * Order: start at picked index, then walk outward both directions.
 * Tries near-matches before far ones.
 */
export function orderForResolve(items, pickIndex) {
  if (!Array.isArray(items) || items.length === 0) return [];
  const i = Math.max(0, Math.min(pickIndex, items.length - 1));
  const ordered = [items[i]];
  let left = i - 1;
  let right = i + 1;
  while (left >= 0 || right < items.length) {
    if (right < items.length) ordered.push(items[right++]);
    if (left >= 0) ordered.push(items[left--]);
  }
  return ordered;
}

/**
 * Insert spaces at compound-word boundaries so Plex's hub-search tokenizer
 * can match. Catches two patterns:
 *   1. CamelCase: "MotherGoose" → "Mother Goose"
 *   2. Repeated subsequence (≥3 char): "JoyJoy" → "Joy Joy", "ABCABCABC" → "ABC ABC ABC"
 *
 * Returns null if the query unchanged after normalization (no compound pattern
 * detected) — caller uses null to skip retry.
 */
export function splitCompoundWords(query) {
  if (!query || typeof query !== 'string') return null;
  let q = query;
  // CamelCase boundary
  q = q.replace(/([a-z])([A-Z])/g, '$1 $2');
  // Repeated 3+-char subsequence — split into N space-separated copies.
  q = q.replace(/\b(\w{3,})\1+\b/g, (match, sub) => {
    const count = match.length / sub.length;
    return Array.from({ length: count }, () => sub).join(' ');
  });
  q = q.trim();
  return q === query.trim() ? null : q;
}

function isContainerCandidate(item) {
  const t = (item?.mediaType ?? item?.metadata?.type ?? '').toLowerCase();
  return CONTAINER_TYPES.has(t);
}

/**
 * Strip a voice query to its "core" — drop "by ARTIST" suffix, leading
 * articles, common politeness words. Used as a single fallback when the
 * original query returns zero hits. Returns null if too short to retry.
 */
export function simplifyQuery(query) {
  if (!query || typeof query !== 'string') return null;
  let q = query.trim().toLowerCase();
  q = q.replace(/\s+(by|from)\s+.+$/i, '');
  q = q.replace(/^(the|a|an)\s+/, '');
  q = q.replace(/^(please\s+|can you\s+|could you\s+|would you\s+)/, '');
  q = q.replace(/[.?!,]+$/, '').trim();
  return q.length >= 2 ? q : null;
}

function extractLocalId(id, source) {
  if (typeof id === 'string' && id.startsWith(`${source}:`)) return id.slice(source.length + 1);
  return id;
}

export default PlayMediaUseCase;
