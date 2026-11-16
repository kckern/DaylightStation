import AgendaMenuHost from '../../../../__app_modules/household/agenda/browser/screen.mjs';
const hosts=Object.freeze({agenda:AgendaMenuHost});
export function menuSourceHost(contentId) {
 if (typeof contentId !== 'string' || !contentId.includes(':')) return null;
 return hosts[contentId.split(':',1)[0]] ?? null;
}
