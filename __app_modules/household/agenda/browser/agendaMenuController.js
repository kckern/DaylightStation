import {buildHeaders} from '../../../../frontend/src/lib/api.mjs';
import {getLogger} from '../../../../frontend/src/lib/logging/Logger.js';

const isDatedPlan = id => /^agenda:[^/]+\/plans\/[^/]+$/.test(id || '');
const defaultFetch = (...args) => fetch(...args);

/** A source-local menu frame; no participant context is propagated to ordinary actions. */
export function createAgendaMenuController(contentId, {fetcher=defaultFetch}={}) {
  let generation=0, selectedId=contentId, selectedMenu=null;
  async function fetchMenu(id) {
    getLogger().info('agenda-menu.request',{contentId:id});
    try {
      const headers=buildHeaders(localStorage.getItem('ds_token'),false);
      headers['X-Daylight-Participant-Launch-Version']='1';
      const response=await fetcher(`/api/v1/list/${id.replace(':','/')}`,{headers});
      const data=await response.json();
      if (!response.ok || !Array.isArray(data.items)) throw new Error(data.message || 'Unable to load menu');
      return data;
    } catch(error) {getLogger().warn('agenda-menu.error',{contentId:id,code:error.code});throw error;}
  }
  return {
    async navigate(id) {
      const request=++generation;const data=await fetchMenu(id);
      if (generation!==request) throw Object.assign(new Error('Superseded'),{code:'stale_menu_request'});
      if (!selectedMenu || isDatedPlan(data.id)) {selectedId=data.id || id;selectedMenu=data;}
      return data;
    },
    async refresh() {
      const request=++generation;const id=selectedId,menu=selectedMenu;const data=await fetchMenu(id);
      if (generation!==request) throw Object.assign(new Error('Superseded'),{code:'stale_menu_request'});
      selectedId=data.id || id;
      if (!menu) selectedMenu=data;
      else {if (menu.revision!=null && data.revision!=null && menu.revision!==data.revision && !data.notice) data.notice='This plan has been updated.';for (const key of Object.keys(menu)) delete menu[key];Object.assign(menu,data);}
      return data;
    },
    activityStart(menu) {generation++;if(isDatedPlan(menu?.id)){selectedId=menu.id;selectedMenu=menu;}},
    async refreshParticipant(uid,action) {const data=await this.refresh();const row=data.items.find(item=>item.uid===uid);return !row?.disabled ? row?.participantLaunches?.[action] || null : null;},
    returnTarget(target) {if(target?.kind==='content' && typeof target.content_id==='string' && target.content_id.startsWith('agenda:')) selectedId=target.content_id;},
    returnMenuId() {return selectedId;},
    cancel() {generation++;},
  };
}
