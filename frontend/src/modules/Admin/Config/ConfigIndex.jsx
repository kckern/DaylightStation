import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Stack, Text, Group, Paper, Loader, Center, Alert, Badge, UnstyledButton } from '@mantine/core';
import { IconFile, IconLock, IconAlertCircle, IconFolder } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';

/**
 * Format bytes into a human-readable string.
 */
function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
  const [files, setFiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function fetchFiles() {
      setLoading(true);
      setError(null);
      try {
        const result = await DaylightAPI('/api/v1/admin/config/files');
        if (!cancelled) {
          setFiles(result.files || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    fetchFiles();
    return () => { cancelled = true; };
  }, []);

  const grouped = useMemo(() => {
    const groups = {};
    files.forEach(file => {
      const dir = file.directory || 'other';
      if (!groups[dir]) {
        groups[dir] = [];
      }
      groups[dir].push(file);
    });
    return Object.keys(groups)
      .sort((a, b) => a.localeCompare(b))
      .map(dir => ({ directory: dir, files: groups[dir] }));
  }, [files]);

  if (loading) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error loading config files">
        {error.message || 'Failed to load config file list'}
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Text size="xl" fw={600}>Config Files</Text>

      {grouped.map(group => (
        <Stack key={group.directory} gap="xs">
          <Group gap="xs">
            <IconFolder size={16} stroke={1.5} />
            <Text size="sm" fw={600} c="dimmed" tt="uppercase">
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

      {files.length === 0 && (
        <Center h="40vh">
          <Text c="dimmed">No config files found.</Text>
        </Center>
      )}
    </Stack>
  );
}

export default ConfigIndex;
