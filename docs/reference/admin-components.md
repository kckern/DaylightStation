# Admin Components Reference

> Shared component library and patterns for building admin panel sections.

---

## Overview

The admin panel is built from a small set of reusable primitives that handle config loading, editing, saving, and reverting. Most admin sections follow the same pattern: `ConfigFormWrapper` manages the lifecycle (load/save/dirty tracking) while the section's form body uses `CrudTable`, `TagInput`, `YamlEditor`, and `ConfirmModal` as needed.

### File Locations

| Component | Path |
|-----------|------|
| `ConfigFormWrapper` | `frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx` |
| `CrudTable` | `frontend/src/modules/Admin/shared/CrudTable.jsx` |
| `YamlEditor` | `frontend/src/modules/Admin/shared/YamlEditor.jsx` |
| `TagInput` | `frontend/src/modules/Admin/shared/TagInput.jsx` |
| `ConfirmModal` | `frontend/src/modules/Admin/shared/ConfirmModal.jsx` |
| `useAdminConfig` | `frontend/src/hooks/admin/useAdminConfig.js` |
| Config API router | `backend/src/4_api/v1/routers/admin/config.mjs` |

---

## Shared Components

### ConfigFormWrapper

Wraps a config form with standard load/save/revert chrome. Internally uses `useAdminConfig` to manage the full lifecycle.

**Props:**

| Prop | Type | Required | Description |
|------|------|----------|-------------|
| `filePath` | `string` | Yes | YAML file path relative to data root (e.g. `household/config/fitness.yml`) |
| `title` | `string` | Yes | Page title displayed in the header |
| `children` | `function` | Yes | Render function: `({ data, setData }) => JSX` |
| `validate` | `function` | No | `(data) => string|null` -- return error message or null |

**Behavior:**
- Shows a loading spinner until config is fetched
- Displays "Unsaved changes" badge when dirty
- Save button disabled until changes are made
- Revert restores to the last-loaded state
- Error alert with close button on API failures

**Usage:**

```jsx
<ConfigFormWrapper filePath="household/config/fitness.yml" title="Fitness Config">
  {({ data, setData }) => (
    <TextInput
      value={data.sessionDuration}
      onChange={(e) => setData(prev => ({ ...prev, sessionDuration: e.target.value }))}
    />
  )}
</ConfigFormWrapper>
```

The `setData` function accepts either a new object or an updater function (`prev => next`).

---

### CrudTable

Editable table for arrays of objects. Used for equipment lists, device mappings, member lists, playlist entries, and similar collections.

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `items` | `Array` | `[]` | Array of objects to display/edit |
| `onChange` | `function` | -- | `(newItems) => void` -- fires on every cell edit |
| `columns` | `Array` | `[]` | Column definitions (see below) |
| `createDefaults` | `object` | `{}` | Default values for new rows |
| `addLabel` | `string` | `"Add Item"` | Label for the add button |
| `confirmDelete` | `boolean` | `false` | Require two clicks to delete a row |
| `emptyMessage` | `string` | `"No items."` | Message when items array is empty |

**Column definition:**

```javascript
{ key: 'name', label: 'Name', type: 'text', placeholder: 'Enter name', width: 200 }
```

| Column Property | Values |
|-----------------|--------|
| `type` | `'text'`, `'number'`, `'select'`, `'switch'`, `'readonly'` |
| `options` | For `select` type: `[{ value, label }]` |
| `width` | Optional CSS width for the column |
| `placeholder` | Optional placeholder text |

**Usage:**

```jsx
<CrudTable
  items={data.equipment}
  onChange={(equipment) => setData(prev => ({ ...prev, equipment }))}
  columns={[
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'type', label: 'Type', type: 'select', options: [{ value: 'cardio', label: 'Cardio' }] },
    { key: 'enabled', label: 'Active', type: 'switch' }
  ]}
  createDefaults={{ name: '', type: 'cardio', enabled: true }}
  confirmDelete
/>
```

---

### YamlEditor

Syntax-highlighted YAML editor built on CodeMirror 6 with the One Dark theme.

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `value` | `string` | `''` | YAML string to display |
| `onChange` | `function` | -- | `(newValue: string) => void` |
| `readOnly` | `boolean` | `false` | Disable editing |
| `error` | `object` | `null` | `{ message, mark?: { line, column } }` -- parse error to display |
| `height` | `string` | `'500px'` | CSS height |

**Behavior:**
- Displays a red alert above the editor when `error` is set
- Syncs external value changes (e.g. revert) into the editor
- Only recreates the editor instance when `readOnly` or `height` changes

---

### TagInput

Multi-value tag input for email lists, keywords, labels, and similar collections.

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `values` | `string[]` | `[]` | Current tag values |
| `onChange` | `function` | -- | `(string[]) => void` |
| `placeholder` | `string` | `"Type and press Enter"` | Input placeholder |
| `label` | `string` | -- | Optional label above the input |

**Behavior:**
- Enter key or blur adds a tag
- Backspace on empty input removes the last tag
- Duplicate values are silently ignored

---

### ConfirmModal

