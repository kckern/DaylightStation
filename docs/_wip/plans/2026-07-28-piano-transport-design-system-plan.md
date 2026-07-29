# PianoKiosk Transport Design System — Wave 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `transport/` primitive family (button, sheet, step grid, volume/key/tempo/loop sheets) and migrate Sheet Music, Karaoke/Singalong/Playalong, and Music onto it; re-point Videos' volume at the shared sheet.

**Architecture:** New presentational components under `frontend/src/modules/Piano/PianoKiosk/transport/`, styled by one `Transport.scss` (imported from the components, Vite handles it — same pattern as `producer/SongView.scss`). Surfaces keep their own transport *engines* and layout wrappers; only button faces and pop-out surfaces change. `ScoreTransportBar`'s memo shell and three-zone geography are preserved.

**Tech Stack:** React 18 JSX, SCSS, inline-SVG icons via `icons/Icon.jsx` (`import.meta.glob` over `icons/svg/*.svg`), vitest + @testing-library/react (run from repo root: `npx vitest run <file>` — root `vitest.config.mjs` supplies the jsdom-like env, jest-dom matchers, and frontend aliases).

**Spec:** `docs/_wip/plans/2026-07-28-piano-transport-design-system-spec.md`
**Audit:** `docs/_wip/audits/2026-07-27-piano-kiosk-playback-controls.md`

## Global Constraints

- Touch targets **≥ 3rem (48 px)** — enforced by `.piano-tbtn` and asserted by test.
- **Never Unicode symbol characters as button faces** — inline SVG via `Icon` only. ASCII text labels (`"100%"`, `"Key +2"`, `"-6"`, `"+6"` with ASCII hyphen/plus) are fine.
- **No drag sliders** — discrete tap targets only.
- `ScoreTransportBar` keeps its four `React.memo` clusters and gate-in-place rules; do not restructure its shell.
- Do NOT touch: `producer/` (its `TempoSheet`/`KeySheet`/`TransportBar` are a later wave), `modes/Studio/`, `modes/Videos/FullscreenTransportOverlay.jsx`, `modes/Composer/`.
- All new components are presentational; state stays lifted in hosts.
- Frontend logging rule: no new raw `console.*` (these components need no logging).
- Commit after every task (this host may commit autonomously).
- Run each new/changed test file after writing it; at the end run the whole PianoKiosk colocated suite.

---

### Task 1: Shared transport icons

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/icons/svg/minus.svg`
- Create: `frontend/src/modules/Piano/PianoKiosk/icons/svg/plus.svg`
- Create: `frontend/src/modules/Piano/PianoKiosk/icons/svg/chevron-down.svg`
- Create: `frontend/src/modules/Piano/PianoKiosk/icons/svg/quarter-note.svg`
- Test: `frontend/src/modules/Piano/PianoKiosk/icons/transportIcons.test.jsx`

**Interfaces:**
- Produces: `<Icon name="minus"|"plus"|"chevron-down"|"quarter-note" />` renderable by every later task.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Piano/PianoKiosk/icons/transportIcons.test.jsx
import { render } from '@testing-library/react';
import Icon from './Icon.jsx';

// Icon returns null for unknown names, so an empty span proves the file loaded.
describe('transport icons', () => {
  it.each(['minus', 'plus', 'chevron-down', 'quarter-note'])('renders %s as inline svg', (name) => {
    const { container } = render(<Icon name={name} />);
    const span = container.querySelector('.piano-icon');
    expect(span).not.toBeNull();
    expect(span.innerHTML).toContain('<svg');
    expect(span.innerHTML).toContain('currentColor');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/icons/transportIcons.test.jsx`
