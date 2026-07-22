# School Home Shell (Sub-project 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the School app a home section grid so it owns its own navigation, with the existing quiz/flashcard browser as the first section — unblocking the Portal panel, which today lands directly on the bank list with nowhere else to go.

**Architecture:** A `SECTIONS` registry + `SectionGrid` home component render inside the existing `SchoolShell`, which gains one navigation level (`section` state) above the existing runner state (`active`). Back steps one level: runner → bank list → home → exit-if-`clear`. No new backend; no new endpoints. Spec: `docs/superpowers/specs/2026-07-22-school-materials-framework-design.md` §8.

**Tech Stack:** React (no TS), SCSS (BEM, `--school-*` tokens), vitest + @testing-library/react, structured logging via the `schoolLog` facade.

## Global Constraints

- Tests run with `npx vitest run <path>` from the repo root (`/opt/Code/DaylightStation`). The root `vitest.config.mjs` handles React/JSX and aliases — do not add config.
- **Never** use raw `console.*` for diagnostics — extend `frontend/src/modules/School/schoolLog.js` (facade over `lib/logging`).
- Touch targets ≥ 64px min-height; **no CSS animation/transitions** (the kiosk WebView drops frames — see comment atop `School.scss`); no drag interactions; no unicode-glyph icons (Android WebView renders them as tofu — inline SVG or text only).
- 2a ships **built-in sections only**. Do not add tiles for Courses/Reference/Listening/Games/Writing — their endpoints/specs are not built (spec §8 "Scope of 2a").
- Do not modify `modules/Player`, `lib/Player`, or anything under `modules/Piano`.
- Data-volume files are edited via `sudo docker exec` full-file writes — **never `sed -i`** inside the container. Files written via `docker exec` are root-owned; `chown node:node` after.
- Deploy gates (CLAUDE.local.md): the garage-in-use checks must run as their own step and **HALT** on failure — never chained with `&&` into stop/rm/deploy.
- Commit per task. This host (`kckern-server`) may commit and deploy autonomously.

---

### Task 1: Section registry + SectionGrid home component

**Files:**
- Create: `frontend/src/modules/School/home/sections.js`
- Create: `frontend/src/modules/School/home/SectionGrid.jsx`
- Create: `frontend/src/modules/School/home/SectionGrid.test.jsx`
- Modify: `frontend/src/modules/School/School.scss` (append a `.school-home` block)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: `SECTIONS` — array of `{ id: string, label: string, hint: string }`, first entry `{ id: 'banks', label: 'Quizzes & Flashcards', hint: 'Practice sets and tests' }`. `SectionGrid({ sections, onOpen })` — renders one `<button>` tile per section; `onOpen(id)` called with the section's `id` on tap. Task 2 imports both.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/modules/School/home/SectionGrid.test.jsx`:

```jsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import SectionGrid from './SectionGrid.jsx';
import { SECTIONS } from './sections.js';

describe('SectionGrid', () => {
  it('renders a tile per section and reports taps with the section id', () => {
    const onOpen = vi.fn();
    render(<SectionGrid sections={SECTIONS} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /quizzes & flashcards/i }));
    expect(onOpen).toHaveBeenCalledWith('banks');
  });

  it('renders label and hint text on the tile', () => {
    render(<SectionGrid sections={[{ id: 'x', label: 'Label X', hint: 'Hint X' }]} onOpen={() => {}} />);
    expect(screen.getByText('Label X')).toBeInTheDocument();
    expect(screen.getByText('Hint X')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/modules/School/home/SectionGrid.test.jsx`
Expected: FAIL — cannot resolve `./SectionGrid.jsx` / `./sections.js`.

- [ ] **Step 3: Write the registry and component**

Create `frontend/src/modules/School/home/sections.js`:

