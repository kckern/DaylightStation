import { isEligible, selectAmbianceArtwork } from '../domain/ambiancePolicy.mjs';

const neutral = () => ({ mode: 'neutral', panels: [], matte: null, match: { kind: 'neutral' } });

/** Review gates and matching are independent of the legacy random-art path. */
export class AmbianceService {
  constructor({ catalog, artworkSource, random = Math.random }) {
    this.catalog = catalog;
    this.artworkSource = artworkSource;
    this.random = random;
    this.history = new Map();
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

  async match({ profile, trackId, recentIds = [] }) {
    const { catalog, policy } = await this.context(profile);
    const track = Object.hasOwn(catalog.tracks, trackId) ? { ...catalog.tracks[trackId], id: trackId } : null;
    if (!isEligible(track, profile, policy)) return neutral();
    const available = await this.artworkSource.resolveArtworks(Object.keys(catalog.artworks));
    const artworks = Object.fromEntries(Object.entries(catalog.artworks).filter(([id]) => Object.hasOwn(available, id)));
    const selection = selectAmbianceArtwork({
      track, artworks, profileKey: profile, policy,
      recentIds: [...(this.history.get(profile) || []), ...recentIds],
      overrides: catalog.pairings, random: this.random,
    });
    if (!selection) return neutral();
    const presented = await this.artworkSource.presentArtwork(available[selection.artId]);
    this.history.set(profile, [...(this.history.get(profile) || []), selection.artId].slice(-20));
    return { ...presented, match: selection };
  }
}
