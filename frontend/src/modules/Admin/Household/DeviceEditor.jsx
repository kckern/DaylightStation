import React, { useLayoutEffect, useRef, useState } from 'react';
import { SectionCard } from '../../../lib/ui/cards.jsx';
import { ErrorState } from '../../../lib/ui/states.jsx';
import { useParams, useNavigate } from 'react-router-dom';
import { Stack, Group, Text, Badge, Button, Paper, TextInput, Select, Alert, Center, Loader, Anchor }  from '@mantine/core';
import {
  IconArrowBack, IconTrash, IconAlertCircle, IconDeviceDesktopCog
} from '@tabler/icons-react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import ConfirmModal from '../shared/ConfirmModal.jsx';
import SaveBar from '../shared/SaveBar.jsx';
import { useUnsavedGuard } from '../shared/useUnsavedGuard.js';
import { notifySuccess, notifyFailure } from '../shared/feedback.js';

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

/**
 * Section wrapper for grouping related fields.
 */
function DeviceFieldsSection({ title, children }) {
  return (
    <SectionCard variant="form" title={title}>
      <Stack gap="sm">{children}</Stack>
    </SectionCard>
  );
}

/**
 * Render display entries for a device (tv, monitor, etc.)
 */
function DisplayFields({ displays, onUpdate }) {
  if (!displays || typeof displays !== 'object') return null;

  return Object.entries(displays).map(([displayName, displayConfig]) => (
    <Paper key={displayName} p="sm" withBorder variant="light">
      <Stack gap="xs">
        <Text size="sm" fw={500}>{displayName}</Text>
        {displayConfig && typeof displayConfig === 'object' && Object.entries(displayConfig).map(([field, value]) => (
          <TextInput
            key={field}
            label={field}
            size="xs"
            value={typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)}
            onChange={(e) => onUpdate(`${displayName}.${field}`, e.currentTarget.value)}
          />
        ))}
      </Stack>
    </Paper>
  ));
}

/**
 * Render fields for a flat or shallow-nested config object.
 */
function ObjectFields({ data, pathPrefix, onUpdate }) {
  if (!data || typeof data !== 'object') return null;

  return Object.entries(data).map(([key, value]) => {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      // One level of nesting — render as a sub-group
      return (
        <Paper key={key} p="sm" withBorder variant="light">
          <Stack gap="xs">
            <Text size="sm" fw={500}>{key}</Text>
            {Object.entries(value).map(([subKey, subValue]) => (
              <TextInput
                key={subKey}
                label={subKey}
                size="xs"
                value={typeof subValue === 'string' || typeof subValue === 'number' ? String(subValue) : JSON.stringify(subValue)}
                onChange={(e) => onUpdate(`${pathPrefix}.${key}.${subKey}`, e.currentTarget.value)}
              />
            ))}
          </Stack>
        </Paper>
      );
    }

    return (
      <TextInput
        key={key}
        label={key}
        size="xs"
        value={typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)}
        onChange={(e) => onUpdate(`${pathPrefix}.${key}`, e.currentTarget.value)}
      />
    );
  });
}

/**
 * Shield TV type-specific sections.
 */
function ShieldTVSections({ device, updateField }) {
  const deviceControl = device.device_control || {};
  const contentControl = device.content_control || {};
  const displays = deviceControl.displays || {};

  return (
    <>
      <DeviceFieldsSection title="Device Control - Displays">
        <DisplayFields
          displays={displays}
          onUpdate={(subPath, value) => updateField(`device_control.displays.${subPath}`, value)}
        />
        {Object.keys(displays).length === 0 && (
          <Text size="sm" c="dimmed">No displays configured.</Text>
        )}
      </DeviceFieldsSection>

      <DeviceFieldsSection title="Content Control">
        <ObjectFields
          data={contentControl}
          pathPrefix="content_control"
          onUpdate={updateField}
        />
        {Object.keys(contentControl).length === 0 && (
          <Text size="sm" c="dimmed">No content control configured.</Text>
        )}
      </DeviceFieldsSection>
    </>
  );
}

/**
 * Linux PC type-specific sections.
 */
