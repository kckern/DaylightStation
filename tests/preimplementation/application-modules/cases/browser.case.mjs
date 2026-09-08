// Explicit preparation runner only; intentionally outside default test globs.
import { test, afterEach, after } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { emit, subscriptions } from '../drivers/browser-ports.mjs';
import { loadBrowserImplementation } from '../drivers/browser-target.mjs';
const dom = new JSDOM('<!doctype html><html><body></body></html>', {
  url: 'https://audit.invalid/',
  pretendToBeVisual: true
});
for (const name of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLButtonElement', 'SVGElement', 'Element', 'Node', 'MutationObserver', 'Event', 'KeyboardEvent', 'MouseEvent', 'localStorage', 'getComputedStyle']) globalThis[name] = name === 'window' ? dom.window : name === 'getComputedStyle' ? dom.window.getComputedStyle.bind(dom.window) : dom.window[name];
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true
});
globalThis.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window);
globalThis.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
// jsdom has no layout/scrolling implementation; these tests assert DOM/data effects only.
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
dom.window.matchMedia = () => ({
  matches: false,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  }
});
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = (await import('react')).default;
const {
  render,
  cleanup,
  fireEvent,
  waitFor,
  act
} = await import('@testing-library/react');
const { Gratitude, FamilySelector, GratitudeConfig, dispatchPortalHidMessage, usePortalKeys, usePianoBridgeNotes, ScreenVolumeContext, resolveParamOptions, getApp } = await loadBrowserImplementation();
const {
  MantineProvider
} = await import('@mantine/core');
const bootstrap = {
  users: [{
    id: 'alex',
    name: 'Alex',
    group_label: 'Family A'
  }, {
    id: 'bryn',
    name: 'Bryn',
    group_label: null
  }],
  options: {
    gratitude: [{
      id: 'q1',
      text: 'Time together'
    }],
    hopes: [{
      id: 'q2',
      text: 'Learning'
    }]
  },
  selections: {
    gratitude: [],
    hopes: []
  },
  discarded: {
    gratitude: [],
    hopes: []
  }
};
let calls = [];
let responseMode = 'normal';
let responseData = bootstrap;
globalThis.fetch = async (url, options = {}) => {
  const parsed = new URL(url);
  assert.equal(parsed.origin, 'https://audit.invalid');
  const body = options.body ? JSON.parse(options.body) : null;
  calls.push({
    path: parsed.pathname,
    method: options.method || 'GET',
    body
  });
  if (responseMode === 'error') return {
    ok: false,
    status: 503,
    statusText: 'Synthetic failure',
    text: async () => 'Synthetic failure'
  };
  let value;
  if (parsed.pathname === '/api/v1/gratitude/bootstrap') value = structuredClone(responseData);else if (/^\/api\/v1\/gratitude\/selections\//.test(parsed.pathname)) value = {
    selection: {
      id: 'server-selection-1'
    },
    removed: {
      id: 'server-selection-1'
    }
  };else if (/^\/api\/v1\/gratitude\/discarded\//.test(parsed.pathname)) value = {
    item: body.item
  };else if (parsed.pathname.startsWith('/api/v1/admin/config/files/')) value = {
    parsed: body?.parsed || {
      categories: [],
      display: {
        options_per_page: 3
      },
      snapshots: {
        enabled: false
      }
    },
    raw: 'synthetic: true'
  };else throw new Error('UNEXPECTED_FAKE_HTTP_PATH ' + parsed.pathname);
  return {
    ok: true,
    status: 200,
    json: async () => value
  };
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function mount(props = {}) {
  calls = [];
  responseMode = 'normal';
  responseData = bootstrap;
  const view = render(React.createElement(Gratitude, props));
  await waitFor(() => assert.ok(view.container.querySelector('.gratitude-header')));
  await act(() => sleep(120));
  return view;
}
afterEach(() => {
  cleanup();
  responseMode = 'normal';
  responseData = bootstrap;
  calls = [];
});
after(() => dom.window.close());
test('CASE-WIRE-PIANO-NOTES original hook preserves note dialect speaker hysteresis and fire-and-forget MIDI',t=>{
  const oldGlobal=Object.getOwnPropertyDescriptor(globalThis,'WebSocket'),oldWindow=Object.getOwnPropertyDescriptor(window,'WebSocket');
  const sockets=[],notes=[];let state;
  class FakeSocket {constructor(url){this.url=url;this.readyState=0;this.sent=[];sockets.push(this);}send(text){this.sent.push(JSON.parse(text));}close(){this.closed=true;}message(value){this.onmessage?.({data:JSON.stringify(value)});}}
  Object.defineProperty(globalThis,'WebSocket',{value:FakeSocket,configurable:true,writable:true});
  Object.defineProperty(window,'WebSocket',{value:FakeSocket,configurable:true,writable:true});
  t.after(()=>{if(oldGlobal)Object.defineProperty(globalThis,'WebSocket',oldGlobal);else delete globalThis.WebSocket;Object.defineProperty(window,'WebSocket',oldWindow);});
  function Bridge(){state=usePianoBridgeNotes({onNote:(...args)=>notes.push(args)});return null;}
  const view=render(React.createElement(Bridge));t.after(()=>view.unmount());assert.equal(sockets.length,1);const socket=sockets[0];
  assert.equal(socket.url,'ws://localhost:8770');assert.equal(state.sendSysex([240,247]),false);
  act(()=>{socket.readyState=1;socket.onopen();});assert.equal(state.link,'connected');assert.equal(state.unavailable,false);
  act(()=>{socket.message({type:'note.on',note:60});socket.message({type:'note.off',note:60,velocity:99});
    socket.message({topic:'midi',type:'note',data:{event:'note_on',note:61,velocity:90}});socket.onmessage({data:'invalid JSON'});});
  assert.deepEqual(notes,[['note_on',60,0],['note_off',60,0]]);
  act(()=>{socket.message({type:'status',speakerOk:false});socket.message({type:'status',speakerOk:false});});assert.equal(state.speakerConnected,true);
  act(()=>socket.message({type:'status',speakerOk:false}));assert.equal(state.speakerConnected,false);
  act(()=>socket.message({type:'status',speakerOk:true}));assert.equal(state.speakerConnected,true);
  assert.equal(state.sendSysex([],1),false);assert.equal(state.sendSysex(new Uint8Array([240,247])),false);
  assert.equal(state.sendSysex([240,999,247],99),true);assert.deepEqual(socket.sent,[{type:'midi.raw',bytes:[240,999,247],repeat:99}]);
  view.unmount();assert.equal(socket.closed,true);
});
test('CASE-WIRE-PORTAL-HID-EDIT real dispatcher validates fields and performs unprevented keydown text edits',t=>{
  const input=document.createElement('input');document.body.append(input);t.after(()=>input.remove());
  input.value='ab';input.focus();input.setSelectionRange(1,1);
  const events=[];let inputs=0;input.addEventListener('keydown',e=>events.push(e));input.addEventListener('input',()=>inputs++);
  const msg={type:'keyboard',action:'down',key:'X',code:'KeyX',location:0,ctrlKey:false,shiftKey:true,altKey:false,metaKey:false,repeat:false,ts:1};
  assert.equal(dispatchPortalHidMessage({...msg,key:'x'.repeat(65)}),false);
  assert.equal(dispatchPortalHidMessage({...msg,type:'key'}),false);
  assert.equal(dispatchPortalHidMessage({...msg,action:'up'}),true);assert.equal(input.value,'ab');assert.equal(inputs,0);
  assert.equal(dispatchPortalHidMessage(msg),true);assert.equal(input.value,'aXb');assert.equal(input.selectionStart,2);assert.equal(inputs,1);
  assert.equal(events[0].portalHid,true);assert.equal(events[0].shiftKey,true);assert.equal(events[0].code,'KeyX');
  assert.equal(events[0].isTrusted,false);assert.equal(Object.getOwnPropertyDescriptor(events[0],'portalHid').configurable,false);
  input.addEventListener('keydown',e=>e.preventDefault(),{once:true});
  assert.equal(dispatchPortalHidMessage({...msg,key:'Y',code:'KeyY'}),true);assert.equal(input.value,'aXb');assert.equal(inputs,1);
});
test('CASE-WIRE-PORTAL-HID-ACTION real dispatcher preserves focus navigation and activation semantics',t=>{
  const box=document.createElement('div');box.innerHTML='<button>one</button><button disabled>skip</button><button>two</button><textarea></textarea>';
  document.body.append(box);t.after(()=>box.remove());const [first,,second]=box.querySelectorAll('button');let clicks=0;second.addEventListener('click',()=>clicks++);
  const msg={type:'keyboard',action:'down',key:'Tab',code:'Tab'};first.focus();
  dispatchPortalHidMessage(msg);assert.equal(document.activeElement,second);
  dispatchPortalHidMessage({...msg,key:'Enter',code:'Enter'});assert.equal(clicks,1);
  dispatchPortalHidMessage({...msg,key:'Enter',code:'Enter',action:'up'});assert.equal(clicks,1);
  dispatchPortalHidMessage({...msg,shiftKey:true});assert.equal(document.activeElement,first);
  const textarea=box.querySelector('textarea');textarea.focus();textarea.value='ab';textarea.setSelectionRange(1,1);
  dispatchPortalHidMessage({...msg,key:'Enter',code:'Enter'});assert.equal(textarea.value,'a\nb');
});
test('CASE-WIRE-PORTAL-VOLUME original hook steps on both actions regardless of panel flag and cleans up its socket',t=>{
  const oldGlobal=Object.getOwnPropertyDescriptor(globalThis,'WebSocket'),oldWindow=Object.getOwnPropertyDescriptor(window,'WebSocket');
  const sockets=[],steps=[];
  class FakeSocket {constructor(url){this.url=url;this.closed=false;sockets.push(this);}close(){this.closed=true;}sendMessage(value){this.onmessage?.({data:JSON.stringify(value)});}}
  Object.defineProperty(globalThis,'WebSocket',{value:FakeSocket,configurable:true,writable:true});
  Object.defineProperty(window,'WebSocket',{value:FakeSocket,configurable:true,writable:true});
  t.after(()=>{if(oldGlobal)Object.defineProperty(globalThis,'WebSocket',oldGlobal);else delete globalThis.WebSocket;Object.defineProperty(window,'WebSocket',oldWindow);});
  function Bridge(){usePortalKeys({enabled:true,port:8771});return null;}
  const tree=size=>React.createElement(ScreenVolumeContext.Provider,{value:{step:v=>steps.push(v),stepSize:size}},React.createElement(Bridge));
  const view=render(tree(0.1));t.after(()=>view.unmount());assert.equal(sockets.length,1);const socket=sockets[0];
  assert.equal(socket.url,'ws://localhost:8771/');
  socket.sendMessage({type:'ready'});socket.onmessage({data:'not json'});
  socket.sendMessage({type:'key',key:'KEYCODE_VOLUME_UP',action:'down',interactive:false});
  socket.sendMessage({type:'key',key:'KEYCODE_VOLUME_UP',action:'up',interactive:false});
  socket.sendMessage({type:'key',key:'KEYCODE_MUTE',action:'down',interactive:true});
  assert.deepEqual(steps,[0.1,0.1]);
  view.rerender(tree(0.2));assert.equal(sockets.length,1);
  socket.sendMessage({type:'key',key:'KEYCODE_VOLUME_DOWN',action:'up',interactive:true});assert.deepEqual(steps,[0.1,0.1,-0.2]);
  view.unmount();assert.equal(socket.closed,true);assert.equal(socket.onmessage,null);assert.equal(socket.onclose,null);
});
test('CASE-GR-UI-BOOTSTRAP real kiosk loads the stable URL and flattened selections', async () => {
  const view = await mount();
  assert.equal(calls[0].path, '/api/v1/gratitude/bootstrap');
  assert.ok(view.container.textContent.includes('Time together'));
  assert.ok(view.container.textContent.includes('Family A'));
  assert.equal(document.activeElement, view.container.querySelector('[tabindex="0"]'));
});
test('CASE-GR-UI-ERROR failed bootstrap shows error without subscriptions', async () => {
  responseMode = 'error';
  const view = render(React.createElement(Gratitude));
  await waitFor(() => assert.ok(view.container.textContent.includes('Failed to load. Please retry.')));
  assert.deepEqual(subscriptions(), {
    messages: 0,
    statuses: 0
  });
});
test('CASE-GR-UI-EMPTY empty data mounts without fabricated users', async () => {
  responseData = {
    users: [],
    options: {
      gratitude: [],
      hopes: []
    },
    selections: {
      gratitude: [],
      hopes: []
    }
  };
  const view = render(React.createElement(Gratitude));
  await waitFor(() => assert.ok(view.container.querySelector('.gratitude-header')));
  assert.ok(!view.container.textContent.includes('Family A'));
});
test('CASE-GR-UI-SELECT short press sends one selection and displays the item', async () => {
  const view = await mount();
  const focus = view.container.querySelector('[tabindex="0"]');
  fireEvent.keyDown(focus, {
    key: 'Enter'
  });
  fireEvent.keyUp(focus, {
    key: 'Enter'
  });
  await waitFor(() => assert.equal(calls.filter(c => c.method === 'POST').length, 1));
  assert.deepEqual(calls.find(c => c.method === 'POST').body, {
    userId: 'alex',
    item: {
      id: 'q1',
      text: 'Time together'
    }
  });
  await act(() => sleep(350));
  assert.ok(view.container.querySelector('.selected-column').textContent.includes('Time together'));
});
test('CASE-GR-UI-ORPHAN keyup without keydown does not select', async () => {
  const view = await mount();
  fireEvent.keyUp(view.container.querySelector('[tabindex="0"]'), {
    key: 'Enter'
  });
  await act(() => sleep(400));
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});
test('CASE-GR-UI-LONGPRESS category cycles once without selecting', async () => {
  const view = await mount();
  const focus = view.container.querySelector('[tabindex="0"]');
  fireEvent.keyDown(focus, {
    key: 'Enter'
  });
  await act(() => sleep(550));
  fireEvent.keyUp(focus, {
    key: 'Enter'
  });
  await act(() => sleep(350));
  assert.ok(view.container.querySelector('.category-cycle').textContent.includes('Hopes'));
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});
test('CASE-GR-UI-EXIT escape calls the existing clear callback', async () => {
  let exits = 0;
  const view = await mount({
    clear: () => exits++
  });
  fireEvent.keyDown(view.container.querySelector('[tabindex="0"]'), {
    key: 'Escape'
  });
  assert.equal(exits, 1);
});
test('CASE-GR-UI-HOMEBOT event displays items without writing a second time', async () => {
  const view = await mount();
  await act(async () => emit({
    topic: 'gratitude',
    action: 'item_added',
    source: 'homebot',
    items: [{
      id: 'incoming',
      text: 'Shared meal'
    }],
    userId: 'bryn',
    userName: 'Bryn',
    category: 'hopes'
  }));
  assert.ok(view.container.querySelector('.selected-column').textContent.includes('Shared meal'));
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
});
test('CASE-GR-UI-EXTERNAL event persists once with current category and user', async () => {
  await mount();
  await act(async () => emit({
    topic: 'gratitude',
    action: 'item_added',
    source: 'synthetic',
    items: [{
      id: 'incoming',
      text: 'Shared meal'
    }],
    userId: 'bryn',
    userName: 'Bryn',
    category: 'hopes'
  }));
  assert.deepEqual(calls.filter(c => c.method === 'POST'), [{
    path: '/api/v1/gratitude/selections/hopes',
    method: 'POST',
    body: {
      userId: 'bryn',
      item: {
        id: 'incoming',
        text: 'Shared meal'
      }
    }
  }]);
});
test('CASE-GR-UI-CUSTOMTYPE existing raw custom-item payload is ignored without action:item_added', async () => {
  const view = await mount();
  await act(async () => emit({
    topic: 'gratitude',
    type: 'gratitude_item',
    isCustom: true,
    item: {
      id: 1,
      text: 'Unadapted custom item'
    }
  }));
  assert.equal(calls.filter(c => c.method === 'POST').length, 0);
  assert.ok(!view.container.textContent.includes('Unadapted custom item'));
});
test('CASE-GR-UI-CLEANUP repeated mount/unmount restores both transport subscriptions', async () => {
  const first = await mount();
  assert.deepEqual(subscriptions(), {
    messages: 1,
    statuses: 1
  });
  first.unmount();
  assert.deepEqual(subscriptions(), {
    messages: 0,
    statuses: 0
  });
  const second = await mount();
  assert.deepEqual(subscriptions(), {
    messages: 1,
    statuses: 1
  });
  second.unmount();
  assert.deepEqual(subscriptions(), {
    messages: 0,
    statuses: 0
  });
});
test('CASE-GR-FAMILY real FamilySelector still consumes Gratitude bootstrap', async () => {
  calls = [];
  const view = render(React.createElement(FamilySelector));
  await waitFor(() => assert.ok(view.container.querySelector('.roulette-wheel')));
  assert.equal(calls[0].path, '/api/v1/gratitude/bootstrap');
  fireEvent.error(view.container.querySelector('.segment-avatar'));
  assert.ok(view.container.textContent.includes('FA'));
});
test('CASE-GR-APP-PARAMS real registry household options preserve labels and bootstrap URL', async () => {
  calls=[];
  assert.equal(getApp('gratitude').label,'Gratitude & Hope');
  const options=await resolveParamOptions({options:'household'});
  assert.equal(calls[0].path,'/api/v1/gratitude/bootstrap');
  assert.deepEqual(options.map(({value,label})=>({value,label})),[{value:'alex',label:'Family A'},{value:'bryn',label:'Bryn'}]);
  assert.equal(await resolveParamOptions(null),null);
  assert.equal(await resolveParamOptions({options:'unknown'}),null);
});
test('CASE-GR-APP-PARAMS-EDGE household resolver preserves duplicate order fallback labels raw IDs and rejects malformed responses',async()=>{
  responseData={users:[{id:'raw/id',name:'Name',group_label:'Group'},{id:'raw/id',name:'',group_label:''},{id:'last',name:'Last'}]};
  const options=await resolveParamOptions({options:'household'});
  assert.deepEqual(options.map(({value,label})=>({value,label})),[{value:'raw/id',label:'Group'},{value:'raw/id',label:'raw/id'},{value:'last',label:'Last'}]);
  assert.ok(options[0].thumbnail.endsWith('/static/img/users/raw/id'));
  responseData={};assert.deepEqual(await resolveParamOptions({options:'household'}),[]);
  responseData=null;await assert.rejects(resolveParamOptions({options:'household'}),TypeError);
  responseData={users:{not:'array'}};await assert.rejects(resolveParamOptions({options:'household'}),TypeError);
  responseMode='error';await assert.rejects(resolveParamOptions({options:'household'}),/Synthetic failure/);
  assert.equal(calls.every(c=>c.path==='/api/v1/gratitude/bootstrap'&&c.method==='GET'&&c.body===null),true);
});
test('CASE-GR-FAMILY-ERROR rejected household bootstrap shows existing error surface without retrying or substituting members',async()=>{
  responseMode='error';const recorded=[],original=console.error;console.error=(...args)=>recorded.push(args);
  try{
    const view=render(React.createElement(FamilySelector));
    await waitFor(()=>assert.ok(view.container.querySelector('.family-selector-error')));
    assert.ok(view.container.textContent.includes('Failed to load household members.'));assert.equal(calls.length,1);
    assert.equal(calls[0].path,'/api/v1/gratitude/bootstrap');assert.equal(view.container.querySelector('.roulette-wheel'),null);
    assert.equal(recorded.some(c=>c[0]==='FamilySelector: Failed to load members'),true);
  }finally{console.error=original;}
});
test('CASE-GR-UI-UNDO server-confirmed selection ID is used to remove and return the option',async()=>{
  const view=await mount(),focus=view.container.querySelector('[tabindex="0"]');
  fireEvent.keyDown(focus,{key:'Enter'});fireEvent.keyUp(focus,{key:'Enter'});
  await waitFor(()=>assert.equal(calls.filter(c=>c.method==='POST').length,1));
  await act(()=>sleep(350));
  fireEvent.keyDown(focus,{key:'ArrowRight'});
  fireEvent.keyDown(focus,{key:'Enter'});fireEvent.keyUp(focus,{key:'Enter'});
  await waitFor(()=>assert.equal(calls.filter(c=>c.method==='DELETE').length,1));
  assert.equal(calls.find(c=>c.method==='DELETE').path,'/api/v1/gratitude/selections/gratitude/server-selection-1');
  assert.ok(!view.container.querySelector('.selected-column').textContent.includes('Time together'));
});
test('CASE-GR-UI-DISCARD repeated session discard writes only once',async()=>{
  const view=await mount(),focus=view.container.querySelector('[tabindex="0"]');
  fireEvent.keyDown(focus,{key:'ArrowLeft'});await act(()=>sleep(400));
  assert.deepEqual(calls.filter(c=>c.method==='POST'),[{path:'/api/v1/gratitude/discarded/gratitude',method:'POST',body:{item:{id:'q1',text:'Time together'}}}]);
  fireEvent.keyDown(focus,{key:'ArrowLeft'});await act(()=>sleep(400));
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
});
test('CASE-GR-UI-USER queue arrow-down changes the selection user',async()=>{
  const view=await mount(),focus=view.container.querySelector('[tabindex="0"]');
  fireEvent.keyDown(focus,{key:'ArrowDown'});fireEvent.keyDown(focus,{key:' '});fireEvent.keyUp(focus,{key:' '});
  await waitFor(()=>assert.equal(calls.filter(c=>c.method==='POST').length,1));
  assert.equal(calls.find(c=>c.method==='POST').body.userId,'bryn');
});
test('CASE-GR-UI-INFLIGHT existing delayed selection still persists after immediate unmount',async()=>{
  const view=await mount(),focus=view.container.querySelector('[tabindex="0"]');
  fireEvent.keyDown(focus,{key:'Enter'});fireEvent.keyUp(focus,{key:'Enter'});view.unmount();
  await act(()=>sleep(400));
  assert.equal(calls.filter(c=>c.method==='POST').length,1);
  assert.deepEqual(subscriptions(),{messages:0,statuses:0});
});
test('CASE-GR-FAMILY-MINIMUM exclusion preserves the two-member minimum', async () => {
  calls = [];
  const view = render(React.createElement(FamilySelector, {
    exclude: 'bryn'
  }));
  await waitFor(() => assert.ok(view.container.textContent.includes('Not enough members')));
  assert.ok(view.container.textContent.includes('At least 2 members'));
  assert.equal(view.container.querySelector('.roulette-wheel'), null);
});
test('CASE-GR-ADMIN real editor uses canonical config path and parsed PUT body', async () => {
  calls = [];
  const view = render(React.createElement(MantineProvider, null, React.createElement(GratitudeConfig)));
  await waitFor(() => assert.ok(view.queryByLabelText('Options Per Page')));
  assert.ok(calls[0].path.endsWith('/gratitude/config.yml'));
  fireEvent.change(view.getByLabelText('Options Per Page'), {
    target: {
      value: '5'
    }
  });
  const save = view.getByRole('button', {
    name: /Save/
  });
  fireEvent.click(save);
  await waitFor(() => assert.equal(calls.filter(c => c.method === 'PUT').length, 1));
  assert.equal(calls.find(c => c.method === 'PUT').body.parsed.display.options_per_page, 5);
});
