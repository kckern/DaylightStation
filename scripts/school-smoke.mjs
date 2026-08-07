#!/usr/bin/env node
/**
 * `npm run school:smoke` — does the whole School console still work?
 *
 * Boots the full lifecycle graph on a temp data dir with the virtual devices,
 * walks one child through the first unit end to end, and prints a PASS/FAIL
 * line per step. Exits non-zero on the first thing that is not true.
 *
 * It deliberately checks ARTIFACTS, not return values: what the receipt says,
 * what reached the paper tray, what is on the event log and in the ledger. A
 * step that "succeeded" while printing paper a child cannot act on is a failure
 * here, which is the whole reason this script exists.
 *
 * Usage:
 *   npm run school:smoke
 *   npm run school:smoke -- --verbose   # also dump every receipt transcript
 */
import { createLifecycleHarness, fixtureBank, MEDIA_UNIT, WORKSHEET_UNIT } from '../tests/_lib/school/lifecycleHarness.mjs';

const VERBOSE = process.argv.includes('--verbose');

const results = [];
let harness = null;

function check(label, condition, detail = '') {
  const ok = Boolean(condition);
  results.push({ label, ok, detail });
  process.stdout.write(`${ok ? '  PASS' : '  FAIL'}  ${label}${detail ? `  — ${detail}` : ''}\n`);
  return ok;
}

function fail(label, detail) { return check(label, false, detail); }

