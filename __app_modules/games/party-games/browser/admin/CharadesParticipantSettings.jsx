import React from 'react';
import { Alert, Button, Checkbox, Group, NativeSelect, Stack, Text } from '@mantine/core';

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const modes = ['text','reader','image'];

function settingsErrors(settings) {
  const current=isRecord(settings) ? settings : {};
  const charades=isRecord(current.charades) ? current.charades : {};
  const clueModes=isRecord(charades.clue_modes) ? charades.clue_modes : {};
  const fieldErrors=[];
  if (current.schema!=='party-games-participant-setup/v1') fieldErrors.push('settings.schema');
  if (typeof current.autostart!=='boolean') fieldErrors.push('settings.autostart');
  if (!isRecord(current.charades)) fieldErrors.push('settings.charades');
  if (!modes.includes(charades.default_clue_mode)) fieldErrors.push('settings.charades.default_clue_mode');
  if (!isRecord(charades.clue_modes) || Object.values(clueModes).some(value=>!modes.includes(value))) fieldErrors.push('settings.charades.clue_modes');
  return fieldErrors;
}

export default function CharadesParticipantSettings({settings,participants,onChange,readOnly=false}) {
  const current=isRecord(settings) ? settings : {};
  const charades=isRecord(current.charades) ? current.charades : {};
  const clueModes=isRecord(charades.clue_modes) ? charades.clue_modes : {};
  const fieldErrors=settingsErrors(settings);
  const incomplete=fieldErrors.length>0;
  const setMode=(key,value)=>onChange({...current,charades:{...charades,clue_modes:{...clueModes,[key]:value}}});
  const completeMissing=()=>onChange({
    ...current,
    schema:'party-games-participant-setup/v1',
    autostart:typeof current.autostart==='boolean' ? current.autostart : true,
    charades:{...charades,default_clue_mode:modes.includes(charades.default_clue_mode) ? charades.default_clue_mode : 'text',clue_modes:Object.fromEntries(Object.entries(clueModes).filter(([,value])=>modes.includes(value)))},
  });
  const options=[{value:'',label:'Choose a mode',disabled:true},{value:'text',label:'Text'},{value:'reader',label:'Reader'},{value:'image',label:'Image'}];
  return <Stack gap={6}>
    {incomplete && <Alert color="yellow" p="xs">Incomplete Charades setup. Review and complete the required settings: {fieldErrors.join(', ')}.</Alert>}
    {incomplete && !readOnly && <Group><Button size="compact-xs" onClick={completeMissing}>Complete missing settings</Button></Group>}
    <Group gap="md" align="center">
      <Checkbox size="xs" label="Start automatically" checked={current.autostart===true} disabled={readOnly} onChange={e=>onChange({...current,autostart:e.currentTarget.checked})}/>
      <Group gap={6} wrap="nowrap"><Text size="xs" c="dimmed">Default clue mode</Text><NativeSelect size="xs" w={110} aria-label="Default clue mode" disabled={readOnly} data={options} value={modes.includes(charades.default_clue_mode) ? charades.default_clue_mode : ''} onChange={e=>onChange({...current,charades:{...charades,default_clue_mode:e.currentTarget.value}})}/></Group>
    </Group>
    {participants.length > 0 && <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'4px 16px'}}>
      {participants.map(p=><Group key={p.id} gap={6} wrap="nowrap" justify="space-between"><Text size="xs" truncate>{p.display.name}</Text><NativeSelect size="xs" w={110} aria-label={`${p.display.name} clue mode`} disabled={readOnly} data={options} value={clueModes[p.id] || charades.default_clue_mode || ''} onChange={e=>setMode(p.id,e.currentTarget.value)}/></Group>)}
    </div>}
    {!participants.length && <Text size="xs" c="dimmed">Choose participants to set individual clue modes.</Text>}
  </Stack>;
}

/** Lets a host keep the panel collapsed only while nothing needs attention. */
CharadesParticipantSettings.isIncomplete = settings => settingsErrors(settings).length > 0;
