import {describe,it,expect} from 'vitest';
import {crossStaffHits} from './staffInk.js';
describe('crossStaffHits',()=>{
  const stem={staff:'bass',columnId:0,kind:'stem',x0:10,x1:11,y0:139,y1:190};
  const head={staff:'treble',columnId:0,kind:'head',x0:8,x1:20,y0:143,y1:153};
  it('detects a stem through a ledger note outside the five staff lines',()=>{
    expect(crossStaffHits([stem,head])).toHaveLength(1);
  });
  it('ignores same-staff contact and well separated opposing ink',()=>{
    expect(crossStaffHits([stem,{...head,staff:'bass'}])).toEqual([]);
    expect(crossStaffHits([stem,{...head,x0:30,x1:42}])).toEqual([]);
  });
});
