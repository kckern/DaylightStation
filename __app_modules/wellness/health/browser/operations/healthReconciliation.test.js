import { it, expect } from 'vitest';
import { createHealthReconciliation } from './healthReconciliation.js';
const date='2026-10-25';
const row=(id,version,calories)=>({uuid:id,date,version,kind:'item',calories});
it('protects newest acknowledged rows against older reads while retaining unrelated updates',()=>{
 const r=createHealthReconciliation();
 r.acknowledge({id:'one',date},{rows:[row('a',2,200)],versions:{a:2},removedIds:[]});
 r.acknowledge({id:'two',date},{rows:[row('a',3,300)],versions:{a:3},removedIds:[]});
 const stale=r.reconcile({date,rows:[row('a',1,100),row('b',2,50)],budget:{food:150,remaining:850}});
 expect(stale.rows.map(row=>row.calories)).toEqual([300,50]);
 expect(stale.budget.food).toBe(350);
 expect(r.reconcile({date,rows:[row('a',2,200)],budget:null}).rows[0].version).toBe(3);
});
it('protects deletes and moves then retires against a post-ack authoritative read',()=>{
 const r=createHealthReconciliation();
 r.acknowledge({id:'move',date},{rows:[{...row('a',2,100),date:'2026-10-24'}],removedIds:[],versions:{a:2}});
 expect(r.reconcile({date,rows:[row('a',1,100)]}).rows).toEqual([]);
 r.acknowledge({id:'delete',date},{rows:[],removedIds:['b'],versions:{}});
 expect(r.reconcile({date,rows:[row('b',1,50)]}).rows).toEqual([]);
 r.reconcile({date,rows:[],readToken:r.beginRead()});
 expect(r.reconcile({date,rows:[]}).rows).toEqual([]);
});
