/**
 * RenderPrintDocument — the v2 print pipeline assembled (spec §3 governing
 * idea 1, §7 fit orchestration). Validates either envelope generation, then:
 *
 *   - v1 (schema-less) documents delegate straight to the legacy renderer
 *     entry, UNCHANGED — same theme, same options shape, byte-identical to
 *     calling that renderer directly. v2 is additive, never a migration.
 *   - v2 documents run the fit loop `fit.mjs`'s own docs describe: measure at
 *     normal density always; measure again at compact ONLY when fit policy
 *     `one-page` needs the fallback (`flow`/`fill` never try compact — see
 *     `resolveFitPlan`); feed the measured attempt(s) to `resolveFitPlan`;
 *     render once, at the chosen density, with furniture (footer +
 *     continuation strip + archetype-driven gutter/duplex) and `growLastPage`
 *     threaded through.
 *
 * D1 NOTE: this file imports `1_rendering` directly, unlike the rest of
 * `3_applications` (which reaches rendering only through the `IDocumentRenderer`
 * port — see that port's own docstring). `fit.mjs`'s docstring names this use
 * case, explicitly, as the one place allowed to run rendering's measurement
 * loop: "the loop that actually RUNS measurement at each density ... is Task
 * 8's use case (3_applications), which is allowed to call rendering." Every
 * rendering dependency is still constructor-injectable (`renderer`, `measure`,
 * `layout`) so callers/tests can substitute fakes exactly like a port would
 * allow.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { validateAnyDocument, DOCUMENT_V2_SCHEMA } from '#domains/school/documents/documentV2.mjs';
import { resolveFitPlan } from '#domains/school/documents/fit.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments, contentHeightPt } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';
import { texToSvg as mathJaxTexToSvg } from '#rendering/school/documents/mathSvg.mjs';

/** Archetypes bound through a physical binder get the alternating gutter (spec §7 furniture). */
const DUPLEX_ARCHETYPES = new Set(['worksheet']);

export class RenderPrintDocument {
  #repository; #rendererFactory; #createMeasurementDocument; #measureDocumentFragments;
  #placeFragments; #contentHeightPt; #texToSvg; #resolveAsset; #legacyRenderer;

  /**
   * @param {Object} [deps]
   * @param {{get: (id: string) => (object|Promise<object>)}} [deps.repository] -
   *   resolves `execute({id})`; required only when `id` (not `document`) is used
   * @param {Function} [deps.renderer] - `({theme?, texToSvg, resolveAsset, fontDir?}) => {render}`;
   *   defaults to `createDocumentPdfRenderer`. Called once per density (v2) or
   *   once for the legacy theme (v1) — cheap, so never cached across calls.
   * @param {{createMeasurementDocument: Function, measureDocumentFragments: Function}} [deps.measure]
   * @param {{placeFragments: Function, contentHeightPt: Function}} [deps.layout]
   * @param {Function} [deps.texToSvg] - TeX → SVG; defaults to the real MathJax renderer
   * @param {Function|null} [deps.resolveAsset] - (ref) => {svg, widthPt, heightPt}; default
   *   throws on any asset reference, matching `createDocumentPdfRenderer`'s own default
   */
  constructor({
    repository = null,
    renderer = createDocumentPdfRenderer,
    measure = { createMeasurementDocument, measureDocumentFragments },
    layout = { placeFragments, contentHeightPt },
    texToSvg = mathJaxTexToSvg,
    resolveAsset = null,
  } = {}) {
    this.#repository = repository;
    this.#rendererFactory = renderer;
    this.#createMeasurementDocument = measure.createMeasurementDocument;
    this.#measureDocumentFragments = measure.measureDocumentFragments;
    this.#placeFragments = layout.placeFragments;
    this.#contentHeightPt = layout.contentHeightPt;
    this.#texToSvg = texToSvg;
    this.#resolveAsset = resolveAsset;
    // The legacy (v1) render target: default theme, no furniture, no
    // growLastPage — literally what `createDocumentPdfRenderer(...)` already
    // meant before this use case existed.
    this.#legacyRenderer = this.#rendererFactory({ texToSvg: this.#texToSvg, resolveAsset: this.#resolveAsset });
  }

