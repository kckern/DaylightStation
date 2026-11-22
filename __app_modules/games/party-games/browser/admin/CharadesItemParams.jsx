import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Avatar, Button, Checkbox, CloseButton, Group, Modal, NativeSelect, Select, Stack, Text, TextInput } from '@mantine/core';
import { DaylightMediaPath } from '../../../../../frontend/src/lib/api.mjs';
import getLogger from '../../../../../frontend/src/lib/logging/Logger.js';
import usePeopleDirectory from './usePeopleDirectory.js';

const NEW_GUEST = '__new_guest__';
const UNKNOWN = 'Unknown person';
const CLUE_OPTIONS = [{ value: 'text', label: 'Text' }, { value: 'reader', label: 'Reader' }, { value: 'image', label: 'Image' }];

const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const pictureFor = id => DaylightMediaPath(`/static/img/users/${encodeURIComponent(id)}`);
const initialsOf = name => name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || '?';
const optionValue = entry => `${entry.person.kind}:${entry.person.id}`;

/** Rebuild the params object from its parts, dropping an empty clue_modes. */
function emit(value, patch) {
  const next = { ...(isRecord(value) ? value : {}), ...patch };
  if (!isRecord(next.clue_modes) || Object.keys(next.clue_modes).length === 0) delete next.clue_modes;
  return next;
}

function PersonPill({ name, id, known, removeLabel, onRemove }) {
  return <Group role="listitem" gap={4} wrap="nowrap" style={{ border: '1px solid var(--mantine-color-default-border)', borderRadius: 999, padding: '1px 2px 1px 2px' }}>
    {/* The photo is always derived from the id; initials only show if the image fails to load. */}
    <Avatar size={20} radius="xl" src={pictureFor(id)} alt="">{known ? initialsOf(name) : '?'}</Avatar>
    <Text size="xs" style={{ whiteSpace: 'nowrap' }}>{name}</Text>
    <CloseButton size="xs" aria-label={removeLabel} onClick={onRemove} />
  </Group>;
}

function NewGuestModal({ opened, onClose, onCreate }) {
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (opened) { setName(''); setError(''); setSaving(false); } }, [opened]);
  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true); setError('');
    try {
      await onCreate(trimmed);
      onClose();
    } catch (err) {
      setError(err?.message || 'Could not add the guest');
      setSaving(false);
    }
  };
  return <Modal opened={opened} onClose={onClose} size="sm" title={<Text size="sm" fw={600}>New guest</Text>}>
    <Stack gap="xs">
      <TextInput size="xs" label="Name" data-autofocus value={name} error={error || null}
        onChange={e => setName(e.currentTarget.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }} />
      <Group justify="flex-end" gap="xs">
        <Button size="xs" variant="default" onClick={onClose}>Cancel</Button>
        <Button size="xs" onClick={submit} loading={saving} disabled={!name.trim()}>Add</Button>
      </Group>
    </Stack>
  </Modal>;
}

