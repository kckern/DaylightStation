/**
 * Slice H (2026-08-22) — every printed QR is bound to its own keypad code, or
 * says explicitly that scanning is the only way in. Two real defects sat
 * under Felix's single-offer slip looking right:
 *
 *   1. `resultDocument` never threaded a code to the "next up" QR at all —
 *      Milo's receipt carried `sch:XAXYT6X849DUPEVX` under "Scan to print
 *      the next worksheet" with nothing typeable beneath it.
 *   2. Codes used to be keyed by SUBJECT while QRs are minted per TOKEN, so
 *      two tokened offers sharing a subject could never both get a code.
 *
 * These tests assert the INVARIANT — every scannable block carries an
 * explanation of how to act on it — not the exact layout. A wording tweak
 * must not break them; a codeless QR must.
 */
import { describe, it, expect } from 'vitest';
import { agendaDocument, resultDocument } from '#domains/school/documents/receipts.mjs';

const QR_TYPES = /scan_action|lesson_action/g;
const PANEL_CODE = /PANEL CODE/g;
const SCAN_ONLY = /Scanning is the only way in\./g;

const countOf = (re, flat) => (flat.match(re) || []).length;

/**
 * Every scannable block must be immediately explained: either a panel code
 * beside it, or an explicit acknowledgement that scanning is the only way
 * in. A block that claims no code at all (the `accessCode` argument omitted
 * entirely — legacy behaviour, unrelated to self-service) is exempt, since
 * it never made a claim to break.
 */
function assertEveryQrIsExplained(blocks, { expectCount } = {}) {
  const flat = JSON.stringify(blocks);
  const qrCount = countOf(QR_TYPES, flat);
  const explained = countOf(PANEL_CODE, flat) + countOf(SCAN_ONLY, flat);
  if (Number.isInteger(expectCount)) expect(qrCount).toBe(expectCount);
  expect(explained).toBe(qrCount);
}

