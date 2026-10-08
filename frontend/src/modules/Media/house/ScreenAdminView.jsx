// frontend/src/modules/Media/house/ScreenAdminView.jsx
// Screen admin (RQ-HOUSE-08, HOUSE.6a): every screen the household knows,
// under its name and room. Add a screen; name it and place it; merge a
// duplicate into its earlier self (confirm first, Unmerge afterwards); retire
// a screen after seeing which routines point at it; restore a retired one.
// Screens silent for 30 days fold into "Not seen lately".
import React, { useEffect, useState } from 'react';
import { Alert, Button, Group, List, Radio, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconArchive, IconArrowBackUp, IconArrowMerge, IconEdit, IconPlus } from '@tabler/icons-react';
import { useFleetContext } from '../fleet/useFleetContext.js';
import { ConfirmDialog } from '../shell/ConfirmDialog.jsx';
import { RenameScreenDialog } from './RenameScreenDialog.jsx';
import { RoomNeighboursSection } from './RoomNeighboursSection.jsx';
import { useScreenAdmin } from './useScreenAdmin.js';
import { clockTime, wasNameLabel } from './houseCopy.js';
import houseLog from './houseLog.js';
import './House.scss';

const KIND_LABEL = { screen: 'Set up in the house config', browser: 'A browser using the app', added: 'Added here' };

function seenLine(screen) {
  if (screen.online === true) return 'Online now';
  if (screen.lastSeen) return `Last seen ${clockTime(screen.lastSeen)}`;
  return 'Not seen yet';
}

function ScreenItem({ screen, admin, others, aliasNames, onRename, onMerge, onRetire }) {
  const names = { ...aliasNames, ...(screen.aliasNames || {}) };
  const [error, setError] = useState(null);
  const was = wasNameLabel(screen);
  const aliases = Array.isArray(screen.aliases) ? screen.aliases : [];
  const unmerge = async (aliasId) => {
    setError(null);
    const result = await admin.unmerge(aliasId);
    if (!result.ok) setError(result.code === 'NOT_MERGED' ? 'That duplicate is no longer merged.' : `Couldn't unmerge: ${result.error}`);
  };
  return (
    <li className="house-item" data-testid={`screen-admin-item-${screen.id}`}>
      <div className="house-item-head">
        <Text fw={600}>{screen.name}</Text>
        {was && <span className="house-was-name">{was}</span>}
        {screen.room && <Text size="sm" c="dimmed">· {screen.room}</Text>}
      </div>
      <Text size="xs" c="dimmed">{KIND_LABEL[screen.kind] ?? 'Screen'} · {seenLine(screen)}</Text>
      {aliases.length > 0 && (
        <Stack gap={4} data-testid={`screen-admin-aliases-${screen.id}`}>
          {aliases.map((aliasId, i) => (
            <Group key={aliasId} gap="xs" wrap="nowrap">
              <Text size="xs" style={{ flex: 1 }}>Includes {names[aliasId] ?? `merged duplicate ${i + 1}`}</Text>
              <Button size="xs" variant="default" className="house-action" leftSection={<IconArrowBackUp size={14} aria-hidden />}
                data-testid={`screen-admin-unmerge-${aliasId}`} onClick={() => unmerge(aliasId)}>
                Unmerge
              </Button>
            </Group>
          ))}
        </Stack>
      )}
      {error && <Text size="sm" className="house-tone--failed" role="alert">{error}</Text>}
      <div className="house-item-actions">
        <Button size="xs" variant="default" className="house-action" leftSection={<IconEdit size={14} aria-hidden />}
          data-testid={`screen-admin-rename-${screen.id}`} onClick={() => onRename(screen)}>
          Name and room
        </Button>
        {screen.kind !== 'screen' && others.length > 0 && (
          <Button size="xs" variant="default" className="house-action" leftSection={<IconArrowMerge size={14} aria-hidden />}
            data-testid={`screen-admin-merge-${screen.id}`} onClick={() => onMerge(screen)}>
            Merge into…
          </Button>
        )}
        <Button size="xs" variant="default" className="house-action" leftSection={<IconArchive size={14} aria-hidden />}
          data-testid={`screen-admin-retire-${screen.id}`} onClick={() => onRetire(screen)}>
          Retire
        </Button>
      </div>
    </li>
  );
}

