import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFileAssetResolver, createSubjectIconResolver } from "../../adapters/documents/FilesystemSchoolAssetResolver.mjs";
import { RenderPrintDocument } from "../../application/documents/RenderPrintDocument.mjs";
import { createPrintDocumentRendering } from "./PrintDocumentRendering.mjs";

const createRenderPrintDocument = (deps = {}) => new RenderPrintDocument({
  rendering: createPrintDocumentRendering({ resolveAsset: createSubjectIconResolver({ logger: { warn() {} } }) }), ...deps,
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

  it('finds an icon that lives only in svg/generated/ (the Solar split) and prefers svg/ when both exist', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-icons-'));
    fs.mkdirSync(path.join(root, 'generated'));
    const glyph = (id) => `<svg width="1em" height="1em" viewBox="0 0 24 24"><path id="${id}" fill="currentColor" d="M0 0h1v1z"/></svg>`;
    fs.writeFileSync(path.join(root, 'generated', 'writing.svg'), glyph('generated-writing'));
    fs.writeFileSync(path.join(root, 'math.svg'), glyph('tracked-math'));
    fs.writeFileSync(path.join(root, 'generated', 'math.svg'), glyph('generated-math'));
    const warnings = [];
    const resolve = createSubjectIconResolver({ rootDir: root, logger: { warn: (event, data) => warnings.push([event, data]) } });

    expect(resolve('subject-icon:writing')?.sourceSvg).toContain('generated-writing');
    expect(resolve('subject-icon:math')?.sourceSvg).toContain('tracked-math');
    expect(resolve('subject-icon:nothing-here')).toBeNull();
    expect(warnings).toEqual([['school.subject_icon.unresolved', { ref: 'subject-icon:nothing-here', reason: 'not-found' }]]);
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

describe('createFileAssetResolver authoring safety', () => {
  it('refuses scripts and external references instead of printing partial artwork', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'school-assets-'));
    try {
      fs.mkdirSync(path.join(root, 'school/math'), { recursive: true });
      fs.writeFileSync(path.join(root, 'school/math/unsafe.svg'), '<svg viewBox="0 0 10 10"><script>alert(1)</script></svg>');
      const warnings = [];
      const resolve = createFileAssetResolver({ rootDir: root, logger: { warn: (...args) => warnings.push(args) } });
      expect(resolve('school/math/unsafe')).toBeNull();
      expect(warnings[0][1]).toMatchObject({ reason: 'unsafe-svg' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
