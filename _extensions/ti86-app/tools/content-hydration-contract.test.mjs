import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  encodeTi86Envelope,
  ti86ArtifactVariableName,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { openSchoolCalcRecord } from './lib/schoolcalc-record-view.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const SHELL = readFileSync(path.join(EXTENSION, 'src', 'schoolcalc.asm'), 'utf8');
const CATALOG = readFileSync(path.join(EXTENSION, 'src', 'runtime-catalog.asm'), 'utf8');
const LEARNING = readFileSync(path.join(EXTENSION, 'src', 'runtime-standard.asm'), 'utf8');
const CONTENT = readFileSync(path.join(EXTENSION, 'src', 'runtime-content.asm'), 'utf8');

describe('TI-86 production content hydration boundary', () => {
  it('follows the same generic Catalog and lesson paths in real adapter records', () => {
    const codec = new Ti86SchoolCalcCodec();
    const catalog = codec.encodeCatalog({
      schema: 'school.calc.catalog-projection/v1',
      deviceId: 'SCAABBCCDDEE',
      platformId: 'ti86',
      generation: `sha256:${'a'.repeat(64)}`,
      catalogs: [{
        catalogId: 'main', title: 'Main Catalog', subjects: [{
          subjectId: 'mixed', title: 'Mixed', courses: [{
            courseId: 'foundations', title: 'Foundations', units: [{
              unitId: 'unit-one', title: 'Unit one', lessons: [{
                lessonId: 'first', title: 'First lesson', compatible: true,
                state: 'installed', requiredCapabilities: ['reader@1'],
              }],
            }],
          }],
        }],
      }],
    });
    const catalogView = openSchoolCalcRecord(catalog, { expectedMagic: 'SCC1' });
    expect(catalogView.path('catalogs', 0, 'title').value).toBe('Main Catalog');
    expect(catalogView.path(
      'catalogs', 0, 'subjects', 0, 'courses', 0, 'units', 0, 'lessons', 0, 'title',
    ).value).toBe('First lesson');

    const artifact = codec.compile({
      schema: 'school.learning-lesson/v1',
      address: 'main/mixed/foundations/unit-one/first',
      context: {
        catalog: { catalogId: 'main', title: 'Main Catalog' },
        subject: { subjectId: 'mixed', title: 'Mixed' },
        course: { courseId: 'foundations', title: 'Foundations' },
        unit: { unitId: 'unit-one', title: 'Unit one' },
      },
      lesson: {
        lessonId: 'first', title: 'First lesson', objectives: [],
        modules: [{
          moduleId: 'notes', type: 'lecture_notes', documentId: 'first-notes',
          document: {
            schema: 'school.learning-document/v1', documentId: 'first-notes', title: 'Notes',
            blocks: [{ blockId: 'intro', type: 'prose', text: 'Portable content.' }],
          },
        }],
      },
      capabilities: ['reader@1'],
    }, { capabilities: ['reader@1'], limits: { maxArtifactBytes: 12288 } });
    const lessonView = openSchoolCalcRecord(artifact.bytes, { expectedMagic: 'SCP1' });
    expect(artifact.variableName).toBe(ti86ArtifactVariableName(artifact.artifactId));
    expect(artifact.variableName).toBe(`DP${artifact.artifactId.slice(-10, -4)}`);
    expect(lessonView.path('lesson', 'title').value).toBe('First lesson');
    expect(lessonView.path('lesson', 'modules', 0, 'type').value).toBe('lecture_notes');
  });

  it('hydrates only through the selected Catalog and learning runtimes', () => {
    expect(SHELL).not.toContain('include "content-hydration.asm"');
    expect(SHELL).toContain('sccat_name:     defb 0x12,5,"SCCAT",0,0,0');
    expect(SHELL).toContain('sclearn_name:   defb 0x12,7,"SCLEARN",0');
    expect(CATALOG).toContain('ld hl,cat_dscat0_name');
    expect(CATALOG).toContain('ld hl,cat_dscat1_name');
    expect(CATALOG).toContain('call cat_capture_lesson_artifact');
    expect(CATALOG).toContain('ld (scstate_record + SCSTATE_MODULE_INDEX_OFFSET),a');
    expect(LEARNING).toContain('call runtime_open_selected_module');
    expect(CONTENT).toContain('runtime_artifact_name: defb 0x0C,8,"DP"');
    expect(CONTENT).toContain('ld de,runtime_artifact_id + 8');
    expect(`${CATALOG}\n${LEARNING}\n${CONTENT}`)
      .not.toMatch(/(?:math|science|geography|chemistry|physics|finance)/i);

    const corrupt = encodeTi86Envelope('SCC1', { catalogs: [] });
    corrupt[corrupt.length - 1] ^= 1;
    expect(() => openSchoolCalcRecord(corrupt, { expectedMagic: 'SCC1' })).toThrow(/checksum/);
  });
});
