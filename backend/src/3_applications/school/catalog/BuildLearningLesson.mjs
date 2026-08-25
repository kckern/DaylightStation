import {
  capabilityForLearningModule,
  capabilityForQuestionItem,
  findCatalogLesson,
  validateLearningAction,
  validateLearningDocument,
  validateLearningCatalog,
  validateLearningProbeBank,
} from '#domains/school/catalog/index.mjs';
import { validateQuestionBank } from '#domains/school/questionBankValidation.mjs';
import { projectBankAsFlashcardDeck, validateFlashcardDeck } from '#domains/school/flashcards/index.mjs';
import {
  validateAdaptiveRemediationBank,
  validateAdaptiveRemediationPolicy,
} from '#domains/school/remediation/index.mjs';

const BANK_MODULES = new Set(['problems', 'flashcards', 'quiz', 'learning_probe']);

/**
 * Resolve one data-driven catalog lesson into the neutral bundle consumed by a
 * delivery-family codec. This use case knows pedagogical structures, never subjects
 * or calculator families.
 */
export class BuildLearningLesson {
  #catalogs;
  #content;
  #modules;

  constructor({ catalogs, content, modules = null } = {}) {
    if (!catalogs || !content) {
      throw new Error('BuildLearningLesson requires catalogs and content');
    }
    this.#catalogs = catalogs;
    this.#content = content;
    this.#modules = modules;
  }

