import React from 'react';
import {it,expect,vi} from 'vitest';
import {render,screen,fireEvent,waitFor} from '@testing-library/react';
import {MantineProvider} from '@mantine/core';
import GuestDirectory from './GuestDirectory.jsx';
it('saves a directory rename separately from any plan',async()=>{
 const client={updateGuest:vi.fn(async()=>({document:{person:{kind:'guest',id:'v'},display:{name:'Renamed',avatar:null},active:true},etag:'"2"'})),people:async()=>({document:{people:[]},etag:'"2"'})},onChange=vi.fn();
 render(<MantineProvider><GuestDirectory client={client} directory={{people:[{person:{kind:'guest',id:'v'},display:{name:'Visitor',avatar:null},active:true}],etag:'"1"'}} onChange={onChange}/></MantineProvider>);
 fireEvent.change(screen.getByLabelText('Name for Visitor'),{target:{value:'Renamed'}});fireEvent.click(screen.getByRole('button',{name:'Save Visitor'}));
 await waitFor(()=>expect(client.updateGuest).toHaveBeenCalledWith('v',{name:'Renamed'},'"1"'));
 expect(onChange.mock.calls[0][0].people[0].display.name).toBe('Renamed');
});
