# Piano Kiosk Settings Landscape Redesign — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the kiosk's Sound and Piano-maintenance sheets as full-canvas, landscape, icon-led tile layouts that never scroll, on the kiosk's one existing modal shell.

**Architecture:** `TransportSheet` gains a `size="canvas"` variant and absorbs `PianoSheet`'s accessibility; `TransportButton` gains `layout="tile"|"rail"` and `emphasis="danger"`. `SoundPanel` becomes rail + voice grid + tone column driven by a new pure `voiceFamilies.js`; `OperatorDrawer` becomes status card + ranked tiles + danger strip. `PianoSheet` and ~150 lines of orphaned SCSS are deleted. A Playwright screenshot gate asserts no sheet state scrolls at 1280×800.

**Tech Stack:** React 18 (`.jsx`), Vitest + Testing Library (jsdom), SCSS, Playwright. Run unit tests with `npx vitest run <paths>` from the worktree root — never via `--only=domain` (that routes them to Jest and they fail to load).

**Spec:** `docs/_wip/plans/2026-09-02-piano-kiosk-settings-landscape-redesign.md`
**Bug report:** `docs/_wip/bugs/2026-09-02-piano-kiosk-settings-sheets-unusable-on-touch.md`
**Worktree:** `.worktrees/piano-settings-landscape`, branch `piano/settings-landscape`. All paths below are relative to it. `K = frontend/src/modules/Piano/PianoKiosk`.

**Commit trailer for every commit in this plan:**
```
Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_013EvwyHPtmJ64zo2KhB9ALr
```

**House rules that bite here:**
- Never start a second backend (`node backend/index.js`) — it is a live household controller. The Playwright task reuses the running dev server on port 3111 or starts exactly one via Playwright's `webServer`.
- SVG icons only on buttons (TransportButton rule). No emoji.
- No raw `console.*`; the logger pattern is already in `OperatorDrawer.jsx`.
- Vocabulary: no "genuine", "honest", "quiet(ly)", "silent(ly)", "load-bearing", "It's not X, it's Y".

---

### Task 1: `TransportSheet` — canvas size + accessibility from `PianoSheet`

**Files:**
- Modify: `K/transport/TransportSheet.jsx`
- Modify: `K/transport/TransportSheet.test.jsx`
- Modify: `K/transport/Transport.scss` (append)

**Step 1: Write the failing tests** — append to `K/transport/TransportSheet.test.jsx`:

```jsx
  it('labels the dialog by its heading and puts initial focus on the first content control, not Close', () => {
    render(<><button type="button">Opener</button><TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">First action</button><button type="button">Last action</button></TransportSheet></>);
    const dialog = screen.getByRole('dialog', { name: 'Sound' });
    expect(dialog).toHaveAttribute('aria-labelledby');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First action' }));
  });

  it('falls back to Close for initial focus when the body has nothing focusable', () => {
    render(<TransportSheet open title="Sound" onClose={vi.fn()}><p>text only</p></TransportSheet>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close Sound' }));
  });

  it('traps Tab in both directions between Close and the last control', () => {
    render(<TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">First action</button><button type="button">Last action</button></TransportSheet>);
    const close = screen.getByRole('button', { name: 'Close Sound' });
    const last = screen.getByRole('button', { name: 'Last action' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('closes on Escape and restores focus to the opener on unmount', () => {
    const onClose = vi.fn();
    const { rerender } = render(<><button type="button">Opener</button></>);
    screen.getByRole('button', { name: 'Opener' }).focus();
    rerender(<><button type="button">Opener</button><TransportSheet open title="Sound" onClose={onClose}><button type="button">A</button></TransportSheet></>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
    rerender(<button type="button">Opener</button>);
    expect(document.activeElement?.textContent).toBe('Opener');
  });

  it('adds the canvas modifier for size="canvas"', () => {
    const { container } = render(<TransportSheet open title="Sound" size="canvas" onClose={vi.fn()}>x</TransportSheet>);
    expect(container.querySelector('.piano-tsheet')).toHaveClass('piano-tsheet--canvas');
  });

  it('stops Escape before it reaches window listeners (the screen framework maps Escape itself)', () => {
    const windowSpy = vi.fn();
    window.addEventListener('keydown', windowSpy);
    try {
      render(<TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">A</button></TransportSheet>);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(windowSpy).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener('keydown', windowSpy);
    }
  });

  it('only the most recently opened sheet handles Escape; the one beneath takes over when it closes', () => {
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    const tree = (innerOpen) => (
      <TransportSheet open title="Outer" onClose={outerClose}>
        <button type="button">Outer action</button>
        <TransportSheet open={innerOpen} title="Inner" onClose={innerClose}><button type="button">Inner action</button></TransportSheet>
      </TransportSheet>
    );
    const { rerender } = render(tree(false));
    rerender(tree(true));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
    rerender(tree(false));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(outerClose).toHaveBeenCalledOnce();
    expect(innerClose).toHaveBeenCalledOnce();
  });

  it('honours a data-autofocus opt-in for initial focus even when it is not first', () => {
    render(<TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">First</button><button type="button" data-autofocus>Chosen</button></TransportSheet>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Chosen' }));
  });

  it('never wraps onto a control with tabindex="-1"', () => {
    render(<TransportSheet open title="Sound" onClose={vi.fn()}><button type="button">First</button><button type="button" tabIndex={-1}>Hidden</button></TransportSheet>);
    const close = screen.getByRole('button', { name: 'Close Sound' });
    const first = screen.getByRole('button', { name: 'First' });
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(first);
  });

  it('picks the innermost sheet as top by document order when both mount open in one commit', () => {
    // React 18 runs a child's effect before its parent's, so push order alone
    // would crown the OUTER sheet. Top must be decided by document position.
    const outerClose = vi.fn();
    const innerClose = vi.fn();
    render(
      <TransportSheet open title="Outer" onClose={outerClose}>
        <button type="button">Outer action</button>
        <TransportSheet open title="Inner" onClose={innerClose}><button type="button">Inner action</button></TransportSheet>
      </TransportSheet>
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inner action' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(innerClose).toHaveBeenCalledOnce();
    expect(outerClose).not.toHaveBeenCalled();
  });
```

Add `import { vi } from 'vitest';` if the file relies on globals (it currently uses `vi` as a global; keep whatever the existing file does).

**Step 2: Run to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.test.jsx`
Expected: 10 new tests FAIL (no `aria-labelledby`, focus not moved, no canvas class, Escape reaches window, no sheet stack, push-order top crowns the outer sheet, no autofocus opt-in, tabindex=-1 wrapped onto). The 3 existing tests still pass.

**Step 3: Implement** — replace `K/transport/TransportSheet.jsx` with:

```jsx
import { useEffect, useId, useRef } from 'react';
import TransportButton from './TransportButton.jsx';
import './Transport.scss';

const FOCUSABLE = 'button:not([disabled]), [href], select:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Open sheets. The top sheet is the one latest in DOCUMENT order, decided at
// use time — not push order, because React 18 runs a child's effect before
// its parent's, so a nested pair mounted open in one commit would otherwise
// crown the outer sheet.
const openSheets = [];
const top = () => openSheets.reduce((a, b) =>
  (a.current && b.current && (a.current.compareDocumentPosition(b.current) & Node.DOCUMENT_POSITION_FOLLOWING)) ? b : a);

/**
 * TransportSheet — the kiosk's one modal-sheet shell: full-screen scrim that
 * dismisses on tap, a titled panel with a 48px close button, focus trapped
 * inside, Escape closes, focus returns to the opener on unmount.
 *
 * `size="auto"` (default) is the centered transport sheet (volume, key, tempo,
 * loop). `size="canvas"` fills the design canvas minus a margin for the
 * settings sheets, whose bodies lay out in columns and must never scroll.
 *
 * Initial focus goes to `[data-autofocus]` if the body opts in, else the first
 * content control; Close is the fallback only when the body has nothing
 * focusable. Controls with `tabindex="-1"` are never trap targets.
 *
 * Invariant: only the topmost open sheet (latest in document order) handles
 * keys, captures the opener and takes initial focus. Escape is stopped at the
 * document so the screen framework's window listener never sees it as its
 * own escape action.
 */
