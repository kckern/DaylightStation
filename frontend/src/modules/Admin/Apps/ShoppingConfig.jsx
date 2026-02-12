import React, { useState } from 'react';
import {
  Stack, Switch, TextInput, Paper, Text, Group, Button, ActionIcon, Divider, Select
} from '@mantine/core';
import { IconPlus, IconTrash } from '@tabler/icons-react';
import ConfigFormWrapper from '../shared/ConfigFormWrapper.jsx';
import TagInput from '../shared/TagInput.jsx';
import ConfirmModal from '../shared/ConfirmModal.jsx';

const US_TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (America/New_York)' },
  { value: 'America/Chicago', label: 'Central (America/Chicago)' },
  { value: 'America/Denver', label: 'Mountain (America/Denver)' },
  { value: 'America/Phoenix', label: 'Arizona (America/Phoenix)' },
  { value: 'America/Los_Angeles', label: 'Pacific (America/Los_Angeles)' },
  { value: 'America/Anchorage', label: 'Alaska (America/Anchorage)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (Pacific/Honolulu)' },
];

function updateRetailer(retailers, index, field, value) {
  return retailers.map((r, i) => i === index ? { ...r, [field]: value } : r);
}

function ShoppingConfigContent({ data, setData }) {
  const [deleteIndex, setDeleteIndex] = useState(null);

  const shopping = data.shopping || {};
  const retailers = shopping.retailers || [];

  function updateShopping(field, value) {
    setData(prev => ({
      ...prev,
      shopping: { ...prev.shopping, [field]: value }
    }));
  }

  function updateRetailerField(index, field, value) {
    const updated = updateRetailer(retailers, index, field, value);
    updateShopping('retailers', updated);
  }

  function addRetailer() {
    const updated = [
      ...retailers,
      { id: '', name: '', senders: [], keywords: [] }
    ];
    updateShopping('retailers', updated);
  }

  function confirmDeleteRetailer() {
    if (deleteIndex === null) return;
    const updated = retailers.filter((_, i) => i !== deleteIndex);
    updateShopping('retailers', updated);
    setDeleteIndex(null);
  }

  const retailerToDelete = deleteIndex !== null ? retailers[deleteIndex] : null;

  return (
    <Stack gap="lg">
      {/* General Settings */}
      <Text fw={600} size="md">General Settings</Text>

      <Group gap="lg">
        <Switch
          label="Enabled"
          checked={shopping.enabled ?? false}
          onChange={(e) => updateShopping('enabled', e.currentTarget.checked)}
        />
      </Group>

      <Select
        label="Timezone"
        data={US_TIMEZONES}
        value={shopping.timezone || ''}
        onChange={(val) => updateShopping('timezone', val)}
        placeholder="Select timezone"
        searchable
        style={{ maxWidth: 360 }}
      />

      <Divider />

      {/* Retailers */}
      <Group justify="space-between">
        <Text fw={600} size="md">Retailers</Text>
        <Button
          leftSection={<IconPlus size={16} />}
          variant="light"
          size="xs"
          onClick={addRetailer}
        >
          Add Retailer
        </Button>
      </Group>

      {retailers.length === 0 && (
        <Text size="sm" c="dimmed">No retailers configured. Click "Add Retailer" to get started.</Text>
      )}

      {retailers.map((retailer, index) => (
        <Paper key={index} p="md" withBorder>
          <Stack gap="sm">
            <Group justify="space-between" align="flex-start">
              <Group gap="sm" grow style={{ flex: 1 }}>
                <TextInput
                  label="Name"
                  placeholder="e.g. Amazon"
                  value={retailer.name || ''}
                  onChange={(e) => updateRetailerField(index, 'name', e.target.value)}
                />
                <TextInput
                  label="ID"
                  placeholder="e.g. amazon"
                  value={retailer.id || ''}
                  onChange={(e) => updateRetailerField(index, 'id', e.target.value)}
                  style={{ maxWidth: 180 }}
                />
              </Group>
              <ActionIcon
                color="red"
                variant="subtle"
                onClick={() => setDeleteIndex(index)}
                title="Delete retailer"
                mt={28}
              >
                <IconTrash size={16} />
              </ActionIcon>
            </Group>

            <TagInput
              label="Senders"
              values={retailer.senders || []}
              onChange={(val) => updateRetailerField(index, 'senders', val)}
              placeholder="Add sender email and press Enter"
            />

            <TagInput
              label="Keywords"
              values={retailer.keywords || []}
              onChange={(val) => updateRetailerField(index, 'keywords', val)}
              placeholder="Add keyword and press Enter"
            />
          </Stack>
        </Paper>
      ))}

      {retailers.length > 3 && (
        <Button
          leftSection={<IconPlus size={16} />}
          variant="light"
          size="xs"
          onClick={addRetailer}
        >
          Add Retailer
        </Button>
      )}

      <ConfirmModal
        opened={deleteIndex !== null}
        onClose={() => setDeleteIndex(null)}
        onConfirm={confirmDeleteRetailer}
        title="Delete Retailer"
        message={
          retailerToDelete
            ? `Are you sure you want to delete "${retailerToDelete.name || retailerToDelete.id || 'this retailer'}"?`
            : 'Are you sure you want to delete this retailer?'
        }
        confirmLabel="Delete"
      />
    </Stack>
  );
}

function ShoppingConfig() {
  return (
    <ConfigFormWrapper
      filePath="household/config/harvesters.yml"
      title="Shopping Configuration"
    >
      {({ data, setData }) => (
        <ShoppingConfigContent data={data} setData={setData} />
      )}
    </ConfigFormWrapper>
  );
}

export default ShoppingConfig;
