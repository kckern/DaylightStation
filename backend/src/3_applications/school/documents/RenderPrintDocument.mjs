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
import path from 'node:path';
import { ValidationError } from '#domains/core/errors/index.mjs';
import { validateAnyDocument, DOCUMENT_V2_SCHEMA } from '#domains/school/documents/documentV2.mjs';
import { DOCUMENT_SOURCE_SCHEMA, publishDocument } from '#domains/school/documents/documentSource.mjs';
import { deriveShuffle, applyShuffle } from '#domains/school/documents/shuffle.mjs';
import { resolveFitPlan } from '#domains/school/documents/fit.mjs';
import { createWorkbookTheme } from '#rendering/school/documents/workbookTheme.mjs';
import { createDocumentPdfRenderer } from '#rendering/school/documents/DocumentPdfRenderer.mjs';
import { createMeasurementDocument, measureDocumentFragments } from '#rendering/school/documents/measure.mjs';
import { placeFragments, contentHeightPt } from '#rendering/school/documents/layout.mjs';
import { contentBox } from '#rendering/school/documents/furniture.mjs';
import { texToSvg as mathJaxTexToSvg } from '#rendering/school/documents/mathSvg.mjs';
import { listYamlFiles, loadYaml } from '#system/utils/FileIO.mjs';

/** Archetypes bound through a physical binder get the alternating gutter (spec §7 furniture). */
const DUPLEX_ARCHETYPES = new Set(['worksheet']);

/**
 * Default `banks` dependency for bank-select sugar (spec §6.2, Task 5):
 * synchronous `{getBank(id)}`, same shape `IssueDocument`/`PrintService`'s
 * `bankReader` already use elsewhere in this codebase — mirrored here rather
 * than reused because those two live in a different part of the School
 * application (the pre-Phase-B quiz/worksheet delivery path) with their own
 * injection story. Reads from the school content mount's question-banks
 * directory — the SAME default `schoolCatalog.mjs`'s composition wiring
 * resolves (`content/school/catalog/question-banks`) and the same
 * `$DAYLIGHT_BASE_PATH`-relative convention `school-docs.cli.mjs` uses for
 * its own content-root resolution.
 */
function defaultBankReader() {
  const dataDir = process.env.DAYLIGHT_BASE_PATH
    ? path.join(process.env.DAYLIGHT_BASE_PATH, 'data')
    : '/usr/src/app/data';
  const directory = path.resolve(dataDir, 'content/school/catalog/question-banks');
  return {
    getBank(bankId) {
      const files = [...listYamlFiles(directory, { recursive: true })].sort();
      for (const relative of files) {
        const raw = loadYaml(path.join(directory, relative));
        if (raw && raw.id === bankId) return raw;
      }
      return null;
    },
  };
}

/** Bank-item types a bank-select sugar block can expand into a printable `question` (see `#expandBankSelectSugar`). */
const BANK_SELECT_RENDERABLE_TYPES = new Set(['multiple_choice', 'multi_select', 'short_answer']);

/**
 * One selected bank item -> one concrete, numbered `question` block — the
 * exact node pair an author would hand-write inline (spec §6.1's "Kept;
 * extended with... the multi_select shape"): `omr_response.itemId` is set to
 * the bank item's own id, which is what `documentValidation.mjs`'s "omr_response
 * itemId must match its question itemId" rule already requires, and what
 * `DocumentPdfRenderer`'s `createChoiceResolver(bank)` looks up choice text by.
 * `short_answer` reuses the `short_answer` SUGAR block (not a hand-rolled
 * `answer_space`) so its own default-lines geometry stays the single source
 * of truth.
 */
function expandedQuestionBlock(item, { number, points }) {
  if (item.type === 'short_answer') {
    return {
      type: 'question', itemId: item.id, number, points, blocks: [{ type: 'short_answer', prompt: item.prompt }],
    };
  }
  return {
    type: 'question',
    itemId: item.id,
    number,
    points,
    blocks: [
      { type: 'rich_text', md: item.prompt },
      { type: 'omr_response', itemId: item.id, choices: item.choices.length },
    ],
  };
}

