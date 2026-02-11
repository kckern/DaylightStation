# Admin Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build out the full DaylightStation admin panel per the PRD at `docs/_wip/plans/2026-02-11-admin-prd.md`, starting with reusable primitives that all sections compose from.

**Architecture:** Phase 1 builds a shared component library (YAML editor, CRUD table, config form wrapper, tag input) and a generic backend config API. Phases 2-6 build each admin section by composing these primitives with section-specific logic. Every new section is mostly wiring — not new component work.

**Tech Stack:** React 18, Mantine 7, @tabler/icons-react, react-router-dom 6, CodeMirror 6 (YAML editor), Express 4, js-yaml, existing DaylightStation DI/bootstrap patterns.

**PRD Reference:** `docs/_wip/plans/2026-02-11-admin-prd.md`

---

## Phase 1: Shared Foundation (Reusable Components + Generic API)

The primitives built here are used by every subsequent phase. Get these right and the rest is assembly.

---

### Task 1: Generic Config File API

Backend API that reads/writes any YAML config file within allowed directories. This is the backbone for both the YAML editor fallback and all purpose-built config forms.

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/config.mjs`
- Modify: `backend/src/4_api/v1/routers/admin/index.mjs` — mount config sub-router
- Modify: `backend/src/app.mjs` — pass `configService` to admin router if not already

**Step 1: Create the config file router**

```javascript
// backend/src/4_api/v1/routers/admin/config.mjs
import express from 'express';
import path from 'path';
import yaml from 'js-yaml';
import fs from 'fs';
import { loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

// Allowed directory prefixes (relative to data root)
const ALLOWED_PREFIXES = [
  'system/config',
  'household/config',
];

// Directories where contents are masked (file list only, no read/write)
const MASKED_PREFIXES = [
  'system/auth',
  'household/auth',
];

export function createAdminConfigRouter(config) {
  const { configService, logger = console } = config;
  const router = express.Router();

  function getDataRoot() {
    return configService.getDataDir();
  }

  function isAllowed(relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    return ALLOWED_PREFIXES.some(p => normalized.startsWith(p));
  }

  function isMasked(relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    return MASKED_PREFIXES.some(p => normalized.startsWith(p));
  }

  // GET /files — list all editable config files
  router.get('/files', (req, res) => {
    try {
      const dataRoot = getDataRoot();
      const files = [];

      for (const prefix of [...ALLOWED_PREFIXES, ...MASKED_PREFIXES]) {
        const dir = path.join(dataRoot, prefix);
        if (!fs.existsSync(dir)) continue;

        const entries = fs.readdirSync(dir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'));
        for (const entry of entries) {
          const relativePath = `${prefix}/${entry}`;
          const stat = fs.statSync(path.join(dir, entry));
          files.push({
            path: relativePath,
            name: entry,
            directory: prefix,
            size: stat.size,
            modified: stat.mtime.toISOString(),
            masked: isMasked(relativePath),
          });
        }
      }

      logger.info?.('admin.config.files.listed', { count: files.length });
      res.json({ files });
    } catch (error) {
      logger.error?.('admin.config.files.list.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to list config files' });
    }
  });

  // GET /files/:path — read file contents
  router.get('/files/*', (req, res) => {
    try {
      const relativePath = req.params[0];
      if (isMasked(relativePath)) {
        return res.status(403).json({ error: 'This file is masked and cannot be read directly' });
      }
      if (!isAllowed(relativePath)) {
        return res.status(403).json({ error: 'Path not in allowed directories' });
      }

      const fullPath = path.join(getDataRoot(), relativePath);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const raw = fs.readFileSync(fullPath, 'utf8');
      const parsed = yaml.load(raw);

      logger.info?.('admin.config.file.read', { path: relativePath });
      res.json({ path: relativePath, raw, parsed });
    } catch (error) {
      logger.error?.('admin.config.file.read.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to read config file' });
    }
  });

  // PUT /files/:path — write file contents
  router.put('/files/*', (req, res) => {
    try {
      const relativePath = req.params[0];
      if (isMasked(relativePath)) {
        return res.status(403).json({ error: 'This file is masked and cannot be written directly' });
      }
      if (!isAllowed(relativePath)) {
        return res.status(403).json({ error: 'Path not in allowed directories' });
      }

      const { raw, parsed } = req.body;

      // Accept either raw YAML string or parsed object
      let content;
      if (raw && typeof raw === 'string') {
        // Validate YAML syntax
        yaml.load(raw); // throws on invalid YAML
        content = raw;
      } else if (parsed !== undefined) {
        content = yaml.dump(parsed, { lineWidth: -1, noRefs: true });
      } else {
        return res.status(400).json({ error: 'Must provide either raw (string) or parsed (object) body' });
      }

      const fullPath = path.join(getDataRoot(), relativePath);
      fs.writeFileSync(fullPath, content, 'utf8');

      logger.info?.('admin.config.file.written', { path: relativePath });
      res.json({ ok: true, path: relativePath });
    } catch (error) {
      if (error instanceof yaml.YAMLException) {
        return res.status(400).json({
          error: 'Invalid YAML syntax',
          details: { message: error.message, mark: error.mark }
        });
      }
      logger.error?.('admin.config.file.write.failed', { error: error.message });
      res.status(500).json({ error: 'Failed to write config file' });
    }
  });

  logger.info?.('admin.config.router.mounted');
  return router;
}
```

**Step 2: Mount in admin router index**

In `backend/src/4_api/v1/routers/admin/index.mjs`, add:

```javascript
import { createAdminConfigRouter } from './config.mjs';