async function main() {
  process.stdout.write('\nSchool console smoke test — scenario 1, the video unit\n');
  process.stdout.write(`${'='.repeat(62)}\n`);

  harness = await createLifecycleHarness();
  check('the lifecycle graph boots on a temp data dir', true, harness.dataDir);

  await harness.assign();

  // --- 1. the card prints a list ------------------------------------------
  const card = await harness.scanCard();
  check('scanning the card prints an agenda', card.status === 'agenda_printed' && card.printed, card.status);
  const agenda = harness.lastReceiptText() ?? '';
  if (VERBOSE) process.stdout.write(`\n--- agenda ---\n${agenda}\n\n`);
  // The masthead is the resolved learner name rendered as an inverted banner,
  // which the renderer prints in caps (see receipts.mjs: title = learnerName
  // || 'Hello!' — never the raw id; DocumentEscPosRenderer uppercases title
  // text for the banner).
  check('the agenda names the learner and the unit',
    agenda.includes('TEST LEARNER') && agenda.includes('Equivalent Fractions'),
    agenda.split('\n')[0]);

  const offers = harness.tokensInLastReceipt();
  check('the agenda carries exactly one scannable action', offers.length === 1,
    offers.map((o) => o.label).join(' | '));
  check('the printed action is an opaque token', /^sch:[2-9A-HJ-NP-Z]{16}$/.test(offers[0]?.token ?? ''),
    offers[0]?.token);

  // --- 2. scanning it starts the media -------------------------------------
  const started = await harness.scanTokenMatching(/watch or listen/i);
  check('scanning the action dispatches the video', started.status === 'dispatched', started.message);
  check('it went to a child-selectable target', started.effect?.target === 'school-screen', started.effect?.target);
  check('exactly one dispatch was made', harness.devices.playback.listDispatches().length === 1);
  const startedReceipt = harness.lastReceiptText() ?? '';
  if (VERBOSE) process.stdout.write(`\n--- start receipt ---\n${startedReceipt}\n\n`);
  check('the child is told what to do when it ends', /scan your card/i.test(startedReceipt));

  const sessionId = started.sessionId;

  // --- 3. only finishing releases the questions ----------------------------
  const midState = await harness.sessionState(sessionId);
  check('starting is not finishing', midState.state === 'media_dispatched', midState.state);

  const completed = await harness.playToEnd();
  check('playing to the end records completion', completed.status === 'completed', completed.message);
  const afterMedia = await harness.sessionState(sessionId);
  check('the session advanced to media_completed', afterMedia.state === 'media_completed', afterMedia.state);

  // --- 4. the quiz, through the one grading engine -------------------------
  // Path-form bank id since the 2026-07-30 curriculum restructure — see
  // tests/_fixtures/school/curriculum/banks/math-fractions-01-quiz.yml `id:`.
  const bank = fixtureBank('math/math-fractions/01-quiz');
  const entries = {};
  for (const item of bank.items) {
    entries[item.id] = item.type === 'matching' ? item.pairs.map((p) => ({ ...p })) : item.answer;
  }
  const handedIn = await harness.handIn({ sessionId, entries, submittedBy: harness.learnerId });
  check('the answers are taken in', handedIn.status === 'submitted', handedIn.message);
  check('nothing needed a grown-up', handedIn.review.length === 0, `${handedIn.review.length} for review`);

  const graded = await harness.grade({ sessionId, entries });
  check('a right sheet scores 100', graded.status === 'graded' && graded.percent === 100,
    `${graded.status} ${graded.percent}%`);
  const attempts = harness.attemptsFor();
  check('every answer landed in the attempt log as real evidence',
    attempts.length === bank.items.length && attempts.every((a) => a.correct === true),
    `${attempts.length} attempts`);

  // --- 5. the result receipt ------------------------------------------------
  const settled = await harness.closeOutcome({ sessionId });
  check('the outcome settles as a pass', settled.status === 'settled' && settled.result === 'passed',
    `${settled.status}/${settled.result}`);
  const receipt = harness.lastReceiptText() ?? '';
  if (VERBOSE) process.stdout.write(`\n--- result receipt ---\n${receipt}\n\n`);
  check('the receipt reports the score', receipt.includes('Score: 100%'));
  check('the receipt names what this opened up',
    receipt.includes('Next up: Adding and Subtracting Unlike Denominators'));

  // --- 6. the next unit is really open -------------------------------------
  const plan = await harness.plan();
  const unit01 = plan.entries.find((e) => e.unitId === MEDIA_UNIT);
  const unit02 = plan.entries.find((e) => e.unitId === WORKSHEET_UNIT);
  check('unit 01 is completed', unit01?.status === 'completed', unit01?.status);
  check('unit 02 is no longer locked', unit02?.status === 'available', unit02?.status);

  // MATH already served today (a passing outcome just now) — the agenda
  // caps a subject at one scannable action per study day and prints
  // "done today" instead (spec §6.2 v2, docs/reference/school/README.md
  // "at most one scannable action"). Rescanning the SAME day proves that
  // cap, not a bug in unlocking; cross the 4am study-day boundary to see
  // unit 02 actually offered.
  await harness.scanCard();
  const sameDayAgenda = harness.lastReceiptText() ?? '';
  if (VERBOSE) process.stdout.write(`\n--- same-day agenda ---\n${sameDayAgenda}\n\n`);
  check('MATH is marked done for today, not re-offered', /MATH.*done today/i.test(sameDayAgenda));

  harness.advanceDays(1);
  await harness.scanCard();
  const nextAgenda = harness.lastReceiptText() ?? '';
  if (VERBOSE) process.stdout.write(`\n--- next-day agenda ---\n${nextAgenda}\n\n`);
  check('the next-day agenda offers unit 02 as a scannable line',
    nextAgenda.includes('Adding and Subtracting Unlike Denominators — print your sheet')
    && harness.tokensInLastReceipt().length === 1);

  // --- 7. the event log is the durable record ------------------------------
  const events = await harness.eventTypes(sessionId);
  const expected = ['created', 'media_dispatched', 'media_completed', 'submitted', 'graded', 'outcome_recorded', 'rewarded'];
  check('the whole journey is on an append-only log',
    JSON.stringify(events) === JSON.stringify(expected), events.join(' → '));
}

try {
  await main();
} catch (err) {
  fail('the run reached the end', err?.stack?.split('\n').slice(0, 3).join(' / ') ?? String(err));
} finally {
  harness?.dispose();
}

const failed = results.filter((r) => !r.ok);
process.stdout.write(`${'='.repeat(62)}\n`);
process.stdout.write(`${results.length - failed.length}/${results.length} checks passed\n`);
if (failed.length) {
  process.stdout.write(`\nFAIL — the School console cannot take a child through a unit:\n`);
  failed.forEach((f) => process.stdout.write(`  • ${f.label}${f.detail ? `  (${f.detail})` : ''}\n`));
  process.stdout.write('\n');
  process.exit(1);
}
process.stdout.write('\nPASS — a child can do a piece of schoolwork end to end.\n\n');
process.exit(0);
