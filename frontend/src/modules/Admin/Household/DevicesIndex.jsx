import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Stack, Text, SimpleGrid, Card, Badge, Button, Group, Modal,
  TextInput, Select, Loader, Center, Alert
} from '@mantine/core';
import { IconPlus, IconAlertCircle, IconDevices } from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';

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
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [createForm, setCreateForm] = useState({ id: '', type: 'shield-tv' });
  const [createErrors, setCreateErrors] = useState({});
  const [creating, setCreating] = useState(false);

  const fetchDevices = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI('/api/v1/admin/household/devices');
      setDevices(result.devices || []);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await DaylightAPI('/api/v1/admin/household/devices');
        if (!cancelled) {
          setDevices(result.devices || []);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

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

  const handleCreateSubmit = async () => {
    if (!validateCreateForm()) return;
    setCreating(true);
    try {
      const payload = {
        id: createForm.id.trim(),
        type: createForm.type
      };
      await DaylightAPI('/api/v1/admin/household/devices', payload, 'POST');
      await fetchDevices();
      setCreateModalOpen(false);
      setCreateForm({ id: '', type: 'shield-tv' });
      setCreateErrors({});
    } catch {
      // error displayed via general error state
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  if (error) {
    return (
      <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error loading devices">
        {error.message || 'Failed to load device list'}
      </Alert>
    );
  }

  return (
    <Stack gap="lg">
      <Group justify="space-between">
        <Text size="xl" fw={600}>Devices</Text>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={() => setCreateModalOpen(true)}
        >
          Add Device
        </Button>
      </Group>

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
                  <Text size="md" fw={600}>{device.id}</Text>
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
        <Center h="40vh">
          <Stack align="center">
            <IconDevices size={48} stroke={1} color="gray" />
            <Text c="dimmed">No devices found. Add one to get started.</Text>
          </Stack>
        </Center>
      )}

      {/* Add Device Modal */}
      <Modal
        opened={createModalOpen}
        onClose={() => {
          setCreateModalOpen(false);
          setCreateErrors({});
        }}
        title="Add Device"
      >
        <Stack gap="md">
          <TextInput
            label="Device ID"
            placeholder="living-room-shield"
            required
            value={createForm.id}
            onChange={(e) => handleCreateFormChange('id', e.currentTarget.value)}
            error={createErrors.id}
          />
          <Select
            label="Type"
            data={DEVICE_TYPE_OPTIONS}
            value={createForm.type}
            onChange={(value) => handleCreateFormChange('type', value)}
          />
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setCreateModalOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSubmit} loading={creating}>
              Add Device
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}

export default DevicesIndex;
