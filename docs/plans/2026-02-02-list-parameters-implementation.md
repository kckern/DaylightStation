# List Parameters Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full parameter editing support for list items (playback, scheduling, display) and list-level metadata (title, description, sorting) with a two-mode editor and enhanced table view.

**Architecture:** Extend existing ContentLists admin module with two-mode item editor (Simple/Full), config indicator column in table, progress column for watchlists, list settings modal, and backend support for new YAML structure with backward compatibility.

**Tech Stack:** React, Mantine UI, Express.js, YAML config files

---

## Phase 1: Backend - YAML Format Migration

### Task 1: Update List Parser for Dual Format Support

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs`

**Step 1: Add list parsing utility**

After line 54 (after `toKebabCase` function), add:

```js
/**
 * Parse list file content - supports both old (array) and new (object with items) formats
 * @param {string} filename - List filename (without extension)
 * @param {any} content - Parsed YAML content
 * @returns {Object} - Normalized list object with metadata and items
 */
function parseListContent(filename, content) {
  // Old format: array at root
  if (Array.isArray(content)) {
    return {
      title: formatFilename(filename),
      items: content
    };
  }

  // New format: object with items key
  if (content && typeof content === 'object') {
    return {
      title: content.title || formatFilename(filename),
      description: content.description || null,
      group: content.group || null,
      icon: content.icon || null,
      sorting: content.sorting || 'manual',
      days: content.days || null,
      active: content.active !== false,
      defaultAction: content.defaultAction || 'Play',
      defaultVolume: content.defaultVolume || null,
      defaultPlaybackRate: content.defaultPlaybackRate || null,
      items: content.items || []
    };
  }

  // Fallback for empty/null
  return {
    title: formatFilename(filename),
    items: []
  };
}

/**
 * Convert filename to display title
 * @param {string} filename - Kebab-case filename
 * @returns {string} - Title case display name
 */
