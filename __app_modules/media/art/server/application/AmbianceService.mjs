import { isEligible, selectAmbianceArtwork, areAmbianceCompatible } from '../domain/ambiancePolicy.mjs';

const neutral = () => ({ mode: 'neutral', panels: [], matte: null, match: { kind: 'neutral' } });

/** Review gates and matching are independent of the legacy random-art path. */
export class AmbianceService {
  constructor({ catalog, artworkSource, random = Math.random, recencyStore = null, logger = console }) {
    this.catalog = catalog;
    this.artworkSource = artworkSource;
    this.random = random;
    this.history = new Map();
    this.pending = new Map();
    this.recencyStore = recencyStore;
    this.logger = logger;
  }

  async context(profile) {
    const catalog = await this.catalog.load();
    if (!Object.hasOwn(catalog.profiles, profile)) {
      throw Object.assign(new Error('Unknown ambiance profile'), { status: 404 });
    }
    return { catalog, policy: catalog.profiles[profile] };
  }

  async getTracks(profile) {
    const { catalog, policy } = await this.context(profile);
    return { trackIds: Object.entries(catalog.tracks).filter(([, item]) => isEligible(item, profile, policy)).map(([id]) => id) };
  }

  async match(request) {
    // Rapid skips can overlap requests. Reserve selections in order so they
    // share the updated history instead of choosing the same fresh work.
    const previous = this.pending.get(request.profile) || Promise.resolve();
    const next = previous.catch(() => {}).then(() => this.matchNext(request));
    this.pending.set(request.profile, next);
    try { return await next; }
    finally { if (this.pending.get(request.profile) === next) this.pending.delete(request.profile); }
  }

  async matchNext({ profile, trackId, recentIds = [] }) {
    const { catalog, policy } = await this.context(profile);
    const track = Object.hasOwn(catalog.tracks, trackId) ? { ...catalog.tracks[trackId], id: trackId } : null;
    if (!isEligible(track, profile, policy)) return neutral();
    const reviewed = Object.fromEntries(Object.entries(catalog.artworks).filter(([, art]) => isEligible(art, profile, policy, 'artwork')));
    const available = await this.artworkSource.resolveArtworks(Object.keys(reviewed));
    const artworks = Object.fromEntries(Object.entries(catalog.artworks).filter(([id]) => Object.hasOwn(available, id)));
    const window = Number.isInteger(policy.repeatWindow) ? Math.max(1, Math.min(1000, policy.repeatWindow)) : 50;
    let persisted = [];
    try {
      const history = await this.recencyStore?.load();
      const prefix = `${profile}/`;
      persisted = [...(history || [])].filter(([id]) => id.startsWith(prefix))
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]))).map(([id]) => id.slice(prefix.length));
    } catch (err) { this.logger.warn?.('art.ambiance.history_unavailable', { error: err.message }); }
    const recent = [...new Set([...persisted, ...(this.history.get(profile) || []), ...recentIds].reverse())].reverse().slice(-window);
    const options = { track, profileKey: profile, policy, recentIds: recent, overrides: catalog.pairings, random: this.random };
    while (Object.keys(artworks).length) {
      const selection = selectAmbianceArtwork({ ...options, artworks });
      if (!selection) break;
      try {
        const verified = await this.artworkSource.verifyArtwork(available[selection.artId], reviewed[selection.artId]);
        if (!verified) { delete artworks[selection.artId]; continue; }
        let presented = await this.artworkSource.presentArtwork(verified);
        let companion = null;
        if (policy.portraitPairing === true && verified.kind === 'portrait') {
          const portraits = Object.fromEntries(Object.entries(artworks).filter(([id, record]) =>
            id !== selection.artId && available[id].kind === 'portrait' && areAmbianceCompatible(reviewed[selection.artId], record, policy)));
          while (Object.keys(portraits).length) {
            const chosen = selectAmbianceArtwork({ ...options, artworks: portraits });
            if (!chosen) break;
            try {
              const other = await this.artworkSource.verifyArtwork(available[chosen.artId], reviewed[chosen.artId]);
              if (other) {
                presented = await this.artworkSource.presentArtwork(verified, other);
                companion = chosen;
                break;
              }
            } catch { /* Keep the valid primary when a companion cannot decode. */ }
            delete portraits[chosen.artId];
          }
        }
        const ids = companion ? [selection.artId, companion.artId] : [selection.artId];
        this.history.set(profile, [...recent.filter((id) => !ids.includes(id)), ...ids].slice(-window));
        try { await this.recencyStore?.record(ids.map((id) => `${profile}/${id}`)); }
        catch (err) { this.logger.warn?.('art.ambiance.history_unavailable', { error: err.message }); }
        return { ...presented, match: { ...selection, ...(companion ? { companion } : {}) } };
      } catch {
        // Invalid image bytes must not strand a song on a broken panel.
        delete artworks[selection.artId];
      }
    }
    return neutral();
  }
}
