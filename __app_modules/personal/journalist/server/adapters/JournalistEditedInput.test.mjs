import {it,expect} from 'vitest';
import {journalistEventForUpdate} from './JournalistEditedInput.mjs';
it('treats edited text as a correction even when it resembles a command and retains provider ordering',()=>{
 const event={type:'command',payload:{command:'cancel',text:'this plan'},metadata:{senderId:'101'}};
 const result=journalistEventForUpdate(event,{update_id:22,edited_message:{edit_date:1000,text:'/Cancel this plan'}});
 expect(result).toMatchObject({type:'text',payload:{text:'/Cancel this plan'},metadata:{edited:true,editDate:1000,updateId:22}});
 expect(journalistEventForUpdate(event,{message:{text:'/Cancel this plan'}})).toBe(event);
});
