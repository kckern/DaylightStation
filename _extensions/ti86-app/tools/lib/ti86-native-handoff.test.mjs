import { describe, expect, it } from 'vitest';
import { Ti86NativeToolMapper } from '../../../../backend/src/1_adapters/schoolcalc/ti86/Ti86NativeToolMapper.mjs';
import {
  SCHOOLCALC_LOCAL_FLAGS,
  decodeSchoolCalcLocalState,
  encodeSchoolCalcLocalState,
} from './schoolcalc-local-state.mjs';
import {
  Ti86NativeHandoffTransaction,
  Ti86NativeMemoryStore,
  Ti86NativePowerCutError,
} from './ti86-native-handoff.mjs';

const mapper = new Ti86NativeToolMapper();
const graphPlan = mapper.map({
  type: 'tool', capability: 'graph@1',
  config: {
    equations: [{ slot: 'primary', expression: '2*x+1' }],
    window: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
  },
});

describe('Ti86NativeHandoffTransaction', () => {
  it('commits continuation before mutation, authorizes launch last, and restores exactly', () => {
    const store = baselineStore();
    const transaction = new Ti86NativeHandoffTransaction({ store });
    const authorization = transaction.prepare(graphPlan, {
      applyPlan: ({ resources }) => resources.write('functionGraphDatabase', Buffer.from('lesson graph')),
    });
    expect(authorization).toMatchObject({ operation: 2, launch: 2, snapshotGeneration: 8 });
    expect(store.readNativeResource('functionGraphDatabase').toString()).toBe('lesson graph');
    const pending = transaction.inspect().selection.state;
    expect(pending.native).toEqual({
      capability: 'graph', phase: 'restorePending', snapshotGeneration: 8,
    });
    expect(pending.flags & SCHOOLCALC_LOCAL_FLAGS.nativePending).not.toBe(0);
    expect(pending.flags & SCHOOLCALC_LOCAL_FLAGS.nativeRestoreNeeded).not.toBe(0);

    const recovery = transaction.recover();
    expect(recovery.recovered).toBe(true);
    expect(store.readNativeResource('functionGraphDatabase').toString()).toBe('original graph');
    expect(store.readVariable('DSNATIVE')).toBeNull();
    const resumed = transaction.inspect().selection.state;
    expect(resumed.native).toEqual({ capability: 'none', phase: 'none', snapshotGeneration: 0 });
    expect(resumed.flags & SCHOOLCALC_LOCAL_FLAGS.nativePending).toBe(0);
    expectContinuationPreserved(resumed);
    expect(store.readVariable('DSQ').toString()).toBe('immutable queued result');
  });

  it('exhausts every preparation mutation boundary without losing native state or SchoolCalc data', () => {
    for (let cut = 1; cut <= 5; cut += 1) {
      const store = baselineStore();
      const transaction = new Ti86NativeHandoffTransaction({ store });
      store.failAfterMutation(cut);
      expect(() => transaction.prepare(graphPlan, {
        applyPlan: ({ resources }) => resources.write('functionGraphDatabase', Buffer.from('lesson graph')),
      })).toThrow(Ti86NativePowerCutError);
      store.clearFault();
      transaction.recover();
      expect(store.readNativeResource('functionGraphDatabase').toString(), `cut ${cut}`).toBe('original graph');
      expect(store.readVariable('DSNATIVE'), `cut ${cut}`).toBeNull();
      expectContinuationPreserved(transaction.inspect().selection.state);
      expect(store.readVariable('DSQ').toString(), `cut ${cut}`).toBe('immutable queued result');
    }
  });

  it('retries every interrupted restoration idempotently', () => {
    for (let cut = 1; cut <= 3; cut += 1) {
      const store = baselineStore();
      const transaction = new Ti86NativeHandoffTransaction({ store });
      transaction.prepare(graphPlan, {
        applyPlan: ({ resources }) => resources.write('functionGraphDatabase', Buffer.from('lesson graph')),
      });
      store.failAfterMutation(cut);
      expect(() => transaction.recover()).toThrow(Ti86NativePowerCutError);
      store.clearFault();
      transaction.recover();
      expect(store.readNativeResource('functionGraphDatabase').toString(), `cut ${cut}`).toBe('original graph');
      expect(store.readVariable('DSNATIVE'), `cut ${cut}`).toBeNull();
      expectContinuationPreserved(transaction.inspect().selection.state);
    }
  });

  it('snapshots every resource before a multi-resource table mutation', () => {
    const plan = mapper.map({
      type: 'tool', capability: 'table@1',
      config: { expressions: ['x^2'], start: 0, step: 1 },
    });
    const store = baselineStore({ tableSettings: Buffer.from('original table') });
    const transaction = new Ti86NativeHandoffTransaction({ store });
    transaction.prepare(plan, {
      applyPlan: ({ resources }) => {
        resources.write('functionGraphDatabase', Buffer.from('table graph'));
        resources.write('tableSettings', Buffer.from('lesson table'));
      },
    });
    transaction.recover();
    expect(store.readNativeResource('functionGraphDatabase').toString()).toBe('original graph');
    expect(store.readNativeResource('tableSettings').toString()).toBe('original table');
  });

  it('forbids mutation of any resource omitted from the committed snapshot', () => {
    const store = baselineStore({ tableSettings: Buffer.from('original table') });
    const transaction = new Ti86NativeHandoffTransaction({ store });
    expect(() => transaction.prepare(graphPlan, {
      applyPlan: ({ resources }) => resources.write('tableSettings', Buffer.from('bad mutation')),
    })).toThrow(/unsnapshotted resource/);
    expect(store.readNativeResource('tableSettings').toString()).toBe('original table');
    transaction.recover();
    expect(store.readNativeResource('functionGraphDatabase').toString()).toBe('original graph');
  });

  it('fails before mutation when snapshot space is unavailable', () => {
    const store = baselineStore();
    store.setFreeBytes(100);
    const before = store.dump();
    expect(() => new Ti86NativeHandoffTransaction({ store }).prepare(graphPlan, {
      applyPlan: () => { throw new Error('must not run'); },
    })).toThrow(/needs .* free bytes/);
    expect(store.dump()).toEqual(before);
  });

  it('fully decodes a plan and rejects malformed payloads before snapshot or mutation', () => {
    const store = baselineStore();
    const before = store.dump();
    const payload = Buffer.from(graphPlan.payload);
    payload[3] = 0xEF;
    expect(() => new Ti86NativeHandoffTransaction({ store }).prepare(
      { ...graphPlan, payload },
      { applyPlan: () => { throw new Error('must not run'); } },
    )).toThrow(/unsupported byte/);
    expect(store.dump()).toEqual(before);
    expect(store.mutationLog()).toEqual([]);
  });

  it('keeps native programs disabled unless the runtime has the same reviewed allowlist', () => {
    const programs = {
      'reviewed-helper': {
        programName: 'DSHELP',
        argumentKinds: ['number'],
      },
    };
    const plan = new Ti86NativeToolMapper({ programs }).map({
      type: 'tool', capability: 'native-program@1',
      config: { toolId: 'reviewed-helper', args: [4] },
    });
    const deniedStore = baselineStore();
    expect(() => new Ti86NativeHandoffTransaction({ store: deniedStore }).prepare(plan, {
      applyPlan: () => { throw new Error('must not run'); },
    })).toThrow(/runtime-allowlisted/);
    expect(deniedStore.mutationLog()).toEqual([]);

    const store = baselineStore();
    const transaction = new Ti86NativeHandoffTransaction({ store, programs });
    const authorization = transaction.prepare(plan, {
      applyPlan: ({ decoded, resources }) => {
        expect(decoded).toMatchObject({ programName: 'DSHELP', args: [4] });
        resources.write('nativeProgramWorkspace', Buffer.from('configured argument'));
      },
    });
    expect(authorization.decoded).toMatchObject({ programName: 'DSHELP', args: [4] });
    transaction.recover();
    expect(store.readNativeResource('nativeProgramWorkspace')).toBeNull();
  });

  it('fails closed on a missing, corrupt, or mismatched snapshot', () => {
    for (const corrupt of ['missing', 'crc']) {
      const store = baselineStore();
      const transaction = new Ti86NativeHandoffTransaction({ store });
      transaction.prepare(graphPlan, {
        applyPlan: ({ resources }) => resources.write('functionGraphDatabase', Buffer.from('lesson graph')),
      });
      if (corrupt === 'missing') store.deleteVariable('DSNATIVE');
      else {
        const bytes = store.readVariable('DSNATIVE');
        bytes[10] ^= 0xFF;
        store.writeVariable('DSNATIVE', bytes);
      }
      expect(() => transaction.recover()).toThrow(/snapshot|SCN1/);
      expect(store.readNativeResource('functionGraphDatabase').toString()).toBe('lesson graph');
      expect(transaction.inspect().selection.state.flags & SCHOOLCALC_LOCAL_FLAGS.nativePending).not.toBe(0);
      expect(store.readVariable('DSQ').toString()).toBe('immutable queued result');
    }
  });
});