/**
 * `wordbank`/`matching` orders are shuffled by their `key` BEFORE measurement
 * (spec §6.2) — terms/left/right print in seeded order, never document order.
 * Recurses only where these two block types can legally occur: document top
 * level, or one level inside a `question`'s own `blocks[]` (both `inset` and
 * `question` itself reject nesting a `question`, and `inset` separately bans
 * `wordbank`/`matching`/`cloze` outright — see `blocks.mjs`'s
 * `INSET_UNSUPPORTED_CHILD_TYPES` — so `inset.blocks[]` is walked here only
 * for completeness/forward-safety, never actually finding either type).
 *
 * `matching`'s two lists are shuffled INDEPENDENTLY (spec §6.2's "two
 * seeded-shuffled lists") — one derived permutation per side, from the SAME
 * `key` but a distinct hash input (`deriveShuffle`'s `key` argument is a
 * plain PRNG-seed string, not re-validated against `SHUFFLE_KEY_PATTERN`, so
 * a suffix here is safe even though an AUTHORED key could never contain
 * one). The derived bank's `pairs` (canonical left/right correspondence) are
 * never touched — only the PRINTED presentation order changes.
 */
function shuffleAssessmentBlocks(blocks, seed, variant) {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((block) => {
    if (!block || typeof block !== 'object') return block;
    if (block.type === 'wordbank' && Array.isArray(block.terms)) {
      const permutation = deriveShuffle(seed, variant, block.key, block.terms.length);
      return { ...block, terms: applyShuffle(block.terms, permutation) };
    }
    if (block.type === 'matching' && Array.isArray(block.left) && Array.isArray(block.right)) {
      const leftPermutation = deriveShuffle(seed, variant, `${block.key}:left`, block.left.length);
      const rightPermutation = deriveShuffle(seed, variant, `${block.key}:right`, block.right.length);
      return {
        ...block,
        left: applyShuffle(block.left, leftPermutation),
        right: applyShuffle(block.right, rightPermutation),
      };
    }
    if ((block.type === 'question' || block.type === 'inset') && Array.isArray(block.blocks)) {
      return { ...block, blocks: shuffleAssessmentBlocks(block.blocks, seed, variant) };
    }
    return block;
  });
}

/**
 * `totalPoints` (spec §13): sum of every scored (`question`) block's
 * `points ?? defaultPoints`, INCLUDING bank-selected questions — safe to scan
 * only top-level blocks because a `question` can never nest (inside another
 * `question` or an `inset`, both banned by `blocks.mjs`) and, by the time
 * this runs, `#expandBankSelectSugar` has already replaced every bank-select
 * sugar block with concrete numbered `question` blocks — there is no
 * remaining `select` branch to special-case.
 */
function sumScoredPoints(blocks, defaultPoints) {
  if (!Array.isArray(blocks)) return 0;
  return blocks.reduce((total, block) => (
    block?.type === 'question'
      ? total + (typeof block.points === 'number' ? block.points : defaultPoints)
      : total
  ), 0);
}

/** Merges the document's own derived bank (if any) with bank-select-resolved items into ONE `{id, items}` bank, or null if there is nothing at all. */
function mergeBank(baseBank, extraItems, documentId) {
  const items = [...(baseBank?.items ?? []), ...extraItems];
  if (items.length === 0) return null;
  return { id: baseBank?.id ?? documentId, items };
}

export class RenderPrintDocument {
  #repository; #rendererFactory; #createMeasurementDocument; #measureDocumentFragments;
  #placeFragments; #contentHeightPt; #texToSvg; #resolveAsset; #legacyRenderer; #banks;

