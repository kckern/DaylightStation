/**
 * The v2 sectioned agenda, end to end, math AND language together — the
 * closing proof of the school-agenda-v2 plan (Task 14).
 *
 * Every other School e2e scenario (`lifecycle.e2e.test.mjs`) drives ONE
 * subject at a time. This is the one place the whole point of v2 is checked
 * in a single continuous journey against the REAL production composition:
 * two subjects on one card, the daily serving that quiets a subject once it
 * is done, a STALE per-subject ticket that stays safe rather than
 * double-crediting or double-dispatching, a program unit that hands off to
 * the Portal instead of opening a work session, and a golden-snapshot check
 * of the ESC/POS item stream the console derives from the same tap's document
 * (the golden tape) — no longer literally what reaches paper (that is a
 * raster PNG now, `DocumentReceiptRasterRenderer`), but exactly what the
 * printed receipt's operator transcript is built from, and what would print
 * instead if rasterizing ever failed.
 *
 * PLACEMENT: `tests/isolated/e2e/school/`, not `application/school/`. The
 * journey needs the full production graph — `createSchoolLifecycle`, real
 * virtual hardware, the real event bus — that `lifecycleHarness.mjs` already
 * boots and that `lifecycle.e2e.test.mjs` already exercises for math alone.
 * Reassembling that graph by hand from fakes in `application/school/` would
 * duplicate the harness rather than reuse it; extending the harness (one
 * optional `languageStudyService` parameter, forwarded to the composition
 * exactly as `app.mjs` would) is the smaller, truer change.
 *
 * @see tests/_lib/school/lifecycleHarness.mjs
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  createLifecycleHarness, fixtureBank,
  MEDIA_UNIT, COURSE_ID, DEFAULT_LEARNER,
} from '#testlib/school/lifecycleHarness.mjs';
import { LanguageStudyService } from '#apps/school/LanguageStudyService.mjs';
import { createDocumentEscPosRenderer } from '#rendering/school/documents/DocumentEscPosRenderer.mjs';
import { VirtualThermalPrinterAdapter } from '#adapters/hardware/thermal-printer/VirtualThermalPrinterAdapter.mjs';

const silent = { info() {}, warn() {}, error() {}, debug() {} };
const LANGUAGE_UNIT = 'language-daily';

/**
 * A language program nobody has ever touched: `listCorpusIds()` empty means
 * `LanguageStudyService.todayStatus` takes its "never touched any course"
 * branch and returns the null triple (`doneToday:false, progressLabel:null,
 * score:null`) — see `programLaunchers.test.mjs`'s equivalent case. That
 * keeps `language` a live, unserved section for the whole journey without
 * standing up a real corpus/progress fixture this test does not need.
 */
function neverTouchedLanguageService() {
  return new LanguageStudyService({ datastore: { listCorpusIds: () => [] }, logger: silent });
}

let h;

beforeEach(async () => {
  h = await createLifecycleHarness({ languageStudyService: neverTouchedLanguageService() });
  // A math course (the committed fixture) plus the seeded standalone program
  // unit — one learner, two subjects, on one card.
  await h.assign({ courses: [COURSE_ID], units: [LANGUAGE_UNIT] });
});
afterEach(() => { h?.dispose(); });

