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

/** Expands the installed Art preset on an otherwise valid screen config. */
export function createArtScreenPresetEnricher({ repository, logger = console }) {
  return async (config, screenId) => {
    const { presets, defaults, frames } = await repository.getArtmodeConfig();
    const collections = await repository.getArtCollections();
    const presetKey = config.screensaver.preset;
    const known = hasOwn(presets, presetKey) || hasOwn(collections, presetKey);
    if (!known) {
      logger.warn?.('screens.preset.unknown', { screenId, preset: presetKey });
    }
    config.screensaver.props = resolveArtPreset(
      presets,
      presetKey,
      config.screensaver.props || {},
      { defaults, frames, collections },
    );
  };
}
