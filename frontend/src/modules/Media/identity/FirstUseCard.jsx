// frontend/src/modules/Media/identity/FirstUseCard.jsx
// The first-use moment (RQ-RELY-12, RELY.14a): the first time the app opens
// on a device that has never been named, ask for a name — a sensible default
// for this kind of device, and Skip — and explain the aim label once. It sits
// at the top of Home until answered; it never blocks the page, and once
// named or skipped it never returns on this device.
import React, { useEffect, useMemo, useState } from 'react';
import { Button, Group, Text, TextInput, Title } from '@mantine/core';
import { useClientIdentity } from './useClientIdentity.js';
import { GlobalAimLabel } from '../cast/AimLabel.jsx';
import houseLog from '../house/houseLog.js';
import '../house/House.scss';

/** A default name from the kind of device ("iPhone", "Android tablet", "Mac"). */
export function suggestDeviceName(userAgent = (typeof navigator !== 'undefined' ? navigator.userAgent : '')) {
  const ua = String(userAgent || '');
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return /Mobile/.test(ua) ? 'Android phone' : 'Android tablet';
  if (/CrOS/.test(ua)) return 'Chromebook';
  if (/Macintosh|Mac OS X/.test(ua)) return 'Mac';
  if (/Windows/.test(ua)) return 'Windows PC';
  if (/Linux/.test(ua)) return 'Linux PC';
  return 'This browser';
}

export function FirstUseCard() {
  const identity = useClientIdentity();
  const suggestion = useMemo(() => suggestDeviceName(), []);
  const [name, setName] = useState(suggestion);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const show = !!identity.firstUse;
  useEffect(() => {
    if (show) houseLog.firstUseShown({ deviceId: identity.deviceId, suggestion });
  }, [show, identity.deviceId, suggestion]);
  if (!show) return null;

  const save = async (override) => {
    const chosen = (override ?? name).trim();
    if (!chosen) return;
    setBusy(true);
    const result = await identity.rename({ name: chosen });
    setBusy(false);
    if (result?.ok) { identity.completeFirstUse('named'); return; }
    setAnswer({ ...result, name: chosen });
  };

  return (
    <section className="house-first-use" data-testid="first-use-card" aria-labelledby="first-use-title">
      <Title order={2} size="h4" id="first-use-title">Name this device</Title>
      <Text size="sm">Everyone in the house, and any routine, will see it by this name.</Text>
      <Group align="flex-end" gap="xs" wrap="wrap">
        <TextInput
          label="Device name"
          value={name}
          onChange={(e) => { setName(e.currentTarget.value); setAnswer(null); }}
          data-testid="first-use-name"
          style={{ flex: '1 1 200px' }}
        />
        <Button className="house-action" disabled={!name.trim()} loading={busy} onClick={() => save()} data-testid="first-use-save">
          Save name
        </Button>
        <Button variant="default" className="house-action" onClick={() => identity.completeFirstUse('skipped')} data-testid="first-use-skip">
          Skip
        </Button>
      </Group>
      {answer?.code === 'NAME_TAKEN' && (
        <Group gap="xs" role="alert" data-testid="first-use-taken">
          <Text size="sm">“{answer.name}” is already taken.</Text>
          {answer.suggestion && (
            <Button size="xs" variant="light" className="house-action" onClick={() => { setName(answer.suggestion); save(answer.suggestion); }}
              data-testid="first-use-suggestion">
              Use “{answer.suggestion}”
            </Button>
          )}
        </Group>
      )}
      {answer && answer.code !== 'NAME_TAKEN' && (
        <Text size="sm" className="house-tone--failed" role="alert">Couldn't save the name. You can skip and name it later in Settings.</Text>
      )}
      <div data-testid="first-use-aim">
        <Text size="sm" fw={600}>Where your taps play</Text>
        <Text size="sm">
          The aim label shows where Play sends things — this device, or a screen you picked. It appears above what you
          browse and play, like this: <GlobalAimLabel compact />
        </Text>
        <Text size="sm" c="dimmed">You can change it whenever you play something.</Text>
      </div>
    </section>
  );
}

export default FirstUseCard;