Confirmation dialog for destructive actions.

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| `opened` | `boolean` | -- | Whether the modal is visible |
| `onClose` | `function` | -- | Called when modal is dismissed |
| `onConfirm` | `function` | -- | Called when confirm button is clicked |
| `title` | `string` | `"Confirm"` | Modal title |
| `message` | `string` | -- | Body text explaining the action |
| `impact` | `string` | -- | Optional yellow warning text (e.g. "2 screens reference this device.") |
| `confirmLabel` | `string` | `"Delete"` | Confirm button text |
| `loading` | `boolean` | `false` | Show loading state on confirm button |

---

## useAdminConfig Hook

Manages loading, saving, dirty tracking, and revert for a single YAML config file.

**Import:**

```javascript
import { useAdminConfig } from '../../hooks/admin/useAdminConfig.js';
```

**Parameter:**

| Param | Type | Description |
|-------|------|-------------|
| `filePath` | `string` | Config file path relative to data root |

**Return value:**

| Property | Type | Description |
|----------|------|-------------|
| `data` | `object|null` | Parsed config object |
| `raw` | `string` | Raw YAML string |
| `loading` | `boolean` | True during fetch |
| `saving` | `boolean` | True during save |
| `error` | `Error|null` | Last error |
| `dirty` | `boolean` | True when data differs from last load |
| `load()` | `function` | Fetch config from API |
| `save({ useRaw })` | `function` | Save config. Pass `{ useRaw: true }` to save the raw YAML string instead of the parsed object |
| `revert()` | `function` | Reset to last-loaded values |
| `setData(newData)` | `function` | Stage a parsed data update. Accepts object or updater function |
| `setRaw(newStr)` | `function` | Stage a raw YAML update |
| `clearError()` | `function` | Clear error state |

**Two editing modes:**
- **Structured mode:** Use `setData()` to modify the parsed object, then `save()` to serialize and write.
- **Raw mode:** Use `setRaw()` to edit the YAML string directly, then `save({ useRaw: true })` to write.

---

## Backend Config API

Base path: `/api/v1/admin/config`

Router factory: `createAdminConfigRouter({ configService, logger })`

### Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/files` | List all editable config files with metadata |
| `GET` | `/files/{path}` | Read file contents (raw YAML + parsed object) |
| `PUT` | `/files/{path}` | Write file (accepts raw YAML or parsed object) |

### GET /files

Returns all YAML files in allowed directories.

```json
{
  "files": [
    {
      "path": "household/config/fitness.yml",
      "name": "fitness.yml",
      "directory": "household/config",
      "size": 1234,
      "modified": "2026-02-10T12:00:00.000Z",
      "masked": false
    }
  ],
  "count": 12
}
```

Files in masked directories (`system/auth`, `household/auth`) appear in listings with `"masked": true` but cannot be read or written.

### GET /files/{path}

```json
{
  "path": "household/config/fitness.yml",
  "name": "fitness.yml",
  "raw": "sessionDuration: 30\nequipment:\n  - name: Treadmill\n",
  "parsed": { "sessionDuration": 30, "equipment": [{ "name": "Treadmill" }] },
  "size": 1234,
  "modified": "2026-02-10T12:00:00.000Z"
}
```

If the file contains invalid YAML, `parsed` is `null` and the raw string is still returned.

### PUT /files/{path}

Request body accepts either format:

```json
{ "parsed": { "sessionDuration": 30 } }
```

```json
{ "raw": "sessionDuration: 30\n" }
```

Raw YAML is validated before writing. Returns `400` with parse error details on invalid YAML.

### Security

- Only YAML files are allowed
- Path traversal protection (resolved paths must stay within data root)
- Allowed directories: `system/config`, `household/config`
- Masked directories: `system/auth`, `household/auth` (listed but not readable/writable)

---

## Patterns: Building a New Admin Section

### Standard approach: ConfigFormWrapper + structured editing

1. Create a section component in `frontend/src/modules/Admin/sections/`.
2. Use `ConfigFormWrapper` with the YAML file path.
3. Build the form body using `CrudTable`, `TagInput`, etc.

```jsx
import ConfigFormWrapper from '../shared/ConfigFormWrapper';
import CrudTable from '../shared/CrudTable';

const COLUMNS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'calories', label: 'Calories', type: 'number' },
];

function MySection() {
  return (
    <ConfigFormWrapper filePath="household/config/my-feature.yml" title="My Feature">
      {({ data, setData }) => (
        <CrudTable
          items={data.items || []}
          onChange={(items) => setData(prev => ({ ...prev, items }))}
          columns={COLUMNS}
          createDefaults={{ name: '', calories: 0 }}
        />
      )}
    </ConfigFormWrapper>
  );
}
```

### Raw YAML editing approach

For advanced users or files without a purpose-built form, use `useAdminConfig` directly with `YamlEditor`:

```jsx
import { useAdminConfig } from '../../hooks/admin/useAdminConfig';
import YamlEditor from '../shared/YamlEditor';

function RawEditor({ filePath }) {
  const { raw, setRaw, save, dirty, loading } = useAdminConfig(filePath);
  // ... render YamlEditor with raw/setRaw, save button with save({ useRaw: true })
}
```

### Destructive actions

Use `ConfirmModal` before any delete or irreversible operation. Pair it with `CrudTable`'s `confirmDelete` prop for row-level deletes.