```js
/**
 * Built-in School sections (spec §8). This list is the home grid, and it is
 * deliberately short: 2a ships built-ins only. Category sections (Courses,
 * Reference, Listening) join as sub-project 2b delivers their endpoints, and
 * Games/Writing as their sub-projects land — a tile must never point at an
 * absent endpoint.
 */
export const SECTIONS = [
  { id: 'banks', label: 'Quizzes & Flashcards', hint: 'Practice sets and tests' },
];
```

Create `frontend/src/modules/School/home/SectionGrid.jsx`:

```jsx
/**
 * School home — the section grid (spec §8). The app's own top-level
 * navigation: SchoolShell renders this when no section is open. Pure
 * presentation; navigation state lives in the shell.
 */
export default function SectionGrid({ sections, onOpen }) {
  return (
    <div className="school-home">
      <div className="school-home__grid">
        {sections.map((s) => (
          <button
            key={s.id}
            type="button"
            className="school-home__tile"
            onClick={() => onOpen(s.id)}
          >
            <h3 className="school-home__label">{s.label}</h3>
            {s.hint && <p className="school-home__hint">{s.hint}</p>}
          </button>
        ))}
      </div>
    </div>
  );
}
```

Append to `frontend/src/modules/School/School.scss` (after the `.school-browse` block, matching its idiom — no animation, ≥64px targets):

```scss
// --- home section grid ---
.school-home {
  &__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1rem; }
  &__tile {
    display: flex; flex-direction: column; align-items: flex-start; gap: 0.5rem;
    min-height: 140px; padding: 1.5rem; text-align: left;
    border: 1px solid var(--school-border); border-radius: 12px;
    background: var(--school-surface); color: var(--school-fg); cursor: pointer;
  }
  &__label { margin: 0; font-size: 1.3rem; font-weight: 800; }
  &__hint { margin: 0; color: var(--school-muted); font-size: 1rem; }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/modules/School/home/SectionGrid.test.jsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/modules/School/home/ frontend/src/modules/School/School.scss
git commit -m "feat(school): section registry and home grid component (2a)"
```

---

### Task 2: Wire the home into SchoolShell + nav logging

**Files:**
- Modify: `frontend/src/modules/School/SchoolApp.jsx` (full file replacement below)
- Modify: `frontend/src/modules/School/schoolLog.js` (add `nav` category)
- Modify: `frontend/src/modules/School/schoolLog.test.js` (add `nav` cases)
- Modify: `frontend/src/modules/School/SchoolApp.test.jsx` (full file replacement below)

**Interfaces:**
- Consumes: `SECTIONS` and `SectionGrid({ sections, onOpen })` from Task 1 (exact shapes above).
- Produces: `SchoolApp({ clear })` behavior later tasks and kiosks rely on — lands on the section grid; back button aria-labels are exactly `'Back to bank list'` (runner open), `'Back to home'` (section open), `'Exit school'` (home, `clear` present); no back button at home without `clear`. Log events `school.nav.section {section}` and `school.nav.home` at info.

- [ ] **Step 1: Extend schoolLog and its test (write test first)**

In `frontend/src/modules/School/schoolLog.test.js`, add inside `describe('schoolLog', ...)`:

```js
  it('emits school.nav.section at info', () => {
    schoolLog.nav('section', { section: 'banks' });
    expect(info).toHaveBeenCalledWith('school.nav.section', expect.objectContaining({ section: 'banks' }));
  });

  it('emits school.nav.home at info', () => {
    schoolLog.nav('home', {});
    expect(info).toHaveBeenCalledWith('school.nav.home', expect.any(Object));
  });
```

Run: `npx vitest run frontend/src/modules/School/schoolLog.test.js`
Expected: FAIL — `schoolLog.nav is not a function` (7 existing tests still pass).

- [ ] **Step 2: Implement the nav category**

In `frontend/src/modules/School/schoolLog.js`, add one line to the `schoolLog` export, after the `session` entry:

```js
  nav:     (detail, data) => emit('nav', detail, data),               // section | home
```

