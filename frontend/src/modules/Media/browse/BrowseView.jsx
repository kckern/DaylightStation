// frontend/src/modules/Media/browse/BrowseView.jsx
// Hierarchical catalog browse. Skeleton until the discovery phase wires the
// List API; the breadcrumb and nav contract are real already.
import React from 'react';
import { Breadcrumbs, Anchor, Text, Stack } from '@mantine/core';
import { useNav } from '../shell/NavProvider.jsx';

export function BrowseView({ path, label }) {
  const { replace, pop, depth } = useNav();
  const crumbLabel = label ?? (path ? String(path).split('/').filter(Boolean).join(' / ') : 'All');

  return (
    <Stack data-testid="browse-view" className="browse-view" gap="md">
      <Breadcrumbs aria-label="Breadcrumb">
        <Anchor component="button" data-testid="browse-crumb-home" onClick={() => replace('home', {})}>
          Home
        </Anchor>
        {depth > 1 && (
          <Anchor component="button" data-testid="browse-crumb-back" onClick={() => pop()}>
            ← Back
          </Anchor>
        )}
        <Text aria-current="page">{crumbLabel}</Text>
      </Breadcrumbs>
      <Text c="dimmed" data-testid="browse-placeholder">Catalog listing lands in the discovery phase.</Text>
    </Stack>
  );
}

export default BrowseView;
