import React, { useEffect } from 'react';
import {
  Stack, Group, Button, Alert, Center, Loader, Badge, Text, Divider
} from '@mantine/core';
import { IconAlertCircle, IconDeviceFloppy, IconArrowBack } from '@tabler/icons-react';
import { useHotkeys } from '@mantine/hooks';
import { useAdminConfig } from '../../../hooks/admin/useAdminConfig.js';

/**
 * Wraps a config form with standard load/save/revert/dirty-state chrome.
 *
 * Props:
 *   filePath    - YAML file path relative to data root (e.g. 'household/config/fitness.yml')
 *   title       - Page title
 *   children    - Render function: ({ data, setData }) => JSX
 *                 Receives the parsed config object and a setter.
 *                 The setter accepts a new object or an updater function: setData(prev => ({...prev, ...}))
 *   validate    - Optional (data) => string|null - return error message or null
 */
function ConfigFormWrapper({ filePath, title, children, validate }) {
  const {
    data, loading, saving, error, dirty,
    load, save, revert, setData, clearError
  } = useAdminConfig(filePath);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    if (validate) {
      const validationError = validate(data);
      if (validationError) return;
    }
    await save();
  };

  useHotkeys([
    ['mod+s', (e) => {
      e.preventDefault();
      if (dirty && !saving) handleSave();
    }],
    ['mod+z', (e) => {
      e.preventDefault();
      if (dirty && !saving) revert();
    }],
  ]);

  if (loading && !data) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Group
        justify="space-between"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          backgroundColor: 'var(--ds-bg-surface)',
          padding: 'var(--ds-space-4) 0',
          marginBottom: 'var(--ds-space-4)',
          borderBottom: dirty ? '1px solid var(--ds-border)' : '1px solid transparent',
          transition: 'border-color var(--ds-transition-base)',
        }}
      >
        <Group gap="xs">
          <Text fw={600} size="lg" ff="var(--ds-font-mono)">{title}</Text>
          {dirty && (
            <Badge color="yellow" variant="light" size="sm">
              Unsaved
            </Badge>
          )}
        </Group>
        <Group gap="xs">
          <Button
            variant="subtle"
            leftSection={<IconArrowBack size={16} />}
            onClick={revert}
            disabled={!dirty || saving}
            size="sm"
          >
            Revert
          </Button>
          <Button
            leftSection={<IconDeviceFloppy size={16} />}
            onClick={handleSave}
            loading={saving}
            disabled={!dirty}
            size="sm"
            data-testid="config-save-button"
          >
            Save
          </Button>
        </Group>
      </Group>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          withCloseButton
          onClose={clearError}
        >
          {error.message || 'An error occurred'}
        </Alert>
      )}

      <Divider />

      {data !== null && children({ data, setData })}
    </Stack>
  );
}

export default ConfigFormWrapper;
