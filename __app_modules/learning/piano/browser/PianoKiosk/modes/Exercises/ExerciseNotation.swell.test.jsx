import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileString } from 'sass';
import { render } from '@testing-library/react';
import { SvgSequenceStaff } from '../../../../../../../__capabilities/music-notation/browser/renderers/SvgSequenceStaff.jsx';
import { collectStaffNotes } from '../../../../../../../__capabilities/music-notation/browser/renderers/abcStaffNotes.js';

// THE RESOLVE SWELL MOVES A WHOLE NOTE, NEVER A NOTEHEAD.
//
// It used to scale `.sequence-note-hit` — SvgSequenceStaff's bare <ellipse>,
// a sibling of its stem that carries its own `rotate(-12, cx, cy)`. A CSS
// transform replaces that attribute and `transform-origin` re-pivots it, so on
// every passed rep the green heads swung off their stems ("notes fall off
// their stems when they turn green"). Rendered before/after in Chromium at
// tablet size; these tests pin the structure that keeps them together.

const scssPath = fileURLToPath(new URL('./Exercises.scss', import.meta.url));
const css = compileString(readFileSync(scssPath, 'utf8'), { silenceDeprecations: ['import', 'global-builtin', 'color-functions'] }).css;

/** Every compiled rule (selector list) under `.is-resolve-held` that sets a transform. */
function swellSelectors() {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const [, sel, body] = m;
    if (!sel.includes('is-resolve-held') || !/(^|;|\s)transform(-box|-origin)?\s*:/.test(body)) continue;
    if (/transform:\s*none/.test(body)) continue; // the reduced-motion off switch moves nothing
    out.push(...sel.split(',').map((s) => s.trim()));
  }
  return out;
}

describe('resolve swell — head and stem are one unit', () => {
  it('never puts a transform on a notehead or on a bare head class', () => {
    const selectors = swellSelectors();
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) {
      const target = sel.split(/\s+/).pop();
      expect(target, sel).not.toMatch(/sequence-note-|abcjs-notehead|ellipse|action-staff__note(?!-group)/);
    }
  });

  it('swells the sequence staff column group, and abc notes only when unbeamed', () => {
    const targets = swellSelectors().map((sel) => sel.split(/\s+/).pop());
    expect(targets.some((t) => t.startsWith('.action-staff__note-group'))).toBe(true);
    for (const t of targets.filter((x) => x.startsWith('.exercise-note-'))) {
      expect(t).toContain(':not(.exercise-note-beamed)');
    }
  });

  it('draws each head inside the same group as its stem, owning its own rotate', () => {
    const now = Date.now() + 60_000;
    const { container } = render(
      <SvgSequenceStaff
        notes={[{ midis: [60, 64, 67] }, { midis: [72, 76, 79] }, { midi: 67 }]}
        cursorIndex={1}
        activeNotes={new Map([72, 76, 79].map((m) => [m, { timestamp: now }]))}
      />,
    );
    const groups = [...container.querySelectorAll('.action-staff__note-group')];
    expect(groups).toHaveLength(3);
    for (const group of groups) {
      expect(group.querySelectorAll('.action-staff__stem')).toHaveLength(1);
      for (const head of group.querySelectorAll('ellipse.action-staff__note')) {
        expect(head.closest('.action-staff__note-group')).toBe(group);
        expect(head.getAttribute('transform')).toMatch(/^rotate\(-12, /);
      }
    }
    // The column the swell targets is the one whose heads are all green.
    const hit = container.querySelector(".action-staff__note-group[data-stem-state='hit']");
    expect(hit).not.toBeNull();
    expect([...hit.querySelectorAll('ellipse')].every((e) => e.classList.contains('sequence-note-hit'))).toBe(true);
  });

  it('flags beamed abc notes so the swell can leave their beam joined', () => {
    const note = (beam) => ({ el_type: 'note', midiPitches: [{ pitch: 60 }], abselem: { elemset: [{}], ...(beam ? { beam: {} } : {}) } });
    const tune = { lines: [{ staff: [{ voices: [[note(false), note(true), note(true)]] }] }] };
    expect(collectStaffNotes(tune)[0].map((n) => n.beamed)).toEqual([false, true, true]);
  });
});
