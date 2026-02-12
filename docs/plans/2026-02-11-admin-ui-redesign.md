# Admin UI Redesign — Mission Control Aesthetic

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the DaylightStation admin interface from a generic Mantine dark template into a distinctive, world-class "Mission Control" UI with custom typography, palette, navigation chrome, toast notifications, keyboard shortcuts, and polished interaction patterns.

**Architecture:** Phase A rewrites the theme, palette, sidebar, and header — immediately transforming how the entire app looks. Phase B wires toast notifications and keyboard shortcuts into existing hooks and forms. Phase C polishes tables, cards, and empty states across all sections. No backend changes. No route/component restructuring. Pure visual + interaction layer.

**Tech Stack:** Mantine 7 (custom theme), `@mantine/notifications` (already installed), Google Fonts (JetBrains Mono + IBM Plex Sans), CSS custom properties, `@mantine/hooks` (useHotkeys).

**PRD reference:** `docs/_wip/plans/2026-02-11-admin-ui-transformation.md`

---

## Phase A: Theme Foundation

The single highest-impact change: replace the 2-line Mantine theme with a comprehensive custom theme, load distinctive fonts, and define the DS design token palette.

---

### Task 1: Add Google Fonts to index.html

**Files:**
- Modify: `frontend/index.html`

**Step 1: Add font preconnect and stylesheet links**

Add these lines inside `<head>`, before the existing `<style>` block:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

**Step 2: Verify fonts load**

Run: `npx playwright test tests/live/flow/admin/admin-navigation.runtime.test.mjs --reporter=line`

Expected: All tests still pass (fonts are additive, no existing behavior changes).

**Step 3: Commit**

```bash
git add frontend/index.html
git commit -m "feat(admin): add JetBrains Mono + IBM Plex Sans font imports"
```

---

### Task 2: Create DS design token stylesheet

**Files:**
- Create: `frontend/src/modules/Admin/Admin.variables.scss`
- Modify: `frontend/src/Apps/AdminApp.scss` — import the new variables file

**Step 1: Write the design token file**

Create `frontend/src/modules/Admin/Admin.variables.scss`:

```scss
// DaylightStation Admin — Design Tokens
// Mission Control aesthetic: deep blue-black backgrounds, blue accent, monospace technical feel

:root {
  // Background layers (darkest → lightest)
  --ds-bg-base:       #0C0E14;
  --ds-bg-surface:    #12141C;
  --ds-bg-elevated:   #1A1D28;
  --ds-bg-overlay:    #222636;

  // Borders
  --ds-border:        #2A2E3D;
  --ds-border-focus:  #4A7BF7;

  // Text
  --ds-text-primary:   #E8EAF0;
  --ds-text-secondary: #8B90A0;
  --ds-text-muted:     #555A6E;

  // Accent
  --ds-accent:         #4A7BF7;
  --ds-accent-glow:    rgba(74, 123, 247, 0.15);
  --ds-accent-hover:   #5D8AFF;
  --ds-accent-subtle:  rgba(74, 123, 247, 0.08);

  // Semantic
  --ds-success:    #34D399;
  --ds-warning:    #FBBF24;
  --ds-danger:     #F87171;
  --ds-info:       #60A5FA;

  // Typography
  --ds-font-body:  'IBM Plex Sans', -apple-system, sans-serif;
  --ds-font-mono:  'JetBrains Mono', 'Fira Code', monospace;

  // Spacing (4px grid)
  --ds-space-1:  4px;
  --ds-space-2:  8px;
  --ds-space-3:  12px;
  --ds-space-4:  16px;
  --ds-space-5:  20px;
  --ds-space-6:  24px;
  --ds-space-8:  32px;
  --ds-space-10: 40px;

  // Transitions
  --ds-transition-fast: 100ms ease;
  --ds-transition-base: 150ms ease;
  --ds-transition-slow: 250ms ease;

  // Radii
  --ds-radius-sm: 4px;
  --ds-radius-md: 6px;
  --ds-radius-lg: 8px;

  // Shadows
  --ds-shadow-card:     0 1px 3px rgba(0, 0, 0, 0.3), 0 1px 2px rgba(0, 0, 0, 0.2);
  --ds-shadow-elevated: 0 4px 16px rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.3);
  --ds-shadow-glow:     0 0 20px var(--ds-accent-glow);
}

// Reduced motion support
@media (prefers-reduced-motion: reduce) {
  :root {
    --ds-transition-fast: 0ms;
    --ds-transition-base: 0ms;
    --ds-transition-slow: 0ms;
  }
}
```

**Step 2: Import in AdminApp.scss**

Replace the contents of `frontend/src/Apps/AdminApp.scss` with:

