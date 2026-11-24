import { useRef, useState } from 'react';
import { Stack, Paper, Text, Group, Badge, Switch } from '@mantine/core';
import { IconCalendarEvent, IconFlame } from '@tabler/icons-react';
import { useCeremonyConfig } from "../../hooks/useLifePlan.js";
import { Button, Toast, ToastRegion, useRetryRegion } from '@/lib/ui';
import { LifePage, LoadingState, ErrorState } from "../../components/index.js";
import { formatPeriodLabel } from "../../lib/format.js";

const CEREMONY_TYPES = [
  { id: 'unit_intention', label: 'Unit Intention', description: 'Set intentions at the start of each unit' },
  { id: 'unit_capture', label: 'Daily Capture', description: 'Reflect on how the day went each evening' },
  { id: 'cycle_retro', label: 'Cycle Retrospective', description: 'Review progress at end of each cycle' },
  { id: 'phase_review', label: 'Phase Review', description: 'Deep review of goals and beliefs each phase' },
  { id: 'season_alignment', label: 'Season Alignment', description: 'Value alignment check each season' },
  { id: 'era_vision', label: 'Era Vision', description: 'Long-term purpose and direction review' },
];

function CeremonySwitch({ type, enabled, readingBack, save, onError }) {
  const control = useRef(null);
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);

  const change = async event => {
    if (pending.current || readingBack) return;
    const input = event.currentTarget;
    pending.current = true;
    setSaving(true);
    try {
      await save(type.id, input.checked);
    } catch (err) {
      if (control.current === input) {
        onError(err.message);
      }
    } finally {
      pending.current = false;
      if (control.current === input) setSaving(false);
    }
  };

  return <Switch ref={control} aria-label={type.label} aria-disabled={saving || readingBack} checked={enabled} onChange={change} />;
}

export function CeremonyConfig({ username }) {
  const { ceremonies, current, loading, readingBack, error, refetch, setCeremonyEnabled } = useCeremonyConfig(username);
  const { regionProps, retry } = useRetryRegion(refetch, loading || readingBack);
  const [saveError, setSaveError] = useState(null);

  const content = loading ? <LoadingState /> : error
    ? <ErrorState label="Ceremonies" error={error} onRetry={retry} />
    : (
      <>
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
                    {formatPeriodLabel({ ...pos, level })}
                  </Badge>
                )
              ))}
            </Group>
          </Paper>
        )}

        <Stack gap="sm">
          {CEREMONY_TYPES.map(type => {
            const ceremonyConfig = ceremonies[type.id] || {};
            const enabled = ceremonyConfig.enabled === true;

            return (
              <Paper key={type.id} p="sm" withBorder>
                <Group justify="space-between" mb="xs">
                  <Stack gap={2}>
                    <Text size="sm" fw={500}>{type.label}</Text>
                    <Text size="xs" c="dimmed">{type.description}</Text>
                  </Stack>
                  <CeremonySwitch type={type} enabled={enabled} readingBack={readingBack} save={setCeremonyEnabled} onError={setSaveError} />
                </Group>

                {enabled && (
                  <Group gap="md">
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
      </>
    );

  return (
    <LifePage title="Ceremonies" scrollReady={!loading && !error}>
      <section {...regionProps} aria-label="Ceremonies results">
        {content}
      </section>
      <ToastRegion>
        {saveError != null && (
          <Toast tone="error" autoCloseMs={8000} onAutoClose={() => setSaveError(null)}
            message={`Couldn't update ceremony: ${saveError}`}>
            <Button density="compact" variant="secondary" onClick={() => setSaveError(null)}>Dismiss</Button>
          </Toast>
        )}
      </ToastRegion>
    </LifePage>
  );
}
