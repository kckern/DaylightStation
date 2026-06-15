// presetResolver.mjs — pure. Resolve a screensaver preset reference into ArtMode
// props: the named preset is the base, inline props shallow-merge on top.
export function resolvePreset(presets = {}, key, inlineProps = {}) {
  if (key && Object.prototype.hasOwnProperty.call(presets, key)) {
    return { ...presets[key], ...inlineProps };
  }
  return { ...inlineProps };
}

export default resolvePreset;
