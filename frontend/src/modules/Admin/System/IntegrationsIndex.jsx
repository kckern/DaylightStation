import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stack, Text, SimpleGrid, Card, Badge, Group, Loader, Center, Alert
} from '@mantine/core';
import { IconAlertCircle, IconPlugConnected } from '@tabler/icons-react';
import { useAdminIntegrations } from '../../../hooks/admin/useAdminIntegrations.js';

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
  const navigate = useNavigate();
  const { integrations, loading, error, fetchIntegrations, clearError } = useAdminIntegrations();

  useEffect(() => {
    fetchIntegrations().catch(() => {});
  }, [fetchIntegrations]);

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

  if (loading && integrations.length === 0) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between" className="ds-page-header">
        <span className="ds-page-title">Integrations</span>
      </Group>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Error"
          withCloseButton
          onClose={clearError}
        >
          {error.message || 'Failed to load integrations'}
        </Alert>
      )}

      {groupedIntegrations.map(group => (
        <Stack key={group.category} gap="xs">
          <Text size="sm" fw={600} c="dimmed" tt="uppercase">
            {group.label}
          </Text>

          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
            {group.items.map(integration => (
              <Card
                key={integration.provider}
                withBorder
                padding="lg"
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(`/admin/system/integrations/${integration.provider}`)}
              >
                <Group justify="space-between" mb="xs">
                  <Group gap="sm">
                    <IconPlugConnected size={20} stroke={1.5} />
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

      {integrations.length === 0 && !loading && (
        <Center h="40vh">
          <Stack align="center">
            <IconPlugConnected size={48} stroke={1} color="gray" />
            <Text c="dimmed">No integrations found.</Text>
          </Stack>
        </Center>
      )}
    </Stack>
  );
}

export default IntegrationsIndex;