function LinuxPCSections({ device, updateField }) {
  const deviceControl = device.device_control || {};
  const osControl = device.os_control || {};
  const contentControl = device.content_control || {};
  const modules = device.modules || {};
  const displays = deviceControl.displays || {};

  return (
    <>
      <DeviceFieldsSection title="Device Control - Displays">
        <DisplayFields
          displays={displays}
          onUpdate={(subPath, value) => updateField(`device_control.displays.${subPath}`, value)}
        />
        {Object.keys(displays).length === 0 && (
          <Text size="sm" c="dimmed">No displays configured.</Text>
        )}
      </DeviceFieldsSection>

      <DeviceFieldsSection title="OS Control">
        <ObjectFields
          data={osControl}
          pathPrefix="os_control"
          onUpdate={updateField}
        />
        {Object.keys(osControl).length === 0 && (
          <Text size="sm" c="dimmed">No OS control configured.</Text>
        )}
      </DeviceFieldsSection>

      <DeviceFieldsSection title="Content Control">
        <ObjectFields
          data={contentControl}
          pathPrefix="content_control"
          onUpdate={updateField}
        />
        {Object.keys(contentControl).length === 0 && (
          <Text size="sm" c="dimmed">No content control configured.</Text>
        )}
      </DeviceFieldsSection>

      <DeviceFieldsSection title="Modules">
        {Object.entries(modules).map(([moduleName, moduleConfig]) => (
          <Paper key={moduleName} p="sm" withBorder variant="light">
            <Stack gap="xs">
              <Text size="sm" fw={500}>{moduleName}</Text>
              {moduleConfig && typeof moduleConfig === 'object' && Object.entries(moduleConfig).map(([field, value]) => {
                if (value && typeof value === 'object' && !Array.isArray(value)) {
                  return Object.entries(value).map(([subField, subValue]) => (
                    <TextInput
                      key={`${field}.${subField}`}
                      label={`${field}.${subField}`}
                      size="xs"
                      value={typeof subValue === 'string' || typeof subValue === 'number' ? String(subValue) : JSON.stringify(subValue)}
                      onChange={(e) => updateField(`modules.${moduleName}.${field}.${subField}`, e.currentTarget.value)}
                    />
                  ));
                }
                return (
                  <TextInput
                    key={field}
                    label={field}
                    size="xs"
                    value={typeof value === 'string' || typeof value === 'number' ? String(value) : JSON.stringify(value)}
                    onChange={(e) => updateField(`modules.${moduleName}.${field}`, e.currentTarget.value)}
                  />
                );
              })}
            </Stack>
          </Paper>
        ))}
        {Object.keys(modules).length === 0 && (
          <Text size="sm" c="dimmed">No modules configured.</Text>
        )}
      </DeviceFieldsSection>
    </>
  );
}

/**
 * MIDI Keyboard type-specific sections.
 */
function MidiKeyboardSections({ device, updateField }) {
  return (
    <DeviceFieldsSection title="MIDI Configuration">
      <TextInput
        label="Extension Path"
        value={device.extension_path || ''}
        onChange={(e) => updateField('extension_path', e.currentTarget.value)}
      />
    </DeviceFieldsSection>
  );
}

function DeviceEditor() {
  const { deviceId } = useParams();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useApiResource(`/api/v1/admin/household/devices/${deviceId}`);

  if (loading && !data) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  if (error && !data) {
    return (
      <Stack gap="md">
        <Anchor
          size="sm"
          onClick={() => navigate('/admin/household/devices')}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <IconArrowBack size={14} /> Back to Devices
        </Anchor>
        <ErrorState error={error} onRetry={reload} title="Error loading device" />
      </Stack>
    );
  }

  if (!data?.device) {
    return (
      <Stack gap="md">
        <Anchor
          size="sm"
          onClick={() => navigate('/admin/household/devices')}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <IconArrowBack size={14} /> Back to Devices
        </Anchor>
        <Center h="40vh">
          <Text c="dimmed">Device not found.</Text>
        </Center>
      </Stack>
    );
  }

  return <DeviceDraft key={deviceId} deviceId={deviceId} initialDevice={data.device} />;
}

