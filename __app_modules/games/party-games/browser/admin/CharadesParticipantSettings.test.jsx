import React from 'react';
import { expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { CharadesParticipantSettings, defaultParticipantSettings, remapParticipantKeys } from '../participant-settings.mjs';
it('edits clue modes by roster key and preserves the other settings',()=>{
 const onChange=vi.fn(); render(<MantineProvider><CharadesParticipantSettings settings={defaultParticipantSettings()} participants={[{id:'p',display:{name:'Visitor'}}]} onChange={onChange}/></MantineProvider>);
 fireEvent.change(screen.getByLabelText('Visitor clue mode'),{target:{value:'image'}});
 expect(onChange.mock.calls[0][0].charades.clue_modes).toEqual({p:'image'});
});
it('remaps only mapped keys and drops deleted entries',()=>{
 const settings=defaultParticipantSettings();settings.charades.clue_modes={a:'reader',b:'image'};
 expect(remapParticipantKeys({settings,keyMap:{a:null}}).charades.clue_modes).toEqual({b:'image'});
});
