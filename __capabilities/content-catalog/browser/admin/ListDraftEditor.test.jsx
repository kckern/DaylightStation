import React from 'react';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router-dom';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import ListDraftEditor from './ListDraftEditor.jsx';
import { applyListEdit } from '../../portable/list-structure.mjs';
import { normalizeListConfig, normalizeListItem, serializeListConfig } from '../../server/list-codec.mjs';
import { useListsContext } from './ListsContext.js';
vi.mock('./ImagePickerModal.jsx', () => ({default:({opened,onSave,onClose})=>opened ? <div><button type="button" onClick={()=>{onSave('/media/test.jpg');onClose();}}>Choose test image</button><button type="button" onClick={()=>{onSave(null);onClose();}}>Remove test image</button></div> : null}));
vi.mock('./CapabilityWarning.jsx', () => ({CapabilityWarning:()=>null}));
vi.mock('./ContentDisplays.jsx', async (importOriginal) => ({...(await importOriginal()), fetchContentMetadata: async () => null}));
const list={sections:[{uid:'s1',title:'First',items:[{uid:'i1',title:'One',open:'games/one'},{uid:'i2',title:'Two',play:{contentId:'music:two'}}]}]};
function setup(props={}) {const onEdit=vi.fn(); render(<MantineProvider><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><ListDraftEditor list={list} onEdit={onEdit} {...props}/></MemoryRouter></MantineProvider>); return onEdit;}
it('emits stable UID commands for keyboard reorder, swap and delete',()=>{const edit=setup(); fireEvent.click(screen.getByRole('button',{name:'Move Two up'})); expect(edit).toHaveBeenCalledWith({type:'move-item',itemUid:'i2',beforeUid:'i1'}); fireEvent.click(screen.getByRole('textbox',{name:'Swap One with'})); fireEvent.click(screen.getByRole('option',{name:'Two'})); expect(edit).toHaveBeenCalledWith({type:'swap-items',firstUid:'i1',secondUid:'i2'}); fireEvent.click(screen.getByRole('button',{name:'Delete One'})); expect(edit).toHaveBeenCalledWith({type:'delete-item',itemUid:'i1'});});
it('read only hides mutation controls',()=>{const edit=setup({readOnly:true}); expect(screen.queryByRole('button',{name:'Delete One'})).toBeNull(); expect(edit).not.toHaveBeenCalled();});

it('cancelling item edits preserves the draft',async()=>{const edit=setup(); fireEvent.click(screen.getByRole('button',{name:'Edit One'})); fireEvent.change(await screen.findByTestId('item-label-input'),{target:{value:'Changed'}}); fireEvent.click(screen.getByRole('button',{name:'Cancel'})); expect(edit).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole('button',{name:'Edit One'})); expect(await screen.findByTestId('item-label-input')).toHaveValue('One');});
it('saving a label retains its authored action and does not emit a legacy write',async()=>{const edit=setup(); fireEvent.click(screen.getByRole('button',{name:'Edit One'})); fireEvent.change(await screen.findByTestId('item-label-input'),{target:{value:'Renamed'}}); fireEvent.click(screen.getByTestId('save-item-button')); await waitFor(()=>expect(edit).toHaveBeenCalled()); const command=edit.mock.calls[0][0]; expect(command).toMatchObject({type:'update-item',itemUid:'i1',changes:{title:'Renamed',open:'games/one'}}); expect(command.changes.play).toBeUndefined();});
it('subsequent edits still address the same UID after the parent reorders',()=>{const edits=[]; function Controlled(){const [value,setValue]=React.useState(list); return <ListDraftEditor list={value} onEdit={command=>{edits.push(command);setValue(previous=>applyListEdit(previous,command).list);}}/>;} render(<MantineProvider><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Controlled/></MemoryRouter></MantineProvider>); fireEvent.click(screen.getByRole('button',{name:'Move Two up'})); fireEvent.click(screen.getByRole('button',{name:'Delete One'})); expect(edits).toEqual([{type:'move-item',itemUid:'i2',beforeUid:'i1'},{type:'delete-item',itemUid:'i1'}]); expect(screen.queryByRole('button',{name:'Delete One'})).toBeNull();});

it.each(['Read','Shuffle'])('maps legacy %s to a canonical play action',async action=>{
  const source={sections:[{...list.sections[0],items:[list.sections[0].items[0],{...list.sections[0].items[1],shuffle:true}]}]};
  const onEdit=setup({list:source}); fireEvent.click(within(screen.getByTestId('item-row-0-1')).getByText('Play')); fireEvent.click(screen.getByRole('option',{name:action})); await waitFor(()=>expect(onEdit).toHaveBeenCalled());
  const item=applyListEdit(source,onEdit.mock.calls[0][0]).list.sections[0].items[1];
  expect(item.play).toEqual({contentId:'music:two'}); expect(item.read).toBeUndefined(); expect(item.shuffle).toBe(true);
});

