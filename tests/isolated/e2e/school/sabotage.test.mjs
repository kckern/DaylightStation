/**
 * THE TEST OF THE TESTS: can this suite fail?
 *
 * A green suite proves nothing until you know it can go red. Each case below
 * takes a defect this build actually hit (or narrowly avoided), applies it to
 * the REAL module on the REAL code path, and asserts that the assertions which
 * are supposed to catch it do.
 *
 * HOW THE MUTATION IS APPLIED. The module's own source is read, a named edit is
 * made to it, and the result is written as a sibling file which is then swapped
 * in for that specifier. Nothing is stubbed, faked or re-implemented — the graph
 * boots on genuinely mutated production code.
 *
 * THE EDIT MUST STILL MATCH. `patch` requires each `find` to occur EXACTLY once.
 * When the code moves on and a mutation no longer applies, this file fails
 * loudly instead of quietly certifying a defect nobody is injecting any more.
 *
 * EVERY CASE RUNS TWICE. Once clean, to prove the scenario is green without the
 * defect (otherwise "it threw" would prove nothing), and once mutated, to prove
 * it is red with it. A mutation that survives is a hole in the suite and the
 * test says so by name.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, it, expect, vi } from 'vitest';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, '..', '..', '..', '..');

const SCENARIO_TIMEOUT = 90_000;

// ---------------------------------------------------------------------------
// the mutation mechanism
// ---------------------------------------------------------------------------

/**
 * Swap a module for a copy of itself with `edits` applied, for the duration of
 * `run`. The copy is a SIBLING of the original so its relative imports still
 * resolve, and it is deleted whatever happens.
 *
 * @param {object} mutation
 * @param {string} mutation.file - repo-relative path to the real module
 * @param {string} mutation.specifier - how importers name it
 * @param {Array<[string,string]>} mutation.edits - [find, replace], each matching once
 * @param {Function} run
 */
async function withMutation({ file, specifier, edits }, run) {
  const abs = path.join(REPO_ROOT, file);
  const original = fs.readFileSync(abs, 'utf8');
  let patched = original;
  for (const [find, replace] of edits) {
    const hits = patched.split(find).length - 1;
    if (hits !== 1) {
      throw new Error(
        `sabotage: ${file} has ${hits} occurrences of ${JSON.stringify(find)}, expected exactly 1. `
        + 'The code moved; re-aim the mutation rather than deleting it.',
      );
    }
    patched = patched.replace(find, replace);
  }

  const tmp = path.join(path.dirname(abs), `__sabotage_${crypto.randomUUID().slice(0, 8)}__.mjs`);
  fs.writeFileSync(tmp, patched, 'utf8');
  try {
    vi.resetModules();
    vi.doMock(specifier, () => import(pathToFileURL(tmp).href));
    return await run();
  } finally {
    vi.doUnmock(specifier);
    vi.resetModules();
    fs.rmSync(tmp, { force: true });
  }
}

/** Run a scenario against untouched code. Any throw fails this test, as it should. */
async function clean(run) {
  vi.resetModules();
  return run();
}

/**
 * Assert a scenario goes RED. Returns the failure, so a case can also show WHAT
 * broke — naming the symptom is what makes a mutation report readable.
 */
async function goesRed(label, run) {
  let failure = null;
  try {
    await run();
  } catch (err) {
    failure = err;
  }
  expect(
    failure,
    `${label}: THE MUTATION SURVIVED. The suite stayed green with the defect in place — this is a hole.`,
  ).not.toBeNull();
  return failure;
}

// ---------------------------------------------------------------------------
// scenarios, each a copy of the assertions that are supposed to catch the defect
// ---------------------------------------------------------------------------

/** Boot the console fresh (picking up whatever is currently mocked) and drive it. */
async function onTheConsole(body) {
  const lib = await import('#testlib/school/lifecycleHarness.mjs');
  const h = await lib.createLifecycleHarness();
  try {
    await h.assign();
    return await body(h, lib);
  } finally {
    h.dispose();
  }
}

/** lifecycle.e2e scenario 3: a right bubble sheet scores 100. */
const bubbleSheetScenario = () => onTheConsole(async (h, lib) => {
  await h.completeMediaUnit();
  // The v2 agenda mints one ticket per SUBJECT and serves it once per study
  // day (spec §6.3) — all three units here share subject "math", so each
  // unit's ticket only shows up on the card the day after the one before it
  // was passed.
  h.advanceDays(1);
  await h.completeWorksheetUnit();
  h.advanceDays(1);
  await h.scanCard();
  const issued = await h.scanTokenMatching(/print your sheet/i);
  const sessionId = issued.sessionId;

  const bank = lib.fixtureBank('math/math-fractions/03-checkpoint');
  const chosen = await h.correctBubbles({ sessionId, bankId: bank.id });
  const submitted = await h.omrSubmit(chosen, { sessionId });

  // What the reader decoded IS the bank's answer text.
  expect(submitted.scorable).toEqual(Object.fromEntries(bank.items.map((i) => [i.id, i.answer])));
  const graded = await h.grade({ sessionId, entries: submitted.scorable });
  expect(graded.correct).toBe(6);
  expect(graded.percent).toBe(100);
});

