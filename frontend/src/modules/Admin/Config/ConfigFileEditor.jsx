import React from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stack, Text, Breadcrumbs, Anchor } from '@mantine/core';
import { IconArrowBack } from '@tabler/icons-react';
import ConfigFormWrapper from '../shared/ConfigFormWrapper.jsx';
import YamlEditor from '../shared/YamlEditor.jsx';

/**
 * ConfigFileEditor - Raw YAML editor for an arbitrary config file.
 *
 * Uses ConfigFormWrapper in rawMode so it inherits the shared save/revert
 * chrome, mod+s / mod+z hotkeys, and the unsaved-changes guard (audits C1/C5).
 */
function ConfigFileEditor() {
  const { '*': filePath } = useParams();
  const navigate = useNavigate();

  const breadcrumbSegments = filePath ? filePath.split('/') : [];
  const fileName = breadcrumbSegments[breadcrumbSegments.length - 1] || filePath;

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

      {filePath && (
        <ConfigFormWrapper filePath={filePath} title={fileName} rawMode>
          {({ raw, setRaw, error }) => (
            <YamlEditor
              value={raw}
              onChange={setRaw}
              error={error?.mark ? error : null}
            />
          )}
        </ConfigFormWrapper>
      )}
    </Stack>
  );
}

export default ConfigFileEditor;
