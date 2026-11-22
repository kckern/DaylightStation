import React, { useState, useEffect } from 'react';
import { Group, NumberInput, Button, Stack, Text } from '@mantine/core';
import { DEFAULT_VOLUME_BOUNDS, isValidVolumeBounds, VOLUME_LIMIT_MAX, VOLUME_LIMIT_MIN } from '@shared-contracts/media/volumeBounds.mjs';

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
  const initialDefault = slot?.volume?.default ?? DEFAULT_VOLUME_BOUNDS.default;
  const initialMin = slot?.volume?.min ?? DEFAULT_VOLUME_BOUNDS.min;
  const initialMax = slot?.volume?.max ?? DEFAULT_VOLUME_BOUNDS.max;

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
      default: slot?.volume?.default ?? DEFAULT_VOLUME_BOUNDS.default,
      min: slot?.volume?.min ?? DEFAULT_VOLUME_BOUNDS.min,
      max: slot?.volume?.max ?? DEFAULT_VOLUME_BOUNDS.max,
    };
    setBaseline(next);
    setVals(next);
  }, [slot?.volume?.default, slot?.volume?.min, slot?.volume?.max]);

  const isDirty =
    vals.default !== baseline.default ||
    vals.min !== baseline.min ||
    vals.max !== baseline.max;
  const hasValidBounds = isValidVolumeBounds(vals);

  const handleSave = async () => {
    if (!hasValidBounds || saving) return;
    setSaving(true);
    try {
      const out = await mutations.updateDevice(slot.color, { volume: { ...vals } });
      if (out?.ok) {
        setBaseline({ ...vals });
      }
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
          min={VOLUME_LIMIT_MIN}
          max={VOLUME_LIMIT_MAX}
          w={120}
        />
        <NumberInput
          label="Min"
          value={vals.min}
          onChange={(v) => setVals({ ...vals, min: Number(v) || 0 })}
          min={VOLUME_LIMIT_MIN}
          max={VOLUME_LIMIT_MAX}
          w={120}
        />
        <NumberInput
          label="Max"
          value={vals.max}
          onChange={(v) => setVals({ ...vals, max: Number(v) || 0 })}
          min={VOLUME_LIMIT_MIN}
          max={VOLUME_LIMIT_MAX}
          w={120}
        />
        <Button onClick={handleSave} disabled={!isDirty || !hasValidBounds || saving} loading={saving}>
          Save
        </Button>
      </Group>
      {!hasValidBounds && <Text size="sm" c="red" role="alert">Volume limits must be from 0 to 100, with Min ≤ Default ≤ Max.</Text>}
    </Stack>
  );
}

export default VolumeLimitsSection;
