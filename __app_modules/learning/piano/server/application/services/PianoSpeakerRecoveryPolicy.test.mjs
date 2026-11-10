import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SPEAKER_LADDER, initialSpeakerEpisode, decideSpeaker, forceGiveUp, speakerPublicState,
} from './PianoSpeakerRecoveryPolicy.mjs';

const TICK = 30_000;
const DOWN = { speaker: false, pianoPower: 'on', bridgeUp: true };
const UP = { speaker: true, pianoPower: 'on', bridgeUp: true };

/** Drive the policy tick by tick; returns every action taken. */
function run(obsList, { start = 1_000_000, ep = initialSpeakerEpisode(), options } = {}) {
  let t = start;
  const actions = [];
  for (const obs of obsList) {
    const r = decideSpeaker(ep, obs, t, options);
    ep = r.episode;
    actions.push(r.action);
    t += TICK;
  }
  return { ep, actions, t };
}
const attempts = (actions) => actions.filter((a) => a.type === 'attempt').map((a) => a.step.rung);

test('one down tick is a blip; the second opens the episode at rung 1', () => {
  const { actions, ep } = run([DOWN, DOWN]);
  assert.equal(actions[0].type, 'none');
  assert.equal(actions[1].type, 'attempt');
  assert.equal(actions[1].opened, true);
  assert.equal(actions[1].step.action, 'a2dpReconnect');
  assert.equal(speakerPublicState(ep), 'recovering');
});

test('climbs all five rungs in order, then gives up with one notify', () => {
  // 2 ticks to open, then enough ticks to pass every checkAt (max 90 s = 3 ticks).
  const { actions, ep } = run(Array(30).fill(DOWN));
  assert.deepEqual(attempts(actions), [1, 2, 3, 4, 5]);
  const gaveUp = actions.filter((a) => a.type === 'gave-up');
  assert.equal(gaveUp.length, 1);
  assert.equal(gaveUp[0].notify, true);
  assert.equal(gaveUp[0].reason, 'ladder-exhausted');
  assert.equal(speakerPublicState(ep), 'needs-help');
});

test('each rung waits for its checkAt before escalating', () => {
  const { actions } = run(Array(9).fill(DOWN));
  // t0 none, t30 rung1 (check +15s), t60 rung2 (check +75s → t135), t150 rung3 (check +90s → t240), t240 rung4.
  assert.deepEqual(actions.slice(0, 3).map((a) => a.type), ['none', 'attempt', 'attempt']);
  assert.deepEqual(actions.slice(3, 5).map((a) => a.type), ['none', 'none']);
  assert.equal(actions[5].step.rung, 3);
  assert.deepEqual(actions.slice(6, 8).map((a) => a.type), ['none', 'none']);
  assert.equal(actions[8].step.rung, 4);
});

test('speaker returning mid-ladder reports recovered with the rung that worked', () => {
  const { actions, ep } = run([DOWN, DOWN, DOWN, UP]);
  const rec = actions[3];
  assert.equal(rec.type, 'recovered');
  assert.equal(rec.rung, 2);
  assert.equal(rec.alerted, false);
  assert.ok(rec.durationMs > 0);
  assert.equal(speakerPublicState(ep), 'ok');
});

test('plug wait ignores the power-off it caused', () => {
  // Reach rung 4 (first plug cycle).
  let { ep } = run(Array(9).fill(DOWN));
  assert.equal(ep.lastAction, 'plugCycle');
  const r = decideSpeaker(ep, { speaker: false, pianoPower: 'off', bridgeUp: true }, ep.checkAt - 1);
  assert.equal(r.action.type, 'none');
  assert.equal(r.episode.phase, 'recovering');
});

test('piano still off after the plug check is a give-up, not a quiet end', () => {
  let { ep } = run(Array(9).fill(DOWN));
  const r = decideSpeaker(ep, { speaker: false, pianoPower: 'off', bridgeUp: true }, ep.checkAt + 1);
  assert.equal(r.action.type, 'gave-up');
  assert.equal(r.action.reason, 'piano-stayed-off');
  assert.equal(r.action.notify, true);
});

test('piano switched off during a Bluetooth rung ends the episode quietly', () => {
  let { ep, t } = run([DOWN, DOWN, DOWN]); // at rung 2 (btCycle)
  const r = decideSpeaker(ep, { speaker: false, pianoPower: 'off', bridgeUp: true }, t + 60_000);
  assert.equal(r.action.type, 'ended');
  assert.equal(speakerPublicState(r.episode), 'ok');
});

test('piano off with no episode never opens one', () => {
  const { actions } = run(Array(5).fill({ speaker: false, pianoPower: 'off', bridgeUp: true }));
  assert.ok(actions.every((a) => a.type === 'none'));
});

test('unknown power skips both plug rungs and still terminates', () => {
  const obs = { speaker: false, pianoPower: 'unknown', bridgeUp: true };
  const { actions } = run(Array(20).fill(obs));
  assert.deepEqual(attempts(actions), [1, 2, 3]);
  const g = actions.find((a) => a.type === 'gave-up');
  assert.deepEqual(g.skipped.map((s) => s.reason), ['power-unknown', 'power-unknown']);
});

test('no plug configured skips plug rungs with reason no-plug', () => {
  const { actions } = run(Array(20).fill(DOWN), { options: { plugAvailable: false } });
  assert.deepEqual(attempts(actions), [1, 2, 3]);
  assert.equal(actions.find((a) => a.type === 'gave-up').skipped[0].reason, 'no-plug');
});