Expected: FAIL — `expect(span).not.toBeNull()` (Icon returns null; the svg files don't exist).

- [ ] **Step 3: Create the four SVG files**

Match the existing set's contract: `width/height="1em"`, `viewBox="0 0 24 24"`, `fill="currentColor"`. Minus/plus use the Solar-Bold filled-circle style of `close.svg`; chevron-down and quarter-note carry over the exact paths from `modes/SheetMusic/icons.jsx` (retired in Task 10).

```xml
<!-- minus.svg -->
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10M8 11.25a.75.75 0 0 0 0 1.5h8a.75.75 0 0 0 0-1.5z" clip-rule="evenodd"/></svg>
```

```xml
<!-- plus.svg -->
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="M22 12c0 5.523-4.477 10-10 10S2 17.523 2 12S6.477 2 12 2s10 4.477 10 10m-9.25-4a.75.75 0 0 0-1.5 0v3.25H8a.75.75 0 0 0 0 1.5h3.25V16a.75.75 0 0 0 1.5 0v-3.25H16a.75.75 0 0 0 0-1.5h-3.25z" clip-rule="evenodd"/></svg>
```

```xml
<!-- chevron-down.svg -->
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>
```

```xml
<!-- quarter-note.svg -->
<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24"><path fill="currentColor" d="M14.5 3H16v13.5a3.5 3.5 0 1 1-1.5-2.88z"/></svg>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/icons/transportIcons.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/icons/
git commit -m "feat(piano): add minus/plus/chevron-down/quarter-note to the shared icon set"
```

---

### Task 2: `TransportButton` + `Transport.scss`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/TransportButton.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/Transport.scss`
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/TransportButton.test.jsx`

**Interfaces:**
- Consumes: `Icon` from `../icons/Icon.jsx`.
- Produces: `TransportButton({ icon, label, ariaLabel, emphasis='default'|'primary'|'quiet', on=false, disabled=false, onPress, className='' })` — the button primitive every later task renders. `on` maps to `aria-pressed` + `is-on`; `ariaLabel` is REQUIRED when icon-only.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/TransportButton.test.jsx
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { render, fireEvent, screen } from '@testing-library/react';
import TransportButton from './TransportButton.jsx';

describe('TransportButton', () => {
  it('renders an icon-only button with its aria-label and fires onPress', () => {
    const onPress = vi.fn();
    render(<TransportButton icon="play" ariaLabel="Play" onPress={onPress} />);
    const btn = screen.getByRole('button', { name: 'Play' });
    expect(btn.querySelector('.piano-icon')).not.toBeNull();
    fireEvent.click(btn);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders a text label and emphasis/state classes', () => {
    render(<TransportButton label="Key +2" emphasis="primary" on onPress={() => {}} />);
    const btn = screen.getByRole('button', { name: 'Key +2' });
    expect(btn.className).toContain('piano-tbtn--primary');
    expect(btn.className).toContain('is-on');
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('disabled blocks onPress', () => {
    const onPress = vi.fn();
    render(<TransportButton label="Tempo" disabled onPress={onPress} />);
    fireEvent.click(screen.getByRole('button', { name: 'Tempo' }));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('SCSS enforces the 48px (3rem) kiosk floor', () => {
    // jsdom computes no layout, so assert the stylesheet source directly.
    const scss = readFileSync(fileURLToPath(new URL('./Transport.scss', import.meta.url)), 'utf8');
    expect(scss).toMatch(/\.piano-tbtn\s*\{[^}]*min-height:\s*3rem/s);
    expect(scss).toMatch(/\.piano-tbtn\s*\{[^}]*min-width:\s*3rem/s);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/TransportButton.test.jsx`
Expected: FAIL — cannot resolve `./TransportButton.jsx`.

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/TransportButton.jsx
import Icon from '../icons/Icon.jsx';
import './Transport.scss';

/**
 * TransportButton — the one kiosk transport button primitive (design-system
 * wave 1; audit §4.1). Enforces the touch rules in one place: ≥3rem box,
 * SVG-icon faces (never Unicode glyphs), `is-on` grammar via aria-pressed.
 *
 * @param {string} [icon] - shared icon name (icons/svg/*.svg)
 * @param {string} [label] - ASCII text label; icon and label may combine
 * @param {string} [ariaLabel] - required when icon-only
 * @param {'default'|'primary'|'quiet'} [emphasis]
 * @param {boolean} [on] - lit/latched state (aria-pressed + .is-on)
 * @param {boolean} [disabled]
 * @param {() => void} [onPress]
 * @param {string} [className] - layout hooks appended by the host
 */
export default function TransportButton({
  icon, label, ariaLabel, emphasis = 'default', on = false,
  disabled = false, onPress, className = '', ...rest
}) {
  const classes = [
    'piano-tbtn',
    emphasis !== 'default' ? `piano-tbtn--${emphasis}` : '',
    on ? 'is-on' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <button
      type="button"
      className={classes}
      aria-label={ariaLabel}
      aria-pressed={on || undefined}
      disabled={disabled}
      onClick={onPress}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {label != null && <span className="piano-tbtn__label">{label}</span>}
    </button>
  );
}
```

```scss
// frontend/src/modules/Piano/PianoKiosk/transport/Transport.scss
// Transport design system (wave 1) — the ONE place kiosk transport chrome is
// styled. Tokens fall back so the sheet works on both stage (dark) and surface
// hosts; hosts may override the custom properties, never the rules.

.piano-tbtn {
  // The kiosk touch floor: 3rem = 48px at the 16px root (audit F4).
  min-width: 3rem;
  min-height: 3rem;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.4rem;
  padding: 0.35rem 0.75rem;
  border: 1px solid var(--piano-tbtn-border, rgba(255, 255, 255, 0.22));
  border-radius: 0.6rem;
  background: var(--piano-tbtn-bg, rgba(255, 255, 255, 0.08));
  color: var(--piano-tbtn-fg, inherit);
  font: inherit;
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;

  .piano-icon { font-size: 1.25em; display: inline-flex; }

  &.is-on {
    background: var(--piano-tbtn-on-bg, rgba(94, 170, 255, 0.28));
    border-color: var(--piano-tbtn-on-border, rgba(94, 170, 255, 0.8));
  }
  &:disabled { opacity: 0.4; cursor: default; }
}

.piano-tbtn--primary {
  background: var(--piano-tbtn-primary-bg, #3878c2);
  border-color: var(--piano-tbtn-primary-bg, #3878c2);
  color: var(--piano-tbtn-primary-fg, #fff);
  min-width: 4.5rem;
}

.piano-tbtn--quiet {
  background: transparent;
  border-color: transparent;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/TransportButton.test.jsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/
git commit -m "feat(piano): TransportButton primitive + Transport.scss (48px floor, SVG faces)"
```

---

### Task 3: `TransportSheet`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/Transport.scss` (append)
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.test.jsx`

**Interfaces:**
- Consumes: `TransportButton` (close button).
- Produces: `TransportSheet({ open, title, onClose, children })` — modal shell: scrim (tap dismisses), centered sheet, titled header, 48 px close. Renders `null` when `!open`. `role="dialog"` `aria-modal="true"` `aria-label={title}`.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.test.jsx
import { render, fireEvent, screen } from '@testing-library/react';
import TransportSheet from './TransportSheet.jsx';

describe('TransportSheet', () => {
  it('renders nothing when closed', () => {
    const { container } = render(<TransportSheet open={false} title="Key" onClose={() => {}}>x</TransportSheet>);
    expect(container.firstChild).toBeNull();
  });

  it('renders dialog with title, children, and closes via the close button', () => {
    const onClose = vi.fn();
    render(<TransportSheet open title="Key" onClose={onClose}><p>body</p></TransportSheet>);
    const dialog = screen.getByRole('dialog', { name: 'Key' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('heading', { name: 'Key' })).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Close Key' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on scrim tap', () => {
    const onClose = vi.fn();
    const { container } = render(<TransportSheet open title="Tempo" onClose={onClose}>x</TransportSheet>);
    fireEvent.click(container.querySelector('.piano-tsheet__scrim'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.test.jsx`
Expected: FAIL — cannot resolve `./TransportSheet.jsx`.

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.jsx
import TransportButton from './TransportButton.jsx';
import './Transport.scss';

/**
 * TransportSheet — the kiosk's one modal-sheet shell (extracted from the old
 * VolumeModal): full-screen scrim that dismisses on tap, centered sheet, titled
 * header with a 48px close button. Every transport setting (volume, key,
 * tempo, loop) opens one of these; content is children.
 */
export default function TransportSheet({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="piano-tsheet" role="dialog" aria-label={title} aria-modal="true">
      <button type="button" className="piano-tsheet__scrim" aria-label={`Dismiss ${title}`} onClick={onClose} />
      <div className="piano-tsheet__panel">
        <header className="piano-tsheet__head">
          <h2>{title}</h2>
          <TransportButton icon="close" ariaLabel={`Close ${title}`} emphasis="quiet" onPress={onClose} />
        </header>
        {children}
      </div>
    </div>
  );
}
```

Append to `Transport.scss`:

```scss
.piano-tsheet {
  position: fixed;
  inset: 0;
  z-index: 60; // above player chrome; matches the old .piano-volume-modal layer
  display: flex;
  align-items: center;
  justify-content: center;

  &__scrim {
    position: absolute;
    inset: 0;
    border: 0;
    background: rgba(0, 0, 0, 0.55);
    cursor: pointer;
  }

  &__panel {
    position: relative;
    min-width: 22rem;
    max-width: 92vw;
    max-height: 88vh;
    overflow-y: auto;
    padding: 1rem 1.25rem 1.25rem;
    border-radius: 1rem;
    background: var(--piano-tsheet-bg, #1c2028);
    color: var(--piano-tsheet-fg, #f2f5fa);
    box-shadow: 0 1rem 3rem rgba(0, 0, 0, 0.5);
  }

  &__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 0.75rem;
    h2 { margin: 0; font-size: 1.15rem; }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/TransportSheet.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/
git commit -m "feat(piano): TransportSheet modal shell (scrim + titled header + 48px close)"
```

---

### Task 4: `StepGrid`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/StepGrid.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/transport/Transport.scss` (append)
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/StepGrid.test.jsx`

**Interfaces:**
- Produces: `StepGrid({ steps, activeIndex, onPick, ariaLabel, disabled=false })` where `steps = [{ label: string, sub?: ReactNode }]`; `onPick(index)` fires on tap. One row of ≥48 px lit-current targets; hosts compose multiple `StepGrid`s for multi-row pickers.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/StepGrid.test.jsx
import { render, fireEvent, screen } from '@testing-library/react';
import StepGrid from './StepGrid.jsx';

const steps = [{ label: '50%' }, { label: '100%', sub: '90' }, { label: '150%' }];

describe('StepGrid', () => {
  it('lights the active step and fires onPick with the tapped index', () => {
    const onPick = vi.fn();
    render(<StepGrid steps={steps} activeIndex={1} onPick={onPick} ariaLabel="Tempo" />);
    const active = screen.getByRole('button', { name: /100%/ });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active.className).toContain('is-on');
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    expect(onPick).toHaveBeenCalledWith(0);
  });

  it('renders sub-labels and a group label', () => {
    render(<StepGrid steps={steps} activeIndex={0} onPick={() => {}} ariaLabel="Tempo" />);
    expect(screen.getByRole('group', { name: 'Tempo' })).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();
  });

  it('disabled disables every step', () => {
    render(<StepGrid steps={steps} activeIndex={0} onPick={() => {}} ariaLabel="Tempo" disabled />);
    screen.getAllByRole('button').forEach((b) => expect(b).toBeDisabled());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/StepGrid.test.jsx`
Expected: FAIL — cannot resolve `./StepGrid.jsx`.

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/StepGrid.jsx
import './Transport.scss';

/**
 * StepGrid — the kiosk's canonical discrete picker: one row of ≥48px tap
 * targets, current value lit (the VolumeModal Off/Low/Med/High/Max language,
 * generalized). Replaces the per-surface `nearestStep` hand-rolls; hosts map
 * values→index and compose rows for larger grids (KeySheet).
 *
 * @param {Array<{label: string, sub?: import('react').ReactNode}>} steps
 * @param {number} activeIndex
 * @param {(i: number) => void} onPick
 * @param {string} ariaLabel
 * @param {boolean} [disabled]
 */
export default function StepGrid({ steps, activeIndex, onPick, ariaLabel, disabled = false }) {
  return (
    <div className="piano-stepgrid" role="group" aria-label={ariaLabel}>
      {steps.map((s, i) => (
        <button
          key={s.label}
          type="button"
          className={`piano-stepgrid__step${i === activeIndex ? ' is-on' : ''}`}
          aria-pressed={i === activeIndex}
          disabled={disabled}
          onClick={() => onPick(i)}
        >
          {s.label}
          {s.sub != null && <span className="piano-stepgrid__sub">{s.sub}</span>}
        </button>
      ))}
    </div>
  );
}
```

Append to `Transport.scss`:

```scss
.piano-stepgrid {
  display: flex;
  gap: 0.4rem;
  margin: 0.35rem 0;

  &__step {
    flex: 1 1 0;
    min-width: 3rem;
    min-height: 3rem; // 48px floor
    display: inline-flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.15rem;
    padding: 0.3rem 0.4rem;
    border: 1px solid var(--piano-tbtn-border, rgba(255, 255, 255, 0.22));
    border-radius: 0.6rem;
    background: var(--piano-tbtn-bg, rgba(255, 255, 255, 0.08));
    color: inherit;
    font: inherit;
    line-height: 1.1;
    cursor: pointer;

    &.is-on {
      background: var(--piano-tbtn-on-bg, rgba(94, 170, 255, 0.28));
      border-color: var(--piano-tbtn-on-border, rgba(94, 170, 255, 0.8));
    }
    &:disabled { opacity: 0.4; cursor: default; }
  }

  &__sub {
    font-size: 0.72em;
    opacity: 0.75;
    display: inline-flex;
    align-items: center;
    gap: 0.2em;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/StepGrid.test.jsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/
git commit -m "feat(piano): StepGrid — the shared direct-pick discrete ladder"
```

---

### Task 5: `VolumeSheet` + `VolumeControl`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/VolumeSheet.jsx`
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/VolumeControl.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/VolumeSheet.test.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/VolumeControl.test.jsx`

**Interfaces:**
- Consumes: `TransportSheet`, `TransportButton`, `StepGrid`, `usePianoMix()` from `../PianoMixContext.jsx` (provides `pianoLevel, mediaLevel, setPianoLevel, setMediaLevel`), `STEPS, stepToLevel, levelToStep` from `../volumeCurve.js`.
- Produces:
  - `VolumeSheet({ open, onClose })` — Media + MIDI five-step steppers + Log/Linear toggle (behavior identical to the old `VolumeModal`).
  - `VolumeControl({ disabled=false, className='', onOpenChange })` — the compact `volume`-icon button that opens `VolumeSheet`; `onOpenChange(bool)` fires on open/close (Music uses it to pin auto-hide chrome).

- [ ] **Step 1: Write the failing tests**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/VolumeSheet.test.jsx
import { render, fireEvent, screen } from '@testing-library/react';
import { PianoMixProvider } from '../PianoMixContext.jsx';
import VolumeSheet from './VolumeSheet.jsx';

const ui = (props) => render(
  <PianoMixProvider><VolumeSheet open onClose={() => {}} {...props} /></PianoMixProvider>
);

describe('VolumeSheet', () => {
  it('renders Media and MIDI stepper cards with the five canonical steps', () => {
    ui();
    expect(screen.getByRole('group', { name: 'Media Volume' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'MIDI Volume' })).toBeInTheDocument();
    // 5 steps × 2 channels
    expect(screen.getAllByRole('button', { name: /^(Off|Low|Med|High|Max)$/ })).toHaveLength(10);
  });

  it('offers the Log/Linear curve toggle with Log default', () => {
    ui();
    expect(screen.getByRole('button', { name: 'Log' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Linear' }));
    expect(screen.getByRole('button', { name: 'Linear' })).toHaveAttribute('aria-pressed', 'true');
  });
});
```

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/VolumeControl.test.jsx
import { render, fireEvent, screen } from '@testing-library/react';
import { PianoMixProvider } from '../PianoMixContext.jsx';
import VolumeControl from './VolumeControl.jsx';

describe('VolumeControl', () => {
  it('opens the volume sheet on tap and reports onOpenChange', () => {
    const onOpenChange = vi.fn();
    render(<PianoMixProvider><VolumeControl onOpenChange={onOpenChange} /></PianoMixProvider>);
    expect(screen.queryByRole('dialog', { name: 'Volume' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
    expect(screen.getByRole('dialog', { name: 'Volume' })).toBeInTheDocument();
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    fireEvent.click(screen.getByRole('button', { name: 'Close Volume' }));
    expect(screen.queryByRole('dialog', { name: 'Volume' })).toBeNull();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it('disabled blocks opening', () => {
    render(<PianoMixProvider><VolumeControl disabled /></PianoMixProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'Volume' }));
    expect(screen.queryByRole('dialog', { name: 'Volume' })).toBeNull();
  });
});
```

Note: if `PianoMixContext.jsx` exports the provider under a different name, check the file — `VolumeModal.test.jsx` (existing) shows the working wrap pattern; copy it.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/VolumeSheet.test.jsx frontend/src/modules/Piano/PianoKiosk/transport/VolumeControl.test.jsx`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write the implementations**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/VolumeSheet.jsx
import { useState } from 'react';
import Icon from '../icons/Icon.jsx';
import { usePianoMix } from '../PianoMixContext.jsx';
import { STEPS, stepToLevel, levelToStep } from '../volumeCurve.js';
import TransportSheet from './TransportSheet.jsx';
import TransportButton from './TransportButton.jsx';
import StepGrid from './StepGrid.jsx';

/**
 * VolumeSheet — THE kiosk volume affordance (audit F6): Media (the media
 * element's own volume) and MIDI (the piano voice's CC7) as five-step
 * StepGrids, plus the Log/Linear curve toggle. Successor to VolumeModal,
 * rebuilt on the transport primitives; opened everywhere via VolumeControl.
 */
function ChannelCard({ icon, name, level, onLevel, curve }) {
  return (
    <div className="piano-volsheet__card">
      <div className="piano-volsheet__cardhead">
        <Icon name={icon} />
        <span>{name}</span>
      </div>
      <StepGrid
        steps={STEPS.map((label) => ({ label }))}
        activeIndex={levelToStep(level, curve)}
        onPick={(i) => onLevel(stepToLevel(i, curve))}
        ariaLabel={name}
      />
    </div>
  );
}

export default function VolumeSheet({ open, onClose }) {
  const { pianoLevel, mediaLevel, setPianoLevel, setMediaLevel } = usePianoMix();
  const [curve, setCurve] = useState('log');
  return (
    <TransportSheet open={open} title="Volume" onClose={onClose}>
      <ChannelCard icon="volume" name="Media Volume" level={mediaLevel} onLevel={setMediaLevel} curve={curve} />
      <ChannelCard icon="piano" name="MIDI Volume" level={pianoLevel} onLevel={setPianoLevel} curve={curve} />
      <div className="piano-volsheet__curve" role="group" aria-label="Volume curve">
        <TransportButton label="Linear" on={curve === 'linear'} onPress={() => setCurve('linear')} />
        <TransportButton label="Log" on={curve === 'log'} onPress={() => setCurve('log')} />
      </div>
    </TransportSheet>
  );
}
```

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/VolumeControl.jsx
import { useState } from 'react';
import TransportButton from './TransportButton.jsx';
import VolumeSheet from './VolumeSheet.jsx';

/**
 * VolumeControl — the compact volume affordance: one `volume` icon button that
 * opens VolumeSheet. Every player renders THIS (course videos, karaoke,
 * playalong, music, sheet music) so volume looks and works identically
 * everywhere. `onOpenChange` lets auto-hiding hosts pin their chrome.
 */
export default function VolumeControl({ disabled = false, className = '', onOpenChange }) {
  const [open, setOpen] = useState(false);
  const set = (v) => { setOpen(v); onOpenChange?.(v); };
  return (
    <>
      <TransportButton
        icon="volume"
        ariaLabel="Volume"
        on={open}
        disabled={disabled}
        className={className}
        onPress={() => set(true)}
      />
      <VolumeSheet open={open} onClose={() => set(false)} />
    </>
  );
}
```

Append to `Transport.scss`:

```scss
.piano-volsheet__card { margin-bottom: 0.75rem; }
.piano-volsheet__cardhead {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
  font-weight: 600;
}
.piano-volsheet__curve {
  display: flex;
  gap: 0.4rem;
  justify-content: flex-end;
  margin-top: 0.5rem;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/VolumeSheet.test.jsx frontend/src/modules/Piano/PianoKiosk/transport/VolumeControl.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/
git commit -m "feat(piano): VolumeSheet + VolumeControl — one volume affordance for every player"
```

---

### Task 6: Re-point Videos at `VolumeControl`; delete `VolumeModal`

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Videos/PianoVideoChrome.jsx`
- Delete: `frontend/src/modules/Piano/PianoKiosk/VolumeModal.jsx`
- Delete: `frontend/src/modules/Piano/PianoKiosk/VolumeModal.test.jsx`

**Interfaces:**
- Consumes: `VolumeControl({ disabled })` from Task 5.

- [ ] **Step 1: Edit `PianoVideoChrome.jsx`**

Replace the import (line 4): `import VolumeModal from '../../VolumeModal.jsx';` → `import VolumeControl from '../../transport/VolumeControl.jsx';`

Remove the local state (line 21): `const [volumeOpen, setVolumeOpen] = useState(false);` and drop `useState` from the react import if now unused.

Replace the volume button (line 65) and the `<VolumeModal …/>` line (line 68) with a single element in the button's position:

```jsx
<VolumeControl disabled={gateOpen} className="piano-video-chrome__btn--volume" />
```

- [ ] **Step 2: Confirm no other `VolumeModal` consumers, then delete it**

Run: `grep -rn "VolumeModal" frontend/src/ --include="*.jsx" --include="*.js" | grep -v VolumeModal.jsx`
Expected: no output (only self-references remain).

```bash
git rm frontend/src/modules/Piano/PianoKiosk/VolumeModal.jsx frontend/src/modules/Piano/PianoKiosk/VolumeModal.test.jsx
```

Also delete the now-dead `.piano-volume-modal` SCSS block: `frontend/src/Apps/PianoApp.scss` starting at the `.piano-volume-modal {` rule (line ≈2407) through its matching closing brace (find it by brace-matching in the editor; it ends before the next top-level selector). Verify with `grep -n "piano-volume-modal" frontend/src/Apps/PianoApp.scss` → no matches.

- [ ] **Step 3: Run the Videos-adjacent tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Videos/ frontend/src/modules/Piano/PianoKiosk/transport/`
Expected: PASS (any test that referenced VolumeModal by name must be updated to `VolumeSheet`/`VolumeControl` selectors — aria labels `Volume` / dialog name `Volume` are unchanged).

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/modules/Piano/PianoKiosk/ frontend/src/Apps/PianoApp.scss
git commit -m "refactor(piano): course-video volume opens the shared VolumeSheet; retire VolumeModal"
```

---

### Task 7: `soundingKey` helper + `KeySheet`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/soundingKey.js`
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/soundingKey.test.js`
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.test.jsx`

**Interfaces:**
- Consumes: `keyLabel(fifths, mode)` from `../modes/SheetMusic/keyLabel.js`, `TransportSheet`, `StepGrid`.
- Produces:
  - `soundingKeyLabel(fifths, mode, semitones) => string|null` — e.g. `(2, 'major', +1)` → `"Eb major"`; `semitones === 0` defers to `keyLabel`; returns null when fifths is out of range/undefined.
  - `KeySheet({ open, onClose, value, onPick, keyFifths, keyMode })` — direct-pick transpose grid −6…+6 (`onPick(semitones)`), footer "Sounding key: X" when `keyFifths` is a finite number.

- [ ] **Step 1: Write the failing tests**

```js
// frontend/src/modules/Piano/PianoKiosk/transport/soundingKey.test.js
import { soundingKeyLabel } from './soundingKey.js';

describe('soundingKeyLabel', () => {
  it('defers to the written key at 0 offset', () => {
    expect(soundingKeyLabel(0, 'minor', 0)).toBe('A minor');
    expect(soundingKeyLabel(-2, 'major', 0)).toBe('Bb major');
  });
  it('transposes up with sharp-preferring names', () => {
    expect(soundingKeyLabel(0, 'major', 1)).toBe('C# major');   // C + 1
    expect(soundingKeyLabel(2, 'major', 1)).toBe('D# major');   // D + 1
  });
  it('transposes down with flat-preferring names', () => {
    expect(soundingKeyLabel(0, 'major', -1)).toBe('B major');   // C − 1
    expect(soundingKeyLabel(0, 'major', -2)).toBe('Bb major');  // C − 2
  });
  it('handles minor and octave wrap', () => {
    expect(soundingKeyLabel(0, 'minor', 3)).toBe('C minor');    // A + 3
    expect(soundingKeyLabel(0, 'major', 12)).toBe('C major');
  });
  it('returns null when the written key is unknown', () => {
    expect(soundingKeyLabel(undefined, 'major', 2)).toBeNull();
    expect(soundingKeyLabel(9, 'major', 2)).toBeNull();
  });
});
```

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.test.jsx
import { render, fireEvent, screen } from '@testing-library/react';
import KeySheet from './KeySheet.jsx';

describe('KeySheet', () => {
  it('renders 13 offsets with the current one lit and picks a value', () => {
    const onPick = vi.fn();
    render(<KeySheet open onClose={() => {}} value={2} onPick={onPick} />);
    expect(screen.getByRole('dialog', { name: 'Key' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^[+-]?\d$/ })).toHaveLength(13);
    expect(screen.getByRole('button', { name: '+2' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '-3' }));
    expect(onPick).toHaveBeenCalledWith(-3);
  });

  it('shows the sounding key when the written key is known', () => {
    render(<KeySheet open onClose={() => {}} value={1} onPick={() => {}} keyFifths={0} keyMode="major" />);
    expect(screen.getByText(/Sounding key: C# major/)).toBeInTheDocument();
  });

  it('omits the footer when the written key is unknown', () => {
    render(<KeySheet open onClose={() => {}} value={1} onPick={() => {}} />);
    expect(screen.queryByText(/Sounding key/)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/soundingKey.test.js frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.test.jsx`
Expected: FAIL — modules don't exist.

- [ ] **Step 3: Write the implementations**

```js
// frontend/src/modules/Piano/PianoKiosk/transport/soundingKey.js
import { keyLabel } from '../modes/SheetMusic/keyLabel.js';

// Major-tonic pitch class for a MusicXML fifths value (−7..7); minor uses the
// relative minor (major pc + 9 mod 12, i.e. down a minor third).
const MAJOR_PC = { '-7': 11, '-6': 6, '-5': 1, '-4': 8, '-3': 3, '-2': 10, '-1': 5, 0: 0, 1: 7, 2: 2, 3: 9, 4: 4, 5: 11, 6: 6, 7: 1 };
const SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * soundingKeyLabel — the key the listener hears when a score written in
 * `fifths`/`mode` is transposed by `semitones`. 0 defers to keyLabel (which
 * keeps the written spelling); otherwise spell sharps going up, flats going
 * down. Returns null when the written key is unknown.
 */
export function soundingKeyLabel(fifths, mode, semitones) {
  if (!Number.isFinite(fifths) || MAJOR_PC[fifths] === undefined) return null;
  if (!semitones) return keyLabel(fifths, mode);
  const minor = mode === 'minor';
  const basePc = (MAJOR_PC[fifths] + (minor ? 9 : 0)) % 12;
  const pc = ((basePc + semitones) % 12 + 12) % 12;
  const name = (semitones > 0 ? SHARP : FLAT)[pc];
  return `${name} ${minor ? 'minor' : 'major'}`;
}
```

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.jsx
import TransportSheet from './TransportSheet.jsx';
import StepGrid from './StepGrid.jsx';
import { soundingKeyLabel } from './soundingKey.js';

// ASCII labels only (house rule): '-6'..'-1', '0', '+1'..'+6'.
const DOWN = [-6, -5, -4, -3, -2, -1];
const UP = [1, 2, 3, 4, 5, 6];
const label = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * KeySheet — direct-pick transpose: every semitone offset −6…+6 is its own
 * 48px target with the current offset lit (replaces the old −/+ text-glyph
 * stepper, audit F2/F11). Values outside ±6 clamp to the nearest edge for
 * display only; onPick always emits the tapped offset.
 */
export default function KeySheet({ open, onClose, value = 0, onPick, keyFifths, keyMode }) {
  const v = Math.max(-6, Math.min(6, value));
  const row = (values) => (
    <StepGrid
      steps={values.map((n) => ({ label: label(n) }))}
      activeIndex={values.indexOf(v)}
      onPick={(i) => onPick(values[i])}
      ariaLabel={values[0] < 0 ? 'Transpose down' : values[0] === 0 ? 'No transpose' : 'Transpose up'}
    />
  );
  const sounding = soundingKeyLabel(keyFifths, keyMode, v);
  return (
    <TransportSheet open={open} title="Key" onClose={onClose}>
      {row(DOWN)}
      {row([0])}
      {row(UP)}
      {sounding && <p className="piano-keysheet__sounding">Sounding key: {sounding}</p>}
    </TransportSheet>
  );
}
```

Append to `Transport.scss`:

```scss
.piano-keysheet__sounding {
  margin: 0.6rem 0 0;
  text-align: center;
  opacity: 0.85;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/soundingKey.test.js frontend/src/modules/Piano/PianoKiosk/transport/KeySheet.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/
git commit -m "feat(piano): KeySheet — direct-pick transpose grid with sounding-key readout"
```

---

### Task 8: transport `TempoSheet`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.test.jsx`

**Interfaces:**
- Consumes: `TransportSheet`, `StepGrid`, `Icon`.
- Produces: `TempoSheet({ open, onClose, value, onPick, baseBpm=90 })` and exported `TEMPO_STEPS = [{label:'50%',value:0.5}, {label:'75%',value:0.75}, {label:'100%',value:1}, {label:'125%',value:1.25}, {label:'150%',value:1.5}]` plus `nearestStep(steps, val)` (moves here from `ScoreTransportBar.jsx`). `onPick(multiplier)`.
- NOTE: distinct from `producer/TempoSheet.jsx` (absolute BPM, untouched this wave); imports disambiguate by path.

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.test.jsx
import { render, fireEvent, screen } from '@testing-library/react';
import TempoSheet, { TEMPO_STEPS, nearestStep } from './TempoSheet.jsx';

describe('TempoSheet', () => {
  it('exposes the canonical ladder and nearestStep', () => {
    expect(TEMPO_STEPS.map((s) => s.value)).toEqual([0.5, 0.75, 1, 1.25, 1.5]);
    expect(nearestStep(TEMPO_STEPS, 1.2)).toBe(3);
  });

  it('lights the current step, shows derived BPM, and picks a multiplier', () => {
    const onPick = vi.fn();
    render(<TempoSheet open onClose={() => {}} value={1.25} onPick={onPick} baseBpm={80} />);
    expect(screen.getByRole('dialog', { name: 'Tempo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /125%/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('100')).toBeInTheDocument(); // 80 × 1.25
    fireEvent.click(screen.getByRole('button', { name: /50%/ }));
    expect(onPick).toHaveBeenCalledWith(0.5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.test.jsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.jsx
import Icon from '../icons/Icon.jsx';
import TransportSheet from './TransportSheet.jsx';
import StepGrid from './StepGrid.jsx';

// The kiosk's canonical practice-tempo ladder (percent of written tempo).
// NOT Producer's absolute-BPM sheet — that stays in producer/ until a later wave.
export const TEMPO_STEPS = [
  { label: '50%', value: 0.5 },
  { label: '75%', value: 0.75 },
  { label: '100%', value: 1 },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5 },
];

/** Which step is lit for a current value — the nearest one by amount. */
export const nearestStep = (steps, val) => {
  let best = 0;
  let bestDist = Infinity;
  steps.forEach((s, i) => {
    const d = Math.abs(s.value - val);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
};

/**
 * TempoSheet — the practice-speed picker: percent steps, each sub-labeled with
 * the BPM it produces at this piece's written tempo (audit F12's `percent`
 * notation, now on the shared sheet).
 */
export default function TempoSheet({ open, onClose, value = 1, onPick, baseBpm = 90 }) {
  return (
    <TransportSheet open={open} title="Tempo" onClose={onClose}>
      <StepGrid
        steps={TEMPO_STEPS.map((s) => ({
          label: s.label,
          sub: (<><Icon name="quarter-note" /> {Math.round(baseBpm * s.value)}</>),
        }))}
        activeIndex={nearestStep(TEMPO_STEPS, value)}
        onPick={(i) => onPick(TEMPO_STEPS[i].value)}
        ariaLabel="Tempo"
      />
    </TransportSheet>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/TempoSheet.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/
git commit -m "feat(piano): transport TempoSheet — percent ladder with derived BPM"
```

---

### Task 9: `LoopSheet`

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/LoopSheet.jsx`
- Test: `frontend/src/modules/Piano/PianoKiosk/transport/LoopSheet.test.jsx`

**Interfaces:**
- Consumes: `TransportSheet`, `TransportButton`.
- Produces: `LoopSheet({ open, onClose, active=false, sections=[], onPickSection, onStartSelect, onClearFocus, onNudge })` — same callback contract as today's `LoopControl` popover (`onNudge(edge: 'in'|'out', delta: ±1)`); section/select/clear picks close the sheet, nudges keep it open (so endpoints can be walked).

- [ ] **Step 1: Write the failing test**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/LoopSheet.test.jsx
import { render, fireEvent, screen } from '@testing-library/react';
import LoopSheet from './LoopSheet.jsx';

describe('LoopSheet', () => {
  const base = { open: true, onClose: vi.fn(), sections: [{ label: 'A section' }] };

  it('picks a section and closes', () => {
    const onPickSection = vi.fn(); const onClose = vi.fn();
    render(<LoopSheet {...base} onClose={onClose} onPickSection={onPickSection} />);
    fireEvent.click(screen.getByRole('button', { name: 'A section' }));
    expect(onPickSection).toHaveBeenCalledWith({ label: 'A section' });
    expect(onClose).toHaveBeenCalled();
  });

  it('when active, nudges with SVG-face buttons and stays open', () => {
    const onNudge = vi.fn(); const onClose = vi.fn();
    render(<LoopSheet {...base} onClose={onClose} active onNudge={onNudge} />);
    const later = screen.getByRole('button', { name: 'Loop start later' });
    expect(later.querySelector('.piano-icon')).not.toBeNull(); // SVG, not '+' text
    fireEvent.click(later);
    expect(onNudge).toHaveBeenCalledWith('in', 1);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Clear loop' })).toBeInTheDocument();
  });

  it('starts the two-tap measure selection and closes', () => {
    const onStartSelect = vi.fn(); const onClose = vi.fn();
    render(<LoopSheet {...base} onClose={onClose} onStartSelect={onStartSelect} />);
    fireEvent.click(screen.getByRole('button', { name: 'Select measures…' }));
    expect(onStartSelect).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/LoopSheet.test.jsx`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Write the implementation**

```jsx
// frontend/src/modules/Piano/PianoKiosk/transport/LoopSheet.jsx
import TransportSheet from './TransportSheet.jsx';
import TransportButton from './TransportButton.jsx';

/**
 * LoopSheet — the score loop picker on the shared sheet (was the LoopControl
 * popover): rehearsal-mark sections, the guided "Select measures…" two-tap
 * flow, and (when active) Clear plus ±1-measure Start/End nudges. Nudges keep
 * the sheet open so endpoints can be walked without redoing the selection.
 */
export default function LoopSheet({
  open, onClose, active = false, sections = [],
  onPickSection, onStartSelect, onClearFocus, onNudge,
}) {
  const pickAndClose = (fn, arg) => { fn?.(arg); onClose(); };
  return (
    <TransportSheet open={open} title="Loop" onClose={onClose}>
      <div className="piano-loopsheet__options">
        {sections.map((s) => (
          <TransportButton key={s.label} label={s.label} onPress={() => pickAndClose(onPickSection, s)} />
        ))}
        <TransportButton label="Select measures…" onPress={() => pickAndClose(onStartSelect)} />
        {active && <TransportButton label="Clear loop" onPress={() => pickAndClose(onClearFocus)} />}
      </div>
      {active && (
        <div className="piano-loopsheet__nudge" role="group" aria-label="Adjust loop">
          <span>Start</span>
          <TransportButton icon="minus" ariaLabel="Loop start earlier" onPress={() => onNudge?.('in', -1)} />
          <TransportButton icon="plus" ariaLabel="Loop start later" onPress={() => onNudge?.('in', 1)} />
          <span>End</span>
          <TransportButton icon="minus" ariaLabel="Loop end earlier" onPress={() => onNudge?.('out', -1)} />
          <TransportButton icon="plus" ariaLabel="Loop end later" onPress={() => onNudge?.('out', 1)} />
        </div>
      )}
    </TransportSheet>
  );
}
```

Append to `Transport.scss`:

```scss
.piano-loopsheet__options {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  .piano-tbtn { justify-content: flex-start; }
}
.piano-loopsheet__nudge {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  margin-top: 0.75rem;
  span { opacity: 0.8; margin-right: 0.2rem; &:not(:first-child) { margin-left: 0.6rem; } }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/LoopSheet.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/
git commit -m "feat(piano): LoopSheet — score loop picker on the shared sheet"
```

---

### Task 10: Sheet Music migration — transport buttons, Key/Tempo sheets

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScorePlayer.jsx` (thread `keyFifths`/`keyMode`)
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.test.jsx` (selector updates only)

**Interfaces:**
- Consumes: `TransportButton`, `KeySheet`, `TempoSheet` + its `TEMPO_STEPS`/`nearestStep`, `Icon`.
- Produces: `ScoreTransportBar` gains two props: `keyFifths` (number|undefined), `keyMode` ('major'|'minor'|undefined). All existing props unchanged. Memo boundaries unchanged.

- [ ] **Step 1: Swap the icon module for shared icons in `ScoreTransportBar.jsx`**

Replace line 5 `import { PlayIcon, PauseIcon, RestartIcon, QuarterNoteIcon, ChevronDownIcon } from './icons.jsx';` with:

```jsx
import Icon from '../../icons/Icon.jsx';
import TransportButton from '../../transport/TransportButton.jsx';
import KeySheet from '../../transport/KeySheet.jsx';
import TempoSheet, { TEMPO_STEPS, nearestStep } from '../../transport/TempoSheet.jsx';
```

Delete the local `TEMPO_STEPS` (lines 24-30) and `nearestStep` (lines 33-41) — they now come from `transport/TempoSheet.jsx`. Replace remaining local-icon JSX: `<RestartIcon />` → `<Icon name="previous" />` (restart semantics keep the shared restart glyph used by every other player), `<PlayIcon />`/`<PauseIcon />` → `<Icon name="play" />`/`<Icon name="pause" />`, `<QuarterNoteIcon />` → `<Icon name="quarter-note" />`, `<ChevronDownIcon />` → `<Icon name="chevron-down" />`.

In `ScoreTransportButtons` and the metronome button of `ScorePracticeCluster`, keep the existing `<button>` structure and classes EXCEPT add the shared primitive styling class: `className="piano-tbtn piano-score-reset"` etc. (the `piano-score-*` classes remain as grid/behavior hooks; `piano-tbtn` supplies the design-system face). Import of `Transport.scss` comes along with `TransportButton`.

- [ ] **Step 2: Replace the Key stepper with a chip + `KeySheet` in `ScoreViewControls`**

`ScoreViewControls` signature gains `keyFifths, keyMode` (threaded from the shell's new props). Replace the whole `piano-score-key` block (lines 259-282) with:

```jsx
<div className={`piano-score-key${keyEnabled ? '' : ' is-dimmed'}`}>
  <TransportButton
    label={`Key ${transpose > 0 ? `+${transpose}` : transpose}`}
    icon="chevron-down"
    ariaLabel="Key"
    disabled={!keyEnabled}
    on={transpose !== 0}
    onPress={() => toggle('key')}
  />
</div>
<KeySheet
  open={openPopover === 'key'}
  onClose={closePopover}
  value={transpose}
  onPick={(n) => { onTranspose?.(n); closePopover(); }}
  keyFifths={keyFifths}
  keyMode={keyMode}
/>
```

(`openPopover` already exists; add `'key'` as a third value. The shared popover backdrop must render only for `'view'` now — change the condition at line 340 from `{openPopover && (` to `{openPopover === 'view' && (` since Key/Tempo sheets bring their own scrims.)

- [ ] **Step 3: Replace the Tempo popover with `TempoSheet`**

Replace the `piano-score-tempo-wrap` block (lines 284-313) with:

```jsx
<div className="piano-score-tempo-wrap">
  <TransportButton
    label={`Tempo ${Math.round(tempoMult * 100)}%`}
    icon="chevron-down"
    ariaLabel="Tempo"
    on={tempoMult !== 1}
    onPress={() => toggle('tempo')}
  />
  <TempoSheet
    open={openPopover === 'tempo'}
    onClose={closePopover}
    value={tempoMult}
    onPick={(v) => { onTempo?.(v); closePopover(); }}
    baseBpm={baseBpm}
  />
</div>
```

- [ ] **Step 4: Thread `keyFifths`/`keyMode` from `ScorePlayer.jsx`**

At `ScorePlayer.jsx:89` the parsed key is already in hand (`keyLabel(parsed?.key?.fifths ?? 0, parsed?.key?.mode)`). Where `<ScoreTransportBar …>` is rendered (≈line 1122), add:

```jsx
keyFifths={parsed?.key?.fifths}
keyMode={parsed?.key?.mode}
```

and thread the two props through the `ScoreTransportBar` shell into `ScoreViewControls` (both are step-independent scalars, so the memo bailout behavior is unchanged).

- [ ] **Step 5: Run the SheetMusic tests and fix selectors**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/`
Expected: `ScoreTransportBar.test.jsx` failures limited to (a) class-based queries — `.piano-score-btn` faces are now `.piano-tbtn`; (b) the Key stepper interactions — rewrite those to open the sheet (`Key` button) and tap an offset (`+1` / `-1` buttons in the dialog); (c) tempo popover queries — the steps now live in a `dialog` named `Tempo`. Role/aria-label-based queries (`Play`, `Pause`, `Restart`, `Metronome`, `Tempo`, `Key`) still resolve. Update the test file accordingly; do NOT weaken the memo-bailout assertions (`onBodyRender` call counts) — they must still pass unchanged.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "feat(piano): score bar adopts transport primitives — Key and Tempo become sheets"
```

---

### Task 11: Sheet Music migration — Loop, ViewMenu internals, VolumeControl, retire local icons

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/LoopControl.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ViewMenu.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ScoreTransportBar.jsx` (add `VolumeControl`)
- Delete: `frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/icons.jsx`

**Interfaces:**
- Consumes: `LoopSheet`, `StepGrid`, `TransportButton`, `VolumeControl`, `Icon`.
- Produces: `LoopControl` keeps its external prop contract (`active, scopeLabel, sections, onPickSection, onStartSelect, onClearFocus, onNudge`) — hosts don't change.

- [ ] **Step 1: Rewrite `LoopControl.jsx` to trigger `LoopSheet`**

```jsx
import React, { useState, memo } from 'react';
import Icon from '../../icons/Icon.jsx';
import TransportButton from '../../transport/TransportButton.jsx';
import LoopSheet from '../../transport/LoopSheet.jsx';

/**
 * LoopControl — the loop trigger chip (audit L1/L2). The trigger reads "Loop"
 * (inactive) or "Loop m9–m16" (active) with a one-tap clear beside it; the
 * picker itself is the shared LoopSheet. Presentational; the parent owns
 * focus/selection state. Memoized on its props.
 */
const LoopControl = memo(function LoopControl({ active = false, scopeLabel = '', sections = [], onPickSection, onStartSelect, onClearFocus, onNudge }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="piano-score-loop-wrap">
      <TransportButton
        label={active ? `Loop ${scopeLabel}` : 'Loop'}
        icon="chevron-down"
        ariaLabel="Loop"
        on={active}
        className="piano-score-loop-trigger"
        onPress={() => setOpen(true)}
      />
      {active && (
        <TransportButton icon="close" ariaLabel="Clear loop" emphasis="quiet" onPress={() => onClearFocus?.()} />
      )}
      <LoopSheet
        open={open}
        onClose={() => setOpen(false)}
        active={active}
        sections={sections}
        onPickSection={onPickSection}
        onStartSelect={onStartSelect}
        onClearFocus={onClearFocus}
        onNudge={onNudge}
      />
    </div>
  );
});

export default LoopControl;
```

(Note: the em-dash range in `scopeLabel` like `m9–m16` is data, not a button glyph — allowed.)

- [ ] **Step 2: Restyle `ViewMenu.jsx` internals (stays a popover)**

Replace the Size row's hand-rolled step buttons with `StepGrid`, the Layout/Keyboard buttons with `TransportButton`, and delete the local `nearestStep` (import from `../../transport/TempoSheet.jsx`):

```jsx
import StepGrid from '../../transport/StepGrid.jsx';
import TransportButton from '../../transport/TransportButton.jsx';
import { nearestStep } from '../../transport/TempoSheet.jsx';
```

- Layout row: two `TransportButton`s (`label="Down the page"` / `label="Across"`, `on={flow === 'wrapped'}` / `on={flow === 'horizontal'}`, same onClick guards).
- Size row: `<StepGrid steps={SIZE_STEPS.map((s) => ({ label: s.label }))} activeIndex={sizeIdx} onPick={(i) => onScale?.(SIZE_STEPS[i].value)} ariaLabel="Size" />`.
- Keyboard row: one `TransportButton` (`label={`Keyboard: ${keyboardVisible ? 'Shown' : 'Hidden'}`}`, `on={keyboardVisible}`).
- The `<dl class="piano-score-view-about">` block is untouched.

- [ ] **Step 3: Add `VolumeControl` to the bar's right zone**

In `ScoreViewControls` (inside `ScoreTransportBar.jsx`), import `VolumeControl` from `../../transport/VolumeControl.jsx` and render it as the LAST element of `.piano-score-view` (after the View wrap, before the backdrop):

```jsx
<VolumeControl className="piano-score-volume" />
```

This closes audit F6 — the score player finally has a volume affordance, and it's the same one as everywhere else.

- [ ] **Step 4: Retire the local icon module**

Run: `grep -rn "from './icons.jsx'\|from \"../icons.jsx\"\|SheetMusic/icons" frontend/src/ | grep -v test`
Update any remaining importer to shared `Icon` equivalents (`play`, `pause`, `close`, `chevron-down`, `quarter-note`), then:

```bash
git rm frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/icons.jsx
```

- [ ] **Step 5: Run the SheetMusic suite**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/ frontend/src/modules/Piano/PianoKiosk/transport/`
Expected: PASS (fix any remaining class-selector drift in tests; aria labels are stable).

- [ ] **Step 6: Commit**

```bash
git add -A frontend/src/modules/Piano/PianoKiosk/modes/SheetMusic/
git commit -m "feat(piano): score Loop/View/Volume on transport primitives; retire local icon module"
```

---

### Task 12: Karaoke / Singalong / Playalong migration

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Singalong/SingalongPlayer.jsx`
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Karaoke/Karaoke.jsx`

**Interfaces:**
- Consumes: `TransportButton`, `VolumeControl`, `Icon`.

- [ ] **Step 1: Replace the volume cluster and buttons in `SingalongPlayer.jsx`**

Add `import TransportButton from '../../transport/TransportButton.jsx';` and `import VolumeControl from '../../transport/VolumeControl.jsx';`. Delete `const VOL_STEP = 0.1;` (line 31) and drop `setMediaLevel` from the `usePianoMix()` destructure if the media-level effect (line 155) is its only other consumer — keep `mediaLevel` (the effect still applies it to the element).

Replace the chrome row (lines 216-228) with:

```jsx
<div className="piano-singalong-chrome__row">
  <TransportButton icon="previous" ariaLabel="Restart from beginning" className="piano-singalong-chrome__btn" onPress={handleRestart} />
  <span className="piano-singalong-chrome__time">{fmt(currentTime)} / {fmt(dur)}</span>
  <div className="piano-singalong-chrome__spacer" />
  <TransportButton icon="skip-back-15" ariaLabel="Back 15 seconds" className="piano-singalong-chrome__btn" onPress={() => handleSkip(-15)} />
  <TransportButton icon={isPlaying ? 'pause' : 'play'} ariaLabel={isPlaying ? 'Pause' : 'Play'} emphasis="primary" className="piano-singalong-chrome__btn" onPress={ctrl.toggle} />
  <TransportButton icon="skip-forward-15" ariaLabel="Forward 15 seconds" className="piano-singalong-chrome__btn" onPress={() => handleSkip(15)} />
  <div className="piano-singalong-chrome__spacer" />
  <VolumeControl className="piano-singalong-chrome__btn" />
  <TransportButton icon={isFullscreen ? 'fullscreen-exit' : 'fullscreen'} ariaLabel="Toggle fullscreen" className="piano-singalong-chrome__btn" onPress={toggleFullscreen} />
</div>
```

The three volume elements (volume-down button / numeric readout / volume-up button) are GONE — volume is now the same modal as the course-video player, media + MIDI both (Playalong gains piano level control). Remove the now-dead `.piano-singalong-chrome__vol` rule from `frontend/src/Apps/PianoApp.scss`.

- [ ] **Step 2: Fix the Karaoke card glyph**

In `Karaoke.jsx`: add `import Icon from '../../icons/Icon.jsx';` and replace line 149 `<span className="piano-karaoke__play">▶</span>` with:

```jsx
<span className="piano-karaoke__play"><Icon name="play" /></span>
```

- [ ] **Step 3: Run the mode tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Singalong/ frontend/src/modules/Piano/PianoKiosk/modes/Karaoke/`
Expected: PASS (update any selector referencing the removed volume cluster or `▶`).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/modes/ frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): karaoke/singalong/playalong adopt transport buttons + shared volume sheet"
```

---

### Task 13: Music (audio player) migration — retire `MixControls`

**Files:**
- Modify: `frontend/src/modules/Piano/PianoKiosk/modes/Music/MusicPlayer.jsx`
- Delete: `frontend/src/modules/Piano/PianoKiosk/MixControls.jsx`
- Delete: `frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx`

**Interfaces:**
- Consumes: `TransportButton`, `VolumeControl` (with `onOpenChange` for the auto-hide pin).

- [ ] **Step 1: Swap the transport row and volume in `MusicPlayer.jsx`**

Imports: add `TransportButton` and `VolumeControl` (paths `../../transport/…`); remove the `MixControls` import. Add pin state near the other useState calls:

```jsx
const [volOpen, setVolOpen] = useState(false);
```

Wire it into the vanishing-chrome hook — find the `useVanishingControls({ active: playing && !showQueue })` call (≈line 65) and change the condition to `active: playing && !showQueue && !volOpen` (chrome stays pinned while the sheet is open).

Replace the transport row (lines 178-184) with:

```jsx
<div className="piano-music-player__transport">
  <TransportButton icon="shuffle" ariaLabel="Shuffle" on={shuffle} className="piano-music-btn" onPress={toggleShuffle} />
  <TransportButton icon="previous" ariaLabel="Previous" className="piano-music-btn" onPress={goPrev} />
  <TransportButton icon={playing ? 'pause' : 'play'} ariaLabel={playing ? 'Pause' : 'Play'} emphasis="primary" className="piano-music-btn" onPress={toggle} />
  <TransportButton icon="next" ariaLabel="Next" className="piano-music-btn" onPress={() => goNext(false)} />
  <TransportButton icon="repeat" ariaLabel="Repeat" on={repeat} className="piano-music-btn" onPress={toggleRepeat} />
  <VolumeControl className="piano-music-btn" onOpenChange={(o) => { setVolOpen(o); if (!o) reveal(); }} />
</div>
```

Delete the `<MixControls …/>` block (lines 185-191). The top-row back/queue buttons also become `TransportButton`s (`icon="back"` / `icon="queue"`, same aria-labels, keep `className="piano-music-btn"`).

- [ ] **Step 2: Confirm no other `MixControls` consumers, then delete**

Run: `grep -rn "MixControls" frontend/src/ | grep -v MixControls.`
Expected: no output. Then:

```bash
git rm frontend/src/modules/Piano/PianoKiosk/MixControls.jsx frontend/src/modules/Piano/PianoKiosk/MixControls.test.jsx
```

Remove the dead `.piano-mix` SCSS block from `frontend/src/Apps/PianoApp.scss` (verify: `grep -n "piano-mix" frontend/src/Apps/PianoApp.scss` → no matches).

- [ ] **Step 3: Run the Music tests**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/modes/Music/ frontend/src/modules/Piano/PianoKiosk/`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add -A frontend/src/modules/Piano/PianoKiosk/ frontend/src/Apps/PianoApp.scss
git commit -m "feat(piano): music player adopts transport buttons; MixControls retired for VolumeSheet"
```

---

### Task 14: Glyph-lint enforcement test

**Files:**
- Create: `frontend/src/modules/Piano/PianoKiosk/transport/noUnicodeGlyphs.test.js`

**Interfaces:**
- Consumes: the JSX sources on disk (read via `fs`), no components.

- [ ] **Step 1: Write the test (it should PASS immediately — it encodes the now-true invariant)**

```js
// frontend/src/modules/Piano/PianoKiosk/transport/noUnicodeGlyphs.test.js
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

/**
 * House rule (audit F2): pictorial button content is inline SVG, NEVER a
 * Unicode symbol glyph — the tablet WebView renders many of them as tofu.
 * This test scans PianoKiosk JSX for the banned glyphs. Files fixed by the
 * wave-1 migration must STAY clean; surfaces awaiting later waves are grand-
 * fathered below and the list must only ever SHRINK.
 */
const BANNED = /[▶◀◼■●▲▼▸◂▾★☆⟲✕♪−]/u; // U+2212 minus sign included; ASCII '-' is fine
// Musical spellings (♯ ♭ ♩ …) are allowed — they are notation, not chrome.
const GRANDFATHERED = new Set([
  'producer/TransportBar.jsx',
  'producer/CaptureCard.jsx',
  'producer/GainStrip.jsx',
  'producer/SongPicker.jsx',
  'producer/VoicePicker.jsx',
  'producer/LibraryBrowser.jsx',
  'modes/Lessons/LessonDrill.jsx',
  'modes/Studio/StudioRecordings.jsx',
  'modes/Videos/PianoContextRail.jsx',
  'modes/Videos/RepertoireBrowser.jsx',
]);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const jsxFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.jsx') && !name.includes('.test.')) jsxFiles.push(p);
  }
})(ROOT);

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('no Unicode glyphs as kiosk button faces', () => {
  it('scans a sane number of files', () => {
    expect(jsxFiles.length).toBeGreaterThan(50);
  });

  it.each(jsxFiles.map((f) => [relative(ROOT, f), f]))('%s is glyph-clean', (rel, abs) => {
    if (GRANDFATHERED.has(rel)) return; // later-wave surface; tracked in the audit
    expect(stripComments(readFileSync(abs, 'utf8'))).not.toMatch(BANNED);
  });

  it('grandfathered files still exist (remove entries as waves land)', () => {
    for (const rel of GRANDFATHERED) statSync(join(ROOT, rel)); // throws if stale
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/transport/noUnicodeGlyphs.test.js`
Expected: PASS. If any *wave-1* file fails, that's a real missed glyph — fix the file, not the test. If a file outside the wave (not listed above) fails, add it to `GRANDFATHERED` with a note in the commit message.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/Piano/PianoKiosk/transport/noUnicodeGlyphs.test.js
git commit -m "test(piano): lock the no-Unicode-button-glyph rule with a source scan"
```

---

### Task 15: Full suite, docs, build, deploy, kiosk verification

**Files:**
- Modify: `docs/reference/piano/sheet-music-player.md` (transport bar description: Key/Tempo/Loop are now sheets; volume exists)
- Modify: `docs/reference/piano/README.md` (add a short "Transport primitives" paragraph pointing at `PianoKiosk/transport/`)

- [ ] **Step 1: Run the entire kiosk + transport suite**

Run: `npx vitest run frontend/src/modules/Piano/PianoKiosk/`
Expected: PASS across the board. Capture the real runner exit code (`echo $?` immediately, no pipes).

- [ ] **Step 2: Update the reference docs**

Present-tense, endstate style (house rule — no class names, no "we changed"): describe the score bar's Key/Tempo/Loop as modal sheets sharing the kiosk volume-sheet pattern, and note that every player's volume opens the same Media+MIDI sheet. Keep instance-specific values out.

- [ ] **Step 3: Build and deploy (this host is prod; gates first)**

```bash
# Deploy gates (CLAUDE.local.md): both must be clear
sudo docker logs --since 75s daylight-station 2>&1 | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' | sort | uniq -c
```

HALT if a video is playing or a fitness session is active — wait and re-check. When clear:

```bash
./scripts/build-daylight.sh
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```

- [ ] **Step 4: Reload the piano tablet kiosk and verify**

The piano tablet runs FKB at `10.0.0.245:2323` (password in `data/household/auth/fullykiosk.yml`; read via `sudo docker exec daylight-station sh -c 'cat data/household/auth/fullykiosk.yml'`). Reload via Node's URLSearchParams (never shell-interpolated curl), from inside the container:

```bash
sudo docker exec daylight-station node -e "
const yaml = require('js-yaml');
const auth = yaml.load(require('fs').readFileSync('data/household/auth/fullykiosk.yml','utf8'));
const qs = new URLSearchParams({cmd:'loadStartURL',password:auth.password,type:'json'}).toString();
fetch('http://10.0.0.245:2323/?' + qs).then(r=>r.text()).then(console.log);
"
```

Then verify from docker logs (never "should be"): open Sheet Music → Key/Tempo/Loop sheets open and pick; Karaoke → volume button opens the Media+MIDI sheet, cards show the SVG play badge; Music → transport row + volume sheet. Headless Playwright screenshots of `https://daylightlocal.kckern.net/piano/...` routes are the non-invasive check if the tablet is in use.

- [ ] **Step 5: Final commit**

```bash
git add docs/
git commit -m "docs(piano): transport sheets + shared volume in the player reference docs"
```

---

## Self-review notes (already applied)

- Spec §1–§6 all map to tasks (primitives → 1-9; Sheet Music → 10-11; Karaoke/Singalong → 12; Music → 13; Videos/deletions → 6, 12-13; enforcement → 2 (size), 14 (glyphs); docs/verify → 15).
- Type consistency: `TransportButton` prop names (`on`, `onPress`, `ariaLabel`, `emphasis`) and sheet contracts (`open`/`onClose`/`onPick`) are identical across Tasks 2-13. `nearestStep`/`TEMPO_STEPS` have exactly one home (transport `TempoSheet.jsx`) after Task 10.
- The glyph regex intentionally omits `…` (ellipsis) and `–` (en-dash in `m9–m16` data labels) — those are text, not button pictures.
