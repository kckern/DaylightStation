import { describe, it, expect, vi } from 'vitest';
import { KnowledgeBackfill } from './KnowledgeBackfill.mjs';
import { memoryStore, AS_OF, TZ, evidence, proposal } from './fixtures.testHelpers.mjs';
import { importDigest } from '../../domain/knowledge/importManifest.mjs';
function fixture(count = 1, contentLength) {
  const messages = Array.from({
    length: count
  }, (_, i) => evidence({
    sourceId: 'import-' + i,
    ref: 'journalist:msg:import-' + i,
    originalRef: 'journalist:msg:original-' + i,
    originalSourceId: 'original-' + i,
    sourceHash: importDigest(i),
    at: AS_OF - 86400000 + i,
    verified: false,
    previewOnly: true,
    origin: 'historical_import',
    ...(contentLength ? {
      content: 'x'.repeat(contentLength)
    } : {})
  }));
  const store = memoryStore(),
    cache = new Map(),
    records = new Map();
  const checkpoint = {
    read: async () => ({
      chunks: Object.fromEntries(records)
    }),
    append: async row => {
      records.set(row.chunkId, row);
      return {
        applied: true
      };
    },
    readChunk: async ({
      chunkId
    }) => cache.get(chunkId) ?? null,
    writeChunk: async row => {
      const value = {
        ...row,
        resultDigest: importDigest(row.result)
      };
      cache.set(row.chunkId, value);
      return value;
    }
  };
  const historical = {
    read: vi.fn(async () => ({
      messages: structuredClone(messages),
      rejected: [],
      sourceHashes: Object.fromEntries(messages.map(m => [m.originalRef, m.sourceHash])),
      complete: true,
      nextCursor: null
    }))
  };
  const extractor = {
    extract: vi.fn(async ({
      messages: rows
    }) => ({
      proposals: rows.map((m, i) => proposal({
        id: 'proposal-' + m.sourceId,
        target: 'loop.item-' + m.sourceId,
        evidenceRef: m.ref,
        quote: m.content,
        fields: {
          title: 'A commitment'
        }
      })),
      modelVersion: 'fixture'
    }))
  };
  const capability = Object.freeze({}),
    authority = {
      verify: vi.fn(input => input.capability === capability)
    };
  const reserveAttempt = vi.fn();
  const service = new KnowledgeBackfill({
    store,
    historical,
    checkpoint,
    extractor,
    authority,
    reserveAttempt,
    clock: () => AS_OF,
    userTimezone: () => TZ
  });
  const prepare = () => service.prepare({
    username: 'sample',
    from: AS_OF - 90 * 86400000,
    asOf: AS_OF,
    jobId: 'job-1'
  });
  return {
    service,
    prepare,
    store,
    messages,
    cache,
    records,
    historical,
    extractor,
    authority,
    capability,
    reserveAttempt
  };
}
describe('bounded quiet knowledge backfill', () => {
  it('keeps prepare/resume read-only and reuses cached results on retry', async () => {
    const h = fixture(),
      {
        manifest
      } = await h.prepare();
    const first = await h.service.resume({
      manifest,
      usageDir: 'private'
    });
    const second = await h.service.resume({
      manifest,
      usageDir: 'private'
    });
    expect(first.artifact).toEqual(second.artifact);
    expect(first.report.complete).toBe(true);
    expect(h.extractor.extract).toHaveBeenCalledTimes(1);
    expect(h.reserveAttempt).toHaveBeenCalledTimes(1);
    expect(h.store.commit).not.toHaveBeenCalled();
  });
  it('denies copied authority and changed source, manifest or artifact before any write', async () => {
    const h = fixture(),
      {
        manifest
      } = await h.prepare(),
      {
        artifact
      } = await h.service.resume({
        manifest,
        usageDir: 'private'
      });
    await expect(h.service.commit({
      manifest,
      artifact,
      capability: {}
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_DENIED'
    });
    h.messages[0].sourceHash = importDigest('edited');
    await expect(h.service.commit({
      manifest,
      artifact,
      capability: h.capability
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_SOURCE_CHANGED'
    });
    expect(h.store.commit).not.toHaveBeenCalled();
  });
  it('imports once, preserves historical dates, leaves live cursor/asks alone and skips overlapping evidence', async () => {
    const h = fixture(),
      before = await h.store.read({
        username: 'sample'
      }),
      {
        manifest
      } = await h.prepare(),
      {
        artifact
      } = await h.service.resume({
        manifest,
        usageDir: 'private'
      });
    expect((await h.service.commit({
      manifest,
      artifact,
      capability: h.capability
    })).applied).toBe(true);
    expect((await h.service.commit({
      manifest,
      artifact,
      capability: h.capability
    })).applied).toBe(false);
    const after = await h.store.read({
      username: 'sample'
    });
    expect(Object.values(after.objects)).toHaveLength(1);
    expect(Object.values(after.objects)[0]).toMatchObject({
      ask_policy: 'user_initiated',
      pinned: ['ask_policy'],
      created: {
        at: h.messages[0].at
      },
      touched: h.messages[0].localDate
    });
    expect(after.state.cursor).toEqual(before.state.cursor);
    expect(after.asks).toEqual(before.asks);
    const next = await h.service.prepare({
      ...manifest,
      jobId: 'job-2'
    });
    expect(next.chunks).toEqual([]);
  });
  it('chunks by both ten messages and twenty thousand characters', async () => {
    const h = fixture(23),
      first = await h.prepare();
    expect(first.chunks.map(c => c.refs.length)).toEqual([10, 10, 3]);
    const dense = fixture(5, 12000),
      second = await dense.prepare();
    expect(second.chunks.map(c => c.refs.length)).toEqual([1, 1, 1, 1, 1]);
  });
  it('uses chronological chunk context so a later completion closes an earlier historical commitment', async () => {
    const h = fixture(11);
    h.extractor.extract.mockImplementation(async ({
      messages,
      openLoops
    }) => {
      const first = messages.find(m => m.sourceId === 'import-0');
      if (first) return {
        proposals: [proposal({
          id: 'open-first',
          evidenceRef: first.ref,
          fields: {
            title: 'Finish the story'
          }
        })],
        modelVersion: 'fixture'
      };
      expect(openLoops.some(o => o.id === 'loop.application-reply')).toBe(true);
      return {
        proposals: [proposal({
          id: 'close-later',
          evidenceRef: messages[0].ref,
          op: 'close_loop',
          fields: {
            status: 'answered'
          }
        })],
        modelVersion: 'fixture'
      };
    });
    const {
        manifest
      } = await h.prepare(),
      {
        artifact
      } = await h.service.resume({
        manifest,
        usageDir: 'private'
      });
    const result = await h.service.commit({
      manifest,
      artifact,
      capability: h.capability
    });
    expect(result.report.rejected).toEqual([]);
    const object = (await h.store.read({
      username: 'sample'
    })).objects['loop.application-reply'];
    expect(object).toMatchObject({
      status: 'answered',
      ask_policy: 'user_initiated',
      loop: {
        answer: {
          at: h.messages[10].at
        }
      }
    });
  });
  it('orders model proposals by their cited source dates before previewing a chunk', async () => {
    const h = fixture(2);
    h.extractor.extract.mockImplementation(async ({
      messages
    }) => ({
      proposals: [proposal({
        id: 'close-later',
        evidenceRef: messages[1].ref,
        op: 'close_loop',
        fields: {
          status: 'answered'
        }
      }), proposal({
        id: 'open-first',
        evidenceRef: messages[0].ref
      })],
      modelVersion: 'fixture'
    }));
    const {
      manifest
    } = await h.prepare();
    const result = await h.service.resume({
      manifest,
      usageDir: 'private'
    });
    expect(result.report.rejected).toEqual([]);
  });
  it('charges failures, stops at a persistent budget refusal and reports resumable partial coverage', async () => {
    const h = fixture(11),
      {
        manifest
      } = await h.prepare();
    h.extractor.extract.mockRejectedValueOnce(new Error('model unavailable'));
    const failed = await h.service.resume({
      manifest,
      usageDir: 'private'
    });
    expect(failed.report).toMatchObject({
      complete: false,
      reason: 'extraction_failed'
    });
    expect(h.reserveAttempt).toHaveBeenCalledTimes(1);
    h.reserveAttempt.mockImplementation(() => {
      throw new Error('daily budget exhausted');
    });
    const blocked = await h.service.resume({
      manifest,
      usageDir: 'private'
    });
    expect(blocked.report).toMatchObject({
      complete: false,
      reason: 'budget_exhausted'
    });
    expect(h.extractor.extract).toHaveBeenCalledTimes(1);
    await expect(h.service.commit({
      manifest,
      artifact: blocked.artifact,
      capability: h.capability
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_INCOMPLETE'
    });
  });
  it('treats the proposal cap as incomplete and splits a multi-message chunk', async () => {
    const h = fixture(2),
      {
        manifest
      } = await h.prepare();
    const normal = h.extractor.extract.getMockImplementation();
    h.extractor.extract.mockImplementation(async input => input.messages.length === 2 ? {
      proposals: Array.from({
        length: 20
      }, (_, i) => proposal({
        id: 'cap-' + i
      })),
      modelVersion: 'fixture'
    } : normal(input));
    const result = await h.service.resume({
      manifest,
      usageDir: 'private'
    });
    expect(result.report.complete).toBe(true);
    expect(h.extractor.extract).toHaveBeenCalledTimes(3);
    expect(result.artifact.entries).toHaveLength(2);
  });
  it('re-reduces against the latest pinned state and stops late writes after disposal', async () => {
    const h = fixture(),
      {
        manifest
      } = await h.prepare(),
      {
        artifact
      } = await h.service.resume({
        manifest,
        usageDir: 'private'
      });
    h.service.close();
    await expect(h.service.commit({
      manifest,
      artifact,
      capability: h.capability
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_STOPPED'
    });
    expect(h.store.commit).not.toHaveBeenCalled();
  });
});
