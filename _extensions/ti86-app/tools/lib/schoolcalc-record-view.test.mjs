import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  encodeTi86Envelope,
} from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { openSchoolCalcRecord } from './schoolcalc-record-view.mjs';

describe('offset-oriented SchoolCalc record view', () => {
  it('navigates an SCP1 lesson without materializing the value tree', () => {
    const codec = new Ti86SchoolCalcCodec();
    const artifact = codec.compile({
      schema: 'school.learning-lesson/v1',
      address: 'main/quant/physics/motion/constant-velocity',
      context: {
        catalog: { catalogId: 'main', title: 'Main' },
        subject: { subjectId: 'quant', title: 'Quantitative studies' },
        course: { courseId: 'physics', title: 'Physics' },
        unit: { unitId: 'motion', title: 'Motion' },
      },
      lesson: {
        lessonId: 'constant-velocity',
        title: 'Constant velocity',
        objectives: ['Read a position graph'],
        modules: [{
          moduleId: 'notes', type: 'lecture_notes', title: 'Read',
          documentId: 'motion-notes',
          document: {
            schema: 'school.learning-document/v1', documentId: 'motion-notes', title: 'Motion',
            blocks: [{ blockId: 'velocity', type: 'prose', text: 'Velocity is a rate.' }],
          },
        }],
      },
      capabilities: ['reader@1'],
    }, {
      capabilities: ['reader@1'], limits: { maxArtifactBytes: 12 * 1024 },
    });

    const view = openSchoolCalcRecord(artifact.bytes, { expectedMagic: 'SCP1' });
    expect(view.magic).toBe('SCP1');
    expect(view.node().type).toBe('map');
    expect(view.path('schema').value).toBe('school.calc.ti86-package/v2');
    expect(view.path('lesson', 'title').value).toBe('Constant velocity');
    expect(view.path('lesson', 'modules', 0, 'type').value).toBe('lecture_notes');
    expect(view.path('lesson', 'modules', 0, 'pages', 0, 'text').value)
      .toBe('Velocity is a rate.');
    expect(view.path('lesson', 'missing')).toBeNull();
  });

  it('returns exact byte strings and rejects corrupt envelopes before traversal', () => {
    const record = encodeTi86Envelope('SCQ1', {
      schema: 'school.calc.result-queue/v1',
      deviceId: '86A001',
      records: [Buffer.from([1, 2, 3])],
    });
    const view = openSchoolCalcRecord(record, { expectedMagic: 'SCQ1' });
    expect(view.bytes(view.path('records', 0))).toEqual(Buffer.from([1, 2, 3]));

    const corrupt = Buffer.from(record);
    corrupt[corrupt.length - 1] ^= 0x80;
    expect(() => openSchoolCalcRecord(corrupt, { expectedMagic: 'SCQ1' })).toThrow(/checksum/);
    expect(() => openSchoolCalcRecord(record.subarray(0, -1), { expectedMagic: 'SCQ1' })).toThrow(/length/);
  });
});
