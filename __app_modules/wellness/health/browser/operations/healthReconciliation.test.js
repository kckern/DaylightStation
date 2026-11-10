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

it('keeps a version floor after catch-up so an older outstanding poll cannot revert it',()=>{
 const r=createHealthReconciliation();
 r.acknowledge({id:'saved',date},{rows:[row('a',2,200)],removedIds:[]});
 r.reconcile({date,rows:[row('a',2,200)]});
 expect(r.reconcile({date,rows:[row('a',1,100)]}).rows[0].calories).toBe(200);
 const token=r.beginRead();
 r.reconcile({date,rows:[],readToken:token});
 expect(r.reconcile({date,rows:[row('a',1,100)]}).rows).toEqual([]);
});

it('does not resurrect a food from a capture response started before its deletion',()=>{
 const r=createHealthReconciliation();
 const capture={id:'capture',date,submittedEpoch:r.beginRead()};
 r.acknowledge({id:'delete',date},{rows:[],removedIds:['a']});
 r.acknowledge(capture,{rows:[row('a',1,100)],removedIds:[]});
 expect(r.reconcile({date,rows:[]}).rows).toEqual([]);
 r.acknowledge({id:'restore',date,submittedEpoch:r.beginRead()},{rows:[row('a',2,100)],removedIds:[]});
 expect(r.reconcile({date,rows:[]}).rows[0].version).toBe(2);
});

it('retains every old location across moves, destination edits, and deletion',()=>{
 const r=createHealthReconciliation();
 const a='2026-10-23',b='2026-10-24',c='2026-10-25';
 r.acknowledge({id:'move1',date:a},{rows:[{...row('x',2,100),date:b}],removedIds:[]});
 r.acknowledge({id:'move2',date:b},{rows:[{...row('x',3,100),date:c}],removedIds:[]});
 r.acknowledge({id:'edit',date:c},{rows:[{...row('x',4,200),date:c}],removedIds:[]});
 expect(r.reconcile({date:a,rows:[{...row('x',1,100),date:a}]}).rows).toEqual([]);
 expect(r.reconcile({date:b,rows:[{...row('x',2,100),date:b}]}).rows).toEqual([]);
 r.acknowledge({id:'delete',date:c},{rows:[],removedIds:['x']});
 expect(r.reconcile({date:a,rows:[{...row('x',1,100),date:a}]}).rows).toEqual([]);
});
