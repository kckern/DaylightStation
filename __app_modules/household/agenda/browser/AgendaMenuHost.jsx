import React, {useCallback, useEffect, useRef, useState} from 'react';
import MenuStack from '../../../media/media/browser/menu.mjs';
import {createAgendaMenuController} from './agendaMenuController.js';
import {TVActionDialog} from '../../../../frontend/src/composition/participants/TVActionDialog.jsx';

const defaultFetch = (...args) => fetch(...args);

/** Fetches a protocol-capable Agenda menu and pins its selected dated address. */
export function AgendaMenuHost({contentId, initialFocusUid, fetcher=defaultFetch, playerRef, onClose, participantClient, participantRegistry}) {
  const [state,setState] = useState({phase:'loading',version:0});
  const root = useRef(null);
  const controller = useRef(null);
  const generation = useRef(0);
  const load = useCallback(async ({surfaceError = true} = {}) => {
    const request=++generation.current;
    try {
      const data=await controller.current.refresh();
      if(generation.current!==request) return null;
      if(!root.current) root.current=data;
      setState(s=>({phase:'ready',version:s.version+1,error:null}));return data;
    } catch(error) {
      if(generation.current!==request || error.code==='stale_menu_request') return null;
      if(!surfaceError) throw error;
      setState(s=>({...s,phase:root.current?'ready':'error',error:error.message}));return null;
    }
  },[]);
  const activityStart = useCallback(menu => {generation.current++;controller.current.activityStart(menu);setState(s=>s.error?{...s,error:null}:s);},[]);
  const refreshParticipant = useCallback(async (uid,action) => {const data=await load({surfaceError:false});const row=data?.items?.find(item=>item.uid===uid);return !row?.disabled ? row?.participantLaunches?.[action] || null : null;},[load]);
  const returnTarget = useCallback(target=>controller.current.returnTarget(target),[]);
  const dismissError = useCallback(()=>{generation.current++;controller.current.cancel();if(root.current)setState(s=>({...s,error:null}));else onClose?.();},[onClose]);
  const navigate = useCallback(id=>controller.current.navigate(id),[]);
  useEffect(()=>{controller.current=createAgendaMenuController(contentId,{fetcher});root.current=null;setState(s=>({...s,phase:'loading'}));load();return()=>{generation.current++;controller.current?.cancel();};},[contentId,fetcher,load]);
  if (state.phase==='loading') return <p>Loading menu…</p>;
  const error = state.error && <TVActionDialog role="alert" label="Menu error" focusKey={state.error} onBack={dismissError}><p>{state.error}</p><button onClick={() => load()}>Retry</button><button onClick={dismissError}>Back</button></TVActionDialog>;
  if (!root.current) return error;
  return <><div style={state.error ? {display:'none'} : undefined}><MenuStack initialFocusUid={initialFocusUid} rootMenu={root.current} refreshToken={state.version} playerRef={playerRef} onActivityReturn={load} onHostErrorBack={state.error ? dismissError : null} onActivityStart={activityStart} onReturnTarget={returnTarget} getReturnMenuId={() => controller.current.returnMenuId()} loadContentMenu={navigate} onNavigationCancel={() => { generation.current += 1; controller.current.cancel(); }} refreshParticipant={refreshParticipant} participantClient={participantClient} participantRegistry={participantRegistry}/></div>{error}</>;
}
export default AgendaMenuHost;
