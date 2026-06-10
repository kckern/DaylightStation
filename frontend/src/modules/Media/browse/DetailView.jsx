// frontend/src/modules/Media/browse/DetailView.jsx
// Item detail. Skeleton until the discovery phase wires the Info API.
import React from 'react';
import { Stack, Title, Text } from '@mantine/core';

export function DetailView({ contentId }) {
  return (
    <Stack data-testid="detail-view" className="detail-view" gap="md">
      <Title order={1}>Detail</Title>
      <Text c="dimmed" data-testid="detail-placeholder">
        Item detail lands in the discovery phase.{contentId ? '' : ' No item selected.'}
      </Text>
    </Stack>
  );
}

export default DetailView;
