import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Stack, Group, Text, Badge, Button, Paper, Alert, Center, Loader, Anchor }  from '@mantine/core';
import {
  IconArrowBack, IconPlugConnected, IconAlertCircle, IconCheck, IconX, IconRefresh
} from '@tabler/icons-react';
import { useAdminIntegrations } from '../../../hooks/admin/useAdminIntegrations.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { useRetryRegion } from '../../../lib/ui/useRetryRegion.js';
import { notifySuccess, notifyFailure } from '../shared/feedback.js';

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
 * Providers that can be re-authorized from here. The link starts a full-page
 * OAuth redirect handled by the backend (/api/v1/admin/oauth/...).
 */
const RECONNECT_LINKS = {
  withings: { href: '/api/v1/admin/oauth/withings/connect', label: 'Reconnect Withings' },
};

function ReconnectButton({ provider }) {
  const link = RECONNECT_LINKS[provider];
  if (!link) return null;
  return (
    <Button component="a" href={link.href} variant="light">
      {link.label}
    </Button>
  );
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
  return <ProviderDetail key={provider} provider={provider} />;
}

function ProviderDetail({ provider }) {
  const { testConnection, error, clearError } = useAdminIntegrations();
  const { data, loading, error: loadError, reload } = useApiResource(`/api/v1/admin/integrations/${provider}`);
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const integration = data?.integration;
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const isActiveView = useRef(true);

  useEffect(() => {
    isActiveView.current = true;
    return () => { isActiveView.current = false; };
  }, []);

  const handleTestConnection = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testConnection(provider);
      if (!isActiveView.current) return;
      setTestResult(result);
      if (result?.status === 'success') {
        notifySuccess({
          title: 'Connection OK',
          message: `${provider}: ${result?.message ?? 'reachable'}`,
        });
      } else {
        notifyFailure({
          title: 'Connection failed',
          message: `${provider}: ${result?.message ?? 'unknown failure'}`,
        });
      }
    } catch (err) {
      if (!isActiveView.current) return;
      setTestResult({
        status: 'failed',
        message: err.message || 'Connection test failed',
        timestamp: new Date().toISOString()
      });
      notifyFailure({ title: 'Connection failed', message: err.message });
    } finally {
      if (isActiveView.current) setTesting(false);
    }
  }, [provider, testConnection]);

  let body;
  if (loading && !integration) {
    body = (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  } else if (loadError && !integration) {
    body = (
      <>
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {loadError.message || 'Failed to load integration details'}
        </Alert>
        <Button onClick={retry}>Retry</Button>
        {/* Harvester-only providers (e.g. Withings) may not be listed in
            integrations.yml; keep the reconnect reachable anyway. */}
        <Group><ReconnectButton provider={provider} /></Group>
      </>
    );
  } else if (integration) {
    const categoryLabel = CATEGORY_LABELS[integration.category] || integration.category;
    body = (
      <>
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
          <Group gap="sm">
            <Button
              leftSection={<IconRefresh size={16} />}
              variant="light"
              onClick={handleTestConnection}
              loading={testing}
            >
              Test Connection
            </Button>
            <ReconnectButton provider={provider} />
          </Group>

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
      </>
    );
  }

  return (
    <Stack component="section" gap="md" aria-label="Integration details" {...regionProps}>
      <Anchor
        component={Link}
        to="/admin/system/integrations"
        size="sm"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <IconArrowBack size={14} aria-hidden="true" /> Back to Integrations
      </Anchor>
      {body}
    </Stack>
  );
}

export default IntegrationDetail;
