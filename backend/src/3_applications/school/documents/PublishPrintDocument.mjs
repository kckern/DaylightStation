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
 */
import { ValidationError } from '#domains/core/errors/index.mjs';
import { publishDocument } from '#domains/school/documents/documentSource.mjs';

export class PublishPrintDocument {
  #repository;

  /**
   * @param {Object} deps
   * @param {{get: (id: string) => (*|Promise<*>), writePublished: Function}} deps.repository -
   *   `get(id)` resolves a raw SOURCE document by id (for `execute({id})`);
   *   `writePublished({document, bank, rev})` persists the publish output.
   */
  constructor({ repository } = {}) {
    if (!repository || typeof repository.writePublished !== 'function') {
      throw new Error('PublishPrintDocument requires a repository with writePublished');
    }
    this.#repository = repository;
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