  /**
   * @param {Object} args
   * @param {Object} [args.document] - a raw (unvalidated) document, v1 or v2 envelope
   * @param {string} [args.id] - looked up via `repository` when `document` is not given
   * @param {{learnerName?: string, date?: string, gutter?: boolean|number}} [args.context] -
   *   `learnerName`/`date` prefill the header's Name/Date lines (blank ruled lines
   *   when absent); `gutter` overrides the default 3-hole-punch reservation
   *   (v2 only — must be >= 0).
   * @returns {Promise<{bytes: Buffer, pageCount: number, density: 'normal'|'compact'|null, warnings: string[]}>}
   *   `density` is null for a v1 (legacy-path) document, which has no density concept.
   */
  async execute({ document: rawDocument, id, context = {} } = {}) {
    const raw = rawDocument !== undefined ? rawDocument : (id !== undefined ? await this.#loadById(id) : undefined);
    if (raw === undefined) {
      throw new ValidationError('RenderPrintDocument.execute requires a document or an id', { code: 'MISSING_DOCUMENT' });
    }

    const { errors, document } = validateAnyDocument(raw);
    if (errors.length) {
      throw new ValidationError(`print document is invalid: ${errors.join('; ')}`, {
        code: 'INVALID_DOCUMENT', details: { errors },
      });
    }

    return document.schema === DOCUMENT_V2_SCHEMA
      ? this.#renderV2(document, context)
      : this.#renderLegacy(document, context);
  }

  async #loadById(id) {
    if (!this.#repository) {
      throw new ValidationError('RenderPrintDocument.execute({id}) requires a repository', { code: 'MISSING_REPOSITORY' });
    }
    const raw = await this.#repository.get(id);
    if (!raw) {
      throw new ValidationError(`no print document found for id '${id}'`, { code: 'DOCUMENT_NOT_FOUND', details: { id } });
    }
    return raw;
  }

