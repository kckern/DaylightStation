import React from 'react';
import { Checkbox, Stack, Text } from '@mantine/core';

export default function CharadesParticipantSettings({settings,participants,onChange,readOnly=false}) {
  const setMode=(key,value)=>onChange({...settings,charades:{...settings.charades,clue_modes:{...settings.charades.clue_modes,[key]:value}}});
  return <Stack gap="xs">
    <Checkbox label="Start automatically" checked={settings.autostart} disabled={readOnly} onChange={e=>onChange({...settings,autostart:e.currentTarget.checked})}/>
    <label>Default clue mode <select disabled={readOnly} value={settings.charades.default_clue_mode} onChange={e=>onChange({...settings,charades:{...settings.charades,default_clue_mode:e.currentTarget.value}})}><option value="text">Text</option><option value="reader">Reader</option><option value="image">Image</option></select></label>
    {participants.map(p=><label key={p.id}>{p.display.name} clue mode <select aria-label={`${p.display.name} clue mode`} disabled={readOnly} value={settings.charades.clue_modes[p.id] || settings.charades.default_clue_mode} onChange={e=>setMode(p.id,e.currentTarget.value)}><option value="text">Text</option><option value="reader">Reader</option><option value="image">Image</option></select></label>)}
    {!participants.length && <Text size="sm">Choose participants to set individual clue modes.</Text>}
  </Stack>;
}
