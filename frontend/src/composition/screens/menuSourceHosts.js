import AgendaMenuHost, {createAgendaMenuController} from '../../../../__app_modules/household/agenda/browser/screen.mjs';
import {DaylightAPI} from '../../lib/api.mjs';
const hosts=Object.freeze({agenda:AgendaMenuHost});
const controllers=Object.freeze({agenda:createAgendaMenuController});
export function menuSourceHost(contentId) {
 if (typeof contentId !== 'string' || !contentId.includes(':')) return null;
 return hosts[contentId.split(':',1)[0]] ?? null;
}
/** Resolve an exact legacy owner before handing any alias to a source host. */
export async function screenOwnership(contentId) {
 const match=typeof contentId==='string' && contentId.match(/^menu:([A-Za-z0-9][A-Za-z0-9_.-]*)$/);
 if(!match) return null;
 const result=await DaylightAPI(`/api/v1/list/_ownership/menu/${encodeURIComponent(match[1])}`);
 if(!result || typeof result!=='object' || Array.isArray(result) || Object.keys(result).join(',')!=='alias') throw Error('Invalid ownership response');
 if(result.alias===null) return null;
 if(!result.alias || typeof result.alias!=='object' || Array.isArray(result.alias) || Object.keys(result.alias).sort().join(',')!=='canonicalContentId,owner' || typeof result.alias.owner!=='string' || !/^[A-Za-z][A-Za-z0-9_-]*:[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(result.alias.canonicalContentId || '') || result.alias.canonicalContentId.split(':',1)[0]!==result.alias.owner || !menuSourceHost(result.alias.canonicalContentId)) throw Error('Invalid ownership response');
 return result.alias;
}
export async function resolveMenuSource(contentId) {
 const alias=await screenOwnership(contentId);const id=alias?.canonicalContentId || contentId;
 const factory=typeof id==='string' ? controllers[id.split(':',1)[0]] : null;
 return factory ? {contentId:id,controller:factory(id)} : null;
}
