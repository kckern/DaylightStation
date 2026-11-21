// frontend/src/modules/Admin/Agents/AgentsIndex.jsx

import React from 'react';
import { Link } from 'react-router-dom';
import { SimpleGrid, Paper, Text, Group, Badge, Stack } from '@mantine/core';
import { EmptyState, ErrorState, LoadingState } from '../../../../frontend/src/lib/ui/index.js';
import { useAdminAgents } from "./hooks/useAdminAgents.js";

function AgentsIndex() {
  const { agents, loading, error, reload } = useAdminAgents();
  const ready = !loading && !error;

  return (
    <Stack p="md" gap="md">
      <Text component="h1" size="xl" fw={600} ff="var(--ds-font-mono)">Agents</Text>

      {loading && <LoadingState label="agents" />}
      {!loading && error && <ErrorState error={error} onRetry={reload} label="Agents" />}
      {ready && agents.length === 0 && <EmptyState title="No agents registered" />}
      {ready && agents.length > 0 && <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
        {agents.map(agent => (
          <Paper
            key={agent.id}
            component={Link}
            to={`/admin/agents/${encodeURIComponent(agent.id)}`}
            p="lg"
            radius="md"
            style={{ color: 'inherit', textDecoration: 'none' }}
          >
            <Group justify="space-between" mb="xs">
              <Text size="lg" fw={600} ff="var(--ds-font-mono)">{agent.id}</Text>
              <Badge color="green" variant="light" size="sm">registered</Badge>
            </Group>
            <Text size="sm" c="dimmed">{agent.description || 'No description'}</Text>
          </Paper>
        ))}
      </SimpleGrid>}
    </Stack>
  );
}

export default AgentsIndex;
