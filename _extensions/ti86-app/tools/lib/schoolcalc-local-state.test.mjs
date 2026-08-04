import { describe, expect, it } from 'vitest';
import {
  SCHOOLCALC_LOCAL_FLAGS,
  SCHOOLCALC_LOCAL_STATE_BYTES,
  decodeSchoolCalcLocalState,
  defaultSchoolCalcLocalState,
  encodeSchoolCalcLocalState,
  prepareSchoolCalcLocalStateSave,
  selectSchoolCalcLocalState,
} from './schoolcalc-local-state.mjs';

describe('TI-86 crash-safe SCL1 local state', () => {
  it('round-trips bounded continuation, draft, sequence, and native metadata', () => {
    const state = {
      ...defaultSchoolCalcLocalState(),
      generation: 8,
      flags: SCHOOLCALC_LOCAL_FLAGS.sessionActive
        | SCHOOLCALC_LOCAL_FLAGS.draftPresent
        | SCHOOLCALC_LOCAL_FLAGS.nativePending
        | SCHOOLCALC_LOCAL_FLAGS.nativeRestoreNeeded
        | SCHOOLCALC_LOCAL_FLAGS.catalogSlot1
        | SCHOOLCALC_LOCAL_FLAGS.installStateSlot1
        | SCHOOLCALC_LOCAL_FLAGS.syncSnapshotPresent,
      view: 'native',
      activeArtifactKey: 'ABC234DEFG',
      catalogGenerationKey: 'CDEFG23456',
      address: {
        catalogIndex: 1, subjectIndex: 2, courseIndex: 3, unitIndex: 4,
        lessonIndex: 5, moduleIndex: 6, itemIndex: 7,
      },
      focus: 8,
      scroll: 9,
      cardFace: 1,
      cardScroll: 10,
      draftKind: 'text',
      draft: Buffer.from('answer', 'ascii'),
      nextSequence: 0xAB_CDEF,
      nextRequestId: 0x12_3456,
      selectedLearnerKey: 7,
      sessionLearnerKey: 7,
      native: { capability: 'graph', phase: 'restorePending', snapshotGeneration: 4 },
    };
    const bytes = encodeSchoolCalcLocalState(state);
    expect(bytes).toHaveLength(SCHOOLCALC_LOCAL_STATE_BYTES);
    expect(decodeSchoolCalcLocalState(bytes)).toEqual(state);
  });

  it('selects the newest valid slot and repairs a torn inactive write', () => {
    const oldBytes = encodeSchoolCalcLocalState({ generation: 4 });
    const nextBytes = encodeSchoolCalcLocalState({ generation: 5, view: 'catalog' });
    expect(selectSchoolCalcLocalState({ DSLOCAL0: oldBytes, DSLOCAL1: nextBytes })).toMatchObject({
      activeSlot: 'DSLOCAL1', state: { generation: 5, view: 'catalog' }, repairSlots: [],
    });
    const torn = Buffer.from(nextBytes.subarray(0, 50));
    expect(selectSchoolCalcLocalState({ DSLOCAL0: oldBytes, DSLOCAL1: torn })).toMatchObject({
      activeSlot: 'DSLOCAL0', state: { generation: 4 }, repairSlots: ['DSLOCAL1'],
    });
  });

  it('writes only the inactive slot at generation plus one', () => {
    const selected = selectSchoolCalcLocalState({
      DSLOCAL0: encodeSchoolCalcLocalState({ generation: 11, view: 'lesson' }),
    });
    const save = prepareSchoolCalcLocalStateSave(selected, { view: 'module', focus: 3 });
    expect(save.targetSlot).toBe('DSLOCAL1');
    expect(decodeSchoolCalcLocalState(save.bytes)).toMatchObject({ generation: 12, view: 'module', focus: 3 });

    const addressed = prepareSchoolCalcLocalStateSave({
      ...selected,
      state: { ...selected.state, address: { ...selected.state.address, courseIndex: 7, unitIndex: 9 } },
    }, { address: { unitIndex: 10 } });
    expect(decodeSchoolCalcLocalState(addressed.bytes).address).toMatchObject({ courseIndex: 7, unitIndex: 10 });
  });

  it('rejects corruption, conflicting equal generations, and inconsistent flags', () => {
    const valid = encodeSchoolCalcLocalState({ generation: 2 });
    const corrupt = Buffer.from(valid);
    corrupt[20] ^= 1;
    expect(() => decodeSchoolCalcLocalState(corrupt)).toThrow(/invalid/);
    expect(() => selectSchoolCalcLocalState({ DSLOCAL0: corrupt, DSLOCAL1: corrupt })).toThrow(/both/);
    expect(() => selectSchoolCalcLocalState({
      DSLOCAL0: encodeSchoolCalcLocalState({ generation: 2, view: 'home' }),
      DSLOCAL1: encodeSchoolCalcLocalState({ generation: 2, view: 'catalog' }),
    })).toThrow(/conflict/);
    expect(() => encodeSchoolCalcLocalState({
      flags: SCHOOLCALC_LOCAL_FLAGS.draftPresent,
      draftKind: 'none',
      draft: Buffer.alloc(0),
    })).toThrow(/draft flag/);
    expect(() => encodeSchoolCalcLocalState({ flags: 1 << 15 })).toThrow(/unknown flag/);
    expect(() => encodeSchoolCalcLocalState({
      flags: SCHOOLCALC_LOCAL_FLAGS.catalogSlot1,
    })).toThrow(/slot selectors/);
    expect(() => encodeSchoolCalcLocalState({
      flags: SCHOOLCALC_LOCAL_FLAGS.syncSnapshotPresent,
    })).toThrow(/generation key/);
    expect(() => encodeSchoolCalcLocalState({
      flags: SCHOOLCALC_LOCAL_FLAGS.deliveryPending,
      view: 'catalog',
      deliveryAction: 'install',
    })).toThrow(/delivery flag/);
    expect(() => encodeSchoolCalcLocalState({
      flags: SCHOOLCALC_LOCAL_FLAGS.draftPresent,
      draftKind: 'progress',
      draft: Buffer.from([2, 3, 0, 8, 0]),
    })).toThrow(/result-pending flag/);
    expect(() => encodeSchoolCalcLocalState({
      flags: SCHOOLCALC_LOCAL_FLAGS.sessionActive
        | SCHOOLCALC_LOCAL_FLAGS.draftPresent
        | SCHOOLCALC_LOCAL_FLAGS.resultPending,
      draftKind: 'progress',
      draft: Buffer.from([2, 9, 0, 8, 0]),
      sessionLearnerKey: 1,
    })).toThrow(/progress continuation/);
  });

  it('persists a delivery continuation and independent request counter', () => {
    const state = decodeSchoolCalcLocalState(encodeSchoolCalcLocalState({
      generation: 3,
      flags: SCHOOLCALC_LOCAL_FLAGS.deliveryPending,
      view: 'delivery',
      deliveryAction: 'update',
      nextRequestId: 0x12_3456,
      activeArtifactKey: 'ABC234DEFG',
      address: { catalogIndex: 1, subjectIndex: 2, courseIndex: 3, unitIndex: 4, lessonIndex: 5 },
    }));
    expect(state).toMatchObject({
      view: 'delivery', deliveryAction: 'update', nextRequestId: 0x12_3456,
      address: { catalogIndex: 1, subjectIndex: 2, courseIndex: 3, unitIndex: 4, lessonIndex: 5 },
    });
  });

  it('round-trips a timestamp-free pending progress continuation', () => {
    const state = decodeSchoolCalcLocalState(encodeSchoolCalcLocalState({
      flags: SCHOOLCALC_LOCAL_FLAGS.sessionActive
        | SCHOOLCALC_LOCAL_FLAGS.draftPresent
        | SCHOOLCALC_LOCAL_FLAGS.resultPending,
      view: 'module',
      activeArtifactKey: 'ABC234DEFG',
      address: { moduleIndex: 2, itemIndex: 3 },
      draftKind: 'progress',
      draft: Buffer.from([2, 4, 0, 8, 0]),
      nextSequence: 11,
      selectedLearnerKey: 2,
      sessionLearnerKey: 2,
    }));
    expect(state).toMatchObject({
      flags: SCHOOLCALC_LOCAL_FLAGS.sessionActive
        | SCHOOLCALC_LOCAL_FLAGS.draftPresent
        | SCHOOLCALC_LOCAL_FLAGS.resultPending,
      draftKind: 'progress',
      nextSequence: 11,
      selectedLearnerKey: 2,
      sessionLearnerKey: 2,
    });
    expect([...state.draft]).toEqual([2, 4, 0, 8, 0]);
  });

  it('keeps the current profile separate from the immutable in-flight attribution', () => {
    const active = encodeSchoolCalcLocalState({
      flags: SCHOOLCALC_LOCAL_FLAGS.sessionActive,
      selectedLearnerKey: 4,
      sessionLearnerKey: 3,
    });
    expect(decodeSchoolCalcLocalState(active)).toMatchObject({
      selectedLearnerKey: 4, sessionLearnerKey: 3,
    });
    expect(() => encodeSchoolCalcLocalState({ sessionLearnerKey: 3 })).toThrow(/inactive session/);
    expect(() => encodeSchoolCalcLocalState({
      flags: SCHOOLCALC_LOCAL_FLAGS.sessionActive
        | SCHOOLCALC_LOCAL_FLAGS.draftPresent
        | SCHOOLCALC_LOCAL_FLAGS.resultPending,
      draftKind: 'progress',
      draft: Buffer.from([2, 1, 0, 1, 0]),
      selectedLearnerKey: 0,
      sessionLearnerKey: 0,
    })).toThrow(/Guest work/);
  });
});
