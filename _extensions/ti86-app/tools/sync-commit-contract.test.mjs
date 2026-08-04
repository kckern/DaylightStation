import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  Ti86SchoolCalcCodec,
  decodeTi86SyncManifest,
  ti86GenerationKey,
} from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcCodec.mjs';
import { TI86_SCHOOLCALC_LIMITS } from '../../../backend/src/1_adapters/schoolcalc/ti86/Ti86SchoolCalcLimits.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const EXTENSION = path.resolve(HERE, '..');
const ASM = readFileSync(path.join(EXTENSION, 'src', 'sync-commit.asm'), 'utf8');
const SHELL = readFileSync(path.join(EXTENSION, 'src', 'schoolcalc.asm'), 'utf8');

describe('TI-86 Z80 staged-sync contract', () => {
  it('keeps fixed SCM1 offsets byte-identical between the adapter and assembly', () => {
    const codec = new Ti86SchoolCalcCodec();
    const artifact = {
      artifactId: 'sc:ti86:ABC234DEFG',
      variableName: 'DPABC234',
      byteLength: 0x1234,
      byteDigest: 'ab'.repeat(32),
    };
    const generation = `sha256:${'d'.repeat(64)}`;
    const catalogGeneration = `sha256:${'c'.repeat(64)}`;
    const record = codec.encodeSyncManifest({
      schema: 'school.calc.sync-plan/v1',
      deviceId: '86A001',
      platformId: 'ti86',
      generation,
      catalog: { generation: catalogGeneration, changed: true },
      ready: true,
      blockers: [],
      artifacts: [artifact],
      installedArtifacts: [artifact],
      removals: [],
      acknowledgements: { sequences: [] },
    });

    expect(record.toString('ascii', 0, 4)).toBe('SCM1');
    expect(readEquate('SCM_MAX_RECORD_BYTES')).toBe(TI86_SCHOOLCALC_LIMITS.syncManifestMaxBytes);
    expect(record[readEquate('SCM_DEVICE_LENGTH_OFFSET')]).toBe(6);
    expect(record.toString('ascii', readEquate('SCM_DEVICE_OFFSET'), 14)).toBe('86A001');
    expect(record.toString('ascii', readEquate('SCM_GENERATION_KEY_OFFSET'), 34))
      .toBe(ti86GenerationKey(generation));
    expect(record.toString('ascii', readEquate('SCM_CATALOG_KEY_OFFSET'), 44))
      .toBe(ti86GenerationKey(catalogGeneration));
    expect(record[readEquate('SCM_FLAGS_OFFSET')]).toBe(3);
    expect(record[readEquate('SCM_INSTALLED_COUNT_OFFSET')]).toBe(1);

    const descriptor = readEquate('SCM_INSTALLED_FIRST_OFFSET');
    expect(record.toString('ascii', descriptor, descriptor + 10)).toBe('ABC234DEFG');
    expect(record.toString('ascii', descriptor + 10, descriptor + 18)).toBe('DPABC234');
    expect(record.readUInt16LE(descriptor + 18)).toBe(0x1234);
    expect(record.subarray(descriptor + 20, descriptor + 52).toString('hex')).toBe('ab'.repeat(32));
    expect(decodeTi86SyncManifest(record)).toMatchObject({
      deviceId: '86A001', ready: true, catalogChanged: true,
      generationKey: ti86GenerationKey(generation),
      catalogGenerationKey: ti86GenerationKey(catalogGeneration),
      installedArtifacts: [artifact],
    });
  });

  it('runs staged recovery before publishing DSINFO and links the commit module', () => {
    expect(SHELL).toContain('include "sync-commit.asm"');
    expect(SHELL.indexOf('call sync_commit_staged')).toBeGreaterThan(0);
    expect(SHELL.indexOf('call sync_commit_staged')).toBeLessThan(SHELL.indexOf('call publish_device_info'));
    expect(ASM).toContain('call sync_validate_manifest');
    expect(ASM).toContain('call sync_commit_local_state');
    expect(ASM).toContain('ld hl,dssync_name\n        call sync_delete_if_present');
    expect(ASM).toContain('call sync_validate_queue_ack');
    expect(ASM).toContain('call sync_commit_queue');
    expect(ASM).toContain('atomic whole-batch queue acknowledgement');
    expect(ASM).toContain('A blocker manifest is status only');
    expect(ASM).toContain('No DSSYNC is the ordinary steady state');
    expect(ASM).toMatch(/call sync_validate_manifest[\s\S]*cp SC_RECORD_ERROR_NOT_FOUND[\s\S]*ret z/);
  });
});

function readEquate(name) {
  const match = ASM.match(new RegExp(`^${name}:\\s+equ ([0-9]+)$`, 'm'));
  if (!match) throw new Error(`missing decimal assembly equate ${name}`);
  return Number.parseInt(match[1], 10);
}
