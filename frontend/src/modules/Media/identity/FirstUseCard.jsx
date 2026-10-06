// frontend/src/modules/Media/identity/FirstUseCard.jsx
// The first-use moment (RQ-RELY-12, RELY.14a): the first time the app opens on
// a device that has never been named, a small popover anchored to the header's
// destination control asks "What should we call this device?" — a sensible
// default for this kind of device, Save, or Not now — and says in one sentence
// where taps go. It takes no page space, opens once, and once named or
// skipped it never returns on this device (the first-use store).
//
// `children` is the anchor: the destination control it points at.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Group, Popover, Text, TextInput } from '@mantine/core';
import { useClientIdentity } from './useClientIdentity.js';
import { useDismissLayer } from '../shell/useDismissLayer.js';
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

export function FirstUseCard({ children = null }) {
  const identity = useClientIdentity();
  const suggestion = useMemo(() => suggestDeviceName(), []);
  const [name, setName] = useState(suggestion);
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const show = !!identity.firstUse;
  useEffect(() => {
    if (show) houseLog.firstUseShown({ deviceId: identity.deviceId, suggestion });
  }, [show, identity.deviceId, suggestion]);

  const skip = useCallback(() => identity.completeFirstUse('skipped'), [identity]);
  // Escape answers it like "Not now" (the shell owns Escape, one layer at a time).
  useDismissLayer(show, skip);

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
    <Popover
      opened={show}
      position="bottom-start"
      withinPortal
      trapFocus={false}
      closeOnClickOutside={false}
      closeOnEscape={false}
      width={320}
      shadow="md"
      // Under the full-screen Search Mode (a 200-tier surface): the prompt never covers it.
      zIndex={150}
    >
      <Popover.Target>
        <span className="media-destination-anchor">{children}</span>
      </Popover.Target>
      <Popover.Dropdown
        className="media-first-use"
        data-testid="first-use-card"
        role="dialog"
        aria-labelledby="first-use-title"
      >
        <Text fw={600} id="first-use-title">What should we call this device?</Text>
        <TextInput
          aria-label="Name for this device"
          value={name}
          onChange={(e) => { setName(e.currentTarget.value); setAnswer(null); }}
          data-testid="first-use-name"
          mt="xs"
        />
        <Text size="sm" c="dimmed" mt="xs" data-testid="first-use-aim">
          Things you play go to the device shown here. Tap it to change.
        </Text>
        {answer?.code === 'NAME_TAKEN' && (
          <Group gap="xs" role="alert" data-testid="first-use-taken" mt="xs">
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
          <Text size="sm" className="house-tone--failed" role="alert" mt="xs">Couldn't save the name. You can skip and name it later in Settings.</Text>
        )}
        <Group gap="xs" mt="sm" justify="flex-end">
          <Button variant="default" className="house-action" onClick={skip} data-testid="first-use-skip">
            Not now
          </Button>
          <Button className="house-action" disabled={!name.trim()} loading={busy} onClick={() => save()} data-testid="first-use-save">
            Save
          </Button>
        </Group>
      </Popover.Dropdown>
    </Popover>
  );
}

export default FirstUseCard;
