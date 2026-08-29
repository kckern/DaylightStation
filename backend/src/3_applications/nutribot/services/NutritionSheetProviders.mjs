/**
 * sheetProviders — what items go in a block of a printable sheet.
 *
 * The framework's second extension seam. `cell.kind` in sheet config picks a
 * renderer (`1_rendering/pdf/cellRenderers.mjs`); `source` picks a provider here.
 * A provider is `() => item[]`, where an item is
 * `{ code?, label, sublabel?, icon?, cover?, meta? }`. The layout never reads an
 * item, and a provider never sees the page.
 *
 * WHY THIS IS CODE AND NOT YAML — the constraint the whole design rests on:
 *
 *   A printed code must not be able to drift from the grammar that parses it.
 *
 * Codes are therefore produced by the SAME module that parses them
 * (`ScanVocabularyService`) and never written literally in config. A sheet config
 * listing `dl:4` would make the printed code and the parsed code two independent
 * facts, and the day the grammar moved, a laminated sheet on the fridge would
 * start failing with no error anywhere. YAML declares shape; code decides payloads.
 *
 * The encoders validate and THROW on anything unprintable. Providers let that
 * throw escape: a config row that cannot be encoded takes the PDF down at
 * generation time rather than being skipped, because a skipped row is a hole in a
 * sheet somebody laminates. Reprints are expensive; a failed build is free.
 *
 * This module lives in `5_composition/` — the wiring layer — because providers
 * bridge domain encoders and application config. Putting them here is what keeps
 * `1_rendering/` a pure function of items and geometry.
 *
 * @module applications/nutribot/services/NutritionSheetProviders
 */

import {
  CONTROL_VERBS,
  encodeContainer,
  encodeControl,
  encodeDensity,
} from '#domains/nutrition/services/ScanVocabularyService.mjs';

/**
 * Presentation for the control verbs, keyed by verb.
 *
 * Sublabels describe the effect on the SEQUENCE, not on a single value: the scale
 * reports a weight and the human then scans a container and a density as separate
 * events over a time window, so these three codes are the only punctuation that
 * sequence has.
 *
 * Looked up, not enumerated — `nutrition.controls` iterates `CONTROL_VERBS`, so a
 * verb added to the grammar appears on the next sheet automatically. A verb with
 * no entry here still prints (capitalised, with no hint) rather than blocking the
 * sheet; fill in its copy here so the button explains itself on the fridge.
 */
// Copy and icons for the control verbs. These live in code rather than config
// because the verbs themselves do: they come from CONTROL_VERBS in the grammar,
// not from scales.yml, so a house cannot have a control the parser does not know.
// `nutribot.controls.<verb>.icon` still overrides, for a household that wants
// different art without touching source.
const CONTROL_COPY = Object.freeze(Object.assign(Object.create(null), {
  clear: { label: 'Clear', sublabel: 'Start this entry over', icon: 'control/clear' },
  undo: { label: 'Undo', sublabel: 'Take back the last scan', icon: 'control/undo' },
  done: { label: 'Done', sublabel: 'Log it now', icon: 'control/done' },
}));

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Build the provider registry, keyed by the `source` string in sheet config.
 *
 * As with the renderer registry there is deliberately no fallback provider: an
 * unrecognised `source` comes back `undefined` so the caller throws.
 *
 * @param {object} deps
 * @param {() => object} deps.getScaleConfig Returns the normalized nutribot config
 *   (see `#apps/nutribot/lib/scaleNutribotConfig.mjs`). Called per invocation, so an
 *   edited scales.yml reaches the next sheet without rebuilding the registry.
 * @param {(name: string) => (string|null)} [deps.loadIcon] Resolves an `icon:` name
 *   from config to SVG markup. INJECTED, and resolved HERE rather than in the
 *   renderer, because `1_rendering/` must not touch the filesystem — a renderer that
 *   reads files stops being testable without a disk. Missing icons return null and
 *   the mark degrades to a plain QR.
 * @returns {Record<string, () => Array<object>>}
 */
