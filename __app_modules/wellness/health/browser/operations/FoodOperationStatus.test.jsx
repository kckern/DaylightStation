import { it, expect, vi } from 'vitest';
import { act, render, screen, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { HealthOperationsProvider, useHealthOperations } from './HealthOperationsProvider.jsx';
import { FoodOperationStatus } from './FoodOperationStatus.jsx';
function Harness(){
 const session=useHealthOperations();
 return <><button onClick={()=>session.submitSentence({text:'nothing',date:'2026-10-25',bucket:'morning'})}>Submit</button>{[...session.snapshot.operations.values()].map(operation=><FoodOperationStatus key={operation.id} operation={operation}/>)}</>;
}
it('can dismiss a no-food outcome without repeatedly resending an unchanged sentence',async()=>{
 const send=vi.fn(async()=>({committed:false,message:'No food found'}));
 render(<MantineProvider><HealthOperationsProvider userId="u" send={send}><Harness/></HealthOperationsProvider></MantineProvider>);
 await act(async()=>fireEvent.click(screen.getByText('Submit')));
 expect(screen.getByRole('alert').textContent).toContain('No food found');
 fireEvent.click(screen.getByRole('button',{name:'Dismiss'}));
 expect(screen.queryByRole('alert')).toBeNull();
 expect(send).toHaveBeenCalledTimes(1);
});
