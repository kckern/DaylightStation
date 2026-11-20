import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import FamilySelector from './FamilySelector.jsx';
vi.mock('@/lib/api.mjs', () => ({ DaylightAPI: vi.fn(() => Promise.resolve({ users: [] })), DaylightMediaPath: x => x }));
afterEach(() => vi.useRealTimers());
it('uses supplied members and completes the authoritative winner once', () => {
  vi.useFakeTimers(); const done = vi.fn();
  render(<React.StrictMode><FamilySelector members={[{id:'a', name:'Alice'}, {id:'b',name:'Bob'}]} winner="b" embedded autoSpin durationMs={1000} onComplete={done} /></React.StrictMode>);
  act(() => vi.advanceTimersByTime(1100));
  expect(screen.getByRole('heading', {name:'Bob'})).toBeInTheDocument();
  expect(done).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1700));
  expect(done).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:'b'}));
  expect(screen.queryByText('Not enough members')).toBeNull();
});

it('keeps standalone minimum at two members while embedded one-person turns can spin',()=>{
 const {unmount}=render(<FamilySelector members={[{id:'a',name:'Alice'}]}/>);
 expect(screen.getByText('Not enough members')).toBeInTheDocument();unmount();
 render(<FamilySelector members={[{id:'a',name:'Alice'}]} embedded/>);
 expect(screen.queryByText('Not enough members')).toBeNull();
 const embeddedSelector = document.querySelector('.family-selector--embedded');
 expect(embeddedSelector).not.toBeNull();
 expect(embeddedSelector.querySelector('.wheel-rotator')).not.toBeNull();
 expect(embeddedSelector.querySelectorAll('.avatar-wrapper')).toHaveLength(1);
});

it('announces the result hook only after the wheel has stopped',()=>{
 vi.useFakeTimers();const onResult=vi.fn();
 render(<FamilySelector members={[{id:'a',name:'Alice'},{id:'b',name:'Bob'}]} winner="b" autoSpin embedded durationMs={1000} onResult={onResult}/>);
 act(()=>vi.advanceTimersByTime(999));expect(onResult).not.toHaveBeenCalled();
 act(()=>vi.advanceTimersByTime(1));expect(onResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({id:'b'}));
});

it('keeps supplied members visible when an obsolete bootstrap read fails', async()=>{
 let rejectBootstrap;
 const { DaylightAPI } = await import('@/lib/api.mjs');
 DaylightAPI.mockImplementationOnce(() => new Promise((_, reject) => { rejectBootstrap = reject; }));
 const { rerender } = render(<FamilySelector embedded members={undefined}/>);
 expect(screen.getByLabelText('Loading Household members')).toBeInTheDocument();
 rerender(<FamilySelector embedded members={[{id:'a',name:'Alice'},{id:'b',name:'Bob'}]}/>);
 expect(document.querySelector('.wheel-rotator')).not.toBeNull();
 await act(async()=>rejectBootstrap(new Error('stale bootstrap failure')));
 expect(document.querySelector('.wheel-rotator')).not.toBeNull();
 expect(screen.queryByRole('alert')).toBeNull();
});

it('offers retry when the roster endpoint returns an empty successful response', async()=>{
 const { DaylightAPI } = await import('@/lib/api.mjs');
 DaylightAPI.mockImplementationOnce(() => Promise.resolve(null))
  .mockImplementationOnce(() => Promise.resolve({ users: [{id:'a',name:'Alice'}] }));
 const { findByRole, queryByRole, container } = render(<FamilySelector embedded/>);
 const retry = await findByRole('button', { name:'Retry' });
 await act(async()=>retry.click());
 await waitFor(()=>expect(container.querySelector('.wheel-rotator')).not.toBeNull());
 expect(queryByRole('alert')).toBeNull();
});
