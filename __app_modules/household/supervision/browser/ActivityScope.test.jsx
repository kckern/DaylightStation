import React,{useEffect} from 'react';
import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {ActivityScopeProvider,SupervisedActivity} from './ActivityScope.jsx';
it('an approved scope cannot mount another internal title or learner',()=>{
 let mounted=0;const rejected=vi.fn();function Game(){useEffect(()=>{mounted++;return()=>{mounted--;};},[]);return <p>Game running</p>;}
 const scope={restricted:true,activityId:'piano:game:chess',learnerId:'user_5',onMismatch:rejected};
 const renderGame=(activityId,learnerId)=><ActivityScopeProvider value={scope}><SupervisedActivity activityId={activityId} learnerId={learnerId}><Game/></SupervisedActivity></ActivityScopeProvider>;
 const {rerender}=render(renderGame('piano:game:chess','user_5'));expect(mounted).toBe(1);
 rerender(renderGame('piano:game:tetris','user_5'));expect(mounted).toBe(0);expect(screen.queryByText('Game running')).toBeNull();expect(rejected).toHaveBeenCalled();
 rerender(renderGame('piano:game:chess','sibling'));expect(mounted).toBe(0);
});