function AddScreenForm({ admin }) {
  const [name, setName] = useState('');
  const [room, setRoom] = useState('');
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState(null);
  const add = async (override) => {
    setBusy(true);
    const result = await admin.addScreen({ name: override ?? name, room });
    setBusy(false);
    if (result.ok) { setName(''); setRoom(''); setAnswer(null); } else setAnswer(result);
  };
  return (
    <section className="house-section" aria-labelledby="screen-admin-add-title" data-testid="screen-admin-add">
      <Title order={2} size="h4" id="screen-admin-add-title">Add a screen</Title>
      <Group align="flex-end" gap="xs" wrap="wrap">
        <TextInput label="Name" value={name} onChange={(e) => { setName(e.currentTarget.value); setAnswer(null); }}
          data-testid="screen-admin-add-name" style={{ flex: '1 1 180px' }} />
        <TextInput label="Room" value={room} onChange={(e) => setRoom(e.currentTarget.value)}
          data-testid="screen-admin-add-room" style={{ flex: '1 1 140px' }} />
        <Button className="house-action" leftSection={<IconPlus size={16} aria-hidden />} disabled={!name.trim()} loading={busy}
          data-testid="screen-admin-add-save" onClick={() => add()}>
          Add screen
        </Button>
      </Group>
      {answer?.code === 'NAME_TAKEN' && (
        <Group gap="xs" role="alert">
          <Text size="sm">“{name.trim()}” is already taken.</Text>
          {answer.suggestion && (
            <Button size="xs" variant="light" className="house-action" data-testid="screen-admin-add-suggestion" onClick={() => { setName(answer.suggestion); add(answer.suggestion); }}>
              Use “{answer.suggestion}”
            </Button>
          )}
        </Group>
      )}
      {answer && answer.code !== 'NAME_TAKEN' && (
        <Text size="sm" className="house-tone--failed" role="alert">Couldn't add the screen. {answer.error}</Text>
      )}
    </section>
  );
}

