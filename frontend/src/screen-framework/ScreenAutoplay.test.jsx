import React from 'react';
import { act, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ScreenAutoplay } from './ScreenRenderer.jsx';
const hooks=vi.hoisted(()=>({push:vi.fn()}));
vi.mock('../context/useMenuNavigationContext.js',()=>({useMenuNavigationContext:()=>({push:hooks.push})}));
vi.mock('./widgets/builtins.js',()=>({registerBuiltinWidgets:()=>{}}));
vi.mock('../lib/fkb.js',async importOriginal=>({...await importOriginal(),bindBackButton:()=>{},enableGlobalKeyCapture:()=>{}}));
afterEach(()=>vi.useRealTimers());
it('preserves the FHE entry and pushes its menu only once in StrictMode',()=>{
 vi.useFakeTimers();window.history.replaceState({},'','/screens/living-room/fhe');
 render(<React.StrictMode><ScreenAutoplay routes={{fhe:{contentId:'menu:fhe'}}}/></React.StrictMode>);
 act(()=>vi.advanceTimersByTime(501));
 expect(window.location.pathname).toBe('/screens/living-room/fhe');expect(hooks.push).toHaveBeenCalledTimes(1);
});
