// DurationPalette.test.jsx — the toolbar palette as a unit. This is the only
// surface a TOUCH user has: a kid on the tablet has no numpad, so anything the
// keymap can do but this palette cannot is unreachable for them. These tests
// pin the three things that made it unreachable or misleading:
//   - delete existed in the keymap and the hook but had no button at all;
//   - the arm toggle was labelled "Play", i.e. a transport word on a control
//     that plays nothing, and it named its STATE rather than its action;
//   - the numpad digits printed bare, which in a piano app reads as FINGERING.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DurationPalette } from './DurationPalette.jsx';

const HUD = { type: 'quarter', dots: 0, armed: false };

function renderPalette(overrides = {}) {
  const props = {
    hud: HUD,
    setDuration: vi.fn(),
    toggleDot: vi.fn(),
    toggleArm: vi.fn(),
    addRest: vi.fn(),
    deleteBack: vi.fn(),
    ...overrides,
  };
  const utils = render(<DurationPalette {...props} />);
  return { ...utils, props };
}

describe('DurationPalette — delete', () => {
  it('renders a delete button with the stated accessible name', () => {
    renderPalette();
    expect(screen.getByRole('button', { name: 'Delete the last note (Backspace)' })).toBeInTheDocument();
  });

  it('calls deleteBack when tapped (the touch path for the Backspace binding)', () => {
    const { props } = renderPalette();
    fireEvent.click(screen.getByRole('button', { name: /delete the last note/i }));
    expect(props.deleteBack).toHaveBeenCalledTimes(1);
  });

  it('is a one-shot action, not a sticky mode — it carries no pressed state', () => {
    renderPalette();
    // Distinguishes the three interaction semantics on this toolbar: durations
    // and dot are sticky (aria-pressed), rest/delete fire once, write is a
    // global toggle. A pressed-looking delete would read as "delete mode".
    expect(screen.getByRole('button', { name: /delete the last note/i })).not.toHaveAttribute('aria-pressed');
  });

  it('renders no Unicode erase glyph (kiosk Firefox renders those as tofu)', () => {
    const { container } = renderPalette();
    expect(container.textContent).not.toMatch(/\u232B|\u2190|\uFF0B/);
  });
});

describe('DurationPalette — the write toggle', () => {
  it('says "Write" in BOTH states — the visible label names the control, not its state', () => {
    const { container, rerender } = renderPalette();
    const label = () => container.querySelector('.composer-palette__arm').textContent.trim();
    expect(label()).toBe('Write');
    rerender(
      <DurationPalette
        hud={{ ...HUD, armed: true }}
        setDuration={vi.fn()} toggleDot={vi.fn()} toggleArm={vi.fn()} addRest={vi.fn()} deleteBack={vi.fn()}
      />
    );
    // An unchanging label is the point: "Play"/"Armed" made the button ambiguous
    // (does tapping start it, or is that what I'm in?). The state dot carries on/off.
    expect(label()).toBe('Write');
  });

  it('names its state in the accessible name, in both directions', () => {
    const { rerender } = renderPalette();
    expect(screen.getByRole('button', { name: 'Write is off — play freely (numpad 4)' })).toHaveAttribute('aria-pressed', 'false');
    rerender(
      <DurationPalette
        hud={{ ...HUD, armed: true }}
        setDuration={vi.fn()} toggleDot={vi.fn()} toggleArm={vi.fn()} addRest={vi.fn()} deleteBack={vi.fn()}
      />
    );
    expect(screen.getByRole('button', { name: 'Write is on — the piano writes notes here (numpad 4)' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('nothing in the palette renders the word "Play" — there is no transport here', () => {
    const { container, rerender } = renderPalette();
    expect(container.textContent).not.toMatch(/\bPlay\b/);
    rerender(
      <DurationPalette
        hud={{ ...HUD, armed: true }}
        setDuration={vi.fn()} toggleDot={vi.fn()} toggleArm={vi.fn()} addRest={vi.fn()} deleteBack={vi.fn()}
      />
    );
    expect(container.textContent).not.toMatch(/\bPlay\b/);
  });
});

// ---------------------------------------------------------------------------
// Delete vs Rest (Task 12). These two sat adjacent, same size, same neutral
// chrome, told apart ONLY by their words. A kid aiming for Delete who lands on
// Rest INSERTS something instead of removing something — the exact opposite of
// the intent, on the one control that exists to undo mistakes. Three separate
// signals now carry the distinction, and each is pinned here because losing any
// one of them quietly restores the confusion.
// ---------------------------------------------------------------------------
describe('DurationPalette — Delete cannot be mistaken for Rest', () => {
  it('draws them as different SHAPES, not just different words', () => {
    const { container } = renderPalette();
    const rest = container.querySelector('.composer-palette__rest svg');
    const del = container.querySelector('.composer-palette__delete svg');
    expect(rest).toBeTruthy();
    expect(del).toBeTruthy();
    // A rest glyph and a backspace keycap look nothing alike; two similar words
    // at a glance do. Comparing the drawn geometry is what proves that holds.
    expect(rest.innerHTML).not.toBe(del.innerHTML);
  });

  it('separates Delete from the rest cluster instead of butting them together', () => {
    const { container } = renderPalette();
    // The divider is the spatial signal — Delete is no longer the neighbour of
    // the control it gets confused with. Adjacency was half the problem, and
    // icons alone would not have fixed it.
    const kids = [...container.querySelector('.composer-palette').children];
    const sep = kids.findIndex((n) => n.classList.contains('composer-palette__sep'));
    const del = kids.findIndex((n) => n.classList.contains('composer-palette__delete'));
    const rest = kids.findIndex((n) => n.classList.contains('composer-palette__rest'));
    expect(sep).toBeGreaterThan(-1);
    expect(rest).toBeLessThan(sep);
    expect(del).toBeGreaterThan(sep);
  });

  it('keeps its word as well as its icon — a lone glyph is a guess for a new reader', () => {
    const { container } = renderPalette();
    expect(container.querySelector('.composer-palette__delete').textContent).toContain('Delete');
    expect(container.querySelector('.composer-palette__rest').textContent).toContain('Rest');
  });

  it('still fires deleteBack, not addRest, when Delete is tapped', () => {
    const { props } = renderPalette();
    fireEvent.click(screen.getByRole('button', { name: /delete the last note/i }));
    expect(props.deleteBack).toHaveBeenCalledTimes(1);
    expect(props.addRest).not.toHaveBeenCalled();
  });
});

describe('DurationPalette — the dot button', () => {
  it('draws the dotted note rather than typesetting a Unicode one', () => {
    const { container } = renderPalette();
    const dot = container.querySelector('.composer-palette__mod[aria-pressed]');
    // Two drawings: the notehead it modifies, then the augmentation dot — which
    // is what "dotted" actually looks like on the staff.
    expect(dot.querySelectorAll('svg').length).toBe(2);
    expect(dot.textContent.trim()).toBe('');
  });
});

describe('DurationPalette — numpad hints read as keycaps, not fingering', () => {
  it('wraps every duration digit in a keycap element rather than printing it bare', () => {
    const { container } = renderPalette();
    const caps = [...container.querySelectorAll('.composer-palette__keycap')].map((n) => n.textContent.trim());
    expect(caps).toEqual(['1', '3', '5', '7', '9']);
  });

  it('puts the keycap INSIDE its duration button, so the hint travels with the control', () => {
    const quarter = renderPalette().container.querySelector('.composer-palette__dur.is-active');
    expect(quarter.querySelector('.composer-palette__keycap').textContent.trim()).toBe('5');
  });
});
