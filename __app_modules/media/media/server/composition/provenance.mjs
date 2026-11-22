/**
 * Provenance runtime: which streaming service a title is "from", for the
 * Player's provenance bumper. Household policy (tiers, refresh) from
 * `household/media/provenance.yml`; availability cached on the media mount in
 * `media/content-providers/availability.yml`; logos from `content/providers/`;
 * the Watchmode key from system auth `watchmode.api_key`.
 *
 * Reference: __docs/reference/media/provenance.md
 */
import path from 'path';
import { createProvenanceRouter } from '../api/provenance.mjs';
import { GetTitleProvenance } from '../application/provenance/GetTitleProvenance.mjs';
import { DescribePlayStart } from '../application/provenance/DescribePlayStart.mjs';
import { WatchmodeAvailabilityGateway } from '../adapters/provenance/WatchmodeAvailabilityGateway.mjs';
import { PlexTitleIdentityReader } from '../adapters/provenance/PlexTitleIdentityReader.mjs';
import { YamlProvenanceStore } from '../adapters/provenance/YamlProvenanceStore.mjs';
import { FilesystemProviderLogoCatalog } from '../adapters/provenance/FilesystemProviderLogoCatalog.mjs';
import { parseRules } from '../domain/provenance/rules.mjs';
import { parseServices } from '../domain/provenance/provenance.mjs';

const list = (v) => (Array.isArray(v) ? v.map(String) : []);

/** Household policy, with defaults for a missing or partial file. */
export function provenancePolicy(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const lookup = cfg.lookup && typeof cfg.lookup === 'object' ? cfg.lookup : {};
  const providers = cfg.providers && typeof cfg.providers === 'object' ? cfg.providers : {};
  const scene = cfg.scene && typeof cfg.scene === 'object' ? cfg.scene : {};
  return {
    enabled: cfg.enabled !== false,
    region: typeof lookup.region === 'string' ? lookup.region : 'US',
    refreshDays: Number.isFinite(lookup.refresh_days) ? lookup.refresh_days : 30,
    quotaReserve: Number.isFinite(lookup.quota_reserve) ? lookup.quota_reserve : 100,
    tiers: { free: list(providers.free), subscribed: list(providers.subscribed) },
    kinds: list(cfg.kinds).filter((k) => k === 'movie' || k === 'show'),
    // Plex libraries in scope (by name); empty = any library.
    libraries: list(cfg.libraries),
    // overrides > priority > fallbacks (domain/provenance/rules.mjs).
    rules: parseRules(cfg),
    // How the availability service's names become provider ids, and their labels.
    services: parseServices(cfg.services),
    // A resume after this long away still opens with the scene.
    resumeAfterHours: Number.isFinite(scene.resume_after_hours) ? scene.resume_after_hours : 6,
  };
}

/**
 * @param {object} deps
 * @param {{ isActive(ratingKey:string): Promise<boolean> }|null} [deps.contentFilter] - the content filter's status (for `content_filter` rules)
 */
export function createProvenanceRuntime({ configService, rootLogger, contentRegistry = null, peekPlaybackStart = null, contentFilter = null }) {
  const logger = rootLogger.child({ module: 'provenance' });
  const warned = new Set();
  const policy = () => {
    const p = provenancePolicy(configService.getHouseholdAppConfig(null, 'provenance'));
    for (const bad of p.services.invalid) {
      const id = `${bad.provider}:${bad.match}`;
      if (!warned.has(id)) { warned.add(id); logger.warn('provenance.config.bad-match', bad); }
    }
    return p;
  };
  const apiKey = configService.getSystemAuth?.('watchmode', 'api_key') || null;
  const plexClient = contentRegistry?.get?.('plex')?.client || null;
  const logos = new FilesystemProviderLogoCatalog({ dir: path.join(configService.getDataDir(), 'content', 'providers') });

  if (!apiKey) logger.warn('provenance.disabled', { reason: 'no watchmode api_key in system auth' });
  if (!plexClient) logger.warn('provenance.disabled', { reason: 'no plex client' });

  const getTitleProvenance = new GetTitleProvenance({
    identityReader: plexClient
      ? new PlexTitleIdentityReader({ plexClient })
      : { identify: async () => null },
    availability: apiKey ? new WatchmodeAvailabilityGateway({ apiKey, region: policy().region }) : null,
    store: new YamlProvenanceStore({ mediaDir: configService.getMediaDir() }),
    logos,
    policy,
    logger,
    contentFilter,
  });
  // peekPlaybackStart: the playback capability's read-only start position.
  const describePlayStart = new DescribePlayStart({
    peekPlaybackStart, logger, resumeAfterHours: () => policy().resumeAfterHours,
  });
  return createProvenanceRouter({ getTitleProvenance, logos, describePlayStart, logger });
}
