import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TI86_VIDEO_RAM } from './lib/ti86-program.mjs';
import { TI86_RUNTIME_MODULES, inspectTi86RuntimeProgram } from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..', '..');
const SOURCE = readFileSync(path.join(HERE, '..', 'src', 'runtime-adaptive.asm'), 'utf8');
const QUEUE = readFileSync(path.join(HERE, '..', 'src', 'runtime-queue.asm'), 'utf8');

describe('SchoolCalc Adaptive Study SCLEARN contract', () => {
  it('builds the adaptive-only SCLEARN below video RAM', () => {
    execFileSync(process.execPath, [path.join(HERE, 'build-standard-runtime.mjs')], {
      cwd: ROOT, stdio: 'pipe',
    });
    const program = inspectTi86RuntimeProgram(
      readFileSync(path.join(HERE, '..', 'dist', 'SCLEARN.86p')),
      TI86_RUNTIME_MODULES.standardLearning,
    );
    expect(program.codeByteLength).toBeLessThanOrEqual(TI86_RUNTIME_MODULES.standardLearning.maxCodeBytes);
    expect(0xD748 + program.codeByteLength).toBeLessThanOrEqual(TI86_VIDEO_RAM);
  });

  it('uses a bounded 45-byte continuation and persists before each next card', () => {
    expect(SOURCE).toContain('AD_DRAFT_BYTES:        equ 45');
    expect(SOURCE).toContain('AD_MAX_CARDS:          equ 12');
    expect(SOURCE).toMatch(/adaptive_rate:[\s\S]*call adaptive_choose_next[\s\S]*jp adaptive_dispatch/);
    expect(SOURCE).toMatch(/adaptive_choose_show:[\s\S]*jp adaptive_save/);
    expect(SOURCE).toMatch(/adaptive_quiz_complete:[\s\S]*call adaptive_save[\s\S]*call adaptive_launch_queue/);
  });

  it('rebinds validated immutable content without rescanning the whole bank between cards', () => {
    expect(SOURCE).toMatch(
      /adaptive_open_item:[\s\S]*?cp b\s+jr nz,adaptive_open_item_full[\s\S]*?call adaptive_reopen_validated_artifact/,
    );
    expect(SOURCE).toMatch(
      /adaptive_reopen_validated_artifact:[\s\S]*?rst 0x10[\s\S]*?call _get_word_ahl[\s\S]*?adaptive_artifact_length[\s\S]*?sc_record_body_end[\s\S]*?sc_cache_valid/,
    );
    expect(SOURCE).toMatch(/adaptive_start:[\s\S]*?call adaptive_validate_artifact[\s\S]*?adaptive_dispatch:/);
  });

  it('renders persisted outcome counts on their intended summary rows', () => {
    expect(SOURCE).toMatch(
      /adaptive_render_count_line:[\s\S]*?push bc[\s\S]*?call ui_draw_text[\s\S]*?call adaptive_format_byte[\s\S]*?pop bc[\s\S]*?ld b,108[\s\S]*?jp ui_draw_text/,
    );
  });

  it('labels quiz screens with the immutable artifact subject', () => {
    expect(SOURCE).toMatch(/adaptive_validate_artifact:[\s\S]*?call adaptive_load_subject/);
    expect(SOURCE).toMatch(/adaptive_load_subject:[\s\S]*?adaptive_key_context[\s\S]*?adaptive_key_subject[\s\S]*?adaptive_key_title[\s\S]*?ld b,18/);
    expect(SOURCE).toMatch(/adaptive_render_quiz_header:[\s\S]*?adaptive_quiz_title[\s\S]*?adaptive_subject_title/);
  });

  it('keeps F2 blank and exposes the exact front/back rails', () => {
    const rail = SOURCE.match(/adaptive_render_card_rail:[\s\S]*?; ---------------------------------------------------------------------------\n; Summary/)?.[0];
    expect(rail).toBeTruthy();
    expect(rail).toContain('adaptive_label_flip');
    expect(rail).toContain('adaptive_label_again');
    expect(rail).toContain('adaptive_label_hard');
    expect(rail).toContain('adaptive_label_know');
    expect(rail).not.toContain('SC_SCAN_F2');
    expect(SOURCE.match(/adaptive_card_wait:[\s\S]*?adaptive_flip:/)?.[0]).not.toContain('SC_SCAN_F2');
  });

  it('renders flashcards as bordered, horizontally and vertically centered surfaces', () => {
    const card = SOURCE.match(/adaptive_render_card:[\s\S]*?adaptive_card_wait:/)?.[0];
    expect(card).toBeTruthy();
    expect(card).toMatch(/call adaptive_draw_card_frame[\s\S]*?call adaptive_draw_centered_page/);
    expect(SOURCE).toMatch(/adaptive_draw_card_frame:[\s\S]*?ld b,1\s+ld c,9\s+ld d,126\s+ld e,1\s+call ui_fill_rect/);
    expect(SOURCE).toMatch(/adaptive_draw_card_frame:[\s\S]*?ld b,126\s+ld c,9\s+ld d,1\s+ld e,46\s+jp ui_fill_rect/);
    expect(SOURCE).toMatch(/adaptive_center_lines_ready:[\s\S]*?ld a,33[\s\S]*?adaptive_center_draw_line:[\s\S]*?ld a,64[\s\S]*?call ui_draw_text_count/);
    expect(SOURCE).toMatch(
      /adaptive_card_graphic_ready:[\s\S]*?adaptive_verso_frame - 144[\s\S]*?call adaptive_draw_centered_page[\s\S]*?ld \(ui_video_base\),hl[\s\S]*?call adaptive_render_header[\s\S]*?ld de,VideoRam \+ 144[\s\S]*?ldir/,
    );
  });

  it('preloads the opposite face and swaps both directions before the durable face write', () => {
    expect(SOURCE).toMatch(
      /adaptive_render_card:[\s\S]*?call adaptive_render_card_rail[\s\S]*?call adaptive_preload_opposite_face/,
    );
    expect(SOURCE).toMatch(
      /adaptive_preload_opposite_face:[\s\S]*?adaptive_key_answer_pages[\s\S]*?adaptive_key_prompt_pages[\s\S]*?adaptive_key_answer_graphic[\s\S]*?adaptive_key_prompt_graphic[\s\S]*?adaptive_verso_frame/,
    );
    expect(SOURCE).toMatch(
      /adaptive_flip:[\s\S]*?xor 1[\s\S]*?call adaptive_swap_cached_face[\s\S]*?call adaptive_save[\s\S]*?jp adaptive_card_wait/,
    );
    expect(SOURCE).toMatch(/adaptive_swap_cached_face:\s+di[\s\S]*?ld hl,adaptive_verso_frame[\s\S]*?ld de,VideoRam \+ 144[\s\S]*?ld bc,880[\s\S]*?ex af,af'[\s\S]*?ld \(de\),a[\s\S]*?ld \(hl\),a[\s\S]*?ei\s+ret/);
    expect(SOURCE).toContain('adaptive_verso_frame:        defs 880,0');
  });

  it('clears to immediate loading feedback before rating persistence and scheduling', () => {
    expect(SOURCE).toMatch(
      /adaptive_rate:\s+push bc\s+call adaptive_render_loading\s+pop bc[\s\S]*?call adaptive_choose_next/,
    );
    expect(SOURCE).toMatch(/adaptive_render_loading:[\s\S]*?call _clrLCD[\s\S]*?adaptive_label_loading/);
    expect(SOURCE).toContain('adaptive_label_loading:      defb "LOADING...",0');
  });

  it('renders bounded vector commands and reserves a centered caption band', () => {
    expect(SOURCE).toContain('adaptive_key_prompt_graphic: defb "promptGraphic",0');
    expect(SOURCE).toContain('adaptive_key_answer_graphic: defb "answerGraphic",0');
    expect(SOURCE).toMatch(/adaptive_draw_graphic:[\s\S]*?cp SC_TAG_BYTES[\s\S]*?cp 161[\s\S]*?adaptive_graphic_command_loop:/);
    expect(SOURCE).toMatch(/adaptive_graphic_command_loop:[\s\S]*?cp 1[\s\S]*?adaptive_graphic_line[\s\S]*?cp 2[\s\S]*?adaptive_graphic_label/);
    expect(SOURCE).toMatch(/adaptive_draw_line:[\s\S]*?adaptive_line_x_loop:[\s\S]*?call adaptive_line_plot[\s\S]*?adaptive_line_y_loop:[\s\S]*?call adaptive_line_plot/);
    expect(SOURCE).toMatch(/adaptive_center_base_ready:[\s\S]*?sub b/);
  });

  it('maps the five physical function keys explicitly to quiz choices A-E', () => {
    const choices = SOURCE.match(/adaptive_choice_wait:[\s\S]*?adaptive_quiz_back_prompt:/)?.[0];
    expect(choices).toBeTruthy();
    for (const [key, value] of [['F1', 1], ['F2', 2], ['F3', 3], ['F4', 4], ['F5', 5]]) {
      expect(choices).toMatch(new RegExp(`cp SC_SCAN_${key}\\s+ld b,${value}`));
    }
    expect(choices).not.toContain('sub b');
    expect(SOURCE).toContain('adaptive_label_answers:      defb "CHOICE",0');
    expect(SOURCE).toMatch(
      /adaptive_render_choice_rail:[\s\S]*?ld b,11[\s\S]*?ld b,37[\s\S]*?ld b,63[\s\S]*?ld b,89[\s\S]*?ld b,115/,
    );
  });

  it('packs canonical mode-4 cards and choices through the crash-safe queue', () => {
    expect(QUEUE).toContain('QUEUE_DRAFT_ADAPTIVE:   equ 9');
    expect(QUEUE).toMatch(/queue_build_adaptive:[\s\S]*ld \(hl\),4[\s\S]*queue_adaptive_card_loop:[\s\S]*and 0x0F[\s\S]*queue_adaptive_choice_loop:/);
    expect(QUEUE).toMatch(/queue_sequence_advanced:[\s\S]*cp QUEUE_DRAFT_ADAPTIVE[\s\S]*queue_advance_adaptive:/);
  });
});
