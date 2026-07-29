/**
 * SheetService — resolve a sheet's config + providers into a render model.
 *
 * This is the framework's only decision-maker outside the pure layout function.
 * YAML declares SHAPE (page, blocks, grid, cell kind); the two injected registries
 * supply SUBSTANCE (`source` → provider, `cell.kind` → renderer). Neither registry
 * is imported here — they arrive as constructor arguments — which is what keeps
 * `3_applications/` from reaching into the composition layer and what lets this
 * whole file be tested against two literals and a stub.
 *
 * FAILURE POLICY — the design rule everything else follows from. It splits on
 * whether the defect would be VISIBLE ON PAPER:
 *
 *   Structural → reject, emit NO model. An unknown sheet id, an unknown `source`,
 *   an unknown `cell.kind`, an unknown page size, or a provider that throws all
 *   abort the build before anything is returned. A partially rendered sheet is the
 *   worst outcome available: a laminated page with a silently missing bank of codes
 *   is discovered at the fridge, weeks later, by somebody holding a bowl of rice —
 *   rather than at the printer, by whoever asked for it. Reprints are expensive; a
 *   failed build is free.
 *
 *   Cosmetic → log and continue. An underfull block (fewer items than the grid
 *   holds) prints a short final row. That is legitimate — `rows` is a per-page
 *   maximum, not a quota — so it logs at debug and never blocks the sheet.
 *
 * HAZARD — the error strings are a contract, not prose. The route distinguishes
 * 404 from 500 by matching /unknown (sheet|source|cell kind|page size)/i, so those
 * exact words must survive any rewording, and the test pins them.
 *
 * @module applications/sheets/SheetService
 */

import { createHash } from 'node:crypto';
import { layout } from '#rendering/pdf/SheetLayout.mjs';

/**
 * The only page sizes this framework prints, in PDF points.
 *
 * Two, deliberately. Everything here ends up on a home printer feeding US Letter
 * or A4; a third entry would be speculative, and an unrecognised size must fail
 * loudly rather than silently defaulting to Letter and cropping an A4 design.
 */
const PAGE_SIZES = Object.freeze({
  letter: { widthPt: 612, heightPt: 792 },
  a4: { widthPt: 595, heightPt: 842 },
});

const DEFAULT_MARGIN_PT = 36;
const DEFAULT_GAP_PT = 8;
const DEFAULT_COLS = 3;
const DEFAULT_ROWS = 5;

/**
 * Stand-in for an item that carries no `code` at all — today, the `nutrition.foods`
 * items, which are readable text because no food grammar exists yet.
 *
 * It must NOT be the empty string or `String(undefined)`: `undefined` would let a
 * codeless item hash identically to an item whose code is the literal text
 * "undefined", and would put a nonsense token in the provenance hash. NUL is used
 * because no scannable code can contain it, so a placeholder can never collide with
 * a real payload. Codeless items still occupy a slot in the hash input, so adding or
 * removing one changes the fingerprint — which is right: the sheet's contents moved.
 */
const NO_CODE = '\u0000';

/**
 * Translate one block's `cell:` config into the opts a renderer receives.
 *
 * MISMATCH THIS EXISTS TO ABSORB: YAML is snake_case (`size_pt`) and the cell
 * renderers read camelCase (`opts.sizePt`). Passing `cell` through raw would leave
 * `size_pt` unread and every QR silently sized from the rect instead of the
 * configured module size. The config→model translation belongs in this layer, so
 * the mapping happens here once rather than in each renderer.
 *
 * The raw keys are kept alongside the camelCase ones so a renderer added later can
 * read a config key nobody has mapped yet without a change here.
 */
function toCellOpts(cell = {}) {
  const opts = { ...cell };
  if (cell.size_pt !== undefined) opts.sizePt = cell.size_pt;
  if (cell.gap_pt !== undefined) opts.gapPt = cell.gap_pt;
  return opts;
}

/**
 * Build the sheet service.
 *
 * @param {object} deps
 * @param {() => object} deps.getConfig Returns the whole sheets config
 *   (`{ defaults, sheets }`). Called per build, so an edited sheets.yml reaches the
 *   next request without rebuilding the service.
 * @param {Record<string, (params: object, ctx: object) => Array<object>|Promise<Array<object>>>} deps.providers
 *   Item providers keyed by the `source` string in config.
 * @param {Record<string, Function>} deps.cellKinds Renderers keyed by `cell.kind`.
 *   Only their PRESENCE is checked here; this service never calls one.
 * @param {{debug?: Function, warn?: Function}} [deps.logger]
 * @returns {{ build: (sheetId: string, params?: object) => Promise<object> }}
 */