Run: `npx vitest run frontend/src/modules/School/schoolLog.test.js`
Expected: PASS (9 tests).

- [ ] **Step 3: Replace SchoolApp.test.jsx with the nav-aware suite**

Overwrite `frontend/src/modules/School/SchoolApp.test.jsx` with:

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import SchoolApp from './SchoolApp.jsx';

const banksMock = vi.fn();
vi.mock('./schoolApi.js', () => ({
  schoolApi: {
    roster: vi.fn(async () => ({ ok: true, status: 200, data: [{ id: 'kid1', name: 'Alpha' }] })),
    banks: (...a) => banksMock(...a),
    bank: vi.fn(async (id) => ({ ok: true, status: 200, data: { id, title: 'Caps', audience: 'assigned', items: [{ id: 'q1', type: 'multiple_choice', prompt: 'WA?', answer: 'Olympia', choices: ['Seattle', 'Olympia'] }] } })),
    openSession: vi.fn(async () => ({ ok: true, status: 200, data: { sessionId: 'ses_1' } })),
    answer: vi.fn(async () => ({ ok: true, status: 200, data: { correct: true, expected: 'Olympia', attemptId: 'att_1' } })),
  },
}));

beforeEach(() => {
  localStorage.clear();
  banksMock.mockReset().mockImplementation(async (audience) => ({
    ok: true, status: 200,
    data: audience === 'generic'
      ? [{ id: 'animals', title: 'Animals', audience: 'generic', itemCount: 1 }]
      : [{ id: 'caps', title: 'Caps', audience: 'assigned', itemCount: 1 }, { id: 'animals', title: 'Animals', audience: 'generic', itemCount: 1 }],
  }));
});

// Both bank cards render the title as an <h3>; find the card wrapper so we can
// scope a Quiz/Cards button lookup to the specific bank under test (the grid
// otherwise has ambiguous duplicate "Quiz"/"Cards" buttons once both an
// assigned and a generic bank are visible at once).
function cardFor(title) {
  return screen.getByText(title).closest('.school-browse__card');
}

// The home grid is now the landing surface; every bank-flow test enters the
// banks section first.
async function openBanks() {
  fireEvent.click(await screen.findByRole('button', { name: /quizzes & flashcards/i }));
}

describe('SchoolApp home', () => {
  it('lands on the section grid and fetches no banks until the section opens', async () => {
    render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(banksMock).not.toHaveBeenCalled();
    await openBanks();
    expect(await screen.findByText('Caps')).toBeInTheDocument();
  });

  it('back from the bank list returns to the home grid', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Caps');
    fireEvent.click(screen.getByRole('button', { name: /back to home/i }));
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(screen.queryByText('Caps')).toBeNull();
  });

  it('home shows Exit school only when a clear prop exists', async () => {
    const { unmount } = render(<SchoolApp clear={() => {}} />);
    expect(await screen.findByRole('button', { name: /exit school/i })).toBeInTheDocument();
    unmount();
    render(<SchoolApp />);
    expect(await screen.findByRole('button', { name: /quizzes & flashcards/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /exit school/i })).toBeNull();
  });
});

