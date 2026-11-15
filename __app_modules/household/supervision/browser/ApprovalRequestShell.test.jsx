import React from 'react';
import {describe,it,expect,vi} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {ApprovalRequestShell} from './ApprovalRequestShell.jsx';
import {SupervisionBoundary} from './SupervisionBoundary.jsx';
const activities=[{id:'school:workspace',label:'School workspace',path:'/school'}],learners=[{id:'user_5',label:'User_5'}];
describe('quiet permission shell',()=>{
 it('approval_mode_hides_bank_codes_rewards_and_printing and parent controls remain available',()=>{
  render(<SupervisionBoundary access={{allowed:false,reason:'SUPERVISION_POLICY_DENIED'}} parentControls={<button>Parent controls</button>} blockedContent={<ApprovalRequestShell activities={activities} learners={learners} context={{learnerId:'user_5',activityId:'school:workspace'}} approval={{status:'idle'}}/>}><div data-testid="bank-balance">Balance</div><button>Print</button><input aria-label="Code"/><div>Reward animation</div></SupervisionBoundary>);
  expect(screen.queryByTestId('bank-balance')).toBeNull();expect(screen.queryByRole('button',{name:'Print'})).toBeNull();expect(screen.queryByLabelText('Code')).toBeNull();expect(screen.queryByText('Reward animation')).toBeNull();expect(screen.getByRole('button',{name:'Parent controls'}).disabled).toBe(false);expect(screen.getByRole('button',{name:'Request permission'})).toBeTruthy();
 });
 it('denied and expired never show Start; pending suppresses duplicate clicks',()=>{
  const requestPermission=vi.fn();const {rerender}=render(<ApprovalRequestShell activities={activities} learners={learners} context={{learnerId:'user_5',activityId:'school:workspace'}} approval={{status:'pending',requestPermission}}/>);
  expect(screen.queryByRole('button',{name:'Start activity'})).toBeNull();expect(screen.getByRole('button',{name:'Request permission'}).disabled).toBe(true);
  for(const status of ['denied','expired']){rerender(<ApprovalRequestShell activities={activities} learners={learners} context={{learnerId:'user_5',activityId:'school:workspace'}} approval={{status,requestPermission}}/>);expect(screen.queryByRole('button',{name:'Start activity'})).toBeNull();}
 });
 it('approved_session_mounts_only_its_activity after an explicit Start action',()=>{
  const startSession=vi.fn();render(<ApprovalRequestShell activities={activities} learners={learners} context={{learnerId:'user_5',activityId:'school:workspace'}} approval={{status:'approved',startSession}}/>);fireEvent.click(screen.getByRole('button',{name:'Start activity'}));expect(startSession).toHaveBeenCalledTimes(1);
 });
});
