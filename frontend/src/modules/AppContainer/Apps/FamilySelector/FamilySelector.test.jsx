import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FamilySelector from './FamilySelector.jsx';
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve({ users: [] })), DaylightMediaPath: x => x }));
afterEach(() => vi.useRealTimers());
it('uses supplied members and completes the authoritative winner once', () => {
  vi.useFakeTimers(); const done = vi.fn();
  render(<React.StrictMode><FamilySelector members={[{id:'a', name:'Alice'}, {id:'b',name:'Bob'}]} winner="b" embedded autoSpin durationMs={1000} onComplete={done} /></React.StrictMode>);
  act(() => vi.advanceTimersByTime(1100));
  expect(done).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:'b'}));
  expect(screen.queryByText('Not enough members')).toBeNull();
});

it('keeps standalone minimum at two members while embedded one-person turns can spin',()=>{
 const {unmount}=render(<FamilySelector members={[{id:'a',name:'Alice'}]}/>);
 expect(screen.getByText('Not enough members')).toBeInTheDocument();unmount();
 render(<FamilySelector members={[{id:'a',name:'Alice'}]} embedded/>);
 expect(screen.queryByText('Not enough members')).toBeNull();
});
