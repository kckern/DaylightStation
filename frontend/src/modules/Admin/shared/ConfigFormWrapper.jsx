import React from 'react';
import { Stack, Alert, Center, Loader, Button, Group, Anchor } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useAdminConfig } from '../../../hooks/admin/useAdminConfig.js';
import { useRetryRegion } from '../../../lib/ui/useRetryRegion.js';
import { StateMessage } from '../../../lib/ui/states.jsx';
import { useUnsavedGuard } from './useUnsavedGuard.js';
import GuardedLink from './GuardedLink.jsx';
import SaveBar from './SaveBar.jsx';

/**
 * Wraps a config form with standard load/save/revert/dirty-state chrome.
 *
 * Props:
 *   filePath    - YAML file path relative to data root (e.g. 'household/fitness/config.yml')
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
    data, raw, loading, saving, error, readError, draftReady, dirty,
    save, revert, setData, setRaw, clearError, retryRead, discardDraft
  } = useAdminConfig(filePath, rawMode ? 'raw' : 'parsed');
  const hasStructuredData = data !== null && typeof data === 'object' && !Array.isArray(data);
  const hasEditor = rawMode ? draftReady : hasStructuredData;
  const { regionProps, retry } = useRetryRegion(retryRead, loading);
  const structuredFormUnavailable = !rawMode && draftReady && !loading && !readError && !hasStructuredData;

  // Unsaved-changes guard: beforeunload + guarded Admin navigation (audit C1)
  useUnsavedGuard(dirty, { label: filePath, onDiscard: discardDraft });

  const handleSave = async () => {
    if (loading || saving) return;
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

  return (
    <Stack component="section" gap="md" aria-label={`${title} editor`} {...regionProps}>
      {loading && !hasEditor ? (
        <Center h="60vh">
          <Loader size="lg" />
        </Center>
      ) : (
        <>
          <SaveBar
            title={title}
            dirty={dirty}
            saving={saving}
            disabled={loading}
            onSave={handleSave}
            onRevert={revert}
            headerExtra={headerExtra}
          />

          {error && (
            <Alert
              icon={<IconAlertCircle size={16} />}
              color="red"
              withCloseButton={error !== readError || hasEditor}
              onClose={clearError}
            >
              <Group justify="space-between" align="center" wrap="nowrap">
                <span>{error.message || 'An error occurred'}</span>
                {error === readError && <Button size="xs" variant="light" onClick={retry} disabled={saving}>Retry</Button>}
              </Group>
            </Alert>
          )}

          <div className="ds-config-body">
            {hasEditor && children({ data, setData, raw, setRaw, error })}
            {structuredFormUnavailable && (
              <StateMessage
                state="empty"
                title="This file can't be displayed as a form"
                detail="Open it in the YAML editor to view or repair its contents."
              >
                <Anchor component={GuardedLink} to={`/admin/system/config/${filePath}`}>
                  Open YAML editor
                </Anchor>
              </StateMessage>
            )}
          </div>
        </>
      )}
    </Stack>
  );
}

export default ConfigFormWrapper;