describe('SchoolApp', () => {
  it('unclaimed browser sees both an assigned and a generic bank (gate loosened)', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    expect(await screen.findByText('Caps')).toBeInTheDocument();
    expect(screen.getByText('Animals')).toBeInTheDocument();
  });

  it('unclaimed: launching an assigned bank opens the picker; picking a profile proceeds into the runner', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument(); // ProfilePicker
    fireEvent.click(screen.getByText('Alpha'));
    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });

  it('unclaimed: launching an assigned bank then dismissing the picker refuses it, does not enter the runner, and narrows the list to generic', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Caps');
    fireEvent.click(within(cardFor('Caps')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // dismiss picker -> guest

    expect(await screen.findByText(/sign in to take this one/i)).toBeInTheDocument();
    expect(screen.queryByText('WA?')).toBeNull();

    await waitFor(() => expect(banksMock).toHaveBeenLastCalledWith('generic'));
    expect(await screen.findByText('Animals')).toBeInTheDocument();
    expect(screen.queryByText('Caps')).toBeNull();
  });

  it('unclaimed: launching a generic bank then dismissing the picker proceeds as guest into the runner', async () => {
    render(<SchoolApp clear={() => {}} />);
    await openBanks();
    await screen.findByText('Animals');
    fireEvent.click(within(cardFor('Animals')).getByRole('button', { name: /quiz/i }));
    await screen.findByRole('dialog');
    fireEvent.click(screen.getByLabelText(/close/i)); // dismiss picker -> guest, but generic work proceeds

    expect(await screen.findByText('WA?')).toBeInTheDocument();
  });
});
```

Run: `npx vitest run frontend/src/modules/School/SchoolApp.test.jsx`
Expected: FAIL — no element with role button named /quizzes & flashcards/ (SchoolApp still lands on the bank list).

- [ ] **Step 4: Replace SchoolApp.jsx**

Overwrite `frontend/src/modules/School/SchoolApp.jsx` with:

```jsx
/**
 * School app root (registered as 'school' in appRegistry; AppContainer passes
 * {clear}). Owns two navigation levels: the home section grid (spec §8), and
 * — inside the banks section — the picker-flow: launching tracked work while
 * unclaimed opens the ProfilePicker with the launch pending (spec §6 — claim
 * prompt on tracked work; browsing never prompts).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import ProfilePicker from '../../lib/identity/ProfilePicker.jsx';
import ProfileAvatar from '../../lib/identity/ProfileAvatar.jsx';
import { SchoolProfileProvider, useSchoolProfile } from './identity/SchoolProfileContext.jsx';
import BankBrowser from './browse/BankBrowser.jsx';
import QuizRunner from './quiz/QuizRunner.jsx';
import FlashcardRunner from './flashcards/FlashcardRunner.jsx';
import SectionGrid from './home/SectionGrid.jsx';
import { SECTIONS } from './home/sections.js';
import { schoolApi } from './schoolApi.js';
import { schoolLog } from './schoolLog.js';
import './School.scss';

function SchoolShell({ clear }) {
  const { status, roster, currentUser, isGuest, pickerOpen, openPicker, claim, continueAsGuest } = useSchoolProfile();
  const [section, setSection] = useState(null); // a SECTIONS id, or null = home grid
  const [active, setActive] = useState(null);   // {bank, mode} — only ever set within 'banks'
  const [pending, setPending] = useState(null); // {bankSummary, mode} awaiting a claim
  const [notice, setNotice] = useState(null);
  // Set alongside the notice, in the same synchronous pass as the
  // continueAsGuest() that produces it (see onDismiss) -- so the
  // identity-change effect below, which runs on that very transition, knows
  // to leave the freshly-set notice alone this one time rather than
  // immediately wiping out the notice its own transition just created.
  const justSetNoticeRef = useRef(false);

  const start = useCallback(async (bankSummary, mode, asGuest) => {
    if (asGuest && bankSummary.audience !== 'generic') {
      justSetNoticeRef.current = true;
      setNotice('Sign in to take this one — guests get the practice sets.');
      return;
    }
    const { ok, data } = await schoolApi.bank(bankSummary.id);
    if (ok) { setNotice(null); setActive({ bank: data, mode }); }
  }, []);

  // Returns the in-flight promise (rather than firing-and-forgetting) so a
  // caller — BankBrowser's double-tap guard — can await completion before
  // re-arming, the same async-guard convention as FlashcardRunner's grade().
  const onLaunch = useCallback(async (bankSummary, mode) => {
    if (!currentUser && !isGuest) {
      setPending({ bankSummary, mode });
      openPicker();
      return;
    }
    await start(bankSummary, mode, isGuest);
  }, [currentUser, isGuest, openPicker, start]);

  const onPick = useCallback((id) => {
    claim(id);
    if (pending) { start(pending.bankSummary, pending.mode, false); setPending(null); }
  }, [claim, pending, start]);

  const onDismiss = useCallback(() => {
    continueAsGuest();
    if (pending) { start(pending.bankSummary, pending.mode, true); setPending(null); }
  }, [continueAsGuest, pending, start]);

  const openSection = useCallback((id) => {
    setSection(id);
    schoolLog.nav('section', { section: id });
  }, []);

  // Going home also clears any guest-refusal notice: the notice belongs to
  // the section visit that produced it and must not greet the next visit.
  const goHome = useCallback(() => {
    setSection(null);
    setNotice(null);
    schoolLog.nav('home', {});
  }, []);

  // A guest-refusal notice is only ever relevant to the identity that
  // triggered it. If the child then signs in (or otherwise changes identity,
  // e.g. via the header chip alone, with no pending launch involved) a stale
  // "sign in to take this one" notice must not linger and misrepresent the
  // current identity. The one exception is the transition that just CREATED
  // the notice (continueAsGuest() + the refusal inside start(), batched into
  // the same render) -- justSetNoticeRef lets that single pass through.
  useEffect(() => {
    if (justSetNoticeRef.current) { justSetNoticeRef.current = false; return; }
    setNotice(null);
  }, [currentUser, isGuest]);

  const sectionDef = section ? SECTIONS.find((s) => s.id === section) : null;

  if (status !== 'ready') return <div className="school-app school-app--loading">Loading…</div>;
  return (
    <div className="school-app">
      <header className="school-app__header">
        {/* Back steps one navigation level: runner -> bank list -> home ->
            exit. The last hop only exists when School is mounted as an app
            (AppContainer passes `clear`); when School IS the screen (the
            `school` widget — the Portal's whole purpose) there is nowhere to
            exit TO, so at home the control is omitted entirely rather than
            rendering a dead button on a touch-only panel. */}
        {(active || section || clear) && (
          <button
            type="button"
            className="school-app__back"
            aria-label={active ? 'Back to bank list' : section ? 'Back to home' : 'Exit school'}
            onClick={() => (active ? setActive(null) : section ? goHome() : clear())}
          >
            ‹
          </button>
        )}
        <h1 className="school-app__title">{sectionDef ? sectionDef.label : 'School'}</h1>
        <button type="button" className="school-app__chip" onClick={openPicker}>
          {currentUser
            ? (<><ProfileAvatar id={currentUser.id} name={currentUser.name} /><span>{currentUser.name}</span></>)
            : <span>{isGuest ? 'Guest' : 'Tap to sign in'}</span>}
        </button>
      </header>
      <main className="school-app__body">
        {!section && <SectionGrid sections={SECTIONS} onOpen={openSection} />}
        {/* Only an EXPLICIT guest (continueAsGuest()) is restricted to the
            generic catalogue. An unclaimed child has not declined identity --
            they simply have not picked yet -- so they see everything and get
            prompted only when they try to launch tracked work (onLaunch
            above). Bank reads are ungated by design; real enforcement is
            server-side at session open (403 for guest vs an assigned bank). */}
        {section === 'banks' && !active && <BankBrowser guestOnly={isGuest} onLaunch={onLaunch} notice={notice} />}
        {active?.mode === 'quiz' && <QuizRunner bank={active.bank} onExit={() => setActive(null)} />}
        {active?.mode === 'flashcard' && <FlashcardRunner bank={active.bank} onExit={() => setActive(null)} />}
      </main>
      <ProfilePicker open={pickerOpen} users={roster} activeId={currentUser?.id} onPick={onPick} onDismiss={onDismiss} timeoutMs={30000} title="Who's here?" />
    </div>
  );
}

