import { Stack, Text } from '@mantine/core';
import { SectionCard } from '../../../lib/ui';
import { useHealthDisplayPreferences } from './HealthDisplayPreferences.jsx';

export default function HealthDisplaySettings() {
  const { densityPlacement, setDensityPlacement } = useHealthDisplayPreferences();
  return <SectionCard title="Food log display">
    <Stack gap="xs">
      <Text size="sm">Choose where energy density appears beside each food.</Text>
      <fieldset className="health-display-settings">
        <legend>Density badge placement</legend>
        <label><input type="radio" name="density-placement" value="before" checked={densityPlacement === 'before'} onChange={() => setDensityPlacement('before')} /> Before food name</label>
        <label><input type="radio" name="density-placement" value="after" checked={densityPlacement === 'after'} onChange={() => setDensityPlacement('after')} /> After food name</label>
      </fieldset>
    </Stack>
  </SectionCard>;
}
