import { describe, expect, it } from 'vitest';
import { createSubjectIconResolver } from '#adapters/school/documents/FilesystemSchoolAssetResolver.mjs';
import { RenderPrintDocument } from '#apps/school/documents/RenderPrintDocument.mjs';
import { createPrintDocumentRendering } from './PrintDocumentRendering.mjs';

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({
  rendering: createPrintDocumentRendering(), ...deps,
});

describe('createSubjectIconResolver', () => {
  it('loads the real School SVGs and converts browser-only sizing/colour conventions for PDF', () => {
    const resolve = createSubjectIconResolver({ logger: { warn() {} } });
    const math = resolve('subject-icon:math');
    const science = resolve('subject-icon:science');

    expect(math?.svg).toContain('<svg');
    expect(math?.svg).not.toContain('width="1em"');
    expect(math?.svg).not.toContain('height="1em"');
    expect(science?.svg).toContain('#000000');
    expect(science?.svg).not.toContain('currentColor');
    expect(math?.widthPt).toBeGreaterThan(0);
    expect(science?.heightPt).toBeGreaterThan(0);
  });

  it('does not treat an arbitrary or malformed asset ref as a subject icon', () => {
    const resolve = createSubjectIconResolver({ logger: { warn() {} } });
    expect(resolve('school/math/fraction-strips')).toBeNull();
    expect(resolve('subject-icon:../../secrets')).toBeNull();
  });

  it('is the default resolver in the production render use case', async () => {
    const result = await createRenderPrintDocument().execute({
      document: {
        schema: 'school.document-source/v1', id: 'science/atom-card', seed: 1,
        variant: 0, target: ['letter'], archetype: 'worksheet', title: 'Worksheet',
        header: { title: false, name: true, date: true },
        blocks: [{
          type: 'inset', layout: 'lesson_card', subjectIcon: 'science',
          breadcrumb: 'SCIENCE › CHEMISTRY', lessonTitle: 'Atoms', citation: 'A printed book',
          questionCount: 1, passPercent: 80,
          blocks: [{ type: 'rich_text', md: 'Atoms' }],
        }],
      },
    });
    expect(result.bytes.length).toBeGreaterThan(1000);
  });
});
