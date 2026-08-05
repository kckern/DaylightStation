import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Ti86SchoolCalcCodec } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  SCHOOLCALC_LOCAL_STATE_OFFSETS,
  SCHOOLCALC_LOCAL_STATE_BYTES,
  SCHOOLCALC_LOCAL_VIEW,
} from './lib/schoolcalc-local-state.mjs';
import { openSchoolCalcRecord } from './lib/schoolcalc-record-view.mjs';
import {
  TI86_RUNTIME_MODULES,
  inspectTi86RuntimeProgram,
} from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-catalog.asm'), 'utf8');
const STATE = readFileSync(path.join(EXTENSION, 'src', 'runtime-state.asm'), 'utf8');
const SHELL = readFileSync(path.join(EXTENSION, 'src', 'schoolcalc.asm'), 'utf8');

describe('SCCAT generic Catalog runtime contract', () => {
  it('builds the closed, checksummed catalog-browser runtime inside its ceiling', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-catalog-runtime.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const inspected = inspectTi86RuntimeProgram(
      readFileSync(path.join(EXTENSION, 'dist', 'SCCAT.86p')),
      TI86_RUNTIME_MODULES.catalogBrowser,
    );
    expect(inspected).toEqual(expect.objectContaining({
      id: 'catalog-browser', moduleCode: 3, programName: 'SCCAT', capabilities: [],
    }));
    expect(inspected.codeByteLength).toBeLessThanOrEqual(8 * 1024);
  });

  it('uses the canonical SCL1 views and fixed offsets shared with the shell', () => {
    expect(equate(STATE, 'SCSTATE_RECORD_BYTES')).toBe(SCHOOLCALC_LOCAL_STATE_BYTES);
    expect(equate(STATE, 'SCSTATE_VIEW_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.view);
    expect(equate(STATE, 'SCSTATE_ARTIFACT_KEY_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.artifactKey);
    expect(equate(STATE, 'SCSTATE_CATALOG_INDEX_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.catalogIndex);
    expect(equate(STATE, 'SCSTATE_SUBJECT_INDEX_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.subjectIndex);
    expect(equate(STATE, 'SCSTATE_COURSE_INDEX_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.courseIndex);
    expect(equate(STATE, 'SCSTATE_UNIT_INDEX_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.unitIndex);
    expect(equate(STATE, 'SCSTATE_LESSON_INDEX_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.lessonIndex);
    expect(equate(STATE, 'SCSTATE_MODULE_INDEX_OFFSET')).toBe(SCHOOLCALC_LOCAL_STATE_OFFSETS.moduleIndex);
    expect(equate(SOURCE, 'CAT_VIEW_CATALOG')).toBe(SCHOOLCALC_LOCAL_VIEW.catalog);
    expect(equate(SOURCE, 'CAT_VIEW_SUBJECT')).toBe(SCHOOLCALC_LOCAL_VIEW.subject);
    expect(equate(SOURCE, 'CAT_VIEW_COURSE')).toBe(SCHOOLCALC_LOCAL_VIEW.course);
    expect(equate(SOURCE, 'CAT_VIEW_UNIT')).toBe(SCHOOLCALC_LOCAL_VIEW.unit);
    expect(equate(SOURCE, 'CAT_VIEW_LESSON')).toBe(SCHOOLCALC_LOCAL_VIEW.lesson);
    expect(equate(SOURCE, 'CAT_VIEW_MODULE')).toBe(SCHOOLCALC_LOCAL_VIEW.module);
    expect(SOURCE).toContain('include "runtime-state.asm"');
  });

  it('traverses only neutral Catalog hierarchy and the five closed lesson states', () => {
    const record = new Ti86SchoolCalcCodec().encodeCatalog(catalogProjection());
    const view = openSchoolCalcRecord(record, { expectedMagic: 'SCC1' });
    const lessonPath = ['catalogs', 0, 'subjects', 0, 'courses', 0, 'units', 0, 'lessons'];
    expect(view.path(...lessonPath, 0, 'address').value).toBe('main/general/course/unit/installed');
    expect([0, 1, 2, 3, 4].map((index) => view.path(...lessonPath, index, 'state').value))
      .toEqual(['installed', 'available', 'requested', 'update_available', 'incompatible']);
    expect(view.path(...lessonPath, 4, 'reasons', 0).value)
      .toBe('missing capability special-view@1');
    expect(view.path('catalogs', 0, 'access', 'learnerKeys', 0).value).toBe(4);
    expect(view.path(...lessonPath, 0, 'access', 'guest').value).toBe(false);

    for (const key of ['catalogs', 'subjects', 'courses', 'units', 'lessons', 'modules']) {
      expect(SOURCE).toContain(`cat_key_${key}:`);
    }
    expect(SOURCE).not.toMatch(/(?:math|chemistry|physics|geography|economics|finance)/i);
  });

  it('treats SCC1 as one installed Catalog and opens directly at Subjects', () => {
    expect(SOURCE).toMatch(
      /cat_normalize_view:[\s\S]*?CAT_VIEW_CATALOG[\s\S]*?CAT_VIEW_SUBJECT[\s\S]*?scstate_save[\s\S]*?call cat_transition/,
    );
    expect(SOURCE).toMatch(
      /cat_open_array:[\s\S]*?cat_key_catalogs[\s\S]*?call cat_read_raw_count[\s\S]*?cp 1[\s\S]*?call sc_array_item[\s\S]*?push de[\s\S]*?call cat_item_authorized[\s\S]*?pop de[\s\S]*?cat_key_subjects/,
    );
    expect(SOURCE).not.toContain('cat_header_catalogs:');
    expect(SOURCE).toMatch(/cat_back:[\s\S]{0,120}CAT_VIEW_SUBJECT\s+ret z/);
  });

  it('filters every Catalog hierarchy level by the selected learner key and Guest policy', () => {
    expect(SOURCE).toContain('cat_key_access:');
    expect(SOURCE).toContain('cat_key_learner_keys:');
    expect(SOURCE).toContain('cat_key_guest:');
    expect(SOURCE).toMatch(
      /cat_item_authorized:[\s\S]*?SCSTATE_SELECTED_LEARNER_OFFSET[\s\S]*?cat_key_guest[\s\S]*?cat_key_learner_keys/,
    );
    expect(SOURCE).toMatch(
      /cat_capture_visible_count:[\s\S]*?call cat_item_authorized[\s\S]*?cat_count_visible_done/,
    );
    expect(SOURCE).toMatch(
      /cat_visible_array_item:[\s\S]*?call cat_item_authorized[\s\S]*?cat_visible_item_next/,
    );
    expect(SOURCE).toMatch(
      /cat_enter_lesson:[\s\S]{0,180}call cat_item_authorized[\s\S]{0,100}cat_notice_unavailable/,
    );
    expect(SOURCE).toContain('cat_empty_text:      defb "NO CONTENT.",0');
  });

  it('makes incompatible lessons non-actionable and exposes all projected reasons', () => {
    expect(SOURCE).toMatch(
      /cat_enter_lesson:[\s\S]{0,520}cp 4[\s\S]{0,80}jp z,cat_stage_update[\s\S]{0,80}jp cat_show_incompatible/,
    );
    expect(SOURCE).toMatch(
      /cat_show_incompatible:[\s\S]{0,240}cat_key_reasons[\s\S]{0,720}jp cat_render_incompatible/,
    );
    expect(SOURCE).toMatch(
      /cat_render_incompatible:[\s\S]{0,720}call ui_draw_wrapped_text[\s\S]{0,520}cp SC_SCAN_UP[\s\S]{0,160}cp SC_SCAN_DOWN/,
    );
    expect(SOURCE).toContain('cat_incompatible_title: defb "UNSUPPORTED",0');
    expect(SOURCE).not.toMatch(/cat_show_incompatible:[\s\S]{0,800}cat_mark_delivery_pending/);
  });

  it('commits navigation or delivery continuation before returning or invoking SCREQ', () => {
    expect(SOURCE).toMatch(/cat_enter_module:[\s\S]{0,420}call scstate_save[\s\S]{0,80}ret/);
    expect(SOURCE).toMatch(
      /cat_mark_delivery_pending:[\s\S]{0,420}call scstate_save\s+ret/,
    );
    expect(SOURCE).toMatch(
      /cat_stage_action:[\s\S]{0,300}call cat_mark_delivery_pending[\s\S]{0,100}call cat_run_request_maintenance/,
    );
    expect(SOURCE).toContain('cat_screq_name:  defb 0x12,5,"SCREQ",0,0,0');
    expect(SOURCE).toContain('call _exec_assembly');
    expect(SOURCE).toMatch(
      /cat_run_request_maintenance:\s+;[\s\S]*?SCSTATE_FLAG_DELIVERY_PENDING_HIGH\s+ret z[\s\S]*?ld hl,cat_screq_name/,
    );
    expect(SOURCE).not.toMatch(/sc_map_find_literal[\s\S]{0,120}_exec_assembly/);
    expect(SHELL).toContain('sccat_name:     defb 0x12,5,"SCCAT",0,0,0');
  });

  it('uses the full 128x64 list pattern, arrows, scrolling, and F-key actions', () => {
    expect(equate(SOURCE, 'CAT_VISIBLE_ROWS')).toBe(6);
    expect(SOURCE).toContain('cat_chevron:         defb ">",0');
    expect(SOURCE).toMatch(/cat_render_rail:[\s\S]{0,420}call ui_fill_rect/);
    expect(SOURCE).toContain('cp SC_SCAN_UP');
    expect(SOURCE).toContain('cp SC_SCAN_DOWN');
    expect(SOURCE).toContain('cp SC_SCAN_F1');
    expect(SOURCE).toMatch(/cp SC_SCAN_F2\s+jp z,cat_back/);
    expect(SOURCE).toMatch(/cp SC_SCAN_F3\s+jp z,cat_open_profile/);
    expect(SOURCE).toContain('cp SC_SCAN_F4');
    expect(SOURCE).toContain('cp SC_SCAN_F5');
    expect(SOURCE).toContain('cat_soft_back:       defb "BACK",0');
    expect(SOURCE).toMatch(/cat_f5:[\s\S]{0,220}CAT_VIEW_SUBJECT[\s\S]{0,100}cat_sync[\s\S]{0,140}cat_has_pages[\s\S]{0,100}cat_page_down/);
    expect(SOURCE).toMatch(/cat_render_softkeys:[\s\S]{0,2200}cat_has_pages[\s\S]{0,700}cat_has_more[\s\S]{0,200}cat_soft_eom[\s\S]{0,120}cat_soft_more/);
    expect(SOURCE).toContain('cat_soft_more:       defb "NEXT",0');
    expect(SOURCE).toContain('cat_soft_eom:        defb "END",0');
    expect(SOURCE).toContain('cat_soft_sync:       defb "OFF",0');
    expect(SOURCE).toContain('cat_soft_cancel:     defb "CANCEL",0');
    expect(SOURCE).toContain('cat_soft_request:    defb "REQUEST",0');
    expect(SOURCE).toContain('ld d,128');
    expect(SOURCE).toContain('ld c,56');
  });

  it('keeps learner identity visible without letting roster reads redirect Catalog traversal', () => {
    expect(SOURCE).toMatch(
      /cat_render_header:[\s\S]*?cat_copy_selected_label[\s\S]*?CAT_VIEW_SUBJECT[\s\S]*?call cat_copy_context_title[\s\S]*?ui_draw_text_right/,
    );
    expect(SOURCE).toMatch(
      /cat_copy_selected_label:[\s\S]*?cat_dsusers_name[\s\S]*?cat_scu1_magic[\s\S]*?cat_selected_label/,
    );
    expect(SOURCE).toContain('cat_soft_user:       defb "USER",0');
    expect(SOURCE).toMatch(
      /cat_render_ready:[\s\S]*?call cat_render_header[\s\S]*?call cat_open_array[\s\S]*?call cat_render_rows/,
    );
    expect(SOURCE).toMatch(
      /cat_open_profile:[\s\S]*?cat_scprof_name[\s\S]*?call _exec_assembly[\s\S]*?cat_normalize_view/,
    );
  });

  it('uses the containing content title as a one-line breadcrumb on every non-root list', () => {
    expect(SOURCE).toMatch(
      /cat_open_array:[\s\S]*?SCSTATE_SUBJECT_INDEX_OFFSET[\s\S]*?cat_context_offset[\s\S]*?cat_key_courses[\s\S]*?SCSTATE_COURSE_INDEX_OFFSET[\s\S]*?cat_context_offset[\s\S]*?cat_key_units[\s\S]*?SCSTATE_UNIT_INDEX_OFFSET[\s\S]*?cat_context_offset[\s\S]*?cat_key_lessons/,
    );
    expect(SOURCE).toMatch(
      /cat_open_module_array:[\s\S]*?cat_key_lesson[\s\S]*?cat_context_offset[\s\S]*?cat_key_modules/,
    );
    expect(SOURCE).toMatch(
      /cat_copy_context_title:[\s\S]*?call cat_open_array[\s\S]*?cat_context_offset[\s\S]*?cat_key_title[\s\S]*?sc_copy_node_string/,
    );
  });

  it('moves focus within a viewport by changing only its chevron cells', () => {
    expect(SOURCE).toMatch(
      /cat_move_save:[\s\S]{0,800}cat_previous_scroll[\s\S]{0,120}cat_render_selection_delta[\s\S]{0,80}jp cat_wait/,
    );
    expect(SOURCE).toMatch(
      /cat_render_selection_delta:[\s\S]{0,600}ld d,3\s+ld e,5[\s\S]{0,600}cat_chevron/,
    );
    expect(SOURCE).toMatch(
      /cat_move_redraw_body:[\s\S]{0,480}ld d,128\s+ld e,46/,
    );
  });

  it('leapfrogs a whole one-option hierarchy before one local transition and state write', () => {
    expect(SOURCE).toMatch(/cat_normalize_catalog_route:[\s\S]{0,700}call scstate_save[\s\S]{0,80}call cat_transition/);
    // The loading interstitial owns HL for its label. Preserve the parent
    // state offset through it so a nonzero Subject cannot collapse through
    // the first subject after the acknowledgement animation.
    expect(SOURCE).toMatch(/cat_enter_level:[\s\S]*?push hl\s+call cat_transition[\s\S]*?cat_transition_seen[\s\S]*?pop hl\s+pop af\s+call cat_apply_enter_level[\s\S]*?jp cat_render/);
    expect(SOURCE).toMatch(/cat_auto_enter_level:[\s\S]{0,160}call cat_apply_enter_level[\s\S]{0,80}ld a,1\s+ret/);
    expect(SOURCE).toMatch(/cat_auto_open_lesson:[\s\S]{0,780}call cat_apply_open_installed_lesson[\s\S]{0,100}ld a,1\s+ret/);
    expect(SOURCE).toMatch(/cat_auto_finish:[\s\S]{0,260}cat_transition_seen[\s\S]{0,120}call cat_transition[\s\S]{0,180}call scstate_save[\s\S]{0,100}jp c,cat_fail_save/);
    expect(SOURCE).toMatch(/cat_transition_render:[\s\S]{0,100}call cat_transition[\s\S]{0,100}call scstate_save[\s\S]{0,100}jp cat_render/);
    expect(SOURCE).toMatch(/cat_open_installed_lesson:[\s\S]{0,220}call cat_apply_open_installed_lesson[\s\S]{0,120}jp cat_transition_render/);
    expect(SOURCE).toMatch(/cat_enter_module:[\s\S]{0,500}call cat_transition[\s\S]{0,100}call scstate_save[\s\S]{0,80}ret/);
    expect(SOURCE).toMatch(/cat_transition:[\s\S]*?call _clrLCD[\s\S]*?cat_loading_label[\s\S]*?ld bc,0x3818[\s\S]*?ld bc,0x3A22/);
    expect(SOURCE).toMatch(/cat_transition_pulse:[\s\S]*?ld a,'\.'[\s\S]*?call ui_draw_glyph[\s\S]*?cat_transition_pulse_wait:[\s\S]*?call _idle[\s\S]*?djnz cat_transition_pulse_wait[\s\S]*?call ui_mode_clear[\s\S]*?call ui_mode_set[\s\S]*?cp 74/);
    expect(SOURCE).toMatch(/cat_auto_open_module:[\s\S]{0,360}call cat_auto_finish[\s\S]{0,80}ld a,2\s+ret/);
    expect(SOURCE).toMatch(/cat_remove:[\s\S]{0,600}cat_render_remove_confirm/);
    expect(SOURCE).toMatch(/cat_render_remove_confirm:[\s\S]{0,1800}cat_soft_cancel[\s\S]{0,400}cat_soft_request/);
    expect(SOURCE).toMatch(/cat_remove_confirm_wait:[\s\S]{0,700}CAT_ACTION_REMOVE[\s\S]{0,80}cat_stage_action/);
  });
});

function equate(source, name) {
  const match = source.match(new RegExp(`^${name}:\\s+equ ([0-9]+)$`, 'm'));
  if (!match) throw new Error(`missing decimal assembly equate ${name}`);
  return Number.parseInt(match[1], 10);
}

function catalogProjection() {
  const states = ['installed', 'available', 'requested', 'update_available', 'incompatible'];
  const access = { learnerKeys: [4], guest: false };
  return {
    schema: 'school.calc.catalog-projection/v1',
    deviceId: '86A001',
    platformId: 'ti86',
    generation: `sha256:${'a'.repeat(64)}`,
    catalogs: [{
      catalogId: 'main', title: 'Main', access, subjects: [{
        subjectId: 'general', title: 'General', access, courses: [{
          courseId: 'course', title: 'Course', access, units: [{
            unitId: 'unit', title: 'Unit', access, lessons: states.map((state) => ({
              lessonId: state, title: state, state, compatible: state !== 'incompatible',
              address: `main/general/course/unit/${state}`,
              access,
              reasons: state === 'incompatible' ? ['missing capability special-view@1'] : [],
              artifactId: state === 'available' || state === 'requested'
                ? null
                : 'sc:ti86:ABC234DEFG',
            })),
          }],
        }],
      }],
    }],
  };
}
