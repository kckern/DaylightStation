import { useCallback, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Anchor, Badge, Button, Group, SegmentedControl, Stack, Table, Text, TextInput } from '@mantine/core';
import { DaylightAPI } from '../../../../../../frontend/src/lib/api.mjs';
import { useApiResource } from '../../../../../../frontend/src/lib/hooks/useApiResource.js';
import { LoadingState, ErrorState, EmptyState, SectionCard, createAppLogger } from '../../../../../../frontend/src/lib/ui/index.js';

/**
 * Admin -> Content filter: the grown-up's review of a title's scenes.
 * Each scene shows what Jev judged (situation / picture per group), what the
 * household profile does with it, and the draft title card. A grown-up can
 * watch it, change its effect, and approve or edit the card; only an approved
 * card is ever shown to a child.
 * Design: ops:docs/superpowers/specs/2026-11-06-content-filter-scenes-design.md
 */

const logger = createAppLogger('admin').child('content-filter');
const API = 'api/v1/content-filter';
const GROUP = { violence_blood_gore: 'Violence', sex_nudity_immodesty: 'Nudity', sex_any: 'Sexual' };
const EFFECT_LABEL = { blackout: 'Blackout', skip: 'Skip', null: 'Plays' };
const clock = (t) => (t == null ? '—' : `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`);