function DeviceDraft({ deviceId, initialDevice }) {
  const navigate = useNavigate();
  const [device, setDevice] = useState(initialDevice);
  const [original, setOriginal] = useState(initialDevice);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const active = useRef(false);
  useLayoutEffect(() => {
    active.current = true;
    return () => { active.current = false; };
  }, []);

  const dirty = JSON.stringify(device) !== JSON.stringify(original);

  // Unsaved-changes guard: beforeunload + AdminNav interception (audit C1)
  useUnsavedGuard(dirty, { label: `device:${deviceId}` });

  function updateField(path, value) {
    setDevice(prev => {
      const next = JSON.parse(JSON.stringify(prev)); // deep clone
      const parts = path.split('.');
      let current = next;
      for (let i = 0; i < parts.length - 1; i++) {
        if (!current[parts[i]]) current[parts[i]] = {};
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
      return next;
    });
  }

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await DaylightAPI(`/api/v1/admin/household/devices/${deviceId}`, device, 'PUT');
      if (!active.current) return;
      setOriginal(JSON.parse(JSON.stringify(device)));
      notifySuccess({ title: 'Device saved', message: deviceId });
    } catch (err) {
      if (!active.current) return;
      setError(err);
      notifyFailure({ title: 'Save failed', message: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleRevert = () => {
    setDevice(JSON.parse(JSON.stringify(original)));
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await DaylightAPI(`/api/v1/admin/household/devices/${deviceId}`, {}, 'DELETE');
      if (!active.current) return;
      notifySuccess({ title: 'Device deleted', message: deviceId });
      navigate('/admin/household/devices');
    } catch (err) {
      if (!active.current) return;
      setError(err);
      notifyFailure({ title: 'Delete failed', message: err.message });
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  };

  return (
    <Stack gap="md">
      {/* Header */}
      <Anchor
        size="sm"
        onClick={() => navigate('/admin/household/devices')}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <IconArrowBack size={14} /> Back to Devices
      </Anchor>

      {/* Shared save/revert chrome (audit C5) */}
      <SaveBar
        title={(
          <Group gap="sm" align="center">
            <span className="ds-page-title">{device.id}</span>
            <Badge color={typeBadgeColor(device.type)} variant="light" size="lg">
              {device.type || 'unknown'}
            </Badge>
          </Group>
        )}
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onRevert={handleRevert}
        headerExtra={(
          <Group gap="xs">
            {/* Both kiosk providers are administered through the same console
                and the same backend route; the backend picks the gateway from
                the device's provider. */}
            {['fully-kiosk', 'daylight-android'].includes(device.content_control?.provider) && (
              <Button
                variant="light"
                size="sm"
                leftSection={<IconDeviceDesktopCog size={14} />}
                onClick={() => navigate(`/admin/household/devices/${deviceId}/fully-kiosk`)}
              >
                {device.content_control.provider === 'fully-kiosk' ? 'Fully Kiosk Console' : 'Kiosk Console'}
              </Button>
            )}
            <Button
              color="red"
              variant="light"
              size="sm"
              leftSection={<IconTrash size={14} />}
              onClick={() => setDeleteOpen(true)}
            >
              Delete
            </Button>
          </Group>
        )}
      />

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Error"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error.message || 'An error occurred'}
        </Alert>
      )}

      {/* Type (read-only display) */}
      <DeviceFieldsSection title="General">
        <Select
          label="Type"
          data={DEVICE_TYPE_OPTIONS}
          value={device.type}
          readOnly
          description="Device type cannot be changed after creation"
        />
      </DeviceFieldsSection>

      {/* Type-specific sections */}
      {device.type === 'shield-tv' && (
        <ShieldTVSections device={device} updateField={updateField} />
      )}

      {device.type === 'linux-pc' && (
        <LinuxPCSections device={device} updateField={updateField} />
      )}

      {device.type === 'midi-keyboard' && (
        <MidiKeyboardSections device={device} updateField={updateField} />
      )}

      {/* Delete Confirmation */}
      <ConfirmModal
        opened={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        onConfirm={handleDelete}
        title="Delete Device"
        message={`Are you sure you want to delete device "${device.id}"? This action cannot be undone.`}
        confirmLabel="Delete"
        loading={deleting}
      />
    </Stack>
  );
}

export default DeviceEditor;
