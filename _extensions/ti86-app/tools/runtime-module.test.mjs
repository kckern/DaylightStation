import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';
import { TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import {
  createTi86AsmProgram,
  verifyTi86Program,
  verifyTi86ProgramGroup,
} from './lib/ti86-program.mjs';
import {
  TI86_RUNTIME_ABI_VERSION,
  TI86_RUNTIME_EXECUTOR_HEADER_BYTES,
  TI86_RUNTIME_MAGIC,
  TI86_RUNTIME_MODULES,
  createTi86ClientReleaseManifest,
  inspectTi86RuntimeInstallation,
  inspectTi86RuntimeProgram,
} from './lib/ti86-runtime-module.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ROOT = path.resolve(EXTENSION, '..', '..');
const SHELL_SOURCE = readFileSync(path.join(EXTENSION, 'src', 'schoolcalc.asm'), 'utf8');
const RUNTIME_SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-standard.asm'), 'utf8');
const ADAPTIVE_RUNTIME_SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-adaptive.asm'), 'utf8');
const SYNC_RUNTIME_SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-sync.asm'), 'utf8');
const NATIVE_RUNTIME_SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-native.asm'), 'utf8');
const PROFILE_RUNTIME_SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-profile.asm'), 'utf8');
const CATALOG_RUNTIME_SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-catalog.asm'), 'utf8');
const CONTENT_RUNTIME_SOURCE = readFileSync(path.join(EXTENSION, 'src', 'runtime-content.asm'), 'utf8');
const RELEASE_RESOURCE_DOCS = [
  readFileSync(path.join(EXTENSION, 'README.md'), 'utf8'),
  readFileSync(path.join(EXTENSION, 'docs', 'runtime-modules.md'), 'utf8'),
  readFileSync(path.join(EXTENSION, 'docs', 'schoolcalc-requirements.md'), 'utf8'),
  readFileSync(path.join(EXTENSION, 'docs', 'delivery-matrix.md'), 'utf8'),
];

describe('TI-86 reviewed runtime-module boundary', () => {
  it('builds a bounded, checksummed SCLEARN program with the closed ABI header', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-standard-runtime.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const file = readFileSync(path.join(EXTENSION, 'dist', 'SCLEARN.86p'));
    const inspected = inspectTi86RuntimeProgram(file, TI86_RUNTIME_MODULES.standardLearning);
    expect(inspected).toEqual(expect.objectContaining({
      abiVersion: TI86_RUNTIME_ABI_VERSION,
      id: 'standard-learning',
      programName: 'SCLEARN',
      capabilities: [],
    }));
    expect(inspected.codeByteLength).toBeLessThanOrEqual(TI86_SCHOOLCALC_LIMITS.standardRuntimeMaxBytes);

    const corrupt = Buffer.from(file);
    corrupt[corrupt.length - 8] ^= 1;
    expect(() => inspectTi86RuntimeProgram(corrupt)).toThrow();
  });

  it('keeps the adaptive dispatch build-owned and excludes inactive learner routes', () => {
    expect(SHELL_SOURCE).toMatch(/launch_standard_runtime:\s+ld hl,sclearn_name/);
    expect(SHELL_SOURCE).toContain('call _exec_assembly');
    expect(SHELL_SOURCE).toContain('call local_state_load');
    expect(SHELL_SOURCE).toContain('sclearn_name:   defb 0x12,7,"SCLEARN",0');
    expect(SHELL_SOURCE).toContain('call local_state_save\n        ld hl,scsync_name');
    expect(SHELL_SOURCE).toContain('scsync_name:    defb 0x12,6,"SCSYNC",0,0');
    expect(SHELL_SOURCE).toMatch(/start:[\s\S]{0,800}call sync_commit_staged[\s\S]{0,800}jp show_code/);
    expect(SHELL_SOURCE).toMatch(/show_home:\s+show_catalog:\s+jp show_code/);
    expect(SHELL_SOURCE).toMatch(/shell_code_open:[\s\S]{0,220}jp nz,launch_standard_runtime/);
    expect(SHELL_SOURCE).toContain('publish_study_entry:');
    expect(SHELL_SOURCE).toContain('dsentry_name:   defb 0x0C,7,"DSENTRY",0');
    expect(SHELL_SOURCE).toMatch(
      /launch_sync_runtime:[\s\S]*?call publish_device_info[\s\S]*?call local_state_save[\s\S]*?call _exec_assembly[\s\S]*?call sync_commit_staged/,
    );
    expect(SHELL_SOURCE).toContain('if 0\nlaunch_profile_runtime:');
    expect(SHELL_SOURCE).not.toMatch(/hydrate_.*(?:program|exec)|sc_map_find_literal[\s\S]{0,80}_exec_assembly/i);
  });

  it('cannot persist an inactive session identity into SCL1', () => {
    expect(CATALOG_RUNTIME_SOURCE).toMatch(
      /cat_clear_learning_session:[\s\S]*?SCSTATE_DRAFT_LENGTH_OFFSET[\s\S]*?SCSTATE_SESSION_LEARNER_OFFSET[\s\S]*?ret/,
    );
  });

  it('restores the durable selected learner after validating every SCG1 profile', () => {
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /progress_open_view:[\s\S]*?ld \(profile_target_key\),hl[\s\S]*?call progress_open_canonical[\s\S]*?progress_canonical_ready:[\s\S]*?ld hl,\(scstate_record \+ SCSTATE_SELECTED_LEARNER_OFFSET\)[\s\S]*?ld \(profile_target_key\),hl[\s\S]*?call progress_find_key/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /profile_copy_selected_label:[\s\S]*?SCSTATE_SELECTED_LEARNER_OFFSET[\s\S]*?profile_guest[\s\S]*?profile_item_at_index/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /profile_copy_selected_named:[\s\S]*?call profile_item_at_index[\s\S]*?ld hl,profile_label\s+ret/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /progress_render:[\s\S]{0,120}ld de,progress_learner_label[\s\S]{0,80}profile_render_message_header/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /progress_canonical_ready:[\s\S]{0,1000}call profile_open_canonical[\s\S]{0,120}call profile_copy_selected_label[\s\S]{0,180}call progress_open_canonical/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /profile_open_catalog:[\s\S]*?SCSTATE_FLAG_LEARNER_SELECTED_HIGH[\s\S]*?scstate_save/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /PROFILE_VIEW_USER[\s\S]*?profile_open_user:[\s\S]*?progress_open_view[\s\S]*?progress_open_picker:/,
    );
    expect(CATALOG_RUNTIME_SOURCE).toMatch(
      /SC_SCAN_F3[\s\S]*?cat_open_profile:[\s\S]*?cat_scprof_name[\s\S]*?cat_copy_selected_label/,
    );
  });

  it('validates the immutable SCX1 executor envelope before TI-OS loads the runtime and rejects lesson-shaped bytes', () => {
    expect(ADAPTIVE_RUNTIME_SOURCE).toMatch(
      /adaptive_start:[\s\S]{0,100}call _runindicoff\s+call sc_input_init/,
    );
    expect(SHELL_SOURCE).toContain('The SCX1 executor envelope is 21 executable bytes');
    expect(SHELL_SOURCE).toContain('runtime_header_prefix:  defb 0x8E,0x28,0x00,0xC3,0x5E,0xD7,0x00,0x00,0x5D,0xD7,"SCX1",1');
    expect(SHELL_SOURCE).toContain('Program wrapper (2) + executor envelope (21) = first CRC byte.');

    const content = Buffer.alloc(32, 0);
    content.write('SCP1', 'ascii');
    const executableContainer = createTi86AsmProgram({ name: 'SCLEARN', code: content });
    expect(() => inspectTi86RuntimeProgram(executableContainer))
      .toThrow(/entry jump|magic/);
  });

  it('creates the digest-pinned Adaptive Study v1 default installation', () => {
    const output = execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-complete-install.mjs')], {
      cwd: ROOT,
      encoding: 'utf8',
    });
    const bundle = output.match(/audited install [^:]+: (.+)\n/)?.[1];
    expect(bundle).toBeTruthy();
    const manifest = JSON.parse(readFileSync(path.join(bundle, 'complete-install.json'), 'utf8'));
    expect(manifest).toMatchObject({
      schema: 'school.calc.ti86-complete-install/v1',
      product: 'schoolcalc-adaptive-study/v1',
      programs: ['SCHLCALC', 'SCLEARN', 'SCQUEUE', 'SCQR', 'SCSYNC'],
      launcher: 'ASCHL',
      inactiveLearnerRoutes: ['SCCAT', 'SCPROF', 'SCTUTOR', 'SCNATIVE', 'SCREQ'],
    });
    expect(manifest.transfer.map(({ fileName }) => fileName)).toEqual([
      'SCHLCALC.86p', 'SCLEARN.86p', 'SCQUEUE.86p', 'SCQR.86p', 'SCSYNC.86p',
      'DSID.86s', 'ASCHL.86p',
    ]);
    for (const entry of manifest.transfer) expect(entry.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it.skip('retains the superseded broad v0 client-release builder as reference tooling', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-schoolcalc-client.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const shellFile = readFileSync(path.join(EXTENSION, 'dist', 'SCHLCALC.86p'));
    const moduleFile = readFileSync(path.join(EXTENSION, 'dist', 'SCLEARN.86p'));
    const qrModuleFile = readFileSync(path.join(EXTENSION, 'dist', 'SCQR.86p'));
    const catalogModuleFile = readFileSync(path.join(EXTENSION, 'dist', 'SCCAT.86p'));
    const requestModuleFile = readFileSync(path.join(EXTENSION, 'dist', 'SCREQ.86p'));
    const resultQueueModuleFile = readFileSync(path.join(EXTENSION, 'dist', 'SCQUEUE.86p'));
    const syncModuleFile = readFileSync(path.join(EXTENSION, 'dist', 'SCSYNC.86p'));
    const nativeModuleFile = readFileSync(path.join(EXTENSION, 'dist', 'SCNATIVE.86p'));
    const profileModuleFile = readFileSync(path.join(EXTENSION, 'dist', 'SCPROF.86p'));
    const tutorModuleFile = readFileSync(path.join(EXTENSION, 'dist', 'SCTUTOR.86p'));
    const manifest = createTi86ClientReleaseManifest({
      version: '0.1.0',
      shellFile,
      moduleFiles: [
        moduleFile, qrModuleFile, catalogModuleFile, requestModuleFile,
        resultQueueModuleFile, syncModuleFile, nativeModuleFile,
        profileModuleFile, tutorModuleFile,
      ],
    });
    expect(manifest.schema).toBe('school.calc.ti86-client-release/v1');
    expect(manifest.shell.programName).toBe('SCHLCALC');
    expect(manifest.modules).toEqual([
      expect.objectContaining({ programName: 'SCLEARN', capabilities: [] }),
      expect.objectContaining({ programName: 'SCQR', capabilities: [] }),
      expect.objectContaining({ programName: 'SCCAT', capabilities: [] }),
      expect.objectContaining({ programName: 'SCREQ', capabilities: [] }),
      expect.objectContaining({ programName: 'SCQUEUE', capabilities: [] }),
      expect.objectContaining({ programName: 'SCSYNC', capabilities: [] }),
      expect.objectContaining({ programName: 'SCNATIVE', capabilities: [] }),
      expect.objectContaining({ programName: 'SCPROF', capabilities: [] }),
      expect.objectContaining({ programName: 'SCTUTOR', capabilities: [] }),
    ]);
    expect(manifest.resourceUse).toEqual({
      estimateBasis: 'executable-bytes-plus-conservative-variable-overhead',
      estimatedCalculatorStorageBytes:
        manifest.shell.codeByteLength
        + manifest.modules.reduce((total, module) => total + module.codeByteLength, 0)
        + TI86_SCHOOLCALC_LIMITS.standardClientVariableOverheadBytes,
      standardClientTargetBytes: TI86_SCHOOLCALC_LIMITS.standardClientTargetBytes,
      standardClientMaxBytes: TI86_SCHOOLCALC_LIMITS.standardClientMaxBytes,
      withinTarget: false,
      targetDeltaBytes:
        manifest.resourceUse.estimatedCalculatorStorageBytes
        - TI86_SCHOOLCALC_LIMITS.standardClientTargetBytes,
      maxHeadroomBytes:
        TI86_SCHOOLCALC_LIMITS.standardClientMaxBytes
        - manifest.resourceUse.estimatedCalculatorStorageBytes,
    });
    expect(manifest.resourceUse.estimatedCalculatorStorageBytes)
      .toBeLessThanOrEqual(manifest.resourceUse.standardClientMaxBytes);
    const currentContentBytes = TI86_SCHOOLCALC_LIMITS.totalUserBytes
      - manifest.resourceUse.estimatedCalculatorStorageBytes
      - TI86_SCHOOLCALC_LIMITS.catalogStateTargetBytes
      - TI86_SCHOOLCALC_LIMITS.queueTargetBytes
      - TI86_SCHOOLCALC_LIMITS.deliveryRequestTargetBytes
      - TI86_SCHOOLCALC_LIMITS.learnerRosterTargetBytes
      - TI86_SCHOOLCALC_LIMITS.progressProjectionTargetBytes
      - TI86_SCHOOLCALC_LIMITS.continuationCodebookTargetBytes
      - TI86_SCHOOLCALC_LIMITS.interactionRequestTargetBytes
      - TI86_SCHOOLCALC_LIMITS.interactionResponseTargetBytes
      - TI86_SCHOOLCALC_LIMITS.outputReceiptStorageBytes
      - TI86_SCHOOLCALC_LIMITS.freeReserveBytes;
    for (const doc of RELEASE_RESOURCE_DOCS) {
      expect(doc).toContain(manifest.resourceUse.estimatedCalculatorStorageBytes.toLocaleString('en-US'));
      expect(doc).toContain(manifest.resourceUse.targetDeltaBytes.toLocaleString('en-US'));
      expect(doc).toContain(manifest.resourceUse.maxHeadroomBytes.toLocaleString('en-US'));
      expect(doc).toContain(currentContentBytes.toLocaleString('en-US'));
    }
    expect(manifest.shell.sha256).toMatch(/^[a-f0-9]{64}$/);
    for (const module of manifest.modules) {
      expect(module.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const onDisk = JSON.parse(readFileSync(path.join(EXTENSION, 'dist', 'schoolcalc-client-release.json'), 'utf8'));
    expect(onDisk).toEqual(manifest);
    const group = readFileSync(path.join(EXTENSION, 'dist', 'SCHOOLCALC.86g'));
    expect(verifyTi86ProgramGroup(group).programs.map(({ name }) => name))
      .toEqual(['SCHLCALC', 'SCLEARN', 'SCQR', 'SCCAT', 'SCREQ', 'SCQUEUE', 'SCSYNC', 'SCNATIVE', 'SCPROF']);
    const tutorGroup = readFileSync(path.join(EXTENSION, 'dist', 'SCTUTOR.86g'));
    expect(verifyTi86ProgramGroup(tutorGroup).programs.map(({ name }) => name))
      .toEqual(['SCTUTOR']);

    const installed = Object.fromEntries(manifest.modules.map(({ programName }) => [
      programName, readFileSync(path.join(EXTENSION, 'dist', `${programName}.86p`)),
    ]));
    expect(inspectTi86RuntimeInstallation(installed)).toMatchObject({
      runtimeModuleMask: TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK,
      complete: true,
    });
    delete installed.SCQR;
    expect(inspectTi86RuntimeInstallation(installed)).toMatchObject({
      runtimeModuleMask: TI86_SCHOOLCALC_RUNTIME_MODULE_FULL_MASK & ~2,
      complete: false,
      modules: expect.arrayContaining([
        expect.objectContaining({ programName: 'SCQR', valid: false }),
      ]),
    });
  });

  it('ships SCPROF as the bounded, fail-closed learner-profile runtime', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-profile-runtime.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const profileFile = readFileSync(path.join(EXTENSION, 'dist', 'SCPROF.86p'));
    const profileRuntime = inspectTi86RuntimeProgram(profileFile, TI86_RUNTIME_MODULES.learnerProfile);
    expect(profileRuntime)
      .toEqual(expect.objectContaining({
        id: 'learner-profile', moduleCode: 8, programName: 'SCPROF', capabilities: [],
      }));
    // SCPROF uses its own adapter-level child-image ceiling, which remains
    // below the TI-86's 9,400-byte execution window. Keep the test tied to
    // that released contract rather than a stale round 8 KiB bucket.
    expect(profileRuntime.codeByteLength)
      .toBeLessThanOrEqual(TI86_SCHOOLCALC_LIMITS.profileRuntimeMaxBytes);
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /profile_runtime_start:[\s\S]{0,220}call profile_scx_validate_self\s+jp c,profile_render_error[\s\S]*?call scstate_load/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toContain('PROFILE_MAX_RECORD_BYTES:  equ 512');
    expect(PROFILE_RUNTIME_SOURCE).toContain('PROFILE_MAX_RECORDS:       equ 16');
    expect(PROFILE_RUNTIME_SOURCE).toContain('profile_stage_name:        defb 0x0C,8,"DSUSRNEW"');
    expect(PROFILE_RUNTIME_SOURCE).toContain('profile_canonical_name:    defb 0x0C,7,"DSUSERS",0');
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /profile_promote_stage:[\s\S]*?call profile_validate_open[\s\S]*?call profile_copy_stage/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /profile_copy_stage:[\s\S]*?call profile_open_canonical[\s\S]*?jr c,profile_copy_delete_target[\s\S]*?ld hl,profile_stage_name[\s\S]*?call profile_delete_if_present/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /profile_commit_selection:[\s\S]*?and SCSTATE_FLAG_SESSION[\s\S]*?jp nz,profile_render_locked[\s\S]*?call scstate_save/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /profile_commit_selection:[\s\S]*?and PROFILE_SWITCH_BLOCK_HIGH[\s\S]*?call profile_reset_navigation[\s\S]*?call scstate_save/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toMatch(
      /profile_reset_navigation:[\s\S]*?PROFILE_VIEW_CATALOG[\s\S]*?SCSTATE_ARTIFACT_KEY_OFFSET[\s\S]*?profile_reset_navigation_loop/,
    );
    expect(PROFILE_RUNTIME_SOURCE).toContain('profile_title:             defb "Who is studying?",0');
    expect(PROFILE_RUNTIME_SOURCE).toContain('profile_guest:             defb "Guest",0');
    expect(PROFILE_RUNTIME_SOURCE).not.toMatch(/geography|mathematics|science|jellyfin|plex/i);
  });

  it('keeps foreground cable ownership fail-closed behind the reviewed SCSYNC module', () => {
    const syncFile = readFileSync(path.join(EXTENSION, 'dist', 'SCSYNC.86p'));
    expect(inspectTi86RuntimeProgram(syncFile, TI86_RUNTIME_MODULES.foregroundSync))
      .toEqual(expect.objectContaining({
        id: 'foreground-sync', moduleCode: 6, programName: 'SCSYNC', capabilities: [],
      }));
    expect(SYNC_RUNTIME_SOURCE).toMatch(
      /sync_runtime_start:[\s\S]{0,220}call _runindicoff[\s\S]*?di\s+call link_release_lines/,
    );
    expect(SYNC_RUNTIME_SOURCE).toContain('out (LINK_PORT),a');
    expect(SYNC_RUNTIME_SOURCE).toMatch(
      /sync_release_transport:[\s\S]*?call link_release_lines[\s\S]*?out \(KEY_PORT\),a[\s\S]*?ei/,
    );
  });

  it('ships SCNATIVE as a read-only semantic guard with native launch still locked', () => {
    execFileSync(process.execPath, [path.join(EXTENSION, 'tools', 'build-native-runtime.mjs')], {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const nativeFile = readFileSync(path.join(EXTENSION, 'dist', 'SCNATIVE.86p'));
    expect(inspectTi86RuntimeProgram(nativeFile, TI86_RUNTIME_MODULES.nativeHandoff))
      .toEqual(expect.objectContaining({
        id: 'native-handoff', moduleCode: 7, programName: 'SCNATIVE', capabilities: [],
      }));
    expect(NATIVE_RUNTIME_SOURCE).toMatch(
      /native_runtime_start:[\s\S]{0,220}call _runindicoff[\s\S]*?call runtime_open_selected_module[\s\S]*?call native_validate_plan/,
    );
    expect(NATIVE_RUNTIME_SOURCE).toContain('NATIVE_MAX_PAYLOAD_BYTES:         equ 1152');
    expect(NATIVE_RUNTIME_SOURCE).toContain('NATIVE_MAX_EXPRESSION_BYTES:      equ 192');
    expect(NATIVE_RUNTIME_SOURCE).toContain('NATIVE_MAX_EXPRESSION_DEPTH:      equ 16');
    expect(NATIVE_RUNTIME_SOURCE).toContain('NATIVE_REAL_EXP_MIN_LOW:          equ 0xCC');
    expect(NATIVE_RUNTIME_SOURCE).toContain('NATIVE_REAL_EXP_MAX_LOW:          equ 0x33');
    expect(NATIVE_RUNTIME_SOURCE).toContain('RUNTIME_CONTENT_MUTABLE: equ 0');
    expect(RUNTIME_SOURCE).toContain('RUNTIME_CONTENT_MUTABLE: equ 1');
    expect(CONTENT_RUNTIME_SOURCE).toMatch(
      /if RUNTIME_CONTENT_MUTABLE[\s\S]*?call nc,_delvar[\s\S]*?call _createstrng[\s\S]*?endif/,
    );
    expect(NATIVE_RUNTIME_SOURCE).not.toMatch(/call\s+(?:_createstrng|_delvar|_exec_assembly)/);
    const nativeCode = verifyTi86Program(nativeFile).code;
    const forbiddenTargets = [0x472F, 0x475F, 0x5730, 0x4D6F];
    const transferOpcodes = [
      0xC2, 0xCA, 0xD2, 0xDA, 0xE2, 0xEA, 0xF2, 0xFA, 0xC3,
      0xC4, 0xCC, 0xD4, 0xDC, 0xE4, 0xEC, 0xF4, 0xFC, 0xCD,
    ];
    for (const target of forbiddenTargets) {
      for (const opcode of transferOpcodes) {
        expect(nativeCode.indexOf(Buffer.from([opcode, target & 0xFF, target >>> 8])))
          .toBe(-1);
      }
    }
    expect(NATIVE_RUNTIME_SOURCE).toContain('Operation 7 (native BASIC program) is intentionally absent');
    expect(NATIVE_RUNTIME_SOURCE).toContain('native_valid_line_2:    defb "Settings unchanged.",0');
    expect(NATIVE_RUNTIME_SOURCE).toContain('native_valid_line_3:    defb "OS launch is locked.",0');
  });

  it('rejects altered ABI, kind, length, payload, and executable window claims', () => {
    const file = readFileSync(path.join(EXTENSION, 'dist', 'SCLEARN.86p'));
    const original = verifyTi86Program(file);
    const variants = [1, 8, 12, 13, 15, 17, TI86_RUNTIME_EXECUTOR_HEADER_BYTES + 1];
    for (const codeOffset of variants) {
      const corruptCode = Buffer.from(original.code);
      corruptCode[codeOffset] ^= 1;
      const validContainer = createTi86AsmProgram({ name: 'SCLEARN', code: corruptCode });
      expect(() => inspectTi86RuntimeProgram(validContainer)).toThrow();
    }
    expect(TI86_RUNTIME_MAGIC).toBe('SCX1');
  });
});
