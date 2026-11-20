import React, { useCallback, useEffect, useState } from 'react';
import { FormDialog } from '@/lib/ui/FormDialog.jsx';
import { useNavigate } from 'react-router-dom';
import {
  Stack, Text, SimpleGrid, Card, Badge, Button, Group,
  TextInput, Select, Alert
} from '@mantine/core';
import { IconPlus, IconAlertCircle } from '@tabler/icons-react';
import {EnforcementStatus} from '../../../../../__app_modules/household/supervision/browser/index.js';
import { useVisibleRefresh } from '../../../lib/hooks/useVisibleRefresh.js';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { useRefreshableRead } from '../../../lib/hooks/useRefreshableRead.js';
import { DaylightAPI } from '../../../lib/api.mjs';

import { EmptyState, ErrorState, LoadingState } from '../../../lib/ui/states.jsx';

const DEVICES_PATH = '/api/v1/admin/household/devices';

const DEVICE_TYPE_OPTIONS = [
  { value: 'shield-tv', label: 'Shield TV' },
  { value: 'linux-pc', label: 'Linux PC' },
  { value: 'midi-keyboard', label: 'MIDI Keyboard' }
];

/**
 * Get a Badge color for a device type.
 */
function typeBadgeColor(type) {
  if (type === 'shield-tv') return 'blue';
  if (type === 'linux-pc') return 'green';
  if (type === 'midi-keyboard') return 'orange';
  return 'gray';
}

function DevicesIndex() {
  const navigate = useNavigate();
  const [shutdown,setShutdown]=useState(null),[enforcementNow,setEnforcementNow]=useState(()=>Date.now());
  const { data, loading, error, reload } = useApiResource(DEVICES_PATH);
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
      reload();
      setCreateModalOpen(false);
      setCreateForm({ id: '', type: 'shield-tv' });
      setCreateErrors({});
    } catch (err) {
      setCreateErrors({ submit: err.message || 'Could not add device. Try again.' });
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <LoadingState label="devices" />;
  if (error) return <ErrorState label="Devices" error={error} onRetry={reload} />;

  const closeCreate = () => {
    if (creating) return;
    setCreateModalOpen(false);
    setCreateErrors({});
  };

  return (
    <Stack gap="lg">
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

      {devices.length > 0 ? (
        <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }} spacing="md">
          {devices.map(device => (
            <Card
              key={device.id}
              padding="lg"
              radius="md"
              withBorder
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/admin/household/devices/${device.id}`)}
            >
              <Stack gap="sm">
                <Group justify="space-between" align="center">
                  {/* A kebab id is the canonical key, never what a person reads.
                      devices.yml has carried `name` and `icon` from the start and
                      the API serves both; this card showed the raw slug anyway —
                      the same defect CallApp.jsx:218 records as "the defect that
                      put 'yellow-room-tablet' on screen". */}
                  <Text size="md" fw={600}>
                    {device.icon ? `${device.icon} ` : ''}{device.name || device.id}
                  </Text>
                  <Badge
                    color={typeBadgeColor(device.type)}
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
      )}

      {/* Add Device Modal */}
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
            data={DEVICE_TYPE_OPTIONS}
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
    </Stack>
  );
}

export default DevicesIndex;
