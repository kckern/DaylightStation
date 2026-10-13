// presetResolver.mjs — pure. Resolve a screensaver/scene reference into ArtMode props.
//
// Layering (lowest → highest precedence):
//   defaults  <  (named preset | collection-fallback)  <  inline props
//   - `key` names a preset            → that preset is the middle layer.
//   - `key` names a collection only   → synthesise `{ collection: key }`, so a bare
//                                        collection (e.g. `art:baroque`) resolves
//                                        without a passthrough preset in artmode.yml.
//   - `key` matches neither           → defaults + inline only.
//
// Then a named `frame` (a string) is expanded from the `frames` catalog into the
// flat `{ frame: insets, matMargin, cropMaxPerSide }` shape the ArtMode widget
// consumes — so frame geometry (and its mat/crop) lives once per variety.
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// Replace a string `frame` (a variety name) with its insets, filling matMargin /
// cropMaxPerSide from the variety unless the props already set them explicitly.
// A non-string frame (inline insets) or an unknown name is left untouched for the
// widget's own default to handle.
export function expandFrame(props, frames = {}) {
  if (typeof props.frame !== 'string') return props;
  const variety = frames[props.frame];
  if (!variety) return props;
  const out = { ...props, frame: variety.insets || variety.frame };
  if (out.matMargin == null && variety.matMargin != null) out.matMargin = variety.matMargin;
  if (out.cropMaxPerSide == null && variety.cropMaxPerSide != null) out.cropMaxPerSide = variety.cropMaxPerSide;
  return out;
}

export function resolvePreset(presets = {}, key, inlineProps = {}, { defaults = {}, frames = {}, collections = {} } = {}) {
  let base = null;
  if (key && hasOwn(presets, key)) base = presets[key];
  else if (key && hasOwn(collections, key)) base = { collection: key };
  const merged = base
    ? { ...defaults, ...base, ...inlineProps }
    : { ...defaults, ...inlineProps };
  return expandFrame(merged, frames);
}

export default resolvePreset;
