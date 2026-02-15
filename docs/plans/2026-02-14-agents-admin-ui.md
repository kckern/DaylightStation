# Agents Admin UI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full admin section for managing agents — list agents, trigger assignments, inspect/clear working memory, configure health coach goals and program state, and preview/regenerate agent-generated dashboards.

**Architecture:** New AGENTS section in admin sidebar with dynamic agent listing. Each agent gets a detail page with tabs (Overview | Config | Dashboards). Three backend API additions (memory read/delete, dashboard delete) supplement the existing agents API. Three frontend hooks handle data fetching. Components follow existing admin patterns: Mantine v7 UI, DaylightAPI, structured logging.

**Tech Stack:** React (functional components + hooks), Mantine v7, DaylightAPI, Express routers, `node:test`, DataService (YAML persistence), YamlWorkingMemoryAdapter

**Design spec:** Brainstormed in conversation — see AGENTS nav section, agent-centric navigation, tabbed detail layout.

---

### Task 1: Backend — Memory API endpoints on agents router

Add endpoints for reading and deleting agent working memory. Pass the `workingMemory` adapter from bootstrap through to the router.

**Files:**
- Modify: `backend/src/4_api/v1/routers/agents.mjs`
- Modify: `backend/src/0_system/bootstrap.mjs` (line ~2381)
- Test: `backend/tests/unit/agents/api/agents-memory-api.test.mjs`

**Step 1: Write the failing tests**

```javascript
// backend/tests/unit/agents/api/agents-memory-api.test.mjs

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { WorkingMemoryState } from '../../../../src/3_applications/agents/framework/WorkingMemory.mjs';

describe('Agents Memory API (unit)', () => {
  let mockWorkingMemory;
  let storedState;

  beforeEach(() => {
    storedState = new WorkingMemoryState();
    storedState.set('coaching_style', 'direct feedback');
    storedState.set('temp_note', 'skipped workout', { ttl: 86400000 });

    mockWorkingMemory = {
      load: async (agentId, userId) => storedState,
      save: async (agentId, userId, state) => { storedState = state; },
    };
  });

  describe('getMemoryEntries', () => {
    it('should return all memory entries with metadata', async () => {
      const state = await mockWorkingMemory.load('health-coach', 'kckern');
      const json = state.toJSON();

      assert.ok(json.coaching_style, 'Should have coaching_style entry');
      assert.strictEqual(json.coaching_style.value, 'direct feedback');
      assert.strictEqual(json.coaching_style.expiresAt, null, 'Persistent entry has null expiresAt');

      assert.ok(json.temp_note, 'Should have temp_note entry');
      assert.strictEqual(json.temp_note.value, 'skipped workout');
      assert.ok(json.temp_note.expiresAt, 'Expiring entry has expiresAt');
    });
  });

  describe('deleteMemoryEntry', () => {
    it('should remove a single key from memory', async () => {
      const state = await mockWorkingMemory.load('health-coach', 'kckern');
      state.remove('temp_note');
      await mockWorkingMemory.save('health-coach', 'kckern', state);

      const reloaded = await mockWorkingMemory.load('health-coach', 'kckern');
      assert.strictEqual(reloaded.get('temp_note'), undefined);
      assert.strictEqual(reloaded.get('coaching_style'), 'direct feedback');
    });
  });

  describe('clearAllMemory', () => {
    it('should clear all entries', async () => {
      const emptyState = new WorkingMemoryState();
      await mockWorkingMemory.save('health-coach', 'kckern', emptyState);

      const reloaded = await mockWorkingMemory.load('health-coach', 'kckern');
      assert.deepStrictEqual(reloaded.getAll(), {});
    });
  });
});
```

**Step 2: Run tests to verify they pass (these test the memory adapter pattern)**

Run: `node --test backend/tests/unit/agents/api/agents-memory-api.test.mjs`

Expected: All PASS — these validate the adapter contract we'll use in the router.

**Step 3: Add memory endpoints to agents router**

In `backend/src/4_api/v1/routers/agents.mjs`, update the function signature and add three endpoints.

Update the config destructuring at line 27:

```javascript
  const { agentOrchestrator, workingMemory, logger = console } = config;
```

Add before `return router;` (after the assignments endpoints):

```javascript
  // --- Working Memory endpoints ---

  /**
   * GET /api/agents/:agentId/memory/:userId
   * Read all working memory entries for an agent + user
   */
  router.get('/:agentId/memory/:userId', asyncHandler(async (req, res) => {
    const { agentId, userId } = req.params;

    if (!agentOrchestrator.has(agentId)) {
      return res.status(404).json({ error: `Agent '${agentId}' not found` });
    }

    if (!workingMemory) {
      return res.status(501).json({ error: 'Working memory not configured' });
    }

    const state = await workingMemory.load(agentId, userId);
    const entries = state.toJSON();

    res.json({ agentId, userId, entries });
  }));

  /**
   * DELETE /api/agents/:agentId/memory/:userId
   * Clear all working memory for an agent + user
   */
  router.delete('/:agentId/memory/:userId', asyncHandler(async (req, res) => {
    const { agentId, userId } = req.params;

    if (!agentOrchestrator.has(agentId)) {
      return res.status(404).json({ error: `Agent '${agentId}' not found` });
    }

    if (!workingMemory) {
      return res.status(501).json({ error: 'Working memory not configured' });
    }

    const { WorkingMemoryState } = await import('#apps/agents/framework/WorkingMemory.mjs');
    await workingMemory.save(agentId, userId, new WorkingMemoryState());

    logger.info?.('agents.memory.cleared', { agentId, userId });
    res.json({ agentId, userId, cleared: true });
  }));

  /**
   * DELETE /api/agents/:agentId/memory/:userId/:key
   * Delete a single working memory entry
   */
  router.delete('/:agentId/memory/:userId/:key', asyncHandler(async (req, res) => {
    const { agentId, userId, key } = req.params;

    if (!agentOrchestrator.has(agentId)) {
      return res.status(404).json({ error: `Agent '${agentId}' not found` });
    }

    if (!workingMemory) {
      return res.status(501).json({ error: 'Working memory not configured' });
    }

    const state = await workingMemory.load(agentId, userId);
    const existed = state.get(key) !== undefined;
    state.remove(key);
    await workingMemory.save(agentId, userId, state);

    logger.info?.('agents.memory.entry.deleted', { agentId, userId, key });
    res.json({ agentId, userId, key, deleted: existed });
  }));
```

