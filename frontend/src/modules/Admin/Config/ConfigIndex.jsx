import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stack, Text, Group, Paper, Center, Badge, UnstyledButton } from '@mantine/core';
import { IconFile, IconLock, IconFolder } from '@tabler/icons-react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { ErrorState, LoadingState, useRetryRegion } from '../../../lib/ui/index.js';
import { formatSize } from '../utils/formatters.js';

/**
 * Format an ISO date string into a short readable form.
 */
function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ConfigIndex() {
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApiResource('/api/v1/admin/config/files', { label: 'Config files' });
  const { regionProps, retry } = useRetryRegion(reload, loading);

  const grouped = useMemo(() => {
    const groups = {};
    (data?.files || []).forEach(file => {
      const dir = file.directory || 'other';
      if (!groups[dir]) {
        groups[dir] = [];
      }
      groups[dir].push(file);
    });
    return Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .map(dir => ({ directory: dir, files: groups[dir] }));
  }, [data]);

  return (
    <Stack component="section" gap="lg" aria-label="Config files" {...regionProps}>
      <Text component="h1" size="xl" fw={600}>Config Files</Text>

      {loading && <LoadingState label="config files" />}
      {!loading && error && <ErrorState error={error} onRetry={retry} label="Config files" />}
      {!loading && !error && grouped.map(group => (
        <Stack key={group.directory} gap="xs">
          <Group gap="xs">
            <IconFolder size={16} stroke={1.5} />
            <Text component="h2" size="sm" fw={600} c="dimmed" tt="uppercase">
              {group.directory}
            </Text>
          </Group>

          {group.files.map(file => {
            const isMasked = file.masked;

            const content = (
              <Paper
                key={file.path}
                p="sm"
                radius="sm"
                withBorder
                style={isMasked ? { opacity: 0.5 } : { cursor: 'pointer' }}
              >
                <Group justify="space-between" wrap="nowrap">
                  <Group gap="sm" wrap="nowrap" style={{ flex: 1, minWidth: 0 }}>
                    {isMasked ? (
                      <IconLock size={18} stroke={1.5} />
                    ) : (
                      <IconFile size={18} stroke={1.5} />
                    )}
                    <Text size="sm" fw={500} truncate>
                      {file.name}
                    </Text>
                    {isMasked && (
                      <Badge color="gray" variant="light" size="xs">Protected</Badge>
                    )}
                  </Group>
                  <Group gap="md" wrap="nowrap">
                    <Text size="xs" c="dimmed">{formatSize(file.size)}</Text>
                    <Text size="xs" c="dimmed">{formatDate(file.modified)}</Text>
                  </Group>
                </Group>
              </Paper>
            );

            if (isMasked) {
              return <div key={file.path}>{content}</div>;
            }

            return (
              <UnstyledButton
                key={file.path}
                onClick={() => navigate(`/admin/system/config/${file.path}`)}
              >
                {content}
              </UnstyledButton>
            );
          })}
        </Stack>
      ))}

      {!loading && !error && grouped.length === 0 && (
        <Center h="40vh">
          <Text c="dimmed">No config files found.</Text>
        </Center>
      )}
    </Stack>
  );
}

export default ConfigIndex;
