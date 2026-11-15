/** Scope integrity only; authoritative eligibility remains on the server. */
export function screenActionActivity(action,payload={},ownerSnapshot=null){
  if(['escape','display:volume','display:shader','display:sleep','media:seek-abs','media:seek-rel','media:go-live','media:rate'].includes(action))return null;
  if(action==='media:playback' && payload.command?.toLowerCase()==='stop')return null;
  // Transport retains the current visit. Derive its scope from the canonical
  // owner snapshot at dispatch, never from a caller-supplied selected item.
  if(action==='media:playback' && ['retry','pause','play','toggle'].includes(payload.command?.toLowerCase())){
    const contentId=ownerSnapshot?.currentItem?.contentId;
    return typeof contentId==='string' && contentId.includes(':')?`media:${contentId}`:'unsupported';
  }
  if(action==='menu:open' && payload.menuId==='school')return 'school:workspace';
  if(action==='media:play' && typeof payload.contentId==='string' && payload.contentId.includes(':'))return `media:${payload.contentId}`;
  return 'unsupported';
}
