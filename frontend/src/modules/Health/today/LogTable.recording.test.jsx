import { render,screen,fireEvent,act,cleanup } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { afterEach,it,expect,vi } from 'vitest';
import { LogTable } from './LogTable.jsx';
let recorder;
const stopTrack=vi.fn();
function setup() {
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-06T20:59:55'));
 vi.stubGlobal('MediaRecorder',class {
  constructor(stream){this.stream=stream;this.state='inactive';this.mimeType='audio/webm';recorder=this;}
  start(){this.state='recording';}
  stop(){this.state='inactive';this.ondataavailable?.({data:new Blob(['audio'])});this.onstop?.();}
 });
 Object.defineProperty(navigator,'mediaDevices',{configurable:true,value:{getUserMedia:vi.fn(async()=>({getTracks:()=>[{stop:stopTrack}]}))}});
 vi.stubGlobal('FileReader',class {readAsDataURL(){this.result='data:audio/webm;base64,YQ==';this.onload?.();}});
}
const ui=(voice,date='2026-09-06')=><MantineProvider><LogTable date={date} byBucket={new Map()} onAddTo={()=>{}} onVoiceCapture={voice}/></MantineProvider>;
afterEach(()=>{cleanup();vi.useRealTimers();vi.unstubAllGlobals();});
it('keeps a recording empty meal visible across its automatic retirement',async()=>{
 setup();const voice=vi.fn(async()=>({committed:true}));render(ui(voice));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Log by voice to Dinner'})));
 act(()=>vi.advanceTimersByTime(15000));
 expect(screen.getByRole('button',{name:'Stop recording — Dinner'})).toBeTruthy();
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Stop recording — Dinner'})));
 expect(voice).toHaveBeenCalledWith('data:audio/webm;base64,YQ==','evening',{date:'2026-09-06',selectedIds:[],isDeparted:expect.any(Function)});
});
it('finishes a recording on date navigation with its original date',async()=>{
 setup();const voice=vi.fn(async()=>({committed:true}));const view=render(ui(voice));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Log by voice to Dinner'})));
 await act(async()=>view.rerender(ui(voice,'2026-09-05')));
 expect(recorder.state).toBe('inactive');
 expect(voice).toHaveBeenCalledWith('data:audio/webm;base64,YQ==','evening',{date:'2026-09-06',selectedIds:[],departed:true,isDeparted:expect.any(Function)});
});
it('retains a failed recording and its exact Retry after the automatic meal retires',async()=>{
 setup();const voice=vi.fn().mockRejectedValueOnce(new Error('Disconnected')).mockResolvedValueOnce({committed:true});render(ui(voice));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Log by voice to Dinner'})));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Stop recording — Dinner'})));
 act(()=>vi.advanceTimersByTime(15000));
 expect(screen.getByRole('alert')).toHaveTextContent('Disconnected');
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Retry recording'})));
 expect(voice).toHaveBeenCalledTimes(2);
 expect(voice.mock.calls[1].slice(0,2)).toEqual(voice.mock.calls[0].slice(0,2));
 expect(voice.mock.calls[1][2]).toMatchObject({date:'2026-09-06',selectedIds:[]});
 expect(screen.queryByRole('button',{name:'Retry recording'})).toBeNull();
});

it('reports departure dynamically when navigation occurs after an upload starts',async()=>{
 setup();let rejectUpload;const upload=new Promise((resolve,reject)=>{rejectUpload=reject;});
 const voice=vi.fn(()=>upload);const view=render(ui(voice));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Log by voice to Dinner'})));
 await act(async()=>fireEvent.click(screen.getByRole('button',{name:'Stop recording — Dinner'})));
 const context=voice.mock.calls[0][2];
 expect(context.isDeparted()).toBe(false);
 await act(async()=>view.rerender(ui(voice,'2026-09-05')));
 expect(context.isDeparted()).toBe(true);
 await act(async()=>rejectUpload(new Error('Disconnected after navigation')));
 expect(voice).toHaveBeenCalledTimes(1);
});
