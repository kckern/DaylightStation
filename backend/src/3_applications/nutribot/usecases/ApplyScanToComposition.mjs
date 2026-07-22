/**
 * Apply a fridge-sheet scan to a scale's in-progress composition.
 *
 * Returns `{ handled: false }` for anything the grammar does not claim, which is
 * how the caller knows to fall through to the UPC path. That flag is the entire
 * contract for three-way routing — it must never throw for an unclaimed code.
 *
 * @module nutribot/usecases/ApplyScanToComposition
 */

import { parseScan } from '#domains/nutrition/index.mjs';
import { densityForLevel } from '../lib/scaleNutribotConfig.mjs';

/**
 * A fresh object every time rather than a shared constant. The saving would be
 * one small allocation per unclaimed scan — irrelevant at fridge-scan rates —
 * and a shared instance is a live foot-gun: any caller that annotated the result
 * (`r.handled = true`, or spreading onto it) would corrupt the reply to every
 * later unclaimed scan, and the damage would surface far from here.
 */
const notHandled = () => ({ handled: false });

export class ApplyScanToComposition {
  #store; #config; #logger;

  /**
   * @param {object} deps
   * @param {import('../CompositionStore.mjs').CompositionStore} deps.store
   * @param {{densityLevels: Array, containers: {items: Array}}} deps.config
   * @param {object} [deps.logger]
   */
  constructor(deps = {}) {
    if (!deps.store?.setDensity) throw new Error('ApplyScanToComposition: store is required');
    this.#store = deps.store;
    this.#config = deps.config || { densityLevels: [], containers: { items: [] } };
    this.#logger = deps.logger || console;
  }

  /**
   * @param {{scaleId: string, code: string}} input
   * @returns {{handled: boolean, ok?: boolean, kind?: string, error?: string}}
   */
  execute({ scaleId, code }) {
    const parsed = parseScan(code);
    if (!parsed) return notHandled();

    if (parsed.kind === 'reset') {
      const hadState = this.#store.clear(scaleId);
      this.#logger.info?.('applyScan.reset', { scaleId, hadState });
      return { handled: true, ok: true, kind: 'reset', hadState };
    }

    if (parsed.kind === 'density') {
      // Parsing only proves the level is inside the grammar; the level still has
      // to exist in the config table. Rejecting here keeps a gap in the table from
      // becoming a "fix the YAML" error discovered at the fridge.
      const row = densityForLevel(this.#config, parsed.level);
      if (!row) {
        this.#logger.warn?.('applyScan.unknownDensityLevel', { scaleId, level: parsed.level });
        return { handled: true, ok: false, kind: 'density', error: 'UNKNOWN_DENSITY_LEVEL', level: parsed.level };
      }

      this.#store.setDensity(scaleId, parsed.level);
      this.#logger.info?.('applyScan.density', { scaleId, level: parsed.level });
      return { handled: true, ok: true, kind: 'density', level: parsed.level, label: row.label, emoji: row.emoji };
    }

    // container — an unknown id must NOT reach the store. `resolveScaleNet` would
    // find no matching row and fall back to the un-tared gross; it does flag that
    // on the prompt, but a renamed id is better caught at scan time than argued
    // about later on the message.
    const item = (this.#config.containers?.items || []).find((c) => c.id === parsed.id);
    if (!item) {
      this.#logger.warn?.('applyScan.unknownContainer', { scaleId, id: parsed.id });
      return { handled: true, ok: false, kind: 'container', error: 'UNKNOWN_CONTAINER', id: parsed.id };
    }

    this.#store.setContainer(scaleId, parsed.id);
    this.#logger.info?.('applyScan.container', { scaleId, id: parsed.id, grams: item.grams });
    return { handled: true, ok: true, kind: 'container', id: parsed.id, label: item.label, emoji: item.emoji, grams: item.grams };
  }
}

export default ApplyScanToComposition;