/** lifecycle.e2e scenario 4: a failed attempt prints a retry the child can scan. */
const retryTicketScenario = () => onTheConsole(async (h) => {
  await h.completeMediaUnit();
  // Math already served today via unit 01 — unit 02's ticket is due tomorrow.
  h.advanceDays(1);
  await h.scanCard();
  const issued = await h.scanTokenMatching(/print your sheet/i);
  const firstSession = issued.sessionId;

  await h.parentGrades({
    'u2-q1': 'correct', 'u2-q2': 'correct', 'u2-q3': 'correct',
    'u2-q4': 'incorrect', 'u2-q5': 'incorrect', 'u2-q6': 'incorrect',
  }, { sessionId: firstSession });

  const failed = await h.closeOutcome({ sessionId: firstSession });
  expect(failed.result).toBe('needs_remediation');
  expect(failed.printed).toBe(true);
  expect(h.lastReceiptText()).toContain('Almost there');
  const ticket = h.tokensInLastReceipt();
  expect(ticket).toHaveLength(1);
  expect(ticket[0].label).toMatch(/try again/i);

  const retry = await h.scanTokenMatching(/try again/i);
  expect(retry.status).toBe('issued');
});

/** lifecycle.e2e scenario 5: a payout retried after UTC midnight does not pay twice. */
const payOncScenario = () => onTheConsole(async (h) => {
  await h.completeMediaUnit();
  // Math already served today via unit 01 — unit 02's ticket is due tomorrow.
  h.advanceDays(1);
  await h.scanCard();
  const issued = await h.scanTokenMatching(/print your sheet/i);
  await h.parentGrades(
    Object.fromEntries(['u2-q1', 'u2-q2', 'u2-q3', 'u2-q4', 'u2-q5', 'u2-q6'].map((id) => [id, 'correct'])),
    { sessionId: issued.sessionId },
  );
  await h.closeOutcome({ sessionId: issued.sessionId });
  expect(await h.coinsFor()).toBe(5);

  h.advanceDays(1);
  const retried = await h.closeOutcome({ sessionId: issued.sessionId });
  expect(retried.reward.skipReason).toBe('already_rewarded');
  expect(h.economyCalls).toHaveLength(1);
  expect(await h.coinsFor()).toBe(5);
  expect(h.ledgerFor().filter((t) => t.kind === 'earn')).toHaveLength(1);
});

/** codeMap.test: the printed QR is a real symbol, not a reserved box. */
const printedQrScenario = async () => {
  const { createDocumentPdfRenderer } = await import('#rendering/school/documents/DocumentPdfRenderer.mjs');
  const document = {
    id: 'code-doc',
    seed: 1,
    target: ['letter'],
    blocks: [
      { type: 'rich_text', md: 'Do the work, then scan below.' },
      { type: 'scan_action', action: 'recovery', label: 'Scan for another copy' },
    ],
  };
  const out = await createDocumentPdfRenderer({}).render(document, { tokens: { recovery: 'sch:ABC123' } });
  const [code] = out.codeMap;
  expect(code.moduleCount).toBeGreaterThanOrEqual(21);
  // Zero dark modules is an empty box drawn where a code belongs.
  expect(code.darkModules).toBeGreaterThan(code.moduleCount * 2);
};

/** golden.test: every bubble coordinate is pinned exactly, no tolerance. */
const bubbleGeometryScenario = async () => {
  const golden = await import('./../../rendering/school/golden/goldenHarness.mjs');
  const testCase = golden.GOLDEN_CASES.find((c) => c.formMapSnapshot);
  expect(testCase, 'no golden case pins a form map').toBeTruthy();
  const rendered = await golden.renderCase(testCase);
  const expected = golden.compareFormMap(testCase.formMapSnapshot, rendered.formMap);
  expect(rendered.formMap).toEqual(expected);
  expect(rendered.formMap.marks.length).toBeGreaterThan(0);
};

/**
 * optical.test: the INK is where the form map says it is.
 *
 * Deliberately separate from `bubbleGeometryScenario`. That one catches a
 * moved bubble only because a committed snapshot pins the recorded numbers —
 * regenerate the snapshot and the defect is certified. This one measures the
 * printed pixels, so it stays red no matter what any snapshot says.
 */
