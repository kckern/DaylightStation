import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Stack, Text, SimpleGrid, Card, Badge, Group,
} from '@mantine/core';
import { IconPlugConnected } from '@tabler/icons-react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { EmptyState, ErrorState, LoadingState, useRetryRegion } from '../../../lib/ui/index.js';

const CATEGORY_LABELS = {
  media: 'Media',
  gallery: 'Gallery',
  audiobooks: 'Audiobooks',
  ebooks: 'E-Books',
  home_automation: 'Home Automation',
  ai: 'AI',
  finance: 'Finance',
  messaging: 'Messaging',
};

const CATEGORY_ORDER = [
  'media', 'gallery', 'audiobooks', 'ebooks',
  'home_automation', 'ai', 'finance', 'messaging'
];

/**
 * Capitalize a provider name for display (e.g. "plex" -> "Plex").
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Truncate a URL for card display.
 */
function truncateUrl(url, maxLen = 40) {
  if (!url) return '';
  if (url.length <= maxLen) return url;
  return url.slice(0, maxLen) + '...';
}

function IntegrationsIndex() {
  const { data, loading, error, reload } = useApiResource('/api/v1/admin/integrations', { label: 'Integrations' });
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const integrations = data?.integrations || [];
  const ready = !loading && !error;

  // Group integrations by category, maintaining defined order
  const groupedIntegrations = useMemo(() => {
    const groups = {};
    integrations.forEach(integration => {
      const cat = integration.category || 'other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(integration);
    });

    // Return ordered groups, plus any categories not in the predefined list
    const ordered = CATEGORY_ORDER
      .filter(cat => groups[cat]?.length > 0)
      .map(cat => ({ category: cat, label: CATEGORY_LABELS[cat] || cat, items: groups[cat] }));

    // Add any unexpected categories at the end
    Object.keys(groups).forEach(cat => {
      if (!CATEGORY_ORDER.includes(cat)) {
        ordered.push({ category: cat, label: CATEGORY_LABELS[cat] || capitalize(cat), items: groups[cat] });
      }
    });

    return ordered;
  }, [integrations]);

  return (
    <Stack component="section" gap="lg" aria-label="Integrations" {...regionProps}>
      <Group justify="space-between" className="ds-page-header">
        <Text component="h1" className="ds-page-title">Integrations</Text>
      </Group>

      {loading && <LoadingState label="integrations" />}
      {!loading && error && <ErrorState error={error} onRetry={retry} label="Integrations" />}
      {ready && integrations.length === 0 && <EmptyState title="No integrations found." />}

      {ready && groupedIntegrations.map(group => (
        <Stack key={group.category} gap="xs">
          <Text size="sm" fw={600} c="dimmed" tt="uppercase">
            {group.label}
          </Text>

          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {group.items.map(integration => (
              <Card
                key={integration.provider}
                component={Link}
                to={`/admin/system/integrations/${encodeURIComponent(integration.provider)}`}
                withBorder
                padding="lg"
                style={{ color: 'inherit', textDecoration: 'none' }}
              >
                <Group justify="space-between" mb="xs">
                  <Group gap="sm">
                    <IconPlugConnected size={20} stroke={1.5} aria-hidden="true" />
                    <Text fw={500}>{capitalize(integration.provider)}</Text>
                  </Group>
                  <Badge size="sm" variant="light">
                    {CATEGORY_LABELS[integration.category] || integration.category}
                  </Badge>
                </Group>

                {integration.url && (
                  <Text size="xs" c="dimmed" mb="xs" lineClamp={1}>
                    {truncateUrl(integration.url)}
                  </Text>
                )}

                <Badge
                  color={integration.hasAuth ? 'green' : 'yellow'}
                  variant="light"
                  size="sm"
                >
                  {integration.hasAuth ? 'Configured' : 'No Auth'}
                </Badge>
              </Card>
            ))}
          </SimpleGrid>
        </Stack>
      ))}
    </Stack>
  );
}

export default IntegrationsIndex;
