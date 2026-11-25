import { useState, useEffect } from 'react';
import { Switch, Group, Text } from '@mantine/core';
import { Toast, ToastRegion } from '@/lib/ui';
import "./LightRow.scss";

export default function LightRow({ lights, onToggle }) {
  const [failedLabel, setFailedLabel] = useState(null);
  return (
    <div className="light-row">
      {lights.map((light) => (
        <LightItem key={light.entityId} light={light} onToggle={onToggle} onFail={setFailedLabel} />
      ))}
      <ToastRegion>
        {failedLabel != null && (
          <Toast tone="error" autoCloseMs={4000} onAutoClose={() => setFailedLabel(null)}
            message={`Couldn't reach ${failedLabel}`} />
        )}
      </ToastRegion>
    </div>
  );
}

function LightItem({ light, onToggle, onFail }) {
  const [checked, setChecked] = useState(light.on);

  useEffect(() => {
    setChecked(light.on);
  }, [light.on]);

  const handle = async (e) => {
    const next = e.currentTarget.checked;
    setChecked(next); // optimistic
    const ok = await onToggle(light.entityId, next ? 'on' : 'off');
    if (!ok) {
      setChecked(!next); // revert
      onFail(light.label);
    }
  };

  return (
    <Group
      className={`light-row__item ${light.available ? '' : 'light-row__item--unavailable'}`}
      justify="space-between"
    >
      <Text size="sm">{light.label}</Text>
      <Switch checked={checked} onChange={handle} disabled={!light.available} />
    </Group>
  );
}
