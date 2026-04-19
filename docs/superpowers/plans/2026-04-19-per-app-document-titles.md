# Per-App Document Titles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each top-level app its own `document.title` in the form `<AppName> | Daylight Station` so browser tabs, history, and bookmarks are distinguishable.

**Architecture:** Add a small `useDocumentTitle(name)` hook that sets `document.title = \`${name} | Daylight Station\`` on mount and restores the previous title on unmount. Call it once from each top-level app component.

**Tech Stack:** React, Vitest, Testing Library. No new dependencies.

**Design reference:** `docs/superpowers/specs/2026-04-19-per-app-document-titles-design.md`

---

## File Structure

**New files:**
- `frontend/src/hooks/useDocumentTitle.js` — the hook
- `frontend/src/hooks/useDocumentTitle.test.jsx` — unit test for the hook

**Modified files (each gets one `useDocumentTitle(...)` call at the top of the component body, plus an import):**
- `frontend/src/Apps/AdminApp.jsx`
- `frontend/src/Apps/HomeApp.jsx`
- `frontend/src/Apps/LifeApp.jsx`
- `frontend/src/Apps/HealthApp.jsx`
- `frontend/src/Apps/FitnessApp.jsx`
- `frontend/src/Apps/FinanceApp.jsx`
- `frontend/src/Apps/MediaApp.jsx`
- `frontend/src/Apps/LiveStreamApp.jsx`
- `frontend/src/Apps/FeedApp.jsx`
- `frontend/src/Apps/TVApp.jsx`
- `frontend/src/Apps/CallApp.jsx`
- `frontend/src/modules/Auth/SetupWizard.jsx`
- `frontend/src/modules/Auth/InviteAccept.jsx`
- `frontend/src/screen-framework/ScreenRenderer.jsx`

**Skipped (per spec):** `OfficeRedirect` (redirects immediately, defined inline in `main.jsx`), `Blank` (404 fallback).

---

## Task 1: Hook + unit test

**Files:**
- Create: `frontend/src/hooks/useDocumentTitle.js`
- Create: `frontend/src/hooks/useDocumentTitle.test.jsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/hooks/useDocumentTitle.test.jsx` with this exact content:

```jsx
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import useDocumentTitle from './useDocumentTitle.js';

function Host({ name }) {
  useDocumentTitle(name);
  return null;
}

describe('useDocumentTitle', () => {
  beforeEach(() => {
    document.title = 'Daylight Station';
  });

  it('sets "<name> | Daylight Station" on mount', () => {
    render(<Host name="Media" />);
    expect(document.title).toBe('Media | Daylight Station');
  });

  it('falls back to plain suffix when name is falsy', () => {
    render(<Host name="" />);
    expect(document.title).toBe('Daylight Station');
  });

  it('updates the title when name changes', () => {
    const { rerender } = render(<Host name="Media" />);
    expect(document.title).toBe('Media | Daylight Station');
    rerender(<Host name="Feed" />);
    expect(document.title).toBe('Feed | Daylight Station');
  });

  it('restores the previous title on unmount', () => {
    document.title = 'Previous';
    const { unmount } = render(<Host name="Media" />);
    expect(document.title).toBe('Media | Daylight Station');
    unmount();
    expect(document.title).toBe('Previous');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run frontend/src/hooks/useDocumentTitle.test.jsx`

Expected: FAIL — module not found (`Failed to resolve import "./useDocumentTitle.js"`).

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/hooks/useDocumentTitle.js` with this exact content:

```js
import { useEffect } from 'react';

const SUFFIX = 'Daylight Station';

