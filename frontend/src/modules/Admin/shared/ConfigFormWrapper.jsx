import React, { useEffect } from 'react';
import { Stack, Alert, Center, Loader } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useHotkeys } from '@mantine/hooks';
import { useAdminConfig } from '../../../hooks/admin/useAdminConfig.js';
import { useUnsavedGuard } from './useUnsavedGuard.js';
import SaveBar from './SaveBar.jsx';

/**
 * Wraps a config form with standard load/save/revert/dirty-state chrome.
 *
 * Props:
 *   filePath    - YAML file path relative to data root (e.g. 'household/config/fitness.yml')
 *   title       - Page title
 *   children    - Render function: ({ data, setData, raw, setRaw, error }) => JSX
 *                 Receives the parsed config object and a setter.
 *                 The setter accepts a new object or an updater function: setData(prev => ({...prev, ...}))
 *                 In rawMode, edit via raw/setRaw instead.
 *   validate    - Optional (data) => string|null - return error message or null (parsed mode only)
 *   rawMode     - Edit/save the raw YAML string instead of the parsed object
 *   headerExtra - Optional node rendered in the action bar, before Revert/Save
 */
function ConfigFormWrapper({ filePath, title, children, validate, rawMode = false, headerExtra }) {
  const {
    data, raw, loading, saving, error, dirty,
    load, save, revert, setData, setRaw, clearError
  } = useAdminConfig(filePath);

  useEffect(() => {
    load().catch(() => { /* error state handled by the hook */ });
  }, [load]);

  // Unsaved-changes guard: beforeunload + AdminNav interception (audit C1)
  useUnsavedGuard(dirty, { label: filePath });

  const handleSave = async () => {
    if (!rawMode && validate) {
      const validationError = validate(data);
      if (validationError) return;
    }
    try {
      await save({ useRaw: rawMode });
    } catch (_) {
      // error state handled by the hook
    }
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

  if (loading && (rawMode ? !raw : !data)) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Stack gap="md">
      <SaveBar
        title={title}
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onRevert={revert}
        headerExtra={headerExtra}
      />

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

      <div className="ds-config-body">
        {rawMode
          ? children({ data, setData, raw, setRaw, error })
          : data !== null && children({ data, setData, raw, setRaw, error })}
      </div>
    </Stack>
  );
}

export default ConfigFormWrapper;