export default function TransportSheet({ open, title, onClose, children, size = 'auto', className = '' }) {
  const titleId = useId();
  const panel = useRef(null);
  const opener = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return undefined;
    openSheets.push(panel);
    const focusables = () => [...(panel.current?.querySelectorAll(FOCUSABLE) || [])].filter((node) => node.tabIndex >= 0);
    if (top() === panel) {
      opener.current = document.activeElement;
      const initial = focusables();
      (panel.current?.querySelector('[data-autofocus]')
        || initial.find((node) => !node.classList.contains('piano-tsheet__close'))
        || initial[0])?.focus();
    }
    const keydown = (event) => {
      if (top() !== panel) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onCloseRef.current(); return; }
      if (event.key !== 'Tab') return;
      const nodes = focusables();
      if (!nodes.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!panel.current?.contains(document.activeElement)) { event.preventDefault(); (event.shiftKey ? last : first).focus(); return; }
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      const at = openSheets.indexOf(panel);
      if (at !== -1) openSheets.splice(at, 1);
      opener.current?.focus?.();
    };
  }, [open]);

  if (!open) return null;
  const classes = ['piano-tsheet', size === 'canvas' ? 'piano-tsheet--canvas' : '', className].filter(Boolean).join(' ');
  return (
    <div className={classes} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="piano-tsheet__scrim" aria-label={`Dismiss ${title}`} tabIndex={-1} onClick={onClose} />
      <div ref={panel} className="piano-tsheet__panel">
        <header className="piano-tsheet__head">
          <h2 id={titleId}>{title}</h2>
          <TransportButton icon="close" ariaLabel={`Close ${title}`} emphasis="quiet" className="piano-tsheet__close" onPress={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
```

Append to `K/transport/Transport.scss` (after the `.piano-tsheet` block):

```scss
// Settings sheets fill the design canvas minus a margin. The panel is a
// column flexbox; the sheet body lays out in a grid and MUST NOT scroll —
// a scrollbar here is a layout bug, not a feature.
.piano-tsheet--canvas .piano-tsheet__panel {
  position: absolute;
  inset: 1.5rem;
  min-width: 0;
  max-width: none;
  max-height: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 1rem 1.25rem 1.25rem;
  .piano-tsheet__head h2 { font-size: 1.4rem; }
}
```

**Step 4: Run to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/`
Expected: all pass (TransportSheet 13, plus the other transport suites unchanged).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.jsx frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.test.jsx frontend/src/modules/Piano/PianoKiosk/transport/Transport.scss
git commit -m "feat(piano): TransportSheet gets a canvas size and the focus trap from PianoSheet"
```

---

### Task 2: `TransportButton` — `layout` and `danger`

**Files:**
- Modify: `K/transport/TransportButton.jsx`
- Modify: `K/transport/TransportButton.test.jsx`
- Modify: `K/transport/Transport.scss` (append)

**Step 1: Failing tests** — append to `K/transport/TransportButton.test.jsx`:

```jsx
  it('applies tile and rail layout modifiers and the danger emphasis', () => {
    const { rerender } = render(<TransportButton icon="close" label="Reboot" layout="tile" emphasis="danger" onPress={() => {}} />);
    const button = screen.getByRole('button', { name: 'Reboot' });
    expect(button).toHaveClass('piano-tbtn--tile');
    expect(button).toHaveClass('piano-tbtn--danger');
    rerender(<TransportButton icon="close" label="Pianos" layout="rail" onPress={() => {}} />);
    expect(screen.getByRole('button', { name: 'Pianos' })).toHaveClass('piano-tbtn--rail');
  });
```

(Match the file's existing import style — it renders with `@testing-library/react` and mocks `Icon` if needed; copy the pattern of the first test in the file.)

**Step 2: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/TransportButton.test.jsx` → new test FAILS (no layout class).

**Step 3: Implement** — in `K/transport/TransportButton.jsx`:

- JSDoc: change the emphasis line to `@param {'default'|'primary'|'quiet'|'danger'} [emphasis]` and add
  `@param {'inline'|'tile'|'rail'} [layout] - inline (default) sits in a strip; tile stacks icon over a wrapping label for grids; rail is a full-width icon-left row for a side rail.`
- Signature: add `layout = 'inline',` after `emphasis = 'default',`.
- `classes` array: add `layout !== 'inline' ? \`piano-tbtn--${layout}\` : '',` after the emphasis entry.

Append to `Transport.scss` after `.piano-tbtn--quiet`:

```scss
// Danger — destructive-ish actions (screen off, restart, reboot). At rest a
// red outline; while ARMED (two-tap confirm, is-on) it fills warn-amber so the
// state is visible from across the room, not only in the label.
.piano-tbtn--danger {
  background: transparent;
  border-color: var(--piano-danger, #e05a4f);
  color: var(--piano-danger, #e05a4f);
  &.is-on {
    background: var(--piano-warn, #e0a83a);
    border-color: var(--piano-warn, #e0a83a);
    color: #1a1206;
    font-weight: 700;
  }
}

// Tile — icon over a wrapping label; the settings-grid primitive. Overrides the
// inline anti-wrap rule on purpose: a 4-across grid has room for two lines and
// truncating "Chromatic Percussion" to "Chromatic Per…" is the old bug.
.piano-tbtn--tile {
  flex-direction: column;
  justify-content: center;
  gap: 0.45rem;
  width: 100%;
  min-height: 5.5rem;
  padding: 0.6rem 0.5rem;
  white-space: normal;
  text-align: center;
  line-height: 1.15;
  .piano-icon { font-size: 1.9em; }
}

// Rail — full-width icon-left row for the Sound sheet's family rail.
.piano-tbtn--rail {
  width: 100%;
  min-height: 3.5rem;
  justify-content: flex-start;
  padding: 0.5rem 0.8rem;
  white-space: normal;
  text-align: left;
}
```

**Step 4: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/` → all pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/TransportButton.jsx frontend/src/modules/Piano/PianoKiosk/transport/TransportButton.test.jsx frontend/src/modules/Piano/PianoKiosk/transport/Transport.scss
git commit -m "feat(piano): TransportButton tile/rail layouts and a danger emphasis with a visible armed state"
```

---

### Task 3: `voiceFamilies.js` — the nine hearing-based families

**Files:**
- Create: `K/voiceFamilies.js`
- Create: `K/voiceFamilies.test.js`

**Step 1: Failing test** — `K/voiceFamilies.test.js`:

```js
import { describe, expect, it } from 'vitest';
import { VOICE_GROUPS, ALL_VOICES } from './devices/suzukiMdg400.js';
import { FAMILIES, familyOf, partitionVoices } from './voiceFamilies.js';

describe('voiceFamilies', () => {
  it('has nine families with ids, labels and icons', () => {
    expect(FAMILIES.map((f) => f.id)).toEqual(['pianos', 'keys', 'guitars', 'strings', 'voices', 'winds', 'synths', 'world', 'fun']);
    for (const family of FAMILIES) { expect(family.label).toBeTruthy(); expect(family.icon).toBeTruthy(); }
  });

  it('places every device voice in exactly one family', () => {
    const families = partitionVoices(VOICE_GROUPS);
    const placed = Object.values(families).flat();
    expect(placed).toHaveLength(ALL_VOICES.length);
    const keys = new Set(placed.map((v) => `${v.pc}:${v.bank || 0}`));
    expect(keys.size).toBe(ALL_VOICES.length);
  });

  it('sizes the families per the spec table', () => {
    const families = partitionVoices(VOICE_GROUPS);
    expect(Object.fromEntries(Object.entries(families).map(([id, voices]) => [id, voices.length]))).toEqual({
      pianos: 8, keys: 16, guitars: 16, strings: 12, voices: 3, winds: 24, synths: 24, world: 18, fun: 17,
    });
  });

  it('follows the ear, not the GM spec, at the edges', () => {
    expect(familyOf({ pc: 47 })).toBe('strings');           // Timpani stays with the orchestra
    expect(familyOf({ pc: 55 })).toBe('fun');               // Orchestra Hit is a toy
    expect(familyOf({ pc: 52 })).toBe('voices');            // Choir Aahs
    expect(familyOf({ pc: 15, bank: 1 })).toBe('world');    // Yangqin (bank 1 folk voice)
    expect(familyOf({ pc: 15 })).toBe('keys');              // Dulcimer (bank 0)
    expect(familyOf({ pc: 0 })).toBe('pianos');
    expect(familyOf(null)).toBeNull();
    expect(familyOf({})).toBeNull();
  });

  it('keeps every family under the 24-tile grid ceiling', () => {
    const families = partitionVoices(VOICE_GROUPS);
    for (const voices of Object.values(families)) expect(voices.length).toBeLessThanOrEqual(24);
  });
});
```

**Step 2: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/voiceFamilies.test.js` → FAIL (module not found).

**Step 3: Implement** — `K/voiceFamilies.js`:

```js
// voiceFamilies.js — the Sound sheet's rail: nine families a person can hear,
// not the sixteen General MIDI buckets the device profile ships. Membership is
// by GM program number (bank 0) with the device's bank-1 folk voices in World.
// A voice belongs to exactly one family; `voiceFamilies.test.js` proves it
// against the whole device catalog. Max family size is 24 — the grid ceiling.

const inRange = (lo, hi) => ({ pc, bank }) => bank === 0 && pc >= lo && pc <= hi;

export const FAMILIES = Object.freeze([
  { id: 'pianos', label: 'Pianos', icon: 'piano', match: inRange(0, 7) },
  { id: 'keys', label: 'Keys & Organs', icon: 'family-keys', match: inRange(8, 23) },
  { id: 'guitars', label: 'Guitars & Bass', icon: 'family-guitar', match: inRange(24, 39) },
  { id: 'strings', label: 'Strings', icon: 'family-strings', match: inRange(40, 51) },
  { id: 'voices', label: 'Voices', icon: 'studio', match: inRange(52, 54) },
  { id: 'winds', label: 'Winds & Brass', icon: 'family-winds', match: inRange(56, 79) },
  { id: 'synths', label: 'Synths', icon: 'family-synths', match: inRange(80, 103) },
  { id: 'world', label: 'World', icon: 'family-world', match: ({ pc, bank }) => bank !== 0 || (pc >= 104 && pc <= 111) },
  { id: 'fun', label: 'Drums & Fun', icon: 'family-fun', match: ({ pc, bank }) => bank === 0 && (pc === 55 || pc >= 112) },
]);

/** Family id for a voice ({ pc, bank? }), or null when it has no program. */
export function familyOf(voice) {
  if (!voice || voice.pc == null) return null;
  const probe = { pc: Number(voice.pc), bank: Number(voice.bank || 0) };
  return FAMILIES.find((family) => family.match(probe))?.id ?? null;
}

/** { [familyId]: voice[] } over the device's grouped catalog, device order kept. */
export function partitionVoices(groups) {
  const out = Object.fromEntries(FAMILIES.map((family) => [family.id, []]));
  for (const group of groups || []) {
    for (const voice of group.voices || []) {
      const id = familyOf(voice);
      if (id) out[id].push(voice);
    }
  }
  return out;
}
```

**Step 4: Run** — same command → 5 pass. If the size test fails, the numbers in the spec table are wrong, not the code — recount from `devices/suzukiMdg400.js` and fix the *test and the spec* together.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/voiceFamilies.js frontend/src/modules/Piano/PianoKiosk/voiceFamilies.test.js
git commit -m "feat(piano): nine hearing-based voice families for the Sound rail"
```

---

### Task 4: Family icons + `instrumentIcon` returns icon names

**Files:**
- Create: `frontend/src/modules/Piano/ui/icons/svg/{family-keys,family-guitar,family-strings,family-winds,family-synths,family-world,family-fun,star}.svg`
- Modify: `frontend/src/modules/Piano/ui/icons/MANIFEST.md`
- Create: `frontend/src/modules/Piano/ui/icons/familyIcons.test.jsx`
- Modify: `K/instrumentIcon.js`, `K/instrumentIcon.test.js`

**Step 1: Failing tests**

`frontend/src/modules/Piano/ui/icons/familyIcons.test.jsx`:

```jsx
import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Icon from './Icon.jsx';

const NAMES = ['family-keys', 'family-guitar', 'family-strings', 'family-winds', 'family-synths', 'family-world', 'family-fun', 'star'];

describe('family icons', () => {
  it.each(NAMES)('%s resolves to an inline SVG sized 1em in currentColor', (name) => {
    const { container } = render(<Icon name={name} />);
    const svg = container.querySelector('.piano-icon svg');
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('width')).toBe('1em');
    expect(svg.getAttribute('height')).toBe('1em');
    expect(container.innerHTML).toMatch(/currentColor/);
  });
});
```

Replace `K/instrumentIcon.test.js` with:

```js
import { describe, it, expect } from 'vitest';
import { instrumentIcon } from './instrumentIcon.js';

describe('instrumentIcon', () => {
  it('maps common families to a house icon name', () => {
    expect(instrumentIcon('Acoustic Grand')).toBe('piano');
    expect(instrumentIcon('Electric Piano 1')).toBe('piano');
    expect(instrumentIcon('Church Organ')).toBe('family-keys');
    expect(instrumentIcon('Vibraphone')).toBe('family-keys');
    expect(instrumentIcon('Nylon Guitar')).toBe('family-guitar');
    expect(instrumentIcon('Fingered Bass')).toBe('family-guitar');
    expect(instrumentIcon('String Ensemble')).toBe('family-strings');
    expect(instrumentIcon('Tenor Sax')).toBe('family-winds');
    expect(instrumentIcon('Trumpet')).toBe('family-winds');
    expect(instrumentIcon('Pan Flute')).toBe('family-winds');
    expect(instrumentIcon('Synth Voice')).toBe('studio');
    expect(instrumentIcon('Standard Kit')).toBe('family-fun');
    expect(instrumentIcon('Saw Lead')).toBe('family-synths');
    expect(instrumentIcon('Erhu')).toBe('family-world');
    expect(instrumentIcon('Sitar')).toBe('family-world');
  });

  it('falls back to the music note for unknown / empty names', () => {
    expect(instrumentIcon('Whatchamacallit')).toBe('music');
    expect(instrumentIcon('')).toBe('music');
    expect(instrumentIcon(null)).toBe('music');
  });
});
```

**Step 2: Run** — `npx vitest run frontend/src/modules/Piano/ui/icons/familyIcons.test.jsx frontend/src/modules/Piano/PianoKiosk/instrumentIcon.test.js` → FAIL (icons missing; `instrumentIcon` not exported).

**Step 3: Add the icons.** Solar (the house set) has no guitar/violin/trumpet glyphs, so these follow the MANIFEST's existing exception path (like `metronome`, `quill`, `game-battle-stadium`): fetch from SVG Repo or Iconify, then **normalize** to `width="1em" height="1em"` and `fill="currentColor"` with no hard-coded colours. Use the `svgrepo-icons` skill to find and download; suggested glyphs, executor's judgement on the exact pick:

| File | Glyph |
|---|---|
| `family-keys.svg` | pipe organ or accordion (solid) |
| `family-guitar.svg` | acoustic guitar (solid) |
| `family-strings.svg` | violin (solid) |
| `family-winds.svg` | trumpet (solid) |
| `family-synths.svg` | Solar `solar:soundwave-bold` via `https://api.iconify.design/solar/soundwave-bold.svg` |
| `family-world.svg` | Solar `solar:global-bold` via `https://api.iconify.design/solar/global-bold.svg` |
| `family-fun.svg` | drum (solid) |
| `star.svg` | Solar `solar:star-bold` via `https://api.iconify.design/solar/star-bold.svg` |

Normalization check for each file: `grep -c 'fill="currentColor"' file.svg` ≥ 1, `grep -c 'width="1em"' file.svg` = 1, `grep -cE '#[0-9a-fA-F]{3,6}' file.svg` = 0. Iconify SVGs come back already in `currentColor`; add `width="1em" height="1em"` if absent.

Add a row per icon to `MANIFEST.md` under a new `| family | … |` group, noting the source for each and that the non-Solar ones were normalized.

Replace `K/instrumentIcon.js`:

```js
// instrumentIcon.js — the house SVG icon name for an instrument / voice / GM
// family, chosen by keyword. Tiles in the Sound sheet read by family glyph
// (see voiceFamilies.js for the rail's own icons). First match wins, so keep
// the more specific rules above the generic ones.
const RULES = [
  [/pian|grand|clavichord|harpsichord|rhodes|wurl|honky/i, 'piano'],
  [/organ|accordion|harmonica|bandoneon|celesta|glocken|vibraphone|marimba|xylophone|bell|music box|dulcimer|chime/i, 'family-keys'],
  [/bass|guitar|banjo|ukulele|mandolin/i, 'family-guitar'],
  [/violin|viola|cello|contrabass|fiddle|string|orchestra|pizzicato|harp\b|timpani/i, 'family-strings'],
  [/sax|trumpet|trombone|tuba|cornet|\bhorn\b|brass|fanfare|flute|piccolo|recorder|whistle|\bpipe|clarinet|oboe|bassoon|reed|ocarina|shakuhachi|bottle/i, 'family-winds'],
  [/choir|voice|vocal|\baah|\booh/i, 'studio'],
  [/sitar|shamisen|koto|kalimba|bagpipe|shanai|yangqin|pipa|zheng|erhu|banhu|suona|sheng|dizi/i, 'family-world'],
  [/drum|percuss|\bkit\b|cymbal|\btom\b|taiko|conga|bongo|snare|agogo|woodblock|tinkle|steel|noise|seashore|bird|telephone|helicopter|applause|gunshot/i, 'family-fun'],
  [/synth|\bpad\b|\bfx\b|\blead\b|saw|square|sci-?fi|atmosphere|sweep|sound track|charang|goblin|rain|crystal|brightness|echoes|calliope|chiff|fifth/i, 'family-synths'],
];

/** House icon name for an instrument/voice/family name (falls back to the music note). */
export function instrumentIcon(name) {
  const s = String(name || '');
  for (const [re, icon] of RULES) if (re.test(s)) return icon;
  return 'music';
}

export default instrumentIcon;
```

Note the order: `bass|guitar` sits above `string` so "Bass" beats nothing else, and `harp\b` excludes harpsichord (already caught by the piano rule above it). `steel` catches Steel Drums but ALSO "Steel Guitar" — guitar is matched first, so fine; the test list above pins this.

**Step 4: Run** — both test files → pass. Also run `npx vitest run frontend/src/modules/Piano/ui/icons/` to be sure the manifest-driven suites still pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/ui/icons frontend/src/modules/Piano/PianoKiosk/instrumentIcon.js frontend/src/modules/Piano/PianoKiosk/instrumentIcon.test.js
git commit -m "feat(piano): family icons for the Sound rail; instrumentIcon returns house icon names, not emoji"
```

---

### Task 5: `sanitizeSoundPreset` strips unknown effect keys (E1 defence)

**Files:**
- Modify: `K/usePianoPreset.js:12-19`
- Modify: `K/usePianoPreset.test.js` (append)

**Step 1: Failing test** — append inside the existing top-level `describe` of `K/usePianoPreset.test.js` (read the file first to match its import of `sanitizeSoundPreset`; add the import if absent):

```js
  it('sanitizeSoundPreset keeps only type/level/on under reverb and chorus', () => {
    const sound = sanitizeSoundPreset({ voice: { pc: 0, name: 'Grand' }, reverb: { level: 64, on: true, type: 4, label: 'Medium' }, chorus: { level: 0, on: false, label: 'Off' } });
    expect(sound.reverb).toEqual({ level: 64, on: true, type: 4 });
    expect(sound.chorus).toEqual({ level: 0, on: false });
    expect(sound.voice).toEqual({ pc: 0, bank: 0, name: 'Grand' });
  });
```

**Step 2: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/usePianoPreset.test.js` → the new case FAILS (`label` present).

**Step 3: Implement** — in `K/usePianoPreset.js` replace `sanitizeSoundPreset`:

```js
// Only the fields the device understands survive a save. Anything else (a
// picker's display label, a future UI hint) would be written to the user's
// preset file and then compared by sameSoundPreset forever.
const EFFECT_KEYS = ['type', 'level', 'on'];
const effectOnly = (item) => {
  if (!item) return null;
  const out = {};
  for (const key of EFFECT_KEYS) if (item[key] !== undefined) out[key] = item[key];
  return out;
};

export function sanitizeSoundPreset(value) {
  if (!value || typeof value !== 'object' || value.voice?.pc == null) return null;
  return {
    voice: { ...value.voice, bank: value.voice.bank || 0 },
    reverb: effectOnly(value.reverb),
    chorus: effectOnly(value.chorus),
  };
}
```

**Step 4: Run** — same file → all pass (existing cases too; if one asserted an extra key survived, that case was wrong — fix it and say so in the commit).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/usePianoPreset.js frontend/src/modules/Piano/PianoKiosk/usePianoPreset.test.js
git commit -m "fix(piano): saved sounds keep only type/level/on under each effect"
```

---

### Task 6: Cap the house shortlist at 16

**Files:**
- Modify: `K/pianoConfigModel.js:160`
- Modify: `K/PianoConfig.test.js` (append; it already exercises `resolvePianoConfig` — match its call shape)

**Step 1: Failing test** — append:

```js
  it('caps shortlist.voices at 16 so the Mine grid never exceeds the 24-tile ceiling', () => {
    const voices = Array.from({ length: 20 }, (_, pc) => ({ pc, name: `V${pc}` }));
    const config = resolvePianoConfig({ shortlist: { voices } }, 'default');
    expect(config.shortlist.voices).toHaveLength(16);
    expect(config.shortlist.voices[0]).toEqual({ pc: 0, name: 'V0' });
  });
```

(If `resolvePianoConfig`'s raw shape nests shared config differently, look at the neighbouring tests in the same file and mirror them.)

**Step 2: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js` → FAIL (20).

**Step 3: Implement** — in `pianoConfigModel.js`, add above `resolvePianoConfig`:

```js
// The Sound sheet's Mine rail item is favourites (≤8) + this shortlist in a
// 24-tile grid that must not scroll. 16 is the remaining headroom.
const SHORTLIST_MAX = 16;
```

and change the `shortlist:` line to:

```js
    shortlist: (() => {
      const merged = { ...PIANO_CONFIG_DEFAULTS.shortlist, ...(shared.shortlist || {}), ...(p.shortlist || {}) };
      return { ...merged, voices: (merged.voices || []).slice(0, SHORTLIST_MAX) };
    })(),
```

**Step 4: Run** — same file → pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/pianoConfigModel.js frontend/src/modules/Piano/PianoKiosk/PianoConfig.test.js
git commit -m "feat(piano): cap the house shortlist at 16 voices"
```

---

### Task 7: `SettingsTile` + `SettingsSheets.scss`

**Files:**
- Create: `K/SettingsTile.jsx`
- Create: `K/SettingsTile.test.jsx`
- Create: `K/SettingsSheets.scss`

**Step 1: Failing test** — `K/SettingsTile.test.jsx`:

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SettingsTile from './SettingsTile.jsx';

vi.mock('../ui/icons/Icon.jsx', () => ({ default: () => <span aria-hidden /> }));

describe('SettingsTile', () => {
  it('renders a tile button and fires onPress', () => {
    const onPress = vi.fn();
    render(<SettingsTile icon="music" label="Play test note" onPress={onPress} />);
    const button = screen.getByRole('button', { name: 'Play test note' });
    expect(button).toHaveClass('piano-tbtn--tile');
    fireEvent.click(button);
    expect(onPress).toHaveBeenCalledOnce();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows its message as a status under the tile, toned by state', () => {
    render(<SettingsTile icon="music" label="Play test note" onPress={() => {}} message="Piano not connected." tone="failed" />);
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('Piano not connected.');
    expect(status).toHaveClass('is-failed');
  });

  it('passes emphasis, on and disabled through', () => {
    render(<SettingsTile icon="system-reboot" label="Tap again to reboot tablet" emphasis="danger" on disabled onPress={() => {}} />);
    const button = screen.getByRole('button', { name: 'Tap again to reboot tablet' });
    expect(button).toHaveClass('piano-tbtn--danger');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toBeDisabled();
  });
});
```

**Step 2: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/SettingsTile.test.jsx` → FAIL (module missing).

**Step 3: Implement**

`K/SettingsTile.jsx`:

```jsx
import TransportButton from './transport/TransportButton.jsx';
import './SettingsSheets.scss';

/**
 * SettingsTile — one action in a settings grid: a tile-layout TransportButton
 * with its own result line underneath, so what an action did shows up where
 * the finger is, never at the bottom of the sheet.
 *
 * @param {string} icon
 * @param {string} label
 * @param {'default'|'primary'|'danger'} [emphasis]
 * @param {boolean} [on] armed / selected
 * @param {boolean} [disabled]
 * @param {() => void} onPress
 * @param {string|null} [message] result or hint shown under the tile
 * @param {'idle'|'working'|'success'|'failed'} [tone] colours the message
 */
export default function SettingsTile({ icon, label, emphasis = 'default', on = false, disabled = false, onPress, message = null, tone = 'idle', className = '' }) {
  return (
    <div className={`piano-settings__tile${className ? ` ${className}` : ''}`}>
      <TransportButton layout="tile" icon={icon} label={label} emphasis={emphasis} on={on} disabled={disabled} onPress={onPress} />
      {message && <p role="status" className={`piano-settings__tilemsg is-${tone}`}>{message}</p>}
    </div>
  );
}
```

`K/SettingsSheets.scss`:

```scss
// Settings sheets (Sound, Piano maintenance) — the two full-canvas tile
// layouts. TransportSheet owns the shell and Transport.scss owns the button
// primitives; this file is only the grids, the status card and the danger strip.
// Nothing in here may introduce a scrollbar: the sheets are sized to the
// 1280×800 kiosk canvas and the Playwright gate asserts scrollHeight equals
// clientHeight for every state.

.piano-settings {
  &__tile { display: flex; flex-direction: column; gap: 0.3rem; min-width: 0; }
  &__tilemsg {
    margin: 0; font-size: 0.85rem; line-height: 1.2; color: var(--piano-muted, #9a9aa6);
    &.is-success { color: var(--piano-accent-text, #5fe39a); }
    &.is-failed { color: var(--piano-danger, #e05a4f); }
  }
  &__note { margin: 0; color: var(--piano-muted, #9a9aa6); font-size: 0.9rem; }

  // ---- Sound: rail | grid | tone ----
  &__sound { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 10rem 1fr 19rem; gap: 1rem; }
  &__rail { display: flex; flex-direction: column; gap: 0.4rem; min-width: 0; }
  &__grid { display: grid; grid-template-columns: repeat(4, 1fr); grid-auto-rows: max-content; gap: 0.6rem; align-content: start; min-width: 0; }
  &__empty { grid-column: 1 / -1; padding: 1rem 0; color: var(--piano-muted, #9a9aa6); }
  &__tonecol { display: flex; flex-direction: column; gap: 0.45rem; min-width: 0; }
  &__tonehead {
    display: flex; align-items: center; gap: 0.5rem; font-weight: 700;
    .piano-icon { font-size: 1.2em; color: var(--piano-accent-text, #5fe39a); }
    small { margin-left: auto; font-weight: 400; color: var(--piano-muted, #9a9aa6); }
  }
  &__current { display: flex; align-items: center; gap: 0.5rem; font-size: 1.15rem; margin-bottom: 0.25rem; .piano-icon { font-size: 1.4em; } }
  &__save { display: grid; grid-template-columns: 1fr auto; gap: 0.5rem; margin-top: auto; }

  // ---- Maintenance: status | big / everyday / danger ----
  &__maint { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: auto 1fr auto; gap: 1rem; }
  &__status {
    grid-column: 1; display: flex; flex-direction: column; gap: 0.5rem; padding: 1rem;
    border: 1px solid var(--piano-border, #34343f); border-radius: 12px; background: var(--piano-surface-2, #2a2a33);
    strong { font-size: 1.05rem; }
  }
  &__statusrow { display: flex; align-items: center; gap: 0.6rem; }
  &__dot {
    flex: 0 0 auto; width: 0.7rem; height: 0.7rem; border-radius: 50%; background: var(--piano-muted, #9a9aa6);
    &.is-on { background: var(--piano-accent, #2ec46f); }
    &.is-warn { background: var(--piano-warn, #e0a83a); }
    &.is-off { background: var(--piano-danger, #e05a4f); }
  }
  &__big { grid-column: 2; display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; align-content: start; .piano-tbtn--tile { min-height: 7rem; font-size: 1.1rem; } }
  &__everyday { grid-column: 1 / -1; display: grid; grid-template-columns: repeat(5, 1fr); gap: 0.6rem; align-content: start; }
  &__danger {
    grid-column: 1 / -1; display: grid; grid-template-columns: minmax(12rem, auto) 1fr 1fr; gap: 0.6rem; align-items: start;
    padding-top: 0.75rem; border-top: 2px solid var(--piano-danger, #e05a4f);
    p { margin: 0; align-self: center; color: var(--piano-muted, #9a9aa6); }
  }
  &__diag { grid-column: 1 / -1; grid-row: 2 / span 2; display: flex; flex-direction: column; gap: 0.5rem; min-height: 0; overflow: hidden; > .piano-settings__tile { align-self: flex-start; width: 10rem; } }
}
```

**Step 4: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/SettingsTile.test.jsx` → 3 pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/SettingsTile.jsx frontend/src/modules/Piano/PianoKiosk/SettingsTile.test.jsx frontend/src/modules/Piano/PianoKiosk/SettingsSheets.scss
git commit -m "feat(piano): SettingsTile with an inline result line, and the settings-sheet grid styles"
```

---

### Task 8: Rebuild `SoundPanel`

**Files:**
- Rewrite: `K/SoundPanel.jsx`
- Rewrite: `K/SoundPanel.test.jsx`

**Step 1: Write the new test file** — replace `K/SoundPanel.test.jsx` entirely:

```jsx
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const applyBundle = vi.fn();
let currentBundle = { voice: { pc: 0, bank: 0, name: 'Grand' }, reverb: { type: 4, level: 50, on: true }, chorus: { type: 2, level: 64, on: false } };
vi.mock('./usePianoSoundBundle.js', () => ({ usePianoSoundBundle: () => ({ currentBundle, applyBundle }) }));
const saveFavorite = vi.fn(async () => ({ ok: true }));
const removeFavorite = vi.fn(async () => ({ ok: true }));
let presetState;
vi.mock('./usePianoPreset.js', () => ({
  soundVoiceKey: (value) => value?.voice?.pc == null ? null : `${value.voice.pc}:${value.voice.bank || 0}`,
  sameSoundPreset: (a, b) => JSON.stringify({ voice: a?.voice, reverb: a?.reverb, chorus: a?.chorus }) === JSON.stringify({ voice: b?.voice, reverb: b?.reverb, chorus: b?.chorus }),
  usePianoPreset: () => presetState,
}));
let shortlist;
vi.mock('./PianoConfig.jsx', () => ({ usePianoKioskConfig: () => ({ config: { shortlist: { voices: shortlist } } }) }));
const groups = [
  { group: 'Piano', voices: [{ pc: 0, bank: 0, name: 'Grand' }, { pc: 1, bank: 0, name: 'Bright' }] },
  { group: 'Strings', voices: [{ pc: 40, bank: 0, name: 'Violin' }, { pc: 42, bank: 0, name: 'Cello' }] },
  { group: 'Brass', voices: [{ pc: 56, bank: 0, name: 'Trumpet' }] },
];
vi.mock('./usePianoSound.js', () => ({ usePianoSound: () => ({ device: { voiceGroups: groups, effects: { reverb: { types: [{ value: 4, label: 'Hall' }, { value: 5, label: 'Large Hall' }] }, chorus: { types: [{ value: 2, label: 'Chorus 3' }] } } } }) }));
const setPianoLevel = vi.fn();
vi.mock('./usePianoMix.js', () => ({ usePianoMix: () => ({ pianoLevel: 0.75, setPianoLevel }) }));
const midi = vi.hoisted(() => ({ sendNote: vi.fn(() => true) }));
vi.mock('./PianoMidiContext.jsx', () => ({ usePianoMidi: () => midi }));
const connection = vi.hoisted(() => ({ health: { state: 'ready', output: { state: 'up' } } }));
vi.mock('./usePianoConnection.js', () => ({ usePianoConnection: () => connection }));
vi.mock('../ui/icons/Icon.jsx', () => ({ default: () => <span aria-hidden /> }));

import SoundPanel from './SoundPanel.jsx';

const grid = () => screen.getByRole('group', { name: 'Instruments' });
const rail = () => screen.getByRole('group', { name: 'Instrument families' });

beforeEach(() => {
  applyBundle.mockReset(); saveFavorite.mockClear(); removeFavorite.mockClear(); setPianoLevel.mockClear(); midi.sendNote.mockReset().mockReturnValue(true);
  connection.health = { state: 'ready', output: { state: 'up' } };
  shortlist = [{ pc: 0, name: 'Grand' }, { pc: 40, bank: 0, name: 'Violin' }];
  currentBundle = { voice: { pc: 0, bank: 0, name: 'Grand' }, reverb: { type: 4, level: 50, on: true }, chorus: { type: 2, level: 64, on: false } };
  presetState = { preset: { favorites: [] }, saveFavorite, removeFavorite, canSave: true, persistenceState: 'idle', retryLastSound: vi.fn(), maxFavorites: 8, playerName: 'Alex' };
});

describe('SoundPanel', () => {
  it('renders nothing while closed and no maintenance actions when open', () => {
    const { container, rerender } = render(<SoundPanel open={false} onClose={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: 'Sound' })).toBeInTheDocument();
    expect(screen.queryByText(/repair|bluetooth|reboot|stuck notes/i)).toBeNull();
  });

  it('opens on Mine when the current voice is a favourite or shortlisted, and lights it', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(rail()).getByRole('button', { name: 'Mine' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grid()).getByRole('button', { name: 'Grand' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grid()).getByRole('button', { name: 'Violin' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('opens on the current voice family when it is not in Mine', () => {
    currentBundle = { ...currentBundle, voice: { pc: 56, bank: 0, name: 'Trumpet' } };
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(rail()).getByRole('button', { name: 'Winds & Brass' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(grid()).getByRole('button', { name: 'Trumpet' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('deduplicates Mine against favourites with a missing bank normalized to zero', () => {
    presetState.preset.favorites = [{ voice: { pc: 0, name: 'Grand' }, reverb: null, chorus: null }];
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(grid()).getAllByRole('button', { name: 'Grand' })).toHaveLength(1);
    expect(within(grid()).getByRole('button', { name: 'Violin' })).toBeInTheDocument();
  });

  it('recalls a saved sound whole and applies a catalog voice without touching piano level', () => {
    const saved = { voice: { pc: 42, bank: 0, name: 'Cello' }, reverb: null, chorus: null };
    presetState.preset.favorites = [saved];
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(grid()).getByRole('button', { name: 'Cello' }));
    expect(applyBundle).toHaveBeenCalledWith(saved);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Strings' }));
    fireEvent.click(within(grid()).getByRole('button', { name: 'Violin' }));
    expect(applyBundle).toHaveBeenLastCalledWith(expect.objectContaining({ voice: expect.objectContaining({ pc: 40, bank: 0 }) }));
    expect(setPianoLevel).not.toHaveBeenCalled();
  });

  it('shows every family in the rail and switches the grid with one tap, never nesting', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(within(rail()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Mine', 'Pianos', 'Keys & Organs', 'Guitars & Bass', 'Strings', 'Voices', 'Winds & Brass', 'Synths', 'World', 'Drums & Fun']);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Pianos' }));
    expect(within(grid()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Grand', 'Bright']);
    expect(screen.queryByText(/browse|done browsing/i)).toBeNull();
    expect(document.querySelector('details')).toBeNull();
  });

  it('does not claim a nearest reverb step for a noncanonical level but shows the value', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    const reverb = screen.getByRole('group', { name: 'Reverb' });
    expect(within(reverb).getAllByRole('button').every((b) => b.getAttribute('aria-pressed') === 'false')).toBe(true);
    expect(screen.getByText('now 39%')).toBeInTheDocument();
  });

  it('writes only level/on or type into the bundle — never a label', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(screen.getByRole('group', { name: 'Reverb' })).getByRole('button', { name: 'Medium' }));
    expect(applyBundle).toHaveBeenLastCalledWith(expect.objectContaining({ reverb: { type: 4, level: 64, on: true } }));
    fireEvent.click(within(screen.getByRole('group', { name: 'Reverb type' })).getByRole('button', { name: 'Big hall' }));
    expect(applyBundle).toHaveBeenLastCalledWith(expect.objectContaining({ reverb: { type: 5, level: 50, on: true } }));
    expect(JSON.stringify(applyBundle.mock.calls)).not.toMatch(/label/);
  });

  it('always shows Chorus with its type row and no More-effects toggle', () => {
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('group', { name: 'Chorus' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Chorus type' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more effects|less effects/i })).toBeNull();
  });

  it('sets exact device-wide levels and reports named-player persistence', () => {
    presetState.persistenceState = 'remembered';
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByText('Remembered for Alex')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('group', { name: 'Piano level' })).getByRole('button', { name: '25%' }));
    expect(setPianoLevel).toHaveBeenCalledWith(0.25);
  });

  it('auditions the current sound with Hear it, and explains when the piano is not connected', () => {
    const { rerender } = render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hear it' }));
    expect(midi.sendNote).toHaveBeenCalledWith(60, 100, 0, 500);
    connection.health = { state: 'offline', output: { state: 'down' } };
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Hear it' })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Piano not connected.');
  });

  it('uses Saved/Update/Save labels from full sound equality and keeps Remove separate', () => {
    presetState.preset.favorites = [{ ...currentBundle }];
    const { rerender } = render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Saved' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeEnabled();
    currentBundle = { ...currentBundle, reverb: { ...currentBundle.reverb, level: 64 } };
    rerender(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Update saved sound' })).toBeEnabled();
  });

  it('keeps over-limit favourites visible while blocking only a ninth instrument', () => {
    presetState.preset.favorites = Array.from({ length: 9 }, (_, pc) => ({ voice: { pc, bank: 0, name: `Saved ${pc}` }, reverb: null, chorus: null }));
    currentBundle = { ...currentBundle, voice: { pc: 20, bank: 0, name: 'New' } };
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Mine' }));
    expect(within(grid()).getAllByRole('button', { name: /Saved \d/ })).toHaveLength(9);
    expect(screen.getByRole('button', { name: 'Save sound' })).toBeDisabled();
  });

  it('shows Guest guidance as text instead of save actions', () => {
    presetState.canSave = false;
    render(<SoundPanel open onClose={vi.fn()} />);
    expect(screen.getByText('Pick a player to save sounds.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save sound|pick a player/i })).toBeNull();
  });

  it('shows an empty-state line on Mine when there is nothing saved or shortlisted', () => {
    shortlist = [];
    currentBundle = { ...currentBundle, voice: { pc: 56, bank: 0, name: 'Trumpet' } };
    render(<SoundPanel open onClose={vi.fn()} />);
    fireEvent.click(within(rail()).getByRole('button', { name: 'Mine' }));
    expect(screen.getByText('Save a sound and it will show up here.')).toBeInTheDocument();
  });
});
```

**Step 2: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/SoundPanel.test.jsx` → most FAIL against the old panel.

**Step 3: Implement** — replace `K/SoundPanel.jsx` entirely:

```jsx
import { useEffect, useMemo, useState } from 'react';
import { usePianoSoundBundle } from './usePianoSoundBundle.js';
import { sameSoundPreset, soundVoiceKey, usePianoPreset } from './usePianoPreset.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoSound } from './usePianoSound.js';
import { usePianoMix } from './usePianoMix.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoConnection } from './usePianoConnection.js';
import { buildFunnel } from './voiceFunnel.js';
import { FAMILIES, familyOf, partitionVoices } from './voiceFamilies.js';
import { instrumentIcon } from './instrumentIcon.js';
import TransportSheet from './transport/TransportSheet.jsx';
import TransportButton from './transport/TransportButton.jsx';
import StepGrid from './transport/StepGrid.jsx';
import SettingsTile from './SettingsTile.jsx';
import Icon from '../ui/icons/Icon.jsx';
import './SettingsSheets.scss';

// Five canonical steps per effect. A bundle whose level matches none of them
// (a legacy preset, a value set elsewhere) lights nothing and the head shows the
// real number — the picker never claims a nearest step it did not set.
const EFFECT_STEPS = Object.freeze([
  { label: 'Off', level: 0, on: false },
  { label: 'Low', level: 32, on: true },
  { label: 'Medium', level: 64, on: true },
  { label: 'High', level: 96, on: true },
  { label: 'Max', level: 127, on: true },
]);
const LEVEL_STEPS = Object.freeze([
  { label: 'Mute', value: 0 }, { label: '25%', value: 0.25 }, { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 }, { label: '100%', value: 1 },
]);
// Device type names shortened to fit a five-across tile row.
const TYPE_LABELS = Object.freeze({ 'Large Room': 'Big room', 'Large Hall': 'Big hall', 'Chorus 1': 'One', 'Chorus 2': 'Two', 'Chorus 3': 'Three', 'FB Chorus': 'Deep', Flanger: 'Flange' });

function EffectRows({ name, icon, value, config, onChange }) {
  const activeIndex = EFFECT_STEPS.findIndex((step) => step.level === value.level && step.on === !!value.on);
  const percent = value.on ? Math.round((value.level || 0) / 127 * 100) : 0;
  const types = config?.types || [];
  const typeIndex = types.findIndex((type) => type.value === value.type);
  return <>
    <div className="piano-settings__tonehead"><Icon name={icon} /><span>{name}</span>{activeIndex < 0 && <small>now {percent}%</small>}</div>
    <StepGrid ariaLabel={name} steps={EFFECT_STEPS.map((step) => ({ label: step.label }))} activeIndex={activeIndex} onPick={(i) => onChange({ level: EFFECT_STEPS[i].level, on: EFFECT_STEPS[i].on })} />
    {types.length > 0 && <StepGrid ariaLabel={`${name} type`} steps={types.map((type) => ({ label: TYPE_LABELS[type.label] || type.label }))} activeIndex={typeIndex} onPick={(i) => onChange({ type: types[i].value })} />}
  </>;
}

export default function SoundPanel({ open, onClose }) {
  const { currentBundle, applyBundle } = usePianoSoundBundle();
  const { preset, saveFavorite, removeFavorite, canSave, persistenceState, retryLastSound, maxFavorites, playerName } = usePianoPreset();
  const { config } = usePianoKioskConfig();
  const { device } = usePianoSound();
  const { pianoLevel, setPianoLevel } = usePianoMix();
  const midi = usePianoMidi();
  const { health } = usePianoConnection();
  const [family, setFamily] = useState(null); // null = follow the current voice
  const [favoriteMessage, setFavoriteMessage] = useState(null);
  const [heard, setHeard] = useState(null);

  useEffect(() => {
    if (!open) return;
    setFamily(null);
    setFavoriteMessage(null);
    setHeard(null);
  }, [open]);

  const saved = useMemo(() => preset?.favorites || [], [preset?.favorites]);
  const funnel = useMemo(() => buildFunnel({ favorites: saved, shortlistVoices: config?.shortlist?.voices || [], allGroups: device?.voiceGroups || [] }), [saved, config?.shortlist?.voices, device?.voiceGroups]);
  const families = useMemo(() => partitionVoices(funnel.groups), [funnel.groups]);
  const currentKey = soundVoiceKey(currentBundle);
  const currentName = currentBundle?.voice?.name || 'Keyboard';

  const applyVoice = (voice) => applyBundle({ ...currentBundle, voice: { ...voice, bank: voice.bank || 0 } });
  const applyEffect = (name, patch) => applyBundle({ ...currentBundle, [name]: { ...currentBundle[name], ...patch } });

  // Mine = favourites (recalled whole) then the deduped house shortlist (voice only).
  const mineTiles = useMemo(() => [
    ...saved.map((sound, index) => ({ key: `fav:${soundVoiceKey(sound)}:${index}`, voiceKey: soundVoiceKey(sound), name: sound.voice?.name || 'Sound', pick: () => applyBundle(sound) })),
    ...funnel.shortlist.map((voice) => ({ key: `short:${voice.pc}:${voice.bank || 0}`, voiceKey: `${voice.pc}:${voice.bank || 0}`, name: voice.name, pick: () => applyVoice(voice) })),
  ], [saved, funnel.shortlist]); // eslint-disable-line react-hooks/exhaustive-deps -- applyBundle/applyVoice are stable per render of the bundle they close over

  const autoFamily = mineTiles.some((tile) => tile.voiceKey === currentKey) ? 'mine' : (familyOf(currentBundle?.voice) || FAMILIES[0].id);
  const activeFamily = family ?? autoFamily;
  const gridTiles = activeFamily === 'mine' ? mineTiles
    : (families[activeFamily] || []).map((voice) => ({ key: `${voice.pc}:${voice.bank || 0}`, voiceKey: `${voice.pc}:${voice.bank || 0}`, name: voice.name, pick: () => applyVoice(voice) }));

  const savedInstrument = saved.find((sound) => soundVoiceKey(sound) === currentKey);
  const savedExactly = !!savedInstrument && sameSoundPreset(savedInstrument, currentBundle);
  const levelIndex = LEVEL_STEPS.findIndex((step) => step.value === pianoLevel);
  const outputUp = health?.output?.state === 'up';

  const save = async () => {
    setFavoriteMessage('Saving sound…');
    const result = await saveFavorite(currentBundle);
    setFavoriteMessage(result.ok ? 'Sound saved.' : result.reason === 'limit' ? 'Remove a saved sound before adding another.' : 'Couldn’t save sound.');
  };
  const remove = async () => {
    setFavoriteMessage('Removing sound…');
    const result = await removeFavorite(savedInstrument);
    setFavoriteMessage(result.ok ? 'Saved sound removed.' : 'Couldn’t remove saved sound.');
  };
  const hear = () => {
    const sent = midi.sendNote(60, 100, 0, 500);
    setHeard(sent ? null : 'Piano not connected.');
  };
  const persistenceCopy = persistenceState === 'saving' ? 'Saving…'
    : persistenceState === 'remembered' ? `Remembered for ${playerName}`
      : persistenceState === 'failed' ? 'Couldn’t save' : null;

  return <TransportSheet open={open} title="Sound" onClose={onClose} size="canvas" className="piano-sound-sheet">
    <div className="piano-settings__sound">
      <nav className="piano-settings__rail" role="group" aria-label="Instrument families">
        <TransportButton layout="rail" icon="star" label="Mine" on={activeFamily === 'mine'} onPress={() => setFamily('mine')} />
        {FAMILIES.map((item) => <TransportButton key={item.id} layout="rail" icon={item.icon} label={item.label} on={activeFamily === item.id} onPress={() => setFamily(item.id)} />)}
      </nav>

      <div className="piano-settings__grid" role="group" aria-label="Instruments">
        {gridTiles.length === 0 && <p className="piano-settings__empty">Save a sound and it will show up here.</p>}
        {gridTiles.map((tile) => <TransportButton key={tile.key} layout="tile" icon={instrumentIcon(tile.name)} label={tile.name} on={tile.voiceKey === currentKey} onPress={tile.pick} />)}
      </div>

      <div className="piano-settings__tonecol">
        <div className="piano-settings__current"><Icon name={instrumentIcon(currentName)} /><strong>{currentName}</strong></div>
        {currentBundle?.reverb && <EffectRows name="Reverb" icon="reverb" value={currentBundle.reverb} config={device?.effects?.reverb} onChange={(patch) => applyEffect('reverb', patch)} />}
        {currentBundle?.chorus && <EffectRows name="Chorus" icon="chorus" value={currentBundle.chorus} config={device?.effects?.chorus} onChange={(patch) => applyEffect('chorus', patch)} />}
        <div className="piano-settings__tonehead"><Icon name="volume" /><span>Piano level</span>{levelIndex < 0 && <small>now {Math.round(pianoLevel * 100)}%</small>}</div>
        <StepGrid ariaLabel="Piano level" steps={LEVEL_STEPS.map((step) => ({ label: step.label }))} activeIndex={levelIndex} onPick={(i) => setPianoLevel(LEVEL_STEPS[i].value)} />
        <p className="piano-settings__note">This piano remembers this level.</p>
        <SettingsTile icon="music" label="Hear it" emphasis="primary" disabled={!outputUp} onPress={hear} message={!outputUp ? 'Piano not connected.' : heard} tone={!outputUp || heard ? 'failed' : 'idle'} />
        {canSave ? <div className="piano-settings__save">
          <TransportButton label={savedExactly ? 'Saved' : savedInstrument ? 'Update saved sound' : 'Save sound'} icon="star" disabled={savedExactly || (!savedInstrument && saved.length >= maxFavorites)} onPress={save} />
          {savedInstrument && <TransportButton label="Remove" icon="trash" emphasis="quiet" onPress={remove} />}
        </div> : <p className="piano-settings__note">Pick a player to save sounds.</p>}
        {favoriteMessage && <p role="status" className="piano-settings__note">{favoriteMessage}</p>}
        {persistenceCopy && <p role="status" className="piano-settings__note">{persistenceCopy}{persistenceState === 'failed' && <> — <button type="button" className="piano-tbtn piano-tbtn--quiet" onClick={retryLastSound}>Retry</button></>}</p>}
      </div>
    </div>
  </TransportSheet>;
}
```

Notes for the implementer:
- `StepGrid` keys steps by `label`, so type labels within one row must be unique — `TYPE_LABELS` guarantees that for the MDG-400 profile.
- The "Hear it" test expects `getByRole('status')` to be the *only* status when output is down; `favoriteMessage` and `persistenceCopy` are null in that test, so this holds.
- If the eslint `react-hooks/exhaustive-deps` disable comment trips the repo's lint (`npm run lint` must stay at 0), move `applyVoice` into a `useCallback` on `[currentBundle, applyBundle]` and list it instead.

**Step 4: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/SoundPanel.test.jsx` → 15 pass. Then `npx vitest run frontend/src/modules/Piano/PianoKiosk/PianoChrome.test.jsx` — it renders `SoundPanel` through the chrome; it must still pass (it mocks the sheets or renders them closed).

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/SoundPanel.jsx frontend/src/modules/Piano/PianoKiosk/SoundPanel.test.jsx
git commit -m "feat(piano): Sound sheet as a full-canvas family rail, voice grid and tone column"
```

---

### Task 9: Rebuild `OperatorDrawer`

**Files:**
- Rewrite: `K/OperatorDrawer.jsx`
- Rewrite: `K/OperatorDrawer.test.jsx`

**Step 1: New test file** — keep the mock header of the existing file verbatim (lines 1–27: the `vi.hoisted` state, all `vi.mock` calls, the `import OperatorDrawer`, `renderDrawer`) and replace the `describe` block with:

```jsx
describe('Piano maintenance', () => {
  beforeEach(() => {
    vi.useFakeTimers(); repairConnection.mockClear(); screenOff.mockClear(); launchAndroidTarget.mockClear(); daylightAPI.mockClear(); midi.sendNote.mockReset().mockReturnValue(true); midi.sendPanic.mockReset().mockReturnValue(true);
    Object.assign(connection.health, { state: 'offline', copy: 'not connected', input: { state: 'down', name: null }, output: { state: 'down', name: null }, bridge: { state: 'unavailable', unavailable: true } });
    Object.assign(connection.repair, { state: 'idle', message: null });
  });
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers(); });

  it('uses a named dialog, a single repair action, and no raw MIDI controls', () => {
    renderDrawer();
    expect(screen.getByRole('dialog', { name: 'Piano maintenance' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Repair connection' })).toHaveLength(1);
    expect(screen.queryByText(/Program Change|Local On|Force reset MIDI|Restart audio & MIDI/)).toBeNull();
    expect(screen.queryByRole('button', { name: /connection details|advanced recovery/i })).toBeNull();
    expect(screen.queryByRole('heading', { level: 3 })).toBeNull();
  });

  it('reports every link from one source in the status card', () => {
    Object.assign(connection.health, { state: 'connecting', copy: 'connecting', input: { state: 'bridge', name: 'Keys' }, output: { state: 'down', name: null }, bridge: { state: 'reconnecting', unavailable: false } });
    renderDrawer();
    const card = screen.getByRole('group', { name: 'Connection' });
    expect(card).toHaveTextContent('Keys: Keys');
    expect(card).toHaveTextContent('Sound: not connected');
    expect(card).toHaveTextContent('Bridge: reconnecting…');
    expect(card.querySelectorAll('.is-on')).toHaveLength(1);
    expect(card.querySelectorAll('.is-off')).toHaveLength(1);
    expect(card.querySelectorAll('.is-warn')).toHaveLength(1);
  });

  it('shows Bluetooth pairing whenever configured, primary while not ready', () => {
    const { rerender } = renderDrawer();
    const bluetooth = screen.getByRole('button', { name: 'Bluetooth pairing' });
    expect(bluetooth).toHaveClass('piano-tbtn--primary');
    fireEvent.click(bluetooth);
    expect(launchAndroidTarget).toHaveBeenCalledWith('pkg/.Bluetooth');
    Object.assign(connection.health, { state: 'ready', copy: 'connected', input: { state: 'bridge', name: 'Keys' }, output: { state: 'up', name: 'Piano' }, bridge: { state: 'open', unavailable: false } });
    rerender(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} /></>);
    expect(screen.getByRole('button', { name: 'Bluetooth pairing' })).not.toHaveClass('piano-tbtn--primary');
    expect(screen.getByRole('button', { name: 'Repair connection' })).not.toHaveClass('piano-tbtn--primary');
  });

  it('repairs centrally and shows the repair message under the tile', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Repair connection' }));
    expect(repairConnection).toHaveBeenCalledTimes(1);
    Object.assign(connection.repair, { state: 'working', message: 'Repairing connection…' });
    renderDrawer();
    expect(screen.getAllByRole('button', { name: 'Repairing connection…' })[0]).toBeDisabled();
  });

  it('offers a test note only with output and reports whether it was sent on the tile', () => {
    connection.health.output = { state: 'up', name: 'Piano' };
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Play test note' }));
    expect(midi.sendNote).toHaveBeenCalledWith(60, 100, 0, 500);
    expect(screen.getByRole('status')).toHaveTextContent('Test note command sent.');
  });

  it('disables the test note without output', () => {
    renderDrawer();
    expect(screen.getByRole('button', { name: 'Play test note' })).toBeDisabled();
  });

  it('reports Stop stuck notes success and disconnected failure', () => {
    const { rerender } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Stop stuck notes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Stop stuck notes command sent.');
    midi.sendPanic.mockReturnValue(false);
    rerender(<><button type="button">opener</button><OperatorDrawer open onClose={vi.fn()} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Stop stuck notes' }));
    expect(screen.getByRole('status')).toHaveTextContent('Piano not connected.');
  });

  it('two-tap confirms display off with a visible armed state and reports the result', async () => {
    renderDrawer();
    const off = screen.getByRole('button', { name: 'Turn off display' });
    expect(off).toHaveClass('piano-tbtn--danger');
    fireEvent.click(off);
    expect(screenOff).not.toHaveBeenCalled();
    const armed = screen.getByRole('button', { name: 'Tap again to confirm' });
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(armed); });
    expect(screenOff).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('Display turned off.');
  });

  it('mounts the read-only MIDI log only while Diagnostics is shown, with a Back tile', () => {
    renderDrawer();
    expect(screen.queryByTestId('midi-monitor')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Diagnostics' }));
    expect(screen.getByTestId('midi-monitor')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Reboot tablet' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.queryByTestId('midi-monitor')).toBeNull();
    expect(screen.getByRole('button', { name: 'Reboot tablet' })).toBeTruthy();
  });

  it('keeps restart and reboot in the danger strip, armed visibly, and surfaces reboot API failure', async () => {
    daylightAPI.mockRejectedValueOnce(new Error('server offline'));
    renderDrawer();
    const strip = screen.getByRole('group', { name: 'Recovery' });
    expect(within(strip).getByRole('button', { name: 'Restart piano app' })).toHaveClass('piano-tbtn--danger');
    const reboot = within(strip).getByRole('button', { name: 'Reboot tablet' });
    expect(reboot).toHaveClass('piano-tbtn--danger');
    fireEvent.click(reboot);
    const armed = screen.getByRole('button', { name: 'Tap again to reboot tablet' });
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    await act(async () => { fireEvent.click(armed); });
    expect(daylightAPI).toHaveBeenCalledWith('api/v1/device/tablet-1/reboot', {}, 'POST');
    expect(screen.getByRole('status')).toHaveTextContent('Couldn’t reboot tablet: server offline');
  });

  it('keeps feedback adult-only with maintenance context', () => {
    renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Record feedback' }));
    expect(screen.getByTestId('feedback')).toHaveTextContent('piano-maintenance');
  });
});
```

Add `within` to the Testing Library import at the top of the file.

**Step 2: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/OperatorDrawer.test.jsx` → most FAIL.

**Step 3: Implement** — replace `K/OperatorDrawer.jsx` entirely:

```jsx
import { useCallback, useMemo, useState } from 'react';
import getLogger from '../../../lib/logging/Logger.js';
import { usePianoMidi } from './PianoMidiContext.jsx';
import { usePianoConnection } from './usePianoConnection.js';
import { usePianoKioskConfig } from './PianoConfig.jsx';
import { usePianoScreenOff } from './usePianoScreenOff.js';
import { screenOffFailureMessage } from './useScreenControl.js';
import { useArmedAction } from '../../../lib/identity/useArmedAction.js';
import { launchAndroidTarget } from '../../../lib/fkb.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import PianoMidiMonitor from './PianoMidiMonitor.jsx';
import TransportSheet from './transport/TransportSheet.jsx';
import SettingsTile from './SettingsTile.jsx';
import FeedbackOverlay from '@/modules/Feedback/FeedbackOverlay.jsx';
import './SettingsSheets.scss';

// Bridge link → dot tone + words. One place, so the card and the chip agree.
const bridgeRow = (bridge) => {
  if (bridge.unavailable) return { tone: 'off', text: 'not running' };
  if (bridge.state === 'open') return { tone: 'on', text: 'connected' };
  if (['idle', 'connecting', 'reconnecting'].includes(bridge.state)) return { tone: 'warn', text: `${bridge.state}…` };
  return { tone: 'off', text: bridge.state || 'not connected' };
};

function StatusRow({ label, tone, text }) {
  return <div className="piano-settings__statusrow"><span className={`piano-settings__dot is-${tone}`} aria-hidden /><span>{label}: {text}</span></div>;
}

export default function OperatorDrawer({ open, onClose }) {
  const midi = usePianoMidi();
  const { health, repair, repairConnection } = usePianoConnection();
  const { config, pianoId } = usePianoKioskConfig();
  const turnOffPianoScreen = usePianoScreenOff();
  const logger = useMemo(() => getLogger().child({ component: 'piano-maintenance', pianoId }), [pianoId]);
  const [diagnostics, setDiagnostics] = useState(false);
  const [action, setAction] = useState({ state: 'idle', message: null, name: null });
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const report = useCallback((name, state, message, detail = {}) => {
    setAction({ name, state, message });
    const data = { action: name, state, ...detail };
    if (state === 'failed') logger.warn('piano.maintenance.action', data);
    else logger.info('piano.maintenance.action', data);
  }, [logger]);
  const messageFor = (name) => (action.name === name ? action.message : null);
  const toneFor = (name) => (action.name === name ? action.state : 'idle');

  const playTestNote = useCallback(() => {
    report('test-note', 'working', 'Sending test note…');
    const sent = midi.sendNote(60, 100, 0, 500);
    report('test-note', sent ? 'success' : 'failed', sent ? 'Test note command sent.' : 'Piano not connected.', { sent });
  }, [midi, report]);

  const stopStuckNotes = useCallback(() => {
    report('stop-stuck-notes', 'working', 'Stopping notes…');
    const sent = midi.sendPanic();
    report('stop-stuck-notes', sent ? 'success' : 'failed', sent ? 'Stop stuck notes command sent.' : 'Piano not connected.', { sent });
  }, [midi, report]);

  const { armed: screenArmed, trigger: screenOff } = useArmedAction(async () => {
    report('screen-off', 'working', 'Turning off display…');
    const result = await turnOffPianoScreen();
    report('screen-off', result?.ok ? 'success' : 'failed', result?.ok ? 'Display turned off.' : screenOffFailureMessage(result), result);
  }, { armMs: 3000 });

  const { armed: reloadArmed, trigger: reload } = useArmedAction(() => {
    report('restart-app', 'working', 'Restarting piano app…');
    window.location.reload();
  }, { armMs: 3000 });

  const deviceId = config?.screensaver?.deviceId || null;
  const { armed: rebootArmed, trigger: reboot } = useArmedAction(async () => {
    report('reboot-tablet', 'working', 'Requesting tablet reboot…');
    try {
      const result = await DaylightAPI(`api/v1/device/${deviceId}/reboot`, {}, 'POST');
      if (result?.ok === false) throw new Error(result.error || 'request rejected');
      report('reboot-tablet', 'success', 'Tablet reboot requested.');
    } catch (error) {
      report('reboot-tablet', 'failed', `Couldn’t reboot tablet: ${error?.message || 'request failed'}`);
    }
  }, { armMs: 3000 });

  const ready = health.state === 'ready';
  const inputUp = health.input.state !== 'down';
  const outputUp = health.output.state === 'up';
  const bridge = bridgeRow(health.bridge || {});
  const repairing = repair.state === 'working';

  return <TransportSheet open={open} title="Piano maintenance" onClose={onClose} size="canvas" className="piano-maintenance-sheet">
    <div className="piano-settings__maint">
      <div className="piano-settings__status" role="group" aria-label="Connection">
        <strong>{health.copy ? `Piano ${health.copy}` : 'Piano'}</strong>
        <StatusRow label="Keys" tone={inputUp ? 'on' : 'off'} text={inputUp ? (health.input.name || 'connected') : 'not connected'} />
        <StatusRow label="Sound" tone={outputUp ? 'on' : 'off'} text={outputUp ? (health.output.name || 'connected') : 'not connected'} />
        <StatusRow label="Bridge" tone={bridge.tone} text={bridge.text} />
      </div>

      <div className="piano-settings__big">
        {config?.bluetooth && <SettingsTile icon="bluetooth-active" label="Bluetooth pairing" emphasis={ready ? 'default' : 'primary'} onPress={() => { logger.info('piano.maintenance.bluetooth', {}); launchAndroidTarget(config.bluetooth); }} />}
        <SettingsTile icon="connection" label={repairing ? 'Repairing connection…' : 'Repair connection'} emphasis={ready ? 'default' : 'primary'} disabled={repairing} onPress={repairConnection} message={repair.message} tone={repair.state === 'failed' ? 'failed' : repair.state === 'success' ? 'success' : 'idle'} />
      </div>

      {diagnostics ? <div className="piano-settings__diag">
        <SettingsTile icon="back" label="Back" onPress={() => setDiagnostics(false)} />
        <PianoMidiMonitor />
      </div> : <>
        <div className="piano-settings__everyday">
          <SettingsTile icon="music" label="Play test note" disabled={!outputUp} onPress={playTestNote} message={messageFor('test-note')} tone={toneFor('test-note')} />
          <SettingsTile icon="stop" label="Stop stuck notes" onPress={stopStuckNotes} message={messageFor('stop-stuck-notes')} tone={toneFor('stop-stuck-notes')} />
          <SettingsTile icon="system-shutdown" label={screenArmed ? 'Tap again to confirm' : 'Turn off display'} emphasis="danger" on={screenArmed} onPress={screenOff} message={messageFor('screen-off')} tone={toneFor('screen-off')} />
          <SettingsTile icon="settings" label="Diagnostics" onPress={() => setDiagnostics(true)} />
          <SettingsTile icon="record" label="Record feedback" onPress={() => setFeedbackOpen(true)} />
        </div>
        <div className="piano-settings__danger" role="group" aria-label="Recovery">
          <p>Recovery — these interrupt whatever is playing.</p>
          <SettingsTile icon="system-reboot" label={reloadArmed ? 'Tap again to restart piano app' : 'Restart piano app'} emphasis="danger" on={reloadArmed} onPress={reload} message={messageFor('restart-app')} tone={toneFor('restart-app')} />
          {deviceId && <SettingsTile icon="system-shutdown" label={rebootArmed ? 'Tap again to reboot tablet' : 'Reboot tablet'} emphasis="danger" on={rebootArmed} onPress={reboot} message={messageFor('reboot-tablet')} tone={toneFor('reboot-tablet')} />}
        </div>
      </>}
    </div>
    <FeedbackOverlay open={feedbackOpen} app="piano" context={{ pianoId, surface: 'piano-maintenance' }} onClose={() => setFeedbackOpen(false)} />
  </TransportSheet>;
}
```

**Step 4: Run** — `npx vitest run frontend/src/modules/Piano/PianoKiosk/OperatorDrawer.test.jsx frontend/src/modules/Piano/PianoKiosk/PianoChrome.test.jsx` → all pass.

**Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/OperatorDrawer.jsx frontend/src/modules/Piano/PianoKiosk/OperatorDrawer.test.jsx
git commit -m "feat(piano): Maintenance as a status card, Bluetooth and Repair up front, and a danger strip that shows its armed state"
```

---

### Task 10: Delete `PianoSheet` and the orphaned SCSS

**Files:**
- Delete: `K/PianoSheet.jsx`, `K/PianoSheet.test.jsx`
- Modify: `frontend/src/Apps/PianoApp.scss` — remove the `.piano-sheet` block (the comment starting `// Shared player/adult sheet.` through its closing brace, ≈ lines 150–169), the whole `.piano-sound-panel { … }` block (≈ 2488–2585) and the whole `/* Adult-only Maintenance additions. … */ .piano-operator-drawer { … }` block (≈ 2587–2643). Leave the `@media (prefers-reduced-motion)` block that follows.

**Step 1: Prove nothing else imports it**

Run: `grep -rn "PianoSheet" frontend/src --include='*.jsx' --include='*.js' | grep -v "PianoKiosk/PianoSheet"`
Expected: no output. (The producer's `.piano-sheet` *class* in `producer/TransportSheets.scss` is a different thing and stays.)

**Step 2: Delete and edit**

```bash
git rm frontend/src/modules/Piano/PianoKiosk/PianoSheet.jsx frontend/src/modules/Piano/PianoKiosk/PianoSheet.test.jsx
```

Then remove the three SCSS blocks. Use line numbers from a fresh `grep -n "^\.piano-sheet {\|^\.piano-sound-panel {\|^\.piano-operator-drawer {\|^/\* ---- Task 30" frontend/src/Apps/PianoApp.scss` — do not trust the approximate numbers above.

**Step 3: Parity check** — the class sets must agree:

```bash
grep -rho 'piano-settings__[a-z-]*' frontend/src/modules/Piano/PianoKiosk/SettingsSheets.scss | sort -u > /tmp/scss.txt
grep -rho 'piano-settings__[a-z-]*' frontend/src/modules/Piano/PianoKiosk/*.jsx | sort -u > /tmp/jsx.txt
diff /tmp/scss.txt /tmp/jsx.txt
```

Expected: empty diff (every class styled is rendered and vice-versa). If SCSS has extras, delete them; if JSX has extras, style or rename them.

Also: `grep -c "piano-sound-panel\|piano-operator-drawer\|piano-sheet__" frontend/src/Apps/PianoApp.scss frontend/src/modules/Piano/PianoKiosk/*.jsx` → all `0`.

**Step 4: Run the whole kiosk suite and lint**

```bash
npx vitest run frontend/src/modules/Piano
npm run lint
```

Expected: all pass; lint 0 problems.

**Step 5: Commit**

```bash
git add -A frontend/src/Apps/PianoApp.scss frontend/src/modules/Piano/PianoKiosk
git commit -m "chore(piano): delete PianoSheet and the settings styles the August rebuild orphaned"
```

---

### Task 11: Docs and config

**Files:**
- Modify: `docs/reference/piano/README.md` (the "**The chrome**" bullet, ≈ line 213)
- Modify (data tree, NOT the repo): `$DAYLIGHT_BASE_PATH/data/household/piano/config.yml` — `DAYLIGHT_BASE_PATH` is in `.env` at the repo root
- Modify: `docs/_wip/bugs/2026-09-02-piano-kiosk-settings-sheets-unusable-on-touch.md` status line

**Step 1: README** — replace the chrome bullet's second and third sentences with:

> Tap the chip to open **Sound** — a full-canvas sheet with a family rail (Mine, Pianos, Keys & Organs, Guitars & Bass, Strings, Voices, Winds & Brass, Synths, World, Drums & Fun), a one-tap voice grid, and a tone column of Reverb / Chorus / Piano level ladders with a "Hear it" audition; hold it for 550ms to open adult-only **Piano maintenance** — a status card, Bluetooth pairing and Repair connection up front, everyday tiles, and a danger strip for Restart / Reboot with a visible armed state. Neither sheet scrolls at 1280×800. There is deliberately no Settings gear.

**Step 2: Config** — confirm no key exists, then append:

```bash
grep -c '^shortlist:' "$DAYLIGHT_BASE_PATH/data/household/piano/config.yml"   # expect 0
cat >> "$DAYLIGHT_BASE_PATH/data/household/piano/config.yml" <<'EOF'

# House shortlist for the Sound sheet's "Mine" rail (deduped against the
# player's favourites; capped at 16 by the frontend). Restart to reload.
shortlist:
  voices:
    - { pc: 0,  name: Acoustic Grand }
    - { pc: 4,  name: Electric Piano 1 }
    - { pc: 6,  name: Harpsichord }
    - { pc: 19, name: Church Organ }
    - { pc: 24, name: Nylon Guitar }
    - { pc: 48, name: String Ensemble 1 }
    - { pc: 52, name: Choir Aahs }
    - { pc: 11, name: Vibraphone }
EOF
```

If the file already has a top-level `shortlist:` (count ≠ 0), stop and show it rather than appending a duplicate key. This file is on the shared Dropbox tree and is live on prod immediately — that is fine; today's UI renders it as "Recommended".

**Step 3: Bug report** — change its `**Status:**` line to `**Status:** fixed on \`piano/settings-landscape\` (unmerged); see the plan.`

**Step 4: Commit (repo files only)**

```bash
git add docs/reference/piano/README.md docs/_wip/bugs/2026-09-02-piano-kiosk-settings-sheets-unusable-on-touch.md
git commit -m "docs(piano): describe the landscape settings sheets; mark the UX bug fixed on branch"
```

---

### Task 12: Visual gate — nothing scrolls at 1280×800

**Files:**
- Create: `tests/live/flow/piano/piano-settings-sheets.runtime.test.mjs`
- Output: `tests/_artifacts/piano-settings/*.png` (add `tests/_artifacts/` to `.gitignore` if it is not already ignored — check with `git check-ignore -q tests/_artifacts && echo ignored`)

**Before running:** `lsof -i :3111`. If the dev server is running, Playwright reuses it. If nothing is on 3111, Playwright's `webServer` starts `npm run dev` — one stack, which is allowed. **Never** start `node backend/index.js` by hand alongside a running server.

**Step 1: Write the test**

```js
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// The settings sheets are sized to the kiosk canvas; a scrollbar is a layout
// bug. Four states, each screenshotted for a human look and asserted not to
// overflow. Arming Reboot is a single tap (the action needs a second) — do NOT
// tap it twice, and never tap "Turn off display" here: on the real kiosk that
// kills touch until FKB REST recovers it.
const OUT = 'tests/_artifacts/piano-settings';
const CHIP = '.piano-chrome__chip';

async function noOverflow(page, name) {
  const panel = page.locator('.piano-tsheet--canvas .piano-tsheet__panel');
  await expect(panel).toBeVisible();
  const sizes = await panel.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
  expect(sizes.sh, `${name} scrolls vertically`).toBe(sizes.ch);
  expect(sizes.sw, `${name} scrolls horizontally`).toBe(sizes.cw);
  const inner = await panel.evaluate((el) => [...el.querySelectorAll('*')].filter((n) => n.scrollHeight > n.clientHeight + 1 && getComputedStyle(n).overflowY !== 'visible' && n.clientHeight > 0).map((n) => n.className).slice(0, 5));
  expect(inner, `${name} has an inner scroll region`).toEqual([]);
}

test.describe('piano settings sheets', () => {
  test.beforeAll(() => mkdirSync(OUT, { recursive: true }));
  test.use({ viewport: { width: 1280, height: 800 } });

  test('Sound and Maintenance fit the canvas in every state', async ({ page }) => {
    await page.goto('/piano');
    await page.locator(CHIP).waitFor({ state: 'visible', timeout: 30_000 });

    await page.locator(CHIP).click();
    await noOverflow(page, '1-sound-current-family');
    await page.getByRole('button', { name: 'Winds & Brass' }).click();
    await noOverflow(page, '2-sound-winds-and-brass');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Sound' })).toHaveCount(0);

    const box = await page.locator(CHIP).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(700);
    await page.mouse.up();
    await expect(page.getByRole('dialog', { name: 'Piano maintenance' })).toBeVisible();
    await noOverflow(page, '3-maintenance-idle');
    await page.getByRole('button', { name: 'Reboot tablet' }).click();
    await expect(page.getByRole('button', { name: 'Tap again to reboot tablet' })).toBeVisible();
    await noOverflow(page, '4-maintenance-reboot-armed');
    await page.keyboard.press('Escape');
  });
});
```

If `/piano` redirects to a named piano in this household, follow it (`page.url()` after goto) — the chip selector is the same.

**Step 2: Run**

Run: `npx playwright test tests/live/flow/piano/piano-settings-sheets.runtime.test.mjs --reporter=line`
Expected: 1 passed; four PNGs in `tests/_artifacts/piano-settings/`.

**Step 3: Look at the PNGs.** Read all four with the Read tool and check, as a person would: rail icons present, current voice lit, tone column fully visible, Maintenance status card readable, Bluetooth and Repair the largest tiles, the armed Reboot tile amber. Then open the Producer mode's drum-loop sheet once (`/piano` → Studio/Producer → add drum loop) and screenshot it — Task 10 removed a global `.piano-sheet` rule that was leaking onto it; it should look the same or better (centered, not stretched). If it broke, the fix belongs in `producer/TransportSheets.scss`, not in a revived global rule.

If a state overflows: the fix is layout (tile `min-height`, column widths in `SettingsSheets.scss`), never `overflow: auto`.

**Step 4: Commit**

```bash
git add tests/live/flow/piano/piano-settings-sheets.runtime.test.mjs .gitignore
git commit -m "test(piano): screenshot gate — the settings sheets never scroll at 1280x800"
```

---

### Task 13: Full verification before hand-off

```bash
npx vitest run frontend/src/modules/Piano          # all kiosk suites
npm run lint                                        # 0 problems
npm run test:unit:vitest                            # the repo's vitest gate
git status --short                                  # only intended files
git log --oneline main..HEAD                        # 12 commits, one per task
```

Then report per `superpowers:verification-before-completion`: paste the summary lines, list the four PNG paths, and say what was *not* verified (the real tablet — the design-scale canvas in desktop Chrome is the proxy).

Hand-off after that follows `superpowers:finishing-a-development-branch`: merge into main is the house default (no PRs), but this branch must be seen on the kiosk tablet before merging — the visual gate runs in desktop Chrome, and the August rebuild shipped green with exactly this gap.
