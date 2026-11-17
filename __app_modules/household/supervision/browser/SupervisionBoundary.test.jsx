import React,{useEffect} from 'react';
import {describe,it,expect} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {SupervisionBoundary} from './SupervisionBoundary.jsx';
describe('quiet parent block',()=>{
 it('stop_suspends_reward_audio_and_bank_navigation_and_preserves_parent_controls',()=>{
  const reward={playing:false};let suspended=0;
  function Activity(){useEffect(()=>{reward.playing=true;return ()=>{reward.playing=false;};},[]);return <button>Bank balance</button>;}
  const content=access=><SupervisionBoundary access={access} suspendActivity={()=>{suspended++;}} parentControls={<button>Parent controls</button>}><Activity/></SupervisionBoundary>;
  const {rerender}=render(content({allowed:true,reason:null}));expect(reward.playing).toBe(true);
  rerender(content({allowed:false,reason:'SUPERVISION_BLOCKED',epoch:1}));expect(reward.playing).toBe(false);expect(suspended).toBeGreaterThan(0);expect(screen.queryByText('Bank balance')).toBeNull();
  expect(screen.getByRole('button',{name:'Parent controls'})).toBeTruthy();
  rerender(content({allowed:true,reason:null,epoch:1}));expect(reward.playing).toBe(false);expect(screen.queryByText('Bank balance')).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Return to menu'}));expect(reward.playing).toBe(true);
 });
});