/**
 * Mounts two ways:
 *  - as a registered app via AppContainer, which passes `clear` to exit;
 *  - as the `school` screen widget, where it IS the screen (the Portal) and no
 *    `clear` exists because there is nothing behind it.
 */
export default function SchoolApp({ clear }) {
  return (
    <SchoolProfileProvider>
      <SchoolShell clear={clear} />
    </SchoolProfileProvider>
  );
}
```

- [ ] **Step 5: Run the full School suite**

Run: `npx vitest run frontend/src/modules/School/`
Expected: PASS — all files, including the untouched runner/item/context suites (`QuizRunner.test.jsx`, `FlashcardRunner.test.jsx`, `SchoolProfileContext.test.jsx`, `schoolApi.test.js`). If any of those fail, the shell change leaked — fix before committing.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/School/
git commit -m "feat(school): home section grid is the landing surface; banks becomes a section (2a)"
```

---

### Task 3: `/school` URL route

**Files:**
- Modify: `frontend/src/main.jsx` (routes block, currently lines 152–178)

**Interfaces:**
- Consumes: nothing from other tasks (the `school` app registry entry at `frontend/src/lib/appRegistry.js:26` already exists).
- Produces: `https://<host>/school` renders the School app (via redirect to `/app/school`, which `AppDirectRoute` already serves).

