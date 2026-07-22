import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { createScaleNutribotBridge } from '#apps/hardware/ScaleNutribotBridge.mjs';
import { normalizeScaleNutribotConfig } from '#apps/nutribot/lib/scaleNutribotConfig.mjs';

const logger = { debug() {}, info() {}, warn() {}, error() {} };
const flush = () => new Promise((r) => setTimeout(r, 0));

function makeBus() {
  const handlers = {};
  return {
    subscribe: (topic, cb) => { (handlers[topic] ||= []).push(cb); return () => {}; },
    emit: (topic, payload) => (handlers[topic] || []).forEach((cb) => cb(payload)),
  };
}

// LogFoodFromScale mock: create vs edit distinguished by existingLogUuid; `answered`
// flips edits to the touched shape. RetractScaleLog mock always reports retracted.
function makeContainer() {
  let n = 0;
  const state = { answered: false };
  const execute = jest.fn(async (input) => {
    if (input.existingLogUuid) {
      return state.answered
        ? { success: true, logUuid: input.existingLogUuid, edited: false, touched: true }
        : { success: true, logUuid: input.existingLogUuid, messageId: 'm1', stage: 'density', edited: true };
    }
    n += 1;
    return { success: true, logUuid: `l${n}`, messageId: `m${n}`, stage: 'density' };
  });
  const retract = jest.fn(async () => ({ success: true, retracted: true }));
  return {
    execute, retract, state,
    container: { getLogFoodFromScale: () => ({ execute }), getRetractScaleLog: () => ({ execute: retract }) },
  };
}

