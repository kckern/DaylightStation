import React from 'react';
import { useParams } from 'react-router-dom';
import { Alert } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import ConfigFormWrapper from '../shared/ConfigFormWrapper.jsx';
import YamlEditor from '../shared/YamlEditor.jsx';
import FitnessConfig from './FitnessConfig.jsx';
import GratitudeConfig from './GratitudeConfig.jsx';
import ShoppingConfig from './ShoppingConfig.jsx';
import FinanceConfig from './FinanceConfig.jsx';
import { capitalize } from '../utils/formatters.js';

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
 * YamlFallbackEditor - Generic YAML editor for app configs
 * that don't have a purpose-built form yet.
 *
 * Uses ConfigFormWrapper in rawMode so it inherits the shared save/revert
 * chrome, mod+s / mod+z hotkeys, and the unsaved-changes guard (audit C5).
 */
function YamlFallbackEditor({ appId, configPath }) {
  return (
    <ConfigFormWrapper filePath={configPath} title={`${capitalize(appId)} Config`} rawMode>
      {({ raw, setRaw, error }) => (
        <YamlEditor
          value={raw}
          onChange={setRaw}
          error={error?.mark ? error : null}
        />
      )}
    </ConfigFormWrapper>
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
