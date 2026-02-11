import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Stack, Group, Text, Badge, Button, Paper, Alert, Center, Loader,
  Divider, Anchor, Code
} from '@mantine/core';
import {
  IconArrowBack, IconPlugConnected, IconAlertCircle, IconCheck, IconX, IconRefresh
} from '@tabler/icons-react';
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

/**
 * Capitalize a provider name for display.
 */
function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Display row with label and value.
 */
function InfoRow({ label, children }) {
  return (
    <Group gap="md" wrap="nowrap" align="flex-start">
      <Text size="sm" c="dimmed" w={120} style={{ flexShrink: 0 }}>{label}</Text>
      <div>{children}</div>
    </Group>
  );
}

function IntegrationDetail() {
  const { provider } = useParams();
  const navigate = useNavigate();
  const { fetchDetail, testConnection, error, clearError } = useAdminIntegrations();

  const [integration, setIntegration] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await fetchDetail(provider);
      setIntegration(result);
    } catch (err) {
      setLoadError(err.message || 'Failed to load integration details');
    } finally {
      setLoading(false);
    }
  }, [provider, fetchDetail]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(provider);
      setTestResult(result);
    } catch (err) {
      setTestResult({
        status: 'failed',
        message: err.message || 'Connection test failed',
        timestamp: new Date().toISOString()
      });
    } finally {
      setTesting(false);
    }
  }, [provider, testConnection]);

  // Loading state
  if (loading && !integration) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  // Error / 404 state
  if (loadError && !integration) {
    return (
      <Stack gap="md">
        <Anchor
          size="sm"
          onClick={() => navigate('/admin/system/integrations')}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <IconArrowBack size={14} /> Back to Integrations
        </Anchor>
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {loadError}
        </Alert>
      </Stack>
    );
  }

  if (!integration) return null;

  const categoryLabel = CATEGORY_LABELS[integration.category] || integration.category;

  return (
    <Stack gap="md">
      {/* Header */}
      <Anchor
        size="sm"
        onClick={() => navigate('/admin/system/integrations')}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <IconArrowBack size={14} /> Back to Integrations
      </Anchor>

      <Group gap="sm">
        <IconPlugConnected size={24} stroke={1.5} />
        <Text size="xl" fw={700}>{capitalize(provider)}</Text>
        <Badge variant="light">{categoryLabel}</Badge>
      </Group>

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

      {/* Service Info */}
      <Paper withBorder p="md">
        <Text size="sm" fw={600} mb="sm">Service Info</Text>
        <Stack gap="xs">
          <InfoRow label="Provider">
            <Text size="sm">{capitalize(integration.provider)}</Text>
          </InfoRow>
          <InfoRow label="Category">
            <Text size="sm">{categoryLabel}</Text>
          </InfoRow>
          <InfoRow label="URL">
            {integration.url ? (
              <Anchor href={integration.url} target="_blank" rel="noopener noreferrer" size="sm">
                {integration.url}
              </Anchor>
            ) : (
              <Text size="sm" c="dimmed">Not configured</Text>
            )}
          </InfoRow>
        </Stack>
      </Paper>

      {/* Auth Status */}
      <Paper withBorder p="md">
        <Text size="sm" fw={600} mb="sm">Auth Status</Text>
        <Stack gap="xs">
          <InfoRow label="Configured">
            <Badge
              color={integration.hasAuth ? 'green' : 'yellow'}
              variant="light"
            >
              {integration.hasAuth ? 'Configured' : 'No Auth'}
            </Badge>
          </InfoRow>
          {integration.authLocations && (
            <>
              <InfoRow label="Household">
                <Group gap="xs">
                  {integration.authLocations.household ? (
                    <><IconCheck size={14} color="green" /><Text size="sm" c="green">Present</Text></>
                  ) : (
                    <><IconX size={14} color="red" /><Text size="sm" c="red">Missing</Text></>
                  )}
                </Group>
              </InfoRow>
              <InfoRow label="System">
                <Group gap="xs">
                  {integration.authLocations.system ? (
                    <><IconCheck size={14} color="green" /><Text size="sm" c="green">Present</Text></>
                  ) : (
                    <><IconX size={14} color="red" /><Text size="sm" c="red">Missing</Text></>
                  )}
                </Group>
              </InfoRow>
            </>
          )}
        </Stack>
      </Paper>

      {/* Test Connection */}
      <Paper withBorder p="md">
        <Text size="sm" fw={600} mb="sm">Test Connection</Text>
        <Button
          leftSection={<IconRefresh size={16} />}
          variant="light"
          onClick={handleTestConnection}
          loading={testing}
        >
          Test Connection
        </Button>

        {testResult && (
          <Paper withBorder p="md" mt="md">
            <Group gap="sm">
              <Badge
                color={
                  testResult.status === 'success' ? 'green'
                    : testResult.status === 'failed' ? 'red'
                      : 'gray'
                }
              >
                {testResult.status}
              </Badge>
              <Text size="sm">{testResult.message}</Text>
            </Group>
            {testResult.timestamp && (
              <Text size="xs" c="dimmed" mt="xs">{testResult.timestamp}</Text>
            )}
          </Paper>
        )}
      </Paper>
    </Stack>
  );
}

export default IntegrationDetail;
