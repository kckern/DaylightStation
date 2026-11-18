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
import { loop, snapshot, evidence, TZ } from '../../domain/knowledge/fixtures.testHelpers.mjs';
const at = Date.parse('2026-11-17T18:00:00Z');
const workRef = {
  provider: 'todoist',
  accountId: 'personal',
  kind: 'task',
  id: 'task-1'
};
const nativeEvent = {
  id: 'work:1',
  username: 'sample',
  ref: workRef,
  type: 'completed',
  occurredAt: at,
  observedAt: at,
  providerVersion: 'native-v1',
  occurrenceId: String(at),
  origin: 'provider',
  sourceRefs: ['provider:1'],
  actorId: null,
  occurredAtEstimated: false
};
function closure({
  relation = 'same_commitment',
  object = loop(),
  allowed = true,
  valid = true,
  retracted = false,
  edited = false
} = {}) {
  let state = snapshot({
    [object.id]: object
  });
  const store = {
    read: async () => structuredClone(state),
    commit: vi.fn(async ({
      batch
    }) => {
      for (const o of batch.upserts) state.objects[o.id] = o;
      state.state = {
        ...state.state,
        ...batch.statePatch
      };
      state.revision++;
      return {
        applied: true
      };
    })
  };
  const link = {
    id: 'link-1',
    username: 'sample',
    kbObjectId: object.id,
    workRef,
    relation,
    confirmedAt: at - 1000
  };
  const bridge = new KnowledgeWorkBridge({
    store,
    evidence: {
      readByRefs: async ({
        refs
      }) => refs.map(ref => evidence({
        ref,
        sourceId: ref.slice('journalist:msg:'.length),
        content: edited ? 'I no longer plan to do this' : 'I will wait for a reply',
        retracted
      }))
    },
    verifyProviderEvent: async () => ({
      valid,
      closureAllowed: allowed
    }),
    userTimezone: () => TZ
  });
  return {
    bridge,
    store,
    link,
    read: () => state
  };
}
it('closes only an allowed same-commitment loop once without adding provider text as user evidence', async () => {
  const x = closure();
  const input = {
    username: 'sample',
    event: nativeEvent,
    links: [x.link],
    asOf: at
  };
  expect((await x.bridge.applyProviderEvent(input)).applied).toBe(true);
  expect(x.read().objects[x.link.kbObjectId].status).toBe('answered');
  expect(x.read().objects[x.link.kbObjectId].evidence).toHaveLength(1);
  expect((await x.bridge.applyProviderEvent(input)).applied).toBe(false);
  expect(x.store.commit).toHaveBeenCalledTimes(1);
});
it.each(['action_for', 'context_for'])('leaves the broader goal open for %s', async relation => {
  const x = closure({
    relation
  });
  await x.bridge.applyProviderEvent({
    username: 'sample',
    event: nativeEvent,
    links: [x.link],
    asOf: at
  });
  expect(x.read().objects[x.link.kbObjectId].status).toBe('open');
  expect(x.store.commit).not.toHaveBeenCalled();
});
it.each(['pin', 'sensitive', 'retracted', 'paused', 'unverified'])('does not relax %s protection', async why => {
  const x = closure({
    object: loop(why === 'pin' ? {
      pinned: ['status']
    } : why === 'sensitive' ? {
      sensitivity: 'private',
      ask_policy: 'never'
    } : {}),
    retracted: why === 'retracted',
    allowed: why !== 'paused',
    valid: why !== 'unverified'
  });
  await x.bridge.applyProviderEvent({
    username: 'sample',
    event: nativeEvent,
    links: [x.link],
    asOf: at
  });
  expect(x.read().objects[x.link.kbObjectId].status).toBe('open');
  expect(x.store.commit).not.toHaveBeenCalled();
});
it('does not close a commitment after the supporting authored quotation was edited away', async () => {
  const x = closure({
    edited: true
  });
  await x.bridge.applyProviderEvent({
    username: 'sample',
    event: nativeEvent,
    links: [x.link],
    asOf: at
  });
  expect(x.read().objects[x.link.kbObjectId].status).toBe('open');
  expect(x.store.commit).not.toHaveBeenCalled();
});
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { YamlKnowledgeStore } from '../../adapters/knowledge/YamlKnowledgeStore.mjs';
import { JsonlKnowledgeLedger } from '../../adapters/knowledge/JsonlKnowledgeLedger.mjs';
import { KnowledgeWriteAuthority } from '../../adapters/knowledge/KnowledgeWriteAuthority.mjs';
it('commits the closure through the real owner lease/ledger and preserves authored evidence on disk', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'work-kb-closure-'));
  const rootForUser = user => path.join(root, user);
  const authority = new KnowledgeWriteAuthority({
    configuration: {
      enabled: true,
      write: true,
      writer_env: 'fixture-prod',
      writer_host: 'fixture-writer'
    },
    environment: 'fixture-prod',
    hostId: 'fixture-writer'
  });
  const ledger = new JsonlKnowledgeLedger({
    rootForUser,
    authority,
    hostId: 'fixture-writer'
  });
  const store = new YamlKnowledgeStore({
    rootForUser,
    authority,
    ledger,
    clock: () => at
  });
  try {
    const initial = await store.read({
      username: 'sample'
    });
    const object = loop();
    await store.commit({
      username: 'sample',
      expectedRevision: initial.revision,
      runId: 'seed',
      batch: {
        upserts: [object],
        events: [],
        moves: [],
        statePatch: {},
        previewOnly: false
      }
    });
    const bridge = new KnowledgeWorkBridge({
      store,
      evidence: {
        readByRefs: async ({
          refs
        }) => refs.map(ref => evidence({
          ref,
          sourceId: ref.slice('journalist:msg:'.length),
          content: 'I will wait for a reply'
        }))
      },
      verifyProviderEvent: async () => ({
        valid: true,
        closureAllowed: true
      }),
      userTimezone: () => TZ
    });
    const link = {
      username: 'sample',
      kbObjectId: object.id,
      workRef,
      relation: 'same_commitment',
      confirmedAt: at - 1000
    };
    const input = {
      username: 'sample',
      event: nativeEvent,
      links: [link],
      asOf: at
    };
    expect((await bridge.applyProviderEvent(input)).applied).toBe(true);
    expect((await bridge.applyProviderEvent(input)).applied).toBe(false);
    const current = await store.read({
      username: 'sample'
    });
    expect(current.health.available).toBe(true);
    expect(current.objects[object.id].status).toBe('answered');
    expect(current.objects[object.id].evidence).toEqual(object.evidence);
    expect((await ledger.read({
      username: 'sample'
    })).transactions).toHaveLength(2);
  } finally {
    await store.close();
    fs.rmSync(root, {
      recursive: true,
      force: true
    });
  }
});
it('accepts a journal-origin remote observation only through the same verified Work authority', async () => {
  const x = closure();
  expect((await x.bridge.applyProviderEvent({
    username: 'sample',
    event: {
      ...nativeEvent,
      origin: 'journal'
    },
    links: [x.link],
    asOf: at
  })).applied).toBe(true);
});
it('exposes only the injected owner attention history function', async () => {
  const questions = {
    attentionHistory: vi.fn(async () => ({
      available: true,
      deliveries: [],
      reservations: [],
      unansweredInvitations: []
    }))
  };
  const bridge = new KnowledgeWorkBridge({
    questions
  });
  const input = {
    username: 'sample',
    askDate: '2026-11-17',
    asOf: 1
  };
  expect(await bridge.attentionHistory(input)).toMatchObject({
    available: true
  });
  expect(questions.attentionHistory).toHaveBeenCalledWith(input);
});