export default function useDocumentTitle(name) {
  useEffect(() => {
    const prev = document.title;
    document.title = name ? `${name} | ${SUFFIX}` : SUFFIX;
    return () => { document.title = prev; };
  }, [name]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run frontend/src/hooks/useDocumentTitle.test.jsx`

Expected: PASS — 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useDocumentTitle.js frontend/src/hooks/useDocumentTitle.test.jsx
git commit -m "feat(frontend): add useDocumentTitle hook"
```

---

## Task 2: Wire hook into the 11 files in `frontend/src/Apps/`

Each edit adds one import and one hook call at the top of the exported component body. The name strings come from the design doc table.

**Import line (add near top of file, alongside other imports):**
```jsx
import useDocumentTitle from '../hooks/useDocumentTitle.js';
```

**Hook call: place as the first line inside the component body, before any other hook or `const` declaration.**

- [ ] **Step 1: `Apps/AdminApp.jsx` — title `Admin`**

Add import near the top. Inside `function AdminApp() {` (currently at line 121), add as the first line of the body:

```jsx
useDocumentTitle('Admin');
```

- [ ] **Step 2: `Apps/HomeApp.jsx` — title `Home`**

Add import near the top. Inside `function HomeApp() {` (currently at line 6), add as the first line of the body:

```jsx
useDocumentTitle('Home');
```

- [ ] **Step 3: `Apps/LifeApp.jsx` — title `Life`**

Add import near the top. Inside `const LifeApp = () => {` (currently at line 50), add as the first line of the body:

```jsx
useDocumentTitle('Life');
```

- [ ] **Step 4: `Apps/HealthApp.jsx` — title `Health`**

Add import near the top. Inside `const HealthApp = () => {` (currently at line 10), add as the first line of the body:

```jsx
useDocumentTitle('Health');
```

- [ ] **Step 5: `Apps/FitnessApp.jsx` — title `Fitness`**

Add import near the top. Inside `const FitnessApp = () => {` (currently at line 30), add as the first line of the body:

```jsx
useDocumentTitle('Fitness');
```

- [ ] **Step 6: `Apps/FinanceApp.jsx` — title `Finances`**

Add import near the top. Inside `export default function App() {` (currently at line 46), add as the first line of the body:

```jsx
useDocumentTitle('Finances');
```

- [ ] **Step 7: `Apps/MediaApp.jsx` — title `Media`**

Add import near the top. Inside `export default function MediaApp() {` (currently at line 13), add as the first line of the body:

```jsx
useDocumentTitle('Media');
```

- [ ] **Step 8: `Apps/LiveStreamApp.jsx` — title `Live`**

Add import near the top. Inside `const LiveStreamApp = () => {` (currently at line 5), add as the first line of the body:

```jsx
useDocumentTitle('Live');
```

- [ ] **Step 9: `Apps/FeedApp.jsx` — title `Feed`**

Add import near the top. Inside `const FeedApp = () => {` (currently at line 146), add as the first line of the body:

```jsx
useDocumentTitle('Feed');
```

- [ ] **Step 10: `Apps/TVApp.jsx` — title `TV`**

Add import near the top. Inside `export default function TVApp({ appParam }) {` (currently at line 86), add as the first line of the body:

```jsx
useDocumentTitle('TV');
```

Note: The `/tv/app/:app` route is rendered via a `TVAppWithParams` wrapper in `main.jsx` that passes `:app` to this same `TVApp` — so this one call covers both `/tv` and `/tv/app/:app`.

- [ ] **Step 11: `Apps/CallApp.jsx` — title `Call`**

Add import near the top. Inside `export default function CallApp() {` (currently at line 76), add as the first line of the body:

```jsx
useDocumentTitle('Call');
```

- [ ] **Step 12: Verify the existing vitest suite still passes**

Run: `npx vitest run frontend/src/hooks/`

Expected: PASS — `useDocumentTitle` and existing hook tests green.

- [ ] **Step 13: Commit**

```bash
git add frontend/src/Apps/
git commit -m "feat(frontend): set per-app document title in Apps/"
```

---

## Task 3: Wire hook into the 3 files outside `Apps/`

Import path differs because these files are at different depths.

- [ ] **Step 1: `modules/Auth/SetupWizard.jsx` — title `Setup`**

Add this import near the top of the file (other imports start at line 2):

```jsx
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
```

Inside `export default function SetupWizard({ onComplete }) {` (currently at line 8), add as the first line of the body:

```jsx
useDocumentTitle('Setup');
```

- [ ] **Step 2: `modules/Auth/InviteAccept.jsx` — title `Invite`**

Add this import near the top of the file:

```jsx
import useDocumentTitle from '../../hooks/useDocumentTitle.js';
```

Inside `export default function InviteAccept() {` (currently at line 10), add as the first line of the body:

```jsx
useDocumentTitle('Invite');
```

- [ ] **Step 3: `screen-framework/ScreenRenderer.jsx` — title `Screen`**

Add this import near the top of the file (other local imports use `'../lib/...'` and `'./...'`):

```jsx
import useDocumentTitle from '../hooks/useDocumentTitle.js';
```

Inside `export function ScreenRenderer({ screenId: propScreenId }) {` (currently at line 177), add as the first line of the body:

```jsx
useDocumentTitle('Screen');
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/modules/Auth/SetupWizard.jsx frontend/src/modules/Auth/InviteAccept.jsx frontend/src/screen-framework/ScreenRenderer.jsx
git commit -m "feat(frontend): set per-app document title for auth + screen routes"
```

---

## Task 4: Manual smoke verification

No new automated UI tests — per the spec, titles are low-risk one-line additions and any regression is immediately visible in the browser tab.

- [ ] **Step 1: Confirm dev server is running**

Check: `lsof -i :3112` (on kckern-server) or `:3111` on kckern-macbook.

If nothing is running, start: `node backend/index.js` (backend) and `npm run dev` (frontend) per CLAUDE.md.

- [ ] **Step 2: Load each route and verify the title**

Visit each URL in a browser (substitute dev host/port as appropriate) and confirm the tab title matches:

| URL | Expected tab title |
|---|---|
| `/` | `Admin \| Daylight Station` |
| `/admin/content/lists/menus` | `Admin \| Daylight Station` |
| `/home` | `Home \| Daylight Station` |
| `/life/now` | `Life \| Daylight Station` |
| `/health` | `Health \| Daylight Station` |
| `/fitness/` | `Fitness \| Daylight Station` |
| `/finances` | `Finances \| Daylight Station` |
| `/budget` | `Finances \| Daylight Station` |
| `/media` | `Media \| Daylight Station` |
| `/media/channels/` | `Live \| Daylight Station` |
| `/feed/scroll` | `Feed \| Daylight Station` |
| `/tv` | `TV \| Daylight Station` |
| `/call` | `Call \| Daylight Station` |
| `/setup` | `Setup \| Daylight Station` |

(`/invite/:token` and `/screen/:screenId/*` require valid tokens/IDs — skip unless you have them handy.)

- [ ] **Step 3: Verify tab-restore behavior**

Navigate between two apps (e.g., `/media` then browser-back to `/home`). Confirm the title tracks the navigation without stale values.

- [ ] **Step 4: Nothing to commit**

No new commit for verification. If any title is wrong, fix the component's `useDocumentTitle(...)` string and amend the relevant commit from Task 2 or 3 with a new commit (`fix(frontend): correct X title`).