describe('ScaleNutribotBridge (gated: supersede, force, suspicion, sweep)', () => {
  let bus, execute, retract, cstate, clock, now;
  const emit = (grams, stable = true) => bus.emit('food-scale', { id: 'kitchen', grams, stable, unit: 'g' });
  const press = () => bus.emit('food-scale', { id: 'kitchen', event: 'button', press: 'short' });
  const createCalls = () => execute.mock.calls.filter((c) => !c[0].existingLogUuid);
  const editCalls = () => execute.mock.calls.filter((c) => c[0].existingLogUuid);

  function build(overrides = {}) {
    const m = makeContainer();
    execute = m.execute; retract = m.retract; cstate = m.state;
    bus = makeBus();
    clock = 1_000_000;
    now = () => clock;
    createScaleNutribotBridge({
      eventBus: bus, nutribotContainer: m.container,
      userId: 'kckern', conversationId: 'telegram:b1_c2',
      scaleConfig: normalizeScaleNutribotConfig({ nutribot: overrides }), logger, now,
    });
  }

  beforeEach(() => build());

  it('learns the initial resting weight silently', async () => {
    emit(480); await flush();
    expect(createCalls()).toHaveLength(0);
  });

  it('posts one prompt on placement, then edits IN PLACE as the weight climbs', async () => {
    emit(480); await flush();          // baseline
    emit(680); await flush();          // placement → create l1
    emit(740); await flush();          // +60 → edit in place, no new message
    expect(createCalls()).toHaveLength(1);
    expect(editCalls()).toHaveLength(1);
    expect(editCalls()[0][0]).toMatchObject({ grams: 740, existingLogUuid: 'l1' });
  });

  it('dedups a held value (change < dedupDelta)', async () => {
    emit(480); await flush();
    emit(680); await flush();
    emit(682); await flush();          // +2 < dedup(5)
    expect(createCalls()).toHaveLength(1);
    expect(editCalls()).toHaveLength(0);
  });

  it('after the prompt is answered, more food starts a NEW prompt', async () => {
    emit(480); await flush();
    emit(680); await flush();          // create l1
    cstate.answered = true;            // user picked a density
    emit(760); await flush();          // edit→touched → new placement → create l2
    expect(createCalls()).toHaveLength(2);
    expect(retract).not.toHaveBeenCalled(); // answered log is kept, never retracted
  });

  it('KEEPS the unanswered prompt when the pan empties, superseding it only on the next placement', async () => {
    // This asserted the opposite until 2026-07-22: session end swept the prompt.
    // In production a 95 g item posted a prompt at 09:43:04 and it was deleted at
    // 09:43:20 -- because the item had been lifted off the pan. Set it down, read
    // it, pick it up is how a kitchen scale is used, so the old rule meant you had
    // to tap a density while the food was still sitting there or lose the prompt.
    emit(480); await flush();
    emit(680); await flush();          // create l1 (unanswered)
    emit(482); await flush();          // back near baseline → session end

    expect(retract).not.toHaveBeenCalled();   // survives; still answerable

    emit(690); await flush();          // a NEW placement supersedes it
    expect(createCalls()).toHaveLength(2);
    expect(retract).toHaveBeenCalledTimes(1); // superseded by post(), not swept by session end
    expect(retract.mock.calls[0][0]).toMatchObject({ logUuid: 'l1' });
  });

  it('does not let a suppressed placement repaint a closed prompt', async () => {
    // The closed flag exists for this: the LOADING branch returns early on a live
    // prompt, so without it a placement that the storage-band filter would suppress
    // would still edit-in-place and repaint the pending prompt with the put-away
    // weight -- the exact phantom that filter exists to keep out of nutribot.
    build({ storage_weight_g: 430, storage_tolerance_g: 15 });
    emit(0); await flush();            // baseline 0
    emit(200); await flush();          // real placement → create l1 (unanswered)
    emit(2); await flush();            // session end → l1 closed, NOT retracted
    const editsBefore = editCalls().length;

    emit(438); await flush();          // in the storage band 430±15 → suppressed
    expect(createCalls()).toHaveLength(1);            // no new prompt
    expect(editCalls().length).toBe(editsBefore);     // and l1 was not repainted
    expect(retract).not.toHaveBeenCalled();           // nor swept
  });

  it('suppresses a value inside the storage band (no post)', async () => {
    build({ storage_weight_g: 430, storage_tolerance_g: 15 });
    emit(0); await flush();            // baseline 0
    emit(438); await flush();          // in band 430±15 → suppressed
    expect(createCalls()).toHaveLength(0);
  });

  it('button force overrides a suppressed value', async () => {
    build({ storage_weight_g: 430, storage_tolerance_g: 15 });
    emit(0); await flush();
    emit(438); await flush();          // suppressed
    press(); await flush();            // force logs live 438
    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0][0]).toMatchObject({ grams: 438 });
  });

  it('suppresses a heavy jump right after a storm of recent posts', async () => {
    build({ storage_weight_g: 0, storm_min_pushes: 2, heavy_g: 300, suspicion_window_sec: 90 });
    emit(0); await flush();            // baseline 0
    clock += 1000; emit(50); await flush();   // post #1 (l1)
    clock += 1000; emit(0); await flush();    // session end
    clock += 1000; emit(60); await flush();   // post #2 (l2)
    clock += 1000; emit(0); await flush();    // session end  → 2 recent posts on record
    clock += 1000; emit(400); await flush();  // rise 400 ≥ heavy, 2 posts in window → suppressed
    expect(createCalls()).toHaveLength(2);
    press(); await flush();                   // force overrides
    expect(createCalls()).toHaveLength(3);
  });

  it('trusts a lone heavy placement with no recent storm', async () => {
    build({ storage_weight_g: 0, storm_min_pushes: 2, heavy_g: 300 });
    emit(0); await flush();
    clock += 1000; emit(400); await flush();  // no prior posts → trusted
    expect(createCalls()).toHaveLength(1);
  });

  it('button no-ops when a live prompt already covers ~this weight', async () => {
    emit(480); await flush();
    emit(680); await flush();          // create l1, live@680
    press(); await flush();            // lastGrams 680, within forceTol → edit(no-op), no new create
    expect(createCalls()).toHaveLength(1);
    expect(editCalls()).toHaveLength(1);
  });

  it('button captures the latest weight even from an unstable frame', async () => {
    emit(480); await flush();
    emit(690, false); await flush();   // unstable → auto ignores, lastGrams=690
    press(); await flush();
    expect(createCalls()).toHaveLength(1);
    expect(createCalls()[0][0]).toMatchObject({ grams: 690 });
  });

  it('button does nothing with no weight on the scale', async () => {
    press(); await flush();
    expect(execute).not.toHaveBeenCalled();
  });

  it('does not double-create on two synchronous placement frames', async () => {
    emit(480); await flush();
    emit(680); emit(680);
    await flush();
    expect(createCalls()).toHaveLength(1);
  });
});
