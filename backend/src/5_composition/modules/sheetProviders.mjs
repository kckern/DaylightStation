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
 * @module composition/modules/sheetProviders
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
const CONTROL_COPY = Object.freeze(Object.assign(Object.create(null), {
  clear: { label: 'Clear', sublabel: 'Start this entry over' },
  undo: { label: 'Undo', sublabel: 'Take back the last scan' },
  done: { label: 'Done', sublabel: 'Log it now' },
}));

const capitalise = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Build the provider registry, keyed by the `source` string in sheet config.
 *
 * As with the renderer registry there is deliberately no fallback provider: an
 * unrecognised `source` comes back `undefined` so the caller throws.
 *
 * @param {{ getScaleConfig: () => object }} deps `getScaleConfig` returns the
 *   normalized nutribot config (see `#apps/nutribot/lib/scaleNutribotConfig.mjs`).
 *   It is called per invocation, so an edited scales.yml reaches the next sheet
 *   without rebuilding the registry.
 * @returns {Record<string, () => Array<object>>}
 */
export function createNutritionProviders({ getScaleConfig }) {
  return {
    /** One QR per configured caloric-density level. */
    'nutrition.density': () => {
      const cfg = getScaleConfig() || {};
      return (cfg.densityLevels || []).map((l) => ({
        code: encodeDensity(l.level),
        label: l.label,
        sublabel: `${l.kcal_per_g} kcal/g`,
        meta: { level: l.level },
      }));
    },

    /** One QR per configured container, captioned with the tare the scan subtracts. */
    'nutrition.containers': () => {
      const cfg = getScaleConfig() || {};
      return (cfg.containers?.items || []).map((c) => ({
        code: encodeContainer(c.id),
        label: c.label,
        sublabel: `${c.grams} g`,
        meta: { id: c.id },
      }));
    },

    /**
     * The command layer — one QR per control verb.
     *
     * Derived from `CONTROL_VERBS` rather than a local list, so the sheet and the
     * parser cannot disagree about which verbs exist. Independent of scale config:
     * these are grammar, not configuration.
     */
    'nutrition.controls': () => CONTROL_VERBS.map((verb) => {
      const copy = CONTROL_COPY[verb];
      return {
        code: encodeControl(verb),
        label: copy?.label ?? capitalise(verb),
        sublabel: copy?.sublabel ?? '',
        meta: { verb },
      };
    }),

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
