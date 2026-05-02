export class MediaSkill {
  static name = 'media';

  #contentQuery;
  #gateway;
  #logger;
  #config;

  #judge;

  constructor({ contentQuery, gateway, logger = console, config = {}, judge = null }) {
    if (!contentQuery) throw new Error('MediaSkill: contentQuery required');
    if (!gateway) throw new Error('MediaSkill: gateway required');
    if (!config?.ds_base_url || typeof config.ds_base_url !== 'string') {
      throw new Error(
        'MediaSkill: ds_base_url is required (the URL where this server is reachable ' +
        'from media-player devices on the LAN). Configure devices.yml.daylightHost.'
      );
    }
    this.#contentQuery = contentQuery;
    this.#gateway = gateway;
    this.#logger = logger;
    this.#config = {
      default_volume: 30,
      prefix_aliases: {},
      // Voice playback restricts the upstream search to a curated set of
      // sources / library sections so it never lands on photos, video shows,
      // audiobook chapter dumps, etc. Defaults below favour Plex audio
      // libraries (music, speech, ambient, etc.) and exclude Audiobooks.
      voice_sources: ['plex'],
      plex_library_ids: '5,10,11,16,18,19,21,22,23',
      ...config,
    };
    // Optional MediaJudge — when provided, called for ambiguous result sets to
    // pick the best candidate. When null, MediaSkill falls back to the default
    // pick (top of the rank-sorted list).
    this.#judge = judge;
  }

  get name() { return MediaSkill.name; }
  getConfig() { return { ...this.#config }; }

  getPromptFragment(_satellite) {
    return `## Media playback
You can play household media (music, playlists, podcasts, audiobooks, ambient sounds).
- Use \`play_media\` with a free-form query like "workout playlist" or "rain sounds".
- The media plays on the speaker associated with the calling satellite.
- If nothing matches, decline politely; do not invent titles.`;
  }

  getTools() {
    const cq = this.#contentQuery;
    const gw = this.#gateway;
    const cfg = this.#config;
    const log = this.#logger;
    const judge = this.#judge;

    return [
      {
        name: 'play_media',
        description: 'Search the household library and play the best match on the calling satellite.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Free-form description of what to play.' },
            media_class: {
              type: 'string',
              enum: ['music', 'playlist', 'podcast', 'audiobook', 'ambient', 'singalong', 'other'],
              description: 'Optional category hint.',
            },
          },
          required: ['query'],
        },
        async execute({ query, media_class }, ctx) {
          const satellite = ctx?.satellite;
          if (!satellite?.mediaPlayerEntity) return { ok: false, reason: 'no_media_player' };

          const start = Date.now();
          const attempts = [];

          // ── 1. Search (with one-shot retry on no_match using simplified query) ──
          let searchQuery = applyPrefix(query, media_class, cfg.prefix_aliases);
          let search = await voiceSearch(cq, searchQuery, cfg);
          attempts.push({ kind: 'search', query: searchQuery, count: search.items?.length ?? 0 });
          log.info?.('brain.skill.media.search', {
            query, media_class, search_query: searchQuery,
            result_count: search.items?.length ?? 0,
            sources_scoped: cfg.voice_sources,
            plex_library_ids: cfg.plex_library_ids,
            latencyMs: Date.now() - start,
          });

          if ((search.items?.length ?? 0) === 0) {
            const simplified = simplifyQuery(query);
            if (simplified && simplified !== searchQuery) {
              search = await voiceSearch(cq, simplified, cfg);
              attempts.push({ kind: 'retry', query: simplified, count: search.items?.length ?? 0 });
              log.info?.('brain.skill.media.search_retry', {
                original: query, simplified, result_count: search.items?.length ?? 0,
              });
            }
          }

          const items = search.items ?? [];
          const candidates = items.slice(0, 5).map((it) => ({
            id: it.id,
            source: it.source,
            title: it.title,
            mediaType: it.mediaType ?? it.metadata?.type ?? null,
            userRating: it.metadata?.userRating ?? it.metadata?.rating ?? null,
            playCount: it.metadata?.viewCount ?? it.metadata?.playCount ?? null,
          }));

          if (items.length === 0) {
            log.warn?.('brain.skill.media.no_match', { query, sources_tried: search.sources ?? [], attempts });
            return { ok: false, reason: 'no_match', query, attempts };
          }

          // ── 2. Pick the best candidate (judge if ambiguous, else top) ──
          let pickIndex = 0;
          let pickReason = 'top_of_rank';
          if (items.length > 1 && judge) {
            try {
              const judgement = await judge.pick({ query, candidates });
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

          // ── 3. Iterate-on-resolve: walk candidates from pickIndex outward ──
          const tryOrder = orderForResolve(items, pickIndex);
          let played = null;
          let lastFailReason = null;
          const resolveAttempts = [];

          for (const candidate of tryOrder) {
            const localId = candidate.localId ?? extractLocalId(candidate.id, candidate.source);
            try {
              const resolved = await cq.resolve(candidate.source, localId, {}, {});
              const audioPlayables = (resolved.items ?? []).filter(isAudioItem);
              const playable = audioPlayables[0];
              if (!playable) {
                resolveAttempts.push({ id: candidate.id, reason: 'no_audio_playable' });
                lastFailReason = 'no_audio_playable';
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
              query, candidates: candidates.map((c) => c.id), resolveAttempts,
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

          const { candidate: top, playable, localId } = played;
          const relative = playable.mediaUrl ?? `/api/v1/stream/${top.source}/${localId}`;
          const mediaUrl = absoluteUrl(cfg.ds_base_url, relative);
          const contentType = mapContentType(playable.metadata?.type ?? media_class ?? 'music');

          const playArgs = {
            entity_id: satellite.mediaPlayerEntity,
            media_content_id: mediaUrl,
            media_content_type: contentType,
          };
          const playResult = await gw.callService('media_player', 'play_media', playArgs);

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
        },
      },
    ];
  }
}

async function voiceSearch(cq, text, cfg) {
  const sources = Array.isArray(cfg?.voice_sources) ? cfg.voice_sources : [];
  // Single-source scoping if exactly one configured (most common: ['plex']).
  const sourceParam = sources.length === 1 ? sources[0] : undefined;
  const query = {
    text,
    take: 5,
    audioOnly: true,
    includeLeafTypes: true,
    rankBy: 'voice',
  };
  if (sourceParam) query.source = sourceParam;
  if (cfg?.plex_library_ids) query['plex.libraryId'] = cfg.plex_library_ids;
  return cq.search(query);
}

/**
 * Build the order to attempt resolves: start at the picked index, then walk
 * outward both directions so we try near-matches first.
 */
function orderForResolve(items, pickIndex) {
  const ordered = [items[pickIndex]];
  let left = pickIndex - 1;
  let right = pickIndex + 1;
  while (left >= 0 || right < items.length) {
    if (right < items.length) ordered.push(items[right++]);
    if (left >= 0) ordered.push(items[left--]);
  }
  return ordered;
}

/**
 * Trim a voice query to its "core" — drop "by ARTIST" suffix, leading/trailing
 * articles, common politeness words. Used as a single fallback when the
 * original query returns zero hits.
 */
function simplifyQuery(query) {
  if (!query || typeof query !== 'string') return null;
  let q = query.trim().toLowerCase();
  // strip "by ARTIST" / "from ARTIST"
  q = q.replace(/\s+(by|from)\s+.+$/i, '');
  // strip leading articles
  q = q.replace(/^(the|a|an)\s+/, '');
  // strip leading politeness
  q = q.replace(/^(please\s+|can you\s+|could you\s+|would you\s+)/, '');
  // strip trailing punctuation
  q = q.replace(/[.?!,]+$/, '').trim();
  return q.length >= 2 ? q : null;
}

function absoluteUrl(base, relativeOrAbsolute) {
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  const trimmedBase = base.replace(/\/$/, '');
  const path = relativeOrAbsolute.startsWith('/') ? relativeOrAbsolute : `/${relativeOrAbsolute}`;
  return `${trimmedBase}${path}`;
}

function applyPrefix(query, mediaClass, aliases) {
  const lc = String(query).trim().toLowerCase();
  for (const [k, v] of Object.entries(aliases)) {
    if (lc.includes(k)) return v;
  }
  if (mediaClass && !lc.includes(':')) return `${mediaClass}:${query}`;
  return query;
}

function extractLocalId(id, source) {
  if (typeof id === 'string' && id.startsWith(`${source}:`)) return id.slice(source.length + 1);
  return id;
}

function mapContentType(_t) {
  // Voice playback is audio-only — see isAudioItem. Always tell HA "music".
  return 'music';
}

function isAudioItem(item) {
  if (!item) return false;
  const blocked = new Set(['image', 'photo', 'video', 'dash_video', 'movie', 'episode', 'show']);
  const types = [item.mediaType, item.metadata?.type, item.type]
    .filter(v => typeof v === 'string')
    .map(v => v.toLowerCase());
  return !types.some(t => blocked.has(t));
}

export default MediaSkill;