```scss
@import '../modules/Admin/Admin.variables.scss';

.admin-app {
  display: block;
  width: 100vw;
  height: 100vh;
  background-color: var(--ds-bg-base);
  font-family: var(--ds-font-body);
  color: var(--ds-text-primary);
}
```

**Step 3: Verify no visual regression**

Run: `npx playwright test tests/live/flow/admin/admin-navigation.runtime.test.mjs --reporter=line`

Expected: All tests pass. Background color changes from Mantine default to deep blue-black.

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/Admin.variables.scss frontend/src/Apps/AdminApp.scss
git commit -m "feat(admin): add DS design token palette and base app styling"
```

---

### Task 3: Replace Mantine theme with comprehensive custom theme

**Files:**
- Modify: `frontend/src/Apps/AdminApp.jsx`

**Step 1: Write the custom theme**

Replace the existing `theme` constant (lines 24-27) with:

```jsx
const DS_BLUE = [
  '#e8f0fe', '#c4d7fc', '#9ebcfa', '#789ff7', '#4A7BF7',
  '#3d6be0', '#3360cc', '#2952b3', '#1f4499', '#163680'
];

const theme = createTheme({
  primaryColor: 'ds-blue',
  fontFamily: '"IBM Plex Sans", -apple-system, sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", "Fira Code", monospace',
  headings: {
    fontFamily: '"JetBrains Mono", monospace',
    fontWeight: '600',
    sizes: {
      h1: { fontSize: '24px', lineHeight: '1.3' },
      h2: { fontSize: '20px', lineHeight: '1.35' },
      h3: { fontSize: '16px', lineHeight: '1.4' },
    },
  },
  colors: {
    'ds-blue': DS_BLUE,
  },
  defaultRadius: 'sm',
  components: {
    Button: {
      defaultProps: { radius: 'sm' },
    },
    Paper: {
      defaultProps: { radius: 'md' },
      styles: {
        root: {
          backgroundColor: 'var(--ds-bg-elevated)',
          border: '1px solid var(--ds-border)',
        },
      },
    },
    TextInput: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-bg-base)',
          borderColor: 'var(--ds-border)',
          '&:focus': {
            borderColor: 'var(--ds-border-focus)',
          },
        },
      },
    },
    NumberInput: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-bg-base)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    Select: {
      defaultProps: { radius: 'sm' },
      styles: {
        input: {
          backgroundColor: 'var(--ds-bg-base)',
          borderColor: 'var(--ds-border)',
        },
      },
    },
    Badge: {
      defaultProps: { radius: 'sm', variant: 'light' },
    },
    Modal: {
      styles: {
        content: {
          backgroundColor: 'var(--ds-bg-elevated)',
          border: '1px solid var(--ds-border)',
        },
        header: {
          backgroundColor: 'var(--ds-bg-elevated)',
        },
      },
    },
    Table: {
      styles: {
        th: {
          fontFamily: '"JetBrains Mono", monospace',
          fontSize: '11px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          color: 'var(--ds-text-secondary)',
        },
      },
    },
  },
});
```

**Step 2: Verify the app renders**

Run: `npx playwright test tests/live/flow/admin/admin-navigation.runtime.test.mjs --reporter=line`

Expected: All tests pass. Fonts are now IBM Plex Sans for body, JetBrains Mono for headings/table headers.

**Step 3: Commit**

```bash
git add frontend/src/Apps/AdminApp.jsx
git commit -m "feat(admin): replace default Mantine theme with Mission Control custom theme"
```

---

### Task 4: Restyle the sidebar navigation

**Files:**
- Modify: `frontend/src/modules/Admin/AdminNav.jsx`
- Modify: `frontend/src/modules/Admin/Admin.scss`

**Step 1: Update AdminNav.jsx with custom styling**

Replace the entire file with:

```jsx
import React from 'react';
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom';
import { NavLink, Stack, Text, Box } from '@mantine/core';
import {
  IconMenu2, IconPlayerRecord, IconCalendarEvent,
  IconRun, IconCoin, IconHeart, IconShoppingCart,
  IconUsers, IconDevices,
  IconPlugConnected, IconClock, IconFileCode
} from '@tabler/icons-react';