- [ ] **Step 1: Add the redirect route**

In `frontend/src/main.jsx`, inside `<Routes>`, directly after the `<Route path="/finances" ...>` line, add:

```jsx
        {/* /school — first-class URL for the School app; AppDirectRoute serves it. */}
        <Route path="/school" element={<Navigate to="/app/school" replace />} />
```

`Navigate` is already imported at the top of the file.

- [ ] **Step 2: Verify the frontend still builds**

Run: `cd frontend && npx vite build 2>&1 | tail -5; cd ..`
Expected: `✓ built in …` with no errors. (There is no unit harness for `main.jsx`; the build is the check, and Task 5 verifies the live URL end-to-end.)

- [ ] **Step 3: Commit**

```bash
git add frontend/src/main.jsx
git commit -m "feat(school): route /school to the School app"
```

---

### Task 4: Update the School reference docs

**Files:**
- Modify: `docs/reference/school/README.md`

**Interfaces:** none — documentation only. Per repo convention, `docs/reference/` is present-tense endstate: no class names, no "recently changed" language.

- [ ] **Step 1: Update §2 "Built and deployed"**

Add this subsection at the end of §2 (after the "Where it lives" table and spec link):

```markdown
### The home shell

School's landing surface is a **section grid** — the app owns its own top-level
navigation. Sections come from two places: built-ins (Quizzes & Flashcards
today; Games and Writing when their sub-projects land) and, once the materials
framework ships, one section per material category. A tile never points at an
absent endpoint.

Back steps one navigation level: runner → bank list → home → exit. The exit
control only exists when School is mounted as an app; on the Portal, where
School is the screen, home is the root and no exit affordance renders.

**Design spec:** [`2026-07-22-school-materials-framework-design.md`](../../superpowers/specs/2026-07-22-school-materials-framework-design.md) §8
```

- [ ] **Step 2: Update the §3 table's video-courses row**

Replace the row:

```markdown
| **Video courses** (+ learning log) | [`2026-07-21-school-courses-design.md`](../../superpowers/specs/2026-07-21-school-courses-design.md) | Plex-backed courses modelled on the Piano Kiosk's Videos mode, including the sequential lock. A spoken learning log reusing `modules/VoiceCapture/` and `POST /api/v1/ai/transcribe` |
```

with:

```markdown
| **Materials framework** (courses, reference, listening) | [`2026-07-22-school-materials-framework-design.md`](../../superpowers/specs/2026-07-22-school-materials-framework-design.md) | Source adapters (Plex shows, Plex albums, readalong) normalised to materials with units; closed pedagogy categories; gate steps (`[readalong, quiz]`). Supersedes the video-courses spec |
```

