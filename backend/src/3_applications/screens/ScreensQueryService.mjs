const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function expandFrame(props, frames = {}) {
  if (typeof props.frame !== 'string') return props;
  const variety = frames[props.frame];
  if (!variety) return props;
  const expanded = { ...props, frame: variety.insets || variety.frame };
  if (expanded.matMargin == null && variety.matMargin != null) {
    expanded.matMargin = variety.matMargin;
  }
  if (expanded.cropMaxPerSide == null && variety.cropMaxPerSide != null) {
    expanded.cropMaxPerSide = variety.cropMaxPerSide;
  }
  return expanded;
}

function resolveArtPreset(
  presets = {},
  key,
  inlineProps = {},
  { defaults = {}, frames = {}, collections = {} } = {},
) {
  let base = null;
  if (key && hasOwn(presets, key)) base = presets[key];
  else if (key && hasOwn(collections, key)) base = { collection: key };
  const merged = base
    ? { ...defaults, ...base, ...inlineProps }
    : { ...defaults, ...inlineProps };
  return expandFrame(merged, frames);
}

/**
 * Application queries for screen summaries and expanded screen configuration.
 */
export class ScreensQueryService {
  /** @type {import('./ports/IScreensRepository.mjs').IScreensRepository} */
  #repository;
  #logger;

  constructor({ screensRepository, logger = console } = {}) {
    if (!screensRepository) {
      throw new Error('ScreensQueryService requires screensRepository');
    }
    this.#repository = screensRepository;
    this.#logger = logger;
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
      const { presets, defaults, frames } = await this.#repository.getArtmodeConfig();
      const collections = await this.#repository.getArtCollections();
      const presetKey = config.screensaver.preset;
      const known = hasOwn(presets, presetKey) || hasOwn(collections, presetKey);
      if (!known) {
        this.#logger.warn?.('screens.preset.unknown', { screenId, preset: presetKey });
      }
      config.screensaver.props = resolveArtPreset(
        presets,
        presetKey,
        config.screensaver.props || {},
        { defaults, frames, collections },
      );
    }

    this.#logger.debug?.('screens.get.success', { screenId });
    return { outcome: 'found', screen: config };
  }
}

export default ScreensQueryService;
