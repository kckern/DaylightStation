export function isEinkPanelRenderer(value) {
  return value != null
    && typeof value.render === 'function'
    && (typeof value.version === 'string' || Number.isFinite(value.version));
}
