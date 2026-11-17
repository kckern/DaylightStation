export const AS_OF=Date.parse('2026-11-17T18:00:00Z');
export const SOURCE_CREATED='2021-04-20T11:26:56.521Z';
export const quiet={info(){},debug(){},warn(){},error(){}};
export const todoTask=(patch={})=>({id:'9007199254740993123',content:'Contact Sample',description:'Ask about the draft',priority:2,project_id:'sample-project',labels:[],added_at:SOURCE_CREATED,updated_at:null,completed_at:null,checked:false,responsible_uid:null,due:{date:'2026-11-18',is_recurring:true,string:'every day'},...patch});
export const clickTask=(patch={})=>({id:'sample-task',name:'Review Sample module',description:'Review the implementation',status:{status:'in progress',type:'custom'},date_created:String(Date.parse(SOURCE_CREATED)),date_updated:null,date_done:null,due_date:null,url:'https://app.clickup.com/t/sample-task',assignees:[{id:'123'}],space:{id:'sample-space'},folder:{id:'sample-folder',name:'Sample'},list:{id:'sample-list',name:'Sample'},...patch});
export function stores(previous=null){
 const current=new Map(),history=new Map();if(previous)current.set('sample:todoist',structuredClone(previous));
 const currentStore={load:async(u,p)=>current.get(u+':'+p)??null,save:async(u,p,v)=>{current.set(u+':'+p,structuredClone(v));}};
 const lifelogStore={load:async(u,p)=>history.get(u+':'+p)??{},save:async(u,p,v)=>{history.set(u+':'+p,structuredClone(v));}};
 return {current,history,currentStore,lifelogStore};
}
export const scope=(accountId='personal',containerIds=['sample-project'])=>({accountId,containerIds,assigneeIds:null,authScope:'user'});
