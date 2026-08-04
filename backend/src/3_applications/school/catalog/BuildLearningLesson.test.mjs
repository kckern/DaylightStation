import { describe, expect, it } from 'vitest';
import { BuildLearningLesson } from './BuildLearningLesson.mjs';
import { createCoreLearningModuleRegistry } from './LearningModuleRegistry.mjs';

const catalog = {
  schema: 'school.catalog/v1',
  catalogId: 'main',
  title: 'Main Catalog',
  subjects: [{
    subjectId: 'markets',
    title: 'Markets',
    courses: [{
      courseId: 'household-finance',
      title: 'Household Finance',
      units: [{
        unitId: 'interest',
        title: 'Interest',
        lessons: [{
          lessonId: 'compound-growth',
          title: 'Compound growth',
          shortTitle: 'Growth',
          objectives: ['Compare growth over time'],
          modules: [
            { moduleId: 'notes', type: 'lecture_notes', documentId: 'compound-notes' },
            { moduleId: 'worked', type: 'examples', examples: [{ exampleId: 'first', prompt: 'Grow 100', steps: ['Multiply by the rate'] }] },
            { moduleId: 'check', type: 'quiz', bankId: 'finance:compound-check', passingPercent: 80 },
          ],
        }],
      }],
    }],
  }],
};

const bank = {
  id: 'finance:compound-check',
  title: 'Compound growth check',
  audience: 'assigned',
  items: [{
    id: 'q1', type: 'multiple_choice', prompt: 'Which grows?',
    choices: ['Principal', 'Principal plus earned interest'], answer: 'Principal plus earned interest',
  }],
};

function useCase({ rawCatalog = catalog, rawBank = bank, documentBlocks = null, action = null, modules = null } = {}) {
  return new BuildLearningLesson({
    catalogs: { getCatalog: async () => rawCatalog },
    content: {
      getDocument: async () => ({
        schema: 'school.learning-document/v1', documentId: 'compound-notes', title: 'Compounding',
        blocks: documentBlocks ?? [{ blockId: 'intro', type: 'prose', text: 'Interest can compound.' }],
      }),
      getQuestionBank: async () => rawBank,
      getLearningAction: async () => action,
    },
    modules,
  });
}

