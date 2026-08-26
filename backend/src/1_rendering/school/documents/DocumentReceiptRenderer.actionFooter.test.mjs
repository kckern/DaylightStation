import { describe, it, expect } from 'vitest';
import { createDocumentReceiptRenderer } from './DocumentReceiptRenderer.mjs';
import { documentReceiptTheme as theme } from './documentReceiptTheme.mjs';

/**
 * The lesson card's footer row draws the action label from the left and the
 * progress text from the right. It used to measure as ONE line whatever the
 * content was (`metaLines = metaParts.length ? ['footer'] : []`) and draw with
 * no width check at all, so two long halves advanced into each other and the
 * right-hand text ran on past the left edge of its own card. A real agenda hit
 * it on the first print: "WATCH ON THE PORTAL" over "34/366 · next: Rhythm
 * Improvisation with Chords".
 *
 * These pin the measurement, which is the half that silently regresses — a draw
 * change is visible the moment anyone looks at a page, an under-measure is not.
 */
const card = ({ meta, rail = null }) => ({
  id: 'agenda-test',
  title: 'Test Learner',
  blocks: [{
    type: 'scan_action',
    action: 'sch:TESTTESTTEST0001',
    label: 'Rhythm Improvisation with Chords',
    presentation: 'lesson',
    eyebrow: 'arts',
    hideCode: true,
    description: 'Watch the lesson, then practise the new rhythm with both hands.',
    meta,
    ...(rail ? { rail } : {}),
  }],
});

const SHORT = 'SCAN TO PRINT · Week 34';
// The real one that overflowed.
const LONG = 'WATCH ON THE PORTAL · 34/366 · next: Rhythm Improvisation with Chords';

async function heightOf(document) {
  const renderer = createDocumentReceiptRenderer({ scanCodes: 'qr' });
  const { height } = await renderer.createCanvas(document, { tokens: {} });
  return height;
}

describe('lesson card footer', () => {
  it('grows the card when the footer halves cannot share a row', async () => {
    const short = await heightOf(card({ meta: SHORT }));
    const long = await heightOf(card({ meta: LONG }));
    // The long footer wraps to two extra rows; if the box did not grow, that
    // text was drawn straight through the bottom border.
    expect(long).toBeGreaterThanOrEqual(short + 2 * theme.text.codeLineHeight);
  });

  it('keeps a footer that DOES fit on a single row', async () => {
    // The fix must not tax the common case into a taller card.
    const short = await heightOf(card({ meta: SHORT }));
    const shorter = await heightOf(card({ meta: 'SCAN TO PRINT' }));
    expect(short).toBe(shorter);
  });

  it('reserves height for a catch-up rail', async () => {
    const plain = await heightOf(card({ meta: SHORT }));
    const railed = await heightOf(card({ meta: SHORT, rail: 'Catch-up' }));
    expect(railed).toBe(plain + theme.action.railHeight);
  });

  it('reserves no row — and draws no indicator — when there is no eyebrow', async () => {
    // The agenda card dropped its eyebrow entirely. The row's gap used to be
    // added unconditionally, so a card without one still paid for a blank row,
    // and the draw side put the eyebrow's sun beside nothing.
    const withEyebrow = await heightOf(card({ meta: SHORT }));
    const without = await heightOf({
      ...card({ meta: SHORT }),
      blocks: [{ ...card({ meta: SHORT }).blocks[0], eyebrow: null }],
    });
    expect(without).toBeLessThan(withEyebrow);
  });

  it('ignores a rail on a non-lesson action', async () => {
    // The rail is a lesson-card affordance; a plain scan box has no header to
    // hang it on, and silently growing one would misalign every other box.
    const plain = await heightOf({
      id: 'x', title: 'T', blocks: [{ type: 'scan_action', action: 'sch:AAAA', label: 'Plain' }],
    });
    const railed = await heightOf({
      id: 'x', title: 'T', blocks: [{ type: 'scan_action', action: 'sch:AAAA', label: 'Plain', rail: 'Catch-up' }],
    });
    expect(railed).toBe(plain);
  });
});
