/**
 * Apply a fridge-sheet scan to a scale's in-progress composition.
 *
 * Returns `{ handled: false }` for anything the grammar does not claim, which is
 * how the caller knows to fall through to the UPC path. That flag is the entire
 * contract for three-way routing — it must never throw for an unclaimed code.
 *
 * ## Every branch is an EXPLICIT kind check
 *
 * There is no fall-through arm. A kind the grammar produces but this file has no
 * handler for is refused by name, not absorbed by whichever branch happens to sit
 * last. That is not hypothetical tidiness: the container branch WAS the implicit
 * else, so `rs:undo` and `rs:done` — real codes, printable since the grammar
 * gained its control verbs — came back as `UNKNOWN_CONTAINER`. A printed code
 * with no handler is the failure this whole design exists to prevent; it must at
 * minimum say so.
 *
 * @module nutribot/usecases/ApplyScanToComposition
 */

import { parseScan } from '#domains/nutrition/index.mjs';
import { containerForTare, densityForCode } from '../lib/scaleNutribotConfig.mjs';

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
   * @param {{setDensity:Function,setContainer:Function,endPlacement:Function,clear:Function,undo:Function,read:Function}} deps.store
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
   *   `handled: false` ONLY when the grammar did not claim the code. Anything it
   *   claimed comes back `handled: true`, with `ok` saying whether it landed.
   */
  execute({ scaleId, code }) {
    const parsed = parseScan(code);
    if (!parsed) return notHandled();

    if (parsed.kind === 'reset') {
      const hadState = this.#store.clear(scaleId);
      this.#logger.info?.('applyScan.reset', { scaleId, hadState });
      return { handled: true, ok: true, kind: 'reset', hadState };
    }

    if (parsed.kind === 'undo') {
      const undone = this.#store.undo(scaleId);
      this.#logger.info?.('applyScan.undo', { scaleId, undone });
      // `ok: true` even when nothing was there. `ok: false` is a REFUSAL and
      // paints a ⚠️ on the prompt; an undo that found nothing to take back is a
      // scan that worked and had no work, exactly like a bare `rs:clear`.
      // `undone` carries the difference for the ack.
      return { handled: true, ok: true, kind: 'undo', undone };
    }

    if (parsed.kind === 'done') {
      // Routed to `endPlacement`, whose contract — consume every slot for this
      // scale, now — is the STORE half of what "done" asks for. The store keeps
      // `endPlacement` and `clear` as separate methods because they MEAN
      // different things, and `done` sits on the endPlacement side of that line:
      // it says "the sequence is complete, process it", not "forget it". The
      // result reports `kind: 'done'` rather than reusing 'reset', so the call
      // site and the ack the user reads never conflate the two.
      //
      // The SNAPSHOT is read first and travels back with the result. Consuming
      // the slots is only half of what "done" asks for — the other half is that
      // the entry gets FINALISED, and that happens in the bridge, one layer up,
      // after this returns. Routing to `endPlacement` alone meant the card wiped
      // the composition and the quiet-commit timer then fired against nothing and
      // skipped as incomplete: the explicit "process it now" gesture guaranteed a
      // stranded entry with no density, which is the exact failure this whole
      // feature exists to remove. Handing the pre-consumption snapshot back is
      // what lets the caller commit against what was actually scanned without
      // this use case reaching into the bridge or reordering `endPlacement`.
      const snapshot = this.#store.read?.(scaleId) ?? null;
      const hadState = this.#store.endPlacement(scaleId);
      this.#logger.info?.('applyScan.done', { scaleId, hadState });
      return { handled: true, ok: true, kind: 'done', hadState, snapshot };
    }

    if (parsed.kind === 'density') {
      // The scan carries kcal per 100 g, not the ordinal rung. Resolve it to a
      // config row: the calorie figure is already in hand, but the row supplies
      // the macro split and the label, and its ORDINAL `level` is what the store
      // and every downstream consumer key on. Rejecting a value with no row keeps
      // a sheet/table disagreement from becoming a plausible wrong calorie count.
      const row = densityForCode(this.#config, parsed.kcalPer100g);
      if (!row) {
        this.#logger.warn?.('applyScan.unknownDensityLevel', { scaleId, kcalPer100g: parsed.kcalPer100g });
        return {
          handled: true, ok: false, kind: 'density',
          error: 'UNKNOWN_DENSITY_LEVEL', kcalPer100g: parsed.kcalPer100g,
        };
      }

      this.#store.setDensity(scaleId, row.level);
      this.#logger.info?.('applyScan.density', { scaleId, level: row.level, kcalPer100g: parsed.kcalPer100g });
      return { handled: true, ok: true, kind: 'density', level: row.level, label: row.label, emoji: row.emoji };
    }

    // EXPLICIT, never the fall-through. This branch was the implicit `else` once,
    // which meant every kind the switch above did not name landed here and came
    // back as `{kind:'container', error:'UNKNOWN_CONTAINER', id: undefined}` — a
    // control command reported to the user as a broken container. `undo` and
    // `done` did exactly that between the grammar landing and their handlers.
    //
    // An unresolvable tare must NOT reach the store. `resolveScaleNet` would find
    // no matching row and fall back to the un-tared gross; it does flag that on
    // the prompt, but a sheet/table disagreement is better caught at scan time
    // than argued about later on the message.
    if (parsed.kind === 'container') {
      // The scan carries the tare in grams, so the subtraction needs no lookup.
      // The row is still resolved for its label, emoji and id — the id is what the
      // store keys on, and the ack is unreadable without a name.
      const item = containerForTare(this.#config, parsed.grams);
      if (!item) {
        this.#logger.warn?.('applyScan.unknownContainer', { scaleId, grams: parsed.grams });
        return { handled: true, ok: false, kind: 'container', error: 'UNKNOWN_CONTAINER', grams: parsed.grams };
      }

      this.#store.setContainer(scaleId, item.id);
      this.#logger.info?.('applyScan.container', { scaleId, id: item.id, grams: parsed.grams });
      return { handled: true, ok: true, kind: 'container', id: item.id, label: item.label, emoji: item.emoji, grams: item.grams };
    }

    // A kind the grammar produced that this use case does not implement — a
    // future prefix whose handler has not landed yet, which is the state `undo`
    // and `done` were in.
    //
    // Deliberately NOT `notHandled()`. That reply means "the fridge grammar does
    // not claim this code", and `routeNutribotScan` acts on it by sending the
    // scan onward to the product lookup — a lie about a code that unmistakably
    // came off the sheet, and the same shape as the defect above. Claiming it and
    // refusing it puts a visible ⚠️ on the prompt at the fridge, which is the
    // failure direction this subsystem prefers everywhere else. `kind` echoes
    // what was parsed rather than naming any implemented branch, so the next
    // fifth kind cannot masquerade as one.
    this.#logger.warn?.('applyScan.unhandledKind', { scaleId, kind: parsed.kind });
    return { handled: true, ok: false, kind: parsed.kind, error: 'UNHANDLED_SCAN_KIND' };
  }
}

export default ApplyScanToComposition;