test('bridge down or speaker unknown pauses the ladder without consuming a rung', () => {
  let { ep, t } = run([DOWN, DOWN]); // rung 1
  const paused = decideSpeaker(ep, { speaker: null, pianoPower: 'on', bridgeUp: false }, t + 600_000);
  assert.equal(paused.action.type, 'none');
  assert.equal(paused.episode.rung, 1);
});

test('flapping keeps climbing: a brief recovery does not reset the rung', () => {
  // rung 1, recover, drop again → continues at rung 2, not 1.
  const { actions } = run([DOWN, DOWN, UP, DOWN, DOWN]);
  assert.deepEqual(attempts(actions), [1, 2]);
});

test('10 healthy minutes resets the counter to rung 1', () => {
  const healthy = Array(21).fill(UP); // 21 × 30 s = 10.5 min
  const { actions } = run([DOWN, DOWN, DOWN, UP, ...healthy, DOWN, DOWN]);
  assert.deepEqual(attempts(actions), [1, 2, 1]);
});

test('plug cap: a third plug cycle inside an hour is skipped', () => {
  // Two plug cycles already this hour.
  const start = 10_000_000;
  const ep = { ...initialSpeakerEpisode(), plugCycles: [start - 1000, start - 2000] };
  const { actions } = run(Array(20).fill(DOWN), { start, ep });
  assert.deepEqual(attempts(actions), [1, 2, 3]);
  assert.deepEqual(actions.find((a) => a.type === 'gave-up').skipped.map((s) => s.reason), ['plug-cap', 'plug-cap']);
});

test('after give-up, waits the backoff, then re-arms at rung 1 without a second notify', () => {
  let { ep } = run(Array(30).fill(DOWN));
  const early = decideSpeaker(ep, DOWN, ep.gaveUpAt + 30 * 60_000);
  assert.equal(early.action.type, 'none');
  const rearm = decideSpeaker(ep, DOWN, ep.gaveUpAt + 60 * 60_000);
  assert.equal(rearm.action.type, 'attempt');
  assert.equal(rearm.action.step.rung, 1);
  assert.equal(speakerPublicState(rearm.episode), 'needs-help'); // banner stays up during re-arm
  // Exhaust again: no second notify.
  let e = rearm.episode; let t = ep.gaveUpAt + 60 * 60_000;
  let second = null;
  for (let i = 0; i < 30 && !second; i++) {
    t += TICK;
    const r = decideSpeaker(e, DOWN, t, { maxPlugCyclesPerHour: 10 });
    e = r.episode;
    if (r.action.type === 'gave-up') second = r.action;
  }
  assert.equal(second.notify, false);
});

test('recovery after give-up reports alerted so the caller sends the back card', () => {
  let { ep, t } = run(Array(30).fill(DOWN));
  const r = decideSpeaker(ep, UP, t);
  assert.equal(r.action.type, 'recovered');
  assert.equal(r.action.alerted, true);
  assert.equal(speakerPublicState(r.episode), 'ok');
});

test('forceGiveUp jumps straight to needs-help', () => {
  let { ep, t } = run(Array(9).fill(DOWN));
  const r = forceGiveUp(ep, t, 'piano-unpowered');
  assert.equal(r.action.type, 'gave-up');
  assert.equal(r.action.reason, 'piano-unpowered');
  assert.equal(speakerPublicState(r.episode), 'needs-help');
});

test('undefined options fall back to defaults', () => {
  const opts = { healthyResetMs: undefined, giveUpBackoffMs: undefined, maxPlugCyclesPerHour: undefined };
  const { actions } = run(Array(30).fill(DOWN), { options: opts });
  assert.deepEqual(attempts(actions), [1, 2, 3, 4, 5]);
});

test('ladder table matches the spec exactly', () => {
  assert.deepEqual(SPEAKER_LADDER.map((s) => [s.action, s.settleMs ?? s.offMs ?? null, s.checkAfterMs]), [
    ['a2dpReconnect', null, 15_000],
    ['btCycle', 5_000, 75_000],
    ['btCycle', 15_000, 90_000],
    ['plugCycle', 10_000, 60_000],
    ['plugCycle', 30_000, 90_000],
  ]);
});

test('a piano power-off resets the ladder: the next power-on starts at rung 1, not a plug cycle', () => {
  // Climb to rung 3, child switches the piano off, next morning it comes on with the speaker still connecting.
  let { ep, t } = run(Array(8).fill(DOWN));
  assert.equal(ep.rung, 3);
  const off = { speaker: false, pianoPower: 'off', bridgeUp: true };
  ({ ep, t } = run(Array(4).fill(off), { start: t, ep }));
  assert.equal(ep.rung, 0);
  const { actions } = run([DOWN, DOWN], { start: t + 12 * 3600_000, ep });
  assert.equal(actions[1].type, 'attempt');
  assert.equal(actions[1].step.action, 'a2dpReconnect');
});

test('a power-off between drops also clears a gave-up-ready rung 5', () => {
  let { ep, t } = run(Array(30).fill(DOWN)); // needs-help at rung 5
  const off = { speaker: false, pianoPower: 'off', bridgeUp: true };
  ({ ep } = run([UP, off, off], { start: t, ep })); // recovered, then switched off
  assert.equal(ep.rung, 0);
});