describe('the v2 agenda — math and language together, one card', () => {
  it('sections by subject, serves once a day, keeps a stale ticket safe, and hands language to the Portal', async () => {
    // -------------------------------------------------------------------
    // (a) tap: a sectioned agenda, two subjects, two tickets
    // -------------------------------------------------------------------
    await h.scanCard();
    const tapA = h.lastReceiptText();
    // Both subjects are on the card, identified by each lesson card's own
    // taxonomy breadcrumb (Course/Unit/Lesson) rather than by an uppercase
    // subject heading above it. The breadcrumb replaced that heading for
    // tokened cards — see the eyebrow note in receipts.mjs: the breadcrumb is
    // the line that says WHERE in the curriculum the lesson sits, and a
    // heading repeating its first word cost a row for nothing.
    expect(tapA).toContain('math-fractions');
    expect(tapA).toContain("Language — today's sentences");

    // The same computation the tap just printed, captured for the golden
    // tape in (f) below — before anything about math or language changes.
    const agendaA = await h.agenda();
    expect(agendaA.sections.map((s) => s.subject)).toEqual(['math', 'language']);

    const offeredA = h.tokensInLastReceipt();
    expect(offeredA).toHaveLength(2);
    // The action a code belongs to is the whole lesson card printed above it
    // (hierarchy + footer instruction), not the code's own label — the label
    // is just the lesson title. `printed` is that card's tape.
    const staleMathToken = offeredA.find((o) => /watch or listen/i.test(o.printed))?.token;
    const languageToken = offeredA.find((o) => /on the portal/i.test(o.printed))?.token;
    expect(staleMathToken, `no math ticket in ${JSON.stringify(offeredA)}`).toBeTruthy();
    expect(languageToken, `no language ticket in ${JSON.stringify(offeredA)}`).toBeTruthy();

    // -------------------------------------------------------------------
    // (b) scan the math ticket: the fixture's unit 01 is a media unit
    // -------------------------------------------------------------------
    const started = await h.scanTokenMatching(/watch or listen/i);
    expect(started.status).toBe('dispatched');
    expect(h.devices.playback.listDispatches()).toHaveLength(1);

    // -------------------------------------------------------------------
    // (c) record a PASSING outcome today, then tap again
    // -------------------------------------------------------------------
    await h.playToEnd();
    const sessionId = await h.sessionIdFor(MEDIA_UNIT);
    const bank = fixtureBank('math/math-fractions/01-quiz');
    const entries = {};
    for (const item of bank.items) {
      entries[item.id] = item.type === 'matching' ? item.pairs.map((p) => ({ ...p })) : item.answer;
    }
    await h.handIn({ sessionId, entries, submittedBy: DEFAULT_LEARNER });
    const graded = await h.grade({ sessionId, entries });
    expect(graded.percent).toBe(100);
    const settled = await h.closeOutcome({ sessionId });
    expect(settled.result).toBe('passed');

    await h.scanCard();
    const tapC = h.lastReceiptText();
    expect(tapC).toMatch(/MATH.*done today/i);
    const offeredC = h.tokensInLastReceipt();
    expect(offeredC).toHaveLength(1); // ONE token: math served, language is not
    expect(offeredC[0].printed).toMatch(/on the portal/i);

    // -------------------------------------------------------------------
    // (d) the STALE math ticket from (a): yesterday's paper stays safe
    // -------------------------------------------------------------------
    const staleScan = await h.scan(staleMathToken);
    expect(staleScan.status).toBe('served_today');
    expect(staleScan.printed).toBe(true);
    expect(h.lastReceiptText()).toMatch(/done for today/i);
    expect(h.lastReceiptText()).toMatch(/scan your card tomorrow/i);
    // Scanning the stale ticket moved nothing: one open session, no second
    // outcome. (Unit 01 in the fixture carries no `reward:` block at all —
    // the coin count this proves stable is 0, not 5.)
    expect(await h.coinsFor()).toBe(0);
    expect((await h.sessionRows()).filter((r) => r.unitId === MEDIA_UNIT)).toHaveLength(1);

    // -------------------------------------------------------------------
    // (e) the language ticket hands off to the Portal, and prints a slip
    // -------------------------------------------------------------------
    const busBefore = h.busEvents.length;
    const langScan = await h.scan(languageToken);
    expect(langScan.status).toBe('launched');
    expect(langScan.printed).toBe(true);
    expect(h.lastReceiptText()).toMatch(/portal/i);

    const schoolEvents = h.busEvents.slice(busBefore).filter((e) => e.topic === 'school');
    expect(schoolEvents).toHaveLength(1);
    expect(schoolEvents[0].payload).toEqual({
      type: 'school.launch',
      learnerId: DEFAULT_LEARNER,
      target: {
        kind: 'program', program: 'sentence-ladder', corpusId: 'glossika-korean',
        studyGrant: expect.any(String),
      },
    });
    // No work session was ever opened for the program unit (spec §4.4).
    expect((await h.sessionRows()).some((r) => r.unitId === LANGUAGE_UNIT)).toBe(false);

    // -------------------------------------------------------------------
    // (f) golden tape: the ESC/POS item stream the console's transcript/
    // fallback renderer derives from tap (a)'s own document. What actually
    // reached the (virtual) printer for tap (a) is a raster image job —
    // asserted on via `h.lastReceiptText()`/`h.tokensInLastReceipt()`
    // elsewhere in this suite, which read the SAME words/codes this stream
    // carries, just sourced from the raster job's `transcript`/`codes`
    // fields instead of printable items.
    // -------------------------------------------------------------------
    const renderer = createDocumentEscPosRenderer({ symbology: 'QR' });
    const job = renderer.render(agendaA.document);

    const captureDir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-golden-tape-'));
    try {
      const printer = new VirtualThermalPrinterAdapter({ captureDir }, { logger: silent });
      expect(await printer.print(job)).toBe(true);

      // The standard header is always item zero: the learner's name inverted
      // (white on black), centred, double-size — never a literal markdown `#`.
      const banner = job.items[0];
      expect(banner).toMatchObject({
        type: 'text', align: 'center', size: { width: 2, height: 2 }, style: { invert: true },
      });
      expect(banner.content).not.toMatch(/^#/);
      expect(banner.content).toContain('TEST LEARNER');

      // MATH prints before LANGUAGE (the subject-wall order, spec §6.2).
      //
      // A LIVE section no longer carries a header at all. It used to be the
      // lesson card's eyebrow (`TODAY · {subject}`) — dropped because the
      // renderer truncates at the first `·`, so every card printed the single
      // word "TODAY". Each card's own taxonomy breadcrumb is what says where
      // the work sits now, so that is the anchor for section order.
      const mathHeaderIndex = job.items.findIndex((i) => i.type === 'text' && /math-fractions/.test(i.content || ''));
      const languageHeaderIndex = job.items.findIndex((i) => i.type === 'text' && /Language — today's sentences/.test(i.content || ''));
      expect(mathHeaderIndex).toBeGreaterThan(0);
      expect(languageHeaderIndex).toBeGreaterThan(mathHeaderIndex);

      // Exactly one QR per LIVE subject — never a section without a scan
      // action offered, never more than one per subject.
      const qrIndexes = job.items
        .map((item, index) => ({ item, index }))
        .filter(({ item }) => item.type === 'qrcode')
        .map(({ index }) => index);
      expect(qrIndexes).toHaveLength(2);
      expect(qrIndexes[0]).toBeGreaterThan(mathHeaderIndex);
      expect(qrIndexes[0]).toBeLessThan(languageHeaderIndex);
      expect(qrIndexes[1]).toBeGreaterThan(languageHeaderIndex);
      // Each QR is immediately preceded by its own label line (the printed
      // convention every scannable action follows, barcode or QR alike).
      for (const qrIndex of qrIndexes) expect(job.items[qrIndex - 1].type).toBe('text');
      // No barcode item at all — this console prints QR only (Task 12).
      expect(job.items.some((i) => i.type === 'barcode')).toBe(false);

      // Footer: the closing rule is the very last item; the job auto-cuts.
      expect(job.items.at(-1)).toMatchObject({ type: 'line' });
      expect(job.footer).toMatchObject({ autoCut: true });

      // And it really did reach the (virtual) printer with a readable
      // transcript and two real, scannable codes — not an empty box.
      const transcript = printer.lastTranscript();
      expect(transcript).toContain('TEST LEARNER');
      expect(transcript).toMatch(/sch:/);
      expect(printer.listReceipts()).toHaveLength(1);
    } finally {
      fs.rmSync(captureDir, { recursive: true, force: true });
    }
  });
});
