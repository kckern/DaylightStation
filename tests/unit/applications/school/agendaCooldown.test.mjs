/**
 * Agenda print cooldown (Slice G, 2026-08-22-omr-grading-integrity).
 *
 * THE BUG: a child tapping their NFC card repeatedly got a fresh "Nothing is
 * assigned right now" slip on every single tap — real logs show Soren
 * printing four times in under five minutes, Alan twice in two. Nothing
 * deduplicated a REPEAT print of the SAME agenda the way `IssueDocument`
 * already deduplicates a repeat print of the same worksheet
 * (`IssueDocument.printDebounce.test.mjs`).
 *
 * THE FIX: `ResolvePersonalCard` now checks a per-learner "last printed"
 * record before printing. Five rules, two of them load-bearing enough to get
 * their own test below:
 *   - keyed on learnerId, never card UID (one child, however many cards)
 *   - persisted (a restart must not reopen the floodgate)
 *   - a suppressed tap is still ACKNOWLEDGED (`printed:false` + a message —
 *     never nothing; the broadcast half of this lives in
 *     `nfcTapIngress.test.mjs`, this suite only proves the use case's own
 *     return shape)
 *   - changed agenda content BYPASSES the window entirely
 *   - `school.card.agenda-suppressed` logs `{learnerId, sinceMinutes, cooldownMinutes}`
 */
import { describe, it, expect, vi } from 'vitest';
import { ResolvePersonalCard } from '#apps/school/usecases/ResolvePersonalCard.mjs';

function fakeClock(startIso = '2026-08-22T15:02:33.000Z') {
  let ms = Date.parse(startIso);
  return {
    now: () => new Date(ms),
    advanceMinutes(mins) { ms += mins * 60_000; },
  };
}

function fakeReceipts() {
  const jobs = [];
  return {
    jobs,
    async print(document) {
      jobs.push(document);
      return { printed: true };
    },
  };
}

/** In-memory double for IAgendaCooldownStore — one record per learnerId. */
function fakeCooldownStore(backing = new Map()) {
  return {
    records: backing,
    async get(learnerId) { return backing.get(learnerId) ?? null; },
    async put(record) { backing.set(record.learnerId, record); return record; },
  };
}

/** A one-offer agenda, exactly what BuildAgenda would hand ResolvePersonalCard. */
function agendaFixture(unitId = 'math-lesson-1') {
  return {
    offers: [
      {
        subject: 'math', unitId, sessionId: 'ses_1', tokenClass: 'subject_next',
        // A fresh token every build, on purpose — BuildAgenda really does mint
        // one per call regardless of whether the work is the same, and the
        // cooldown must not be fooled by that into thinking content changed.
        token: `tok_${Math.random().toString(36).slice(2)}`,
        label: 'Fractions, lesson 1 — start it',
      },
    ],
    createdSessions: [],
    document: { id: 'agenda-doc', target: ['receipt'], generatedAt: new Date().toISOString() },
  };
}

function fakeBuildAgenda(fixtureFn) {
  return { execute: vi.fn(async ({ learnerId }) => ({ learnerId, ...fixtureFn() })) };
}

