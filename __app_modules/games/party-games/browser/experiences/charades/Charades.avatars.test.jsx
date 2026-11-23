import { render, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Charades from "./Charades.jsx";

vi.mock('@/hooks/useWebSocket.js', () => ({ useWebSocketSubscription: vi.fn() }));
vi.mock("../../../../../../__capabilities/gaming/browser/platform/api/sessionClient.js", () => ({
  fetchSession: vi.fn(async () => ({
    header: { revision: 1 },
    state: { competition: false, phase: 'performer-ready', performer_id: 'guest:visitor', round: 1, challenge_index: 0 },
    definition: { competition: false, rounds: 3 },
  })),
  sendRuleCommand: vi.fn(),
}));

it('renders member avatars in the real wheel while retaining seat IDs for performer selection', async () => {
  const { container } = render(<Charades sessionId="avatars" seats={[
    { id: 'guest:visitor', name: 'Visitor', color: '#123456', members: [{ id: 'guest:visitor', name: 'Visitor', avatar: '/api/v1/static/users/portrait' }] },
    { id: 'seat-b', name: 'Bob', members: [{ id: 'bob', name: 'Bob', avatar: '/api/v1/static/users/bob' }] },
    { id: 'guest', name: 'Guest', members: [] },
  ]} />);
  await waitFor(() => expect(container.querySelector('.family-selector')).toHaveAttribute('data-selected-id', 'guest:visitor'));
  expect([...container.querySelectorAll('image.segment-avatar')].map(image => image.getAttribute('href'))).toEqual([
    '/api/v1/static/users/portrait', '/api/v1/static/users/bob',
  ]);
  expect([...container.querySelectorAll('.segment-initials')].map(node => node.textContent)).toEqual(['G']);
});
it('uses the saved identity portrait key while selecting a distinct guest runtime ID', async()=>{
 const {container}=render(<Charades sessionId="avatars" seats={[{id:'guest:visitor',name:'Visitor',members:[{id:'guest:visitor',avatar:{kind:'user-avatar',userId:'portrait-key'}}]}]}/>);
 await waitFor(()=>expect(container.querySelector('.family-selector')).toHaveAttribute('data-selected-id','guest:visitor'));
 expect(container.querySelector('image.segment-avatar').getAttribute('href')).toContain('/static/img/users/portrait-key');
});
it('falls back to the household user portrait when the launch saved no avatar', async()=>{
 const {container}=render(<Charades sessionId="avatars" seats={[{id:'guest:visitor',name:'Visitor',members:[{id:'guest:visitor',avatar:null,identity:{kind:'user',id:'kid'}}]},{id:'anon',name:'Anon',members:[{id:'anon',avatar:null,identity:{kind:'anonymous'}}]}]}/>);
 await waitFor(()=>expect(container.querySelector('.family-selector')).toHaveAttribute('data-selected-id','guest:visitor'));
 expect([...container.querySelectorAll('image.segment-avatar')].map(i=>i.getAttribute('href'))).toEqual([expect.stringContaining('/static/img/users/kid')]);
});
