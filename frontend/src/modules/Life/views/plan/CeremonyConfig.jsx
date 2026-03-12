import { Stack, Paper, Title, Text, Group, Badge, Switch, Select } from '@mantine/core';
import { IconCalendarEvent, IconFlame } from '@tabler/icons-react';
import { useCeremonyConfig } from '../../hooks/useLifePlan.js';

const CEREMONY_TYPES = [
  { id: 'unit_intention', label: 'Unit Intention', description: 'Set intentions at the start of each unit' },
  { id: 'cycle_retro', label: 'Cycle Retrospective', description: 'Review progress at end of each cycle' },
  { id: 'phase_review', label: 'Phase Review', description: 'Deep review of goals and beliefs each phase' },
  { id: 'season_alignment', label: 'Season Alignment', description: 'Value alignment check each season' },
  { id: 'era_vision', label: 'Era Vision', description: 'Long-term purpose and direction review' },
];

const CHANNELS = [
  { value: 'push', label: 'Push Notification' },
  { value: 'email', label: 'Email' },
  { value: 'screen', label: 'Screen Overlay' },
];

export function CeremonyConfig({ username }) {
  const { config, current, loading, updateCadence } = useCeremonyConfig(username);

  if (loading) return null;

  const ceremonies = config?.ceremonies || {};

  const toggleCeremony = async (type, enabled) => {
    const updated = {
      ...config,
      ceremonies: {
        ...ceremonies,
        [type]: { ...(ceremonies[type] || {}), enabled },
      },
    };
    await updateCadence(updated);
  };

  const setChannel = async (type, channel) => {
    const updated = {
      ...config,
      ceremonies: {
        ...ceremonies,
        [type]: { ...(ceremonies[type] || {}), channel },
      },
    };
    await updateCadence(updated);
  };

  return (
    <Stack gap="md">
      <Title order={4}>Ceremonies</Title>

      {current && (
        <Paper p="sm" withBorder>
          <Group gap="sm" mb="xs">
            <IconCalendarEvent size={18} />
            <Text size="sm" fw={500}>Current Position</Text>
          </Group>
          <Group gap="xs">
            {Object.entries(current).map(([level, pos]) => (
              pos && (
                <Badge key={level} variant="outline" size="sm" color="blue">
                  {pos.alias || level}: {pos.periodId}
                </Badge>
              )
            ))}
          </Group>
        </Paper>
      )}

      <Stack gap="sm">
        {CEREMONY_TYPES.map(type => {
          const ceremonyConfig = ceremonies[type.id] || {};
          const enabled = ceremonyConfig.enabled !== false;

          return (
            <Paper key={type.id} p="sm" withBorder>
              <Group justify="space-between" mb="xs">
                <Stack gap={2}>
                  <Text size="sm" fw={500}>{type.label}</Text>
                  <Text size="xs" c="dimmed">{type.description}</Text>
                </Stack>
                <Switch
                  checked={enabled}
                  onChange={(e) => toggleCeremony(type.id, e.currentTarget.checked)}
                />
              </Group>

              {enabled && (
                <Group gap="md">
                  <Select
                    label="Channel"
                    data={CHANNELS}
                    value={ceremonyConfig.channel || 'push'}
                    onChange={(v) => setChannel(type.id, v)}
                    size="xs"
                    style={{ width: 180 }}
                  />
                  {ceremonyConfig.streak > 0 && (
                    <Group gap={4}>
                      <IconFlame size={14} color="orange" />
                      <Text size="xs" fw={500}>{ceremonyConfig.streak} streak</Text>
                    </Group>
                  )}
                  {ceremonyConfig.adherence !== undefined && (
                    <Badge variant="light" size="sm">
                      {Math.round(ceremonyConfig.adherence * 100)}% adherence
                    </Badge>
                  )}
                </Group>
              )}
            </Paper>
          );
        })}
      </Stack>
    </Stack>
  );
}