**Step 4: Pass workingMemory from bootstrap to router**

In `backend/src/0_system/bootstrap.mjs`, change the return at line ~2381 from:

```javascript
  return createAgentsRouter({ agentOrchestrator, scheduler, logger });
```

to:

```javascript
  return createAgentsRouter({ agentOrchestrator, workingMemory, scheduler, logger });
```

**Step 5: Run existing agent tests to verify nothing breaks**

Run: `node --test backend/tests/unit/agents/AgentOrchestrator.test.mjs`

Expected: All PASS

**Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/agents.mjs backend/src/0_system/bootstrap.mjs backend/tests/unit/agents/api/agents-memory-api.test.mjs
git commit -m "feat(agents-admin): add working memory API endpoints (GET/DELETE)"
```

---

### Task 2: Backend — Dashboard delete endpoint

Add a DELETE endpoint to the health-dashboard router for removing a dashboard file by date.

**Files:**
- Modify: `backend/src/4_api/v1/routers/health-dashboard.mjs`

**Step 1: Add the delete endpoint**

In `backend/src/4_api/v1/routers/health-dashboard.mjs`, add `import fs from 'node:fs';` at the top, then add before `return router;`:

```javascript
  /**
   * DELETE /:userId/:date
   * Remove the dashboard file for a specific user and date
   */
  router.delete('/:userId/:date', (req, res) => {
    const { userId, date } = req.params;

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be YYYY-MM-DD format' });
    }

    const filePath = dataService.user.resolvePath(`health-dashboard/${date}`, userId);

    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        logger.info?.('health-dashboard.deleted', { userId, date, filePath });
        res.json({ userId, date, deleted: true });
      } else {
        res.status(404).json({ error: 'No dashboard file for this date', userId, date });
      }
    } catch (err) {
      logger.error?.('health-dashboard.delete.error', { userId, date, error: err.message });
      res.status(500).json({ error: 'Failed to delete dashboard file' });
    }
  });
```

**Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/health-dashboard.mjs
git commit -m "feat(agents-admin): add DELETE endpoint for health dashboard files"
```

---

### Task 3: Frontend — useAdminAgents hook

Data-fetching hook for listing agents, getting agent details, and triggering assignments.

**Files:**
- Create: `frontend/src/hooks/admin/useAdminAgents.js`

**Step 1: Write the hook**

