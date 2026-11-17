// @vitest-environment node
import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { BuildMetadataSource } from '#adapters/runtime/BuildMetadataSource.mjs';
import { createLogger } from '#system/logging/logger.mjs';
import { initializeLogging, resetLogging } from '#system/logging/dispatcher.mjs';
import { createSchoolLifecycleLogger } from '../lifecycle-runtime.mjs';
import { YamlTokenRegistry } from '../adapters/persistence/YamlTokenRegistry.mjs';
import { HmacSchoolMountReceiptIssuer } from '../adapters/actions/HmacSchoolMountReceiptIssuer.mjs';
import { RunSelfServiceAction } from '../application/usecases/RunSelfServiceAction.mjs';
import { AcknowledgeSelfServiceMount } from '../application/usecases/AcknowledgeSelfServiceMount.mjs';

it('prepared and confirmed mount events carry declared build identity and payload protocol without raw metadata or receipts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'school-mount-diagnostics-'));
  const events = [];
  const dispatcher = initializeLogging(); dispatcher.addTransport({ name: 'memory', send: event => events.push(event) });
  try {
    const content = `Build Time: test artifact\nCommit: https://github.com/example/repo/commit/${'a'.repeat(40)}\n`;
    const file = path.join(root, 'build.txt'); await writeFile(file, content);
    const logger = createSchoolLifecycleLogger({ rootLogger: createLogger(), buildMetadataSource: new BuildMetadataSource({ bakedFile: file }) });
    const tokens = new YamlTokenRegistry({ configService: { getHouseholdPath: () => path.join(root, 'tokens') } });
    const record = { token: 'sch:METADATATEST', tokenClass: 'subject_next', subject: { learnerId: 'kid1' }, accessCode: '123456', accessCodeExpiresAt: new Date(Date.now()+3600000).toISOString(), maxUses: 1 };
    await tokens.put(record);
    const issuer = new HmacSchoolMountReceiptIssuer({ key: 'k'.repeat(32), householdId: 'home' });
    const runner = new RunSelfServiceAction({ tokens, sessions: {}, mountAcknowledgements: true, mountReceiptIssuer: issuer, logger,
      resolveAccessCode: { resolve: async () => ({ record, card: { ok: true, learner: 'kid1', actions: [{ kind: 'program', target: 'local' }] }, resolution: {} }) },
      launchers: new Map([['local', { surface: 'portal', launch() {}, issueLaunchTarget: () => ({ kind: 'program', program: 'local' }) }]]) });
    const prepared = await runner.execute({ code: '123456', action: 'program', mountProtocol: 1, deviceId: 'kiosk1' });
    expect(prepared.outcome).toBe('mount');
    const ack = new AcknowledgeSelfServiceMount({ tokens, mountReceiptIssuer: issuer, logger });
    expect((await ack.execute({ receipt: prepared.mountReceipt, mounted: true, deviceId: 'kiosk1' })).committed).toBe(true);
    const mounts = events.filter(event => /program\.mount-(prepared|confirmed)$/.test(event.event));
    expect(mounts).toHaveLength(2);
    for (const event of mounts) {
      expect(event.context).toMatchObject({ module: 'school-lifecycle', buildIdentity: { source: 'baked-build-metadata', verification: 'declared-unverified', commit: 'a'.repeat(40), metadataSha256: createHash('sha256').update(content).digest('hex') } });
      expect(event.data.mountProtocol).toBe(1);
      expect(JSON.stringify(event)).not.toContain(prepared.mountReceipt);
      expect(JSON.stringify(event)).not.toContain(record.token);
      expect(JSON.stringify(event)).not.toContain(content);
      expect(JSON.stringify(event)).not.toContain(file);
    }
  } finally { resetLogging(); await rm(root, { recursive: true, force: true }); }
});