const navSections = [
  {
    label: 'CONTENT',
    items: [
      { label: 'Menus', icon: IconMenu2, to: '/admin/content/lists/menus' },
      { label: 'Watchlists', icon: IconPlayerRecord, to: '/admin/content/lists/watchlists' },
      { label: 'Programs', icon: IconCalendarEvent, to: '/admin/content/lists/programs' },
    ]
  },
  {
    label: 'APPS',
    items: [
      { label: 'Fitness', icon: IconRun, to: '/admin/apps/fitness' },
      { label: 'Finance', icon: IconCoin, to: '/admin/apps/finance' },
      { label: 'Gratitude', icon: IconHeart, to: '/admin/apps/gratitude' },
      { label: 'Shopping', icon: IconShoppingCart, to: '/admin/apps/shopping' },
    ]
  },
  {
    label: 'HOUSEHOLD',
    items: [
      { label: 'Members', icon: IconUsers, to: '/admin/household/members' },
      { label: 'Devices', icon: IconDevices, to: '/admin/household/devices' },
    ]
  },
  {
    label: 'SYSTEM',
    items: [
      { label: 'Integrations', icon: IconPlugConnected, to: '/admin/system/integrations' },
      { label: 'Scheduler', icon: IconClock, to: '/admin/system/scheduler' },
      { label: 'Config', icon: IconFileCode, to: '/admin/system/config' },
    ]
  }
];

function AdminNav() {
  const location = useLocation();

  return (
    <Stack gap={0} className="ds-nav">
      {/* Brand */}
      <Box className="ds-nav-brand" py="md" px="md" mb="sm">
        <Text
          ff="var(--ds-font-mono)"
          fw={600}
          size="sm"
          c="var(--ds-text-primary)"
          style={{ letterSpacing: '0.12em' }}
        >
          <span style={{ color: 'var(--ds-warning)' }}>&#9679;</span>{' '}DAYLIGHT
        </Text>
      </Box>

      {navSections.map((section) => (
        <Box key={section.label} mb="md">
          <Text
            className="ds-nav-section-label"
            size="10px"
            fw={500}
            ff="var(--ds-font-mono)"
            c="var(--ds-text-muted)"
            tt="uppercase"
            px="md"
            mb={4}
            style={{ letterSpacing: '0.15em' }}
          >
            {section.label}
          </Text>
          {section.items.map(item => {
            const isActive = location.pathname.startsWith(item.to);
            return (
              <NavLink
                key={item.to}
                component={RouterNavLink}
                to={item.to}
                label={
                  <Text size="13px" fw={isActive ? 500 : 400} ff="var(--ds-font-body)">
                    {item.label}
                  </Text>
                }
                leftSection={
                  <item.icon
                    size={18}
                    stroke={1.5}
                    color={isActive ? 'var(--ds-accent)' : 'var(--ds-text-secondary)'}
                  />
                }
                active={isActive}
                variant="subtle"
                className={`ds-nav-item ${isActive ? 'ds-nav-item-active' : ''}`}
              />
            );
          })}
        </Box>
      ))}
    </Stack>
  );
}

export default AdminNav;
```

**Step 2: Restyle Admin.scss with sidebar and nav theming**

Replace the entire contents of `frontend/src/modules/Admin/Admin.scss` with:

```scss
@import './Admin.variables.scss';

.admin-layout {
  // Sidebar
  .mantine-AppShell-navbar {
    background-color: var(--ds-bg-base);
    border-right: 1px solid var(--ds-border);
  }

  // Header
  .mantine-AppShell-header {
    background-color: transparent;
    border-bottom: none;
  }

  // Main content area
  .mantine-AppShell-main {
    background-color: var(--ds-bg-surface);
    min-width: 0;
    overflow-y: auto;
    padding: var(--ds-space-8);

    > * {
      width: 100%;
      max-width: 1200px;
      margin-inline: auto;
    }
  }
}

// Navigation item styling
.ds-nav-item {
  border-radius: 0;
  padding: var(--ds-space-2) var(--ds-space-4);
  border-left: 3px solid transparent;
  transition:
    background-color var(--ds-transition-fast),
    border-color var(--ds-transition-fast);

  &:hover {
    background-color: var(--ds-bg-elevated) !important;
  }

  &.ds-nav-item-active,
  &[data-active="true"] {
    background-color: var(--ds-bg-overlay) !important;
    border-left-color: var(--ds-accent);
    box-shadow: inset 0 0 20px var(--ds-accent-subtle);
  }

  // Override Mantine's default active background
  .mantine-NavLink-body {
    color: var(--ds-text-primary);
  }
}

// Brand area
.ds-nav-brand {
  border-bottom: 1px solid var(--ds-border);
}
```

**Step 3: Run the navigation tests**

Run: `npx playwright test tests/live/flow/admin/admin-navigation.runtime.test.mjs --reporter=line`

Expected: All tests pass. Sidebar now has brand mark, section labels in JetBrains Mono, active items with left accent border + glow.

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/AdminNav.jsx frontend/src/modules/Admin/Admin.scss
git commit -m "feat(admin): restyle sidebar with Mission Control nav, brand mark, accent borders"
```

---

### Task 5: Restyle the header with monospace breadcrumbs

**Files:**
- Modify: `frontend/src/modules/Admin/AdminHeader.jsx`

**Step 1: Rewrite AdminHeader with DS styling**

Replace the entire file with:

