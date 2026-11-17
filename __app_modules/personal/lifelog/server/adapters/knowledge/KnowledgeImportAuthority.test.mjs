import { describe, it, expect } from 'vitest';
import os from 'node:os';
import { KnowledgeImportAuthority } from './KnowledgeImportAuthority.mjs';
const now = Date.now();
const configuration = () => ({
  enabled: true,
  write: true,
  importWrites: true,
  writer_env: process.env.DAYLIGHT_ENV || 'docker',
  writer_host: os.hostname(),
  operator_uid: process.getuid()
});
const manifest = {
  schema: 'knowledge-import/v1',
  jobId: 'job-1',
  username: 'sample',
  from: now - 90 * 86400000,
  asOf: now,
  sourceHashes: {
    original: 'a'.repeat(64)
  }
};
const input = {
  manifest,
  artifactDigest: 'b'.repeat(64),
  sourceHashes: manifest.sourceHashes,
  asOf: now
};
describe('host-bound import capability', () => {
  it('rechecks current policy both on capability use and after awaiting the writer lease', async () => {
    let allowed = true,
      release;
    const pending = new Promise(resolve => {
      release = resolve;
    });
    let attempts = 0;
    const authority = new KnowledgeImportAuthority({
      configuration: configuration(),
      clock: () => now,
      verifyPolicy: () => allowed
    });
    const operatorReceipt = authority.captureOperatorReceipt({
        manifest
      }),
      capability = authority.authorize({
        ...input,
        operatorReceipt
      });
    allowed = false;
    expect(authority.verify({
      ...input,
      capability
    })).toBe(false);
    allowed = true;
    const writer = authority.bindWriter({
      assertWriter: async () => {
        attempts++;
        await pending;
      },
      close: async () => {}
    });
    const waiting = writer.assertWriter({
      root: '/fixture'
    });
    allowed = false;
    release();
    await expect(waiting).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_DENIED'
    });
    await expect(writer.assertWriter({
      root: '/fixture'
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_DENIED'
    });
    expect(attempts).toBe(1);
  });
  it('binds a nonserializable operator receipt and capability to the exact job and artifact', () => {
    const authority = new KnowledgeImportAuthority({
      configuration: configuration(),
      clock: () => now
    });
    const operatorReceipt = authority.captureOperatorReceipt({
      manifest
    });
    const capability = authority.authorize({
      ...input,
      operatorReceipt
    });
    expect(capability).toBeTruthy();
    expect(authority.verify({
      ...input,
      capability
    })).toBe(true);
    expect(authority.verify({
      ...input,
      capability: structuredClone(capability)
    })).toBe(false);
    expect(authority.authorize({
      ...input,
      operatorReceipt: structuredClone(operatorReceipt)
    })).toBeNull();
    expect(authority.verify({
      ...input,
      artifactDigest: 'c'.repeat(64),
      capability
    })).toBe(false);
    expect(authority.verify({
      ...input,
      manifest: {
        ...manifest,
        username: 'other'
      },
      capability
    })).toBe(false);
  });
  it('refuses wrong host, environment, uid, disabled import or overlong range', () => {
    for (const patch of [{
      writer_host: 'other'
    }, {
      writer_env: 'other'
    }, {
      operator_uid: process.getuid() + 1
    }, {
      importWrites: false
    }, {
      write: false
    }]) {
      const authority = new KnowledgeImportAuthority({
        configuration: {
          ...configuration(),
          ...patch
        },
        clock: () => now
      });
      expect(authority.captureOperatorReceipt({
        manifest
      })).toBeNull();
      expect(authority.authorize({
        ...input,
        operatorReceipt: {
          approved: true
        }
      })).toBeNull();
    }
    const authority = new KnowledgeImportAuthority({
      configuration: configuration(),
      clock: () => now
    });
    expect(authority.captureOperatorReceipt({
      manifest: {
        ...manifest,
        from: manifest.from - 1
      }
    })).toBeNull();
  });
  it('rejects changed source hashes, expired or closed authority without trusting caller time', () => {
    let clock = now;
    const authority = new KnowledgeImportAuthority({
      configuration: configuration(),
      clock: () => clock
    });
    const operatorReceipt = authority.captureOperatorReceipt({
      manifest
    });
    expect(authority.authorize({
      ...input,
      sourceHashes: {},
      operatorReceipt
    })).toBeNull();
    const capability = authority.authorize({
      ...input,
      operatorReceipt
    });
    clock += 15 * 60000 + 1;
    expect(authority.verify({
      ...input,
      capability
    })).toBe(false);
    authority.close();
    expect(authority.captureOperatorReceipt({
      manifest
    })).toBeNull();
  });
});
