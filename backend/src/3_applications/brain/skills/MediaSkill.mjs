export class MediaSkill {
  static name = 'media';

  #contentQuery;
  #gateway;
  #logger;
  #config;

  constructor({ contentQuery, gateway, logger = console, config = {} }) {
    if (!contentQuery) throw new Error('MediaSkill: contentQuery required');
    if (!gateway) throw new Error('MediaSkill: gateway required');
    this.#contentQuery = contentQuery;
    this.#gateway = gateway;
    this.#logger = logger;
    this.#config = {
      default_volume: 30,
      prefix_aliases: {},
      ds_base_url: 'http://10.0.0.5:3111',
      ...config,
    };
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

          const text = applyPrefix(query, media_class, cfg.prefix_aliases);
          const start = Date.now();
          const search = await cq.search({ text, take: 5 });
          log.info?.('brain.skill.media.search', {
            query,
            media_class,
            result_count: search.items?.length ?? 0,
            latencyMs: Date.now() - start,
          });

          const top = search.items?.[0];
          if (!top) {
            log.warn?.('brain.skill.media.no_match', { query, sources_tried: search.sources ?? [] });
            return { ok: false, reason: 'no_match', query };
          }

          const localId = top.localId ?? extractLocalId(top.id, top.source);
          const resolved = await cq.resolve(top.source, localId, {}, {});
          const playable = resolved.items?.[0];
          if (!playable) return { ok: false, reason: 'no_playable', source: top.source };

          const relative = playable.mediaUrl ?? `/api/v1/stream/${top.source}/${localId}`;
          const mediaUrl = absoluteUrl(cfg.ds_base_url, relative);
          const contentType = mapContentType(playable.metadata?.type ?? media_class ?? 'music');

          const playResult = await gw.callService('media_player', 'play_media', {
            entity_id: satellite.mediaPlayerEntity,
            media_content_id: mediaUrl,
            media_content_type: contentType,
          });

          log.info?.('brain.skill.media.play', {
            content_id: top.id,
            media_player: satellite.mediaPlayerEntity,
            ok: !!playResult?.ok,
          });

          return {
            ok: !!playResult?.ok,
            title: top.title,
            artist: top.metadata?.artist ?? null,
            mediaPlayer: satellite.mediaPlayerEntity,
            error: playResult?.error,
          };
        },
      },
    ];
  }
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

function mapContentType(t) {
  switch (t) {
    case 'video':
    case 'dash_video':
      return 'video';
    default:
      return 'music';
  }
}

export default MediaSkill;
