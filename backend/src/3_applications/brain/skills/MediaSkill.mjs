import { PlayMediaUseCase } from '../usecases/PlayMedia.mjs';

/**
 * MediaSkill — thin tool wrapper that exposes voice-driven media playback
 * to the brain agent. The actual orchestration (search → judge → resolve →
 * play) lives in PlayMediaUseCase. This file owns:
 *   - tool schema (what the LLM sees)
 *   - prompt fragment (how to describe the tool to the LLM)
 *   - composition: assemble the use case from injected primitives + config
 *   - URL building from configured ds_base_url
 *
 * All vendor-specific values (source names, library IDs, source-namespaced
 * query keys, ranking field names) come from the operator's brain.yml.
 * This file names no specific content sources — defaults are vendor-neutral.
 */

// ── Generic defaults (no vendor-specific values here) ─────────────────────

// Hard ceiling on queued items per container — caps a runaway artist queue.
const DEFAULT_MAX_QUEUE_SIZE = 50;

// Container types that shuffle by default. These names are domain-generic
// (artist/album/playlist exist as concepts across many media systems);
// operator can override per their adapter's vocabulary.
const DEFAULT_SHUFFLE_TYPES = ['artist', 'playlist', 'collection'];

// How many candidates to ask the search for. Operator-overridable.
const DEFAULT_VOICE_TAKE = 5;

export class MediaSkill {
  static name = 'media';

  #contentQuery;
  #gateway;
  #judge;
  #policyGate;
  #logger;
  #config;

  constructor({ contentQuery, gateway, logger = console, config = {}, judge = null, policyGate = null }) {
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
    // Optional MediaPolicyGate — when satellite has media_policy, this gate
    // applies library/label whitelisting. Pass-through if not provided.
    this.#policyGate = policyGate;
    // Defaults are vendor-neutral. All vendor specifics (source names,
    // library IDs, source-namespaced query keys, ranking field names) are
    // expected to come from brain.yml.media. Empty defaults mean no
    // restriction at this layer — the operator owns what gets applied.
    this.#config = {
      default_volume: 30,
      prefix_aliases: {},
      name_aliases: {},           // case-insensitive whole-string substitution map
      voice_sources: [],          // empty = no source restriction
      search_params: {},          // verbatim merged into cq.search (operator owns the keys)
      exclude_media_types: [],    // generic blocklist (item.mediaType / metadata.type)
      rank: null,                 // optional secondary rank: { factors: [{field,weight,normalize}] }
      shuffle_types: DEFAULT_SHUFFLE_TYPES,
      max_queue_size: DEFAULT_MAX_QUEUE_SIZE,
      take: DEFAULT_VOICE_TAKE,
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
          let normalisedQuery = applyPrefix(query, media_class, this.#config.prefix_aliases);
          normalisedQuery = applyNameAlias(normalisedQuery, this.#config.name_aliases);
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
      filterPlayable: async (items, satellite) => {
        // Two-stage filter: apply the operator-declared media-type blocklist
        // first (vendor-agnostic — every adapter exposes mediaType), then
        // apply the satellite's media_policy via the optional MediaPolicyGate.
        const blocked = excludeSet(cfg.exclude_media_types);
        const allowedTypes = blocked.size > 0
          ? items.filter(item => !itemHasBlockedType(item, blocked))
          : items;
        if (!this.#policyGate) return allowedTypes;
        return this.#policyGate.apply(allowedTypes, satellite);
      },
      gateway: this.#gateway,
      urlBuilder: (playable, source, localId) => {
        const relative = playable.mediaUrl ?? `/api/v1/stream/${source}/${localId}`;
        return absoluteUrl(cfg.ds_base_url, relative);
      },
      judge: this.#judge,
      logger: this.#logger,
      playbackPolicy: {
        shuffleTypes: cfg.shuffle_types,
        maxQueueSize: cfg.max_queue_size,
      },
    });
  }
}

// ── Local helpers (vendor-neutral) ────────────────────────────────────────

async function voiceSearch(cq, text, cfg) {
  // Build the query verbatim from operator config. The brain names no
  // specific source or library — operators populate brain.yml.media.
  const query = {
    text,
    take: cfg?.take ?? DEFAULT_VOICE_TAKE,
    ...(cfg?.search_params ?? {}),    // operator-declared keys (e.g. 'plex.libraryId', tier1AllowedTypes)
  };
  if (Array.isArray(cfg?.exclude_media_types) && cfg.exclude_media_types.length > 0) {
    query.excludeMediaTypes = cfg.exclude_media_types;
  }
  if (cfg?.rank?.factors?.length > 0) {
    query.rank = cfg.rank;
  }
  // Single configured source = pin to that source.
  const sources = Array.isArray(cfg?.voice_sources) ? cfg.voice_sources : [];
  if (sources.length === 1) query.source = sources[0];
  return cq.search(query);
}

function excludeSet(list) {
  if (!Array.isArray(list)) return new Set();
  return new Set(list.map(s => String(s).toLowerCase()));
}

function itemHasBlockedType(item, blockedSet) {
  if (!item) return false;
  const types = [item.mediaType, item.metadata?.type, item.type]
    .filter(v => typeof v === 'string')
    .map(v => v.toLowerCase());
  return types.some(t => blockedSet.has(t));
}

function applyPrefix(query, mediaClass, aliases) {
  const lc = String(query).trim().toLowerCase();
  for (const [k, v] of Object.entries(aliases)) {
    if (lc.includes(k)) return v;
  }
  if (mediaClass && !lc.includes(':')) return `${mediaClass}:${query}`;
  return query;
}

// Whole-string, case-insensitive substitution. Operator-curated map that
// normalises STT-flavored or simplified spellings to canonical search terms
// (e.g. 'beyonce' → 'Beyoncé') so the search backend's tokenizer can match.
// Compares trimmed/lowercased query against trimmed/lowercased keys; on hit,
// returns the alias VALUE verbatim (preserving its casing and any special
// characters). On miss, returns the input unchanged.
export function applyNameAlias(query, aliases) {
  if (!aliases || typeof aliases !== 'object') return query;
  const lc = String(query).trim().toLowerCase();
  for (const [k, v] of Object.entries(aliases)) {
    if (String(k).trim().toLowerCase() === lc) return v;
  }
  return query;
}

function absoluteUrl(base, relativeOrAbsolute) {
  if (/^https?:\/\//i.test(relativeOrAbsolute)) return relativeOrAbsolute;
  const trimmedBase = base.replace(/\/$/, '');
  const path = relativeOrAbsolute.startsWith('/') ? relativeOrAbsolute : `/${relativeOrAbsolute}`;
  return `${trimmedBase}${path}`;
}

export default MediaSkill;
