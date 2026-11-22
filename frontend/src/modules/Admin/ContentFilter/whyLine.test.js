import { describe, it, expect } from 'vitest';
import { whyLine } from './whyLine.js';

const row = (o) => ({ id: 'cue:a', kind: 'words', effect: 'mute', in: 10, out: 11.3, unsure: [], timing: 'refined', ...o });

describe('whyLine', () => {
  it('a long rough word skipped as an exchange: says rough timing is why, and refine is the fix', () => {
    const w = whyLine(row({ effect: 'skip-card', in: 2664, out: 2670, unsure: ['exchange-by-length'], timing: 'rough' }));
    expect(w.text).toBe('Rough timing makes this a 6.0 s part, too long to bleep, so it is skipped for now. Refine pins the word so it becomes a short bleep.');
    expect(w.refine).toBe(true);
  });
  it('a long refined line stays skipped, with no refine offered', () => {
    const w = whyLine(row({ effect: 'skip-card', in: 0, out: 12, unsure: ['exchange-by-length'], timing: 'refined' }));
    expect(w.text).toMatch(/This line runs 12 s, too long to bleep/);
    expect(w.refine).toBe(false);
  });
  it('a rough mute says its length and that refine fits it', () => {
    const w = whyLine(row({ timing: 'rough' }));
    expect(w.text).toBe('Muted for 1.3 s. The timing is still rough; refining fits it to this film.');
    expect(w.refine).toBe(true);
  });
  it('a refined mute is just its effect and length', () => {
    expect(whyLine(row({ effect: 'bleep', in: 5, out: 5.4 }))).toEqual({ text: 'Bleeped for 0.4 s.', refine: false });
  });
  it('safe windows, not-found words and untracked pictures say so', () => {
    expect(whyLine(row({ unsure: ['safe-window'], timing: 'safe-window', in: 0, out: 3 })).text).toMatch(/wider 3.0 s window/);
    expect(whyLine(row({ unsure: ['refine-giveup'] })).text).toMatch(/could not find this word/);
    expect(whyLine(row({ effect: 'full-blur', unsure: ['untracked-visual'] })).text).toMatch(/could not be tracked/);
  });
  it('parts that play say why', () => {
    expect(whyLine(row({ acts: false, why: 'settings', effect: 'off' })).text).toMatch(/your settings let this kind of part play/);
    expect(whyLine(row({ acts: false, why: 'removed', effect: 'off' })).text).toBe('Plays: you let this part play.');
  });
  it('no row, no line', () => { expect(whyLine(null)).toEqual({ text: '', refine: false }); });
});
