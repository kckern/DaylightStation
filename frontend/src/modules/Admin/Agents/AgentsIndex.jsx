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
