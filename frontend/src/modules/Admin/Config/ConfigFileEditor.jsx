import React, { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stack, Group, Button, Text, Alert, Center, Loader, Badge, Breadcrumbs, Anchor } from '@mantine/core';
import { IconArrowBack, IconDeviceFloppy, IconAlertCircle } from '@tabler/icons-react';
import { useAdminConfig } from '../../../hooks/admin/useAdminConfig.js';
import YamlEditor from '../shared/YamlEditor.jsx';

function ConfigFileEditor() {
  const { '*': filePath } = useParams();
  const navigate = useNavigate();
  const { raw, loading, saving, error, dirty, load, save, revert, setRaw, clearError } = useAdminConfig(filePath);

  useEffect(() => {
    if (filePath) {
      load().catch(() => {});
    }
  }, [filePath, load]);

  const breadcrumbSegments = filePath ? filePath.split('/') : [];

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
      <Breadcrumbs>
        {breadcrumbSegments.map((segment, i) => {
          const isLast = i === breadcrumbSegments.length - 1;
          return isLast ? (
            <Text key={i} size="sm" fw={500}>{segment}</Text>
          ) : (
            <Text key={i} size="sm" c="dimmed">{segment}</Text>
          );
        })}
      </Breadcrumbs>

      <Anchor
        size="sm"
        onClick={() => navigate('/admin/system/config')}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <IconArrowBack size={14} /> Back to Config
      </Anchor>

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

export default ConfigFileEditor;
