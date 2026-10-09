// backend/src/2_domains/automotive/entities/Document.mjs

/**
 * A glove-box item: insurance card, registration, title, manual, purchase or
 * sale paperwork.
 *
 * The point of a glove box on a phone is **retrieval under pressure** — at a
 * traffic stop, at a shop counter, at a parts desk. That shapes the model more
 * than it might seem: a document is little more than a label, a file, and
 * (sometimes) an expiry, because anything more elaborate is something else to
 * go wrong at the moment it is least welcome.
 *
 * An `expires` date makes a document a reminder source, handled by
 * `ReminderService` identically to a service interval. A registration renewal
 * and an oil change are the same kind of problem — a date approaching — and the
 * household wants one list of what needs attention, not two.
 *
 * @module automotive/entities/Document
 */

import { ValidationError } from '#domains/core/errors/index.mjs';

export const DOCUMENT_KINDS = Object.freeze([
  'insurance', 'registration', 'title', 'manual', 'purchase', 'sale', 'inspection', 'other',
]);

export class Document {
  #id; #kind; #label; #file; #issued; #expires; #notes;

  constructor({ id, kind = 'other', label, file = null, issued = null, expires = null, notes = '' }) {
    if (!id || typeof id !== 'string') {
      throw new ValidationError('Document requires an id', { code: 'DOC_ID_REQUIRED', field: 'id', value: id });
    }
    if (!DOCUMENT_KINDS.includes(kind)) {
      throw new ValidationError(`Document kind must be one of: ${DOCUMENT_KINDS.join(', ')}`, {
        code: 'DOC_KIND_INVALID', field: 'kind', value: kind,
      });
    }
    this.#id = id;
    this.#kind = kind;
    this.#label = label || id;
    this.#file = file;
    this.#issued = toDateOrNull(issued);
    this.#expires = toDateOrNull(expires);
    this.#notes = notes || '';
  }

  get id() { return this.#id; }
  get kind() { return this.#kind; }
  get label() { return this.#label; }
  get file() { return this.#file; }
  get issued() { return this.#issued ? new Date(this.#issued.getTime()) : null; }
  get expires() { return this.#expires ? new Date(this.#expires.getTime()) : null; }
  get notes() { return this.#notes; }

  /** Does this document feed the reminder list? */
  get isExpiring() { return this.#expires !== null; }

  /** @param {Date} asOf */
  isExpiredAt(asOf) {
    return this.#expires !== null && this.#expires < asOf;
  }

}

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
