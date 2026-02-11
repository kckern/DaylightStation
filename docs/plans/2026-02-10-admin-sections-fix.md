# Admin Sections Fix & Section Management Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the broken admin list UI (field name mismatch from normalizer) and add section management features (settings modal, reorder arrows, cross-section moves).

**Architecture:** The normalizer converts items from admin format (`label`/`input`/`action`) to runtime format (`title`/`play`/`queue`/`list`). The admin API GET endpoint needs a denormalize step to convert back. Section management adds a settings modal and up/down arrows on section headers.

**Tech Stack:** Express (backend), React + Mantine v7 (frontend), vitest (testing)

---

### Task 1: denormalizeForAdmin — Fix the broken list UI

The normalizer converts `{label, input, action}` → `{title, play/queue/list}`. The admin GET endpoint needs to convert back so `ListsItemRow` sees the `label`, `input`, and `action` fields it expects.

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs:286-299`
- Modify: `backend/src/1_adapters/content/list/listConfigNormalizer.mjs` (add `extractActionName` export)
- Test: `tests/isolated/adapter/content/list/listConfigNormalizer.test.mjs`

**Step 1: Add `extractActionName` to the normalizer**

In `backend/src/1_adapters/content/list/listConfigNormalizer.mjs`, add after the existing `extractContentId` function (after line 118):

```javascript
/**
 * Extract the action name from a normalized list item.
 * Returns the capitalized action key name (Play, Queue, List, Display, Open).
 * Falls back to action field or 'Play'.
 * @param {Object} item
 * @returns {string}
 */
export function extractActionName(item) {
  if (!item) return 'Play';
  if (item.action) return item.action;
  if (item.play) return 'Play';
  if (item.queue) return 'Queue';
  if (item.list) return 'List';
  if (item.display) return 'Display';
  if (item.open) return 'Open';
  return 'Play';
}
```

**Step 2: Add `denormalizeForAdmin` in content.mjs**

In `backend/src/4_api/v1/routers/admin/content.mjs`, update the import (line 37) to also import the new helpers:

```javascript
import { normalizeListConfig, serializeListConfig, extractContentId, extractActionName } from '#adapters/content/list/listConfigNormalizer.mjs';
```

Then add this helper function after the `toKebabCase`/`formatFilename`/`validateType` helpers (after line ~82):

```javascript
/**
 * Convert a normalized item back to admin-friendly format.
 * Adds label, input, and action fields that the admin UI expects,
 * while preserving all original fields.
 */
function denormalizeForAdmin(item) {
  const result = { ...item };
  if (!result.label) result.label = result.title || '';
  if (!result.input) result.input = extractContentId(result);
  if (!result.action) result.action = extractActionName(result);
  return result;
}
```

**Step 3: Use it in the GET endpoint**

In the GET `/lists/:type/:name` handler (line ~293), change the items mapping to apply denormalization:

Replace:
```javascript
items: section.items.map((item, ii) => ({ ...item, sectionIndex: si, itemIndex: ii }))
```

With:
```javascript
items: section.items.map((item, ii) => ({ ...denormalizeForAdmin(item), sectionIndex: si, itemIndex: ii }))
```

**Step 4: Also denormalize in the type listing endpoint**

The GET `/lists/:type` endpoint (line ~180) shows list summaries. It doesn't return items directly, so no change needed there.

**Step 5: Run tests**

```bash
npx vitest run tests/isolated/adapter/content/list/ --reporter=verbose
```

Expected: All 78+ existing tests pass. The new `extractActionName` function is tested implicitly through existing normalizer tests.

**Step 6: Manual verification**

Load `http://localhost:3111/admin/content/lists/menus/tvapp` in a browser. Items should now show labels, content comboboxes, and action badges correctly.

**Step 7: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs backend/src/1_adapters/content/list/listConfigNormalizer.mjs
git commit -m "fix: add admin denormalize layer so list items render correctly"
```

---

### Task 2: SectionSettingsModal — Section configuration UI

Create a modal for editing section-level settings. Follows the same pattern as `ListSettingsModal` but with section-specific fields.

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/SectionSettingsModal.jsx`

**Step 1: Create the component**

