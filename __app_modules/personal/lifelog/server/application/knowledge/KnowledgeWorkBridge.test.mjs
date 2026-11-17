import { it, expect, vi } from 'vitest';
import { KnowledgeWorkBridge } from './KnowledgeWorkBridge.mjs';
it('delegates preview and apply through the Lifelog owner without exposing a writable store', async () => {
  const manifest = {
      jobId: 'job-1'
    },
    backfill = {
      prepare: vi.fn(async () => ({
        manifest
      })),
      resume: vi.fn(async () => ({
        artifact: {
          complete: true
        }
      })),
      commit: vi.fn(async () => ({
        applied: true
      }))
    };
  const bridge = new KnowledgeWorkBridge({
    backfill
  });
  expect(await bridge.previewImport({
    username: 'sample',
    usageDir: 'private'
  })).toMatchObject({
    manifest,
    artifact: {
      complete: true
    }
  });
  expect(backfill.resume).toHaveBeenCalledWith({
    manifest,
    usageDir: 'private'
  });
  expect(backfill.commit).not.toHaveBeenCalled();
  const apply = {
    manifest,
    artifact: {},
    capability: {}
  };
  expect(await bridge.commitImport(apply)).toEqual({
    applied: true
  });
  expect(backfill.commit).toHaveBeenCalledWith(apply);
  expect(bridge.store).toBeUndefined();
});