// Inside createAdminRouter():
const configRouter = createAdminConfigRouter({
  configService,
  logger: logger.child?.({ submodule: 'config' }) || logger
});
router.use('/config', configRouter);
```

**Step 3: Verify `configService` is available in admin router**

Check `backend/src/app.mjs` where `createAdminRouter` is called. If `configService` isn't already passed, add it to the config object.

**Step 4: Test manually**

```bash
curl http://localhost:3112/api/v1/admin/config/files | jq .
curl http://localhost:3112/api/v1/admin/config/files/household/config/household.yml | jq .
```

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/config.mjs backend/src/4_api/v1/routers/admin/index.mjs
git commit -m "feat(admin): add generic config file read/write API"
```

---

### Task 2: `useAdminConfig` Hook

Frontend hook wrapping the generic config API. Every config page (purpose-built or YAML editor) uses this to load/save.

**Files:**
- Create: `frontend/src/hooks/admin/useAdminConfig.js`

**Step 1: Write the hook**

```javascript
// frontend/src/hooks/admin/useAdminConfig.js
import { useState, useCallback, useMemo, useRef } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/admin/config';

/**
 * Hook for reading/writing any YAML config file.
 *
 * Usage:
 *   const { data, raw, loading, error, dirty, save, revert, setData } = useAdminConfig('household/config/fitness.yml');
 *
 * - `data` is the parsed JS object (edit this for purpose-built forms)
 * - `raw` is the raw YAML string (edit this for the YAML editor)
 * - `setData(newObj)` marks dirty and stages a parsed update
 * - `setRaw(newStr)` marks dirty and stages a raw YAML update
 * - `save()` writes to backend
 * - `revert()` discards unsaved changes
 */
export function useAdminConfig(filePath) {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminConfig', file: filePath }), [filePath]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [data, setDataState] = useState(null);       // parsed object
  const [raw, setRawState] = useState('');             // raw YAML string
  const [dirty, setDirty] = useState(false);
  const originalRef = useRef({ data: null, raw: '' });

  const load = useCallback(async () => {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/files/${filePath}`);
      setDataState(result.parsed);
      setRawState(result.raw);
      originalRef.current = { data: result.parsed, raw: result.raw };
      setDirty(false);
      logger.info('admin.config.loaded', { path: filePath });
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.config.load.failed', { path: filePath, message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [filePath, logger]);

  const setData = useCallback((newData) => {
    setDataState(newData);
    setDirty(true);
  }, []);

  const setRaw = useCallback((newRaw) => {
    setRawState(newRaw);
    setDirty(true);
  }, []);

  const save = useCallback(async ({ useRaw = false } = {}) => {
    setSaving(true);
    setError(null);
    try {
      const body = useRaw ? { raw } : { parsed: data };
      const result = await DaylightAPI(`${API_BASE}/files/${filePath}`, body, 'PUT');
      originalRef.current = { data, raw };
      setDirty(false);
      logger.info('admin.config.saved', { path: filePath });
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.config.save.failed', { path: filePath, message: err.message });
      throw err;
    } finally {
      setSaving(false);
    }
  }, [filePath, data, raw, logger]);

  const revert = useCallback(() => {
    setDataState(originalRef.current.data);
    setRawState(originalRef.current.raw);
    setDirty(false);
    setError(null);
  }, []);

  return {
    data, raw, loading, saving, error, dirty,
    load, save, revert, setData, setRaw,
    clearError: () => setError(null),
  };
}
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/admin/useAdminConfig.js
git commit -m "feat(admin): add useAdminConfig hook for generic config read/write"
```

---

### Task 3: `YamlEditor` Component

Reusable syntax-highlighted YAML editor using CodeMirror 6. Used by the Config fallback page and the YAML editor mode in any purpose-built form.

**Files:**
- Create: `frontend/src/modules/Admin/shared/YamlEditor.jsx`
- Create: `frontend/src/modules/Admin/shared/YamlEditor.scss`

**Step 1: Install CodeMirror dependencies**

```bash
cd /Users/kckern/Documents/GitHub/DaylightStation
npm install @codemirror/lang-yaml @codemirror/theme-one-dark codemirror @codemirror/view @codemirror/state
```

**Step 2: Write the component**

```jsx
// frontend/src/modules/Admin/shared/YamlEditor.jsx
import React, { useRef, useEffect, useCallback } from 'react';
import { Box, Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import './YamlEditor.scss';

/**
 * Reusable YAML editor with syntax highlighting.
 *
 * Props:
 *   value       - YAML string
 *   onChange    - (newValue: string) => void
 *   readOnly   - boolean (default false)
 *   error      - { message, mark? } parse error to display
 *   height     - CSS height (default '500px')
 */
export default function YamlEditor({ value, onChange, readOnly = false, error = null, height = '500px' }) {
  const containerRef = useRef(null);
  const viewRef = useRef(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!containerRef.current) return;

    const state = EditorState.create({
      doc: value || '',
      extensions: [
        basicSetup,
        yaml(),
        oneDark,
        EditorView.editable.of(!readOnly),
        EditorState.readOnly.of(readOnly),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && onChangeRef.current) {
            onChangeRef.current(update.state.doc.toString());
          }
        }),
        EditorView.theme({
          '&': { height, fontSize: '13px' },
          '.cm-scroller': { overflow: 'auto' },
        }),
      ],
    });

    const view = new EditorView({ state, parent: containerRef.current });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
  // Only recreate editor on mount or readOnly change
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [readOnly, height]);

  // Sync external value changes (e.g. revert) without recreating editor
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc) {
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value || '' },
      });
    }
  }, [value]);

  return (
    <Box className="yaml-editor-wrapper">
      {error && (
        <Alert icon={<IconAlertCircle size={16} />} color="red" mb="xs" title="YAML Error">
          {error.message}
          {error.mark && ` (line ${error.mark.line + 1}, column ${error.mark.column + 1})`}
        </Alert>
      )}
      <div ref={containerRef} className="yaml-editor-container" />
    </Box>
  );
}
```

```scss
// frontend/src/modules/Admin/shared/YamlEditor.scss
.yaml-editor-wrapper {
  .yaml-editor-container {
    border: 1px solid var(--mantine-color-dark-4);
    border-radius: var(--mantine-radius-sm);
    overflow: hidden;

    .cm-editor {
      border-radius: var(--mantine-radius-sm);
    }
  }
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/shared/YamlEditor.jsx frontend/src/modules/Admin/shared/YamlEditor.scss
git commit -m "feat(admin): add reusable YamlEditor component with CodeMirror 6"
```

---

### Task 4: `ConfigFormWrapper` Component

Wraps any config form with load/save/revert/dirty-state chrome. Handles the "shell" so individual forms only implement their fields.

**Files:**
- Create: `frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx
import React, { useEffect } from 'react';
import {
  Stack, Group, Button, Alert, Center, Loader, Badge, Text, Divider
} from '@mantine/core';
import { IconAlertCircle, IconDeviceFloppy, IconArrowBack } from '@tabler/icons-react';
import { useAdminConfig } from '../../../hooks/admin/useAdminConfig.js';

/**
 * Wraps a config form with standard load/save/revert/dirty-state chrome.
 *
 * Props:
 *   filePath    - YAML file path relative to data root (e.g. 'household/config/fitness.yml')
 *   title       - Page title
 *   children    - Render function: ({ data, setData }) => JSX
 *                 Receives the parsed config object and a setter.
 *                 The setter accepts a new object or an updater function: setData(prev => ({...prev, ...}))
 *   validate    - Optional (data) => string|null — return error message or null
 */
export default function ConfigFormWrapper({ filePath, title, children, validate }) {
  const {
    data, loading, saving, error, dirty,
    load, save, revert, setData, clearError
  } = useAdminConfig(filePath);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (validate) {
      const validationError = validate(data);
      if (validationError) return; // validate should set its own UI state
    }
    await save();
  };

  if (loading && !data) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Group justify="space-between">
        <Group gap="xs">
          <Text fw={600} size="lg">{title}</Text>
          {dirty && <Badge color="yellow" variant="light">Unsaved changes</Badge>}
        </Group>
        <Group gap="xs">
          <Button
            variant="subtle"
            leftSection={<IconArrowBack size={16} />}
            onClick={revert}
            disabled={!dirty || saving}
          >
            Revert
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={handleSave}
            loading={saving}
            disabled={!dirty}
            data-testid="config-save-button"
          >
            Save
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          withCloseButton
          onClose={clearError}
        >
          {error.message || 'An error occurred'}
        </Alert>
      )}

      <Divider />

      {data !== null && children({ data, setData })}
    </Stack>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/shared/ConfigFormWrapper.jsx