  /**
   * @param {Object} [deps]
   * @param {{get: (id: string) => (object|Promise<object>), getDerivedBank?: Function}} [deps.repository] -
   *   resolves `execute({id})`; required only when `id` (not `document`) is used.
   *   `getDerivedBank(id, rev)` (Task 5), when present, resolves the derived
   *   bank behind a PUBLISHED (`rev`-carrying) v2 document.
   * @param {{getBank: (id: string) => (object|null)}} [deps.banks] - resolves a
   *   bank-select sugar block's `bankId` (spec §6.2, Task 5). Defaults to a YAML
   *   reader over the school content mount's question-banks directory (see
   *   `defaultBankReader`).
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
    banks = null,
    renderer = createDocumentPdfRenderer,
    measure = { createMeasurementDocument, measureDocumentFragments },
    layout = { placeFragments, contentHeightPt },
    texToSvg = mathJaxTexToSvg,
    resolveAsset = null,
  } = {}) {
    this.#repository = repository;
    this.#banks = banks ?? defaultBankReader();
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

    if (document.schema === DOCUMENT_SOURCE_SCHEMA) {
      // Source-schema inputs are auto-published IN MEMORY for a proof render
      // (spec §3) — nothing is persisted here; `PublishPrintDocument` is the
      // only path that writes published/derived-bank artifacts to disk.
      // `publishDocument` re-validates `raw` itself (it takes an unvalidated
      // source), so the `document` this branch already has (validated once,
      // above) is discarded in favor of publish's own postcondition-checked
      // output.
      const publishResult = publishDocument(raw);
      if (publishResult.errors) {
        throw new ValidationError(`print document is invalid: ${publishResult.errors.join('; ')}`, {
          code: 'INVALID_DOCUMENT', details: { errors: publishResult.errors },
        });
      }
      return this.#renderV2(publishResult.published, context, { bank: publishResult.bank });
    }

    if (document.schema === DOCUMENT_V2_SCHEMA) {
      const bank = await this.#resolvePublishedBank(document);
      return this.#renderV2(document, context, { bank });
    }

    return this.#renderLegacy(document, context);
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

  /**
   * A PUBLISHED v2 document (one that carries `rev`) resolves its derived
   * bank through the repository (spec §3/§4.3) — needed whenever the
   * document has an inline `multiple_choice`/`multi_select` question (its
   * `omr_response` choice text lives in the bank, never duplicated onto the
   * page) or will EVER be rendered as a teacher key (which reads answers off
   * the bank). A hand-authored v2 document with no `rev` was never published,
   * so there is nothing to look up — `bank` stays whatever bank-select sugar
   * resolution alone produces (`#renderV2`/`mergeBank`).
   */
  async #resolvePublishedBank(document) {
    if (typeof document.rev !== 'string' || !this.#repository
      || typeof this.#repository.getDerivedBank !== 'function') {
      return null;
    }
    const bank = await this.#repository.getDerivedBank(document.id, document.rev);
    return bank ?? null;
  }

  /** v1: the legacy render entry, untouched — same theme, same option shape. */
  async #renderLegacy(document, context) {
    const result = await this.#legacyRenderer.render(document, { studentName: context.learnerName ?? null });
    return {
      bytes: result.pdf, pageCount: result.pageCount, density: null, warnings: [],
    };
  }

  /**
   * Expands every bank-select sugar block (spec §6.2, Task 5) at document
   * TOP LEVEL — the only place a `question` can occur (`blocks.mjs` bans
   * nesting one inside another `question` or inside an `inset`) — into
   * concrete, numbered `question` blocks, and shuffles wordbank/matching
   * order. Returns the transformed document plus the bank items the
   * selections resolved (for `mergeBank` to fold into the render's bank).
   */
  #prepareV2Document(document) {
    const blocks = Array.isArray(document.blocks) ? document.blocks : [];

    // Numbering continues from the highest number a HAND-AUTHORED inline
    // question already uses, in whatever order the author wrote them —
    // inline questions keep their own author-assigned numbers untouched;
    // only bank-selected items get freshly minted ones.
    let nextNumber = blocks.reduce((max, block) => (
      block?.type === 'question' && block.select === undefined && Number.isInteger(block.number)
        ? Math.max(max, block.number) : max
    ), 0) + 1;
    const seenItemIds = new Set(blocks
      .filter((block) => block?.type === 'question' && block.select === undefined && typeof block.itemId === 'string')
      .map((block) => block.itemId));
    const extraItems = [];

    const expandedBlocks = blocks.flatMap((block) => {
      if (!block || block.type !== 'question' || block.select === undefined) return [block];
      const selected = this.#resolveBankSelect(block, document);
      return selected.map((item) => {
        if (!BANK_SELECT_RENDERABLE_TYPES.has(item.type)) {
          throw new ValidationError(
            `bank-select question (key '${block.key}') selected item '${item.id}' of type `
            + `'${item.type}', which has no print rendering yet`,
            {
              code: 'BANK_SELECT_UNSUPPORTED_ITEM_TYPE',
              details: {
                bankId: block.bankId, key: block.key, itemId: item.id, itemType: item.type,
              },
            },
          );
        }
        if (seenItemIds.has(item.id)) {
          throw new ValidationError(
            `bank-select question (key '${block.key}') selected item '${item.id}', which collides `
            + "with another question's itemId",
            { code: 'BANK_SELECT_ITEM_ID_COLLISION', details: { itemId: item.id } },
          );
        }
        seenItemIds.add(item.id);
        extraItems.push(item);
        const number = nextNumber;
        nextNumber += 1;
        return expandedQuestionBlock(item, { number, points: block.points ?? document.defaultPoints });
      });
    });

    const shuffledBlocks = shuffleAssessmentBlocks(expandedBlocks, document.seed, document.variant);
    return { document: { ...document, blocks: shuffledBlocks }, extraItems };
  }

  /**
   * `{bankId, select, key, filter?}` -> the first `select` items of
   * `applyShuffle(bank.items, deriveShuffle(seed, variant, key, bank.items.length))`
   * (spec §6.2's exact resolution formula). `filter` is validated upstream
   * (`blocks.mjs`) but not yet applied by this v1 picker — the spec frames it
   * as scaffolding for "the v2 adaptive hook", which replaces the PICKER
   * function, not the schema (spec §6.2); a `filter` present on a document is
   * therefore accepted and currently a no-op, same "accepted but no effect
   * yet" posture `school-docs.cli.mjs` already uses for its own
   * not-yet-wired proofing flags.
   */
  #resolveBankSelect(block, document) {
    const bank = this.#banks?.getBank ? this.#banks.getBank(block.bankId) : null;
    if (!bank || !Array.isArray(bank.items) || bank.items.length === 0) {
      throw new ValidationError(
        `bank-select question (key '${block.key}') references unknown or empty bank '${block.bankId}'`,
        { code: 'BANK_SELECT_BANK_NOT_FOUND', details: { bankId: block.bankId, key: block.key } },
      );
    }
    if (block.select > bank.items.length) {
      throw new ValidationError(
        `bank-select question (key '${block.key}') asked for ${block.select} items but bank `
        + `'${block.bankId}' has only ${bank.items.length}`,
        {
          code: 'BANK_SELECT_INSUFFICIENT_ITEMS',
          details: {
            bankId: block.bankId, key: block.key, available: bank.items.length, requested: block.select,
          },
        },
      );
    }
    const permutation = deriveShuffle(document.seed, document.variant, block.key, bank.items.length);
    return applyShuffle(bank.items, permutation).slice(0, block.select);
  }

  /** v2: fit loop, then one furniture-aware render at the chosen density. */
  async #renderV2(rawDocument, context, { bank: baseBank = null } = {}) {
    const { document, extraItems } = this.#prepareV2Document(rawDocument);
    const totalPoints = sumScoredPoints(document.blocks, document.defaultPoints);
    const bank = mergeBank(baseBank, extraItems, document.id);

    const gutter = this.#resolveGutter(context);
    const furnitureOpts = {
      gutter,
      duplex: DUPLEX_ARCHETYPES.has(document.archetype),
      title: document.title || document.id,
      nameLine: context.learnerName ?? null,
    };

    const normalTheme = createWorkbookTheme({ typeScale: document.fit.typeScale, density: 'normal' });
    const normalAttempt = this.#measureAttempt(document, normalTheme, 'normal', context, furnitureOpts, totalPoints);

    const attempts = [normalAttempt];
    let compactTheme = null;
    // Measurement at compact density is run ONLY when `one-page` needs the
    // fallback (`fit.mjs`'s own contract) — `flow`/`fill` never try compact.
    if (document.fit.policy === 'one-page' && normalAttempt.pageCount !== 1) {
      compactTheme = createWorkbookTheme({ typeScale: document.fit.typeScale, density: 'compact' });
      attempts.push(this.#measureAttempt(document, compactTheme, 'compact', context, furnitureOpts, totalPoints));
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
      // Bank threading + score box (spec §3, §13, Task 5): `bank` backs
      // `createChoiceResolver` (DocumentPdfRenderer.mjs) for any inline
      // `omr_response` — never null when the document actually needs one
      // (see `#resolvePublishedBank`/`mergeBank`); `totalPoints` is a pure
      // passthrough, already summed by `#renderV2` above.
      bank,
      totalPoints,
    });

    const warnings = [];
    if (chosen.density === 'compact') {
      warnings.push(`fit.policy 'one-page' required compact density to fit '${document.id}' on one page`);
    }
    // `#renderV2` is PDF/Letter-always in Phase A (spec §13: no receipt path
    // wired for v2 yet) — a document declaring ONLY `target: ['receipt']`
    // still comes out as a Letter PDF, furniture and all, not the continuous
    // roll its own envelope promises. Honest at render time rather than a
    // silent mismatch (F6).
    if (Array.isArray(document.target) && document.target.length > 0
      && document.target.every((target) => target === 'receipt')) {
      warnings.push(
        `document '${document.id}' declares target: ['receipt'] but v2 rendering is PDF/Letter-always in `
        + 'Phase A — it was rendered as a Letter PDF, not a receipt',
      );
    }

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
  #measureAttempt(document, theme, density, context, furnitureOpts, totalPoints) {
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
      // Must agree with the final render's `totalPoints` (same reasoning) —
      // the score box adds a header line, so a fit decision measured without
      // it could pick a density that then doesn't actually fit once the real
      // render's header grows by one line.
      totalPoints,
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
