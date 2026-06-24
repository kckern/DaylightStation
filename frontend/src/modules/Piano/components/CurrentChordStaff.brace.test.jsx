import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import { render } from '@testing-library/react';
import { AbcRenderer } from '../../MusicNotation/renderers/AbcRenderer.jsx';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

describe('CurrentChordStaff brace & system barline colour', () => {
  it('abcjs renders the grand-staff brace as a currentColor-driven element', () => {
    // A treble + bass note forces a full grand staff (brace + connecting barline).
    const notes = new Map([[60, {}], [48, {}]]);
    const { container } = render(<AbcRenderer notes={notes} keySignature="C" />);

    const brace = container.querySelector('.abcjs-brace');
    expect(brace, 'grand-staff brace should be rendered').toBeTruthy();
    // The brace must inherit its colour (currentColor), not a hard-coded non-black.
    expect(brace.getAttribute('fill')).toBe('currentColor');
    expect(brace.getAttribute('stroke')).toBe('currentColor');
  });

  it('abcjs renders barlines whose colour is governed by the enclosing group', () => {
    const notes = new Map([[60, {}], [48, {}]]);
    const { container } = render(<AbcRenderer notes={notes} keySignature="C" />);

    const bar = container.querySelector('.abcjs-bar');
    expect(bar, 'a barline group should be rendered').toBeTruthy();
    // The bar group carries currentColor; the child path inherits it.
    expect(bar.getAttribute('fill')).toBe('currentColor');
  });

  it('SCSS sets a dark color on .current-chord-staff so currentColor resolves black', () => {
    const scss = readFileSync(path.join(__dirname, 'CurrentChordStaff.scss'), 'utf8');
    // Locate the `.current-chord-staff {` block (not the `-wrapper` block) and
    // assert it sets a dark `color`.
    const blockStart = scss.search(/\.current-chord-staff\s*\{/);
    expect(blockStart, '.current-chord-staff rule should exist').toBeGreaterThan(-1);
    const block = scss.slice(blockStart, blockStart + 600);
    const colorMatch = block.match(/color\s*:\s*(#[0-9a-fA-F]{3,6}|black)\s*;/);
    expect(colorMatch, '.current-chord-staff should set a dark color').toBeTruthy();
    const value = colorMatch[1].toLowerCase();
    expect(['#000', '#000000', 'black', '#111', '#1a1a1a', '#222', '#333']).toContain(value);
  });
});