function baselineStore(extraResources = {}) {
  const local = encodeSchoolCalcLocalState({
    generation: 7,
    flags: SCHOOLCALC_LOCAL_FLAGS.sessionActive | SCHOOLCALC_LOCAL_FLAGS.draftPresent,
    view: 'module',
    activeArtifactKey: 'ABCDEF2345',
    address: {
      catalogIndex: 1, subjectIndex: 2, courseIndex: 3, unitIndex: 4,
      lessonIndex: 5, moduleIndex: 6, itemIndex: 7,
    },
    focus: 3,
    scroll: 2,
    cardFace: 1,
    cardScroll: 9,
    draftKind: 'choice',
    draft: Buffer.from([2]),
    nextSequence: 44,
    nextRequestId: 8,
  });
  expect(decodeSchoolCalcLocalState(local).generation).toBe(7);
  return new Ti86NativeMemoryStore({
    variables: {
      DSLOCAL0: local,
      DSQ: Buffer.from('immutable queued result'),
      DPCONTNT: Buffer.from('immutable lesson content'),
    },
    resources: {
      functionGraphDatabase: Buffer.from('original graph'),
      ...extraResources,
    },
  });
}

function expectContinuationPreserved(state) {
  expect(state).toMatchObject({
    view: 'module',
    activeArtifactKey: 'ABCDEF2345',
    address: {
      catalogIndex: 1, subjectIndex: 2, courseIndex: 3, unitIndex: 4,
      lessonIndex: 5, moduleIndex: 6, itemIndex: 7,
    },
    focus: 3,
    scroll: 2,
    cardFace: 1,
    cardScroll: 9,
    draftKind: 'choice',
    draft: Buffer.from([2]),
    nextSequence: 44,
    nextRequestId: 8,
  });
}
