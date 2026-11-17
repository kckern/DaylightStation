import React from 'react';
import {render,screen} from '@testing-library/react';
import {it,expect} from 'vitest';
import {PartyGamesParticipantPreview} from './PartyGamesParticipantPreview.jsx';
it('shows each name and effective clue mode without internal details',()=>{
 render(<PartyGamesParticipantPreview summary={{data:{participants:[{name:'Visitor',clue_mode:'reader',id:'secret-id'},{name:'Guest',clue_mode:'image'}]}}}/>);
 expect(screen.getByText('Visitor')).toBeVisible();expect(screen.getByText('Clue: Reader')).toBeVisible();expect(screen.getByText('Guest')).toBeVisible();expect(screen.getByText('Clue: Image')).toBeVisible();expect(screen.queryByText('secret-id')).toBeNull();
});
