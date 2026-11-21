import React, { useState, useCallback } from 'react';
import { SectionCard } from '../../../lib/ui/cards.jsx';
import { useParams } from 'react-router-dom';
import {
  Stack, Group, Text, Badge, Button, Tabs, TextInput, NumberInput, Select,
  Paper, Alert, Divider, Anchor, MultiSelect, CopyButton,
  ActionIcon, Tooltip
} from '@mantine/core';
import {
  IconArrowBack, IconAlertCircle, IconUser,
  IconSettings, IconLink, IconApple, IconHeartbeat, IconShield,
  IconCopy, IconCheck
} from '@tabler/icons-react';
import { useApiResource } from '../../../lib/hooks/useApiResource.js';
import { DaylightAPI } from '../../../lib/api.mjs';
import { useAdminHousehold } from '../../../hooks/admin/useAdminHousehold';
import SaveBar from '../shared/SaveBar.jsx';
import EditorReadRegion from '../shared/EditorReadRegion.jsx';
import { useUnsavedGuard } from '../shared/useUnsavedGuard.js';
import GuardedLink from '../shared/GuardedLink.jsx';
import { clearAdminDraft, useAdminDraftState } from '../shared/useAdminDraftState.js';

const AVAILABLE_ROLES = ['sysadmin', 'admin', 'parent', 'member', 'kiosk'];

function MemberEditor() {
  const { username } = useParams();
  const { data, loading, error, reload } = useApiResource(`/api/v1/admin/household/members/${username}`);

  const back = (
    <Anchor
      component={GuardedLink}
      to="/admin/household/members"
      size="sm"
      style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
    >
      <IconArrowBack size={14} /> Back to Members
    </Anchor>
  );

  return (
    <EditorReadRegion
      key={username}
      label="Member editor"
      loading={loading && !data}
      error={!data && error}
      errorTitle="Error loading member profile"
      reload={reload}
      back={back}
    >
      {data?.member && <MemberDraft username={username} initialProfile={data.member} authStatus={data.authStatus} />}
    </EditorReadRegion>
  );
}

