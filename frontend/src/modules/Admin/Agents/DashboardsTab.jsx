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
import { ConfirmModal } from '../shared';

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

          {/* Raw JSON */}
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