  /** v1: the legacy render entry, untouched — same theme, same option shape. */
  async #renderLegacy(document, context) {
    const result = await this.#legacyRenderer.render(document, { studentName: context.learnerName ?? null });
    return {
      bytes: result.pdf, pageCount: result.pageCount, density: null, warnings: [],
    };
  }

  /** v2: fit loop, then one furniture-aware render at the chosen density. */
  async #renderV2(document, context) {
    const gutter = this.#resolveGutter(context);
    const furnitureOpts = {
      gutter,
      duplex: DUPLEX_ARCHETYPES.has(document.archetype),
      title: document.title || document.id,
      nameLine: context.learnerName ?? null,
    };

    const normalTheme = createWorkbookTheme({ typeScale: document.fit.typeScale, density: 'normal' });
    const normalAttempt = this.#measureAttempt(document, normalTheme, 'normal', context, furnitureOpts);

    const attempts = [normalAttempt];
    let compactTheme = null;
    // Measurement at compact density is run ONLY when `one-page` needs the
    // fallback (`fit.mjs`'s own contract) — `flow`/`fill` never try compact.
    if (document.fit.policy === 'one-page' && normalAttempt.pageCount !== 1) {
      compactTheme = createWorkbookTheme({ typeScale: document.fit.typeScale, density: 'compact' });
      attempts.push(this.#measureAttempt(document, compactTheme, 'compact', context, furnitureOpts));
    }

    const plan = resolveFitPlan({ policy: document.fit.policy, attempts });
    if (plan.error) {
      throw new ValidationError(
        `document '${document.id}' does not fit fit.policy '${document.fit.policy}' even at compact density`,
        { code: plan.error.code, details: { oversetPt: plan.error.oversetPt, documentId: document.id } },
      );
    }

    const chosen = plan.attempt;
    const chosenTheme = chosen.density === 'compact' ? compactTheme : normalTheme;
    const renderer = this.#rendererFactory({
      theme: chosenTheme, texToSvg: this.#texToSvg, resolveAsset: this.#resolveAsset,
    });
    const result = await renderer.render(document, {
      studentName: context.learnerName ?? null,
      date: context.date ?? null,
      furniture: furnitureOpts,
      growLastPage: chosen.growLastPage ?? false,
      // v2's `*italic*` markdown grammar (spec §12.8) — v1 never opts in.
      // Measurement (`#measureAttempt` below) opts in with the SAME flag, so
      // wrap positions measured at fit-decision time can never drift from
      // what actually gets drawn here.
      italic: true,
    });

    const warnings = chosen.density === 'compact'
      ? [`fit.policy 'one-page' required compact density to fit '${document.id}' on one page`]
      : [];

    return {
      bytes: result.pdf, pageCount: result.pageCount, density: chosen.density, warnings,
    };
  }

  /**
   * `context.gutter` overrides the furniture default (`true`, i.e. the
   * theme's standard 3-hole-punch reservation — see `furniture.mjs`
   * `gutterSides`). A negative width would flip `contentBox`'s left/right
   * math into a nonsensical (negative-width) content area, so it is rejected
   * here rather than left for `contentBox` to silently mis-measure.
   */
  #resolveGutter(context) {
    const { gutter } = context;
    if (gutter === undefined) return true;
    if (typeof gutter === 'number' && gutter < 0) {
      throw new ValidationError('context.gutter must be >= 0', { code: 'INVALID_GUTTER', details: { gutter } });
    }
    return gutter;
  }

  /**
   * One density's trial: measure + place (furniture-aware, via `contentBox`)
   * to learn `pageCount`, and — only when it overflowed — `oversetPt`: how far
   * a single page's budget would have been exceeded, from `contentHeightPt`
   * (spec §7's fit contract). No bytes are produced here; the chosen attempt
   * is re-rendered for real once (see `#renderV2`) — same pure measure/place
   * functions either time, so the two calls cannot disagree about size.
   */
  #measureAttempt(document, theme, density, context, furnitureOpts) {
    // Computed BEFORE measurement so its gutter-adjusted `widthPt` reaches
    // the SAME measurement pass that decides wrap points (F2) — the final
    // render (`#renderV2` → DocumentPdfRenderer.renderPlaced) computes this
    // identically from the same `theme`/`furnitureOpts`, so a fit decision
    // made here can never disagree with what actually gets drawn.
    const box = contentBox(theme, furnitureOpts);
    const measurementDoc = this.#createMeasurementDocument({ theme });
    const fragments = this.#measureDocumentFragments(document, {
      doc: measurementDoc,
      theme,
      texToSvg: this.#texToSvg,
      resolveAsset: this.#resolveAsset,
      studentName: context.learnerName ?? null,
      widthPt: box.widthPt,
      // Must agree with the final render's `italic: true` (see #renderV2) —
      // a trial measured without it could pick a density that then wraps
      // differently once the real render turns *emphasis* spans on.
      italic: true,
    });
    const { pages } = this.#placeFragments(fragments, {
      pageHeightPt: box.pageHeightPt, marginPt: box.marginPt, spacing: theme.spacing,
    });

    const pageCount = pages.length;
    let oversetPt = 0;
    if (pageCount > 1) {
      const totalPt = this.#contentHeightPt(fragments, { spacing: theme.spacing });
      const availablePt = box.pageHeightPt - 2 * box.marginPt;
      oversetPt = Math.max(0, totalPt - availablePt);
    }
    return { density, pageCount, oversetPt };
  }
}

export default RenderPrintDocument;
