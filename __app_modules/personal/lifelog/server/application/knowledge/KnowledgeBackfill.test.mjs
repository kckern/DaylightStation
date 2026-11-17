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
  const workContext = {
    execute: vi.fn(async () => ({
      coverage: {
        complete: false,
        reason: 'stale_snapshot',
        sources: []
      },
      items: [],
      links: [],
      events: []
    }))
  };
  const service = new KnowledgeBackfill({
    knowledgeStore: store,
    journalEvidence: historical,
    checkpoints: checkpoint,
    extractor,
    verifyImport: authority.verify,
    usageBudget: reserveAttempt,
    clock: () => AS_OF,
    userTimezone: () => TZ,
    workContext
  });
  const prepare = () => service.prepare({
    username: 'sample',
    from: AS_OF - 90 * 86400000,
    asOf: AS_OF,
    jobId: 'job-1'
  });
  return {
    service,
    workContext,
    checkpoint,
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
  const workFacts = () => {
    const ref = {
      provider: 'todoist',
      accountId: 'personal',
      kind: 'task',
      id: 'task-1'
    };
    return {
      coverage: {
        complete: true,
        sources: [{
          provider: 'todoist',
          accountId: 'personal',
          complete: true
        }]
      },
      items: [],
      links: [{
        id: 'link-1',
        username: 'sample',
        kbObjectId: 'loop.item-import-0',
        workRef: ref,
        relation: 'same_commitment',
        confirmedAt: AS_OF - 86400000,
        basisRefs: []
      }],
      events: [{
        id: 'completed-1',
        username: 'sample',
        ref,
        type: 'completed',
        origin: 'provider',
        occurredAt: AS_OF - 3600000,
        occurredAtEstimated: false
      }]
    };
  };
  it('reports a scoped later completion as corroboration rather than another unresolved intention', async () => {
    const h = fixture();
    h.workContext.execute.mockResolvedValue(workFacts());
    const {
        manifest
      } = await h.prepare(),
      result = await h.service.resume({
        manifest,
        usageDir: 'private'
      });
    expect(result.report.corroboratedOutcomes).toEqual([expect.objectContaining({
      objectId: 'loop.item-import-0',
      eventId: 'completed-1',
      kbStatus: 'open'
    })]);
    expect(result.report.unresolvedCandidates).toEqual([]);
    expect(h.store.commit).not.toHaveBeenCalled();
    expect(h.extractor.extract.mock.calls[0][0].messages.every(m => m.origin === 'historical_import')).toBe(true);
  });
  it.each(['action_for', 'context_for'])('keeps the parent unresolved when completed work is only %s', async relation => {
    const h = fixture(),
      facts = workFacts();
    facts.links[0].relation = relation;
    h.workContext.execute.mockResolvedValue(facts);
    const {
        manifest
      } = await h.prepare(),
      result = await h.service.resume({
        manifest,
        usageDir: 'private'
      });
    expect(result.report.corroboratedOutcomes).toEqual([]);
    expect(result.report.unresolvedCandidates).toHaveLength(1);
    expect(result.report.relatedWork).toHaveLength(1);
  });
  it.each(['stale', 'estimated', 'wrong_user', 'predates', 'multiple_links', 'reopened'])('never treats %s work evidence as a confirmed historical outcome', async mode => {
    const h = fixture(),
      facts = workFacts();
    if (mode === 'stale') facts.coverage.sources[0].complete = false;
    if (mode === 'estimated') facts.events[0].occurredAtEstimated = true;
    if (mode === 'wrong_user') facts.events[0].username = 'other';
    if (mode === 'predates') facts.events[0].occurredAt = AS_OF - 2 * 86400000;
    if (mode === 'multiple_links') facts.links.push({
      ...facts.links[0],
      id: 'link-2',
      workRef: {
        ...facts.links[0].workRef,
        id: 'task-2'
      }
    });
    if (mode === 'reopened') facts.events.push({
      ...facts.events[0],
      id: 'reopened-1',
      type: 'reopened',
      occurredAt: AS_OF - 1000
    });
    h.workContext.execute.mockResolvedValue(facts);
    const {
        manifest
      } = await h.prepare(),
      result = await h.service.resume({
        manifest,
        usageDir: 'private'
      });
    expect(result.report.corroboratedOutcomes).toEqual([]);
    expect(result.report.unresolvedCandidates).toHaveLength(1);
    if (['estimated', 'multiple_links', 'reopened'].includes(mode)) expect(result.report.ambiguousMatches).toHaveLength(1);
  });
  it('rejects a completed checkpoint whose result was lost before reserving another paid attempt', async () => {
    const h = fixture(),
      {
        manifest
      } = await h.prepare();
    await h.service.resume({
      manifest,
      usageDir: 'private'
    });
    h.cache.clear();
    h.reserveAttempt.mockClear();
    h.extractor.extract.mockClear();
    await expect(h.service.resume({
      manifest,
      usageDir: 'private'
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_ARTIFACT_INCONSISTENT'
    });
    expect(h.reserveAttempt).not.toHaveBeenCalled();
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });
  it('validates torn checkpoint history before the first model call', async () => {
    const h = fixture(),
      {
        manifest
      } = await h.prepare();
    h.checkpoint.read = async () => {
      throw new Error('Corrupt checkpoint tail');
    };
    await expect(h.service.resume({
      manifest,
      usageDir: 'private'
    })).rejects.toThrow('Corrupt checkpoint tail');
    expect(h.reserveAttempt).not.toHaveBeenCalled();
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });
  it('validates later completed chunks before calling the model for an earlier missing chunk', async () => {
    const h = fixture(11),
      {
        manifest
      } = await h.prepare(),
      chunk = manifest.chunks[1];
    h.records.set(chunk.chunkId, {
      jobId: manifest.jobId,
      ...chunk,
      status: 'complete',
      resultDigest: importDigest({
        proposals: [],
        modelVersion: 'fixture'
      })
    });
    await expect(h.service.resume({
      manifest,
      usageDir: 'private'
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_ARTIFACT_INCONSISTENT'
    });
    expect(h.reserveAttempt).not.toHaveBeenCalled();
    expect(h.extractor.extract).not.toHaveBeenCalled();
  });
  it('recovers a prepared KB transaction only after import authorization, so crash resume remains usable', async () => {
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
    let recovering = true;
    const read = h.store.read.getMockImplementation();
    h.store.read.mockImplementation(async input => {
      const snapshot = await read(input);
      if (recovering) snapshot.health.available = false;
      return snapshot;
    });
    h.store.recover.mockImplementation(async () => {
      recovering = false;
    });
    await expect(h.service.commit({
      manifest,
      artifact,
      capability: {}
    })).rejects.toMatchObject({
      code: 'KNOWLEDGE_IMPORT_DENIED'
    });
    expect(h.store.recover).not.toHaveBeenCalled();
    expect((await h.service.commit({
      manifest,
      artifact,
      capability: h.capability
    })).applied).toBe(true);
    expect(h.store.recover).toHaveBeenCalledTimes(1);
    expect(h.extractor.extract).toHaveBeenCalledTimes(1);
  });
  it('reports incomplete provider context as corroboration without turning provider text into authored evidence', async () => {
    const h = fixture(),
      prepared = await h.prepare();
    expect(prepared.report.workCoverage).toMatchObject({
      complete: false,
      reason: 'stale_snapshot'
    });
    const result = await h.service.resume({
      manifest: prepared.manifest,
      usageDir: 'private'
    });
    expect(result.report.workCoverage).toMatchObject({
      complete: false,
      reason: 'stale_snapshot'
    });
    expect(h.extractor.extract.mock.calls[0][0].messages.every(m => m.origin === 'historical_import')).toBe(true);
  });
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
    expect(first.report.unresolvedCandidates).toEqual([expect.objectContaining({
      id: 'loop.item-import-0',
      status: 'open'
    })]);
    expect(first.report.supportedOutcomes).toEqual([]);
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
    expect((await h.service.resume({
      manifest,
      usageDir: 'private'
    })).report.supportedOutcomes).toEqual([expect.objectContaining({
      id: 'loop.application-reply',
      status: 'answered'
    })]);
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
