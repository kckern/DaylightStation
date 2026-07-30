/**
 * VirtualOmrReader — a Chatsworth OMR-1100 that reads a form map instead of paper.
 *
 * Takes the REAL artifact the School PDF renderer emits —
 * `{ formVersion, marks: [{ itemId, choice, xPt, yPt, rPt, page }] }` — plus a
 * set of chosen answers, and synthesizes the normalized sheet event documented
 * in `docs/reference/omr/README.md`:
 *
 *   { source:'omr-relay', type:'sheet', id, columns, markedColumns, marks[] }
 *
 * `marks[]` is one 12-bit mask per column, bit 0 = row 12 (far edge) …
 * bit 11 = row 9 (strobe edge). Blank columns are present as 0, per the doc's
 * "one 12-bit mask per column"; `markedColumns` counts the non-zero entries.
 * The relay deliberately does not translate columns into answers, so neither
 * does this double — mark-to-meaning stays a backend concern.
 *
 * ASSUMPTION — ordinal geometry, not physical pitch. A reader column is a
 * physical 0.250in strobe step and a channel is a 0.250in lane across a 3.250in
 * card; the renderer's form map is Letter-sized worksheet geometry in points, and
 * as of writing no card had ever been measured against this reader, so there is no
 * real card whose pitch we could project onto. This double therefore assigns
 * column indices ordinally (response rows sorted by page then yPt) and channel
 * bits ordinally (bubbles sorted left to right by xPt). When a real card geometry
 * exists, replace the two ordinal mappings with a pitch calculation — the emitted
 * event shape does not change.
 *
 * @module adapters/hardware/omr
 */
import { InfrastructureError } from '#system/utils/errors/index.mjs';

const SOURCE = 'omr-relay';
const DEFAULT_TOPIC = 'omr';
/** The reader has twelve Hollerith channels: 12, 11, 0, 1…9. */
const CHANNELS = 12;
/** yPt values within this many points are the same physical response row. */
const ROW_EPSILON_PT = 0.5;

export class VirtualOmrReader {
  #eventBus; #readerId; #topic; #logger;
  #sheets = [];

  /**
   * @param {Object} [deps]
   * @param {Object} [deps.eventBus] - IEventBus; optional, the event is also returned
   * @param {string} [deps.readerId='virtual-omr']
   * @param {string} [deps.topic='omr']
   * @param {Object} [deps.logger=console]
   */
  constructor({ eventBus = null, readerId = 'virtual-omr', topic = DEFAULT_TOPIC, logger = console } = {}) {
    this.#eventBus = eventBus;
    this.#readerId = readerId;
    this.#topic = topic;
    this.#logger = logger;
  }

  /**
   * Project a form map onto reader geometry. Exposed so tests and the virtual
   * device console can build an answer grid without re-deriving the mapping.
   *
   * @param {{formVersion:string, marks:Array<Object>}} formMap
   * @returns {Array<{page:number, yPt:number, columnIndex:number, choices:Array<{itemId:string, choice:string, xPt:number, bit:number}>}>}
   */
  formLayout(formMap) {
    validateFormMap(formMap);

    /** @type {Array<{page:number, yPt:number, marks:Array<Object>}>} */
    const rows = [];
    for (const mark of formMap.marks) {
      const page = mark.page ?? 1;
      const row = rows.find((r) => r.page === page && Math.abs(r.yPt - mark.yPt) <= ROW_EPSILON_PT);
      if (row) row.marks.push(mark);
      else rows.push({ page, yPt: mark.yPt, marks: [mark] });
    }

    rows.sort((a, b) => (a.page - b.page) || (a.yPt - b.yPt));

    return rows.map((row, columnIndex) => {
      if (row.marks.length > CHANNELS) {
        throw new InfrastructureError(
          `response row at page ${row.page} y=${row.yPt} has ${row.marks.length} bubbles; the reader has ${CHANNELS} channels`,
          { code: 'OMR_ROW_OVERFLOW', page: row.page, yPt: row.yPt, count: row.marks.length },
        );
      }
      const choices = [...row.marks]
        .sort((a, b) => a.xPt - b.xPt)
        .map((m, bit) => ({ itemId: m.itemId, choice: m.choice, xPt: m.xPt, bit }));
      return { page: row.page, yPt: row.yPt, columnIndex, choices };
    });
  }