  async execute({ catalogId, subjectId, courseId, unitId, lessonId } = {}) {
    const raw = await this.#catalogs.getCatalog(catalogId);
    if (!raw) throw new Error(`School Catalog '${catalogId}' was not found`);

    const validated = validateLearningCatalog(raw);
    if (validated.errors.length) {
      throw new Error(`School Catalog '${catalogId}' is invalid: ${validated.errors.join('; ')}`);
    }
    const catalog = validated.catalog;
    if (catalog.catalogId !== catalogId) {
      throw new Error(`School Catalog '${catalogId}' declares catalogId '${catalog.catalogId}'`);
    }

    const entry = findCatalogLesson(catalog, { subjectId, courseId, unitId, lessonId });
    if (!entry) {
      throw new Error(`School lesson '${[subjectId, courseId, unitId, lessonId].join('/')}' was not found`);
    }

    const modules = [];
    for (const module of entry.lesson.modules) {
      // Sequential resolution preserves authored order and avoids allowing a
      // content adapter's concurrency behavior to reorder lesson modules.
      // eslint-disable-next-line no-await-in-loop
      modules.push(await this.#resolveModule(module));
    }

    const capabilities = new Set(modules.map(capabilityForLearningModule).filter(Boolean));
    (entry.lesson.requiredCapabilities ?? []).forEach((capability) => capabilities.add(capability));
    modules.forEach((module) => {
      (module.bank?.items ?? []).forEach((item) => {
        const capability = capabilityForQuestionItem(item);
        if (capability) capabilities.add(capability);
      });
      if (module.document) {
        validateLearningDocument(module.document).capabilities
          .forEach((capability) => capabilities.add(capability));
      }
    });

    return {
      schema: 'school.learning-lesson/v1',
      address: entry.address,
      context: {
        catalog: pick(entry.catalog ?? catalog, ['catalogId', 'title', 'areaIds', 'classifications', 'tags']),
        subject: pick(entry.subject, ['subjectId', 'title', 'areaIds', 'classifications', 'tags']),
        course: pick(entry.course, ['courseId', 'title', 'areaIds', 'classifications', 'tags']),
        unit: pick(entry.unit, ['unitId', 'title', 'areaIds', 'classifications', 'tags']),
      },
      lesson: {
        lessonId: entry.lesson.lessonId,
        title: entry.lesson.title,
        // A compact title is a presentation hint supplied by ordinary authored
        // content.  It stays neutral here so every constrained delivery family
        // can select it without inventing a subject or device branch.
        ...pick(entry.lesson, ['shortTitle', 'areaIds', 'classifications', 'tags']),
        objectives: [...(entry.lesson.objectives ?? [])],
        modules,
      },
      capabilities: [...capabilities].sort(),
    };
  }

  async #resolveModule(module) {
    if (module.type === 'tool' || module.type === 'custom') {
      if (!this.#modules) throw new Error(`School ${module.type} capability '${module.capability}' has no module registry`);
      const validated = this.#modules.validate(module);
      if (validated.errors.length) throw new Error(`School module '${module.moduleId}' is invalid: ${validated.errors.join('; ')}`);
      return {
        ...structuredClone(module),
        ...(module.type === 'custom'
          ? { interaction: structuredClone(validated.definition.interaction) }
          : {}),
      };
    }
    if (module.type === 'lecture_notes') {
      const rawDocument = await this.#content.getDocument(module.documentId);
      if (!rawDocument) throw new Error(`School document '${module.documentId}' was not found`);
      const result = validateLearningDocument(rawDocument);
      if (result.errors.length) {
        throw new Error(`School document '${module.documentId}' is invalid: ${result.errors.join('; ')}`);
      }
      if (result.document.documentId !== module.documentId) {
        throw new Error(`School document '${module.documentId}' declares documentId '${result.document.documentId}'`);
      }
      await this.#validateDocumentActions(result.document);
      return { ...module, document: result.document };
    }
    if (module.type === 'flashcards' && module.deckId) {
      const rawDeck = await this.#content.getFlashcardDeck(module.deckId);
      if (!rawDeck) throw new Error(`School flashcard deck '${module.deckId}' was not found`);
      const deckResult = validateFlashcardDeck(rawDeck);
      if (deckResult.errors.length) throw new Error(`School flashcard deck '${module.deckId}' is invalid: ${deckResult.errors.join('; ')}`);
      if (deckResult.deck.id !== module.deckId) throw new Error(`School flashcard deck '${module.deckId}' declares id '${deckResult.deck.id}'`);
      const bankId = deckResult.deck.assessment?.bankId ?? null;
      if (!bankId) return { ...module, deck: deckResult.deck };
      const rawBank = await this.#content.getQuestionBank(bankId);
      if (!rawBank) throw new Error(`School question bank '${bankId}' was not found`);
      const bankResult = validateQuestionBank(rawBank);
      if (!bankResult.ok) throw new Error(`School question bank '${bankId}' is invalid: ${bankResult.errors.join('; ')}`);
      return { ...module, deck: deckResult.deck, bank: bankResult.bank };
    }
    if (BANK_MODULES.has(module.type)) {
      const rawBank = await this.#content.getQuestionBank(module.bankId);
      if (!rawBank) throw new Error(`School question bank '${module.bankId}' was not found`);
      const result = validateQuestionBank(rawBank);
      if (!result.ok) {
        throw new Error(`School question bank '${module.bankId}' is invalid: ${result.errors.join('; ')}`);
      }
      if (result.bank.id !== module.bankId) {
        throw new Error(`School question bank '${module.bankId}' declares id '${result.bank.id}'`);
      }
      if (module.remediation?.enabled !== false) {
        const policyEnabled = module.remediation !== undefined;
        if (policyEnabled) {
          const readiness = validateAdaptiveRemediationBank(result.bank, {
            path: `question bank '${module.bankId}'`,
          });
          if (readiness.errors.length) {
            throw new Error(`School remediation content is invalid: ${readiness.errors.join('; ')}`);
          }
        }
      }
      if (module.type === 'learning_probe') {
        const readiness = validateLearningProbeBank(module, result.bank, {
          path: `learning probe '${module.moduleId}'`,
        });
        if (readiness.errors.length) {
          throw new Error(`School learning probe is invalid: ${readiness.errors.join('; ')}`);
        }
      }
      const resolved = { ...module, bank: result.bank, ...(module.type === 'flashcards' ? { deck: projectBankAsFlashcardDeck(result.bank) } : {}) };
      if (module.remediation !== undefined) {
        // Catalog validation already rejected malformed policy. Normalize its
        // defaults here so every calculator-family projection sees the same
        // explicit, subject-neutral offline follow-up policy.
        resolved.remediation = validateAdaptiveRemediationPolicy(module.remediation, {
          path: `module '${module.moduleId}'.remediation`,
        }).policy;
      }
      return resolved;
    }
    if (module.type === 'activity' && module.mechanic === 'timed_drill') {
      const bankId = module.config.bankId;
      const rawBank = await this.#content.getQuestionBank(bankId);
      if (!rawBank) throw new Error(`School question bank '${bankId}' was not found`);
      const result = validateQuestionBank(rawBank);
      if (!result.ok) throw new Error(`School question bank '${bankId}' is invalid: ${result.errors.join('; ')}`);
      if (result.bank.id !== bankId) throw new Error(`School question bank '${bankId}' declares id '${result.bank.id}'`);
      return { ...module, bankId, bank: result.bank };
    }
    return structuredClone(module);
  }

  async #validateDocumentActions(document) {
    for (const block of document.blocks.filter(({ type }) => type === 'scan_action')) {
      if (typeof this.#content.getLearningAction !== 'function') {
        throw new Error(`School action '${block.actionId}' has no action repository`);
      }
      // Sequential lookup preserves deterministic error ordering when one
      // document contains several broken action references.
      // eslint-disable-next-line no-await-in-loop
      const raw = await this.#content.getLearningAction(block.actionId);
      if (!raw) throw new Error(`School action '${block.actionId}' was not found`);
      const result = validateLearningAction(raw);
      if (result.errors.length) {
        throw new Error(`School action '${block.actionId}' is invalid: ${result.errors.join('; ')}`);
      }
      if (result.action.actionId !== block.actionId) {
        throw new Error(`School action '${block.actionId}' declares actionId '${result.action.actionId}'`);
      }
      if (!result.action.enabled) throw new Error(`School action '${block.actionId}' is disabled`);
    }
  }
}

function pick(source, fields) {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined)
    .map((field) => [field, structuredClone(source[field])]));
}

export default BuildLearningLesson;
