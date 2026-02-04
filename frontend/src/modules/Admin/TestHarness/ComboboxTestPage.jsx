// frontend/src/modules/Admin/TestHarness/ComboboxTestPage.jsx
/**
 * Isolated test page for ContentSearchCombobox
 * Mounts component with controllable props via URL params
 *
 * URL params:
 * - value: Initial content ID (e.g., plex:12345)
 * - placeholder: Input placeholder text
 * - mock: API mock mode (none, error, empty, slow)
 */
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Paper, Text, Code, Group, Badge, Title, Divider } from '@mantine/core';
import ContentSearchCombobox from '../ContentLists/ContentSearchCombobox.jsx';

function ComboboxTestPage() {
  const [searchParams] = useSearchParams();
  const initialValue = searchParams.get('value') || '';
  const placeholder = searchParams.get('placeholder') || 'Search content...';

  const [value, setValue] = useState(initialValue);
  const [changeLog, setChangeLog] = useState([]);

  // Log all onChange calls for test assertion
  const handleChange = (newValue) => {
    const entry = {
      timestamp: Date.now(),
      from: value,
      to: newValue,
    };
    setChangeLog(prev => [...prev, entry]);
    setValue(newValue);
  };

  // Reset when URL params change
  useEffect(() => {
    setValue(initialValue);
    setChangeLog([]);
  }, [initialValue]);

  return (
    <Stack p="xl" maw={800} mx="auto">
      <Title order={2}>ContentSearchCombobox Test Harness</Title>

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="md">Component Under Test</Text>
        <ContentSearchCombobox
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
        />
      </Paper>

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="xs">Current Value</Text>
        <Code block data-testid="current-value">{value || '(empty)'}</Code>
      </Paper>

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="xs">Change Log</Text>
        <Stack gap="xs" data-testid="change-log">
          {changeLog.length === 0 ? (
            <Text size="sm" c="dimmed">No changes yet</Text>
          ) : (
            changeLog.map((entry, i) => (
              <Group key={i} gap="xs">
                <Badge size="xs" variant="light">{i + 1}</Badge>
                <Code>{entry.from || '(empty)'}</Code>
                <Text size="sm">→</Text>
                <Code>{entry.to}</Code>
              </Group>
            ))
          )}
        </Stack>
      </Paper>

      <Divider />

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="xs">Test Parameters</Text>
        <Stack gap="xs">
          <Group gap="xs">
            <Badge variant="outline">value</Badge>
            <Code>{initialValue || '(none)'}</Code>
          </Group>
          <Group gap="xs">
            <Badge variant="outline">placeholder</Badge>
            <Code>{placeholder}</Code>
          </Group>
        </Stack>
      </Paper>
    </Stack>
  );
}

export default ComboboxTestPage;
