// frontend/src/modules/Admin/Agents/OverviewTab.jsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Paper, Text, Group, Badge, Table, Button, Alert,
  Center, Loader, ActionIcon, Tooltip,
} from '@mantine/core';
import { IconPlayerPlay, IconTrash, IconAlertCircle } from '@tabler/icons-react';
import { useAdminAgents } from '../../../hooks/admin/useAdminAgents.js';
import { useAgentMemory } from '../../../hooks/admin/useAgentMemory.js';
import { ConfirmModal } from '../shared';

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
      await triggerAssignment(agentId, assignmentId, userId);
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
                    <Text size="sm">{a.description || '\u2014'}</Text>
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