describe('ResolvePersonalCard — agenda print cooldown (Slice G)', () => {
  it('prints the first tap and arms the cooldown', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown, cooldownMinutes: 15, clock: clock.now,
    });

    const result = await card.execute({ learnerId: 'soren' });

    expect(result.status).toBe('agenda_printed');
    expect(result.printed).toBe(true);
    expect(receipts.jobs).toHaveLength(1);
    expect(cooldown.records.get('soren')).toMatchObject({ learnerId: 'soren' });
  });

  it('suppresses a second tap inside the window with IDENTICAL content — but still acknowledges it', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown, cooldownMinutes: 15, clock: clock.now,
    });

    await card.execute({ learnerId: 'soren' }); // 15:02:33
    clock.advanceMinutes(1.5); // 15:04:00 — matches the real Soren log gap
    const second = await card.execute({ learnerId: 'soren' });

    expect(second.status).toBe('agenda_suppressed');
    expect(second.printed).toBe(false);
    // Rule 3: never nothing. A real message, and the offers still ride along
    // so a caller CAN show "here's what's next" even without paper.
    expect(second.message).toMatch(/already have/i);
    expect(second.offers).toHaveLength(1);
    expect(second.sinceMinutes).toBe(1);
    expect(second.cooldownMinutes).toBe(15);
    expect(receipts.jobs).toHaveLength(1); // no second print reached the printer
  });

  it('does not print a THIRD identical tap either, matching the real four-taps-in-five-minutes log', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown, cooldownMinutes: 15, clock: clock.now,
    });

    await card.execute({ learnerId: 'soren' }); // 15:02:33
    clock.advanceMinutes(1.45); // 15:04:00
    await card.execute({ learnerId: 'soren' });
    clock.advanceMinutes(1.48); // 15:05:29
    const third = await card.execute({ learnerId: 'soren' });

    expect(third.status).toBe('agenda_suppressed');
    expect(receipts.jobs).toHaveLength(1);
  });

  it('prints again once the cooldown window has elapsed', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown, cooldownMinutes: 15, clock: clock.now,
    });

    await card.execute({ learnerId: 'soren' });
    clock.advanceMinutes(16);
    const outside = await card.execute({ learnerId: 'soren' });

    expect(outside.status).toBe('agenda_printed');
    expect(receipts.jobs).toHaveLength(2);
  });

  it('bypasses the cooldown when the agenda content has CHANGED — even seconds later (Rule 4)', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    let unitId = 'math-lesson-1';
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(() => agendaFixture(unitId)), receipts, cooldown, cooldownMinutes: 15, clock: clock.now,
    });

    await card.execute({ learnerId: 'soren' });
    unitId = 'math-lesson-2'; // finished lesson 1 between taps; genuinely new work
    clock.advanceMinutes(1);
    const second = await card.execute({ learnerId: 'soren' });

    expect(second.status).toBe('agenda_printed');
    expect(receipts.jobs).toHaveLength(2);
  });

  it('a THIRD tap with the (again) unchanged new content is suppressed like any other repeat', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    let unitId = 'math-lesson-1';
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(() => agendaFixture(unitId)), receipts, cooldown, cooldownMinutes: 15, clock: clock.now,
    });

    await card.execute({ learnerId: 'soren' });
    unitId = 'math-lesson-2';
    clock.advanceMinutes(1);
    await card.execute({ learnerId: 'soren' }); // bypass, prints lesson 2
    clock.advanceMinutes(1);
    const third = await card.execute({ learnerId: 'soren' }); // same lesson 2 again

    expect(third.status).toBe('agenda_suppressed');
    expect(receipts.jobs).toHaveLength(2);
  });

  it('cooldownMinutes: 0 disables the cooldown entirely', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown, cooldownMinutes: 0, clock: clock.now,
    });

    await card.execute({ learnerId: 'soren' });
    clock.advanceMinutes(1);
    const second = await card.execute({ learnerId: 'soren' });

    expect(second.status).toBe('agenda_printed');
    expect(receipts.jobs).toHaveLength(2);
  });

  it('defaults to 15 minutes when cooldownMinutes is not configured', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown, clock: clock.now,
    });

    await card.execute({ learnerId: 'soren' });
    clock.advanceMinutes(10);
    const stillInside = await card.execute({ learnerId: 'soren' });
    expect(stillInside.status).toBe('agenda_suppressed');

    clock.advanceMinutes(6); // total 16 minutes
    const outside = await card.execute({ learnerId: 'soren' });
    expect(outside.status).toBe('agenda_printed');
  });

  it('rejects a malformed cooldownMinutes at construction rather than misbehaving at scan time', () => {
    const buildAgenda = fakeBuildAgenda(agendaFixture);
    const receipts = fakeReceipts();
    expect(() => new ResolvePersonalCard({ buildAgenda, receipts, cooldownMinutes: -1 })).toThrow();
    expect(() => new ResolvePersonalCard({ buildAgenda, receipts, cooldownMinutes: NaN })).toThrow();
  });

  it('keys the cooldown on learnerId — a sibling is never suppressed by another child’s print', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown, cooldownMinutes: 15, clock: clock.now,
    });

    await card.execute({ learnerId: 'soren' });
    clock.advanceMinutes(1);
    const alan = await card.execute({ learnerId: 'alan' });

    expect(alan.status).toBe('agenda_printed');
  });

  it('does not arm the cooldown when the printer refuses — a failed print must not silence the retry', async () => {
    const clock = fakeClock();
    const cooldown = fakeCooldownStore();
    const receipts = { print: vi.fn(async () => ({ printed: false })) };
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown, cooldownMinutes: 15, clock: clock.now,
    });

    const result = await card.execute({ learnerId: 'soren' });

    expect(result.status).toBe('print_failed');
    expect(cooldown.records.get('soren')).toBeUndefined();
  });

  it('logs school.card.agenda-suppressed with {learnerId, sinceMinutes, cooldownMinutes}', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const cooldown = fakeCooldownStore();
    const logger = {
      info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(),
    };
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown, cooldownMinutes: 15, clock: clock.now, logger,
    });

    await card.execute({ learnerId: 'soren' });
    clock.advanceMinutes(3);
    await card.execute({ learnerId: 'soren' });

    expect(logger.info).toHaveBeenCalledWith('school.card.agenda-suppressed', {
      learnerId: 'soren', sinceMinutes: 3, cooldownMinutes: 15,
    });
  });

  it('persists across a restart: a fresh ResolvePersonalCard reading the same backing store still suppresses', async () => {
    // Simulates a container restart: a brand-new ResolvePersonalCard instance
    // (fresh in-memory state) reading a cooldown store backed by the SAME
    // durable data — proving persistence isn't process-lifetime only.
    const backing = new Map();
    const clock = fakeClock();
    const receipts = fakeReceipts();

    const beforeRestart = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown: fakeCooldownStore(backing), cooldownMinutes: 15, clock: clock.now,
    });
    await beforeRestart.execute({ learnerId: 'soren' });

    clock.advanceMinutes(2);
    const afterRestart = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldown: fakeCooldownStore(backing), cooldownMinutes: 15, clock: clock.now,
    });
    const result = await afterRestart.execute({ learnerId: 'soren' });

    expect(result.status).toBe('agenda_suppressed');
  });

  it('with no cooldown store wired, behaves exactly as before the feature existed', async () => {
    const clock = fakeClock();
    const receipts = fakeReceipts();
    const card = new ResolvePersonalCard({
      buildAgenda: fakeBuildAgenda(agendaFixture), receipts, cooldownMinutes: 15, clock: clock.now,
    });

    await card.execute({ learnerId: 'soren' });
    clock.advanceMinutes(1);
    const second = await card.execute({ learnerId: 'soren' });

    expect(second.status).toBe('agenda_printed');
    expect(receipts.jobs).toHaveLength(2);
  });
});
