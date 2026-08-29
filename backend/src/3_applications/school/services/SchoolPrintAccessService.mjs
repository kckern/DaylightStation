/**
 * Semantic access to authored print documents, sheet allocations, and rendering.
 * Card/document persistence precedence stays here; HTTP owns only transport.
 */
export class SchoolPrintAccessService {
  constructor({
    printDocumentsRepo = null,
    printAllocationStore = null,
    renderPrintDocument = null,
    getPrintTeacherPin = null,
  } = {}) {
    this.printDocumentsRepo = printDocumentsRepo;
    this.printAllocationStore = printAllocationStore;
    this.renderPrintDocument = renderPrintDocument;
    this.getPrintTeacherPin = getPrintTeacherPin;
  }

  isRenderable() { return Boolean(this.renderPrintDocument); }
  canResolveCards() { return Boolean(this.printAllocationStore?.findByCard); }

  async teacherPin() {
    return this.getPrintTeacherPin ? this.getPrintTeacherPin() : undefined;
  }

  async resolveCardPath(cardId) {
    if (!this.printAllocationStore?.findByCard) return { kind: 'unconfigured' };
    const record = newestUsableRecord(await this.printAllocationStore.findByCard(cardId));
    if (record) return { kind: 'found', record };
    return { kind: 'not_found', nearMissCardIds: await nearMissLiveCards(this.printAllocationStore, cardId) };
  }

  async isQuizDocument(id) {
    if (!this.printDocumentsRepo) return false;
    const document = (await this.printDocumentsRepo.getPublished(id)) ?? (await this.printDocumentsRepo.get(id));
    return document?.archetype === 'quiz';
  }

  async usableCardAllocation(cardId, documentId) {
    if (!this.printAllocationStore?.findByCard) return null;
    return newestUsableRecord((await this.printAllocationStore.findByCard(cardId))
      .filter((entry) => entry.documentId === documentId));
  }

  async usableDocumentAllocation(documentId, learnerId = null) {
    if (!this.printAllocationStore?.findByDocument) return null;
    return newestUsableRecord((await this.printAllocationStore.findByDocument(documentId))
      .filter((entry) => (learnerId ? entry.learnerId === learnerId : true)));
  }

  async nextVariant(documentId, learnerId = null) {
    if (!this.printAllocationStore?.findByDocument) return 0;
    const records = (await this.printAllocationStore.findByDocument(documentId))
      .filter((entry) => (learnerId ? entry.learnerId === learnerId : true));
    return records.reduce((max, entry) => Math.max(max, entry.variant ?? 0), -1) + 1;
  }

  async loadTarget({ id, rev = null, variant = null }) {
    if (!this.printDocumentsRepo) {
      return rev !== null || variant !== null ? { kind: 'unconfigured' } : { kind: 'found', target: { id } };
    }
    const raw = rev !== null
      ? await this.printDocumentsRepo.getPublished(id, rev)
      : ((await this.printDocumentsRepo.getPublished(id)) ?? (await this.printDocumentsRepo.get(id)));
    return raw
      ? { kind: 'found', target: { document: variant !== null ? { ...raw, variant } : raw } }
      : { kind: 'not_found' };
  }

  async render({ target, context, variety }) {
    if (!this.renderPrintDocument) return { kind: 'unconfigured' };
    const result = await this.renderPrintDocument.execute({ ...target, context });
    return {
      kind: 'rendered',
      bytes: result.bytes,
      allocation: result.allocation,
      warnings: variety === 'hand'
        ? (result.warnings ?? []).filter((warning) => !/without card allocation/.test(warning))
        : (result.warnings ?? []),
    };
  }

  async describeCard(cardId) {
    if (!this.printAllocationStore?.describeCard) return null;
    return this.printAllocationStore.describeCard(cardId);
  }

  async listLearnerCards(learnerId) {
    if (!this.printAllocationStore?.listCardIds || !this.printAllocationStore?.describeCard) return null;
    const cardIds = await this.printAllocationStore.listCardIds();
    return (await Promise.all(cardIds.map((cardId) => this.printAllocationStore.describeCard(cardId,
      { expectedLearnerId: learnerId })))).filter((card) => card.learnerIds.includes(learnerId));
  }

