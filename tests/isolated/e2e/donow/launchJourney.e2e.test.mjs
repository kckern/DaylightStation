/**
 * The DoNow launch journey, end to end — the closing proof of the DoNow +
 * Agenda Preview plan (Task 14).
 *
 * Every other DoNow test exercises ONE seam at a time: a policy decision in
 * isolation, `DoNowService` against fake surfaces, `SurfaceProgramLauncher`
 * against a fake datastore, `DoNowSchoolBridge` against a fake bus. This is
 * the one place the WHOLE loop is checked against the REAL production graph
 * `tests/_lib/school/lifecycleHarness.mjs` already boots (`createDonow` +
 * `createSchoolLifecycle`, wired exactly as `app.mjs` orders them):
 *
 *   (a) a `launch:` unit's subject prints a QR while the garage is busy;
 *   (b) scanning it pends — one real HA notification, through the REAL
 *       `HaApprovalNotifier`/`CallHomeAssistantService` chain (only the HA
 *       transport itself is a fake `haGateway`);
 *   (c) a re-scan dedupes to the SAME approval, asking the parent NOTHING a
 *       second time (spec §9 row 7);
 *   (d) approving it, once the garage goes idle, dispatches for real and lets
 *       `DoNowSchoolBridge` — subscribed to the real event bus, not a test
 *       double — close the session out of band;
 *   (e) a config-driven `school.yml` `programs:` entry (`pe-daily`, spec §6
 *       "surface programs") dispatches immediately once the surface is free,
 *       and the dispatch log's own evidence is what marks it done for today;
 *   (f) the dry-run preview route touches neither store, mid-journey.
 *
 * THE ONE GENUINE RACE: `DoNowService` broadcasts `donow.dispatched`
 * synchronously and never awaits it (by design — see `DoNowService.mjs`'s and
 * `DoNowSchoolBridge.mjs`'s own docs on why a real bus is fire-and-forget).
 * `DoNowApprovals#approve` resolving therefore does NOT guarantee the
 * bridge's own append+honor-close has landed yet — `waitUntil` below polls
 * for it rather than asserting on a timing coincidence.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createLifecycleHarness, DEFAULT_LEARNER } from '#testlib/school/lifecycleHarness.mjs';

const LAUNCH_UNIT = 'garage-launch.01';
const PE_UNIT = 'pe-daily.act';
const PE_PROGRAM_ID = 'pe-daily';
const SURFACE = 'garage-fitness';
const NOTIFY_SERVICE = 'notify.mobile_app_parent_phones';

/** Poll until `check()` returns true or `timeoutMs` elapses — for the one
 * genuinely detached async effect in this journey (see module doc). */
async function waitUntil(check, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    if (await check()) return true;
    if (Date.now() >= deadline) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => { setTimeout(resolve, intervalMs); });
  }
}

let h;

beforeEach(async () => {
  h = await createLifecycleHarness({
    // `YamlDoNowDatastore.listPending()` prunes expired rows against the REAL
    // wall clock (it has no injected-clock seam of its own — unlike
    // `DoNowService`/`SurfaceProgramLauncher`, which this harness DOES align
    // to its own simulated clock). The harness's usual fixed-past `startIso`
    // would make every pending record this journey creates read back as
    // already-expired the instant `listPending()` runs. Starting the
    // simulated clock at real "now" keeps both clocks in step for this test,
    // without touching that production adapter.
    startIso: new Date().toISOString(),
    donowNotifyService: NOTIFY_SERVICE,
    programs: [{
      id: PE_PROGRAM_ID,
      label: 'P.E.',
      surface: SURFACE,
      action: { episodeId: 'plex:901' },
      subject: 'skills',
      // Author-supplied, exactly like a `launch:` unit's own `labelHint`
      // (spec review finding): without this, BuildAgenda/ResolveScanAction
      // used to hardcode "on the Portal" for EVERY program, which was
      // simply wrong here — `pe-daily` dispatches to `garage-fitness`,
      // never the Portal.
      locationHint: 'in the garage',
    }],
  });
  // No math course here — just the two fixture units this journey exercises.
  await h.assign({ courses: [], units: [LAUNCH_UNIT, PE_UNIT] });
  // The garage starts OCCUPIED BY SOMEONE ELSE: FitnessPresenceTracker's own
  // `observe()` contract (spec §5.1) — a `sessionActive:true` reading, fed the
  // same way the real ingest tap would.
  h.donow.presence.fitness.observe({ event: 'fitness-profile', data: { sessionActive: true } });
});

afterEach(() => { h?.dispose(); });

