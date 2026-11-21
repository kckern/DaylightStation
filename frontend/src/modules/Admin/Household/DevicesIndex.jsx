import React, { useCallback, useEffect, useState } from 'react';
import { FormDialog } from '@/lib/ui/FormDialog.jsx';
import { Link } from 'react-router-dom';
import {
  Stack, Text, SimpleGrid, Card, Badge, Button, Group, Anchor,
  TextInput, Select, Alert
} from '@mantine/core';
import { IconPlus, IconAlertCircle } from '@tabler/icons-react';
import {EnforcementStatus} from '../../../../../__app_modules/household/supervision/browser/index.js';
import { useVisibleRefresh } from '../../../lib/hooks/useVisibleRefresh.js';
import { useAdminRoster } from '../shared/useAdminRoster.js';
import { useRefreshableRead } from '../../../lib/hooks/useRefreshableRead.js';
import { DaylightAPI } from '../../../lib/api.mjs';

import { EmptyState, ErrorState, LoadingState } from '../../../lib/ui/states.jsx';
import { useRetryRegion } from '../../../lib/ui/useRetryRegion.js';
import { DEVICE_TYPES, deviceTypeBadgeColor } from '../utils/constants.js';

const DEVICES_PATH = '/api/v1/admin/household/devices';

function DevicesIndex() {
  const [shutdown,setShutdown]=useState(null),[enforcementNow,setEnforcementNow]=useState(()=>Date.now());
  const { data, loading, error, reload, invalidateAfterWrite } = useAdminRoster(DEVICES_PATH, { retryTransient: true });
  const { regionProps, retry } = useRetryRegion(reload, loading);
  const devices = data?.devices || [];

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ id: '', type: 'shield-tv' });
  const [createErrors, setCreateErrors] = useState({});
  const [creating, setCreating] = useState(false);

  const readEnforcement = useCallback(async (isCurrent, signal) => {
    setEnforcementNow(Date.now());
    try {
      const status = await DaylightAPI('/api/v1/admin/household/shutdown/status', {}, 'GET', { signal });
      if (!isCurrent()) return;
      setShutdown(status);
      setEnforcementNow(Date.now());
    } catch {
      if (isCurrent()) setShutdown(null);
    }
  }, []);
  const { reload: refreshEnforcement, poll } = useRefreshableRead(readEnforcement);
  const pollEnforcement = useCallback(() => {
    // Age the displayed acknowledgement even when an in-flight read skips this tick.
    setEnforcementNow(Date.now());
    return poll();
  }, [poll]);
  useEffect(() => {
    if (document.visibilityState === 'visible') refreshEnforcement();
  }, [refreshEnforcement]);
  useVisibleRefresh({ intervalMs: 2000, reload: refreshEnforcement, poll: pollEnforcement });

  const handleCreateFormChange = (field, value) => {
    setCreateForm(prev => ({ ...prev, [field]: value }));
    if (createErrors[field]) {
      setCreateErrors(prev => {
        const next = { ...prev };
        delete next[field];
        return next;
      });
    }
  };

  const validateCreateForm = () => {
    const errors = {};
    if (!createForm.id.trim()) errors.id = 'Device ID is required';
    setCreateErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleCreateSubmit = async event => {
    event.preventDefault();
    if (creating || !validateCreateForm()) return;
    setCreating(true);
    try {
      const payload = {
        id: createForm.id.trim(),
        type: createForm.type
      };
      await DaylightAPI(DEVICES_PATH, payload, 'POST');
      setCreateModalOpen(false);
      setCreateForm({ id: '', type: 'shield-tv' });
      setCreateErrors({});
      invalidateAfterWrite();
    } catch (err) {
      setCreateErrors({ submit: err.message || 'Could not add device. Try again.' });
    } finally {
      setCreating(false);
    }
  };

  const rosterState = loading
    ? <LoadingState label="devices" />
    : error && <ErrorState label="Devices" error={error} onRetry={retry} />;
  const showManagement = Boolean(data) || !rosterState;

  const closeCreate = () => {
    if (creating) return;
    setCreateModalOpen(false);
    setCreateErrors({});
  };

  return (
    <Stack gap="lg">
      {showManagement && (<>
        <Group justify="space-between" className="ds-page-header">
          <span className="ds-page-title">Devices</span>
          <Button
            leftSection={<IconPlus size={16} />}
            onClick={() => setCreateModalOpen(true)}
          >
            Add Device
          </Button>
        </Group>

        <Card padding="lg" withBorder>
          <Text fw={600}>Kiosk Stop enforcement</Text>
          {shutdown?.mode==='legacy' && <Text>{shutdown.locked?'Timed Stop requested':'No active timed Stop'}</Text>}
          <EnforcementStatus {...shutdown?.enforcement} nowMs={enforcementNow}/>
        </Card>
      </>)}

      <section aria-label="Devices" {...regionProps}>
        {rosterState || (devices.length > 0 ? (
          <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
            {devices.map(device => (
              <Card
                key={device.id}
                padding="lg"
                radius="md"
                withBorder
              >
                <Stack gap="sm">
                  <Group justify="space-between" align="center">
                    {/* A kebab id is the canonical key, never what a person reads.
                        devices.yml has carried `name` and `icon` from the start and
                        the API serves both; this card showed the raw slug anyway —
                        the same defect CallApp.jsx:218 records as "the defect that
                        put 'yellow-room-tablet' on screen". */}
                    <Anchor component={Link} to={`/admin/household/devices/${encodeURIComponent(device.id)}`} c="inherit" size="md" fw={600}>
                      {device.icon ? `${device.icon} ` : ''}{device.name || device.id}
                    </Anchor>
                    <Badge
                      color={deviceTypeBadgeColor(device.type)}
                      variant="light"
                      size="sm"
                    >
                      {device.type || 'unknown'}
                    </Badge>
                  </Group>
                </Stack>
              </Card>
            ))}
          </SimpleGrid>
        ) : (
          <EmptyState title="No devices found" hint="Add a device to get started." />
        ))}
      </section>

      {showManagement && (
        <FormDialog
          opened={createModalOpen}
          onClose={closeCreate}
          title="Add Device"
        >
          <Stack component="form" gap="md" onSubmit={handleCreateSubmit}>
            <TextInput
              label="Device ID"
              placeholder="living-room-shield"
              required
              disabled={creating}
              value={createForm.id}
              onChange={(e) => handleCreateFormChange('id', e.currentTarget.value)}
              error={createErrors.id}
            />
            <Select
              label="Type"
              disabled={creating}
            data={DEVICE_TYPES}
              value={createForm.type}
              onChange={(value) => handleCreateFormChange('type', value)}
            />
            {createErrors.submit && <Alert role="alert" color="red" icon={<IconAlertCircle size={16} />}>{createErrors.submit}</Alert>}
            <Group justify="flex-end">
              <Button type="button" variant="default" disabled={creating} onClick={closeCreate}>
                Cancel
              </Button>
              <Button type="submit" loading={creating}>
                Add Device
              </Button>
            </Group>
          </Stack>
        </FormDialog>
      )}
    </Stack>
  );
}

export default DevicesIndex;
