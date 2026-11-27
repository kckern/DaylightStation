// house/PhoneKeepsView.jsx
// What is on a phone (ops:docs/superpowers/specs/2026-11-26-phone-downloads-lifecycle.md §3.2, §3.7, §3.8):
// per install, the items it keeps (largest first) with size and state, the room ("1.2 GB
// kept · 4 GB limit · 15 GB free on phone"), "Kept automatically" on what the phone kept while
// listening (§3.10, in the item's status line), Remove per item, the keeps still waiting
// for it (with the time asked and Cancel), its refusals, and installs gone for 30 days.
// Reads through PhoneKeepsProvider, so it refreshes only while shown.
import React, { useEffect } from 'react';
import { Badge, Button, Group, Stack, Text, Title } from '@mantine/core';
import { usePhoneKeeps, useWatchPhoneKeeps } from "../cast/usePhoneKeeps.jsx";
import { phonePage, formatBytes, KEEP_PROBLEM_STATES } from "../cast/phoneKeeps.js";
import { useNav } from "../shell/NavProvider.jsx";
import mediaLog from "../logging/mediaLog.js";

export function PhoneKeepsView({ deviceId }) {
  const { phones, views, run, refresh } = usePhoneKeeps();
  useWatchPhoneKeeps(null, { always: true });
  const { pop, backDestination } = useNav();
  const phone = phones.find((p) => p.id === deviceId) ?? { id: deviceId, name: deviceId };
  const view = views[deviceId];
  const page = phonePage(phone, view);
  useEffect(() => { mediaLog.phoneKeepsPageShown?.({ deviceId }); }, [deviceId]);

  const back = (
    <Button variant="subtle" color="gray" data-testid="phone-keeps-back" onClick={() => pop()}>
      ← {backDestination ?? 'Devices'}
    </Button>
  );
  if (!view) {
    return (
      <Stack component="section" gap="md" aria-label={`What is on ${page.name}`} data-testid="phone-keeps-view">
        {back}
        <Title order={1}>On {page.name}</Title>
        <Text c="dimmed" data-testid="phone-keeps-loading">Asking home what {page.name} keeps…</Text>
        <Button variant="default" onClick={() => refresh()}>Retry</Button>
      </Stack>
    );
  }
  return (
    <Stack component="section" gap="md" aria-label={`What is on ${page.name}`} data-testid="phone-keeps-view">
      {back}
      <Title order={1}>On {page.name}</Title>
      {page.storeUnavailable && (
        <Text c="red" role="alert" data-testid="phone-keeps-store">Home cannot save keep requests right now; new ones will fail until it can.</Text>
      )}
      {page.waiting.length > 0 && (
        <Stack gap="xs" data-testid="phone-keeps-waiting">
          <Title order={3}>Waiting for {page.name}</Title>
          {page.waiting.map((w) => (
            <Group key={w.commandId} justify="space-between" data-testid="phone-keeps-waiting-row">
              <Text size="sm">{w.command === 'unkeep' ? 'Remove' : 'Keep'} {w.title ?? w.contentId}{w.asked ? ` · asked ${w.asked}` : ''}{w.handedOver ? ' · sent' : ''}</Text>
              {!w.handedOver && (
                <Button size="compact-sm" variant="subtle" data-testid="phone-keeps-cancel"
                  onClick={() => run(`cancelKeepOn:${deviceId}#${w.commandId}`, { id: w.contentId, title: w.title })}>Cancel</Button>
              )}
            </Group>
          ))}
        </Stack>
      )}
      {page.refused.length > 0 && (
        <Stack gap="xs" data-testid="phone-keeps-refused">
          {page.refused.map((r) => (
            <Text key={`${r.contentId}@${r.installId ?? ''}`} size="sm" c="red">{page.name} refused {r.contentId}: {r.reason}</Text>
          ))}
        </Stack>
      )}
      {page.installs.length === 0 && <Text c="dimmed" data-testid="phone-keeps-none">{page.name} has not been seen yet.</Text>}
      {page.installs.map((install) => (
        <Stack key={install.installId} gap="xs" data-testid="phone-keeps-install" data-gone={install.gone || undefined}>
          <Group gap="xs">
            <Title order={3}>{install.model || 'This phone'}</Title>
            {install.current && !install.gone && <Badge variant="light">in use</Badge>}
            {install.gone && <Badge color="gray" data-testid="phone-keeps-gone">gone</Badge>}
            {!install.gone && !install.live && <Badge color="gray" variant="outline">not connected</Badge>}
          </Group>
          {install.gone
            ? <Text size="sm" c="dimmed">Not seen for 30 days (last {install.lastPollAt ? new Date(install.lastPollAt).toLocaleDateString() : 'unknown'}). A new install takes over what waited for it.</Text>
            : <Text size="sm" data-testid="phone-keeps-space">{install.space}</Text>}
          {!install.gone && install.items.length === 0 && <Text size="sm" c="dimmed">Nothing kept.</Text>}
          {!install.gone && install.items.map((it) => (
            <Group key={it.contentId} justify="space-between" wrap="nowrap" data-testid="phone-keeps-item" data-state={it.state} data-auto={it.auto || undefined}>
              <Stack gap={0}>
                <Text size="sm" fw={500}>{it.title ?? it.contentId}</Text>
                <Text size="xs" c={KEEP_PROBLEM_STATES.has(it.state) ? 'red' : 'dimmed'}>
                  {[it.status.line, it.state !== 'ready' && it.bytes ? formatBytes(it.bytes) : null, it.finished ? 'Finished' : null].filter(Boolean).join(' · ')}
                </Text>
              </Stack>
              {it.state !== 'removing' && (
                <Button size="compact-sm" variant="subtle" color="red" data-testid="phone-keeps-remove"
                  onClick={() => run(`unkeepOn:${deviceId}@${install.installId}`, { id: it.contentId, title: it.title })}>Remove</Button>
              )}
            </Group>
          ))}
        </Stack>
      ))}
    </Stack>
  );
}

export default PhoneKeepsView;