- [ ] **Step 3: Update the §5 gotcha about the deleted menu**

Replace the bullet:

```markdown
- The old Portal menu list was deleted. Music, Ambient, Art and Webcam are
  currently unreachable from the panel and want a home inside School.
```

with:

```markdown
- The old Portal menu list was deleted; the School home grid is the panel's
  navigation now. Music and Art return as material *sources* when the
  materials framework lands (they are curricular; they get no top-level
  section of their own). Ambient and Webcam are screen-level utilities for
  the TouchChrome lane, not School sections — still unwired.
```

- [ ] **Step 4: Commit**

```bash
git add docs/reference/school/README.md
git commit -m "docs(school): home shell in reference; materials spec supersedes courses row"
```

---

### Task 5: Deploy, retire `routes.games`, reload the Portal, verify live

**Files:**
- Modify (data volume, not git): `data/household/screens/portal.yml` inside the `daylight-station` container — remove the `routes:` block.
- Create (scratchpad): `verify-school-home.mjs` (throwaway; scratchpad dir from the session env).

**Interfaces:**
- Consumes: everything committed in Tasks 1–4, merged to `main`.
- Produces: the live panel and `/school` URL running the new bundle; `routes.games` (the `retroarch/launchable` URL mapping — note `ScreenRenderer.jsx` *does* read `config.routes` for subpath autoplay, so this is removing a live-but-unwanted mapping per spec §8, not dead config) gone from the Portal screen config.

- [ ] **Step 1: Merge to main (if working in a worktree/branch)**

```bash
git checkout main && git merge --no-ff <feature-branch> && git branch -d <feature-branch>
```
Record the deleted branch in `docs/_archive/deleted-branches.md` per CLAUDE.md. If already on `main`, skip.

- [ ] **Step 2: Deploy gate — run alone, HALT on failure**

```bash
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -cE '"event":"playback.render_fps"|dash.buffer-level'
sudo docker logs --since 75s daylight-station 2>&1 \
  | grep -oE '"videoState":"[^"]*"|"sessionActive":[a-z]+|"rosterSize":[0-9]+' \
  | sort | uniq -c
```
Expected to proceed: first count `0`; no `videoState:"playing"`; `sessionActive:false`; `rosterSize:0`. **If not clear, STOP and wait — do not continue to Step 3.**

- [ ] **Step 3: Build and deploy**

```bash
sudo docker build -f docker/Dockerfile \
  -t kckern/daylight-station:latest \
  --build-arg BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --build-arg COMMIT_HASH="$(git rev-parse --short HEAD)" \
  .
sudo docker stop daylight-station && sudo docker rm daylight-station
sudo deploy-daylight
```
Then confirm the running container is the new commit:
```bash
sudo docker exec daylight-station sh -c 'cat /build.txt'; git rev-parse --short HEAD
```
Expected: the two short hashes match. (This change is frontend-only, which the Docker build always rebuilds; `--no-cache` is only needed when *backend* files change — see memory note on stale backend layers.)

- [ ] **Step 4: Remove `routes.games` from the live portal.yml**

```bash
S=/tmp/claude-1001/-opt-Code-DaylightStation/*/scratchpad   # session scratchpad
sudo docker exec daylight-station sh -c 'cat data/household/screens/portal.yml' > $S/portal.yml
cp $S/portal.yml $S/portal.yml.orig
```
Edit `$S/portal.yml` with the Edit tool — delete exactly this block (it sits between the `fkb:` block and `subscriptions:`):
```yaml
routes:
  games:
    contentId: retroarch/launchable
    menuStyle: arcade

```
Verify the edit is surgical:
```bash
diff $S/portal.yml.orig $S/portal.yml
```
Expected: only those 4 lines (plus the trailing blank) removed, nothing else. Then write back (base64 round-trip — safe for a file this size, avoids heredoc `$`-expansion pitfalls; never `sed -i` in the container):
```bash
B64=$(base64 -w0 $S/portal.yml)
sudo docker exec daylight-station sh -c "echo '$B64' | base64 -d > data/household/screens/portal.yml"
sudo docker exec daylight-station sh -c 'chown node:node data/household/screens/portal.yml'
sudo docker exec daylight-station sh -c 'cat data/household/screens/portal.yml' | diff - $S/portal.yml
```
Expected: final diff is empty. (Screen YAML is fetched per page load — no restart needed.)

