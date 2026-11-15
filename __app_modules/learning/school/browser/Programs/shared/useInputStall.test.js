import {it,expect,vi} from 'vitest';
import {renderHook,act} from '@testing-library/react';
import {useInputStall} from './useInputStall.js';
it('supports a five minute exit threshold and resets it on input',()=>{
  vi.useFakeTimers();const stalled=vi.fn();const thresholds=[300000];
  const hook=renderHook(()=>useInputStall('gratitude',stalled,{thresholds}));
  act(()=>vi.advanceTimersByTime(299999));expect(stalled).not.toHaveBeenCalled();
  act(()=>window.dispatchEvent(new Event('pointerdown')));
  act(()=>vi.advanceTimersByTime(300000));expect(stalled).toHaveBeenCalledWith(300000);
  hook.unmount();vi.useRealTimers();
});
