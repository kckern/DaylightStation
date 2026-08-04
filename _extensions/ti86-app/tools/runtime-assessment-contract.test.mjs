import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  crc16Ccitt,
  decodeTi86Envelope,
  encodeTi86ResultQueue,
  encodeTi86ResultRecord,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import { SCHOOLCALC_LOCAL_STATE_OFFSETS } from './lib/schoolcalc-local-state.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ASSESSMENT = readFileSync(path.join(EXTENSION, 'src', 'runtime-assessment.asm'), 'utf8');
const QUEUE = readFileSync(path.join(EXTENSION, 'src', 'runtime-queue.asm'), 'utf8');
const QUEUE_RUNTIME = readFileSync(path.join(EXTENSION, 'src', 'runtime-result-queue.asm'), 'utf8');
const RUNTIME = readFileSync(path.join(EXTENSION, 'src', 'runtime-standard.asm'), 'utf8');
const BUILD = readFileSync(path.join(EXTENSION, 'tools', 'build-standard-runtime.mjs'), 'utf8');

describe('SCLEARN assessment, flashcard, and offline-queue contract', () => {
  it('keeps every assembly mutation offset aligned with canonical SCL1', () => {
    expect(equate(ASSESSMENT, 'RUNTIME_SCL_FLAGS_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.flags);
    expect(equate(ASSESSMENT, 'RUNTIME_SCL_SCROLL_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.scroll);
    expect(equate(ASSESSMENT, 'RUNTIME_SCL_CARD_FACE_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.cardFace);
    expect(equate(ASSESSMENT, 'RUNTIME_SCL_DRAFT_KIND_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.draftKind);
    expect(equate(ASSESSMENT, 'RUNTIME_SCL_DRAFT_LENGTH_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.draftLength);
    expect(equate(ASSESSMENT, 'RUNTIME_SCL_DRAFT_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.draft);
    expect(equate(ASSESSMENT, 'RUNTIME_SCL_NEXT_SEQUENCE_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.nextSequence);
    expect(equate(QUEUE, 'QUEUE_MAX_BYTES')).toBe(TI86_SCHOOLCALC_LIMITS.queueMaxBytes);
    expect(equate(QUEUE, 'QUEUE_MAX_RECORDS')).toBe(TI86_SCHOOLCALC_LIMITS.queueMaxRecords);
  });

  it('projects quiz prompts/choices and flashcard answers into the closed v2 paths', () => {
    const codec = new Ti86SchoolCalcCodec();
    const quiz = codec.compile(bundle('quiz'), capabilityReport('quiz@1'));
    const quizItem = decodeTi86Envelope(quiz.bytes, 'SCP1').lesson.modules[0].bank.items[0];
    expect(quizItem.type).toBe('multiple_choice');
    expect(quizItem.promptPages.length).toBeGreaterThan(1);
    expect(quizItem.choices).toEqual(['One', 'Two', 'Three']);
    expect(quizItem).not.toHaveProperty('answer');
    expect(quizItem.correctChoice).toBe(2);

    const cards = codec.compile(bundle('flashcards'), capabilityReport('flashcards@1'));
    const card = decodeTi86Envelope(cards.bytes, 'SCP1').lesson.modules[0].bank.items[0];
    expect(card.answerPages).toEqual(['Two']);
    expect(ASSESSMENT).toContain('assessment_key_prompt_pages:    defb "promptPages",0');
    expect(ASSESSMENT).toContain('assessment_key_answer_pages:    defb "answerPages",0');
    expect(ASSESSMENT).toContain('assessment_key_choices:         defb "choices",0');
    expect(ASSESSMENT).toContain('assessment_key_correct_choice:  defb "correctChoice",0');
  });

  it('keeps normal prompts and their labelled answer choices together on the TI-86', () => {
    expect(ASSESSMENT).toMatch(
      /assessment_render_prompt:[\s\S]{0,1500}assessment_inline_choices_fit[\s\S]{0,160}assessment_render_inline_choices[\s\S]{0,600}assessment_inline_two_column_fit/,
    );
    expect(ASSESSMENT).toContain('assessment_render_inline_choices:');
    expect(ASSESSMENT).toContain('assessment_render_inline_two_columns:');
    expect(ASSESSMENT).toMatch(
      /assessment_render_prompt:[\s\S]{0,2000}assessment_inline_two_column_fit[\s\S]{0,160}assessment_render_inline_two_columns/,
    );
    expect(ASSESSMENT).toMatch(
      /assessment_inline_two_column_fit:[\s\S]{0,1600}ld b,13[\s\S]{0,220}assessment_inline_two_columns_width_chars/,
    );
    expect(ASSESSMENT).toContain('assessment_inline_label_x:      defb 2,65');
    expect(ASSESSMENT).toContain('assessment_inline_text_x:       defb 12,75');
    expect(ASSESSMENT).toMatch(
      /assessment_inline_choice_render_loop:[\s\S]{0,900}ld a,\(assessment_inline_columns\)\s+dec a\s+ld b,a\s+ld a,\(assessment_render_index\)\s+and b/,
    );
    expect(ASSESSMENT).toContain('assessment_inline_choice_wait:');
    expect(ASSESSMENT).toMatch(
      /assessment_inline_choices_fit:[\s\S]{0,900}add a,6/,
    );
    const inlineGrid = ASSESSMENT.slice(
      ASSESSMENT.indexOf('assessment_inline_choice_render_loop:'),
      ASSESSMENT.indexOf('assessment_inline_choices_rendered:'),
    );
    expect(inlineGrid).toContain('assessment_inline_choice_advance_y:');
    const inlineAdvance = inlineGrid.slice(inlineGrid.indexOf('assessment_inline_choice_advance_y:'));
    expect(inlineAdvance).toContain('add a,6');
    expect(ASSESSMENT).toContain('ld a,(ui_wrap_y)');
    expect(ASSESSMENT).toContain('cp 55');
    expect(ASSESSMENT).toMatch(
      /assessment_return_to_prompt:[\s\S]{0,260}assessment_prompt_page_count[\s\S]{0,180}RUNTIME_SCL_SCROLL_OFFSET/,
    );
    expect(ASSESSMENT).toContain('assessment_question_hint:       defb "LEFT: Q",0');
    expect(ASSESSMENT).toContain("assessment_inline_prefix:       defs 3,0");
    const acknowledgement = ASSESSMENT.slice(
      ASSESSMENT.indexOf('assessment_render_choice_ack:'),
      ASSESSMENT.indexOf('assessment_commit_choice:'),
    );
    expect(acknowledgement).toMatch(/call ui_mode_clear\s+call ui_fill_rect\s+call ui_mode_set/);
    expect(acknowledgement).toMatch(/ld a,\(assessment_ack_index\)\s+ld e,a[\s\S]{0,260}assessment_softkey_ack_x/);
    expect(ASSESSMENT).not.toContain('ld e,(assessment_ack_index)');
    const copiedChoice = inlineGrid.lastIndexOf('call sc_copy_node_string');
    const preservedPointer = inlineGrid.indexOf('push hl', copiedChoice);
    const columnLookup = inlineGrid.indexOf('assessment_inline_text_x', preservedPointer);
    const restoredPointer = inlineGrid.indexOf('pop hl', columnLookup);
    const renderedChoice = inlineGrid.indexOf('call ui_draw_text_clipped', restoredPointer);
    expect([copiedChoice, preservedPointer, columnLookup, restoredPointer, renderedChoice])
      .toEqual([...new Set([copiedChoice, preservedPointer, columnLookup, restoredPointer, renderedChoice])]);
    expect(copiedChoice).toBeLessThan(preservedPointer);
    expect(preservedPointer).toBeLessThan(columnLookup);
    expect(columnLookup).toBeLessThan(restoredPointer);
    expect(restoredPointer).toBeLessThan(renderedChoice);
  });

  it('builds the same packed ordered-choice SCR1 bytes as the backend codec', () => {
    const input = {
      schema: 'school.calc.result/v1', kind: 'responses', deviceId: '86A001', sequence: 0x010203,
      learnerKey: 4,
      artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 2,
      responses: [1, 5, 2, 4, 3].map((given, itemIndex) => ({ itemIndex, given })),
      localScore: { correct: 3, total: 5, percent: 60 },
    };
    const record = buildAssemblyShapedResult(input);
    expect(record.equals(encodeTi86ResultRecord(input))).toBe(true);
    expect(buildAssemblyShapedQueue(input.deviceId, [record])
      .equals(encodeTi86ResultQueue({ deviceId: input.deviceId, records: [record] }))).toBe(true);
    const next = { ...input, sequence: input.sequence + 1 };
    const nextRecord = buildAssemblyShapedResult(next);
    expect(buildAssemblyShapedQueue(input.deviceId, [record, nextRecord])
      .equals(encodeTi86ResultQueue({ deviceId: input.deviceId, records: [record, nextRecord] }))).toBe(true);
    expect(QUEUE).toMatch(/queue_build_empty_prefix:[\s\S]{0,360}ld bc,7/);
    expect(QUEUE).toMatch(/call queue_validate_nested_header[\s\S]{0,80}call queue_require_increasing_sequence/);
    expect(QUEUE).toMatch(/queue_require_increasing_sequence:[\s\S]*?queue_compare_increasing_sequence:[\s\S]*?jp c,queue_fail/);
  });

  it('builds the same append-only learning-probe SCR1 mode-3 bytes as the backend codec', () => {
    const input = {
      schema: 'school.calc.result/v1', kind: 'responses', deviceId: '86A001', sequence: 0x010204,
      learnerKey: 4, artifactId: 'sc:ti86:ABC234DEFG', moduleIndex: 3,
      responses: [
        { itemIndex: 0, given: 2, probe: { attempts: [2, 1], feedbackViewed: true, continued: true } },
        { itemIndex: 1, given: 1, probe: { attempts: [1], feedbackViewed: true, continued: true } },
      ],
      localScore: { correct: 1, total: 2, percent: 50 },
    };
    expect(buildAssemblyShapedProbeResult(input).equals(encodeTi86ResultRecord(input))).toBe(true);
    expect(ASSESSMENT).toContain('RUNTIME_DRAFT_PROBE:            equ 8');
    expect(ASSESSMENT).toMatch(/probe_choice_committed:[\s\S]{0,360}(?:jp|call) assessment_save_and_reopen/);
    expect(ASSESSMENT).toMatch(/probe_continue:[\s\S]{0,180}set 0,\(hl\)[\s\S]{0,120}call assessment_save_and_reopen/);
    expect(QUEUE).toContain('QUEUE_DRAFT_PROBE:      equ 8');
    expect(QUEUE).toMatch(/queue_build_probe:[\s\S]{0,80}ld \(hl\),3/);
    expect(QUEUE).toMatch(/queue_probe_pack_loop:[\s\S]{0,650}cp 3\s+jp nz,queue_fail/);
  });

  it('enforces append-before-success and backup-first replacement in source', () => {
    expect(ASSESSMENT).toMatch(/assessment_complete_pending:[\s\S]{0,700}RUNTIME_FLAG_RESULT_PENDING_HIGH[\s\S]{0,160}call runtime_state_save\s+ret c\s+call standard_launch_result_queue/);
    expect(ASSESSMENT).toMatch(/assessment_complete_pending:[\s\S]{0,320}call assessment_calculate_local_score/);
    expect(QUEUE).toMatch(/queue_pack_done:[\s\S]{0,420}RUNTIME_SCL_SCROLL_OFFSET[\s\S]{0,260}queue_build_payload_done/);
    expect(QUEUE).toMatch(/result_queue_commit:[\s\S]{0,260}call queue_append_result[\s\S]{0,120}call queue_advance_local_state[\s\S]{0,80}ret/);
    expect(QUEUE).toMatch(/call queue_create_candidate[\s\S]{0,2600}ld hl,queue_dsqb_name[\s\S]{0,160}call queue_validate_open[\s\S]{0,120}jp queue_replace_from_backup/);
    expect(QUEUE).toMatch(/queue_replace_from_backup:[\s\S]{0,1800}ld hl,queue_dsq_name[\s\S]{0,300}call queue_validate_open[\s\S]{0,120}ld hl,queue_dsqb_name/);
    expect(RUNTIME).toContain('include "runtime-assessment.asm"');
    expect(RUNTIME).not.toContain('include "runtime-queue.asm"');
    expect(RUNTIME).toContain('standard_scqueue_name: defb 0x12,7,"SCQUEUE",0');
    expect(QUEUE_RUNTIME).toContain('include "runtime-queue.asm"');
    expect(BUILD).toContain("fontIds: ['compact-3x5']");
    expect(`${ASSESSMENT}\n${QUEUE}\n${QUEUE_RUNTIME}`).not.toMatch(/(?:math|chemistry|physics|geography|economics|finance)/i);
  });
});

function equate(source, name) {
  const match = source.match(new RegExp(`^${name}:\\s+equ ([0-9]+)$`, 'm'));
  if (!match) throw new Error(`missing decimal assembly equate ${name}`);
  return Number.parseInt(match[1], 10);
}

function capabilityReport(moduleCapability) {
  return {
    capabilities: [moduleCapability, 'response.choice@1'],
    limits: { maxArtifactBytes: TI86_SCHOOLCALC_LIMITS.lessonMaxBytes },
  };
}

function bundle(type) {
  return {
    schema: 'school.learning-lesson/v1',
    address: `main/general/course/unit/${type}`,
    context: {
      catalog: { catalogId: 'main', title: 'Main' },
      subject: { subjectId: 'general', title: 'General' },
      course: { courseId: 'course', title: 'Course' },
      unit: { unitId: 'unit', title: 'Unit' },
    },
    lesson: {
      lessonId: type, title: 'A generic check', objectives: [],
      modules: [{
        moduleId: 'check', type, bankId: 'generic:check',
        bank: {
          id: 'generic:check', title: 'Check',
          items: [{
            id: 'one', type: 'multiple_choice',
            prompt: 'Read every part of this deliberately long prompt before choosing the second response from the fixed function keys.',
            choices: ['One', 'Two', 'Three'], answer: 'Two',
          }],
        },
      }],
    },
    capabilities: [type === 'flashcards' ? 'flashcards@1' : 'quiz@1', 'response.choice@1'],
  };
}

function buildAssemblyShapedResult(result) {
  const device = Buffer.from(result.deviceId, 'ascii');
  const key = Buffer.from(result.artifactId.slice('sc:ti86:'.length), 'ascii');
  const packed = Buffer.alloc(Math.ceil(result.responses.length / 2));
  for (let index = 0; index < result.responses.length; index += 2) {
    packed[index / 2] = (result.responses[index].given << 4)
      | (result.responses[index + 1]?.given ?? 0);
  }
  const body = Buffer.concat([
    Buffer.from([result.moduleIndex, device.length]), device,
    Buffer.from([result.sequence & 0xff, (result.sequence >>> 8) & 0xff, (result.sequence >>> 16) & 0xff]),
    Buffer.from([result.learnerKey & 0xff, result.learnerKey >>> 8]),
    key,
    Buffer.from([1, result.responses.length]),
    packed,
    Buffer.from([result.localScore.correct]),
  ]);
  const bytes = Buffer.alloc(7 + body.length + 2);
  bytes.write('SCR1', 0, 4, 'ascii');
  bytes[4] = 1;
  bytes.writeUInt16LE(body.length, 5);
  body.copy(bytes, 7);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  return bytes;
}

function buildAssemblyShapedProbeResult(result) {
  const device = Buffer.from(result.deviceId, 'ascii');
  const key = Buffer.from(result.artifactId.slice('sc:ti86:'.length), 'ascii');
  const trace = Buffer.alloc(result.responses.length * 2);
  result.responses.forEach((response, index) => {
    trace[index * 2] = (response.probe.attempts[0] << 4) | (response.probe.attempts[1] ?? 0);
    trace[index * 2 + 1] = ((response.probe.attempts[2] ?? 0) << 4)
      | (response.probe.feedbackViewed ? 2 : 0) | (response.probe.continued ? 1 : 0);
  });
  const body = Buffer.concat([
    Buffer.from([result.moduleIndex, device.length]), device,
    Buffer.from([result.sequence & 0xff, (result.sequence >>> 8) & 0xff, (result.sequence >>> 16) & 0xff]),
    Buffer.from([result.learnerKey & 0xff, result.learnerKey >>> 8]), key,
    Buffer.from([3, result.responses.length]), trace, Buffer.from([result.localScore.correct]),
  ]);
  const bytes = Buffer.alloc(7 + body.length + 2);
  bytes.write('SCR1', 0, 4, 'ascii');
  bytes[4] = 1;
  bytes.writeUInt16LE(body.length, 5);
  body.copy(bytes, 7);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  return bytes;
}

function buildAssemblyShapedQueue(deviceId, records) {
  const device = Buffer.from(deviceId, 'ascii');
  const recordBytes = records.map((record) => Buffer.concat([
    Buffer.from([record.length & 0xff, record.length >>> 8]), record,
  ]));
  const body = Buffer.concat([
    Buffer.from([device.length]), device,
    Buffer.from([records.length & 0xff, records.length >>> 8]),
    ...recordBytes,
  ]);
  const bytes = Buffer.alloc(7 + body.length + 2);
  bytes.write('SCQ1', 0, 4, 'ascii');
  bytes[4] = 1;
  bytes.writeUInt16LE(body.length, 5);
  body.copy(bytes, 7);
  bytes.writeUInt16LE(crc16Ccitt(bytes.subarray(0, -2)), bytes.length - 2);
  return bytes;
}
