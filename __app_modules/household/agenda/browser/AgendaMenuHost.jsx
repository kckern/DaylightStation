import React, {useCallback, useEffect, useRef, useState} from 'react';
import MenuStack from '../../../media/media/browser/menu.mjs';
import {buildHeaders} from '../../../../frontend/src/lib/api.mjs';
import {getLogger} from '../../../../frontend/src/lib/logging/Logger.js';

const isDatedPlan = id => /^agenda:[^/]+\/plans\/[^/]+$/.test(id || '');
const defaultFetch = (...args) => fetch(...args);

/** Fetches a protocol-capable Agenda menu and pins its selected dated address. */
export function AgendaMenuHost({contentId, fetcher=defaultFetch, playerRef, onClose, participantClient, participantRegistry}) {
  const [state,setState] = useState({phase:'loading',version:0});
  const root = useRef(null);
  const generation = useRef(0);
  const selectedId = useRef(contentId);
  const selectedMenu = useRef(null);
  const fetchMenu = useCallback(async (id) => {
    getLogger().info('agenda-menu.request',{contentId:id});
    try {
      const headers=buildHeaders(localStorage.getItem('ds_token'),false);
      headers['X-Daylight-Participant-Launch-Version']='1';
      const response=await fetcher(`/api/v1/list/${id.replace(':','/')}`,{headers});
      const data=await response.json();
      if (!response.ok || !Array.isArray(data.items)) throw new Error(data.message || 'Unable to load menu');
      return data;
    } catch (error) {
      getLogger().warn('agenda-menu.error',{contentId:id,code:error.code});
      throw error;
    }
  },[fetcher]);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const data = await fetchMenu(selectedId.current);
      if (generation.current !== request) return;
      selectedId.current = data.id || selectedId.current;
      if (!root.current) { root.current = data; selectedMenu.current = data; }
      else {
        const changed = JSON.stringify(selectedMenu.current.items) !== JSON.stringify(data.items);
        if (changed && !data.notice) data.notice = 'This plan has been updated.';
        for (const key of Object.keys(selectedMenu.current)) delete selectedMenu.current[key];
        Object.assign(selectedMenu.current, data);
      }
      setState(s=>({phase:'ready',version:s.version+1}));
    } catch (error) { if (generation.current === request) setState(s=>({...s,phase:'error',message:error.message})); }
  },[fetchMenu]);
  const activityStart = useCallback(menu => {
    if (isDatedPlan(menu?.id)) { selectedId.current = menu.id; selectedMenu.current = menu; }
  }, []);
  const returnTarget = useCallback(target => {
    if (target?.kind === 'content' && typeof target.content_id === 'string' && target.content_id.startsWith('agenda:')) selectedId.current = target.content_id;
  }, []);
  const navigate = useCallback(async id => {
    const request = ++generation.current;
    const data = await fetchMenu(id);
    if (generation.current !== request) throw Object.assign(new Error('Superseded'),{code:'stale_menu_request'});
    if (isDatedPlan(data.id)) { selectedId.current = data.id; selectedMenu.current = data; }
    return data;
  },[fetchMenu]);
  useEffect(()=>{selectedId.current=contentId;root.current=null;selectedMenu.current=null;setState(s=>({...s,phase:'loading'}));load();return () => { generation.current += 1; };},[contentId,load]);
  if (state.phase==='loading') return <p>Loading menu…</p>;
  if (state.phase==='error') return <div role="alert"><p>{state.message}</p><button onClick={load}>Retry</button><button onClick={onClose}>Back</button></div>;
  return <MenuStack rootMenu={root.current} refreshToken={state.version} playerRef={playerRef} onActivityReturn={load} onActivityStart={activityStart} onReturnTarget={returnTarget} getReturnMenuId={() => selectedId.current} loadContentMenu={navigate} participantClient={participantClient} participantRegistry={participantRegistry}/>;
}
export default AgendaMenuHost;