```javascript
// frontend/src/hooks/admin/useAdminAgents.js

import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/agents';

export function useAdminAgents() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAdminAgents' }), []);

  const [agents, setAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(API_BASE);
      setAgents(result.agents || []);
      logger.info('admin.agents.fetched', { count: result.agents?.length });
      return result;
    } catch (err) {
      setError(err);
      logger.error('admin.agents.fetch.failed', { message: err.message });
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const fetchAssignments = useCallback(async (agentId) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/${agentId}/assignments`);
      logger.info('admin.agents.assignments.fetched', { agentId, count: result.assignments?.length });
      return result.assignments || [];
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const triggerAssignment = useCallback(async (agentId, assignmentId, userId) => {
    try {
      const result = await DaylightAPI(
        `${API_BASE}/${agentId}/assignments/${assignmentId}/run`,
        { userId },
        'POST'
      );
      logger.info('admin.agents.assignment.triggered', { agentId, assignmentId, userId });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    agents, loading, error,
    fetchAgents, fetchAssignments, triggerAssignment, clearError,
  };
}

export default useAdminAgents;
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/admin/useAdminAgents.js
git commit -m "feat(agents-admin): add useAdminAgents hook"
```

---

### Task 4: Frontend — useAgentMemory hook

Hook for reading and deleting agent working memory entries.

**Files:**
- Create: `frontend/src/hooks/admin/useAgentMemory.js`

**Step 1: Write the hook**

```javascript
// frontend/src/hooks/admin/useAgentMemory.js

import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

const API_BASE = '/api/v1/agents';

export function useAgentMemory() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAgentMemory' }), []);

  const [entries, setEntries] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchMemory = useCallback(async (agentId, userId) => {
    if (!agentId || !userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`${API_BASE}/${agentId}/memory/${userId}`);
      setEntries(result.entries || {});
      logger.info('admin.agents.memory.fetched', { agentId, userId, count: Object.keys(result.entries || {}).length });
      return result;
    } catch (err) {
      // 501 means memory not configured — treat as empty, not error
      if (err.status === 501) {
        setEntries({});
        return { entries: {} };
      }
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const deleteEntry = useCallback(async (agentId, userId, key) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/${agentId}/memory/${userId}/${key}`, {}, 'DELETE');
      logger.info('admin.agents.memory.entry.deleted', { agentId, userId, key });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearAll = useCallback(async (agentId, userId) => {
    try {
      const result = await DaylightAPI(`${API_BASE}/${agentId}/memory/${userId}`, {}, 'DELETE');
      logger.info('admin.agents.memory.cleared', { agentId, userId });
      setEntries({});
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    entries, loading, error,
    fetchMemory, deleteEntry, clearAll, clearError,
  };
}

export default useAgentMemory;
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/admin/useAgentMemory.js
git commit -m "feat(agents-admin): add useAgentMemory hook"
```

---

### Task 5: Frontend — useAgentDashboard hook

Hook for reading, deleting, and regenerating agent-generated dashboards.

**Files:**
- Create: `frontend/src/hooks/admin/useAgentDashboard.js`

**Step 1: Write the hook**

```javascript
// frontend/src/hooks/admin/useAgentDashboard.js

import { useState, useCallback, useMemo } from 'react';
import { DaylightAPI } from '../../lib/api.mjs';
import getLogger from '../../lib/logging/Logger.js';

export function useAgentDashboard() {
  const logger = useMemo(() => getLogger().child({ hook: 'useAgentDashboard' }), []);

  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState(null);

  const fetchDashboard = useCallback(async (userId, date) => {
    if (!userId || !date) return;
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`/api/v1/health-dashboard/${userId}/${date}`);
      setDashboard(result.dashboard || null);
      logger.info('admin.dashboard.fetched', { userId, date });
      return result;
    } catch (err) {
      // 404 means no dashboard generated — treat as null, not error
      if (err.status === 404 || err.message?.includes('404')) {
        setDashboard(null);
        return null;
      }
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [logger]);

  const deleteDashboard = useCallback(async (userId, date) => {
    try {
      const result = await DaylightAPI(`/api/v1/health-dashboard/${userId}/${date}`, {}, 'DELETE');
      setDashboard(null);
      logger.info('admin.dashboard.deleted', { userId, date });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    }
  }, [logger]);

  const regenerate = useCallback(async (agentId, userId) => {
    setRegenerating(true);
    setError(null);
    try {
      const result = await DaylightAPI(
        `/api/v1/agents/${agentId}/assignments/daily-dashboard/run`,
        { userId },
        'POST'
      );
      logger.info('admin.dashboard.regenerated', { agentId, userId });
      return result;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setRegenerating(false);
    }
  }, [logger]);

  const clearError = useCallback(() => setError(null), []);

  return {
    dashboard, loading, regenerating, error,
    fetchDashboard, deleteDashboard, regenerate, clearError,
  };
}

export default useAgentDashboard;
```

**Step 2: Commit**

```bash
git add frontend/src/hooks/admin/useAgentDashboard.js
git commit -m "feat(agents-admin): add useAgentDashboard hook"
```

---

### Task 6: Frontend — AgentsIndex page

Card grid showing all registered agents. Clicking navigates to detail page.

**Files:**
- Create: `frontend/src/modules/Admin/Agents/AgentsIndex.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Admin/Agents/AgentsIndex.jsx

import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { SimpleGrid, Paper, Text, Group, Badge, Center, Loader, Alert, Stack } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useAdminAgents } from '../../../hooks/admin/useAdminAgents.js';

function AgentsIndex() {
  const navigate = useNavigate();
  const { agents, loading, error, fetchAgents, clearError } = useAdminAgents();

  useEffect(() => {
    fetchAgents().catch(() => {});
  }, [fetchAgents]);

  if (loading && agents.length === 0) {
    return <Center h={300}><Loader /></Center>;
  }

  return (
    <Stack p="md" gap="md">
      <Text size="xl" fw={600} ff="var(--ds-font-mono)">Agents</Text>

      {error && (
        <Alert
          color="red"
          icon={<IconAlertCircle size={16} />}
          withCloseButton
          onClose={clearError}
        >
          {error.message || 'Failed to load agents'}
        </Alert>
      )}

      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {agents.map(agent => (
          <Paper
            key={agent.id}
            p="lg"
            radius="md"
            style={{ cursor: 'pointer' }}
            onClick={() => navigate(`/admin/agents/${agent.id}`)}
          >
            <Group justify="space-between" mb="xs">
              <Text size="lg" fw={600} ff="var(--ds-font-mono)">{agent.id}</Text>
              <Badge color="green" variant="light" size="sm">registered</Badge>
            </Group>
            <Text size="sm" c="dimmed">{agent.description || 'No description'}</Text>
          </Paper>
        ))}
      </SimpleGrid>

      {agents.length === 0 && !loading && (
        <Text c="dimmed" ta="center" py="xl">No agents registered</Text>
      )}
    </Stack>
  );
}

export default AgentsIndex;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/Agents/AgentsIndex.jsx
git commit -m "feat(agents-admin): add AgentsIndex page"
```

---

### Task 7: Frontend — OverviewTab

Agent operations tab: status banner, assignments table with Run Now, and memory inspector.

**Files:**
- Create: `frontend/src/modules/Admin/Agents/OverviewTab.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Admin/Agents/OverviewTab.jsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Paper, Text, Group, Badge, Table, Button, Alert,
  Center, Loader, ActionIcon, Tooltip,
} from '@mantine/core';
import { IconPlayerPlay, IconTrash, IconAlertCircle } from '@tabler/icons-react';
import { useAdminAgents } from '../../../hooks/admin/useAdminAgents.js';
import { useAgentMemory } from '../../../hooks/admin/useAgentMemory.js';
import { ConfirmModal } from '../shared/ConfirmModal.jsx';

function OverviewTab({ agentId, userId }) {
  const { fetchAssignments, triggerAssignment, error: agentError, clearError: clearAgentError } = useAdminAgents();
  const {
    entries, loading: memLoading,
    fetchMemory, deleteEntry, clearAll,
    error: memError, clearError: clearMemError,
  } = useAgentMemory();

  const [assignments, setAssignments] = useState([]);
  const [assLoading, setAssLoading] = useState(true);
  const [runningId, setRunningId] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  // Fetch assignments on mount
  useEffect(() => {
    setAssLoading(true);
    fetchAssignments(agentId)
      .then(a => setAssignments(a))
      .catch(() => {})
      .finally(() => setAssLoading(false));
  }, [agentId, fetchAssignments]);

  // Fetch memory when userId changes
  useEffect(() => {
    if (userId) fetchMemory(agentId, userId).catch(() => {});
  }, [agentId, userId, fetchMemory]);

  const handleRunAssignment = useCallback(async (assignmentId) => {
    setRunningId(assignmentId);
    setRunResult(null);
    try {
      const result = await triggerAssignment(agentId, assignmentId, userId);
      setRunResult({ assignmentId, status: 'success', message: 'Completed' });
    } catch (err) {
      setRunResult({ assignmentId, status: 'error', message: err.message || 'Failed' });
    } finally {
      setRunningId(null);
    }
  }, [agentId, userId, triggerAssignment]);

  const handleDeleteEntry = useCallback(async (key) => {
    await deleteEntry(agentId, userId, key);
    await fetchMemory(agentId, userId);
  }, [agentId, userId, deleteEntry, fetchMemory]);

  const handleClearAll = useCallback(async () => {
    await clearAll(agentId, userId);
    setClearConfirmOpen(false);
  }, [agentId, userId, clearAll]);

  const error = agentError || memError;
  const onClearError = agentError ? clearAgentError : clearMemError;

  const memoryEntries = Object.entries(entries);

  return (
    <Stack gap="md">
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={onClearError}>
          {error.message || 'An error occurred'}
        </Alert>
      )}

      {/* Status Banner */}
      <Paper p="md">
        <Group justify="space-between">
          <div>
            <Text size="lg" fw={600} ff="var(--ds-font-mono)">{agentId}</Text>
            <Text size="sm" c="dimmed">Registered and active</Text>
          </div>
          <Badge color="green" variant="light" size="lg">Active</Badge>
        </Group>
      </Paper>

      {/* Assignments */}
      <Paper p="md">
        <Text size="sm" fw={600} tt="uppercase" c="dimmed" mb="sm" ff="var(--ds-font-mono)">
          Assignments
        </Text>

        {assLoading ? (
          <Center py="md"><Loader size="sm" /></Center>
        ) : assignments.length === 0 ? (
          <Text c="dimmed" size="sm">No assignments registered</Text>
        ) : (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>ID</Table.Th>
                <Table.Th>Description</Table.Th>
                <Table.Th>Schedule</Table.Th>
                <Table.Th w={120}>Action</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {assignments.map(a => (
                <Table.Tr key={a.id}>
                  <Table.Td>
                    <Text size="sm" ff="var(--ds-font-mono)">{a.id}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm">{a.description || '—'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" ff="var(--ds-font-mono)">{a.schedule || 'manual'}</Text>
                  </Table.Td>
                  <Table.Td>
                    <Button
                      size="xs"
                      variant="light"
                      leftSection={<IconPlayerPlay size={14} />}
                      loading={runningId === a.id}
                      onClick={() => handleRunAssignment(a.id)}
                    >
                      Run Now
                    </Button>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}

        {runResult && (
          <Alert
            color={runResult.status === 'success' ? 'green' : 'red'}
            mt="sm"
            withCloseButton
            onClose={() => setRunResult(null)}
          >
            {runResult.assignmentId}: {runResult.message}
          </Alert>
        )}
      </Paper>

      {/* Working Memory */}
      <Paper p="md">
        <Group justify="space-between" mb="sm">
          <Text size="sm" fw={600} tt="uppercase" c="dimmed" ff="var(--ds-font-mono)">
            Working Memory
          </Text>
          {memoryEntries.length > 0 && (
            <Button
              size="xs"
              variant="light"
              color="red"
              leftSection={<IconTrash size={14} />}
              onClick={() => setClearConfirmOpen(true)}
            >
              Clear All
            </Button>
          )}
        </Group>

        {!userId && (
          <Text c="dimmed" size="sm">Select a user to view memory</Text>
        )}

        {userId && memLoading && <Center py="md"><Loader size="sm" /></Center>}

        {userId && !memLoading && memoryEntries.length === 0 && (
          <Text c="dimmed" size="sm">No memory entries</Text>
        )}

        {userId && !memLoading && memoryEntries.length > 0 && (
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Key</Table.Th>
                <Table.Th>Value</Table.Th>
                <Table.Th>Expires</Table.Th>
                <Table.Th w={50} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {memoryEntries.map(([key, entry]) => {
                const isExpired = entry.expiresAt && Date.now() >= entry.expiresAt;
                return (
                  <Table.Tr key={key} style={isExpired ? { opacity: 0.4, textDecoration: 'line-through' } : {}}>
                    <Table.Td>
                      <Text size="sm" ff="var(--ds-font-mono)">{key}</Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="sm" lineClamp={1}>
                        {typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value)}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {entry.expiresAt ? new Date(entry.expiresAt).toLocaleDateString() : 'persistent'}
                      </Text>
                    </Table.Td>
                    <Table.Td>
                      <Tooltip label="Delete entry">
                        <ActionIcon
                          size="sm"
                          variant="subtle"
                          color="red"
                          onClick={() => handleDeleteEntry(key)}
                        >
                          <IconTrash size={14} />
                        </ActionIcon>
                      </Tooltip>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        )}
      </Paper>

      <ConfirmModal
        opened={clearConfirmOpen}
        onClose={() => setClearConfirmOpen(false)}
        onConfirm={handleClearAll}
        title="Clear All Memory"
        message={`This will delete all working memory entries for ${agentId} / ${userId}. The agent will start fresh on its next run.`}
        confirmLabel="Clear All"
      />
    </Stack>
  );
}

export default OverviewTab;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/Agents/OverviewTab.jsx
git commit -m "feat(agents-admin): add OverviewTab with assignments and memory inspector"
```

---

### Task 8: Frontend — ConfigTab

User goals and program state configuration forms.

**Files:**
- Create: `frontend/src/modules/Admin/Agents/ConfigTab.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Admin/Agents/ConfigTab.jsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Paper, Text, Group, Button, NumberInput, TextInput, Select, Alert,
  Center, Loader, TagsInput,
} from '@mantine/core';
import { IconDeviceFloppy, IconAlertCircle } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';

function ConfigTab({ agentId, userId }) {
  const [goals, setGoals] = useState(null);
  const [programState, setProgramState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [dirty, setDirty] = useState({ goals: false, program: false });

  // Load config data
  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    setError(null);

    Promise.all([
      DaylightAPI(`/api/v1/admin/config/files/users/${userId}/agents/${agentId}/goals`)
        .then(r => r.parsed)
        .catch(() => null),
      DaylightAPI(`/api/v1/admin/config/files/users/${userId}/agents/${agentId}/program-state`)
        .then(r => r.parsed)
        .catch(() => null),
    ]).then(([g, p]) => {
      setGoals(g || { weight: {}, nutrition: {} });
      setProgramState(p || { program: null });
      setDirty({ goals: false, program: false });
    }).catch(err => {
      setError(err);
    }).finally(() => {
      setLoading(false);
    });
  }, [agentId, userId]);

  const updateGoals = useCallback((path, value) => {
    setGoals(prev => {
      const next = { ...prev };
      const parts = path.split('.');
      let obj = next;
      for (let i = 0; i < parts.length - 1; i++) {
        obj[parts[i]] = { ...(obj[parts[i]] || {}) };
        obj = obj[parts[i]];
      }
      obj[parts[parts.length - 1]] = value;
      return next;
    });
    setDirty(prev => ({ ...prev, goals: true }));
  }, []);

  const updateProgram = useCallback((path, value) => {
    setProgramState(prev => {
      const next = { ...prev };
      if (!next.program) next.program = {};
      next.program[path] = value;
      return next;
    });
    setDirty(prev => ({ ...prev, program: true }));
  }, []);

  const saveGoals = useCallback(async () => {
    setSaving(true);
    try {
      await DaylightAPI(
        `/api/v1/admin/config/files/users/${userId}/agents/${agentId}/goals`,
        { parsed: goals },
        'PUT'
      );
      setDirty(prev => ({ ...prev, goals: false }));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [agentId, userId, goals]);

  const saveProgramState = useCallback(async () => {
    setSaving(true);
    try {
      await DaylightAPI(
        `/api/v1/admin/config/files/users/${userId}/agents/${agentId}/program-state`,
        { parsed: programState },
        'PUT'
      );
      setDirty(prev => ({ ...prev, program: false }));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [agentId, userId, programState]);

  const clearProgram = useCallback(async () => {
    setProgramState({ program: null });
    setSaving(true);
    try {
      await DaylightAPI(
        `/api/v1/admin/config/files/users/${userId}/agents/${agentId}/program-state`,
        { parsed: { program: null } },
        'PUT'
      );
      setDirty(prev => ({ ...prev, program: false }));
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }, [agentId, userId]);

  if (!userId) {
    return <Text c="dimmed" p="md">Select a user to configure</Text>;
  }

  if (loading) {
    return <Center h={200}><Loader /></Center>;
  }

  return (
    <Stack gap="md">
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={() => setError(null)}>
          {error.message || 'Failed to save'}
        </Alert>
      )}

      {/* User Goals */}
      <Paper p="md">
        <Group justify="space-between" mb="md">
          <Text size="sm" fw={600} tt="uppercase" c="dimmed" ff="var(--ds-font-mono)">
            User Goals
          </Text>
          <Button
            size="xs"
            leftSection={<IconDeviceFloppy size={14} />}
            disabled={!dirty.goals}
            loading={saving}
            onClick={saveGoals}
          >
            Save Goals
          </Button>
        </Group>

        <Stack gap="sm">
          <NumberInput
            label="Weight target (lbs)"
            value={goals?.weight?.target_lbs || ''}
            onChange={(v) => updateGoals('weight.target_lbs', v)}
            min={50}
            max={500}
          />
          <NumberInput
            label="Daily calorie target"
            value={goals?.nutrition?.daily_calories || ''}
            onChange={(v) => updateGoals('nutrition.daily_calories', v)}
            min={500}
            max={10000}
            step={50}
          />
          <NumberInput
            label="Daily protein target (g)"
            value={goals?.nutrition?.daily_protein || ''}
            onChange={(v) => updateGoals('nutrition.daily_protein', v)}
            min={0}
            max={500}
          />
          <NumberInput
            label="Daily carbs target (g)"
            value={goals?.nutrition?.daily_carbs || ''}
            onChange={(v) => updateGoals('nutrition.daily_carbs', v)}
            min={0}
            max={1000}
          />
          <NumberInput
            label="Daily fat target (g)"
            value={goals?.nutrition?.daily_fat || ''}
            onChange={(v) => updateGoals('nutrition.daily_fat', v)}
            min={0}
            max={500}
          />
        </Stack>
      </Paper>

      {/* Program State */}
      <Paper p="md">
        <Group justify="space-between" mb="md">
          <Text size="sm" fw={600} tt="uppercase" c="dimmed" ff="var(--ds-font-mono)">
            Program State
          </Text>
          <Group gap="xs">
            <Button size="xs" variant="light" color="red" onClick={clearProgram}>
              Clear Program
            </Button>
            <Button
              size="xs"
              leftSection={<IconDeviceFloppy size={14} />}
              disabled={!dirty.program}
              loading={saving}
              onClick={saveProgramState}
            >
              Save
            </Button>
          </Group>
        </Group>

        {!programState?.program ? (
          <Text c="dimmed" size="sm">No active program (ad-hoc mode)</Text>
        ) : (
          <Stack gap="sm">
            <TextInput
              label="Program ID"
              value={programState.program.id || ''}
              onChange={(e) => updateProgram('id', e.target.value)}
              placeholder="e.g., p90x"
            />
            <TextInput
              label="Content source"
              value={programState.program.content_source || ''}
              onChange={(e) => updateProgram('content_source', e.target.value)}
              placeholder="e.g., plex:12345"
            />
            <Group grow>
              <NumberInput
                label="Current day"
                value={programState.program.current_day || ''}
                onChange={(v) => updateProgram('current_day', v)}
                min={1}
              />
              <NumberInput
                label="Total days"
                value={programState.program.total_days || ''}
                onChange={(v) => updateProgram('total_days', v)}
                min={1}
              />
            </Group>
            <Select
              label="Status"
              value={programState.program.status || 'active'}
              onChange={(v) => updateProgram('status', v)}
              data={[
                { value: 'active', label: 'Active' },
                { value: 'paused', label: 'Paused' },
                { value: 'completed', label: 'Completed' },
                { value: 'abandoned', label: 'Abandoned' },
              ]}
            />
            <TextInput
              label="Started"
              value={programState.program.started || ''}
              onChange={(e) => updateProgram('started', e.target.value)}
              placeholder="YYYY-MM-DD"
            />
            <TagsInput
              label="Rest days"
              value={programState.program.rest_days || []}
              onChange={(v) => updateProgram('rest_days', v)}
              placeholder="e.g., sunday"
            />
          </Stack>
        )}
      </Paper>
    </Stack>
  );
}

export default ConfigTab;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/Agents/ConfigTab.jsx
git commit -m "feat(agents-admin): add ConfigTab with goals and program state forms"
```

---

### Task 9: Frontend — DashboardsTab

Dashboard preview, date navigation, regenerate and delete actions.

**Files:**
- Create: `frontend/src/modules/Admin/Agents/DashboardsTab.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Admin/Agents/DashboardsTab.jsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Paper, Text, Group, Button, Badge, Alert, Center, Loader,
  TextInput, Blockquote, Code, Collapse,
} from '@mantine/core';
import {
  IconCalendar, IconRefresh, IconTrash, IconAlertCircle,
  IconChevronDown, IconChevronRight,
} from '@tabler/icons-react';
import { useAgentDashboard } from '../../../hooks/admin/useAgentDashboard.js';
import { ConfirmModal } from '../shared/ConfirmModal.jsx';

function DashboardsTab({ agentId, userId }) {
  const today = new Date().toISOString().split('T')[0];
  const [date, setDate] = useState(today);
  const [rawOpen, setRawOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const {
    dashboard, loading, regenerating, error,
    fetchDashboard, deleteDashboard, regenerate, clearError,
  } = useAgentDashboard();

  useEffect(() => {
    if (userId && date) fetchDashboard(userId, date).catch(() => {});
  }, [userId, date, fetchDashboard]);

  const handleRegenerate = useCallback(async () => {
    await regenerate(agentId, userId);
    // Refresh after regeneration
    await fetchDashboard(userId, date);
  }, [agentId, userId, date, regenerate, fetchDashboard]);

  const handleDelete = useCallback(async () => {
    await deleteDashboard(userId, date);
    setDeleteOpen(false);
  }, [userId, date, deleteDashboard]);

  if (!userId) {
    return <Text c="dimmed" p="md">Select a user to view dashboards</Text>;
  }

  return (
    <Stack gap="md">
      {error && (
        <Alert color="red" icon={<IconAlertCircle size={16} />} withCloseButton onClose={clearError}>
          {error.message || 'An error occurred'}
        </Alert>
      )}

      {/* Date Picker */}
      <Paper p="md">
        <Group>
          <IconCalendar size={18} />
          <TextInput
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            style={{ flex: 1, maxWidth: 200 }}
          />
          <Button
            size="xs"
            variant="light"
            onClick={() => setDate(today)}
            disabled={date === today}
          >
            Today
          </Button>
        </Group>
      </Paper>

      {loading && <Center py="xl"><Loader /></Center>}

      {!loading && !dashboard && (
        <Paper p="xl" ta="center">
          <Text c="dimmed" mb="md">No dashboard generated for {date}</Text>
          <Button
            leftSection={<IconRefresh size={16} />}
            loading={regenerating}
            onClick={handleRegenerate}
          >
            Generate Now
          </Button>
        </Paper>
      )}

      {!loading && dashboard && (
        <>
          {/* Dashboard Preview */}
          <Group grow align="flex-start" gap="md">
            {/* Curated Content */}
            <Paper p="md">
              <Text size="sm" fw={600} tt="uppercase" c="dimmed" mb="sm" ff="var(--ds-font-mono)">
                Curated Content
              </Text>

              {dashboard.curated?.up_next?.primary && (
                <Stack gap="xs" mb="md">
                  <Text size="xs" c="dimmed" tt="uppercase">Up Next</Text>
                  <Group gap="xs">
                    <Code>{dashboard.curated.up_next.primary.content_id}</Code>
                    <Text size="sm" fw={500}>{dashboard.curated.up_next.primary.title}</Text>
                    <Badge variant="light" size="sm">{dashboard.curated.up_next.primary.duration} min</Badge>
                  </Group>
                  {dashboard.curated.up_next.primary.program_context && (
                    <Text size="xs" c="dimmed">{dashboard.curated.up_next.primary.program_context}</Text>
                  )}
                </Stack>
              )}

              {dashboard.curated?.up_next?.alternates?.length > 0 && (
                <Stack gap="xs" mb="md">
                  <Text size="xs" c="dimmed" tt="uppercase">Alternates</Text>
                  {dashboard.curated.up_next.alternates.map((alt, i) => (
                    <Group key={i} gap="xs">
                      <Code>{alt.content_id}</Code>
                      <Text size="sm">{alt.title}</Text>
                      <Badge variant="light" size="xs">{alt.duration} min</Badge>
                      {alt.reason && <Badge variant="outline" size="xs" color="gray">{alt.reason}</Badge>}
                    </Group>
                  ))}
                </Stack>
              )}

              {dashboard.curated?.playlist_suggestion?.length > 0 && (
                <Stack gap="xs">
                  <Text size="xs" c="dimmed" tt="uppercase">Playlist Suggestion</Text>
                  {dashboard.curated.playlist_suggestion.map((item, i) => (
                    <Group key={i} gap="xs">
                      <Text size="xs" c="dimmed" w={16} ta="right">{i + 1}.</Text>
                      <Text size="sm">{item.title}</Text>
                      <Badge variant="light" size="xs">{item.duration} min</Badge>
                    </Group>
                  ))}
                </Stack>
              )}
            </Paper>

            {/* Coach Content */}
            <Paper p="md">
              <Text size="sm" fw={600} tt="uppercase" c="dimmed" mb="sm" ff="var(--ds-font-mono)">
                Coach Content
              </Text>

              {dashboard.coach?.briefing && (
                <Blockquote color="blue" mb="md" p="sm" style={{ fontStyle: 'italic' }}>
                  {dashboard.coach.briefing}
                </Blockquote>
              )}

              {dashboard.coach?.cta?.length > 0 && (
                <Stack gap="xs" mb="md">
                  <Text size="xs" c="dimmed" tt="uppercase">CTAs</Text>
                  {dashboard.coach.cta.map((cta, i) => (
                    <Group key={i} gap="xs">
                      <Badge
                        size="xs"
                        color={cta.type === 'data_gap' ? 'yellow' : cta.type === 'observation' ? 'green' : 'blue'}
                      >
                        {cta.type}
                      </Badge>
                      <Text size="sm">{cta.message}</Text>
                    </Group>
                  ))}
                </Stack>
              )}

              {dashboard.coach?.prompts?.length > 0 && (
                <Stack gap="xs">
                  <Text size="xs" c="dimmed" tt="uppercase">Prompts</Text>
                  {dashboard.coach.prompts.map((prompt, i) => (
                    <Paper key={i} p="xs" withBorder>
                      <Group gap="xs" mb={4}>
                        <Badge size="xs" variant="outline">{prompt.type}</Badge>
                        <Text size="sm" fw={500}>{prompt.question}</Text>
                      </Group>
                      {prompt.options && (
                        <Group gap={4}>
                          {prompt.options.map((opt, j) => (
                            <Badge key={j} variant="light" size="sm">{opt}</Badge>
                          ))}
                        </Group>
                      )}
                    </Paper>
                  ))}
                </Stack>
              )}
            </Paper>
          </Group>

          {/* Raw YAML */}
          <Paper p="md">
            <Group
              gap="xs"
              style={{ cursor: 'pointer' }}
              onClick={() => setRawOpen(v => !v)}
            >
              {rawOpen ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
              <Text size="sm" fw={500}>Raw JSON</Text>
            </Group>
            <Collapse in={rawOpen}>
              <Code block mt="sm" style={{ maxHeight: 400, overflow: 'auto' }}>
                {JSON.stringify(dashboard, null, 2)}
              </Code>
            </Collapse>
          </Paper>

          {/* Actions */}
          <Group justify="flex-end">
            <Button
              variant="light"
              color="red"
              leftSection={<IconTrash size={16} />}
              onClick={() => setDeleteOpen(true)}
            >
              Delete
            </Button>
            <Button
              leftSection={<IconRefresh size={16} />}
              loading={regenerating}
              onClick={handleRegenerate}
            >
              Regenerate
            </Button>
          </Group>
        </>
      )}

      <ConfirmModal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Dashboard"
        message={`Delete the dashboard for ${userId} on ${date}? The agent will regenerate it on its next scheduled run.`}
        confirmLabel="Delete"
      />
    </Stack>
  );
}

export default DashboardsTab;
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Admin/Agents/DashboardsTab.jsx
git commit -m "feat(agents-admin): add DashboardsTab with preview, regenerate, and delete"
```

---

### Task 10: Frontend — AgentDetail container

Tabbed container that renders Overview, Config, and Dashboards tabs. Includes a shared UserSelector dropdown.

**Files:**
- Create: `frontend/src/modules/Admin/Agents/AgentDetail.jsx`
- Create: `frontend/src/modules/Admin/Agents/AgentDetail.scss`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Admin/Agents/AgentDetail.jsx

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { Tabs, Group, Select, Text, Stack, Center, Loader } from '@mantine/core';
import { IconSettings, IconLayoutDashboard, IconAdjustments } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';
import OverviewTab from './OverviewTab.jsx';
import ConfigTab from './ConfigTab.jsx';
import DashboardsTab from './DashboardsTab.jsx';
import './AgentDetail.scss';

function AgentDetail() {
  const { agentId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // Tab from URL hash
  const hashTab = location.hash?.replace('#', '') || 'overview';
  const [activeTab, setActiveTab] = useState(hashTab);

  // User selector
  const [users, setUsers] = useState([]);
  const [userId, setUserId] = useState(null);
  const [usersLoading, setUsersLoading] = useState(true);

  // Fetch household members for user selector
  useEffect(() => {
    setUsersLoading(true);
    DaylightAPI('/api/v1/admin/household/members')
      .then(result => {
        const members = result.members || [];
        setUsers(members.map(m => ({
          value: m.username || m.name || m.id,
          label: m.displayName || m.username || m.name || m.id,
        })));
        // Default to first user
        if (members.length > 0 && !userId) {
          setUserId(members[0].username || members[0].name || members[0].id);
        }
      })
      .catch(() => {
        setUsers([]);
      })
      .finally(() => setUsersLoading(false));
  }, []);

  // Sync tab to URL hash
  const handleTabChange = useCallback((tab) => {
    setActiveTab(tab);
    navigate(`#${tab}`, { replace: true });
  }, [navigate]);

  return (
    <Stack p="md" gap="md" className="agent-detail">
      {/* Header */}
      <Group justify="space-between">
        <Text size="xl" fw={600} ff="var(--ds-font-mono)">{agentId}</Text>
        <Group gap="sm">
          <Text size="sm" c="dimmed">User:</Text>
          {usersLoading ? (
            <Loader size="xs" />
          ) : (
            <Select
              size="xs"
              w={180}
              value={userId}
              onChange={setUserId}
              data={users}
              placeholder="Select user"
            />
          )}
        </Group>
      </Group>

      {/* Tabs */}
      <Tabs value={activeTab} onChange={handleTabChange}>
        <Tabs.List>
          <Tabs.Tab value="overview" leftSection={<IconSettings size={16} />}>
            Overview
          </Tabs.Tab>
          <Tabs.Tab value="config" leftSection={<IconAdjustments size={16} />}>
            Config
          </Tabs.Tab>
          <Tabs.Tab value="dashboards" leftSection={<IconLayoutDashboard size={16} />}>
            Dashboards
          </Tabs.Tab>
        </Tabs.List>

        <Tabs.Panel value="overview" pt="md">
          <OverviewTab agentId={agentId} userId={userId} />
        </Tabs.Panel>

        <Tabs.Panel value="config" pt="md">
          <ConfigTab agentId={agentId} userId={userId} />
        </Tabs.Panel>

        <Tabs.Panel value="dashboards" pt="md">
          <DashboardsTab agentId={agentId} userId={userId} />
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export default AgentDetail;
```

**Step 2: Write the styles**

```scss
// frontend/src/modules/Admin/Agents/AgentDetail.scss

.agent-detail {
  max-width: 1200px;
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/Agents/AgentDetail.jsx frontend/src/modules/Admin/Agents/AgentDetail.scss
git commit -m "feat(agents-admin): add AgentDetail tabbed container with user selector"
```

---

### Task 11: Frontend — AdminNav + AdminApp routes

Add the AGENTS section to sidebar navigation and register routes in AdminApp.

**Files:**
- Modify: `frontend/src/modules/Admin/AdminNav.jsx`
- Modify: `frontend/src/Apps/AdminApp.jsx`

**Step 1: Update AdminNav.jsx**

Add `IconRobot` to the icon imports at line 4:

```javascript
import {
  IconMenu2, IconPlayerRecord, IconCalendarEvent,
  IconRun, IconCoin, IconHeart, IconShoppingCart,
  IconUsers, IconDevices,
  IconPlugConnected, IconClock, IconFileCode,
  IconRobot
} from '@tabler/icons-react';
```

Add the AGENTS section to `navSections` array after the APPS section (after line 28):

```javascript
  {
    label: 'AGENTS',
    items: [
      { label: 'All Agents', icon: IconRobot, to: '/admin/agents' },
    ]
  },
```

**Note for implementer:** The "All Agents" entry navigates to AgentsIndex. Individual agents are accessed by clicking through from there, so they don't need nav entries. However, if you want per-agent nav items, you could make the nav dynamic by fetching from `GET /api/v1/agents` — but keep it simple for now.

**Step 2: Update AdminApp.jsx**

Add imports near the top (after line 20):

```javascript
import AgentsIndex from '../modules/Admin/Agents/AgentsIndex.jsx';
import AgentDetail from '../modules/Admin/Agents/AgentDetail.jsx';
```

Add routes inside the `<Route element={<AdminLayout />}>` block (after the System routes, before the catch-all):

```jsx
              {/* Agents */}
              <Route path="agents" element={<AgentsIndex />} />
              <Route path="agents/:agentId" element={<AgentDetail />} />
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/AdminNav.jsx frontend/src/Apps/AdminApp.jsx
git commit -m "feat(agents-admin): add AGENTS nav section and routes to AdminApp"
```

---

### Task 12: Verify end-to-end in browser

Start the dev server and verify the admin agents section works.

**Step 1: Check if dev server is running**

Run: `lsof -i :3111`

If not running, start it:

Run: `cd /Users/kckern/Documents/GitHub/DaylightStation && npm run dev`

**Step 2: Navigate to the admin agents section**

Open browser to `http://localhost:3111/admin/agents`

**Step 3: Verify rendering**

Check that:
- [ ] AgentsIndex shows agent cards (health-coach, echo)
- [ ] Clicking a card navigates to `/admin/agents/health-coach`
- [ ] AgentDetail shows tabs (Overview, Config, Dashboards)
- [ ] User selector populates with household members
- [ ] Overview tab shows assignments table with Run Now button
- [ ] Overview tab shows working memory entries (or "No memory entries" for empty)
- [ ] Config tab shows goals form and program state
- [ ] Dashboards tab shows date picker and dashboard preview (or empty state)
- [ ] AGENTS section appears in sidebar navigation
- [ ] No console errors

**Step 4: Fix any issues found during verification**

Common issues to watch for:
- Import path errors (check browser console)
- API 404s (verify backend routes are mounted and accepting the right URL format)
- User selector not populating (check `/api/v1/admin/household/members` response shape)
- Config tab load failures (admin config API may return different structure than expected — check response shape)

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix(agents-admin): address verification issues"
```

---

## Summary

| Task | Component | Type |
|------|-----------|------|
| 1 | Memory API endpoints | Backend |
| 2 | Dashboard delete endpoint | Backend |
| 3 | useAdminAgents hook | Frontend hook |
| 4 | useAgentMemory hook | Frontend hook |
| 5 | useAgentDashboard hook | Frontend hook |
| 6 | AgentsIndex page | Frontend component |
| 7 | OverviewTab | Frontend component |
| 8 | ConfigTab | Frontend component |
| 9 | DashboardsTab | Frontend component |
| 10 | AgentDetail container | Frontend component |
| 11 | AdminNav + AdminApp routes | Frontend wiring |
| 12 | End-to-end verification | Testing |

### Backend API additions

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/v1/agents/:agentId/memory/:userId` | Read memory entries |
| DELETE | `/api/v1/agents/:agentId/memory/:userId` | Clear all memory |
| DELETE | `/api/v1/agents/:agentId/memory/:userId/:key` | Delete single entry |
| DELETE | `/api/v1/health-dashboard/:userId/:date` | Remove dashboard file |