const opticalBubbleScenario = async () => {
  const golden = await import('./../../rendering/school/golden/goldenHarness.mjs');
  const optics = await import('#testlib/school/opticalHarness.mjs');
  const testCase = golden.GOLDEN_CASES.find((c) => c.formMapSnapshot);
  const rendered = await golden.renderCase(testCase);
  const pageImages = await optics.rasterizeForOptics(rendered.pdf, 'sabotage-optical');
  const { failures } = optics.checkPrintedMarks(pageImages, rendered.formMap);
  // Joined rather than compared as an array: the failure TEXT is what names the
  // defect, and the cases below match on it.
  expect(failures.join('\n')).toBe('');
};

/** optical.test: the printed symbol decodes to the token that was handed over. */
const opticalQrScenario = async () => {
  const golden = await import('./../../rendering/school/golden/goldenHarness.mjs');
  const optics = await import('#testlib/school/opticalHarness.mjs');
  const token = 'sch:9F3KMNPQ2RSTUVWX';
  const document = {
    id: 'sabotage-code-doc',
    seed: 1,
    target: ['letter'],
    blocks: [
      { type: 'rich_text', md: 'Do the work, then scan below.' },
      { type: 'scan_action', action: 'recovery', label: 'Scan for another copy' },
    ],
  };
  const out = await golden.createGoldenRenderer().render(document, { tokens: { recovery: token } });
  const pageImages = await optics.rasterizeForOptics(out.pdf, 'sabotage-qr');
  const symbols = optics.decodePrintedCodes(pageImages).flatMap((d) => d.symbols);
  expect(symbols).toHaveLength(1);
  expect(symbols[0].text).toBe(token);
  expect(symbols[0].text).toBe(out.codeMap[0].text);
};

/** documentValidation.test: an answer key anywhere in a document is refused. */
const answerKeyScenario = async () => {
  const { validateDocument } = await import('#domains/school/documents/documentValidation.mjs');
  const noKey = 'must not carry an answer key (answer keys render from the question bank)';
  const doc = (over) => ({
    id: 'doc', seed: 1, target: ['letter'],
    blocks: [{ type: 'rich_text', md: 'x' }],
    ...over,
  });
  expect(validateDocument(doc({ answer: 'Olympia' })).errors).toContain(`document: ${noKey}`);
  expect(validateDocument(doc({ blocks: [{ type: 'rich_text', md: 'x', answers: ['a'] }] })).errors)
    .toEqual([`blocks[0]: ${noKey}`]);
  expect(validateDocument(doc({
    blocks: [{ type: 'plot', spec: { kind: 'cartesian', hint: { answer: 42 } } }],
  })).errors).toEqual([`blocks[0].spec.hint: ${noKey}`]);
};

// ---------------------------------------------------------------------------
// the mutations
// ---------------------------------------------------------------------------

const OMR_DECODE_RETURNS_THE_LETTER = {
  file: 'backend/src/2_domains/school/documents/omrForm.mjs',
  specifier: '#domains/school/documents/omrForm.mjs',
  edits: [['entries[itemId] = hits[0].label ?? hits[0].choice;', 'entries[itemId] = hits[0].choice;']],
};

const CLOSE_OUT_PRINTS_NOTHING = {
  file: 'backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs',
  specifier: '#apps/school/usecases/CloseSessionOutcome.mjs',
  edits: [[
    "if (!this.#receipts) return { printed: false, printReason: 'not_wired' };",
    "return { printed: false, printReason: 'sabotage' };",
  ]],
};

const QR_LOOP_DRAWS_NOTHING = {
  file: 'backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs',
  specifier: '#rendering/school/documents/DocumentPdfRenderer.mjs',
  edits: [['if (!modules.data[row * modules.size + col]) continue;', 'continue;']],
};

const BUBBLE_CENTRE_IS_OFF_BY_3PT = {
  file: 'backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs',
  specifier: '#rendering/school/documents/DocumentPdfRenderer.mjs',
  edits: [['        xPt: centreX,', '        xPt: centreX + 3,']],
};

const BUBBLE_IS_DRAWN_SMALLER_THAN_RECORDED = {
  file: 'backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs',
  specifier: '#rendering/school/documents/DocumentPdfRenderer.mjs',
  edits: [['.circle(centreX, centreY, bubbleRadiusPt).stroke().restore();', '.circle(centreX, centreY, bubbleRadiusPt - 1).stroke().restore();']],
};

// The symbol prints one payload while `codeMap` reports another. Every existing
// code assertion reads the report, so all of them stay green: the text is
// unchanged, the module count is unchanged, the dark-module count is still
// healthy. Only a decoder pointed at the ink can see it.
const QR_ENCODES_A_DIFFERENT_TOKEN = {
  file: 'backend/src/1_rendering/school/documents/DocumentPdfRenderer.mjs',
  specifier: '#rendering/school/documents/DocumentPdfRenderer.mjs',
  edits: [['QRCode.create(String(text), {', "QRCode.create(`${String(text)}Z`, {"]],
};