```jsx
import React from 'react';
import { useLocation } from 'react-router-dom';
import { Group, Burger, Text, Anchor, Box } from '@mantine/core';
import { Link } from 'react-router-dom';

function AdminHeader({ opened, toggle }) {
  const location = useLocation();

  const pathParts = location.pathname.split('/').filter(Boolean);
  const breadcrumbs = pathParts.map((part, idx) => {
    const path = '/' + pathParts.slice(0, idx + 1).join('/');
    const label = part.charAt(0).toUpperCase() + part.slice(1).replace(/-/g, ' ');
    const isLast = idx === pathParts.length - 1;

    return (
      <React.Fragment key={path}>
        {idx > 0 && (
          <Text
            component="span"
            size="12px"
            c="var(--ds-text-muted)"
            ff="var(--ds-font-mono)"
            mx={6}
          >
            /
          </Text>
        )}
        {isLast ? (
          <Text
            component="span"
            size="12px"
            fw={500}
            ff="var(--ds-font-mono)"
            c="var(--ds-text-primary)"
          >
            {label}
          </Text>
        ) : (
          <Anchor
            component={Link}
            to={path}
            size="12px"
            ff="var(--ds-font-mono)"
            c="var(--ds-text-secondary)"
            underline="never"
            style={{ '&:hover': { color: 'var(--ds-text-primary)' } }}
          >
            {label}
          </Anchor>
        )}
      </React.Fragment>
    );
  });

  return (
    <Group h="100%" px="md" justify="space-between">
      <Group gap="sm">
        <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
        <Box style={{ display: 'flex', alignItems: 'center' }}>
          {breadcrumbs}
        </Box>
      </Group>
      <div />
    </Group>
  );
}

export default AdminHeader;
```

**Step 2: Run navigation tests**

Run: `npx playwright test tests/live/flow/admin/admin-navigation.runtime.test.mjs --reporter=line`

Expected: All tests pass. Header now shows monospace breadcrumbs with `/` separators instead of Mantine's `›`.

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/AdminHeader.jsx
git commit -m "feat(admin): restyle header with monospace breadcrumbs, remove title"
```

---

### Task 6: Update AdminLayout dimensions

**Files:**
- Modify: `frontend/src/modules/Admin/AdminLayout.jsx`

**Step 1: Update sidebar width and header height**

Replace the entire file with:

```jsx
import React from 'react';
import { Outlet } from 'react-router-dom';
import { AppShell } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import AdminNav from './AdminNav.jsx';
import AdminHeader from './AdminHeader.jsx';
import './Admin.scss';