  /**
   * Read a filled-in sheet.
   *
   * @param {Object} args
   * @param {{formVersion:string, marks:Array<Object>}} args.formMap - from the PDF renderer
   * @param {Object<string,string>} [args.chosen] - itemId → choice
   * @param {string[]} [args.ambiguous] - itemIds that get TWO marks in one row
   * @param {string[]} [args.blank] - itemIds that get none
   * @returns {{source:string, type:string, id:string, columns:number, markedColumns:number, marks:number[]}}
   */
  scanSheet({ formMap, chosen = {}, ambiguous = [], blank = [] } = {}) {
    const layout = this.formLayout(formMap);
    const blankSet = new Set(blank);

    for (const itemId of [...Object.keys(chosen), ...ambiguous, ...blank]) {
      if (!layout.some((row) => row.choices.some((c) => c.itemId === itemId))) {
        throw new InfrastructureError(`unknown OMR item ${itemId}`, { code: 'UNKNOWN_OMR_ITEM', itemId });
      }
    }
    for (const itemId of [...Object.keys(chosen), ...ambiguous]) {
      if (blankSet.has(itemId)) {
        throw new InfrastructureError(`item ${itemId} cannot be both answered and blank`, {
          code: 'OMR_CONFLICTING_ITEMS', itemId,
        });
      }
    }

    const marks = new Array(layout.length).fill(0);
    for (const row of layout) {
      for (const itemId of itemIdsIn(row)) {
        if (blankSet.has(itemId)) continue;
        const bits = ambiguous.includes(itemId)
          ? ambiguousBits(row, itemId, chosen[itemId])
          : chosenBits(row, itemId, chosen[itemId]);
        for (const bit of bits) marks[row.columnIndex] |= (1 << bit);
      }
    }

    const sheet = {
      source: SOURCE,
      type: 'sheet',
      id: this.#readerId,
      columns: marks.length,
      markedColumns: marks.filter((m) => m !== 0).length,
      marks,
    };

    this.#sheets.push(sheet);
    this.#eventBus?.broadcast?.(this.#topic, sheet);
    this.#logger.info?.('virtual-omr.sheet', {
      id: this.#readerId, formVersion: formMap.formVersion, columns: sheet.columns, markedColumns: sheet.markedColumns,
    });
    return sheet;
  }

  /** @returns {Array<Object>} sheet events in order */
  listSheets() {
    return this.#sheets.map((s) => ({ ...s, marks: [...s.marks] }));
  }

  /** @returns {Object|null} */
  lastSheet() {
    if (!this.#sheets.length) return null;
    const s = this.#sheets[this.#sheets.length - 1];
    return { ...s, marks: [...s.marks] };
  }
}

/** @returns {string[]} distinct itemIds owning bubbles in this response row */
function itemIdsIn(row) {
  return [...new Set(row.choices.map((c) => c.itemId))];
}

/** @returns {number[]} the single bit for a chosen answer, or none */
function chosenBits(row, itemId, choice) {
  if (choice === undefined) return [];
  const hit = row.choices.find((c) => c.itemId === itemId && c.choice === choice);
  if (!hit) {
    throw new InfrastructureError(`item ${itemId} has no choice ${choice}`, {
      code: 'UNKNOWN_OMR_CHOICE', itemId, choice,
    });
  }
  return [hit.bit];
}

/**
 * Two bits in one row — the smudge/erasure a grader has to send to review.
 * Pairs the chosen bubble with its neighbour (the previous one when the choice
 * is last); with no chosen answer, the item's first two bubbles.
 * @returns {number[]}
 */
function ambiguousBits(row, itemId, choice) {
  const own = row.choices.filter((c) => c.itemId === itemId);
  if (own.length < 2) {
    throw new InfrastructureError(`item ${itemId} has fewer than two bubbles; it cannot be ambiguous`, {
      code: 'OMR_NOT_AMBIGUABLE', itemId, choices: own.length,
    });
  }
  if (choice === undefined) return [own[0].bit, own[1].bit];
  const idx = own.findIndex((c) => c.choice === choice);
  if (idx === -1) {
    throw new InfrastructureError(`item ${itemId} has no choice ${choice}`, {
      code: 'UNKNOWN_OMR_CHOICE', itemId, choice,
    });
  }
  const partner = idx + 1 < own.length ? own[idx + 1] : own[idx - 1];
  return [own[idx].bit, partner.bit];
}

function validateFormMap(formMap) {
  if (!formMap || typeof formMap !== 'object') {
    throw new InfrastructureError('scanSheet requires a formMap', { code: 'INVALID_FORM_MAP', value: formMap });
  }
  if (typeof formMap.formVersion !== 'string' || !formMap.formVersion) {
    throw new InfrastructureError('formMap.formVersion is required', { code: 'INVALID_FORM_MAP', field: 'formVersion' });
  }
  if (!Array.isArray(formMap.marks) || formMap.marks.length === 0) {
    throw new InfrastructureError('formMap.marks must be a non-empty array', { code: 'INVALID_FORM_MAP', field: 'marks' });
  }
  for (const m of formMap.marks) {
    if (!m || typeof m.itemId !== 'string' || typeof m.choice !== 'string'
      || typeof m.xPt !== 'number' || typeof m.yPt !== 'number') {
      throw new InfrastructureError('formMap.marks entries need itemId, choice, xPt, yPt', {
        code: 'INVALID_FORM_MAP', field: 'marks', value: m,
      });
    }
  }
}

export default VirtualOmrReader;