/** Modal body editing a Charades list item's params: {autostart, participants, clue_modes}. */
export default function CharadesItemParams({ value, onChange }) {
  const logger = useMemo(() => getLogger().child({ component: 'charades-item-params' }), []);
  const { people, loading, error, createGuest } = usePeopleDirectory();
  const [search, setSearch] = useState('');
  const [guestOpen, setGuestOpen] = useState(false);
  const warned = useRef(new Set());

  const params = isRecord(value) ? value : {};
  const participants = Array.isArray(params.participants) ? params.participants.filter(id => typeof id === 'string') : [];
  const clueModes = isRecord(params.clue_modes) ? params.clue_modes : {};

  const byId = useMemo(() => new Map(people.filter(p => p?.person?.id).map(p => [p.person.id, p])), [people]);
  const resolved = participants.map(id => ({ id, entry: byId.get(id) || null }));

  useEffect(() => {
    if (loading || error) return;
    for (const { id, entry } of resolved) {
      if (entry || warned.current.has(id)) continue;
      warned.current.add(id);
      logger.warn('charades.params.unknown-participant', { participantId: id });
    }
  });

  const options = useMemo(() => {
    const chosen = new Set(participants);
    const offer = p => p?.person?.id && p.active !== false && !chosen.has(p.person.id);
    const toOption = p => ({ value: optionValue(p), label: p.display?.name || UNKNOWN });
    const household = people.filter(p => p.person?.kind === 'user' && offer(p)).map(toOption);
    const guests = people.filter(p => p.person?.kind === 'guest' && offer(p)).map(toOption);
    return [
      ...(household.length ? [{ group: 'Household', items: household }] : []),
      ...(guests.length ? [{ group: 'Guests', items: guests }] : []),
      { value: NEW_GUEST, label: 'New guest…' },
    ];
  }, [people, participants.join('\u0000')]);

  const setParticipants = next => onChange(emit(params, {
    participants: next,
    clue_modes: Object.fromEntries(Object.entries(clueModes).filter(([id]) => next.includes(id))),
  }));
  const add = id => {
    if (participants.includes(id)) return;
    logger.debug('charades.params.participant-added', { kind: byId.get(id)?.person?.kind ?? 'guest' });
    setParticipants([...participants, id]);
  };
  const remove = index => setParticipants(participants.filter((_, i) => i !== index));
  const setMode = (id, mode) => {
    const next = { ...clueModes };
    if (mode === 'text') delete next[id]; else next[id] = mode;
    onChange(emit(params, { clue_modes: next }));
  };
  const pick = selected => {
    setSearch('');
    if (!selected) return;
    if (selected === NEW_GUEST) { setGuestOpen(true); return; }
    const entry = people.find(p => optionValue(p) === selected);
    if (entry) add(entry.person.id);
  };
  const createAndSelect = async name => {
    const entry = await createGuest(name);
    if (!entry?.person?.id) throw new Error('The people directory did not return the new guest');
    add(entry.person.id);
  };

  const nameOf = ({ entry }) => entry?.display?.name || UNKNOWN;
  // Unknown people share a name, so number them to keep each Remove button distinct.
  let unknownCount = 0;
  const removeLabels = resolved.map(p => {
    if (loading) return `Remove person ${resolved.indexOf(p) + 1}`;
    if (p.entry) return `Remove ${nameOf(p)}`;
    unknownCount += 1;
    return unknownCount === 1 ? 'Remove unknown person' : `Remove unknown person ${unknownCount}`;
  });

  return <Stack gap="sm">
    <Stack gap={4}>
      <Text size="xs" c="dimmed">People</Text>
      <Group gap={6} wrap="wrap" align="center">
        <Group role="list" aria-label="Selected people" gap={6} wrap="wrap" align="center">
          {resolved.map((p, index) => <PersonPill key={`${index}:${p.id}`} name={loading ? '…' : nameOf(p)} id={p.id} known={!!p.entry}
            removeLabel={removeLabels[index]} onRemove={() => remove(index)} />)}
        </Group>
        <Select size="xs" w={160} searchable placeholder="Add person…" aria-label="Add person" data={options}
          value={null} searchValue={search} onSearchChange={setSearch} onChange={pick}
          nothingFoundMessage="No one else to add" disabled={loading} comboboxProps={{ withinPortal: true }} />
      </Group>
      {error && <Text size="xs" c="red">People directory unavailable.</Text>}
    </Stack>
    {resolved.length > 0 && <Stack gap={4}>
      <Text size="xs" c="dimmed">Clue modes</Text>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '4px 16px' }}>
        {resolved.map((p, index) => <Group key={`${index}:${p.id}`} gap={6} wrap="nowrap" justify="space-between">
          <Text size="xs" truncate>{loading ? '…' : nameOf(p)}</Text>
          <NativeSelect size="xs" w={110} aria-label={`${loading ? 'Person' : nameOf(p)} clue mode`} data={CLUE_OPTIONS}
            value={clueModes[p.id] || 'text'} onChange={e => setMode(p.id, e.currentTarget.value)} />
        </Group>)}
      </div>
    </Stack>}
    <Checkbox size="xs" label="Start automatically" checked={params.autostart === true}
      onChange={e => onChange(emit(params, { autostart: e.currentTarget.checked }))} />
    <NewGuestModal opened={guestOpen} onClose={() => setGuestOpen(false)} onCreate={createAndSelect} />
  </Stack>;
}
