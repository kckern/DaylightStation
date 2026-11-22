// Strict embedded-list boundary. The generic list codec remains permissive for legacy callers.
const listFields = new Set(['title','description','image','metadata','sections','items']);
const itemFields = new Set(['uid','title','label','input','action','play','queue','display','list','open','android','image','fixed_order','active','continuous','shuffle','menuStyle','playbackrate','resume','seconds','shader','days','applySchedule','strategy','program','priority','wait_until','skip_after','watched','progress','summary','hold','assetId','playable','src','media_key']);
const sectionFields = new Set(['uid','title','label','items','metadata','image','fixed_order','active','continuous','shuffle','playbackrate','days','applySchedule','priority','hold','watched','skip_after','wait_until']);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function check(value,fields) {
 if (!object(value) || Object.keys(value).some(key=>!fields.has(key))) throw Object.assign(Error('Unsupported embedded list field'),{code:'invalid_document'});
}
export function validateEmbeddedList(list) {
 check(list,listFields);
 if (!Array.isArray(list.sections) && !Array.isArray(list.items)) throw Object.assign(Error('Invalid sections'),{code:'invalid_document'});
 if (list.sections && list.items) throw Object.assign(Error('Ambiguous list'),{code:'invalid_document'});
 for (const section of list.sections || [{items:list.items}]) {
  check(section,sectionFields);
  if (!Array.isArray(section.items)) throw Object.assign(Error('Invalid items'),{code:'invalid_document'});
  for (const item of section.items) {
   check(item,itemFields);
   if (Object.hasOwn(item,'input') && (typeof item.input !== 'string' || !item.input.trim())) throw Object.assign(Error('Invalid legacy input'),{code:'invalid_document'});
   if (item.action != null && !item.input) throw Object.assign(Error('Legacy action requires input'),{code:'invalid_document'});
   if (item.action != null && (typeof item.action !== 'string' || !['play','queue','display','list','open','android'].includes(item.action.toLowerCase()))) throw Object.assign(Error('Unsupported legacy action'),{code:'invalid_document'});
   if (item.action?.toLowerCase() === 'android' && !item.input?.startsWith('android:')) throw Object.assign(Error('Invalid Android action'),{code:'invalid_document'});
   if (item.android != null && (!object(item.android) || typeof item.android.package !== 'string' || typeof item.android.activity !== 'string' || Object.keys(item.android).sort().join(',') !== 'activity,package')) throw Object.assign(Error('Invalid Android target'),{code:'invalid_document'});
   const actions=['play','queue','display','list','open','android'].filter(action=>item[action] != null);
   if (actions.length > 1 || (item.input && actions.length)) {
    throw Object.assign(Error('Ambiguous action'),{code:'invalid_document'});
   }
   // A watchlist's src/media_key and its derived play/input are two encodings
   // of one target. Any different action or target would be discarded.
   if (item.src != null && item.media_key != null) {
    const watchTarget=`${item.src}:${String(item.media_key)}`;
    const input=item.input?.trim().replace(/^([\w-]+):\s+/, '$1:');
    if ((actions.length && (actions[0] !== 'play' || item.play?.contentId !== watchTarget)) ||
        (input && (input !== watchTarget || (item.action && item.action.toLowerCase() !== 'play')))) {
     throw Object.assign(Error('Ambiguous watchlist action'),{code:'invalid_document'});
    }
   }
   for (const action of ['play','queue','display','list']) {
    const value=item[action];
    if (value != null && (!object(value) || typeof value.contentId !== 'string' || !value.contentId || Object.keys(value).some(key=>key !== 'contentId'))) throw Object.assign(Error('Unsupported action options'),{code:'invalid_document'});
   }
   if (item.open != null && (typeof item.open !== 'string' || !item.open.trim())) throw Object.assign(Error('Unsupported open action'),{code:'invalid_document'});
  }
 }
}
