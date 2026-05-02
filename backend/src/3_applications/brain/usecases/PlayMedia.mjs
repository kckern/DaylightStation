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

  constructor({ search, resolve, filterPlayable, gateway, urlBuilder, judge = null, logger = console }) {
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

    const items = search.items ?? [];
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
    const tryOrder = orderForResolve(items, pickIndex);
    let played = null;
    let lastFailReason = null;
    const resolveAttempts = [];

    for (const candidate of tryOrder) {
      const localId = candidate.localId ?? extractLocalId(candidate.id, candidate.source);
      try {
        const resolved = await this.#resolve(candidate.source, localId);
        const playables = this.#filterPlayable(resolved.items ?? []);
        const playable = playables[0];
        if (!playable) {
          resolveAttempts.push({ id: candidate.id, reason: 'no_playable' });
          lastFailReason = 'no_playable';
          continue;
        }
        played = { candidate, playable, localId };
        resolveAttempts.push({ id: candidate.id, reason: 'ok' });
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

    // 5. Issue the play call.
    const { candidate: top, playable, localId } = played;
    const mediaUrl = this.#urlBuilder(playable, top.source, localId);
    const playArgs = {
      entity_id: satellite.mediaPlayerEntity,
      media_content_id: mediaUrl,
      media_content_type: contentType,
    };
    const playResult = await this.#gateway.callService('media_player', 'play_media', playArgs);

    log.info?.('brain.skill.media.play', {
      content_id: top.id,
      media_player: satellite.mediaPlayerEntity,
      media_url: mediaUrl,
      content_type: contentType,
      ok: !!playResult?.ok,
      ha_error: playResult?.error,
      pick_reason: pickReason,
      resolve_attempts: resolveAttempts.length,
    });

    return {
      ok: !!playResult?.ok,
      title: top.title,
      artist: top.metadata?.artist ?? top.metadata?.parentTitle ?? null,
      mediaPlayer: satellite.mediaPlayerEntity,
      mediaUrl,
      mediaContentType: contentType,
      sourceContentId: top.id,
      playableId: playable.id,
      playArgs,
      haResponse: playResult?.data ?? null,
      error: playResult?.error,
      candidates,
      resolveAttempts,
      pickReason,
      attempts,
    };
  }
}

// ── helpers ────────────────────────────────────────────────────────────────

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
