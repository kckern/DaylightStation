import { IPlaybackStreamGateway } from '#apps/proxy/ports/IPlaybackStreamGateway.mjs';

/** Registry-backed playback URL gateway with existing mint telemetry. */
export class RegistryPlaybackStreamGateway extends IPlaybackStreamGateway {
  #registry;
  #logger;

  constructor({ registry, logger = console } = {}) {
    super();
    if (!registry || typeof registry.get !== 'function') {
      throw new Error('RegistryPlaybackStreamGateway requires registry');
    }
    this.#registry = registry;
    this.#logger = logger;
  }

  async mint({ ratingKey, startOffset, session }) {
    const adapter = this.#registry.get('plex');
    if (!adapter) {
      this.#logger.warn?.('plex.stream.mint-skipped', {
        ratingKey, startOffset, session, reason: 'no-plex-adapter',
      });
      return { kind: 'unconfigured' };
    }
    const result = await adapter.getMediaUrl(ratingKey, { startOffset, session });
    if (!result?.url) {
      this.#logger.warn?.('plex.stream.mint-failed', {
        ratingKey, startOffset, session, reason: result?.reason ?? null,
      });
      return { kind: 'not_found', reason: result?.reason };
    }
    this.#logger.sampled?.('plex.stream.mint', {
      ratingKey,
      startOffset,
      session,
      plexClientIdentifier: typeof adapter.resolveClientIdentifier === 'function'
        ? adapter.resolveClientIdentifier(session)
        : null,
    }, { maxPerMinute: 20 });
    return { kind: 'found', url: result.url };
  }
}

export default RegistryPlaybackStreamGateway;
