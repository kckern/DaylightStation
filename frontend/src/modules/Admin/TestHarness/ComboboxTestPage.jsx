// frontend/src/modules/Admin/TestHarness/ComboboxTestPage.jsx
/**
 * Isolated test page for the unified ContentCombobox
 * Mounts component with controllable props via URL params
 *
 * URL params:
 * - value: Initial content ID (e.g., plex:12345)
 * - placeholder: Input placeholder text
 * - mock: API mock mode (none, error, empty, slow)
 * - selectContainers: '1'/'true' to make container rows commit (dual-affordance browse chevron)
 * - searchParams: extra query string forwarded to the search endpoint
 */
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Stack, Paper, Text, Code, Group, Badge, Title, Divider } from '@mantine/core';
import ContentCombobox from '../../Content/combobox/ContentCombobox.jsx';

function ComboboxTestPage() {
  const [searchParams] = useSearchParams();
  const initialValue = searchParams.get('value') || '';
  const placeholder = searchParams.get('placeholder') || 'Search content...';
  const selectContainers = ['1', 'true'].includes(searchParams.get('selectContainers'));
  const extraSearchParams = searchParams.get('searchParams') || '';

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
      <Title order={2}>ContentCombobox Test Harness</Title>

      <Paper p="md" withBorder>
        <Text size="sm" c="dimmed" mb="md">Component Under Test</Text>
        <ContentCombobox
          value={value}
          onChange={handleChange}
          placeholder={placeholder}
          selectContainers={selectContainers}
          searchParams={extraSearchParams}
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