```jsx
import React, { useState, useEffect } from 'react';
import {
  Modal, TextInput, Switch, Chip, Group, Stack, Button,
  NumberInput, Box, Text
} from '@mantine/core';
import { DAYS_PRESETS, SECTION_DEFAULTS } from './listConstants.js';

function SectionSettingsModal({ opened, onClose, section, sectionIndex, onSave, loading }) {
  const [formData, setFormData] = useState({});

  useEffect(() => {
    if (opened && section) {
      setFormData({
        title: section.title || '',
        shuffle: section.shuffle ?? SECTION_DEFAULTS.shuffle,
        continuous: section.continuous ?? SECTION_DEFAULTS.continuous,
        fixed_order: section.fixed_order ?? SECTION_DEFAULTS.fixed_order,
        limit: section.limit ?? SECTION_DEFAULTS.limit,
        days: section.days ?? SECTION_DEFAULTS.days,
        active: section.active ?? SECTION_DEFAULTS.active,
        playbackrate: section.playbackrate ?? SECTION_DEFAULTS.playbackrate,
        priority: section.priority ?? SECTION_DEFAULTS.priority,
        hold: section.hold ?? SECTION_DEFAULTS.hold,
      });
    }
  }, [opened, section]);

  const onChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    // Only send fields that differ from defaults
    const payload = {};
    for (const [key, val] of Object.entries(formData)) {
      if (val !== SECTION_DEFAULTS[key] && val !== '' && val !== null) {
        payload[key] = val;
      }
    }
    // Always include title if set (even empty to clear)
    if (formData.title) payload.title = formData.title.trim();
    onSave(sectionIndex, payload);
  };

  return (
    <Modal opened={opened} onClose={onClose} title={`Section Settings${section?.title ? `: ${section.title}` : ''}`} centered size="md">
      <form onSubmit={handleSubmit}>
        <Stack>
          <TextInput
            label="Title"
            placeholder="Section title"
            value={formData.title || ''}
            onChange={(e) => onChange('title', e.target.value)}
          />

          <Group grow>
            <Switch label="Shuffle" checked={!!formData.shuffle} onChange={(e) => onChange('shuffle', e.target.checked)} />
            <Switch label="Continuous" checked={!!formData.continuous} onChange={(e) => onChange('continuous', e.target.checked)} />
            <Switch label="Fixed Order" checked={!!formData.fixed_order} onChange={(e) => onChange('fixed_order', e.target.checked)} />
          </Group>

          <Switch label="Active" description="Inactive sections are hidden" checked={formData.active !== false} onChange={(e) => onChange('active', e.target.checked)} />

          <Switch label="Hold" description="Prevent automatic progression" checked={!!formData.hold} onChange={(e) => onChange('hold', e.target.checked)} />

          <NumberInput
            label="Limit"
            description="Max items to select (for shuffle sections)"
            placeholder="No limit"
            min={1}
            value={formData.limit || ''}
            onChange={(val) => onChange('limit', val || null)}
          />

          <Box>
            <Text size="sm" fw={500} mb={8}>Days</Text>
            <Chip.Group value={formData.days || null} onChange={(value) => onChange('days', value || null)}>
              <Group gap="xs">
                {DAYS_PRESETS.map((preset) => (
                  <Chip key={preset.value || 'any'} value={preset.value} variant="outline">
                    {preset.label}
                  </Chip>
                ))}
              </Group>
            </Chip.Group>
          </Box>

          <NumberInput
            label="Priority"
            description="Higher priority sections are preferred"
            placeholder="Default"
            value={formData.priority || ''}
            onChange={(val) => onChange('priority', val || null)}
          />

          <Group justify="flex-end" mt="md">
            <Button variant="subtle" onClick={onClose}>Cancel</Button>
            <Button type="submit" loading={loading}>Save Section</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

export default SectionSettingsModal;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/SectionSettingsModal.jsx
git commit -m "feat: add SectionSettingsModal for section-level configuration"
```

---

### Task 3: Wire ListsFolder — separate section settings from list settings

Connect the new `SectionSettingsModal` in `ListsFolder.jsx`. Currently the SectionHeader gear icon sets `settingsOpen` to a section index, which incorrectly opens `ListSettingsModal`.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx:1-351`

**Step 1: Add state and import**

Add import at top (after line 22):
```javascript
import SectionSettingsModal from './SectionSettingsModal.jsx';
```

Add state for section settings (after line 45, near the other state declarations):
```javascript
const [sectionSettingsOpen, setSectionSettingsOpen] = useState(null); // section index or null
```

**Step 2: Change SectionHeader onUpdate**

Replace the `onUpdate` prop on `SectionHeader` (line ~296):

From:
```jsx
onUpdate={(idx, updates) => updates ? updateSection(idx, updates) : setSettingsOpen(idx)}
```

To:
```jsx
onUpdate={(idx, updates) => updates ? updateSection(idx, updates) : setSectionSettingsOpen(idx)}
```

**Step 3: Change ListSettingsModal to only handle list settings**

Replace the `ListSettingsModal` `opened` prop (line ~336):

From:
```jsx
opened={typeof settingsOpen === 'number' || settingsOpen === true}
```

To:
```jsx
opened={settingsOpen === true}
```

**Step 4: Add SectionSettingsModal**

Add after `ListSettingsModal` (after line ~344):

```jsx
<SectionSettingsModal
  opened={sectionSettingsOpen !== null}
  onClose={() => setSectionSettingsOpen(null)}
  section={sectionSettingsOpen !== null ? sections[sectionSettingsOpen] : null}
  sectionIndex={sectionSettingsOpen}
  onSave={async (idx, updates) => {
    await updateSection(idx, updates);
    setSectionSettingsOpen(null);
  }}
  loading={loading}
