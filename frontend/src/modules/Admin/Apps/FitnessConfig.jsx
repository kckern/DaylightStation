import React, { useCallback } from 'react';
import {
  Accordion,
  Stack,
  NumberInput,
  TextInput,
  Text,
  Group,
  Divider,
  SimpleGrid
} from '@mantine/core';
import {
  IconSettings,
  IconMusic,
  IconDeviceGamepad,
  IconUsers,
  IconShield,
  IconBulb,
  IconRoute,
  IconHeart,
  IconBarbell
} from '@tabler/icons-react';
import ConfigFormWrapper from '../shared/ConfigFormWrapper.jsx';
import CrudTable from '../shared/CrudTable.jsx';
import TagInput from '../shared/TagInput.jsx';

/**
 * Deep-clone data and set a nested property by dot-path.
 */
function updateNested(data, path, value) {
  const next = JSON.parse(JSON.stringify(data));
  const parts = path.split('.');
  let current = next;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!current[parts[i]]) current[parts[i]] = {};
    current = current[parts[i]];
  }
  current[parts[parts.length - 1]] = value;
  return next;
}

/**
 * Renders key-value pairs from an object as editable TextInput rows.
 * Keys are device IDs (numbers), values are user/equipment labels.
 */
function KeyValueEditor({ data, onChange, keyLabel = 'Device ID', valueLabel = 'Mapped To' }) {
  const entries = data ? Object.entries(data) : [];

  const handleKeyChange = useCallback((oldKey, newKey) => {
    const next = {};
    for (const [k, v] of Object.entries(data)) {
      if (k === oldKey) {
        next[newKey] = v;
      } else {
        next[k] = v;
      }
    }
    onChange(next);
  }, [data, onChange]);

  const handleValueChange = useCallback((key, newValue) => {
    onChange({ ...data, [key]: newValue });
  }, [data, onChange]);

  const handleAdd = useCallback(() => {
    onChange({ ...data, '': '' });
  }, [data, onChange]);

  const handleRemove = useCallback((keyToRemove) => {
    const next = { ...data };
    delete next[keyToRemove];
    onChange(next);
  }, [data, onChange]);

  return (
    <Stack gap="xs">
      {entries.map(([key, value], index) => (
        <Group key={index} gap="xs" align="flex-end">
          <TextInput
            size="xs"
            label={index === 0 ? keyLabel : undefined}
            value={key}
            onChange={(e) => handleKeyChange(key, e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <TextInput
            size="xs"
            label={index === 0 ? valueLabel : undefined}
            value={value}
            onChange={(e) => handleValueChange(key, e.currentTarget.value)}
            style={{ flex: 1 }}
          />
          <Text
            size="xs"
            c="red"
            style={{ cursor: 'pointer', paddingBottom: 4 }}
            onClick={() => handleRemove(key)}
          >
            Remove
          </Text>
        </Group>
      ))}
      <Group>
        <Text
          size="xs"
          c="blue"
          style={{ cursor: 'pointer' }}
          onClick={handleAdd}
        >
          + Add mapping
        </Text>
      </Group>
    </Stack>
  );
}

/* ── Column Definitions ─────────────────────────────────────── */

const PLAYLIST_COLUMNS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'id', label: 'Plex ID', type: 'number', width: 140 },
];

const NAV_ITEM_COLUMNS = [
  { key: 'name', label: 'Name', type: 'text' },
  {
    key: 'type',
    label: 'Type',
    type: 'select',
    width: 200,
    options: [
      { value: 'plugin_direct', label: 'Plugin Direct' },
      { value: 'plex_collection', label: 'Plex Collection' },
      { value: 'plex_collection_group', label: 'Collection Group' },
      { value: 'plugin_menu', label: 'Plugin Menu' },
    ],
  },
  { key: 'icon', label: 'Icon', type: 'text', width: 120 },
  { key: 'order', label: 'Order', type: 'number', width: 80 },
];

const EQUIPMENT_TYPE_OPTIONS = [
  { value: 'stationary_bike', label: 'Stationary Bike' },
  { value: 'jumprope', label: 'Jump Rope' },
  { value: 'punching_bag', label: 'Punching Bag' },
  { value: 'step_platform', label: 'Step Platform' },
  { value: 'pull_up_bar', label: 'Pull-up Bar' },
  { value: 'ab_roller', label: 'Ab Roller' },
];

const EQUIPMENT_COLUMNS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'id', label: 'ID', type: 'text', width: 140 },
  { key: 'type', label: 'Type', type: 'select', width: 180, options: EQUIPMENT_TYPE_OPTIONS },
];

const ZONE_COLUMNS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'id', label: 'ID', type: 'text', width: 100 },
  { key: 'min', label: 'Min BPM', type: 'number', width: 100 },
  { key: 'color', label: 'Color', type: 'text', width: 100 },
  { key: 'coins', label: 'Coins', type: 'number', width: 80 },
];