it('retains an open modal buffer across parent and content cache rerenders',async()=>{
  function CacheControl(){const {setContentInfo}=useListsContext();return <button onClick={()=>setContentInfo('music:two',{title:'Updated'})}>Update cache</button>;}
  const props={list,onEdit:vi.fn(),renderItemSettings:()=> <CacheControl/>};
  const view=render(<MantineProvider><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><ListDraftEditor {...props}/></MemoryRouter></MantineProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Edit One'})); fireEvent.change(await screen.findByTestId('item-label-input'),{target:{value:'Uncommitted'}});
  view.rerender(<MantineProvider><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><ListDraftEditor {...props} list={{...list}}/></MemoryRouter></MantineProvider>);
  expect(screen.getByTestId('item-label-input')).toHaveValue('Uncommitted');
  fireEvent.click(screen.getAllByRole('button',{name:'Update cache',hidden:true})[0]); expect(screen.getByTestId('item-label-input')).toHaveValue('Uncommitted');
});

it.each([['unchanged','Weekly label'],['edited','New label']])('preserves a distinct authored title on %s save',async (_case,label)=>{
  const original={sections:[{uid:'s1',items:[{uid:'i1',title:'Catalog title',label:'Weekly label',play:{contentId:'music:one'}}]}]}; const edit=vi.fn();
  render(<MantineProvider><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><ListDraftEditor list={original} onEdit={edit}/></MemoryRouter></MantineProvider>);
  fireEvent.click(screen.getByRole('button',{name:'Edit Weekly label'})); const input=await screen.findByTestId('item-label-input'); fireEvent.change(input,{target:{value:label}}); fireEvent.click(screen.getByTestId('save-item-button'));
  await waitFor(()=>expect(edit).toHaveBeenCalled()); const result=applyListEdit(original,edit.mock.calls[0][0]).list.sections[0].items[0];
  expect(result).toMatchObject({title:'Catalog title',label,play:{contentId:'music:one'}});
  expect(normalizeListItem(result)).toMatchObject({title:'Catalog title',label,play:{contentId:'music:one'}});
  const reloaded=normalizeListConfig(serializeListConfig(normalizeListConfig({items:[result]}))).sections[0].items[0];
  expect(reloaded).toMatchObject({title:'Catalog title',label,play:{contentId:'music:one'}});
});

it('sets, retains, and removes an image through the parent list buffer',async()=>{
  const snapshots=[]; function Controlled(){const [value,setValue]=React.useState({sections:[{uid:'s1',items:[{uid:'i1',title:'One',play:{contentId:'music:one'}}]}]}); return <><ListDraftEditor list={value} onEdit={command=>setValue(previous=>{const next=applyListEdit(previous,command).list;snapshots.push(next);return next;})}/><output data-testid="image">{value.sections[0].items[0].image || 'none'}</output></>;}
  render(<MantineProvider><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Controlled/></MemoryRouter></MantineProvider>);
  const open=async()=>{fireEvent.click(screen.getByRole('button',{name:'Edit One'}));await screen.findByTestId('item-label-input');};
  const save=async()=>{fireEvent.click(screen.getByTestId('save-item-button'));await waitFor(()=>expect(screen.queryByTestId('item-label-input')).toBeNull());};
  await open(); fireEvent.click(screen.getByRole('button',{name:'Set Image'})); fireEvent.click(screen.getByRole('button',{name:'Choose test image'})); await save(); expect(screen.getByTestId('image')).toHaveTextContent('/media/test.jpg');
  await open(); await save(); expect(screen.getByTestId('image')).toHaveTextContent('/media/test.jpg');
  await open(); fireEvent.click(screen.getByRole('button',{name:'Change Image'})); fireEvent.click(screen.getByRole('button',{name:'Remove test image'})); await save(); expect(screen.getByTestId('image')).toHaveTextContent('none'); expect(snapshots.at(-1).sections[0].items[0].image).toBeNull();
});
it('exposes action options to keyboard and accessibility inside the item editor',async()=>{
 setup();fireEvent.click(screen.getByRole('button',{name:'Add item'}));
 const action=await screen.findByRole('textbox',{name:'Action'});fireEvent.click(action);
 await waitFor(()=>expect(screen.getByRole('option',{name:'Open'})).toBeVisible());
 for(let i=0;i<3;i++)fireEvent.keyDown(action,{key:'ArrowDown',code:'ArrowDown'});fireEvent.keyDown(action,{key:'Enter',code:'Enter'});expect(action).toHaveValue('Open');
});
it('exposes the raw content choice inside the modal and commits it with the keyboard',async()=>{
 const edit=setup();fireEvent.click(screen.getByRole('button',{name:'Add item'}));
 const input=await screen.findByRole('textbox',{name:'Search content or type source:id'});fireEvent.change(input,{target:{value:'app:example'}});
 const option=await screen.findByTestId('freeform-commit-option');expect(option.closest('[aria-hidden="true"]')).toBeNull();
 await waitFor(()=>expect(screen.getByRole('option',{name:/Use .* as raw value/})).toBeVisible());fireEvent.keyDown(input,{key:'Enter',code:'Enter'});fireEvent.change(screen.getByTestId('item-label-input'),{target:{value:'Example'}});fireEvent.click(screen.getByTestId('save-item-button'));await waitFor(()=>expect(edit).toHaveBeenCalled());expect(edit.mock.calls[0][0].item.play).toEqual({contentId:'app:example'});
});
