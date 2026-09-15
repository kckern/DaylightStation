/**
 * PublishPrintDocument — the publish use case (spec §3, Task 5). Wraps the
 * pure domain transform (`documentSource.mjs`'s `publishDocument`) with the
 * one thing a domain function may never do itself: persist its output.
 *
 * `publishDocument` already guarantees (as its own postcondition) that it
 * never returns a half-valid pair — either `{errors}` or a published document
 * that re-validates strict PLUS (when it minted anything) a derived bank that
 * re-validates as a real question bank. This use case adds exactly one more
 * guarantee on top: what gets written to disk is exactly what was validated,
 * via the repository's own append-only contract (`writePublished` refuses to
 * silently replace a rev's content with something different).
 *
 * Plus one optional gate, `texLint`: every inline `$…$` in the published
 * document is rendered ONCE HERE, before the write, so a TeX error surfaces
 * as a publish refusal rather than at the learner's print. Publish runs
 * before card allocation in `IssueDocument`, which is the whole point — on
 * 2026-09-15 a bank's `$230, 240, 250, ___$` reached MathJax for the first
 * time inside a child's print, after his answer-card rows were already
 * durably claimed; three retries burned two row ranges and rolled his card.
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { publishDocument } from '#domains/school/documents/documentSource.mjs';

export class PublishPrintDocument {
  #repository; #texLint;

  /**
   * @param {Object} deps
   * @param {{get: (id: string) => (*|Promise<*>), writePublished: Function}} deps.repository -
   *   `get(id)` resolves a raw SOURCE document by id (for `execute({id})`);
   *   `writePublished({document, bank, rev})` persists the publish output.
   * @param {(published: object) => string[]} [deps.texLint] - renders every
   *   inline TeX segment of the published document and returns the errors
   *   (`1_rendering/school/documents/texLint.mjs`'s `lintTex`). Optional so
   *   a caller with no renderer (tests, CLIs) publishes as before.
   */
  constructor({ repository, texLint = null } = {}) {
    if (!repository || typeof repository.writePublished !== 'function') {
      throw new Error('PublishPrintDocument requires a repository with writePublished');
    }
    if (texLint !== null && typeof texLint !== 'function') {
      throw new Error('PublishPrintDocument texLint must be a function when given');
    }
    this.#repository = repository;
    this.#texLint = texLint;
  }

  /**
   * @param {Object} args
   * @param {Object} [args.source] - a raw (unvalidated) `school.document-source/v1` document
   * @param {string} [args.id] - looked up via `repository.get(id)` when `source` is not given
   * @returns {Promise<{id: string, rev: string, bankId: string|null, warnings: string[]}>}
   */
  async execute({ source, id } = {}) {
    const raw = source !== undefined ? source : (id !== undefined ? await this.#repository.get(id) : undefined);
    if (raw === undefined || raw === null) {
      if (id !== undefined) {
        throw new ValidationError(`no print document source found for id '${id}'`, {
          code: 'DOCUMENT_NOT_FOUND', details: { id },
        });
      }
      throw new ValidationError('PublishPrintDocument.execute requires a source or an id', {
        code: 'MISSING_SOURCE',
      });
    }

    const result = publishDocument(raw);
    if (result.errors) {
      throw new ValidationError(`print document source is invalid: ${result.errors.join('; ')}`, {
        code: 'INVALID_DOCUMENT_SOURCE', details: { errors: result.errors },
      });
    }

    const { published, bank, rev } = result;
    const texErrors = this.#texLint ? this.#texLint(published) : [];
    if (texErrors.length) {
      throw new ValidationError(`print document has TeX that does not render: ${texErrors.join('; ')}`, {
        code: 'INVALID_DOCUMENT_TEX', details: { errors: texErrors },
      });
    }
    const writeResult = await this.#repository.writePublished({ document: published, bank, rev });

    const warnings = [];
    if (writeResult?.document?.alreadyPublished) {
      warnings.push(`document '${published.id}' rev '${rev}' was already published (identical content); nothing changed`);
    }
    if (!bank) {
      warnings.push(`document '${published.id}' has no answer-bearing content; no derived question bank was produced`);
    }

    return {
      id: published.id, rev, bankId: bank?.id ?? null, warnings,
    };
  }
}

export default PublishPrintDocument;
