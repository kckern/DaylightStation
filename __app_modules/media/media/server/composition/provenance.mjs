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
import { WatchmodeAvailabilityGateway } from '../adapters/provenance/WatchmodeAvailabilityGateway.mjs';
import { PlexTitleIdentityReader } from '../adapters/provenance/PlexTitleIdentityReader.mjs';
import { YamlProvenanceStore } from '../adapters/provenance/YamlProvenanceStore.mjs';
import { FilesystemProviderLogoCatalog } from '../adapters/provenance/FilesystemProviderLogoCatalog.mjs';

const list = (v) => (Array.isArray(v) ? v.map(String) : []);

/** Household policy, with defaults for a missing or partial file. */
export function provenancePolicy(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const lookup = cfg.lookup && typeof cfg.lookup === 'object' ? cfg.lookup : {};
  const providers = cfg.providers && typeof cfg.providers === 'object' ? cfg.providers : {};
  return {
    enabled: cfg.enabled !== false,
    region: typeof lookup.region === 'string' ? lookup.region : 'US',
    refreshDays: Number.isFinite(lookup.refresh_days) ? lookup.refresh_days : 30,
    quotaReserve: Number.isFinite(lookup.quota_reserve) ? lookup.quota_reserve : 100,
    tiers: { free: list(providers.free), subscribed: list(providers.subscribed) },
    kinds: list(cfg.kinds).filter((k) => k === 'movie' || k === 'show'),
  };
}

export function createProvenanceRuntime({ configService, rootLogger, contentRegistry = null, peekPlaybackStart = null }) {
  const logger = rootLogger.child({ module: 'provenance' });
  const policy = () => provenancePolicy(configService.getHouseholdAppConfig(null, 'provenance'));
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
  });
  // peekPlaybackStart: the playback capability's read-only start position.
  return createProvenanceRouter({ getTitleProvenance, logos, peekPlaybackStart, logger });
}
