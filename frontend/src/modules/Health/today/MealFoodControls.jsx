import { useRef, useState } from 'react';
import { Button, NativeSelect } from '@mantine/core';
import { DaylightAPI } from '../../../lib/api.mjs';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';
const logger = createAppLogger('health').child('meal-food-controls');
const idOf = row => row.uuid || row.id;
const nameOf = row => row.name || row.label || row.item;

export function MealFoodControls({ date, bucket, rows, selectedIds, selecting, onSelectionMode, onChanged, extraActions }) {
  const [panel, setPanel] = useState(null);
  const [name, setName] = useState('');
  const [groups, setGroups] = useState([]);
  const [versions, setVersions] = useState({});
  const [members, setMembers] = useState([]);
  const [groupId, setGroupId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const request = useRef(null);
  const running = useRef(false);
  const foods = rows.filter(row => row.kind !== 'group');
  const selectedFoods = foods.filter(row => selectedIds.includes(idOf(row)));
  const parents = rows.filter(row => row.kind === 'group');
  const allVersions = () => Object.fromEntries(rows.map(row => [idOf(row), row.version ?? 1]));
  const run = async action => {
    if (running.current) return;
    running.current = true; setBusy(true); setError(null);
    try { await action(); }
    catch (err) { setError(err.message || 'Could not update this meal. Try again.'); logger.warn('meal-command.failed', {bucket,date,error:err.message}); }
    finally { running.current = false; setBusy(false); }
  };
  const command = async payload => {
    const body = { date,bucket,selectedIds,expectedVersions:allVersions(),...payload };
    const fingerprint = JSON.stringify(body);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint,operationId:crypto.randomUUID() };
    const result = await DaylightAPI('api/v1/health/nutrition/meal-command',{...body,operationId:request.current.operationId},'POST');
    request.current = null; setPanel(null); onChanged(result);
  };
  const suggest = () => run(async () => {
    const result = await DaylightAPI('api/v1/health/nutrition/meal-suggestions',{date,bucket,selectedIds},'POST');
    setGroups(result.groups || []); setVersions(result.expectedVersions || allVersions()); setPanel('smart');
  });
  const editGroup = id => {
    setGroupId(id); setMembers(rows.filter(row => row.parentId === id).map(idOf));
  };
  return <>
    <div className="health-meal-tools">
      <Button size="compact-xs" variant="subtle" onClick={()=>onSelectionMode(!selecting)} disabled={busy}>{selecting ? 'Done selecting' : 'Select foods'}</Button>
      {selectedFoods.length >= 2 ? <Button size="compact-xs" variant="light" aria-label="Group selected foods" disabled={busy} onClick={()=>{setName('');setPanel('group');}}>Group ({selectedFoods.length})</Button> : null}
      {foods.length >= 2 ? <Button size="compact-xs" variant="subtle" onClick={suggest} loading={busy && panel !== 'group'}>Suggest groups</Button> : null}
      {parents.length ? <Button size="compact-xs" variant="subtle" disabled={busy} onClick={()=>{editGroup(idOf(parents[0]));setPanel('membership');}}>Edit groups</Button> : null}
      {extraActions}
    </div>
    {panel ? <div className="health-meal-command-panel">
      {panel === 'group' ? <><label>Dish name<input type="text" aria-label="Dish name" value={name} onChange={e=>setName(e.target.value)} disabled={busy}/></label>
        <Button size="compact-xs" disabled={!name.trim() || busy} onClick={()=>run(()=>command({action:'group',name:name.trim(),selectedIds:selectedFoods.map(idOf)}))}>Create dish</Button></> : null}
      {panel === 'smart' ? <>
        {groups.length ? groups.map((group,index)=><div key={index}>
          <input type="text" aria-label={`Suggested dish ${index+1}`} value={group.name} disabled={busy} onChange={e=>setGroups(prev=>prev.map((g,i)=>i===index?{...g,name:e.target.value}:g))}/>
          {foods.filter(row=>!selectedIds.length || selectedIds.includes(idOf(row))).map(row=><label key={idOf(row)}><input type="checkbox" disabled={busy} checked={group.selectedIds.includes(idOf(row))} onChange={e=>setGroups(prev=>prev.map((g,i)=>i===index?{...g,selectedIds:e.target.checked?[...g.selectedIds,idOf(row)]:g.selectedIds.filter(id=>id!==idOf(row))}:g))}/>{nameOf(row)}</label>)}
        </div>) : <span>No groups suggested for these foods.</span>}
        {groups.length ? <Button size="compact-xs" disabled={busy || groups.some(g=>!g.name.trim() || g.selectedIds.length<2)} onClick={()=>run(()=>command({action:'groups',groups,selectedIds:selectedIds.length?selectedIds:foods.map(idOf),expectedVersions:versions}))}>Apply suggested groups</Button> : null}
      </> : null}
      {panel === 'membership' ? <>
        <label>Dish<NativeSelect aria-label="Dish to edit" value={groupId} disabled={busy} onChange={e=>editGroup(e.target.value)} data={parents.map(row=>({value:idOf(row),label:nameOf(row)}))}/></label>
        {foods.map(row=><label key={idOf(row)}><input type="checkbox" disabled={busy} checked={members.includes(idOf(row))} onChange={e=>setMembers(prev=>e.target.checked?[...prev,idOf(row)]:prev.filter(id=>id!==idOf(row)))}/>{nameOf(row)}</label>)}
        <div className="health-meal-command-actions"><Button size="compact-xs" disabled={busy} onClick={()=>run(()=>command({action:'membership',groupId,selectedIds:members}))}>Save members</Button>
        <Button size="compact-xs" variant="subtle" disabled={busy} onClick={()=>run(()=>command({action:'ungroup',groupId}))}>Ungroup</Button></div>
      </> : null}
      <Button size="compact-xs" variant="subtle" disabled={busy} onClick={()=>setPanel(null)}>Cancel</Button>
    </div> : null}
    {error ? <div role="alert">{error}</div> : null}
  </>;
}
