import React, { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Button, CloseButton, Group, Stack, Text, TextInput } from '@mantine/core';
import { IconPlus } from '@tabler/icons-react';
import { DaylightMediaPath } from '../../../frontend/src/lib/api.mjs';

/** Controlled roster editor. allocateEntryId is supplied by the owning draft. */
export default function ParticipantPicker({ value = [], people = [], onChange, onCreateGuest, allocateEntryId, allocateGuestId, readOnly = false, scopeKey }) {
  const guestId = useRef(null);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const scope = useRef({key:scopeKey, generation:0});
  if (scope.current.key !== scopeKey) scope.current = {key:scopeKey, generation:scope.current.generation + 1};
  const current = useRef({});
  current.current = {value, onChange, allocateEntryId, readOnly, scopeKey};
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setCreating(false); setError(''); guestId.current = null; setName(''); }, [scopeKey]);
  const selected = person => value.some(entry => entry.person?.kind === person.kind && entry.person?.id === person.id);
  const add = entry => {
    const latest = current.current;
    if (latest.readOnly || (entry.person && latest.value.some(p => p.person?.kind === entry.person.kind && p.person?.id === entry.person.id))) return;
    const entryId = latest.allocateEntryId();
    if (!entryId || latest.value.some(existing => existing.id === entryId)) throw new Error('Invalid roster entry ID');
    latest.onChange([...latest.value, { ...entry, id: entryId }]);
  };
  const create = async () => {
    if (creating || !name.trim()) return;
    setCreating(true); setError('');
    const requestedGeneration = scope.current.generation;
    let saved = false;
    try {
      if (!guestId.current) guestId.current = allocateGuestId();
      if (typeof guestId.current !== 'string' || !guestId.current.trim()) throw new Error('Guest ID allocator returned an invalid ID');
      const entry = await onCreateGuest({ id: guestId.current, name: name.trim() });
      saved = true;
      if (!mounted.current || scope.current.generation !== requestedGeneration) return;
      guestId.current = null; setName('');
      if (!entry?.person || !entry?.display) throw new Error('Guest directory returned an invalid person');
      add({ person: entry.person, display: entry.display });
    } catch (e) { if (mounted.current && scope.current.generation === requestedGeneration) setError(saved ? `Guest saved in directory; could not add to this roster: ${e.message}` : (e.message || 'Could not create guest')); }
    finally { if (mounted.current && scope.current.generation === requestedGeneration) setCreating(false); }
  };
  let anonymousIndex = 0;
  const chip = {display:'inline-flex',alignItems:'center',gap:6,padding:'2px 4px 2px 2px',borderRadius:999,background:'var(--mantine-color-dark-6)',border:'1px solid var(--mantine-color-dark-4)'};
  const avatarSrc = avatar => avatar?.kind === 'user-avatar' ? DaylightMediaPath(`/static/img/users/${encodeURIComponent(avatar.userId)}`) : null;
  return <Stack gap={8}>
    <Group gap={6}>{value.map(entry => {
      const anonymousLabel = entry.anonymous ? `Guest ${++anonymousIndex}` : null;
      const label = entry.display?.name || anonymousLabel || entry.person?.id || 'Person';
      return <span key={entry.id} style={chip}>
        <Avatar size={24} src={avatarSrc(entry.display?.avatar)} name={label} />
        {entry.anonymous && !readOnly ? <TextInput size="xs" variant="unstyled" w={90} aria-label={`${anonymousLabel} name`} value={entry.display?.name || ''} onChange={event => onChange(value.map(p => p.id === entry.id ? {...p, display:{...p.display,name:event.currentTarget.value}} : p))}/> : <Text size="sm">{label}</Text>}
        {!readOnly && <CloseButton size="xs" aria-label={`Remove ${anonymousLabel || label}`} onClick={() => onChange(value.filter(p => p.id !== entry.id))}/>}
      </span>;
    })}{!value.length && <Text size="sm" c="dimmed">No one yet.</Text>}</Group>
    {!readOnly && <>
      <Group gap={6} align="center">
        <Text size="xs" c="dimmed">Add</Text>
        {['user','guest'].flatMap(kind => people.filter(entry => entry.person?.kind === kind && entry.active !== false && !selected(entry.person)).map(entry => <Button key={`${kind}:${entry.person.id}`} size="compact-xs" radius="xl" variant={kind === 'user' ? 'light' : 'default'} leftSection={<IconPlus size={12}/>} aria-label={`Add ${entry.display.name}`} onClick={() => add({person:entry.person,display:entry.display})}>{entry.display.name}</Button>))}
        <Button size="compact-xs" radius="xl" variant="subtle" leftSection={<IconPlus size={12}/>} aria-label="Add anonymous guest" onClick={() => { let number = 1; while (value.some(p => p.anonymous && p.display?.name === `Guest ${number}`)) number++; add({anonymous:true,display:{name:`Guest ${number}`,avatar:null}}); }}>Guest</Button>
        {onCreateGuest && <Group gap={4} wrap="nowrap"><TextInput size="xs" w={150} aria-label="Named guest name" placeholder="New visitor name" value={name} disabled={creating} onChange={e=>{guestId.current = null; setError(''); setName(e.currentTarget.value);}} onKeyDown={e=>e.key==='Enter' && create()}/><Button size="compact-xs" loading={creating} disabled={!name.trim()} onClick={create}>Add named guest</Button></Group>}
      </Group>
      {error && <Alert color="red" role="alert" p="xs">{error}</Alert>}
    </>}
  </Stack>;
}
