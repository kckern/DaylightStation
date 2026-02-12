import React, { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { Stack, Group, Text, Button, Badge, Alert, Center, Loader } from '@mantine/core';
import { IconDeviceFloppy, IconArrowBack, IconAlertCircle } from '@tabler/icons-react';
import { useAdminConfig } from '../../../hooks/admin/useAdminConfig.js';
import YamlEditor from '../shared/YamlEditor.jsx';
import FitnessConfig from './FitnessConfig.jsx';
import GratitudeConfig from './GratitudeConfig.jsx';
import ShoppingConfig from './ShoppingConfig.jsx';
import FinanceConfig from './FinanceConfig.jsx';

/**
 * Maps appId to config file path relative to data root.
 */
const APP_CONFIG_PATHS = {
  fitness: 'household/config/fitness.yml',
  finance: 'household/config/finance.yml',
  gratitude: 'household/config/gratitude.yml',
  shopping: 'household/config/harvesters.yml',
};

/**
 * Registry for purpose-built editor components.
 * When a form component is created for an app, add it here
 * and it will be rendered instead of the YAML fallback.
 */
const APP_EDITORS = {
  fitness: FitnessConfig,
  gratitude: GratitudeConfig,
  shopping: ShoppingConfig,
  finance: FinanceConfig,
};

/**
 * Capitalize the first letter of a string.
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * YamlFallbackEditor - Generic YAML editor for app configs
 * that don't have a purpose-built form yet.
 *
 * Same pattern as ConfigFileEditor but scoped to app configs.
 */
function YamlFallbackEditor({ appId, configPath }) {
  const { raw, loading, saving, error, dirty, load, save, revert, setRaw, clearError } = useAdminConfig(configPath);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const handleSave = async () => {
    try {
      await save({ useRaw: true });
    } catch (_) {
      // error state handled by the hook
    }
  };

  if (loading && !raw) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <Text size="lg" fw={600}>{capitalize(appId)} Config</Text>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Error"
          withCloseButton
          onClose={clearError}
        >
          {error.message || 'An error occurred'}
        </Alert>
      )}

      <Group gap="sm">
        {dirty && (
          <Badge color="yellow" variant="light">Unsaved changes</Badge>
        )}
        <Button
          variant="default"
          size="xs"
          disabled={!dirty}
          onClick={revert}
        >
          Revert
        </Button>
        <Button
          leftSection={<IconDeviceFloppy size={14} />}
          size="xs"
          disabled={!dirty}
          loading={saving}
          onClick={handleSave}
        >
          Save
        </Button>
      </Group>

      <YamlEditor
        value={raw}
        onChange={setRaw}
        error={error?.mark ? error : null}
      />
    </Stack>
  );
}

/**
 * AppConfigEditor - Router component for app configuration editing.
 *
 * Reads `appId` from URL params and either renders a purpose-built
 * editor (if one exists in APP_EDITORS) or falls back to the generic
 * YAML editor using useAdminConfig + YamlEditor.
 */
function AppConfigEditor() {
  const { appId } = useParams();

  // Check if a purpose-built editor exists
  const Editor = APP_EDITORS[appId];
  if (Editor) {
    return <Editor />;
  }

  // Fallback to YAML editor
  const configPath = APP_CONFIG_PATHS[appId];
  if (!configPath) {
    return (
      <Alert
        icon={<IconAlertCircle size={16} />}
        color="red"
        title="Unknown App"
      >
        Unknown app: {appId}
      </Alert>
    );
  }

  return <YamlFallbackEditor appId={appId} configPath={configPath} />;
}

export default AppConfigEditor;