const FAMILY_COLUMNS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'id', label: 'ID', type: 'text', width: 120 },
  { key: 'birthyear', label: 'Birth Year', type: 'number', width: 110 },
];

const FRIEND_COLUMNS = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'id', label: 'ID', type: 'text', width: 120 },
  { key: 'birthyear', label: 'Birth Year', type: 'number', width: 110 },
];

/* ── Section Components ─────────────────────────────────────── */

function PlexSection({ data, update }) {
  const plex = data.plex || {};
  return (
    <Stack gap="md">
      <SimpleGrid cols={2}>
        <NumberInput
          label="Library ID"
          value={plex.library_id ?? ''}
          onChange={(val) => update('plex.library_id', val)}
        />
        <NumberInput
          label="Voice Memo Prompt Threshold (seconds)"
          value={plex.voice_memo_prompt_threshold_seconds ?? ''}
          onChange={(val) => update('plex.voice_memo_prompt_threshold_seconds', val)}
        />
      </SimpleGrid>
      <TagInput
        label="No-Music Labels"
        values={plex.nomusic_labels || []}
        onChange={(vals) => update('plex.nomusic_labels', vals)}
        placeholder="Add label and press Enter"
      />
      <TagInput
        label="Governed Labels"
        values={plex.governed_labels || []}
        onChange={(vals) => update('plex.governed_labels', vals)}
        placeholder="Add label and press Enter"
      />
      <TagInput
        label="Resumable Labels"
        values={plex.resumable_labels || []}
        onChange={(vals) => update('plex.resumable_labels', vals)}
        placeholder="Add label and press Enter"
      />
      <TagInput
        label="Governed Types"
        values={plex.governed_types || []}
        onChange={(vals) => update('plex.governed_types', vals)}
        placeholder="Add type and press Enter"
      />
    </Stack>
  );
}

function MusicPlaylistsSection({ data, update }) {
  const playlists = data.plex?.music_playlists || [];
  return (
    <CrudTable
      items={playlists}
      onChange={(items) => update('plex.music_playlists', items)}
      columns={PLAYLIST_COLUMNS}
      createDefaults={{ name: '', id: '' }}
      addLabel="Add Playlist"
      emptyMessage="No music playlists configured."
    />
  );
}

function NavItemsSection({ data, update }) {
  const navItems = data.plex?.nav_items || [];
  return (
    <CrudTable
      items={navItems}
      onChange={(items) => update('plex.nav_items', items)}
      columns={NAV_ITEM_COLUMNS}
      createDefaults={{ name: '', type: 'plugin_direct', icon: '', order: 0 }}
      addLabel="Add Nav Item"
      confirmDelete
      emptyMessage="No nav items configured."
    />
  );
}

function DeviceMappingsSection({ data, update }) {
  const devices = data.devices || {};
  return (
    <Stack gap="lg">
      <div>
        <Text fw={500} size="sm" mb="xs">Heart Rate Devices</Text>
        <KeyValueEditor
          data={devices.heart_rate || {}}
          onChange={(val) => update('devices.heart_rate', val)}
          keyLabel="Device ID"
          valueLabel="User"
        />
      </div>
      <Divider />
      <div>
        <Text fw={500} size="sm" mb="xs">Cadence Devices</Text>
        <KeyValueEditor
          data={devices.cadence || {}}
          onChange={(val) => update('devices.cadence', val)}
          keyLabel="Device ID"
          valueLabel="Equipment"
        />
      </div>
    </Stack>
  );
}

function EquipmentSection({ data, update }) {
  const equipment = data.equipment || [];
  return (
    <CrudTable
      items={equipment}
      onChange={(items) => update('equipment', items)}
      columns={EQUIPMENT_COLUMNS}
      createDefaults={{ name: '', id: '', type: 'stationary_bike' }}
      addLabel="Add Equipment"
      confirmDelete
      emptyMessage="No equipment configured."
    />
  );
}

function ZonesSection({ data, update }) {
  const zones = data.zones || [];
  return (
    <CrudTable
      items={zones}
      onChange={(items) => update('zones', items)}
      columns={ZONE_COLUMNS}
      createDefaults={{ name: '', id: '', min: 0, color: '', coins: 0 }}
      addLabel="Add Zone"
      confirmDelete
      emptyMessage="No zones configured."
    />
  );
}

