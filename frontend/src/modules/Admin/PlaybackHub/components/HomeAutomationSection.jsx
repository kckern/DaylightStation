import React, { useState, useEffect } from 'react';
import { Stack, Group, TextInput, Switch, Button, Text } from '@mantine/core';

/**
 * HomeAutomationSection — bind a public device to a home-automation entity.
 *
 * "home-automation" is the bounded context (see 3_applications/home-automation/);
 * the underlying vendor name lives inside the adapter layer only.
 *
 * Wire shape (input from useHubConfig): snake_case
 *   slot.ha_entity_id, slot.ha_turn_off_on_stop
 * Patch shape (output to updateDevice): camelCase per HubDevice.update API
 *   { haEntityId, haTurnOffOnStop }
 *
 * Public-class invariant: if class is 'public', haEntityId MUST be non-empty.
 * The Save button is disabled (with an inline warning) when this is violated.
 *
 * Props:
 *   slot:      device config { color, class, ha_entity_id?, ha_turn_off_on_stop?, ... }
 *   mutations: object from useHubMutations
 */
export function HomeAutomationSection({ slot, mutations }) {
  const initialEntity = slot?.ha_entity_id ?? '';
  const initialTurnOff = slot?.ha_turn_off_on_stop === true;

  const [baseline, setBaseline] = useState({
    haEntityId: initialEntity,
    haTurnOffOnStop: initialTurnOff,
  });
  const [vals, setVals] = useState(baseline);
  const [saving, setSaving] = useState(false);

  // Re-sync when slot prop changes (after revalidate).
  useEffect(() => {
    const next = {
      haEntityId: slot?.ha_entity_id ?? '',
      haTurnOffOnStop: slot?.ha_turn_off_on_stop === true,
    };
    setBaseline(next);
    setVals(next);
  }, [slot?.ha_entity_id, slot?.ha_turn_off_on_stop]);

  const isDirty =
    vals.haEntityId !== baseline.haEntityId ||
    vals.haTurnOffOnStop !== baseline.haTurnOffOnStop;

  const isPublic = slot?.class === 'public';
  const entityEmpty = !vals.haEntityId || vals.haEntityId.length === 0;
  const violatesPublicInvariant = isPublic && entityEmpty;

  const handleSave = async () => {
    if (violatesPublicInvariant) return;
    setSaving(true);
    try {
      await mutations.updateDevice(slot.color, {
        haEntityId: vals.haEntityId,
        haTurnOffOnStop: vals.haTurnOffOnStop,
      });
      setBaseline({ ...vals });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="sm">
      <TextInput
        label="Home automation entity ID"
        aria-label="Home automation entity ID"
        value={vals.haEntityId}
        onChange={(e) => setVals({ ...vals, haEntityId: e.currentTarget.value })}
        placeholder="switch.bedroom_light"
        error={
          violatesPublicInvariant
            ? 'Required for public-class devices'
            : undefined
        }
      />
      <Switch
        label="Turn off entity when playback stops"
        checked={!!vals.haTurnOffOnStop}
        onChange={(e) =>
          setVals({ ...vals, haTurnOffOnStop: e.currentTarget.checked })
        }
      />
      <Group>
        <Button
          onClick={handleSave}
          loading={saving}
          disabled={!isDirty || violatesPublicInvariant || saving}
        >
          Save
        </Button>
      </Group>
    </Stack>
  );
}

export default HomeAutomationSection;