function MemberDraft({ username, initialProfile, authStatus }) {
  const { generateInvite } = useAdminHousehold();

  const draftKey = `member:${username}`;
  const [profile, setProfile, original, setOriginal] = useAdminDraftState(draftKey, initialProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [inviteUrl, setInviteUrl] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);

  const dirty = JSON.stringify(profile) !== JSON.stringify(original);

  // Unsaved-changes guard: beforeunload + guarded Admin navigation (audit C1)
  const clearDraft = useCallback(() => clearAdminDraft(draftKey), [draftKey]);
  useUnsavedGuard(dirty, { label: `member:${username}`, onDiscard: clearDraft });

  const handleGenerateInvite = useCallback(async () => {
    setInviteLoading(true);
    setInviteUrl(null);
    try {
      const result = await generateInvite(username);
      const fullUrl = `${window.location.origin}${result.inviteUrl}`;
      setInviteUrl(fullUrl);
    } catch (err) {
      setError(err.message || 'Failed to generate invite link');
    } finally {
      setInviteLoading(false);
    }
  }, [username, generateInvite]);

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

  return (
    <Stack gap="md" p="md">
      {/* Header */}
      <Anchor
        component={GuardedLink}
        to="/admin/household/members"
        size="sm"
        style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
      >
        <IconArrowBack size={14} /> Back to Members
      </Anchor>

      {/* Shared save/revert chrome (audit C5) */}
      <SaveBar
        title={(
          <Group gap="sm" align="center">
            <Text size="xl" fw={700}>{profile.display_name || username}</Text>
            <Badge variant="light" color="blue">{username}</Badge>
          </Group>
        )}
        dirty={dirty}
        saving={saving}
        onSave={handleSave}
        onRevert={handleRevert}
      />

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

      <Divider />

      {/* Tabbed editor */}
      <Tabs defaultValue="identity">
        <Tabs.List>
          <Tabs.Tab value="identity" leftSection={<IconUser size={14} />}>Identity</Tabs.Tab>
          <Tabs.Tab value="preferences" leftSection={<IconSettings size={14} />}>Preferences</Tabs.Tab>
          <Tabs.Tab value="identities" leftSection={<IconLink size={14} />}>Identities</Tabs.Tab>
          <Tabs.Tab value="nutribot" leftSection={<IconApple size={14} />}>Nutribot</Tabs.Tab>
          <Tabs.Tab value="fitness" leftSection={<IconHeartbeat size={14} />}>Fitness</Tabs.Tab>
          <Tabs.Tab value="auth" leftSection={<IconShield size={14} />}>Auth</Tabs.Tab>
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
          <SectionCard variant="form" title="Telegram">
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
          </SectionCard>
        </Tabs.Panel>

        {/* Nutribot Tab */}
        <Tabs.Panel value="nutribot" pt="md">
          <SectionCard variant="form" title="Nutrition Goals">
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
          </SectionCard>
        </Tabs.Panel>

        {/* Fitness Tab */}
        <Tabs.Panel value="fitness" pt="md">
          <SectionCard variant="form" title="Heart Rate Zone Overrides">
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
          </SectionCard>
        </Tabs.Panel>

        {/* Auth Tab */}
        <Tabs.Panel value="auth" pt="md">
          <Stack gap="md">
            {/* Roles Section */}
            <SectionCard variant="form" title="Roles">
              <MultiSelect
                label="Assigned Roles"
                description="Controls what this user can access"
                data={AVAILABLE_ROLES}
                value={getField('roles') || []}
                onChange={(value) => updateField('roles', value)}
                placeholder="Select roles"
                searchable
                clearable
              />
            </SectionCard>

            {/* Auth Status Section */}
            <SectionCard variant="form" title="Auth Status">
              <Stack gap="xs">
                <Group gap="sm">
                  <Text size="sm" c="dimmed" w={120}>Password set:</Text>
                  <Badge
                    color={authStatus?.hasPassword ? 'green' : 'red'}
                    variant="light"
                    size="sm"
                  >
                    {authStatus?.hasPassword ? 'Yes' : 'No'}
                  </Badge>
                </Group>
                <Group gap="sm">
                  <Text size="sm" c="dimmed" w={120}>Last login:</Text>
                  <Text size="sm">
                    {authStatus?.lastLogin
                      ? new Date(authStatus.lastLogin).toLocaleString()
                      : 'Never'}
                  </Text>
                </Group>
                <Group gap="sm">
                  <Text size="sm" c="dimmed" w={120}>Invited by:</Text>
                  <Text size="sm">{authStatus?.invitedBy || 'N/A'}</Text>
                </Group>
                {authStatus?.invitedAt && (
                  <Group gap="sm">
                    <Text size="sm" c="dimmed" w={120}>Invited at:</Text>
                    <Text size="sm">
                      {new Date(authStatus.invitedAt).toLocaleString()}
                    </Text>
                  </Group>
                )}
              </Stack>
            </SectionCard>

            {/* Invite Link Section */}
            <SectionCard variant="form" title="Invite Link">
              <Stack gap="sm">
                <Text size="sm" c="dimmed">
                  Generate a one-time invite link for this user to set their password.
                  This will reset any existing password.
                </Text>
                <Button
                  variant="light"
                  onClick={handleGenerateInvite}
                  loading={inviteLoading}
                  size="sm"
                >
                  Generate Invite Link
                </Button>
                {inviteUrl && (
                  <Group gap="xs" align="flex-end">
                    <TextInput
                      label="Invite URL"
                      value={inviteUrl}
                      readOnly
                      variant="filled"
                      style={{ flex: 1 }}
                    />
                    <CopyButton value={inviteUrl} timeout={2000}>
                      {({ copied, copy }) => (
                        <Tooltip label={copied ? 'Copied' : 'Copy'} withArrow position="right">
                          <ActionIcon
                            color={copied ? 'teal' : 'gray'}
                            variant="subtle"
                            onClick={copy}
                            mb={2}
                          >
                            {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                          </ActionIcon>
                        </Tooltip>
                      )}
                    </CopyButton>
                  </Group>
                )}
              </Stack>
            </SectionCard>
          </Stack>
        </Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export default MemberEditor;
