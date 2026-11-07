import React from 'react';
import { it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import BluetoothRecoveryPanel from './BluetoothRecoveryPanel.jsx';
const MAC='AA:BB:CC:DD:EE:FF';
const makeState=()=>({ok:true,adapter:{supported:true,enabled:true,discovering:false},devices:[{address:MAC,name:'Gamepad',bond:'bonded',manageable:true,connected:false,profiles:[]},{address:'11:22:33:44:55:66',name:'TV remote',bond:'bonded',manageable:false,connected:true,profiles:['input']}],capabilities:{scan:true,pair:true,unpair:true,input:true,pin:true,confirm:false},pairing:null,lastError:null});
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
function setup(state=makeState()){
 const requests=[];const fetch=vi.fn(async(url,options={})=>{requests.push({url,...options});return {ok:true,status:200,json:async()=>options.method==='POST'?{ok:true,accepted:true}:structuredClone(state)};});vi.stubGlobal('fetch',fetch);return {state,requests,fetch};
}
it('keeps accepted connect pending, protects the remote, and confirms before Forget',async()=>{
 const {requests}=setup(); render(<BluetoothRecoveryPanel deviceId="tv" onClose={()=>{}}/>);
 await screen.findByRole('button',{name:'Connect Gamepad'});
 expect(screen.queryByRole('button',{name:'Forget TV remote'})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Forget Gamepad'}));
 expect(requests.filter(x=>x.method==='POST')).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'Cancel forget'}));
 fireEvent.click(screen.getByRole('button',{name:'Connect Gamepad'}));
 await screen.findByText(/Waiting for the device/);
 expect(screen.getByText('Paired · disconnected')).toBeTruthy();
 expect(JSON.parse(requests.find(x=>x.method==='POST').body)).toEqual({address:MAC,profile:'input'});
});
it('forgets only after confirmation and sends only the selected controller',async()=>{
 const {requests}=setup();render(<BluetoothRecoveryPanel deviceId="tv" onClose={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Forget Gamepad'}));
 fireEvent.click(screen.getByRole('button',{name:'Confirm forget Gamepad'}));
 await waitFor(()=>expect(requests.some(x=>x.url.endsWith('/unpair'))).toBe(true));
 expect(JSON.parse(requests.find(x=>x.url.endsWith('/unpair')).body)).toEqual({address:MAC});
});
it('Back closes only recovery and closing after scan acceptance stops discovery',async()=>{
 const {requests}=setup();const close=vi.fn();const view=render(<BluetoothRecoveryPanel deviceId="tv" onClose={close}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Find controllers'}));
 await waitFor(()=>expect(requests.some(x=>x.url.endsWith('/scan'))).toBe(true));
 fireEvent.keyDown(screen.getByRole('dialog'),{key:'BrowserBack'});expect(close).toHaveBeenCalledTimes(1);
 view.unmount();await waitFor(()=>expect(requests.some(x=>x.url.endsWith('/scan/stop'))).toBe(true));
});
it('does not target any device when fleet identity is missing',async()=>{
 const {fetch}=setup();render(<BluetoothRecoveryPanel onClose={()=>{}}/>);
 expect(await screen.findByText(/device identity/i)).toBeTruthy();expect(fetch).not.toHaveBeenCalled();
});
it('shows native errors without opening Settings and disables stale state actions',async()=>{
 const {fetch}=setup();fetch.mockImplementation(async()=>({ok:false,status:503,json:async()=>({ok:false,error:'Controller recovery is not configured'})}));
 render(<BluetoothRecoveryPanel deviceId="tv" onClose={()=>{}}/>);
 expect(await screen.findByText('Controller recovery is not configured')).toBeTruthy();expect(screen.queryByRole('button',{name:'Connect Gamepad'})).toBeNull();
});

it('prevents a second lifecycle action while the first awaits observation',async()=>{
 setup();render(<BluetoothRecoveryPanel deviceId="tv" onClose={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect Gamepad'}));
 await screen.findByText(/Waiting for the device/);
 expect(screen.getByRole('button',{name:'Forget Gamepad'})).toBeDisabled();
});
it('observes connect and disconnect independently from acceptance',async()=>{
 const {state}=setup();render(<BluetoothRecoveryPanel deviceId="tv" onClose={()=>{}}/>);
 fireEvent.click(await screen.findByRole('button',{name:'Connect Gamepad'}));
 await screen.findByText(/Waiting for the device/);state.devices[0].connected=true;state.devices[0].profiles=['input'];
 fireEvent.click(await screen.findByRole('button',{name:'Disconnect Gamepad'}));
 state.devices[0].connected=false;state.devices[0].profiles=[];
 expect(await screen.findByRole('button',{name:'Connect Gamepad'})).toBeTruthy();
});