function AdminLayout() {
  const [opened, { toggle }] = useDisclosure();

  return (
    <AppShell
      className="admin-layout"
      header={{ height: 48 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      padding={0}
    >
      <AppShell.Header>
        <AdminHeader opened={opened} toggle={toggle} />
      </AppShell.Header>

      <AppShell.Navbar>
        <AdminNav />
      </AppShell.Navbar>

      <AppShell.Main>
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}

export default AdminLayout;
```

**Step 2: Run navigation tests**

Run: `npx playwright test tests/live/flow/admin/admin-navigation.runtime.test.mjs --reporter=line`

Expected: All tests pass. Sidebar is wider (260px), header is more compact (48px).

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/AdminLayout.jsx
git commit -m "feat(admin): adjust layout dimensions — 260px sidebar, 48px header"
```

---

## Phase B: Notifications & Keyboard Shortcuts

Wire up the notification system and keyboard shortcuts using existing Mantine dependencies.

---

### Task 7: Add Mantine Notifications provider

**Files:**
- Modify: `frontend/src/Apps/AdminApp.jsx`

**Step 1: Add Notifications import and provider**

Add to imports at the top of `AdminApp.jsx`:

```jsx
import { Notifications } from '@mantine/notifications';
import '@mantine/notifications/styles.css';
```

Then wrap the inner content with the Notifications component. The return statement becomes:

```jsx
return (
  <MantineProvider theme={theme} defaultColorScheme="dark">
    <Notifications position="bottom-right" autoClose={3000} />
    <div className="App admin-app">
      <Routes>
        {/* ... existing routes unchanged ... */}
      </Routes>
    </div>
  </MantineProvider>
);
```

**Step 2: Run navigation tests**

Run: `npx playwright test tests/live/flow/admin/admin-navigation.runtime.test.mjs --reporter=line`

Expected: All tests pass. Notifications provider is mounted but no toasts fire yet.

**Step 3: Commit**

```bash
git add frontend/src/Apps/AdminApp.jsx
git commit -m "feat(admin): mount Mantine Notifications provider"
```

---

### Task 8: Wire toast notifications into useAdminConfig

**Files:**
- Modify: `frontend/src/hooks/admin/useAdminConfig.js`

**Step 1: Add notification imports and calls**

Add to the top of the file:

```javascript
import { notifications } from '@mantine/notifications';
```

In the `save` callback, after the successful `setDirty(false)` line (line 65), add:

```javascript
notifications.show({
  title: 'Saved',
  message: `${filePath} updated`,
  color: 'green',
  autoClose: 3000,
});
```

In the `save` catch block, after `setError(err)` (line 69), add:

```javascript
notifications.show({
  title: 'Save failed',
  message: err.message || 'An error occurred',
  color: 'red',
  autoClose: false,
});
```

In the `revert` callback, after `setError(null)` (line 82), add:

```javascript
notifications.show({
  title: 'Reverted',
  message: 'Changes discarded',
  color: 'gray',
  autoClose: 2000,
});
```

**Step 2: Verify manually**

Start dev server, navigate to any config page (e.g., `/admin/apps/fitness`), make a change, save. Verify green toast appears at bottom-right. Revert — verify gray toast.

**Step 3: Commit**

```bash
git add frontend/src/hooks/admin/useAdminConfig.js
git commit -m "feat(admin): add toast notifications on config save/revert/error"
```

---

### Task 9: Add Cmd+S / Cmd+Z keyboard shortcuts to ConfigFormWrapper

**Files:**
- Modify: `frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx`

**Step 1: Add hotkey support**

Add to imports:

```jsx
import { useHotkeys } from '@mantine/hooks';
```

Inside the `ConfigFormWrapper` function, after the `handleSave` function, add:

```jsx
useHotkeys([
  ['mod+s', (e) => {
    e.preventDefault();
    if (dirty && !saving) handleSave();
  }],
  ['mod+z', (e) => {
    e.preventDefault();
    if (dirty && !saving) revert();
  }],
]);
```

**Step 2: Verify manually**

Navigate to any config form, make a change. Press Cmd+S (Mac) or Ctrl+S (Win). Verify it saves (toast appears). Make another change, press Cmd+Z. Verify it reverts.

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx
git commit -m "feat(admin): add Cmd+S save and Cmd+Z revert keyboard shortcuts"
```

---

## Phase C: Component Polish

Apply the DS palette and interaction patterns to tables, cards, forms, and empty states across all admin sections.

---

### Task 10: Polish ContentLists table rows and section headers

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss`

**Step 1: Update table row styling**

In `ContentLists.scss`, make these changes:

Replace the `.item-row` block (lines 58-78) with:

```scss
  .item-row {
    display: flex;
    align-items: center;
    padding: 2px 4px;
    background: var(--ds-bg-surface);
    border-bottom: 1px solid var(--ds-border);
    border-left: 3px solid transparent;
    height: 44px;
    min-height: 44px;
    max-height: 44px;
    transition:
      background-color var(--ds-transition-fast),
      border-color var(--ds-transition-fast);

    &:hover {
      background: var(--ds-bg-elevated);
      border-left-color: var(--ds-accent);
    }

    &:nth-child(even) {
      background: var(--ds-bg-elevated);

      &:hover {
        background: var(--ds-bg-overlay);
        border-left-color: var(--ds-accent);
      }
    }
```

Replace the `.table-header` border-bottom color (line 41):

```scss
    border-bottom: 1px solid var(--ds-border);
```

Replace the `.group-header` border-bottom (line 286):

```scss
      border-bottom: 2px solid var(--ds-border);
```

Replace the drag handle colors (lines 94-105):

```scss
    .col-drag {
      width: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      color: var(--ds-text-muted);
      flex-shrink: 0;
      flex-grow: 0;

      &:active {
        cursor: grabbing;
      }

      &:hover {
        color: var(--ds-text-secondary);
      }
    }
```

Replace hover backgrounds in `.col-label .editable-text`, `.col-input .content-display`, and `.col-config` from `var(--mantine-color-dark-5)` to `var(--ds-bg-overlay)`.

Replace shimmer gradient colors from `var(--mantine-color-dark-6)` / `var(--mantine-color-dark-5)` to `var(--ds-bg-elevated)` / `var(--ds-bg-overlay)`.

**Step 2: Run content list tests**

Run: `npx playwright test tests/live/flow/admin/admin-lists-comprehensive.runtime.test.mjs --reporter=line`

Expected: Tests pass. Rows are now 44px tall with accent left-border on hover.

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ContentLists.scss
git commit -m "feat(admin): polish content list rows — taller, DS palette, accent hover borders"
```

---

### Task 11: Polish list card hover and combobox dropdown

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss`

**Step 1: Update list card styles**

Replace the `.list-card` block (lines 1-9) with:

```scss
.list-card {
  cursor: pointer;
  background: var(--ds-bg-elevated) !important;
  border: 1px solid var(--ds-border) !important;
  transition:
    transform var(--ds-transition-base),
    box-shadow var(--ds-transition-base),
    border-color var(--ds-transition-base);

  &:hover {
    transform: translateY(-2px);
    box-shadow: var(--ds-shadow-elevated);
    border-color: var(--ds-accent) !important;
  }
}
```

**Step 2: Update combobox dropdown border**

Replace the `.mantine-Combobox-dropdown` block (lines 310-315) with:

```scss
.mantine-Combobox-dropdown {
  min-width: 350px !important;
  border: 2px solid var(--ds-accent) !important;
  box-shadow: var(--ds-shadow-elevated), var(--ds-shadow-glow) !important;
  border-radius: var(--ds-radius-lg) !important;
  background: var(--ds-bg-elevated) !important;
}
```

**Step 3: Run tests**

Run: `npx playwright test tests/live/flow/admin/admin-navigation.runtime.test.mjs --reporter=line`

Expected: All tests pass.

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ContentLists.scss
git commit -m "feat(admin): polish list cards and combobox dropdown with DS palette"
```

---

### Task 12: Add sticky action bar to ConfigFormWrapper

**Files:**
- Modify: `frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx`

**Step 1: Make the save/revert bar sticky**

Replace the `<Group justify="space-between">` wrapper around the title and buttons (lines 48-70) with:

```jsx
<Group
  justify="space-between"
  style={{
    position: 'sticky',
    top: 0,
    zIndex: 10,
    backgroundColor: 'var(--ds-bg-surface)',
    padding: 'var(--ds-space-4) 0',
    marginBottom: 'var(--ds-space-4)',
    borderBottom: dirty ? '1px solid var(--ds-border)' : '1px solid transparent',
    transition: 'border-color var(--ds-transition-base)',
  }}
>
  <Group gap="xs">
    <Text fw={600} size="lg" ff="var(--ds-font-mono)">{title}</Text>
    {dirty && (
      <Badge color="yellow" variant="light" size="sm">
        Unsaved
      </Badge>
    )}
  </Group>
  <Group gap="xs">
    <Button
      variant="subtle"
      leftSection={<IconArrowBack size={16} />}
      onClick={revert}
      disabled={!dirty || saving}
      size="sm"
    >
      Revert
    </Button>
    <Button
      leftSection={<IconDeviceFloppy size={16} />}
      onClick={handleSave}
      loading={saving}
      disabled={!dirty}
      size="sm"
      data-testid="config-save-button"
    >
      Save
    </Button>
  </Group>
</Group>
```

**Step 2: Verify the config editor test**

Run: `npx playwright test tests/live/flow/admin/admin-config-editor.runtime.test.mjs --reporter=line`

Expected: Tests pass. Save bar sticks to top when scrolling long forms.

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx
git commit -m "feat(admin): make config form action bar sticky with DS styling"
```

---

### Task 13: Style improvements for shared components

**Files:**
- Modify: `frontend/src/modules/Admin/shared/YamlEditor.scss`
- Modify: `frontend/src/modules/Admin/shared/ConfirmModal.jsx`

**Step 1: Update YamlEditor container border**

Replace the contents of `YamlEditor.scss` with:

```scss
.yaml-editor-wrapper {
  .yaml-editor-container {
    border: 1px solid var(--ds-border);
    border-radius: var(--ds-radius-md);
    overflow: hidden;

    .cm-editor {
      border-radius: var(--ds-radius-md);
    }

    &:focus-within {
      border-color: var(--ds-border-focus);
      box-shadow: 0 0 0 1px var(--ds-accent-glow);
    }
  }
}
```

**Step 2: Add entry animation to ConfirmModal**

In `ConfirmModal.jsx`, add `transitionProps` to the Modal:

```jsx
<Modal
  opened={opened}
  onClose={onClose}
  title={title}
  centered
  size="sm"
  transitionProps={{ transition: 'pop', duration: 150 }}
>
```

**Step 3: Run tests**

Run: `npx playwright test tests/live/flow/admin/admin-config-editor.runtime.test.mjs --reporter=line`

Expected: All tests pass.

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/shared/YamlEditor.scss frontend/src/modules/Admin/shared/ConfirmModal.jsx
git commit -m "feat(admin): polish YAML editor border states and modal transition"
```

---

### Task 14: Extract shared utility functions

**Files:**
- Create: `frontend/src/modules/Admin/utils/formatters.js`
- Create: `frontend/src/modules/Admin/utils/constants.js`

**Step 1: Create formatters.js**

```javascript
/**
 * Shared formatting utilities for the admin interface.
 */

/** Format bytes into human-readable size */
export function formatSize(bytes) {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/** Format ISO date string to relative time (e.g., "3m ago", "2h ago") */
export function formatRelativeTime(isoString) {
  if (!isoString) return '—';
  const diff = Date.now() - new Date(isoString).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Format milliseconds to human-readable duration */
export function formatDuration(ms) {
  if (!ms && ms !== 0) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  return `${minutes}m ${remainingSec}s`;
}

/** Capitalize first letter of a string */
export function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/** Convert kebab-case to Title Case */
export function kebabToTitle(str) {
  if (!str) return '';
  return str.split('-').map(capitalize).join(' ');
}

/** Truncate a URL for display */
export function truncateUrl(url, maxLength = 40) {
  if (!url) return '';
  if (url.length <= maxLength) return url;
  const withoutProtocol = url.replace(/^https?:\/\//, '');
  if (withoutProtocol.length <= maxLength) return withoutProtocol;
  return withoutProtocol.substring(0, maxLength - 3) + '...';
}

/** Convert cron expression to human-readable string */
export function cronToHuman(expr) {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, mon, dow] = parts;

  if (min.startsWith('*/')) return `Every ${min.slice(2)} min`;
  if (min === '0' && hour === '*') return 'Hourly';
  if (min === '0' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
    const h = parseInt(hour, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:00 ${ampm}`;
  }
  if (min !== '*' && hour !== '*' && dom === '*' && mon === '*' && dow === '*') {
    const h = parseInt(hour, 10);
    const m = parseInt(min, 10);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
    return `Daily at ${h12}:${String(m).padStart(2, '0')} ${ampm}`;
  }
  return expr;
}
```

**Step 2: Create constants.js**

```javascript
/**
 * Shared constants for the admin interface.
 */

export const DEVICE_TYPES = [
  { value: 'shield-tv', label: 'Shield TV' },
  { value: 'linux-pc', label: 'Linux PC' },
  { value: 'midi-keyboard', label: 'MIDI Keyboard' },
];

export const MEMBER_TYPES = [
  { value: 'owner', label: 'Owner' },
  { value: 'family_member', label: 'Family Member' },
];

export const MEMBER_GROUPS = [
  { value: 'primary', label: 'Primary' },
  { value: 'secondary', label: 'Secondary' },
];

export const INTEGRATION_CATEGORIES = {
  media: 'Media',
  gallery: 'Gallery',
  audiobooks: 'Audiobooks',
  ebooks: 'Ebooks',
  home_automation: 'Home Automation',
  ai: 'AI',
  finance: 'Finance',
  messaging: 'Messaging',
};

export const INTEGRATION_CATEGORY_ORDER = [
  'media', 'gallery', 'audiobooks', 'ebooks',
  'home_automation', 'ai', 'finance', 'messaging',
];

/** Badge color by member type */
export function typeBadgeColor(type) {
  switch (type) {
    case 'owner': return 'blue';
    case 'family_member': return 'teal';
    default: return 'gray';
  }
}

/** Badge color by member group */
export function groupBadgeColor(group) {
  switch (group) {
    case 'primary': return 'violet';
    case 'secondary': return 'orange';
    default: return 'gray';
  }
}

/** Badge color by job status */
export function statusBadgeColor(status) {
  switch (status) {
    case 'success': return 'green';
    case 'running': return 'blue';
    case 'failed': case 'error': return 'red';
    case 'disabled': return 'gray';
    default: return 'gray';
  }
}

/** Classify cron expression into frequency band */
export function getFrequencyBand(schedule) {
  if (!schedule) return 'Other';
  const parts = schedule.trim().split(/\s+/);
  if (parts.length < 5) return 'Other';
  const [min, hour] = parts;
  if (min.startsWith('*/')) {
    const interval = parseInt(min.slice(2), 10);
    if (interval <= 15) return 'Frequent';
    return 'Hourly';
  }
  if (min === '0' && hour === '*') return 'Hourly';
  if (hour !== '*') return 'Daily';
  return 'Other';
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/utils/formatters.js frontend/src/modules/Admin/utils/constants.js
git commit -m "feat(admin): extract shared utility functions and constants"
```

---

### Task 15: Playwright visual regression test for the redesigned UI

**Files:**
- Create: `tests/live/flow/admin/admin-ui-redesign.runtime.test.mjs`

**Step 1: Write the test**

```javascript
/**
 * Admin UI Redesign Verification
 *
 * Verifies:
 * 1. Custom fonts are loaded (JetBrains Mono, IBM Plex Sans)
 * 2. DS design tokens are applied (custom background colors)
 * 3. Brand mark renders in sidebar
 * 4. Navigation active state has accent border
 * 5. Breadcrumbs use monospace font with / separators
 * 6. Toast notification fires on save
 */

import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

const BASE_URL = FRONTEND_URL;

test.describe.configure({ mode: 'serial' });

let sharedPage;
let sharedContext;

test.beforeAll(async ({ browser }) => {
  sharedContext = await browser.newContext({
    viewport: { width: 1920, height: 1080 }
  });
  sharedPage = await sharedContext.newPage();
});

test.afterAll(async () => {
  if (sharedPage) await sharedPage.close();
  if (sharedContext) await sharedContext.close();
});

test.describe('Admin UI Redesign Verification', () => {
  test.setTimeout(60000);

  test('health check', async ({ request }) => {
    const response = await request.get(`${BASE_URL}/admin`);
    expect(response.status()).toBe(200);
  });

  test('brand mark renders in sidebar', async () => {
    await sharedPage.goto(`${BASE_URL}/admin`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });
    await sharedPage.waitForURL('**/admin/**', { timeout: 10000 });

    // Brand should contain "DAYLIGHT" text
    const brand = sharedPage.locator('.ds-nav-brand');
    await expect(brand).toBeVisible({ timeout: 5000 });
    const brandText = await brand.textContent();
    expect(brandText).toContain('DAYLIGHT');
  });

  test('active nav item has accent styling', async () => {
    // Click Menus nav item
    const menusLink = sharedPage.locator('.ds-nav-item', { hasText: 'Menus' }).first();
    await menusLink.click();
    await sharedPage.waitForURL('**/content/lists/menus', { timeout: 10000 });

    // The active item should have the ds-nav-item-active class
    const activeItem = sharedPage.locator('.ds-nav-item-active');
    const count = await activeItem.count();
    expect(count, 'Should have exactly one active nav item').toBeGreaterThanOrEqual(1);
  });

  test('breadcrumbs use / separators', async () => {
    // Navigate to a nested page
    await sharedPage.goto(`${BASE_URL}/admin/system/config`, {
      waitUntil: 'networkidle',
      timeout: 30000
    });

    // Look for the / separator in the header area
    const header = sharedPage.locator('.mantine-AppShell-header');
    const headerText = await header.textContent();
    expect(headerText).toContain('/');
    expect(headerText).toContain('System');
    expect(headerText).toContain('Config');
  });

  test('DS background colors are applied', async () => {
    // Check that the app shell has the custom dark background
    const adminApp = sharedPage.locator('.admin-app');
    const bgColor = await adminApp.evaluate(el =>
      getComputedStyle(el).backgroundColor
    );
    // Should be close to #0C0E14 (rgb(12, 14, 20))
    expect(bgColor).not.toBe('rgb(255, 255, 255)'); // Not white
    expect(bgColor).not.toBe('rgba(0, 0, 0, 0)');   // Not transparent
  });
});
```

**Step 2: Run the test**

Run: `npx playwright test tests/live/flow/admin/admin-ui-redesign.runtime.test.mjs --reporter=line`

Expected: All 5 tests pass.

**Step 3: Commit**

```bash
git add tests/live/flow/admin/admin-ui-redesign.runtime.test.mjs
git commit -m "test(admin): add Playwright tests verifying UI redesign elements"
```

---

## Summary: Task Dependency Graph

```
Phase A (Theme Foundation):
  Task 1: Google Fonts in index.html ─────────── independent
  Task 2: DS design token stylesheet ──────────── depends on Task 1
  Task 3: Custom Mantine theme ────────────────── depends on Task 2
  Task 4: Sidebar nav restyle ─────────────────── depends on Tasks 2, 3
  Task 5: Header breadcrumbs restyle ──────────── depends on Task 2
  Task 6: Layout dimension adjustments ────────── depends on Tasks 4, 5

Phase B (Notifications & Shortcuts):
  Task 7: Notifications provider ──────────────── depends on Task 3
  Task 8: Toast notifications in useAdminConfig ─ depends on Task 7
  Task 9: Cmd+S / Cmd+Z shortcuts ─────────────── depends on Task 8

Phase C (Component Polish):
  Task 10: Content list rows + sections ───────── depends on Task 2
  Task 11: List cards + combobox dropdown ─────── depends on Task 2
  Task 12: Sticky config form action bar ──────── depends on Tasks 2, 8
  Task 13: YamlEditor + ConfirmModal polish ───── depends on Task 2
  Task 14: Shared utilities extraction ────────── independent (can run anytime)
  Task 15: Playwright UI redesign tests ───────── depends on all above
```

**Parallelization opportunities:**
- Tasks 1-2 are sequential, then Tasks 3-6 can be parallelized across agents
- Tasks 10-13 are all independent of each other (only need Task 2 complete)
- Task 14 is independent and can be done anytime

---

Plan complete and saved to `docs/plans/2026-02-11-admin-ui-redesign.md`. Two execution options:

**1. Subagent-Driven (this session)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Parallel Session (separate)** — Open a new session with executing-plans, batch execution with checkpoints

Which approach?