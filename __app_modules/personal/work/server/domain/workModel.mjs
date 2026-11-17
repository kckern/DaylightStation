/** Provider-neutral references and source facts. Observation never means relevance. */
export const WORK_OPERATIONS=Object.freeze(['read','complete','reopen','transition','create_task','update_task','archive_task','delete_task','create_container','rename_container','archive_container']);
const identifier=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
const providerName=/^[a-z][a-z0-9-]{0,63}$/;
const categories=new Set(['open','in_progress','paused','done','unknown']);
const invalid=code=>{throw Object.assign(new TypeError(code),{code});};
export function validateWorkRef(ref){
 if(!ref||typeof ref!=='object'||!providerName.test(ref.provider??'')||typeof ref.provider!=='string'||typeof ref.accountId!=='string'||!identifier.test(ref.accountId)||!['task','container'].includes(ref.kind)||typeof ref.id!=='string'||!identifier.test(ref.id))invalid('INVALID_WORK_REF');
 return ref;
}
export function keyOf(ref){validateWorkRef(ref);return JSON.stringify([ref.provider,ref.accountId,ref.kind,ref.id]);}
const instant=value=>value===null||typeof value==='number'&&Number.isFinite(value)&&value>=0;
const localDate=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;
export function validateWorkItem(item){
 if(!item||typeof item!=='object')invalid('INVALID_WORK_ITEM');
 validateWorkRef(item.ref);
 if(item.ref.kind!=='task'||typeof item.title!=='string'||!item.title.trim()||item.title.length>2000||item.description!==null&&typeof item.description!=='string'||!categories.has(item.status?.category)||item.status.native!==null&&typeof item.status.native!=='string')invalid('INVALID_WORK_ITEM');
 if(!['createdAt','modifiedAt','completedAt'].every(field=>instant(item[field]))||!instant(item.observedAt)||item.observedAt===null||typeof item.version!=='string'||!item.version||item.version.length>256)invalid('INVALID_WORK_ITEM');
 const sameAccount=ref=>{validateWorkRef(ref);return ref.kind==='container'&&ref.provider===item.ref.provider&&ref.accountId===item.ref.accountId;};
 if(item.containerRef!==null&&!sameAccount(item.containerRef)||!Array.isArray(item.ancestorRefs)||!item.ancestorRefs.every(sameAccount)||!Array.isArray(item.assigneeIds)||!item.assigneeIds.every(id=>typeof id==='string'&&identifier.test(id)))invalid('INVALID_WORK_ITEM');
 if(item.due!==null){const d=item.due;if(!d||d.date!==null&&!localDate(d.date)||!instant(d.at)||typeof d.recurring!=='boolean'||d.occurrenceId!==null&&(typeof d.occurrenceId!=='string'||!d.occurrenceId||d.occurrenceId.length>256))invalid('INVALID_WORK_ITEM');}
 if(item.url!==null){try{if(typeof item.url!=='string'||!['http:','https:'].includes(new URL(item.url).protocol))invalid('INVALID_WORK_ITEM');}catch{invalid('INVALID_WORK_ITEM');}}
 return item;
}
