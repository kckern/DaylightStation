import React, { useEffect, useRef, useState } from 'react';
import { Alert, Avatar, Button, Group, Stack, Text, TextInput } from '@mantine/core';
import { DaylightMediaPath } from '../../../frontend/src/lib/api.mjs';

/** Controlled roster editor. allocateEntryId is supplied by the owning draft. */
export default function ParticipantPicker({ value = [], people = [], onChange, onCreateGuest, allocateEntryId, readOnly = false, scopeKey }) {
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const current = useRef({});
  current.current = {value, onChange, allocateEntryId, readOnly, scopeKey};
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setCreating(false); setError(''); setId(''); setName(''); }, [scopeKey]);
  const selected = person => value.some(entry => entry.person?.kind === person.kind && entry.person?.id === person.id);
  const add = entry => {
    const latest = current.current;
    if (latest.readOnly || (entry.person && latest.value.some(p => p.person?.kind === entry.person.kind && p.person?.id === entry.person.id))) return;
    const entryId = latest.allocateEntryId();
    if (!entryId || latest.value.some(existing => existing.id === entryId)) throw new Error('Invalid roster entry ID');
    latest.onChange([...latest.value, { ...entry, id: entryId }]);
  };
  const create = async () => {
    if (creating || !id.trim() || !name.trim()) return;
    setCreating(true); setError('');
    const requestedScope = scopeKey;
    let saved = false;
    try {
      const entry = await onCreateGuest({ id: id.trim(), name: name.trim() });
      saved = true;
      if (!mounted.current || current.current.scopeKey !== requestedScope) return;
      if (!entry?.person || !entry?.display) throw new Error('Guest directory returned an invalid person');
      add({ person: entry.person, display: entry.display });
      setId(''); setName('');
    } catch (e) { if (mounted.current && current.current.scopeKey === requestedScope) setError(saved ? `Guest saved in directory; could not add to this roster: ${e.message}` : (e.message || 'Could not create guest')); }
    finally { if (mounted.current && current.current.scopeKey === requestedScope) setCreating(false); }
  };
  let anonymousIndex = 0;
  return <Stack gap="sm">
    <Stack gap="xs">{value.map(entry => {
      const anonymousLabel = entry.anonymous ? `Guest ${++anonymousIndex}` : null;
      const label = entry.display?.name || anonymousLabel || entry.person?.id || 'Person';
      const avatar = entry.display?.avatar;
      return <Group key={entry.id}>
        <Avatar src={avatar?.kind === 'user-avatar' ? DaylightMediaPath(`/static/img/users/${encodeURIComponent(avatar.userId)}`) : null} name={label} />
        {entry.anonymous && !readOnly ? <TextInput aria-label={`${anonymousLabel} name`} value={entry.display?.name || ''} onChange={event => onChange(value.map(p => p.id === entry.id ? {...p, display:{...p.display,name:event.currentTarget.value}} : p))}/> : <Text>{label}</Text>}
        {!readOnly && <Button size="xs" variant="subtle" aria-label={`Remove ${anonymousLabel || label}`} onClick={() => onChange(value.filter(p => p.id !== entry.id))}>Remove</Button>}
      </Group>;
    })}</Stack>
    {!readOnly && <>
      {['user','guest'].map(kind => <div key={kind}><Text fw={600}>{kind === 'user' ? 'Household' : 'Named visitors'}</Text><Group>{people.filter(entry => entry.person?.kind === kind && entry.active !== false).map(entry => <Button key={`${kind}:${entry.person.id}`} size="xs" variant="light" disabled={selected(entry.person)} onClick={() => add({person:entry.person,display:entry.display})}>Add {entry.display.name}</Button>)}</Group></div>)}
      <Group><Button variant="light" onClick={() => { let number = 1; while (value.some(p => p.anonymous && p.display?.name === `Guest ${number}`)) number++; add({anonymous:true,display:{name:`Guest ${number}`,avatar:null}}); }}>Add anonymous guest</Button></Group>
      {onCreateGuest && <><Group align="end"><TextInput label="Named guest ID" value={id} onChange={e=>setId(e.currentTarget.value)}/><TextInput label="Named guest name" value={name} onChange={e=>setName(e.currentTarget.value)}/><Button loading={creating} disabled={!id.trim() || !name.trim()} onClick={create}>Add named guest</Button></Group>{error && <Alert color="red" role="alert">{error}</Alert>}</>}
    </>}
  </Stack>;
}
