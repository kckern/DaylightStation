import React from 'react';
import { Alert, Button, Checkbox, Stack, Text } from '@mantine/core';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const modes = ['text','reader','image'];

export default function CharadesParticipantSettings({settings,participants,onChange,readOnly=false}) {
  const current=isRecord(settings) ? settings : {};
  const charades=isRecord(current.charades) ? current.charades : {};
  const clueModes=isRecord(charades.clue_modes) ? charades.clue_modes : {};
  const fieldErrors=[];
  if (current.schema!=='party-games-participant-setup/v1') fieldErrors.push('settings.schema');
  if (typeof current.autostart!=='boolean') fieldErrors.push('settings.autostart');
  if (!isRecord(current.charades)) fieldErrors.push('settings.charades');
  if (!modes.includes(charades.default_clue_mode)) fieldErrors.push('settings.charades.default_clue_mode');
  if (!isRecord(charades.clue_modes) || Object.values(clueModes).some(value=>!modes.includes(value))) fieldErrors.push('settings.charades.clue_modes');
  const incomplete=fieldErrors.length>0;
  const setMode=(key,value)=>onChange({...current,charades:{...charades,clue_modes:{...clueModes,[key]:value}}});
  const completeMissing=()=>onChange({
    ...current,
    schema:'party-games-participant-setup/v1',
    autostart:typeof current.autostart==='boolean' ? current.autostart : true,
    charades:{...charades,default_clue_mode:modes.includes(charades.default_clue_mode) ? charades.default_clue_mode : 'text',clue_modes:Object.fromEntries(Object.entries(clueModes).filter(([,value])=>modes.includes(value)))},
  });
  return <Stack gap="xs">
    {incomplete && <Alert color="yellow">Incomplete Charades setup. Review and complete the required settings: {fieldErrors.join(', ')}.</Alert>}
    {incomplete && !readOnly && <Button onClick={completeMissing}>Complete missing settings</Button>}
    <Checkbox label="Start automatically" checked={current.autostart===true} disabled={readOnly} onChange={e=>onChange({...current,autostart:e.currentTarget.checked})}/>
    <label>Default clue mode <select aria-label="Default clue mode" disabled={readOnly} value={modes.includes(charades.default_clue_mode) ? charades.default_clue_mode : ''} onChange={e=>onChange({...current,charades:{...charades,default_clue_mode:e.currentTarget.value}})}><option value="" disabled>Choose a mode</option><option value="text">Text</option><option value="reader">Reader</option><option value="image">Image</option></select></label>
    {participants.map(p=><label key={p.id}>{p.display.name} clue mode <select aria-label={`${p.display.name} clue mode`} disabled={readOnly} value={clueModes[p.id] || charades.default_clue_mode || ''} onChange={e=>setMode(p.id,e.currentTarget.value)}><option value="" disabled>Choose a mode</option><option value="text">Text</option><option value="reader">Reader</option><option value="image">Image</option></select></label>)}
    {!participants.length && <Text size="sm">Choose participants to set individual clue modes.</Text>}
  </Stack>;
}
