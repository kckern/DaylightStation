import { fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { expect, it, vi } from 'vitest';
import { useScopedRemoteControls } from './useScopedRemoteControls.js';
function Controls({ action, exit }) { const ref=useRef(null); useScopedRemoteControls(ref,{onEscape:exit}); return <div ref={ref}><button onClick={action}>One</button><button onClick={action}>Two</button></div>; }
it('owns native remote input and activates the focused button once per press', () => {
 const action=vi.fn(), exit=vi.fn(), outer=vi.fn(); window.addEventListener('keydown',outer);
 render(<Controls action={action} exit={exit}/>);
 fireEvent.keyDown(window,{key:'ArrowRight'}); expect(screen.getByText('Two')).toHaveFocus();
 fireEvent.keyDown(window,{key:'Enter'}); fireEvent.keyDown(window,{key:'Enter',repeat:true}); expect(action).toHaveBeenCalledTimes(1);
 fireEvent.keyDown(window,{key:'Escape'}); expect(exit).toHaveBeenCalledTimes(1); expect(outer).not.toHaveBeenCalled(); window.removeEventListener('keydown',outer);
});