describe('QR / panel-code pairing (Slice H, regression: Milo, 2026-08-22)', () => {
  it('pairs a result receipt\'s "next up" QR with its own code', () => {
    const r = resultDocument({
      sessionId: 'ses_x',
      unitTitle: 'The United States',
      result: 'passed',
      percent: 100,
      actions: [{
        token: 'sch:XAXYT6X849DUPEVX',
        label: 'Scan to print the next worksheet',
        presentation: 'lesson',
        accessCode: '123456',
      }],
    });
    assertEveryQrIsExplained(r.blocks, { expectCount: 1 });
    const flat = JSON.stringify(r.blocks);
    expect(flat).toContain('PANEL CODE 123456');
    // QR-then-code, never the reverse.
    expect(flat.indexOf('scan_action')).toBeLessThan(flat.indexOf('PANEL CODE 123456'));
  });

  it('prints an explicit "scanning only" line rather than a silent gap when no code could be minted', () => {
    // This is exactly Milo's receipt: a lesson-presentation QR whose caller
    // checked (accessCode: null, not omitted) and found no code available —
    // self-service off, or a token class (like `remediation`) that can
    // never carry one.
    const r = resultDocument({
      sessionId: 'ses_milo',
      unitTitle: 'The United States',
      result: 'passed',
      percent: 100,
      actions: [{
        token: 'sch:XAXYT6X849DUPEVX',
        label: 'Scan to print the next worksheet',
        presentation: 'lesson',
        accessCode: null,
      }],
    });
    assertEveryQrIsExplained(r.blocks, { expectCount: 1 });
    const flat = JSON.stringify(r.blocks);
    expect(flat).not.toContain('PANEL CODE');
    expect(flat).toContain('Scanning is the only way in.');
  });

  it('gives two offers in ONE subject two distinct codes (defect: codes keyed by subject, not token)', () => {
    // Two sections sharing a subject — impossible for the OLD
    // `accessCodesBySubject` map to represent (one key, one value); the
    // token-keyed map gives each its own alias.
    const sections = [
      { subject: 'math', servedToday: false, next: { title: 'Fractions', unitId: 'u1' } },
      { subject: 'math', servedToday: false, next: { title: 'Decimals', unitId: 'u2' } },
    ];
    // `agendaDocument` only ever wires ONE token per subject via
    // `tokensBySubject`, so exercise the pairing directly through two
    // independent lesson cards on a result receipt instead — the same
    // shared `lessonAction` path, and the shape the brief's defect
    // (subject-keying) actually threatened: two tokens, two codes.
    const r = resultDocument({
      sessionId: 'ses_two', unitTitle: 'Fractions', result: 'passed', percent: 100,
      actions: [
        {
          token: 'sch:AAAAAAAAAAAAAAAA', label: 'Fractions', presentation: 'lesson', accessCode: '111111',
        },
        {
          token: 'sch:BBBBBBBBBBBBBBBB', label: 'Decimals', presentation: 'lesson', accessCode: '222222',
        },
      ],
    });
    assertEveryQrIsExplained(r.blocks, { expectCount: 2 });
    const flat = JSON.stringify(r.blocks);
    expect(flat).toContain('PANEL CODE 111111');
    expect(flat).toContain('PANEL CODE 222222');
    // Also prove it end-to-end through `agendaDocument`'s own token-keyed
    // map, for two sections of two DIFFERENT subjects (agenda's real shape)
    // — each keeps its own code rather than the two colliding on write.
    const agenda = agendaDocument({
      learnerId: 'kid1',
      sections: [
        { subject: 'math', servedToday: false, next: { title: 'Fractions' } },
        { subject: 'reading', servedToday: false, next: { title: 'Chapter 4' } },
      ],
      tokensBySubject: { math: 'sch:AAAAAAAAAAAAAAAA', reading: 'sch:BBBBBBBBBBBBBBBB' },
      accessCodesByToken: { 'sch:AAAAAAAAAAAAAAAA': '111111', 'sch:BBBBBBBBBBBBBBBB': '222222' },
    });
    assertEveryQrIsExplained(agenda.blocks, { expectCount: 2 });
    const agendaFlat = JSON.stringify(agenda.blocks);
    expect(agendaFlat).toContain('PANEL CODE 111111');
    expect(agendaFlat).toContain('PANEL CODE 222222');
  });

  it('never prints a bare code with no QR above it', () => {
    // A malformed code degrades to the "scanning only" line, never a
    // dangling "PANEL CODE" nobody can act on.
    const r = resultDocument({
      sessionId: 'ses_bad', unitTitle: 'Unit', result: 'passed', percent: 90,
      actions: [{
        token: 'sch:CCCCCCCCCCCCCCCC', label: 'Next', presentation: 'lesson', accessCode: 'not-six-digits',
      }],
    });
    const flat = JSON.stringify(r.blocks);
    expect(flat).not.toContain('PANEL CODE');
    assertEveryQrIsExplained(r.blocks, { expectCount: 1 });
  });

  it('makes no claim at all when the caller never mentions a code (legacy, self-service untouched)', () => {
    // `accessCode` genuinely omitted (not `null`) — every receipt printed
    // before self-service existed. No code, no "scanning only" line either:
    // this action never claimed to have one.
    const r = resultDocument({
      sessionId: 'ses_legacy', unitTitle: 'Unit', result: 'needs_remediation',
      actions: [{ token: 'sch:DDDDDDDDDDDDDDDD', label: 'Try again with a fresh sheet', presentation: 'lesson' }],
    });
    const flat = JSON.stringify(r.blocks);
    expect(flat).not.toContain('PANEL CODE');
    expect(flat).not.toContain('Scanning is the only way in.');
  });

  it('the agenda keeps pairing correctly (no regression) when self-service is off entirely', () => {
    const agenda = agendaDocument({
      learnerId: 'kid1',
      sections: [{ subject: 'math', servedToday: false, next: { title: 'Fractions' } }],
      tokensBySubject: { math: 'sch:EEEEEEEEEEEEEEEE' },
      // No accessCodesByToken at all — today's behaviour for every household
      // that has not opted into self-service.
    });
    const flat = JSON.stringify(agenda.blocks);
    expect(flat).not.toContain('PANEL CODE');
    expect(flat).not.toContain('Scanning is the only way in.');
  });
});