function formatFilename(filename) {
  return filename
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Serialize list to YAML-ready object (new format, omitting defaults)
 * @param {Object} list - List object with metadata and items
 * @returns {Object} - Clean object for YAML serialization
 */
function serializeList(list) {
  const output = {};

  // Only write non-default metadata
  if (list.title) output.title = list.title;
  if (list.description) output.description = list.description;
  if (list.group) output.group = list.group;
  if (list.icon) output.icon = list.icon;
  if (list.sorting && list.sorting !== 'manual') output.sorting = list.sorting;
  if (list.days) output.days = list.days;
  if (list.active === false) output.active = false;
  if (list.defaultAction && list.defaultAction !== 'Play') output.defaultAction = list.defaultAction;
  if (list.defaultVolume != null) output.defaultVolume = list.defaultVolume;
  if (list.defaultPlaybackRate != null) output.defaultPlaybackRate = list.defaultPlaybackRate;

  output.items = list.items;

  return output;
}
```

**Step 2: Run backend (manual verification)**

```bash
node backend/index.js
```
Expected: Backend starts without errors.

**Step 3: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs
git commit -m "feat(admin): add dual-format list parser with metadata support"
```

---

### Task 2: Update GET /lists/:type Endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs:154-184`

**Step 1: Update the endpoint to include list metadata**

Replace the `router.get('/lists/:type'` handler (lines 154-184) with:

```js
  /**
   * GET /lists/:type - List all lists of a specific type with metadata
   */
  router.get('/lists/:type', (req, res) => {
    const { type } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    validateType(type);

    try {
      const typeDir = getTypeDir(type, householdId);
      const listNames = listYamlFiles(typeDir);

      const lists = listNames.map(name => {
        const rawContent = loadYamlSafe(path.join(typeDir, name));
        const parsed = parseListContent(name, rawContent);

        return {
          name,
          title: parsed.title,
          description: parsed.description,
          group: parsed.group,
          icon: parsed.icon,
          sorting: parsed.sorting,
          days: parsed.days,
          active: parsed.active,
          count: Array.isArray(parsed.items) ? parsed.items.length : 0,
          path: `config/lists/${type}/${name}.yml`
        };
      });

      logger.info?.('admin.lists.type.listed', { type, household: householdId, count: lists.length });

      res.json({
        type,
        lists,
        household: householdId
      });
    } catch (error) {
      logger.error?.('admin.lists.type.list.failed', { type, error: error.message, household: householdId });
      res.status(500).json({ error: `Failed to list ${type}` });
    }
  });
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs
git commit -m "feat(admin): include list metadata in GET /lists/:type response"
```

---

### Task 3: Update GET /lists/:type/:name Endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs:246-275`

**Step 1: Update to return full list with metadata**

Replace the `router.get('/lists/:type/:name'` handler with:

```js
  /**
   * GET /lists/:type/:name - Get list with metadata and items
   */
  router.get('/lists/:type/:name', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();

    validateType(type);

    const listPath = getListPath(type, listName, householdId);
    const rawContent = loadYamlSafe(listPath);

    if (rawContent === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    const parsed = parseListContent(listName, rawContent);

    // Add indices to items
    const indexedItems = (parsed.items || []).map((item, index) => ({
      index,
      ...item
    }));

    logger.info?.('admin.lists.loaded', { type, list: listName, count: indexedItems.length, household: householdId });

    res.json({
      type,
      list: listName,
      // List metadata
      title: parsed.title,
      description: parsed.description,
      group: parsed.group,
      icon: parsed.icon,
      sorting: parsed.sorting,
      days: parsed.days,
      active: parsed.active,
      defaultAction: parsed.defaultAction,
      defaultVolume: parsed.defaultVolume,
      defaultPlaybackRate: parsed.defaultPlaybackRate,
      // Items
      items: indexedItems,
      count: indexedItems.length,
      household: householdId
    });
  });
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs
git commit -m "feat(admin): return list metadata in GET /lists/:type/:name"
```

---

### Task 4: Add PUT /lists/:type/:name/settings Endpoint

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs`

**Step 1: Add new endpoint before item endpoints (around line 318)**

```js
  /**
   * PUT /lists/:type/:name/settings - Update list metadata
   */
  router.put('/lists/:type/:name/settings', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const updates = req.body || {};

    validateType(type);

    const listPath = getListPath(type, listName, householdId);
    const rawContent = loadYamlSafe(listPath);

    if (rawContent === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    try {
      const parsed = parseListContent(listName, rawContent);

      // Apply updates to metadata
      const allowedMetaFields = [
        'title', 'description', 'group', 'icon', 'sorting', 'days',
        'active', 'defaultAction', 'defaultVolume', 'defaultPlaybackRate'
      ];

      for (const field of allowedMetaFields) {
        if (updates[field] !== undefined) {
          parsed[field] = updates[field];
        }
      }

      // Serialize and save (always new format)
      const output = serializeList(parsed);
      saveYaml(listPath, output);

      logger.info?.('admin.lists.settings.updated', { type, list: listName, household: householdId });

      res.json({
        ok: true,
        type,
        list: listName
      });
    } catch (error) {
      logger.error?.('admin.lists.settings.update.failed', { type, list: listName, error: error.message });
      res.status(500).json({ error: 'Failed to update list settings' });
    }
  });
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs
git commit -m "feat(admin): add PUT /lists/:type/:name/settings endpoint"
```

---

### Task 5: Update PUT /lists/:type/:name to Use New Format

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs:280-317`

**Step 1: Update reorder endpoint to preserve metadata**

Replace the handler:

```js
  /**
   * PUT /lists/:type/:name - Replace list items (for reordering), preserves metadata
   */
  router.put('/lists/:type/:name', (req, res) => {
    const { type, name: listName } = req.params;
    const householdId = req.query.household || configService.getDefaultHouseholdId();
    const { items } = req.body || {};

    validateType(type);

    if (!items || !Array.isArray(items)) {
      throw new ValidationError('Items array is required', { field: 'items' });
    }

    const listPath = getListPath(type, listName, householdId);
    const rawContent = loadYamlSafe(listPath);

    if (rawContent === null) {
      throw new NotFoundError('List', `${type}/${listName}`);
    }

    try {
      const parsed = parseListContent(listName, rawContent);

      // Remove index field if present (it's computed, not stored)
      const cleanItems = items.map(({ index, ...item }) => item);
      parsed.items = cleanItems;

      // Serialize and save (always new format)
      const output = serializeList(parsed);
      saveYaml(listPath, output);

      logger.info?.('admin.lists.reordered', { type, list: listName, count: cleanItems.length, household: householdId });

      res.json({
        ok: true,
        type,
        list: listName,
        count: cleanItems.length
      });
    } catch (error) {
      logger.error?.('admin.lists.reorder.failed', { type, list: listName, error: error.message });
      res.status(500).json({ error: 'Failed to update list' });
    }
  });
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs
git commit -m "feat(admin): preserve list metadata when reordering items"
```

---

### Task 6: Update Item Endpoints to Use New Format

**Files:**
- Modify: `backend/src/4_api/v1/routers/admin/content.mjs`

**Step 1: Update POST items endpoint (add item)**

Update the POST /items handler to:
- Parse using new format
- Support all item fields (not just hardcoded list)
- Save using new format

**Step 2: Update PUT items/:index endpoint**

Update to:
- Parse using new format
- Accept any field updates (remove hardcoded allowedFields)
- Save using new format

**Step 3: Update DELETE items/:index endpoint**

Update to:
- Parse using new format
- Save using new format

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/content.mjs
git commit -m "feat(admin): update item endpoints to use new YAML format"
```

---

## Phase 2: Frontend - Hook Updates

### Task 7: Update useAdminLists Hook

**Files:**
- Modify: `frontend/src/hooks/admin/useAdminLists.js`

**Step 1: Add list metadata state**

Add after line 17:

```js
const [listMetadata, setListMetadata] = useState(null);
```

**Step 2: Update fetchItems to capture metadata**

Update `fetchItems` callback to store metadata:

```js
const fetchItems = useCallback(async (type, listName) => {
  setLoading(true);
  setError(null);
  try {
    const data = await DaylightAPI(`${API_BASE}/lists/${type}/${listName}`);
    setItems(data.items || []);
    setListMetadata({
      title: data.title,
      description: data.description,
      group: data.group,
      icon: data.icon,
      sorting: data.sorting,
      days: data.days,
      active: data.active,
      defaultAction: data.defaultAction,
      defaultVolume: data.defaultVolume,
      defaultPlaybackRate: data.defaultPlaybackRate
    });
    setCurrentType(type);
    setCurrentList(listName);
    logger.info('admin.lists.items.fetched', { type, list: listName, count: data.items?.length });
    return data;
  } catch (err) {
    setError(err);
    logger.error('admin.lists.items.fetch.failed', { type, list: listName, message: err.message });
    throw err;
  } finally {
    setLoading(false);
  }
}, [logger]);
```

**Step 3: Add updateListSettings function**

```js
const updateListSettings = useCallback(async (settings) => {
  if (!currentType || !currentList) throw new Error('No list selected');
  setLoading(true);
  setError(null);
  try {
    await DaylightAPI(`${API_BASE}/lists/${currentType}/${currentList}/settings`, settings, 'PUT');
    logger.info('admin.lists.settings.updated', { type: currentType, list: currentList });
    await fetchItems(currentType, currentList);
  } catch (err) {
    setError(err);
    logger.error('admin.lists.settings.update.failed', { type: currentType, list: currentList, message: err.message });
    throw err;
  } finally {
    setLoading(false);
  }
}, [currentType, currentList, fetchItems, logger]);
```

**Step 4: Update return object**

Add `listMetadata` and `updateListSettings` to the return object.

**Step 5: Commit**

```bash
git add frontend/src/hooks/admin/useAdminLists.js
git commit -m "feat(hook): add list metadata support to useAdminLists"
```

---

## Phase 3: Frontend - Item Editor Two-Mode

### Task 8: Create Item Parameter Constants

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/listConstants.js`

**Step 1: Create constants file**

```js
// Item action options
export const ACTION_OPTIONS = [
  { value: 'Play', label: 'Play' },
  { value: 'Queue', label: 'Queue' },
  { value: 'List', label: 'List' },
  { value: 'Display', label: 'Display' },
  { value: 'Read', label: 'Read' },
  { value: 'Open', label: 'Open' },
];

// Sorting options for lists
export const SORTING_OPTIONS = [
  { value: 'manual', label: 'Manual (drag & drop)' },
  { value: 'alphabetical', label: 'Alphabetical A-Z' },
  { value: 'reverse-alphabetical', label: 'Alphabetical Z-A' },
  { value: 'newest-first', label: 'Newest First' },
  { value: 'oldest-first', label: 'Oldest First' },
  { value: 'shuffle', label: 'Shuffle' },
  { value: 'progress', label: 'By Progress (watchlists)' },
];

// Days presets
export const DAYS_PRESETS = [
  { value: 'Daily', label: 'Daily' },
  { value: 'Weekdays', label: 'Weekdays' },
  { value: 'Weekend', label: 'Weekend' },
  { value: 'Sunday', label: 'Sunday' },
];

// Known item fields (for separating from custom fields)
export const KNOWN_ITEM_FIELDS = [
  'label', 'input', 'action', 'active', 'group', 'image', 'uid', 'index',
  'shuffle', 'continuous', 'loop', 'fixedOrder', 'volume', 'playbackRate',
  'days', 'snooze', 'waitUntil', 'shader', 'composite', 'playable',
  'progress', 'watched', 'summary', 'media_key', 'list'
];

// Default values for item fields
export const ITEM_DEFAULTS = {
  action: 'Play',
  active: true,
  shuffle: false,
  continuous: false,
  loop: false,
  fixedOrder: false,
  volume: 100,
  playbackRate: 1.0,
  playable: true,
  composite: false,
  watched: false,
};

// Config indicator icons with priority
export const CONFIG_INDICATORS = [
  { key: 'days', icon: 'IconCalendar', label: 'Days filter' },
  { key: 'snooze', icon: 'IconPlayerPause', label: 'Snoozed' },
  { key: 'waitUntil', icon: 'IconPlayerPause', label: 'Waiting until' },
  { key: 'shuffle', icon: 'IconArrowsShuffle', label: 'Shuffle' },
  { key: 'continuous', icon: 'IconRepeat', label: 'Continuous' },
  { key: 'loop', icon: 'IconRepeat', label: 'Loop' },
  { key: 'volume', icon: 'IconVolume', label: 'Volume', showWhen: v => v != null && v !== 100 },
  { key: 'playbackRate', icon: 'IconPlayerTrackNext', label: 'Playback rate', showWhen: v => v != null && v !== 1.0 },
  { key: 'shader', icon: 'IconPalette', label: 'Shader' },
];
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/listConstants.js
git commit -m "feat(admin): add list parameter constants"
```

---

### Task 9: Create Full Mode Editor Categories

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/EditorCategories.jsx`

**Step 1: Create category components**

```jsx
import React from 'react';
import {
  Accordion, TextInput, Select, Switch, Group, Stack, Slider, Text,
  Chip, NumberInput, Box, Alert, Textarea
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { IconAlertCircle } from '@tabler/icons-react';
import { ACTION_OPTIONS, DAYS_PRESETS } from './listConstants.js';

// Identity Category
export function IdentityCategory({ formData, onChange, errors, existingGroups, onImageUpload, imageFile }) {
  const groupOptions = existingGroups
    .filter(g => g)
    .map(g => ({ value: g, label: g }));

  return (
    <Stack gap="sm">
      <Group grow>
        <TextInput
          label="Label"
          placeholder="Item label"
          value={formData.label}
          onChange={(e) => onChange('label', e.target.value)}
          error={errors.label}
          required
        />
        <TextInput
          label="Input"
          placeholder="source:id (e.g., plex:123)"
          value={formData.input}
          onChange={(e) => onChange('input', e.target.value)}
          error={errors.input}
          required
        />
      </Group>
      <Group>
        <Select
          label="Action"
          data={ACTION_OPTIONS}
          value={formData.action}
          onChange={(v) => onChange('action', v)}
          style={{ width: 120 }}
        />
        <Select
          label="Group"
          data={groupOptions}
          value={formData.group || ''}
          onChange={(v) => onChange('group', v || null)}
          searchable
          creatable
          clearable
          placeholder="Optional"
          style={{ flex: 1 }}
        />
        <Switch
          label="Active"
          checked={formData.active}
          onChange={(e) => onChange('active', e.currentTarget.checked)}
          mt={24}
        />
      </Group>
    </Stack>
  );
}

// Playback Category
export function PlaybackCategory({ formData, onChange }) {
  return (
    <Stack gap="sm">
      <Group>
        <Switch
          label="Shuffle"
          checked={formData.shuffle || false}
          onChange={(e) => onChange('shuffle', e.currentTarget.checked)}
        />
        <Switch
          label="Continuous"
          checked={formData.continuous || false}
          onChange={(e) => onChange('continuous', e.currentTarget.checked)}
        />
        <Switch
          label="Loop"
          checked={formData.loop || false}
          onChange={(e) => onChange('loop', e.currentTarget.checked)}
        />
        <Switch
          label="Fixed Order"
          checked={formData.fixedOrder || false}
          onChange={(e) => onChange('fixedOrder', e.currentTarget.checked)}
        />
      </Group>
      <Group grow>
        <Box>
          <Text size="sm" fw={500} mb={4}>Volume</Text>
          <Group gap="xs">
            <Slider
              value={formData.volume ?? 100}
              onChange={(v) => onChange('volume', v)}
              min={0}
              max={100}
              style={{ flex: 1 }}
            />
            <NumberInput
              value={formData.volume ?? 100}
              onChange={(v) => onChange('volume', v)}
              min={0}
              max={100}
              style={{ width: 70 }}
              suffix="%"
            />
          </Group>
        </Box>
        <Box>
          <Text size="sm" fw={500} mb={4}>Playback Rate</Text>
          <Group gap="xs">
            <Slider
              value={formData.playbackRate ?? 1.0}
              onChange={(v) => onChange('playbackRate', v)}
              min={0.5}
              max={3}
              step={0.25}
              style={{ flex: 1 }}
            />
            <NumberInput
              value={formData.playbackRate ?? 1.0}
              onChange={(v) => onChange('playbackRate', v)}
              min={0.5}
              max={3}
              step={0.25}
              style={{ width: 70 }}
              suffix="x"
            />
          </Group>
        </Box>
      </Group>
    </Stack>
  );
}

// Scheduling Category
export function SchedulingCategory({ formData, onChange }) {
  return (
    <Stack gap="sm">
      <Box>
        <Text size="sm" fw={500} mb={4}>Days</Text>
        <Chip.Group
          multiple={false}
          value={formData.days || ''}
          onChange={(v) => onChange('days', v || null)}
        >
          <Group gap="xs">
            {DAYS_PRESETS.map(preset => (
              <Chip key={preset.value} value={preset.value} size="xs">
                {preset.label}
              </Chip>
            ))}
            <Chip value="" size="xs" variant="light">Clear</Chip>
          </Group>
        </Chip.Group>
        <TextInput
          placeholder="Custom (e.g., M•W•F)"
          value={!DAYS_PRESETS.find(p => p.value === formData.days) ? formData.days || '' : ''}
          onChange={(e) => onChange('days', e.target.value || null)}
          size="xs"
          mt="xs"
        />
      </Box>
      <Group grow>
        <TextInput
          label="Snooze"
          placeholder="e.g., 3d, 1w"
          value={formData.snooze || ''}
          onChange={(e) => onChange('snooze', e.target.value || null)}
        />
        <DatePickerInput
          label="Wait Until"
          placeholder="Select date"
          value={formData.waitUntil ? new Date(formData.waitUntil) : null}
          onChange={(d) => onChange('waitUntil', d ? d.toISOString().split('T')[0] : null)}
          clearable
        />
      </Group>
    </Stack>
  );
}

// Display Category
export function DisplayCategory({ formData, onChange, shaderOptions = [] }) {
  return (
    <Stack gap="sm">
      <Group>
        <Select
          label="Shader"
          data={shaderOptions}
          value={formData.shader || ''}
          onChange={(v) => onChange('shader', v || null)}
          placeholder="None"
          clearable
          style={{ width: 200 }}
        />
        <Switch
          label="Composite"
          description="Combine multiple sources"
          checked={formData.composite || false}
          onChange={(e) => onChange('composite', e.currentTarget.checked)}
          mt={24}
        />
        <Switch
          label="Playable"
          description="Can be played directly"
          checked={formData.playable !== false}
          onChange={(e) => onChange('playable', e.currentTarget.checked)}
          mt={24}
        />
      </Group>
    </Stack>
  );
}

// Progress Category (read-only with override)
export function ProgressCategory({ formData, onChange }) {
  const [showOverride, setShowOverride] = React.useState(false);

  return (
    <Stack gap="sm">
      <Group>
        <Box style={{ flex: 1 }}>
          <Text size="sm" c="dimmed">Current Progress</Text>
          <Text size="lg" fw={500}>
            {formData.progress != null ? `${formData.progress}%` : 'Not tracked'}
          </Text>
        </Box>
        <Box>
          <Text size="sm" c="dimmed">Watched</Text>
          <Text size="lg" fw={500}>
            {formData.watched ? 'Yes' : 'No'}
          </Text>
        </Box>
      </Group>

      {!showOverride ? (
        <Text
          size="xs"
          c="blue"
          style={{ cursor: 'pointer' }}
          onClick={() => setShowOverride(true)}
        >
          Override progress...
        </Text>
      ) : (
        <Box p="sm" style={{ background: 'var(--mantine-color-dark-6)', borderRadius: 4 }}>
          <Alert icon={<IconAlertCircle size={16} />} color="yellow" mb="sm">
            Manual overrides may be reset when media is played.
          </Alert>
          <Group>
            <NumberInput
              label="Progress %"
              value={formData.progress ?? 0}
              onChange={(v) => onChange('progress', v)}
              min={0}
              max={100}
              style={{ width: 100 }}
            />
            <Switch
              label="Mark as watched"
              checked={formData.watched || false}
              onChange={(e) => onChange('watched', e.currentTarget.checked)}
              mt={24}
            />
          </Group>
        </Box>
      )}
    </Stack>
  );
}

// Custom Fields Category
export function CustomFieldsCategory({ customFields, onUpdate }) {
  const entries = Object.entries(customFields || {});

  const handleKeyChange = (oldKey, newKey) => {
    const newFields = { ...customFields };
    const value = newFields[oldKey];
    delete newFields[oldKey];
    if (newKey) newFields[newKey] = value;
    onUpdate(newFields);
  };

  const handleValueChange = (key, value) => {
    onUpdate({ ...customFields, [key]: value });
  };

  const handleDelete = (key) => {
    const newFields = { ...customFields };
    delete newFields[key];
    onUpdate(newFields);
  };

  const handleAdd = () => {
    const key = `custom_${Date.now()}`;
    onUpdate({ ...customFields, [key]: '' });
  };

  return (
    <Stack gap="sm">
      {entries.map(([key, value]) => (
        <Group key={key} gap="xs">
          <TextInput
            placeholder="Key"
            value={key}
            onChange={(e) => handleKeyChange(key, e.target.value)}
            style={{ width: 150 }}
            size="xs"
          />
          <TextInput
            placeholder="Value"
            value={String(value)}
            onChange={(e) => handleValueChange(key, e.target.value)}
            style={{ flex: 1 }}
            size="xs"
          />
          <Text
            c="red"
            size="xs"
            style={{ cursor: 'pointer' }}
            onClick={() => handleDelete(key)}
          >
            ✕
          </Text>
        </Group>
      ))}
      <Text
        size="xs"
        c="blue"
        style={{ cursor: 'pointer' }}
        onClick={handleAdd}
      >
        + Add custom field
      </Text>
      <Text size="xs" c="dimmed">
        Custom fields are passed through as-is. Use with caution.
      </Text>
    </Stack>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/EditorCategories.jsx
git commit -m "feat(admin): create editor category components"
```

---

### Task 10: Rewrite ListsItemEditor with Two-Mode Support

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx`

**Step 1: Complete rewrite of the component**

This is a substantial rewrite. Create a new version that:
- Adds mode toggle (Simple/Full)
- Uses Accordion for categories in Full mode
- Handles all parameter types
- Separates custom fields from known fields
- Builds clean payload on save

[Full implementation code will be provided during execution]

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx
git commit -m "feat(admin): implement two-mode item editor"
```

---

## Phase 4: Frontend - Table View Updates

### Task 11: Add Config Indicators Component

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/ConfigIndicators.jsx`

**Step 1: Create component**

```jsx
import React from 'react';
import { Group, Text, Tooltip } from '@mantine/core';
import {
  IconCalendar, IconArrowsShuffle, IconRepeat, IconVolume,
  IconPlayerTrackNext, IconPalette, IconPlayerPause
} from '@tabler/icons-react';
import { CONFIG_INDICATORS } from './listConstants.js';

const ICON_MAP = {
  IconCalendar,
  IconArrowsShuffle,
  IconRepeat,
  IconVolume,
  IconPlayerTrackNext,
  IconPalette,
  IconPlayerPause,
};

export function ConfigIndicators({ item, maxIcons = 2, onClick }) {
  const activeIndicators = CONFIG_INDICATORS.filter(ind => {
    const value = item[ind.key];
    if (value == null) return false;
    if (ind.showWhen) return ind.showWhen(value);
    return Boolean(value);
  });

  if (activeIndicators.length === 0) return null;

  const visible = activeIndicators.slice(0, maxIcons);
  const overflow = activeIndicators.length - maxIcons;

  const tooltipContent = activeIndicators.map(ind => {
    const value = item[ind.key];
    const displayValue = typeof value === 'boolean' ? '' : `: ${value}`;
    return `${ind.label}${displayValue}`;
  }).join('\n');

  return (
    <Tooltip label={tooltipContent} multiline withArrow>
      <Group
        gap={2}
        wrap="nowrap"
        style={{ cursor: onClick ? 'pointer' : 'default' }}
        onClick={onClick}
      >
        {visible.map(ind => {
          const Icon = ICON_MAP[ind.icon];
          return Icon ? <Icon key={ind.key} size={14} color="gray" /> : null;
        })}
        {overflow > 0 && (
          <Text size="xs" c="dimmed">+{overflow}</Text>
        )}
      </Group>
    </Tooltip>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ConfigIndicators.jsx
git commit -m "feat(admin): add config indicators component"
```

---

### Task 12: Add Progress Display Component

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/ProgressDisplay.jsx`

**Step 1: Create component**

```jsx
import React from 'react';
import { Group, Progress, Text, Tooltip } from '@mantine/core';
import { IconCheck } from '@tabler/icons-react';

export function ProgressDisplay({ item }) {
  const progress = item.progress;
  const watched = item.watched;

  if (progress == null && !watched) return null;

  if (watched || progress === 100) {
    return (
      <Tooltip label="Watched">
        <Group gap={4}>
          <IconCheck size={14} color="var(--mantine-color-green-6)" />
          <Text size="xs" c="green">100</Text>
        </Group>
      </Tooltip>
    );
  }

  return (
    <Tooltip label="Progress tracked via media_memory">
      <Group gap={4} wrap="nowrap">
        <Progress
          value={progress || 0}
          size="xs"
          style={{ width: 40 }}
          color={progress > 75 ? 'green' : progress > 25 ? 'blue' : 'gray'}
        />
        <Text size="xs" c="dimmed" style={{ width: 24 }}>
          {progress || 0}
        </Text>
      </Group>
    </Tooltip>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ProgressDisplay.jsx
git commit -m "feat(admin): add progress display component"
```

---

### Task 13: Update ListsItemRow with New Columns

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`

**Step 1: Import new components**

Add imports at top:

```jsx
import { ConfigIndicators } from './ConfigIndicators.jsx';
import { ProgressDisplay } from './ProgressDisplay.jsx';
```

**Step 2: Add new columns to ListsItemRow**

After `col-input` div, add:

```jsx
<div className="col-progress">
  <ProgressDisplay item={item} />
</div>

<div className="col-config">
  <ConfigIndicators item={item} onClick={() => onOpenFullMode?.()} />
</div>
```

**Step 3: Update props to include onOpenFullMode**

**Step 4: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx
git commit -m "feat(admin): add progress and config columns to item row"
```

---

### Task 14: Update SCSS for New Columns

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ContentLists.scss`

**Step 1: Add new column styles**

In `.table-header`:

```scss
.col-progress { width: 60px; flex-shrink: 0; flex-grow: 0; text-align: center; }
.col-config { width: 50px; flex-shrink: 0; flex-grow: 0; text-align: center; }
```

In `.item-row`:

```scss
.col-progress {
  width: 60px;
  flex-shrink: 0;
  flex-grow: 0;
  display: flex;
  justify-content: center;
  align-items: center;
}

.col-config {
  width: 50px;
  flex-shrink: 0;
  flex-grow: 0;
  display: flex;
  justify-content: center;
  align-items: center;

  &:hover {
    background: var(--mantine-color-dark-5);
    border-radius: 4px;
    cursor: pointer;
  }
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ContentLists.scss
git commit -m "style(admin): add styles for progress and config columns"
```

---

### Task 15: Update ListsFolder with New Table Header

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`

**Step 1: Update table header**

Add progress and config column headers:

```jsx
<div className="col-progress"><Text size="xs" fw={600} c="dimmed">📊</Text></div>
<div className="col-config"><Text size="xs" fw={600} c="dimmed">⚙️</Text></div>
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "feat(admin): add progress and config headers to table"
```

---

## Phase 5: List Settings Modal

### Task 16: Create ListSettingsModal Component

**Files:**
- Create: `frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx`

[Full implementation during execution]

**Step 1: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx
git commit -m "feat(admin): create list settings modal"
```

---

### Task 17: Integrate List Settings into ListsFolder

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`

**Step 1: Add settings modal state and menu item**

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsFolder.jsx
git commit -m "feat(admin): integrate list settings modal"
```

---

## Phase 6: Enhanced List Index

### Task 18: Update ListsIndex with Grouping and Enhanced Cards

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/ListsIndex.jsx`

[Full implementation during execution]

**Step 1: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/ListsIndex.jsx
git commit -m "feat(admin): enhance list index with grouping and metadata"
```

---

## Phase 7: Final Integration

### Task 19: Update Index Exports

**Files:**
- Modify: `frontend/src/modules/Admin/ContentLists/index.js`

**Step 1: Export new components**

```js
export { default as ListsItemEditor } from './ListsItemEditor.jsx';
export { default as ListsIndex } from './ListsIndex.jsx';
export { default as ListsFolder } from './ListsFolder.jsx';
export { default as ListCreate } from './ListCreate.jsx';
export { ListSettingsModal } from './ListSettingsModal.jsx';
export { ConfigIndicators } from './ConfigIndicators.jsx';
export { ProgressDisplay } from './ProgressDisplay.jsx';
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/ContentLists/index.js
git commit -m "feat(admin): update exports"
```

---

### Task 20: Manual Testing Checklist

**Test in browser:**

1. Navigate to Admin → Content → Menus
2. Verify list cards show title, description, group
3. Click a list to open it
4. Verify table shows progress and config columns
5. Click config icon to open Full mode editor
6. Toggle between Simple and Full mode
7. Edit playback settings (shuffle, volume)
8. Edit scheduling settings (days)
9. Save and verify YAML updated
10. Open list settings from menu
11. Update list title and sorting
12. Save and verify changes persist
13. Create new item with extra params
14. Verify config indicators show correctly

---

### Task 21: Final Commit and Branch Merge

```bash
git status
git log --oneline -10

# If all good, merge to main (after user approval)
```

---

## Summary

**Total Tasks:** 21

**Files Created:**
- `frontend/src/modules/Admin/ContentLists/listConstants.js`
- `frontend/src/modules/Admin/ContentLists/EditorCategories.jsx`
- `frontend/src/modules/Admin/ContentLists/ConfigIndicators.jsx`
- `frontend/src/modules/Admin/ContentLists/ProgressDisplay.jsx`
- `frontend/src/modules/Admin/ContentLists/ListSettingsModal.jsx`

**Files Modified:**
- `backend/src/4_api/v1/routers/admin/content.mjs`
- `frontend/src/hooks/admin/useAdminLists.js`
- `frontend/src/modules/Admin/ContentLists/ListsItemEditor.jsx`
- `frontend/src/modules/Admin/ContentLists/ListsItemRow.jsx`
- `frontend/src/modules/Admin/ContentLists/ListsFolder.jsx`
- `frontend/src/modules/Admin/ContentLists/ListsIndex.jsx`
- `frontend/src/modules/Admin/ContentLists/ContentLists.scss`
- `frontend/src/modules/Admin/ContentLists/index.js`