const tokenDir = () => path.join(h.dataDir, 'apps', 'school', 'tokens');
const tokenFiles = () => (fs.existsSync(tokenDir()) ? fs.readdirSync(tokenDir()) : []);

describe('the DoNow launch journey — one card, garage-fitness, end to end (Task 14)', () => {
  it('walks tap -> pend -> dedup -> approve -> honor-close -> surface program -> preview-stays-dry', async () => {
    // -----------------------------------------------------------------------
    // (a) tap: the launch unit's subject prints, with a QR, garage busy or not
    // -----------------------------------------------------------------------
    await h.scanCard();
    const tapA = h.lastReceiptText();
    // A LIVE section is named by its lesson card's taxonomy breadcrumb, not by
    // an uppercase subject heading — that heading survives only for sections
    // with no card to offer (served/locked/unavailable), which is why the
    // "SCIENCE … done today" assertions further down still hold.
    expect(tapA).toContain('A garage fitness break');

    const offeredA = h.tokensInLastReceipt();
    // The location hint reads off the whole lesson card printed above the
    // code (`printed`), not the code's own label — the label is the lesson
    // title. See `barcodesInLastReceipt` in the lifecycle harness.
    const launchToken = offeredA.find((o) => /go to the garage/i.test(o.printed))?.token;
    // `pe-daily` dispatches to `garage-fitness`, never the Portal — its
    // configured `locationHint: 'in the garage'` is what the offer label
    // reads (spec review finding: this used to wrongly say "on the Portal"
    // for every program, garage included).
    const peToken = offeredA.find((o) => /in the garage/i.test(o.printed))?.token;
    expect(launchToken, `no launch ticket in ${JSON.stringify(offeredA)}`).toBeTruthy();
    expect(peToken, `no pe-daily ticket in ${JSON.stringify(offeredA)}`).toBeTruthy();

    const launchSessionId = await h.sessionIdFor(LAUNCH_UNIT);
    expect(launchSessionId).toBeTruthy();

    // -----------------------------------------------------------------------
    // (b) scan the subject token: the garage is busy -> pending_approval,
    // a slip saying a grown-up was asked, EXACTLY ONE notification.
    // -----------------------------------------------------------------------
    const scanB = await h.scan(launchToken);
    expect(scanB.status).toBe('pending_approval');
    expect(h.lastReceiptText()).toMatch(/asked a grown-up/i);
    expect(h.haGatewayCalls).toHaveLength(1);

    const pendingAfterB = await h.donow.approvals.listPending();
    const pendingForSurface = pendingAfterB.filter((p) => p.surface === SURFACE);
    expect(pendingForSurface).toHaveLength(1);
    const approvalId = pendingForSurface[0].id;
    expect(approvalId).toBeTruthy();

    // -----------------------------------------------------------------------
    // (c) re-scan the SAME subject token: same approvalId, still ONE
    // notification (spec §9 row 7) — the dedup path's own distinct wording
    // ("we haven't asked again") is what proves this took the dedup branch
    // rather than pending a second time.
    // -----------------------------------------------------------------------
    const scanC = await h.scan(launchToken);
    expect(scanC.status).toBe('pending_approval');
    expect(h.lastReceiptText()).toMatch(/haven.t asked again/i);
    expect(h.haGatewayCalls).toHaveLength(1);

    const pendingAfterC = await h.donow.approvals.listPending();
    const pendingForSurfaceC = pendingAfterC.filter((p) => p.surface === SURFACE);
    expect(pendingForSurfaceC).toHaveLength(1);
    expect(pendingForSurfaceC[0].id).toBe(approvalId);

    // -----------------------------------------------------------------------
    // (f, mid-journey) the dry-run preview touches neither store while a
    // request is genuinely pending — proof the preview route cannot disturb
    // a real approval in flight.
    // -----------------------------------------------------------------------
    const sessionsBeforePreview = await h.sessionRows();
    const tokensBeforePreview = tokenFiles();
    const pendingBeforePreview = await h.donow.approvals.listPending();
    await h.useCases.previewAgenda.execute({ learnerId: DEFAULT_LEARNER });
    expect(await h.sessionRows()).toHaveLength(sessionsBeforePreview.length);
    expect(tokenFiles()).toHaveLength(tokensBeforePreview.length);
    expect(await h.donow.approvals.listPending()).toHaveLength(pendingBeforePreview.length);

    // -----------------------------------------------------------------------
    // (d) approve, once the garage goes idle: the adapter really dispatches,
    // and the BRIDGE — not this test — closes the session (approved-flag
    // path): launch_dispatched + outcome_recorded{result:passed,
    // reason:launch_dispatched}. The subject then serves today.
    // -----------------------------------------------------------------------
    h.donow.presence.fitness.observe({ event: 'fitness-profile', data: { sessionActive: false } });
    const approved = await h.donow.approvals.approve({ id: approvalId });
    expect(approved.decision).toBe('dispatched');

    // The adapter's own dispatch (garage-fitness's ONLY reachability, spec
    // §5) is part of the awaited approve() chain — no race for this part.
    const fitnessBroadcasts = h.busEvents.filter((e) => e.topic === 'fitness');
    expect(fitnessBroadcasts.at(-1).payload).toMatchObject({
      type: 'fitness.launch', learnerId: DEFAULT_LEARNER, episodeId: 'plex:900',
    });

    // The bridge's own append+honor-close is a DETACHED async effect (see
    // module doc) — poll for it rather than assume it landed by the time
    // approve() resolved. Polling the RAW event log for `outcome_recorded`
    // raced `CloseSessionOutcome`'s own post-outcome appends (reproduced
    // under full-suite load): the event can land before the session is
    // actually settled, so the very next read below could still catch it
    // mid-close. Polling the DERIVED state's own `terminal` flag instead
    // waits for the thing this test actually needs to be true.
    const bridgeSettled = await waitUntil(async () => (await h.sessionState(launchSessionId)).terminal === true);
    expect(bridgeSettled, 'DoNowSchoolBridge never honor-closed the launch session after approval').toBe(true);

    const launchEvents = await h.sessionEvents(launchSessionId);
    expect(launchEvents.map((e) => e.type)).toEqual(expect.arrayContaining(['launch_dispatched', 'outcome_recorded']));
    const outcomeEvent = launchEvents.find((e) => e.type === 'outcome_recorded');
    expect(outcomeEvent).toMatchObject({ result: 'passed', reason: 'launch_dispatched' });
    expect((await h.sessionState(launchSessionId)).terminal).toBe(true);

    // Re-tap: the science subject is done for today, no QR offered for it.
    // (BuildAgenda mints a FRESH subject_next token on every tap — the pe-daily
    // ticket printed here is a different string from `peToken` above, still
    // valid; the OLD `peToken` stays usable too, spec's own "a token a child
    // is already holding should keep meaning something".)
    await h.scanCard();
    expect(h.lastReceiptText()).toMatch(/SCIENCE.*done today/i);
    const offeredD = h.tokensInLastReceipt();
    expect(offeredD.find((o) => /go to the garage/i.test(o.printed))).toBeUndefined();
    // The pe-daily subject is still unserved — its ticket is still offered.
    const peTokenD = offeredD.find((o) => /in the garage/i.test(o.printed))?.token;
    expect(peTokenD, `no pe-daily ticket in ${JSON.stringify(offeredD)}`).toBeTruthy();

    // -----------------------------------------------------------------------
    // (e) scan the pe-daily program subject with the garage now idle:
    // dispatched immediately, the dispatch log row carries the programId,
    // and the very next tap shows the program subject done too.
    // -----------------------------------------------------------------------
    const scanE = await h.scan(peTokenD);
    expect(scanE.status).toBe('launched');

    const peBroadcast = h.busEvents.filter((e) => e.topic === 'fitness').at(-1);
    expect(peBroadcast.payload).toMatchObject({
      type: 'fitness.launch', learnerId: DEFAULT_LEARNER, episodeId: 'plex:901',
    });

    const todayStamp = h.clock.iso().slice(0, 10);
    const dispatchRows = await h.donow.datastore.listDispatches({ dayStamp: todayStamp });
    const peRow = dispatchRows.find((r) => r.programId === PE_PROGRAM_ID);
    expect(peRow, `no pe-daily row in ${JSON.stringify(dispatchRows)}`).toMatchObject({
      surface: SURFACE, learnerId: DEFAULT_LEARNER, requestedBy: 'school-program',
    });

    // Re-tap once more: both subjects now read done for today, no QR for either.
    await h.scanCard();
    const tapFinal = h.lastReceiptText();
    expect(tapFinal).toMatch(/SCIENCE.*done today/i);
    expect(tapFinal).toMatch(/SKILLS.*done today/i);
    const offeredFinal = h.tokensInLastReceipt();
    expect(offeredFinal).toHaveLength(0);

    // The same conclusion via the agenda computation directly — this IS what
    // `SurfaceProgramLauncher.status()` reporting `doneToday: true` looks like
    // from the outside (the real launcher, reading the real dispatch log):
    // `planDailyAgenda` folds that status into `servedToday`/`next` per section.
    const finalAgenda = await h.agenda();
    const skillsAgendaSection = finalAgenda.sections.find((s) => s.subject === 'skills');
    expect(skillsAgendaSection).toMatchObject({ servedToday: true, next: null });
  });
});