describe('BuildLearningLesson', () => {
  it('resolves a subject-neutral lesson and derives interaction capabilities', async () => {
    const bundle = await useCase().execute({
      catalogId: 'main', subjectId: 'markets', courseId: 'household-finance',
      unitId: 'interest', lessonId: 'compound-growth',
    });

    expect(bundle.address).toBe('main/markets/household-finance/interest/compound-growth');
    expect(bundle.context.subject).toEqual({ subjectId: 'markets', title: 'Markets' });
    expect(bundle.lesson).toMatchObject({ title: 'Compound growth', shortTitle: 'Growth' });
    expect(bundle.lesson.modules[0].document.blocks[0].text).toContain('compound');
    expect(bundle.lesson.modules[2].bank.items).toHaveLength(1);
    expect(bundle.capabilities).toEqual([
      'examples@1', 'quiz@1', 'reader@1', 'response.choice@1',
    ]);
  });

  it('fails publication-safe when a referenced bank is invalid', async () => {
    await expect(useCase({ rawBank: { ...bank, items: [] } }).execute({
      catalogId: 'main', subjectId: 'markets', courseId: 'household-finance',
      unitId: 'interest', lessonId: 'compound-growth',
    })).rejects.toThrow(/question bank.*invalid/i);
  });

  it('rejects a repository catalog whose declared identity differs from the request', async () => {
    await expect(useCase({ rawCatalog: { ...catalog, catalogId: 'other' } }).execute({
      catalogId: 'main', subjectId: 'markets', courseId: 'household-finance',
      unitId: 'interest', lessonId: 'compound-growth',
    })).rejects.toThrow(/declares catalogId 'other'/);
  });

  it('validates every scan action against mounted server-side definitions without hydrating a token', async () => {
    const documentBlocks = [{
      blockId: 'worksheet', type: 'scan_action', actionId: 'worksheet:compound', label: 'Print practice',
    }];
    const action = {
      schema: 'school.learning-action/v1', actionId: 'worksheet:compound', title: 'Print practice',
      kind: 'print_document', tokenVersion: 1, policy: { replay: 'repeatable' },
      target: { printableId: 'compound-practice' },
    };
    const bundle = await useCase({ documentBlocks, action }).execute({
      catalogId: 'main', subjectId: 'markets', courseId: 'household-finance',
      unitId: 'interest', lessonId: 'compound-growth',
    });
    expect(bundle.capabilities).toContain('scan-action@1');
    expect(bundle.lesson.modules[0].document.blocks[0]).toEqual(documentBlocks[0]);
  });

  it('fails publication for a missing, disabled, or invalid action definition', async () => {
    const documentBlocks = [{
      blockId: 'worksheet', type: 'scan_action', actionId: 'worksheet:compound', label: 'Print practice',
    }];
    const address = {
      catalogId: 'main', subjectId: 'markets', courseId: 'household-finance',
      unitId: 'interest', lessonId: 'compound-growth',
    };
    await expect(useCase({ documentBlocks, action: null }).execute(address)).rejects.toThrow(/was not found/);
    const base = {
      schema: 'school.learning-action/v1', actionId: 'worksheet:compound', title: 'Print practice',
      kind: 'print_document', tokenVersion: 1, policy: { replay: 'repeatable' },
      target: { printableId: 'compound-practice' },
    };
    await expect(useCase({ documentBlocks, action: { ...base, enabled: false } }).execute(address))
      .rejects.toThrow(/disabled/);
    await expect(useCase({ documentBlocks, action: { ...base, kind: 'command' } }).execute(address))
      .rejects.toThrow(/is invalid/);
  });

  it('hydrates a registered custom renderer with a neutral overview/detail interaction contract', async () => {
    const rawCatalog = structuredClone(catalog);
    rawCatalog.subjects[0].courses[0].units[0].lessons[0].modules = [{
      moduleId: 'reference', type: 'custom', capability: 'dense-reference@1',
      config: { datasetId: 'reference-v1' },
    }];
    const modules = createCoreLearningModuleRegistry({
      customDefinitions: [{
        capability: 'dense-reference@1', kind: 'custom',
        validateConfig: (config) => config.datasetId === 'reference-v1' ? [] : ['unknown dataset'],
        interaction: {
          model: 'overview_detail', topology: 'spatial', navigation: 'snap',
          inspector: 'stable', focusIdentity: 'item_id', positionMemory: 'session',
          fallback: 'incompatible', legend: 'info',
        },
      }],
    });
    const bundle = await useCase({ rawCatalog, modules }).execute({
      catalogId: 'main', subjectId: 'markets', courseId: 'household-finance',
      unitId: 'interest', lessonId: 'compound-growth',
    });
    expect(bundle.lesson.modules[0]).toMatchObject({
      capability: 'dense-reference@1',
      interaction: {
        model: 'overview_detail', topology: 'spatial', navigation: 'snap',
        inspector: 'stable', focusIdentity: 'item_id', positionMemory: 'session',
        fallback: 'incompatible', legend: 'info',
      },
    });
    expect(bundle.capabilities).toEqual(['dense-reference@1']);
  });

  it('hydrates a generic learning probe and rejects a bank without explanations', async () => {
    const probe = {
      moduleId: 'probe', type: 'learning_probe', bankId: 'probe-bank',
      phase: 'check', difficulty: 2, conceptIds: ['growth-rate'],
      feedback: { timing: 'immediate', onIncorrect: 'explain_then_retry', maxAttemptsPerItem: 2 },
    };
    const rawCatalog = structuredClone(catalog);
    rawCatalog.subjects[0].courses[0].units[0].lessons[0].modules = [probe];
    const validBank = {
      id: 'probe-bank', title: 'Quick check', audience: 'assigned',
      concepts: [{ conceptId: 'growth-rate', title: 'Growth rate' }],
      items: [{
        id: 'p1', type: 'multiple_choice', prompt: 'Which operation finds a rate?',
        choices: ['Divide', 'Add'], answer: 'Divide', concepts: ['growth-rate'],
        feedback: { explanation: 'A rate compares quantities by division.' },
      }],
    };
    const content = { getQuestionBank: async () => validBank };
    const built = await new BuildLearningLesson({
      catalogs: { getCatalog: async () => rawCatalog }, content,
    }).execute({
      catalogId: 'main', subjectId: 'markets', courseId: 'household-finance',
      unitId: 'interest', lessonId: 'compound-growth',
    });
    expect(built.lesson.modules[0]).toMatchObject({
      type: 'learning_probe', phase: 'check', bank: { id: 'probe-bank' },
    });
    expect(built.capabilities).toContain('learning-probe@1');

    delete validBank.items[0].feedback;
    await expect(new BuildLearningLesson({
      catalogs: { getCatalog: async () => rawCatalog }, content,
    }).execute({
      catalogId: 'main', subjectId: 'markets', courseId: 'household-finance',
      unitId: 'interest', lessonId: 'compound-growth',
    })).rejects.toThrow(/corrective feedback/);
  });
});