// The guard is stated TWICE — an early return in `#applyReward` and the
// `existingRewardTxn` the pure `rewardDecision` is handed. Disabling only the
// first proves nothing: the second still refuses, and the mutation survives.
// Both are the same guard, so both go.
const REWARD_GUARD_IGNORES_THE_TXN = {
  file: 'backend/src/3_applications/school/usecases/CloseSessionOutcome.mjs',
  specifier: '#apps/school/usecases/CloseSessionOutcome.mjs',
  edits: [
    ['    if (state.rewardTxn) {', '    if (false && state.rewardTxn) {'],
    ['      existingRewardTxn: state.rewardTxn,', '      existingRewardTxn: null,'],
  ],
};

const VALIDATOR_ALLOWS_AN_ANSWER_KEY = {
  file: 'backend/src/2_domains/school/documents/documentValidation.mjs',
  specifier: '#domains/school/documents/documentValidation.mjs',
  edits: [[
    "  collectAnswerKeys(raw, '', errors, new WeakSet());",
    '  // sabotage: the answer-key rejection is gone',
  ]],
};

// ---------------------------------------------------------------------------

describe('the suite can fail: nine real defects, injected into production code', () => {
  it('1. OMR decode returns the bubble letter instead of the choice text', async () => {
    await clean(bubbleSheetScenario);
    const failure = await goesRed('omr-decode-returns-letter', () => withMutation(
      OMR_DECODE_RETURNS_THE_LETTER, bubbleSheetScenario,
    ));
    // The 0-of-6 bug, named: the grader is handed the LETTER where the bank
    // holds the answer text.
    expect(String(failure)).toMatch(/'u3-q1': '[A-D]'/);
    expect(String(failure)).toMatch(/'u3-q1': '5\/6'/);
  }, SCENARIO_TIMEOUT);

  it('2. the result receipt is not printed on close-out', async () => {
    await clean(retryTicketScenario);
    await goesRed('close-out-prints-nothing', () => withMutation(
      CLOSE_OUT_PRINTS_NOTHING, retryTicketScenario,
    ));
  }, SCENARIO_TIMEOUT);

  it('3. the QR module loop draws nothing', async () => {
    await clean(printedQrScenario);
    await goesRed('qr-loop-draws-nothing', () => withMutation(
      QR_LOOP_DRAWS_NOTHING, printedQrScenario,
    ));
  }, SCENARIO_TIMEOUT);

  it('4. a bubble\'s recorded centre is offset 3pt from where it is drawn', async () => {
    await clean(bubbleGeometryScenario);
    await goesRed('bubble-centre-off-by-3pt', () => withMutation(
      BUBBLE_CENTRE_IS_OFF_BY_3PT, bubbleGeometryScenario,
    ));
  }, SCENARIO_TIMEOUT);

  it('4b. the same 3pt offset, caught by measuring the printed ink', async () => {
    await clean(opticalBubbleScenario);
    const failure = await goesRed('bubble-centre-off-by-3pt (optical)', () => withMutation(
      BUBBLE_CENTRE_IS_OFF_BY_3PT, opticalBubbleScenario,
    ));
    // Named, so a pass here cannot come from some unrelated explosion.
    expect(String(failure)).toMatch(/recorded centre/);
  }, SCENARIO_TIMEOUT);

  it('4c. bubbles are drawn 1pt smaller than the radius recorded for them', async () => {
    await clean(opticalBubbleScenario);
    const failure = await goesRed('bubble-radius-shrunk', () => withMutation(
      BUBBLE_IS_DRAWN_SMALLER_THAN_RECORDED, opticalBubbleScenario,
    ));
    expect(String(failure)).toMatch(/recorded radius/);
  }, SCENARIO_TIMEOUT);

  it('3b. the QR encodes a different token than the one reported', async () => {
    await clean(opticalQrScenario);
    const failure = await goesRed('qr-encodes-a-different-token', () => withMutation(
      QR_ENCODES_A_DIFFERENT_TOKEN, opticalQrScenario,
    ));
    expect(String(failure)).toMatch(/sch:9F3KMNPQ2RSTUVWXZ/);
  }, SCENARIO_TIMEOUT);

  it('5. the reward guard ignores an existing rewardTxn', async () => {
    await clean(payOncScenario);
    await goesRed('reward-guard-ignores-txn', () => withMutation(
      REWARD_GUARD_IGNORES_THE_TXN, payOncScenario,
    ));
  }, SCENARIO_TIMEOUT);

  it('6. validateDocument drops the answer-key rejection', async () => {
    await clean(answerKeyScenario);
    await goesRed('validator-allows-answer-key', () => withMutation(
      VALIDATOR_ALLOWS_AN_ANSWER_KEY, answerKeyScenario,
    ));
  }, SCENARIO_TIMEOUT);
});
