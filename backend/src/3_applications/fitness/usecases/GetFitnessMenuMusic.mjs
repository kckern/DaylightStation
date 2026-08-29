/** Build the Fitness menu-music projection from its catalog and app settings. */
export class GetFitnessMenuMusic {
  constructor({ menuMusicCatalog, fitnessConfigService } = {}) {
    this.menuMusicCatalog = menuMusicCatalog;
    this.fitnessConfigService = fitnessConfigService;
  }

  execute(householdId) {
    const tracks = this.menuMusicCatalog?.listTracks?.() || [];
    return {
      tracks,
      volume: this.fitnessConfigService?.getMenuMusicVolume?.(householdId) ?? 0.05,
    };
  }
}

export default GetFitnessMenuMusic;
