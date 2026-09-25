/**
 * Merge household arcade-overlay.yml defaults with a per-system override.
 *
 * `fields: []` on a system is an explicit "show nothing", distinct from
 * omitting `fields` (which inherits the default list) — a system asking for
 * silence must not read the same as a system that said nothing at all.
 *
 * The fallback values here are a safety net for a missing/corrupt config
 * file, not the intended household defaults — those live in
 * data/household/gaming/arcade-overlay.yml. An absent config shows nothing
 * (`fields: []`) rather than guessing at content the household never chose.
 */
export function resolveOverlayConfig(config, systemId) {
  const defaults = config?.defaults || {};
  const override = (systemId && config?.systems?.[systemId]) || {};
  const fields = override.fields !== undefined ? override.fields : (defaults.fields ?? []);
  return Object.freeze({
    anchor: override.anchor ?? defaults.anchor ?? 'top-left',
    offsetX: override.offset_x ?? defaults.offset_x ?? '2%',
    offsetY: override.offset_y ?? defaults.offset_y ?? '2%',
    scale: override.scale ?? defaults.scale ?? 0.5,
    fields: Object.freeze([...fields]),
  });
}

export default resolveOverlayConfig;