export function ScreenAdminView() {
  const { registry } = useFleetContext();
  const admin = useScreenAdmin({ registry });
  const [renaming, setRenaming] = useState(null);
  const [merging, setMerging] = useState(null); // { screen, into, routines, error }
  const [retiring, setRetiring] = useState(null); // { screen, routines, error, loading }
  const [aliasNames, setAliasNames] = useState({});
  useEffect(() => { houseLog.viewOpened({ view: 'screens' }); }, []);

  const screens = registry?.screens ?? [];
  const notSeen = registry?.notSeenLately ?? [];
  const retired = registry?.retired ?? [];
  const unnamed = registry?.unnamed ?? [];
  const live = [...screens, ...notSeen];
  const nameOf = (id) => registry?.byId?.get?.(id)?.name ?? 'another screen';

  const openRetire = async (screen) => {
    setRetiring({ screen, routines: [], loading: true, error: null });
    const result = await admin.routinesFor(screen);
    setRetiring({ screen, routines: result.ok ? result.routines : [], loading: false, error: result.ok ? null : result.error });
  };
  const confirmRetire = async () => {
    const result = await admin.retire(retiring.screen);
    if (result.ok) setRetiring(null);
    else setRetiring((r) => ({ ...r, error: result.error }));
  };
  const openMerge = async (screen) => {
    setMerging({ screen, into: null, routines: [], error: null });
  };
  const chooseMergeTarget = async (intoId) => {
    const into = live.find((s) => s.id === intoId) ?? null;
    setMerging((m) => ({ ...m, into, routines: [] }));
    if (!into) return;
    const [a, b] = await Promise.all([admin.routinesFor(merging.screen), admin.routinesFor(into)]);
    setMerging((m) => (m?.into?.id === into.id ? { ...m, routines: [...(a.routines ?? []), ...(b.routines ?? [])] } : m));
  };
  const confirmMerge = async () => {
    const { screen, into } = merging;
    const result = await admin.merge(screen, into);
    if (result.ok) {
      setAliasNames((names) => ({ ...names, [screen.id]: screen.name }));
      setMerging(null);
    } else setMerging((m) => ({ ...m, error: result.error }));
  };

  if (registry && registry.loaded && !registry.available) {
    return (
      <div className="fleet-view" data-testid="screen-admin-view">
        <Title order={1} mb="md">Screens</Title>
        <Alert color="yellow" variant="light" icon={<IconAlertCircle size={18} />}>
          The household screen list isn't available right now.
        </Alert>
      </div>
    );
  }

  const item = (screen) => (
    <ScreenItem key={screen.id} screen={screen} admin={admin} aliasNames={aliasNames}
      others={live.filter((s) => s.id !== screen.id)}
      onRename={setRenaming} onMerge={openMerge} onRetire={openRetire} />
  );

  return (
    <div className="fleet-view" data-testid="screen-admin-view">
      <Title order={1} mb="md">Screens</Title>
      {registry?.error && (
        <Alert color="yellow" variant="light" icon={<IconAlertCircle size={18} />} mb="md" data-testid="screen-admin-error">
          Couldn't refresh the screen list; it may be out of date.
        </Alert>
      )}
      <AddScreenForm admin={admin} />
      <section className="house-section" aria-labelledby="screen-admin-list-title">
        <Title order={2} size="h4" id="screen-admin-list-title">Every screen</Title>
        <ul className="house-list" data-testid="screen-admin-list">{screens.map(item)}</ul>
      </section>
      <RoomNeighboursSection screens={live} adjacency={registry?.roomAdjacency ?? {}} admin={admin} />
      {notSeen.length > 0 && (
        <details className="house-section" data-testid="screen-admin-not-seen">
          <summary><Text span fw={600}>Not seen lately ({notSeen.length})</Text> <Text span size="sm" c="dimmed">— silent for more than 30 days</Text></summary>
          <ul className="house-list">{notSeen.map(item)}</ul>
        </details>
      )}
      {unnamed.length > 0 && (
        <details className="house-section" data-testid="screen-admin-unnamed">
          <summary><Text span fw={600}>Unnamed browsers ({unnamed.length})</Text> <Text span size="sm" c="dimmed">— opened the app, never named, never played</Text></summary>
          <ul className="house-list">{unnamed.map(item)}</ul>
        </details>
      )}
      {retired.length > 0 && (
        <details className="house-section" data-testid="screen-admin-retired">
          <summary><Text span fw={600}>Retired ({retired.length})</Text></summary>
          <ul className="house-list">
            {retired.map((screen) => (
              <li key={screen.id} className="house-item" data-testid={`screen-admin-retired-${screen.id}`}>
                <Group justify="space-between" wrap="nowrap">
                  <Text>{screen.name}</Text>
                  <Button size="xs" variant="default" className="house-action" data-testid={`screen-admin-restore-${screen.id}`}
                    onClick={() => admin.restore(screen)}>
                    Restore
                  </Button>
                </Group>
              </li>
            ))}
          </ul>
        </details>
      )}

      <RenameScreenDialog
        open={!!renaming}
        onClose={() => setRenaming(null)}
        title={renaming ? `Name and room: ${renaming.name}` : ''}
        initialName={renaming?.name ?? ''}
        initialRoom={renaming?.room ?? ''}
        onSubmit={(input) => admin.nameScreen(renaming, input)}
        nameOf={nameOf}
        saveLabel="Save"
        nameLabel="Name"
        testid="screen-admin-rename"
      />

      <ConfirmDialog
        open={!!retiring}
        title={retiring ? `Retire ${retiring.screen.name}?` : ''}
        message="It leaves the screen list and its name becomes free. You can restore it later."
        confirmLabel={retiring?.loading ? 'Checking routines…' : 'Retire'}
        onConfirm={() => { if (!retiring?.loading) confirmRetire(); }}
        onCancel={() => setRetiring(null)}
      >
        {retiring && !retiring.loading && (
          <div data-testid="screen-admin-retire-routines" className="house-section">
            {retiring.routines.length ? (
              <>
                <Text size="sm" fw={600}>These routines point at it and will stop working:</Text>
                <List size="sm">{retiring.routines.map((r) => <List.Item key={r.id}>{r.name}</List.Item>)}</List>
              </>
            ) : <Text size="sm">No routines point at it.</Text>}
          </div>
        )}
        {retiring?.error && <Text size="sm" className="house-tone--failed" role="alert" mb="sm">{retiring.error}</Text>}
      </ConfirmDialog>

      <ConfirmDialog
        open={!!merging}
        title={merging ? `Merge ${merging.screen.name}` : ''}
        message="Merge a duplicate into its earlier self: its plays, spots and routines follow, and you can unmerge it afterwards."
        confirmLabel="Merge"
        confirmDisabled={!merging?.into}
        onConfirm={() => { if (merging?.into) confirmMerge(); }}
        onCancel={() => setMerging(null)}
      >
        {merging && (
          <Stack gap="xs" mb="md" data-testid="screen-admin-merge-dialog">
            <Radio.Group
              label="Into its earlier self"
              value={merging.into?.id ?? null}
              onChange={chooseMergeTarget}
              data-testid="screen-admin-merge-into"
            >
              <Stack gap={4} mt={4} className="house-merge-targets">
                {live.filter((s) => s.id !== merging.screen.id).map((s) => (
                  <Radio key={s.id} value={s.id} label={s.room ? `${s.name} · ${s.room}` : s.name}
                    data-testid={`screen-admin-merge-target-${s.id}`} className="house-merge-target" />
                ))}
              </Stack>
            </Radio.Group>
            {merging.routines.length > 0 && (
              <div data-testid="screen-admin-merge-routines">
                <Text size="sm" fw={600}>Routines on these screens:</Text>
                <List size="sm">{merging.routines.map((r) => <List.Item key={r.id}>{r.name}</List.Item>)}</List>
              </div>
            )}
            {merging.error && <Text size="sm" className="house-tone--failed" role="alert">{merging.error}</Text>}
          </Stack>
        )}
      </ConfirmDialog>
    </div>
  );
}

export default ScreenAdminView;
