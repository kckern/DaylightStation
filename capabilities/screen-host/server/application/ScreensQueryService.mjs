/**
 * Application queries for screen summaries and expanded screen configuration.
 */
export class ScreensQueryService {
  /** @type {import('./ports/IScreensRepository.mjs').IScreensRepository} */
  #repository;
  #logger;
  #expandScreensaverPreset;

  constructor({ screensRepository, logger = console, expandScreensaverPreset = null } = {}) {
    if (!screensRepository) {
      throw new Error('ScreensQueryService requires screensRepository');
    }
    this.#repository = screensRepository;
    this.#logger = logger;
    this.#expandScreensaverPreset = expandScreensaverPreset;
  }

  async listScreens() {
    const { entries, unreadable, directoryMissing } =
      await this.#repository.listScreenDocuments();
    if (directoryMissing) {
      this.#logger.debug?.('screens.list.empty', { reason: 'directory not found' });
      return { screens: [] };
    }

    const usable = (value) => Number.isFinite(value) && value > 0;
    const screens = entries.map(({ id, document }) => {
      const resolution = usable(document?.resolution?.width)
        && usable(document?.resolution?.height)
        ? {
            width: document.resolution.width,
            height: document.resolution.height,
          }
        : null;
      return {
        id,
        name: document?.name || document?.screen || id,
        resolution,
      };
    });
    this.#logger.debug?.('screens.list.success', { count: screens.length, unreadable });
    return { screens };
  }

  async getScreen(screenId) {
    let config;
    try {
      config = await this.#repository.findScreenById(screenId);
    } catch (error) {
      this.#logger.error?.('screens.get.error', { screenId, error: error.message });
      throw error;
    }

    // `null` is the repository's explicit not-found result. An existing but
    // empty/scalar YAML document is an invalid config, not a missing file.
    if (config === null) {
      this.#logger.debug?.('screens.get.notfound', { screenId });
      return { outcome: 'not-found' };
    }
    if (!config?.screen) {
      this.#logger.warn?.('screens.get.invalid', {
        screenId,
        reason: 'missing screen field',
      });
      return { outcome: 'invalid-config' };
    }

    if (config.screensaver?.preset) {
      await this.#expandScreensaverPreset?.(config, screenId);
    }

    this.#logger.debug?.('screens.get.success', { screenId });
    return { outcome: 'found', screen: config };
  }
}

export default ScreensQueryService;
