import { describe, expect, it } from 'vitest';
import { DECODER_DEFAULTS, decoderSettings, revealCycleLength, revealFrame } from './segmentedSecretReveal.js';

// A frame as text: the character where one shows, '·' where none does, '_'
// where the cursor sits. One string per line.
const picture = frame => frame.map(line => line.map(({ char, cursor }) => (cursor ? '_' : char ?? '·')).join(''));

describe('decoderSettings', () => {
  it('fills every key with its default', () => {
    expect(decoderSettings()).toEqual(DECODER_DEFAULTS);
    expect(DECODER_DEFAULTS).toMatchObject({ reveal: 'marquee', stepMs: 100, motion: true, motionMs: 100, colorAnimation: true, marqueeHoldSteps: 10, marqueeGapSteps: 4 });
  });

  it('normalizes snake-case and camel-case color animation settings', () => {
    expect(decoderSettings({ color_animation: false }).colorAnimation).toBe(false);
    expect(decoderSettings({ colorAnimation: false }).colorAnimation).toBe(false);
    expect(decoderSettings({ color_animation: 'no' }).colorAnimation).toBe(true);
  });

  it('reads the snake_case keys a rules file authors', () => {
    expect(decoderSettings({ reveal: 'marquee', step_ms: 200, motion: false, motion_ms: 800, marquee_hold_steps: 6, marquee_gap_steps: 2 }))
      .toEqual({ reveal: 'marquee', stepMs: 200, motion: false, motionMs: 800, colorAnimation: true, marqueeHoldSteps: 6, marqueeGapSteps: 2 });
  });

  it('ignores invalid values rather than breaking the display', () => {
    expect(decoderSettings({ reveal: 'sideways', step_ms: -1, motion: 'yes', marquee_hold_steps: 1.5 })).toEqual(DECODER_DEFAULTS);
  });

  it('shuffles static colors with the position jump, as before', () => {
    expect(decoderSettings({ reveal: 'static' })).toMatchObject({ stepMs: 100, motionMs: 100 });
  });
});

describe('progressive reveal', () => {
  const settings = decoderSettings({ reveal: 'progressive' });
  const frames = lines => Array.from({ length: revealCycleLength(lines, settings) + 1 }, (_, step) => picture(revealFrame(lines, step, settings))[0]);

  it('types one character per step behind a cursor, then hides first-to-last, then loops', () => {
    expect(frames(['CAT'])).toEqual([
      '_··', 'C_·', 'CA_', 'CAT', // typing
      '·AT', '··T', '···',       // hiding, first character first
      '_··',                     // and round again
    ]);
  });

  it('types through the lines in reading order', () => {
    const lines = ['AB', 'CD'];
    expect([2, 3].map(step => picture(revealFrame(lines, step, settings)))).toEqual([['AB', '_·'], ['AB', 'C_']]);
  });
});

describe('marquee', () => {
  const settings = decoderSettings({ reveal: 'marquee', marquee_hold_steps: 2, marquee_gap_steps: 1 });
  const frames = lines => Array.from({ length: revealCycleLength(lines, settings) }, (_, step) => picture(revealFrame(lines, step, settings))[0]);

  it('scrolls right to left: in from the right, held, out to the left, gap, repeat', () => {
    expect(frames(['CAT'])).toEqual([
      '···', '··C', '·CA', 'CAT', // in from the right
      'CAT', 'CAT',               // held
      'AT·', 'T··', '···',        // out to the left
      '···',                      // gap
    ]);
  });

  it('holds a shorter line until the longest has arrived', () => {
    const lines = ['ABCD', 'XY'];
    expect(picture(revealFrame(lines, 2, settings))).toEqual(['··AB', 'XY']);
    expect(picture(revealFrame(lines, 4, settings))).toEqual(['ABCD', 'XY']);
  });

  it('never shows a cursor', () => {
    for (let step = 0; step < revealCycleLength(['CAT'], settings); step += 1) {
      expect(revealFrame(['CAT'], step, settings).flat().some(cell => cell.cursor)).toBe(false);
    }
  });
});

describe('static', () => {
  it('always shows everything', () => {
    const settings = decoderSettings({ reveal: 'static' });
    expect(picture(revealFrame(['CAT'], 7, settings))).toEqual(['CAT']);
  });
});