- [ ] **Step 5: Reload the Portal kiosk**

```bash
export FKB_HOST=10.0.0.92:2323
export FKB_PW=$(sudo docker exec daylight-station sh -c 'cat data/household/auth/fullykiosk.yml' | grep -i password | sed 's/^[^:]*: *//' | tr -d '"'"'"'')
node cli/fkb.cli.mjs reload
```
Expected: `✓ loadStartUrl`. If FKB is unreachable, note it and continue — Step 6 verifies the deploy independently of the physical panel.

- [ ] **Step 6: Headless live verification**

Write `<scratchpad>/verify-school-home.mjs`:

```js
import pkg from '/opt/Code/DaylightStation/node_modules/playwright/index.js';
const { chromium } = pkg;
const b = await chromium.launch({ args: ['--no-sandbox', '--ignore-certificate-errors'] });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, ignoreHTTPSErrors: true });
const p = await ctx.newPage();

await p.goto('https://daylightlocal.kckern.net/school', { waitUntil: 'networkidle', timeout: 45000 });
await new Promise(r => setTimeout(r, 4000));
const schoolUrl = p.url();
const schoolText = await p.evaluate(() => document.body.innerText);

await p.goto('https://daylightlocal.kckern.net/screens/portal', { waitUntil: 'networkidle', timeout: 45000 });
await new Promise(r => setTimeout(r, 5000));
const portalText = await p.evaluate(() => document.body.innerText);
await b.close();

console.log('/school →', schoolUrl);
console.log('/school text:', schoolText.slice(0, 200).replace(/\n/g, ' | '));
console.log('/screens/portal text:', portalText.slice(0, 200).replace(/\n/g, ' | '));

const ok = /\/app\/school$/.test(schoolUrl)
  && /Quizzes & Flashcards/.test(schoolText)
  && /Quizzes & Flashcards/.test(portalText);
if (!ok) { console.error('VERIFY FAILED'); process.exit(1); }
console.log('VERIFY OK');
```

Run: `node <scratchpad>/verify-school-home.mjs`
Expected output ends `VERIFY OK`: `/school` lands on `/app/school`, and both surfaces show the home grid tile — the Portal no longer lands on the raw bank list. Capture the real exit code (`echo $?` → `0`); do not pipe the run through anything that would mask it.

- [ ] **Step 7: Push**

```bash
git push origin main
```

---

## Self-review notes (already applied)

- **Spec coverage (§8, 2a scope):** grid ✓ (T1/T2) · built-ins only, no absent-endpoint tiles ✓ (`sections.js` has exactly one entry) · BankBrowser demoted to a section body ✓ (T2) · `routes.games` retired ✓ (T5) · logging ships with the feature ✓ (T2) · docs updated ✓ (T4). The "worklist later" band and Games/Writing tiles are explicitly out of 2a.
- **Type consistency:** `SECTIONS` entries `{id,label,hint}`; `SectionGrid({sections,onOpen})`; aria-labels `'Back to bank list' / 'Back to home' / 'Exit school'` are identical in T2's component code and T2's tests; `schoolLog.nav('section'|'home', data)` matches the T2 test expectations.
- **Known behavior change:** the panel lands on a one-tile grid until 2b/9/10 add sections. Deliberate (spec §8): the home is the stable surface the worklist band and future sections attach to, and auto-skipping a lone section would make landing behavior lurch when section #2 arrives.
