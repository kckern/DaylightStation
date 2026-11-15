import {describe,it,expect} from 'vitest';
import {render} from '@testing-library/react';
import {AbcRenderer} from './AbcRenderer.jsx';
describe('AbcRenderer planned snapshots',()=>{
 it('uses planned input while explicit ABC continues to take precedence',()=>{
  const staffPlan={parts:{treble:{midis:[60],octave:-1,residualOctave:0},bass:{midis:[],octave:-1,residualOctave:0}}};
  const {container,rerender}=render(<AbcRenderer notes={new Map([[60,{}]])} staffPlan={staffPlan}/>);
  expect(container.querySelector('svg')).not.toBeNull();
  const first=container.querySelector('svg');
  rerender(<AbcRenderer notes={new Map([[60,{}]])} staffPlan={{...staffPlan,parts:{...staffPlan.parts,treble:{...staffPlan.parts.treble,octave:0}}}}/>);
  expect(container.querySelector('svg')).not.toBe(first);
  rerender(<AbcRenderer abc={'X:1\nL:1/4\nK:C\nC |]'} staffPlan={staffPlan}/>);
  expect(container.querySelector('svg')).not.toBeNull();
 });
});
