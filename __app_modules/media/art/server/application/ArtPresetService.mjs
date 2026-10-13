const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

function expandFrame(props, frames = {}) {
  if (typeof props.frame !== 'string') return props;
  const variety = frames[props.frame];
  if (!variety) return props;
  const expanded = { ...props, frame: variety.insets || variety.frame };
  if (expanded.matMargin == null && variety.matMargin != null) expanded.matMargin = variety.matMargin;
  if (expanded.cropMaxPerSide == null && variety.cropMaxPerSide != null) {
    expanded.cropMaxPerSide = variety.cropMaxPerSide;
  }
  return expanded;
}

/** Semantic query for named ArtMode presentation presets. */
export class ArtPresetService {
  constructor({ catalog, artSource }) {
    if (!catalog?.load) throw new Error('ArtPresetService requires catalog');
    if (!artSource?.selectFeatured) throw new Error('ArtPresetService requires artSource');
    this.catalog = catalog;
    this.artSource = artSource;
  }

  selectFeatured(options) { return this.artSource.selectFeatured(options); }

  async getPreset(key) {
    const { presets = {}, defaults = {}, frames = {}, collections = {} } = await this.catalog.load();
    const isPreset = hasOwn(presets, key);
    const isCollection = hasOwn(collections, key);
    if (!isPreset && !isCollection) return { kind: 'not_found', key };

    const selected = isPreset ? presets[key] : { collection: key };
    return {
      kind: 'found',
      value: expandFrame({ ...defaults, ...selected }, frames),
    };
  }
}

export default ArtPresetService;
