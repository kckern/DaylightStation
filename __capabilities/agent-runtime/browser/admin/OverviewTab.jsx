// frontend/src/modules/Admin/Agents/OverviewTab.jsx

import React, { useState, useEffect, useCallback } from 'react';
import {
  Stack, Paper, Text, Group, Badge, Table, Button, Alert,
  Center, Loader, ActionIcon, Tooltip,
} from '@mantine/core';
import { IconPlayerPlay, IconTrash, IconAlertCircle } from '@tabler/icons-react';
import { useApiResource } from '../../../../frontend/src/lib/hooks/useApiResource.js';
import getLogger from "../../../../frontend/src/lib/logging/Logger.js";
import { triggerAssignment } from "./hooks/useAdminAgents.js";
import { useAgentMemory } from "./hooks/useAgentMemory.js";
import { ConfirmModal } from "../../../../frontend/src/lib/ui/ConfirmModal.jsx";
import { useSheetSubmission } from '../../../../frontend/src/lib/ui/useSheetSubmission.js';
import { ErrorState } from '../../../../frontend/src/lib/ui/states.jsx';

function OverviewTab({ agentId, userId }) {
  const assignments = useApiResource(agentId ? `/api/v1/agents/${encodeURIComponent(agentId)}/assignments` : null, {
    label: 'Agent assignments',
  });
  useEffect(() => {
    if (assignments.data) getLogger().child({ hook: 'useAdminAgents' }).info('admin.agents.assignments.fetched', {
      agentId, count: assignments.data.assignments?.length,
    });
  }, [agentId, assignments.data]);
  return <MemberOverview key={JSON.stringify([agentId, userId])} agentId={agentId} userId={userId} assignmentRead={assignments} />;
}

function MemberOverview({ agentId, userId, assignmentRead }) {
  const { entries, loading: memLoading, error: memError, deleteEntry, clearAll } = useAgentMemory(agentId, userId);
  const { data, loading: assLoading, error: assignmentError, reload: reloadAssignments } = assignmentRead;
  const assignments = data?.assignments || [];
  const [actionError, setActionError] = useState(null);
  const [dismissedError, setDismissedError] = useState(null);
  const [runningId, setRunningId] = useState(null);
  const [runResult, setRunResult] = useState(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const { run: submitClear, saving: clearing } = useSheetSubmission(() => setClearConfirmOpen(false), setActionError);

  const handleRunAssignment = useCallback(async (assignmentId) => {
    if (!userId) return;
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
  }, [agentId, userId]);

  const handleDeleteEntry = async key => {
    setActionError(null);
    try { await deleteEntry(key); }
    catch (error) { setActionError(error); }
  };

  const handleClearAll = () => submitClear(() => {
    setActionError(null);
    return clearAll();
  });

  const error = actionError || (memError !== dismissedError && memError);
  const onClearError = () => { setActionError(null); setDismissedError(memError); };
  const registration = assLoading
    ? { label: 'Checking registration', badge: 'Checking', color: 'gray' }
    : assignmentError?.status === 404
      ? { label: 'Agent not found', badge: 'Not found', color: 'red' }
      : assignmentError
        ? { label: 'Registration unavailable', badge: 'Unavailable', color: 'gray' }
        : data
          ? { label: 'Registered and active', badge: 'Active', color: 'green' }
          : { label: 'Registration not confirmed', badge: 'Unknown', color: 'gray' };

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
            <Text size="sm" c="dimmed">{registration.label}</Text>
          </div>
          <Badge color={registration.color} variant="light" size="lg">{registration.badge}</Badge>
        </Group>
      </Paper>

      {/* Assignments */}
      <Paper p="md">
        <Text size="sm" fw={600} tt="uppercase" c="dimmed" mb="sm" ff="var(--ds-font-mono)">
          Assignments
        </Text>

        {assLoading ? (
          <Center py="md"><Loader size="sm" /></Center>
        ) : assignmentError ? (
          <ErrorState
            error={assignmentError}
            label="Agent assignments"
            title={assignmentError.status === 404 ? 'Agent not found' : undefined}
            onRetry={reloadAssignments}
          />
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
                      disabled={!userId}
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
                          aria-label={`Delete memory entry ${key}`}
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
        loading={clearing}
      />
    </Stack>
  );
}

export default OverviewTab;
