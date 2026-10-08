import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import CardLadderProgram from './CardLadderProgram.jsx';
const state = vi.hoisted(() => ({ listener: null, connected: true, progress: null, get: vi.fn() }));
vi.mock('../../../../../hooks/useWebSocket.js', () => ({
 useWebSocketStatus: () => ({ connected: state.connected }),
 useWebSocketSubscription: (topic, callback) => { state.listener = callback; },
}));
vi.mock('../../../schoolApi.js', () => ({ schoolApi: { practiceAssessment: state.get } }));
vi.mock('./CardLadderStage.jsx', () => ({ default: ({children}) => <div>{children}</div> }));
const descriptor = { userId:'learner', deckId:'deck' };
const api = { open:vi.fn(async()=>({ok:true,data:{sittingId:'s',item:{id:'summary-1',type:'summary',source:'practice',words:[]},progress:{}}})), close:vi.fn(async()=>({ok:true})) };
const ready = {unitId:'unit', stage:'quiz_issued', totalQuestions:2,resolvedQuestionIds:[]};
const emit = (extra={}) => act(()=>state.listener?.({event:'assessment-changed',learnerId:'learner',unitId:'unit',...extra}));
beforeEach(()=>{ state.connected=true; state.progress=ready; state.get.mockReset().mockImplementation(async()=>({ok:true,data:state.progress})); });
it.each([false,true])('updates the same mounted screen after fail, pass and correction (started=%s)',async(started)=>{
 render(<CardLadderProgram descriptor={descriptor} api={api}/>);
 await screen.findByText(/waiting to be graded/);
 if(started) { fireEvent.click(screen.getByRole('button',{name:/start/i})); await waitFor(()=>expect(api.open).toHaveBeenCalled()); }
 state.progress={...ready,stage:'review',feedback:[{questionId:'q',explanation:'Read the missed skill.'}]}; emit();
 expect(await screen.findByText('Read the missed skill.')).toBeInTheDocument();
 expect(screen.getByRole('button',{name:'Review missed skills'})).toBeInTheDocument();
 state.progress={...ready,stage:'completed'}; emit(); expect(await screen.findByText('Lesson complete')).toBeInTheDocument();
 state.progress={...ready,stage:'review'}; emit(); expect(await screen.findByRole('button',{name:'Review missed skills'})).toBeInTheDocument();
});
it('ignores unrelated events and recovers on reconnect and focus',async()=>{
 const view=render(<CardLadderProgram descriptor={descriptor} api={api}/>); await screen.findByText(/waiting to be graded/);
 emit({learnerId:'other'}); emit({unitId:'other'}); expect(state.get).toHaveBeenCalledTimes(1);
 state.progress={...ready,stage:'completed'}; state.connected=false; view.rerender(<CardLadderProgram descriptor={descriptor} api={api}/>);
 state.connected=true; view.rerender(<CardLadderProgram descriptor={descriptor} api={api}/>); expect(await screen.findByText('Lesson complete')).toBeInTheDocument();
 state.progress={...ready,stage:'review'}; fireEvent.focus(window); expect(await screen.findByRole('button',{name:'Review missed skills'})).toBeInTheDocument();
 state.progress={...ready,stage:'completed'}; fireEvent(document,new Event('visibilitychange')); expect(await screen.findByText('Lesson complete')).toBeInTheDocument();
});
it.each([{deckId:'new'}, {userId:'new'}])('discards stale responses after an identity switch (%j) and coalesces invalidations',async(change)=>{
 let resolve; state.get.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const view=render(<CardLadderProgram descriptor={descriptor} api={api}/>);
 emit(); emit(); expect(state.get).toHaveBeenCalledTimes(1);
 state.progress={...ready,stage:'completed'};
 view.rerender(<CardLadderProgram descriptor={{...descriptor,...change}} api={api}/>);
 expect(await screen.findByText('Lesson complete')).toBeInTheDocument();
 await act(async()=>resolve({ok:true,data:ready})); expect(screen.queryByText(/waiting to be graded/)).not.toBeInTheDocument();
});
it('does not fetch assessments in test mode even after events and focus',()=>{
 render(<CardLadderProgram descriptor={{...descriptor,test:true}} api={api}/>); emit(); fireEvent.focus(window); expect(state.get).not.toHaveBeenCalled();
});
it('refreshes when the item ID changes with the same type and source',async()=>{
 const localApi={...api,respond:vi.fn(async()=>({ok:true,data:{item:{id:'summary-2',type:'summary',source:'practice'},progress:{}}}))};
 render(<CardLadderProgram descriptor={descriptor} api={localApi}/>);
 fireEvent.click(screen.getByRole('button',{name:/start/i})); await screen.findByRole('button',{name:/Practise more/i});
 await screen.findByText(/waiting to be graded/);
 state.progress={...ready,stage:'completed'};
 fireEvent.click(screen.getByRole('button',{name:/Practise more/i}));
 expect(await screen.findByText('Lesson complete')).toBeInTheDocument();
});
it('ignores a response arriving after unmount',async()=>{
 let resolve; state.get.mockImplementationOnce(()=>new Promise(r=>{resolve=r;}));
 const view=render(<CardLadderProgram descriptor={descriptor} api={api}/>); view.unmount();
 await act(async()=>resolve({ok:true,data:{...ready,stage:'completed'}}));
 expect(screen.queryByText('Lesson complete')).not.toBeInTheDocument();
});