  /** Resolve identity/allocation policy and render a complete PDF representation. */
  async renderRequest(params) {
    const rawId = params.id;
    const variety = params.variety ?? 'omr';
    if (!['omr', 'hand'].includes(variety)) throw new ValidationError("variety must be 'omr' or 'hand'");

    let id = rawId;
    let cardFromPath = null;
    if (PRINT_CARD_ID.test(rawId)) {
      if (variety === 'hand') throw new ValidationError('a card-id path names an omr sheet; hand variety does not apply');
      for (const param of ['card', 'freshCard', 'startRow', 'retake']) {
        if (params[param] !== undefined) throw new ValidationError(`a card-id path already names the sheet; ${param} does not apply`);
      }
      const cardResult = await this.resolveCardPath(rawId);
      if (cardResult.kind === 'unconfigured') return { kind: 'unconfigured' };
      if (cardResult.kind === 'not_found') return { kind: 'card_not_found', cardId: rawId, nearMissCardIds: cardResult.nearMissCardIds };
      id = cardResult.record.documentId;
      cardFromPath = rawId;
    } else if (!PRINT_DOC_ID.test(rawId)) throw new ValidationError('id must be a lowercase document id');

    const context = {};
    const learnerName = params.learnerName;
    if (learnerName) context.learnerName = learnerName;
    const date = params.date;
    if (date) context.date = date;
    if (params.teacher) {
      const configuredPin = await this.teacherPin();
      if (configuredPin !== undefined) {
        if (configuredPin == null) return { kind: 'teacher_disabled' };
        if (params.pin !== String(configuredPin)) return { kind: 'teacher_pin_required' };
      }
      context.teacher = true;
    }

    const revParam = params.rev;
    if (revParam !== null && !/^[0-9a-f]{9}$/.test(revParam)) throw new ValidationError('rev must be 9 lowercase hex characters');
    let variant = params.variant ?? null;
    let rev = revParam;
    let adoptedRecord = null;
    let quizProbe;
    const isQuiz = async () => {
      if (quizProbe === undefined) quizProbe = await this.isQuizDocument(id);
      return quizProbe;
    };

    if (variety === 'omr') {
      const freshCard = params.freshCard;
      const card = cardFromPath ?? params.card;
      const learnerId = params.learnerId;
      if (freshCard && card) throw new ValidationError('freshCard and card are mutually exclusive');
      if (!card && !learnerId && !context.teacher && await isQuiz()) {
        throw new ValidationError('quiz sheets are per-student: add learnerId=<id> (or card=<7 digits> to reproduce a printed sheet)');
      }
      const adopt = (record) => {
        if (revParam !== null || variant !== null) {
          throw new ValidationError('this render reproduces an existing sheet; rev/variant come from its allocation record');
        }
        if (learnerId && (record.learnerId ?? null) !== learnerId) {
          const message = record.learnerId
            ? `card ${record.cardId} belongs to a different learner; omit learnerId to reproduce its sheet`
            : `card ${record.cardId} carries an anonymous sheet; omit learnerId to reproduce it`;
          throw new DomainInvariantError(message, { code: 'CARD_LEARNER_MISMATCH', details: { cardId: record.cardId } });
        }
        adoptedRecord = record;
        rev = record.rev;
        variant = record.variant;
        context.cardId = record.cardId ?? context.cardId;
        context.startRow = record.rowRange.start;
        if (record.learnerId) context.learnerId = record.learnerId;
      };
      const retake = params.retake;
      if (retake) {
        if (freshCard || card || revParam !== null || variant !== null) throw new ValidationError('retake takes no card/freshCard/rev/variant parameters');
        variant = await this.nextVariant(id, learnerId);
        context.freshCard = true;
      } else if (freshCard) context.freshCard = true;
      else if (card) {
        if (!PRINT_CARD_ID.test(card)) throw new ValidationError('card must be 7 digits');
        context.cardId = card;
        let usableRecordExists = false;
        if (params.startRow === undefined) {
          const record = await this.usableCardAllocation(card, id);
          usableRecordExists = !!record;
          if (record) adopt(record);
        } else if (!learnerId && await isQuiz()) {
          usableRecordExists = Boolean(await this.usableCardAllocation(card, id));
        }
        if (!adoptedRecord && !learnerId && !usableRecordExists && await isQuiz()) {
          throw new ValidationError(`card ${card} has no usable allocation for this quiz — add learnerId=<id> to attach it (or check the card number)`);
        }
        if (!adoptedRecord) context.startRow = params.startRow ?? 1;
      } else {
        const record = await this.usableDocumentAllocation(id, learnerId);
        if (record) adopt(record);
        else if (!context.teacher) context.freshCard = true;
      }
      if (learnerId && !adoptedRecord) context.learnerId = learnerId;
    } else if (params.card !== undefined || params.freshCard !== undefined || params.startRow !== undefined) {
      throw new ValidationError('hand variety takes no card parameters');
    }

    const targetResult = await this.loadTarget({ id, rev, variant });
    if (targetResult.kind === 'unconfigured') return { kind: 'unconfigured' };
    if (targetResult.kind === 'not_found') throw new EntityNotFoundError('print document', rev !== null ? `${id}@${rev}` : id);
    const rendered = await this.render({ target: targetResult.target, context, variety });
    if (rendered.kind === 'unconfigured') return rendered;
    return { ...rendered, id, teacher: Boolean(context.teacher) };
  }
}

function newestUsableRecord(records) {
  return records
    .filter((record) => record.status === 'live' || record.status === 'satisfied')
    .sort((a, b) => {
      const rank = (record) => (record.status === 'live' ? 1 : 0);
      return (rank(b) - rank(a)) || String(b.renderedAt).localeCompare(String(a.renderedAt));
    })[0] ?? null;
}

async function nearMissLiveCards(store, cardId) {
  if (typeof store.listCardIds !== 'function') return [];
  const out = [];
  for (const candidate of await store.listCardIds()) {
    if (candidate.length !== cardId.length) continue;
    let distance = 0;
    for (let index = 0; index < candidate.length && distance < 2; index += 1) {
      if (candidate[index] !== cardId[index]) distance += 1;
    }
    if (distance !== 1) continue;
    // eslint-disable-next-line no-await-in-loop
    const records = await store.findByCard(candidate);
    if (records.some((record) => record.status === 'live')) out.push(candidate);
  }
  return out.sort();
}

export default SchoolPrintAccessService;
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';
import { DomainInvariantError } from '#domains/core/errors/DomainInvariantError.mjs';
import { EntityNotFoundError } from '#domains/core/errors/EntityNotFoundError.mjs';

const PRINT_DOC_ID = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*){0,3}$/;
const PRINT_CARD_ID = /^[0-9]{7}$/;