export function ContentFilterIndex() {
  const { data, loading, error, reload } = useApiResource(API, { label: 'content filters', logger });
  if (loading) return <LoadingState label="content filters" rows={3} />;
  if (error) return <ErrorState error={error} onRetry={reload} label="Content filters" />;
  const titles = data?.titles ?? [];
  return (
    <SectionCard title="Content filter">
      {!titles.length ? (
        <EmptyState title="No refined filters yet" hint="A title appears here once refine has written its refined filter." />
      ) : (
        <Table highlightOnHover>
          <Table.Thead>
            <Table.Tr><Table.Th>Title</Table.Th><Table.Th>Scenes</Table.Th><Table.Th>Hidden</Table.Th><Table.Th>Cards approved</Table.Th><Table.Th>Certified</Table.Th></Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {titles.map((t) => (
              <Table.Tr key={t.ratingKey}>
                <Table.Td><Anchor component={Link} to={`/admin/content/filter/${t.ratingKey}`}>{t.title}</Anchor>{t.year ? <Text span c="dimmed" size="sm"> ({t.year})</Text> : null}</Table.Td>
                <Table.Td>{t.scenes}</Table.Td>
                <Table.Td>{t.hiding}</Table.Td>
                <Table.Td>{t.cardsApproved} / {t.hiding}</Table.Td>
                <Table.Td><Badge size="sm" variant="light" color={t.certification === 'none' ? 'gray' : 'green'}>{t.certification}</Badge></Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      )}
    </SectionCard>
  );
}

export function ContentFilterScenes() {
  const { ratingKey } = useParams();
  const url = `${API}/${encodeURIComponent(ratingKey)}/scenes`;
  const { data, loading, error, reload } = useApiResource(url, { label: 'scenes', logger });
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState(null);

  const act = useCallback(async (key, fn, done) => {
    if (busy) return;
    setBusy(key); setNotice(null);
    try { await fn(); if (done) setNotice(done); reload(); } catch (err) {
      logger.warn('scene.action_failed', { ratingKey, key, error: err.message });
      setNotice(err.message || 'That did not work.');
    } finally { setBusy(null); }
  }, [busy, ratingKey, reload]);

  const draft = (force) => act('draft', async () => {
    const r = await DaylightAPI(`${url}/cards`, { force }, 'POST');
    logger.info('cards.drafted', { ratingKey, drafted: r.drafted });
  }, force ? 'Cards redrafted.' : 'Missing cards drafted.');

  const rule = (sceneId, body) => act(sceneId, async () => {
    await DaylightAPI(`${url}/${encodeURIComponent(sceneId)}`, body, 'PUT');
    logger.info('scene.ruled', { ratingKey, sceneId, body });
  });

  if (loading) return <LoadingState label="scenes" rows={4} />;
  if (error) return <ErrorState error={error} onRetry={reload} label="Scenes" />;
  const scenes = data?.scenes ?? [];
  const cal = data?.calibration || {};
  return (
    <SectionCard
      title={`${data?.title ?? 'Title'}: scenes`}
      actions={(
        <Group gap="xs">
          <Button size="compact-xs" variant="light" loading={busy === 'draft'} disabled={Boolean(busy)} onClick={() => draft(false)}>Draft missing cards</Button>
          <Button size="compact-xs" variant="subtle" disabled={Boolean(busy)} onClick={() => draft(true)}>Redraft all</Button>
        </Group>
      )}
    >
      <Stack gap="sm">
        <Text size="sm" c="dimmed">
          Jev judged each scene: situation (what happens) and picture (how graphic), 0–3.
          {' '}Trusted: situation {cal.situation || 'no'}, picture {cal.picture || 'no'}.
          {' '}Only an approved card is shown to a child; otherwise "Scene hidden." or "Scene skipped."
        </Text>
        {notice ? <Text size="sm">{notice}</Text> : null}
        {!scenes.length ? <EmptyState title="No scenes" hint="Run contentfilter scenes for this title." /> : scenes.map((s) => (
          <SceneRow key={s.id} ratingKey={ratingKey} scene={s} busy={busy === s.id} disabled={Boolean(busy)} onRule={(body) => rule(s.id, body)} />
        ))}
      </Stack>
    </SectionCard>
  );
}

function SceneRow({ ratingKey, scene, busy, disabled, onRule }) {
  const [editing, setEditing] = useState(false);
  const approved = scene.ruling?.card?.text || null;
  const [text, setText] = useState(approved || scene.card?.text || '');
  const playHref = useMemo(() => {
    const t = Math.max(0, Math.floor((scene.localIn ?? scene.in) - 3));
    return `/screen/living-room?${new URLSearchParams({ play: `plex:${ratingKey}`, goto: String(t), filter: '1' })}`;
  }, [ratingKey, scene]);
  const ruled = scene.ruling?.effect || (scene.ruling?.disabled ? 'off' : 'profile');

  return (
    <div data-scene-id={scene.id} style={{ borderTop: '1px solid var(--mantine-color-default-border)', paddingTop: 8 }}>
      <Group justify="space-between" align="flex-start" wrap="wrap">
        <Stack gap={2}>
          <Group gap="xs">
            <Text fw={600}>{clock(scene.localIn ?? scene.in)}–{clock((scene.localIn ?? scene.in) + (scene.out - scene.in))}</Text>
            <Badge size="sm" color={scene.effect ? 'dark' : 'gray'}>{EFFECT_LABEL[scene.effect] ?? scene.effect}</Badge>
            {scene.reviewNote ? <Badge size="sm" color="orange" title={scene.reviewNote}>check levels</Badge> : null}
            {Object.entries(scene.level || {}).map(([g, l]) => (
              <Badge key={g} size="sm" variant="outline">{GROUP[g] || g}: situation {l.situation} · picture {l.picture}</Badge>
            ))}
          </Group>
          <Text size="sm" c="dimmed">{scene.tags.join(' · ')}</Text>
          {scene.reviewNote ? <Text size="xs" c="orange">{scene.reviewNote}</Text> : null}
        </Stack>
        <Group gap="xs">
          <Anchor href={playHref} target="_blank" rel="noreferrer" size="sm">Play scene</Anchor>
          <SegmentedControl size="xs" disabled={disabled} value={ruled}
            data={[{ label: `Profile (${EFFECT_LABEL[scene.profileEffect] ?? scene.profileEffect})`, value: 'profile' }, { label: 'Off', value: 'off' }, { label: 'Blackout', value: 'blackout' }, { label: 'Skip', value: 'skip' }]}
            onChange={(v) => onRule(v === 'profile' ? { effect: 'profile', disabled: false } : { effect: v })} />
        </Group>
      </Group>
      <Group gap="xs" mt={6} align="center" wrap="wrap">
        {editing ? (
          <>
            <TextInput size="xs" style={{ flex: 1, minWidth: 240 }} maxLength={90} value={text} onChange={(e) => setText(e.currentTarget.value)} aria-label="Card text" />
            <Button size="compact-xs" loading={busy} onClick={() => { onRule({ card: { approve: true, text } }); setEditing(false); }}>Approve</Button>
            <Button size="compact-xs" variant="subtle" onClick={() => setEditing(false)}>Cancel</Button>
          </>
        ) : (
          <>
            <Text size="sm" style={{ flex: 1, minWidth: 240 }}>
              {approved ? <><Badge size="xs" color="green" mr={6}>approved</Badge>{approved}</>
                : scene.card?.text ? <><Badge size="xs" color="yellow" mr={6}>draft</Badge>{scene.card.text}</>
                  : <Text span c="dimmed">No card drafted.</Text>}
            </Text>
            {!approved && scene.card?.text ? <Button size="compact-xs" loading={busy} disabled={disabled} onClick={() => onRule({ card: { approve: true } })}>Approve card</Button> : null}
            <Button size="compact-xs" variant="subtle" disabled={disabled} onClick={() => { setText(approved || scene.card?.text || ''); setEditing(true); }}>Edit card</Button>
            {approved ? <Button size="compact-xs" variant="subtle" color="red" disabled={disabled} onClick={() => onRule({ card: null })}>Withdraw</Button> : null}
          </>
        )}
      </Group>
    </div>
  );
}

export default ContentFilterScenes;
