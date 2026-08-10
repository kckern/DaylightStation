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
    expect(program.codeByteLength).toBeLessThanOrEqual(9216);
    expect(0xD748 + program.codeByteLength).toBeLessThanOrEqual(TI86_VIDEO_RAM);
  });

  it('uses a bounded 45-byte continuation and persists before each next card', () => {
    expect(SOURCE).toContain('AD_DRAFT_BYTES:        equ 45');
    expect(SOURCE).toContain('AD_MAX_CARDS:          equ 12');
    expect(SOURCE).toMatch(/adaptive_rate:[\s\S]*call adaptive_choose_next[\s\S]*jp adaptive_dispatch/);
    expect(SOURCE).toMatch(/adaptive_choose_show:[\s\S]*jp adaptive_save/);
    expect(SOURCE).toMatch(/adaptive_quiz_complete:[\s\S]*call adaptive_save[\s\S]*call adaptive_launch_queue/);
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

  it('packs canonical mode-4 cards and choices through the crash-safe queue', () => {
    expect(QUEUE).toContain('QUEUE_DRAFT_ADAPTIVE:   equ 9');
    expect(QUEUE).toMatch(/queue_build_adaptive:[\s\S]*ld \(hl\),4[\s\S]*queue_adaptive_card_loop:[\s\S]*and 0x0F[\s\S]*queue_adaptive_choice_loop:/);
    expect(QUEUE).toMatch(/queue_sequence_advanced:[\s\S]*cp QUEUE_DRAFT_ADAPTIVE[\s\S]*queue_advance_adaptive:/);
  });
});