/>
```

**Step 5: Manual verification**

Load the admin list page. Click the kebab menu on a section header → "Section Settings". The section settings modal should open. The list-level settings (from the top-right kebab menu) should still work separately.

**Step 6: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "feat: wire SectionSettingsModal, separate from list settings"
```

---

### Task 4: Section reorder arrows on SectionHeader

Add up/down arrows to `SectionHeader` for reordering sections.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/SectionHeader.jsx`
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`

**Step 1: Add props and arrows to SectionHeader**

In `SectionHeader.jsx`, update the component to accept `onMoveUp`, `onMoveDown`, `isFirst`, `isLast` props. Add to the imports:

```javascript
import {
  IconChevronDown, IconChevronRight, IconSettings,
  IconTrash, IconDotsVertical, IconGripVertical,
  IconArrowsShuffle, IconSortAscending,
  IconArrowUp, IconArrowDown
} from '@tabler/icons-react';
```

Update the function signature:
```javascript
function SectionHeader({
  section, sectionIndex, collapsed, onToggleCollapse,
  onUpdate, onDelete, onMoveUp, onMoveDown,
  isFirst, isLast, itemCount, dragHandleProps
}) {
```

Add move items to the kebab menu (insert before the Delete menu item, line ~88):
```jsx
{!isFirst && (
  <Menu.Item leftSection={<IconArrowUp size={14} />} onClick={() => onMoveUp(sectionIndex)}>
    Move Up
  </Menu.Item>
)}
{!isLast && (
  <Menu.Item leftSection={<IconArrowDown size={14} />} onClick={() => onMoveDown(sectionIndex)}>
    Move Down
  </Menu.Item>
)}
```

**Step 2: Pass reorder handler from ListsFolder**

In `ListsFolder.jsx`, add handlers (near the other handlers, after line ~147):

```javascript
const handleMoveSection = async (fromIndex, direction) => {
  const newOrder = sections.map((_, i) => i);
  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= sections.length) return;
  [newOrder[fromIndex], newOrder[toIndex]] = [newOrder[toIndex], newOrder[fromIndex]];
  await reorderSections(newOrder);
};
```

Update the `SectionHeader` JSX to pass new props (line ~291):
```jsx
<SectionHeader
  section={section}
  sectionIndex={si}
  collapsed={collapsedSections.has(si)}
  onToggleCollapse={toggleCollapse}
  onUpdate={(idx, updates) => updates ? updateSection(idx, updates) : setSectionSettingsOpen(idx)}
  onDelete={deleteSection}
  onMoveUp={(idx) => handleMoveSection(idx, -1)}
  onMoveDown={(idx) => handleMoveSection(idx, 1)}
  isFirst={si === 0}
  isLast={si === sections.length - 1}
  itemCount={section.items.length}
/>
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/SectionHeader.jsx frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "feat: add section reorder arrows (move up/down)"
```

---

### Task 5: Cross-section move via editor

When editing an item and changing its section, call `moveItem()` to move it to the new section. Currently the section selector changes `sectionIndex` in the payload but the save handler doesn't detect section changes.

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx` (handleSaveItem)

**Step 1: Detect section change in handleSaveItem**

Replace the `handleSaveItem` function (line ~131):

```javascript
const handleSaveItem = async (itemData) => {
  if (editingItem) {
    const oldSection = editingItem.sectionIndex ?? 0;
    const newSection = itemData.sectionIndex ?? oldSection;
    // Remove sectionIndex from payload (not a stored field)
    const { sectionIndex, ...cleanData } = itemData;

    if (newSection !== oldSection) {
      // Move to new section, then update
      await moveItem(
        { section: oldSection, index: editingItem.itemIndex },
        { section: newSection, index: 0 }
      );
      // After move, update the item at its new position (index 0 in target section)
      await updateItem(newSection, 0, cleanData);
    } else {
      await updateItem(oldSection, editingItem.itemIndex, cleanData);
    }
  } else {
    const { sectionIndex, ...cleanData } = itemData;
    await addItem(sectionIndex ?? 0, cleanData);
  }
  setEditorOpen(false);
  setEditingItem(null);
};
```

**Step 2: Manual verification**

1. Open an item editor
2. Change the section dropdown
3. Save — item should move to the new section

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "feat: cross-section move when changing section in item editor"
```