function AmbientLedSection({ data, update }) {
  const ambient = data.ambient_led || {};
  const scenes = ambient.scenes || {};
  const sceneKeys = ['off', 'cool', 'active', 'warm', 'hot', 'fire', 'fire_all'];

  return (
    <Stack gap="md">
      <NumberInput
        label="Throttle (ms)"
        value={ambient.throttle_ms ?? ''}
        onChange={(val) => update('ambient_led.throttle_ms', val)}
      />
      <Text fw={500} size="sm">Scene Mappings</Text>
      <SimpleGrid cols={2}>
        {sceneKeys.map((key) => (
          <TextInput
            key={key}
            label={key}
            value={scenes[key] ?? ''}
            onChange={(e) => update(`ambient_led.scenes.${key}`, e.currentTarget.value)}
          />
        ))}
      </SimpleGrid>
    </Stack>
  );
}

function UserGroupsSection({ data, update }) {
  const users = data.users || {};
  return (
    <Stack gap="lg">
      <TagInput
        label="Primary Users"
        values={users.primary || []}
        onChange={(vals) => update('users.primary', vals)}
        placeholder="Add user ID and press Enter"
      />
      <Divider />
      <div>
        <Text fw={500} size="sm" mb="xs">Family Members</Text>
        <CrudTable
          items={users.family || []}
          onChange={(items) => update('users.family', items)}
          columns={FAMILY_COLUMNS}
          createDefaults={{ name: '', id: '', birthyear: 2000 }}
          addLabel="Add Family Member"
          confirmDelete
          emptyMessage="No family members."
        />
      </div>
      <Divider />
      <div>
        <Text fw={500} size="sm" mb="xs">Friends</Text>
        <CrudTable
          items={users.friends || []}
          onChange={(items) => update('users.friends', items)}
          columns={FRIEND_COLUMNS}
          createDefaults={{ name: '', id: '', birthyear: 2000 }}
          addLabel="Add Friend"
          confirmDelete
          emptyMessage="No friends."
        />
      </div>
    </Stack>
  );
}

function GovernanceSection({ data, update }) {
  const governance = data.governance || {};
  return (
    <Stack gap="md">
      <SimpleGrid cols={2}>
        <NumberInput
          label="Grace Period (seconds)"
          value={governance.grace_period_seconds ?? ''}
          onChange={(val) => update('governance.grace_period_seconds', val)}
        />
        <NumberInput
          label="Coin Time Unit (ms)"
          description="Root-level: coin_time_unit_ms"
          value={data.coin_time_unit_ms ?? ''}
          onChange={(val) => update('coin_time_unit_ms', val)}
        />
      </SimpleGrid>
      <TagInput
        label="Superusers"
        values={governance.superusers || []}
        onChange={(vals) => update('governance.superusers', vals)}
        placeholder="Add user ID and press Enter"
      />
      <TagInput
        label="Exemptions"
        values={governance.exemptions || []}
        onChange={(vals) => update('governance.exemptions', vals)}
        placeholder="Add user ID and press Enter"
      />
    </Stack>
  );
}

/* ── Accordion Section Definitions ──────────────────────────── */

const SECTIONS = [
  { value: 'plex', label: 'Plex Settings', icon: IconSettings, Component: PlexSection },
  { value: 'playlists', label: 'Music Playlists', icon: IconMusic, Component: MusicPlaylistsSection },
  { value: 'nav', label: 'Nav Items', icon: IconRoute, Component: NavItemsSection },
  { value: 'devices', label: 'Device Mappings', icon: IconDeviceGamepad, Component: DeviceMappingsSection },
  { value: 'equipment', label: 'Equipment', icon: IconBarbell, Component: EquipmentSection },
  { value: 'zones', label: 'Zones', icon: IconHeart, Component: ZonesSection },
  { value: 'ambient', label: 'Ambient LED', icon: IconBulb, Component: AmbientLedSection },
  { value: 'users', label: 'User Groups', icon: IconUsers, Component: UserGroupsSection },
  { value: 'governance', label: 'Governance', icon: IconShield, Component: GovernanceSection },
];

/* ── Main Content ───────────────────────────────────────────── */

function FitnessConfigContent({ data, setData }) {
  const update = useCallback((path, value) => {
    setData((prev) => updateNested(prev, path, value));
  }, [setData]);

  return (
    <Accordion variant="separated" multiple defaultValue={['plex']}>
      {SECTIONS.map(({ value, label, icon: Icon, Component }) => (
        <Accordion.Item key={value} value={value}>
          <Accordion.Control icon={<Icon size={18} />}>
            {label}
          </Accordion.Control>
          <Accordion.Panel>
            <Component data={data} update={update} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion>
  );
}

/* ── Wrapper ────────────────────────────────────────────────── */

function FitnessConfig() {
  return (
    <ConfigFormWrapper
      filePath="household/config/fitness.yml"
      title="Fitness Configuration"
    >
      {({ data, setData }) => (
        <FitnessConfigContent data={data} setData={setData} />
      )}
    </ConfigFormWrapper>
  );
}

export default FitnessConfig;
