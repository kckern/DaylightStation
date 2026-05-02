import { PlayMediaUseCase } from '../usecases/PlayMedia.mjs';

/**
 * MediaSkill — thin tool wrapper that exposes voice-driven media playback
 * to the brain agent. The actual orchestration (search → judge → resolve →
 * play) lives in PlayMediaUseCase. This file owns:
 *   - voice playback policy (what types are voice-playable, ranking weights,
 *     which sources/library subsets to search)
 *   - tool schema (what the LLM sees)
 *   - prompt fragment (how to describe the tool to the LLM)
 *   - URL building from configured ds_base_url
 */

// ── Voice playback policy ─────────────────────────────────────────────────

// Block visual / long-form video types from voice playback.
const VOICE_EXCLUDE_MEDIA_TYPES = ['image', 'photo', 'video', 'dash_video', 'movie', 'episode', 'show'];

// Tier-1 default surfaces only containers; voice search needs individual
// tracks (and episodes) returned alongside containers so a song query can
// hit the song directly.
const VOICE_PLEX_TIER1_TYPES = ['show', 'movie', 'artist', 'album', 'collection', 'track', 'episode'];

// Secondary ranking factors applied after relevance sort.
const VOICE_RANK = {
  factors: [
    { field: 'metadata.userRating', weight: 0.7, normalize: 'div:10' },
    { field: 'metadata.viewCount',  weight: 0.3, normalize: 'log10:100' },
  ],
};

// Container types that should shuffle by default for voice playback.
// Albums play in order; artists / playlists / collections shuffle since
// playing them sequentially from track 1 is rarely what the user wants.
const VOICE_SHUFFLE_TYPES = ['artist', 'playlist', 'collection'];

// Hard ceiling on queued items per container — stops a 500-track artist
// from spamming HA with 500 service calls.
const VOICE_MAX_QUEUE_SIZE = 50;

export class MediaSkill {
  static name = 'media';

  #contentQuery;
  #gateway;
  #judge;
  #logger;
  #config;

  constructor({ contentQuery, gateway, logger = console, config = {}, judge = null }) {
    if (!contentQuery) throw new Error('MediaSkill: contentQuery required');
    if (!gateway) throw new Error('MediaSkill: gateway required');
    if (!config?.ds_base_url || typeof config.ds_base_url !== 'string') {
      throw new Error(
        'MediaSkill: ds_base_url is required (the URL where this server is reachable '
        + 'from media-player devices on the LAN). Configure devices.yml.daylightHost*.'
      );
    }
    this.#contentQuery = contentQuery;
    this.#gateway = gateway;
    this.#logger = logger;
    this.#judge = judge;
    this.#config = {
      default_volume: 30,
      prefix_aliases: {},
      voice_sources: ['plex'],
      // Default Plex audio libraries: music, children's music/stories,
      // speech, education, scripture, ambient, industrial, sound effects.
      // Excludes Audiobooks (id 9) by design — voice doesn't do long-form.
      plex_library_ids: '5,10,11,16,18,19,21,22,23',
      ...config,
    };
  }

  get name() { return MediaSkill.name; }
  getConfig() { return { ...this.#config }; }

  getPromptFragment(_satellite) {
    return `## Media playback
You can play household media (music, songs, podcasts, ambient sounds, lectures).
- Use \`play_media\` with a free-form query like "workout playlist" or "we built this city".
- The media plays on the speaker associated with the calling satellite.
- If nothing matches, decline politely; do not invent titles.`;
  }

  getTools() {
    const useCase = this.#buildUseCase();
    const log = this.#logger;

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
              enum: ['music', 'playlist', 'podcast', 'ambient', 'singalong', 'other'],
              description: 'Optional category hint.',
            },
          },
          required: ['query'],
        },
        execute: async ({ query, media_class }, ctx) => {
          const start = Date.now();
          const normalisedQuery = applyPrefix(query, media_class, this.#config.prefix_aliases);
          const result = await useCase.execute({
            query: normalisedQuery,
            satellite: ctx?.satellite,
            contentType: 'music',
          });
          log.info?.('brain.skill.media.tool_complete', {
            query, media_class, ok: result.ok,
            reason: result.reason,
            latencyMs: Date.now() - start,
          });
          return result;
        },
      },
    ];
  }

  // ── Composition: assemble the use case from injected primitives ────────

  #buildUseCase() {
    const cq = this.#contentQuery;
    const cfg = this.#config;
    return new PlayMediaUseCase({
      search: (text) => voiceSearch(cq, text, cfg),
      resolve: (source, localId) => cq.resolve(source, localId, {}, {}),
      filterPlayable: (items) => items.filter(isVoicePlayable),
      gateway: this.#gateway,
      urlBuilder: (playable, source, localId) => {
        const relative = playable.mediaUrl ?? `/api/v1/stream/${source}/${localId}`;
        return absoluteUrl(cfg.ds_base_url, relative);
      },
      judge: this.#judge,
      logger: this.#logger,
      playbackPolicy: {
        shuffleTypes: cfg.shuffle_types ?? VOICE_SHUFFLE_TYPES,
        maxQueueSize: cfg.max_queue_size ?? VOICE_MAX_QUEUE_SIZE,
      },
    });
  }
}

// ── Local helpers (voice-specific, kept here, not in CQS) ─────────────────

async function voiceSearch(cq, text, cfg) {
  const sources = Array.isArray(cfg?.voice_sources) ? cfg.voice_sources : [];
  const sourceParam = sources.length === 1 ? sources[0] : undefined;
  const query = {
    text,
    take: 5,
    excludeMediaTypes: VOICE_EXCLUDE_MEDIA_TYPES,
    tier1AllowedTypes: VOICE_PLEX_TIER1_TYPES,
    rank: VOICE_RANK,
  };
  if (sourceParam) query.source = sourceParam;
  if (cfg?.plex_library_ids) query['plex.libraryId'] = cfg.plex_library_ids;
  return cq.search(query);
}

function isVoicePlayable(item) {
  if (!item) return false;
  const blocked = new Set(VOICE_EXCLUDE_MEDIA_TYPES);
  const types = [item.mediaType, item.metadata?.type, item.type]
    .filter(v => typeof v === 'string')
    .map(v => v.toLowerCase());
  return !types.some(t => blocked.has(t));
}

function applyPrefix(query, mediaClass, aliases) {
  const lc = String(query).trim().toLowerCase();
  for (const [k, v] of Object.entries(aliases)) {
    if (lc.includes(k)) return v;
  }
  if (mediaClass && !lc.includes(':')) return `${mediaClass}:${query}`;
  return query;
}

function absoluteUrl(base, relativeOrAbsolute) {
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  const trimmedBase = base.replace(/\/$/, '');
  const path = relativeOrAbsolute.startsWith('/') ? relativeOrAbsolute : `/${relativeOrAbsolute}`;
  return `${trimmedBase}${path}`;
}

export default MediaSkill;