export function createSheetService({ getConfig, providers, cellKinds, logger = console }) {
  /**
   * Resolve a sheet into `{ sheetId, title, page, blocks, placements, fingerprint }`.
   *
   * @param {string} sheetId Key under `sheets:` in config.
   * @param {object} [params] Opaque request parameters, forwarded verbatim to every
   *   provider. This service never interprets them — a provider that wants a
   *   household id or a limit reads it here.
   */
  async function build(sheetId, params = {}) {
    const config = getConfig() || {};
    const spec = config.sheets?.[sheetId];
    if (!spec) throw new Error(`unknown sheet "${sheetId}"`);

    const defaults = config.defaults || {};
    const sizeKey = spec.page?.size || defaults.page?.size || 'letter';
    const size = PAGE_SIZES[sizeKey];
    if (!size) throw new Error(`unknown page size "${sizeKey}" in sheet "${sheetId}"`);
    const page = {
      ...size,
      marginPt: spec.page?.margin_pt ?? defaults.page?.margin_pt ?? DEFAULT_MARGIN_PT,
    };

    // Sequential and eager-throwing on purpose. Resolving blocks in parallel would
    // buy nothing (providers read config, not the network) and would cost the
    // guarantee that matters: the first structural failure aborts before any model
    // exists to be half-returned.
    const blocks = [];
    for (const [i, b] of (spec.blocks || []).entries()) {
      const provider = providers[b.source];
      if (!provider) throw new Error(`unknown source "${b.source}" in sheet "${sheetId}"`);

      const kind = b.cell?.kind || defaults.cell?.kind || 'qr';
      if (!cellKinds[kind]) throw new Error(`unknown cell kind "${kind}" in sheet "${sheetId}"`);

      // Awaited, not wrapped: a provider that throws (an encoder rejecting an
      // unprintable code, say) is structural, and its error must reach the caller
      // unaltered so the message names the offending row.
      const items = await provider(params, { sheetId });

      blocks.push({
        // `id` keys the placement records back to this block, so it must be stable
        // and unique. `source` is the natural name; the index is the tiebreaker for
        // a sheet that draws two blocks from one provider.
        id: b.id || b.source || `block-${i}`,
        title: b.title,
        cols: b.grid?.cols ?? DEFAULT_COLS,
        rows: b.grid?.rows ?? DEFAULT_ROWS,
        gapPt: b.cell?.gap_pt ?? defaults.cell?.gap_pt ?? DEFAULT_GAP_PT,
        // Width/height of the mark. Left undefined when unset so the layout applies
        // its own square default rather than this layer guessing a framed ratio.
        aspect: b.cell?.aspect ?? defaults.cell?.aspect,
        // Caps how wide a cell may grow. Without it a block's cell size is purely
        // page-width / cols, so "3 across but compact" is inexpressible and a
        // multi-block sheet sprawls over pages of whitespace.
        maxCellWPt: b.cell?.max_w_pt ?? defaults.cell?.max_w_pt,
        kind,
        cellOpts: toCellOpts(b.cell),
        items,
      });
    }

    const placements = layout({
      page,
      blocks: blocks.map((b) => ({
        id: b.id,
        title: b.title,
        cols: b.cols,
        rows: b.rows,
        count: b.items.length,
        gapPt: b.gapPt,
        aspect: b.aspect,
        maxCellWPt: b.maxCellWPt,
      })),
    });

    for (const u of placements.underfull || []) {
      // Cosmetic, and often correct — but worth saying out loud, because a fridge
      // sheet with four of twenty-five container slots filled usually means the
      // provider's config went missing rather than that the household owns four
      // containers.
      logger.debug?.('sheet.block.underfull', { sheet: sheetId, ...u });
    }

    // Fingerprint the CODES — not the config file, not the labels.
    //
    // This string is printed in the sheet footer so somebody holding a laminated
    // page can tell whether it still matches what the backend believes. What that
    // comparison is about is the PAYLOADS: a relabelled button still scans the same
    // and the old sheet is still correct, whereas a renamed container id orphans
    // every printed code on the page. Hashing the config file would cry wolf on
    // every cosmetic edit; hashing the labels would miss the failure that matters.
    const fingerprint = createHash('sha256')
      .update(blocks.flatMap((b) => b.items.map((it) => (
        typeof it.code === 'string' && it.code ? it.code : NO_CODE
      ))).join(' '))
      .digest('hex')
      .slice(0, 6);

    return { sheetId, title: spec.title || sheetId, page, blocks, placements, fingerprint };
  }

  return { build };
}
