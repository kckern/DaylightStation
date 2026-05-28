import React, { useState } from 'react';
import { Stack, Text } from '@mantine/core';
import ContentSearchCombobox from '../../ContentLists/ContentSearchCombobox';
import { titleCache } from '../utils/titleCache.js';
import { useContentTitle } from '../hooks/useContentTitle.js';

export function LabeledContentPicker({ value, onChange, placeholder, ...rest }) {
  // Local override for dropdown picks (no-flicker path). Cleared on freeform
  // commit so the hook re-resolves via /api/v1/info/:source/:id.
  const [localTitle, setLocalTitle] = useState(null);
  const resolvedTitle = useContentTitle(value);
  const title = localTitle ?? resolvedTitle;

  return (
    <Stack gap={4}>
      {title && <Text size="sm" c="dimmed">{title}</Text>}
      <ContentSearchCombobox
        value={value}
        placeholder={placeholder}
        onChange={(id, item) => {
          if (item?.title) {
            titleCache.set(id, item.title);
            setLocalTitle(item.title);
          } else {
            setLocalTitle(null);
          }
          onChange(id, item);
        }}
        {...rest}
      />
    </Stack>
  );
}

export default LabeledContentPicker;
