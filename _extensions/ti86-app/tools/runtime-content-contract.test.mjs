import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  ti86ArtifactVariableName,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import {
  SCHOOLCALC_LOCAL_STATE_BYTES,
  SCHOOLCALC_LOCAL_STATE_OFFSETS,
  encodeSchoolCalcLocalState,
} from './lib/schoolcalc-local-state.mjs';
import { openSchoolCalcRecord } from './lib/schoolcalc-record-view.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-content.asm'), 'utf8');
const RUNTIME = readFileSync(path.join(EXTENSION, 'src', 'runtime-standard.asm'), 'utf8');
const RECORD_READER = readFileSync(path.join(EXTENSION, 'src', 'record-reader.asm'), 'utf8');

describe('SCLEARN durable generic-content contract', () => {
  it('keeps assembly SCL1 offsets identical to the canonical local-state codec', () => {
    expect(equate('RUNTIME_SCL_RECORD_BYTES')).toBe(SCHOOLCALC_LOCAL_STATE_BYTES);
    expect(equate('RUNTIME_SCL_GENERATION_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.generation);
    expect(equate('RUNTIME_SCL_VIEW_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.view);
    expect(equate('RUNTIME_SCL_ARTIFACT_KEY_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.artifactKey);
    expect(equate('RUNTIME_SCL_MODULE_INDEX_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.moduleIndex);
    expect(equate('RUNTIME_SCL_ITEM_INDEX_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.itemIndex);
  });

  it('hydrates the same closed lecture/example paths emitted by the TI-86 codec', () => {
    const codec = new Ti86SchoolCalcCodec();
    const artifact = codec.compile(bundle(), {
      capabilities: ['reader@1', 'examples@1'],
      limits: { maxArtifactBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes },
    });
    const key = artifact.artifactId.slice(-10);
    const local = encodeSchoolCalcLocalState({
      generation: 7,
      view: 'lesson',
      activeArtifactKey: key,
      address: { moduleIndex: 0, itemIndex: 1 },
    });
    expect(local.subarray(SCHOOLCALC_LOCAL_STATE_OFFSETS.artifactKey,
      SCHOOLCALC_LOCAL_STATE_OFFSETS.artifactKey + 10).toString('ascii')).toBe(key);
    expect(artifact.variableName).toBe(ti86ArtifactVariableName(artifact.artifactId));
    expect(artifact.variableName).toBe(`DP${key.slice(0, 6)}`);

    const record = openSchoolCalcRecord(artifact.bytes, { expectedMagic: 'SCP1' });
    expect(record.path('schema').value).toBe('school.calc.ti86-package/v2');
    expect(record.path('lesson', 'modules', 0, 'type').value).toBe('lecture_notes');
    expect(record.path('lesson', 'modules', 0, 'pages', 1, 'text').value)
      .toBe('Artifact: A durable\nreference to immutable\nlesson bytes.');
    expect(record.path('lesson', 'modules', 1, 'type').value).toBe('examples');
    expect(record.path('lesson', 'modules', 1, 'pages', 0, 'text').value)
      .toBe('Example\nOpen the selected\nartifact.');
  });

  it('uses a closed subject-neutral dispatcher and commits navigation before redraw', () => {
    expect(SOURCE).toContain('runtime_type_lecture_notes: defb "lecture_notes",0');
    expect(SOURCE).toContain('runtime_type_examples: defb "examples",0');
    expect(SOURCE).toContain('runtime_key_pages: defb "pages",0');
    expect(SOURCE).not.toContain('runtime_key_blocks:');
    expect(RECORD_READER).toMatch(/inc a\s+cp 122\s+jr nc,sc_copy_string_invalid/);
    expect(RECORD_READER).not.toContain('sc_copy_string_cap:');
    expect(SOURCE).toContain('runtime_artifact_name: defb 0x0C,8,"DP"');
    expect(SOURCE).toMatch(/call runtime_state_save\s+ret c\s+call runtime_open_artifact_and_module/);
    expect(SOURCE).toContain('ld de,runtime_artifact_id + 8');
    expect(SOURCE).not.toMatch(/(?:math|chemistry|physics|geography|economics|finance)/i);
    expect(RUNTIME).toContain('include "runtime-content.asm"');
    expect(RUNTIME).toMatch(/call runtime_move_next[\s\S]{0,520}call standard_runtime_render/);
  });

  it('validates and presents scan-action QR pages through the closed F1/full-frame path', () => {
    const codec = new Ti86SchoolCalcCodec();
    const artifact = codec.compile(actionBundle(), {
      capabilities: ['reader@1', 'scan-action@1'],
      limits: { maxArtifactBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes },
    });
    const record = openSchoolCalcRecord(artifact.bytes, { expectedMagic: 'SCP1' });
    const pagePath = ['lesson', 'modules', 0, 'pages', 0];
    expect(record.path(...pagePath, 'kind').value).toBe('scan_action');
    expect(record.path(...pagePath, 'actionToken').value).toBe('sch:23456789ABCDEFGH');
    const qrNode = record.path(...pagePath, 'qrModules');
    expect(qrNode).toMatchObject({ type: 'bytes', byteLength: 63 });
    const packed = record.bytes(qrNode);
    for (let row = 0; row < 21; row += 1) expect(packed[row * 3 + 2] & 0x07).toBe(0);

    expect(SOURCE).toContain('RUNTIME_ACTION_QR_BYTES:     equ 63');
    expect(SOURCE).toMatch(/runtime_capture_action_page:[\s\S]*?cp SC_TAG_BYTES[\s\S]*?and 0x07/);
    expect(SOURCE).toContain('runtime_key_action_token: defb "actionToken",0');
    expect(SOURCE).toContain('runtime_key_qr_modules: defb "qrModules",0');
    expect(SOURCE).toContain('runtime_kind_scan_action: defb "scan_action",0');
    expect(RUNTIME).toMatch(
      /standard_runtime_f1:[\s\S]{0,140}runtime_action_page[\s\S]{0,80}standard_runtime_show_action_qr/,
    );
    expect(RUNTIME).toContain('STANDARD_ACTION_QR_DATA_X: equ 43');
    expect(RUNTIME).toContain('STANDARD_ACTION_QR_DATA_Y: equ 11');
    expect(RUNTIME).toMatch(
      /standard_runtime_draw_action_qr:[\s\S]*?call _clrLCD[\s\S]*?ld d,2\s+ld e,2\s+call ui_fill_rect/,
    );
  });

  it('retains the inactive generic reader with fixed Top, Back, Page Up, and Next/End affordances', () => {
    expect(RUNTIME).toContain('STANDARD_READER_PAGE_STEP: equ 1');
    expect(RUNTIME).toMatch(
      /standard_runtime_wait:[\s\S]{0,700}SC_SCAN_F2[\s\S]{0,80}standard_runtime_leave_viewed[\s\S]{0,180}SC_SCAN_F4[\s\S]{0,80}standard_runtime_page_up[\s\S]{0,180}SC_SCAN_F5[\s\S]{0,80}standard_runtime_page_down/,
    );
    const pageDown = RUNTIME.match(/standard_runtime_page_down:[\s\S]*?standard_runtime_show_action_qr:/)?.[0] ?? '';
    expect(pageDown).toContain('ld de,(runtime_content_count)');
    expect(pageDown).toContain('call runtime_move_to_candidate');
    expect(RUNTIME).toMatch(
      /standard_runtime_render_softkeys:[\s\S]{0,1000}call standard_runtime_has_more[\s\S]{0,260}standard_runtime_eom_label[\s\S]{0,160}standard_runtime_more_label/,
    );
    for (const label of ['TOP', 'BACK', 'PGUP', 'NEXT', 'END']) {
      expect(RUNTIME).toContain(`defb "${label}",0`);
    }
  });
});

function equate(name) {
  const match = SOURCE.match(new RegExp(`^${name}:\\s+equ ([0-9]+)$`, 'm'));
  if (!match) throw new Error(`missing decimal assembly equate ${name}`);
  return Number.parseInt(match[1], 10);
}

function bundle() {
  return {
    schema: 'school.learning-lesson/v1',
    address: 'main/portable/foundations/one/durable-content',
    context: {
      catalog: { catalogId: 'main', title: 'Catalog' },
      subject: { subjectId: 'portable', title: 'Portable subject' },
      course: { courseId: 'foundations', title: 'Foundations' },
      unit: { unitId: 'one', title: 'Unit one' },
    },
    lesson: {
      lessonId: 'durable-content', title: 'Durable content', objectives: [],
      modules: [{
        moduleId: 'notes', type: 'lecture_notes', documentId: 'durable-notes',
        document: {
          schema: 'school.learning-document/v1', documentId: 'durable-notes', title: 'Notes',
          blocks: [
            { blockId: 'intro', type: 'prose', text: 'Content stays data.' },
            { blockId: 'term', type: 'definition', term: 'Artifact', definition: 'A durable reference to immutable lesson bytes.' },
          ],
        },
      }, {
        moduleId: 'worked', type: 'examples',
        examples: [{ exampleId: 'open', prompt: 'Open the selected artifact.', steps: ['Derive its variable name from the key.'] }],
      }],
    },
    capabilities: ['examples@1', 'reader@1'],
  };
}

function actionBundle() {
  return {
    schema: 'school.learning-lesson/v1',
    address: 'main/portable/foundations/one/action-content',
    context: {
      catalog: { catalogId: 'main', title: 'Catalog' },
      subject: { subjectId: 'portable', title: 'Portable subject' },
      course: { courseId: 'foundations', title: 'Foundations' },
      unit: { unitId: 'one', title: 'Unit one' },
    },
    lesson: {
      lessonId: 'action-content', title: 'Action content', objectives: ['Request follow-up work'],
      modules: [{
        moduleId: 'notes', type: 'lecture_notes', documentId: 'action-notes',
        document: {
          schema: 'school.learning-document/v1', documentId: 'action-notes', title: 'Actions',
          blocks: [{
            blockId: 'practice', type: 'scan_action', actionId: 'worksheet:practice',
            label: 'Print practice', token: 'sch:23456789ABCDEFGH',
          }],
        },
      }],
    },
    capabilities: ['reader@1', 'scan-action@1'],
  };
}
