import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Stack, Group, Text, Badge, Button, Tabs, TextInput, NumberInput, Select,
  Paper, Alert, Center, Loader, Divider, Anchor
} from '@mantine/core';
import {
  IconArrowBack, IconDeviceFloppy, IconAlertCircle, IconUser,
  IconSettings, IconLink, IconApple, IconHeartbeat
} from '@tabler/icons-react';
import { DaylightAPI } from '../../../lib/api.mjs';

function MemberEditor() {
  const { username } = useParams();
  const navigate = useNavigate();

  const [profile, setProfile] = useState(null);
  const [original, setOriginal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const dirty = JSON.stringify(profile) !== JSON.stringify(original);

  const fetchProfile = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI(`/api/v1/admin/household/members/${username}`);
      setProfile(result.member);
      setOriginal(JSON.parse(JSON.stringify(result.member)));
    } catch (err) {
      setError(err.message || 'Failed to load member profile');
    } finally {
      setLoading(false);
    }
  }, [username]);

  useEffect(() => {
    fetchProfile();
  }, [fetchProfile]);

  function updateField(path, value) {
    setProfile(prev => {
      const next = { ...prev };
      const parts = path.split('.');
      let current = next;
      for (let i = 0; i < parts.length - 1; i++) {
        current[parts[i]] = { ...(current[parts[i]] || {}) };
        current = current[parts[i]];
      }
      current[parts[parts.length - 1]] = value;
      return next;
    });
  }

  function getField(path) {
    if (!profile) return '';
    const parts = path.split('.');
    let current = profile;
    for (const part of parts) {
      if (current == null) return '';
      current = current[part];
    }
    return current ?? '';
  }

  function getNumericField(path) {
    const val = getField(path);
    if (val === '' || val == null) return '';
    return Number(val);
  }

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      await DaylightAPI(`/api/v1/admin/household/members/${username}`, profile, 'PUT');
      setOriginal(JSON.parse(JSON.stringify(profile)));
    } catch (err) {
      setError(err.message || 'Failed to save profile');
    } finally {
      setSaving(false);
    }
  }, [username, profile]);

  const handleRevert = useCallback(() => {
    setProfile(JSON.parse(JSON.stringify(original)));
    setError(null);
  }, [original]);

  // Loading state
  if (loading && !profile) {
    return (
      <Center h="60vh">
        <Loader size="lg" />
      </Center>
    );
  }

  // Error with no profile loaded
  if (error && !profile) {
    return (
      <Stack gap="md" p="md">
        <Anchor
          size="sm"
          onClick={() => navigate('/admin/household/members')}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
        >
          <IconArrowBack size={14} /> Back to Members
        </Anchor>
        <Alert icon={<IconAlertCircle size={16} />} color="red" title="Error">
          {error}
        </Alert>
      </Stack>
    );
  }

  if (!profile) return null;

  return (
    <Stack gap="md" p="md">
      {/* Header */}
      <Anchor
        size="sm"
        onClick={() => navigate('/admin/household/members')}
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <IconArrowBack size={14} /> Back to Members
      </Anchor>

      <Group gap="sm" align="center">
        <Text size="xl" fw={700}>{profile.display_name || username}</Text>
        <Badge variant="light" color="blue">{username}</Badge>
      </Group>

      {error && (
        <Alert
          icon={<IconAlertCircle size={16} />}
          color="red"
          title="Error"
          withCloseButton
          onClose={() => setError(null)}
        >
          {error}
        </Alert>
      )}

      {/* Save / Revert controls */}
      <Group gap="sm">
        {dirty && (
          <Badge color="yellow" variant="light">Unsaved changes</Badge>
        )}
        <Button
          variant="default"
          size="xs"
          disabled={!dirty}
          onClick={handleRevert}
        >
          Revert
        </Button>
        <Button
          leftSection={<IconDeviceFloppy size={14} />}
          size="xs"
          disabled={!dirty}
          loading={saving}
          onClick={handleSave}
        >
          Save
        </Button>
      </Group>

      <Divider />

      {/* Tabbed editor */}
      <Tabs defaultValue="identity">
        <Tabs.List>
          <Tabs.Tab value="identity" leftSection={<IconUser size={14} />}>Identity</Tabs.Tab>
          <Tabs.Tab value="preferences" leftSection={<IconSettings size={14} />}>Preferences</Tabs.Tab>
          <Tabs.Tab value="identities" leftSection={<IconLink size={14} />}>Identities</Tabs.Tab>
          <Tabs.Tab value="nutribot" leftSection={<IconApple size={14} />}>Nutribot</Tabs.Tab>
          <Tabs.Tab value="fitness" leftSection={<IconHeartbeat size={14} />}>Fitness</Tabs.Tab>
        </Tabs.List>

        {/* Identity Tab */}
        <Tabs.Panel value="identity" pt="md">
          <Paper withBorder p="md">
            <Stack gap="sm">
              <TextInput
                label="Display Name"
                value={getField('display_name')}
                onChange={(e) => updateField('display_name', e.currentTarget.value)}
              />
              <TextInput
                label="Email"
                value={getField('email')}
                onChange={(e) => updateField('email', e.currentTarget.value)}
              />
              <NumberInput
                label="Birth Year"
                value={getNumericField('birthyear')}
                onChange={(val) => updateField('birthyear', val)}
                min={1900}
                max={2100}
                hideControls
              />
              <Select
                label="Type"
                value={getField('type') || null}
                onChange={(val) => updateField('type', val)}
                data={[
                  { value: 'owner', label: 'Owner' },
                  { value: 'family_member', label: 'Family Member' },
                ]}
              />
              <Select
                label="Group"
                value={getField('group') || null}
                onChange={(val) => updateField('group', val)}
                data={[
                  { value: 'primary', label: 'Primary' },
                  { value: 'secondary', label: 'Secondary' },
                ]}
              />
              <TextInput
                label="Group Label"
                description='e.g. "Dad", "Mom"'
                value={getField('group_label')}
                onChange={(e) => updateField('group_label', e.currentTarget.value)}
              />
              <TextInput
                label="Username"
                value={getField('username')}
                readOnly
                variant="filled"
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        {/* Preferences Tab */}
        <Tabs.Panel value="preferences" pt="md">
          <Paper withBorder p="md">
            <Stack gap="sm">
              <Select
                label="Timezone"
                value={getField('preferences.timezone') || null}
                onChange={(val) => updateField('preferences.timezone', val)}
                data={[
                  { value: 'America/New_York', label: 'America/New_York (Eastern)' },
                  { value: 'America/Chicago', label: 'America/Chicago (Central)' },
                  { value: 'America/Denver', label: 'America/Denver (Mountain)' },
                  { value: 'America/Los_Angeles', label: 'America/Los_Angeles (Pacific)' },
                  { value: 'America/Anchorage', label: 'America/Anchorage (Alaska)' },
                  { value: 'Pacific/Honolulu', label: 'Pacific/Honolulu (Hawaii)' },
                  { value: 'Europe/London', label: 'Europe/London (GMT)' },
                  { value: 'Europe/Paris', label: 'Europe/Paris (CET)' },
                  { value: 'Europe/Berlin', label: 'Europe/Berlin (CET)' },
                  { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
                  { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
                  { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
                  { value: 'Australia/Sydney', label: 'Australia/Sydney (AEST)' },
                  { value: 'UTC', label: 'UTC' },
                ]}
                searchable
              />
              <Select
                label="Units"
                value={getField('preferences.units') || null}
                onChange={(val) => updateField('preferences.units', val)}
                data={[
                  { value: 'imperial', label: 'Imperial' },
                  { value: 'metric', label: 'Metric' },
                ]}
              />
              <TextInput
                label="Language"
                description="Language code (e.g. en, es, fr)"
                value={getField('preferences.language')}
                onChange={(e) => updateField('preferences.language', e.currentTarget.value)}
                placeholder="en"
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        {/* Identities Tab */}
        <Tabs.Panel value="identities" pt="md">
          <Paper withBorder p="md">
            <Text fw={600} mb="sm">Telegram</Text>
            <Stack gap="sm">
              <TextInput
                label="User ID"
                value={getField('identities.telegram.user_id')}
                onChange={(e) => updateField('identities.telegram.user_id', e.currentTarget.value)}
              />
              <TextInput
                label="Default Bot"
                value={getField('identities.telegram.default_bot')}
                onChange={(e) => updateField('identities.telegram.default_bot', e.currentTarget.value)}
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        {/* Nutribot Tab */}
        <Tabs.Panel value="nutribot" pt="md">
          <Paper withBorder p="md">
            <Text fw={600} mb="sm">Nutrition Goals</Text>
            <Stack gap="sm">
              <Group grow>
                <NumberInput
                  label="Calories Min"
                  value={getNumericField('apps.nutribot.goals.calories_min')}
                  onChange={(val) => updateField('apps.nutribot.goals.calories_min', val)}
                  min={0}
                />
                <NumberInput
                  label="Calories Max"
                  value={getNumericField('apps.nutribot.goals.calories_max')}
                  onChange={(val) => updateField('apps.nutribot.goals.calories_max', val)}
                  min={0}
                />
              </Group>
              <Group grow>
                <NumberInput
                  label="Protein (g)"
                  value={getNumericField('apps.nutribot.goals.protein')}
                  onChange={(val) => updateField('apps.nutribot.goals.protein', val)}
                  min={0}
                />
                <NumberInput
                  label="Carbs (g)"
                  value={getNumericField('apps.nutribot.goals.carbs')}
                  onChange={(val) => updateField('apps.nutribot.goals.carbs', val)}
                  min={0}
                />
              </Group>
              <Group grow>
                <NumberInput
                  label="Fat (g)"
                  value={getNumericField('apps.nutribot.goals.fat')}
                  onChange={(val) => updateField('apps.nutribot.goals.fat', val)}
                  min={0}
                />
                <NumberInput
                  label="Fiber (g)"
                  value={getNumericField('apps.nutribot.goals.fiber')}
                  onChange={(val) => updateField('apps.nutribot.goals.fiber', val)}
                  min={0}
                />
              </Group>
              <NumberInput
                label="Sodium (mg)"
                value={getNumericField('apps.nutribot.goals.sodium')}
                onChange={(val) => updateField('apps.nutribot.goals.sodium', val)}
                min={0}
              />
            </Stack>
          </Paper>
        </Tabs.Panel>

        {/* Fitness Tab */}
        <Tabs.Panel value="fitness" pt="md">
          <Paper withBorder p="md">
            <Text fw={600} mb="sm">Heart Rate Zone Overrides</Text>
            <Stack gap="sm">
              <NumberInput
                label="Active (bpm)"
                value={getNumericField('apps.fitness.heart_rate_zones.active')}
                onChange={(val) => updateField('apps.fitness.heart_rate_zones.active', val)}
                min={0}
              />
              <NumberInput
                label="Warm (bpm)"
                value={getNumericField('apps.fitness.heart_rate_zones.warm')}
                onChange={(val) => updateField('apps.fitness.heart_rate_zones.warm', val)}
                min={0}
              />
              <NumberInput
                label="Hot (bpm)"
                value={getNumericField('apps.fitness.heart_rate_zones.hot')}
                onChange={(val) => updateField('apps.fitness.heart_rate_zones.hot', val)}
                min={0}
              />
              <NumberInput
                label="Fire (bpm)"
                value={getNumericField('apps.fitness.heart_rate_zones.fire')}
                onChange={(val) => updateField('apps.fitness.heart_rate_zones.fire', val)}
                min={0}
              />
            </Stack>
          </Paper>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export default MemberEditor;
