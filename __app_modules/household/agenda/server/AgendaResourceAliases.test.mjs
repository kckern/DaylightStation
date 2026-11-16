import {it,expect} from 'vitest';
import {AgendaResourceAliases} from './AgendaResourceAliases.mjs';

it('resolves only exact explicitly authorized resources', () => {
 const registration={kind:'menu',id:'fhe',owner:'agenda',canonicalContentId:'agenda:fhe',adminUrl:'/admin/content/agendas/fhe'};
 const disabled=new AgendaResourceAliases({registrations:[registration],authority:()=>false});
 expect(disabled.resolve({kind:'menu',id:'fhe'})).toBeNull();
 const aliases=new AgendaResourceAliases({registrations:[registration],authority:()=>true});
 expect(aliases.resolve({kind:'menu',id:'fhe'})).toEqual({owner:'agenda',canonicalContentId:'agenda:fhe',adminUrl:'/admin/content/agendas/fhe'});
 expect(aliases.resolve({kind:'menu',id:'fhe/other'})).toBeNull();
 expect(aliases.resolve({kind:'menu',id:'other'})).toBeNull();
 expect(new AgendaResourceAliases().resolve({kind:'menu',id:'fhe'})).toBeNull();
});

it('rejects ambiguous ownership and non-boolean authority decisions', () => {
 const entry={kind:'menu',id:'fhe',owner:'agenda',canonicalContentId:'agenda:fhe',adminUrl:'/admin/content/agendas/fhe'};
 expect(()=>new AgendaResourceAliases({registrations:[entry,entry],authority:()=>true})).toThrow('Duplicate');
 expect(()=>new AgendaResourceAliases({registrations:[entry],authority:()=>Promise.resolve(true)}).resolve({kind:'menu',id:'fhe'})).toThrow('authority');
});

it('observes cutover and backout using one shared authority and fails closed on authority errors', () => {
 const entry={kind:'menu',id:'fhe',owner:'agenda',canonicalContentId:'agenda:fhe',adminUrl:'/admin/content/agendas/fhe'};
 let decision=false;const aliases=new AgendaResourceAliases({registrations:[entry],authority:()=>{if(decision==='error')throw Error('manifest');return decision;}});
 expect(aliases.resolve({kind:'menu',id:'fhe'})).toBeNull();decision=true;
 expect(aliases.resolve({kind:'menu',id:'fhe'})).toMatchObject({owner:'agenda'});decision=false;
 expect(aliases.resolve({kind:'menu',id:'fhe'})).toBeNull();decision='error';
 expect(()=>aliases.resolve({kind:'menu',id:'fhe'})).toThrow(expect.objectContaining({code:'ownership_unavailable'}));
});

it('rejects registrations whose admin and content owner disagree',()=>{
 expect(()=>new AgendaResourceAliases({registrations:[{kind:'menu',id:'fhe',owner:'agenda',canonicalContentId:'agenda:fhe',adminUrl:'/admin/content/agendas/other'}],authority:()=>true})).toThrow('Invalid');
});
