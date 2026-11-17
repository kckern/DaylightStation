import {expect,it} from 'vitest';
import {contentReturnUrl,focusUidFromSearch} from './return-navigation.mjs';
it('maps full generic content targets to an existing screen or the TV entry',()=>{
 const target={kind:'content',content_id:'collection:week/old',item_uid:'item / 1'};
 expect(contentReturnUrl(target,'/screens/office/party-games/charades')).toBe('/screens/office?list=collection%3Aweek%2Fold&focus_uid=item+%2F+1');
 const url=contentReturnUrl(target,'/app/party-games/charades');
 expect(url).toBe('/tv?list=collection%3Aweek%2Fold&focus_uid=item+%2F+1');
 expect(focusUidFromSearch(new URL(url,'http://localhost').search)).toBe('item / 1');
});
it('rejects unsafe or malformed content destinations',()=>{
 for(const target of [{kind:'content',content_id:'https://evil.test'},{kind:'content',content_id:'agenda:p',item_uid:''},{kind:'content',content_id:'agenda:p',extra:'x'},{kind:'url',content_id:'agenda:p'}]) expect(contentReturnUrl(target,'/app/party-games')).toBeNull();
});
