import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach, expect, it, vi } from 'vitest';
import { MealFoodControls } from './MealFoodControls.jsx';
const api = vi.hoisted(() => vi.fn());
vi.mock('../../../lib/api.mjs', () => ({ DaylightAPI: api }));
afterEach(() => { cleanup(); api.mockReset(); });
const rows = [{uuid:'broth', name:'Beef broth',version:1},{uuid:'tomato',name:'Tomatoes',version:2}];
const mount = (props={}) => render(<MantineProvider><MealFoodControls date="2026-09-06" bucket="evening" rows={rows} selectedIds={[]} onSelectionMode={()=>{}} onChanged={()=>{}} {...props}/></MantineProvider>);
it('groups selected foods with their versions and returns Undo outcome',async()=>{
 const onChanged=vi.fn(); api.mockResolvedValue({committed:true,undoToken:'undo-a'});
 mount({selectedIds:['broth','tomato'],onChanged});
 fireEvent.click(screen.getByRole('button',{name:'Group selected foods'}));
 fireEvent.change(screen.getByRole('textbox',{name:'Dish name'}),{target:{value:'Tomato soup'}});
 fireEvent.click(screen.getByRole('button',{name:'Create dish'}));
 await waitFor(()=>expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({undoToken:'undo-a'})));
 expect(api).toHaveBeenCalledWith('api/v1/health/nutrition/meal-command',expect.objectContaining({action:'group',name:'Tomato soup',selectedIds:['broth','tomato'],expectedVersions:{broth:1,tomato:2}}),'POST');
});
it.each([[[]],[['tomato']]])('smart grouping previews and preserves selection scope %j',async selectedIds=>{
 api.mockResolvedValue({groups:[{name:'Soup',selectedIds:['broth','tomato']}],expectedVersions:{broth:1,tomato:2}});
 mount({selectedIds}); fireEvent.click(screen.getByRole('button',{name:'Suggest groups'}));
 await screen.findByRole('textbox',{name:'Suggested dish 1'});
 expect(api).toHaveBeenCalledTimes(1);
 expect(api).toHaveBeenCalledWith('api/v1/health/nutrition/meal-suggestions',expect.objectContaining({selectedIds}),'POST');
 expect(screen.getByRole('button',{name:'Apply suggested groups'})).toBeTruthy();
});