git commit -m "feat(admin): add ConfigFormWrapper with load/save/revert/dirty state"
```

---

### Task 5: `CrudTable` Component

Reusable editable table for arrays of objects. Used by equipment, devices, members, retailers, device mappings, music playlists, etc.

**Files:**
- Create: `frontend/src/modules/Admin/shared/CrudTable.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Admin/shared/CrudTable.jsx
import React, { useState } from 'react';
import {
  Table, Button, ActionIcon, Group, TextInput, Select, NumberInput,
  Switch, Text, Stack, Menu, Tooltip
} from '@mantine/core';
import { IconPlus, IconTrash, IconDots, IconGripVertical } from '@tabler/icons-react';

/**
 * Reusable CRUD table for arrays of objects.
 *
 * Props:
 *   items         - Array of objects
 *   onChange      - (newItems: Array) => void
 *   columns       - Array of column definitions:
 *     { key: string, label: string, type: 'text'|'number'|'select'|'switch'|'readonly',
 *       options?: [{value, label}], placeholder?: string, width?: string }
 *   createDefaults - Object with default values for new rows
 *   addLabel       - Button label (default "Add")
 *   confirmDelete  - boolean — require delete confirmation (default false)
 *   emptyMessage   - Message when no items
 */
export default function CrudTable({
  items = [],
  onChange,
  columns,
  createDefaults = {},
  addLabel = 'Add',
  confirmDelete = false,
  emptyMessage = 'No items yet.',
}) {
  const [pendingDelete, setPendingDelete] = useState(null);

  const updateItem = (index, key, value) => {
    const next = items.map((item, i) => i === index ? { ...item, [key]: value } : item);
    onChange(next);
  };

  const addItem = () => {
    onChange([...items, { ...createDefaults }]);
  };

  const removeItem = (index) => {
    if (confirmDelete && pendingDelete !== index) {
      setPendingDelete(index);
      return;
    }
    onChange(items.filter((_, i) => i !== index));
    setPendingDelete(null);
  };

  const renderCell = (item, col, index) => {
    const value = item[col.key];
    switch (col.type) {
      case 'readonly':
        return <Text size="sm">{value ?? ''}</Text>;
      case 'switch':
        return (
          <Switch
            checked={!!value}
            onChange={(e) => updateItem(index, col.key, e.currentTarget.checked)}
            size="sm"
          />
        );
      case 'number':
        return (
          <NumberInput
            value={value ?? ''}
            onChange={(val) => updateItem(index, col.key, val)}
            size="xs"
            placeholder={col.placeholder}
            hideControls
            style={{ width: col.width || '80px' }}
          />
        );
      case 'select':
        return (
          <Select
            value={value ?? ''}
            onChange={(val) => updateItem(index, col.key, val)}
            data={col.options || []}
            size="xs"
            placeholder={col.placeholder}
            style={{ width: col.width || '140px' }}
          />
        );
      case 'text':
      default:
        return (
          <TextInput
            value={value ?? ''}
            onChange={(e) => updateItem(index, col.key, e.target.value)}
            size="xs"
            placeholder={col.placeholder}
            style={{ width: col.width || '140px' }}
          />
        );
    }
  };

  return (
    <Stack gap="xs">
      {items.length === 0 ? (
        <Text c="dimmed" size="sm" ta="center" py="md">{emptyMessage}</Text>
      ) : (
        <Table striped highlightOnHover withTableBorder>
          <Table.Thead>
            <Table.Tr>
              {columns.map(col => (
                <Table.Th key={col.key} style={col.width ? { width: col.width } : undefined}>
                  {col.label}
                </Table.Th>
              ))}
              <Table.Th style={{ width: '50px' }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item, i) => (
              <Table.Tr key={i}>
                {columns.map(col => (
                  <Table.Td key={col.key}>{renderCell(item, col, i)}</Table.Td>
                ))}
                <Table.Td>
                  <ActionIcon
                    color={pendingDelete === i ? 'red' : 'gray'}
                    variant={pendingDelete === i ? 'filled' : 'subtle'}
                    size="sm"
                    onClick={() => removeItem(i)}
                    title={pendingDelete === i ? 'Click again to confirm' : 'Delete'}
                  >
                    <IconTrash size={14} />
                  </ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
      <Group>
        <Button
          variant="light"
          size="xs"
          leftSection={<IconPlus size={14} />}
          onClick={addItem}
        >
          {addLabel}
        </Button>
      </Group>
    </Stack>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/shared/CrudTable.jsx
git commit -m "feat(admin): add reusable CrudTable component for editable arrays"
```

---

### Task 6: `TagInput` Component

Reusable multi-value tag input for email lists, keywords, labels, Plex labels, etc.

**Files:**
- Create: `frontend/src/modules/Admin/shared/TagInput.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Admin/shared/TagInput.jsx
import React, { useState } from 'react';
import { TextInput, Group, Badge, ActionIcon } from '@mantine/core';
import { IconX } from '@tabler/icons-react';

/**
 * Multi-value tag input.
 *
 * Props:
 *   values      - string[]
 *   onChange    - (newValues: string[]) => void
 *   placeholder - input placeholder
 *   label       - input label
 */
export default function TagInput({ values = [], onChange, placeholder = 'Type and press Enter', label }) {
  const [input, setInput] = useState('');

  const addTag = () => {
    const tag = input.trim();
    if (tag && !values.includes(tag)) {
      onChange([...values, tag]);
    }
    setInput('');
  };

  const removeTag = (tag) => {
    onChange(values.filter(v => v !== tag));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addTag();
    } else if (e.key === 'Backspace' && !input && values.length > 0) {
      onChange(values.slice(0, -1));
    }
  };

  return (
    <div>
      {label && <TextInput.Label>{label}</TextInput.Label>}
      <Group gap={4} mb={4} wrap="wrap">
        {values.map(tag => (
          <Badge
            key={tag}
            variant="light"
            rightSection={
              <ActionIcon size={14} variant="transparent" onClick={() => removeTag(tag)}>
                <IconX size={10} />
              </ActionIcon>
            }
          >
            {tag}
          </Badge>
        ))}
      </Group>
      <TextInput
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={addTag}
        placeholder={placeholder}
        size="xs"
      />
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/shared/TagInput.jsx
git commit -m "feat(admin): add reusable TagInput component for multi-value inputs"
```

---

### Task 7: `ConfirmModal` Component

Reusable confirmation dialog for destructive actions.

**Files:**
- Create: `frontend/src/modules/Admin/shared/ConfirmModal.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Admin/shared/ConfirmModal.jsx
import React from 'react';
import { Modal, Stack, Text, Group, Button } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';

/**
 * Reusable confirmation dialog.
 *
 * Props:
 *   opened       - boolean
 *   onClose      - () => void
 *   onConfirm    - () => void
 *   title        - modal title
 *   message      - body text
 *   impact       - optional impact statement (shown in yellow)
 *   confirmLabel - button text (default "Delete")
 *   loading      - boolean
 */
export default function ConfirmModal({
  opened, onClose, onConfirm, title = 'Confirm',
  message, impact, confirmLabel = 'Delete', loading = false,
}) {
  return (
    <Modal opened={opened} onClose={onClose} title={title} centered size="sm">
      <Stack>
        <Text size="sm">{message}</Text>
        {impact && (
          <Text size="sm" c="yellow" fw={500}>
            <IconAlertTriangle size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
            {impact}
          </Text>
        )}
        <Group justify="flex-end">
          <Button variant="subtle" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button color="red" onClick={onConfirm} loading={loading}>{confirmLabel}</Button>
        </Group>
      </Stack>
    </Modal>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/shared/ConfirmModal.jsx
git commit -m "feat(admin): add reusable ConfirmModal component"
```

---

### Task 8: Shared barrel export + update AdminNav

Create the barrel export for shared components and update AdminNav with the full navigation structure from the PRD.

**Files:**
- Create: `frontend/src/modules/Admin/shared/index.js`
- Modify: `frontend/src/modules/Admin/AdminNav.jsx` — add all nav sections

**Step 1: Barrel export**

```javascript
// frontend/src/modules/Admin/shared/index.js
export { default as YamlEditor } from './YamlEditor.jsx';
export { default as ConfigFormWrapper } from './ConfigFormWrapper.jsx';
export { default as CrudTable } from './CrudTable.jsx';
export { default as TagInput } from './TagInput.jsx';
export { default as ConfirmModal } from './ConfirmModal.jsx';
```

**Step 2: Update AdminNav**

Read the current `AdminNav.jsx` and update the `navSections` array to include all sections from the PRD:

```
CONTENT
  Menus        → /admin/content/lists/menus
  Watchlists   → /admin/content/lists/watchlists
  Programs     → /admin/content/lists/programs

APPS
  Fitness      → /admin/apps/fitness
  Finance      → /admin/apps/finance
  Gratitude    → /admin/apps/gratitude
  Shopping     → /admin/apps/shopping

HOUSEHOLD
  Members      → /admin/household/members
  Devices      → /admin/household/devices

SYSTEM
  Integrations → /admin/system/integrations
  Scheduler    → /admin/system/scheduler
  Config       → /admin/system/config
```

Use appropriate Tabler icons for each item. Keep the existing nav pattern of `navSections` data structure and `NavLink` rendering.

**Step 3: Update AdminApp.jsx routes**

Add route stubs for all new sections, initially pointing to `<ComingSoon>` components. These will be replaced one-by-one in subsequent phases.

```jsx
// New routes inside the AdminLayout Route element:
<Route path="apps/:appId" element={<ComingSoon title="App Config" />} />
<Route path="household/members" element={<ComingSoon title="Members" />} />
<Route path="household/members/:username" element={<ComingSoon title="Member Editor" />} />
<Route path="household/devices" element={<ComingSoon title="Devices" />} />
<Route path="household/devices/:deviceId" element={<ComingSoon title="Device Editor" />} />
<Route path="system/integrations" element={<ComingSoon title="Integrations" />} />
<Route path="system/integrations/:provider" element={<ComingSoon title="Integration Detail" />} />
<Route path="system/scheduler" element={<ComingSoon title="Scheduler" />} />
<Route path="system/scheduler/:jobId" element={<ComingSoon title="Job Detail" />} />
<Route path="system/config" element={<ComingSoon title="Config Editor" />} />
<Route path="system/config/*" element={<ComingSoon title="Config Editor" />} />
```

**Step 4: Test manually**

Start dev server, navigate to `/admin`. Verify all nav items render and link to their routes. Each route should show the ComingSoon placeholder.

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/shared/index.js frontend/src/modules/Admin/AdminNav.jsx frontend/src/Apps/AdminApp.jsx
git commit -m "feat(admin): add full nav structure and route stubs for all admin sections"
```

---

## Phase 2: System — Config Editor (YAML Fallback)

This is the fastest section to ship since it composes entirely from Phase 1 primitives.

---

### Task 9: Config Browser + YAML Editor Page

**Files:**
- Create: `frontend/src/modules/Admin/Config/ConfigIndex.jsx`
- Create: `frontend/src/modules/Admin/Config/ConfigFileEditor.jsx`
- Modify: `frontend/src/Apps/AdminApp.jsx` — wire routes

**Step 1: Write ConfigIndex**

A file browser listing all config files from the API, grouped by directory. Clicking a file navigates to the editor. Masked files show a lock icon.

Uses: `DaylightAPI('/api/v1/admin/config/files')` to fetch file list.

Renders: `<Stack>` with directory headers and file rows as `<NavLink>` to `/admin/system/config/{filePath}`.

Files that have purpose-built editors (household.yml, fitness.yml, devices.yml, jobs.yml, integrations.yml) show a "Open in editor" badge linking to the appropriate purpose-built route.

**Step 2: Write ConfigFileEditor**

Composes `useAdminConfig(filePath)` + `<YamlEditor>`.

Layout:
- File path breadcrumb at top
- Revert / Save buttons (from useAdminConfig's dirty/save/revert)
- `<YamlEditor value={raw} onChange={setRaw} error={parseError} />`
- On save, calls `save({ useRaw: true })`

**Step 3: Wire routes in AdminApp.jsx**

Replace the ComingSoon stubs:
```jsx
<Route path="system/config" element={<ConfigIndex />} />
<Route path="system/config/*" element={<ConfigFileEditor />} />
```

**Step 4: Test manually**

Navigate to `/admin/system/config`. Verify files list. Click a file. Verify YAML loads, edit, save, revert all work.

**Step 5: Commit**

```bash
git add frontend/src/modules/Admin/Config/
git commit -m "feat(admin): implement Config file browser and YAML editor page"
```

---

## Phase 3: System — Scheduler

---

### Task 10: Scheduler Backend API

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/scheduler.mjs`
- Modify: `backend/src/4_api/v1/routers/admin/index.mjs` — mount scheduler sub-router

Endpoints (all under `/api/v1/admin/scheduler`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/jobs` | GET | All jobs from jobs.yml merged with runtime state from cron-runtime.yml |
| `/jobs` | POST | Create job (append to jobs.yml) |
| `/jobs/:id` | GET | Single job detail + execution history |
| `/jobs/:id` | PUT | Update job fields |
| `/jobs/:id` | DELETE | Remove job from jobs.yml |
| `/jobs/:id/run` | POST | Trigger immediate job execution |

**Implementation notes:**
- Read jobs from `system/config/jobs.yml` (array of job objects)
- Read runtime state from `system/state/cron-runtime.yml` (map of jobId → last run info)
- Merge on GET: combine job definition with runtime state
- For run trigger: use the existing scheduler infrastructure (SchedulerService) if available, or emit an event

**Step 1: Write the router**

Follow the exact pattern from `content.mjs`: factory function, destructure config, express.Router(), try/catch with logging.

**Step 2: Mount and wire**

Add to `admin/index.mjs`, pass `configService` and `logger`.

**Step 3: Test with curl**

```bash
curl http://localhost:3112/api/v1/admin/scheduler/jobs | jq .
```

**Step 4: Commit**

```bash
git add backend/src/4_api/v1/routers/admin/scheduler.mjs backend/src/4_api/v1/routers/admin/index.mjs
git commit -m "feat(admin): add scheduler jobs CRUD API"
```

---

### Task 11: Scheduler Frontend — Jobs Index

**Files:**
- Create: `frontend/src/modules/Admin/Scheduler/SchedulerIndex.jsx`
- Create: `frontend/src/hooks/admin/useAdminScheduler.js`
- Modify: `frontend/src/Apps/AdminApp.jsx` — wire route

**useAdminScheduler hook:** Wraps the scheduler API. Methods: `fetchJobs`, `createJob`, `updateJob`, `deleteJob`, `triggerJob`. State: `jobs`, `loading`, `error`.

**SchedulerIndex:** Table of jobs with columns per PRD Section 8.1. Group by frequency band. Run Now button per row. Create job modal. Inline enable/disable toggle.

**Step 1: Write the hook**

**Step 2: Write the index component**

Use Mantine `<Table>`, `<Badge>` for status, `<Switch>` for enable/disable, `<Button>` for Run Now, `<Modal>` for create.

Cron expression → human-readable: write a small `cronToHuman(expr)` utility (handles common patterns: `*/10 * * * *` → "Every 10 min", `0 * * * *` → "Hourly", `0 3 * * *` → "Daily at 3:00 AM").

**Step 3: Wire route, test, commit**

```bash
git add frontend/src/modules/Admin/Scheduler/ frontend/src/hooks/admin/useAdminScheduler.js
git commit -m "feat(admin): implement scheduler jobs index with CRUD"
```

---

### Task 12: Scheduler Frontend — Job Detail

**Files:**
- Create: `frontend/src/modules/Admin/Scheduler/JobDetail.jsx`
- Modify: `frontend/src/Apps/AdminApp.jsx` — wire route

**JobDetail:** Shows job metadata (read-only), execution history table (timestamp, duration, result), manual trigger button, edit modal, delete with confirmation.

**Step 1: Write the component**

**Step 2: Wire route, test, commit**

```bash
git add frontend/src/modules/Admin/Scheduler/JobDetail.jsx
git commit -m "feat(admin): implement scheduler job detail with execution history"
```

---

## Phase 4: Household

---

### Task 13: Household Backend API

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/household.mjs`
- Modify: `backend/src/4_api/v1/routers/admin/index.mjs` — mount

Endpoints per PRD Section 10.1 + 10.2.

**Implementation notes:**
- `GET /household` reads `household/config/household.yml` and for each user, reads `users/{username}/profile.yml`
- `PUT /household` writes household.yml
- `POST /household/members` creates `users/{username}/profile.yml` + adds to household.yml
- `GET/PUT /household/members/:username` reads/writes `users/{username}/profile.yml`
- `DELETE /household/members/:username` removes from household.yml users list (does NOT delete profile)
- `GET/POST/PUT/DELETE /devices/*` reads/writes `household/config/devices.yml`
- `GET/PUT /screens/*` reads/writes `household/screens/{name}.yml`

**Step 1: Write the router**

**Step 2: Mount, test with curl, commit**

```bash
git add backend/src/4_api/v1/routers/admin/household.mjs backend/src/4_api/v1/routers/admin/index.mjs
git commit -m "feat(admin): add household members and devices CRUD API"
```

---

### Task 14: Members Index Page

**Files:**
- Create: `frontend/src/modules/Admin/Household/MembersIndex.jsx`
- Create: `frontend/src/hooks/admin/useAdminHousehold.js`
- Modify: `frontend/src/Apps/AdminApp.jsx` — wire route

**useAdminHousehold hook:** `fetchHousehold`, `createMember`, `removeMember`, `updateHousehold`. State: `household`, `members`, `loading`, `error`.

**MembersIndex:** Table per PRD Section 5.1. Household settings panel at top (name, head, per-app user lists). Create member modal. Click row to navigate to member editor.

**Step 1: Write hook and component**

**Step 2: Wire, test, commit**

```bash
git add frontend/src/modules/Admin/Household/ frontend/src/hooks/admin/useAdminHousehold.js
git commit -m "feat(admin): implement household members index"
```

---

### Task 15: Member Editor Page

**Files:**
- Create: `frontend/src/modules/Admin/Household/MemberEditor.jsx`
- Modify: `frontend/src/Apps/AdminApp.jsx` — wire route

**MemberEditor:** Tabbed layout per PRD Section 5.3. Uses `ConfigFormWrapper` pattern — loads profile.yml via the household API, saves with PUT.

Tabs:
1. **Identity** — TextInputs, Select, read-only username
2. **Preferences** — timezone select, units segmented control, language
3. **Identities** — Telegram user_id, default_bot dropdown
4. **Nutribot** — NumberInputs for goals
5. **Entropy Sources** — `<CrudTable>` with column definitions per PRD
6. **Fitness** — NumberInputs for zone overrides with "use defaults" checkbox
7. **Gratitude** — Multi-select for categories

Each tab only renders fields relevant to that user. Save button at bottom saves the full profile.

**Step 1: Write the component**

**Step 2: Wire, test, commit**

```bash
git add frontend/src/modules/Admin/Household/MemberEditor.jsx
git commit -m "feat(admin): implement member editor with tabbed profile editing"
```

---

### Task 16: Devices Index + Editor

**Files:**
- Create: `frontend/src/modules/Admin/Household/DevicesIndex.jsx`
- Create: `frontend/src/modules/Admin/Household/DeviceEditor.jsx`
- Modify: `frontend/src/Apps/AdminApp.jsx` — wire routes

**DevicesIndex:** Card grid per PRD Section 6.1. Create device modal.

**DeviceEditor:** Form varies by device type per PRD Section 6.2. Uses `ConfigFormWrapper` with `household/config/devices.yml`. Edits the specific device key within the devices object.

The editor uses conditionally-rendered sections based on `device.type`:
- Shield TV: display scripts, content control
- Linux PC: display scripts, OS control, content control, module hooks (`<CrudTable>`)
- MIDI Keyboard: extension path

**Step 1: Write both components**

**Step 2: Wire, test, commit**

```bash
git add frontend/src/modules/Admin/Household/DevicesIndex.jsx frontend/src/modules/Admin/Household/DeviceEditor.jsx
git commit -m "feat(admin): implement device index and type-specific editor"
```

---

## Phase 5: System — Integrations

---

### Task 17: Integrations Backend API

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/integrations.mjs`
- Modify: `backend/src/4_api/v1/routers/admin/index.mjs` — mount

Endpoints per PRD Section 10.4.

**Implementation notes:**
- `GET /integrations` reads `household/config/integrations.yml`, merges with `system/config/services.yml` URLs, checks auth file existence in `household/auth/` and `system/auth/`
- `GET /integrations/:provider` returns detail including service URL, auth status, household config
- `POST /integrations/:provider/test` runs a provider-specific health check (fetch the URL with auth, return status/timing)
- `PUT /integrations/:provider/auth` updates the credential file

**Health check logic per provider:**
- Plex: GET `{url}/` with `X-Plex-Token`
- Home Assistant: GET `{url}/api/` with `Authorization: Bearer`
- Immich: GET `{url}/api/server/info` with `x-api-key`
- Audiobookshelf: GET `{url}/api/authorize` with `Authorization: Bearer`
- Others: simple HTTP GET to service URL

**Step 1: Write the router**

**Step 2: Mount, test, commit**

```bash
git add backend/src/4_api/v1/routers/admin/integrations.mjs backend/src/4_api/v1/routers/admin/index.mjs
git commit -m "feat(admin): add integrations API with health checks"
```

---

### Task 18: Integrations Frontend

**Files:**
- Create: `frontend/src/modules/Admin/System/IntegrationsIndex.jsx`
- Create: `frontend/src/modules/Admin/System/IntegrationDetail.jsx`
- Create: `frontend/src/hooks/admin/useAdminIntegrations.js`
- Modify: `frontend/src/Apps/AdminApp.jsx` — wire routes

**IntegrationsIndex:** Card grid grouped by category per PRD Section 7.1. Each card: provider icon, name, status badge, URL. Click navigates to detail.

**IntegrationDetail:** Per PRD Section 7.2. Service URL (read-only), auth status, test connection button with result display, household config section, dependent services.

**Step 1: Write hook and components**

**Step 2: Wire, test, commit**

```bash
git add frontend/src/modules/Admin/System/ frontend/src/hooks/admin/useAdminIntegrations.js
git commit -m "feat(admin): implement integrations index and detail with health checks"
```

---

## Phase 6: Apps Config

---

### Task 19: App Config Backend API

**Files:**
- Create: `backend/src/4_api/v1/routers/admin/apps.mjs`
- Modify: `backend/src/4_api/v1/routers/admin/index.mjs` — mount

Endpoints per PRD Section 10.3.

**Implementation notes:**
- `GET /apps` lists all apps that have config files in `household/config/`. For each, return: appId, config file path, whether a purpose-built editor exists
- `GET /apps/:appId/config` reads the config YAML and returns parsed
- `PUT /apps/:appId/config` writes the config YAML

This is essentially the generic config API scoped to app config files, with an app registry overlay.

**Step 1: Write the router**

**Step 2: Mount, test, commit**

```bash
git add backend/src/4_api/v1/routers/admin/apps.mjs backend/src/4_api/v1/routers/admin/index.mjs
git commit -m "feat(admin): add app config CRUD API"
```

---

### Task 20: AppConfigEditor Wrapper + YAML Fallback

**Files:**
- Create: `frontend/src/modules/Admin/Apps/AppConfigEditor.jsx`
- Modify: `frontend/src/Apps/AdminApp.jsx` — wire route

**AppConfigEditor:** Router component that checks `appId` param:
- If a purpose-built form exists for this app → render it
- Otherwise → render `ConfigFormWrapper` + `YamlEditor` (the generic fallback)

Use a simple registry object:
```javascript
const APP_EDITORS = {
  fitness: FitnessConfig,
  // finance: FinanceConfig,  // added later
  // gratitude: GratitudeConfig,
  // shopping: ShoppingConfig,   // TBD, these are placeholders until built
};
```

Initially all apps fall back to YAML editor. Purpose-built forms are added incrementally in Tasks 21-24.

**Step 1: Write the wrapper**

**Step 2: Wire route, test, commit**

```bash
git add frontend/src/modules/Admin/Apps/AppConfigEditor.jsx
git commit -m "feat(admin): add AppConfigEditor with YAML fallback for all apps"
```

---

### Task 21: Fitness Config Form

**Files:**
- Create: `frontend/src/modules/Admin/Apps/FitnessConfig.jsx`

The largest purpose-built form. Uses `ConfigFormWrapper` with `household/config/fitness.yml`.

Accordion/tabs layout with sections per PRD 4.1.1–4.1.10:
- **Device Mappings** — two `<CrudTable>` instances (heart_rate, cadence)
- **Equipment** — `<CrudTable>` with conditional columns based on equipment type
- **Zones** — `<CrudTable>` with color picker (Mantine `ColorInput`)
- **Ambient LED** — key-value pairs mapping zone → scene name
- **Plex** — NumberInputs + `<TagInput>` for labels + `<CrudTable>` for playlists
- **Nav Items** — `<CrudTable>` with Select for type, conditional target fields
- **App Menus** — nested `<CrudTable>`
- **Governance** — NumberInputs + multi-selects + nested challenge policy table
- **User Groups** — multi-select for primary + `<CrudTable>` for family/friends

**Step 1: Write the component (large, break into sub-components if needed)**

Consider creating sub-files:
- `FitnessConfig.jsx` (main accordion)
- `FitnessDevices.jsx` (device mapping tables)
- `FitnessEquipment.jsx` (equipment table)
- `FitnessGovernance.jsx` (governance policy editor)

**Step 2: Register in AppConfigEditor**

**Step 3: Test, commit**

```bash
git add frontend/src/modules/Admin/Apps/FitnessConfig.jsx frontend/src/modules/Admin/Apps/fitness/
git commit -m "feat(admin): implement fitness config form with all sections"
```

---

### Task 22: Gratitude Config Form

**Files:**
- Create: `frontend/src/modules/Admin/Apps/GratitudeConfig.jsx`

Simpler form per PRD 4.3. Uses `ConfigFormWrapper` for the main config + separate API calls for prompt data in `household/common/gratitude/`.

- Category checklist (existing categories from config + "add custom")
- Per-category prompt manager: three-column drag-or-button interface for options/selections/discarded

**Note:** The gratitude prompt data lives in `household/common/gratitude/`, not in config. Use the existing gratitude API or add admin endpoints as needed.

**Step 1: Write the component**

**Step 2: Register in AppConfigEditor, test, commit**

```bash
git add frontend/src/modules/Admin/Apps/GratitudeConfig.jsx
git commit -m "feat(admin): implement gratitude config with prompt management"
```

---

### Task 23: Shopping Config Form

**Files:**
- Create: `frontend/src/modules/Admin/Apps/ShoppingConfig.jsx`

Per PRD 4.4. Uses `ConfigFormWrapper` with `household/config/harvesters.yml`.

- Enabled toggle, timezone select
- Retailers `<CrudTable>`: name, ID columns
- Expand row to show `<TagInput>` for senders and keywords

**Step 1: Write the component**

**Step 2: Register in AppConfigEditor, test, commit**

```bash
git add frontend/src/modules/Admin/Apps/ShoppingConfig.jsx
git commit -m "feat(admin): implement shopping config with retailer management"
```

---

### Task 24: Finance Config Form

**Files:**
- Create: `frontend/src/modules/Admin/Apps/FinanceConfig.jsx`

Per PRD 4.2. Uses `ConfigFormWrapper` with `household/config/finance.yml`.

- Budget categories `<CrudTable>`: category name, monthly limit
- Account balances `<CrudTable>`: account name, balance
- Buxfer sync toggle

**Step 1: Write the component**

**Step 2: Register in AppConfigEditor, test, commit**

```bash
git add frontend/src/modules/Admin/Apps/FinanceConfig.jsx
git commit -m "feat(admin): implement finance config with budget and account editing"
```

---

## Phase 7: Polish & Testing

---

### Task 25: Playwright Smoke Tests

**Files:**
- Create: `tests/live/flow/admin/admin-navigation.runtime.test.mjs`
- Create: `tests/live/flow/admin/admin-config-editor.runtime.test.mjs`

**admin-navigation test:**
- Load `/admin`
- Verify all nav sections render (CONTENT, APPS, HOUSEHOLD, SYSTEM)
- Click each nav item, verify route changes and content loads (no blank pages)
- Verify breadcrumbs update

**admin-config-editor test:**
- Navigate to `/admin/system/config`
- Verify file list loads
- Click a non-sensitive file (e.g. system/config/logging.yml)
- Verify YAML loads in editor
- Edit a comment line, verify dirty badge appears
- Click Revert, verify dirty badge clears
- (Don't test actual save in CI — would modify real data)

**Step 1: Write the tests**

Follow the existing Playwright pattern: serial mode, shared context, fail-fast health check, `data-testid` selectors.

**Step 2: Run tests**

```bash
npx playwright test tests/live/flow/admin/ --reporter=line
```

**Step 3: Commit**

```bash
git add tests/live/flow/admin/
git commit -m "test(admin): add Playwright smoke tests for navigation and config editor"
```

---

### Task 26: Documentation Update

**Files:**
- Modify: `docs/reference/core/backend-architecture.md` — add admin API section
- Create: `docs/reference/admin-components.md` — document the shared component library

**admin-components.md** should document:
- `YamlEditor` — props, usage examples
- `ConfigFormWrapper` — props, usage examples
- `CrudTable` — column definition format, usage examples
- `TagInput` — props
- `ConfirmModal` — props
- `useAdminConfig` — API, usage
- Backend config API — endpoints, request/response formats

**Step 1: Write docs**

**Step 2: Update docs marker**

```bash
git rev-parse HEAD > docs/docs-last-updated.txt
```

**Step 3: Commit**

```bash
git add docs/
git commit -m "docs: add admin component library reference and update architecture docs"
```

---

## Summary: Task Dependency Graph

```
Phase 1 (Foundation):
  Task 1: Config API ──────────────────────┐
  Task 2: useAdminConfig hook ─────────────┤
  Task 3: YamlEditor component ────────────┤
  Task 4: ConfigFormWrapper ───────────────┤── All independent, can be parallelized
  Task 5: CrudTable component ─────────────┤
  Task 6: TagInput component ──────────────┤
  Task 7: ConfirmModal component ──────────┤
  Task 8: Nav + route stubs ───────────────┘

Phase 2 (Config Editor):
  Task 9: Config browser + editor page ──── depends on Tasks 1-3, 8

Phase 3 (Scheduler):
  Task 10: Scheduler API ──────────────── depends on Task 1 pattern
  Task 11: Scheduler index ────────────── depends on Task 10
  Task 12: Scheduler job detail ───────── depends on Task 11

Phase 4 (Household):
  Task 13: Household API ──────────────── depends on Task 1 pattern
  Task 14: Members index ─────────────── depends on Tasks 4, 13
  Task 15: Member editor ─────────────── depends on Tasks 4, 5, 6, 14
  Task 16: Devices index + editor ─────── depends on Tasks 4, 5, 13

Phase 5 (Integrations):
  Task 17: Integrations API ───────────── depends on Task 1 pattern
  Task 18: Integrations frontend ──────── depends on Task 17

Phase 6 (Apps):
  Task 19: App config API ─────────────── depends on Task 1 pattern
  Task 20: AppConfigEditor wrapper ────── depends on Tasks 3, 4, 19
  Task 21: Fitness config form ────────── depends on Tasks 4, 5, 6, 20
  Task 22: Gratitude config form ──────── depends on Tasks 4, 5, 20
  Task 23: Shopping config form ───────── depends on Tasks 4, 5, 6, 20
  Task 24: Finance config form ────────── depends on Tasks 4, 5, 20

Phase 7 (Polish):
  Task 25: Playwright smoke tests ─────── depends on all above
  Task 26: Documentation ──────────────── depends on all above
```

**Parallelization opportunities:**
- Tasks 1–8 are all independent (Phase 1)
- Phases 2–6 can be done in any order once Phase 1 is complete
- Within each phase, backend API must come before frontend
- Task 21 (Fitness) is the largest single task — consider splitting sub-components across parallel agents
