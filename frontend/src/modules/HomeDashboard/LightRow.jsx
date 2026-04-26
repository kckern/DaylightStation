import { useState, useEffect } from 'react';
import { Switch, Group, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import './LightRow.scss';

export default function LightRow({ lights, onToggle }) {
  return (
    <div className="light-row">
      {lights.map((light) => (
        <LightItem key={light.entityId} light={light} onToggle={onToggle} />
      ))}
    </div>
  );
}

function LightItem({ light, onToggle }) {
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
      notifications.show({
        color: 'red',
        title: 'Light',
        message: `Couldn't reach ${light.label}`,
      });
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