export function createNutritionProviders({ getScaleConfig, loadIcon = () => null }) {
  const icon = (name) => {
    if (!name) return { icon: null, iconSvg: null };
    let svg = null;
    // Never let a missing or unreadable icon cost the sheet: it is decoration, and
    // the code beside it still scans.
    try { svg = loadIcon(name); } catch { svg = null; }
    return { icon: name, iconSvg: svg };
  };
  const withIcon = (row) => ({ ...icon(row.icon), ...(row.icon_scale ? { iconScale: row.icon_scale } : {}) });

  return {
    /**
     * One QR per configured caloric-density level.
     *
     * **The code is derived from `kcal_per_g`, not from `level`.** Same reasoning
     * as the container provider below: the printed payload is a physical quantity
     * (kcal per 100 g, so `dl:140` is 1.4 kcal/g), and `level` is expected to hold
     * that same number. Encoding from the calorie figure means the two cannot
     * drift silently — edit `kcal_per_g` and forget `level` and the sheet prints a
     * code with no matching row, which fails loudly as `UNKNOWN_DENSITY_LEVEL`
     * instead of printing a stale number that resolves to the wrong calories.
     *
     * Rounding to an integer is what keeps decimals out of the QR payload; a
     * table with 1.45 and 1.44 kcal/g would collide, and the duplicate-level check
     * in `validateScanConfig` is what catches that.
     */
    'nutrition.density': () => {
      const cfg = getScaleConfig() || {};
      return (cfg.densityLevels || []).map((l) => ({
        code: encodeDensity(Math.round(Number(l.kcal_per_g) * 100)),
        label: l.label,
        sublabel: `${l.kcal_per_g} kcal/g`,
        ...icon(l.icon),
        meta: { level: l.level, kcalPerG: l.kcal_per_g },
      }));
    },

    /**
     * One QR per configured container, captioned with the tare the scan subtracts.
     *
     * **The code is derived from `grams`, not from `id`.** A household may name
     * container ids after their weight (`ct:160`) precisely so the printed code
     * carries no semantics — nothing to rename, nothing to orphan. That convention
     * puts the same number in two config fields, and encoding from `id` would make
     * the divergence silent in the worst direction: edit `grams: 120` to `140` and
     * forget the id, and the sheet keeps printing `ct:120` while the table
     * subtracts 140 g. Encoding from `grams` means the sheet prints `ct:140`, the
     * id lookup misses, and the scan fails loudly as `UNKNOWN_CONTAINER` instead of
     * quietly logging 20 g of phantom food.
     *
     * For ids that are NOT numeric this changes the printed code, so a household on
     * semantic ids must keep `id` and `grams` in step or move to numeric ids. The
     * validator's duplicate-id check still applies either way.
     */
    'nutrition.containers': () => {
      const cfg = getScaleConfig() || {};
      return (cfg.containers?.items || []).map((c) => ({
        code: encodeContainer(Math.round(Number(c.grams))),
        label: c.label,
        sublabel: `${c.grams} g`,
        ...withIcon(c),
        meta: { id: c.id, grams: c.grams },
      }));
    },

    /**
     * The command layer — one QR per control verb.
     *
     * Derived from `CONTROL_VERBS` rather than a local list, so the sheet and the
     * parser cannot disagree about which verbs exist. Independent of scale config:
     * these are grammar, not configuration.
     */
    'nutrition.controls': () => {
      const overrides = (getScaleConfig() || {}).controls || {};
      return CONTROL_VERBS.map((verb) => {
        const copy = CONTROL_COPY[verb];
        return {
          code: encodeControl(verb),
          label: copy?.label ?? capitalise(verb),
          sublabel: copy?.sublabel ?? '',
          ...icon(overrides[verb]?.icon ?? copy?.icon),
          meta: { verb },
        };
      });
    },

    /**
     * Common foods — READABLE TEXT ONLY, deliberately WITHOUT a `code`.
     *
     * There is no grammar for foods: no `fd:` prefix exists, and inventing one is
     * a design decision nobody has made. Emitting a code here would print a QR
     * that `parseScan` returns null for — exactly the silent-on-the-fridge failure
     * this seam exists to prevent. So these items carry no `code` property at all
     * (not `null`, not `''`) and the block renders with `cell.kind: label`.
     *
     * When a food grammar lands, this provider starts emitting codes and the sheet
     * config flips `kind: label` → `kind: qr`, with no other change.
     */
    'nutrition.foods': () => {
      const cfg = getScaleConfig() || {};
      return (cfg.foods || []).map((f) => {
        const item = { label: f.label, meta: { id: f.id } };
        if (f.sublabel) item.sublabel = f.sublabel;
        return item;
      });
    },
  };
}
