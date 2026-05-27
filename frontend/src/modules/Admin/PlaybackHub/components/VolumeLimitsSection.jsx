import React, { useState, useEffect } from 'react';
import { Group, NumberInput, Button, Stack } from '@mantine/core';

/**
 * VolumeLimitsSection — edit a device's volume bounds.
 *
 * Three NumberInputs (default/min/max) + Save button. Save is disabled
 * until a field has changed; on click, PATCHes the device with the full
 * { volume: { default, min, max } } block. After a successful save, the
 * baseline rebaselines so the form is no longer dirty.
 *
 * Props:
 *   slot:      device config { color, volume:{default,min,max}, ... }
 *   mutations: object from useHubMutations
 */
export function VolumeLimitsSection({ slot, mutations }) {
  const initialDefault = slot?.volume?.default ?? 0;
  const initialMin = slot?.volume?.min ?? 0;
  const initialMax = slot?.volume?.max ?? 100;

  const [baseline, setBaseline] = useState({
    default: initialDefault,
    min: initialMin,
    max: initialMax,
  });
  const [vals, setVals] = useState(baseline);
  const [saving, setSaving] = useState(false);

  // If the slot prop changes externally (e.g. revalidate after save), re-baseline.
  useEffect(() => {
    const next = {
      default: slot?.volume?.default ?? 0,
      min: slot?.volume?.min ?? 0,
      max: slot?.volume?.max ?? 100,
    };
    setBaseline(next);
    setVals(next);
  }, [slot?.volume?.default, slot?.volume?.min, slot?.volume?.max]);

  const isDirty =
    vals.default !== baseline.default ||
    vals.min !== baseline.min ||
    vals.max !== baseline.max;

  const handleSave = async () => {
    setSaving(true);
    try {
      await mutations.updateDevice(slot.color, { volume: { ...vals } });
      setBaseline({ ...vals });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack gap="sm">
      <Group gap="sm" align="flex-end" wrap="wrap">
        <NumberInput
          label="Default"
          value={vals.default}
          onChange={(v) => setVals({ ...vals, default: Number(v) || 0 })}
          min={0}
          max={100}
          w={120}
        />
        <NumberInput
          label="Min"
          value={vals.min}
          onChange={(v) => setVals({ ...vals, min: Number(v) || 0 })}
          min={0}
          max={100}
          w={120}
        />
        <NumberInput
          label="Max"
          value={vals.max}
          onChange={(v) => setVals({ ...vals, max: Number(v) || 0 })}
          min={0}
          max={100}
          w={120}
        />
        <Button onClick={handleSave} disabled={!isDirty || saving} loading={saving}>
          Save
        </Button>
      </Group>
    </Stack>
  );
}

export default VolumeLimitsSection;
