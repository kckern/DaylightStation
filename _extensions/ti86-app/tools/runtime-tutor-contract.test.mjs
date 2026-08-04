import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import {
  TI86_RUNTIME_MODULES,
  inspectTi86RuntimeProgram,
} from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-tutor.asm'), 'utf8');
const PROFILE = readFileSync(path.join(EXTENSION, 'src', 'runtime-profile.asm'), 'utf8');
const SHELL = readFileSync(path.join(EXTENSION, 'src', 'schoolcalc.asm'), 'utf8');

describe('SCTUTOR durable interaction runtime', () => {
  it('builds inside the independent TI-86 execution window', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-tutor-runtime.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const file = readFileSync(path.join(EXTENSION, 'dist', 'SCTUTOR.86p'));
    const inspected = inspectTi86RuntimeProgram(file, TI86_RUNTIME_MODULES.realtimeTutor);
    expect(inspected).toMatchObject({
      id: 'realtime-tutor', moduleCode: 9, programName: 'SCTUTOR', capabilities: [],
    });
    expect(inspected.codeByteLength).toBeLessThanOrEqual(
      TI86_SCHOOLCALC_LIMITS.tutorRuntimeMaxBytes,
    );
  });

  it('binds staged responses to device, learner, and exact durable request before promotion', () => {
    expect(SOURCE).toContain('TUTOR_REQUEST_MAX_BYTES:   equ 512');
    expect(SOURCE).toContain('TUTOR_RESPONSE_MAX_BYTES:  equ 2048');
    expect(SOURCE).toContain('tutor_request_name:             defb 0x0C,6,"DSTREQ"');
    expect(SOURCE).toContain('tutor_stage_name:               defb 0x0C,6,"DSTNEW"');
    expect(SOURCE).toContain('tutor_response_name:            defb 0x0C,6,"DSTURN"');
    expect(SOURCE).toMatch(
      /tutor_stage_present:[\s\S]*?call tutor_validate_response_open[\s\S]*?call tutor_open_request[\s\S]*?call tutor_stage_matches_request[\s\S]*?call tutor_copy_stage/,
    );
    expect(SOURCE).toMatch(
      /tutor_stage_acknowledge:[\s\S]*?tutor_request_name[\s\S]*?tutor_stage_delete_staging:[\s\S]*?tutor_stage_name/,
    );
    expect(SOURCE).toMatch(
      /tutor_validate_response_open:[\s\S]*?tutor_validate_device_short[\s\S]*?SCSTATE_SELECTED_LEARNER_OFFSET[\s\S]*?tutor_response_request_id/,
    );
  });

  it('persists request then request counter, routes through sync, and keeps EXIT resumable', () => {
    expect(SOURCE).toMatch(
      /tutor_commit_new_request:[\s\S]*?_createstrng[\s\S]*?call tutor_open_request[\s\S]*?call tutor_advance_request_id[\s\S]*?tutor_route_sync_save/,
    );
    expect(SOURCE).toMatch(
      /tutor_route_existing_request:[\s\S]*?tutor_request_id_relation[\s\S]*?tutor_advance_request_id/,
    );
    expect(SOURCE).toMatch(
      /tutor_pause:[\s\S]*?TUTOR_VIEW_CATALOG[\s\S]*?call scstate_save[\s\S]*?ret/,
    );
    expect(PROFILE).toMatch(
      /progress_begin_followup:[\s\S]*?PROFILE_VIEW_TUTOR[\s\S]*?call scstate_save/,
    );
    expect(SHELL).toMatch(
      /launch_profile_runtime:[\s\S]*?SCREEN_TUTOR[\s\S]*?launch_tutor_runtime/,
    );
  });

  it('is generic and exposes A-E plus policy-projected learner controls, never an answer key', () => {
    expect(SOURCE).not.toMatch(/geography|mathematics|science|chemistry|plex|jellyfin|answer[_ -]?key/i);
    expect(SOURCE).toContain('tutor_choice_letters:           defb "A",0,"B",0,"C",0,"D",0,"E",0');
    expect(SOURCE).toContain('cp SC_SCAN_F5');
    expect(SOURCE).toContain('cp SC_SCAN_MORE');
    expect(SOURCE).toContain('tutor_more_label:               defb "MORE:OPT",0');
    expect(SOURCE).toContain('tutor_explain_label:            defb "WHY",0');
    expect(SOURCE).toContain('tutor_skip_label:               defb "SKIP",0');
    expect(SOURCE).toContain('tutor_challenge_label:          defb "KNOW",0');
    expect(SOURCE).toContain('tutor_stop_label:               defb "STOP",0');
    expect(SOURCE).toContain('tutor_connected_label:          defb "SYNCED",0');
    expect(SOURCE).not.toContain('defb "LIVE",0');
  });

  it('prioritizes an exact retained retry over stale turn input', () => {
    expect(SOURCE).toMatch(
      /tutor_render_softkeys:[\s\S]*?TUTOR_DISP_PROCESSING[\s\S]*?tutor_render_retry_key[\s\S]*?tutor_has_turn/,
    );
    expect(SOURCE).toMatch(
      /tutor_choose:[\s\S]*?TUTOR_DISP_COMPLETE[\s\S]*?tutor_retry_if_pending[\s\S]*?tutor_has_turn/,
    );
  });
});
