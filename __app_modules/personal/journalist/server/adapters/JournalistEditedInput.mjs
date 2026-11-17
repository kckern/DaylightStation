/** A Telegram edit corrects journal text; it must not execute a newly shaped command. */
export function journalistEventForUpdate(event,update){
 const edited=update?.edited_message;
 if(event?.type==='callback'||typeof edited?.text!=='string')return event;
 return {...event,type:'text',payload:{...event.payload,text:edited.text.trim()},metadata:{...event.metadata,edited:true,editDate:edited.edit_date,updateId:update.update_id}};
}
